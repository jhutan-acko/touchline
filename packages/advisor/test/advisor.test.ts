import { cpSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { Effect } from "effect"
import { beforeAll, describe, expect, it } from "vitest"
import type { League } from "@touchline/league"
import { SCENARIOS, writeMatch } from "@touchline/sim"
import { DEFAULT_PARAMS, type MatchState } from "@touchline/sim-core"
import { xtGridFromJson } from "@touchline/stats"
import { AdvisorError, CLIP_AFTER_S, CLIP_BEFORE_S, clearlyBetter, explainPass, passClip, Session, SESSION_CACHE_STATES, suggestPosition, typicalIndex, type PassExplanation } from "../src/index.js"

const root = join(dirname(fileURLToPath(import.meta.url)), "../../..")
const league = JSON.parse(readFileSync(join(root, "data/league/league.json"), "utf8")) as League
const xt = xtGridFromJson(JSON.parse(readFileSync(join(root, "data/params/xt-grid.json"), "utf8")))
const dir = mkdtempSync(join(tmpdir(), "touchline-advisor-"))
const cfg = { matchId: "adv", seed: 4247, kickoffTime: "2026-10-18T14:00:00.000Z", home: league.clubs[2]!, away: league.clubs[6]!, params: DEFAULT_PARAMS, dt: 0.1 }
let session: Session

beforeAll(async () => {
  await Effect.runPromise(writeMatch(cfg, dir))
  session = Session.fromRun(dir, league, [DEFAULT_PARAMS])
}, 120_000)

/** Events emitted up to a tick: the last id's number must equal the state's event count. */
const lastSeq = (tick: number) => Math.max(...session.events.filter((e) => Math.max(e.frame_id, e.frame_id_end ?? e.frame_id) <= tick).map((e) => Number(e.id.split("-e").at(-1))))
/** The first tick from `from` on where a player of `side` is on the ball. */
const owned = (from: number, sameSide: boolean): { s: MatchState; carrier: string; other: string } => {
  for (let t = from; ; t += 10) {
    const s = session.stateAt(t)
    if (s.possession.kind !== "owned") continue
    const carrier = s.players.find((p) => p.id === (s.possession as { playerId: string }).playerId)!
    const other = s.players.find((p) => !p.sentOff && p.role !== "GK" && p.id !== carrier.id && (p.side === carrier.side) === sameSide)!
    return { s, carrier: carrier.id, other: other.id }
  }
}

describe("session", () => {
  it("rebuilds a run folder's match and gives its state at any tick", () => {
    for (const t of [5_000, 31_234, 12_000]) expect(session.stateAt(t).eventSeq).toBe(lastSeq(t))
    expect(session.stateAt(31_234)).toBe(session.stateAt(31_234))
  })

  it("keeps a bounded number of states however many frames are asked about", () => {
    for (let t = 40_000; t < 40_000 + 3 * SESSION_CACHE_STATES; t += 3) session.stateAt(t)
    // At most the recent states asked for, plus one checkpoint per 3,000 ticks of the match.
    expect(session.cachedStates).toBeLessThanOrEqual(SESSION_CACHE_STATES + 20)
    expect(session.stateAt(5_000).eventSeq).toBe(lastSeq(5_000))
  })

  it("fetches the states at many ticks in one run, the same as asking for each", () => {
    const ticks = [7_001, 7_513, 22_222]
    const fresh = Session.fromRun(dir, league, [DEFAULT_PARAMS])
    fresh.prefetch(ticks)
    for (const t of ticks) {
      expect(fresh.stateAt(t)).toEqual(session.stateAt(t))
      expect(fresh.stateAt(t)).toBe(fresh.stateAt(t))
    }
  })

  it("refuses parameters of another version, a missing folder, and a folder that does not match its manifest", () => {
    expect(() => Session.fromRun(dir, league, [{ ...DEFAULT_PARAMS, provenance: { ...DEFAULT_PARAMS.provenance, version: "other" } }])).toThrow(/the run used parameters "prior-1"; available: other/)
    expect(() => Session.fromRun(join(dir, "nope"), league, [DEFAULT_PARAMS])).toThrow(AdvisorError)
    const bad = mkdtempSync(join(tmpdir(), "touchline-advisor-bad-"))
    cpSync(dir, bad, { recursive: true })
    const m = JSON.parse(readFileSync(join(bad, "manifest.json"), "utf8"))
    writeFileSync(join(bad, "manifest.json"), JSON.stringify({ ...m, seed: m.seed + 1 }))
    expect(() => Session.fromRun(bad, league, [DEFAULT_PARAMS])).toThrow(/does not match/)
  })

  it("refuses a run folder written before teams switched ends at half-time", () => {
    const old = mkdtempSync(join(tmpdir(), "touchline-advisor-old-"))
    cpSync(dir, old, { recursive: true })
    const meta = JSON.parse(readFileSync(join(old, "meta.json"), "utf8"))
    writeFileSync(join(old, "meta.json"), JSON.stringify({ ...meta, match: { ...meta.match, periods: meta.match.periods.map((p: object) => ({ ...p, play_direction: "left_right" })) } }))
    expect(() => Session.fromRun(old, league, [DEFAULT_PARAMS])).toThrow(AdvisorError)
    expect(() => Session.fromRun(old, league, [DEFAULT_PARAMS])).toThrow(/predates the half-time switch.*regenerate/)
  })

  it("rebuilds a scripted match through the scenario runner", async () => {
    const sc = SCENARIOS.late_comeback!
    const sdir = mkdtempSync(join(tmpdir(), "touchline-advisor-script-"))
    await Effect.runPromise(writeMatch({ ...cfg, matchId: "adv-s", home: league.clubs.find((c) => c.id === sc.home)!, away: league.clubs.find((c) => c.id === sc.away)!, script: sc.script }, sdir))
    const scripted = Session.fromRun(sdir, league, [DEFAULT_PARAMS])
    const t = 50_000
    const seq = Math.max(...scripted.events.filter((e) => Math.max(e.frame_id, e.frame_id_end ?? e.frame_id) <= t).map((e) => Number(e.id.split("-e").at(-1))))
    expect(scripted.stateAt(t).eventSeq).toBe(seq)
  }, 120_000)
})

describe("better option explainer", () => {
  const passes = () => session.events.filter((e) => e.type === "pass" && Array.isArray(e.attrs.options) && (e.attrs.options as unknown[]).length >= 3 && e.frame_id > 600)

  it("ranks every recorded option on paper by pitch control and threat, the pass played among them", () => {
    const x = explainPass(session, passes()[0]!.id, xt, { seeds: 0 })
    expect(x.options.filter((o) => o.chosen)).toHaveLength(1)
    for (let i = 1; i < x.options.length; i++) expect(x.options[i - 1]!.value).toBeGreaterThanOrEqual(x.options[i]!.value)
    for (const o of x.options) expect(o.pitch_control).toBeGreaterThanOrEqual(0)
    expect(x.best_on_paper).toEqual(x.options[0])
    expect(x).toMatchObject({ verdict: "not_verified", note: "re-simulation skipped", better: null })
  })

  it("plays every alternative out against the pass played and reports a better one only when it is clearly better", () => {
    // Pass 3: the first from 3 on where the case below holds (P5 Task 14 re-pick; it was pass 15 in P4, pass 3 since P3).
    const x = explainPass(session, passes()[3]!.id, xt, { seeds: 12, horizonS: 10 })
    expect(x.verdict).not.toBe("not_verified")
    for (const o of x.options) if (o.chosen) expect(o.simulated).toBeNull()
    const simulated = x.options.filter((o) => o.simulated)
    expect(simulated.length).toBeGreaterThan(0)
    // The verdict's own rule (clearlyBetter: corrected margin and minimum gain), not a bare 2 SE: this pass has an
    // alternative above 2 SE that the corrected margin rejects.
    const clearly = simulated.filter((o) => clearlyBetter(o.simulated!, 12, simulated.length))
    // The case the comment names, asserted so it cannot rot: some option is above 2 SE and the corrected rule rejects it.
    expect(simulated.some((o) => o.simulated!.mean > 2 * o.simulated!.se && o.simulated!.mean > 0 && !clearlyBetter(o.simulated!, 12, simulated.length))).toBe(true)
    expect(x.verdict).toBe(clearly.length ? "better_option_found" : "played_pass_was_best")
    if (x.better) expect(x.better.simulated!.mean).toBe(Math.max(...clearly.map((o) => o.simulated!.mean)))
    expect(explainPass(session, passes()[3]!.id, xt, { seeds: 12, horizonS: 10 })).toEqual(x)
  })

  it("refuses an event that is not a pass", () => {
    const reception = session.events.find((e) => e.type === "reception")!
    expect(() => explainPass(session, reception.id, xt)).toThrow(/not a pass/)
    expect(() => explainPass(session, "nope", xt)).toThrow(/no event/)
  })
})

describe("review fixes", () => {
  it("gives no verdict on fewer than 10 seeds", () => {
    const pass = session.events.find((e) => e.type === "pass" && Array.isArray(e.attrs.options) && (e.attrs.options as unknown[]).length >= 3 && e.frame_id > 600)!
    const x = explainPass(session, pass.id, xt, { seeds: 3 })
    expect(x).toMatchObject({ verdict: "not_verified", better: null })
    expect(x.note).toMatch(/at least 10 seeds/)
  })

  it("calls an option clearly better only with enough seeds, a corrected margin and a minimum gain", () => {
    expect(clearlyBetter({ mean: 0.1, se: 0.02 }, 20, 4)).toBe(true)
    // 2.5 standard errors: enough for one comparison at 2 SE, not for four with a correction.
    expect(clearlyBetter({ mean: 0.05, se: 0.02 }, 20, 4)).toBe(false)
    expect(clearlyBetter({ mean: 0.005, se: 0.0001 }, 20, 1)).toBe(false)
    expect(clearlyBetter({ mean: 1, se: 0.01 }, 5, 1)).toBe(false)
  })

  it("refuses a run whose manifest names another scenario than the one played", async () => {
    const sc = SCENARIOS.red_card_collapse!
    const sdir = mkdtempSync(join(tmpdir(), "touchline-advisor-tamper-"))
    await Effect.runPromise(writeMatch({ ...cfg, matchId: "adv-t", home: league.clubs.find((c) => c.id === sc.home)!, away: league.clubs.find((c) => c.id === sc.away)!, script: sc.script }, sdir))
    const m = JSON.parse(readFileSync(join(sdir, "manifest.json"), "utf8"))
    writeFileSync(join(sdir, "manifest.json"), JSON.stringify({ ...m, scenario: null }))
    expect(() => Session.fromRun(sdir, league, [DEFAULT_PARAMS])).toThrow(/does not match/)
  }, 120_000)
})

describe("positioning advisor", () => {
  it("finds a better spot to receive in attack, within reach", () => {
    const { s, other } = owned(15_000, true)
    const a = suggestPosition(session, other, s.tick, xt)
    expect(a.mode).toBe("attack")
    expect(a.value_best).toBeGreaterThanOrEqual(a.value_now)
    expect(Math.hypot(a.to.x - a.from.x, a.to.y - a.from.y)).toBeLessThanOrEqual(12 + 1e-9)
  })

  it("finds a spot that takes away the carrier's best option in defence, and checks it by re-simulation", () => {
    const { s, other } = owned(25_000, false)
    const a = suggestPosition(session, other, s.tick, xt, { seeds: 6, horizonS: 10 })
    expect(a.mode).toBe("defend")
    expect(a.value_best).toBeLessThanOrEqual(a.value_now)
    if (a.gain > 0) expect(a.verification!.seeds).toBe(6)
  })

  it("refuses the player on the ball and moments when nobody has it", () => {
    const { s, carrier } = owned(15_000, true)
    expect(() => suggestPosition(session, carrier, s.tick, xt)).toThrow(/on the ball/)
    let t = 15_000
    while (session.stateAt(t).possession.kind === "owned") t++
    expect(() => suggestPosition(session, carrier, t, xt)).toThrow(/nobody has the ball/)
  })
})

describe("pass clip", () => {
  const pass = () => session.events.filter((e) => e.type === "pass" && Array.isArray(e.attrs.options) && (e.attrs.options as unknown[]).length >= 3 && e.frame_id > 600)[3]!
  /** The pass explained, with its best simulated alternative taken as the better option (whatever the verdict). */
  const asBetter = (x: PassExplanation): PassExplanation => {
    const alt = x.options.filter((o) => o.simulated).sort((a, b) => b.simulated!.mean - a.simulated!.mean)[0]!
    return { ...x, verdict: "better_option_found", better: alt }
  }

  it("shows the match as it went around the pass, then the better pass in its typical seed from the same frames", () => {
    const x = asBetter(explainPass(session, pass().id, xt, { seeds: 10, horizonS: 10 }))
    const c = passClip(session, x, xt)
    const before = CLIP_BEFORE_S / 0.1
    const after = CLIP_AFTER_S / 0.1
    expect(c.real.map((f) => f.tick)).toEqual(Array.from({ length: before + after }, (_, i) => x.frame_id - before + i))
    expect(c.pass_index).toBe(before)
    expect(c.real[c.pass_index]!.tick).toBe(x.frame_id)
    for (const t of [c.real[0]!, c.real.at(-1)!]) {
      const s = session.stateAt(t.tick)
      const p = s.players.find((q) => q.id === t.home[0]!.id)!
      expect(t.home[0]!.x).toBeCloseTo(p.pos.x, 2)
    }
    expect(c.variant!.map((f) => f.tick)).toEqual(c.real.map((f) => f.tick))
    expect(c.variant!.slice(0, c.pass_index)).toEqual(c.real.slice(0, c.pass_index))
    expect(c.variant!.slice(c.pass_index)).not.toEqual(c.real.slice(c.pass_index))
    expect(c).toMatchObject({ verdict: "better_option_found", passer_id: x.player_id, played_to: x.options.find((o) => o.chosen)!.receiver_id, better_to: x.better!.receiver_id, seeds: 10, gain: x.better!.simulated })
    expect(c.typical_seed).toBeGreaterThanOrEqual(0)
    expect(c.typical_seed).toBeLessThan(10)
    for (const n of [c.shots!.played, c.shots!.better, c.goals!.played, c.goals!.better]) expect(n).toBeGreaterThanOrEqual(0)
    expect(c.goals!.better).toBeLessThanOrEqual(c.shots!.better)
    expect(passClip(session, x, xt)).toEqual(c)
  }, 60_000)

  it("shows only the match as it went when no better option was found", () => {
    const x = explainPass(session, pass().id, xt, { seeds: 0 })
    const c = passClip(session, x, xt)
    expect(c).toMatchObject({ verdict: "not_verified", better_to: null, variant: null, typical_seed: null, shots: null, goals: null, gain: null })
    expect(c.real.length).toBe((CLIP_BEFORE_S + CLIP_AFTER_S) / 0.1)
  })

  it("picks the seed closest to the mean, never an outlier", () => {
    expect(typicalIndex([0, 0.1, 0.9, 0.2])).toBe(3) // mean 0.3
    expect(typicalIndex([1, 1])).toBe(0)
    expect(() => typicalIndex([])).toThrow(AdvisorError)
  })
})

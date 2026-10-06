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
import { AdvisorError, explainPass, Session, SESSION_CACHE_STATES, suggestPosition } from "../src/index.js"

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

  it("refuses parameters of another version, a missing folder, and a folder that does not match its manifest", () => {
    expect(() => Session.fromRun(dir, league, [{ ...DEFAULT_PARAMS, provenance: { ...DEFAULT_PARAMS.provenance, version: "other" } }])).toThrow(/the run used parameters "prior-0"; available: other/)
    expect(() => Session.fromRun(join(dir, "nope"), league, [DEFAULT_PARAMS])).toThrow(AdvisorError)
    const bad = mkdtempSync(join(tmpdir(), "touchline-advisor-bad-"))
    cpSync(dir, bad, { recursive: true })
    const m = JSON.parse(readFileSync(join(bad, "manifest.json"), "utf8"))
    writeFileSync(join(bad, "manifest.json"), JSON.stringify({ ...m, seed: m.seed + 1 }))
    expect(() => Session.fromRun(bad, league, [DEFAULT_PARAMS])).toThrow(/does not match/)
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
    const x = explainPass(session, passes()[3]!.id, xt, { seeds: 12, horizonS: 10 })
    expect(x.verdict).not.toBe("not_verified")
    for (const o of x.options) if (o.chosen) expect(o.simulated).toBeNull()
    const simulated = x.options.filter((o) => o.simulated)
    expect(simulated.length).toBeGreaterThan(0)
    const clearly = simulated.filter((o) => o.simulated!.mean > 2 * o.simulated!.se && o.simulated!.mean > 0)
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

import { readFileSync } from "node:fs"
import { join } from "node:path"
import { Effect } from "effect"
import { initMatch, isFinished, step, type DomainEvent } from "@touchline/sim-core"
import { decodeDecision, type Situation } from "@touchline/schema"
import { describe, expect, it } from "vitest"
import type { DecideInput, Manager } from "../src/decision.js"
import { replayManager, ReplayMismatch } from "../src/replay.js"
import { rulesManager, rulesOption } from "../src/rules.js"
import { runManaged } from "../src/run.js"
import { leagueConfig, models, xt } from "./helpers.js"

const golden = JSON.parse(readFileSync(join(import.meta.dirname, "golden/situation-m-11-minute_60.json"), "utf8")) as Situation
/** The reviewed situation with some fields changed. */
const sit = (over: { score?: [number, number]; minute?: number; energy?: number; windows?: number; halfTime?: boolean }): Situation => ({
  ...golden,
  moment: { ...golden.moment, minute: over.minute ?? golden.moment.minute, score: over.score ? { for: over.score[0], against: over.score[1] } : golden.moment.score },
  players: { ...golden.players, on_pitch: golden.players.on_pitch.map((p) => (over.energy === undefined ? p : { ...p, energy_pct: p.role === "GK" ? 95 : over.energy })) },
  limits: { ...golden.limits, windows_left: over.windows ?? golden.limits.windows_left, half_time_break: over.halfTime ?? false }
})
const style = (s: Situation, k: string) => s.team.style.find((x) => x.setting === k)!.value

describe("the rule-based manager", () => {
  it("chases a game it is losing: more press, quicker play, fresh attackers for its most tired players", () => {
    const s = sit({ score: [0, 1], energy: 70 })
    const opt = rulesOption(s)!
    expect(opt.label).toBe("Chase the game")
    expect(opt.orders.filter((o) => o.kind === "style")).toEqual([
      { kind: "style", setting: "pressIntensity", value: Math.min(1, style(s, "pressIntensity") + 0.2) },
      { kind: "style", setting: "tempo", value: Math.min(1, style(s, "tempo") + 0.2) }
    ])
    const subs = opt.orders.filter((o) => o.kind === "sub") as Array<{ off: string; on: string }>
    expect(subs).toHaveLength(2)
    for (const o of subs) {
      expect(["ST", "W", "AM"]).toContain(s.players.bench.find((b) => b.id === o.on)!.role)
      // The substitute plays the outgoing player's role: never an attacker at the back.
      expect(["GK", "CB", "FB"]).not.toContain(s.players.on_pitch.find((p) => p.id === o.off)!.role)
    }
  })
  it("protects a lead late on: a deeper line, a tighter block, tired players replaced role for role", () => {
    const s = sit({ score: [2, 0], minute: 70, energy: 55 })
    const opt = rulesOption(s)!
    expect(opt.label).toBe("Protect the lead")
    expect(opt.orders.slice(0, 2)).toEqual([
      { kind: "style", setting: "lineHeight", value: Math.round((style(s, "lineHeight") - 0.3) * 100) / 100 },
      { kind: "style", setting: "compactness", value: Math.min(1, Math.round((style(s, "compactness") + 0.2) * 100) / 100) }
    ])
    for (const o of opt.orders.filter((x) => x.kind === "sub") as Array<{ off: string; on: string }>) {
      const off = s.players.on_pitch.find((p) => p.id === o.off)!, on = s.players.bench.find((b) => b.id === o.on)!
      expect(on.role === off.role || ["CB", "FB"].includes(on.role) === ["CB", "FB"].includes(off.role)).toBe(true)
    }
  })
  it("otherwise only replaces players below 60 % energy, and changes nothing when nobody is tired", () => {
    expect(rulesOption(sit({ score: [1, 1], energy: 80 }))).toBeNull()
    expect(rulesOption(sit({ score: [1, 1], energy: 50 }))!.orders.every((o) => o.kind === "sub")).toBe(true)
  })
  it("makes no substitutions before half time", () => {
    expect(rulesOption(sit({ score: [1, 1], energy: 50, minute: 30 }))).toBeNull()
    expect(rulesOption(sit({ score: [0, 1], energy: 50, minute: 30 }))!.orders.every((o) => o.kind === "style")).toBe(true)
  })
  it("makes no substitutions without a window left, except at half time", () => {
    expect(rulesOption(sit({ score: [1, 1], energy: 50, windows: 0 }))).toBeNull()
    expect(rulesOption(sit({ score: [1, 1], energy: 50, windows: 0, halfTime: true }))).not.toBeNull()
  })
})

// Seed 14: the first from 11 on (12 is the mismatching log below) where the home side substitutes before a later decision
// and both teams decide at half time, minute 60 and minute 75 (P2: on seed 11 its only substitution came at its last
// decision, minute 75; P5 Task 14: seed 13 lost a minute-60 decision, seed 11 still fails; P6 Task 8: seed 11 has no home
// substitution, 13 qualifies again and 14 has none before a later decision; P6 pre-merge fixes: 13 lost a minute-60
// decision, 11 qualifies; P6 off-ball fix, movement.accelRule 1: 11 has no home substitution, 13's comes at its last
// decision, 14 qualifies).
const cfg = leagueConfig(14)
const seen: DecideInput[] = []
/** The rules manager, keeping every input it was given. */
const spy: Manager = { kind: "rules", decide: (input) => (seen.push(input), rulesManager.decide(input)) }
const managed = Effect.runSync(runManaged(cfg, { home: spy, away: rulesManager }, { models, xt }))

describe("a managed match", () => {
  it("logs a decision for each team at each key moment, each a valid decision line", () => {
    expect(managed.decisions.length).toBeGreaterThanOrEqual(6)
    for (const side of ["home", "away"] as const) {
      const reasons = managed.decisions.filter((d) => d.side === side).flatMap((d) => d.reasons)
      for (const r of ["half_time", "minute_60", "minute_75"]) expect(reasons).toContain(r)
    }
    for (const d of managed.decisions) expect(decodeDecision(d)).toEqual(d)
  })
  it("makes exactly the substitutions its managers ordered, within the laws' limits", () => {
    const subs = managed.events.filter((e) => e.type === "substitution")
    expect(subs.every((e) => e.attrs.reason === "manager")).toBe(true)
    const ordered = managed.decisions.flatMap((d) => d.orders_applied.filter((o) => o.kind === "sub"))
    expect(subs.map((e) => [e.player_id, e.attrs.player_on])).toEqual(ordered.map((o) => [(o as { off: string }).off, (o as { on: string }).on]))
    for (const team of [cfg.home.id, cfg.away.id]) expect(subs.filter((e) => e.team_id === team).length).toBeLessThanOrEqual(5)
  })
  it("shows a substitute's minutes since coming on, and later decisions see the changes already made", () => {
    const sub = managed.decisions.find((d) => d.side === "home" && d.orders_applied.some((o) => o.kind === "sub"))!
    const on = (sub.orders_applied.find((o) => o.kind === "sub") as { on: string }).on
    const later = seen.find((i) => i.state.tick > sub.tick)!
    const p = later.situation.players.on_pitch.find((x) => x.id === on)!
    expect(p.minutes_played).toBeCloseTo(later.situation.moment.minute - sub.minute, 0)
    expect(later.situation.players.bench.find((b) => b.id === on)!.available).toBe(false)
    expect(later.situation.limits.subs_left).toBe(5 - managed.decisions.filter((d) => d.side === "home" && d.tick <= sub.tick).flatMap((d) => d.orders_applied).filter((o) => o.kind === "sub").length)
  })
  it("replays bit-identically from its decision log, without any manager", () => {
    const replay = Effect.runSync(runManaged(cfg, { home: replayManager(managed.decisions), away: replayManager(managed.decisions) }, { models, xt }))
    expect(replay.events).toEqual(managed.events)
    expect(replay.decisions).toEqual(managed.decisions)
  })
  it("refuses to replay a log that does not fit the match", () => {
    const other = Effect.runSync(runManaged(leagueConfig(12), { home: rulesManager, away: rulesManager }, { models, xt }))
    expect(() => Effect.runSync(runManaged(cfg, { home: replayManager(other.decisions), away: replayManager(other.decisions) }, { models, xt }))).toThrow(ReplayMismatch)
  })
  it("with no manager is exactly the plain match", () => {
    const none = Effect.runSync(runManaged(cfg, {}, { models, xt }))
    let s = initMatch({ ...cfg, managed: undefined })
    const events: DomainEvent[] = []
    while (!isFinished(s)) {
      const r = step(s)
      s = r.state
      events.push(...r.events)
    }
    expect(none.events).toEqual(events)
    expect(none.decisions).toEqual([])
  })
})

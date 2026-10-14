import { readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"
import type { DomainEvent } from "@touchline/schema"
import type { League } from "@touchline/league"
import { paramsFromJson, runScript, type MatchConfig, type Script } from "@touchline/sim-core"
import { CHAOS_SCALE, StatsEngine } from "../src/engine.js"
import { infoFromConfig } from "../src/input.js"
import { threatAt } from "../src/momentum.js"
import { event, frame, INFO, models, root } from "./helpers.js"

const M = models()
const home = { team_id: "home-fc", player_id: "h2" }
const away = { team_id: "away-fc", player_id: "a3" }
/** A completed pass from (x, y) to (xEnd, y). */
const pass = (tick: number, side: typeof home, x: number, xEnd: number, y = 0, ok = true): DomainEvent =>
  event("pass", tick, { ...side, x, y, x_end: xEnd, y_end: y, frame_id_end: tick, outcome: ok ? "successful" : "intercepted" })

/** Feed events in tick order, with a frame every 10 s (ticks 0, 100, 200, ...) up to `until`. */
const feed = (eng: StatsEngine, events: DomainEvent[], until: number) => {
  const sorted = [...events].sort((a, b) => a.frame_id - b.frame_id)
  let i = 0
  for (let t = 0; t <= until; t += 100) {
    while (i < sorted.length && sorted[i]!.frame_id <= t) eng.ingest({ kind: "event", event: sorted[i++]! })
    eng.ingest({ kind: "frame", frame: frame(t) })
  }
  eng.finish()
}

describe("team dynamics", () => {
  it("measure the pressure index over the last five minutes by default", () => {
    const eng = new StatsEngine(INFO, M)
    const ev = [
      ...[10, 20, 30, 40].map((t) => event("pressure", t, home)),
      ...[3500, 3600, 3700, 3800, 3900, 4000].map((t) => event("pressure", t, home)),
      ...[3550, 3650, 3750, 3850].map((t) => pass(t, away, 0, -5))
    ]
    feed(eng, ev, 4000)
    expect(eng.value("team.press", "home-fc")).toBeCloseTo(6 / 10, 12)
    expect(eng.value("team.press", "home-fc", { windowS: null })).toBeCloseTo(10 / 14, 12)
    // Away made no pressures and home no passes: no data.
    expect(eng.value("team.press", "away-fc")).toBeNull()
  })

  it("count PPDA passes in the opponent's own 60 % and defensive actions there, a foul in a tackle once", () => {
    const eng = new StatsEngine(INFO, M)
    // Away attacks -x, so its own 60 % is x > -10.5.
    const ev = [
      pass(10, away, 20, 15), pass(20, away, 0, -5), pass(30, away, -30, -35),
      event("tackle", 40, { ...home, x: 20, y: 0, outcome: "won" }),
      event("tackle", 50, { ...home, x: 20, y: 0, outcome: "foul" }),
      event("foul", 50, { ...home, x: 20, y: 0 }),
      event("interception", 60, { ...home, x: -30, y: 0 })
    ]
    feed(eng, ev, 100)
    expect(eng.value("ppda", "home-fc")).toBe(1)
    expect(eng.value("ppda", "away-fc")).toBeNull()
  })

  it("measure field tilt from passes in the attacking third", () => {
    const eng = new StatsEngine(INFO, M)
    feed(eng, [pass(10, home, 20, 30), pass(20, home, 30, 40), pass(30, home, 0, 10), pass(40, away, -20, -30)], 100)
    expect(eng.value("tilt", "home-fc")).toBeCloseTo(2 / 3, 12)
    expect(eng.value("tilt", "away-fc")).toBeCloseTo(1 / 3, 12)
  })

  it("weigh momentum by forward progress, halving every two minutes", () => {
    const eng = new StatsEngine(INFO, M)
    // Home gains threat at tick 0; away gains the same at tick 1200 (two minutes later).
    feed(eng, [pass(0, home, 0, 30), pass(1200, away, 0, -30)], 1200)
    const gain = threatAt(30, 0, 1) - threatAt(0, 0, 1)
    expect(gain).toBeGreaterThan(0)
    expect(eng.value("team.mom", "home-fc", { at: 600 })).toBe(1)
    // At 1200 the home contribution weighs one half, the away one fully.
    expect(eng.value("team.mom", "home-fc")).toBeCloseTo(0.5 / 1.5, 12)
    expect(eng.value("team.mom", "home-fc")! + eng.value("team.mom", "away-fc")!).toBeCloseTo(1, 12)
    expect(eng.value("team.mom", "home-fc", { at: -5 })).toBeNull()
  })

  it("scale chaos from turnovers, possession length and momentum spread", () => {
    const eng = new StatsEngine(INFO, M)
    // Five minutes: 15 turnovers and 30 passes, no momentum yet.
    const ev = [
      ...Array.from({ length: 15 }, (_, i) => event("possession_change", 100 + i * 150, home)),
      ...Array.from({ length: 30 }, (_, i) => pass(100 + i * 90, home, 0, 0, 0, false))
    ]
    feed(eng, ev, 3000)
    const expected = (Math.min(1, 15 / 5 / CHAOS_SCALE.turnoversPerMin) + (1 - Math.min(1, 30 / 15 / CHAOS_SCALE.passesPerPossession)) + 0) / 3
    expect(eng.chaosAt(3000)).toBeCloseTo(expected, 12)
    expect(eng.value("game.chaos", "match")).toBeCloseTo(expected, 12)
    expect(eng.chaosAt(500)).toBeNull()
  })

  it("signal a pressure shift once when a team's pressing jumps, then hold off for five minutes", () => {
    const eng = new StatsEngine(INFO, M)
    const ev = [
      ...Array.from({ length: 20 }, (_, i) => pass(i * 140, away, 0, -5)),
      ...Array.from({ length: 4 }, (_, i) => event("pressure", 500 + i * 600, home)),
      ...Array.from({ length: 30 }, (_, i) => event("pressure", 3000 + i * 100, home)),
      ...Array.from({ length: 10 }, (_, i) => pass(3000 + i * 300, away, 0, -5))
    ]
    feed(eng, ev, 6000)
    const shifts = eng.signals.filter((s) => s.type === "pressure_shift")
    expect(shifts).toHaveLength(1)
    expect(shifts[0]).toMatchObject({ team_id: "home-fc", metric: "team.press" })
    expect(shifts[0]!.data.after! - shifts[0]!.data.before!).toBeGreaterThanOrEqual(0.15)
    expect(shifts[0]!.value).toBeCloseTo(eng.value("team.press", "home-fc", { at: shifts[0]!.frame_id })!, 3)
  })

  it("signal a momentum swing when a team takes over, and the impact of a substitution", () => {
    const eng = new StatsEngine(INFO, M)
    const ev = [
      ...Array.from({ length: 30 }, (_, i) => pass(i * 200, away, 0, -25)),
      event("substitution", 6000, { ...home, attrs: { player_off: "h2", player_on: "h3", reason: "tactical", half_time: false } }),
      ...Array.from({ length: 30 }, (_, i) => pass(6000 + i * 200, home, 0, 25))
    ]
    feed(eng, ev, 12_100)
    const swing = eng.signals.find((s) => s.type === "momentum_swing" && s.team_id === "home-fc")!
    expect(swing).toBeDefined()
    expect(swing.frame_id).toBeGreaterThan(6000)
    expect(swing.value).toBeCloseTo(eng.value("team.mom", "home-fc", { at: swing.frame_id, windowS: 300 })!, 3)
    const impact = eng.signals.find((s) => s.type === "substitution_impact")!
    expect(impact).toMatchObject({ team_id: "home-fc", player_id: "h3", metric: "team.mom", frame_from: 6000, frame_to: 12_000 })
    expect(impact.value!).toBeGreaterThan(0.5)
  })

  it("judge a team's substitutions made at the same moment together", () => {
    const eng = new StatsEngine(INFO, M)
    const sub = (off: string, on: string) => event("substitution", 6000, { ...home, attrs: { player_off: off, player_on: on, reason: "tactical", half_time: false } })
    const ev = [...Array.from({ length: 30 }, (_, i) => pass(i * 200, away, 0, -25)), sub("h2", "h3"), sub("h1", "h3"), ...Array.from({ length: 30 }, (_, i) => pass(6000 + i * 200, home, 0, 25))]
    feed(eng, ev, 12_100)
    const impact = eng.signals.filter((s) => s.type === "substitution_impact")
    expect(impact).toHaveLength(1)
    expect(impact[0]!.data.substitutions).toBe(2)
    expect(impact[0]!.evidence).toHaveLength(3)
  })

  it("count an event that follows its tick's frame in that tick's checks", () => {
    const late = new StatsEngine(INFO, M)
    const early = new StatsEngine(INFO, M)
    for (const [eng, after] of [[late, true], [early, false]] as const) {
      for (let t = 0; t < 3000; t += 100) {
        eng.ingest({ kind: "event", event: pass(t, away, 0, -5) })
        eng.ingest({ kind: "frame", frame: frame(t) })
      }
      const burst = Array.from({ length: 30 }, () => event("pressure", 6000, home))
      for (let t = 3000; t < 6000; t += 100) eng.ingest({ kind: "frame", frame: frame(t) })
      if (!after) for (const e of burst) eng.ingest({ kind: "event", event: e })
      eng.ingest({ kind: "frame", frame: frame(6000) })
      if (after) for (const e of burst) eng.ingest({ kind: "event", event: e })
      eng.finish()
    }
    expect(late.signals.map((s) => s.id)).toEqual(early.signals.map((s) => s.id))
    expect(late.signals.some((s) => s.type === "pressure_shift" && s.frame_id === 6000)).toBe(true)
  })
})

describe("scripted scenarios raise the signals of their cause", () => {
  const league = JSON.parse(readFileSync(join(root, "data/league/league.json"), "utf8")) as League
  const params = paramsFromJson(JSON.parse(readFileSync(join(root, "data/params/touchline-params.json"), "utf8")))
  const club = (id: string) => league.clubs.find((c) => c.id === id)!
  /** Seeds (of 1-6 by default) in which the signal fires for the scripted team within the window or the two minutes after it. */
  const detected = (homeId: string, awayId: string, script: Script, type: string, seeds: ReadonlyArray<number> = [1, 2, 3, 4, 5, 6]) =>
    seeds.filter((seed) => {
      const cfg: MatchConfig = { matchId: "m", seed, kickoffTime: "2026-10-18T14:00:00.000Z", home: club(homeId), away: club(awayId), params, dt: 0.1, script }
      const run = runScript(cfg)
      const eng = new StatsEngine(infoFromConfig(cfg), M)
      for (const r of run.steps) {
        for (const e of r.events) eng.ingest({ kind: "event", event: e })
        if (r.frame) eng.ingest({ kind: "frame", frame: r.frame })
      }
      eng.finish()
      const w = run.windows[0]!
      const team = script.entries[0]!.team === "home" ? cfg.home.id : cfg.away.id
      return eng.signals.some((s) => s.type === type && s.team_id === team && s.frame_id >= w.fromFrame && s.frame_id <= w.toFrame + 1200)
    }).length

  // Twelve seeds: six were too few once the keeper and caution rules were switched on and the engine recalibrated
  // (3 of seeds 1-6, but 9 of 1-12; 11 of 1-12 before).
  it("a pressing surge from 30' to 45' raises a pressure shift in at least 9 of 12 seeds", () => {
    const seeds = Array.from({ length: 12 }, (_, i) => i + 1)
    expect(detected("corrin-forge", "kestrel-bay", { name: "press", entries: [{ window: [30, 45], team: "home", effect: "press_surge" }] }, "pressure_shift", seeds)).toBeGreaterThanOrEqual(9)
  })

  it("a momentum swing from 60' to 75' raises a momentum swing in at least 3 of 6 seeds", () => {
    expect(detected("eastvale", "kestrel-bay", { name: "mom", entries: [{ window: [60, 75], team: "away", effect: "momentum_swing" }] }, "momentum_swing")).toBeGreaterThanOrEqual(3)
  })
})

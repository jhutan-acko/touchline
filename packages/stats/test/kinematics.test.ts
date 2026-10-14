import { readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"
import { initMatch, isFinished, paramsFromJson, step } from "@touchline/sim-core"
import { makeConfig } from "@touchline/sim-core/testing"
import { StatsEngine, StatsError } from "../src/engine.js"
import { infoFromConfig } from "../src/input.js"
import { event, frame, INFO, models, root } from "./helpers.js"

/** Player h2 runs along x at `speeds[i]` m/s during second i (10 ticks per second). */
const run = (eng: StatsEngine, speeds: number[], startTick = 0) => {
  let x = -10
  let tick = startTick
  eng.ingest({ kind: "frame", frame: frame(tick, { h2: { x, y: 5 } }) })
  for (const v of speeds)
    for (let k = 0; k < 10; k++) {
      x += v / 10
      eng.ingest({ kind: "frame", frame: frame(++tick, { h2: { x, y: 5 } }) })
    }
  return tick
}

describe("kinematics", () => {
  it("measure distance and top speed from positions", () => {
    const eng = new StatsEngine(INFO, models())
    run(eng, Array(10).fill(8))
    expect(eng.value("plyr.dist", "h2")).toBeCloseTo(80, 9)
    expect(eng.value("plyr.dist", "home-fc")).toBeCloseTo(80, 9)
    expect(eng.value("plyr.dist", "h3")).toBe(0)
    expect(eng.value("plyr.vmax", "h2")).toBeCloseTo(28.8, 9)
    expect(eng.value("plyr.vmax", "h3")).toBe(0)
    expect(eng.signals).toEqual([])
  })

  it("restrict distance and top speed to a window", () => {
    const eng = new StatsEngine(INFO, models())
    run(eng, [...Array(5).fill(9), ...Array(5).fill(2)])
    expect(eng.value("plyr.dist", "h2", { windowS: 3 })).toBeCloseTo(6, 9)
    expect(eng.value("plyr.vmax", "h2", { windowS: 3 })).toBeCloseTo(7.2, 9)
    expect(eng.value("plyr.vmax", "h2")).toBeCloseTo(32.4, 9)
  })

  it("measure the same speeds and distances at 25 frames per second", () => {
    const eng = new StatsEngine({ ...INFO, dt: 0.04 }, models())
    let x = -10
    eng.ingest({ kind: "frame", frame: frame(0, { h2: { x, y: 5 } }) })
    // 5 s at 8 m/s, 5 s at 9.2 m/s, then standing still.
    for (let t = 1; t <= 300; t++) {
      if (t <= 250) x += (t <= 125 ? 8 : 9.2) * 0.04
      eng.ingest({ kind: "frame", frame: frame(t, { h2: { x, y: 5 } }) })
    }
    expect(eng.ticks(10)).toBe(250)
    expect(eng.value("plyr.dist", "h2")).toBeCloseTo(5 * 8 + 5 * 9.2, 9)
    expect(eng.value("plyr.dist", "h2", { at: 250, windowS: 2 })).toBeCloseTo(2 * 9.2, 9)
    expect(eng.value("plyr.vmax", "h2")).toBeCloseTo(9.2 * 3.6, 9)
    expect(eng.signals.filter((s) => s.type === "speed_alert").map((s) => s.value)).toEqual([33.1])
  })

  it("ignore jumps between frames (half-time resets, substitutions)", () => {
    const eng = new StatsEngine(INFO, models())
    eng.ingest({ kind: "frame", frame: frame(0, { h2: { x: 0, y: 0 } }) })
    eng.ingest({ kind: "frame", frame: frame(1, { h2: { x: 30, y: 0 } }) })
    eng.ingest({ kind: "frame", frame: frame(5, { h2: { x: 30.5, y: 0 } }) })
    expect(eng.value("plyr.dist", "h2")).toBe(0)
  })

  it("alert once per sprint over 30 km/h, at its peak, and again only for a faster one", () => {
    const eng = new StatsEngine(INFO, models())
    const end = run(eng, [6, 9, 9.2, 9, 5, 9, 9, 5, 9.5, 9.5, 4])
    const alerts = eng.signals.filter((s) => s.type === "speed_alert")
    expect(alerts.map((s) => s.value)).toEqual([33.1, 34.2])
    expect(alerts[0]).toMatchObject({ player_id: "h2", team_id: "home-fc", metric: "plyr.vmax", match_id: "t" })
    expect(alerts[0]!.frame_from).toBeLessThan(alerts[0]!.frame_to)
    expect(alerts[1]!.data.previous_best).toBe(33.1)
    expect(alerts[1]!.frame_id).toBeLessThanOrEqual(end)
  })

  it("raise distance milestones at 10 and 12 km", () => {
    const eng = new StatsEngine(INFO, models())
    // 7.5 m/s for 1,700 s covers 12.75 km.
    run(eng, Array(1700).fill(7.5))
    const m = eng.signals.filter((s) => s.type === "distance_milestone")
    expect(m.map((s) => [s.player_id, s.value])).toEqual([["h2", 10_000], ["h2", 12_000]])
  })

  it("measure possession over in-play time only", () => {
    const eng = new StatsEngine(INFO, models())
    for (let t = 0; t < 30; t++) eng.ingest({ kind: "frame", frame: frame(t, {}, { possession_side: t < 20 ? "home" : "away", ball_in_play: t % 10 !== 9 }) })
    expect(eng.value("team.poss", "home-fc")).toBeCloseTo(18 / 27, 9)
    expect(eng.value("team.poss", "away-fc")).toBeCloseTo(9 / 27, 9)
    expect(eng.value("team.poss", "away-fc", { at: 10 })).toBe(0)
  })

  it("refuse unknown subjects, metrics a subject does not have, and input out of order", () => {
    const eng = new StatsEngine(INFO, models())
    eng.ingest({ kind: "frame", frame: frame(5) })
    expect(() => eng.value("plyr.dist", "nobody")).toThrow(StatsError)
    expect(() => eng.value("plyr.vmax", "home-fc")).toThrow(/not defined for a team/)
    expect(() => eng.ingest({ kind: "frame", frame: frame(5) })).toThrow(/out of order/)
    expect(() => eng.ingest({ kind: "event", event: event("pressure", 4) })).toThrow(/out of order/)
    // An event of the frame's own tick may follow it (the simulator emits a carry cut short by the whistle that way).
    expect(() => eng.ingest({ kind: "event", event: event("pressure", 5) })).not.toThrow()
    expect(() => eng.ingest({ kind: "event", event: event("pressure", 6) })).not.toThrow()
    expect(() => eng.ingest({ kind: "frame", frame: frame(5) })).toThrow(/out of order/)
  })

  it("take a whole simulated match in emission order and give plausible totals", () => {
    // The committed parameters: the hand-set priors are not calibrated (with the fitted movement their players run ~14.5 km).
    const params = paramsFromJson(JSON.parse(readFileSync(join(root, "data/params/touchline-params.json"), "utf8")))
    const cfg = makeConfig(7, { params })
    const eng = new StatsEngine(infoFromConfig(cfg), models())
    let s = initMatch(cfg)
    const t0 = performance.now()
    while (!isFinished(s)) {
      const r = step(s)
      s = r.state
      for (const e of r.events) eng.ingest({ kind: "event", event: e })
      if (r.frame) eng.ingest({ kind: "frame", frame: r.frame })
    }
    const perTickMs = (performance.now() - t0) / eng.now
    const dists = cfg.home.starters.slice(1).map((p) => eng.value("plyr.dist", p.id)!)
    const median = [...dists].sort((a, b) => a - b)[5]!
    expect(median).toBeGreaterThan(8_000)
    expect(median).toBeLessThan(13_000)
    expect(eng.value("team.poss", cfg.home.id)! + eng.value("team.poss", cfg.away.id)!).toBeGreaterThan(0.95)
    expect(eng.value("ball.speed", "match")).not.toBeNull()
    // The hot path's budget is 250 ms per event; the engine costs far less than a millisecond per tick.
    expect(perTickMs).toBeLessThan(1)
  })
})

import { describe, expect, it } from "vitest"
import { StatsEngine } from "../src/engine.js"
import { xtAt } from "../src/xt.js"
import { event, frame, INFO, models, xtGrid } from "./helpers.js"

const M = models()
const XT = xtGrid()
const home = { team_id: "home-fc", player_id: "h2" }
const away = { team_id: "away-fc", player_id: "a3" }

describe("expected threat and pitch control", () => {
  it("credit completed passes and carries with the expected threat they add, for the player and the team", () => {
    const eng = new StatsEngine(INFO, M, XT)
    const pass = event("pass", 1, { ...home, x: 0, y: 0, x_end: 40, y_end: 0, frame_id_end: 1, outcome: "successful" })
    const lost = event("pass", 2, { ...home, x: 10, y: 0, x_end: 45, y_end: 0, frame_id_end: 2, outcome: "intercepted" })
    const carry = event("carry", 3, { ...away, x: 0, y: 0, x_end: -20, y_end: 5, frame_id_end: 3 })
    for (const e of [pass, lost, carry]) eng.ingest({ kind: "event", event: e })
    const gain = xtAt(XT, 40, 0, 1) - xtAt(XT, 0, 0, 1)
    expect(gain).toBeGreaterThan(0)
    expect(eng.value("act.xt", "h2")).toBeCloseTo(gain, 12)
    expect(eng.value("act.xt", "home-fc")).toBeCloseTo(gain, 12)
    expect(eng.value("act.xt", "away-fc")).toBeCloseTo(xtAt(XT, -20, 5, -1) - xtAt(XT, 0, 0, -1), 12)
    expect(eng.derived.get(pass.id)!["act.xt"]).toBeCloseTo(gain, 12)
    expect(eng.derived.get(lost.id)!["act.xt"]).toBeUndefined()
    expect(new StatsEngine(INFO, M).value("act.xt", "home-fc")).toBeNull()
  })

  it("measure each team's share of pitch control every 10 s and keep the maps", () => {
    const eng = new StatsEngine(INFO, M, XT)
    // Home spread over the pitch; away huddled in one corner.
    const spread = { h1: { x: -45, y: 0 }, h2: { x: 0, y: 20 }, h3: { x: 0, y: -20 }, a1: { x: 50, y: 30 }, a2: { x: 48, y: 32 }, a3: { x: 46, y: 30 } }
    for (let t = 0; t <= 101; t++) eng.ingest({ kind: "frame", frame: frame(t, spread) })
    expect(eng.value("pitch.ctrl", "home-fc", { at: 50 })).not.toBeNull()
    const homeShare = eng.value("pitch.ctrl", "home-fc")!
    expect(homeShare).toBeGreaterThan(0.75)
    expect(homeShare + eng.value("pitch.ctrl", "away-fc")!).toBeCloseTo(1, 12)
    expect(eng.value("pitch.ctrl", "home-fc", { windowS: 60 })).toBeCloseTo((eng.value("pitch.ctrl", "home-fc", { at: 0 })! + homeShare) / 2, 12)
    const map = eng.pitchControl(100)!
    expect(map).toMatchObject({ tick: 100, cols: 21, rows: 14 })
    expect(map.home).toHaveLength(294)
    expect(eng.pitchControl(99)!.tick).toBe(0)
    expect(new StatsEngine(INFO, M).pitchControl(5)).toBeNull()
  })
})

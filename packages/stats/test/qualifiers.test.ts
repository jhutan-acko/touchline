import { describe, expect, it } from "vitest"
import { StatsEngine } from "../src/engine.js"
import { QUALIFIERS, StatsQuery } from "../src/query.js"
import { event, frame, INFO, models } from "./helpers.js"

describe("event qualifiers", () => {
  it("carry what a broadcaster could see and never the script's ground truth", () => {
    const eng = new StatsEngine(INFO, models())
    eng.ingest({ kind: "frame", frame: frame(0) })
    const pass = event("pass", 0, {
      team_id: "home-fc", player_id: "h2", x: -10, y: 5, x_end: 0, y_end: 5, frame_id_end: 1, outcome: "intercepted",
      attrs: { execution: "mishit", under_pressure: true, scripted: true, fallback: false, best_receiver_id: "h3", intended_receiver_id: "h3", kind: "short" }
    })
    eng.ingest({ kind: "event", event: pass })
    eng.ingest({ kind: "frame", frame: frame(1) })
    const [view] = new StatsQuery(eng).eventsBetween(null, 1, { types: ["pass"] })
    expect(view!.qualifiers).toEqual({ execution: "mishit", under_pressure: true, intended_receiver_id: "h3", kind: "short" })
    expect(QUALIFIERS).not.toContain("scripted")
  })
})

import { describe, expect, it } from "vitest"
import type { Cue } from "@touchline/schema"
import { arcPoint, parseMarker, RING_RADIUS } from "../src/markers.js"

const marker = (template: string, data: Cue["data"], slot: Cue["display"]["slot"] = "pitch_marker"): Cue => ({
  cue_id: `pm-${template}`, schema: "touchline.cue/1", match_id: "m", moment_id: null,
  anchor: { frame_from: 100, frame_to: 100, clock: "10:00" }, display: { slot, priority: 2, ttl_ms: 8000, template },
  segment: { mode: "analyst", lang: "en", club: null }, text: null, data, evidence: [], verified: true
})

describe("pitch markers", () => {
  it("read a pressure ring's player and presser count", () => {
    expect(parseMarker(marker("pressure_ring", { "at:p-lar-09": 1, count: 3 }))).toEqual({ template: "pressure_ring", at: "p-lar-09", count: 3 })
  })

  it("read a pass arc's two ends", () => {
    expect(parseMarker(marker("pass_arc", { "from:p-nor-04": 1, "to:p-nor-10": 1 }))).toEqual({ template: "pass_arc", from: "p-nor-04", to: "p-nor-10" })
  })

  it("read a ghost at a point in pitch metres, or at a player", () => {
    expect(parseMarker(marker("ghost", { x: 12.5, y: -3 }))).toEqual({ template: "ghost", point: { x: 12.5, y: -3 } })
    expect(parseMarker(marker("ghost", { "at:p-nor-07": 1 }))).toEqual({ template: "ghost", at: "p-nor-07" })
  })

  it("ignore player keys whose value is not 1", () => {
    expect(parseMarker(marker("pressure_ring", { "at:p-a": 0, "at:p-b": 1, count: 2 }))?.at).toBe("p-b")
  })

  it("are null for a cue in another slot, an unknown template, or a marker missing its players", () => {
    expect(parseMarker(marker("pressure_ring", { "at:p-lar-09": 1 }, "lower_third"))).toBeNull()
    expect(parseMarker(marker("spotlight", { "at:p-lar-09": 1 }))).toBeNull()
    expect(parseMarker(marker("pass_arc", { "from:p-nor-04": 1 }))).toBeNull()
    expect(parseMarker(marker("pressure_ring", { count: 2 }))).toBeNull()
    expect(parseMarker(marker("ghost", { x: 3 }))).toBeNull()
  })

  it("draw rings 1.5 m across the player's feet and arcs raised between the two ends", () => {
    expect(RING_RADIUS).toBe(1.5)
    const a = { x: 0, y: 0, z: 0 }
    const b = { x: 20, y: 0, z: 0 }
    expect(arcPoint(a, b, 0)).toEqual([0, 0.1, 0])
    expect(arcPoint(a, b, 1)).toEqual([20, 0.1, 0])
    const mid = arcPoint(a, b, 0.5)
    expect(mid[0]).toBe(10)
    expect(mid[1]).toBeGreaterThan(2)
  })
})

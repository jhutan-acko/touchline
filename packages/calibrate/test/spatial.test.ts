import { describe, expect, it } from "vitest"
import type { Frame, FramePlayer, Side } from "@touchline/sim-core"
import { spatialMetrics } from "../src/metrics.js"

type Pt = readonly [number, number]
const HOME: Pt[] = [[-45, 0], [-5, -15], [0, 0], [5, 10]]
const AWAY: Pt[] = [[45, 0], [10, -10], [4, 0], [20, 12]]
const player = (side: string, i: number, [x, y]: Pt): FramePlayer => ({ id: `${side}-${i}`, x, y, vel: 0, intent: "shape" })
const frame = (frameId: number, o: { ball?: Pt; live?: boolean; poss?: Side | null } = {}): Frame => ({
  tick: frameId,
  frame_id: frameId,
  period: "first_half",
  timestamp: "",
  home: HOME.map((p, i) => player("h", i, p)),
  away: AWAY.map((p, i) => player("a", i, p)),
  ball: { x: (o.ball ?? [0, 0])[0], y: (o.ball ?? [0, 0])[1], z: 0 },
  ball_in_play: o.live ?? true,
  possession_side: o.poss === undefined ? "home" : o.poss
})

describe("spatial metrics", () => {
  it("measure shape, pressure, support and space once a second (same fixture as the Python test)", () => {
    const m = spatialMetrics([frame(0), frame(5, { ball: [40, 0] }), frame(10, { live: false }), frame(12, { poss: null })], 0.1)
    expect(m.width_poss_m).toBe(25)
    expect(m.width_def_m).toBe(22)
    expect(m.length_def_m).toBe(16)
    expect(m.line_height_def_m).toBe(32.5)
    expect(m.ball_pressure_m).toBe(4)
    expect(m.support_15m).toBe(1)
    expect(m.free_space_m).toBeCloseTo(Math.hypot(15, 5), 12)
  })
  it("are NaN without usable frames", () => {
    const m = spatialMetrics([], 0.1)
    expect(Object.values(m).every(Number.isNaN)).toBe(true)
  })
})

import { describe, expect, it } from "vitest"
import type { DomainEvent } from "@touchline/schema"
import { releaseSpeed, toBallEvent, type BallAt } from "../src/events.js"

const ev = (o: Partial<DomainEvent>): DomainEvent => ({
  id: "e1", match_id: "m", type: "pass", frame_id: 100, period_frame_id: 100, period: "first_half", match_clock: "00:10.00",
  team_id: "home-fc", player_id: "p-9", x: 0, y: 0, x_end: 20, y_end: 0, frame_id_end: 108, outcome: "successful",
  source: "sim", confidence: 1, attrs: { receiver_id: "p-10" }, ...o
})

describe("release speed", () => {
  const balls = new Map<number, BallAt>([
    [100, { tick: 100, x: 0, y: 0, z: 0 }],
    [101, { tick: 101, x: 2, y: 0, z: 0 }], // 20 m/s = 72 km/h at 10 fps
    [102, { tick: 102, x: 3.5, y: 0, z: 0 }],
    [103, { tick: 103, x: 60, y: 0, z: 0 }] // a jump, not a kick
  ])
  it("is the peak over consecutive frames, ignoring jumps", () => {
    expect(releaseSpeed(balls, 100, 103, 0.1)).toBeCloseTo(72, 6)
  })
  it("is null without two consecutive frames", () => {
    expect(releaseSpeed(balls, 200, 203, 0.1)).toBeNull()
  })
})

describe("ball events", () => {
  const o = { homeId: "home-fc", clock: "00:10.8", derived: { "pass.dist": 20.04, "pass.xp": 0.31234 }, speed: 61.27 }
  it("turns a pass into a tick at its arrival frame with its length, xPass and speed", () => {
    expect(toBallEvent(ev({}), o)).toEqual({
      id: "e1", frame: 108, clock: "00:10.8", type: "pass", team: "home", player_id: "p-9", receiver_id: "p-10", outcome: "success",
      x: 0, y: 0, x_end: 20, y_end: 0, length_m: 20, xpass: 0.312, speed_kmh: 61.3, xg: null
    })
  })
  it("maps a shot's outcome, xG and the engine's shot speed", () => {
    const shot = toBallEvent(ev({ type: "shot", team_id: "away-fc", outcome: "wide", attrs: {} }), { ...o, derived: { "shot.xg": 0.1234, "shot.speed": 96.04 } })
    expect(shot).toMatchObject({ type: "shot", team: "away", outcome: "off_target", xg: 0.123, speed_kmh: 96, xpass: null, receiver_id: null })
  })
  it("leaves out events the stream does not carry", () => {
    expect(toBallEvent(ev({ type: "foul" }), o)).toBeNull()
    expect(toBallEvent(ev({ player_id: null }), o)).toBeNull()
  })
})

import { describe, expect, it } from "vitest"
import type { PitchFrame } from "@touchline/rpc"
import { findKicks, KICK_S, KICK_STRIKE, kickAt, kickPose, keyAt, KICK_KEYS } from "../src/view3d/kick.js"
import { between, blendGaits, gaitOf, gaitRate, LiveBuffer, MAX_DELAY_MS, MIN_DELAY_MS, sampleClip, toWorld, turnToward, wantedYaw, yawOf } from "../src/view3d/motion.js"

/** A frame with one player each side and the ball. */
const frame = (n: number, a: [number, number], b: [number, number], ball: [number, number, number] = [0, 0, 0]): PitchFrame => ({
  frame: n, period: "first_half", clock: "00:00.00", ball: { x: ball[0], y: ball[1], z: ball[2] }, home: [{ id: "h", x: a[0], y: a[1] }], away: [{ id: "a", x: b[0], y: b[1] }]
})

describe("pitch to world", () => {
  it("keeps metres: x along, height up, pitch y toward the viewer's -z", () => {
    expect(toWorld(10, 5, 2)).toEqual([10, 2, -5])
    expect(toWorld(-52.5, 0)).toEqual([-52.5, 0, -0])
  })
})

describe("interpolation", () => {
  it("places players and the ball between two frames, with velocity from the move between them", () => {
    const s = between(frame(10, [0, 0], [5, 5], [0, 0, 0]), frame(12, [1, 0], [5, 3], [2, 0, 1]), 0.25, 10)
    expect(s.frame).toBe(10.5)
    expect(s.ball).toEqual({ x: 0.5, y: 0, z: 0.25 })
    expect(s.players.get("h")).toEqual({ x: 0.25, y: 0, vx: 5, vy: 0 }) // 1 m in 0.2 s
    expect(s.players.get("a")).toEqual({ x: 5, y: 4.5, vx: 0, vy: -10 })
  })

  it("holds a player who left the pitch where they were", () => {
    const b = { ...frame(11, [1, 0], [0, 0]), away: [] }
    expect(between(frame(10, [0, 0], [3, 3]), b, 0.5, 10).players.get("a")).toEqual({ x: 3, y: 3, vx: 0, vy: 0 })
  })

  it("samples a clip at a fractional index and holds at its ends", () => {
    const clip = [frame(0, [0, 0], [0, 0]), frame(1, [1, 0], [0, 0]), frame(2, [3, 0], [0, 0])]
    expect(sampleClip(clip, 1.5, 10)!.players.get("h")!.x).toBe(2)
    expect(sampleClip(clip, -4, 10)!.players.get("h")!.x).toBe(0)
    expect(sampleClip(clip, 9, 10)!.players.get("h")!.x).toBe(3)
    expect(sampleClip([], 0, 10)).toBeNull()
  })
})

describe("live frames", () => {
  it("play a little behind the newest frame, between the two around that time", () => {
    const b = new LiveBuffer(10)
    expect(b.sample(0)).toBeNull()
    for (let i = 0; i < 10; i++) b.push(frame(i, [i, 0], [0, 0]), i * 40) // every 40 ms
    expect(b.delay).toBe(MIN_DELAY_MS)
    const s = b.sample(360 + 20)! // 80 ms behind 380 ms: 300 ms, between frames 7 and 8 at a half
    expect(s.frame).toBeCloseTo(7.5)
    expect(s.players.get("h")!.x).toBeCloseTo(7.5)
  })

  it("wait longer when frames come further apart, within a limit", () => {
    const slow = new LiveBuffer(10)
    for (let i = 0; i < 10; i++) slow.push(frame(i, [0, 0], [0, 0]), i * 100)
    expect(slow.delay).toBe(150)
    const stalled = new LiveBuffer(10)
    for (let i = 0; i < 10; i++) stalled.push(frame(i, [0, 0], [0, 0]), i * 2000)
    expect(stalled.delay).toBe(MAX_DELAY_MS)
  })

  it("hold the newest frame, standing, when no newer one comes; ignore repeats; start afresh on a seek back", () => {
    const b = new LiveBuffer(10)
    b.push(frame(5, [0, 0], [0, 0]), 0)
    b.push(frame(6, [1, 0], [0, 0]), 40)
    b.push(frame(6, [9, 9], [0, 0]), 50)
    expect(b.frames.map((f) => f.frame)).toEqual([5, 6])
    expect(b.sample(10_000)!.players.get("h")).toEqual({ x: 1, y: 0, vx: 0, vy: 0 })
    b.push(frame(2, [0, 0], [0, 0]), 60)
    expect(b.frames.map((f) => f.frame)).toEqual([2])
  })

  it("keep a bounded number of frames", () => {
    const b = new LiveBuffer(10, 4)
    for (let i = 0; i < 10; i++) b.push(frame(i, [0, 0], [0, 0]), i * 40)
    expect(b.frames.map((f) => f.frame)).toEqual([6, 7, 8, 9])
  })
})

describe("facing and gait", () => {
  it("faces where a player runs, or the ball when standing", () => {
    expect(yawOf(0, -1)).toBe(0)
    expect(wantedYaw({ x: 0, y: 0, vx: 3, vy: 0 }, { x: -10, y: 0 })).toBeCloseTo(Math.PI / 2)
    expect(wantedYaw({ x: 0, y: 0, vx: 0.1, vy: 0 }, { x: -10, y: 0 })).toBeCloseTo(-Math.PI / 2)
    expect(wantedYaw({ x: 0, y: 0, vx: 0, vy: 0 }, { x: 0, y: 0 })).toBeNull()
  })

  it("turns the short way round, eased, never past the target", () => {
    expect(turnToward(3, -3, 0.1, 5)).toBeGreaterThan(3) // across ±π, not back through 0
    expect(turnToward(0, 1, 10, 5)).toBe(1)
    expect(turnToward(0, 1, 0.1, 5)).toBeCloseTo(0.5)
  })

  it("picks the clip by speed and plays it at the speed run, within natural limits", () => {
    expect([0, 0.6, 3, 8].map(gaitOf)).toEqual(["Idle_Loop", "Walk_Loop", "Jog_Fwd_Loop", "Sprint_Loop"])
    expect(gaitRate("Sprint_Loop", 7)).toBe(1)
    expect(gaitRate("Jog_Fwd_Loop", 10)).toBe(1.5)
    expect(gaitRate("Walk_Loop", 0.5)).toBe(0.6)
    expect(gaitRate("Idle_Loop", 0)).toBe(1)
  })

  it("blends clip weights toward the target, summing to one", () => {
    let w = { Idle_Loop: 1, Walk_Loop: 0, Jog_Fwd_Loop: 0, Sprint_Loop: 0 }
    w = blendGaits(w, "Sprint_Loop", 0.1)
    expect(w.Sprint_Loop).toBeCloseTo(0.6)
    expect(Object.values(w).reduce((a, v) => a + v, 0)).toBeCloseTo(1)
    expect(blendGaits(w, "Sprint_Loop", 1).Sprint_Loop).toBe(1)
  })
})

describe("kicks", () => {
  /** The ball rolls slowly to the home player, who plays it away fast along +x. */
  const pass = (step = 1): PitchFrame[] =>
    Array.from({ length: 12 }, (_, i) => i * step).map((n) => {
      const after = n > 5
      const bx = after ? 0.3 + (n - 5) * 1.5 : -1.2 + n * 0.3
      return frame(n, [0, 0.5], [20, 0], [bx, 0, 0])
    })

  it("are found where the ball speeds up beside a player, squared up to where it goes", () => {
    const [k, ...rest] = findKicks(pass(), 10)
    expect(rest).toHaveLength(0)
    expect(k!.player_id).toBe("h")
    expect(k!.start).toBeCloseTo(5 - KICK_STRIKE * KICK_S * 10)
    expect(k!.yaw).toBeCloseTo(Math.PI / 2)
    expect(kickAt([k!], "h", 5, 10)!.t).toBeCloseTo(KICK_STRIKE)
    expect(kickAt([k!], "a", 5, 10)).toBeNull()
    expect(kickAt([k!], "h", 5 + KICK_S * 10, 10)).toBeNull()
  })

  it("are found the same when frames skip, and not when nobody is near the ball", () => {
    expect(findKicks(pass(2), 10).map((k) => k.player_id)).toEqual(["h"])
    const alone = pass().map((f) => ({ ...f, home: [{ id: "h", x: 0, y: 9 }] }))
    expect(findKicks(alone, 10)).toEqual([])
  })

  it("wind up, strike and follow through, and leave the body as it was at either end", () => {
    expect(keyAt(KICK_KEYS.thigh, 0.3)).toBeCloseTo((-35 * Math.PI) / 180)
    expect(keyAt(KICK_KEYS.thigh, 0.65)).toBeCloseTo((75 * Math.PI) / 180)
    for (const t of [0, 1, -0.1, 1.2]) for (const v of Object.values(kickPose(t))) expect(v).toBeCloseTo(0)
    expect(kickPose(0.65).thigh).toBeCloseTo((-75 * Math.PI) / 180) // the rig's sign
  })
})

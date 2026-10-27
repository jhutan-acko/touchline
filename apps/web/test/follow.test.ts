import { describe, expect, it } from "vitest"
import type { PitchFrame } from "@touchline/rpc"
import type { BallEvent, WatchTick } from "../src/events.js"
import { isEventTick } from "../src/events.js"
import { FOLLOW_EMPTY, followReduce, playerStats, type FollowState } from "../src/follow.js"
import { RING_S } from "../src/pane.js"

const FPS = 10

/** A frame with the striker at (x, 0) and the keeper standing still. */
const frame = (n: number, x: number): PitchFrame => ({
  frame: n, period: "first_half", clock: "10:00.00", ball: { x: 0, y: 0, z: 0 },
  home: [{ id: "gk", x: -50, y: 0 }], away: [{ id: "st", x, y: 0 }]
})

const ev = (o: Partial<BallEvent> & Pick<BallEvent, "id" | "frame">): BallEvent => ({
  clock: "10:00", type: "pass", team: "away", player_id: "st", receiver_id: null, outcome: "success",
  x: 0, y: 0, x_end: null, y_end: null, length_m: null, xpass: null, speed_kmh: null, xg: null, ...o
})

const run = (ticks: ReadonlyArray<WatchTick>, s: FollowState = FOLLOW_EMPTY) => ticks.reduce((a, t) => followReduce(a, t, FPS), s)
/** Frames from..to with the striker moving `mPerFrame` each frame from x = 0 at frame `from`. */
const jog = (from: number, to: number, mPerFrame: number, x0 = 0): WatchTick[] =>
  Array.from({ length: to - from + 1 }, (_, i) => ({ kind: "frame", frame: frame(from + i, x0 + i * mPerFrame) }))

describe("following a player: running", () => {
  it("adds up the distance from the frames and finds the top speed over a one-second window", () => {
    // 5 m/s (18 km/h) for 2 s, then 8 m/s (28.8 km/h) for 2 s.
    const s = run([...jog(0, 20, 0.5), ...jog(21, 40, 0.8, 10.8)])
    const st = playerStats(s, "st", 40, FPS)
    expect(st.km! * 1000).toBeCloseTo(10 + 0.8 + 19 * 0.8, 5)
    expect(st.topKmh).toBeCloseTo(28.8, 5)
    expect(st.kmh).toBeCloseTo(28.8, 5)
    expect(playerStats(s, "gk", 40, FPS)).toMatchObject({ km: 0, topKmh: 0 })
  })

  it("does not count jumps (resets) or steps across a gap, and keeps going after them", () => {
    const s = run([...jog(0, 10, 0.5), { kind: "frame", frame: frame(11, 40) }, ...jog(12, 14, 0.5, 40.5), { kind: "frame", frame: frame(40, 60) }, { kind: "frame", frame: frame(41, 60.5) }])
    expect(playerStats(s, "st", 41, FPS).km! * 1000).toBeCloseTo(5 + 1.5 + 0.5, 5)
    expect(playerStats(s, "st", 41, FPS).topKmh!).toBeLessThan(20)
  })

  it("reads the totals as of a frame (a frozen view), and none once that frame is older than the history", () => {
    const s = run(jog(0, 20, 0.5))
    expect(playerStats(s, "st", 10, FPS).km! * 1000).toBeCloseTo(5, 5)
    expect(playerStats(s, "st", 10, FPS).topKmh).toBeCloseTo(18, 5)
    const long = run(jog(0, (RING_S + 5) * FPS, 0.1))
    expect(long.marks.length).toBeLessThanOrEqual((RING_S + 1) * FPS + 1)
    expect(playerStats(long, "st", 2 * FPS, FPS).km).toBeNull()
    expect(playerStats(long, "st", (RING_S + 5) * FPS, FPS).km).toBeCloseTo(((RING_S + 5) * FPS * 0.1) / 1000, 6)
  })

  it("a speed needs half a second of history; repeated frames change nothing", () => {
    const s = run(jog(0, 3, 0.5))
    expect(playerStats(s, "st", 3, FPS).kmh).toBeNull()
    expect(run([{ kind: "frame", frame: frame(3, 99) }], s)).toBe(s)
  })
})

describe("following a player: on-ball events", () => {
  const events: BallEvent[] = [
    ev({ id: "e1", frame: 5, xpass: 0.9 }),
    ev({ id: "e2", frame: 8, outcome: "fail", xpass: 0.5 }),
    ev({ id: "e3", frame: 12, type: "carry", outcome: null }),
    ev({ id: "e4", frame: 15, type: "shot", outcome: "goal", xg: 0.3 }),
    ev({ id: "e5", frame: 18, xpass: 0.7 }),
    ev({ id: "x1", frame: 9, player_id: "gk", team: "home" }),
    ev({ id: "e6", frame: 30, type: "tackle" })
  ]
  const ticks: WatchTick[] = events.map((event) => ({ kind: "event", event }))

  it("counts passes, accuracy, shots and pass difficulty, only up to the frame", () => {
    const s = run(ticks)
    const st = playerStats(s, "st", 20, FPS)
    expect(st.passes).toEqual({ done: 2, tried: 3 })
    expect(st.accuracy).toBeCloseTo(66.667, 2)
    expect(st.shots).toBe(1)
    expect(st.goals).toBe(1)
    expect(st.difficulty).toBeCloseTo((100 * (0.1 + 0.5 + 0.3)) / 3, 6)
    const frozen = playerStats(s, "st", 10, FPS)
    expect(frozen.passes).toEqual({ done: 1, tried: 2 })
    expect(frozen.shots).toBe(0)
    expect(frozen.moments.map((e) => e.id)).toEqual(["e2", "e1"])
  })

  it("lists the last three involvements newest first, without carries", () => {
    const st = playerStats(run(ticks), "st", 40, FPS)
    expect(st.moments.map((e) => e.id)).toEqual(["e6", "e5", "e4"])
  })

  it("keeps each event once, in frame order, whatever order they come in", () => {
    const s = run([...ticks].reverse().concat(ticks))
    expect(s.events.map((e) => e.id)).toEqual(["e1", "e2", "x1", "e3", "e4", "e5", "e6"])
  })

  it("no passes: no accuracy or difficulty", () => {
    expect(playerStats(FOLLOW_EMPTY, "st", 10, FPS)).toMatchObject({ km: null, accuracy: null, difficulty: null, shots: 0, moments: [] })
  })

  it("ignores other ticks and malformed events", () => {
    const s = run([{ kind: "playback", playback: { state: "playing", frame: 1, speed: 1, live: false } }])
    expect(s).toBe(FOLLOW_EMPTY)
    expect(isEventTick({ kind: "event" })).toBe(false)
    expect(isEventTick({ kind: "event", event: { id: "a" } } as never)).toBe(false)
    expect(run([{ kind: "event", event: { id: 1 } } as never])).toBe(FOLLOW_EMPTY)
  })
})

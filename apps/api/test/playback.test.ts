import { Effect, Fiber, Stream, SubscriptionRef } from "effect"
import { TestClock } from "effect/testing"
import { beforeAll, describe, expect, it } from "vitest"
import { readMatch, type LibraryMatch } from "../src/library.js"
import { beats, paced, type Beat, type Control } from "../src/playback.js"
import { league, makeLibrary, type TestLibrary } from "./fixture.js"

let lib: TestLibrary
let match: LibraryMatch
let all: Beat[]
beforeAll(async () => {
  lib = await makeLibrary()
  match = readMatch(lib.run, league)
  all = [...(await Effect.runPromise(Stream.runCollect(beats(match))))]
}, 180_000)

const frames = (bs: Beat[]) => bs.filter((b) => b.kind === "frame")

describe("timeline", () => {
  it("has every frame, a scoreboard each second ending on the final score, and an end", () => {
    expect(frames(all)).toHaveLength(match.info.frames)
    const boards = all.flatMap((b) => (b.kind === "board" ? [b.board] : []))
    expect(boards.length).toBeGreaterThan(5000)
    expect(boards[boards.length - 1]!.score).toEqual(match.info.score)
    expect(boards.at(-1)!.momentum!.home + boards.at(-1)!.momentum!.away).toBeCloseTo(1, 6)
    expect(all.at(-1)!.kind).toBe("end")
  })

  it("brings each cached moment's variants together right after the frame it ends on", () => {
    const groups = all.flatMap((b, i) => (b.kind === "cues" ? [{ b, prev: all[i - 1]! }] : []))
    expect(groups.map((g) => g.b.kind === "cues" && g.b.cues.length)).toEqual([3, 1, 3]) // goal, half-time card, goal
    for (const { b, prev } of groups) {
      if (b.kind !== "cues") continue
      expect(prev.kind === "frame" || prev.kind === "board" || prev.kind === "signals").toBe(true)
      expect(b.cues.every((c) => c.anchor.frame_to === b.frame)).toBe(true)
    }
  })

  it("puts a goal on the scoreboard at once, not at the next whole second", () => {
    const boards = all.flatMap((b) => (b.kind === "board" ? [b.board] : []))
    const changes = boards.filter((b, i) => i > 0 && b.score.home + b.score.away > boards[i - 1]!.score.home + boards[i - 1]!.score.away)
    expect(changes.length).toBe(match.info.score.home + match.info.score.away)
    for (const [i, goal] of lib.goals.entries()) expect(Math.abs(changes[i]!.frame - goal.frame_id)).toBeLessThanOrEqual(1)
  })

  it("marks the first scoreboard after each goal with the goal's frame, so its latency can be timed", () => {
    const marked = all.flatMap((b) => (b.kind === "board" && b.goal !== undefined ? [b.goal] : []))
    expect(marked.length).toBe(match.info.score.home + match.info.score.away)
    for (const [i, goal] of lib.goals.entries()) expect(Math.abs(marked[i]! - goal.frame_id)).toBeLessThanOrEqual(1)
  })

  it("passes on the stats engine's signals (goals among them) for live agents", () => {
    const signals = all.flatMap((b) => (b.kind === "signals" ? b.signals : []))
    expect(signals.filter((s) => s.type === "goal")).toHaveLength(match.info.score.home + match.info.score.away)
  })

  it("starts mid-match with the numbers of the whole match so far", async () => {
    const goal = lib.goals[0]!
    const from = goal.frame_id + 600
    const later = [...(await Effect.runPromise(Stream.runCollect(beats(match, from).pipe(Stream.take(40)))))]
    const first = frames(later)[0]!
    expect(first.kind === "frame" && first.frame.frame).toBe(from)
    const board = later.find((b) => b.kind === "board")!
    expect(board.kind === "board" && board.board.score.home + board.board.score.away).toBeGreaterThanOrEqual(1)
  }, 60_000)
})

describe("on-ball events", () => {
  const events = () => all.flatMap((b) => (b.kind === "event" ? [b.event] : []))

  it("come right after the frame each is complete on, never before it", () => {
    let latest = -1
    let checked = 0
    for (const b of all) {
      if (b.kind === "frame") latest = b.frame.frame
      if (b.kind !== "event") continue
      expect(b.frame).toBe(b.event.frame)
      expect(latest).toBeGreaterThanOrEqual(b.event.frame) // play has reached it
      expect(latest - b.event.frame).toBeLessThanOrEqual(1) // and it is not held back
      checked++
    }
    expect(checked).toBeGreaterThan(500)
  })

  it("carry every pass with its length and xPass, and every shot with its xG and ball speed", () => {
    const passes = events().filter((e) => e.type === "pass")
    const shots = events().filter((e) => e.type === "shot")
    expect(passes.length).toBeGreaterThan(300)
    expect(shots.length).toBeGreaterThan(5)
    expect(passes.filter((p) => p.xpass !== null).length / passes.length).toBeGreaterThan(0.95)
    for (const p of passes) {
      expect(p.length_m).not.toBeNull()
      if (p.xpass !== null) expect(p.xpass).toBeGreaterThanOrEqual(0), expect(p.xpass).toBeLessThanOrEqual(1)
      expect(["success", "fail"]).toContain(p.outcome)
    }
    for (const s of shots) {
      expect(s.xg).toBeGreaterThan(0)
      expect(s.xg).toBeLessThan(1)
      expect(s.speed_kmh).toBeGreaterThan(0) // a blocked shot or a soft header can be slow
      expect(s.speed_kmh).toBeLessThan(200)
    }
    const speeds = shots.map((s) => s.speed_kmh!).sort((a, b) => a - b)
    expect(speeds[Math.floor(speeds.length / 2)]).toBeGreaterThan(50) // a typical strike
    const goals = shots.filter((s) => s.outcome === "goal")
    expect(goals).toHaveLength(match.info.score.home + match.info.score.away)
  })

  it("start mid-match with nothing from before the start", async () => {
    const from = lib.goals[0]!.frame_id + 600
    const later = [...(await Effect.runPromise(Stream.runCollect(beats(match, from).pipe(Stream.take(4000)))))]
    const evs = later.flatMap((b) => (b.kind === "event" ? [b.event] : []))
    expect(evs.length).toBeGreaterThan(0)
    expect(evs.every((e) => e.frame >= from)).toBe(true)
  }, 60_000)
})

describe("pacing", () => {
  const ten: Beat[] = Array.from({ length: 10 }, (_, i) => ({ kind: "frame", frame: { frame: i, period: "first_half", clock: "00:00.00", ball: { x: 0, y: 0, z: 0 }, home: [], away: [] } }))

  it("plays ten frames at 10 fps and double speed in half a second, and waits while paused", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const control = yield* SubscriptionRef.make<Control>({ paused: false, speed: 2 })
        const fiber = yield* Stream.runCollect(paced(Stream.fromIterable(ten), control, 10)).pipe(Effect.forkChild)
        yield* TestClock.adjust("499 millis")
        expect(fiber.pollUnsafe()).toBeUndefined()
        yield* TestClock.adjust("1 millis")
        expect([...(yield* Fiber.join(fiber))]).toHaveLength(10)

        yield* SubscriptionRef.set(control, { paused: true, speed: 2 })
        const held = yield* Stream.runCollect(paced(Stream.fromIterable(ten), control, 10)).pipe(Effect.forkChild)
        yield* TestClock.adjust("10 seconds")
        expect(held.pollUnsafe()).toBeUndefined()
        yield* SubscriptionRef.set(control, { paused: false, speed: 10 })
        yield* TestClock.adjust("100 millis")
        expect([...(yield* Fiber.join(held))]).toHaveLength(10)
      }).pipe(Effect.provide(TestClock.layer()))
    ))
})

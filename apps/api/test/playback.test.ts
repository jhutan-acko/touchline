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

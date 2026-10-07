import { Effect, Exit, Fiber, Ref, Stream } from "effect"
import { TestClock } from "effect/testing"
import { beforeAll, describe, expect, it } from "vitest"
import type { Tick } from "@touchline/rpc"
import { readMatch, type LibraryMatch } from "../src/library.js"
import { IDLE_STOP_S, makeSessions, startFrame } from "../src/session.js"
import { league, makeLibrary, MATCH_ID, type TestLibrary } from "./fixture.js"

let lib: TestLibrary
let match: LibraryMatch
beforeAll(async () => {
  lib = await makeLibrary()
  match = readMatch(lib.run, league)
}, 120_000)

/**
 * Advance the test clock in small steps, letting real I/O (reading the run's files) happen in between: playback
 * fibers reach their sleeps only after their reads, so one big jump would leave them waiting forever.
 */
const advance = (seconds: number, stepMs = 50) =>
  Effect.gen(function* () {
    for (let t = 0; t < seconds * 1000; t += stepMs) {
      yield* Effect.promise(() => new Promise((r) => setImmediate(r)))
      yield* TestClock.adjust(`${stepMs} millis`)
    }
  })

/** Advance the clock (with real I/O in between) until the fiber is done, then join it; however slow the machine. */
const settle = <A, E>(f: Fiber.Fiber<A, E>, maxSeconds = 300) =>
  Effect.gen(function* () {
    for (let t = 0; t < maxSeconds * 1000 && !f.pollUnsafe(); t += 50) {
      yield* Effect.promise(() => new Promise((r) => setImmediate(r)))
      yield* TestClock.adjust("50 millis")
    }
    return yield* Fiber.join(f)
  })

const run = <A, E>(e: Effect.Effect<A, E, import("effect").Scope.Scope>) => Effect.runPromise(e.pipe(Effect.scoped, Effect.provide(TestClock.layer())))
const library = () => new Map([[MATCH_ID, match]])
const home = { mode: "casual", lang: "en", club: "northwick" } as const
const spanish = { mode: "analyst", lang: "es", club: null } as const

describe("sessions", () => {
  it("show two segments the same match time, each with its own variant of a moment", () =>
    run(
      Effect.gen(function* () {
        const sessions = yield* makeSessions(library())
        const goal = lib.goals[0]!
        const minute = Math.floor(goal.frame_id / 600) // a minute before the goal at the latest
        const s = yield* sessions.start(match, { speed: 64, fromMinute: minute, live: false })
        const take = (seg: typeof home | typeof spanish) => sessions.watch(s.id, seg).pipe(Stream.takeUntil((t) => t.kind === "cue" && t.cue.moment_id !== null), Stream.runCollect, Effect.forkChild)
        const a = yield* take(home)
        const b = yield* take(spanish)
        const ta: Tick[] = [...(yield* settle(a))]
        const tb: Tick[] = [...(yield* settle(b))]
        expect(ta[0]).toMatchObject({ kind: "playback", playback: { state: "playing", speed: 64, live: false } })
        const frameIds = (ts: Tick[]) => ts.flatMap((t) => (t.kind === "frame" ? [t.frame.frame] : []))
        expect(frameIds(ta)).toEqual(frameIds(tb))
        expect(frameIds(ta)[0]).toBe(startFrame(match, minute))
        const last = (ts: Tick[]) => ts.at(-1)!
        expect(last(ta)).toMatchObject({ kind: "cue", cue: { moment_id: `mo-${goal.id}`, segment: home } })
        expect(last(tb)).toMatchObject({ kind: "cue", cue: { moment_id: `mo-${goal.id}`, segment: spanish } })
        const board = ta.find((t) => t.kind === "cue" && t.cue.display.slot === "top_bar")!
        expect(board).toMatchObject({ kind: "cue", cue: { verified: true, text: null, segment: home } })
      })
    ), 120_000)

  it("pause and play the session for everyone", () =>
    run(
      Effect.gen(function* () {
        const sessions = yield* makeSessions(library())
        const s = yield* sessions.start(match, { speed: 1, fromMinute: 0, live: false })
        const w = yield* sessions.watch(s.id, home).pipe(Stream.runDrain, Effect.forkChild)
        yield* advance(10)
        const p = yield* sessions.control(s.id, "pause", null)
        expect(p.state).toBe("paused")
        yield* advance(1) // the frame already under way still lands; then nothing moves
        const at = (yield* Ref.get(s.playback)).frame
        expect(at).toBeGreaterThanOrEqual(90)
        yield* advance(60, 1000)
        expect((yield* Ref.get(s.playback)).frame).toBe(at)
        const q = yield* sessions.control(s.id, "speed", 8)
        expect(q).toMatchObject({ state: "paused", speed: 8 })
        yield* sessions.control(s.id, "play", null)
        yield* advance(1)
        expect((yield* Ref.get(s.playback)).frame).toBeGreaterThanOrEqual(at + 70)
        yield* Fiber.interrupt(w)
      })
    ), 120_000)

  it("stop a session nobody watches, and refuse unknown sessions", () =>
    run(
      Effect.gen(function* () {
        const sessions = yield* makeSessions(library())
        const s = yield* sessions.start(match, { speed: 1, fromMinute: 0, live: false })
        const w = yield* sessions.watch(s.id, home).pipe(Stream.take(3), Stream.runDrain, Effect.forkChild)
        yield* settle(w)
        expect(sessions.count()).toBe(1)
        yield* advance(IDLE_STOP_S + 1, 500)
        expect(sessions.count()).toBe(0)
        const lost = yield* Effect.exit(sessions.control(s.id, "pause", null))
        expect(Exit.isFailure(lost) && JSON.stringify(lost.cause)).toContain("SessionNotFound")
      })
    ), 120_000)

  it("stop a session nobody ever watches", () =>
    run(
      Effect.gen(function* () {
        const sessions = yield* makeSessions(library())
        yield* sessions.start(match, { speed: 1, fromMinute: 0, live: false })
        expect(sessions.count()).toBe(1)
        yield* advance(IDLE_STOP_S + 1, 500)
        expect(sessions.count()).toBe(0)
      })
    ), 120_000)

  it("send a fast session's frames at about 25 a second of wall-clock time", () =>
    run(
      Effect.gen(function* () {
        const sessions = yield* makeSessions(library())
        const s = yield* sessions.start(match, { speed: 64, fromMinute: 10, live: false })
        const w = yield* sessions.watch(s.id, home).pipe(Stream.filter((t: Tick) => t.kind === "frame"), Stream.take(4), Stream.runCollect, Effect.forkChild)
        const ids = [...(yield* settle(w))].flatMap((t) => (t.kind === "frame" ? [t.frame.frame] : []))
        expect(ids.slice(1).map((f, i) => f - ids[i]!)).toEqual([25, 25, 25]) // ×64 at 10 fps: every 25th frame
      })
    ), 120_000)

  it("end at once the stream of a viewer who joins after the match is over", () =>
    run(
      Effect.gen(function* () {
        const sessions = yield* makeSessions(library())
        const s = yield* sessions.start(match, { speed: 4, fromMinute: 130, live: false })
        const a = yield* sessions.watch(s.id, home).pipe(Stream.runCollect, Effect.forkChild)
        expect([...(yield* settle(a))].at(-1)).toMatchObject({ kind: "playback", playback: { state: "ended" } })
        const b = yield* sessions.watch(s.id, home).pipe(Stream.runCollect, Effect.forkChild)
        yield* advance(5)
        expect(b.pollUnsafe()).toBeDefined()
        const tb = [...(yield* Fiber.join(b))]
        expect(tb).toHaveLength(1)
        expect(tb[0]).toMatchObject({ kind: "playback", playback: { state: "ended" } })
      })
    ), 120_000)

  it("start the second half from minute 45 and on", () => {
    const ht = startFrame(match, 45)
    expect(startFrame(match, 50) - ht).toBe(3000)
    expect(ht).toBeGreaterThan(startFrame(match, 44))
  })
})

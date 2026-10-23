import { Effect, Exit, Fiber, Ref, Stream } from "effect"
import { TestClock } from "effect/testing"
import { beforeAll, describe, expect, it } from "vitest"
import { makeEvidence } from "../src/evidence.js"
import { readMatch, type LibraryMatch } from "../src/library.js"
import { makeSessions, type QueueEntry } from "../src/session.js"
import { makeStudio, queueItem, talkingPoints } from "../src/studio.js"
import { league, makeLibrary, MATCH_ID, type TestLibrary } from "./fixture.js"

let lib: TestLibrary
let match: LibraryMatch
beforeAll(async () => {
  lib = await makeLibrary()
  match = readMatch(lib.run, league)
}, 120_000)

const run = <A, E>(e: Effect.Effect<A, E, import("effect").Scope.Scope>) => Effect.runPromise(e.pipe(Effect.scoped, Effect.provide(TestClock.layer())))

/** Advance the clock (with real I/O in between) until `done` holds. */
const until = (done: () => Effect.Effect<boolean>, maxSeconds = 300) =>
  Effect.gen(function* () {
    for (let t = 0; t < maxSeconds * 1000 && !(yield* done()); t += 50) {
      yield* Effect.promise(() => new Promise((r) => setTimeout(r, 1)))
      yield* TestClock.adjust("50 millis")
    }
  })

const casual = { mode: "casual", lang: "en", club: null } as const
const spanish = { mode: "casual", lang: "es", club: null } as const

/** A session from just before the first goal, with the studio recording its queue; resolves once the goal is queued with its facts. */
const queued = Effect.gen(function* () {
  const studio = makeStudio(makeEvidence(new Map([[MATCH_ID, match]])))
  const sessions = yield* makeSessions(new Map([[MATCH_ID, match]]), { studio: studio.record })
  const goal = lib.goals[0]!
  const s = yield* sessions.start(match, { speed: 64, fromMinute: Math.floor(goal.frame_id / 600), live: false })
  const w = yield* sessions.watch(s.id, casual).pipe(Stream.runDrain, Effect.forkChild) // someone watches, so the session plays on
  const id = `mo-${goal.id}`
  yield* until(() => Effect.map(Ref.get(s.queue), (q) => (q.get(id)?.facts.length ?? 0) > 0))
  return { studio, sessions, s, w, id, goal }
})

describe("studio queue", () => {
  it("queues each moment as it reaches the bus, pending, with its checked facts", () =>
    run(
      Effect.gen(function* () {
        const { s, id, goal } = yield* queued
        const entry = (yield* Ref.get(s.queue)).get(id)!
        expect([entry.status, entry.frame, entry.cues.length]).toEqual(["pending", goal.frame_id, 3])
        expect(entry.facts).toContain("Cause: clear chance converted")
        expect(entry.facts.some((f) => f.startsWith("Momentum") && f.endsWith(": 60%"))).toBe(true)
      })
    ), 180_000)

  it("approves, holds and sends to graphics, and tells everyone on the bus", () =>
    run(
      Effect.gen(function* () {
        const { studio, s, id } = yield* queued
        const seen = yield* Stream.fromPubSub(s.bus).pipe(Stream.filter((b) => b.kind === "queue" || b.kind === "air"), Stream.take(4), Stream.runCollect, Effect.forkChild)
        yield* Effect.yieldNow
        expect(yield* studio.act(s, id, "approve")).toEqual({ moment_id: id, status: "approved" })
        expect(yield* studio.act(s, id, "hold")).toEqual({ moment_id: id, status: "held" })
        expect(yield* studio.act(s, id, "send")).toEqual({ moment_id: id, status: "on_air" })
        const beats = [...(yield* Fiber.join(seen))]
        expect(beats.map((b) => (b.kind === "queue" ? b.entry.status : b.kind))).toEqual(["approved", "held", "on_air", "air"])
        const air = beats[3]!
        expect(air.kind === "air" && air.cues.map((c) => c.moment_id)).toEqual([id, id, id])
        const lost = yield* Effect.exit(studio.act(s, "nope", "send"))
        expect(Exit.isFailure(lost) && JSON.stringify(lost.cause)).toContain("NotQueued")
      })
    ), 180_000)
})

describe("studio and graphics streams", () => {
  it("give a producer who joins late the queue so far, in their language", () =>
    run(
      Effect.gen(function* () {
        const { studio, sessions, s, id } = yield* queued
        const ticks = [...(yield* studio.watch(sessions, s.id, spanish).pipe(Stream.take(2), Stream.runCollect))]
        expect(ticks[0]!.kind).toBe("playback")
        const first = ticks[1]!
        expect(first.kind === "queue" && [first.item.moment_id, first.item.status, first.item.points[0]]).toEqual([id, "pending", "Goal (analyst es)"])
      })
    ), 180_000)

  it("put on the graphics output the scoreboard and only the cues the producer sent", () =>
    run(
      Effect.gen(function* () {
        const { studio, sessions, s, id } = yield* queued
        const out = yield* sessions.graphics(s.id, casual).pipe(Stream.takeUntil((t) => t.kind === "cue" && t.cue.moment_id !== null), Stream.runCollect, Effect.forkChild)
        yield* until(() => Effect.succeed(false), 2) // a few seconds of play: scoreboards only
        yield* studio.act(s, id, "send")
        yield* until(() => Effect.sync(() => out.pollUnsafe() !== undefined), 30)
        const ticks = [...(yield* Fiber.join(out))]
        expect(ticks.some((t) => t.kind === "frame")).toBe(false) // graphics go over the broadcast picture: no pitch
        expect(ticks.filter((t) => t.kind === "cue" && t.cue.moment_id === null).length).toBeGreaterThan(0) // scoreboards
        const aired = ticks.at(-1)!
        expect(aired.kind === "cue" && [aired.cue.moment_id, aired.cue.segment]).toEqual([id, casual])
      })
    ), 180_000)
})

describe("queue items", () => {
  const entry = (): QueueEntry => ({
    moment_id: "mo-1", frame: 100, clock: "01:00", status: "approved", cues: lib.cues.filter((c) => c.moment_id === `mo-${lib.goals[0]!.id}`), facts: ["Cause: clear chance converted"]
  })

  it("show each producer the variant for their segment and the analyst text in their language", () => {
    const es = queueItem(entry(), spanish)
    expect(es.cue?.segment).toEqual(casual) // no casual Spanish variant: English neutral is the fallback
    expect(es.points[0]).toBe("Goal (analyst es)") // the analyst headline in Spanish
    expect(es.points.at(-1)).toBe("Cause: clear chance converted")
    expect(es.variants).toBe(3)
    expect(queueItem(entry(), casual).points).toEqual(["Cause: clear chance converted"]) // no English analyst text was written
  })

  it("never pick a pitch marker as the presenter's cue, nor count it as a variant", () => {
    const base = entry()
    const markers = base.cues.map((c) => ({ ...c, cue_id: `${c.cue_id}:m`, display: { ...c.display, slot: "pitch_marker" as const, template: "ghost" }, text: null }))
    const e = { ...base, cues: [...markers, ...base.cues] }
    const es = queueItem(e, spanish)
    expect(es.cue?.display.slot).not.toBe("pitch_marker")
    expect(es.points[0]).toBe("Goal (analyst es)")
    expect(es.variants).toBe(3)
    expect(queueItem(e, casual).cue?.text).not.toBeNull()
  })

  it("split analyst text into one talking point per sentence", () => {
    expect(talkingPoints({ headline: "Press wins it.", body: "Two passes. Then a shot!" }, ["Cause: x"])).toEqual(["Press wins it.", "Two passes.", "Then a shot!", "Cause: x"])
  })
})

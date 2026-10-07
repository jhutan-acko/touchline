import { Effect, Fiber, Stream } from "effect"
import { TestClock } from "effect/testing"
import { beforeAll, describe, expect, it } from "vitest"
import type { Artifact, Sender } from "@touchline/agent-gateway"
import type { Tick } from "@touchline/rpc"
import type { AgentRequest, Cue, MomentTrace, Recap } from "@touchline/schema"
import { makeEvidence } from "../src/evidence.js"
import { readMatch, type LibraryMatch } from "../src/library.js"
import { coalesce, liveAgents } from "../src/live.js"
import { makeSessions } from "../src/session.js"
import { league, makeLibrary, MATCH_ID, type TestLibrary } from "./fixture.js"

let lib: TestLibrary
let match: LibraryMatch
beforeAll(async () => {
  lib = await makeLibrary()
  match = readMatch(lib.run, league)
}, 120_000)

const advance = (seconds: number, stepMs = 50) =>
  Effect.gen(function* () {
    for (let t = 0; t < seconds * 1000; t += stepMs) {
      yield* Effect.promise(() => new Promise((r) => setImmediate(r)))
      yield* TestClock.adjust(`${stepMs} millis`)
    }
  })

/** A fake agent service: for every batch with a goal, a cue per requested segment and the moment's trace; for a recap request, the recap and its card per segment. */
const fakeAgents = () => {
  const requests: AgentRequest[] = []
  const base = lib.cues[0]!
  const send: Sender = async function* (req) {
    requests.push(req)
    if (req.kind === "recap") {
      const recapId = `${MATCH_ID}-recap-${req.recap}`
      const recap: Recap = { recap_id: recapId, match_id: MATCH_ID, kind: req.recap, at_frame: req.at_frame, sentences: ["Full time."], claims: [], turning_points: [], player_of_match: null, verified: true }
      yield { name: "recap", data: recap } satisfies Artifact
      for (const seg of req.segments) {
        const cue: Cue = { ...base, cue_id: `${recapId}-${seg.mode}.${seg.lang}.${seg.club ?? "neutral"}`, moment_id: recapId, segment: seg, anchor: { frame_from: req.at_frame, frame_to: req.at_frame, clock: "90:00" }, display: { ...base.display, slot: "recap_card" } }
        yield { name: "cue", data: cue } satisfies Artifact
      }
      return
    }
    if (req.kind !== "signals") return
    for (const g of req.signals.filter((s) => s.type === "goal")) {
      const momentId = `live-${g.id}`
      for (const seg of req.segments) {
        const cue: Cue = { ...base, cue_id: `${momentId}-${seg.mode}.${seg.lang}.${seg.club ?? "neutral"}`, moment_id: momentId, segment: seg, anchor: { frame_from: g.frame_from, frame_to: g.frame_to, clock: g.match_clock.slice(0, 5) } }
        yield { name: "cue", data: cue } satisfies Artifact
      }
      const t0 = lib.traces[0]!
      const trace: MomentTrace = { ...t0, moment: { ...t0.moment, moment_id: momentId, frame_to: g.frame_to }, analysis: { ...t0.analysis, moment_id: momentId, cause: "written live" }, model: "live-model" }
      yield { name: "trace", data: trace } satisfies Artifact
    }
  }
  return { send, requests }
}

/** Advance the clock (with real I/O in between) until the fiber is done, then join it. */
const settle = <A, E>(f: Fiber.Fiber<A, E>, maxSeconds = 300) =>
  Effect.gen(function* () {
    for (let t = 0; t < maxSeconds * 1000 && !f.pollUnsafe(); t += 50) {
      yield* Effect.promise(() => new Promise((r) => setImmediate(r)))
      yield* TestClock.adjust("50 millis")
    }
    return yield* Fiber.join(f)
  })

const run = <A, E>(e: Effect.Effect<A, E, import("effect").Scope.Scope>) => Effect.runPromise(e.pipe(Effect.scoped, Effect.provide(TestClock.layer())))
const fakeMcp = async () => ({ url: "http://127.0.0.1:1/mcp", stop: () => {} })
const home = { mode: "casual", lang: "en", club: "northwick" } as const

describe("live agents", () => {
  it("send the match's signals as play reaches them and show the cues that come back, for the watched segment", () =>
    run(
      Effect.gen(function* () {
        const agents = fakeAgents()
        const sessions = yield* makeSessions(new Map([[MATCH_ID, match]]), { companion: liveAgents({ agentsUrl: "", budgetMs: 0, send: agents.send, mcp: fakeMcp }) })
        const goal = lib.goals[0]!
        const s = yield* sessions.start(match, { speed: 64, fromMinute: Math.floor(goal.frame_id / 600), live: true })
        const w = yield* sessions.watch(s.id, home).pipe(Stream.takeUntil((t: Tick) => t.kind === "cue" && t.cue.moment_id !== null), Stream.runCollect, Effect.forkChild)
        yield* advance(120)
        const ticks = [...(yield* Fiber.join(w))]
        const last = ticks.at(-1)!
        expect(last.kind === "cue" && last.cue.moment_id).toMatch(/^live-.*-goal-/)
        expect(last.kind === "cue" && [last.cue.anchor.frame_to, last.cue.segment]).toEqual([goal.frame_id, home])
        expect(ticks.some((t) => t.kind === "cue" && t.cue.cue_id.startsWith(`mo-`))).toBe(false) // no cached cues in a live session
        const signals = agents.requests.filter((r) => r.kind === "signals")
        expect(signals[0]!.segments).toEqual([home])
        expect(signals.every((r) => r.kind === "signals" && r.signals.every((x) => x.frame_id <= r.now_frame))).toBe(true)
        const ev = makeEvidence(new Map([[MATCH_ID, match]]))
        const why = yield* ev.evidence(MATCH_ID, last.kind === "cue" ? last.cue.cue_id : "", { frame: goal.frame_id, live: s.agents })
        expect([why.cause, why.model]).toEqual(["written live", "live-model"]) // the live trace, not the cache's
        expect(s.metrics.requests.length).toBeGreaterThan(0)
        expect(s.metrics.requests.every((r) => r.outcome === "ok" && r.ms >= 0)).toBe(true)
        expect(s.metrics.insight.length).toBeGreaterThan(0) // signal played → cue on the bus
        expect(s.metrics.insight.every((ms) => ms >= 0)).toBe(true)
      })
    ), 120_000)

  it("deliver the full-time recap and its card before a live viewer's stream ends", () =>
    run(
      Effect.gen(function* () {
        const agents = fakeAgents()
        const sessions = yield* makeSessions(new Map([[MATCH_ID, match]]), { companion: liveAgents({ agentsUrl: "", budgetMs: 0, send: agents.send, mcp: fakeMcp }) })
        const s = yield* sessions.start(match, { speed: 64, fromMinute: 130, live: true })
        const w = yield* sessions.watch(s.id, home).pipe(Stream.runCollect, Effect.forkChild)
        const ticks = [...(yield* settle(w))]
        expect(ticks.some((t) => t.kind === "cue" && t.cue.moment_id === `${MATCH_ID}-recap-full_time`)).toBe(true)
        const ev = makeEvidence(new Map([[MATCH_ID, match]]))
        const view = yield* ev.recap(MATCH_ID, "full_time", home, { frame: match.info.frames, live: s.agents })
        expect([view.recap?.kind, view.cards.length]).toEqual(["full_time", 1])
      })
    ), 120_000)

  it("keep playing, and end every stream, when the live agents cannot start", () =>
    run(
      Effect.gen(function* () {
        const agents = fakeAgents()
        const broken = async () => { throw new Error("pnpm not found") }
        const sessions = yield* makeSessions(new Map([[MATCH_ID, match]]), { companion: liveAgents({ agentsUrl: "", budgetMs: 0, send: agents.send, mcp: broken }) })
        const s = yield* sessions.start(match, { speed: 64, fromMinute: 130, live: true })
        const w = yield* sessions.watch(s.id, home).pipe(Stream.runCollect, Effect.forkChild)
        yield* advance(30)
        expect(w.pollUnsafe()).toBeDefined()
        expect([...(yield* Fiber.join(w))].some((t) => t.kind === "playback" && t.playback.state === "ended")).toBe(true)
      })
    ), 120_000)

  it("ask for no half-time recap when the session starts in the second half", () =>
    run(
      Effect.gen(function* () {
        const agents = fakeAgents()
        const sessions = yield* makeSessions(new Map([[MATCH_ID, match]]), { companion: liveAgents({ agentsUrl: "", budgetMs: 0, send: agents.send, mcp: fakeMcp }) })
        const s = yield* sessions.start(match, { speed: 64, fromMinute: 60, live: true })
        const w = yield* sessions.watch(s.id, home).pipe(Stream.filter((t: Tick) => t.kind === "frame"), Stream.take(20), Stream.runDrain, Effect.forkChild)
        yield* settle(w)
        yield* advance(1)
        expect(agents.requests.filter((r) => r.kind === "recap")).toEqual([])
      })
    ), 120_000)

  it("ask for the half-time recap when the second half starts", () =>
    run(
      Effect.gen(function* () {
        const agents = fakeAgents()
        const sessions = yield* makeSessions(new Map([[MATCH_ID, match]]), { companion: liveAgents({ agentsUrl: "", budgetMs: 0, send: agents.send, mcp: fakeMcp }) })
        const s = yield* sessions.start(match, { speed: 64, fromMinute: 44, live: true })
        const w = yield* sessions.watch(s.id, home).pipe(Stream.takeUntil((t: Tick) => t.kind === "frame" && t.frame.period === "second_half" && t.frame.frame % 600 === 300), Stream.runDrain, Effect.forkChild)
        yield* advance(60)
        yield* Fiber.join(w)
        yield* advance(1)
        expect(agents.requests.filter((r) => r.kind === "recap").map((r) => r.kind === "recap" && r.recap)).toEqual(["half_time"])
      })
    ), 120_000)
})

describe("batches", () => {
  it("merge while a request is under way; recaps keep their place", () => {
    const sig = (f: number) => ({ id: `s${f}`, frame_id: f }) as never
    const jobs = coalesce([
      { kind: "signals", signals: [sig(1)], frame: 10, since: 1000 },
      { kind: "signals", signals: [sig(2)], frame: 20, since: 2000 },
      { kind: "recap", recap: "half_time", frame: 25 },
      { kind: "signals", signals: [sig(3)], frame: 30, since: 3000 },
      { kind: "stop" }
    ])
    expect(jobs.map((j) => j.kind)).toEqual(["signals", "recap", "signals", "stop"])
    expect(jobs[0]).toMatchObject({ frame: 20, signals: [{ id: "s1" }, { id: "s2" }], since: 1000 }) // latency counts from the earliest signal
  })
})

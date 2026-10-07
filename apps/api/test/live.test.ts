import { Effect, Fiber, Stream } from "effect"
import { TestClock } from "effect/testing"
import { beforeAll, describe, expect, it } from "vitest"
import type { Artifact, Sender } from "@touchline/agent-gateway"
import type { Tick } from "@touchline/rpc"
import type { AgentRequest, Cue } from "@touchline/schema"
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

/** A fake agent service: a cue per requested segment for every batch with a goal in it. */
const fakeAgents = () => {
  const requests: AgentRequest[] = []
  const base = lib.cues[0]!
  const send: Sender = async function* (req) {
    requests.push(req)
    if (req.kind !== "signals") return
    for (const g of req.signals.filter((s) => s.type === "goal")) {
      for (const seg of req.segments) {
        const cue: Cue = { ...base, cue_id: `live-${g.id}-${seg.mode}.${seg.lang}.${seg.club ?? "neutral"}`, moment_id: `live-${g.id}`, segment: seg, anchor: { frame_from: g.frame_from, frame_to: g.frame_to, clock: g.match_clock.slice(0, 5) } }
        yield { name: "cue", data: cue } satisfies Artifact
      }
    }
  }
  return { send, requests }
}

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
      { kind: "signals", signals: [sig(1)], frame: 10 },
      { kind: "signals", signals: [sig(2)], frame: 20 },
      { kind: "recap", recap: "half_time", frame: 25 },
      { kind: "signals", signals: [sig(3)], frame: 30 },
      { kind: "stop" }
    ])
    expect(jobs.map((j) => j.kind)).toEqual(["signals", "recap", "signals", "stop"])
    expect(jobs[0]).toMatchObject({ frame: 20, signals: [{ id: "s1" }, { id: "s2" }] })
  })
})

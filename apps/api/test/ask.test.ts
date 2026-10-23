import { randomUUID } from "node:crypto"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { Effect, Exit, Fiber, Ref, Stream } from "effect"
import { TestClock } from "effect/testing"
import { beforeAll, describe, expect, it } from "vitest"
import type { Artifact, McpServer, Sender } from "@touchline/agent-gateway"
import type { AskClip, AskUpdate, Playback } from "@touchline/rpc"
import type { AgentRequest, AskReply, DomainEvent, FrameSummary } from "@touchline/schema"
import { makeAsk, type AskOptions, type AskPayload } from "../src/ask.js"
import { makeAskWorkers } from "../src/askpool.js"
import type { AskClipRequest } from "../src/askclip.js"
import { readMatch, type AskCacheEntry, type LibraryMatch } from "../src/library.js"
import { makeSessions, type Session } from "../src/session.js"
import { league, makeLibrary } from "./fixture.js"

const F = 5000
const SUMMARY: FrameSummary = {
  match_id: "m", frame: F, clock: "08:20", ball_holder: "h1", side_in_possession: "home",
  players: [
    { id: "h1", name: "Ana Holder", side: "home", role: "CM", x: 0, y: 0 },
    { id: "h2", name: "Teo Arden", side: "home", role: "ST", x: 20, y: 5 },
    { id: "h3", name: "Max Passer", side: "home", role: "CB", x: -20, y: 0 },
    { id: "a1", name: "Luis Brandt", side: "away", role: "CB", x: 2, y: 1 },
    { id: "a2", name: "Ivo Kern", side: "away", role: "DM", x: -2, y: 1 }
  ],
  pass_options: [{ receiver_id: "h2", xpass: 0.6, value: 0.07 }],
  pressers: ["a1", "a2"],
  recent: [{ event_id: "e-1", frame: 4980, type: "pass", player_id: "h3", receiver_id: "h1" }],
  missed_option: { event_id: "e-1", passer_id: "h3", played_to: "h1", better_to: "h2" }
}
const REPLY: AskReply = { headline: "The striker was the better pass", body: "Fewer shots the way it went.", chips: [], verified: true, model: null }
const clipOf = (req: AskClipRequest): AskClip => ({
  clip_id: `c-${req.forkFrame}`, fork_frame: req.forkFrame, paused_frame: req.pausedFrame, fps: 10, intervention: req.intervention, verdict: "better_option_found",
  real: [], variant: [], seeds: 20, horizon_s: 10, typical_seed: 3, shots: { played: 4, alt: 9 }, goals: { played: 1, alt: 3 }, gain: { mean: 0.05, se: 0.01 }
})

/** A fake agent service: an intent for ask_intent, three stages and a reply for ask_answer (or `answer`'s override). */
const agents = (answer?: (req: AgentRequest, signal: AbortSignal) => AsyncIterable<Artifact>) => {
  const calls: AgentRequest[] = []
  const send: Sender = async function* (req, signal) {
    calls.push(req)
    if (req.kind === "ask_intent") {
      yield { name: "ask_intent", data: { kind: "explain", subject_id: "h1", fork_event_id: null, intervention: null, reason: null } }
      return
    }
    if (answer) return yield* answer(req, signal)
    for (const stage of ["analyst", "factcheck", "personalise"]) yield { name: "ask_stage", data: { stage, status: stage } }
    yield { name: "ask_reply", data: REPLY }
  }
  return { send, calls }
}

/** Fake jobs and stats server, counting calls. */
const fakes = () => {
  const n = { summary: 0, clips: [] as AskClipRequest[], mcpStarts: 0, mcpStops: 0 }
  const o: Omit<AskOptions, "send"> = {
    summary: async () => (n.summary++, SUMMARY),
    askClip: async (_dir, req) => (n.clips.push(req), clipOf(req)),
    mcp: async (): Promise<McpServer> => (n.mcpStarts++, { url: "http://127.0.0.1:1/mcp", stop: () => void n.mcpStops++ })
  }
  return { n, o }
}

const fakeSession = (frame: number, askCache: ReadonlyMap<string, AskCacheEntry> = new Map()) =>
  Effect.map(Ref.make<Playback>({ state: "playing", frame, speed: 1, live: false }), (playback) =>
    ({ id: randomUUID(), match: { dir: "/fake/run", info: { match_id: "m", home: { name: "Northwick" }, away: { name: "Larkspur City" } }, askCache }, playback }) as unknown as Session)

const segment = { mode: "casual", lang: "en", club: null } as const
const chipAsk = (slug: string): AskPayload => ({ frame: F, question: "q", chip_id: `${F}:${slug}`, segment })
const collect = (s: Stream.Stream<AskUpdate>) => Effect.runPromise(Stream.runCollect(s)).then((c) => [...c])
const label = (u: AskUpdate) => (u.kind === "stage" ? u.stage.stage : u.kind === "failed" ? `failed:${u.reason}` : "answer")

describe("ask", () => {
  it("streams question, whatif, the agent stages, then the answer", async () => {
    const { n, o } = fakes()
    const a = agents()
    const ask = makeAsk({ send: a.send, ...o })
    const s = await Effect.runPromise(fakeSession(6000))
    const out = await collect(ask.ask(s, chipAsk("why_not_pass")))
    expect(out.map(label)).toEqual(["question", "whatif", "analyst", "factcheck", "personalise", "answer"])
    const whatif = out[1]!
    expect(whatif.kind === "stage" && whatif.stage.status).toContain("Teo Arden")
    // The missed option forks at its pass; nothing shown past the paused frame.
    expect(n.clips).toEqual([{ forkFrame: 4980, pausedFrame: F, intervention: { kind: "pass_to", player_id: "h3", receiver_id: "h2" } }])
    const answer = out.at(-1)!
    expect(answer.kind === "answer" && answer.answer).toMatchObject({ ...REPLY, clip_id: "c-4980", verdict: "better_option_found", frame: F, cached: false })
    const req = a.calls.find((c) => c.kind === "ask_answer")!
    expect(req.kind === "ask_answer" && req).toMatchObject({ at_frame: F, mcp_url: "http://127.0.0.1:1/mcp", what_if: { fork_frame: 4980, seeds: 20, verdict: "better_option_found" } })
  })

  it("fails bad_frame beyond the playback frame", async () => {
    const { n, o } = fakes()
    const ask = makeAsk({ send: agents().send, ...o })
    const s = await Effect.runPromise(fakeSession(F - 1))
    expect((await collect(ask.ask(s, chipAsk("plan")))).map(label)).toEqual(["failed:bad_frame"])
    expect(Exit.isFailure(await Effect.runPromiseExit(ask.suggest(s, F, "en")))).toBe(true)
    expect(n.summary).toBe(0)
  })

  it("fails offline when the sender throws AgentUnavailable", async () => {
    const { o } = fakes()
    const down: Sender = async function* () {
      throw new Error("ECONNREFUSED")
    }
    const ask = makeAsk({ send: down, ...o })
    const s = await Effect.runPromise(fakeSession(6000))
    expect((await collect(ask.ask(s, { ...chipAsk("plan"), chip_id: null }))).map(label)).toEqual(["question", "failed:offline"])
    expect((await collect(ask.ask(s, chipAsk("plan")))).map(label)).toEqual(["question", "failed:offline"])
  })

  it("fails timeout when the answer exceeds its timeout", async () => {
    const { o } = fakes()
    const stuck = agents(async function* (_req, signal) {
      yield { name: "ask_stage", data: { stage: "analyst", status: "thinking" } }
      await new Promise((_, reject) => signal.addEventListener("abort", () => reject(new Error("aborted"))))
    })
    const ask = makeAsk({ send: stuck.send, ...o })
    const out = await Effect.runPromise(
      Effect.gen(function* () {
        const s = yield* fakeSession(6000)
        const f = yield* Effect.forkChild(Stream.runCollect(ask.ask(s, chipAsk("plan"))))
        for (let t = 0; t < 20_000 && !f.pollUnsafe(); t += 500) {
          yield* Effect.promise(() => new Promise((r) => setImmediate(r)))
          yield* TestClock.adjust("500 millis")
        }
        return [...(yield* Fiber.join(f))]
      }).pipe(Effect.provide(TestClock.layer()))
    )
    expect(out.map(label)).toEqual(["question", "analyst", "failed:timeout"])
  })

  it("does not call askIntent for a chip", async () => {
    const { n, o } = fakes()
    const a = agents()
    const ask = makeAsk({ send: a.send, ...o })
    const s = await Effect.runPromise(fakeSession(6000))
    const out = await collect(ask.ask(s, chipAsk("pressers")))
    expect(a.calls.map((c) => c.kind)).toEqual(["ask_answer"])
    expect(out.map(label)).toEqual(["question", "analyst", "factcheck", "personalise", "answer"])
    expect(out.at(-1)!.kind === "answer" && (out.at(-1) as { answer: { clip_id: unknown } }).answer.clip_id).toBeNull()
    expect(n.clips).toEqual([])
    // A typed question goes to the question agent.
    await collect(ask.ask(s, { ...chipAsk("pressers"), chip_id: null, question: "Who is pressing?" }))
    expect(a.calls.map((c) => c.kind)).toEqual(["ask_answer", "ask_intent", "ask_answer"])
    expect(n.summary).toBe(1) // memoised per match and frame
  })

  it("serves the stored clip by id", async () => {
    const { o } = fakes()
    const ask = makeAsk({ send: agents().send, ...o })
    const s = await Effect.runPromise(fakeSession(6000))
    await collect(ask.ask(s, chipAsk("what_if_pass")))
    const clip = await Effect.runPromise(ask.clip(s, `c-${F}`))
    expect(clip).toMatchObject({ fork_frame: F, paused_frame: F, intervention: { kind: "pass_to", player_id: "h1", receiver_id: "h2" } })
    expect(Exit.isFailure(await Effect.runPromiseExit(ask.clip(s, "nope")))).toBe(true)
    const other = await Effect.runPromise(fakeSession(6000))
    expect(Exit.isFailure(await Effect.runPromiseExit(ask.clip(other, `c-${F}`)))).toBe(true)
  })

  it("replays a cached answer with cached true and no agent calls", async () => {
    const { n, o } = fakes()
    const a = agents()
    const ask = makeAsk({ send: a.send, ...o })
    const clip = clipOf({ forkFrame: 4980, pausedFrame: F, intervention: { kind: "pass_to", player_id: "h3", receiver_id: "h2" } })
    const entry: AskCacheEntry = {
      stages: [{ stage: "question", status: "q" }, { stage: "whatif", status: "w" }, { stage: "analyst", status: "a" }],
      answer: { ...REPLY, ask_id: "ask-1", frame: F, clip_id: clip.clip_id, verdict: clip.verdict, cached: false },
      clip
    }
    const s = await Effect.runPromise(fakeSession(6000, new Map([[`${F}:${F}:why_not_pass`, entry]])))
    const t0 = performance.now()
    const out = await collect(ask.ask(s, chipAsk("why_not_pass")))
    expect(performance.now() - t0).toBeGreaterThanOrEqual(3 * 350 - 50)
    expect(out.map(label)).toEqual(["question", "whatif", "analyst", "answer"])
    expect(out.at(-1)!.kind === "answer" && (out.at(-1) as { answer: { cached: boolean } }).answer.cached).toBe(true)
    expect(a.calls).toEqual([])
    expect(n).toMatchObject({ summary: 0, clips: [], mcpStarts: 0 })
    expect(await Effect.runPromise(ask.clip(s, clip.clip_id))).toEqual(clip)
  })

  describe("warm workers", () => {
    const echo = (o: { idleMs?: number; coldTimeoutMs?: number } = {}) => makeAskWorkers({ ...o, script: new URL("./workers/ask-echo.mjs", import.meta.url), execArgv: [] })
    const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

    it("give a cold worker the longer limit, and replace a worker that times out", async () => {
      const w = echo({ coldTimeoutMs: 400 })
      try {
        await expect(w.summary("/m", -1, 50)).rejects.toThrow(/timed out after 0.4 s/)
        expect(await w.summary("/m", 7, 50)).toEqual({ frame: 7 })
        await expect(w.summary("/m", -1, 50)).rejects.toThrow(/timed out after 0.05 s/)
        expect(await w.summary("/m", 8, 50)).toEqual({ frame: 8 })
        expect(w.rebuilds("/m")).toBe(2) // the stuck worker was replaced
      } finally {
        w.close()
      }
    })

    it("keep a match's worker while a session holds it, and drop it once idle", async () => {
      const w = echo({ idleMs: 100 })
      try {
        w.retain("/m", "s1")
        await w.summary("/m", 1, 1000)
        await sleep(250)
        expect(w.running()).toBe(1)
        w.release("/m", "s1")
        expect(w.running()).toBe(1)
        await sleep(250)
        expect(w.running()).toBe(0)
      } finally {
        w.close()
      }
    })
  })

  describe("on a library match", () => {
    let match: LibraryMatch
    beforeAll(async () => {
      match = readMatch((await makeLibrary()).run, league)
    }, 180_000)

    it("starts the Ask mcp server once for two asks and stops it on close", async () => {
      const { n, o } = fakes()
      const ask = makeAsk({ send: agents().send, ...o })
      await Effect.runPromise(
        Effect.gen(function* () {
          const sessions = yield* makeSessions(new Map([[match.info.match_id, match]]), { onClose: ask.close })
          const s = yield* sessions.start(match, { speed: 1, fromMinute: 10, live: false })
          const ask2 = (slug: string) => Stream.runCollect(ask.ask(s, { ...chipAsk(slug), frame: 5000 }))
          yield* Effect.all([ask2("plan"), ask2("pressers")], { concurrency: 2 })
          expect(n).toMatchObject({ mcpStarts: 1, mcpStops: 0 })
          yield* sessions.stop(s.id)
          expect(n).toMatchObject({ mcpStarts: 1, mcpStops: 1 })
        }).pipe(Effect.scoped, Effect.provide(TestClock.layer()))
      )
    })

    it("rebuilds the match once for suggestions and asks on its warm worker", async () => {
      const a = agents()
      const { n, o } = fakes()
      const ask = makeAsk({ send: a.send, mcp: o.mcp })
      const timed = async <A>(f: () => Promise<A>) => {
        const t0 = performance.now()
        const v = await f()
        return [v, Math.round(performance.now() - t0)] as const
      }
      try {
        await Effect.runPromise(
          Effect.gen(function* () {
            const s = yield* fakeSession(40_000)
            const real = { ...s, match } as Session
            // Frames just after a completed pass arrived: someone is on the ball.
            const frames = readFileSync(join(match.dir, "domain.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l) as DomainEvent)
              .filter((e) => e.type === "pass" && e.frame_id >= 30_000 && e.frame_id_end !== null && e.frame_id_end !== undefined && typeof e.attrs.receiver_id === "string")
              .slice(0, 6).map((e) => e.frame_id_end! + 3)
            const times: Record<string, number> = {}
            let chip: { frame: number; chip_id: string } | null = null
            for (const [i, frame] of frames.entries()) {
              const [chips, ms] = yield* Effect.promise(() => timed(() => Effect.runPromise(ask.suggest(real, frame, "en"))))
              times[i === 0 ? `suggest_cold_${frame}` : `suggest_warm_${frame}`] = ms
              const c = chips.find((x) => x.intent.kind === "what_if")
              if (c) {
                chip = { frame, chip_id: c.chip_id }
                break
              }
            }
            expect(chip).not.toBeNull()
            const [again, memo] = yield* Effect.promise(() => timed(() => Effect.runPromise(ask.suggest(real, chip!.frame, "en"))))
            times.suggest_memoised = memo
            expect(again.length).toBeGreaterThan(0)
            const [out, askMs] = yield* Effect.promise(() => timed(() => collect(ask.ask(real, { frame: chip!.frame, question: "q", chip_id: chip!.chip_id, segment }))))
            times.chip_ask = askMs
            expect(out.map(label)).toEqual(["question", "whatif", "analyst", "factcheck", "personalise", "answer"])
            const answer = out.at(-1)!
            const clipId = answer.kind === "answer" ? answer.answer.clip_id : null
            const clip = yield* ask.clip(real, clipId!)
            expect(clip.real.at(-1)!.frame).toBeLessThanOrEqual(chip!.frame)
            // Another frame on the warm worker: one replay, no rebuild.
            const [, warm] = yield* Effect.promise(() => timed(() => Effect.runPromise(ask.suggest(real, chip!.frame + 50, "en"))))
            times.suggest_warm_other_frame = warm
            expect(ask.workers.rebuilds(match.dir)).toBe(1)
            console.log(`ask timings (ms): ${JSON.stringify(times)}`)
            yield* ask.close(real)
            expect(n.mcpStops).toBe(1)
          })
        )
      } finally {
        ask.workers.close()
      }
    }, 240_000)
  })
})

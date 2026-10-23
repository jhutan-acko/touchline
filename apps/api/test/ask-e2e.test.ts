/**
 * Pause and ask end to end: the API on a simulated match with the Python agent service on the stub model. A chip is
 * asked live over the WebSocket, its clip fetched, then the ask-cache writer runs on the same frame and a fresh API
 * with no agent service replays the cached answer.
 */
import { spawn, type ChildProcess } from "node:child_process"
import { readFileSync } from "node:fs"
import { createServer } from "node:net"
import { dirname, join } from "node:path"
import { NodeSocket } from "@effect/platform-node"
import { Effect, Fiber, Layer, Stream } from "effect"
import { RpcClient, RpcSerialization } from "effect/rpc"
import type { RpcClientError } from "effect/rpc/RpcClientError"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { TouchlineRpcs, type AskUpdate } from "@touchline/rpc"
import type { DomainEvent } from "@touchline/schema"
import { OFFLINE_SENDER } from "../src/ask.js"
import { askCacheKey, buildAskCache } from "../src/askcache.js"
import { readMatch } from "../src/library.js"
import { RPC_PATH, serverLayer, type ApiOptions } from "../src/server.js"
import { league, makeLibrary, MATCH_ID, root, type TestLibrary } from "./fixture.js"

const freePort = () => new Promise<number>((ok) => {
  const s = createServer().listen(0, "127.0.0.1", () => {
    const port = (s.address() as { port: number }).port
    s.close(() => ok(port))
  })
})

const segment = { mode: "casual", lang: "en", club: null } as const
const label = (u: AskUpdate) => (u.kind === "stage" ? u.stage.stage : u.kind === "failed" ? `failed:${u.reason}` : "answer")

/** Serve the library (read afresh, so a new ask cache is picked up) on a free port until `stop`. */
const serve = async (o: Omit<ApiOptions, "library">) => {
  const port = await freePort()
  const fiber = Effect.runFork(Layer.launch(serverLayer({ ...o, library: new Map([[MATCH_ID, readMatch(lib.run, league)]]), port })))
  for (let i = 0; i < 200 && !(await fetch(`http://127.0.0.1:${port}/health`).then((r) => r.ok, () => false)); i++) await new Promise((r) => setTimeout(r, 50))
  return { port, stop: () => Effect.runPromise(Fiber.interrupt(fiber)) }
}

type Client = RpcClient.FromGroup<typeof TouchlineRpcs, RpcClientError>

/**
 * A session paused past `frame`, watched throughout (an unwatched session stops after IDLE_STOP_S), then `f` with it.
 */
const withSession = <A, E>(port: number, frame: number, f: (c: Client, sessionId: string) => Effect.Effect<A, E>) =>
  Effect.runPromise(
    Effect.gen(function* () {
      const c = yield* RpcClient.make(TouchlineRpcs)
      const s = yield* c.StartSession({ match_id: MATCH_ID, speed: 1, from_minute: Math.ceil(frame / 600) + 1, live: false })
      yield* c.Control({ session_id: s.session_id, action: "pause", speed: null })
      const watch = yield* Effect.forkChild(Stream.runDrain(c.Watch({ session_id: s.session_id, segment })))
      const out = yield* f(c, s.session_id)
      yield* Fiber.interrupt(watch)
      return out
    }).pipe(
      Effect.scoped,
      Effect.provide(RpcClient.layerProtocolSocket().pipe(Layer.provide(NodeSocket.layerWebSocket(`ws://127.0.0.1:${port}${RPC_PATH}`)), Layer.provide(RpcSerialization.layerJson)))
    )
  )

let lib: TestLibrary
let agents: ChildProcess
let agentsUrl: string
/** Frames just after a completed pass arrived, in the second half: someone is on the ball. */
let candidates: number[]

beforeAll(async () => {
  lib = await makeLibrary()
  const port = await freePort()
  agents = spawn("uv", ["run", "--project", "services/agents", "touchline-agents", "--port", String(port)], { cwd: root, env: { ...process.env, TOUCHLINE_LLM: "stub" }, detached: true, stdio: "ignore" })
  agentsUrl = `http://127.0.0.1:${port}/`
  for (let i = 0; i < 600 && !(await fetch(`${agentsUrl}.well-known/agent-card.json`).then((r) => r.ok, () => false)); i++) await new Promise((r) => setTimeout(r, 200))
  candidates = readFileSync(join(lib.run, "domain.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l) as DomainEvent)
    .filter((e) => e.type === "pass" && e.frame_id >= 30_000 && e.frame_id_end !== null && e.frame_id_end !== undefined && typeof e.attrs.receiver_id === "string")
    .slice(0, 8).map((e) => e.frame_id_end! + 3)
}, 240_000)

afterAll(() => {
  if (agents?.pid) process.kill(-agents.pid, "SIGTERM")
})

describe("pause and ask, end to end on the stub agents", () => {
  it("answers a what_if_pass chip live, serves its spoiler-free clip, then replays the CLI-written cache", async () => {
    const api = await serve({ agentsUrl })
    let frame = -1
    let chipId = ""
    try {
      const last = Math.max(...candidates)
      const live = await withSession(api.port, last, (c, sid) =>
        Effect.gen(function* () {
          for (const f of candidates) {
            const chips = yield* c.SuggestQuestions({ session_id: sid, frame: f, lang: "en" })
            const chip = chips.find((x) => x.chip_id === `${f}:what_if_pass`)
            if (chip) {
              ;[frame, chipId] = [f, chip.chip_id]
              break
            }
          }
          expect(chipId).not.toBe("")
          const updates = [...(yield* Stream.runCollect(c.Ask({ session_id: sid, frame, question: "What if?", chip_id: chipId, segment })))]
          const end = updates.at(-1)!
          const clip = end.kind === "answer" && end.answer.clip_id ? yield* c.GetAskClip({ session_id: sid, clip_id: end.answer.clip_id }) : null
          return { updates, clip }
        })
      )
      expect(live.updates.map(label)).toEqual(["question", "whatif", "analyst", "factcheck", "personalise", "answer"])
      const end = live.updates.at(-1)!
      if (end.kind !== "answer") throw new Error("no answer")
      expect(typeof end.answer.verified).toBe("boolean")
      expect(end.answer).toMatchObject({ frame, cached: false })
      expect(end.answer.clip_id).toEqual(expect.any(String))
      expect(live.clip).not.toBeNull()
      expect(live.clip!.real.at(-1)!.frame).toBeLessThanOrEqual(frame)
    } finally {
      await api.stop()
    }

    // The demo cache, written through the same Ask path, at the same frame.
    const lines: string[] = []
    const built = await buildAskCache({ library: dirname(lib.run), matchId: MATCH_ID, frames: [frame], agentsUrl, segments: [segment, { ...segment, lang: "es" }], log: (l) => lines.push(l) })
    expect(built.failed).toEqual([])
    const key = askCacheKey(frame, chipId, segment)
    expect(key).toBe(`${frame}:${frame}:what_if_pass:${segment.lang}:${segment.mode}`)
    expect(built.written).toContain(key)
    expect(built.written).toContain(askCacheKey(frame, chipId, { ...segment, lang: "es" }))
    expect(built.path).toBe(join(lib.run, "ask-cache.json"))
    const match = readMatch(lib.run, league)
    expect(match.askCache.get(key)?.clip?.real.at(-1)!.frame).toBeLessThanOrEqual(frame)
    // A rerun whose asks all fail reports them and keeps what the file holds.
    const before = readFileSync(built.path, "utf8")
    const again = await buildAskCache({ library: dirname(lib.run), matchId: MATCH_ID, frames: [frame], agentsUrl, segments: [segment], ask: { send: OFFLINE_SENDER } })
    expect(again.written).toEqual([])
    expect(again.failed).toContainEqual(expect.objectContaining({ key, reason: "offline" }))
    expect(JSON.parse(readFileSync(built.path, "utf8"))).toEqual(JSON.parse(before))

    // A fresh API with no agent service: an uncached ask would fail offline, the cached one replays.
    const offline = await serve({})
    try {
      const replay = await withSession(offline.port, frame, (c, sid) =>
        Effect.gen(function* () {
          const updates = [...(yield* Stream.runCollect(c.Ask({ session_id: sid, frame, question: "What if?", chip_id: chipId, segment })))]
          const end = updates.at(-1)!
          const clip = end.kind === "answer" && end.answer.clip_id ? yield* c.GetAskClip({ session_id: sid, clip_id: end.answer.clip_id }) : null
          const uncached = [...(yield* Stream.runCollect(c.Ask({ session_id: sid, frame, question: "Who is pressing?", chip_id: null, segment })))]
          // Another viewer's mode was not written: it is asked live, which fails offline here.
          const otherMode = [...(yield* Stream.runCollect(c.Ask({ session_id: sid, frame, question: "What if?", chip_id: chipId, segment: { ...segment, mode: segment.mode === "casual" ? "analyst" : "casual" } })))]
          return { updates, clip, uncached, otherMode }
        })
      )
      expect(replay.updates.map(label)).toEqual([...match.askCache.get(key)!.stages.map((s): string => s.stage), "answer"])
      const end = replay.updates.at(-1)!
      expect(end.kind === "answer" && end.answer.cached).toBe(true)
      expect(replay.clip?.real.at(-1)!.frame).toBeLessThanOrEqual(frame)
      expect(replay.uncached.map(label)).toEqual(["failed:offline"])
      expect(replay.otherMode.map(label)).toEqual(["failed:offline"])
    } finally {
      await offline.stop()
    }
  }, 300_000)
})

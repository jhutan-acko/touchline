import { createServer } from "node:net"
import { NodeSocket } from "@effect/platform-node"
import { Effect, Exit, Layer, Stream } from "effect"
import { RpcClient, RpcSerialization } from "effect/rpc"
import type { RpcClientError } from "effect/rpc/RpcClientError"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { TouchlineRpcs, type Tick } from "@touchline/rpc"
import { readMatch } from "../src/library.js"
import { RPC_PATH, serverLayer } from "../src/server.js"
import { league, makeLibrary, MATCH_ID, type TestLibrary } from "./fixture.js"

const freePort = () => new Promise<number>((ok) => {
  const s = createServer().listen(0, "127.0.0.1", () => {
    const port = (s.address() as { port: number }).port
    s.close(() => ok(port))
  })
})

let lib: TestLibrary
let port: number
let stop: () => Promise<void>
beforeAll(async () => {
  lib = await makeLibrary()
  port = await freePort()
  const fiber = Effect.runFork(Layer.launch(serverLayer({ library: new Map([[MATCH_ID, readMatch(lib.run, league)]]), port })))
  stop = async () => {
    fiber.interruptUnsafe()
  }
  for (let i = 0; i < 100 && !(await fetch(`http://127.0.0.1:${port}/health`).then((r) => r.ok, () => false)); i++) await new Promise((r) => setTimeout(r, 50))
}, 120_000)
afterAll(() => stop?.())

const client = <A, E>(f: (c: RpcClient.FromGroup<typeof TouchlineRpcs, RpcClientError>) => Effect.Effect<A, E>) =>
  Effect.runPromise(
    Effect.gen(function* () {
      const c = yield* RpcClient.make(TouchlineRpcs)
      return yield* f(c)
    }).pipe(
      Effect.scoped,
      Effect.provide(RpcClient.layerProtocolSocket().pipe(Layer.provide(NodeSocket.layerWebSocket(`ws://127.0.0.1:${port}${RPC_PATH}`)), Layer.provide(RpcSerialization.layerJson)))
    )
  )

describe("API over WebSocket", () => {
  it("answers health checks", async () => {
    expect(await (await fetch(`http://127.0.0.1:${port}/health`)).json()).toEqual({ ok: true, matches: 1 })
  })

  it("lists the library and refuses unknown matches", async () => {
    const list = await client((c) => c.ListMatches())
    expect(list.map((m) => m.match_id)).toEqual([MATCH_ID])
    expect("players" in list[0]!).toBe(false)
    const lost = await client((c) => Effect.exit(c.GetMatch({ match_id: "nope" })))
    expect(Exit.isFailure(lost) && JSON.stringify(lost.cause)).toContain("MatchNotFound")
  })

  it("plays a session to a moment, then explains its cue and pauses it", async () => {
    const goal = lib.goals[0]!
    const { ticks, ev, recap } = await client((c) =>
      Effect.gen(function* () {
        const s = yield* c.StartSession({ match_id: MATCH_ID, speed: 64, from_minute: Math.floor(goal.frame_id / 600), live: false })
        expect(s.match.players.length).toBeGreaterThan(30)
        const got = yield* c.Watch({ session_id: s.session_id, segment: { mode: "casual", lang: "en", club: "northwick" } }).pipe(
          Stream.takeUntil((t: Tick) => t.kind === "cue" && t.cue.moment_id !== null),
          Stream.runCollect
        )
        const p = yield* c.Control({ session_id: s.session_id, action: "pause", speed: null })
        expect(p.state).toBe("paused")
        const ev = yield* c.GetEvidence({ session_id: s.session_id, cue_id: `mo-${goal.id}-casual.en.northwick` })
        const recap = yield* c.GetRecap({ session_id: s.session_id, kind: "half_time", segment: { mode: "casual", lang: "en", club: null } })
        return { ticks: [...got], ev, recap }
      })
    )
    expect(ticks[0]!.kind).toBe("playback")
    expect(ticks.filter((t) => t.kind === "frame").length).toBeGreaterThan(10) // ×64: every 25th frame
    const last = ticks.at(-1)!
    expect(last.kind === "cue" && last.cue.cue_id).toBe(`mo-${goal.id}-casual.en.northwick`)
    expect(ev.cause).toBe("clear chance converted")
    // The session is paused just after the goal: the half-time recap exists only once play reaches the whistle.
    expect(recap.cards).toHaveLength(goal.period === "first_half" ? 0 : 1)
  }, 120_000)

  it("refuses to watch an unknown session", async () => {
    const lost = await client((c) => Effect.exit(Stream.runDrain(c.Watch({ session_id: "nope", segment: { mode: "casual", lang: "en", club: null } }))))
    expect(Exit.isFailure(lost) && JSON.stringify(lost.cause)).toContain("SessionNotFound")
  })
})

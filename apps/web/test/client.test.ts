// @vitest-environment node
import { createServer } from "node:net"
import { Effect, Layer } from "effect"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { readMatch, serverLayer } from "@touchline/api"
import type { StudioTick, Tick } from "@touchline/rpc"
import { connect, type TouchlineClient } from "../src/client.js"
import { league, makeLibrary, MATCH_ID, type TestLibrary } from "../../api/test/fixture.js"

const freePort = () => new Promise<number>((ok) => {
  const s = createServer().listen(0, "127.0.0.1", () => {
    const port = (s.address() as { port: number }).port
    s.close(() => ok(port))
  })
})

let lib: TestLibrary
let client: TouchlineClient
let stop: () => void
beforeAll(async () => {
  lib = await makeLibrary()
  const port = await freePort()
  const fiber = Effect.runFork(Layer.launch(serverLayer({ library: new Map([[MATCH_ID, readMatch(lib.run, league)]]), port })))
  stop = () => fiber.interruptUnsafe()
  for (let i = 0; i < 100 && !(await fetch(`http://127.0.0.1:${port}/health`).then((r) => r.ok, () => false)); i++) await new Promise((r) => setTimeout(r, 50))
  client = await connect(`ws://127.0.0.1:${port}/rpc`)
}, 120_000)
afterAll(async () => {
  await client?.close()
  stop?.()
})

describe("browser client", () => {
  it("lists matches, plays a session to a moment and explains it", async () => {
    expect((await client.listMatches()).map((m) => m.match_id)).toEqual([MATCH_ID])
    const goal = lib.goals[0]!
    const { session_id } = await client.startSession(MATCH_ID, { speed: 64, fromMinute: Math.floor(goal.frame_id / 600), live: false })
    const ticks: Tick[] = []
    await new Promise<void>((done) => {
      const stopWatching = client.watch(session_id, { mode: "analyst", lang: "es", club: null }, (t) => {
        ticks.push(t)
        if (t.kind === "cue" && t.cue.moment_id) {
          stopWatching()
          done()
        }
      })
    })
    const last = ticks.at(-1)!
    expect(last.kind === "cue" && last.cue.segment).toEqual({ mode: "analyst", lang: "es", club: null })
    expect((await client.control(session_id, "pause")).state).toBe("paused")
    const ev = await client.evidence(session_id, last.kind === "cue" ? last.cue.cue_id : "")
    expect(ev.events[0]!.id).toBe(goal.id)
  })

  it("follows a session's studio console, graphics output and ops numbers", async () => {
    const { session_id } = await client.startSession(MATCH_ID, { speed: 4, fromMinute: 0, live: false })
    const first = <T,>(follow: (on: (t: T) => void) => () => void) =>
      new Promise<T>((done) => {
        const stop = follow((t) => {
          stop()
          done(t)
        })
      })
    const segment = { mode: "casual", lang: "en", club: null } as const
    expect((await first<StudioTick>((on) => client.studio(session_id, segment, on))).kind).toBe("playback")
    expect((await first<Tick>((on) => client.graphics(session_id, segment, on))).kind).toBe("playback")
    expect((await client.ops(session_id)).session_id).toBe(session_id)
    await expect(client.act(session_id, "nope", "send")).rejects.toThrow()
  })

  it("rejects calls for unknown matches", async () => {
    await expect(client.startSession("nope", { speed: 4, fromMinute: 0, live: false })).rejects.toThrow()
  })
})

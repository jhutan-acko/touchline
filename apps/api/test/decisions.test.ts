import { cpSync, readFileSync, writeFileSync } from "node:fs"
import { createServer } from "node:net"
import { join } from "node:path"
import { NodeSocket } from "@effect/platform-node"
import { Effect, Layer } from "effect"
import { RpcClient, RpcSerialization } from "effect/rpc"
import type { RpcClientError } from "effect/rpc/RpcClientError"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { TouchlineRpcs } from "@touchline/rpc"
import type { Decision } from "@touchline/schema"
import { pickCues } from "../src/cues.js"
import { readMatch, type LibraryMatch } from "../src/library.js"
import { RPC_PATH, serverLayer } from "../src/server.js"
import { league, makeLibrary, MATCH_ID } from "./fixture.js"

const estimate = (mean: number, se: number) => ({ mean, se })
const decision = (tick: number, side: "home" | "away", pick: number): Decision => ({
  match_id: MATCH_ID, tick, minute: side === "home" ? 60 : 75, side, team_id: side === "home" ? "northwick" : "larkspur", manager: side === "home" ? "agent" : "rules",
  reasons: [side === "home" ? "minute_60" : "minute_75"], situation_hash: "h",
  options: [
    { index: 0, label: "No change", source: "no_change", orders: [], rationale: null, xg_diff_vs_no_change: estimate(0, 0), goal_diff_vs_no_change: estimate(0, 0), untested: false, dropped: [] },
    { index: 1, label: "Press higher", source: "agent", orders: [{ kind: "style", setting: "pressIntensity", value: 1 }], rationale: "Win it back.", xg_diff_vs_no_change: estimate(0.12, 0.05), goal_diff_vs_no_change: estimate(0.05, 0.04), untested: false, dropped: [] }
  ],
  pick, reason: pick === 1 ? "Press higher added 0.12 xG over no change." : "No rule applies.", orders_applied: pick === 1 ? [{ kind: "style", setting: "pressIntensity", value: 1 }] : [],
  fallback: null, timings_ms: { propose: 0, whatif: 0, choose: 0 }, tokens: { in: 0, out: 0 }, cost_usd: 0, model: "stub"
})
const DECISIONS = [decision(36000, "home", 1), decision(45000, "away", 0)]

let match: LibraryMatch
let port: number
let stop: () => void
beforeAll(async () => {
  const lib = await makeLibrary()
  // The library's match, made a managed one: its decision log and its managers in the manifest.
  const dir = join(lib.dir, "..", "managed")
  cpSync(lib.run, dir, { recursive: true })
  const manifest = JSON.parse(readFileSync(join(dir, "manifest.json"), "utf8"))
  writeFileSync(join(dir, "manifest.json"), JSON.stringify({ ...manifest, managers: { home: "agent", away: "rules", decisions: 2 } }))
  writeFileSync(join(dir, "decisions.jsonl"), DECISIONS.map((d) => JSON.stringify(d) + "\n").join(""))
  match = readMatch(dir, league)
  port = await new Promise<number>((ok) => {
    const s = createServer().listen(0, "127.0.0.1", () => {
      const p = (s.address() as { port: number }).port
      s.close(() => ok(p))
    })
  })
  const fiber = Effect.runFork(Layer.launch(serverLayer({ library: new Map([[MATCH_ID, match]]), port })))
  stop = () => fiber.interruptUnsafe()
  for (let i = 0; i < 100 && !(await fetch(`http://127.0.0.1:${port}/health`).then((r) => r.ok, () => false)); i++) await new Promise((r) => setTimeout(r, 50))
}, 120_000)
afterAll(() => stop?.())

const client = <A, E>(f: (c: RpcClient.FromGroup<typeof TouchlineRpcs, RpcClientError>) => Effect.Effect<A, E>) =>
  Effect.runPromise(
    Effect.gen(function* () {
      return yield* f(yield* RpcClient.make(TouchlineRpcs))
    }).pipe(
      Effect.scoped,
      Effect.provide(RpcClient.layerProtocolSocket().pipe(Layer.provide(NodeSocket.layerWebSocket(`ws://127.0.0.1:${port}${RPC_PATH}`)), Layer.provide(RpcSerialization.layerJson)))
    )
  )

describe("a managed match in the library", () => {
  it("names its managers and keeps its decisions", () => {
    expect(match.info.managers).toEqual({ home: "agent", away: "rules" })
    expect(match.decisions).toEqual(DECISIONS)
  })
  it("shows each decision as a cue at its moment: the pick and the manager's reason, in English", () => {
    const cues = pickCues(match.cues, { mode: "casual", lang: "es", club: null }).filter((c) => c.display.template === "manager_decision")
    expect(cues.map((c) => [c.anchor.frame_to, c.segment.lang, c.text?.headline, c.text?.body, c.evidence])).toEqual([
      [36000, "en", "Northwick Mariners: Press higher", "Press higher added 0.12 xG over no change.", ["decision-36000-home"]],
      [45000, "en", "Larkspur City keep their plan", "No rule applies.", ["decision-45000-away"]]
    ])
    expect(cues[0]!.data).toEqual({ "decision.options": 1, "decision.xg_gain": 0.12 })
  })
})

describe("GetDecisions", () => {
  it("answers with the decisions the session has reached, never later ones", async () => {
    const at = (minute: number) =>
      client((c) =>
        Effect.gen(function* () {
          const s = yield* c.StartSession({ match_id: MATCH_ID, speed: 1, from_minute: minute, live: false })
          yield* c.Control({ session_id: s.session_id, action: "pause", speed: null })
          return (yield* c.GetDecisions({ session_id: s.session_id })).map((d) => d.tick)
        })
      )
    expect(await at(0)).toEqual([])
    expect(await at(70)).toEqual([36000])
    expect(await at(85)).toEqual([36000, 45000])
  }, 120_000)
})

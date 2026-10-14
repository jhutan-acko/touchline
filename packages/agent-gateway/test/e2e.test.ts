/**
 * The full stack on one simulated match (spec §7 "end to end"): the Python agent service on the stub model, the MCP
 * stats server and the gateway; every request answered within the live budget and no unverified cue.
 */
import { spawn, spawnSync, type ChildProcess } from "node:child_process"
import { mkdtempSync } from "node:fs"
import { createServer } from "node:net"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { Effect } from "effect"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { a2aSender } from "../src/a2a.js"
import { readCueCache, writeCache } from "../src/cache.js"
import { DEFAULT_OPTIONS, runGateway, type GatewayResult } from "../src/gateway.js"
import { startMcpStats, type McpServer } from "../src/mcp.js"
import { replaySignals, root } from "../src/replay.js"

const freePort = () => new Promise<number>((ok) => {
  const s = createServer().listen(0, "127.0.0.1", () => {
    const port = (s.address() as { port: number }).port
    s.close(() => ok(port))
  })
})

const segments = [{ mode: "casual" as const, lang: "es" as const, club: "northwick" }, { mode: "analyst" as const, lang: "hi" as const, club: null }]
let agents: ChildProcess
let mcp: McpServer
let run: string
let result: GatewayResult

beforeAll(async () => {
  // Seed 293: the test needs a costly error explained as a mis-hit clearance under pressure. It is the agents suite's error
  // match (services/agents/tests/conftest.py ERROR_SEED, found by services/agents/scripts/find_test_seed.py): its only
  // critical error is such a clearance. Re-pin both together when the engine or the params file changes.
  run = join(mkdtempSync(join(tmpdir(), "gw-e2e-")), "e2e-err-293")
  spawnSync("pnpm", ["-s", "sim", "--scenario", "costly_error", "--seed", "293", "--match-id", "e2e-err-293", "--out", run], { cwd: root, stdio: "ignore" })
  const port = await freePort()
  agents = spawn("uv", ["run", "--project", "services/agents", "touchline-agents", "--port", String(port)], { cwd: root, env: { ...process.env, TOUCHLINE_LLM: "stub" }, detached: true, stdio: "ignore" })
  const url = `http://127.0.0.1:${port}/`
  for (let i = 0; i < 300; i++) {
    if (await fetch(`${url}.well-known/agent-card.json`).then((r) => r.ok, () => false)) break
    await new Promise((r) => setTimeout(r, 200))
  }
  mcp = await startMcpStats(run)
  const match = await Effect.runPromise(replaySignals(run))
  result = await Effect.runPromise(runGateway(a2aSender(url), { ...match, mcpUrl: mcp.url }, { ...DEFAULT_OPTIONS, segments, budgetMs: 4000 }))
  writeCache(run, result)
}, 240_000)

afterAll(() => {
  mcp?.stop()
  if (agents?.pid) process.kill(-agents.pid, "SIGTERM")
})

describe("gateway and agent service", () => {
  it("answer every request within the live budget", () => {
    expect(result.requests.length).toBeGreaterThan(20)
    expect(result.requests.filter((r) => r.outcome !== "ok")).toEqual([])
    expect(Math.max(...result.requests.map((r) => r.ms))).toBeLessThan(4000)
  })

  it("publish only verified cues, one per segment per moment, anchored to the moment", () => {
    expect(result.requests.reduce((n, r) => n + r.unverified + r.late, 0)).toBe(0)
    for (const t of result.traces) {
      const cues = result.cues.filter((c) => c.moment_id === t.moment.moment_id)
      expect(cues.map((c) => c.segment)).toEqual(segments)
      for (const c of cues) expect([c.anchor.frame_from, c.anchor.frame_to]).toEqual([t.moment.frame_from, t.moment.frame_to])
    }
  })

  it("explain the scripted error and recap both halves", () => {
    expect(result.traces.some((t) => t.moment.type === "costly_error" && t.analysis.cause === "mis-hit clearance under pressure")).toBe(true)
    expect(result.recaps.map((r) => r.kind)).toEqual(["half_time", "full_time"])
    expect(result.cues.filter((c) => c.display.slot === "recap_card")).toHaveLength(4)
  })

  it("leave a cue cache that replays without the agents", () => {
    expect(readCueCache(run)).toEqual(result.cues)
  })
})

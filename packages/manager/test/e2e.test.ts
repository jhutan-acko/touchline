/**
 * The manager over the real wire: the Python agent service on the stub model, a Situation built by the engine, and a
 * decision through propose, re-simulation and choose (the Pydantic models forbid unknown fields, so this also proves
 * the two sides agree on every field).
 */
import { spawn, type ChildProcess } from "node:child_process"
import { createServer } from "node:net"
import { Effect } from "effect"
import { a2aSender } from "@touchline/agent-gateway"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { agentManager } from "../src/agent.js"
import { situationAt, situationHash } from "../src/situation.js"
import { leagueConfig, playMoments, root } from "./helpers.js"

const freePort = () => new Promise<number>((ok) => {
  const s = createServer().listen(0, "127.0.0.1", () => {
    const port = (s.address() as { port: number }).port
    s.close(() => ok(port))
  })
})

let agents: ChildProcess
let url: string

beforeAll(async () => {
  const port = await freePort()
  agents = spawn("uv", ["run", "--project", "services/agents", "touchline-agents", "--port", String(port)], { cwd: root, env: { ...process.env, TOUCHLINE_LLM: "stub" }, detached: true, stdio: "ignore" })
  url = `http://127.0.0.1:${port}/`
  for (let i = 0; i < 300; i++) {
    if (await fetch(`${url}.well-known/agent-card.json`).then((r) => r.ok, () => false)) break
    await new Promise((r) => setTimeout(r, 200))
  }
}, 120_000)

afterAll(() => {
  if (agents?.pid) process.kill(-agents.pid, "SIGTERM")
})

describe("the manager agent service", () => {
  it("takes a situation built by the engine, proposes, and chooses among the tested options", async () => {
    const run = playMoments(leagueConfig(11), (m) => m.reasons.includes("minute_60"))
    const m = run.moments.at(-1)!
    for (const side of ["home", "away"] as const) {
      const situation = situationAt(m.state, side, m.reasons, run.watch)
      const d = await Effect.runPromise(agentManager(a2aSender(url), { whatif: { seeds: 2, horizonS: 30 } }).decide({ state: m.state, side, reasons: m.reasons, situation, situationHash: situationHash(situation) }))
      expect(d.fallback).toBeNull()
      expect(d.model).toBe("stub")
      expect(d.options.length).toBeGreaterThanOrEqual(3)
      expect(d.options.filter((o) => o.source === "agent").every((o) => o.dropped.length === 0)).toBe(true)
    }
  })
})

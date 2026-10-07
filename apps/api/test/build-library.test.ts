import { spawn, type ChildProcess } from "node:child_process"
import { mkdtempSync, rmSync } from "node:fs"
import { createServer } from "node:net"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterAll, describe, expect, it } from "vitest"
import { segmentKey } from "@touchline/schema"
import { BuildError, buildLibrary, librarySegments } from "../src/build-library.js"
import { scanLibrary } from "../src/library.js"
import { league, root } from "./fixture.js"

const freePort = () => new Promise<number>((ok) => {
  const s = createServer().listen(0, "127.0.0.1", () => {
    const port = (s.address() as { port: number }).port
    s.close(() => ok(port))
  })
})

let agents: ChildProcess | undefined
const dirs: string[] = []
const tmp = () => {
  const d = mkdtempSync(join(tmpdir(), "lib-"))
  dirs.push(d)
  return d
}
afterAll(() => {
  if (agents?.pid) process.kill(-agents.pid, "SIGTERM")
  for (const d of dirs) rmSync(d, { recursive: true, force: true }) // simulated matches, about 80 MB each
})

describe("library builder", () => {
  it("covers twelve segments: both modes, three languages, neutral and the home club", () => {
    const s = librarySegments("northwick")
    expect(s).toHaveLength(12)
    expect(new Set(s.map(segmentKey)).size).toBe(12)
    expect(s.filter((x) => x.club === "northwick")).toHaveLength(6)
  })

  it("simulates without agents, and says how to start the agent service when it is missing", async () => {
    const out = tmp()
    await buildLibrary({ out, scenarios: ["even_contest"], seed: 3, agentsUrl: null })
    const lib = scanLibrary(out, league)
    expect([...lib.keys()]).toEqual(["lib-even_contest-3"])
    expect(lib.get("lib-even_contest-3")!.info.segments).toEqual([])
    await expect(buildLibrary({ out, scenarios: ["even_contest"], seed: 3, agentsUrl: "http://127.0.0.1:9/" })).rejects.toThrow(BuildError)
    await expect(buildLibrary({ out, scenarios: ["even_contest"], seed: 3, agentsUrl: "http://127.0.0.1:9/" })).rejects.toThrow(/touchline-agents/)
  }, 120_000)

  it("caches the agents' cues for every segment through the agent service (stub model)", async () => {
    const port = await freePort()
    agents = spawn("uv", ["run", "--project", "services/agents", "touchline-agents", "--port", String(port)], { cwd: root, env: { ...process.env, TOUCHLINE_LLM: "stub" }, detached: true, stdio: "ignore" })
    const url = `http://127.0.0.1:${port}/`
    for (let i = 0; i < 300 && !(await fetch(`${url}.well-known/agent-card.json`).then((r) => r.ok, () => false)); i++) await new Promise((r) => setTimeout(r, 200))
    const out = tmp()
    await buildLibrary({ out, scenarios: ["costly_error"], seed: 2, agentsUrl: url })
    const m = scanLibrary(out, league).get("lib-costly_error-2")!
    expect(m.info.segments).toHaveLength(12)
    expect(m.info.model).toBe("stub")
    expect(m.cues.length).toBeGreaterThan(100)
  }, 300_000)
})

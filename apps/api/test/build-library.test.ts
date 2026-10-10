import { spawn, type ChildProcess } from "node:child_process"
import { mkdtempSync, readFileSync, rmSync } from "node:fs"
import { createServer } from "node:net"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterAll, describe, expect, it } from "vitest"
import { decodeMomentTrace, segmentKey } from "@touchline/schema"
import { BuildError, buildLibrary, librarySegments, parseManaged } from "../src/build-library.js"
import { scanLibrary } from "../src/library.js"
import { betterMomentId } from "../src/betterpass.js"
import { betterOptionEvents, readWhatIfs } from "../src/whatif.js"
import { league, root } from "./fixture.js"

const freePort = () => new Promise<number>((ok) => {
  const s = createServer().listen(0, "127.0.0.1", () => {
    const port = (s.address() as { port: number }).port
    s.close(() => ok(port))
  })
})

let agents: ChildProcess | undefined
let started = ""
const agentsUrl = () => started
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
    started = url
    for (let i = 0; i < 300 && !(await fetch(`${url}.well-known/agent-card.json`).then((r) => r.ok, () => false)); i++) await new Promise((r) => setTimeout(r, 200))
    const out = tmp()
    await buildLibrary({ out, scenarios: ["costly_error"], seed: 2, agentsUrl: url })
    const m = scanLibrary(out, league).get("lib-costly_error-2")!
    expect(m.info.segments).toHaveLength(12)
    expect(m.info.model).toBe("stub")
    expect(m.cues.length).toBeGreaterThan(100)
    // Every pass the agents said had a better option has its what-if clip cached (the scenario has at least one), and so
    // has every verified better pass the scan found, each with a cue of its own.
    const named = betterOptionEvents(readFileSync(join(m.dir, "agents", "traces.jsonl"), "utf8").trim().split("\n").map((l) => decodeMomentTrace(JSON.parse(l))))
    expect(named.length).toBeGreaterThan(0)
    const clips = readWhatIfs(m.dir)
    for (const id of named) expect(clips.has(id)).toBe(true)
    const found = [...clips.values()].filter((c) => c.verdict === "better_option_found")
    expect(found.length).toBeGreaterThan(0)
    for (const c of found) expect(m.cues.filter((q) => q.moment_id === betterMomentId(c.event_id))).toHaveLength(6)
  }, 600_000)

  it("reads managed matches as home:away:seed and builds them only with the agent service", async () => {
    expect(parseManaged("ironmoor:saltmarsh:5001, northwick:larkspur:7")).toEqual([{ home: "ironmoor", away: "saltmarsh", seed: 5001 }, { home: "northwick", away: "larkspur", seed: 7 }])
    expect(parseManaged("")).toEqual([])
    expect(() => parseManaged("ironmoor:saltmarsh")).toThrow(/is not home:away:seed/)
    await expect(buildLibrary({ out: tmp(), scenarios: [], seed: 1, managed: parseManaged("ironmoor:saltmarsh:1"), agentsUrl: null })).rejects.toThrow("managed matches need the agent service")
  })

  it("adds a managed match: the manager agent for both teams, its decisions shown as cues, annotated like any match (stub model)", async () => {
    const url = (await fetch(`${agentsUrl()}.well-known/agent-card.json`).then((r) => r.ok, () => false)) ? agentsUrl() : null
    expect(url).not.toBeNull() // started by the test above
    const out = tmp()
    await buildLibrary({ out, scenarios: [], seed: 1, managed: [{ home: "northwick", away: "larkspur", seed: 3 }], agentsUrl: url, whatif: { seeds: 2, horizonS: 60 } })
    const m = scanLibrary(out, league).get("lib-managed-northwick-larkspur-3")!
    expect(m.info.managers).toEqual({ home: "agent", away: "agent" })
    expect(m.info.segments).toHaveLength(12)
    expect(m.decisions.length).toBeGreaterThanOrEqual(6)
    expect(m.cues.filter((c) => c.display.template === "manager_decision")).toHaveLength(2 * m.decisions.length)
  }, 600_000)
})

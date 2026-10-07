/**
 * Fill the match library: simulate the built-in scenarios and run each through the agent service (pnpm agents'
 * gateway), so every match plays with its cached cues (spec §6 cached replay). Deterministic for a stub model.
 */
import { spawnSync } from "node:child_process"
import { join } from "node:path"
import { Effect } from "effect"
import { a2aSender, DEFAULT_OPTIONS, replaySignals, runGateway, startMcpStats, summarize, writeCache } from "@touchline/agent-gateway"
import type { Segment } from "@touchline/schema"
import { SCENARIOS } from "@touchline/sim"
import { root } from "./playback.js"

export class BuildError extends Error {}

/** Twelve segments (the spec's cap): casual and analyst, in English, Spanish and Hindi, neutral and for the home club. */
export const librarySegments = (homeClub: string): Segment[] =>
  (["casual", "analyst"] as const).flatMap((mode) => (["en", "es", "hi"] as const).flatMap((lang) => [null, homeClub].map((club) => ({ mode, lang, club }))))

export interface BuildOptions {
  readonly out: string
  readonly scenarios: ReadonlyArray<string>
  readonly seed: number
  /** The agent service, or null to simulate only (matches play with stats cues and no agent cues). */
  readonly agentsUrl: string | null
  readonly log?: (line: string) => void
}

/** Simulate and (with an agent service) annotate each scenario; returns the run folders written. */
export const buildLibrary = async (o: BuildOptions): Promise<string[]> => {
  const log = o.log ?? (() => {})
  if (o.agentsUrl && !(await fetch(new URL(".well-known/agent-card.json", o.agentsUrl)).then((r) => r.ok, () => false)))
    throw new BuildError(`no agent service at ${o.agentsUrl} (start it with: uv run --project services/agents touchline-agents), or pass --no-agents`)
  const dirs: string[] = []
  for (const scenario of o.scenarios) {
    const sc = SCENARIOS[scenario]
    if (!sc) throw new BuildError(`unknown scenario ${scenario} (${Object.keys(SCENARIOS).join(", ")})`)
    const id = `lib-${scenario}-${o.seed}`
    const dir = join(o.out, id)
    const sim = spawnSync("pnpm", ["-s", "sim", "--scenario", scenario, "--seed", String(o.seed), "--match-id", id, "--out", dir], { cwd: root, encoding: "utf8" })
    if (sim.status !== 0) throw new BuildError(`pnpm sim failed for ${scenario}: ${sim.stderr.slice(-400)}`)
    log(`simulated ${id}`)
    if (o.agentsUrl) {
      const plan = await Effect.runPromise(replaySignals(dir))
      const mcp = await startMcpStats(dir)
      try {
        const result = await Effect.runPromise(runGateway(a2aSender(o.agentsUrl), { ...plan, mcpUrl: mcp.url }, { ...DEFAULT_OPTIONS, segments: librarySegments(sc.home) }))
        writeCache(dir, result)
        const s = summarize(result)
        log(`  ${s.moments} moments, ${s.cues} cues (${s.models.join(", ") || "no model"})`)
      } finally {
        mcp.stop()
      }
    }
    dirs.push(dir)
  }
  return dirs
}

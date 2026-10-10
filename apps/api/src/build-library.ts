/**
 * Fill the match library: simulate the built-in scenarios, and any managed matches (Plan 4b: the manager agent for
 * both teams, through pnpm manage), and run each through the agent service (pnpm agents' gateway), so every match
 * plays with its cached cues (spec §6 cached replay), and cache the what-if clip of every pass the agents called a
 * mistake. Deterministic for a stub model.
 */
import { spawnSync } from "node:child_process"
import { join } from "node:path"
import { Effect } from "effect"
import { a2aSender, DEFAULT_OPTIONS, replaySignals, runGateway, startMcpStats, summarize, writeCache } from "@touchline/agent-gateway"
import type { Segment } from "@touchline/schema"
import { SCENARIOS } from "@touchline/sim"
import { root } from "./playback.js"
import { betterOptionEvents, scanPasses, writeWhatIfs } from "./whatif.js"

export class BuildError extends Error {}

/** Twelve segments (the spec's cap): casual and analyst, in English, Spanish and Hindi, neutral and for the home club. */
export const librarySegments = (homeClub: string): Segment[] =>
  (["casual", "analyst"] as const).flatMap((mode) => (["en", "es", "hi"] as const).flatMap((lang) => [null, homeClub].map((club) => ({ mode, lang, club }))))

/** A managed match for the library: two clubs and a seed, both teams managed by the manager agent. */
export interface ManagedFixture {
  readonly home: string
  readonly away: string
  readonly seed: number
}

/** "home:away:seed,…" (e.g. "ironmoor:saltmarsh:5001"). */
export const parseManaged = (text: string): ManagedFixture[] =>
  text.split(",").map((x) => x.trim()).filter(Boolean).map((x) => {
    const [home, away, seed] = x.split(":")
    if (!home || !away || !seed || !/^\d+$/.test(seed)) throw new BuildError(`--managed: "${x}" is not home:away:seed`)
    return { home, away, seed: Number(seed) }
  })

export interface BuildOptions {
  readonly out: string
  readonly scenarios: ReadonlyArray<string>
  /** Managed matches to add (they need the agent service). */
  readonly managed?: ReadonlyArray<ManagedFixture>
  /** How a managed match's agents test their options (default: pnpm manage's 20 forks over 600 s). */
  readonly whatif?: { readonly seeds: number; readonly horizonS: number }
  readonly seed: number
  /** The agent service, or null to simulate only (matches play with stats cues and no agent cues). */
  readonly agentsUrl: string | null
  readonly log?: (line: string) => void
  /** Threads for the better-pass scan (default: all cores but two). */
  readonly workers?: number
}

/** Simulate and (with an agent service) annotate each scenario; returns the run folders written. */
export const buildLibrary = async (o: BuildOptions): Promise<string[]> => {
  const log = o.log ?? (() => {})
  if (o.agentsUrl && !(await fetch(new URL(".well-known/agent-card.json", o.agentsUrl)).then((r) => r.ok, () => false)))
    throw new BuildError(`no agent service at ${o.agentsUrl} (start it with: uv run --project services/agents touchline-agents), or pass --no-agents`)
  if ((o.managed ?? []).length > 0 && !o.agentsUrl) throw new BuildError("managed matches need the agent service (drop --no-agents)")
  for (const scenario of o.scenarios) if (!SCENARIOS[scenario]) throw new BuildError(`unknown scenario ${scenario} (${Object.keys(SCENARIOS).join(", ")})`)
  // Each match: its id, the club its segments are framed for, and the command that writes its run folder.
  const jobs = [
    ...o.scenarios.map((scenario) => {
      const id = `lib-${scenario}-${o.seed}`
      return { id, club: SCENARIOS[scenario]!.home, cmd: ["sim", "--scenario", scenario, "--seed", String(o.seed), "--match-id", id] }
    }),
    ...(o.managed ?? []).map((f) => {
      const id = `lib-managed-${f.home}-${f.away}-${f.seed}`
      return { id, club: f.home, cmd: ["manage", "--seed", String(f.seed), "--home", f.home, "--away", f.away, "--home-manager", "agent", "--away-manager", "agent", "--agents-url", o.agentsUrl!, "--match-id", id,
        ...(o.whatif ? ["--whatif-seeds", String(o.whatif.seeds), "--whatif-horizon", String(o.whatif.horizonS)] : [])] }
    })
  ]
  const dirs: string[] = []
  for (const job of jobs) {
    const { id } = job
    const dir = join(o.out, id)
    const sim = spawnSync("pnpm", ["-s", ...job.cmd, "--out", dir], { cwd: root, encoding: "utf8" })
    if (sim.status !== 0) throw new BuildError(`pnpm ${job.cmd[0]} failed for ${id}: ${sim.stderr.slice(-400)}`)
    log(`simulated ${id}`)
    if (o.agentsUrl) {
      const plan = await Effect.runPromise(replaySignals(dir))
      const mcp = await startMcpStats(dir)
      try {
        const result = await Effect.runPromise(runGateway(a2aSender(o.agentsUrl), { ...plan, mcpUrl: mcp.url }, { ...DEFAULT_OPTIONS, segments: librarySegments(job.club) }))
        writeCache(dir, result)
        const s = summarize(result)
        log(`  ${s.moments} moments, ${s.cues} cues (${s.models.join(", ") || "no model"})`)
        // The what-if split answers library matches at once: every pass played in the opponents' half re-simulated now
        // (the verified better ones become cues of their own), and every pass the agents called a mistake.
        const scan = await scanPasses(dir, o.workers ? { workers: o.workers } : {})
        log(`  scanned ${scan.examined} attacking passes`)
        writeWhatIfs(dir, betterOptionEvents(result.traces), scan.clips, log)
      } finally {
        mcp.stop()
      }
    }
    dirs.push(dir)
  }
  return dirs
}

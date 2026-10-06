import { resolve } from "node:path"
import { Effect } from "effect"
import { CliError, cliOptions, exitOnUserError, integer, positiveInteger } from "@touchline/sim"
import { ReplayError } from "@touchline/stats"
import { a2aSender } from "./a2a.js"
import { summarize, writeCache } from "./cache.js"
import { DEFAULT_OPTIONS, runGateway } from "./gateway.js"
import { startMcpStats } from "./mcp.js"
import { replaySignals } from "./replay.js"
import { parseSegments, SegmentError } from "./segments.js"

// pnpm runs package scripts from the package folder; INIT_CWD is where the user typed the command.
const here = (p: string) => resolve(process.env.INIT_CWD ?? process.cwd(), p)

const o = cliOptions("touchline-agents: run a match's signals through the agent service and cache the verified cues", {
  run: { default: "", help: "run folder written by pnpm sim" },
  agents: { default: "http://127.0.0.1:8100/", help: "the agent service (A2A), started with: uv run --project services/agents touchline-agents" },
  segments: { default: "casual.en.neutral,analyst.en.neutral", help: "viewer segments, mode.lang.club, comma-separated (at most 12)" },
  batch: { default: String(DEFAULT_OPTIONS.batchS), check: positiveInteger, help: "seconds of game time per signals batch" },
  "budget-ms": { default: "0", check: integer(0, 600_000), help: "time limit per request in ms (4000 for live pacing; 0: none, for recorded runs)" },
  "mcp-url": { default: "", help: "the match's MCP stats server (default: start one for the run)" }
})
const segments = exitOnUserError(() => {
  if (o.run === "") throw new CliError("--run is required (a folder written by pnpm sim, e.g. out/m-1)")
  return parseSegments(o.segments)
}, [SegmentError])

const main = async () => {
  const dir = here(o.run)
  const match = await Effect.runPromise(replaySignals(dir))
  const mcp = o["mcp-url"] ? { url: o["mcp-url"], stop: () => {} } : await startMcpStats(dir)
  try {
    console.error(`${match.matchId}: ${match.signals.length} signals, stats on ${mcp.url}, agents on ${o.agents}`)
    const result = await Effect.runPromise(
      runGateway(a2aSender(o.agents), { ...match, mcpUrl: mcp.url }, { ...DEFAULT_OPTIONS, segments, batchS: Number(o.batch), budgetMs: Number(o["budget-ms"]) })
    )
    const out = writeCache(dir, result)
    console.log(JSON.stringify(summarize(result), null, 2))
    console.error(`wrote ${out}`)
    if (!result.requests.some((r) => r.outcome === "ok")) process.exitCode = 1
  } finally {
    mcp.stop()
  }
}

main().catch((e) => {
  if (e instanceof ReplayError) {
    console.error(e.message)
    process.exit(2)
  }
  throw e
})

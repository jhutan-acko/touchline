import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { z } from "zod"
import { EventType, SignalType } from "@touchline/schema"
import { METRICS, StatsError, type StatsQuery } from "@touchline/stats"
import { registerAdvisorTools, type Advisor } from "./advise.js"

export const SERVER_NAME = "touchline-stats"
export const SERVER_VERSION = "0.1.0"

const instructions = (fps: number) => [
  "Read-only statistics for one football match from the Touchline stats engine.",
  "Every number you state must come from these tools: cite the metric id and the `ref` (metric@from-to) or event ids they return.",
  `Frames are global ticks (${fps} per second in this match; match_info gives dt and fps); every answer says which frame it is as of (\`as_of_frame\`) and never includes anything later.`,
  "Subjects are \"match\", a team id or a player id (match_info lists them). list_metrics says which subjects and windows each metric supports.",
  "what_if, explain_pass and suggest_position re-simulate from the state at a frame; their numbers are estimates with standard errors, never facts about the match."
].join(" ")
const eventType = z.enum([...EventType.literals] as [string, ...string[]])

const metricIds = METRICS.map((m) => m.id) as [string, ...string[]]
const signalType = z.enum([...SignalType.literals] as [string, ...string[]])
const metricId = z.enum(metricIds).describe("metric id, e.g. team.press (list_metrics gives them all)")
const subject = z.string().describe('"match", a team id or a player id')
const atFrame = z.number().int().min(0).optional().describe("answer as of this frame (default: the latest)")
const windowS = z.number().positive().max(7200).nullable().optional().describe("only the last N seconds (windowed metrics; null for the match so far; default: the metric's own)")
const fromFrame = z.number().int().min(0).optional().describe("first frame (default: kickoff)")
const toFrame = z.number().int().min(0).optional().describe("last frame (default: the latest)")

const ok = (v: unknown) => ({ content: [{ type: "text" as const, text: JSON.stringify(v) }] })
const fail = (message: string) => ({ content: [{ type: "text" as const, text: message }], isError: true })

/** Run a query; a StatsError (bad id, no such event) becomes a tool error the agent can read and correct. */
const answer = (f: () => unknown) => {
  try {
    return ok(f())
  } catch (e) {
    if (e instanceof StatsError) return fail(e.message)
    throw e
  }
}

const readOnly = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false } as const

/** An MCP server exposing the stats tools (spec §5.3) over one match's StatsQuery; the re-simulation tools need `advisor`. */
export const createStatsServer = (q: StatsQuery, advisor: Advisor | null = null): McpServer => {
  const server = new McpServer({ name: SERVER_NAME, version: SERVER_VERSION }, { instructions: instructions(Math.round(1 / q.engine.info.dt)) })

  server.registerTool(
    "match_info",
    { title: "Match info", description: "Teams, players (id, name, role, jersey), the score and the latest frame.", inputSchema: { at_frame: atFrame }, annotations: readOnly },
    async ({ at_frame }) => answer(() => q.matchInfo(at_frame))
  )

  server.registerTool(
    "list_metrics",
    { title: "List metrics", description: "Every metric id with its name, unit, subjects, whether it takes a window, and how it is computed.", annotations: readOnly },
    async () => answer(() => q.metrics())
  )

  server.registerTool(
    "get_metric",
    {
      title: "Get a metric",
      description: "One metric's value for a subject as of a frame, with the frame range it covers and a ref to cite.",
      inputSchema: { metric_id: metricId, subject, at_frame: atFrame, window_s: windowS },
      annotations: readOnly
    },
    async ({ metric_id, subject, at_frame, window_s }) => answer(() => q.metric(metric_id, subject, at_frame, window_s))
  )

  server.registerTool(
    "get_series",
    {
      title: "Get a metric over time",
      description: "A metric's value for a subject every `step_s` seconds between two frames (at most 500 points).",
      inputSchema: { metric_id: metricId, subject, from_frame: fromFrame, to_frame: toFrame, step_s: z.number().positive().max(3600).optional().describe("seconds between points (default 60)"), window_s: windowS },
      annotations: readOnly
    },
    async ({ metric_id, subject, from_frame, to_frame, step_s, window_s }) => answer(() => q.series(metric_id, subject, from_frame ?? 0, to_frame ?? q.asOf(), step_s, window_s))
  )

  server.registerTool(
    "rank_players",
    {
      title: "Rank players",
      description: "Players ranked by a player metric (top N, highest first unless order is asc), optionally for one team.",
      inputSchema: {
        metric_id: metricId,
        team_id: z.string().optional().describe("only this team's players"),
        at_frame: atFrame,
        window_s: windowS,
        top: z.number().int().min(1).max(40).optional().describe("how many (default 5)"),
        order: z.enum(["desc", "asc"]).optional()
      },
      annotations: readOnly
    },
    async ({ metric_id, team_id, at_frame, window_s, top, order }) =>
      answer(() => ({ metric_id, as_of_frame: q.asOf(at_frame), players: q.rankPlayers(metric_id, { ...(team_id ? { teamId: team_id } : {}), at: at_frame ?? null, ...(window_s !== undefined ? { windowS: window_s } : {}), ...(top ? { top } : {}), ...(order ? { order } : {}) }) }))
  )

  server.registerTool(
    "get_signals",
    {
      title: "Get signals",
      description: "Signals the stats engine raised (goals, big chances, pressure shifts, momentum swings, ...), oldest first, with salience 0..1 and evidence.",
      inputSchema: {
        from_frame: fromFrame,
        to_frame: toFrame,
        types: z.array(signalType).optional().describe("only these signal types"),
        team_id: z.string().optional(),
        min_salience: z.number().min(0).max(1).optional(),
        limit: z.number().int().min(1).max(500).optional().describe("at most this many, the latest kept (default 50)")
      },
      annotations: readOnly
    },
    async ({ from_frame, to_frame, types, team_id, min_salience, limit }) =>
      answer(() => {
        const all = q.signalsBetween(from_frame ?? null, to_frame, { ...(types ? { types } : {}), ...(team_id ? { teamId: team_id } : {}), ...(min_salience !== undefined ? { minSalience: min_salience } : {}) })
        return { as_of_frame: q.asOf(to_frame), total: all.length, signals: all.slice(-(limit ?? 50)) }
      })
  )

  server.registerTool(
    "get_events",
    {
      title: "Get events",
      description: "Match events between two frames (passes, shots, tackles, ...) with the values the stats engine derived (pass.dist, pass.xp, shot.xg, shot.speed) and what could be seen of them (qualifiers: execution such as mishit, first_touch such as heavy, under_pressure, card colour, ...). Use their ids as evidence.",
      inputSchema: {
        from_frame: fromFrame,
        to_frame: toFrame,
        types: z.array(eventType).optional().describe("only these event types, e.g. [\"shot\", \"goal\"]"),
        team_id: z.string().optional(),
        player_id: z.string().optional(),
        ids: z.array(z.string()).max(100).optional().describe("only these event ids (unknown ids are skipped)"),
        limit: z.number().int().min(1).max(500).optional().describe("at most this many, the latest kept (default 100)")
      },
      annotations: readOnly
    },
    async ({ from_frame, to_frame, types, team_id, player_id, ids, limit }) =>
      answer(() => {
        const all = q.eventsBetween(from_frame ?? null, to_frame, { ...(types ? { types } : {}), ...(team_id ? { teamId: team_id } : {}), ...(player_id ? { playerId: player_id } : {}), ...(ids ? { ids } : {}) })
        return { as_of_frame: q.asOf(to_frame), total: all.length, events: all.slice(-(limit ?? 100)) }
      })
  )

  server.registerTool(
    "get_decision",
    {
      title: "Get a decision record",
      description: "What the player could have done at an event (pass, carry, shot, take-on, clearance): each action's probability, the options ranked best first, and the rank of the one chosen.",
      inputSchema: { event_id: z.string(), at_frame: atFrame },
      annotations: readOnly
    },
    async ({ event_id, at_frame }) => answer(() => q.decision(event_id, at_frame))
  )

  server.registerTool(
    "verify_claim",
    {
      title: "Verify a claim",
      description: "Check a claimed metric value against the engine (the Fact-Checker's code check): verified when within the tolerance (2 % of the actual value, at least 0.006; a smaller tolerance may be given, never a larger one).",
      inputSchema: { metric_id: metricId, subject, at_frame: z.number().int().min(0), value: z.number(), window_s: windowS, tolerance: z.number().min(0).optional() },
      annotations: readOnly
    },
    async ({ metric_id, subject, at_frame, value, window_s, tolerance }) => answer(() => q.verifyClaim(metric_id, subject, at_frame, value, window_s, tolerance))
  )

  registerAdvisorTools(server, q, advisor)
  return server
}

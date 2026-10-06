import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { z } from "zod"
import { AdvisorError, explainPass, suggestPosition, xtEndValue, type Session } from "@touchline/advisor"
import { whatIf, WhatIfError, type Intervention, type Side } from "@touchline/sim-core"
import { StatsError, type StatsQuery, type XtGrid } from "@touchline/stats"

/** What the what-if tools need: the match rebuilt for re-simulation, and the expected-threat grid. */
export interface Advisor {
  readonly session: Session
  readonly xt: XtGrid
}

const ok = (v: unknown) => ({ content: [{ type: "text" as const, text: JSON.stringify(v) }] })
const fail = (message: string) => ({ content: [{ type: "text" as const, text: message }], isError: true })
const answer = (f: () => unknown) => {
  try {
    return ok(f())
  } catch (e) {
    if (e instanceof StatsError || e instanceof AdvisorError || e instanceof WhatIfError) return fail(e.message)
    throw e
  }
}
/** Round every number in a result to 4 decimals (results are for reading, not for further sums). */
const tidy = (v: unknown): unknown =>
  typeof v === "number" ? Math.round(v * 1e4) / 1e4 : Array.isArray(v) ? v.map(tidy) : v && typeof v === "object" ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, tidy(x)])) : v

const readOnly = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false } as const
const frame = z.number().int().min(0)
const styleSetting = z.number().min(-1).max(1).optional()
const intervention = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("none") }),
  z.object({ kind: z.literal("pass_to"), player_id: z.string().describe("the player on the ball"), receiver_id: z.string(), pass_kind: z.string().optional().describe("short, long, through, switch, cross, cutback, back, lofted_through") }),
  z.object({ kind: z.literal("move_player"), player_id: z.string(), x: z.number().min(-52.5).max(52.5), y: z.number().min(-34).max(34) }),
  z.object({
    kind: z.literal("tactic"),
    team_id: z.string(),
    style: z.object({ pressIntensity: styleSetting, lineHeight: styleSetting, compactness: styleSetting, tempo: styleSetting, longBallBias: styleSetting, crossBias: styleSetting, riskTolerance: styleSetting }).describe("press intensity, compactness, tempo, risk tolerance: 0..1; line height, long-ball and cross bias: -1..1")
  })
])

/** The what-if, explainer, advisor and pitch-control tools, added to a stats server. */
export const registerAdvisorTools = (server: McpServer, q: StatsQuery, a: Advisor | null): void => {
  const sideOf = (teamId: string): Side => {
    const t = q.engine.team(teamId)
    if (!t) throw new StatsError(`unknown team "${teamId}"; match_info lists the teams`)
    return t.side
  }
  const teamIdOf = (side: Side) => (side === "home" ? q.engine.info.home.id : q.engine.info.away.id)
  /** A frame no later than the latest ingested (what-if never looks past what the agent could know). */
  const known = (f: number | undefined) => {
    const t = q.asOf(f)
    if (f !== undefined && f > t) throw new StatsError(`frame ${f} is later than the latest frame (${t})`)
    return t
  }
  const needAdvisor = () => {
    if (!a) throw new StatsError("re-simulation is not available for this match (its run folder could not be rebuilt; see the server log)")
    return a
  }
  const toIntervention = (iv: z.infer<typeof intervention>): Intervention => {
    switch (iv.kind) {
      case "none":
        return iv
      case "pass_to":
        return { kind: "pass_to", playerId: iv.player_id, receiverId: iv.receiver_id, ...(iv.pass_kind ? { passKind: iv.pass_kind } : {}) }
      case "move_player":
        return { kind: "move_player", playerId: iv.player_id, to: { x: iv.x, y: iv.y } }
      case "tactic":
        return { kind: "tactic", side: sideOf(iv.team_id), style: Object.fromEntries(Object.entries(iv.style).filter(([, v]) => v !== undefined)) }
    }
  }

  server.registerTool(
    "pitch_control",
    {
      title: "Pitch control map",
      description: "Which team would win the ball where: a 21 x 14 grid (row-major, row 0 at y = -34, column 0 at x = -52.5) of the team's control (0..1), from the latest 10-second sample at or before the frame, and the team's share of the pitch.",
      inputSchema: { team_id: z.string(), at_frame: frame.optional() },
      annotations: readOnly
    },
    async ({ team_id, at_frame }) =>
      answer(() => {
        const side = sideOf(team_id)
        const t = q.asOf(at_frame)
        const map = q.engine.pitchControl(t)
        if (!map) throw new StatsError(`no pitch-control sample yet at frame ${t}`)
        const control = map.home.map((v) => (side === "home" ? v : 1 - v))
        return tidy({ team_id, as_of_frame: t, sample_frame: map.tick, cols: map.cols, rows: map.rows, share: control.reduce((x, y) => x + y, 0) / control.length, control })
      })
  )

  server.registerTool(
    "what_if",
    {
      title: "What if",
      description: "Re-simulate from a frame with one change (force a pass, move a player, change a team's style) against a baseline (default: no change), over paired random seeds, and report the mean and standard error of each outcome for the team and the difference: goal and xG difference, shots, possession and ball progress at the end, the expected threat left at the end, and their total.",
      inputSchema: {
        at_frame: frame,
        intervention,
        baseline: intervention.optional(),
        team_id: z.string().optional().describe("whose outcome to measure (default: the team on the ball)"),
        seeds: z.number().int().min(1).max(100).optional().describe("paired seeds (default 20)"),
        horizon_s: z.number().positive().max(60).optional().describe("seconds played ahead (default 15)")
      },
      annotations: readOnly
    },
    async ({ at_frame, intervention: iv, baseline, team_id, seeds, horizon_s }) =>
      answer(() => {
        const { session, xt } = needAdvisor()
        const t = known(at_frame)
        const r = whatIf(session.stateAt(t), toIntervention(iv), {
          ...(team_id ? { side: sideOf(team_id) } : {}),
          seeds: seeds ?? 20,
          horizonS: horizon_s ?? 15,
          endValue: xtEndValue(xt),
          ...(baseline ? { baseline: toIntervention(baseline) } : {})
        })
        const { side, ...rest } = r
        return tidy({ team_id: teamIdOf(side), ...rest })
      })
  )

  server.registerTool(
    "explain_pass",
    {
      title: "Explain a pass",
      description: "Was there a better pass? Every option the player weighed, scored on paper (pitch control x expected threat) and played out by re-simulation against the pass played; a better option is reported only when it is clearly better in play (mean above twice its standard error).",
      inputSchema: { event_id: z.string(), seeds: z.number().int().min(0).max(40).optional().describe("paired seeds per option (default 20; 0: on paper only)") },
      annotations: readOnly
    },
    async ({ event_id, seeds }) =>
      answer(() => {
        const { session, xt } = needAdvisor()
        // Only events the agent could know about by the latest frame.
        q.decision(event_id)
        return tidy(explainPass(session, event_id, xt, { seeds: seeds ?? 20 }))
      })
  )

  server.registerTool(
    "suggest_position",
    {
      title: "Suggest a position",
      description: "The best spot within 12 m for a player at a frame (a 'ghost'): in attack where a pass to them would be worth most, in defence where the ball carrier's best option is worth least; optionally checked by re-simulating the move.",
      inputSchema: { player_id: z.string(), at_frame: frame.optional(), seeds: z.number().int().min(0).max(100).optional().describe("paired seeds to check the move (default 0: no check)") },
      annotations: readOnly
    },
    async ({ player_id, at_frame, seeds }) =>
      answer(() => {
        const { session, xt } = needAdvisor()
        return tidy(suggestPosition(session, player_id, known(at_frame), xt, { seeds: seeds ?? 0 }))
      })
  )
}

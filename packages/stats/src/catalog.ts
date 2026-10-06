import type { MetricId } from "@touchline/schema"

/** What a metric can be asked about: one player, one team, or the whole match. */
export type SubjectKind = "player" | "team" | "match"

export interface MetricDef {
  readonly id: MetricId
  readonly name: string
  readonly unit: string
  readonly subjects: ReadonlyArray<SubjectKind>
  /** Whether a query can restrict the metric to the last `window` seconds. */
  readonly windowed: boolean
  /** The window used when a query gives none (null: the match so far). */
  readonly defaultWindowS: number | null
  readonly description: string
}

/** The metric catalog (spec §5.2). Ids are stable; agents must cite them. */
export const METRICS: ReadonlyArray<MetricDef> = [
  { id: "pass.dist", name: "Pass distance", unit: "m", subjects: ["player", "team"], windowed: true, defaultWindowS: null, description: "Mean length of attempted passes (start to where the ball was next played)." },
  { id: "pass.acc", name: "Pass accuracy", unit: "share", subjects: ["player", "team"], windowed: true, defaultWindowS: null, description: "Share of attempted passes completed." },
  { id: "pass.xp", name: "Pass difficulty (xPass)", unit: "probability", subjects: ["player", "team"], windowed: true, defaultWindowS: null, description: "Mean modelled completion probability of attempted passes (logistic model fitted on IDSSE: length, forward progress, defenders in lane, pressure); lower means harder passes." },
  { id: "ball.speed", name: "Ball speed", unit: "km/h", subjects: ["match"], windowed: false, defaultWindowS: null, description: "Ball speed over the last 0.2 s, from tracking." },
  { id: "shot.speed", name: "Shot speed", unit: "km/h", subjects: ["player", "team"], windowed: true, defaultWindowS: null, description: "Mean peak ball speed in the 0.3 s after a shot, from tracking." },
  { id: "plyr.vmax", name: "Top speed", unit: "km/h", subjects: ["player"], windowed: true, defaultWindowS: null, description: "Highest speed over any 0.5 s, from tracking." },
  { id: "plyr.dist", name: "Distance covered", unit: "m", subjects: ["player", "team"], windowed: true, defaultWindowS: null, description: "Distance run, from tracking (a team's is the sum of its players')." },
  { id: "shot.xg", name: "Expected goals", unit: "xG", subjects: ["player", "team"], windowed: true, defaultWindowS: null, description: "Sum of shot xG (logistic model fitted on IDSSE: distance, angle, header, defenders in the shot cone; penalties 0.76)." },
  { id: "team.mom", name: "Momentum", unit: "share", subjects: ["team"], windowed: true, defaultWindowS: null, description: "The team's share of attacking threat, exponentially decayed (2-minute half-life): forward progress of completed passes and carries towards goal, plus three times shot xG. Over a window: the mean of its 10-second samples." },
  { id: "team.press", name: "Pressure index", unit: "share", subjects: ["team"], windowed: true, defaultWindowS: 300, description: "Pressures by the team / (pressures + opponent passes)." },
  { id: "ppda", name: "PPDA", unit: "passes per action", subjects: ["team"], windowed: true, defaultWindowS: null, description: "Opponent passes in their own 60 % of the pitch per defensive action there (tackles, interceptions, fouls)." },
  { id: "tilt", name: "Field tilt", unit: "share", subjects: ["team"], windowed: true, defaultWindowS: null, description: "The team's share of passes made in the attacking third." },
  { id: "game.chaos", name: "Control vs chaos", unit: "index 0..1", subjects: ["match"], windowed: false, defaultWindowS: null, description: "Last 5 minutes: turnover rate, short possession chains and momentum volatility, each scaled to 0..1 and averaged." },
  { id: "act.xt", name: "Expected threat added", unit: "xT", subjects: ["player", "team"], windowed: true, defaultWindowS: null, description: "Sum over completed passes and carries of expected threat at the end minus at the start (12 x 8 grid fitted on IDSSE by value iteration)." },
  { id: "pitch.ctrl", name: "Pitch control", unit: "share", subjects: ["team"], windowed: true, defaultWindowS: null, description: "The team's share of the pitch it would win the ball on (Spearman pitch control over a 21 x 14 grid, sampled every 10 s); over a window, the mean of the samples." },
  { id: "team.poss", name: "Possession", unit: "share", subjects: ["team"], windowed: true, defaultWindowS: null, description: "Share of in-play time the team had the ball, from tracking." }
]

export const metricDef = (id: string): MetricDef | undefined => METRICS.find((m) => m.id === id)

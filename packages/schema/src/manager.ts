/**
 * Manager agent contracts (Plan 4b): what the engine sends the manager agent at a key moment (`Situation`, and the
 * what-if results of its options), what the agent answers (`Proposal`, `Choice`), and the decision log line.
 * `Situation` is the whole of what the model sees about the match: every field is listed here and nothing else is sent.
 */
import { Schema } from "effect"

const NonNegInt = Schema.Int.check(Schema.isGreaterThanOrEqualTo(0))
const Id = Schema.String.check(Schema.isMinLength(1))

export const StyleKey = Schema.Literals(["pressIntensity", "lineHeight", "compactness", "tempo", "longBallBias", "crossBias", "riskTolerance"])
export type StyleKey = typeof StyleKey.Type

/** One change a manager orders: a style setting to a new value, or a substitution (player ids). */
export const ManagerOrder = Schema.Union([
  Schema.Struct({ kind: Schema.Literal("style"), setting: StyleKey, value: Schema.Finite }),
  Schema.Struct({ kind: Schema.Literal("sub"), off: Id, on: Id })
]).annotate({ identifier: "ManagerOrder" })
export type ManagerOrder = typeof ManagerOrder.Type

export const MomentReason = Schema.Literals(["half_time", "after_goal", "minute_60", "minute_75"])
export type MomentReason = typeof MomentReason.Type

const Role = Schema.Literals(["GK", "CB", "FB", "DM", "CM", "AM", "W", "ST"])

/** A style setting: its value now, its allowed range and what it does. */
export const StyleSetting = Schema.Struct({ setting: StyleKey, value: Schema.Finite, min: Schema.Finite, max: Schema.Finite, meaning: Schema.String }).annotate({
  identifier: "StyleSetting"
})

/** A team's match so far, up to the pause. */
export const TeamStats = Schema.Struct({
  xg: Schema.Finite,
  shots: NonNegInt,
  possession_pct: Schema.Finite,
  pass_completion_pct: Schema.NullOr(Schema.Finite),
  /** Opponent passes per defensive action in the opponent's 60 % of the pitch (lower: more pressing); null before any. */
  ppda: Schema.NullOr(Schema.Finite),
  yellow_cards: NonNegInt,
  red_cards: NonNegInt
}).annotate({ identifier: "TeamStats" })

export const TeamView = Schema.Struct({
  name: Id,
  archetype: Schema.Literals(["high_press", "possession", "direct", "low_block"]),
  formation: Schema.String,
  style: Schema.Array(StyleSetting),
  stats: TeamStats
}).annotate({ identifier: "TeamView" })

/** A player on the pitch, as their manager sees them. */
export const PlayerView = Schema.Struct({
  id: Id,
  name: Schema.String,
  number: NonNegInt,
  role: Role,
  energy_pct: Schema.Finite,
  minutes_played: Schema.Finite,
  yellow_card: Schema.Boolean,
  shots: NonNegInt,
  xg: Schema.Finite,
  passes_completed: NonNegInt,
  tackles_won: NonNegInt
}).annotate({ identifier: "PlayerView" })

export const BenchView = Schema.Struct({ id: Id, name: Schema.String, number: NonNegInt, role: Role, available: Schema.Boolean }).annotate({ identifier: "BenchView" })

/** One side's last minutes of play; ball_regains counts tackles won, interceptions and recoveries. */
export const RecentView = Schema.Struct({ xg: Schema.Finite, shots: NonNegInt, ball_regains: NonNegInt }).annotate({ identifier: "RecentView" })

/** What the manager agent knows at a key moment: the match from its own team's side, up to the pause tick only. */
export const Situation = Schema.Struct({
  match_id: Id,
  team_id: Id,
  moment: Schema.Struct({
    reasons: Schema.Array(MomentReason).check(Schema.isMinLength(1)),
    minute: Schema.Finite,
    minutes_left: Schema.Finite,
    added_time_expected_min: Schema.Finite,
    score: Schema.Struct({ for: NonNegInt, against: NonNegInt }),
    /** "level", "winning by 2", "losing by 1". */
    score_state: Schema.String
  }),
  team: TeamView,
  opponent: TeamView,
  players: Schema.Struct({ on_pitch: Schema.Array(PlayerView), bench: Schema.Array(BenchView) }),
  limits: Schema.Struct({ subs_left: NonNegInt, windows_left: NonNegInt, half_time_break: Schema.Boolean }),
  recent: Schema.Struct({ window_min: Schema.Finite, team: RecentView, opponent: RecentView })
}).annotate({ identifier: "Situation" })
export type Situation = typeof Situation.Type

export const Estimate = Schema.Struct({ mean: Schema.Finite, se: Schema.Finite }).annotate({ identifier: "Estimate" })

/** One option as re-simulated: option 0 is always "no change", the baseline of the others. */
export const OptionResult = Schema.Struct({
  index: NonNegInt,
  label: Schema.String,
  orders: Schema.Array(ManagerOrder),
  /** Paired difference against "no change" over the same seeds; null when the option could not be tested. */
  xg_diff_vs_no_change: Schema.NullOr(Estimate),
  goal_diff_vs_no_change: Schema.NullOr(Estimate),
  untested: Schema.Boolean
}).annotate({ identifier: "OptionResult" })

export const WhatIfSummary = Schema.Struct({
  seeds: NonNegInt,
  horizon_min: Schema.Finite,
  explanation: Schema.String,
  options: Schema.Array(OptionResult).check(Schema.isMinLength(1))
}).annotate({ identifier: "WhatIfSummary" })
export type WhatIfSummary = typeof WhatIfSummary.Type

export const ManagerOption = Schema.Struct({
  label: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(60)),
  orders: Schema.Array(ManagerOrder).check(Schema.isMinLength(1)),
  rationale: Schema.String
}).annotate({ identifier: "ManagerOption" })
export type ManagerOption = typeof ManagerOption.Type

/** The agent's candidate changes ("no change" is never proposed: the engine always adds it). */
export const Proposal = Schema.Struct({ options: Schema.Array(ManagerOption).check(Schema.isMinLength(1), Schema.isMaxLength(3)) }).annotate({ identifier: "Proposal" })
export type Proposal = typeof Proposal.Type

/** The agent's pick: an index into the what-if options (0 = no change) and why. */
export const Choice = Schema.Struct({ pick: NonNegInt, reason: Schema.String }).annotate({ identifier: "Choice" })
export type Choice = typeof Choice.Type

/** A request to the manager agent: propose options, or choose among the tested ones. */
export const ManageRequest = Schema.Struct({
  kind: Schema.Literal("manage"),
  task: Schema.Literals(["propose", "choose"]),
  match_id: Id,
  situation: Situation,
  whatif: Schema.NullOr(WhatIfSummary)
}).annotate({ identifier: "ManageRequest" })
export type ManageRequest = typeof ManageRequest.Type

/** The manager agent's answer (artifact "manager"); `fallback` true means the model failed and nothing was decided. */
export const ManagerReply = Schema.Struct({
  task: Schema.Literals(["propose", "choose"]),
  proposal: Schema.NullOr(Proposal),
  choice: Schema.NullOr(Choice),
  fallback: Schema.Boolean,
  reason: Schema.NullOr(Schema.String),
  ms: Schema.Finite,
  tokens_in: NonNegInt,
  tokens_out: NonNegInt,
  cost_usd: Schema.Finite,
  model: Schema.String
}).annotate({ identifier: "ManagerReply" })
export type ManagerReply = typeof ManagerReply.Type

export const DecisionOption = Schema.Struct({
  index: NonNegInt,
  label: Schema.String,
  source: Schema.Literals(["no_change", "agent", "rules"]),
  orders: Schema.Array(ManagerOrder),
  rationale: Schema.NullOr(Schema.String),
  xg_diff_vs_no_change: Schema.NullOr(Estimate),
  goal_diff_vs_no_change: Schema.NullOr(Estimate),
  untested: Schema.Boolean,
  /** Orders the engine refused for this option, with the reason. */
  dropped: Schema.Array(Schema.Struct({ order: ManagerOrder, reason: Schema.String }))
}).annotate({ identifier: "DecisionOption" })

/** One line of a managed run's decisions.jsonl: everything needed to replay the decision and to show it. */
export const Decision = Schema.Struct({
  match_id: Id,
  tick: NonNegInt,
  minute: Schema.Finite,
  side: Schema.Literals(["home", "away"]),
  team_id: Id,
  manager: Schema.Literals(["rules", "agent"]),
  reasons: Schema.Array(MomentReason),
  /** sha256 of the exact Situation JSON sent to the model (or that the rules read). */
  situation_hash: Schema.String,
  options: Schema.Array(DecisionOption),
  pick: NonNegInt,
  reason: Schema.String,
  orders_applied: Schema.Array(ManagerOrder),
  fallback: Schema.NullOr(Schema.Literals(["propose", "choose", "service"])),
  timings_ms: Schema.Struct({ propose: Schema.Finite, whatif: Schema.Finite, choose: Schema.Finite }),
  tokens: Schema.Struct({ in: NonNegInt, out: NonNegInt }),
  cost_usd: Schema.Finite,
  model: Schema.String
}).annotate({ identifier: "Decision" })
export type Decision = typeof Decision.Type

export const decodeSituation = Schema.decodeUnknownSync(Situation)
export const decodeManagerReply = Schema.decodeUnknownSync(ManagerReply)
export const decodeDecision = Schema.decodeUnknownSync(Decision)

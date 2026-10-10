/**
 * What every manager shares: the input to a decision, the decision log line it returns, and the engine's check of a
 * proposed option against the live state (invalid orders are dropped with the reason, never applied).
 */
import { checkOrders, type MatchState, type Side } from "@touchline/sim-core"
import type { Decision, ManagerOrder, MomentReason, Situation } from "@touchline/schema"
import type { Effect } from "effect"
import { minuteOf } from "./moments.js"

/** Everything a manager is given at a key moment. */
export interface DecideInput {
  readonly state: MatchState
  readonly side: Side
  readonly reasons: ReadonlyArray<MomentReason>
  readonly situation: Situation
  /** sha256 of the exact Situation JSON (situationHash). */
  readonly situationHash: string
}

/** A team's manager: decides at each key moment and never fails (a failure is a logged fallback). */
export interface Manager {
  readonly kind: "rules" | "agent" | "replay"
  readonly decide: (input: DecideInput) => Effect.Effect<Decision>
}

export type DecisionOption = Decision["options"][number]

export const NO_CHANGE: DecisionOption = {
  index: 0, label: "No change", source: "no_change", orders: [], rationale: null,
  xg_diff_vs_no_change: { mean: 0, se: 0 }, goal_diff_vs_no_change: { mean: 0, se: 0 }, untested: false, dropped: []
}

/** An option as the engine will apply it: the orders the live state accepts, and the ones it drops (with why). */
export const checkedOption = (
  input: DecideInput,
  index: number,
  option: { readonly label: string; readonly orders: ReadonlyArray<ManagerOrder>; readonly rationale: string | null },
  source: "agent" | "rules"
): DecisionOption => {
  const { valid, dropped } = checkOrders(input.state, input.side, option.orders)
  return {
    index, label: option.label, source, orders: valid, rationale: option.rationale,
    xg_diff_vs_no_change: null, goal_diff_vs_no_change: null, untested: false, dropped: dropped.map((d) => ({ order: d.order, reason: d.reason }))
  }
}

/** The fields of a decision line that come from the moment itself. */
export const decisionBase = (input: DecideInput) => ({
  match_id: input.state.config.matchId,
  tick: input.state.tick,
  minute: Math.round(minuteOf(input.state) * 10) / 10,
  side: input.side,
  team_id: input.state.config[input.side].id,
  reasons: [...input.reasons],
  situation_hash: input.situationHash
})

import { whatIf, WhatIfError, type Estimate, type OptionRecord } from "@touchline/sim-core"
import type { XtGrid } from "@touchline/stats"
import { AdvisorError, type Session } from "./session.js"
import { passValue, xtEndValue } from "./value.js"
import { clearlyBetter, MIN_VERDICT_SEEDS } from "./verdict.js"

export interface ScoredOption {
  readonly receiver_id: string
  readonly kind: string
  readonly target_x: number
  readonly target_y: number
  /** The engine's own estimate at the decision. */
  readonly xpass: number
  /** Pitch control for the passing team at the target, at the moment of the pass. */
  readonly pitch_control: number
  /** On paper: pitch control x xT kept, minus the opponents' xT if lost. */
  readonly value: number
  readonly chosen: boolean
  /**
   * Played out: this option minus the pass played, over paired re-simulations (xG created plus the xT left at the
   * end); null for the pass played, when re-simulation was skipped, or when the option could not be forced.
   */
  readonly simulated: Estimate | null
}

export interface PassExplanation {
  readonly event_id: string
  readonly player_id: string
  readonly frame_id: number
  /** Every option the player weighed, best on paper first. */
  readonly options: ReadonlyArray<ScoredOption>
  /** Rank of the pass played on paper (1 = best). */
  readonly chosen_rank: number
  readonly best_on_paper: ScoredOption
  /** The option that played out clearly better than the pass played (see clearlyBetter), if any. */
  readonly better: ScoredOption | null
  readonly verdict: "played_pass_was_best" | "better_option_found" | "not_verified"
  readonly seeds: number
  readonly horizon_s: number
  /** Why the verdict is not_verified, when it is. */
  readonly note: string | null
}

export interface ExplainOptions {
  /** Paired seeds per option for the re-simulation (default 20; 0 skips it). */
  readonly seeds?: number
  /** Seconds re-simulated (default 10). */
  readonly horizonS?: number
}

/**
 * Was there a better pass? Every option the player weighed (the decision record on the pass event) is scored on
 * paper (pitch control x expected threat at the moment of the pass) and then played out: each is re-simulated
 * against the pass played from the same state over paired seeds, valued by the xG it creates plus the expected
 * threat it leaves the team with. A better option is reported only when it is clearly better in play (clearlyBetter:
 * at least 10 seeds, a minimum gain and a margin corrected for the number of alternatives), and only options whose
 * forced pass was actually played in every seed, with the pass played forced in every seed too, are compared.
 */
export const explainPass = (session: Session, eventId: string, xt: XtGrid, opts: ExplainOptions = {}): PassExplanation => {
  const e = session.event(eventId)
  if (e.type !== "pass" || e.player_id === null || e.team_id === null) throw new AdvisorError(`"${eventId}" is not a pass`)
  const recorded = (e.attrs.options ?? []) as ReadonlyArray<OptionRecord>
  if (recorded.length < 2) throw new AdvisorError(`"${eventId}" has no alternatives on record`)
  const seeds = opts.seeds ?? 20
  const horizonS = opts.horizonS ?? 10
  const state = session.stateAt(e.frame_id - 1)
  const owner = state.players.find((p) => p.id === e.player_id)!
  // The pass played is the option to the intended receiver nearest the intended end point.
  const intendedX = Number(e.attrs.intended_end_x)
  let chosenIdx = -1
  recorded.forEach((o, i) => {
    if (o.receiver_id === e.attrs.intended_receiver_id && (chosenIdx < 0 || Math.abs(o.target_x - intendedX) < Math.abs(recorded[chosenIdx]!.target_x - intendedX))) chosenIdx = i
  })
  const paper = recorded.map((o, i) => {
    const v = passValue(state, owner.side, owner.id, owner.pos, { x: o.target_x, y: o.target_y }, xt)
    return { receiver_id: o.receiver_id, kind: o.kind, target_x: o.target_x, target_y: o.target_y, xpass: o.xpass, pitch_control: v.pc, value: v.value, chosen: i === chosenIdx }
  })
  const played = paper.find((o) => o.chosen)
  let note: string | null = played ? null : "the pass played is not among the recorded options"
  if (played && seeds === 0) note = "re-simulation skipped"
  if (played && seeds > 0 && seeds < MIN_VERDICT_SEEDS) note = `a verdict needs at least ${MIN_VERDICT_SEEDS} seeds`
  const simulate = (o: (typeof paper)[number]): Estimate | null => {
    if (!played || seeds < MIN_VERDICT_SEEDS || o.chosen) return null
    try {
      const r = whatIf(state, { kind: "pass_to", playerId: owner.id, receiverId: o.receiver_id, passKind: o.kind }, {
        side: owner.side,
        seeds,
        horizonS,
        endValue: xtEndValue(xt),
        baseline: { kind: "pass_to", playerId: owner.id, receiverId: played.receiver_id, passKind: played.kind }
      })
      // Compare only plays where both passes were really made.
      return r.forced_applied.baseline === seeds && r.forced_applied.variant === seeds ? r.difference.total : null
    } catch (err) {
      if (err instanceof WhatIfError) return null
      throw err
    }
  }
  const options: ScoredOption[] = paper.map((o) => ({ ...o, simulated: simulate(o) })).sort((a, b) => b.value - a.value)
  const compared = options.filter((o) => o.simulated !== null)
  const clearly = compared.filter((o) => clearlyBetter(o.simulated!, seeds, compared.length)).sort((a, b) => b.simulated!.mean - a.simulated!.mean)
  const better = clearly[0] ?? null
  const verified = played !== undefined && seeds >= MIN_VERDICT_SEEDS && compared.length > 0
  if (played && seeds >= MIN_VERDICT_SEEDS && !verified) note = "no alternative could be re-simulated with both passes played"
  return {
    event_id: e.id,
    player_id: e.player_id,
    frame_id: e.frame_id,
    options,
    chosen_rank: 1 + options.findIndex((o) => o.chosen),
    best_on_paper: options[0]!,
    better,
    verdict: !verified ? "not_verified" : better ? "better_option_found" : "played_pass_was_best",
    seeds,
    horizon_s: horizonS,
    note
  }
}

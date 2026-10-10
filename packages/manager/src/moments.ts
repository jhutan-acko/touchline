/**
 * Key moments (spec §2.2): when a team's manager decides. Each is a stoppage, so the ball is dead and the state is
 * frozen while the manager thinks: the second-half kickoff (half time), the kickoff after a goal, and the first
 * restart at or after minutes 60 and 75. Moments that fall on the same stoppage are one decision with every reason, and
 * a minute moment that comes due within ABSORB_MIN of a decision is absorbed by it (no manager rethinks seconds after
 * deciding); half time and goals always call for a decision.
 */
import { isHalfTimeBreak, type DomainEvent, type MatchState } from "@touchline/sim-core"
import type { MomentReason } from "@touchline/schema"

/** Minutes after a decision in which a minute-60 or minute-75 moment is absorbed by it. */
export const ABSORB_MIN = 5

/** What the detector remembers between steps. */
export interface MomentMemory {
  /** A goal was scored and its kickoff has not been reached yet. */
  readonly goalPending: boolean
  readonly done: ReadonlyArray<MomentReason>
  /** The match minute of the last key moment, or null before the first. */
  readonly lastMinute: number | null
}

export const NO_MOMENTS: MomentMemory = { goalPending: false, done: [], lastMinute: null }

/** The match minute of a state (45 + minutes into the second half). */
export const minuteOf = (s: MatchState): number => (s.period === "first_half" ? 0 : 45) + (Math.max(0, s.periodTick) * s.config.dt) / 60

/**
 * The reasons the state just reached (after one step that emitted `events`) is a key moment; empty when it is not.
 * Pure: the same state, events and memory give the same answer.
 */
export const keyMoment = (s: MatchState, events: ReadonlyArray<DomainEvent>, memory: MomentMemory): { readonly reasons: MomentReason[]; readonly memory: MomentMemory } => {
  let goalPending = memory.goalPending || events.some((e) => e.type === "goal")
  const done = [...memory.done]
  const reasons: MomentReason[] = []
  if (s.phase.kind !== "restart") return { reasons, memory: { ...memory, goalPending } }
  if (isHalfTimeBreak(s) && !done.includes("half_time")) reasons.push("half_time")
  if (goalPending && s.phase.restart === "kickoff") {
    reasons.push("after_goal")
    goalPending = false
  }
  const minute = minuteOf(s)
  for (const [reason, at] of [["minute_60", 60], ["minute_75", 75]] as const) {
    if (done.includes(reason)) continue
    // Due now: decide, unless a decision a few minutes ago already covered it.
    if (minute >= at && (memory.lastMinute === null || minute - memory.lastMinute >= ABSORB_MIN || reasons.length > 0)) reasons.push(reason)
    else if (minute >= at) done.push(reason)
  }
  for (const r of reasons) if (r !== "after_goal") done.push(r)
  return { reasons, memory: { goalPending, done, lastMinute: reasons.length > 0 ? minute : memory.lastMinute } }
}

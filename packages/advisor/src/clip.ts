import { applyIntervention, forkState, outcomeOf, playAheadFrames, type Estimate, type Frame, type Intervention } from "@touchline/sim-core"
import type { XtGrid } from "@touchline/stats"
import type { PassExplanation } from "./explain.js"
import { AdvisorError, type Session } from "./session.js"
import { xtEndValue } from "./value.js"

/** Seconds of play a clip shows before the pass, and after it. */
export const CLIP_BEFORE_S = 2
export const CLIP_AFTER_S = 8

/**
 * A pass and its better option as plays to watch (the what-if split): the match as it went, and the better pass
 * played out in one typical re-simulation. Counts and gain come from the same paired seeds as the verdict.
 */
export interface PassClip {
  readonly event_id: string
  readonly verdict: PassExplanation["verdict"]
  readonly passer_id: string
  readonly played_to: string
  readonly better_to: string | null
  /** The match as it went, one frame per tick: CLIP_BEFORE_S before the pass to CLIP_AFTER_S after (less at full time). */
  readonly real: ReadonlyArray<Frame>
  /** The same ticks with the better pass played (the same frames up to `pass_index`); null without a better option. */
  readonly variant: ReadonlyArray<Frame> | null
  /** The index of the pass's tick in the frames: the first one where the plays can differ. */
  readonly pass_index: number
  readonly seeds: number
  readonly horizon_s: number
  /** The seed shown: the one whose outcome is closest to the better option's mean (never a lucky one). */
  readonly typical_seed: number | null
  /** In how many seeds the team had a shot, and scored, after the pass played and after the better one. */
  readonly shots: { readonly played: number; readonly better: number } | null
  readonly goals: { readonly played: number; readonly better: number } | null
  /** The better option minus the pass played (xG created plus the threat left at the end), from the verdict. */
  readonly gain: Estimate | null
}

/** The index of the value closest to the mean (the first, on a tie). */
export const typicalIndex = (xs: ReadonlyArray<number>): number => {
  if (xs.length === 0) throw new AdvisorError("no outcomes to choose from")
  const mean = xs.reduce((a, v) => a + v, 0) / xs.length
  let best = 0
  xs.forEach((v, i) => {
    if (Math.abs(v - mean) < Math.abs(xs[best]! - mean)) best = i
  })
  return best
}

/** The clip for an explained pass (explainPass's answer for it, with the same seeds and horizon). */
export const passClip = (session: Session, ex: PassExplanation, xt: XtGrid): PassClip => {
  const dt = session.cfg.dt
  const before = Math.round(CLIP_BEFORE_S / dt)
  const after = Math.round(CLIP_AFTER_S / dt)
  const fork = ex.frame_id - 1
  const start = Math.max(-1, fork - before)
  const real = playAheadFrames(session.stateAt(start), fork - start + after).frames
  const played = ex.options.find((o) => o.chosen)
  if (!played) throw new AdvisorError(`the pass played in "${ex.event_id}" is not among its options`)
  const base = { event_id: ex.event_id, verdict: ex.verdict, passer_id: ex.player_id, played_to: played.receiver_id, real, pass_index: fork - start, seeds: ex.seeds, horizon_s: ex.horizon_s }
  const better = ex.verdict === "better_option_found" ? ex.better : null
  if (!better) return { ...base, better_to: null, variant: null, typical_seed: null, shots: null, goals: null, gain: null }
  const state = session.stateAt(fork)
  const side = state.players.find((p) => p.id === ex.player_id)!.side
  const ticks = Math.max(after, Math.round(ex.horizon_s / dt))
  const arm = (iv: Intervention) =>
    Array.from({ length: ex.seeds }, (_, k) => {
      const r = playAheadFrames(applyIntervention(forkState(state, k), iv), ticks)
      return { outcome: outcomeOf(r.events, r.state, side, xtEndValue(xt)), frames: r.frames }
    })
  const pass = (receiverId: string, passKind: string): Intervention => ({ kind: "pass_to", playerId: ex.player_id, receiverId, passKind })
  const playedRuns = arm(pass(played.receiver_id, played.kind))
  const betterRuns = arm(pass(better.receiver_id, better.kind))
  const typical = typicalIndex(betterRuns.map((r) => r.outcome.total))
  const count = (runs: typeof playedRuns, f: (o: (typeof runs)[number]["outcome"]) => boolean) => runs.filter((r) => f(r.outcome)).length
  return {
    ...base,
    better_to: better.receiver_id,
    variant: [...real.slice(0, base.pass_index), ...betterRuns[typical]!.frames].slice(0, real.length),
    typical_seed: typical,
    shots: { played: count(playedRuns, (o) => o.shots_for > 0), better: count(betterRuns, (o) => o.shots_for > 0) },
    goals: { played: count(playedRuns, (o) => o.goal_diff > 0), better: count(betterRuns, (o) => o.goal_diff > 0) },
    gain: better.simulated
  }
}

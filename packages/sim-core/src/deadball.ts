/**
 * S8 dead-ball timing (realism v2 P5, plan 8e Task 6, ruling 11): the pure parts of how long a restart takes and how
 * players walk into place. The step seam (step.ts, "P5 dead-ball seam") owns the plan, the draws (dead stream) and who is who.
 *
 * - Delays: lognormal at the real median per key (restartDelayS), lengthening through the match by lateGrowth.
 * - Settling: each player's deadline before the resume tick (settleS); corners and attacking free kicks settle earlier.
 * - Walking: a walking pace, raised just enough to arrive by the deadline (walkCap).
 */
import type { DeadKey, Params } from "./params.js"
import type { Rng } from "./rng.js"
import type { SetPieceKind } from "./setpiece.js"

type D = Params["deadBall"]

/**
 * A restart's delay (s) for key `key` at match minute `minute`: medianS x exp(sigma x N(0, 1)), times
 * 1 + lateGrowth x (minute / 90 - 0.5) (the match median holds, late delays lengthen), floored at minS after the growth.
 */
export const restartDelayS = (key: DeadKey, minute: number, d: D, rng: Rng): number => {
  const base = d.medianS[key] * Math.exp(d.sigma[key] * rng.normal())
  return Math.max(d.minS, base * (1 + d.lateGrowth * (minute / 90 - 0.5)))
}

/** Set pieces whose players settle early: attackers settleAttS, defenders settleDefS before the kick. */
const EARLY: ReadonlySet<SetPieceKind> = new Set(["corner", "fk_wide", "fk_central"])

/** How long before the resume tick a player should be settled (s): U(settleS), or at corners and attacking free kicks U(settleAttS) for the restarting side and U(settleDefS) for the other. */
export const settleS = (kind: SetPieceKind, attacking: boolean, d: D, rng: Rng): number => {
  const [lo, hi] = EARLY.has(kind) ? (attacking ? d.settleAttS : d.settleDefS) : d.settleS
  return rng.range(lo, hi)
}

/**
 * The speed cap (m/s) of a player `distM` from his spot with `secondsLeft` to his deadline: his walking pace, or faster
 * when he needs it to arrive in time, at most 0.8 x vmax (and 0.8 x vmax once the deadline is reached).
 */
export const walkCap = (distM: number, secondsLeft: number, walkMps: number, vmax: number): number =>
  secondsLeft <= 0 ? 0.8 * vmax : Math.min(0.8 * vmax, Math.max(walkMps, distM / secondsLeft))

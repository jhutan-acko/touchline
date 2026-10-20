/**
 * A4 transitions (realism v2 P4, plan 8d Task 6): the pure parts of what a team does right after it loses the ball in
 * live play. The step seam (step.ts, "P4 transition seam") owns the state, the draws (counter stream) and who is who.
 *
 * - Counter-press: each losing outfielder joins with a chance by his distance to the ball at the loss (joinChance).
 * - Reaction pause: for pauseS, the others far from the ball hold course at a reduced speed (pauseTarget).
 * - Recovery runs: from recoverFromS to recoverToS a ramped hazard sends players back to shape (recoverRamp, recoverRate).
 */
import { add, len, type Vec2 } from "./geometry.js"
import type { Params } from "./params.js"

type T = Params["transition"]

/** Ticks in a window of `s` seconds at step `dt` (a window is open while tick - start < this). */
export const windowTicks = (s: number, dt: number): number => Math.round(s / dt)

/** The chance a losing outfielder `distM` from the ball at the loss joins the counter-press: joinP of the first band he is under, else 0. */
export const joinChance = (distM: number, t: T): number => {
  for (let i = 0; i < t.joinM.length; i++) if (distM < t.joinM[i]!) return t.joinP[i]!
  return 0
}

/** The recovery hazard's ramp at `tS` seconds after the loss: 0 before recoverFromS, up to 1 at recoverPeakS[0], 1 to recoverPeakS[1], down to 0 at recoverToS. */
export const recoverRamp = (tS: number, t: T): number => {
  const [p0, p1] = t.recoverPeakS
  if (tS <= t.recoverFromS || tS >= t.recoverToS) return 0
  if (tS < p0) return (tS - t.recoverFromS) / (p0 - t.recoverFromS)
  if (tS <= p1) return 1
  return (t.recoverToS - tS) / (t.recoverToS - p1)
}

/**
 * The per-second recovery hazard at `tS` s after the loss for a player whose team-frame u is `uRelBall` metres ahead of
 * the ball (negative: goal-side of it); more than -recoverUpfieldM goal-side, it is x recoverBehindFactor.
 */
export const recoverRate = (tS: number, uRelBall: number, t: T): number =>
  t.recoverRatePerS * recoverRamp(tS, t) * (uRelBall < t.recoverUpfieldM ? t.recoverBehindFactor : 1)

/** Reaction pause: hold course (the spot 1 s ahead at the current velocity) at no more than the current speed or pauseShare of top speed. */
export const pauseTarget = (pos: Vec2, vel: Vec2, vmax: number, t: T): { target: Vec2; speedCap: number } => ({
  target: add(pos, vel),
  speedCap: Math.min(len(vel), t.pauseShare * vmax)
})

/** P5 pause (plan 8e ruling 20): a paused player's cap from his speed at the loss, pauseDip x that speed (the caller takes min with base's cap). */
export const pauseCap = (speedAtLoss: number, t: T): number => t.pauseDip * speedAtLoss

/**
 * P5 end of the pause (plan 8e ruling 20): `sinceS` seconds after the pause ended, the cap ramps linearly from
 * `pauseCapV` to `baseCap` over pauseEndS (sinceS clamped to 0..pauseEndS; base's cap from pauseEndS on).
 */
export const pauseEndCap = (sinceS: number, pauseCapV: number, baseCap: number, t: T): number => {
  const f = t.pauseEndS > 0 ? Math.min(1, Math.max(0, sinceS / t.pauseEndS)) : 1
  return f >= 1 ? baseCap : pauseCapV + (baseCap - pauseCapV) * f
}

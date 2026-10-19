/**
 * A6 rotations (realism v2 P5, plan 8e Task 10, ruling 16): the pure target geometry for a winger coming inside, a
 * full-back inverting and a central midfielder dropping between the centre-backs. The step seam ("P5 rotation seam")
 * owns the hazards, the draws (roles stream), the gating and the intents.
 *
 * Positions are pitch coordinates; `lastOwnU` is already in the team frame (u: metres toward the opponents' goal).
 */
import { dirOf, type Period, type Side, type Vec2 } from "./geometry.js"

/** Winger inside: his shape depth at lateral distance `y` from the centre line, on the side `ySign` (+1 or -1). */
export const insideTarget = (shape: Vec2, ySign: number, y: number): Vec2 => ({ x: shape.x, y: ySign * y })

/**
 * Full-back inversion: `inM` metres inside his winger's lateral distance `wY` (the same side), at the deeper of his shape
 * depth and `aboveLastM` beyond the last own outfielder (`lastOwnU`).
 */
export const invertTarget = (shape: Vec2, wY: number, inM: number, lastOwnU: number, side: Side, period: Period, aboveLastM: number): Vec2 => {
  const dir = dirOf(side, period)
  const u = Math.max(shape.x * dir, lastOwnU + aboveLastM)
  return { x: u * dir, y: (wY < 0 ? -1 : 1) * Math.max(0, Math.abs(wY) - inM) }
}

/** CBs within this lateral spread (m) are too close to drop between: the midfielder drops beside them instead. */
const CB_TOGETHER_M = 6
/** How far outside the ball-side CB a midfielder drops when the CBs are together (m). */
const BESIDE_M = 3

/**
 * CM drop: one metre ahead of the mean CB depth, between the CBs (the midpoint of their lateral spread) or, when they
 * are within 6 m of each other, 3 m outside the CB on the ball's side (`ballY`). `cbs` must not be empty.
 */
export const dropTarget = (cbs: ReadonlyArray<Vec2>, ballY: number, side: Side, period: Period): Vec2 => {
  const dir = dirOf(side, period)
  const u = cbs.reduce((s, c) => s + c.x * dir, 0) / cbs.length + 1
  const ys = cbs.map((c) => c.y)
  const lo = Math.min(...ys)
  const hi = Math.max(...ys)
  const mid = (lo + hi) / 2
  if (hi - lo > CB_TOGETHER_M) return { x: u * dir, y: mid }
  return { x: u * dir, y: ballY >= mid ? hi + BESIDE_M : lo - BESIDE_M }
}

import { attackX, dirOf, dist, PITCH, type Side, type Vec2, type Vec3 } from "./geometry.js"
import { vmaxFor } from "./kinematics.js"
import type { Params } from "./params.js"
import type { Rng } from "./rng.js"
import type { BallState, PlayerState } from "./types.js"

/** True when `at` is inside the penalty area that `side` defends. */
export const inOwnBox = (side: Side, at: Vec2): boolean =>
  attackX(side, at.x) < -(PITCH.halfL - PITCH.boxDepth) && Math.abs(at.y) < PITCH.boxHalfWidth

/**
 * Where a deflection behind `defSide`'s own goal line ends up: 2.5 m beyond the line and wide of the posts,
 * roughly straight back from `at` (it gives a corner). The ball travels there directly (see DEFLECT_SPEED).
 */
export const behindPoint = (defSide: Side, at: Vec2, rng: Rng): Vec3 => {
  const sy = at.y === 0 ? (rng.chance(0.5) ? 1 : -1) : Math.sign(at.y)
  const wide = PITCH.goalHalfWidth + 1.5
  const ty = Math.abs(at.y) > wide + 3 ? at.y + rng.range(-4, 4) : sy * (wide + rng.range(0, 8))
  return { x: -dirOf(defSide) * (PITCH.halfL + 2.5), y: Math.abs(ty) < wide ? sy * wide : Math.max(-PITCH.halfW + 1, Math.min(PITCH.halfW - 1, ty)), z: rng.range(0.3, 2.5) }
}

/** Speed of a deflection (m/s). */
export const DEFLECT_SPEED = 14

/** A ball knocked loose by `toucher`'s side at `at`: any direction except back towards that side's own goal. */
export const deflectLoose = (toucherSide: Side, at: Vec2, rng: Rng, speed: readonly [number, number] = [4, 10], up: readonly [number, number] = [0, 1.5]): BallState => {
  const away = dirOf(toucherSide) > 0 ? 0 : Math.PI
  const ang = away + rng.range(-1.9, 1.9)
  const sp = rng.range(speed[0], speed[1])
  return { pos: { x: at.x, y: at.y, z: 0.2 }, vel: { x: Math.cos(ang) * sp, y: Math.sin(ang) * sp, z: rng.range(up[0], up[1]) } }
}

/** A header or punch away from `defSide`'s goal: high and long, towards the opponent's half. */
export const clearAway = (defSide: Side, at: Vec3, rng: Rng, strength = 1): BallState => ({
  pos: { x: at.x, y: at.y, z: Math.max(0.5, at.z) },
  vel: { x: dirOf(defSide) * rng.range(8, 15) * strength, y: rng.range(-9, 9) * strength, z: rng.range(4, 9) * strength }
})

export type KeeperAction = "claim" | "punch" | "fumble"

/**
 * Whether `keeper` can come for a high ball meeting the contact point `at` in `t` seconds: inside their box,
 * within claimDepthM of the goal line, and close enough to get there.
 */
export const keeperCanCome = (keeper: PlayerState, at: Vec3, t: number, p: Params): boolean => {
  const k = p.keeper
  if (!inOwnBox(keeper.side, at)) return false
  if (PITCH.halfL + attackX(keeper.side, at.x) > k.claimDepthM) return false
  const reach = Math.min(k.claimRangeM, p.kinematics.reachM + 0.8 * vmaxFor(keeper.attrs, keeper.energy, p) * t)
  return dist(keeper.pos, at) <= reach
}

/** Catch, punch or fumble: safe hands catch more often. */
export const keeperAction = (keeper: PlayerState, p: Params, rng: Rng): KeeperAction => {
  const k = p.keeper
  if (rng.chance(k.catchBase + k.catchHandling * keeper.attrs.handling)) return "claim"
  return rng.chance(k.fumbleShare) ? "fumble" : "punch"
}

/**
 * The nearest outfield opponent close enough to the crosser to block the cross (within crossBlockM; a defender
 * closing down from the side or from behind can still get a leg to it), if any.
 */
export const crossBlocker = (crosser: PlayerState, opponents: ReadonlyArray<PlayerState>, p: Params): PlayerState | null => {
  let best: PlayerState | null = null
  let bd = Infinity
  for (const o of opponents) {
    if (o.sentOff || o.role === "GK") continue
    const d = dist(o.pos, crosser.pos)
    if (d <= p.defending.crossBlockM && d < bd) {
      best = o
      bd = d
    }
  }
  return best
}

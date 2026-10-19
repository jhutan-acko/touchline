/**
 * Realism v2 P6 SH2 (plan 8f, ruling 8): an attacker who wins a high ball in the box he attacks may head at goal
 * instead of controlling it. Pure: the step.ts header seam makes the one draw (on the contact stream).
 */
import type { ShotHow } from "./contact.js"
import { attackX, PITCH, type Period, type Side, type Vec2 } from "./geometry.js"
import type { Params } from "./params.js"

const sigmoid = (z: number): number => 1 / (1 + Math.exp(-z))

/** Whether `at` is in the penalty box that `side` attacks in `period` (u > 36, |y| < 20.16). */
export const inAttackingBox = (side: Side, period: Period, at: Vec2): boolean =>
  attackX(side, at.x, period) > PITCH.halfL - PITCH.boxDepth && Math.abs(at.y) < PITCH.boxHalfWidth

/** An outfielder meeting the ball between zMin and zMax (both included) in the box he attacks may head it at goal. */
export const headerEligible = (contactZ: number, inBox: boolean, isKeeper: boolean, h: Params["header"]): boolean =>
  !isKeeper && inBox && contactZ >= h.zMin && contactZ <= h.zMax

/** The chance he heads at goal rather than controls: sigmoid(b0 + bXg xg(header) + bHeading (heading - 0.6) + script). */
export const headShare = (xgHeader: number, heading: number, scriptShot: number, h: Params["header"]): number =>
  sigmoid(h.b0 + h.bXg * xgHeader + h.bHeading * (heading - 0.6) + scriptShot)

/** A header: heading in place of finishing, aim x aimK, ball speed x speedShare, struck from the contact height. */
export const headerHow = (heading: number, contactZ: number, h: Params["header"]): ShotHow => ({
  header: true,
  firstTime: true,
  mods: { skill: heading, aimY: h.aimK, aimZ: h.aimK, fromZ: contactZ, speed: h.speedShare }
})

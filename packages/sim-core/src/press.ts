/**
 * A5 team pressing (realism v2 P4, plan 8d Task 7): the pure parts of who presses, how readily, and where a second
 * presser stands. The step seam (step.ts, "P4 team-press seam") owns the state, the draws (movement stream for the
 * first press, press stream for the second) and who is who.
 *
 * - Triggers (ruling 13): a carrier with his back to goal (he received a pass moving forward faster than
 *   backToGoalBallMps at most backToGoalS ago) lifts the hazard by backToGoalLift; the ball in the pressing side's own
 *   third lifts it by ownThirdLift; the lifts multiply.
 * - Who (ruling 15): the outfielder with the smallest distance / roleWeight.
 * - Second presser (ruling 14): he stands in the cover shadow, shadowM from the carrier toward the carrier's nearest teammate.
 */
import { add, attackX, len, scale, sub, type Period, type Side, type Vec2 } from "./geometry.js"
import type { Params } from "./params.js"
import type { PressState, Role } from "./types.js"

type Pr = Params["press"]

/** The hazard lift of the press triggers: backToGoalLift and ownThirdLift multiply (each 1 when it does not hold). */
export const pressLift = (backToGoal: boolean, ownThird: boolean, pr: Pr): number => (backToGoal ? pr.backToGoalLift : 1) * (ownThird ? pr.ownThirdLift : 1)

/** A presser's score (lower presses first): distance / roleWeight. A keeper never presses (Infinity). */
export const presserScore = (distM: number, role: Role, pr: Pr): number => (role === "GK" ? Infinity : distM / pr.roleWeight[role])

/** The cover-shadow spot: shadowM from the carrier toward his teammate `mate` (the carrier's spot if they coincide). */
export const shadowSpot = (carrier: Vec2, mate: Vec2, shadowM: number): Vec2 => {
  const d = sub(mate, carrier)
  const l = len(d)
  return l < 1e-9 ? carrier : add(carrier, scale(d, shadowM / l))
}

/** Whether `ball` is in `side`'s own third (u < -ownThirdU in its attacking frame for `period`). */
export const inOwnThird = (ball: Vec2, side: Side, period: Period, pr: Pr): boolean => attackX(side, ball.x, period) < -pr.ownThirdU

/**
 * Whether carrier `carrierId` has his back to goal at `tick`: his last completed reception (`rec`) was under
 * backToGoalS ago (open while tick - rec.tick < round(backToGoalS / dt)) and the ball arrived moving toward the
 * opponents' goal faster than backToGoalBallMps.
 */
export const backToGoalHolds = (rec: PressState["reception"], carrierId: string, tick: number, dt: number, pr: Pr): boolean =>
  rec !== null && rec.playerId === carrierId && rec.ballMps > pr.backToGoalBallMps && tick - rec.tick < Math.round(pr.backToGoalS / dt)

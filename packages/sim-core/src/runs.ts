/**
 * A6 runs in behind and full-back overlaps (realism v2 P5, plan 8e Task 9, ruling 15). Pure geometry and eligibility;
 * the hazards, draws and intents live in step.ts's role-run seam.
 */
import { attackX, clampToPitch, dirOf, PITCH, type Period, type Side, type Vec2 } from "./geometry.js"
import type { Params } from "./params.js"
import type { PlayerState } from "./types.js"

/** The wide lane starts at |y| 14 (the analysis splits at 13.84). */
export const WIDE_LANE_Y = 14
/** Overlap targets stay this far inside the touchline. */
const TOUCHLINE_KEEP_M = 1.5
/** The middle third starts at u -17.5 (own third below). */
const MID_THIRD_U = -17.5

/** +1 or -1 for the half of the pitch `y` is in (0 counts as +1). */
const sideSign = (y: number): 1 | -1 => (y < 0 ? -1 : 1)

/**
 * A runner's target: `holdM` short of the last defender (u `lastDefU`, the runner's frame), at `y`, or, when `wide`,
 * at least WIDE_LANE_Y out on the side `y` is on. Re-aimed each tick while the run lives.
 */
export const holdLineTarget = (lastDefU: number, y: number, wide: boolean, side: Side, period: Period, r: Params["roleMoves"]["run"]): Vec2 => {
  const ty = wide ? sideSign(y) * Math.max(Math.abs(y), WIDE_LANE_Y) : y
  return clampToPitch({ x: dirOf(side, period) * (lastDefU - r.holdM), y: ty }, 2)
}

/** An overlap's target: `outsideM` outside the carrier (kept 1.5 m inside the touchline) and `aheadM` beyond him. */
export const overlapTarget = (carrier: Vec2, side: Side, period: Period, o: Params["roleMoves"]["overlap"]): Vec2 => {
  const u = Math.min(attackX(side, carrier.x, period) + o.aheadM, PITCH.halfL - 2)
  const s = sideSign(carrier.y)
  const y = s * Math.min(Math.abs(carrier.y) + o.outsideM, PITCH.halfW - TOUCHLINE_KEEP_M)
  return { x: dirOf(side, period) * u, y }
}

/**
 * May full-back `fb` overlap `carrier`? His same-side W or CM has the ball in the middle or attacking third and in the
 * wide lane, and the FB is behind him by at most `behindM`.
 */
export const overlapEligible = (fb: PlayerState, carrier: PlayerState, period: Period, o: Params["roleMoves"]["overlap"]): boolean => {
  if (fb.role !== "FB" || fb.sentOff || carrier.side !== fb.side || carrier.id === fb.id) return false
  if (carrier.role !== "W" && carrier.role !== "CM") return false
  if (sideSign(carrier.pos.y) !== sideSign(fb.pos.y) || Math.abs(carrier.pos.y) < WIDE_LANE_Y) return false
  const cu = attackX(carrier.side, carrier.pos.x, period)
  if (cu < MID_THIRD_U) return false
  const gap = cu - attackX(fb.side, fb.pos.x, period)
  return gap >= 0 && gap <= o.behindM
}

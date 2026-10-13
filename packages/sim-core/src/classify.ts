import { attackX, PITCH, type Period, type Side, type Vec2 } from "./geometry.js"
import type { ClassifierThresholds } from "./params.js"

export const PASS_KINDS = ["short", "long", "through", "lofted_through", "switch", "cross", "cutback", "back"] as const
export type PassKind = (typeof PASS_KINDS)[number] | "set_piece"
export type PassHeight = "ground" | "low" | "high"

export interface PassGeometry {
  readonly side: Side
  readonly period: Period
  readonly from: Vec2
  readonly to: Vec2
  readonly height: PassHeight
  /** Attack-normalised x of the last outfield defender (deepest opponent excluding the keeper). */
  readonly lastDefenderAttackX: number
}

/**
 * Classify a pass from geometry at release. The same rules run in Python on real data
 * (python/analytics/touchline_analytics/classify.py) against fixtures/pass-kinds.json.
 */
export const classifyPass = (g: PassGeometry, t: ClassifierThresholds): PassKind => {
  const fx = attackX(g.side, g.from.x, g.period)
  const tx = attackX(g.side, g.to.x, g.period)
  const dx = tx - fx
  const dy = g.to.y - g.from.y
  const length = Math.hypot(dx, dy)
  const targetInBox = tx > PITCH.halfL - PITCH.boxDepth && Math.abs(g.to.y) < PITCH.boxHalfWidth

  if (fx > t.finalThirdAttackX && Math.abs(g.from.y) > t.crossOriginAbsY && targetInBox) return "cross"
  if (
    fx > t.cutbackOriginAttackX &&
    dx < 0 &&
    tx >= t.cutbackTargetAttackXMin &&
    tx <= t.cutbackTargetAttackXMax &&
    Math.abs(g.to.y) < t.cutbackTargetAbsY
  )
    return "cutback"
  if (dx < -t.backPassM) return "back"
  if (tx > g.lastDefenderAttackX && fx < g.lastDefenderAttackX) return g.height === "high" ? "lofted_through" : "through"
  if (Math.abs(dy) >= t.switchLateralM && Math.sign(g.from.y) !== Math.sign(g.to.y)) return "switch"
  if (length >= t.longPassM) return "long"
  return "short"
}

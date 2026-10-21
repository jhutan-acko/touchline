/**
 * Realism v2 P6 (plan 8f): what a receiver does with the ball at contact, shared by the first-time (SH1) and header
 * (SH2) seams in step.ts and the contact executor. Pure: no RNG, no state.
 */
import { shotLineCount, toOption, type Candidate, type Decision } from "./decide.js"
import { goalOf, type Period, type Side, type Vec2, type Vec3 } from "./geometry.js"
import type { ShotMods } from "./shot.js"
import type { OptionRecord, PlayerState } from "./types.js"

/** How a contact shot is struck: headed or first time, and the planShot hooks it sets. */
export interface ShotHow {
  readonly header: boolean
  readonly firstTime: boolean
  readonly mods: Pick<ShotMods, "aimY" | "aimZ" | "skill" | "mishit" | "fromZ" | "speed">
}

/** An ordinary shot after control: no hook set, so planShot behaves as before. */
export const OPEN_SHOT: ShotHow = { header: false, firstTime: false, mods: {} }

/** What the receiver does at contact: control it (the old behaviour), shoot first time or head it, or lay it off. */
export type ContactPlan =
  | { readonly kind: "control" }
  | { readonly kind: "shot"; readonly decision: Decision; readonly how: ShotHow }
  | { readonly kind: "layoff"; readonly decision: Decision }

export const CONTROL: ContactPlan = { kind: "control" }

/**
 * cos of the angle between the arriving ball's ground direction and the receiver's direction to the goal centre:
 * -1 for a ball coming at him from the goal side (a cutback), +1 for one from behind. 0 when the ball's ground speed is
 * below 0.1 m/s (or he stands on the goal centre).
 */
export const arrivalCos = (ballVel: Vec3, at: Vec2, goal: Vec2): number => {
  const v = Math.hypot(ballVel.x, ballVel.y)
  const gx = goal.x - at.x
  const gy = goal.y - at.y
  const g = Math.hypot(gx, gy)
  if (v < 0.1 || g < 1e-9) return 0
  return (ballVel.x * gx + ballVel.y * gy) / (v * g)
}

/**
 * Outfield opponents in the cone from `pos` to the goal centre `side` attacks: within 1.5 m of the segment, strictly
 * between its ends. The same predicate as decide's inline count (the defendersInCone of xgOf), for xG at contact.
 */
export const coneCount = (side: Side, period: Period, pos: Vec2, opponents: ReadonlyArray<PlayerState>): number =>
  shotLineCount(pos, goalOf(side, period), opponents.filter((o) => o.role !== "GK").map((o) => o.pos))

const r3 = (v: number): number => Math.round(v * 1000) / 1000

/**
 * The decision record of a contact choice, with the existing action names (ruling 6): `shot` (first time or headed),
 * `short_pass` (a lay-off, when one was possible) and `hold` (control). `candidate` is the lay-off pass (null for a
 * shot); `options` are the lay-off options weighed, the chosen one appended when it is not among them, and it is
 * ranked by value among them.
 */
export const contactDecision = (
  probs: { readonly shot: number; readonly short_pass?: number; readonly hold: number },
  action: "shot" | "short_pass",
  candidate: Candidate | null,
  options: ReadonlyArray<OptionRecord>,
  xg: number | null,
  pressure: number
): Decision => {
  const actionProbs: Record<string, number> = { shot: r3(probs.shot) }
  if (probs.short_pass !== undefined) actionProbs.short_pass = r3(probs.short_pass)
  actionProbs.hold = r3(probs.hold)
  if (candidate === null) return { action, candidate: null, decisionQuality: null, xg, pressure, actionProbs, options, chosenRank: null, fallback: false }
  const chosen = toOption(candidate)
  const same = (o: OptionRecord) => o.receiver_id === chosen.receiver_id && o.target_x === chosen.target_x && o.target_y === chosen.target_y
  const recorded = options.some(same) ? options : [...options, chosen]
  const best = Math.max(chosen.value, ...options.map((o) => o.value))
  return {
    action,
    candidate,
    decisionQuality: best > 0 ? Math.max(0, Math.min(1, chosen.value / best)) : 1,
    xg,
    pressure,
    actionProbs,
    options: recorded,
    chosenRank: 1 + options.filter((o) => o.value > chosen.value).length,
    fallback: false
  }
}

import { dist, dirOf, goalOf, PITCH, type Side, type Vec2, type Vec3 } from "./geometry.js"
import type { Params } from "./params.js"
import type { Rng } from "./rng.js"
import type { BallState, PlayerState } from "./types.js"

export type ShotExecution = "clean" | "scuffed" | "sliced" | "skied"
export type ShotOutcome = "goal" | "saved" | "blocked" | "wide"
export type Handling = "clean" | "parried_safe" | "parried_dangerous" | "fumble"

export interface ShotPlan {
  readonly outcome: ShotOutcome
  readonly ticks: number
  readonly from: Vec3
  readonly to: Vec3
  readonly execution: ShotExecution
  readonly onTarget: boolean
  readonly blockerId: string | null
  readonly keeperId: string | null
  readonly handling: Handling | null
  /** True when a scenario script forced this outcome. */
  readonly forced?: boolean
}

/**
 * Adjustments from the game state and scenario scripts: a multiplier on the chance of scoring, a shift of the
 * keeper's save logit, an extra share of fumbled saves, and a forced outcome ("goal": this shot scores;
 * "save" / "keeper_error": if this shot is on target, the keeper saves it / lets it in).
 */
export interface ShotMods {
  readonly scoring?: number
  readonly saveLogit?: number
  readonly fumble?: number
  readonly force?: "goal" | "save" | "keeper_error"
}

const segmentDistance = (a: Vec2, b: Vec2, q: Vec2): { d: number; t: number } => {
  const vx = b.x - a.x
  const vy = b.y - a.y
  const l2 = vx * vx + vy * vy
  const t = l2 < 1e-9 ? 0 : Math.max(0, Math.min(1, ((q.x - a.x) * vx + (q.y - a.y) * vy) / l2))
  return { d: Math.hypot(a.x + t * vx - q.x, a.y + t * vy - q.y), t }
}

const erf = (x: number): number => {
  // Abramowitz-Stegun 7.1.26, |error| < 1.5e-7
  const t = 1 / (1 + 0.3275911 * Math.abs(x))
  const y = 1 - ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x)
  return x >= 0 ? y : -y
}
/** P(lo < N(mean, sd) < hi). */
export const normalBetween = (lo: number, hi: number, mean: number, sd: number): number =>
  0.5 * (erf((hi - mean) / (sd * Math.SQRT2)) - erf((lo - mean) / (sd * Math.SQRT2)))

/**
 * Ball after a keeper parry. A safe parry is pushed wide of the post (it can only go out for a corner
 * or stay in play), never between the posts; a dangerous parry or fumble drops back into the box.
 */
export const parryBall = (side: Side, saveAt: Vec3, handling: Handling, rng: Rng): BallState => {
  const d = dirOf(side)
  const sy = saveAt.y === 0 ? (rng.chance(0.5) ? 1 : -1) : Math.sign(saveAt.y)
  if (handling === "parried_safe")
    return {
      pos: { x: saveAt.x, y: sy * (PITCH.goalHalfWidth + 0.6), z: Math.max(0.5, saveAt.z) },
      vel: { x: d * rng.range(2, 5), y: sy * rng.range(6, 12), z: rng.range(1, 3) }
    }
  return { pos: saveAt, vel: { x: -d * rng.range(3, 7), y: rng.range(-5, 5), z: 0.5 } }
}

/** Where an on-target shot crosses the goal line (m from the centre, m above the ground) and how far it was struck from. */
export interface ShotOnTarget {
  readonly y: number
  readonly z: number
  readonly distance: number
}

/**
 * Chance that the keeper saves an on-target shot: lower towards the posts (`bWide`) and near the bar or the
 * ground (`bEdge`), lower from close range (`bDistance` per 10 m beyond 16 m), higher for quick reflexes.
 */
export const saveChance = (s: ShotOnTarget, keeper: PlayerState, p: Params, logitShift = 0): number => {
  const c = p.shot.save
  const wide = Math.min(1, Math.abs(s.y) / PITCH.goalHalfWidth)
  const edge = Math.min(1, Math.abs(s.z / PITCH.goalHeight - 0.5) * 2)
  return 1 / (1 + Math.exp(-(logitShift + c.b0 + c.bWide * wide + c.bEdge * edge + (c.bDistance * (s.distance - 16)) / 10 + c.bReflexes * (keeper.attrs.reflexes - 0.6))))
}

/**
 * Resolve a shot at release in three steps: a block by a defender, then the aim (execution error decides
 * whether it is on target), then the keeper's save (saveChance). `xg` is the decision model's value; it is
 * recorded on the event and does not set the outcome.
 */
export const planShot = (
  shooter: PlayerState,
  side: Side,
  opponents: ReadonlyArray<PlayerState>,
  xg: number,
  pressure: number,
  isPenalty: boolean,
  p: Params,
  dt: number,
  rng: Rng,
  /** Shooting with the weaker foot widens the aiming error by execution.weakFootK. */
  weakFoot = false,
  mods: ShotMods = {}
): ShotPlan => {
  const scoring = mods.scoring ?? 1
  const goal = goalOf(side)
  const from: Vec3 = { x: shooter.pos.x, y: shooter.pos.y, z: 0.2 }
  const d = dist(shooter.pos, goal)
  const skill = (1.35 - 0.7 * shooter.attrs.finishing) * (weakFoot ? p.execution.weakFootK : 1)
  const aimY = rng.range(-2.9, 2.9)
  const aimZ = rng.range(0.3, 1.8)
  const sdY = (isPenalty ? 1.0 : 1.6 + 0.12 * d) * (1 + 0.8 * pressure) * skill * p.shot.aimNoise
  const sdZ = (0.6 + 0.05 * d) * (1 + 0.5 * pressure) * skill * p.shot.aimNoise
  const pMis = Math.min(0.4, p.execution.mishitBase * 2 + p.execution.mishitK * Math.pow(pressure, 1.6) * (1.2 - shooter.attrs.composure))
  const mis = rng.chance(pMis)
  const misKind = rng.uniform()
  let y = aimY + rng.normal() * sdY
  let z = Math.max(0, aimZ + rng.normal() * sdZ)
  let execution: ShotExecution = "clean"
  if (mis) {
    if (misKind < 0.4) {
      execution = "skied"
      z = rng.range(3, 9)
    } else if (misKind < 0.75) {
      execution = "sliced"
      y = aimY + Math.sign(rng.normal()) * rng.range(4, 12)
    } else {
      execution = "scuffed"
      z = 0
    }
  }
  if (mods.force === "goal") {
    // Scripted: a clean strike inside the frame that beats the keeper.
    const fy = Math.max(-(PITCH.goalHalfWidth - 0.4), Math.min(PITCH.goalHalfWidth - 0.4, y))
    const goalTo: Vec3 = { x: goal.x, y: fy, z: Math.min(z, PITCH.goalHeight - 0.4) }
    return { outcome: "goal", ticks: Math.max(1, Math.ceil(d / p.shot.speed / dt)), from, to: goalTo, execution: "clean", onTarget: true, blockerId: null, keeperId: null, handling: null, forced: true }
  }
  const to: Vec3 = { x: goal.x, y, z }
  const speed = execution === "scuffed" ? p.shot.speed * 0.5 : p.shot.speed
  const travel = (m: number) => Math.max(1, Math.ceil(m / speed / dt))

  if (!isPenalty) {
    const blocked = (o: PlayerState): ShotPlan => ({
      outcome: "blocked", ticks: travel(dist(shooter.pos, o.pos)), from, to: { x: o.pos.x, y: o.pos.y, z: 0.5 }, execution, onTarget: false, blockerId: o.id, keeperId: null, handling: null
    })
    // Defenders near the shot's line get in the way, the closer the likelier, nearest the shooter first...
    const inLane = opponents
      .filter((o) => !o.sentOff && o.role !== "GK")
      .map((o) => ({ o, ...segmentDistance(shooter.pos, goal, o.pos) }))
      .filter((x) => x.d < p.shot.blockWidthM && x.t > 0.02 && x.t < 0.95)
      .sort((a, b) => a.t - b.t)
    for (const x of inLane) if (rng.chance(p.shot.blockPerDefender * (1 - x.d / p.shot.blockWidthM))) return blocked(x.o)
    // ...and the defender closing the shooter down can throw a body in the way.
    const closer = opponents.filter((o) => !o.sentOff && o.role !== "GK").sort((a, b) => dist(a.pos, shooter.pos) - dist(b.pos, shooter.pos))[0]
    if (closer && rng.chance(p.shot.blockPressure * pressure)) return blocked(closer)
  }
  const onTarget = Math.abs(y) < PITCH.goalHalfWidth && z < PITCH.goalHeight
  const keeper = opponents.find((o) => o.role === "GK" && !o.sentOff) ?? null
  if (!onTarget) return { outcome: "wide", ticks: travel(d), from, to, execution, onTarget, blockerId: null, keeperId: null, handling: null }
  const saveAt: Vec3 = { x: goal.x - dirOf(side) * 0.8, y: Math.max(-3.5, Math.min(3.5, y)), z }
  if (keeper && mods.force === "save")
    return { outcome: "saved", ticks: travel(d), from, to: saveAt, execution, onTarget, blockerId: null, keeperId: keeper.id, handling: "clean", forced: true }
  if (keeper && mods.force === "keeper_error")
    return { outcome: "goal", ticks: travel(d), from, to, execution, onTarget, blockerId: null, keeperId: null, handling: null, forced: true }
  // Penalties keep their fixed conversion (scaled by how likely this aim was to be on target); every other
  // shot on target beats the keeper unless saved, by placement, distance and the keeper's reflexes (see saveChance).
  // Heights below 0 are clamped to the ground, so the vertical window is (-inf, crossbar).
  const pGoalClean = isPenalty
    ? Math.min(0.95, 0.76 / Math.max(0.05, normalBetween(-PITCH.goalHalfWidth, PITCH.goalHalfWidth, aimY, sdY) * normalBetween(-50, PITCH.goalHeight, aimZ, sdZ)))
    : Math.min(0.95, (keeper ? 1 - saveChance({ y, z, distance: d }, keeper, p, mods.saveLogit ?? 0) : 1) * scoring)
  const pGoal = mis ? pGoalClean * 0.3 : pGoalClean
  if (rng.chance(pGoal) || keeper === null)
    return { outcome: "goal", ticks: travel(d), from, to, execution, onTarget, blockerId: null, keeperId: null, handling: null }
  const h = rng.uniform()
  const k = keeper.attrs.handling
  const natural: Handling = h < 0.35 + 0.35 * k ? "clean" : h < 0.85 ? "parried_safe" : h < 0.97 ? "parried_dangerous" : "fumble"
  const handling: Handling = (mods.fumble ?? 0) > 0 && rng.chance(mods.fumble!) ? "fumble" : natural
  return { outcome: "saved", ticks: travel(d), from, to: saveAt, execution, onTarget, blockerId: null, keeperId: keeper.id, handling }
}

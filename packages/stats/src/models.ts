/**
 * Pass-difficulty (xPass) and expected-goals (xG) models: a line-for-line port of the feature definitions in
 * python/analytics/touchline_analytics/stats_models.py, with coefficients fitted there on IDSSE
 * (data/params/stats-models.json). A parity test runs both on one synthetic match.
 */
import { PITCH, type Vec2 } from "@touchline/sim-core"

export const LANE_WIDTH_M = 2
export const PRESS_RADIUS_M = 5
const MAX_COUNT = 3
export const XPASS_FEATURES = ["length_10m", "forward_10m", "lane_defenders", "pressure"] as const
export const XG_FEATURES = ["distance_10m", "angle_rad", "header", "cone_defenders"] as const

export interface LogisticModel {
  readonly intercept: number
  readonly coefficients: ReadonlyArray<number>
}

export interface StatsModels {
  readonly version: string
  readonly xpass: LogisticModel
  readonly xg: LogisticModel & { readonly penalty: number }
}

export class ModelsError extends Error {}

const logistic = (raw: unknown, names: ReadonlyArray<string>, label: string): LogisticModel => {
  const m = raw as { intercept?: unknown; coefficients?: Record<string, unknown>; features?: unknown }
  if (typeof m?.intercept !== "number" || !Number.isFinite(m.intercept)) throw new ModelsError(`${label}.intercept must be a finite number`)
  if (JSON.stringify(m.features) !== JSON.stringify(names)) throw new ModelsError(`${label}.features must be ${JSON.stringify(names)}`)
  const coefficients = names.map((n) => {
    const v = m.coefficients?.[n]
    if (typeof v !== "number" || !Number.isFinite(v)) throw new ModelsError(`${label}.coefficients.${n} must be a finite number`)
    return v
  })
  return { intercept: m.intercept, coefficients }
}

/** Read data/params/stats-models.json; throws ModelsError naming the first bad field. */
export const modelsFromJson = (raw: unknown): StatsModels => {
  const j = raw as { version?: unknown; xpass?: unknown; xg?: { penalty?: unknown } }
  if (typeof j?.version !== "string") throw new ModelsError("version must be a string")
  const penalty = j.xg?.penalty
  if (typeof penalty !== "number" || !(penalty > 0 && penalty < 1)) throw new ModelsError("xg.penalty must be a number between 0 and 1")
  return { version: j.version, xpass: logistic(j.xpass, XPASS_FEATURES, "xpass"), xg: { ...logistic(j.xg, XG_FEATURES, "xg"), penalty } }
}

const segmentDistance = (a: Vec2, b: Vec2, q: Vec2): { d: number; t: number } => {
  const vx = b.x - a.x
  const vy = b.y - a.y
  const l2 = vx * vx + vy * vy
  const t = l2 < 1e-9 ? 0 : Math.max(0, Math.min(1, ((q.x - a.x) * vx + (q.y - a.y) * vy) / l2))
  return { d: Math.hypot(a.x + t * vx - q.x, a.y + t * vy - q.y), t }
}

/** Opponents within 2 m of the pass line, away from both ends (5 %-95 % of the way), at most 3. */
export const laneDefenders = (start: Vec2, end: Vec2, opponents: ReadonlyArray<Vec2>): number => {
  let n = 0
  for (const o of opponents) {
    const { d, t } = segmentDistance(start, end, o)
    if (d < LANE_WIDTH_M && t > 0.05 && t < 0.95) n++
  }
  return Math.min(n, MAX_COUNT)
}

/** 1 with an opponent on the ball, falling linearly to 0 at 5 m. */
export const pressureAt = (at: Vec2, opponents: ReadonlyArray<Vec2>): number => {
  if (opponents.length === 0) return 0
  let near = Infinity
  for (const o of opponents) near = Math.min(near, Math.hypot(o.x - at.x, o.y - at.y))
  return Math.max(0, 1 - near / PRESS_RADIUS_M)
}

/** length / 10 m, forward progress / 10 m (`attack` = +1 when attacking +x), lane defenders, pressure. */
export const passFeatures = (start: Vec2, end: Vec2, attack: 1 | -1, opponents: ReadonlyArray<Vec2>): number[] => [
  Math.hypot(end.x - start.x, end.y - start.y) / 10,
  (attack * (end.x - start.x)) / 10,
  laneDefenders(start, end, opponents),
  pressureAt(start, opponents)
]

/** Angle (radians) the goal mouth subtends from `at`. */
export const goalAngle = (at: Vec2, attack: 1 | -1): number => {
  const gx = attack * PITCH.halfL
  const a1 = Math.atan2(PITCH.goalHalfWidth - at.y, gx - at.x)
  const a2 = Math.atan2(-PITCH.goalHalfWidth - at.y, gx - at.x)
  const d = Math.abs(a1 - a2)
  return d > Math.PI ? 2 * Math.PI - d : d
}

const side = (p1: Vec2, p2: Vec2, p3: Vec2) => (p1.x - p3.x) * (p2.y - p3.y) - (p2.x - p3.x) * (p1.y - p3.y)
const inTriangle = (p: Vec2, a: Vec2, b: Vec2, c: Vec2): boolean => {
  const d1 = side(p, a, b)
  const d2 = side(p, b, c)
  const d3 = side(p, c, a)
  return !((d1 < 0 || d2 < 0 || d3 < 0) && (d1 > 0 || d2 > 0 || d3 > 0))
}

/** Opponents inside the triangle from the shooter to both posts, the goalkeeper (the opponent nearest the goal centre) excepted, at most 3. */
export const coneDefenders = (at: Vec2, attack: 1 | -1, opponents: ReadonlyArray<Vec2>): number => {
  if (opponents.length === 0) return 0
  const gx = attack * PITCH.halfL
  let keeper = 0
  opponents.forEach((o, i) => {
    if (Math.hypot(o.x - gx, o.y) < Math.hypot(opponents[keeper]!.x - gx, opponents[keeper]!.y)) keeper = i
  })
  const p1 = { x: gx, y: PITCH.goalHalfWidth }
  const p2 = { x: gx, y: -PITCH.goalHalfWidth }
  let n = 0
  opponents.forEach((o, i) => {
    if (i !== keeper && inTriangle(o, at, p1, p2)) n++
  })
  return Math.min(n, MAX_COUNT)
}

/** distance to the goal centre / 10 m, goal-mouth angle, header (0/1), defenders in the shot cone. */
export const shotFeatures = (at: Vec2, attack: 1 | -1, header: boolean, opponents: ReadonlyArray<Vec2>): number[] => [
  Math.hypot(attack * PITCH.halfL - at.x, at.y) / 10,
  goalAngle(at, attack),
  header ? 1 : 0,
  coneDefenders(at, attack, opponents)
]

const sigmoid = (z: number) => (z >= 0 ? 1 / (1 + Math.exp(-z)) : Math.exp(z) / (1 + Math.exp(z)))

export const predict = (m: LogisticModel, x: ReadonlyArray<number>): number => {
  let z = m.intercept
  m.coefficients.forEach((c, i) => (z += c * x[i]!))
  return sigmoid(z)
}

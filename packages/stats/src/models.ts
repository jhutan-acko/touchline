/**
 * Pass-difficulty (xPass) and expected-goals (xG) models: a line-for-line port of the feature definitions in
 * python/analytics/touchline_analytics/stats_models.py. A parity test runs both on one synthetic match.
 * - xPass: coefficients fitted there on IDSSE (data/params/stats-models.json).
 * - xG (P6 pre-merge fix 3): the simulator's own model, so every consumer shows one xG. The coefficients are the sim
 *   parameters' (xgCoefs: shotModel.xg, the fractional-logit refit to DFL model xG, under shotModel.rule 1), read from
 *   the parameter file the matches run with; the features and the formula are sim-core's (xgFrom, shotLineCount,
 *   directFkXg). stats-models.json keeps only the xG feature names and the penalty rate.
 */
import { directFkXg, PITCH, shotLineCount, xgCoefs, xgFrom, type Params, type Vec2 } from "@touchline/sim-core"

export const LANE_WIDTH_M = 2
export const PRESS_RADIUS_M = 5
const MAX_COUNT = 3
export const XPASS_FEATURES = ["length_10m", "forward_10m", "lane_defenders", "pressure"] as const
export const XG_FEATURES = ["distance_m", "angle_rad", "header", "line_defenders"] as const

export interface LogisticModel {
  readonly intercept: number
  readonly coefficients: ReadonlyArray<number>
}

/** The sim's xG: its parameters (xgCoefs, directFk) and the fixed penalty rate. */
export interface XgModel {
  readonly penalty: number
  readonly params: Params
}

export interface StatsModels {
  readonly version: string
  readonly xpass: LogisticModel
  readonly xg: XgModel
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

/**
 * Read data/params/stats-models.json, with the simulator parameters whose xG the engine uses (normally the committed
 * data/params/touchline-params.json); throws ModelsError naming the first bad field.
 */
export const modelsFromJson = (raw: unknown, params: Params): StatsModels => {
  const j = raw as { version?: unknown; xpass?: unknown; xg?: { penalty?: unknown; features?: unknown } }
  if (typeof j?.version !== "string") throw new ModelsError("version must be a string")
  const penalty = j.xg?.penalty
  if (typeof penalty !== "number" || !(penalty > 0 && penalty < 1)) throw new ModelsError("xg.penalty must be a number between 0 and 1")
  if (JSON.stringify(j.xg?.features) !== JSON.stringify(XG_FEATURES)) throw new ModelsError(`xg.features must be ${JSON.stringify(XG_FEATURES)}`)
  return { version: j.version, xpass: logistic(j.xpass, XPASS_FEATURES, "xpass"), xg: { penalty, params } }
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

/**
 * The opponent taken for the keeper when roles are unknown: the one nearest the centre of the goal `attack` faces.
 * -1 with no opponents.
 */
export const keeperIndex = (attack: 1 | -1, opponents: ReadonlyArray<Vec2>): number => {
  const gx = attack * PITCH.halfL
  let keeper = -1
  opponents.forEach((o, i) => {
    if (keeper < 0 || Math.hypot(o.x - gx, o.y) < Math.hypot(opponents[keeper]!.x - gx, opponents[keeper]!.y)) keeper = i
  })
  return keeper
}

/** Outfield opponents in the shot line (sim-core shotLineCount): within 1.5 m of the line to the goal centre, uncapped. */
export const lineDefenders = (at: Vec2, attack: 1 | -1, outfield: ReadonlyArray<Vec2>): number => shotLineCount(at, { x: attack * PITCH.halfL, y: 0 }, outfield)

/**
 * The sim's xG features: distance to the goal centre (m), goal-mouth angle, header (0/1), outfield opponents in the shot
 * line (`outfield`: the keepers already left out).
 */
export const shotFeatures = (at: Vec2, attack: 1 | -1, header: boolean, outfield: ReadonlyArray<Vec2>): number[] => [
  Math.hypot(attack * PITCH.halfL - at.x, at.y),
  goalAngle(at, attack),
  header ? 1 : 0,
  lineDefenders(at, attack, outfield)
]

/** The sim's xG (sim-core xgFrom on xgCoefs) at shotFeatures. */
export const predictXg = (m: XgModel, x: ReadonlyArray<number>): number => xgFrom(xgCoefs(m.params), x[0]!, x[1]!, x[2] === 1, x[3]!)

/** The sim's direct free-kick xG at `at` (sim-core directFkXg), or null when it is not a central direct free kick. */
export const directFreeKickXg = (m: XgModel, at: Vec2, side: "home" | "away", period: "first_half" | "second_half"): number | null =>
  directFkXg(m.params, side, period, at)

const sigmoid = (z: number) => (z >= 0 ? 1 / (1 + Math.exp(-z)) : Math.exp(z) / (1 + Math.exp(z)))

export const predict = (m: LogisticModel, x: ReadonlyArray<number>): number => {
  let z = m.intercept
  m.coefficients.forEach((c, i) => (z += c * x[i]!))
  return sigmoid(z)
}

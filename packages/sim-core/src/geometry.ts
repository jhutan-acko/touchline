/** Pitch geometry in CDF coordinates: metres, origin at the centre spot; home attacks +x in the first half, -x in the second. */
export const PITCH = {
  length: 105,
  width: 68,
  halfL: 52.5,
  halfW: 34,
  goalHalfWidth: 3.66,
  goalHeight: 2.44,
  boxDepth: 16.5,
  boxHalfWidth: 20.16,
  sixDepth: 5.5,
  penaltySpot: 41.5,
  centreCircle: 9.15
} as const

export type Side = "home" | "away"
export const other = (side: Side): Side => (side === "home" ? "away" : "home")
/** First or second half. Teams switch ends at half-time. */
export type Period = "first_half" | "second_half"
/** +1 if the side attacks +x in this period: home in the first half, away in the second. */
export const dirOf = (side: Side, period: Period): 1 | -1 => ((side === "home") === (period === "first_half") ? 1 : -1)
/** The side attacking the end whose x has the sign of `x` (x > 0: the +x end). */
export const sideAttacking = (x: number, period: Period): Side => (dirOf("home", period) === (x > 0 ? 1 : -1) ? "home" : "away")

export interface Vec2 {
  readonly x: number
  readonly y: number
}
export interface Vec3 {
  readonly x: number
  readonly y: number
  readonly z: number
}

export const v2 = (x: number, y: number): Vec2 => ({ x, y })
export const add = (a: Vec2, b: Vec2): Vec2 => ({ x: a.x + b.x, y: a.y + b.y })
export const sub = (a: Vec2, b: Vec2): Vec2 => ({ x: a.x - b.x, y: a.y - b.y })
export const scale = (a: Vec2, k: number): Vec2 => ({ x: a.x * k, y: a.y * k })
export const len = (a: Vec2): number => Math.hypot(a.x, a.y)
export const dist = (a: Vec2, b: Vec2): number => Math.hypot(a.x - b.x, a.y - b.y)
export const dot = (a: Vec2, b: Vec2): number => a.x * b.x + a.y * b.y
export const norm = (a: Vec2): Vec2 => {
  const l = len(a)
  return l < 1e-9 ? { x: 0, y: 0 } : { x: a.x / l, y: a.y / l }
}
export const clamp = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, v))
export const clampToPitch = (p: Vec2, margin = 0.5): Vec2 => ({
  x: clamp(p.x, -PITCH.halfL + margin, PITCH.halfL - margin),
  y: clamp(p.y, -PITCH.halfW + margin, PITCH.halfW - margin)
})
export const inPitch = (p: Vec2): boolean => Math.abs(p.x) <= PITCH.halfL && Math.abs(p.y) <= PITCH.halfW

/** x as seen by the attacking side: larger is closer to the goal it attacks. */
export const attackX = (side: Side, x: number, period: Period): number => x * dirOf(side, period)
/** Centre of the goal `side` attacks. */
export const goalOf = (side: Side, period: Period): Vec2 => ({ x: PITCH.halfL * dirOf(side, period), y: 0 })

/** 16 x 12 grid index (row-major, row 0 at y = -34), used by fitted tables. */
export const zoneIndex = (p: Vec2, cols = 16, rows = 12): number => {
  const col = clamp(Math.floor(((p.x + PITCH.halfL) / PITCH.length) * cols), 0, cols - 1)
  const row = clamp(Math.floor(((p.y + PITCH.halfW) / PITCH.width) * rows), 0, rows - 1)
  return row * cols + col
}

export const ACTION_ZONES = ["def_wide", "def_central", "mid_wide", "mid_central", "att_wide", "att_central", "box"] as const
export type ActionZone = (typeof ACTION_ZONES)[number]

/** Coarse zone used for action logits, from the attacking side's point of view. */
export const actionZone = (side: Side, period: Period, p: Vec2): ActionZone => {
  const ax = attackX(side, p.x, period)
  const wide = Math.abs(p.y) > PITCH.boxHalfWidth
  if (ax > PITCH.halfL - PITCH.boxDepth && !wide) return "box"
  if (ax < -17.5) return wide ? "def_wide" : "def_central"
  if (ax < 17.5) return wide ? "mid_wide" : "mid_central"
  return wide ? "att_wide" : "att_central"
}

/** Angle (radians) subtended by the goal mouth from p, for the goal `side` attacks. */
export const goalAngle = (side: Side, period: Period, p: Vec2): number => {
  const g = goalOf(side, period)
  const a1 = Math.atan2(PITCH.goalHalfWidth - p.y, g.x - p.x)
  const a2 = Math.atan2(-PITCH.goalHalfWidth - p.y, g.x - p.x)
  return Math.abs(a1 - a2) > Math.PI ? 2 * Math.PI - Math.abs(a1 - a2) : Math.abs(a1 - a2)
}

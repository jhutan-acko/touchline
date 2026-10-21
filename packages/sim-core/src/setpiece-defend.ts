/**
 * S2/S3 defending set pieces (realism v2 P5, plan 8e rulings 8, 9; pre-flight rulings F19, F20, F21, F30): walls, and
 * the box layout at corners and wide free kicks (man-marking within manM, zonal spots on the six-yard line, the corner
 * defending table). Pure functions of their arguments; the only draws are wallSize's, on the rng it is given.
 *
 * Frames (setpiece.ts, F11): table and zonal spots are in the RESTARTING team's frame (u toward the goal being
 * defended), with pitch y; after half-time only x mirrors.
 */
import { assignMarks, markTarget } from "./offball.js"
import { add, attackX, clampToPitch, dirOf, dist, norm, other, PITCH, scale, sub, type Period, type Side, type Vec2 } from "./geometry.js"
import type { Params } from "./params.js"
import type { Rng } from "./rng.js"
import { framePoint, roleSpot, type SetPieceKind } from "./setpiece.js"
import type { PlayerState, Role } from "./types.js"

/** F19: at most nine defending outfielders in the box; one more stands at the box edge for second balls. */
const BOX_CAP = 9
const EDGE: readonly [number, number] = [32, 0]
/** The law's distance at a restart (Law 13), fixed: tuning the wall (setDefend.wallM) never moves it. */
export const LEGAL_M = 9.15
/** The old restart push (step.ts): a defender within LEGAL_M of the ball is moved out to 9.5 m. */
export const PUSH_M = 9.5

/** Whether `p` (pitch) is in the box the restarting side `restarting` attacks. */
export const inSetPieceBox = (p: Vec2, restarting: Side, period: Period): boolean =>
  attackX(restarting, p.x, period) > PITCH.halfL - PITCH.boxDepth && Math.abs(p.y) < PITCH.boxHalfWidth

/** S3: the wall's size: fk_central wallCentral[0]..[1] (equal chance); fk_wide wallWide[0]..[1] with chance wallWideShare, else 0; 0 otherwise (no draw). */
export const wallSize = (kind: SetPieceKind, s: Params["setDefend"], rng: Rng): number => {
  const between = (r: readonly [number, number]): number => r[0] + Math.floor(rng.uniform() * (r[1] - r[0] + 1))
  if (kind === "fk_central") return between(s.wallCentral)
  if (kind === "fk_wide") return rng.chance(s.wallWideShare) ? between(s.wallWide) : 0
  return 0
}

/** The point the wall shades: shadeM inside the near post of `defSide`'s goal (the post on the ball's side). */
const shadePoint = (ball: Vec2, defSide: Side, period: Period, s: Params["setDefend"]): Vec2 => ({
  x: -dirOf(defSide, period) * PITCH.halfL,
  y: Math.sign(ball.y) * (PITCH.goalHalfWidth - s.shadeM)
})

/** S3: where the wall stands, at ball distance wallM along the line to the shade point. @internal */
export const wallPoint = (ball: Vec2, defSide: Side, period: Period, s: Params["setDefend"]): Vec2 =>
  add(ball, scale(norm(sub(shadePoint(ball, defSide, period, s), ball)), s.wallM))

/**
 * S3 (F21): n wall spots on the wallM arc around the ball, centred on the line to the point shadeM inside the near post,
 * neighbours a wallGapM chord apart; member i stands jitter[i] (<= 0) radially closer. Clamped half a metre inside the
 * pitch, so a wall never stands behind the goal line.
 */
export const wallSpots = (ball: Vec2, defSide: Side, period: Period, n: number, jitter: ReadonlyArray<number>, s: Params["setDefend"]): Vec2[] => {
  const dir = norm(sub(shadePoint(ball, defSide, period, s), ball))
  const a0 = Math.atan2(dir.y, dir.x)
  const step = 2 * Math.asin(Math.min(1, s.wallGapM / (2 * s.wallM)))
  return Array.from({ length: n }, (_, i) => {
    const a = a0 + (i - (n - 1) / 2) * step
    const r = s.wallM + (jitter[i] ?? 0)
    return clampToPitch({ x: ball.x + r * Math.cos(a), y: ball.y + r * Math.sin(a) }, 0.5)
  })
}

/** S2 (F20): zonal spot i (zonal[i], the last one past the end) in the restarting team's frame, pitch y. */
export const zonalSpot = (i: number, defSide: Side, period: Period, s: Params["setDefend"]): Vec2 => {
  const [u, y] = s.zonal[Math.min(i, s.zonal.length - 1)]!
  return framePoint(other(defSide), period, u, y)
}

/** A defending outfielder in the box layout: his id, role and side of the pitch (sign of his open-play anchor's y). */
export interface BoxDefender {
  readonly id: string
  readonly role: Role
  readonly ySign: number
}

/**
 * A spot at least LEGAL_M from the ball: inside it, pushed straight out to PUSH_M (the old push; +x when the spot is the
 * ball's own), then clamped half a metre inside the pitch. By the byline the clamp can bring it back inside LEGAL_M (F30).
 */
export const clearOfBall = (spot: Vec2, ball: Vec2): Vec2 => {
  if (dist(spot, ball) >= LEGAL_M) return spot
  const out = sub(spot, ball)
  const dir = out.x === 0 && out.y === 0 ? { x: 1, y: 0 } : norm(out)
  return clampToPitch(add(ball, scale(dir, PUSH_M)), 0.5)
}

/**
 * S2 (ruling 8, F19): spots for the defending outfielders `defs` at a set piece taken by the other side at `ball`.
 * - Man-marking: each attacker (at his box point: `attackers[].pos`) within manM of a defender's corner-table spot is
 *   assigned with assignMarks and marked goalSideM goal-side (weight 1); at most nine markers, nearest pairs first.
 * - With `zonal`, the unassigned defenders take the zonal spots in order (each spot the nearest of them by table spot),
 *   then their corner-table spots; when that would put more than nine in the box, the last of them goes to the box edge.
 * - Without `zonal` (central free kicks), only the markers get a spot.
 * Every spot is kept LEGAL_M from the ball (clearOfBall). Ids absent from the map have no spot.
 */
export const boxLayout = (
  defs: ReadonlyArray<BoxDefender>,
  attackers: ReadonlyArray<PlayerState>,
  ball: Vec2,
  defSide: Side,
  period: Period,
  s: Params["setDefend"],
  zonal: boolean
): Map<string, Vec2> => {
  const restarting = other(defSide)
  const anchor = new Map(defs.map((d) => [d.id, roleSpot(s.corner, d.role, d.ySign, restarting, period)]))
  const marks = assignMarks(
    defs.map((d) => ({ id: d.id, anchor: anchor.get(d.id)! })),
    attackers,
    s.manM
  )
  const pairs = [...marks].sort(([d1, a1], [d2, a2]) => dist(anchor.get(d1)!, a1.pos) - dist(anchor.get(d2)!, a2.pos)).slice(0, BOX_CAP)
  const out = new Map<string, Vec2>()
  for (const [d, a] of pairs) out.set(d, markTarget(anchor.get(d)!, a.pos, defSide, period, s.goalSideM, 1))
  if (zonal) {
    const free = defs.filter((d) => !out.has(d.id))
    const order: BoxDefender[] = []
    const zonalSpots = new Map<string, Vec2>()
    for (let i = 0; i < s.zonal.length && free.length > 0; i++) {
      const z = zonalSpot(i, defSide, period, s)
      let best = 0
      for (let j = 1; j < free.length; j++) if (dist(anchor.get(free[j]!.id)!, z) < dist(anchor.get(free[best]!.id)!, z)) best = j
      const [d] = free.splice(best, 1)
      order.push(d!)
      zonalSpots.set(d!.id, z)
    }
    // The rest on their corner-table spots, nearest the goal first; the last of the sequence is the edge player. When
    // nobody is left after the zonal spots (six markers of ten, say), that last one is the defender given the final zonal
    // spot (the penalty spot), so the penalty spot stays empty and he stands at the box edge instead.
    free.sort((a, b) => attackX(restarting, anchor.get(b.id)!.x, period) - attackX(restarting, anchor.get(a.id)!.x, period) || (a.id < b.id ? -1 : 1))
    order.push(...free)
    const edge = pairs.length + order.length > BOX_CAP ? order[order.length - 1]?.id : undefined
    for (const d of order) out.set(d.id, d.id === edge ? framePoint(restarting, period, EDGE[0], EDGE[1]) : (zonalSpots.get(d.id) ?? anchor.get(d.id)!))
  }
  for (const [id, p] of out) out.set(id, clearOfBall(p, ball))
  return out
}

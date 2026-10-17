import { defendersInLane } from "./decide.js"
import { add, clampToPitch, dirOf, dist, len, norm, PITCH, scale, sub, type Period, type Side, type Vec2 } from "./geometry.js"
import type { Params } from "./params.js"
import type { PlayerState } from "./types.js"

/** Directions a supporter can offer around the carrier: every 45 degrees. */
const ANGLES = Array.from({ length: 8 }, (_, i) => (i * Math.PI) / 4)
const SPACE_CAP_M = 10
const LANE_PENALTY = 4
const ANCHOR_PULL = 0.15
const FORWARD_BONUS = 0.1
const SOFTMAX_T = 0.5
/** Start of the attacking third in the team frame (the analysis zones: def < -17.5 <= mid <= 17.5 < att). */
const ATT_THIRD_U = 17.5

/**
 * Where a supporter offers an angle: a softmax-weighted average of 8 spots `distM` around the carrier, each scored
 * by space from opponents, an open passing lane, closeness to the player's shape anchor and forward gain. The
 * average (rather than the best spot) moves smoothly as players move, so supporters do not flicker between angles.
 * The average of spots on a circle lies inside it (11 m for distM 14 in play); onRing (support rule 1) puts the
 * spot back out on the circle in the averaged direction, so distM is the distance actually offered.
 */
export const supportSpot = (carrier: Vec2, anchor: Vec2, side: Side, period: Period, opponents: ReadonlyArray<PlayerState>, distM: number, onRing = false): Vec2 => {
  const d = dirOf(side, period)
  const spots = ANGLES.map((a) => clampToPitch({ x: carrier.x + Math.cos(a) * distM, y: carrier.y + Math.sin(a) * distM }, 1))
  const scores = spots.map((s) => {
    let space = SPACE_CAP_M
    for (const o of opponents) if (!o.sentOff) space = Math.min(space, dist(s, o.pos))
    return space - LANE_PENALTY * defendersInLane(carrier, s, opponents) - ANCHOR_PULL * dist(s, anchor) + FORWARD_BONUS * d * (s.x - carrier.x)
  })
  const m = Math.max(...scores)
  const w = scores.map((v) => Math.exp((v - m) / SOFTMAX_T))
  const z = w.reduce((a, b) => a + b, 0)
  const mean = spots.reduce((acc, s, i) => ({ x: acc.x + (s.x * w[i]!) / z, y: acc.y + (s.y * w[i]!) / z }), { x: 0, y: 0 })
  if (!onRing) return mean
  const off = sub(mean, carrier)
  const r = len(off)
  if (r < 1e-6) return spots[scores.indexOf(m)]!
  return clampToPitch(add(carrier, scale(off, distM / r)), 1)
}

/**
 * Support rule 1: how many of the nearest outfielders come short. `count` when an opponent is within pressM of the
 * carrier, else calmCount. Real near open options rise under pressure (4-10 m: 0.39 per pass under 2 m, 0.38 at
 * 2-5 m, 0.23 unpressured; carrier-report C1).
 */
export const supportersWanted = (carrier: Vec2, opponents: ReadonlyArray<PlayerState>, s: Params["support"]): number => {
  let near = Infinity
  for (const o of opponents) if (!o.sentOff) near = Math.min(near, dist(o.pos, carrier))
  return near <= s.pressM ? s.count : s.calmCount
}

/**
 * Support rule 1 spacing: a teammate's target closer than spaceM to the carrier moves straight out to spaceM, so he
 * does not crowd the ball (the same object back when it is already far enough). A target on the carrier goes back
 * toward the player's own goal. On the pitch.
 */
export const spacedTarget = (carrier: Vec2, target: Vec2, side: Side, period: Period, spaceM: number): Vec2 => {
  const off = sub(target, carrier)
  const r = len(off)
  if (r >= spaceM) return target
  const dir = r > 1e-6 ? scale(off, 1 / r) : { x: -dirOf(side, period), y: 0 }
  return clampToPitch(add(carrier, scale(dir, spaceM)), 1)
}

/** Support rule 1: the spacing around a carrier, spaceAttM once he is in the attacking third (team-frame u > 17.5 m), else spaceM. */
export const spacingFor = (carrier: Vec2, side: Side, period: Period, s: Params["support"]): number =>
  dirOf(side, period) * carrier.x > ATT_THIRD_U ? s.spaceAttM : s.spaceM

/** Greedy one-to-one marking: the closest (defender anchor, attacker) pairs within radiusM are taken first; ties by id. */
export const assignMarks = (
  defenders: ReadonlyArray<{ readonly id: string; readonly anchor: Vec2 }>,
  attackers: ReadonlyArray<PlayerState>,
  radiusM: number
): Map<string, PlayerState> => {
  const pairs: Array<{ d: string; a: PlayerState; r: number }> = []
  for (const d of defenders)
    for (const a of attackers) {
      const r = dist(d.anchor, a.pos)
      if (r <= radiusM) pairs.push({ d: d.id, a, r })
    }
  const cmp = (x: string, y: string) => (x < y ? -1 : x > y ? 1 : 0)
  pairs.sort((x, y) => x.r - y.r || cmp(x.d, y.d) || cmp(x.a.id, y.a.id))
  const out = new Map<string, PlayerState>()
  const taken = new Set<string>()
  for (const p of pairs)
    if (!out.has(p.d) && !taken.has(p.a.id)) {
      out.set(p.d, p.a)
      taken.add(p.a.id)
    }
  return out
}

/** Where a marker stands: `weight` of the way from the shape anchor to a spot goalSideM goal-side of the attacker. */
export const markTarget = (anchor: Vec2, attacker: Vec2, defSide: Side, period: Period, goalSideM: number, weight: number, widthSlackM?: number): Vec2 => {
  const ownGoal = { x: -dirOf(defSide, period) * PITCH.halfL, y: 0 }
  const spot = add(attacker, scale(norm(sub(ownGoal, attacker)), goalSideM))
  const t = add(anchor, scale(sub(spot, anchor), weight))
  if (widthSlackM === undefined) return t
  const lim = Math.abs(anchor.y) + widthSlackM
  return { x: t.x, y: Math.max(-lim, Math.min(lim, t.y)) }
}

/** A carry heading bent sideways, away from opponents ahead within avoidM (closer pushes harder); unit length. */
export const steerCarry = (dir: Vec2, pos: Vec2, opponents: ReadonlyArray<PlayerState>, avoidM: number): Vec2 => {
  if (avoidM <= 0) return dir
  let push: Vec2 = { x: 0, y: 0 }
  for (const o of opponents) {
    if (o.sentOff) continue
    const rel = sub(o.pos, pos)
    const d = len(rel)
    if (d < 1e-6 || d > avoidM || rel.x * dir.x + rel.y * dir.y <= 0) continue
    // Sidestep perpendicular to the heading, to the side away from the opponent.
    const away = dir.x * rel.y - dir.y * rel.x > 0 ? -1 : 1
    push = add(push, scale({ x: -dir.y * away, y: dir.x * away }, (avoidM - d) / avoidM))
  }
  return push.x === 0 && push.y === 0 ? dir : norm(add(dir, push))
}

/** Where a holding carrier goes when the nearest opponent is within shieldM: 2 m straight away from them, on the pitch. */
export const shieldTarget = (pos: Vec2, opponents: ReadonlyArray<PlayerState>, shieldM: number): Vec2 | null => {
  if (shieldM <= 0) return null
  let near: PlayerState | null = null
  let nd = Infinity
  for (const o of opponents) {
    if (o.sentOff) continue
    const d = dist(pos, o.pos)
    if (d < nd) {
      nd = d
      near = o
    }
  }
  if (!near || nd > shieldM) return null
  return clampToPitch(add(pos, scale(norm(sub(pos, near.pos)), 2)), 1)
}

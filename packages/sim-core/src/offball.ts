import { defendersInLane } from "./decide.js"
import { add, clampToPitch, dirOf, dist, norm, PITCH, scale, sub, type Side, type Vec2 } from "./geometry.js"
import type { PlayerState } from "./types.js"

/** Directions a supporter can offer around the carrier: every 45 degrees. */
const ANGLES = Array.from({ length: 8 }, (_, i) => (i * Math.PI) / 4)
const SPACE_CAP_M = 10
const LANE_PENALTY = 4
const ANCHOR_PULL = 0.15
const FORWARD_BONUS = 0.1
const SOFTMAX_T = 0.5

/**
 * Where a supporter offers an angle: a softmax-weighted average of 8 spots `distM` around the carrier, each scored
 * by space from opponents, an open passing lane, closeness to the player's shape anchor and forward gain. The
 * average (rather than the best spot) moves smoothly as players move, so supporters do not flicker between angles.
 */
export const supportSpot = (carrier: Vec2, anchor: Vec2, side: Side, opponents: ReadonlyArray<PlayerState>, distM: number): Vec2 => {
  const d = dirOf(side)
  const spots = ANGLES.map((a) => clampToPitch({ x: carrier.x + Math.cos(a) * distM, y: carrier.y + Math.sin(a) * distM }, 1))
  const scores = spots.map((s) => {
    let space = SPACE_CAP_M
    for (const o of opponents) if (!o.sentOff) space = Math.min(space, dist(s, o.pos))
    return space - LANE_PENALTY * defendersInLane(carrier, s, opponents) - ANCHOR_PULL * dist(s, anchor) + FORWARD_BONUS * d * (s.x - carrier.x)
  })
  const m = Math.max(...scores)
  const w = scores.map((v) => Math.exp((v - m) / SOFTMAX_T))
  const z = w.reduce((a, b) => a + b, 0)
  return spots.reduce((acc, s, i) => ({ x: acc.x + (s.x * w[i]!) / z, y: acc.y + (s.y * w[i]!) / z }), { x: 0, y: 0 })
}

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
export const markTarget = (anchor: Vec2, attacker: Vec2, defSide: Side, goalSideM: number, weight: number): Vec2 => {
  const ownGoal = { x: -dirOf(defSide) * PITCH.halfL, y: 0 }
  const spot = add(attacker, scale(norm(sub(ownGoal, attacker)), goalSideM))
  return add(anchor, scale(sub(spot, anchor), weight))
}

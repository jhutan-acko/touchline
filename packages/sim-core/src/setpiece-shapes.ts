/**
 * S5-S7 (realism v2 P5, plan 8e ruling 10): the pure geometry of goal-kick, throw-in and kickoff shapes. The role tables
 * live in params (`setShapes`); the restart-shape seam in step.ts picks each player's row. No draw anywhere.
 */
import { attackX, dist, dirOf, PITCH, type Period, type Side, type Vec2 } from "./geometry.js"
import { framePoint } from "./setpiece.js"
import type { PlayerState } from "./types.js"

/** Opponents at a goal kick stand outside the box: u (the kicker's frame) beyond -36 + 0.5 while |y| < 20.16 + 0.5. */
const BOX_EDGE_U = -PITCH.halfL + 16.5 // -36
const BOX_CLEAR_M = 0.5
const BOX_HALF_W = 20.16

/**
 * A goal-kick opponent's spot pushed out of the kicker's penalty box (plus 0.5 m): inside the box strip it moves along u
 * to the box edge, keeping y. `kickerSide` is the side taking the kick; spots are pitch coordinates.
 */
export const outsideBox = (spot: Vec2, kickerSide: Side, period: Period): Vec2 => {
  const u = attackX(kickerSide, spot.x, period)
  const edge = BOX_EDGE_U + BOX_CLEAR_M
  if (u > edge || Math.abs(spot.y) > BOX_HALF_W + BOX_CLEAR_M) return spot
  return framePoint(kickerSide, period, edge, spot.y)
}

const CENTRE_CIRCLE_M = 9.15

/**
 * A kickoff spot made legal: the player (of `side`) stands in his own half (u <= 0 in his own frame); a player of the
 * non-restarting team also stands at least 9.15 m from the centre spot, pushed back along u (y kept) when inside it.
 */
export const kickoffLegal = (spot: Vec2, side: Side, period: Period, restarting: boolean): Vec2 => {
  const d = dirOf(side, period)
  let u = Math.min(attackX(side, spot.x, period), 0)
  if (!restarting) {
    const y = Math.abs(spot.y)
    if (y < CENTRE_CIRCLE_M) u = Math.min(u, -Math.sqrt(CENTRE_CIRCLE_M * CENTRE_CIRCLE_M - y * y))
  }
  return { x: u * d + 0, y: spot.y }
}

/** The `n` outfield players (no keeper, nobody sent off) nearest `at`, other than the taker; ties by id. */
export const throwShortIds = (team: ReadonlyArray<PlayerState>, takerId: string, at: Vec2, n: number): string[] =>
  team
    .filter((p) => p.role !== "GK" && !p.sentOff && p.id !== takerId)
    .map((p) => ({ id: p.id, d: dist(p.pos, at) }))
    .sort((a, b) => a.d - b.d || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
    .slice(0, Math.max(0, n))
    .map((x) => x.id)

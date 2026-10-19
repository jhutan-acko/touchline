/**
 * Set-piece helpers shared by the P5 set-piece modules (realism v2 P5, plan 8e rulings 3, 4): classifying a restart in
 * the taking side's frame and placing role-table spots. Pure functions of their arguments; no draw.
 *
 * Set-piece frame (plan 8e ruling F11): u = attackX(side, x, period), +52.5 at the opponents' goal line, and y is the
 * PITCH y (not mirrored, unlike anchor.ts's team frame): a table's sign is a pitch sign, and "the mirror" after half-time
 * mirrors x only. Attacking third u > 17.5, own third u < -17.5; a wide free kick has |y| > 20.16 (the box's width).
 */
import { attackX, dirOf, type Period, type Side, type Vec2 } from "./geometry.js"
import type { DeadKey, Params, RoleTable } from "./params.js"
import type { RestartKind, Role } from "./types.js"

/** A restart as the set-piece modules see it: the kind of restart, refined by where it is taken. */
export type SetPieceKind = "corner" | "fk_wide" | "fk_central" | "fk_other" | "throw_def" | "throw_mid" | "throw_att" | "goal_kick" | "kickoff" | "penalty"

const THIRD_U = 17.5
const BOX_HALF_W = 20.16

/** The set-piece kind of a restart taken by `side` at `at` (pitch coordinates), judged in that side's frame. */
export const setPieceKind = (restart: RestartKind, at: Vec2, side: Side, period: Period): SetPieceKind => {
  const u = attackX(side, at.x, period)
  switch (restart) {
    case "free_kick":
      if (u <= THIRD_U) return "fk_other"
      return Math.abs(at.y) > BOX_HALF_W ? "fk_wide" : "fk_central"
    case "throw_in":
      return u < -THIRD_U ? "throw_def" : u > THIRD_U ? "throw_att" : "throw_mid"
    default:
      return restart
  }
}

/** The S8 delay key of a set-piece kind (deadBall.medianS, sigma); null for a penalty, which keeps the old draw. */
export const deadKey = (kind: SetPieceKind): keyof Params["deadBall"]["medianS"] | null => {
  const keys: Readonly<Record<SetPieceKind, DeadKey | null>> = {
    corner: "corner",
    fk_wide: "free_kick_att",
    fk_central: "free_kick_att",
    fk_other: "free_kick",
    throw_def: "throw_in",
    throw_mid: "throw_in",
    throw_att: "throw_in",
    goal_kick: "goal_kick",
    kickoff: "kickoff",
    penalty: null
  }
  return keys[kind]
}

/** Pitch coordinates of the point (u, y) in `side`'s set-piece frame this period: x = u x dirOf(side, period), y as given. */
export const framePoint = (side: Side, period: Period, u: number, y: number): Vec2 =>
  // `+ 0` turns a zero coordinate's -0 into +0 (u 0 times a direction of -1); a NaN stays NaN.
  ({ x: u * dirOf(side, period) + 0, y: y + 0 })

/**
 * A role's spot from a set-piece table: u in the restarting side's (`frameSide`) frame, and |y| on the player's own side
 * of the pitch (`ySign`, the sign of his open-play anchor's pitch y; 0 puts him on y 0). DM uses CM's row (ruling 4).
 */
export const roleSpot = (table: RoleTable, role: Role, ySign: number, frameSide: Side, period: Period): Vec2 => {
  const [u, absY] = table[role === "DM" ? "CM" : role]
  return framePoint(frameSide, period, u, ySign * absY)
}

/** The side of the pitch an anchor stands on: the sign of its pitch y (0 on the centre line, -0 included). */
export const ySignOf = (anchor: Vec2): -1 | 0 | 1 => (anchor.y > 0 ? 1 : anchor.y < 0 ? -1 : 0)

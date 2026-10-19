/**
 * S1/S4 attacking set pieces (realism v2 P5, plan 8e rulings 4, 6, 7): which players stay back in rest defence and where,
 * the restarting side's role table for a set-piece kind, and the spot an attacker holds until the kick. Pure functions of
 * their arguments; the only draws are on the `rng` passed in (the `setpiece` stream in step.ts).
 *
 * Frame: the set-piece frame of setpiece.ts (u along the restarting side's attack, y the pitch y; ruling F11).
 */
import { dirOf, type Period, type Side, type Vec2 } from "./geometry.js"
import type { Params, RoleTable } from "./params.js"
import type { Rng } from "./rng.js"
import { framePoint, roleSpot, ySignOf, type SetPieceKind } from "./setpiece.js"
import type { PlayerState, Role } from "./types.js"

type SetAttack = Params["setAttack"]

/**
 * Rest-defence preference (ruling 7): FB, CM, DM, CB, then the forward roles for a side short of those. Within a role,
 * team (slot) order.
 */
const REST_ORDER: ReadonlyArray<Role> = ["FB", "CM", "DM", "CB", "AM", "W", "ST"]

/** The set-piece kinds with a rest-defence count (setAttack.restKeep). */
export const restKind = (kind: SetPieceKind): keyof SetAttack["restKeep"] | null =>
  kind === "corner" || kind === "fk_wide" || kind === "fk_central" || kind === "throw_att" ? kind : null

/**
 * S4: the players `team` keeps back: floor(k), plus one more with chance frac(k) (one draw on `rng`), taken in REST_ORDER
 * from the active outfielders other than the taker; never more than there are.
 */
export const restKeepers = (team: ReadonlyArray<PlayerState>, takerId: string, k: number, rng: Rng): string[] => {
  const whole = Math.floor(k)
  const n = whole + (rng.chance(k - whole) ? 1 : 0)
  const pool = team.filter((pl) => !pl.sentOff && pl.role !== "GK" && pl.id !== takerId)
  const rank = (r: Role): number => REST_ORDER.indexOf(r)
  // Array.prototype.sort is stable: slot order within a role.
  return [...pool].sort((a, b) => rank(a.role) - rank(b.role)).slice(0, Math.max(0, n)).map((pl) => pl.id)
}

/** S4: each rest keeper's spot, u U(restU) and y U(-restSpreadM, restSpreadM) in `side`'s frame (two draws each, in order). */
export const restSpots = (ids: ReadonlyArray<string>, side: Side, period: Period, s: SetAttack, rng: Rng): Record<string, Vec2> => {
  const out: Record<string, Vec2> = {}
  for (const id of ids) {
    const u = rng.range(s.restU[0], s.restU[1])
    const y = rng.range(-s.restSpreadM, s.restSpreadM)
    out[id] = framePoint(side, period, u, y)
  }
  return out
}

/**
 * S1: the restarting side's role table for `kind`: corners their own; wide and central attacking free kicks the pooled
 * free-kick table, a wide one moved fkWideShiftU up the pitch (the keeper's row stays); null for every other kind.
 */
export const attackTable = (kind: SetPieceKind, s: SetAttack): RoleTable | null => {
  switch (kind) {
    case "corner":
      return s.corner
    case "fk_central":
      return s.fk
    case "fk_wide": {
      const out = {} as Record<Role, readonly [number, number]>
      for (const [role, [u, y]] of Object.entries(s.fk) as Array<[Role, readonly [number, number]]>)
        out[role] = role === "GK" ? [u, y] : [u + s.fkWideShiftU, y]
      return out
    }
    default:
      return null
  }
}

/** S1: a player's table spot: his role's (u, |y|) in `frameSide`'s frame, on the side of the pitch his anchor stands on. */
export const attackRoleSpot = (table: RoleTable, role: Role, anchor: Vec2, frameSide: Side, period: Period): Vec2 =>
  roleSpot(table, role, ySignOf(anchor), frameSide, period)

/** S1: where an attacker waits for the kick: `holdBackM` short of his spot, toward his own goal (x only). */
export const holdSpot = (spot: Vec2, side: Side, period: Period, holdBackM: number): Vec2 => ({
  x: spot.x - dirOf(side, period) * holdBackM,
  y: spot.y
})

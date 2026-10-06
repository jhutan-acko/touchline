import { clampToPitch, whatIf, type Estimate, type PlayerState, type Vec2 } from "@touchline/sim-core"
import type { XtGrid } from "@touchline/stats"
import { AdvisorError, type Session } from "./session.js"
import { passValue, xtEndValue } from "./value.js"

export interface PositionAdvice {
  readonly player_id: string
  readonly tick: number
  /** attack: the player's team has the ball (be a better target); defend: the opponents have it (take away their best option). */
  readonly mode: "attack" | "defend"
  readonly from: Vec2
  readonly to: Vec2
  /** attack: value of a pass to the player there; defend: the opponents' best pass value with the player there (lower is better). */
  readonly value_now: number
  readonly value_best: number
  /** How much better the suggested spot is (always 0 or more). */
  readonly gain: number
  readonly verification: { readonly seeds: number; readonly horizon_s: number; readonly xg_diff: Estimate; readonly end_value: Estimate; readonly total: Estimate; readonly possession_end: Estimate } | null
}

export interface PositionOptions {
  /** How far the player may move (default 12 m). */
  readonly radiusM?: number
  /** Spacing of the spots tried (default 2 m). */
  readonly stepM?: number
  /** Paired seeds to check the move by re-simulation (default 0: no check). */
  readonly seeds?: number
  readonly horizonS?: number
}

/**
 * The best spot within reach for a player at a tick (the "ghost"): in attack, where a pass from the player on the
 * ball would be worth most (pitch control x xT, minus the threat if lost); in defence, where the ball carrier's
 * best pass option is worth least. Optionally checked by re-simulating the move over paired seeds.
 */
export const suggestPosition = (session: Session, playerId: string, tick: number, xt: XtGrid, opts: PositionOptions = {}): PositionAdvice => {
  const s = session.stateAt(tick)
  const me = s.players.find((p) => p.id === playerId)
  if (!me || me.sentOff) throw new AdvisorError(`no player "${playerId}" on the pitch at tick ${tick}`)
  if (s.possession.kind !== "owned") throw new AdvisorError(`nobody has the ball at tick ${tick}`)
  const carrier = s.players.find((p) => p.id === (s.possession as { playerId: string }).playerId)!
  if (carrier.id === me.id) throw new AdvisorError(`${playerId} is on the ball; ask about another player`)
  const mode = carrier.side === me.side ? "attack" : "defend"
  const radius = opts.radiusM ?? 12
  const stepM = opts.stepM ?? 2
  const at = (spot: Vec2): PlayerState[] => s.players.map((p) => (p.id === me.id ? { ...p, pos: spot, vel: { x: 0, y: 0 } } : p))
  // Attack: a pass to the player at the spot. Defence: the carrier's best pass to any teammate, with the player there.
  const score = (spot: Vec2): number => {
    const players = at(spot)
    if (mode === "attack") return passValue(s, me.side, carrier.id, carrier.pos, spot, xt, players).value
    let best = -Infinity
    for (const t of players) if (t.side === carrier.side && t.id !== carrier.id && !t.sentOff) best = Math.max(best, passValue(s, carrier.side, carrier.id, carrier.pos, t.pos, xt, players).value)
    return best
  }
  const better = (a: number, b: number) => (mode === "attack" ? a > b : a < b)
  const valueNow = score(me.pos)
  let bestSpot = me.pos
  let bestValue = valueNow
  for (let dx = -radius; dx <= radius; dx += stepM)
    for (let dy = -radius; dy <= radius; dy += stepM) {
      if (Math.hypot(dx, dy) > radius) continue
      const spot = clampToPitch({ x: me.pos.x + dx, y: me.pos.y + dy })
      const v = score(spot)
      if (better(v, bestValue)) {
        bestValue = v
        bestSpot = spot
      }
    }
  const seeds = opts.seeds ?? 0
  const r = seeds > 0 && bestSpot !== me.pos ? whatIf(s, { kind: "move_player", playerId: me.id, to: bestSpot }, { side: me.side, seeds, horizonS: opts.horizonS ?? 10, endValue: xtEndValue(xt) }) : null
  return {
    player_id: me.id,
    tick,
    mode,
    from: me.pos,
    to: bestSpot,
    value_now: valueNow,
    value_best: bestValue,
    gain: Math.abs(bestValue - valueNow),
    verification: r ? { seeds, horizon_s: r.horizon_s, xg_diff: r.difference.xg_diff, end_value: r.difference.end_value, total: r.difference.total, possession_end: r.difference.possession_end } : null
  }
}

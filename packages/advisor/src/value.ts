import { pitchControlAt, type EndValue, type MatchState, type PcPlayer, type PlayerState, type Side, type Vec2 } from "@touchline/sim-core"
import { xtAt, type XtGrid } from "@touchline/stats"

export const toPc = (p: PlayerState): PcPlayer => ({ x: p.pos.x, y: p.pos.y, vx: p.vel.x, vy: p.vel.y, gk: p.role === "GK" })
const attackOf = (side: Side): 1 | -1 => (side === "home" ? 1 : -1)

/**
 * The value of playing the ball from `from` to `target` for `side`: the chance of keeping it there (pitch control)
 * times the threat of having it there, minus the chance of losing it times the threat the opponents then have
 * (both xT). `passer` is left out of the receivers.
 */
export const passValue = (s: MatchState, side: Side, passerId: string | null, from: Vec2, target: Vec2, xt: XtGrid, players = s.players): { pc: number; value: number } => {
  const active = players.filter((p) => !p.sentOff)
  const att = active.filter((p) => p.side === side && p.id !== passerId).map(toPc)
  const def = active.filter((p) => p.side !== side).map(toPc)
  const pc = pitchControlAt(target, att, def, from).att
  const value = pc * xtAt(xt, target.x, target.y, attackOf(side)) - (1 - pc) * xtAt(xt, target.x, target.y, attackOf(side === "home" ? "away" : "home"))
  return { pc, value }
}

/**
 * The expected threat a state leaves a team with: xT of where the ball is if the team has it, minus the opponents'
 * xT there if they do, 0 while the ball is loose or in the air.
 */
export const xtEndValue =
  (xt: XtGrid): EndValue =>
  (s, side) => {
    if (s.possession.kind !== "owned") return 0
    const owner = s.players.find((p) => p.id === (s.possession as { playerId: string }).playerId)!
    const v = xtAt(xt, s.ball.pos.x, s.ball.pos.y, attackOf(owner.side))
    return owner.side === side ? v : -v
  }

import { stepBall } from "./ball.js"
import { dist, inPitch, type Side } from "./geometry.js"
import { vmaxFor } from "./kinematics.js"
import type { Params } from "./params.js"
import type { Rng } from "./rng.js"
import type { BallState, PlayerState } from "./types.js"

export interface Resolution {
  /** Ticks after release at which the flight resolves (>= 1). */
  readonly ticks: number
  readonly winnerId: string | null
  readonly result: "reached" | "out" | "stopped"
  /** Ball state at resolution (what stepBall will have produced by then). */
  readonly ball: BallState
  readonly aerial: { readonly winnerId: string; readonly loserId: string } | null
}

const sigmoid = (z: number): number => 1 / (1 + Math.exp(-z))

/**
 * Predict a kicked ball tick by tick with the same physics the engine uses, and find the
 * first player who can reach it (time-to-intercept), or the tick it leaves the pitch.
 * The intended receiver anticipates (no reaction delay); everyone else reacts after reactionS.
 */
export const resolveFlight = (
  start: BallState,
  fromId: string,
  intendedId: string | null,
  players: ReadonlyArray<PlayerState>,
  p: Params,
  dt: number,
  rng: Rng,
  maxTicks = 80
): Resolution => {
  let b = start
  for (let k = 1; k <= maxTicks; k++) {
    b = stepBall(b, dt, p.ball)
    const flat = { x: b.pos.x, y: b.pos.y }
    if (!inPitch(flat)) return { ticks: k, winnerId: null, result: "out", ball: b, aerial: null }
    if (b.pos.z > p.kinematics.headerHeightM) continue
    const t = k * dt
    const qualifiers: Array<{ pl: PlayerState; slack: number }> = []
    for (const pl of players) {
      if (pl.sentOff) continue
      if (pl.id === fromId && t < 0.6) continue
      const reaction = pl.id === intendedId ? 0 : p.kinematics.reactionS
      const reach = p.kinematics.reachM + vmaxFor(pl.attrs, pl.energy, p) * Math.max(0, t - reaction)
      const d = dist(pl.pos, flat)
      if (d <= reach) qualifiers.push({ pl, slack: reach - d })
    }
    if (qualifiers.length === 0) continue
    const aerialBall = b.pos.z > p.kinematics.controlHeightM
    const sides = new Set<Side>(qualifiers.map((q) => q.pl.side))
    if (aerialBall && sides.size === 2) {
      const best = (s: Side) => qualifiers.filter((q) => q.pl.side === s).sort((x, y) => y.slack - x.slack)[0]!.pl
      const h = best("home")
      const a = best("away")
      const homeWins = rng.chance(sigmoid(3 * (h.attrs.heading - a.attrs.heading)))
      const w = homeWins ? h : a
      const l = homeWins ? a : h
      return { ticks: k, winnerId: w.id, result: "reached", ball: b, aerial: { winnerId: w.id, loserId: l.id } }
    }
    const intended = qualifiers.find((q) => q.pl.id === intendedId)
    if (intended && sides.size === 1) return { ticks: k, winnerId: intended.pl.id, result: "reached", ball: b, aerial: null }
    const winner = qualifiers.sort((x, y) => y.slack - x.slack)[0]!.pl
    return { ticks: k, winnerId: winner.id, result: "reached", ball: b, aerial: null }
  }
  return { ticks: maxTicks, winnerId: null, result: "stopped", ball: b, aerial: null }
}

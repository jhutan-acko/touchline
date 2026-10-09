import { stepBall } from "./ball.js"
import { dirOf, inPitch, PITCH, type Side, type Vec2 } from "./geometry.js"
import { accelFor, reachIn, vmaxFor } from "./kinematics.js"
import type { Params } from "./params.js"
import { Rng } from "./rng.js"
import type { BallState, PlayerState } from "./types.js"

export interface Resolution {
  /** Ticks after release at which the flight resolves (>= 1). */
  readonly ticks: number
  readonly winnerId: string | null
  readonly result: "reached" | "out" | "goal" | "stopped"
  /** Ball state at resolution: the contact point for "reached", the crossing point for "goal"/"out". */
  readonly ball: BallState
  readonly aerial: { readonly winnerId: string; readonly loserId: string } | null
}

/** Longest flight we predict before calling the ball stopped (seconds, so it is tick-length independent). */
export const MAX_FLIGHT_S = 8

const sigmoid = (z: number): number => 1 / (1 + Math.exp(-z))

/** Where a ball moving from `a` to `b` crosses a goal line, if it does, with interpolated y and z. */
export const goalLineCrossing = (a: BallState["pos"], b: BallState["pos"]): { x: number; y: number; z: number; inGoal: boolean } | null => {
  for (const line of [PITCH.halfL, -PITCH.halfL]) {
    const crosses = line > 0 ? a.x <= line && b.x > line : a.x >= line && b.x < line
    if (!crosses) continue
    const f = (line - a.x) / (b.x - a.x)
    const y = a.y + f * (b.y - a.y)
    const z = a.z + f * (b.z - a.z)
    return { x: line, y, z, inGoal: Math.abs(y) < PITCH.goalHalfWidth && z < PITCH.goalHeight }
  }
  return null
}

const closestOnSegment = (a: Vec2, b: Vec2, q: Vec2): { t: number; d: number } => {
  const vx = b.x - a.x
  const vy = b.y - a.y
  const l2 = vx * vx + vy * vy
  const t = l2 < 1e-12 ? 1 : Math.max(0, Math.min(1, ((q.x - a.x) * vx + (q.y - a.y) * vy) / l2))
  return { t, d: Math.hypot(a.x + t * vx - q.x, a.y + t * vy - q.y) }
}

/**
 * Predict a kicked ball tick by tick with the same physics the engine uses, and find the first
 * player who can reach it, or where it leaves the pitch (a goal when it crosses between the posts).
 * Reach is acceleration-limited from each player's current velocity, checked against the whole
 * segment the ball travels in a tick (so fast balls cannot slip between samples). The intended
 * receiver anticipates (no reaction delay); everyone else reacts after reactionS.
 */
export const resolveFlight = (
  start: BallState,
  fromId: string,
  intendedId: string | null,
  players: ReadonlyArray<PlayerState>,
  p: Params,
  dt: number,
  rng: Rng
): Resolution => {
  const maxTicks = Math.round(MAX_FLIGHT_S / dt)
  let b = start
  for (let k = 1; k <= maxTicks; k++) {
    const prev = b
    b = stepBall(b, dt, p)
    const cross = goalLineCrossing(prev.pos, b.pos)
    if (cross?.inGoal) return { ticks: k, winnerId: null, result: "goal", ball: { pos: { x: cross.x, y: cross.y, z: cross.z }, vel: b.vel }, aerial: null }
    if (!inPitch({ x: b.pos.x, y: b.pos.y })) return { ticks: k, winnerId: null, result: "out", ball: b, aerial: null }
    const a2 = { x: prev.pos.x, y: prev.pos.y }
    const b2 = { x: b.pos.x, y: b.pos.y }
    const t = k * dt
    const qualifiers: Array<{ pl: PlayerState; slack: number; f: number }> = []
    for (const pl of players) {
      if (pl.sentOff) continue
      if (pl.id === fromId && t < 0.6) continue
      const { t: f, d } = closestOnSegment(a2, b2, pl.pos)
      const z = prev.pos.z + f * (b.pos.z - prev.pos.z)
      if (z > p.kinematics.headerHeightM) continue
      const contact = { x: a2.x + f * (b2.x - a2.x), y: a2.y + f * (b2.y - a2.y) }
      // Reachable disc: an acceleration-limited player who keeps drifting at their current velocity
      // can be anywhere within ~½·a·t² (capped by top speed) of pos + vel·t. arriveBy() steers to match.
      const tc = (k - 1 + f) * dt
      const reaction = pl.id === intendedId ? 0 : p.kinematics.reactionS
      const vmax = vmaxFor(pl.attrs, pl.energy, p)
      const drift = { x: pl.pos.x + pl.vel.x * tc, y: pl.pos.y + pl.vel.y * tc }
      const radius = p.kinematics.reachM + p.kinematics.reachMargin * reachIn(tc - reaction, 0, vmax, accelFor(pl.attrs, p))
      const fromDrift = Math.hypot(contact.x - drift.x, contact.y - drift.y)
      const withinSpeed = Math.hypot(contact.x - pl.pos.x, contact.y - pl.pos.y) <= p.kinematics.reachM + vmax * tc
      if (d <= p.kinematics.reachM && tc <= dt) qualifiers.push({ pl, slack: p.kinematics.reachM - d, f })
      else if (fromDrift <= radius && withinSpeed) qualifiers.push({ pl, slack: radius - fromDrift, f })
    }
    if (qualifiers.length === 0) continue
    const contactBall = (f: number): BallState => ({
      pos: { x: a2.x + f * (b2.x - a2.x), y: a2.y + f * (b2.y - a2.y), z: prev.pos.z + f * (b.pos.z - prev.pos.z) },
      vel: b.vel
    })
    const aerialBall = b.pos.z > p.kinematics.controlHeightM
    const sides = new Set<Side>(qualifiers.map((q) => q.pl.side))
    if (aerialBall && sides.size === 2) {
      const best = (s: Side) => qualifiers.filter((q) => q.pl.side === s).sort((x, y) => y.slack - x.slack)[0]!
      const h = best("home")
      const a = best("away")
      const homeWins = rng.chance(sigmoid(3 * (h.pl.attrs.heading - a.pl.attrs.heading)))
      const w = homeWins ? h : a
      const l = homeWins ? a : h
      return { ticks: k, winnerId: w.pl.id, result: "reached", ball: contactBall(w.f), aerial: { winnerId: w.pl.id, loserId: l.pl.id } }
    }
    const intended = qualifiers.find((q) => q.pl.id === intendedId)
    if (intended && sides.size === 1) return { ticks: k, winnerId: intended.pl.id, result: "reached", ball: contactBall(intended.f), aerial: null }
    const winner = qualifiers.sort((x, y) => x.f - y.f || y.slack - x.slack)[0]!
    return { ticks: k, winnerId: winner.pl.id, result: "reached", ball: contactBall(winner.f), aerial: null }
  }
  return { ticks: maxTicks, winnerId: null, result: "stopped", ball: b, aerial: null }
}

/**
 * A defending keeper does not collect a ball that would run out over their own goal line without them: with
 * probability keeper.letRunShare they let it go for a goal kick, and the resolution becomes the ball going out.
 * The "without the keeper" prediction runs on a copy of `rng`; only the let-it-go decision draws from `rng`.
 */
export const keeperLetsRun = (
  start: BallState,
  fromId: string,
  intendedId: string | null,
  players: ReadonlyArray<PlayerState>,
  res: Resolution,
  p: Params,
  dt: number,
  rng: Rng
): Resolution => {
  const keeper = players.find((x) => x.id === res.winnerId && x.role === "GK")
  const passer = players.find((x) => x.id === fromId)
  if (!keeper || !passer || keeper.side === passer.side) return res
  const without = resolveFlight(start, fromId, intendedId, players.filter((x) => x.id !== keeper.id), p, dt, new Rng(rng.state))
  const overOwnLine = without.result === "out" && Math.abs(without.ball.pos.y) <= PITCH.halfW && Math.sign(without.ball.pos.x) === -dirOf(keeper.side)
  return overOwnLine && rng.chance(p.keeper.letRunShare) ? without : res
}

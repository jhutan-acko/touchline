import { stepBall } from "./ball.js"
import { dirOf, inPitch, PITCH, type Period, type Side, type Vec2 } from "./geometry.js"
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

/** X1: how long after release the first-tick rule applies (seconds): the first tick at 10 Hz, the first 3 ticks at 25 Hz. */
export const BOOT_WINDOW_S = 0.1

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
 * X1: whether an opponent standing at `pl` is in front of the pass: within firstTick.coneDeg of the pass direction `dir`
 * (a unit vector) as seen from the ball's start. With firstTick.rule on, only such an opponent can play the ball in
 * the first BOOT_WINDOW_S of its flight (outright or by the reachable-disc test, both at a contact at least alongM along
 * the path from the start); an opponent beside or behind the passer cannot, and is left to the boot block
 * (bootBlocker in deflect.ts).
 */
export const outrightAtBoot = (start: Vec2, dir: Vec2, pl: Vec2, p: Params): boolean => {
  const vx = pl.x - start.x
  const vy = pl.y - start.y
  const r = Math.hypot(vx, vy)
  if (r < 1e-9) return false
  return (vx * dir.x + vy * dir.y) / r >= Math.cos((p.firstTick.coneDeg * Math.PI) / 180)
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
  // X1: the passer's side, the pass direction and its start, for the first-tick rule.
  const x1 = p.firstTick.rule > 0
  const passerSide = players.find((x) => x.id === fromId)?.side
  const v0 = Math.hypot(start.vel.x, start.vel.y)
  const dir0 = v0 > 1e-9 ? { x: start.vel.x / v0, y: start.vel.y / v0 } : null
  const start0 = { x: start.pos.x, y: start.pos.y }
  // X1: ground distance the ball has covered before the current tick, for the alongM clamp.
  let travelled = 0
  for (let k = 1; k <= maxTicks; k++) {
    const prev = b
    b = stepBall(b, dt, p)
    const cross = goalLineCrossing(prev.pos, b.pos)
    if (cross?.inGoal) return { ticks: k, winnerId: null, result: "goal", ball: { pos: { x: cross.x, y: cross.y, z: cross.z }, vel: b.vel }, aerial: null }
    if (!inPitch({ x: b.pos.x, y: b.pos.y })) return { ticks: k, winnerId: null, result: "out", ball: b, aerial: null }
    const a2 = { x: prev.pos.x, y: prev.pos.y }
    const b2 = { x: b.pos.x, y: b.pos.y }
    const t = k * dt
    // X1: the boot window is the first BOOT_WINDOW_S of the flight in time, so it covers the same ground at any tick rate.
    const bootTick = x1 && (k - 1) * dt < BOOT_WINDOW_S - 1e-9
    const seg = bootTick ? Math.hypot(b2.x - a2.x, b2.y - a2.y) : 0
    const qualifiers: Array<{ pl: PlayerState; slack: number; f: number }> = []
    for (const pl of players) {
      if (pl.sentOff) continue
      if (pl.id === fromId && t < 0.6) continue
      let { t: f, d } = closestOnSegment(a2, b2, pl.pos)
      // X1: in the boot window an opponent meets the ball no nearer than alongM along its path from the pass start:
      // not at the passer's feet.
      const boot = bootTick && dir0 !== null && passerSide !== undefined && pl.side !== passerSide
      if (boot) {
        const fMin = seg > 1e-9 ? Math.max(0, Math.min(1, (p.firstTick.alongM - travelled) / seg)) : 1
        if (f < fMin) {
          f = fMin
          d = Math.hypot(a2.x + f * (b2.x - a2.x) - pl.pos.x, a2.y + f * (b2.y - a2.y) - pl.pos.y)
        }
      }
      const z = prev.pos.z + f * (b.pos.z - prev.pos.z)
      if (z > p.kinematics.headerHeightM) continue
      const contact = { x: a2.x + f * (b2.x - a2.x), y: a2.y + f * (b2.y - a2.y) }
      // Reachable disc: an acceleration-limited player who keeps drifting at their current velocity
      // can be anywhere within ~½·a·t² (capped by top speed) of pos + vel·t. arriveBy() steers to match.
      const tc = (k - 1 + f) * dt
      const reaction = pl.id === intendedId ? 0 : p.kinematics.reactionS
      const vmax = vmaxFor(pl, pl.energy, p)
      const drift = { x: pl.pos.x + pl.vel.x * tc, y: pl.pos.y + pl.vel.y * tc }
      const radius = p.kinematics.reachM + p.kinematics.reachMargin * reachIn(tc - reaction, 0, vmax, accelFor(pl.attrs, p))
      const fromDrift = Math.hypot(contact.x - drift.x, contact.y - drift.y)
      const withinSpeed = Math.hypot(contact.x - pl.pos.x, contact.y - pl.pos.y) <= p.kinematics.reachM + vmax * tc
      // X1: in the boot window an opponent outside the cone cannot play the ball at all, outright or by the disc test.
      const front = !boot || outrightAtBoot(start0, dir0!, pl.pos, p)
      const outright = d <= p.kinematics.reachM && tc <= dt && front
      if (outright) qualifiers.push({ pl, slack: p.kinematics.reachM - d, f })
      else if (front && fromDrift <= radius && withinSpeed) qualifiers.push({ pl, slack: radius - fromDrift, f })
    }
    travelled += seg
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
  period: Period,
  p: Params,
  dt: number,
  rng: Rng
): Resolution => {
  const keeper = players.find((x) => x.id === res.winnerId && x.role === "GK")
  const passer = players.find((x) => x.id === fromId)
  if (!keeper || !passer || keeper.side === passer.side) return res
  const without = resolveFlight(start, fromId, intendedId, players.filter((x) => x.id !== keeper.id), p, dt, new Rng(rng.state))
  const overOwnLine = without.result === "out" && Math.abs(without.ball.pos.y) <= PITCH.halfW && Math.sign(without.ball.pos.x) === -dirOf(keeper.side, period)
  return overOwnLine && rng.chance(p.keeper.letRunShare) ? without : res
}

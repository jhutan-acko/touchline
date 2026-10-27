/**
 * On-ball events for the Watch stream (live stat tags, follow my player): a run's domain events turned into BallEvents,
 * with the stats engine's pass difficulty (xPass) and shot xG, and the ball's speed at release from tracking. Each is
 * held until play reaches the frame it is complete on (a pass on its arrival, a shot on its resolution), so its outcome
 * never shows early.
 */
import type { BallEvent } from "@touchline/rpc"
import type { DomainEvent } from "@touchline/schema"
import { emittedAt } from "@touchline/stats"

const TYPES: Partial<Record<DomainEvent["type"], BallEvent["type"]>> = {
  pass: "pass", shot: "shot", carry: "carry", tackle: "tackle", interception: "interception", clearance: "clearance", keeper_save: "save"
}

const outcomeOf = (e: DomainEvent): BallEvent["outcome"] => {
  switch (e.type) {
    case "pass":
      return e.outcome === "successful" ? "success" : "fail"
    case "shot":
      return e.outcome === "goal" ? "goal" : e.outcome === "saved" ? "saved" : e.outcome === "blocked" ? "blocked" : "off_target"
    case "tackle":
      return e.outcome === "won" ? "success" : "fail"
    case "interception":
      return "success"
    case "clearance":
      return e.outcome === "successful" ? "success" : null
    default:
      return null
  }
}

const r = (v: number, d: number) => Math.round(v * 10 ** d) / 10 ** d
const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null)

/** A ball position at a tick. */
export interface BallAt {
  readonly tick: number
  readonly x: number
  readonly y: number
  readonly z: number
}

/** Faster than this between two frames is a jump (a restart), not a kick. */
const MAX_BALL_KMH = 200

/**
 * The ball's peak speed (km/h) over consecutive frames in (from, to], from tracking; null with no consecutive pair.
 * `dt`: seconds per tick.
 */
export const releaseSpeed = (balls: ReadonlyMap<number, BallAt>, from: number, to: number, dt: number): number | null => {
  let best: number | null = null
  for (let t = from + 1; t <= to; t++) {
    const a = balls.get(t - 1)
    const b = balls.get(t)
    if (!a || !b) continue
    const kmh = (Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z) / dt) * 3.6
    if (kmh <= MAX_BALL_KMH && (best === null || kmh > best)) best = kmh
  }
  return best
}

/**
 * A domain event as a BallEvent, or null for a type the stream does not carry (or one without a player or place).
 * `derived`: the stats engine's values for it (pass.dist, pass.xp, shot.xg, shot.speed); `speed`: the ball's speed at
 * release from tracking, used when the engine has none.
 */
export const toBallEvent = (
  e: DomainEvent,
  o: { readonly homeId: string; readonly clock: string; readonly derived: Readonly<Record<string, number>> | undefined; readonly speed: number | null }
): BallEvent | null => {
  const type = TYPES[e.type]
  if (!type || e.player_id === null || e.team_id === null || e.x === null || e.y === null) return null
  const d = o.derived ?? {}
  const pass = type === "pass"
  const shot = type === "shot"
  const length = d["pass.dist"] ?? (e.x_end !== null && e.y_end !== null && (pass || type === "carry") ? Math.hypot(e.x_end - e.x, e.y_end - e.y) : null)
  const speed = shot ? (d["shot.speed"] ?? o.speed) : pass ? o.speed : null
  const receiver = pass ? (typeof e.attrs.receiver_id === "string" ? e.attrs.receiver_id : typeof e.attrs.intended_receiver_id === "string" ? e.attrs.intended_receiver_id : null) : null
  return {
    id: e.id,
    frame: emittedAt(e),
    clock: o.clock,
    type,
    team: e.team_id === o.homeId ? "home" : "away",
    player_id: e.player_id,
    receiver_id: receiver,
    outcome: outcomeOf(e),
    x: e.x,
    y: e.y,
    x_end: e.x_end,
    y_end: e.y_end,
    length_m: length === null ? null : r(length, 1),
    xpass: pass ? (num(d["pass.xp"]) === null ? null : r(d["pass.xp"]!, 3)) : null,
    speed_kmh: speed === null ? null : r(speed, 1),
    xg: shot ? (num(d["shot.xg"]) === null ? null : r(d["shot.xg"]!, 3)) : null
  }
}

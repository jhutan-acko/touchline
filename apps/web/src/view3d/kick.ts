/**
 * Our own kick (Touchline, CC0; no CC0 kick exists for the player rig): bone rotations keyed over KICK_S seconds and
 * laid over the running animation, found wherever the ball suddenly speeds up beside a player. Pure.
 */
import type { PitchFrame } from "@touchline/rpc"
import { yawOf } from "./motion.js"

/** Seconds a kick takes, and the share of it at which the foot strikes the ball. */
export const KICK_S = 0.7
export const KICK_STRIKE = 0.45
/** The rig's bones turn the other way about their local x. */
export const KICK_SIGN = -1

export type KickPart = "thigh" | "shin" | "foot" | "support" | "spine"

/** Degrees about each bone's local x at points of the kick (0 to 1): wind up, strike at KICK_STRIKE, follow through. */
export const KICK_KEYS: Readonly<Record<KickPart, ReadonlyArray<readonly [number, number]>>> = {
  thigh: [[0, 0], [0.3, -35], [0.45, 40], [0.65, 75], [1, 0]],
  shin: [[0, 0], [0.3, 95], [0.45, 15], [0.65, 10], [1, 0]],
  foot: [[0, 0], [0.3, 25], [0.45, -20], [0.65, -10], [1, 0]],
  support: [[0, 0], [0.4, 18], [0.6, 22], [1, 0]],
  spine: [[0, 0], [0.4, -6], [0.6, -10], [1, 0]]
}

/** The angle (radians) of keys at t, eased between keys; 0 outside the kick. */
export const keyAt = (keys: ReadonlyArray<readonly [number, number]>, t: number): number => {
  if (t < 0 || t > 1) return 0
  for (let i = 1; i < keys.length; i++) {
    if (t <= keys[i]![0]) {
      const [t0, a] = keys[i - 1]!
      const [t1, b] = keys[i]!
      const u = (t - t0) / (t1 - t0)
      const e = u * u * (3 - 2 * u)
      return ((a + (b - a) * e) * Math.PI) / 180
    }
  }
  return 0
}

/** Each bone's rotation (radians about its local x, signed for the rig) at t of a kick. */
export const kickPose = (t: number): Record<KickPart, number> =>
  Object.fromEntries((Object.keys(KICK_KEYS) as KickPart[]).map((k) => [k, KICK_SIGN * keyAt(KICK_KEYS[k], t)])) as Record<KickPart, number>

export interface Kick {
  readonly player_id: string
  /** The match frame the kick starts on (fractional), so the strike lands on the ball's change of speed. */
  readonly start: number
  /** The yaw the kicker squares up to: the ball's way after the kick. */
  readonly yaw: number
}

/** A kick: the ball's speed jumps by more than this (m/s) ... */
export const KICK_JUMP = 4
/** ... to more than this, ... */
export const KICK_SPEED = 6
/** ... with a player within this distance (m). */
export const KICK_REACH = 2

/** Every kick in a run of frames (frames may skip: speeds use the frame numbers), one per touch. */
export const findKicks = (frames: ReadonlyArray<PitchFrame>, fps: number): Kick[] => {
  const speed = (i: number) => {
    const a = frames[i]!
    const b = frames[i + 1]!
    return Math.hypot(b.ball.x - a.ball.x, b.ball.y - a.ball.y) / ((b.frame - a.frame) / fps)
  }
  const out: Kick[] = []
  for (let i = 1; i < frames.length - 1; i++) {
    const s = speed(i)
    if (!(s - speed(i - 1) > KICK_JUMP && s > KICK_SPEED)) continue
    const f = frames[i]!
    const near = [...f.home, ...f.away].reduce((m, p) => (Math.hypot(p.x - f.ball.x, p.y - f.ball.y) < Math.hypot(m.x - f.ball.x, m.y - f.ball.y) ? p : m))
    if (Math.hypot(near.x - f.ball.x, near.y - f.ball.y) >= KICK_REACH) continue
    // One kick per touch: the ball can still be speeding up a frame later (frames skip at high speeds).
    const prev = out.at(-1)
    if (prev && prev.player_id === near.id && f.frame - prev.start < KICK_S * fps) continue
    const next = frames[i + 1]!
    out.push({ player_id: near.id, start: f.frame - KICK_STRIKE * KICK_S * fps, yaw: yawOf(next.ball.x - f.ball.x, next.ball.y - f.ball.y) })
  }
  return out
}

/** The kick a player is in at a frame, and how far through it (0 to 1). */
export const kickAt = (kicks: ReadonlyArray<Kick>, playerId: string, frame: number, fps: number): { readonly kick: Kick; readonly t: number } | null => {
  for (const k of kicks) {
    const t = (frame - k.start) / (KICK_S * fps)
    if (k.player_id === playerId && t >= 0 && t < 1) return { kick: k, t }
  }
  return null
}

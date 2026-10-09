/**
 * The four cameras of the 3D view (Plan 7), pure: each frame a camera's pose from the followed player, the ball and
 * its own previous pose (so it moves smoothly). World coordinates, metres (motion.ts toWorld).
 */
import { toWorld, type PlayerSample, type Vec3 } from "./motion.js"

export type CameraKind = "follow" | "fp" | "broadcast" | "tactical"
export const CAMERAS: ReadonlyArray<CameraKind> = ["follow", "fp", "broadcast", "tactical"]

/** A camera's state between frames: where it is, what it looks at, and the way it faces (horizontal, unit). */
export interface Rig {
  readonly kind: CameraKind
  readonly pos: Vec3
  readonly look: Vec3
  readonly dir: Vec3
}

export type Shot =
  | { readonly kind: "perspective"; readonly pos: Vec3; readonly look: Vec3; readonly fov: number }
  /** Top-down: half the width and height seen, in metres. */
  | { readonly kind: "ortho"; readonly pos: Vec3; readonly look: Vec3; readonly halfW: number; readonly halfH: number }

export const FOLLOW_FOV = 55
export const FP_FOV = 75
export const BROADCAST_FOV = 26
/** First-person eye height (m). */
export const EYE_M = 1.72
/** The fastest the first-person view turns (rad/s), so it never whips round. */
export const FP_MAX_TURN = Math.PI / 2

const add = (a: Vec3, b: Vec3, k = 1): Vec3 => [a[0] + b[0] * k, a[1] + b[1] * k, a[2] + b[2] * k]
const lerp3 = (a: Vec3, b: Vec3, u: number): Vec3 => [a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u, a[2] + (b[2] - a[2]) * u]
const flat = (v: Vec3): Vec3 => {
  const n = Math.hypot(v[0], v[2])
  return n > 1e-6 ? [v[0] / n, 0, v[2] / n] : [0, 0, 0]
}
const withY = (v: Vec3, y: number): Vec3 => [v[0], y, v[2]]
const angle = (v: Vec3) => Math.atan2(v[0], v[2])
const fromAngle = (a: number): Vec3 => [Math.sin(a), 0, Math.cos(a)]

/** Turn a direction toward another, eased at `rate` per second and never faster than `maxTurn` rad/s. */
export const steer = (dir: Vec3, want: Vec3, dt: number, rate: number, maxTurn = Infinity): Vec3 => {
  const d = Math.atan2(Math.sin(angle(want) - angle(dir)), Math.cos(angle(want) - angle(dir)))
  const step = Math.sign(d) * Math.min(Math.abs(d) * Math.min(1, dt * rate), maxTurn * dt)
  return fromAngle(angle(dir) + step)
}

export interface Scene {
  /** The followed player (null for cameras that follow nobody, or when they have left the pitch). */
  readonly player: PlayerSample | null
  readonly ball: { readonly x: number; readonly y: number; readonly z: number }
}

/**
 * The camera's shot this frame and its new state. `aspect` is the viewport's width over height; `time` (s) only moves
 * the first-person head-bob. Follow and first-person need a player.
 */
export const poseCamera = (kind: CameraKind, prev: Rig | null, s: Scene, dt: number, aspect: number, time = 0): { readonly shot: Shot; readonly rig: Rig } => {
  const ball = toWorld(s.ball.x, s.ball.y, s.ball.z)
  const rig0 = prev && prev.kind === kind ? prev : null
  if (kind === "tactical") {
    const halfW = Math.max(38 * aspect, 56)
    const pos: Vec3 = [0, 120, 0]
    return { shot: { kind: "ortho", pos, look: [0, 0, 0], halfW, halfH: halfW / aspect }, rig: { kind, pos, look: [0, 0, 0], dir: [0, 0, -1] } }
  }
  const k = Math.min(1, dt * 3)
  if (kind === "broadcast") {
    const pos: Vec3 = [ball[0] * 0.55, 24, 58]
    const look: Vec3 = [ball[0], 0, Math.min(10, ball[2] * 0.6)]
    const rig = rig0 ? { kind, pos: lerp3(rig0.pos, pos, k), look: lerp3(rig0.look, look, k), dir: rig0.dir } : { kind, pos, look, dir: [0, 0, -1] as Vec3 }
    return { shot: { kind: "perspective", pos: rig.pos, look: rig.look, fov: BROADCAST_FOV }, rig }
  }
  const p = s.player
  if (!p) throw new Error(`the ${kind} camera needs a player`)
  const at = toWorld(p.x, p.y)
  const toBall = flat([ball[0] - at[0], 0, ball[2] - at[2]])
  const dBall = Math.hypot(ball[0] - at[0], ball[2] - at[2])
  const travel = flat(toWorld(p.vx, p.vy))
  // Players watch the ball: face half the way they run and half toward the ball (all the ball when standing).
  const want = Math.hypot(p.vx, p.vy) > 1 ? flat(add(travel, toBall)) : toBall
  const start = rig0?.dir ?? (Math.hypot(want[0], want[2]) > 0 ? want : ([1, 0, 0] as Vec3))
  const dir = Math.hypot(want[0], want[2]) > 0 ? (kind === "fp" ? steer(start, want, dt, 2.5, FP_MAX_TURN) : steer(start, want, dt, 1.5)) : start
  if (kind === "fp") {
    const speed = Math.hypot(p.vx, p.vy)
    const bob = Math.sin(time * speed * 2.2) * Math.min(0.04, speed * 0.008)
    const pos = withY(add(at, dir, 0.25), EYE_M + bob)
    const look = withY(add(pos, dir, 10), 1.2)
    return { shot: { kind: "perspective", pos, look, fov: FP_FOV }, rig: { kind, pos, look, dir } }
  }
  // Follow: behind and above, pulling back (and up) as the ball gets further away so both stay in frame.
  const back = 7 + Math.min(10, dBall * 0.25)
  const pos = withY(add(at, dir, -back), 3.2 + Math.min(5, dBall * 0.12))
  const ahead = add(at, dir, 5)
  const look = withY(lerp3(ahead, ball, Math.min(0.5, dBall / 60)), 1)
  const rig = rig0 ? { kind, pos: lerp3(rig0.pos, pos, k), look: lerp3(rig0.look, look, k), dir } : { kind, pos, look, dir }
  return { shot: { kind: "perspective", pos: rig.pos, look: rig.look, fov: FOLLOW_FOV }, rig }
}

/**
 * Motion for the 3D view (Plan 7), pure: pitch metres to the 3D world, frames interpolated in time, and each player's
 * speed, facing and gait. No three.js here, so it is tested without a GPU.
 */
import type { PitchFrame } from "@touchline/rpc"

export type Vec3 = readonly [number, number, number]

/** Pitch metres (x along, y across, z up) to the world (x along, y up, z = -y): metres throughout. */
export const toWorld = (x: number, y: number, z = 0): Vec3 => [x, z, -y]

export interface PlayerSample {
  readonly x: number
  readonly y: number
  /** Velocity in m/s on the pitch, from the move between the two frames around the sample. */
  readonly vx: number
  readonly vy: number
}

export interface Sample {
  /** Match time in frames (fractional between two frames). */
  readonly frame: number
  readonly ball: { readonly x: number; readonly y: number; readonly z: number }
  readonly players: ReadonlyMap<string, PlayerSample>
}

const lerp = (a: number, b: number, u: number) => a + (b - a) * u

/** Positions part-way (u from 0 to 1) from frame a to frame b; velocities from the move between them. */
export const between = (a: PitchFrame, b: PitchFrame, u: number, fps: number): Sample => {
  const secs = (b.frame - a.frame) / fps
  const next = new Map([...b.home, ...b.away].map((p) => [p.id, p]))
  const players = new Map<string, PlayerSample>()
  for (const p of [...a.home, ...a.away]) {
    const q = next.get(p.id) ?? p // a player who left the pitch stays where they were
    players.set(p.id, { x: lerp(p.x, q.x, u), y: lerp(p.y, q.y, u), vx: secs > 0 ? (q.x - p.x) / secs : 0, vy: secs > 0 ? (q.y - p.y) / secs : 0 })
  }
  return { frame: lerp(a.frame, b.frame, u), ball: { x: lerp(a.ball.x, b.ball.x, u), y: lerp(a.ball.y, b.ball.y, u), z: lerp(a.ball.z, b.ball.z, u) }, players }
}

/** A clip at a fractional index into its frames (held at either end). */
export const sampleClip = (frames: ReadonlyArray<PitchFrame>, f: number, fps: number): Sample | null => {
  if (frames.length === 0) return null
  if (frames.length === 1) return between(frames[0]!, frames[0]!, 0, fps)
  const i = Math.max(0, Math.min(frames.length - 2, Math.floor(f)))
  return between(frames[i]!, frames[i + 1]!, Math.max(0, Math.min(1, f - i)), fps)
}

/** The render delay behind the newest frame: at least this, ... */
export const MIN_DELAY_MS = 80
/** ... or this many gaps between arriving frames when they come further apart, up to MAX_DELAY_MS. */
export const DELAY_GAPS = 1.5
export const MAX_DELAY_MS = 400

/**
 * Frames as a session sends them, played a little behind the newest so motion is smooth between them (they arrive
 * every 40 ms or more, with network jitter). A frame earlier than the newest (a seek back) starts afresh.
 */
export class LiveBuffer {
  private readonly arrivals: Array<{ frame: PitchFrame; at: number }> = []

  constructor(
    readonly fps: number,
    readonly keep = 64
  ) {}

  push(frame: PitchFrame, at: number): void {
    const last = this.arrivals.at(-1)
    if (last && frame.frame === last.frame.frame) return
    if (last && frame.frame < last.frame.frame) this.arrivals.length = 0
    this.arrivals.push({ frame, at })
    if (this.arrivals.length > this.keep) this.arrivals.shift()
  }

  /** Drop every frame held (the next one pushed starts afresh). */
  clear(): void {
    this.arrivals.length = 0
  }

  /** The frames held, oldest first (kicks are found in them). */
  get frames(): ReadonlyArray<PitchFrame> {
    return this.arrivals.map((a) => a.frame)
  }

  get delay(): number {
    const gaps = this.arrivals.slice(-9).flatMap((a, i, xs) => (i > 0 ? [a.at - xs[i - 1]!.at] : [])).sort((a, b) => a - b)
    const median = gaps.length ? gaps[Math.floor(gaps.length / 2)]! : 0
    return Math.min(MAX_DELAY_MS, Math.max(MIN_DELAY_MS, median * DELAY_GAPS))
  }

  /** The match as it should look at wall-clock time `now` (ms): between the two frames around now minus the delay. */
  sample(now: number): Sample | null {
    const xs = this.arrivals
    if (xs.length === 0) return null
    const t = now - this.delay
    if (t <= xs[0]!.at) return between(xs[0]!.frame, xs[0]!.frame, 0, this.fps)
    for (let i = 1; i < xs.length; i++) {
      const a = xs[i - 1]!
      const b = xs[i]!
      if (t <= b.at) return between(a.frame, b.frame, (t - a.at) / (b.at - a.at), this.fps)
    }
    // Behind on frames (paused, or the stream stalled): hold the newest, standing.
    const last = xs.at(-1)!.frame
    return between(last, last, 0, this.fps)
  }
}

/** Below this speed (m/s) a player faces the ball instead of the way they move. */
export const FACE_BALL_BELOW = 0.6

/** The yaw that faces along a pitch direction (0 faces the world's +z, which is pitch -y). */
export const yawOf = (dx: number, dy: number): number => Math.atan2(dx, -dy)

/** The yaw a player wants: where they run, or toward the ball when (nearly) standing still. */
export const wantedYaw = (p: PlayerSample, ball: { readonly x: number; readonly y: number }): number | null => {
  const moving = Math.hypot(p.vx, p.vy) > FACE_BALL_BELOW
  const dx = moving ? p.vx : ball.x - p.x
  const dy = moving ? p.vy : ball.y - p.y
  return dx * dx + dy * dy > 1e-4 ? yawOf(dx, dy) : null
}

/** Turn from `yaw` toward `want` by the shortest way, at `rate` per second (eased, never past it). */
export const turnToward = (yaw: number, want: number, dt: number, rate: number): number => {
  const d = Math.atan2(Math.sin(want - yaw), Math.cos(want - yaw))
  return yaw + d * Math.min(1, dt * rate)
}

/** The animation clips, from the speed (m/s) each takes over and the speed it is animated at. */
export const GAITS = [
  { clip: "Idle_Loop", from: 0, natural: 1 },
  { clip: "Walk_Loop", from: 0.5, natural: 1.4 },
  { clip: "Jog_Fwd_Loop", from: 2.2, natural: 3.6 },
  { clip: "Sprint_Loop", from: 5, natural: 7 }
] as const
export type Gait = (typeof GAITS)[number]["clip"]

/** The clip for a speed. */
export const gaitOf = (speed: number): Gait => [...GAITS].reverse().find((g) => speed >= g.from)!.clip

/** How fast a clip plays for a speed, so feet do not slide (idle at its own pace; capped to look natural). */
export const gaitRate = (clip: Gait, speed: number): number => {
  if (clip === "Idle_Loop") return 1
  const g = GAITS.find((x) => x.clip === clip)!
  return Math.min(1.5, Math.max(0.6, speed / g.natural))
}

/** Clip weights eased toward the target clip (all weights sum to one). */
export const blendGaits = (w: Readonly<Record<Gait, number>>, target: Gait, dt: number): Record<Gait, number> => {
  const k = Math.min(1, dt * 6)
  const out = Object.fromEntries(GAITS.map((g) => [g.clip, w[g.clip] + ((g.clip === target ? 1 : 0) - w[g.clip]) * k])) as Record<Gait, number>
  const sum = GAITS.reduce((a, g) => a + out[g.clip], 0)
  for (const g of GAITS) out[g.clip] /= sum
  return out
}

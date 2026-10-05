import { add, norm, scale, type Vec2, type Vec3 } from "./geometry.js"
import type { Params } from "./params.js"
import type { Rng } from "./rng.js"
import type { BallState } from "./types.js"

export type FirstTouch = "controlled" | "heavy" | "miscontrol" | "missed"

export interface TouchInput {
  /** Ball speed at contact (m/s). */
  readonly speed: number
  /** Ball height at contact (m). */
  readonly height: number
  /** 0..1 from the nearest opponent's distance (see pressureFrom). */
  readonly pressure: number
  /** 0..1 receiving skill (dribbling and composure). */
  readonly skill: number
}

const sigmoid = (z: number): number => 1 / (1 + Math.exp(-z))

/** Probability that a reception is not controlled: rises with ball speed, height and pressure, falls with skill. */
export const firstTouchError = (t: TouchInput, p: Params): number => {
  const c = p.firstTouch
  const high = Math.max(0, Math.min(1, (t.height - 0.5) / 1.5))
  return sigmoid(c.b0 + (c.bSpeed * (t.speed - 12)) / 10 + c.bHigh * high + c.bPressure * t.pressure + c.bSkill * (t.skill - 0.6))
}

/** Draw the first touch: an error with probability `pError`, split into heavy, miscontrol and missed. */
export const drawFirstTouch = (pError: number, rng: Rng, p: Params): FirstTouch => {
  if (!rng.chance(pError)) return "controlled"
  const u = rng.uniform()
  return u < p.firstTouch.missedShare ? "missed" : u < p.firstTouch.missedShare + p.firstTouch.miscontrolShare ? "miscontrol" : "heavy"
}

/**
 * The loose ball after a bad touch at `at`: a heavy touch runs on 4-7 m/s in the ball's direction, a miscontrol
 * bounces off at an angle, a missed ball carries on at 60 % of its speed.
 */
export const ballAfterTouch = (kind: Exclude<FirstTouch, "controlled">, at: Vec2, vel: Vec3, rng: Rng): BallState => {
  const dir = norm({ x: vel.x, y: vel.y })
  if (kind === "missed") return { pos: { ...add(at, scale(dir, 0.6)), z: 0.2 }, vel: { x: vel.x * 0.6, y: vel.y * 0.6, z: Math.max(0, vel.z * 0.6) } }
  const turn = kind === "heavy" ? rng.range(-0.3, 0.3) : rng.range(-1.8, 1.8)
  const c = Math.cos(turn), s = Math.sin(turn)
  const d = { x: dir.x * c - dir.y * s, y: dir.x * s + dir.y * c }
  const speed = kind === "heavy" ? rng.range(4, 7) : rng.range(3, 8)
  return { pos: { ...add(at, scale(d, 0.6)), z: 0 }, vel: { x: d.x * speed, y: d.y * speed, z: kind === "heavy" ? 0 : rng.range(0, 1) } }
}

import { add, len, norm, scale, sub, type Vec2 } from "./geometry.js"
import type { Params } from "./params.js"
import type { PlayerAttrs } from "./types.js"

export const vmaxFor = (a: PlayerAttrs, energy: number, p: Params): number =>
  p.kinematics.vmaxBase * (0.86 + 0.14 * a.pace) * (0.9 + 0.1 * energy)

export const accelFor = (a: PlayerAttrs, p: Params): number => p.kinematics.accelMax * (0.8 + 0.2 * a.acceleration)

/** Reynolds "arrive": head for target, slow inside slowRadius, respect speed and acceleration caps. */
export const arrive = (
  pos: Vec2,
  vel: Vec2,
  target: Vec2,
  vmax: number,
  amax: number,
  dt: number,
  slowRadius = 4
): { pos: Vec2; vel: Vec2 } => {
  const to = sub(target, pos)
  const d = len(to)
  const desiredSpeed = d < 0.05 ? 0 : Math.min(vmax, (vmax * d) / slowRadius)
  const desired = scale(norm(to), desiredSpeed)
  let dv = sub(desired, vel)
  const maxDv = amax * dt
  if (len(dv) > maxDv) dv = scale(norm(dv), maxDv)
  let nv = add(vel, dv)
  if (len(nv) > vmax) nv = scale(norm(nv), vmax)
  return { pos: add(pos, scale(nv, dt)), vel: nv }
}

/** Repulsion from teammates closer than radius, so players don't stack. */
export const separation = (pos: Vec2, others: ReadonlyArray<Vec2>, radius = 1.5): Vec2 => {
  let push: Vec2 = { x: 0, y: 0 }
  for (const o of others) {
    const away = sub(pos, o)
    const d = len(away)
    if (d > 1e-6 && d < radius) push = add(push, scale(norm(away), (radius - d) / radius))
  }
  return push
}

/**
 * Constant-bearing intercept: the point where a chaser at `speed` meets a target moving at
 * constant velocity. Falls back to the target's current position when no solution exists.
 */
export const interceptPoint = (chaser: Vec2, speed: number, target: Vec2, targetVel: Vec2): Vec2 => {
  const r = sub(target, chaser)
  const a = targetVel.x * targetVel.x + targetVel.y * targetVel.y - speed * speed
  const b = 2 * (r.x * targetVel.x + r.y * targetVel.y)
  const c = r.x * r.x + r.y * r.y
  let t: number
  if (Math.abs(a) < 1e-9) t = b !== 0 ? -c / b : -1
  else {
    const disc = b * b - 4 * a * c
    if (disc < 0) return target
    const s = Math.sqrt(disc)
    const t1 = (-b - s) / (2 * a)
    const t2 = (-b + s) / (2 * a)
    t = Math.min(...[t1, t2].filter((x) => x > 0), Infinity)
  }
  if (!Number.isFinite(t) || t <= 0) return target
  return add(target, scale(targetVel, t))
}

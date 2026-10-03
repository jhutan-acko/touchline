import type { Vec2, Vec3 } from "./geometry.js"
import type { Params } from "./params.js"
import type { BallState } from "./types.js"

type BallParams = Params["ball"]

/** Advance the ball by dt seconds: gravity, quadratic drag, bounce and rolling friction. */
export const stepBall = (ball: BallState, dt: number, p: BallParams): BallState => {
  let { x, y, z } = ball.pos
  let { x: vx, y: vy, z: vz } = ball.vel
  const h = dt / p.substeps
  for (let i = 0; i < p.substeps; i++) {
    const airborne = z > 1e-6 || vz > 1e-6
    if (airborne) {
      const speed = Math.hypot(vx, vy, vz)
      const k = p.drag * speed * h
      vx -= k * vx
      vy -= k * vy
      vz -= k * vz + p.gravity * h
      x += vx * h
      y += vy * h
      z += vz * h
      if (z <= 0) {
        z = 0
        vz = -vz * p.bounce
        vx *= 0.85
        vy *= 0.85
        if (vz < 0.6) vz = 0
      }
    } else {
      z = 0
      vz = 0
      const speed = Math.hypot(vx, vy)
      if (speed > 0) {
        const next = Math.max(0, speed - (p.rollDecel + p.drag * speed * speed) * h)
        const f = next / speed
        vx *= f
        vy *= f
        x += vx * h
        y += vy * h
      }
    }
  }
  return { pos: { x, y, z }, vel: { x: vx, y: vy, z: vz } }
}

/** Ground pass speed that arrives at `arriveSpeed` after `distance` metres of rolling (drag ignored). */
export const groundLaunchSpeed = (distance: number, arriveSpeed: number, p: BallParams): number =>
  Math.sqrt(arriveSpeed * arriveSpeed + 2 * (p.rollDecel + 1.2) * Math.max(0, distance))

/** Horizontal distance at which a ball launched at `speed` and `deg` first touches the ground. */
export const carryDistance = (speed: number, deg: number, p: BallParams): number => {
  const th = (deg * Math.PI) / 180
  let b: BallState = { pos: { x: 0, y: 0, z: 0 }, vel: { x: speed * Math.cos(th), y: 0, z: speed * Math.sin(th) } }
  for (let k = 0; k < 400; k++) {
    const next = stepBall(b, 0.02, { ...p, substeps: 1 })
    if (next.pos.z <= 0 && k > 0) return next.pos.x
    b = next
  }
  return b.pos.x
}

/** Launch velocity for a ball from `from` towards `to`. Lofted balls are solved so they first land on `to`. */
export const launchVelocity = (
  from: Vec2,
  to: Vec2,
  height: "ground" | "low" | "high",
  p: Params
): Vec3 => {
  const dx = to.x - from.x
  const dy = to.y - from.y
  const d = Math.max(0.5, Math.hypot(dx, dy))
  const ux = dx / d
  const uy = dy / d
  if (height === "ground") {
    const s = groundLaunchSpeed(d, p.pass.arriveSpeed, p.ball)
    return { x: ux * s, y: uy * s, z: 0 }
  }
  const deg = height === "high" ? p.pass.highLaunchDeg : 12
  let lo = 2
  let hi = 45
  for (let i = 0; i < 14; i++) {
    const mid = (lo + hi) / 2
    if (carryDistance(mid, deg, p.ball) < d) lo = mid
    else hi = mid
  }
  const s = (lo + hi) / 2
  const th = (deg * Math.PI) / 180
  return { x: ux * s * Math.cos(th), y: uy * s * Math.cos(th), z: s * Math.sin(th) }
}

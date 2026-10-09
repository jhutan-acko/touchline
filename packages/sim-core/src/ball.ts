import type { Vec2, Vec3 } from "./geometry.js"
import type { Params } from "./params.js"
import type { BallState } from "./types.js"

/**
 * Ball physics, fitted on real tracking (data/params/physics.json; spec docs/superpowers/specs/2026-10-09-physics-fit-design.md).
 * A line-for-line port of python/analytics/touchline_analytics/physics/ballmodel.py; test/ball-parity.test.ts runs both.
 *
 * - In the air: gravity and quadratic drag, explicit Euler per substep.
 * - Bounce (Brody / Cross, hollow ball): the normal speed becomes e * vn (0 below REST_VZ). The contact point slips at
 *   vt - R w; friction either stops the slip during the impact (the ball leaves rolling at 0.6 vt + 0.4 R w) or acts
 *   throughout (it loses mu (1 + e) vn of horizontal speed and gains 1.5 mu (1 + e) vn / R of spin).
 * - On the ground: rolling resistance c0 + c1 v plus drag. While the ball skids (v != R w, as after a kick or a sliding
 *   bounce) friction adds mu_s g and spins it up at 1.5 mu_s g / R until it rolls. Kicks leave the foot without spin.
 *
 * Only +, -, *, / and square roots in the step: replays must be bit-identical in every JavaScript engine.
 */

export const BALL_RADIUS = 0.11
const REST_VZ = 0.4
const SLIP_EPS = 1e-9
const SIMPSON_N = 16
const SKID_N = 64

type Physics = Params["physics"]["ball"]

/** Horizontal speed, vertical speed and spin after landing with horizontal speed vt and downward speed vn. */
export const bounce = (vt: number, vn: number, w: number, b: Physics): { vt: number; vz: number; w: number } => {
  let vz = b.restitution * vn
  if (vz < REST_VZ) vz = 0
  const slip = vt - BALL_RADIUS * w
  const impulse = b.bounceFriction * (1 + b.restitution) * vn
  if (2.5 * impulse >= Math.abs(slip)) {
    const vt2 = 0.6 * vt + 0.4 * BALL_RADIUS * w
    return { vt: vt2, vz, w: vt2 / BALL_RADIUS }
  }
  const sign = slip > 0 ? 1 : -1
  return { vt: vt - sign * impulse, vz, w: w + (sign * 1.5 * impulse) / BALL_RADIUS }
}

/** Advance the ball by dt seconds in p.ball.substeps substeps. */
export const stepBall = (ball: BallState, dt: number, p: Params): BallState => {
  const b = p.physics.ball
  const g = p.ball.gravity
  let { x, y, z } = ball.pos
  let { x: vx, y: vy, z: vz } = ball.vel
  let w = ball.spin ?? 0
  const h = dt / p.ball.substeps
  for (let i = 0; i < p.ball.substeps; i++) {
    if (z > 1e-6 || vz > 1e-6) {
      const speed = Math.sqrt(vx * vx + vy * vy + vz * vz)
      const kk = b.drag * speed * h
      vx -= kk * vx
      vy -= kk * vy
      vz -= kk * vz + g * h
      x += vx * h
      y += vy * h
      z += vz * h
      if (z <= 0) {
        z = 0
        const vt = Math.sqrt(vx * vx + vy * vy)
        const out = bounce(vt, -vz, w, b)
        vz = out.vz
        w = out.w
        if (vt > 0) {
          const f = out.vt / vt
          vx *= f
          vy *= f
        }
      }
      continue
    }
    z = 0
    vz = 0
    const speed = Math.sqrt(vx * vx + vy * vy)
    if (speed > 0) {
      let dec = b.rollC0 + b.rollC1 * speed + b.drag * speed * speed
      const slip = speed - BALL_RADIUS * w
      const spin = ((1.5 * b.skidFriction * g) / BALL_RADIUS) * h
      if (slip > SLIP_EPS) {
        dec += b.skidFriction * g
        w += spin
      } else if (slip < -SLIP_EPS) {
        dec -= b.skidFriction * g
        w -= spin
      }
      const next = Math.max(0, speed - dec * h)
      if (Math.abs(slip) <= SLIP_EPS || slip > 0 !== next - BALL_RADIUS * w > 0) w = next / BALL_RADIUS
      const f = next / speed
      vx *= f
      vy *= f
      x += vx * h
      y += vy * h
    }
  }
  return { pos: { x, y, z }, vel: { x: vx, y: vy, z: vz }, spin: w }
}

const rollDecel = (v: number, b: Physics): number => b.rollC0 + b.rollC1 * v + b.drag * v * v

/** Distance a rolling (not skidding) ball covers while slowing from v0 to vEnd (Simpson's rule). */
export const rollDistance = (v0: number, vEnd: number, b: Physics): number => {
  if (v0 <= vEnd) return 0
  const hh = (v0 - vEnd) / SIMPSON_N
  let total = 0
  for (let i = 0; i <= SIMPSON_N; i++) {
    const v = vEnd + i * hh
    const wgt = i === 0 || i === SIMPSON_N ? 1 : i % 2 ? 4 : 2
    total += (wgt * v) / rollDecel(v, b)
  }
  return (total * hh) / 3
}

/** Distance a ground pass struck at v0 without spin covers before slowing to vEnd: skid, then roll. */
export const groundDistance = (v0: number, vEnd: number, b: Physics, g: number): number => {
  if (v0 <= vEnd) return 0
  const fric = b.skidFriction * g
  const dv = v0 / SKID_N
  let t = 0
  let d = 0
  let v = v0
  let a = fric + rollDecel(v, b)
  for (let i = 0; i < SKID_N; i++) {
    const v2 = v - dv
    const a2 = fric + rollDecel(v2, b)
    const dt = 0.5 * dv * (1 / a + 1 / a2)
    const g1 = v - 1.5 * fric * t
    const g2 = v2 - 1.5 * fric * (t + dt)
    const stop = vEnd > v2 ? vEnd : v2
    if (g2 <= 0 || stop > v2) {
      const fSlip = g2 <= 0 ? g1 / (g1 - g2) : 1
      const fStop = (v - stop) / dv
      const f = Math.min(fSlip, fStop)
      const vf = v - f * dv
      d += 0.5 * f * dv * (v / a + vf / (fric + rollDecel(vf, b)))
      return fStop <= fSlip ? d : d + rollDistance(vf, vEnd, b)
    }
    d += 0.5 * dv * (v / a + v2 / a2)
    t += dt
    v = v2
    a = a2
  }
  return d
}

/** Speed of a ground pass (struck without spin) that arrives at `arriveSpeed` after `distance` metres (fixed secant steps). */
export const groundLaunchSpeed = (distance: number, arriveSpeed: number, p: Params): number => {
  const b = p.physics.ball
  const g = p.ball.gravity
  if (distance <= 0) return arriveSpeed
  let lo = Math.sqrt(arriveSpeed * arriveSpeed + 2 * rollDecel(arriveSpeed, b) * distance)
  let hi = Math.sqrt(arriveSpeed * arriveSpeed + 2 * (b.skidFriction * g + rollDecel(arriveSpeed, b)) * distance) + 0.5
  let fLo = groundDistance(lo, arriveSpeed, b, g) - distance
  let fHi = groundDistance(hi, arriveSpeed, b, g) - distance
  for (let i = 0; i < 8; i++) {
    if (fHi === fLo) break
    const mid = hi - (fHi * (hi - lo)) / (fHi - fLo)
    lo = hi
    fLo = fHi
    hi = mid
    fHi = groundDistance(mid, arriveSpeed, b, g) - distance
  }
  return hi
}

/** Horizontal distance at which a ball launched at `speed` and `deg` first touches the ground. */
export const carryDistance = (speed: number, deg: number, p: Params): number => {
  const th = (deg * Math.PI) / 180
  const one = { ...p, ball: { ...p.ball, substeps: 1 } }
  let b: BallState = { pos: { x: 0, y: 0, z: 0 }, vel: { x: speed * Math.cos(th), y: 0, z: speed * Math.sin(th) } }
  for (let k = 0; k < 400; k++) {
    const next = stepBall(b, 0.02, one)
    if (next.pos.z <= 0 && k > 0) return next.pos.x
    b = next
  }
  return b.pos.x
}

/** Launch velocity for a ball from `from` towards `to`. Lofted balls are solved so they first land on `to`. */
export const launchVelocity = (from: Vec2, to: Vec2, height: "ground" | "low" | "high", p: Params): Vec3 => {
  const dx = to.x - from.x
  const dy = to.y - from.y
  const d = Math.max(0.5, Math.hypot(dx, dy))
  const ux = dx / d
  const uy = dy / d
  if (height === "ground") {
    const s = groundLaunchSpeed(d, p.pass.arriveSpeed, p)
    return { x: ux * s, y: uy * s, z: 0 }
  }
  const deg = height === "high" ? p.pass.highLaunchDeg : 12
  let lo = 2
  let hi = 45
  for (let i = 0; i < 14; i++) {
    const mid = (lo + hi) / 2
    if (carryDistance(mid, deg, p) < d) lo = mid
    else hi = mid
  }
  const s = (lo + hi) / 2
  const th = (deg * Math.PI) / 180
  return { x: ux * s * Math.cos(th), y: uy * s * Math.cos(th), z: s * Math.sin(th) }
}

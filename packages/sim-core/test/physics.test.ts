import { describe, expect, it } from "vitest"
import { BALL_RADIUS, bounce, carryDistance, groundDistance, groundLaunchSpeed, launchVelocity, rollDistance, stepBall } from "../src/ball.js"
import { interceptPoint } from "../src/kinematics.js"
import { DEFAULT_PARAMS, type Params } from "../src/params.js"
import type { BallState } from "../src/types.js"

const P: Params = DEFAULT_PARAMS

const roll = (b: BallState, s: number, p: Params = P): BallState => { let x = b; for (let i = 0; i < s / 0.1; i++) x = stepBall(x, 0.1, p); return x }
const withBall = (o: Partial<Params["physics"]["ball"]>): Params => ({ ...P, physics: { ...P.physics, ball: { ...P.physics.ball, ...o } } })

describe("ball", () => {
  it("a ground pass skids, then rolls, and stops", () => {
    const first = stepBall({ pos: { x: 0, y: 0, z: 0 }, vel: { x: 12, y: 0, z: 0 } }, 0.1, { ...P, ball: { ...P.ball, substeps: 1 } })
    const b = P.physics.ball
    expect((12 - first.vel.x) / 0.1).toBeCloseTo(b.skidFriction * 9.81 + b.rollC0 + b.rollC1 * 12 + b.drag * 144, 6)
    const end = roll({ pos: { x: 0, y: 0, z: 0 }, vel: { x: 12, y: 0, z: 0 } }, 20)
    expect(Math.hypot(end.vel.x, end.vel.y)).toBe(0)
    expect(end.pos.x).toBeCloseTo(groundDistance(12, 0, b, 9.81), -0.5) // within ~1.5 m; the engine steps with explicit Euler
  })
  it("a ball leaving the FIFA ramp rolling at 3.2 m/s stops within the Pro band (4-8 m)", () => {
    const end = roll({ pos: { x: 0, y: 0, z: 0 }, vel: { x: 3.2, y: 0, z: 0 }, spin: 3.2 / BALL_RADIUS }, 10)
    expect(end.pos.x).toBeGreaterThan(4)
    expect(end.pos.x).toBeLessThan(8)
    expect(rollDistance(3.2, 0, P.physics.ball)).toBeCloseTo(end.pos.x, 0)
  })
  it("the FIFA angle test (50 km/h at 15 degrees, no spin) on dry turf (friction 1.0) keeps about 60 %, the top of the 45-60 % band", () => {
    // A gripping hollow ball keeps 0.6 of its horizontal speed: the rigid-body model sits at the band's upper edge.
    const v = 50 / 3.6
    const th = (15 * Math.PI) / 180
    const out = bounce(v * Math.cos(th), v * Math.sin(th), 0, withBall({ bounceFriction: 1.0 }).physics.ball)
    const kept = Math.hypot(out.vt, out.vz) / v
    expect(kept).toBeGreaterThan(0.45)
    expect(kept).toBeLessThan(0.61)
  })
  it("a gripping bounce leaves rolling at 0.6 vt + 0.4 R w; a sliding one loses mu (1 + e) vn", () => {
    const grip = bounce(8, 6, 0, P.physics.ball)
    expect(grip.vt).toBeCloseTo(4.8, 12)
    expect(grip.w).toBeCloseTo(4.8 / BALL_RADIUS, 9)
    const slide = bounce(12, 4, 0, withBall({ restitution: 0.6, bounceFriction: 0.25 }).physics.ball)
    expect(slide.vt).toBeCloseTo(12 - 0.25 * 1.6 * 4, 12)
    expect(slide.vz).toBeCloseTo(2.4, 12)
  })
  it("ground passes arrive at the speed they were struck for", () => {
    for (const [d, arrive] of [[10, 6], [25, 4], [3, 9]] as const) {
      const v0 = groundLaunchSpeed(d, arrive, P)
      expect(groundDistance(v0, arrive, P.physics.ball, 9.81)).toBeCloseTo(d, 6)
    }
  })
  it("ground passes arrive at the speed they were struck for across the fit's guard ranges", () => {
    // A refit that passes the guards must still give passes that arrive (the secant alone can leave its bracket).
    for (const skidFriction of [0.1, 0.5, 0.9, 1.2])
      for (const rollC0 of [0, 0.2, 0.8, 1.5])
        for (const rollC1 of [0, 0.05, 0.3]) {
          const p = withBall({ skidFriction, rollC0, rollC1 })
          for (const d of [0.5, 3, 25, 80])
            for (const arrive of [0.5, 2, 8, 15]) {
              const v0 = groundLaunchSpeed(d, arrive, p)
              expect(Math.abs(groundDistance(v0, arrive, p.physics.ball, 9.81) / d - 1), `${skidFriction} ${rollC0} ${rollC1} ${d} ${arrive}`).toBeLessThan(1e-6)
            }
        }
  })
  it("a lofted ball first lands at its target (within 1 m)", () => {
    for (const d of [25, 40, 55]) {
      const v = launchVelocity({ x: 0, y: 0 }, { x: d, y: 0 }, "high", P)
      const s = Math.hypot(v.x, v.z)
      expect(Math.abs(carryDistance(s, P.pass.highLaunchDeg, P) - d)).toBeLessThan(1)
    }
  })
  it("bounces lose height by the square of the restitution", () => {
    let b: BallState = { pos: { x: 0, y: 0, z: 5 }, vel: { x: 0, y: 0, z: 0 } }
    let peak = 0, landed = false
    for (let i = 0; i < 60; i++) {
      b = stepBall(b, 0.1, P)
      if (b.vel.z > 0) landed = true // moving up again: it has bounced
      if (landed) peak = Math.max(peak, b.pos.z)
      if (landed && b.vel.z < 0) break // only the first rebound
    }
    expect(peak).toBeLessThan(5 * P.physics.ball.restitution ** 2 * 1.05)
    expect(peak).toBeGreaterThan(5 * P.physics.ball.restitution ** 2 * 0.8)
  })
})

describe("kinematics", () => {
  it("constant-bearing intercept leads a moving target", () => {
    const p = interceptPoint({ x: 0, y: -10 }, 8, { x: 0, y: 0 }, { x: 5, y: 0 })
    expect(p.x).toBeGreaterThan(0)
    const t = Math.hypot(p.x, p.y + 10) / 8
    expect(p.x).toBeCloseTo(5 * t, 5)
  })
})

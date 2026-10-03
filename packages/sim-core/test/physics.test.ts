import { describe, expect, it } from "vitest"
import { carryDistance, launchVelocity, stepBall } from "../src/ball.js"
import { arrive, interceptPoint } from "../src/kinematics.js"
import { DEFAULT_PARAMS as P } from "../src/params.js"
import type { BallState } from "../src/types.js"

const roll = (b: BallState, s: number): BallState => { let x = b; for (let i = 0; i < s / 0.1; i++) x = stepBall(x, 0.1, P.ball); return x }

describe("ball", () => {
  it("a ground pass slows and stops", () => {
    const end = roll({ pos: { x: 0, y: 0, z: 0 }, vel: { x: 12, y: 0, z: 0 } }, 20)
    expect(Math.hypot(end.vel.x, end.vel.y)).toBe(0)
    expect(end.pos.x).toBeGreaterThan(20)
    expect(end.pos.x).toBeLessThan(45)
  })
  it("a lofted ball first lands at its target (within 1 m)", () => {
    for (const d of [25, 40, 55]) {
      const v = launchVelocity({ x: 0, y: 0 }, { x: d, y: 0 }, "high", P)
      const s = Math.hypot(v.x, v.z)
      expect(Math.abs(carryDistance(s, P.pass.highLaunchDeg, P.ball) - d)).toBeLessThan(1)
    }
  })
  it("bounces lose height", () => {
    let b: BallState = { pos: { x: 0, y: 0, z: 5 }, vel: { x: 0, y: 0, z: 0 } }
    let peak = 0, landed = false
    for (let i = 0; i < 60; i++) { b = stepBall(b, 0.1, P.ball); if (b.pos.z === 0) landed = true; if (landed) peak = Math.max(peak, b.pos.z) }
    expect(peak).toBeLessThan(5 * P.ball.bounce)
  })
})

describe("kinematics", () => {
  it("arrive respects speed and acceleration caps and does not overshoot", () => {
    let s = { pos: { x: 0, y: 0 }, vel: { x: 0, y: 0 } }
    let maxV = 0
    for (let i = 0; i < 100; i++) {
      const prev = s.vel
      s = arrive(s.pos, s.vel, { x: 20, y: 0 }, 8, 4, 0.1)
      maxV = Math.max(maxV, Math.hypot(s.vel.x, s.vel.y))
      expect(Math.hypot(s.vel.x - prev.x, s.vel.y - prev.y)).toBeLessThanOrEqual(0.4 + 1e-9)
    }
    expect(maxV).toBeLessThanOrEqual(8)
    expect(Math.abs(s.pos.x - 20)).toBeLessThan(0.5)
  })
  it("constant-bearing intercept leads a moving target", () => {
    const p = interceptPoint({ x: 0, y: -10 }, 8, { x: 0, y: 0 }, { x: 5, y: 0 })
    expect(p.x).toBeGreaterThan(0)
    const t = Math.hypot(p.x, p.y + 10) / 8
    expect(p.x).toBeCloseTo(5 * t, 5)
  })
})

import { execFileSync, spawnSync } from "node:child_process"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "vitest"
import { stepBall } from "../src/ball.js"
import { DEFAULT_PARAMS, type Params } from "../src/params.js"
import type { BallState } from "../src/types.js"

/** The fitted physics switched on (its defaults are the literature values). */
const P: Params = { ...DEFAULT_PARAMS, physics: { ...DEFAULT_PARAMS.physics, enabled: true } }

const root = join(dirname(fileURLToPath(import.meta.url)), "../../..")
const hasUv = spawnSync("uv", ["--version"]).status === 0

type Case = { state: number[]; duration: number; physics: Record<string, number> }
const CASES: Case[] = [
  { state: [0, 0, 0, 15, 2, 9, 0], duration: 6, physics: {} }, // a lofted pass: flight, bounces, skid, roll
  { state: [0, 0, 0, 12, 0, 0, 0], duration: 8, physics: { mu_s: 0.37, c0: 0.48, c1: 0.13 } }, // a ground pass, struck without spin
  { state: [0, 0, 0, 3.2, 0, 0, 3.2 / 0.11], duration: 6, physics: {} }, // rolling off the FIFA ramp
  { state: [0, 0, 0.3, 14, 0, -2, 0], duration: 3, physics: { e: 0.6, mu: 0.25 } }, // a low, fast landing that slides
  { state: [0, 0, 2, 6, 0, 0, -40], duration: 3, physics: { e: 0.74, mu: 0.23, k: 0.015 } }, // backspin into a bounce
  { state: [5, -3, 0, 22, -4, 14, 0], duration: 6, physics: { k: 0.02, e: 0.7, mu: 0.3, mu_s: 0.35, c0: 0.6, c1: 0.2 } }
]
const NAMES: Record<string, keyof Params["physics"]["ball"]> = { k: "drag", e: "restitution", mu: "bounceFriction", mu_s: "skidFriction", c0: "rollC0", c1: "rollC1" }

describe("ball parity with the Python reference", () => {
  // In CI the test must run: a missing uv fails it rather than skipping it.
  it.skipIf(!hasUv && !process.env.CI)("stepBall and touchline_analytics.physics.ballmodel give the same trajectories", () => {
    const py = JSON.parse(
      execFileSync("uv", ["run", "--locked", "--project", join(root, "python/analytics"), "python", "-m", "touchline_analytics.physics.ballmodel"], { input: JSON.stringify(CASES), encoding: "utf8" })
    ) as number[][][]
    CASES.forEach((c, i) => {
      const ball = { ...P.physics.ball }
      for (const [k, v] of Object.entries(c.physics)) (ball as Record<string, number>)[NAMES[k]!] = v
      const p: Params = { ...P, physics: { ...P.physics, ball } }
      const [x, y, z, vx, vy, vz, w] = c.state as [number, number, number, number, number, number, number]
      let b: BallState = { pos: { x, y, z }, vel: { x: vx, y: vy, z: vz }, spin: w }
      for (let k = 1; k * 0.1 <= c.duration + 1e-9; k++) {
        b = stepBall(b, 0.1, p)
        const row = py[i]![k * 4]! // the reference records every 0.025 s substep
        const got = [b.pos.x, b.pos.y, b.pos.z, b.vel.x, b.vel.y, b.vel.z, b.spin ?? 0]
        got.forEach((v, j) => expect(v, `case ${i}, t ${row[0]}, column ${j}`).toBeCloseTo(row[j + 1]!, 9))
      }
    })
  })
})

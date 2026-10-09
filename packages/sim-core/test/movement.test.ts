import { readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "vitest"
import type { Vec2 } from "../src/geometry.js"
import { approach, approachBy, GROUP_OF, motionFor, steer, throughKnots, vmaxFor, type Motion } from "../src/kinematics.js"
import { DEFAULT_PARAMS, type Params } from "../src/params.js"
import type { PlayerAttrs, Role } from "../src/types.js"

const P: Params = { ...DEFAULT_PARAMS, physics: { ...DEFAULT_PARAMS.physics, enabled: true } }
const root = join(dirname(fileURLToPath(import.meta.url)), "../../..")
const attrs = (pace: number, acceleration: number): PlayerAttrs =>
  ({ pace, acceleration, shortPassing: 0.5, longPassing: 0.5, vision: 0.5, crossing: 0.5, dribbling: 0.5, finishing: 0.5, heading: 0.5, tackling: 0.5, composure: 0.5, stamina: 0.5, handling: 0.5, reflexes: 0.5 })
const median = (role: Role = "CM") => ({ attrs: attrs(P.physics.players.paceKnots[2]!, P.physics.players.accelerationKnots[2]!), role })
const M: Motion = { a0: 8.5, s0: 9.3, brake: 7, lateral: 6 }
const speed = (v: Vec2) => Math.hypot(v.x, v.y)

describe("player movement", () => {
  it("a standing start covers 5 m in 1.2-1.4 s", () => {
    let s = { pos: { x: 0, y: 0 }, vel: { x: 0, y: 0 } }
    let t = 0
    while (s.pos.x < 5) {
      s = approach(s.pos, s.vel, { x: 60, y: 0 }, 9.3, M, 0.1)
      t += 0.1
    }
    expect(t).toBeGreaterThanOrEqual(1.2)
    expect(t).toBeLessThanOrEqual(1.4)
  })

  it("a player at 8 m/s stops in 0.9-1.2 s", () => {
    let vel = { x: 8, y: 0 }
    let t = 0
    while (speed(vel) > 0.05) {
      vel = steer(vel, { x: 0, y: 0 }, M, 0.1)
      t += 0.1
    }
    expect(t).toBeGreaterThanOrEqual(0.9)
    expect(t).toBeLessThanOrEqual(1.2 + 1e-9)
  })

  it("never accelerates, brakes or turns harder than the caps allow", () => {
    const cases: Array<[Vec2, Vec2]> = [[{ x: 0, y: 0 }, { x: 9, y: 0 }], [{ x: 6, y: 0 }, { x: 0, y: 9 }], [{ x: 8, y: 0 }, { x: -8, y: 0 }], [{ x: 3, y: 1 }, { x: 4, y: -4 }]]
    for (const [vel, desired] of cases) {
      const next = steer(vel, desired, M, 0.1)
      const dv = { x: next.x - vel.x, y: next.y - vel.y }
      const sp = speed(vel)
      const fwd = M.a0 * (1 - sp / M.s0)
      expect(speed(dv)).toBeLessThanOrEqual(Math.max(M.a0, M.brake) * 0.1 + 1e-9)
      if (sp > 0) {
        const along = (dv.x * vel.x + dv.y * vel.y) / sp
        const across = Math.abs(dv.y * vel.x - dv.x * vel.y) / sp
        expect(along).toBeLessThanOrEqual(fwd * 0.1 + 1e-9)
        expect(along).toBeGreaterThanOrEqual(-M.brake * 0.1 - 1e-9)
        expect(across).toBeLessThanOrEqual(Math.max(M.lateral, fwd) * 0.1 + 1e-9)
      }
    }
  })

  it("approach stops at the target without overshooting", () => {
    let s = { pos: { x: 0, y: 0 }, vel: { x: 0, y: 0 } }
    let maxX = 0
    for (let i = 0; i < 80; i++) {
      s = approach(s.pos, s.vel, { x: 20, y: 0 }, 9, M, 0.1)
      maxX = Math.max(maxX, s.pos.x)
    }
    expect(maxX).toBeLessThan(20.3)
    expect(Math.abs(s.pos.x - 20)).toBeLessThan(0.3)
    expect(speed(s.vel)).toBeLessThan(0.5)
  })

  it("approachBy meets a ball on time when it can", () => {
    let s = { pos: { x: 0, y: 0 }, vel: { x: 0, y: 0 } }
    for (let k = 20; k > 0; k--) s = approachBy(s.pos, s.vel, { x: 10, y: 0 }, 9, M, 0.1, k * 0.1)
    expect(Math.abs(s.pos.x - 10)).toBeLessThan(0.5)
  })

  it("maps attributes onto the fitted percentiles of the player's position group", () => {
    const pl = P.physics.players
    const mid = motionFor(median("CM"), P)
    expect(mid.a0).toBeCloseTo(pl.a0.MID[2]!, 12)
    expect(mid.s0).toBeCloseTo(pl.s0.MID[2]!, 12)
    expect(motionFor({ attrs: attrs(0, 0), role: "ST" }, P).s0).toBe(pl.s0.FWD[0])
    expect(motionFor({ attrs: attrs(1, 1), role: "GK" }, P).a0).toBe(pl.a0.GK[4])
    expect(GROUP_OF.FB).toBe("DEF")
    expect(throughKnots(0.5, [0, 1], [10, 20])).toBe(15)
  })

  it("the attribute knots are the league's 10/25/50/75/90th percentiles", () => {
    const league = JSON.parse(readFileSync(join(root, "data/league/league.json"), "utf8")) as { clubs: Array<{ squad: Array<{ attrs: PlayerAttrs }> }> }
    const all = league.clubs.flatMap((c) => c.squad.map((x) => x.attrs))
    for (const [k, knots] of [["pace", P.physics.players.paceKnots], ["acceleration", P.physics.players.accelerationKnots]] as const) {
      const v = all.map((a) => a[k]).sort((a, b) => a - b)
      ;[0.1, 0.25, 0.5, 0.75, 0.9].forEach((q, i) => expect(Math.abs(v[Math.floor(v.length * q)]! - knots[i]!), k).toBeLessThan(0.01))
    }
  })

  it("top speed drops only to 97 % when a player is exhausted", () => {
    const pl = median("CM")
    expect(vmaxFor(pl, 0, P) / vmaxFor(pl, 1, P)).toBeCloseTo(0.97, 12)
    expect(vmaxFor(pl, 1, P)).toBeCloseTo(motionFor(pl, P).s0, 12)
  })

  it("with the fitted physics off, top speed is the old formula", () => {
    const pl = median("CM")
    const k = DEFAULT_PARAMS.kinematics
    expect(vmaxFor(pl, 0.5, DEFAULT_PARAMS)).toBeCloseTo(k.vmaxBase * (0.86 + 0.14 * pl.attrs.pace) * 0.95, 12)
  })
})

import { describe, expect, it } from "vitest"
import { launchVelocity } from "../src/ball.js"
import { xgOf } from "../src/decide.js"
import { DEFAULT_PARAMS as P } from "../src/params.js"
import { resolveFlight } from "../src/resolve.js"
import { Rng, seedRng } from "../src/rng.js"
import { planShot } from "../src/shot.js"
import type { PlayerState } from "../src/types.js"
import { kickoffPlayersFor, makeConfig } from "../src/testing.js"

const base = kickoffPlayersFor(makeConfig(1))
const at = (p: PlayerState, x: number, y: number): PlayerState => ({ ...p, pos: { x, y }, vel: { x: 0, y: 0 } })

describe("resolveFlight", () => {
  it("an unopposed pass reaches its intended receiver", () => {
    const passer = at(base[2]!, 0, 0), receiver = at(base[5]!, 15, 0)
    const ball = { pos: { x: 0, y: 0, z: 0 }, vel: launchVelocity(passer.pos, receiver.pos, "ground", P) }
    const r = resolveFlight(ball, passer.id, receiver.id, [passer, receiver], P, 0.1, new Rng(seedRng(1)))
    expect(r.result).toBe("reached")
    expect(r.winnerId).toBe(receiver.id)
  })
  it("a defender standing in the lane intercepts", () => {
    const passer = at(base[2]!, 0, 0), receiver = at(base[5]!, 20, 0), def = at(base[13]!, 8, 0.3)
    const ball = { pos: { x: 0, y: 0, z: 0 }, vel: launchVelocity(passer.pos, receiver.pos, "ground", P) }
    expect(resolveFlight(ball, passer.id, receiver.id, [passer, receiver, def], P, 0.1, new Rng(seedRng(1))).winnerId).toBe(def.id)
  })
  it("a ball hit out of the pitch with nobody near goes out", () => {
    const passer = at(base[2]!, 0, 30)
    const ball = { pos: { x: 0, y: 30, z: 0 }, vel: { x: 0, y: 15, z: 0 } }
    expect(resolveFlight(ball, passer.id, null, [passer], P, 0.1, new Rng(seedRng(1))).result).toBe("out")
  })
})

describe("planShot", () => {
  it("goals per shot track xG on average (keeper only, no blockers)", () => {
    const shooter = at(base[9]!, 36, 4)
    const keeper = at(base.find((p) => p.side === "away" && p.role === "GK")!, 51, 0)
    const xg = xgOf(P, "home", shooter.pos, false, 0)
    const r = new Rng(seedRng(3))
    let goals = 0
    const n = 6000
    for (let i = 0; i < n; i++) if (planShot(shooter, "home", [keeper], xg, 0, false, P, 0.1, r).outcome === "goal") goals++
    expect(goals / n).toBeGreaterThan(xg * 0.75)
    expect(goals / n).toBeLessThan(xg * 1.25)
  })
  it("penalties score about three times in four", () => {
    const shooter = at(base[9]!, 41.5, 0)
    const keeper = at(base.find((p) => p.side === "away" && p.role === "GK")!, 52, 0)
    const r = new Rng(seedRng(4))
    let goals = 0
    for (let i = 0; i < 4000; i++) if (planShot(shooter, "home", [keeper], 0.76, 0, true, P, 0.1, r).outcome === "goal") goals++
    expect(goals / 4000).toBeGreaterThan(0.65)
    expect(goals / 4000).toBeLessThan(0.85)
  })
})

import { describe, expect, it } from "vitest"
import { launchVelocity, stepBall } from "../src/ball.js"
import { xgOf } from "../src/decide.js"
import { DEFAULT_PARAMS as P } from "../src/params.js"
import * as KIN from "../src/kinematics.js"
import { goalLineCrossing, resolveFlight } from "../src/resolve.js"
import { Rng, seedRng } from "../src/rng.js"
import { parryBall, planShot } from "../src/shot.js"
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

describe("resolveFlight — review fixes", () => {
  const { arriveBy, accelFor, vmaxFor } = KIN
  it("a fast pass is intercepted by a defender standing between two tick samples", () => {
    const passer = at(base[2]!, 0, 0), receiver = at(base[5]!, 30, 0), def = at(base[13]!, 5, 0.9)
    const ball = { pos: { x: 0, y: 0, z: 0 }, vel: { x: 20, y: 0, z: 0 } }
    expect(resolveFlight(ball, passer.id, receiver.id, [passer, receiver, def], P, 0.1, new Rng(seedRng(1))).winnerId).toBe(def.id)
  })
  it("a ball that crosses the goal line between the posts is a goal, not out", () => {
    const passer = at(base[13]!, 45, 0)
    const ball = { pos: { x: 45, y: 0, z: 0 }, vel: { x: 18, y: 0, z: 0 } }
    expect(resolveFlight(ball, passer.id, null, [passer], P, 0.1, new Rng(seedRng(1))).result).toBe("goal")
  })
  it("limits flights by seconds, not ticks", () => {
    const passer = at(base[2]!, 0, 0)
    const ball = { pos: { x: 0, y: 0, z: 0 }, vel: { x: 0, y: 0, z: 0 } }
    const ten = resolveFlight(ball, passer.id, null, [], P, 0.1, new Rng(seedRng(1)))
    const tf = resolveFlight(ball, passer.id, null, [], P, 0.04, new Rng(seedRng(1)))
    expect(ten.ticks * 0.1).toBeCloseTo(tf.ticks * 0.04, 5)
  })
  it("every resolved winner can actually get to the ball under the movement model (within 1.5 m)", () => {
    const r = new Rng(seedRng(21))
    let checked = 0
    for (let i = 0; i < 300; i++) {
      const players = base.map((p) => at(p, p.pos.x + r.range(-15, 15), p.pos.y + r.range(-10, 10)))
        .map((p) => ({ ...p, vel: { x: r.range(-4, 4), y: r.range(-4, 4) } }))
      const passer = players[r.weighted(players.map(() => 1))]!
      const mates = players.filter((p) => p.side === passer.side && p.id !== passer.id)
      const target = mates[Math.floor(r.uniform() * mates.length)]!
      const height = r.chance(0.3) ? "high" : "ground"
      const ball = { pos: { x: passer.pos.x, y: passer.pos.y, z: 0 }, vel: launchVelocity(passer.pos, target.pos, height, P) }
      const res = resolveFlight(ball, passer.id, target.id, players, P, 0.1, r)
      if (res.result !== "reached" || !res.winnerId) continue
      let w = players.find((p) => p.id === res.winnerId)!
      let s = { pos: w.pos, vel: w.vel }
      for (let k = 0; k < res.ticks; k++) s = arriveBy(s.pos, s.vel, { x: res.ball.pos.x, y: res.ball.pos.y }, vmaxFor(w.attrs, w.energy, P), accelFor(w.attrs, P), 0.1, (res.ticks - k) * 0.1)
      expect(Math.hypot(s.pos.x - res.ball.pos.x, s.pos.y - res.ball.pos.y)).toBeLessThanOrEqual(1.5)
      checked++
    }
    expect(checked).toBeGreaterThan(150)
  })
})

describe("goal line and parries — review fixes", () => {
  it("detects a goal from where the ball crossed the line, not where it ended the tick", () => {
    const c = goalLineCrossing({ x: 51, y: 2, z: 0.5 }, { x: 55, y: 6, z: 0.5 })
    expect(c?.inGoal).toBe(true)
    expect(c!.y).toBeCloseTo(3.5, 5)
  })
  it("a safe parry never ends up in the keeper's own net", () => {
    const r = new Rng(seedRng(9))
    for (let i = 0; i < 2000; i++) {
      const saveAt = { x: 51.7, y: r.range(-3.5, 3.5), z: r.range(0, 2.4) }
      let b = parryBall("home", saveAt, "parried_safe", r)
      for (let k = 0; k < 60; k++) {
        const prev = b
        b = stepBall(b, 0.1, P.ball)
        const c = goalLineCrossing(prev.pos, b.pos)
        if (c) { expect(c.inGoal).toBe(false); break }
      }
    }
  })
})

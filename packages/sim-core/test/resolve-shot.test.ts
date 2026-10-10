import { describe, expect, it } from "vitest"
import { launchVelocity, stepBall } from "../src/ball.js"
import { xgOf } from "../src/decide.js"
import { DEFAULT_PARAMS as P } from "../src/params.js"
import * as KIN from "../src/kinematics.js"
import { goalLineCrossing, resolveFlight } from "../src/resolve.js"
import { Rng, seedRng } from "../src/rng.js"
import { parryBall, planShot, saveChance } from "../src/shot.js"
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
  it("who reaches a pass keeps the tuned reaction, not the fitted one (spec Revision)", () => {
    // A defender 3 m off a 25 m ground pass, 18 m along it: with the fitted 0.2 s he would cut it out.
    const passer = at(base[2]!, 0, 0), receiver = at(base[5]!, 25, 0), def = at(base[13]!, 18, 3)
    const run = (p: typeof P) => {
      const ball = { pos: { x: 0, y: 0, z: 0 }, vel: launchVelocity(passer.pos, receiver.pos, "ground", p) }
      return resolveFlight(ball, passer.id, receiver.id, [passer, receiver, def], p, 0.1, new Rng(seedRng(1))).winnerId
    }
    expect(run(P)).toBe(receiver.id)
    expect(run({ ...P, physics: { ...P.physics, players: { ...P.physics.players, reactionS: 0 } } })).toBe(receiver.id)
  })
  it("a ball hit out of the pitch with nobody near goes out", () => {
    const passer = at(base[2]!, 0, 30)
    const ball = { pos: { x: 0, y: 30, z: 0 }, vel: { x: 0, y: 15, z: 0 } }
    expect(resolveFlight(ball, passer.id, null, [passer], P, 0.1, new Rng(seedRng(1))).result).toBe("out")
  })
})

describe("planShot", () => {
  it("keepers save corners and well-struck shots less often, close-range shots less often, and good keepers more", () => {
    const keeper = at(base.find((p) => p.side === "away" && p.role === "GK")!, 51, 0)
    const shot = { y: 0, z: 1.2, distance: 16 }
    expect(saveChance({ ...shot, y: 3.4 }, keeper, P)).toBeLessThan(saveChance(shot, keeper, P))
    expect(saveChance({ ...shot, z: 0.1 }, keeper, P)).toBeLessThan(saveChance(shot, keeper, P))
    expect(saveChance({ ...shot, distance: 6 }, keeper, P)).toBeLessThan(saveChance(shot, keeper, P))
    const great = { ...keeper, attrs: { ...keeper.attrs, reflexes: 0.95 } }, poor = { ...keeper, attrs: { ...keeper.attrs, reflexes: 0.3 } }
    expect(saveChance(shot, great, P)).toBeGreaterThan(saveChance(shot, poor, P))
  })
  it("keepers save roughly two in three shots on target from the edge of the box", () => {
    const shooter = at(base[9]!, 36, 4)
    const keeper = at(base.find((p) => p.side === "away" && p.role === "GK")!, 51, 0)
    const xg = xgOf(P, "home", shooter.pos, false, 0)
    const r = new Rng(seedRng(3))
    let on = 0, goals = 0
    for (let i = 0; i < 6000; i++) {
      const s = planShot(shooter, "home", [keeper], xg, 0, false, P, 0.1, r)
      if (s.onTarget) on++
      if (s.outcome === "goal") goals++
    }
    expect(1 - goals / on).toBeGreaterThan(0.55)
    expect(1 - goals / on).toBeLessThan(0.8)
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
  const { approachBy, motionFor, vmaxFor } = KIN
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
      for (let k = 0; k < res.ticks; k++) s = approachBy(s.pos, s.vel, { x: res.ball.pos.x, y: res.ball.pos.y }, vmaxFor(w, w.energy, P), motionFor(w, P), 0.1, (res.ticks - k) * 0.1)
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
        b = stepBall(b, 0.1, P)
        const c = goalLineCrossing(prev.pos, b.pos)
        if (c) { expect(c.inGoal).toBe(false); break }
      }
    }
  })
})

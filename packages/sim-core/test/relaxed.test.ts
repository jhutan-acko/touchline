import { describe, expect, it } from "vitest"
import { loadAfter, relaxedSpeed, tiringFactor } from "../src/kinematics.js"
import { DEFAULT_PARAMS as P, type Params } from "../src/params.js"
import { initMatch, isFinished, step } from "../src/step.js"
import { makeConfig } from "../src/testing.js"

describe("relaxed shape motion and tiring (pure)", () => {
  it("relaxedSpeed arrives in arriveS, capped at cap x vmax", () => {
    expect(relaxedSpeed(10, 8, 0.6, 2)).toBeCloseTo(4.8, 9)
    expect(relaxedSpeed(4, 8, 0.6, 2)).toBeCloseTo(2, 9)
    expect(relaxedSpeed(0, 8, 0.6, 2)).toBe(0)
  })

  it("tiringFactor is 0.8 + 0.2 energy, damped after a hard spell down to the floor", () => {
    const f = { ...P.fatigue, loadFreeM: 45, loadDamp: 0.5, loadFloor: 0.5 }
    expect(tiringFactor(1, 0, f)).toBeCloseTo(1, 9)
    expect(tiringFactor(0.4, 0, f)).toBeCloseTo(0.88, 9)
    expect(tiringFactor(1, 45, f)).toBeCloseTo(1, 9)
    expect(tiringFactor(1, 67.5, f)).toBeCloseTo(0.75, 9)
    expect(tiringFactor(1, 1000, f)).toBeCloseTo(0.5, 9)
  })

  it("loadAfter counts only high-speed metres and forgets them over loadWindowS", () => {
    const f = P.fatigue
    expect(loadAfter(0, 4, 0.1, f)).toBe(0)
    expect(loadAfter(0, 7, 0.1, f)).toBeCloseTo(0.7, 9)
    let l = 100
    for (let i = 0; i < Math.round(f.loadWindowS / 0.1); i++) l = loadAfter(l, 0, 0.1, f)
    expect(l).toBeCloseTo(100 * Math.exp(-1), 6)
  })
})

describe("relaxed shape motion in a match", () => {
  const physical = (params: Params) => {
    const cfg = makeConfig(7, { params })
    const keepers = new Set([cfg.home, cfg.away].flatMap((t) => [...t.starters, ...(t.bench ?? [])]).filter((p) => p.role === "GK").map((p) => p.id))
    let s = initMatch(cfg)
    let liveFrames = 0
    let liveM = 0
    let hsrM = 0
    while (!isFinished(s)) {
      const r = step(s)
      s = r.state
      const f = r.frame
      if (!f) continue
      for (const p of [...f.home, ...f.away]) {
        if (keepers.has(p.id)) continue
        if (f.ball_in_play) {
          liveFrames += 1
          liveM += p.vel * cfg.dt
        }
        if (p.vel >= 20 / 3.6) hsrM += p.vel * cfg.dt
      }
    }
    return { perLiveMin: liveM / ((liveFrames * cfg.dt) / 60), hsrM }
  }

  it("cuts outfield running in live play and high-speed metres", () => {
    const off = physical({ ...P, movement: { ...P.movement, relaxed: 0, relaxMarks: 0 } })
    const on = physical(P)
    expect(on.perLiveMin).toBeLessThan(0.85 * off.perLiveMin)
    expect(on.hsrM).toBeLessThan(0.5 * off.hsrM)
  }, 300_000)

  it("with tiring on, the match runs and keeps a load for players who ran fast", () => {
    let s = initMatch(makeConfig(8, { params: { ...P, fatigue: { ...P.fatigue, tiring: 1 } } }))
    while (!isFinished(s)) s = step(s).state
    expect(Object.values(s.load ?? {}).some((v) => v > 0)).toBe(true)
  }, 300_000)
})

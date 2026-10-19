import { describe, expect, it } from "vitest"
import { DEFAULT_PARAMS as P, type Params } from "../src/params.js"
import { releaseDelayS } from "../src/release.js"
import { Rng, seedRng } from "../src/rng.js"

// Explicit fixtures (not DEFAULT_PARAMS as "off"): no tail, no cap, so the free draw is the base alone.
const release = { ...P.release, tailShare: 0, capS: 0, freeS: [0.5, 1.5] as const }
const on: Params = { ...P, release: { ...release, freeRule: 1 } }
const off: Params = { ...P, release: { ...release, freeRule: 0 } }
const draws = (p: Params, d: number, n = 20_000, seed = 5) => {
  const r = new Rng(seedRng(seed))
  return Array.from({ length: n }, () => releaseDelayS(d, p, r))
}

describe("release.freeRule (P5, plan 8e ruling 22)", () => {
  it("freeRule 1 draws the free base from freeS", () => {
    const v = draws(on, 8).sort((a, b) => a - b)
    expect(v[0]!).toBeGreaterThanOrEqual(0.5)
    expect(v[v.length - 1]!).toBeLessThanOrEqual(1.5)
    expect(Math.abs(v[v.length >> 1]! - 1.0)).toBeLessThan(0.03)
    // The precondition: the old range is not freeS, so rule 1 changed something.
    expect(P.timing.decisionMinS).not.toBe(0.5)
  })
  it("freeRule 0 draws today's base range, the same for the same rng", () => {
    const a = draws(off, 8, 2000)
    const b = draws({ ...off, release: { ...off.release, freeS: [3, 4] } }, 8, 2000)
    expect(a).toEqual(b)
    for (const x of a) {
      expect(x).toBeGreaterThanOrEqual(P.timing.decisionMinS)
      expect(x).toBeLessThanOrEqual(P.timing.decisionMaxS)
    }
  })
  it("pressed draws are unchanged under both", () => {
    expect(draws(on, 1.5, 2000)).toEqual(draws(off, 1.5, 2000))
    for (const x of draws(on, 1.5, 2000)) {
      expect(x).toBeGreaterThanOrEqual(P.release.pressedS[0])
      expect(x).toBeLessThanOrEqual(P.release.pressedS[1])
    }
  })
})

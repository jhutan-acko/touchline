import { describe, expect, it } from "vitest"
import { DEFAULT_PARAMS as P } from "../src/params.js"
import { decide } from "../src/decide.js"
import { executeKick } from "../src/execute.js"
import { Rng, seedRng } from "../src/rng.js"
import type { PlayerState } from "../src/types.js"
import { kickoffPlayersFor, makeConfig, STYLES } from "../src/testing.js"

const kick = (pressure: number, composure: number, n = 2000) => {
  const r = new Rng(seedRng(4))
  const out = { mishit: 0, clean: 0, err: 0 }
  for (let i = 0; i < n; i++) {
    const e = executeKick({ from: { x: 0, y: 0 }, to: { x: 25, y: 5 }, height: "ground", technique: 0.6, composure, pressure, weakFoot: false }, P, r)
    if (e.execution === "mishit") out.mishit++
    if (e.execution === "clean") out.clean++
    out.err += e.errorM / n
  }
  return out
}

describe("execution", () => {
  it("error and mis-hits grow with pressure and low composure", () => {
    const calm = kick(0, 0.8), hot = kick(1, 0.2)
    expect(hot.err).toBeGreaterThan(calm.err * 2)
    expect(hot.mishit).toBeGreaterThan(calm.mishit * 5)
    expect(calm.clean / 2000).toBeGreaterThan(0.6)
  })
})

describe("decide", () => {
  const players = kickoffPlayersFor(makeConfig(1))
  const home = players.filter((p) => p.side === "home"), away = players.filter((p) => p.side === "away")
  const owner = (pos: { x: number; y: number }): PlayerState => ({ ...home[9]!, pos })
  const share = (o: PlayerState, styleKey: keyof typeof STYLES, action: string, n = 400) => {
    const r = new Rng(seedRng(8))
    let k = 0
    for (let i = 0; i < n; i++) {
      const d = decide({ owner: o, teammates: home, opponents: away, style: STYLES[styleKey], scoreDiff: 0, minute: 30, restart: null, scriptBias: {} }, P, r)
      if (d.action === action) k++
    }
    return k / n
  }
  it("shoots more often from the edge of the box than from midfield", () => {
    expect(share(owner({ x: 38, y: 0 }), "possession", "shot")).toBeGreaterThan(share(owner({ x: 5, y: 0 }), "possession", "shot"))
  })
  it("direct teams play more long balls than possession teams", () => {
    const o = { ...home[2]!, pos: { x: -30, y: 5 } }
    expect(share(o, "direct", "long_pass")).toBeGreaterThan(share(o, "possession", "long_pass"))
  })
  it("a penalty restart always shoots", () => {
    const r = new Rng(seedRng(1))
    const d = decide({ owner: owner({ x: 41.5, y: 0 }), teammates: home, opponents: away, style: STYLES.direct, scoreDiff: 0, minute: 10, restart: "penalty", scriptBias: {} }, P, r)
    expect(d.action).toBe("shot")
  })
  it("records the action probabilities and the best options, highest value first", () => {
    const r = new Rng(seedRng(3))
    for (let i = 0; i < 50; i++) {
      const d = decide({ owner: owner({ x: 0, y: 0 }), teammates: home, opponents: away, style: STYLES.possession, scoreDiff: 0, minute: 10, restart: null, scriptBias: {} }, P, r)
      const total = Object.values(d.actionProbs).reduce((a, b) => a + b, 0)
      expect(total).toBeGreaterThan(0.99)
      expect(total).toBeLessThan(1.01)
      expect(d.options.length).toBeGreaterThan(0)
      expect(d.options.length).toBeLessThanOrEqual(5)
      for (let k = 1; k < d.options.length; k++) expect(d.options[k - 1]!.value).toBeGreaterThanOrEqual(d.options[k]!.value)
      // option values are rounded to 3 decimals
      if (d.candidate) expect(d.candidate.value).toBeLessThanOrEqual(d.options[0]!.value + 0.0006)
    }
  })
  it("reports decision quality between 0 and 1 for passes", () => {
    const r = new Rng(seedRng(2))
    for (let i = 0; i < 50; i++) {
      const d = decide({ owner: owner({ x: 0, y: 0 }), teammates: home, opponents: away, style: STYLES.possession, scoreDiff: 0, minute: 10, restart: null, scriptBias: {} }, P, r)
      if (d.candidate) { expect(d.decisionQuality).toBeGreaterThanOrEqual(0); expect(d.decisionQuality).toBeLessThanOrEqual(1) }
    }
  })
})

import { describe, expect, it } from "vitest"
import { pairedBootstrap, percentile, verdict, wilson } from "../src/ab/stats.js"

describe("A/B statistics", () => {
  it("bootstrap a paired mean: the interval holds the mean, narrows with more pairs, and is the same every time", () => {
    const diffs = Array.from({ length: 40 }, (_, i) => ((i * 37) % 11) / 10 - 0.3)
    const i = pairedBootstrap(diffs)
    expect(i.lo).toBeLessThan(i.mean)
    expect(i.hi).toBeGreaterThan(i.mean)
    expect(pairedBootstrap(diffs)).toEqual(i)
    const wide = pairedBootstrap(diffs.slice(0, 10))
    expect(wide.hi - wide.lo).toBeGreaterThan(i.hi - i.lo)
    const same = pairedBootstrap([0.2, 0.2, 0.2])
    for (const v of [same.mean, same.lo, same.hi]) expect(v).toBeCloseTo(0.2, 12)
  })
  it("give Wilson intervals for a share (textbook value: 8 of 10 is 0.49 to 0.94)", () => {
    const w = wilson(8, 10)
    expect([w.mean, Math.round(w.lo * 100) / 100, Math.round(w.hi * 100) / 100]).toEqual([0.8, 0.49, 0.94])
    expect(wilson(0, 10).lo).toBeCloseTo(0, 10)
  })
  it("read a verdict from whether the interval excludes zero", () => {
    expect(verdict({ mean: 0.1, lo: 0.02, hi: 0.2, n: 9 })).toBe("better")
    expect(verdict({ mean: -0.1, lo: -0.2, hi: -0.01, n: 9 })).toBe("worse")
    expect(verdict({ mean: 0.1, lo: -0.02, hi: 0.2, n: 9 })).toBe("no detectable difference")
  })
  it("take percentiles by interpolation", () => {
    expect(percentile([1, 2, 3, 4], 0.5)).toBe(2.5)
    expect(percentile([5], 0.95)).toBe(5)
  })
})

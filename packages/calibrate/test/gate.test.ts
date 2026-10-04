import { describe, expect, it } from "vitest"
import { DRIFT_Z, driftZ, summarize, type Baseline } from "../src/gate.js"
import { SCALAR_KEYS, type MatchMetrics } from "../src/metrics.js"

const base = (mean: number, sd: number): Baseline => ({
  note: "test",
  seeds: [],
  mean: Object.fromEntries(SCALAR_KEYS.map((k) => [k, mean])) as Baseline["mean"],
  sd: Object.fromEntries(SCALAR_KEYS.map((k) => [k, sd])) as Baseline["sd"]
})

describe("drift check", () => {
  it("summarizes per-match statistics into mean and sample SD", () => {
    const ms = [1, 2, 3].map((v) => Object.fromEntries(SCALAR_KEYS.map((k) => [k, v])) as unknown as MatchMetrics)
    const s = summarize(ms)
    expect(s.mean.goals).toBe(2)
    expect(s.sd.goals).toBeCloseTo(1, 12)
  })
  it("passes when the statistics are unchanged and flags a statistic that collapses or inflates", () => {
    const b = base(4, 1.6)
    expect(Math.max(...Object.values(driftZ(b.mean, b, 16)).map(Math.abs))).toBe(0)
    expect(Math.abs(driftZ({ ...b.mean, corners: 0 }, { ...b, mean: { ...b.mean, corners: 1.8 }, sd: { ...b.sd, corners: 1.3 } }, 16).corners)).toBeGreaterThan(DRIFT_Z)
    expect(Math.abs(driftZ({ ...b.mean, goals: 6.4 }, b, 16).goals)).toBeGreaterThan(DRIFT_Z)
    expect(Math.abs(driftZ({ ...b.mean, goals: 4.5 }, b, 16).goals)).toBeLessThan(DRIFT_Z)
  })
})

import { SCALAR_KEYS, type MatchMetrics, type ScalarKey } from "./metrics.js"

/** Held-out seeds for the realism gate (tuner uses 1000+, the realism report 2000+). */
export const GATE_SEEDS: ReadonlyArray<number> = Array.from({ length: 16 }, (_, i) => 3000 + i)

/** A statistic drifts when it moves more than this many standard errors from the committed baseline. */
export const DRIFT_Z = 3.5

type Stats = Record<ScalarKey, number>

/** Gate statistics of the committed engine and parameters (data/params/realism-baseline.json). */
export interface Baseline {
  readonly note: string
  readonly seeds: ReadonlyArray<number>
  readonly mean: Stats
  readonly sd: Stats
}

export const summarize = (ms: ReadonlyArray<MatchMetrics>): { mean: Stats; sd: Stats } => {
  const mean = Object.fromEntries(SCALAR_KEYS.map((k) => [k, ms.reduce((s, m) => s + m[k], 0) / ms.length])) as Stats
  const sd = Object.fromEntries(
    SCALAR_KEYS.map((k) => [k, Math.sqrt(ms.reduce((s, m) => s + (m[k] - mean[k]) ** 2, 0) / Math.max(1, ms.length - 1))])
  ) as Stats
  return { mean, sd }
}

/** Two-sample z per statistic: the difference of two n-match means over its standard error, sd·√(2/n). */
export const driftZ = (now: Readonly<Stats>, base: Baseline, n: number): Stats =>
  Object.fromEntries(
    SCALAR_KEYS.map((k) => [k, (now[k] - base.mean[k]) / (Math.max(base.sd[k], 0.05 * Math.abs(base.mean[k]), 1e-3) * Math.sqrt(2 / n))])
  ) as Stats

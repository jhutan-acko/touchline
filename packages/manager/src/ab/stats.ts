/**
 * The A/B statistics (spec §5): a seeded paired bootstrap for differences between arms, Wilson intervals for win
 * rates, and percentiles for latency. Deterministic: the same numbers and seed give the same intervals.
 */
import { Rng, seedRng } from "@touchline/sim-core"

export const BOOTSTRAP_RESAMPLES = 10_000
export const BOOTSTRAP_SEED = 4242

export interface Interval {
  readonly mean: number
  readonly lo: number
  readonly hi: number
  readonly n: number
}

const mean = (xs: ReadonlyArray<number>) => xs.reduce((a, b) => a + b, 0) / xs.length

/** The value below which a share `p` of the sorted numbers lie (linear interpolation). */
export const percentile = (xs: ReadonlyArray<number>, p: number): number => {
  if (xs.length === 0) return NaN
  const s = [...xs].sort((a, b) => a - b)
  const at = p * (s.length - 1)
  const lo = Math.floor(at), hi = Math.ceil(at)
  return s[lo]! + (s[hi]! - s[lo]!) * (at - lo)
}

/** Mean of paired differences with a 95 % percentile bootstrap interval (resampling the pairs). */
export const pairedBootstrap = (diffs: ReadonlyArray<number>, resamples = BOOTSTRAP_RESAMPLES, seed = BOOTSTRAP_SEED): Interval => {
  const n = diffs.length
  if (n === 0) return { mean: NaN, lo: NaN, hi: NaN, n: 0 }
  const rng = new Rng(seedRng(seed))
  const means: number[] = []
  for (let b = 0; b < resamples; b++) {
    let sum = 0
    for (let i = 0; i < n; i++) sum += diffs[Math.floor(rng.uniform() * n)]!
    means.push(sum / n)
  }
  return { mean: mean(diffs), lo: percentile(means, 0.025), hi: percentile(means, 0.975), n }
}

/** A share with its 95 % Wilson interval. */
export const wilson = (successes: number, n: number, z = 1.96): Interval => {
  if (n === 0) return { mean: NaN, lo: NaN, hi: NaN, n: 0 }
  const p = successes / n
  const d = 1 + (z * z) / n
  const centre = (p + (z * z) / (2 * n)) / d
  const half = (z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n))) / d
  return { mean: p, lo: centre - half, hi: centre + half, n }
}

/** "better", "worse" or "no detectable difference": whether the interval excludes zero, and on which side. */
export const verdict = (i: Interval): "better" | "worse" | "no detectable difference" => (i.lo > 0 ? "better" : i.hi < 0 ? "worse" : "no detectable difference")

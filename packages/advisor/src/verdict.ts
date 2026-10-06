import type { Estimate } from "@touchline/sim-core"

/** A verdict needs at least this many paired seeds. */
export const MIN_VERDICT_SEEDS = 10
/** ... and a gain of at least this much (xG created plus xT left at the end): smaller differences do not matter. */
export const MIN_GAIN = 0.01
/** Family-wise error rate across the alternatives compared with the pass played. */
const ALPHA = 0.05

/** Standard normal quantile (Acklam's rational approximation, relative error below 1.2e-9). */
const normalQuantile = (p: number): number => {
  const a = [-39.69683028665376, 220.9460984245205, -275.9285104469687, 138.357751867269, -30.66479806614716, 2.506628277459239]
  const b = [-54.47609879822406, 161.5858368580409, -155.6989798598866, 66.80131188771972, -13.28068155288572]
  const c = [-0.007784894002430293, -0.3223964580411365, -2.400758277161838, -2.549732539343734, 4.374664141464968, 2.938163982698783]
  const d = [0.007784695709041462, 0.3224671290700398, 2.445134137142996, 3.754408661907416]
  const lo = 0.02425
  if (p < lo) {
    const q = Math.sqrt(-2 * Math.log(p))
    return (((((c[0]! * q + c[1]!) * q + c[2]!) * q + c[3]!) * q + c[4]!) * q + c[5]!) / ((((d[0]! * q + d[1]!) * q + d[2]!) * q + d[3]!) * q + 1)
  }
  if (p > 1 - lo) return -normalQuantile(1 - p)
  const q = p - 0.5
  const r = q * q
  return ((((((a[0]! * r + a[1]!) * r + a[2]!) * r + a[3]!) * r + a[4]!) * r + a[5]!) * q) / (((((b[0]! * r + b[1]!) * r + b[2]!) * r + b[3]!) * r + b[4]!) * r + 1)
}

/** Student t quantile by the Cornish-Fisher expansion around the normal (close for 9 or more degrees of freedom). */
export const tQuantile = (p: number, df: number): number => {
  const z = normalQuantile(p)
  return z + (z ** 3 + z) / (4 * df) + (5 * z ** 5 + 16 * z ** 3 + 3 * z) / (96 * df ** 2) + (3 * z ** 7 + 19 * z ** 5 + 17 * z ** 3 - 15 * z) / (384 * df ** 3)
}

/**
 * Whether an alternative played out clearly better than the pass played: enough seeds, a gain of at least MIN_GAIN,
 * and a paired t statistic beyond the two-sided 95 % level corrected (Bonferroni) for the alternatives compared.
 */
export const clearlyBetter = (difference: Estimate, seeds: number, comparisons: number): boolean => {
  if (seeds < MIN_VERDICT_SEEDS || difference.mean < MIN_GAIN) return false
  const critical = tQuantile(1 - ALPHA / (2 * Math.max(1, comparisons)), seeds - 1)
  return difference.mean > critical * difference.se
}

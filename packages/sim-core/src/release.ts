import type { Params } from "./params.js"
import type { Rng } from "./rng.js"

/**
 * Seconds a player takes on the ball before his first decision after winning or receiving it (realism v2 P3, D2). With an
 * opponent within release.pressedM: release.pressedS (real median 0.4 s, 63 % within 1 s). Otherwise the base range
 * timing.decisionMinS..MaxS, plus, with chance release.tailShare, an exponential extra of mean release.tailMeanS: real
 * players hold the ball over 3 s 16 % of the time (carrier-report C6). release.capS > 0 caps that free delay (M6).
 */
export const releaseDelayS = (nearestOppM: number, p: Params, rng: Rng): number => {
  const r = p.release
  if (nearestOppM < r.pressedM) return rng.range(r.pressedS[0], r.pressedS[1])
  const base = rng.range(p.timing.decisionMinS, p.timing.decisionMaxS)
  const free = rng.chance(r.tailShare) ? base - r.tailMeanS * Math.log(1 - rng.uniform()) : base
  // M6: a free release is capped at capS seconds (after the draws, so the stream is unchanged). 0: no cap.
  return r.capS > 0 ? Math.min(free, r.capS) : free
}

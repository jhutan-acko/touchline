/**
 * Optional realism noise for exported events (spec §5.1.9): event-time jitter N(-0.37 s, 1.82 s), as measured
 * between real event feeds and tracking, and location noise, so the CDF events look like unsynced real data.
 * Off by default; the domain stream and SPADL view stay exact (they are the ground truth).
 */
import { matchClock, Rng, substream, type DomainEvent, type MatchConfig } from "@touchline/sim-core"

/** Location spread is a prior (about a metre of human tagging error), not fitted. */
export const REALISM_NOISE = { timeMeanS: -0.37, timeSdS: 1.82, locationSdM: 1.0 } as const

const clamp = (v: number, h: number) => Math.max(-h, Math.min(h, v))

/**
 * Noisy copies of `events`: located events get a jittered time (frame ids and match clock follow, kept inside
 * the period: at least frame 0, at most `lastFrame(period)` when given) and jittered coordinates kept on the
 * pitch. Events without a location (match and period markers) are unchanged. Seeded by the match seed.
 */
export const addRealismNoise = (events: ReadonlyArray<DomainEvent>, cfg: MatchConfig, lastFrame?: (period: DomainEvent["period"]) => number): DomainEvent[] => {
  const rng = new Rng(substream(cfg.seed, "realism_noise"))
  const n = REALISM_NOISE
  return events.map((e) => {
    if (e.x === null || e.y === null) return e
    const shift = Math.round((n.timeMeanS + rng.normal() * n.timeSdS) / cfg.dt)
    const last = lastFrame?.(e.period) ?? Infinity
    const pf = Math.min(last, Math.max(0, e.period_frame_id + shift))
    const delta = pf - e.period_frame_id
    const periodStart = e.frame_id - e.period_frame_id
    const jx = rng.normal() * n.locationSdM
    const jy = rng.normal() * n.locationSdM
    return {
      ...e,
      frame_id: e.frame_id + delta,
      period_frame_id: pf,
      // A pass's end moves with it, so the receiver still comes after the pass.
      frame_id_end: e.frame_id_end === null ? null : Math.min(periodStart + last, e.frame_id_end + delta),
      match_clock: matchClock(e.period, pf, cfg.dt),
      x: clamp(e.x + jx, 52.5),
      y: clamp(e.y + jy, 34),
      x_end: e.x_end === null ? null : clamp(e.x_end + jx, 52.5),
      y_end: e.y_end === null ? null : clamp(e.y_end + jy, 34)
    }
  })
}

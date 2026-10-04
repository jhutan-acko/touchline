import type { Club, League } from "@touchline/league"
import { initMatch, isFinished, step, type DomainEvent, type Frame, type MatchConfig, type Params } from "@touchline/sim-core"
import { matchMetrics, SCALAR_KEYS, type MatchMetrics, type ScalarKey } from "./metrics.js"

/** Target statistic measured on real matches (data/params/targets-*.json). */
export interface Target {
  readonly mean: number
  readonly sd: number
  readonly n: number
}
export interface Targets {
  readonly provenance: Readonly<Record<string, string>>
  readonly metrics: Readonly<Record<string, Target>>
}

/** Fixtures used for every evaluation: each club appears, each style meets the others. */
export const FIXTURES: ReadonlyArray<readonly [string, string]> = [
  ["ironmoor", "saltmarsh"],
  ["kestrel-bay", "harrowmere"],
  ["eastvale", "northwick"],
  ["corrin-forge", "larkspur"],
  ["harrowmere", "ironmoor"],
  ["saltmarsh", "kestrel-bay"],
  ["larkspur", "eastvale"],
  ["northwick", "corrin-forge"]
]

export const runMatch = (cfg: MatchConfig): { events: DomainEvent[]; frames: Frame[] } => {
  let s = initMatch(cfg)
  const events: DomainEvent[] = []
  const frames: Frame[] = []
  while (!isFinished(s)) {
    const r = step(s)
    s = r.state
    events.push(...r.events)
    if (r.frame) frames.push(r.frame)
  }
  return { events, frames }
}

const club = (league: League, id: string): Club => {
  const c = league.clubs.find((x) => x.id === id)
  if (!c) throw new Error(`unknown club ${id}`)
  return c
}

/** Metrics for `matches` simulated matches (fixture i uses seed 1000 + i, so every evaluation sees the same matches). */
export const evaluate = (league: League, params: Params, matches: number): MatchMetrics[] =>
  Array.from({ length: matches }, (_, i) => {
    const [h, a] = FIXTURES[i % FIXTURES.length]!
    const cfg: MatchConfig = { matchId: `cal-${i}`, seed: 1000 + i, kickoffTime: "2026-10-18T14:00:00.000Z", home: club(league, h), away: club(league, a), params, dt: 0.1 }
    const { events, frames } = runMatch(cfg)
    return matchMetrics(events, frames, cfg.dt)
  })

export const meanMetrics = (ms: ReadonlyArray<MatchMetrics>): Record<ScalarKey, number> =>
  Object.fromEntries(SCALAR_KEYS.map((k) => [k, ms.reduce((s, m) => s + m[k], 0) / ms.length])) as Record<ScalarKey, number>

/** Relative weights: noisy, low-count statistics count less. */
export const WEIGHTS: Readonly<Record<ScalarKey, number>> = {
  passes: 1, completion: 1, long_share: 1, pass_len_median: 1, shots: 1, on_target_share: 0.7, goals: 1, penalties: 0.5, corners: 0.7,
  throw_ins: 1, goal_kicks: 0.7, free_kicks: 0.7, fouls: 1, cards: 0.5, in_play_share: 1, distance_km_median: 0.7, peak_speed_kmh_median: 0.7
}

/** Scale for a z-score: the real between-match SD, but never below 5 % of the mean (tracking targets come from one match). */
export const scaleOf = (t: Target): number => Math.max(t.sd, 0.05 * Math.abs(t.mean), 1e-6)

export const loss = (sim: Readonly<Record<ScalarKey, number>>, targets: Targets): number =>
  SCALAR_KEYS.reduce((acc, k) => {
    const t = targets.metrics[k]
    if (!t || !Number.isFinite(sim[k])) return acc
    const z = (sim[k] - t.mean) / scaleOf(t)
    return acc + WEIGHTS[k] * z * z
  }, 0)

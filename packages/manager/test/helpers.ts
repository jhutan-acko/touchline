import { readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import type { League } from "@touchline/league"
import { initMatch, isFinished, paramsFromJson, step, type DomainEvent, type MatchConfig, type MatchState } from "@touchline/sim-core"
import { modelsFromJson, xtGridFromJson } from "@touchline/stats"
import { keyMoment, NO_MOMENTS } from "../src/moments.js"
import { MatchWatch } from "../src/situation.js"
import type { MomentReason } from "@touchline/schema"

export const root = join(dirname(fileURLToPath(import.meta.url)), "../../..")
const json = (p: string) => JSON.parse(readFileSync(join(root, p), "utf8"))
export const league = json("data/league/league.json") as League
export const params = paramsFromJson(json("data/params/touchline-params.json"))
export const models = modelsFromJson(json("data/params/stats-models.json"))
export const xt = xtGridFromJson(json("data/params/xt-grid.json"))
export const club = (id: string) => league.clubs.find((c) => c.id === id)!

/**
 * The seed of the match whose minute-60 moment the situation, moments, what-if, agent and e2e tests read: the first from
 * 11 on with exactly one minute-60 and one minute-75 key moment. 13 since P4 Task 10 (on seed 11 the minute-60 moment is
 * now absorbed by an earlier decision; scan of 11-24: 13-24 qualify).
 */
export const MOMENTS_SEED = 13

/** A league match (calibrated params) whose listed sides have a manager. */
export const leagueConfig = (seed: number, managed: MatchConfig["managed"] = ["home", "away"], home = "ironmoor", away = "kestrel-bay"): MatchConfig => ({
  matchId: `m-${seed}`, seed, kickoffTime: "2026-10-18T14:00:00.000Z", home: club(home), away: club(away), params, dt: 0.1, managed
})

export interface Moment {
  readonly state: MatchState
  readonly reasons: MomentReason[]
}

/** Play a match with no decisions made, recording every key moment; stop early once `stop` holds for a moment. */
export const playMoments = (cfg: MatchConfig, stop: (m: Moment) => boolean = () => false) => {
  let s = initMatch(cfg)
  let memory = NO_MOMENTS
  const watch = new MatchWatch(cfg, models, xt)
  const moments: Moment[] = []
  const events: DomainEvent[] = []
  while (!isFinished(s)) {
    const r = step(s)
    s = r.state
    watch.add(r)
    events.push(...r.events)
    const k = keyMoment(s, r.events, memory)
    memory = k.memory
    if (k.reasons.length > 0) {
      const m = { state: s, reasons: k.reasons }
      moments.push(m)
      if (stop(m)) break
    }
  }
  return { state: s, moments, events, watch }
}

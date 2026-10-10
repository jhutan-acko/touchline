/**
 * One A/B match (spec §5): a fixture played with the managed team's manager of one arm — none, rules or agent — and
 * the opponent unmanaged. The three arms of a seed are the same match until the first key moment.
 */
import { Effect } from "effect"
import type { DomainEvent, MatchConfig, Side } from "@touchline/sim-core"
import type { Decision } from "@touchline/schema"
import type { StatsModels, XtGrid } from "@touchline/stats"
import type { Manager } from "../decision.js"
import { rulesManager } from "../rules.js"
import { runManaged } from "../run.js"

export const ARMS = ["none", "rules", "agent"] as const
export type Arm = (typeof ARMS)[number]

/** The first A/B seed: clear of calibration (1000+), the realism report (2000+) and the gate (3000+). */
export const AB_FIRST_SEED = 5000

export interface Fixture {
  readonly seed: number
  readonly home: string
  readonly away: string
  readonly managedSide: Side
}

/**
 * `count` fixtures from seed `first`: the managed club cycles through every club, its opponent through the others
 * (shifting each cycle), and the managed team is at home on even seeds and away on odd ones.
 */
export const fixtures = (first: number, count: number, clubs: ReadonlyArray<string>): Fixture[] =>
  Array.from({ length: count }, (_, i) => {
    const n = clubs.length
    const managed = clubs[i % n]!
    const opponent = clubs[(i + 1 + (Math.floor(i / n) % (n - 1))) % n]!
    const managedSide: Side = i % 2 === 0 ? "home" : "away"
    return { seed: first + i, home: managedSide === "home" ? managed : opponent, away: managedSide === "home" ? opponent : managed, managedSide }
  })

export interface MatchResult {
  readonly seed: number
  readonly arm: Arm
  readonly home: string
  readonly away: string
  readonly managed_side: Side
  readonly managed_team: string
  readonly opponent: string
  readonly score: { readonly for: number; readonly against: number }
  /** The managed team's xG minus the opponent's over the match (the engine's shot xG). */
  readonly xg_diff: number
  readonly goal_diff: number
  readonly points: number
  readonly decisions: ReadonlyArray<Decision>
}

/** The managed team's result from a match's events. */
export const resultOf = (events: ReadonlyArray<DomainEvent>, team: string) => {
  const xg = (own: boolean) => events.filter((e) => e.type === "shot" && (e.team_id === team) === own).reduce((a, e) => a + (typeof e.attrs.xg === "number" ? e.attrs.xg : 0), 0)
  const goals = (own: boolean) => events.filter((e) => e.type === "goal" && (e.team_id === team) === own).length
  const f = goals(true), a = goals(false)
  return { score: { for: f, against: a }, xg_diff: xg(true) - xg(false), goal_diff: f - a, points: f > a ? 3 : f === a ? 1 : 0 }
}

/** Play `fixture` with the managed team's `arm` manager (`agent` builds the agent manager). */
export const playArm = (cfg: MatchConfig, fixture: Fixture, arm: Arm, agent: () => Manager, stats: { readonly models: StatsModels; readonly xt: XtGrid | null }): Effect.Effect<MatchResult> =>
  Effect.gen(function* () {
    const manager = arm === "none" ? undefined : arm === "rules" ? rulesManager : agent()
    const run = yield* runManaged(cfg, manager ? { [fixture.managedSide]: manager } : {}, stats)
    const team = cfg[fixture.managedSide].id
    const opponent = cfg[fixture.managedSide === "home" ? "away" : "home"].id
    return { seed: fixture.seed, arm, home: fixture.home, away: fixture.away, managed_side: fixture.managedSide, managed_team: team, opponent, ...resultOf(run.events, team), decisions: run.decisions }
  })

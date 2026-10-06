import type { DomainEvent, MetricId, Signal } from "@touchline/schema"
import { metricDef, METRICS, type MetricDef } from "./catalog.js"
import { StatsError, type StatsEngine } from "./engine.js"
import type { PlayerInfo, TeamInfo } from "./input.js"

/**
 * Read-only questions about a match, as of a tick (spec §5.3: agents read state only through these, via MCP).
 * Every answer is clamped to what the engine has ingested, and says which tick it is about.
 */

export interface MetricAnswer {
  readonly metric_id: MetricId
  readonly subject: string
  readonly value: number | null
  readonly unit: string
  readonly as_of_frame: number
  /** The ticks the value covers: (from, to]; from is null for the match so far. */
  readonly from_frame: number | null
  /** How to cite it: `metric@from-to`. */
  readonly ref: string
}

export interface EventView {
  readonly id: string
  readonly type: string
  readonly frame_id: number
  readonly frame_id_end: number | null
  readonly match_clock: string
  readonly team_id: string | null
  readonly player_id: string | null
  readonly outcome: string | null
  readonly x: number | null
  readonly y: number | null
  readonly x_end: number | null
  readonly y_end: number | null
  /** Values the stats engine derived (pass.dist, pass.xp, shot.xg, shot.speed). */
  readonly values: Readonly<Record<string, number>>
  /** What could be seen of the event (QUALIFIERS): how a pass was struck, a first touch, pressure, a card's colour. */
  readonly qualifiers: Readonly<Record<string, string | boolean>>
}

/**
 * Event attributes an observer could report, so agents can name a cause ("a mis-hit under pressure"). An allow-list:
 * the simulator's ground truth (`scripted`) and decision-model internals (`best_receiver_id`: see get_decision) stay out.
 */
export const QUALIFIERS: ReadonlyArray<string> = [
  "execution", "first_touch", "under_pressure", "lost_possession", "kind", "height", "body_part", "technique", "restart",
  "colour", "on_target", "handling", "own_goal", "scorer_id", "receiver_id", "intended_receiver_id", "victim_id",
  "winner_id", "loser_id", "target_id", "blocked", "ball", "reason", "side", "from", "method"
]

export interface DecisionView {
  readonly event_id: string
  readonly type: string
  readonly player_id: string | null
  readonly frame_id: number
  /** The decision model's probability for each action. */
  readonly action_probs: Readonly<Record<string, number>>
  /** The options it weighed, best first (receiver, kind, target, xPass, value). */
  readonly options: ReadonlyArray<unknown>
  /** Rank of the chosen pass among the options (1 = best), or null for a non-pass action. */
  readonly chosen_rank: number | null
  readonly best_receiver_id: string | null
  readonly chosen_receiver_id: string | null
  readonly fallback: boolean
}

export interface ClaimCheck {
  readonly verified: boolean
  readonly claimed: number
  readonly actual: number | null
  readonly difference: number | null
  readonly tolerance: number
  readonly ref: string
}

/** Default tolerance for a claimed value: 2 % of the actual value, at least 0.006 (a share rounded to whole percent). */
export const claimTolerance = (actual: number): number => Math.max(0.006, 0.02 * Math.abs(actual))

export class StatsQuery {
  constructor(readonly engine: StatsEngine) {}

  /** A tick no later than what has been ingested (default: the latest). */
  asOf(at?: number | null): number {
    return at === undefined || at === null ? this.engine.now : Math.max(0, Math.min(at, this.engine.now))
  }

  players(): ReadonlyArray<PlayerInfo & { readonly team_id: string }> {
    return [this.engine.info.home, this.engine.info.away].flatMap((t) => t.players.map((p) => ({ ...p, team_id: t.id })))
  }

  matchInfo(at?: number | null) {
    const t = this.asOf(at)
    const goals = this.eventsBetween(null, t, { types: ["goal"] })
    const team = (x: TeamInfo) => ({ id: x.id, name: x.name, side: x.side, players: x.players })
    const { home, away } = this.engine.info
    return {
      match_id: this.engine.info.matchId,
      as_of_frame: t,
      /** Seconds per frame and frames per second: frames are global ticks. */
      dt: this.engine.info.dt,
      fps: Math.round(1 / this.engine.info.dt),
      home: team(home),
      away: team(away),
      score: { home: goals.filter((g) => g.team_id === home.id).length, away: goals.filter((g) => g.team_id === away.id).length },
      // Where the match stood at the frame asked about (never the latest ingested frame, which may be later).
      latest: this.engine.frame ? { frame: t, period: this.engine.periodAt(t), match_clock: this.engine.clockAt(t) } : null
    }
  }

  metrics(): ReadonlyArray<MetricDef> {
    return METRICS
  }

  metric(id: string, subject: string, at?: number | null, windowS?: number | null): MetricAnswer {
    const def = metricDef(id)
    if (!def) throw new StatsError(`unknown metric "${id}"; list_metrics gives the ids`)
    const t = this.asOf(at)
    const window = def.windowed ? (windowS === undefined ? def.defaultWindowS : windowS) : null
    const from = window === null ? null : t - this.engine.ticks(window)
    const value = this.engine.value(def.id, subject, { at: t, windowS: window })
    return { metric_id: def.id, subject, value, unit: def.unit, as_of_frame: t, from_frame: from, ref: `${def.id}@${from === null ? 0 : Math.max(0, from)}-${t}` }
  }

  series(id: string, subject: string, fromFrame: number, toFrame: number, stepS = 60, windowS?: number | null): ReadonlyArray<{ readonly frame: number; readonly value: number | null }> {
    const to = this.asOf(toFrame)
    const step = Math.max(1, this.engine.ticks(stepS))
    if ((to - fromFrame) / step > 500) throw new StatsError("too many points: use a longer step_s (at most 500 points)")
    const out: Array<{ frame: number; value: number | null }> = []
    for (let t = Math.max(0, fromFrame); t <= to; t += step) out.push({ frame: t, value: this.metric(id, subject, t, windowS).value })
    return out
  }

  /** Refuse an unknown team or player id in a filter, so a typo is not mistaken for "nothing happened". */
  private checkFilter(teamId?: string, playerId?: string): void {
    if (teamId && !this.engine.team(teamId)) throw new StatsError(`unknown team "${teamId}"; match_info lists the teams`)
    if (playerId && !this.engine.teamOf(playerId)) throw new StatsError(`unknown player "${playerId}"; match_info lists the players`)
  }

  rankPlayers(id: string, opts: { readonly teamId?: string; readonly at?: number | null; readonly windowS?: number | null; readonly top?: number; readonly order?: "desc" | "asc" } = {}) {
    const def = metricDef(id)
    if (!def?.subjects.includes("player")) throw new StatsError(`${id} is not a player metric`)
    this.checkFilter(opts.teamId)
    const rows = this.players()
      .filter((p) => !opts.teamId || p.team_id === opts.teamId)
      .map((p) => ({ player_id: p.id, name: p.name, team_id: p.team_id, value: this.metric(id, p.id, opts.at, opts.windowS).value }))
      .filter((r): r is typeof r & { value: number } => r.value !== null)
      .sort((a, b) => (opts.order === "asc" ? a.value - b.value : b.value - a.value) || a.player_id.localeCompare(b.player_id))
    return rows.slice(0, opts.top ?? 5)
  }

  signalsBetween(from: number | null, to?: number | null, f: { readonly types?: ReadonlyArray<string>; readonly teamId?: string; readonly minSalience?: number } = {}): Signal[] {
    this.checkFilter(f.teamId)
    const t = this.asOf(to)
    return this.engine.signals
      .filter((s) => s.frame_id <= t && (from === null || s.frame_id >= from))
      .filter((s) => (!f.types || f.types.includes(s.type)) && (!f.teamId || s.team_id === f.teamId) && s.salience >= (f.minSalience ?? 0))
      .sort((a, b) => a.frame_id - b.frame_id || a.id.localeCompare(b.id))
  }

  /** Events known by `to` (emitted at or before it) whose own tick is at or after `from`. */
  eventsBetween(from: number | null, to?: number | null, f: { readonly types?: ReadonlyArray<string>; readonly teamId?: string; readonly playerId?: string } = {}): EventView[] {
    this.checkFilter(f.teamId, f.playerId)
    const t = this.asOf(to)
    const out: EventView[] = []
    const { events, eventTicks } = this.engine
    for (let i = 0; i < events.length; i++) {
      const e = events[i]!
      if (eventTicks[i]! > t || (from !== null && e.frame_id < from)) continue
      if ((f.types && !f.types.includes(e.type)) || (f.teamId && e.team_id !== f.teamId) || (f.playerId && e.player_id !== f.playerId)) continue
      out.push(view(e, this.engine.derived.get(e.id) ?? {}))
    }
    return out
  }

  decision(eventId: string, at?: number | null): DecisionView {
    const t = this.asOf(at)
    const i = this.engine.events.findIndex((e) => e.id === eventId)
    if (i < 0 || this.engine.eventTicks[i]! > t) throw new StatsError(`no event "${eventId}" (as of frame ${t})`)
    const e = this.engine.events[i]!
    const a = e.attrs
    if (a.action_probs === undefined) throw new StatsError(`event "${eventId}" (${e.type}) has no decision record`)
    const str = (v: unknown) => (typeof v === "string" ? v : null)
    return {
      event_id: e.id,
      type: e.type,
      player_id: e.player_id,
      frame_id: e.frame_id,
      action_probs: (a.action_probs ?? {}) as Readonly<Record<string, number>>,
      options: (a.options ?? []) as ReadonlyArray<unknown>,
      chosen_rank: typeof a.chosen_rank === "number" ? a.chosen_rank : null,
      best_receiver_id: str(a.best_receiver_id),
      chosen_receiver_id: str(a.intended_receiver_id),
      fallback: a.fallback === true
    }
  }

  verifyClaim(id: string, subject: string, at: number, claimed: number, windowS?: number | null, tolerance?: number): ClaimCheck {
    const m = this.metric(id, subject, at, windowS)
    // A caller may tighten the tolerance but never loosen it: the check is the Fact-Checker's, not the claimant's.
    const standard = m.value === null ? 0 : claimTolerance(m.value)
    const tol = tolerance === undefined ? standard : Math.min(tolerance, standard)
    const diff = m.value === null ? null : Math.abs(claimed - m.value)
    return { verified: diff !== null && diff <= tol, claimed, actual: m.value, difference: diff, tolerance: tol, ref: m.ref }
  }
}

const view = (e: DomainEvent, values: Readonly<Record<string, number>>): EventView => ({
  id: e.id,
  type: e.type,
  frame_id: e.frame_id,
  frame_id_end: e.frame_id_end,
  match_clock: e.match_clock,
  team_id: e.team_id,
  player_id: e.player_id,
  outcome: e.outcome,
  x: e.x,
  y: e.y,
  x_end: e.x_end,
  y_end: e.y_end,
  values,
  qualifiers: Object.fromEntries(QUALIFIERS.flatMap((k) => {
    const v = e.attrs[k]
    return typeof v === "string" || typeof v === "boolean" ? [[k, v] as const] : []
  }))
})

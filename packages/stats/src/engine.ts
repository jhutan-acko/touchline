import type { DomainEvent, MetricId, Signal, SignalType } from "@touchline/schema"
import { matchClock } from "@touchline/sim-core"
import { metricDef, type SubjectKind } from "./catalog.js"
import { emittedAt, type MatchInfo, type StatsInput, type TeamInfo, type TrackFrame } from "./input.js"
import type { StatsModels } from "./models.js"
import { Counters, maxBetween, Series } from "./store.js"

/** A query the engine cannot answer (unknown subject, metric not defined for it) or input out of order. */
export class StatsError extends Error {}

export const SPRINT_KMH = 30
/** A new speed alert for a player needs a sprint at least this much faster than their last alert. */
export const SPRINT_ALERT_STEP_KMH = 0.5
export const DISTANCE_MILESTONES_M = [10_000, 12_000] as const
/** Faster than this between frames is a jump (half-time reset, substitution), not running. */
const MAX_RUN_MS = 12
const MAX_BALL_KMH = 200

export interface QueryOptions {
  /** Global tick to answer at (default: the latest ingested). */
  readonly at?: number
  /** Restrict a windowed metric to the last `windowS` seconds (default: the metric's default window). */
  readonly windowS?: number | null
}

interface Sprint {
  readonly from: number
  peak: number
  to: number
}

interface Pos {
  readonly tick: number
  readonly period: string
  readonly x: number
  readonly y: number
  readonly z: number
}

/**
 * The stats engine (spec §5.2): incremental and deterministic. Feed it the domain stream with `ingest` in tick
 * order (an event's tick is `emittedAt`; events of a tick may come before or after its frame); it keeps every
 * metric as of every tick and returns the signals each input raises.
 */
export class StatsEngine {
  readonly signals: Signal[] = []
  readonly events: DomainEvent[] = []
  /** Emission tick of each stored event (index-aligned with `events`). */
  readonly eventTicks: number[] = []
  protected readonly counters = new Counters()
  private readonly speeds = new Map<string, Series>()
  private readonly vmax = new Map<string, Series>()
  private readonly ballSpeed = new Series()
  private readonly recent = new Map<string, Pos[]>()
  private ballRecent: Pos[] = []
  private readonly sprints = new Map<string, Sprint>()
  private readonly alertBest = new Map<string, number>()
  private readonly teamByPlayer = new Map<string, TeamInfo>()
  private readonly teamById = new Map<string, TeamInfo>()
  private readonly speedWindow: number
  private readonly ballWindow: number
  private lastFrameTick = -1
  private lastEventTick = -1
  private lastFrame: TrackFrame | null = null
  private readonly signalIds = new Set<string>()

  constructor(
    readonly info: MatchInfo,
    readonly models: StatsModels
  ) {
    for (const t of [info.home, info.away]) {
      this.teamById.set(t.id, t)
      for (const p of t.players) this.teamByPlayer.set(p.id, t)
    }
    this.speedWindow = Math.max(1, Math.round(0.5 / info.dt))
    this.ballWindow = Math.max(1, Math.round(0.2 / info.dt))
  }

  /** The latest tick ingested. */
  get now(): number {
    return Math.max(this.lastFrameTick, this.lastEventTick)
  }

  /** The frame of the latest tick ingested, if any. */
  get frame(): TrackFrame | null {
    return this.lastFrame
  }

  teamOf(playerId: string): TeamInfo | undefined {
    return this.teamByPlayer.get(playerId)
  }

  team(teamId: string): TeamInfo | undefined {
    return this.teamById.get(teamId)
  }

  ticks(seconds: number): number {
    return Math.round(seconds / this.info.dt)
  }

  ingest(input: StatsInput): ReadonlyArray<Signal> {
    const before = this.signals.length
    if (input.kind === "frame") {
      const f = input.frame
      if (f.tick <= this.lastFrameTick || f.tick < this.lastEventTick)
        throw new StatsError(`input out of order: frame ${f.tick} after frame ${this.lastFrameTick} and events of tick ${this.lastEventTick}`)
      this.lastFrameTick = f.tick
      this.lastFrame = f
      this.onFrame(f)
    } else {
      const e = input.event
      const tick = emittedAt(e)
      if (tick < this.lastFrameTick) throw new StatsError(`input out of order: event ${e.id} (tick ${tick}) after frame ${this.lastFrameTick}`)
      this.lastEventTick = Math.max(this.lastEventTick, tick)
      this.events.push(e)
      this.eventTicks.push(tick)
      this.onEvent(e, tick)
    }
    return this.signals.slice(before)
  }

  protected onEvent(_e: DomainEvent, _tick: number): void {}

  protected onFrame(f: TrackFrame): void {
    const dt = this.info.dt
    const present = new Set<string>()
    for (const side of ["home", "away"] as const) {
      const team = side === "home" ? this.info.home : this.info.away
      for (const p of side === "home" ? f.home : f.away) {
        present.add(p.id)
        let hist = this.recent.get(p.id) ?? []
        const prev = hist[hist.length - 1]
        const contiguous = prev !== undefined && prev.tick === f.tick - 1 && prev.period === f.period
        if (contiguous) {
          const d = Math.hypot(p.x - prev.x, p.y - prev.y)
          if (d / dt <= MAX_RUN_MS) {
            const total = this.counters.total("dist", p.id, f.tick) + d
            this.counters.add("dist", p.id, f.tick, d)
            this.counters.add("dist", team.id, f.tick, d)
            for (const m of DISTANCE_MILESTONES_M)
              if (total >= m && total - d < m)
                this.raise("distance_milestone", f, { team_id: team.id, player_id: p.id, metric: "plyr.dist", value: m, frame_from: f.tick, frame_to: f.tick, salience: m >= 12_000 ? 0.3 : 0.15, evidence: [`plyr.dist@0-${f.tick}`], data: { "plyr.dist": Math.round(total) } })
          }
        } else hist = []
        hist.push({ tick: f.tick, period: f.period, x: p.x, y: p.y, z: 0 })
        if (hist.length > this.speedWindow + 1) hist.shift()
        this.recent.set(p.id, hist)
        const kmh = hist.length === this.speedWindow + 1 ? (Math.hypot(p.x - hist[0]!.x, p.y - hist[0]!.y) / (this.speedWindow * dt)) * 3.6 : null
        if (kmh !== null && kmh <= MAX_RUN_MS * 3.6) this.onSpeed(p.id, team, f, kmh)
        else this.endSprint(p.id, team, f)
      }
    }
    for (const [id] of this.sprints) if (!present.has(id)) this.endSprint(id, this.teamByPlayer.get(id)!, f)

    const prevBall = this.ballRecent[this.ballRecent.length - 1]
    if (!prevBall || prevBall.tick !== f.tick - 1 || prevBall.period !== f.period) this.ballRecent = []
    this.ballRecent.push({ tick: f.tick, period: f.period, x: f.ball.x, y: f.ball.y, z: f.ball.z })
    if (this.ballRecent.length > this.ballWindow + 1) this.ballRecent.shift()
    if (this.ballRecent.length === this.ballWindow + 1) {
      const a = this.ballRecent[0]!
      const kmh = (Math.hypot(f.ball.x - a.x, f.ball.y - a.y, f.ball.z - a.z) / (this.ballWindow * dt)) * 3.6
      if (kmh <= MAX_BALL_KMH) this.ballSpeed.push(f.tick, kmh)
    }

    if (f.ball_in_play) {
      this.counters.add("inplay", "match", f.tick, 1)
      if (f.possession_side) this.counters.add("poss", (f.possession_side === "home" ? this.info.home : this.info.away).id, f.tick, 1)
    }
  }

  private onSpeed(id: string, team: TeamInfo, f: TrackFrame, kmh: number): void {
    let s = this.speeds.get(id)
    if (!s) this.speeds.set(id, (s = new Series()))
    s.push(f.tick, kmh)
    let m = this.vmax.get(id)
    if (!m) this.vmax.set(id, (m = new Series()))
    if (kmh > m.last(-1)) m.push(f.tick, kmh)
    const sprint = this.sprints.get(id)
    if (kmh > SPRINT_KMH) {
      if (sprint) {
        sprint.peak = Math.max(sprint.peak, kmh)
        sprint.to = f.tick
      } else this.sprints.set(id, { from: f.tick, peak: kmh, to: f.tick })
    } else this.endSprint(id, team, f)
  }

  /** A sprint over 30 km/h has ended: alert if it beats the player's last alert by 0.5 km/h. */
  private endSprint(id: string, team: TeamInfo, f: TrackFrame): void {
    const sprint = this.sprints.get(id)
    if (!sprint) return
    this.sprints.delete(id)
    const best = this.alertBest.get(id)
    if (best !== undefined && sprint.peak < best + SPRINT_ALERT_STEP_KMH) return
    this.alertBest.set(id, sprint.peak)
    const peak = Math.round(sprint.peak * 10) / 10
    this.raise("speed_alert", f, {
      team_id: team.id, player_id: id, metric: "plyr.vmax", value: peak, frame_from: sprint.from, frame_to: sprint.to,
      salience: Math.min(0.5, 0.2 + (sprint.peak - SPRINT_KMH) / 10), evidence: [`plyr.vmax@${sprint.from}-${sprint.to}`], data: { "plyr.vmax": peak, ...(best !== undefined ? { previous_best: Math.round(best * 10) / 10 } : {}) }
    })
  }

  /** Record a signal at the tick of `at` (a frame, or an event's own period and clock). */
  protected raise(
    type: SignalType,
    at: { readonly tick: number; readonly period: "first_half" | "second_half"; readonly frame_id: number } | DomainEvent,
    s: Pick<Signal, "team_id" | "player_id" | "metric" | "value" | "frame_from" | "frame_to" | "salience" | "evidence" | "data">
  ): void {
    const isEvent = "match_clock" in at
    const tick = isEvent ? emittedAt(at) : at.tick
    const clock = isEvent ? at.match_clock : matchClock(at.period, at.frame_id, this.info.dt)
    // Ids depend on what the signal is about, not on arrival order within a tick, so live and replayed runs agree.
    let id = `${this.info.matchId}-${type}-${tick}-${s.player_id ?? s.team_id ?? "match"}`
    for (let n = 2; this.signalIds.has(id); n++) id = `${this.info.matchId}-${type}-${tick}-${s.player_id ?? s.team_id ?? "match"}-${n}`
    this.signalIds.add(id)
    this.signals.push({ id, match_id: this.info.matchId, type, frame_id: tick, period: at.period, match_clock: clock, ...s })
  }

  subjectKind(subject: string): SubjectKind {
    if (subject === "match") return "match"
    if (this.teamById.has(subject)) return "team"
    if (this.teamByPlayer.has(subject)) return "player"
    throw new StatsError(`unknown subject "${subject}": expected "match", a team id or a player id`)
  }

  /** The window start for a query: null for the match so far. */
  protected windowFrom(id: MetricId, at: number, windowS: number | null | undefined): number | null {
    const def = metricDef(id)!
    const w = def.windowed ? (windowS === undefined ? def.defaultWindowS : windowS) : null
    return w === null ? null : at - this.ticks(w)
  }

  /**
   * A metric's value for a subject ("match", a team id or a player id) as of a tick, or null when there is no
   * data yet (no passes, no in-play time). Throws StatsError when the metric is not defined for the subject.
   */
  value(id: MetricId, subject: string, opts: QueryOptions = {}): number | null {
    const def = metricDef(id)
    if (!def) throw new StatsError(`unknown metric "${id}"`)
    const kind = this.subjectKind(subject)
    if (!def.subjects.includes(kind)) throw new StatsError(`${id} is not defined for a ${kind} (it is for: ${def.subjects.join(", ")})`)
    const at = Math.min(opts.at ?? this.now, this.now)
    const from = this.windowFrom(id, at, opts.windowS)
    return this.compute(id, subject, at, from)
  }

  protected compute(id: MetricId, subject: string, at: number, from: number | null): number | null {
    const ratio = (num: number, den: number) => (den > 0 ? num / den : null)
    switch (id) {
      case "plyr.dist":
        return this.counters.between("dist", subject, from, at)
      case "plyr.vmax": {
        if (from !== null) return maxBetween(this.speeds.get(subject), from, at)
        const v = this.vmax.get(subject)?.at(at, -1) ?? -1
        return v < 0 ? null : v
      }
      case "ball.speed": {
        const i = this.ballSpeed.indexAt(at)
        return i < 0 ? null : this.ballSpeed.values[i]!
      }
      case "team.poss":
        return ratio(this.counters.between("poss", subject, from, at), this.counters.between("inplay", "match", from, at))
      default:
        return null
    }
  }

  /** Ball speed (km/h) at each tick in (from, to], for event metrics such as shot speed. */
  protected ballSpeedMax(from: number, to: number): number | null {
    return maxBetween(this.ballSpeed, from, to)
  }
}

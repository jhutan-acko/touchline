import type { DomainEvent, MetricId, Signal, SignalType } from "@touchline/schema"
import { attackX, matchClock, PITCH } from "@touchline/sim-core"

const PITCH_HALF_L = PITCH.halfL
import { metricDef, type SubjectKind } from "./catalog.js"
import { passValues, shotXg } from "./derive.js"
import { emittedAt, type MatchInfo, type StatsInput, type TeamInfo, type TrackFrame } from "./input.js"
import type { StatsModels } from "./models.js"
import { Momentum, threatAt } from "./momentum.js"
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
/** Frames kept for looking up the frame at a pass's or shot's release (flights end within a few seconds). */
const FRAME_MEMORY_S = 30
/** A completed pass this unlikely (xPass) is a difficult pass (about the hardest 1 % of completed passes). */
export const DIFFICULT_PASS_XP = 0.55
/** A shot at least this likely to score (xG) is a big chance. */
export const BIG_CHANCE_XG = 0.3
/** Counts at which a player milestone is raised. */
/** Opponent passes behind this line (attacking x, i.e. in their own 60 % of the pitch) and defensive actions beyond it count for PPDA. */
export const PPDA_LINE_X = -PITCH_HALF_L + 0.6 * 2 * PITCH_HALF_L
/** Passes from beyond this line (attacking x) are in the final third. */
export const FINAL_THIRD_X = PITCH_HALF_L / 3
/** Team dynamics are evaluated every 10 s, over 5-minute windows. */
export const DYNAMICS_EVERY_S = 10
export const DYNAMICS_WINDOW_S = 300
/** A team's signal of one kind is not repeated within this time. */
export const SIGNAL_COOLDOWN_S = 300
export const PRESSURE_SHIFT = { rise: 0.15, minPressures: 10 } as const
/** A shot adds this many times its xG to its team's momentum (passes and carries add their gain in threat). */
export const MOMENTUM_SHOT_WEIGHT = 3
/** A momentum swing: the team's mean momentum share over 5 minutes rises this much over the previous 5, to at least `level`. */
export const MOMENTUM_SWING = { level: 0.55, rise: 0.2 } as const
export const CHAOS_SPIKE = { level: 0.7, rise: 0.2 } as const
/** Scales of the chaos components (each component is capped at 1). */
export const CHAOS_SCALE = { turnoversPerMin: 6, passesPerPossession: 9, momentumSd: 0.3 } as const
/** Substitution impact compares the team's momentum share over 10 minutes before and after. */
export const SUB_IMPACT = { windowS: 600, change: 0.15 } as const
export const PLAYER_MILESTONES: Readonly<Record<string, ReadonlyArray<number>>> = { passes_completed: [50, 75, 100], goals: [2, 3], tackles_won: [5] }

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
  /** Values the engine derived for each pass and shot (pass.dist, pass.xp, shot.xg, shot.speed), by event id. */
  readonly derived = new Map<string, Readonly<Record<string, number>>>()
  readonly score = { home: 0, away: 0 }
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
  private readonly frames = new Map<number, TrackFrame>()
  private readonly tallies = new Map<string, Map<string, number>>()
  private readonly momentum: Momentum
  /** The home team's momentum share, sampled every 10 s (the away share is 1 minus it). */
  private readonly momSamples = new Series()
  private readonly lastSignal = new Map<string, number>()
  /** A frame whose 10-second checks run once every input of its tick is in (see ingest). */
  private pendingDynamics: TrackFrame | null = null
  /** Substitutions awaiting their impact check; a team's changes at the same moment are judged together. */
  private readonly pendingSubs: Array<{ readonly team: TeamInfo; readonly tick: number; readonly events: DomainEvent[] }> = []

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
    this.momentum = new Momentum(info.dt)
  }

  opponentOf(team: TeamInfo): TeamInfo {
    return team.side === "home" ? this.info.away : this.info.home
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
    // A tick's team-dynamics checks wait until the next tick starts, so events arriving after the frame count too.
    const tick = input.kind === "frame" ? input.frame.tick : emittedAt(input.event)
    if (this.pendingDynamics && tick > this.pendingDynamics.tick) this.flushDynamics()
    if (input.kind === "frame") {
      const f = input.frame
      if (f.tick <= this.lastFrameTick || f.tick < this.lastEventTick)
        throw new StatsError(`input out of order: frame ${f.tick} after frame ${this.lastFrameTick} and events of tick ${this.lastEventTick}`)
      this.lastFrameTick = f.tick
      this.lastFrame = f
      this.frames.set(f.tick, f)
      this.frames.delete(f.tick - this.ticks(FRAME_MEMORY_S))
      this.onFrame(f)
    } else {
      const e = input.event
      if (tick < this.lastFrameTick) throw new StatsError(`input out of order: event ${e.id} (tick ${tick}) after frame ${this.lastFrameTick}`)
      this.lastEventTick = Math.max(this.lastEventTick, tick)
      this.events.push(e)
      this.eventTicks.push(tick)
      this.onEvent(e, tick)
    }
    return this.signals.slice(before)
  }

  /** Run the checks still pending for the last tick; call once the stream ends. */
  finish(): ReadonlyArray<Signal> {
    const before = this.signals.length
    this.flushDynamics()
    return this.signals.slice(before)
  }

  private flushDynamics(): void {
    const f = this.pendingDynamics
    this.pendingDynamics = null
    if (f) this.dynamics(f)
  }

  protected onEvent(e: DomainEvent, tick: number): void {
    const team = e.team_id === null ? undefined : this.teamById.get(e.team_id)
    switch (e.type) {
      case "pass":
        if (team) this.onPass(e, tick, team)
        break
      case "shot":
        if (team) this.onShot(e, tick, team)
        break
      case "goal":
        if (team) this.onGoal(e, team)
        break
      case "card": {
        const red = e.attrs.colour !== "yellow"
        this.raise("card", e, {
          team_id: e.team_id, player_id: e.player_id, metric: null, value: null, frame_from: e.frame_id, frame_to: e.frame_id,
          salience: red ? 0.9 : 0.5, evidence: [e.id], data: { red: red ? 1 : 0 }
        })
        break
      }
      case "tackle":
        if (e.player_id && e.outcome === "won") this.tally(e, "tackles_won")
        // A foul in a tackle is also a foul event; count it once.
        if (team && e.outcome !== "foul") this.defensiveAction(e, tick, team)
        break
      case "interception":
      case "foul":
        if (team) this.defensiveAction(e, tick, team)
        break
      case "pressure":
        if (team) this.counters.add("pressures", team.id, tick, 1)
        break
      case "carry":
        if (team && e.x !== null && e.y !== null && e.x_end !== null && e.y_end !== null) this.addThreat(team, tick, e.x, e.y, e.x_end, e.y_end)
        break
      case "possession_change":
        this.counters.add("turnovers", "match", tick, 1)
        break
      case "substitution":
        if (team) {
          const same = this.pendingSubs.find((p) => p.team === team && p.tick === tick)
          if (same) same.events.push(e)
          else this.pendingSubs.push({ team, tick, events: [e] })
        }
        break
    }
  }

  private onPass(e: DomainEvent, tick: number, team: TeamInfo): void {
    const v = passValues(e, this.frames.get(e.frame_id), team.side, this.models)
    if (!v) return
    this.derived.set(e.id, v["pass.xp"] === null ? { "pass.dist": v["pass.dist"] } : { "pass.dist": v["pass.dist"], "pass.xp": v["pass.xp"] })
    const ok = e.outcome === "successful"
    for (const subject of [e.player_id, team.id]) {
      if (subject === null) continue
      this.counters.add("passes", subject, tick, 1)
      this.counters.add("pass_len", subject, tick, v["pass.dist"])
      if (ok) this.counters.add("passes_ok", subject, tick, 1)
      if (v["pass.xp"] !== null) {
        this.counters.add("xp_sum", subject, tick, v["pass.xp"])
        this.counters.add("xp_n", subject, tick, 1)
      }
    }
    if (ok && v["pass.xp"] !== null && v["pass.xp"] < DIFFICULT_PASS_XP) {
      const xp = Math.round(v["pass.xp"] * 1000) / 1000
      this.raise("difficult_pass_completed", e, {
        team_id: team.id, player_id: e.player_id, metric: "pass.xp", value: xp, frame_from: e.frame_id, frame_to: tick,
        salience: Math.min(0.6, 0.25 + (DIFFICULT_PASS_XP - v["pass.xp"])), evidence: [e.id], data: { "pass.xp": xp, "pass.dist": Math.round(v["pass.dist"] * 10) / 10 }
      })
    }
    if (ok && e.player_id) this.tally(e, "passes_completed")
    const ax = attackX(team.side, e.x!)
    if (ax < PPDA_LINE_X) this.counters.add("ppda_passes", this.opponentOf(team).id, tick, 1)
    if (ax > FINAL_THIRD_X) this.counters.add("final_third", team.id, tick, 1)
    if (ok) this.addThreat(team, tick, e.x!, e.y!, e.x_end!, e.y_end!)
  }

  /** A tackle, interception or foul in the opponent's own 60 % of the pitch counts for PPDA. */
  private defensiveAction(e: DomainEvent, tick: number, team: TeamInfo): void {
    if (e.x !== null && attackX(team.side, e.x) > -PPDA_LINE_X) this.counters.add("ppda_actions", team.id, tick, 1)
  }

  private addThreat(team: TeamInfo, tick: number, x: number, y: number, xEnd: number, yEnd: number): void {
    const attack = team.side === "home" ? 1 : -1
    this.momentum.add(team.id, tick, threatAt(xEnd, yEnd, attack) - threatAt(x, y, attack))
  }

  private onShot(e: DomainEvent, tick: number, team: TeamInfo): void {
    const xg = shotXg(e, this.frames.get(e.frame_id), team.side, this.models)
    if (xg === null) return
    // Peak ball speed in the 0.3 s after the strike (frames up to the shot's resolution).
    const speed = this.ballSpeedMax(e.frame_id, Math.min(e.frame_id + this.ticks(0.3), tick))
    this.derived.set(e.id, speed === null ? { "shot.xg": xg } : { "shot.xg": xg, "shot.speed": speed })
    this.momentum.add(team.id, tick, MOMENTUM_SHOT_WEIGHT * xg)
    for (const subject of [e.player_id, team.id]) {
      if (subject === null) continue
      this.counters.add("shots", subject, tick, 1)
      this.counters.add("xg", subject, tick, xg)
      if (speed !== null) {
        this.counters.add("shot_speed", subject, tick, speed)
        this.counters.add("shot_speed_n", subject, tick, 1)
      }
    }
    if (xg >= BIG_CHANCE_XG && e.outcome !== "goal") {
      const v = Math.round(xg * 1000) / 1000
      this.raise("big_chance", e, {
        team_id: team.id, player_id: e.player_id, metric: "shot.xg", value: v, frame_from: e.frame_id, frame_to: tick,
        salience: Math.min(0.9, 0.4 + 0.6 * xg), evidence: [e.id], data: { "shot.xg": v }
      })
    }
  }

  private onGoal(e: DomainEvent, team: TeamInfo): void {
    this.score[team.side]++
    // The shot that scored is the last shot by this team with outcome "goal" (none for an own goal or a loose ball).
    let shot: DomainEvent | undefined
    for (let i = this.events.length - 2; i >= 0 && i >= this.events.length - 6; i--) {
      const c = this.events[i]!
      if (c.type === "shot" && c.outcome === "goal" && c.team_id === team.id) {
        shot = c
        break
      }
    }
    const xg = shot ? (this.derived.get(shot.id)?.["shot.xg"] ?? null) : null
    this.raise("goal", e, {
      team_id: team.id, player_id: e.player_id, metric: xg === null ? null : "shot.xg", value: xg === null ? null : Math.round(xg * 1000) / 1000,
      frame_from: shot?.frame_id ?? e.frame_id, frame_to: e.frame_id, salience: 1, evidence: shot ? [shot.id, e.id] : [e.id],
      data: { home: this.score.home, away: this.score.away, own_goal: e.attrs.own_goal === true ? 1 : 0 }
    })
    if (e.attrs.own_goal !== true && e.player_id) this.tally(e, "goals")
  }

  /** Count a player's passes completed, goals and tackles won, raising a milestone at the listed counts. */
  private tally(e: DomainEvent, what: keyof typeof PLAYER_MILESTONES): void {
    const id = e.player_id!
    let t = this.tallies.get(id)
    if (!t) this.tallies.set(id, (t = new Map()))
    const n = (t.get(what) ?? 0) + 1
    t.set(what, n)
    if (!PLAYER_MILESTONES[what]!.includes(n)) return
    this.raise("player_milestone", e, {
      team_id: e.team_id, player_id: id, metric: what === "passes_completed" ? "pass.acc" : null,
      value: what === "passes_completed" ? this.value("pass.acc", id, { at: emittedAt(e) }) : null,
      frame_from: e.frame_id, frame_to: e.frame_id, salience: what === "goals" ? 0.8 : 0.3, evidence: [e.id], data: { [what]: n }
    })
  }

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
    if (f.tick % this.ticks(DYNAMICS_EVERY_S) === 0) this.pendingDynamics = f
  }

  private cooledDown(key: string, tick: number): boolean {
    const last = this.lastSignal.get(key)
    return last === undefined || tick - last >= this.ticks(SIGNAL_COOLDOWN_S)
  }

  /** Every 10 s: sample momentum, then check for pressure shifts, momentum swings, chaos spikes and substitution impact. */
  private dynamics(f: TrackFrame): void {
    const t = f.tick
    const w = this.ticks(DYNAMICS_WINDOW_S)
    const home = this.momentum.share(this.info.home.id, this.info.away.id, t)
    if (home !== null) this.momSamples.push(t, home)
    const r3 = (v: number) => Math.round(v * 1000) / 1000

    for (const team of [this.info.home, this.info.away]) {
      if (t - w < 0) break
      const now = this.compute("team.press", team.id, t, t - w)
      const before = this.compute("team.press", team.id, t - w, t - 2 * w)
      const pressures = this.counters.between("pressures", team.id, t - w, t)
      if (now !== null && before !== null && pressures >= PRESSURE_SHIFT.minPressures && now - before >= PRESSURE_SHIFT.rise && this.cooledDown(`press|${team.id}`, t)) {
        this.lastSignal.set(`press|${team.id}`, t)
        this.raise("pressure_shift", f, {
          team_id: team.id, player_id: null, metric: "team.press", value: r3(now), frame_from: t - w, frame_to: t,
          salience: Math.min(0.9, 0.5 + (now - before)), evidence: [`team.press@${t - w}-${t}`], data: { before: r3(before), after: r3(now), pressures }
        })
      }
    }

    if (t - w >= 0)
      for (const team of [this.info.home, this.info.away]) {
        const now = this.compute("team.mom", team.id, t, t - w)
        const before = this.compute("team.mom", team.id, t - w, t - 2 * w)
        if (now !== null && before !== null && now >= MOMENTUM_SWING.level && now - before >= MOMENTUM_SWING.rise && this.cooledDown(`mom|${team.id}`, t)) {
          this.lastSignal.set(`mom|${team.id}`, t)
          this.raise("momentum_swing", f, {
            team_id: team.id, player_id: null, metric: "team.mom", value: r3(now), frame_from: t - w, frame_to: t,
            salience: Math.min(0.8, 0.4 + (now - before)), evidence: [`team.mom@${t - w}-${t}`], data: { before: r3(before), after: r3(now) }
          })
        }
      }

    if (t - w >= 0) {
      const chaos = this.chaosAt(t)
      const before = this.chaosAt(t - w)
      if (chaos !== null && before !== null && chaos >= CHAOS_SPIKE.level && chaos - before >= CHAOS_SPIKE.rise && this.cooledDown("chaos", t)) {
        this.lastSignal.set("chaos", t)
        this.raise("chaos_spike", f, {
          team_id: null, player_id: null, metric: "game.chaos", value: r3(chaos), frame_from: t - w, frame_to: t,
          salience: 0.5, evidence: [`game.chaos@${t - w}-${t}`], data: { before: r3(before), after: r3(chaos) }
        })
      }
    }

    const sw = this.ticks(SUB_IMPACT.windowS)
    for (let i = 0; i < this.pendingSubs.length; i++) {
      const sub = this.pendingSubs[i]!
      if (t < sub.tick + sw) continue
      this.pendingSubs.splice(i--, 1)
      const mean = (from: number, to: number) => {
        let sum = 0
        let n = 0
        for (let j = this.momSamples.indexAt(to); j >= 0 && this.momSamples.ticks[j]! > from; j--) {
          sum += sub.team.side === "home" ? this.momSamples.values[j]! : 1 - this.momSamples.values[j]!
          n++
        }
        return n ? sum / n : null
      }
      const before = mean(sub.tick - sw, sub.tick)
      const after = mean(sub.tick, sub.tick + sw)
      if (before === null || after === null || Math.abs(after - before) < SUB_IMPACT.change) continue
      const on = typeof sub.events[0]!.attrs.player_on === "string" ? sub.events[0]!.attrs.player_on : null
      this.raise("substitution_impact", f, {
        team_id: sub.team.id, player_id: on, metric: "team.mom", value: r3(after - before), frame_from: sub.tick, frame_to: t,
        salience: Math.min(0.8, 0.4 + Math.abs(after - before)), evidence: [...sub.events.map((e) => e.id), `team.mom@${sub.tick - sw}-${sub.tick + sw}`], data: { before: r3(before), after: r3(after), substitutions: sub.events.length }
      })
    }
  }

  /**
   * Control vs chaos over the 5 minutes to `at`: turnovers per minute, passes per possession (fewer is more
   * chaotic) and the spread of the momentum share, each scaled to 0..1 and averaged. Null in the first minute.
   */
  chaosAt(at: number): number | null {
    const w = this.ticks(DYNAMICS_WINDOW_S)
    const from = Math.max(-1, at - w)
    const minutes = ((at - from) * this.info.dt) / 60
    if (minutes < 1) return null
    const turnovers = this.counters.between("turnovers", "match", from, at)
    const passes = this.counters.between("passes", this.info.home.id, from, at) + this.counters.between("passes", this.info.away.id, from, at)
    const samples: number[] = []
    for (let i = this.momSamples.indexAt(at); i >= 0 && this.momSamples.ticks[i]! > from; i--) samples.push(this.momSamples.values[i]!)
    const mean = samples.reduce((a, b) => a + b, 0) / Math.max(1, samples.length)
    const sd = samples.length > 1 ? Math.sqrt(samples.reduce((a, v) => a + (v - mean) ** 2, 0) / samples.length) : 0
    const c1 = Math.min(1, turnovers / minutes / CHAOS_SCALE.turnoversPerMin)
    const c2 = 1 - Math.min(1, passes / Math.max(1, turnovers) / CHAOS_SCALE.passesPerPossession)
    const c3 = Math.min(1, sd / CHAOS_SCALE.momentumSd)
    return (c1 + c2 + c3) / 3
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
      case "pass.dist":
        return ratio(this.counters.between("pass_len", subject, from, at), this.counters.between("passes", subject, from, at))
      case "pass.acc":
        return ratio(this.counters.between("passes_ok", subject, from, at), this.counters.between("passes", subject, from, at))
      case "pass.xp":
        return ratio(this.counters.between("xp_sum", subject, from, at), this.counters.between("xp_n", subject, from, at))
      case "shot.xg":
        return this.counters.between("xg", subject, from, at)
      case "shot.speed":
        return ratio(this.counters.between("shot_speed", subject, from, at), this.counters.between("shot_speed_n", subject, from, at))
      case "team.press": {
        const opp = this.opponentOf(this.teamById.get(subject)!)
        const p = this.counters.between("pressures", subject, from, at)
        return ratio(p, p + this.counters.between("passes", opp.id, from, at))
      }
      case "ppda":
        return ratio(this.counters.between("ppda_passes", subject, from, at), this.counters.between("ppda_actions", subject, from, at))
      case "tilt": {
        const opp = this.opponentOf(this.teamById.get(subject)!)
        const own = this.counters.between("final_third", subject, from, at)
        return ratio(own, own + this.counters.between("final_third", opp.id, from, at))
      }
      case "team.mom": {
        const home = subject === this.info.home.id
        if (from === null) return this.momentum.share(subject, this.opponentOf(this.teamById.get(subject)!).id, at)
        // Over a window: the mean of the 10-second samples.
        let sum = 0
        let n = 0
        for (let i = this.momSamples.indexAt(at); i >= 0 && this.momSamples.ticks[i]! > from; i--) {
          sum += home ? this.momSamples.values[i]! : 1 - this.momSamples.values[i]!
          n++
        }
        return n ? sum / n : null
      }
      case "game.chaos":
        return this.chaosAt(at)
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

import { stepBall } from "./ball.js"
import { decide, lastDefenderAttackX, nearestOpponent, overridePass, type Decision } from "./decide.js"
import { buildEvent, round2 } from "./events.js"
import { behindPoint, clearAway, crossBlocker, DEFLECT_SPEED, deflectLoose, inOwnBox, keeperAction, keeperCanCome } from "./deflect.js"
import { executeKick, pressureFrom } from "./execute.js"
import { keeperInHands } from "./keeper.js"
import { loadAfter, relaxedSpeed, tiringFactor } from "./kinematics.js"
import { scoringFactor } from "./gamestate.js"
import {
  add,
  attackX,
  clampToPitch,
  dirOf,
  dist,
  inPitch,
  len,
  norm,
  other,
  type Period,
  PITCH,
  scale,
  sideAttacking,
  sub,
  type Side,
  type Vec2,
  type Vec3
} from "./geometry.js"
import { assignMarks, markTarget, shieldTarget, spacedTarget, spacingFor, steerCarry, supportersWanted, supportGate, supportSpot } from "./offball.js"
import { approach, approachBy, drainEnergy, interceptPoint, motionFor, separation, vmaxFor } from "./kinematics.js"
import type { Action, Params } from "./params.js"
import { goalLineCrossing, keeperLetsRun, MAX_FLIGHT_S, resolveFlight, type Resolution } from "./resolve.js"
import { hazard, Rng, substream } from "./rng.js"
import { MAX_SUBS, MAX_SUB_WINDOWS, type SubOrder } from "./orders.js"
import { anchorFor, kickoffAnchor } from "./shape.js"
import { countGoal, inWindow, modsFor, outstandingForces, type Mods, type ScenarioEffect, type ScriptEntry } from "./script.js"
import { parryBall, planShot, type ShotMods } from "./shot.js"
import { ballAfterTouch, drawFirstTouch, firstTouchError, type FirstTouch } from "./touch.js"
import {
  CONCERNS,
  type AnchorState,
  type AttrValue,
  type BallState,
  type Concern,
  type DomainEvent,
  type Flight,
  type FlightFoul,
  type FoulKind,
  type Frame,
  type MatchConfig,
  type MatchState,
  type PassOverride,
  type PendingEvent,
  type Phase,
  type PlayerState,
  type Possession,
  type PressState,
  type RestartKind,
  type PlayerSetup,
  type Role,
  type StepResult,
  type SubsState,
  type SupportGate,
  type TeamSetup,
  type TransitionState
} from "./types.js"
import { advanceRows, blendFor, commitSide, holdBall, initAnchorState, lagBall, outShare, rowFor, settled, slotGeometry, type Blend, type SlotGeometry } from "./anchor.js"
import { advanceDrift, driftFor } from "./drift.js"
import type { PosGroup, ShapeRow } from "./params.js"
import { FORMATIONS } from "./shape.js"
// ---- P3 imports, boot-block seam (plan 8c Task 3; plan 8d Task 9 inserts below this line)
import { bootBlocker } from "./deflect.js"

// ---- P3 imports, release seam (plan 8c Task 4; plan 8d Task 9 inserts below this line)
import { releaseDelayS } from "./release.js"

// ---- P4 imports, tackle seam (plan 8d Task 3 inserts below this line)

// ---- P4 imports, foul seam (plan 8d Task 4 inserts below this line)

// ---- P4 imports, aerial seam (plan 8d Task 5 inserts below this line)

// ---- P4 imports, transition seam (plan 8d Task 6 inserts below this line)

// ---- P4 imports, team-press seam (plan 8d Task 7 inserts below this line)

// ---- P4 imports, marking seam (plan 8d Task 8 inserts below this line)

const HALF_TIME_MS = 15 * 60 * 1000
/** Seconds in 90 minutes, the match length that per-match rates such as cautionPerMatch are spread over. */
const MATCH_SECONDS_90 = 5400
const OUTCOME_IN_ATTRS: ReadonlySet<string> = new Set(["take_on", "tackle"])

const teamOf = (cfg: MatchConfig, side: Side): TeamSetup => (side === "home" ? cfg.home : cfg.away)

/** A team whose manager decides its substitutions (no automatic ones). */
const isManaged = (cfg: MatchConfig, side: Side): boolean => cfg.managed?.includes(side) ?? false

const samplePeriodTicks = (cfg: MatchConfig, rng: Rng): number => {
  const [lo, hi] = cfg.params.timing.addedTimeMinS
  return Math.round((45 * 60 + rng.range(lo, hi)) / cfg.dt)
}

const kickoffPlayers = (cfg: MatchConfig): PlayerState[] => {
  const out: PlayerState[] = []
  for (const side of ["home", "away"] as const) {
    const team = teamOf(cfg, side)
    team.starters.forEach((pl, slot) => {
      out.push({
        id: pl.id,
        side,
        role: pl.role,
        slot,
        jersey: pl.jersey,
        attrs: pl.attrs,
        foot: pl.preferredFoot ?? "right",
        pos: kickoffAnchor(team.formation, slot, side, "first_half", team.style),
        vel: { x: 0, y: 0 },
        intent: { kind: "shape" },
        intentUntil: 0,
        energy: 1,
        yellow: 0,
        sentOff: false
      })
    })
  }
  return out
}

/** Planned substitution windows for one team (none without a bench). */
const planSubs = (cfg: MatchConfig, side: Side, rng: Rng): SubsState => {
  const s = cfg.params.substitutions
  const bench = teamOf(cfg, side).bench ?? []
  const plan = bench.length === 0
    ? []
    : s.windowMinutes
        .map((m, i) => ({ minute: Math.max(46, m + rng.normal() * s.windowSdMin), players: s.perWindow[i]!, used: rng.chance(s.windowChance[i]!) }))
        .filter((x) => x.used)
        .map(({ minute, players }) => ({ minute, players }))
        .sort((a, b) => a.minute - b.minute)
  return { plan, made: 0, windows: 0, used: [] }
}

/** Initial state: tick -1, so the first step emits frame 0 of the first half. */
export const initMatch = (cfg: MatchConfig): MatchState => {
  const ids = [...cfg.home.starters, ...cfg.away.starters].map((p) => p.id)
  const dup = ids.find((id, i) => ids.indexOf(id) !== i)
  if (dup !== undefined) throw new Error(`duplicate player id "${dup}": home and away must be different teams`)
  const rng = {} as Record<Concern, ReturnType<typeof substream>>
  for (const c of CONCERNS) rng[c] = substream(cfg.seed, c)
  const timing = new Rng(rng.restart)
  const periodTicks = samplePeriodTicks(cfg, timing)
  rng.restart = timing.state
  const benchRng = new Rng(rng.bench)
  const subs = { home: planSubs(cfg, "home", benchRng), away: planSubs(cfg, "away", benchRng) }
  rng.bench = benchRng.state
  return {
    config: cfg,
    tick: -1,
    period: "first_half",
    periodTick: -1,
    periodTicks,
    periodStartMs: Date.parse(cfg.kickoffTime),
    phase: { kind: "restart", restart: "kickoff", side: "home", at: { x: 0, y: 0 }, resumeTick: 0 },
    ball: { pos: { x: 0, y: 0, z: 0 }, vel: { x: 0, y: 0, z: 0 } },
    possession: { kind: "dead" },
    players: kickoffPlayers(cfg),
    score: { home: 0, away: 0 },
    lastTouch: null,
    pressedBy: [],
    carry: null,
    subs,
    forced: [],
    scriptGoals: (cfg.script?.entries ?? []).map(() => 0),
    rng,
    eventSeq: 0
  }
}

/** @internal The working copy type, for P4 seam tests (see workAt). */
export type { Work }

export const isFinished = (s: MatchState): boolean => s.phase.kind === "full_time"

/** Mutable working copy for one step. Nothing outside step() sees it, except P4 seam tests through workAt. */
class Work {
  readonly cfg: MatchConfig
  tick: number
  period: MatchState["period"]
  periodTick: number
  periodTicks: number
  periodStartMs: number
  periodStartTick: number
  phase: Phase
  ball: BallState
  possession: Possession
  players: PlayerState[]
  score: { home: number; away: number }
  lastTouch: MatchState["lastTouch"]
  pressedBy: string[]
  carry: MatchState["carry"]
  subs: Record<Side, SubsState>
  forced: ScriptEntry[]
  scriptGoals: number[]
  override: PassOverride | null
  subOrders: Partial<Record<Side, ReadonlyArray<SubOrder>>>
  /** The step after the half-time break's pause (the state was the second-half kickoff, before play). */
  readonly halfTimeBreak: boolean
  rng: Record<Concern, Rng>
  seq: number
  events: DomainEvent[] = []
  /** Positioning state (P2); absent while positioning.rule is 0. */
  anchor: AnchorState | undefined
  /** Recent high-intensity metres per player (P2, F1); absent while fatigue.tiring is 0. */
  load: Record<string, number> | undefined
  /** Support rule 1 pressure gate (P3 Task 10d); absent while support.rule is 0 or nobody has the ball. */
  supportGate: SupportGate | undefined
  /** A4 transition after the last live-play loss (P4); absent while transition.rule is 0 or none is live. */
  transition: TransitionState | undefined
  /** A5 team-press state (P4); absent while press.rule is 0. */
  press: PressState | undefined

  constructor(s: MatchState) {
    this.cfg = s.config
    this.tick = s.tick + 1
    this.period = s.period
    this.periodTick = s.periodTick + 1
    this.periodTicks = s.periodTicks
    this.periodStartMs = s.periodStartMs
    this.periodStartTick = s.tick - s.periodTick
    this.phase = s.phase
    this.ball = s.ball
    this.possession = s.possession
    this.players = [...s.players]
    this.score = { ...s.score }
    this.lastTouch = s.lastTouch
    this.pressedBy = [...s.pressedBy]
    this.carry = s.carry
    this.subs = { ...s.subs }
    // A forced outcome lives only inside its window (judged at the state's minute, as the scenario runner does):
    // a state taken inside a forced window plays on past the window exactly as the accepted run did.
    const minute = (s.period === "first_half" ? 0 : 45) + (Math.max(0, s.periodTick) * s.config.dt) / 60
    this.forced = s.forced.filter((f) => inWindow(f.window, minute, s.period))
    this.scriptGoals = [...s.scriptGoals]
    // A what-if override lives for its tick only: if the player has no decision to make then, it lapses.
    this.override = s.override && this.tick <= s.override.untilTick ? s.override : null
    this.subOrders = { ...s.subOrders }
    this.halfTimeBreak = s.period === "second_half" && s.periodTick === 0
    this.rng = {} as Record<Concern, Rng>
    // A state saved before a stream existed has none: derive it from the seed. Nothing drew from it, so it is exact.
    for (const c of CONCERNS) this.rng[c] = new Rng(s.rng[c] ?? substream(s.config.seed, c))
    this.seq = s.eventSeq
    this.anchor = s.anchor
    this.load = s.load ? { ...s.load } : undefined
    this.supportGate = s.supportGate
    this.transition = s.transition
    this.press = s.press
  }

  get p() {
    return this.cfg.params
  }
  get dt() {
    return this.cfg.dt
  }
  player(id: string): PlayerState {
    const pl = this.players.find((x) => x.id === id)
    if (!pl) throw new Error(`unknown player ${id}`)
    return pl
  }
  setPlayer(next: PlayerState): void {
    const i = this.players.findIndex((x) => x.id === next.id)
    this.players[i] = next
  }
  /** Put `next` in the place of player `id` (a substitution). */
  setPlayerAt(id: string, next: PlayerState): void {
    const i = this.players.findIndex((x) => x.id === id)
    this.players[i] = next
  }
  active(side?: Side): PlayerState[] {
    return this.players.filter((x) => !x.sentOff && (side === undefined || x.side === side))
  }
  teamId(side: Side): string {
    return teamOf(this.cfg, side).id
  }
  minute(): number {
    return (this.period === "first_half" ? 0 : 45) + (this.periodTick * this.dt) / 60
  }
  emit(pe: PendingEvent, extra: { frame_id_end?: number | null; outcome?: string | null } = {}): void {
    this.seq += 1
    // Duels state their result in attrs.outcome; it is also the event's outcome.
    const outcome = extra.outcome !== undefined ? extra.outcome : OUTCOME_IN_ATTRS.has(pe.type) && typeof pe.attrs.outcome === "string" ? pe.attrs.outcome : null
    this.events.push(
      buildEvent({ matchId: this.cfg.matchId, period: this.period, periodStartTick: this.periodStartTick, dt: this.dt }, this.seq, pe, { ...extra, outcome })
    )
  }
  pending(type: PendingEvent["type"], pl: PlayerState | null, at: Vec2 | null, attrs: Record<string, AttrValue> = {}, end: Vec2 | null = null, side?: Side): PendingEvent {
    const s = pl?.side ?? side ?? null
    return {
      type,
      frame_id: this.tick,
      team_id: s ? this.teamId(s) : null,
      player_id: pl?.id ?? null,
      x: at?.x ?? null,
      y: at?.y ?? null,
      x_end: end?.x ?? null,
      y_end: end?.y ?? null,
      attrs
    }
  }
  /** Scenario-script modifiers for `side` now. */
  mods(side: Side): Mods {
    return modsFor(this.cfg.script, side, this.minute(), this.p, this.scriptGoals, this.period)
  }
  /** A goal for `side`: the score, and the script's goal progress. */
  addGoal(side: Side): void {
    this.score[side] += 1
    if (this.cfg.script) {
      this.scriptGoals = countGoal(this.cfg.script, this.scriptGoals, side, this.minute(), this.period)
      // A natural goal counts towards a forced target: only the shortfall stays forced.
      this.forced = outstandingForces(this.cfg.script, this.forced, this.scriptGoals)
    }
  }
  /** Whether an outcome of `effect` is forced for `side`'s next qualifying action. */
  hasForced(side: Side, effect: ScenarioEffect): boolean {
    return this.forced.some((f) => f.team === side && f.effect === effect)
  }
  /** Use up one forced `effect` for `side`; true if there was one. */
  takeForced(side: Side, effect: ScenarioEffect): boolean {
    const i = this.forced.findIndex((f) => f.team === side && f.effect === effect)
    if (i < 0) return false
    this.forced.splice(i, 1)
    return true
  }
  decisionDelayTicks(): number {
    const t = this.p.timing
    return Math.max(1, Math.round(this.rng.decision.range(t.decisionMinS, t.decisionMaxS) / this.dt))
  }
  toState(): MatchState {
    const out = {} as Record<Concern, MatchState["rng"][Concern]>
    for (const c of CONCERNS) out[c] = this.rng[c].state
    return {
      config: this.cfg,
      tick: this.tick,
      period: this.period,
      periodTick: this.periodTick,
      periodTicks: this.periodTicks,
      periodStartMs: this.periodStartMs,
      phase: this.phase,
      ball: this.ball,
      possession: this.possession,
      players: this.players,
      score: this.score,
      lastTouch: this.lastTouch,
      pressedBy: this.pressedBy,
      carry: this.carry,
      subs: this.subs,
      forced: this.forced,
      scriptGoals: this.scriptGoals,
      rng: out,
      eventSeq: this.seq,
      ...(this.override ? { override: this.override } : {}),
      ...(Object.values(this.subOrders).some((q) => q.length > 0) ? { subOrders: this.subOrders } : {}),
      ...(this.anchor ? { anchor: this.anchor } : {}),
      ...(this.load ? { load: { ...this.load } } : {}),
      ...(this.supportGate ? { supportGate: this.supportGate } : {}),
      ...(this.transition ? { transition: this.transition } : {}),
      ...(this.press ? { press: this.press } : {})
    }
  }
}

// ---------------------------------------------------------------- restarts

const restartFromOut = (lastSide: Side | null, at: Vec3, period: Period): { restart: RestartKind; side: Side; at: Vec2 } => {
  const last = lastSide ?? "home"
  if (Math.abs(at.y) > PITCH.halfW && Math.abs(at.x) <= PITCH.halfL) {
    return { restart: "throw_in", side: other(last), at: { x: Math.max(-PITCH.halfL + 1, Math.min(PITCH.halfL - 1, at.x)), y: Math.sign(at.y) * PITCH.halfW } }
  }
  const end = Math.sign(at.x) || 1
  // The side defending the end the ball went out at: the one not attacking it this period.
  const defending: Side = other(sideAttacking(end, period))
  if (last === defending) return { restart: "corner", side: other(defending), at: { x: end * PITCH.halfL, y: (Math.sign(at.y) || 1) * PITCH.halfW } }
  return { restart: "goal_kick", side: defending, at: { x: end * (PITCH.halfL - PITCH.sixDepth), y: 0 } }
}

const startRestart = (w: Work, r: { restart: RestartKind; side: Side; at: Vec2 }): void => {
  const delay = w.p.timing.restartDelayS[r.restart] * w.rng.restart.range(0.7, 1.3)
  w.phase = { kind: "restart", restart: r.restart, side: r.side, at: r.at, resumeTick: w.tick + Math.round(delay / w.dt) }
  w.possession = { kind: "dead" }
  w.ball = { pos: { x: r.at.x, y: r.at.y, z: 0 }, vel: { x: 0, y: 0, z: 0 } }
  w.pressedBy = []
  // A restart is not a loss (P4 A4): it ends any transition.
  w.transition = undefined
  if (w.period === "second_half") for (const side of ["home", "away"] as const) subWindow(w, side)
}

// ---------------------------------------------------------------- substitutions

const LINE: Readonly<Record<Role, string>> = { GK: "gk", CB: "def", FB: "def", DM: "mid", CM: "mid", AM: "mid", W: "att", ST: "att" }

/** Bench player to bring on for `off`: same role, else same line, else any outfield player. */
const pickIncoming = (bench: ReadonlyArray<PlayerSetup>, off: PlayerState): PlayerSetup | null =>
  bench.find((b) => b.role === off.role) ?? bench.find((b) => LINE[b.role] === LINE[off.role]) ?? bench[0] ?? null

/**
 * `on` takes `off`'s formation slot and role, fresh, entering at the halfway line during play or where `off` stood at
 * half time.
 */
const bringOn = (w: Work, off: PlayerState, on: PlayerSetup, halfTime: boolean): void => {
  const entry = halfTime ? off.pos : { x: 0, y: -PITCH.halfW }
  w.setPlayerAt(off.id, {
    id: on.id, side: off.side, role: off.role, slot: off.slot, jersey: on.jersey, attrs: on.attrs, foot: on.preferredFoot ?? "right",
    pos: entry, vel: { x: 0, y: 0 }, intent: { kind: "shape" }, intentUntil: 0, energy: 1, yellow: 0, sentOff: false
  })
  if (w.lastTouch?.playerId === off.id) w.lastTouch = { playerId: on.id, side: off.side }
}

/**
 * Replace up to `n` tired (or booked) outfield players. The player coming on takes the same formation slot and role,
 * fresh, entering at `entry` (the halfway line during play, the kickoff position at half time).
 */
const makeSubs = (w: Work, side: Side, n: number, halfTime: boolean): number => {
  const st = w.subs[side]
  const team = teamOf(w.cfg, side)
  let bench = (team.bench ?? []).filter((b) => b.role !== "GK" && !st.used.includes(b.id))
  const rng = w.rng.bench
  const outgoing = w
    .active(side)
    .filter((pl) => pl.role !== "GK" && !st.used.includes(pl.id))
    .map((pl) => ({ pl, score: (1 - pl.energy + 0.25 * pl.yellow + 0.05 * rng.uniform()) * w.p.substitutions.roleWeights[pl.role as Exclude<Role, "GK">] }))
    .sort((a, b) => b.score - a.score)
  let made = 0
  const used = [...st.used]
  for (const { pl: off } of outgoing) {
    if (made >= n || st.made + made >= MAX_SUBS) break
    const on = pickIncoming(bench, off)
    if (!on) break
    bench = bench.filter((b) => b.id !== on.id)
    used.push(on.id)
    bringOn(w, off, on, halfTime)
    const reason = off.yellow > 0 && 1 - off.energy < 0.5 ? "booked" : "fatigue"
    w.emit(w.pending("substitution", off, off.pos, { player_off: off.id, player_on: on.id, reason, half_time: halfTime }))
    made++
  }
  w.subs[side] = { ...st, made: st.made + made, used }
  return made
}

/** At a stoppage in the second half, make every planned change that is due, as one window. */
const subWindow = (w: Work, side: Side): void => {
  if (isManaged(w.cfg, side)) return
  const st = w.subs[side]
  if (st.windows >= MAX_SUB_WINDOWS || st.made >= MAX_SUBS) return
  const due = st.plan.filter((x) => x.minute <= w.minute())
  if (due.length === 0) return
  w.subs[side] = { ...st, plan: st.plan.slice(due.length) }
  const made = makeSubs(w, side, due.reduce((a, x) => a + x.players, 0), false)
  if (made > 0) w.subs[side] = { ...w.subs[side], windows: w.subs[side].windows + 1 }
}

/** Make the substitutions the team's manager ordered (orders.ts): one window during play, none at half time. */
const orderedSubs = (w: Work, side: Side): void => {
  const orders = w.subOrders[side] ?? []
  if (orders.length === 0) return
  w.subOrders = { ...w.subOrders, [side]: [] }
  const st = w.subs[side]
  const bench = teamOf(w.cfg, side).bench ?? []
  const used = [...st.used]
  let made = 0
  for (const o of orders) {
    const off = w.players.find((p) => p.id === o.off && p.side === side && !p.sentOff)
    const on = bench.find((b) => b.id === o.on)
    // Checked when ordered; a player sent off since, or the limit reached, cancels the change.
    if (!off || !on || used.includes(on.id) || st.made + made >= MAX_SUBS) continue
    used.push(on.id)
    bringOn(w, off, on, w.halfTimeBreak)
    w.emit(w.pending("substitution", off, off.pos, { player_off: off.id, player_on: on.id, reason: "manager", half_time: w.halfTimeBreak }))
    made++
  }
  w.subs[side] = { ...st, made: st.made + made, used, windows: st.windows + (made > 0 && !w.halfTimeBreak ? 1 : 0) }
}

const takerFor = (w: Work, r: { restart: RestartKind; side: Side; at: Vec2 }): PlayerState => {
  const team = w.active(r.side)
  if (r.restart === "goal_kick") return team.find((x) => x.role === "GK") ?? team[0]!
  if (r.restart === "kickoff") return team.find((x) => x.role === "ST") ?? team[team.length - 1]!
  // With every outfielder sent off (only under a scripted red-card storm) the keeper takes it.
  return team.filter((x) => x.role !== "GK").sort((a, b) => dist(a.pos, r.at) - dist(b.pos, r.at))[0] ?? team[0]!
}

const handleRestart = (w: Work): void => {
  const ph = w.phase
  if (ph.kind !== "restart") return
  if (w.tick < ph.resumeTick) return
  const taker = takerFor(w, ph)
  // The taker walks to the ball (see moveTarget); the restart waits until they are there.
  if (dist(taker.pos, ph.at) > 1.0) return
  w.setPlayer({ ...taker, vel: { x: 0, y: 0 }, intentUntil: w.tick, intent: { kind: "hold" } })
  w.emit(w.pending("set_piece", taker, ph.at, { kind: ph.restart }))
  w.possession = { kind: "owned", playerId: taker.id, since: w.tick, restart: ph.restart }
  w.lastTouch = { playerId: taker.id, side: taker.side }
  w.phase = { kind: "open_play" }
}

// ---------------------------------------------------------------- on-ball

/** Possession for a player who has just won the ball; a keeper with it in his hands also gets his hold time. */
const ownedBy = (w: Work, pl: PlayerState, lastTouch: { readonly side: Side; readonly playerId: string } | null): Possession => {
  const base = { kind: "owned" as const, playerId: pl.id, since: w.tick, restart: null }
  if (!keeperInHands(w.p.keeper.handsRule, pl, w.period, lastTouch)) return base
  const [lo, hi] = w.p.keeper.handsHoldS
  return { ...base, inHands: true, holdTicks: Math.round(w.rng.keeper.range(lo, hi) / w.dt) }
}

/** A keeper who takes the ball in his hands is not pressed (handsRule): a press started on him at his feet ends now. */
const endPressesOnHands = (w: Work): void => {
  const pos = w.possession
  if (pos.kind !== "owned" || pos.inHands !== true) return
  for (const o of w.players)
    if (o.intent.kind === "press" && o.intent.targetId === pos.playerId && w.tick < o.intentUntil) w.setPlayer({ ...o, intentUntil: w.tick })
}

const changePossession = (w: Work, to: PlayerState, reasonEvent: PendingEvent | null): void => {
  const prevSide = w.lastTouch?.side ?? null
  if (reasonEvent) w.emit(reasonEvent)
  if (prevSide !== null && prevSide !== to.side) {
    w.emit(w.pending("possession_change", to, to.pos, { reason: reasonEvent?.type ?? "recovery" }))
    noteLoss(w, prevSide, to.pos)
  }
  w.possession = ownedBy(w, to, w.lastTouch)
  endPressesOnHands(w)
  w.lastTouch = { playerId: to.id, side: to.side }
  w.pressedBy = []
  w.setPlayer({ ...w.player(to.id), intent: { kind: "hold" }, intentUntil: w.tick + releaseDelayTicks(w, w.player(to.id)) })
}

/** Book a player (yellow, or second yellow and off) and emit the card. */
const book = (w: Work, pl: PlayerState, card: "yellow" | "second_yellow" | "red", attrs: Record<string, AttrValue>): void => {
  w.emit(w.pending("card", pl, pl.pos, { colour: card, ...attrs }))
  const cur = w.player(pl.id)
  w.setPlayer({ ...cur, yellow: cur.yellow + 1, sentOff: card !== "yellow" })
}

/**
 * A foul by `offender` on `victim` (of `kind`, at `at`): the event, any card, and the restart — a penalty if `at` is in
 * the box the victim attacks, else a free kick there.
 * @internal
 */
export const foulAndCards = (w: Work, offender: PlayerState, victim: PlayerState, kind: FoulKind = "tackle", at: Vec2 = victim.pos): void => {
  w.emit(w.pending("foul", offender, offender.pos, { kind, victim_id: victim.id }))
  const ref = w.rng.referee
  let card: "yellow" | "second_yellow" | "red" | null = null
  const forcedRed = w.takeForced(offender.side, "red_card")
  if (forcedRed || ref.chance(Math.min(1, w.p.defending.redPerFoul * w.mods(offender.side).red))) card = "red"
  else if (ref.chance(w.p.defending.yellowPerFoul * (offender.yellow >= 1 ? w.p.defending.bookedYellowFactor : 1))) card = offender.yellow >= 1 ? "second_yellow" : "yellow"
  if (card) book(w, offender, card, forcedRed ? { scripted: true } : {})
  const inBox = attackX(victim.side, at.x, w.period) > PITCH.halfL - PITCH.boxDepth && Math.abs(at.y) < PITCH.boxHalfWidth
  startRestart(
    w,
    inBox
      ? { restart: "penalty", side: victim.side, at: { x: dirOf(victim.side, w.period) * PITCH.penaltySpot, y: 0 } }
      : { restart: "free_kick", side: victim.side, at: clampToPitch(at, 1) }
  )
}

/** Cautions for conduct: a Poisson stream over the match, falling on a random player on the pitch. */
const cautions = (w: Work): void => {
  const rate = w.p.defending.cautionPerMatch / MATCH_SECONDS_90
  if (rate <= 0 || !w.rng.caution.chance(hazard(rate, w.dt))) return
  const pool = [...w.active("home"), ...w.active("away")]
  if (pool.length === 0) return
  const pl = pool[Math.min(pool.length - 1, Math.floor(w.rng.caution.uniform() * pool.length))]!
  book(w, pl, pl.yellow >= 1 ? "second_yellow" : "yellow", { reason: "conduct" })
}

/** The ball squirts away from a contact point; last touch belongs to `toucher`. */
const knockLoose = (w: Work, toucher: PlayerState, at: Vec2): void => {
  const ang = w.rng.duel.range(0, 2 * Math.PI)
  const speed = w.rng.duel.range(4, 11)
  w.ball = { pos: { x: at.x, y: at.y, z: 0 }, vel: { x: Math.cos(ang) * speed, y: Math.sin(ang) * speed, z: w.rng.duel.range(0, 2) } }
  w.possession = { kind: "loose" }
  w.lastTouch = { playerId: toucher.id, side: toucher.side }
  w.pressedBy = []
}

/** How urgently `defSide` must defend a ball at `at`: 1 on its goal line, 0 beyond 30 m from its goal. */
const danger = (defSide: Side, period: Period, at: Vec2): number => Math.max(0, 1 - dist(at, { x: -dirOf(defSide, period) * PITCH.halfL, y: 0 }) / 30)

// ================================================================ P4 tackle seam (plan 8d Task 3 owns this block)

/** T2: the logit that `def` wins his tackle attempt on `owner`. rule 0: the old logit, defending.tackleBase + 3 (tackling - dribbling). @internal */
export const tackleWinLogit = (w: Work, def: PlayerState, owner: PlayerState): number => w.p.defending.tackleBase + 3 * (def.attrs.tackling - owner.attrs.dribbling)

// ================================================================ end of P4 tackle seam

// ================================================================ P4 foul seam (plan 8d Task 4 owns this block)

/** T3: the chance that `def`, having lost his tackle on `owner`, fouls him (one referee draw). rule 0: the flat rate, x boxFoulFactor in the box. @internal */
export const foulChance = (w: Work, def: PlayerState, owner: PlayerState): number => {
  const victimInBox = attackX(owner.side, owner.pos.x, w.period) > PITCH.halfL - PITCH.boxDepth && Math.abs(owner.pos.y) < PITCH.boxHalfWidth
  const booked = def.yellow >= 1 ? w.p.defending.bookedFoulFactor : 1
  return Math.min(1, w.p.defending.foulPerTackle * (victimInBox ? w.p.defending.boxFoulFactor : 1) * w.mods(def.side).foul * booked)
}

/** T4: whether the carrier `owner` fouls the tackler `def` (shielding or holding; foul stream). rule 0: never, no draw. @internal */
export const shieldingFoul = (_w: Work, _def: PlayerState, _owner: PlayerState): boolean => false

/** T3: whether the beaten defender `def` fouls `owner`, who has just won a take-on (foul stream). rule 0: never, no draw. @internal */
export const takeOnFoul = (_w: Work, _owner: PlayerState, _def: PlayerState): boolean => false

/** T3: the foul-zone factor for `victim` fouled at `at`, in his attacking frame. rule 0: 1. @internal */
export const foulZone = (_w: Work, _victim: PlayerState, _at: Vec2): number => 1

// ================================================================ end of P4 foul seam

const duels = (w: Work, owner: PlayerState): boolean => {
  const opps = w.active(other(owner.side))
  for (const o of opps) {
    if (dist(o.pos, owner.pos) <= w.p.defending.pressRadiusM && !w.pressedBy.includes(o.id)) {
      w.pressedBy.push(o.id)
      w.emit(w.pending("pressure", o, o.pos, { target_id: owner.id }))
    }
  }
  const def = nearestOpponent(owner.pos, opps)
  if (!def || dist(def.pos, owner.pos) > w.p.defending.tackleRadiusM) return false
  const style = teamOf(w.cfg, def.side).style
  const rate = w.p.defending.tackleRatePerS * (0.5 + style.pressIntensity) * (1 + w.p.defending.boxIntensity * danger(def.side, w.period, owner.pos)) * w.mods(def.side).tackle
  if (!w.rng.duel.chance(hazard(rate, w.dt))) return false
  if (shieldingFoul(w, def, owner)) {
    finishCarry(w, owner)
    foulAndCards(w, owner, def, "shielding", def.pos)
    return true
  }
  const pWin = 1 / (1 + Math.exp(-tackleWinLogit(w, def, owner)))
  if (w.rng.duel.chance(pWin)) {
    finishCarry(w, owner)
    if (w.rng.duel.chance(w.p.defending.tackleLooseShare)) {
      w.emit(w.pending("tackle", def, def.pos, { outcome: "won", opponent_id: owner.id, ball: "loose" }))
      knockLoose(w, def, owner.pos)
    } else changePossession(w, def, w.pending("tackle", def, def.pos, { outcome: "won", opponent_id: owner.id, ball: "won" }))
    return true
  }
  if (w.rng.referee.chance(foulChance(w, def, owner)) || w.hasForced(def.side, "red_card")) {
    finishCarry(w, owner)
    w.emit(w.pending("tackle", def, def.pos, { outcome: "foul", opponent_id: owner.id }))
    foulAndCards(w, def, owner)
    return true
  }
  w.emit(w.pending("tackle", def, def.pos, { outcome: "lost", opponent_id: owner.id }))
  return false
}

/** Emit a carry event if the owner just finished carrying the ball at least carryMinM. */
const finishCarry = (w: Work, owner: PlayerState): void => {
  const start = w.carry
  w.carry = null
  if (!start || start.playerId !== owner.id) return
  const d = dist(start.at, owner.pos)
  if (d < w.p.classifier.carryMinM) return
  const progressive = attackX(owner.side, owner.pos.x, w.period) - attackX(owner.side, start.at.x, w.period) >= 10
  w.emit({ ...w.pending("carry", owner, start.at, { ...start.decision, distance_m: round2(d), progressive }, owner.pos), frame_id: start.tick }, { frame_id_end: w.tick })
}

/** What the player could have done, recorded on the event (spec §5.1.4 "decision record"). */
const decisionAttrs = (d: Decision): Record<string, AttrValue> => ({
  action_probs: d.actionProbs,
  options: d.options,
  best_receiver_id: d.options[0]?.receiver_id ?? null,
  best_value: d.options[0]?.value ?? null,
  chosen_value: d.candidate ? Math.round(d.candidate.value * 1000) / 1000 : null,
  chosen_rank: d.chosenRank,
  fallback: d.fallback,
  ...(d.forced ? { forced_pass: true } : {})
})

const otherFoot = (f: PlayerState["foot"]): PlayerState["foot"] => (f === "left" ? "right" : "left")
const footPart = (pl: PlayerState, weakFoot: boolean): string => `${weakFoot ? otherFoot(pl.foot) : pl.foot}_foot`

const technique = (a: Action, pl: PlayerState): number =>
  a === "cross" ? pl.attrs.crossing : a === "long_pass" || a === "switch" || a === "lofted_through" || a === "clear" ? pl.attrs.longPassing : pl.attrs.shortPassing

// ================================================================ P3 boot-block seam (plan 8c Task 3; plan 8d Task 9 owns this block)

/** A defender at the passer's boot blocks this open-play pass (X1): who, and where the ball goes. Draws from the boot stream. @internal */
export const bootBlock = (w: Work, owner: PlayerState, d: Decision): { blocker: PlayerState; loose: BallState } | null => {
  if (w.p.firstTick.rule <= 0) return null
  // M5a: a keeper's throw or punt from his hands is never boot-blocked.
  if (w.p.firstTick.scopeRule > 0 && d.candidate?.method !== undefined) return null
  const b = bootBlocker(owner, w.active(other(owner.side)), w.p)
  if (!b || !w.rng.boot.chance(w.p.firstTick.bootBlock)) return null
  return { blocker: b, loose: deflectLoose(b.side, w.period, b.pos, w.rng.boot, [2, 6], [0, 1]) }
}

/** M5 (P4): the params a kick's flight is resolved with (resolveFlight, keeperLetsRun). firstTick.scopeRule 0: w.p itself. @internal */
export const flightParams = (w: Work, isClear: boolean): Params =>
  // M5b: a clearance has no boot block, so its first tick keeps the old rule: a defender in front can charge it down.
  w.p.firstTick.scopeRule > 0 && isClear && w.p.firstTick.rule > 0 ? { ...w.p, firstTick: { ...w.p.firstTick, rule: 0 } } : w.p

// ================================================================ end of P3 boot-block seam

// ================================================================ P3 release seam (plan 8c Task 4; plan 8d Task 9 owns this block)

/** Ticks a player takes before his first decision after winning or receiving the ball (D2; release stream). */
const releaseDelayTicks = (w: Work, pl: PlayerState): number => {
  if (w.p.release.rule <= 0) return w.decisionDelayTicks()
  const opp = nearestOpponent(pl.pos, w.active(other(pl.side)))
  return Math.max(1, Math.round(releaseDelayS(opp ? dist(opp.pos, pl.pos) : 50, w.p, w.rng.release) / w.dt))
}

/** M6 (P4): re-judge the holder's remaining hold once he is pressed (release stream). release.rejudge 0: nothing. @internal */
export const rejudgeRelease = (w: Work, owner: PlayerState): void => {
  const r = w.p.release
  if (r.rule <= 0 || r.rejudge <= 0) return
  const poss = w.possession
  // Never at a restart, and never a keeper with the ball in his hands (he can be pressed, not challenged).
  if (poss.kind !== "owned" || poss.playerId !== owner.id || poss.restart !== null) return
  const inHands = w.p.keeper.handsRule > 0 ? poss.inHands === true && inOwnBox(owner.side, w.period, owner.pos) : owner.role === "GK" && inOwnBox(owner.side, w.period, owner.pos)
  if (inHands) return
  if (owner.intent.kind !== "hold") return
  // Once: after the cut the remaining hold is within pressedS[1], so a second re-judge cannot fire.
  if (owner.intentUntil - w.tick <= Math.round(r.pressedS[1] / w.dt)) return
  const opp = nearestOpponent(owner.pos, w.active(other(owner.side)))
  if (!opp || dist(opp.pos, owner.pos) >= r.pressedM) return
  const ticks = Math.max(1, Math.round(w.rng.release.range(r.pressedS[0], r.pressedS[1]) / w.dt))
  w.setPlayer({ ...owner, intentUntil: Math.min(owner.intentUntil, w.tick + ticks) })
}

// ================================================================ end of P3 release seam

// ================================================================ P3 keeper-distribution seam (plan 8c Task 7 owns this block)

/** keeper_distribution's method: with distribution.rule, the real one (throw, punt, or a kick from his feet); else the old label. */
const keeperMethod = (w: Work, d: Decision): string =>
  w.p.distribution.rule > 0 ? (d.candidate?.method ?? "kick") : d.action === "short_pass" ? "throw" : "kick"

/** How a pass is struck: throw-ins and keeper throws by hand (throws more accurately), punts with more error. */
const kickStyle = (w: Work, d: Decision, restart: RestartKind | null): { technique: "throw" | "foot"; hands: boolean; errorScale: number } => {
  if (restart === "throw_in") return { technique: "throw", hands: true, errorScale: 1 }
  if (d.candidate?.method === "throw") return { technique: "throw", hands: true, errorScale: w.p.distribution.throwErrorScale }
  if (d.candidate?.method === "punt") return { technique: "foot", hands: false, errorScale: w.p.distribution.puntErrorScale }
  return { technique: "foot", hands: false, errorScale: 1 }
}

// ================================================================ end of P3 keeper-distribution seam

// ================================================================ P4 aerial seam (plan 8d Task 5 owns this block)

/**
 * T4: the aerial duel on a kick's resolution (aerial stream), and any foul by its loser on its winner (foul stream),
 * decided at release. rule 0: the resolution unchanged, no foul.
 * @internal
 */
export const aerialDuel = (_w: Work, res: Resolution, _owner: PlayerState): { res: Resolution; foul: FlightFoul | null } => ({ res, foul: null })

/** T4: apply a flight's aerial foul at resolution; true if it was given (the restart is set). rule 0: never. @internal */
export const applyFlightFoul = (_w: Work, _foul: FlightFoul): boolean => false

// ================================================================ end of P4 aerial seam

const releaseKick = (w: Work, owner: PlayerState, d: Decision, restart: RestartKind | null): void => {
  const p = w.p
  const side = owner.side
  const opps = w.active(other(side))
  const isClear = d.action === "clear"
  // A clearance from inside the box is sometimes sliced behind; from a wide position it is often kicked into touch on purpose.
  const sliced = isClear && inOwnBox(side, w.period, owner.pos) && w.rng.execution.chance(p.defending.clearSliceBehind)
  const toTouch = !sliced && isClear && Math.abs(owner.pos.y) > 8 && w.rng.decision.chance(p.defending.clearToTouch)
  const target: Vec2 = sliced
    ? (({ x, y }) => ({ x, y }))(behindPoint(side, w.period, owner.pos, w.rng.execution))
    : toTouch
    ? { x: owner.pos.x + dirOf(side, w.period) * w.rng.decision.range(10, 35), y: Math.sign(owner.pos.y) * (PITCH.halfW + w.rng.decision.range(2, 8)) }
    : isClear
      ? { x: owner.pos.x + dirOf(side, w.period) * w.rng.decision.range(30, 60), y: owner.pos.y + w.rng.decision.range(-35, 35) }
      : d.candidate!.target
  const height = isClear ? "high" : d.candidate!.height
  const weakFoot = w.rng.execution.chance(0.2)
  // Scenario scripts: a defensive error raises (or forces) mis-hits by the team's defenders in their own half.
  const errorProne = (owner.role === "CB" || owner.role === "FB" || owner.role === "DM") && attackX(side, owner.pos.x, w.period) < 0
  const forceMishit = errorProne && !restart && w.takeForced(side, "defensive_error")
  const style = kickStyle(w, d, restart)
  const exe = executeKick(
    {
      from: owner.pos, to: target, height, technique: technique(d.action, owner), composure: owner.attrs.composure, pressure: d.pressure, weakFoot,
      fatigue: 1 - owner.energy, mishitScale: errorProne ? w.mods(side).mishit : 1, forceMishit, errorScale: style.errorScale
    },
    p,
    w.rng.execution
  )
  const start: BallState = { pos: { x: owner.pos.x, y: owner.pos.y, z: 0 }, vel: exe.vel }
  const intended = d.candidate?.receiverId ?? null
  // A keeper lets a ball that is running out over their own goal line go for a goal kick (see keeperLetsRun).
  const fp = flightParams(w, isClear)
  const raw = keeperLetsRun(start, owner.id, intended, w.active(), resolveFlight(start, owner.id, intended, w.active(), fp, w.dt, w.rng.duel), w.period, fp, w.dt, w.rng.duel)
  // An aerial contact may be contested (T4, aerial seam); a foul in the duel is given when the flight resolves.
  const ad = aerialDuel(w, raw, owner)
  const res = ad.res
  const lastDef = lastDefenderAttackX(side, w.period, opps)
  const winner = res.winnerId ? w.player(res.winnerId) : null
  const offside =
    !restart || restart === "free_kick"
      ? winner !== null &&
        winner.side === side &&
        winner.id !== owner.id &&
        attackX(side, winner.pos.x, w.period) > Math.max(lastDef, attackX(side, owner.pos.x, w.period), 0) + 0.5
      : false
  // What the defending side does about it: block the cross at the source, the keeper comes for a high ball,
  // or a defender heads it away. Each is drawn only when it is possible.
  const defSide = other(side)
  const keeper = opps.find((o) => o.role === "GK") ?? null
  const crossBlock = d.candidate?.kind === "cross" && restart === null ? crossBlocker(owner, opps, p) : null
  // A defender at the boot may block any other open-play pass (X1); always null while firstTick.rule is 0.
  const boot = d.candidate?.kind !== "cross" && !isClear && restart === null ? bootBlock(w, owner, d) : null
  const blocker = crossBlock ?? boot?.blocker ?? null
  const blocked = boot !== null || (crossBlock !== null && w.rng.duel.chance(p.defending.crossBlock))
  // An aerial foul stands only on a flight that is neither blocked nor offside (pre-flight G11).
  const foul = ad.foul && !blocked && !offside ? ad.foul : null
  const contact = res.ball.pos
  const keeperComes =
    !blocked && !foul && height !== "ground" && keeper !== null && (res.result === "reached" || res.result === "stopped") && winner?.id !== keeper.id &&
    keeperCanCome(keeper, w.period, contact, res.ticks * w.dt, p) && w.rng.duel.chance(p.keeper.comeShare)
  const headsAway =
    !blocked && !foul && !keeperComes && res.result === "reached" && winner !== null && winner.side === defSide && winner.role !== "GK" &&
    contact.z > p.kinematics.controlHeightM && attackX(defSide, contact.x, w.period) < -17.5 && w.rng.duel.chance(p.defending.headClearShare)
  const kind = restart && restart !== "kickoff" ? "set_piece" : isClear ? null : d.candidate!.kind
  const attrs: Record<string, AttrValue> = {
    kind,
    restart,
    height,
    technique: style.technique,
    body_part: style.hands ? "hands" : footPart(owner, weakFoot),
    intended_receiver_id: intended,
    intended_end_x: round2(target.x),
    intended_end_y: round2(target.y),
    execution: sliced ? "sliced" : exe.execution,
    ...(forceMishit ? { scripted: true } : {}),
    error_m: round2(exe.errorM),
    decision_quality: d.decisionQuality === null ? null : round2(d.decisionQuality),
    ...decisionAttrs(d),
    under_pressure: d.pressure > 0.3,
    defenders_in_lane: d.candidate?.lane ?? 0,
    ball_speed_kmh: round2(len({ x: exe.vel.x, y: exe.vel.y }) * 3.6),
    xpass: d.candidate ? round2(d.candidate.xpass) : null
  }
  const endAt = blocked ? blocker!.pos : { x: res.ball.pos.x, y: res.ball.pos.y }
  const main = w.pending(isClear ? "clearance" : "pass", owner, owner.pos, attrs, endAt)
  const extra: PendingEvent[] = []
  let outcome: Flight["outcome"]
  let restartAfter: Flight["restartAfter"] = null
  let looseAfter: BallState | null = null
  const tickAt = blocked ? w.tick + Math.max(1, Math.round(dist(owner.pos, blocker!.pos) / 15 / w.dt)) : w.tick + res.ticks
  const at = (pe: PendingEvent): PendingEvent => ({ ...pe, frame_id: tickAt })
  let keeperClaims = false
  let deflectTo: Vec3 | null = null
  if (blocked) {
    outcome = "blocked"
    extra.push(at(w.pending("block", blocker, blocker!.pos, { blocked: boot ? "pass" : "cross" })))
    if (boot) looseAfter = boot.loose
    else if (w.rng.duel.chance(p.defending.crossBlockBehind)) deflectTo = behindPoint(defSide, w.period, blocker!.pos, w.rng.duel)
    else looseAfter = deflectLoose(defSide, w.period, blocker!.pos, w.rng.duel, [3, 8], [0.5, 3])
  } else if (foul) {
    // Fouled in the air: the duel is recorded now and the foul given at resolution (no reception).
    outcome = w.player(foul.victimId).side === side ? "successful" : "intercepted"
    if (res.aerial) extra.push(at(w.pending("aerial_duel", winner, endAt, { winner_id: res.aerial.winnerId, loser_id: res.aerial.loserId })))
  } else if (keeperComes) {
    outcome = "intercepted"
    const act = keeperAction(keeper!, p, w.rng.duel)
    const from = restart === "corner" ? "corner" : restart === "free_kick" ? "free_kick" : "cross"
    const point = { x: contact.x, y: contact.y }
    if (act === "punch") {
      extra.push(at(w.pending("keeper_punch", keeper, point, { from })))
      looseAfter = clearAway(defSide, w.period, contact, w.rng.duel, 0.8)
    } else {
      extra.push(at(w.pending("keeper_claim", keeper, point, { from, handling: act === "claim" ? "clean" : "fumble" })))
      if (act === "fumble") looseAfter = { pos: contact, vel: { x: w.rng.duel.range(-3, 3), y: w.rng.duel.range(-3, 3), z: 0.3 } }
      else keeperClaims = true
    }
  } else if (headsAway) {
    outcome = "intercepted"
    if (res.aerial) extra.push(at(w.pending("aerial_duel", winner, endAt, { winner_id: res.aerial.winnerId, loser_id: res.aerial.loserId })))
    extra.push(at(w.pending("clearance", winner, endAt, { technique: "head", body_part: "head" })))
    const nearOwnLine = attackX(defSide, contact.x, w.period) < -(PITCH.halfL - 20)
    if (nearOwnLine && w.rng.duel.chance(p.defending.headBehind)) deflectTo = behindPoint(defSide, w.period, contact, w.rng.duel)
    else looseAfter = clearAway(defSide, w.period, contact, w.rng.duel)
  } else if (res.result === "goal") {
    // Into the net from a pass or clearance: a goal for whoever attacks that end (an own goal if it is not the passer's side).
    const scoringSide: Side = sideAttacking(res.ball.pos.x, w.period)
    outcome = "goal"
    extra.push(at({ ...w.pending("goal", owner, endAt, { scorer_id: owner.id, own_goal: scoringSide !== side, from: "pass" }), team_id: w.teamId(scoringSide) }))
    restartAfter = { restart: "kickoff", side: other(scoringSide), at: { x: 0, y: 0 } }
  } else if (res.result === "out") {
    outcome = "out_of_play"
    extra.push(at(w.pending("ball_out", null, endAt, { side: Math.abs(res.ball.pos.y) > PITCH.halfW ? "touchline" : "byline", last_touch_team: w.teamId(side) })))
    restartAfter = restartFromOut(side, res.ball.pos, w.period)
  } else if (!winner) outcome = "loose"
  else if (offside) {
    outcome = "offside"
    extra.push(at(w.pending("offside", winner, winner.pos)))
    restartAfter = { restart: "free_kick", side: other(side), at: clampToPitch(winner.pos, 1) }
  } else if (winner.side === side) {
    outcome = "successful"
    extra.push(at(w.pending("reception", winner, endAt, { first_touch: "controlled", under_pressure: false })))
  } else {
    outcome = "intercepted"
    const deflect = !res.aerial && w.rng.duel.chance(w.p.defending.interceptLooseShare)
    extra.push(at(w.pending(res.aerial ? "aerial_duel" : "interception", winner, endAt, res.aerial ? { winner_id: res.aerial.winnerId, loser_id: res.aerial.loserId } : { ball: deflect ? "deflected" : "won" })))
    if (deflect) looseAfter = deflectLoose(winner.side, w.period, endAt, w.rng.duel)
  }
  const finalMain: PendingEvent = { ...main, attrs: { ...main.attrs, receiver_id: outcome === "successful" && winner ? winner.id : null } }
  if (res.aerial && outcome === "successful" && !foul) extra.unshift(at(w.pending("aerial_duel", winner, endAt, { winner_id: res.aerial.winnerId, loser_id: res.aerial.loserId })))
  w.ball = start
  w.possession = {
    kind: "in_flight",
    flight: {
      kind: isClear ? "clearance" : "pass",
      fromId: owner.id,
      side,
      releaseTick: w.tick,
      resolveTick: tickAt,
      winnerId: keeperClaims ? keeper!.id : offside || looseAfter || deflectTo ? null : (winner?.id ?? null),
      outcome,
      pending: finalMain,
      extra,
      // A blocked cross travels straight to the blocker; every other kick follows the ball physics.
      path: blocked ? { from: start.pos, to: { x: blocker!.pos.x, y: blocker!.pos.y, z: 0.5 } } : null,
      restartAfter,
      looseBall: looseAfter,
      deflectTo,
      ...(foul ? { foul } : {})
    }
  }
  w.lastTouch = { playerId: owner.id, side }
  const chaser = keeperComes ? keeper : blocked ? null : winner
  if (chaser && !offside) w.setPlayer({ ...w.player(chaser.id), intent: { kind: "chase", target: endAt }, intentUntil: tickAt })
}

const releaseShot = (w: Work, owner: PlayerState, d: Decision, restart: RestartKind | null): void => {
  const side = owner.side
  const opps = w.active(other(side))
  const isPenalty = restart === "penalty"
  const xg = isPenalty ? 0.76 : (d.xg ?? 0.02)
  // The recorded xG is the model's; the chance of scoring also follows the game state (minute, red cards).
  const scoring = isPenalty ? 1 : scoringFactor(w.minute(), w.active(side).length, opps.length, w.p, w.period)
  const weakFoot = !isPenalty && w.rng.execution.chance(0.2)
  // Scenario scripts: this team's scoring nudge; the defending keeper's save shift and fumbles; forced outcomes.
  const own = w.mods(side), def = w.mods(other(side))
  const force: ShotMods["force"] = w.takeForced(side, "goal")
    ? "goal"
    : w.hasForced(other(side), "keeper_heroics")
      ? "save"
      : w.hasForced(other(side), "keeper_howler")
        ? "keeper_error"
        : undefined
  const mods: ShotMods = { scoring: scoring * (isPenalty ? 1 : own.scoring), saveLogit: def.saveLogit, fumble: def.fumble, aim: isPenalty ? 1 : own.aim, ...(force ? { force } : {}) }
  const plan = planShot(owner, side, w.period, opps, xg, d.pressure, isPenalty, w.p, w.dt, w.rng.execution, weakFoot, mods)
  // A forced save or keeper error is used up by the next shot that is not blocked.
  if (plan.forced && force === "save") w.takeForced(other(side), "keeper_heroics")
  if (plan.forced && force === "keeper_error") w.takeForced(other(side), "keeper_howler")
  const tickAt = w.tick + plan.ticks
  const at = (pe: PendingEvent): PendingEvent => ({ ...pe, frame_id: tickAt })
  const end = { x: plan.to.x, y: plan.to.y }
  const main = w.pending("shot", owner, owner.pos, {
    ...decisionAttrs(d),
    technique: isPenalty ? "penalty" : restart === "free_kick" ? "free_kick" : "normal",
    body_part: footPart(owner, weakFoot),
    execution: plan.execution,
    on_target: plan.onTarget,
    xg: Math.round(xg * 1000) / 1000,
    ...(plan.forced ? { scripted: true } : {}),
    shot_speed_kmh: round2(w.p.shot.speed * 3.6 * (plan.execution === "scuffed" ? 0.5 : 1))
  }, end)
  const extra: PendingEvent[] = []
  let restartAfter: Flight["restartAfter"] = null
  let looseBall: BallState | null = null
  let deflectTo: Vec3 | null = null
  let winnerId: string | null = null
  if (plan.outcome === "goal") {
    extra.push(at(w.pending("goal", owner, end, { scorer_id: owner.id, own_goal: false })))
    restartAfter = { restart: "kickoff", side: other(side), at: { x: 0, y: 0 } }
  } else if (plan.outcome === "wide") {
    extra.push(at(w.pending("ball_out", null, end, { side: "byline", last_touch_team: w.teamId(side) })))
    const defending = other(side)
    restartAfter = { restart: "goal_kick", side: defending, at: { x: dirOf(side, w.period) * (PITCH.halfL - PITCH.sixDepth), y: 0 } }
  } else if (plan.outcome === "blocked") {
    const blocker = w.player(plan.blockerId!)
    extra.push(at(w.pending("block", blocker, blocker.pos, { blocked: "shot" })))
    if (w.rng.duel.chance(w.p.shot.blockBehind)) deflectTo = behindPoint(other(side), w.period, { x: plan.to.x, y: plan.to.y }, w.rng.duel)
    else looseBall = { pos: plan.to, vel: { x: -dirOf(side, w.period) * w.rng.duel.range(2, 8), y: w.rng.duel.range(-6, 6), z: w.rng.duel.range(0, 3) } }
  } else {
    const keeper = w.player(plan.keeperId!)
    extra.push(at(w.pending("keeper_save", keeper, end, { technique: plan.handling === "clean" ? "catch" : "parry", handling: plan.handling })))
    if (plan.handling === "clean") winnerId = keeper.id
    else {
      looseBall = parryBall(side, w.period, plan.to, plan.handling!, w.rng.duel)
    }
  }
  w.ball = { pos: plan.from, vel: { x: 0, y: 0, z: 0 } }
  w.possession = {
    kind: "in_flight",
    flight: {
      kind: "shot",
      fromId: owner.id,
      side,
      releaseTick: w.tick,
      resolveTick: tickAt,
      winnerId,
      outcome: plan.outcome,
      pending: main,
      extra,
      path: { from: plan.from, to: plan.to },
      restartAfter,
      looseBall,
      deflectTo
    }
  }
  w.lastTouch = { playerId: owner.id, side }
}

/** Scenario-script logit shifts for the team on the ball (see script.ts). */
const scriptBias = (w: Work, side: Side): Partial<Record<Action, number>> => {
  const m = w.mods(side)
  // While a goal is forced, the team pushes forward and looks for the shot that will carry it; while the other
  // keeper's saves are forced (heroics), this team shoots so that there is something to save.
  const forcing = w.hasForced(side, "goal") || w.hasForced(other(side), "keeper_heroics") ? w.p.script.forcedShotLogit : 0
  const shot = m.shotLogit + forcing
  const attack = m.attackLogit + forcing / 2
  if (shot === 0 && attack === 0) return {}
  return { shot, cross: attack, through_ball: attack, lofted_through: attack, cutback: attack }
}

const ownerDecision = (w: Work, owner: PlayerState): void => {
  const poss = w.possession
  if (poss.kind !== "owned") return
  const restart = poss.restart
  if (owner.role === "GK" && !restart) {
    const rule = w.p.keeper.handsRule > 0
    const holdTicks = rule ? (poss.inHands ? (poss.holdTicks ?? 0) : 0) : Math.round(w.p.timing.keeperHoldS / w.dt)
    // In his hands he walks to his release spot and lets it go there once the shortest hold has passed: he does not
    // stand still on the spot for the rest of a long hold (real keepers stand still with the ball at most about 8 s).
    const atSpot = rule && poss.inHands === true && keeperAtReleaseSpot(w, owner)
    const minTicks = Math.round(w.p.keeper.handsHoldS[0] / w.dt)
    if (w.tick - poss.since < (atSpot ? Math.min(holdTicks, minTicks) : holdTicks)) return
  }
  const keeperHands = poss.inHands === true
  // Under the new rule a keeper's hold is over once he decides: from here he plays it from his feet.
  w.possession = w.p.keeper.handsRule > 0 ? { ...poss, restart: null, inHands: false } : { ...poss, restart: null }
  finishCarry(w, owner)
  const side = owner.side
  const team = teamOf(w.cfg, side)
  const input = {
    period: w.period,
    owner,
    teammates: w.active(side),
    opponents: w.active(other(side)),
    style: team.style,
    scoreDiff: w.score[side] - w.score[other(side)],
    minute: w.minute(),
    restart,
    scriptBias: scriptBias(w, side),
    tick: w.tick,
    onBallS: (w.tick - poss.since) * w.dt,
    keeperHands
  }
  let decision = decide(input, w.p, w.rng.decision)
  if (w.override?.playerId === owner.id) {
    decision = overridePass(decision, input, w.override, w.p)
    w.override = null
  }
  const until = (s: number) => w.tick + Math.max(1, Math.round(s / w.dt))
  switch (decision.action) {
    case "hold":
      w.setPlayer({ ...owner, intent: { kind: "hold" }, intentUntil: until(w.rng.decision.range(0.6, 1.4)) })
      return
    case "carry": {
      const goalDir = norm(sub({ x: dirOf(side, w.period) * PITCH.halfL, y: 0 }, owner.pos))
      const dir = norm(add(goalDir, { x: 0, y: w.rng.decision.range(-0.6, 0.6) }))
      w.carry = { playerId: owner.id, at: owner.pos, tick: w.tick, decision: decisionAttrs(decision) }
      w.setPlayer({ ...owner, intent: { kind: "carry", dir, speed: w.p.carry.speed }, intentUntil: until(w.rng.decision.range(...w.p.carry.durationS)) })
      return
    }
    case "take_on": {
      const def = nearestOpponent(owner.pos, w.active(other(side)))!
      const pWin = 1 / (1 + Math.exp(-(w.p.takeOn.b0 + w.p.takeOn.bSkill * (owner.attrs.dribbling - def.attrs.tackling) + w.p.takeOn.bPressure * decision.pressure)))
      const won = w.rng.duel.chance(pWin)
      w.emit(w.pending("take_on", owner, owner.pos, { ...decisionAttrs(decision), outcome: won ? "won" : "lost", defender_id: def.id }))
      if (won && takeOnFoul(w, owner, def)) {
        foulAndCards(w, def, owner, "take_on")
        return
      }
      if (won) {
        const dir = norm(sub({ x: dirOf(side, w.period) * PITCH.halfL, y: 0 }, owner.pos))
        // The carry that follows a won take-on carries the take-on's decision record.
        w.carry = { playerId: owner.id, at: owner.pos, tick: w.tick, decision: decisionAttrs(decision) }
        w.setPlayer({ ...owner, intent: { kind: "carry", dir, speed: w.p.carry.speed * 1.2 }, intentUntil: until(1.2) })
        w.setPlayer({ ...w.player(def.id), vel: { x: 0, y: 0 }, intent: { kind: "hold" }, intentUntil: until(1.0) })
      } else changePossession(w, def, w.pending("tackle", def, def.pos, { outcome: "won", opponent_id: owner.id }))
      return
    }
    case "shot":
      releaseShot(w, owner, decision, restart)
      return
    default:
      // A keeper's distribution is always followed by the keeper's pass (a clearance is not a distribution).
      if (owner.role === "GK" && !restart && decision.action !== "clear")
        w.emit(w.pending("keeper_distribution", owner, owner.pos, { method: keeperMethod(w, decision) }))
      releaseKick(w, owner, decision, restart)
  }
}

const ownedTick = (w: Work): void => {
  if (w.possession.kind !== "owned") return
  const owner = w.player(w.possession.playerId)
  if (owner.sentOff) {
    w.possession = { kind: "loose" }
    return
  }
  // A keeper with the ball in their own box has it in their hands: they can be pressed, not challenged.
  // In his hands he can be pressed, not challenged. Under the old rule that is any keeper possession in his own box.
  const inHands = w.p.keeper.handsRule > 0 ? w.possession.inHands === true && inOwnBox(owner.side, w.period, owner.pos) : owner.role === "GK" && inOwnBox(owner.side, w.period, owner.pos)
  if (w.possession.restart === null && !inHands && duels(w, owner)) return
  rejudgeRelease(w, owner)
  // Read afresh: the release seam may have cut the hold.
  const now = w.player(owner.id)
  if (w.tick >= now.intentUntil) ownerDecision(w, now)
}

// ---------------------------------------------------------------- flights and loose ball

const resolveFlightNow = (w: Work, f: Flight): void => {
  // A deflection's "main event" is the ball going out; it has no outcome or end frame of its own.
  w.emit(f.pending, f.kind === "deflection" ? {} : { frame_id_end: f.resolveTick, outcome: f.outcome })
  // The receiver's first touch is decided now, at contact, from the ball as it arrives and the pressure on them.
  let touch: FirstTouch | null = null
  for (const e of f.extra) {
    if (e.type !== "reception" || !f.winnerId) {
      w.emit(e)
      continue
    }
    const r = w.player(f.winnerId)
    const opp = nearestOpponent(r.pos, w.active(other(r.side)))
    const pressure = pressureFrom(opp ? dist(opp.pos, r.pos) : 50)
    const speed = Math.hypot(w.ball.vel.x, w.ball.vel.y, w.ball.vel.z)
    touch = drawFirstTouch(firstTouchError({ speed, height: w.ball.pos.z, pressure, skill: (r.attrs.dribbling + r.attrs.composure) / 2 }, w.p), w.rng.execution, w.p)
    w.emit({ ...e, attrs: { ...e.attrs, first_touch: touch, under_pressure: pressure > 0.3, lost_possession: touch !== "controlled" } })
  }
  // An aerial foul decided at release (T4) is given now, unless something since has voided it.
  if (f.foul && applyFlightFoul(w, f.foul)) return
  const goal = f.extra.find((e) => e.type === "goal")
  if (goal) w.addGoal(goal.team_id === w.teamId("home") ? "home" : "away")
  if (f.restartAfter) {
    startRestart(w, f.restartAfter)
    return
  }
  if (f.deflectTo) {
    // Deflected straight out over the goal line: a short direct flight, then the restart (a corner).
    const toucher = w.player(f.extra[0]!.player_id!)
    const from = w.ball.pos
    const ticks = Math.max(1, Math.ceil(Math.hypot(f.deflectTo.x - from.x, f.deflectTo.y - from.y) / DEFLECT_SPEED / w.dt))
    const out = { x: f.deflectTo.x, y: f.deflectTo.y }
    w.lastTouch = { playerId: toucher.id, side: toucher.side }
    w.possession = {
      kind: "in_flight",
      flight: {
        kind: "deflection", fromId: toucher.id, side: toucher.side, releaseTick: w.tick, resolveTick: w.tick + ticks, winnerId: null, outcome: "out_of_play",
        pending: { ...w.pending("ball_out", null, out, { side: "byline", last_touch_team: w.teamId(toucher.side) }), frame_id: w.tick + ticks },
        extra: [], path: { from, to: f.deflectTo }, restartAfter: restartFromOut(toucher.side, f.deflectTo, w.period), looseBall: null, deflectTo: null
      }
    }
    return
  }
  if (f.looseBall) {
    // Whoever deflected it (block, header, punch, parry) cannot play it again straight away.
    const toucher = f.extra[0]?.player_id
    if (toucher) w.lastTouch = { playerId: toucher, side: w.player(toucher).side }
    w.ball = f.looseBall
    w.possession = toucher ? { kind: "loose", noTouchId: toucher, noTouchUntil: w.tick + Math.round(0.4 / w.dt) } : { kind: "loose" }
    return
  }
  if (f.winnerId && touch !== null && touch !== "controlled") {
    const r = w.player(f.winnerId)
    w.ball = ballAfterTouch(touch, r.pos, w.ball.vel, w.rng.execution)
    w.possession = { kind: "loose", noTouchId: r.id, noTouchUntil: w.tick + Math.round(0.4 / w.dt) }
    w.lastTouch = { playerId: r.id, side: r.side }
    w.pressedBy = []
    return
  }
  if (f.winnerId) {
    const winner = w.player(f.winnerId)
    w.possession = ownedBy(w, winner, { side: f.side, playerId: f.fromId })
    endPressesOnHands(w)
    if (winner.side === f.side) noteReception(w, winner, f)
    if (w.lastTouch?.side !== winner.side) {
      w.emit(w.pending("possession_change", winner, winner.pos, { reason: f.outcome }))
      if (w.lastTouch) noteLoss(w, w.lastTouch.side, winner.pos)
    }
    w.lastTouch = { playerId: winner.id, side: winner.side }
    w.pressedBy = []
    w.setPlayer({ ...winner, intent: { kind: "hold" }, intentUntil: w.tick + releaseDelayTicks(w, winner) })
    return
  }
  w.possession = { kind: "loose" }
}

const ballTick = (w: Work): void => {
  const pos = w.possession
  if (pos.kind === "owned") {
    const owner = w.player(pos.playerId)
    const facing = len(owner.vel) > 0.2 ? norm(owner.vel) : { x: dirOf(owner.side, w.period), y: 0 }
    const at = add(owner.pos, scale(facing, 0.35))
    w.ball = { pos: { x: at.x, y: at.y, z: 0 }, vel: { x: owner.vel.x, y: owner.vel.y, z: 0 } }
    return
  }
  if (pos.kind === "dead") return
  if (pos.kind === "in_flight") {
    const f = pos.flight
    if (w.tick === f.releaseTick) return
    if (f.path) {
      const t = Math.min(1, (w.tick - f.releaseTick) / Math.max(1, f.resolveTick - f.releaseTick))
      const lerp = (a: number, b: number) => a + (b - a) * t
      const prev = w.ball.pos
      const next: Vec3 = { x: lerp(f.path.from.x, f.path.to.x), y: lerp(f.path.from.y, f.path.to.y), z: lerp(f.path.from.z, f.path.to.z) }
      w.ball = { pos: next, vel: { x: (next.x - prev.x) / w.dt, y: (next.y - prev.y) / w.dt, z: (next.z - prev.z) / w.dt } }
    } else w.ball = stepBall(w.ball, w.dt, w.p)
    if (w.tick >= f.resolveTick) resolveFlightNow(w, f)
    return
  }
  // loose
  const prevPos = w.ball.pos
  w.ball = stepBall(w.ball, w.dt, w.p)
  const flat = { x: w.ball.pos.x, y: w.ball.pos.y }
  const cross = goalLineCrossing(prevPos, w.ball.pos)
  if (cross?.inGoal) {
    // A loose ball over the line between the posts (judged where it crossed) is a goal for the side
    // attacking that end; an own goal if the defending side touched it last.
    const scoringSide: Side = sideAttacking(cross.x, w.period)
    const toucher = w.lastTouch ? w.player(w.lastTouch.playerId) : null
    const own = toucher !== null && toucher.side !== scoringSide
    const at = { x: cross.x, y: cross.y }
    w.emit({ ...w.pending("goal", toucher, at, { scorer_id: toucher?.id ?? null, own_goal: own, from: "loose_ball" }), team_id: w.teamId(scoringSide) })
    w.addGoal(scoringSide)
    startRestart(w, { restart: "kickoff", side: other(scoringSide), at: { x: 0, y: 0 } })
    return
  }
  if (!inPitch(flat)) {
    w.emit(w.pending("ball_out", null, flat, { side: Math.abs(flat.y) > PITCH.halfW ? "touchline" : "byline", last_touch_team: w.lastTouch ? w.teamId(w.lastTouch.side) : null }))
    startRestart(w, restartFromOut(w.lastTouch?.side ?? null, w.ball.pos, w.period))
    return
  }
  if (w.ball.pos.z > w.p.kinematics.controlHeightM) return
  const blocked = pos.noTouchId !== undefined && w.tick < (pos.noTouchUntil ?? 0) ? pos.noTouchId : null
  const reach = w.p.kinematics.reachM
  const eligible = w.active().filter((pl) => pl.id !== blocked).sort((a, b) => dist(a.pos, flat) - dist(b.pos, flat))
  const first = eligible[0]
  if (!first || dist(first.pos, flat) > reach) return
  // An opponent who can also get there contests it: a ground duel decides who comes away with the ball.
  const rival = eligible.find((pl) => pl.side !== first.side && dist(pl.pos, flat) <= reach + w.p.groundDuel.contestM)
  let winner = first
  if (rival) {
    const g = w.p.groundDuel
    const skill = (pl: PlayerState) => (pl.attrs.tackling + pl.attrs.dribbling) / 2
    const pFirst = 1 / (1 + Math.exp(-(g.bSkill * (skill(first) - skill(rival)) + g.bReach * (dist(rival.pos, flat) - dist(first.pos, flat)))))
    winner = w.rng.duel.chance(pFirst) ? first : rival
    const loser = winner === first ? rival : first
    w.emit(w.pending("ground_duel", winner, flat, { kind: "loose_ball", winner_id: winner.id, loser_id: loser.id }))
  }
  changePossession(w, winner, w.pending("ball_recovery", winner, flat, { kind: "loose_ball" }))
}

// ---------------------------------------------------------------- movement

/** How far from the goal line a keeper walks with the ball before releasing it (inside the 16.5 m box). */
const KEEPER_RELEASE_M = 14
/** A keeper within this distance of his release depth has walked as far as he will with the ball in his hands. */
const KEEPER_SPOT_M = 1

const keeperAtReleaseSpot = (w: Work, pl: PlayerState): boolean =>
  attackX(pl.side, pl.pos.x, w.period) >= -(PITCH.halfL - KEEPER_RELEASE_M) - KEEPER_SPOT_M

// ================================================================ P2 positioning

/** True while a restart taken by the team's own keeper (a goal kick) is being set up: the build-up row applies, as in his hands (Ruling 7). */
const keeperRestart = (w: Work): boolean => {
  const ph = w.phase
  return ph.kind === "restart" && ph.restart !== "kickoff" && takerFor(w, ph).role === "GK"
}

/**
 * This tick's row for each team: with the ball, without it, or with its own keeper holding it or restarting (G4); loose
 * and dead balls keep the rows, and so does a deflection in flight (a clearance too with clearanceLoose). A new side in
 * possession commits after positioning.commitS (restarts and keeper catches at once). Also returns the pending side.
 */
const rowsNow = (w: Work): { rows: Record<Side, ShapeRow>; pending: AnchorState["pending"] } => {
  const pp = w.p.positioning
  const pos = w.possession
  const owner = pos.kind === "owned" ? w.player(pos.playerId) : null
  const flight = pos.kind === "in_flight" ? pos.flight : null
  const loose = flight !== null && (flight.kind === "deflection" || (flight.kind === "clearance" && pp.clearanceLoose > 0))
  const raw: Side | null = owner ? owner.side : flight ? (loose ? null : flight.side) : w.phase.kind === "restart" ? w.phase.side : null
  const keeper = owner ? owner.role === "GK" : keeperRestart(w)
  const prev = w.anchor?.teams
  const committed: Side | null = !prev
    ? null
    : prev.home.row !== "out" && prev.away.row === "out"
      ? "home"
      : prev.away.row !== "out" && prev.home.row === "out"
        ? "away"
        : null
  const c = commitSide(committed, raw, w.phase.kind === "restart" || keeper, w.anchor?.pending, w.tick, Math.round(pp.commitS / w.dt))
  return {
    rows: {
      home: rowFor("home", c.side, keeper, prev?.home.row ?? (raw === "away" ? "out" : "in")),
      away: rowFor("away", c.side, keeper, prev?.away.row ?? (raw === "home" ? "out" : "in"))
    },
    pending: c.pending
  }
}

/** Per-tick positioning context, built once per tick before anyone moves: each side's slot geometry and the opponents' last defender. */
interface PosTick {
  readonly geo: Readonly<Record<Side, ReadonlyArray<SlotGeometry>>>
  readonly lastDefU: Readonly<Record<Side, number>>
}
const posTicks = new WeakMap<Work, PosTick>()
const posTick = (w: Work): PosTick => {
  const hit = posTicks.get(w)
  if (hit) return hit
  const geoOf = (side: Side) => {
    const f = teamOf(w.cfg, side).formation
    return FORMATIONS[f].map((_, i) => slotGeometry(f, FORMATIONS[f], i))
  }
  const c: PosTick = {
    geo: { home: geoOf("home"), away: geoOf("away") },
    lastDefU: { home: lastDefenderAttackX("home", w.period, w.active("away")), away: lastDefenderAttackX("away", w.period, w.active("home")) }
  }
  posTicks.set(w, c)
  return c
}

const groupFor = (w: Work, pl: PlayerState): PosGroup => posTick(w).geo[pl.side][pl.slot]!.group

/**
 * Once per tick, before anyone moves: the per-tick context, the team rows and ball ring (anchor.ts), then drift
 * (drift.ts). While a restart is set up, and at the start of a period, the ring holds the restart spot. Nothing with the rule off.
 */
const advancePositioning = (w: Work): void => {
  const pos = w.p.positioning
  if (pos.rule <= 0) return
  posTick(w)
  const ph = w.phase
  const held = ph.kind === "restart" ? ph.at : null
  const ball = held ?? { x: w.ball.pos.x, y: w.ball.pos.y }
  const { rows, pending } = rowsNow(w)
  let s0 = w.anchor ?? initAnchorState(ball, w.dt, pos, rows)
  if (held || s0.period !== w.period) s0 = holdBall(s0, ball, w.period)
  const s = advanceRows(s0, w.tick, ball, rows, w.dt, pos)
  const outfield = w.active().filter((p) => p.role !== "GK").map((p) => ({ id: p.id, group: groupFor(w, p) }))
  // While a restart is set up the drift runs at deadRate of real time (0 freezes it).
  const driftDt = ph.kind === "restart" ? w.dt * pos.drift.deadRate : w.dt
  const { pending: _, ...next } = advanceDrift(s, outfield, driftDt, pos.drift, w.rng.drift)
  w.anchor = pending ? { ...next, pending } : next
}

/**
 * The rule-table context for a player: his blend, his drift (none for keepers; weighted by the blend's out share; a back
 * line's own depth drift damped out of possession) and the caps that apply now.
 */
const anchorCtx = (w: Work, pl: PlayerState, blend: Blend) => {
  const st = w.anchor!
  const c = posTick(w)
  const geo = c.geo[pl.side][pl.slot]!
  // A back line without the ball holds a flat line: its players keep backLineOutU of their own depth drift, by the out share.
  const outU = blend.mix ? outShare(blend.mix.u) : (blend.from === "out" ? 1 - blend.lamU : 0) + (blend.to === "out" ? blend.lamU : 0)
  const back = geo.group === "CB" || geo.group === "FB" || geo.group === "WB"
  const uScale = back ? 1 - (1 - w.p.positioning.drift.backLineOutU) * outU : 1
  const outY = blend.mix ? outShare(blend.mix.y) : (blend.from === "out" ? 1 - blend.lamY : 0) + (blend.to === "out" ? blend.lamY : 0)
  const sScale = 1 - (1 - w.p.positioning.drift.outS) * outY
  const drift =
    geo.group === "GK"
      ? { u: 0, y: 0 }
      : blend.mix
        ? driftFor(st, pl.side, pl.id, outShare(blend.mix.u), outShare(blend.mix.y), "in", "out", geo.sigma, uScale, sScale)
        : driftFor(st, pl.side, pl.id, blend.lamU, blend.lamY, blend.from, blend.to, geo.sigma, uScale, sScale)
  return {
    pos: w.p.positioning,
    input: { blend, drift, lastDefU: c.lastDefU[pl.side], vsKeeper: st.teams[other(pl.side)].row === "gk" }
  }
}

/**
 * Where a player's shape puts him in open play (also the marking anchor): the rule table against the lagged ball (the
 * keeper against the current ball: his line rule is measured on it), or the old template.
 */
const shapeTarget = (w: Work, pl: PlayerState, ballFlat: Vec2, inPossession: boolean): Vec2 => {
  const team = teamOf(w.cfg, pl.side)
  const st = w.anchor
  if (w.p.positioning.rule <= 0 || !st)
    return anchorFor(team.formation, pl.slot, pl.side, w.period, ballFlat, team.style, inPossession, w.p.shape)
  const group = groupFor(w, pl)
  const blend = blendFor(st.teams[pl.side], group, w.tick, w.dt, w.p.positioning)
  const ball = group === "GK" ? ballFlat : lagBall(st)
  return anchorFor(team.formation, pl.slot, pl.side, w.period, ball, team.style, inPossession, w.p.shape, anchorCtx(w, pl, blend))
}

/**
 * For tests (P4 seams): the working copy of state `s` at its own tick, as the seams see it mid-step.
 * @internal
 */
export const workAt = (s: MatchState): Work => {
  const w = new Work(s)
  w.tick = s.tick
  return w
}

/**
 * For tests: the open-play shape target the seam gives `playerId` at state `s` (its tick, anchor state and positions).
 * @internal
 */
export const shapeTargetAt = (s: MatchState, playerId: string): Vec2 => {
  const w = new Work(s)
  w.tick = s.tick
  const pl = w.player(playerId)
  const pos = w.possession
  const possSide = pos.kind === "owned" ? w.player(pos.playerId).side : pos.kind === "in_flight" ? pos.flight.side : null
  return shapeTarget(w, pl, { x: w.ball.pos.x, y: w.ball.pos.y }, possSide === pl.side)
}

/** A player's spot while a restart (other than a kickoff) is set up: the rule table settled at the restart spot, or the old template.
 *  The taking side settles in the build-up row when its own keeper takes it (Ruling 7), else "in"; the other side "out". */
const restartTarget = (w: Work, pl: PlayerState, at: Vec2, inPossession: boolean): Vec2 => {
  const team = teamOf(w.cfg, pl.side)
  if (w.p.positioning.rule <= 0 || !w.anchor)
    return anchorFor(team.formation, pl.slot, pl.side, w.period, at, team.style, inPossession, w.p.shape)
  const row: ShapeRow = inPossession ? (keeperRestart(w) ? "gk" : "in") : "out"
  return anchorFor(team.formation, pl.slot, pl.side, w.period, at, team.style, inPossession, w.p.shape, anchorCtx(w, pl, settled(row)))
}

// ================================================================ end of P2 positioning seam

/** Where a player heads this tick and how fast; timeLeft for on-time steering to a ball that arrives at a known tick. */
export interface MoveTarget {
  readonly target: Vec2
  readonly speedCap: number
  readonly timeLeft?: number
}

// ================================================================ P4 transition seam (plan 8d Task 6 owns this block)

/** A4: `loser` has just lost the ball in live play, the ball at `at` (counter stream for the joins). rule 0: nothing. @internal */
export const noteLoss = (_w: Work, _loser: Side, _at: Vec2): void => {}

/** A4: whether `side` is counter-pressing now (its hazard-started team press is off). rule 0: never. @internal */
export const inCounterWindow = (_w: Work, _side: Side): boolean => false

/** A4: a losing player's movement in a transition (counter-press, reaction pause, recovery run) over `base`. rule 0: `base` itself. @internal */
export const transitionMove = (_w: Work, _pl: PlayerState, base: MoveTarget, _possSide: Side | null): MoveTarget => base

// ================================================================ end of P4 transition seam

// ================================================================ P4 team-press seam (plan 8d Task 7 owns this block)

/**
 * A5: an out-of-possession outfielder's press on `owner` (movement stream): a live press carries on, else the nearest
 * defender (two in a scripted surge) may start one at the hazard. Null when he does not press. rule 0: the old press.
 * @internal
 */
export const teamPressMove = (w: Work, pl: PlayerState, owner: PlayerState, vmax: number, keeperFactor: number): MoveTarget | null => {
  if (pl.intent.kind === "press" && w.tick < pl.intentUntil && pl.intent.targetId === owner.id)
    return { target: interceptPoint(pl.pos, vmax, owner.pos, owner.vel), speedCap: vmax }
  const defenders = w.active(pl.side).filter((x) => x.role !== "GK").sort((a, b) => dist(a.pos, owner.pos) - dist(b.pos, owner.pos))
  // The nearest defender presses; in a scripted press surge the two nearest do, from further away.
  const surge = w.mods(pl.side).surge
  const presser = surge ? defenders.slice(0, 2).some((x) => x.id === pl.id) : defenders[0]?.id === pl.id
  if (presser && dist(pl.pos, owner.pos) < (surge ? 25 : 18)) {
    const style = teamOf(w.cfg, pl.side).style
    const urgency = 1 + w.p.defending.boxIntensity * danger(pl.side, w.period, owner.pos)
    if (w.rng.movement.chance(hazard(w.p.defending.pressRatePerS * (0.4 + 1.2 * style.pressIntensity) * urgency * w.mods(pl.side).press * keeperFactor * triggerFactor(w, pl), w.dt))) {
      w.setPlayer({ ...pl, intent: { kind: "press", targetId: owner.id }, intentUntil: w.tick + Math.round(w.rng.movement.range(2, 4) / w.dt) })
      return { target: interceptPoint(pl.pos, vmax, owner.pos, owner.vel), speedCap: vmax }
    }
  }
  return null
}

/** A5: `receiver` has just received a completed pass from flight `f` (the back-to-goal trigger). rule 0: nothing. @internal */
export const noteReception = (_w: Work, _receiver: PlayerState, _f: Flight): void => {}

// ================================================================ end of P4 team-press seam

// ================================================================ P4 marking seam (plan 8d Task 8 owns this block)

/** A5: the marking spot for defender `defId` (anchor `anchor`) on `attacker`, the ball at `ballFlat`. rule 0: goal-side marking (markTarget). @internal */
export const markSpot = (w: Work, defSide: Side, _defId: string, anchor: Vec2, attacker: PlayerState, _ballFlat: Vec2): Vec2 =>
  markTarget(anchor, attacker.pos, defSide, w.period, w.p.marking.goalSideM, w.p.marking.weight, w.p.marking.widthSlackM)

// ================================================================ end of P4 marking seam

const moveTarget = (
  w: Work,
  pl: PlayerState,
  ballFlat: Vec2,
  possSide: Side | null,
  marks: ReadonlyMap<string, Vec2> | null,
  sup: SupportTick | null
): MoveTarget => {
  const team = teamOf(w.cfg, pl.side)
  const vmax = vmaxFor(pl, pl.energy, w.p)
  const shape = () => {
    const target = shapeTarget(w, pl, ballFlat, possSide === pl.side)
    return { target, speedCap: shapeSpeedCap(w, pl, target, vmax) }
  }
  const ph = w.phase
  if (ph.kind === "restart") {
    if (takerFor(w, ph).id === pl.id) return { target: ph.at, speedCap: vmax * 0.8 }
    const a = restartTarget(w, pl, ph.at, ph.side === pl.side)
    if (ph.restart === "kickoff") return { target: kickoffAnchor(team.formation, pl.slot, pl.side, w.period, team.style), speedCap: vmax * 0.6 }
    if (pl.side !== ph.side && dist(a, ph.at) < 9.15 && pl.role !== "GK") {
      const away = add(ph.at, scale(norm(sub(a, ph.at)), 9.5))
      return { target: clampToPitch(away), speedCap: vmax * 0.6 }
    }
    return { target: a, speedCap: vmax * 0.6 }
  }
  const pos = w.possession
  if (pos.kind === "owned" && pos.playerId === pl.id) {
    const opps = w.active(other(pl.side))
    if (pl.intent.kind === "carry" && w.tick < pl.intentUntil) {
      const dir = steerCarry(pl.intent.dir, pl.pos, opps, w.p.carry.avoidM)
      return { target: clampToPitch(add(pl.pos, scale(dir, 5)), 1), speedCap: pl.intent.speed }
    }
    // holdSpeed 0 switches the walking off: the carrier stands on the ball (the behaviour before it).
    if (w.p.carry.holdSpeed <= 0) {
      const shield = pl.role === "GK" ? null : shieldTarget(pl.pos, opps, w.p.carry.shieldM)
      return shield ? { target: shield, speedCap: w.p.carry.shieldSpeed } : { target: pl.pos, speedCap: 1 }
    }
    // A keeper with the ball walks to the edge of the box before letting it go.
    if (pl.role === "GK") return { target: { x: -dirOf(pl.side, w.period) * (PITCH.halfL - KEEPER_RELEASE_M), y: pl.pos.y * 0.5 }, speedCap: w.p.carry.holdSpeed }
    const shield = shieldTarget(pl.pos, opps, w.p.carry.shieldM)
    if (shield) return { target: shield, speedCap: w.p.carry.shieldSpeed }
    // Nobody close: walk the ball forwards into space (players do not stand on the ball).
    const dir = steerCarry({ x: dirOf(pl.side, w.period), y: 0 }, pl.pos, opps, w.p.carry.avoidM)
    return { target: clampToPitch(add(pl.pos, scale(dir, 3)), 1), speedCap: w.p.carry.holdSpeed }
  }
  if (pos.kind === "in_flight" && pos.flight.winnerId === pl.id && pl.intent.kind === "chase")
    return { target: pl.intent.target, speedCap: vmax, timeLeft: Math.max(1, pos.flight.resolveTick - w.tick) * w.dt }
  if (pos.kind === "loose") {
    const chasers = w.active(pl.side).sort((a, b) => dist(a.pos, ballFlat) - dist(b.pos, ballFlat)).slice(0, 2)
    if (chasers.some((c) => c.id === pl.id) && pl.role !== "GK")
      return { target: interceptPoint(pl.pos, vmax, ballFlat, { x: w.ball.vel.x, y: w.ball.vel.y }), speedCap: vmax }
  }
  if (pl.role === "GK") {
    // Close down a ball carrier who gets near goal: stand between them and the goal centre, 2.5 m off the ball.
    if (pos.kind === "owned" && possSide !== pl.side) {
      const owner = w.player(pos.playerId)
      const goal = { x: -dirOf(pl.side, w.period) * PITCH.halfL, y: 0 }
      if (dist(owner.pos, goal) < w.p.defending.keeperRushM) return { target: add(owner.pos, scale(norm(sub(goal, owner.pos)), 2.5)), speedCap: vmax }
    }
    return shape()
  }
  if (pos.kind === "owned" && possSide !== pl.side) {
    const owner = w.player(pos.playerId)
    // Nobody presses a keeper with the ball in his hands (marking carries on); at his feet he is pressed less (feetPressFactor).
    const keeperHolding = w.p.keeper.handsRule > 0 && owner.role === "GK" && pos.inHands === true && inOwnBox(owner.side, w.period, owner.pos)
    const keeperFactor = w.p.keeper.handsRule > 0 && owner.role === "GK" ? w.p.keeper.feetPressFactor : 1
    // A side counter-pressing (A4) has its hazard-started team press off.
    if (!keeperHolding && !inCounterWindow(w, pl.side)) {
      const tp = teamPressMove(w, pl, owner, vmax, keeperFactor)
      if (tp) return tp
    }
  }
  const mark = possSide !== null && possSide !== pl.side ? marks?.get(pl.id) : undefined
  if (mark) return { target: mark, speedCap: markSpeedCap(w, pl, mark, vmax) }
  if (pos.kind === "owned" && possSide === pl.side && (pl.role === "ST" || pl.role === "W" || pl.role === "AM")) {
    if (pl.intent.kind === "run_in_behind" && w.tick < pl.intentUntil) return { target: pl.intent.target, speedCap: vmax }
    const owner = w.player(pos.playerId)
    if (attackX(pl.side, owner.pos.x, w.period) > -20 && w.rng.movement.chance(hazard(w.p.runs.runInBehindRatePerS * triggerFactor(w, pl), w.dt))) {
      const lastDef = lastDefenderAttackX(pl.side, w.period, w.active(other(pl.side)))
      const target = clampToPitch({ x: dirOf(pl.side, w.period) * Math.min(lastDef + 6, PITCH.halfL - 6), y: pl.pos.y * 0.8 }, 2)
      w.setPlayer({ ...pl, intent: { kind: "run_in_behind", target }, intentUntil: w.tick + Math.round(w.rng.movement.range(2, 3) / w.dt) })
      w.emit(w.pending("off_ball_run", pl, pl.pos, { kind: "in_behind", ball_carrier_id: owner.id }, target))
      return { target, speedCap: vmax }
    }
  }
  const sp = w.p.support
  // Rule 1 (P3 Task 10d): supporters come short only while the carrier is pressed, onto a ring distM out; everyone else
  // keeps the spacing from an outfield carrier (real nearest teammates 8.9 / 13.3 / 17.2 m, offball-report T14). The gate,
  // the supporters and the forward-line cap are judged once per tick before anyone moves (supportTick).
  if (sup && possSide === pl.side) {
    if (sup.supporters.has(pl.id))
      return { target: supportSpot(sup.owner.pos, shape().target, pl.side, w.period, sup.opps, sp.distM, true), speedCap: vmax * sp.speedShare }
    const s = shape()
    const spaceM = spacingFor(sup.owner.pos, pl.side, w.period, sp)
    if (spaceM <= 0 || sup.owner.role === "GK") return s
    const target = spacedTarget(sup.owner.pos, s.target, pl.side, w.period, spaceM, sup.capU)
    return target === s.target ? s : { target, speedCap: shapeSpeedCap(w, pl, target, vmax) }
  }
  if (pos.kind === "owned" && possSide === pl.side && sp.count > 0) {
    const owner = w.player(pos.playerId)
    const supporters = w
      .active(pl.side)
      .filter((x) => x.id !== owner.id && x.role !== "GK" && !(x.intent.kind === "run_in_behind" && w.tick < x.intentUntil))
      .sort((a, b) => dist(a.pos, owner.pos) - dist(b.pos, owner.pos))
      .slice(0, sp.count)
    if (supporters.some((x) => x.id === pl.id))
      return { target: supportSpot(owner.pos, shape().target, pl.side, w.period, w.active(other(pl.side)), sp.distM), speedCap: vmax * sp.speedShare }
  }
  return shape()
}

/** This tick's marking targets for `defSide`: outfield defenders who are not pressing, paired with attackers other than the carrier. */
const marksFor = (w: Work, defSide: Side, ballFlat: Vec2): Map<string, Vec2> => {
  const ownerId = w.possession.kind === "owned" ? w.possession.playerId : null
  const defenders = w
    .active(defSide)
    .filter((x) => x.role !== "GK" && !(x.intent.kind === "press" && w.tick < x.intentUntil) && !(x.intent.kind === "recover" && w.tick < x.intentUntil))
    .map((x) => ({ id: x.id, anchor: shapeTarget(w, x, ballFlat, false) }))
  const anchors = new Map(defenders.map((d) => [d.id, d.anchor]))
  const attackers = w.active(other(defSide)).filter((x) => x.role !== "GK" && x.id !== ownerId)
  const out = new Map<string, Vec2>()
  for (const [id, a] of assignMarks(defenders, attackers, w.p.marking.radiusM))
    out.set(id, markSpot(w, defSide, id, anchors.get(id)!, a, ballFlat))
  return out
}

/** Support rule 1, judged once per tick before anyone moves: the carrier, the pressure gate, who comes short, the forward-line cap. */
interface SupportTick {
  readonly owner: PlayerState
  readonly opps: ReadonlyArray<PlayerState>
  readonly supporters: ReadonlySet<string>
  /** Team-frame u that spacing may not push a teammate past: the opponents' last outfield defender minus lineCapM. */
  readonly capU: number
}

/** The support rule 1 context for this tick, updating the gate's hysteresis state; null (and no gate) when the rule is off or nobody has the ball. */
const supportTick = (w: Work): SupportTick | null => {
  const sp = w.p.support
  if (sp.rule <= 0 || w.possession.kind !== "owned") {
    w.supportGate = undefined
    return null
  }
  const owner = w.player(w.possession.playerId)
  const opps = w.active(other(owner.side))
  w.supportGate = supportGate(w.supportGate, owner.id, owner.pos, opps, sp, w.tick, w.dt)
  const n = supportersWanted(w.supportGate.pressed, sp)
  const supporters = new Set(
    n > 0
      ? w
          .active(owner.side)
          .filter((x) => x.id !== owner.id && x.role !== "GK" && !(x.intent.kind === "run_in_behind" && w.tick < x.intentUntil))
          .sort((a, b) => dist(a.pos, owner.pos) - dist(b.pos, owner.pos))
          .slice(0, n)
          .map((x) => x.id)
      : []
  )
  return { owner, opps, supporters, capU: lastDefenderAttackX(owner.side, w.period, opps) - w.p.positioning.lineCapM }
}

const moveAll = (w: Work): void => {
  const ballFlat = { x: w.ball.pos.x, y: w.ball.pos.y }
  const possSide =
    w.possession.kind === "owned" ? w.player(w.possession.playerId).side : w.possession.kind === "in_flight" ? w.possession.flight.side : null
  const marks = possSide !== null && w.p.marking.weight > 0 ? marksFor(w, other(possSide), ballFlat) : null
  const sup = supportTick(w)
  for (const id of w.players.map((x) => x.id)) {
    const pl = w.player(id)
    if (pl.sentOff) continue
    const { target, speedCap, timeLeft } = transitionMove(w, pl, moveTarget(w, pl, ballFlat, possSide, marks, sup), possSide)
    const cur = w.player(id)
    const vmax = Math.min(speedCap, vmaxFor(cur, cur.energy, w.p))
    const mates = w.active(cur.side).filter((x) => x.id !== cur.id).map((x) => x.pos)
    const sep = separation(cur.pos, mates)
    // Chasing a ball that will arrive at a known tick uses on-time steering (matches resolveFlight's reach model).
    const m = motionFor(cur, w.p)
    const v = Math.max(0.5, vmax)
    const next =
      timeLeft !== undefined
        ? approachBy(cur.pos, cur.vel, target, v, m, w.dt, timeLeft)
        : approach(cur.pos, cur.vel, add(target, scale(sep, 2)), v, m, w.dt)
    const speed = len(next.vel)
    const energy = drainEnergy(cur.energy, speed, cur.attrs.stamina, w.dt, w.p)
    trackLoad(w, id, speed)
    w.setPlayer({ ...cur, pos: clampToPitch(next.pos, -2), vel: next.vel, energy })
  }
}

// ================================================================ P2 movement

/** Speed cap moving into shape: relaxed (A0) arrives in relaxArriveS at up to relaxCap of top speed; else shapeSpeedShare. */
const shapeSpeedCap = (w: Work, pl: PlayerState, target: Vec2, vmax: number): number =>
  w.p.movement.relaxed > 0 ? relaxedSpeed(dist(pl.pos, target), vmax, w.p.movement.relaxCap, w.p.movement.relaxArriveS) : vmax * w.p.movement.shapeSpeedShare

/** Speed cap moving to a marking spot: relaxed only with relaxMarks (the spec keeps marking speeds). */
const markSpeedCap = (w: Work, pl: PlayerState, target: Vec2, vmax: number): number =>
  w.p.movement.relaxed > 0 && w.p.movement.relaxMarks > 0
    ? relaxedSpeed(dist(pl.pos, target), vmax, w.p.movement.relaxCap, w.p.movement.relaxArriveS)
    : vmax * w.p.movement.shapeSpeedShare

/** Multiplier on new high-intensity triggers (pressing, runs in behind): tiring (F1), else 1. */
const triggerFactor = (w: Work, pl: PlayerState): number =>
  w.p.fatigue.tiring > 0 ? tiringFactor(pl.energy, w.load?.[pl.id] ?? 0, w.p.fatigue) : 1

/** After a player moves: his recent high-intensity metres (only with tiring on). */
const trackLoad = (w: Work, id: string, speed: number): void => {
  if (w.p.fatigue.tiring <= 0) return
  const load = (w.load ??= {})
  load[id] = loadAfter(load[id] ?? 0, speed, w.dt, w.p.fatigue)
}

// ================================================================ end of P2 movement seam

// ---------------------------------------------------------------- periods and frames

const frameOf = (w: Work): Frame => {
  const ownerId = w.possession.kind === "owned" ? w.possession.playerId : null
  const fp = (side: Side) =>
    w.active(side).map((pl) => ({
      id: pl.id,
      x: round2(pl.pos.x),
      y: round2(pl.pos.y),
      vel: round2(len(pl.vel)),
      // Expired intents fall back to "shape": the label says what the player is doing now.
      intent: pl.id === ownerId ? ("on_ball" as const) : w.tick < pl.intentUntil ? pl.intent.kind : ("shape" as const)
    }))
  const possSide =
    w.possession.kind === "owned" ? w.player(w.possession.playerId).side : w.possession.kind === "in_flight" ? w.possession.flight.side : null
  return {
    tick: w.tick,
    frame_id: w.periodTick,
    period: w.period,
    timestamp: new Date(w.periodStartMs + Math.round(w.periodTick * w.dt * 1000)).toISOString(),
    home: fp("home"),
    away: fp("away"),
    ball: { x: round2(w.ball.pos.x), y: round2(w.ball.pos.y), z: round2(w.ball.pos.z) },
    ball_in_play: w.phase.kind === "open_play",
    possession_side: possSide
  }
}

const endPeriod = (w: Work): StepResult => {
  w.tick -= 1
  w.periodTick -= 1
  // A carry under way ends at the whistle.
  if (w.possession.kind === "owned") finishCarry(w, w.player(w.possession.playerId))
  w.carry = null
  w.emit(w.pending("period_end", null, null, { period: w.period }))
  if (w.period === "second_half") {
    w.emit(w.pending("match_end", null, null, { home: w.score.home, away: w.score.away }))
    w.phase = { kind: "full_time" }
    return { state: w.toState(), frame: null, events: w.events }
  }
  const firstHalfMs = w.periodTicks * w.dt * 1000
  w.tick += 1
  w.period = "second_half"
  w.periodTick = 0
  w.periodStartTick = w.tick
  w.periodStartMs += firstHalfMs + HALF_TIME_MS
  w.periodTicks = samplePeriodTicks(w.cfg, w.rng.restart)
  // Same players (substitutes included) back in kickoff shape, a little recovered.
  w.players = w.players.map((pl) => {
    const team = teamOf(w.cfg, pl.side)
    return { ...pl, pos: kickoffAnchor(team.formation, pl.slot, pl.side, w.period, team.style), vel: { x: 0, y: 0 }, intent: { kind: "shape" }, intentUntil: 0, energy: Math.min(1, pl.energy + w.p.fatigue.halfTimeRecovery) }
  })
  w.phase = { kind: "restart", restart: "kickoff", side: "away", at: { x: 0, y: 0 }, resumeTick: w.tick }
  w.possession = { kind: "dead" }
  w.ball = { pos: { x: 0, y: 0, z: 0 }, vel: { x: 0, y: 0, z: 0 } }
  w.emit(w.pending("period_start", null, null, { period: "second_half" }))
  for (const side of ["home", "away"] as const)
    if ((teamOf(w.cfg, side).bench ?? []).length > 0 && w.rng.bench.chance(w.p.substitutions.halfTimeChance) && !isManaged(w.cfg, side)) makeSubs(w, side, 1, true)
  // With a manager the kickoff waits one tick: the state at the break is when they decide (Plan 4b).
  if (!w.cfg.managed?.length) handleRestart(w)
  return { state: w.toState(), frame: frameOf(w), events: w.events }
}

/** Advance the match by one tick. Pure: the input state is never mutated. */
export const step = (s: MatchState): StepResult => {
  if (s.phase.kind === "full_time") return { state: s, frame: null, events: [] }
  const w = new Work(s)
  if (s.tick === -1) {
    w.periodStartTick = 0
    w.emit(w.pending("match_start", null, null, { home: w.cfg.home.id, away: w.cfg.away.id }))
    w.emit(w.pending("period_start", null, null, { period: "first_half" }))
  }
  // The half ends when it is due, except while a set piece is being set up or the ball is in the air
  // (a flight lasts at most MAX_FLIGHT_S); the hard stop one minute later always applies.
  if (w.periodTick >= w.periodTicks && w.phase.kind !== "restart" && w.possession.kind !== "in_flight") return endPeriod(w)
  // The hard stop a minute later still lets a ball in the air land (a flight lasts at most MAX_FLIGHT_S).
  const hardStop = w.periodTicks + Math.round(60 / w.dt)
  if (w.periodTick >= hardStop && (w.possession.kind !== "in_flight" || w.periodTick >= hardStop + Math.round(MAX_FLIGHT_S / w.dt))) return endPeriod(w)
  if (w.phase.kind === "restart") {
    for (const side of ["home", "away"] as const) orderedSubs(w, side)
    handleRestart(w)
  }
  if (w.phase.kind === "open_play") ownedTick(w)
  cautions(w)
  advancePositioning(w)
  moveAll(w)
  ballTick(w)
  return { state: w.toState(), frame: frameOf(w), events: w.events }
}

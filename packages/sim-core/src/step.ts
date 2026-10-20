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
import { assignMarks, laneMarkTarget, markTarget, shieldTarget, spacedTarget, spacingFor, steerCarry, stepsOut, supportersWanted, supportGate, supportSpot } from "./offball.js"
import { approach, approachBy, drainEnergy, interceptPoint, motionFor, separation, vmaxFor } from "./kinematics.js"
import type { Action, Params } from "./params.js"
import { aerialWinShare, goalLineCrossing, keeperLetsRun, MAX_FLIGHT_S, resolveFlight, type Resolution } from "./resolve.js"
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
  type RestartPlan,
  type SetPieceLive,
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
import { setPieceKind, type SetPieceKind } from "./setpiece.js"
// ---- P3 imports, boot-block seam (plan 8c Task 3; plan 8d Task 9 inserts below this line)
import { bootBlocker } from "./deflect.js"

// ---- P3 imports, release seam (plan 8c Task 4; plan 8d Task 9 inserts below this line)
import { releaseDelayS } from "./release.js"

// ---- P4 imports, tackle seam (plan 8d Task 3 inserts below this line)
import { bearingOf, supportCount, tackleLogit } from "./duel.js"

// ---- P4 imports, foul seam (plan 8d Task 4 inserts below this line)
import { angleFactor, zoneFactor } from "./fouls.js"

// ---- P4 imports, transition seam (plan 8d Task 6 inserts below this line)
import { joinChance, pauseTarget, recoverRate, windowTicks } from "./transition.js"

// ---- P4 imports, team-press seam (plan 8d Task 7 inserts below this line)
import { backToGoalHolds, inOwnThird, pressLift, presserScore, shadowSpot } from "./press.js"

// ---- P5 imports, attacking set-piece seam (plan 8e Task 3 inserts below this line)
import { attackRoleSpot, attackTable, holdSpot, restKeepers, restKind, restSpots } from "./setpiece-attack.js"

// ---- P5 imports, defending set-piece seam (plan 8e Task 4 inserts below this line)
import { boxLayout, inSetPieceBox, wallPoint, wallSize, wallSpots } from "./setpiece-defend.js"
import { roleSpot, ySignOf } from "./setpiece.js"

// ---- P5 imports, restart-shape seam (plan 8e Task 5 inserts below this line)
// (roleSpot and ySignOf from ./setpiece.js are imported under the Task 4 marker above.)
import { kickoffLegal, outsideBox, throwShortIds } from "./setpiece-shapes.js"

// ---- P5 imports, dead-ball seam (plan 8e Task 6 inserts below this line)
import { restartDelayS, settleS, walkCap } from "./deadball.js"
import { deadKey } from "./setpiece.js"

// ---- P5 imports, keeper-restart seam (plan 8e Task 7 inserts below this line)

// ---- P5 imports, role-run seam (plan 8e Task 9 inserts below this line)
import { breakTarget, holdLineTarget, overlapEligible, overlapTarget } from "./runs.js"

// ---- P5 imports, rotation seam (plan 8e Task 10 inserts below this line)
import { dropTarget, insideTarget, invertTarget } from "./rotate.js"

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
  /** P5 plan for the restart being set up; absent while no P5 seam plans one, or in open play. */
  restartPlan: RestartPlan | undefined
  /** P5 set piece just taken (attacking set-piece seam); absent while none is live. */
  setPiece: SetPieceLive | undefined

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
    this.restartPlan = s.restartPlan
    this.setPiece = s.setPiece
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
      ...(this.press ? { press: this.press } : {}),
      ...(this.restartPlan ? { restartPlan: this.restartPlan } : {}),
      ...(this.setPiece ? { setPiece: this.setPiece } : {})
    }
  }
}

// ---------------------------------------------------------------- restarts

/** A restart to set up: its kind, the taking side and the spot. */
type RestartAt = { readonly restart: RestartKind; readonly side: Side; readonly at: Vec2 }
/** The restart phase (a restart being set up). */
type RestartPhase = Extract<Phase, { kind: "restart" }>
/** A seam's part of a restart's plan: any field but `kind`, which startRestart sets. */
type PlanPart = Partial<Omit<RestartPlan, "kind">>

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

const startRestart = (w: Work, r: RestartAt): void => {
  const resumeTick = w.tick + restartDelayTicks(w, r)
  w.phase = { kind: "restart", restart: r.restart, side: r.side, at: r.at, resumeTick }
  w.possession = { kind: "dead" }
  w.ball = { pos: { x: r.at.x, y: r.at.y, z: 0 }, vel: { x: 0, y: 0, z: 0 } }
  w.pressedBy = []
  // A restart is not a loss (P4 A4): it ends any transition.
  w.transition = undefined
  if (w.period === "second_half") for (const side of ["home", "away"] as const) subWindow(w, side)
  // P5 (plan 8e): the restart's plan, after any substitution, so it names the players on the pitch. Each seam sees the
  // fields before it (takerFor already knows the keeper choice); a plan holding nothing but its kind is dropped.
  const kind = setPieceKind(r.restart, r.at, r.side, w.period)
  w.restartPlan = { kind }
  w.restartPlan = { ...w.restartPlan, ...planDead(w, r, kind, resumeTick) }
  w.restartPlan = { ...w.restartPlan, ...planKeeper(w, r, kind) }
  w.restartPlan = { ...w.restartPlan, ...planAttack(w, r, kind) }
  w.restartPlan = { ...w.restartPlan, ...planDefend(w, r, kind) }
  if (Object.values(w.restartPlan).filter((v) => v !== undefined).length === 1) w.restartPlan = undefined
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

// ================================================================ P5 attacking set-piece seam (plan 8e Task 3 owns this block)

/**
 * S4: the attacking side's part of a restart's plan: at corners, attacking free kicks and attacking-third throw-ins, the
 * rest-defence keepers (restKeepers over the side sorted deepest first, the taker as takerFor sees him now) and their
 * spots (setpiece stream); any other kind: nothing, no draw. Under rule 1 every restart also ends the last set piece's
 * run (w.setPiece). rule 0: nothing, no draw, no write. @internal
 */
export const planAttack = (w: Work, r: RestartAt, kind: SetPieceKind): PlanPart => {
  const s = w.p.setAttack
  if (s.rule <= 0) return {}
  // The ball is dead: any run from the last set piece is over.
  w.setPiece = undefined
  const rk = restKind(kind)
  if (rk === null) return {}
  const rng = w.rng.setpiece
  // Deepest first (u in the side's frame, where each player stands now; stable, so slot order breaks ties), so
  // restKeepers keeps the deepest FB or CM first.
  const byDepth = w.active(r.side).sort((a, b) => attackX(r.side, a.pos.x, w.period) - attackX(r.side, b.pos.x, w.period))
  const restKeep = restKeepers(byDepth, takerFor(w, r).id, s.restKeep[rk], rng)
  return { restKeep, restSpot: restSpots(restKeep, r.side, w.period, s, rng) }
}

/** S1: `pl`'s table spot at a set piece of `kind` taken by his side, or null when the kind has no table. */
const tableSpotOf = (w: Work, pl: PlayerState, kind: SetPieceKind): Vec2 | null => {
  const table = attackTable(kind, w.p.setAttack)
  if (!table) return null
  const team = teamOf(w.cfg, pl.side)
  return attackRoleSpot(table, pl.role, kickoffAnchor(team.formation, pl.slot, pl.side, w.period, team.style), pl.side, w.period)
}

/**
 * S1/S4: a restarting-side player's spot while the restart is set up: a rest keeper his rest spot; at a corner or an
 * attacking free kick, the keeper his table spot and everyone else his table spot held holdBackM short (F31); null
 * otherwise (falls through to shapeSpot). rule 0: null. @internal
 */
export const attackSpot = (w: Work, pl: PlayerState, ph: RestartPhase): Vec2 | null => {
  const s = w.p.setAttack
  const plan = w.restartPlan
  if (s.rule <= 0 || !plan || pl.side !== ph.side) return null
  const rest = plan.restSpot?.[pl.id]
  if (rest) return rest
  const spot = tableSpotOf(w, pl, plan.kind)
  if (!spot) return null
  return pl.role === "GK" ? spot : holdSpot(spot, pl.side, w.period, s.holdBackM)
}

/**
 * S1: the restart has just been taken by `taker` (handleRestart): at a set piece with a table, notes it live (with its
 * rest keepers, before the plan is cleared, F2) for the run at the kick; any other restart ends a live one. rule 0:
 * nothing. @internal
 */
export const noteSetPiece = (w: Work, ph: RestartPhase, taker: PlayerState): void => {
  if (w.p.setAttack.rule <= 0) return
  const kind = w.restartPlan?.kind ?? setPieceKind(ph.restart, ph.at, ph.side, w.period)
  const restKeep = w.restartPlan?.restKeep
  w.setPiece = attackTable(kind, w.p.setAttack)
    ? { kind, side: ph.side, tick: w.tick, takerId: taker.id, ...(restKeep ? { restKeep } : {}) }
    : undefined
}

/**
 * S1: an attacker's run to his table spot just after the kick, at runSpeedShare x vmax, for runWindowS. Not for the
 * taker, the ball's owner, the flight's winner, the keeper, the rest keepers or the other side. The run ends after
 * runWindowS or while the other side has the ball. A pure query: w.setPiece stays as the record of the last set piece
 * (inert after its window) until the next restart's planAttack or noteSetPiece replaces it. rule 0: null. @internal
 */
export const setPieceRun = (w: Work, pl: PlayerState, vmax: number): MoveTarget | null => {
  const sp = w.setPiece
  const s = w.p.setAttack
  if (s.rule <= 0 || !sp) return null
  const pos = w.possession
  const lost =
    (pos.kind === "owned" && w.players.find((x) => x.id === pos.playerId)?.side !== sp.side) || (pos.kind === "in_flight" && pos.flight.side !== sp.side)
  if (w.tick - sp.tick >= Math.round(s.runWindowS / w.dt) || lost) return null
  if (pl.side !== sp.side || pl.role === "GK" || pl.id === sp.takerId || sp.restKeep?.includes(pl.id)) return null
  if (pos.kind === "owned" && pos.playerId === pl.id) return null
  if (pos.kind === "in_flight" && pos.flight.winnerId === pl.id) return null
  const spot = tableSpotOf(w, pl, sp.kind)
  return spot ? { target: clampToPitch(spot, 0.5), speedCap: s.runSpeedShare * vmax } : null
}

// ================================================================ end of P5 attacking set-piece seam

// ================================================================ P5 defending set-piece seam (plan 8e Task 4 owns this block)

/**
 * S2/S3: the defending side's part of a restart's plan (setpiece stream). At a central or wide attacking free kick: the
 * wall's size (wallSize), its members (the defending outfielders other than CBs nearest the wall point, ordered across
 * the line), each member's jitter U(-jitterM, 0), and at a wide one the outlet (the most advanced ST outside the wall,
 * with chance outletShare). Corners draw nothing. rule 0: nothing, no draw. @internal
 */
export const planDefend = (w: Work, r: RestartAt, kind: SetPieceKind): PlanPart => {
  const s = w.p.setDefend
  if (s.rule <= 0 || (kind !== "fk_central" && kind !== "fk_wide")) return {}
  const rng = w.rng.setpiece
  const defSide = other(r.side)
  const point = wallPoint(r.at, defSide, w.period, s)
  const pool = w.active(defSide).filter((pl) => pl.role !== "GK" && pl.role !== "CB")
  const n = Math.min(wallSize(kind, s, rng), pool.length)
  const dir = norm(sub(point, r.at))
  const across = (p: Vec2): number => dir.x * (p.y - r.at.y) - dir.y * (p.x - r.at.x)
  const wall = [...pool]
    .sort((a, b) => dist(a.pos, point) - dist(b.pos, point) || (a.id < b.id ? -1 : 1))
    .slice(0, n)
    .sort((a, b) => across(a.pos) - across(b.pos))
    .map((pl) => pl.id)
  const jitter = Object.fromEntries(wall.map((id) => [id, rng.range(-s.jitterM, 0)]))
  const up = kind === "fk_wide" && rng.chance(s.outletShare)
  const outlet = up
    ? w
        .active(defSide)
        .filter((pl) => pl.role === "ST" && !wall.includes(pl.id))
        .sort((a, b) => attackX(defSide, b.pos.x, w.period) - attackX(defSide, a.pos.x, w.period) || (a.id < b.id ? -1 : 1))[0]?.id
    : undefined
  return { ...(wall.length > 0 ? { wall, jitter } : {}), ...(outlet !== undefined ? { outlet } : {}) }
}

/**
 * S2/S3: a defending player's spot while a corner or an attacking free kick is set up; null falls through to shapeSpot
 * (and the old target with its 9.15 m push). Wall members stand on the wall (members who have left are skipped, so the
 * wall closes up); the outlet keeps his old target; at corners the keeper takes the table's spot on his line. The other
 * outfielders follow boxLayout: corners and wide free kicks fill the box (markers, zonal spots, table spots, one at the
 * edge), central ones mark only. Attackers count at their position when in the box, else at their attacking set-piece
 * spot when that is. rule 0: null. @internal
 */
export const defendSpot = (w: Work, pl: PlayerState, ph: RestartPhase): Vec2 | null => {
  const s = w.p.setDefend
  if (s.rule <= 0) return null
  const kind = setPieceKind(ph.restart, ph.at, ph.side, w.period)
  if (kind !== "corner" && kind !== "fk_wide" && kind !== "fk_central") return null
  if (pl.role === "GK") return kind === "corner" ? roleSpot(s.corner, "GK", 0, ph.side, w.period) : null
  const plan = w.restartPlan
  if (pl.id === plan?.outlet) return null
  const team = w.active(pl.side)
  const wall = (plan?.wall ?? []).filter((id) => team.some((x) => x.id === id))
  const wi = wall.indexOf(pl.id)
  if (wi >= 0) return wallSpots(ph.at, pl.side, w.period, wall.length, wall.map((id) => plan?.jitter?.[id] ?? 0), s)[wi]!
  const formation = teamOf(w.cfg, pl.side)
  const defs = team
    .filter((x) => x.role !== "GK" && !wall.includes(x.id) && x.id !== plan?.outlet)
    .map((x) => ({ id: x.id, role: x.role, ySign: ySignOf(kickoffAnchor(formation.formation, x.slot, x.side, w.period, formation.style)) }))
  const takerId = takerFor(w, ph).id
  const attackers = w.active(ph.side).flatMap((a) => {
    if (a.role === "GK" || a.id === takerId) return []
    const at = inSetPieceBox(a.pos, ph.side, w.period) ? a.pos : attackSpot(w, a, ph)
    return at && inSetPieceBox(at, ph.side, w.period) ? [{ ...a, pos: at }] : []
  })
  return boxLayout(defs, attackers, ph.at, pl.side, w.period, s, kind !== "fk_central").get(pl.id) ?? null
}

// ================================================================ end of P5 defending set-piece seam

// ================================================================ P5 restart-shape seam (plan 8e Task 5 owns this block)

/** S5-S7: a player's goal-kick, throw-in or kickoff spot (either side); null keeps the old target. rule 0: null. @internal */
export const shapeSpot = (w: Work, pl: PlayerState, ph: RestartPhase): Vec2 | null => {
  const sh = w.p.setShapes
  if (sh.rule <= 0) return null
  if (ph.restart === "goal_kick" || ph.restart === "kickoff") {
    // Role tables are in the restarting side's frame for both sides; the sign is the pitch side of his slot (ruling 4).
    const tables = ph.restart === "goal_kick" ? sh.goalKick : sh.kickoff
    const mine = pl.side === ph.side
    const slot = FORMATIONS[teamOf(w.cfg, pl.side).formation][pl.slot]!
    const spot = roleSpot(mine ? tables.att : tables.def, pl.role, ySignOf({ x: 0, y: slot.y * dirOf(pl.side, w.period) }), ph.side, w.period)
    if (ph.restart === "kickoff") return kickoffLegal(spot, pl.side, w.period, mine)
    return mine ? spot : outsideBox(spot, ph.side, w.period)
  }
  if (ph.restart !== "throw_in") return null
  const plan = throwPlan(w, ph)
  return (pl.side === ph.side ? plan.support : plan.marks).get(pl.id) ?? null
}

/** S6: one tick's short supporters and their markers (spots by player id). */
interface ThrowPlan { readonly tick: number; readonly at: Vec2; readonly support: ReadonlyMap<string, Vec2>; readonly marks: ReadonlyMap<string, Vec2> }
const throwPlans = new WeakMap<Work, ThrowPlan>()

/**
 * S6: the taker's `throwShort` nearest outfield teammates come short to the ring, and the defending side marks them
 * goal-side. Teammates are ranked, and opponents counted, by the restart anchor (not the live position), so the
 * trio, their spots and the pairs stay the same while players move; stateless. Computed once per tick for all 22 players.
 */
const throwPlan = (w: Work, ph: RestartPhase): ThrowPlan => {
  const hit = throwPlans.get(w)
  if (hit && hit.tick === w.tick && hit.at.x === ph.at.x && hit.at.y === ph.at.y) return hit
  const sh = w.p.setShapes
  const taker = takerFor(w, ph)
  const mates = w.active(ph.side).map((m) => ({ ...m, pos: restartTarget(w, m, ph.at, true) }))
  const ids = throwShortIds(mates, taker.id, ph.at, sh.throwShort)
  // The opponents count at their restart anchors too, so a marker walking toward his man cannot move the man's spot.
  const opps = w.active(other(ph.side)).map((d) => ({ ...d, pos: restartTarget(w, d, ph.at, false) }))
  const support = new Map<string, Vec2>()
  for (const id of ids) support.set(id, supportSpot(ph.at, mates.find((m) => m.id === id)!.pos, ph.side, w.period, opps, sh.throwShortM, true))
  const marks = new Map<string, Vec2>()
  if (support.size > 0) {
    const defSide = other(ph.side)
    const defenders = opps.filter((d) => d.role !== "GK").map((d) => ({ id: d.id, anchor: d.pos }))
    const supporters = ids.map((id) => ({ ...w.player(id), pos: support.get(id)! }))
    for (const [defId, att] of assignMarks(defenders, supporters, THROW_MARK_RADIUS_M))
      marks.set(defId, markTarget(defenders.find((d) => d.id === defId)!.anchor, att.pos, defSide, w.period, 1, sh.throwMarkWeight))
  }
  const plan = { tick: w.tick, at: ph.at, support, marks }
  throwPlans.set(w, plan)
  return plan
}

/** S6: a defender marks a short supporter only within this distance of his own spot (ruling 10). */
const THROW_MARK_RADIUS_M = 15

// ================================================================ end of P5 restart-shape seam

// ================================================================ P5 dead-ball seam (plan 8e Task 6 owns this block)

/**
 * S8: ticks from a restart's start to its resume tick. rule 0: timing.restartDelayS x U(0.7, 1.3) (restart stream). rule 1:
 * a lognormal delay at the real median of the restart's key at this minute (dead stream); a penalty keeps the old draw.
 * @internal
 */
export const restartDelayTicks = (w: Work, r: RestartAt): number => {
  const key = w.p.deadBall.rule === 1 ? deadKey(setPieceKind(r.restart, r.at, r.side, w.period)) : null
  if (key === null) return Math.round((w.p.timing.restartDelayS[r.restart] * w.rng.restart.range(0.7, 1.3)) / w.dt)
  return Math.round(restartDelayS(key, w.minute(), w.p.deadBall, w.rng.dead) / w.dt)
}

/**
 * S8: the dead-ball part of a restart's plan. rule 1: each player on the pitch, in order, draws his walking speed and his
 * settle time before `resumeTick` (his deadline); then the taker's pause (dead stream). rule 0: nothing, no draw. @internal
 */
export const planDead = (w: Work, r: RestartAt, kind: SetPieceKind, resumeTick: number): PlanPart => {
  const d = w.p.deadBall
  if (d.rule !== 1) return {}
  const rng = w.rng.dead
  const walkMps: Record<string, number> = {}
  const readyTick: Record<string, number> = {}
  for (const pl of w.active()) {
    walkMps[pl.id] = rng.range(d.walkMps[0], d.walkMps[1])
    readyTick[pl.id] = resumeTick - Math.round(settleS(kind, pl.side === r.side, d, rng) / w.dt)
  }
  const pauseTicks = Math.round(rng.range(d.takerPauseS[0], d.takerPauseS[1]) / w.dt)
  return { walkMps, readyTick, pauseTicks }
}

/**
 * S8: a player's movement while the ball is dead, over the restart dispatcher's `mt`: his walking pace, raised to arrive
 * by his deadline (walkCap; 0.8 x vmax within a tick of it). rule 0, no plan (the period kickoffs) or a player the plan
 * does not name (on since): `mt` itself. @internal
 */
export const deadMove = (w: Work, pl: PlayerState, mt: MoveTarget): MoveTarget => {
  const plan = w.restartPlan
  if (w.p.deadBall.rule !== 1 || plan === undefined) return mt
  const walk = plan.walkMps?.[pl.id]
  const ready = plan.readyTick?.[pl.id]
  if (walk === undefined || ready === undefined) return mt
  const secondsLeft = (ready - w.tick) * w.dt
  const vmax = vmaxFor(pl, pl.energy, w.p)
  return { ...mt, speedCap: walkCap(dist(pl.pos, mt.target), secondsLeft <= w.dt ? 0 : secondsLeft, walk, vmax) }
}

/**
 * S8: the taker who has arrived on the spot (the plan's arrivedId) stays the taker while he is on the pitch, so a teammate
 * crossing the spot neither takes over nor restarts the pause. null (takerFor picks as before) under rule 0, before anyone
 * has arrived, or once he has been sent off or substituted. @internal
 */
export const arrivedTaker = (w: Work, r: RestartAt): PlayerState | null => {
  const id = w.p.deadBall.rule === 1 ? w.restartPlan?.arrivedId : undefined
  if (id === undefined) return null
  return w.active(r.side).find((x) => x.id === id) ?? null
}

/**
 * S8: whether the taker is ready to take the restart. rule 0, or no pause planned (the period kickoffs): within 1 m of the
 * spot. rule 1: he has stood within 1 m for the plan's pauseTicks, counted from when this taker first stood there (a new
 * taker, or one who stepped away, starts again). Only asked from the resume tick on.
 *
 * Side effect (rule 1 with a pause planned): it records the pause in w.restartPlan, writing arrivedTick and arrivedId
 * when the taker first stands on the spot and clearing both when he leaves it. @internal
 */
export const takerReady = (w: Work, ph: RestartPhase, taker: PlayerState): boolean => {
  const near = dist(taker.pos, ph.at) <= 1.0
  const plan = w.restartPlan
  if (w.p.deadBall.rule !== 1 || plan?.pauseTicks === undefined) return near
  const { arrivedTick, arrivedId, ...rest } = plan
  if (!near) {
    if (arrivedTick !== undefined) w.restartPlan = rest
    return false
  }
  if (arrivedTick === undefined || arrivedId !== taker.id) {
    w.restartPlan = { ...rest, arrivedTick: w.tick, arrivedId: taker.id }
    return plan.pauseTicks <= 0
  }
  return w.tick - arrivedTick >= plan.pauseTicks
}

// ================================================================ end of P5 dead-ball seam

const takerFor = (w: Work, r: RestartAt): PlayerState => {
  const team = w.active(r.side)
  if (r.restart === "goal_kick") return team.find((x) => x.role === "GK") ?? team[0]!
  if (r.restart === "kickoff") return team.find((x) => x.role === "ST") ?? team[team.length - 1]!
  // G3 (P5): the keeper takes the free kick when the restart's plan says so (keeperTakes makes no draw).
  if (r.restart === "free_kick" && keeperTakes(w, r)) {
    const gk = team.find((x) => x.role === "GK")
    if (gk) return gk
  }
  // S8 (P5 dead-ball seam): the taker on the spot keeps the kick while he is on the pitch.
  const arrived = arrivedTaker(w, r)
  if (arrived) return arrived
  // With every outfielder sent off (only under a scripted red-card storm) the keeper takes it.
  return team.filter((x) => x.role !== "GK").sort((a, b) => dist(a.pos, r.at) - dist(b.pos, r.at))[0] ?? team[0]!
}

const handleRestart = (w: Work): void => {
  const ph = w.phase
  if (ph.kind !== "restart") return
  if (w.tick < ph.resumeTick) return
  const taker = takerFor(w, ph)
  // The taker walks to the ball (see moveTarget); the restart waits until they are ready (P5 dead-ball seam).
  if (!takerReady(w, ph, taker)) return
  w.setPlayer({ ...taker, vel: { x: 0, y: 0 }, intentUntil: w.tick, intent: { kind: "hold" } })
  w.emit(w.pending("set_piece", taker, ph.at, { kind: ph.restart }))
  noteSetPiece(w, ph, taker)
  w.restartPlan = undefined
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
export const tackleWinLogit = (w: Work, def: PlayerState, owner: PlayerState): number => {
  if (w.p.tackle.rule !== 1) return w.p.defending.tackleBase + 3 * (def.attrs.tackling - owner.attrs.dribbling)
  const t = w.p.tackle
  const inBox = attackX(owner.side, owner.pos.x, w.period) > PITCH.halfL - PITCH.boxDepth && Math.abs(owner.pos.y) < PITCH.boxHalfWidth
  return tackleLogit(
    t.base, def.attrs.tackling - owner.attrs.dribbling, bearingOf(owner.pos, owner.vel, dirOf(owner.side, w.period), def.pos, t),
    supportCount(owner.pos, def.id, w.active(def.side), t.supportM), Math.hypot(owner.vel.x, owner.vel.y), inBox, t
  )
}

// ================================================================ end of P4 tackle seam

// ================================================================ P4 foul seam (plan 8d Task 4 owns this block)

/** Whether `at` is in the box that `side` attacks. */
const inAttackedBox = (side: Side, at: Vec2, period: Period): boolean =>
  attackX(side, at.x, period) > PITCH.halfL - PITCH.boxDepth && Math.abs(at.y) < PITCH.boxHalfWidth

/** A player's foul chance multiplier for being booked (bookedFoulFactor once he has a yellow). */
const bookedFoul = (w: Work, pl: PlayerState): number => (pl.yellow >= 1 ? w.p.defending.bookedFoulFactor : 1)

/** T3 (rule 1): the zone x angle factor of `def`'s challenge on `victim`, measured in the victim's frame at his position. */
const challengeFactor = (w: Work, def: PlayerState, victim: PlayerState): number =>
  foulZone(w, victim, victim.pos) * angleFactor(bearingOf(victim.pos, victim.vel, dirOf(victim.side, w.period), def.pos, w.p.tackle), w.p.fouls)

/**
 * T3: the chance that `def`, having lost his tackle on `owner`, fouls him (one referee draw). rule 1: foulPerTackle x zone
 * x angle. rule 0: the flat rate, x boxFoulFactor in the box. Both x mods.foul x booked.
 * @internal
 */
export const foulChance = (w: Work, def: PlayerState, owner: PlayerState): number => {
  const where = w.p.fouls.rule === 1 ? challengeFactor(w, def, owner) : inAttackedBox(owner.side, owner.pos, w.period) ? w.p.defending.boxFoulFactor : 1
  return Math.min(1, w.p.defending.foulPerTackle * where * w.mods(def.side).foul * bookedFoul(w, def))
}

/**
 * T4: whether the carrier `owner` fouls the tackler (shielding or holding): only a carrier slower than
 * shieldSpeedMax, with chance attackerShare x his booked factor x his side's mods.foul (foul stream, drawn only then).
 * rule 0: never, no draw.
 * @internal
 */
export const shieldingFoul = (w: Work, owner: PlayerState): boolean => {
  const f = w.p.fouls
  if (f.rule !== 1 || Math.hypot(owner.vel.x, owner.vel.y) >= f.shieldSpeedMax) return false
  return w.rng.foul.chance(Math.min(1, f.attackerShare * bookedFoul(w, owner) * w.mods(owner.side).foul))
}

/**
 * T3: whether the beaten defender `def` fouls `owner`, who has just won a take-on: takeOnShare x zone x angle x booked x
 * mods.foul (foul stream). rule 0: never, no draw.
 * @internal
 */
export const takeOnFoul = (w: Work, owner: PlayerState, def: PlayerState): boolean => {
  if (w.p.fouls.rule !== 1) return false
  return w.rng.foul.chance(Math.min(1, w.p.fouls.takeOnShare * challengeFactor(w, def, owner) * bookedFoul(w, def) * w.mods(def.side).foul))
}

/** T3: the foul-zone factor for `victim` fouled at `at`, in his attacking frame. rule 0: 1. @internal */
export const foulZone = (w: Work, victim: PlayerState, at: Vec2): number =>
  w.p.fouls.rule === 1 ? zoneFactor(attackX(victim.side, at.x, w.period), inAttackedBox(victim.side, at, w.period), w.p.fouls) : 1

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
  if (shieldingFoul(w, owner)) {
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
  // G3 (P5): a long goal kick or keeper free kick is struck with keeperRestarts.longErrorScale (keeper-restart seam).
  const long = longKickScale(w, d, restart)
  if (restart === "throw_in") return { technique: "throw", hands: true, errorScale: 1 * long }
  if (d.candidate?.method === "throw") return { technique: "throw", hands: true, errorScale: w.p.distribution.throwErrorScale * long }
  if (d.candidate?.method === "punt") return { technique: "foot", hands: false, errorScale: w.p.distribution.puntErrorScale * long }
  return { technique: "foot", hands: false, errorScale: 1 * long }
}

// ================================================================ end of P3 keeper-distribution seam

// ================================================================ P5 keeper-restart seam (plan 8e Task 7 owns this block)

/** G3: the keeper-restart part of a restart's plan (whether the keeper takes an own-third free kick; dead stream). rule 0: nothing, no draw. @internal */
export const planKeeper = (w: Work, r: RestartAt, kind: SetPieceKind): PlanPart => ({})

/** G3: whether the keeper takes this free kick (reads the plan's keeperTaker; no draw). rule 0: never. @internal */
export const keeperTakes = (w: Work, r: RestartAt): boolean => false

/** G3: the error multiplier of a kick (kickStyle): longErrorScale for a long goal kick or keeper free kick. rule 0: 1. @internal */
export const longKickScale = (w: Work, d: Decision, restart: RestartKind | null): number => 1

// ================================================================ end of P5 keeper-restart seam

// ================================================================ P4 aerial seam (plan 8d Task 5 owns this block)

/**
 * T4: the aerial duel on a kick's resolution (aerial stream), and any foul by its loser on its winner (foul stream),
 * decided at release. rule 0: the resolution unchanged, no foul.
 * @internal
 */
export const aerialDuel = (w: Work, res: Resolution): { res: Resolution; foul: FlightFoul | null } => {
  const a = w.p.aerial
  if (a.rule <= 0 || !res.contest || !res.winnerId) return { res, foul: null }
  // The first to the contact against his contender (resolveFlight: contest.slack is the contender's slack minus his).
  const first = w.player(res.winnerId)
  const rival = w.player(res.contest.id)
  const firstWins = w.rng.aerial.chance(aerialWinShare(first.attrs.heading - rival.attrs.heading, -res.contest.slack, a))
  const winner = firstWins ? first : rival
  const loser = firstWins ? rival : first
  // The contact point stays the first qualifier's (ruling 6).
  const won: Resolution = { ...res, winnerId: winner.id, aerial: { winnerId: winner.id, loserId: loser.id } }
  // The loser may foul the winner (ruling 7): decided now, given when the flight resolves.
  const at = { x: res.ball.pos.x, y: res.ball.pos.y }
  const booked = loser.yellow >= 1 ? w.p.defending.bookedFoulFactor : 1
  const pFoul = Math.min(1, a.foulShare * foulZone(w, winner, at) * booked * w.mods(loser.side).foul)
  const foul = w.rng.foul.chance(pFoul) ? { offenderId: loser.id, victimId: winner.id, at, offenderYellow: loser.yellow } : null
  return { res: won, foul }
}

/** T4: apply a flight's aerial foul at resolution; true if it was given (the restart is set). rule 0: never. @internal */
export const applyFlightFoul = (w: Work, foul: FlightFoul): boolean => {
  if (w.p.aerial.rule <= 0) return false
  const offender = w.players.find((x) => x.id === foul.offenderId)
  const victim = w.players.find((x) => x.id === foul.victimId)
  // Dropped if either has been sent off (or replaced) since release.
  if (!offender || !victim || offender.sentOff || victim.sentOff) return false
  // Booked since release: kept only with bookedFoulFactor, so booked players stay as careful as in the tackle (foul stream).
  if (offender.yellow > foul.offenderYellow && offender.yellow >= 1 && !w.rng.foul.chance(w.p.defending.bookedFoulFactor)) return false
  foulAndCards(w, offender, victim, "aerial", foul.at)
  return true
}

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
  const ad = aerialDuel(w, raw)
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

/** True while a restart taken by the team's own keeper (a goal kick) is being set up: the build-up row applies, as in his hands (Ruling 7). @internal */
export const keeperRestart = (w: Work): boolean => {
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

/**
 * Whether the ball is a keeper's, in his hands (A4: nobody counter-presses him). The same condition as moveTarget's
 * `keeperHolding` (outside this seam, so not shared): handsRule on, a GK owner, inHands, in his own box.
 */
const keeperHasItInHands = (w: Work): boolean => {
  const pos = w.possession
  if (w.p.keeper.handsRule <= 0 || pos.kind !== "owned" || pos.inHands !== true) return false
  const owner = w.player(pos.playerId)
  return owner.role === "GK" && inOwnBox(owner.side, w.period, owner.pos)
}

/**
 * A4: `loser` has just lost the ball in live play, the ball at `at` (counter stream for the joins). rule 0: nothing.
 * Rule 1 (rulings 9, 10): the last transition's joiners stop pressing; each active losing outfielder joins the
 * counter-press with joinChance(distance to `at`), one counter draw each in player order; joiners carry a press intent
 * on the winner (the opponent at `at`) until the window ends, unless he has the ball in his hands (G8).
 * @internal
 */
export const noteLoss = (w: Work, loser: Side, at: Vec2): void => {
  const t = w.p.transition
  if (t.rule <= 0) return
  const prev = w.transition
  // A joiner substituted off since has left the player list (his place has the new id): skip him.
  if (prev)
    for (const id of prev.joiners) {
      const x = w.players.find((p) => p.id === id)
      if (x && x.intent.kind === "press" && w.tick < x.intentUntil) w.setPlayer({ ...x, intentUntil: w.tick })
    }
  const joiners: string[] = []
  for (const pl of w.active(loser)) {
    if (pl.role === "GK") continue
    const p = joinChance(dist(pl.pos, at), t)
    if (p > 0 && w.rng.counter.chance(p)) joiners.push(pl.id)
  }
  w.transition = { loser, tick: w.tick, at, joiners }
  const winner = w.active(other(loser)).sort((a, b) => dist(a.pos, at) - dist(b.pos, at))[0]
  if (!winner) return
  const pos = w.possession
  // At an interception the winner already owns the ball; a keeper's catch is not pressed (G8). In changePossession the
  // possession is still the old one, and endPressesOnHands ends these intents if he takes it in his hands.
  if (pos.kind === "owned" && pos.playerId === winner.id && pos.inHands === true) return
  const until = w.tick + windowTicks(t.windowS, w.dt)
  for (const id of joiners) w.setPlayer({ ...w.player(id), intent: { kind: "press", targetId: winner.id }, intentUntil: until })
}

/** A4: whether `side` is counter-pressing now (its hazard-started team press is off). rule 0: never. @internal */
export const inCounterWindow = (w: Work, side: Side): boolean => {
  const t = w.transition
  return w.p.transition.rule > 0 && t !== undefined && t.loser === side && w.tick - t.tick < windowTicks(w.p.transition.windowS, w.dt)
}

/**
 * Whether `pl` chases the loose ball in moveTarget: one of the two on his side nearest it, keeper never. The same rule as
 * moveTarget's loose-ball branch (outside this seam, so not shared): the keeper counts among the two nearest there too,
 * but does not chase.
 */
const chasesLooseBall = (w: Work, pl: PlayerState, ballFlat: Vec2): boolean =>
  pl.role !== "GK" && w.active(pl.side).sort((a, b) => dist(a.pos, ballFlat) - dist(b.pos, ballFlat)).slice(0, 2).some((c) => c.id === pl.id)

/**
 * A4: a losing player's movement in a transition (counter-press, reaction pause, recovery run) over `base`. rule 0: `base` itself.
 * Rule 1 (rulings 10-12): `base` during restarts, for the ball owner, for timeLeft chases, for keepers and for
 * loose-ball chasers (who also end any recovery run); a recovery run under way carries on while the ball is lost; a
 * joiner in the window counter-presses (at transition.speed); a non-joiner beyond pauseRadiusM holds course for pauseS;
 * from recoverFromS to recoverToS others may start a recovery run (counter stream).
 * @internal
 */
export const transitionMove = (w: Work, pl: PlayerState, base: MoveTarget, possSide: Side | null): MoveTarget => {
  const t = w.p.transition
  if (t.rule <= 0) return base
  const pos = w.possession
  if (w.phase.kind === "restart" || pl.role === "GK" || base.timeLeft !== undefined || (pos.kind === "owned" && pos.playerId === pl.id)) return base
  const cur = w.player(pl.id)
  const vmax = vmaxFor(cur, cur.energy, w.p)
  const run = cur.intent.kind === "recover" && w.tick < cur.intentUntil ? cur.intent : null
  const ballFlat = { x: w.ball.pos.x, y: w.ball.pos.y }
  // His side has the ball back, or he is one of its loose-ball chasers: transition moves (a recovery run too) are over.
  if (possSide === pl.side || (pos.kind === "loose" && chasesLooseBall(w, cur, ballFlat))) {
    if (run) w.setPlayer({ ...cur, intentUntil: w.tick })
    return base
  }
  if (run) return { target: run.target, speedCap: t.recoverSpeedShare * vmax }
  const tr = w.transition
  if (!tr || tr.loser !== pl.side) return base
  const sinceTicks = w.tick - tr.tick
  const joiner = tr.joiners.includes(pl.id)
  const pressing = joiner && sinceTicks < windowTicks(t.windowS, w.dt)
  if (pressing) {
    if (pos.kind === "owned") {
      if (keeperHasItInHands(w)) return base
      const owner = w.player(pos.playerId)
      return { target: interceptPoint(cur.pos, Math.min(t.speed, vmax), owner.pos, owner.vel), speedCap: t.speed }
    }
    // Loose-ball chasers returned base above.
    if (pos.kind === "loose")
      return { target: interceptPoint(cur.pos, Math.min(t.speed, vmax), ballFlat, { x: w.ball.vel.x, y: w.ball.vel.y }), speedCap: t.speed }
    return base
  }
  if (!joiner && sinceTicks < windowTicks(t.pauseS, w.dt) && dist(cur.pos, ballFlat) > t.pauseRadiusM) return pauseTarget(cur.pos, cur.vel, vmax, t)
  // A recovery run: not while counter-pressing or on a live press, and only while the ball is still lost.
  if (cur.intent.kind === "press" && w.tick < cur.intentUntil) return base
  const uRel = attackX(pl.side, cur.pos.x, w.period) - attackX(pl.side, ballFlat.x, w.period)
  const rate = recoverRate(sinceTicks * w.dt, uRel, t)
  if (rate <= 0 || !w.rng.counter.chance(hazard(rate, w.dt))) return base
  const target = shapeTarget(w, cur, ballFlat, false)
  const until = w.tick + Math.max(1, windowTicks(w.rng.counter.range(t.recoverS[0], t.recoverS[1]), w.dt))
  w.setPlayer({ ...cur, intent: { kind: "recover", target }, intentUntil: until })
  return { target, speedCap: t.recoverSpeedShare * vmax }
}

// ================================================================ end of P4 transition seam

// ================================================================ P4 team-press seam (plan 8d Task 7 owns this block)

/**
 * A5: an out-of-possession outfielder's press on `owner` (movement stream): a live press carries on, else the nearest
 * defender (two in a scripted surge) may start one at the hazard. Null when he does not press. rule 0: the old press.
 * Rule 1 (rulings 13-15, G28): the presser is the best by presserScore within 18 m (the top two within 25 m in a
 * surge); the hazard gains rateScale x pressLift (back to goal, own third); a live first presser within secondM may
 * bring a second presser (press stream, once per first press), who takes the cover-shadow spot. The caller never
 * calls it for a keeper with the ball in his hands or for a side in its counter-press window.
 * @internal
 */
export const teamPressMove = (w: Work, pl: PlayerState, owner: PlayerState, vmax: number, keeperFactor: number): MoveTarget | null => {
  if (w.p.press.rule > 0) return teamPressMoveA5(w, pl, owner, vmax, keeperFactor)
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

const NO_PRESS: PressState = { reception: null, secondFor: null, secondId: null }

/** A5 rule 1: teamPressMove's body (see there). */
const teamPressMoveA5 = (w: Work, pl: PlayerState, owner: PlayerState, vmax: number, keeperFactor: number): MoveTarget | null => {
  const pr = w.p.press
  const ps = w.press ?? NO_PRESS
  const intercept = (x: PlayerState): MoveTarget => ({ target: interceptPoint(x.pos, vmax, owner.pos, owner.vel), speedCap: vmax })
  const pressing = (x: PlayerState): boolean => x.intent.kind === "press" && w.tick < x.intentUntil && x.intent.targetId === owner.id
  const live = pressing(pl)
  // Outfielders ranked by presserScore (distance / roleWeight); the ranking makes no draw. `free`: only those not already pressing him.
  const ranked = (radiusM: number, free: boolean): PlayerState[] =>
    w
      .active(pl.side)
      .filter((x) => x.role !== "GK" && !(free && pressing(x)) && dist(x.pos, owner.pos) < radiusM)
      .map((x) => ({ x, s: presserScore(dist(x.pos, owner.pos), x.role, pr) }))
      .sort((a, b) => a.s - b.s)
      .map((e) => e.x)
  if (live && ps.secondId === pl.id) {
    // The second presser: the cover shadow toward the carrier's nearest teammate.
    const mate = w.active(owner.side).filter((x) => x.id !== owner.id).sort((a, b) => dist(a.pos, owner.pos) - dist(b.pos, owner.pos))[0]
    return mate ? { target: shadowSpot(owner.pos, mate.pos, pr.shadowM), speedCap: vmax } : intercept(pl)
  }
  // The current first press's second-presser draw is settled while the presser it was drawn for still presses him
  // (secondFor: whose draw it was; null: not drawn yet). Several live first pressers (a surge, or a rank change during
  // a press) share one draw: whoever is first within secondM makes it, and nobody draws again until that press ends.
  const drawnFor = ps.secondFor !== null ? w.players.find((x) => x.id === ps.secondFor) : undefined
  const settled = drawnFor !== undefined && pressing(drawnFor)
  // A live first presser within secondM: one press draw for the next-best within secondRadiusM who is not pressing yet.
  const second = (first: PlayerState, from: PressState): void => {
    if (dist(first.pos, owner.pos) > pr.secondM) return
    const next = ranked(pr.secondRadiusM, true).find((x) => x.id !== first.id)
    let secondId: string | null = null
    if (next && w.rng.press.chance(pr.secondShare)) {
      secondId = next.id
      w.setPlayer({ ...next, intent: { kind: "press", targetId: owner.id }, intentUntil: first.intentUntil })
    }
    w.press = { ...from, secondFor: first.id, secondId }
  }
  if (live) {
    if (!settled) second(pl, ps)
    return intercept(pl)
  }
  // The best by score presses; in a scripted press surge the top two do, from further away (G28).
  const surge = w.mods(pl.side).surge
  const presser = ranked(surge ? 25 : 18, false)
    .slice(0, surge ? 2 : 1)
    .some((x) => x.id === pl.id)
  if (!presser) return null
  const style = teamOf(w.cfg, pl.side).style
  const urgency = 1 + w.p.defending.boxIntensity * danger(pl.side, w.period, owner.pos)
  const lift = pressLift(backToGoalHolds(ps.reception, owner.id, w.tick, w.dt, pr), inOwnThird(w.ball.pos, pl.side, w.period, pr), pr)
  const rate = w.p.defending.pressRatePerS * (0.4 + 1.2 * style.pressIntensity) * urgency * w.mods(pl.side).press * keeperFactor * triggerFactor(w, pl) * pr.rateScale * lift
  if (!w.rng.movement.chance(hazard(rate, w.dt))) return null
  const first = { ...pl, intent: { kind: "press" as const, targetId: owner.id }, intentUntil: w.tick + Math.round(w.rng.movement.range(2, 4) / w.dt) }
  w.setPlayer(first)
  // A new first press: its second-presser draw comes now if he is within secondM, else once a first presser gets there.
  // While an earlier first press's draw is settled (a surge's second starter, or a rank change), it is not redrawn.
  if (!settled) {
    w.press = { ...ps, secondFor: null, secondId: null }
    second(first, w.press)
  }
  return intercept(pl)
}

/**
 * A5: `receiver` has just received a completed pass from flight `f` (the back-to-goal trigger): the ball's speed toward
 * the opponents' goal as it arrives is noted. rule 0: nothing. @internal
 */
export const noteReception = (w: Work, receiver: PlayerState, f: Flight): void => {
  if (w.p.press.rule <= 0 || f.kind !== "pass") return
  const ballMps = w.ball.vel.x * dirOf(receiver.side, w.period)
  w.press = { ...(w.press ?? NO_PRESS), reception: { playerId: receiver.id, tick: w.tick, ballMps } }
}

// ================================================================ end of P4 team-press seam

// ================================================================ P4 marking seam (plan 8d Task 8 owns this block)

/** A5: the marking spot for defender `defId` (anchor `anchor`) on `attacker`, the ball at `ballFlat`. rule 0: goal-side marking (markTarget). @internal */
export const markSpot = (w: Work, defSide: Side, defId: string, anchor: Vec2, attacker: PlayerState, ballFlat: Vec2): Vec2 => {
  const m = w.p.marking
  const goalSide = (weight: number) => markTarget(anchor, attacker.pos, defSide, w.period, m.goalSideM, weight, m.widthSlackM)
  if (m.rule !== 1) return goalSide(m.weight)
  // Ruling 16: a CB follows a dropping ST or AM tightly (the old goal-side spot at weight 1) while he is within cbStepM of the anchor.
  if (w.player(defId).role === "CB" && (attacker.role === "ST" || attacker.role === "AM") && stepsOut(anchor, attacker, defSide, w.period, m)) return goalSide(1)
  return laneMarkTarget(anchor, ballFlat, attacker.pos, m.weight, m.laneShare, m.widthSlackM)
}

// ================================================================ end of P4 marking seam

// ================================================================ P5 role-run seam (plan 8e Task 9 owns this block)

/**
 * A6: an in-possession teammate's run in behind (or overlap) while `owner` has the ball (movement stream); null when he
 * makes none. rule 0: the old run in behind (ST, W and AM at runs.runInBehindRatePerS, carrier beyond u -20).
 * @internal
 */
export const runMove = (w: Work, pl: PlayerState, owner: PlayerState): MoveTarget | null => {
  if (w.p.roleMoves.runRule === 1) return roleRun(w, pl, owner)
  if (pl.role !== "ST" && pl.role !== "W" && pl.role !== "AM") return null
  const vmax = vmaxFor(pl, pl.energy, w.p)
  if (pl.intent.kind === "run_in_behind" && w.tick < pl.intentUntil) return { target: pl.intent.target, speedCap: vmax }
  if (attackX(pl.side, owner.pos.x, w.period) > -20 && w.rng.movement.chance(hazard(w.p.runs.runInBehindRatePerS * triggerFactor(w, pl), w.dt))) {
    const lastDef = lastDefenderAttackX(pl.side, w.period, w.active(other(pl.side)))
    const target = clampToPitch({ x: dirOf(pl.side, w.period) * Math.min(lastDef + 6, PITCH.halfL - 6), y: pl.pos.y * 0.8 }, 2)
    w.setPlayer({ ...pl, intent: { kind: "run_in_behind", target }, intentUntil: w.tick + Math.round(w.rng.movement.range(2, 3) / w.dt) })
    w.emit(w.pending("off_ball_run", pl, pl.pos, { kind: "in_behind", ball_carrier_id: owner.id }, target))
    return { target, speedCap: vmax }
  }
  return null
}

/** Roles that make runs in behind, each at run.roleWeight x runs.runInBehindRatePerS (ruling 15). */
const RUN_ROLES: ReadonlySet<string> = new Set(["ST", "W", "AM", "FB"])
/** Carriers whose forward movement triggers runs (ruling 15). */
const RUN_CARRIERS: ReadonlySet<string> = new Set(["CM", "DM", "AM"])

/**
 * A6 rule 1 (plan 8e ruling 15; roles stream). A run's intent target is its break point behind the line (breakTarget,
 * which through balls lead toward); until a pass is travelling to him the runner holds holdM short of the last defender
 * (holdLineTarget), and once one is he breaks to the target at full speed. Both are re-aimed each tick. An overlap keeps
 * its target at up to overlap.speed. An FB overlaps his same-side W or CM at overlap.ratePerS; ST, W, AM and FB run at
 * runInBehindRatePerS x roleWeight while a CM, DM or AM carrier beyond u -20 moves forward with spaceBehindM behind the
 * line, in the wide lane with chance wideShare.
 */
const roleRun = (w: Work, pl: PlayerState, owner: PlayerState): MoveTarget | null => {
  const rm = w.p.roleMoves
  const vmax = vmaxFor(pl, pl.energy, w.p)
  const overlapCap = Math.min(vmax, rm.overlap.speed)
  const lastDef = () => lastDefenderAttackX(pl.side, w.period, w.active(other(pl.side)))
  if (pl.intent.kind === "run_in_behind" && w.tick < pl.intentUntil) {
    if (pl.intent.overlap) return { target: pl.intent.target, speedCap: overlapCap }
    const line = lastDef()
    const target = breakTarget(line, pl.intent.target.y, pl.side, w.period)
    if (target.x !== pl.intent.target.x || target.y !== pl.intent.target.y) w.setPlayer({ ...pl, intent: { kind: "run_in_behind", target } })
    if (passTravellingTo(w, pl.id)) return { target, speedCap: vmax }
    return { target: holdLineTarget(line, target.y, false, pl.side, w.period, rm.run), speedCap: vmax }
  }
  // A live rotation (rotation seam, run after this one) is never overwritten by a new run or overlap.
  if (pl.intent.kind === "rotate" && w.tick < pl.intentUntil) return null
  if (overlapEligible(pl, owner, w.period, rm.overlap) && w.rng.roles.chance(hazard(rm.overlap.ratePerS * triggerFactor(w, pl), w.dt))) {
    const target = overlapTarget(owner.pos, pl.side, w.period, rm.overlap)
    const until = w.tick + Math.round(w.rng.roles.range(rm.overlap.durS[0], rm.overlap.durS[1]) / w.dt)
    w.setPlayer({ ...pl, intent: { kind: "run_in_behind", target, overlap: true }, intentUntil: until })
    w.emit(w.pending("off_ball_run", pl, pl.pos, { kind: "overlap", ball_carrier_id: owner.id }, target))
    return { target, speedCap: overlapCap }
  }
  if (!RUN_ROLES.has(pl.role) || !RUN_CARRIERS.has(owner.role)) return null
  const dir = dirOf(pl.side, w.period)
  if (attackX(pl.side, owner.pos.x, w.period) <= -20 || owner.vel.x * dir <= 0.5) return null
  const line = lastDef()
  if (line >= PITCH.halfL - rm.run.spaceBehindM) return null
  const weight = rm.run.roleWeight[pl.role as "ST" | "W" | "AM" | "FB"]
  if (!w.rng.roles.chance(hazard(w.p.runs.runInBehindRatePerS * weight * triggerFactor(w, pl), w.dt))) return null
  const wide = w.rng.roles.chance(rm.run.wideShare)
  const hold = holdLineTarget(line, pl.pos.y, wide, pl.side, w.period, rm.run)
  const target = breakTarget(line, hold.y, pl.side, w.period)
  w.setPlayer({ ...pl, intent: { kind: "run_in_behind", target }, intentUntil: w.tick + Math.round(w.rng.roles.range(2, 3) / w.dt) })
  w.emit(w.pending("off_ball_run", pl, pl.pos, { kind: "in_behind", ball_carrier_id: owner.id }, target))
  return { target: hold, speedCap: vmax }
}

/**
 * Is a pass travelling to `id` (he wins it, or it was meant for him)? Note: moveTarget calls the role-run seam only while
 * his side owns the ball, so in play a released pass reaches him through the chase intent (to where it lands) instead.
 */
const passTravellingTo = (w: Work, id: string): boolean => {
  const pos = w.possession
  return pos.kind === "in_flight" && pos.flight.kind === "pass" && (pos.flight.winnerId === id || pos.flight.pending.attrs.intended_receiver_id === id)
}

// ================================================================ end of P5 role-run seam

// ================================================================ P5 rotation seam (plan 8e Task 10 owns this block)

/** A6: an in-possession teammate's rotation (winger inside, full-back inversion, CM drop) over his shape `base`; null when none. rule 0: null. @internal */
export const rotateMove = (w: Work, pl: PlayerState, owner: PlayerState, base: () => MoveTarget): MoveTarget | null => {
  const rm = w.p.roleMoves
  if (rm.rotateRule <= 0 || pl.role === "GK") return null
  const vmax = vmaxFor(pl, pl.energy, w.p)
  const speedCap = Math.min(rm.jogMps, vmax)
  const rot = pl.intent.kind === "rotate" && w.tick < pl.intentUntil ? pl.intent : null
  const mates = w.active(pl.side)
  // The same-side winger (the nearest winger on his flank, FB only), and whether he is rotating inside now.
  const flank = pl.pos.y < 0 ? -1 : 1
  let winger: PlayerState | undefined
  if (pl.role === "FB")
    for (const x of mates)
      if (x.role === "W" && (x.pos.y < 0 ? -1 : 1) === flank && (winger === undefined || Math.abs(x.pos.y - pl.pos.y) < Math.abs(winger.pos.y - pl.pos.y))) winger = x
  const wingerInside = winger !== undefined && winger.intent.kind === "rotate" && w.tick < winger.intentUntil
  const tr = w.transition
  if (rot) {
    // A rotation ends when the ball changes hands after it began (the loss, and a regain, are both recorded after `since`),
    // and a full-back's when his winger comes inside.
    if ((tr !== undefined && tr.tick > rot.since) || wingerInside) {
      w.setPlayer({ ...pl, intentUntil: w.tick })
      return null
    }
    return { target: rot.target, speedCap }
  }
  // None while his side is the recorded loser of the last turnover.
  if (tr !== undefined && tr.loser === pl.side) return null
  // One rotation at a time, and none over another intent still running.
  if (w.tick < pl.intentUntil && pl.intent.kind !== "rotate") return null
  const ballU = attackX(pl.side, w.ball.pos.x, w.period)
  const start = (kind: "inside" | "invert" | "cm_drop", target: Vec2, durS: readonly [number, number]): MoveTarget => {
    const to = clampToPitch(target, 1)
    w.setPlayer({ ...pl, intent: { kind: "rotate", target: to, since: w.tick }, intentUntil: w.tick + Math.max(1, Math.round(w.rng.roles.range(durS[0], durS[1]) / w.dt)) })
    w.emit(w.pending("off_ball_run", pl, pl.pos, { kind, ball_carrier_id: owner.id }, to))
    return { target: to, speedCap }
  }
  if (pl.role === "W") {
    const c = rm.inside
    if (ballU <= 17.5 || Math.abs(pl.pos.y) <= c.halfSpaceY[1]) return null
    if (!w.rng.roles.chance(hazard(c.ratePerS, w.dt))) return null
    const shape = base().target
    return start("inside", insideTarget(shape, shape.y < 0 || (shape.y === 0 && pl.pos.y < 0) ? -1 : 1, w.rng.roles.range(c.halfSpaceY[0], c.halfSpaceY[1])), c.durS)
  }
  if (pl.role === "FB") {
    const c = rm.invert
    // His winger is wide (or has the ball) and is not coming inside: the pair is gated both ways.
    if (winger === undefined || wingerInside) return null
    const wide = Math.abs(winger.pos.y) > 20 || winger.id === owner.id
    if (!wide || ballU <= -17.5 || !w.rng.roles.chance(hazard(c.ratePerS, w.dt))) return null
    const lastOwnU = Math.min(...mates.filter((x) => x.role !== "GK").map((x) => attackX(pl.side, x.pos.x, w.period)))
    return start("invert", invertTarget(base().target, winger.pos.y, w.rng.roles.range(c.inM[0], c.inM[1]), lastOwnU, pl.side, w.period, c.aboveLastM), c.durS)
  }
  if (pl.role === "CM" || pl.role === "DM") {
    const c = rm.cmDrop
    // Within winS of his side winning the ball (needs transition.rule 1), with the ball in his own third; the deepest of the others drops.
    if (w.p.transition.rule <= 0 || tr === undefined || tr.loser === pl.side || w.tick - tr.tick >= windowTicks(c.winS, w.dt) || ballU >= -17.5) return null
    const deepest = mates
      .filter((x) => (x.role === "CM" || x.role === "DM") && x.id !== owner.id)
      .sort((a, b) => dirOf(pl.side, w.period) * (a.pos.x - b.pos.x) || (a.id < b.id ? -1 : 1))[0]
    const cbs = mates.filter((x) => x.role === "CB").map((x) => x.pos)
    if (deepest?.id !== pl.id || cbs.length === 0 || !w.rng.roles.chance(hazard(c.ratePerS, w.dt))) return null
    return start("cm_drop", dropTarget(cbs, w.ball.pos.y, pl.side, w.period), c.durS)
  }
  return null
}

// ================================================================ end of P5 rotation seam

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
    if (takerFor(w, ph).id === pl.id) return deadMove(w, pl, { target: ph.at, speedCap: vmax * 0.8 })
    // P5 restart-phase precedence (plan 8e ruling 5): the restarting side's set-piece spot, else the other side's, else
    // the restart shape, else the old target and 9.15 m push; the dead-ball seam then sets the pace.
    const spot = pl.side === ph.side ? (attackSpot(w, pl, ph) ?? shapeSpot(w, pl, ph)) : (defendSpot(w, pl, ph) ?? shapeSpot(w, pl, ph))
    if (spot) return deadMove(w, pl, { target: clampToPitch(spot, 0.5), speedCap: vmax * 0.6 })
    const a = restartTarget(w, pl, ph.at, ph.side === pl.side)
    if (ph.restart === "kickoff") return deadMove(w, pl, { target: kickoffAnchor(team.formation, pl.slot, pl.side, w.period, team.style), speedCap: vmax * 0.6 })
    if (pl.side !== ph.side && dist(a, ph.at) < 9.15 && pl.role !== "GK") {
      const away = add(ph.at, scale(norm(sub(a, ph.at)), 9.5))
      return deadMove(w, pl, { target: clampToPitch(away), speedCap: vmax * 0.6 })
    }
    return deadMove(w, pl, { target: a, speedCap: vmax * 0.6 })
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
  // S1 (P5): an attacker's run just after a set piece (attacking set-piece seam).
  const spr = setPieceRun(w, pl, vmax)
  if (spr) return spr
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
  // A6 (P5): runs in behind and overlaps (role-run seam), then rotations (rotation seam).
  if (pos.kind === "owned" && possSide === pl.side) {
    const owner = w.player(pos.playerId)
    const rm = runMove(w, pl, owner)
    if (rm) return rm
    const ro = rotateMove(w, pl, owner, shape)
    if (ro) return ro
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
      .filter((x) => x.id !== owner.id && x.role !== "GK" && !(x.intent.kind === "run_in_behind" && w.tick < x.intentUntil) && !(x.intent.kind === "rotate" && w.tick < x.intentUntil))
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
          .filter((x) => x.id !== owner.id && x.role !== "GK" && !(x.intent.kind === "run_in_behind" && w.tick < x.intentUntil) && !(x.intent.kind === "rotate" && w.tick < x.intentUntil))
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
  // P5 (plan 8e): a restart pending at the whistle leaves no plan or live set piece behind (the kickoffs have none).
  w.restartPlan = undefined
  w.setPiece = undefined
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
  // Half-time is a restart, not a loss (P4 A4, ruling 9): no transition or press state crosses into the second half
  // (P4 final review: a loss in the last seconds of the first half held the pause, recovery runs and the team-press-off
  // window into the second-half kickoff).
  w.transition = undefined
  w.press = undefined
  w.pressedBy = []
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

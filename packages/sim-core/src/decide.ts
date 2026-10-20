import { classifyPass, type PassHeight, type PassKind } from "./classify.js"
import { actionZone, attackX, dirOf, dist, goalAngle, goalOf, PITCH, type Period, type Side, type Vec2 } from "./geometry.js"
import { ACTIONS, type Action, type Params } from "./params.js"
import { pitchControlAt, type PcPlayer } from "./pitchcontrol.js"
import type { Rng } from "./rng.js"
import type { OptionRecord, PlayerState, RestartKind, TeamStyle } from "./types.js"
// ---- P3 imports, choice seam (plan 8c Task 9 inserts below this line)
import type { ChoiceCoefs, PassAction } from "./params.js"

// ---- P3 imports, through-ball seam (plan 8c Task 6 inserts below this line)
import { add, clampToPitch, norm, scale, sub } from "./geometry.js"
import type { Intent } from "./types.js"

// ---- P5 imports, direct-free-kick seam (plan 8e Task 8 inserts below this line)
import { setPieceKind } from "./setpiece.js"

// ---- P5 imports, goal-kick seam (plan 8e Task 7 inserts below this line)

export const KIND_TO_ACTION: Readonly<Record<Exclude<PassKind, "set_piece">, Action>> = {
  short: "short_pass",
  long: "long_pass",
  through: "through_ball",
  lofted_through: "lofted_through",
  switch: "switch",
  cross: "cross",
  cutback: "cutback",
  back: "back_pass"
}

export interface Candidate {
  readonly action: Action
  readonly kind: PassKind
  readonly receiverId: string
  readonly target: Vec2
  readonly height: PassHeight
  readonly xpass: number
  readonly value: number
  readonly lane: number
  /** How a keeper plays it from his hands (P3 G5); absent for every other pass. */
  readonly method?: "throw" | "punt"
}

export interface DecisionInput {
  readonly period: Period
  readonly owner: PlayerState
  readonly teammates: ReadonlyArray<PlayerState>
  readonly opponents: ReadonlyArray<PlayerState>
  readonly style: TeamStyle
  /** Own score minus opponent score. */
  readonly scoreDiff: number
  readonly minute: number
  readonly restart: RestartKind | null
  /** Additive logit bias from scenario scripts. */
  readonly scriptBias: Partial<Record<Action, number>>
  /** Current tick; lets decide tell a live off-ball run (tick < intentUntil) from an expired one (D4). */
  readonly tick?: number
  /** Seconds the player has had the ball (0 when not given). */
  readonly onBallS?: number
  /** True when the owner is a keeper whose hold in his hands has just ended (open play; P3 G5). */
  readonly keeperHands?: boolean
}

export interface Decision {
  readonly action: Action
  readonly candidate: Candidate | null
  /** Chosen option value / best option value (null when no pass was chosen). */
  readonly decisionQuality: number | null
  readonly xg: number | null
  readonly pressure: number
  /** Probability of each available action at the moment of decision (unavailable actions omitted). */
  readonly actionProbs: Readonly<Record<string, number>>
  /** The best pass options available, highest value first (at most OPTIONS_RECORDED). */
  readonly options: ReadonlyArray<OptionRecord>
  /** 1 when the chosen pass was the best available option, 2 for the second best, ...; null when no pass was chosen. */
  readonly chosenRank: number | null
  /** True when no option of the chosen action existed (a forced restart) and the best pass of any kind was played. */
  readonly fallback: boolean
  /** True when a what-if override chose the pass (recorded as `forced_pass` on the event). */
  readonly forced?: boolean
}

export const OPTIONS_RECORDED = 5
/** A pass type whose safest option is expected to arrive more (less) often than this gains (loses) logit, by pass.safetyWeight. */
export const SAFETY_PIVOT = 0.75

const r3 = (v: number): number => Math.round(v * 1000) / 1000

export const toOption = (c: Candidate): OptionRecord => ({
  action: c.action,
  receiver_id: c.receiverId,
  kind: c.kind,
  target_x: Math.round(c.target.x * 100) / 100,
  target_y: Math.round(c.target.y * 100) / 100,
  xpass: r3(c.xpass),
  value: r3(c.value)
})

const sigmoid = (z: number): number => 1 / (1 + Math.exp(-z))

/** Simple threat surface: 1 at the goal mouth, decaying with distance. Replaced by fitted xT in Plan 2. */
export const threat = (side: Side, period: Period, pos: Vec2): number => Math.exp(-dist(pos, goalOf(side, period)) / 20)

export const lastDefenderAttackX = (side: Side, period: Period, opponents: ReadonlyArray<PlayerState>): number => {
  let best = -PITCH.halfL
  for (const o of opponents) if (o.role !== "GK" && !o.sentOff) best = Math.max(best, attackX(side, o.pos.x, period))
  return best
}

const segmentDistance = (a: Vec2, b: Vec2, q: Vec2): { d: number; t: number } => {
  const vx = b.x - a.x
  const vy = b.y - a.y
  const l2 = vx * vx + vy * vy
  const t = l2 < 1e-9 ? 0 : Math.max(0, Math.min(1, ((q.x - a.x) * vx + (q.y - a.y) * vy) / l2))
  return { d: Math.hypot(a.x + t * vx - q.x, a.y + t * vy - q.y), t }
}

export const defendersInLane = (from: Vec2, to: Vec2, opponents: ReadonlyArray<PlayerState>, width = 2): number => {
  let n = 0
  for (const o of opponents) {
    if (o.sentOff) continue
    const { d, t } = segmentDistance(from, to, o.pos)
    if (d < width && t > 0.05 && t < 0.95) n++
  }
  return n
}

export const xpassOf = (p: Params, distance: number, lane: number, pressure: number, height: PassHeight): number => {
  const c = p.pass.xpass
  return sigmoid(c.b0 + c.bDist * distance + c.bLane * lane + c.bPressure * pressure + c.bHigh * (height === "ground" ? 0 : 1))
}

export const xgOf = (p: Params, side: Side, period: Period, pos: Vec2, header: boolean, defendersInCone: number): number => {
  const c = p.shot.xg
  const d = dist(pos, goalOf(side, period))
  return sigmoid(c.b0 + c.bDist * d + c.bAngle * goalAngle(side, period, pos) + (header ? c.bHeader : 0) + c.bDefenders * defendersInCone)
}

export const nearestOpponent = (pos: Vec2, opponents: ReadonlyArray<PlayerState>): PlayerState | null => {
  let best: PlayerState | null = null
  let bd = Infinity
  for (const o of opponents) {
    if (o.sentOff) continue
    const d = dist(pos, o.pos)
    if (d < bd) {
      bd = d
      best = o
    }
  }
  return best
}

// ================================================================ P3 candidate plumbing (plan 8c Task 1; shared, no task edits it)

/** What every option builder needs: the decision input, the passer's frame and the pitch-control snapshot. */
export interface CandidateContext {
  readonly input: DecisionInput
  readonly p: Params
  /** 0..1 from the passer's nearest opponent (1 within 1 m, 0 beyond 5 m). */
  readonly pressure: number
  readonly side: Side
  readonly period: Period
  /** +1 when the passer's side attacks +x this period. */
  readonly dir: number
  /** Attack-normalised x of the opponents' last outfield defender. */
  readonly lastDef: number
  readonly ownerThreat: number
  readonly pc: { readonly att: PcPlayer[]; readonly def: PcPlayer[] } | null
}

export interface PushOptions {
  /** Added to the option's value (P3 D3: attackers expected at a cross zone). */
  readonly bonus?: number
  /** A keeper's throw or punt from his hands (P3 G5). */
  readonly method?: "throw" | "punt"
}

export const candidateContext = (input: DecisionInput, p: Params, pressure: number): CandidateContext => {
  const side = input.owner.side
  const period = input.period
  const toPc = (pl: PlayerState): PcPlayer => ({ x: pl.pos.x, y: pl.pos.y, vx: pl.vel.x, vy: pl.vel.y, gk: pl.role === "GK" })
  return {
    input,
    p,
    pressure,
    side,
    period,
    dir: dirOf(side, period),
    lastDef: lastDefenderAttackX(side, period, input.opponents),
    ownerThreat: threat(side, period, input.owner.pos),
    // With a pitch-control weight, a passer blends the lane-based xPass with who would win a ball played there.
    pc: p.pass.pitchControlWeight > 0 ? { att: input.teammates.filter((t) => t.id !== input.owner.id && !t.sentOff).map(toPc), def: input.opponents.filter((o) => !o.sentOff).map(toPc) } : null
  }
}

/** Classify, price and record one option: the one path every option builder uses. */
export const pushCandidate = (ctx: CandidateContext, out: Candidate[], receiver: PlayerState, target: Vec2, height: PassHeight, o: PushOptions = {}): void => {
  const { input, p, side, period } = ctx
  const owner = input.owner
  const kind = classifyPass({ side, period, from: owner.pos, to: target, height, lastDefenderAttackX: ctx.lastDef }, p.classifier)
  if (kind === "set_piece") return
  const distance = dist(owner.pos, target)
  const lane = defendersInLane(owner.pos, target, input.opponents)
  const lanes = xpassOf(p, distance, lane, ctx.pressure, height)
  const w = p.pass.pitchControlWeight
  const xp = ctx.pc ? (1 - w) * lanes + w * pitchControlAt(target, ctx.pc.att, ctx.pc.def, owner.pos).att : lanes
  const value = choiceValue(ctx, receiver, target, lane, xp) + (o.bonus ?? 0)
  out.push({ action: KIND_TO_ACTION[kind], kind, receiverId: receiver.id, target, height, xpass: xp, value, lane, ...(o.method ? { method: o.method } : {}) })
}

/** Where a pass to `tm` is aimed: his position 0.5 s ahead at his current velocity. */
export const leadOf = (tm: PlayerState): Vec2 => ({ x: tm.pos.x + tm.vel.x * 0.5, y: tm.pos.y + tm.vel.y * 0.5 })

export const buildCandidatesIn = (ctx: CandidateContext): Candidate[] => {
  const { owner, teammates } = ctx.input
  const out: Candidate[] = []
  for (const tm of teammates) {
    if (tm.id === owner.id || tm.sentOff) continue
    const lead = leadOf(tm)
    const distance = dist(owner.pos, lead)
    if (distance < 4 || distance > 65) continue
    const inBox = attackX(ctx.side, lead.x, ctx.period) > PITCH.halfL - PITCH.boxDepth && Math.abs(lead.y) < PITCH.boxHalfWidth
    const wideOwner = Math.abs(owner.pos.y) > PITCH.boxHalfWidth
    const height: PassHeight = wideOwner && inBox ? "high" : distance < 30 ? "ground" : "high"
    // Nobody lofts the ball back at their own keeper: a high ball dropping in front of the goal ends in the net
    // when it is overhit or the keeper miscontrols it. Back passes to the keeper go along the ground, from close.
    if (tm.role === "GK" && height === "high") continue
    pushCandidate(ctx, out, tm, lead, height)
    for (const t of throughTargets(ctx, tm)) pushCandidate(ctx, out, tm, t.target, t.height)
  }
  for (const c of crossTargets(ctx)) pushCandidate(ctx, out, c.receiver, c.target, c.height, { bonus: c.bonus })
  return out
}

export const buildCandidates = (input: DecisionInput, p: Params, pressure: number): Candidate[] => buildCandidatesIn(candidateContext(input, p, pressure))

/**
 * The decision record's options and the chosen option's rank among `all`. `options` is the best OPTIONS_RECORDED of
 * `all` by value (or `recorded` when given), with the chosen option appended when it is not already there; with no
 * chosen option, just those options and a null rank.
 */
export const recordOf = (
  all: ReadonlyArray<Candidate>,
  chosen: Candidate | null,
  recorded?: ReadonlyArray<OptionRecord>
): { options: ReadonlyArray<OptionRecord>; chosenRank: number | null } => {
  const options = recorded ?? [...all].sort((a, b) => b.value - a.value).slice(0, OPTIONS_RECORDED).map(toOption)
  if (chosen === null) return { options, chosenRank: null }
  // The chosen option is always recorded, even when it ranks below the top OPTIONS_RECORDED.
  const option = toOption(chosen)
  const same = (o: OptionRecord) => o.receiver_id === option.receiver_id && o.target_x === option.target_x && o.target_y === option.target_y
  return { options: options.some(same) ? options : [...options, option], chosenRank: 1 + all.filter((c) => c.value > chosen.value).length }
}

export const softmaxPick = (logits: ReadonlyArray<number>, rng: Rng): number => {
  const m = Math.max(...logits)
  return rng.weighted(logits.map((l) => (Number.isFinite(l) ? Math.exp(l - m) : 0)))
}

// ================================================================ P3 choice seam (plan 8c Task 9 owns this block)

/** The opponents' midfield line in the passer's frame: mean u of their 5th-8th deepest outfielders; NaN with fewer than 8. */
export const midLine = (ctx: CandidateContext): number => {
  const us = ctx.input.opponents.filter((o) => !o.sentOff && o.role !== "GK").map((o) => attackX(ctx.side, o.pos.x, ctx.period)).sort((a, b) => b - a)
  return us.length >= 8 ? (us[4]! + us[5]! + us[6]! + us[7]!) / 4 : NaN
}

const midLines = new WeakMap<CandidateContext, number>()
const midLineOf = (ctx: CandidateContext): number => {
  let m = midLines.get(ctx)
  if (m === undefined) {
    m = midLine(ctx)
    midLines.set(ctx, m)
  }
  return m
}

/** The real choice model's features (carrier-report C3) for a pass to `receiver`, measured at `at`, in the passer's frame. */
export const choiceFeatures = (ctx: CandidateContext, receiver: PlayerState, at: Vec2): ChoiceCoefs => {
  const owner = ctx.input.owner
  const du = (at.x - owner.pos.x) * ctx.dir
  const dv = at.y - owner.pos.y
  let open = 99
  for (const o of ctx.input.opponents) if (!o.sentOff) open = Math.min(open, dist(o.pos, at))
  const ml = midLineOf(ctx)
  const pu = attackX(ctx.side, owner.pos.x, ctx.period)
  const tu = attackX(ctx.side, at.x, ctx.period)
  return {
    dist: Math.hypot(du, dv) / 10,
    fwd: du / 10,
    lat: Math.abs(dv) / 10,
    lane: defendersInLane(owner.pos, at, ctx.input.opponents) > 0 ? 1 : 0,
    open: Math.min(open, 10) / 5,
    lineBreak: Number.isFinite(ml) && pu < ml && tu > ml ? 1 : 0,
    keeper: receiver.role === "GK" ? 1 : 0
  }
}

const FEATURES = ["dist", "fwd", "lat", "lane", "open", "lineBreak", "keeper"] as const

/** Utility of a pass: the fitted coefficients, moving with pressure about the real mean, plus leadLane for a blocked aim. */
export const choiceUtility = (ctx: CandidateContext, receiver: PlayerState, at: Vec2, leadLane: number): number => {
  const c = ctx.p.choice
  const x = choiceFeatures(ctx, receiver, at)
  let u = leadLane > 0 ? c.leadLane : 0
  for (const k of FEATURES) u += (c.base[k] + c.press[k] * (ctx.pressure - c.pressCentre)) * x[k]
  return u
}

/** Receiver-choice temperature: choice.temperature at the league's mean vision (0.6), sharper for better passers. */
export const choiceTemperature = (ctx: CandidateContext): number => Math.max(0.05, (ctx.p.choice.temperature * (1.4 - ctx.input.owner.attrs.vision)) / 0.8)

/** Inclusive value T log sum exp(U / T) of a non-empty set of utilities. */
export const inclusiveValue = (values: ReadonlyArray<number>, T: number): number => {
  const m = Math.max(...values)
  return m + T * Math.log(values.reduce((s, v) => s + Math.exp((v - m) / T), 0))
}

/**
 * The D1 receiver shares of `options`: softmax(U / T) at choiceTemperature, the probabilities receiverPick draws with
 * under choice.rule (sums to 1; empty for no options). For records that must match the draw (Task 10: keeper hands).
 */
export const choiceShares = (options: ReadonlyArray<Candidate>, ctx: CandidateContext): number[] => {
  if (options.length === 0) return []
  const T = choiceTemperature(ctx)
  const m = Math.max(...options.map((c) => c.value / T))
  const w = options.map((c) => Math.exp(c.value / T - m))
  const z = w.reduce((a, b) => a + b, 0)
  return w.map((x) => x / z)
}

/**
 * An option's value: the D1 utility, or the old expected-threat value. As fitted, D1 measures the features at the
 * receiver's current position for every option (lead passes, through balls, crosses, throws, punts); the aimed point
 * only enters through the lane to it (`lane`, choice.leadLane). Every option has a receiver.
 */
const choiceValue = (ctx: CandidateContext, receiver: PlayerState, target: Vec2, lane: number, xp: number): number => {
  if (ctx.p.choice.rule <= 0) return xp * (0.3 + threat(ctx.side, ctx.period, target)) - (1 - xp) * 0.3 * (1 - ctx.ownerThreat)
  return choiceUtility(ctx, receiver, receiver.pos, lane)
}

/**
 * Extra logit for pass kind `a`. D1: a nested logit, so the kind sits at the pass family's level (the zone's short_pass
 * logit) plus its fitted shift plus the inclusive value of its options. Old engine: the safety lean.
 */
const kindTerm = (ctx: CandidateContext, candidates: ReadonlyArray<Candidate>, a: Action, base: Readonly<Record<Action, number>>): number => {
  const c = ctx.p.choice
  if (c.rule <= 0) {
    const sw = ctx.p.pass.safetyWeight
    if (sw <= 0) return 0
    let best = -Infinity
    for (const x of candidates) if (x.action === a && x.xpass > best) best = x.xpass
    return Number.isFinite(best) ? sw * (best - SAFETY_PIVOT) : 0
  }
  const values = candidates.filter((x) => x.action === a).map((x) => x.value)
  if (values.length === 0) return 0
  return base.short_pass - base[a] + c.kindShift[a as PassAction] + c.inclusive * (inclusiveValue(values, choiceTemperature(ctx)) - c.ivCentre)
}

/** Index of the chosen option among `options` (all of the chosen kind): softmax(U / T) under D1, else the old rule. */
const receiverPick = (ctx: CandidateContext, options: ReadonlyArray<Candidate>, rng: Rng): number => {
  if (ctx.p.choice.rule > 0) {
    const T = choiceTemperature(ctx)
    return softmaxPick(options.map((c) => c.value / T), rng)
  }
  const temp = ctx.p.pass.choiceTemperature * (1.4 - ctx.input.owner.attrs.vision)
  return softmaxPick(options.map((c) => c.value / Math.max(0.05, temp)), rng)
}

/** Quality of the chosen option: exp((U - U_best) / T) under D1 (utilities can be negative), else chosen / best value. */
const optionQuality = (ctx: CandidateContext, chosen: Candidate, best: number): number => {
  if (ctx.p.choice.rule > 0) return Math.max(0, Math.min(1, Math.exp((chosen.value - best) / choiceTemperature(ctx))))
  return best > 0 ? Math.max(0, Math.min(1, chosen.value / best)) : 1
}

// ================================================================ end of P3 choice seam

// ================================================================ P3 cross seam (plan 8c Task 5 owns this block)

export interface CrossOption { readonly receiver: PlayerState; readonly target: Vec2; readonly height: PassHeight; readonly bonus: number }

/**
 * Crosses aimed at zones rather than teammates (D3). A carrier in the final third (u beyond classifier.finalThirdAttackX)
 * and wide (|y| beyond classifier.crossOriginAbsY) gets one option per zone that an attacker can reach by the ball's
 * arrival: the fastest such attacker is the intended receiver, and each one adds cross.attackerValue.
 */
const crossTargets = (ctx: CandidateContext): CrossOption[] => {
  const { input, p } = ctx
  const c = p.cross
  if (c.rule <= 0 || input.restart !== null) return []
  const owner = input.owner
  const ou = attackX(ctx.side, owner.pos.x, ctx.period)
  if (ou <= p.classifier.finalThirdAttackX || Math.abs(owner.pos.y) <= p.classifier.crossOriginAbsY) return []
  const near = Math.sign(owner.pos.y)
  const out: CrossOption[] = []
  for (const zone of c.zones) {
    if (ou < zone.minOriginU) continue
    const target = { x: ctx.dir * zone.u, y: near * zone.s }
    const arrive = dist(owner.pos, target) / (zone.height === "high" ? c.flightSpeed : p.pass.arriveSpeed) + c.arriveSlackS
    let receiver: PlayerState | null = null
    let fastest = Infinity
    let n = 0
    for (const tm of input.teammates) {
      if (tm.id === owner.id || tm.sentOff || tm.role === "GK") continue
      const t = dist(tm.pos, target) / c.runSpeed
      if (t > arrive) continue
      n++
      if (t < fastest) {
        fastest = t
        receiver = tm
      }
    }
    if (receiver) out.push({ receiver, target, height: zone.height, bonus: c.attackerValue * n })
  }
  return out
}

// ================================================================ end of P3 cross seam

// ================================================================ P3 through-ball seam (plan 8c Task 6 owns this block)

export interface ThroughOption { readonly target: Vec2; readonly height: PassHeight }

/** Off-ball runs that ask for a ball into space (D4). P5 (A6) adds overlap runs here. */
export const isRunIntent = (intent: Intent): intent is Extract<Intent, { kind: "run_in_behind" }> => intent.kind === "run_in_behind"

/**
 * Through-ball targets for teammate `tm`. Old rule: an 8 m lead straight upfield for anyone near the last defender or on a
 * run. D4 (through.rule): only a runner, and the ball goes where he will be when it arrives, at most leadMaxM along his run.
 */
const throughTargets = (ctx: CandidateContext, tm: PlayerState): ThroughOption[] => {
  const owner = ctx.input.owner
  const heightTo = (target: Vec2): PassHeight => (dist(owner.pos, target) < 30 ? "ground" : "high")
  if (ctx.p.through.rule <= 0) {
    const ahead = attackX(ctx.side, tm.pos.x, ctx.period) > ctx.lastDef - 4 || tm.intent.kind === "run_in_behind"
    if (!ahead || tm.role === "GK") return []
    const target = { x: tm.pos.x + ctx.dir * ctx.p.pass.throughLeadM, y: tm.pos.y }
    return Math.abs(target.x) < PITCH.halfL - 2 ? [{ target, height: heightTo(target) }] : []
  }
  if (tm.role === "GK" || !isRunIntent(tm.intent)) return []
  // step.ts never clears an expired intent, so a run counts only while tick < intentUntil
  if (ctx.input.tick === undefined || ctx.input.tick >= tm.intentUntil) return []
  const t = ctx.p.through
  const goal = tm.intent.target
  const along = norm(sub(goal, tm.pos))
  const room = dist(tm.pos, goal)
  let lead = tm.pos
  let flight = dist(owner.pos, tm.pos) / t.ballSpeed
  for (let i = 0; i < 2; i++) {
    lead = add(tm.pos, scale(along, Math.min(room, t.runSpeed * flight, t.leadMaxM)))
    flight = dist(owner.pos, lead) / t.ballSpeed
  }
  const target = clampToPitch(lead, 2)
  return [{ target, height: heightTo(target) }]
}

// ================================================================ end of P3 through-ball seam

// ================================================================ P3 keeper-hands seam (plan 8c Task 7 owns this block)

/**
 * Softmax shares of a pool's options at the temperature receiverPick draws with: D1's choiceShares under choice.rule,
 * else the old receiver-pick temperature (sums to 1; empty for an empty pool). So the recorded probabilities match the draw.
 */
const poolShares = (ctx: CandidateContext, pool: ReadonlyArray<Candidate>): number[] => {
  if (pool.length === 0) return []
  if (ctx.p.choice.rule > 0) return choiceShares(pool, ctx)
  const temp = Math.max(0.05, ctx.p.pass.choiceTemperature * (1.4 - ctx.input.owner.attrs.vision))
  const m = Math.max(...pool.map((c) => c.value / temp))
  const w = pool.map((c) => Math.exp(c.value / temp - m))
  const z = w.reduce((a, b) => a + b, 0)
  return w.map((x) => x / z)
}

/**
 * The throws and punts open to a keeper with the ball in his hands (G5), or null when G5 does not apply (rule off, not
 * in his hands, a restart, not a keeper) or he has no option. Exported so that a what-if override can use the same pools.
 */
export const keeperHandsCandidates = (ctx: CandidateContext): { readonly throws: Candidate[]; readonly punts: Candidate[] } | null => {
  const { input, p } = ctx
  const g = p.distribution
  if (g.rule <= 0 || input.keeperHands !== true || input.restart !== null || input.owner.role !== "GK") return null
  const owner = input.owner
  const throws: Candidate[] = []
  const punts: Candidate[] = []
  for (const tm of input.teammates) {
    if (tm.id === owner.id || tm.sentOff) continue
    const lead = leadOf(tm)
    const d = dist(owner.pos, lead)
    if (d >= 4 && d <= g.throwMaxM) pushCandidate(ctx, throws, tm, lead, "ground", { method: "throw" })
    else if (d >= g.puntMinM && d <= g.puntMaxM && (tm.role === "ST" || tm.role === "W" || tm.role === "AM")) pushCandidate(ctx, punts, tm, lead, "high", { method: "punt" })
  }
  return throws.length + punts.length === 0 ? null : { throws, punts }
}

/**
 * A keeper's distribution from his hands (G5): open play only, and only when his hold in his hands has just ended. He
 * throws to a teammate 4..throwMaxM away along the ground, or punts high to a forward (ST, W, AM) puntMinM..puntMaxM away,
 * punting with chance sigmoid(distribution.puntLogit); then the receiver is drawn as for any pass. actionProbs is keyed
 * by each option's classified action (a long throw can be a switch or a long pass, a punt a lofted through ball):
 * P(action) = sum over throws of (1 - pPunt) * share + sum over punts of pPunt * share. Draws only from `rng` (decision).
 */
const keeperHandsDecision = (ctx: CandidateContext, rng: Rng): Decision | null => {
  const pools = keeperHandsCandidates(ctx)
  if (pools === null) return null
  const { throws, punts } = pools
  const g = ctx.p.distribution
  const pPunt = punts.length === 0 ? 0 : throws.length === 0 ? 1 : sigmoid(g.puntLogit)
  const pool = rng.chance(pPunt) ? punts : throws
  const chosen = pool[Math.max(0, receiverPick(ctx, pool, rng))]!
  const all = [...throws, ...punts]
  const best = Math.max(...all.map((c) => c.value))
  const probs: Record<string, number> = {}
  const add = (opts: ReadonlyArray<Candidate>, pMethod: number): void =>
    poolShares(ctx, opts).forEach((share, i) => {
      const a = opts[i]!.action
      probs[a] = (probs[a] ?? 0) + pMethod * share
    })
  add(throws, 1 - pPunt)
  add(punts, pPunt)
  const actionProbs: Record<string, number> = {}
  for (const a of Object.keys(probs)) actionProbs[a] = r3(probs[a]!)
  const { options, chosenRank } = recordOf(all, chosen)
  return {
    action: chosen.action,
    candidate: chosen,
    decisionQuality: optionQuality(ctx, chosen, best),
    xg: null,
    pressure: ctx.pressure,
    actionProbs,
    options,
    chosenRank,
    fallback: false
  }
}

// ================================================================ end of P3 keeper-hands seam

const NON_PASS: ReadonlyArray<Action> = ["shot", "carry", "hold", "take_on", "clear"]

// ================================================================ P5 direct-free-kick seam (plan 8e Task 8 owns this block)

/** S9: a direct free kick's shot: whether it is available, the shot logit's shift, and its xG. */
export interface RestartShot {
  readonly available: boolean
  readonly shift: number
  readonly xg: number
}

/**
 * S9: the shot at a central attacking-third free kick (goalDist from goal, ax the owner's team-frame u); null leaves the
 * shot as it is. rule 0: null.
 *
 * Ruling 14: a free kick in the taker's attacking third (u > 17.5) with |y| <= 20.16 (setPieceKind "fk_central", the
 * diagnostic's definition) and goalDist <= directFk.maxDistanceM may be shot; its logit gains shotShift; its xG is the
 * open-play xG with no defender in the cone, offset by xgLogit on the logit scale (the wall still blocks in planShot).
 * Built on xgOf, so a refit of the shot model flows through (Cross-phase contacts).
 */
export const restartShot = (input: DecisionInput, p: Params, goalDist: number, _ax: number): RestartShot | null => {
  const fk = p.directFk
  if (fk.rule === 0 || input.restart !== "free_kick") return null
  const { owner, period } = input
  if (setPieceKind("free_kick", owner.pos, owner.side, period) !== "fk_central" || goalDist > fk.maxDistanceM) return null
  const open = xgOf(p, owner.side, period, owner.pos, false, 0)
  return { available: true, shift: fk.shotShift, xg: sigmoid(Math.log(open / (1 - open)) + fk.xgLogit) }
}

// ================================================================ end of P5 direct-free-kick seam

// ================================================================ P5 goal-kick seam (plan 8e Task 7 owns this block)

/** G3: the logit shift of action `a` at a goal kick or keeper free kick (keeperRestarts.longShift on long passes). rule 0: 0. */
export const restartKindShift = (_input: DecisionInput, _a: Action, _p: Params): number => 0

// ================================================================ end of P5 goal-kick seam

const RESTART_ACTIONS: Readonly<Record<RestartKind, ReadonlyArray<Action>>> = {
  kickoff: ["short_pass", "back_pass"],
  throw_in: ["short_pass", "back_pass", "through_ball"],
  corner: ["cross", "short_pass"],
  goal_kick: ["short_pass", "long_pass", "switch"],
  free_kick: ["short_pass", "long_pass", "cross", "switch", "back_pass", "shot"],
  penalty: ["shot"]
}

/** Choose an action (and a pass option) for the player on the ball. */
export const decide = (input: DecisionInput, p: Params, rng: Rng): Decision => {
  const { owner, style } = input
  const side = owner.side
  const { period } = input
  const opp = nearestOpponent(owner.pos, input.opponents)
  const oppDist = opp ? dist(owner.pos, opp.pos) : 50
  const pressure = Math.max(0, Math.min(1, 1 - (oppDist - 1) / 4))
  const ctx = candidateContext(input, p, pressure)
  const hands = keeperHandsDecision(ctx, rng)
  if (hands) return hands
  const zone = actionZone(side, period, owner.pos)
  const candidates = buildCandidatesIn(ctx)
  const goalDist = dist(owner.pos, goalOf(side, period))
  const cone = input.opponents.filter((o) => {
    const g = goalOf(side, period)
    const { d, t } = segmentDistance(owner.pos, g, o.pos)
    return d < 1.5 && t > 0 && t < 1 && o.role !== "GK"
  }).length
  const xg = goalDist <= p.shot.maxDistanceM ? xgOf(p, side, period, owner.pos, false, cone) : 0
  const ax = attackX(side, owner.pos.x, period)
  const rs = restartShot(input, p, goalDist, ax)
  const allowed = input.restart ? new Set(RESTART_ACTIONS[input.restart]) : null

  const available = (a: Action): boolean => {
    if (allowed && !allowed.has(a)) return false
    switch (a) {
      case "shot":
        return rs ? rs.available : input.restart === "penalty" || (goalDist <= p.shot.maxDistanceM && ax > 15)
      case "carry":
      case "hold":
        return input.restart === null
      case "take_on":
        // Keepers do not try to dribble past attackers.
        return input.restart === null && opp !== null && oppDist < 4 && owner.role !== "GK"
      case "clear":
        return input.restart === null && ax < -10
      default:
        return candidates.some((c) => c.action === a)
    }
  }

  const base = p.actions.logits[zone]
  const sw = p.actions.styleWeight
  const pw = p.actions.pressureWeight
  const lateTrailing = input.minute > 75 && input.scoreDiff < 0
  const lateLeading = input.minute > 75 && input.scoreDiff > 0
  const logits = ACTIONS.map((a) => {
    if (!available(a)) return -Infinity
    let l = base[a]
    if (a === "long_pass" || a === "lofted_through" || a === "switch") l += sw * 0.8 * style.longBallBias
    if (a === "short_pass") l -= sw * 0.3 * style.longBallBias
    if (a === "cross") l += sw * 0.8 * style.crossBias
    if (a === "through_ball") l += sw * (style.riskTolerance - 0.5)
    if (a === "hold") l += sw * (0.4 * (1 - style.tempo) - 0.2)
    if (a === "clear") l += pw * 1.5 * pressure
    if (a === "long_pass") l += pw * 0.6 * pressure
    if (a === "hold") l -= pw * 1.0 * pressure + p.actions.holdDecayPerS * (input.onBallS ?? 0)
    if (a === "carry") l -= pw * 0.6 * pressure
    if (a === "take_on") l += pw * 0.3 * pressure
    if (a === "short_pass") l -= pw * 0.2 * pressure
    if (a === "shot") l += 3 * (xg - 0.1) + 0.3 * style.riskTolerance
    if (lateTrailing && (a === "shot" || a === "cross" || a === "long_pass")) l += 0.4
    if (lateLeading && (a === "hold" || a === "back_pass")) l += 0.4
    if (a === "shot" && rs) l += rs.shift
    l += restartKindShift(input, a, p)
    l += input.scriptBias[a] ?? 0
    // Passers weigh each kind of pass by its options (old engine: the lean towards kinds that have a safe option now).
    if (!NON_PASS.includes(a)) l += kindTerm(ctx, candidates, a, base)
    return l
  })
  const finite = logits.filter((l) => Number.isFinite(l))
  const lmax = finite.length ? Math.max(...finite) : 0
  const z = logits.reduce((s, l) => s + (Number.isFinite(l) ? Math.exp(l - lmax) : 0), 0)
  const actionProbs: Record<string, number> = {}
  ACTIONS.forEach((a, i) => {
    if (Number.isFinite(logits[i]!)) actionProbs[a] = r3(Math.exp(logits[i]! - lmax) / z)
  })
  const { options } = recordOf(candidates, null)
  const record = { actionProbs, options, chosenRank: null as number | null, fallback: false }

  let idx = softmaxPick(logits, rng)
  if (idx < 0) idx = ACTIONS.indexOf(allowed ? [...allowed][0]! : "hold")
  const action = ACTIONS[idx]!

  let passOptions = candidates.filter((c) => c.action === action)
  if (NON_PASS.includes(action)) return { action, candidate: null, decisionQuality: null, xg: action === "shot" ? (rs?.xg ?? xg) : null, pressure, ...record }
  let fallback = false
  if (passOptions.length === 0) {
    // Forced restart with no option of the allowed kinds: play the best available pass, or clear it.
    if (candidates.length === 0) return { action: "clear", candidate: null, decisionQuality: null, xg: null, pressure, ...record, fallback: true }
    const bestAny = candidates.reduce((a, b) => (b.value > a.value ? b : a))
    passOptions = [bestAny]
    fallback = true
  }
  const pick = receiverPick(ctx, passOptions, rng)
  const chosen = passOptions[Math.max(0, pick)]!
  const best = Math.max(...candidates.map((c) => c.value))
  const quality = optionQuality(ctx, chosen, best)
  const { options: recorded, chosenRank } = recordOf(candidates, chosen, options)
  return { action: chosen.action, candidate: chosen, decisionQuality: quality, xg: null, pressure, ...record, options: recorded, chosenRank, fallback }
}

/**
 * A decision whose pass is replaced by a what-if override: the best-valued pass to `receiverId` (of `kind` if
 * given). The record keeps the probabilities and options the player weighed, with the forced pass ranked among
 * them. Returned unchanged when no such pass is available (the receiver too close, too far or sent off).
 */
export const overridePass = (d: Decision, input: DecisionInput, o: { readonly receiverId: string; readonly kind?: string }, p: Params): Decision => {
  const ctx = candidateContext(input, p, d.pressure)
  // A keeper with the ball in his hands throws or punts (G5): force one of those, as his own decision would.
  const hands = keeperHandsCandidates(ctx)
  const candidates = hands ? [...hands.throws, ...hands.punts] : buildCandidatesIn(ctx)
  const matching = candidates.filter((c) => c.receiverId === o.receiverId && (o.kind === undefined || c.kind === o.kind))
  if (matching.length === 0) return d
  const chosen = matching.reduce((a, b) => (b.value > a.value ? b : a))
  const best = Math.max(...candidates.map((c) => c.value))
  // The record keeps the options the player weighed (d.options), with the forced pass added.
  const { options, chosenRank } = recordOf(candidates, chosen, d.options)
  return {
    ...d,
    action: chosen.action,
    candidate: chosen,
    decisionQuality: optionQuality(ctx, chosen, best),
    xg: null,
    chosenRank,
    options,
    fallback: false,
    forced: true
  }
}

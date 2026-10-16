import { classifyPass, type PassHeight, type PassKind } from "./classify.js"
import { actionZone, attackX, dirOf, dist, goalAngle, goalOf, PITCH, type Period, type Side, type Vec2 } from "./geometry.js"
import { ACTIONS, type Action, type Params } from "./params.js"
import { pitchControlAt, type PcPlayer } from "./pitchcontrol.js"
import type { Rng } from "./rng.js"
import type { OptionRecord, PlayerState, RestartKind, TeamStyle } from "./types.js"
// ---- P3 imports, choice seam (plan 8c Task 9 inserts below this line)

// ---- P3 imports, cross seam (plan 8c Task 5 inserts below this line)

// ---- P3 imports, through-ball seam (plan 8c Task 6 inserts below this line)

// ---- P3 imports, keeper-hands seam (plan 8c Task 7 inserts below this line)

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
  /** Where the choice features are measured (P3 D1); default the target. */
  readonly featureAt?: Vec2
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
  const value = choiceValue(ctx, receiver, target, o.featureAt ?? target, lane, xp) + (o.bonus ?? 0)
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
    pushCandidate(ctx, out, tm, lead, height, { featureAt: tm.pos })
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

/** An option's value: the old expected-threat value until Task 9. `featureAt` is where D1 measures the choice features. */
const choiceValue = (ctx: CandidateContext, _receiver: PlayerState, target: Vec2, _featureAt: Vec2, _lane: number, xp: number): number =>
  xp * (0.3 + threat(ctx.side, ctx.period, target)) - (1 - xp) * 0.3 * (1 - ctx.ownerThreat)

/** Extra logit for pass kind `a` from its options: the old safety lean (0 while pass.safetyWeight is 0). */
const kindTerm = (ctx: CandidateContext, candidates: ReadonlyArray<Candidate>, a: Action, _base: Readonly<Record<Action, number>>): number => {
  const sw = ctx.p.pass.safetyWeight
  if (sw <= 0) return 0
  let best = -Infinity
  for (const c of candidates) if (c.action === a && c.xpass > best) best = c.xpass
  return Number.isFinite(best) ? sw * (best - SAFETY_PIVOT) : 0
}

/** Index of the chosen option among `options` (all of the chosen kind). */
const receiverPick = (ctx: CandidateContext, options: ReadonlyArray<Candidate>, rng: Rng): number => {
  const temp = ctx.p.pass.choiceTemperature * (1.4 - ctx.input.owner.attrs.vision)
  return softmaxPick(options.map((c) => c.value / Math.max(0.05, temp)), rng)
}

/** The decision record's quality of the chosen option against the best one, 0..1. */
const optionQuality = (_ctx: CandidateContext, chosen: Candidate, best: number): number => (best > 0 ? Math.max(0, Math.min(1, chosen.value / best)) : 1)

// ================================================================ end of P3 choice seam

// ================================================================ P3 cross seam (plan 8c Task 5 owns this block)

export interface CrossOption { readonly receiver: PlayerState; readonly target: Vec2; readonly height: PassHeight; readonly bonus: number }

/** Crosses aimed at zones rather than teammates (D3). None until Task 5. */
const crossTargets = (_ctx: CandidateContext): CrossOption[] => []

// ================================================================ end of P3 cross seam

// ================================================================ P3 through-ball seam (plan 8c Task 6 owns this block)

export interface ThroughOption { readonly target: Vec2; readonly height: PassHeight }

/** Through-ball targets for teammate `tm`: the old rule, an 8 m lead for anyone near the last defender or on a run. */
const throughTargets = (ctx: CandidateContext, tm: PlayerState): ThroughOption[] => {
  const ahead = attackX(ctx.side, tm.pos.x, ctx.period) > ctx.lastDef - 4 || tm.intent.kind === "run_in_behind"
  if (!ahead || tm.role === "GK") return []
  const target = { x: tm.pos.x + ctx.dir * ctx.p.pass.throughLeadM, y: tm.pos.y }
  return Math.abs(target.x) < PITCH.halfL - 2 ? [{ target, height: dist(ctx.input.owner.pos, target) < 30 ? "ground" : "high" }] : []
}

// ================================================================ end of P3 through-ball seam

// ================================================================ P3 keeper-hands seam (plan 8c Task 7 owns this block)

/** Softmax shares of a pool's options, at the temperature the old receiver pick uses (sums to 1; empty for an empty pool). */
const poolShares = (ctx: CandidateContext, pool: ReadonlyArray<Candidate>): number[] => {
  if (pool.length === 0) return []
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
    if (d >= 4 && d <= g.throwMaxM) pushCandidate(ctx, throws, tm, lead, "ground", { featureAt: tm.pos, method: "throw" })
    else if (d >= g.puntMinM && d <= g.puntMaxM && (tm.role === "ST" || tm.role === "W" || tm.role === "AM")) pushCandidate(ctx, punts, tm, lead, "high", { featureAt: tm.pos, method: "punt" })
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
  const allowed = input.restart ? new Set(RESTART_ACTIONS[input.restart]) : null

  const available = (a: Action): boolean => {
    if (allowed && !allowed.has(a)) return false
    switch (a) {
      case "shot":
        return input.restart === "penalty" || (goalDist <= p.shot.maxDistanceM && ax > 15)
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
  if (NON_PASS.includes(action)) return { action, candidate: null, decisionQuality: null, xg: action === "shot" ? xg : null, pressure, ...record }
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
  const candidates = buildCandidatesIn(ctx)
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

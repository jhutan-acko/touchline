import { classifyPass, type PassHeight, type PassKind } from "./classify.js"
import { actionZone, attackX, dirOf, dist, goalAngle, goalOf, PITCH, type Side, type Vec2 } from "./geometry.js"
import { ACTIONS, type Action, type Params } from "./params.js"
import { pitchControlAt, type PcPlayer } from "./pitchcontrol.js"
import type { Rng } from "./rng.js"
import type { OptionRecord, PlayerState, RestartKind, TeamStyle } from "./types.js"

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
}

export interface DecisionInput {
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
export const threat = (side: Side, pos: Vec2): number => Math.exp(-dist(pos, goalOf(side)) / 20)

export const lastDefenderAttackX = (side: Side, opponents: ReadonlyArray<PlayerState>): number => {
  let best = -PITCH.halfL
  for (const o of opponents) if (o.role !== "GK" && !o.sentOff) best = Math.max(best, attackX(side, o.pos.x))
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

export const xgOf = (p: Params, side: Side, pos: Vec2, header: boolean, defendersInCone: number): number => {
  const c = p.shot.xg
  const d = dist(pos, goalOf(side))
  return sigmoid(c.b0 + c.bDist * d + c.bAngle * goalAngle(side, pos) + (header ? c.bHeader : 0) + c.bDefenders * defendersInCone)
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

export const buildCandidates = (input: DecisionInput, p: Params, pressure: number): Candidate[] => {
  const { owner, teammates, opponents } = input
  const side = owner.side
  const d = dirOf(side)
  const lastDef = lastDefenderAttackX(side, opponents)
  const out: Candidate[] = []
  const ownerThreat = threat(side, owner.pos)
  // With a pitch-control weight, a passer blends the lane-based xPass with who would win a ball played there.
  const w = p.pass.pitchControlWeight
  const toPc = (pl: PlayerState): PcPlayer => ({ x: pl.pos.x, y: pl.pos.y, vx: pl.vel.x, vy: pl.vel.y, gk: pl.role === "GK" })
  const pc = w > 0 ? { att: teammates.filter((t) => t.id !== owner.id && !t.sentOff).map(toPc), def: opponents.filter((o) => !o.sentOff).map(toPc) } : null
  const push = (receiver: PlayerState, target: Vec2, height: PassHeight) => {
    const kind = classifyPass({ side, from: owner.pos, to: target, height, lastDefenderAttackX: lastDef }, p.classifier)
    if (kind === "set_piece") return
    const distance = dist(owner.pos, target)
    const lane = defendersInLane(owner.pos, target, opponents)
    const lanes = xpassOf(p, distance, lane, pressure, height)
    const xp = pc ? (1 - w) * lanes + w * pitchControlAt(target, pc.att, pc.def, owner.pos).att : lanes
    const value = xp * (0.3 + threat(side, target)) - (1 - xp) * 0.3 * (1 - ownerThreat)
    out.push({ action: KIND_TO_ACTION[kind], kind, receiverId: receiver.id, target, height, xpass: xp, value, lane })
  }
  for (const tm of teammates) {
    if (tm.id === owner.id || tm.sentOff) continue
    const lead = { x: tm.pos.x + tm.vel.x * 0.5, y: tm.pos.y + tm.vel.y * 0.5 }
    const distance = dist(owner.pos, lead)
    if (distance < 4 || distance > 65) continue
    const inBox = attackX(side, lead.x) > PITCH.halfL - PITCH.boxDepth && Math.abs(lead.y) < PITCH.boxHalfWidth
    const wideOwner = Math.abs(owner.pos.y) > PITCH.boxHalfWidth
    push(tm, lead, wideOwner && inBox ? "high" : distance < 30 ? "ground" : "high")
    const ahead = attackX(side, tm.pos.x) > lastDef - 4 || tm.intent.kind === "run_in_behind"
    if (ahead && tm.role !== "GK") {
      const target = { x: tm.pos.x + d * p.pass.throughLeadM, y: tm.pos.y }
      if (Math.abs(target.x) < PITCH.halfL - 2) push(tm, target, dist(owner.pos, target) < 30 ? "ground" : "high")
    }
  }
  return out
}

const softmaxPick = (logits: ReadonlyArray<number>, rng: Rng): number => {
  const m = Math.max(...logits)
  return rng.weighted(logits.map((l) => (Number.isFinite(l) ? Math.exp(l - m) : 0)))
}

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
  const opp = nearestOpponent(owner.pos, input.opponents)
  const oppDist = opp ? dist(owner.pos, opp.pos) : 50
  const pressure = Math.max(0, Math.min(1, 1 - (oppDist - 1) / 4))
  const zone = actionZone(side, owner.pos)
  const candidates = buildCandidates(input, p, pressure)
  const goalDist = dist(owner.pos, goalOf(side))
  const cone = input.opponents.filter((o) => {
    const g = goalOf(side)
    const { d, t } = segmentDistance(owner.pos, g, o.pos)
    return d < 1.5 && t > 0 && t < 1 && o.role !== "GK"
  }).length
  const xg = goalDist <= p.shot.maxDistanceM ? xgOf(p, side, owner.pos, false, cone) : 0
  const ax = attackX(side, owner.pos.x)
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
    if (a === "hold") l -= pw * 1.0 * pressure
    if (a === "carry") l -= pw * 0.6 * pressure
    if (a === "take_on") l += pw * 0.3 * pressure
    if (a === "short_pass") l -= pw * 0.2 * pressure
    if (a === "shot") l += 3 * (xg - 0.1) + 0.3 * style.riskTolerance
    if (lateTrailing && (a === "shot" || a === "cross" || a === "long_pass")) l += 0.4
    if (lateLeading && (a === "hold" || a === "back_pass")) l += 0.4
    l += input.scriptBias[a] ?? 0
    // Passers lean towards the kinds of pass that have a safe option now (and away from those that have none).
    if (p.pass.safetyWeight > 0 && !NON_PASS.includes(a)) {
      let best = -Infinity
      for (const c of candidates) if (c.action === a && c.xpass > best) best = c.xpass
      if (Number.isFinite(best)) l += p.pass.safetyWeight * (best - SAFETY_PIVOT)
    }
    return l
  })
  const finite = logits.filter((l) => Number.isFinite(l))
  const lmax = finite.length ? Math.max(...finite) : 0
  const z = logits.reduce((s, l) => s + (Number.isFinite(l) ? Math.exp(l - lmax) : 0), 0)
  const actionProbs: Record<string, number> = {}
  ACTIONS.forEach((a, i) => {
    if (Number.isFinite(logits[i]!)) actionProbs[a] = r3(Math.exp(logits[i]! - lmax) / z)
  })
  const options = [...candidates].sort((a, b) => b.value - a.value).slice(0, OPTIONS_RECORDED).map(toOption)
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
  const temp = p.pass.choiceTemperature * (1.4 - owner.attrs.vision)
  const pick = softmaxPick(passOptions.map((c) => c.value / Math.max(0.05, temp)), rng)
  const chosen = passOptions[Math.max(0, pick)]!
  const best = Math.max(...candidates.map((c) => c.value))
  const quality = best > 0 ? Math.max(0, Math.min(1, chosen.value / best)) : 1
  const chosenRank = 1 + candidates.filter((c) => c.value > chosen.value).length
  // The chosen option is always recorded, even when it ranks below the top OPTIONS_RECORDED.
  const chosenOption = toOption(chosen)
  const same = (o: OptionRecord) => o.receiver_id === chosenOption.receiver_id && o.target_x === chosenOption.target_x && o.target_y === chosenOption.target_y
  const recorded = options.some(same) ? options : [...options, chosenOption]
  return { action: chosen.action, candidate: chosen, decisionQuality: quality, xg: null, pressure, ...record, options: recorded, chosenRank, fallback }
}

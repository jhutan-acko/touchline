/**
 * What-if re-simulation: take the match state at a tick, change one thing (force a pass, move a player, change a
 * team's style), play the next seconds over several random seeds, and compare with the same seeds left alone.
 * Pure and deterministic, like the engine: the same state, intervention and options give the same answer.
 */
import { buildCandidates, nearestOpponent } from "./decide.js"
import { attackX, clampToPitch, dist, type Side, type Vec2 } from "./geometry.js"
import { substream } from "./rng.js"
import { runScript } from "./runner.js"
import { initMatch, isFinished, step } from "./step.js"
import { CONCERNS, type DomainEvent, type MatchConfig, type MatchState, type TeamStyle } from "./types.js"

export type Intervention =
  | { readonly kind: "none" }
  /** The player on the ball plays this pass at their next decision (the next tick). */
  | { readonly kind: "pass_to"; readonly playerId: string; readonly receiverId: string; readonly passKind?: string }
  /** The player stands at `to` instead (standing still for a second, then playing on). */
  | { readonly kind: "move_player"; readonly playerId: string; readonly to: Vec2 }
  /** The team plays with these style settings from now on. */
  | { readonly kind: "tactic"; readonly side: Side; readonly style: Partial<TeamStyle> }

/** An intervention that cannot be applied to the state (wrong player, unknown id, style out of range). */
export class WhatIfError extends Error {}

const STYLE_RANGES: Readonly<Record<keyof Omit<TeamStyle, "archetype">, readonly [number, number]>> = {
  pressIntensity: [0, 1],
  lineHeight: [-1, 1],
  compactness: [0, 1],
  tempo: [0, 1],
  longBallBias: [-1, 1],
  crossBias: [-1, 1],
  riskTolerance: [0, 1]
}

/** The k-th fork of a state: fresh random sub-streams for every concern, distinct from the match's and from scenario retries. */
export const forkState = (s: MatchState, k: number): MatchState => {
  const rng = {} as Record<(typeof CONCERNS)[number], MatchState["rng"][(typeof CONCERNS)[number]]>
  for (const c of CONCERNS) rng[c] = substream(s.config.seed, `${c}:whatif`, k)
  return { ...s, rng }
}

/** The pass options open to the player on the ball now (receiver, kind, value), best first. */
export const passOptions = (s: MatchState) => {
  if (s.possession.kind !== "owned") return []
  const owner = s.players.find((p) => p.id === (s.possession as { playerId: string }).playerId)!
  const team = owner.side === "home" ? s.config.home : s.config.away
  const opponents = s.players.filter((p) => p.side !== owner.side && !p.sentOff)
  const near = nearestOpponent(owner.pos, opponents)
  const pressure = near ? Math.max(0, Math.min(1, 1 - (dist(owner.pos, near.pos) - 1) / 4)) : 0
  return buildCandidates(
    { owner, teammates: s.players.filter((p) => p.side === owner.side && !p.sentOff), opponents, style: team.style, scoreDiff: 0, minute: 0, restart: null, scriptBias: {} },
    s.config.params,
    pressure
  ).sort((a, b) => b.value - a.value)
}

export const applyIntervention = (s: MatchState, iv: Intervention): MatchState => {
  const find = (id: string) => {
    const p = s.players.find((x) => x.id === id)
    if (!p || p.sentOff) throw new WhatIfError(`no player "${id}" on the pitch at tick ${s.tick}`)
    return p
  }
  switch (iv.kind) {
    case "none":
      return s
    case "pass_to": {
      const owner = find(iv.playerId)
      if (s.possession.kind !== "owned" || s.possession.playerId !== owner.id) throw new WhatIfError(`${owner.id} is not on the ball at tick ${s.tick}`)
      const receiver = find(iv.receiverId)
      if (receiver.side !== owner.side || receiver.id === owner.id) throw new WhatIfError(`${receiver.id} is not a teammate of ${owner.id}`)
      if (!passOptions(s).some((c) => c.receiverId === receiver.id && (iv.passKind === undefined || c.kind === iv.passKind)))
        throw new WhatIfError(`no ${iv.passKind ?? ""} pass from ${owner.id} to ${receiver.id} is open at tick ${s.tick}`.replace("  ", " "))
      // The player decides at the next tick, and plays the forced pass.
      const players = s.players.map((p) => (p.id === owner.id ? { ...p, intentUntil: s.tick + 1 } : p))
      return { ...s, players, override: { playerId: owner.id, receiverId: receiver.id, ...(iv.passKind ? { kind: iv.passKind } : {}) } }
    }
    case "move_player": {
      const pl = find(iv.playerId)
      if (s.possession.kind === "owned" && s.possession.playerId === pl.id) throw new WhatIfError(`${pl.id} is on the ball; move another player`)
      const to = clampToPitch(iv.to)
      const players = s.players.map((p) => (p.id === pl.id ? { ...p, pos: to, vel: { x: 0, y: 0 }, intent: { kind: "hold" as const }, intentUntil: s.tick + Math.round(1 / s.config.dt) } : p))
      return { ...s, players }
    }
    case "tactic": {
      for (const [k, v] of Object.entries(iv.style)) {
        const range = STYLE_RANGES[k as keyof typeof STYLE_RANGES]
        if (!range) throw new WhatIfError(`unknown style setting "${k}"`)
        if (typeof v !== "number" || !(v >= range[0] && v <= range[1])) throw new WhatIfError(`style.${k} must be between ${range[0]} and ${range[1]}`)
      }
      const team = s.config[iv.side]
      return { ...s, config: { ...s.config, [iv.side]: { ...team, style: { ...team.style, ...iv.style } } } }
    }
  }
}

/** Play a state forward `ticks` ticks (or to full time). */
export const playAhead = (s: MatchState, ticks: number): { readonly events: DomainEvent[]; readonly state: MatchState } => {
  const events: DomainEvent[] = []
  let t = s
  const end = s.tick + ticks
  while (!isFinished(t) && t.tick < end) {
    const r = step(t)
    t = r.state
    events.push(...r.events)
  }
  return { events, state: t }
}

/** What one play-ahead produced, from one team's point of view. */
export interface Outcome {
  readonly goal_diff: number
  readonly xg_diff: number
  readonly shots_for: number
  readonly shots_against: number
  /** 1 if the team has the ball at the end, 0 if the opponents do, 0.5 when nobody does. */
  readonly possession_end: number
  /** How far up the pitch (the team's attacking x, metres) the ball is at the end. */
  readonly ball_progress: number
  /** The caller's value of the end state for the team (WhatIfOptions.endValue; 0 without one). */
  readonly end_value: number
  /** xg_diff + end_value: what the play produced plus what it leaves the team with. */
  readonly total: number
}

export const OUTCOME_KEYS = ["goal_diff", "xg_diff", "shots_for", "shots_against", "possession_end", "ball_progress", "end_value", "total"] as const

/** A value of a state for a team, e.g. the expected threat of where the ball is, signed by who has it. */
export type EndValue = (s: MatchState, side: Side) => number

export const outcomeOf = (events: ReadonlyArray<DomainEvent>, end: MatchState, side: Side, endValue?: EndValue): Outcome => {
  const team = end.config[side].id
  const xg = (e: DomainEvent) => (typeof e.attrs.xg === "number" ? e.attrs.xg : 0)
  const shots = events.filter((e) => e.type === "shot")
  const own = shots.filter((e) => e.team_id === team)
  const opp = shots.filter((e) => e.team_id !== team)
  const goals = events.filter((e) => e.type === "goal")
  const owner = end.possession.kind === "owned" ? end.players.find((p) => p.id === (end.possession as { playerId: string }).playerId) : undefined
  const xgDiff = own.reduce((a, e) => a + xg(e), 0) - opp.reduce((a, e) => a + xg(e), 0)
  const value = endValue ? endValue(end, side) : 0
  return {
    goal_diff: goals.filter((e) => e.team_id === team).length - goals.filter((e) => e.team_id !== team).length,
    xg_diff: xgDiff,
    shots_for: own.length,
    shots_against: opp.length,
    possession_end: owner ? (owner.side === side ? 1 : 0) : 0.5,
    ball_progress: attackX(side, end.ball.pos.x),
    end_value: value,
    total: xgDiff + value
  }
}

export interface Estimate {
  readonly mean: number
  /** Standard error of the mean. */
  readonly se: number
}

export interface WhatIfOptions {
  /** The team whose outcome is measured (default: the team on the ball, else the home side). */
  readonly side?: Side
  /** Paired random seeds (default 20, at most 200). */
  readonly seeds?: number
  /** Seconds played ahead (default 20, at most 600). */
  readonly horizonS?: number
  /** What the variant is compared with (default: nothing changed). */
  readonly baseline?: Intervention
  /** Values each play's end state (default: none, so end_value is 0). */
  readonly endValue?: EndValue
}

export interface WhatIfResult {
  readonly side: Side
  readonly at_tick: number
  readonly horizon_s: number
  readonly seeds: number
  readonly baseline: Readonly<Record<(typeof OUTCOME_KEYS)[number], Estimate>>
  readonly variant: Readonly<Record<(typeof OUTCOME_KEYS)[number], Estimate>>
  /** Variant minus baseline, seed by seed (paired). */
  readonly difference: Readonly<Record<(typeof OUTCOME_KEYS)[number], Estimate>>
}

const estimate = (xs: ReadonlyArray<number>): Estimate => {
  const n = xs.length
  const mean = xs.reduce((a, b) => a + b, 0) / n
  const sd = n > 1 ? Math.sqrt(xs.reduce((a, v) => a + (v - mean) ** 2, 0) / (n - 1)) : 0
  return { mean, se: n > 0 ? sd / Math.sqrt(n) : 0 }
}

/**
 * Compare an intervention with a baseline from the same state: each of `seeds` forks plays `horizonS` seconds
 * twice, once per arm, with the same random sub-streams, and the outcomes are averaged and differenced.
 */
export const whatIf = (s: MatchState, variant: Intervention, opts: WhatIfOptions = {}): WhatIfResult => {
  const seeds = opts.seeds ?? 20
  const horizonS = opts.horizonS ?? 20
  if (!Number.isInteger(seeds) || seeds < 1 || seeds > 200) throw new WhatIfError("seeds must be an integer from 1 to 200")
  if (!(horizonS > 0 && horizonS <= 600)) throw new WhatIfError("horizonS must be between 0 and 600 seconds")
  if (isFinished(s)) throw new WhatIfError("the match is over")
  const owner = s.possession.kind === "owned" ? s.players.find((p) => p.id === (s.possession as { playerId: string }).playerId) : undefined
  const side = opts.side ?? owner?.side ?? "home"
  const ticks = Math.round(horizonS / s.config.dt)
  const runs = { baseline: [] as Outcome[], variant: [] as Outcome[] }
  for (let k = 0; k < seeds; k++)
    for (const [arm, iv] of [["baseline", opts.baseline ?? { kind: "none" }], ["variant", variant]] as const) {
      const r = playAhead(applyIntervention(forkState(s, k), iv), ticks)
      runs[arm].push(outcomeOf(r.events, r.state, side, opts.endValue))
    }
  const per = (xs: Outcome[]) => Object.fromEntries(OUTCOME_KEYS.map((key) => [key, estimate(xs.map((o) => o[key]))])) as WhatIfResult["baseline"]
  const difference = Object.fromEntries(OUTCOME_KEYS.map((key) => [key, estimate(runs.variant.map((o, i) => o[key] - runs.baseline[i]![key]))])) as WhatIfResult["difference"]
  return { side, at_tick: s.tick, horizon_s: horizonS, seeds, baseline: per(runs.baseline), variant: per(runs.variant), difference }
}

/** The match states (after the step of each tick) at the given ticks, for a plain or scripted match. */
export const statesAt = (cfg: MatchConfig, ticks: Iterable<number>): Map<number, MatchState> => {
  const want = new Set(ticks)
  if ((cfg.script?.entries.length ?? 0) > 0) return new Map(runScript(cfg, { statesAt: want }).states)
  const out = new Map<number, MatchState>()
  const last = Math.max(-1, ...want)
  let s = initMatch(cfg)
  if (want.has(s.tick)) out.set(s.tick, s)
  while (!isFinished(s) && s.tick < last) {
    s = step(s).state
    if (want.has(s.tick)) out.set(s.tick, s)
  }
  return out
}

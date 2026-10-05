/**
 * Ground truth for the run manifest (spec §5.1.12 "ground truth in the manifest", §5.3.1 tactical truths):
 * what the script injected, every mistake with its cause, the errors that led to a shot or goal, and per-team
 * tactical numbers. The evaluation harness scores the agents' explanations against these.
 */
import type { DomainEvent, MatchConfig, ScenarioEffect, WindowResult } from "@touchline/sim-core"

/** Metric ids (spec §5.2) an agent should cite when explaining each kind of injected cause. */
export const EXPECTED_METRICS: Readonly<Record<ScenarioEffect, ReadonlyArray<string>>> = {
  goal: ["shot.xg", "team.mom"],
  red_card: ["team.mom", "game.chaos"],
  press_surge: ["team.press", "ppda", "tilt"],
  keeper_heroics: ["shot.xg"],
  momentum_swing: ["team.mom", "tilt"],
  keeper_howler: ["shot.xg", "game.chaos"],
  defensive_error: ["pass.acc", "game.chaos"]
}

export interface ScriptTruth {
  readonly effect: ScenarioEffect
  readonly team_id: string
  readonly minutes: readonly [number, number]
  /** The window's first and last frame as global ticks (as in domain.jsonl), not CDF frame ids, which restart each period. */
  readonly frames: readonly [number, number]
  readonly count: number
  /** Whether this entry's target was met in the accepted play. */
  readonly achieved: boolean
  /** Plays of the window (shared by the entries of one window). */
  readonly attempts: number
  /** Whether this entry's outcome was forced (its forced events carry `scripted: true`). */
  readonly forced: boolean
  readonly expected_metrics: ReadonlyArray<string>
}

export const scriptTruths = (windows: ReadonlyArray<WindowResult>, cfg: MatchConfig): ScriptTruth[] =>
  windows.flatMap((w) =>
    w.entries.map((e, i) => ({
      effect: e.effect,
      team_id: e.team === "home" ? cfg.home.id : cfg.away.id,
      minutes: e.window,
      frames: [w.fromFrame, w.toFrame] as const,
      count: e.count ?? 1,
      achieved: w.results[i]!.achieved,
      attempts: w.attempts,
      forced: w.results[i]!.forced,
      expected_metrics: EXPECTED_METRICS[e.effect]
    }))
  )

export interface Mistake {
  readonly event_id: string
  readonly frame_id: number
  readonly team_id: string | null
  readonly player_id: string | null
  readonly kind: "mishit" | "heavy_touch" | "miscontrol" | "missed_touch"
  /** Why it happened: forced by the scenario script, under pressure, or plain technique. */
  readonly cause: "script" | "pressure" | "technique"
}

const TOUCH: Readonly<Record<string, Mistake["kind"]>> = { heavy: "heavy_touch", miscontrol: "miscontrol", missed: "missed_touch" }

/** Every mis-hit kick (passes and clearances) and every bad first touch, in event order. */
export const mistakes = (events: ReadonlyArray<DomainEvent>): Mistake[] =>
  events.flatMap((e) => {
    const kind =
      (e.type === "pass" || e.type === "clearance") && e.attrs.execution === "mishit"
        ? ("mishit" as const)
        : e.type === "reception" && typeof e.attrs.first_touch === "string"
          ? TOUCH[e.attrs.first_touch]
          : undefined
    if (!kind) return []
    const cause = e.attrs.scripted === true ? "script" : e.attrs.under_pressure === true ? "pressure" : "technique"
    return [{ event_id: e.id, frame_id: e.frame_id, team_id: e.team_id, player_id: e.player_id, kind, cause } as const]
  })

export interface CriticalError {
  readonly kind: "error_leading_to_shot" | "error_leading_to_goal"
  readonly mistake_id: string
  readonly shot_id: string
  readonly team_id: string | null
  readonly frame_id: number
}

/**
 * A mistake that lost the ball is critical when the opponent shoots within 15 s and before the mistake's team wins it back
 * (spec §5.1.10: error leading to a shot or goal); a goal from that shot makes it an error leading to a goal.
 */
export const criticalErrors = (events: ReadonlyArray<DomainEvent>, cfg: MatchConfig): CriticalError[] => {
  const ordered = [...events].sort((a, b) => a.frame_id - b.frame_id)
  const horizon = Math.round(15 / cfg.dt)
  const ids = new Set(mistakes(ordered).map((m) => m.event_id))
  const out: CriticalError[] = []
  // The mistake itself must have given the ball away: a kick that did not reach a teammate, or a bad touch
  // after which the opponent had the ball within 5 s.
  const lostBall = (m: DomainEvent, later: ReadonlyArray<DomainEvent>): boolean => {
    if (m.type !== "reception") return m.outcome !== "successful"
    const change = later.find((e) => e.type === "possession_change")
    return change !== undefined && change.team_id !== m.team_id && change.frame_id - m.frame_id <= Math.round(5 / cfg.dt)
  }
  ordered.forEach((m, i) => {
    if (!ids.has(m.id) || !lostBall(m, ordered.slice(i + 1))) return
    for (const e of ordered.slice(i + 1)) {
      if (e.frame_id - m.frame_id > horizon) break
      if (e.type === "possession_change" && e.team_id === m.team_id) break
      if (e.type === "shot" && e.team_id !== m.team_id) {
        out.push({ kind: e.outcome === "goal" ? "error_leading_to_goal" : "error_leading_to_shot", mistake_id: m.id, shot_id: e.id, team_id: m.team_id, frame_id: m.frame_id })
        break
      }
    }
  })
  return out
}

export interface TeamTruth {
  /** Pressing intensity, independent of who had the ball: pressures per 100 opponent passes. */
  readonly pressures_per_100_opponent_passes: number
  readonly pass_share: number
  readonly shots: number
}

const r2 = (v: number) => Math.round(v * 100) / 100

export const tacticalTruths = (events: ReadonlyArray<DomainEvent>, cfg: MatchConfig): Record<string, TeamTruth> => {
  const n = (type: DomainEvent["type"], team: string) => events.filter((e) => e.type === type && e.team_id === team).length
  const passes = n("pass", cfg.home.id) + n("pass", cfg.away.id)
  const truth = (team: string, opp: string): TeamTruth => ({
    pressures_per_100_opponent_passes: r2((100 * n("pressure", team)) / Math.max(1, n("pass", opp))),
    pass_share: r2(n("pass", team) / Math.max(1, passes)),
    shots: n("shot", team)
  })
  return { [cfg.home.id]: truth(cfg.home.id, cfg.away.id), [cfg.away.id]: truth(cfg.away.id, cfg.home.id) }
}

/**
 * A managed match (spec §2.3): the engine steps the match; at each key moment every managed team's manager decides
 * from the same paused state, then their orders are applied and play goes on. Play does not advance while a decision
 * is pending. Every decision is reported (onDecision) as its decisions.jsonl line.
 */
import { Effect, Stream } from "effect"
import { applyOrders, initMatch, isFinished, step, type DomainEvent, type MatchConfig, type MatchState, type Side, type StepResult } from "@touchline/sim-core"
import type { Decision } from "@touchline/schema"
import type { StatsModels, XtGrid } from "@touchline/stats"
import type { Manager } from "./decision.js"
import { keyMoment, NO_MOMENTS, type MomentMemory } from "./moments.js"
import { MatchWatch, situationAt, situationHash } from "./situation.js"

export type Managers = Partial<Record<Side, Manager>>

export interface ManagedOptions {
  readonly models: StatsModels
  readonly xt: XtGrid | null
  readonly onDecision?: (d: Decision) => void
}

const SIDES = ["home", "away"] as const

/** The config with `managed` set to the teams that have a manager (no automatic substitutions for them). */
export const managedConfig = (cfg: MatchConfig, managers: Managers): MatchConfig => ({ ...cfg, managed: SIDES.filter((s) => managers[s] !== undefined) })

/** Every step of a managed match, decisions included, as a stream (the final full-time step is included). */
export const managedSteps = (config: MatchConfig, managers: Managers, opts: ManagedOptions): Stream.Stream<StepResult> => {
  const cfg = managedConfig(config, managers)
  const sides = SIDES.filter((s) => managers[s] !== undefined)
  return Stream.suspend(() => {
    const watch = new MatchWatch(cfg, opts.models, opts.xt)
    return Stream.unfold({ state: initMatch(cfg), memory: NO_MOMENTS as MomentMemory }, ({ state, memory }) =>
      Effect.gen(function* () {
        if (isFinished(state)) return undefined
        const r = step(state)
        watch.add(r)
        const k = keyMoment(r.state, r.events, memory)
        let next: MatchState = r.state
        if (k.reasons.length > 0 && sides.length > 0) {
          // Both managers decide from the same paused state; their orders apply afterwards.
          const decisions = yield* Effect.forEach(sides, (side) => {
            const situation = situationAt(r.state, side, k.reasons, watch)
            return managers[side]!.decide({ state: r.state, side, reasons: k.reasons, situation, situationHash: situationHash(situation) })
          })
          for (const d of decisions) {
            next = applyOrders(next, d.side, d.orders_applied)
            opts.onDecision?.(d)
          }
        }
        return [r, { state: next, memory: k.memory }] as const
      })
    )
  })
}

export interface ManagedRun {
  readonly events: ReadonlyArray<DomainEvent>
  readonly decisions: ReadonlyArray<Decision>
  readonly state: MatchState
}

/** Play a managed match to full time, keeping its events and decisions (not its frames). */
export const runManaged = (cfg: MatchConfig, managers: Managers, opts: Omit<ManagedOptions, "onDecision">): Effect.Effect<ManagedRun> =>
  Effect.gen(function* () {
    const decisions: Decision[] = []
    const events: DomainEvent[] = []
    let state = initMatch(managedConfig(cfg, managers))
    yield* Stream.runForEach(managedSteps(cfg, managers, { ...opts, onDecision: (d) => decisions.push(d) }), (r) =>
      Effect.sync(() => {
        events.push(...r.events)
        state = r.state
      })
    )
    return { events, decisions, state }
  })

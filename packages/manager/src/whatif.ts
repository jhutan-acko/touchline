/**
 * Testing a manager's options by re-simulation (spec §2.3): from the paused state, each option and "no change" play the
 * next HORIZON on the same SEEDS forks (each in its own worker thread), and an option's value is its paired difference
 * from "no change" in the team's xG difference (goal difference alongside). An option whose worker fails or runs out
 * of time is marked untested; so is every option when "no change" itself could not be played.
 */
import { availableParallelism } from "node:os"
import { Worker } from "node:worker_threads"
import { Effect } from "effect"
import { applyOrders, forkState, outcomeOf, playAhead, type MatchState, type Side } from "@touchline/sim-core"
import type { ManagerOrder, WhatIfSummary } from "@touchline/schema"
import type { DecisionOption } from "./decision.js"

export const WHATIF_SEEDS = 20
export const WHATIF_HORIZON_S = 600
/** A worker that has not answered by then marks its option untested. */
export const WHATIF_TIMEOUT_MS = 60_000

export interface ArmJob {
  readonly state: MatchState
  readonly side: Side
  readonly orders: ReadonlyArray<ManagerOrder>
  readonly seeds: number
  readonly horizonS: number
}

/** One arm's outcome on each fork: the team's xG difference and goal difference over the horizon. CPU only. */
export const armOutcomes = (job: ArmJob): Array<{ readonly xg: number; readonly goals: number }> => {
  const ticks = Math.round(job.horizonS / job.state.config.dt)
  return Array.from({ length: job.seeds }, (_, k) => {
    const fork = forkState(job.state, k)
    const r = playAhead(job.orders.length > 0 ? applyOrders(fork, job.side, job.orders) : fork, ticks)
    const o = outcomeOf(r.events, r.state, job.side)
    return { xg: o.xg_diff, goals: o.goal_diff }
  })
}

const runArm = (job: ArmJob, timeoutMs: number): Promise<ReturnType<typeof armOutcomes>> =>
  new Promise((resolve, reject) => {
    const worker = new Worker(new URL("./whatif-worker.ts", import.meta.url), { workerData: job, execArgv: ["--import", "tsx"] })
    const timer = setTimeout(() => {
      void worker.terminate()
      reject(new Error(`timed out after ${timeoutMs / 1000} s`))
    }, timeoutMs)
    worker.once("message", (m: { ok?: ReturnType<typeof armOutcomes>; error?: string }) => {
      clearTimeout(timer)
      void worker.terminate()
      if (m.ok) resolve(m.ok)
      else reject(new Error(m.error ?? "worker failed"))
    })
    worker.once("error", (e) => {
      clearTimeout(timer)
      reject(e)
    })
  })

const estimate = (xs: ReadonlyArray<number>) => {
  const n = xs.length
  const mean = xs.reduce((a, b) => a + b, 0) / n
  const sd = n > 1 ? Math.sqrt(xs.reduce((a, v) => a + (v - mean) ** 2, 0) / (n - 1)) : 0
  return { mean, se: n > 0 ? sd / Math.sqrt(n) : 0 }
}

export interface TestOptions {
  readonly seeds?: number
  readonly horizonS?: number
  readonly timeoutMs?: number
  /** "inline" plays every arm on this thread (tests); "worker" (default) one worker thread per arm. */
  readonly runner?: "worker" | "inline"
}

/** Re-simulate the options (option 0 is "no change") and fill in their paired differences from "no change". */
export const testOptions = (state: MatchState, side: Side, options: ReadonlyArray<DecisionOption>, opts: TestOptions = {}): Effect.Effect<DecisionOption[]> => {
  const job = (orders: ReadonlyArray<ManagerOrder>): ArmJob => ({ state, side, orders, seeds: opts.seeds ?? WHATIF_SEEDS, horizonS: opts.horizonS ?? WHATIF_HORIZON_S })
  const play = (orders: ReadonlyArray<ManagerOrder>) =>
    opts.runner === "inline"
      ? Effect.try(() => armOutcomes(job(orders)))
      : Effect.tryPromise(() => runArm(job(orders), opts.timeoutMs ?? WHATIF_TIMEOUT_MS))
  return Effect.gen(function* () {
    const arms = yield* Effect.forEach(options, (o) => Effect.option(play(o.orders)), { concurrency: Math.max(1, availableParallelism() - 1) })
    const base = arms[0]!
    return options.map((o, i) => {
      if (i === 0) return o
      const arm = arms[i]!
      if (base._tag === "None" || arm._tag === "None") return { ...o, xg_diff_vs_no_change: null, goal_diff_vs_no_change: null, untested: true }
      const b = base.value
      return {
        ...o,
        xg_diff_vs_no_change: estimate(arm.value.map((x, k) => x.xg - b[k]!.xg)),
        goal_diff_vs_no_change: estimate(arm.value.map((x, k) => x.goals - b[k]!.goals)),
        untested: false
      }
    })
  })
}

const r3 = (x: number) => Math.round(x * 1000) / 1000 || 0

/** What the agent is shown of the tested options (numbers rounded to 3 decimals: what the reason may quote). */
export const whatIfSummary = (options: ReadonlyArray<DecisionOption>, opts: Pick<TestOptions, "seeds" | "horizonS"> = {}): WhatIfSummary => {
  const seeds = opts.seeds ?? WHATIF_SEEDS
  const minutes = (opts.horizonS ?? WHATIF_HORIZON_S) / 60
  const est = (e: DecisionOption["xg_diff_vs_no_change"]) => (e === null ? null : { mean: r3(e.mean), se: r3(e.se) })
  return {
    seeds,
    horizon_min: minutes,
    explanation: `Each option was played from this moment ${seeds} times over the next ${minutes} minutes, on the same ${seeds} random futures as no change. Numbers are the average difference from no change in your xG minus the opponent's xG (and in goals), with one standard error; untested options could not be played.`,
    options: options.map((o) => ({ index: o.index, label: o.label, orders: o.orders, xg_diff_vs_no_change: est(o.xg_diff_vs_no_change), goal_diff_vs_no_change: est(o.goal_diff_vs_no_change), untested: o.untested }))
  }
}

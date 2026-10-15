import type { League } from "@touchline/league"
import type { Params } from "@touchline/sim-core"
import { evaluate, loss, meanMetrics, type Targets } from "./evaluate.js"
import { applyKnobs, initialKnobs, KNOBS, type Knob, type KnobValues } from "./knobs.js"
import type { GateKey } from "./gate.js"
import type { EvalPool } from "./pool.js"

export interface Scored<S> {
  readonly loss: number
  readonly detail: S
}

export interface SearchResult<S> {
  readonly knobs: KnobValues
  readonly loss: number
  readonly evals: number
  readonly detail: S
}

const clampTo = (k: Knob, v: number): number => Math.min(k.max, Math.max(k.min, Math.round(v * 1e6) / 1e6))

type Trial = KnobValues

/**
 * The search itself, as a generator: it yields each trial point and is sent back that point's score.
 * One definition of the order and accept/reject logic serves both the sync and the async driver.
 */
function* searchSteps<S>(knobs: ReadonlyArray<Knob>, start: KnobValues, rounds: number): Generator<Trial, { values: KnobValues; best: Scored<S> }, Scored<S>> {
  let values: Record<string, number> = { ...start }
  let best = yield values
  const steps: Record<string, number> = Object.fromEntries(knobs.map((k) => [k.name, k.step]))
  for (let round = 0; round < rounds; round++) {
    for (const k of knobs) {
      for (const dir of [1, -1]) {
        // Keep stepping in this direction while it helps (a cheap line search), then move on.
        let moved = false
        for (;;) {
          const v = clampTo(k, values[k.name]! + dir * steps[k.name]!)
          if (v === values[k.name]) break
          const trial = { ...values, [k.name]: v }
          const r = yield trial
          if (r.loss >= best.loss) break
          values = trial
          best = r
          moved = true
        }
        if (moved) break
      }
    }
    for (const k of knobs) steps[k.name] = steps[k.name]! / 2
  }
  return { values, best }
}

/**
 * Coordinate search with step halving: for each knob, keep stepping up (or else down) while the loss
 * falls, then halve every step after each round. Deterministic for a deterministic `score`.
 */
export const coordinateSearch = <S>(
  knobs: ReadonlyArray<Knob>,
  start: KnobValues,
  rounds: number,
  score: (values: KnobValues) => Scored<S>,
  onEval?: (evals: number, loss: number) => void
): SearchResult<S> => {
  const gen = searchSteps<S>(knobs, start, rounds)
  let evals = 0
  let step = gen.next()
  while (!step.done) {
    const r = score(step.value)
    evals++
    onEval?.(evals, r.loss)
    step = gen.next(r)
  }
  return { knobs: step.value.values, loss: step.value.best.loss, evals, detail: step.value.best.detail }
}

/** The same search with an asynchronous `score` (e.g. a worker pool); identical order and decisions. */
export const coordinateSearchAsync = async <S>(
  knobs: ReadonlyArray<Knob>,
  start: KnobValues,
  rounds: number,
  score: (values: KnobValues) => Promise<Scored<S>>,
  onEval?: (evals: number, loss: number) => void
): Promise<SearchResult<S>> => {
  const gen = searchSteps<S>(knobs, start, rounds)
  let evals = 0
  let step = gen.next()
  while (!step.done) {
    const r = await score(step.value)
    evals++
    onEval?.(evals, r.loss)
    step = gen.next(r)
  }
  return { knobs: step.value.values, loss: step.value.best.loss, evals, detail: step.value.best.detail }
}

export interface TuneOptions {
  readonly matches: number
  readonly rounds: number
  /** Knob values to start from (e.g. a previous calibration); missing knobs start at their identity value. */
  readonly start?: KnobValues
  /** Worker pool to evaluate matches on; omitted = serial, in this thread. */
  readonly pool?: EvalPool
  readonly onEval?: (evals: number, loss: number) => void
}

/**
 * Method of simulated moments: tune engine knobs so the mean statistics of `matches` simulated
 * matches (same fixtures and seeds every time — common random numbers) match the real targets.
 */
export const tune = (league: League, base: Params, targets: Targets, opts: TuneOptions): Promise<SearchResult<Readonly<Record<GateKey, number>>>> =>
  coordinateSearchAsync(KNOBS, { ...initialKnobs(), ...opts.start }, opts.rounds, async (values) => {
    const params = applyKnobs(base, values)
    const sim = meanMetrics(opts.pool ? await opts.pool.evaluate(params, opts.matches) : evaluate(league, params, opts.matches))
    return { loss: loss(sim, targets), detail: sim }
  }, opts.onEval)

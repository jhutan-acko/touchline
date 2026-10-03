import { Effect, Schedule, Stream } from "effect"
import { initMatch, isFinished, step, type MatchConfig, type StepResult } from "@touchline/sim-core"

/** Every step of a match as a stream; the final full-time step is included. */
export const matchSteps = (cfg: MatchConfig): Stream.Stream<StepResult> =>
  Stream.iterate<StepResult>({ state: initMatch(cfg), frame: null, events: [] }, (r) => step(r.state)).pipe(
    Stream.drop(1),
    Stream.takeUntil((r) => isFinished(r.state))
  )

/** Paced for live playback: one step every (dt / speed) seconds of wall-clock time. */
export const pacedSteps = (cfg: MatchConfig, speed: number): Stream.Stream<StepResult> =>
  matchSteps(cfg).pipe(Stream.schedule(Schedule.spaced(`${Math.round((cfg.dt * 1000) / speed)} millis`)))

export const collect = <A>(s: Stream.Stream<A>) => Stream.runCollect(s).pipe(Effect.map((c) => Array.from(c)))

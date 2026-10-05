import { Effect, Schedule, Stream } from "effect"
import { initMatch, isFinished, runScript, step, type MatchConfig, type StepResult } from "@touchline/sim-core"

/** True when the config carries a script with at least one entry. */
export const hasScript = (cfg: MatchConfig): boolean => (cfg.script?.entries.length ?? 0) > 0

/**
 * Every step of a match as a stream; the final full-time step is included. A scripted match is resolved first
 * (its windows may be re-played, spec §5.1.7) and then streamed, so live playback never shows a discarded attempt.
 */
export const matchSteps = (cfg: MatchConfig): Stream.Stream<StepResult> =>
  hasScript(cfg)
    ? Stream.fromIterable(runScript(cfg).steps)
    : Stream.iterate<StepResult>({ state: initMatch(cfg), frame: null, events: [] }, (r) => step(r.state)).pipe(
        Stream.drop(1),
        Stream.takeUntil((r) => isFinished(r.state))
      )

/** Paced for live playback: one step every (dt / speed) seconds of wall-clock time. */
export const pacedSteps = (cfg: MatchConfig, speed: number): Stream.Stream<StepResult> =>
  matchSteps(cfg).pipe(Stream.schedule(Schedule.spaced(`${Math.round((cfg.dt * 1000) / speed)} millis`)))

export const collect = <A>(s: Stream.Stream<A>) => Stream.runCollect(s).pipe(Effect.map((c) => Array.from(c)))

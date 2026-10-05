import { Effect, Stream } from "effect"
import { emittedAt, readRun, StatsEngine, StatsQuery, type ReplayError, type Roster, type StatsInput, type StatsModels } from "@touchline/stats"

export interface LoadOptions {
  /**
   * Stop at this match minute, as if the match were live then (minutes from 45 count in the second half, as in
   * scenario scripts). Default: the whole match.
   */
  readonly minute?: number
  readonly roster?: Roster
}

/** Replay a run folder into a stats engine (up to a minute, if given) and wrap it for queries. */
export const loadRun = (dir: string, models: StatsModels, opts: LoadOptions = {}): Effect.Effect<StatsQuery, ReplayError> =>
  Effect.gen(function* () {
    const run = yield* readRun(dir, opts.roster)
    const engine = new StatsEngine(run.info, models)
    const minute = opts.minute
    const ticksPerMin = 60 / run.info.dt
    // The last tick to take: known for the first half up front, for the second once its first frame arrives.
    let cut = minute === undefined ? Infinity : minute < 45 ? Math.round(minute * ticksPerMin) : Infinity
    const tickOf = (i: StatsInput) => (i.kind === "frame" ? i.frame.tick : emittedAt(i.event))
    yield* Stream.runForEach(
      run.inputs.pipe(
        Stream.takeWhile((i) => {
          if (minute !== undefined && minute >= 45 && i.kind === "frame" && i.frame.period === "second_half" && i.frame.frame_id === 0) cut = i.frame.tick + Math.round((minute - 45) * ticksPerMin)
          return tickOf(i) <= cut
        })
      ),
      (i) => Effect.sync(() => engine.ingest(i))
    )
    engine.finish()
    return new StatsQuery(engine)
  })

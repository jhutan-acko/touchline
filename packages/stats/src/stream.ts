import { Stream } from "effect"
import type { Signal } from "@touchline/schema"
import type { StepOutput } from "@touchline/sim-core"
import type { StatsEngine } from "./engine.js"
import type { StatsInput } from "./input.js"

/** A live match's steps as stats inputs: each step's events, then its frame. */
export const stepInputs = <E, R>(steps: Stream.Stream<StepOutput, E, R>): Stream.Stream<StatsInput, E, R> =>
  steps.pipe(
    Stream.map((r): StatsInput[] => [...r.events.map((event) => ({ kind: "event" as const, event })), ...(r.frame ? [{ kind: "frame" as const, frame: r.frame }] : [])]),
    Stream.flattenIterable
  )

/**
 * Feed a stream of inputs to the engine and emit the signals as they are raised (the hot path, spec §4); the
 * last tick's checks run when the input stream ends. The engine keeps every metric for queries.
 */
export const signalStream = <E, R>(engine: StatsEngine, inputs: Stream.Stream<StatsInput, E, R>): Stream.Stream<Signal, E, R> =>
  inputs.pipe(
    Stream.map((i) => engine.ingest(i)),
    Stream.flattenIterable,
    Stream.concat(Stream.suspend(() => Stream.fromIterable(engine.finish())))
  )

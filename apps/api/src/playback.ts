/**
 * A match as a timeline (the hot path of spec §4): its frames from tracking, a scoreboard each second from the stats
 * engine (score, momentum), the signals the engine raises (for live agents), and the cached agent cues at the frame
 * each one ends on. `paced` plays it at a speed, pausable.
 */
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { Duration, Effect, Stream, SubscriptionRef } from "effect"
import type { PitchFrame } from "@touchline/rpc"
import type { Cue, Signal } from "@touchline/schema"
import { modelsFromJson, readRun, StatsEngine, xtGridFromJson, type ReplayError, type Roster, type StatsInput, type TrackFrame } from "@touchline/stats"
import type { LibraryMatch } from "./library.js"

export const root = join(import.meta.dirname, "../../..")

export interface Board {
  readonly frame: number
  readonly clock: string
  readonly score: { readonly home: number; readonly away: number }
  /** Each team's momentum share (null until there is play to measure). */
  readonly momentum: { readonly home: number; readonly away: number } | null
}

export type Beat =
  | { readonly kind: "frame"; readonly frame: PitchFrame }
  | { readonly kind: "board"; readonly board: Board }
  /** The variants of one moment or recap, all segments: each watcher picks its own. */
  | { readonly kind: "cues"; readonly frame: number; readonly cues: ReadonlyArray<Cue> }
  | { readonly kind: "signals"; readonly frame: number; readonly signals: ReadonlyArray<Signal> }
  | { readonly kind: "end"; readonly frame: number }

const params = (f: string) => JSON.parse(readFileSync(join(root, "data/params", f), "utf8"))
let roster: Roster | undefined
const league = (): Roster => (roster ??= JSON.parse(readFileSync(join(root, "data/league/league.json"), "utf8")) as Roster)

const r3 = (v: number) => Math.round(v * 1000) / 1000

const toFrame = (f: TrackFrame, clock: string): PitchFrame => ({
  frame: f.tick,
  period: f.period,
  clock,
  ball: { x: r3(f.ball.x), y: r3(f.ball.y), z: r3(f.ball.z) },
  home: f.home.map((p) => ({ id: p.id, x: r3(p.x), y: r3(p.y) })),
  away: f.away.map((p) => ({ id: p.id, x: r3(p.x), y: r3(p.y) }))
})

/** Cached cues grouped by moment (or recap), in the order of the frame they end on. */
export const cueGroups = (cues: ReadonlyArray<Cue>): Array<{ frame: number; cues: Cue[] }> => {
  const by = new Map<string, Cue[]>()
  for (const c of cues) if (c.moment_id !== null) by.set(c.moment_id, [...(by.get(c.moment_id) ?? []), c])
  return [...by.values()].map((cs) => ({ frame: cs[0]!.anchor.frame_to, cues: cs })).sort((a, b) => a.frame - b.frame)
}

/** The match's timeline from `fromFrame` (earlier play still feeds the stats engine, so numbers are right), unpaced. */
export const beats = (m: LibraryMatch, fromFrame = 0): Stream.Stream<Beat, ReplayError> =>
  Stream.unwrap(
    Effect.gen(function* () {
      const run = yield* readRun(m.dir, league())
      const engine = new StatsEngine(run.info, modelsFromJson(params("stats-models.json")), xtGridFromJson(params("xt-grid.json")))
      const groups = cueGroups(m.cues)
      const every = Math.max(1, Math.round(1 / run.info.dt)) // a scoreboard each second of match time
      const { home, away } = run.info
      const score = { home: 0, away: 0 }
      let next = 0
      let last = -1
      const board = (tick: number, clock: string): Beat => {
        const mom = engine.value("team.mom", home.id, { at: tick })
        return { kind: "board", board: { frame: tick, clock, score: { ...score }, momentum: mom === null ? null : { home: r3(mom), away: r3(1 - mom) } } }
      }
      const due = (frame: number): Beat[] => {
        const out: Beat[] = []
        while (next < groups.length && groups[next]!.frame <= frame) {
          const g = groups[next++]!
          if (g.frame >= fromFrame) out.push({ kind: "cues", frame: g.frame, cues: g.cues })
        }
        return out
      }
      const step = (input: StatsInput): Beat[] => {
        const signals = engine.ingest(input)
        if (input.kind === "event") {
          // Events raise most signals (goals, cards, big chances), frames the rest (pressure, momentum, sprints).
          const out: Beat[] = []
          if (input.event.type === "goal") {
            input.event.team_id === home.id ? score.home++ : score.away++
            // The hot path (spec §2: under 250 ms from the event): a goal reaches the scoreboard at once.
            if (last >= fromFrame) out.push(board(last, engine.clockAt(last)))
          }
          const at = signals[0]?.frame_id ?? 0
          if (signals.length && at >= fromFrame) out.push({ kind: "signals", frame: at, signals })
          return out
        }
        const f = input.frame
        last = f.tick
        const out: Beat[] = []
        if (f.tick >= fromFrame) {
          const clock = engine.clockAt(f.tick)
          out.push({ kind: "frame", frame: toFrame(f, clock) })
          if (signals.length) out.push({ kind: "signals", frame: f.tick, signals })
          if (f.tick % every === 0) out.push(board(f.tick, clock))
        }
        return [...out, ...due(f.tick)]
      }
      return run.inputs.pipe(
        Stream.map(step),
        Stream.flattenIterable,
        Stream.concat(
          Stream.suspend(() => {
            const signals = engine.finish()
            const end = Math.max(0, last)
            const tail: Beat[] = signals.length && end >= fromFrame ? [{ kind: "signals", frame: end, signals }] : []
            return Stream.fromIterable([...tail, ...due(Number.MAX_SAFE_INTEGER), { kind: "end", frame: end } as Beat])
          })
        )
      )
    })
  )

export interface Control {
  readonly paused: boolean
  /** Match seconds per wall-clock second. */
  readonly speed: number
}

/** Play the timeline in match time: each frame waits 1/fps of a second divided by the speed, and not at all while paused. */
export const paced = <E>(timeline: Stream.Stream<Beat, E>, control: SubscriptionRef.SubscriptionRef<Control>, fps: number): Stream.Stream<Beat, E> =>
  timeline.pipe(
    Stream.tap((beat) =>
      beat.kind !== "frame"
        ? Effect.void
        : Effect.gen(function* () {
            let c = yield* SubscriptionRef.get(control)
            if (c.paused) {
              yield* SubscriptionRef.changes(control).pipe(Stream.filter((x) => !x.paused), Stream.runHead)
              c = yield* SubscriptionRef.get(control)
            }
            yield* Effect.sleep(Duration.millis(1000 / fps / c.speed))
          })
    )
  )

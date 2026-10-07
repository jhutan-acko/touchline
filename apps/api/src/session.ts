/**
 * Sessions on the cue bus (spec §4 "cue bus", §5.7 startMatch / subscribeCues): a session plays one match at a speed
 * and publishes its timeline; every watcher gets the frames, a scoreboard cue and the agent cues for its own segment,
 * all in the same match time (so a split screen shows two segments of one moment together).
 */
import { randomUUID } from "node:crypto"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { Cause, Deferred, Effect, Fiber, PubSub, Ref, Stream, SubscriptionRef } from "effect"
import { SessionNotFound, type Playback, type QueueStatus, type Tick } from "@touchline/rpc"
import { segmentKey, type Cue, type MomentTrace, type Recap, type Segment } from "@touchline/schema"
import { pickCues } from "./cues.js"
import type { LibraryMatch } from "./library.js"
import { beats, paced, type Beat, type Board, type Control } from "./playback.js"

/** A session nobody watches stops after this long. */
export const IDLE_STOP_S = 30
/** After the final whistle, live agents get this long to deliver their last cues and the full-time recap. */
export const LIVE_GRACE_S = 60
/** Frames sent to watchers per second of wall-clock time, at most (about: every ⌊speed × fps / 25⌋th frame). */
export const FRAMES_PER_S = 25

/** Which frames a session at `speed` sends: every `frameStep`th. */
export const frameStep = (speed: number, fps: number): number => Math.max(1, Math.floor((speed * fps) / FRAMES_PER_S))

/** A moment (or recap) in the session's studio queue: all its segment variants, and the facts its claims were checked against. */
export interface QueueEntry {
  readonly moment_id: string
  readonly frame: number
  readonly clock: string
  readonly status: QueueStatus
  readonly cues: ReadonlyArray<Cue>
  /** Talking points from the evidence ("Cause: …", "Pressure index (Larkspur City): 0.71"), in English. */
  readonly facts: ReadonlyArray<string>
}

/**
 * What a session's bus carries: the timeline; studio queue changes and cues sent to air; then `closed` once nothing
 * more will come (live agents included).
 */
export type BusBeat =
  | Beat
  | { readonly kind: "queue"; readonly entry: QueueEntry }
  | { readonly kind: "air"; readonly frame: number; readonly cues: ReadonlyArray<Cue> }
  | { readonly kind: "closed" }

/** What a session measures for the ops view (wall-clock milliseconds). */
export interface Metrics {
  /** Each goal: the frame it was scored in played, to the new score on the bus (the stats-overlay latency). */
  readonly stats: number[]
}

/** What a live session's agents have written so far: its cues, the traces behind them and its recaps. */
export interface LiveStore {
  readonly cues: Cue[]
  readonly traces: MomentTrace[]
  readonly recaps: Recap[]
}

/** The cue the scoreboard sends each second (spec §5.4: stats cues share the contract, verified, without text). */
export const boardCue = (matchId: string, b: Board, segment: Segment): Cue => ({
  cue_id: `${matchId}-board-${b.frame}`,
  schema: "touchline.cue/1",
  match_id: matchId,
  moment_id: null,
  anchor: { frame_from: b.frame, frame_to: b.frame, clock: b.clock.slice(0, 5) },
  display: { slot: "top_bar", priority: 3, ttl_ms: 2000, template: "scoreboard" },
  segment,
  text: null,
  data: { "score.home": b.score.home, "score.away": b.score.away, ...(b.momentum ? { "team.mom.home": b.momentum.home, "team.mom.away": b.momentum.away } : {}) },
  evidence: [],
  verified: true
})

/** The frame a match starts from at a minute (minutes from 45 count in the second half, as in scenario scripts). */
export const startFrame = (m: LibraryMatch, minute: number): number => {
  const perMinute = 60 * m.info.fps
  if (minute < 45) return Math.round(minute * perMinute)
  for (const line of readFileSync(join(m.dir, "domain.jsonl"), "utf8").split("\n")) {
    if (!line.includes('"period_start"')) continue
    const e = JSON.parse(line) as { frame_id: number; attrs: { period?: string }; period: string }
    if (e.period === "second_half") return Math.min(m.info.frames, e.frame_id + Math.round((minute - 45) * perMinute))
  }
  return m.info.frames
}

export interface Session {
  readonly id: string
  readonly match: LibraryMatch
  readonly live: boolean
  readonly control: SubscriptionRef.SubscriptionRef<Control>
  readonly bus: PubSub.PubSub<BusBeat>
  readonly playback: Ref.Ref<Playback>
  /** True once the bus has sent `closed`. */
  readonly closed: Ref.Ref<boolean>
  /** What the live agents wrote (empty for a recorded session). */
  readonly agents: LiveStore
  readonly metrics: Metrics
  /** The studio queue, by moment. */
  readonly queue: Ref.Ref<ReadonlyMap<string, QueueEntry>>
  readonly watchers: Ref.Ref<number>
  /** The segments watched so far (live agents write cues for these). */
  readonly segments: Ref.Ref<ReadonlyMap<string, Segment>>
}

export interface StartOptions {
  readonly speed: number
  readonly fromMinute: number
  readonly live: boolean
}

/** Runs alongside a live session's playback (Task 7: live agents); receives the session. */
export type Companion = (s: Session) => Effect.Effect<void>

/** Runs for every session's life, reading its bus from before play starts (the studio queue). */
export type Recorder = (s: Session, sub: PubSub.Subscription<BusBeat>) => Effect.Effect<void>

/** The sessions of one API process. Their fibers live in `scope`. */
export const makeSessions = (library: ReadonlyMap<string, LibraryMatch>, options: { readonly companion?: Companion; readonly studio?: Recorder } = {}) =>
  Effect.gen(function* () {
    const scope = yield* Effect.scope
    const sessions = new Map<string, Session>()
    const fibers = new Map<string, Fiber.Fiber<unknown, unknown>>()

    const stop = (id: string) =>
      Effect.gen(function* () {
        const f = fibers.get(id)
        sessions.delete(id)
        fibers.delete(id)
        if (f) yield* Fiber.interrupt(f)
      })

    /** Stop the session if nobody is watching it `IDLE_STOP_S` from now. */
    const stopIfIdle = (s: Session) =>
      Effect.forkIn(Effect.sleep(`${IDLE_STOP_S} seconds`).pipe(Effect.andThen(Ref.get(s.watchers)), Effect.flatMap((m) => (m === 0 ? stop(s.id) : Effect.void))), scope)

    const start = (match: LibraryMatch, o: StartOptions) =>
      Effect.gen(function* () {
        const id = randomUUID()
        const from = startFrame(match, o.fromMinute)
        const fps = match.info.fps
        const control = yield* SubscriptionRef.make<Control>({ paused: false, speed: o.speed })
        const bus = yield* PubSub.unbounded<BusBeat>()
        const playback = yield* Ref.make<Playback>({ state: "playing", frame: from, speed: o.speed, live: o.live })
        const watchers = yield* Ref.make(0)
        const segments = yield* Ref.make<ReadonlyMap<string, Segment>>(new Map())
        const closed = yield* Ref.make(false)
        const queue = yield* Ref.make<ReadonlyMap<string, QueueEntry>>(new Map())
        const ended = yield* Deferred.make<void>()
        const s: Session = { id, match, live: o.live, control, bus, playback, closed, agents: { cues: [], traces: [], recaps: [] }, metrics: { stats: [] }, queue, watchers, segments }
        const end = (frame: number) =>
          Ref.update(playback, (p): Playback => ({ ...p, state: "ended", frame })).pipe(Effect.andThen(PubSub.publish(bus, { kind: "end", frame })))
        // A live session shows the agents' cues as they are written, never the cache's.
        const timeline = beats(o.live ? { ...match, cues: [] } : match, from)
        let playedAt = 0 // when the latest frame was played
        let goals = -1 // goals on the latest scoreboard (-1: none yet)
        const play = paced(timeline, control, fps).pipe(
          Stream.runForEach((b) =>
            Effect.gen(function* () {
              if (b.kind === "board") {
                const now = b.board.score.home + b.board.score.away
                if (goals >= 0 && now > goals) s.metrics.stats.push(performance.now() - playedAt)
                goals = now
              }
              if (b.kind === "frame") {
                playedAt = performance.now()
                yield* Ref.update(playback, (p) => ({ ...p, frame: b.frame.frame }))
                // Watchers get at most about FRAMES_PER_S frames a second, however fast the session plays.
                if (b.frame.frame % frameStep((yield* SubscriptionRef.get(control)).speed, fps) !== 0) return
              }
              if (b.kind === "end") return yield* end(b.frame)
              yield* PubSub.publish(bus, b)
            })
          ),
          // A replay that fails still ends the match for its watchers.
          Effect.catch((e) => Effect.logError(`session ${id}: ${String(e)}`).pipe(Effect.andThen(Effect.flatMap(Ref.get(playback), (p) => end(p.frame))))),
          Effect.ensuring(Deferred.succeed(ended, undefined))
        )
        // Live agents that fail are logged and never stop play; after the whistle they get LIVE_GRACE_S to finish.
        const agents = o.live && options.companion
          ? options.companion(s).pipe(
              Effect.catchCause((c) => Effect.logError(`session ${id}: live agents: ${Cause.pretty(c)}`)),
              Effect.raceFirst(Deferred.await(ended).pipe(Effect.andThen(Effect.sleep(`${LIVE_GRACE_S} seconds`))))
            )
          : Effect.void
        // The studio subscribes before play starts, so it sees every moment; it stops when the session closes.
        const studio = Effect.gen(function* () {
          const sub = yield* PubSub.subscribe(bus)
          if (options.studio) yield* Effect.forkScoped(options.studio(s, sub))
          yield* Effect.all([play, agents], { concurrency: "unbounded", discard: true })
        }).pipe(Effect.scoped)
        const main = studio.pipe(
          Effect.andThen(Ref.set(closed, true)),
          Effect.andThen(PubSub.publish(bus, { kind: "closed" })),
          Effect.andThen(Effect.sleep("60 seconds")), // let late requests (evidence, recap) see the ended session
          Effect.ensuring(
            Effect.gen(function* () {
              sessions.delete(id)
              fibers.delete(id)
              yield* Ref.set(closed, true)
              yield* PubSub.shutdown(bus)
            })
          )
        )
        sessions.set(id, s)
        fibers.set(id, yield* Effect.forkIn(main, scope))
        yield* stopIfIdle(s) // started but never watched (a closed tab, a double click)
        return s
      })

    const get = (id: string) => Effect.fromNullishOr(sessions.get(id)).pipe(Effect.mapError(() => new SessionNotFound({ session_id: id })))

    const toTicks = (s: Session, segment: Segment) => (b: BusBeat): Tick[] => {
      switch (b.kind) {
        case "frame":
          return [{ kind: "frame", frame: b.frame }]
        case "board":
          return [{ kind: "cue", cue: boardCue(s.match.info.match_id, b.board, segment) }]
        case "cues":
          return pickCues(b.cues, segment).map((cue) => ({ kind: "cue" as const, cue }))
        case "signals":
        case "queue":
        case "air":
        case "closed":
          return []
        case "end":
          return [{ kind: "playback", playback: { state: "ended", frame: b.frame, speed: 0, live: s.live } }]
      }
    }

    /** The session's ticks for one segment, from now until the session closes; the session stops when nobody watches. */
    const watch = (id: string, segment: Segment) =>
      Stream.unwrap(
        Effect.gen(function* () {
          const s = yield* get(id)
          // Subscribe before looking at `closed`, so the closing beat cannot slip between the two.
          const sub = yield* PubSub.subscribe(s.bus)
          const now = yield* Ref.get(s.playback)
          if (yield* Ref.get(s.closed)) return Stream.make({ kind: "playback", playback: now } as Tick)
          yield* Ref.update(s.watchers, (n) => n + 1)
          yield* Ref.update(s.segments, (m) => new Map([...m, [segmentKey(segment), segment]]))
          const leave = Ref.updateAndGet(s.watchers, (n) => n - 1).pipe(Effect.flatMap((n) => (n > 0 ? Effect.void : stopIfIdle(s))), Effect.asVoid)
          return Stream.make({ kind: "playback", playback: now } as Tick).pipe(
            Stream.concat(Stream.fromSubscription(sub).pipe(Stream.takeUntil((b) => b.kind === "closed"), Stream.map(toTicks(s, segment)), Stream.flattenIterable)),
            Stream.ensuring(leave)
          )
        })
      )

    const control = (id: string, action: "play" | "pause" | "speed", speed: number | null) =>
      Effect.gen(function* () {
        const s = yield* get(id)
        yield* SubscriptionRef.update(s.control, (c) => ({ paused: action === "pause" ? true : action === "play" ? false : c.paused, speed: speed ?? c.speed }))
        const c = yield* SubscriptionRef.get(s.control)
        return yield* Ref.updateAndGet(s.playback, (p): Playback => (p.state === "ended" ? p : { ...p, state: c.paused ? "paused" : "playing", speed: c.speed }))
      })

    return { library, start, get, watch, control, stop, count: () => sessions.size } as const
  })

export type Sessions = Effect.Success<ReturnType<typeof makeSessions>>

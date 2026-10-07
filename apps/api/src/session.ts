/**
 * Sessions on the cue bus (spec §4 "cue bus", §5.7 startMatch / subscribeCues): a session plays one match at a speed
 * and publishes its timeline; every watcher gets the frames, a scoreboard cue and the agent cues for its own segment,
 * all in the same match time (so a split screen shows two segments of one moment together).
 */
import { randomUUID } from "node:crypto"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { Effect, Fiber, PubSub, Ref, Scope, Stream, SubscriptionRef } from "effect"
import { SessionNotFound, type Playback, type Tick } from "@touchline/rpc"
import { segmentKey, type Cue, type Segment } from "@touchline/schema"
import { pickCues } from "./cues.js"
import type { LibraryMatch } from "./library.js"
import { beats, paced, type Beat, type Board, type Control } from "./playback.js"

/** A session nobody watches stops after this long. */
export const IDLE_STOP_S = 30

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
  readonly bus: PubSub.PubSub<Beat>
  readonly playback: Ref.Ref<Playback>
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

/** The sessions of one API process. Their fibers live in `scope`. */
export const makeSessions = (library: ReadonlyMap<string, LibraryMatch>, options: { readonly companion?: Companion } = {}) =>
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

    const start = (match: LibraryMatch, o: StartOptions) =>
      Effect.gen(function* () {
        const id = randomUUID()
        const from = startFrame(match, o.fromMinute)
        const control = yield* SubscriptionRef.make<Control>({ paused: false, speed: o.speed })
        const bus = yield* PubSub.unbounded<Beat>()
        const playback = yield* Ref.make<Playback>({ state: "playing", frame: from, speed: o.speed, live: o.live })
        const watchers = yield* Ref.make(0)
        const segments = yield* Ref.make<ReadonlyMap<string, Segment>>(new Map())
        const s: Session = { id, match, live: o.live, control, bus, playback, watchers, segments }
        // A live session shows the agents' cues as they are written, never the cache's.
        const timeline = beats(o.live ? { ...match, cues: [] } : match, from)
        const play = paced(timeline, control, match.info.fps).pipe(
          Stream.runForEach((b) =>
            Effect.gen(function* () {
              if (b.kind === "frame") yield* Ref.update(playback, (p) => ({ ...p, frame: b.frame.frame }))
              if (b.kind === "end") yield* Ref.update(playback, (p): Playback => ({ ...p, state: "ended", frame: b.frame }))
              yield* PubSub.publish(bus, b)
            })
          ),
          Effect.catch((e) => Effect.logError(`session ${id}: ${String(e)}`)),
          Effect.andThen(Effect.sleep("60 seconds")), // let late requests (evidence, recap) see the ended session
          Effect.ensuring(Effect.sync(() => sessions.delete(id)))
        )
        sessions.set(id, s)
        fibers.set(id, yield* Effect.forkIn(Effect.all([play, ...(o.live && options.companion ? [options.companion(s)] : [])], { concurrency: "unbounded", discard: true }), scope))
        return s
      })

    const get = (id: string) => Effect.fromNullishOr(sessions.get(id)).pipe(Effect.mapError(() => new SessionNotFound({ session_id: id })))

    const toTicks = (s: Session, segment: Segment) => (b: Beat): Tick[] => {
      switch (b.kind) {
        case "frame":
          return [{ kind: "frame", frame: b.frame }]
        case "board":
          return [{ kind: "cue", cue: boardCue(s.match.info.match_id, b.board, segment) }]
        case "cues":
          return pickCues(b.cues, segment).map((cue) => ({ kind: "cue" as const, cue }))
        case "signals":
          return []
        case "end":
          return [{ kind: "playback", playback: { state: "ended", frame: b.frame, speed: 0, live: s.live } }]
      }
    }

    /** The session's ticks for one segment, from now until the match ends; the session stops when nobody watches. */
    const watch = (id: string, segment: Segment) =>
      Stream.unwrap(
        Effect.gen(function* () {
          const s = yield* get(id)
          const now = yield* Ref.get(s.playback)
          yield* Ref.update(s.watchers, (n) => n + 1)
          yield* Ref.update(s.segments, (m) => new Map([...m, [segmentKey(segment), segment]]))
          const leave = Ref.updateAndGet(s.watchers, (n) => n - 1).pipe(
            Effect.flatMap((n) =>
              n > 0 ? Effect.void : Effect.forkIn(Effect.sleep(`${IDLE_STOP_S} seconds`).pipe(Effect.andThen(Ref.get(s.watchers)), Effect.flatMap((m) => (m === 0 ? stop(id) : Effect.void))), scope)
            ),
            Effect.asVoid
          )
          return Stream.make({ kind: "playback", playback: now } as Tick).pipe(
            Stream.concat(Stream.fromPubSub(s.bus).pipe(Stream.takeUntil((b) => b.kind === "end"), Stream.map(toTicks(s, segment)), Stream.flattenIterable)),
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

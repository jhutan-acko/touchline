/**
 * The studio console (spec §5.6): every moment that reaches a session's bus joins its queue, pending. A producer
 * approves it (it joins the presenter's talking points), holds it, or sends it to graphics (it airs on the broadcast
 * output). Talking points are the analyst text in the producer's language plus the facts its claims were checked
 * against: no model writes them, so every number in them is already verified.
 */
import { Effect, PubSub, Ref } from "effect"
import { NotQueued, type QueueItem, type QueueStatus, type StudioAction, type StudioTick } from "@touchline/rpc"
import type { Segment } from "@touchline/schema"
import { pickCues } from "./cues.js"
import type { makeEvidence } from "./evidence.js"
import type { BusBeat, QueueEntry, Session, Sessions } from "./session.js"

/** The analyst text as talking points (one per sentence), then the checked facts. */
export const talkingPoints = (text: { readonly headline: string; readonly body: string } | null, facts: ReadonlyArray<string>): string[] => [
  ...(text ? [text.headline, ...text.body.split(/(?<=[.!?।])\s+/).filter((x) => x.trim())] : []),
  ...facts
]

/** The text cues a segment sees: a pitch marker (an overlay with no text) is never the cue a presenter reads. */
const textCues = (cues: QueueEntry["cues"], segment: Segment) => pickCues(cues, segment).filter((c) => c.display.slot !== "pitch_marker")

/** A queue entry as one producer's segment sees it: the variant that would air, and the talking points in its language. */
export const queueItem = (e: QueueEntry, segment: Segment): QueueItem => {
  const analyst = textCues(e.cues, { ...segment, mode: "analyst" })[0]
  return {
    moment_id: e.moment_id,
    frame: e.frame,
    clock: e.clock,
    status: e.status,
    cue: textCues(e.cues, segment)[0] ?? null,
    points: talkingPoints(analyst?.text ?? null, e.facts),
    variants: e.cues.filter((c) => c.display.slot !== "pitch_marker").length
  }
}

const next = (status: QueueStatus, action: StudioAction): QueueStatus => (action === "approve" ? "approved" : action === "hold" ? "held" : "on_air")

export const makeStudio = (ev: ReturnType<typeof makeEvidence>) => {
  /** The facts behind a moment, as the session saw them when it reached the moment (none if it has no evidence). */
  const facts = (s: Session, e: QueueEntry) =>
    ev.evidence(s.match.info.match_id, (e.cues.find((c) => c.display.slot !== "pitch_marker") ?? e.cues[0]!).cue_id, { frame: e.frame, live: s.live ? s.agents : null }).pipe(
      Effect.map((x) => [
        ...(x.cause ? [`Cause: ${x.cause}`] : []),
        ...x.claims.filter((c) => c.kind === "metric").map((c) => `${c.label}${c.subject_name ? ` (${c.subject_name})` : ""}: ${c.quote || c.value}`)
      ]),
      Effect.orElseSucceed((): string[] => [])
    )

  const put = (s: Session, e: QueueEntry) =>
    Ref.update(s.queue, (q) => new Map([...q, [e.moment_id, e]])).pipe(Effect.andThen(PubSub.publish(s.bus, { kind: "queue", entry: e })))

  /** Queue every moment that reaches the bus (a moment that arrives in parts is merged), then add its facts. */
  const record = (s: Session, sub: PubSub.Subscription<BusBeat>) =>
    Effect.gen(function* () {
      while (true) {
        const b = yield* PubSub.take(sub)
        if (b.kind !== "cues" || b.cues.length === 0 || b.cues[0]!.moment_id === null) continue
        const first = b.cues[0]!
        const id = first.moment_id!
        const had = (yield* Ref.get(s.queue)).get(id)
        const entry: QueueEntry = had
          ? { ...had, cues: [...had.cues, ...b.cues] }
          : { moment_id: id, frame: first.anchor.frame_to, clock: first.anchor.clock, status: "pending", cues: b.cues, facts: [] }
        yield* put(s, entry)
        if (!had) {
          yield* Effect.forkChild(
            Effect.gen(function* () {
              const found = yield* facts(s, entry)
              const now = (yield* Ref.get(s.queue)).get(id)!
              yield* put(s, { ...now, facts: found })
            })
          )
        }
      }
    })

  /** A producer's decision on a queued moment; sending puts its cues on air for every graphics output. */
  const act = (s: Session, momentId: string, action: StudioAction) =>
    Effect.gen(function* () {
      const e = (yield* Ref.get(s.queue)).get(momentId)
      if (!e) return yield* new NotQueued({ moment_id: momentId })
      const status = next(e.status, action)
      yield* put(s, { ...e, status })
      if (action === "send") yield* PubSub.publish(s.bus, { kind: "air", frame: (yield* Ref.get(s.playback)).frame, cues: e.cues })
      return { moment_id: momentId, status }
    })

  /** The studio console's stream: playback and the queue so far, then each queue change, every agent cue as it arrives (raw feed) and the end. */
  const watch = (sessions: Sessions, id: string, segment: Segment) =>
    sessions.follow(
      id,
      segment,
      (s, now) =>
        Effect.map(Ref.get(s.queue), (q): StudioTick[] => [
          { kind: "playback", playback: now },
          ...[...q.values()].sort((a, b) => a.frame - b.frame).map((e) => ({ kind: "queue" as const, item: queueItem(e, segment) }))
        ]),
      (s) => (b): StudioTick[] => {
        switch (b.kind) {
          case "queue":
            return [{ kind: "queue", item: queueItem(b.entry, segment) }]
          case "cues":
            return b.cues.map((cue) => ({ kind: "cue" as const, cue }))
          case "end":
            return [{ kind: "playback", playback: { state: "ended", frame: b.frame, speed: 0, live: s.live } }]
          default:
            return []
        }
      }
    )

  return { record, act, watch } as const
}

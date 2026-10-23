/**
 * Pause-and-ask orchestration: a viewer's question about the frame they paused at. The frame summary comes from the
 * match's warm Ask worker (askpool.ts); a suggested chip brings its intent, a typed question goes to the question
 * agent; a what-if is played out once, here, over paired seeds (the single source of its numbers); then the answer
 * team streams its stages and reply. Answers for the demo moments are replayed from the run's ask cache. Ask has its
 * own stats server per session, started in the background on the session's first suggestions (so the first answer
 * does not wait for it; on the first question at the latest) and stopped when the session goes: never the live
 * companion's, and never the live budget.
 */
import { randomUUID } from "node:crypto"
import { Data, Effect, Queue, Ref, Stream } from "effect"
import { askAnswer, askIntent, startMcpStats, AgentUnavailable, type AskError, type McpServer, type Sender } from "@touchline/agent-gateway"
import { AskNotAvailable, type AskClip, type AskUpdate } from "@touchline/rpc"
import type { AskIntent, AskInterventionSpec, AskReply, AskStage, FrameSummary, Lang as LangSchema, Segment } from "@touchline/schema"
import { ASK_SEEDS, askWhatIfOf, forkFrameOf } from "./askclip.js"
import { makeAskWorkers, type AskWorkers } from "./askpool.js"
import type { Session } from "./session.js"
import { suggestChips, type Chip } from "./suggest.js"
import { WHATIF_TIMEOUT_MS, type askClipInWorker, type summaryInWorker } from "./whatif.js"

type Lang = typeof LangSchema.Type

/** The question agent must classify a typed question within this long. */
export const ASK_INTENT_TIMEOUT_MS = 5_000
/** The answer team must deliver its reply within this long. */
export const ASK_ANSWER_TIMEOUT_MS = 15_000
/** A cached answer replays its stages this far apart, so the team stays visible. */
export const ASK_REPLAY_MS = 350
/** What-if clips a session keeps for "Show me", at most (the oldest dropped). */
export const ASK_CLIPS_PER_SESSION = 16

/** The Ask payload without the session. */
export interface AskPayload {
  readonly frame: number
  readonly question: string
  readonly chip_id: string | null
  readonly segment: Segment
}

export interface AskOptions {
  /** The agent service (`a2aSender`), or OFFLINE_SENDER without one. */
  readonly send: Sender
  /** Starts a session's Ask stats server (default startMcpStats). */
  readonly mcp?: (dir: string) => Promise<McpServer>
  /** The frame summary (default: the match's warm Ask worker). */
  readonly summary?: typeof summaryInWorker
  /** The what-if clip (default: the match's warm Ask worker). */
  readonly askClip?: typeof askClipInWorker
  /** The time limit of a job on a warm worker (default WHATIF_TIMEOUT_MS; a cold one gets ASK_WORKER_TIMEOUT_MS). */
  readonly timeoutMs?: number
  /** The warm workers (default: a pool of its own). */
  readonly workers?: AskWorkers
}

/** The sender when no agent service is configured: a question that needs the agents fails `offline` at once. */
export const OFFLINE_SENDER: Sender = async function* () {
  throw new Error("no agent service is configured")
}

/** A worker job (summary or clip) that failed or ran out of time. */
class AskJobFailed extends Data.TaggedError("AskJobFailed")<{ readonly reason: string; readonly timedOut: boolean }> {}

const STATUS: Readonly<Record<Lang, { readonly chip: string; readonly typed: string; readonly whatif: (alt: string) => string; readonly passTo: (r: string) => string; readonly moved: (p: string) => string }>> = {
  en: { chip: "Question understood", typed: "Reading your question", whatif: (alt) => `Replaying it ${ASK_SEEDS} times ${alt}`, passTo: (r) => `with a pass to ${r}`, moved: (p) => `with ${p} somewhere else` },
  es: { chip: "Pregunta entendida", typed: "Leyendo tu pregunta", whatif: (alt) => `Repitiendo la jugada ${ASK_SEEDS} veces ${alt}`, passTo: (r) => `con un pase a ${r}`, moved: (p) => `con ${p} en otro sitio` },
  hi: { chip: "सवाल समझ लिया", typed: "आपका सवाल पढ़ रहे हैं", whatif: (alt) => `इसे ${ASK_SEEDS} बार दोहरा रहे हैं, ${alt}`, passTo: (r) => `${r} को पास के साथ`, moved: (p) => `${p} को दूसरी जगह रखकर` }
}

const stage = (name: AskStage["stage"], status: string): AskUpdate => ({ kind: "stage", stage: { stage: name, status } })

/** The what-if stage's status, naming the alternative. */
const whatIfStatus = (summary: FrameSummary, iv: AskInterventionSpec, lang: Lang): string => {
  const name = (id: string) => summary.players.find((p) => p.id === id)?.name ?? id
  const t = STATUS[lang]
  return t.whatif(iv.kind === "pass_to" ? t.passTo(name(iv.receiver_id)) : t.moved(name(iv.player_id)))
}

/** What one session holds for Ask: its stats server (started on the first question) and the clips it was shown. */
interface AskSession {
  mcp: Promise<McpServer> | null
  /** The stats server once it is up. */
  server: McpServer | null
  readonly clips: Map<string, AskClip>
  closed: boolean
}

/** Summaries kept per match, at most. */
const SUMMARIES_PER_MATCH = 64

export const makeAsk = (o: AskOptions) => {
  const workers = o.workers ?? makeAskWorkers()
  const timeoutMs = o.timeoutMs ?? WHATIF_TIMEOUT_MS
  const summaryJob = o.summary ?? workers.summary
  const clipJob = o.askClip ?? workers.askClip
  const startMcp = o.mcp ?? ((dir: string) => startMcpStats(dir))
  const sessions = new Map<string, AskSession>()
  const summaries = new Map<string, Map<number, Promise<FrameSummary>>>()

  const stateOf = (s: Session): AskSession => {
    let st = sessions.get(s.id)
    if (!st) {
      sessions.set(s.id, (st = { mcp: null, server: null, clips: new Map(), closed: false }))
      workers.retain(s.match.dir, s.id)
    }
    return st
  }

  const job = <A>(run: () => Promise<A>) =>
    Effect.tryPromise({
      try: run,
      catch: (e) => {
        const reason = e instanceof Error ? e.message : String(e)
        return new AskJobFailed({ reason, timedOut: /timed out/.test(reason) })
      }
    })

  /** The frame summary, worked out once per match and frame (a failed one is tried again next time). */
  const summaryOf = (s: Session, frame: number) =>
    job(() => {
      let byFrame = summaries.get(s.match.dir)
      if (!byFrame) summaries.set(s.match.dir, (byFrame = new Map()))
      let p = byFrame.get(frame)
      if (!p) {
        const m = byFrame
        p = summaryJob(s.match.dir, frame, timeoutMs).catch((e: unknown) => {
          m.delete(frame)
          throw e
        })
        byFrame.set(frame, p)
        if (byFrame.size > SUMMARIES_PER_MATCH) byFrame.delete(byFrame.keys().next().value!)
      }
      return p
    })

  const chipsOf = (s: Session, summary: FrameSummary, lang: Lang): Chip[] =>
    suggestChips(summary, lang, { home: s.match.info.home.name, away: s.match.info.away.name })

  /** The session's Ask stats server, started once (again after a failed start). */
  const serverOf = (st: AskSession, dir: string): Promise<McpServer> =>
    (st.mcp ??= startMcp(dir).then(
      (m) => {
        if (st.closed) {
          m.stop()
          throw new Error("the session has closed")
        }
        st.server = m
        return m
      },
      (e: unknown) => {
        st.mcp = null
        throw e
      }
    ))

  const mcpOf = (st: AskSession, dir: string) =>
    Effect.tryPromise({
      try: () => serverOf(st, dir),
      catch: (e) => new AgentUnavailable({ reason: `the stats server did not start: ${e instanceof Error ? e.message : String(e)}` })
    })

  const keepClip = (st: AskSession, clip: AskClip) => {
    st.clips.delete(clip.clip_id)
    st.clips.set(clip.clip_id, clip)
    if (st.clips.size > ASK_CLIPS_PER_SESSION) st.clips.delete(st.clips.keys().next().value!)
  }

  /** Suggested questions for a frame the session has reached (summary memoised; the states a question needs are fetched with it). */
  const suggest = (s: Session, frame: number, lang: Lang): Effect.Effect<Chip[], AskNotAvailable> =>
    Effect.gen(function* () {
      const now = (yield* Ref.get(s.playback)).frame
      if (frame > now) return yield* new AskNotAvailable({ reason: `frame ${frame} is past the session's frame ${now}` })
      const st = stateOf(s)
      // The viewer has opened Ask: start the session's stats server meanwhile, so the first answer does not wait for it.
      if (o.send !== OFFLINE_SENDER) serverOf(st, s.match.dir).catch(() => {})
      const summary = yield* summaryOf(s, frame).pipe(Effect.mapError((e) => new AskNotAvailable({ reason: e.reason })))
      return chipsOf(s, summary, lang)
    })

  const flow = (s: Session, req: AskPayload, emit: (u: AskUpdate) => Effect.Effect<unknown>) =>
    Effect.gen(function* () {
      const now = (yield* Ref.get(s.playback)).frame
      if (req.frame > now) return yield* emit({ kind: "failed", reason: "bad_frame", message: `frame ${req.frame} is past the session's frame ${now}` })
      const st = stateOf(s)
      const cached = req.chip_id === null ? undefined : s.match.askCache.get(`${req.frame}:${req.chip_id}`)
      if (cached) {
        if (cached.clip) keepClip(st, cached.clip)
        for (const x of cached.stages) {
          yield* emit({ kind: "stage", stage: x })
          yield* Effect.sleep(`${ASK_REPLAY_MS} millis`)
        }
        return yield* emit({ kind: "answer", answer: { ...cached.answer, cached: true } })
      }
      if (o.send === OFFLINE_SENDER) return yield* emit({ kind: "failed", reason: "offline", message: "no agent service is configured" })
      const lang = req.segment.lang
      // The panel shows the question stage at once, even while a cold worker replays the match for the summary.
      yield* emit(stage("question", req.chip_id !== null ? STATUS[lang].chip : STATUS[lang].typed))
      const summary = yield* summaryOf(s, req.frame)
      const chip = req.chip_id === null ? undefined : chipsOf(s, summary, lang).find((c) => c.chip_id === req.chip_id)
      const intent: AskIntent = chip ? chip.intent : yield* askIntent(o.send, { kind: "ask_intent", question: req.question, lang, summary }, ASK_INTENT_TIMEOUT_MS)
      let clip: AskClip | null = null
      if (intent.kind === "what_if" && intent.intervention) {
        const intervention = intent.intervention
        yield* emit(stage("whatif", whatIfStatus(summary, intervention, lang)))
        clip = yield* job(() => clipJob(s.match.dir, { forkFrame: forkFrameOf(summary, intent), pausedFrame: req.frame, intervention }, timeoutMs))
        keepClip(st, clip)
      }
      const mcp = yield* mcpOf(st, s.match.dir)
      let reply: AskReply | null = null
      yield* Stream.runForEach(
        askAnswer(o.send, {
          kind: "ask_answer", match_id: s.match.info.match_id, mcp_url: mcp.url, at_frame: req.frame, question: req.question, segment: req.segment, intent, summary,
          what_if: clip ? askWhatIfOf(clip) : null
        }, ASK_ANSWER_TIMEOUT_MS),
        (item) => (item.kind === "stage" ? emit({ kind: "stage", stage: item.stage }) : Effect.sync(() => void (reply = item.reply)))
      )
      if (reply === null) return yield* emit({ kind: "failed", reason: "offline", message: "the analysts sent no answer" })
      yield* emit({ kind: "answer", answer: { ...(reply as AskReply), ask_id: randomUUID(), frame: req.frame, clip_id: clip?.clip_id ?? null, verdict: clip?.verdict ?? null, cached: false } })
    })

  /** How a failed ask ends its stream. */
  const failed = (e: AskError | AskJobFailed): AskUpdate => {
    switch (e._tag) {
      case "TimeoutError":
        return { kind: "failed", reason: "timeout", message: "the analysts took too long" }
      case "AskJobFailed":
        return { kind: "failed", reason: e.timedOut ? "timeout" : "offline", message: e.reason }
      case "AgentUnavailable":
      case "AgentFailed":
      case "InvalidArtifact":
        return { kind: "failed", reason: "offline", message: e.reason }
    }
  }

  /** Ask about a frame: stage updates, then the answer; or a `failed` update. Stopping the stream stops the ask. */
  const ask = (s: Session, req: AskPayload): Stream.Stream<AskUpdate> =>
    Stream.callback<AskUpdate>((queue) =>
      flow(s, req, (u) => Queue.offer(queue, u)).pipe(
        Effect.catch((e) => Queue.offer(queue, failed(e))),
        Effect.ensuring(Queue.end(queue))
      )
    )

  /** A clip this session was shown (or one of the run's cached answers). */
  const clip = (s: Session, clipId: string): Effect.Effect<AskClip, AskNotAvailable> => {
    const got = sessions.get(s.id)?.clips.get(clipId) ?? [...s.match.askCache.values()].find((x) => x.clip?.clip_id === clipId)?.clip
    return got ? Effect.succeed(got) : Effect.fail(new AskNotAvailable({ reason: `no clip "${clipId}" in this session` }))
  }

  /** Release what a session held: its stats server, its clips and its hold on the match's worker. */
  const close = (s: Session): Effect.Effect<void> =>
    Effect.sync(() => {
      const st = sessions.get(s.id)
      if (!st) return
      sessions.delete(s.id)
      st.closed = true
      st.server?.stop() // one still starting stops as soon as it is up
      workers.release(s.match.dir, s.id)
    })

  return { suggest, ask, clip, close, workers } as const
}

export type Ask = ReturnType<typeof makeAsk>

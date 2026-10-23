/**
 * The app's view of the API: plain promises and callbacks, so components and their tests never touch Effect.
 * `connect` implements it with the Effect RPC client over one WebSocket (the browser's own).
 */
import { BrowserSocket } from "@effect/platform-browser"
import { Effect, Exit, Layer, ManagedRuntime, Scope, Stream } from "effect"
import { RpcClient, RpcSerialization } from "effect/rpc"
import { TouchlineRpcs, type AskClip, type AskUpdate, type Evidence, type MatchInfo, type MatchSummary, type OpsReport, type Playback, type QuestionChip as QuestionChipSchema, type QueueStatus, type RecapView, type StudioAction, type StudioTick, type Tick, type WhatIfClip } from "@touchline/rpc"
import type { Decision, Segment } from "@touchline/schema"
import type { Lang } from "./i18n.js"

/** A suggested question (the contracts export only its schema). */
export type QuestionChip = typeof QuestionChipSchema.Type

export interface StartOptions {
  readonly speed: number
  readonly fromMinute: number
  readonly live: boolean
}

export interface TouchlineClient {
  listMatches(): Promise<ReadonlyArray<MatchSummary>>
  startSession(matchId: string, o: StartOptions): Promise<{ readonly session_id: string; readonly match: MatchInfo }>
  /** Calls `onTick` for each tick of the session for `segment`; returns a function that stops watching. */
  watch(sessionId: string, segment: Segment, onTick: (t: Tick) => void, onEnd?: (error: string | null) => void): () => void
  control(sessionId: string, action: "play" | "pause" | "speed", speed?: number): Promise<Playback>
  /** What is behind a cue the session has shown. */
  evidence(sessionId: string, cueId: string): Promise<Evidence>
  /** A pass as it went and with its better option played (the what-if split). */
  whatIf(sessionId: string, eventId: string): Promise<WhatIfClip>
  /** A recap, once the session has reached its whistle (empty before). */
  recap(sessionId: string, kind: "half_time" | "full_time", segment: Segment): Promise<RecapView>
  /** The studio console's stream for a producer segment; returns a function that stops it. */
  studio(sessionId: string, segment: Segment, onTick: (t: StudioTick) => void, onEnd?: (error: string | null) => void): () => void
  /** A producer's decision on a queued moment. */
  act(sessionId: string, momentId: string, action: StudioAction): Promise<{ readonly moment_id: string; readonly status: QueueStatus }>
  /** The broadcast graphics output for a segment: scoreboard and the cues sent to air. */
  graphics(sessionId: string, segment: Segment, onTick: (t: Tick) => void, onEnd?: (error: string | null) => void): () => void
  /** The session's ops numbers, as of its frame. */
  ops(sessionId: string): Promise<OpsReport>
  /** A managed match's manager decisions the session has reached. */
  decisions(sessionId: string): Promise<ReadonlyArray<Decision>>
  /** Suggested questions for a paused frame, in the viewer's language. */
  suggest(sessionId: string, frame: number, lang: Lang): Promise<ReadonlyArray<QuestionChip>>
  /** Ask about a paused frame: calls `onUpdate` for each stage and the answer, `onEnd` once it stops; returns a function that stops it. */
  ask(sessionId: string, req: { frame: number; question: string; chip_id: string | null; segment: Segment }, onUpdate: (u: AskUpdate) => void, onEnd: () => void): () => void
  /** The what-if clip behind an answer's Show me. */
  askClip(sessionId: string, clipId: string): Promise<AskClip>
  close(): Promise<void>
}

/** The RPC URL for the page's own origin (the dev server forwards /rpc to the API). */
export const defaultUrl = (loc: Location = window.location): string => `${loc.protocol === "https:" ? "wss" : "ws"}://${loc.host}/rpc`

export const connect = async (url: string): Promise<TouchlineClient> => {
  const runtime = ManagedRuntime.make(
    RpcClient.layerProtocolSocket({ retryTransientErrors: true }).pipe(Layer.provide(BrowserSocket.layerWebSocket(url)), Layer.provide(RpcSerialization.layerJson))
  )
  const scope = await runtime.runPromise(Scope.make())
  const client = await runtime.runPromise(RpcClient.make(TouchlineRpcs).pipe(Scope.provide(scope)))
  const call = <A>(e: Effect.Effect<A, unknown>) => runtime.runPromise(e)
  /** Run a stream, calling `onTick` for each element and `onEnd` once it stops (null: it ended normally). */
  const follow = <A>(stream: Stream.Stream<A, unknown>, onTick: (a: A) => void, onEnd?: (error: string | null) => void) => {
    const fiber = runtime.runFork(
      Stream.runForEach(stream, (a) => Effect.sync(() => onTick(a))).pipe(Effect.matchCause({ onSuccess: () => onEnd?.(null), onFailure: (c) => onEnd?.(String(c)) }))
    )
    return () => fiber.interruptUnsafe()
  }
  return {
    listMatches: () => call(client.ListMatches()),
    startSession: (match_id, o) => call(client.StartSession({ match_id, speed: o.speed, from_minute: o.fromMinute, live: o.live })),
    watch: (session_id, segment, onTick, onEnd) => follow(client.Watch({ session_id, segment }), onTick, onEnd),
    control: (session_id, action, speed) => call(client.Control({ session_id, action, speed: speed ?? null })),
    evidence: (session_id, cue_id) => call(client.GetEvidence({ session_id, cue_id })),
    whatIf: (session_id, event_id) => call(client.GetWhatIf({ session_id, event_id })),
    recap: (session_id, kind, segment) => call(client.GetRecap({ session_id, kind, segment })),
    studio: (session_id, segment, onTick, onEnd) => follow(client.StudioWatch({ session_id, segment }), onTick, onEnd),
    act: (session_id, moment_id, action) => call(client.StudioAct({ session_id, moment_id, action })),
    graphics: (session_id, segment, onTick, onEnd) => follow(client.WatchGraphics({ session_id, segment }), onTick, onEnd),
    ops: (session_id) => call(client.GetOps({ session_id })),
    decisions: (session_id) => call(client.GetDecisions({ session_id })),
    suggest: (session_id, frame, lang) => call(client.SuggestQuestions({ session_id, frame, lang })),
    ask: (session_id, req, onUpdate, onEnd) => follow(client.Ask({ session_id, ...req }), onUpdate, () => onEnd()),
    askClip: (session_id, clip_id) => call(client.GetAskClip({ session_id, clip_id })),
    close: async () => {
      await runtime.runPromise(Scope.close(scope, Exit.void))
      await runtime.dispose()
    }
  }
}

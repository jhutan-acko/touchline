/**
 * The app's view of the API: plain promises and callbacks, so components and their tests never touch Effect.
 * `connect` implements it with the Effect RPC client over one WebSocket (the browser's own).
 */
import { BrowserSocket } from "@effect/platform-browser"
import { Effect, Exit, Layer, ManagedRuntime, Scope, Stream } from "effect"
import { RpcClient, RpcSerialization } from "effect/rpc"
import { TouchlineRpcs, type Evidence, type MatchInfo, type MatchSummary, type Playback, type RecapView, type Tick } from "@touchline/rpc"
import type { Segment } from "@touchline/schema"

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
  evidence(matchId: string, cueId: string): Promise<Evidence>
  recap(matchId: string, kind: "half_time" | "full_time", segment: Segment): Promise<RecapView>
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
  return {
    listMatches: () => call(client.ListMatches()),
    startSession: (match_id, o) => call(client.StartSession({ match_id, speed: o.speed, from_minute: o.fromMinute, live: o.live })),
    watch: (session_id, segment, onTick, onEnd) => {
      const fiber = runtime.runFork(
        Stream.runForEach(client.Watch({ session_id, segment }), (t) => Effect.sync(() => onTick(t))).pipe(
          Effect.matchCause({ onSuccess: () => onEnd?.(null), onFailure: (c) => onEnd?.(String(c)) })
        )
      )
      return () => fiber.interruptUnsafe()
    },
    control: (session_id, action, speed) => call(client.Control({ session_id, action, speed: speed ?? null })),
    evidence: (match_id, cue_id) => call(client.GetEvidence({ match_id, cue_id })),
    recap: (match_id, kind, segment) => call(client.GetRecap({ match_id, kind, segment })),
    close: async () => {
      await runtime.runPromise(Scope.close(scope, Exit.void))
      await runtime.dispose()
    }
  }
}

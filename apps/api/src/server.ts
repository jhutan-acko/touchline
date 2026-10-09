/**
 * The API (spec §5.7): the RPC group over WebSocket at /rpc (one connection carries every call and stream), plus
 * GET /health. Handlers read the match library, run sessions on the cue bus and answer evidence and recaps.
 */
import { createServer } from "node:http"
import { NodeHttpServer } from "@effect/platform-node"
import { Effect, Layer, Ref } from "effect"
import { HttpRouter, HttpServerResponse } from "effect/http"
import { RpcSerialization, RpcServer } from "effect/rpc"
import { MatchNotFound, TouchlineRpcs, type MatchSummary } from "@touchline/rpc"
import { makeEvidence } from "./evidence.js"
import type { LibraryMatch } from "./library.js"
import { makeOps } from "./ops.js"
import { makeSessions, type Companion } from "./session.js"
import { makeStudio } from "./studio.js"
import { makeWhatIf, type WhatIfOptions } from "./whatif.js"

export const RPC_PATH = "/rpc"

export interface ApiOptions {
  readonly library: ReadonlyMap<string, LibraryMatch>
  /** Runs alongside live sessions (the live agents, Task 7). */
  readonly companion?: Companion
  /** How what-if clips are computed on request (tests). */
  readonly whatIf?: WhatIfOptions
}

const summary = ({ players: _, ...s }: LibraryMatch["info"]): MatchSummary => s

/** The RPC handlers over a library. */
export const handlersLayer = (o: ApiOptions) =>
  Layer.unwrap(
    Effect.gen(function* () {
      const whatIf = makeWhatIf(o.library, o.whatIf)
      const ev = makeEvidence(o.library, whatIf)
      const studio = makeStudio(ev)
      const ops = makeOps()
      const sessions = yield* makeSessions(o.library, { ...(o.companion ? { companion: o.companion } : {}), studio: studio.record })
      const match = (id: string) => Effect.fromNullishOr(o.library.get(id)).pipe(Effect.mapError(() => new MatchNotFound({ match_id: id })))
      /** A session and what it has reached: answers never go past its frame. */
      const view = (id: string) =>
        sessions.get(id).pipe(Effect.flatMap((s) => Effect.map(Ref.get(s.playback), (p) => ({ s, v: { frame: p.frame, live: s.live ? s.agents : null } }))))
      return TouchlineRpcs.toLayer({
        ListMatches: () => Effect.succeed([...o.library.values()].map((m) => summary(m.info))),
        GetMatch: ({ match_id }) => match(match_id).pipe(Effect.map((m) => m.info)),
        StartSession: ({ match_id, speed, from_minute, live }) =>
          match(match_id).pipe(
            Effect.flatMap((m) => sessions.start(m, { speed, fromMinute: from_minute, live })),
            Effect.map((s) => ({ session_id: s.id, match: s.match.info }))
          ),
        Watch: ({ session_id, segment }) => sessions.watch(session_id, segment),
        Control: ({ session_id, action, speed }) => sessions.control(session_id, action, speed),
        GetEvidence: ({ session_id, cue_id }) => view(session_id).pipe(Effect.flatMap(({ s, v }) => ev.evidence(s.match.info.match_id, cue_id, v))),
        GetWhatIf: ({ session_id, event_id }) => view(session_id).pipe(Effect.flatMap(({ s, v }) => whatIf.clip(s.match.info.match_id, event_id, v.frame))),
        GetRecap: ({ session_id, kind, segment }) => view(session_id).pipe(Effect.flatMap(({ s, v }) => ev.recap(s.match.info.match_id, kind, segment, v))),
        StudioWatch: ({ session_id, segment }) => studio.watch(sessions, session_id, segment),
        StudioAct: ({ session_id, moment_id, action }) => sessions.get(session_id).pipe(Effect.flatMap((s) => studio.act(s, moment_id, action))),
        WatchGraphics: ({ session_id, segment }) => sessions.graphics(session_id, segment),
        GetOps: ({ session_id }) => sessions.get(session_id).pipe(Effect.flatMap((s) => Effect.map(Ref.get(s.playback), (p) => ops.report(s, p.frame))))
      })
    })
  )

/** The routes: RPC over WebSocket and a health check (for container probes, Plan 6). */
export const routesLayer = (o: ApiOptions) =>
  Layer.mergeAll(
    RpcServer.layerHttp({ group: TouchlineRpcs, path: RPC_PATH, protocol: "websocket" }).pipe(Layer.provide(handlersLayer(o)), Layer.provide(RpcSerialization.layerJson)),
    HttpRouter.add("GET", "/health", HttpServerResponse.json({ ok: true, matches: o.library.size }))
  )

/** The API served on a port (0: any free port). */
export const serverLayer = (o: ApiOptions & { readonly port: number; readonly host?: string }) =>
  HttpRouter.serve(routesLayer(o)).pipe(Layer.provide(NodeHttpServer.layer(createServer, { port: o.port, host: o.host ?? "127.0.0.1" })))

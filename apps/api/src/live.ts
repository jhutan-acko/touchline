/**
 * Live agents for a session (the live toggle, spec §6): as the match plays, the stats engine's signals go to the agent
 * service in batches of `batchS` seconds of match time, for the segments being watched, and recaps are asked for at
 * the whistles; the cues come back onto the session's bus as they arrive. A batch that would queue behind a slow one
 * is merged into the next, so slow models fall behind by at most one batch, never more.
 */
import { Effect, PubSub, Queue, Ref } from "effect"
import { a2aSender, exchange, received, startMcpStats, type McpServer, type Sender } from "@touchline/agent-gateway"
import type { AgentRequest, Cue, Segment, Signal } from "@touchline/schema"
import type { Beat } from "./playback.js"
import type { Companion, Session } from "./session.js"

export interface LiveOptions {
  readonly agentsUrl: string
  /** Wall-clock milliseconds a request may take (0: no limit). */
  readonly budgetMs: number
  readonly batchS?: number
  /** For tests: the A2A sender and the MCP stats server launcher. */
  readonly send?: Sender
  readonly mcp?: (dir: string) => Promise<McpServer>
}

const DEFAULT_SEGMENT: Segment = { mode: "casual", lang: "en", club: null }

type Job =
  | { readonly kind: "signals"; readonly signals: Signal[]; readonly frame: number }
  | { readonly kind: "recap"; readonly recap: "half_time" | "full_time"; readonly frame: number }
  | { readonly kind: "stop" }

/** Merge waiting signal batches into one (a recap stays its own request, after the signals before it). */
export const coalesce = (jobs: ReadonlyArray<Job>): Job[] => {
  // Signals batches next to each other become one; a recap or the stop keeps its place.
  const out: Job[] = []
  for (const j of jobs) {
    const prev = out.at(-1)
    if (j.kind === "signals" && prev?.kind === "signals") out[out.length - 1] = { kind: "signals", signals: [...prev.signals, ...j.signals], frame: j.frame }
    else out.push(j)
  }
  return out
}

export const liveAgents = (o: LiveOptions): Companion => (s: Session) =>
  Effect.gen(function* () {
    // Subscribe first: play runs while the stats server starts (a few seconds), and no signal may be missed.
    const sub = yield* PubSub.subscribe(s.bus)
    const send = o.send ?? a2aSender(o.agentsUrl)
    const mcp = yield* Effect.acquireRelease(Effect.promise(() => (o.mcp ?? startMcpStats)(s.match.dir)), (m) => Effect.sync(() => m.stop()))
    const width = Math.round((o.batchS ?? 15) * s.match.info.fps)
    const jobs = yield* Queue.unbounded<Job>()

    const segments = Effect.map(Ref.get(s.segments), (m) => (m.size ? [...m.values()].slice(0, 12) : [DEFAULT_SEGMENT]))
    const publish = (frame: number, cues: ReadonlyArray<Cue>) => {
      const by = new Map<string, Cue[]>()
      for (const c of cues) if (c.moment_id) by.set(c.moment_id, [...(by.get(c.moment_id) ?? []), c])
      return Effect.forEach([...by.values()], (group) => PubSub.publish(s.bus, { kind: "cues", frame, cues: group } as Beat), { discard: true })
    }

    // Worker: one request at a time; whatever piled up meanwhile is merged. Stops after the full-time recap.
    const worker = Effect.gen(function* () {
      while (true) {
        for (const job of coalesce(yield* Queue.takeAll(jobs))) {
          if (job.kind === "stop") return
          const base = { match_id: s.match.info.match_id, mcp_url: mcp.url, segments: yield* segments }
          const req: AgentRequest = job.kind === "signals" ? { kind: "signals", ...base, now_frame: job.frame, signals: job.signals } : { kind: "recap", ...base, recap: job.recap, at_frame: job.frame }
          const got = received()
          yield* Effect.exit(exchange(send, req, o.budgetMs, got)) // a failed or late request still publishes what arrived in time
          // Kept for "Why?" and the recap panel: a live session answers from what its agents wrote.
          s.agents.cues.push(...got.cues)
          s.agents.traces.push(...got.traces)
          s.agents.recaps.push(...got.recaps)
          const now = (yield* Ref.get(s.playback)).frame
          yield* publish(now, got.cues)
        }
      }
    })

    // Feeder: cut the signals into batches as play passes each batch's end; recaps at the whistles.
    const feed = Effect.gen(function* () {
      let pending: Signal[] = []
      let end = -1
      let half = false
      let first = true
      let last = 0
      while (true) {
        const b = yield* PubSub.take(sub)
        if (b.kind === "signals") {
          if (end < 0) end = Math.floor(b.frame / width) * width + width
          pending = [...pending, ...b.signals]
        } else if (b.kind === "frame") {
          // A session that starts in the second half has no first half to recap.
          if (first && b.frame.period === "second_half") half = true
          first = false
          if (!half && b.frame.period === "second_half") {
            half = true
            if (pending.length) yield* Queue.offer(jobs, { kind: "signals", signals: pending, frame: last })
            pending = []
            end = -1
            yield* Queue.offer(jobs, { kind: "recap", recap: "half_time", frame: last })
          }
          last = b.frame.frame
          if (end >= 0 && last >= end && pending.length) {
            yield* Queue.offer(jobs, { kind: "signals", signals: pending, frame: last })
            pending = []
            end = -1
          }
        } else if (b.kind === "end") {
          if (pending.length) yield* Queue.offer(jobs, { kind: "signals", signals: pending, frame: b.frame })
          yield* Queue.offer(jobs, { kind: "recap", recap: "full_time", frame: b.frame })
          yield* Queue.offer(jobs, { kind: "stop" })
          return
        }
      }
    })

    yield* Effect.all([worker, feed], { concurrency: "unbounded", discard: true })
  }).pipe(Effect.scoped)

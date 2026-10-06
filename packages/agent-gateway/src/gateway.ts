/**
 * The agent gateway (spec §5.7, §6): sends a match's signals to the agent service in batches and its recaps at the
 * whistles, with a time budget, one retry when the service is unreachable, a circuit breaker, and schema validation
 * of everything that comes back. Late cues (received after their ttl) and unverified cues are dropped.
 */
import { Data, Effect } from "effect"
import { decodeCue, decodeMomentTrace, decodeRecap, type AgentRequest, type Cue, type MomentTrace, type Recap, type Segment, type Signal } from "@touchline/schema"
import { TaskFailed, type Sender } from "./a2a.js"

export class AgentUnavailable extends Data.TaggedError("AgentUnavailable")<{ readonly reason: string }> {}
export class AgentFailed extends Data.TaggedError("AgentFailed")<{ readonly reason: string }> {}
export class InvalidArtifact extends Data.TaggedError("InvalidArtifact")<{ readonly name: string; readonly reason: string }> {}

export interface GatewayOptions {
  readonly segments: ReadonlyArray<Segment>
  /** Seconds of game time per signals batch. */
  readonly batchS: number
  /** Milliseconds a request may take (0: no limit, for recorded runs). */
  readonly budgetMs: number
  /** After `failures` failed requests in a row, skip the next `cooldown` requests. */
  readonly breaker: { readonly failures: number; readonly cooldown: number }
}

export const DEFAULT_OPTIONS: GatewayOptions = {
  segments: [{ mode: "casual", lang: "en", club: null }, { mode: "analyst", lang: "en", club: null }],
  batchS: 15,
  budgetMs: 0,
  breaker: { failures: 3, cooldown: 4 }
}

/** What one match needs: its stats server and its signals, oldest first, and the frames of the two whistles. */
export interface MatchPlan {
  readonly matchId: string
  readonly mcpUrl: string
  readonly fps: number
  readonly signals: ReadonlyArray<Signal>
  readonly whistles: { readonly half_time: number; readonly full_time: number }
}

export type Outcome = "ok" | "failed" | "timeout" | "unavailable" | "invalid" | "skipped"

export interface RequestLog {
  readonly kind: AgentRequest["kind"]
  readonly frame: number
  readonly outcome: Outcome
  readonly ms: number
  readonly cues: number
  readonly late: number
  readonly unverified: number
  readonly reason?: string
}

export interface GatewayResult {
  readonly cues: ReadonlyArray<Cue>
  readonly traces: ReadonlyArray<MomentTrace>
  readonly recaps: ReadonlyArray<Recap>
  readonly requests: ReadonlyArray<RequestLog>
}

/** The requests for a match in order: a signals batch per `batchS` seconds that raised any, and a recap at each whistle. */
export const timeline = (plan: MatchPlan, opts: GatewayOptions): AgentRequest[] => {
  const base = { match_id: plan.matchId, mcp_url: plan.mcpUrl, segments: [...opts.segments] }
  const width = Math.max(1, Math.round(opts.batchS * plan.fps))
  const groups = new Map<number, Signal[]>()
  for (const s of [...plan.signals].sort((a, b) => a.frame_id - b.frame_id)) {
    const k = Math.floor(s.frame_id / width)
    groups.set(k, [...(groups.get(k) ?? []), s])
  }
  const out: Array<{ frame: number; order: number; req: AgentRequest }> = [...groups.values()].map((g) => {
    const frame = g[g.length - 1]!.frame_id
    return { frame, order: 0, req: { kind: "signals" as const, ...base, now_frame: frame, signals: g } }
  })
  for (const recap of ["half_time", "full_time"] as const) {
    const frame = plan.whistles[recap]
    out.push({ frame, order: 1, req: { kind: "recap" as const, ...base, recap, at_frame: frame } })
  }
  return out.sort((a, b) => a.frame - b.frame || a.order - b.order).map((x) => x.req)
}

const frameOf = (req: AgentRequest) => (req.kind === "signals" ? req.now_frame : req.at_frame)

interface Received {
  readonly cues: Cue[]
  readonly traces: MomentTrace[]
  readonly recaps: Recap[]
  late: number
  unverified: number
}

const decode = <A>(name: string, f: (u: unknown) => A, data: unknown): A => {
  try {
    return f(data)
  } catch (e) {
    throw new InvalidArtifact({ name, reason: e instanceof Error ? e.message.split("\n")[0]! : String(e) })
  }
}

/** One request: stream its artifacts, validate each, drop late and unverified cues. */
export const exchange = (send: Sender, req: AgentRequest, budgetMs: number) => {
  const run = Effect.tryPromise({
    try: async (signal) => {
      const t0 = performance.now()
      const got: Received = { cues: [], traces: [], recaps: [], late: 0, unverified: 0 }
      for await (const a of send(req, signal)) {
        if (a.name === "cue") {
          const cue = decode("cue", decodeCue, a.data)
          if (!cue.verified) got.unverified++
          else if (budgetMs > 0 && performance.now() - t0 > cue.display.ttl_ms) got.late++
          else got.cues.push(cue)
        } else if (a.name === "trace") got.traces.push(decode("trace", decodeMomentTrace, a.data))
        else if (a.name === "recap") got.recaps.push(decode("recap", decodeRecap, a.data))
        else throw new InvalidArtifact({ name: a.name, reason: "unknown artifact name" })
      }
      return { ...got, ms: performance.now() - t0 }
    },
    catch: (e) =>
      e instanceof InvalidArtifact ? e : e instanceof TaskFailed ? new AgentFailed({ reason: e.message }) : new AgentUnavailable({ reason: e instanceof Error ? e.message : String(e) })
  })
  return (budgetMs > 0 ? run.pipe(Effect.timeout(`${budgetMs} millis`)) : run).pipe(
    // Only an unreachable service is worth one more try; a failed task or a timeout would fail again or be too late.
    Effect.retry({ times: 1, while: (e) => e._tag === "AgentUnavailable" })
  )
}

/** Run a match's timeline through the agent service. Never fails: every request's outcome is in `requests`. */
export const runGateway = (send: Sender, plan: MatchPlan, opts: GatewayOptions = DEFAULT_OPTIONS) =>
  Effect.gen(function* () {
    const cues: Cue[] = []
    const traces: MomentTrace[] = []
    const recaps: Recap[] = []
    const requests: RequestLog[] = []
    let failures = 0
    let skip = 0
    for (const req of timeline(plan, opts)) {
      const base = { kind: req.kind, frame: frameOf(req) }
      if (skip > 0) {
        skip--
        requests.push({ ...base, outcome: "skipped", ms: 0, cues: 0, late: 0, unverified: 0 })
        continue
      }
      const t0 = performance.now()
      const r = yield* Effect.result(exchange(send, req, opts.budgetMs))
      if (r._tag === "Success") {
        failures = 0
        cues.push(...r.success.cues)
        traces.push(...r.success.traces)
        recaps.push(...r.success.recaps)
        requests.push({ ...base, outcome: "ok", ms: r.success.ms, cues: r.success.cues.length, late: r.success.late, unverified: r.success.unverified })
        continue
      }
      const e = r.failure
      const outcome: Outcome = e._tag === "TimeoutError" ? "timeout" : e._tag === "AgentFailed" ? "failed" : e._tag === "InvalidArtifact" ? "invalid" : "unavailable"
      requests.push({ ...base, outcome, ms: performance.now() - t0, cues: 0, late: 0, unverified: 0, reason: "reason" in e ? e.reason : e.message })
      if (++failures >= opts.breaker.failures) {
        failures = 0
        skip = opts.breaker.cooldown
      }
    }
    return { cues, traces, recaps, requests } satisfies GatewayResult
  })

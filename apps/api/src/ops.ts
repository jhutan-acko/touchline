/**
 * The ops view (spec §5.6): what the agents did for a session (moments, cues, Fact-Checker verdicts, fallbacks, time
 * per agent, requests by outcome) and how fast the hot path and the agents were against the spec's budgets (§2:
 * stats overlay under 250 ms from the event, AI insight under 4 s from the signal, p95). As of the session's frame:
 * a recorded session counts its cache only up to where play has reached; a live one counts what its agents did.
 */
import { existsSync, readFileSync } from "node:fs"
import { join } from "node:path"
import type { RequestLog } from "@touchline/agent-gateway"
import type { Budget, OpsReport, Percentiles } from "@touchline/rpc"
import { decodeMomentTrace, type Cue, type MomentTrace } from "@touchline/schema"
import type { LibraryMatch } from "./library.js"
import type { Session } from "./session.js"

export const STATS_BUDGET_MS = 250
export const INSIGHT_BUDGET_MS = 4000

const r1 = (v: number) => Math.round(v * 10) / 10

/** Nearest-rank percentiles, rounded to 0.1 ms. */
export const percentiles = (xs: ReadonlyArray<number>): Percentiles => {
  if (xs.length === 0) return { n: 0, p50: null, p95: null, max: null }
  const s = [...xs].sort((a, b) => a - b)
  const at = (p: number) => r1(s[Math.max(0, Math.ceil((p / 100) * s.length) - 1)]!)
  return { n: s.length, p50: at(50), p95: at(95), max: r1(s.at(-1)!) }
}

/** Percentiles against a budget: within it when the p95 is (null with no measurements). */
export const budget = (xs: ReadonlyArray<number>, budgetMs: number): Budget => {
  const p = percentiles(xs)
  return { ...p, budget_ms: budgetMs, ok: p.p95 === null ? null : p.p95 <= budgetMs }
}

const count = (xs: ReadonlyArray<string>): Record<string, number> => Object.fromEntries([...new Set(xs)].sort().map((x) => [x, xs.filter((y) => y === x).length]))

interface Recorded {
  readonly traces: ReadonlyArray<MomentTrace>
  readonly requests: ReadonlyArray<RequestLog>
}

const lines = (path: string): unknown[] => (existsSync(path) ? readFileSync(path, "utf8").split("\n").filter((l) => l.trim()).map((l) => JSON.parse(l)) : [])

export const makeOps = () => {
  const cache = new Map<string, Recorded>()
  /** A match's recorded traces and requests (read once). */
  const recorded = (m: LibraryMatch): Recorded => {
    let r = cache.get(m.info.match_id)
    if (!r) {
      r = { traces: lines(join(m.dir, "agents", "traces.jsonl")).map((l) => decodeMomentTrace(l)), requests: lines(join(m.dir, "agents", "requests.jsonl")) as RequestLog[] }
      cache.set(m.info.match_id, r)
    }
    return r
  }

  /** The session's ops numbers as of `frame`. */
  const report = (s: Session, frame: number): OpsReport => {
    const src = s.live ? { traces: s.agents.traces, requests: s.metrics.requests, cues: s.agents.cues } : { ...recorded(s.match), cues: s.match.cues }
    const traces = src.traces.filter((t) => t.moment.frame_to <= frame)
    const requests = src.requests.filter((q) => q.frame <= frame)
    const moments = new Set(traces.map((t) => t.moment.moment_id))
    const cues = src.cues.filter((c: Cue) => c.moment_id !== null && moments.has(c.moment_id) && c.anchor.frame_to <= frame)
    const verdicts = traces.flatMap((t) => t.verdicts.map((v) => v.status))
    const timings = new Map<string, number[]>()
    for (const t of traces) for (const [agent, ms] of Object.entries(t.timings_ms)) timings.set(agent, [...(timings.get(agent) ?? []), ms])
    const insight = s.live
      ? { ...budget(s.metrics.insight, INSIGHT_BUDGET_MS), source: "live" as const }
      : { ...budget(requests.filter((q) => q.outcome === "ok").map((q) => q.ms), INSIGHT_BUDGET_MS), source: "recorded" as const }
    return {
      session_id: s.id,
      live: s.live,
      frame,
      models: [...new Set(traces.map((t) => t.model))],
      moments: moments.size,
      cues: cues.length,
      fact_check: { pass: verdicts.filter((v) => v === "pass").length, retry: verdicts.filter((v) => v === "retry").length, drop: verdicts.filter((v) => v === "drop").length },
      fallbacks: count(traces.flatMap((t) => [...t.fallbacks])),
      agents: [...timings.keys()].sort().map((agent) => ({ agent, ...percentiles(timings.get(agent)!) })),
      requests: count(requests.map((q) => q.outcome)),
      late_cues: requests.reduce((n, q) => n + q.late, 0),
      unverified_cues: requests.reduce((n, q) => n + q.unverified, 0),
      latency: { stats: budget(s.metrics.stats, STATS_BUDGET_MS), insight }
    }
  }

  return { report } as const
}

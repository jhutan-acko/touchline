/**
 * The cue cache (spec §6 "cached replay mode"): a run's agent output in `<run>/agents/`, so a recorded match replays
 * its cues without calling a model. Every line is validated against the contracts when written and when read.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { decodeCue, type Cue } from "@touchline/schema"
import type { GatewayResult, RequestLog } from "./gateway.js"

export const AGENTS_DIR = "agents"

export class CacheError extends Error {}

const pct = (xs: number[], p: number) => {
  if (xs.length === 0) return 0
  const s = [...xs].sort((a, b) => a - b)
  return Math.round(s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))]!)
}

/** Counts for the ops view and the README: what the agents did, how often they fell back, how long requests took. */
export const summarize = (r: GatewayResult) => {
  const count = <T extends string>(xs: T[]) => Object.fromEntries([...new Set(xs)].sort().map((x) => [x, xs.filter((y) => y === x).length]))
  const ok = r.requests.filter((q: RequestLog) => q.outcome === "ok")
  return {
    moments: r.traces.length,
    cues: r.cues.length,
    recaps: r.recaps.length,
    models: [...new Set(r.traces.map((t) => t.model))],
    requests: count(r.requests.map((q) => q.outcome)),
    late_cues: r.requests.reduce((n, q) => n + q.late, 0),
    unverified_cues: r.requests.reduce((n, q) => n + q.unverified, 0),
    fact_check: count(r.traces.map((t) => t.verdicts.map((v) => v.status).join("+"))),
    fallbacks: count(r.traces.flatMap((t) => [...t.fallbacks])),
    latency_ms: { p50: pct(ok.map((q) => q.ms), 50), p95: pct(ok.map((q) => q.ms), 95), max: pct(ok.map((q) => q.ms), 100) }
  }
}

const jsonl = (xs: ReadonlyArray<unknown>) => xs.map((x) => JSON.stringify(x)).join("\n") + (xs.length ? "\n" : "")

/** Write cues.jsonl, traces.jsonl, recaps.jsonl, requests.jsonl and summary.json under `<run>/agents/`. */
export const writeCache = (runDir: string, r: GatewayResult): string => {
  const dir = join(runDir, AGENTS_DIR)
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, "cues.jsonl"), jsonl(r.cues))
  writeFileSync(join(dir, "traces.jsonl"), jsonl(r.traces))
  writeFileSync(join(dir, "recaps.jsonl"), jsonl(r.recaps))
  writeFileSync(join(dir, "requests.jsonl"), jsonl(r.requests))
  writeFileSync(join(dir, "summary.json"), JSON.stringify(summarize(r), null, 2) + "\n")
  return dir
}

/** A run's cached cues, validated (CacheError names the line that is not a cue). */
export const readCueCache = (runDir: string): Cue[] => {
  const path = join(runDir, AGENTS_DIR, "cues.jsonl")
  if (!existsSync(path)) throw new CacheError(`no cue cache at ${path} (run pnpm agents --run ${runDir})`)
  return readFileSync(path, "utf8").split("\n").flatMap((line, i) => {
    if (line.trim() === "") return []
    try {
      return [decodeCue(JSON.parse(line))]
    } catch (e) {
      throw new CacheError(`${path}:${i + 1}: ${e instanceof Error ? e.message.split("\n")[0] : String(e)}`)
    }
  })
}

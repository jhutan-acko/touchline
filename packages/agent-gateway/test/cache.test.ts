import { appendFileSync, mkdtempSync, readFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { describe, expect, it } from "vitest"
import { CacheError, readCueCache, summarize, writeCache } from "../src/cache.js"
import type { GatewayResult } from "../src/gateway.js"
import { CUE, TRACE } from "./fakes.js"
import { decodeMomentTrace } from "@touchline/schema"

const result: GatewayResult = {
  cues: [CUE, { ...CUE, cue_id: "m042-c0312" }],
  traces: [decodeMomentTrace(TRACE)],
  recaps: [],
  requests: [{ kind: "signals", frame: 100, outcome: "ok", ms: 812, cues: 2, late: 0, unverified: 0 }, { kind: "signals", frame: 400, outcome: "timeout", ms: 4000, cues: 0, late: 0, unverified: 0 }]
}

describe("cue cache", () => {
  it("writes the agents' output and reads the cues back validated", () => {
    const run = mkdtempSync(join(tmpdir(), "gw-cache-"))
    const dir = writeCache(run, result)
    expect(readCueCache(run).map((c) => c.cue_id)).toEqual(["m042-c0311", "m042-c0312"])
    expect(JSON.parse(readFileSync(join(dir, "summary.json"), "utf8"))).toMatchObject({
      moments: 1, cues: 2, models: ["stub"], requests: { ok: 1, timeout: 1 }, fact_check: { pass: 1 }, latency_ms: { p50: 812 }
    })
  })

  it("names the line that is not a cue, and says how to make a missing cache", () => {
    const run = mkdtempSync(join(tmpdir(), "gw-cache-"))
    expect(() => readCueCache(run)).toThrow(/pnpm agents --run/)
    const dir = writeCache(run, result)
    appendFileSync(join(dir, "cues.jsonl"), JSON.stringify({ ...CUE, display: { ...CUE.display, ttl_ms: -5 } }) + "\n")
    expect(() => readCueCache(run)).toThrow(CacheError)
    expect(() => readCueCache(run)).toThrow(/cues.jsonl:3/)
  })

  it("summarizes latency over successful requests only", () => {
    expect(summarize(result).latency_ms).toEqual({ p50: 812, p95: 812, max: 812 })
  })
})

import { readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { Schema } from "effect"
import { describe, expect, it } from "vitest"
import { decodeStudioTick, NotQueued, OpsReport, StudioAction } from "../src/contracts.js"

const root = join(dirname(fileURLToPath(import.meta.url)), "../../..")
const cue = (JSON.parse(readFileSync(join(root, "packages/schema/fixtures/agents/valid/cue.json"), "utf8")) as { value: unknown }).value
const item = { moment_id: "mo-1", frame: 1200, clock: "02:00", status: "pending", cue, points: ["High press forces the turnover."], variants: 12 }

describe("studio contracts", () => {
  it("carry queue items, raw cues and playback on the producer's stream", () => {
    expect(decodeStudioTick({ kind: "queue", item }).kind).toBe("queue")
    expect(decodeStudioTick({ kind: "queue", item: { ...item, cue: null } }).kind).toBe("queue") // no variant for the segment
    expect(decodeStudioTick({ kind: "cue", cue }).kind).toBe("cue")
    expect(decodeStudioTick({ kind: "playback", playback: { state: "paused", frame: 3, speed: 4, live: true } }).kind).toBe("playback")
    expect(() => decodeStudioTick({ kind: "queue", item: { ...item, status: "aired" } })).toThrow()
  })

  it("take only approve, hold and send as producer actions", () => {
    const decode = Schema.decodeUnknownSync(StudioAction)
    for (const action of ["approve", "hold", "send"]) expect(decode(action)).toBe(action)
    expect(() => decode("delete")).toThrow()
    expect(new NotQueued({ moment_id: "m" })._tag).toBe("NotQueued")
  })

  it("report the ops numbers against the latency budgets", () => {
    const p = { n: 3, p50: 2, p95: 5, max: 6 }
    const report = {
      session_id: "s", live: false, frame: 6000, models: ["stub"], moments: 4, cues: 48,
      fact_check: { pass: 4, retry: 1, drop: 0 }, fallbacks: { narrator: 1 }, agents: [{ agent: "analyst", ...p }],
      requests: { ok: 9 }, late_cues: 0, unverified_cues: 0,
      latency: { stats: { ...p, missed: 0, budget_ms: 250, ok: true }, insight: { n: 0, p50: null, p95: null, max: null, missed: 2, budget_ms: 4000, ok: false, source: "recorded" } }
    }
    expect(Schema.decodeUnknownSync(OpsReport)(report)).toEqual(report)
  })
})

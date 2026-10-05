import { mkdtempSync, readFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { Effect } from "effect"
import { describe, expect, it } from "vitest"
import { makeConfig } from "@touchline/sim-core/testing"
import { writeMatch } from "../src/writer.js"

const dir = mkdtempSync(join(tmpdir(), "touchline-writer-"))
await Effect.runPromise(writeMatch(makeConfig(5), dir))
const lines = (f: string) => readFileSync(join(dir, f), "utf8").trim().split("\n").map((l) => JSON.parse(l) as Record<string, unknown>)
const cdf = lines("event.jsonl") as Array<{ event: { time: string; period: string }; tracking: { frame_id: number } }>
const domain = lines("domain.jsonl")

const DOMAIN_KEYS = ["attrs", "confidence", "frame_id", "frame_id_end", "id", "match_clock", "match_id", "outcome", "period", "period_frame_id", "player_id", "source", "team_id", "type", "x", "x_end", "y", "y_end"]

describe("match files", () => {
  it("CDF events are in time order", () => {
    for (let i = 1; i < cdf.length; i++) {
      const a = cdf[i - 1]!, b = cdf[i]!
      expect(Date.parse(b.event.time), `event ${i}`).toBeGreaterThanOrEqual(Date.parse(a.event.time))
      if (a.event.period === b.event.period) expect(b.tracking.frame_id, `event ${i}`).toBeGreaterThanOrEqual(a.tracking.frame_id)
    }
  })
  it("domain events are in frame order and keep their details under attrs", () => {
    for (let i = 1; i < domain.length; i++) expect(domain[i]!.frame_id as number, `line ${i}`).toBeGreaterThanOrEqual(domain[i - 1]!.frame_id as number)
    for (const e of domain) expect(Object.keys(e).sort()).toEqual(DOMAIN_KEYS)
  })
  it("take-ons and tackles carry their result as the event outcome", () => {
    const duels = domain.filter((e) => e.type === "take_on" || e.type === "tackle")
    expect(duels.length).toBeGreaterThan(10)
    for (const e of duels) expect(e.outcome).toBe((e.attrs as Record<string, unknown>).outcome)
  })
})

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

const scripted = mkdtempSync(join(tmpdir(), "touchline-scripted-"))
const script = { name: "test_goal", entries: [{ window: [10, 30] as const, team: "home" as const, effect: "goal" as const }] }
const m = await Effect.runPromise(writeMatch(makeConfig(5, { script }), scripted))

describe("run manifest ground truth", () => {
  it("records the scenario and a truth per scripted entry", () => {
    expect(m.scenario).toBe("test_goal")
    expect(m.truths.script).toHaveLength(1)
    expect(m.truths.script[0]).toMatchObject({ effect: "goal", minutes: [10, 30], expected_metrics: ["shot.xg", "team.mom"] })
    expect(typeof m.truths.script[0]!.achieved).toBe("boolean")
  })
  it("lists every scripted event, mistake and critical error, and per-team tactical numbers", () => {
    const events = readFileSync(join(scripted, "domain.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l) as { id: string; type: string; attrs: Record<string, unknown> })
    expect(m.truths.scripted_events.map((e) => e.id)).toEqual(events.filter((e) => e.attrs.scripted === true).map((e) => e.id))
    const bad = events.filter((e) => ((e.type === "pass" || e.type === "clearance") && e.attrs.execution === "mishit") || (e.type === "reception" && e.attrs.first_touch !== "controlled"))
    expect(m.truths.mistakes).toHaveLength(bad.length)
    expect(Array.isArray(m.truths.critical_errors)).toBe(true)
    expect(Object.keys(m.truths.tactical).sort()).toEqual(["away-fc", "home-fc"])
  })
  it("keeps the scripted flag out of CDF", () => {
    expect(readFileSync(join(scripted, "event.jsonl"), "utf8")).not.toMatch(/scripted/)
  })
  it("a match without a script has no scenario and no script truths", () => {
    const plain = JSON.parse(readFileSync(join(dir, "manifest.json"), "utf8"))
    expect(plain.scenario).toBeNull()
    expect(plain.truths.script).toEqual([])
  })
})

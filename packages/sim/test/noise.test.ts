import { mkdtempSync, readFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { Effect } from "effect"
import { describe, expect, it } from "vitest"
import { initMatch, isFinished, step, type DomainEvent } from "@touchline/sim-core"
import { makeConfig } from "@touchline/sim-core/testing"
import { addRealismNoise, REALISM_NOISE } from "../src/noise.js"
import { writeMatch } from "../src/writer.js"

const cfg = makeConfig(4)
let s = initMatch(cfg)
const events: DomainEvent[] = []
while (!isFinished(s)) { const r = step(s); s = r.state; events.push(...r.events) }

describe("realism noise", () => {
  const noisy = addRealismNoise(events, cfg)
  const moved = events.map((e, i) => ({ e, n: noisy[i]! })).filter(({ e }) => e.x !== null && e.type !== "period_start" && e.type !== "period_end")
  it("jitters event times by about N(-0.37 s, 1.82 s)", () => {
    const d = moved.map(({ e, n }) => (n.period_frame_id - e.period_frame_id) * cfg.dt)
    const mean = d.reduce((a, b) => a + b, 0) / d.length
    const sd = Math.sqrt(d.reduce((a, b) => a + (b - mean) ** 2, 0) / d.length)
    expect(mean).toBeGreaterThan(REALISM_NOISE.timeMeanS - 0.15)
    expect(mean).toBeLessThan(REALISM_NOISE.timeMeanS + 0.15)
    expect(sd).toBeGreaterThan(REALISM_NOISE.timeSdS - 0.2)
    expect(sd).toBeLessThan(REALISM_NOISE.timeSdS + 0.2)
  })
  it("moves locations by about the stated spread and keeps them on the pitch", () => {
    const dx = moved.map(({ e, n }) => n.x! - e.x!)
    const sd = Math.sqrt(dx.reduce((a, b) => a + b * b, 0) / dx.length)
    expect(sd).toBeGreaterThan(REALISM_NOISE.locationSdM * 0.8)
    expect(sd).toBeLessThan(REALISM_NOISE.locationSdM * 1.2)
    for (const { n } of moved) {
      expect(Math.abs(n.x!)).toBeLessThanOrEqual(52.5)
      expect(Math.abs(n.y!)).toBeLessThanOrEqual(34)
      expect(n.period_frame_id).toBeGreaterThanOrEqual(0)
    }
  })
  it("is deterministic for a seed, and leaves everything else unchanged", () => {
    expect(addRealismNoise(events, cfg)).toEqual(noisy)
    // Only times (frame ids, the end frame that moves with them, the clock) and coordinates change.
    const mask = { frame_id: 0, period_frame_id: 0, frame_id_end: 0, match_clock: "", x: 0, y: 0, x_end: 0, y_end: 0 }
    noisy.forEach((n, i) => expect({ ...n, ...mask }).toEqual({ ...events[i]!, ...mask }))
  })
})

describe("writing a match with noise", () => {
  it("adds noise to the CDF events only, marks them unsynced, and records it in the manifest", async () => {
    const plain = mkdtempSync(join(tmpdir(), "touchline-plain-")), noisy = mkdtempSync(join(tmpdir(), "touchline-noisy-"))
    await Effect.runPromise(writeMatch(cfg, plain))
    const m = await Effect.runPromise(writeMatch(cfg, noisy, { noise: true }))
    const read = (d: string, f: string) => readFileSync(join(d, f), "utf8")
    expect(read(noisy, "domain.jsonl")).toBe(read(plain, "domain.jsonl"))
    expect(read(noisy, "tracking.jsonl")).toBe(read(plain, "tracking.jsonl"))
    expect(read(noisy, "event.jsonl")).not.toBe(read(plain, "event.jsonl"))
    expect(read(noisy, "event.jsonl")).toMatch(/"is_synced":false/)
    expect(m.realism_noise).toEqual(REALISM_NOISE)
    expect(JSON.parse(read(plain, "manifest.json")).realism_noise).toBeNull()
  })
})

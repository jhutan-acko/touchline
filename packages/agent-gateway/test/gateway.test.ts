import { Effect } from "effect"
import { describe, expect, it } from "vitest"
import { TaskFailed, type Sender } from "../src/a2a.js"
import { DEFAULT_OPTIONS, runGateway, timeline } from "../src/gateway.js"
import { parseSegments, SegmentError } from "../src/segments.js"
import { CUE, fake, plan, RECAP, TRACE } from "./fakes.js"

const run = (send: Parameters<typeof runGateway>[0], p = plan([100]), opts = {}) => Effect.runPromise(runGateway(send, p, { ...DEFAULT_OPTIONS, ...opts }))
const ok = () => [{ name: "cue", data: CUE }, { name: "trace", data: TRACE }]

describe("timeline", () => {
  it("batches signals by game time and puts each recap after the batches before its whistle", () => {
    const reqs = timeline(plan([100, 120, 400, 27100, 56000]), { ...DEFAULT_OPTIONS, batchS: 15 })
    expect(reqs.map((r) => (r.kind === "signals" ? `s${r.now_frame}:${r.signals.length}` : `${r.recap}@${r.at_frame}`))).toEqual([
      "s120:2", "s400:1", "half_time@27000", "s27100:1", "s56000:1", "full_time@57000"
    ])
    expect(reqs.every((r) => r.match_id === "m" && r.segments.length === 2)).toBe(true)
  })
})

describe("gateway", () => {
  it("collects validated cues, traces and recaps", async () => {
    const r = await run(fake((req) => (req.kind === "signals" ? ok() : [{ name: "recap", data: RECAP }])))
    expect(r.cues).toHaveLength(1)
    expect(r.traces).toHaveLength(1)
    expect(r.recaps).toHaveLength(2)
    expect(r.requests.map((q) => q.outcome)).toEqual(["ok", "ok", "ok"])
  })

  it("drops unverified cues and, under a budget, cues that arrive after their ttl", async () => {
    const late = { ...CUE, display: { ...CUE.display, ttl_ms: 1 } }
    const r = await run(fake(() => [{ name: "cue", data: { ...CUE, verified: false } }, { name: "cue", data: late }], 20), plan([100]), { budgetMs: 2000 })
    expect(r.cues).toEqual([])
    expect(r.requests[0]).toMatchObject({ outcome: "ok", unverified: 1, late: 1 })
  })

  it("rejects artifacts that break the contract", async () => {
    const r = await run(fake(() => [{ name: "cue", data: { ...CUE, schema: "touchline.cue/0" } }]))
    expect(r.requests[0]).toMatchObject({ outcome: "invalid" })
    expect(r.cues).toEqual([])
  })

  it("times out a request over budget", async () => {
    const r = await run(fake(() => ok(), 300), plan([100]), { budgetMs: 50 })
    expect(r.requests[0]!.outcome).toBe("timeout")
  })

  it("keeps the cues that arrived before a timeout", async () => {
    const send = fake((req) => (req.kind === "signals" ? [{ name: "cue", data: CUE }, { name: "cue", data: { ...CUE, cue_id: "late-one" } }] : []), 0)
    const slowSecond: Sender = async function* (req, signal) {
      let n = 0
      for await (const a of send(req, signal)) {
        if (n++ === 1) await new Promise((r) => setTimeout(r, 400))
        yield a
      }
    }
    const r = await run(slowSecond, plan([100]), { budgetMs: 100 })
    expect(r.requests[0]).toMatchObject({ outcome: "timeout", cues: 1 })
    expect(r.cues.map((c) => c.cue_id)).toEqual([CUE.cue_id])
  })

  it("retries an unreachable service once, but not a failed task", async () => {
    const flaky = fake((_req, n) => (n === 1 ? new Error("fetch failed") : ok()))
    expect((await run(flaky, plan([100]), { breaker: { failures: 9, cooldown: 0 } })).requests[0]!.outcome).toBe("ok")
    const failing = fake(() => new TaskFailed("bad request: no"))
    const r = await run(failing, plan([100]))
    expect(r.requests[0]).toMatchObject({ outcome: "failed", reason: "bad request: no" })
    expect(failing.calls.filter((c) => c.kind === "signals")).toHaveLength(1)
  })

  it("opens the circuit after repeated failures and skips the next requests", async () => {
    const down = fake(() => new TaskFailed("down"))
    const r = await run(down, plan([100, 400, 700, 1000, 1300, 1600]), { breaker: { failures: 3, cooldown: 2 } })
    expect(r.requests.map((q) => q.outcome)).toEqual(["failed", "failed", "failed", "skipped", "skipped", "failed", "failed", "failed"])
  })
})

describe("segments", () => {
  it("parse mode.lang.club and refuse anything else", () => {
    expect(parseSegments("casual.es.ironmoor, analyst.hi.neutral")).toEqual([{ mode: "casual", lang: "es", club: "ironmoor" }, { mode: "analyst", lang: "hi", club: null }])
    for (const bad of ["", "casual.fr.neutral", "casual.en", "fan.en.neutral", Array(13).fill("casual.en.neutral").join(",")]) expect(() => parseSegments(bad)).toThrow(SegmentError)
  })
})

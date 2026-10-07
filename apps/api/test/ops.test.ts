import { Effect } from "effect"
import { TestClock } from "effect/testing"
import { beforeAll, describe, expect, it } from "vitest"
import { readMatch, type LibraryMatch } from "../src/library.js"
import { budget, makeOps, percentiles } from "../src/ops.js"
import { makeSessions } from "../src/session.js"
import { league, makeLibrary, MATCH_ID, type TestLibrary } from "./fixture.js"

let lib: TestLibrary
let match: LibraryMatch
beforeAll(async () => {
  lib = await makeLibrary()
  match = readMatch(lib.run, league)
}, 120_000)

const run = <A, E>(e: Effect.Effect<A, E, import("effect").Scope.Scope>) => Effect.runPromise(e.pipe(Effect.scoped, Effect.provide(TestClock.layer())))
const session = (live: boolean) =>
  Effect.gen(function* () {
    const sessions = yield* makeSessions(new Map([[MATCH_ID, match]]))
    const s = yield* sessions.start(match, { speed: 1, fromMinute: 0, live: false })
    return { ...s, live }
  })

describe("percentiles", () => {
  it("are nearest-rank, and empty without measurements", () => {
    expect(percentiles([])).toEqual({ n: 0, p50: null, p95: null, max: null })
    expect(percentiles(Array.from({ length: 100 }, (_, i) => 100 - i))).toEqual({ n: 100, p50: 50, p95: 95, max: 100 })
    expect(budget([100, 300], 250)).toMatchObject({ p95: 300, budget_ms: 250, ok: false })
    expect(budget([], 250).ok).toBeNull()
    expect(budget([100], 4000, 1)).toMatchObject({ n: 1, missed: 1, ok: false }) // an insight that never came is a miss
    expect(budget([], 4000, 2)).toMatchObject({ n: 0, p95: null, missed: 2, ok: false })
  })
})

describe("ops report", () => {
  it("counts a recorded session's agent work as of its frame, never ahead of it", () =>
    run(
      Effect.gen(function* () {
        const ops = makeOps()
        const s = yield* session(false)
        const [g1, g2] = [lib.goals[0]!, lib.goals[1]!]
        const before = ops.report(s, g1.frame_id - 1)
        expect([before.moments, before.cues, before.fact_check.pass + before.fact_check.retry + before.fact_check.drop]).toEqual([0, 0, 0])
        const after = ops.report(s, g2.frame_id)
        expect(after.moments).toBe(2)
        expect(after.cues).toBe(6) // two goals × three segments (the half-time card is not a moment's)
        expect(after.fact_check.pass).toBe(2)
        expect(after.models).toEqual([lib.traces[0]!.model])
        expect(after.agents.map((a) => a.agent)).toEqual(Object.keys(lib.traces[0]!.timings_ms).sort())
        expect(after.requests).toEqual({ ok: 1 }) // the fixture's one request, at frame 100
        expect(after.latency.insight).toMatchObject({ source: "recorded", n: 1, p95: 1, missed: 0, budget_ms: 4000, ok: true })
        expect(after.latency.stats).toMatchObject({ n: 0, budget_ms: 250, ok: null })
      })
    ), 120_000)

  it("reports a live session from what its agents did and what it measured", () =>
    run(
      Effect.gen(function* () {
        const ops = makeOps()
        const s = yield* session(true)
        const trace = { ...lib.traces[0]!, verdicts: [{ ...lib.traces[0]!.verdicts[0]!, status: "retry" as const }, { ...lib.traces[0]!.verdicts[0]!, status: "drop" as const }], fallbacks: ["narrator"], model: "openai:gpt-6.1-sol" }
        s.agents.traces.push(trace)
        s.agents.cues.push(...lib.cues.filter((c) => c.moment_id === trace.moment.moment_id))
        s.metrics.stats.push(3, 5)
        s.metrics.insight.push(3000, 3500)
        s.metrics.lost.push(4000)
        s.metrics.requests.push({ kind: "signals", frame: 10, outcome: "ok", ms: 2900, cues: 3, late: 0, unverified: 0 }, { kind: "signals", frame: 20, outcome: "timeout", ms: 4000, cues: 0, late: 1, unverified: 0 })
        const r = ops.report(s, match.info.frames)
        expect([r.live, r.moments, r.cues, r.models]).toEqual([true, 1, 3, ["openai:gpt-6.1-sol"]])
        expect(r.fact_check).toEqual({ pass: 0, retry: 1, drop: 1 })
        expect(r.fallbacks).toEqual({ narrator: 1 })
        expect(r.requests).toEqual({ ok: 1, timeout: 1 })
        expect(r.late_cues).toBe(1)
        expect(r.latency.stats).toMatchObject({ n: 2, p95: 5, ok: true })
        expect(r.latency.insight).toMatchObject({ source: "live", n: 2, p95: 3500, missed: 1, ok: false }) // a timed-out batch is a miss
      })
    ), 120_000)
})

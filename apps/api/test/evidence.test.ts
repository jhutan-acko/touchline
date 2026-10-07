import { Effect, Exit } from "effect"
import type { Cue, MomentTrace, Recap } from "@touchline/schema"
import { beforeAll, describe, expect, it } from "vitest"
import { makeEvidence, SERIES_S, SERIES_STEP_S } from "../src/evidence.js"
import { readMatch } from "../src/library.js"
import { league, makeLibrary, MATCH_ID, type TestLibrary } from "./fixture.js"

let lib: TestLibrary
let ev: ReturnType<typeof makeEvidence>
beforeAll(async () => {
  lib = await makeLibrary()
  ev = makeEvidence(new Map([[MATCH_ID, readMatch(lib.run, league)]]))
}, 120_000)

describe("evidence", () => {
  it("explains a cue with its moment, named claims, the metric's last five minutes and the events", async () => {
    const goal = lib.goals[0]!
    const e = await Effect.runPromise(ev.evidence(MATCH_ID, `mo-${goal.id}-casual.en.neutral`))
    expect(e.moment?.moment_id).toBe(`mo-${goal.id}`)
    expect(e.cause).toBe("clear chance converted")
    const mom = e.claims.find((c) => c.metric_id === "team.mom")!
    expect(mom).toMatchObject({ label: "Momentum", quote: "60%", subject: goal.team_id })
    expect(mom.subject_name).toMatch(/\w/)
    const [s] = e.series
    expect(s).toMatchObject({ metric_id: "team.mom", subject: goal.team_id })
    expect(s!.points).toHaveLength(SERIES_S / SERIES_STEP_S + 1)
    expect(s!.points.at(-1)!.frame).toBe(goal.frame_id)
    expect(e.events.map((x) => x.id)).toEqual([goal.id])
    expect(e.events[0]!.player).toMatch(/\w+ \w+/)
    expect(e.model).toBe("stub")
  }, 60_000)

  it("explains a recap card from the recap's own claims", async () => {
    const e = await Effect.runPromise(ev.evidence(MATCH_ID, `${MATCH_ID}-recap-half_time-casual.en.neutral`))
    expect(e.moment).toBeNull()
    expect(e.claims.map((c) => c.kind)).toEqual(["score"])
  })

  it("has none for scoreboard cues, unknown cues or matches", async () => {
    for (const [m, c, tag] of [[MATCH_ID, `${MATCH_ID}-board-600`, "EvidenceNotFound"], [MATCH_ID, "nope", "EvidenceNotFound"], ["nope", "x", "MatchNotFound"]] as const) {
      const exit = await Effect.runPromise(Effect.exit(ev.evidence(m, c)))
      expect(Exit.isFailure(exit) && JSON.stringify(exit.cause)).toContain(tag)
    }
  })
})

it("skips a claim the stats cannot chart instead of failing", async () => {
  // A claim about a team that is not in the match (it would have failed its check) gets no series.
  const { writeFileSync, readFileSync } = await import("node:fs")
  const path = `${lib.run}/agents/traces.jsonl`
  const lines = readFileSync(path, "utf8").trim().split("\n").map((l) => JSON.parse(l))
  lines[0].analysis.claims.push({ ...lines[0].analysis.claims[0], subject: "nobody-fc" })
  writeFileSync(path, lines.map((l) => JSON.stringify(l)).join("\n") + "\n")
  const e = await Effect.runPromise(ev.evidence(MATCH_ID, `mo-${lib.goals[0]!.id}-casual.en.neutral`))
  expect(e.series.map((s) => s.subject)).toEqual([lib.goals[0]!.team_id])
  expect(e.claims.some((c) => c.subject === "nobody-fc")).toBe(true)
})

describe("recaps", () => {
  it("give the recap and its card for a segment, and nothing for a recap not made", async () => {
    const half = await Effect.runPromise(ev.recap(MATCH_ID, "half_time", { mode: "casual", lang: "es", club: null }))
    expect(half.recap?.kind).toBe("half_time")
    expect(half.cards.map((c) => c.segment.lang)).toEqual(["en"]) // the only variant made; English is the fallback
    expect(await Effect.runPromise(ev.recap(MATCH_ID, "full_time", { mode: "casual", lang: "en", club: null }))).toEqual({ recap: null, cards: [] })
  })
})

describe("as of a session", () => {
  const seg = { mode: "casual", lang: "en", club: null } as const

  it("say nothing about a moment or a recap the session has not reached", async () => {
    const goal = lib.goals[0]!
    const id = `mo-${goal.id}-casual.en.neutral`
    const early = await Effect.runPromise(Effect.exit(ev.evidence(MATCH_ID, id, { frame: goal.frame_id - 1, live: null })))
    expect(Exit.isFailure(early)).toBe(true)
    expect((await Effect.runPromise(ev.evidence(MATCH_ID, id, { frame: goal.frame_id, live: null }))).cause).toBe("clear chance converted")
    expect(await Effect.runPromise(ev.recap(MATCH_ID, "half_time", seg, { frame: 100, live: null }))).toEqual({ recap: null, cards: [] })
  })

  it("answer a live session from what its agents wrote, never from the cache", async () => {
    const trace = { ...lib.traces[0]!, analysis: { ...lib.traces[0]!.analysis, cause: "written live" }, model: "live-model" }
    const cue = lib.cues.find((c) => c.moment_id === trace.moment.moment_id && c.segment.club === null && c.segment.lang === "en")!
    const live = { cues: [] as Cue[], traces: [] as MomentTrace[], recaps: [] as Recap[] }
    expect(Exit.isFailure(await Effect.runPromise(Effect.exit(ev.evidence(MATCH_ID, cue.cue_id, { frame: 1e9, live }))))).toBe(true)
    live.cues.push(cue)
    live.traces.push(trace)
    const e = await Effect.runPromise(ev.evidence(MATCH_ID, cue.cue_id, { frame: 1e9, live }))
    expect([e.cause, e.model]).toEqual(["written live", "live-model"])
    expect(await Effect.runPromise(ev.recap(MATCH_ID, "half_time", seg, { frame: 1e9, live }))).toEqual({ recap: null, cards: [] }) // the cache's recap is not the live one
  })
})

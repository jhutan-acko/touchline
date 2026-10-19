import { Effect, Schema } from "effect"
import { WhatIfSummary } from "@touchline/schema"
import { describe, expect, it } from "vitest"
import { NO_CHANGE, type DecisionOption } from "../src/decision.js"
import { testOptions, whatIfSummary } from "../src/whatif.js"
import { leagueConfig, playMoments, MOMENTS_SEED } from "./helpers.js"

const m = playMoments(leagueConfig(MOMENTS_SEED), (x) => x.reasons.includes("minute_60")).moments.at(-1)!
const st = m.state.players.find((p) => p.side === "home" && p.role === "ST")!
const option = (index: number, label: string, orders: DecisionOption["orders"]): DecisionOption => ({ ...NO_CHANGE, index, label, source: "agent", orders, rationale: "r", xg_diff_vs_no_change: null, goal_diff_vs_no_change: null })
const options = [
  NO_CHANGE,
  option(1, "Press", [{ kind: "style", setting: "pressIntensity", value: 1 }, { kind: "style", setting: "tempo", value: 1 }]),
  option(2, "Fresh striker", [{ kind: "sub", off: st.id, on: m.state.config.home.bench!.find((b) => b.role === "ST")!.id }]),
  option(3, "Nothing after all", [])
]
const small = { seeds: 3, horizonS: 60 }

describe("testing a manager's options", () => {
  const inline = Effect.runSync(testOptions(m.state, "home", options, { ...small, runner: "inline" }))
  it("pairs every option with no change on the same forks: an option that changes nothing differs by exactly 0", () => {
    expect(inline[0]).toEqual(NO_CHANGE)
    expect(inline[3]!.xg_diff_vs_no_change).toEqual({ mean: 0, se: 0 })
    expect(inline[3]!.goal_diff_vs_no_change).toEqual({ mean: 0, se: 0 })
    expect(inline[1]!.untested).toBe(false)
    expect(Number.isFinite(inline[1]!.xg_diff_vs_no_change!.mean)).toBe(true)
  })
  it("gives the same numbers in worker threads as inline", async () => {
    expect(await Effect.runPromise(testOptions(m.state, "home", options, small))).toEqual(inline)
  })
  it("marks an option untested when its worker does not answer in time, and every option when no change could not be played", async () => {
    const timedOut = await Effect.runPromise(testOptions(m.state, "home", options, { ...small, timeoutMs: 1 }))
    expect(timedOut.slice(1).every((o) => o.untested && o.xg_diff_vs_no_change === null)).toBe(true)
  })
  it("summarises the results for the agent, rounded to 3 decimals, with what the numbers mean", () => {
    const s = whatIfSummary(inline, small)
    expect(Schema.decodeUnknownSync(WhatIfSummary)(s)).toEqual(s)
    expect(s.options.map((o) => o.index)).toEqual([0, 1, 2, 3])
    for (const o of s.options) for (const v of [o.xg_diff_vs_no_change!.mean, o.xg_diff_vs_no_change!.se]) expect(Math.round(v * 1000) / 1000).toBe(v)
    expect(s.explanation).toContain("3 times over the next 1 minutes")
  })
})

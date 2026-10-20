import { initMatch, isFinished, step } from "@touchline/sim-core"
import { describe, expect, it } from "vitest"
import { keyMoment, minuteOf, NO_MOMENTS } from "../src/moments.js"
import { leagueConfig, playMoments, MOMENTS_SEED } from "./helpers.js"

const run = playMoments(leagueConfig(MOMENTS_SEED))
const withReason = (r: string) => run.moments.filter((m) => m.reasons.includes(r as never))

describe("key moments", () => {
  it("are all stoppages, so the ball is dead while the manager decides", () => {
    expect(run.moments.length).toBeGreaterThanOrEqual(3)
    for (const m of run.moments) {
      expect(m.state.phase.kind).toBe("restart")
      expect(m.state.possession.kind).toBe("dead")
    }
  })
  it("include half time once, at the second-half kickoff before play", () => {
    const ht = withReason("half_time")
    expect(ht).toHaveLength(1)
    expect([ht[0]!.state.period, ht[0]!.state.periodTick]).toEqual(["second_half", 0])
  })
  it("include minute 60 and minute 75 once each, at the first restart from that minute", () => {
    for (const [reason, at] of [["minute_60", 60], ["minute_75", 75]] as const) {
      const ms = withReason(reason)
      expect(ms).toHaveLength(1)
      // An independent scan of the same match: the first state at a restart from that minute on.
      let s = initMatch(leagueConfig(MOMENTS_SEED))
      while (!isFinished(s) && !(s.phase.kind === "restart" && minuteOf(s) >= at)) s = step(s).state
      expect(ms[0]!.state.tick).toBe(s.tick)
    }
  })
  it("include the kickoff after every goal", () => {
    const goals = run.events.filter((e) => e.type === "goal").length
    expect(withReason("after_goal")).toHaveLength(goals)
    for (const m of withReason("after_goal")) expect(m.state.phase.kind === "restart" && m.state.phase.restart).toBe("kickoff")
  })
  it("absorb a minute moment due within 5 minutes of a decision, but merge it into a decision made at the same stoppage", () => {
    const at60 = withReason("minute_60")[0]!.state
    const minute = minuteOf(at60)
    const recent = keyMoment(at60, [], { goalPending: false, done: ["half_time"], lastMinute: minute - 1 })
    expect(recent.reasons).toEqual([])
    expect(recent.memory.done).toContain("minute_60")
    expect(keyMoment(at60, [], { goalPending: false, done: ["half_time"], lastMinute: minute - 6 }).reasons).toEqual(["minute_60"])
    const kickoff = { ...at60, phase: { ...at60.phase, restart: "kickoff" } } as typeof at60
    expect(keyMoment(kickoff, [], { goalPending: true, done: ["half_time"], lastMinute: minute - 1 }).reasons).toEqual(["after_goal", "minute_60"])
  })
  it("are never raised in open play", () => {
    const open = { ...run.state, phase: { kind: "open_play" as const } }
    expect(keyMoment(open, [{ type: "goal" } as never], NO_MOMENTS).reasons).toEqual([])
  })
})

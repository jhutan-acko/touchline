import { describe, expect, it } from "vitest"
import { initMatch, isFinished, KIND_TO_ACTION, step, type DomainEvent, type MatchConfig, type MatchState, type OptionRecord } from "../src/index.js"
import { makeConfig } from "../src/testing.js"

const play = (cfg: MatchConfig) => {
  let s = initMatch(cfg)
  const events: DomainEvent[] = []
  let secondHalfStart: MatchState | null = null
  while (!isFinished(s)) {
    const r = step(s)
    s = r.state
    events.push(...r.events)
    if (!secondHalfStart && s.period === "second_half") secondHalfStart = s
  }
  return { s, events, secondHalfStart: secondHalfStart! }
}
const matches = [1, 2, 3].map((seed) => play(makeConfig(seed)))
const all = matches.flatMap((m) => m.events)

describe("period boundaries", () => {
  it("a ball in the air when the half is due to end is resolved before the whistle", () => {
    let s = initMatch(makeConfig(4))
    while (!(s.possession.kind === "in_flight" && s.possession.flight.resolveTick > s.tick + 5)) s = step(s).state
    const flight = s.possession.kind === "in_flight" ? s.possession.flight : null
    // Make the half due now, with the ball still travelling.
    s = { ...s, periodTicks: s.periodTick + 1 }
    const events: DomainEvent[] = []
    while (!events.some((e) => e.type === "period_end")) {
      const r = step(s)
      s = r.state
      events.push(...r.events)
    }
    const main = events.find((e) => e.frame_id === flight!.releaseTick && (e.type === "pass" || e.type === "shot" || e.type === "clearance"))
    expect(main, "the flight's event").toBeDefined()
    expect(events.indexOf(main!)).toBeLessThan(events.findIndex((e) => e.type === "period_end"))
  })
  it("a carry under way when the half ends is closed at the whistle, not left open", () => {
    let s = initMatch(makeConfig(4))
    while (!(s.carry !== null && s.tick - s.carry.tick > 10)) s = step(s).state
    const carrier = s.carry!.playerId
    s = { ...s, periodTicks: s.periodTick + 1 }
    const events: DomainEvent[] = []
    while (s.period === "first_half") {
      const r = step(s)
      s = r.state
      events.push(...r.events)
    }
    expect(s.carry).toBeNull()
    const carry = events.find((e) => e.type === "carry" && e.player_id === carrier)
    expect(carry, "the carry event").toBeDefined()
    expect(carry!.period).toBe("first_half")
    for (const m of matches) expect(m.secondHalfStart.carry).toBeNull()
  })
})

describe("on-ball records", () => {
  it("every keeper distribution is followed by a pass from the keeper in the same frame", () => {
    for (const m of matches) {
      m.events.forEach((e, i) => {
        if (e.type !== "keeper_distribution") return
        const next = m.events.slice(i + 1).find((x) => x.player_id === e.player_id && (x.type === "pass" || x.type === "clearance" || x.type === "shot"))
        expect(next?.type, `distribution ${e.id}`).toBe("pass")
        expect(next!.frame_id).toBe(e.frame_id)
      })
    }
  })
  it("the chosen pass is always among the recorded options, and its action has a probability or is marked as a fallback", () => {
    const passes = all.filter((e) => e.type === "pass" && e.attrs.chosen_rank !== null && e.attrs.chosen_rank !== undefined)
    expect(passes.length).toBeGreaterThan(500)
    for (const e of passes) {
      const opts = e.attrs.options as ReadonlyArray<OptionRecord>
      expect(opts.some((o) => o.receiver_id === e.attrs.intended_receiver_id && o.value === e.attrs.chosen_value), e.id).toBe(true)
      // A lay-off (first_time) records the first-time choice, where it is the short_pass option whatever kind the pass
      // classifies as (a lay-off played backwards is a "back" pass; P6 Task 3, ruling F21; seed 1 has one since the
      // pre-merge fixes).
      const action = e.attrs.first_time === true ? "short_pass" : e.attrs.kind === "set_piece" ? null : KIND_TO_ACTION[e.attrs.kind as keyof typeof KIND_TO_ACTION]
      const probs = e.attrs.action_probs as Record<string, number>
      if (action) expect(action in probs || e.attrs.fallback === true, e.id).toBe(true)
    }
  })
  it("every carry carries a decision record, including carries after a won take-on", () => {
    const carries = all.filter((e) => e.type === "carry")
    expect(carries.length).toBeGreaterThan(50)
    for (const e of carries) expect(typeof e.attrs.action_probs, e.id).toBe("object")
  })
  it("passes and shots use the player's preferred foot, and the other foot for weak-foot kicks", () => {
    const cfg = makeConfig(5)
    const left = (ps: MatchConfig["home"]["starters"]) => ps.map((p) => ({ ...p, preferredFoot: "left" as const }))
    const lefty = { ...cfg, home: { ...cfg.home, starters: left(cfg.home.starters), bench: left(cfg.home.bench ?? []) } }
    const m = play(lefty)
    const kicks = m.events.filter((e) => (e.type === "pass" || e.type === "shot") && e.team_id === cfg.home.id && e.attrs.technique !== "throw")
    const share = kicks.filter((e) => e.attrs.body_part === "left_foot").length / kicks.length
    expect(share).toBeGreaterThan(0.7)
    expect(share).toBeLessThan(0.95)
  })
})

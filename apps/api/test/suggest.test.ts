import { describe, expect, it } from "vitest"
import type { FrameSummary } from "@touchline/schema"
import { suggestChips } from "../src/suggest.js"

const player = (id: string, name: string, side: "home" | "away", x: number) => ({ id, name, side, role: "CM", x, y: 34 })

/** A hand-built frame: Ana (home) on the ball, two away players close, a missed option at an earlier pass. */
const base: FrameSummary = {
  match_id: "m1",
  frame: 1200,
  clock: "02:00.00",
  ball_holder: "h1",
  side_in_possession: "home",
  players: [player("h1", "Ana Ruiz", "home", 50), player("h2", "Bo Lind", "home", 60), player("h3", "Cy Okoro", "home", 70), player("a1", "Dee Marsh", "away", 52), player("a2", "Eli Vance", "away", 48)],
  pass_options: [{ receiver_id: "h2", xpass: 0.9, value: 0.05 }, { receiver_id: "h3", xpass: 0.6, value: 0.03 }],
  pressers: ["a1", "a2"],
  recent: [{ event_id: "m1-e40", frame: 1150, type: "pass", player_id: "h3", receiver_id: "h1" }],
  missed_option: { event_id: "m1-e40", passer_id: "h3", played_to: "h1", better_to: "h2" }
}
const teams = { home: "Ironmoor Athletic", away: "Saltmere Rovers" }

describe("suggested questions", () => {
  it("caps at four", () => {
    const chips = suggestChips(base, "en", teams)
    expect(chips.map((c) => c.chip_id)).toEqual(["1200:why_not_pass", "1200:what_if_pass", "1200:pressers", "1200:plan"])
    expect(chips.map((c) => c.text)).toEqual([
      "Why didn't Cy Okoro pass to Bo Lind?",
      "What if Ana Ruiz passed to Bo Lind?",
      "Who's pressing Ana Ruiz?",
      "What are Ironmoor Athletic trying to do here?"
    ])
    expect(chips[0]!.intent).toEqual({ kind: "what_if", subject_id: "h3", fork_event_id: "m1-e40", intervention: { kind: "pass_to", player_id: "h3", receiver_id: "h2" }, reason: null })
    expect(chips[1]!.intent).toEqual({ kind: "what_if", subject_id: "h1", fork_event_id: null, intervention: { kind: "pass_to", player_id: "h1", receiver_id: "h2" }, reason: null })
    expect(chips[2]!.intent).toEqual({ kind: "explain", subject_id: "h1", fork_event_id: null, intervention: null, reason: null })
    expect(chips[3]!.intent).toEqual({ kind: "explain", subject_id: null, fork_event_id: null, intervention: null, reason: null })
    expect(chips.length).toBeLessThanOrEqual(4)
  })

  it("offers no holder chips at a dead ball", () => {
    const dead: FrameSummary = { ...base, ball_holder: null, pass_options: [], pressers: [] }
    expect(suggestChips(dead, "en", teams).map((c) => c.chip_id)).toEqual(["1200:why_not_pass", "1200:plan"])
    expect(suggestChips({ ...dead, missed_option: null }, "en", teams).map((c) => c.chip_id)).toEqual(["1200:plan"])
    // Pressers alone (one) and no options: no holder chips either.
    expect(suggestChips({ ...base, missed_option: null, pass_options: [], pressers: ["a1"] }, "en", teams).map((c) => c.chip_id)).toEqual(["1200:plan"])
  })

  it("is stable and in the viewer's language", () => {
    expect(suggestChips(base, "hi", teams)).toEqual(suggestChips(base, "hi", teams))
    const en = suggestChips(base, "en", teams)
    for (const lang of ["hi", "es"] as const) {
      const other = suggestChips(base, lang, teams)
      expect(other.map((c) => c.chip_id)).toEqual(en.map((c) => c.chip_id))
      expect(other.map((c) => c.intent)).toEqual(en.map((c) => c.intent))
      other.forEach((c, i) => expect(c.text).not.toBe(en[i]!.text))
    }
    const hi = suggestChips(base, "hi", teams).map((c) => c.text)
    expect(hi[0]).toContain("Cy Okoro")
    expect(hi[0]).toContain("Bo Lind")
    expect(hi[1]).toContain("Ana Ruiz")
    expect(hi[2]).toContain("Ana Ruiz")
    expect(hi[3]).toContain("Ironmoor Athletic")
  })

  it("asks about the plan without a team name when none is known", () => {
    const plan = (s: FrameSummary, t?: typeof teams) => suggestChips(s, "en", t).at(-1)!.text
    expect(plan(base)).toBe("What's the plan here?")
    expect(plan({ ...base, side_in_possession: null }, teams)).toBe("What's the plan here?")
    expect(plan({ ...base, side_in_possession: "away" }, teams)).toBe("What are Saltmere Rovers trying to do here?")
  })
})

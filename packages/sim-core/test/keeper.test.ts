import { describe, expect, it } from "vitest"
import { dist } from "../src/geometry.js"
import { keeperInHands } from "../src/keeper.js"
import { DEFAULT_PARAMS as P, type Params } from "../src/params.js"
import { initMatch, isFinished, step } from "../src/step.js"
import { kickoffPlayersFor, makeConfig } from "../src/testing.js"
import type { MatchState, PlayerState } from "../src/types.js"

const keeperAt = (x: number, y: number): PlayerState => {
  const gk = kickoffPlayersFor(makeConfig(1)).find((p) => p.side === "home" && p.role === "GK")!
  return { ...gk, pos: { x, y } }
}
const on: Params = { ...P, keeper: { ...P.keeper, handsRule: 1 } }

describe("keeper in hands or at feet", () => {
  it("has it in his hands in his own box unless his own side touched it last (the back-pass law)", () => {
    const inBox = keeperAt(-48, 0)
    expect(keeperInHands(1, inBox, "first_half", { side: "away", playerId: "x" })).toBe(true)
    expect(keeperInHands(1, inBox, "first_half", null)).toBe(true)
    expect(keeperInHands(1, inBox, "first_half", { side: "home", playerId: "mate" })).toBe(false)
    expect(keeperInHands(1, keeperAt(-30, 0), "first_half", { side: "away", playerId: "x" })).toBe(false)
    // Second half: home defends the +x end.
    expect(keeperInHands(1, keeperAt(48, 0), "second_half", { side: "away", playerId: "x" })).toBe(true)
    expect(keeperInHands(1, inBox, "first_half", { side: "home", playerId: inBox.id })).toBe(true)
    expect(keeperInHands(0, inBox, "first_half", { side: "away", playerId: "x" })).toBe(false)
  })

  it("with the rule on: nobody presses a keeper holding the ball, he holds it at least 5 s, and plays it quickly from his feet", () => {
    const hands: number[] = []
    const feet: number[] = []
    for (const seed of [7, 8]) {
      let s: MatchState = initMatch(makeConfig(seed, { params: on }))
      let open: { id: string; since: number; inHands: boolean } | null = null
      while (!isFinished(s)) {
        const prev = s
        s = step(s).state
        const poss = s.possession
        const gk = poss.kind === "owned" ? s.players.find((p) => p.id === poss.playerId && p.role === "GK") : undefined
        if (gk && poss.kind === "owned" && poss.restart === null) {
          // A press is live only while tick < intentUntil (step.ts never clears an expired intent; frames export it as
          // "shape"). P3 Task 10: seed 7 now has a keeper winning the ball in his hands 34 ticks after a press on him expired.
          if (poss.inHands) for (const o of s.players) if (o.side !== gk.side) expect(o.intent.kind === "press" && s.tick < o.intentUntil && o.intent.targetId === gk.id).toBe(false)
          if (!open || open.id !== gk.id || open.since !== poss.since) open = { id: gk.id, since: poss.since, inHands: poss.inHands === true }
        } else if (open && prev.possession.kind === "owned" && prev.possession.playerId === open.id && s.possession.kind === "in_flight" && s.possession.flight.fromId === open.id) {
          // The keeper released it in open play.
          ;(open.inHands ? hands : feet).push((s.tick - open.since) * s.config.dt)
          open = null
        } else open = null
      }
    }
    expect(hands.length).toBeGreaterThan(0)
    expect(feet.length).toBeGreaterThan(0)
    for (const t of hands) expect(t).toBeGreaterThanOrEqual(5 - 1e-9)
    const median = [...feet].sort((a, b) => a - b)[Math.floor(feet.length / 2)]!
    expect(median).toBeLessThanOrEqual(2.5)
  }, 300_000)

  it("with the rule on: few keeper releases at his feet have an opponent within 5 m", () => {
    let releases = 0
    let pressed = 0
    let s: MatchState = initMatch(makeConfig(9, { params: on }))
    while (!isFinished(s)) {
      const prev = s
      s = step(s).state
      if (prev.possession.kind !== "owned" || prev.possession.restart !== null || prev.possession.inHands) continue
      const gk = prev.players.find((p) => p.id === (prev.possession as { playerId: string }).playerId && p.role === "GK")
      if (!gk || s.possession.kind !== "in_flight") continue
      releases++
      if (prev.players.some((o) => o.side !== gk.side && !o.sentOff && dist(o.pos, gk.pos) < 5)) pressed++
    }
    expect(releases).toBeGreaterThan(5)
    expect(pressed / releases).toBeLessThan(0.3)
  }, 120_000)
})

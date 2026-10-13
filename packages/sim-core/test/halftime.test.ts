import { describe, expect, it } from "vitest"
import { attackX, dirOf, goalOf, sideAttacking, type Side } from "../src/geometry.js"
import { initMatch, isFinished, step } from "../src/step.js"
import { makeConfig } from "../src/testing.js"
import type { DomainEvent, Frame, MatchConfig } from "../src/types.js"

const play = (cfg: MatchConfig) => {
  let s = initMatch(cfg)
  const events: DomainEvent[] = []
  const frames: Frame[] = []
  while (!isFinished(s)) {
    const r = step(s)
    s = r.state
    events.push(...r.events)
    if (r.frame) frames.push(r.frame)
  }
  return { s, events, frames }
}
const sideOf = (cfg: MatchConfig, teamId: string | null): Side => (teamId === cfg.home.id ? "home" : "away")

describe("teams switch ends at half-time", () => {
  it("home attacks +x in the first half and -x in the second; away the reverse", () => {
    expect(dirOf("home", "first_half")).toBe(1)
    expect(dirOf("home", "second_half")).toBe(-1)
    expect(dirOf("away", "first_half")).toBe(-1)
    expect(dirOf("away", "second_half")).toBe(1)
    expect(attackX("home", 30, "second_half")).toBe(-30)
    expect(goalOf("away", "second_half")).toEqual({ x: 52.5, y: 0 })
    expect(sideAttacking(50, "first_half")).toBe("home")
    expect(sideAttacking(50, "second_half")).toBe("away")
  })

  it("credits every goal, own goals included, to the side attacking that end, in both halves", () => {
    let secondHalfGoals = 0
    for (const seed of [7, 8, 9]) {
      const cfg = makeConfig(seed)
      const { s, events } = play(cfg)
      const goals = events.filter((e) => e.type === "goal")
      for (const g of goals) expect(sideOf(cfg, g.team_id)).toBe(sideAttacking(g.x!, g.period))
      secondHalfGoals += goals.filter((g) => g.period === "second_half").length
      expect(goals.filter((g) => sideOf(cfg, g.team_id) === "home").length).toBe(s.score.home)
    }
    expect(secondHalfGoals).toBeGreaterThan(0)
  }, 300_000)

  it("kicks off the second half with each team in the other half, and shoots at the other goal", () => {
    const cfg = makeConfig(7)
    const { events, frames } = play(cfg)
    const first2 = frames.find((f) => f.period === "second_half")!
    const meanX = (ps: Frame["home"]) => ps.reduce((a, p) => a + p.x, 0) / ps.length
    expect(meanX(first2.home)).toBeGreaterThan(0)
    expect(meanX(first2.away)).toBeLessThan(0)
    const homeShots2 = events.filter((e) => e.type === "shot" && e.period === "second_half" && sideOf(cfg, e.team_id) === "home")
    expect(homeShots2.length).toBeGreaterThan(0)
    expect(homeShots2.filter((e) => e.x! < 0).length / homeShots2.length).toBeGreaterThan(0.9)
  }, 120_000)
})

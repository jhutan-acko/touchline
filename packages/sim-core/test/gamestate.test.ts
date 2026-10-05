import { describe, expect, it } from "vitest"
import { DEFAULT_PARAMS, initMatch, isFinished, scoringFactor, step, type DomainEvent, type MatchConfig } from "../src/index.js"
import { makeConfig } from "../src/testing.js"

const P = DEFAULT_PARAMS

describe("scoring factor", () => {
  it("follows the minute profile: later goals are likelier", () => {
    expect(scoringFactor(85, 11, 11, P)).toBeGreaterThan(scoringFactor(10, 11, 11, P))
    expect(scoringFactor(95, 11, 11, P)).toBe(scoringFactor(85, 11, 11, P))
  })
  it("averages to 1 over a match at full strength", () => {
    const minutes = Array.from({ length: 90 }, (_, i) => i + 0.5)
    expect(minutes.reduce((s, m) => s + scoringFactor(m, 11, 11, P), 0) / 90).toBeCloseTo(1, 2)
  })
  it("scales by x0.67 for a team down to ten and x1.2 for its opponent", () => {
    const base = scoringFactor(50, 11, 11, P)
    expect(scoringFactor(50, 10, 11, P) / base).toBeCloseTo(0.67, 6)
    expect(scoringFactor(50, 11, 10, P) / base).toBeCloseTo(1.2, 6)
    expect(scoringFactor(50, 10, 10, P)).toBeCloseTo(base, 6)
  })
})

describe("in a match", () => {
  const play = (cfg: MatchConfig) => {
    let s = initMatch(cfg)
    const events: DomainEvent[] = []
    while (!isFinished(s)) { const r = step(s); s = r.state; events.push(...r.events) }
    return events
  }
  it("shots only score when the profile allows it", () => {
    const params = { ...P, gameState: { ...P.gameState, minuteProfile: [0, 0, 0, 0, 0, 6] as const } }
    for (const seed of [1, 2, 3, 4]) {
      const ev = play(makeConfig(seed, { params }))
      for (const e of ev.filter((x) => x.type === "shot" && x.outcome === "goal" && x.attrs.technique !== "penalty")) {
        const minute = Number(e.match_clock.slice(0, 2))
        expect(minute, e.id).toBeGreaterThanOrEqual(75)
      }
    }
  })
})

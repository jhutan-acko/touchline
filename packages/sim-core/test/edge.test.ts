import { describe, expect, it } from "vitest"
import { DEFAULT_PARAMS, initMatch, isFinished, step, type DomainEvent, type Frame, type MatchConfig } from "../src/index.js"
import { makeConfig } from "../src/testing.js"

const play = (cfg: MatchConfig) => {
  let s = initMatch(cfg)
  const frames: Frame[] = [], events: DomainEvent[] = []
  while (!isFinished(s)) { const r = step(s); s = r.state; if (r.frame) frames.push(r.frame); events.push(...r.events) }
  return { s, frames, events }
}

describe("edge cases", () => {
  it("finishes cleanly when players are sent off, and sent-off players leave the frames", () => {
    const params = { ...DEFAULT_PARAMS, defending: { ...DEFAULT_PARAMS.defending, foulPerTackle: 0.6, redPerFoul: 0.25 } }
    const m = play(makeConfig(6, { params }))
    const reds = m.events.filter((e) => e.type === "card" && e.attrs.colour !== "yellow")
    expect(reds.length).toBeGreaterThan(0)
    const last = m.frames.at(-1)!
    for (const r of reds) expect([...last.home, ...last.away].some((p) => p.id === r.player_id)).toBe(false)
    expect(m.events.at(-1)!.type).toBe("match_end")
  })
  it("runs at 25 Hz (render runs) deterministically with comparable football", () => {
    const a = play(makeConfig(2, { dt: 0.04 }))
    const b = play(makeConfig(2, { dt: 0.04 }))
    expect(JSON.stringify(a.events)).toBe(JSON.stringify(b.events))
    const ten = play(makeConfig(2))
    expect(a.frames.length / ten.frames.length).toBeGreaterThan(2.3)
    expect(a.frames.length / ten.frames.length).toBeLessThan(2.7)
    const passes = (m: { events: DomainEvent[] }) => m.events.filter((e) => e.type === "pass").length
    expect(passes(a) / passes(ten)).toBeGreaterThan(0.7)
    expect(passes(a) / passes(ten)).toBeLessThan(1.3)
  })
  it("plays statistically the same football at 25 Hz as at 10 Hz (completion and interceptions)", () => {
    const sum = (dt: number) => {
      let passes = 0, ok = 0, inter = 0
      for (const seed of [31, 32, 33, 34]) {
        const m = play(makeConfig(seed, { dt }))
        const ps = m.events.filter((e) => e.type === "pass")
        passes += ps.length
        ok += ps.filter((e) => e.outcome === "successful").length
        inter += m.events.filter((e) => e.type === "interception").length
      }
      return { completion: ok / passes, inter }
    }
    const ten = sum(0.1), tf = sum(0.04)
    expect(Math.abs(ten.completion - tf.completion)).toBeLessThan(0.03)
    expect(tf.inter / ten.inter).toBeGreaterThan(0.85)
    expect(tf.inter / ten.inter).toBeLessThan(1.15)
  })
  it("handles extreme seeds", () => {
    for (const seed of [0, 4294967295]) expect(play(makeConfig(seed)).events.at(-1)!.type).toBe("match_end")
  })
  it("credits every goal (own goals included) to the team that scores it", () => {
    for (let seed = 1; seed <= 12; seed++) {
      const cfg = makeConfig(seed)
      const m = play(cfg)
      const goals = m.events.filter((e) => e.type === "goal")
      expect(goals.filter((g) => g.team_id === cfg.home.id).length).toBe(m.s.score.home)
      expect(goals.filter((g) => g.team_id === cfg.away.id).length).toBe(m.s.score.away)
    }
  })
  it("refuses a match where two players share an id (e.g. a club playing itself)", () => {
    const cfg = makeConfig(1)
    expect(() => initMatch({ ...cfg, away: { ...cfg.home } })).toThrow(/duplicate player id/)
  })
})

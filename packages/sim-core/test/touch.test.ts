import { describe, expect, it } from "vitest"
import { DEFAULT_PARAMS, firstTouchError, initMatch, isFinished, step, type DomainEvent, type Frame, type MatchConfig } from "../src/index.js"
import { makeConfig } from "../src/testing.js"

const play = (cfg: MatchConfig) => {
  let s = initMatch(cfg)
  const frames: Frame[] = [], events: DomainEvent[] = []
  while (!isFinished(s)) { const r = step(s); s = r.state; if (r.frame) frames.push(r.frame); events.push(...r.events) }
  return { frames, events }
}
const runs = [1, 2, 3, 4].map((seed) => play(makeConfig(seed)))
const receptions = runs.flatMap((r) => r.events.filter((e) => e.type === "reception"))

describe("first touch", () => {
  const base = { speed: 12, height: 0, pressure: 0, skill: 0.6 }
  const p = (o: Partial<typeof base>) => firstTouchError({ ...base, ...o }, DEFAULT_PARAMS)
  it("is harder for fast, high balls, under pressure, and for less skilful players", () => {
    expect(p({ speed: 22 })).toBeGreaterThan(p({}))
    expect(p({ height: 1.6 })).toBeGreaterThan(p({}))
    expect(p({ pressure: 1 })).toBeGreaterThan(p({}))
    expect(p({ skill: 0.3 })).toBeGreaterThan(p({ skill: 0.9 }))
    expect(p({})).toBeLessThan(0.05)
  })
  it("most receptions are controlled; a few are heavy, miscontrolled or missed", () => {
    const kinds = new Set(receptions.map((e) => e.attrs.first_touch))
    expect([...kinds].every((k) => ["controlled", "heavy", "miscontrol", "missed"].includes(k as string))).toBe(true)
    const bad = receptions.filter((e) => e.attrs.first_touch !== "controlled").length / receptions.length
    expect(bad).toBeGreaterThan(0.01)
    expect(bad).toBeLessThan(0.08)
  })
  it("a bad touch leaves the ball loose; a controlled one keeps it with the receiver", () => {
    for (const r of runs) {
      const byTick = new Map(r.frames.map((f) => [f.tick, f]))
      for (const e of r.events.filter((x) => x.type === "reception")) {
        const f = byTick.get(e.frame_id)!
        if (e.attrs.first_touch === "controlled") expect(f.possession_side, e.id).not.toBeNull()
        else expect(f.possession_side, e.id).toBeNull()
      }
    }
  })
})

describe("ground duels", () => {
  it("contested loose balls are decided by a ground duel between the two teams, and the winner recovers the ball", () => {
    let n = 0
    for (const r of runs) {
      r.events.forEach((e, i) => {
        if (e.type !== "ground_duel") return
        n++
        expect(e.attrs.kind).toBe("loose_ball")
        const winner = e.attrs.winner_id as string, loser = e.attrs.loser_id as string
        expect(winner.slice(0, 4)).not.toBe(loser.slice(0, 4))
        expect(e.player_id).toBe(winner)
        const next = r.events[i + 1]!
        expect(next.type).toBe("ball_recovery")
        expect(next.player_id).toBe(winner)
      })
    }
    expect(n).toBeGreaterThan(20)
  })
})

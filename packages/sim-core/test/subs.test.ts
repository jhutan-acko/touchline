import { describe, expect, it } from "vitest"
import { DEFAULT_PARAMS, drainEnergy, initMatch, isFinished, step, type DomainEvent, type Frame, type MatchConfig } from "../src/index.js"
import { makeConfig } from "../src/testing.js"

const play = (cfg: MatchConfig) => {
  let s = initMatch(cfg)
  const frames: Frame[] = [], events: DomainEvent[] = []
  while (!isFinished(s)) { const r = step(s); s = r.state; if (r.frame) frames.push(r.frame); events.push(...r.events) }
  return { s, frames, events }
}
const runs = [1, 2, 3, 4, 5, 6].map((seed) => ({ cfg: makeConfig(seed), ...play(makeConfig(seed)) }))

describe("stamina", () => {
  it("drains faster when running fast and for players with less stamina", () => {
    const p = DEFAULT_PARAMS
    const walk = 1 - drainEnergy(1, 1.5, 0.5, 0.1, p), sprint = 1 - drainEnergy(1, 8, 0.5, 0.1, p)
    expect(sprint).toBeGreaterThan(5 * walk)
    expect(1 - drainEnergy(1, 6, 0.9, 0.1, p)).toBeLessThan(1 - drainEnergy(1, 6, 0.3, 0.1, p))
    expect(drainEnergy(0.0001, 9, 0, 10, p)).toBe(0)
  })
})

describe("substitutions", () => {
  it("each team makes at most 5, in at most 3 windows during play (half time does not count), and usually makes some", () => {
    let total = 0
    for (const r of runs) {
      for (const team of [r.cfg.home.id, r.cfg.away.id]) {
        const subs = r.events.filter((e) => e.type === "substitution" && e.team_id === team)
        total += subs.length
        expect(subs.length).toBeLessThanOrEqual(5)
        const windows = new Set(subs.filter((e) => e.attrs.half_time !== true).map((e) => e.frame_id))
        expect(windows.size).toBeLessThanOrEqual(3)
      }
    }
    expect(total / (runs.length * 2)).toBeGreaterThan(2.5)
  })
  it("happen only when the ball is dead, in the second half or at half time", () => {
    for (const r of runs) {
      const byTick = new Map(r.frames.map((f) => [f.tick, f]))
      for (const e of r.events.filter((x) => x.type === "substitution")) {
        expect(e.period, e.id).toBe("second_half")
        expect(byTick.get(e.frame_id)?.ball_in_play, e.id).toBe(false)
      }
    }
  })
  it("the player coming on takes part from then on and the player going off never appears again", () => {
    for (const r of runs) {
      for (const e of r.events.filter((x) => x.type === "substitution")) {
        const on = e.attrs.player_on as string, off = e.player_id!
        const after = r.frames.filter((f) => f.tick > e.frame_id)
        expect(after.some((f) => [...f.home, ...f.away].some((p) => p.id === off)), `${off} after going off`).toBe(false)
        expect(after.every((f) => [...f.home, ...f.away].some((p) => p.id === on)) || r.events.some((c) => c.type === "card" && c.player_id === on), `${on} on the pitch`).toBe(true)
        expect([...r.cfg.home.bench!, ...r.cfg.away.bench!].some((b) => b.id === on)).toBe(true)
      }
      for (const f of r.frames.filter((_, i) => i % 100 === 0)) {
        const ids = [...f.home, ...f.away].map((p) => p.id)
        expect(new Set(ids).size).toBe(ids.length)
      }
    }
  })
  it("never brings on a keeper for an outfield player, never replaces a sent-off player, and uses each bench player once", () => {
    const params = { ...DEFAULT_PARAMS, defending: { ...DEFAULT_PARAMS.defending, foulPerTackle: 0.6, redPerFoul: 0.25 } }
    const r = play(makeConfig(6, { params }))
    const cfg = makeConfig(6)
    const bench = new Map([...cfg.home.bench!, ...cfg.away.bench!].map((b) => [b.id, b]))
    const reds = new Set(r.events.filter((e) => e.type === "card" && e.attrs.colour !== "yellow").map((e) => e.player_id))
    const subs = r.events.filter((e) => e.type === "substitution")
    for (const e of subs) {
      expect(bench.get(e.attrs.player_on as string)!.role).not.toBe("GK")
      expect(reds.has(e.player_id)).toBe(false)
    }
    expect(new Set(subs.map((e) => e.attrs.player_on)).size).toBe(subs.length)
  })
  it("a team without a bench plays on with its starters", () => {
    const cfg = makeConfig(7)
    const r = play({ ...cfg, home: { ...cfg.home, bench: [] }, away: { ...cfg.away, bench: undefined } })
    expect(r.events.filter((e) => e.type === "substitution")).toHaveLength(0)
    expect(r.events.at(-1)!.type).toBe("match_end")
  })
})

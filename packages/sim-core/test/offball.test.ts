import { describe, expect, it } from "vitest"
import { assignMarks, DEFAULT_PARAMS, dist, initMatch, isFinished, markTarget, PITCH, shieldTarget, step, steerCarry, supportSpot, type DomainEvent, type Frame, type MatchConfig, type Params, type PlayerState } from "../src/index.js"
import { kickoffPlayersFor, makeConfig } from "../src/testing.js"

const play = (cfg: MatchConfig) => {
  let s = initMatch(cfg)
  const frames: Frame[] = [], events: DomainEvent[] = []
  while (!isFinished(s)) { const r = step(s); s = r.state; if (r.frame) frames.push(r.frame); events.push(...r.events) }
  return { frames, events }
}
const opp = (x: number, y: number): PlayerState => ({ ...kickoffPlayersFor(makeConfig(1))[11]!, id: `o-${x}-${y}`, pos: { x, y } })
const withParams = (over: (p: Params) => Params) => makeConfig(5, { params: over(DEFAULT_PARAMS) })

describe("support play", () => {
  it("offers the open side, away from a cluster of opponents", () => {
    const s = supportSpot({ x: 0, y: 0 }, { x: 0, y: 0 }, "home", [opp(8, 8), opp(9, 6), opp(6, 9)], 12)
    expect(s.y).toBeLessThan(0)
    expect(dist(s, { x: 0, y: 0 })).toBeGreaterThan(3)
    expect(dist(s, { x: 0, y: 0 })).toBeLessThanOrEqual(12.0001)
  })
  it("moves smoothly when the carrier moves a little", () => {
    const opps = [opp(8, 8), opp(9, 6), opp(-6, -9)]
    const a = supportSpot({ x: 0, y: 0 }, { x: -5, y: 0 }, "home", opps, 12)
    const b = supportSpot({ x: 0.1, y: 0 }, { x: -5, y: 0 }, "home", opps, 12)
    expect(dist(a, b)).toBeLessThan(1)
  })
  it("stays on the pitch near a corner flag", () => {
    const s = supportSpot({ x: PITCH.halfL - 1, y: PITCH.halfW - 1 }, { x: 40, y: 25 }, "home", [], 12)
    expect(Math.abs(s.x)).toBeLessThanOrEqual(PITCH.halfL - 1)
    expect(Math.abs(s.y)).toBeLessThanOrEqual(PITCH.halfW - 1)
  })
  it("brings teammates closer to the ball when switched on", () => {
    const near = (frames: Frame[]) => {
      let n = 0, c = 0
      for (const f of frames) {
        if (!f.ball_in_play || !f.possession_side) continue
        n += f[f.possession_side].filter((p) => Math.hypot(p.x - f.ball.x, p.y - f.ball.y) <= 15).length
        c++
      }
      return n / c
    }
    const off = near(play(withParams((p) => p)).frames)
    const on = near(play(withParams((p) => ({ ...p, support: { ...p.support, count: 2 } }))).frames)
    expect(on).toBeGreaterThan(off + 0.1)
  })
})

describe("marking", () => {
  it("pairs the closest defender and attacker first, one to one, within the radius", () => {
    const marks = assignMarks(
      [{ id: "d1", anchor: { x: 0, y: 0 } }, { id: "d2", anchor: { x: 3, y: 0 } }],
      [opp(1, 0), opp(9, 0), opp(30, 0)],
      10
    )
    expect(marks.get("d1")?.id).toBe("o-1-0")
    expect(marks.get("d2")?.id).toBe("o-9-0")
    expect([...marks.values()].some((a) => a.id === "o-30-0")).toBe(false)
  })
  it("stands goal-side of the attacker, blended from the shape anchor by weight", () => {
    const anchor = { x: -20, y: 0 }
    expect(markTarget(anchor, { x: -10, y: 0 }, "home", 1.5, 1)).toEqual({ x: -11.5, y: 0 })
    expect(markTarget(anchor, { x: -10, y: 0 }, "home", 1.5, 0.5)).toEqual({ x: -15.75, y: 0 })
    expect(markTarget(anchor, { x: -10, y: 0 }, "home", 1.5, 0)).toEqual(anchor)
  })
  it("leaves attackers less free space when switched on", () => {
    const freeSpace = (frames: Frame[]) => {
      const per: number[] = []
      for (const f of frames) {
        if (!f.ball_in_play || !f.possession_side) continue
        const att = f[f.possession_side].filter((p) => p.intent !== "on_ball")
        const def = f[f.possession_side === "home" ? "away" : "home"]
        for (const a of att) per.push(Math.min(...def.map((d) => Math.hypot(a.x - d.x, a.y - d.y))))
      }
      return per.reduce((s, v) => s + v, 0) / per.length
    }
    const off = freeSpace(play(withParams((p) => p)).frames)
    const on = freeSpace(play(withParams((p) => ({ ...p, marking: { ...p.marking, weight: 0.6 } }))).frames)
    expect(on).toBeLessThan(off - 0.3)
  })
})

describe("on the ball", () => {
  it("bends a carry away from an opponent ahead, and ignores opponents behind", () => {
    const d = steerCarry({ x: 1, y: 0 }, { x: 0, y: 0 }, [opp(3, 1)], 6)
    expect(d.y).toBeLessThan(0)
    expect(Math.hypot(d.x, d.y)).toBeCloseTo(1, 9)
    expect(steerCarry({ x: 1, y: 0 }, { x: 0, y: 0 }, [opp(-3, 0)], 6)).toEqual({ x: 1, y: 0 })
    expect(steerCarry({ x: 1, y: 0 }, { x: 0, y: 0 }, [opp(3, 1)], 0)).toEqual({ x: 1, y: 0 })
  })
  it("shields away from a close opponent, never off the pitch, and not when switched off", () => {
    expect(shieldTarget({ x: 0, y: 0 }, [opp(1, 0)], 3)).toEqual({ x: -2, y: 0 })
    expect(shieldTarget({ x: 0, y: 0 }, [opp(5, 0)], 3)).toBeNull()
    expect(shieldTarget({ x: 0, y: 0 }, [opp(1, 0)], 0)).toBeNull()
    const edge = shieldTarget({ x: 0, y: PITCH.halfW - 0.5 }, [opp(0, PITCH.halfW - 1.5)], 3)!
    expect(edge.y).toBeLessThanOrEqual(PITCH.halfW - 1)
  })
  it("keeps a pressed carrier moving when switched on", () => {
    const moving = (frames: Frame[]) => {
      let n = 0
      for (const f of frames) {
        const all = [...f.home, ...f.away]
        const c = all.find((p) => p.intent === "on_ball")
        if (!c) continue
        const opps = (f.home.includes(c) ? f.away : f.home)
        if (Math.min(...opps.map((o) => Math.hypot(o.x - c.x, o.y - c.y))) <= 3 && c.vel > 0.5) n++
      }
      return n
    }
    const off = moving(play(withParams((p) => p)).frames)
    const on = moving(play(withParams((p) => ({ ...p, carry: { ...p.carry, shieldM: 3, avoidM: 6 } }))).frames)
    expect(on).toBeGreaterThan(off)
  })
})

import { describe, expect, it } from "vitest"
import { assignMarks, DEFAULT_PARAMS, dist, initMatch, isFinished, markTarget, PITCH, shieldTarget, spacedTarget, spacingFor, step, steerCarry, supportersWanted, supportSpot, type DomainEvent, type Frame, type MatchConfig, type Params, type PlayerState } from "../src/index.js"
import { kickoffPlayersFor, makeConfig } from "../src/testing.js"

const play = (cfg: MatchConfig) => {
  let s = initMatch(cfg)
  const frames: Frame[] = [], events: DomainEvent[] = []
  while (!isFinished(s)) { const r = step(s); s = r.state; if (r.frame) frames.push(r.frame); events.push(...r.events) }
  return { frames, events }
}
const opp = (x: number, y: number): PlayerState => ({ ...kickoffPlayersFor(makeConfig(1))[11]!, id: `o-${x}-${y}`, pos: { x, y } })
const withParams = (over: (p: Params) => Params) => makeConfig(5, { params: over(DEFAULT_PARAMS) })
/** The behaviours are on by default; "off" is the engine as it was before them (support rule 0: the support play these tests were written for). */
const behavioursOff = (p: Params): Params => ({ ...p, support: { ...p.support, rule: 0, count: 0 }, marking: { ...p.marking, weight: 0 }, carry: { ...p.carry, avoidM: 0, shieldM: 0, holdSpeed: 0 } })

describe("support play", () => {
  it("offers the open side, away from a cluster of opponents", () => {
    const s = supportSpot({ x: 0, y: 0 }, { x: 0, y: 0 }, "home", "first_half", [opp(8, 8), opp(9, 6), opp(6, 9)], 12)
    expect(s.y).toBeLessThan(0)
    expect(dist(s, { x: 0, y: 0 })).toBeGreaterThan(3)
    expect(dist(s, { x: 0, y: 0 })).toBeLessThanOrEqual(12.0001)
  })
  it("moves smoothly when the carrier moves a little", () => {
    const opps = [opp(8, 8), opp(9, 6), opp(-6, -9)]
    const a = supportSpot({ x: 0, y: 0 }, { x: -5, y: 0 }, "home", "first_half", opps, 12)
    const b = supportSpot({ x: 0.1, y: 0 }, { x: -5, y: 0 }, "home", "first_half", opps, 12)
    expect(dist(a, b)).toBeLessThan(1)
  })
  it("stays on the pitch near a corner flag", () => {
    const s = supportSpot({ x: PITCH.halfL - 1, y: PITCH.halfW - 1 }, { x: 40, y: 25 }, "home", "first_half", [], 12)
    expect(Math.abs(s.x)).toBeLessThanOrEqual(PITCH.halfL - 1)
    expect(Math.abs(s.y)).toBeLessThanOrEqual(PITCH.halfW - 1)
  })
  // Rule 0 support (always 2 nearest, no spacing). Rule 1 deliberately crowds the ball less: see the rule 1 tests below.
  it("brings teammates closer to the ball when switched on (rule 0)", () => {
    const near = (frames: Frame[]) => {
      let n = 0, c = 0
      for (const f of frames) {
        if (!f.ball_in_play || !f.possession_side) continue
        n += f[f.possession_side].filter((p) => Math.hypot(p.x - f.ball.x, p.y - f.ball.y) <= 15).length
        c++
      }
      return n / c
    }
    const off = near(play(withParams(behavioursOff)).frames)
    const on = near(play(withParams((p) => ({ ...behavioursOff(p), support: { ...p.support, rule: 0, count: 2 } }))).frames)
    expect(on).toBeGreaterThan(off + 0.1)
  })
})

describe("support rule 1 (P3 Task 10d): come short when pressed, otherwise keep space", () => {
  const S = DEFAULT_PARAMS.support
  // Team frame: (u, y) for `side` in `period` is (d * x, d * y) with d = dirOf(side, period), so a point reflection
  // through the centre spot turns home-first-half geometry into the same geometry for the other three cases.
  const MIRRORS = [["home", "first_half", 1], ["home", "second_half", -1], ["away", "first_half", -1], ["away", "second_half", 1]] as const
  const at = (k: number, x: number, y: number) => ({ x: k * x, y: k * y })

  it("is on by default: 2 come short when an opponent is within 5 m, nobody when unpressed, others 16 m away (11 m in the attacking third)", () => {
    expect(S).toMatchObject({ rule: 1, count: 2, pressM: 5, calmCount: 0, spaceM: 16, spaceAttM: 11 })
  })

  it("spaces by spaceAttM only once the carrier is in the attacking third, for either side and half", () => {
    const s = { ...S, spaceM: 16, spaceAttM: 11 }
    for (const [side, period, k] of MIRRORS) {
      expect(spacingFor(at(k, 18, 5), side, period, s)).toBe(11)
      expect(spacingFor(at(k, 17, 5), side, period, s)).toBe(16)
      expect(spacingFor(at(k, -30, -5), side, period, s)).toBe(16)
    }
  })

  it("wants count supporters when an opponent is within pressM of the carrier and calmCount otherwise", () => {
    const s = { ...S, count: 2, calmCount: 1, pressM: 5 }
    expect(supportersWanted({ x: 0, y: 0 }, [opp(4.9, 0), opp(20, 0)], s)).toBe(2)
    expect(supportersWanted({ x: 0, y: 0 }, [opp(0, 5)], s)).toBe(2)
    expect(supportersWanted({ x: 0, y: 0 }, [opp(5.1, 0), opp(20, 0)], s)).toBe(1)
    expect(supportersWanted({ x: 0, y: 0 }, [], s)).toBe(1)
    // A sent-off opponent does not press.
    expect(supportersWanted({ x: 0, y: 0 }, [{ ...opp(1, 0), sentOff: true }], s)).toBe(1)
  })

  it("offers the spot on the distM circle, in the direction of the old averaged spot (which lies inside it)", () => {
    const opps = [opp(8, 8), opp(9, 6), opp(6, 9)]
    const inside = supportSpot({ x: 0, y: 0 }, { x: 0, y: 0 }, "home", "first_half", opps, 14)
    const ring = supportSpot({ x: 0, y: 0 }, { x: 0, y: 0 }, "home", "first_half", opps, 14, true)
    expect(dist(inside, { x: 0, y: 0 })).toBeLessThan(14)
    expect(dist(ring, { x: 0, y: 0 })).toBeCloseTo(14, 9)
    expect(Math.atan2(ring.y, ring.x)).toBeCloseTo(Math.atan2(inside.y, inside.x), 9)
    expect(ring.y).toBeLessThan(0)
  })

  it("keeps the ring spot on the pitch near a corner flag", () => {
    const s = supportSpot({ x: PITCH.halfL - 1, y: PITCH.halfW - 1 }, { x: 40, y: 25 }, "home", "first_half", [], 14, true)
    expect(Math.abs(s.x)).toBeLessThanOrEqual(PITCH.halfL - 1)
    expect(Math.abs(s.y)).toBeLessThanOrEqual(PITCH.halfW - 1)
  })

  it("offers the same ring spot in the team frame for either side and half", () => {
    for (const [side, period, k] of MIRRORS) {
      const carrier = at(k, 10, -5)
      const s = supportSpot(carrier, at(k, 2, -9), side, period, [opp(k * 18, k * 3), opp(k * 15, k * -1), opp(k * 4, k * -12)], 14, true)
      const ref = supportSpot({ x: 10, y: -5 }, { x: 2, y: -9 }, "home", "first_half", [opp(18, 3), opp(15, -1), opp(4, -12)], 14, true)
      expect(s.x).toBeCloseTo(k * ref.x, 9)
      expect(s.y).toBeCloseTo(k * ref.y, 9)
      expect(dist(s, carrier)).toBeCloseTo(14, 9)
    }
  })

  it("moves a target inside spaceM straight out to spaceM and leaves a target outside it alone", () => {
    const carrier = { x: 5, y: 3 }
    const t = spacedTarget(carrier, { x: 11, y: 11 }, "home", "first_half", 16)
    expect(dist(t, carrier)).toBeCloseTo(16, 9)
    expect(Math.atan2(t.y - 3, t.x - 5)).toBeCloseTo(Math.atan2(8, 6), 9)
    const far = { x: 30, y: 3 }
    expect(spacedTarget(carrier, far, "home", "first_half", 16)).toBe(far)
    expect(spacedTarget(carrier, { x: 11, y: 11 }, "home", "first_half", 0)).toEqual({ x: 11, y: 11 })
  })

  it("sends a target on the carrier back toward the player's own goal, for either side and half", () => {
    for (const [side, period, k] of MIRRORS) {
      const t = spacedTarget(at(k, 10, 4), at(k, 10, 4), side, period, 16)
      // Team frame: 16 m behind the carrier (u falls by 16), same y.
      expect(k * t.x).toBeCloseTo(10 - 16, 9)
      expect(k * t.y).toBeCloseTo(4, 9)
    }
  })

  it("mirrors spacing in the team frame and stays on the pitch at the touchline", () => {
    for (const [side, period, k] of MIRRORS) {
      const t = spacedTarget(at(k, 20, 10), at(k, 26, 14), side, period, 16)
      const ref = spacedTarget({ x: 20, y: 10 }, { x: 26, y: 14 }, "home", "first_half", 16)
      expect(t.x).toBeCloseTo(k * ref.x, 9)
      expect(t.y).toBeCloseTo(k * ref.y, 9)
      const edge = spacedTarget(at(k, 40, PITCH.halfW - 2), at(k, 42, PITCH.halfW - 1), side, period, 16)
      expect(Math.abs(edge.y)).toBeLessThanOrEqual(PITCH.halfW - 1)
      expect(Math.abs(edge.x)).toBeLessThanOrEqual(PITCH.halfL - 1)
    }
  })

  it("crowds the carrier less than rule 0, and spacing does part of it, for both sides in both halves", () => {
    // Mean outfield teammates within 10 m of the carrier, per side and half (seed 5: rule 1 about 0.8-1.0 against
    // 1.4-1.8 for rule 0 and 1.3-1.6 for rule 1 without spacing).
    const crowd = (params: Params) => {
      const acc = new Map<string, [number, number]>()
      for (const f of play(makeConfig(5, { params })).frames) {
        if (!f.ball_in_play || !f.possession_side) continue
        const team = f[f.possession_side]
        const c = team.find((p) => p.intent === "on_ball")
        if (!c) continue
        const k = `${f.possession_side}|${f.period}`
        const [n, m] = acc.get(k) ?? [0, 0]
        acc.set(k, [n + team.filter((p) => p !== c && Math.hypot(p.x - c.x, p.y - c.y) < 10).length, m + 1])
      }
      return new Map([...acc].map(([k, [n, m]]) => [k, n / m]))
    }
    const on = crowd(DEFAULT_PARAMS)
    const old = crowd({ ...DEFAULT_PARAMS, support: { ...S, rule: 0 } })
    const noSpace = crowd({ ...DEFAULT_PARAMS, support: { ...S, spaceM: 0 } })
    expect([...on.keys()].sort()).toEqual(["away|first_half", "away|second_half", "home|first_half", "home|second_half"])
    for (const [k, v] of on) {
      expect(v, k).toBeLessThan(0.75 * old.get(k)!)
      expect(v, k).toBeLessThan(0.85 * noSpace.get(k)!)
    }
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
    expect(markTarget(anchor, { x: -10, y: 0 }, "home", "first_half", 1.5, 1)).toEqual({ x: -11.5, y: 0 })
    expect(markTarget(anchor, { x: -10, y: 0 }, "home", "first_half", 1.5, 0.5)).toEqual({ x: -15.75, y: 0 })
    expect(markTarget(anchor, { x: -10, y: 0 }, "home", "first_half", 1.5, 0)).toEqual(anchor)
  })
  it("does not follow a wide attacker more than widthSlackM outside the marker's anchor", () => {
    const t = markTarget({ x: -20, y: 10 }, { x: -10, y: 30 }, "home", "first_half", 1.5, 1, 4)
    expect(t.y).toBeCloseTo(14, 9)
    expect(markTarget({ x: -20, y: -10 }, { x: -10, y: -30 }, "home", "first_half", 1.5, 1, 4).y).toBeCloseTo(-14, 9)
    // Inside the limit nothing changes.
    expect(markTarget({ x: -20, y: 10 }, { x: -10, y: 12 }, "home", "first_half", 1.5, 1, 4)).toEqual(markTarget({ x: -20, y: 10 }, { x: -10, y: 12 }, "home", "first_half", 1.5, 1))
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
    const off = freeSpace(play(withParams(behavioursOff)).frames)
    const on = freeSpace(play(withParams((p) => ({ ...behavioursOff(p), marking: { ...p.marking, weight: 0.6 } }))).frames)
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
    const off = moving(play(withParams(behavioursOff)).frames)
    const on = moving(play(withParams((p) => ({ ...behavioursOff(p), carry: { ...p.carry, shieldM: 3, avoidM: 6 } }))).frames)
    expect(on).toBeGreaterThan(off)
  })
})

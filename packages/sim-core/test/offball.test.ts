import { describe, expect, it } from "vitest"
import { assignMarks, DEFAULT_PARAMS, dist, initMatch, isFinished, markTarget, PITCH, shieldTarget, spacedTarget, spacingFor, step, steerCarry, supportersWanted, supportGate, supportSpot, type DomainEvent, type Frame, type MatchConfig, type Params, type PlayerState } from "../src/index.js"
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

  it("is on by default: 2 come short while the carrier is pressed (within 5 m, each decision held 1 s), nobody otherwise, others 16 m away (11 m in the attacking third)", () => {
    expect(S).toMatchObject({ rule: 1, count: 2, pressM: 5, pressExitM: 5, gateHoldS: 1, calmCount: 0, spaceM: 16, spaceAttM: 11 })
  })

  it("eases the spacing from spaceM to spaceAttM over carrier u 12.5-22.5 m, for either side and half", () => {
    const s = { ...S, spaceM: 16, spaceAttM: 11 }
    for (const [side, period, k] of MIRRORS) {
      expect(spacingFor(at(k, 23, 5), side, period, s)).toBeCloseTo(11, 9)
      expect(spacingFor(at(k, 17.5, 5), side, period, s)).toBeCloseTo(13.5, 9)
      expect(spacingFor(at(k, 12, 5), side, period, s)).toBeCloseTo(16, 9)
      expect(spacingFor(at(k, -30, -5), side, period, s)).toBeCloseTo(16, 9)
      // No jump: a few centimetres of carrier movement moves the spacing by under 3 cm.
      expect(Math.abs(spacingFor(at(k, 17.55, 5), side, period, s) - spacingFor(at(k, 17.5, 5), side, period, s))).toBeLessThan(0.03)
    }
  })

  it("wants count supporters while the carrier is pressed and calmCount otherwise", () => {
    const s = { ...S, count: 2, calmCount: 1 }
    expect(supportersWanted(true, s)).toBe(2)
    expect(supportersWanted(false, s)).toBe(1)
  })

  it("judges a new carrier at once against pressM, ignoring sent-off opponents", () => {
    const s = { ...S, pressM: 5, pressExitM: 5, gateHoldS: 1 }
    const c = { x: 0, y: 0 }
    expect(supportGate(undefined, "c", c, [opp(5.1, 0), opp(20, 0)], s, 0, 0.1).pressed).toBe(false)
    expect(supportGate(undefined, "c", c, [opp(0, 5)], s, 0, 0.1).pressed).toBe(true)
    expect(supportGate(undefined, "c", c, [], s, 0, 0.1).pressed).toBe(false)
    expect(supportGate(undefined, "c", c, [{ ...opp(1, 0), sentOff: true }], s, 0, 0.1).pressed).toBe(false)
    // A new carrier is judged afresh at once, whatever the hold.
    expect(supportGate({ carrierId: "c", pressed: true, sinceTick: 99 }, "d", c, [opp(6, 0)], s, 100, 0.1)).toEqual({ carrierId: "d", pressed: false, sinceTick: 100 })
  })

  it("holds each decision for gateHoldS, then follows pressM; with a band, releases only beyond pressExitM", () => {
    const s = { ...S, pressM: 5, pressExitM: 5, gateHoldS: 1 }
    const c = { x: 0, y: 0 }
    const on = { carrierId: "c", pressed: true, sinceTick: 100 }
    // 0.9 s after the change: held, even with nobody near.
    expect(supportGate(on, "c", c, [opp(20, 0)], s, 109, 0.1)).toBe(on)
    // 1 s after: released.
    expect(supportGate(on, "c", c, [opp(20, 0)], s, 110, 0.1)).toEqual({ carrierId: "c", pressed: false, sinceTick: 110 })
    // Unchanged decisions keep their tick (the hold counts from the last change).
    expect(supportGate(on, "c", c, [opp(3, 0)], s, 150, 0.1)).toBe(on)
    const band = { ...s, pressExitM: 7 }
    expect(supportGate(on, "c", c, [opp(6.9, 0)], band, 150, 0.1).pressed).toBe(true)
    expect(supportGate(on, "c", c, [opp(7.1, 0)], band, 150, 0.1).pressed).toBe(false)
  })

  it("does not flip the supporters every tick when the nearest opponent oscillates around 5 m", () => {
    const run = (s: typeof S) => {
      let gate = supportGate(undefined, "c", { x: 0, y: 0 }, [opp(4.8, 0)], s, 0, 0.1)
      const flips: number[] = []
      for (let tick = 1; tick <= 100; tick++) {
        const next = supportGate(gate, "c", { x: 0, y: 0 }, [opp(tick % 2 ? 5.4 : 4.7, 0)], s, tick, 0.1)
        if (supportersWanted(next.pressed, s) !== supportersWanted(gate.pressed, s)) flips.push(tick)
        gate = next
      }
      return flips
    }
    // Default damping: at most one change per second (10 s of oscillation, at most 10 changes, never two within 1 s).
    const held = run({ ...S, pressM: 5, pressExitM: 5, gateHoldS: 1 })
    expect(held.length).toBeLessThanOrEqual(10)
    for (let i = 1; i < held.length; i++) expect(held[i]! - held[i - 1]!).toBeGreaterThanOrEqual(10)
    // A band wider than the oscillation holds it pressed throughout.
    expect(run({ ...S, pressM: 5, pressExitM: 7, gateHoldS: 0 })).toEqual([])
    // With neither damper the same presser flips it every tick: the dampers are what hold it.
    expect(run({ ...S, pressM: 5, pressExitM: 5, gateHoldS: 0 }).length).toBe(100)
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

  it("never pushes a teammate past the forward-line cap: the spot slides along the circle instead, for either side and half", () => {
    for (const [side, period, k] of MIRRORS) {
      // Carrier at u 25, a forward's capped shape target 6 m ahead (u 31), the cap at u 31 (last defender 35, lineCapM 4).
      const carrier = at(k, 25, 2)
      const t = spacedTarget(carrier, at(k, 31, 3), side, period, 11, 31)
      expect(k * t.x).toBeLessThanOrEqual(31 + 1e-9)
      expect(dist(t, carrier)).toBeCloseTo(11, 9)
      // It goes out on the target's side (y above the carrier's).
      expect(k * t.y).toBeGreaterThan(2)
      // Straight ahead of the carrier: still capped, still spaced.
      const s2 = spacedTarget(carrier, at(k, 30, 2), side, period, 11, 31)
      expect(k * s2.x).toBeLessThanOrEqual(31 + 1e-9)
      expect(dist(s2, carrier)).toBeCloseTo(11, 9)
      // A target already beyond the cap (drift) is not pushed further forward than itself.
      const s3 = spacedTarget(carrier, at(k, 32, 4), side, period, 11, 31)
      expect(k * s3.x).toBeLessThanOrEqual(32 + 1e-9)
      // Without a cap the push goes straight out, past it.
      expect(k * spacedTarget(carrier, at(k, 31, 3), side, period, 11).x).toBeGreaterThan(31)
    }
  })

  it("never pushes a target past max(its own u, the cap) over a grid of carriers, targets and caps, for either side and half", () => {
    let pushed = 0
    for (const [side, period, k] of MIRRORS)
      for (let cu = -40; cu <= 45; cu += 5)
        for (const cy of [-30, -12, 0, 9, 30])
          for (let du = -12; du <= 12; du += 3)
            for (const dy of [-10, -4, 0, 0.5, 6])
              for (const cap of [cu - 5, cu, cu + 3, cu + 8, cu + 20]) {
                const carrier = at(k, cu, cy)
                const target = at(k, cu + du, cy + dy)
                const t = spacedTarget(carrier, target, side, period, 11, cap)
                const tu = k * target.x
                if (t !== target) pushed++
                expect(k * t.x).toBeLessThanOrEqual(Math.max(tu, cap, -(PITCH.halfL - 1)) + 1e-9)
              }
    expect(pushed).toBeGreaterThan(1000)
  })

  it("wires the pressure gate: always pressed crowds the carrier more than never pressed", () => {
    const crowd10 = (params: Params) => {
      let n = 0, m = 0
      for (const f of play(makeConfig(5, { params })).frames) {
        if (!f.ball_in_play || !f.possession_side) continue
        const team = f[f.possession_side]
        const c = team.find((p) => p.intent === "on_ball")
        if (!c) continue
        n += team.filter((p) => p !== c && Math.hypot(p.x - c.x, p.y - c.y) < 12).length
        m++
      }
      return n / m
    }
    const never = crowd10({ ...DEFAULT_PARAMS, support: { ...S, pressM: 0, pressExitM: 0 } })
    const always = crowd10({ ...DEFAULT_PARAMS, support: { ...S, pressM: 1000, pressExitM: 1000 } })
    expect(always).toBeGreaterThan(never + 0.2)
  })

  it("keeps the gate in the match state, so a saved and restored state plays on exactly like the original", () => {
    let s = initMatch(makeConfig(5))
    while (s.tick < 3000) s = step(s).state
    while (s.supportGate === undefined) s = step(s).state
    const copy = JSON.parse(JSON.stringify(s)) as typeof s
    expect(copy.supportGate).toEqual(s.supportGate)
    let a = s, b = copy
    for (let i = 0; i < 200; i++) {
      a = step(a).state
      b = step(b).state
    }
    expect(b.players).toEqual(a.players)
    expect(b.supportGate).toEqual(a.supportGate)
    // Rule 0 keeps no gate.
    let o = initMatch(makeConfig(5, { params: { ...DEFAULT_PARAMS, support: { ...S, rule: 0 } } }))
    while (o.tick < 3200) {
      o = step(o).state
      expect(o.supportGate).toBeUndefined()
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

describe("support rule 1 hold across ticks (P3 deferred, P5 Task 13)", () => {
  // The gate keeps its state while the same carrier has the ball, and a flip waits gateHoldS, at either tick rate. 600 s of
  // football per rate is enough for flips and for raw flips the hold suppressed.
  for (const dt of [0.1, 0.04]) {
    it(`the support hold carries across ticks for the same carrier at dt ${dt}`, () => {
      const sp = DEFAULT_PARAMS.support
      expect(sp.rule).toBe(1)
      let s = initMatch({ ...makeConfig(5, { params: DEFAULT_PARAMS }), dt })
      let prev = s
      let carried = 0, flips = 0, suppressed = 0
      for (let i = 0; i < Math.round(600 / dt); i++) {
        s = step(s).state
        const g = s.supportGate, pg = prev.supportGate
        if (pg && g && pg.carrierId === g.carrierId) {
          if (g.sinceTick === pg.sinceTick) {
            expect(g.pressed).toBe(pg.pressed)
            carried++
            // Inside the hold (a tick of slack at each end): the raw pressure test, on the positions the gate saw, disagrees with
            // the held value, yet the gate did not flip. That is the hold doing its work.
            const carrier = prev.players.find((p) => p.id === g.carrierId)
            if (carrier && (s.tick - g.sinceTick + 2) * dt < sp.gateHoldS) {
              const near = Math.min(...prev.players.filter((p) => p.side !== carrier.side && !p.sentOff).map((p) => dist(p.pos, carrier.pos)))
              if ((near <= (g.pressed ? sp.pressExitM : sp.pressM)) !== g.pressed) suppressed++
            }
          } else {
            flips++
            expect(g.pressed).not.toBe(pg.pressed)
            expect((g.sinceTick - pg.sinceTick) * dt).toBeGreaterThanOrEqual(sp.gateHoldS - 1e-9)
          }
        }
        prev = s
      }
      // Not vacuous: the gate was carried over many ticks, flipped, and the hold suppressed raw flips.
      expect(carried).toBeGreaterThan(100)
      expect(flips).toBeGreaterThan(0)
      expect(suppressed).toBeGreaterThan(0)
    }, 120_000)
  }
})

import { readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "vitest"
import { DEFAULT_PARAMS as P, paramsFromJson, type Params } from "../src/params.js"
import { capGap, landingTarget, laneMarkTarget, markTarget, stepsOut } from "../src/offball.js"
import { initMatch, isFinished, markSpot, shapeTargetAt, step, workAt, type Work } from "../src/step.js"
import { dirOf, dist, PITCH, type Period, type Side, type Vec2 } from "../src/geometry.js"
import { makeConfig } from "../src/testing.js"
import type { Flight, MatchState, PlayerState, Possession, Role } from "../src/types.js"

// Plan 8e Task 11 (rulings 17, 18): the zonal cap (marking.maxGapM) and landing-spot marking and reaction (marking.landingRule).

const root = join(dirname(fileURLToPath(import.meta.url)), "../../..")
const calibrated = paramsFromJson(JSON.parse(readFileSync(join(root, "data/params/touchline-params.json"), "utf8")))

const near = (a: Vec2, b: Vec2, digits = 9) => {
  expect(a.x).toBeCloseTo(b.x, digits)
  expect(a.y).toBeCloseTo(b.y, digits)
}

/**
 * Explicit arms: the marking numbers are pinned (so a retune of the defaults cannot move these tests). `off` has no cap and
 * landingRule 0; `on` has landingRule 1 and the given cap. `rule` is P4's marking.rule.
 */
const pin = (p: Params, rule: number, landingRule: number, maxGapM: number): Params => ({
  ...p,
  marking: { ...p.marking, rule, weight: 0.75, radiusM: 15, goalSideM: 1.5, widthSlackM: 4, laneShare: 0.4, cbStepM: 10, dropMps: 1, maxGapM, landingRule, landingGoalSideM: 1, landingReactM: 10 }
})
const off = (rule: number, p: Params = P): Params => pin(p, rule, 0, 0)
const on = (rule: number, p: Params = P, maxGapM = 0): Params => pin(p, rule, 1, maxGapM)

/** P4's markSpot, verbatim (step.ts at 3a0f0d5), as the reference the off arm must equal. */
const p4MarkSpot = (w: Work, defSide: Side, defId: string, anchor: Vec2, attacker: PlayerState, ballFlat: Vec2): Vec2 => {
  const m = w.p.marking
  const goalSide = (weight: number) => markTarget(anchor, attacker.pos, defSide, w.period, m.goalSideM, weight, m.widthSlackM)
  if (m.rule !== 1) return goalSide(m.weight)
  if (w.player(defId).role === "CB" && (attacker.role === "ST" || attacker.role === "AM") && stepsOut(anchor, attacker, defSide, w.period, m)) return goalSide(1)
  return laneMarkTarget(anchor, ballFlat, attacker.pos, m.weight, m.laneShare, m.widthSlackM)
}

const cfg = makeConfig(7)
const idOf = (side: Side, role: Role, n = 0): string => (side === "home" ? cfg.home : cfg.away).starters.filter((x) => x.role === role)[n]!.id
// Home (4-3-3) defends; away (4-4-2) has the ball.
const HCB1 = idOf("home", "CB", 0)
const HCB2 = idOf("home", "CB", 1)
const AGK = idOf("away", "GK")
const AST1 = idOf("away", "ST", 0)
const AST2 = idOf("away", "ST", 1)
const ACM = idOf("away", "CM", 0)
const ACB = idOf("away", "CB", 0)
const AFB = idOf("away", "FB", 0)

const T0 = 200

/** Positions are in the home team frame (u = home's attacking x, +52.5 the away goal), mirrored to pitch x by the period. */
interface Fix {
  readonly place: Record<string, Vec2>
  readonly period?: Period
  /** The away player on the ball (at his feet, or in his hands for the keeper), or a flight. */
  readonly carrier?: string
  readonly inHands?: boolean
  readonly flight?: { readonly from: string; readonly winner: string; readonly contact: Vec2; readonly height: "high" | "ground" }
}

const toPitch = (k: number, u: Vec2): Vec2 => ({ x: k * u.x, y: u.y })

/** Open play at T0: the named players at their spots, every other player far out on the y −33 touchline, nobody moving. */
const state = (p: Params, o: Fix): MatchState => {
  const s0 = initMatch(makeConfig(7, { params: p }))
  const period = o.period ?? "first_half"
  const k = dirOf("home", period)
  const players = s0.players.map((pl, i): PlayerState => {
    const q = o.place[pl.id]
    const far = { x: pl.side === "home" ? -45 + i * 0.5 : 40 - i * 0.5, y: -33 }
    return { ...pl, pos: toPitch(k, q ?? far), vel: { x: 0, y: 0 }, sentOff: false, intent: { kind: "shape" }, intentUntil: 0 }
  })
  const pos = (id: string) => players.find((x) => x.id === id)!.pos
  let possession: Possession
  let ball: Vec2
  if (o.flight) {
    const f = o.flight
    const c = toPitch(k, f.contact)
    const flight = {
      kind: "pass", fromId: f.from, side: "away", releaseTick: T0 - 5, resolveTick: T0 + 10, winnerId: f.winner, outcome: "successful",
      pending: { type: "pass", frame_id: T0 - 5, team_id: null, player_id: f.from, x: pos(f.from).x, y: pos(f.from).y, x_end: c.x, y_end: c.y, attrs: { height: f.height } },
      extra: [], path: null, restartAfter: null, looseBall: null, deflectTo: null
    } as unknown as Flight
    possession = { kind: "in_flight", flight }
    ball = pos(f.from)
  } else {
    const c = o.carrier!
    possession = { kind: "owned", playerId: c, since: T0, restart: null, ...(o.inHands ? { inHands: true, holdTicks: 100 } : {}) }
    ball = pos(c)
  }
  return {
    ...s0, tick: T0, period, periodTick: T0, phase: { kind: "open_play" }, possession, players,
    ball: { pos: { x: ball.x, y: ball.y, z: 0 }, vel: { x: 0, y: 0, z: 0 } }
  }
}

const PERIODS = ["first_half", "second_half"] as const

// The landing fixture: the away keeper in his hands in his box; ST1 is the most advanced away outfielder (lowest u);
// CB1 is the home CB nearest him (10.0 m against CB2's 20.6 m).
const LANDING: Record<string, Vec2> = {
  [AGK]: { x: 48, y: 0 },
  [AST1]: { x: -8, y: 3 },
  [AST2]: { x: 0, y: -6 },
  [ACM]: { x: 2, y: 0 },
  [ACB]: { x: 30, y: 10 },
  [AFB]: { x: 5, y: 20 },
  [HCB1]: { x: -18, y: 2 },
  [HCB2]: { x: -24, y: -10 }
}

describe("the zonal cap (ruling 17)", () => {
  it("the cap pulls the lane spot to within maxGapM of the attacker", () => {
    const att = { x: 10, y: 4 }
    // 9 m away along a 3-4-5 direction: (10 - 5.4, 4 - 7.2)
    const far = { x: 10 - 5.4, y: 4 - 7.2 }
    expect(dist(far, att)).toBeCloseTo(9, 12)
    const capped = capGap(far, att, 5)
    expect(dist(capped, att)).toBeCloseTo(5, 12)
    // along the line from the attacker to the spot
    near(capped, { x: 10 - 3, y: 4 - 4 }, 12)
    // 3 m away: unchanged
    const close = { x: 10 - 1.8, y: 4 - 2.4 }
    expect(capGap(close, att, 5)).toEqual(close)
    // maxGapM 0 never moves it
    expect(capGap(far, att, 0)).toEqual(far)
    expect(capGap({ x: -40, y: 30 }, att, 0)).toEqual({ x: -40, y: 30 })
  })

  it("under marking.rule 1 markSpot caps the zonal target; under rule 0 the cap does nothing", () => {
    for (const period of PERIODS) {
      const k = dirOf("home", period)
      // CM1 on the ball in midfield; ST2 (not dropping) marked zonally by CB2.
      const fx: Fix = { place: LANDING, period, carrier: ACM }
      const anchor = toPitch(k, { x: -40, y: -8 })
      const ball = toPitch(k, LANDING[ACM]!)
      for (const gap of [4, 5, 6, 8]) {
        const w = workAt(state(on(1, P, gap), fx))
        const st = w.player(AST2)
        const lane = laneMarkTarget(anchor, ball, st.pos, w.p.marking.weight, w.p.marking.laneShare, w.p.marking.widthSlackM)
        // precondition: the uncapped zonal target is further than the cap
        expect(dist(lane, st.pos)).toBeGreaterThan(gap)
        const spot = markSpot(w, "home", HCB2, anchor, st, ball)
        near(spot, capGap(lane, st.pos, gap))
        expect(dist(spot, st.pos)).toBeCloseTo(gap, 9)
        const w0 = workAt(state(on(0, P, gap), fx))
        expect(markSpot(w0, "home", HCB2, anchor, w0.player(AST2), ball)).toEqual(p4MarkSpot(w0, "home", HCB2, anchor, w0.player(AST2), ball))
      }
    }
  })
})

describe("landing-spot marking (ruling 18)", () => {
  it("landingTarget: the CB nearest the most advanced outfielder; null with no CB", () => {
    for (const period of PERIODS) {
      const w = workAt(state(on(1), { place: LANDING, period, carrier: AGK, inHands: true }))
      expect(landingTarget(w.active("home"), w.active("away"), "home", period)).toEqual({ defId: HCB1, attackerId: AST1 })
      // ST2 moved beyond ST1: he becomes the target, and CB2 (now nearer him) the marker
      const w2 = workAt(state(on(1), { place: { ...LANDING, [AST2]: { x: -20, y: -12 } }, period, carrier: AGK, inHands: true }))
      expect(landingTarget(w2.active("home"), w2.active("away"), "home", period)).toEqual({ defId: HCB2, attackerId: AST2 })
      const noCb = w.active("home").filter((x) => x.role !== "CB")
      expect(landingTarget(noCb, w.active("away"), "home", period)).toBeNull()
    }
  })

  it("landing-spot marking: the nearest CB marks the most advanced attacker tightly while their keeper has it", () => {
    for (const period of PERIODS) {
      const k = dirOf("home", period)
      const ownGoal = { x: -k * PITCH.halfL, y: 0 }
      const anchor = toPitch(k, { x: -22, y: 4 })
      for (const rule of [0, 1]) {
        for (const hands of [true, false]) {
          const w = workAt(state(on(rule), { place: LANDING, period, carrier: AGK, inHands: hands }))
          const st1 = w.player(AST1)
          const ball = w.player(AGK).pos
          // CB1 was paired with ST2 by assignMarks; he marks ST1 instead, 1 m goal-side at weight 1.
          const spot = markSpot(w, "home", HCB1, anchor, w.player(AST2), ball)
          near(spot, markTarget(anchor, st1.pos, "home", period, 1, 1))
          expect(dist(spot, st1.pos)).toBeCloseTo(1, 9)
          expect(dist(spot, ownGoal)).toBeLessThan(dist(st1.pos, ownGoal))
          // CB2 is not the landing marker: his normal spot
          const ref = workAt(state(off(rule), { place: LANDING, period, carrier: AGK, inHands: hands }))
          expect(markSpot(w, "home", HCB2, anchor, w.player(AST2), ball)).toEqual(p4MarkSpot(ref, "home", HCB2, anchor, ref.player(AST2), ball))
        }
      }
    }
  })

  it("an away CB or FB in his own third triggers it; in midfield, or an away CM on the ball, does not", () => {
    for (const period of PERIODS) {
      const anchor = toPitch(dirOf("home", period), { x: -22, y: 4 })
      for (const rule of [0, 1]) {
        const spotWith = (p: Params, carrier: string, place: Record<string, Vec2> = LANDING) => {
          const w = workAt(state(p, { place, period, carrier }))
          return markSpot(w, "home", HCB1, anchor, w.player(AST2), w.player(carrier).pos)
        }
        const landing = (carrier: string, place: Record<string, Vec2> = LANDING) => {
          const w = workAt(state(on(rule), { place, period, carrier }))
          return markTarget(anchor, w.player(AST1).pos, "home", period, 1, 1)
        }
        // away CB at home u 30 (away u -30, his own third)
        near(spotWith(on(rule), ACB), landing(ACB))
        // away FB at home u 5 (midfield): normal spot; at home u 25 (his own third): landing
        expect(spotWith(on(rule), AFB)).toEqual(spotWith(off(rule), AFB))
        const deepFb = { ...LANDING, [AFB]: { x: 25, y: 20 } }
        near(spotWith(on(rule), AFB, deepFb), landing(AFB, deepFb))
        // away CB in midfield: normal spot
        const highCb = { ...LANDING, [ACB]: { x: 5, y: 10 } }
        expect(spotWith(on(rule), ACB, highCb)).toEqual(spotWith(off(rule), ACB, highCb))
        // an away CM on the ball in midfield: he does not
        const cm = spotWith(on(rule), ACM)
        expect(cm).toEqual(spotWith(off(rule), ACM))
        expect(dist(cm, landing(ACM))).toBeGreaterThan(0.5)
      }
    }
  })

  it("only a CB that marksFor pairs is reached (preflight F25 row 11): an unassigned CB keeps his own move", () => {
    // markSpot runs only for defenders assignMarks pairs (radiusM 15 m from their anchor), so a CB with no assignment
    // gets no landing spot. One step under on and off: the assigned case moves CB1 differently, the unassigned one does not.
    const oneStep = (p: Params, place: Record<string, Vec2>) => step(state(p, { place, carrier: AGK, inHands: true })).state.players.find((x) => x.id === HCB1)!.pos
    const s = state(on(1), { place: LANDING, carrier: AGK, inHands: true })
    const a1 = shapeTargetAt(s, HCB1)
    const a2 = shapeTargetAt(s, HCB2)
    // Assigned: CB1 stands on his anchor with ST1 6 m in front of it (most advanced), ST2 next to CB2's anchor so ST2 pairs with CB2.
    const assigned = { ...LANDING, [HCB1]: a1, [HCB2]: a2, [AST1]: { x: a1.x + 6, y: a1.y }, [AST2]: { x: a2.x + 8, y: a2.y } }
    const sa = state(on(1), { place: assigned, carrier: AGK, inHands: true })
    expect(dist(a1, sa.players.find((x) => x.id === AST1)!.pos)).toBeLessThan(15)
    expect(landingTarget(workAt(sa).active("home"), workAt(sa).active("away"), "home", "first_half")).toEqual({ defId: HCB1, attackerId: AST1 })
    const onA = oneStep(on(1), assigned)
    const offA = oneStep(off(1), assigned)
    expect(dist(onA, offA)).toBeGreaterThan(1e-6)
    const st1 = sa.players.find((x) => x.id === AST1)!.pos
    const spot = markTarget(a1, st1, "home", "first_half", 1, 1)
    expect(dist(onA, spot)).toBeLessThan(dist(offA, spot))
    // Unassigned: every away outfielder other than the keeper is more than 15 m from CB1's anchor; ST1 is still the most
    // advanced and CB1 still the CB nearest him.
    const unassigned = { ...LANDING, [HCB1]: { x: -40, y: 25 }, [HCB2]: { x: -20, y: -25 }, [AST1]: { x: -48, y: 30 }, [AST2]: { x: 10, y: -6 }, [ACM]: { x: 15, y: -10 } }
    const su = state(on(1), { place: unassigned, carrier: AGK, inHands: true })
    const wu = workAt(su)
    expect(landingTarget(wu.active("home"), wu.active("away"), "home", "first_half")).toEqual({ defId: HCB1, attackerId: AST1 })
    const au = shapeTargetAt(su, HCB1)
    for (const x of wu.active("away")) if (x.role !== "GK") expect(dist(au, x.pos), x.id).toBeGreaterThan(15)
    expect(oneStep(on(1), unassigned)).toEqual(oneStep(off(1), unassigned))
  })
})

describe("landing reaction (ruling 18)", () => {
  it("reaction: during a high flight the winner's marker within 10 m goes to the contact", () => {
    for (const period of PERIODS) {
      const k = dirOf("home", period)
      const anchor = toPitch(k, { x: -22, y: 4 })
      for (const rule of [0, 1]) {
        const contact = { x: -10, y: 4 }
        const at = (cbU: Vec2, height: "high" | "ground", winner = AST1) => {
          const fx: Fix = { place: { ...LANDING, [HCB1]: cbU }, period, flight: { from: AGK, winner, contact, height } }
          const w = workAt(state(on(rule), fx))
          const ref = workAt(state(off(rule), fx))
          const ball = w.player(AGK).pos
          return { got: markSpot(w, "home", HCB1, anchor, w.player(AST1), ball), normal: p4MarkSpot(ref, "home", HCB1, anchor, ref.player(AST1), ball) }
        }
        // 8 m from the contact: to the contact
        const r8 = at({ x: -18, y: 4 }, "high")
        near(r8.got, toPitch(k, contact))
        expect(dist(r8.normal, r8.got)).toBeGreaterThan(0.5)
        // exactly 10 m: still reacts
        near(at({ x: -20, y: 4 }, "high").got, toPitch(k, contact))
        // 14 m away: his normal mark spot
        const r14 = at({ x: -24, y: 4 }, "high")
        expect(r14.got).toEqual(r14.normal)
        // a ground pass: his normal mark spot
        const g = at({ x: -18, y: 4 }, "ground")
        expect(g.got).toEqual(g.normal)
        // the flight's winner is someone else: his normal mark spot
        const o = at({ x: -18, y: 4 }, "high", AST2)
        expect(o.got).toEqual(o.normal)
      }
    }
  })
})

describe("rule off", () => {
  it("rule off marks exactly as P4", () => {
    const fixtures: Fix[] = [
      { place: LANDING, carrier: AGK, inHands: true },
      { place: LANDING, carrier: AGK, inHands: false },
      { place: LANDING, carrier: ACB },
      { place: LANDING, carrier: ACM },
      { place: { ...LANDING, [HCB1]: { x: -12, y: 4 } }, flight: { from: AGK, winner: AST1, contact: { x: -10, y: 4 }, height: "high" } }
    ]
    for (const period of PERIODS)
      for (const rule of [0, 1])
        for (const f of fixtures) {
          const w = workAt(state(off(rule), { ...f, period }))
          const k = dirOf("home", period)
          for (const anchor of [toPitch(k, { x: -22, y: 4 }), toPitch(k, { x: -30, y: -1 })])
            for (const def of [HCB1, HCB2])
              for (const att of [AST1, AST2, ACM]) {
                const a = { ...w.player(att), vel: { x: k * 2, y: 0 } }
                const ball = { x: w.ball.pos.x, y: w.ball.pos.y }
                expect(markSpot(w, "home", def, anchor, a, ball)).toEqual(p4MarkSpot(w, "home", def, anchor, a, ball))
                // still moving, toward his own goal (the step-out branch)
                const drop = { ...w.player(att), vel: { x: -k * 2, y: 0 } }
                expect(markSpot(w, "home", def, anchor, drop, ball)).toEqual(p4MarkSpot(w, "home", def, anchor, drop, ball))
              }
        }
  })
})

describe("in matches", () => {
  /** Once a second in open play with a side on the ball: the median over that side's players (not the carrier, the
   *  nearest to the ball) of the distance to the nearest opponent; then the median over the samples (metrics.ts free_space_m). */
  const freeSpace = (params: Params, seed: number): number[] => {
    const c = makeConfig(seed, { params })
    let s = initMatch(c)
    const every = Math.round(1 / c.dt)
    const out: number[] = []
    const median = (xs: number[]) => {
      const v = [...xs].sort((a, b) => a - b)
      const m = v.length >> 1
      return v.length % 2 ? v[m]! : (v[m - 1]! + v[m]!) / 2
    }
    while (!isFinished(s)) {
      s = step(s).state
      if (s.tick % every !== 0 || s.phase.kind !== "open_play") continue
      const pos = s.possession
      const side: Side | null = pos.kind === "owned" ? s.players.find((x) => x.id === pos.playerId)!.side : pos.kind === "in_flight" ? pos.flight.side : null
      if (!side) continue
      const att = s.players.filter((x) => x.side === side && !x.sentOff)
      const def = s.players.filter((x) => x.side !== side && !x.sentOff)
      if (att.length < 3 || def.length < 3) continue
      const ball = { x: s.ball.pos.x, y: s.ball.pos.y }
      const carrier = att.reduce((a, b) => (dist(b.pos, ball) < dist(a.pos, ball) ? b : a))
      out.push(median(att.filter((x) => x.id !== carrier.id).map((x) => Math.min(...def.map((q) => dist(x.pos, q.pos))))))
    }
    return out
  }
  const medianOf = (xs: number[]) => {
    const v = [...xs].sort((a, b) => a - b)
    return v[v.length >> 1]!
  }

  it("in matches, free space falls with the cap", () => {
    const withCap = (gap: number): Params => ({ ...calibrated, marking: { ...calibrated.marking, rule: 1, maxGapM: gap, landingRule: 0 } })
    const uncapped = [...freeSpace(withCap(0), 7), ...freeSpace(withCap(0), 9)]
    const capped = [...freeSpace(withCap(5), 7), ...freeSpace(withCap(5), 9)]
    expect(uncapped.length).toBeGreaterThanOrEqual(1000)
    expect(capped.length).toBeGreaterThanOrEqual(1000)
    const a = medianOf(uncapped), b = medianOf(capped)
    console.log(`free space: maxGapM 0 ${a.toFixed(2)} m (${uncapped.length}), maxGapM 5 ${b.toFixed(2)} m (${capped.length})`)
    expect(b).toBeLessThan(a)
  }, 900_000)
})

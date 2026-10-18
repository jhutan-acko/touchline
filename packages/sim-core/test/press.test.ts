import { describe, expect, it } from "vitest"
import { dist, type Period, type Vec2 } from "../src/geometry.js"
import { vmaxFor } from "../src/kinematics.js"
import { DEFAULT_PARAMS as P, type Params } from "../src/params.js"
import { backToGoalHolds, inOwnThird, pressLift, presserScore, shadowSpot } from "../src/press.js"
import { initMatch, isFinished, noteReception, step, teamPressMove, workAt } from "../src/step.js"
import { makeConfig } from "../src/testing.js"
import type { Script } from "../src/script.js"
import type { Flight, MatchState, PlayerState, Possession, Role, TransitionState } from "../src/types.js"

// Explicit on and off (F4): Task 10 flips the defaults. The keeper-hands rule is pinned on (the keeper test needs it),
// and the transition rule off, so counter-press joiners never hold press intents here unless a test says so.
// Role weights are pinned here (G19): Task 7 Step 3 retunes the defaults, and these tests must not read tuned values.
const WEIGHTS: Params["press"]["roleWeight"] = { CB: 0.6, FB: 0.9, DM: 1, CM: 1, AM: 0.8, W: 1, ST: 0.7 }
const base: Params = { ...P, keeper: { ...P.keeper, handsRule: 1 }, transition: { ...P.transition, rule: 0 } }
// rateScale and secondShare are pinned at the plan's start values too, so no case rests on Task 7's tuned ones.
const PINNED = { roleWeight: WEIGHTS, rateScale: 1, secondShare: 0.45 }
const off: Params = { ...base, press: { ...P.press, rule: 0, ...PINNED } }
const on: Params = { ...base, press: { ...P.press, rule: 1, ...PINNED } }
/** The hazard forced (under either rule): a chosen presser starts on the first tick. */
const forced = (p: Params, press: Partial<Params["press"]> = {}): Params => ({ ...p, defending: { ...p.defending, pressRatePerS: 1e6 }, press: { ...p.press, ...press } })
const PR = on.press
const T0 = 200

interface Place {
  readonly pos: Vec2
  readonly vel?: Vec2
}

/**
 * Open play at tick T0: `carrier` holds the ball at his feet (or in his hands) and keeps it (a long hold). Players named
 * in `place` stand there; every other player stands on the far touchline, more than 30 m from the centre, still.
 */
const fixture = (
  p: Params,
  o: { place: Record<string, Place>; carrier: string; dt?: number; period?: Period; inHands?: boolean; ballVel?: Vec2; transition?: TransitionState; intents?: Record<string, Pick<PlayerState, "intent" | "intentUntil">>; script?: Script }
): MatchState => {
  const s0 = initMatch(makeConfig(7, { params: p, dt: o.dt ?? 0.1, ...(o.script ? { script: o.script } : {}) }))
  const players = s0.players.map((pl, i): PlayerState => {
    const q = o.place[pl.id]
    const far = { x: pl.side === "home" ? -50 + i : 50 - i, y: -33 }
    const hold = pl.id === o.carrier ? { intent: { kind: "hold" as const }, intentUntil: T0 + 10_000 } : {}
    return { ...pl, pos: q?.pos ?? far, vel: q?.vel ?? { x: 0, y: 0 }, sentOff: false, ...hold, ...(o.intents?.[pl.id] ?? {}) }
  })
  const possession: Possession = { kind: "owned", playerId: o.carrier, since: T0, restart: null, ...(o.inHands ? { inHands: true, holdTicks: 100 } : {}) }
  const carrier = players.find((x) => x.id === o.carrier)!
  const v = o.ballVel ?? { x: 0, y: 0 }
  return {
    ...s0,
    tick: T0,
    period: o.period ?? "first_half",
    periodTick: T0,
    phase: { kind: "open_play" },
    ball: { pos: { x: carrier.pos.x, y: carrier.pos.y, z: 0 }, vel: { x: v.x, y: v.y, z: 0 } },
    possession,
    players,
    lastTouch: { playerId: carrier.id, side: carrier.side },
    ...(o.transition ? { transition: o.transition } : {})
  }
}

const cfg = makeConfig(7)
const id = (side: "home" | "away", role: Role, n = 0): string => (side === "home" ? cfg.home : cfg.away).starters.filter((x) => x.role === role)[n]!.id
const HCB = id("home", "CB")
const HW = id("home", "W")
const HCM = id("home", "CM")
const HST = id("home", "ST")
const ACM = id("away", "CM")
const ACB = id("away", "CB")
const AGK = id("away", "GK")

const livePressOn = (s: MatchState, targetId: string): PlayerState[] =>
  s.players.filter((x) => x.intent.kind === "press" && x.intent.targetId === targetId && s.tick < x.intentUntil)

describe("A5 team pressing: pure helpers", () => {
  it("lifts multiply: 2 back to goal, 2 in our third, 4 both, 1 neither", () => {
    expect(pressLift(true, false, PR)).toBe(2)
    expect(pressLift(false, true, PR)).toBe(2)
    expect(pressLift(true, true, PR)).toBe(4)
    expect(pressLift(false, false, PR)).toBe(1)
  })

  it("the cover-shadow spot is shadowM from the carrier toward the teammate", () => {
    const s = shadowSpot({ x: 1, y: 2 }, { x: 1, y: 12 }, 4)
    expect(s.x).toBeCloseTo(1, 12)
    expect(s.y).toBeCloseTo(6, 12)
  })

  it("own third mirrors after half-time", () => {
    // A home carrier at x = -30: in the first half home attacks +x, so the ball is in home's own third (u = -30) and
    // in away's attacking third; after half-time it is the other way round.
    const ball = { x: -30, y: 0 }
    expect(inOwnThird(ball, "home", "first_half", PR)).toBe(true)
    expect(inOwnThird(ball, "away", "first_half", PR)).toBe(false)
    expect(inOwnThird(ball, "away", "second_half", PR)).toBe(true)
    expect(inOwnThird(ball, "home", "second_half", PR)).toBe(false)
    // The boundary: u = -17.5 is not inside.
    expect(inOwnThird({ x: 17.5, y: 0 }, "away", "first_half", PR)).toBe(false)
    expect(inOwnThird({ x: 17.6, y: 0 }, "away", "first_half", PR)).toBe(true)
  })
})

describe("A5 team pressing: the back-to-goal trigger", () => {
  const PASS = { kind: "pass" } as Flight
  /** The carrier (home CM, attacking +x in the first half) receives a pass arriving at `ballMps` forward. */
  const received = (p: Params, dt: number, ballMps: number) => {
    const s = fixture(p, { dt, carrier: HCM, place: { [HCM]: { pos: { x: 0, y: 0 } } }, ballVel: { x: ballMps, y: 0 } })
    const w = workAt(s)
    noteReception(w, w.player(HCM), PASS)
    return w
  }

  for (const [dt, last] of [[0.1, 14], [0.04, 37]] as const) {
    it(`back to goal lasts 1.5 s at ${dt === 0.1 ? 10 : 25} Hz and needs a ball arriving faster than 5 m/s forward`, () => {
      const w = received(on, dt, 6)
      const rec = w.press?.reception ?? null
      expect(rec).not.toBeNull()
      expect(rec!.ballMps).toBeCloseTo(6, 12)
      expect(backToGoalHolds(rec, HCM, w.tick, dt, PR)).toBe(true)
      expect(backToGoalHolds(rec, HCM, w.tick + last, dt, PR)).toBe(true)
      expect(backToGoalHolds(rec, HCM, w.tick + last + 1, dt, PR)).toBe(false)
      // Somebody else on the ball: no trigger.
      expect(backToGoalHolds(rec, HST, w.tick, dt, PR)).toBe(false)
      // A slow ball never triggers.
      const slow = received(on, dt, 4)
      for (let k = 0; k <= last + 1; k++) expect(backToGoalHolds(slow.press?.reception ?? null, HCM, slow.tick + k, dt, PR)).toBe(false)
      // Backwards is not forwards: 6 m/s toward his own goal.
      expect(backToGoalHolds(received(on, dt, -6).press?.reception ?? null, HCM, w.tick, dt, PR)).toBe(false)
      // rule 0: nothing is noted.
      expect(received(off, dt, 6).press).toBeUndefined()
    })
  }

  it("forward is the receiver's attacking direction, mirrored after half-time", () => {
    // Second half: home attacks -x, so a ball arriving at -6 m/s in x is 6 m/s forward.
    const s = fixture(on, { carrier: HCM, period: "second_half", place: { [HCM]: { pos: { x: 0, y: 0 } } }, ballVel: { x: -6, y: 0 } })
    const w = workAt(s)
    noteReception(w, w.player(HCM), PASS)
    expect(w.press?.reception?.ballMps).toBeCloseTo(6, 12)
  })
})

describe("A5 team pressing: who presses", () => {
  /** Away CM on the ball at the centre spot; home CB 8 m away, home W 9 m away. Who starts a press on the first tick? */
  const starter = (p: Params): string[] => {
    const s = fixture(forced(p, { secondShare: 0 }), { carrier: ACM, place: { [ACM]: { pos: { x: 0, y: 0 } }, [HCB]: { pos: { x: -8, y: 0 } }, [HW]: { pos: { x: 0, y: 9 } } } })
    return livePressOn(step(s).state, ACM).map((x) => x.id)
  }

  it("the presser is chosen by distance over role weight", () => {
    expect(presserScore(8, "CB", PR)).toBeCloseTo(8 / 0.6, 12)
    expect(presserScore(9, "W", PR)).toBe(9)
    // Precondition: with every weight at 1 the nearest presses (the old rule): the CB.
    const ones = Object.fromEntries(Object.keys(WEIGHTS).map((k) => [k, 1])) as Params["press"]["roleWeight"]
    expect(starter({ ...on, press: { ...on.press, roleWeight: ones } })).toEqual([HCB])
    expect(starter(forced(off))).toEqual([HCB])
    // 8 / 0.6 = 13.3 against 9 / 1 = 9: the W.
    expect(starter(on)).toEqual([HW])
  })

  it("nobody beyond 18 m starts a press, whatever his score", () => {
    const s = fixture(forced(on), { carrier: ACM, place: { [ACM]: { pos: { x: 0, y: 0 } }, [HW]: { pos: { x: 0, y: 18.5 } } } })
    expect(livePressOn(step(s).state, ACM)).toEqual([])
  })
})

describe("A5 team pressing: the second presser", () => {
  /** Home CM pressing (live) the away CM at the centre spot from `firstM`; home W 8.5 m off; the carrier's nearest teammate (away CB) 8 m to his left. */
  const scene = (p: Params, firstM: number): MatchState =>
    fixture(p, {
      carrier: ACM,
      place: { [ACM]: { pos: { x: 0, y: 0 } }, [HCM]: { pos: { x: -firstM, y: 0 } }, [HW]: { pos: { x: -6, y: -6 } }, [ACB]: { pos: { x: 0, y: 8 } } },
      intents: { [HCM]: { intent: { kind: "press", targetId: ACM }, intentUntil: T0 + 30 } }
    })

  it("a second presser joins in the cover shadow", () => {
    const join = (p: Params, firstM: number) => {
      const r = step(scene(p, firstM)).state
      // Precondition: the first presser is still pressing.
      expect(livePressOn(r, ACM).map((x) => x.id)).toContain(HCM)
      return r
    }
    const r = join({ ...on, press: { ...on.press, secondShare: 1 } }, 10)
    const w2 = r.players.find((x) => x.id === HW)!
    expect(livePressOn(r, ACM).map((x) => x.id).sort()).toEqual([HCM, HW].sort())
    // His target: 4 m from the carrier toward the carrier's nearest teammate (the away CB).
    const w = workAt(r)
    const carrier = w.player(ACM)
    const mate = w.player(ACB)
    const mv = teamPressMove(w, w2, carrier, vmaxFor(w2, w2.energy, on), 1)
    expect(mv).not.toBeNull()
    const spot = shadowSpot(carrier.pos, mate.pos, PR.shadowM)
    expect(dist(mv!.target, spot)).toBeLessThan(1e-9)
    expect(dist(mv!.target, carrier.pos)).toBeCloseTo(4, 9)
    // The draw is on the press stream, and only under rule 1.
    expect(r.rng.press).not.toEqual(scene(on, 10).rng.press)
    expect(step(scene(off, 10)).state.rng.press).toEqual(scene(off, 10).rng.press)

    // secondShare 0: nobody joins.
    expect(livePressOn(join({ ...on, press: { ...on.press, secondShare: 0 } }, 10), ACM).map((x) => x.id)).toEqual([HCM])
    // rule 0: nobody joins.
    expect(livePressOn(join({ ...off, press: { ...off.press, secondShare: 1 } }, 10), ACM).map((x) => x.id)).toEqual([HCM])
  })

  it("the second-presser draw is made once per first press", () => {
    const p: Params = { ...on, press: { ...on.press, secondShare: 0.5 } }
    let s = step(scene(p, 10)).state
    const after1 = s.rng.press
    for (let k = 0; k < 10; k++) s = step(s).state
    // Precondition: the first press is still live over these ticks.
    expect(livePressOn(s, ACM).map((x) => x.id)).toContain(HCM)
    expect(s.rng.press).toEqual(after1)
  })

  it("no second presser while the first is beyond secondM; he is drawn once the first gets within it", () => {
    // The first presser starts 14 m away and runs in: on every tick he ends more than 12 m away, nobody joins and the
    // press stream is not drawn; the draw comes on the tick he is first within 12 m (secondShare 1: the W joins).
    let s = scene({ ...on, press: { ...on.press, secondShare: 1 } }, 14)
    let beyond = 0
    let joined = false
    for (let k = 0; k < 30 && !joined; k++) {
      const before = s
      s = step(s).state
      const first = s.players.find((x) => x.id === HCM)!
      // Precondition: the first presser is still pressing.
      expect(livePressOn(s, ACM).map((x) => x.id)).toContain(HCM)
      if (dist(first.pos, s.players.find((x) => x.id === ACM)!.pos) > PR.secondM) {
        beyond++
        expect(livePressOn(s, ACM).map((x) => x.id)).toEqual([HCM])
        expect(s.rng.press).toEqual(before.rng.press)
      } else joined = livePressOn(s, ACM).some((x) => x.id === HW)
    }
    expect(beyond).toBeGreaterThan(0)
    expect(joined).toBe(true)
  })

  /** Two first pressers already live on the away CM (home CM at 10 m, home W at 9 m); a free home CB 7 m off; the carrier's nearest teammate the away CB. */
  const twoLive = (share: number): MatchState =>
    fixture(forced({ ...on, press: { ...on.press, secondShare: share } }), {
      carrier: ACM,
      place: { [ACM]: { pos: { x: 0, y: 0 } }, [HCM]: { pos: { x: -10, y: 0 } }, [HW]: { pos: { x: 0, y: -9 } }, [HCB]: { pos: { x: -5, y: -5 } }, [ACB]: { pos: { x: 0, y: 8 } } },
      intents: { [HCM]: { intent: { kind: "press", targetId: ACM }, intentUntil: T0 + 30 }, [HW]: { intent: { kind: "press", targetId: ACM }, intentUntil: T0 + 25 } }
    })

  it("two live first pressers share one second-presser draw", () => {
    let s = twoLive(0)
    let draws = 0
    for (let k = 0; k < 12; k++) {
      const before = s.rng.press
      s = step(s).state
      // Precondition: both are still pressing.
      expect(livePressOn(s, ACM).map((x) => x.id).sort()).toEqual([HCM, HW].sort())
      if (JSON.stringify(s.rng.press) !== JSON.stringify(before)) draws++
    }
    // secondShare 0: one draw for the pair (it fails), never one per tick.
    expect(draws).toBe(1)
  })

  it("with two live first pressers, the second presser is a new player and no live press is extended", () => {
    const s0 = twoLive(1)
    let s = s0
    for (let k = 0; k < 5; k++) s = step(s).state
    const live = livePressOn(s, ACM)
    expect(live.map((x) => x.id).sort()).toEqual([HCM, HW, HCB].sort())
    expect(s.press?.secondId).toBe(HCB)
    // The first pressers keep their own ends.
    expect(s.players.find((x) => x.id === HCM)!.intentUntil).toBe(T0 + 30)
    expect(s.players.find((x) => x.id === HW)!.intentUntil).toBe(T0 + 25)
  })

  it("in a press surge the top two by score within 25 m press (G28)", () => {
    // CB 8 m (8 / 0.6 = 13.3), W 12 m (12), CM 13 m (13): the nearest two are CB and W, the best two by score W and CM.
    const surge: Script = { name: "surge", entries: [{ window: [0, 45], team: "home", effect: "press_surge" }] }
    const place = { [ACM]: { pos: { x: 0, y: 0 } }, [HCB]: { pos: { x: -8, y: 0 } }, [HW]: { pos: { x: 0, y: 12 } }, [HCM]: { pos: { x: 0, y: -13 } } }
    const starters = (p: Params, script?: Script): string[] =>
      livePressOn(step(fixture(forced(p, { secondShare: 0 }), { carrier: ACM, place, ...(script ? { script } : {}) })).state, ACM)
        .map((x) => x.id)
        .sort()
    // Preconditions: rule 0's surge takes the nearest two; without a surge only the best by score presses.
    expect(starters(off, surge)).toEqual([HCB, HW].sort())
    expect(starters(on)).toEqual([HW])
    expect(starters(on, surge)).toEqual([HW, HCM].sort())
  })

  it("no team press, first or second, for a side in its counter-press window", () => {
    const tr = (p: Params): Params => ({ ...p, transition: { ...p.transition, rule: 1 } })
    const p = forced(on, { secondShare: 1 })
    const place = { [ACM]: { pos: { x: 0, y: 0 } }, [HCM]: { pos: { x: -10, y: 0 } }, [HW]: { pos: { x: -6, y: -6 } }, [ACB]: { pos: { x: 0, y: 8 } } }
    // Precondition: out of a window, two press.
    expect(livePressOn(step(fixture(tr(p), { carrier: ACM, place })).state, ACM).length).toBe(2)
    // Home lost the ball at T0 with no joiners: its window is open, and nobody team-presses.
    const transition: TransitionState = { loser: "home", tick: T0, at: { x: 0, y: 0 }, joiners: [] }
    let s = fixture(tr(p), { carrier: ACM, place, transition })
    for (let k = 0; k < 20; k++) {
      s = step(s).state
      expect(livePressOn(s, ACM)).toEqual([])
    }
  })
})

describe("A5 team pressing: the keeper's hands", () => {
  it("never press a keeper with the ball in his hands", () => {
    const p = forced({ ...on, press: { ...on.press, secondShare: 1, backToGoalLift: 10, ownThirdLift: 10 } })
    // Away (defending +x in the first half) on the ball in his own box; two home attackers 8 and 9 m off.
    const run = (carrier: string, inHands: boolean): { pressed: number; held: number } => {
      const place = { [carrier]: { pos: { x: 45, y: 0 } }, [HST]: { pos: { x: 37, y: 0 } }, [HW]: { pos: { x: 45, y: 9 } }, [ACB]: { pos: { x: 45, y: -8 } } }
      let s = fixture(p, { carrier, place, inHands })
      let pressed = 0
      let held = 0
      for (let k = 0; k < 50; k++) {
        s = step(s).state
        if (s.possession.kind === "owned" && s.possession.playerId === carrier) held++
        if (livePressOn(s, carrier).length > 0) pressed++
      }
      return { pressed, held }
    }
    // Precondition: an outfield carrier there is pressed within 50 ticks.
    expect(run(ACM, false).pressed).toBeGreaterThan(0)
    const gk = run(AGK, true)
    expect(gk.held).toBe(50)
    expect(gk.pressed).toBe(0)
  })
})

describe("A5 team pressing: rule 0", () => {
  it("rule 0 ignores every press value", () => {
    const wild: Params = { ...off, press: { ...off.press, rateScale: 50, secondShare: 1, backToGoalLift: 9, ownThirdLift: 9, roleWeight: { ...WEIGHTS, CB: 0.01 } } }
    let a = initMatch(makeConfig(7, { params: off }))
    let b = initMatch(makeConfig(7, { params: wild }))
    for (let k = 0; k < 3000; k++) {
      a = step(a).state
      b = step(b).state
    }
    expect(JSON.stringify({ ...b, config: null })).toBe(JSON.stringify({ ...a, config: null }))
  })
})

describe("A5 team pressing: in matches", () => {
  /** Press intents started in a whole match, by the presser's role (DM counted as CM). */
  const presses = (p: Params, seed: number): Map<string, number> => {
    let s = initMatch(makeConfig(seed, { params: p }))
    const by = new Map<string, number>()
    const until = new Map<string, number>()
    while (!isFinished(s)) {
      s = step(s).state
      for (const pl of s.players) {
        if (pl.intent.kind !== "press") continue
        if (until.get(pl.id) === pl.intentUntil) continue
        until.set(pl.id, pl.intentUntil)
        const role = pl.role === "DM" ? "CM" : pl.role
        by.set(role, (by.get(role) ?? 0) + 1)
      }
    }
    return by
  }
  const total = (m: Map<string, number>): number => [...m.values()].reduce((a, b) => a + b, 0)
  const wide = (m: Map<string, number>): number => ((m.get("W") ?? 0) + (m.get("FB") ?? 0)) / total(m)

  it("in matches, wide players press more", () => {
    const sum = (p: Params): Map<string, number> => {
      const m = new Map<string, number>()
      for (const seed of [7, 9]) for (const [k, v] of presses(p, seed)) m.set(k, (m.get(k) ?? 0) + v)
      return m
    }
    const a = sum(off)
    const b = sum(on)
    expect(total(a)).toBeGreaterThanOrEqual(100)
    expect(total(b)).toBeGreaterThanOrEqual(100)
    expect(wide(b)).toBeGreaterThan(wide(a))
  }, 300_000)
})

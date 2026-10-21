import { describe, expect, it } from "vitest"
import type { Period, Vec2 } from "../src/geometry.js"
import { DEFAULT_PARAMS as P, type Params } from "../src/params.js"
import { dropTarget, insideTarget, invertTarget } from "../src/rotate.js"
import { initMatch, isFinished, rotateMove, step, workAt, type MoveTarget } from "../src/step.js"
import { makeConfig } from "../src/testing.js"
import type { MatchState, PlayerState, TransitionState } from "../src/types.js"

const RM = P.roleMoves
// Explicit on and off (plan 8e F26): rotations on need transition.rule 1 for the CM drop. Rates forced to 1e6 where a
// test needs the hazard to fire.
// Every other P5 rule pinned 0 (P5 Task 14 switched them on): the engine these counts were written on, rotations alone (with
// runs on, the off arm has overlap events; with the set-piece and dead-ball rules on, seed 7 has 17 inside moves for one team).
/** Every P6 rule pinned 0 (P6 Task 8 switched them on): the engine this file's counts were written on (F4). */
const p6Off = (p: Params): Params => ({
  ...p, firstTime: { ...p.firstTime, rule: 0 }, header: { ...p.header, rule: 0 }, saveGeo: { ...p.saveGeo, rule: 0 },
  execFatigue: { ...p.execFatigue, rule: 0 }, shotModel: { ...p.shotModel, rule: 0 }
})
const P5_OFF: Params = {
  ...p6Off(P),
  setAttack: { ...P.setAttack, rule: 0 }, setDefend: { ...P.setDefend, rule: 0 }, setShapes: { ...P.setShapes, rule: 0 }, deadBall: { ...P.deadBall, rule: 0 },
  keeperRestarts: { ...P.keeperRestarts, rule: 0 }, directFk: { ...P.directFk, rule: 0 },
  marking: { ...P.marking, rule: 0, landingRule: 0 }, release: { ...P.release, freeRule: 0 }
}
const mk = (rotateRule: number, transitionRule: number, rm: Partial<Params["roleMoves"]> = {}): Params => ({
  ...P5_OFF,
  transition: { ...P.transition, rule: transitionRule, pauseRule: 0 },
  roleMoves: { ...RM, rotateRule, runRule: 0, ...rm }
})
const forced = (rotateRule = 1, transitionRule = 1): Params =>
  mk(rotateRule, transitionRule, {
    inside: { ...RM.inside, ratePerS: 1e6 },
    invert: { ...RM.invert, ratePerS: 1e6 },
    cmDrop: { ...RM.cmDrop, ratePerS: 1e6 }
  })

const T0 = 200
const cfg = makeConfig(7)
const home = (role: string, n = 0): string => cfg.home.starters.filter((x) => x.role === role)[n]!.id
const HW = home("W", 0)
const HFB = home("FB", 0)
const HCB = home("CB", 0)
const HCB2 = home("CB", 1)
const HCM = home("CM", 0)
const HDM = home("DM")
const HCM2 = home("CM", 1)
const HST = home("ST")
const BASE = (target: Vec2): (() => MoveTarget) => () => ({ target, speedCap: 7 })

/** Open play: `carrier` (home unless said) holds the ball at `ball`; players named in `place` stand there, the rest far away. */
const fixture = (
  p: Params,
  dt: number,
  o: { place: Record<string, Vec2>; carrier: string; ball: Vec2; tick?: number; period?: Period; transition?: TransitionState; intents?: Record<string, PlayerState["intent"]> }
): MatchState => {
  const s0 = initMatch(makeConfig(7, { params: p, dt }))
  const tick = o.tick ?? T0
  const players = s0.players.map((pl, i): PlayerState => ({
    ...pl,
    pos: o.place[pl.id] ?? { x: pl.side === "home" ? -50 + i : 50 - i, y: -33 },
    vel: { x: 0, y: 0 },
    ...(o.intents?.[pl.id] ? { intent: o.intents[pl.id]!, intentUntil: tick + 20 } : {})
  }))
  return {
    ...s0,
    tick,
    period: o.period ?? "first_half",
    periodTick: tick,
    phase: { kind: "open_play" },
    ball: { pos: { x: o.ball.x, y: o.ball.y, z: 0 }, vel: { x: 0, y: 0, z: 0 } },
    possession: { kind: "owned", playerId: o.carrier, since: tick, restart: null },
    players,
    lastTouch: { playerId: o.carrier, side: "home" },
    ...(o.transition ? { transition: o.transition } : {})
  }
}

describe("A6 rotations: targets", () => {
  it("targets", () => {
    expect(insideTarget({ x: 25, y: 22 }, 1, 6)).toEqual({ x: 25, y: 6 })
    expect(insideTarget({ x: 25, y: -22 }, -1, 6)).toEqual({ x: 25, y: -6 })
    // W at y 26, 7 m in: |y| 19; own last u -20 + 15 = -5 beats shape u -10.
    const inv = invertTarget({ x: -10, y: 22 }, 26, 7, -20, "home", "first_half", 15)
    expect(Math.abs(inv.y)).toBe(19)
    expect(inv.x).toBe(-5)
    expect(invertTarget({ x: -10, y: -22 }, -26, 7, -20, "home", "first_half", 15).y).toBe(-19)
    // Shape deeper than the last outfielder + 15 would be is kept when it is further upfield.
    expect(invertTarget({ x: 5, y: 22 }, 26, 7, -20, "home", "first_half", 15).x).toBe(5)
    expect(dropTarget([{ x: -35, y: 10 }, { x: -35, y: -10 }], 3, "home", "first_half")).toEqual({ x: -34, y: 0 })
    // CBs 4 m apart: 3 m outside the CB on the ball's side.
    expect(dropTarget([{ x: -35, y: 2 }, { x: -35, y: -2 }], 20, "home", "first_half")).toEqual({ x: -34, y: 5 })
    expect(dropTarget([{ x: -35, y: 2 }, { x: -35, y: -2 }], -20, "home", "first_half")).toEqual({ x: -34, y: -5 })
    // The 6 m boundary: CBs exactly 6 m apart are "together" (beside); just over, between.
    expect(dropTarget([{ x: -35, y: 3 }, { x: -35, y: -3 }], 20, "home", "first_half")).toEqual({ x: -34, y: 6 })
    expect(dropTarget([{ x: -35, y: 3.01 }, { x: -35, y: -3.01 }], 20, "home", "first_half")).toEqual({ x: -34, y: 0 })
  })

  it("second half mirrors", () => {
    const a = invertTarget({ x: -10, y: 22 }, 26, 7, -20, "home", "first_half", 15)
    const b = invertTarget({ x: 10, y: 22 }, 26, 7, -20, "home", "second_half", 15)
    expect(b).toEqual({ x: -a.x, y: a.y })
    // Away attacks -x in the first half: the same u maps to the other end.
    expect(invertTarget({ x: 10, y: 22 }, 26, 7, -20, "away", "first_half", 15)).toEqual({ x: -a.x, y: a.y })
    const cbs = [{ x: -35, y: 2 }, { x: -35, y: -2 }]
    const d1 = dropTarget(cbs, 20, "home", "first_half")
    const d2 = dropTarget(cbs.map((c) => ({ x: -c.x, y: c.y })), 20, "home", "second_half")
    expect(d2).toEqual({ x: -d1.x, y: d1.y })
    // Through the seam: the mirrored fixture gives the mirrored drop.
    const tr: TransitionState = { loser: "away", tick: T0, at: { x: 0, y: 0 }, joiners: [] }
    const place = (m: number): Record<string, Vec2> => ({
      [HCB]: { x: -35 * m, y: 10 }, [HCB2]: { x: -35 * m, y: -10 }, [HCM]: { x: -25 * m, y: 5 }, [HDM]: { x: -22 * m, y: 0 }, [HCM2]: { x: -20 * m, y: -5 }, [HST]: { x: -30 * m, y: 1 }
    })
    const w1 = workAt(fixture(forced(), 0.1, { place: place(1), carrier: HST, ball: { x: -30, y: 1 }, transition: tr }))
    const w2 = workAt(fixture(forced(), 0.1, { place: place(-1), carrier: HST, ball: { x: 30, y: 1 }, period: "second_half", transition: tr }))
    const m1 = rotateMove(w1, w1.player(HCM), w1.player(HST), BASE({ x: -12, y: 13 }))!
    const m2 = rotateMove(w2, w2.player(HCM), w2.player(HST), BASE({ x: 12, y: 13 }))!
    expect(m1.target.x).toBeCloseTo(-34, 9)
    expect(m2.target.x).toBeCloseTo(34, 9)
    expect(m2.target.y).toBeCloseTo(m1.target.y, 9)
  })
})

describe("A6 rotations: the seam", () => {
  // Home plays the ball at (30, 0); the W is wide on the right, the FB behind him.
  const pair = (intents: Record<string, PlayerState["intent"]> = {}, p: Params = forced()): MatchState =>
    fixture(p, 0.1, {
      place: { [HW]: { x: 5, y: 24 }, [HFB]: { x: -28, y: 24 }, [HST]: { x: 30, y: 0 }, [HCB]: { x: -35, y: 8 } },
      carrier: HST,
      ball: { x: 30, y: 0 },
      intents
    })

  it("the W-FB pair is gated both ways", () => {
    // The W rotating inside: the FB's rotation is null (and none starts for him).
    const s1 = pair({ [HW]: { kind: "rotate", target: { x: 5, y: 6 }, since: T0 } })
    const w1 = workAt(s1)
    expect(rotateMove(w1, w1.player(HFB), w1.player(HST), BASE({ x: -28, y: 24 }))).toBeNull()
    // Nobody rotating: the FB inverts (|y| = W y minus 5..10) and the W goes inside.
    const w2 = workAt(pair())
    const inv = rotateMove(w2, w2.player(HFB), w2.player(HST), BASE({ x: -28, y: 24 }))!
    expect(inv).not.toBeNull()
    expect(Math.abs(inv.target.y)).toBeGreaterThanOrEqual(14)
    expect(Math.abs(inv.target.y)).toBeLessThanOrEqual(19)
    expect(w2.player(HFB).intent.kind).toBe("rotate")
    // With the FB inverted the W can still go inside; then the FB's rotation ends.
    const w3 = workAt(pair({ [HFB]: { kind: "rotate", target: { x: -10, y: 17 }, since: T0 } }))
    expect(rotateMove(w3, w3.player(HFB), w3.player(HST), BASE({ x: -28, y: 24 }))).not.toBeNull()
    const ins = rotateMove(w3, w3.player(HW), w3.player(HST), BASE({ x: 5, y: 24 }))!
    expect(ins).not.toBeNull()
    expect(Math.abs(ins.target.y)).toBeGreaterThanOrEqual(5)
    expect(Math.abs(ins.target.y)).toBeLessThanOrEqual(8)
    expect(rotateMove(w3, w3.player(HFB), w3.player(HST), BASE({ x: -28, y: 24 }))).toBeNull()
    expect(w3.player(HFB).intentUntil).toBeLessThanOrEqual(w3.tick)
    // The W with the ball on his flank also lets the FB invert.
    const s4 = fixture(forced(), 0.1, { place: { [HW]: { x: 5, y: 24 }, [HFB]: { x: -28, y: 24 } }, carrier: HW, ball: { x: 5, y: 24 } })
    const w4 = workAt(s4)
    expect(rotateMove(w4, w4.player(HFB), w4.player(HW), BASE({ x: -28, y: 24 }))).not.toBeNull()
    // The W tucked in (not wide) and off the ball: no inversion.
    const s5 = fixture(forced(), 0.1, { place: { [HW]: { x: 5, y: 10 }, [HFB]: { x: -28, y: 24 }, [HST]: { x: 30, y: 0 } }, carrier: HST, ball: { x: 30, y: 0 } })
    const w5 = workAt(s5)
    expect(rotateMove(w5, w5.player(HFB), w5.player(HST), BASE({ x: -28, y: 24 }))).toBeNull()
  })

  it("a rotation ends when its side loses the ball, and no one rotates with the ball deep", () => {
    const w = workAt(pair({ [HW]: { kind: "rotate", target: { x: 5, y: 6 }, since: T0 } }))
    expect(rotateMove(w, w.player(HW), w.player(HST), BASE({ x: 5, y: 24 }))!.target).toEqual({ x: 5, y: 6 })
    w.tick += 1
    w.transition = { loser: "home", tick: w.tick, at: { x: 30, y: 0 }, joiners: [] }
    expect(rotateMove(w, w.player(HW), w.player(HST), BASE({ x: 5, y: 24 }))).toBeNull()
    expect(w.player(HW).intentUntil).toBeLessThanOrEqual(w.tick)
    // No new rotation while the side is the recorded loser.
    expect(rotateMove(w, w.player(HW), w.player(HST), BASE({ x: 5, y: 24 }))).toBeNull()
    // Ball at u 10: the W does not come inside (needs u > 17.5).
    const deep = workAt(fixture(forced(), 0.1, { place: { [HW]: { x: 5, y: 24 }, [HST]: { x: 10, y: 0 } }, carrier: HST, ball: { x: 10, y: 0 } }))
    expect(rotateMove(deep, deep.player(HW), deep.player(HST), BASE({ x: 5, y: 24 }))).toBeNull()
  })

  for (const [dt, open, shut] of [[0.1, 49, 50], [0.04, 124, 125]] as const) {
    it(`the CM drop lives 5 s after a win in the own third, at ${1 / dt} Hz`, () => {
      const tr: TransitionState = { loser: "away", tick: T0, at: { x: -30, y: 0 }, joiners: [] }
      const place = { [HCB]: { x: -35, y: 10 }, [HCB2]: { x: -35, y: -10 }, [HCM]: { x: -25, y: 5 }, [HDM]: { x: -22, y: 0 }, [HCM2]: { x: -20, y: -5 }, [HST]: { x: -30, y: 1 } }
      const at = (p: Params, offset: number, ball: Vec2 = { x: -30, y: 1 }, transition: TransitionState = tr) => {
        const w = workAt(fixture(p, dt, { place, carrier: HST, ball, tick: T0 + offset, transition }))
        return rotateMove(w, w.player(HCM), w.player(HST), BASE({ x: -12, y: 13 }))
      }
      // The deepest CM/DM (HCM at u -25) drops between the CBs.
      const drop = at(forced(), open)!
      expect(drop.target.x).toBeCloseTo(-34, 9)
      expect(drop.target.y).toBeCloseTo(0, 9)
      expect(at(forced(), shut)).toBeNull()
      // Not the deepest: the DM stays.
      const w = workAt(fixture(forced(), dt, { place, carrier: HST, ball: { x: -30, y: 1 }, tick: T0 + open, transition: tr }))
      expect(rotateMove(w, w.player(HDM), w.player(HST), BASE({ x: -18, y: 0 }))).toBeNull()
      // The ball at u 0: never. Transition rule 0: never. His own side lost the ball: never.
      expect(at(forced(), open, { x: 0, y: 0 })).toBeNull()
      expect(at(forced(1, 0), open)).toBeNull()
      expect(at(forced(), open, { x: -30, y: 1 }, { ...tr, loser: "home" })).toBeNull()
    })
  }

  it("rotations are jogs", () => {
    const tr: TransitionState = { loser: "away", tick: T0, at: { x: -30, y: 0 }, joiners: [] }
    const slow = (jogMps: number): Params => ({ ...forced(), roleMoves: { ...forced().roleMoves, jogMps } })
    for (const jog of [3.5, 2]) {
      const caps: number[] = []
      const w = workAt(fixture(slow(jog), 0.1, { place: { [HW]: { x: 5, y: 24 }, [HFB]: { x: -28, y: 24 }, [HST]: { x: 30, y: 0 } }, carrier: HST, ball: { x: 30, y: 0 } }))
      caps.push(rotateMove(w, w.player(HW), w.player(HST), BASE({ x: 5, y: 24 }))!.speedCap)
      // Live: the same target, still a jog.
      caps.push(rotateMove(w, w.player(HW), w.player(HST), BASE({ x: 5, y: 24 }))!.speedCap)
      const wf = workAt(fixture(slow(jog), 0.1, { place: { [HW]: { x: 5, y: 24 }, [HFB]: { x: -28, y: 24 }, [HST]: { x: 30, y: 0 } }, carrier: HST, ball: { x: 30, y: 0 } }))
      caps.push(rotateMove(wf, wf.player(HFB), wf.player(HST), BASE({ x: -28, y: 24 }))!.speedCap)
      const wc = workAt(fixture(slow(jog), 0.1, { place: { [HCB]: { x: -35, y: 10 }, [HCB2]: { x: -35, y: -10 }, [HCM]: { x: -25, y: 5 }, [HDM]: { x: -22, y: 0 }, [HCM2]: { x: -20, y: -5 }, [HST]: { x: -30, y: 1 } }, carrier: HST, ball: { x: -30, y: 1 }, transition: tr }))
      caps.push(rotateMove(wc, wc.player(HCM), wc.player(HST), BASE({ x: -12, y: 13 }))!.speedCap)
      expect(caps).toHaveLength(4)
      for (const c of caps) expect(c).toBeLessThanOrEqual(jog)
    }
  })

  it("a loss then a regain within 4.5 s gives no resumed rotation (through step)", () => {
    // Rotation began at T0 (lasting past T0+30); home lost the ball at T0+5 and regained it at T0+12 (the other side's loss).
    const regain: TransitionState = { loser: "away", tick: T0 + 12, at: { x: 30, y: 0 }, joiners: [] }
    const s = fixture(forced(), 0.1, {
      place: { [HW]: { x: 5, y: 24 }, [HST]: { x: 30, y: 0 }, [HCB]: { x: -35, y: 8 } },
      carrier: HST,
      ball: { x: 30, y: 0 },
      tick: T0 + 15,
      transition: regain,
      intents: { [HW]: { kind: "rotate", target: { x: 5, y: 6 }, since: T0 } }
    })
    const w = workAt(s)
    expect(w.player(HW).intentUntil).toBeGreaterThan(s.tick)
    expect(rotateMove(w, w.player(HW), w.player(HST), BASE({ x: 5, y: 24 }))).toBeNull()
    // Through a real step: the old rotation is not resumed (it ends; a new one may only start fresh, with a later since).
    const next = step(s).state.players.find((x) => x.id === HW)!
    if (next.intent.kind === "rotate" && next.intent.since === T0) expect(next.intentUntil).toBeLessThanOrEqual(s.tick + 1)
    else if (next.intent.kind === "rotate") expect(next.intent.since).toBeGreaterThan(T0 + 12)
    // Control: with no change of hands since it began, the rotation lives.
    const w2 = workAt({ ...s, transition: { ...regain, tick: T0 - 3 } })
    expect(rotateMove(w2, w2.player(HW), w2.player(HST), BASE({ x: 5, y: 24 }))!.target).toEqual({ x: 5, y: 6 })
  })

  it("rule off returns null and draws nothing", () => {
    const tr: TransitionState = { loser: "away", tick: T0, at: { x: -30, y: 0 }, joiners: [] }
    const w = workAt(fixture(forced(0), 0.1, { place: { [HW]: { x: 5, y: 24 }, [HFB]: { x: -28, y: 24 }, [HCM]: { x: -25, y: 5 }, [HCB]: { x: -35, y: 5 }, [HST]: { x: 30, y: 0 } }, carrier: HST, ball: { x: 30, y: 0 }, transition: tr }))
    const before = w.rng.roles.state
    for (const id of [HW, HFB, HCM]) expect(rotateMove(w, w.player(id), w.player(HST), BASE({ x: 0, y: 0 }))).toBeNull()
    expect(w.rng.roles.state).toEqual(before)
    expect(w.events).toHaveLength(0)
    expect(w.players).toEqual(workAt(fixture(forced(0), 0.1, { place: { [HW]: { x: 5, y: 24 }, [HFB]: { x: -28, y: 24 }, [HCM]: { x: -25, y: 5 }, [HCB]: { x: -35, y: 5 }, [HST]: { x: 30, y: 0 } }, carrier: HST, ball: { x: 30, y: 0 }, transition: tr })).players)
  })
})

describe("A6 rotations: in matches", () => {
  const count = (p: Params, seed: number): Record<string, number> => {
    let s: MatchState = initMatch(makeConfig(seed, { params: p }))
    const n: Record<string, number> = {}
    while (!isFinished(s)) {
      const r = step(s)
      s = r.state
      for (const e of r.events) if (e.type === "off_ball_run") n[`${e.team_id}:${String(e.attrs.kind)}`] = (n[`${e.team_id}:${String(e.attrs.kind)}`] ?? 0) + 1
    }
    return n
  }
  for (const seed of [7, 9]) {
    it(`rotations appear (seed ${seed}); off has none`, () => {
      // The test's own pinned inside and CM-drop rates (the default is tuned in P5's measure step).
      const on = count(mk(1, 1, { inside: { ...RM.inside, ratePerS: 0.3 }, cmDrop: { ...RM.cmDrop, ratePerS: 0.5 } }), seed)
      // Per-team-match minimums: each team meets them.
      for (const team of [cfg.home.id, cfg.away.id]) {
        expect(on[`${team}:inside`] ?? 0).toBeGreaterThanOrEqual(20)
        expect(on[`${team}:invert`] ?? 0).toBeGreaterThanOrEqual(10)
        expect(on[`${team}:cm_drop`] ?? 0).toBeGreaterThanOrEqual(15)
      }
      const off = count(mk(0, 1), seed)
      for (const k of Object.keys(off)) expect(k).toMatch(/:in_behind$/)
    }, 300_000)
  }
})

import { createHash } from "node:crypto"
import { describe, expect, it } from "vitest"
import { attackX, dist, type Period, type Vec2 } from "../src/geometry.js"
import { vmaxFor } from "../src/kinematics.js"
import { DEFAULT_PARAMS as P, type Params } from "../src/params.js"
import { substream } from "../src/rng.js"
import { initMatch, inCounterWindow, isFinished, noteLoss, step, transitionMove, workAt, type MoveTarget } from "../src/step.js"
import { makeConfig } from "../src/testing.js"
import { joinChance, pauseTarget, recoverRamp, recoverRate } from "../src/transition.js"
import { CONCERNS, type MatchState, type PlayerState, type Possession, type TransitionState } from "../src/types.js"

// Explicit on and off (F4): Task 10 flips the defaults. Everything else as the defaults.
const off: Params = { ...P, transition: { ...P.transition, rule: 0 } }
// P4's pause (pauseRule 0): P5's pause and its ramp (plan 8e ruling 20) are transition-p5.test's.
const on: Params = { ...P, transition: { ...P.transition, rule: 1, pauseRule: 0 } }
/** Every losing outfielder within 30 m joins (forced joins, for fixtures that need joiners). */
const allJoin: Params = { ...on, transition: { ...on.transition, joinP: [1, 1, 1, 1, 1] } }
const T = on.transition
const T0 = 200

const BASE: MoveTarget = { target: { x: 1, y: 2 }, speedCap: 7 }

interface Place {
  readonly pos: Vec2
  readonly vel?: Vec2
  readonly sentOff?: boolean
}

/**
 * Open play at tick `tick` (period `period`): an away player holds the ball at `ball`, home has just lost it. Players
 * named in `place` stand there; every other player stands far away (the corner flags' side), still.
 */
const fixture = (
  p: Params,
  dt: number,
  o: {
    place: Record<string, Place>
    carrier: string
    ball: Vec2
    tick?: number
    period?: Period
    inHands?: boolean
    /** The ball loose (no owner) instead of at the carrier's feet. */
    loose?: boolean
    transition?: TransitionState
    seed?: number
  }
): MatchState => {
  const s0 = initMatch(makeConfig(o.seed ?? 7, { params: p, dt }))
  const tick = o.tick ?? T0
  const players = s0.players.map((pl, i): PlayerState => {
    const q = o.place[pl.id]
    // Everyone not placed: on the touchline far from the ball (over 30 m), standing.
    const far = { x: pl.side === "home" ? -50 + i : 50 - i, y: -33 }
    return { ...pl, pos: q?.pos ?? far, vel: q?.vel ?? { x: 0, y: 0 }, sentOff: q?.sentOff ?? false }
  })
  const possession: Possession = o.loose ? { kind: "loose" } : { kind: "owned", playerId: o.carrier, since: tick, restart: null, ...(o.inHands ? { inHands: true, holdTicks: 100 } : {}) }
  const carrier = players.find((x) => x.id === o.carrier)!
  return {
    ...s0,
    tick,
    period: o.period ?? "first_half",
    periodTick: tick,
    phase: { kind: "open_play" },
    ball: { pos: { x: o.ball.x, y: o.ball.y, z: 0 }, vel: { x: 0, y: 0, z: 0 } },
    possession,
    players,
    lastTouch: { playerId: carrier.id, side: carrier.side },
    rng: o.seed !== undefined ? { ...s0.rng, counter: substream(o.seed, "counter") } : s0.rng,
    ...(o.transition ? { transition: o.transition } : {})
  }
}

const cfg = makeConfig(7)
const home = (role: string, n = 0): string => cfg.home.starters.filter((x) => x.role === role)[n]!.id
const away = (role: string, n = 0): string => cfg.away.starters.filter((x) => x.role === role)[n]!.id
const HGK = home("GK")
const HCM = home("CM")
const HCM2 = home("CM", 1)
const HCB = home("CB")
const HST = home("ST")
const ACM = away("CM")
const AGK = away("GK")

describe("A4 transitions: pure helpers", () => {
  it("join chance by distance at the loss", () => {
    expect(joinChance(3, T)).toBe(0.8)
    expect(joinChance(7, T)).toBe(0.3)
    expect(joinChance(12, T)).toBe(0.23)
    expect(joinChance(17, T)).toBe(0.13)
    expect(joinChance(25, T)).toBe(0.07)
    expect(joinChance(31, T)).toBe(0)
  })

  it("recovery ramp: 0 before 2.5 s, 1 over 5-6 s, 0 from 8 s", () => {
    expect(recoverRamp(2, T)).toBe(0)
    expect(recoverRamp(3.75, T)).toBeCloseTo(0.5, 12)
    expect(recoverRamp(5.5, T)).toBe(1)
    expect(recoverRamp(7, T)).toBeCloseTo(0.5, 12)
    expect(recoverRamp(8, T)).toBe(0)
  })

  it("pause target: one second ahead on the current velocity, at no more than the current speed or pauseShare of top speed", () => {
    const r = pauseTarget({ x: 10, y: 5 }, { x: 3, y: 0 }, 8, T)
    expect(r.target).toEqual({ x: 13, y: 5 })
    expect(r.speedCap).toBe(3)
    expect(pauseTarget({ x: 0, y: 0 }, { x: 6, y: 0 }, 8, T).speedCap).toBeCloseTo(0.55 * 8, 12)
  })
})

describe("A4 transitions: the seam", () => {
  it("noteLoss draws joiners from losing outfielders only, on the counter stream", () => {
    // GK and a sent-off CM stand 1 m from the ball (chance 0.8 if they counted), as do a CB and an ST.
    const place = (): Record<string, Place> => ({
      [ACM]: { pos: { x: 0, y: 0 } },
      [HGK]: { pos: { x: 1, y: 0 } },
      [HCM]: { pos: { x: -1, y: 0 }, sentOff: true },
      [HCB]: { pos: { x: 0, y: 1 } },
      [HST]: { pos: { x: 0, y: -1 } }
    })
    let joins = 0
    for (let seed = 1; seed <= 200; seed++) {
      const s = fixture(on, 0.1, { place: place(), carrier: ACM, ball: { x: 0, y: 0 }, seed })
      const run = () => {
        const w = workAt(s)
        const before = Object.fromEntries(CONCERNS.map((c) => [c, w.rng[c].state]))
        noteLoss(w, "home", { x: 0, y: 0 })
        for (const c of CONCERNS) if (c !== "counter") expect(w.rng[c].state).toEqual(before[c])
        expect(w.rng.counter.state).not.toEqual(before.counter)
        return w.transition!
      }
      const tr = run()
      expect(tr.loser).toBe("home")
      expect(tr.tick).toBe(s.tick)
      expect(tr.joiners).not.toContain(HGK)
      expect(tr.joiners).not.toContain(HCM)
      for (const id of tr.joiners) expect(s.players.find((x) => x.id === id)!.side).toBe("home")
      expect(run().joiners).toEqual(tr.joiners)
      joins += tr.joiners.length
    }
    // Non-vacuous: the CB and ST at 1 m join about 0.8 of the time each.
    expect(joins).toBeGreaterThan(250)
  })

  it("a later loss copes with a joiner substituted off since (his id has left the player list)", () => {
    const s = fixture(allJoin, 0.1, { place: { [ACM]: { pos: { x: 0, y: 0 } }, [HCB]: { pos: { x: 0, y: 1 } } }, carrier: ACM, ball: { x: 0, y: 0 } })
    const w = workAt({ ...s, transition: { loser: "home", tick: s.tick - 5, at: { x: 0, y: 0 }, joiners: ["home-fc-gone", HCB] } })
    expect(w.players.some((x) => x.id === "home-fc-gone")).toBe(false)
    noteLoss(w, "home", { x: 0, y: 0 })
    expect(w.transition!.joiners).toContain(HCB)
  })

  it("noteLoss under off draws nothing and leaves no transition", () => {
    const s = fixture(off, 0.1, { place: { [ACM]: { pos: { x: 0, y: 0 } }, [HCB]: { pos: { x: 0, y: 1 } } }, carrier: ACM, ball: { x: 0, y: 0 } })
    const w = workAt(s)
    const before = w.rng.counter.state
    noteLoss(w, "home", { x: 0, y: 0 })
    expect(w.transition).toBeUndefined()
    expect(w.rng.counter.state).toEqual(before)
  })

  for (const [dt, open, shut] of [[0.1, 29, 30], [0.04, 74, 75]] as const) {
    it(`the window is 3 s at ${1 / dt} Hz`, () => {
      const s = fixture(on, dt, { place: { [ACM]: { pos: { x: 0, y: 0 } }, [HCB]: { pos: { x: 0, y: 1 } } }, carrier: ACM, ball: { x: 0, y: 0 } })
      const w = workAt(s)
      noteLoss(w, "home", { x: 0, y: 0 })
      expect(w.transition!.tick).toBe(s.tick)
      w.tick = s.tick + open
      expect(inCounterWindow(w, "home")).toBe(true)
      expect(inCounterWindow(w, "away")).toBe(false)
      w.tick = s.tick + shut
      expect(inCounterWindow(w, "home")).toBe(false)
      // Off: never.
      const wo = workAt({ ...fixture(off, dt, { place: {}, carrier: ACM, ball: { x: 0, y: 0 } }), transition: w.transition! })
      wo.tick = s.tick
      expect(inCounterWindow(wo, "home")).toBe(false)
    })
  }

  for (const [dt, held, freed] of [[0.1, 14, 15], [0.04, 37, 38]] as const) {
    it(`joiners press at 4.5 m/s; far non-joiners hold course for 1.5 s (dt ${dt})`, () => {
      const tr: TransitionState = { loser: "home", tick: T0, at: { x: 0, y: 0 }, joiners: [HCB] }
      const place = {
        [ACM]: { pos: { x: 0, y: 0 } },
        [HCB]: { pos: { x: -4, y: 0 } },
        [HCM]: { pos: { x: 20, y: 0 }, vel: { x: 3, y: 0 } },
        [HCM2]: { pos: { x: 0, y: 6 }, vel: { x: 3, y: 0 } }
      }
      const at = (offset: number) => workAt(fixture(on, dt, { place, carrier: ACM, ball: { x: 0, y: 0 }, tick: T0 + offset, transition: tr }))
      // Joiner.
      const wj = at(5)
      const j = transitionMove(wj, wj.player(HCB), BASE, "away")
      expect(j).not.toBe(BASE)
      expect(j.speedCap).toBeLessThanOrEqual(4.5)
      // Far non-joiner: the "cap 3" case needs 0.55 vmax >= 3.
      const w1 = at(held)
      const cm = w1.player(HCM)
      expect(T.pauseShare * vmaxFor(cm, cm.energy, on)).toBeGreaterThanOrEqual(3)
      const m = transitionMove(w1, cm, BASE, "away")
      expect(m.target).toEqual({ x: 23, y: 0 })
      expect(m.speedCap).toBeCloseTo(3, 12)
      const w2 = at(freed)
      expect(transitionMove(w2, w2.player(HCM), BASE, "away")).toBe(BASE)
      // Near non-joiner (6 m): base.
      const w3 = at(held)
      expect(transitionMove(w3, w3.player(HCM2), BASE, "away")).toBe(BASE)
    })
  }

  it("no counter-press on a keeper with the ball in his hands", () => {
    // Away keeper in his box (first half: away defends +x), the ball in his hands; a home joiner 3 m away.
    const gkAt = { x: 48, y: 0 }
    const place = { [AGK]: { pos: gkAt }, [HST]: { pos: { x: 45, y: 0 } } }
    const tr: TransitionState = { loser: "home", tick: T0, at: gkAt, joiners: [HST] }
    // Outfield-carrier twin: the joiner presses (non-vacuous).
    const twin = workAt(fixture(allJoin, 0.1, { place: { [ACM]: { pos: gkAt }, [HST]: { pos: { x: 45, y: 0 } } }, carrier: ACM, ball: gkAt, tick: T0 + 3, transition: tr }))
    const pr = transitionMove(twin, twin.player(HST), BASE, "away")
    expect(pr).not.toBe(BASE)
    expect(pr.speedCap).toBe(4.5)
    const w = workAt(fixture(allJoin, 0.1, { place, carrier: AGK, ball: gkAt, tick: T0 + 3, inHands: true, transition: tr }))
    expect(transitionMove(w, w.player(HST), BASE, "away")).toBe(BASE)

    // G8: a loss to a keeper's catch gives joiners but no press intents on him; the outfield twin gets them.
    const caught = workAt(fixture(allJoin, 0.1, { place, carrier: AGK, ball: gkAt, inHands: true }))
    noteLoss(caught, "home", gkAt)
    expect(caught.transition!.joiners).toContain(HST)
    for (const o of caught.players) expect(o.intent.kind === "press" && caught.tick < o.intentUntil && o.intent.targetId === AGK).toBe(false)
    const won = workAt(fixture(allJoin, 0.1, { place: { [ACM]: { pos: gkAt }, [HST]: { pos: { x: 45, y: 0 } } }, carrier: ACM, ball: gkAt }))
    noteLoss(won, "home", gkAt)
    const st = won.player(HST)
    expect(st.intent).toEqual({ kind: "press", targetId: ACM })
    expect(st.intentUntil).toBe(won.tick + 30)
  })

  it("recovery: only from 2.5 s (forced rate 50, dt 0.1 and 0.04)", () => {
    const forced: Params = { ...on, transition: { ...on.transition, recoverRatePerS: 50 } }
    for (const dt of [0.1, 0.04]) {
      // A non-joiner 8 m from the ball (inside the pause radius), upfield of it.
      const place = { [ACM]: { pos: { x: 0, y: 0 } }, [HST]: { pos: { x: 8, y: 0 } } }
      const tr: TransitionState = { loser: "home", tick: T0, at: { x: 0, y: 0 }, joiners: [] }
      const w = workAt(fixture(forced, dt, { place, carrier: ACM, ball: { x: 0, y: 0 }, transition: tr }))
      let first = -1
      for (let k = 0; k <= Math.round(4 / dt); k++) {
        w.tick = T0 + k
        transitionMove(w, w.player(HST), BASE, "away")
        const st = w.player(HST)
        if (first < 0 && st.intent.kind === "recover" && w.tick < st.intentUntil) first = k
      }
      expect(first).toBeGreaterThan(0)
      expect(first * dt).toBeGreaterThan(2.5)
    }
  })

  it("recovery: likelier upfield of the ball (exact rate ratio, and draws at rate 0.5 over 4000 seeds)", () => {
    expect(recoverRate(5.5, 0, T)).toBe(T.recoverRatePerS)
    expect(recoverRate(5.5, -10, T)).toBe(T.recoverRatePerS)
    expect(recoverRate(5.5, -10.5, T) / recoverRate(5.5, 5, T)).toBeCloseTo(T.recoverBehindFactor, 12)
    expect(recoverRate(2, 5, T)).toBe(0)

    const half: Params = { ...on, transition: { ...on.transition, recoverRatePerS: 0.5 } }
    // Ball at x 0 (home attacks +x): the ST 8 m upfield, the CB 15 m goal-side; both a single tick at 5.5 s.
    const place = { [ACM]: { pos: { x: 0, y: 0 } }, [HST]: { pos: { x: 8, y: 0 } }, [HCB]: { pos: { x: -15, y: 0 } } }
    const tr: TransitionState = { loser: "home", tick: T0, at: { x: 0, y: 0 }, joiners: [] }
    let up = 0
    let back = 0
    for (let seed = 1; seed <= 4000; seed++) {
      const s = fixture(half, 0.1, { place, carrier: ACM, ball: { x: 0, y: 0 }, tick: T0 + 55, transition: tr, seed })
      const w = workAt(s)
      transitionMove(w, w.player(HST), BASE, "away")
      if (w.player(HST).intent.kind === "recover") up++
      const w2 = workAt(s)
      transitionMove(w2, w2.player(HCB), BASE, "away")
      if (w2.player(HCB).intent.kind === "recover") back++
    }
    // Expected about 195 and 66.
    expect(up).toBeGreaterThan(150)
    expect(back / up).toBeGreaterThan(0.25)
    expect(back / up).toBeLessThan(0.42)
  })

  for (const period of ["first_half", "second_half"] as const) {
    it(`recovery runs toward the own goal (${period})`, () => {
      const forced: Params = { ...on, transition: { ...on.transition, recoverRatePerS: 50 } }
      // The ST 25 m upfield of the ball in home's frame.
      const d = period === "first_half" ? 1 : -1
      const place = { [ACM]: { pos: { x: 0, y: 0 } }, [HST]: { pos: { x: 25 * d, y: 5 } } }
      const tr: TransitionState = { loser: "home", tick: T0, at: { x: 0, y: 0 }, joiners: [] }
      const w = workAt(fixture(forced, 0.1, { place, carrier: ACM, ball: { x: 0, y: 0 }, tick: T0 + 55, transition: tr, period }))
      const st0 = w.player(HST)
      const r = transitionMove(w, st0, BASE, "away")
      const st = w.player(HST)
      expect(st.intent.kind).toBe("recover")
      expect(r.speedCap).toBeCloseTo(T.recoverSpeedShare * vmaxFor(st, st.energy, forced), 12)
      expect(st.intentUntil - w.tick).toBeGreaterThanOrEqual(Math.round(T.recoverS[0] / 0.1))
      expect(st.intentUntil - w.tick).toBeLessThanOrEqual(Math.round(T.recoverS[1] / 0.1))
      expect(attackX("home", r.target.x, period)).toBeLessThan(attackX("home", st.pos.x, period))
    })
  }

  it("a loser chasing a loose ball keeps chasing it: no recovery run starts or carries on (forced rate 50 at 5.5 s)", () => {
    const forced: Params = { ...on, transition: { ...on.transition, recoverRatePerS: 50 } }
    // The ST 2 m upfield of the ball: home's nearest to it, so one of moveTarget's two loose-ball chasers.
    const place = { [ACM]: { pos: { x: -6, y: 0 } }, [HST]: { pos: { x: 2, y: 0 } } }
    const tr: TransitionState = { loser: "home", tick: T0, at: { x: 0, y: 0 }, joiners: [] }
    const at = (loose: boolean, seed: number) =>
      workAt(fixture(forced, 0.1, { place, carrier: ACM, ball: { x: 0, y: 0 }, tick: T0 + 55, transition: tr, loose, seed }))
    let owned = 0
    for (let seed = 1; seed <= 20; seed++) {
      // Precondition: with the ball at the opponent's feet the same player starts a run (hazard 0.993 a tick).
      const wo = at(false, seed)
      transitionMove(wo, wo.player(HST), BASE, "away")
      if (wo.player(HST).intent.kind === "recover") owned++
      // Loose: he keeps chasing (base), and no run starts.
      const wl = at(true, seed)
      expect(transitionMove(wl, wl.player(HST), BASE, null)).toBe(BASE)
      expect(wl.player(HST).intent.kind).not.toBe("recover")
    }
    expect(owned).toBeGreaterThanOrEqual(18)
    // A run already under way ends when he becomes a chaser.
    const wr = at(true, 1)
    wr.setPlayer({ ...wr.player(HST), intent: { kind: "recover", target: { x: -30, y: 0 } }, intentUntil: wr.tick + 20 })
    expect(transitionMove(wr, wr.player(HST), BASE, null)).toBe(BASE)
    expect(wr.player(HST).intentUntil).toBe(wr.tick)
  })

  it("rule off returns base unchanged", () => {
    const tr: TransitionState = { loser: "home", tick: T0, at: { x: 0, y: 0 }, joiners: [HCB] }
    const place = { [ACM]: { pos: { x: 0, y: 0 } }, [HCB]: { pos: { x: -4, y: 0 } }, [HCM]: { pos: { x: 20, y: 0 }, vel: { x: 3, y: 0 } } }
    // Precondition: the same fixture under on moves both.
    const won = workAt(fixture(on, 0.1, { place, carrier: ACM, ball: { x: 0, y: 0 }, tick: T0 + 5, transition: tr }))
    expect(transitionMove(won, won.player(HCB), BASE, "away")).not.toBe(BASE)
    expect(transitionMove(won, won.player(HCM), BASE, "away")).not.toBe(BASE)
    const w = workAt(fixture(off, 0.1, { place, carrier: ACM, ball: { x: 0, y: 0 }, tick: T0 + 5, transition: tr }))
    expect(transitionMove(w, w.player(HCB), BASE, "away")).toBe(BASE)
    expect(transitionMove(w, w.player(HCM), BASE, "away")).toBe(BASE)
  })
})

describe("A4 transitions at half-time (P4 final review)", () => {
  it("a loss in the last 8 s of the first half carries nothing into the second-half kickoff", () => {
    // Shipped defaults (every P4 rule as it ships). Seeds 1-6, played to 8 s into the second half; at least one must lose
    // the ball in the last 8 s of the first half (non-vacuous; the review's probe found seed 2 at 0.4 s).
    let late = 0
    for (const seed of [1, 2, 3, 4, 5, 6]) {
      let s: MatchState = initMatch(makeConfig(seed, { params: on }))
      let last: MatchState = s
      while (!isFinished(s) && s.period === "first_half") {
        last = s
        s = step(s).state
      }
      expect(s.period).toBe("second_half")
      if (last.transition && (last.tick - last.transition.tick) * last.config.dt < 8) late++
      // At the second-half kickoff: no transition, no press state.
      expect(s.transition, `seed ${seed}`).toBeUndefined()
      expect(s.press, `seed ${seed}`).toBeUndefined()
      // No joiner press and no recovery run is live at the kickoff (the first-half loss's joiners are gone).
      for (const pl of s.players) expect((pl.intent.kind === "press" || pl.intent.kind === "recover") && s.tick < pl.intentUntil, `seed ${seed} ${pl.id}`).toBe(false)
      const start = s.tick
      for (let i = 0; i < Math.round(8 / s.config.dt) && !isFinished(s); i++) {
        s = step(s).state
        // Anything live comes from a loss in the second half itself.
        const fresh = s.transition !== undefined && s.transition.tick >= start
        if (!fresh) {
          expect(s.transition, `seed ${seed}`).toBeUndefined()
          for (const pl of s.players) {
            // No recovery run, and (with no transition) the team press is not switched off by a counter-press window.
            expect(pl.intent.kind === "recover" && s.tick < pl.intentUntil, `seed ${seed} ${pl.id} recovering`).toBe(false)
          }
        }
      }
    }
    expect(late).toBeGreaterThanOrEqual(1)
  }, 600_000)
})

describe("A4 transitions in a match", () => {
  it("rule 0 is inert: a match is identical whatever the other transition values (seed 7, 6000 ticks)", () => {
    const perturbed: Params = {
      ...P,
      transition: {
        rule: 0, windowS: 10, joinM: [10, 20, 30, 40, 50], joinP: [1, 1, 1, 1, 1], speed: 1, pauseS: 10, pauseShare: 0.1, pauseRadiusM: 1,
        recoverFromS: 0, recoverPeakS: [0.5, 1], recoverToS: 20, recoverRatePerS: 50, recoverBehindFactor: 1, recoverUpfieldM: 5, recoverS: [5, 6], recoverSpeedShare: 0.2,
        pauseRule: 0, pauseDip: 0.2, pauseEndS: 3
      }
    }
    const hash = (p: Params): { h: string; losses: number } => {
      const md = createHash("sha256")
      let s: MatchState = initMatch(makeConfig(7, { params: p }))
      let losses = 0
      for (let i = 0; i < 6000 && !isFinished(s); i++) {
        const r = step(s)
        s = r.state
        md.update(JSON.stringify(r.frame)).update(JSON.stringify(r.events))
        losses += r.events.filter((e) => e.type === "possession_change").length
        expect(s.transition).toBeUndefined()
      }
      return { h: md.digest("hex"), losses }
    }
    const a = hash(off)
    // Non-vacuous: live-play losses happen in the window (each would draw joiners under rule 1). 6000 ticks (Task 10):
    // with every P4 rule on, 1500 ticks held only 4 possession changes.
    expect(a.losses).toBeGreaterThan(10)
    expect(hash(perturbed).h).toBe(a.h)
  })

  for (const dt of [0.1, 0.04]) {
    it(`losses draw about two joiners (seed 7, dt ${dt}); no counter-presser targets a keeper holding the ball`, () => {
      let s: MatchState = initMatch(makeConfig(7, { params: on, dt }))
      let losses = 0
      let joiners = 0
      while (!isFinished(s) && losses < 150) {
        const prev = s
        s = step(s).state
        if (s.transition && s.transition !== prev.transition && s.transition.tick === s.tick) {
          losses++
          joiners += s.transition.joiners.length
          for (const id of s.transition.joiners) {
            const pl = s.players.find((x) => x.id === id)!
            expect(pl.side).toBe(s.transition.loser)
            expect(pl.role).not.toBe("GK")
            // His distance when noteLoss ran (Task 10): a loss in ownedTick (a tackle) comes before this tick's movement,
            // so his position in the previous state; an interception and a loose-ball recovery resolve in ballTick, after
            // the movement, so his position now (P4 final review). Measured after the step regardless, joiners were seen
            // at 30.002 and 30.26 m.
            const afterMove = prev.possession.kind === "in_flight" || prev.possession.kind === "loose"
            const atLoss = afterMove ? pl : (prev.players.find((x) => x.id === id) ?? pl)
            expect(dist(atLoss.pos, s.transition.at)).toBeLessThan(30)
          }
        }
        const poss = s.possession
        if (poss.kind === "owned" && poss.inHands)
          for (const o of s.players) expect(o.intent.kind === "press" && s.tick < o.intentUntil && o.intent.targetId === poss.playerId).toBe(false)
      }
      expect(losses).toBeGreaterThanOrEqual(50)
      const mean = joiners / losses
      expect(mean).toBeGreaterThanOrEqual(1.5)
      expect(mean).toBeLessThanOrEqual(3.5)
    }, 300_000)
  }
})

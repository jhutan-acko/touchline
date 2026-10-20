/**
 * P5 pause and its end (realism v2 P5, plan 8e Task 12, ruling 20): under transition.pauseRule 1 a paused player's cap is
 * min(base cap, pauseDip x his speed at the loss), and over pauseEndS after the pause his target is base's while his cap
 * ramps linearly from the pause cap to base's. Press trigger lifts stay multiplicative (ruling 21, values only).
 */
import { createHash } from "node:crypto"
import { describe, expect, it } from "vitest"
import type { Period, Vec2 } from "../src/geometry.js"
import { vmaxFor } from "../src/kinematics.js"
import { DEFAULT_PARAMS as P, type Params } from "../src/params.js"
import { pressLift } from "../src/press.js"
import { initMatch, isFinished, noteLoss, step, transitionMove, workAt, type MoveTarget } from "../src/step.js"
import { makeConfig } from "../src/testing.js"
import { pauseCap, pauseEndCap, pauseTarget, windowTicks } from "../src/transition.js"
import type { MatchState, PlayerState, Possession, TransitionState } from "../src/types.js"

// Explicit fixtures (F26): P4's transition switched on; the P5 pause off or on, at the spec's pauseDip 0.87 and
// pauseEndS 0.5 (pinned here: Task 12 tunes the default pauseDip).
const off: Params = { ...P, transition: { ...P.transition, rule: 1, pauseRule: 0, pauseDip: 0.87, pauseEndS: 0.5 } }
const on: Params = { ...P, transition: { ...off.transition, pauseRule: 1 } }
const T = on.transition
const T0 = 200
const BASE: MoveTarget = { target: { x: 1, y: 2 }, speedCap: 7 }

interface Place {
  readonly pos: Vec2
  readonly vel?: Vec2
}

/** Open play at `tick`: away's `carrier` has the ball at `ball`, home has just lost it; unplaced players stand far away, still. */
const fixture = (p: Params, dt: number, o: { place: Record<string, Place>; carrier: string; ball: Vec2; tick?: number; period?: Period; transition?: TransitionState }): MatchState => {
  const s0 = initMatch(makeConfig(7, { params: p, dt }))
  const tick = o.tick ?? T0
  const players = s0.players.map((pl, i): PlayerState => {
    const q = o.place[pl.id]
    const far = { x: pl.side === "home" ? -50 + i : 50 - i, y: -33 }
    return { ...pl, pos: q?.pos ?? far, vel: q?.vel ?? { x: 0, y: 0 }, sentOff: false }
  })
  const possession: Possession = { kind: "owned", playerId: o.carrier, since: tick, restart: null }
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
    ...(o.transition ? { transition: o.transition } : {})
  }
}

const cfg = makeConfig(7)
const home = (role: string, n = 0): string => cfg.home.starters.filter((x) => x.role === role)[n]!.id
const away = (role: string, n = 0): string => cfg.away.starters.filter((x) => x.role === role)[n]!.id
const HCM = home("CM")
const HCB = home("CB")
const HGK = home("GK")
const ACM = away("CM")

// HCM, 20 m from the ball, moved 4 m/s at the loss and has slowed to 3 m/s since (P4 would cap him at 3).
const place = { [ACM]: { pos: { x: 0, y: 0 } }, [HCM]: { pos: { x: 20, y: 0 }, vel: { x: 3, y: 0 } } }
const tr: TransitionState = { loser: "home", tick: T0, at: { x: 0, y: 0 }, joiners: [], speeds: { [HCM]: 4 } }
const at = (p: Params, dt: number, offset: number) => workAt(fixture(p, dt, { place, carrier: ACM, ball: { x: 0, y: 0 }, tick: T0 + offset, transition: tr }))

describe("P5 pause: pure helpers", () => {
  it("pauseCap is pauseDip x the speed at the loss; pauseEndCap ramps linearly over pauseEndS", () => {
    expect(pauseCap(4, T)).toBeCloseTo(3.48, 12)
    expect(pauseCap(0, T)).toBe(0)
    expect(pauseEndCap(0, 3.48, 7, T)).toBeCloseTo(3.48, 12)
    expect(pauseEndCap(0.25, 3.48, 7, T)).toBeCloseTo(5.24, 12)
    expect(pauseEndCap(0.5, 3.48, 7, T)).toBe(7)
    expect(pauseEndCap(0.9, 3.48, 7, T)).toBe(7)
    expect(pauseEndCap(-0.1, 3.48, 7, T)).toBeCloseTo(3.48, 12)
  })
})

describe("P5 pause: the transition seam", () => {
  for (const dt of [0.1, 0.04]) {
    it(`the pause caps at 0.87 of the speed at the loss (dt ${dt})`, () => {
      // noteLoss records each losing outfielder's speed only under pauseRule 1.
      const fresh = (p: Params) => workAt(fixture(p, dt, { place: { ...place, [HCM]: { pos: { x: 20, y: 0 }, vel: { x: 4, y: 0 } }, [HCB]: { pos: { x: -5, y: 3 }, vel: { x: 0, y: -2 } } }, carrier: ACM, ball: { x: 0, y: 0 } }))
      const wOn = fresh(on)
      noteLoss(wOn, "home", { x: 0, y: 0 })
      const sp = wOn.transition!.speeds!
      expect(sp[HCM]).toBeCloseTo(4, 12)
      expect(sp[HCB]).toBeCloseTo(2, 12)
      expect(sp[HGK]).toBeUndefined()
      const wOff = fresh(off)
      noteLoss(wOff, "home", { x: 0, y: 0 })
      expect(wOff.transition!.speeds).toBeUndefined()
      // Same joiners (the counter draws are unchanged).
      expect(wOn.transition!.joiners).toEqual(wOff.transition!.joiners)

      // During the pause: P4's hold-course target, cap min(base cap, 0.87 x 4) = 3.48 (P4 would give 3).
      const pauseTicks = windowTicks(T.pauseS, dt)
      for (const k of [1, Math.floor(pauseTicks / 2), pauseTicks - 1]) {
        const w = at(on, dt, k)
        const cm = w.player(HCM)
        const m = transitionMove(w, cm, BASE, "away")
        expect(m.target).toEqual({ x: 23, y: 0 })
        expect(m.speedCap).toBeCloseTo(3.48, 12)
        // A base cap below the pause cap wins.
        expect(transitionMove(at(on, dt, k), cm, { ...BASE, speedCap: 2 }, "away").speedCap).toBe(2)
      }
      // Precondition: P4 gives a different cap on the same fixture.
      const w4 = at(off, dt, 1)
      expect(transitionMove(w4, w4.player(HCM), BASE, "away").speedCap).toBeCloseTo(3, 12)
    })

    it(`the pause ends on a ramp (dt ${dt})`, () => {
      const end = windowTicks(T.pauseS, dt)
      const rampTicks = windowTicks(T.pauseEndS, dt)
      const pc = 0.87 * 4
      let prev = -Infinity
      for (let k = 0; k < rampTicks; k++) {
        const w = at(on, dt, end + k)
        const m = transitionMove(w, w.player(HCM), BASE, "away")
        // Base's target throughout; the cap is linear in the seconds since the pause ended (sinceS = ticks x dt).
        expect(m.target).toEqual(BASE.target)
        expect(m.speedCap).toBeCloseTo(pauseEndCap(k * dt, pc, BASE.speedCap, T), 12)
        expect(m.speedCap).toBeGreaterThanOrEqual(prev)
        prev = m.speedCap
      }
      // + 0: the pause cap.
      const w0 = at(on, dt, end)
      expect(transitionMove(w0, w0.player(HCM), BASE, "away").speedCap).toBeCloseTo(pc, 12)
      // + 0.25 s: halfway to base, within half a tick of the ramp (F28: 0.6 at dt 0.1, 0.48 at dt 0.04).
      const half = windowTicks(0.25, dt)
      const wh = at(on, dt, end + half)
      const frac = (transitionMove(wh, wh.player(HCM), BASE, "away").speedCap - pc) / (BASE.speedCap - pc)
      expect(Math.abs(frac - 0.5)).toBeLessThanOrEqual(dt / (2 * T.pauseEndS) + 1e-9)
      // + 0.5 s: base's.
      const we = at(on, dt, end + rampTicks)
      expect(transitionMove(we, we.player(HCM), BASE, "away")).toEqual(BASE)
      // A near player (within pauseRadiusM) is never paused, so he gets no ramp.
      const near = workAt(fixture(on, dt, { place: { ...place, [HCM]: { pos: { x: 6, y: 0 }, vel: { x: 3, y: 0 } } }, carrier: ACM, ball: { x: 0, y: 0 }, tick: T0 + end + 1, transition: tr }))
      expect(transitionMove(near, near.player(HCM), BASE, "away")).toBe(BASE)
      // A joiner gets no ramp either.
      const wj = workAt(fixture(on, dt, { place, carrier: ACM, ball: { x: 0, y: 0 }, tick: T0 + end + 1, transition: { ...tr, joiners: [HCM] } }))
      expect(transitionMove(wj, wj.player(HCM), BASE, "away").target).not.toEqual(BASE.target)
    })
  }

  it("pauseRule 0 keeps P4's pause", () => {
    // P4's pause, verbatim: hold course at min(current speed, pauseShare x vmax), then base; the P5 fields are ignored.
    const perturbed: Params = { ...off, transition: { ...off.transition, pauseDip: 0.3, pauseEndS: 2 } }
    for (const dt of [0.1, 0.04]) {
      const end = windowTicks(T.pauseS, dt)
      for (const p of [off, perturbed]) {
        for (let k = 1; k < end + windowTicks(2, dt); k++) {
          const w = at(p, dt, k)
          const cm = w.player(HCM)
          const got = transitionMove(w, cm, BASE, "away")
          if (k < end) expect(got).toEqual(pauseTarget(cm.pos, cm.vel, vmaxFor(cm, cm.energy, p), p.transition))
          else expect(got).toBe(BASE)
        }
      }
    }
  })

  it("pauseRule 0 is byte-identical in a match whatever pauseDip and pauseEndS are", () => {
    const perturbed: Params = { ...off, transition: { ...off.transition, pauseDip: 0.3, pauseEndS: 2 } }
    const hash = (p: Params): { h: string; losses: number } => {
      const md = createHash("sha256")
      let s: MatchState = initMatch(makeConfig(7, { params: p }))
      let losses = 0
      for (let i = 0; i < 3000 && !isFinished(s); i++) {
        const r = step(s)
        s = r.state
        md.update(JSON.stringify(r.frame)).update(JSON.stringify(r.events))
        losses += r.events.filter((e) => e.type === "possession_change").length
        if (s.transition && p.transition.pauseRule <= 0) expect(s.transition.speeds).toBeUndefined()
      }
      return { h: md.digest("hex"), losses }
    }
    const a = hash(off)
    expect(a.losses).toBeGreaterThan(5)
    expect(hash(perturbed).h).toBe(a.h)
    // Non-vacuous: the same match under pauseRule 1 differs.
    expect(hash(on).h).not.toBe(a.h)
  }, 300_000)
})

describe("P5 press lifts (ruling 21, values only)", () => {
  // Not expected to fail before Task 12 (F28): a regression guard on the multiplicative lifts.
  it("press lifts stay multiplicative", () => {
    const pr = { ...P.press, rule: 1, backToGoalLift: 3, ownThirdLift: 3 }
    expect(pressLift(true, true, pr)).toBe(9)
    expect(pressLift(true, false, pr)).toBe(3)
    expect(pressLift(false, true, pr)).toBe(3)
    expect(pressLift(false, false, pr)).toBe(1)
  })
})

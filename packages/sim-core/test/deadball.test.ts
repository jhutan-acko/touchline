import { beforeAll, describe, expect, it } from "vitest"
import { restartDelayS, settleS, walkCap } from "../src/deadball.js"
import { dist, type Vec2 } from "../src/geometry.js"
import { vmaxFor } from "../src/kinematics.js"
import { DEFAULT_PARAMS as P, type DeadKey, type Params } from "../src/params.js"
import { Rng, seedRng } from "../src/rng.js"
import { setPieceKind } from "../src/setpiece.js"
import { deadMove, initMatch, isFinished, planDead, restartDelayTicks, step, takerReady, workAt, type MoveTarget } from "../src/step.js"
import { makeConfig } from "../src/testing.js"
import type { DomainEvent, MatchState, PlayerState, RestartKind } from "../src/types.js"

// Explicit on and off (F4): Task 14 flips the defaults. Everything else as the defaults.
const off: Params = { ...P, deadBall: { ...P.deadBall, rule: 0 } }
const on: Params = { ...P, deadBall: { ...P.deadBall, rule: 1 } }
const D = on.deadBall
const KEYS: ReadonlyArray<DeadKey> = ["throw_in", "goal_kick", "corner", "free_kick_att", "free_kick", "kickoff"]
/** The real median delays (s) from the set-pieces report, written out so a params change cannot move the target. */
const REAL_MEDIAN_S: Readonly<Record<DeadKey, number>> = { throw_in: 13.5, goal_kick: 22, corner: 33, free_kick_att: 42, free_kick: 28, kickoff: 70 }

const median = (xs: ReadonlyArray<number>): number => {
  const s = [...xs].sort((a, b) => a - b)
  const m = s.length >> 1
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2
}
const quantile = (xs: ReadonlyArray<number>, q: number): number => [...xs].sort((a, b) => a - b)[Math.floor(q * (xs.length - 1))]!

const cfg = makeConfig(7)
const home = (role: string, n = 0): string => cfg.home.starters.filter((x) => x.role === role)[n]!.id
/** The resume tick of the taker-pause fixtures. */
const R = 1500

/**
 * A home throw-in being set up at `at` (first half, pitch coordinates), resuming at `resume`, the state one tick before
 * `tick`. Players named in `place` stand there; everyone else stands far from the spot (the other touchline), still.
 */
const restartState = (
  p: Params,
  dt: number,
  o: { at: Vec2; restart?: RestartKind; tick: number; resume: number; place: Record<string, Vec2>; seed?: number }
): MatchState => {
  const s0 = initMatch(makeConfig(o.seed ?? 7, { params: p, dt }))
  const players = s0.players.map((pl, i): PlayerState => {
    const far = { x: pl.side === "home" ? -45 + 4 * (i % 11) : 45 - 4 * (i % 11), y: 30 }
    return { ...pl, pos: o.place[pl.id] ?? far, vel: { x: 0, y: 0 } }
  })
  return {
    ...s0,
    tick: o.tick - 1,
    periodTick: o.tick - 1,
    phase: { kind: "restart", restart: o.restart ?? "throw_in", side: "home", at: o.at, resumeTick: o.resume },
    ball: { pos: { x: o.at.x, y: o.at.y, z: 0 }, vel: { x: 0, y: 0, z: 0 } },
    possession: { kind: "dead" },
    players
  }
}

/** The state with the dead-ball plan the seam draws for its restart (resuming at its phase's resumeTick). */
const withPlan = (s: MatchState): MatchState => {
  const w = workAt({ ...s, tick: s.tick + 1 })
  const ph = s.phase
  if (ph.kind !== "restart") throw new Error("not a restart")
  const kind = setPieceKind(ph.restart, ph.at, ph.side, "first_half")
  w.restartPlan = { kind, ...planDead(w, ph, kind, ph.resumeTick) }
  return { ...s, rng: { ...s.rng, dead: w.rng.dead.state }, restartPlan: w.restartPlan }
}

/** Step `s` until a set_piece event or `max` steps; the event and every state before it. */
const runToKick = (s0: MatchState, max: number, each?: (s: MatchState, i: number) => MatchState): { kick: DomainEvent | null; states: MatchState[] } => {
  let s = s0
  const states: MatchState[] = []
  for (let i = 0; i < max; i++) {
    if (each) s = each(s, i)
    const r = step(s)
    const kick = r.events.find((e) => e.type === "set_piece") ?? null
    if (kick) return { kick, states }
    s = r.state
    states.push(s)
  }
  return { kick: null, states }
}

describe("S8 delays (deadball.ts)", () => {
  it("lognormal delays at the real medians", () => {
    const d = { ...D, lateGrowth: 0 }
    for (const key of KEYS) {
      const rng = new Rng(seedRng(1000 + KEYS.indexOf(key)))
      const xs = Array.from({ length: 4000 }, () => restartDelayS(key, 45, d, rng))
      expect(Math.abs(median(xs) / REAL_MEDIAN_S[key] - 1), key).toBeLessThan(0.04)
      expect(Math.min(...xs), key).toBeGreaterThanOrEqual(d.minS)
      if (key === "throw_in") {
        expect(Math.abs(quantile(xs, 0.25) / 8 - 1)).toBeLessThan(0.15)
        expect(Math.abs(quantile(xs, 0.75) / 20 - 1)).toBeLessThan(0.15)
      }
    }
  })

  it("delays lengthen through the match and keep the median", () => {
    const d = { ...D, lateGrowth: 0.6 }
    const at = (minute: number, seed: number) => {
      const rng = new Rng(seedRng(seed))
      return median(Array.from({ length: 4000 }, () => restartDelayS("corner", minute, d, rng)))
    }
    // The same draws at minutes 85 and 5: the factor is (1 + 0.6 x 0.444) / (1 - 0.6 x 0.444) = 1.727.
    const ratio = at(85, 3) / at(5, 3)
    expect(ratio).toBeGreaterThan(1.65)
    expect(ratio).toBeLessThan(1.8)
    for (const key of KEYS) {
      const rng = new Rng(seedRng(2000 + KEYS.indexOf(key)))
      const minutes = new Rng(seedRng(3000))
      const xs = Array.from({ length: 4000 }, () => restartDelayS(key, minutes.range(0, 90), d, rng))
      expect(Math.abs(median(xs) / REAL_MEDIAN_S[key] - 1), key).toBeLessThan(0.05)
    }
  })

  it("free kicks split by the attacking third", () => {
    // Home attacks +x in the first half: x 30 is u 30 (attacking third), x 0 is u 0.
    const delayFor = (p: Params, x: number, restart: RestartKind = "free_kick") => {
      const s = restartState(p, 0.1, { at: { x, y: 5 }, restart, tick: 3000, resume: 3000, place: {} })
      const w = workAt(s)
      const dead = new Rng(w.rng.dead.state)
      const old = new Rng(w.rng.restart.state)
      return { ticks: restartDelayTicks(w, { restart, side: "home", at: { x, y: 5 } }), minute: w.minute(), dead, old }
    }
    const att = delayFor(on, 30)
    expect(att.ticks).toBe(Math.round(restartDelayS("free_kick_att", att.minute, D, att.dead) / 0.1))
    const mid = delayFor(on, 0)
    expect(mid.ticks).toBe(Math.round(restartDelayS("free_kick", mid.minute, D, mid.dead) / 0.1))
    expect(att.ticks).not.toBe(mid.ticks)
    // A penalty keeps the old restart-stream draw: the same delay as under rule 0 on the same state.
    const pen = delayFor(on, 41.5, "penalty")
    const penOff = delayFor(off, 41.5, "penalty")
    expect(pen.ticks).toBe(penOff.ticks)
    expect(pen.ticks).toBe(Math.round((P.timing.restartDelayS.penalty * pen.old.range(0.7, 1.3)) / 0.1))
  })
})

describe("S8 walking into place", () => {
  it("players walk at 1-1.5 m/s and arrive by their deadline", () => {
    expect(walkCap(5, 20, 1.2, 8)).toBeCloseTo(1.2, 9)
    expect(walkCap(30, 10, 1.2, 8)).toBeCloseTo(3, 9)
    expect(walkCap(80, 1, 1.2, 8)).toBeCloseTo(6.4, 9)
    // The deadline reached (F29): no division, the cap is 0.8 x vmax.
    expect(walkCap(10, 0, 1.2, 8)).toBeCloseTo(6.4, 9)
    expect(walkCap(10, -3, 1.2, 8)).toBeCloseTo(6.4, 9)

    // The plan: every player on the pitch walks at U(1, 1.5) m/s and settles by his deadline before the resume tick.
    const s = withPlan(restartState(on, 0.1, { at: { x: 49, y: 34 }, restart: "corner", tick: 1000, resume: 1330, place: {} }))
    const plan = s.restartPlan!
    for (const pl of s.players) {
      expect(plan.walkMps![pl.id]).toBeGreaterThanOrEqual(1)
      expect(plan.walkMps![pl.id]).toBeLessThanOrEqual(1.5)
      // At a corner attackers settle 6-7 s before the kick, defenders 13-19 s.
      const before = (1330 - plan.readyTick![pl.id]!) * 0.1
      const [lo, hi] = pl.side === "home" ? D.settleAttS : D.settleDefS
      expect(before).toBeGreaterThanOrEqual(lo - 0.05)
      expect(before).toBeLessThanOrEqual(hi + 0.05)
    }
    expect(plan.pauseTicks).toBeGreaterThanOrEqual(5)
    expect(plan.pauseTicks).toBeLessThanOrEqual(10)
    // settleS: elsewhere U(2.5, 3.5) for both sides.
    const r = new Rng(seedRng(5))
    for (let i = 0; i < 200; i++) {
      const x = settleS("throw_mid", i % 2 === 0, D, r)
      expect(x).toBeGreaterThanOrEqual(2.5)
      expect(x).toBeLessThan(3.5)
    }
  })

  for (const dt of [0.1, 0.04]) {
    it(`a player walks to arrive by his deadline, not before it (dt ${dt})`, () => {
      // The taker 15 m from the spot, his deadline 6 s away, walking 1.2 m/s: he needs 2.5 m/s and arrives about on time.
      const taker = home("CM")
      const T = 2000
      const s0 = restartState(on, dt, { at: { x: 10, y: -34 }, tick: T, resume: T + Math.round(20 / dt), place: { [taker]: { x: 10, y: -19 } } })
      const deadline = T + Math.round(6 / dt)
      const s = { ...s0, restartPlan: { kind: "throw_mid" as const, walkMps: { [taker]: 1.2 }, readyTick: { [taker]: deadline }, pauseTicks: 5 } }
      const w = workAt({ ...s, tick: T })
      const pl = w.player(taker)
      const vmax = vmaxFor(pl, pl.energy, on)
      const mt: MoveTarget = { target: { x: 10, y: -34 }, speedCap: vmax * 0.8 }
      expect(deadMove(w, pl, mt).speedCap).toBeCloseTo(walkCap(15, (deadline - T) * dt, 1.2, vmax), 9)
      expect(deadMove(w, pl, mt).speedCap).toBeCloseTo(2.5, 1)
      // The deadline within one tick (F29): 0.8 x vmax.
      const late = workAt({ ...s, tick: deadline - 1 })
      expect(deadMove(late, late.player(taker), mt).speedCap).toBeCloseTo(0.8 * vmax, 9)

      let cur: MatchState = s
      let peak = 0
      let atHalf = 0
      while (cur.tick < deadline + Math.round(1 / dt)) {
        cur = step(cur).state
        const me = cur.players.find((x) => x.id === taker)!
        peak = Math.max(peak, Math.hypot(me.vel.x, me.vel.y))
        if (cur.tick === T + Math.round(3 / dt)) atHalf = dist(me.pos, { x: 10, y: -34 })
      }
      const me = cur.players.find((x) => x.id === taker)!
      expect(dist(me.pos, { x: 10, y: -34 })).toBeLessThan(1)
      // Walking, not sprinting: halfway there at half time, never near 0.8 x vmax.
      expect(atHalf).toBeGreaterThan(5)
      expect(peak).toBeLessThan(4)
    })
  }
})

describe("S8 the taker's pause", () => {
  for (const [dt, lo, hi] of [[0.1, 5, 10], [0.04, 13, 25]] as const) {
    it(`the taker pauses 0.5-1 s on the spot (${Math.round(1 / dt)} Hz)`, () => {
      const taker = home("CM")
      const pauses: number[] = []
      for (let seed = 1; seed <= 12; seed++) {
        const s = withPlan(restartState(on, dt, { at: { x: 10, y: -34 }, tick: R, resume: R, place: { [taker]: { x: 10, y: -34 } }, seed }))
        const { kick, states } = runToKick(s, 60)
        expect(kick).not.toBeNull()
        expect(kick!.player_id).toBe(taker)
        const waited = kick!.frame_id - R
        expect(waited).toBe(s.restartPlan!.pauseTicks)
        expect(waited).toBeGreaterThanOrEqual(lo)
        expect(waited).toBeLessThanOrEqual(hi)
        // The phase stays restart throughout the pause.
        for (const x of states) expect(x.phase.kind).toBe("restart")
        pauses.push(waited)
      }
      expect(new Set(pauses).size).toBeGreaterThan(1)
      // Under off the same taker kicks at the resume tick.
      const s = restartState(off, dt, { at: { x: 10, y: -34 }, tick: R, resume: R, place: { [taker]: { x: 10, y: -34 } } })
      expect(runToKick(s, 60).kick!.frame_id).toBe(R)
    })
  }

  it("a taker sent off during the pause: the restart is re-picked and still taken", () => {
    const taker = home("CM")
    const next = home("CM", 1)
    const s = withPlan(restartState(on, 0.1, { at: { x: 10, y: -34 }, tick: R, resume: R, place: { [taker]: { x: 10, y: -34 }, [next]: { x: 10, y: -28 } } }))
    expect(s.restartPlan!.pauseTicks).toBeGreaterThan(3)
    let arrived = -1
    const { kick } = runToKick(s, 300, (x, i) => {
      // Two ticks into his pause the taker is sent off.
      if (i === 3) return { ...x, players: x.players.map((pl) => (pl.id === taker ? { ...pl, sentOff: true } : pl)) }
      if (i > 3 && arrived < 0 && x.restartPlan?.arrivedId === next) arrived = x.restartPlan.arrivedTick!
      return x
    })
    expect(kick).not.toBeNull()
    expect(kick!.player_id).toBe(next)
    // The new taker's own pause: from his arrival, not the old taker's.
    expect(arrived).toBeGreaterThan(R + 2)
    expect(kick!.frame_id - arrived).toBe(s.restartPlan!.pauseTicks)
  })

  it("a teammate crossing the spot during the pause does not take over or restart it", () => {
    const taker = home("CM")
    const mate = home("CM", 1)
    // The taker stands 0.6 m off the spot; two ticks into his pause a teammate steps onto it (nearer the ball).
    const s = withPlan(restartState(on, 0.1, { at: { x: 10, y: -34 }, tick: R, resume: R, place: { [taker]: { x: 10.6, y: -34 }, [mate]: { x: 10, y: -20 } } }))
    const { kick } = runToKick(s, 60, (x, i) =>
      i === 2 ? { ...x, players: x.players.map((pl) => (pl.id === mate ? { ...pl, pos: { x: 10, y: -34 } } : pl)) } : x
    )
    expect(kick).not.toBeNull()
    expect(kick!.player_id).toBe(taker)
    expect(kick!.frame_id - R).toBe(s.restartPlan!.pauseTicks)
  })
})

describe("S8 kickoffs and rule off", () => {
  it("rule off keeps today's delay and speeds", () => {
    const s = restartState(off, 0.1, { at: { x: 10, y: -34 }, tick: 3000, resume: 3000, place: {} })
    for (const restart of ["throw_in", "corner", "goal_kick", "free_kick", "kickoff", "penalty"] as const) {
      const w = workAt(s)
      const old = new Rng(w.rng.restart.state)
      expect(restartDelayTicks(w, { restart, side: "home", at: { x: 10, y: -34 } })).toBe(Math.round((P.timing.restartDelayS[restart] * old.range(0.7, 1.3)) / 0.1))
      expect(w.rng.dead.state).toEqual(s.rng.dead)
      expect(planDead(w, { restart, side: "home", at: { x: 10, y: -34 } }, "throw_mid", 3100)).toEqual({})
      expect(w.rng.dead.state).toEqual(s.rng.dead)
    }
    const w = workAt({ ...s, restartPlan: { kind: "throw_mid", walkMps: { [home("CM")]: 1 }, readyTick: { [home("CM")]: 3100 }, pauseTicks: 7 } })
    const mt: MoveTarget = { target: { x: 0, y: 0 }, speedCap: 5 }
    expect(deadMove(w, w.player(home("CM")), mt)).toBe(mt)
    const ph = w.phase
    if (ph.kind !== "restart") throw new Error("not a restart")
    expect(takerReady(w, ph, { ...w.player(home("CM")), pos: { x: 10.5, y: -34 } })).toBe(true)
  })

  it("rule on without a plan (the period kickoffs): today's pace and readiness", () => {
    const s = restartState(on, 0.1, { at: { x: 0, y: 0 }, restart: "kickoff", tick: 3000, resume: 3000, place: {} })
    const w = workAt(s)
    const mt: MoveTarget = { target: { x: 0, y: 0 }, speedCap: 5 }
    expect(deadMove(w, w.player(home("CM")), mt)).toBe(mt)
    const ph = w.phase
    if (ph.kind !== "restart") throw new Error("not a restart")
    expect(takerReady(w, ph, { ...w.player(home("ST")), pos: { x: 0.5, y: 0 } })).toBe(true)
    expect(w.restartPlan).toBeUndefined()
  })

  it("the opening and second-half kickoffs (no plan) run under on exactly as under off", () => {
    /** The period kickoffs of seed 7 under `p`: each set_piece's tick and the players' positions and speeds up to it. */
    const kickoffs = (p: Params) => {
      const out: Array<{ tick: number; period: string; trace: string }> = []
      let s = initMatch(makeConfig(7, { params: p }))
      for (const half of ["first_half", "second_half"]) {
        // The second half: the first half due at once, so the next step ends it and sets up the kickoff (endPeriod).
        if (half === "second_half") s = { ...s, periodTick: s.periodTicks }
        const trace: string[] = []
        for (let i = 0; i < 300; i++) {
          const r = step(s)
          s = r.state
          expect(s.restartPlan).toBeUndefined()
          trace.push(JSON.stringify(s.players.map((x) => [x.pos, x.vel])))
          const kick = r.events.find((e) => e.type === "set_piece" && e.attrs.kind === "kickoff" && e.period === half)
          if (kick) {
            out.push({ tick: kick.frame_id, period: kick.period, trace: trace.join("|") })
            break
          }
        }
      }
      return out
    }
    const a = kickoffs(off)
    const b = kickoffs(on)
    expect(a.map((x) => x.period)).toEqual(["first_half", "second_half"])
    expect(b.map((x) => [x.tick, x.period])).toEqual(a.map((x) => [x.tick, x.period]))
    expect(b.map((x) => x.trace)).toEqual(a.map((x) => x.trace))
  })
})

/** A player moves at this speed or more (m/s); slower, he is standing in place (the dead-speed metric's "moving players"). */
const MOVING_MPS = 0.5

interface Spell {
  readonly restart: RestartKind
  /** Seconds from the ball going dead to the set_piece event, and the delay planned (to the resume tick). */
  readonly s: number
  readonly planned: number
  /** The moving outfielders' mean speed over the spell (m/s): per tick over those at MOVING_MPS or more, then over the ticks with any. */
  readonly speed: number
}

/** The dead spells of `seed`'s match under `p` (from open play to the kick); the period kickoffs are excluded. */
const deadSpells = (p: Params, seed: number): Spell[] => {
  let s = initMatch(makeConfig(seed, { params: p }))
  const out: Spell[] = []
  let open: { restart: RestartKind; tick: number; resume: number; speeds: number[] } | null = null
  let wasOpen = false
  while (!isFinished(s)) {
    const period = s.period
    const r = step(s)
    s = r.state
    const ph = s.phase
    if (open && r.events.some((e) => e.type === "set_piece")) {
      const dt = s.config.dt
      const speed = open.speeds.length > 0 ? open.speeds.reduce((a, b) => a + b, 0) / open.speeds.length : 0
      out.push({ restart: open.restart, s: (s.tick - open.tick) * dt, planned: (open.resume - open.tick) * dt, speed })
      open = null
    }
    if (ph.kind === "restart" && wasOpen && !open && s.period === period) open = { restart: ph.restart, tick: s.tick, resume: ph.resumeTick, speeds: [] }
    if (open && ph.kind === "restart") {
      const moving = s.players.filter((x) => !x.sentOff && x.role !== "GK").map((x) => Math.hypot(x.vel.x, x.vel.y)).filter((v) => v >= MOVING_MPS)
      if (moving.length > 0) open.speeds.push(moving.reduce((a, b) => a + b, 0) / moving.length)
    }
    wasOpen = ph.kind === "open_play"
  }
  return out
}

describe("S8 in a match (on; seeds 7 and 9)", () => {
  // One match per seed, shared by the cases below.
  let spells: Spell[] = []
  beforeAll(() => {
    spells = [...deadSpells(on, 7), ...deadSpells(on, 9)]
  }, 600_000)

  // Phase B ruling: the real metric's definition, the median over restarts of the moving players' mean speed, against the
  // real band 1.0-1.5 m/s (not against off, which already moves its players at 1.19 m/s on this engine).
  it("in a match, players walk into place at 1.0-1.5 m/s while the ball is dead", () => {
    expect(spells.length).toBeGreaterThan(40)
    expect(median(spells.map((x) => x.speed))).toBeGreaterThanOrEqual(1.0)
    expect(median(spells.map((x) => x.speed))).toBeLessThanOrEqual(1.5)
  })

  it("in a match, every kick waits only the taker's pause past its delay", () => {
    const late = spells.map((x) => x.s - x.planned)
    expect(median(late)).toBeGreaterThanOrEqual(0.5)
    expect(median(late)).toBeLessThanOrEqual(1.0)
  })

  // Phase B ruling: the throw-in median on two seeds' throw-ins, not seed 7's 14 alone.
  it("in a match, the median throw-in dead time is 11-16 s", () => {
    const throws = spells.filter((x) => x.restart === "throw_in").map((x) => x.s)
    expect(throws.length).toBeGreaterThan(20)
    expect(median(throws)).toBeGreaterThanOrEqual(11)
    expect(median(throws)).toBeLessThanOrEqual(16)
  })
})

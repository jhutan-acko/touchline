import { describe, expect, it } from "vitest"
import { decide, restartKindShift, type Decision, type DecisionInput } from "../src/decide.js"
import type { Vec2 } from "../src/geometry.js"
import { DEFAULT_PARAMS as P, type Params } from "../src/params.js"
import { Rng, seedRng } from "../src/rng.js"
import { setPieceKind } from "../src/setpiece.js"
import { initMatch, keeperRestart, keeperTakes, longKickScale, planKeeper, step, workAt } from "../src/step.js"
import { kickoffPlayersFor, makeConfig, STYLES } from "../src/testing.js"
import type { DomainEvent, MatchState, PlayerState, RestartKind } from "../src/types.js"

// Explicit arms (never DEFAULT_PARAMS as "off").
const arm = (rule: number, o: Partial<Params["keeperRestarts"]> = {}): Params => ({ ...P, keeperRestarts: { ...P.keeperRestarts, rule, ...o } })
const off = arm(0)
const on = arm(1, { fkShare: 1 })

const cfg = makeConfig(7)
const gkId = cfg.home.starters.find((x) => x.role === "GK")!.id

/** A home free kick being set up at `at` (first half: home attacks +x, so u = x), resuming soon, with G3's plan drawn. */
const freeKick = (p: Params, at: Vec2, o: { seed?: number; restart?: RestartKind; gkOff?: boolean } = {}): MatchState => {
  const s0 = initMatch(makeConfig(o.seed ?? 7, { params: p }))
  const restart = o.restart ?? "free_kick"
  const players = o.gkOff ? s0.players.map((pl) => (pl.id === gkId ? { ...pl, sentOff: true } : pl)) : s0.players
  const s: MatchState = {
    ...s0,
    tick: 100,
    periodTick: 100,
    players,
    phase: { kind: "restart", restart, side: "home", at, resumeTick: 110 },
    ball: { pos: { x: at.x, y: at.y, z: 0 }, vel: { x: 0, y: 0, z: 0 } },
    possession: { kind: "dead" }
  }
  const w = workAt(s)
  const ph = w.phase
  if (ph.kind !== "restart") throw new Error("not a restart")
  const kind = setPieceKind(ph.restart, ph.at, ph.side, "first_half")
  const plan = { kind, ...planKeeper(w, ph, kind) }
  return { ...s, rng: { ...s.rng, dead: w.rng.dead.state }, restartPlan: plan }
}

/** Step until the set_piece event (or `max` steps); the event and the states before it. */
const runToKick = (s0: MatchState, max = 1500): { kick: DomainEvent | null; states: MatchState[] } => {
  let s = s0
  const states: MatchState[] = []
  for (let i = 0; i < max; i++) {
    const r = step(s)
    const kick = r.events.find((e) => e.type === "set_piece") ?? null
    if (kick) return { kick, states }
    s = r.state
    states.push(s)
  }
  return { kick: null, states }
}

const takes = (s: MatchState): boolean => {
  const w = workAt(s)
  const ph = w.phase
  return ph.kind === "restart" && keeperTakes(w, ph)
}

describe("G3: keeper free kicks (keeper-restart seam)", () => {
  it("the keeper takes own-third free kicks", () => {
    // u -30 (own third): the home GK takes it.
    const deep = freeKick(on, { x: -30, y: 5 })
    expect(deep.restartPlan?.keeperTaker).toBe(true)
    const k1 = runToKick(deep)
    expect(k1.kick?.player_id).toBe(gkId)
    // takerFor is stable across ticks: every state before the kick still says the keeper takes it.
    expect(k1.states.length).toBeGreaterThan(5)
    for (const s of k1.states.filter((x) => x.phase.kind === "restart")) expect(takes(s)).toBe(true)

    // u -10 (not own third): an outfielder.
    const mid = runToKick(freeKick(on, { x: -10, y: 5 }))
    expect(mid.kick).not.toBeNull()
    expect(mid.kick?.player_id).not.toBe(gkId)

    // Under off: an outfielder at u -30 too (precondition for the rule's effect).
    const offKick = runToKick(freeKick(off, { x: -30, y: 5 }))
    expect(offKick.kick).not.toBeNull()
    expect(offKick.kick?.player_id).not.toBe(gkId)

    // fkShare 0: never, over many seeds.
    const never = arm(1, { fkShare: 0 })
    for (let seed = 1; seed <= 40; seed++) {
      const s = freeKick(never, { x: -30, y: 5 }, { seed })
      expect(s.restartPlan?.keeperTaker ?? false).toBe(false)
      expect(takes(s)).toBe(false)
    }
  })

  it("planKeeper draws once per restart on the dead stream, only for own-third free kicks", () => {
    for (const share of [0, 0.5, 1]) {
      const p = arm(1, { fkShare: share })
      for (let seed = 1; seed <= 20; seed++) {
        const before = initMatch(makeConfig(seed, { params: p })).rng.dead
        const s = freeKick(p, { x: -30, y: 5 }, { seed })
        const twin = new Rng(before)
        const expected = twin.chance(share)
        expect(s.rng.dead).toEqual(twin.state)
        expect(s.restartPlan?.keeperTaker ?? false).toBe(expected)
        // The choice holds over the restart: keeperTakes reads the plan and draws nothing.
        const w = workAt(s)
        const ph = w.phase
        if (ph.kind !== "restart") throw new Error("not a restart")
        for (let i = 0; i < 5; i++) expect(keeperTakes(w, ph)).toBe(expected)
        expect(w.rng.dead.state).toEqual(twin.state)
      }
    }
    // No draw outside the own third, at other restarts, or under off.
    const noDraw = (p: Params, at: Vec2, restart?: RestartKind) => {
      const before = initMatch(makeConfig(7, { params: p })).rng.dead
      const s = freeKick(p, at, restart ? { restart } : {})
      expect(s.rng.dead).toEqual(before)
      expect(s.restartPlan?.keeperTaker).toBeUndefined()
    }
    noDraw(on, { x: -10, y: 5 })
    noDraw(on, { x: -30, y: 34 }, "throw_in")
    noDraw(on, { x: -47, y: 0 }, "goal_kick")
    noDraw(off, { x: -30, y: 5 })
  })

  it("with the keeper sent off an outfielder takes it", () => {
    const s = freeKick(on, { x: -30, y: 5 }, { gkOff: true })
    const { kick } = runToKick(s)
    expect(kick).not.toBeNull()
    expect(kick?.player_id).not.toBe(gkId)
    const taker = s.players.find((x) => x.id === kick?.player_id)!
    expect(taker.role).not.toBe("GK")
  })

  it("a keeper free kick uses the build-up row", () => {
    // Precondition: under off the same free kick is not a keeper restart.
    expect(keeperRestart(workAt(freeKick(off, { x: -30, y: 5 })))).toBe(false)
    expect(keeperRestart(workAt(freeKick(on, { x: -30, y: 5 })))).toBe(true)
    expect(keeperRestart(workAt(freeKick(on, { x: -10, y: 5 })))).toBe(false)
  })
})

// ---------------------------------------------------------------- the goal-kick choice (decide.ts goal-kick block)

const players = kickoffPlayersFor(makeConfig(1))
const at = (pl: PlayerState, x: number, y: number): PlayerState => ({ ...pl, pos: { x, y }, vel: { x: 0, y: 0 } })
const home = players.filter((x) => x.side === "home")
const away = players.filter((x) => x.side === "away")
const keeper = at(home.find((x) => x.role === "GK")!, -47, 0)
// Targets at 15 m (two CBs wide of the box) and 45 m (forwards near halfway), the rest in between; opponents far away.
const teammates = home.map((x, i) =>
  x.id === keeper.id ? keeper : x.role === "CB" ? at(x, -42, i % 2 ? 14 : -14) : x.role === "ST" || x.role === "W" ? at(x, -2, -20 + 6 * i) : at(x, -25, -24 + 5 * i)
)
const opponents = away.map((x, i) => at(x, 20 + i, -30 + 6 * i))
const gkInput = (o: Partial<DecisionInput> = {}): DecisionInput => ({
  period: "first_half", owner: keeper, teammates, opponents, style: STYLES.possession, scoreDiff: 0, minute: 30, restart: "goal_kick", scriptBias: {}, ...o
})
const longShare = (d: Decision): number => (d.actionProbs.long_pass ?? 0) + (d.actionProbs.switch ?? 0)

describe("G3: the goal-kick short/long choice", () => {
  it("long shift moves goal kicks long", () => {
    const s0 = decide(gkInput(), arm(1, { longShift: 0 }), new Rng(seedRng(3)))
    const s1 = decide(gkInput(), arm(1, { longShift: 1 }), new Rng(seedRng(3)))
    // Precondition: both kinds are on offer.
    expect(s0.actionProbs.short_pass ?? 0).toBeGreaterThan(0)
    expect(longShare(s0)).toBeGreaterThan(0)
    expect(longShare(s1)).toBeGreaterThan(longShare(s0))
    // +1 on both long logits multiplies the long-against-rest odds by e (within actionProbs' 3-decimal rounding).
    const odds = (x: number) => x / (1 - x)
    expect(Math.abs(odds(longShare(s1)) / odds(longShare(s0)) / Math.E - 1)).toBeLessThan(0.06)
    // The shift is longShift on long_pass and switch only, at goal kicks and keeper free kicks.
    const p = arm(1, { longShift: 1 })
    expect(restartKindShift(gkInput(), "long_pass", p)).toBe(1)
    expect(restartKindShift(gkInput(), "switch", p)).toBe(1)
    expect(restartKindShift(gkInput(), "short_pass", p)).toBe(0)
    expect(restartKindShift(gkInput({ restart: "free_kick" }), "long_pass", p)).toBe(1)
    // 0 for open play, for an outfielder's free kick, for other restarts and under off.
    expect(restartKindShift(gkInput({ restart: null }), "long_pass", p)).toBe(0)
    const cb = teammates.find((x) => x.role === "CB")!
    expect(restartKindShift(gkInput({ restart: "free_kick", owner: cb }), "long_pass", p)).toBe(0)
    expect(restartKindShift(gkInput({ restart: "throw_in" }), "long_pass", p)).toBe(0)
    expect(restartKindShift(gkInput(), "long_pass", arm(0, { longShift: 1 }))).toBe(0)
  })

  it("rule off: the decision is unchanged", () => {
    // off with a long shift set equals the rule-0 decision with none: same rng draws, same actionProbs and pick.
    const r0 = new Rng(seedRng(5))
    const r1 = new Rng(seedRng(5))
    for (let i = 0; i < 50; i++) {
      const a = decide(gkInput(), arm(0, { longShift: 1.5 }), r0)
      const b = decide(gkInput(), arm(0, { longShift: 0 }), r1)
      expect(a).toEqual(b)
    }
    expect(r0.state).toEqual(r1.state)
  })
})

// ---------------------------------------------------------------- long-kick completion (keeper-restart seam)

/** The kicker `owner` on the ball at a restart, and a decision to pass to `target`. */
const kickAt = (p: Params, owner: PlayerState, restart: RestartKind | null, target: Vec2) => {
  const s0 = initMatch(makeConfig(1, { params: p }))
  const s: MatchState = {
    ...s0,
    players: s0.players.map((x) => (x.id === owner.id ? owner : x)),
    phase: { kind: "open_play" },
    possession: { kind: "owned", playerId: owner.id, since: 0, restart }
  }
  const d: Decision = {
    action: "long_pass",
    candidate: { action: "long_pass", kind: "long", receiverId: home[9]!.id, target, height: "high", xpass: 0.5, value: 0.1, lane: 1 },
    decisionQuality: 1, xg: null, pressure: 0, actionProbs: {}, options: [], chosenRank: 1, fallback: false
  }
  return { w: workAt(s), d }
}

describe("G3: long-kick error scale", () => {
  it("long goal kicks get the long error scale", () => {
    const p = arm(1, { longErrorScale: 1.7 })
    const k = at(home.find((x) => x.role === "GK")!, -47, 0)
    const cb = at(home.find((x) => x.role === "CB")!, -30, 5)
    const scale = (pp: Params, owner: PlayerState, restart: RestartKind | null, to: Vec2) => {
      const { w, d } = kickAt(pp, owner, restart, to)
      return longKickScale(w, d, restart)
    }
    expect(scale(p, k, "goal_kick", { x: -12, y: 0 })).toBe(1.7) // 35 m
    expect(scale(p, k, "goal_kick", { x: -15, y: 0 })).toBe(1.7) // 32 m exactly
    expect(scale(p, k, "goal_kick", { x: -27, y: 0 })).toBe(1) // 20 m
    expect(scale(p, k, null, { x: -12, y: 0 })).toBe(1) // open play
    // A keeper free kick counts; an outfielder's does not.
    expect(scale(p, at(k, -30, 5), "free_kick", { x: 10, y: 5 })).toBe(1.7)
    expect(scale(p, cb, "free_kick", { x: 10, y: 5 })).toBe(1)
    // Under off: 1.
    expect(scale(arm(0, { longErrorScale: 1.7 }), k, "goal_kick", { x: -12, y: 0 })).toBe(1)
  })
})

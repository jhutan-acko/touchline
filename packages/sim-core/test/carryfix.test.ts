import { describe, expect, it } from "vitest"
import { launchVelocity } from "../src/ball.js"
import { DEFAULT_PARAMS as P, type Params } from "../src/params.js"
import { releaseDelayS } from "../src/release.js"
import { resolveFlight } from "../src/resolve.js"
import { Rng, seedRng } from "../src/rng.js"
import { flightParams, initMatch, rejudgeRelease, step, workAt } from "../src/step.js"
import type { DomainEvent, MatchState, PlayerState } from "../src/types.js"
import { kickoffPlayersFor, makeConfig } from "../src/testing.js"

// Explicit parameter sets (ruling F4): never DEFAULT_PARAMS as "off". Other realism switches are pinned where they matter.
const withP = (over: (p: Params) => Partial<Params>): Params => ({ ...P, ...over(P) })
const ft = (rule: number, scopeRule: number, extra: Partial<Params["firstTick"]> = {}) => ({ ...P.firstTick, rule, scopeRule, bootM: 1, bootBlock: 1, ...extra })

const base = kickoffPlayersFor(makeConfig(1))
const HOME_GK = base[0]!, HOME_CB = base[2]!, AWAY_DEF = base[13]!
const at = (p: PlayerState, x: number, y: number, extra: Partial<PlayerState> = {}): PlayerState => ({ ...p, pos: { x, y }, vel: { x: 0, y: 0 }, ...extra })

/** An open-play state at tick 10 with `owner` holding the ball (restart null), `others` placed, everybody else far away. */
const fixture = (params: Params, seed: number, dt: number, owner: PlayerState, others: PlayerState[], possession: Partial<Extract<MatchState["possession"], { kind: "owned" }>> = {}): MatchState => {
  const s = initMatch(makeConfig(seed, { params, dt }))
  const placed = new Map([owner, ...others].map((p) => [p.id, p]))
  const players = s.players.map((p, i) => placed.get(p.id) ?? at(p, p.side === "home" ? -45 + i : 45 - i, 30 + (i % 5)))
  return {
    ...s, tick: 10, periodTick: 10, phase: { kind: "open_play" }, ball: { pos: { x: owner.pos.x, y: owner.pos.y, z: 0 }, vel: { x: 0, y: 0, z: 0 } },
    lastTouch: { playerId: owner.id, side: owner.side }, players,
    possession: { kind: "owned", playerId: owner.id, since: 0, restart: null, ...possession }
  }
}

describe("M5a: no boot block on a keeper's release from his hands", () => {
  const params = (scopeRule: number): Params => withP((p) => ({
    firstTick: ft(1, scopeRule), distribution: { ...p.distribution, rule: 1 }, keeper: { ...p.keeper, handsRule: 1 },
    defending: { ...p.defending, tackleRatePerS: 0 }
  }))
  /** Home keeper in hands at his own penalty spot area, an away outfielder 0.8 m away, one step. */
  const run = (scopeRule: number, seed: number, dt: number) => {
    const gk = at(HOME_GK, -44, 0)
    const s = fixture(params(scopeRule), seed, dt, gk, [at(AWAY_DEF, -44, 0.8)], { inHands: true, holdTicks: 0 })
    const events: DomainEvent[] = []
    let st = s
    for (let i = 0; i < 3; i++) {
      const r = step(st)
      st = r.state
      events.push(...r.events)
    }
    return events
  }
  it("is blocked at the boot under scopeRule 0, never under scopeRule 1, over 20 seeds", () => {
    let blockedOld = 0, passesNew = 0
    for (let seed = 1; seed <= 20; seed++) {
      const old = run(0, seed, 0.1)
      expect(old.filter((e) => e.type === "keeper_distribution").length, `old seed ${seed}`).toBe(1)
      if (old.some((e) => e.type === "block" && e.attrs.blocked === "pass")) blockedOld++
      const on = run(1, seed, 0.1)
      // Not vacuous (G22): a release happened, and it was a hands release (throw or punt).
      expect(on.filter((e) => e.type === "pass").length, `new seed ${seed}`).toBe(1)
      passesNew++
      expect(["throw", "punt"]).toContain(on.find((e) => e.type === "keeper_distribution")!.attrs.method)
      expect(on.some((e) => e.type === "block" && e.attrs.blocked === "pass"), `seed ${seed}`).toBe(false)
    }
    // Precondition: the old scope blocks every one of them (bootBlock 1).
    expect(blockedOld).toBe(20)
    expect(passesNew).toBe(20)
  })
  it("holds at 25 Hz", () => {
    for (let seed = 1; seed <= 5; seed++) {
      expect(run(0, seed, 0.04).some((e) => e.type === "block" && e.attrs.blocked === "pass")).toBe(true)
      const on = run(1, seed, 0.04)
      expect(on.filter((e) => e.type === "pass").length).toBe(1)
      expect(on.some((e) => e.type === "block")).toBe(false)
    }
  })
})

describe("M5b: a clearance gets its first-tick charge-down back", () => {
  // The clearer stands outside his box on the home side attacking +x; the defender is 0.7 m away at 150 degrees from the attack
  // direction (outside the 60 degree cone for any clearance target, G5), so only the old first-tick rule lets him win.
  const clearer = at(HOME_CB, -20, 0), def = at(AWAY_DEF, -20 + 0.7 * Math.cos((150 * Math.PI) / 180), 0.7 * Math.sin((150 * Math.PI) / 180))
  const resolve = (scopeRule: number, dt: number) => {
    const params = withP(() => ({ firstTick: ft(1, scopeRule) }))
    const w = workAt(fixture(params, 3, dt, clearer, [def]))
    const fp = flightParams(w, true)
    const start = { pos: { x: clearer.pos.x, y: clearer.pos.y, z: 0 }, vel: launchVelocity(clearer.pos, { x: 15, y: 10 }, "high", params) }
    const players = [clearer, def]
    return { fp, res: resolveFlight(start, clearer.id, null, players, fp, dt, new Rng(seedRng(1))) }
  }
  it("under scopeRule 0 (P3's X1) the defender behind-side does not win the first resolution; under scopeRule 1 he wins it at tick 1", () => {
    for (const dt of [0.1, 0.04]) {
      const old = resolve(0, dt)
      expect(old.fp.firstTick.rule).toBe(1)
      expect(old.res.winnerId, `dt ${dt}`).not.toBe(def.id)
      const on = resolve(1, dt)
      expect(on.fp.firstTick.rule).toBe(0)
      expect(on.res.winnerId, `dt ${dt}`).toBe(def.id)
      expect(on.res.ticks, `dt ${dt}`).toBe(1)
    }
  })
  it("a non-clearance keeps the params, and scopeRule 0 returns them untouched", () => {
    const params = withP(() => ({ firstTick: ft(1, 1) }))
    const w = workAt(fixture(params, 3, 0.1, clearer, [def]))
    expect(flightParams(w, false)).toBe(w.p)
    expect(flightParams(workAt(fixture(withP(() => ({ firstTick: ft(1, 0) })), 3, 0.1, clearer, [def])), true).firstTick.rule).toBe(1)
  })
})

describe("M6 cap", () => {
  const draws = (capS: number) => {
    const p: Params = withP((q) => ({ release: { ...q.release, rule: 1, tailShare: 0.35, tailMeanS: 2.5, capS } }))
    const r = new Rng(seedRng(5))
    return Array.from({ length: 20_000 }, () => releaseDelayS(8, p, r))
  }
  it("a free release never exceeds capS; capS 0 leaves the tail", () => {
    const capped = draws(4)
    expect(Math.max(...capped)).toBeLessThanOrEqual(4)
    expect(capped.filter((s) => s === 4).length).toBeGreaterThan(100)
    expect(Math.max(...draws(0))).toBeGreaterThan(4)
  })
  it("a pressed release is not changed by the cap, and the draws are the same with and without it", () => {
    const mk = (capS: number): Params => withP((q) => ({ release: { ...q.release, rule: 1, capS } }))
    const a = new Rng(seedRng(2)), b = new Rng(seedRng(2))
    for (let i = 0; i < 200; i++) expect(releaseDelayS(1, mk(0.3), a)).toBe(releaseDelayS(1, mk(0), b))
    const c = new Rng(seedRng(9)), d = new Rng(seedRng(9))
    for (let i = 0; i < 500; i++) expect(Math.min(releaseDelayS(8, mk(0), c), 4)).toBe(releaseDelayS(8, mk(4), d))
  })
})

describe("M6 re-judge", () => {
  const rj = (rejudge: number, rule = 1): Params => withP((q) => ({ release: { ...q.release, rule, rejudge }, keeper: { ...q.keeper, handsRule: 1 } }))
  const holder = at(HOME_CB, -20, 0, { intent: { kind: "hold" }, intentUntil: 40 })
  const judged = (params: Params, dt: number, over: { owner?: PlayerState; opp?: PlayerState; possession?: Parameters<typeof fixture>[5]; oppM?: number } = {}) => {
    const owner = over.owner ?? holder
    const opp = over.opp ?? at(AWAY_DEF, owner.pos.x + (over.oppM ?? 1.8), owner.pos.y)
    const s = fixture(params, 4, dt, { ...owner, intentUntil: 10 + 30 }, [opp], over.possession)
    const w = workAt(s)
    const before = w.player(owner.id).intentUntil
    rejudgeRelease(w, w.player(owner.id))
    return { tick: s.tick, before, after: w.player(owner.id).intentUntil }
  }
  it("a presser arriving cuts a long hold, at 10 Hz and 25 Hz", () => {
    for (let seed = 0; seed < 20; seed++) {
      const r10 = judged(rj(1), 0.1), r25 = judged(rj(1), 0.04)
      expect(r10.before - r10.tick).toBe(30)
      expect(r10.after).toBeLessThanOrEqual(r10.tick + 7)
      expect(r25.after).toBeLessThanOrEqual(r25.tick + 18)
      expect(r10.after).toBeGreaterThan(r10.tick)
    }
    // The draw is real (release stream): it varies between states.
    const seen = new Set<number>()
    for (let seed = 1; seed <= 30; seed++) {
      const s = fixture(rj(1), seed, 0.04, { ...holder, intentUntil: 40 }, [at(AWAY_DEF, -18.2, 0)])
      const w = workAt(s)
      rejudgeRelease(w, w.player(holder.id))
      seen.add(w.player(holder.id).intentUntil)
    }
    expect(seen.size).toBeGreaterThan(3)
  })
  it("does it once: a second call leaves the cut hold alone", () => {
    const w = workAt(fixture(rj(1), 4, 0.1, { ...holder, intentUntil: 40 }, [at(AWAY_DEF, -18.2, 0)]))
    rejudgeRelease(w, w.player(holder.id))
    const once = w.player(holder.id).intentUntil
    rejudgeRelease(w, w.player(holder.id))
    expect(w.player(holder.id).intentUntil).toBe(once)
  })
  it("leaves alone a hold that is already short, and an opponent who is not close", () => {
    const short = judged(rj(1), 0.1, { owner: { ...holder } })
    expect(short.after).toBeLessThan(short.before)
    const w = workAt(fixture(rj(1), 4, 0.1, { ...holder, intentUntil: 15 }, [at(AWAY_DEF, -18.2, 0)]))
    rejudgeRelease(w, w.player(holder.id))
    expect(w.player(holder.id).intentUntil).toBe(15)
    const far = judged(rj(1), 0.1, { oppM: 2.5 })
    expect(far.after).toBe(far.before)
  })
  it("leaves alone a keeper in hands, a restart, rejudge 0, and release.rule 0", () => {
    const gk = at(HOME_GK, -44, 0, { intent: { kind: "hold" } })
    const hands = judged(rj(1), 0.1, { owner: gk, possession: { inHands: true, holdTicks: 50 } })
    expect(hands.after).toBe(hands.before)
    const restart = judged(rj(1), 0.1, { possession: { restart: "throw_in" } })
    expect(restart.after).toBe(restart.before)
    const noRejudge = judged(rj(0), 0.1)
    expect(noRejudge.after).toBe(noRejudge.before)
    const noRule = judged(rj(1, 0), 0.1)
    expect(noRule.after).toBe(noRule.before)
    // Not vacuous: the same fixture does fire for an outfielder.
    expect(judged(rj(1), 0.1).after).toBeLessThan(40)
  })
  it("in a real step the cut hold takes effect within the window (the step's own tick counts, G23)", () => {
    for (const dt of [0.1, 0.04]) {
      const params = withP((q) => ({ ...rj(1), defending: { ...q.defending, tackleRatePerS: 0 } }))
      const s = fixture(params, 4, dt, { ...holder, intentUntil: 40 }, [at(AWAY_DEF, -18.2, 0)])
      const r = step(s)
      const now = r.state.players.find((p) => p.id === holder.id)!
      expect(now.intentUntil).toBeLessThanOrEqual(r.state.tick + Math.round(0.7 / dt))
      expect(now.intentUntil).toBeGreaterThan(r.state.tick - 1)
    }
  })
})

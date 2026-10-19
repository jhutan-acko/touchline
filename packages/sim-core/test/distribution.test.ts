import { describe, expect, it } from "vitest"
import { candidateContext, choiceShares, decide, keeperHandsCandidates, overridePass, type DecisionInput } from "../src/decide.js"
import { executeKick, type KickIntent } from "../src/execute.js"
import { DEFAULT_PARAMS as P, type Params } from "../src/params.js"
import { Rng, seedRng } from "../src/rng.js"
import { initMatch, isFinished, step } from "../src/step.js"
import type { DomainEvent, PlayerState } from "../src/types.js"
import { kickoffPlayersFor, makeConfig, STYLES } from "../src/testing.js"

const players = kickoffPlayersFor(makeConfig(1))
const at = (p: PlayerState, x: number, y: number): PlayerState => ({ ...p, pos: { x, y }, vel: { x: 0, y: 0 } })
const home = players.filter((p) => p.side === "home")
const away = players.filter((p) => p.side === "away")
// Explicit switches (F4): DEFAULT_PARAMS is not "the switched-off engine", since Task 10 turns the defaults on.
const on: Params = { ...P, distribution: { ...P.distribution, rule: 1 } }
const off: Params = { ...P, distribution: { ...P.distribution, rule: 0 } }
const keeper = at(home[0]!, -38, 0)
// A centre back 17 m away, a striker 48 m upfield, the rest spread out; opponents far away.
const teammates = home.map((x) => (x.id === keeper.id ? keeper : x.role === "ST" ? at(x, 10, 0) : x.slot === 2 ? at(x, -30, 15) : at(x, -10 + x.slot, 25)))
const opponents = away.map((x, i) => at(x, 20 + i, -30))
const input = (o: Partial<DecisionInput>): DecisionInput => ({ period: "first_half", owner: keeper, teammates, opponents, style: STYLES.possession, scoreDiff: 0, minute: 30, restart: null, scriptBias: {}, keeperHands: true, ...o })

describe("G5: from the keeper's hands", () => {
  it("throws short along the ground or punts long and high to a forward, punting about a third of the time", () => {
    const r = new Rng(seedRng(9))
    let punts = 0
    for (let i = 0; i < 400; i++) {
      const d = decide(input({}), on, r)
      const c = d.candidate!
      const len = Math.hypot(c.target.x - keeper.pos.x, c.target.y - keeper.pos.y)
      if (c.method === "punt") {
        punts++
        expect(c.height).toBe("high")
        expect(len).toBeGreaterThanOrEqual(35)
        expect(["ST", "W", "AM"]).toContain(teammates.find((t) => t.id === c.receiverId)!.role)
      } else {
        expect(c.method).toBe("throw")
        expect(c.height).toBe("ground")
        expect(len).toBeLessThanOrEqual(35)
      }
    }
    // The punt chance is sigmoid(distribution.puntLogit) when both pools are open (0.32 at the spec's -0.75; Task 7 measured
    // and set -0.25, 0.44): the observed share is within 0.08 of it, the width of the brief's 0.24..0.40 around 0.32.
    const pPunt = 1 / (1 + Math.exp(-on.distribution.puntLogit))
    expect(punts / 400).toBeGreaterThan(pPunt - 0.08)
    expect(punts / 400).toBeLessThan(pPunt + 0.08)
  })
  it("plays normally from his feet, at a restart, or with the rule off", () => {
    const r = new Rng(seedRng(9))
    expect(decide(input({ keeperHands: false }), on, r).candidate?.method).toBeUndefined()
    expect(decide(input({ restart: "goal_kick" }), on, r).candidate?.method).toBeUndefined()
    expect(decide(input({}), off, r).candidate?.method).toBeUndefined()
  })
  it("a keeper taking a free kick has no throw or punt", () => {
    // Deferred P3 test (P4 ruling 22, G17): a free kick taken by the keeper in his own half, like the goal-kick case.
    expect(keeper.pos.x).toBeLessThan(0)
    const r = new Rng(seedRng(9))
    for (let i = 0; i < 50; i++) {
      const d = decide(input({ restart: "free_kick" }), on, r)
      expect(d.candidate).toBeDefined()
      expect(d.candidate?.method).toBeUndefined()
    }
  })
  it("records action probabilities by each option's classified action, summing to 1, with the chosen action among them", () => {
    const r = new Rng(seedRng(11))
    const seen = new Set<string>()
    for (let i = 0; i < 200; i++) {
      const d = decide(input({}), on, r)
      seen.add(d.action)
      expect(d.action).toBe(d.candidate!.action)
      expect(d.action in d.actionProbs).toBe(true)
      expect(d.actionProbs[d.action]!).toBeGreaterThan(0)
      const sum = Object.values(d.actionProbs).reduce((a, b) => a + b, 0)
      expect(sum).toBeGreaterThan(0.99)
      expect(sum).toBeLessThan(1.01)
      expect(d.chosenRank).toBeGreaterThanOrEqual(1)
      expect(d.options.some((o) => o.receiver_id === d.candidate!.receiverId)).toBe(true)
    }
    // A punt to the striker 48 m upfield is not a short pass, so more than one action is recorded across draws.
    expect(seen.size).toBeGreaterThan(1)
  })
})

describe("G5 with D1 (Task 10)", () => {
  // D1 on, at a temperature far from the old receiver pick's, so recorded shares at the wrong temperature would show.
  const both: Params = { ...on, choice: { ...P.choice, rule: 1, temperature: 0.4 } }
  it("records the D1 shares the receiver is drawn from (choiceShares), and the draws follow them", () => {
    const pools = keeperHandsCandidates(candidateContext(input({}), both, 0))!
    const pPunt = 1 / (1 + Math.exp(-both.distribution.puntLogit))
    const expected: Record<string, number> = {}
    const ctx = candidateContext(input({}), both, 0)
    const add = (opts: ReadonlyArray<(typeof pools.throws)[number]>, pm: number) =>
      choiceShares(opts, ctx).forEach((sh, i) => (expected[opts[i]!.action] = (expected[opts[i]!.action] ?? 0) + pm * sh))
    add(pools.throws, 1 - pPunt)
    add(pools.punts, pPunt)
    const r = new Rng(seedRng(13))
    const n = 3000
    const freq: Record<string, number> = {}
    let recorded: Readonly<Record<string, number>> = {}
    for (let i = 0; i < n; i++) {
      const d = decide(input({}), both, r)
      recorded = d.actionProbs
      freq[d.action] = (freq[d.action] ?? 0) + 1 / n
    }
    for (const a of Object.keys(expected)) {
      expect(recorded[a]!, a).toBeCloseTo(expected[a]!, 2)
      expect(Math.abs((freq[a] ?? 0) - recorded[a]!), a).toBeLessThan(0.03)
    }
  })
  it("a what-if pass from the keeper's hands is a throw or a punt, as his own decision would be", () => {
    const r = new Rng(seedRng(9))
    const d = decide(input({}), both, r)
    const cb = teammates.find((t) => t.slot === 2)!
    const st = teammates.find((t) => t.role === "ST")!
    const toCb = overridePass(d, input({}), { receiverId: cb.id }, both)
    expect(toCb.forced).toBe(true)
    expect(toCb.candidate!.method).toBe("throw")
    expect(toCb.candidate!.receiverId).toBe(cb.id)
    expect(toCb.action in toCb.actionProbs).toBe(true)
    const toSt = overridePass(d, input({}), { receiverId: st.id }, both)
    expect(toSt.candidate!.method).toBe("punt")
    expect(toSt.candidate!.height).toBe("high")
    // From his feet the same override is an ordinary pass.
    expect(overridePass(d, input({ keeperHands: false }), { receiverId: cb.id }, both).candidate!.method).toBeUndefined()
  })
})

describe("execution error scale", () => {
  it("executeKick's errorScale shrinks the mean error below 1 and grows it above 1", () => {
    const meanError = (errorScale: number): number => {
      const r = new Rng(seedRng(21))
      const k: KickIntent = { from: { x: -38, y: 0 }, to: { x: -18, y: 10 }, height: "ground", technique: 0.6, composure: 0.6, pressure: 0, weakFoot: false, errorScale }
      let sum = 0
      for (let i = 0; i < 2000; i++) sum += executeKick(k, P, r).errorM
      return sum / 2000
    }
    const base = meanError(1)
    expect(meanError(0.5)).toBeLessThan(base * 0.8)
    expect(meanError(1.6)).toBeGreaterThan(base * 1.2)
  })
})

describe("G5 in a match", () => {
  it("keeper distributions are labelled truthfully, and throws are thrown", () => {
    let s = initMatch(makeConfig(7, { params: on }))
    const events: DomainEvent[] = []
    while (!isFinished(s)) {
      const r = step(s)
      s = r.state
      events.push(...r.events)
    }
    const dist = events.filter((e) => e.type === "keeper_distribution")
    expect(dist.length).toBeGreaterThan(0)
    for (const e of dist) expect(["throw", "punt", "kick"]).toContain(e.attrs.method)
    let throws = 0
    events.forEach((e, i) => {
      if (e.type !== "keeper_distribution" || e.attrs.method !== "throw") return
      throws++
      const pass = events.slice(i + 1).find((g) => g.type === "pass")!
      expect(pass.attrs.technique).toBe("throw")
      expect(pass.attrs.body_part).toBe("hands")
    })
    // Not vacuous (F11): the keeper did throw in this match.
    expect(throws).toBeGreaterThan(0)
  }, 120_000)
})

describe("G5 deferred cases (P5 Task 13)", () => {
  const withLogit = (puntLogit: number): Params => ({ ...on, distribution: { ...on.distribution, puntLogit } })
  const hands = (p: Params, n: number) => {
    const r = new Rng(seedRng(17))
    return Array.from({ length: n }, () => decide(input({}), p, r).candidate!)
  }
  it("pPunt 0 never punts, 1 always punts", () => {
    // Both pools are open from this keeper's spot (the first G5 test punts and throws), so the branch is the logit's alone.
    const pools = keeperHandsCandidates(candidateContext(input({}), on, 0))!
    expect(pools.throws.length).toBeGreaterThan(0)
    expect(pools.punts.length).toBeGreaterThan(0)
    for (const c of hands(withLogit(-50), 200)) expect(c.method).toBe("throw")
    for (const c of hands(withLogit(50), 200)) expect(c.method).toBe("punt")
  })
  it("a throw is never shorter than the throw lower bound and a punt is struck by foot", () => {
    // A teammate 2 m from the keeper is under the 4 m lower bound: never a throw target, whichever way the draws fall.
    const close = at(teammates.find((t) => t.slot === 5)!, keeper.pos.x + 2, 0)
    const crowded = teammates.map((t) => (t.id === close.id ? close : t))
    const r = new Rng(seedRng(19))
    for (let i = 0; i < 300; i++) {
      const c = decide(input({ teammates: crowded }), withLogit(-50), r).candidate!
      expect(c.method).toBe("throw")
      expect(c.receiverId).not.toBe(close.id)
      expect(Math.hypot(c.target.x - keeper.pos.x, c.target.y - keeper.pos.y)).toBeGreaterThanOrEqual(4)
    }
    // (puntLogit 50 below: at the default a seed-7 match can pass without a single punt, as M10 records.)
    // In a match every punt is followed by a pass struck by foot, and every throw by hands.
    let s = initMatch(makeConfig(7, { params: withLogit(50) }))
    const events: DomainEvent[] = []
    while (!isFinished(s)) {
      const res = step(s)
      s = res.state
      events.push(...res.events)
    }
    let punts = 0
    events.forEach((e, i) => {
      if (e.type !== "keeper_distribution" || e.attrs.method !== "punt") return
      punts++
      const pass = events.slice(i + 1).find((g) => g.type === "pass")!
      expect(pass.attrs.technique).not.toBe("throw")
      expect(pass.attrs.body_part).not.toBe("hands")
    })
    expect(punts).toBeGreaterThan(0)
  }, 120_000)
})

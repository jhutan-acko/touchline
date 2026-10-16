import { describe, expect, it } from "vitest"
import { buildCandidates, candidateContext, choiceFeatures, choiceShares, choiceTemperature, choiceUtility, decide, overridePass, type DecisionInput } from "../src/decide.js"
import { DEFAULT_PARAMS as P, type Params } from "../src/params.js"
import { Rng, seedRng } from "../src/rng.js"
import type { PlayerState } from "../src/types.js"
import { kickoffPlayersFor, makeConfig, STYLES } from "../src/testing.js"

const players = kickoffPlayersFor(makeConfig(1))
const at = (p: PlayerState, x: number, y: number): PlayerState => ({ ...p, pos: { x, y }, vel: { x: 0, y: 0 } })
const home = players.filter((p) => p.side === "home")
const away = players.filter((p) => p.side === "away")
const on: Params = { ...P, choice: { ...P.choice, rule: 1, kindShift: { ...P.choice.kindShift, switch: 0, long_pass: 0, lofted_through: 0 }, ivCentre: 0, temperature: 1 } }
const input = (o: Partial<DecisionInput>): DecisionInput => ({ period: "first_half", owner: home[5]!, teammates: home, opponents: away, style: STYLES.possession, scoreDiff: 0, minute: 30, restart: null, scriptBias: {}, ...o })

describe("D1: features as fitted (same fixture as test_passing.py)", () => {
  it("distance, forward, lateral, lane, openness, line-breaking and keeper at the receiver's position", () => {
    const owner = at(home[5]!, 0, 0), t1 = at(home[6]!, 10, 0), t2 = at(home[7]!, 0, 20)
    const ctx = candidateContext(input({ owner, teammates: [owner, t1, t2], opponents: [at(away[2]!, 5, 0.5), at(away[3]!, 0, 23)] }), on, 0)
    expect(choiceFeatures(ctx, t1, t1.pos)).toEqual({ dist: 1, fwd: 1, lat: 0, lane: 1, open: Math.hypot(5, 0.5) / 5, lineBreak: 0, keeper: 0 })
    expect(choiceFeatures(ctx, t2, t2.pos)).toEqual({ dist: 2, fwd: 0, lat: 2, lane: 0, open: 0.6, lineBreak: 0, keeper: 0 })
  })
  it("with ten men (7 opponent outfielders) there is no midfield line: line-breaking 0 and a finite utility", () => {
    const owner = at(home[5]!, -20, 0), far = at(home[9]!, 30, 0)
    const opp = away.map((x, i) => (i >= 1 && i <= 3 ? { ...x, sentOff: true } : at(x, 10 + i, -10 + 2 * i)))
    const ctx = candidateContext(input({ owner, teammates: [owner, far], opponents: opp }), on, 0)
    expect(choiceFeatures(ctx, far, far.pos).lineBreak).toBe(0)
    expect(Number.isFinite(choiceUtility(ctx, far, far.pos, 0))).toBe(true)
  })
  it("pressed carriers turn away from wide options", () => {
    const owner = at(home[5]!, 0, 0), near = at(home[6]!, 8, 3), wide = at(home[1]!, 0, 30)
    const gap = (pressure: number) => {
      const ctx = candidateContext(input({ owner, teammates: [owner, near, wide], opponents: [at(away[9]!, 40, 0)] }), on, pressure)
      return choiceUtility(ctx, wide, wide.pos, 0) - choiceUtility(ctx, near, near.pos, 0)
    }
    expect(gap(1)).toBeLessThan(gap(0))
  })
})

describe("D1: every option is priced at its receiver's current position", () => {
  it("a through ball and a plain pass to the same receiver share the feature vector; their values differ only by the lane to the aim", () => {
    const lead = { ...on, choice: { ...on.choice, leadLane: -0.3 } }
    const probe = candidateContext(input({}), lead, 0)
    const d = probe.dir
    const owner = at(home[5]!, 0, 0), runner = at(home[9]!, 20 * d, 5)
    // An outfielder sets the last line at u 19 (so the runner is ahead of it); their keeper stands in the lane to the
    // through target (8 m beyond the runner) but not in the lane to the runner himself.
    const opp = [at(away[0]!, 25 * d, 4.5), at(away[4]!, 19 * d, -30)]
    const inp = input({ owner, teammates: [owner, runner], opponents: opp })
    const ctx = candidateContext(inp, lead, 0)
    const cands = buildCandidates(inp, lead, 0).filter((c) => c.receiverId === runner.id)
    const plain = cands.find((c) => c.target.x === runner.pos.x && c.target.y === runner.pos.y)!
    const through = cands.find((c) => c !== plain)!
    expect(plain).toBeDefined()
    expect(through).toBeDefined()
    expect(Math.abs(through.target.x)).toBeGreaterThan(Math.abs(runner.pos.x) + 1)
    expect(plain.lane).toBe(0)
    expect(through.lane).toBeGreaterThan(0)
    const x = choiceFeatures(ctx, runner, runner.pos)
    expect(plain.value).toBeCloseTo(choiceUtility(ctx, runner, runner.pos, 0), 12)
    expect(through.value).toBeCloseTo(choiceUtility(ctx, runner, runner.pos, through.lane), 12)
    expect(through.value - plain.value).toBeCloseTo(lead.choice.leadLane, 12)
    // Not measured at the aim point: there the features (forward gain, distance) would differ.
    expect(choiceFeatures(ctx, runner, through.target)).not.toEqual(x)
  })
})

describe("D1: the two-step choice is the fitted logit", () => {
  it("with equal kind shifts and temperature 1, P(kind) is the sum of the flat softmax over that kind's options", () => {
    const keeper = at(home[0]!, -47, 0)
    const team = home.map((x, i) => (i === 0 ? keeper : at(x, -40 + 4 * i, i % 2 ? 25 : -20)))
    const neutral = { ...STYLES.possession, longBallBias: 0, crossBias: 0, riskTolerance: 0.5 }
    const opp = away.map((x, i) => at(x, 30 + i, 30))
    const owner = { ...keeper, attrs: { ...keeper.attrs, vision: 0.6 } }
    const inp = input({ owner, teammates: team.map((x) => (x.id === owner.id ? owner : x)), opponents: opp, style: neutral, restart: "goal_kick" })
    const d = decide(inp, on, new Rng(seedRng(1)))
    const cands = buildCandidates(inp, on, d.pressure)
    const m = Math.max(...cands.map((c) => c.value))
    const z = cands.reduce((s, c) => s + Math.exp(c.value - m), 0)
    let checked = 0
    for (const a of ["short_pass", "long_pass", "switch"]) {
      const flat = cands.filter((c) => c.action === a).reduce((s, c) => s + Math.exp(c.value - m) / z, 0)
      if (flat > 0) {
        expect(d.actionProbs[a]).toBeCloseTo(flat, 2)
        checked++
      }
    }
    expect(checked).toBeGreaterThanOrEqual(2)
  })
})

describe("D1: receiver shares at the D1 temperature (for the keeper-hands record, Task 10)", () => {
  it("choiceShares is softmax(U / T), sums to 1 and follows the draw", () => {
    const ctx = candidateContext(input({}), on, 0)
    const opts = buildCandidates(input({}), on, 0).filter((c) => c.action === "short_pass")
    expect(opts.length).toBeGreaterThan(1)
    const s = choiceShares(opts, ctx)
    const T = choiceTemperature(ctx)
    expect(s.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 9)
    const z = opts.reduce((a, c) => a + Math.exp(c.value / T), 0)
    opts.forEach((c, i) => expect(s[i]).toBeCloseTo(Math.exp(c.value / T) / z, 9))
    expect(choiceShares([], ctx)).toEqual([])
  })
})

describe("D1: the decision record", () => {
  it("utilities can be negative; quality stays in (0, 1] for chosen and forced passes", () => {
    const r = new Rng(seedRng(2))
    let checked = 0
    for (let i = 0; i < 50; i++) {
      const d = decide(input({}), on, r)
      if (d.decisionQuality !== null) {
        expect(d.decisionQuality).toBeGreaterThan(0)
        expect(d.decisionQuality).toBeLessThanOrEqual(1)
        checked++
      }
    }
    expect(checked).toBeGreaterThan(0)
    const d = decide(input({}), on, new Rng(seedRng(3)))
    const forced = overridePass(d, input({}), { receiverId: home[2]!.id }, on)
    expect(forced.forced).toBe(true)
    expect(forced.decisionQuality!).toBeGreaterThan(0)
    expect(forced.decisionQuality!).toBeLessThanOrEqual(1)
  })
})

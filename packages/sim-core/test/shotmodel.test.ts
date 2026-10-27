import { describe, expect, it } from "vitest"
import { shotTerm, xgCoefs, xgOf } from "../src/decide.js"
import { goalAngle, goalOf } from "../src/geometry.js"
import { DEFAULT_PARAMS, type Params } from "../src/params.js"
import { STYLES } from "../src/testing.js"

/** Every P6 rule at 0 (never DEFAULT_PARAMS as "off": Task 8 switches the defaults on). */
const off: Params = {
  ...DEFAULT_PARAMS,
  firstTime: { ...DEFAULT_PARAMS.firstTime, rule: 0 },
  header: { ...DEFAULT_PARAMS.header, rule: 0 },
  saveGeo: { ...DEFAULT_PARAMS.saveGeo, rule: 0 },
  execFatigue: { ...DEFAULT_PARAMS.execFatigue, rule: 0 },
  shotModel: { ...DEFAULT_PARAMS.shotModel, rule: 0 }
}
/** The same fixture with only shotModel.rule switched on. */
const on: Params = { ...off, shotModel: { ...off.shotModel, rule: 1 } }
const sigmoid = (z: number): number => 1 / (1 + Math.exp(-z))
const pos = { x: 40, y: 0 }

describe("P6 shot logit and xG refit (shotModel)", () => {
  it("rule on: xgOf reads shotModel.xg", () => {
    const withB0 = (p: Params): Params => ({ ...p, shotModel: { ...p.shotModel, xg: { ...p.shotModel.xg, b0: -2 } } })
    const pOn = withB0(on), pOff = withB0(off)
    // Precondition: the two coefficient sets differ, so the assertion below can tell them apart.
    expect(pOn.shotModel.xg.b0).not.toBe(pOn.shot.xg.b0)
    const c = pOn.shotModel.xg
    const d = Math.hypot(goalOf("home", "first_half").x - pos.x, 0)
    const want = sigmoid(c.b0 + c.bDist * d + c.bAngle * goalAngle("home", "first_half", pos))
    expect(xgCoefs(pOn)).toBe(pOn.shotModel.xg)
    expect(xgOf(pOn, "home", "first_half", pos, false, 0)).toBeCloseTo(want, 12)
    // Under off the shotModel coefficients are ignored: xgOf is the shot.xg value it always was.
    const s = off.shot.xg
    const old = sigmoid(s.b0 + s.bDist * d + s.bAngle * goalAngle("home", "first_half", pos))
    expect(xgCoefs(pOff)).toBe(pOff.shot.xg)
    expect(xgOf(pOff, "home", "first_half", pos, false, 0)).toBe(xgOf(off, "home", "first_half", pos, false, 0))
    expect(xgOf(pOff, "home", "first_half", pos, false, 0)).toBeCloseTo(old, 12)
    expect(xgOf(pOff, "home", "first_half", pos, false, 0)).not.toBeCloseTo(want, 3)
  })

  it("rule on: the open-play shot term uses bXg, pivot and bRisk", () => {
    const style = STYLES.direct
    const m = { ...on.shotModel, bXg: 2.5, pivot: 0.07, bRisk: 0.45 }
    const p: Params = { ...on, shotModel: m }
    expect(shotTerm(0.3, style, null, p)).toBeCloseTo(m.bXg * (0.3 - m.pivot) + m.bRisk * style.riskTolerance, 12)
    expect(shotTerm(0.3, style, null, on)).toBeCloseTo(on.shotModel.bXg * (0.3 - on.shotModel.pivot) + on.shotModel.bRisk * style.riskTolerance, 12)
    // Under off the same fixture keeps the old term.
    expect(shotTerm(0.3, style, null, { ...p, shotModel: { ...m, rule: 0 } })).toBe(3 * (0.3 - 0.1) + 0.3 * style.riskTolerance)
  })

  it("a restart keeps the old term, so P5's free-kick logit is untouched", () => {
    const style = STYLES.direct
    const p: Params = { ...on, shotModel: { ...on.shotModel, bXg: 2.5, pivot: 0.07, bRisk: 0.45 } }
    expect(shotTerm(0.3, style, "free_kick", p)).toBe(3 * (0.3 - 0.1) + 0.3 * style.riskTolerance)
    expect(shotTerm(0.3, STYLES.possession, "penalty", p)).toBe(3 * (0.3 - 0.1) + 0.3 * STYLES.possession.riskTolerance)
  })

  it("the fitted xG is lower for a header and for defenders in the cone", () => {
    // The committed values are Task 2's fractional-logit fit to DFL model xG (shots.xgFit).
    expect(DEFAULT_PARAMS.shotModel.xg).toEqual({ b0: -3.004, bDist: -0.0392, bAngle: 4.059, bHeader: -1.617, bDefenders: -0.342 })
    const foot = xgOf(on, "home", "first_half", pos, false, 0)
    expect(xgOf(on, "home", "first_half", pos, true, 0)).toBeLessThan(foot)
    expect(xgOf(on, "home", "first_half", pos, false, 2)).toBeLessThan(foot)
    // Mirrored after half-time: the same spot relative to the goal gives the same xG.
    expect(xgOf(on, "home", "second_half", { x: -40, y: 0 }, false, 0)).toBeCloseTo(foot, 12)
  })
})

import { describe, expect, it } from "vitest"
import { executeKick, fatigueScale, type KickIntent } from "../src/execute.js"
import { DEFAULT_PARAMS, type Params } from "../src/params.js"
import { Rng, seedRng } from "../src/rng.js"

/** Every P6 rule at 0 (never DEFAULT_PARAMS as "off": Task 8 switches the defaults on). */
const off: Params = {
  ...DEFAULT_PARAMS,
  firstTime: { ...DEFAULT_PARAMS.firstTime, rule: 0 },
  header: { ...DEFAULT_PARAMS.header, rule: 0 },
  saveGeo: { ...DEFAULT_PARAMS.saveGeo, rule: 0 },
  execFatigue: { ...DEFAULT_PARAMS.execFatigue, rule: 0 },
  shotModel: { ...DEFAULT_PARAMS.shotModel, rule: 0 }
}
const withFatigue = (p: Params, execFatigue: Params["execFatigue"]): Params => ({ ...p, execFatigue })
const on = (k: number, ref: number, power: number): Params => withFatigue(off, { rule: 1, k, ref, power })

describe("fatigueScale (SH4)", () => {
  it("rule off is the old factor exactly", () => {
    for (const f of [0, 0.3, 1]) expect(fatigueScale(f, off)).toBe(1 + off.fatigue.executionK * f)
    // Rule-1 values are ignored while the rule is 0.
    const ignored = withFatigue(off, { rule: 0, k: 0.9, ref: 0.5, power: 3 })
    for (const f of [0, 0.3, 1]) expect(fatigueScale(f, ignored)).toBe(1 + off.fatigue.executionK * f)
  })

  it("rule on: flat below ref, rising after, by k and power", () => {
    const p = on(0.5, 0.2, 2)
    expect(fatigueScale(0.1, p)).toBe(1)
    expect(fatigueScale(0.2, p)).toBe(1)
    expect(fatigueScale(0.6, p)).toBeCloseTo(1 + 0.5 * 0.16, 12)
    let prev = fatigueScale(0, p)
    for (let i = 1; i <= 100; i++) {
      const v = fatigueScale(i / 100, p)
      expect(v).toBeGreaterThanOrEqual(prev)
      prev = v
    }
    expect(fatigueScale(1, p)).toBeGreaterThan(fatigueScale(0.5, p))
  })

  it("rule on with the defaults equals rule off", () => {
    const p = on(0.25, 0, 1)
    expect(off.fatigue.executionK).toBe(0.25)
    for (let i = 0; i <= 20; i++) expect(fatigueScale(i / 20, p)).toBeCloseTo(fatigueScale(i / 20, off), 12)
  })

  it("tired kicks miss by more", () => {
    const intent = (fatigue: number): KickIntent => ({
      from: { x: 0, y: 0 }, to: { x: 25, y: 5 }, height: "ground", technique: 0.6, composure: 0.5, pressure: 0.3, weakFoot: false, fatigue
    })
    const meanErr = (p: Params, fatigue: number): number => {
      const rng = new Rng(seedRng(7))
      let s = 0
      for (let i = 0; i < 3000; i++) s += executeKick(intent(fatigue), p, rng).errorM
      return s / 3000
    }
    const p = on(0.5, 0, 1)
    // Precondition: tiredness already widens the error under off (executionK).
    expect(meanErr(off, 0.6) / meanErr(off, 0)).toBeGreaterThan(1.05)
    expect(meanErr(p, 0.6) / meanErr(p, 0)).toBeGreaterThan(1.05)
    // The rule adds on top: from equal rng states, on (k 0.5) exceeds off by more than 3 % at fatigue 0.6.
    expect(meanErr(p, 0.6) / meanErr(off, 0.6)).toBeGreaterThan(1.03)
  })
})

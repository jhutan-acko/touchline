import { describe, expect, it } from "vitest"
import { DEFAULT_PARAMS } from "@touchline/sim-core"
import { loss, scaleOf, type Targets } from "../src/evaluate.js"
import { applyKnobs, initialKnobs, KNOBS, type Knob } from "../src/knobs.js"
import { SCALAR_KEYS } from "../src/metrics.js"
import { withPhysics } from "../src/physics.js"
import { coordinateSearch } from "../src/tune.js"

describe("knobs", () => {
  it("initial values leave the parameters unchanged", () => {
    expect(applyKnobs(DEFAULT_PARAMS, initialKnobs())).toEqual(DEFAULT_PARAMS)
  })
  it("every knob changes the parameters when moved, and never mutates its input", () => {
    const frozen = JSON.parse(JSON.stringify(DEFAULT_PARAMS))
    for (const k of KNOBS) {
      const moved = applyKnobs(DEFAULT_PARAMS, { ...initialKnobs(), [k.name]: k.init + k.step })
      expect(moved, k.name).not.toEqual(DEFAULT_PARAMS)
    }
    expect(DEFAULT_PARAMS).toEqual(frozen)
  })
  it("starting values sit inside their bounds", () => {
    for (const k of KNOBS) {
      expect(k.init, k.name).toBeGreaterThanOrEqual(k.min)
      expect(k.init, k.name).toBeLessThanOrEqual(k.max)
    }
  })
})

describe("loss", () => {
  const targets: Targets = { provenance: {}, metrics: Object.fromEntries(SCALAR_KEYS.map((k) => [k, { mean: 10, sd: 2, n: 7 }])) }
  it("is zero when every statistic hits its target", () => {
    expect(loss(Object.fromEntries(SCALAR_KEYS.map((k) => [k, 10])) as never, targets)).toBe(0)
  })
  it("refuses to score when no statistic could be measured (e.g. zero matches)", () => {
    expect(() => loss(Object.fromEntries(SCALAR_KEYS.map((k) => [k, Number.NaN])) as never, targets)).toThrow(/no statistic/)
  })
  it("floors the scale at 5 % of the mean", () => {
    expect(scaleOf({ mean: 100, sd: 0, n: 1 })).toBe(5)
  })
})

describe("coordinateSearch", () => {
  it("finds the minimum of a separable quadratic within the step resolution", () => {
    const knobs: Knob[] = [
      { name: "a", what: "", init: 0, min: -10, max: 10, step: 2, apply: (p) => p },
      { name: "b", what: "", init: 5, min: -10, max: 10, step: 2, apply: (p) => p }
    ]
    const res = coordinateSearch(knobs, { a: 0, b: 5 }, 6, (v) => ({ loss: (v.a! - 3) ** 2 + (v.b! + 1) ** 2, detail: null }))
    expect(res.knobs.a).toBeCloseTo(3, 0)
    expect(res.knobs.b).toBeCloseTo(-1, 0)
    expect(res.loss).toBeLessThan(0.1)
  })
  it("respects knob bounds", () => {
    const k: Knob[] = [{ name: "a", what: "", init: 0, min: -1, max: 1, step: 1, apply: (p) => p }]
    const res = coordinateSearch(k, { a: 0 }, 4, (v) => ({ loss: -v.a!, detail: null }))
    expect(res.knobs.a).toBe(1)
  })
})

describe("physics in the tuner", () => {
  it("calibrates on top of the fitted physics constants", () => {
    const engine = { ball: { drag: 0.0153, restitution: 0.747, bounceFriction: 0.24, skidFriction: 0.35, rollC0: 0.55, rollC1: 0.11 }, players: { brake: 6.2, reactionS: 0.2 } }
    const p = withPhysics(DEFAULT_PARAMS, { validation: { envelope: {}, real: { players: {} } }, engine })
    expect(p.physics.ball).toEqual(engine.ball)
    expect(p.physics.players.brake).toBe(6.2)
    expect(p.physics.players.a0).toEqual(DEFAULT_PARAMS.physics.players.a0)
  })
})

import { readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "vitest"
import { ACTIONS, assertProvenance, DEFAULT_PARAMS, ParamsError, paramsFromJson } from "../src/params.js"
import { ACTION_ZONES } from "../src/geometry.js"
import { CONCERNS } from "../src/types.js"

describe("params", () => {
  it("default priors carry provenance and pass the licence check", () => {
    expect(() => assertProvenance(DEFAULT_PARAMS)).not.toThrow()
  })
  it("rejects files with no provenance, a disallowed licence, or StatsBomb data", () => {
    expect(() => assertProvenance({})).toThrow(ParamsError)
    expect(() => assertProvenance({ provenance: { ...DEFAULT_PARAMS.provenance, licence: "proprietary" } })).toThrow(/not allowed/)
    expect(() => assertProvenance({ provenance: { ...DEFAULT_PARAMS.provenance, dataset: "StatsBomb open data", licence: "CC-BY-4.0" } })).toThrow(/StatsBomb/)
  })
  it("has a logit for every action in every zone", () => {
    for (const z of ACTION_ZONES) for (const a of ACTIONS) expect(Number.isFinite(DEFAULT_PARAMS.actions.logits[z][a])).toBe(true)
  })
})

describe("params from JSON", () => {
  it("merges a partial file onto the defaults and keeps provenance", () => {
    const p = paramsFromJson({ provenance: { ...DEFAULT_PARAMS.provenance, version: "calib-x" }, kinematics: { reachMargin: 0.6 } })
    expect(p.kinematics.reachMargin).toBe(0.6)
    expect(p.kinematics.reachM).toBe(DEFAULT_PARAMS.kinematics.reachM)
    expect(p.provenance.version).toBe("calib-x")
  })
  it("ignores keys the engine does not know (e.g. the calibration record)", () => {
    const p = paramsFromJson({ provenance: DEFAULT_PARAMS.provenance, calibration: { loss: 3 } }) as unknown as Record<string, unknown>
    expect(p.calibration).toBeUndefined()
  })
  it("refuses files without an allowed licence", () => {
    expect(() => paramsFromJson({ kinematics: {} })).toThrow(ParamsError)
    expect(() => paramsFromJson({ provenance: { ...DEFAULT_PARAMS.provenance, dataset: "StatsBomb open data", licence: "CC-BY-4.0" } })).toThrow(/StatsBomb/)
    expect(() => paramsFromJson([1, 2])).toThrow(ParamsError)
  })
})

describe("params from JSON: review fixes", () => {
  const cc = { dataset: "open data", licence: "CC-BY-4.0", attribution: "Some League; Someone et al.", fitted_at: "2026-10-04", version: "v1" }
  it("refuses values whose type differs from the default's", () => {
    for (const bad of [
      { kinematics: { reachM: "far" } },
      { ball: null },
      { shot: 5 },
      { timing: { addedTimeMinS: [1] } },
      { kinematics: { reachMargin: Number.NaN } }
    ]) expect(() => paramsFromJson({ provenance: cc, ...bad }), JSON.stringify(bad)).toThrow(ParamsError)
  })
  it("requires attribution and fitting date for data-derived licences, and checks attribution for StatsBomb", () => {
    expect(() => paramsFromJson({ provenance: { ...cc, attribution: undefined } })).toThrow(/attribution/)
    expect(() => paramsFromJson({ provenance: { ...cc, fitted_at: "" } })).toThrow(/attribution/)
    expect(() => paramsFromJson({ provenance: { ...cc, attribution: "StatsBomb" } })).toThrow(/StatsBomb/)
    expect(paramsFromJson({ provenance: cc }).provenance.attribution).toBe(cc.attribution)
  })
  it("ignores inherited keys such as toString and __proto__", () => {
    const p = paramsFromJson(JSON.parse(`{"provenance":${JSON.stringify(cc)},"kinematics":{"toString":"boom","__proto__":{"x":1}}}`)) as unknown as { kinematics: object }
    expect(Object.hasOwn(p.kinematics, "toString")).toBe(false)
    expect(String(p.kinematics)).toBe("[object Object]")
  })
})

describe("params from JSON: value ranges", () => {
  const prov = { dataset: "open data", licence: "CC-BY-4.0", attribution: "Some League; Someone et al.", fitted_at: "2026-10-06", version: "v1" }
  it("labels the hand-set priors with the version that changed their scenario settings", () => {
    // Runs record the version; a run made with older priors must not be rebuilt with these.
    expect(DEFAULT_PARAMS.provenance.version).toBe("prior-1")
  })
  it("accepts the defaults and the committed calibrated parameters", () => {
    expect(() => paramsFromJson({ provenance: prov })).not.toThrow()
    const root = join(dirname(fileURLToPath(import.meta.url)), "../../..")
    expect(() => paramsFromJson(JSON.parse(readFileSync(join(root, "data/params/touchline-params.json"), "utf8")))).not.toThrow()
  })
  it("refuses probabilities outside 0..1", () => {
    for (const bad of [{ keeper: { letRunShare: 5 } }, { defending: { foulPerTackle: -0.1 } }, { substitutions: { windowChance: [1, 1.2, 0.5] } }, { kinematics: { reachMargin: 1.5 } }, { fatigue: { halfTimeRecovery: 1.5 } }, { script: { howlerFumble: 2 } }])
      expect(() => paramsFromJson({ provenance: prov, ...bad }), JSON.stringify(bad)).toThrow(/must be between 0 and 1/)
  })
  it("refuses negative values where only magnitudes make sense, but allows signed model coefficients", () => {
    for (const bad of [{ substitutions: { windowSdMin: -1 } }, { kinematics: { reachM: -9 } }, { timing: { restartDelayS: { corner: -5 } } }])
      expect(() => paramsFromJson({ provenance: prov, ...bad }), JSON.stringify(bad)).toThrow(/must not be negative/)
    expect(() => paramsFromJson({ provenance: prov, shot: { xg: { b0: -2 } }, firstTouch: { bSkill: -4 }, defending: { tackleBase: -0.5 } })).not.toThrow()
  })
})

describe("realism v2 P2 params", () => {
  const cc = { dataset: "open data", licence: "CC-BY-4.0", attribution: "Some League; Someone et al.", fitted_at: "2026-10-04", version: "v1" }
  it("ship switched on (Task 8), with the re-fitted rule table, and a drift RNG stream", () => {
    expect(DEFAULT_PARAMS.positioning.rule).toBe(1)
    expect(DEFAULT_PARAMS.movement.relaxed).toBe(1)
    expect(DEFAULT_PARAMS.fatigue.tiring).toBe(1)
    expect(DEFAULT_PARAMS.substitutions.windowMinutes).toEqual([64, 75, 84])
    expect(DEFAULT_PARAMS.substitutions.roleWeights).toEqual({ CB: 0.15, FB: 0.4, DM: 0.7, CM: 0.7, AM: 0.9, W: 1, ST: 0.9 })
    expect(DEFAULT_PARAMS.positioning.roles.CB.in).toEqual({ a: -8.6, b: 0.64, w0: 10.9, w1: -0.11, w2: 0.32, w3: 0.01, e: 0.39 })
    expect(DEFAULT_PARAMS.positioning.roles.ST.out.a).toBe(2.7)
    expect(DEFAULT_PARAMS.positioning.roles.CB.gk).toEqual({ a: -30.5, b: 0, w0: 15.5, w1: 0, w2: 0, w3: 0, e: 0 })
    expect(CONCERNS).toContain("drift")
  })
  it("accept negative rule-table coefficients from a file, and reject a negative time constant or a share above 1", () => {
    const p = paramsFromJson({ provenance: cc, positioning: { roles: { CB: { out: { a: -20 } } } } })
    expect(p.positioning.roles.CB.out.a).toBe(-20)
    expect(p.positioning.roles.CB.in.a).toBe(-8.6)
    expect(() => paramsFromJson({ provenance: cc, positioning: { tauS: { CB: -1 } } })).toThrow(ParamsError)
    expect(() => paramsFromJson({ provenance: cc, movement: { relaxCap: 1.5 } })).toThrow(/between 0 and 1/)
  })
})

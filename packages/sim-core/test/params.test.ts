import { readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "vitest"
import { ACTIONS, assertProvenance, DEFAULT_PARAMS, ParamsError, paramsFromJson } from "../src/params.js"
import { ACTION_ZONES } from "../src/geometry.js"

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
    expect(p.kinematics.vmaxBase).toBe(DEFAULT_PARAMS.kinematics.vmaxBase)
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
      { kinematics: { vmaxBase: "fast" } },
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
  it("accepts the defaults and the committed calibrated parameters", () => {
    expect(() => paramsFromJson({ provenance: prov })).not.toThrow()
    const root = join(dirname(fileURLToPath(import.meta.url)), "../../..")
    expect(() => paramsFromJson(JSON.parse(readFileSync(join(root, "data/params/touchline-params.json"), "utf8")))).not.toThrow()
  })
  it("refuses probabilities outside 0..1", () => {
    for (const bad of [{ keeper: { letRunShare: 5 } }, { defending: { foulPerTackle: -0.1 } }, { substitutions: { windowChance: [1, 1.2, 0.5] } }, { kinematics: { reachMargin: 1.5 } }])
      expect(() => paramsFromJson({ provenance: prov, ...bad }), JSON.stringify(bad)).toThrow(/must be between 0 and 1/)
  })
  it("refuses negative values where only magnitudes make sense, but allows signed model coefficients", () => {
    for (const bad of [{ substitutions: { windowSdMin: -1 } }, { kinematics: { vmaxBase: -9 } }, { timing: { restartDelayS: { corner: -5 } } }])
      expect(() => paramsFromJson({ provenance: prov, ...bad }), JSON.stringify(bad)).toThrow(/must not be negative/)
    expect(() => paramsFromJson({ provenance: prov, shot: { xg: { b0: -2 } }, firstTouch: { bSkill: -4 }, defending: { tackleBase: -0.5 } })).not.toThrow()
  })
})

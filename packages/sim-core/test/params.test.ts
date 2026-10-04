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

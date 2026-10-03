import { describe, expect, it } from "vitest"
import { ACTIONS, assertProvenance, DEFAULT_PARAMS, ParamsError } from "../src/params.js"
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

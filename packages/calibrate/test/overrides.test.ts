import { describe, expect, it } from "vitest"
import { DEFAULT_PARAMS, paramsFromJson } from "@touchline/sim-core"
import { applySets, parseSets } from "../src/overrides.js"

describe("--set overrides", () => {
  it("parse comma-separated key=value pairs, numbers as numbers", () => {
    expect(parseSets("movement.relaxCap=0.5, positioning.drift.deadRate=0,foo.bar=x")).toEqual([["movement.relaxCap", 0.5], ["positioning.drift.deadRate", 0], ["foo.bar", "x"]])
    expect(parseSets("")).toEqual([])
    expect(() => parseSets("movement.relaxCap")).toThrow(/key=value/)
  })
  it("set nested fields on a copy, creating missing blocks; the result merges onto the defaults", () => {
    const base = { provenance: DEFAULT_PARAMS.provenance, movement: { relaxCap: 0.6 } }
    const out = applySets(base, parseSets("movement.relaxCap=0.5,positioning.drift.deadRate=0"))
    expect(base.movement.relaxCap).toBe(0.6)
    const p = paramsFromJson(out)
    expect(p.movement.relaxCap).toBe(0.5)
    expect(p.positioning.drift.deadRate).toBe(0)
    expect(p.positioning.drift.outS).toBe(DEFAULT_PARAMS.positioning.drift.outS)
  })
})

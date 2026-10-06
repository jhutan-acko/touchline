import { readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"
import { xtAt, xtCell, xtGridFromJson, XtError } from "../src/xt.js"
import { root } from "./helpers.js"

const raw = () => JSON.parse(readFileSync(join(root, "data/params/xt-grid.json"), "utf8"))

describe("expected threat", () => {
  it("index cells as the Python fit does, seen by the team in possession", () => {
    // The same vectors as python/analytics/tests/test_xt.py.
    const g = { cols: 12, rows: 8 }
    expect(xtCell(g, 52.0, 0.5, 1)).toBe(4 * 12 + 11)
    expect(xtCell(g, 52.0, 0.5, -1)).toBe(3 * 12 + 0)
    expect(xtCell(g, 52.5, 34, 1)).toBe(8 * 12 - 1)
    expect(xtCell(g, -52.5, -34, 1)).toBe(0)
  })

  it("load the committed grid: threat highest in front of the attacked goal, mirrored for the away side", () => {
    const g = xtGridFromJson(raw())
    const front = xtAt(g, 48, 1, 1)
    expect(front).toBe(Math.max(...g.values))
    expect(front).toBeGreaterThan(0.25)
    expect(xtAt(g, -48, -1, -1)).toBe(front)
    expect(xtAt(g, -48, 1, 1)).toBeLessThan(0.02)
  })

  it("refuse a malformed grid", () => {
    expect(() => xtGridFromJson({ ...raw(), values: [0.1] })).toThrow(XtError)
    expect(() => xtGridFromJson({ ...raw(), cols: 0 })).toThrow(/cols and rows/)
  })
})

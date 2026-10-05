import { describe, expect, it } from "vitest"
import { MetricId } from "@touchline/schema"
import { METRICS, metricDef } from "../src/catalog.js"

describe("metric catalog", () => {
  it("describes every schema metric id exactly once", () => {
    expect(METRICS.map((m) => m.id).sort()).toEqual([...MetricId.literals].sort())
  })
  it("gives a default window only to windowed metrics", () => {
    for (const m of METRICS) if (m.defaultWindowS !== null) expect(m.windowed, m.id).toBe(true)
    expect(metricDef("team.press")?.defaultWindowS).toBe(300)
    expect(metricDef("nope")).toBeUndefined()
  })
})

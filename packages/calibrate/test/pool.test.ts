import { readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "vitest"
import type { League } from "@touchline/league"
import { DEFAULT_PARAMS } from "@touchline/sim-core"
import { evaluate, meanMetrics } from "../src/evaluate.js"
import { createPool } from "../src/pool.js"

const root = join(dirname(fileURLToPath(import.meta.url)), "../../..")
const league = JSON.parse(readFileSync(join(root, "data/league/league.json"), "utf8")) as League

describe("parallel evaluation", () => {
  it("is bit-identical to the serial evaluator, and the pool is reusable", async () => {
    const params = structuredClone(DEFAULT_PARAMS)
    const serial = evaluate(league, params, 4)
    const pool = createPool(league, 2)
    try {
      const a = await pool.evaluate(params, 4)
      expect(a).toEqual(serial)
      expect(meanMetrics(a)).toEqual(meanMetrics(serial))
      expect(await pool.evaluate(params, 4)).toEqual(serial)
    } finally {
      await pool.close()
    }
  }, 120_000)
  it("a one-worker pool is the in-process serial path", async () => {
    const pool = createPool(league, 1)
    expect(await pool.evaluate(DEFAULT_PARAMS, 1)).toEqual(evaluate(league, DEFAULT_PARAMS, 1))
  }, 60_000)
})

import { readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "vitest"
import type { League } from "@touchline/league"
import { paramsFromJson } from "@touchline/sim-core"
import { FIXTURES, loss, meanMetrics, runMatch, scaleOf, type Targets } from "../src/evaluate.js"
import { matchMetrics, SCALAR_KEYS } from "../src/metrics.js"

const root = join(dirname(fileURLToPath(import.meta.url)), "../../..")

/**
 * Regression guard for the committed calibration: six held-out matches (seeds the tuner never saw)
 * with data/params/touchline-params.json must stay close to the real-match targets. If an engine
 * change breaks this, re-run `pnpm calibrate` and `pnpm realism`, then commit the new params and report.
 */
describe("realism gate", () => {
  it("held-out matches with the committed parameters stay close to real matches", () => {
    const league = JSON.parse(readFileSync(join(root, "data/league/league.json"), "utf8")) as League
    const targets = JSON.parse(readFileSync(join(root, "data/params/targets-idsse.json"), "utf8")) as Targets
    const params = paramsFromJson(JSON.parse(readFileSync(join(root, "data/params/touchline-params.json"), "utf8")))
    const runs = Array.from({ length: 6 }, (_, i) => {
      const [h, a] = FIXTURES[i % FIXTURES.length]!
      const cfg = { matchId: `gate-${i}`, seed: 3000 + i, kickoffTime: "2026-10-18T14:00:00.000Z", home: league.clubs.find((c) => c.id === h)!, away: league.clubs.find((c) => c.id === a)!, params, dt: 0.1 }
      const { events, frames } = runMatch(cfg)
      return matchMetrics(events, frames, cfg.dt)
    })
    const sim = meanMetrics(runs)
    const z = Object.fromEntries(SCALAR_KEYS.map((k) => [k, (sim[k] - targets.metrics[k]!.mean) / scaleOf(targets.metrics[k]!)]))
    console.log("realism gate", JSON.stringify({ loss: Number(loss(sim, targets).toFixed(2)), z: Object.fromEntries(Object.entries(z).map(([k, v]) => [k, Number(v.toFixed(2))])) }))
    for (const k of SCALAR_KEYS) expect(Math.abs(z[k]!), k).toBeLessThan(GATE_Z)
    expect(loss(sim, targets)).toBeLessThan(GATE_LOSS)
  })
})

const GATE_Z = 3
const GATE_LOSS = 30

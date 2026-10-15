import { existsSync, readFileSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "vitest"
import type { League } from "@touchline/league"
import { paramsFromJson } from "@touchline/sim-core"
import { FIXTURES, loss, runMatch, scaleOf, type Targets } from "../src/evaluate.js"
import { DRIFT_Z, driftZ, GATE_KEYS, GATE_SEEDS, summarize, type Baseline } from "../src/gate.js"
import { matchMetrics, SCALAR_KEYS } from "../src/metrics.js"
import { physicsGate, playerMetrics, rolesOf, simHalves, simTracks, workRate, type HalfTracks, type PhysicsFile, type Track } from "../src/physics.js"

const root = join(dirname(fileURLToPath(import.meta.url)), "../../..")
const baselinePath = join(root, "data/params/realism-baseline.json")

/**
 * Regression guard for the committed calibration, on held-out seeds the tuner never saw:
 * (1) the statistics must not drift from the committed baseline of the same seeds (two-sample z, standard error), and
 * (2) they must stay close to the real-match targets, with at least as many statistics within 1 and 2 SD as before the
 *     fitted physics (spec P5);
 * (3) the player movement statistics inside the real inter-match envelope must not fall below the count achieved (a known
 *     gap, spec P3), and the work rate by period is reported (spec P7).
 * After an intended engine change: re-run `pnpm calibrate` and `pnpm realism`, then refresh the baseline with
 * `UPDATE_REALISM_BASELINE=1 pnpm --filter @touchline/calibrate test realism-gate` and commit all three.
 */
describe("realism gate", () => {
  // 16 full matches: about two minutes, longer on a loaded machine.
  it("held-out matches with the committed parameters match the baseline and stay close to real matches", () => {
    const league = JSON.parse(readFileSync(join(root, "data/league/league.json"), "utf8")) as League
    const targets = JSON.parse(readFileSync(join(root, "data/params/targets-idsse.json"), "utf8")) as Targets
    const params = paramsFromJson(JSON.parse(readFileSync(join(root, "data/params/touchline-params.json"), "utf8")))
    const tracks = new Map<string, Track>()
    const halves = new Map<string, HalfTracks>()
    const runs = GATE_SEEDS.map((seed, i) => {
      const [h, a] = FIXTURES[i % FIXTURES.length]!
      const cfg = { matchId: `gate-${i}`, seed, kickoffTime: "2026-10-18T14:00:00.000Z", home: league.clubs.find((c) => c.id === h)!, away: league.clubs.find((c) => c.id === a)!, params, dt: 0.1 }
      const { events, frames } = runMatch(cfg)
      for (const [id, t] of simTracks(frames, rolesOf(cfg))) tracks.set(`${seed}-${id}`, t)
      for (const [id, t] of simHalves(frames, rolesOf(cfg))) halves.set(`${seed}-${id}`, t)
      return matchMetrics(events, frames, cfg.dt)
    })
    const now = summarize(runs)
    if (process.env.UPDATE_REALISM_BASELINE) {
      const b: Baseline = { note: "realism-gate statistics of the committed engine and parameters", seeds: GATE_SEEDS, ...now }
      writeFileSync(baselinePath, JSON.stringify(b, null, 1) + "\n")
    }
    expect(existsSync(baselinePath), "data/params/realism-baseline.json is missing").toBe(true)
    const baseline = JSON.parse(readFileSync(baselinePath, "utf8")) as Baseline
    const drift = driftZ(now.mean, baseline, runs.length)
    const z = Object.fromEntries(SCALAR_KEYS.map((k) => [k, (now.mean[k] - targets.metrics[k]!.mean) / scaleOf(targets.metrics[k]!)]))
    console.log("realism gate", JSON.stringify({ loss: Number(loss(now.mean, targets).toFixed(2)), maxDrift: Number(Math.max(...Object.values(drift).map(Math.abs)).toFixed(2)) }))
    for (const k of GATE_KEYS) expect(Math.abs(drift[k]), `${k} drifted from the baseline`).toBeLessThan(DRIFT_Z)
    for (const k of SCALAR_KEYS) expect(Math.abs(z[k]!), `${k} vs real`).toBeLessThan(GATE_Z)
    expect(loss(now.mean, targets)).toBeLessThan(GATE_LOSS)
    expect(SCALAR_KEYS.filter((k) => Math.abs(z[k]!) < 1).length).toBeGreaterThanOrEqual(WITHIN_1SD)
    expect(SCALAR_KEYS.filter((k) => Math.abs(z[k]!) < 2).length).toBeGreaterThanOrEqual(WITHIN_2SD)

    const physics = JSON.parse(readFileSync(join(root, "data/params/physics.json"), "utf8")) as PhysicsFile
    const rows = physicsGate(playerMetrics(tracks), physics)
    const work = workRate(halves)
    console.log("physics gate", JSON.stringify({ inside: rows.filter((r) => r.pass).map((r) => r.key), lateRatio: work.lateRatio, distance: work.distance.ALL!.map((v) => Number(v.toFixed(1))) }))
    expect(rows.length).toBe(13)
    expect(rows.filter((r) => r.pass).length).toBeGreaterThanOrEqual(PHYSICS_INSIDE)
    expect(work.distance.ALL).toHaveLength(6)
  }, 300_000)
})

const GATE_Z = 3
const GATE_LOSS = 30
// Before the fitted physics (2026-10-09): 11 within 1 SD, 17 within 2 SD.
const WITHIN_1SD = 11
const WITHIN_2SD = 17
// Player movement statistics inside the real envelope with the fitted physics (max_speed only): a known gap, spec P3.
const PHYSICS_INSIDE = 2

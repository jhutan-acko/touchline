import { execFileSync, spawnSync } from "node:child_process"
import { mkdtempSync, readFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { Effect } from "effect"
import { describe, expect, it } from "vitest"
import type { League } from "@touchline/league"
import { writeMatch } from "@touchline/sim"
import { DEFAULT_PARAMS } from "@touchline/sim-core"
import { runMatch } from "../src/evaluate.js"
import { matchMetrics, SCALAR_KEYS } from "../src/metrics.js"

const root = join(dirname(fileURLToPath(import.meta.url)), "../../..")
const hasUv = spawnSync("uv", ["--version"]).status === 0

describe("metric parity", () => {
  // In CI the test must run: a missing uv fails it rather than skipping it.
  it.skipIf(!hasUv && !process.env.CI)("TypeScript and Python compute identical statistics for the same synthetic match", async () => {
    const league = JSON.parse(readFileSync(join(root, "data/league/league.json"), "utf8")) as League
    const cfg = { matchId: "parity", seed: 4242, kickoffTime: "2026-10-18T14:00:00.000Z", home: league.clubs[0]!, away: league.clubs[3]!, params: DEFAULT_PARAMS, dt: 0.1 }
    const dir = mkdtempSync(join(tmpdir(), "touchline-parity-"))
    await Effect.runPromise(writeMatch(cfg, dir))
    const py = JSON.parse(
      execFileSync("uv", ["run", "--locked", "--project", join(root, "python/analytics"), "python", "-m", "touchline_analytics.metrics", dir], { encoding: "utf8", maxBuffer: 1 << 26 })
    ) as Record<string, number | number[]>
    const { events, frames } = runMatch(cfg)
    const ts = matchMetrics(events, frames, cfg.dt)
    for (const k of SCALAR_KEYS) expect(ts[k], k).toBeCloseTo(py[k] as number, 9)
    // Histograms: Math.hypot and math.hypot may differ in the last bit, which can move a sample sitting
    // exactly on a bin edge into the neighbouring bin (one sample in ~45,000 = 2e-5), hence 1e-3.
    ts.pass_len_hist.forEach((v, i) => expect(v).toBeCloseTo((py.pass_len_hist as number[])[i]!, 3))
    ts.speed_hist.forEach((v, i) => expect(v).toBeCloseTo((py.speed_hist as number[])[i]!, 3))
  })
})

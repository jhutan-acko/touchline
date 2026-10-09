import { execFileSync, spawnSync } from "node:child_process"
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "vitest"
import type { League } from "@touchline/league"
import { DEFAULT_PARAMS } from "@touchline/sim-core"
import { runMatch } from "../src/evaluate.js"
import { hist, physicsGate, PLAYER_EDGES, playerMetrics, playerSamples, rolesOf, simTracks, w1, type Point, type Tracks } from "../src/physics.js"

const root = join(dirname(fileURLToPath(import.meta.url)), "../../..")
const hasUv = spawnSync("uv", ["--version"]).status === 0

/** 10 Hz track running at each (speed, seconds) in turn along x. */
const run = (legs: ReadonlyArray<readonly [number, number]>): Point[] => {
  const out: Point[] = [[0, 0]]
  let x = 0
  for (const [v, s] of legs) for (let i = 0; i < s * 10; i++) out.push([(x += v * 0.1), 0])
  return out
}

describe("player movement statistics", () => {
  it("W1 is the area between two histograms' CDFs", () => {
    const e = [0, 1, 2, 3]
    expect(w1([1, 0, 0], [1, 0, 0], e)).toBe(0)
    expect(w1([1, 0, 0], [0, 1, 0], e)).toBeCloseTo(1, 12)
    expect(w1([1, 0, 0], [0, 0, 1], e)).toBeCloseTo(2, 12)
    expect(w1([0.5, 0.5, 0], [0, 0.5, 0.5], e)).toBeCloseTo(1, 12)
  })
  it("histograms clip into the end bins", () => {
    expect(hist([-5, 0.5, 1.5, 99], [0, 1, 2])).toEqual([0.5, 0.5])
    expect(hist([], [0, 1, 2])).toEqual([0, 0])
  })
  it("measure speed, high-speed running and efforts, and never across a gap", () => {
    const tracks: Tracks = new Map([
      ["j", { group: "MID", xy: run([[3, 2700]]) }],
      ["r", { group: "FWD", xy: run([[3, 600], [7, 60], [3, 600], [7, 60], [3, 1380]]) }],
      ["g", { group: "DEF", xy: [...run([[3, 2000]]), null, ...run([[3, 2000]]).map((p) => [p![0] + 50, p![1] + 20] as const)] }]
    ])
    const s = playerSamples(tracks)
    expect(s.max_speed![0]).toBeCloseTo(3, 9)
    expect(s.max_speed![1]).toBeCloseTo(7, 9)
    expect(s.max_speed![2]).toBeCloseTo(3, 9)
    expect(s.hsr20![1]).toBeCloseTo(1680, -1)
    expect(s.acc_count![1]).toBeCloseTo(4, 2)
    expect(s.dec_count![1]).toBeCloseTo(4, 2)
    expect(Object.keys(playerMetrics(tracks))).toEqual(Object.keys(PLAYER_EDGES))
  })
  it("the gate compares each statistic with the real matches' envelope", () => {
    const real = Object.fromEntries(Object.entries(PLAYER_EDGES).map(([k, e]) => [k, hist([e[1]!], e)]))
    const sim = { ...real, max_speed: hist([9.6], PLAYER_EDGES.max_speed!) }
    const envelope = Object.fromEntries(Object.keys(PLAYER_EDGES).map((k) => [k, { max: 0.5 }]))
    const rows = physicsGate(sim, { validation: { envelope, real: { players: real } } })
    expect(rows.find((r) => r.key === "max_speed")!.pass).toBe(false)
    expect(rows.filter((r) => r.key !== "max_speed").every((r) => r.pass && r.w1 === 0)).toBe(true)
  })
})

describe("player statistics parity", () => {
  // In CI the test must run: a missing uv fails it rather than skipping it.
  it.skipIf(!hasUv && !process.env.CI)("TypeScript and Python give the same histograms for a simulated match", () => {
    const league = JSON.parse(readFileSync(join(root, "data/league/league.json"), "utf8")) as League
    const cfg = { matchId: "phys-parity", seed: 4243, kickoffTime: "2026-10-18T14:00:00.000Z", home: league.clubs[1]!, away: league.clubs[2]!, params: DEFAULT_PARAMS, dt: 0.1 }
    const tracks = simTracks(runMatch(cfg).frames, rolesOf(cfg))
    expect(tracks.size).toBeGreaterThanOrEqual(22)
    const file = join(mkdtempSync(join(tmpdir(), "touchline-physics-")), "tracks.json")
    writeFileSync(file, JSON.stringify(Object.fromEntries([...tracks].map(([id, t]) => [id, t]))))
    const py = JSON.parse(
      execFileSync("uv", ["run", "--locked", "--project", join(root, "python/analytics"), "python", "-m", "touchline_analytics.physics.validate", file], { encoding: "utf8", maxBuffer: 1 << 26 })
    ) as Record<string, number[]>
    const ts = playerMetrics(tracks)
    // Math.hypot and math.hypot may differ in the last bit, which can move a sample sitting exactly on a bin edge into
    // the neighbouring bin (as in the match-statistics parity test), hence 1e-3.
    for (const k of Object.keys(PLAYER_EDGES)) ts[k]!.forEach((v, i) => expect(v, `${k}[${i}]`).toBeCloseTo(py[k]![i]!, 3))
  })
})

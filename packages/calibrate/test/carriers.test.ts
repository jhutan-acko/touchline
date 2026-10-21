import { execFileSync, spawnSync } from "node:child_process"
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "vitest"
import type { League } from "@touchline/league"
import { DEFAULT_PARAMS, paramsFromJson } from "@touchline/sim-core"
import { MIN_S, simCarrierHalves, stillCarriers, type CarrierHalf } from "../src/carriers.js"
import { runMatch } from "../src/evaluate.js"
import { rolesOf } from "../src/physics.js"

const root = join(dirname(fileURLToPath(import.meta.url)), "../../..")
const league = JSON.parse(readFileSync(join(root, "data/league/league.json"), "utf8")) as League
const hasUv = spawnSync("uv", ["--version"]).status === 0

const still = (n: number, x = 0): Array<[number, number]> => Array.from({ length: n }, () => [x, 0])
const walking = (n: number, v: number, x0 = 0): Array<[number, number]> => Array.from({ length: n }, (_, i) => [x0 + (i * v) / 10, 0])
const half = (ball: Array<[number, number]>, players: Record<string, Array<[number, number] | null>>, o: { live?: boolean[]; keepers?: string[] } = {}): CarrierHalf => ({
  ball, live: o.live ?? ball.map(() => true), players: new Map(Object.entries(players)), keepers: new Set(o.keepers ?? [])
})

describe("frozen ball carriers", () => {
  it("count a still ball at a still player's feet once the stretch lasts long enough", () => {
    const out = stillCarriers([half(still(40), { a: still(40, 0.4), far: walking(40, 3, 20) })])
    expect(out.outfield).toEqual({ count: 1, seconds: 3.9, longest: 3.9 })
    expect(out.GK).toEqual({ count: 0, seconds: 0, longest: 0 })
    const n = MIN_S * 10
    expect(stillCarriers([half(still(n), { a: still(n, 0.4) })]).outfield.count).toBe(0)
  })

  it("count keepers apart, and not dead balls, moving carriers, nobody near, or across a missing position", () => {
    expect(stillCarriers([half(still(40), { gk: still(40, 0.4) }, { keepers: ["gk"] })]).GK.count).toBe(1)
    expect(stillCarriers([half(still(40), { a: still(40, 0.4) }, { live: Array(40).fill(false) })]).outfield.count).toBe(0)
    expect(stillCarriers([half(walking(40, 1, 0.3), { a: walking(40, 1) })]).outfield.count).toBe(0)
    expect(stillCarriers([half(still(40), { a: still(40, 3) })]).outfield.count).toBe(0)
    const gap: Array<[number, number] | null> = still(60, 0.4)
    gap[25] = null
    expect(stillCarriers([half(still(60), { a: gap })]).outfield).toEqual({ count: 2, seconds: 5.7, longest: 3.3 })
  })

  // Seed 4246: the first from 4243 on whose match has a still stretch (since the keeper-in-hands rule few do; re-picked for P2, again for Task 8b,
  // again for P3 Task 10d support rule 1, which left 4248 with none, for P4 Task 10, which left 4243 with none, and for P6
  // Task 8, which left 4244 and 4245 with none).
  it.skipIf(!hasUv)("agree with the Python definition on a simulated match", () => {
    const cfg = { matchId: "carrier-parity", seed: 4246, kickoffTime: "2026-10-18T14:00:00.000Z", home: league.clubs[1]!, away: league.clubs[2]!, params: DEFAULT_PARAMS, dt: 0.1 }
    const halves = simCarrierHalves(runMatch(cfg).frames, rolesOf(cfg))
    expect(halves).toHaveLength(2)
    const file = join(mkdtempSync(join(tmpdir(), "touchline-carriers-")), "halves.json")
    writeFileSync(file, JSON.stringify(halves.map((h) => ({ ball: h.ball, live: h.live, players: Object.fromEntries(h.players), keepers: [...h.keepers] }))))
    const py = JSON.parse(execFileSync("uv", ["run", "--locked", "--project", join(root, "python/analytics"), "python", "-m", "touchline_analytics.carriers", "--halves", file], { encoding: "utf8", maxBuffer: 1 << 26 }))
    const ts = stillCarriers(halves)
    expect(ts).toEqual(py)
    expect(ts.GK.count + ts.outfield.count).toBeGreaterThan(0)
  }, 120_000)
})

describe("the engine's ball carriers", () => {
  /** Real football (data/params/still-carriers.json): outfielders freeze on the ball 0–1 times a match, keepers stand still with it at most 5 times and for at most 15.8 s. */
  const real = JSON.parse(readFileSync(join(root, "data/params/still-carriers.json"), "utf8")) as { real: Record<"GK" | "outfield", Record<"count" | "seconds", { max: number }>> }
  const params = paramsFromJson(JSON.parse(readFileSync(join(root, "data/params/touchline-params.json"), "utf8")))

  it("keep the ball moving about as rarely still as real players do: never frozen on it for seconds at a time", () => {
    for (const [seed, home, away] of [[11, 0, 3], [12, 4, 6]] as const) {
      const cfg = { matchId: `carriers-${seed}`, seed, kickoffTime: "2026-10-18T14:00:00.000Z", home: league.clubs[home]!, away: league.clubs[away]!, params, dt: 0.1 }
      const s = stillCarriers(simCarrierHalves(runMatch(cfg).frames, rolesOf(cfg)))
      expect(s.outfield.count, `seed ${seed}: outfield stretches`).toBeLessThanOrEqual(real.real.outfield.count.max + 1)
      expect(s.GK.count, `seed ${seed}: keeper stretches`).toBeLessThanOrEqual(real.real.GK.count.max)
      expect(s.GK.seconds, `seed ${seed}: keeper seconds`).toBeLessThanOrEqual(real.real.GK.seconds.max)
    }
  }, 300_000)
})

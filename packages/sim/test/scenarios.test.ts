import { readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "vitest"
import type { League } from "@touchline/league"
import { paramsFromJson, runScript } from "@touchline/sim-core"
import { SCENARIOS } from "../src/scenarios.js"

const root = join(dirname(fileURLToPath(import.meta.url)), "../../..")
const league = JSON.parse(readFileSync(join(root, "data/league/league.json"), "utf8")) as League
const params = paramsFromJson(JSON.parse(readFileSync(join(root, "data/params/touchline-params.json"), "utf8")))
const club = (id: string) => league.clubs.find((c) => c.id === id)!

describe("built-in scenarios", () => {
  it("use clubs of the league and windows in match order", () => {
    for (const [name, sc] of Object.entries(SCENARIOS)) {
      expect(sc.script.name).toBe(name)
      expect(club(sc.home), name).toBeDefined()
      expect(club(sc.away), name).toBeDefined()
      for (const e of sc.script.entries) expect(e.window[0], name).toBeLessThan(e.window[1])
    }
  })
  // Spec §5.1.1: scripts achieve their target in at least 90 % of seeds without forcing an outcome.
  for (const [name, sc] of Object.entries(SCENARIOS)) {
    if (sc.script.entries.length === 0) continue
    it(`${name} reaches its target without forcing in at least 9 of 10 seeds`, () => {
      let unforced = 0
      for (let seed = 1; seed <= 10; seed++) {
        const run = runScript({ matchId: name, seed, kickoffTime: "2026-10-18T14:00:00.000Z", home: club(sc.home), away: club(sc.away), params, dt: 0.1, script: sc.script })
        if (run.windows.every((w) => w.achieved && !w.forced)) unforced++
      }
      expect(unforced).toBeGreaterThanOrEqual(9)
    })
  }
})

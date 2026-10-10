/** What every A/B match needs, loaded from the repo: the league, the calibrated params and the stats models. */
import { readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import type { League } from "@touchline/league"
import { paramsFromJson, type MatchConfig } from "@touchline/sim-core"
import { modelsFromJson, xtGridFromJson } from "@touchline/stats"
import type { Fixture } from "./match.js"

export const root = join(dirname(fileURLToPath(import.meta.url)), "../../../..")
const json = (p: string) => JSON.parse(readFileSync(join(root, p), "utf8"))

export const loadSetup = () => {
  const league = json("data/league/league.json") as League
  const params = paramsFromJson(json("data/params/touchline-params.json"))
  const stats = { models: modelsFromJson(json("data/params/stats-models.json")), xt: xtGridFromJson(json("data/params/xt-grid.json")) }
  const config = (f: Fixture): MatchConfig => ({
    matchId: `ab-${f.seed}`, seed: f.seed, kickoffTime: "2026-10-18T14:00:00.000Z",
    home: league.clubs.find((c) => c.id === f.home)!, away: league.clubs.find((c) => c.id === f.away)!, params, dt: 0.1
  })
  return { league, clubs: league.clubs.map((c) => c.id), stats, config }
}

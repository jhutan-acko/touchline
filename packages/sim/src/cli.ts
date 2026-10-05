import { existsSync, readFileSync } from "node:fs"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { Effect } from "effect"
import type { League } from "@touchline/league"
import { DEFAULT_PARAMS, ParamsError, paramsFromJson, type Params } from "@touchline/sim-core"
import { CliError, cliOptions, exitOnUserError, integer, isoTime, oneOf, safeName } from "./args.js"
import { SCENARIOS } from "./scenarios.js"
import { writeMatch } from "./writer.js"

const root = join(dirname(fileURLToPath(import.meta.url)), "../../..")
// pnpm runs package scripts from the package folder; INIT_CWD is where the user typed the command.
const here = (p: string) => resolve(process.env.INIT_CWD ?? process.cwd(), p)
const league = JSON.parse(readFileSync(join(root, "data/league/league.json"), "utf8")) as League
const clubIds = league.clubs.map((c) => c.id)
const defaultParams = join(root, "data/params/touchline-params.json")

const o = cliOptions("touchline-sim: simulate one match and write CDF, domain events and a run manifest", {
  seed: { default: "1", check: integer(0, 4294967295), help: "match seed" },
  scenario: { default: "", check: oneOf(Object.keys(SCENARIOS)), help: `built-in scenario script (${Object.keys(SCENARIOS).join(", ")})` },
  home: { default: "", check: oneOf(clubIds), help: "home club id (default: the scenario's, else ironmoor)" },
  away: { default: "", check: oneOf(clubIds), help: "away club id (default: the scenario's, else kestrel-bay)" },
  fps: { default: "10", check: oneOf(["10", "25"]), help: "tracking frames per second" },
  kickoff: { default: "2026-10-18T14:00:00.000Z", check: isoTime, help: "kickoff time, ISO 8601 UTC" },
  "match-id": { default: "", check: safeName, help: "match id (default m-<seed>); also the output folder name" },
  // Calibrated parameters (Plan 2a) load by default; "default" uses the hand-set priors.
  params: { default: existsSync(defaultParams) ? defaultParams : "default", help: "parameter file, or \"default\" for hand-set priors" },
  out: { default: "", help: "output folder (default out/<match-id>)" }
})

const params: Params = exitOnUserError(() => {
  if (o.params === "default") return DEFAULT_PARAMS
  try {
    return paramsFromJson(JSON.parse(readFileSync(here(o.params), "utf8")))
  } catch (e) {
    throw new CliError(`Cannot use params file ${o.params}: ${e instanceof ParamsError ? e.message : String(e)}`)
  }
})
const scenario = o.scenario ? SCENARIOS[o.scenario]! : null
const home = o.home || scenario?.home || "ironmoor"
const away = o.away || scenario?.away || "kestrel-bay"
exitOnUserError(() => {
  if (home === away) throw new CliError("--home and --away must be different clubs")
})
const seed = Number(o.seed)
const matchId = o["match-id"] || `m-${seed}`
const club = (id: string) => league.clubs.find((c) => c.id === id)!
const cfg = { matchId, seed, kickoffTime: o.kickoff, home: club(home), away: club(away), params, dt: 1 / Number(o.fps), ...(scenario ? { script: scenario.script } : {}) }
const out = here(o.out || join(root, "out", matchId))
Effect.runPromise(writeMatch(cfg, out)).then((m) => console.log(`${out}: ${JSON.stringify(m.stats)}`))

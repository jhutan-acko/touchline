/**
 * touchline-manage: simulate one match with managers (Plan 4b) and write its run folder with decisions.jsonl.
 *   pnpm manage --seed 5001 --home ironmoor --away saltmarsh --home-manager agent --away-manager rules
 *   pnpm manage --replay out/m-5001/decisions.jsonl --seed 5001 --home ironmoor --away saltmarsh   (no model calls)
 * The agent manager needs the agent service (pnpm agents serve, or touchline-agents) at --agents-url.
 */
import { existsSync, readFileSync } from "node:fs"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { Effect } from "effect"
import { a2aSender } from "@touchline/agent-gateway"
import type { League } from "@touchline/league"
import { CliError, cliOptions, exitOnUserError, integer, isoTime, oneOf, positiveInteger, safeName } from "@touchline/sim"
import { DEFAULT_PARAMS, paramsFromJson } from "@touchline/sim-core"
import { modelsFromJson, xtGridFromJson } from "@touchline/stats"
import { agentManager } from "./agent.js"
import type { Manager } from "./decision.js"
import { replayManager } from "./replay.js"
import { rulesManager } from "./rules.js"
import { readDecisions, writeManaged } from "./write.js"

const root = join(dirname(fileURLToPath(import.meta.url)), "../../..")
const here = (p: string) => resolve(process.env.INIT_CWD ?? process.cwd(), p)
const json = (p: string) => JSON.parse(readFileSync(join(root, p), "utf8"))
const league = json("data/league/league.json") as League
const clubIds = league.clubs.map((c) => c.id)
const defaultParams = join(root, "data/params/touchline-params.json")
const MANAGERS = ["none", "rules", "agent"]

const o = cliOptions("touchline-manage: simulate one match with managers and write its run folder, decisions.jsonl included", {
  seed: { default: "1", check: integer(0, 4294967295), help: "match seed" },
  home: { default: "ironmoor", check: oneOf(clubIds), help: "home club id" },
  away: { default: "kestrel-bay", check: oneOf(clubIds), help: "away club id" },
  "home-manager": { default: "rules", check: oneOf(MANAGERS), help: "the home team's manager (none, rules, agent)" },
  "away-manager": { default: "rules", check: oneOf(MANAGERS), help: "the away team's manager (none, rules, agent)" },
  replay: { default: "", help: "a decisions.jsonl to replay instead of deciding (same seed and clubs; no model calls)" },
  "agents-url": { default: "http://127.0.0.1:8100/", help: "the agent service (A2A) for agent managers" },
  "whatif-seeds": { default: "20", check: positiveInteger, help: "forks per option when an agent's options are tested" },
  "whatif-horizon": { default: "600", check: positiveInteger, help: "seconds each fork plays" },
  fps: { default: "10", check: oneOf(["10", "25"]), help: "tracking frames per second" },
  kickoff: { default: "2026-10-18T14:00:00.000Z", check: isoTime, help: "kickoff time, ISO 8601 UTC" },
  "match-id": { default: "", check: safeName, help: "match id (default m-<seed>); also the output folder name" },
  params: { default: existsSync(defaultParams) ? defaultParams : "default", help: "parameter file, or \"default\" for hand-set priors" },
  out: { default: "", help: "output folder (default out/<match-id>)" }
})

const params = o.params === "default" ? DEFAULT_PARAMS : paramsFromJson(JSON.parse(readFileSync(here(o.params), "utf8")))
const seed = Number(o.seed)
const matchId = o["match-id"] || `m-${seed}`
const club = (id: string) => league.clubs.find((c) => c.id === id)!
exitOnUserError(() => {
  if (o.home === o.away) throw new CliError("--home and --away must be different clubs")
})
const cfg = { matchId, seed, kickoffTime: o.kickoff, home: club(o.home), away: club(o.away), params, dt: 1 / Number(o.fps) }

const managers: Partial<Record<"home" | "away", Manager>> = exitOnUserError(() => {
  if (o.replay) {
    if (!existsSync(here(o.replay))) throw new CliError(`no decision log at ${o.replay}`)
    const logged = readDecisions(here(o.replay))
    const replay = replayManager(logged)
    return Object.fromEntries((["home", "away"] as const).filter((s) => logged.some((d) => d.side === s)).map((s) => [s, replay]))
  }
  const send = a2aSender(o["agents-url"])
  const whatif = { seeds: Number(o["whatif-seeds"]), horizonS: Number(o["whatif-horizon"]) }
  const make = (kind: string): Manager | undefined => (kind === "rules" ? rulesManager : kind === "agent" ? agentManager(send, { whatif }) : undefined)
  return Object.fromEntries((["home", "away"] as const).flatMap((s) => {
    const m = make(o[`${s}-manager`])
    return m ? [[s, m]] : []
  }))
})

const out = here(o.out || join(root, "out", matchId))
const stats = { models: modelsFromJson(json("data/params/stats-models.json")), xt: xtGridFromJson(json("data/params/xt-grid.json")) }
Effect.runPromise(writeManaged(cfg, managers, out, stats)).then((m) => console.log(`${out}: ${JSON.stringify({ ...m.stats, managers: m.managers })}`))

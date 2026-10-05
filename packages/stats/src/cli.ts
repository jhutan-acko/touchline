import { existsSync, readFileSync, writeFileSync } from "node:fs"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { Effect, Stream } from "effect"
import { CliError, cliOptions, exitOnUserError } from "@touchline/sim"
import { StatsEngine } from "./engine.js"
import { modelsFromJson } from "./models.js"
import { readRun, ReplayError, type Roster } from "./replay.js"
import { signalStream } from "./stream.js"
import { summary } from "./summary.js"

const root = join(dirname(fileURLToPath(import.meta.url)), "../../..")
// pnpm runs package scripts from the package folder; INIT_CWD is where the user typed the command.
const here = (p: string) => resolve(process.env.INIT_CWD ?? process.cwd(), p)

const o = cliOptions("touchline-stats: replay a run folder through the stats engine and print metrics and signals", {
  run: { default: "", help: "run folder written by pnpm sim (meta.json, domain.jsonl, tracking.jsonl)" },
  signals: { default: "", help: "also write every signal to this JSONL file" }
})
exitOnUserError(() => {
  if (o.run === "") throw new CliError("--run is required (a folder written by pnpm sim, e.g. out/m-1)")
})
const models = modelsFromJson(JSON.parse(readFileSync(join(root, "data/params/stats-models.json"), "utf8")))
const leaguePath = join(root, "data/league/league.json")
const roster = existsSync(leaguePath) ? (JSON.parse(readFileSync(leaguePath, "utf8")) as Roster) : undefined

const program = Effect.gen(function* () {
  const run = yield* readRun(here(o.run), roster)
  const engine = new StatsEngine(run.info, models)
  const signals = Array.from(yield* Stream.runCollect(signalStream(engine, run.inputs)))
  if (o.signals) writeFileSync(here(o.signals), signals.map((s) => JSON.stringify(s)).join("\n") + "\n")
  console.log(summary(engine))
})
Effect.runPromise(program).catch((e) => {
  if (e instanceof ReplayError) {
    console.error(e.message)
    process.exit(2)
  }
  throw e
})

import { mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import type { League } from "@touchline/league"
import { CliError, cliOptions, exitOnUserError, positiveInteger } from "@touchline/sim"
import { DEFAULT_PARAMS } from "@touchline/sim-core"
import type { Targets } from "./evaluate.js"
import { applyKnobs, KNOBS } from "./knobs.js"
import { GATE_KEYS } from "./gate.js"
import { withPhysics, type PhysicsFile } from "./physics.js"
import { createPool, defaultWorkers } from "./pool.js"
import { tune } from "./tune.js"

const root = join(dirname(fileURLToPath(import.meta.url)), "../../..")
const here = (p: string) => resolve(process.env.INIT_CWD ?? process.cwd(), p)
const o = cliOptions("calibrate: tune engine knobs to real-match targets (method of simulated moments)", {
  targets: { default: join(root, "data/params/targets-idsse.json"), help: "real-match targets file" },
  // Experiments never overwrite the committed parameters by accident: pass --out data/params/touchline-params.json to update them.
  out: { default: join(root, "out/touchline-params.json"), help: "where to write the tuned parameters" },
  matches: { default: "8", check: positiveInteger, help: "simulated matches per evaluation" },
  rounds: { default: "3", check: positiveInteger, help: "coordinate-search rounds" },
  // --from <file>: continue from that file's calibration knobs instead of the defaults.
  from: { default: "", help: "start from the calibration.knobs of this file" },
  workers: { default: String(defaultWorkers()), check: positiveInteger, help: "worker threads evaluating matches in parallel (1 = serial, in-process)" },
  // The fitted physics is fixed: the tuner calibrates behaviour on top of it.
  physics: { default: join(root, "data/params/physics.json"), help: "physics fit (physics.json), or \"none\" for the literature defaults" }
})
const outPath = here(o.out)
// Make the output folder now: a tuning chunk runs for most of an hour and must not fail when it writes its result.
exitOnUserError(() => {
  try {
    mkdirSync(dirname(outPath), { recursive: true })
  } catch (e) {
    throw new CliError(`Cannot write to ${o.out}: ${e instanceof Error ? e.message : String(e)}`)
  }
})
const matches = Number(o.matches)
const rounds = Number(o.rounds)
/** Read a JSON input file; a missing or malformed file is a one-line error (exit 2). */
const readJson = (what: string, path: string): unknown =>
  exitOnUserError(() => {
    try {
      return JSON.parse(readFileSync(here(path), "utf8"))
    } catch (e) {
      throw new CliError(`Cannot read ${what} file ${path}: ${e instanceof Error ? e.message : String(e)}`)
    }
  })
const start = o.from ? (readJson("start", o.from) as { calibration?: { knobs?: Record<string, number> } }).calibration?.knobs ?? {} : {}

const league = JSON.parse(readFileSync(join(root, "data/league/league.json"), "utf8")) as League
const targets = readJson("targets", o.targets) as Targets
const base = o.physics === "none" ? DEFAULT_PARAMS : withPhysics(DEFAULT_PARAMS, readJson("physics", o.physics) as PhysicsFile)
const t0 = Date.now()
const pool = createPool(league, Number(o.workers))
let res: Awaited<ReturnType<typeof tune>>
try {
  res = await tune(league, base, targets, {
    matches,
    rounds,
    start,
    pool,
    onEval: (evals, loss) => process.stdout.write(`eval ${evals}: loss ${loss.toFixed(2)} (${Math.round((Date.now() - t0) / 1000)} s)\n`)
  })
} finally {
  await pool.close()
}
const today = new Date().toISOString().slice(0, 10)
const tuned = applyKnobs(base, res.knobs)
const out = {
  ...tuned,
  provenance: {
    dataset: `calibrated by simulated moments against ${targets.provenance.dataset}`,
    licence: targets.provenance.licence,
    attribution: targets.provenance.attribution,
    fitted_at: today,
    version: `calib-${today}`
  },
  calibration: {
    method: "coordinate search on engine knobs, minimising weighted squared z-scores of match statistics (common random numbers)",
    targets: targets.provenance.version,
    matches,
    rounds,
    evals: res.evals,
    loss: Number(res.loss.toFixed(3)),
    knobs: Object.fromEntries(KNOBS.map((k) => [k.name, res.knobs[k.name]])),
    simulated: Object.fromEntries(GATE_KEYS.map((k) => [k, Number(res.detail[k].toFixed(4))])),
    real: Object.fromEntries(GATE_KEYS.map((k) => [k, targets.metrics[k]?.mean ?? null]))
  }
}
writeFileSync(outPath, JSON.stringify(out, null, 1) + "\n")
console.log(`wrote ${outPath}: loss ${res.loss.toFixed(2)} after ${res.evals} evaluations`)

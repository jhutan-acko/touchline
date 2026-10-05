import { readFileSync, writeFileSync } from "node:fs"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import type { League } from "@touchline/league"
import { cliOptions, positiveInteger } from "@touchline/sim"
import { DEFAULT_PARAMS } from "@touchline/sim-core"
import type { Targets } from "./evaluate.js"
import { applyKnobs, KNOBS } from "./knobs.js"
import { SCALAR_KEYS } from "./metrics.js"
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
  from: { default: "", help: "start from the calibration.knobs of this file" }
})
const targetsPath = here(o.targets)
const outPath = here(o.out)
const matches = Number(o.matches)
const rounds = Number(o.rounds)
const start = o.from ? (JSON.parse(readFileSync(here(o.from), "utf8")) as { calibration?: { knobs?: Record<string, number> } }).calibration?.knobs ?? {} : {}

const league = JSON.parse(readFileSync(join(root, "data/league/league.json"), "utf8")) as League
const targets = JSON.parse(readFileSync(targetsPath, "utf8")) as Targets
const t0 = Date.now()
const res = tune(league, DEFAULT_PARAMS, targets, {
  matches,
  rounds,
  start,
  onEval: (evals, loss) => process.stdout.write(`eval ${evals}: loss ${loss.toFixed(2)} (${Math.round((Date.now() - t0) / 1000)} s)\n`)
})
const today = new Date().toISOString().slice(0, 10)
const tuned = applyKnobs(DEFAULT_PARAMS, res.knobs)
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
    simulated: Object.fromEntries(SCALAR_KEYS.map((k) => [k, Number(res.detail[k].toFixed(4))])),
    real: Object.fromEntries(SCALAR_KEYS.map((k) => [k, targets.metrics[k]?.mean ?? null]))
  }
}
writeFileSync(outPath, JSON.stringify(out, null, 1) + "\n")
console.log(`wrote ${outPath}: loss ${res.loss.toFixed(2)} after ${res.evals} evaluations`)

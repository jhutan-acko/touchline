import { execFileSync } from "node:child_process"
import { mkdirSync, readFileSync, rmSync } from "node:fs"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { Effect } from "effect"
import type { League } from "@touchline/league"
import { CliError, cliOptions, exitOnUserError, positiveInteger, writeMatch } from "@touchline/sim"
import { DEFAULT_PARAMS, ParamsError, paramsFromJson, type Params } from "@touchline/sim-core"
import { FIXTURES } from "./evaluate.js"

const root = join(dirname(fileURLToPath(import.meta.url)), "../../..")
const here = (p: string) => resolve(process.env.INIT_CWD ?? process.cwd(), p)
const o = cliOptions("realism: simulate held-out matches and write a realism report", {
  // Pass --out docs/realism/realism-report.md to update the committed report.
  out: { default: join(root, "out/realism-report.md"), help: "where to write the report" },
  matches: { default: "10", check: positiveInteger, help: "held-out matches to simulate (seeds 2000+)" },
  params: { default: join(root, "data/params/touchline-params.json"), help: "parameter file, or \"default\" for hand-set priors" }
})
// Make the report's folder now, before the matches are simulated.
exitOnUserError(() => {
  try {
    mkdirSync(dirname(here(o.out)), { recursive: true })
  } catch (e) {
    throw new CliError(`Cannot write to ${o.out}: ${e instanceof Error ? e.message : String(e)}`)
  }
})
const matches = Number(o.matches)
const params: Params = exitOnUserError(() => {
  if (o.params === "default") return DEFAULT_PARAMS
  try {
    return paramsFromJson(JSON.parse(readFileSync(here(o.params), "utf8")))
  } catch (e) {
    throw new CliError(`Cannot use params file ${o.params}: ${e instanceof ParamsError ? e.message : String(e)}`)
  }
})
const league = JSON.parse(readFileSync(join(root, "data/league/league.json"), "utf8")) as League
const outRoot = join(root, "out/realism")
rmSync(outRoot, { recursive: true, force: true })

// Seeds 2000+ are disjoint from the tuner's 1000+ seeds, so the report checks matches the tuner never saw.
const dirs: string[] = []
for (let i = 0; i < matches; i++) {
  const [h, a] = FIXTURES[i % FIXTURES.length]!
  const dir = join(outRoot, `m-${2000 + i}`)
  const cfg = { matchId: `realism-${2000 + i}`, seed: 2000 + i, kickoffTime: "2026-10-18T14:00:00.000Z", home: league.clubs.find((c) => c.id === h)!, away: league.clubs.find((c) => c.id === a)!, params, dt: 0.1 }
  await Effect.runPromise(writeMatch(cfg, dir))
  dirs.push(dir)
  process.stdout.write(`match ${i + 1}/${matches}\n`)
}
const note = `${params.provenance.version}; held-out seeds 2000–${2000 + matches - 1}`
execFileSync("uv", ["run", "--project", join(root, "python/analytics"), "python", "-m", "touchline_analytics.report", ...dirs,
  "--targets", join(root, "data/params/targets-idsse.json"), "--note", note, "--out", here(o.out)], { stdio: "inherit" })

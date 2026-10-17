import { execFileSync } from "node:child_process"
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { Effect } from "effect"
import type { League } from "@touchline/league"
import { CliError, cliOptions, exitOnUserError, positiveInteger, writeMatch } from "@touchline/sim"
import { DEFAULT_PARAMS, ParamsError, paramsFromJson, type Params } from "@touchline/sim-core"
import { FIXTURES } from "./evaluate.js"
import { applySets, parseSets } from "./overrides.js"

const root = join(dirname(fileURLToPath(import.meta.url)), "../../..")
const here = (p: string) => resolve(process.env.INIT_CWD ?? process.cwd(), p)
const o = cliOptions("realism: simulate held-out matches and write a realism report", {
  // Pass --out docs/realism/realism-report.md to update the committed report.
  out: { default: join(root, "out/realism-report.md"), help: "where to write the report" },
  matches: { default: "10", check: positiveInteger, help: "held-out matches to simulate (seeds 2000+)" },
  params: { default: join(root, "data/params/touchline-params.json"), help: "parameter file, or \"default\" for hand-set priors" },
  set: { default: "", help: "comma-separated key=value overrides on the parameter file, e.g. firstTick.rule=1,firstTick.bootBlock=0.3" },
  only: { default: "", help: "\"passing\" or \"duels\": write only the P3 passing or the P4 duels section (faster)" },
  runs: { default: join(root, "out/realism"), help: "folder for the simulated matches; use a separate one for each concurrent run" }
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
const sets = exitOnUserError(() => {
  if (o.only !== "" && o.only !== "passing" && o.only !== "duels") throw new CliError(`--only must be "passing" or "duels", got "${o.only}"`)
  return parseSets(o.set)
})
const params: Params = exitOnUserError(() => {
  if (o.params === "default" && sets.length === 0) return DEFAULT_PARAMS
  try {
    const json: unknown = o.params === "default" ? structuredClone(DEFAULT_PARAMS) : JSON.parse(readFileSync(here(o.params), "utf8"))
    return paramsFromJson(applySets(json, sets))
  } catch (e) {
    throw new CliError(`Cannot use params file ${o.params}${o.set ? ` with --set ${o.set}` : ""}: ${e instanceof ParamsError ? e.message : String(e)}`)
  }
})
const league = JSON.parse(readFileSync(join(root, "data/league/league.json"), "utf8")) as League
const outRoot = here(o.runs)
// Clear the runs folder only if this tool made it: missing, empty, marked, or holding nothing but m-<seed> match folders.
// Anything else (--runs . or --runs out by mistake) is refused, not deleted.
const MARKER = ".touchline-realism-runs"
exitOnUserError(() => {
  if (!existsSync(outRoot)) return
  const names = readdirSync(outRoot)
  if (names.length > 0 && !names.includes(MARKER) && !names.every((n) => /^m-\d+$/.test(n)))
    throw new CliError(`Refusing to delete ${outRoot}: it was not made by this tool (no ${MARKER} file, and it holds more than m-<seed> match folders). Pick a new or empty folder with --runs.`)
  rmSync(outRoot, { recursive: true, force: true })
})
mkdirSync(outRoot, { recursive: true })
writeFileSync(join(outRoot, MARKER), "made by realism.ts; safe to delete\n")

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
const note = `${params.provenance.version}${o.set ? `; --set ${o.set}` : ""}; held-out seeds 2000–${2000 + matches - 1}`
execFileSync("uv", ["run", "--project", join(root, "python/analytics"), "python", "-m", "touchline_analytics.report", ...dirs,
  "--targets", join(root, "data/params/targets-idsse.json"), "--note", note, "--out", here(o.out), ...(o.only ? ["--only", o.only] : []),
  "--physics", join(root, "data/params/physics.json"), "--league", join(root, "data/league/league.json"),
  "--carriers", join(root, "data/params/still-carriers.json")], { stdio: "inherit" })

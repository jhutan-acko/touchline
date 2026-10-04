import { execFileSync } from "node:child_process"
import { readFileSync, rmSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { Effect } from "effect"
import type { League } from "@touchline/league"
import { writeMatch } from "@touchline/sim"
import { DEFAULT_PARAMS, paramsFromJson } from "@touchline/sim-core"
import { FIXTURES } from "./evaluate.js"

const root = join(dirname(fileURLToPath(import.meta.url)), "../../..")
const arg = (k: string, d: string): string => {
  const i = process.argv.indexOf(`--${k}`)
  return i > 0 && process.argv[i + 1] ? process.argv[i + 1]! : d
}
const matches = Number(arg("matches", "10"))
const paramsFile = arg("params", join(root, "data/params/touchline-params.json"))
const params = paramsFile === "default" ? DEFAULT_PARAMS : paramsFromJson(JSON.parse(readFileSync(paramsFile, "utf8")))
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
  "--targets", join(root, "data/params/targets-idsse.json"), "--note", note, "--out", join(root, "docs/realism/realism-report.md")], { stdio: "inherit" })

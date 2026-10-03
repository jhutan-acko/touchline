import { readFileSync } from "node:fs"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { Effect } from "effect"
import type { League } from "@touchline/league"
import { DEFAULT_PARAMS } from "@touchline/sim-core"
import { writeMatch } from "./writer.js"

const root = join(dirname(fileURLToPath(import.meta.url)), "../../..")
const arg = (k: string, d: string): string => {
  const i = process.argv.indexOf(`--${k}`)
  return i > 0 && process.argv[i + 1] ? process.argv[i + 1]! : d
}
const league = JSON.parse(readFileSync(join(root, "data/league/league.json"), "utf8")) as League
const club = (id: string) => {
  const c = league.clubs.find((x) => x.id === id)
  if (!c) {
    console.error(`Unknown club "${id}". Known clubs: ${league.clubs.map((x) => x.id).join(", ")}`)
    process.exit(2)
  }
  return c
}
const seed = Number(arg("seed", "1"))
const fps = Number(arg("fps", "10"))
if (!Number.isInteger(seed) || seed < 0 || seed > 4294967295) {
  console.error("--seed must be an integer between 0 and 4294967295")
  process.exit(2)
}
if (fps !== 10 && fps !== 25) {
  console.error("--fps must be 10 or 25")
  process.exit(2)
}
if (arg("home", "ironmoor") === arg("away", "kestrel-bay")) {
  console.error("--home and --away must be different clubs")
  process.exit(2)
}
const cfg = {
  matchId: arg("match-id", `m-${seed}`),
  seed,
  kickoffTime: arg("kickoff", "2026-10-18T14:00:00.000Z"),
  home: club(arg("home", "ironmoor")),
  away: club(arg("away", "kestrel-bay")),
  params: DEFAULT_PARAMS,
  dt: 1 / fps
}
// pnpm runs package scripts from the package folder; INIT_CWD is where the user typed the command.
const out = resolve(process.env.INIT_CWD ?? process.cwd(), arg("out", join(root, "out", cfg.matchId)))
Effect.runPromise(writeMatch(cfg, out)).then((m) => console.log(`${out}: ${JSON.stringify(m.stats)}`))

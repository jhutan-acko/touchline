import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { generateLeague } from "../src/league.js"

const root = join(dirname(fileURLToPath(import.meta.url)), "../../..")
const blockFile = join(root, "data/blocklist/real-player-name-hashes.txt")
const blocked = new Set(existsSync(blockFile) ? readFileSync(blockFile, "utf8").split("\n").map((l) => l.trim()).filter(Boolean) : [])
const league = generateLeague(2026, blocked)
mkdirSync(join(root, "data/league"), { recursive: true })
writeFileSync(join(root, "data/league/league.json"), JSON.stringify(league, null, 1) + "\n")
console.log(`wrote ${league.clubs.length} clubs, ${league.clubs.reduce((n, c) => n + c.squad.length, 0)} players (blocklist: ${blocked.size} hashes)`)

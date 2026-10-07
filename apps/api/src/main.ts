import { readFileSync } from "node:fs"
import { join, resolve } from "node:path"
import { NodeRuntime } from "@effect/platform-node"
import { Effect, Layer } from "effect"
import type { League } from "@touchline/league"
import { cliOptions, integer } from "@touchline/sim"
import { scanLibrary } from "./library.js"
import { root } from "./playback.js"
import { serverLayer } from "./server.js"

// pnpm runs package scripts from the package folder; INIT_CWD is where the user typed the command.
const here = (p: string) => resolve(process.env.INIT_CWD ?? process.cwd(), p)

const o = cliOptions("touchline-api: the match library, playback sessions and agent cues over RPC (WebSocket at /rpc)", {
  library: { default: join(root, "out/library"), help: "folder of run folders (pnpm library fills it)" },
  port: { default: "8787", check: integer(0, 65535), help: "port to listen on" },
  host: { default: "127.0.0.1", help: "address to listen on" }
})

const league = JSON.parse(readFileSync(join(root, "data/league/league.json"), "utf8")) as League
const library = scanLibrary(here(o.library), league)
console.error(`touchline-api: ${library.size} matches in ${here(o.library)}`)
Layer.launch(serverLayer({ library, port: Number(o.port), host: o.host })).pipe(NodeRuntime.runMain)

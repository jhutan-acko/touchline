import { join, resolve } from "node:path"
import { CliError, cliOptions, exitOnUserError, oneOf } from "@touchline/sim"
import { AskCacheError, buildAskCache } from "./askcache.js"
import { root } from "./playback.js"

// pnpm runs package scripts from the package folder; INIT_CWD is where the user typed the command.
const here = (p: string) => resolve(process.env.INIT_CWD ?? process.cwd(), p)
const o = cliOptions("touchline-ask-cache: ask every suggested chip at the chosen frames ahead and write <match dir>/ask-cache.json for replay", {
  library: { default: join(root, "out/library"), help: "folder of run folders" },
  match: { default: "", help: "match id (required)" },
  frames: { default: "", help: "comma-separated frames to pause at (required)" },
  agents: { default: "http://127.0.0.1:8100/", help: "the agent service (A2A)" },
  lang: { default: "en", check: oneOf(["en", "es", "hi"]), help: "viewer language the answers are written in" },
  mode: { default: "casual", check: oneOf(["casual", "analyst"]), help: "viewer mode the answers are written for" },
  segments: { default: "", help: "several viewers instead of --lang/--mode, comma-separated <mode>.<lang> (e.g. casual.en,analyst.es)" }
})
const frames = exitOnUserError(() => {
  if (!o.match) throw new CliError("--match is required")
  const f = o.frames.split(",").map((x) => x.trim()).filter(Boolean)
  if (!f.length || f.some((x) => !/^\d+$/.test(x))) throw new CliError("--frames needs comma-separated frame numbers")
  return f.map(Number)
})
const segments = exitOnUserError(() => {
  if (!o.segments) return [{ mode: o.mode as "casual" | "analyst", lang: o.lang as "en" | "es" | "hi", club: null }]
  return o.segments.split(",").map((x) => x.trim()).filter(Boolean).map((x) => {
    const m = /^(casual|analyst)\.(en|es|hi)$/.exec(x)
    if (!m) throw new CliError(`--segments: "${x}" is not <casual|analyst>.<en|es|hi>`)
    return { mode: m[1] as "casual" | "analyst", lang: m[2] as "en" | "es" | "hi", club: null }
  })
})
buildAskCache({ library: here(o.library), matchId: o.match, frames, agentsUrl: o.agents, segments, log: (l) => console.error(l) })
  .then((r) => {
    console.log(`${r.written.length} answers written to ${r.path}; ${r.failed.length} failed`)
    for (const f of r.failed) console.log(`  failed ${f.key}: ${f.reason} (${f.message})`)
    process.exit(r.failed.length ? 1 : 0)
  })
  .catch((e) => {
    if (e instanceof AskCacheError) {
      console.error(e.message)
      process.exit(2)
    }
    throw e
  })

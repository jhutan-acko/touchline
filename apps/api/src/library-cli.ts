import { join, resolve } from "node:path"
import { CliError, cliOptions, exitOnUserError, integer, SCENARIOS } from "@touchline/sim"
import { BuildError, buildLibrary } from "./build-library.js"
import { root } from "./playback.js"

const here = (p: string) => resolve(process.env.INIT_CWD ?? process.cwd(), p)
const o = cliOptions("touchline-library: simulate the built-in scenarios and cache their agent cues for the API", {
  out: { default: join(root, "out/library"), help: "library folder" },
  scenarios: { default: Object.keys(SCENARIOS).join(","), help: "comma-separated scenario names" },
  seed: { default: "1", check: integer(0, 4294967295), help: "seed for every scenario" },
  agents: { default: "http://127.0.0.1:8100/", help: "the agent service (A2A)" },
  "no-agents": { default: "false", help: "\"true\": simulate only (matches play with stats and no agent cues)" }
})
const scenarios = exitOnUserError(() => {
  const s = o.scenarios.split(",").map((x) => x.trim()).filter(Boolean)
  if (!s.length) throw new CliError("--scenarios needs at least one scenario")
  return s
})
buildLibrary({ out: here(o.out), scenarios, seed: Number(o.seed), agentsUrl: o["no-agents"] === "true" ? null : o.agents, log: (l) => console.error(l) })
  .then((dirs) => console.log(`${dirs.length} matches in ${here(o.out)}`))
  .catch((e) => {
    if (e instanceof BuildError) {
      console.error(e.message)
      process.exit(2)
    }
    throw e
  })

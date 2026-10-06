import { existsSync, readFileSync } from "node:fs"
import { createServer, type IncomingMessage, type ServerResponse } from "node:http"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js"
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js"
import { Effect } from "effect"
import { CliError, cliOptions, exitOnUserError, integer } from "@touchline/sim"
import { modelsFromJson, ReplayError, xtGridFromJson, type Roster, type StatsQuery } from "@touchline/stats"
import { loadRun } from "./load.js"
import { createStatsServer } from "./server.js"

const root = join(dirname(fileURLToPath(import.meta.url)), "../../..")
// pnpm runs package scripts from the package folder; INIT_CWD is where the user typed the command.
const here = (p: string) => resolve(process.env.INIT_CWD ?? process.cwd(), p)

// stdout carries the MCP protocol in stdio mode: everything else goes to stderr.
const o = cliOptions("touchline-mcp-stats: serve one match's stats to agents over MCP (stdio by default)", {
  run: { default: "", help: "run folder written by pnpm sim (meta.json, domain.jsonl, tracking.jsonl)" },
  minute: { default: "", check: integer(0, 130), help: "serve the match as it stood at this minute (45 and later: second half)" },
  http: { default: "", check: integer(0, 65535), help: "serve Streamable HTTP on this port at 127.0.0.1/mcp instead of stdio (0: any free port)" }
})
exitOnUserError(() => {
  if (o.run === "") throw new CliError("--run is required (a folder written by pnpm sim, e.g. out/m-1)")
})
const models = modelsFromJson(JSON.parse(readFileSync(join(root, "data/params/stats-models.json"), "utf8")))
const xt = xtGridFromJson(JSON.parse(readFileSync(join(root, "data/params/xt-grid.json"), "utf8")))
const leaguePath = join(root, "data/league/league.json")
const roster = existsSync(leaguePath) ? (JSON.parse(readFileSync(leaguePath, "utf8")) as Roster) : undefined

/** Stateless Streamable HTTP: a fresh server and transport per request, all reading the same loaded match. */
const serveHttp = (q: StatsQuery, port: number) => {
  const http = createServer(async (req: IncomingMessage, res: ServerResponse) => {
    if (req.url !== "/mcp" || req.method !== "POST") {
      res.writeHead(req.url === "/mcp" ? 405 : 404).end()
      return
    }
    const server = createStatsServer(q)
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true })
    res.on("close", () => {
      void transport.close()
      void server.close()
    })
    await server.connect(transport)
    await transport.handleRequest(req, res)
  })
  http.listen(port, "127.0.0.1", () => {
    const addr = http.address()
    console.error(`touchline-stats MCP on http://127.0.0.1:${typeof addr === "object" && addr ? addr.port : port}/mcp`)
  })
}

Effect.runPromise(loadRun(here(o.run), models, { xt, ...(o.minute ? { minute: Number(o.minute) } : {}), ...(roster ? { roster } : {}) }))
  .then(async (q) => {
    if (o.http !== "") serveHttp(q, Number(o.http))
    else {
      await createStatsServer(q).connect(new StdioServerTransport())
      console.error(`touchline-stats MCP on stdio: ${q.engine.info.matchId} as of frame ${q.engine.now}`)
    }
  })
  .catch((e) => {
    if (e instanceof ReplayError) {
      console.error(e.message)
      process.exit(2)
    }
    throw e
  })

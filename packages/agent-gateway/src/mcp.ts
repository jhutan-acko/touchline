import { spawn } from "node:child_process"
import { resolve } from "node:path"
import { root } from "./replay.js"

export interface McpServer {
  readonly url: string
  readonly stop: () => void
}

/** Start `pnpm mcp-stats --run <dir> --http 0` and resolve with its URL once it listens. */
export const startMcpStats = (dir: string, timeoutMs = 60_000): Promise<McpServer> =>
  new Promise((ok, fail) => {
    const proc = spawn("pnpm", ["-s", "mcp-stats", "--run", resolve(dir), "--http", "0"], { cwd: root, detached: true, stdio: ["ignore", "ignore", "pipe"] })
    const stop = () => {
      if (proc.exitCode === null && proc.pid) process.kill(-proc.pid, "SIGTERM")
    }
    let err = ""
    const timer = setTimeout(() => {
      stop()
      fail(new Error(`mcp-stats did not start in ${timeoutMs} ms: ${err.slice(-500)}`))
    }, timeoutMs)
    proc.stderr.on("data", (b: Buffer) => {
      err += b.toString()
      const m = /touchline-stats MCP on (http:\/\/\S+\/mcp)/.exec(err)
      if (m) {
        clearTimeout(timer)
        ok({ url: m[1]!, stop })
      }
    })
    proc.on("exit", (code) => {
      clearTimeout(timer)
      fail(new Error(`mcp-stats exited (${code}): ${err.slice(-500)}`))
    })
  })

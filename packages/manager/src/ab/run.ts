/**
 * Running the A/B evaluation (spec §5): every fixture once per arm, each match in its own worker thread, and the agent
 * service started for the run (stub or OpenAI; the model key stays with the Python service) or reached at a URL.
 */
import { spawn, type ChildProcess } from "node:child_process"
import { availableParallelism } from "node:os"
import { createServer } from "node:net"
import { Worker } from "node:worker_threads"
import { Effect } from "effect"
import { fixtures, type Arm, type MatchResult } from "./match.js"
import { loadSetup, root } from "./setup.js"
import type { AbJob } from "./worker.js"

export interface AbOptions {
  readonly first: number
  readonly seeds: number
  readonly arms: ReadonlyArray<Arm>
  readonly agentsUrl: string
  readonly whatif: { readonly seeds: number; readonly horizonS: number }
  readonly concurrency?: number
  readonly onResult?: (r: MatchResult, done: number, total: number) => void
}

/**
 * How an A/B match's agent tests its options: inline, in the match's own worker. Matches already run one per core, so
 * nested worker threads would oversubscribe the machine, and a wall-clock limit would then mark options untested
 * depending on load: inline, the same seeds give the same results on any machine.
 */
export const abWhatIf = (whatif: AbJob["whatif"]) => ({ ...whatif, runner: "inline" as const })

const playInWorker = (job: AbJob) =>
  Effect.tryPromise(
    () =>
      new Promise<MatchResult>((resolve, reject) => {
        const w = new Worker(new URL("./worker.ts", import.meta.url), { workerData: job, execArgv: ["--import", "tsx"] })
        w.once("message", (m: { ok?: MatchResult; error?: string }) => {
          void w.terminate()
          if (m.ok) resolve(m.ok)
          else reject(new Error(m.error ?? "worker failed"))
        })
        w.once("error", reject)
      })
  )

/** Every fixture once per arm; fails only if a match cannot be played at all (managers never fail a match). */
export const runAb = (opts: AbOptions) =>
  Effect.gen(function* () {
    const list = fixtures(opts.first, opts.seeds, loadSetup().clubs)
    const jobs: AbJob[] = list.flatMap((fixture) => opts.arms.map((arm) => ({ fixture, arm, agentsUrl: opts.agentsUrl, whatif: opts.whatif })))
    let done = 0
    return yield* Effect.forEach(jobs, (job) => playInWorker(job).pipe(Effect.tap((r) => Effect.sync(() => opts.onResult?.(r, ++done, jobs.length)))), {
      concurrency: opts.concurrency ?? Math.max(1, availableParallelism() - 1)
    })
  })

const freePort = () =>
  new Promise<number>((ok) => {
    const s = createServer().listen(0, "127.0.0.1", () => {
      const port = (s.address() as { port: number }).port
      s.close(() => ok(port))
    })
  })

/** Start the agent service on `llm` ("stub" or "openai") for the run; its URL and a stop function. */
export const startAgents = async (llm: "stub" | "openai"): Promise<{ readonly url: string; readonly stop: () => void }> => {
  const port = await freePort()
  const child: ChildProcess = spawn("uv", ["run", "--project", "services/agents", "touchline-agents", "--port", String(port)], {
    cwd: root, env: { ...process.env, TOUCHLINE_LLM: llm }, detached: true, stdio: "ignore"
  })
  const url = `http://127.0.0.1:${port}/`
  for (let i = 0; i < 300; i++) {
    if (await fetch(`${url}.well-known/agent-card.json`).then((r) => r.ok, () => false)) return { url, stop: () => child.pid && process.kill(-child.pid, "SIGTERM") }
    await new Promise((r) => setTimeout(r, 200))
  }
  if (child.pid) process.kill(-child.pid, "SIGTERM")
  throw new Error("the agent service did not start (is uv installed, and for openai is OPENAI_API_KEY set in .env.local?)")
}

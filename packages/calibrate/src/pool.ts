import { availableParallelism } from "node:os"
import { Worker } from "node:worker_threads"
import type { League } from "@touchline/league"
import type { Params } from "@touchline/sim-core"
import { evaluate } from "./evaluate.js"
import type { MatchMetrics } from "./metrics.js"

export const defaultWorkers = (): number => Math.max(1, availableParallelism() - 1)

export interface EvalPool {
  /** Same result as the serial `evaluate`: metrics in fixture order, whatever order matches finish in. */
  evaluate(params: Params, matches: number): Promise<MatchMetrics[]>
  close(): Promise<void>
}

interface Reply { id: number; index: number; metrics?: MatchMetrics; error?: string }

/**
 * A pool of `size` worker threads, created once and reused across evaluations. Matches are handed out
 * one at a time (dynamic balancing) and written back by index, so results are order-independent.
 * With size 1 nothing is spawned: evaluation runs in this thread.
 */
export const createPool = (league: League, size: number): EvalPool => {
  if (size <= 1) return { evaluate: async (params, matches) => evaluate(league, params, matches), close: async () => {} }
  const url = new URL("./worker.ts", import.meta.url)
  // Workers load TypeScript source through tsx, exactly as the main thread does.
  const workers = Array.from({ length: size }, () => new Worker(url, { workerData: { league }, execArgv: ["--import", "tsx"] }))
  let nextId = 0
  return {
    evaluate: (params, matches) =>
      new Promise<MatchMetrics[]>((resolve, reject) => {
        const out = new Array<MatchMetrics>(matches)
        const id = nextId++
        let next = 0
        let done = 0
        let failed = false
        const cleanup = () => workers.forEach((w) => { w.off("message", onMsg); w.off("error", onErr); w.off("exit", onExit) })
        const fail = (e: unknown) => { if (!failed) { failed = true; cleanup(); reject(e instanceof Error ? e : new Error(String(e))) } }
        const feed = (w: Worker) => { if (next < matches) w.postMessage({ id, params, index: next++ }) }
        const onErr = (e: Error) => fail(e)
        const onExit = (code: number) => { if (code !== 0) fail(new Error(`worker exited with code ${code}`)) }
        const onMsg = function (this: Worker, r: Reply) {
          if (r.id !== id || failed) return
          if (r.error !== undefined) return fail(new Error(`worker: ${r.error}`))
          out[r.index] = r.metrics!
          if (++done === matches) { cleanup(); resolve(out); return }
          feed(this)
        }
        if (matches === 0) return resolve(out)
        for (const w of workers) { w.on("message", onMsg); w.on("error", onErr); w.on("exit", onExit); feed(w) }
      }),
    close: async () => { await Promise.all(workers.map((w) => w.terminate())) }
  }
}

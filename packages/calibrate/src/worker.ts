import { parentPort, workerData } from "node:worker_threads"
import type { League } from "@touchline/league"
import type { Params } from "@touchline/sim-core"
import { evaluateMatch } from "./evaluate.js"

/** Worker thread: holds the league, simulates one fixture per request, returns that match's metrics. */
const league = (workerData as { league: League }).league
parentPort!.on("message", (m: { id: number; params: Params; index: number }) => {
  try {
    parentPort!.postMessage({ id: m.id, index: m.index, metrics: evaluateMatch(league, m.params, m.index) })
  } catch (e) {
    parentPort!.postMessage({ id: m.id, index: m.index, error: e instanceof Error ? (e.stack ?? e.message) : String(e) })
  }
})

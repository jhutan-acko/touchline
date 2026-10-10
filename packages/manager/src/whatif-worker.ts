/** Plays one arm of a manager's option test off the main thread (whatif.ts). */
import { parentPort, workerData } from "node:worker_threads"
import { armOutcomes, type ArmJob } from "./whatif.js"

try {
  parentPort!.postMessage({ ok: armOutcomes(workerData as ArmJob) })
} catch (e) {
  parentPort!.postMessage({ error: e instanceof Error ? e.message : String(e) })
}

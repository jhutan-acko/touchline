/** Computes one what-if clip off the main thread (whatif.ts computeInWorker). */
import { parentPort, workerData } from "node:worker_threads"
import { computeClip } from "./whatif.js"

const { dir, eventId } = workerData as { dir: string; eventId: string }
try {
  parentPort!.postMessage({ clip: computeClip(dir, eventId) })
} catch (e) {
  parentPort!.postMessage({ error: e instanceof Error ? e.message : String(e) })
}

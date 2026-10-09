/** Runs one what-if job off the main thread (whatif.ts): a clip on request, or a share of a library scan. */
import { parentPort, workerData } from "node:worker_threads"
import { computeClip, scanChunk, type WorkerJob } from "./whatif.js"

const job = workerData as WorkerJob
try {
  parentPort!.postMessage({ ok: job.kind === "clip" ? computeClip(job.dir, job.eventId) : scanChunk(job.dir, job.eventIds) })
} catch (e) {
  parentPort!.postMessage({ error: e instanceof Error ? e.message : String(e) })
}

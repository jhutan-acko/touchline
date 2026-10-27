/** Runs one what-if job off the main thread (whatif.ts): a clip on request, a share of a library scan, or an ask's frame summary or clip. */
import { parentPort, workerData } from "node:worker_threads"
import { computeAskClip } from "./askclip.js"
import { frameSummary } from "./askframe.js"
import { computeClip, rebuild, scanChunk, type WorkerJob } from "./whatif.js"

const run = (job: WorkerJob): unknown => {
  switch (job.kind) {
    case "clip":
      return computeClip(job.dir, job.eventId)
    case "scan":
      return scanChunk(job.dir, job.eventIds)
    case "summary": {
      const { session } = rebuild(job.dir)
      return frameSummary(session, session.cfg.matchId, job.frame)
    }
    case "ask_clip":
      return computeAskClip(job.dir, job.req)
  }
}

const job = workerData as WorkerJob
try {
  parentPort!.postMessage({ ok: run(job) })
} catch (e) {
  parentPort!.postMessage({ error: e instanceof Error ? e.message : String(e) })
}

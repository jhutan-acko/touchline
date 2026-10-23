// A stand-in Ask worker (ask.test.ts): answers each job with its frame at once; frame -1 never answers.
import { parentPort } from "node:worker_threads"
parentPort.on("message", (job) => {
  if (job.kind === "summary" && job.frame === -1) return
  parentPort.postMessage({ id: job.id, ok: { frame: job.frame }, rebuilds: 1 })
})

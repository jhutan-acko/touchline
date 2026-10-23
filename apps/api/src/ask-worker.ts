/**
 * The warm Ask worker of one match (askpool.ts): rebuilds the match once, on its first job, and keeps the advisor
 * session and the xT grid for every job after, one at a time. A summary job also fetches, in the same replay, every
 * state a question at that frame may need (askTicks), so the clip asked next costs only its seeds.
 */
import { parentPort, workerData } from "node:worker_threads"
import { askClipFrom, askTicks, type AskClipRequest } from "./askclip.js"
import { frameSummary } from "./askframe.js"
import { rebuild } from "./whatif.js"

/** Prefetched states the session keeps, at most (about 25 kB each). */
export const ASK_PINNED_STATES = 64

export type AskJobSpec = { readonly kind: "summary"; readonly frame: number } | { readonly kind: "ask_clip"; readonly req: AskClipRequest }
export type AskJob = { readonly id: number } & AskJobSpec
export interface AskJobResult {
  readonly id: number
  readonly ok?: unknown
  readonly error?: string
  /** Times this worker has rebuilt its match (once). */
  readonly rebuilds: number
}

const { dir } = workerData as { readonly dir: string }
let warm: ReturnType<typeof rebuild> | null = null
let rebuilds = 0

const built = () => {
  if (!warm) {
    warm = rebuild(dir)
    warm.session.maxPinned = ASK_PINNED_STATES
    rebuilds++
  }
  return warm
}

const run = (job: AskJob): unknown => {
  const { session, xt } = built()
  switch (job.kind) {
    case "summary":
      session.prefetch(askTicks(session, job.frame))
      return frameSummary(session, session.cfg.matchId, job.frame)
    case "ask_clip":
      return askClipFrom(session, xt, job.req)
  }
}

parentPort!.on("message", (job: AskJob) => {
  let out: AskJobResult
  try {
    out = { id: job.id, ok: run(job), rebuilds }
  } catch (e) {
    out = { id: job.id, error: e instanceof Error ? e.message : String(e), rebuilds }
  }
  parentPort!.postMessage(out)
})

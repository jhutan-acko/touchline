/**
 * Warm Ask workers (pause-and-ask): one long-lived worker thread per match, holding its rebuilt advisor session, so an
 * ask pays the match rebuild (about 5 s for a scripted match) once rather than per job. Jobs run one at a time, each
 * within its time limit (a longer one while the worker is still cold). A worker that times out or dies is replaced
 * on the next job. A match's worker goes after `ASK_IDLE_MS` with no job, whether or not sessions are still open on
 * the match (the next job starts a cold one).
 */
import { Worker } from "node:worker_threads"
import type { AskClip } from "@touchline/rpc"
import type { FrameSummary } from "@touchline/schema"
import type { AskJob, AskJobResult, AskJobSpec } from "./ask-worker.js"
import type { AskClipRequest } from "./askclip.js"

/** A job on a worker that has not rebuilt its match yet must finish within this long. */
export const ASK_WORKER_TIMEOUT_MS = 30_000
/** A match's worker goes after this long with no job (open sessions do not keep it). */
export const ASK_IDLE_MS = 5 * 60_000

export interface AskWorkers {
  /** The frame summary at `frame`, also fetching the states a question there needs (within `timeoutMs` once warm). */
  readonly summary: (dir: string, frame: number, timeoutMs: number) => Promise<FrameSummary>
  /** The what-if clip (within `timeoutMs` once warm). */
  readonly askClip: (dir: string, req: AskClipRequest, timeoutMs: number) => Promise<AskClip>
  /** Note that `holder` (a session) uses the match (its bookkeeping is kept until the last holder goes). */
  readonly retain: (dir: string, holder: string) => void
  readonly release: (dir: string, holder: string) => void
  /** Times the match has been rebuilt by its workers (tests: a warm worker rebuilds once). */
  readonly rebuilds: (dir: string) => number
  /** Worker threads running now. */
  readonly running: () => number
  /** Stop every worker. */
  readonly close: () => void
}

export interface AskWorkersOptions {
  readonly idleMs?: number
  readonly coldTimeoutMs?: number
  readonly script?: URL
  readonly execArgv?: string[]
}

interface Pending {
  readonly job: AskJob
  readonly timeoutMs: number
  readonly resolve: (a: unknown) => void
  readonly reject: (e: Error) => void
}

interface Entry {
  worker: Worker | null
  warm: boolean
  /** Match rebuilds by this match's workers so far (earlier workers' in `base`). */
  rebuilds: number
  base: number
  busy: Pending | null
  timer: ReturnType<typeof setTimeout> | null
  idle: ReturnType<typeof setTimeout> | null
  readonly queue: Pending[]
  readonly holders: Set<string>
}

const SCRIPT = new URL("./ask-worker.ts", import.meta.url)

export const makeAskWorkers = (o: AskWorkersOptions = {}): AskWorkers => {
  const idleMs = o.idleMs ?? ASK_IDLE_MS
  const cold = o.coldTimeoutMs ?? ASK_WORKER_TIMEOUT_MS
  const entries = new Map<string, Entry>()
  let nextId = 0

  const entry = (dir: string): Entry => {
    let e = entries.get(dir)
    if (!e) entries.set(dir, (e = { worker: null, warm: false, rebuilds: 0, base: 0, busy: null, timer: null, idle: null, queue: [], holders: new Set() }))
    return e
  }

  /** Stop the worker (the next job starts a cold one); the job it was running fails with `error`. */
  const kill = (e: Entry, error: Error) => {
    const w = e.worker
    e.worker = null
    e.warm = false
    e.base = e.rebuilds
    if (e.timer) clearTimeout(e.timer)
    e.timer = null
    const busy = e.busy
    e.busy = null
    if (w) {
      w.removeAllListeners()
      w.on("error", () => {}) // a thread being stopped may still report an error
      void w.terminate()
    }
    busy?.reject(error)
  }

  /** Stop the match's worker `idleMs` from now unless a job comes first (restarted after every job). */
  const scheduleIdle = (dir: string, e: Entry) => {
    if (e.idle) clearTimeout(e.idle)
    e.idle = null
    if (e.busy || e.queue.length || !e.worker) return
    e.idle = setTimeout(() => {
      e.idle = null
      if (e.busy || e.queue.length) return
      kill(e, new Error("evicted"))
      if (e.holders.size === 0) entries.delete(dir)
    }, idleMs)
    e.idle.unref()
  }

  const spawn = (dir: string, e: Entry): Worker => {
    const w = new Worker(o.script ?? SCRIPT, { workerData: { dir }, execArgv: o.execArgv ?? ["--import", "tsx"] })
    w.on("message", (m: AskJobResult) => {
      const p = e.busy
      if (!p || p.job.id !== m.id) return
      if (e.timer) clearTimeout(e.timer)
      e.timer = null
      e.busy = null
      e.rebuilds = e.base + m.rebuilds
      if (m.rebuilds > 0) e.warm = true
      w.unref() // an idle worker never keeps the process alive
      if (m.error === undefined) p.resolve(m.ok)
      else p.reject(new Error(m.error))
      next(dir, e)
    })
    w.on("error", (err) => {
      kill(e, err)
      next(dir, e)
    })
    w.on("exit", () => {
      if (e.worker !== w) return
      kill(e, new Error("the Ask worker exited"))
      next(dir, e)
    })
    return w
  }

  const next = (dir: string, e: Entry) => {
    if (e.busy) return
    const p = e.queue.shift()
    if (!p) return scheduleIdle(dir, e)
    if (e.idle) clearTimeout(e.idle)
    e.idle = null
    const w = (e.worker ??= spawn(dir, e))
    w.ref()
    e.busy = p
    const limit = e.warm ? p.timeoutMs : Math.max(p.timeoutMs, cold)
    e.timer = setTimeout(() => {
      kill(e, new Error(`timed out after ${limit / 1000} s`))
      next(dir, e)
    }, limit)
    w.postMessage(p.job)
  }

  const submit = <A>(dir: string, job: AskJobSpec, timeoutMs: number): Promise<A> =>
    new Promise<A>((resolve, reject) => {
      const e = entry(dir)
      e.queue.push({ job: { ...job, id: nextId++ }, timeoutMs, resolve: resolve as (a: unknown) => void, reject })
      next(dir, e)
    })

  return {
    summary: (dir, frame, timeoutMs) => submit<FrameSummary>(dir, { kind: "summary", frame }, timeoutMs),
    askClip: (dir, req, timeoutMs) => submit<AskClip>(dir, { kind: "ask_clip", req }, timeoutMs),
    retain: (dir, holder) => {
      const e = entry(dir)
      e.holders.add(holder)
    },
    release: (dir, holder) => {
      const e = entries.get(dir)
      if (!e) return
      e.holders.delete(holder)
      if (e.holders.size === 0 && !e.worker && !e.queue.length) entries.delete(dir)
    },
    rebuilds: (dir) => entries.get(dir)?.rebuilds ?? 0,
    running: () => [...entries.values()].filter((e) => e.worker !== null).length,
    close: () => {
      for (const e of entries.values()) {
        if (e.idle) clearTimeout(e.idle)
        for (const p of e.queue.splice(0)) p.reject(new Error("closed"))
        kill(e, new Error("closed"))
      }
      entries.clear()
    }
  }
}

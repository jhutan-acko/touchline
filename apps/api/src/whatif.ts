/**
 * The what-if split (Plan 7): a pass a cue calls a mistake, as the match went and with the better pass played out
 * (advisor passClip). Library matches answer from the clips `pnpm library` cached next to their cue cache; anything
 * else is computed on request in a worker thread (a match rebuild plus the verdict's re-simulations: a few seconds),
 * within a time limit, and kept for the next viewer. Answers never go past the session's frame.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs"
import { availableParallelism } from "node:os"
import { join } from "node:path"
import { Worker } from "node:worker_threads"
import { Effect, Schema } from "effect"
import { explainPass, passClip, Session, type PassClip } from "@touchline/advisor"
import { MatchNotFound, WhatIfClip, WhatIfNotAvailable, type AskClip, type PassVerdict, type PitchFrame } from "@touchline/rpc"
import { decodeDomainEvent, type DomainEvent, type FrameSummary, type MomentTrace } from "@touchline/schema"
import { attackX, DEFAULT_PARAMS, matchClock, paramsFromJson, type Frame, type TeamSetup } from "@touchline/sim-core"
import { xtGridFromJson, type XtGrid } from "@touchline/stats"
import type { AskClipRequest } from "./askclip.js"
import type { LibraryMatch } from "./library.js"
import { root } from "./playback.js"

/** The cached clips of a run, one JSON line each, in its agents/ folder. */
export const WHATIF_FILE = "whatif.jsonl"
/** Paired seeds and seconds re-simulated per option: as the explain_pass tool. */
export const WHATIF_SEEDS = 20
export const WHATIF_HORIZON_S = 10
/** A clip computed on request must arrive within this long. */
export const WHATIF_TIMEOUT_MS = 10_000

/** Rounded to the millimetre (and never -0, which JSON would not keep). */
const r3 = (v: number) => Math.round(v * 1000) / 1000 || 0

/** A sim-core frame in the API's shape. */
export const toPitchFrame = (f: Frame, dt: number): PitchFrame => ({
  frame: f.tick,
  period: f.period,
  clock: matchClock(f.period, f.frame_id, dt),
  ball: { x: r3(f.ball.x), y: r3(f.ball.y), z: r3(f.ball.z) },
  home: f.home.map((p) => ({ id: p.id, x: r3(p.x), y: r3(p.y) })),
  away: f.away.map((p) => ({ id: p.id, x: r3(p.x), y: r3(p.y) }))
})

/** A run folder's match rebuilt for re-simulation, with the expected-threat grid. */
export const rebuild = (dir: string) => {
  const json = (p: string) => JSON.parse(readFileSync(join(root, p), "utf8"))
  const league = json("data/league/league.json") as { clubs: ReadonlyArray<TeamSetup> }
  const session = Session.fromRun(dir, league, [paramsFromJson(json("data/params/touchline-params.json")), DEFAULT_PARAMS])
  return { session, xt: xtGridFromJson(json("data/params/xt-grid.json")) }
}

/** The clip of an explained pass, in the API's frame shape. */
const toClip = (session: Session, c: PassClip): WhatIfClip => {
  const dt = session.cfg.dt
  return {
    event_id: c.event_id, verdict: c.verdict, passer_id: c.passer_id, played_to: c.played_to, better_to: c.better_to, fps: Math.round(1 / dt), pass_index: c.pass_index,
    real: c.real.map((f) => toPitchFrame(f, dt)), variant: c.variant ? c.variant.map((f) => toPitchFrame(f, dt)) : null,
    seeds: c.seeds, horizon_s: c.horizon_s, typical_seed: c.typical_seed, shots: c.shots, goals: c.goals, gain: c.gain ? { mean: c.gain.mean, se: c.gain.se } : null
  }
}

const explained = (session: Session, xt: XtGrid, eventId: string) => explainPass(session, eventId, xt, { seeds: WHATIF_SEEDS, horizonS: WHATIF_HORIZON_S })

/** Rebuild a run folder's match, explain the pass and cut its clip (CPU only: a few seconds; throws AdvisorError). */
export const computeClip = (dir: string, eventId: string): WhatIfClip => {
  const { session, xt } = rebuild(dir)
  return toClip(session, passClip(session, explained(session, xt, eventId), xt))
}

/** The scan looks at passes with at least this many options on record, ... */
export const SCAN_MIN_OPTIONS = 3
/** ... played from at least this far (m) into the opponents' half. */
export const SCAN_MIN_X = 5

/** The passes of a run worth scanning for a better option (by option count; the scan checks where each was played). */
export const scanCandidates = (dir: string): string[] =>
  readFileSync(join(dir, "domain.jsonl"), "utf8").split("\n").filter((l) => l.trim()).map((l) => decodeDomainEvent(JSON.parse(l)))
    .filter((e) => e.type === "pass" && e.player_id !== null && ((e.attrs.options as unknown[] | undefined) ?? []).length >= SCAN_MIN_OPTIONS)
    .map((e) => e.id)

/**
 * Explain each of the passes (those played in the opponents' half) and cut a clip of every one with a verified better
 * option: one match rebuild and one replay for all their states. CPU only; for a worker thread.
 */
export const scanChunk = (dir: string, eventIds: ReadonlyArray<string>): { readonly clips: WhatIfClip[]; readonly examined: number } => {
  const { session, xt } = rebuild(dir)
  const events = eventIds.map((id) => session.event(id))
  session.prefetch(events.map((e) => e.frame_id - 1))
  const attacking = events.filter((e) => {
    const st = session.stateAt(e.frame_id - 1)
    const p = st.players.find((q) => q.id === e.player_id)
    return p !== undefined && attackX(p.side, p.pos.x, st.period) > SCAN_MIN_X
  })
  const clips: WhatIfClip[] = []
  for (const e of attacking) {
    const x = explained(session, xt, e.id)
    if (x.verdict === "better_option_found") clips.push(toClip(session, passClip(session, x, xt)))
  }
  return { clips, examined: attacking.length }
}

/** The passes the agents' traces say had a better option (claims of kind better_option), first seen first. */
export const betterOptionEvents = (traces: ReadonlyArray<MomentTrace>): string[] => [
  ...new Set(traces.flatMap((t) => [...t.analysis.claims, ...t.draft.claims]).flatMap((c) => (c.kind === "better_option" && c.event_id ? [c.event_id] : [])))
]

const decodeClip = Schema.decodeUnknownSync(WhatIfClip)

/** A run's cached clips by event id (none without the file). */
export const readWhatIfs = (dir: string): Map<string, WhatIfClip> => {
  const path = join(dir, "agents", WHATIF_FILE)
  if (!existsSync(path)) return new Map()
  const clips = readFileSync(path, "utf8").split("\n").filter((l) => l.trim()).map((l) => decodeClip(JSON.parse(l)))
  return new Map(clips.map((c) => [c.event_id, c]))
}

const live = new Set<Worker>()
/** Worker threads running now (tests). */
export const activeWorkers = (): number => live.size

/**
 * Run a worker script on `data`: its answer, or its error as a rejection. It is terminated after `timeoutMs` or when
 * `signal` aborts, and a worker that exits without answering is an error at once.
 */
export const runWorker = <A>(url: URL, data: unknown, timeoutMs: number, execArgv: string[] = ["--import", "tsx"], signal?: AbortSignal): Promise<A> =>
  new Promise((resolve, reject) => {
    const worker = new Worker(url, { workerData: data, execArgv })
    live.add(worker)
    let settled = false
    const done = (finish: () => void) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      signal?.removeEventListener("abort", stop)
      void worker.terminate()
      finish()
    }
    const timer = setTimeout(() => done(() => reject(new Error(`timed out after ${timeoutMs / 1000} s`))), timeoutMs)
    const stop = () => done(() => reject(new Error("stopped")))
    if (signal?.aborted) stop()
    else signal?.addEventListener("abort", stop)
    worker.once("message", (m: { ok?: A; error?: string }) => done(() => (m.error === undefined ? resolve(m.ok as A) : reject(new Error(m.error)))))
    worker.once("error", (e) => done(() => reject(e)))
    worker.once("exit", () => {
      live.delete(worker)
      done(() => reject(new Error("the worker exited without an answer")))
    })
  })

const WORKER = new URL("./whatif-worker.ts", import.meta.url)
const inWorker = <A>(job: WorkerJob, timeoutMs: number, signal?: AbortSignal): Promise<A> => runWorker<A>(WORKER, job, timeoutMs, ["--import", "tsx"], signal)

export type WorkerJob =
  | { readonly kind: "clip"; readonly dir: string; readonly eventId: string }
  | { readonly kind: "scan"; readonly dir: string; readonly eventIds: ReadonlyArray<string> }
  /** Pause-and-ask: the frame summary at a frame (askframe.ts), and the what-if at any frame (askclip.ts). */
  | { readonly kind: "summary"; readonly dir: string; readonly frame: number }
  | { readonly kind: "ask_clip"; readonly dir: string; readonly req: AskClipRequest }

/** computeClip in a worker thread, so sessions keep playing while it runs. */
export const computeInWorker = (dir: string, eventId: string, timeoutMs: number): Promise<WhatIfClip> => inWorker({ kind: "clip", dir, eventId }, timeoutMs)

/** frameSummary of a run folder's match at `frame`, in a worker thread (the match is rebuilt there). */
export const summaryInWorker = (dir: string, frame: number, timeoutMs: number): Promise<FrameSummary> => inWorker({ kind: "summary", dir, frame }, timeoutMs)

/** computeAskClip in a worker thread. */
export const askClipInWorker = (dir: string, req: AskClipRequest, timeoutMs: number): Promise<AskClip> => inWorker({ kind: "ask_clip", dir, req }, timeoutMs)

/** Threads the scan uses by default: all cores but two. */
export const SCAN_WORKERS = Math.max(1, availableParallelism() - 2)

/** Scan a run's passes for verified better options across worker threads (the work split evenly); clips in match order. */
export const scanPasses = async (dir: string, o: { readonly workers?: number; readonly eventIds?: ReadonlyArray<string> } = {}): Promise<{ readonly clips: WhatIfClip[]; readonly examined: number }> => {
  const ids = o.eventIds ?? scanCandidates(dir)
  const n = Math.max(1, Math.min(o.workers ?? SCAN_WORKERS, ids.length))
  const chunks = Array.from({ length: n }, (_, i) => ids.filter((_, j) => j % n === i)).filter((c) => c.length > 0)
  // One failing thread stops the others: the scan has failed either way.
  const stop = new AbortController()
  const parts = await Promise.all(
    chunks.map((eventIds) =>
      inWorker<{ clips: WhatIfClip[]; examined: number }>({ kind: "scan", dir, eventIds }, 60 * 60_000, stop.signal).catch((e: unknown) => {
        stop.abort()
        throw e
      })
    )
  )
  return { clips: parts.flatMap((p) => p.clips).sort((a, b) => a.real[a.pass_index]!.frame - b.real[b.pass_index]!.frame), examined: parts.reduce((a, p) => a + p.examined, 0) }
}

/**
 * Cache a run's what-if clips: the scan's (verified better passes) and the clip of every pass the agents' traces
 * name (whatever its verdict, so a "Show me" on it can say so). Passes that cannot be re-simulated are skipped.
 */
export const writeWhatIfs = (dir: string, claimed: ReadonlyArray<string>, scanned: ReadonlyArray<WhatIfClip>, log: (line: string) => void = () => {}): WhatIfClip[] => {
  const clips = new Map(scanned.map((c) => [c.event_id, c]))
  for (const id of claimed) {
    if (clips.has(id)) continue
    try {
      clips.set(id, computeClip(dir, id))
    } catch (e) {
      log(`  no what-if for ${id}: ${e instanceof Error ? e.message : String(e)}`)
    }
  }
  const all = [...clips.values()]
  writeFileSync(join(dir, "agents", WHATIF_FILE), all.map((c) => JSON.stringify(c) + "\n").join(""))
  log(`  ${all.length} what-if clips (${all.filter((c) => c.verdict === "better_option_found").length} with a better option)`)
  return all
}

export interface WhatIfOptions {
  /** How a clip is computed on request (default: computeInWorker within `timeoutMs`). */
  readonly compute?: (dir: string, eventId: string) => Promise<WhatIfClip>
  /** The time limit for a clip computed on request (default WHATIF_TIMEOUT_MS). */
  readonly timeoutMs?: number
  /** Clips computed at once, at most (default WHATIF_MAX_WORKERS); more requests wait their turn. */
  readonly maxConcurrent?: number
}

/** Clips computed on request at once, at most: each is a worker thread rebuilding a match (sessions must keep streaming). */
export const WHATIF_MAX_WORKERS = Math.max(1, availableParallelism() - 2)

export const makeWhatIf = (library: ReadonlyMap<string, LibraryMatch>, o: WhatIfOptions = {}) => {
  const compute = o.compute ?? ((dir: string, id: string) => computeInWorker(dir, id, o.timeoutMs ?? WHATIF_TIMEOUT_MS))
  const max = o.maxConcurrent ?? WHATIF_MAX_WORKERS
  let running = 0
  const waiting: Array<() => void> = []
  const limited = <A>(f: () => Promise<A>): Promise<A> =>
    new Promise<A>((resolve, reject) => {
      const go = () => {
        running++
        f().then(resolve, reject).finally(() => {
          running--
          waiting.shift()?.()
        })
      }
      if (running < max) go()
      else waiting.push(go)
    })
  const cached = new Map<string, Map<string, WhatIfClip>>()
  const pending = new Map<string, Promise<WhatIfClip>>()
  const events = new Map<string, ReadonlyArray<DomainEvent>>()
  const clipsOf = (m: LibraryMatch) => {
    let c = cached.get(m.info.match_id)
    if (!c) cached.set(m.info.match_id, (c = new Map(m.clips)))
    return c
  }
  const eventsOf = (m: LibraryMatch) => {
    let e = events.get(m.info.match_id)
    if (!e) {
      e = readFileSync(join(m.dir, "domain.jsonl"), "utf8").split("\n").filter((l) => l.trim()).map((l) => decodeDomainEvent(JSON.parse(l)))
      events.set(m.info.match_id, e)
    }
    return e
  }
  const match = (id: string) => Effect.fromNullishOr(library.get(id)).pipe(Effect.mapError(() => new MatchNotFound({ match_id: id })))

  /** What re-simulation has said about a pass so far (null: not computed yet). */
  const verdict = (m: LibraryMatch, eventId: string): PassVerdict | null => clipsOf(m).get(eventId)?.verdict ?? null

  /** The clip of a pass as of `frame` (frames after it are cut from both plays). */
  const clip = (matchId: string, eventId: string, frame: number) =>
    Effect.gen(function* () {
      const m = yield* match(matchId)
      const unavailable = (reason: string) => new WhatIfNotAvailable({ event_id: eventId, reason })
      const e = eventsOf(m).find((x) => x.id === eventId)
      if (!e || e.type !== "pass") return yield* unavailable("not a pass of this match")
      if (e.frame_id > frame) return yield* unavailable("not reached yet")
      const clips = clipsOf(m)
      let c = clips.get(eventId)
      if (!c) {
        const key = `${matchId}/${eventId}`
        let p = pending.get(key)
        if (!p) {
          p = limited(() => compute(m.dir, eventId)).finally(() => pending.delete(key))
          pending.set(key, p)
        }
        const got = yield* Effect.tryPromise({ try: () => p!, catch: (err) => unavailable(err instanceof Error ? err.message : String(err)) })
        clips.set(eventId, got)
        c = got
      }
      const n = c.real.filter((f) => f.frame <= frame).length
      return { ...c, real: c.real.slice(0, n), variant: c.variant ? c.variant.slice(0, n) : null }
    })

  /** The clip of a pass if it is cached or was computed (never computes). */
  const known = (m: LibraryMatch, eventId: string): WhatIfClip | null => clipsOf(m).get(eventId) ?? null

  return { clip, verdict, known, match } as const
}

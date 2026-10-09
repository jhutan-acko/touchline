/**
 * The what-if split (Plan 7): a pass a cue calls a mistake, as the match went and with the better pass played out
 * (advisor passClip). Library matches answer from the clips `pnpm library` cached next to their cue cache; anything
 * else is computed on request in a worker thread (a match rebuild plus the verdict's re-simulations: a few seconds),
 * within a time limit, and kept for the next viewer. Answers never go past the session's frame.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { Worker } from "node:worker_threads"
import { Effect, Schema } from "effect"
import { explainPass, passClip, Session } from "@touchline/advisor"
import { MatchNotFound, WhatIfClip, WhatIfNotAvailable, type PassVerdict, type PitchFrame } from "@touchline/rpc"
import { decodeDomainEvent, type DomainEvent, type MomentTrace } from "@touchline/schema"
import { DEFAULT_PARAMS, matchClock, paramsFromJson, type Frame, type TeamSetup } from "@touchline/sim-core"
import { xtGridFromJson } from "@touchline/stats"
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

const toPitchFrame = (f: Frame, dt: number): PitchFrame => ({
  frame: f.tick,
  period: f.period,
  clock: matchClock(f.period, f.frame_id, dt),
  ball: { x: r3(f.ball.x), y: r3(f.ball.y), z: r3(f.ball.z) },
  home: f.home.map((p) => ({ id: p.id, x: r3(p.x), y: r3(p.y) })),
  away: f.away.map((p) => ({ id: p.id, x: r3(p.x), y: r3(p.y) }))
})

/** Rebuild a run folder's match, explain the pass and cut its clip (CPU only: a few seconds; throws AdvisorError). */
export const computeClip = (dir: string, eventId: string): WhatIfClip => {
  const json = (p: string) => JSON.parse(readFileSync(join(root, p), "utf8"))
  const league = json("data/league/league.json") as { clubs: ReadonlyArray<TeamSetup> }
  const session = Session.fromRun(dir, league, [paramsFromJson(json("data/params/touchline-params.json")), DEFAULT_PARAMS])
  const xt = xtGridFromJson(json("data/params/xt-grid.json"))
  const c = passClip(session, explainPass(session, eventId, xt, { seeds: WHATIF_SEEDS, horizonS: WHATIF_HORIZON_S }), xt)
  const dt = session.cfg.dt
  return {
    event_id: c.event_id, verdict: c.verdict, passer_id: c.passer_id, played_to: c.played_to, better_to: c.better_to, fps: Math.round(1 / dt), pass_index: c.pass_index,
    real: c.real.map((f) => toPitchFrame(f, dt)), variant: c.variant ? c.variant.map((f) => toPitchFrame(f, dt)) : null,
    seeds: c.seeds, horizon_s: c.horizon_s, typical_seed: c.typical_seed, shots: c.shots, goals: c.goals, gain: c.gain ? { mean: c.gain.mean, se: c.gain.se } : null
  }
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

/** Compute and cache the clip of every pass the run's traces name (passes that cannot be re-simulated are skipped). */
export const writeWhatIfs = (dir: string, eventIds: ReadonlyArray<string>, log: (line: string) => void = () => {}): WhatIfClip[] => {
  const clips: WhatIfClip[] = []
  for (const id of eventIds) {
    try {
      clips.push(computeClip(dir, id))
    } catch (e) {
      log(`  no what-if for ${id}: ${e instanceof Error ? e.message : String(e)}`)
    }
  }
  writeFileSync(join(dir, "agents", WHATIF_FILE), clips.map((c) => JSON.stringify(c) + "\n").join(""))
  log(`  ${clips.length} what-if clips (${clips.filter((c) => c.verdict === "better_option_found").length} with a better option)`)
  return clips
}

/** computeClip in a worker thread, so sessions keep playing while it runs. */
export const computeInWorker = (dir: string, eventId: string, timeoutMs: number): Promise<WhatIfClip> =>
  new Promise((resolve, reject) => {
    const worker = new Worker(new URL("./whatif-worker.ts", import.meta.url), { workerData: { dir, eventId }, execArgv: ["--import", "tsx"] })
    const timer = setTimeout(() => {
      void worker.terminate()
      reject(new Error(`timed out after ${timeoutMs / 1000} s`))
    }, timeoutMs)
    worker.once("message", (m: { clip?: WhatIfClip; error?: string }) => {
      clearTimeout(timer)
      void worker.terminate()
      m.clip ? resolve(m.clip) : reject(new Error(m.error ?? "no answer"))
    })
    worker.once("error", (e) => {
      clearTimeout(timer)
      reject(e)
    })
  })

export interface WhatIfOptions {
  /** How a clip is computed on request (default: computeInWorker within `timeoutMs`). */
  readonly compute?: (dir: string, eventId: string) => Promise<WhatIfClip>
  /** The time limit for a clip computed on request (default WHATIF_TIMEOUT_MS). */
  readonly timeoutMs?: number
}

export const makeWhatIf = (library: ReadonlyMap<string, LibraryMatch>, o: WhatIfOptions = {}) => {
  const compute = o.compute ?? ((dir: string, id: string) => computeInWorker(dir, id, o.timeoutMs ?? WHATIF_TIMEOUT_MS))
  const cached = new Map<string, Map<string, WhatIfClip>>()
  const pending = new Map<string, Promise<WhatIfClip>>()
  const events = new Map<string, ReadonlyArray<DomainEvent>>()
  const clipsOf = (m: LibraryMatch) => {
    let c = cached.get(m.info.match_id)
    if (!c) cached.set(m.info.match_id, (c = readWhatIfs(m.dir)))
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
          p = compute(m.dir, eventId).finally(() => pending.delete(key))
          pending.set(key, p)
        }
        const got = yield* Effect.tryPromise({ try: () => p!, catch: (err) => unavailable(err instanceof Error ? err.message : String(err)) })
        clips.set(eventId, got)
        c = got
      }
      const n = c.real.filter((f) => f.frame <= frame).length
      return { ...c, real: c.real.slice(0, n), variant: c.variant ? c.variant.slice(0, n) : null }
    })

  return { clip, verdict, match } as const
}

/**
 * The demo answers of a run, worked out ahead (`pnpm --filter @touchline/api ask-cache`): for each chosen frame, every
 * suggested chip is asked once through the same Ask path the API serves (makeAsk: summary, single-source what-if, the
 * answer team), and the stages, answer and clip are written to `<match dir>/ask-cache.json` by `"<frame>:<chip_id>"`,
 * the key the API replays from. An ask that ends `failed` is reported and never replaces what the file holds.
 */
import { randomUUID } from "node:crypto"
import { existsSync, readFileSync, renameSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { Effect, Ref, Schema, Stream } from "effect"
import { a2aSender } from "@touchline/agent-gateway"
import type { League } from "@touchline/league"
import type { AskUpdate, Playback } from "@touchline/rpc"
import type { AskStage, Segment } from "@touchline/schema"
import { makeAsk, type AskOptions } from "./ask.js"
import { ASK_CACHE_FILE, AskCacheFile, readAskCache, scanLibrary, type AskCacheEntry, type LibraryMatch } from "./library.js"
import { root } from "./playback.js"
import type { Session } from "./session.js"

export class AskCacheError extends Error {}

export interface AskCacheOptions {
  /** The library folder (run folders under it). */
  readonly library: string
  readonly matchId: string
  readonly frames: ReadonlyArray<number>
  /** The agent service (A2A). */
  readonly agentsUrl: string
  /** The viewer the answers are written for (the cache key has no segment: one segment per run). */
  readonly segment: Segment
  /** Ask's sender, workers and jobs (tests); overrides `agentsUrl`. */
  readonly ask?: AskOptions
  readonly log?: (line: string) => void
}

export interface AskCacheResult {
  readonly path: string
  /** Keys written (new or replaced). */
  readonly written: ReadonlyArray<string>
  /** Asks that ended `failed` (nothing written for them; an older entry under the key is kept). */
  readonly failed: ReadonlyArray<{ readonly key: string; readonly reason: string; readonly message: string }>
}

/** The cache key the API reads: the frame, then the chip id (which itself starts with the frame). */
export const askCacheKey = (frame: number, chipId: string): string => `${frame}:${chipId}`

/**
 * A session for asking ahead: Ask reads only a session's id, match and playback frame. It is paused at the match's
 * end, so every frame is one it has reached, and its match has no cache, so every chip is asked afresh.
 */
const aheadSession = (match: LibraryMatch) =>
  Effect.map(Ref.make<Playback>({ state: "paused", frame: match.info.frames, speed: 1, live: false }), (playback) =>
    ({ id: `ask-cache-${randomUUID()}`, match: { ...match, askCache: new Map() }, playback }) as unknown as Session)

const encode = Schema.encodeSync(AskCacheFile)

/** Write the run's cache file whole (a temporary file renamed over it). */
const writeCacheFile = (dir: string, entries: Record<string, AskCacheEntry>): string => {
  const path = join(dir, ASK_CACHE_FILE)
  const tmp = `${path}.tmp`
  writeFileSync(tmp, `${JSON.stringify(encode({ version: 1, entries }), null, 1)}\n`)
  renameSync(tmp, path)
  return path
}

/** Ask every suggested chip at each frame and write the answers to the match's ask cache. */
export const buildAskCache = async (o: AskCacheOptions): Promise<AskCacheResult> => {
  const log = o.log ?? (() => {})
  const league = JSON.parse(readFileSync(join(root, "data/league/league.json"), "utf8")) as League
  if (!existsSync(o.library)) throw new AskCacheError(`no library folder at ${o.library}`)
  const match = scanLibrary(o.library, league).get(o.matchId)
  if (!match) throw new AskCacheError(`no match "${o.matchId}" in ${o.library}`)
  const bad = o.frames.find((f) => !Number.isInteger(f) || f < 0 || f > match.info.frames)
  if (bad !== undefined) throw new AskCacheError(`frame ${bad} is not in the match (0-${match.info.frames})`)
  const entries: Record<string, AskCacheEntry> = Object.fromEntries(readAskCache(match.dir))
  const written: string[] = []
  const failed: Array<AskCacheResult["failed"][number]> = []
  const ask = makeAsk(o.ask ?? { send: a2aSender(o.agentsUrl) })
  const session = await Effect.runPromise(aheadSession(match))
  try {
    for (const frame of o.frames) {
      const t0 = performance.now()
      const got = await Effect.runPromise(ask.suggest(session, frame, o.segment.lang).pipe(Effect.map((chips) => ({ chips })), Effect.catch((e) => Effect.succeed({ error: e.reason }))))
      if ("error" in got) {
        failed.push({ key: `${frame}`, reason: "no_suggestions", message: got.error })
        log(`frame ${frame}: FAILED, no suggestions (${got.error})`)
        continue
      }
      const chips = got.chips
      log(`frame ${frame}: ${chips.length} chips (${Math.round(performance.now() - t0)} ms)`)
      for (const chip of chips) {
        const key = askCacheKey(frame, chip.chip_id)
        const t1 = performance.now()
        const updates: AskUpdate[] = [...(await Effect.runPromise(Stream.runCollect(ask.ask(session, { frame, question: chip.text, chip_id: chip.chip_id, segment: o.segment }))))]
        const ms = Math.round(performance.now() - t1)
        const end = updates.at(-1)
        if (end?.kind !== "answer") {
          const f = end?.kind === "failed" ? end : { reason: "offline", message: "the stream ended without an answer" }
          failed.push({ key, reason: f.reason, message: f.message })
          log(`  ${key}: FAILED ${f.reason} (${f.message})${entries[key] ? "; the older entry is kept" : ""}`)
          continue
        }
        const stages: AskStage[] = updates.flatMap((u) => (u.kind === "stage" ? [u.stage] : []))
        const clip = end.answer.clip_id === null ? null : await Effect.runPromise(ask.clip(session, end.answer.clip_id))
        entries[key] = { stages, answer: end.answer, clip }
        written.push(key)
        log(`  ${key}: ${end.answer.verdict ?? "explain"}, verified ${end.answer.verified} (${ms} ms) "${end.answer.headline}"`)
      }
    }
  } finally {
    await Effect.runPromise(ask.close(session))
    ask.workers.close()
  }
  const path = writeCacheFile(match.dir, entries)
  return { path, written, failed }
}

/**
 * The match library: run folders written by `pnpm sim` (and `pnpm agents`), one per match, under one directory.
 * A match plays from its tracking and events; its agent cues come from the run's cue cache (spec §6 cached replay).
 */
import { existsSync, readdirSync, readFileSync } from "node:fs"
import { join } from "node:path"
import type { League } from "@touchline/league"
import { readCueCache } from "@touchline/agent-gateway"
import { PREDATES_END_SWITCH, predatesEndSwitch } from "@touchline/stats"
import { Schema } from "effect"
import { AskAnswer, AskClip, type MatchInfo, type MatchSummary, type Player, type TeamBrief, type WhatIfClip } from "@touchline/rpc"
import { AskStage, segmentKey, type Cue, type Decision } from "@touchline/schema"
import { betterPassCues } from "./betterpass.js"
import { decisionCues, readDecisionLog } from "./decisions.js"
import { readWhatIfs } from "./whatif.js"

export class LibraryError extends Error {}

/** A run folder written before teams switched ends at half-time: left out of the library until it is regenerated. */
export class StaleRunError extends LibraryError {}

export interface LibraryMatch {
  readonly dir: string
  readonly info: MatchInfo
  /** The agents' cached cues (empty without a cache), and a cue for each verified better pass the scan found. */
  readonly cues: ReadonlyArray<Cue>
  /** The cached what-if clips by pass (`pnpm library`). */
  readonly clips: ReadonlyMap<string, WhatIfClip>
  /** A managed match's decisions (`pnpm manage`), in order; empty for a match without managers. */
  readonly decisions: ReadonlyArray<Decision>
  /** Pause-and-ask answers worked out ahead (`pnpm ask-cache`), by `"<frame>:<chip_id>"`; empty without a cache. */
  readonly askCache: ReadonlyMap<string, AskCacheEntry>
}

/** The demo answers of a run, in its folder. */
export const ASK_CACHE_FILE = "ask-cache.json"

/** One cached answer: the stages it went through, the answer and its what-if clip. */
export const AskCacheEntry = Schema.Struct({ stages: Schema.Array(AskStage), answer: AskAnswer, clip: Schema.NullOr(AskClip) })
export type AskCacheEntry = typeof AskCacheEntry.Type
export const AskCacheFile = Schema.Struct({ version: Schema.Literal(1), entries: Schema.Record(Schema.String, AskCacheEntry) })

const decodeAskCache = Schema.decodeUnknownSync(AskCacheFile)

/** A run's cached answers (none without the file). */
export const readAskCache = (dir: string): Map<string, AskCacheEntry> => {
  const path = join(dir, ASK_CACHE_FILE)
  if (!existsSync(path)) return new Map()
  return new Map(Object.entries(decodeAskCache(json(path)).entries))
}

interface Manifest {
  readonly match_id: string
  readonly seed: number
  readonly home: string
  readonly away: string
  readonly scenario: string | null
  readonly fps: number
  readonly stats: { readonly frames: number; readonly score: string }
  readonly managers?: { readonly home: string | null; readonly away: string | null }
}

const json = <A>(path: string): A => JSON.parse(readFileSync(path, "utf8")) as A

const team = (league: League, id: string, side: "home" | "away"): { brief: TeamBrief; players: Player[] } => {
  const club = league.clubs.find((c) => c.id === id)
  if (!club) throw new LibraryError(`club ${id} is not in the league file`)
  const c = club as unknown as { name: string; short: string; kits: Record<"home" | "away", { primary: string; secondary: string }>; squad: ReadonlyArray<{ id: string; name: string; jersey: number; role: string; preferredFoot: "left" | "right" }> }
  return {
    brief: { id, name: c.name, short: c.short, side, kit: c.kits[side] },
    players: c.squad.map((p) => ({ id: p.id, team_id: id, name: p.name, jersey: p.jersey, role: p.role, foot: p.preferredFoot }))
  }
}

/** Read one run folder (manifest, league names and kits, cue cache). */
export const readMatch = (dir: string, league: League): LibraryMatch => {
  if (!existsSync(join(dir, "manifest.json")) || !existsSync(join(dir, "tracking.jsonl"))) throw new LibraryError(`${dir} is not a run folder (no manifest.json or tracking.jsonl)`)
  if (existsSync(join(dir, "meta.json")) && predatesEndSwitch(json(join(dir, "meta.json")))) throw new StaleRunError(`${dir}: ${PREDATES_END_SWITCH}`)
  const m = json<Manifest>(join(dir, "manifest.json"))
  const [home, away] = [team(league, m.home, "home"), team(league, m.away, "away")]
  const [h, a] = m.stats.score.split("-").map(Number)
  const cues = existsSync(join(dir, "agents", "cues.jsonl")) ? readCueCache(dir) : []
  const summaryPath = join(dir, "agents", "summary.json")
  const model = existsSync(summaryPath) ? (json<{ models: string[] }>(summaryPath).models[0] ?? null) : null
  const summary: MatchSummary = {
    match_id: m.match_id, scenario: m.scenario, seed: m.seed, home: home.brief, away: away.brief, score: { home: h ?? 0, away: a ?? 0 },
    fps: m.fps, frames: m.stats.frames, segments: [...new Set(cues.map((c) => segmentKey(c.segment)))].sort(), model,
    managers: m.managers ? { home: m.managers.home, away: m.managers.away } : null
  }
  const info = { ...summary, players: [...home.players, ...away.players] }
  const clips = readWhatIfs(dir)
  const decisions = readDecisionLog(dir)
  return { dir, info, cues: [...cues, ...betterPassCues(info, clips.values()), ...decisionCues(info, decisions)], clips, decisions, askCache: readAskCache(dir) }
}

/** Every run folder directly under `root`, by match id (folders that are not runs are skipped; stale runs with a warning). */
export const scanLibrary = (root: string, league: League): Map<string, LibraryMatch> => {
  const out = new Map<string, LibraryMatch>()
  if (!existsSync(root)) return out
  for (const name of readdirSync(root, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name).sort()) {
    try {
      const m = readMatch(join(root, name), league)
      out.set(m.info.match_id, m)
    } catch (e) {
      if (!(e instanceof LibraryError)) throw e
      if (e instanceof StaleRunError) console.error(`library: skipped ${e.message}`)
    }
  }
  return out
}

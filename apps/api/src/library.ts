/**
 * The match library: run folders written by `pnpm sim` (and `pnpm agents`), one per match, under one directory.
 * A match plays from its tracking and events; its agent cues come from the run's cue cache (spec §6 cached replay).
 */
import { existsSync, readdirSync, readFileSync } from "node:fs"
import { join } from "node:path"
import type { League } from "@touchline/league"
import { readCueCache } from "@touchline/agent-gateway"
import type { MatchInfo, MatchSummary, Player, TeamBrief, WhatIfClip } from "@touchline/rpc"
import { segmentKey, type Cue } from "@touchline/schema"
import { betterPassCues } from "./betterpass.js"
import { readWhatIfs } from "./whatif.js"

export class LibraryError extends Error {}

export interface LibraryMatch {
  readonly dir: string
  readonly info: MatchInfo
  /** The agents' cached cues (empty without a cache), and a cue for each verified better pass the scan found. */
  readonly cues: ReadonlyArray<Cue>
  /** The cached what-if clips by pass (`pnpm library`). */
  readonly clips: ReadonlyMap<string, WhatIfClip>
}

interface Manifest {
  readonly match_id: string
  readonly seed: number
  readonly home: string
  readonly away: string
  readonly scenario: string | null
  readonly fps: number
  readonly stats: { readonly frames: number; readonly score: string }
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
  const m = json<Manifest>(join(dir, "manifest.json"))
  const [home, away] = [team(league, m.home, "home"), team(league, m.away, "away")]
  const [h, a] = m.stats.score.split("-").map(Number)
  const cues = existsSync(join(dir, "agents", "cues.jsonl")) ? readCueCache(dir) : []
  const summaryPath = join(dir, "agents", "summary.json")
  const model = existsSync(summaryPath) ? (json<{ models: string[] }>(summaryPath).models[0] ?? null) : null
  const summary: MatchSummary = {
    match_id: m.match_id, scenario: m.scenario, seed: m.seed, home: home.brief, away: away.brief, score: { home: h ?? 0, away: a ?? 0 },
    fps: m.fps, frames: m.stats.frames, segments: [...new Set(cues.map((c) => segmentKey(c.segment)))].sort(), model
  }
  const info = { ...summary, players: [...home.players, ...away.players] }
  const clips = readWhatIfs(dir)
  return { dir, info, cues: [...cues, ...betterPassCues(info, clips.values())], clips }
}

/** Every run folder directly under `root`, by match id (folders that are not runs are skipped). */
export const scanLibrary = (root: string, league: League): Map<string, LibraryMatch> => {
  const out = new Map<string, LibraryMatch>()
  if (!existsSync(root)) return out
  for (const name of readdirSync(root, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name).sort()) {
    try {
      const m = readMatch(join(root, name), league)
      out.set(m.info.match_id, m)
    } catch (e) {
      if (!(e instanceof LibraryError)) throw e
    }
  }
  return out
}

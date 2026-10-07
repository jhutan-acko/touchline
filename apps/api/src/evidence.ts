/**
 * What is behind a cue (spec §5.6 "Why?" drawer) and a match's recaps, from the run's agent traces and recaps and its
 * stats replayed once per match: each checked claim with what it is, the metric's last five minutes, and the events.
 */
import { existsSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { Effect } from "effect"
import { loadRun } from "@touchline/mcp-stats"
import { EvidenceNotFound, MatchNotFound, type Evidence, type EvidenceClaim, type RecapView, type Series } from "@touchline/rpc"
import { decodeMomentTrace, decodeRecap, type Claim, type MomentTrace, type Recap, type Segment } from "@touchline/schema"
import { METRICS, modelsFromJson, StatsError, xtGridFromJson, type Roster, type StatsQuery } from "@touchline/stats"
import { pickCues } from "./cues.js"
import type { LibraryMatch } from "./library.js"
import { root } from "./playback.js"
import type { LiveStore } from "./session.js"

/**
 * What a session has reached: answers never go past its frame, and a live session's come from what its agents wrote
 * (`live`), never from the cache. Without a view, the whole recorded match (tools and tests).
 */
export interface View {
  readonly frame: number
  readonly live: LiveStore | null
}

export const SERIES_S = 300 // the metric's last five minutes
export const SERIES_STEP_S = 15

const jsonl = <A>(path: string, decode: (u: unknown) => A): A[] =>
  existsSync(path) ? readFileSync(path, "utf8").split("\n").filter((l) => l.trim()).map((l) => decode(JSON.parse(l))) : []

const label = (c: Claim): string => {
  if (c.kind === "metric" && c.metric_id) return METRICS.find((m) => m.id === c.metric_id)?.name ?? c.metric_id
  return { score: "Score", minute: "Minute", event: "Event", better_option: "Better option", metric: "Metric" }[c.kind]
}

export const makeEvidence = (library: ReadonlyMap<string, LibraryMatch>) => {
  const queries = new Map<string, Promise<StatsQuery>>()
  const params = (f: string) => JSON.parse(readFileSync(join(root, "data/params", f), "utf8"))
  const roster = JSON.parse(readFileSync(join(root, "data/league/league.json"), "utf8")) as Roster

  const match = (id: string) => Effect.fromNullishOr(library.get(id)).pipe(Effect.mapError(() => new MatchNotFound({ match_id: id })))

  /** The match's stats as of its last frame (built once, on first use: a few seconds). */
  const query = (m: LibraryMatch) =>
    Effect.promise(() => {
      let q = queries.get(m.info.match_id)
      if (!q) {
        q = Effect.runPromise(loadRun(m.dir, modelsFromJson(params("stats-models.json")), { roster, xt: xtGridFromJson(params("xt-grid.json")) }))
        queries.set(m.info.match_id, q)
      }
      return q
    })

  const names = (m: LibraryMatch) => new Map<string, string>([[m.info.home.id, m.info.home.name], [m.info.away.id, m.info.away.name], ...m.info.players.map((p) => [p.id, p.name] as const)])

  /** The cues, traces and recaps a view may answer from. */
  const source = (m: LibraryMatch, view?: View) =>
    view?.live
      ? view.live
      : { cues: m.cues, traces: jsonl<MomentTrace>(join(m.dir, "agents", "traces.jsonl"), decodeMomentTrace), recaps: jsonl<Recap>(join(m.dir, "agents", "recaps.jsonl"), decodeRecap) }

  const evidence = (matchId: string, cueId: string, view?: View) =>
    Effect.gen(function* () {
      const m = yield* match(matchId)
      const { cues, traces, recaps } = source(m, view)
      const cue = cues.find((c) => c.cue_id === cueId)
      if (!cue || !cue.moment_id || (view && cue.anchor.frame_to > view.frame)) return yield* new EvidenceNotFound({ cue_id: cueId })
      const trace = traces.find((t) => t.moment.moment_id === cue.moment_id) ?? null
      const recap = recaps.find((r) => r.recap_id === cue.moment_id) ?? null
      if (!trace && !recap) return yield* new EvidenceNotFound({ cue_id: cueId })
      const raw = trace ? [...trace.analysis.claims, ...trace.draft.claims] : recap!.claims
      const seen = new Set<string>()
      const claims = raw.filter((c) => {
        const k = JSON.stringify([c.kind, c.metric_id, c.subject, c.event_id, c.receiver_id, c.value])
        return !seen.has(k) && (seen.add(k), true)
      })
      const who = names(m)
      const q = yield* query(m)
      const at = trace ? trace.moment.frame_to : recap!.at_frame
      const series: Series[] = []
      for (const c of claims) {
        if (c.kind !== "metric" || !c.metric_id || !c.subject || series.some((s) => s.metric_id === c.metric_id && s.subject === c.subject)) continue
        let points: Array<{ frame: number; value: number | null }>
        try {
          points = q.series(c.metric_id, c.subject, Math.max(0, at - SERIES_S * m.info.fps), at, SERIES_STEP_S).map((p) => ({ frame: p.frame, value: p.value }))
        } catch (e) {
          if (e instanceof StatsError) continue // a claim the stats cannot chart (it failed its check, or names no subject)
          throw e
        }
        if (points.length > 1) series.push({ metric_id: c.metric_id, subject: c.subject, label: `${label(c)} — ${who.get(c.subject) ?? c.subject}`, points })
      }
      const ids = [...new Set([...claims.flatMap((c) => (c.event_id ? [c.event_id] : [])), ...cue.evidence.filter((e) => !e.includes("@"))])]
      const events = q.eventsBetween(null, at, { ids }).map((e) => ({
        id: e.id, type: e.type, clock: e.match_clock, team_id: e.team_id, player: e.player_id ? (who.get(e.player_id) ?? e.player_id) : null, outcome: e.outcome, qualifiers: { ...e.qualifiers }
      }))
      const out: Evidence = {
        cue_id: cueId,
        moment: trace?.moment ?? null,
        cause: trace?.analysis.cause ?? null,
        explanation: trace?.analysis.explanation ?? null,
        claims: claims.map((c): EvidenceClaim => ({
          kind: c.kind, quote: c.quote, label: label(c), metric_id: c.metric_id, subject: c.subject, subject_name: c.subject ? (who.get(c.subject) ?? null) : null,
          value: c.value, at_frame: c.at_frame, event_id: c.event_id
        })),
        series,
        events,
        model: trace?.model ?? (view?.live ? null : m.info.model)
      }
      return out
    })

  const recap = (matchId: string, kind: "half_time" | "full_time", segment: Segment, view?: View) =>
    Effect.gen(function* () {
      const m = yield* match(matchId)
      const { cues, recaps } = source(m, view)
      const found = recaps.find((x) => x.kind === kind)
      const r = found && !(view && found.at_frame > view.frame) ? found : null // not before its whistle
      const out: RecapView = { recap: r, cards: r ? pickCues(cues.filter((c) => c.moment_id === r.recap_id), segment) : [] }
      return out
    })

  return { evidence, recap } as const
}

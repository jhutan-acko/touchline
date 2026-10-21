/** A match library for tests: one simulated match (costly_error, seed SEED) with a small hand-made cue cache. */
import { mkdtempSync, readFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { Effect } from "effect"
import { writeCache } from "@touchline/agent-gateway"
import type { League } from "@touchline/league"
import { decodeCue, decodeMomentTrace, decodeRecap, type Cue, type DomainEvent, type MomentTrace, type Recap } from "@touchline/schema"
import { SCENARIOS, writeMatch } from "@touchline/sim"
import { DEFAULT_PARAMS } from "@touchline/sim-core"
import { afterAll } from "vitest"

export const root = join(dirname(fileURLToPath(import.meta.url)), "../../..")
export const league = JSON.parse(readFileSync(join(root, "data/league/league.json"), "utf8")) as League
// Seed 12: the session test starts at the first goal's minute and needs more than 10 streamed frames (×64: every 25th)
// before the goal, so the goal must come at least about 25 s into its minute, and in the first half, before the
// half-time recap (seed 12: 26:57; seed 14's first goal moved to the second half when carriers stopped standing on the
// ball, 2026-10-10). It also gives three goals; the cue cache needs two. Seed 19 since realism v2 P1 (2026-10-14: keeper in
// hands, conduct cautions, stronger goal nudge): first goal 20:46, the second at 46:15, after the half-time recap. The
// evidence test needs five minutes of play before the first goal. Seed 2 since realism v2 P2 (2026-10-15: rule-table
// positioning, recalibrated, goal nudge 2): the first of 1-30 that fits, first goal 31:41, the second at 64:48. Seed 5 since
// realism v2 P3 (2026-10-17: pass choice, release timing, support rule 1; seed 2's first goal moved to 02:24): the first of
// 1-30 that fits, first goal 39:50 (50 s into its minute), the second at 55:48. Seed 4 since realism v2 P4 (2026-10-19:
// tackles, fouls, aerial duels, counter-press, team press, recalibrated; on seed 5 the cue order changed): the first of
// 1-30 that fits, first goal 33:48 (48 s into its minute), the second at 60:06, after the half-time recap. Seed 1 since
// realism v2 P5 (2026-10-20: set pieces, restart timing, keeper restarts, role moves, zonal marking, recalibrated; on seed 4
// the moments moved): the first of 1-30 for which the library's session, server, live and studio tests pass.
const SEED = 1
export const MATCH_ID = `lib-err-${SEED}`
const fixture = (f: string) => (JSON.parse(readFileSync(join(root, "packages/schema/fixtures/agents/valid", f), "utf8")) as { value: unknown }).value

// Each library is a simulated match (about 80 MB): delete them when the test file is done.
const made: string[] = []
afterAll(() => {
  for (const dir of made.splice(0)) rmSync(dir, { recursive: true, force: true })
})

export interface TestLibrary {
  readonly dir: string
  readonly run: string
  readonly goals: ReadonlyArray<DomainEvent>
  readonly cues: ReadonlyArray<Cue>
  readonly traces: ReadonlyArray<MomentTrace>
}

/** Simulate the match into a fresh library folder and write its cue cache: two goal moments in three segments, and a half-time recap. */
export const makeLibrary = async (): Promise<TestLibrary> => {
  const dir = mkdtempSync(join(tmpdir(), "touchline-lib-"))
  made.push(dir)
  const run = join(dir, MATCH_ID)
  const sc = SCENARIOS.costly_error!
  const club = (id: string) => league.clubs.find((c) => c.id === id)!
  await Effect.runPromise(writeMatch({ matchId: MATCH_ID, seed: SEED, kickoffTime: "2026-10-18T14:00:00.000Z", home: club(sc.home), away: club(sc.away), params: DEFAULT_PARAMS, dt: 0.1, script: sc.script }, run))
  const events = readFileSync(join(run, "domain.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l) as DomainEvent)
  const goals = events.filter((e) => e.type === "goal").slice(0, 2)
  const base = fixture("cue.json") as Cue
  const trace0 = fixture("trace.json") as MomentTrace
  const segments = [{ mode: "casual", lang: "en", club: null }, { mode: "analyst", lang: "es", club: null }, { mode: "casual", lang: "en", club: sc.home }] as const
  const cues: Cue[] = []
  const traces: MomentTrace[] = []
  for (const g of goals) {
    const momentId = `mo-${g.id}`
    for (const s of segments) {
      cues.push(decodeCue({
        ...base, cue_id: `${momentId}-${s.mode}.${s.lang}.${s.club ?? "neutral"}`, match_id: MATCH_ID, moment_id: momentId,
        anchor: { frame_from: g.frame_id - 50, frame_to: g.frame_id, clock: g.match_clock.slice(0, 5) },
        display: { slot: s.mode === "casual" ? "lower_third" : "side_panel", priority: 1, ttl_ms: 12000, template: "goal" },
        segment: s, text: { headline: `Goal (${s.mode} ${s.lang}${s.club ? " " + s.club : ""})`, body: "A finish." },
        evidence: [g.id], data: { "team.mom": 0.6 }
      }))
    }
    traces.push(decodeMomentTrace({
      ...trace0,
      moment: { ...trace0.moment, moment_id: momentId, match_id: MATCH_ID, type: "goal", signal_ids: [`${g.id}-signal`], frame_id: g.frame_id, frame_from: g.frame_id - 50, frame_to: g.frame_id, period: g.period, match_clock: g.match_clock, team_id: g.team_id, player_id: g.player_id, priority: 1 },
      analysis: { moment_id: momentId, cause: "clear chance converted", explanation: "A finish from close range.", claims: [
        { kind: "metric", sentence: 0, quote: "60%", metric_id: "team.mom", subject: g.team_id, value: 0.6, at_frame: g.frame_id, window_s: null, event_id: null, receiver_id: null },
        { kind: "event", sentence: 0, quote: "", metric_id: null, subject: g.player_id, value: null, at_frame: g.frame_id, window_s: null, event_id: g.id, receiver_id: null }
      ] },
      draft: { moment_id: momentId, lang: "en", sentences: ["Goal!", "A finish from close range."], claims: [] },
      verdicts: [{ ...trace0.verdicts[0]!, moment_id: momentId }],
      cue_ids: cues.filter((c) => c.moment_id === momentId).map((c) => c.cue_id)
    }))
  }
  const half = events.find((e) => e.type === "period_end")!
  const recapId = `${MATCH_ID}-recap-half_time`
  const recap = decodeRecap({ ...(fixture("recap.json") as Recap), recap_id: recapId, match_id: MATCH_ID, at_frame: half.frame_id, turning_points: [traces[0]!.moment.moment_id], player_of_match: null })
  cues.push(decodeCue({ ...base, cue_id: `${recapId}-casual.en.neutral`, match_id: MATCH_ID, moment_id: recapId, anchor: { frame_from: half.frame_id, frame_to: half.frame_id, clock: "45:00" },
    display: { slot: "recap_card", priority: 1, ttl_ms: 12000, template: "recap" }, segment: segments[0], text: { headline: "Half-time", body: "Score: 0-1." }, evidence: [] }))
  writeCache(run, { cues, traces, recaps: [recap], requests: [{ kind: "signals", frame: 100, outcome: "ok", ms: 1, cues: cues.length, late: 0, unverified: 0 }] })
  return { dir, run, goals, cues, traces }
}

/**
 * Manager decisions (Plan 4b): a managed match's decisions.jsonl. Each decision is shown as a cue at its key moment
 * (its headline and the manager's reason, in English: the reason is the manager's own words, numbers checked against
 * the what-if results) and served to the viewer's decision strip, never past the session's frame. No model writes
 * these cues; the commentary feed carries them like any other.
 */
import { existsSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { decisionKey, type MatchInfo } from "@touchline/rpc"
import { decodeDecision, type Cue, type Decision } from "@touchline/schema"

export const DECISIONS_FILE = "decisions.jsonl"

/** A run folder's decisions (none for a match without managers), each checked against the contract. */
export const readDecisionLog = (dir: string): Decision[] => {
  const file = join(dir, DECISIONS_FILE)
  if (!existsSync(file)) return []
  return readFileSync(file, "utf8").split("\n").filter((l) => l.trim()).map((l) => decodeDecision(JSON.parse(l)))
}

const clock = (minute: number) => {
  const s = Math.round(minute * 60)
  return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`
}

/** The cue of each decision, casual and analyst (English; other languages fall back to it). */
export const decisionCues = (info: MatchInfo, decisions: ReadonlyArray<Decision>): Cue[] =>
  decisions.flatMap((d) => {
    const team = info.home.id === d.team_id ? info.home : info.away
    const picked = d.options[d.pick]!
    const text = { headline: d.pick === 0 ? `${team.name} keep their plan` : `${team.name}: ${picked.label}`, body: d.reason }
    const gain = picked.xg_diff_vs_no_change
    return (["casual", "analyst"] as const).map((mode): Cue => ({
      cue_id: `${decisionKey(d)}-${mode}.en.neutral`,
      schema: "touchline.cue/1",
      match_id: info.match_id,
      moment_id: decisionKey(d),
      anchor: { frame_from: d.tick, frame_to: d.tick, clock: clock(d.minute) },
      display: { slot: "lower_third", priority: 2, ttl_ms: 12_000, template: "manager_decision" },
      segment: { mode, lang: "en", club: null },
      text,
      data: { "decision.options": d.options.length - 1, ...(d.pick > 0 && gain ? { "decision.xg_gain": gain.mean } : {}) },
      evidence: [decisionKey(d)],
      verified: true
    }))
  })

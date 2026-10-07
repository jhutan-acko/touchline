/** A TouchlineClient for component tests: canned answers, and ticks the test pushes to every watcher. */
import type { Evidence, MatchInfo, MatchSummary, Playback, RecapView, Tick } from "@touchline/rpc"
import type { Segment } from "@touchline/schema"
import type { TouchlineClient } from "../src/client.js"

export const team = (id: string, side: "home" | "away", name: string, color: string) => ({ id, name, short: id.slice(0, 3).toUpperCase(), side, kit: { primary: color, secondary: "#ffffff" } })

export const MATCH: MatchSummary = {
  match_id: "lib-costly_error-1", scenario: "costly_error", seed: 1, home: team("northwick", "home", "Northwick Mariners", "#1d4ed8"), away: team("larkspur", "away", "Larkspur City", "#dc2626"),
  score: { home: 1, away: 2 }, fps: 10, frames: 58000, segments: ["casual.en.neutral"], model: "stub"
}
export const INFO: MatchInfo = {
  ...MATCH,
  players: [
    { id: "p-nor-01", team_id: "northwick", name: "Datan Drenussen", jersey: 1, role: "GK" },
    { id: "p-lar-09", team_id: "larkspur", name: "Feseo Wylford", jersey: 9, role: "ST" }
  ]
}

export interface FakeClient extends TouchlineClient {
  readonly watchers: Array<{ segment: Segment; onTick: (t: Tick) => void; onEnd?: (error: string | null) => void }>
  readonly calls: string[]
  push(t: Tick): void
  /** End every watch with an error (null: the session closed normally). */
  fail(error: string | null): void
  /** How many times watch was called. */
  watchCount(): number
}

export const fakeClient = (o: { matches?: ReadonlyArray<MatchSummary>; evidence?: Evidence; recap?: RecapView } = {}): FakeClient => {
  const watchers: FakeClient["watchers"] = []
  const calls: string[] = []
  let playback: Playback = { state: "playing", frame: 0, speed: 4, live: false }
  let watched = 0
  return {
    watchers,
    calls,
    push: (t) => watchers.forEach((w) => w.onTick(t)),
    fail: (error) => watchers.splice(0).forEach((w) => w.onEnd?.(error)),
    watchCount: () => watched,
    listMatches: async () => o.matches ?? [MATCH],
    startSession: async (id, s) => {
      calls.push(`start ${id} x${s.speed} live=${s.live}`)
      playback = { ...playback, speed: s.speed, live: s.live }
      return { session_id: "s1", match: INFO }
    },
    watch: (_id, segment, onTick, onEnd) => {
      watched++
      const w = { segment, onTick, ...(onEnd ? { onEnd } : {}) }
      watchers.push(w)
      return () => watchers.splice(watchers.indexOf(w), 1)
    },
    control: async (_id, action, speed) => {
      calls.push(`control ${action}${speed ? ` ${speed}` : ""}`)
      playback = { ...playback, state: action === "pause" ? "paused" : action === "play" ? "playing" : playback.state, speed: speed ?? playback.speed }
      return playback
    },
    evidence: async (_m, cueId) => {
      calls.push(`evidence ${cueId}`)
      if (!o.evidence) throw new Error("no evidence")
      return o.evidence
    },
    recap: async (sessionId, kind) => {
      calls.push(`recap ${sessionId} ${kind}`)
      return o.recap ?? { recap: null, cards: [] }
    },
    close: async () => {}
  }
}

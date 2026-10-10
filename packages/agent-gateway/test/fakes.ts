import { readFileSync } from "node:fs"
import { join } from "node:path"
import type { AgentRequest, Cue, MatchRequest, Signal } from "@touchline/schema"
import type { Artifact, Sender } from "../src/a2a.js"
import type { MatchPlan } from "../src/gateway.js"
import { root } from "../src/replay.js"

const fixture = (name: string) => (JSON.parse(readFileSync(join(root, "packages/schema/fixtures/agents/valid", name), "utf8")) as { value: unknown }).value

export const CUE = fixture("cue.json") as Cue
export const TRACE = fixture("trace.json")
export const RECAP = fixture("recap.json")

export const signal = (frame: number, type: Signal["type"] = "pressure_shift"): Signal => ({
  id: `m-${type}-${frame}`, match_id: "m", type, frame_id: frame, frame_from: frame - 10, frame_to: frame, period: "first_half", match_clock: "10:00.00",
  team_id: "home-fc", player_id: null, metric: null, value: null, salience: 0.7, evidence: [], data: {}
})

export const plan = (frames: number[], whistles = { half_time: 27000, full_time: 57000 }): MatchPlan => ({
  matchId: "m", mcpUrl: "http://127.0.0.1:1/mcp", fps: 10, signals: frames.map((f) => signal(f)), whistles
})

/** A sender that answers each request with `answer(req, n)` (n counts calls), waiting `delayMs` before each artifact. */
export const fake = (answer: (req: MatchRequest, n: number) => Artifact[] | Error, delayMs = 0): Sender & { calls: MatchRequest[] } => {
  const calls: MatchRequest[] = []
  const send = async function* (req: AgentRequest) {
    calls.push(req as MatchRequest)
    const out = answer(req as MatchRequest, calls.length)
    if (out instanceof Error) throw out
    for (const a of out) {
      if (delayMs) await new Promise((r) => setTimeout(r, delayMs))
      yield a
    }
  }
  return Object.assign(send, { calls })
}

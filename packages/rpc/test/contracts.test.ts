import { readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { Schema } from "effect"
import { describe, expect, it } from "vitest"
import { decodeTick, MatchNotFound, MatchSummary, TouchlineRpcs } from "../src/contracts.js"

const root = join(dirname(fileURLToPath(import.meta.url)), "../../..")
const cue = (JSON.parse(readFileSync(join(root, "packages/schema/fixtures/agents/valid/cue.json"), "utf8")) as { value: unknown }).value
const team = (id: string, side: "home" | "away") => ({ id, name: id, short: id.slice(0, 3).toUpperCase(), side, kit: { primary: "#112233", secondary: "#ffffff" } })
const frame = { frame: 120, period: "first_half", clock: "00:12.00", ball: { x: 0, y: 0, z: 0 }, home: [{ id: "p-a-01", x: -40, y: 0 }], away: [{ id: "p-b-01", x: 40, y: 0 }] }

describe("API contracts", () => {
  it("carry frames, cues and playback state on one stream", () => {
    expect(decodeTick({ kind: "frame", frame }).kind).toBe("frame")
    expect(decodeTick({ kind: "cue", cue }).kind).toBe("cue")
    expect(decodeTick({ kind: "playback", playback: { state: "paused", frame: 120, speed: 4, live: false } }).kind).toBe("playback")
    expect(() => decodeTick({ kind: "chat", text: "hi" })).toThrow()
    expect(() => decodeTick({ kind: "cue", cue: { ...(cue as object), schema: "touchline.cue/0" } })).toThrow()
  })

  it("describe a match in the library", () => {
    const m = { match_id: "eval-costly_error-1", scenario: "costly_error", seed: 1, home: team("northwick", "home"), away: team("larkspur", "away"), score: { home: 1, away: 2 }, fps: 10, frames: 58007, segments: ["casual.en.neutral"], model: "stub" }
    expect(Schema.decodeUnknownSync(MatchSummary)(m)).toEqual(m)
    expect(() => Schema.decodeUnknownSync(MatchSummary)({ ...m, score: { home: -1, away: 0 } })).toThrow()
  })

  it("offer the endpoints of spec §5.7", () => {
    expect([...TouchlineRpcs.requests.keys()].sort()).toEqual(["Control", "GetEvidence", "GetMatch", "GetRecap", "ListMatches", "StartSession", "StudioAct", "StudioWatch", "Watch", "WatchGraphics"])
  })

  it("refuse playback speeds out of range", () => {
    const start = TouchlineRpcs.requests.get("StartSession")!
    const decode = Schema.decodeUnknownSync(start.payloadSchema as unknown as Schema.Decoder<unknown>)
    expect(() => decode({ match_id: "m", speed: 4, from_minute: 0, live: false })).not.toThrow()
    for (const speed of [0, 100]) expect(() => decode({ match_id: "m", speed, from_minute: 0, live: false })).toThrow()
  })

  it("name their errors", () => {
    expect(new MatchNotFound({ match_id: "x" })._tag).toBe("MatchNotFound")
  })
})

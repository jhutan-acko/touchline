import type { Cue } from "@touchline/schema"
import { describe, expect, it } from "vitest"
import { pickCues } from "../src/cues.js"

const cue = (id: string, slot: Cue["display"]["slot"], club: string | null = null): Cue =>
  ({
    cue_id: id,
    schema: "touchline.cue/1",
    match_id: "m",
    moment_id: "mo-1",
    anchor: { frame_from: 10, frame_to: 20, clock: "00:02" },
    display: { slot, priority: 1, ttl_ms: 12000, template: slot === "pitch_marker" ? "ghost" : "goal" },
    segment: { mode: "analyst", lang: "en", club },
    text: slot === "pitch_marker" ? null : { headline: "h", body: "b" },
    data: {},
    evidence: [],
    verified: true
  }) as Cue

describe("pickCues and pitch markers", () => {
  it("keeps a moment's pitch-marker cue beside its text cue, each the best variant", () => {
    const cues = [cue("a", "side_panel"), cue("a:m", "pitch_marker"), cue("a-club", "side_panel", "northwick"), cue("a-club:m", "pitch_marker", "northwick")]
    const out = pickCues(cues, { mode: "analyst", lang: "en", club: "northwick" })
    expect(out.map((c) => c.cue_id)).toEqual(["a-club", "a-club:m"])
    expect(pickCues(cues, { mode: "analyst", lang: "en", club: null }).map((c) => c.cue_id)).toEqual(["a", "a:m"])
  })
})

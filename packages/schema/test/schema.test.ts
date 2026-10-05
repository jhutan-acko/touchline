import { describe, expect, it } from "vitest"
import { initMatch, isFinished, step, type DomainEvent as SimEvent, type Frame as SimFrame } from "@touchline/sim-core"
import { decodeDomainEvent, decodeFrame } from "../src/domain.js"
import { decodeSignal } from "../src/stats.js"
import { makeConfig } from "@touchline/sim-core/testing"

describe("domain schema", () => {
  it("decodes every event and a sample of frames from a full match", () => {
    let s = initMatch(makeConfig(5))
    const ev: SimEvent[] = []
    const fr: SimFrame[] = []
    while (!isFinished(s)) { const r = step(s); s = r.state; ev.push(...r.events); if (r.frame && r.frame.tick % 100 === 0) fr.push(r.frame) }
    for (const e of ev) expect(() => decodeDomainEvent(e)).not.toThrow()
    for (const f of fr) expect(() => decodeFrame(f)).not.toThrow()
  })
  it("rejects an unknown event type", () => {
    expect(() => decodeDomainEvent({ type: "dance" })).toThrow()
  })
  it("decodes a signal and rejects an unknown metric id", () => {
    const signal = {
      id: "m-1-s1", match_id: "m-1", type: "big_chance", frame_id: 120, frame_from: 110, frame_to: 120, period: "first_half", match_clock: "00:12.00",
      team_id: "ironmoor", player_id: "p-iro-09", metric: "shot.xg", value: 0.41, salience: 0.7, evidence: ["m-1-e12"], data: { "shot.xg": 0.41 }
    }
    expect(decodeSignal(signal).value).toBe(0.41)
    expect(() => decodeSignal({ ...signal, metric: "shot.vibes" })).toThrow()
    expect(decodeSignal({ ...signal, type: "card", metric: null, value: null }).metric).toBeNull()
  })
})

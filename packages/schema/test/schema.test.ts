import { describe, expect, it } from "vitest"
import { initMatch, isFinished, step, type DomainEvent as SimEvent, type Frame as SimFrame } from "@touchline/sim-core"
import { decodeDomainEvent, decodeFrame } from "../src/domain.js"
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
})

import { describe, expect, it } from "vitest"
import { DEFAULT_PARAMS as P, type Params } from "../src/params.js"
import { initMatch, isFinished, step } from "../src/step.js"
import { makeConfig } from "../src/testing.js"
import type { DomainEvent } from "../src/types.js"

const run = (params: Params, seed = 7) => {
  let s = initMatch(makeConfig(seed, { params }))
  const events: DomainEvent[] = []
  while (!isFinished(s)) {
    const r = step(s)
    s = r.state
    events.push(...r.events)
  }
  return { s, events }
}

describe("cards", () => {
  it("books players for conduct at about cautionPerMatch, sends off on a second caution, and the match still finishes", () => {
    const { s, events } = run({ ...P, defending: { ...P.defending, cautionPerMatch: 10 } })
    const conduct = events.filter((e) => e.type === "card" && e.attrs.reason === "conduct")
    expect(conduct.length).toBeGreaterThanOrEqual(3)
    expect(conduct.length).toBeLessThanOrEqual(20)
    expect(s.phase.kind).toBe("full_time")
    for (const c of events.filter((e) => e.type === "card" && e.attrs.colour === "second_yellow")) {
      const p = s.players.find((x) => x.id === c.player_id)!
      expect(p.sentOff).toBe(true)
      // A player sent off takes no further part.
      expect(events.some((e) => e.player_id === p.id && e.frame_id > c.frame_id && e.type !== "card")).toBe(false)
    }
  }, 120_000)

  it("a booked player is never booked again for a foul when bookedYellowFactor is 0", () => {
    const { events } = run({ ...P, defending: { ...P.defending, yellowPerFoul: 1, redPerFoul: 0, bookedYellowFactor: 0 } })
    const cards = events.filter((e) => e.type === "card")
    expect(cards.length).toBeGreaterThan(0)
    expect(cards.filter((e) => e.attrs.colour === "second_yellow")).toEqual([])
  }, 120_000)

  it("booked players commit no fouls when bookedFoulFactor is 0", () => {
    const { events } = run({ ...P, defending: { ...P.defending, yellowPerFoul: 1, redPerFoul: 0, bookedFoulFactor: 0 } })
    const bookedAt = new Map<string, number>()
    for (const e of events) {
      if (e.type === "card" && e.player_id && !bookedAt.has(e.player_id)) bookedAt.set(e.player_id, e.frame_id)
      if (e.type === "foul" && e.player_id && bookedAt.has(e.player_id)) expect(e.frame_id).toBeLessThanOrEqual(bookedAt.get(e.player_id)!)
    }
    expect(bookedAt.size).toBeGreaterThan(0)
  }, 120_000)
})

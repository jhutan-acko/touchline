import { describe, expect, it } from "vitest"
import { DEFAULT_PARAMS as P, type Params } from "../src/params.js"
import { initMatch, isFinished, step } from "../src/step.js"
import { makeConfig } from "../src/testing.js"
import type { DomainEvent, MatchState } from "../src/types.js"

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
    const secondYellows = events.filter((e) => e.type === "card" && e.attrs.colour === "second_yellow")
    // Seed 7 at this rate has a second caution, so the sending-off checks below cannot pass vacuously.
    expect(secondYellows.length).toBeGreaterThan(0)
    for (const c of secondYellows) {
      const p = s.players.find((x) => x.id === c.player_id)!
      expect(p.sentOff).toBe(true)
      // A player sent off takes no further part.
      expect(events.some((e) => e.player_id === p.id && e.frame_id > c.frame_id && e.type !== "card")).toBe(false)
    }
  }, 120_000)

  it("a booked player is never booked again for a foul when bookedYellowFactor is 0", () => {
    // No conduct cautions, so any second yellow could only come from a foul.
    const { events } = run({ ...P, defending: { ...P.defending, yellowPerFoul: 1, redPerFoul: 0, bookedYellowFactor: 0, cautionPerMatch: 0 } })
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

  it("a carrier who has been sent off loses the ball at once: it goes loose and he plays no further part", () => {
    let s: MatchState = initMatch(makeConfig(7))
    // Play on to an outfield player on the ball in open play.
    const onBall = (x: MatchState) =>
      x.phase.kind === "open_play" && x.possession.kind === "owned" && x.possession.restart === null && x.players.find((p) => p.id === (x.possession as { playerId: string }).playerId)!.role !== "GK"
    while (!onBall(s)) s = step(s).state
    const ownerId = (s.possession as { playerId: string }).playerId
    s = { ...s, players: s.players.map((p) => (p.id === ownerId ? { ...p, sentOff: true } : p)) }
    const r = step(s)
    expect(r.state.possession.kind).toBe("loose")
    const later: DomainEvent[] = [...r.events]
    let t = r.state
    for (let i = 0; i < 600 && !isFinished(t); i++) {
      const n = step(t)
      t = n.state
      later.push(...n.events)
      if (t.possession.kind === "owned") expect(t.possession.playerId).not.toBe(ownerId)
    }
    expect(later.filter((e) => e.player_id === ownerId)).toEqual([])
  })

  it("a free kick with every outfielder sent off is taken by the keeper", () => {
    // Deferred P3 test (P4 ruling 22). distribution.rule 1, so a keeper's distribution would be labelled if it were one.
    const p: Params = { ...P, distribution: { ...P.distribution, rule: 1 } }
    const s0 = initMatch(makeConfig(7, { params: p }))
    const gk = s0.players.find((x) => x.side === "home" && x.role === "GK")!
    const players = s0.players.map((x) => (x.side === "home" && x.role !== "GK" ? { ...x, sentOff: true } : x))
    // precondition: home has no active outfielder
    expect(players.filter((x) => x.side === "home" && x.role !== "GK" && !x.sentOff)).toHaveLength(0)
    const fk = { x: gk.pos.x + 3, y: gk.pos.y + 2 }
    let s: MatchState = {
      ...s0, players, tick: 50, periodTick: 50,
      phase: { kind: "restart", restart: "free_kick", side: "home", at: fk, resumeTick: 51 },
      possession: { kind: "dead" }, ball: { pos: { ...fk, z: 0 }, vel: { x: 0, y: 0, z: 0 } }
    }
    const events: DomainEvent[] = []
    let setPiece: DomainEvent | undefined
    for (let i = 0; i < 300 && !setPiece; i++) {
      const r = step(s)
      s = r.state
      events.push(...r.events)
      setPiece = r.events.find((e) => e.type === "set_piece")
    }
    expect(setPiece).toBeDefined()
    expect(setPiece!.attrs.kind).toBe("free_kick")
    expect(setPiece!.player_id).toBe(gk.id)
    // G17: he takes it as a free kick, not a distribution: play on until he kicks it (alone, he clears it), and no keeper_distribution is emitted
    let released = false
    for (let i = 0; i < 300 && !released; i++) {
      const r = step(s)
      s = r.state
      events.push(...r.events)
      released = r.events.some((e) => e.player_id === gk.id && ["pass", "clearance", "shot"].includes(e.type))
    }
    expect(released).toBe(true)
    expect(events.filter((e) => e.type === "keeper_distribution")).toEqual([])
  })
})

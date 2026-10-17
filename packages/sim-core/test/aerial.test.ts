import { describe, expect, it } from "vitest"
import { launchVelocity } from "../src/ball.js"
import { DEFAULT_PARAMS as P, type Params } from "../src/params.js"
import { aerialWinShare, resolveFlight, type Resolution } from "../src/resolve.js"
import { Rng, seedRng } from "../src/rng.js"
import { aerialDuel, applyFlightFoul, initMatch, isFinished, step, workAt } from "../src/step.js"
import type { DomainEvent, FlightFoul, MatchState, PlayerState } from "../src/types.js"
import { kickoffPlayersFor, makeConfig } from "../src/testing.js"

// Explicit switched-off and switched-on engines (ruling F4): never rely on DEFAULT_PARAMS being off. fouls.rule is held
// at 0 so the foul zone is 1 here whatever Task 4 ships.
const off: Params = { ...P, aerial: { ...P.aerial, rule: 0 }, fouls: { ...P.fouls, rule: 0 } }
const on: Params = { ...P, aerial: { ...P.aerial, rule: 1 }, fouls: { ...P.fouls, rule: 0 } }
const onWith = (a: Partial<Params["aerial"]>, d: Partial<Params["defending"]> = {}): Params => ({ ...on, aerial: { ...on.aerial, ...a }, defending: { ...on.defending, ...d } })
const sigmoid = (z: number): number => 1 / (1 + Math.exp(-z))

const base = kickoffPlayersFor(makeConfig(1))
const at = (p: PlayerState, x: number, y: number): PlayerState => ({ ...p, pos: { x, y }, vel: { x: 0, y: 0 } })

// A cross from the right (home attacks +x in the first half) to a striker at (44, 0); the ball is first reachable
// at about (42.5, 2.7), 1.9 m up. The defender stands `dx` metres along x from the striker, 0.5 m to his left.
const passer = at(base[9]!, 30, 25)
const striker = at(base[10]!, 44, 0)
const cross = { pos: { x: 30, y: 25, z: 0 }, vel: launchVelocity(passer.pos, striker.pos, "high", P) }
const defenderAt = (dx: number): PlayerState => at(base[13]!, 44 + dx, 0.5)
const resolveCross = (def: PlayerState, p: Params, rng = new Rng(seedRng(1))): Resolution => resolveFlight(cross, passer.id, striker.id, [passer, striker, def], p, 0.1, rng)

describe("T4: who contests a high ball (resolveFlight)", () => {
  it("rule off: a two-sided header still makes its one draw", () => {
    const def = defenderAt(-1)
    const rng = new Rng(seedRng(1))
    const r = resolveCross(def, off, rng)
    expect(r.aerial).not.toBeNull()
    expect(r.contest).toBeUndefined()
    const once = new Rng(seedRng(1))
    once.chance(0.5)
    expect(rng.state).toEqual(once.state)
    // Under on the same two-sided header draws nothing here and reports the defender as the contender.
    const rngOn = new Rng(seedRng(1))
    const rOn = resolveCross(def, on, rngOn)
    expect(rngOn.state).toEqual(new Rng(seedRng(1)).state)
    expect(rOn.aerial).toBeNull()
    expect(rOn.contest?.id).toBe(def.id)
  })

  it("rule on: resolve makes no draw for high balls and reports the contender", () => {
    // Precondition: the defender does not reach the ball (no two-sided header under off).
    const near = defenderAt(1.25)
    expect(resolveCross(near, off).aerial).toBeNull()
    // His disc misses the contact by between 0.5 and 1 m (about 0.6): contested at contestM 1, not at 0.5.
    const rng = new Rng(seedRng(1))
    const r = resolveCross(near, onWith({ contestM: 1 }), rng)
    expect(r.winnerId).toBe(striker.id)
    expect(r.contest?.id).toBe(near.id)
    expect(r.contest!.slack).toBeLessThan(0)
    expect(r.aerial).toBeNull()
    expect(rng.state).toEqual(new Rng(seedRng(1)).state)
    expect(resolveCross(near, onWith({ contestM: 0.5 })).contest).toBeUndefined()
    // The same defender 1.4 m further back misses it by about 2 m: no contest at contestM 1 (but one at 2.5).
    const far = defenderAt(2.65)
    expect(resolveCross(far, onWith({ contestM: 1 })).contest).toBeUndefined()
    expect(resolveCross(far, onWith({ contestM: 2.5 })).contest?.id).toBe(far.id)
  })

  it("rule on: a ground pass gives no contest", () => {
    const from = at(base[2]!, 0, 0), to = at(base[5]!, 15, 0), def = at(base[13]!, 15.5, 1.2)
    const ball = { pos: { x: 0, y: 0, z: 0 }, vel: launchVelocity(from.pos, to.pos, "ground", P) }
    const r = resolveFlight(ball, from.id, to.id, [from, to, def], onWith({ contestM: 5 }), 0.1, new Rng(seedRng(1)))
    expect(r.winnerId).not.toBeNull()
    expect(r.contest).toBeUndefined()
  })

  it("rule on: a keeper neither wins nor makes a contest (pre-flight G27)", () => {
    const gk = { ...defenderAt(1.25), id: base[11]!.id, role: "GK" as const }
    expect(resolveCross(gk, onWith({ contestM: 1 })).contest).toBeUndefined()
  })
})

/** A state in open play (after the kickoff), with players placed as given. */
const openPlay = (p: Params, place: Record<string, { x: number; y: number }> = {}): MatchState => {
  let s = initMatch(makeConfig(1, { params: p }))
  while (s.phase.kind !== "open_play") s = step(s).state
  return { ...s, players: s.players.map((x) => (place[x.id] ? { ...x, pos: place[x.id]!, vel: { x: 0, y: 0 } } : x)) }
}
const withHeading = (w: ReturnType<typeof workAt>, id: string, heading: number): void => {
  const pl = w.player(id)
  w.setPlayer({ ...pl, attrs: { ...pl.attrs, heading } })
}
const contested = (winnerId: string, rivalId: string, slack: number, x: number, y: number): Resolution => ({
  ticks: 10, winnerId, result: "reached", ball: { pos: { x, y, z: 1.8 }, vel: { x: 0, y: 0, z: -3 } }, aerial: null, contest: { id: rivalId, slack }
})

describe("T4: the aerial duel (step seam)", () => {
  it("the duel goes to heading and arrival", () => {
    expect(aerialWinShare(0, 0, on.aerial)).toBe(0.5)
    expect(aerialWinShare(0.2, 0, on.aerial)).toBeCloseTo(sigmoid(0.6), 12)
    expect(aerialWinShare(0, 0.5, on.aerial)).toBeCloseTo(sigmoid(0.5), 12)
    const s = openPlay(on)
    const [a, b] = [s.players[10]!.id, s.players[13]!.id]
    for (const [dh, slack] of [[0.2, 0], [-0.1, -0.8], [0, -2]] as const) {
      const w = workAt(s)
      withHeading(w, a, 0.6 + dh)
      withHeading(w, b, 0.6)
      const n = 4000
      let firstWins = 0
      for (let i = 0; i < n; i++) {
        const before = w.rng.aerial.state
        const r = aerialDuel(w, contested(a, b, slack, 10, 0), w.player(a)).res
        expect(w.rng.aerial.state).not.toEqual(before)
        if (r.winnerId === a) firstWins++
        else expect(r.winnerId).toBe(b)
        expect(r.aerial).toEqual(r.winnerId === a ? { winnerId: a, loserId: b } : { winnerId: b, loserId: a })
      }
      // The contender's slack is relative to the first's, so the first's lead is -slack.
      expect(Math.abs(firstWins / n - aerialWinShare(dh, -slack, on.aerial))).toBeLessThan(0.03)
    }
  })

  it("rule off: the seam passes the resolution through and draws nothing", () => {
    const s = openPlay(off)
    const w = workAt(s)
    const res = contested(s.players[10]!.id, s.players[13]!.id, -0.5, 10, 0)
    const before = [w.rng.aerial.state, w.rng.foul.state]
    const out = aerialDuel(w, res, w.player(s.players[10]!.id))
    expect(out.res).toBe(res)
    expect(out.foul).toBeNull()
    expect([w.rng.aerial.state, w.rng.foul.state]).toEqual(before)
  })

  it("an aerial foul: the loser fouls the winner, with the right restart", () => {
    // Home attacks +x in the first half: (47, 2) is in home's attacking box, away's own box.
    const s = openPlay(on)
    const attacker = s.players[10]!, defender = s.players[13]!
    expect(attacker.side).toBe("home")
    expect(defender.side).toBe("away")
    const sure = onWith({ foulShare: 1, bHeading: 100 })
    // A defender losing to an attacker in the attacker's box: a penalty for the attacker's side (pre-flight G22: the
    // loser is forced by bHeading 100 and the heading gap).
    {
      const w = workAt({ ...s, config: { ...s.config, params: sure } })
      withHeading(w, attacker.id, 0.9)
      withHeading(w, defender.id, 0.3)
      const ad = aerialDuel(w, contested(attacker.id, defender.id, 0, 47, 2), w.player(attacker.id))
      expect(ad.res.aerial).toEqual({ winnerId: attacker.id, loserId: defender.id })
      expect(ad.foul).toEqual({ offenderId: defender.id, victimId: attacker.id, at: { x: 47, y: 2 }, offenderYellow: 0 })
      expect(applyFlightFoul(w, ad.foul!)).toBe(true)
      expect(w.phase).toMatchObject({ kind: "restart", restart: "penalty", side: "home" })
      expect(w.events.find((e) => e.type === "foul")?.attrs).toMatchObject({ kind: "aerial", victim_id: attacker.id })
    }
    // An attacker losing to a defender in the defenders' box: a free kick for the defenders at the contact.
    {
      const w = workAt({ ...s, config: { ...s.config, params: sure } })
      withHeading(w, attacker.id, 0.3)
      withHeading(w, defender.id, 0.9)
      const ad = aerialDuel(w, contested(attacker.id, defender.id, 0, 47, 2), w.player(attacker.id))
      expect(ad.res.winnerId).toBe(defender.id)
      expect(ad.res.ball.pos).toMatchObject({ x: 47, y: 2 })
      expect(ad.foul).toMatchObject({ offenderId: attacker.id, victimId: defender.id })
      expect(applyFlightFoul(w, ad.foul!)).toBe(true)
      expect(w.phase).toEqual(expect.objectContaining({ kind: "restart", restart: "free_kick", side: "away", at: { x: 47, y: 2 } }))
    }
    // foulShare 0: the foul stream is drawn, but no foul.
    {
      const w = workAt({ ...s, config: { ...s.config, params: onWith({ foulShare: 0 }) } })
      const before = w.rng.foul.state
      expect(aerialDuel(w, contested(attacker.id, defender.id, 0, 47, 2), w.player(attacker.id)).foul).toBeNull()
      expect(w.rng.foul.state).not.toEqual(before)
    }
  })

  it("a booked loser fouls with bookedFoulFactor; one booked since release keeps it only with that chance", () => {
    const s = openPlay(on)
    const attacker = s.players[10]!, defender = s.players[13]!
    const half = onWith({ foulShare: 1, bHeading: 100 }, { bookedFoulFactor: 0.5 })
    const w = workAt({ ...s, config: { ...s.config, params: half } })
    withHeading(w, attacker.id, 0.9)
    withHeading(w, defender.id, 0.3)
    w.setPlayer({ ...w.player(defender.id), yellow: 1 })
    let fouls = 0
    const n = 2000
    for (let i = 0; i < n; i++) if (aerialDuel(w, contested(attacker.id, defender.id, 0, 10, 2), w.player(attacker.id)).foul) fouls++
    expect(Math.abs(fouls / n - 0.5)).toBeLessThan(0.04)
    // Booked since release (yellow 1 now, 0 at release): kept about half the time.
    let kept = 0
    for (let i = 0; i < n; i++) {
      const wi = workAt({ ...s, config: { ...s.config, params: half } })
      wi.rng.foul = new Rng(seedRng(1000 + i))
      wi.setPlayer({ ...wi.player(defender.id), yellow: 1 })
      if (applyFlightFoul(wi, { offenderId: defender.id, victimId: attacker.id, at: { x: 10, y: 2 }, offenderYellow: 0 })) kept++
    }
    expect(Math.abs(kept / n - 0.5)).toBeLessThan(0.04)
  })
})

/** A state whose live pass to `victim` resolves on the next tick, carrying an aerial foul by `offender`. */
const flightWithFoul = (p: Params, sentOff: boolean): { s: MatchState; offender: string; victim: string } => {
  const s0 = openPlay(p, { [base[10]!.id]: { x: 10, y: 0 }, [base[13]!.id]: { x: 10.5, y: 0.5 } })
  const passerId = base[9]!.id, victim = base[10]!.id, offender = base[13]!.id
  const foul: FlightFoul = { offenderId: offender, victimId: victim, at: { x: 10, y: 0 }, offenderYellow: 0 }
  const pending = { type: "pass" as const, frame_id: s0.tick - 5, team_id: "home-fc", player_id: passerId, x: 0, y: 0, x_end: 10, y_end: 0, attrs: { kind: "long" } }
  const duel = { ...pending, type: "aerial_duel" as const, frame_id: s0.tick + 1, player_id: victim, attrs: { winner_id: victim, loser_id: offender } }
  const s: MatchState = {
    ...s0,
    players: s0.players.map((x) => (x.id === offender ? { ...x, sentOff } : x)),
    ball: { pos: { x: 9, y: 0, z: 2 }, vel: { x: 8, y: 0, z: -2 } },
    possession: {
      kind: "in_flight",
      flight: {
        kind: "pass", fromId: passerId, side: "home", releaseTick: s0.tick - 5, resolveTick: s0.tick + 1, winnerId: victim, outcome: "successful",
        pending, extra: [duel], path: null, restartAfter: null, looseBall: null, deflectTo: null, foul
      }
    }
  }
  return { s, offender, victim }
}

describe("T4: an aerial foul at resolution", () => {
  it("is given when the flight resolves, with no reception", () => {
    const { s, victim } = flightWithFoul(on, false)
    const r = step(s)
    const types = r.events.map((e) => e.type)
    expect(types).toContain("foul")
    expect(types).not.toContain("reception")
    expect(r.events.find((e) => e.type === "foul")!.attrs).toMatchObject({ kind: "aerial", victim_id: victim })
    expect(r.state.phase).toMatchObject({ kind: "restart", restart: "free_kick", side: "home" })
  })

  it("a foul whose offender was sent off in flight is dropped", () => {
    const { s, victim } = flightWithFoul(on, true)
    const w = workAt(s)
    const f = s.possession.kind === "in_flight" ? s.possession.flight.foul! : null
    expect(applyFlightFoul(w, f!)).toBe(false)
    expect(w.phase.kind).toBe("open_play")
    const r = step(s)
    expect(r.events.map((e) => e.type)).not.toContain("foul")
    // The flight resolves normally: the winner owns the ball.
    expect(r.state.possession).toMatchObject({ kind: "owned", playerId: victim })
  })
})

const run = (p: Params, seed: number, dt: number): DomainEvent[] => {
  let s = initMatch(makeConfig(seed, { params: p, dt }))
  const events: DomainEvent[] = []
  while (!isFinished(s)) {
    const r = step(s)
    s = r.state
    events.push(...r.events)
  }
  return events
}
const count = (ev: DomainEvent[], t: DomainEvent["type"]): number => ev.filter((e) => e.type === t).length
const aerialFouls = (ev: DomainEvent[]): number[] => ev.flatMap((e, i) => (e.type === "foul" && e.attrs.kind === "aerial" ? [i] : []))
/** Every aerial foul follows its duel and its pass (outcome by the victim's side, no reception), and restarts for the victim. */
const checkAerialFouls = (ev: DomainEvent[]): void => {
  const sideOf = (id: string): string => id.slice(0, id.lastIndexOf("-"))
  for (const i of aerialFouls(ev)) {
    const foul = ev[i]!
    const victimTeam = sideOf(String(foul.attrs.victim_id))
    const duel = ev[i - 1]!
    expect(duel.type).toBe("aerial_duel")
    expect(duel.attrs).toMatchObject({ winner_id: foul.attrs.victim_id, loser_id: foul.player_id })
    const kick = ev[i - 2]!
    expect(["pass", "clearance"]).toContain(kick.type)
    expect(kick.outcome).toBe(kick.team_id === victimTeam ? "successful" : "intercepted")
    const next = ev.slice(i + 1).find((e) => e.type === "set_piece" || e.type === "reception")
    expect(next?.type).toBe("set_piece")
    expect(next?.team_id).toBe(victimTeam)
  }
}

describe("T4: in matches", () => {
  for (const dt of [0.1, 0.04])
    it(`more aerial duels and every aerial foul restarts for the victim (dt ${dt})`, () => {
      const evOff = run(off, 7, dt)
      const evOn = run(on, 7, dt)
      expect(aerialFouls(evOff)).toHaveLength(0)
      expect(count(evOff, "aerial_duel")).toBeGreaterThan(0)
      expect(count(evOn, "aerial_duel")).toBeGreaterThanOrEqual(1.5 * count(evOff, "aerial_duel"))
      checkAerialFouls(evOn)
      // foulShare x 4 for the sample.
      const evMore = run(onWith({ foulShare: Math.min(1, 4 * on.aerial.foulShare) }), 7, dt)
      expect(aerialFouls(evMore).length).toBeGreaterThanOrEqual(1)
      checkAerialFouls(evMore)
    }, 600_000)
})

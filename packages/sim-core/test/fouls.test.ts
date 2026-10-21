import { describe, expect, it } from "vitest"
import { bearingOf } from "../src/duel.js"
import { angleFactor, zoneFactor } from "../src/fouls.js"
import { attackX, dirOf, PITCH } from "../src/geometry.js"
import { DEFAULT_PARAMS as P, type Params } from "../src/params.js"
import { foulChance, foulZone, initMatch, isFinished, step, workAt } from "../src/step.js"
import { kickoffPlayersFor, makeConfig } from "../src/testing.js"
import type { Side } from "../src/geometry.js"
import type { DomainEvent, MatchState, PlayerState } from "../src/types.js"

// Explicit switches (F4): every other P4 rule is pinned to 0, so Task 10's switch-on cannot move these cases; off and on
// differ only in fouls.rule.
/** Every P6 rule pinned 0 (P6 Task 8 switched them on): the engine this file's counts were written on (F4). */
const p6Off = (p: Params): Params => ({
  ...p, firstTime: { ...p.firstTime, rule: 0 }, header: { ...p.header, rule: 0 }, saveGeo: { ...p.saveGeo, rule: 0 },
  execFatigue: { ...p.execFatigue, rule: 0 }, shotModel: { ...p.shotModel, rule: 0 }
})
const base: Params = {
  ...p6Off(P),
  tackle: { ...P.tackle, rule: 0 }, aerial: { ...P.aerial, rule: 0 }, transition: { ...P.transition, rule: 0 },
  press: { ...P.press, rule: 0 }, marking: { ...P.marking, rule: 0, landingRule: 0 },
  firstTick: { ...P.firstTick, scopeRule: 0 }, release: { ...P.release, rejudge: 0, freeRule: 0 },
  // Every P5 rule pinned 0 too (P5 Task 14 switched them on).
  setAttack: { ...P.setAttack, rule: 0 }, setDefend: { ...P.setDefend, rule: 0 }, setShapes: { ...P.setShapes, rule: 0 }, deadBall: { ...P.deadBall, rule: 0 },
  keeperRestarts: { ...P.keeperRestarts, rule: 0 }, directFk: { ...P.directFk, rule: 0 }, roleMoves: { ...P.roleMoves, runRule: 0, rotateRule: 0 }
}
const off: Params = { ...base, fouls: { ...base.fouls, rule: 0 } }
const on: Params = { ...base, fouls: { ...base.fouls, rule: 1 } }
const f = on.fouls

const at = (p: PlayerState, x: number, y: number, vx = 0, vy = 0): PlayerState => ({ ...p, pos: { x, y }, vel: { x: vx, y: vy } })

/**
 * Open play with one duel in prospect: `owner` (a CM of `side`) on the ball at (ox, oy) running (vx, 0), his nearest
 * opponent at (dx, dy), everyone else far away. The owner's hold has run out, so he decides this tick.
 */
const oneDuel = (p: Params, o: { side?: Side; period?: MatchState["period"]; ox: number; oy?: number; vx: number; dx: number; dy: number; dt?: number }): { s: MatchState; def: PlayerState; owner: PlayerState } => {
  const cfg = makeConfig(3, { params: p, dt: o.dt ?? 0.1 })
  const s0 = initMatch(cfg)
  const pls = kickoffPlayersFor(cfg)
  const cs = o.side ?? "home"
  const own = at(pls.find((x) => x.side === cs && x.role === "CM")!, o.ox, o.oy ?? 0, o.vx, 0)
  const def = at(pls.find((x) => x.side !== cs && x.role !== "GK")!, o.dx, o.dy)
  const moved = new Map<string, PlayerState>([[own.id, own], [def.id, def]])
  const players = pls.map((x) => moved.get(x.id) ?? (x.role === "GK" ? x : at(x, x.side === "home" ? -40 : 40, 25 + (x.slot % 11))))
  const s: MatchState = {
    ...s0, tick: 100, periodTick: 100, period: o.period ?? s0.period, players, phase: { kind: "open_play" },
    ball: { pos: { x: own.pos.x, y: own.pos.y, z: 0 }, vel: { x: 0, y: 0, z: 0 } },
    possession: { kind: "owned", playerId: own.id, since: 90, restart: null },
    lastTouch: { playerId: own.id, side: own.side }
  }
  return { s, def, owner: own }
}

describe("T3: zone and angle factors", () => {
  it("zone factor: 1 in the own half, 0.4 from the final third, 0.12 in the box", () => {
    expect(zoneFactor(-30, false, f)).toBe(1)
    expect(zoneFactor(0, false, f)).toBe(1)
    expect(zoneFactor(8.75, false, f)).toBeCloseTo(0.7, 12)
    expect(zoneFactor(17.5, false, f)).toBeCloseTo(0.4, 12)
    expect(zoneFactor(30, false, f)).toBeCloseTo(0.4, 12)
    expect(zoneFactor(40, true, f)).toBeCloseTo(0.12, 12)
    // foulZone measures in the victim's attacking frame: a home victim at x = -40 in the second half is at u = +40, in the box.
    const { s, owner } = oneDuel(on, { ox: -40, vx: 0, dx: -41, dy: 0, period: "second_half" })
    expect(attackX(owner.side, owner.pos.x, "second_half")).toBe(40)
    expect(foulZone(workAt(s), owner, owner.pos)).toBeCloseTo(0.12, 12)
    // the same spot in the first half is his own half; an away victim there in the first half is in the box he attacks
    const first = oneDuel(on, { ox: -40, vx: 0, dx: -41, dy: 0 })
    expect(foulZone(workAt(first.s), first.owner, first.owner.pos)).toBe(1)
    const away = oneDuel(on, { side: "away", ox: -40, vx: 0, dx: -41, dy: 0 })
    expect(foulZone(workAt(away.s), away.owner, away.owner.pos)).toBeCloseTo(0.12, 12)
    // wide of the box (|y| > 20.16) at u = 40 is the final third, not the box
    const wide = oneDuel(on, { ox: -40, oy: 25, vx: 0, dx: -41, dy: 25, period: "second_half" })
    expect(foulZone(workAt(wide.s), wide.owner, wide.owner.pos)).toBeCloseTo(0.4, 12)
    // rule off: identity
    const o = oneDuel(off, { ox: -40, vx: 0, dx: -41, dy: 0, period: "second_half" })
    expect(foulZone(workAt(o.s), o.owner, o.owner.pos)).toBe(1)
  })

  it("angle factor: front 1, side 1.6, behind 2.4", () => {
    expect(angleFactor("front", f)).toBe(1)
    expect(angleFactor("side", f)).toBeCloseTo(1.6, 12)
    expect(angleFactor("behind", f)).toBeCloseTo(2.4, 12)
  })
})

describe("T3: the foul chance on a lost tackle", () => {
  it("rule off keeps the flat rate and the box x0.2", () => {
    expect(off.defending.boxFoulFactor).toBeCloseTo(0.2, 12)
    const box = oneDuel(off, { ox: 45, vx: 3, dx: 44, dy: 0 })
    const open = oneDuel(off, { ox: 0, vx: 3, dx: -1, dy: 0 })
    // preconditions: one carrier in the box he attacks, one not
    expect(attackX("home", box.owner.pos.x, "first_half")).toBeGreaterThan(PITCH.halfL - PITCH.boxDepth)
    expect(attackX("home", open.owner.pos.x, "first_half")).toBeLessThan(PITCH.halfL - PITCH.boxDepth)
    expect(foulChance(workAt(box.s), box.def, box.owner)).toBeCloseTo(off.defending.foulPerTackle * 0.2, 12)
    expect(foulChance(workAt(open.s), open.def, open.owner)).toBeCloseTo(off.defending.foulPerTackle, 12)
  })

  it("rule on is foulPerTackle x zone x angle, in the carrier's frame, mirrored in the second half and for the away side", () => {
    const fpt = on.defending.foulPerTackle
    const cases: Array<[Parameters<typeof oneDuel>[1], number]> = [
      // own half, tackled from behind (the carrier runs +x, the defender trails him)
      [{ ox: -10, vx: 3, dx: -11, dy: 0 }, 1 * f.behind],
      // final third, from the front
      [{ ox: 30, vx: 3, dx: 31, dy: 0 }, f.finalThird * 1],
      // box, from the side
      [{ ox: 45, vx: 3, dx: 45, dy: 1 }, f.box * f.side],
      // halfway into the zone ramp, from behind
      [{ ox: 8.75, vx: 3, dx: 7.75, dy: 0 }, 0.7 * f.behind],
      // the same pictures mirrored: second half (home attacks -x) and the away side in the first half
      [{ period: "second_half", ox: 10, vx: -3, dx: 11, dy: 0 }, 1 * f.behind],
      [{ period: "second_half", ox: -45, vx: -3, dx: -45, dy: 1 }, f.box * f.side],
      [{ side: "away", ox: -30, vx: -3, dx: -31, dy: 0 }, f.finalThird * 1],
      [{ side: "away", ox: 10, vx: -3, dx: 11, dy: 0 }, 1 * f.behind]
    ]
    for (const [fix, factor] of cases) {
      const d = oneDuel(on, fix)
      expect(foulChance(workAt(d.s), d.def, d.owner), JSON.stringify(fix)).toBeCloseTo(Math.min(1, fpt * factor), 12)
    }
    // the bearings the cases rely on
    const b = oneDuel(on, { ox: 45, vx: 3, dx: 45, dy: 1 })
    expect(bearingOf(b.owner.pos, b.owner.vel, dirOf("home", "first_half"), b.def.pos, on.tackle)).toBe("side")
  })
})

/** Step `s` once; return the events and the state after. */
const once = (s: MatchState): { s: MatchState; events: DomainEvent[] } => {
  const r = step(s)
  return { s: r.state, events: [...r.events] }
}

describe("T4: shielding fouls", () => {
  // Every tackle attempt in reach fires at once (the hazard is 1).
  const sure = (p: Params, attackerShare: number): Params => ({ ...p, defending: { ...p.defending, tackleRatePerS: 1e6 }, fouls: { ...p.fouls, attackerShare } })
  for (const dt of [0.1, 0.04])
    it(`shielding fouls come only from slow carriers and give the free kick to the defenders (dt ${dt})`, () => {
      const fix = { ox: -10, vx: 0.5, dx: -11, dy: 0, dt }
      // precondition: under off the same fixture makes a tackle attempt this tick (a tackle event, or a foul from it)
      const pre = once(oneDuel(sure(off, 1), fix).s)
      expect(pre.events.some((e) => e.type === "tackle")).toBe(true)
      expect(pre.events.filter((e) => e.type === "foul" && e.attrs.kind === "shielding")).toEqual([])

      const slow = oneDuel(sure(on, 1), fix)
      const r = once(slow.s)
      const fouls = r.events.filter((e) => e.type === "foul")
      expect(fouls).toHaveLength(1)
      expect(fouls[0]!.attrs.kind).toBe("shielding")
      expect(fouls[0]!.player_id).toBe(slow.owner.id)
      expect(fouls[0]!.attrs.victim_id).toBe(slow.def.id)
      // the tackle was not contested: no tackle event
      expect(r.events.some((e) => e.type === "tackle")).toBe(false)
      const ph = r.s.phase
      expect(ph.kind).toBe("restart")
      if (ph.kind === "restart") {
        expect(ph.restart).toBe("free_kick")
        expect(ph.side).toBe(slow.def.side)
        expect(ph.at.x).toBeCloseTo(slow.def.pos.x, 9)
      }

      // a carrier at 3 m/s gives no shielding foul (the attempt still fires)
      const fast = once(oneDuel(sure(on, 1), { ...fix, vx: 3 }).s)
      expect(fast.events.some((e) => e.type === "tackle")).toBe(true)
      expect(fast.events.filter((e) => e.type === "foul" && e.attrs.kind === "shielding")).toEqual([])
      // off with the same slow fixture gives none
      const o = once(oneDuel(sure(off, 1), fix).s)
      expect(o.events.filter((e) => e.type === "foul" && e.attrs.kind === "shielding")).toEqual([])
    })
})

describe("T3: take-on fouls", () => {
  // The owner always tries a take-on when he can and always wins it; no tackle attempt comes first.
  const forced = (p: Params, takeOnShare: number): Params => ({
    ...p,
    defending: { ...p.defending, tackleRatePerS: 0 },
    takeOn: { ...p.takeOn, b0: 50 },
    actions: { ...p.actions, logits: Object.fromEntries(Object.entries(p.actions.logits).map(([k, row]) => [k, { ...row, take_on: 50 }])) as Params["actions"]["logits"] },
    fouls: { ...p.fouls, takeOnShare }
  })
  for (const dt of [0.1, 0.04])
    it(`a take-on foul follows a won take-on and stops the dribble (dt ${dt})`, () => {
      const fix = { ox: -10, vx: 0, dx: -7, dy: 0, dt }
      // precondition: under off the same fixture gives a won take-on and a carry
      const pre = oneDuel(forced(off, 1), fix)
      const pr = once(pre.s)
      expect(pr.events.filter((e) => e.type === "take_on").map((e) => e.attrs.outcome)).toEqual(["won"])
      expect(pr.events.some((e) => e.type === "foul")).toBe(false)
      expect(pr.s.players.find((x) => x.id === pre.owner.id)!.intent.kind).toBe("carry")

      const d = oneDuel(forced(on, 1), fix)
      const r = once(d.s)
      const i = r.events.findIndex((e) => e.type === "take_on")
      expect(i).toBeGreaterThanOrEqual(0)
      expect(r.events[i]!.attrs.outcome).toBe("won")
      const foul = r.events.slice(i + 1).find((e) => e.type === "foul")!
      expect(foul).toBeDefined()
      expect(foul.frame_id).toBe(r.events[i]!.frame_id)
      expect(foul.attrs.kind).toBe("take_on")
      expect(foul.player_id).toBe(d.def.id)
      expect(foul.attrs.victim_id).toBe(d.owner.id)
      const ph = r.s.phase
      expect(ph.kind).toBe("restart")
      if (ph.kind === "restart") {
        expect(ph.restart).toBe("free_kick")
        expect(ph.side).toBe(d.owner.side)
      }
      expect(r.s.players.find((x) => x.id === d.owner.id)!.intent.kind).not.toBe("carry")
      expect(r.s.carry).toBeNull()
    })
})

const run = (params: Params, seed: number): DomainEvent[] => {
  let s = initMatch(makeConfig(seed, { params }))
  const events: DomainEvent[] = []
  while (!isFinished(s)) {
    const r = step(s)
    s = r.state
    events.push(...r.events)
  }
  return events
}

/** Defender fouls (tackle and take-on) in matches, and how many had the victim in the final third or the box he attacks. */
const defenderFouls = (p: Params, seeds: ReadonlyArray<number>): { n: number; high: number } => {
  let n = 0, high = 0
  for (const seed of seeds) {
    let s = initMatch(makeConfig(seed, { params: p }))
    while (!isFinished(s)) {
      const r = step(s)
      s = r.state
      const foul = r.events.find((e) => e.type === "foul" && (e.attrs.kind === "tackle" || e.attrs.kind === "take_on"))
      if (!foul) continue
      // The foul's restart is set in the same step, at the victim (his side takes it; a penalty is in the box he attacks).
      expect(s.phase.kind).toBe("restart")
      if (s.phase.kind !== "restart") continue
      expect(s.phase.side).not.toBe(foul.team_id === s.config.home.id ? "home" : "away")
      n++
      const u = s.phase.restart === "penalty" ? PITCH.halfL : attackX(s.phase.side, s.phase.at.x, s.period)
      if (u > 17.5) high++
    }
  }
  return { n, high }
}

describe("T3/T4 in matches", () => {
  it("booked players commit no fouls of any kind when bookedFoulFactor is 0", () => {
    // G16: takeOnShare 0.6 and attackerShare 0.2, so seed 7 has take-on and shielding fouls; aerial fouls on too.
    const p: Params = {
      ...on,
      aerial: { ...on.aerial, rule: 1 },
      fouls: { ...on.fouls, takeOnShare: 0.6, attackerShare: 0.2 },
      defending: { ...on.defending, yellowPerFoul: 1, redPerFoul: 0, bookedFoulFactor: 0 }
    }
    const events = run(p, 7)
    const bookedAt = new Map<string, number>()
    for (const e of events) {
      if (e.type === "card" && e.player_id && !bookedAt.has(e.player_id)) bookedAt.set(e.player_id, e.frame_id)
      if (e.type === "foul" && e.player_id && bookedAt.has(e.player_id))
        expect(e.frame_id, `${String(e.attrs.kind)} foul by ${e.player_id}`).toBeLessThanOrEqual(bookedAt.get(e.player_id)!)
    }
    expect(bookedAt.size).toBeGreaterThan(0)
    const kinds = events.filter((e) => e.type === "foul").map((e) => e.attrs.kind)
    expect(kinds.filter((k) => k === "shielding").length).toBeGreaterThan(0)
    expect(kinds.filter((k) => k === "take_on").length).toBeGreaterThan(0)
  }, 240_000)

  it("in matches, defender fouls fall in the final third and the box", () => {
    // G10: foulPerTackle 0.5 in both arms, so each arm has at least 20 defender fouls.
    const at05 = (p: Params): Params => ({ ...p, defending: { ...p.defending, foulPerTackle: 0.5 } })
    const o = defenderFouls(at05(off), [7, 9])
    const n = defenderFouls(at05(on), [7, 9])
    expect(o.n).toBeGreaterThanOrEqual(20)
    expect(n.n).toBeGreaterThanOrEqual(20)
    expect(o.high).toBeGreaterThan(0)
    expect(n.high / n.n).toBeLessThan(o.high / o.n)
  }, 480_000)
})

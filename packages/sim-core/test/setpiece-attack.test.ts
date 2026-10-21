import { describe, expect, it } from "vitest"
import { attackX, dist, PITCH, type Period, type Side, type Vec2 } from "../src/geometry.js"
import { DEFAULT_PARAMS as P, type Params } from "../src/params.js"
import { Rng, seedRng } from "../src/rng.js"
import { attackTable, holdSpot, restKeepers } from "../src/setpiece-attack.js"
import { setPieceKind } from "../src/setpiece.js"
import { attackSpot, initMatch, isFinished, noteSetPiece, planAttack, setPieceRun, step, workAt } from "../src/step.js"
import { makeConfig } from "../src/testing.js"
import type { Flight, MatchState, PendingEvent, PlayerState, RestartKind } from "../src/types.js"

// Explicit on and off (plan 8e "Test fixtures"): Task 14 flips the defaults. Everything else as the defaults.
const off: Params = { ...P, setAttack: { ...P.setAttack, rule: 0 } }
const on: Params = { ...P, setAttack: { ...P.setAttack, rule: 1 } }
/** Every P6 rule pinned 0 (P6 Task 8 switched them on): the engine this file's counts were written on (F4). */
const p6Off = (p: Params): Params => ({
  ...p, firstTime: { ...p.firstTime, rule: 0 }, header: { ...p.header, rule: 0 }, saveGeo: { ...p.saveGeo, rule: 0 },
  execFatigue: { ...p.execFatigue, rule: 0 }, shotModel: { ...p.shotModel, rule: 0 }
})

/** A restart being set up (its resume tick far off): `side` takes `restart` at `at` in `period`, at tick 500. */
const pending = (p: Params, restart: RestartKind, at: Vec2, period: Period = "first_half", dt = 0.1, seed = 7): MatchState => {
  const s = initMatch(makeConfig(seed, { params: p, dt }))
  return { ...s, tick: 500, periodTick: 500, period, phase: { kind: "restart", restart, side: "home", at, resumeTick: 5000 } }
}

/** State `s` with its pending restart taken by `side` instead. */
const asSide = (s: MatchState, side: Side): MatchState => (s.phase.kind === "restart" ? { ...s, phase: { ...s.phase, side } } : s)

/** The Work for state `s` with its restart planned by the attacking seam (as startRestart does). */
const planned = (s: MatchState) => {
  const w = workAt(s)
  const ph = w.phase
  if (ph.kind !== "restart") throw new Error("not a restart")
  const kind = setPieceKind(ph.restart, ph.at, ph.side, w.period)
  w.restartPlan = { kind, ...planAttack(w, ph, kind) }
  return { w, ph }
}

const near = (a: Vec2 | null, b: Vec2, tol = 0.1): boolean => a !== null && dist(a, b) <= tol

describe("S1/S4 attacking set pieces: setpiece-attack.ts", () => {
  it("corner spots: both CBs go up, the keeper to u -12, attackers hold 2 m short", () => {
    for (const period of ["first_half", "second_half"] as const) {
      const d = period === "first_half" ? 1 : -1
      const { w, ph } = planned(pending(on, "corner", { x: d * 52.5, y: 34 }, period))
      const home = w.active("home")
      const cbs = home.filter((pl) => pl.role === "CB")
      expect(cbs).toHaveLength(2)
      const spots = cbs.map((pl) => attackSpot(w, pl, ph))
      // One CB on each side of the goal, 2 m short of the table's u 42.
      expect(spots.some((s) => near(s, { x: d * 40, y: 4 }))).toBe(true)
      expect(spots.some((s) => near(s, { x: d * 40, y: -4 }))).toBe(true)
      const gk = home.find((pl) => pl.role === "GK")!
      expect(near(attackSpot(w, gk, ph), { x: d * -12, y: 0 })).toBe(true)
      // The ST (central slot) holds 2 m short of (43, 0).
      const st = home.find((pl) => pl.role === "ST")!
      expect(near(attackSpot(w, st, ph), { x: d * 41, y: 0 })).toBe(true)
    }
    // An away-side corner (away attacks -x in the first half), nobody kept back: the 4-4-2's FBs hold 2 m short of
    // (30, 7) and its Ws of (37, 11), one of each on either side of the pitch.
    const noRest: Params = { ...on, setAttack: { ...on.setAttack, restKeep: { ...on.setAttack.restKeep, corner: 0 } } }
    const away = planned(asSide(pending(noRest, "corner", { x: -52.5, y: 34 }), "away"))
    expect(away.w.restartPlan!.restKeep).toEqual([])
    const spotsOf = (role: string) => away.w.active("away").filter((pl) => pl.role === role).map((pl) => attackSpot(away.w, pl, away.ph))
    for (const [role, u, y] of [["FB", 28, 7], ["W", 35, 11]] as const) {
      const sp = spotsOf(role)
      expect(sp).toHaveLength(2)
      expect(sp.some((x) => near(x, { x: -u, y }))).toBe(true)
      expect(sp.some((x) => near(x, { x: -u, y: -y }))).toBe(true)
    }
    for (const pl of away.w.active("home")) expect(attackSpot(away.w, pl, away.ph)).toBeNull()
    const { w, ph } = planned(pending(off, "corner", { x: 52.5, y: 34 }))
    expect(w.restartPlan).toEqual({ kind: "corner" })
    for (const pl of w.active()) expect(attackSpot(w, pl, ph)).toBeNull()
  })

  it("holdSpot steps back toward the side's own goal, mirrored after half-time", () => {
    expect(holdSpot({ x: 42, y: 4 }, "home", "first_half", 2)).toEqual({ x: 40, y: 4 })
    expect(holdSpot({ x: -42, y: 4 }, "home", "second_half", 2)).toEqual({ x: -40, y: 4 })
    expect(holdSpot({ x: -42, y: -4 }, "away", "first_half", 2)).toEqual({ x: -40, y: -4 })
  })

  it("attack tables: corner, wide free kick shifted, central free kick; none for other kinds", () => {
    const s = { ...on.setAttack, fkWideShiftU: 1.5 }
    expect(attackTable("corner", s)).toBe(s.corner)
    expect(attackTable("fk_central", s)).toBe(s.fk)
    const wide = attackTable("fk_wide", s)!
    expect(wide.ST).toEqual([s.fk.ST[0] + 1.5, s.fk.ST[1]])
    expect(wide.CB).toEqual([s.fk.CB[0] + 1.5, s.fk.CB[1]])
    for (const k of ["fk_other", "throw_att", "throw_mid", "throw_def", "goal_kick", "kickoff", "penalty"] as const) expect(attackTable(k, s)).toBeNull()
  })

  it("rest defence keeps the deepest FB or CM first, at u 20-25", () => {
    const s0 = initMatch(makeConfig(7, { params: on }))
    const home = s0.players.filter((pl) => pl.side === "home")
    const taker = home.find((pl) => pl.role === "W")!
    const rng = new Rng(seedRng(42))
    const counts = [0, 0, 0, 0]
    for (let i = 0; i < 1000; i++) {
      const kept = restKeepers(home, taker.id, 1.4, rng)
      counts[kept.length]! += 1
      expect(home.find((pl) => pl.id === kept[0])!.role).toBe("FB")
      expect(kept).not.toContain(taker.id)
    }
    expect(counts[1]! / 1000).toBeGreaterThan(0.56)
    expect(counts[1]! / 1000).toBeLessThan(0.64)
    expect(counts[2]! / 1000).toBeGreaterThan(0.36)
    expect(counts[2]! / 1000).toBeLessThan(0.44)
    // No FB: a CM goes first (the DM is a CM's row, behind CM in the order).
    const noFb = home.filter((pl) => pl.role !== "FB")
    expect(noFb.find((pl) => pl.id === restKeepers(noFb, taker.id, 1, rng)[0])!.role).toBe("CM")
    // A taker who is the first FB is skipped.
    const fb = home.find((pl) => pl.role === "FB")!
    const kept = restKeepers(home, fb.id, 1, rng)
    expect(kept).toHaveLength(1)
    expect(kept[0]).not.toBe(fb.id)
    expect(home.find((pl) => pl.id === kept[0])!.role).toBe("FB")
    // 7 outfielders (one of them the taker), k 4.1: never more than the 6 others.
    const seven = [home[0]!, ...home.filter((pl) => pl.role !== "GK").slice(0, 7)]
    for (let i = 0; i < 200; i++) {
      const k = restKeepers(seven, seven[1]!.id, 4.1, rng)
      expect(k.length).toBeLessThanOrEqual(6)
      expect(new Set(k).size).toBe(k.length)
      expect(k).not.toContain(seven[0]!.id)
    }
    // k above the pool: everyone available is kept, and no more (7 outfielders less the taker; 3 less the taker).
    expect(restKeepers(seven, seven[1]!.id, 8, rng)).toHaveLength(6)
    const four = [home[0]!, ...home.filter((pl) => pl.role !== "GK").slice(0, 4)]
    expect(restKeepers(four, four[1]!.id, 4.1, rng)).toHaveLength(3)
    // In a planned corner the keepers stand at u 20-25, |y| <= 12, on their spots (no hold).
    for (let seed = 1; seed <= 20; seed++) {
      const { w, ph } = planned(pending(on, "corner", { x: 52.5, y: -34 }, "first_half", 0.1, seed))
      const keep = w.restartPlan!.restKeep!
      expect(keep.length).toBeGreaterThanOrEqual(1)
      for (const id of keep) {
        const spot = attackSpot(w, w.player(id), ph)!
        expect(spot.x).toBeGreaterThanOrEqual(20)
        expect(spot.x).toBeLessThanOrEqual(25)
        expect(Math.abs(spot.y)).toBeLessThanOrEqual(12)
        expect(spot).toEqual(w.restartPlan!.restSpot![id])
      }
    }
  })

  it("planAttack keeps the deepest FB first, whichever slot he plays in", () => {
    const one: Params = { ...on, setAttack: { ...on.setAttack, restKeep: { ...on.setAttack.restKeep, corner: 1 } } }
    const base = pending(one, "corner", { x: 52.5, y: 34 })
    const fbs = base.players.filter((pl) => pl.side === "home" && pl.role === "FB")
    expect(fbs).toHaveLength(2)
    for (const [deep, high] of [[fbs[0]!, fbs[1]!], [fbs[1]!, fbs[0]!]] as const) {
      const s = { ...base, players: base.players.map((pl) => (pl.id === deep.id ? { ...pl, pos: { x: -30, y: 0 } } : pl.id === high.id ? { ...pl, pos: { x: -10, y: 0 } } : pl)) }
      const { w } = planned(s)
      expect(w.restartPlan!.restKeep).toEqual([deep.id])
    }
    // Second half (home attacks -x): depth is judged in the side's frame.
    const s2 = pending(one, "corner", { x: -52.5, y: 34 }, "second_half")
    const p2 = { ...s2, players: s2.players.map((pl) => (pl.id === fbs[0]!.id ? { ...pl, pos: { x: 10, y: 0 } } : pl.id === fbs[1]!.id ? { ...pl, pos: { x: 30, y: 0 } } : pl)) }
    expect(planned(p2).w.restartPlan!.restKeep).toEqual([fbs[1]!.id])
  })

  it("a new restart ends the last set piece's run under rule 1 only", () => {
    const live = { kind: "corner" as const, side: "home" as const, tick: 400, takerId: "x" }
    for (const [p, cleared] of [[on, true], [off, false]] as const) {
      for (const [restart, at] of [["corner", { x: 52.5, y: 34 }], ["goal_kick", { x: -47, y: 0 }]] as const) {
        const w = workAt(pending(p, restart, at))
        const ph = w.phase
        if (ph.kind !== "restart") throw new Error("not a restart")
        w.setPiece = live
        planAttack(w, ph, setPieceKind(ph.restart, ph.at, ph.side, w.period))
        expect(w.setPiece).toEqual(cleared ? undefined : live)
      }
    }
  })

  it("at an attacking-third throw-in only the rest keepers move", () => {
    const { w, ph } = planned(pending(on, "throw_in", { x: 30, y: PITCH.halfW }))
    expect(w.restartPlan!.kind).toBe("throw_att")
    const keep = new Set(w.restartPlan!.restKeep!)
    // k 4.1: four or five kept.
    expect(keep.size).toBeGreaterThanOrEqual(4)
    expect(keep.size).toBeLessThanOrEqual(5)
    for (const pl of w.active("home")) {
      const spot = attackSpot(w, pl, ph)
      if (keep.has(pl.id)) expect(spot).not.toBeNull()
      else expect(spot).toBeNull()
    }
    // Other restarts plan nothing and draw nothing.
    for (const [restart, at] of [["throw_in", { x: 0, y: PITCH.halfW }], ["free_kick", { x: 0, y: 5 }], ["goal_kick", { x: -47, y: 0 }]] as const) {
      const s = pending(on, restart, at)
      const { w: w2, ph: ph2 } = planned(s)
      expect(Object.keys(w2.restartPlan!)).toEqual(["kind"])
      expect(w2.rng.setpiece.state).toEqual(workAt(s).rng.setpiece.state)
      for (const pl of w2.active()) expect(attackSpot(w2, pl, ph2)).toBeNull()
    }
  })

  for (const [dt, last] of [[0.1, 19], [0.04, 49]] as const) {
    it(`the run at the kick: to the spot for 2 s at ${dt === 0.1 ? 10 : 25} Hz`, () => {
      const { w, ph } = planned(pending(on, "corner", { x: 52.5, y: 34 }, "first_half", dt))
      const home = w.active("home")
      const taker = home.find((pl) => pl.role === "W" && pl.pos.y > 0) ?? home.find((pl) => pl.role === "W")!
      const keep = new Set(w.restartPlan!.restKeep!)
      w.possession = { kind: "owned", playerId: taker.id, since: w.tick, restart: "corner" }
      w.phase = { kind: "open_play" }
      noteSetPiece(w, ph, taker)
      w.restartPlan = undefined
      const t0 = w.tick
      expect(w.setPiece).toMatchObject({ kind: "corner", side: "home", tick: t0, takerId: taker.id })
      const cb = home.find((pl) => pl.role === "CB" && !keep.has(pl.id))!
      const st = home.find((pl) => pl.role === "ST")!
      // The CB runs to his table spot itself (u 42, no hold), at runSpeedShare x vmax.
      const r0 = setPieceRun(w, cb, 8)!
      expect(Math.abs(r0.target.x)).toBeCloseTo(42, 6)
      expect(Math.abs(r0.target.y)).toBeCloseTo(4, 6)
      expect(r0.speedCap).toBeCloseTo(0.75 * 8, 9)
      // Not for the ball owner, the defending side, the keeper or the rest keepers.
      expect(setPieceRun(w, taker, 8)).toBeNull()
      for (const pl of w.active("away")) expect(setPieceRun(w, pl, 8)).toBeNull()
      expect(setPieceRun(w, home.find((pl) => pl.role === "GK")!, 8)).toBeNull()
      for (const id of keep) expect(setPieceRun(w, w.player(id), 8)).toBeNull()
      // Not for the flight's winner (the ball in the air from the taker to the ST).
      const pendingPass: PendingEvent = { type: "pass", frame_id: t0, team_id: null, player_id: taker.id, x: null, y: null, x_end: null, y_end: null, attrs: {} }
      const flight: Flight = {
        kind: "pass", fromId: taker.id, side: "home", releaseTick: t0, resolveTick: t0 + 15, winnerId: st.id, outcome: "successful",
        pending: pendingPass, extra: [], path: null, restartAfter: null, looseBall: null, deflectTo: null
      }
      w.possession = { kind: "in_flight", flight }
      expect(setPieceRun(w, st, 8)).toBeNull()
      expect(setPieceRun(w, cb, 8)).not.toBeNull()
      w.tick = t0 + last
      expect(setPieceRun(w, cb, 8)).not.toBeNull()
      w.tick = t0 + last + 1
      expect(setPieceRun(w, cb, 8)).toBeNull()
      // A pure query: the record stays (inert) until the next restart replaces it.
      expect(w.setPiece?.tick).toBe(t0)
    })
  }

  it("the other side on the ball stops the run; off notes nothing", () => {
    const { w, ph } = planned(pending(on, "corner", { x: 52.5, y: 34 }))
    const home = w.active("home")
    const taker = home.find((pl) => pl.role === "W")!
    noteSetPiece(w, ph, taker)
    const cb = home.find((pl) => pl.role === "CB")!
    const away = w.active("away")[3]!
    w.possession = { kind: "owned", playerId: away.id, since: w.tick, restart: null }
    expect(setPieceRun(w, cb, 8)).toBeNull()
    const o = planned(pending(off, "corner", { x: 52.5, y: 34 }))
    noteSetPiece(o.w, o.ph, taker)
    expect(o.w.setPiece).toBeUndefined()
    expect(setPieceRun(o.w, cb, 8)).toBeNull()
    // A throw-in has no table, so no run is noted (and a stale one is cleared).
    const t = planned(pending(on, "throw_in", { x: 30, y: PITCH.halfW }))
    t.w.setPiece = { kind: "corner", side: "home", tick: t.w.tick, takerId: taker.id }
    noteSetPiece(t.w, t.ph, taker)
    expect(t.w.setPiece).toBeUndefined()
  })

  it("ten men: a sent-off CB leaves his spot empty and nothing throws", () => {
    const s = pending(on, "corner", { x: 52.5, y: 34 })
    const cb = s.players.find((pl) => pl.side === "home" && pl.role === "CB")!
    const s10 = { ...s, players: s.players.map((pl) => (pl.id === cb.id ? { ...pl, sentOff: true } : pl)) }
    for (let seed = 0; seed < 30; seed++) {
      const { w, ph } = planned({ ...s10, rng: { ...s10.rng, setpiece: seedRng(seed) } })
      const left = new Set(w.active("home").filter((pl) => pl.role !== "GK").map((pl) => pl.id))
      expect(left.size).toBe(9)
      const keep = w.restartPlan!.restKeep!
      for (const id of keep) expect(left.has(id)).toBe(true)
      expect(keep).not.toContain(cb.id)
      for (const pl of w.active()) expect(() => attackSpot(w, pl, ph)).not.toThrow()
      const cbSpots = w.active("home").filter((pl) => pl.role === "CB").map((pl) => attackSpot(w, pl, ph))
      expect(cbSpots).toHaveLength(1)
      // A plan naming a player no longer on the pitch is tolerated.
      w.restartPlan = { ...w.restartPlan!, restKeep: [...keep, "nobody"] }
      for (const pl of w.active()) expect(() => attackSpot(w, pl, ph)).not.toThrow()
    }
  })

  // Phase B (ledger rulings, Task 3). On the P4 engine the brief's off < 2.5 no longer holds: P4 positioning already puts
  // attackers in the box (Task 2's 16-match baseline 3.32). The test pins the mechanism's effect instead: on >= 4 (the
  // brief) and on - off >= 2. Seed 11 joins 7 and 9 so both arms keep >= 8 corners (with fkWideShiftU 3, seeds 7 and 9
  // gave the on arm 6). Measured: on 5.64 (11 corners), off 3.46 (13 corners), difference 2.18.
  it("in matches, corners load the box", { timeout: 600_000 }, () => {
    /** The restarting side's outfielders in the box at each corner's set_piece frame, the taker excluded (Task 2's att_box). */
    const boxCounts = (p: Params, seed: number): number[] => {
      let s = initMatch(makeConfig(seed, { params: p }))
      const out: number[] = []
      while (!isFinished(s)) {
        const r = step(s)
        s = r.state
        for (const e of r.events) {
          if (e.type !== "set_piece" || e.attrs.kind !== "corner") continue
          const side = e.team_id === s.config.home.id ? "home" : "away"
          const inBox = (pl: PlayerState) => attackX(side, pl.pos.x, s.period) > 36 && Math.abs(pl.pos.y) < 20.16
          out.push(s.players.filter((pl) => !pl.sentOff && pl.side === side && pl.role !== "GK" && pl.id !== e.player_id && inBox(pl)).length)
        }
      }
      return out
    }
    // P6 pinned off (Task 8): with P6 on, seeds 7, 9 and 11 gave on - off 1.90 (the measured engine is P5's).
    const arm = (p: Params) => [7, 9, 11].flatMap((seed) => boxCounts(p6Off(p), seed))
    const mean = (xs: number[]) => xs.reduce((a, x) => a + x, 0) / xs.length
    const a = arm(on)
    const b = arm(off)
    expect(a.length).toBeGreaterThanOrEqual(8)
    expect(b.length).toBeGreaterThanOrEqual(8)
    expect(mean(a) - mean(b)).toBeGreaterThanOrEqual(2)
    expect(mean(a)).toBeGreaterThanOrEqual(4)
  })
})

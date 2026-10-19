import { describe, expect, it } from "vitest"
import { attackX, dist, dirOf, norm, other, sub, add, scale, type Period, type Side, type Vec2 } from "../src/geometry.js"
import { DEFAULT_PARAMS, type Params } from "../src/params.js"
import { Rng, seedRng } from "../src/rng.js"
import { wallSize, wallSpots, zonalSpot } from "../src/setpiece-defend.js"
import { setPieceKind } from "../src/setpiece.js"
import { defendSpot, initMatch, isFinished, planDefend, step, workAt } from "../src/step.js"
import { makeConfig } from "../src/testing.js"
import type { MatchState, PlayerState, RestartKind } from "../src/types.js"

const P = DEFAULT_PARAMS
const off: Params = { ...P, setDefend: { ...P.setDefend, rule: 0 } }
const on: Params = { ...P, setDefend: { ...P.setDefend, rule: 1 } }
const S = on.setDefend

const inBox = (p: Vec2, restarting: Side, period: Period): boolean => attackX(restarting, p.x, period) > 36 && Math.abs(p.y) < 20.16
/** Where a man-marker of `a` stands: 1 m from him toward the defenders' own goal centre. */
const goalSide = (a: Vec2, defSide: Side, period: Period): Vec2 => {
  const goal = { x: -dirOf(defSide, period) * 52.5, y: 0 }
  return add(a, scale(norm(sub(goal, a)), 1))
}
const near = (a: Vec2, b: Vec2, tol = 1e-6): boolean => dist(a, b) <= tol

/**
 * A restart being set up (its resume tick far off) for `side` at `at`, in `period`, with the restarting side's outfielders
 * placed at `attackers`, the next one (the taker) on the ball, the rest at the halfway line, and `sentOff` defenders sent off.
 */
const restartState = (
  p: Params,
  restart: RestartKind,
  side: Side,
  at: Vec2,
  period: Period,
  attackers: ReadonlyArray<Vec2>,
  sentOff = 0,
  seed = 7
): MatchState => {
  const s = initMatch(makeConfig(seed, { params: p }))
  const d = dirOf(side, period)
  let k = 0
  let off = 0
  const players: PlayerState[] = s.players.map((pl) => {
    if (pl.side === side && pl.role !== "GK") {
      // The first outfielder past the list is the taker, on the ball; the rest wait at the halfway line.
      const pos = k < attackers.length ? attackers[k]! : k === attackers.length ? at : { x: 0, y: -30 + 6 * (k - attackers.length) }
      k++
      return { ...pl, pos }
    }
    if (pl.side !== side && pl.role !== "GK" && off < sentOff) {
      off++
      return { ...pl, sentOff: true }
    }
    if (pl.side !== side) return { ...pl, pos: { x: d * 20, y: pl.pos.y } }
    return pl
  })
  return {
    ...s,
    tick: 100,
    periodTick: 100,
    period,
    phase: { kind: "restart", restart, side, at, resumeTick: 100_000 },
    possession: { kind: "dead" },
    players
  }
}

/** The plan planDefend makes for the restart in `s` (setpiece stream), put into the state as startRestart would. */
const withPlan = (s: MatchState): MatchState => {
  if (s.phase.kind !== "restart") throw new Error("not a restart")
  const w = workAt(s)
  const r = { restart: s.phase.restart, side: s.phase.side, at: s.phase.at }
  const kind = setPieceKind(r.restart, r.at, r.side, s.period)
  const part = planDefend(w, r, kind)
  return { ...s, restartPlan: { kind, ...part }, rng: { ...s.rng, setpiece: w.rng.setpiece.state } }
}

const spotsOf = (s: MatchState): Map<string, Vec2 | null> => {
  if (s.phase.kind !== "restart") throw new Error("not a restart")
  const ph = s.phase
  const w = workAt(s)
  return new Map(w.active(other(ph.side)).map((pl) => [pl.id, defendSpot(w, pl, ph)]))
}

describe("S3: walls", () => {
  it("a central wall: 3 or 4 at 9.15 m on the near-post line, never closer than 8.65 m", () => {
    const rng = new Rng(seedRng(1))
    const sizes = Array.from({ length: 2000 }, () => wallSize("fk_central", S, rng))
    expect(sizes.every((n) => n === 3 || n === 4)).toBe(true)
    const three = sizes.filter((n) => n === 3).length / sizes.length
    expect(three).toBeGreaterThanOrEqual(0.47)
    expect(three).toBeLessThanOrEqual(0.53)
    // Home attacking +x in the first half; the away side defends the +x goal, near post at y +3.66.
    const ball = { x: 25, y: 5 }
    const shade = { x: 52.5, y: 3.66 - 1 }
    const dir = norm(sub(shade, ball))
    for (const n of [3, 4]) {
      for (let trial = 0; trial < 50; trial++) {
        const jitter = Array.from({ length: n }, () => rng.range(-S.jitterM, 0))
        const spots = wallSpots(ball, "away", "first_half", n, jitter, S)
        expect(spots).toHaveLength(n)
        for (const sp of spots) {
          expect(dist(sp, ball)).toBeGreaterThanOrEqual(8.65 - 1e-9)
          expect(dist(sp, ball)).toBeLessThanOrEqual(9.15 + 1e-9)
          // In front of the ball, toward goal.
          expect((sp.x - ball.x) * dir.x + (sp.y - ball.y) * dir.y).toBeGreaterThan(8)
        }
        const mean = { x: spots.reduce((a, p) => a + p.x, 0) / n, y: spots.reduce((a, p) => a + p.y, 0) / n }
        const off = Math.abs((mean.x - ball.x) * dir.y - (mean.y - ball.y) * dir.x)
        expect(off).toBeLessThanOrEqual(0.3)
      }
      // The 0.6 m spacing, with no jitter (F21: the wall lies on the 9.15 m arc, 0.6 m chords).
      const flat = wallSpots(ball, "away", "first_half", n, Array(n).fill(0), S)
      for (let i = 1; i < n; i++) expect(dist(flat[i]!, flat[i - 1]!)).toBeCloseTo(0.6, 9)
      for (const sp of flat) expect(dist(sp, ball)).toBeCloseTo(9.15, 9)
    }
    // Second half: home attacks -x, the away side defends the -x goal; only x mirrors.
    const mirrored = wallSpots({ x: -25, y: 5 }, "away", "second_half", 4, [0, 0, 0, 0], S)
    const first = wallSpots(ball, "away", "first_half", 4, [0, 0, 0, 0], S)
    for (const sp of mirrored) expect(first.some((f) => near(f, { x: -sp.x, y: sp.y }, 1e-9))).toBe(true)
  })

  it("a wide wall 76 % of the time, 1 or 2 players", () => {
    const rng = new Rng(seedRng(2))
    const sizes = Array.from({ length: 4000 }, () => wallSize("fk_wide", S, rng))
    const none = sizes.filter((n) => n === 0).length / sizes.length
    expect(none).toBeGreaterThanOrEqual(0.22)
    expect(none).toBeLessThanOrEqual(0.26)
    expect(sizes.every((n) => n === 0 || n === 1 || n === 2)).toBe(true)
    expect(sizes.filter((n) => n === 1).length).toBeGreaterThan(1000)
    expect(sizes.filter((n) => n === 2).length).toBeGreaterThan(1000)
    // Every other kind has no wall and makes no draw.
    const before = rng.state
    for (const k of ["corner", "fk_other", "throw_att", "goal_kick", "penalty"] as const) expect(wallSize(k, S, rng)).toBe(0)
    expect(rng.state).toEqual(before)
  })

  it("walls at the edges stay on the pitch", () => {
    for (const ball of [
      { x: 49, y: 22 },
      { x: 51.5, y: 22 },
      { x: 49, y: -22 }
    ])
      for (const n of [1, 2, 3, 4]) {
        const spots = wallSpots(ball, "away", "first_half", n, Array(n).fill(-0.5), S)
        for (const sp of spots) {
          expect(sp.x).toBeLessThanOrEqual(52.5 - 0.5)
          expect(Math.abs(sp.y)).toBeLessThanOrEqual(33.5)
        }
      }
    // The mirror: never behind the -x goal line in the second half.
    for (const sp of wallSpots({ x: -51.5, y: 22 }, "away", "second_half", 4, [0, 0, 0, 0], S)) expect(sp.x).toBeGreaterThanOrEqual(-52)
  })

  it("wall members: the defending outfielders other than CBs nearest the wall point, each jittered toward the ball", () => {
    const s = withPlan(restartState(on, "free_kick", "home", { x: 25, y: 5 }, "first_half", []))
    const plan = s.restartPlan!
    expect(plan.wall!.length === 3 || plan.wall!.length === 4).toBe(true)
    const byId = new Map(s.players.map((pl) => [pl.id, pl]))
    for (const id of plan.wall!) {
      expect(byId.get(id)!.side).toBe("away")
      expect(["CB", "GK"]).not.toContain(byId.get(id)!.role)
      expect(plan.jitter![id]).toBeGreaterThanOrEqual(-S.jitterM)
      expect(plan.jitter![id]).toBeLessThanOrEqual(0)
    }
    const ball = { x: 25, y: 5 }
    const point = add(ball, scale(norm(sub({ x: 52.5, y: 2.66 }, ball)), S.wallM))
    const rest = s.players.filter((pl) => pl.side === "away" && !["CB", "GK"].includes(pl.role) && !plan.wall!.includes(pl.id))
    const far = Math.max(...plan.wall!.map((id) => dist(byId.get(id)!.pos, point)))
    for (const pl of rest) expect(dist(pl.pos, point)).toBeGreaterThanOrEqual(far)
    const spots = spotsOf(s)
    for (const id of plan.wall!) {
      const d = dist(spots.get(id)!, ball)
      expect(d).toBeCloseTo(S.wallM + plan.jitter![id]!, 9)
    }
  })

  it("off: no plan, no draw, no spot", () => {
    const s = restartState(off, "free_kick", "home", { x: 25, y: 5 }, "first_half", [])
    const w = workAt(s)
    const before = w.rng.setpiece.state
    expect(planDefend(w, { restart: "free_kick", side: "home", at: { x: 25, y: 5 } }, "fk_central")).toEqual({})
    expect(w.rng.setpiece.state).toEqual(before)
    for (const v of spotsOf(s).values()) expect(v).toBeNull()
    const c = restartState(off, "corner", "home", { x: 52.5, y: 34 }, "first_half", [{ x: 42, y: 4 }])
    for (const v of spotsOf(c).values()) expect(v).toBeNull()
  })
})

describe("S2: corners and wide free kicks", () => {
  const six = [
    { x: 42, y: 4 },
    { x: 42, y: -4 },
    { x: 43, y: 0 },
    { x: 39, y: 10 },
    { x: 37, y: -11 },
    { x: 44, y: 14 }
  ]
  for (const period of ["first_half", "second_half"] as const)
    it(`corners: nine in the box, man-marking within 12 m, the rest zonal, nobody up (${period})`, () => {
      const d = dirOf("home", period)
      const atk = six.map((p) => ({ x: d * p.x, y: p.y }))
      const s = withPlan(restartState(on, "corner", "home", { x: d * 52.5, y: 34 }, period, atk))
      const spots = spotsOf(s)
      const defs = s.players.filter((pl) => pl.side === "away" && pl.role !== "GK")
      expect(defs).toHaveLength(10)
      const pts = defs.map((pl) => spots.get(pl.id)!)
      for (const p of pts) expect(p).not.toBeNull()
      // F19: nine in the box, the tenth at the box edge (u 32, y 0 in the restarting frame) for second balls.
      expect(pts.filter((p) => inBox(p, "home", period)).length).toBe(9)
      expect(pts.some((p) => near(p, { x: d * 32, y: 0 }))).toBe(true)
      for (const p of pts) expect(attackX("home", p.x, period)).toBeGreaterThanOrEqual(17.5)
      // Every attacker in the box has a marker 1 m goal-side of him.
      for (const a of atk) expect(pts.filter((p) => near(p, goalSide(a, "away", period))).length).toBe(1)
      // F20: zonal spots in the restarting team's frame, pitch y; the first one is (47, -5.5), then 0, then +5.5.
      expect(zonalSpot(0, "away", period, S)).toEqual({ x: d * 47, y: -5.5 })
      for (let i = 0; i < 3; i++) expect(pts.some((p) => near(p, zonalSpot(i, "away", period, S)))).toBe(true)
      // The keeper on his line.
      const gk = s.players.find((pl) => pl.side === "away" && pl.role === "GK")!
      expect(spots.get(gk.id)).toEqual({ x: d * 51, y: 0 })
    })

  it("more attackers than defenders: the extras go unmarked, no throw", () => {
    const eight = [...six, { x: 46, y: -8 }, { x: 40, y: 2 }]
    const s = withPlan(restartState(on, "corner", "home", { x: 52.5, y: -34 }, "first_half", eight, 3))
    const spots = spotsOf(s)
    const defs = s.players.filter((pl) => pl.side === "away" && pl.role !== "GK" && !pl.sentOff)
    expect(defs).toHaveLength(7)
    const pts = defs.map((pl) => spots.get(pl.id)!)
    for (const p of pts) expect(p).not.toBeNull()
    for (const p of pts) expect(inBox(p, "home", "first_half")).toBe(true)
    const marked = eight.filter((a) => pts.some((p) => near(p, goalSide(a, "away", "first_half"))))
    expect(marked).toHaveLength(7)
  })

  it("every defender in the layout stands at least 9.15 m from the ball", () => {
    for (const at of [
      { x: 30, y: 25 },
      { x: 40, y: -24 },
      { x: 52.5, y: 34 }
    ]) {
      const restart = at.x === 52.5 ? "corner" : "free_kick"
      const atk = [
        { x: 38, y: 15 },
        { x: 40, y: -14 },
        { x: 44, y: 3 },
        { x: 47, y: 18 }
      ]
      const s = withPlan(restartState(on, restart, "home", at, "first_half", atk))
      const plan = s.restartPlan
      for (const [id, p] of spotsOf(s)) {
        if (p === null || plan?.wall?.includes(id)) continue
        expect(dist(p, at)).toBeGreaterThanOrEqual(9.15)
      }
    }
  })

  it("a wide free kick: the wall, one striker up 24 % of the time, everyone else in the box layout", () => {
    let outlets = 0
    const n = 400
    for (let seed = 0; seed < n; seed++) {
      const s = withPlan(restartState(on, "free_kick", "home", { x: 30, y: 25 }, "first_half", [{ x: 42, y: 4 }], 0, seed))
      const plan = s.restartPlan!
      if (plan.outlet !== undefined) {
        outlets++
        expect(s.players.find((pl) => pl.id === plan.outlet)!.role).toBe("ST")
        expect(plan.wall ?? []).not.toContain(plan.outlet)
      }
      const spots = spotsOf(s)
      for (const pl of s.players.filter((x) => x.side === "away" && x.role !== "GK")) {
        if (pl.id === plan.outlet) expect(spots.get(pl.id)).toBeNull()
        else expect(spots.get(pl.id)).not.toBeNull()
      }
    }
    expect(outlets / n).toBeGreaterThan(0.17)
    expect(outlets / n).toBeLessThan(0.31)
  })

  it("a wall member sent off or substituted while the ball is dead keeps the wall valid", () => {
    for (const at of [
      { x: 25, y: 5 },
      { x: 30, y: 25 }
    ]) {
      let seed = 0
      let s = withPlan(restartState(on, "free_kick", "home", at, "first_half", [{ x: 42, y: 4 }], 0, seed))
      while ((s.restartPlan?.wall?.length ?? 0) < 2) s = withPlan(restartState(on, "free_kick", "home", at, "first_half", [{ x: 42, y: 4 }], 0, ++seed))
      const wall = s.restartPlan!.wall!
      const [gone, ...kept] = wall
      const sentOff: MatchState = { ...s, players: s.players.map((pl) => (pl.id === gone ? { ...pl, sentOff: true } : pl)) }
      const subbed: MatchState = { ...s, players: s.players.map((pl) => (pl.id === gone ? { ...pl, id: "away-fc-sub" } : pl)) }
      for (const t of [sentOff, subbed]) {
        const spots = spotsOf(t)
        expect(spots.has(gone!)).toBe(false)
        for (const id of kept) {
          const p = spots.get(id)!
          expect(p).not.toBeNull()
          expect(dist(p, at)).toBeGreaterThanOrEqual(8.65 - 1e-9)
          expect(dist(p, at)).toBeLessThanOrEqual(9.15 + 1e-9)
        }
        // At a wide free kick every defending outfielder but the outlet has a spot (the box layout or the wall).
        const wide = setPieceKind("free_kick", at, "home", "first_half") === "fk_wide"
        for (const pl of t.players.filter((x) => x.side === "away" && !x.sentOff && x.role !== "GK"))
          if (wide && pl.id !== t.restartPlan!.outlet) expect(spots.get(pl.id)).not.toBeNull()
        if (t === subbed) {
          const v = spots.get("away-fc-sub")
          if (wide) expect(v).not.toBeNull()
          if (v) expect(dist(v, at)).toBeGreaterThanOrEqual(9.15)
        }
      }
    }
  })
})

/** Every central attacking free kick's frame at the kick: the ball and the defending outfielders' positions. */
const centralKicks = (p: Params, seed: number): Array<{ ball: Vec2; goal: Vec2; defs: Vec2[] }> => {
  let s = initMatch(makeConfig(seed, { params: p }))
  const out: Array<{ ball: Vec2; goal: Vec2; defs: Vec2[] }> = []
  while (!isFinished(s)) {
    const prev = s
    const r = step(s)
    s = r.state
    const ph = prev.phase
    if (ph.kind !== "restart" || ph.restart !== "free_kick" || s.phase.kind !== "open_play") continue
    if (setPieceKind(ph.restart, ph.at, ph.side, prev.period) !== "fk_central") continue
    const goal = { x: 52.5 * dirOf(ph.side, prev.period), y: 0 }
    out.push({ ball: ph.at, goal, defs: prev.players.filter((pl) => pl.side !== ph.side && pl.role !== "GK" && !pl.sentOff).map((pl) => pl.pos) })
  }
  return out
}
const wallCount = (k: { ball: Vec2; goal: Vec2; defs: Vec2[] }): number => {
  const g = norm(sub(k.goal, k.ball))
  return k.defs.filter((d) => {
    const r = dist(d, k.ball)
    if (r < 8 || r > 10) return false
    const c = ((d.x - k.ball.x) * g.x + (d.y - k.ball.y) * g.y) / r
    return c >= Math.cos((25 * Math.PI) / 180)
  }).length
}

describe("S3: in matches", () => {
  it("in matches, central free kicks always have a wall", { timeout: 600_000 }, () => {
    const seeds = [7, 9, 11, 13, 15, 17]
    const onKicks: Array<{ ball: Vec2; goal: Vec2; defs: Vec2[] }> = []
    const offKicks: Array<{ ball: Vec2; goal: Vec2; defs: Vec2[] }> = []
    // F30: seeds are added (in order) until there are at least 3 central attacking free kicks under `on`.
    for (const seed of seeds) {
      onKicks.push(...centralKicks(on, seed))
      offKicks.push(...centralKicks(off, seed))
      if (onKicks.length >= 3 && seed >= 11) break
    }
    expect(onKicks.length).toBeGreaterThanOrEqual(3)
    for (const k of onKicks) expect(wallCount(k)).toBeGreaterThanOrEqual(2)
    expect(offKicks.length).toBeGreaterThan(0)
    expect(offKicks.filter((k) => wallCount(k) >= 2).length / offKicks.length).toBeLessThan(0.5)
  })
})

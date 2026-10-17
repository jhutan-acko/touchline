import { describe, expect, it } from "vitest"
import { attackX, dist, other, PITCH, type Side } from "../src/geometry.js"
import { DEFAULT_PARAMS as P, type Params } from "../src/params.js"
import { lagBall } from "../src/anchor.js"
import { initMatch, isFinished, shapeTargetAt, step } from "../src/step.js"
import { makeConfig } from "../src/testing.js"
import type { MatchState } from "../src/types.js"

const on: Params = { ...P, positioning: { ...P.positioning, rule: 1 }, movement: { ...P.movement, relaxed: 1 } }

const finalState = (params: Params, seed: number): MatchState => {
  let s = initMatch(makeConfig(seed, { params }))
  while (!isFinished(s)) s = step(s).state
  return s
}

const measure = (params: Params, seed: number) => {
  const cfg = makeConfig(seed, { params })
  const outfield = new Set([cfg.home, cfg.away].flatMap((t) => [...t.starters, ...(t.bench ?? [])]).filter((p) => p.role !== "GK").map((p) => p.id))
  const relIn: number[] = []
  const relOut: number[] = []
  const deepWhileKeeper: number[] = []
  const keeperOffLine: number[] = []
  const cbSecondHalf: number[] = []
  let s = initMatch(cfg)
  while (!isFinished(s)) {
    s = step(s).state
    if (s.phase.kind !== "open_play") continue
    const pos = s.possession
    const owner = pos.kind === "owned" ? s.players.find((p) => p.id === pos.playerId)! : null
    const possSide: Side | null = owner ? owner.side : pos.kind === "in_flight" ? pos.flight.side : null
    if (possSide === null) continue
    const ball = s.ball.pos
    for (const side of ["home", "away"] as const) {
      const mine = s.players.filter((p) => p.side === side && !p.sentOff && outfield.has(p.id))
      const cx = mine.reduce((a, p) => a + attackX(side, p.pos.x, s.period), 0) / mine.length
      ;(side === possSide ? relIn : relOut).push(cx - attackX(side, ball.x, s.period))
      if (s.period === "second_half") for (const p of mine) if (p.role === "CB") cbSecondHalf.push(attackX(side, p.pos.x, s.period))
    }
    // Late in the keeper's hold (4 s on), when the build-up shape has formed; the real snapshot is 0.2 s before release.
    if (owner && owner.role === "GK" && pos.kind === "owned" && s.tick - pos.since > 40)
      deepWhileKeeper.push(s.players.filter((p) => p.side === owner.side && !p.sentOff && outfield.has(p.id) && attackX(owner.side, p.pos.x, s.period) < -17.5).length)
    if (owner && owner.role !== "GK") {
      const def = other(owner.side)
      const fromGoal = Math.hypot(attackX(def, ball.x, s.period) + PITCH.halfL, ball.y)
      const gk = s.players.find((p) => p.side === def && p.role === "GK" && !p.sentOff)
      if (gk && fromGoal >= 13 && fromGoal <= 25 && dist(owner.pos, gk.pos) > 6) keeperOffLine.push(attackX(def, gk.pos.x, s.period) + PITCH.halfL)
    }
  }
  return { relIn, relOut, deepWhileKeeper, keeperOffLine, cbSecondHalf }
}
const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length
const median = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)]!

describe("positioning in a match (rule table on)", () => {
  it("Task 7b: the keeper reads the current ball, the ring holds the restart spot, a deflection keeps the rows", () => {
    let s = initMatch(makeConfig(11, { params: on }))
    let keeperChecks = 0
    let held = 0
    let deflections = 0
    let secondHalfChecked = false
    let prevRows: string | null = null
    let prevRestart = false
    while (!isFinished(s)) {
      s = step(s).state
      const a = s.anchor
      if (!a) continue
      const rows = `${a.teams.home.row}/${a.teams.away.row}`
      const ph = s.phase
      // A restart is set at the end of the tick its ball goes dead (after positioning ran): check from its next tick on.
      const wasRestart = prevRestart
      prevRestart = ph.kind === "restart"
      if (ph.kind === "restart") {
        if (wasRestart) {
          held++
          for (const b of a.ballLag) expect(b).toEqual(ph.at)
        }
      } else if (ph.kind === "open_play") {
        if (s.period === "second_half" && !secondHalfChecked) {
          secondHalfChecked = true
          expect(lagBall(a)).toEqual({ x: 0, y: 0 }) // the kickoff spot, not a first-half ball
        }
        const pos = s.possession
        if (pos.kind === "in_flight" && pos.flight.kind === "deflection" && prevRows !== null) {
          deflections++
          expect(rows).toBe(prevRows)
        }
        // Ball within keeperNearInM of a goal now: that keeper stands keeperLineM off his line, whatever the ball 2 s ago.
        if (s.tick % 5 === 0)
          for (const side of ["home", "away"] as const) {
            const fromGoal = Math.hypot(attackX(side, s.ball.pos.x, s.period) + PITCH.halfL, s.ball.pos.y)
            const gk = s.players.find((p) => p.side === side && p.role === "GK" && !p.sentOff)
            if (!gk || fromGoal > on.positioning.keeperNearInM - 0.5) continue
            keeperChecks++
            expect(attackX(side, shapeTargetAt(s, gk.id).x, s.period) + PITCH.halfL).toBeCloseTo(on.positioning.keeperLineM, 9)
          }
      }
      prevRows = rows
    }
    expect(secondHalfChecked).toBe(true)
    expect(held).toBeGreaterThan(100)
    expect(keeperChecks).toBeGreaterThan(100)
    expect(deflections).toBeGreaterThan(10)
  }, 300_000)

  it("is deterministic, and keeps no positioning state with the rule off", () => {
    const a = finalState(on, 9)
    const b = finalState(on, 9)
    expect(a.score).toEqual(b.score)
    expect(a.eventSeq).toBe(b.eventSeq)
    expect(a.anchor).toEqual(b.anchor)
    expect(a.anchor).toBeDefined()
    expect(finalState({ ...P, positioning: { ...P.positioning, rule: 0 } }, 9).anchor).toBeUndefined()
  }, 300_000)

  // These real-target tests measure on DEFAULT_PARAMS (team drift SD 9), not on the shipped touchline-params.json
  // (team drift scaled to 0.25, SD 2.25).
  // Real-data targets (the plan's bounds, restored by the Task 8 ruling) on DEFAULT_PARAMS, seed 7. Those that hold are
  // plain tests; those not met yet are it.fails below, unwidened: each flips (and fails the suite) once it is met, and
  // then moves back to a plain test. Measured once and shared.
  let m7: ReturnType<typeof measure> | undefined
  const seven = () => (m7 ??= measure(on, 7))

  it("keeps the block well behind the ball without it, keepers near their line, and switches ends", () => {
    const m = seven()
    expect(mean(m.relIn)).toBeLessThan(10)
    expect(mean(m.relOut)).toBeLessThan(-4) // real -9.5 m
    expect(m.deepWhileKeeper.length).toBeGreaterThan(20)
    expect(m.keeperOffLine.length).toBeGreaterThan(50)
    expect(median(m.keeperOffLine)).toBeGreaterThan(1.2) // real 2.2 m; the old template 4.0 m
    expect(median(m.keeperOffLine)).toBeLessThan(3.5)
    expect(mean(m.cbSecondHalf)).toBeLessThan(-5)
  }, 300_000)

  // MET since P3 Task 10 (all P3 on, seed 7: relIn +0.09, deep while the keeper holds median 6). Both were it.fails after
  // Task 8b (relIn -3.6, deep 7): D1's pass choice keeps the ball deeper while a team has it, so the in-possession
  // centroid is no longer held behind it and fewer players stay deep. The deep count sits on its bound.
  it("puts the block ahead of the ball with it (relIn > -3; real +3.9 m)", () => {
    expect(mean(seven().relIn)).toBeGreaterThan(-3)
  }, 300_000)

  it("builds up with few players deep while the keeper holds (median <= 6; real 3)", () => {
    expect(median(seven().deepWhileKeeper)).toBeLessThanOrEqual(6)
  }, 300_000)

  it("Task 8b: the drift runs at deadRate while a restart is set up (0 freezes it), and a back line without the ball holds a flatter line", () => {
    const frozen: Params = { ...on, positioning: { ...on.positioning, drift: { ...on.positioning.drift, deadRate: 0 } } }
    let s = initMatch(makeConfig(5, { params: frozen }))
    let checked = 0
    let prev: MatchState | null = null
    while (!isFinished(s) && checked < 400) {
      const before = s
      s = step(s).state
      // A tick that starts and ends in the same restart set-up advanced the drift by 0 s.
      if (prev && before.phase.kind === "restart" && s.phase.kind === "restart" && before.anchor && s.anchor) {
        expect(s.anchor.teams.home.drift).toEqual(before.anchor.teams.home.drift)
        expect(s.anchor.teams.away.drift).toEqual(before.anchor.teams.away.drift)
        for (const [id, d] of Object.entries(before.anchor.players)) expect(s.anchor.players[id]!.slow).toEqual(d.slow)
        checked++
      }
      prev = before
    }
    expect(checked).toBe(400)
    // Back-line depth spread (SD of CB and FB u) without the ball: smaller with backLineOutU 0 than 1.
    const spread = (backLineOutU: number) => {
      const p: Params = { ...on, positioning: { ...on.positioning, drift: { ...on.positioning.drift, backLineOutU } } }
      const cfg = makeConfig(7, { params: p })
      let st = initMatch(cfg)
      const sds: number[] = []
      while (!isFinished(st)) {
        st = step(st).state
        if (st.phase.kind !== "open_play" || st.tick % 10 !== 0) continue
        const pos = st.possession
        const possSide: Side | null = pos.kind === "owned" ? st.players.find((q) => q.id === pos.playerId)!.side : pos.kind === "in_flight" ? pos.flight.side : null
        if (possSide === null) continue
        const def = other(possSide)
        const us = st.players.filter((q) => q.side === def && !q.sentOff && (q.role === "CB" || q.role === "FB")).map((q) => attackX(def, q.pos.x, st.period))
        const mu = mean(us)
        sds.push(Math.sqrt(us.reduce((a, u) => a + (u - mu) ** 2, 0) / us.length))
      }
      return mean(sds)
    }
    expect(spread(0)).toBeLessThan(spread(1) - 0.3)
  }, 300_000)
})

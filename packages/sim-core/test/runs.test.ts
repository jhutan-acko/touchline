import { describe, expect, it } from "vitest"
import { lastDefenderAttackX } from "../src/decide.js"
import { clampToPitch, dirOf } from "../src/geometry.js"
import { DEFAULT_PARAMS, type Params } from "../src/params.js"
import { buildCandidates } from "../src/decide.js"
import { tiringFactor, vmaxFor } from "../src/kinematics.js"
import { hazard, Rng } from "../src/rng.js"
import { holdLineTarget, overlapEligible, overlapTarget } from "../src/runs.js"
import { initMatch, isFinished, runMove, step, workAt, type Work } from "../src/step.js"
import { makeConfig, makeTeam, STYLES } from "../src/testing.js"
import type { DomainEvent, FormationName, MatchState, PlayerState, Role } from "../src/types.js"
import type { Vec2 } from "../src/geometry.js"

const P = DEFAULT_PARAMS
const R = P.roleMoves.run
const O = P.roleMoves.overlap
const off: Params = { ...P, roleMoves: { ...P.roleMoves, runRule: 0 } }
const on: Params = { ...P, roleMoves: { ...P.roleMoves, runRule: 1 } }
/** Rule on with run starts forced (hazard 1 whenever a run may start) and overlaps off, or overlaps forced. */
const forcedRuns = (p: Params): Params => ({ ...p, runs: { ...p.runs, runInBehindRatePerS: 1e4 }, roleMoves: { ...p.roleMoves, overlap: { ...p.roleMoves.overlap, ratePerS: 0 } } })
const forcedOverlaps = (p: Params): Params => ({ ...p, runs: { ...p.runs, runInBehindRatePerS: 0 }, roleMoves: { ...p.roleMoves, overlap: { ...p.roleMoves.overlap, ratePerS: 1e4 } } })

const player = (id: string, role: Role, x: number, y: number, side: "home" | "away" = "home"): PlayerState => ({
  id, side, role, slot: 0, jersey: 1, attrs: {} as PlayerState["attrs"], foot: "right", pos: { x, y }, vel: { x: 0, y: 0 },
  intent: { kind: "shape" }, intentUntil: 0, energy: 1, yellow: 0, sentOff: false
})

interface Spot { readonly role: Role; readonly at: Vec2; readonly vel?: Vec2; readonly nth?: number }

/**
 * A work copy in the first half at tick 100: the home `carrier` and `runner` placed (nth = which of that role), the away
 * outfielders' last defender at u `lineU` (home attacks +x, so u = x), everyone else at u lineU - 6.
 */
const fixture = (params: Params, seed: number, carrier: Spot, runner: Spot, lineU: number, formation: FormationName = "4-3-3", dt = 0.1) => {
  const cfg = makeConfig(seed, { params, dt, home: makeTeam("home-fc", formation, STYLES.possession, 11) })
  const s0 = initMatch(cfg)
  const pick = (sp: Spot) => s0.players.filter((p) => p.side === "home" && p.role === sp.role)[sp.nth ?? 0]!
  const c = pick(carrier)
  const r = pick(runner)
  let first = true
  const players = s0.players.map((p): PlayerState => {
    if (p.id === c.id) return { ...p, pos: carrier.at, vel: carrier.vel ?? { x: 0, y: 0 } }
    if (p.id === r.id) return { ...p, pos: runner.at, vel: runner.vel ?? { x: 0, y: 0 } }
    if (p.side === "away" && p.role !== "GK") {
      const x = first ? lineU : lineU - 6
      first = false
      return { ...p, pos: { x, y: p.pos.y } }
    }
    return p
  })
  const s: MatchState = { ...s0, tick: 100, periodTick: 100, players, possession: { kind: "owned", playerId: c.id } as MatchState["possession"] }
  const w = workAt(s)
  return { w, carrierId: c.id, runnerId: r.id }
}

/** One runMove call for the fixture's runner, a fresh intent each time; returns whether a run or overlap started. */
const tryStart = (w: Work, carrierId: string, runnerId: string): boolean => {
  const before = w.events.length
  runMove(w, w.player(runnerId), w.player(carrierId))
  return w.events.length > before
}

const lastRun = (w: Work): DomainEvent => w.events.filter((e) => e.type === "off_ball_run").at(-1)!

describe("runs.ts (A6): pure geometry", () => {
  it("runners hold one metre onside (pure target)", () => {
    expect(holdLineTarget(20, 5, false, "home", "first_half", R)).toEqual({ x: 19, y: 5 })
    const wide = holdLineTarget(20, 5, true, "home", "first_half", R)
    expect(wide.x).toBe(19)
    expect(wide.y).toBeGreaterThanOrEqual(14)
    expect(holdLineTarget(20, -5, true, "home", "first_half", R).y).toBeLessThanOrEqual(-14)
    expect(holdLineTarget(20, 25, true, "home", "first_half", R).y).toBe(25)
    expect(holdLineTarget(20, 5, false, "home", "second_half", R)).toEqual({ x: -19, y: 5 })
    expect(holdLineTarget(24, 5, false, "away", "first_half", R)).toEqual({ x: -23, y: 5 })
  })

  it("an overlap goes outside and beyond the carrier (pure target and eligibility)", () => {
    const w = player("w", "W", 10, 25)
    const fb = player("fb", "FB", 2, 22)
    expect(overlapEligible(fb, w, "first_half", O)).toBe(true)
    expect(overlapTarget(w.pos, "home", "first_half", O)).toEqual({ x: 16, y: 28 })
    // kept 1.5 m inside the touchline; mirrored after half-time
    expect(overlapTarget({ x: 10, y: -31 }, "home", "first_half", O)).toEqual({ x: 16, y: -32.5 })
    expect(overlapTarget({ x: -10, y: 25 }, "home", "second_half", O)).toEqual({ x: -16, y: 28 })
    // 20 m behind, or the carrier in his own third: not eligible
    expect(overlapEligible(player("fb", "FB", -10, 22), w, "first_half", O)).toBe(false)
    expect(overlapEligible(fb, player("w", "W", -20, 25), "first_half", O)).toBe(false)
    // other side of the pitch, carrier not in the wide lane, carrier an ST, the FB ahead, an opponent carrier: not eligible
    expect(overlapEligible(player("fb", "FB", 2, -22), w, "first_half", O)).toBe(false)
    expect(overlapEligible(fb, player("w", "W", 10, 9), "first_half", O)).toBe(false)
    expect(overlapEligible(fb, player("s", "ST", 10, 25), "first_half", O)).toBe(false)
    expect(overlapEligible(player("fb", "FB", 12, 22), w, "first_half", O)).toBe(false)
    expect(overlapEligible(fb, player("w", "W", 10, 25, "away"), "first_half", O)).toBe(false)
    // a same-side CM in the wide lane qualifies
    expect(overlapEligible(fb, player("c", "CM", 10, 16), "first_half", O)).toBe(true)
  })
})

describe("A6 role-run seam (runMove)", () => {
  const CM_FWD: Spot = { role: "CM", at: { x: 0, y: 5 }, vel: { x: 2, y: 0 } }
  const ST: Spot = { role: "ST", at: { x: 15, y: 5 } }
  const W: Spot = { role: "W", at: { x: 15, y: 20 } }

  it("runners hold one metre onside and re-aim as the line moves", () => {
    for (const dt of [0.1, 0.04]) {
      const p = forcedRuns(on)
      const { w, carrierId, runnerId } = fixture(p, 3, CM_FWD, ST, 20, "4-3-3", dt)
      expect(w.dt).toBe(dt)
      const mt = runMove(w, w.player(runnerId), w.player(carrierId))!
      expect(mt).not.toBeNull()
      expect(mt.target.x).toBeCloseTo(19, 9)
      const runner = w.player(runnerId)
      expect(runner.intent.kind).toBe("run_in_behind")
      expect("overlap" in runner.intent).toBe(false)
      // the intent's target is the break point 6 m behind the line (through balls lead toward it)
      expect((runner.intent as { target: Vec2 }).target.x).toBeCloseTo(26, 9)
      // the last defender steps back from u 20 to 24, one metre a tick: the hold spot follows (x 19 -> 23)
      const lastDefId = w.active("away").filter((x) => x.role !== "GK").find((x) => x.pos.x === 20)!.id
      const xs: number[] = []
      for (let u = 21; u <= 24; u++) {
        w.tick += 1
        w.setPlayer({ ...w.player(lastDefId), pos: { x: u, y: w.player(lastDefId).pos.y } })
        expect(lastDefenderAttackX("home", "first_half", w.active("away"))).toBe(u)
        const m = runMove(w, w.player(runnerId), w.player(carrierId))!
        xs.push(m.target.x)
        // the stored break point is re-aimed too (through balls read it)
        const it = w.player(runnerId).intent
        expect(it.kind === "run_in_behind" && it.target.x).toBeCloseTo(u + 6, 9)
      }
      expect(xs.map((x) => Math.round(x * 1e6) / 1e6)).toEqual([20, 21, 22, 23])
      expect(lastRun(w).attrs.kind).toBe("in_behind")
    }
  })

  it("a runner holds at the line until a pass travels to him, then breaks to the target", () => {
    const { w, carrierId, runnerId } = fixture(forcedRuns(on), 3, CM_FWD, ST, 20)
    const vmax = vmaxFor(w.player(runnerId), w.player(runnerId).energy, w.p)
    expect(runMove(w, w.player(runnerId), w.player(carrierId))!.target.x).toBeCloseTo(19, 9)
    w.tick += 1
    // before the pass: his goal is lastDef - 1 while the intent's target is behind the line
    const hold = runMove(w, w.player(runnerId), w.player(carrierId))!
    expect(hold.target.x).toBeCloseTo(19, 9)
    const it0 = w.player(runnerId).intent as { target: Vec2 }
    expect(it0.target.x).toBeGreaterThan(20)
    // a pass released toward him (he wins it, or it was meant for him): he goes to the intent's target at full speed
    const flight = (winnerId: string | null, intended: string | null) =>
      ({ kind: "in_flight", flight: { kind: "pass", fromId: carrierId, side: "home", releaseTick: w.tick, resolveTick: w.tick + 10, winnerId, pending: { attrs: { intended_receiver_id: intended } } } }) as unknown as Work["possession"]
    for (const [winner, intended] of [[runnerId, runnerId], [null, runnerId], [runnerId, null]] as const) {
      w.possession = flight(winner, intended)
      w.tick += 1
      const brk = runMove(w, w.player(runnerId), w.player(carrierId))!
      expect(brk.target).toEqual((w.player(runnerId).intent as { target: Vec2 }).target)
      expect(brk.target.x).toBeCloseTo(26, 9)
      expect(brk.speedCap).toBe(vmax)
    }
    // a pass to someone else: he keeps holding
    w.possession = flight(carrierId, carrierId)
    w.tick += 1
    expect(runMove(w, w.player(runnerId), w.player(carrierId))!.target.x).toBeCloseTo(19, 9)
  })

  it("a through ball to a holding runner leads beyond the line", () => {
    const { w, carrierId, runnerId } = fixture(forcedRuns(on), 3, CM_FWD, ST, 20)
    runMove(w, w.player(runnerId), w.player(carrierId))
    // he has arrived at his hold spot, lastDef - 1
    w.setPlayer({ ...w.player(runnerId), pos: { x: 19, y: 5 }, vel: { x: 0, y: 0 } })
    expect(w.p.through.rule).toBe(1)
    const owner = w.player(carrierId)
    const cands = buildCandidates(
      { period: "first_half", owner, teammates: w.active("home"), opponents: w.active("away"), style: STYLES.possession, scoreDiff: 0, minute: 30, restart: null, scriptBias: {}, tick: w.tick },
      w.p,
      0
    )
    const thr = cands.filter((c) => c.receiverId === runnerId && (c.kind === "through" || c.kind === "lofted_through"))
    expect(thr.length).toBeGreaterThan(0)
    for (const c of thr) expect(c.target.x).toBeGreaterThan(20)
  })

  it("a live rotation is never overwritten by a new run or overlap", () => {
    const both: Params = { ...on, runs: { ...on.runs, runInBehindRatePerS: 1e4 }, roleMoves: { ...on.roleMoves, overlap: { ...on.roleMoves.overlap, ratePerS: 1e4 } } }
    const WC: Spot = { role: "W", at: { x: 10, y: 25 } }
    const FB: Spot = { role: "FB", at: { x: 2, y: 22 } }
    for (let seed = 1; seed <= 50; seed++) {
      const { w, carrierId, runnerId } = fixture(both, seed, WC, FB, 30)
      const rot = { kind: "rotate" as const, target: { x: 2, y: 12 } }
      w.setPlayer({ ...w.player(runnerId), intent: rot, intentUntil: w.tick + 10 })
      const roles = w.rng.roles.state
      expect(runMove(w, w.player(runnerId), w.player(carrierId))).toBeNull()
      expect(w.player(runnerId).intent).toEqual(rot)
      expect(w.rng.roles.state).toEqual(roles)
      // an FB run in behind (CM carrier moving forward) is not started either
      const f = fixture(both, seed, CM_FWD, FB, 30)
      f.w.setPlayer({ ...f.w.player(f.runnerId), intent: rot, intentUntil: f.w.tick + 10 })
      expect(runMove(f.w, f.w.player(f.runnerId), f.w.player(f.carrierId))).toBeNull()
      // once the rotation has expired, the overlap starts
      w.tick += 10
      expect(tryStart(w, carrierId, runnerId)).toBe(true)
    }
  })

  it("a wide run goes to the wide lane on the runner's side", () => {
    let wide = 0
    let n = 0
    for (let seed = 1; seed <= 200; seed++) {
      const { w, carrierId, runnerId } = fixture(forcedRuns(on), seed, CM_FWD, { role: "ST", at: { x: 15, y: -5 } }, 30)
      if (!tryStart(w, carrierId, runnerId)) continue
      n++
      const t = (w.player(runnerId).intent as { target: Vec2 }).target
      expect(t.x).toBeCloseTo(36, 9)
      if (t.y <= -14) wide++
      else expect(t.y).toBe(-5)
    }
    expect(n).toBe(200)
    // wideShare 0.6 (binomial sd about 0.035)
    expect(wide / n).toBeGreaterThan(0.48)
    expect(wide / n).toBeLessThan(0.72)
  })

  it("runs are triggered by a forward-facing CM or AM with space behind", () => {
    const count = (carrier: Spot, lineU: number, runner: Spot = ST, formation: FormationName = "4-3-3"): number => {
      let k = 0
      for (let seed = 1; seed <= 200; seed++) {
        const { w, carrierId, runnerId } = fixture(forcedRuns(on), seed, carrier, runner, lineU, formation)
        if (tryStart(w, carrierId, runnerId)) k++
      }
      return k
    }
    expect(count(CM_FWD, 30)).toBeGreaterThan(0)
    expect(count({ role: "AM", at: { x: 0, y: 5 }, vel: { x: 2, y: 0 } }, 30, ST, "4-2-3-1")).toBeGreaterThan(0)
    expect(count({ role: "DM", at: { x: 0, y: 5 }, vel: { x: 2, y: 0 } }, 30)).toBeGreaterThan(0)
    expect(count({ role: "CM", at: { x: 0, y: 5 }, vel: { x: 0, y: 0 } }, 30)).toBe(0)
    expect(count(CM_FWD, 45)).toBe(0)
    // moving backwards, a W carrier, a carrier deep in his own half: never
    expect(count({ role: "CM", at: { x: 0, y: 5 }, vel: { x: -2, y: 0 } }, 30)).toBe(0)
    expect(count({ role: "W", at: { x: 0, y: 20 }, vel: { x: 2, y: 0 } }, 30, ST)).toBe(0)
    expect(count({ role: "CM", at: { x: -25, y: 5 }, vel: { x: 2, y: 0 } }, 30)).toBe(0)
    // a CB never runs
    expect(count(CM_FWD, 30, { role: "CB", at: { x: -20, y: 5 } })).toBe(0)
  })

  it("role weights: wingers run more, strikers less", () => {
    // a moderate rate so the start chance is near-proportional to the role weight
    const p: Params = { ...on, runs: { ...on.runs, runInBehindRatePerS: 0.5 }, roleMoves: { ...on.roleMoves, overlap: { ...on.roleMoves.overlap, ratePerS: 0 } } }
    const starts = (runner: Spot): number => {
      let k = 0
      for (let seed = 1; seed <= 400; seed++) {
        const { w, carrierId, runnerId } = fixture(p, seed, CM_FWD, runner, 30)
        const fresh = w.player(runnerId)
        for (let i = 0; i < 25; i++) {
          w.setPlayer(fresh)
          if (tryStart(w, carrierId, runnerId)) k++
          w.tick += 1
        }
      }
      return k
    }
    const ratio = starts(W) / starts(ST)
    const want = R.roleWeight.W / R.roleWeight.ST
    expect(Math.abs(ratio / want - 1)).toBeLessThan(0.15)
  }, 60_000)

  it("an overlap goes outside and beyond the carrier at up to 5 m/s", () => {
    const WC: Spot = { role: "W", at: { x: 10, y: 25 } }
    const FB: Spot = { role: "FB", at: { x: 2, y: 22 } }
    // 4-3-3 home: the first W and the first FB are both on the +y side
    const { w, carrierId, runnerId } = fixture(forcedOverlaps(on), 5, WC, FB, 30)
    expect(overlapEligible(w.player(runnerId), w.player(carrierId), "first_half", O)).toBe(true)
    const cap = Math.min(vmaxFor(w.player(runnerId), w.player(runnerId).energy, w.p), O.speed)
    expect(cap).toBe(O.speed)
    const mt = runMove(w, w.player(runnerId), w.player(carrierId))!
    expect(mt.target).toEqual({ x: 16, y: 28 })
    expect(mt.speedCap).toBe(cap)
    const fb = w.player(runnerId)
    expect(fb.intent).toEqual({ kind: "run_in_behind", target: { x: 16, y: 28 }, overlap: true })
    const durTicks = fb.intentUntil - w.tick
    expect(durTicks).toBeGreaterThanOrEqual(Math.round(O.durS[0] / w.dt))
    expect(durTicks).toBeLessThanOrEqual(Math.round(O.durS[1] / w.dt))
    const ev = lastRun(w)
    expect(ev.attrs.kind).toBe("overlap")
    expect(ev.attrs.ball_carrier_id).toBe(carrierId)
    // a live overlap keeps its target and its cap (it is not re-aimed to the line)
    w.tick += 1
    const next = runMove(w, w.player(runnerId), w.player(carrierId))!
    expect(next.target).toEqual({ x: 16, y: 28 })
    expect(next.speedCap).toBe(cap)
    expect(w.events.filter((e) => e.type === "off_ball_run").length).toBe(1)

    const never = (carrier: Spot, fbSpot: Spot, formation: FormationName = "4-3-3"): void => {
      for (let seed = 1; seed <= 200; seed++) {
        const f = fixture(forcedOverlaps(on), seed, carrier, fbSpot, 30, formation)
        expect(tryStart(f.w, f.carrierId, f.runnerId)).toBe(false)
      }
    }
    // the FB 20 m behind, or the carrier in his own third
    never(WC, { role: "FB", at: { x: -10, y: 22 } })
    never({ role: "W", at: { x: -20, y: 25 } }, { role: "FB", at: { x: -28, y: 22 } })
    // 3-5-2 wing-back: no W, and no CM on his side with the ball (an ST wide, the far CM)
    never({ role: "ST", at: { x: 10, y: 25 } }, { role: "FB", at: { x: 2, y: 22 } }, "3-5-2")
    never({ role: "CM", at: { x: 10, y: -16 }, nth: 1 }, { role: "FB", at: { x: 2, y: 22 } }, "3-5-2")
  })

  it("rule off moves runs exactly as before", () => {
    // today's run in behind, inlined: ST, W and AM at runs.runInBehindRatePerS (movement stream), carrier beyond u -20
    const today = (w: Work, pl: PlayerState, owner: PlayerState, rng: Rng) => {
      if (pl.role !== "ST" && pl.role !== "W" && pl.role !== "AM") return null
      if (pl.intent.kind === "run_in_behind" && w.tick < pl.intentUntil) return pl.intent.target
      if (owner.pos.x * dirOf(pl.side, w.period) > -20 && rng.chance(hazard(w.p.runs.runInBehindRatePerS * tiringFactor(pl.energy, w.load?.[pl.id] ?? 0, w.p.fatigue), w.dt))) {
        const lastDef = lastDefenderAttackX(pl.side, w.period, w.active("away"))
        const target = clampToPitch({ x: dirOf(pl.side, w.period) * Math.min(lastDef + 6, 52.5 - 6), y: pl.pos.y * 0.8 }, 2)
        rng.range(2, 3)
        return target
      }
      return null
    }
    const offForced: Params = { ...off, runs: { ...off.runs, runInBehindRatePerS: 1e4 } }
    for (const [params, carrier] of [[offForced, CM_FWD], [off, CM_FWD], [offForced, { role: "CB", at: { x: -30, y: 5 } } as Spot]] as const) {
      for (let seed = 1; seed <= 20; seed++) {
        const { w, carrierId, runnerId } = fixture(params, seed, carrier, ST, 30)
        const rng = new Rng(w.rng.movement.state)
        const roles = w.rng.roles.state
        const want = today(w, w.player(runnerId), w.player(carrierId), rng)
        const got = runMove(w, w.player(runnerId), w.player(carrierId))
        expect(got?.target ?? null).toEqual(want)
        expect(w.rng.movement.state).toEqual(rng.state)
        expect(w.rng.roles.state).toEqual(roles)
        if (got) expect("overlap" in w.player(runnerId).intent).toBe(false)
      }
    }
  })
})

describe("A6 runs and overlaps: in matches", () => {
  interface Tally { runs: number; wide: number; overlaps: number; overlapField: number; badFrames: number }
  const play = (params: Params, seed: number, dt: number, t: Tally): void => {
    let s = initMatch(makeConfig(seed, { params, dt }))
    while (!isFinished(s)) {
      const r = step(s)
      s = r.state
      for (const e of r.events) {
        if (e.type !== "off_ball_run") continue
        if (e.attrs.kind === "in_behind") {
          t.runs++
          if (Math.abs(e.y_end ?? 0) >= 14) t.wide++
        } else if (e.attrs.kind === "overlap") t.overlaps++
      }
      for (const pl of s.players) if (pl.intent.kind === "run_in_behind" && "overlap" in pl.intent) t.overlapField++
      // frames carry only the intent kind, never the overlap marker
      if (r.frame)
        for (const fp of [...r.frame.home, ...r.frame.away])
          if (typeof fp.intent !== "string" || Object.keys(fp).sort().join() !== "id,intent,vel,x,y") t.badFrames++
    }
  }
  const tally = (params: Params, dt: number): Tally => {
    const t: Tally = { runs: 0, wide: 0, overlaps: 0, overlapField: 0, badFrames: 0 }
    for (const seed of [7, 9]) play(params, seed, dt, t)
    return t
  }

  for (const dt of [0.1, 0.04]) {
    it(`in matches, fewer and wider runs, and overlaps exist (dt ${dt})`, () => {
      const a = tally(off, dt)
      const b = tally(on, dt)
      const teamMatches = 4
      expect(a.overlaps).toBe(0)
      expect(a.overlapField).toBe(0)
      expect(a.runs).toBeGreaterThan(0)
      expect(b.runs).toBeGreaterThan(0)
      expect(b.runs / teamMatches).toBeLessThan(a.runs / teamMatches)
      expect(b.wide / b.runs).toBeGreaterThan(a.wide / a.runs)
      expect(b.overlaps / teamMatches).toBeGreaterThanOrEqual(3)
      expect(b.overlapField).toBeGreaterThan(0)
      expect(a.badFrames + b.badFrames).toBe(0)
    }, 600_000)
  }
})

import { readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "vitest"
import { initMatch, isFinished, paramsFromJson, step, type DomainEvent, type Frame, type FramePlayer, type Side } from "../src/index.js"
import { dirOf } from "../src/geometry.js"
import { setPieceKind } from "../src/setpiece.js"
import { makeConfig } from "../src/testing.js"

// P5 targets on the calibrated parameters, 4 matches (plan 8e Task 14 Step 6: test teams, seeds 7, 9, 11 and 13, fixed by
// this file's rule and never re-picked). Those that hold are plain tests; those not met yet are it.fails, unwidened,
// with the measured value: each flips (and fails the suite) once it is met, and then moves back to a plain test.
// Definitions follow python/analytics/touchline_analytics/setpieces.py (the deep report's setpieces section), read on the
// engine's 10 Hz frames: the snapshot is the frame of the set_piece event, in the restarting side's frame (u along its
// attack, y signed so the ball's side is +). Role moves are engine intent starts (off_ball_run events, plan ruling 26),
// a proxy for the frame-measured rows of the deep report.
const root = join(dirname(fileURLToPath(import.meta.url)), "../../..")
const params = paramsFromJson(JSON.parse(readFileSync(join(root, "data/params/touchline-params.json"), "utf8")))
const SEEDS = [7, 9, 11, 13]
const TEAM_MATCHES = 2 * SEEDS.length

const HL = 52.5
const BOX_U = 36
const BOX_W = 20.16
const WALL_MIN_M = 6
const WALL_MAX_M = 11.5
const WALL_DEG = 25
const FC_FROM_S = 0.3
const FC_TO_S = 5
const FC_M = 1.5
const TAKER_S = 1
const LONG_M = 32

interface M {
  cornerAtt: number[]
  cornerDef: number[]
  centralWall: boolean[]
  gkOppBox: number[]
  gkLong: boolean[]
  keeperFk: number
  throwDeadS: number[]
  moves: Record<"overlap" | "inside" | "in_behind" | "cm_drop", number>
}

const measure = (seed: number): M => {
  const cfg = makeConfig(seed, { params })
  const keepers = new Set([cfg.home, cfg.away].flatMap((tm) => [...tm.starters, ...(tm.bench ?? [])]).filter((p) => p.role === "GK").map((p) => p.id))
  let s = initMatch(cfg)
  const frames: Frame[] = []
  const events: DomainEvent[] = []
  while (!isFinished(s)) {
    const r = step(s)
    s = r.state
    if (r.frame) frames.push(r.frame)
    events.push(...r.events)
  }
  const at = new Map(frames.map((f, i) => [f.tick, i]))
  const m: M = { cornerAtt: [], cornerDef: [], centralWall: [], gkOppBox: [], gkLong: [], keeperFk: 0, throwDeadS: [], moves: { overlap: 0, inside: 0, in_behind: 0, cm_drop: 0 } }
  for (const e of events) {
    if (e.type === "off_ball_run") {
      const k = e.attrs.kind
      if (k === "overlap" || k === "inside" || k === "in_behind" || k === "cm_drop") m.moves[k]++
      continue
    }
    if (e.type !== "set_piece" || e.x === null || e.y === null) continue
    const i = at.get(e.frame_id)
    if (i === undefined) continue
    const f = frames[i]!
    const side: Side = f.home.some((p) => p.id === e.player_id) ? "home" : "away"
    const own = side === "home" ? f.home : f.away
    const opp = side === "home" ? f.away : f.home
    if (own.length < 10 || opp.length < 10) continue
    const d = dirOf(side, f.period)
    const sgn = e.y >= 0 ? 1 : -1
    const su = d * e.x
    const sw = sgn * e.y
    const uw = (p: FramePlayer) => [d * p.x, sgn * p.y] as const
    const inBox = (p: FramePlayer) => { const [u, y] = uw(p); return u > BOX_U && Math.abs(y) < BOX_W }
    const att = own.filter((p) => !keepers.has(p.id) && p.id !== e.player_id)
    const def = opp.filter((p) => !keepers.has(p.id))
    const kind = e.attrs.kind
    if (kind === "corner") {
      m.cornerAtt.push(att.filter(inBox).length)
      m.cornerDef.push(def.filter(inBox).length)
    } else if (kind === "free_kick") {
      if (keepers.has(e.player_id!)) m.keeperFk++
      if (setPieceKind("free_kick", { x: e.x, y: e.y }, side, f.period) === "fk_central") {
        const gb = Math.atan2(0 - sw, HL - su)
        m.centralWall.push(def.some((p) => {
          const [u, y] = uw(p)
          const r = Math.hypot(u - su, y - sw)
          const off = Math.abs(((Math.atan2(y - sw, u - su) - gb + 3 * Math.PI) % (2 * Math.PI)) - Math.PI)
          return r >= WALL_MIN_M && r <= WALL_MAX_M && off < (WALL_DEG * Math.PI) / 180
        }))
      }
    } else if (kind === "goal_kick") {
      m.gkOppBox.push(def.filter((p) => uw(p)[0] < -BOX_U).length)
      // First contact: the first player within 1.5 m of the ball 0.3-5 s after the kick (the taker excluded for 1 s),
      // on the 10 Hz frames; long when it is more than 32 m from the spot.
      for (let j = i + 1; j < frames.length; j++) {
        const g = frames[j]!
        const t = (g.tick - f.tick) * cfg.dt
        if (g.period !== f.period || t > FC_TO_S + 1e-9) break
        if (t < FC_FROM_S - 1e-9) continue
        const near = [...g.home, ...g.away].some((p) => (t >= TAKER_S || p.id !== e.player_id) && Math.hypot(p.x - g.ball.x, p.y - g.ball.y) < FC_M)
        if (near) {
          m.gkLong.push(Math.hypot(g.ball.x - e.x, g.ball.y - e.y) > LONG_M)
          break
        }
      }
    } else if (kind === "throw_in") {
      // Dead time: the dead spell that ends at the throw, inside the period (none when it reaches the period's start).
      let k = i - 1
      while (k >= 0 && frames[k]!.period === f.period && !frames[k]!.ball_in_play) k--
      if (k >= 0 && frames[k]!.period === f.period && k < i - 1) m.throwDeadS.push((f.tick - frames[k + 1]!.tick) * cfg.dt)
    }
  }
  return m
}

let all: M[] | undefined
const ms = () => (all ??= SEEDS.map(measure))
const mean = (xs: ReadonlyArray<number>) => xs.reduce((a, b) => a + b, 0) / xs.length
const share = (xs: ReadonlyArray<boolean>) => xs.filter(Boolean).length / xs.length
const median = (xs: ReadonlyArray<number>) => {
  const v = [...xs].sort((a, b) => a - b)
  return v.length % 2 ? v[(v.length - 1) / 2]! : (v[v.length / 2 - 1]! + v[v.length / 2]!) / 2
}
const pool = <K extends keyof M>(k: K) => ms().flatMap((m) => m[k] as unknown as ReadonlyArray<never>)
const perTeamMatch = (k: keyof M["moves"]) => ms().reduce((a, m) => a + m.moves[k], 0) / TEAM_MATCHES

describe("P5 real-data targets on the calibrated parameters (4 matches)", () => {
  // Non-vacuity (F11), outside the it.fails cases, so a run without the restarts fails the suite.
  it("the measure pass sees at least 20 corners, 8 central free kicks, 30 goal kicks and 80 throw-ins", () => {
    expect(pool("cornerAtt").length).toBeGreaterThanOrEqual(20)
    expect(pool("centralWall").length).toBeGreaterThanOrEqual(8)
    expect(pool("gkOppBox").length).toBeGreaterThanOrEqual(30)
    expect(pool("throwDeadS").length).toBeGreaterThanOrEqual(80)
  }, 900_000)
  // Measured (Task 14): 5.51 attackers and 9.00 defenders over 43 corners, wall at 9 of 9 central free kicks, 0.00
  // opponents beyond the box line at 72 goal kicks, 3.13 keeper free kicks per team-match, throw-in median 15.2 s (165).
  it("about 5.5 attackers in the box at corners (S1)", () => {
    const v = mean(pool("cornerAtt"))
    expect(v).toBeGreaterThanOrEqual(4.5)
    expect(v).toBeLessThanOrEqual(6.5)
  }, 900_000)
  it("about 9 defenders in the box at corners (S2)", () => {
    const v = mean(pool("cornerDef"))
    expect(v).toBeGreaterThanOrEqual(8)
    expect(v).toBeLessThanOrEqual(10)
  }, 900_000)
  it("central free kicks have a wall (S3)", () => {
    expect(share(pool("centralWall"))).toBeGreaterThanOrEqual(0.9)
  }, 900_000)
  it("opponents stay out of the box at goal kicks (S5)", () => {
    expect(mean(pool("gkOppBox"))).toBeLessThanOrEqual(0.4)
  }, 900_000)
  // NOT MET (Task 14, calibrated params): 0.309 of 68 goal kicks with a first contact (deep report: see Results: P5). The
  // long options at goal kicks are the S5 build-up FB and CM spots, 32-34 m out (Task 7).
  it.fails("NOT MET: about half of goal kicks go long (G3)", () => {
    const v = share(pool("gkLong"))
    expect(v).toBeGreaterThanOrEqual(0.4)
    expect(v).toBeLessThanOrEqual(0.56)
  }, 900_000)
  it("keepers take about 3 free kicks per team-match (G3)", () => {
    const v = ms().reduce((a, m) => a + m.keeperFk, 0) / TEAM_MATCHES
    expect(v).toBeGreaterThanOrEqual(2)
    expect(v).toBeLessThanOrEqual(4)
  }, 900_000)
  it("throw-ins restart in about 13.5 s (S8)", () => {
    const v = median(pool("throwDeadS"))
    expect(v).toBeGreaterThanOrEqual(11)
    expect(v).toBeLessThanOrEqual(16)
  }, 900_000)
  // NOT MET (Task 14): per team-match, overlaps 7.0, inside moves 53.75 (in band), runs 55.4, CM drops 14.9 (intent starts;
  // the frame-measured rows of the deep report differ, see Results: P5).
  it.fails("NOT MET: overlaps, inside moves, runs and CM drops near real (A6, intent starts)", () => {
    const v = [perTeamMatch("overlap"), perTeamMatch("inside"), perTeamMatch("in_behind"), perTeamMatch("cm_drop")]
    const bands = [[11, 17], [52, 72], [29, 40], [38, 52]] as const
    v.forEach((x, i) => {
      expect(x).toBeGreaterThanOrEqual(bands[i]![0])
      expect(x).toBeLessThanOrEqual(bands[i]![1])
    })
  }, 900_000)
})

import { readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "vitest"
import { initMatch, isFinished, paramsFromJson, step, type Frame, type Side } from "../src/index.js"
import { dirOf } from "../src/geometry.js"
import { makeConfig } from "../src/testing.js"

// P4 targets on the calibrated parameters, 4 matches (plan 8d ruling 24: test teams, seeds 7, 9, 11 and 13, fixed by
// this file's rule and never re-picked). Those that hold are plain tests; those not met yet are it.fails, unwidened,
// with the measured value: each flips (and fails the suite) once it is met, and then moves back to a plain test.
// Definitions follow python/analytics/touchline_analytics/duels.py (the deep report's duels section).
const root = join(dirname(fileURLToPath(import.meta.url)), "../../..")
const params = paramsFromJson(JSON.parse(readFileSync(join(root, "data/params/touchline-params.json"), "utf8")))
const SEEDS = [7, 9, 11, 13]

interface Tackle { readonly won: boolean; readonly front: boolean; readonly n3: number }
interface M { tackles: Tackle[]; defFouls: number; fouls: number; aerials: number; reach5: number[] }

const FRONT_DEG = 60
const HEADING_MIN_MPS = 1
const SUPPORT_M = 3

// A4 "reach" on the analysis's 5 Hz grid (duels.py _transitions and _losses): a loss is a live change of the possessing
// side after the loser held the ball at least 5 s, both sides with 10 players (9 outfielders) at the loss and the ball
// live for 4 s after it; per loss, the losing outfielders who come within 5 m of the ball within 3 s.
const reachPerLoss = (frames: ReadonlyArray<Frame>, keepers: ReadonlySet<string>, dt: number): number[] => {
  const g = frames.filter((f) => f.frame_id % Math.max(1, Math.round(0.2 / dt)) === 0)
  const t = (f: Frame) => f.frame_id * dt
  const valid = (f: Frame, s: Side) => {
    const ps = s === "home" ? f.home : f.away
    return ps.length >= 10 && ps.filter((p) => !keepers.has(p.id)).length >= 9
  }
  const out: number[] = []
  let cur: Side | null = null
  let curStart = 0
  let dead = true
  let curPer: Frame["period"] | null = null
  for (let i = 0; i < g.length; i++) {
    const f = g[i]!
    if (!f.ball_in_play) {
      dead = true
      continue
    }
    const p = f.possession_side
    if (p === null) continue
    if (f.period !== curPer) {
      dead = true
      curPer = f.period
    }
    if (p !== cur) {
      if (cur !== null && !dead && t(f) - curStart >= 5 && valid(f, "home") && valid(f, "away")) {
        const lost = cur
        const span = g.slice(i, i + 21)
        const live4 = span.length === 21 && span.every((h, k) => h.ball_in_play && h.period === f.period && Math.abs(t(h) - t(f) - 0.2 * k) < 0.05)
        if (live4) {
          const w3 = span.slice(0, 16)
          const losers = (lost === "home" ? f.home : f.away).filter((pl) => !keepers.has(pl.id))
          out.push(
            losers.filter((pl) =>
              w3.some((h) => {
                const q = (lost === "home" ? h.home : h.away).find((x) => x.id === pl.id)
                return q !== undefined && Math.hypot(q.x - h.ball.x, q.y - h.ball.y) <= 5
              })
            ).length
          )
        }
      }
      cur = p
      curStart = t(f)
    } else if (dead) curStart = t(f)
    dead = false
  }
  return out
}

const measure = (seed: number): M => {
  const cfg = makeConfig(seed, { params })
  const keepers = new Set([cfg.home, cfg.away].flatMap((tm) => [...tm.starters, ...(tm.bench ?? [])]).filter((p) => p.role === "GK").map((p) => p.id))
  let s = initMatch(cfg)
  const m: M = { tackles: [], defFouls: 0, fouls: 0, aerials: 0, reach5: [] }
  const frames: Frame[] = []
  while (!isFinished(s)) {
    const r = step(s)
    s = r.state
    if (r.frame) frames.push(r.frame)
    for (const e of r.events) {
      const a = e.attrs
      if (e.type === "aerial_duel") m.aerials++
      if (e.type === "foul") {
        m.fouls++
        if (a.kind === "tackle" || a.kind === "take_on") m.defFouls++
      }
      // Tackle attempts (pre-flight G2): lost or foul, or won with a ball; the won tackle of a lost take-on has none.
      if (e.type !== "tackle" || !(a.outcome === "lost" || a.outcome === "foul" || (a.outcome === "won" && a.ball !== undefined))) continue
      // Bearing and support are read from the state after the step, i.e. after this tick's movement (tackles are drawn
      // in ownedTick, before moveAll), as duels.py reads the tracking frame of the tackle's frame id. Read from the state
      // before the step instead (Task 10 fix round 1, 4 matches), front − behind is −0.077 (10 front) and supported −
      // alone −0.031 (31 against 57): up to about 0.8 m of movement at about 1 m range moves attempts between bins.
      const def = s.players.find((x) => x.id === e.player_id)
      const car = s.players.find((x) => x.id === a.opponent_id)
      if (!def || !car) continue
      const rx = def.pos.x - car.pos.x
      const ry = def.pos.y - car.pos.y
      const ref = Math.hypot(car.vel.x, car.vel.y) > HEADING_MIN_MPS ? car.vel : { x: dirOf(car.side, s.period), y: 0 }
      const cos = (rx * ref.x + ry * ref.y) / (Math.hypot(rx, ry) * Math.hypot(ref.x, ref.y) || 1)
      const deg = (Math.acos(Math.max(-1, Math.min(1, cos))) * 180) / Math.PI
      const n3 = s.players.filter((x) => x.side === def.side && !x.sentOff && Math.hypot(x.pos.x - car.pos.x, x.pos.y - car.pos.y) <= SUPPORT_M).length
      m.tackles.push({ won: a.outcome === "won", front: deg < FRONT_DEG, n3 })
    }
  }
  m.reach5 = reachPerLoss(frames, keepers, cfg.dt)
  return m
}

let all: M[] | undefined
const ms = () => (all ??= SEEDS.map(measure))
const tackles = () => ms().flatMap((m) => m.tackles)
const win = (rows: ReadonlyArray<Tackle>) => rows.filter((r) => r.won).length / rows.length
const perMatch = (k: "defFouls" | "fouls" | "aerials") => ms().reduce((acc, m) => acc + m[k], 0) / SEEDS.length

describe("P4 real-data targets on the calibrated parameters (4 matches)", () => {
  // Non-vacuity (F11), outside the it.fails cases so that a run with no tackles or no losses fails the suite.
  it("the measure pass sees at least 50 tackle attempts and 50 losses", () => {
    expect(tackles().length).toBeGreaterThanOrEqual(50)
    expect(ms().flatMap((m) => m.reach5).length).toBeGreaterThanOrEqual(50)
  }, 600_000)
  // NOT MET (P5 Task 14, calibrated params): 0.609 of 87 attempts (P4 Task 10: 0.568 of 88); 68 with the tackler alone within 3 m, 18 supported.
  // The tuner moved tackle_rate to its 0.1 minimum, so fewer tackles (deep report: see Results: P4).
  it.fails("NOT MET: defenders win about 48 % of tackle attempts (T2)", () => {
    const v = win(tackles())
    expect(v).toBeGreaterThanOrEqual(0.43)
    expect(v).toBeLessThanOrEqual(0.53)
  }, 600_000)
  // Non-vacuity floor (F11): at least 10 attempts in each arm (Task 10: 13 front against 75 behind on these seeds).
  // Fragile (P4 final review): front − behind and supported − alone rest on few attempts and flip sign when read before
  // the step's movement; an unrelated engine change can flip them. The mechanism guard is tackle.test.ts.
  // NOT MET (P5 Task 14, calibrated params): front 0.500 of 14 against behind 0.630 of 73, −0.130 (it was +0.055 on 13 / 75
  // in P4; the fragility noted above).
  it.fails("NOT MET: front approaches win more than those from behind (T2)", () => {
    const front = tackles().filter((r) => r.front)
    const behind = tackles().filter((r) => !r.front)
    expect(Math.min(front.length, behind.length)).toBeGreaterThanOrEqual(10)
    expect(win(front) - win(behind)).toBeGreaterThanOrEqual(0.04)
  }, 600_000)
  // Pre-flight ruling G3: support is the real count, the carrier's opponents within 3 m, tackler included; the bound is
  // 0.05 (real 0.60 supported against 0.51 alone).
  it("support helps the tackler (T2)", () => {
    const alone = tackles().filter((r) => r.n3 === 1)
    const supported = tackles().filter((r) => r.n3 >= 2)
    expect(Math.min(alone.length, supported.length)).toBeGreaterThanOrEqual(10)
    expect(win(supported) - win(alone)).toBeGreaterThanOrEqual(0.05)
  }, 600_000)
  // NOT MET (P5 Task 14): 11.75 per match (P4 Task 10: 11.75; tackle_rate at its 0.1 minimum, foul_per_tackle 0.48).
  it.fails("NOT MET: about 15 defender fouls per match (T3)", () => {
    const v = perMatch("defFouls")
    expect(v).toBeGreaterThanOrEqual(12)
    expect(v).toBeLessThanOrEqual(18)
  }, 600_000)
  // NOT MET (P5 Task 14): 17.75 per match (P4 Task 10: 18.75) (attacker and aerial fouls short; see Results: P4).
  it.fails("NOT MET: about 23 fouls per match in all (T3, T4)", () => {
    const v = perMatch("fouls")
    expect(v).toBeGreaterThanOrEqual(19)
    expect(v).toBeLessThanOrEqual(27)
  }, 600_000)
  // NOT MET (P5 Task 14): 37.75 per match (P4 Task 10: 35.5). P5's landing-spot marking and set-piece shapes added little;
  // P6 SH2 (headers) owns the rest.
  it.fails("NOT MET: about 47 aerial duels per match (T4)", () => {
    const v = perMatch("aerials")
    expect(v).toBeGreaterThanOrEqual(40)
    expect(v).toBeLessThanOrEqual(54)
  }, 600_000)
  // MET from P5 Task 14 (calibrated params): 2.069 per loss over 519 losses (P4 Task 10: 1.954 over 480, NOT MET).
  it("about 2.3 losing players reach the ball within 3 s (A4)", () => {
    const r = ms().flatMap((m) => m.reach5)
    const v = r.reduce((a, b) => a + b, 0) / r.length
    expect(v).toBeGreaterThanOrEqual(2.0)
    expect(v).toBeLessThanOrEqual(2.6)
  }, 600_000)
})

import { readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "vitest"
import { goalOf, PITCH } from "../src/geometry.js"
import { DEFAULT_PARAMS as P, paramsFromJson, type Params } from "../src/params.js"
import { Rng, seedRng } from "../src/rng.js"
import { planShot, saveChance, saveGeometry, type ShotOnTarget } from "../src/shot.js"
import { initMatch, isFinished, step } from "../src/step.js"
import type { MatchState, PlayerState } from "../src/types.js"
import { kickoffPlayersFor, makeConfig } from "../src/testing.js"

// SH3 (plan 8f, ruling 10 and F16): explicit off and on fixtures, never DEFAULT_PARAMS as "off".
const withRule = (p: Params, rule: number): Params => ({ ...p, saveGeo: { ...p.saveGeo, rule } })
const off = withRule(P, 0)
const on = withRule(P, 1)

const base = kickoffPlayersFor(makeConfig(1))
const gk = base.find((p) => p.side === "away" && p.role === "GK")!
const keeperAt = (x: number, y: number): PlayerState => ({ ...gk, pos: { x, y }, vel: { x: 0, y: 0 } })

/** A shot from (fromX, 0) at the +x goal, crossing at height 1.2 and lateral y, at `speed` m/s. */
const shotAt = (fromX: number, y: number, speed = P.shot.speed, goalX: number = PITCH.halfL): ShotOnTarget => ({
  y, z: 1.2, distance: Math.abs(goalX - fromX), from: { x: fromX, y: 0 }, goal: { x: goalX, y: 0 }, speed
})

describe("saveGeometry", () => {
  it("geometry: off the line, off the ball-goal line, flight time; mirrored", () => {
    const g = saveGeometry(shotAt(40, 2, 26), keeperAt(50.5, 1))!
    expect(g.offLineM).toBeCloseTo(2.0, 9)
    expect(g.offBisectorM).toBeCloseTo(1.0, 9)
    expect(g.flightS).toBeCloseTo(Math.hypot(12.5, 2) / 26, 9)
    // The other end (second half, or the away side): the same numbers.
    const m = saveGeometry(shotAt(-40, 2, 26, -PITCH.halfL), keeperAt(-50.5, 1))!
    expect(m.offLineM).toBeCloseTo(2.0, 9)
    expect(m.offBisectorM).toBeCloseTo(1.0, 9)
    expect(m.flightS).toBeCloseTo(Math.hypot(12.5, 2) / 26, 9)
    // Mirrored across the pitch's long axis too.
    const v = saveGeometry(shotAt(-40, -2, 26, -PITCH.halfL), keeperAt(-50.5, -1))!
    expect(v.offBisectorM).toBeCloseTo(1.0, 9)
    expect(v.flightS).toBeCloseTo(Math.hypot(12.5, 2) / 26, 9)
  })
  it("is null when the origin, the goal or the speed is missing", () => {
    const k = keeperAt(50.5, 1)
    const s = shotAt(40, 2)
    expect(saveGeometry({ y: s.y, z: s.z, distance: s.distance }, k)).toBeNull()
    expect(saveGeometry({ ...s, from: undefined }, k)).toBeNull()
    expect(saveGeometry({ ...s, goal: undefined }, k)).toBeNull()
    expect(saveGeometry({ ...s, speed: undefined }, k)).toBeNull()
  })
})

describe("saveChance under saveGeo", () => {
  it("rule on: a keeper off the bisector saves less, and so does a quick shot", () => {
    const s = shotAt(36, 0)
    // Off the shot's line, at the same distance off the goal line.
    expect(saveChance(s, keeperAt(50.3, 0), on)).toBeGreaterThan(saveChance(s, keeperAt(50.3, 1.5), on))
    // Flight 0.3 s against 0.8 s, everything else equal.
    const quick = shotAt(36, 0, 16.5 / 0.3), slow = shotAt(36, 0, 16.5 / 0.8)
    expect(saveGeometry(quick, keeperAt(50.3, 0))!.flightS).toBeCloseTo(0.3, 9)
    expect(saveChance(quick, keeperAt(50.3, 0), on)).toBeLessThan(saveChance(slow, keeperAt(50.3, 0), on))
    // Both on the bisector: 4 m off the line against 2.2 m.
    expect(saveChance(s, keeperAt(PITCH.halfL - 4, 0), on)).toBeLessThan(saveChance(s, keeperAt(PITCH.halfL - 2.2, 0), on))
    // Precondition: under off none of these moves the save chance.
    expect(saveChance(s, keeperAt(50.3, 0), off)).toBe(saveChance(s, keeperAt(50.3, 1.5), off))
    expect(saveChance(quick, keeperAt(50.3, 0), off)).toBe(saveChance(slow, keeperAt(50.3, 0), off))
    expect(saveChance(s, keeperAt(PITCH.halfL - 4, 0), off)).toBe(saveChance(s, keeperAt(PITCH.halfL - 2.2, 0), off))
  })
  it("rule on: centred, a 16 m shot at base speed with the keeper at the reference spot saves as under off (F16)", () => {
    // offLine at offLineRefM, on the bisector, flight 16 / shot.speed: every geometry term is 0, and bDistance is 0 at 16 m.
    const s: ShotOnTarget = { y: 0, z: 1.2, distance: 16, from: { x: PITCH.halfL - 16, y: 0 }, goal: { x: PITCH.halfL, y: 0 }, speed: P.shot.speed }
    const k = keeperAt(PITCH.halfL - P.saveGeo.offLineRefM, 0)
    expect(saveChance(s, k, on)).toBeCloseTo(saveChance(s, k, off), 12)
  })
  it("rule on: the logit moves by exactly the geometry terms, centred on the base shot speed (F16), at a non-base speed", () => {
    // The brief's geometry at 20 m/s (base 26): the on-minus-off logit is the three SH3 terms less the dropped distance term.
    const s = shotAt(40, 2, 20), k = keeperAt(50.5, 1)
    const logit = (x: number): number => Math.log(x / (1 - x))
    const g = P.saveGeo
    const reach = (t: number): number => Math.min(g.flightCapS, t - g.reactionS)
    const expected = g.bOffLine * (2 - g.offLineRefM) + g.bOffBisector * 1 + g.bFlightS * (reach(Math.hypot(12.5, 2) / 20) - reach(16 / P.shot.speed)) -
      (P.shot.save.bDistance * (12.5 - 16)) / 10
    expect(logit(saveChance(s, k, on)) - logit(saveChance(s, k, off))).toBeCloseTo(expected, 9)
  })
  it("rule on: bDistance is not read", () => {
    const s = shotAt(30, 1), k = keeperAt(50.3, 0.5)
    const bump = (p: Params): Params => ({ ...p, shot: { ...p.shot, save: { ...p.shot.save, bDistance: p.shot.save.bDistance + 1 } } })
    expect(saveChance(s, k, bump(on))).toBe(saveChance(s, k, on))
    expect(saveChance(s, k, bump(off))).not.toBe(saveChance(s, k, off))
  })
  it("rule off ignores the geometry", () => {
    const k = keeperAt(48, 2.5)
    for (const s of [shotAt(30, 1), shotAt(44, -3, 40), shotAt(20, 2.5, 13)]) {
      const bare: ShotOnTarget = { y: s.y, z: s.z, distance: s.distance }
      expect(saveChance(s, k, off)).toBe(saveChance(bare, k, off))
      expect(saveChance(s, k, off, 0.7)).toBe(saveChance(bare, k, off, 0.7))
    }
  })
  it("rule on without the geometry falls back to the rule-0 chance", () => {
    const s = shotAt(30, 1), k = keeperAt(48, 2.5)
    const bare: ShotOnTarget = { y: s.y, z: s.z, distance: s.distance }
    expect(saveChance(bare, k, on)).toBe(saveChance(bare, k, off))
  })
  it("rule on reaches planShot: a keeper off the shot's line concedes more (same draws)", () => {
    // Shooter (home, first half) 16.5 m out, unpressed, no defenders but the keeper: only the save chance can differ.
    const shooter: PlayerState = { ...base.find((x) => x.side === "home" && x.role === "ST")!, pos: { x: 36, y: 0 }, vel: { x: 0, y: 0 } }
    const goals = (p: Params, keeper: PlayerState): number => {
      let n = 0
      for (let i = 0; i < 2000; i++) if (planShot(shooter, "home", "first_half", [keeper], 0.1, 0, false, p, 0.1, new Rng(seedRng(i))).outcome === "goal") n++
      return n
    }
    const onLine = keeperAt(50.3, 0), offLine = keeperAt(50.3, 3)
    // Precondition: under off the keeper's spot does not enter, so the outcomes are identical.
    expect(goals(off, offLine)).toBe(goals(off, onLine))
    expect(goals(on, offLine)).toBeGreaterThan(goals(on, onLine) + 20)
  })
})

// In matches (replaces a conversion comparison that also held with SH3 off): the same on-target shots and keepers, scored under
// off and under on. Eight matches at dt 0.1 with the rule off; each shot is rebuilt at release from its flight (origin, crossing
// point, speed) and the defending keeper as he stood at the start of that tick. Match-level conversion is Task 8's.
const root = join(dirname(fileURLToPath(import.meta.url)), "../../..")
const calibrated = paramsFromJson(JSON.parse(readFileSync(join(root, "data/params/touchline-params.json"), "utf8")))

interface Paired { readonly flightS: number; readonly delta: number }

const pairedShots = (seed: number): Paired[] => {
  const pOff = withRule(calibrated, 0), pOn = withRule(calibrated, 1)
  let s: MatchState = initMatch(makeConfig(seed, { params: pOff, dt: 0.1 }))
  const seen = new Set<string>()
  const out: Paired[] = []
  while (!isFinished(s)) {
    const before = s
    s = step(s).state
    if (s.possession.kind !== "in_flight" || s.possession.flight.kind !== "shot") continue
    const f = s.possession.flight
    const key = `${f.releaseTick}:${f.fromId}`
    if (seen.has(key)) continue
    seen.add(key)
    const a = f.pending.attrs
    if (a.on_target !== true || a.technique !== "normal" || a.scripted === true || !f.path) continue
    const keeper = before.players.find((x) => x.side !== f.side && x.role === "GK" && !x.sentOff)
    if (!keeper) continue
    const from = { x: f.path.from.x, y: f.path.from.y }, goal = goalOf(f.side, s.period)
    const shot: ShotOnTarget = { y: f.path.to.y, z: f.path.to.z, distance: Math.hypot(goal.x - from.x, goal.y - from.y), from, goal, speed: Number(a.shot_speed_kmh) / 3.6 }
    out.push({ flightS: saveGeometry(shot, keeper)!.flightS, delta: saveChance(shot, keeper, pOn) - saveChance(shot, keeper, pOff) })
  }
  return out
}

describe("SH3 on in-match shots", () => {
  it("paired on minus off: quick shots lose more save chance than slow ones", { timeout: 300_000 }, () => {
    // Eight matches (F17): on the P4 engine (shot logit -3.6) seeds 7 and 9 give only 8 such shots; the eight give 53.
    const shots = [7, 9, 11, 13, 15, 17, 19, 21].flatMap(pairedShots).sort((a, b) => a.flightS - b.flightS)
    expect(shots.length).toBeGreaterThanOrEqual(10)
    const half = Math.floor(shots.length / 2)
    const mean = (xs: ReadonlyArray<Paired>): number => xs.reduce((t, x) => t + x.delta, 0) / xs.length
    const quick = shots.slice(0, half), slow = shots.slice(half)
    // The rule moves real shots, not only fixtures.
    expect(shots.reduce((t, x) => t + Math.abs(x.delta), 0) / shots.length).toBeGreaterThan(0.02)
    expect(mean(quick)).toBeLessThan(mean(slow))
  })
})

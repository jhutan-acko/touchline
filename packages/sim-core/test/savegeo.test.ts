import { readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "vitest"
import { PITCH } from "../src/geometry.js"
import { DEFAULT_PARAMS as P, paramsFromJson, type Params } from "../src/params.js"
import { saveChance, saveGeometry, type ShotOnTarget } from "../src/shot.js"
import { initMatch, isFinished, step } from "../src/step.js"
import type { DomainEvent, PlayerState } from "../src/types.js"
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
})

// The in-match test runs on the calibrated parameters with SH3 on. F17: 8 seeds, at least 20 shots per bin. The plan's fixed
// bins (flight < 0.5 s against > 0.8 s) fall short: at dt 0.1 over 8 seeds they hold 11 and 27 on-target shots, at dt 0.04 over
// the first 4 seeds 11 and 13. So, per F17's fallback, the test splits every on-target shot at the median flight time, and runs
// all 8 seeds at dt 0.04 too (the first 4 give 36 shots, 18 per half, under the floor).
const root = join(dirname(fileURLToPath(import.meta.url)), "../../..")
const calibrated = paramsFromJson(JSON.parse(readFileSync(join(root, "data/params/touchline-params.json"), "utf8")))
const SEEDS = [7, 9, 11, 13, 15, 17, 19, 21]

interface OnTarget { readonly flightS: number; readonly goal: boolean }

/** Open-play on-target shots that were not scripted, with their flight time to the goal line (from the event's shot speed). */
const onTargetShots = (p: Params, seed: number, dt: number): OnTarget[] => {
  let s = initMatch(makeConfig(seed, { params: p, dt }))
  const events: DomainEvent[] = []
  while (!isFinished(s)) {
    const r = step(s)
    s = r.state
    events.push(...r.events)
  }
  return events
    .filter((e) => e.type === "shot" && e.attrs.on_target === true && e.attrs.technique === "normal" && e.attrs.scripted !== true)
    .map((e) => {
      const goalX = Math.sign(e.x_end!) * PITCH.halfL
      const speed = Number(e.attrs.shot_speed_kmh) / 3.6
      return { flightS: Math.hypot(goalX - e.x!, e.y_end! - e.y!) / speed, goal: e.outcome === "goal" }
    })
}

const conversion = (xs: ReadonlyArray<OnTarget>): number => xs.filter((x) => x.goal).length / xs.length

describe.each([0.1, 0.04])("SH3 in matches at dt %s", (dt) => {
  it("in matches, quick shots convert more (split at the median flight time)", { timeout: 1_800_000 }, () => {
    const shots = SEEDS.flatMap((seed) => onTargetShots(withRule(calibrated, 1), seed, dt)).sort((a, b) => a.flightS - b.flightS)
    const half = Math.floor(shots.length / 2)
    const quick = shots.slice(0, half), slow = shots.slice(half)
    expect(quick.length).toBeGreaterThanOrEqual(20)
    expect(slow.length).toBeGreaterThanOrEqual(20)
    expect(conversion(quick)).toBeGreaterThan(conversion(slow))
  })
})

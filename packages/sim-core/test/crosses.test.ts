import { describe, expect, it } from "vitest"
import { buildCandidates, type Candidate } from "../src/decide.js"
import { DEFAULT_PARAMS as P, type Params } from "../src/params.js"
import type { Period } from "../src/geometry.js"
import type { PlayerState } from "../src/types.js"
import { kickoffPlayersFor, makeConfig, STYLES } from "../src/testing.js"

const players = kickoffPlayersFor(makeConfig(1))
const at = (p: PlayerState, x: number, y: number): PlayerState => ({ ...p, pos: { x, y }, vel: { x: 0, y: 0 } })
const home = players.filter((p) => p.side === "home")
const away = players.filter((p) => p.side === "away")
// Ruling F4: an explicit off object, never DEFAULT_PARAMS as "the switched-off engine".
const off: Params = { ...P, cross: { ...P.cross, rule: 0 } }
// The geometry below is fixed for the brief's values (slack 0.3 s): a longer slack lets the same striker also reach the near post.
const on: Params = { ...P, cross: { ...P.cross, rule: 1, arriveSlackS: 0.3, attackerValue: 0.3 } }

/** Home (4-3-3) winger on the ball at (ox, oy), the striker at (sx, sy), everyone else far away; d = +1 first half, -1 second. */
const crosses = (p: Params, period: Period, d: number, o: [number, number], st: [number, number]): Candidate[] => {
  const owner = at(home[8]!, d * o[0], o[1])
  const striker = at(home[9]!, d * st[0], st[1])
  const teammates = home.map((x) => (x.id === owner.id ? owner : x.id === striker.id ? striker : at(x, d * (-30 + x.slot), -30)))
  const opponents = away.map((x) => (x.role === "GK" ? at(x, d * 51, 0) : at(x, d * (5 + x.slot), 30)))
  return buildCandidates({ period, owner, teammates, opponents, style: STYLES.direct, scoreDiff: 0, minute: 30, restart: null, scriptBias: {} }, p, 0).filter((c) => c.kind === "cross")
}

/** Ruling F1: the old rule already gives the striker an 8 m through target that classifies as a cross, so assert only what the rule adds. */
const same = (a: Candidate, b: Candidate) => a.receiverId === b.receiverId && Math.abs(a.target.x - b.target.x) < 1e-6 && Math.abs(a.target.y - b.target.y) < 1e-6 && a.height === b.height
const added = (period: Period, d: number, o: [number, number], st: [number, number]): Candidate[] => {
  const base = crosses(off, period, d, o, st)
  return crosses(on, period, d, o, st).filter((c) => !base.some((b) => same(b, c)))
}
const isZone = (c: Candidate, d: number, u: number, y: number) => Math.abs(c.target.x - d * u) < 1e-6 && Math.abs(c.target.y - y) < 1e-6

describe("D3: crosses to zones", () => {
  it("a wide carrier crosses to the penalty spot when a striker outside the box can get there; none without the rule", () => {
    const base = crosses(off, "first_half", 1, [38, 28], [33, 5])
    expect(base.some((c) => isZone(c, 1, 41.5, 0))).toBe(false)
    const c = added("first_half", 1, [38, 28], [33, 5])
    expect(c).toHaveLength(1)
    expect(c[0]!.target.x).toBeCloseTo(41.5, 6)
    expect(c[0]!.target.y).toBeCloseTo(0, 6)
    expect(c[0]!.height).toBe("high")
    expect(c[0]!.receiverId).toBe(home[9]!.id)
  })
  it("no zone is offered that nobody can reach in time", () => {
    expect(added("first_half", 1, [38, 28], [10, 5])).toEqual([])
  })
  it("mirrors in the second half and from the left: the near post is on the crosser's side", () => {
    const c = crosses(on, "second_half", -1, [38, -28], [44, -6])
    expect(c.some((x) => Math.abs(x.target.x + 47.5) < 1e-6 && Math.abs(x.target.y + 3) < 1e-6)).toBe(true)
    expect(c.some((x) => Math.abs(x.target.x + 47.5) < 1e-6 && Math.abs(x.target.y - 3) < 1e-6)).toBe(false)
  })
  it("the cut-back is offered only from near the byline", () => {
    const deep = added("first_half", 1, [46, 26], [40, 8])
    expect(deep.some((x) => x.height === "ground" && Math.abs(x.target.x - 42) < 1e-6 && Math.abs(x.target.y - 6) < 1e-6)).toBe(true)
    const early = added("first_half", 1, [38, 28], [40, 8])
    expect(early.some((x) => x.height === "ground")).toBe(false)
  })
})

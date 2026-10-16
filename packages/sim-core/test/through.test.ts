import { describe, expect, it } from "vitest"
import { buildCandidates } from "../src/decide.js"
import { DEFAULT_PARAMS as P, type Params } from "../src/params.js"
import type { Period } from "../src/geometry.js"
import type { PlayerState } from "../src/types.js"
import { kickoffPlayersFor, makeConfig, STYLES } from "../src/testing.js"

const players = kickoffPlayersFor(makeConfig(1))
const at = (p: PlayerState, x: number, y: number): PlayerState => ({ ...p, pos: { x, y }, vel: { x: 0, y: 0 } })
const home = players.filter((p) => p.side === "home")
const away = players.filter((p) => p.side === "away")
const off: Params = { ...P, through: { ...P.through, rule: 0 } }
const on: Params = { ...P, through: { ...P.through, rule: 1 } }

/**
 * The owner's CM on the ball at the centre; the striker runs in behind from (15, 5) to (30, 5) in the attack direction d;
 * a winger stands near the line at (20, -20). `side` picks who attacks (home: +x in the first half, away: -x).
 * `intentUntil`/`tick` set whether the run is live.
 */
const through = (p: Params, period: Period, d: number, side: "home" | "away" = "home", live = true) => {
  const mine = side === "home" ? home : away
  const theirs = side === "home" ? away : home
  const owner = at(mine[5]!, 0, 0)
  const st = { ...at(mine[9]!, d * 15, 5), intent: { kind: "run_in_behind" as const, target: { x: d * 30, y: 5 } }, intentUntil: live ? 1000 : 400 }
  const w = at(mine[10]!, d * 20, -20)
  const teammates = mine.map((x) => (x.id === owner.id ? owner : x.id === st.id ? st : x.id === w.id ? w : at(x, d * (-30 + x.slot), 30)))
  const opponents = theirs.map((x) => (x.role === "GK" ? at(x, d * 51, 0) : x.role === "CB" ? at(x, d * 22, x.slot === 2 ? 8 : -8) : at(x, d * (-5 - x.slot), 30)))
  const cands = buildCandidates({ period, owner, teammates, opponents, style: STYLES.possession, scoreDiff: 0, minute: 30, restart: null, scriptBias: {}, tick: 500 }, p, 0)
  return { st: cands.filter((c) => c.receiverId === st.id && (c.kind === "through" || c.kind === "lofted_through")), w: cands.filter((c) => c.receiverId === w.id && (c.kind === "through" || c.kind === "lofted_through")) }
}

describe("D4: through balls into space", () => {
  it("the old rule gives a fixed 8 m lead to anyone near the last defender", () => {
    const old = through(off, "first_half", 1)
    expect(old.w.map((c) => c.target)).toEqual([{ x: 28, y: -20 }])
    expect(old.st.map((c) => c.target)).toEqual([{ x: 23, y: 5 }])
  })
  it("with the rule the runner gets the ball where he will be when it arrives, and the static winger gets none", () => {
    const now = through(on, "first_half", 1)
    expect(now.w).toEqual([])
    expect(now.st).toHaveLength(1)
    expect(now.st[0]!.target.x).toBeCloseTo(26.7, 1)
    expect(now.st[0]!.target.y).toBeCloseTo(5, 6)
    expect(now.st[0]!.kind).toBe("through")
  })
  it("mirrors in the second half", () => {
    const now = through(on, "second_half", -1)
    expect(now.st[0]!.target.x).toBeCloseTo(-26.7, 1)
  })
  it("mirrors for the away side, which attacks -x in the first half", () => {
    const now = through(on, "first_half", -1, "away")
    expect(now.w).toEqual([])
    expect(now.st).toHaveLength(1)
    expect(now.st[0]!.target.x).toBeCloseTo(-26.7, 1)
    expect(now.st[0]!.target.y).toBeCloseTo(5, 6)
    expect(now.st[0]!.kind).toBe("through")
    expect(through(off, "first_half", -1, "away").st.map((c) => c.target)).toEqual([{ x: -23, y: 5 }])
  })
  it("an expired run_in_behind (tick >= intentUntil) gets no through target with the rule on, but the old rule is unchanged", () => {
    expect(through(on, "first_half", 1, "home", false).st).toEqual([])
    expect(through(off, "first_half", 1, "home", false).st.map((c) => c.target)).toEqual([{ x: 23, y: 5 }])
  })
})

import { describe, expect, it } from "vitest"
import { buildCandidates, DEFAULT_PARAMS, type PlayerState } from "../src/index.js"
import { kickoffPlayersFor, makeConfig, STYLES } from "../src/testing.js"

// Own goals came almost entirely from one move: an outfielder 30-60 m out lofting the ball back to his own
// keeper, aimed a few metres in front of the goal; an overhit ball, or the keeper's heavy touch, ended in the
// net. Real players pass back to the keeper along the ground from close range; they do not loft it at him.
const scene = (ownerX: number) => {
  const players = kickoffPlayersFor(makeConfig(1))
  const at = (p: PlayerState, x: number, y: number): PlayerState => ({ ...p, pos: { x, y }, vel: { x: 0, y: 0 } })
  const home = players.filter((p) => p.side === "home")
  // Opponents far away on the other wing, so nothing but distance shapes the options.
  const opponents = players.filter((p) => p.side === "away").map((p, i) => at(p, 30 + i, 30))
  const keeper = at(home.find((p) => p.role === "GK")!, -48, 0)
  const owner = at(home[6]!, ownerX, 0)
  const teammates = home.map((p) => (p.id === keeper.id ? keeper : p.id === owner.id ? owner : at(p, -10 + p.slot * 3, -25)))
  const toKeeper = buildCandidates({ period: "first_half", owner, teammates, opponents, style: STYLES.possession, scoreDiff: 0, minute: 30, restart: null, scriptBias: {} }, DEFAULT_PARAMS, 0).filter((c) => c.receiverId === keeper.id)
  return toKeeper
}

describe("passes back to the keeper", () => {
  it("are never lofted at him from distance", () => {
    for (const x of [-10, 0, 10]) expect(scene(x)).toEqual([])
  })

  it("are still played along the ground from close range", () => {
    const options = scene(-30)
    expect(options.length).toBeGreaterThan(0)
    for (const c of options) expect(c.height).toBe("ground")
  })
})

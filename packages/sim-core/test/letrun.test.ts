import { describe, expect, it } from "vitest"
import { launchVelocity } from "../src/ball.js"
import { DEFAULT_PARAMS as P } from "../src/params.js"
import { keeperLetsRun, resolveFlight } from "../src/resolve.js"
import { Rng, seedRng } from "../src/rng.js"
import { kickoffPlayersFor, makeConfig } from "../src/testing.js"
import type { PlayerState } from "../src/types.js"

const base = kickoffPlayersFor(makeConfig(1))
const at = (p: PlayerState, x: number, y: number): PlayerState => ({ ...p, pos: { x, y }, vel: { x: 0, y: 0 } })

describe("keeper lets the ball run out", () => {
  // A home attacker plays the ball towards the away goal line; only the away keeper is near it.
  const passer = at(base[9]!, 30, 6)
  const keeper = at(base.find((p) => p.side === "away" && p.role === "GK")!, 49, 5)
  const players = [passer, keeper]
  const ball = { pos: { x: 30, y: 6, z: 0 }, vel: launchVelocity(passer.pos, { x: 50, y: 7 }, "ground", P) }
  const res = resolveFlight(ball, passer.id, null, players, P, 0.1, new Rng(seedRng(1)))

  it("the keeper could collect it", () => {
    expect(res.winnerId).toBe(keeper.id)
  })
  it("lets it go for a goal kick when it would cross their own goal line", () => {
    const p = { ...P, keeper: { ...P.keeper, letRunShare: 1 } }
    const r = keeperLetsRun(ball, passer.id, null, players, res, "first_half", p, 0.1, new Rng(seedRng(2)))
    expect(r.result).toBe("out")
    expect(r.ball.pos.x).toBeGreaterThan(52.5)
  })
  it("collects it when letRunShare is 0, and never lets a ball go that would stay in play", () => {
    const keep = { ...P, keeper: { ...P.keeper, letRunShare: 0 } }
    expect(keeperLetsRun(ball, passer.id, null, players, res, "first_half", keep, 0.1, new Rng(seedRng(2)))).toBe(res)
    const short = { pos: { x: 30, y: 6, z: 0 }, vel: launchVelocity(passer.pos, { x: 44, y: 6 }, "ground", { ...P, pass: { ...P.pass, arriveSpeed: 1 } }) }
    const near = at(keeper, 44, 6)
    const r0 = resolveFlight(short, passer.id, null, [passer, near], P, 0.1, new Rng(seedRng(1)))
    const always = { ...P, keeper: { ...P.keeper, letRunShare: 1 } }
    expect(keeperLetsRun(short, passer.id, null, [passer, near], r0, "first_half", always, 0.1, new Rng(seedRng(2)))).toBe(r0)
  })
  it("only the defending keeper does it: a team's own keeper still collects its own back pass", () => {
    const ownKeeper = at(base.find((p) => p.side === "home" && p.role === "GK")!, -49, 5)
    const back = { pos: { x: -30, y: 6, z: 0 }, vel: launchVelocity({ x: -30, y: 6 }, { x: -50, y: 7 }, "ground", P) }
    const from = at(base[2]!, -30, 6)
    const r0 = resolveFlight(back, from.id, null, [from, ownKeeper], P, 0.1, new Rng(seedRng(1)))
    const always = { ...P, keeper: { ...P.keeper, letRunShare: 1 } }
    expect(keeperLetsRun(back, from.id, null, [from, ownKeeper], r0, "first_half", always, 0.1, new Rng(seedRng(2)))).toBe(r0)
  })
})

import { describe, expect, it } from "vitest"
import { decide } from "../src/decide.js"
import { DEFAULT_PARAMS as P } from "../src/params.js"
import { Rng, seedRng } from "../src/rng.js"
import { initMatch, isFinished, step } from "../src/step.js"
import { kickoffPlayersFor, makeConfig, STYLES } from "../src/testing.js"
import type { Frame } from "../src/types.js"

describe("a player on the ball", () => {
  const players = kickoffPlayersFor(makeConfig(1))
  const home = players.filter((p) => p.side === "home")
  const away = players.filter((p) => p.side === "away")
  const owner = { ...home[6]!, pos: { x: 0, y: 0 } }
  const holdShare = (onBallS: number) =>
    decide({ owner, teammates: home, opponents: away, style: STYLES.possession, scoreDiff: 0, minute: 30, restart: null, scriptBias: {}, onBallS }, P, new Rng(seedRng(3))).actionProbs.hold ?? 0

  it("holds the ball less the longer they have had it, and hardly ever after a few seconds", () => {
    expect(holdShare(0)).toBeGreaterThan(holdShare(1))
    expect(holdShare(1)).toBeGreaterThan(holdShare(2))
    expect(holdShare(3)).toBeLessThan(holdShare(0) / 10)
  })

  it("keeps moving: outfielders walk the ball into space and keepers walk to the edge of their box", () => {
    let s = initMatch(makeConfig(7))
    const frames: Frame[] = []
    while (!isFinished(s)) {
      const r = step(s)
      s = r.state
      if (r.frame) frames.push(r.frame)
    }
    const keepers = new Set(s.players.filter((p) => p.role === "GK").map((p) => p.id))
    const tally = { outfield: { on: 0, still: 0 }, keeper: { on: 0, still: 0 } }
    for (const f of frames) {
      if (!f.ball_in_play) continue
      for (const p of [...f.home, ...f.away]) {
        if (p.intent !== "on_ball") continue
        const t = keepers.has(p.id) ? tally.keeper : tally.outfield
        t.on++
        if (p.vel < 0.2) t.still++
      }
    }
    expect(tally.outfield.on).toBeGreaterThan(1000)
    expect(tally.outfield.still / tally.outfield.on).toBeLessThan(0.05)
    expect(tally.keeper.still / tally.keeper.on).toBeLessThan(0.5)
  }, 120_000)

  it("stands on the ball as before with holdSpeed 0 (the switch)", () => {
    const params = { ...P, carry: { ...P.carry, holdSpeed: 0 } }
    let s = initMatch(makeConfig(7, { params }))
    let on = 0
    let still = 0
    while (!isFinished(s) && s.tick < 12_000) {
      const r = step(s)
      s = r.state
      for (const p of [...(r.frame?.home ?? []), ...(r.frame?.away ?? [])]) {
        if (!r.frame!.ball_in_play || p.intent !== "on_ball") continue
        on++
        if (p.vel < 0.2) still++
      }
    }
    expect(still / on).toBeGreaterThan(0.2)
  }, 120_000)
})

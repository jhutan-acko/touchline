import { describe, expect, it } from "vitest"
import { advanceDrift, driftFor, newPlayerDrift, ouStep } from "../src/drift.js"
import { DEFAULT_PARAMS as P } from "../src/params.js"
import { Rng, seedRng } from "../src/rng.js"
import type { AnchorState } from "../src/types.js"

const d = P.positioning.drift
const sdOf = (xs: number[]) => {
  const m = xs.reduce((a, b) => a + b, 0) / xs.length
  return Math.sqrt(xs.reduce((a, b) => a + (b - m) ** 2, 0) / (xs.length - 1))
}
const empty = (): AnchorState => ({
  ballLag: [{ x: 0, y: 0 }],
  teams: { home: { row: "in", prev: "in", since: 0, drift: { u: 0, y: 0 } }, away: { row: "out", prev: "out", since: 0, drift: { u: 0, y: 0 } } },
  players: {}
})

describe("drift (A3)", () => {
  it("an OU step keeps its stationary SD and time constant at 10 Hz and at 25 Hz", () => {
    for (const dt of [0.1, 0.04]) {
      const rng = new Rng(seedRng(1))
      const xs: number[] = []
      let x = 0
      for (let i = 0; i < Math.round(20000 / dt); i++) xs.push((x = ouStep(x, 9, 8, dt, rng)))
      expect(sdOf(xs)).toBeGreaterThan(9 * 0.92)
      expect(sdOf(xs)).toBeLessThan(9 * 1.08)
      const lag = Math.round(8 / dt)
      const m = xs.reduce((a, b) => a + b, 0) / xs.length
      let num = 0
      let den = 0
      for (let i = 0; i + lag < xs.length; i++) num += (xs[i]! - m) * (xs[i + lag]! - m)
      for (const v of xs) den += (v - m) ** 2
      expect(num / den).toBeGreaterThan(Math.exp(-1) - 0.08)
      expect(num / den).toBeLessThan(Math.exp(-1) + 0.08)
    }
  }, 120_000)

  it("a zero SD returns 0 and draws nothing", () => {
    const rng = new Rng(seedRng(2))
    const before = rng.state
    expect(ouStep(5, 0, 8, 0.1, rng)).toBe(0)
    expect(rng.state).toEqual(before)
  })

  it("team drift settles at its SDs, and the same seed gives the same drift", () => {
    const run = () => {
      const rng = new Rng(seedRng(3))
      let s = empty()
      const us: number[] = []
      for (let i = 0; i < 200_000; i++) {
        s = advanceDrift(s, [], 0.1, d, rng)
        us.push(s.teams.home.drift.u)
      }
      return { s, us }
    }
    const a = run()
    expect(sdOf(a.us)).toBeGreaterThan(d.teamUSdM * 0.9)
    expect(sdOf(a.us)).toBeLessThan(d.teamUSdM * 1.1)
    expect(run().s).toEqual(a.s)
  }, 120_000)

  it("a substitute gets his own offsets the tick he appears; a player who left keeps his entry", () => {
    const rng = new Rng(seedRng(4))
    let s = advanceDrift(empty(), [{ id: "a", group: "W" }, { id: "b", group: "CB" }], 0.1, d, rng)
    const b = s.players.b!
    expect(Math.abs(s.players.a!.offIn.s)).toBeGreaterThan(0)
    s = advanceDrift(s, [{ id: "a", group: "W" }, { id: "c", group: "CB" }], 0.1, d, rng)
    expect(s.players.b).toEqual(b)
    expect(s.players.c).toBeDefined()
    const fresh = newPlayerDrift("GK", d, new Rng(seedRng(5)))
    expect(fresh).toEqual({ offIn: { u: 0, s: 0 }, offOut: { u: 0, s: 0 }, slow: { u: 0, s: 0 } })
  })

  it("driftFor sums team, blended offset and slow drift, with s toward the player's own touchline", () => {
    const s: AnchorState = {
      ...empty(),
      teams: { ...empty().teams, home: { row: "in", prev: "out", since: 0, drift: { u: 1, y: 2 } } },
      players: { p: { offIn: { u: 4, s: 3 }, offOut: { u: -2, s: 1 }, slow: { u: 0.5, s: 0.25 } } }
    }
    const left = driftFor(s, "home", "p", 0.5, 0.25, "out", "in", 1)
    expect(left.u).toBeCloseTo(1 + (-2 + 0.5 * 6) + 0.5, 9)
    expect(left.y).toBeCloseTo(2 + (1 + 0.25 * 2 + 0.25), 9)
    const right = driftFor(s, "home", "p", 0.5, 0.25, "out", "in", -1)
    expect(right.y).toBeCloseTo(2 - (1 + 0.25 * 2 + 0.25), 9)
    expect(driftFor(s, "home", "nobody", 1, 1, "in", "in", 0)).toEqual({ u: 1, y: 2 })
  })
})

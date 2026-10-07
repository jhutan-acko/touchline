import { describe, expect, it } from "vitest"
import { PITCH } from "../src/geometry.js"
import { anchorFor, FORMATIONS, kickoffAnchor } from "../src/shape.js"
import { STYLES } from "../src/testing.js"

describe("team shape", () => {
  it("every formation has 11 slots with the keeper first", () => {
    for (const f of Object.values(FORMATIONS)) {
      expect(f).toHaveLength(11)
      expect(f[0]!.role).toBe("GK")
    }
  })
  it("anchors stay inside the pitch for any ball position", () => {
    for (const bx of [-50, 0, 50]) for (const by of [-30, 0, 30]) for (let slot = 0; slot < 11; slot++) {
      const a = anchorFor("4-3-3", slot, "home", { x: bx, y: by }, STYLES.high_press, true)
      expect(Math.abs(a.x)).toBeLessThanOrEqual(PITCH.halfL)
      expect(Math.abs(a.y)).toBeLessThanOrEqual(PITCH.halfW)
    }
  })
  it("the away side mirrors the home side", () => {
    const h = anchorFor("4-4-2", 5, "home", { x: 10, y: 5 }, STYLES.direct, false)
    const a = anchorFor("4-4-2", 5, "away", { x: -10, y: -5 }, STYLES.direct, false)
    expect(a.x).toBeCloseTo(-h.x, 9)
    expect(a.y).toBeCloseTo(-h.y, 9)
  })
  it("a high-press back line sits higher than a low block's", () => {
    const line = (style: keyof typeof STYLES) => anchorFor("4-4-2", 2, "home", { x: 0, y: 0 }, STYLES[style], false).x
    expect(line("high_press")).toBeGreaterThan(line("low_block") + 10)
  })
  it("width stretches the shape fully in possession and partly without it; depth stretches the lines", () => {
    const wide = { width: 1.4, depth: 1 }
    const fb = (inPoss: boolean, spread = { width: 1, depth: 1 }) => anchorFor("4-3-3", 1, "home", { x: 0, y: 0 }, STYLES.possession, inPoss, spread)
    expect(Math.abs(fb(true, wide).y)).toBeGreaterThan(Math.abs(fb(true).y) * 1.35)
    expect(Math.abs(fb(false, wide).y)).toBeLessThan(Math.abs(fb(true, wide).y))
    const st = (depth: number) => anchorFor("4-3-3", 9, "home", { x: 0, y: 0 }, STYLES.possession, true, { width: 1, depth })
    const cb = (depth: number) => anchorFor("4-3-3", 2, "home", { x: 0, y: 0 }, STYLES.possession, true, { width: 1, depth })
    expect(st(1.3).x - cb(1.3).x).toBeGreaterThan(st(1).x - cb(1).x)
  })
  it("kickoff anchors are in the team's own half", () => {
    for (let slot = 0; slot < 11; slot++) {
      expect(kickoffAnchor("4-3-3", slot, "home", STYLES.high_press).x).toBeLessThan(0)
      expect(kickoffAnchor("4-3-3", slot, "away", STYLES.high_press).x).toBeGreaterThan(0)
    }
  })
  it("moves a team's shape without the ball by defLineM and defDepth, and leaves it alone with the ball", () => {
    const style = STYLES.possession
    const ball = { x: 0, y: 0 }
    const spread = (defLineM: number, defDepth: number) => ({ width: 1, depth: 1, defLineM, defDepth })
    // Centre back (slot 2): 10 m further upfield without the ball, mirrored for the away side.
    expect(anchorFor("4-3-3", 2, "home", ball, style, false, spread(10, 1)).x - anchorFor("4-3-3", 2, "home", ball, style, false).x).toBeCloseTo(10, 9)
    expect(anchorFor("4-3-3", 2, "away", ball, style, false, spread(10, 1)).x - anchorFor("4-3-3", 2, "away", ball, style, false).x).toBeCloseTo(-10, 9)
    // Striker (slot 9, x = 6): distance from the team centre (x = -18) halves without the ball: 24 m -> 12 m.
    expect(anchorFor("4-3-3", 9, "home", ball, style, false, spread(0, 0.5)).x - anchorFor("4-3-3", 9, "home", ball, style, false).x).toBeCloseTo(-12, 9)
    // With the ball nothing changes.
    expect(anchorFor("4-3-3", 2, "home", ball, style, true, spread(10, 0.5))).toEqual(anchorFor("4-3-3", 2, "home", ball, style, true))
  })
  it("drops forwards (ST, W, AM) back by fwdDropM without the ball only", () => {
    const style = STYLES.possession
    const ball = { x: 0, y: 0 }
    const drop = { width: 1, depth: 1, defLineM: 0, defDepth: 1, fwdDropM: 10 }
    // 4-3-3: slot 9 is the striker, slot 8 a winger, slot 2 a centre back.
    expect(anchorFor("4-3-3", 9, "home", ball, style, false, drop).x - anchorFor("4-3-3", 9, "home", ball, style, false).x).toBeCloseTo(-10, 9)
    expect(anchorFor("4-3-3", 8, "home", ball, style, false, drop).x - anchorFor("4-3-3", 8, "home", ball, style, false).x).toBeCloseTo(-10, 9)
    expect(anchorFor("4-3-3", 9, "away", ball, style, false, drop).x - anchorFor("4-3-3", 9, "away", ball, style, false).x).toBeCloseTo(10, 9)
    expect(anchorFor("4-3-3", 2, "home", ball, style, false, drop)).toEqual(anchorFor("4-3-3", 2, "home", ball, style, false))
    expect(anchorFor("4-3-3", 9, "home", ball, style, true, drop)).toEqual(anchorFor("4-3-3", 9, "home", ball, style, true))
  })
})

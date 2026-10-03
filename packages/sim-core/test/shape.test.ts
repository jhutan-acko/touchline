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
  it("kickoff anchors are in the team's own half", () => {
    for (let slot = 0; slot < 11; slot++) {
      expect(kickoffAnchor("4-3-3", slot, "home", STYLES.high_press).x).toBeLessThan(0)
      expect(kickoffAnchor("4-3-3", slot, "away", STYLES.high_press).x).toBeGreaterThan(0)
    }
  })
})

import { describe, expect, it } from "vitest"
import { classifyPass } from "../src/classify.js"
import { actionZone, attackX, goalAngle, zoneIndex } from "../src/geometry.js"
import { DEFAULT_PARAMS } from "../src/params.js"

const T = DEFAULT_PARAMS.classifier
const C = (from: [number, number], to: [number, number], height: "ground" | "high" = "ground", lastDef = 30, side: "home" | "away" = "home") =>
  classifyPass({ side, from: { x: from[0], y: from[1] }, to: { x: to[0], y: to[1] }, height, lastDefenderAttackX: lastDef }, T)

describe("geometry", () => {
  it("indexes the 16x12 grid from the bottom-left corner", () => {
    expect(zoneIndex({ x: -52.5, y: -34 })).toBe(0)
    expect(zoneIndex({ x: 52.5, y: 34 })).toBe(16 * 12 - 1)
  })
  it("mirrors attack direction for the away side", () => {
    expect(attackX("home", 30)).toBe(30)
    expect(attackX("away", 30)).toBe(-30)
    expect(actionZone("away", { x: -45, y: 0 })).toBe("box")
  })
  it("goal angle shrinks with distance", () => {
    expect(goalAngle("home", { x: 41.5, y: 0 })).toBeGreaterThan(goalAngle("home", { x: 22.5, y: 0 }))
  })
})

describe("classifyPass", () => {
  it("short and long by length", () => {
    expect(C([0, 0], [15, 5])).toBe("short")
    expect(C([-30, 0], [5, 3])).toBe("long")
  })
  it("through ball beyond the last defender, lofted when high", () => {
    expect(C([10, 0], [36, 2], "ground", 30)).toBe("through")
    expect(C([10, 0], [36, 2], "high", 30)).toBe("lofted_through")
  })
  it("switch crosses the centreline laterally", () => {
    expect(C([0, -20], [8, 12])).toBe("switch")
  })
  it("cross from wide into the box", () => {
    expect(C([40, -28], [47, 2], "high", 50)).toBe("cross")
  })
  it("cutback from the byline back to the spot area", () => {
    expect(C([49, -12], [43, -2], "ground", 52)).toBe("cutback")
  })
  it("back pass", () => {
    expect(C([0, 0], [-12, 2])).toBe("back")
  })
  it("is symmetric for the away side", () => {
    expect(C([-10, 0], [-36, 2], "ground", 30, "away")).toBe("through")
  })
})

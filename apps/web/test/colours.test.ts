import { describe, expect, it } from "vitest"
import { deltaE, FALLBACKS, GRASS, inkOn, MIN_BETWEEN, MIN_FROM_GRASS, teamColours, withTeamColours } from "../src/colours.js"
import { MATCH } from "./fake-client.js"

const kit = (primary: string, secondary = "#ffffff") => ({ primary, secondary })
const offGrass = (c: string) => GRASS.every((g) => deltaE(c, g) >= MIN_FROM_GRASS)

describe("team colours", () => {
  it("keeps two kits that already stand apart from each other and the grass", () => {
    expect(teamColours(kit("#1d4ed8"), kit("#dc2626"))).toEqual({ home: "#1d4ed8", away: "#dc2626" })
  })

  it("gives the away side its secondary colour when its primary is a near-identical blue", () => {
    // Ironmoor Athletic at home v Kestrel Bay FC away, from the league: two blues.
    const c = teamColours(kit("#422dd9", "#bbb790"), kit("#6c76e7", "#ff8800"))
    expect(c).toEqual({ home: "#422dd9", away: "#ff8800" })
    expect(deltaE(c.home, c.away)).toBeGreaterThanOrEqual(MIN_BETWEEN)
  })

  it("falls back to a contrasting colour when both of the away kit's colours clash", () => {
    const c = teamColours(kit("#422dd9", "#ffffff"), kit("#4a35e0", "#2f7d43"))
    expect(c.home).toBe("#422dd9")
    expect(FALLBACKS as ReadonlyArray<string>).toContain(c.away)
    expect(deltaE(c.home, c.away)).toBeGreaterThanOrEqual(MIN_BETWEEN)
    expect(offGrass(c.away)).toBe(true)
  })

  it("never puts a side in pitch green, however light or dark the green", () => {
    for (const green of ["#2a723c", "#56d117", "#238614", "#3a7f61"]) {
      const c = teamColours(kit(green, "#4d3882"), kit(green, "#a9e337"))
      expect(c.home).toBe("#4d3882")
      expect(offGrass(c.away)).toBe(true)
      expect(deltaE(c.home, c.away)).toBeGreaterThanOrEqual(MIN_BETWEEN)
    }
  })

  it("copes with colours that are not hex", () => {
    const c = teamColours(kit("navy", "nope"), kit("red", "#zzz"))
    expect(c.home).toBe(FALLBACKS[0])
    expect(deltaE(c.home, c.away)).toBeGreaterThanOrEqual(MIN_BETWEEN)
  })

  it("keeps every pairing in the league distinct (the kits as the API sends them: home side's home kit, away side's away kit)", async () => {
    const { readFileSync } = await import("node:fs")
    const { resolve } = await import("node:path")
    const league = JSON.parse(readFileSync(resolve(process.cwd(), "../../data/league/league.json"), "utf8")) as { clubs: ReadonlyArray<{ kits: Record<"home" | "away", { primary: string; secondary: string }> }> }
    for (const h of league.clubs) for (const a of league.clubs) {
      if (h === a) continue
      const c = teamColours(h.kits.home, a.kits.away)
      expect(offGrass(c.home) && offGrass(c.away)).toBe(true)
      expect(deltaE(c.home, c.away)).toBeGreaterThanOrEqual(MIN_BETWEEN)
    }
  })

  it("writes shirt numbers in whichever of black or white reads on the kit", () => {
    expect(inkOn("#ffffff")).not.toBe("#ffffff")
    expect(inkOn("#f59e0b")).not.toBe("#ffffff")
    expect(inkOn("#1d4ed8")).toBe("#ffffff")
    expect(inkOn("#111827")).toBe("#ffffff")
  })

  it("rewrites a match's kit primaries only when it has to", () => {
    expect(withTeamColours(MATCH)).toBe(MATCH)
    const clash = { ...MATCH, away: { ...MATCH.away, kit: { primary: "#1e50dd", secondary: "#facc15" } } }
    const fixed = withTeamColours(clash)
    expect(fixed.away.kit).toEqual({ primary: "#facc15", secondary: "#facc15" })
    expect(fixed.home).toBe(clash.home)
  })
})

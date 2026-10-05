import { existsSync, readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "vitest"
import { contrast, generateLeague, nameHash, type League } from "../src/league.js"

describe("league", () => {
  const L = generateLeague(2026, new Set())
  it("is deterministic", () => expect(JSON.stringify(generateLeague(2026, new Set()))).toBe(JSON.stringify(L)))
  it("has 8 clubs covering all four archetypes", () => {
    expect(L.clubs).toHaveLength(8)
    expect(new Set(L.clubs.map((c) => c.style.archetype)).size).toBe(4)
  })
  it("gives each club 20 players with unique shirt numbers and 11 starters led by a keeper", () => {
    for (const c of L.clubs) {
      expect(c.squad).toHaveLength(20)
      expect(new Set(c.squad.map((p) => p.jersey)).size).toBe(20)
      expect(c.starters).toHaveLength(11)
      expect(c.starters[0]!.role).toBe("GK")
    }
  })
  it("uses readable kits (contrast >= 3 between primary and secondary)", () => {
    for (const c of L.clubs) expect(contrast(c.kits.home.primary, c.kits.home.secondary)).toBeGreaterThanOrEqual(3)
  })
  it("never uses a blocked name", () => {
    const victim = L.clubs[0]!.squad[0]!.name
    const L2 = generateLeague(2026, new Set([nameHash(victim)]))
    expect(L2.clubs.flatMap((c) => c.squad.map((p) => p.name))).not.toContain(victim)
  })
  it("player names are unique across the league", () => {
    const names = L.clubs.flatMap((c) => c.squad.map((p) => p.name))
    expect(new Set(names).size).toBe(names.length)
  })
  it("the committed league uses no name on the committed real-player blocklist", () => {
    const root = join(dirname(fileURLToPath(import.meta.url)), "../../..")
    const file = join(root, "data/blocklist/real-player-name-hashes.txt")
    expect(existsSync(file)).toBe(true)
    const blocked = new Set(readFileSync(file, "utf8").split("\n").filter(Boolean))
    expect(blocked.size).toBeGreaterThan(10_000)
    const league = JSON.parse(readFileSync(join(root, "data/league/league.json"), "utf8")) as League
    for (const c of league.clubs) for (const p of c.squad) expect(blocked.has(nameHash(p.name)), p.name).toBe(false)
  })
})

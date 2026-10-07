import { mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { beforeAll, describe, expect, it } from "vitest"
import { pickCues, preference } from "../src/cues.js"
import { readMatch, scanLibrary } from "../src/library.js"
import { league, makeLibrary, MATCH_ID, type TestLibrary } from "./fixture.js"

let lib: TestLibrary
beforeAll(async () => {
  lib = await makeLibrary()
}, 120_000)

describe("library", () => {
  it("lists run folders with teams, kits, score and the segments the cue cache covers", () => {
    mkdirSync(join(lib.dir, "not-a-run"))
    writeFileSync(join(lib.dir, "notes.txt"), "x")
    const matches = scanLibrary(lib.dir, league)
    expect([...matches.keys()]).toEqual([MATCH_ID])
    const m = matches.get(MATCH_ID)!.info
    expect(m.home).toMatchObject({ id: "northwick", side: "home" })
    expect(m.home.kit.primary).toMatch(/^#[0-9a-f]{6}$/)
    expect(m.score.home + m.score.away).toBeGreaterThan(0)
    expect(m.segments).toEqual(["analyst.es.neutral", "casual.en.neutral", "casual.en.northwick"])
    expect(m.model).toBe("stub")
    expect(m.players.length).toBeGreaterThanOrEqual(40)
  })

  it("plays a match without a cue cache with stats only", () => {
    const bare = join(lib.dir, "..", "bare-copy")
    mkdirSync(bare, { recursive: true })
    for (const f of ["manifest.json", "tracking.jsonl"]) writeFileSync(join(bare, f), readFileSync(join(lib.run, f)))
    const m = readMatch(bare, league)
    expect(m.cues).toEqual([])
    expect(m.info.segments).toEqual([])
    expect(m.info.model).toBeNull()
  })
})

describe("cue selection", () => {
  it("prefers the exact segment, then neutral, then English, never another club's framing", () => {
    expect(preference({ mode: "casual", lang: "hi", club: "larkspur" })).toEqual(["casual.hi.larkspur", "casual.hi.neutral", "casual.en.larkspur", "casual.en.neutral"])
    const home = pickCues(lib.cues, { mode: "casual", lang: "en", club: "northwick" })
    // The two goals in the home fan's framing, the half-time card between them neutral (the only variant it has).
    expect(home.map((c) => [c.display.template, c.segment.club])).toEqual([["goal", "northwick"], ["recap", null], ["goal", "northwick"]])
    const away = pickCues(lib.cues, { mode: "casual", lang: "en", club: "larkspur" })
    expect(away.every((c) => c.segment.club === null)).toBe(true)
    const hindi = pickCues(lib.cues, { mode: "analyst", lang: "hi", club: null })
    expect(hindi).toEqual([]) // no analyst variant in Hindi or English: nothing rather than the wrong mode
    expect(pickCues(lib.cues, { mode: "analyst", lang: "es", club: null }).map((c) => c.segment.lang)).toEqual(["es", "es"])
  })

  it("orders cues by the frame they end on", () => {
    const frames = pickCues(lib.cues, { mode: "casual", lang: "en", club: null }).map((c) => c.anchor.frame_to)
    expect(frames).toEqual([...frames].sort((a, b) => a - b))
  })
})

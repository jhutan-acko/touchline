import { readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"
import type { Tick } from "@touchline/rpc"
import type { Cue } from "@touchline/schema"
import { STRINGS, t, type Key } from "../src/i18n.js"
import { EMPTY, FEED_SIZE, inSlot, reduce } from "../src/pane.js"
import { presetProfile, PRESETS, segmentOf } from "../src/profile.js"

const cue = (JSON.parse(readFileSync(join(import.meta.dirname, "../../../packages/schema/fixtures/agents/valid/cue.json"), "utf8")) as { value: Cue }).value

describe("strings", () => {
  it("exist in every language, Hindi in Devanagari", () => {
    const keys = Object.keys(STRINGS.en) as Key[]
    for (const lang of ["es", "hi"] as const) {
      expect(Object.keys(STRINGS[lang]).sort()).toEqual([...keys].sort())
      for (const k of keys) expect(t(lang, k).trim(), `${lang}.${k}`).not.toBe("")
    }
    for (const k of keys.filter((k) => !["title"].includes(k))) expect(t("hi", k), k).toMatch(/[ऀ-ॿ]/)
  })
})

describe("profiles", () => {
  it("collapse to a segment, the first club framing the text", () => {
    expect(segmentOf({ mode: "analyst", lang: "hi", clubs: [] })).toEqual({ mode: "analyst", lang: "hi", club: null })
    expect(segmentOf({ mode: "casual", lang: "es", clubs: ["larkspur", "northwick"] })).toEqual({ mode: "casual", lang: "es", club: "larkspur" })
    expect(presetProfile("home-fan-en", "northwick", "larkspur").clubs).toEqual(["northwick"])
    expect(new Set(PRESETS.map((p) => p.id)).size).toBe(PRESETS.length)
  })
})

describe("pane", () => {
  const board: Cue = { ...cue, cue_id: "b1", moment_id: null, text: null, display: { ...cue.display, slot: "top_bar", ttl_ms: 2000 }, data: { "score.home": 2, "score.away": 1, "team.mom.home": 0.6, "team.mom.away": 0.4 } }
  const tick = (c: Cue): Tick => ({ kind: "cue", cue: c })

  it("keeps the latest frame, playback state and scoreboard", () => {
    let s = reduce(EMPTY, { kind: "playback", playback: { state: "playing", frame: 0, speed: 4, live: false } }, 0)
    s = reduce(s, { kind: "frame", frame: { frame: 7, period: "first_half", clock: "00:00.70", ball: { x: 0, y: 0, z: 0 }, home: [], away: [] } }, 0)
    s = reduce(s, tick(board), 0)
    expect(s.frame?.frame).toBe(7)
    expect(s.playback?.speed).toBe(4)
    expect(s.board).toEqual({ score: { home: 2, away: 1 }, clock: board.anchor.clock, momentum: { home: 0.6, away: 0.4 } })
    expect(s.feed).toEqual([]) // the scoreboard is not an agent cue
  })

  it("shows a cue in its slot until its ttl runs out, a newer one in the slot replacing it", () => {
    let s = reduce(EMPTY, tick(cue), 1000)
    expect(inSlot(s, "lower_third", 1000 + cue.display.ttl_ms - 1)?.cue_id).toBe(cue.cue_id)
    expect(inSlot(s, "lower_third", 1000 + cue.display.ttl_ms)).toBeNull()
    s = reduce(s, tick({ ...cue, cue_id: "next" }), 2000)
    expect(inSlot(s, "lower_third", 2001)?.cue_id).toBe("next")
    expect(s.feed.map((c) => c.cue_id)).toEqual(["next", cue.cue_id])
  })

  it("keeps a bounded feed", () => {
    let s = EMPTY
    for (let i = 0; i < FEED_SIZE + 10; i++) s = reduce(s, tick({ ...cue, cue_id: `c${i}` }), i)
    expect(s.feed).toHaveLength(FEED_SIZE)
    expect(s.feed[0]!.cue_id).toBe(`c${FEED_SIZE + 9}`)
  })
})

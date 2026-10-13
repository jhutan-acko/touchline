import { mkdtempSync, readFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { Effect } from "effect"
import { describe, expect, it } from "vitest"
import type { DomainEvent } from "@touchline/sim-core"
import { makeConfig } from "@touchline/sim-core/testing"
import { SPADL_ACTIONTYPES, SPADL_BODYPARTS, SPADL_RESULTS, spadlActions, spadlCsv } from "../src/spadl.js"
import { writeMatch } from "../src/writer.js"

const cfg = makeConfig(1)
const H = cfg.home.id, A = cfg.away.id
let seq = 0
const ev = (type: DomainEvent["type"], team: string, attrs: Record<string, unknown> = {}, extra: Partial<DomainEvent> = {}): DomainEvent => ({
  id: `m-e${++seq}`, match_id: "m", type, frame_id: 100 + seq, period_frame_id: 100 + seq, period: "first_half", match_clock: "00:10.00",
  team_id: team, player_id: `${team}-07`, x: 0, y: 0, x_end: 10, y_end: 5, frame_id_end: null, outcome: null, source: "sim", confidence: 1,
  attrs: attrs as DomainEvent["attrs"], ...extra
})
const one = (e: DomainEvent) => spadlActions([e], cfg)[0]!

describe("SPADL view", () => {
  it("uses SPADL's coordinates (0..105 x 0..68) in socceraction's stored frame: home attacks left to right, the away team is not flipped", () => {
    // socceraction's converters store actions this way; its play_left_to_right() flips the away team for analysis.
    const home = one(ev("pass", H, { kind: "short" }, { outcome: "successful" }))
    expect([home.start_x, home.start_y, home.end_x, home.end_y]).toEqual([52.5, 34, 62.5, 39])
    const away = one(ev("pass", A, { kind: "short" }, { outcome: "successful" }))
    expect([away.start_x, away.start_y, away.end_x, away.end_y]).toEqual([52.5, 34, 62.5, 39])
  })
  it("rotates second-half events back into the stored frame (home still left to right)", () => {
    const home = one({ ...ev("pass", H, { kind: "short" }, { outcome: "successful" }), period: "second_half", x: 0, y: 0, x_end: 10, y_end: 5 })
    expect([home.start_x, home.start_y, home.end_x, home.end_y]).toEqual([52.5, 34, 42.5, 29])
  })
  it("maps passes by kind and restart, and their results", () => {
    const t = (attrs: Record<string, unknown>, outcome = "successful") => one(ev("pass", H, attrs, { outcome }))
    expect(t({ kind: "cross" }).type_name).toBe("cross")
    expect(t({ kind: "set_piece", restart: "throw_in" }).type_name).toBe("throw_in")
    expect(t({ kind: "set_piece", restart: "corner", height: "high" }).type_name).toBe("corner_crossed")
    expect(t({ kind: "set_piece", restart: "corner", height: "ground" }).type_name).toBe("corner_short")
    expect(t({ kind: "set_piece", restart: "free_kick", height: "high" }).type_name).toBe("freekick_crossed")
    expect(t({ kind: "set_piece", restart: "goal_kick" }).type_name).toBe("goalkick")
    expect(t({ kind: "long" }, "intercepted").result_name).toBe("fail")
    expect(t({ kind: "through" }, "offside").result_name).toBe("offside")
  })
  it("maps shots, carries, duels, keeper actions, clearances and bad touches", () => {
    expect(one(ev("shot", H, { technique: "penalty" }, { outcome: "goal" }))).toMatchObject({ type_name: "shot_penalty", result_name: "success" })
    expect(one(ev("shot", H, { technique: "free_kick" }, { outcome: "saved" }))).toMatchObject({ type_name: "shot_freekick", result_name: "fail" })
    expect(one(ev("carry", H))).toMatchObject({ type_name: "dribble", result_name: "success" })
    expect(one(ev("take_on", H, { outcome: "lost" }, { outcome: "lost" }))).toMatchObject({ type_name: "take_on", result_name: "fail" })
    expect(one(ev("keeper_claim", H, { handling: "fumble" }))).toMatchObject({ type_name: "keeper_claim", result_name: "fail" })
    expect(one(ev("keeper_punch", H))).toMatchObject({ type_name: "keeper_punch", result_name: "success" })
    expect(one(ev("clearance", H, { technique: "head", body_part: "head" }))).toMatchObject({ type_name: "clearance", bodypart_name: "head" })
    expect(one(ev("reception", H, { first_touch: "heavy" }))).toMatchObject({ type_name: "bad_touch", result_name: "fail" })
    expect(spadlActions([ev("reception", H, { first_touch: "controlled" }), ev("pressure", A)], cfg)).toEqual([])
  })
  it("gives a booked foul the card as its result", () => {
    const foul = ev("foul", A)
    const card = { ...ev("card", A, { colour: "second_yellow" }), frame_id: foul.frame_id, player_id: foul.player_id }
    expect(spadlActions([foul, card], cfg)[0]).toMatchObject({ type_name: "foul", result_name: "red_card" })
  })
  it("uses the preferred-foot body parts", () => {
    expect(one(ev("pass", H, { kind: "short", body_part: "left_foot" }, { outcome: "successful" })).bodypart_name).toBe("foot_left")
    expect(one(ev("pass", H, { kind: "set_piece", restart: "throw_in", body_part: "hands" }, { outcome: "successful" })).bodypart_name).toBe("other")
  })
})

describe("spadl.csv in a match folder", () => {
  it("has SPADL's columns, valid ids and coordinates, in time order per period", async () => {
    const dir = mkdtempSync(join(tmpdir(), "touchline-spadl-"))
    const m = await Effect.runPromise(writeMatch(makeConfig(2), dir))
    expect(Object.keys(m.outputs)).toContain("spadl.csv")
    const [header, ...rows] = readFileSync(join(dir, "spadl.csv"), "utf8").trim().split("\n")
    expect(header).toBe("game_id,original_event_id,action_id,period_id,time_seconds,team_id,player_id,start_x,start_y,end_x,end_y,type_id,type_name,result_id,result_name,bodypart_id,bodypart_name")
    expect(rows.length).toBeGreaterThan(800)
    let last = { period: 1, t: 0 }
    rows.forEach((line, i) => {
      const c = line.split(",")
      expect(Number(c[2])).toBe(i)
      const [sx, sy, ex, ey] = [7, 8, 9, 10].map((k) => Number(c[k]))
      for (const v of [sx, ex]) expect(v).toBeGreaterThanOrEqual(0), expect(v).toBeLessThanOrEqual(105)
      for (const v of [sy, ey]) expect(v).toBeGreaterThanOrEqual(0), expect(v).toBeLessThanOrEqual(68)
      expect(SPADL_ACTIONTYPES[Number(c[11])]).toBe(c[12])
      expect(SPADL_RESULTS[Number(c[13])]).toBe(c[14])
      expect(SPADL_BODYPARTS[Number(c[15])]).toBe(c[16])
      const period = Number(c[3]), t = Number(c[4])
      if (period === last.period) expect(t).toBeGreaterThanOrEqual(last.t)
      last = { period, t }
    })
    expect(spadlCsv([], cfg).trim()).toBe(header)
  })
})

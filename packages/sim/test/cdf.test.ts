import { describe, expect, it } from "vitest"
import { initMatch, isFinished, step, type DomainEvent, type Frame } from "@touchline/sim-core"
import { makeConfig } from "@touchline/sim-core/testing"
import { cdfEventLine, cdfMeta, cdfTrackingLine, cdfTypeOf, periodsFromFrames, REFEREE_ID } from "../src/cdf.js"

const cfg = makeConfig(8)
let s = initMatch(cfg)
const frames: Frame[] = []
const events: DomainEvent[] = []
while (!isFinished(s)) {
  const r = step(s)
  s = r.state
  if (r.frame) frames.push(r.frame)
  events.push(...r.events)
}
const clock = (t: number) => frames.find((f) => f.tick === t)?.timestamp ?? frames.at(-1)!.timestamp
const start = (p: string) => frames.find((f) => f.period === p && f.frame_id === 0)!.tick

describe("CDF export", () => {
  it("meta declares 10 fps, CDF 0.3.2, two periods starting at frame 0", () => {
    const m = cdfMeta(cfg, periodsFromFrames(frames))
    expect(m.meta.tracking.fps).toBe(10)
    expect(m.meta.cdf.version).toBe("0.3.2")
    expect(m.match.periods.map((p) => p.frame_id_start)).toEqual([0, 0])
  })
  it("meta swaps the sides in the second period (teams switch ends)", () => {
    const [first, second] = cdfMeta(cfg, periodsFromFrames(frames)).match.periods
    expect(first).toMatchObject({ period: "first_half", play_direction: "left_right", left_team_id: cfg.home.id, right_team_id: cfg.away.id })
    expect(second).toMatchObject({ period: "second_half", play_direction: "right_left", left_team_id: cfg.away.id, right_team_id: cfg.home.id })
  })
  it("tracking lines carry only schema keys", () => {
    const line = JSON.parse(cdfTrackingLine(cfg.matchId, cfg, frames[100]!))
    expect(Object.keys(line).sort()).toEqual(["ball", "frame_id", "match", "period", "teams", "timestamp"])
    expect(line.teams.home.players.length).toBe(11)
    expect(Object.keys(line.teams.home.players[0]).sort()).toEqual(["id", "vel", "x", "y"])
  })
  it("referee events use official_id and no player or team", () => {
    const foul = events.find((e) => e.type === "foul")!
    const line = JSON.parse(cdfEventLine(cfg, foul, clock, start, null)!)
    expect(line.event.type).toBe("referee")
    expect(line.event.official_id).toBe(REFEREE_ID)
    expect(line.event.player_id).toBeUndefined()
  })
  it("does not export reception, possession_change or off_ball_run, and maps passes and shots", () => {
    expect(cdfTypeOf(events.find((e) => e.type === "reception")!)).toBeNull()
    expect(cdfTypeOf(events.find((e) => e.type === "off_ball_run")!)).toBeNull()
    expect(cdfTypeOf(events.find((e) => e.type === "pass")!)!.type).toBe("pass")
    expect(cdfTypeOf(events.find((e) => e.type === "shot")!)!.type).toBe("shot")
  })
  it("exports goals that did not come from a shot (loose balls, passes into the net) as CDF shots", () => {
    const base = events.find((e) => e.type === "pass")!
    const own = { ...base, type: "goal" as const, outcome: null, attrs: { scorer_id: base.player_id, own_goal: true, from: "loose_ball" } }
    const rebound = { ...own, attrs: { ...own.attrs, own_goal: false } }
    expect(cdfTypeOf(own)).toEqual({ type: "shot", sub_type: null, outcome_type: "own_goal", is_successful: true })
    expect(cdfTypeOf(rebound)!.outcome_type).toBe("successful")
    const fromShot = { ...own, attrs: { scorer_id: base.player_id, own_goal: false } }
    expect(cdfTypeOf(fromShot)).toBeNull()
  })
  it("meta lists substitutes as non-starters, and substitutions export as referee events", () => {
    const m = cdfMeta(cfg, periodsFromFrames(frames))
    const home = m.teams.home.players
    expect(home.filter((p) => p.is_starter)).toHaveLength(11)
    expect(home.filter((p) => !p.is_starter).map((p) => p.id)).toEqual(cfg.home.bench!.map((p) => p.id))
    const sub = events.find((e) => e.type === "substitution")!
    const line = JSON.parse(cdfEventLine(cfg, sub, clock, start, null)!)
    expect(line.event).toMatchObject({ type: "referee", sub_type: "substitution", official_id: REFEREE_ID })
    expect(line.event.player_id).toBeUndefined()
  })
  it("maps keeper claims and punches to goalkeeping events, and headed clearances keep the head as body part", () => {
    const base = events.find((e) => e.type === "pass")!
    expect(cdfTypeOf({ ...base, type: "keeper_claim", attrs: { from: "cross", handling: "clean" } })).toEqual({ type: "goalkeeping", sub_type: "claim", outcome_type: "claim", is_successful: true })
    expect(cdfTypeOf({ ...base, type: "keeper_claim", attrs: { from: "cross", handling: "fumble" } })!.is_successful).toBe(false)
    expect(cdfTypeOf({ ...base, type: "keeper_punch", attrs: { from: "corner" } })).toEqual({ type: "goalkeeping", sub_type: "punch", outcome_type: "punch", is_successful: true })
    const header = { ...base, type: "clearance" as const, attrs: { technique: "head", body_part: "head" } }
    expect(JSON.parse(cdfEventLine(cfg, header, clock, start, null)!).event.body_part).toBe("head")
  })
  it("event tracking frame ids are period-relative", () => {
    const pass = events.find((e) => e.type === "pass" && e.period === "second_half")!
    const line = JSON.parse(cdfEventLine(cfg, pass, clock, start, pass.frame_id_end)!)
    expect(line.tracking.frame_id).toBe(pass.frame_id - start("second_half"))
  })
})

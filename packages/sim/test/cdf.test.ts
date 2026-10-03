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
  it("event tracking frame ids are period-relative", () => {
    const pass = events.find((e) => e.type === "pass" && e.period === "second_half")!
    const line = JSON.parse(cdfEventLine(cfg, pass, clock, start, pass.frame_id_end)!)
    expect(line.tracking.frame_id).toBe(pass.frame_id - start("second_half"))
  })
})

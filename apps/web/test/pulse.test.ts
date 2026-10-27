import { describe, expect, it } from "vitest"
import type { PitchFrame, Tick } from "@touchline/rpc"
import type { Cue } from "@touchline/schema"
import { CHAOS_MIN, CONTROL_MAX, EMPTY_PULSE, actionFor, axisMax, classify, holderOf, inRing, kindOf, minuteAt, minuteOf, momentumSeries, moments, pulseReduce, rhythmOf, view, type Change, type PulseLog } from "../src/pulse.js"

const FPS = 10
const frame = (n: number, clock: string, ball = { x: 0, y: 0, z: 0 }, home = [{ id: "h1", x: 0, y: 1 }], away = [{ id: "a1", x: 30, y: 0 }]): Tick => ({
  kind: "frame", frame: { frame: n, period: "first_half", clock, ball, home, away } as PitchFrame
})
const board = (n: number, clock: string, home: number, away: number, mh = 0.6, ma = 0.4): Tick => ({
  kind: "cue",
  cue: {
    cue_id: `b-${n}`, schema: "touchline.cue/1", match_id: "m", moment_id: null, anchor: { frame_from: n, frame_to: n, clock },
    display: { slot: "top_bar", priority: 3, ttl_ms: 2000, template: "scoreboard" }, segment: { mode: "casual", lang: "en", club: null }, text: null,
    data: { "score.home": home, "score.away": away, "team.mom.home": mh, "team.mom.away": ma }, evidence: [], verified: true
  }
})
const agentCue = (id: string, template: string, n: number, clock: string): Tick => ({
  kind: "cue",
  cue: {
    cue_id: id, schema: "touchline.cue/1", match_id: "m", moment_id: id, anchor: { frame_from: n - 5, frame_to: n, clock },
    display: { slot: "lower_third", priority: 2, ttl_ms: 8000, template }, segment: { mode: "casual", lang: "en", club: null },
    text: { headline: `${template}!`, body: "b" }, data: {}, evidence: [], verified: true
  } as Cue
})
const run = (ticks: Tick[], from: PulseLog = EMPTY_PULSE) => ticks.reduce((l, t) => pulseReduce(l, t, FPS), from)

describe("clock and possession", () => {
  it("reads minutes from a clock", () => {
    expect(minuteOf("67:30")).toBe(67.5)
    expect(minuteOf("10:00.00")).toBe(10)
    expect(minuteOf("soon")).toBeNull()
  })
  it("gives the ball to the nearest side within reach, to nobody when loose or in the air", () => {
    const f = (frame(1, "1:00", { x: 0, y: 0, z: 0 }).kind === "frame" ? (frame(1, "1:00") as { frame: PitchFrame }).frame : null)!
    expect(holderOf(f)).toBe("home")
    expect(holderOf({ ...f, ball: { x: 15, y: 0, z: 0 } })).toBeNull()
    expect(holderOf({ ...f, ball: { x: 0, y: 0, z: 9 } })).toBeNull()
    expect(holderOf({ ...f, ball: { x: 30, y: 1, z: 0 } })).toBe("away")
  })
})

describe("the log", () => {
  it("records a turnover only when the other side keeps the ball for a couple of seconds, not for the first holder, a flicker or a loose ball", () => {
    const at = (n: number, ball: { x: number; y: number; z: number }) => frame(n, `1:${String(Math.floor(n / FPS)).padStart(2, "0")}`, ball)
    const home = { x: 0, y: 0, z: 0 }
    const away = { x: 30, y: 0, z: 0 }
    const l = run([
      at(0, home), // the first holder: no turnover
      at(5, away), at(10, home), // a flicker: the other side had it for 0.5 s only
      at(15, { x: 15, y: 0, z: 0 }), // loose
      ...[20, 25, 30, 35, 40, 45].map((n) => at(n, away)), // away holds on from frame 20: a turnover at 20, confirmed at 40
      ...[50, 60, 70].map((n) => at(n, home)) // home again from 50, confirmed at 70
    ])
    expect(l.changes.map((c) => [c.frame, c.team])).toEqual([[20, "away"], [50, "home"]])
    expect(l.cursor?.frame).toBe(70)
    expect(l.firstMin).toBe(1)
  })
  it("samples momentum every few seconds and spots goals from the score going up", () => {
    const l = run([board(0, "0:00", 0, 0), board(10, "0:01", 0, 0), board(50, "0:05", 0, 0), board(600, "1:00", 1, 0), board(1200, "2:00", 1, 1)])
    expect(l.samples.map((s) => s.frame)).toEqual([0, 50, 600, 1200])
    expect(l.goals.map((g) => [g.team, g.score])).toEqual([["home", { home: 1, away: 0 }], ["away", { home: 1, away: 1 }]])
  })
  it("does not count the first reading as a goal (a match watched from the 60th minute)", () => {
    expect(run([board(0, "60:00", 2, 1)]).goals).toEqual([])
  })
  it("drops what came after a seek back", () => {
    const l = run([board(100, "10:00", 0, 0), board(700, "11:00", 1, 0), frame(700, "11:00"), frame(300, "5:00")])
    expect(l.goals).toEqual([])
    expect(l.samples.map((s) => s.frame)).toEqual([100])
  })
  it("keeps agent cues, but not pitch markers", () => {
    const marker = agentCue("pm", "ghost", 40, "3:00")
    if (marker.kind === "cue") (marker.cue.display as { slot: string }).slot = "pitch_marker"
    const l = run([frame(40, "3:00"), agentCue("c1", "big_chance", 40, "3:00"), marker])
    expect(l.cues.map((c) => c.cue.cue_id)).toEqual(["c1"])
    expect(l.cues[0]!.arrivedAt).toBe(40)
  })
})

describe("spoiler cut-off", () => {
  const full = run([
    frame(100, "10:00"), board(100, "10:00", 0, 0), agentCue("early", "big_chance", 100, "10:00"),
    frame(500, "50:00"), board(500, "50:00", 1, 0), agentCue("late", "momentum_swing", 500, "50:00"),
    frame(900, "80:00"), board(900, "80:00", 2, 0)
  ])
  it("shows nothing after the frame viewed", () => {
    const v = view(full, 300)
    expect(v.goals).toEqual([])
    expect(v.samples.map((s) => s.frame)).toEqual([100])
    expect(v.cues.map((c) => c.cue.cue_id)).toEqual(["early"])
    expect(moments(v, "analyst").map((m) => m.id)).toEqual(["early"])
  })
  it("hides a cue that arrived after the frozen frame even when it is anchored before it", () => {
    const l = run([frame(500, "50:00"), agentCue("belated", "goal", 100, "10:00")])
    expect(view(l, 300).cues).toEqual([])
    expect(view(l, 500).cues.map((c) => c.cue.cue_id)).toEqual(["belated"])
  })
  it("reads the frozen minute from the readings, not from the newest frame", () => {
    expect(minuteAt(full, 300, FPS)).toBeCloseTo(10 + 200 / FPS / 60)
    expect(minuteAt(full, 900, FPS)).toBe(80)
  })
  it("keeps the axis at 90 minutes, longer in stoppage time", () => {
    expect(axisMax(30)).toBe(90)
    expect(axisMax(93.2)).toBe(94)
  })
})

describe("momentum series", () => {
  it("is home minus away, skipping readings without momentum", () => {
    const pts = momentumSeries([{ frame: 0, min: 1, home: 0.7, away: 0.3 }, { frame: 1, min: 2, home: null, away: null }, { frame: 2, min: 3, home: 0.2, away: 0.8 }])
    expect(pts.map((p) => [p.min, Math.round(p.net * 10) / 10])).toEqual([[1, 0.4], [3, -0.6]])
  })
})

describe("control versus chaos", () => {
  const ch = (...mins: number[]): Change[] => mins.map((min, i) => ({ frame: i, min, team: i % 2 ? "home" : "away" }))
  it("rates a window by turnovers a minute", () => {
    expect(rhythmOf(CONTROL_MAX)).toBe("control")
    expect(rhythmOf(CONTROL_MAX + 1)).toBe("mixed")
    expect(rhythmOf(CHAOS_MIN)).toBe("chaos")
  })
  it("classifies each minute: long spells are control, rapid turnovers chaos", () => {
    const bins = classify(ch(0.1, 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 1.7), 0, 3)
    expect(bins.map((b) => [b.turnovers, b.state])).toEqual([[1, "control"], [7, "chaos"], [0, "control"]])
  })
  it("leaves minutes before the first frame watched unjudged, and scales a part-watched minute", () => {
    const bins = classify(ch(60.2, 60.4), 60, 61)
    expect(bins.slice(0, 60).every((b) => b.state === null)).toBe(true)
    expect(bins.at(-1)).toMatchObject({ turnovers: 2, state: "control" })
    // half a minute watched with 3 turnovers is 6 a minute: chaos
    expect(classify(ch(0.1, 0.2, 0.3), 0, 0.5)[0]).toMatchObject({ rate: 6, state: "chaos" })
    // too little watched to judge
    expect(classify(ch(0.1), 0, 0.2)[0]!.state).toBeNull()
    expect(classify([], null, 5)).toEqual([])
  })
})

describe("moments and clicks", () => {
  const l = run([
    frame(20, "9:00"), board(20, "9:00", 0, 0), agentCue("g", "goal", 600, "10:00"), agentCue("x", "momentum_swing", 300, "5:00"), agentCue("d", "manager_decision", 400, "6:40"),
    board(600, "10:00", 1, 0), agentCue("odd", "weird", 700, "11:00")
  ])
  it("maps templates to kinds", () => {
    expect(["goal", "big_chance", "momentum_swing", "pressure_shift", "manager_decision", "better_pass", "x"].map(kindOf)).toEqual(["goal", "chance", "swing", "pressure", "decision", "pass", "moment"])
  })
  it("shows casual viewers goals only, with the goal cue attached; analysts get every moment in order", () => {
    const casual = moments(l, "casual")
    expect(casual.map((m) => [m.kind, m.team, m.cue?.cue_id])).toEqual([["goal", "home", "g"]])
    const analyst = moments(l, "analyst")
    expect(analyst.map((m) => m.kind)).toEqual(["swing", "decision", "goal", "moment"])
    expect(analyst.filter((m) => m.kind === "goal")).toHaveLength(1)
  })
  it("freezes when the frame is in the ring, opens Why when older, does nothing for an old goal without a cue", () => {
    const ring = [20, 21, 22].map((n) => (frame(n, "1:00") as { frame: PitchFrame }).frame)
    expect(inRing(ring, 21)).toBe(true)
    expect(inRing(ring, 19)).toBe(false)
    expect(inRing([], 1)).toBe(false)
    const m = moments(l, "analyst")
    const at = (id: string) => m.find((x) => x.id === id)!
    expect(actionFor({ ...at("x"), frame: 21 }, ring)).toBe("freeze")
    expect(actionFor(at("x"), ring)).toBe("why")
    expect(actionFor({ ...at("x"), cue: null }, ring)).toBe("none")
  })
})

import { describe, expect, it } from "vitest"
import { BIG_CHANCE_XG, DIFFICULT_PASS_XP, StatsEngine } from "../src/engine.js"
import { passFeatures, predict, predictXg, shotFeatures } from "../src/models.js"
import { event, frame, INFO, models } from "./helpers.js"

const M = models()
const pass = (tick: number, end: number, ok: boolean, fields: object = {}) =>
  event("pass", tick, { team_id: "home-fc", player_id: "h2", x: -10, y: 5, x_end: -10 + (ok ? 10 : 20), y_end: 5, frame_id_end: end, outcome: ok ? "successful" : "intercepted", ...fields })

describe("pass and shot metrics", () => {
  it("measure pass distance, accuracy and difficulty for the passer and the team", () => {
    const eng = new StatsEngine(INFO, M)
    eng.ingest({ kind: "frame", frame: frame(0) })
    eng.ingest({ kind: "event", event: pass(0, 1, true) })
    eng.ingest({ kind: "frame", frame: frame(1) })
    eng.ingest({ kind: "event", event: pass(1, 2, false) })
    eng.ingest({ kind: "frame", frame: frame(2) })
    const f = frame(0)
    const xp1 = predict(M.xpass, passFeatures({ x: -10, y: 5 }, { x: 0, y: 5 }, 1, f.away))
    const xp2 = predict(M.xpass, passFeatures({ x: -10, y: 5 }, { x: 10, y: 5 }, 1, f.away))
    for (const subject of ["h2", "home-fc"]) {
      expect(eng.value("pass.acc", subject)).toBe(0.5)
      expect(eng.value("pass.dist", subject)).toBeCloseTo(15, 9)
      expect(eng.value("pass.xp", subject)).toBeCloseTo((xp1 + xp2) / 2, 12)
    }
    expect(eng.value("pass.acc", "h3")).toBeNull()
    expect(eng.value("pass.acc", "home-fc", { at: 0 })).toBeNull()
    expect(eng.value("pass.acc", "home-fc", { at: 1 })).toBe(1)
  })

  it("count a pass without a tracking frame but leave its difficulty unknown", () => {
    const eng = new StatsEngine(INFO, M)
    eng.ingest({ kind: "event", event: pass(3, 4, true) })
    expect(eng.value("pass.acc", "h2")).toBe(1)
    expect(eng.value("pass.xp", "h2")).toBeNull()
    expect(eng.derived.get(eng.events[0]!.id)).toEqual({ "pass.dist": 10 })
  })

  it("signal a completed pass that was unlikely to arrive, and not an easy one", () => {
    const eng = new StatsEngine(INFO, M)
    // A 35 m forward pass past two defenders in the lane, with an opponent tight on the passer.
    const crowded = frame(0, { a3: { x: -9.5, y: 5 }, a2: { x: 5, y: 5.5 }, a1: { x: 15, y: 4.5 } })
    eng.ingest({ kind: "frame", frame: crowded })
    const hard = event("pass", 1, { team_id: "home-fc", player_id: "h2", x: -10, y: 5, x_end: 25, y_end: 5, frame_id: 0, frame_id_end: 1, outcome: "successful" })
    eng.ingest({ kind: "event", event: hard })
    eng.ingest({ kind: "frame", frame: frame(1) })
    eng.ingest({ kind: "event", event: pass(1, 2, true) })
    const sig = eng.signals.filter((s) => s.type === "difficult_pass_completed")
    expect(sig).toHaveLength(1)
    expect(sig[0]).toMatchObject({ player_id: "h2", metric: "pass.xp", evidence: [hard.id], frame_from: 0, frame_to: 1 })
    expect(sig[0]!.value!).toBeLessThan(DIFFICULT_PASS_XP)
  })

  it("value shots by xG, take shot speed from the ball, and signal big chances that did not score", () => {
    const eng = new StatsEngine(INFO, M)
    // The ball leaves at 25 m/s (90 km/h) from (40, 0) towards goal.
    for (let t = 0; t <= 5; t++) eng.ingest({ kind: "frame", frame: frame(t, {}, { ball: { x: 40 + 2.5 * Math.max(0, t - 2), y: 0, z: 0.5 } }) })
    const close = event("shot", 2, { team_id: "home-fc", player_id: "h3", x: 46, y: 1, frame_id_end: 6, outcome: "saved", attrs: { body_part: "right_foot", technique: "normal" } })
    eng.ingest({ kind: "event", event: close })
    eng.ingest({ kind: "frame", frame: frame(6) })
    // The simulator's xG, on the frame before the strike (the one the shooter decided on), the keeper left out.
    const xg = predictXg(M.xg, shotFeatures({ x: 46, y: 1 }, 1, false, frame(1).away.filter((p) => p.id !== "a1")))
    expect(xg).toBeGreaterThan(BIG_CHANCE_XG)
    expect(eng.value("shot.xg", "h3")).toBeCloseTo(xg, 12)
    expect(eng.value("shot.speed", "home-fc")).toBeCloseTo(90, 6)
    const big = eng.signals.filter((s) => s.type === "big_chance")
    expect(big).toHaveLength(1)
    expect(big[0]).toMatchObject({ player_id: "h3", metric: "shot.xg", evidence: [close.id] })
  })

  it("rate a penalty at the fixed value and raise a goal signal carrying the score and the shot's xG", () => {
    const eng = new StatsEngine(INFO, M)
    eng.ingest({ kind: "frame", frame: frame(0) })
    const pen = event("shot", 0, { team_id: "away-fc", player_id: "a3", x: -41.5, y: 0, frame_id_end: 4, outcome: "goal", attrs: { technique: "penalty", body_part: "right_foot" } })
    const goal = event("goal", 4, { team_id: "away-fc", player_id: "a3", attrs: { scorer_id: "a3", own_goal: false } })
    eng.ingest({ kind: "event", event: pen })
    eng.ingest({ kind: "event", event: goal })
    expect(eng.value("shot.xg", "away-fc")).toBe(M.xg.penalty)
    expect(eng.signals.map((s) => s.type)).toEqual(["goal"])
    expect(eng.signals[0]).toMatchObject({ team_id: "away-fc", metric: "shot.xg", value: M.xg.penalty, evidence: [pen.id, goal.id], salience: 1, data: { home: 0, away: 1, own_goal: 0 } })
    expect(eng.score).toEqual({ home: 0, away: 1 })
  })

  it("raise card signals, red ones more salient", () => {
    const eng = new StatsEngine(INFO, M)
    eng.ingest({ kind: "event", event: event("card", 1, { team_id: "home-fc", player_id: "h2", attrs: { colour: "yellow" } }) })
    eng.ingest({ kind: "event", event: event("card", 2, { team_id: "home-fc", player_id: "h2", attrs: { colour: "second_yellow" } }) })
    expect(eng.signals.map((s) => [s.type, s.salience, s.metric, s.data.red])).toEqual([["card", 0.5, null, 0], ["card", 0.9, null, 1]])
  })

  it("raise player milestones at 50 completed passes and at a brace", () => {
    const eng = new StatsEngine(INFO, M)
    for (let i = 0; i < 52; i++) eng.ingest({ kind: "event", event: pass(10 + 2 * i, 11 + 2 * i, true) })
    for (const t of [200, 300]) eng.ingest({ kind: "event", event: event("goal", t, { team_id: "home-fc", player_id: "h3", attrs: { scorer_id: "h3", own_goal: false } }) })
    const m = eng.signals.filter((s) => s.type === "player_milestone")
    expect(m.map((s) => [s.player_id, s.data])).toEqual([["h2", { passes_completed: 50 }], ["h3", { goals: 2 }]])
    expect(m[0]).toMatchObject({ metric: "pass.acc", value: 1 })
  })
})

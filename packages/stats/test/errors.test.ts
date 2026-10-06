import { describe, expect, it } from "vitest"
import type { DomainEvent } from "@touchline/schema"
import { COSTLY_ERROR_S, StatsEngine } from "../src/engine.js"
import { event, frame, INFO, models } from "./helpers.js"

/** Feed frames 0..last and the events at their ticks; return the costly_error signals. */
const run = (events: DomainEvent[], last: number) => {
  const eng = new StatsEngine(INFO, models())
  for (let t = 0; t <= last; t++) {
    eng.ingest({ kind: "frame", frame: frame(t) })
    for (const e of events.filter((x) => (x.frame_id_end ?? x.frame_id) === t)) eng.ingest({ kind: "event", event: e })
  }
  eng.finish()
  return eng.signals.filter((s) => s.type === "costly_error")
}
const mishit = (tick: number, attrs: DomainEvent["attrs"] = {}) =>
  event("pass", tick, { team_id: "home-fc", player_id: "h2", x: -30, y: 5, x_end: -20, y_end: 5, frame_id_end: tick + 5, outcome: "intercepted", attrs: { execution: "mishit", under_pressure: true, ...attrs } })
const shot = (tick: number, outcome = "saved") => event("shot", tick, { team_id: "away-fc", player_id: "a3", x: -40, y: 2, outcome })
const regain = (tick: number, team = "home-fc") => event("possession_change", tick, { team_id: team })

describe("costly errors", () => {
  it("are raised when a visible error gives the ball away and the opponents shoot within 15 s", () => {
    const pass = mishit(10)
    const s = shot(60, "goal")
    const [sig] = run([pass, regain(15, "away-fc"), s], 70)
    expect(sig).toMatchObject({ team_id: "home-fc", player_id: "h2", metric: "shot.xg", frame_from: 10, frame_to: 60, evidence: [pass.id, s.id] })
    expect(sig!.data).toMatchObject({ goal: 1, under_pressure: 1 })
    expect(sig!.salience).toBeGreaterThan(0.9)
  })

  it("count a heavy touch that lost the ball, and only once per error", () => {
    const touch = event("reception", 20, { team_id: "home-fc", player_id: "h3", x: -20, y: 0, attrs: { first_touch: "heavy", under_pressure: false } })
    const [sig, ...more] = run([touch, regain(30, "away-fc"), shot(80), shot(100)], 110)
    expect(sig).toMatchObject({ player_id: "h3", frame_from: 20, data: { goal: 0, under_pressure: 0 } })
    expect(more).toEqual([])
  })

  it("are not raised when the team won the ball back first, the shot came too late, or the error kept the ball", () => {
    expect(run([mishit(10), regain(15, "away-fc"), regain(40), shot(60)], 70)).toEqual([])
    expect(run([mishit(10), shot(10 + COSTLY_ERROR_S * 10 + 6)], 10 + COSTLY_ERROR_S * 10 + 10)).toEqual([])
    expect(run([mishit(10, {}), shot(60)].map((e) => (e.type === "pass" ? { ...e, outcome: "successful" } : e)), 70)).toEqual([])
    const kept = event("reception", 20, { team_id: "home-fc", player_id: "h3", attrs: { first_touch: "heavy" } })
    expect(run([kept, shot(80)], 90)).toEqual([])
    // A loose touch the same team recovers is not lost, whatever the touch was flagged: the opponents never had it.
    const loose = event("reception", 20, { team_id: "home-fc", player_id: "h3", attrs: { first_touch: "miscontrol", lost_possession: true } })
    expect(run([loose, regain(90, "away-fc"), shot(100)], 110)).toEqual([])
  })
})

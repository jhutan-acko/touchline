import { describe, expect, it } from "vitest"
import type { DomainEvent, WindowResult } from "@touchline/sim-core"
import { makeConfig } from "@touchline/sim-core/testing"
import { criticalErrors, mistakes, scriptTruths, tacticalTruths } from "../src/truths.js"

const cfg = makeConfig(1)
const H = cfg.home.id, A = cfg.away.id
let seq = 0
const ev = (type: DomainEvent["type"], frame: number, team: string, attrs: Record<string, unknown> = {}, extra: Partial<DomainEvent> = {}): DomainEvent => ({
  id: `m-e${++seq}`, match_id: "m", type, frame_id: frame, period_frame_id: frame, period: "first_half", match_clock: "10:00.00",
  team_id: team, player_id: team === H ? `${H}-04` : `${A}-09`, x: -20, y: 0, x_end: null, y_end: null, frame_id_end: null,
  outcome: null, source: "sim", confidence: 1, attrs: attrs as DomainEvent["attrs"], ...extra
})

describe("mistakes", () => {
  it("lists every mis-hit and bad first touch with its frame, player and cause", () => {
    const list = mistakes([
      ev("pass", 100, H, { execution: "mishit", under_pressure: true }),
      ev("pass", 200, H, { execution: "mishit", under_pressure: false, scripted: true }),
      ev("clearance", 300, A, { execution: "mishit", under_pressure: false }),
      ev("reception", 400, A, { first_touch: "heavy", under_pressure: true }),
      ev("pass", 500, H, { execution: "clean" }),
      ev("reception", 600, H, { first_touch: "controlled" })
    ])
    expect(list.map((m) => [m.frame_id, m.kind, m.cause])).toEqual([
      [100, "mishit", "pressure"],
      [200, "mishit", "script"],
      [300, "mishit", "technique"],
      [400, "heavy_touch", "pressure"]
    ])
    expect(list[0]!.player_id).toBe(`${H}-04`)
  })
})

describe("critical errors", () => {
  const mistake = ev("pass", 1000, H, { execution: "mishit", under_pressure: true })
  it("a mistake followed by an opponent shot within 15 s is an error leading to a shot; a goal makes it one leading to a goal", () => {
    const shot = ev("shot", 1100, A, {}, { outcome: "saved" })
    expect(criticalErrors([mistake, shot], cfg).map((c) => c.kind)).toEqual(["error_leading_to_shot"])
    const goal = ev("shot", 1100, A, {}, { outcome: "goal" })
    const e = criticalErrors([mistake, goal], cfg)
    expect(e.map((c) => c.kind)).toEqual(["error_leading_to_goal"])
    expect(e[0]).toMatchObject({ mistake_id: mistake.id, shot_id: goal.id, team_id: H })
  })
  it("not when the mistake did not lose the ball: a mis-hit pass that still found a teammate, or a heavy touch the player kept", () => {
    const kept = ev("pass", 1000, H, { execution: "mishit", under_pressure: true }, { outcome: "successful" })
    expect(criticalErrors([kept, ev("possession_change", 1040, A), ev("shot", 1100, A, {}, { outcome: "goal" })], cfg)).toEqual([])
    const touchKept = ev("reception", 1000, H, { first_touch: "heavy", under_pressure: true })
    expect(criticalErrors([touchKept, ev("shot", 1100, A, {}, { outcome: "goal" })], cfg)).toEqual([])
    const touchLost = ev("reception", 1000, H, { first_touch: "heavy", under_pressure: true })
    expect(criticalErrors([touchLost, ev("possession_change", 1010, A), ev("shot", 1100, A, {}, { outcome: "goal" })], cfg).map((c) => c.kind)).toEqual(["error_leading_to_goal"])
  })
  it("not when the team wins the ball back first, or the shot comes more than 15 s later", () => {
    const regain = ev("possession_change", 1050, H)
    expect(criticalErrors([mistake, regain, ev("shot", 1100, A, {}, { outcome: "goal" })], cfg)).toEqual([])
    expect(criticalErrors([mistake, ev("shot", 1000 + 151, A, {}, { outcome: "goal" })], cfg)).toEqual([])
  })
})

describe("tactical truths", () => {
  it("counts pressures per 100 opponent passes, pass share and shots per team", () => {
    const list = [
      ...Array.from({ length: 10 }, (_, i) => ev("pass", i, H)),
      ...Array.from({ length: 30 }, (_, i) => ev("pass", 100 + i, A)),
      ...Array.from({ length: 6 }, (_, i) => ev("pressure", 200 + i, H)),
      ev("pressure", 300, A),
      ev("shot", 400, H, {}, { outcome: "wide" })
    ]
    const t = tacticalTruths(list, cfg)
    expect(t[H]).toEqual({ pressures_per_100_opponent_passes: 20, pass_share: 0.25, shots: 1 })
    expect(t[A]).toEqual({ pressures_per_100_opponent_passes: 10, pass_share: 0.75, shots: 0 })
  })
})

describe("script truths", () => {
  it("describe each window: what was injected, by which team, when, whether it happened, and which metrics should move", () => {
    const w: WindowResult = { entries: [{ window: [60, 75], team: "home", effect: "press_surge" }], achieved: true, attempts: 2, forced: false, fromFrame: 36000, toFrame: 45000 }
    expect(scriptTruths([w], cfg)).toEqual([
      { effect: "press_surge", team_id: H, minutes: [60, 75], frames: [36000, 45000], count: 1, achieved: true, attempts: 2, forced: false, expected_metrics: ["team.press", "ppda", "tilt"] }
    ])
  })
})

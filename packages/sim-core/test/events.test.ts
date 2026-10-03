import { describe, expect, it } from "vitest"
import { buildEvent, matchClock } from "../src/events.js"

describe("events", () => {
  it("formats the CDF match clock, with the second half starting at 45:00", () => {
    expect(matchClock("first_half", 0, 0.1)).toBe("00:00.00")
    expect(matchClock("first_half", 6024, 0.1)).toBe("10:02.40")
    expect(matchClock("second_half", 13224, 0.1)).toBe("67:02.40")
  })
  it("builds ids, period frame ids and rounded coordinates", () => {
    const e = buildEvent({ matchId: "m1", period: "second_half", periodStartTick: 27900, dt: 0.1 }, 7, {
      type: "pass", frame_id: 41124, team_id: "t", player_id: "p", x: 8.7123, y: -11.6, x_end: 36, y_end: -3.9, attrs: {}
    })
    expect(e.id).toBe("m1-e7")
    expect(e.period_frame_id).toBe(13224)
    expect(e.x).toBe(8.71)
    expect(e.match_clock).toBe("67:02.40")
  })
})

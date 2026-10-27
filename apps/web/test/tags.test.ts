import { describe, expect, it } from "vitest"
import type { BallEvent, PitchFrame } from "@touchline/rpc"
import { FOLLOW_EMPTY, followReduce } from "../src/follow.js"
import { EMPTY, reduce } from "../src/pane.js"
import { eventTags, MAX_TAGS, passText, selectTags, shotText, speedsAt, sprintTags, statTags, type StatTag } from "../src/tags.js"

const FPS = 10
const names = { "p-9": "#9 Feseo Wylford", "p-4": "#4 Anna Back" }

/** Frames `from`..`to` with p-9 running at `kmh` along x and p-4 standing. */
const run = (from: number, to: number, kmh: (n: number) => number, period: PitchFrame["period"] = "first_half"): PitchFrame[] => {
  let x = 0
  const out: PitchFrame[] = []
  for (let n = from; n <= to; n++) {
    if (n > from) x += kmh(n) / 3.6 / FPS
    out.push({ frame: n, period, clock: "10:00.00", ball: { x: 0, y: 0, z: 0 }, home: [{ id: "p-9", x, y: 5 }], away: [{ id: "p-4", x: 10, y: -5 }] })
  }
  return out
}

const ev = (o: Partial<BallEvent>): BallEvent => ({
  id: "e1", frame: 100, clock: "10:00", type: "pass", team: "home", player_id: "p-9", receiver_id: "p-4", outcome: "success",
  x: 0, y: 0, x_end: 20, y_end: 3, length_m: 23.2, xpass: 0.18, speed_kmh: 55, xg: null, ...o
})

describe("player speed", () => {
  it("is measured over half a second", () => {
    const frames = run(0, 20, () => 28)
    expect(speedsAt(frames, 20, FPS).get("p-9")).toBeCloseTo(28, 6)
    expect(speedsAt(frames, 20, FPS).get("p-4")).toBe(0)
  })

  it("smooths out a one-frame spike", () => {
    // 20 km/h with one frame at 60 km/h: over half a second that is 28 km/h, not 60.
    const frames = run(0, 20, (n) => (n === 18 ? 60 : 20))
    expect(speedsAt(frames, 20, FPS).get("p-9")).toBeCloseTo(28, 6)
  })

  it("is not measured across half-time or a jump", () => {
    const frames = [...run(0, 10, () => 10), ...run(11, 20, () => 10, "second_half")]
    expect(speedsAt(frames, 13, FPS).size).toBe(0)
    const jump = run(0, 10, (n) => (n === 10 ? 300 : 10))
    expect(speedsAt(jump, 10, FPS).has("p-9")).toBe(false)
  })
})

describe("sprint tags", () => {
  it("name a player over 25 km/h with their top speed, for about two seconds", () => {
    const frames = run(0, 50, (n) => (n <= 20 ? 29.1 : 10))
    const at20 = sprintTags(frames, 20, FPS, names)
    expect(at20).toHaveLength(1)
    expect(at20[0]).toMatchObject({ kind: "sprint", text: "#9 Feseo Wylford · 29.1 km/h", player_id: "p-9", opacity: 1 })
    // Slowed down at 21: the tag stays until 2 s after the fastest moment, fading out at the end.
    const later = sprintTags(frames, 37, FPS, names)
    expect(later).toHaveLength(1)
    expect(later[0]!.opacity).toBeLessThan(1)
    expect(sprintTags(frames, 45, FPS, names)).toHaveLength(0) // the smoothed speed fell under 25 at frame 22
  })

  it("never shows anyone under the threshold", () => {
    expect(sprintTags(run(0, 30, () => 24), 30, FPS, names)).toEqual([])
  })

  it("only look at frames up to the frame shown (a frozen view sees nothing later)", () => {
    const frames = run(0, 40, (n) => (n > 30 ? 30 : 8))
    expect(sprintTags(frames, 25, FPS, names)).toEqual([])
    expect(sprintTags(frames, 40, FPS, names)).toHaveLength(1)
  })
})

describe("event tags", () => {
  it("give analysts a notable pass's difficulty, length and xPass, and casual fans only a tough completed one", () => {
    expect(passText(ev({}), "analyst", "en")).toBe("Hard pass · 23 m · 18% xPass ✓")
    expect(passText(ev({ xpass: 0.5, outcome: "fail" }), "analyst", "en")).toBe("Tricky pass · 23 m · 50% xPass ✗")
    expect(passText(ev({ xpass: 0.9, length_m: 8 }), "analyst", "en")).toBeNull() // routine
    expect(passText(ev({ xpass: 0.9, length_m: 40 }), "analyst", "en")).toBe("Pass · 40 m · 90% xPass ✓") // long
    expect(passText(ev({}), "casual", "en")).toBe("Tough pass!")
    expect(passText(ev({ outcome: "fail" }), "casual", "en")).toBeNull()
    expect(passText(ev({ xpass: 0.5 }), "casual", "en")).toBeNull()
    expect(passText(ev({}), "casual", "es")).toBe("¡Pasazo!")
  })

  it("give a shot its speed (and xG for analysts)", () => {
    const shot = ev({ type: "shot", speed_kmh: 96.3, xg: 0.1234, xpass: null })
    expect(shotText(shot, "analyst", "en")).toBe("Shot · 96 km/h · xG 0.12")
    expect(shotText(shot, "casual", "en")).toBe("96 km/h rocket!")
    expect(shotText(shot, "casual", "hi")).toBe("96 km/h का तूफ़ानी शॉट!")
    expect(shotText({ ...shot, speed_kmh: null }, "casual", "en")).toBe("Shot!")
  })

  it("show from the event's frame for three seconds, never before it", () => {
    const evs = [(ev({ type: "shot", xg: 0.1, frame: 100 }))]
    expect(eventTags(evs, 99, FPS, "analyst", "en")).toEqual([])
    expect(eventTags(evs, 100, FPS, "analyst", "en")).toHaveLength(1)
    expect(eventTags(evs, 129, FPS, "analyst", "en")).toHaveLength(1)
    expect(eventTags(evs, 130, FPS, "analyst", "en")).toEqual([])
  })

  it("stay up longer in match time at a faster speed, so they last as long on screen", () => {
    const evs = [(ev({ type: "shot", xg: 0.1, frame: 100 }))]
    expect(eventTags(evs, 140, FPS, "analyst", "en", 1)).toEqual([])
    expect(eventTags(evs, 140, FPS, "analyst", "en", 4)).toHaveLength(1) // 3 s × 4 = 120 frames
    expect(eventTags(evs, 99, FPS, "analyst", "en", 4)).toEqual([]) // still never early
    const frames = run(0, 80, (n) => (n <= 20 ? 29.1 : 10))
    expect(sprintTags(frames, 50, FPS, names, 1)).toEqual([])
    expect(sprintTags(frames, 50, FPS, names, 4)).toHaveLength(1)
  })

  it("never tag a pass of a few metres", () => {
    expect(passText(ev({ length_m: 1, xpass: 0.2 }), "analyst", "en")).toBeNull()
    expect(passText(ev({ length_m: 1, xpass: 0.2 }), "casual", "en")).toBeNull()
  })

  it("never show an event after the frame shown, among many in frame order", () => {
    const evs = [100, 105, 110, 200].map((frame) => ev({ id: `s${frame}`, type: "shot", frame }))
    expect(eventTags(evs, 106, FPS, "analyst", "en").map((t) => t.key)).toEqual(["event-s105", "event-s100"])
  })

  it("put a completed pass's tag on its receiver, a missed one where the ball went", () => {
    const [ok] = eventTags([(ev({}))], 100, FPS, "analyst", "en")
    expect(ok).toMatchObject({ player_id: "p-4", x: 20, y: 3, ok: true })
    const [miss] = eventTags([(ev({ outcome: "fail" }))], 100, FPS, "analyst", "en")
    expect(miss).toMatchObject({ player_id: null, x: 20, y: 3, ok: false })
  })
})

describe("choosing tags", () => {
  const tag = (key: string, kind: StatTag["kind"], frame: number): StatTag => ({ key, kind, frame, text: key, player_id: null, x: 0, y: 0, team: null, opacity: 1, ok: null })

  it("keep at most three, newest first, with one sprint at most", () => {
    const events = [tag("e4", "pass", 104), tag("e3", "shot", 103), tag("e2", "pass", 102), tag("e1", "pass", 101)]
    const sprints = [tag("s1", "sprint", 105), tag("s2", "sprint", 105)]
    const got = selectTags(events, sprints)
    expect(got).toHaveLength(MAX_TAGS)
    expect(got.map((t) => t.key)).toEqual(["s1", "e4", "e3"])
  })

  it("put it together for a pane's state, analyst and casual alike", () => {
    let s = EMPTY
    let follow = FOLLOW_EMPTY
    for (const f of run(0, 100, () => 8)) s = reduce(s, { kind: "frame", frame: f }, FPS)
    for (const event of [ev({ id: "hard", frame: 99 }), ev({ id: "easy", xpass: 0.9, length_m: 30, frame: 98 })]) follow = followReduce(follow, { kind: "event", event }, FPS)
    expect(follow.events.map((e) => e.id)).toEqual(["easy", "hard"]) // one store, in frame order
    const o = { ring: s.ring, events: follow.events, at: 100, fps: FPS, lang: "en" as const, names }
    expect(statTags({ ...o, mode: "analyst" }).map((t) => t.text)).toEqual(["Hard pass · 23 m · 18% xPass ✓", "Pass · 30 m · 90% xPass ✓"])
    expect(statTags({ ...o, mode: "casual" }).map((t) => t.text)).toEqual(["Tough pass!"])
  })
})

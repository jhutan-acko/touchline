import { describe, expect, it } from "vitest"
import { advanceRows, blendFor, initAnchorState, lagBall, rowFor, ruleAnchor, settled, slotGeometry, type AnchorInput } from "../src/anchor.js"
import type { Side } from "../src/geometry.js"
import { DEFAULT_PARAMS as P, type ShapeRow } from "../src/params.js"
import { anchorFor, FORMATIONS } from "../src/shape.js"
import { STYLES } from "../src/testing.js"
import type { FormationName, TeamShapeState, TeamStyle } from "../src/types.js"

const pos = { ...P.positioning, rule: 1 }
const NEUTRAL: TeamStyle = { ...STYLES.direct, lineHeight: 0.125, compactness: 0.625 }
const flat = { width: 1, depth: 1, defDepth: 1 }
const still = (row: ShapeRow, extra: Partial<AnchorInput> = {}): AnchorInput => ({ blend: settled(row), drift: { u: 0, y: 0 }, lastDefU: null, vsKeeper: false, ...extra })
const at = (f: FormationName, slot: number, ball: { x: number; y: number }, input: AnchorInput, style: TeamStyle = NEUTRAL, side: Side = "home") =>
  ruleAnchor(f, FORMATIONS[f], slot, side, "first_half", ball, style, flat, pos, input)
const team = (prev: ShapeRow, row: ShapeRow, since = 0): TeamShapeState => ({ row, prev, since, drift: { u: 0, y: 0 } })

describe("rule-table anchors", () => {
  it("reproduce the real-data table at lambda = 1", () => {
    // 4-2-3-1 AM (slot 8, central): u = a + b bu, y = e by.
    const am = at("4-2-3-1", 8, { x: 10, y: 6 }, still("in"))
    expect(am.x).toBeCloseTo(8.6 + 0.54 * 10, 9)
    expect(am.y).toBeCloseTo(0.4 * 6, 9)
    // 4-4-2 left FB (slot 1, y +23): s = w0 + w1 bu + w2 bs + w3 |by|.
    const fb = at("4-4-2", 1, { x: 10, y: 6 }, still("in"))
    expect(fb.x).toBeCloseTo(-1.7 + 0.58 * 10, 9)
    expect(fb.y).toBeCloseTo(17.1 - 0.04 * 10 + 0.28 * 6 + 0.02 * 6, 9)
    const fbOut = at("4-4-2", 1, { x: 10, y: 6 }, still("out"))
    expect(fbOut.x).toBeCloseTo(-14 + 0.54 * 10, 9)
    expect(fbOut.y).toBeCloseTo(10 + 0.07 * 10 + 0.34 * 6 + 0.12 * 6, 9)
    // The right FB mirrors: s is measured toward his own touchline.
    const rfb = at("4-4-2", 4, { x: 10, y: -6 }, still("in"))
    expect(rfb.y).toBeCloseTo(-fb.y, 9)
  })

  it("keep each slot's offset from its group's mean: a 4-3-3's DM sits 6 m below its eights, which hold eightW0", () => {
    const ball = { x: 0, y: 0 }
    const cm = at("4-3-3", 5, ball, still("in"))
    const dm = at("4-3-3", 6, ball, still("in"))
    expect(cm.x).toBeCloseTo(1.5 + 2, 9)
    expect(cm.x - dm.x).toBeCloseTo(6, 9)
    expect(cm.y).toBeCloseTo(pos.eightW0, 9)
    expect(dm.y).toBeCloseTo(0, 9)
    expect(slotGeometry("3-5-2", FORMATIONS["3-5-2"], 4).group).toBe("WB")
    expect(slotGeometry("4-2-3-1", FORMATIONS["4-2-3-1"], 5).group).toBe("CM")
  })

  it("lineHeight and compactness move the shape only without the ball", () => {
    const ball = { x: 5, y: 3 }
    for (const slot of [1, 2, 5, 9])
      expect(at("4-4-2", slot, ball, still("in"), STYLES.high_press)).toEqual(at("4-4-2", slot, ball, still("in"), STYLES.low_block))
    const cb = (st: TeamStyle) => at("4-4-2", 2, ball, still("out"), st).x
    expect(cb(STYLES.high_press) - cb(STYLES.low_block)).toBeCloseTo(pos.styleLineM * 1.6, 9)
  })

  it("build-up row (G4): centre backs split at u -30, full-backs push to u -13, whatever the ball", () => {
    const ball = { x: -46, y: 2 }
    const cb = at("4-4-2", 2, ball, still("gk"))
    expect(cb.x).toBeCloseTo(-30, 9)
    expect(cb.y).toBeCloseTo(15.5, 9)
    const fb = at("4-4-2", 1, ball, still("gk"))
    expect(fb.x).toBeCloseTo(-13, 9)
    expect(fb.y).toBeCloseTo(27, 9)
  })

  it("keeper: 2 m off his line on the goal-ball line within 25 m, else his row clamped", () => {
    const near = at("4-4-2", 0, { x: -40, y: 5 }, still("out"))
    expect(near.x).toBeCloseTo(-50.5, 9)
    expect(near.y).toBeCloseTo((5 * 2) / 12.5, 9)
    const far = at("4-4-2", 0, { x: 30, y: 0 }, still("out"))
    expect(far.x).toBeCloseTo(-39.9 + 0.27 * 30, 9)
    expect(far.y).toBeCloseTo(0, 9)
  })

  it("caps forwards below the opponents' last defender with the ball, and every anchor at vsKeeperCapU while the other keeper has it", () => {
    const st = at("4-3-3", 9, { x: 30, y: 0 }, still("in", { lastDefU: 28 }))
    expect(st.x).toBeCloseTo(28 - pos.lineCapM, 9)
    expect(at("4-3-3", 9, { x: 30, y: 0 }, still("out", { lastDefU: 28 })).x).toBeCloseTo(7.2 + 0.59 * 30, 9)
    expect(at("4-3-3", 9, { x: 40, y: 0 }, still("out", { vsKeeper: true })).x).toBeCloseTo(pos.vsKeeperCapU, 9)
  })

  it("mirrors for the away side", () => {
    const h = at("4-2-3-1", 7, { x: 12, y: -8 }, still("out"))
    const a = at("4-2-3-1", 7, { x: -12, y: 8 }, still("out"), NEUTRAL, "away")
    expect(a.x).toBeCloseTo(-h.x, 9)
    expect(a.y).toBeCloseTo(-h.y, 9)
  })

  it("stays on the pitch for any formation, slot, row, corner ball and +-30 m drift", () => {
    for (const f of Object.keys(FORMATIONS) as FormationName[])
      for (let slot = 0; slot < 11; slot++)
        for (const row of ["in", "out", "gk"] as const)
          for (const bx of [-52, 52]) for (const by of [-33, 33]) for (const du of [-30, 30]) for (const dy of [-30, 30]) {
            const a = at(f, slot, { x: bx, y: by }, still(row, { drift: { u: du, y: dy } }))
            expect(Math.abs(a.x)).toBeLessThanOrEqual(52.5)
            expect(Math.abs(a.y)).toBeLessThanOrEqual(34)
          }
  })

  it("anchorFor uses the table with a context and the rule on, and the old template otherwise", () => {
    const ball = { x: 10, y: 6 }
    const input = still("in")
    expect(anchorFor("4-4-2", 1, "home", "first_half", ball, NEUTRAL, true, flat, { pos, input })).toEqual(at("4-4-2", 1, ball, input))
    expect(anchorFor("4-4-2", 1, "home", "first_half", ball, NEUTRAL, true, flat, { pos: P.positioning, input })).toEqual(
      anchorFor("4-4-2", 1, "home", "first_half", ball, NEUTRAL, true, flat)
    )
  })
})

describe("phase-switch blend (A2)", () => {
  it("ramps by role: centre backs convert fastest, wingers slowest", () => {
    const t1 = (g: Parameters<typeof blendFor>[1]) => blendFor(team("out", "in"), g, 10, 0.1, pos).lamU
    expect(t1("CB")).toBeCloseTo(1 - Math.exp(-1.5 / 2.5), 9)
    expect(t1("CB")).toBeGreaterThan(t1("CM"))
    expect(t1("CM")).toBeGreaterThan(t1("ST"))
    expect(t1("ST")).toBeGreaterThan(t1("AM"))
    expect(t1("AM")).toBeGreaterThan(t1("FB"))
    expect(t1("FB")).toBeGreaterThan(t1("W"))
    expect(blendFor(team("out", "in"), "CB", 0, 0.1, pos).lamU).toBeCloseTo(1 - Math.exp(-0.5 / 2.5), 9)
    expect(blendFor(team("in", "in"), "W", 5, 0.1, pos)).toEqual(settled("in"))
  })

  it("narrows fast after a loss, spreads after a win only after a dead time, and follows lambda within possession", () => {
    expect(blendFor(team("in", "out"), "FB", 10, 0.1, pos).lamY).toBeCloseTo(1 - Math.exp(-1), 9)
    expect(blendFor(team("gk", "out"), "FB", 10, 0.1, pos).lamY).toBeCloseTo(1 - Math.exp(-1), 9)
    expect(blendFor(team("out", "in"), "FB", 20, 0.1, pos).lamY).toBe(0)
    expect(blendFor(team("out", "in"), "FB", 70, 0.1, pos).lamY).toBeCloseTo(1 - Math.exp(-1), 9)
    const backPass = blendFor(team("in", "gk"), "CB", 10, 0.1, pos)
    expect(backPass.lamY).toBe(backPass.lamU)
  })

  it("blends the anchor between the two rows by lambda", () => {
    const b = blendFor(team("out", "in"), "CB", 10, 0.1, pos)
    const ball = { x: 0, y: 0 }
    const mid = at("4-4-2", 2, ball, { ...still("in"), blend: b })
    const i = at("4-4-2", 2, ball, still("in"))
    const o = at("4-4-2", 2, ball, still("out"))
    expect(mid.x).toBeCloseTo(o.x + b.lamU * (i.x - o.x), 9)
    expect(mid.y).toBeCloseTo(o.y + b.lamY * (i.y - o.y), 9)
  })
})

describe("positioning state", () => {
  it("reads the ball 2 s ago at 10 Hz and at 25 Hz", () => {
    for (const dt of [0.1, 0.04]) {
      const rows = { home: "in", away: "out" } as const
      let s = initAnchorState({ x: 0, y: 0 }, dt, pos, rows)
      const n = Math.round(pos.ballLagS / dt)
      expect(s.ballLag).toHaveLength(n + 1)
      for (let i = 1; i <= n + 5; i++) s = advanceRows(s, i, { x: i, y: 0 }, rows)
      expect(lagBall(s).x).toBe(5)
    }
  })

  it("switches rows on a change of possession and keeps them over loose and dead balls", () => {
    expect(rowFor("home", "home", false, "out")).toBe("in")
    expect(rowFor("home", "home", true, "in")).toBe("gk")
    expect(rowFor("home", "away", false, "in")).toBe("out")
    expect(rowFor("home", null, false, "gk")).toBe("gk")
    let s = initAnchorState({ x: 0, y: 0 }, 0.1, pos, { home: "in", away: "out" })
    s = advanceRows(s, 40, { x: 0, y: 0 }, { home: "out", away: "gk" })
    expect(s.teams.home).toEqual({ row: "out", prev: "in", since: 40, drift: { u: 0, y: 0 } })
    expect(s.teams.away).toEqual({ row: "gk", prev: "out", since: 40, drift: { u: 0, y: 0 } })
    const same = advanceRows(s, 41, { x: 0, y: 0 }, { home: "out", away: "gk" })
    expect(same.teams.home.since).toBe(40)
  })
})

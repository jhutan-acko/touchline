import { describe, expect, it } from "vitest"
import { advanceRows, blendFor, commitSide, holdBall, initAnchorState, lagBall, outShare, rowFor, ruleAnchor, settled, slotGeometry, type AnchorInput, type Blend } from "../src/anchor.js"
import { driftFor } from "../src/drift.js"
import type { Side } from "../src/geometry.js"
import { DEFAULT_PARAMS as P, type ShapeRow } from "../src/params.js"
import { anchorFor, FORMATIONS } from "../src/shape.js"
import { STYLES } from "../src/testing.js"
import type { AnchorState, FormationName, TeamShapeState, TeamStyle } from "../src/types.js"

const pos = { ...P.positioning, rule: 1 }
const PITCH_HALF = 52.5
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
      for (let i = 1; i <= n + 5; i++) s = advanceRows(s, i, { x: i, y: 0 }, rows, dt, pos)
      expect(lagBall(s).x).toBe(5)
    }
  })

  it("switches rows on a change of possession and keeps them over loose and dead balls", () => {
    expect(rowFor("home", "home", false, "out")).toBe("in")
    expect(rowFor("home", "home", true, "in")).toBe("gk")
    expect(rowFor("home", "away", false, "in")).toBe("out")
    expect(rowFor("home", null, false, "gk")).toBe("gk")
    let s = initAnchorState({ x: 0, y: 0 }, 0.1, pos, { home: "in", away: "out" })
    s = advanceRows(s, 40, { x: 0, y: 0 }, { home: "out", away: "gk" }, 0.1, pos)
    expect(s.teams.home).toMatchObject({ row: "out", prev: "in", since: 40, drift: { u: 0, y: 0 }, capped: true })
    expect(s.teams.away).toMatchObject({ row: "gk", prev: "out", since: 40, drift: { u: 0, y: 0 } })
    expect(s.teams.away.capped).toBeUndefined()
    const same = advanceRows(s, 41, { x: 0, y: 0 }, { home: "out", away: "gk" }, 0.1, pos)
    expect(same.teams.home.since).toBe(40)
  })
})

describe("Task 7b fix-ups", () => {
  const ball = { x: 5, y: 4 }
  const anchorOf = (st: AnchorState, slot: number, tick: number, b = ball) =>
    at("4-4-2", slot, b, { ...still(st.teams.home.row), blend: blendFor(st.teams.home, slotGeometry("4-4-2", FORMATIONS["4-4-2"], slot).group, tick, 0.1, pos) })
  const flip = (st: AnchorState, tick: number, home: ShapeRow, away: ShapeRow) => advanceRows(st, tick, ball, { home, away }, 0.1, pos)

  it("a flip back partway through a blend starts from where the blend stands, not from the full previous row", () => {
    let st = initAnchorState(ball, 0.1, pos, { home: "in", away: "out" })
    st = flip(st, 0, "out", "in")
    st = flip(st, 10, "in", "out") // 1 s into the in -> out blend, the ball changes hands again
    for (const slot of [1, 2, 6, 9]) {
      const g = slotGeometry("4-4-2", FORMATIONS["4-4-2"], slot).group
      const before = at("4-4-2", slot, ball, { ...still("out"), blend: blendFor({ ...st.teams.home, row: "out", prev: "in", since: 0, start: undefined }, g, 10, 0.1, pos) })
      const after = anchorOf(st, slot, 10)
      const lam0 = 1 - Math.exp(-0.5 / pos.tauS[g])
      const inSpot = at("4-4-2", slot, ball, still("in"))
      // The step at the switch is the blend's head start toward the new row, from the old blended point.
      expect(after.x).toBeCloseTo(before.x + lam0 * (inSpot.x - before.x), 9)
      // The old code restarted from the full "out" row: a much larger step for slow roles.
      const fromFullOut = at("4-4-2", slot, ball, { ...still("in"), blend: { from: "out", to: "in", lamU: lam0, lamY: 0 } })
      expect(Math.abs(after.x - before.x)).toBeLessThanOrEqual(Math.abs(fromFullOut.x - before.x) + 1e-9)
    }
  })

  it("the drift offsets blend continuously across a flip too (by the mix's out share)", () => {
    let st = initAnchorState(ball, 0.1, pos, { home: "in", away: "out" })
    st = { ...st, players: { p: { offIn: { u: 4, s: -3 }, offOut: { u: -6, s: 5 }, slow: { u: 0, s: 0 } } } }
    st = flip(st, 0, "out", "in")
    const mixAt = (s: AnchorState, tick: number) => blendFor(s.teams.home, "FB", tick, 0.1, pos).mix!
    const before = mixAt(st, 20)
    const d0 = driftFor(st, "home", "p", outShare(before.u), outShare(before.y), "in", "out", 1)
    st = flip(st, 20, "in", "out")
    const after = mixAt(st, 20)
    const d1 = driftFor(st, "home", "p", outShare(after.u), outShare(after.y), "in", "out", 1)
    const lam0 = 1 - Math.exp(-0.5 / pos.tauS.FB)
    expect(outShare(after.u)).toBeCloseTo(outShare(before.u) * (1 - lam0), 9)
    expect(Math.abs(d1.u - d0.u)).toBeLessThanOrEqual(lam0 * 10 + 1e-9)
    expect(d1.y).toBeCloseTo(d0.y, 9) // lateral: the spread waits spreadDeadS after a win
  })

  it("the cap while the other keeper holds the ball eases in and out at the group's rate", () => {
    const deep = { x: 40, y: 0 }
    let st = initAnchorState(deep, 0.1, pos, { home: "out", away: "in" })
    const stU = (s: AnchorState, tick: number) =>
      at("4-3-3", 9, deep, { ...still("out", { vsKeeper: s.teams.away.row === "gk" }), blend: blendFor(s.teams.home, "ST", tick, 0.1, pos) }).x
    const free = stU(st, 0)
    expect(free).toBeGreaterThan(pos.vsKeeperCapU + 5)
    st = advanceRows(st, 100, deep, { home: "out", away: "gk" }, 0.1, pos)
    const lam = (t: number) => 1 - Math.exp(-(t + 0.5) / pos.tauS.ST)
    expect(stU(st, 100)).toBeCloseTo(free + lam(0) * (pos.vsKeeperCapU - free), 9)
    expect(stU(st, 110)).toBeCloseTo(free + lam(1) * (pos.vsKeeperCapU - free), 9)
    expect(stU(st, 100 + 600)).toBeCloseTo(pos.vsKeeperCapU, 4)
    // Released 1 s into the catch: back toward the free spot from where it stood, no jump.
    st = advanceRows(st, 110, deep, { home: "out", away: "in" }, 0.1, pos)
    const held = free + lam(1) * (pos.vsKeeperCapU - free)
    expect(stU(st, 110)).toBeCloseTo(held + lam(0) * (free - held), 9)
    // A settled, hand-built blend (restarts) still takes the cap at once.
    expect(at("4-3-3", 9, deep, still("out", { vsKeeper: true })).x).toBeCloseTo(pos.vsKeeperCapU, 9)
  })

  it("the forward-line cap eases in and out at the group's rate on a change of possession (Task 7d)", () => {
    const ball = { x: 30, y: 0 }
    const lastDefU = 20
    const cap = lastDefU - pos.lineCapM
    let st = initAnchorState(ball, 0.1, pos, { home: "out", away: "in" })
    const stU = (s: AnchorState, tick: number, extra: Partial<AnchorInput> = {}) =>
      at("4-3-3", 9, ball, { ...still("out", { lastDefU, ...extra }), blend: blendFor(s.teams.home, "ST", tick, 0.1, pos) }).x
    const free = stU(st, 0)
    expect(free).toBeGreaterThan(cap + 5)
    expect(at("4-3-3", 9, ball, still("in")).x).toBeGreaterThan(cap + 5)
    // Win the ball: the target moves from the out spot toward the cap by lambda, not onto the cap in one tick.
    st = advanceRows(st, 100, ball, { home: "in", away: "out" }, 0.1, pos)
    const lam = (t: number) => 1 - Math.exp(-(t + 0.5) / pos.tauS.ST)
    expect(stU(st, 100)).toBeCloseTo(free + lam(0) * (cap - free), 9)
    expect(stU(st, 110)).toBeCloseTo(free + lam(1) * (cap - free), 9)
    expect(stU(st, 100 + 600)).toBeCloseTo(cap, 4)
    // Lose it again 1 s in: back toward the out spot from where it stood.
    st = advanceRows(st, 110, ball, { home: "out", away: "in" }, 0.1, pos)
    const held = free + lam(1) * (cap - free)
    expect(stU(st, 110)).toBeCloseTo(held + lam(0) * (free - held), 9)
    // Settled with the ball, the cap is the hard cap on the drifted spot, as before; it holds forwards only.
    expect(at("4-3-3", 9, ball, still("in", { lastDefU, drift: { u: 6, y: 0 } })).x).toBeCloseTo(cap, 9)
    expect(at("4-3-3", 9, ball, still("gk", { lastDefU: -40 })).x).toBeCloseTo(-40 - pos.lineCapM, 9)
    const cb = (l: number | null) => at("4-3-3", 1, ball, still("in", { lastDefU: l })).x
    expect(cb(-40)).toBeCloseTo(cb(null), 9)
  })

  it("the forward-line cap follows lastDefU continuously, mid-blend and settled (Task 7d)", () => {
    const ball = { x: 30, y: 0 }
    let st = initAnchorState(ball, 0.1, pos, { home: "out", away: "in" })
    st = advanceRows(st, 100, ball, { home: "in", away: "out" }, 0.1, pos)
    for (const [tick, row] of [[105, "out"], [100 + 600, "in"]] as const) {
      let prev: number | null = null
      for (let l = -20; l <= 52.5; l += 0.1) {
        const x = at("4-3-3", 9, ball, { ...still(row, { lastDefU: l, drift: { u: 3, y: 0 } }), blend: blendFor(st.teams.home, "ST", tick, 0.1, pos) }).x
        if (prev !== null) expect(Math.abs(x - prev)).toBeLessThanOrEqual(0.1 + 1e-9)
        prev = x
      }
    }
  })

  it("the keeper moves linearly from his line spot to his row between keeperNearInM and keeperNearOutM", () => {
    expect(pos.keeperNearInM).toBe(22)
    expect(pos.keeperNearOutM).toBe(30)
    const gk = (bx: number) => at("4-4-2", 0, { x: bx, y: 0 }, still("out"))
    const line = -PITCH_HALF + pos.keeperLineM
    expect(gk(-PITCH_HALF + 21.9).x).toBeCloseTo(line, 9)
    const row = (bx: number) => Math.min(-20, Math.max(-51, -39.9 + 0.27 * bx))
    expect(gk(-PITCH_HALF + 30).x).toBeCloseTo(row(-PITCH_HALF + 30), 9)
    expect(gk(-PITCH_HALF + 26).x).toBeCloseTo(line + 0.5 * (row(-PITCH_HALF + 26) - line), 9)
    let worst = 0
    for (let d = 15; d < 40; d += 0.1) worst = Math.max(worst, Math.abs(gk(-PITCH_HALF + d + 0.1).x - gk(-PITCH_HALF + d).x))
    expect(worst).toBeLessThan(0.15)
  })

  it("commits a new side in possession only after commitTicks, at once for restarts and keeper catches", () => {
    expect(commitSide("home", "away", false, undefined, 50, 0)).toEqual({ side: "away", pending: undefined })
    const a = commitSide("home", "away", false, undefined, 50, 10)
    expect(a).toEqual({ side: null, pending: { side: "away", since: 50 } })
    expect(commitSide("home", null, false, a.pending, 55, 10)).toEqual({ side: null, pending: a.pending })
    expect(commitSide("home", "away", false, a.pending, 59, 10).side).toBeNull()
    expect(commitSide("home", "away", false, a.pending, 60, 10)).toEqual({ side: "away", pending: undefined })
    expect(commitSide("home", "home", false, a.pending, 56, 10)).toEqual({ side: "home", pending: undefined })
    expect(commitSide("home", "away", true, undefined, 50, 10)).toEqual({ side: "away", pending: undefined })
    expect(commitSide(null, "away", false, undefined, 50, 10).side).toBe("away")
  })

  it("holdBall fills the ring with one spot and records the period", () => {
    let st = initAnchorState({ x: 0, y: 0 }, 0.1, pos, { home: "in", away: "out" })
    for (let i = 1; i <= 25; i++) st = advanceRows(st, i, { x: i, y: i }, { home: "in", away: "out" }, 0.1, pos)
    const h = holdBall(st, { x: 0, y: 0 }, "second_half")
    expect(h.period).toBe("second_half")
    expect(h.ballLag.every((b) => b.x === 0 && b.y === 0)).toBe(true)
    expect(h.ballLag).toHaveLength(st.ballLag.length)
  })

  it("settled blends without a mix are unchanged: blendFor still returns settled() for a team that never switched", () => {
    const b: Blend = blendFor(team("out", "out"), "CB", 99, 0.1, pos)
    expect(b).toEqual(settled("out"))
  })
})

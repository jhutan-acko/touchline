import { readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "vitest"
import { DEFAULT_PARAMS as P, paramsFromJson, type Params } from "../src/params.js"
import { laneMarkTarget, markTarget, stepsOut } from "../src/offball.js"
import { initMatch, isFinished, markSpot, step, workAt } from "../src/step.js"
import { dist, dirOf, type Period, type Side, type Vec2 } from "../src/geometry.js"
import { kickoffPlayersFor, makeConfig } from "../src/testing.js"
import type { PlayerState } from "../src/types.js"

// The match test runs on the calibrated parameters (DEFAULT_PARAMS already marks receivers loosely).
const root = join(dirname(fileURLToPath(import.meta.url)), "../../..")
const calibrated = paramsFromJson(JSON.parse(readFileSync(join(root, "data/params/touchline-params.json"), "utf8")))

const near = (a: Vec2, b: Vec2) => {
  expect(a.x).toBeCloseTo(b.x, 9)
  expect(a.y).toBeCloseTo(b.y, 9)
}
// Both arms pin the marking numbers and every other P4 rule to 0, so that retuning the params file or switching other rules on cannot move these tests.
const pin = (p: Params, rule: number): Params => ({
  ...p,
  marking: { ...p.marking, rule, weight: 0.75, laneShare: 0.4, cbStepM: 10, dropMps: 1 },
  tackle: { ...p.tackle, rule: 0 }, fouls: { ...p.fouls, rule: 0 }, aerial: { ...p.aerial, rule: 0 },
  transition: { ...p.transition, rule: 0 }, press: { ...p.press, rule: 0 },
  firstTick: { ...p.firstTick, scopeRule: 0 }, release: { ...p.release, rejudge: 0 }
})
const on = (p: Params): Params => pin(p, 1)
const off = (p: Params): Params => pin(p, 0)

describe("lane marking (P4 A5)", () => {
  it("the marker goes weight of the way to a spot 40 % from the ball to his man", () => {
    near(laneMarkTarget({ x: -20, y: 0 }, { x: 0, y: 0 }, { x: 10, y: 10 }, 0.75, 0.4), { x: -2, y: 3 })
    near(laneMarkTarget({ x: -20, y: 0 }, { x: 0, y: 0 }, { x: 10, y: 10 }, 0, 0.4), { x: -20, y: 0 })
    // y 3 is inside the slack of 4, so the clamp does not bind (G18: not a clamp test)
    near(laneMarkTarget({ x: -20, y: 0 }, { x: 0, y: 0 }, { x: 10, y: 10 }, 0.75, 0.4, 4), { x: -2, y: 3 })
    // attacker (10, 30): unclamped y is 0.75 * 12 = 9, which binds at |anchor.y| + 4 = 4
    near(laneMarkTarget({ x: -20, y: 0 }, { x: 0, y: 0 }, { x: 10, y: 30 }, 0.75, 0.4), { x: -2, y: 9 })
    near(laneMarkTarget({ x: -20, y: 0 }, { x: 0, y: 0 }, { x: 10, y: 30 }, 0.75, 0.4, 4), { x: -2, y: 4 })
    near(laneMarkTarget({ x: -20, y: -2 }, { x: 0, y: 0 }, { x: 10, y: -30 }, 0.75, 0.4, 4), { x: -2, y: -6 })
  })

  const MIRRORS = [["home", "first_half", 1], ["home", "second_half", -1], ["away", "first_half", -1], ["away", "second_half", 1]] as const
  const fakeAttacker = (pos: Vec2, vel: Vec2, role: PlayerState["role"] = "ST"): PlayerState => ({ ...kickoffPlayersFor(makeConfig(1))[11]!, role, pos, vel })

  it("a CB follows a dropping striker up to 10 m, then lets him go", () => {
    for (const [side, period, k] of MIRRORS) {
      const anchor = { x: k * -30, y: 0 }
      const st = (up: number, dropSpeed: number) => fakeAttacker({ x: k * (-30 + up), y: 3 }, { x: k * dropSpeed, y: 0 })
      expect(stepsOut(anchor, st(6, 2), side, period, on(P).marking), `${side} ${period}`).toBe(true)
      expect(stepsOut(anchor, st(12, 2), side, period, on(P).marking)).toBe(false)
      expect(stepsOut(anchor, st(6, 0.5), side, period, on(P).marking)).toBe(false)
      // moving away from his own goal (not dropping)
      expect(stepsOut(anchor, st(6, -2), side, period, on(P).marking)).toBe(false)
    }
  })

  // A real work copy: a home CB in the first half marking an away striker dropping toward his own goal (+x).
  const fixture = (params: Params) => {
    let s = initMatch(makeConfig(3, { params }))
    const cb = s.players.find((p) => p.side === "home" && p.role === "CB")!
    const st = { ...s.players.find((p) => p.side === "away" && p.role === "ST")!, pos: { x: -24, y: 3 }, vel: { x: 2, y: 0 } }
    s = { ...s, players: s.players.map((p) => (p.id === st.id ? st : p)) }
    return { w: workAt(s), cb, st, anchor: { x: -30, y: 1 } as Vec2, ball: { x: 0, y: 0 } as Vec2 }
  }

  it("the step-out uses the old tight goal-side spot", () => {
    const { w, cb, st, anchor, ball } = fixture(on(P))
    expect(w.period).toBe("first_half")
    const m = w.p.marking
    const spot = markSpot(w, "home", cb.id, anchor, st, ball)
    expect(spot).toEqual(markTarget(anchor, st.pos, "home", w.period, m.goalSideM, 1, m.widthSlackM))
    expect(spot).not.toEqual(laneMarkTarget(anchor, ball, st.pos, m.weight, m.laneShare, m.widthSlackM))
  })

  it("a CB marking a striker beyond the step-out range, or a non-CB, is zonal under on", () => {
    const { w, cb, st, anchor, ball } = fixture(on(P))
    const m = w.p.marking
    const far = { ...st, pos: { x: -15, y: 3 } }
    expect(markSpot(w, "home", cb.id, anchor, far, ball)).toEqual(laneMarkTarget(anchor, ball, far.pos, m.weight, m.laneShare, m.widthSlackM))
    const fb = w.players.find((p) => p.side === "home" && p.role === "FB")!
    expect(markSpot(w, "home", fb.id, anchor, st, ball)).toEqual(laneMarkTarget(anchor, ball, st.pos, m.weight, m.laneShare, m.widthSlackM))
  })

  it("rule off marks exactly as before", () => {
    const { w, cb, st, anchor, ball } = fixture(off(P))
    const m = w.p.marking
    expect(markSpot(w, "home", cb.id, anchor, st, ball)).toEqual(markTarget(anchor, st.pos, "home", w.period, m.goalSideM, m.weight, m.widthSlackM))
  })

  it("in matches, receivers are marked less tightly", () => {
    // Like the passing diagnostic: open-play passes completed, the receiver's nearest opponent at the release tick under 3 m.
    const tight = (params: Params, seed: number) => {
      let s = initMatch(makeConfig(seed, { params }))
      const snaps = new Map<number, ReadonlyArray<PlayerState>>()
      let n = 0, t = 0
      while (!isFinished(s)) {
        const r = step(s)
        s = r.state
        snaps.set(s.tick, s.players)
        snaps.delete(s.tick - 200)
        for (const e of r.events) {
          if (e.type !== "pass" || e.outcome !== "successful" || e.attrs.restart || typeof e.attrs.receiver_id !== "string") continue
          const ps = snaps.get(e.frame_id) ?? snaps.get(e.frame_id + 1) ?? snaps.get(e.frame_id - 1)
          const rcv = ps?.find((p) => p.id === e.attrs.receiver_id)
          if (!ps || !rcv) continue
          let m = Infinity
          for (const o of ps) if (o.side !== rcv.side && !o.sentOff) m = Math.min(m, dist(o.pos, rcv.pos))
          n++
          if (m < 3) t++
        }
      }
      return { n, t }
    }
    const share = (params: Params) => {
      const a = tight(params, 7), b = tight(params, 9)
      return { n: Math.min(a.n, b.n), share: (a.t + b.t) / (a.n + b.n) }
    }
    const FLOOR = 0.09
    const a = share(off(calibrated)), b = share(on(calibrated))
    // The off arm must be tight enough for the comparison to mean something (seeds 7 and 9 read about 0.1 here).
    expect(a.share).toBeGreaterThan(FLOOR)
    expect(a.n).toBeGreaterThanOrEqual(400)
    expect(b.n).toBeGreaterThanOrEqual(400)
    expect(b.share).toBeLessThan(a.share)
  }, 600_000)
})

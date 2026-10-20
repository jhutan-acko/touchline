/**
 * S9 direct free kicks (realism v2 P5, plan 8e Task 8, ruling 14): a central attacking-third free kick within
 * directFk.maxDistanceM may be shot; its logit gains shotShift and its xG is the open-play xG with no wall in the cone,
 * offset by xgLogit on the logit scale (the wall still blocks in planShot).
 */
import { describe, expect, it } from "vitest"
import { decide, restartShot, xgOf, type DecisionInput } from "../src/decide.js"
import { dist, goalOf, type Period, type Vec2 } from "../src/geometry.js"
import { DEFAULT_PARAMS as P, type Params } from "../src/params.js"
import { Rng, seedRng } from "../src/rng.js"
import { initMatch, step } from "../src/step.js"
import { kickoffPlayersFor, makeConfig, STYLES } from "../src/testing.js"
import type { DomainEvent, MatchState, PlayerState } from "../src/types.js"

const withFk = (fk: Partial<Params["directFk"]>, base: Params = P): Params => ({ ...base, directFk: { ...base.directFk, ...fk } })
const on = withFk({ rule: 1 })

const players = kickoffPlayersFor(makeConfig(1))
const home = players.filter((p) => p.side === "home"), away = players.filter((p) => p.side === "away")
const taker = (pos: Vec2): PlayerState => ({ ...home[9]!, pos })

const input = (pos: Vec2, period: Period = "first_half", opponents: ReadonlyArray<PlayerState> = away): DecisionInput => ({
  period, owner: taker(pos), teammates: home, opponents, style: STYLES.possession, scoreDiff: 0, minute: 30, restart: "free_kick", scriptBias: {}
})

/** restartShot as decide calls it (goal distance and the team-frame u computed the same way). */
const rsAt = (inp: DecisionInput, p: Params) => {
  const g = goalOf(inp.owner.side, inp.period)
  const ax = (g.x > 0 ? 1 : -1) * inp.owner.pos.x
  return restartShot(inp, p, dist(inp.owner.pos, g), ax)
}

const sigmoid = (z: number) => 1 / (1 + Math.exp(-z))
const logit = (q: number) => Math.log(q / (1 - q))

describe("S9 direct free kicks", () => {
  it("a central attacking free kick may be shot", () => {
    expect(rsAt(input({ x: 25, y: 4 }), on)?.available).toBe(true)
    // wide, not in the attacking third, and central in the attacking third but beyond 35 m (39.9 m; F24)
    expect(rsAt(input({ x: 25, y: 25 }), on)).toBeNull()
    expect(rsAt(input({ x: 10, y: 4 }), on)).toBeNull()
    expect(dist({ x: 18, y: 20 }, goalOf("home", "first_half"))).toBeGreaterThan(35)
    expect(rsAt(input({ x: 18, y: 20 }), on)).toBeNull()
    // the plan's (17, 0) is outside the attacking third as well
    expect(rsAt(input({ x: 17, y: 0 }), on)).toBeNull()
    // the second half: home attacks -x
    expect(rsAt(input({ x: -25, y: 4 }, "second_half"), on)?.available).toBe(true)
    expect(rsAt(input({ x: 25, y: 4 }, "second_half"), on)).toBeNull()
    // only free kicks, and nothing under rule 0
    expect(rsAt({ ...input({ x: 25, y: 4 }), restart: null }, on)).toBeNull()
    expect(rsAt(input({ x: 25, y: 4 }), withFk({ shotShift: 2, xgLogit: 0.5 }))).toBeNull()
  })

  it("the free-kick xG ignores the wall and adds xgLogit", () => {
    const pos = { x: 25, y: 4 }
    const g = goalOf("home", "first_half")
    const u = { x: (g.x - pos.x) / dist(pos, g), y: (g.y - pos.y) / dist(pos, g) }
    const wall = [-0.6, 0, 0.6].map((off, i): PlayerState => ({ ...away[i + 2]!, pos: { x: pos.x + 9.15 * u.x - off * u.y, y: pos.y + 9.15 * u.y + off * u.x } }))
    const opps = [...wall, ...away.filter((o) => !wall.some((w) => w.id === o.id))]
    // precondition: the wall lowers the open-play xG, so ignoring it is visible
    expect(xgOf(P, "home", "first_half", pos, false, 3)).toBeLessThan(xgOf(P, "home", "first_half", pos, false, 0))
    const x0 = xgOf(P, "home", "first_half", pos, false, 0)
    for (const xgLogit of [0, 0.5]) {
      const p = withFk({ rule: 1, xgLogit })
      const rs = rsAt(input(pos, "first_half", opps), p)!
      expect(rs.xg).toBeCloseTo(sigmoid(logit(x0) + xgLogit), 10)
      expect(rs.shift).toBe(p.directFk.shotShift)
      // decide records this xG on the shot
      const r = new Rng(seedRng(5))
      const forced = withFk({ rule: 1, xgLogit, shotShift: 10 })
      const d = decide(input(pos, "first_half", opps), forced, r)
      expect(d.action).toBe("shot")
      expect(d.xg).toBeCloseTo(rs.xg, 10)
    }
  })

  it("the shift moves the shot share", () => {
    const share = (p: Params, n = 2000) => {
      const r = new Rng(seedRng(11))
      let k = 0
      for (let i = 0; i < n; i++) if (decide(input({ x: 25, y: 4 }), p, r).action === "shot") k++
      return k / n
    }
    const s0 = share(withFk({ rule: 1, shotShift: 0 })), s1 = share(withFk({ rule: 1, shotShift: 1 }))
    expect(s1).toBeGreaterThan(s0)
    // off: the values do nothing, and the share is today's
    expect(share(withFk({ rule: 0, shotShift: 2, xgLogit: 0.5 }))).toBe(share(P))
  })

  it("a direct free kick is a shot event with technique free_kick", () => {
    const p = withFk({ rule: 1, shotShift: 10 })
    const fk = { x: 25, y: 4 }
    const s0 = initMatch(makeConfig(7, { params: p }))
    let s: MatchState = {
      ...s0, tick: 50, periodTick: 50,
      phase: { kind: "restart", restart: "free_kick", side: "home", at: fk, resumeTick: 51 },
      possession: { kind: "dead" }, ball: { pos: { ...fk, z: 0 }, vel: { x: 0, y: 0, z: 0 } }
    }
    let setPiece: DomainEvent | undefined
    let shot: DomainEvent | undefined
    for (let i = 0; i < 2000 && !shot; i++) {
      const r = step(s)
      for (const e of r.events) {
        if (e.type === "set_piece" && !setPiece) setPiece = e
        if (e.type === "shot" && !shot) shot = e
      }
      // the first touch after the restart must be the shot (no pass first)
      if (setPiece && !shot) expect(r.events.filter((e) => e.type === "pass")).toEqual([])
      s = r.state
    }
    expect(setPiece?.attrs.kind).toBe("free_kick")
    expect(shot).toBeDefined()
    expect(shot!.player_id).toBe(setPiece!.player_id)
    expect(shot!.attrs.technique).toBe("free_kick")
    // the shot event is placed where the taker struck it
    const struck = { x: shot!.x!, y: shot!.y! }
    expect(dist(struck, fk)).toBeLessThan(1.5)
    const rs = rsAt(input(struck), p)
    expect(rs).not.toBeNull()
    expect(shot!.attrs.xg as number).toBeCloseTo(rs!.xg, 3)
  })
})

import { describe, expect, it } from "vitest"
import { bearingOf, supportCount, tackleLogit } from "../src/duel.js"
import { attackX, dirOf, PITCH } from "../src/geometry.js"
import { DEFAULT_PARAMS as P, type Params } from "../src/params.js"
import { initMatch, isFinished, step, tackleWinLogit, workAt } from "../src/step.js"
import { kickoffPlayersFor, makeConfig } from "../src/testing.js"
import type { MatchState, PlayerState } from "../src/types.js"

// Explicit switched-off and switched-on engines (ruling F4): never rely on DEFAULT_PARAMS being off.
const off: Params = { ...P, tackle: { ...P.tackle, rule: 0 } }
const on: Params = { ...P, tackle: { ...P.tackle, rule: 1 } }
const t = on.tackle
// The in-match test measures T2 alone: every other P4 switch is pinned to 0, so Task 10's switch-on cannot move it.
const onAlone: Params = {
  ...on,
  fouls: { ...on.fouls, rule: 0 }, aerial: { ...on.aerial, rule: 0 }, transition: { ...on.transition, rule: 0 },
  press: { ...on.press, rule: 0 }, marking: { ...on.marking, rule: 0 },
  firstTick: { ...on.firstTick, scopeRule: 0 }, release: { ...on.release, rejudge: 0 }
}

const base = kickoffPlayersFor(makeConfig(1))
const at = (p: PlayerState, x: number, y: number, vx = 0, vy = 0): PlayerState => ({ ...p, pos: { x, y }, vel: { x: vx, y: vy } })

describe("T2: bearing", () => {
  it("front within 60 degrees of the carrier's run, behind from 120, the attack direction when he stands", () => {
    const c = { x: 0, y: 0 }
    const run = { x: 3, y: 0 }
    expect(bearingOf(c, run, 1, { x: 2, y: 0.5 }, t)).toBe("front")
    expect(bearingOf(c, run, 1, { x: -2, y: 0 }, t)).toBe("behind")
    expect(bearingOf(c, run, 1, { x: 0, y: 2 }, t)).toBe("side")
    // 59 and 61 degrees, 119 and 121 degrees
    const ang = (deg: number) => ({ x: Math.cos((deg * Math.PI) / 180), y: Math.sin((deg * Math.PI) / 180) })
    expect(bearingOf(c, run, 1, ang(59), t)).toBe("front")
    expect(bearingOf(c, run, 1, ang(61), t)).toBe("side")
    expect(bearingOf(c, run, 1, ang(119), t)).toBe("side")
    expect(bearingOf(c, run, 1, ang(121), t)).toBe("behind")
    // standing (0.5 m/s < headingMinMps), attacking -x: the defender at -x is in front
    const slow = { x: 0.5, y: 0 }
    expect(bearingOf(c, slow, -1, { x: -2, y: 0 }, t)).toBe("front")
    expect(bearingOf(c, slow, -1, { x: 2, y: 0 }, t)).toBe("behind")
    // no NaN at speed 0 or with the tackler on top of the carrier
    for (const b of [bearingOf(c, { x: 0, y: 0 }, 1, { x: 1, y: 0 }, t), bearingOf(c, { x: 0, y: 0 }, -1, c, t), bearingOf(c, run, 1, c, t)])
      expect(["front", "side", "behind"]).toContain(b)
    expect(bearingOf(c, { x: 0, y: 0 }, 1, { x: 1, y: 0 }, t)).toBe("front")
  })
})

describe("T2: support", () => {
  it("counts other outfield defenders within 5 m, not the tackler, keepers or the sent off", () => {
    const carrier = { x: 0, y: 0 }
    const tackler = at(base[13]!, 1, 0)
    const cb = at({ ...base[12]!, role: "CB" }, 4, 0)
    const cm = at({ ...base[14]!, role: "CM" }, 6, 0)
    const gk = at({ ...base[11]!, role: "GK" }, 3, 0)
    const sentOff = { ...at({ ...base[15]!, role: "FB" }, 2, 0), sentOff: true }
    expect(supportCount(carrier, tackler.id, [tackler, cb, cm, gk, sentOff], 5)).toBe(1)
    // the fixture is not vacuous: each excluded player would count if he were an eligible outfielder
    expect(supportCount(carrier, "nobody", [tackler, cb, cm, gk, sentOff], 5)).toBe(2)
    expect(supportCount(carrier, tackler.id, [cm], 6)).toBe(1)
  })
})

describe("T2: the terms", () => {
  const L = (bearing: "front" | "side" | "behind", support: number, speed: number, inBox: boolean) => tackleLogit(0, 0, bearing, support, speed, inBox, t)
  it("add as the spec says", () => {
    expect(L("front", 0, 0, false) - L("behind", 0, 0, false)).toBeCloseTo(0.7, 9)
    expect(L("side", 0, 0, false)).toBeCloseTo(0, 9)
    expect(L("side", 3, 0, false) - L("side", 0, 0, false)).toBeCloseTo(0.8, 9)
    expect(L("side", 1, 0, false) - L("side", 0, 0, false)).toBeCloseTo(0.4, 9)
    expect(L("side", 0, 4, false) - L("side", 0, 0, false)).toBeCloseTo(-0.4, 9)
    expect(L("side", 0, 0, true) - L("side", 0, 0, false)).toBeCloseTo(0.3, 9)
    expect(tackleLogit(0.2, 0.1, "side", 0, 0, false, t)).toBeCloseTo(0.5, 9)
  })
})

/** A state with one tackle in prospect: `owner` on the ball at (ox, 0) running (vx, 0), `def` at (dx, dy), optional extra defenders. */
const oneTackle = (p: Params, o: { side?: "home" | "away"; period?: MatchState["period"]; ox: number; vx: number; dx: number; dy: number; extra?: ReadonlyArray<[number, number]> }): { s: MatchState; def: PlayerState; owner: PlayerState } => {
  const s0 = initMatch(makeConfig(3, { params: p }))
  const pls = kickoffPlayersFor(makeConfig(3, { params: p }))
  const cs = o.side ?? "home"
  const own = at(pls.find((x) => x.side === cs && x.role === "CM")!, o.ox, 0, o.vx, 0)
  const defs = pls.filter((x) => x.side !== cs && x.role !== "GK")
  const def = at(defs[0]!, o.dx, o.dy)
  const extra = (o.extra ?? []).map(([x, y], i) => at(defs[i + 1]!, x, y))
  const moved = new Map<string, PlayerState>([[own.id, own], [def.id, def], ...extra.map((e) => [e.id, e] as const)])
  const players = pls.map((x) => moved.get(x.id) ?? (x.role === "GK" ? x : at(x, x.side === "home" ? -40 : 40, 25 + (x.slot % 11))))
  const s: MatchState = { ...s0, period: o.period ?? s0.period, players, possession: { kind: "owned", playerId: own.id, since: 0, restart: null } }
  return { s, def: moved.get(def.id)!, owner: own }
}

/** The logit without the skill term, so fixtures with different players compare only the situational terms. */
const situational = (f: { s: MatchState; def: PlayerState; owner: PlayerState }): number => tackleWinLogit(workAt(f.s), f.def, f.owner) - 3 * (f.def.attrs.tackling - f.owner.attrs.dribbling)

describe("T2: the seam", () => {
  it("rule off reproduces the old logit", () => {
    const { s, def, owner } = oneTackle(off, { ox: 10, vx: 3, dx: 11, dy: 0, extra: [[12, 1], [12, -1]] })
    const w = workAt(s)
    expect(tackleWinLogit(w, def, owner)).toBeCloseTo(off.defending.tackleBase + 3 * (def.attrs.tackling - owner.attrs.dribbling), 12)
  })
  it("rule on adds the terms to the same fixture, and mirrors in the second half", () => {
    const fix = { ox: 10, vx: 3, dx: 11, dy: 0, extra: [[12, 1], [12, -1]] as Array<[number, number]> }
    const a = oneTackle(off, fix), b = oneTackle(on, fix)
    const oldL = tackleWinLogit(workAt(a.s), a.def, a.owner)
    // preconditions: a front tackler, two supporters within 5 m, speed 3, and the carrier is not in the box he attacks
    expect(bearingOf(b.owner.pos, b.owner.vel, dirOf(b.owner.side, "first_half"), b.def.pos, t)).toBe("front")
    expect(supportCount(b.owner.pos, b.def.id, b.s.players.filter((x) => x.side === b.def.side), t.supportM)).toBe(2)
    expect(attackX(b.owner.side, b.owner.pos.x, "first_half")).toBeLessThan(PITCH.halfL - PITCH.boxDepth)
    const newL = tackleWinLogit(workAt(b.s), b.def, b.owner)
    expect(newL - oldL).toBeCloseTo(t.base + t.frontLogit + 2 * t.supportLogit + t.speedLogit * 3, 9)
    // second half (moving at 3 m/s, so this checks the mirrored geometry, not the standing-carrier branch): the mirrored picture gives the same logit
    const m = oneTackle(on, { ox: -10, vx: -3, dx: -11, dy: 0, extra: [[-12, 1], [-12, -1]], period: "second_half" })
    expect(tackleWinLogit(workAt(m.s), m.def, m.owner)).toBeCloseTo(newL, 9)
    // box: home in the first half attacking +x from u = 45, |y| < 20
    const inBox = oneTackle(on, { ox: 45, vx: 0, dx: 46, dy: 0 })
    const outBox = oneTackle(on, { ox: 30, vx: 0, dx: 31, dy: 0 })
    expect(tackleWinLogit(workAt(inBox.s), inBox.def, inBox.owner) - tackleWinLogit(workAt(outBox.s), outBox.def, outBox.owner)).toBeCloseTo(t.boxLogit, 9)
    // an away carrier attacks -x in the first half: the same pictures mirrored give the same terms
    const away = oneTackle(on, { side: "away", ox: -10, vx: -3, dx: -11, dy: 0, extra: [[-12, 1], [-12, -1]] })
    expect(away.owner.side).toBe("away")
    expect(bearingOf(away.owner.pos, away.owner.vel, dirOf("away", "first_half"), away.def.pos, t)).toBe("front")
    expect(situational(away)).toBeCloseTo(situational(b), 9)
    const awayBox = oneTackle(on, { side: "away", ox: -45, vx: 0, dx: -46, dy: 0 })
    const awayOut = oneTackle(on, { side: "away", ox: -30, vx: 0, dx: -31, dy: 0 })
    expect(attackX("away", awayBox.owner.pos.x, "first_half")).toBeGreaterThan(PITCH.halfL - PITCH.boxDepth)
    expect(situational(awayBox) - situational(awayOut)).toBeCloseTo(t.boxLogit, 9)
    expect(situational(awayBox)).toBeCloseTo(situational(inBox), 9)
    // a standing carrier (0.5 m/s) uses the attack direction: the tackler ahead of him is front, home and away
    for (const [side, sx, per] of [["home", 1, "first_half"], ["away", -1, "first_half"], ["home", -1, "second_half"]] as const) {
      const f = oneTackle(on, { side, period: per, ox: 10 * sx, vx: 0.5 * sx, dx: 11 * sx, dy: 0 })
      const g = oneTackle(on, { side, period: per, ox: 10 * sx, vx: 0.5 * sx, dx: 9 * sx, dy: 0 })
      expect(situational(f) - situational(g), `${side} ${per}`).toBeCloseTo(t.frontLogit - t.behindLogit, 9)
    }
    const inBox2 = oneTackle(on, { ox: -45, vx: 0, dx: -46, dy: 0, period: "second_half" })
    const wasBox = tackleWinLogit(workAt(inBox2.s), inBox2.def, inBox2.owner)
    expect(wasBox).toBeCloseTo(tackleWinLogit(workAt(inBox.s), inBox.def, inBox.owner), 9)
  })
})

type Bin = { n: number; won: number }
const rate = (b: Bin) => b.won / b.n
const bins = (p: Params, seed: number, dt: number) => {
  const front: Bin = { n: 0, won: 0 }, behind: Bin = { n: 0, won: 0 }, support: Bin = { n: 0, won: 0 }, alone: Bin = { n: 0, won: 0 }
  let s = initMatch(makeConfig(seed, { params: p, dt }))
  while (!isFinished(s)) {
    const before = s
    const r = step(s)
    s = r.state
    for (const e of r.events) {
      if (e.type !== "tackle") continue
      // G2: an attempt is lost or foul, or won with the ball attribute (lost take-ons also emit a "won" tackle, without it)
      const attempt = e.outcome === "lost" || e.outcome === "foul" || (e.outcome === "won" && e.attrs.ball !== undefined)
      if (!attempt) continue
      const def = before.players.find((x) => x.id === e.player_id)!
      const owner = before.players.find((x) => x.id === e.attrs.opponent_id)!
      const won = e.outcome === "won" ? 1 : 0
      const dir = dirOf(owner.side, before.period)
      const bearing = bearingOf(owner.pos, owner.vel, dir, def.pos, p.tackle)
      const n = supportCount(owner.pos, def.id, before.players.filter((x) => x.side === def.side && !x.sentOff), p.tackle.supportM)
      const put = (b: Bin) => { b.n++; b.won += won }
      if (bearing === "front") put(front)
      if (bearing === "behind") put(behind)
      put(n >= 1 ? support : alone)
    }
  }
  return { front, behind, support, alone }
}
const pool = (rs: ReturnType<typeof bins>[]): ReturnType<typeof bins> => {
  const sum = (k: keyof ReturnType<typeof bins>): Bin => ({ n: rs.reduce((a, r) => a + r[k].n, 0), won: rs.reduce((a, r) => a + r[k].won, 0) })
  return { front: sum("front"), behind: sum("behind"), support: sum("support"), alone: sum("alone") }
}

describe("T2 in matches", () => {
  // Twelve seeds at dt 0.1 (G6 as amended): six seeds left the support gap too close to its bound for sampling noise.
  it("front beats behind and support helps at dt 0.1 (twelve seeds, 7 to 29)", () => {
    const r = pool([7, 9, 11, 13, 15, 17, 19, 21, 23, 25, 27, 29].map((sd) => bins(onAlone, sd, 0.1)))
    for (const k of ["front", "behind", "support", "alone"] as const) expect(r[k].n, k).toBeGreaterThanOrEqual(30)
    expect(rate(r.front) - rate(r.behind)).toBeGreaterThan(0.05)
    expect(rate(r.support) - rate(r.alone)).toBeGreaterThan(0.1)
  }, 600_000)
  it("the same signs hold at dt 0.04 (seeds 7 and 9, floor 15)", () => {
    const r = pool([7, 9].map((sd) => bins(onAlone, sd, 0.04)))
    for (const k of ["front", "behind", "support", "alone"] as const) expect(r[k].n, k).toBeGreaterThanOrEqual(15)
    expect(rate(r.front) - rate(r.behind)).toBeGreaterThan(0)
    expect(rate(r.support) - rate(r.alone)).toBeGreaterThan(0)
  }, 600_000)
})

import { readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "vitest"
import { contactDecision, type ContactPlan } from "../src/contact.js"
import { xgOf } from "../src/decide.js"
import { actionZone } from "../src/geometry.js"
import { headerEligible, headerHow, headShare } from "../src/header.js"
import { DEFAULT_PARAMS as P, paramsFromJson, type Params } from "../src/params.js"
import { Rng, seedRng } from "../src/rng.js"
import { planShot } from "../src/shot.js"
import { executeContact, headerPlan, initMatch, isFinished, step, workAt } from "../src/step.js"
import type { DomainEvent, Flight, MatchState, PlayerState } from "../src/types.js"
import { kickoffPlayersFor, makeConfig } from "../src/testing.js"

// Explicit switched-off and switched-on engines (never DEFAULT_PARAMS as "off"): every P6 rule 0, then header.rule 1.
const off: Params = {
  ...P,
  firstTime: { ...P.firstTime, rule: 0 },
  header: { ...P.header, rule: 0 },
  saveGeo: { ...P.saveGeo, rule: 0 },
  execFatigue: { ...P.execFatigue, rule: 0 },
  shotModel: { ...P.shotModel, rule: 0 }
}
const on: Params = { ...off, header: { ...off.header, rule: 1 } }
const onWith = (h: Partial<Params["header"]>, rest: Partial<Params> = {}): Params => ({ ...on, ...rest, header: { ...on.header, ...h } })
const sigmoid = (z: number): number => 1 / (1 + Math.exp(-z))

const base = kickoffPlayersFor(makeConfig(1))
const at = (p: PlayerState, x: number, y: number): PlayerState => ({ ...p, pos: { x, y }, vel: { x: 0, y: 0 } })
const PASSER = base[9]!.id
const STRIKER = base[10]!.id
const DEFENDER = base[13]!.id

/** A state in open play (after the kickoff), with players placed as given. */
const openPlay = (p: Params, place: Record<string, { x: number; y: number }> = {}, dt = 0.1): MatchState => {
  let s = initMatch(makeConfig(1, { params: p, dt }))
  while (s.phase.kind !== "open_play") s = step(s).state
  return { ...s, players: s.players.map((x) => (place[x.id] ? { ...x, pos: place[x.id]!, vel: { x: 0, y: 0 } } : x)) }
}

/**
 * A cross from (30, 25) that the home striker at `to` receives on the next tick, the ball about `z` m up as it reaches
 * him (home attacks +x in the first half). The flight is the shape releaseKick gives a successful pass: a reception extra.
 */
const crossArriving = (p: Params, to: { x: number; y: number }, z: number): MatchState => {
  const s0 = openPlay(p, { [PASSER]: { x: 30, y: 25 }, [STRIKER]: to })
  const pending = { type: "pass" as const, frame_id: s0.tick - 8, team_id: "home-fc", player_id: PASSER, x: 30, y: 25, x_end: to.x, y_end: to.y, attrs: { kind: "cross", restart: null } }
  const reception = { ...pending, type: "reception" as const, frame_id: s0.tick + 1, player_id: STRIKER, x: to.x, y: to.y, attrs: { first_touch: "controlled", under_pressure: false } }
  const flight: Flight = {
    kind: "pass", fromId: PASSER, side: "home", releaseTick: s0.tick - 8, resolveTick: s0.tick + 1, winnerId: STRIKER, outcome: "successful",
    pending, extra: [reception], path: null, restartAfter: null, looseBall: null, deflectTo: null
  }
  // Released 5 cm above z: stepBall drops it about that much in the resolve tick at dt 0.1, so the header seam sees about
  // z. A case that calls headerPlan directly (no step) sets the ball's z itself.
  return { ...s0, ball: { pos: { x: to.x - 0.8, y: to.y + 0.6, z: z + 0.05 }, vel: { x: 8, y: -6, z: 0 } }, possession: { kind: "in_flight", flight } }
}

/** Step until a shot is released and resolved (or `n` ticks), collecting events. */
const stepFor = (s0: MatchState, n: number, until: (e: DomainEvent) => boolean = () => false): { events: DomainEvent[]; state: MatchState } => {
  let s = s0
  const events: DomainEvent[] = []
  for (let i = 0; i < n; i++) {
    const r = step(s)
    s = r.state
    events.push(...r.events)
    if (r.events.some(until)) break
  }
  return { events, state: s }
}

describe("SH2: who may head (header.ts)", () => {
  it("eligible for a contact between 1.0 and 2.4 m in the box he attacks, mirrored", () => {
    const h = on.header
    expect(headerEligible(1.5, true, false, h)).toBe(true)
    expect(headerEligible(0.8, true, false, h)).toBe(false)
    expect(headerEligible(2.6, true, false, h)).toBe(false)
    expect(headerEligible(1.5, false, false, h)).toBe(false)
    expect(headerEligible(1.5, true, true, h)).toBe(false)
    // The band's ends are kinematics.controlHeightM and headerHeightM, and both count.
    expect(headerEligible(1.0, true, false, h)).toBe(true)
    expect(headerEligible(2.4, true, false, h)).toBe(true)
    // Home attacks +x in the first half and -x in the second.
    expect(actionZone("home", "first_half", { x: 45, y: 0 }) === "box").toBe(true)
    expect(actionZone("home", "first_half", { x: -45, y: 0 }) === "box").toBe(false)
    expect(actionZone("home", "second_half", { x: -45, y: 0 }) === "box").toBe(true)
    expect(actionZone("away", "first_half", { x: -45, y: 0 }) === "box").toBe(true)
    expect(actionZone("home", "first_half", { x: 45, y: 21 }) === "box").toBe(false)
    expect(actionZone("home", "first_half", { x: 30, y: 0 }) === "box").toBe(false)
  })

  it("header xG is below foot xG at the same spot, and better headers head more", () => {
    const spot = { x: 44, y: 3 }
    const xgHead = xgOf(on, "home", "first_half", spot, true, 0)
    expect(xgHead).toBeLessThan(xgOf(on, "home", "first_half", spot, false, 0))
    const h = on.header
    expect(headShare(xgHead, 0.8, 0, h)).toBeGreaterThan(headShare(xgHead, 0.4, 0, h))
    expect(headShare(xgHead, 0.7, 0.5, h)).toBeCloseTo(sigmoid(h.b0 + h.bXg * xgHead + h.bHeading * 0.1 + 0.5), 12)
    // A script's shot nudge makes a header likelier.
    expect(headShare(xgHead, 0.6, 1, h)).toBeGreaterThan(headShare(xgHead, 0.6, 0, h))
  })
})

describe("SH2: the header shot", () => {
  const shooter = at(base[10]!, 42, 2)

  it("a header starts at the contact height, flies slower and aims by heading", () => {
    const how = headerHow(0.6, 1.8, on.header)
    expect(how).toEqual({ header: true, firstTime: true, mods: { skill: 0.6, aimY: 1.3, aimZ: 1.3, fromZ: 1.8, speed: 0.55 } })
    // From equal rng states (no opponents: nothing blocks, no keeper), the header takes longer to arrive.
    for (let seed = 1; seed <= 20; seed++) {
      const foot = planShot(shooter, "home", "first_half", [], 0.1, 0, false, on, 0.1, new Rng(seedRng(seed)), false, {})
      const head = planShot(shooter, "home", "first_half", [], 0.1, 0, false, on, 0.1, new Rng(seedRng(seed)), false, how.mods)
      expect(head.ticks).toBeGreaterThan(foot.ticks)
      expect(head.from.z).toBe(1.8)
      expect(foot.from.z).toBe(0.2)
    }
    // Over 4000 draws a good header hits the target more often than a poor one.
    const onTargetShare = (heading: number): number => {
      const rng = new Rng(seedRng(11))
      const n = 4000
      let hit = 0
      for (let i = 0; i < n; i++) if (planShot(shooter, "home", "first_half", [], 0.1, 0, false, on, 0.1, rng, false, headerHow(heading, 1.8, on.header).mods).onTarget) hit++
      return hit / n
    }
    const good = onTargetShare(0.9), poor = onTargetShare(0.3)
    expect(good).toBeGreaterThan(poor + 0.05)
  })

  it("the shot event is headed and draws no weaker foot", () => {
    const s = openPlay(on, { [STRIKER]: { x: 42, y: 2 } })
    const plan = (header: boolean): ContactPlan => ({
      kind: "shot",
      decision: contactDecision({ shot: 1, hold: 0 }, "shot", null, [], 0.1, 0),
      how: { ...headerHow(0.6, 1.8, on.header), header }
    })
    const flight = crossArriving(on, { x: 42, y: 2 }, 1.8).possession
    const f = flight.kind === "in_flight" ? flight.flight : null
    // Equal execution states, chosen so that the foot shot's weak-foot draw comes out "stronger foot": the two planShot
    // calls then see the same inputs once the header has skipped that draw.
    let seed = 1
    while (new Rng(seedRng(seed)).chance(0.2)) seed++
    expect(new Rng(seedRng(seed)).chance(0.2)).toBe(false)
    const wFoot = workAt(s)
    wFoot.rng.execution = new Rng(seedRng(seed))
    executeContact(wFoot, f!, wFoot.player(STRIKER), plan(false))
    const wHead = workAt(s)
    wHead.rng.execution = new Rng(seedRng(seed))
    wHead.rng.execution.chance(0.2)
    executeContact(wHead, f!, wHead.player(STRIKER), plan(true))
    // The header's execution stream ends where the foot shot's does after one more chance: one fewer draw.
    expect(wHead.rng.execution.state).toEqual(wFoot.rng.execution.state)
    const shotOf = (w: ReturnType<typeof workAt>) => (w.possession.kind === "in_flight" ? w.possession.flight.pending : null)
    expect(shotOf(wHead)?.type).toBe("shot")
    expect(shotOf(wHead)?.attrs).toMatchObject({ body_part: "head", first_time: true, technique: "normal" })
    expect(shotOf(wFoot)?.attrs.body_part).not.toBe("head")
  })
})

describe("SH2: the header seam (step)", () => {
  it("a header replaces the reception; a high ball outside the box is controlled", () => {
    const p = onWith({ b0: 20 })
    const s = crossArriving(p, { x: 44, y: 1 }, 1.6)
    const resolveFrame = s.tick + 1
    const { events } = stepFor(s, 40, (e) => e.type === "shot")
    const shot = events.find((e) => e.type === "shot")
    expect(shot).toBeDefined()
    expect(shot!.player_id).toBe(STRIKER)
    expect(shot!.frame_id).toBe(resolveFrame)
    expect(shot!.attrs).toMatchObject({ body_part: "head", first_time: true, technique: "normal" })
    expect(events.filter((e) => e.type === "reception")).toHaveLength(0)
    const pass = events.find((e) => e.type === "pass" && e.player_id === PASSER)
    expect(pass).toMatchObject({ outcome: "successful", frame_id_end: resolveFrame })
    // 25 m out the same high ball is controlled.
    const out = stepFor(crossArriving(p, { x: 27.5, y: 1 }, 1.6), 1)
    expect(out.events.filter((e) => e.type === "reception" && e.player_id === STRIKER)).toHaveLength(1)
    expect(out.events.some((e) => e.type === "shot")).toBe(false)
    expect(out.state.possession).toMatchObject({ kind: "owned", playerId: STRIKER })
  })

  it("after a won aerial duel the winner can head", () => {
    // A real cross (a what-if override forces it) to a striker at (44, 0), contested by a defender 1.25 m beyond him.
    // aerial.rule 1 with bHeading 100: heading 1 against 0 wins the duel. No aerial fouls, keeper stays home, no block.
    const p = onWith({ b0: 20 }, {
      aerial: { ...on.aerial, rule: 1, bHeading: 100, foulShare: 0 },
      keeper: { ...on.keeper, comeShare: 0 },
      defending: { ...on.defending, crossBlock: 0 }
    })
    const s0 = openPlay(p, { [PASSER]: { x: 30, y: 25 }, [STRIKER]: { x: 44, y: 0 }, [DEFENDER]: { x: 45.25, y: 0.5 } })
    const s: MatchState = {
      ...s0,
      players: s0.players.map((x) =>
        x.id === STRIKER ? { ...x, attrs: { ...x.attrs, heading: 1 } } : x.id === DEFENDER ? { ...x, attrs: { ...x.attrs, heading: 0 } } : x.id === PASSER ? { ...x, intent: { kind: "hold" }, intentUntil: s0.tick + 1 } : x
      ),
      ball: { pos: { x: 30, y: 25, z: 0 }, vel: { x: 0, y: 0, z: 0 } },
      possession: { kind: "owned", playerId: PASSER, since: s0.tick - 20, restart: null },
      lastTouch: { playerId: PASSER, side: "home" },
      override: { playerId: PASSER, receiverId: STRIKER, kind: "cross", untilTick: s0.tick + 5 }
    }
    const { events } = stepFor(s, 80, (e) => e.type === "shot")
    const cross = events.find((e) => e.type === "pass" && e.player_id === PASSER)
    expect(cross?.attrs.height).toBe("high")
    const duel = events.findIndex((e) => e.type === "aerial_duel")
    const shot = events.findIndex((e) => e.type === "shot")
    expect(duel).toBeGreaterThanOrEqual(0)
    expect(events[duel]!.attrs).toMatchObject({ winner_id: STRIKER, loser_id: DEFENDER })
    expect(shot).toBeGreaterThan(duel)
    expect(events[shot]!).toMatchObject({ player_id: STRIKER, attrs: { body_part: "head" } })
    expect(events.some((e) => e.type === "reception")).toBe(false)
  })

  it("scenario scripts apply to a header: a forced goal scores, a forced save is used up", () => {
    const p = onWith({ b0: 20 })
    const outcome = (e: DomainEvent) => e.type === "goal" || e.type === "keeper_save" || e.type === "ball_out" || e.type === "block"
    // A forced goal for the attackers: the header is scripted and scores, and the force is used up.
    const sGoal: MatchState = { ...crossArriving(p, { x: 44, y: 1 }, 1.6), forced: [{ window: [0, 95], team: "home", effect: "goal" }] }
    const g = stepFor(sGoal, 60, outcome)
    const gShot = g.events.find((e) => e.type === "shot")
    expect(gShot?.attrs).toMatchObject({ body_part: "head", scripted: true })
    expect(g.events.some((e) => e.type === "goal" && e.player_id === STRIKER)).toBe(true)
    expect(g.state.forced).toHaveLength(0)
    // A forced save by the defending keeper (keeper_heroics): the header is saved and the force is used up.
    const sSave: MatchState = { ...crossArriving(p, { x: 44, y: 1 }, 1.6), forced: [{ window: [0, 95], team: "away", effect: "keeper_heroics" }] }
    const v = stepFor(sSave, 60, outcome)
    const vShot = v.events.find((e) => e.type === "shot")
    expect(vShot?.attrs).toMatchObject({ body_part: "head", scripted: true, on_target: true })
    expect(v.events.some((e) => e.type === "keeper_save")).toBe(true)
    expect(v.events.some((e) => e.type === "goal")).toBe(false)
    expect(v.state.forced).toHaveLength(0)
  })

  it("rule off: no header, nothing drawn", () => {
    // Fully off: the reception is emitted and the contact stream is untouched.
    const s = crossArriving(onWith({ b0: 20, rule: 0 }), { x: 44, y: 1 }, 1.6)
    const r = step(s)
    expect(r.events.filter((e) => e.type === "reception" && e.player_id === STRIKER)).toHaveLength(1)
    expect(r.state.rng.contact).toEqual(s.rng.contact)
    expect(r.state.possession).toMatchObject({ kind: "owned", playerId: STRIKER })
    // Only the first-time rule on: the header seam checks its own switch, returns null and draws nothing.
    const ftOnly: Params = { ...off, firstTime: { ...off.firstTime, rule: 1 }, header: { ...off.header, b0: 20 } }
    const s2 = crossArriving(ftOnly, { x: 44, y: 1 }, 1.6)
    const w = workAt(s2)
    const f = s2.possession.kind === "in_flight" ? s2.possession.flight : null
    expect(headerPlan(w, f!, w.player(STRIKER))).toBeNull()
    expect(w.rng.contact.state).toEqual(s2.rng.contact)
    // Rule on, the same ball draws on the contact stream.
    const s3 = crossArriving(onWith({ b0: 20 }), { x: 44, y: 1 }, 1.6)
    const w3 = workAt(s3)
    w3.ball = { ...w3.ball, pos: { ...w3.ball.pos, z: 1.6 } }
    expect(headerPlan(w3, f!, w3.player(STRIKER))?.kind).toBe("shot")
    expect(w3.rng.contact.state).not.toEqual(s3.rng.contact)
  })
})

// In-match tests use the calibrated file plus the rule on, corners and free-kick deliveries included, at the shipped
// header values (b0 0.5, set by Task 4 phase B).
const root = join(dirname(fileURLToPath(import.meta.url)), "../../..")
const calibrated = paramsFromJson(JSON.parse(readFileSync(join(root, "data/params/touchline-params.json"), "utf8")))
const matchOn: Params = {
  ...calibrated,
  firstTime: { ...calibrated.firstTime, rule: 0, setPieces: 1 },
  header: { ...calibrated.header, rule: 1 },
  saveGeo: { ...calibrated.saveGeo, rule: 0 },
  execFatigue: { ...calibrated.execFatigue, rule: 0 },
  shotModel: { ...calibrated.shotModel, rule: 0 }
}
const matchOff: Params = { ...matchOn, header: { ...matchOn.header, rule: 0 } }

const shotsOf = (p: Params, seed: number, dt: number): DomainEvent[] => {
  let s = initMatch(makeConfig(seed, { params: p, dt }))
  const shots: DomainEvent[] = []
  while (!isFinished(s)) {
    const r = step(s)
    s = r.state
    for (const e of r.events) if (e.type === "shot") shots.push(e)
  }
  return shots
}

describe("SH2: in matches", () => {
  for (const dt of [0.1, 0.04])
    it(`in matches, headers appear (dt ${dt})`, () => {
      const seeds = [7, 9, 11, 13, 15, 17, 19, 21]
      // Precondition: no headed shot without the rule.
      const offShots = shotsOf(matchOff, seeds[0]!, dt)
      expect(offShots.length).toBeGreaterThan(10)
      expect(offShots.filter((e) => e.attrs.body_part === "head")).toHaveLength(0)
      const shots = seeds.flatMap((seed) => shotsOf(matchOn, seed, dt))
      const headers = shots.filter((e) => e.attrs.body_part === "head")
      expect(shots.length).toBeGreaterThanOrEqual(40)
      expect(headers.length).toBeGreaterThanOrEqual(8)
      const share = headers.length / shots.length
      expect(share).toBeGreaterThanOrEqual(0.05)
      expect(share).toBeLessThanOrEqual(0.25)
      for (const e of headers) expect(e.attrs).toMatchObject({ first_time: true, technique: "normal" })
    }, 900_000)
})

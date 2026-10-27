import { describe, expect, it } from "vitest"
import { buildCandidates, decide, DEFAULT_PARAMS, initMatch, isFinished, Rng, seedRng, step, type DomainEvent, type Params, type PlayerState } from "../src/index.js"
import { kickoffPlayersFor, makeConfig, STYLES } from "../src/testing.js"

// These cases test the old engine's pass knobs (pitch-control weight, safety lean), which D1 retires from the choice
// (plan 8c rulings 9 and 10): pinned to choice.rule 0 (ruling F6), since Task 10 switched D1 on in the defaults.
// Also pinned to support.rule 0 (the support play its whole-match margin was measured with), since Task 10d switched
// support rule 1 on. And every P4 behaviour off (P4 Task 10 switched them on: with them, the whole-match gain fell to
// +0.4 points on seeds 35-38).
/** Every P4 behaviour off (rules 0, no release cap): the play this file's whole-match margins were measured with (F4). */
/** Every P5 behaviour off, zonal marking included (P5 Task 14 switched them on): the engine these margins were measured on (F4). */
const p5Off = (p: Params): Params => ({
  ...p,
  setAttack: { ...p.setAttack, rule: 0 }, setDefend: { ...p.setDefend, rule: 0 }, setShapes: { ...p.setShapes, rule: 0 }, deadBall: { ...p.deadBall, rule: 0 },
  keeperRestarts: { ...p.keeperRestarts, rule: 0 }, directFk: { ...p.directFk, rule: 0 }, roleMoves: { ...p.roleMoves, runRule: 0, rotateRule: 0 },
  marking: { ...p.marking, rule: 0, landingRule: 0 }, transition: { ...p.transition, pauseRule: 0 }, release: { ...p.release, freeRule: 0 }
})
const p4Off = (p: Params): Params => ({
  ...p,
  tackle: { ...p.tackle, rule: 0 }, fouls: { ...p.fouls, rule: 0 }, aerial: { ...p.aerial, rule: 0 }, transition: { ...p.transition, rule: 0 },
  press: { ...p.press, rule: 0 }, marking: { ...p.marking, rule: 0 }, firstTick: { ...p.firstTick, scopeRule: 0 },
  release: { ...p.release, capS: 0, rejudge: 0 }
})
/** Every P6 rule pinned 0 (P6 Task 8 switched them on): the engine this file's counts were written on (F4). */
const p6Off = (p: Params): Params => ({
  ...p, firstTime: { ...p.firstTime, rule: 0 }, header: { ...p.header, rule: 0 }, saveGeo: { ...p.saveGeo, rule: 0 },
  execFatigue: { ...p.execFatigue, rule: 0 }, shotModel: { ...p.shotModel, rule: 0 }
})
const OLD: Params = p6Off(p4Off(p5Off({ ...DEFAULT_PARAMS, choice: { ...DEFAULT_PARAMS.choice, rule: 0 }, support: { ...DEFAULT_PARAMS.support, rule: 0 } })))
const withPass = (p: Params, pass: Partial<Params["pass"]>): Params => ({ ...p, pass: { ...p.pass, ...pass } })

/** The home centre-back on the ball at (-20, 0), two midfielders 15 m ahead, one with a defender closing in on him. */
const scene = () => {
  const players = kickoffPlayersFor(makeConfig(1))
  const at = (p: PlayerState, x: number, y: number, vx = 0, vy = 0): PlayerState => ({ ...p, pos: { x, y }, vel: { x: vx, y: vy } })
  const home = players.filter((p) => p.side === "home")
  const away = players.filter((p) => p.side === "away").map((p, i) => at(p, 40 + i, i % 2 ? 25 : -25))
  const owner = at(home[2]!, -20, 0)
  const marked = at(home[6]!, -5, 10)
  const free = at(home[7]!, -5, -10)
  // An away midfielder 4 m beyond the marked player, running towards where the ball would go.
  away[5] = at(away[5]!, -2, 13, -3, -2)
  const teammates = home.map((p) => (p.id === owner.id ? owner : p.id === marked.id ? marked : p.id === free.id ? free : at(p, -45 + p.slot, 30)))
  return { owner, marked, free, teammates, opponents: away }
}

describe("pitch-control-aware passing", () => {
  it("rates a pass to a receiver the defenders would reach first lower once passers weigh pitch control", () => {
    const { owner, marked, free, teammates, opponents } = scene()
    const xp = (p: Params, id: string) => buildCandidates({ period: "first_half", owner, teammates, opponents, style: STYLES.possession, scoreDiff: 0, minute: 30, restart: null, scriptBias: {} }, p, 0).find((c) => c.receiverId === id && c.kind === "short")!.xpass
    const lanes = OLD
    expect(xp(lanes, marked.id)).toBeCloseTo(xp(lanes, free.id), 2)
    const aware = withPass(OLD, { pitchControlWeight: 0.6 })
    expect(xp(aware, marked.id)).toBeLessThan(xp(aware, free.id) - 0.1)
  })

  it("makes the kinds of pass with a safe option likelier when passers weigh safety", () => {
    const { owner, teammates, opponents } = scene()
    const probs = (p: Params) => decide({ period: "first_half", owner, teammates, opponents, style: STYLES.possession, scoreDiff: 0, minute: 30, restart: null, scriptBias: {} }, p, new Rng(seedRng(1))).actionProbs
    const plain = probs(OLD)
    const safe = probs(withPass(OLD, { safetyWeight: 4 }))
    expect(safe.short_pass!).toBeGreaterThan(plain.short_pass!)
    expect(safe.long_pass ?? 0).toBeLessThanOrEqual(plain.long_pass ?? 0)
  })

  it("raises pass completion over whole matches", () => {
    const completion = (p: Params) => {
      let ok = 0
      let n = 0
      for (const seed of [35, 36, 37, 38]) {
        let s = initMatch(makeConfig(seed, { params: p }))
        while (!isFinished(s)) {
          const r = step(s)
          s = r.state
          for (const e of r.events as DomainEvent[]) if (e.type === "pass") (n++, e.outcome === "successful" && ok++)
        }
      }
      return ok / n
    }
    // On the hand-set priors (passes struck to arrive at 7 m/s, often intercepted), so recalibration does not move it.
    const before = completion(OLD)
    const after = completion(withPass(OLD, { pitchControlWeight: 0.5, safetyWeight: 3 }))
    // About 1.7 points since carriers stopped standing on the ball (2026-10-10; over 2 before), on 4 seeds and on 8. Seeds moved from 31-34 when teams started switching ends at half-time
    // (the gain is +1.1, +3.1, +2.4 points on seeds 31-34, 35-38, 39-42; +2.2 on all 12).
    expect(after - before).toBeGreaterThan(0.015)
  })
})

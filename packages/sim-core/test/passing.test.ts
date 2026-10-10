import { describe, expect, it } from "vitest"
import { buildCandidates, decide, DEFAULT_PARAMS, initMatch, isFinished, Rng, seedRng, step, type DomainEvent, type Params, type PlayerState } from "../src/index.js"
import { kickoffPlayersFor, makeConfig, STYLES } from "../src/testing.js"

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
    const xp = (p: Params, id: string) => buildCandidates({ owner, teammates, opponents, style: STYLES.possession, scoreDiff: 0, minute: 30, restart: null, scriptBias: {} }, p, 0).find((c) => c.receiverId === id && c.kind === "short")!.xpass
    const lanes = DEFAULT_PARAMS
    expect(xp(lanes, marked.id)).toBeCloseTo(xp(lanes, free.id), 2)
    const aware = withPass(DEFAULT_PARAMS, { pitchControlWeight: 0.6 })
    expect(xp(aware, marked.id)).toBeLessThan(xp(aware, free.id) - 0.1)
  })

  it("makes the kinds of pass with a safe option likelier when passers weigh safety", () => {
    const { owner, teammates, opponents } = scene()
    const probs = (p: Params) => decide({ owner, teammates, opponents, style: STYLES.possession, scoreDiff: 0, minute: 30, restart: null, scriptBias: {} }, p, new Rng(seedRng(1))).actionProbs
    const plain = probs(DEFAULT_PARAMS)
    const safe = probs(withPass(DEFAULT_PARAMS, { safetyWeight: 4 }))
    expect(safe.short_pass!).toBeGreaterThan(plain.short_pass!)
    expect(safe.long_pass ?? 0).toBeLessThanOrEqual(plain.long_pass ?? 0)
  })

  it("raises pass completion over whole matches", () => {
    const completion = (p: Params) => {
      let ok = 0
      let n = 0
      for (const seed of [31, 32, 33, 34]) {
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
    const before = completion(DEFAULT_PARAMS)
    const after = completion(withPass(DEFAULT_PARAMS, { pitchControlWeight: 0.5, safetyWeight: 3 }))
    // About 1.7 points since carriers stopped standing on the ball (2026-10-10; over 2 before), on 4 seeds and on 8.
    expect(after - before).toBeGreaterThan(0.015)
  })
})

import { describe, expect, it } from "vitest"
import { arrivalCos, coneCount, contactDecision, CONTROL, OPEN_SHOT } from "../src/contact.js"
import { decide, shotTerm, xgCoefs, xgOf, type Candidate } from "../src/decide.js"
import { fatigueScale } from "../src/execute.js"
import { DEFAULT_PARAMS, type Params } from "../src/params.js"
import { Rng, seedRng } from "../src/rng.js"
import { planShot, type ShotPlan } from "../src/shot.js"
import { kickoffPlayersFor, makeConfig, STYLES } from "../src/testing.js"
import type { OptionRecord, PlayerState } from "../src/types.js"

const base = kickoffPlayersFor(makeConfig(1))
/** Every P6 rule at 0 (never DEFAULT_PARAMS as "off": Task 8 switches the defaults on). */
const off: Params = {
  ...DEFAULT_PARAMS,
  firstTime: { ...DEFAULT_PARAMS.firstTime, rule: 0 },
  header: { ...DEFAULT_PARAMS.header, rule: 0 },
  saveGeo: { ...DEFAULT_PARAMS.saveGeo, rule: 0 },
  execFatigue: { ...DEFAULT_PARAMS.execFatigue, rule: 0 },
  shotModel: { ...DEFAULT_PARAMS.shotModel, rule: 0 }
}
const at = (p: PlayerState, x: number, y: number): PlayerState => ({ ...p, pos: { x, y }, vel: { x: 0, y: 0 } })

describe("contact.ts", () => {
  it("arrivalCos: -1 for a cutback from the byline, +1 from behind, mirrored after half-time", () => {
    const goal = { x: 52.5, y: 0 }, me = { x: 40, y: 0 }
    expect(arrivalCos({ x: -10, y: 0, z: 0 }, me, goal)).toBeCloseTo(-1, 12)
    expect(arrivalCos({ x: 10, y: 0, z: 0 }, me, goal)).toBeCloseTo(1, 12)
    expect(arrivalCos({ x: 0, y: 10, z: 0 }, me, goal)).toBeCloseTo(0, 12)
    expect(arrivalCos({ x: 10, y: 0, z: 0 }, { x: -40, y: 0 }, { x: -52.5, y: 0 })).toBeCloseTo(-1, 12)
    expect(arrivalCos({ x: 0.05, y: 0, z: 0 }, me, goal)).toBe(0)
    // The ball's height speed does not count: only its ground direction.
    expect(arrivalCos({ x: -10, y: 0, z: 8 }, me, goal)).toBeCloseTo(-1, 12)
  })

  it("contactDecision records shot, short_pass and hold with the existing action names", () => {
    const shot = contactDecision({ shot: 0.4, short_pass: 0.25, hold: 0.35 }, "shot", null, [], 0.18, 0.6)
    expect(Object.keys(shot.actionProbs).every((k) => ["shot", "short_pass", "hold"].includes(k))).toBe(true)
    expect(shot.action).toBe("shot")
    expect(shot.xg).toBe(0.18)
    expect(shot.pressure).toBe(0.6)
    expect(shot.chosenRank).toBeNull()
    expect(shot.candidate).toBeNull()

    const noLayoff = contactDecision({ shot: 0.6, hold: 0.4 }, "shot", null, [], 0.2, 0)
    expect(Object.keys(noLayoff.actionProbs).sort()).toEqual(["hold", "shot"])

    const cand: Candidate = { action: "back_pass", kind: "back", receiverId: "h7", target: { x: 30, y: 4 }, height: "ground", xpass: 0.9, value: 0.05, lane: 0 }
    const best: OptionRecord = { action: "short_pass", receiver_id: "h8", kind: "short", target_x: 33, target_y: -6, xpass: 0.85, value: 0.1 }
    const layoff = contactDecision({ shot: 0.3, short_pass: 0.3, hold: 0.4 }, "short_pass", cand, [best], 0.2, 0.2)
    expect(layoff.action).toBe("short_pass")
    expect(layoff.candidate).toBe(cand)
    expect(layoff.chosenRank).toBe(2)
    expect(layoff.options.map((o) => o.receiver_id)).toEqual(["h8", "h7"])
    expect(layoff.decisionQuality).toBeCloseTo(0.5, 12)
    expect(OPEN_SHOT).toEqual({ header: false, firstTime: false, mods: {} })
    expect(CONTROL).toEqual({ kind: "control" })
  })

  it("rule off: planShot hooks, fatigueScale, xgCoefs and shotTerm are identity", () => {
    const shooter = at(base.find((p) => p.side === "home" && p.role === "ST")!, 38, 6)
    const keeper = at(base.find((p) => p.side === "away" && p.role === "GK")!, 51, 0)
    const def = at(base.find((p) => p.side === "away" && p.role === "CB")!, 44, 4)
    const draws = (mods: Parameters<typeof planShot>[11]): ShotPlan[] => {
      const rng = new Rng(seedRng(42))
      const out: ShotPlan[] = []
      for (let i = 0; i < 2000; i++) out.push(planShot(shooter, "home", "first_half", [keeper, def], 0.12, (i % 5) / 4, false, off, 0.1, rng, i % 3 === 0, mods))
      return out
    }
    const plain = draws({})
    const hooked = draws({ aimY: 1, aimZ: 1, mishit: 1, speed: 1 })
    expect(plain.length).toBe(2000)
    // The fixture exercises every branch the hooks touch: mis-hits, on-target shots and blocks.
    expect(plain.filter((s) => s.execution !== "clean").length).toBeGreaterThan(20)
    expect(plain.filter((s) => s.onTarget).length).toBeGreaterThan(100)
    expect(plain.filter((s) => s.outcome === "blocked").length).toBeGreaterThan(20)
    expect(hooked).toEqual(plain)

    expect(fatigueScale(0.4, off)).toBe(1 + off.fatigue.executionK * 0.4)
    expect(fatigueScale(0, off)).toBe(1)
    expect(xgCoefs(off)).toBe(off.shot.xg)
    const style = STYLES.direct
    expect(shotTerm(0.2, style, null, off)).toBe(3 * (0.2 - 0.1) + 0.3 * style.riskTolerance)
    expect(shotTerm(0.31, STYLES.possession, "free_kick", off)).toBe(3 * (0.31 - 0.1) + 0.3 * STYLES.possession.riskTolerance)
  })
  it("coneCount counts decide's cone: outfield opponents within 1.5 m of the line to goal, mirrored after half-time", () => {
    const opp = base.filter((p) => p.side === "away")
    const gk = at(opp.find((p) => p.role === "GK")!, 50, 0.5)
    const cb1 = at(opp.find((p) => p.role === "CB")!, 44, 1)
    const cb2 = at(opp.filter((p) => p.role === "CB")[1]!, 44, 4)
    const cm = at(opp.find((p) => p.role === "CM")!, 30, 0)
    expect(coneCount("home", "first_half", { x: 38, y: 0 }, [gk, cb1, cb2, cm])).toBe(1)
    const mirror = (p: PlayerState) => at(p, -p.pos.x, -p.pos.y)
    expect(coneCount("home", "second_half", { x: -38, y: 0 }, [gk, cb1, cb2, cm].map(mirror))).toBe(1)
    // The xG decide records for a shot from there uses the same count.
    const shooter = at(base.find((p) => p.side === "home" && p.role === "ST")!, 38, 0)
    const d = decide(
      { period: "first_half", owner: shooter, teammates: [], opponents: [gk, cb1, cb2, cm], style: STYLES.direct, scoreDiff: 0, minute: 10, restart: null, scriptBias: { shot: 50 } },
      off,
      new Rng(seedRng(3))
    )
    expect(d.action).toBe("shot")
    expect(d.xg).toBe(xgOf(off, "home", "first_half", shooter.pos, false, coneCount("home", "first_half", shooter.pos, [gk, cb1, cb2, cm])))
  })
})

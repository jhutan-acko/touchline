import { readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "vitest"
import { attackX, initMatch, isFinished, paramsFromJson, PITCH, step, type DomainEvent, type MatchConfig } from "../src/index.js"
import { makeConfig } from "../src/testing.js"

// Wide play needs the calibrated style mix (the hand-set priors cross very little).
const root = join(dirname(fileURLToPath(import.meta.url)), "../../..")
const params = paramsFromJson(JSON.parse(readFileSync(join(root, "data/params/touchline-params.json"), "utf8")))

const play = (cfg: MatchConfig) => {
  let s = initMatch(cfg)
  const events: DomainEvent[] = []
  while (!isFinished(s)) { const r = step(s); s = r.state; events.push(...r.events) }
  return events
}
const runs = [1, 2, 3, 4, 5, 6].map((seed) => ({ cfg: makeConfig(seed, { params }), events: play(makeConfig(seed, { params })) }))
const sideOf = (cfg: MatchConfig, teamId: string | null) => (teamId === cfg.home.id ? "home" : "away")
/** True when (x, y) is inside the penalty area that `side` defends. */
const inOwnBox = (side: "home" | "away", x: number, y: number) => attackX(side, x) < -(PITCH.halfL - PITCH.boxDepth) && Math.abs(y) < PITCH.boxHalfWidth

describe("high balls into the box", () => {
  it("keepers claim or punch some of them, in their own box, from crosses and set pieces", () => {
    let claims = 0, punches = 0
    for (const r of runs) {
      for (const e of r.events.filter((x) => x.type === "keeper_claim" || x.type === "keeper_punch")) {
        const gk = [r.cfg.home, r.cfg.away].flatMap((t) => [...t.starters, ...(t.bench ?? [])]).find((p) => p.id === e.player_id)!
        expect(gk.role).toBe("GK")
        expect(inOwnBox(sideOf(r.cfg, e.team_id), e.x!, e.y!), e.id).toBe(true)
        expect(["cross", "corner", "free_kick"]).toContain(e.attrs.from)
        if (e.type === "keeper_claim") claims++
        else punches++
      }
    }
    expect(claims).toBeGreaterThan(5)
    expect(punches).toBeGreaterThan(2)
  })
  it("a claim gives the keeper the ball; a punch leaves it loose", () => {
    for (const r of runs) {
      r.events.forEach((e, i) => {
        if (e.type !== "keeper_claim" && e.type !== "keeper_punch") return
        const next = r.events.slice(i + 1).find((x) => ["pass", "clearance", "ball_recovery", "keeper_distribution", "ball_out", "ground_duel", "goal", "period_end"].includes(x.type))
        if (e.type === "keeper_claim" && e.attrs.handling === "clean" && next && next.type !== "period_end") expect(next.player_id === e.player_id || next.type === "ball_out", e.id).toBe(true)
        if (e.type === "keeper_punch" && next?.type === "ball_recovery") expect(next.frame_id).toBeGreaterThan(e.frame_id)
      })
    }
  })
  it("nobody tackles a keeper holding the ball in their own box", () => {
    for (const r of runs) {
      const keepers = new Set([r.cfg.home.starters[0]!.id, r.cfg.away.starters[0]!.id, ...[r.cfg.home, r.cfg.away].flatMap((t) => (t.bench ?? []).filter((b) => b.role === "GK").map((b) => b.id))])
      for (const e of r.events.filter((x) => x.type === "tackle" && keepers.has(x.attrs.opponent_id as string))) {
        const keeperSide = sideOf(r.cfg, e.team_id) === "home" ? "away" : "home"
        expect(inOwnBox(keeperSide, e.x!, e.y!), `${e.id} tackles keeper ${e.attrs.opponent_id} in the box`).toBe(false)
      }
    }
  })
  it("defenders head high balls away from their own third", () => {
    const heads = runs.flatMap((r) => r.events.filter((e) => e.type === "clearance" && e.attrs.technique === "head").map((e) => ({ r, e })))
    expect(heads.length).toBeGreaterThan(10)
    for (const { r, e } of heads) expect(attackX(sideOf(r.cfg, e.team_id), e.x!), e.id).toBeLessThan(-17.5)
  })
  it("some crosses are blocked", () => {
    const blocks = runs.flatMap((r) => r.events.filter((e) => e.type === "block" && e.attrs.blocked === "cross"))
    expect(blocks.length).toBeGreaterThan(5)
  })
})

describe("deflections", () => {
  it("send some balls straight behind for corners (blocks, headers, sliced clearances)", () => {
    let fromDeflection = 0
    for (const r of runs) {
      r.events.forEach((e, i) => {
        if (e.type !== "set_piece" || e.attrs.kind !== "corner") return
        const before = r.events.slice(0, i).reverse().find((x) => ["block", "clearance", "keeper_save", "keeper_punch", "pass", "shot", "interception"].includes(x.type))
        if (before && (before.type === "block" || before.type === "clearance")) fromDeflection++
      })
    }
    expect(fromDeflection).toBeGreaterThan(3)
  })
  it("a ball deflected behind travels straight out and the restart is a corner to the attacking side", () => {
    for (const r of runs) {
      r.events.forEach((e, i) => {
        if (e.type !== "ball_out" || e.attrs.side !== "byline") return
        const next = r.events.slice(i + 1).find((x) => x.type === "set_piece")
        if (next?.attrs.kind === "corner") expect(next.team_id, e.id).not.toBe(e.attrs.last_touch_team)
      })
    }
  })
  it("deflected shots rarely end in own goals", () => {
    const own = runs.reduce((n, r) => n + r.events.filter((e) => e.type === "goal" && e.attrs.own_goal === true).length, 0)
    // Real matches see roughly one own goal every seven or eight matches; allow sampling noise over six.
    expect(own).toBeLessThanOrEqual(3)
  })
})

import { readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "vitest"
import { initMatch, isFinished, modsFor, NO_MODS, paramsFromJson, step, type DomainEvent, type MatchConfig, type MatchState, type Script, type ScenarioEffect } from "../src/index.js"
import { makeConfig } from "../src/testing.js"

const root = join(dirname(fileURLToPath(import.meta.url)), "../../..")
const params = paramsFromJson(JSON.parse(readFileSync(join(root, "data/params/touchline-params.json"), "utf8")))
const cfgFor = (seed: number, script?: Script): MatchConfig => makeConfig(seed, { params, ...(script ? { script } : {}) })
const one = (effect: ScenarioEffect, window: readonly [number, number] = [0, 95], team: "home" | "away" = "home"): Script => ({ name: effect, entries: [{ window, team, effect }] })

const play = (cfg: MatchConfig, from?: MatchState) => {
  let s = from ?? initMatch(cfg)
  const events: DomainEvent[] = []
  while (!isFinished(s)) { const r = step(s); s = r.state; events.push(...r.events) }
  return events
}
const minuteOf = (e: DomainEvent) => Number(e.match_clock.slice(0, 2)) + Number(e.match_clock.slice(3)) / 60
const SEEDS = [1, 2, 3, 4, 5, 6]
const sum = (f: (seed: number) => number) => SEEDS.reduce((a, s) => a + f(s), 0)
const HOME = makeConfig(1).home.id

describe("scenario modifiers", () => {
  it("are neutral outside a window and for the other team", () => {
    const s = one("press_surge", [60, 70])
    const neutral = modsFor(undefined, "home", 65, params)
    expect(modsFor(s, "home", 30, params)).toEqual(neutral)
    expect(modsFor(s, "away", 65, params)).toEqual(neutral)
    expect(modsFor(s, "home", 65, params).press).toBeGreaterThan(1)
  })
  it("a second-half window is not opened by first-half added time (minutes 45+ happen in both halves)", () => {
    const s = one("press_surge", [46, 55])
    expect(modsFor(s, "home", 46.5, params, [], "first_half")).toEqual(NO_MODS)
    expect(modsFor(s, "home", 46.5, params, [], "second_half").press).toBeGreaterThan(1)
    const first = one("press_surge", [30, 45])
    expect(modsFor(first, "home", 44, params, [], "second_half")).toEqual(NO_MODS)
  })
  it("only a press surge makes two defenders press; a momentum swing's extra pressing does not", () => {
    expect(modsFor(one("press_surge"), "home", 10, params)).toMatchObject({ surge: true })
    const momentum = modsFor(one("momentum_swing"), "home", 10, params)
    expect(momentum.press).toBeGreaterThan(1)
    expect(momentum.surge).toBe(false)
    expect(NO_MODS.surge).toBe(false)
  })
  it("a goal entry stops nudging once its count is reached", () => {
    const s: Script = { name: "g", entries: [{ window: [0, 95], team: "home", effect: "goal", count: 2 }] }
    expect(modsFor(s, "home", 30, params, [1]).shotLogit).toBeGreaterThan(0)
    expect(modsFor(s, "home", 30, params, [2])).toEqual(modsFor(undefined, "home", 30, params))
  })
  it("change nothing before the first window opens", () => {
    const plain = play(cfgFor(3)).filter((e) => minuteOf(e) < 60)
    const scripted = play(cfgFor(3, one("goal", [60, 90]))).filter((e) => minuteOf(e) < 60)
    expect(JSON.stringify(scripted)).toBe(JSON.stringify(plain))
  })
})

describe("nudges raise the scripted outcome's rate", () => {
  const count = (script: Script | undefined, f: (e: DomainEvent) => boolean) => sum((seed) => play(cfgFor(seed, script)).filter(f).length)
  it("press surge: the team presses far more per opponent pass", () => {
    // Pressures per 100 opponent passes, the measure the scenario runner uses (it does not depend on possession).
    const rate = (script?: Script) => {
      const ev = SEEDS.flatMap((seed) => play(cfgFor(seed, script)))
      return ev.filter((e) => e.type === "pressure" && e.team_id === HOME).length / ev.filter((e) => e.type === "pass" && e.team_id !== HOME).length
    }
    expect(rate(one("press_surge"))).toBeGreaterThan(1.3 * rate())
  })
  it("goal: the team scores more", () => {
    const f = (e: DomainEvent) => e.type === "goal" && e.team_id === HOME
    const three: Script = { name: "goal", entries: [{ window: [0, 95], team: "home", effect: "goal", count: 3 }] }
    expect(count(three, f)).toBeGreaterThan(count(undefined, f) + 4)
  })
  it("momentum swing: the team shoots more", () => {
    const f = (e: DomainEvent) => e.type === "shot" && e.team_id === HOME
    expect(count(one("momentum_swing"), f)).toBeGreaterThan(1.2 * count(undefined, f))
  })
  it("red card: the team usually has a player sent off in the window", () => {
    const reds = SEEDS.filter((seed) => play(cfgFor(seed, one("red_card", [10, 90]))).some((e) => e.type === "card" && e.attrs.colour !== "yellow" && e.team_id === HOME)).length
    expect(reds).toBeGreaterThanOrEqual(4)
  })
  it("keeper heroics and howlers move the team keeper's save rate up and down", () => {
    const rate = (script?: Script) => {
      let on = 0, saved = 0
      for (const seed of SEEDS) for (const e of play(cfgFor(seed, script)).filter((x) => x.type === "shot" && x.team_id !== HOME)) {
        if (e.outcome === "goal" || e.outcome === "saved") on++
        if (e.outcome === "saved") saved++
      }
      return saved / on
    }
    const base = rate()
    expect(rate(one("keeper_heroics"))).toBeGreaterThan(base + 0.1)
    expect(rate(one("keeper_howler"))).toBeLessThan(base - 0.1)
  })
  it("defensive error: the team's defenders mis-hit far more passes in their own half", () => {
    const cfg = cfgFor(1)
    const defenders = new Set([...cfg.home.starters, ...(cfg.home.bench ?? [])].filter((p) => ["CB", "FB", "DM"].includes(p.role)).map((p) => p.id))
    const f = (e: DomainEvent) => e.type === "pass" && e.attrs.execution === "mishit" && defenders.has(e.player_id!) && e.x! < 0
    expect(count(one("defensive_error"), f)).toBeGreaterThan(3 * Math.max(1, count(undefined, f)))
  })
})

describe("forcing an outcome", () => {
  const forcedFrom = (effect: ScenarioEffect, team: "home" | "away" = "home") => {
    const cfg = cfgFor(2)
    let s = initMatch(cfg)
    for (let i = 0; i < 3000; i++) s = step(s).state
    return play(cfg, { ...s, forced: [{ window: [0, 95], team, effect }] })
  }
  it("goal: the team's next shot scores and is marked scripted", () => {
    const shot = forcedFrom("goal").find((e) => e.type === "shot" && e.team_id === HOME)!
    expect(shot.outcome).toBe("goal")
    expect(shot.attrs.scripted).toBe(true)
  })
  it("red card: the team's next foul is a red card, marked scripted", () => {
    const ev = forcedFrom("red_card")
    const foul = ev.find((e) => e.type === "foul" && e.team_id === HOME)!
    const card = ev.find((e) => e.type === "card" && e.frame_id === foul.frame_id && e.player_id === foul.player_id)!
    expect(card.attrs.colour).toBe("red")
    expect(card.attrs.scripted).toBe(true)
  })
  it("keeper heroics: the next shot on target against the team is saved, marked scripted", () => {
    // The away keeper is the hero here: the home side shoots more often in this match.
    const shot = forcedFrom("keeper_heroics", "away").find((e) => e.type === "shot" && e.team_id === HOME && (e.outcome === "goal" || e.outcome === "saved"))!
    expect(shot.outcome).toBe("saved")
    expect(shot.attrs.scripted).toBe(true)
  })
  it("defensive error: the next pass by a team defender in their own half is a mis-hit, marked scripted", () => {
    const pass = forcedFrom("defensive_error").find((e) => e.type === "pass" && e.attrs.scripted === true)!
    expect(pass.team_id).toBe(HOME)
    expect(pass.attrs.execution).toBe("mishit")
    expect(pass.x!).toBeLessThan(0)
  })
  it("is used once: later shots are not scripted", () => {
    const ev = forcedFrom("goal")
    expect(ev.filter((e) => e.attrs.scripted === true)).toHaveLength(1)
  })
})

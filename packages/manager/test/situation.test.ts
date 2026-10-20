import { readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { Schema } from "effect"
import { initMatch, step, type MatchState } from "@touchline/sim-core"
import { Situation } from "@touchline/schema"
import { describe, expect, it } from "vitest"
import { MAX_SITUATION_TOKENS, MatchWatch, payloadTokens, situationAt, situationHash, situationJson } from "../src/situation.js"
import { leagueConfig, models, playMoments, xt, MOMENTS_SEED } from "./helpers.js"

const cfg = leagueConfig(MOMENTS_SEED)
const run = playMoments(cfg, (m) => m.reasons.includes("minute_60"))
const at60 = run.moments.find((m) => m.reasons.includes("minute_60"))!
const sit = situationAt(at60.state, "home", at60.reasons, run.watch)

/** Every key path of a JSON value (array items under "[]"). */
const paths = (v: unknown, at = ""): string[] =>
  Array.isArray(v) ? v.flatMap((x) => paths(x, `${at}[]`)) : v !== null && typeof v === "object" ? Object.entries(v).flatMap(([k, x]) => [`${at}.${k}`, ...paths(x, `${at}.${k}`)]) : []

describe("the situation sent to the manager agent", () => {
  it("has exactly the documented fields: the payload is the schema-checked value, and extra fields never get through", () => {
    expect(() => Schema.decodeUnknownSync(Situation)(sit, { onExcessProperty: "error" })).not.toThrow()
    expect(JSON.parse(situationJson(sit))).toEqual(sit)
    const leaky = { ...sit, seed: 11, team: { ...sit.team, rng: [1, 2] } }
    expect(paths(JSON.parse(situationJson(leaky as never)))).toEqual(paths(sit))
  })
  it("never carries the seed, random state, script, forced outcomes, truths or the drawn added time", () => {
    const text = situationJson(sit)
    for (const word of ["seed", "rng", "script", "forced", "truth", "periodTicks", "scripted"]) expect(text).not.toContain(word)
    expect(text).not.toContain(String(at60.state.periodTicks))
  })
  it("never names the match by its id (the id carries the seed): an opaque reference instead, the same for the whole match", () => {
    expect(situationJson(sit)).not.toContain(cfg.matchId)
    expect(sit.match_id).toMatch(/^match-[0-9a-f]{12}$/)
    expect(situationAt(at60.state, "away", at60.reasons, run.watch).match_id).toBe(sit.match_id)
  })
  it("depends only on the match up to the pause: hidden state does not change it", () => {
    const hidden: MatchState = {
      ...at60.state,
      periodTicks: at60.state.periodTicks + 900,
      rng: initMatch(leagueConfig(999)).rng,
      forced: [{ window: [60, 70], team: "home", effect: "goal", count: 1 }],
      config: { ...at60.state.config, seed: 999, script: { name: "x", entries: [] } }
    }
    expect(situationAt(hidden, "home", at60.reasons, run.watch)).toEqual(sit)
  })
  it("is the same when rebuilt from a replay stopped at the pause tick", () => {
    let s = initMatch(cfg)
    const watch = new MatchWatch(cfg, models, xt)
    while (s.tick < at60.state.tick) {
      const r = step(s)
      s = r.state
      watch.add(r)
    }
    expect(situationAt(s, "home", at60.reasons, watch)).toEqual(sit)
    expect(situationHash(situationAt(s, "home", at60.reasons, watch))).toBe(situationHash(sit))
  })
  it("fits the token budget", () => {
    expect(payloadTokens(sit)).toBeLessThanOrEqual(MAX_SITUATION_TOKENS)
  })
  it("describes the team's own side: eleven players less any sent off, the bench, five substitutions left, the score from its side", () => {
    expect(sit.team.name).toBe(cfg.home.name)
    expect(sit.opponent.name).toBe(cfg.away.name)
    expect(sit.players.on_pitch).toHaveLength(11 - at60.state.players.filter((p) => p.side === "home" && p.sentOff).length)
    expect(sit.players.bench.map((b) => b.id)).toEqual(cfg.home.bench!.map((b) => b.id))
    expect(sit.players.on_pitch.every((p) => p.name !== p.id && p.energy_pct > 0 && p.energy_pct < 100)).toBe(true)
    expect(sit.limits).toEqual({ subs_left: 5, windows_left: 3, half_time_break: false })
    expect(sit.moment.score).toEqual({ for: at60.state.score.home, against: at60.state.score.away })
    expect(sit.moment.minute).toBeGreaterThanOrEqual(60)
    expect(sit.players.on_pitch.every((p) => p.minutes_played === sit.moment.minute)).toBe(true)
    expect(sit.team.stats.possession_pct + sit.opponent.stats.possession_pct).toBeCloseTo(100, 0)
    const away = situationAt(at60.state, "away", at60.reasons, run.watch)
    expect(away.moment.score).toEqual({ for: sit.moment.score.against, against: sit.moment.score.for })
    expect(away.team).toEqual(sit.opponent)
  })
  it("adds up: a team's xG is its players' xG, and its shots are its players' shots", () => {
    // Players substituted off or sent off took their shots with them, so this needs a match where no home player who left
    // before the minute-60 pause had shot. Seed 12: the first from 11 on with none (P3 Task 10; on seed 11 a home player
    // who had shot is now sent off before minute 60). Asserted, so a change of engine cannot make this pass vacuously.
    const c = leagueConfig(12)
    const r = playMoments(c, (m) => m.reasons.includes("minute_60"))
    const m60 = r.moments.find((m) => m.reasons.includes("minute_60"))!
    const s12 = situationAt(m60.state, "home", m60.reasons, r.watch)
    const on = new Set(s12.players.on_pitch.map((p) => p.id))
    expect(r.events.filter((e) => e.type === "shot" && e.team_id === c.home.id && !on.has(e.player_id!))).toEqual([])
    const xg = s12.players.on_pitch.reduce((a, p) => a + p.xg, 0)
    expect(Math.abs(xg - s12.team.stats.xg)).toBeLessThan(0.05)
    expect(s12.players.on_pitch.reduce((a, p) => a + p.shots, 0)).toBe(s12.team.stats.shots)
  })
  it("matches the reviewed example (UPDATE_GOLDEN=1 rewrites it after a deliberate change)", () => {
    const file = join(import.meta.dirname, "golden/situation-m-13-minute_60.json")
    const text = JSON.stringify(sit, null, 1) + "\n"
    if (process.env.UPDATE_GOLDEN === "1") writeFileSync(file, text)
    expect(text).toBe(readFileSync(file, "utf8"))
  })
})

import { readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "vitest"
import { behindPoint, DEFAULT_PARAMS as P, initMatch, isFinished, paramsFromJson, PITCH, Rng, scoringFactor, seedRng, step, type DomainEvent, type Frame, type MatchConfig } from "../src/index.js"
import { makeConfig } from "../src/testing.js"

const root = join(dirname(fileURLToPath(import.meta.url)), "../../..")
const calibrated = paramsFromJson(JSON.parse(readFileSync(join(root, "data/params/touchline-params.json"), "utf8")))

const play = (cfg: MatchConfig) => {
  let s = initMatch(cfg)
  const frames: Frame[] = [], events: DomainEvent[] = []
  while (!isFinished(s)) { const r = step(s); s = r.state; if (r.frame) frames.push(r.frame); events.push(...r.events) }
  return { frames, events }
}

describe("scoring in first-half added time", () => {
  it("uses the 30-45 bin, not the 45-60 bin", () => {
    expect(scoringFactor(46.5, 11, 11, P, "first_half")).toBe(scoringFactor(40, 11, 11, P, "first_half"))
    expect(scoringFactor(46.5, 11, 11, P, "second_half")).toBe(scoringFactor(50, 11, 11, P, "second_half"))
  })
})

describe("the hard stop at the end of a half", () => {
  it("still lets a ball in the air land before the whistle", () => {
    let s = initMatch(makeConfig(4))
    while (!(s.possession.kind === "in_flight" && s.possession.flight.resolveTick > s.tick + 5)) s = step(s).state
    const flight = s.possession.kind === "in_flight" ? s.possession.flight : null
    // The half was due a minute ago, so the hard stop applies now.
    s = { ...s, periodTicks: s.periodTick - Math.round(60 / s.config.dt) }
    const events: DomainEvent[] = []
    while (!events.some((e) => e.type === "period_end")) {
      const r = step(s)
      s = r.state
      events.push(...r.events)
    }
    const main = events.find((e) => e.frame_id === flight!.releaseTick && ["pass", "shot", "clearance"].includes(e.type))
    expect(main, "the flight's event").toBeDefined()
  })
})

describe("blocked crosses and deflections", () => {
  // Every cross within 8 m of a defender is blocked, so each match has plenty of blocks to check.
  const blocky = { ...calibrated, defending: { ...calibrated.defending, crossBlock: 1, crossBlockM: 8 } }
  const runs = [1, 2, 3].map((seed) => play(makeConfig(seed, { params: blocky })))
  it("the ball travels to the blocker: no jump in the frame before the block", () => {
    let n = 0
    for (const r of runs) {
      const byTick = new Map(r.frames.map((f) => [f.tick, f]))
      for (const e of r.events.filter((x) => x.type === "block" && x.attrs.blocked === "cross")) {
        const before = byTick.get(e.frame_id - 1)
        if (!before) continue
        n++
        expect(Math.hypot(before.ball.x - e.x!, before.ball.y - e.y!), e.id).toBeLessThan(2.5)
      }
    }
    expect(n).toBeGreaterThan(10)
  })
  it("a deflection behind never crosses the goal line between the posts", () => {
    const r = new Rng(seedRng(9))
    for (let x = 36; x <= 52; x += 1) {
      for (let y = -20; y <= 20; y += 1) {
        const to = behindPoint("away", { x, y }, r)
        const f = (PITCH.halfL - x) / (to.x - x)
        const yAtLine = y + f * (to.y - y)
        expect(Math.abs(yAtLine), `from (${x}, ${y})`).toBeGreaterThan(PITCH.goalHalfWidth + 1)
      }
    }
  })
})

describe("substitutions and receptions", () => {
  const runs = [1, 2, 3, 4, 5, 6].map((seed) => ({ cfg: makeConfig(seed), ...play(makeConfig(seed)) }))
  it("teams make about four substitutions on average, not always five", () => {
    const counts = runs.flatMap((r) => [r.cfg.home.id, r.cfg.away.id].map((t) => r.events.filter((e) => e.type === "substitution" && e.team_id === t).length))
    const mean = counts.reduce((a, b) => a + b, 0) / counts.length
    expect(mean).toBeGreaterThan(3.3)
    expect(mean).toBeLessThan(4.8)
    expect(counts.some((c) => c < 5)).toBe(true)
  })
  it("a reception records whether the ball was lost on the first touch", () => {
    for (const r of runs) for (const e of r.events.filter((x) => x.type === "reception")) expect(e.attrs.lost_possession, e.id).toBe(e.attrs.first_touch !== "controlled")
  })
})

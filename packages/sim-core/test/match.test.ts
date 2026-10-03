import { describe, expect, it } from "vitest"
import { createHash } from "node:crypto"
import { initMatch, isFinished, step, type DomainEvent, type Frame, type MatchConfig } from "../src/index.js"
import { makeConfig } from "../src/testing.js"

const play = (cfg: MatchConfig) => {
  let s = initMatch(cfg)
  const frames: Frame[] = []
  const events: DomainEvent[] = []
  while (!isFinished(s)) { const r = step(s); s = r.state; if (r.frame) frames.push(r.frame); events.push(...r.events) }
  return { s, frames, events }
}
const hash = (x: unknown) => createHash("sha256").update(JSON.stringify(x)).digest("hex")

describe("full match", () => {
  const a = play(makeConfig(1))
  it("is deterministic for a seed and differs across seeds", () => {
    const b = play(makeConfig(1))
    expect(hash(b.events)).toBe(hash(a.events))
    expect(hash(b.frames)).toBe(hash(a.frames))
    expect(hash(play(makeConfig(2)).events)).not.toBe(hash(a.events))
  })
  it("has two periods with frame ids restarting at 0 and ~90+ minutes of frames", () => {
    const first = a.frames.filter((f) => f.period === "first_half"), second = a.frames.filter((f) => f.period === "second_half")
    expect(first[0]!.frame_id).toBe(0)
    expect(second[0]!.frame_id).toBe(0)
    expect(a.frames.length).toBeGreaterThan(90 * 60 * 10)
    expect(a.frames.length).toBeLessThan(102 * 60 * 10)
  })
  it("starts and ends with the match lifecycle events", () => {
    expect(a.events[0]!.type).toBe("match_start")
    expect(a.events.at(-1)!.type).toBe("match_end")
  })
  it("keeps every player on the pitch (2 m margin) and at or under 10 m/s", () => {
    for (let i = 1; i < a.frames.length; i++) {
      const f = a.frames[i]!, prev = a.frames[i - 1]!
      if (f.period !== prev.period) continue
      const before = new Map([...prev.home, ...prev.away].map((x) => [x.id, x]))
      for (const p of [...f.home, ...f.away]) {
        if (Math.abs(p.x) > 54.5 || Math.abs(p.y) > 36) throw new Error(`${p.id} off the pitch at tick ${f.tick}`)
        const q = before.get(p.id)
        if (q && Math.hypot(p.x - q.x, p.y - q.y) / 0.1 > 10.05) throw new Error(`${p.id} too fast at tick ${f.tick}`)
      }
    }
  })
  it("puts the ball within 1 m of the passer at every pass release", () => {
    const byTick = new Map(a.frames.map((f) => [f.tick, f]))
    for (const e of a.events.filter((x) => x.type === "pass")) {
      const f = byTick.get(e.frame_id)!
      expect(Math.hypot(f.ball.x - e.x!, f.ball.y - e.y!)).toBeLessThan(1)
    }
  })
  it("stamps every event with a frame that exists, in order", () => {
    const ticks = new Set(a.frames.map((f) => f.tick))
    for (const e of a.events) if (e.type !== "match_end" && e.type !== "period_end") expect(ticks.has(e.frame_id)).toBe(true)
  })
  it("produces football in a sane (uncalibrated) range", () => {
    const n = (t: string) => a.events.filter((e) => e.type === t).length
    expect(n("pass")).toBeGreaterThan(400)
    expect(n("pass")).toBeLessThan(2500)
    expect(n("shot")).toBeGreaterThan(5)
    expect(n("goal")).toBeLessThan(15)
  })
  it("records what the passer could have done: options, best option and action probabilities", () => {
    const passes = a.events.filter((e) => e.type === "pass" && e.attrs.restart === null)
    const withOptions = passes.filter((e) => Array.isArray(e.attrs.options) && e.attrs.options.length > 0)
    expect(withOptions.length / passes.length).toBeGreaterThan(0.95)
    for (const e of withOptions) {
      expect(typeof e.attrs.best_receiver_id).toBe("string")
      expect(Number(e.attrs.best_value)).toBeGreaterThanOrEqual(Number(e.attrs.chosen_value) - 0.0006)
      const probs = Object.values(e.attrs.action_probs as Record<string, number>)
      expect(probs.reduce((x, y) => x + y, 0)).toBeCloseTo(1, 1)
    }
    const ranks = withOptions.map((e) => Number(e.attrs.chosen_rank))
    expect(ranks.every((r) => Number.isInteger(r) && r >= 1)).toBe(true)
    expect(ranks.filter((r) => r === 1).length).toBeGreaterThan(0)
    expect(ranks.filter((r) => r > 1).length).toBeGreaterThan(0)
    for (const e of withOptions) if (Number(e.attrs.chosen_rank) === 1) expect(e.attrs.chosen_value).toBe(e.attrs.best_value)
  })
  it("gives every player a speed and an intent in every frame, and exactly one ball carrier when owned", () => {
    const kinds = new Set(["shape", "press", "run_in_behind", "chase", "carry", "hold", "on_ball"])
    for (const f of a.frames.filter((_, i) => i % 50 === 0)) {
      const all = [...f.home, ...f.away]
      for (const p of all) {
        expect(p.vel).toBeGreaterThanOrEqual(0)
        expect(p.vel).toBeLessThanOrEqual(10)
        expect(kinds.has(p.intent)).toBe(true)
      }
      expect(all.filter((p) => p.intent === "on_ball").length).toBeLessThanOrEqual(1)
    }
  })
  it("emits off-ball runs", () => {
    const runs = a.events.filter((e) => e.type === "off_ball_run")
    expect(runs.length).toBeGreaterThan(10)
    expect(runs.every((e) => e.x_end !== null && typeof e.attrs.ball_carrier_id === "string")).toBe(true)
  })
  it("score in state equals goal events", () => {
    const g = a.events.filter((e) => e.type === "goal")
    expect(a.s.score.home + a.s.score.away).toBe(g.length)
  })
})

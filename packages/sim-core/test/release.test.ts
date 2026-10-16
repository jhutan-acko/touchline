import { describe, expect, it } from "vitest"
import { DEFAULT_PARAMS as P, type Params } from "../src/params.js"
import { releaseDelayS } from "../src/release.js"
import { Rng, seedRng } from "../src/rng.js"
import { initMatch, isFinished, step } from "../src/step.js"
import type { DomainEvent } from "../src/types.js"
import { makeConfig } from "../src/testing.js"

// The tail is fixed here: Step 4 may move the defaults. Explicit on and off objects (ruling F4): Task 10 switches the defaults on.
const on: Params = { ...P, release: { ...P.release, rule: 1, tailShare: 0.25, tailMeanS: 1.5 } }
const off: Params = { ...P, release: { ...P.release, rule: 0 } }
const draws = (d: number, n = 4000) => {
  const r = new Rng(seedRng(5))
  return Array.from({ length: n }, () => releaseDelayS(d, on, r)).sort((a, b) => a - b)
}

describe("D2: release timing", () => {
  it("a pressed player releases within 0.2-0.7 s", () => {
    const v = draws(1.5)
    expect(v[0]).toBeGreaterThanOrEqual(0.2)
    expect(v[v.length - 1]).toBeLessThanOrEqual(0.7)
  })
  it("a free player keeps the base range and sometimes holds much longer", () => {
    const v = draws(8)
    expect(v[0]).toBeGreaterThanOrEqual(P.timing.decisionMinS)
    const over = v.filter((s) => s > P.timing.decisionMaxS + 1).length / v.length
    // Base 0.9-2.2 s plus, a quarter of the time, Exp(1.5 s): about 8.6 % end up over 3.2 s.
    expect(over).toBeGreaterThan(0.04)
    expect(over).toBeLessThan(0.15)
  })
  it("in ticks at 25 Hz a pressed release is 5-18 ticks", () => {
    for (const s of draws(1.5, 500)) {
      const ticks = Math.max(1, Math.round(s / 0.04))
      expect(ticks).toBeGreaterThanOrEqual(5)
      expect(ticks).toBeLessThanOrEqual(18)
    }
  })
})

/** Seconds from a controlled reception to the receiver's next open-play pass, for receptions with an opponent within 2 m. */
const pressedReleases = (p: Params, seed: number): number[] => {
  let s = initMatch(makeConfig(seed, { params: p }))
  const events: DomainEvent[] = []
  const near = new Map<string, number>()
  while (!isFinished(s)) {
    const r = step(s)
    s = r.state
    for (const e of r.events) {
      if (e.type === "reception" && e.attrs.first_touch === "controlled") {
        const me = s.players.find((x) => x.id === e.player_id)!
        near.set(e.id, Math.min(...s.players.filter((x) => x.side !== me.side && !x.sentOff).map((x) => Math.hypot(x.pos.x - me.pos.x, x.pos.y - me.pos.y))))
      }
    }
    events.push(...r.events)
  }
  const out: number[] = []
  events.forEach((e, i) => {
    if (e.type !== "reception" || (near.get(e.id) ?? 99) >= 2) return
    const next = events.slice(i + 1).find((g) => g.type === "pass" || g.type === "possession_change")
    if (next?.type === "pass" && next.player_id === e.player_id && !next.attrs.restart) out.push((next.frame_id - e.frame_id) * 0.1)
  })
  return out.sort((a, b) => a - b)
}

describe("D2 in a match", () => {
  it("pressed receivers release much sooner with the rule on", () => {
    const median = (v: number[]) => v[Math.floor(v.length / 2)]!
    const offMedian = median(pressedReleases(off, 7))
    expect(offMedian).toBeGreaterThanOrEqual(P.timing.decisionMinS)
    expect(median(pressedReleases(on, 7))).toBeLessThan(offMedian - 0.3)
  }, 120_000)
})

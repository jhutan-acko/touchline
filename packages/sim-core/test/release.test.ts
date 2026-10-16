import { beforeAll, describe, expect, it } from "vitest"
import { DEFAULT_PARAMS as P, type Params } from "../src/params.js"
import { releaseDelayS } from "../src/release.js"
import { Rng, seedRng } from "../src/rng.js"
import { initMatch, isFinished, step } from "../src/step.js"
import type { DomainEvent, MatchState } from "../src/types.js"
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

/** Nearest active opponent to a player, in metres, from the state after the step. */
const nearestOppM = (s: MatchState, id: string): number => {
  const me = s.players.find((x) => x.id === id)!
  return Math.min(...s.players.filter((x) => x.side !== me.side && !x.sentOff).map((x) => Math.hypot(x.pos.x - me.pos.x, x.pos.y - me.pos.y)))
}

interface Spell { readonly oppM: number; readonly delayTicks: number }

/**
 * Plays a match and reads the engine's own release delay at every controlled reception: the receiver's intentUntil minus the
 * tick, as the release seam set it. Also returns the event list.
 */
const playMatch = (p: Params, seed: number, dt: number): { spells: Spell[]; events: DomainEvent[]; near: Map<string, number> } => {
  let s = initMatch(makeConfig(seed, { params: p, dt }))
  const events: DomainEvent[] = []
  const near = new Map<string, number>()
  const spells: Spell[] = []
  while (!isFinished(s)) {
    const r = step(s)
    s = r.state
    for (const e of r.events) {
      if (e.type === "reception" && e.attrs.first_touch === "controlled") {
        const me = s.players.find((x) => x.id === e.player_id)!
        const oppM = nearestOppM(s, me.id)
        near.set(e.id, oppM)
        spells.push({ oppM, delayTicks: me.intentUntil - s.tick })
      }
    }
    events.push(...r.events)
  }
  return { spells, events, near }
}

/** Seconds from a controlled reception to the receiver's next open-play pass, for receptions with an opponent within 2 m. */
const pressedReleases = (m: { events: DomainEvent[]; near: Map<string, number> }, dt: number): number[] => {
  const out: number[] = []
  m.events.forEach((e, i) => {
    if (e.type !== "reception" || (m.near.get(e.id) ?? 99) >= 2) return
    const next = m.events.slice(i + 1).find((g) => g.type === "pass" || g.type === "possession_change")
    if (next?.type === "pass" && next.player_id === e.player_id && !next.attrs.restart) out.push((next.frame_id - e.frame_id) * dt)
  })
  return out.sort((a, b) => a - b)
}

describe("D2: rule 0 leaves the release stream alone", () => {
  it("a stretch of play with the rule off draws nothing from the release stream", () => {
    const s0 = initMatch(makeConfig(7, { params: off }))
    let s = s0
    for (let i = 0; i < 3000 && !isFinished(s); i++) s = step(s).state
    expect(s.rng.release).toEqual(s0.rng.release)
  })
})

// Distances are read after the step, while the seam reads them when the reception resolves in that step. Receptions within 0.2 m
// of the 2 m line are left out of the per-spell bounds, so a player who moves during the rest of the step cannot flip the class.
describe.each([0.1, 0.04])("D2 in a match at dt %s", (dt) => {
  const median = (v: number[]) => v[Math.floor(v.length / 2)]!
  let mOn: ReturnType<typeof playMatch>
  beforeAll(() => {
    mOn = playMatch(on, 7, dt)
  }, 120_000)
  it("the seam sets pressed delays to 0.2-0.7 s and free delays to at least the base minimum (one tick of rounding)", () => {
    const pressed = mOn.spells.filter((x) => x.oppM < 2)
    const free = mOn.spells.filter((x) => x.oppM >= 2)
    expect(pressed.length).toBeGreaterThanOrEqual(15)
    expect(free.length).toBeGreaterThanOrEqual(150)
    for (const x of pressed.filter((x) => x.oppM < 1.8)) {
      expect(x.delayTicks * dt).toBeGreaterThanOrEqual(0.2 - dt - 1e-9)
      expect(x.delayTicks * dt).toBeLessThanOrEqual(0.7 + dt + 1e-9)
    }
    for (const x of free.filter((x) => x.oppM > 2.2)) expect(x.delayTicks * dt).toBeGreaterThanOrEqual(P.timing.decisionMinS - dt - 1e-9)
    if (dt === 0.04) for (const x of pressed.filter((x) => x.oppM < 1.8)) {
      expect(x.delayTicks).toBeGreaterThanOrEqual(5)
      expect(x.delayTicks).toBeLessThanOrEqual(18)
    }
  })
  it("pressed receivers release much sooner with the rule on", () => {
    const offReleases = pressedReleases(playMatch(off, 7, dt), dt)
    const onReleases = pressedReleases(mOn, dt)
    expect(offReleases.length).toBeGreaterThanOrEqual(10)
    expect(onReleases.length).toBeGreaterThanOrEqual(10)
    const offMedian = median(offReleases)
    expect(offMedian).toBeGreaterThanOrEqual(P.timing.decisionMinS)
    expect(median(onReleases)).toBeLessThan(offMedian - 0.3)
  }, 120_000)
})

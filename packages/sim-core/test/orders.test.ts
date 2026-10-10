import { describe, expect, it } from "vitest"
import {
  applyOrders,
  checkOrders,
  initMatch,
  isFinished,
  isHalfTimeBreak,
  OrderError,
  step,
  subsLeft,
  whatIf,
  WhatIfError,
  windowsLeft,
  type DomainEvent,
  type MatchConfig,
  type MatchState
} from "../src/index.js"
import { makeConfig } from "../src/testing.js"

const minute = (s: MatchState) => (s.period === "first_half" ? 0 : 45) + (Math.max(0, s.periodTick) * s.config.dt) / 60

/** Play from kickoff until `stop` holds (or full time); the events on the way. */
const playUntil = (cfg: MatchConfig, stop: (s: MatchState) => boolean, from: MatchState = initMatch(cfg)) => {
  let s = from
  const events: DomainEvent[] = []
  while (!isFinished(s)) {
    const r = step(s)
    s = r.state
    events.push(...r.events)
    if (stop(s)) break
  }
  return { s, events }
}
const playOut = (cfg: MatchConfig, from: MatchState) => playUntil(cfg, () => false, from)

const managed = makeConfig(4, { managed: ["home"] })
/** A stoppage in the second half of a match whose home team has a manager. */
const stoppage = playUntil(managed, (s) => s.period === "second_half" && s.periodTick > 100 && s.phase.kind === "restart").s
const halfTime = playUntil(managed, (s) => s.period === "second_half").s
const onPitch = (s: MatchState, role: string) => s.players.find((p) => p.side === "home" && p.role === role && !p.sentOff)!
const bench = (role: string) => managed.home.bench!.find((b) => b.role === role)!

describe("manager orders are checked against the live state", () => {
  it("accept a style change inside its ranges and a substitution of a player on the pitch by a bench player", () => {
    const orders = [{ kind: "style" as const, setting: "pressIntensity" as const, value: 0.9 }, { kind: "style" as const, setting: "lineHeight" as const, value: -0.2 }, { kind: "sub" as const, off: onPitch(stoppage, "ST").id, on: bench("ST").id }]
    expect(checkOrders(stoppage, "home", orders)).toEqual({ valid: orders, dropped: [] })
  })
  it("drop, with the reason, out-of-range or unknown style settings and impossible substitutions", () => {
    const st = onPitch(stoppage, "ST").id
    const cases: Array<[unknown, RegExp]> = [
      [{ kind: "style", setting: "pressIntensity", value: 1.5 }, /pressIntensity must be between 0 and 1/],
      [{ kind: "style", setting: "formation", value: 1 }, /unknown style setting "formation"/],
      [{ kind: "style", setting: "toString", value: 1 }, /unknown style setting "toString"/],
      [{ kind: "sub", off: "nobody", on: bench("ST").id }, /nobody is not on the pitch/],
      [{ kind: "sub", off: st, on: "nobody" }, /nobody is not an available bench player/],
      [{ kind: "sub", off: st, on: bench("GK").id }, /only a goalkeeper can replace a goalkeeper/],
      [{ kind: "sub", off: stoppage.players.find((p) => p.side === "away")!.id, on: bench("ST").id }, /not on the pitch for this team/]
    ]
    for (const [order, reason] of cases) {
      const r = checkOrders(stoppage, "home", [order as never])
      expect(r.valid).toEqual([])
      expect(r.dropped[0]!.reason).toMatch(reason)
    }
  })
  it("do not let one player come off twice or one bench player come on twice in the same decision", () => {
    const st = onPitch(stoppage, "ST").id, cm = onPitch(stoppage, "CM").id
    const r = checkOrders(stoppage, "home", [{ kind: "sub", off: st, on: bench("ST").id }, { kind: "sub", off: st, on: bench("CM").id }, { kind: "sub", off: cm, on: bench("ST").id }])
    expect(r.valid).toHaveLength(1)
    expect(r.dropped.map((d) => d.reason)).toEqual([`${st} is already coming off`, `${bench("ST").id} is not an available bench player`])
  })
  it("keep to five substitutions and three windows during play", () => {
    const outfield = stoppage.players.filter((p) => p.side === "home" && p.role !== "GK")
    const fresh = managed.home.bench!.filter((b) => b.role !== "GK")
    const six = outfield.slice(0, 6).map((p, i) => ({ kind: "sub" as const, off: p.id, on: fresh[i]!.id }))
    expect(checkOrders(stoppage, "home", six).dropped.map((d) => d.reason)).toEqual(["no substitutions left (5 allowed)"])
    const spent = { ...stoppage, subs: { ...stoppage.subs, home: { ...stoppage.subs.home, windows: 3 } } }
    expect(windowsLeft(spent, "home")).toBe(0)
    expect(checkOrders(spent, "home", six.slice(0, 1)).dropped[0]!.reason).toBe("no substitution windows left (3 allowed)")
  })
  it("allow substitutions only at a stoppage", () => {
    const open = playUntil(managed, (s) => s.phase.kind === "open_play" && s.tick > 100).s
    expect(checkOrders(open, "home", [{ kind: "sub", off: onPitch(open, "ST").id, on: bench("ST").id }]).dropped[0]!.reason).toBe("substitutions are made only at a stoppage")
  })
})

describe("applied orders", () => {
  it("change the team's style at once and queue substitutions, which count against what is left", () => {
    const st = onPitch(stoppage, "ST").id
    const s = applyOrders(stoppage, "home", [{ kind: "style", setting: "tempo", value: 0.95 }, { kind: "sub", off: st, on: bench("ST").id }])
    expect(s.config.home.style.tempo).toBe(0.95)
    expect(s.config.away).toBe(stoppage.config.away)
    expect(s.subOrders?.home).toEqual([{ off: st, on: bench("ST").id }])
    expect(subsLeft(s, "home")).toBe(subsLeft(stoppage, "home") - 1)
    expect(() => applyOrders(stoppage, "home", [{ kind: "style", setting: "tempo", value: 2 }])).toThrow(OrderError)
    expect(() => applyOrders(stoppage, "home", [{ kind: "style", setting: "tempo", value: 0.2 }, { kind: "style", setting: "tempo", value: 0.3 }])).toThrow("tempo is already being changed")
  })
  it("make the queued substitution at the next tick: the bench player takes the slot, fresh, and one window is used", () => {
    const off = onPitch(stoppage, "ST")
    const on = bench("ST").id
    const r = step(applyOrders(stoppage, "home", [{ kind: "sub", off: off.id, on }]))
    const sub = r.events.find((e) => e.type === "substitution")!
    expect(sub.attrs).toMatchObject({ player_off: off.id, player_on: on, reason: "manager", half_time: false })
    const came = r.state.players.find((p) => p.id === on)!
    expect([came.slot, came.role]).toEqual([off.slot, off.role])
    expect(came.energy).toBeGreaterThan(0.999) // fresh, less one tick of running
    expect(r.state.players.some((p) => p.id === off.id)).toBe(false)
    expect(r.state.subs.home.windows).toBe(stoppage.subs.home.windows + 1)
    expect(r.state.subOrders).toBeUndefined()
  })
  it("at half time pause at the second-half kickoff before play, and make changes there without using a window", () => {
    expect(isHalfTimeBreak(halfTime)).toBe(true)
    const off = onPitch(halfTime, "CM")
    const r = step(applyOrders(halfTime, "home", [{ kind: "sub", off: off.id, on: bench("CM").id }]))
    expect(r.events.find((e) => e.type === "substitution")!.attrs.half_time).toBe(true)
    expect(r.state.subs.home.windows).toBe(0)
  })
})

describe("a managed team", () => {
  const plain = makeConfig(4)
  it("makes no automatic substitutions, while the other team still does", () => {
    const events = playOut(managed, initMatch(managed)).events.filter((e) => e.type === "substitution")
    expect(events.filter((e) => e.team_id === managed.home.id)).toEqual([])
    expect(events.filter((e) => e.team_id === managed.away.id).length).toBeGreaterThan(0)
  })
  it("leaves an unmanaged match exactly as before", () => {
    const a = playOut(plain, initMatch(plain)), b = playOut({ ...plain, managed: [] }, initMatch({ ...plain, managed: [] }))
    expect(b.events).toEqual(a.events)
    expect(b.s.score).toEqual(a.s.score)
  })
  it("plays identically to the unmanaged match until half time", () => {
    const a = playUntil(plain, (s) => minute(s) >= 44).events
    const b = playUntil(managed, (s) => minute(s) >= 44).events
    expect(b).toEqual(a)
  })
})

describe("the orders intervention", () => {
  it("tests a manager's option from a stoppage with the paired what-if", () => {
    const r = whatIf(stoppage, { kind: "orders", side: "home", orders: [{ kind: "sub", off: onPitch(stoppage, "ST").id, on: bench("ST").id }] }, { seeds: 3, horizonS: 30, side: "home" })
    expect([r.seeds, r.side]).toEqual([3, "home"])
    expect(() => whatIf(stoppage, { kind: "orders", side: "home", orders: [{ kind: "style", setting: "tempo", value: -1 }] }, { seeds: 1, horizonS: 10 })).toThrow(WhatIfError)
  })
})

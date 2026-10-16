import { describe, expect, it } from "vitest"
import { launchVelocity } from "../src/ball.js"
import { bootBlocker } from "../src/deflect.js"
import { DEFAULT_PARAMS as P, type Params } from "../src/params.js"
import { resolveFlight } from "../src/resolve.js"
import { Rng, seedRng } from "../src/rng.js"
import { initMatch, isFinished, step } from "../src/step.js"
import type { DomainEvent, PlayerState } from "../src/types.js"
import { kickoffPlayersFor, makeConfig } from "../src/testing.js"

const base = kickoffPlayersFor(makeConfig(1))
const at = (p: PlayerState, x: number, y: number): PlayerState => ({ ...p, pos: { x, y }, vel: { x: 0, y: 0 } })
// Explicit switched-off and switched-on engines (ruling F4): never rely on DEFAULT_PARAMS being off.
const off: Params = { ...P, firstTick: { ...P.firstTick, rule: 0 } }
const on: Params = { ...P, firstTick: { ...P.firstTick, rule: 1 } }
const passer = at(base[2]!, 0, 0)
const receiver = at(base[5]!, 15, 0)
const winner = (def: PlayerState, p: Params, dt = 0.1) => {
  const ball = { pos: { x: 0, y: 0, z: 0 }, vel: launchVelocity(passer.pos, receiver.pos, "ground", p) }
  return resolveFlight(ball, passer.id, receiver.id, [passer, receiver, def], p, dt, new Rng(seedRng(1))).winnerId
}
/** A ground pass from the origin to a receiver `len` metres away along `sign`·x, with one defender at (dx, dy). */
const winnerAt = (len: number, dx: number, dy: number, p: Params, dt: number, sign = 1) => {
  const from = at(base[2]!, 0, 0)
  const to = at(base[5]!, sign * len, 0)
  const def = at(base[13]!, dx, dy)
  const ball = { pos: { x: 0, y: 0, z: 0 }, vel: launchVelocity(from.pos, to.pos, "ground", p) }
  return { winnerId: resolveFlight(ball, from.id, to.id, [from, to, def], p, dt, new Rng(seedRng(1))).winnerId, to: to.id, def: def.id }
}

describe("X1: the first tick", () => {
  it("a pass played directly away from an adjacent defender is not cut out (the old rule cut it out)", () => {
    const behind = at(base[13]!, -0.8, 0)
    expect(winner(behind, off)).toBe(behind.id)
    expect(winner(behind, on)).toBe(receiver.id)
  })
  it("a pass played through an adjacent defender is", () => {
    const front = at(base[13]!, 1.0, 0.2)
    expect(winner(front, on)).toBe(front.id)
  })
  it("holds at 25 Hz too (dt 0.04)", () => {
    expect(winner(at(base[13]!, -0.8, 0), on, 0.04)).toBe(receiver.id)
    expect(winner(at(base[13]!, 1.0, 0.2), on, 0.04)).toBe(base[13]!.id)
  })
  it("at 25 Hz a defender close behind or beside the passer cannot take a short pass on a later tick of the first 0.1 s", () => {
    for (const len of [5, 8])
      for (const [dx, dy] of [[-0.3, 0], [-0.5, 0], [0, 0.5]] as const) {
        const r = winnerAt(len, dx, dy, on, 0.04)
        expect(r.winnerId, `len ${len}, defender at (${dx}, ${dy})`).toBe(r.to)
      }
  })
  it("the rule does not depend on the pass direction (a pass along -x mirrors one along +x)", () => {
    for (const dt of [0.1, 0.04]) {
      const away = winnerAt(8, 0.5, 0, on, dt, -1)
      expect(away.winnerId).toBe(away.to)
      const through = winnerAt(8, -1.0, 0.2, on, dt, -1)
      expect(through.winnerId).toBe(through.def)
    }
  })
  it("a teammate at the boot keeps the old rule", () => {
    const mate = at(base[4]!, -0.8, 0)
    expect(winner(mate, on)).toBe(mate.id)
  })
})

describe("X1: boot blocks", () => {
  it("the nearest outfield opponent within bootM of the passer can block; keepers and players further away cannot", () => {
    const near = at(base[13]!, 0.6, 0.3), far = at(base[14]!, 1.5, 0), gk = at(base[11]!, 0.2, 0.2)
    expect(bootBlocker(passer, [far, near, gk], on)?.id).toBe(near.id)
    expect(bootBlocker(passer, [far, gk], on)).toBeNull()
    expect(bootBlocker(passer, [{ ...near, sentOff: true }, far], on)).toBeNull()
  })
})

const bootDeaths = (p: Params, seed: number) => {
  let s = initMatch(makeConfig(seed, { params: p }))
  const events: DomainEvent[] = []
  while (!isFinished(s)) {
    const r = step(s)
    s = r.state
    events.push(...r.events)
  }
  const open = events.filter((e) => e.type === "pass" && !e.attrs.restart)
  const dead = open.filter((e) => e.outcome === "intercepted" && e.frame_id_end! - e.frame_id <= 1 && Math.hypot(e.x_end! - e.x!, e.y_end! - e.y!) < 1)
  return { share: dead.length / open.length, blocks: events.filter((e) => e.type === "block" && e.attrs.blocked === "pass").length }
}

describe("X1 in a match", () => {
  it("passes stop dying at the passer's boot, and some are blocked there instead", () => {
    const before = bootDeaths(off, 7)
    const x1 = bootDeaths(on, 7)
    expect(x1.share).toBeLessThan(before.share / 2)
    expect(before.blocks).toBe(0)
    expect(x1.blocks).toBeGreaterThan(0)
  }, 120_000)
})

describe("X1: what never boot-blocks (F17)", () => {
  it("crosses, clearances and restarts are never blocked at the boot, even when every chance is taken", () => {
    // Every open-play pass with an outfield opponent within 2 m is blocked; only the call site's exclusions stop it.
    const always: Params = { ...on, firstTick: { ...on.firstTick, bootM: 2, bootBlock: 1 } }
    let s = initMatch(makeConfig(7, { params: always }))
    const events: DomainEvent[] = []
    let exposed = 0
    while (!isFinished(s)) {
      const before = s
      const r = step(s)
      s = r.state
      for (const e of r.events) {
        const excluded = e.type === "clearance" || (e.type === "pass" && (e.attrs.restart !== null || e.attrs.kind === "cross"))
        if (!excluded || e.player_id === null) continue
        const me = before.players.find((x) => x.id === e.player_id)!
        if (before.players.some((o) => o.side !== me.side && !o.sentOff && o.role !== "GK" && Math.hypot(o.pos.x - me.pos.x, o.pos.y - me.pos.y) <= 2)) exposed++
      }
      events.push(...r.events)
    }
    const bootBlocks = events.filter((e) => e.type === "block" && e.attrs.blocked === "pass").length
    const blocked = events.filter((e) => (e.type === "pass" || e.type === "clearance") && e.outcome === "blocked")
    // Clearances and restarts are never blocked at all (cross blocks need an open-play cross).
    expect(blocked.filter((e) => e.type === "clearance")).toEqual([])
    expect(blocked.filter((e) => e.type === "pass" && e.attrs.restart !== null)).toEqual([])
    // Every boot block is of an open-play pass that is not a cross: blocked crosses are cross blocks only.
    expect(blocked.filter((e) => e.attrs.kind !== "cross").length).toBe(bootBlocks)
    expect(blocked.filter((e) => e.attrs.kind === "cross").length).toBe(events.filter((e) => e.type === "block" && e.attrs.blocked === "cross").length)
    // Not vacuous (F11): boot blocks happened, and excluded kicks were struck with an opponent at the boot.
    expect(bootBlocks).toBeGreaterThan(0)
    expect(exposed).toBeGreaterThan(0)
  }, 120_000)
})

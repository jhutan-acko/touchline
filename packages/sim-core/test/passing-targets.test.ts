import { readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "vitest"
import { initMatch, isFinished, paramsFromJson, step, type DomainEvent } from "../src/index.js"
import { makeConfig } from "../src/testing.js"

// P3 targets on the calibrated parameters, 4 matches. Those that hold are plain tests; those not met yet are it.fails,
// unwidened, with the measured value: each flips (and fails the suite) once it is met, and then moves back to a plain test.
const root = join(dirname(fileURLToPath(import.meta.url)), "../../..")
const params = paramsFromJson(JSON.parse(readFileSync(join(root, "data/params/touchline-params.json"), "utf8")))
const SEEDS = [7, 9, 11, 13]

interface M { near1: number; near1Ok: number; open: number; bootDeaths: number; switches: number; passes: number; toKeeper: number; crosses: number; punts: number; throws: number; pressed: number[] }

const measure = (seed: number): M => {
  const cfg = makeConfig(seed, { params })
  const role = new Map([cfg.home, cfg.away].flatMap((t) => [...t.starters, ...(t.bench ?? [])]).map((p) => [p.id, p.role]))
  let s = initMatch(cfg)
  const events: DomainEvent[] = []
  const near = new Map<string, number>()
  // Nearest opponent to the passer at the tracking frame of the pass event, i.e. after the step that emits it (the deep
  // report's "Completion, opponent within 1 m at release" reads the frame at the event's frame_id).
  const atRelease = new Map<string, number>()
  while (!isFinished(s)) {
    const before = s
    const r = step(s)
    s = r.state
    for (const e of r.events) {
      if (e.type === "pass" && !e.attrs.restart) {
        const me = (s.players.find((x) => x.id === e.player_id) ?? before.players.find((x) => x.id === e.player_id))!
        atRelease.set(e.id, Math.min(...s.players.filter((x) => x.side !== me.side && !x.sentOff).map((x) => Math.hypot(x.pos.x - me.pos.x, x.pos.y - me.pos.y))))
      }
      if (e.type !== "reception" || e.attrs.first_touch !== "controlled") continue
      const me = s.players.find((x) => x.id === e.player_id)!
      near.set(e.id, Math.min(...s.players.filter((x) => x.side !== me.side && !x.sentOff).map((x) => Math.hypot(x.pos.x - me.pos.x, x.pos.y - me.pos.y))))
    }
    events.push(...r.events)
  }
  const m: M = { near1: 0, near1Ok: 0, open: 0, bootDeaths: 0, switches: 0, passes: 0, toKeeper: 0, crosses: 0, punts: 0, throws: 0, pressed: [] }
  let lastSetPiece = -Infinity
  events.forEach((e, i) => {
    if (e.type === "set_piece") lastSetPiece = e.frame_id
    if (e.type === "keeper_distribution" && e.attrs.method === "punt") m.punts++
    if (e.type === "keeper_distribution" && e.attrs.method === "throw") m.throws++
    if (e.type === "reception" && (near.get(e.id) ?? 99) < 2) {
      const next = events.slice(i + 1).find((g) => g.type === "pass" || g.type === "possession_change")
      if (next?.type === "pass" && next.player_id === e.player_id && !next.attrs.restart) m.pressed.push((next.frame_id - e.frame_id) * cfg.dt)
    }
    if (e.type !== "pass") return
    m.passes++
    const to = e.attrs.intended_receiver_id
    if (typeof to === "string" && role.get(to) === "GK" && role.get(e.player_id!) !== "GK") m.toKeeper++
    if (e.attrs.restart) return
    m.open++
    if ((atRelease.get(e.id) ?? 99) < 1) {
      m.near1++
      if (e.outcome === "successful") m.near1Ok++
    }
    if (e.outcome === "intercepted" && e.frame_id_end! - e.frame_id <= 1 && Math.hypot(e.x_end! - e.x!, e.y_end! - e.y!) < 1) m.bootDeaths++
    if (e.y_end !== null && Math.abs(e.y_end - e.y!) > 25) m.switches++
    if (e.attrs.kind === "cross" && (e.frame_id - lastSetPiece) * cfg.dt > 10) m.crosses++
  })
  return m
}

let all: M[] | undefined
const ms = () => (all ??= SEEDS.map(measure))
const sum = (k: Exclude<keyof M, "pressed">) => ms().reduce((s, m) => s + m[k], 0)
const median = (v: number[]) => [...v].sort((a, b) => a - b)[Math.floor(v.length / 2)]!

describe("P3 real-data targets on the calibrated parameters (4 matches)", () => {
  // NOT MET (Task 10, calibrated params): 0.046 of open-play passes are cut out on the first tick within 1 m (defenders in
  // front of the pass, which X1 keeps; boot blocks are counted apart).
  it.fails("NOT MET: passes rarely die at the passer's boot (X1; real 0, at most 1 %)", () => {
    expect(sum("bootDeaths") / sum("open")).toBeLessThanOrEqual(0.01)
  }, 600_000)
  // NOT MET (Task 10): 0.146. The tuner moved switch_shift to its +2 maximum (long options are mostly classed as switches).
  it.fails("NOT MET: switches are about 6 % of open-play passes (D1; 4-8 %)", () => {
    const v = sum("switches") / sum("open")
    expect(v).toBeGreaterThanOrEqual(0.04)
    expect(v).toBeLessThanOrEqual(0.08)
  }, 600_000)
  // NOT MET (Task 10): 0.019.
  it.fails("NOT MET: about 6 % of passes go back to the keeper (D1, G5a; 4.5-8 %)", () => {
    const v = sum("toKeeper") / sum("passes")
    expect(v).toBeGreaterThanOrEqual(0.045)
    expect(v).toBeLessThanOrEqual(0.08)
  }, 600_000)
  // NOT MET (Task 10): 7.25 per match. The box is empty (P5 A6, S1).
  it.fails("NOT MET: about 15 open-play crosses per match (D3; 12-18)", () => {
    const v = sum("crosses") / SEEDS.length
    expect(v).toBeGreaterThanOrEqual(12)
    expect(v).toBeLessThanOrEqual(18)
  }, 600_000)
  it("about 1.6 punts per team-match (G5; 1.0-2.2)", () => {
    const v = sum("punts") / (2 * SEEDS.length)
    expect(v).toBeGreaterThanOrEqual(1.0)
    expect(v).toBeLessThanOrEqual(2.2)
  }, 600_000)
  // Task 7 ruling: the real punt share of hands distributions (1.6 punts against 3.4 throws per team-match), within
  // 0.08 of 0.32 as the brief's mechanism band was (distribution.test checks the mechanism, sigmoid(puntLogit)).
  it("about a third of the keeper's hands distributions are punts (G5; real 0.32, 0.24-0.40)", () => {
    const v = sum("punts") / (sum("punts") + sum("throws"))
    expect(v).toBeGreaterThanOrEqual(0.24)
    expect(v).toBeLessThanOrEqual(0.4)
  }, 600_000)
  // NOT MET (final fix wave, calibrated params): 0.303 of 251 open-play passes released with an opponent within
  // 1 m complete on these 4 matches (deep report: 0.474 on 64 league matches; same frame, after the step that emits the
  // pass, but test teams against league clubs and 4 matches against 64). The remaining failures are defenders in front of the pass and later
  // interceptions (Task 3 ruling: the target moved to the P3 exit).
  it.fails("NOT MET: passes released with an opponent within 1 m complete about 70 % (X1; 0.64-0.76)", () => {
    const v = sum("near1Ok") / sum("near1")
    expect(v).toBeGreaterThanOrEqual(0.64)
    expect(v).toBeLessThanOrEqual(0.76)
  }, 600_000)
  it("pressed receivers release quickly (D2; median 0.2-0.7 s)", () => {
    const v = median(ms().flatMap((m) => m.pressed))
    expect(v).toBeGreaterThanOrEqual(0.2)
    expect(v).toBeLessThanOrEqual(0.7)
  }, 600_000)
})

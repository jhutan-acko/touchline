import { describe, expect, it } from "vitest"
import { applyIntervention, forkState, initMatch, isFinished, passOptions, playAhead, playAheadFrames, runScript, statesAt, step, whatIf, WhatIfError, type DomainEvent, type MatchState, type Script } from "../src/index.js"
import { dirOf } from "../src/geometry.js"
import { makeConfig } from "../src/testing.js"

const cfg = makeConfig(41)
/** The whole match: its events after each tick, and the states at a few ticks. */
const play = () => {
  let s = initMatch(cfg)
  const events: Array<{ tick: number; e: DomainEvent }> = []
  const states = new Map<number, MatchState>()
  while (!isFinished(s)) {
    const r = step(s)
    s = r.state
    states.set(s.tick, s)
    for (const e of r.events) events.push({ tick: s.tick, e })
  }
  return { events, states }
}
const match = play()
/** The first state from `from` on where an outfielder is on the ball with at least two pass options (keepers wait out their hold before any decision). */
const onBall = (from: number): MatchState => {
  for (let t = from; ; t++) {
    const s = match.states.get(t)!
    if (s.possession.kind !== "owned") continue
    const owner = s.players.find((p) => p.id === (s.possession as { playerId: string }).playerId)!
    if (owner.role !== "GK" && passOptions(s).length >= 2) return s
  }
}

describe("states and forks", () => {
  it("give the match's state at a tick, from which the rest of the match plays out the same", () => {
    const at = statesAt(cfg, [3000, 30_000])
    expect([...at.keys()]).toEqual([3000, 30_000])
    expect(at.get(30_000)).toEqual(match.states.get(30_000))
    const rest = playAhead(at.get(30_000)!, 1_000_000).events
    expect(rest).toEqual(match.events.filter((x) => x.tick > 30_000).map((x) => x.e))
  })

  it("give a scripted match's accepted states, inside and after a retried window", () => {
    const script: Script = { name: "t", entries: [{ window: [10, 25], team: "home", effect: "goal", count: 6 }] }
    // Seed 43: the first from 42 on whose window needs a retry (42 reaches six goals at the first attempt with the P2 goal nudge).
    const scfg = makeConfig(43, { script })
    const run = runScript(scfg, { retries: 1, statesAt: new Set([9000, 20_000]) })
    expect(run.windows[0]!.attempts).toBeGreaterThan(1)
    const ticksOf = (from: number) => run.steps.flatMap((r) => r.events).filter((e) => Math.max(e.frame_id, e.frame_id_end ?? e.frame_id) > from)
    for (const t of [9000, 20_000]) expect(playAhead(run.states.get(t)!, 1_000_000).events).toEqual(ticksOf(t))
    expect(statesAt(scfg, [20_000]).get(20_000)).toBeDefined()
  })

  it("drop forced outcomes whose window has ended, so a state taken inside a forced window plays on like the main run", () => {
    // A goal forced for the home side in minutes 0-2 that never came: from a state inside the window, it must lapse at minute 2.
    const script: Script = { name: "t", entries: [{ window: [0, 2], team: "home", effect: "goal", count: 9 }] }
    // Seed 5: no goal in the first two minutes (a goal would use the entry up before its window ends). Re-picked for P4
    // Task 10 (P4 behaviours on, recalibrated), the first that qualifies (scan of seeds 1-30: 5, 6, 8, 10, 11, 13, 15, 16,
    // 20, 22, 24, 26, 27, 28. P3 Task 10d fix round 1 had 1, 2, 5, 8, 10, 16, 18, 26, 27, 28; Task 10d had 13; Task 10
    // had 3, 5 and 8; Task 8b had 1, 2, 3, 6, 10 and 11).
    let s: MatchState = { ...initMatch(makeConfig(5, { script })), forced: [script.entries[0]!] }
    const minute = (st: MatchState) => (st.period === "first_half" ? 0 : 45) + (st.periodTick * st.config.dt) / 60
    while (minute(s) < 2) s = step(s).state
    expect(s.forced.length).toBeGreaterThan(0)
    s = step(s).state
    expect(s.forced).toEqual([])
  })

  it("fork with fresh random streams: forks differ from each other but each is reproducible", () => {
    // Tick 20 500: play is live in the next 300 ticks (an empty stretch would make the forks trivially equal).
    const s = match.states.get(20_500)!
    const a = playAhead(forkState(s, 0), 300).events
    expect(playAhead(forkState(s, 0), 300).events).toEqual(a)
    expect(playAhead(forkState(s, 1), 300).events).not.toEqual(a)
  })
})

describe("play ahead with frames", () => {
  it("plays exactly like playAhead and keeps one frame per tick, the same for the same fork", () => {
    const s = onBall(12_000)
    const plain = playAhead(forkState(s, 3), 50)
    const shown = playAheadFrames(forkState(s, 3), 50)
    expect(shown.events).toEqual(plain.events)
    expect(shown.state).toEqual(plain.state)
    expect(shown.frames.map((f) => f.tick)).toEqual(Array.from({ length: 50 }, (_, i) => s.tick + 1 + i))
    const last = shown.frames.at(-1)!
    for (const p of shown.state.players.filter((q) => !q.sentOff)) {
      const f = [...last.home, ...last.away].find((x) => x.id === p.id)!
      expect(f.x).toBeCloseTo(p.pos.x, 2)
      expect(f.y).toBeCloseTo(p.pos.y, 2)
    }
    expect(playAheadFrames(forkState(s, 3), 50).frames).toEqual(shown.frames)
  })

  it("stops at full time", () => {
    const out = playAheadFrames(match.states.get(Math.max(...match.states.keys()) - 5)!, 100)
    expect(isFinished(out.state)).toBe(true)
    expect(out.frames.length).toBeLessThanOrEqual(5)
  })
})

describe("interventions", () => {
  it("make the player on the ball play the pass chosen for them at the next tick", () => {
    const s = onBall(12_000)
    const owner = (s.possession as { playerId: string }).playerId
    const target = passOptions(s).at(-1)!
    const after = applyIntervention(forkState(s, 0), { kind: "pass_to", playerId: owner, receiverId: target.receiverId })
    // A pass event is emitted when the ball arrives; its frame id is the tick it was played.
    const pass = playAhead(after, 100).events.find((e) => e.type === "pass" && e.player_id === owner)!
    expect(pass.attrs.intended_receiver_id).toBe(target.receiverId)
    expect(pass.frame_id).toBe(s.tick + 1)
  })

  it("offer a live run_in_behind runner a through-kind target under through.rule=1, and not once the run has expired", () => {
    const s00 = onBall(12_000)
    const ownerId = (s00.possession as { playerId: string }).playerId
    const side = s00.players.find((p) => p.id === ownerId)!.side
    const d = dirOf(side, s00.period)
    // Geometry that makes the run a through ball: the owner in his own half, every opponent on the line at u 15, the runner ahead of it.
    const runnerId = s00.players.find((p) => p.side === side && p.id !== ownerId && p.role !== "GK")!.id
    const s0: MatchState = {
      ...s00,
      players: s00.players.map((p) =>
        p.id === ownerId ? { ...p, pos: { x: d * -10, y: 0 }, vel: { x: 0, y: 0 } } : p.side !== side ? { ...p, pos: { x: d * 15, y: (p.slot % 7) * 4 - 12 }, vel: { x: 0, y: 0 } } : p
      )
    }
    const owner = s0.players.find((p) => p.id === ownerId)!
    const runner = s0.players.find((p) => p.id === runnerId)!
    const withRun = (until: number): MatchState => ({
      ...s0,
      config: { ...s0.config, params: { ...s0.config.params, through: { ...s0.config.params.through, rule: 1 } } },
      players: s0.players.map((p) =>
        p.id === runner.id
          ? { ...p, pos: { x: d * 5, y: 0 }, vel: { x: 0, y: 0 }, intent: { kind: "run_in_behind" as const, target: { x: d * 30, y: 0 } }, intentUntil: until }
          : p
      )
    })
    const isThrough = (c: { receiverId: string; kind: string }) => c.receiverId === runner.id && (c.kind === "through" || c.kind === "lofted_through")
    const live = passOptions(withRun(s0.tick + 100)).filter(isThrough)
    expect(live).toHaveLength(1)
    expect(live[0]!.target.x * d).toBeGreaterThan(5)
    expect(passOptions(withRun(s0.tick - 1)).filter(isThrough)).toEqual([])
  })

  it("refuse a pass the player cannot make", () => {
    const s = onBall(12_000)
    const owner = (s.possession as { playerId: string }).playerId
    const mate = s.players.find((p) => p.side === s.players.find((x) => x.id === owner)!.side && p.id !== owner)!
    const opponent = s.players.find((p) => p.side !== mate.side)!
    expect(() => applyIntervention(s, { kind: "pass_to", playerId: mate.id, receiverId: owner })).toThrow(/not on the ball/)
    expect(() => applyIntervention(s, { kind: "pass_to", playerId: owner, receiverId: opponent.id })).toThrow(/not a teammate/)
    expect(() => applyIntervention(s, { kind: "pass_to", playerId: owner, receiverId: "nobody" })).toThrow(WhatIfError)
  })

  it("move a player, but not the one on the ball, and change a team's style within its ranges", () => {
    const s = onBall(12_000)
    const owner = (s.possession as { playerId: string }).playerId
    const other = s.players.find((p) => p.id !== owner && !p.sentOff)!
    const moved = applyIntervention(s, { kind: "move_player", playerId: other.id, to: { x: 10, y: 99 } })
    expect(moved.players.find((p) => p.id === other.id)!.pos).toEqual({ x: 10, y: 33.5 })
    expect(() => applyIntervention(s, { kind: "move_player", playerId: owner, to: { x: 0, y: 0 } })).toThrow(/on the ball/)
    const pressing = applyIntervention(s, { kind: "tactic", side: "away", style: { pressIntensity: 1, lineHeight: 0.9 } })
    expect(pressing.config.away.style).toMatchObject({ pressIntensity: 1, lineHeight: 0.9, tempo: cfg.away.style.tempo })
    expect(() => applyIntervention(s, { kind: "tactic", side: "away", style: { pressIntensity: 2 } })).toThrow(/between 0 and 1/)
    expect(() => applyIntervention(s, { kind: "tactic", side: "away", style: { bravery: 1 } as never })).toThrow(/unknown style setting/)
  })
})

describe("review fixes", () => {
  it("forks carry no forced outcomes of a scenario window (they would know the future)", () => {
    const s = { ...match.states.get(20_000)!, forced: [{ window: [30, 45] as const, team: "home" as const, effect: "goal" as const }] }
    expect(forkState(s, 0).forced).toEqual([])
  })

  it("a forced pass is marked, reported per arm, and dropped after its tick if it cannot be played", () => {
    const s = onBall(20_000)
    const owner = (s.possession as { playerId: string }).playerId
    const target = passOptions(s)[0]!
    const r = whatIf(s, { kind: "pass_to", playerId: owner, receiverId: target.receiverId }, { seeds: 4, horizonS: 5 })
    expect(r.forced_applied).toEqual({ baseline: null, variant: 4 })
    const forced = applyIntervention(forkState(s, 0), { kind: "pass_to", playerId: owner, receiverId: target.receiverId })
    expect(playAhead(forced, 60).events.some((e) => e.type === "pass" && e.attrs.forced_pass === true)).toBe(true)
    // An override nobody can carry out (an unknown receiver) is never applied and does not linger.
    const stale = { ...forced, override: { ...forced.override!, receiverId: "nobody" } }
    const after = playAhead(stale, 60)
    expect(after.events.some((e) => e.attrs.forced_pass === true)).toBe(false)
    expect(after.state.override).toBeUndefined()
  })
})

describe("what if", () => {
  it("pairs the arms seed by seed: changing nothing makes no difference at all", () => {
    const r = whatIf(onBall(20_000), { kind: "none" }, { seeds: 6, horizonS: 15 })
    for (const d of Object.values(r.difference)) expect(d).toEqual({ mean: 0, se: 0 })
    expect(r.baseline.ball_progress.se).toBeGreaterThan(0)
  })

  it("measures what a forced pass changes, deterministically and quickly", () => {
    const s = onBall(20_000)
    const owner = (s.possession as { playerId: string }).playerId
    const best = passOptions(s)[0]!
    const worst = passOptions(s).at(-1)!
    const opts = { seeds: 20, horizonS: 20, baseline: { kind: "pass_to" as const, playerId: owner, receiverId: best.receiverId } }
    const t0 = performance.now()
    const r = whatIf(s, { kind: "pass_to", playerId: owner, receiverId: worst.receiverId }, opts)
    expect(performance.now() - t0).toBeLessThan(5000)
    expect(whatIf(s, { kind: "pass_to", playerId: owner, receiverId: worst.receiverId }, opts)).toEqual(r)
    expect(r).toMatchObject({ seeds: 20, horizon_s: 20, at_tick: s.tick })
    expect(Number.isFinite(r.difference.xg_diff.mean)).toBe(true)
  })

  it("plays the same number of seconds at 25 frames per second", () => {
    let s = initMatch(makeConfig(43, { dt: 0.04 }))
    while (s.tick < 5000 || s.possession.kind !== "owned") s = step(s).state
    const ahead = playAhead(forkState(s, 0), Math.round(4 / 0.04))
    expect(ahead.state.tick).toBe(s.tick + 100)
    const r = whatIf(s, { kind: "none" }, { seeds: 3, horizonS: 4 })
    expect(r).toMatchObject({ horizon_s: 4, at_tick: s.tick })
    expect(r.difference.total).toEqual({ mean: 0, se: 0 })
  })

  it("refuses silly options and finished matches", () => {
    const s = onBall(20_000)
    expect(() => whatIf(s, { kind: "none" }, { seeds: 0 })).toThrow(/seeds/)
    expect(() => whatIf(s, { kind: "none" }, { horizonS: 1000 })).toThrow(/horizonS/)
    const end = [...match.states.values()].at(-1)!
    expect(() => whatIf(end, { kind: "none" })).toThrow(/over/)
  })
})

describe("pass options for a keeper with the ball in his hands", () => {
  const inHandsState = () => {
    for (const s of match.states.values()) {
      const p = s.possession
      if (p.kind === "owned" && p.inHands === true && p.restart === null && passOptions(s).some((c) => c.method !== undefined)) return s
    }
    throw new Error("no keeper-hands state in the match")
  }

  it("offer only throws (4-35 m, ground) and punts (high), and every one is accepted as a pass_to override", () => {
    const s = inHandsState()
    const opts = passOptions(s)
    expect(opts.length).toBeGreaterThan(0)
    for (const c of opts) {
      expect(c.method === "throw" || c.method === "punt").toBe(true)
      expect(c.height).toBe(c.method === "throw" ? "ground" : "high")
      expect(() => applyIntervention(s, { kind: "pass_to", playerId: (s.possession as { playerId: string }).playerId, receiverId: c.receiverId, ...(c.kind ? { passKind: c.kind } : {}) })).not.toThrow()
    }
  })

  it("fall back to the foot options once his hold has ended", () => {
    const s = inHandsState()
    const feet = passOptions({ ...s, possession: { ...(s.possession as object), inHands: false } as MatchState["possession"] })
    expect(feet.some((c) => c.method === undefined)).toBe(true)
  })
})

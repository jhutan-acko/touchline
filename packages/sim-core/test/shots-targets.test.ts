import { readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "vitest"
import { initMatch, isFinished, paramsFromJson, step, type DomainEvent, type Frame } from "../src/index.js"
import { makeConfig } from "../src/testing.js"

// P6 targets on the calibrated parameters, 8 matches (plan 8f ruling 17, Task 8 Step 7: test teams, seeds 7-21, fixed by
// this file's rule and never re-picked; conversion splits need about 190 shots). Those that hold are plain tests; those
// not met yet are it.fails, unwidened, with the measured value: each flips (and fails the suite) once it is met, and then
// moves back to a plain test.
// Definitions follow python/analytics/touchline_analytics/shots.py (the reports' shots section), read on the engine's
// 10 Hz frames: open play is technique "normal" more than 10 s after the period's last set_piece; first time is a shot
// less than round(0.3 fps) frames after the shooter last gained the ball (a completed pass to him, his interception or
// ball recovery); a header is body_part "head"; the nearest defender is the nearest outfield opponent at the shot's frame;
// late-match completion is open-play completion over 75-90+ minus over 0-15.
const root = join(dirname(fileURLToPath(import.meta.url)), "../../..")
const params = paramsFromJson(JSON.parse(readFileSync(join(root, "data/params/touchline-params.json"), "utf8")))
const SEEDS = [7, 9, 11, 13, 15, 17, 19, 21]

const SET_PIECE_EXCL_S = 10
const FIRST_TIME_S = 0.3
const TIGHT_M = 1.5
const OPEN_M = 3
// Task 2 Step 3 (seven IDSSE matches): completion over 75-90+ minus over 0-15.
const REAL_LATE_DROP = -0.063

interface Shot { readonly open: boolean; readonly goal: boolean; readonly firstTime: boolean; readonly header: boolean; readonly nearDef: number | null }
interface M { readonly shots: ReadonlyArray<Shot>; readonly goals: number; readonly bins: ReadonlyArray<readonly [number, number]> }

const measure = (seed: number): M => {
  const cfg = makeConfig(seed, { params })
  const keepers = new Set([cfg.home, cfg.away].flatMap((tm) => [...tm.starters, ...(tm.bench ?? [])]).filter((p) => p.role === "GK").map((p) => p.id))
  let s = initMatch(cfg)
  const frames: Frame[] = []
  const events: DomainEvent[] = []
  while (!isFinished(s)) {
    const r = step(s)
    s = r.state
    if (r.frame) frames.push(r.frame)
    events.push(...r.events)
  }
  const at = new Map(frames.map((f) => [f.tick, f]))
  const fps = 1 / cfg.dt
  const ftFrames = Math.round(FIRST_TIME_S * fps)
  const gains = new Map<string, Array<{ period: string; frame: number }>>()
  const gain = (pid: string, period: string, frame: number) => gains.set(pid, [...(gains.get(pid) ?? []), { period, frame }])
  for (const e of events) {
    if (e.type === "pass" && e.outcome === "successful" && typeof e.attrs.receiver_id === "string" && e.frame_id_end !== null) gain(e.attrs.receiver_id, e.period, e.frame_id_end)
    else if (e.player_id !== null && (e.type === "ball_recovery" || (e.type === "interception" && e.attrs.ball !== "deflected"))) gain(e.player_id, e.period, e.frame_id)
  }
  const lastGain = (pid: string, period: string, frame: number) =>
    (gains.get(pid) ?? []).filter((g) => g.period === period && g.frame <= frame).reduce<number | null>((b, g) => (b === null || g.frame > b ? g.frame : b), null)
  const lastSp = new Map<string, number>()
  const shots: Shot[] = []
  const bins: Array<[number, number]> = Array.from({ length: 6 }, () => [0, 0])
  for (const e of events) {
    if (e.type === "set_piece") lastSp.set(e.period, e.frame_id)
    if (e.type === "pass" && !e.attrs.restart && (e.period === "first_half" || e.period === "second_half")) {
      const b = 3 * (e.period === "first_half" ? 0 : 1) + Math.min(Math.floor(e.period_frame_id / fps / 900), 2)
      bins[b]![0] += e.outcome === "successful" ? 1 : 0
      bins[b]![1] += 1
    }
    if (e.type !== "shot" || e.player_id === null || e.x === null || e.y === null) continue
    const g = lastGain(e.player_id, e.period, e.frame_id)
    const f = at.get(e.frame_id)
    let nearDef: number | null = null
    if (f) {
      const side = f.home.some((p) => p.id === e.player_id) ? "home" : "away"
      const opp = (side === "home" ? f.away : f.home).filter((p) => !keepers.has(p.id))
      if (opp.length) nearDef = Math.min(...opp.map((p) => Math.hypot(p.x - e.x!, p.y - e.y!)))
    }
    shots.push({
      open: (e.attrs.technique ?? "normal") === "normal" && e.frame_id - (lastSp.get(e.period) ?? -Infinity) > SET_PIECE_EXCL_S * fps,
      goal: e.outcome === "goal",
      firstTime: g !== null && e.frame_id - g < ftFrames,
      header: e.attrs.body_part === "head",
      nearDef
    })
  }
  return { shots, goals: events.filter((e) => e.type === "goal").length, bins }
}

let all: M[] | undefined
const ms = () => (all ??= SEEDS.map(measure))
const open = () => ms().flatMap((m) => m.shots.filter((x) => x.open))
const conv = (xs: ReadonlyArray<Shot>) => xs.filter((x) => x.goal).length / xs.length
const rate = (b: readonly [number, number]) => b[0] / b[1]
const bin = (i: number): [number, number] => [ms().reduce((a, m) => a + m.bins[i]![0], 0), ms().reduce((a, m) => a + m.bins[i]![1], 0)]

describe("P6 real-data targets on the calibrated parameters (8 matches)", () => {
  // Non-vacuity (F11), outside the it.fails cases, so a run without shots fails the suite.
  it("the measure pass sees at least 120 open-play shots, 20 first-time shots and 30 shots with a defender within 1.5 m and beyond 3 m", () => {
    const op = open()
    expect(op.length).toBeGreaterThanOrEqual(120)
    expect(op.filter((x) => x.firstTime).length).toBeGreaterThanOrEqual(20)
    expect(op.filter((x) => x.nearDef !== null && x.nearDef < TIGHT_M).length).toBeGreaterThanOrEqual(30)
    expect(op.filter((x) => x.nearDef !== null && x.nearDef >= OPEN_M).length).toBeGreaterThanOrEqual(30)
  }, 1_800_000)
  // NOT MET (Task 8, calibrated params): 0.279. Too few clean ground receptions within 25 m of goal (Task 3).
  it.fails("NOT MET: about two in five open-play shots are first time (SH1)", () => {
    const op = open()
    const v = op.filter((x) => x.firstTime).length / op.length
    expect(v).toBeGreaterThanOrEqual(0.33)
    expect(v).toBeLessThanOrEqual(0.49)
  }, 1_800_000)
  // NOT MET (Task 8): conv_ft - conv_other = -0.136 (first-time shots convert worse; deep report below).
  it.fails("NOT MET: first-time shots convert better than the rest (SH1)", () => {
    const op = open()
    expect(conv(op.filter((x) => x.firstTime)) - conv(op.filter((x) => !x.firstTime))).toBeGreaterThanOrEqual(0.02)
  }, 1_800_000)
  // NOT MET (Task 8): 0.008. Open-play crosses are about a third of real (P5 gap), so few high balls reach the box.
  it.fails("NOT MET: about one shot in seven is a header (SH2)", () => {
    const op = open()
    const v = op.filter((x) => x.header).length / op.length
    expect(v).toBeGreaterThanOrEqual(0.1)
    expect(v).toBeLessThanOrEqual(0.18)
  }, 1_800_000)
  // NOT MET (Task 8): conv_tight - conv_open = -0.092 (open shots convert far above real 0.032; Task 5).
  it.fails("NOT MET: tight shots convert better than open ones (SH3)", () => {
    const op = open().filter((x) => x.nearDef !== null)
    expect(conv(op.filter((x) => x.nearDef! < TIGHT_M)) - conv(op.filter((x) => x.nearDef! >= OPEN_M))).toBeGreaterThanOrEqual(0.03)
  }, 1_800_000)
  // NOT MET (Task 8): 4.25 goal events per match on the test teams (own goals included; the gate's league fixtures read
  // 3.44 shot goals on the gate seeds and 3.25 goal events in the 16-match report).
  it.fails("NOT MET: goals stay about 2.7 per match", () => {
    const v = ms().reduce((a, m) => a + m.goals, 0) / SEEDS.length
    expect(v).toBeGreaterThanOrEqual(2.3)
    expect(v).toBeLessThanOrEqual(3.1)
  }, 1_800_000)
  // NOT MET (Task 8): -0.020 against real -0.063 (Task 6: execution fatigue is not the driver).
  it.fails("NOT MET: late-match completion falls as in real matches (SH4)", () => {
    const v = rate(bin(5)) - rate(bin(0))
    expect(v).toBeGreaterThanOrEqual(REAL_LATE_DROP - 0.02)
    expect(v).toBeLessThanOrEqual(REAL_LATE_DROP + 0.02)
  }, 1_800_000)
})

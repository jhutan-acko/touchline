import { execFileSync, spawnSync } from "node:child_process"
import { mkdtempSync, readFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { Effect } from "effect"
import { describe, expect, it } from "vitest"
import type { League } from "@touchline/league"
import { writeMatch } from "@touchline/sim"
import { DEFAULT_PARAMS, dirOf, goalOf, initMatch, isFinished, paramsFromJson, step, xgOf, type DomainEvent, type Frame, type PlayerState } from "@touchline/sim-core"
import { StatsEngine } from "../src/engine.js"
import { infoFromConfig } from "../src/input.js"
import { goalAngle, keeperIndex, laneDefenders, lineDefenders, modelsFromJson, ModelsError, passFeatures, predict, predictXg, pressureAt, shotFeatures } from "../src/models.js"
import { shotXg } from "../src/derive.js"

const root = join(dirname(fileURLToPath(import.meta.url)), "../../..")
const committed = () => JSON.parse(readFileSync(join(root, "data/params/stats-models.json"), "utf8"))
const calibrated = paramsFromJson(JSON.parse(readFileSync(join(root, "data/params/touchline-params.json"), "utf8")))
const hasUv = spawnSync("uv", ["--version"]).status === 0
const league = () => JSON.parse(readFileSync(join(root, "data/league/league.json"), "utf8")) as League

describe("stats models", () => {
  it("count lane defenders near the line but not at its ends, at most three", () => {
    const opp = [{ x: 10, y: 1.5 }, { x: 10, y: 2.5 }, { x: 0.5, y: 0 }, { x: 19.5, y: 0.5 }, { x: 5, y: -1 }]
    expect(laneDefenders({ x: 0, y: 0 }, { x: 20, y: 0 }, opp)).toBe(2)
    expect(laneDefenders({ x: 0, y: 0 }, { x: 40, y: 0 }, [5, 10, 15, 20, 25, 30, 35].map((x) => ({ x, y: 0 })))).toBe(3)
  })

  it("measure pressure from one on the ball to zero at five metres", () => {
    expect(pressureAt({ x: 0, y: 0 }, [{ x: 0, y: 0 }])).toBe(1)
    expect(pressureAt({ x: 0, y: 0 }, [{ x: 2.5, y: 0 }, { x: 30, y: 0 }])).toBeCloseTo(0.5, 12)
    expect(pressureAt({ x: 0, y: 0 }, [])).toBe(0)
  })

  it("measure forward progress in the attacking direction", () => {
    expect(passFeatures({ x: 0, y: 0 }, { x: -10, y: 0 }, 1, [])).toEqual([1, -1, 0, 0])
    expect(passFeatures({ x: 0, y: 0 }, { x: -10, y: 0 }, -1, [])).toEqual([1, 1, 0, 0])
  })

  it("measure the goal angle and the outfield defenders in the shot line, uncapped", () => {
    expect(goalAngle({ x: 30, y: 0 }, 1)).toBeCloseTo(2 * Math.atan(3.66 / 22.5), 12)
    expect(goalAngle({ x: 30, y: 5 }, 1)).toBeCloseTo(goalAngle({ x: -30, y: 5 }, -1), 12)
    expect(lineDefenders({ x: 36, y: 0 }, 1, [{ x: 40, y: 1.4 }, { x: 44, y: -0.5 }, { x: 48, y: 0 }, { x: 50, y: 1 }])).toBe(4)
    // 1.5 m off the line, behind the shooter, or beyond the goal centre: not in the line.
    expect(lineDefenders({ x: 36, y: 0 }, 1, [{ x: 44, y: 1.6 }, { x: 30, y: 0 }, { x: 53, y: 0 }])).toBe(0)
    expect(keeperIndex(1, [{ x: 44, y: 0.5 }, { x: 51.5, y: 0 }, { x: 44, y: 8 }])).toBe(1)
    expect(keeperIndex(1, [])).toBe(-1)
    const f = shotFeatures({ x: -41.5, y: 0 }, -1, true, [])
    expect(f[0]).toBeCloseTo(11, 12)
    expect([f[2], f[3]]).toEqual([1, 0])
  })

  it("load the committed models: xPass's fit beats the base rate on held-out matches; xG is the simulator's", () => {
    const raw = committed()
    const m = modelsFromJson(raw, calibrated)
    expect(m.xpass.coefficients).toHaveLength(4)
    expect(raw.xpass.held_out_log_loss).toBeLessThan(raw.xpass.base_rate_log_loss)
    // Harder passes are less likely to arrive; closer, more central shots more likely to score.
    const easy = predict(m.xpass, passFeatures({ x: 0, y: 0 }, { x: 0, y: 10 }, 1, []))
    const hard = predict(m.xpass, passFeatures({ x: 0, y: 0 }, { x: 35, y: 0 }, 1, [{ x: 1, y: 1 }, { x: 15, y: 0.5 }, { x: 25, y: -0.5 }]))
    expect(easy).toBeGreaterThan(0.85)
    expect(hard).toBeLessThan(0.35)
    const close = predictXg(m.xg, shotFeatures({ x: 46.5, y: 0 }, 1, false, []))
    const far = predictXg(m.xg, shotFeatures({ x: 27.5, y: 0 }, 1, false, []))
    expect(close).toBeGreaterThan(0.35)
    expect(far).toBeLessThan(0.06)
    // The committed parameters run the DFL refit (shotModel.rule 1), and the stats engine reads them as they are.
    expect(calibrated.shotModel.rule).toBe(1)
    expect(m.xg.params.shotModel.xg).toEqual(calibrated.shotModel.xg)
    expect(close).toBe(xgOf(calibrated, "home", "first_half", { x: 46.5, y: 0 }, false, 0))
  })

  it("refuse a models file with a missing or misnamed coefficient", () => {
    const raw = committed()
    expect(() => modelsFromJson({ ...raw, xpass: { ...raw.xpass, coefficients: { ...raw.xpass.coefficients, pressure: "x" } } }, calibrated)).toThrow(ModelsError)
    expect(() => modelsFromJson({ ...raw, xg: { ...raw.xg, features: ["distance_10m"] } }, calibrated)).toThrow(/xg.features/)
    expect(() => modelsFromJson({ ...raw, xg: { ...raw.xg, penalty: 2 } }, calibrated)).toThrow(/penalty/)
  })

  it("give the simulator's xG for the same shot: xgOf on the same features, to 1e-12", () => {
    const m = modelsFromJson(committed(), calibrated)
    const cfg = { matchId: "xg", seed: 1, kickoffTime: "2026-10-18T14:00:00.000Z", home: league().clubs[1]!, away: league().clubs[2]!, params: calibrated, dt: 0.1 }
    const s0 = initMatch(cfg)
    const away = s0.players.filter((p) => p.side === "away")
    // Random shooters and defenders around the box (seeded LCG); the keeper among them is left out by role.
    let seed = 7
    const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648)
    let checked = 0
    for (let k = 0; k < 400; k++) {
      const at = { x: 20 + 32 * rnd(), y: -25 + 50 * rnd() }
      const placed: PlayerState[] = away.map((p) => ({ ...p, pos: p.role === "GK" ? { x: 50 + 2 * rnd(), y: -2 + 4 * rnd() } : { x: at.x + (52.5 - at.x) * rnd(), y: at.y * (1 - rnd()) + (-2 + 4 * rnd()) } }))
      const header = rnd() < 0.3
      const cone = placed.filter((o) => o.role !== "GK" && (() => {
        const g = goalOf("home", "first_half")
        const vx = g.x - at.x, vy = g.y - at.y, l2 = vx * vx + vy * vy
        const t = Math.max(0, Math.min(1, ((o.pos.x - at.x) * vx + (o.pos.y - at.y) * vy) / l2))
        return Math.hypot(at.x + t * vx - o.pos.x, at.y + t * vy - o.pos.y) < 1.5 && t > 0 && t < 1
      })()).length
      const sim = xgOf(calibrated, "home", "first_half", at, header, cone)
      const frame = { tick: 0, frame_id: 0, period: "first_half" as const, home: [], away: placed.map((p) => ({ id: p.id, x: p.pos.x, y: p.pos.y })), ball: { x: at.x, y: at.y, z: 0 }, ball_in_play: true, possession_side: "home" as const }
      const e = { id: `s${k}`, type: "shot", frame_id: 1, period: "first_half", x: at.x, y: at.y, attrs: { technique: "normal", body_part: header ? "head" : "right_foot" } } as unknown as DomainEvent
      const stats = shotXg(e, frame, "home", m, new Set(away.filter((p) => p.role === "GK").map((p) => p.id)))
      expect(stats, `shot ${k}`).not.toBeNull()
      expect(Math.abs(stats! - sim), `shot ${k}`).toBeLessThanOrEqual(1e-12)
      if (cone > 0) checked++
    }
    // Non-vacuity: the defenders in the line take part.
    expect(checked).toBeGreaterThan(50)
  })

  it("equal the recorded attrs.xg for every shot of a match (to the 0.001 rounding of attrs.xg and the 0.01 m of positions)", () => {
    const m = modelsFromJson(committed(), calibrated)
    const lg = league()
    let n = 0, ft = 0, worst = 0
    for (const seed of [7, 12]) {
      const cfg = { matchId: `xg-${seed}`, seed, kickoffTime: "2026-10-18T14:00:00.000Z", home: lg.clubs[1]!, away: lg.clubs[2]!, params: calibrated, dt: 0.1 }
      const eng = new StatsEngine(infoFromConfig(cfg), m)
      const shots: DomainEvent[] = []
      let s = initMatch(cfg)
      while (!isFinished(s)) {
        const r = step(s)
        s = r.state
        for (const e of r.events) {
          eng.ingest({ kind: "event", event: e })
          if (e.type === "shot") shots.push(e)
        }
        if (r.frame) eng.ingest({ kind: "frame", frame: r.frame })
      }
      for (const e of shots) {
        const v = eng.derived.get(e.id)?.["shot.xg"]
        expect(v, e.id).toBeDefined()
        const d = Math.abs(v! - (e.attrs.xg as number))
        worst = Math.max(worst, d)
        // attrs.xg is rounded to 0.001 (step.ts), and the frames the stats engine reads hold positions to 0.01 m: near
        // goal the angle term turns 0.005 m into up to ~0.001 of xG (seed 12's closest shot: 0.00136).
        expect(d, `${e.id} attrs.xg ${e.attrs.xg} stats ${v}`).toBeLessThanOrEqual(0.002)
        n++
        if (e.attrs.first_time === true) ft++
      }
    }
    expect(n).toBeGreaterThan(30)
    expect(ft).toBeGreaterThan(3)
    expect(worst).toBeGreaterThan(0)
  }, 300_000)

  // In CI the test must run: a missing uv fails it rather than skipping it.
  it.skipIf(!hasUv && !process.env.CI)("compute the same features as the Python fit for every pass and shot of a synthetic match", async () => {
    const league = JSON.parse(readFileSync(join(root, "data/league/league.json"), "utf8")) as League
    const cfg = { matchId: "parity", seed: 4243, kickoffTime: "2026-10-18T14:00:00.000Z", home: league.clubs[1]!, away: league.clubs[2]!, params: DEFAULT_PARAMS, dt: 0.1 }
    const dir = mkdtempSync(join(tmpdir(), "touchline-models-"))
    await Effect.runPromise(writeMatch(cfg, dir))
    const py = JSON.parse(
      execFileSync("uv", ["run", "--locked", "--project", join(root, "python/analytics"), "python", "-m", "touchline_analytics.stats_models", dir, join(root, "data/league/league.json")], { encoding: "utf8", maxBuffer: 1 << 26 })
    ) as Array<{ id: string; features: number[] }>
    const frames = new Map<number, Frame>()
    const events: DomainEvent[] = []
    let s = initMatch(cfg)
    while (!isFinished(s)) {
      const r = step(s)
      s = r.state
      events.push(...r.events)
      if (r.frame) frames.set(r.frame.tick, r.frame)
    }
    const byId = new Map(events.map((e) => [e.id, e]))
    const keepers = new Set([...cfg.home.squad, ...cfg.away.squad].filter((p) => p.role === "GK").map((p) => p.id))
    expect(py.length).toBeGreaterThan(500)
    let shots = 0
    for (const row of py) {
      const e = byId.get(row.id)!
      // A shot's features are measured in the frame its xG was decided on (see StatsEngine.onShot).
      const f = frames.get(e.type === "shot" && e.attrs.first_time !== true ? e.frame_id - 1 : e.frame_id)!
      const home = e.team_id === cfg.home.id
      const opp = home ? f.away : f.home
      const ts =
        e.type === "pass"
          ? passFeatures({ x: e.x!, y: e.y! }, { x: e.x_end!, y: e.y_end! }, dirOf(home ? "home" : "away", e.period), opp)
          : shotFeatures({ x: e.x!, y: e.y! }, dirOf(home ? "home" : "away", e.period), e.attrs.body_part === "head", opp.filter((o) => !keepers.has(o.id)))
      if (e.type === "shot") shots++
      ts.forEach((v, i) => expect(v, `${row.id}[${i}]`).toBeCloseTo(row.features[i]!, 9))
    }
    expect(shots).toBeGreaterThan(10)
  })
})

import { execFileSync, spawnSync } from "node:child_process"
import { mkdtempSync, readFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { Effect } from "effect"
import { describe, expect, it } from "vitest"
import type { League } from "@touchline/league"
import { writeMatch } from "@touchline/sim"
import { DEFAULT_PARAMS, initMatch, isFinished, step, type DomainEvent, type Frame } from "@touchline/sim-core"
import { coneDefenders, goalAngle, laneDefenders, modelsFromJson, ModelsError, passFeatures, predict, pressureAt, shotFeatures } from "../src/models.js"

const root = join(dirname(fileURLToPath(import.meta.url)), "../../..")
const committed = () => JSON.parse(readFileSync(join(root, "data/params/stats-models.json"), "utf8"))
const hasUv = spawnSync("uv", ["--version"]).status === 0

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

  it("measure the goal angle and the defenders in the shot cone, the keeper excepted", () => {
    expect(goalAngle({ x: 30, y: 0 }, 1)).toBeCloseTo(2 * Math.atan(3.66 / 22.5), 12)
    expect(goalAngle({ x: 30, y: 5 }, 1)).toBeCloseTo(goalAngle({ x: -30, y: 5 }, -1), 12)
    expect(coneDefenders({ x: 36, y: 0 }, 1, [{ x: 51.5, y: 0 }, { x: 44, y: 0.5 }, { x: 44, y: 8 }])).toBe(1)
    const f = shotFeatures({ x: -41.5, y: 0 }, -1, true, [])
    expect(f[0]).toBeCloseTo(1.1, 12)
    expect([f[2], f[3]]).toEqual([1, 0])
  })

  it("load the committed models, whose fits beat the base rate on held-out matches", () => {
    const raw = committed()
    const m = modelsFromJson(raw)
    expect(m.xpass.coefficients).toHaveLength(4)
    expect(raw.xpass.held_out_log_loss).toBeLessThan(raw.xpass.base_rate_log_loss)
    expect(raw.xg.held_out_log_loss).toBeLessThan(raw.xg.base_rate_log_loss)
    // Harder passes are less likely to arrive; closer, more central shots more likely to score.
    const easy = predict(m.xpass, passFeatures({ x: 0, y: 0 }, { x: 0, y: 10 }, 1, []))
    const hard = predict(m.xpass, passFeatures({ x: 0, y: 0 }, { x: 35, y: 0 }, 1, [{ x: 1, y: 1 }, { x: 15, y: 0.5 }, { x: 25, y: -0.5 }]))
    expect(easy).toBeGreaterThan(0.85)
    expect(hard).toBeLessThan(0.35)
    const close = predict(m.xg, shotFeatures({ x: 46.5, y: 0 }, 1, false, []))
    const far = predict(m.xg, shotFeatures({ x: 27.5, y: 0 }, 1, false, []))
    expect(close).toBeGreaterThan(0.35)
    expect(far).toBeLessThan(0.06)
  })

  it("refuse a models file with a missing or misnamed coefficient", () => {
    const raw = committed()
    expect(() => modelsFromJson({ ...raw, xpass: { ...raw.xpass, coefficients: { ...raw.xpass.coefficients, pressure: "x" } } })).toThrow(ModelsError)
    expect(() => modelsFromJson({ ...raw, xg: { ...raw.xg, features: ["distance_10m"] } })).toThrow(/xg.features/)
    expect(() => modelsFromJson({ ...raw, xg: { ...raw.xg, penalty: 2 } })).toThrow(/penalty/)
  })

  // In CI the test must run: a missing uv fails it rather than skipping it.
  it.skipIf(!hasUv && !process.env.CI)("compute the same features as the Python fit for every pass and shot of a synthetic match", async () => {
    const league = JSON.parse(readFileSync(join(root, "data/league/league.json"), "utf8")) as League
    const cfg = { matchId: "parity", seed: 4243, kickoffTime: "2026-10-18T14:00:00.000Z", home: league.clubs[1]!, away: league.clubs[2]!, params: DEFAULT_PARAMS, dt: 0.1 }
    const dir = mkdtempSync(join(tmpdir(), "touchline-models-"))
    await Effect.runPromise(writeMatch(cfg, dir))
    const py = JSON.parse(
      execFileSync("uv", ["run", "--locked", "--project", join(root, "python/analytics"), "python", "-m", "touchline_analytics.stats_models", dir], { encoding: "utf8", maxBuffer: 1 << 26 })
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
    expect(py.length).toBeGreaterThan(500)
    for (const row of py) {
      const e = byId.get(row.id)!
      const f = frames.get(e.frame_id)!
      const home = e.team_id === cfg.home.id
      const opp = home ? f.away : f.home
      const ts =
        e.type === "pass"
          ? passFeatures({ x: e.x!, y: e.y! }, { x: e.x_end!, y: e.y_end! }, home ? 1 : -1, opp)
          : shotFeatures({ x: e.x!, y: e.y! }, home ? 1 : -1, e.attrs.body_part === "head", opp)
      ts.forEach((v, i) => expect(v, `${row.id}[${i}]`).toBeCloseTo(row.features[i]!, 9))
    }
  })
})

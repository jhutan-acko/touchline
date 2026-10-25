import { readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "vitest"
import type { Motion } from "../src/kinematics.js"
import { DEFAULT_PARAMS, paramsFromJson, type Params } from "../src/params.js"
import { calmMotion, initMatch, isFinished, step } from "../src/step.js"
import { makeConfig } from "../src/testing.js"
import type { Frame } from "../src/types.js"

// Calm repositioning (realism v2, P6 off-ball fix): movement.accelRule / accelShare.
const root = join(dirname(fileURLToPath(import.meta.url)), "../../..")
const calibrated = paramsFromJson(JSON.parse(readFileSync(join(root, "data/params/touchline-params.json"), "utf8")))
const prov = { dataset: "open data", licence: "CC-BY-4.0", attribution: "Some League; Someone et al.", fitted_at: "2026-10-04", version: "v1" }
const withMove = (p: Params, accelRule: number, accelShare: number): Params => ({ ...p, movement: { ...p.movement, accelRule, accelShare } })

const frames = (params: Params, seed: number): Frame[] => {
  let s = initMatch(makeConfig(seed, { params }))
  const out: Frame[] = []
  while (!isFinished(s)) {
    const r = step(s)
    s = r.state
    if (r.frame) out.push(r.frame)
  }
  return out
}

/**
 * The share (%) of off-ball 0.5 s windows that reverse: a player more than 5 m from the ball, running over 1.5 m/s in a
 * window and in the next one, the two headings more than 120 degrees apart (cos < -0.5); live ball at the window's start,
 * both windows inside one period. Real DFL matches: 0.01-0.03 %; rule 0 engine: about 0.4 %.
 */
const reversalShare = (fs: ReadonlyArray<Frame>): number => {
  const k = 5
  const at = fs.map((f) => new Map([...f.home, ...f.away].map((p) => [p.id, p] as const)))
  let moving = 0
  let reversed = 0
  for (let t = 0; t + 2 * k < fs.length; t++) {
    const f = fs[t]!
    if (!f.ball_in_play || fs[t + 2 * k]!.period !== f.period) continue
    for (const [id, p0] of at[t]!) {
      const p1 = at[t + k]!.get(id)
      const p2 = at[t + 2 * k]!.get(id)
      if (!p1 || !p2 || Math.hypot(p0.x - f.ball.x, p0.y - f.ball.y) <= 5) continue
      const a = { x: (p1.x - p0.x) / 0.5, y: (p1.y - p0.y) / 0.5 }
      const b = { x: (p2.x - p1.x) / 0.5, y: (p2.y - p1.y) / 0.5 }
      const sa = Math.hypot(a.x, a.y)
      const sb = Math.hypot(b.x, b.y)
      if (sa <= 1.5 || sb <= 1.5) continue
      moving++
      if ((a.x * b.x + a.y * b.y) / (sa * sb) < -0.5) reversed++
    }
  }
  return (100 * reversed) / moving
}

describe("calm repositioning (movement.accelRule)", () => {
  const m: Motion = { a0: 8, s0: 9, brake: 6, lateral: 4 }

  it("rule 0 keeps the full limits; rule 1 scales acceleration, braking and turning by accelShare, not top speed", () => {
    expect(calmMotion(m, withMove(DEFAULT_PARAMS, 0, 0.35).movement)).toBe(m)
    expect(calmMotion(m, withMove(DEFAULT_PARAMS, 1, 0.5).movement)).toEqual({ a0: 4, s0: 9, brake: 3, lateral: 2 })
  })

  it("ships off in DEFAULT_PARAMS and on in the calibrated file; the switch is 0 or 1 and the share in (0, 1]", () => {
    expect(DEFAULT_PARAMS.movement.accelRule).toBe(0)
    expect(calibrated.movement.accelRule).toBe(1)
    expect(calibrated.movement.accelShare).toBe(0.35)
    expect(() => paramsFromJson({ provenance: prov, movement: { accelRule: 0.5 } })).toThrow(/movement\.accelRule must be 0 or 1/)
    expect(() => paramsFromJson({ provenance: prov, movement: { accelShare: 1.2 } })).toThrow(/between 0 and 1/)
    expect(() => paramsFromJson({ provenance: prov, movement: { accelShare: 0 } })).toThrow(/movement\.accelShare must be positive/)
  })

  // Two full matches each (about 2 s apiece).
  it("rule 0 ignores accelShare (the old engine); rule 1 cuts off-ball reversals from about 0.4 % to near the real rate", () => {
    const off = frames(withMove(calibrated, 0, 0.35), 7)
    expect(frames(withMove(calibrated, 0, 0.9), 7)).toEqual(off)
    const before = reversalShare(off)
    const after = reversalShare(frames(withMove(calibrated, 1, 0.35), 7))
    expect(before).toBeGreaterThan(0.25)
    expect(after).toBeLessThan(0.12)
    expect(after).toBeLessThan(before / 3)
  }, 60_000)
})

import { execFileSync, spawnSync } from "node:child_process"
import { readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "vitest"
import type { DomainEvent } from "@touchline/sim-core"
import { NOT_ON_BALL_ACTION, ON_BALL_ACTION, passLengths } from "../src/metrics.js"

const ev = (type: string, frame: number, x: number | null, y: number | null, o: { xe?: number; ye?: number; fe?: number; outcome?: string; period?: string } = {}): DomainEvent =>
  ({
    id: `${type}-${frame}`, match_id: "m", type, frame_id: frame, period_frame_id: frame, period: o.period ?? "first_half", match_clock: "00:00", team_id: "t", player_id: "p",
    x, y, x_end: o.xe ?? null, y_end: o.ye ?? null, frame_id_end: o.fe ?? null, outcome: o.outcome ?? null, source: "sim", confidence: 1, attrs: {}
  }) as DomainEvent

const pass = (frame: number, x: number, y: number, xe: number, ye: number, fe: number, outcome = "successful", period = "first_half") => ev("pass", frame, x, y, { xe, ye, fe, outcome, period })

describe("pass length is measured to the receiver's next action", () => {
  it("runs to the start of his next pass, his carry included, whatever the stream order", () => {
    const events = [
      pass(0, 0, 0, 10, 0, 10),
      ev("reception", 10, 10, 0),
      ev("pressure", 11, 11, 0),
      pass(30, 16, 0, 40, 0, 40),
      ev("carry", 12, 10, 0, { xe: 16, ye: 0, fe: 30 }), // emitted at the carry's end, after the pass that follows it
      ev("reception", 40, 40, 0)
    ]
    expect(passLengths(events)).toEqual([16, 24])
  })

  it("leaves an incomplete pass out", () => {
    expect(passLengths([pass(0, 0, 0, 10, 0, 10, "intercepted"), ev("interception", 10, 10, 0)])).toEqual([])
  })

  it("ends at the opponent's event when the reception loses the ball before he acts", () => {
    const events = [pass(0, 0, 0, 10, 0, 10), ev("reception", 10, 10, 0), ev("tackle", 20, 12, 5, { outcome: "won" })]
    expect(passLengths(events)).toEqual([Math.hypot(12, 5)])
  })

  it("falls back to the reception point when nothing follows in the period", () => {
    const tail = [pass(0, 0, 0, 10, 0, 10), ev("reception", 10, 10, 0), ev("ball_out", 15, 50, 0), ev("period_end", 20, null, null)]
    expect(passLengths(tail)).toEqual([10])
    const nextPeriod = [pass(0, 0, 0, 10, 0, 10), ev("reception", 10, 10, 0), pass(100, 60, 0, 70, 0, 110, "successful", "second_half")]
    expect(passLengths(nextPeriod)[0]).toBe(10)
  })
})

describe("event type classification", () => {
  const root = join(dirname(fileURLToPath(import.meta.url)), "../../..")
  const src = readFileSync(join(root, "packages/sim-core/src/types.ts"), "utf8")
  const union = src.slice(src.indexOf("export type EventType ="))
  const types = [...union.slice(0, union.indexOf("\n\n")).matchAll(/\|\s*"([a-z_]+)"/g)].map((m) => m[1]!)

  it("puts every sim EventType in exactly one of the on-ball and skip lists", () => {
    expect(types.length).toBeGreaterThan(25)
    for (const t of types) expect(ON_BALL_ACTION.has(t) !== NOT_ON_BALL_ACTION.has(t), `${t} must be in exactly one list`).toBe(true)
    for (const t of [...ON_BALL_ACTION, ...NOT_ON_BALL_ACTION]) expect(types, `${t} is not a sim EventType`).toContain(t)
  })

  it.skipIf(spawnSync("uv", ["--version"]).status !== 0 && !process.env.CI)("equals the Python lists", () => {
    const code = "import json;from touchline_analytics.metrics import ON_BALL_ACTION as a, NOT_ON_BALL_ACTION as b;print(json.dumps([sorted(a),sorted(b)]))"
    const py = JSON.parse(execFileSync("uv", ["run", "--locked", "--project", join(root, "python/analytics"), "python", "-c", code], { encoding: "utf8" })) as string[][]
    expect(py[0]).toEqual([...ON_BALL_ACTION].sort())
    expect(py[1]).toEqual([...NOT_ON_BALL_ACTION].sort())
  })
})

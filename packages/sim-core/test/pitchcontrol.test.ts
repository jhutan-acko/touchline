import { describe, expect, it } from "vitest"
import { pitchControlAt, pitchControlGrid, type PcPlayer } from "../src/pitchcontrol.js"

/**
 * Reference values from LaurieOnTracking's calculate_pitch_control_at_target (MIT) with its default parameters,
 * computed once with `uv run --with numpy` on these scenarios.
 */
const CASES: ReadonlyArray<{ name: string; att: PcPlayer[]; def: PcPlayer[]; ball: { x: number; y: number } | null; target: { x: number; y: number }; expected: [number, number] }> = [
  {
    name: "contested ball between a still attacker and a still defender",
    att: [{ x: 10, y: 0, vx: 0, vy: 0, gk: false }],
    def: [{ x: 20, y: 5, vx: 0, vy: 0, gk: false }],
    ball: { x: 0, y: 0 },
    target: { x: 15, y: 0 },
    expected: [0.7528798450015429, 0.2394632351223214]
  },
  {
    name: "an attacker running onto the ball",
    att: [{ x: 10, y: 0, vx: 4, vy: 0, gk: false }, { x: 0, y: 10, vx: 0, vy: 0, gk: false }],
    def: [{ x: 18, y: 3, vx: -1, vy: 0, gk: false }, { x: 25, y: -6, vx: 0, vy: 0, gk: false }],
    ball: { x: 0, y: 0 },
    target: { x: 18, y: 0 },
    expected: [0.26917548662125446, 0.7213442924400689]
  },
  {
    name: "a ball near the defending keeper",
    att: [{ x: 40, y: 5, vx: 3, vy: 0, gk: false }],
    def: [{ x: 51, y: 0, vx: 0, vy: 0, gk: true }, { x: 42, y: -8, vx: 0, vy: 0, gk: false }],
    ball: { x: 30, y: 10 },
    target: { x: 48, y: 2 },
    expected: [0.05226384284978913, 0.9408226769948753]
  },
  {
    name: "a target only the attackers can reach",
    att: [{ x: 5, y: 0, vx: 0, vy: 0, gk: false }],
    def: [{ x: 40, y: 30, vx: 0, vy: 0, gk: false }],
    ball: { x: 0, y: 0 },
    target: { x: 6, y: 1 },
    expected: [1.0, 0.0]
  },
  {
    name: "a target only the defenders can reach",
    att: [{ x: -40, y: -30, vx: 0, vy: 0, gk: false }],
    def: [{ x: 5, y: 0, vx: 0, vy: 0, gk: false }],
    ball: { x: 0, y: 0 },
    target: { x: 6, y: 1 },
    expected: [0.0, 1.0]
  },
  {
    name: "the ball already at the target",
    att: [{ x: 2, y: 0, vx: 0, vy: 2, gk: false }],
    def: [{ x: -1, y: 1, vx: 1, vy: 0, gk: false }, { x: 3, y: 3, vx: 0, vy: 0, gk: false }],
    ball: null,
    target: { x: 1, y: 1 },
    expected: [0.4500938762134725, 0.5427533565212024]
  }
]

describe("pitch control", () => {
  for (const c of CASES)
    it(`matches the reference: ${c.name}`, () => {
      const pc = pitchControlAt(c.target, c.att, c.def, c.ball)
      expect(pc.att).toBeCloseTo(c.expected[0], 9)
      expect(pc.def).toBeCloseTo(c.expected[1], 9)
    })

  it("gives the whole ball to the only team on the pitch", () => {
    expect(pitchControlAt({ x: 0, y: 0 }, [{ x: 1, y: 1, vx: 0, vy: 0, gk: false }], [], null)).toEqual({ att: 1, def: 0 })
    expect(pitchControlAt({ x: 0, y: 0 }, [], [{ x: 1, y: 1, vx: 0, vy: 0, gk: false }], null)).toEqual({ att: 0, def: 1 })
  })

  it("maps a grid: each team controls the area around it", () => {
    const g = pitchControlGrid([{ x: -30, y: 0, vx: 0, vy: 0, gk: false }], [{ x: 30, y: 0, vx: 0, vy: 0, gk: false }], null, 21, 14)
    expect(g.att).toHaveLength(21 * 14)
    const at = (x: number, y: number) => g.att[Math.floor(((y + 34) / 68) * 14) * 21 + Math.floor(((x + 52.5) / 105) * 21)]!
    expect(at(-30, 0)).toBeGreaterThan(0.95)
    expect(at(30, 0)).toBeLessThan(0.05)
    expect(at(0, 0)).toBeGreaterThan(0.3)
    expect(at(0, 0)).toBeLessThan(0.7)
  })
})

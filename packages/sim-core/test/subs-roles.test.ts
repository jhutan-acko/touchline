import { describe, expect, it } from "vitest"
import { DEFAULT_PARAMS as P, type Params } from "../src/params.js"
import { initMatch, isFinished, step } from "../src/step.js"
import { makeConfig } from "../src/testing.js"

const REAL_WEIGHTS = { CB: 0.15, FB: 0.4, DM: 0.7, CM: 0.7, AM: 0.9, W: 1, ST: 0.9 }

const offShare = (params: Params) => {
  const counts: Record<string, number> = {}
  for (const seed of [1, 2, 3, 4, 5, 6]) {
    const cfg = makeConfig(seed, { params })
    const roles = new Map([cfg.home, cfg.away].flatMap((t) => [...t.starters, ...(t.bench ?? [])]).map((p) => [p.id, p.role]))
    let s = initMatch(cfg)
    while (!isFinished(s)) {
      const r = step(s)
      s = r.state
      for (const e of r.events) if (e.type === "substitution") {
        const role = roles.get(String(e.attrs.player_off))!
        counts[role] = (counts[role] ?? 0) + 1
      }
    }
  }
  const n = Object.values(counts).reduce((a, b) => a + b, 0)
  return (rs: ReadonlyArray<string>) => rs.reduce((a, r) => a + (counts[r] ?? 0), 0) / n
}

describe("substitutions by role (F2)", () => {
  it("takes wingers and strikers off before centre backs when weighted by role", () => {
    const flat = offShare({ ...P, substitutions: { ...P.substitutions, roleWeights: { CB: 1, FB: 1, DM: 1, CM: 1, AM: 1, W: 1, ST: 1 } } })
    const real = offShare({ ...P, substitutions: { ...P.substitutions, roleWeights: REAL_WEIGHTS } })
    expect(P.substitutions.roleWeights).toEqual(REAL_WEIGHTS)
    expect(real(["CB"])).toBeLessThan(flat(["CB"]))
    expect(real(["CB"])).toBeLessThan(0.1)
    expect(real(["W", "ST"])).toBeGreaterThan(flat(["W", "ST"]))
  }, 600_000)
})

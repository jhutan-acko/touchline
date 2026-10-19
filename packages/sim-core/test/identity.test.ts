import { describe, expect, it } from "vitest"
import { DEFAULT_PARAMS as P, type Params } from "../src/params.js"
import { initMatch, step } from "../src/step.js"
import type { MatchState } from "../src/types.js"
import { makeConfig } from "../src/testing.js"

// Deferred P3 case (plan 8e ruling 24): with a P3 rule at 0 the rule's other fields are never read, so perturbing them gives the
// same engine bit for bit. Every other P3 rule stays at its default; only the rule under test is switched off and perturbed.
type Block = "firstTick" | "choice" | "release" | "cross" | "through" | "distribution"

/** A block with its rule at 0 and every other numeric field (and numeric array entry) moved, within what validation accepts. */
const perturb = (b: object): object => {
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(b)) {
    if (k === "rule") out[k] = 0
    else if (typeof v === "number") out[k] = v === 0 ? 0.3 : v * 1.07
    else if (Array.isArray(v)) out[k] = v.map((x) => (typeof x === "number" ? (x === 0 ? 0.3 : x * 1.07) : x))
    else out[k] = v
  }
  return out
}

const withBlock = (block: Block, perturbed: boolean): Params => {
  const cur = P[block] as object
  const off = { ...cur, rule: 0 }
  return { ...P, [block]: perturbed ? perturb(cur) : off } as Params
}

/** Everything the engine produced: each tick's events and frame, and the final state without its config (which holds the params). */
const run = (p: Params, ticks: number): string => {
  let s: MatchState = initMatch(makeConfig(3, { params: p }))
  const out: unknown[] = []
  for (let i = 0; i < ticks; i++) {
    const r = step(s)
    s = r.state
    out.push(r.events, r.frame)
  }
  const { config: _config, ...rest } = s as MatchState & { config: unknown }
  out.push(rest)
  return JSON.stringify(out)
}

describe("P3 rules at 0 are the pre-P3 engine", () => {
  for (const block of ["firstTick", "choice", "release", "cross", "through", "distribution"] as const) {
    it(`every P3 rule at 0 gives the pre-P3 engine bit for bit at unit level: ${block}`, () => {
      const plain = withBlock(block, false)
      const moved = withBlock(block, true)
      // The precondition: the perturbation changed fields, or the comparison proves nothing.
      expect(JSON.stringify(moved[block])).not.toBe(JSON.stringify(plain[block]))
      expect((moved[block] as { rule: number }).rule).toBe(0)
      expect(run(moved, 300)).toBe(run(plain, 300))
    }, 60_000)
  }
})

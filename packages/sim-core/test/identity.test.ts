import { describe, expect, it } from "vitest"
import { DEFAULT_PARAMS as P, paramsFromJson, type Params } from "../src/params.js"
import { initMatch, step } from "../src/step.js"
import type { MatchState } from "../src/types.js"
import { makeConfig } from "../src/testing.js"

// Deferred P3 case (plan 8e ruling 24): with a P3 rule at 0 the rule's other fields are never read, so perturbing them gives the
// same engine bit for bit. Every other rule stays at its default; only the block under test is switched and perturbed.
type Block = "firstTick" | "choice" | "release" | "cross" | "through" | "distribution"

/** Ticks per run. Short runs have no cross or keeper distribution (300 ticks of seed 3: neither), so the sensitivity check below needs this many. */
const TICKS = 1500

/** A switch (rule, scopeRule, rejudge, ...): its value is 0 or 1 and is never perturbed. */
const isSwitch = (k: string): boolean => /(^|[a-z])Rule$/.test(k) || k === "rule" || k === "rejudge"

/** The value with every numeric field (nested objects and arrays included) moved, switches kept. */
const perturb = (v: unknown, key = ""): unknown => {
  if (typeof v === "number") return isSwitch(key) ? v : v === 0 ? 0.3 : v * 1.07
  if (Array.isArray(v)) return v.map((x) => perturb(x, key))
  if (v !== null && typeof v === "object") return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, perturb(x, k)]))
  return v
}

/** Params with the block at the given rule, perturbed or not. Built through paramsFromJson, so they are valid by the real validation. */
const withBlock = (block: Block, rule: 0 | 1, perturbed: boolean): Params => {
  const cur = P[block] as object
  const b = { ...(perturbed ? (perturb(cur) as object) : cur), rule }
  return paramsFromJson({ ...P, [block]: b })
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
  it("perturbed fixtures keep their switches and pass the real validation", () => {
    const moved = withBlock("choice", 0, true)
    expect(moved.release.freeRule).toBe(P.release.freeRule)
    expect(moved.firstTick.scopeRule).toBe(P.firstTick.scopeRule)
    expect(withBlock("release", 0, true).release.rejudge).toBe(P.release.rejudge)
  })
  for (const block of ["firstTick", "choice", "release", "cross", "through", "distribution"] as const) {
    it(`every P3 rule at 0 gives the pre-P3 engine bit for bit at unit level: ${block}`, () => {
      // The precondition: the run notices the perturbation when the rule is 1, so a rule-0 match proves the fields are not read.
      expect(JSON.stringify(withBlock(block, 1, true)[block])).not.toBe(JSON.stringify(withBlock(block, 1, false)[block]))
      expect(run(withBlock(block, 1, true), TICKS), `${block} perturbation is invisible at rule 1`).not.toBe(run(withBlock(block, 1, false), TICKS))
      expect(withBlock(block, 0, true)[block].rule).toBe(0)
      expect(run(withBlock(block, 0, true), TICKS)).toBe(run(withBlock(block, 0, false), TICKS))
    }, 240_000)
  }
})

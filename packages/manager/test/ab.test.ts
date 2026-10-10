import { spawnSync } from "node:child_process"
import { mkdtempSync, readFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { Effect } from "effect"
import type { DomainEvent } from "@touchline/sim-core"
import { describe, expect, it } from "vitest"
import { fixtures, playArm, resultOf, type MatchResult } from "../src/ab/match.js"
import { headline, markdown, summarize, type AbSummary } from "../src/ab/report.js"
import { rulesManager } from "../src/rules.js"
import { runManaged } from "../src/run.js"
import { loadSetup } from "../src/ab/setup.js"
import { root } from "./helpers.js"

const setup = loadSetup()

describe("A/B fixtures", () => {
  const list = fixtures(5000, 16, setup.clubs)
  const managed = list.map((f) => (f.managedSide === "home" ? f.home : f.away))
  it("give every club the manager equally often, at home and away in turn, against a different club", () => {
    for (const c of setup.clubs) expect(managed.filter((m) => m === c)).toHaveLength(2)
    expect(list.map((f) => f.managedSide)).toEqual(list.map((_, i) => (i % 2 === 0 ? "home" : "away")))
    expect(list.every((f) => f.home !== f.away)).toBe(true)
    expect(list.map((f) => f.seed)).toEqual(Array.from({ length: 16 }, (_, i) => 5000 + i))
  })
  it("vary the opponent from one cycle of clubs to the next", () => {
    const opp = (i: number) => (list[i]!.managedSide === "home" ? list[i]!.away : list[i]!.home)
    expect(opp(0)).not.toBe(opp(8))
  })
})

describe("an A/B match", () => {
  it("scores the managed team: xG and goal difference, and points", () => {
    const ev = (type: string, team: string, xg?: number) => ({ type, team_id: team, attrs: xg === undefined ? {} : { xg } }) as unknown as DomainEvent
    const events = [ev("shot", "a", 0.4), ev("shot", "b", 0.1), ev("goal", "a"), ev("shot", "a", 0.2)]
    const a = resultOf(events, "a")
    expect({ ...a, xg_diff: Math.round(a.xg_diff * 1e9) / 1e9 }).toEqual({ score: { for: 1, against: 0 }, xg_diff: 0.5, goal_diff: 1, points: 3 })
    expect(resultOf(events, "b").points).toBe(0)
  })
  it("is the same match in every arm until the managed team's first decision", () => {
    const f = fixtures(5000, 1, setup.clubs)[0]!
    const cfg = setup.config(f)
    const none = Effect.runSync(runManaged(cfg, {}, setup.stats))
    const rules = Effect.runSync(runManaged(cfg, { [f.managedSide]: rulesManager }, setup.stats))
    const first = rules.decisions[0]!.tick
    const before = (es: ReadonlyArray<DomainEvent>) => es.filter((e) => e.frame_id <= first)
    expect(before(rules.events).length).toBeGreaterThan(100)
    expect(before(rules.events)).toEqual(before(none.events))
    const played = Effect.runSync(playArm(cfg, f, "rules", () => { throw new Error("no agent") }, setup.stats))
    expect(played.decisions).toEqual(rules.decisions)
  })
})

const row = (seed: number, arm: MatchResult["arm"], xg: number, goals: number): MatchResult => ({
  seed, arm, home: "a", away: "b", managed_side: "home", managed_team: "a", opponent: "b", score: { for: Math.max(0, goals), against: Math.max(0, -goals) },
  xg_diff: xg, goal_diff: goals, points: goals > 0 ? 3 : goals === 0 ? 1 : 0, decisions: []
})
const meta = { generated: "2026-10-10", first_seed: 5000, seeds: 30, arms: ["none", "rules", "agent"] as const, model: "stub", whatif: { seeds: 20, horizon_s: 600 } }

describe("the A/B report", () => {
  const seeds = Array.from({ length: 30 }, (_, i) => 5000 + i)
  const make = (agentGain: number) =>
    summarize(seeds.flatMap((s, i) => [row(s, "none", 0, 0), row(s, "rules", 0.05 * ((i % 3) - 1), 0), row(s, "agent", agentGain + 0.05 * ((i % 3) - 1), i % 4 === 0 ? 1 : 0)]), { ...meta, arms: [...meta.arms] })
  it("says the agent does better only when the interval is above zero, and says so plainly when it is not", () => {
    expect(headline(make(0.2))).toMatch(/^The agent manager does better than the rule-based manager: 0\.200 xG difference per match/)
    expect(headline(make(0))).toMatch(/shows no detectable difference from the rule-based manager/)
    expect(headline(make(-0.2))).toMatch(/does worse than/)
  })
  it("compares every pair of arms on xG difference, goal difference and points", () => {
    const s: AbSummary = make(0.2)
    expect(s.comparisons.map((c) => `${c.a}-${c.b}`)).toEqual(["agent-none", "agent-rules", "rules-none"])
    expect(s.comparisons[0]!.xg_diff.n).toBe(30)
    expect(s.arms.agent!.win_rate.mean).toBeCloseTo(8 / 30, 10)
    const md = markdown(s)
    for (const h of ["# Manager agents: A/B evaluation", "## Paired differences", "## Per arm", "| agent manager − rule-based manager |"]) expect(md).toContain(h)
  })
})

describe("pnpm managers:ab (the CI suite: 4 seeds on the stub model)", () => {
  it("plays every arm, reports, and keeps every decision", () => {
    const dir = mkdtempSync(join(tmpdir(), "ab-"))
    const r = spawnSync("pnpm", ["-s", "managers:ab", "--seeds", "4", "--llm", "stub", "--whatif-seeds", "2", "--whatif-horizon", "60", "--out", dir, "--runs", join(dir, "runs")], { cwd: root, encoding: "utf8" })
    expect(r.status, r.stderr).toBe(0)
    const json = JSON.parse(readFileSync(join(dir, "manager-ab.json"), "utf8")) as AbSummary & { results: unknown[] }
    expect(json.results).toHaveLength(12)
    expect(Object.keys(json.arms)).toEqual(["none", "rules", "agent"])
    const agent = json.arms.agent as unknown as { decisions: { decisions: number; fallback_rate: Record<string, number> } }
    expect(agent.decisions.decisions).toBeGreaterThan(0)
    expect(agent.decisions.fallback_rate).toEqual({ propose: 0, choose: 0, service: 0 })
    expect(json.meta.model).toBe("stub")
    const md = readFileSync(join(dir, "manager-ab.md"), "utf8")
    expect(md).toContain("## The agent manager's decisions")
    expect(md).toContain("not known (no price configured")
    const decisions = readFileSync(join(dir, "runs/decisions.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l) as { arm: string })
    expect(decisions.length).toBe(agent.decisions.decisions + (json.arms.rules as unknown as { decisions: { decisions: number } }).decisions.decisions)
  }, 600_000)
})

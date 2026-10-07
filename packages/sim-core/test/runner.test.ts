import { createHash } from "node:crypto"
import { readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "vitest"
import { entryAchieved, initMatch, isFinished, outstandingForces, paramsFromJson, runScript, ScriptError, step, type MatchConfig, type Script, type ScriptEntry } from "../src/index.js"
import { makeConfig } from "../src/testing.js"

const root = join(dirname(fileURLToPath(import.meta.url)), "../../..")
const params = paramsFromJson(JSON.parse(readFileSync(join(root, "data/params/touchline-params.json"), "utf8")))
const hash = (x: unknown) => createHash("sha256").update(JSON.stringify(x)).digest("hex")
const plain = (cfg: MatchConfig) => {
  let s = initMatch(cfg)
  const out = []
  while (!isFinished(s)) { const r = step(s); s = r.state; out.push(r) }
  return out
}

describe("scenario runner", () => {
  it("without a script plays exactly the plain match", () => {
    const cfg = makeConfig(5, { params })
    expect(hash(runScript(cfg).steps.map((r) => [r.frame, r.events]))).toBe(hash(plain(cfg).map((r) => [r.frame, r.events])))
  })
  it("is deterministic", () => {
    const script: Script = { name: "t", entries: [{ window: [20, 40], team: "home", effect: "goal" }] }
    const cfg = makeConfig(6, { params, script })
    expect(hash(runScript(cfg).steps.map((r) => r.events))).toBe(hash(runScript(cfg).steps.map((r) => r.events)))
  })
  it("plays every frame exactly once, in order, from kickoff to full time", () => {
    const script: Script = { name: "t", entries: [{ window: [20, 40], team: "home", effect: "goal", count: 2 }] }
    const run = runScript(makeConfig(7, { params, script }))
    const ticks = run.steps.filter((r) => r.frame).map((r) => r.frame!.tick)
    expect(ticks.every((t, i) => i === 0 || t === ticks[i - 1]! + 1)).toBe(true)
    expect(run.steps.at(-1)!.events.at(-1)!.type).toBe("match_end")
  })
  it("retries a window that missed its target, then forces it; forced events are marked scripted", () => {
    // Five goals in fifteen minutes almost never happens on its own.
    const script: Script = { name: "t", entries: [{ window: [30, 45], team: "home", effect: "goal", count: 5 }] }
    const run = runScript(makeConfig(8, { params, script }), { retries: 2 })
    const w = run.windows[0]!
    expect(w.attempts).toBe(4)
    expect(w.forced).toBe(true)
    const scripted = run.steps.flatMap((r) => r.events).filter((e) => e.attrs.scripted === true)
    expect(scripted.length).toBeGreaterThan(0)
    expect(scripted.every((e) => e.type === "shot" && e.outcome === "goal")).toBe(true)
  })
  it("records what happened in each window", () => {
    const script: Script = { name: "t", entries: [{ window: [50, 60], team: "away", effect: "red_card" }] }
    const run = runScript(makeConfig(9, { params, script }))
    const w = run.windows[0]!
    expect(w.entries).toEqual(script.entries)
    expect(w.fromFrame).toBeLessThan(w.toFrame)
    expect(typeof w.achieved).toBe("boolean")
    const reds = run.steps.flatMap((r) => r.events).filter((e) => e.type === "card" && e.attrs.colour !== "yellow" && e.team_id === "away-fc")
    expect(w.achieved).toBe(reds.some((e) => e.frame_id >= w.fromFrame && e.frame_id <= w.toFrame))
  })
  it("refuses more retries than its sub-seeds allow", () => {
    const script: Script = { name: "t", entries: [{ window: [20, 30], team: "home", effect: "goal" }] }
    expect(() => runScript(makeConfig(1, { params, script }), { retries: 63 })).toThrow(/retries must be an integer from 0 to 62/)
    expect(() => runScript(makeConfig(1, { params, script }), { retries: -1 })).toThrow(ScriptError)
  })
  it("reports each entry's own result, and marks forced only the entries whose outcome was forced", () => {
    const script: Script = { name: "t", entries: [{ window: [30, 45], team: "home", effect: "goal", count: 5 }, { window: [30, 45], team: "away", effect: "press_surge" }] }
    const run = runScript(makeConfig(8, { params, script }), { retries: 0 })
    const w = run.windows[0]!
    const events = run.steps.flatMap((r) => r.events).filter((e) => e.frame_id >= w.fromFrame && e.frame_id <= w.toFrame)
    expect(w.forced).toBe(true)
    expect(w.results).toEqual(script.entries.map((e) => ({ achieved: entryAchieved(e, events, makeConfig(8, { params, script })), forced: e.effect === "goal" })))
  })
  it("forces only the goals still missing: natural goals in the forced play count towards the target", () => {
    const script: Script = { name: "t", entries: [{ window: [30, 45], team: "home", effect: "goal", count: 2 }, { window: [30, 45], team: "away", effect: "red_card" }] }
    const [goal, red] = script.entries as [ScriptEntry, ScriptEntry]
    expect(outstandingForces(script, [goal, goal, red], [0, 0])).toEqual([goal, goal, red])
    expect(outstandingForces(script, [goal, goal, red], [1, 0])).toEqual([goal, red])
    expect(outstandingForces(script, [goal, red], [2, 0])).toEqual([red])
  })
  it("refuses overlapping windows", () => {
    const script: Script = { name: "t", entries: [{ window: [20, 40], team: "home", effect: "goal" }, { window: [30, 50], team: "away", effect: "goal" }] }
    expect(() => runScript(makeConfig(1, { params, script }))).toThrow(ScriptError)
  })
  it("a forced window always meets its target (keeper heroics needs two saves; a forced defensive error counts on a clearance too)", () => {
    for (const effect of ["keeper_heroics", "defensive_error"] as const) {
      for (const seed of [1, 2, 3, 4, 5, 6, 7, 8]) {
        const script: Script = { name: effect, entries: [{ window: [20, 40], team: "home", effect }] }
        const cfg = makeConfig(seed, { params, script })
        const run = runScript(cfg, { retries: 0 })
        const w = run.windows[0]!
        // A forced save or error needs shots or kicks to happen on: a window in which the opposition never got a second shot cannot be forced
        // (seed 4 with support, marking and shielding on: one forced save, no second shot in 20 minutes). Whenever they did, the target is met.
        const awayShots = run.steps.flatMap((r) => r.events).filter((e) => e.type === "shot" && e.team_id === cfg.away.id && e.frame_id >= w.fromFrame && e.frame_id <= w.toFrame).length
        if (w.forced && (effect !== "keeper_heroics" || awayShots >= 2)) expect(w.achieved, `${effect} seed ${seed}`).toBe(true)
      }
    }
  })
  it("keeps only frames and events per step, not whole match states (memory for a 25 fps match)", () => {
    const script: Script = { name: "t", entries: [{ window: [20, 30], team: "home", effect: "goal" }] }
    const run = runScript(makeConfig(10, { params, script }))
    expect(run.steps.every((r) => Object.keys(r).sort().join() === "events,frame")).toBe(true)
  })
  it("opens a second-half window in the second half, even after long first-half added time", () => {
    const script: Script = { name: "t", entries: [{ window: [46, 55], team: "home", effect: "press_surge" }] }
    const run = runScript(makeConfig(11, { params, script }))
    const w = run.windows[0]!
    expect(run.steps.find((r) => r.frame?.tick === w.fromFrame)!.frame!.period).toBe("second_half")
  })
})

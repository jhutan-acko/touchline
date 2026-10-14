import { spawnSync } from "node:child_process"
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { Effect, Stream } from "effect"
import { beforeAll, describe, expect, it } from "vitest"
import type { MetricId, Signal } from "@touchline/schema"
import type { League } from "@touchline/league"
import { matchSteps, SCENARIOS, writeMatch } from "@touchline/sim"
import { DEFAULT_PARAMS, type MatchConfig } from "@touchline/sim-core"
import { METRICS } from "../src/catalog.js"
import { StatsEngine } from "../src/engine.js"
import { emittedAt, infoFromConfig, type StatsInput } from "../src/input.js"
import { readRun, ReplayError } from "../src/replay.js"
import { signalStream, stepInputs } from "../src/stream.js"
import { models, root, xtGrid } from "./helpers.js"

const M = models()
const XT = xtGrid()
const league = JSON.parse(readFileSync(join(root, "data/league/league.json"), "utf8")) as League
const club = (id: string) => league.clubs.find((c) => c.id === id)!
const collect = <A, E>(s: Stream.Stream<A, E>) => Effect.runPromise(Stream.runCollect(s)).then((c) => Array.from(c))

/** Every metric for every subject it is defined for, at a tick. */
const snapshot = (eng: StatsEngine, at: number) => {
  const subjects = { match: ["match"], team: [eng.info.home.id, eng.info.away.id], player: [...eng.info.home.players, ...eng.info.away.players].map((p) => p.id) }
  const out: Record<string, number | null> = {}
  for (const m of METRICS) for (const kind of m.subjects) for (const s of subjects[kind]) out[`${m.id}|${s}`] = eng.value(m.id as MetricId, s, { at })
  return out
}

const byTick = (a: Signal, b: Signal) => a.frame_id - b.frame_id || a.id.localeCompare(b.id)

describe("replay and streams", () => {
  // A scripted match (its last window runs to full time, so carries and flights are cut short by the whistle).
  const sc = SCENARIOS.late_comeback!
  const cfg: MatchConfig = { matchId: "golden", seed: 4245, kickoffTime: "2026-10-18T14:00:00.000Z", home: club(sc.home), away: club(sc.away), params: DEFAULT_PARAMS, dt: 0.1, script: sc.script }
  const dir = mkdtempSync(join(tmpdir(), "touchline-stats-"))
  let live: StatsEngine
  let liveSignals: Signal[]
  let replay: StatsEngine
  let replaySignals: Signal[]
  let inputs: StatsInput[]

  beforeAll(async () => {
    await Effect.runPromise(writeMatch(cfg, dir))
    live = new StatsEngine(infoFromConfig(cfg), M, XT)
    liveSignals = await collect(signalStream(live, stepInputs(matchSteps(cfg))))
    const run = await Effect.runPromise(readRun(dir, league))
    replay = new StatsEngine(run.info, M, XT)
    inputs = await collect(run.inputs)
    replaySignals = await collect(signalStream(replay, Stream.fromIterable(inputs)))
  }, 120_000)

  it("give the same signals and metrics live and from the run folder", () => {
    expect(liveSignals.length).toBeGreaterThan(20)
    // Even an eleven-goal scripted match raises a manageable number of signals, none of one kind in bulk.
    expect(liveSignals.length).toBeLessThan(150)
    for (const type of new Set(liveSignals.map((s) => s.type))) expect(liveSignals.filter((s) => s.type === type).length, type).toBeLessThanOrEqual(40)
    expect([...replaySignals].sort(byTick)).toEqual([...liveSignals].sort(byTick))
    expect(replay.score).toEqual(live.score)
    for (const at of [1_000, 20_000, live.now]) expect(snapshot(replay, at)).toEqual(snapshot(live, at))
  })

  it("answer a query about tick t the same before and after seeing what came later", () => {
    for (const t of [12_345, 40_000]) {
      const partial = new StatsEngine(replay.info, M, XT)
      for (const i of inputs) if ((i.kind === "frame" ? i.frame.tick : emittedAt(i.event)) <= t) partial.ingest(i)
      partial.finish()
      expect(snapshot(partial, t)).toEqual(snapshot(replay, t))
      expect([...partial.signals].sort(byTick)).toEqual(replay.signals.filter((s) => s.frame_id <= t).sort(byTick))
    }
  })

  it("raise a costly_error for exactly the manifest's errors leading to a shot or goal", () => {
    const truth = (JSON.parse(readFileSync(join(dir, "manifest.json"), "utf8")) as { truths: { critical_errors: Array<{ mistake_id: string; shot_id: string }> } }).truths.critical_errors
    const raised = liveSignals.filter((s) => s.type === "costly_error").map((s) => s.evidence.join(" ")).sort()
    expect(raised.length).toBeGreaterThan(0)
    expect(raised).toEqual(truth.map((c) => `${c.mistake_id} ${c.shot_id}`).sort())
  })

  it("match the committed golden summary (UPDATE_STATS_GOLDEN=1 rewrites it after an intended change)", () => {
    const r = (v: number | null) => (v === null ? null : Math.round(v * 1e6) / 1e6)
    const summary = {
      score: live.score,
      metrics: Object.fromEntries(Object.entries(snapshot(live, live.now)).filter(([k]) => !k.includes("|p-")).map(([k, v]) => [k, r(v)])),
      signals: [...liveSignals].sort(byTick).map((s) => [s.id, r(s.value)])
    }
    const path = join(root, "packages/stats/test/golden/late-comeback-4245.json")
    if (process.env.UPDATE_STATS_GOLDEN === "1") writeFileSync(path, JSON.stringify(summary, null, 1) + "\n")
    expect(summary).toEqual(JSON.parse(readFileSync(path, "utf8")))
  })

  it("name players from the league file, and fall back to ids without it", async () => {
    expect(replay.info.home.players[0]).toMatchObject({ name: (club(sc.home).starters[0] as { name?: string }).name, role: "GK" })
    const bare = await Effect.runPromise(readRun(dir))
    expect(bare.info.home.players[0]).toMatchObject({ name: bare.info.home.players[0]!.id, role: null })
  })

  it("print a summary from the command line, and refuse a missing --run with status 2", () => {
    const cli = (args: string[]) => spawnSync("npx", ["tsx", "src/cli.ts", ...args], { cwd: join(root, "packages/stats"), encoding: "utf8" })
    const ok = cli(["--run", dir])
    expect(ok.status).toBe(0)
    expect(ok.stdout).toContain(`${cfg.home.name} ${live.score.home}-${live.score.away} ${cfg.away.name}`)
    expect(ok.stdout).toMatch(/Signals: \d+ \(/)
    const bad = cli([])
    expect(bad.status).toBe(2)
    expect(bad.stderr).toContain("--run is required")
  })

  it("report a missing or malformed run folder as a ReplayError naming the file", async () => {
    const missing = await Effect.runPromise(Effect.flip(readRun(join(dir, "nope"))))
    expect(missing).toBeInstanceOf(ReplayError)
    expect(missing.message).toMatch(/meta\.json/)
    const bad = mkdtempSync(join(tmpdir(), "touchline-bad-"))
    writeFileSync(join(bad, "meta.json"), readFileSync(join(dir, "meta.json")))
    writeFileSync(join(bad, "domain.jsonl"), readFileSync(join(dir, "domain.jsonl"), "utf8").split("\n").slice(0, 3).join("\n") + '\n{"type":"dance"}\n')
    const err = await Effect.runPromise(Effect.flip(readRun(bad)))
    expect(err.message).toMatch(/domain\.jsonl:4/)
  })

  it("refuse a run folder written before teams switched ends at half-time, asking for it to be regenerated", async () => {
    const old = mkdtempSync(join(tmpdir(), "touchline-old-"))
    const meta = JSON.parse(readFileSync(join(dir, "meta.json"), "utf8"))
    expect(meta.match.periods.find((p: { period: string }) => p.period === "second_half").play_direction).toBe("right_left")
    // Pre-P1 meta: every period, the second half included, played left to right.
    meta.match.periods = meta.match.periods.map((p: object) => ({ ...p, play_direction: "left_right" }))
    writeFileSync(join(old, "meta.json"), JSON.stringify(meta))
    writeFileSync(join(old, "domain.jsonl"), readFileSync(join(dir, "domain.jsonl")))
    writeFileSync(join(old, "tracking.jsonl"), "")
    const err = await Effect.runPromise(Effect.flip(readRun(old)))
    expect(err).toBeInstanceOf(ReplayError)
    expect(err.message).toMatch(/meta\.json/)
    expect(err.message).toMatch(/predates the half-time switch/)
    expect(err.message).toMatch(/regenerate/)
  })
})

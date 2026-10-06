import { existsSync, readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { Effect, Stream } from "effect"
import { modelsFromJson, readRun, signalStream, StatsEngine, xtGridFromJson, type ReplayError, type Roster } from "@touchline/stats"
import type { MatchPlan } from "./gateway.js"

export const root = join(dirname(fileURLToPath(import.meta.url)), "../../..")

/** Replay a run folder through the stats engine: its signals in the order they were raised, and the two whistles. */
export const replaySignals = (dir: string): Effect.Effect<Omit<MatchPlan, "mcpUrl">, ReplayError> =>
  Effect.gen(function* () {
    const params = (f: string) => JSON.parse(readFileSync(join(root, "data/params", f), "utf8"))
    const leaguePath = join(root, "data/league/league.json")
    const roster = existsSync(leaguePath) ? (JSON.parse(readFileSync(leaguePath, "utf8")) as Roster) : undefined
    const run = yield* readRun(dir, roster)
    const engine = new StatsEngine(run.info, modelsFromJson(params("stats-models.json")), xtGridFromJson(params("xt-grid.json")))
    const signals = yield* Stream.runCollect(signalStream(engine, run.inputs))
    const ends = engine.events.filter((e) => e.type === "period_end").map((e) => e.frame_id)
    const last = engine.eventTicks[engine.eventTicks.length - 1] ?? 0
    return {
      matchId: run.info.matchId,
      fps: Math.round(1 / run.info.dt),
      signals: [...signals],
      whistles: { half_time: ends[0] ?? last, full_time: ends[1] ?? last }
    }
  })

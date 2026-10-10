import { createHash } from "node:crypto"
import { closeSync, mkdirSync, openSync, readFileSync, writeFileSync, writeSync } from "node:fs"
import { join } from "node:path"
import { Effect, Stream } from "effect"
import { runScript, type DomainEvent, type Frame, type MatchConfig, type StepOutput, type WindowResult } from "@touchline/sim-core"
import { cdfEventLine, cdfMeta, cdfTrackingLine, periodsFromFrames } from "./cdf.js"
import { hasScript, matchSteps } from "./run.js"
import { addRealismNoise, REALISM_NOISE } from "./noise.js"
import { spadlCsv } from "./spadl.js"
import { criticalErrors, mistakes, scriptTruths, tacticalTruths, type CriticalError, type Mistake, type ScriptTruth, type TeamTruth } from "./truths.js"

export interface RunManifest {
  readonly match_id: string
  readonly seed: number
  readonly home: string
  readonly away: string
  /** The scenario script's name, or null for a plain match. */
  readonly scenario: string | null
  readonly fps: number
  readonly params_version: string
  readonly engine: { readonly name: string; readonly version: string }
  readonly outputs: Readonly<Record<string, string>>
  readonly stats: { readonly frames: number; readonly events: number; readonly cdf_events: number; readonly score: string }
  /** The noise added to the CDF events (see noise.ts), or null when they are exact. */
  readonly realism_noise: typeof REALISM_NOISE | null
  /** A managed match (Plan 4b): each team's manager and how many decisions decisions.jsonl holds. */
  readonly managers?: { readonly home: string | null; readonly away: string | null; readonly decisions: number }
  /**
   * Ground truth for the evaluation harness (spec §5.1.12, §5.3.1); kept out of CDF. Its frame ids (`frames`,
   * `frame_id`) are global ticks, as in domain.jsonl and the stats engine; CDF frame ids restart at 0 each period.
   */
  readonly truths: {
    readonly script: ReadonlyArray<ScriptTruth>
    readonly scripted_events: ReadonlyArray<{ readonly id: string; readonly type: string; readonly frame_id: number; readonly team_id: string | null; readonly player_id: string | null }>
    readonly mistakes: ReadonlyArray<Mistake>
    readonly critical_errors: ReadonlyArray<CriticalError>
    readonly tactical: Readonly<Record<string, TeamTruth>>
  }
}

const sha256 = (path: string) => "sha256:" + createHash("sha256").update(readFileSync(path)).digest("hex")

/**
 * Run one match and write meta.json, event.jsonl, tracking.jsonl, domain.jsonl and manifest.json to `dir`.
 * Tracking is streamed to disk; events are kept in memory (a few thousand) to resolve CDF receiver times.
 */
export interface WriteOptions {
  /** Add realism noise to the CDF events (default off). */
  readonly noise?: boolean
  /**
   * A managed match (Plan 4b): its steps (decisions included), each team's manager, and its decision log lines, read
   * once the steps have run; they are written to decisions.jsonl. Managed matches have no scenario script.
   */
  readonly managed?: {
    readonly steps: Stream.Stream<StepOutput>
    readonly managers: { readonly home: string | null; readonly away: string | null }
    readonly decisions: () => ReadonlyArray<unknown>
  }
}

export const writeMatch = (cfg: MatchConfig, dir: string, opts: WriteOptions = {}) =>
  Effect.gen(function* () {
    // A scripted match is resolved first so its window results are known; a plain match streams step by step.
    if (opts.managed && hasScript(cfg)) return yield* Effect.die(new Error("a managed match has no scenario script"))
    const run = hasScript(cfg) ? runScript(cfg) : null
    const windows: ReadonlyArray<WindowResult> = run?.windows ?? []
    mkdirSync(dir, { recursive: true })
    const trackingFd = openSync(join(dir, "tracking.jsonl"), "w")
    const periods: Frame[] = []
    const tickTime = new Map<number, string>()
    const periodStart = new Map<string, number>()
    const events: DomainEvent[] = []
    let frames = 0
    let last: Frame | null = null
    yield* Stream.runForEach(run ? Stream.fromIterable(run.steps) : (opts.managed?.steps ?? matchSteps(cfg)), (r) =>
      Effect.sync(() => {
        events.push(...r.events)
        const f = r.frame
        if (!f) return
        frames++
        tickTime.set(f.tick, f.timestamp)
        if (f.frame_id === 0) {
          periodStart.set(f.period, f.tick)
          periods.push(f)
        }
        if (last && last.period !== f.period) periods.push(last)
        last = f
        writeSync(trackingFd, cdfTrackingLine(cfg.matchId, cfg, f) + "\n")
      })
    )
    closeSync(trackingFd)
    if (last) periods.push(last)
    const lastFrame = last as Frame | null
    const clock = (t: number) => tickTime.get(t) ?? lastFrame!.timestamp
    // Flights are emitted when they resolve and carries when they end; files list events in frame order
    // (stable, so events of the same frame keep their emission order).
    const ordered = [...events].sort((a, b) => a.frame_id - b.frame_id)
    // CDF events are exact, or carry realism noise when asked (the domain stream and SPADL view stay exact).
    const periodEnd = new Map(periodsFromFrames(periods).map((p) => [p.period, p.frameIdEnd]))
    const exported = opts.noise ? addRealismNoise(ordered, cfg, (p) => periodEnd.get(p) ?? 0).sort((a, b) => a.frame_id - b.frame_id) : ordered
    const recv = new Map(exported.filter((e) => e.type === "pass" && e.frame_id_end !== null).map((e) => [e.id, e.frame_id_end!]))
    const cdfLines = exported
      .map((e) => cdfEventLine(cfg, e, clock, (p) => periodStart.get(p) ?? 0, recv.get(e.id) ?? null, !opts.noise))
      .filter((x): x is string => x !== null)
    writeFileSync(join(dir, "event.jsonl"), cdfLines.join("\n") + "\n")
    writeFileSync(join(dir, "domain.jsonl"), ordered.map((e) => JSON.stringify(e)).join("\n") + "\n")
    writeFileSync(join(dir, "spadl.csv"), spadlCsv(ordered, cfg))
    writeFileSync(join(dir, "meta.json"), JSON.stringify(cdfMeta(cfg, periodsFromFrames(periods)), null, 1))
    const decisions = opts.managed?.decisions() ?? null
    if (decisions) writeFileSync(join(dir, "decisions.jsonl"), decisions.map((d) => JSON.stringify(d) + "\n").join(""))
    const goals = events.filter((e) => e.type === "goal")
    const score = `${goals.filter((g) => g.team_id === cfg.home.id).length}-${goals.filter((g) => g.team_id === cfg.away.id).length}`
    const manifest: RunManifest = {
      match_id: cfg.matchId,
      seed: cfg.seed,
      home: cfg.home.id,
      away: cfg.away.id,
      scenario: cfg.script?.name ?? null,
      fps: Math.round(1 / cfg.dt),
      params_version: cfg.params.provenance.version,
      engine: { name: "touchline-sim", version: "0.1.0" },
      outputs: Object.fromEntries([...["meta.json", "event.jsonl", "tracking.jsonl", "domain.jsonl", "spadl.csv"], ...(decisions ? ["decisions.jsonl"] : [])].map((f) => [f, sha256(join(dir, f))])),
      stats: { frames, events: events.length, cdf_events: cdfLines.length, score },
      realism_noise: opts.noise ? REALISM_NOISE : null,
      ...(opts.managed && decisions ? { managers: { ...opts.managed.managers, decisions: decisions.length } } : {}),
      truths: {
        script: scriptTruths(windows, cfg),
        scripted_events: ordered.filter((e) => e.attrs.scripted === true).map((e) => ({ id: e.id, type: e.type, frame_id: e.frame_id, team_id: e.team_id, player_id: e.player_id })),
        mistakes: mistakes(ordered),
        critical_errors: criticalErrors(ordered, cfg),
        tactical: tacticalTruths(ordered, cfg)
      }
    }
    writeFileSync(join(dir, "manifest.json"), JSON.stringify(manifest, null, 1))
    return manifest
  })

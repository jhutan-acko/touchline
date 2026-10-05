import { createHash } from "node:crypto"
import { closeSync, mkdirSync, openSync, readFileSync, writeFileSync, writeSync } from "node:fs"
import { join } from "node:path"
import { Effect, Stream } from "effect"
import type { DomainEvent, Frame, MatchConfig } from "@touchline/sim-core"
import { cdfEventLine, cdfMeta, cdfTrackingLine, periodsFromFrames } from "./cdf.js"
import { matchSteps } from "./run.js"

export interface RunManifest {
  readonly match_id: string
  readonly seed: number
  readonly home: string
  readonly away: string
  readonly script: string | null
  readonly fps: number
  readonly params_version: string
  readonly engine: { readonly name: string; readonly version: string }
  readonly outputs: Readonly<Record<string, string>>
  readonly stats: { readonly frames: number; readonly events: number; readonly cdf_events: number; readonly score: string }
}

const sha256 = (path: string) => "sha256:" + createHash("sha256").update(readFileSync(path)).digest("hex")

/**
 * Run one match and write meta.json, event.jsonl, tracking.jsonl, domain.jsonl and manifest.json to `dir`.
 * Tracking is streamed to disk; events are kept in memory (a few thousand) to resolve CDF receiver times.
 */
export const writeMatch = (cfg: MatchConfig, dir: string, script: string | null = null) =>
  Effect.gen(function* () {
    mkdirSync(dir, { recursive: true })
    const trackingFd = openSync(join(dir, "tracking.jsonl"), "w")
    const periods: Frame[] = []
    const tickTime = new Map<number, string>()
    const periodStart = new Map<string, number>()
    const events: DomainEvent[] = []
    let frames = 0
    let last: Frame | null = null
    yield* Stream.runForEach(matchSteps(cfg), (r) =>
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
    const recv = new Map(events.filter((e) => e.type === "pass" && e.frame_id_end !== null).map((e) => [e.id, e.frame_id_end!]))
    const cdfLines = ordered.map((e) => cdfEventLine(cfg, e, clock, (p) => periodStart.get(p) ?? 0, recv.get(e.id) ?? null)).filter((x): x is string => x !== null)
    writeFileSync(join(dir, "event.jsonl"), cdfLines.join("\n") + "\n")
    writeFileSync(join(dir, "domain.jsonl"), ordered.map((e) => JSON.stringify(e)).join("\n") + "\n")
    writeFileSync(join(dir, "meta.json"), JSON.stringify(cdfMeta(cfg, periodsFromFrames(periods)), null, 1))
    const goals = events.filter((e) => e.type === "goal")
    const score = `${goals.filter((g) => g.team_id === cfg.home.id).length}-${goals.filter((g) => g.team_id === cfg.away.id).length}`
    const manifest: RunManifest = {
      match_id: cfg.matchId,
      seed: cfg.seed,
      home: cfg.home.id,
      away: cfg.away.id,
      script,
      fps: Math.round(1 / cfg.dt),
      params_version: cfg.params.provenance.version,
      engine: { name: "touchline-sim", version: "0.1.0" },
      outputs: Object.fromEntries(["meta.json", "event.jsonl", "tracking.jsonl", "domain.jsonl"].map((f) => [f, sha256(join(dir, f))])),
      stats: { frames, events: events.length, cdf_events: cdfLines.length, score }
    }
    writeFileSync(join(dir, "manifest.json"), JSON.stringify(manifest, null, 1))
    return manifest
  })

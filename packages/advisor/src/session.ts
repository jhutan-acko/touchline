import { existsSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { decodeDomainEvent, type DomainEvent } from "@touchline/schema"
import { SCENARIOS } from "@touchline/sim"
import { initMatch, isFinished, statesAt, step, type MatchConfig, type MatchState, type Params, type TeamSetup } from "@touchline/sim-core"

/** A run folder the advisor cannot re-simulate (missing files, unknown clubs, parameters it does not have). */
export class AdvisorError extends Error {}

/** Plain matches keep a state every this many ticks, so any tick is reached by stepping from the one before. */
const CHECKPOINT_TICKS = 3000
/** States asked for are kept for reuse, the oldest dropped beyond this many (about 25 kB each). */
export const SESSION_CACHE_STATES = 256

/**
 * A match that can be re-simulated: its config, rebuilt from a run folder, and the match state at any tick
 * (computed on demand, kept for reuse). Scripted matches are replayed through the scenario runner, so their
 * states are those of the accepted match.
 */
export class Session {
  private readonly cache = new Map<number, MatchState>()
  private readonly checkpoints = new Map<number, MatchState>()

  constructor(
    readonly cfg: MatchConfig,
    /** The run's domain events, when the session was built from a run folder. */
    readonly events: ReadonlyArray<DomainEvent> = []
  ) {}

  /** The state after the step of `tick` (tick -1: before kick-off). */
  stateAt(tick: number): MatchState {
    const hit = this.cache.get(tick) ?? this.checkpoints.get(tick)
    if (hit) return hit
    if (!Number.isInteger(tick) || tick < -1) throw new AdvisorError(`no state at tick ${tick}`)
    let s: MatchState
    if ((this.cfg.script?.entries.length ?? 0) > 0) {
      const got = statesAt(this.cfg, [tick]).get(tick)
      if (!got) throw new AdvisorError(`the match is over before tick ${tick}`)
      s = got
    } else {
      let from = -1
      for (const m of [this.cache, this.checkpoints]) for (const k of m.keys()) if (k <= tick && k > from) from = k
      s = from >= 0 ? (this.cache.get(from) ?? this.checkpoints.get(from))! : initMatch(this.cfg)
      while (s.tick < tick) {
        if (isFinished(s)) throw new AdvisorError(`the match is over before tick ${tick}`)
        s = step(s).state
        if (s.tick % CHECKPOINT_TICKS === 0) this.checkpoints.set(s.tick, s)
      }
    }
    this.cache.set(tick, s)
    if (this.cache.size > SESSION_CACHE_STATES) this.cache.delete(this.cache.keys().next().value!)
    return s
  }

  /** States kept for reuse (asked for and checkpoints). */
  get cachedStates(): number {
    return this.cache.size + this.checkpoints.size
  }

  event(id: string): DomainEvent {
    const e = this.events.find((x) => x.id === id)
    if (!e) throw new AdvisorError(`no event "${id}" in this match`)
    return e
  }

  /**
   * Rebuild a run folder's match: clubs from the league, the scenario's script, the kick-off from meta.json and
   * the parameters whose version the manifest names (one of `params`). The rebuilt match is checked against the
   * run's own events before it is used.
   */
  static fromRun(dir: string, league: { readonly clubs: ReadonlyArray<TeamSetup> }, params: ReadonlyArray<Params>): Session {
    const read = (f: string) => {
      const p = join(dir, f)
      if (!existsSync(p)) throw new AdvisorError(`missing ${p}`)
      return readFileSync(p, "utf8")
    }
    const manifest = JSON.parse(read("manifest.json")) as { match_id: string; seed: number; home: string; away: string; scenario: string | null; fps: number; params_version: string }
    const meta = JSON.parse(read("meta.json")) as { match: { kickoff_time: string } }
    const club = (id: string) => {
      const c = league.clubs.find((x) => x.id === id)
      if (!c) throw new AdvisorError(`club "${id}" is not in the league file`)
      return c
    }
    const p = params.find((x) => x.provenance.version === manifest.params_version)
    if (!p) throw new AdvisorError(`the run used parameters "${manifest.params_version}"; available: ${params.map((x) => x.provenance.version).join(", ")}`)
    const scenario = manifest.scenario ? SCENARIOS[manifest.scenario] : null
    if (manifest.scenario && !scenario) throw new AdvisorError(`unknown scenario "${manifest.scenario}"`)
    const cfg: MatchConfig = {
      matchId: manifest.match_id,
      seed: manifest.seed,
      kickoffTime: meta.match.kickoff_time,
      home: club(manifest.home),
      away: club(manifest.away),
      params: p,
      dt: 1 / manifest.fps,
      ...(scenario ? { script: scenario.script } : {})
    }
    const events = read("domain.jsonl")
      .split("\n")
      .filter((l) => l.trim() !== "")
      .map((l) => decodeDomainEvent(JSON.parse(l)))
    const session = new Session(cfg, events)
    // The rebuilt match must emit the run's events: the first minute's last event id must match.
    const probe = 600
    const s = session.stateAt(probe)
    const last = events.filter((e) => Math.max(e.frame_id, e.frame_id_end ?? e.frame_id) <= probe).reduce((m, e) => Math.max(m, Number(e.id.split("-e").at(-1))), 0)
    if (s.eventSeq !== last) throw new AdvisorError(`${dir} does not match the match rebuilt from its manifest (events differ by minute 1)`)
    return session
  }
}

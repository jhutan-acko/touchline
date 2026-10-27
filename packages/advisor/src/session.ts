import { existsSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { decodeDecision, decodeDomainEvent, type DomainEvent } from "@touchline/schema"
import { SCENARIOS } from "@touchline/sim"
import { initMatch, isFinished, statesAt, step, withLoggedOrders, type LoggedOrders, type MatchConfig, type MatchState, type Params, type Side, type TeamSetup } from "@touchline/sim-core"
import { PREDATES_END_SWITCH, predatesEndSwitch } from "@touchline/stats"

/** A run folder the advisor cannot re-simulate (missing files, unknown clubs, parameters it does not have). */
export class AdvisorError extends Error {}

/** Plain matches keep a state every this many ticks, so any tick is reached by stepping from the one before. */
const CHECKPOINT_TICKS = 3000
/** States asked for are kept for reuse, the oldest dropped beyond this many (about 25 kB each). */
export const SESSION_CACHE_STATES = 256

/**
 * A match that can be re-simulated: its config, rebuilt from a run folder, and the match state at any tick
 * (computed on demand, kept for reuse). Scripted matches are replayed through the scenario runner, so their
 * states are those of the accepted match; managed matches apply their logged orders at their ticks (Plan 4b).
 */
export class Session {
  private readonly cache = new Map<number, MatchState>()
  private readonly checkpoints = new Map<number, MatchState>()
  /** States fetched ahead in one pass (prefetch), kept until the session goes. */
  private readonly pinned = new Map<number, MatchState>()
  /**
   * Prefetched states kept at most, the least recently used dropped beyond it. Unbounded by default (a library scan
   * pins every pass it explains); a long-lived session bounds it.
   */
  maxPinned = Number.POSITIVE_INFINITY

  constructor(
    readonly cfg: MatchConfig,
    /** The run's domain events, when the session was built from a run folder. */
    readonly events: ReadonlyArray<DomainEvent> = [],
    /** A managed match's orders, from its decision log. */
    readonly logged: LoggedOrders = []
  ) {}

  /** The state after the step of `tick` (tick -1: before kick-off). */
  stateAt(tick: number): MatchState {
    const pin = this.pinned.get(tick)
    if (pin) return this.touch(tick, pin)
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
        s = withLoggedOrders(step(s).state, this.logged)
        if (s.tick % CHECKPOINT_TICKS === 0) this.checkpoints.set(s.tick, s)
      }
    }
    this.cache.set(tick, s)
    if (this.cache.size > SESSION_CACHE_STATES) this.cache.delete(this.cache.keys().next().value!)
    return s
  }

  /**
   * Compute the states at many ticks in one run of the match (a scripted match is replayed once, not once per tick)
   * and keep them all: for scanning many events. About 25 kB per state.
   */
  prefetch(ticks: Iterable<number>): void {
    const all = [...new Set(ticks)]
    for (const t of all) {
      const pin = this.pinned.get(t)
      if (pin) this.touch(t, pin)
    }
    const want = all.filter((t) => !this.pinned.has(t))
    if (want.length) for (const [t, s] of statesAt(this.cfg, want, this.logged)) this.pinned.set(t, s)
    while (this.pinned.size > this.maxPinned) this.pinned.delete(this.pinned.keys().next().value!)
  }

  /** Mark a pinned state as just used (the last to be dropped). */
  private touch(tick: number, s: MatchState): MatchState {
    if (Number.isFinite(this.maxPinned)) {
      this.pinned.delete(tick)
      this.pinned.set(tick, s)
    }
    return s
  }

  /** Prefetched states kept now. */
  get pinnedStates(): number {
    return this.pinned.size
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
   * the parameters whose version the manifest names (one of `params`), and for a managed match its managed teams and
   * decision log. The rebuilt match is checked against the run's own events before it is used.
   */
  static fromRun(dir: string, league: { readonly clubs: ReadonlyArray<TeamSetup> }, params: ReadonlyArray<Params>): Session {
    const read = (f: string) => {
      const p = join(dir, f)
      if (!existsSync(p)) throw new AdvisorError(`missing ${p}`)
      return readFileSync(p, "utf8")
    }
    const manifest = JSON.parse(read("manifest.json")) as {
      match_id: string; seed: number; home: string; away: string; scenario: string | null; fps: number; params_version: string
      managers?: { home: string | null; away: string | null }
    }
    const meta = JSON.parse(read("meta.json")) as { match: { kickoff_time: string } }
    if (predatesEndSwitch(meta)) throw new AdvisorError(`${join(dir, "meta.json")}: ${PREDATES_END_SWITCH}`)
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
      ...(scenario ? { script: scenario.script } : {}),
      ...(manifest.managers ? { managed: (["home", "away"] as const).filter((s) => manifest.managers![s] !== null) } : {})
    }
    const logged: LoggedOrders = manifest.managers
      ? read("decisions.jsonl").split("\n").filter((l) => l.trim() !== "").map((l) => decodeDecision(JSON.parse(l))).map((d) => ({ tick: d.tick, side: d.side as Side, orders: d.orders_applied }))
      : []
    const events = read("domain.jsonl")
      .split("\n")
      .filter((l) => l.trim() !== "")
      .map((l) => decodeDomainEvent(JSON.parse(l)))
    const session = new Session(cfg, events, logged)
    // The rebuilt match must emit the run's events: compare the event count after the first minute, at half the
    // match and just before the end (a script that starts late, or a wrong scenario, shows up in the later probes).
    const emitted = (e: DomainEvent) => Math.max(e.frame_id, e.frame_id_end ?? e.frame_id)
    const end = events.reduce((m, e) => Math.max(m, emitted(e)), 0)
    const probes = [...new Set([Math.round(60 / cfg.dt), Math.round(end / 2), end - 1])].filter((t) => t >= 0 && t < end).sort((a, b) => a - b)
    if ((cfg.script?.entries.length ?? 0) > 0) for (const [t, st] of statesAt(cfg, probes)) session.cache.set(t, st)
    const mismatch = (t: number) => new AdvisorError(`${dir} does not match the match rebuilt from its manifest (events differ by tick ${t})`)
    for (const t of probes) {
      const last = events.filter((e) => emitted(e) <= t).reduce((m, e) => Math.max(m, Number(e.id.split("-e").at(-1))), 0)
      let seq: number
      try {
        seq = session.stateAt(t).eventSeq
      } catch (e) {
        // The rebuilt match ended before the run did: not the same match.
        if (e instanceof AdvisorError) throw mismatch(t)
        throw e
      }
      if (seq !== last) throw mismatch(t)
    }
    return session
  }
}

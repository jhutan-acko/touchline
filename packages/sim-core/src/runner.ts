import type { Side } from "./geometry.js"
import { substream } from "./rng.js"
import type { ScriptEntry } from "./script.js"
import { initMatch, isFinished, step } from "./step.js"
import { CONCERNS, type DomainEvent, type MatchConfig, type MatchState, type Role, type StepResult } from "./types.js"

/** A script the runner cannot play (overlapping windows). */
export class ScriptError extends Error {}

/** What happened in one scripted window (entries sharing the same window are played as one block). */
export interface WindowResult {
  readonly entries: ReadonlyArray<ScriptEntry>
  /** Whether every entry's target was met. */
  readonly achieved: boolean
  /** Plays of the window: 1 when the first try met the target; retries + 2 when it had to be forced. */
  readonly attempts: number
  /** Whether the last play forced the outcome (the forced events carry `scripted: true`). */
  readonly forced: boolean
  /** Global ticks of the window's first and last frame. */
  readonly fromFrame: number
  readonly toFrame: number
}

/** What a step produced: its frame and events (without the match state, which would cost ~25 kB per step). */
export type StepOutput = Pick<StepResult, "frame" | "events">

export interface ScriptedRun {
  /** Every step of the accepted match, kickoff to full time: frame and events only. */
  readonly steps: ReadonlyArray<StepOutput>
  readonly windows: ReadonlyArray<WindowResult>
}

export interface RunOptions {
  /** Re-plays of a window with fresh random sub-streams before forcing (default 5). */
  readonly retries?: number
}

const minuteOf = (s: MatchState): number => (s.period === "first_half" ? 0 : 45) + (Math.max(0, s.periodTick) * s.config.dt) / 60

/** Fresh random sub-streams for every concern, distinct per window and attempt (so a retry plays differently). */
const reseed = (s: MatchState, windowIndex: number, attempt: number): MatchState => {
  const rng = {} as Record<(typeof CONCERNS)[number], MatchState["rng"][(typeof CONCERNS)[number]]>
  for (const c of CONCERNS) rng[c] = substream(s.config.seed, `${c}:retry`, windowIndex * 64 + attempt)
  return { ...s, rng }
}

const rolesOf = (cfg: MatchConfig): Map<string, Role> =>
  new Map([cfg.home, cfg.away].flatMap((t) => [...t.starters, ...(t.bench ?? [])].map((p) => [p.id, p.role] as const)))

/** Whether one entry's target was met by the events of its window. */
export const entryAchieved = (entry: ScriptEntry, events: ReadonlyArray<DomainEvent>, cfg: MatchConfig): boolean => {
  const teamOf = (side: Side) => (side === "home" ? cfg.home.id : cfg.away.id)
  const team = teamOf(entry.team)
  const opp = teamOf(entry.team === "home" ? "away" : "home")
  const n = (f: (e: DomainEvent) => boolean) => events.filter(f).length
  switch (entry.effect) {
    case "goal":
      return n((e) => e.type === "goal" && e.team_id === team) >= (entry.count ?? 1)
    case "red_card":
      return n((e) => e.type === "card" && e.attrs.colour !== "yellow" && e.team_id === team) >= 1
    case "press_surge": {
      // Pressures per 100 opponent passes, so the measure does not depend on who has the ball more.
      const own = n((e) => e.type === "pressure" && e.team_id === team)
      return own >= 5 && (100 * own) / Math.max(1, n((e) => e.type === "pass" && e.team_id === opp)) >= cfg.params.script.pressTarget
    }
    case "momentum_swing": {
      const own = n((e) => e.type === "shot" && e.team_id === team)
      return own >= 3 && own >= 2 * n((e) => e.type === "shot" && e.team_id === opp)
    }
    case "keeper_heroics":
      return n((e) => e.type === "keeper_save" && e.team_id === team) >= KEEPER_HEROICS_SAVES
    case "keeper_howler":
      return (
        n((e) => e.type === "keeper_save" && e.team_id === team && (e.attrs.handling === "fumble" || e.attrs.handling === "parried_dangerous")) >= 1 ||
        n((e) => e.type === "shot" && e.team_id === opp && e.attrs.scripted === true) >= 1
      )
    case "defensive_error": {
      const roles = rolesOf(cfg)
      const attack = entry.team === "home" ? 1 : -1
      // A defender's mis-hit kick in their own half: a pass, or a clearance that was meant to get the ball away.
      return n((e) => (e.type === "pass" || e.type === "clearance") && e.team_id === team && e.attrs.execution === "mishit" && ["CB", "FB", "DM"].includes(roles.get(e.player_id ?? "") ?? "") && (e.x ?? 0) * attack < 0) >= 1
    }
  }
}

/** Entries grouped by identical window, in window order; overlapping windows are refused. */
const groups = (entries: ReadonlyArray<ScriptEntry>): ScriptEntry[][] => {
  const byWindow = new Map<string, ScriptEntry[]>()
  for (const e of entries) {
    const k = `${e.window[0]}-${e.window[1]}`
    byWindow.set(k, [...(byWindow.get(k) ?? []), e])
  }
  const out = [...byWindow.values()].sort((a, b) => a[0]!.window[0] - b[0]!.window[0])
  for (let i = 1; i < out.length; i++)
    if (out[i]![0]!.window[0] < out[i - 1]![0]!.window[1]) throw new ScriptError(`script windows overlap: ${JSON.stringify(out[i - 1]![0]!.window)} and ${JSON.stringify(out[i]![0]!.window)}`)
  return out
}

/** How many forced outcomes an entry's target needs: its goals, two saves for heroics, one otherwise (pressing and momentum cannot be forced). */
const forcesNeeded = (e: ScriptEntry): number =>
  e.effect === "press_surge" || e.effect === "momentum_swing" ? 0 : e.effect === "goal" ? (e.count ?? 1) : e.effect === "keeper_heroics" ? KEEPER_HEROICS_SAVES : 1

/** The number of saves that make keeper heroics. */
const KEEPER_HEROICS_SAVES = 2

/** Forced outcomes for a block: as many per entry as its target needs. */
const forcesFor = (block: ReadonlyArray<ScriptEntry>): ScriptEntry[] => block.flatMap((e) => Array.from({ length: forcesNeeded(e) }, () => e))

/**
 * Play a match under its scenario script (spec §5.1.7): nudge (the engine applies the script's modifiers inside
 * each window), retry (re-play a window that missed its target from a checkpoint, with fresh sub-seeds, up to
 * `retries` times), and force as a last resort (re-play once more with the outcomes forced on the next qualifying
 * actions). Pure and deterministic: the same config always gives the same match.
 */
export const runScript = (cfg: MatchConfig, opts: RunOptions = {}): ScriptedRun => {
  const retries = opts.retries ?? 5
  const blocks = groups(cfg.script?.entries ?? [])
  const steps: StepOutput[] = []
  const windows: WindowResult[] = []
  let s = initMatch(cfg)
  const advance = (until: (st: MatchState) => boolean) => {
    while (!isFinished(s) && !until(s)) {
      const r = step(s)
      s = r.state
      steps.push({ frame: r.frame, events: r.events })
    }
  }
  blocks.forEach((block, bi) => {
    const [start, end] = block[0]!.window
    // A window starting at 45 or later waits for the second half (first-half added time also reaches minute 45+).
    advance((st) => minuteOf(st) >= start && (start < 45 || st.period === "second_half"))
    if (isFinished(s)) return
    const checkpoint = s
    for (let attempt = 0; attempt <= retries + 1; attempt++) {
      const forcing = attempt === retries + 1
      let t = attempt === 0 ? checkpoint : reseed(checkpoint, bi, attempt)
      if (forcing) t = { ...t, forced: forcesFor(block) }
      const buffer: StepOutput[] = []
      while (!isFinished(t) && minuteOf(t) < end) {
        const r = step(t)
        t = r.state
        buffer.push({ frame: r.frame, events: r.events })
      }
      const events = buffer.flatMap((r) => r.events)
      const achieved = block.every((e) => entryAchieved(e, events, cfg))
      if (achieved || forcing) {
        steps.push(...buffer)
        s = { ...t, forced: [] }
        const frames = buffer.filter((r) => r.frame)
        windows.push({ entries: block, achieved, attempts: attempt + 1, forced: forcing, fromFrame: frames[0]?.frame!.tick ?? checkpoint.tick, toFrame: frames.at(-1)?.frame!.tick ?? checkpoint.tick })
        return
      }
    }
  })
  advance(() => false)
  return { steps, windows }
}

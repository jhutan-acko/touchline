import { createReadStream, existsSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { createInterface } from "node:readline"
import { Effect, Stream } from "effect"
import { decodeDomainEvent, type DomainEvent } from "@touchline/schema"
import type { Role } from "@touchline/sim-core"
import { emittedAt, type MatchInfo, type StatsInput, type TeamInfo, type TrackFrame } from "./input.js"

/** A run folder that cannot be replayed (missing or malformed file). */
export class ReplayError extends Error {}

/**
 * Teams switch ends at half-time since realism v2 P1. A run folder written before that has its second half still
 * played left to right, so its coordinates no longer match the stats models, the pitch view or a re-simulation.
 */
export const PREDATES_END_SWITCH = "run predates the half-time switch of ends (second half played left_right); regenerate it"

/** True when CDF match meta was written before teams switched ends at half-time (see PREDATES_END_SWITCH). */
export const predatesEndSwitch = (meta: unknown): boolean => {
  const periods = (meta as { match?: { periods?: unknown } } | null)?.match?.periods
  return Array.isArray(periods) && periods.some((p: { period?: unknown; play_direction?: unknown } | null) => p?.period === "second_half" && p.play_direction === "left_right")
}

/** Clubs whose players' names and roles fill in what CDF meta leaves out (data/league/league.json). */
export interface Roster {
  readonly clubs: ReadonlyArray<{
    readonly id: string
    readonly starters: ReadonlyArray<{ readonly id: string; readonly role: Role; readonly name?: string }>
    readonly bench?: ReadonlyArray<{ readonly id: string; readonly role: Role; readonly name?: string }>
  }>
}

export interface Replay {
  readonly info: MatchInfo
  /** Every event and frame, merged in emission order (events of a tick before its frame). */
  readonly inputs: Stream.Stream<StatsInput, ReplayError>
}

interface CdfMeta {
  readonly match: { readonly id: string }
  readonly teams: Record<"home" | "away", { readonly id: string; readonly name: string; readonly players: ReadonlyArray<{ readonly id: string; readonly jersey_number: number }> }>
  readonly meta: { readonly tracking: { readonly fps: number } }
}

interface CdfFrame {
  readonly frame_id: number
  readonly period: "first_half" | "second_half"
  readonly teams: Record<"home" | "away", { readonly players: ReadonlyArray<{ readonly id: string; readonly x: number; readonly y: number }> }>
  readonly ball: { readonly x: number; readonly y: number; readonly z: number; readonly status?: boolean; readonly poss_team_id?: string }
}

const readJson = (path: string): unknown => {
  if (!existsSync(path)) throw new ReplayError(`missing ${path}`)
  try {
    return JSON.parse(readFileSync(path, "utf8"))
  } catch (e) {
    throw new ReplayError(`${path}: ${e instanceof Error ? e.message : String(e)}`)
  }
}

const readEvents = (path: string): DomainEvent[] => {
  if (!existsSync(path)) throw new ReplayError(`missing ${path}`)
  return readFileSync(path, "utf8")
    .split("\n")
    .filter((l) => l.trim() !== "")
    .map((l, i) => {
      try {
        return decodeDomainEvent(JSON.parse(l))
      } catch (e) {
        throw new ReplayError(`${path}:${i + 1}: ${e instanceof Error ? e.message.split("\n")[0] : String(e)}`)
      }
    })
}

/** Match info from CDF meta, with names and roles from the roster when it has the clubs. */
export const infoFromMeta = (meta: CdfMeta, roster?: Roster): MatchInfo => {
  const team = (side: "home" | "away"): TeamInfo => {
    const t = meta.teams[side]
    const club = roster?.clubs.find((c) => c.id === t.id)
    const known = new Map([...(club?.starters ?? []), ...(club?.bench ?? [])].map((p) => [p.id, p]))
    return { id: t.id, name: t.name, side, players: t.players.map((p) => ({ id: p.id, name: known.get(p.id)?.name ?? p.id, role: known.get(p.id)?.role ?? null, jersey: p.jersey_number })) }
  }
  return { matchId: meta.match.id, dt: 1 / meta.meta.tracking.fps, home: team("home"), away: team("away") }
}

/**
 * Replay a run folder written by `pnpm sim` (meta.json, domain.jsonl, tracking.jsonl): the exact domain events and
 * the tracking frames, merged in the order the simulator emitted them. Tracking is read line by line.
 */
export const readRun = (dir: string, roster?: Roster): Effect.Effect<Replay, ReplayError> =>
  Effect.try({
    try: () => {
      const meta = readJson(join(dir, "meta.json")) as CdfMeta
      if (!meta?.teams?.home || !meta?.meta?.tracking?.fps) throw new ReplayError(`${join(dir, "meta.json")}: not CDF match meta`)
      if (predatesEndSwitch(meta)) throw new ReplayError(`${join(dir, "meta.json")}: ${PREDATES_END_SWITCH}`)
      const info = infoFromMeta(meta, roster)
      const events = readEvents(join(dir, "domain.jsonl"))
      // Global tick = the period's offset + the CDF frame id; every event carries both.
      const offset = new Map<string, number>()
      for (const e of events) if (!offset.has(e.period)) offset.set(e.period, e.frame_id - e.period_frame_id)
      const ordered = events.map((e, i) => ({ e, i, t: emittedAt(e) })).sort((a, b) => a.t - b.t || a.i - b.i)
      const trackingPath = join(dir, "tracking.jsonl")
      if (!existsSync(trackingPath)) throw new ReplayError(`missing ${trackingPath}`)
      const toFrame = (c: CdfFrame): TrackFrame => ({
        tick: (offset.get(c.period) ?? 0) + c.frame_id,
        frame_id: c.frame_id,
        period: c.period,
        home: c.teams.home.players,
        away: c.teams.away.players,
        ball: { x: c.ball.x, y: c.ball.y, z: c.ball.z },
        ball_in_play: c.ball.status === true,
        possession_side: c.ball.poss_team_id === info.home.id ? "home" : c.ball.poss_team_id === info.away.id ? "away" : null
      })
      async function* merged(): AsyncGenerator<StatsInput> {
        let i = 0
        let n = 0
        for await (const line of createInterface({ input: createReadStream(trackingPath), crlfDelay: Infinity })) {
          n++
          if (line.trim() === "") continue
          let f: TrackFrame
          try {
            f = toFrame(JSON.parse(line) as CdfFrame)
          } catch (e) {
            throw new ReplayError(`${trackingPath}:${n}: ${e instanceof Error ? e.message : String(e)}`)
          }
          while (i < ordered.length && ordered[i]!.t <= f.tick) yield { kind: "event", event: ordered[i++]!.e }
          yield { kind: "frame", frame: f }
        }
        while (i < ordered.length) yield { kind: "event", event: ordered[i++]!.e }
      }
      return { info, inputs: Stream.fromAsyncIterable(merged(), (e) => (e instanceof ReplayError ? e : new ReplayError(String(e)))) }
    },
    catch: (e) => (e instanceof ReplayError ? e : new ReplayError(String(e)))
  })

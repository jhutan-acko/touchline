import type { DomainEvent } from "@touchline/schema"
import type { MatchConfig, Role } from "@touchline/sim-core"

/** A tracking frame as the stats engine needs it (the simulator's Frame fits; replays rebuild it from CDF). */
export interface TrackPlayer {
  readonly id: string
  readonly x: number
  readonly y: number
}
export interface TrackFrame {
  /** Global tick (counts across periods). */
  readonly tick: number
  /** Frame id within the period. */
  readonly frame_id: number
  readonly period: "first_half" | "second_half"
  readonly home: ReadonlyArray<TrackPlayer>
  readonly away: ReadonlyArray<TrackPlayer>
  readonly ball: { readonly x: number; readonly y: number; readonly z: number }
  readonly ball_in_play: boolean
  readonly possession_side: "home" | "away" | null
}

export type StatsInput = { readonly kind: "event"; readonly event: DomainEvent } | { readonly kind: "frame"; readonly frame: TrackFrame }

/**
 * The tick at which an event's outcome became known (the end of a pass's flight, of a carry). The simulator emits
 * each event in the step of that tick, before its frame, or just after the frame when the period ends (a carry cut
 * short by the whistle, period_end, match_end); the engine treats both orders alike.
 */
export const emittedAt = (e: Pick<DomainEvent, "frame_id" | "frame_id_end">): number => Math.max(e.frame_id, e.frame_id_end ?? e.frame_id)

export interface PlayerInfo {
  readonly id: string
  readonly name: string
  /** Null when unknown (a replay read without the league file). */
  readonly role: Role | null
  readonly jersey: number
}
export interface TeamInfo {
  readonly id: string
  readonly name: string
  readonly side: "home" | "away"
  /** Starters, then substitutes. */
  readonly players: ReadonlyArray<PlayerInfo>
}
export interface MatchInfo {
  readonly matchId: string
  /** Seconds per tick. */
  readonly dt: number
  readonly home: TeamInfo
  readonly away: TeamInfo
}

type Named = { readonly id: string; readonly role: Role; readonly jersey: number; readonly name?: string }

export const infoFromConfig = (cfg: MatchConfig): MatchInfo => {
  const team = (side: "home" | "away"): TeamInfo => {
    const t = cfg[side]
    const players = [...t.starters, ...(t.bench ?? [])] as ReadonlyArray<Named>
    return { id: t.id, name: t.name, side, players: players.map((p) => ({ id: p.id, name: p.name ?? p.id, role: p.role, jersey: p.jersey })) }
  }
  return { matchId: cfg.matchId, dt: cfg.dt, home: team("home"), away: team("away") }
}

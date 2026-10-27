/**
 * On-ball event ticks on the Watch stream. This MIRRORS the rpc contract being added to packages/rpc (the "Live stat
 * tags" task: `{ kind: "event", event: BallEvent }` in the Tick union); at merge, import `BallEvent` from
 * @touchline/rpc instead and drop this copy. The app handles these ticks defensively, so it also runs against an API
 * that sends none.
 */
import type { Tick } from "@touchline/rpc"

export interface BallEvent {
  readonly id: string
  readonly frame: number
  readonly clock: string
  readonly type: "pass" | "shot" | "carry" | "tackle" | "interception" | "clearance" | "save"
  readonly team: "home" | "away"
  readonly player_id: string
  /** Pass: the intended or actual receiver, when known. */
  readonly receiver_id: string | null
  readonly outcome: "success" | "fail" | "goal" | "saved" | "blocked" | "off_target" | null
  /** The same pitch coordinates as PitchFrame. */
  readonly x: number
  readonly y: number
  readonly x_end: number | null
  readonly y_end: number | null
  /** Pass or carry length (m). */
  readonly length_m: number | null
  /** Pass completion probability (pass difficulty is 1 - xpass). */
  readonly xpass: number | null
  /** Ball speed at release (shots and passes). */
  readonly speed_kmh: number | null
  /** Shots only. */
  readonly xg: number | null
}

export interface EventTick {
  readonly kind: "event"
  readonly event: BallEvent
}

/** What a watcher can receive: the rpc ticks, plus on-ball events (until the rpc union carries them itself). */
export type WatchTick = Tick | EventTick

/** An on-ball event tick, checked loosely (the shape comes from the wire). */
export const isEventTick = (t: { readonly kind: string }): t is EventTick => {
  if (t.kind !== "event") return false
  const e = (t as { event?: unknown }).event as Partial<BallEvent> | undefined
  return !!e && typeof e.id === "string" && typeof e.frame === "number" && typeof e.player_id === "string" && typeof e.type === "string"
}

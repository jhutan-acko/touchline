/**
 * Follow my player: what each player has done so far, from the ticks a pane receives. Running (distance, speed) comes
 * from the frames, kept for every player so the viewer can pick anyone mid-match; passes, shots and the rest come from
 * the on-ball event ticks. Pure. Everything is read "as of" a match frame (the latest, or the frame a viewer froze on),
 * so nothing after that frame ever counts (no spoilers).
 */
import type { BallEvent, PitchFrame, Tick } from "@touchline/rpc"
import { RING_S } from "./pane.js"

/** Totals for every player as of one frame. */
export interface Mark {
  readonly frame: number
  /** Metres run since the pane started watching, by player id. */
  readonly dist: Readonly<Record<string, number>>
  /** Fastest speed so far (m/s, over a one-second window), by player id. */
  readonly top: Readonly<Record<string, number>>
}

export interface FollowState {
  /** The totals at each frame of the last RING_S (+1) seconds, oldest first; the last is the latest. */
  readonly marks: ReadonlyArray<Mark>
  /** The newest frame's positions, to measure the next step from. */
  readonly last: { readonly frame: number; readonly spots: Readonly<Record<string, readonly [number, number]>> } | null
  /** Every on-ball event received, in frame order, each once. */
  readonly events: ReadonlyArray<BallEvent>
}

export const FOLLOW_EMPTY: FollowState = { marks: [], last: null, events: [] }

/** Faster than this (m/s, about 43 km/h) is a jump (a reset, a glitch), not running: the step does not count. */
export const MAX_MPS = 12
/** Steps over a longer gap than this (s) are not measured (a reconnect, a skip). */
export const MAX_GAP_S = 1

const insertEvent = (events: ReadonlyArray<BallEvent>, e: BallEvent): ReadonlyArray<BallEvent> => {
  if (events.some((x) => x.id === e.id)) return events
  let i = events.length
  while (i > 0 && events[i - 1]!.frame > e.frame) i--
  return [...events.slice(0, i), e, ...events.slice(i)]
}

/** The index of the newest mark at or before a frame, or -1. */
const markIndex = (marks: ReadonlyArray<Mark>, frame: number): number => {
  let lo = 0
  let hi = marks.length - 1
  let best = -1
  while (lo <= hi) {
    const mid = (lo + hi) >> 1
    if (marks[mid]!.frame <= frame) {
      best = mid
      lo = mid + 1
    } else hi = mid - 1
  }
  return best
}

/** Speed (m/s) over the second up to marks[i], or null with under half a second of history behind it. */
const speedAt = (marks: ReadonlyArray<Mark>, i: number, id: string, fps: number): number | null => {
  const now = marks[i]
  if (!now) return null
  const from = markIndex(marks, now.frame - fps)
  // The window starts at the first mark inside the last second.
  const j = from >= 0 && marks[from]!.frame < now.frame - fps ? from + 1 : Math.max(0, from)
  const then = marks[j]
  if (!then || now.frame - then.frame < fps / 2) return null
  return ((now.dist[id] ?? 0) - (then.dist[id] ?? 0)) / ((now.frame - then.frame) / fps)
}

const withFrame = (s: FollowState, f: PitchFrame, fps: number): FollowState => {
  const spots: Record<string, readonly [number, number]> = {}
  for (const p of [...f.home, ...f.away]) spots[p.id] = [p.x, p.y]
  const prev = s.last
  if (prev && f.frame === prev.frame) return s
  // Back in time (a seek): keep only what came before, and start measuring afresh.
  const marks0 = prev && f.frame < prev.frame ? s.marks.filter((m) => m.frame <= f.frame) : s.marks
  const base = marks0.at(-1) ?? { frame: f.frame, dist: {}, top: {} }
  const dist: Record<string, number> = { ...base.dist }
  const top: Record<string, number> = { ...base.top }
  const gap = prev && f.frame > prev.frame ? f.frame - prev.frame : 0
  if (gap > 0 && gap <= MAX_GAP_S * fps) {
    const dt = gap / fps
    for (const [id, [x, y]] of Object.entries(spots)) {
      const was = prev!.spots[id]
      if (!was) continue
      const d = Math.hypot(x - was[0], y - was[1])
      if (d / dt <= MAX_MPS) dist[id] = (dist[id] ?? 0) + d
    }
  }
  const keepFrom = f.frame - (RING_S + 1) * fps
  const marks = [...marks0.filter((m) => m.frame >= keepFrom), { frame: f.frame, dist, top }]
  // The top speed: the fastest one-second window so far (smooths a single noisy step).
  const i = marks.length - 1
  for (const id of Object.keys(spots)) {
    const v = speedAt(marks, i, id, fps)
    if (v !== null && v <= MAX_MPS && v > (top[id] ?? 0)) top[id] = v
  }
  return { ...s, marks, last: { frame: f.frame, spots } }
}

/** The state after a tick: frames move the running totals, event ticks add to the events, the rest change nothing. */
/** An on-ball event tick, checked loosely (the shape comes from the wire). */
export const isEventTick = (t: { readonly kind: string }): t is Extract<Tick, { kind: "event" }> => {
  if (t.kind !== "event") return false
  const e = (t as { event?: unknown }).event as Partial<BallEvent> | undefined
  return !!e && typeof e.id === "string" && typeof e.frame === "number" && typeof e.player_id === "string" && typeof e.type === "string"
}

export const followReduce = (s: FollowState, tick: Tick, fps: number): FollowState => {
  if (isEventTick(tick)) return { ...s, events: insertEvent(s.events, tick.event) }
  if (tick.kind === "frame") return withFrame(s, tick.frame, fps)
  return s
}

/** The kinds of involvement the moment ribbon lists (carries are too many to be moments). */
export const MOMENT_TYPES: ReadonlyArray<BallEvent["type"]> = ["pass", "shot", "tackle", "interception", "clearance", "save"]

export interface PlayerStats {
  /** Kilometres run as of the frame, or null when that frame's totals are no longer held. */
  readonly km: number | null
  /** Speed now (km/h) over the last second, or null. */
  readonly kmh: number | null
  /** Top speed so far (km/h), or null. */
  readonly topKmh: number | null
  readonly passes: { readonly done: number; readonly tried: number }
  /** Completed over attempted, 0–100, or null with no passes. */
  readonly accuracy: number | null
  readonly shots: number
  readonly goals: number
  /** Mean pass difficulty (1 - xpass) of the passes tried, 0–100, or null with none rated. */
  readonly difficulty: number | null
  /** The player's last involvements, newest first (at most three). */
  readonly moments: ReadonlyArray<BallEvent>
}

const MS_TO_KMH = 3.6

/** A player's numbers as of a match frame: only what had happened by then counts. */
export const playerStats = (s: FollowState, id: string, frame: number, fps: number): PlayerStats => {
  const i = markIndex(s.marks, frame)
  // None at or before the frame: its totals have left the history (or nothing has been measured yet).
  const mark = i >= 0 ? s.marks[i]! : null
  const v = mark ? speedAt(s.marks, i, id, fps) : null
  const mine = s.events.filter((e) => e.player_id === id && e.frame <= frame)
  const passes = mine.filter((e) => e.type === "pass")
  const done = passes.filter((e) => e.outcome === "success").length
  const rated = passes.filter((e) => e.xpass !== null)
  const shots = mine.filter((e) => e.type === "shot")
  return {
    km: mark ? (mark.dist[id] ?? 0) / 1000 : null,
    kmh: v === null ? null : v * MS_TO_KMH,
    topKmh: mark ? (mark.top[id] ?? 0) * MS_TO_KMH : null,
    passes: { done, tried: passes.length },
    accuracy: passes.length ? (100 * done) / passes.length : null,
    shots: shots.length,
    goals: shots.filter((e) => e.outcome === "goal").length,
    difficulty: rated.length ? (100 * rated.reduce((a, e) => a + (1 - e.xpass!), 0)) / rated.length : null,
    moments: mine.filter((e) => MOMENT_TYPES.includes(e.type)).slice(-3).reverse()
  }
}

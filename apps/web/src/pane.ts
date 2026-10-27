/**
 * What one view (pane) of a session shows, from the ticks it receives: the latest frame and the last 30 s of frames
 * (a frozen view shows one of them), the scoreboard, the cues on screen (each anchored to match frames, so a frozen view
 * keeps the overlays it had) and every agent cue so far (for "Why?").
 */
import type { BallEvent, PitchFrame, Playback, Tick } from "@touchline/rpc"
import type { Cue } from "@touchline/schema"

export type Slot = Cue["display"]["slot"]

export interface Board {
  readonly score: { readonly home: number; readonly away: number }
  readonly clock: string
  readonly momentum: { readonly home: number; readonly away: number } | null
}

export interface OnScreen {
  readonly cue: Cue
  /** The last match frame it shows on: its ttl counted (in frames) from the end of its anchor, or from its arrival if later. */
  readonly untilFrame: number
  /** The latest match frame known when it arrived: a view frozen before then never shows it (no spoilers). */
  readonly arrivedAt: number
}

/** An on-ball event as it reached this pane. */
export interface ArrivedEvent {
  readonly event: BallEvent
  /** The latest match frame known when it arrived: a view frozen before then never shows it (no spoilers). */
  readonly arrivedAt: number
}

export interface PaneState {
  readonly frame: PitchFrame | null
  /** The frames of the last RING_S seconds, oldest first. */
  readonly ring: ReadonlyArray<PitchFrame>
  /** The latest match frame known: the newest frame received or, before any (the graphics output gets none), the newest cue's anchor end. */
  readonly head: number | null
  readonly playback: Playback | null
  readonly board: Board | null
  /** Newest first. */
  readonly onScreen: ReadonlyArray<OnScreen>
  /** Every agent cue received (but pitch markers), newest first. */
  readonly feed: ReadonlyArray<Cue>
  /** When each cue in the feed arrived (the latest match frame known then), by cue id. */
  readonly feedArrivedAt: Readonly<Record<string, number>>
  /** The latest on-ball events (stat tags, follow my player), newest first. */
  readonly events: ReadonlyArray<ArrivedEvent>
}

export const EMPTY: PaneState = { frame: null, ring: [], head: null, playback: null, board: null, onScreen: [], feed: [], feedArrivedAt: {}, events: [] }

/** At most this many on-ball events are kept (a minute or so of play). */
export const EVENTS_SIZE = 120

/** At most this many agent cues stay in the feed. */
export const FEED_SIZE = 50
/** Seconds of frames kept for freezing. */
export const RING_S = 30
/**
 * At most this many cues are held for the screen. They are not dropped when their time is up, since a view frozen
 * long ago may still be showing them.
 */
export const ONSCREEN_SIZE = 32

const boardOf = (cue: Cue): Board => {
  const d = cue.data
  const mom = d["team.mom.home"] !== undefined && d["team.mom.away"] !== undefined ? { home: d["team.mom.home"]!, away: d["team.mom.away"]! } : null
  return { score: { home: d["score.home"] ?? 0, away: d["score.away"] ?? 0 }, clock: cue.anchor.clock, momentum: mom }
}

/** The ring with a new frame: an earlier frame than the newest (a seek back) starts it afresh. */
const ringWith = (ring: ReadonlyArray<PitchFrame>, f: PitchFrame, fps: number): ReadonlyArray<PitchFrame> => {
  const last = ring.at(-1)
  if (last && last.frame === f.frame) return ring
  const kept = last && f.frame < last.frame ? [] : ring
  const from = f.frame - RING_S * fps
  return [...kept.filter((x) => x.frame >= from), f]
}

export const reduce = (s: PaneState, tick: Tick, fps: number): PaneState => {
  switch (tick.kind) {
    case "frame":
      return { ...s, frame: tick.frame, ring: ringWith(s.ring, tick.frame, fps), head: tick.frame.frame }
    case "playback":
      return { ...s, playback: tick.playback }
    case "event": {
      const e = tick.event
      const arrivedAt = Math.max(s.head ?? e.frame, e.frame)
      return { ...s, events: [{ event: e, arrivedAt }, ...s.events.filter((x) => x.event.id !== e.id)].slice(0, EVENTS_SIZE) }
    }
    case "cue": {
      const cue = tick.cue
      const head = s.frame ? s.head : Math.max(s.head ?? 0, cue.anchor.frame_to)
      if (cue.display.slot === "top_bar") return { ...s, head, board: boardOf(cue) }
      const arrival = s.head ?? cue.anchor.frame_to
      const untilFrame = Math.max(cue.anchor.frame_to, arrival) + Math.round((cue.display.ttl_ms * fps) / 1000)
      const onScreen = [{ cue, untilFrame, arrivedAt: arrival }, ...s.onScreen.filter((o) => o.cue.cue_id !== cue.cue_id)].slice(0, ONSCREEN_SIZE)
      // Pitch markers are drawn on the pitch, not listed (they carry no text to explain).
      if (cue.display.slot === "pitch_marker") return { ...s, head, onScreen }
      const feed = [cue, ...s.feed.filter((c) => c.cue_id !== cue.cue_id)].slice(0, FEED_SIZE)
      const feedArrivedAt = Object.fromEntries(feed.map((c) => [c.cue_id, c === cue ? arrival : s.feedArrivedAt[c.cue_id] ?? arrival]))
      return { ...s, head, onScreen, feed, feedArrivedAt }
    }
  }
}

/**
 * The cues showing in a slot at a match frame, newest first (a slot's overlay shows the first). `frozen` is the frame a
 * view froze on, if it did: a cue that arrived after it does not show then, even when its anchor spans the frame (the
 * view had not seen it yet; no spoilers).
 */
export const inSlot = (s: PaneState, slot: Slot, frame: number, frozen: number | null = null): Cue[] =>
  s.onScreen
    .filter((o) => o.cue.display.slot === slot && o.cue.anchor.frame_from <= frame && frame <= o.untilFrame && (frozen === null || o.arrivedAt <= frozen))
    .map((o) => o.cue)

/** The feed as it stood at a match frame: the cues that had arrived by then, newest first. */
export const feedAt = (s: PaneState, frame: number): Cue[] => s.feed.filter((c) => (s.feedArrivedAt[c.cue_id] ?? Infinity) <= frame)

/** The frame held at a match frame (the newest at or before it), or null when it is older than the ring. */
export const frameAt = (s: PaneState, frame: number): PitchFrame | null => {
  for (let i = s.ring.length - 1; i >= 0; i--) if (s.ring[i]!.frame <= frame) return s.ring[i]!
  return null
}

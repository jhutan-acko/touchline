/**
 * What one view (pane) of a session shows, from the ticks it receives: the latest frame, the scoreboard, the cues on
 * screen by slot (each until its ttl runs out, in wall-clock time) and every agent cue so far (for "Why?").
 */
import type { PitchFrame, Playback, Tick } from "@touchline/rpc"
import type { Cue } from "@touchline/schema"

export interface Board {
  readonly score: { readonly home: number; readonly away: number }
  readonly clock: string
  readonly momentum: { readonly home: number; readonly away: number } | null
}

export interface OnScreen {
  readonly cue: Cue
  /** Wall-clock milliseconds when it leaves the screen. */
  readonly until: number
}

export interface PaneState {
  readonly frame: PitchFrame | null
  readonly playback: Playback | null
  readonly board: Board | null
  readonly onScreen: ReadonlyArray<OnScreen>
  /** Every agent cue received, newest first. */
  readonly feed: ReadonlyArray<Cue>
}

export const EMPTY: PaneState = { frame: null, playback: null, board: null, onScreen: [], feed: [] }

/** At most this many agent cues stay in the feed. */
export const FEED_SIZE = 50

const boardOf = (cue: Cue): Board => {
  const d = cue.data
  const mom = d["team.mom.home"] !== undefined && d["team.mom.away"] !== undefined ? { home: d["team.mom.home"]!, away: d["team.mom.away"]! } : null
  return { score: { home: d["score.home"] ?? 0, away: d["score.away"] ?? 0 }, clock: cue.anchor.clock, momentum: mom }
}

export const reduce = (s: PaneState, tick: Tick, now: number): PaneState => {
  switch (tick.kind) {
    case "frame":
      return { ...s, frame: tick.frame }
    case "playback":
      return { ...s, playback: tick.playback }
    case "cue": {
      const cue = tick.cue
      if (cue.display.slot === "top_bar") return { ...s, board: boardOf(cue) }
      // A newer cue in the same slot replaces the one showing there; higher priority (1) first among the rest.
      const onScreen = [...s.onScreen.filter((o) => o.until > now && o.cue.display.slot !== cue.display.slot), { cue, until: now + cue.display.ttl_ms }]
      return { ...s, onScreen, feed: [cue, ...s.feed.filter((c) => c.cue_id !== cue.cue_id)].slice(0, FEED_SIZE) }
    }
  }
}

/** The cue showing in a slot now, if any. */
export const inSlot = (s: PaneState, slot: Cue["display"]["slot"], now: number): Cue | null =>
  s.onScreen.find((o) => o.cue.display.slot === slot && o.until > now)?.cue ?? null

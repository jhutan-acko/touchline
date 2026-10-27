/**
 * The match pulse: what the pane has seen of the match, kept as small series so a strip can show the whole match so far
 * (momentum, control versus chaos, key moments). Pure and client-side: built from the frames and cues the pane already
 * receives, never from anything later than the viewer's frame (`view` cuts the log at a frame; no spoilers).
 */
import type { PitchFrame, Tick } from "@touchline/rpc"
import type { Cue } from "@touchline/schema"

export type Side = "home" | "away"

/** One scoreboard cue's reading: the match minute (decimal) and each side's momentum share, null when the cue had none. */
export interface Sample {
  readonly frame: number
  readonly min: number
  readonly home: number | null
  readonly away: number | null
}
export interface Goal {
  readonly frame: number
  readonly min: number
  readonly team: Side
  readonly score: { readonly home: number; readonly away: number }
}
/** The ball changed hands: the side that now has it. */
export interface Change {
  readonly frame: number
  readonly min: number
  readonly team: Side
}
export interface PulseCue {
  readonly cue: Cue
  readonly frame: number
  readonly min: number
  /** The latest match frame known when it arrived (a view frozen earlier never shows it). */
  readonly arrivedAt: number
}

export interface PulseLog {
  readonly samples: ReadonlyArray<Sample>
  readonly goals: ReadonlyArray<Goal>
  readonly changes: ReadonlyArray<Change>
  readonly cues: ReadonlyArray<PulseCue>
  readonly holder: Side | null
  /** A side that has the ball now but has not yet held it for SUSTAIN_S (a contested ball flickers between sides). */
  readonly candidate: { readonly side: Side; readonly frame: number; readonly min: number } | null
  readonly score: { readonly home: number; readonly away: number } | null
  /** The newest frame seen and its minute. */
  readonly cursor: { readonly frame: number; readonly min: number } | null
  /** The minute the first frame seen was at (a match watched from minute 60 has nothing before it). */
  readonly firstMin: number | null
}

export const EMPTY_PULSE: PulseLog = { samples: [], goals: [], changes: [], cues: [], holder: null, candidate: null, score: null, cursor: null, firstMin: null }

/** A side "has the ball" when its nearest player is within this many metres of it (and the ball is not in the air). */
export const POSSESSION_RADIUS_M = 3
export const AIR_BALL_M = 3
/** Momentum is sampled at most this often (match seconds). */
export const SAMPLE_EVERY_S = 5
/** At most this many agent cues are kept for the strip. */
export const CUE_LIMIT = 200
/** A side must keep the ball this long (match seconds) before it counts as having taken it: a contested ball flickers. */
export const SUSTAIN_S = 2
/**
 * Control versus chaos: turnovers (the ball changing hands) per minute, within one-minute windows. Tuned on a library
 * match, where turnovers run about 1 to 8 a minute (average 4.6): the lowest third reads as control, the highest as chaos.
 */
export const CONTROL_MAX = 3
export const CHAOS_MIN = 6
/** A window is judged only when at least this much of it has been watched. */
export const MIN_COVER = 0.5

/** Minutes (decimal) from a clock such as "67:02" or "10:00.00", or null. */
export const minuteOf = (clock: string): number | null => {
  const m = /^(\d+):(\d+)/.exec(clock)
  return m ? Number(m[1]) + Number(m[2]) / 60 : null
}

const dist = (a: { x: number; y: number }, b: { x: number; y: number }) => Math.hypot(a.x - b.x, a.y - b.y)

/** The side with a player nearest the ball and within reach, or null (ball loose, in the air, or no players). */
export const holderOf = (f: PitchFrame): Side | null => {
  if (f.ball.z > AIR_BALL_M) return null
  let best: { side: Side; d: number } | null = null
  for (const [side, spots] of [["home", f.home], ["away", f.away]] as const)
    for (const p of spots) {
      const d = dist(p, f.ball)
      if (d <= POSSESSION_RADIUS_M && (!best || d < best.d)) best = { side, d }
    }
  return best?.side ?? null
}

/** Everything after `frame` dropped (a seek back replays from there). */
const truncate = (log: PulseLog, frame: number): PulseLog => ({
  ...log,
  samples: log.samples.filter((x) => x.frame <= frame),
  goals: log.goals.filter((x) => x.frame <= frame),
  changes: log.changes.filter((x) => x.frame <= frame),
  cues: log.cues.filter((x) => x.frame <= frame)
})

export const pulseReduce = (log: PulseLog, tick: Tick, fps: number): PulseLog => {
  if (tick.kind === "frame") {
    const f = tick.frame
    const min = minuteOf(f.clock)
    if (min === null) return log
    let l = log.cursor && f.frame < log.cursor.frame ? truncate(log, f.frame) : log
    const seen = holderOf(f)
    let { holder, candidate, changes } = l
    if (seen === null || seen === holder) candidate = null
    else if (holder === null) holder = seen // the first side seen with the ball is not a turnover
    else {
      if (candidate?.side !== seen) candidate = { side: seen, frame: f.frame, min }
      if (f.frame - candidate.frame >= SUSTAIN_S * fps) {
        changes = [...changes, { frame: candidate.frame, min: candidate.min, team: seen }]
        holder = seen
        candidate = null
      }
    }
    l = { ...l, changes, holder, candidate, cursor: { frame: f.frame, min }, firstMin: l.firstMin === null ? min : Math.min(l.firstMin, min) }
    return l
  }
  if (tick.kind !== "cue") return log
  const cue = tick.cue
  const min = minuteOf(cue.anchor.clock)
  const frame = cue.anchor.frame_to
  if (cue.display.slot === "top_bar") {
    if (min === null) return log
    const back = log.samples.length > 0 && frame < log.samples[log.samples.length - 1]!.frame
    let l = back ? { ...truncate(log, frame), score: null } : log
    const d = cue.data
    const score = { home: d["score.home"] ?? 0, away: d["score.away"] ?? 0 }
    // A goal is a score that went up since the last reading (the first reading only sets the baseline).
    const goals =
      l.score && (score.home > l.score.home || score.away > l.score.away)
        ? [...l.goals, { frame, min, team: score.home > l.score.home ? ("home" as const) : ("away" as const), score }]
        : l.goals
    const last = l.samples[l.samples.length - 1]
    const sample: Sample = { frame, min, home: d["team.mom.home"] ?? null, away: d["team.mom.away"] ?? null }
    const samples = !last || frame >= last.frame + SAMPLE_EVERY_S * fps ? [...l.samples, sample] : l.samples
    l = { ...l, goals, samples, score }
    return l
  }
  if (cue.display.slot === "pitch_marker" || min === null) return log
  const arrivedAt = log.cursor?.frame ?? frame
  const cues = [...log.cues.filter((c) => c.cue.cue_id !== cue.cue_id), { cue, frame, min, arrivedAt }].slice(-CUE_LIMIT)
  return { ...log, cues }
}

/** The log as a viewer at `upTo` (the newest frame, or the one frozen on) may see it: nothing later, no cue that arrived later. */
export const view = (log: PulseLog, upTo: number): PulseLog => ({
  ...log,
  samples: log.samples.filter((x) => x.frame <= upTo),
  goals: log.goals.filter((x) => x.frame <= upTo),
  changes: log.changes.filter((x) => x.frame <= upTo),
  cues: log.cues.filter((x) => x.frame <= upTo && x.arrivedAt <= upTo)
})

/** The match minute at a frame: the nearest reading at or before it; falls back to counting from the frame rate. */
export const minuteAt = (log: PulseLog, frame: number, fps: number): number => {
  if (log.cursor && frame >= log.cursor.frame) return log.cursor.min
  let best: { frame: number; min: number } | null = null
  for (const s of log.samples) if (s.frame <= frame) best = s
  return best ? best.min + (frame - best.frame) / fps / 60 : frame / fps / 60
}

export interface Point {
  readonly min: number
  /** Home momentum minus away momentum, -1..1 (positive: home on top). */
  readonly net: number
  readonly home: number
  readonly away: number
}
export const momentumSeries = (samples: ReadonlyArray<Sample>): Point[] =>
  samples.flatMap((s) => (s.home === null || s.away === null ? [] : [{ min: s.min, net: s.home - s.away, home: s.home, away: s.away }]))

/** The axis runs to 90 minutes, or further when the match has. */
export const axisMax = (upToMin: number): number => Math.max(90, Math.ceil(upToMin))

export type Rhythm = "control" | "mixed" | "chaos"
export interface Bin {
  readonly from: number
  readonly to: number
  readonly turnovers: number
  /** Turnovers per minute of the window that was watched. */
  readonly rate: number
  readonly state: Rhythm | null
}
export const rhythmOf = (rate: number): Rhythm => (rate <= CONTROL_MAX ? "control" : rate >= CHAOS_MIN ? "chaos" : "mixed")

/**
 * Control versus chaos, one-minute windows up to `upToMin`: few turnovers per minute is control (long spells with the
 * ball), many is chaos (it keeps changing hands), between is mixed. Windows mostly before the first frame watched are
 * left unjudged (state null).
 */
export const classify = (changes: ReadonlyArray<Change>, firstMin: number | null, upToMin: number): Bin[] => {
  if (firstMin === null) return []
  const bins: Bin[] = []
  for (let b = 0; b < Math.ceil(upToMin); b++) {
    const cover = Math.max(0, Math.min(b + 1, upToMin) - Math.max(b, firstMin))
    const turnovers = changes.filter((c) => c.min >= b && c.min < b + 1).length
    const rate = cover > 0 ? turnovers / cover : 0
    bins.push({ from: b, to: b + 1, turnovers, rate, state: cover >= MIN_COVER ? rhythmOf(rate) : null })
  }
  return bins
}

export type MomentKind = "goal" | "chance" | "swing" | "pressure" | "decision" | "pass" | "moment"
export interface Moment {
  readonly id: string
  readonly kind: MomentKind
  readonly frame: number
  readonly min: number
  readonly team: Side | null
  readonly cue: Cue | null
  readonly score: { readonly home: number; readonly away: number } | null
}

const KINDS: Record<string, MomentKind> = { goal: "goal", big_chance: "chance", momentum_swing: "swing", pressure_shift: "pressure", manager_decision: "decision", better_pass: "pass" }
export const kindOf = (template: string): MomentKind => KINDS[template] ?? "moment"

/**
 * The key moments on the strip, oldest first. Goals come from the score going up (so the side is known) and carry the
 * goal cue, when there is one within a minute, for "Why?". Casual viewers see goals only; analysts see every moment.
 */
export const moments = (log: PulseLog, mode: "casual" | "analyst"): Moment[] => {
  const goalCues = log.cues.filter((c) => c.cue.display.template === "goal")
  const used = new Set<string>()
  const out: Moment[] = log.goals.map((g, i) => {
    const near = goalCues.filter((c) => !used.has(c.cue.cue_id) && Math.abs(c.min - g.min) <= 1).sort((a, b) => Math.abs(a.min - g.min) - Math.abs(b.min - g.min))[0]
    if (near) used.add(near.cue.cue_id)
    return { id: `goal-${i}-${g.frame}`, kind: "goal", frame: g.frame, min: g.min, team: g.team, cue: near?.cue ?? null, score: g.score }
  })
  if (mode === "analyst")
    for (const c of log.cues) if (!used.has(c.cue.cue_id)) out.push({ id: c.cue.cue_id, kind: kindOf(c.cue.display.template), frame: c.frame, min: c.min, team: null, cue: c.cue, score: null })
  return out.sort((a, b) => a.frame - b.frame)
}

/** Whether a frame is still in the pane's ring buffer (so the viewer can freeze on it). */
export const inRing = (ring: ReadonlyArray<PitchFrame>, frame: number): boolean => ring.length > 0 && ring[0]!.frame <= frame && frame <= ring[ring.length - 1]!.frame

/** What clicking a moment does: pause there and ask, open the Why drawer for its cue, or nothing (too old and no cue). */
export const actionFor = (m: Moment, ring: ReadonlyArray<PitchFrame>): "freeze" | "why" | "none" => (inRing(ring, m.frame) ? "freeze" : m.cue ? "why" : "none")

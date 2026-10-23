/**
 * The what-if at any frame (pause-and-ask): fork the match at a frame, apply the viewer's change (a pass to another
 * teammate, a player standing elsewhere) and play it out over paired seeds against the match left alone. The single
 * source of the numbers an answer quotes. The real side of the clip stops at the paused frame (no spoilers); the
 * variant plays the typical seed on for the full horizon.
 */
import { createHash } from "node:crypto"
import { CLIP_BEFORE_S, clearlyBetter, MIN_VERDICT_SEEDS, typicalIndex, xtEndValue, type Session as AdvisorSession } from "@touchline/advisor"
import type { AskClip, PassVerdict } from "@touchline/rpc"
import type { AskIntent, AskInterventionSpec, AskWhatIf, FrameSummary } from "@touchline/schema"
import { applyIntervention, forkState, outcomeOf, playAheadFrames, whatIf, WhatIfError, type Intervention, type MatchState, type Side } from "@touchline/sim-core"
import type { XtGrid } from "@touchline/stats"
import { RECENT_S } from "./askframe.js"
import { rebuild, toPitchFrame } from "./whatif.js"

/** Paired seeds and seconds played out per ask. */
export const ASK_SEEDS = 20
export const ASK_HORIZON_S = 10

export interface AskClipRequest {
  /** The frame the change happens at: the variant is played from the state just before it. */
  readonly forkFrame: number
  /** The frame the viewer paused at: no real frame after it is shown. */
  readonly pausedFrame: number
  readonly intervention: AskInterventionSpec
}

/** The intervention's fixed text (keys in one order), hashed into the clip id. */
const interventionKey = (iv: AskInterventionSpec): string =>
  iv.kind === "pass_to" ? `pass_to|${iv.player_id}|${iv.receiver_id}` : `move_player|${iv.player_id}|${iv.to.x}|${iv.to.y}`

/** The clip's id: the same request always gives the same id. */
export const askClipId = (req: AskClipRequest): string => `${req.forkFrame}-${req.pausedFrame}-${createHash("sha256").update(interventionKey(req.intervention)).digest("hex").slice(0, 12)}`

const toIntervention = (iv: AskInterventionSpec): Intervention =>
  iv.kind === "pass_to" ? { kind: "pass_to", playerId: iv.player_id, receiverId: iv.receiver_id } : { kind: "move_player", playerId: iv.player_id, to: { x: iv.to.x, y: iv.to.y } }

/** The team whose outcome is measured: the team of the player the change is about. */
const sideOf = (s: MatchState, iv: AskInterventionSpec): Side => {
  const p = s.players.find((q) => q.id === iv.player_id)
  if (!p) throw new WhatIfError(`no player "${iv.player_id}" on the pitch at tick ${s.tick}`)
  return p.side
}

/**
 * The verdict by the shared rule (advisor clearlyBetter, one comparison): the alternative clearly better than what
 * happened, what happened clearly better than the alternative, or too close to call (also with too few seeds where the
 * forced pass was played).
 */
export const askVerdict = (diff: { readonly mean: number; readonly se: number }, seeds: number, applied: number): PassVerdict => {
  if (applied < MIN_VERDICT_SEEDS) return "not_verified"
  if (clearlyBetter(diff, seeds, 1)) return "better_option_found"
  if (clearlyBetter({ mean: -diff.mean, se: diff.se }, seeds, 1)) return "played_pass_was_best"
  return "not_verified"
}

/** The states a clip forking at `forkFrame` starts from: its lead-in's first state and the fork state. */
export const clipTicks = (dt: number, forkFrame: number): [start: number, fork: number] => {
  const fork = forkFrame - 1
  return [Math.max(-1, fork - Math.round(CLIP_BEFORE_S / dt)), fork]
}

/**
 * Every state an ask at `frame` may need: the frame summary's (the frame and the decision state of each recent pass)
 * and those of a clip forking at the frame or at any recent pass. Fetched in one replay when the viewer pauses, so a
 * question asked next costs only its seeds.
 */
export const askTicks = (session: AdvisorSession, frame: number): number[] => {
  const since = frame - Math.round(RECENT_S / session.cfg.dt)
  const passes = session.events.filter((e) => e.type === "pass" && e.frame_id >= since && Math.max(e.frame_id, e.frame_id_end ?? e.frame_id) <= frame)
  return [...new Set([frame, ...[frame, ...passes.map((e) => e.frame_id)].flatMap((f) => clipTicks(session.cfg.dt, f))])]
}

/**
 * Play the what-if on a rebuilt match (CPU only; throws AdvisorError for a frame past full time). An intervention that
 * cannot apply at the fork gives a clip with the real play only, `variant` null and verdict not_verified.
 */
export const askClipFrom = (session: AdvisorSession, xt: XtGrid, req: AskClipRequest): AskClip => {
  const { forkFrame, pausedFrame, intervention } = req
  if (!Number.isInteger(forkFrame) || !Number.isInteger(pausedFrame) || forkFrame < 0 || pausedFrame < forkFrame) throw new Error(`fork frame ${forkFrame} must be from 0 to the paused frame ${pausedFrame}`)
  const dt = session.cfg.dt
  const [start, fork] = clipTicks(dt, forkFrame)
  session.prefetch([start, fork])
  const real = playAheadFrames(session.stateAt(start), pausedFrame - start).frames
  const base = {
    clip_id: askClipId(req), fork_frame: forkFrame, paused_frame: pausedFrame, fps: Math.round(1 / dt), intervention,
    real: real.map((f) => toPitchFrame(f, dt)), horizon_s: ASK_HORIZON_S
  }
  const unapplied: AskClip = { ...base, verdict: "not_verified", variant: null, seeds: 0, typical_seed: null, shots: null, goals: null, gain: null }
  const state = session.stateAt(fork)
  const endValue = xtEndValue(xt)
  const alt = toIntervention(intervention)
  let side: Side
  let r: ReturnType<typeof whatIf>
  try {
    side = sideOf(state, intervention)
    r = whatIf(state, alt, { side, seeds: ASK_SEEDS, horizonS: ASK_HORIZON_S, endValue, baseline: { kind: "none" } })
  } catch (e) {
    if (e instanceof WhatIfError) return unapplied
    throw e
  }
  // The same paired seeds again, keeping each play's frames and counts (whatIf keeps only the averages).
  const ticks = Math.round(ASK_HORIZON_S / dt)
  const arm = (iv: Intervention) =>
    Array.from({ length: ASK_SEEDS }, (_, k) => {
      const run = playAheadFrames(applyIntervention(forkState(state, k), iv), ticks)
      return { outcome: outcomeOf(run.events, run.state, side, endValue), frames: run.frames }
    })
  const played = arm({ kind: "none" })
  const alts = arm(alt)
  const typical = typicalIndex(alts.map((a) => a.outcome.total))
  const count = (f: (o: (typeof played)[number]["outcome"]) => boolean) => ({ played: played.filter((a) => f(a.outcome)).length, alt: alts.filter((a) => f(a.outcome)).length })
  const lead = base.real.filter((f) => f.frame < forkFrame)
  const diff = r.difference.total
  return {
    ...base,
    verdict: askVerdict(diff, ASK_SEEDS, r.forced_applied.variant ?? ASK_SEEDS),
    variant: [...lead, ...alts[typical]!.frames.map((f) => toPitchFrame(f, dt))],
    seeds: ASK_SEEDS,
    typical_seed: typical,
    shots: count((o) => o.shots_for > 0),
    goals: count((o) => o.goal_diff > 0),
    gain: { mean: diff.mean, se: diff.se }
  }
}

/** Rebuild a run folder's match and play the what-if (askClipFrom; a few seconds, most of it the rebuild). */
export const computeAskClip = (dir: string, req: AskClipRequest): AskClip => {
  const { session, xt } = rebuild(dir)
  return askClipFrom(session, xt, req)
}

/** What the analyst is given of a clip (null when the intervention could not be applied). */
export const askWhatIfOf = (clip: AskClip): AskWhatIf | null =>
  clip.variant === null || clip.shots === null || clip.goals === null || clip.gain === null
    ? null
    : { intervention: clip.intervention, fork_frame: clip.fork_frame, verdict: clip.verdict, seeds: clip.seeds, shots: clip.shots, goals: clip.goals, gain: clip.gain }

/** Where an ask forks: at the pass the intent names when it is one of the summary's recent events, else at the paused frame. */
export const forkFrameOf = (summary: FrameSummary, intent: AskIntent): number =>
  summary.recent.find((r) => r.event_id === intent.fork_event_id)?.frame ?? summary.frame

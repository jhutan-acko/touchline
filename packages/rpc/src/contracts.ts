/**
 * The API's RPC contracts (spec §5.7), shared by the server (apps/api) and its clients (apps/web): match library,
 * playback sessions on the cue bus, evidence for the "Why?" drawer and recaps.
 */
import { Schema } from "effect"
import { Rpc, RpcGroup } from "effect/rpc"
import { AskArms, AskInterventionSpec, AskIntent, AskReply, AskStage, ClaimKind, Cue, Decision, Lang, MetricId, Moment, Recap, Segment } from "@touchline/schema"

const Id = Schema.String.check(Schema.isMinLength(1))
const Count = Schema.Int.check(Schema.isGreaterThanOrEqualTo(0))

export const Kit = Schema.Struct({ primary: Schema.String, secondary: Schema.String })

export const TeamBrief = Schema.Struct({
  id: Id,
  name: Schema.String,
  short: Schema.String,
  side: Schema.Literals(["home", "away"]),
  kit: Kit
})
export type TeamBrief = typeof TeamBrief.Type

export const Score = Schema.Struct({ home: Count, away: Count })

/** A match in the library: a simulated run folder, with its agents' cue cache when it has one. */
export const MatchSummary = Schema.Struct({
  match_id: Id,
  scenario: Schema.NullOr(Schema.String),
  seed: Schema.Int,
  home: TeamBrief,
  away: TeamBrief,
  /** The final score. */
  score: Score,
  fps: Schema.Int,
  /** The last frame (global tick) of the match. */
  frames: Count,
  /** Segment keys the cue cache has variants for (empty: no agent cues; the match plays with stats only). */
  segments: Schema.Array(Schema.String),
  /** What produced the cached cues ("stub", "openai:gpt-6.1-sol"), or null. */
  model: Schema.NullOr(Schema.String),
  /** A managed match's managers ("agent", "rules", "replay"; null: none for that team), or null for a plain match. */
  managers: Schema.NullOr(Schema.Struct({ home: Schema.NullOr(Schema.String), away: Schema.NullOr(Schema.String) }))
})
export type MatchSummary = typeof MatchSummary.Type

/** A squad member; `foot` is the preferred foot (the 3D view kicks with it). */
export const Player = Schema.Struct({ id: Id, team_id: Id, name: Schema.String, jersey: Schema.Int, role: Schema.String, foot: Schema.Literals(["left", "right"]) })
export type Player = typeof Player.Type

export const MatchInfo = Schema.Struct({ ...MatchSummary.fields, players: Schema.Array(Player) })
export type MatchInfo = typeof MatchInfo.Type

export const Spot = Schema.Struct({ id: Id, x: Schema.Finite, y: Schema.Finite })

/** Positions at one frame, in metres from the centre spot (x towards the away goal for the home side in the first half; reversed in the second). */
export const PitchFrame = Schema.Struct({
  frame: Count,
  period: Schema.Literals(["first_half", "second_half"]),
  clock: Schema.String,
  ball: Schema.Struct({ x: Schema.Finite, y: Schema.Finite, z: Schema.Finite }),
  home: Schema.Array(Spot),
  away: Schema.Array(Spot)
})
export type PitchFrame = typeof PitchFrame.Type

export const Playback = Schema.Struct({
  state: Schema.Literals(["playing", "paused", "ended"]),
  frame: Count,
  speed: Schema.Finite,
  live: Schema.Boolean
})
export type Playback = typeof Playback.Type

/**
 * An on-ball event as play reaches it (live stat tags, follow my player): sent on the Watch stream once playback has
 * reached `frame` (never earlier; no spoilers). `frame` is the frame the event is complete on (a pass on its arrival, a
 * shot on its resolution), so its outcome is known by then. Positions are in PitchFrame coordinates.
 */
export const BallEvent = Schema.Struct({
  id: Id,
  frame: Count,
  clock: Schema.String,
  type: Schema.Literals(["pass", "shot", "carry", "tackle", "interception", "clearance", "save"]),
  team: Schema.Literals(["home", "away"]),
  player_id: Id,
  /** A pass's intended or actual receiver, when known. */
  receiver_id: Schema.NullOr(Schema.String),
  outcome: Schema.NullOr(Schema.Literals(["success", "fail", "goal", "saved", "blocked", "off_target"])),
  x: Schema.Finite,
  y: Schema.Finite,
  x_end: Schema.NullOr(Schema.Finite),
  y_end: Schema.NullOr(Schema.Finite),
  /** A pass's or carry's length (m). */
  length_m: Schema.NullOr(Schema.Finite),
  /** A pass's modelled completion probability (packages/stats xPass); its difficulty is 1 − xpass. */
  xpass: Schema.NullOr(Schema.Finite),
  /** A shot's or pass's ball speed at release (km/h). */
  speed_kmh: Schema.NullOr(Schema.Finite),
  /** A shot's expected goals. */
  xg: Schema.NullOr(Schema.Finite)
})
export type BallEvent = typeof BallEvent.Type

/** What a watcher receives, in match order: frames, cues for its segment (stats cues and agent cues), on-ball events and playback state. */
export const Tick = Schema.Union([
  Schema.Struct({ kind: Schema.Literal("frame"), frame: PitchFrame }),
  Schema.Struct({ kind: Schema.Literal("cue"), cue: Cue }),
  Schema.Struct({ kind: Schema.Literal("playback"), playback: Playback }),
  Schema.Struct({ kind: Schema.Literal("event"), event: BallEvent })
])
export type Tick = typeof Tick.Type

export const EvidenceClaim = Schema.Struct({
  kind: ClaimKind,
  quote: Schema.String,
  /** What the number is, for people ("Pressure index"). */
  label: Schema.String,
  metric_id: Schema.NullOr(MetricId),
  subject: Schema.NullOr(Schema.String),
  subject_name: Schema.NullOr(Schema.String),
  value: Schema.NullOr(Schema.Finite),
  at_frame: Count,
  event_id: Schema.NullOr(Schema.String)
})
export type EvidenceClaim = typeof EvidenceClaim.Type

export const Series = Schema.Struct({
  metric_id: MetricId,
  subject: Schema.String,
  label: Schema.String,
  points: Schema.Array(Schema.Struct({ frame: Count, value: Schema.NullOr(Schema.Finite) }))
})
export type Series = typeof Series.Type

export const EvidenceEvent = Schema.Struct({
  id: Id,
  type: Schema.String,
  clock: Schema.String,
  team_id: Schema.NullOr(Schema.String),
  player: Schema.NullOr(Schema.String),
  outcome: Schema.NullOr(Schema.String),
  qualifiers: Schema.Record(Schema.String, Schema.Union([Schema.String, Schema.Boolean]))
})
export type EvidenceEvent = typeof EvidenceEvent.Type

export const PassVerdict = Schema.Literals(["played_pass_was_best", "better_option_found", "not_verified"])
export type PassVerdict = typeof PassVerdict.Type

/** A pass the cue says had a better option: the what-if split can show it; `verdict` once re-simulation has checked it (null: not yet). */
export const WhatIfRef = Schema.Struct({ event_id: Id, verdict: Schema.NullOr(PassVerdict) })
export type WhatIfRef = typeof WhatIfRef.Type

/** Behind a cue (spec §5.6 "Why?" drawer): the moment, the cause, each checked claim, metric history and the events. */
export const Evidence = Schema.Struct({
  cue_id: Id,
  moment: Schema.NullOr(Moment),
  cause: Schema.NullOr(Schema.String),
  explanation: Schema.NullOr(Schema.String),
  claims: Schema.Array(EvidenceClaim),
  series: Schema.Array(Series),
  events: Schema.Array(EvidenceEvent),
  model: Schema.NullOr(Schema.String),
  /** The pass a "better option" claim names, if any (the "Show me" button). */
  what_if: Schema.NullOr(WhatIfRef)
})
export type Evidence = typeof Evidence.Type

const Arms = Schema.Struct({ played: Count, better: Count })

/**
 * A pass as the match went and with the better option played (the what-if split): frames over the same ticks, the
 * same up to `pass_index`; the variant is the typical one of `seeds` re-simulations, and the counts are over all of them.
 */
export const WhatIfClip = Schema.Struct({
  event_id: Id,
  verdict: PassVerdict,
  passer_id: Id,
  played_to: Id,
  better_to: Schema.NullOr(Id),
  fps: Schema.Int,
  pass_index: Count,
  real: Schema.Array(PitchFrame),
  /** Null unless the verdict is better_option_found. */
  variant: Schema.NullOr(Schema.Array(PitchFrame)),
  seeds: Count,
  horizon_s: Schema.Finite,
  typical_seed: Schema.NullOr(Count),
  /** Seeds in which the team had a shot, and scored, after each pass. */
  shots: Schema.NullOr(Arms),
  goals: Schema.NullOr(Arms),
  /** The better option minus the pass played: xG created plus the threat left at the end (mean and standard error over the seeds). */
  gain: Schema.NullOr(Schema.Struct({ mean: Schema.Finite, se: Schema.Finite }))
})
export type WhatIfClip = typeof WhatIfClip.Type

export const RecapView = Schema.Struct({ recap: Schema.NullOr(Recap), cards: Schema.Array(Cue) })
export type RecapView = typeof RecapView.Type

export class MatchNotFound extends Schema.TaggedError<MatchNotFound>()("MatchNotFound", { match_id: Schema.String }) {}
export class SessionNotFound extends Schema.TaggedError<SessionNotFound>()("SessionNotFound", { session_id: Schema.String }) {}
export class EvidenceNotFound extends Schema.TaggedError<EvidenceNotFound>()("EvidenceNotFound", { cue_id: Schema.String }) {}
/** No what-if for this event: not a pass of the match, not reached yet, not re-simulatable, or it took too long. */
export class WhatIfNotAvailable extends Schema.TaggedError<WhatIfNotAvailable>()("WhatIfNotAvailable", { event_id: Schema.String, reason: Schema.String }) {}

/** Where a moment stands in the producer's queue: approved puts it in the presenter's talking points, on air sends it to graphics. */
export const QueueStatus = Schema.Literals(["pending", "approved", "held", "on_air"])
export type QueueStatus = typeof QueueStatus.Type

/** A moment in the studio queue (spec §5.6 studio console), as one producer's segment sees it. */
export const QueueItem = Schema.Struct({
  moment_id: Id,
  /** The frame the moment ends on, and its clock. */
  frame: Count,
  clock: Schema.String,
  status: QueueStatus,
  /** The variant that airs for the producer's segment (null when the agents wrote none for it). */
  cue: Schema.NullOr(Cue),
  /** Presenter talking points: the analyst text in the segment's language, then each checked fact. */
  points: Schema.Array(Schema.String),
  /** How many segment variants the agents wrote. */
  variants: Count
})
export type QueueItem = typeof QueueItem.Type

/** What the studio console receives: the queue (each change to an item), every agent cue as it arrives, and playback. */
export const StudioTick = Schema.Union([
  Schema.Struct({ kind: Schema.Literal("queue"), item: QueueItem }),
  Schema.Struct({ kind: Schema.Literal("cue"), cue: Cue }),
  Schema.Struct({ kind: Schema.Literal("playback"), playback: Playback })
])
export type StudioTick = typeof StudioTick.Type

export const StudioAction = Schema.Literals(["approve", "hold", "send"])
export type StudioAction = typeof StudioAction.Type

/** Percentiles of a set of measurements in milliseconds (null when there are none). */
export const Percentiles = Schema.Struct({ n: Count, p50: Schema.NullOr(Schema.Finite), p95: Schema.NullOr(Schema.Finite), max: Schema.NullOr(Schema.Finite) })
export type Percentiles = typeof Percentiles.Type

/**
 * Measurements against a latency budget (spec §2: p95 under the budget). `missed` counts answers that never came (a
 * request that failed or timed out): any miss is over budget. `ok` is null with neither measurements nor misses.
 */
export const Budget = Schema.Struct({ ...Percentiles.fields, missed: Count, budget_ms: Schema.Finite, ok: Schema.NullOr(Schema.Boolean) })
export type Budget = typeof Budget.Type

/** The ops view (spec §5.6): what the agents did for a session so far, and how fast the hot path and the agents were. */
export const OpsReport = Schema.Struct({
  session_id: Id,
  live: Schema.Boolean,
  /** Everything below is as of this frame. */
  frame: Count,
  models: Schema.Array(Schema.String),
  moments: Count,
  cues: Count,
  /** Fact-Checker verdicts (a retried draft counts once as retry, then as pass or drop). */
  fact_check: Schema.Struct({ pass: Count, retry: Count, drop: Count }),
  /** Agents that used their deterministic fallback, by agent. */
  fallbacks: Schema.Record(Schema.String, Count),
  /** Time each agent took per moment. */
  agents: Schema.Array(Schema.Struct({ agent: Schema.String, ...Percentiles.fields })),
  /** Requests to the agent service by outcome. */
  requests: Schema.Record(Schema.String, Count),
  late_cues: Count,
  unverified_cues: Count,
  latency: Schema.Struct({
    /** Event to scoreboard on the bus (budget 250 ms). */
    stats: Budget,
    /** Live: signal played to cue on the bus; recorded: request time when the cache was made (budget 4 s). */
    insight: Schema.Struct({ ...Budget.fields, source: Schema.Literals(["live", "recorded"]) })
  })
})
export type OpsReport = typeof OpsReport.Type

export class NotQueued extends Schema.TaggedError<NotQueued>()("NotQueued", { moment_id: Schema.String }) {}

/** A suggested question for the paused frame; `intent` is already classified, so asking it skips the intent step. */
export const QuestionChip = Schema.Struct({ chip_id: Id, text: Schema.String, intent: AskIntent })
export const AskClip = Schema.Struct({
  clip_id: Id,
  fork_frame: Count,
  paused_frame: Count,
  fps: Schema.Int,
  intervention: AskInterventionSpec,
  verdict: PassVerdict,
  /** Frames fork - CLIP_BEFORE_S ... paused_frame (never later). */
  real: Schema.Array(PitchFrame),
  /** Frames fork - CLIP_BEFORE_S ... fork + horizon of the typical seed; null when the intervention could not be applied. */
  variant: Schema.NullOr(Schema.Array(PitchFrame)),
  seeds: Count,
  horizon_s: Schema.Finite,
  typical_seed: Schema.NullOr(Count),
  shots: Schema.NullOr(AskArms),
  goals: Schema.NullOr(AskArms),
  gain: Schema.NullOr(Schema.Struct({ mean: Schema.Finite, se: Schema.Finite }))
})
export type AskClip = typeof AskClip.Type
export const AskAnswer = Schema.Struct({ ...AskReply.fields, ask_id: Id, frame: Count, clip_id: Schema.NullOr(Id), verdict: Schema.NullOr(PassVerdict), cached: Schema.Boolean })
export type AskAnswer = typeof AskAnswer.Type
export const AskUpdate = Schema.Union([
  Schema.Struct({ kind: Schema.Literal("stage"), stage: AskStage }),
  Schema.Struct({ kind: Schema.Literal("answer"), answer: AskAnswer }),
  Schema.Struct({ kind: Schema.Literal("failed"), reason: Schema.Literals(["offline", "timeout", "bad_frame"]), message: Schema.String })
])
export type AskUpdate = typeof AskUpdate.Type
export class AskNotAvailable extends Schema.TaggedError<AskNotAvailable>()("AskNotAvailable", { reason: Schema.String }) {}

export const MIN_SPEED = 0.25
export const MAX_SPEED = 64
const Speed = Schema.Finite.check(Schema.isGreaterThanOrEqualTo(MIN_SPEED), Schema.isLessThanOrEqualTo(MAX_SPEED))

export class TouchlineRpcs extends RpcGroup.make(
  Rpc.make("ListMatches", { success: Schema.Array(MatchSummary) }),
  Rpc.make("GetMatch", { payload: { match_id: Schema.String }, success: MatchInfo, error: MatchNotFound }),
  /** Start playing a match on the cue bus (spec §5.7 startMatch); every watcher of the session sees the same match time. */
  Rpc.make("StartSession", {
    payload: { match_id: Schema.String, speed: Speed, from_minute: Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 130 })), live: Schema.Boolean },
    success: Schema.Struct({ session_id: Id, match: MatchInfo }),
    error: MatchNotFound
  }),
  /** The session's frames and the cues for one segment (spec §5.7 subscribeCues). */
  Rpc.make("Watch", { payload: { session_id: Schema.String, segment: Segment }, success: Tick, error: SessionNotFound, stream: true }),
  Rpc.make("Control", {
    payload: { session_id: Schema.String, action: Schema.Literals(["play", "pause", "speed"]), speed: Schema.NullOr(Speed) },
    success: Playback,
    error: SessionNotFound
  }),
  /** What is behind a cue the session has shown (never past its frame; a live session's from its own agents). */
  Rpc.make("GetEvidence", { payload: { session_id: Schema.String, cue_id: Schema.String }, success: Evidence, error: Schema.Union([SessionNotFound, MatchNotFound, EvidenceNotFound]) }),
  /** A pass as it went and with its better option played (never past the session's frame). */
  Rpc.make("GetWhatIf", { payload: { session_id: Schema.String, event_id: Schema.String }, success: WhatIfClip, error: Schema.Union([SessionNotFound, MatchNotFound, WhatIfNotAvailable]) }),
  /** A recap once the session has reached its whistle (empty before). */
  Rpc.make("GetRecap", {
    payload: { session_id: Schema.String, kind: Schema.Literals(["half_time", "full_time"]), segment: Segment },
    success: RecapView,
    error: Schema.Union([SessionNotFound, MatchNotFound])
  }),
  /** The studio console's stream for one producer segment: the queue so far, then every change, raw cues and playback. */
  Rpc.make("StudioWatch", { payload: { session_id: Schema.String, segment: Segment }, success: StudioTick, error: SessionNotFound, stream: true }),
  /** A producer's decision on a queued moment; every studio console of the session sees the change. */
  Rpc.make("StudioAct", {
    payload: { session_id: Schema.String, moment_id: Schema.String, action: StudioAction },
    success: Schema.Struct({ moment_id: Id, status: QueueStatus }),
    error: Schema.Union([SessionNotFound, NotQueued])
  }),
  /** The broadcast graphics output for a segment: the scoreboard and the cues the producer sent, nothing else. */
  Rpc.make("WatchGraphics", { payload: { session_id: Schema.String, segment: Segment }, success: Tick, error: SessionNotFound, stream: true }),
  /** The session's ops numbers (spec §5.6 ops view), as of its frame. */
  Rpc.make("GetOps", { payload: { session_id: Schema.String }, success: OpsReport, error: SessionNotFound }),
  /** A managed match's manager decisions the session has reached (empty for a match without managers). */
  Rpc.make("GetDecisions", { payload: { session_id: Schema.String }, success: Schema.Array(Decision), error: SessionNotFound }),
  /** Questions worth asking at the paused frame, in the viewer's language. */
  Rpc.make("SuggestQuestions", { payload: { session_id: Schema.String, frame: Count, lang: Lang }, success: Schema.Array(QuestionChip), error: Schema.Union([SessionNotFound, AskNotAvailable]) }),
  /** Ask about the paused frame: stage updates, then the answer (never past the session's frame). */
  Rpc.make("Ask", { payload: { session_id: Schema.String, frame: Count, question: Schema.String, chip_id: Schema.NullOr(Schema.String), segment: Segment }, success: AskUpdate, error: SessionNotFound, stream: true }),
  /** The clip behind an answer: the real play and the what-if variant. */
  Rpc.make("GetAskClip", { payload: { session_id: Schema.String, clip_id: Schema.String }, success: AskClip, error: Schema.Union([SessionNotFound, AskNotAvailable]) })
) {}

/** A manager decision's cue and evidence key: `decision-<tick>-<side>` (the strip opens its card by it). */
export const decisionKey = (d: Pick<Decision, "tick" | "side">): string => `decision-${d.tick}-${d.side}`

export const decodeTick = Schema.decodeUnknownSync(Tick)
export const decodeStudioTick = Schema.decodeUnknownSync(StudioTick)

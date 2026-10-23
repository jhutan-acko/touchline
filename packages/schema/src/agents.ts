/**
 * Contracts between the agent service (Python, services/agents) and the TypeScript side (spec §4.1, §5.3–§5.5).
 * They are exported as JSON Schema (`pnpm --filter @touchline/schema json`), from which the agents' Pydantic models
 * are generated, and every A2A message and artifact is validated against them on both sides.
 */
import { Schema } from "effect"
import { ManageRequest, ManagerReply } from "./manager.js"
import { MetricId, Signal, SignalType } from "./stats.js"

const NonNegInt = Schema.Int.check(Schema.isGreaterThanOrEqualTo(0))
const Id = Schema.String.check(Schema.isMinLength(1))

export const Mode = Schema.Literals(["casual", "analyst"])
export const Lang = Schema.Literals(["en", "es", "hi"])

/** A profile collapsed to what changes the text (spec §5.5): generation scales with segments, not users. */
export const Segment = Schema.Struct({
  mode: Mode,
  lang: Lang,
  /** The club the text is framed for, or null for a neutral viewer. */
  club: Schema.NullOr(Id)
}).annotate({ identifier: "Segment" })
export type Segment = typeof Segment.Type

/** At most this many segments are active per match (spec §5.5). */
export const MAX_SEGMENTS = 12

/** The cache key of a segment's variants: `mode.lang.club` (`neutral` when there is no club). */
export const segmentKey = (s: Segment): string => `${s.mode}.${s.lang}.${s.club ?? "neutral"}`

/** A signal the Moment Detector promoted: what the agents explain and the cues anchor to. */
export const Moment = Schema.Struct({
  moment_id: Id,
  match_id: Id,
  type: SignalType,
  /** The signal that was promoted first, then any others of the same play it absorbed. */
  signal_ids: Schema.Array(Id).check(Schema.isMinLength(1)),
  /** Global tick at which the moment was raised (the lead signal's frame). */
  frame_id: NonNegInt,
  frame_from: NonNegInt,
  frame_to: NonNegInt,
  period: Schema.Literals(["first_half", "second_half"]),
  match_clock: Schema.String,
  team_id: Schema.NullOr(Id),
  player_id: Schema.NullOr(Id),
  salience: Schema.Finite,
  /** 1 is the most important (goals, red cards); 3 the least. */
  priority: Schema.Literals([1, 2, 3]),
  /** Who promoted it: the model, or the rule-based fallback. */
  source: Schema.Literals(["model", "rules"])
}).annotate({ identifier: "Moment" })
export type Moment = typeof Moment.Type

/**
 * One checkable statement inside a draft. `quote` is the text exactly as written in the sentence (e.g. "0.69",
 * "69%", "2-1", "67th"), so the Fact-Checker can tell declared numbers from undeclared ones.
 * - metric: `metric_id` for `subject` as of `at_frame` (over `window_s`) is `value`; checked with verify_claim.
 * - score: the score as of `at_frame` is `quote` (home-away).
 * - minute: the moment happened in minute `value`.
 * - event: event `event_id` happened by `at_frame` (and, if `subject` is a player id, by that player).
 * - better_option: at event `event_id` a pass to `receiver_id` was the better option (the decision record's rank 1).
 */
export const ClaimKind = Schema.Literals(["metric", "score", "minute", "event", "better_option", "what_if"])
export const Claim = Schema.Struct({
  kind: ClaimKind,
  /** Index of the sentence that states it: 0 is the headline, 1.. the body sentences. */
  sentence: NonNegInt,
  quote: Schema.String,
  metric_id: Schema.NullOr(MetricId),
  subject: Schema.NullOr(Id),
  value: Schema.NullOr(Schema.Finite),
  at_frame: NonNegInt,
  window_s: Schema.NullOr(Schema.Finite),
  event_id: Schema.NullOr(Id),
  receiver_id: Schema.NullOr(Id)
}).annotate({ identifier: "Claim" })
export type Claim = typeof Claim.Type

/** The Analyst's output: the cause it names and the claims that support it. */
export const Analysis = Schema.Struct({
  moment_id: Id,
  /** One short phrase naming the cause, e.g. "mis-hit pass under pressure", "sustained high press". */
  cause: Schema.String,
  /** Plain-language explanation in English (no numbers that are not also claims). */
  explanation: Schema.String,
  claims: Schema.Array(Claim)
}).annotate({ identifier: "Analysis" })
export type Analysis = typeof Analysis.Type

/** Narrated text in one language: sentence 0 is the headline, the rest the body; claims point at sentences by index. */
export const Draft = Schema.Struct({
  moment_id: Id,
  lang: Lang,
  sentences: Schema.Array(Schema.String).check(Schema.isMinLength(1)),
  claims: Schema.Array(Claim)
}).annotate({ identifier: "Draft" })
export type Draft = typeof Draft.Type

export const SentenceCheck = Schema.Struct({
  index: NonNegInt,
  verified: Schema.Boolean,
  reasons: Schema.Array(Schema.String)
}).annotate({ identifier: "SentenceCheck" })

/** The Fact-Checker's verdict on one draft: pass, ask for one retry, or drop the unverified sentences. */
export const Verdict = Schema.Struct({
  moment_id: Id,
  status: Schema.Literals(["pass", "retry", "drop"]),
  sentences: Schema.Array(SentenceCheck),
  claims_checked: NonNegInt,
  claims_verified: NonNegInt,
  /** Numbers found in the text that no claim declared (the model is asked to extract them). */
  undeclared: NonNegInt
}).annotate({ identifier: "Verdict" })
export type Verdict = typeof Verdict.Type

export const Slot = Schema.Literals(["top_bar", "lower_third", "side_panel", "pitch_marker", "recap_card"])

/** The overlay cue (spec §5.4), versioned so a third-party graphics renderer can consume it. */
export const Cue = Schema.Struct({
  cue_id: Id,
  schema: Schema.Literal("touchline.cue/1"),
  match_id: Id,
  /** The moment (or recap) it was made for; null for stats cues from the hot path. */
  moment_id: Schema.NullOr(Id),
  anchor: Schema.Struct({ frame_from: NonNegInt, frame_to: NonNegInt, clock: Schema.String }),
  display: Schema.Struct({
    slot: Slot,
    priority: Schema.Literals([1, 2, 3]),
    ttl_ms: Schema.Int.check(Schema.isGreaterThan(0)),
    template: Schema.String
  }),
  segment: Segment,
  text: Schema.NullOr(Schema.Struct({ headline: Schema.String, body: Schema.String })),
  data: Schema.Record(Schema.String, Schema.Finite),
  evidence: Schema.Array(Schema.String),
  verified: Schema.Boolean
}).annotate({ identifier: "Cue" })
export type Cue = typeof Cue.Type

/** A half-time or full-time recap (Recap Producer), fact-checked like a moment's draft. */
export const Recap = Schema.Struct({
  recap_id: Id,
  match_id: Id,
  kind: Schema.Literals(["half_time", "full_time"]),
  at_frame: NonNegInt,
  sentences: Schema.Array(Schema.String).check(Schema.isMinLength(1)),
  claims: Schema.Array(Claim),
  turning_points: Schema.Array(Id),
  player_of_match: Schema.NullOr(Id),
  verified: Schema.Boolean
}).annotate({ identifier: "Recap" })
export type Recap = typeof Recap.Type

/** What happened to one moment inside the workflow: the evaluation harness and the ops view read these. */
export const MomentTrace = Schema.Struct({
  moment: Moment,
  analysis: Analysis,
  /** The draft after the last retry, before unverified sentences were dropped. */
  draft: Draft,
  verdicts: Schema.Array(Verdict),
  /** Agents that used their deterministic fallback for this moment. */
  fallbacks: Schema.Array(Schema.String),
  cue_ids: Schema.Array(Id),
  timings_ms: Schema.Record(Schema.String, Schema.Finite),
  model: Schema.String
}).annotate({ identifier: "MomentTrace" })
export type MomentTrace = typeof MomentTrace.Type

/** Pause-and-ask (a viewer's question about the paused frame): the stages the answer goes through. */
export const AskStageName = Schema.Literals(["question", "analyst", "whatif", "factcheck", "personalise"])
export const AskVerdict = Schema.Literals(["played_pass_was_best", "better_option_found", "not_verified"])
export const AskInterventionSpec = Schema.Union([
  Schema.Struct({ kind: Schema.Literal("pass_to"), player_id: Id, receiver_id: Id }),
  Schema.Struct({ kind: Schema.Literal("move_player"), player_id: Id, to: Schema.Struct({ x: Schema.Finite, y: Schema.Finite }) })
]).annotate({ identifier: "AskInterventionSpec" })
export type AskInterventionSpec = typeof AskInterventionSpec.Type

export const AskIntent = Schema.Struct({
  kind: Schema.Literals(["explain", "what_if", "unsupported"]),
  subject_id: Schema.NullOr(Id),
  /** A past pass (in summary.recent) the what-if replays from; null forks at the paused frame. */
  fork_event_id: Schema.NullOr(Id),
  /** Non-null iff kind = what_if. */
  intervention: Schema.NullOr(AskInterventionSpec),
  /** Non-null iff kind = unsupported; in the viewer's language. */
  reason: Schema.NullOr(Schema.String)
}).annotate({ identifier: "AskIntent" })
export type AskIntent = typeof AskIntent.Type

export const FrameSummary = Schema.Struct({
  match_id: Id,
  frame: NonNegInt,
  clock: Schema.String,
  ball_holder: Schema.NullOr(Id),
  side_in_possession: Schema.NullOr(Schema.Literals(["home", "away"])),
  players: Schema.Array(Schema.Struct({ id: Id, name: Schema.String, side: Schema.Literals(["home", "away"]), role: Schema.String, x: Schema.Finite, y: Schema.Finite })),
  /** The holder's options, best first (sim-core passOptions), at most 5. */
  pass_options: Schema.Array(Schema.Struct({ receiver_id: Id, xpass: Schema.Finite, value: Schema.Finite })),
  /** Opponents within 5 m of the ball holder. */
  pressers: Schema.Array(Id),
  /** Events in the 10 s up to and including `frame`, newest first. */
  recent: Schema.Array(Schema.Struct({ event_id: Id, frame: NonNegInt, type: Schema.String, player_id: Schema.NullOr(Id), receiver_id: Schema.NullOr(Id) })),
  /** The newest pass by the side in possession (frame ≤ frame) re-scored at its own frame, when a different receiver had a higher value; null otherwise. */
  missed_option: Schema.NullOr(Schema.Struct({ event_id: Id, passer_id: Id, played_to: Id, better_to: Id }))
}).annotate({ identifier: "FrameSummary" })
export type FrameSummary = typeof FrameSummary.Type

export const AskArms = Schema.Struct({ played: NonNegInt, alt: NonNegInt }).annotate({ identifier: "AskArms" })
export type AskArms = typeof AskArms.Type

export const AskWhatIf = Schema.Struct({
  intervention: AskInterventionSpec,
  fork_frame: NonNegInt,
  verdict: AskVerdict,
  seeds: NonNegInt,
  shots: AskArms,
  goals: AskArms,
  gain: Schema.Struct({ mean: Schema.Finite, se: Schema.Finite })
}).annotate({ identifier: "AskWhatIf" })
export type AskWhatIf = typeof AskWhatIf.Type

/** Step 1 of an ask: classify the viewer's question into an intent. */
export const AskIntentRequest = Schema.Struct({ kind: Schema.Literal("ask_intent"), question: Schema.String, lang: Lang, summary: FrameSummary }).annotate({ identifier: "AskIntentRequest" })

/** Step 2: answer it, with the what-if the API ran (null for an explain). */
export const AskAnswerRequest = Schema.Struct({
  kind: Schema.Literal("ask_answer"),
  match_id: Id,
  mcp_url: Schema.String,
  at_frame: NonNegInt,
  question: Schema.String,
  segment: Segment,
  intent: AskIntent,
  summary: FrameSummary,
  what_if: Schema.NullOr(AskWhatIf)
}).annotate({ identifier: "AskAnswerRequest" })

export const AskStage = Schema.Struct({ stage: AskStageName, status: Schema.String }).annotate({ identifier: "AskStage" })
export type AskStage = typeof AskStage.Type

export const EvidenceChip = Schema.Struct({ label: Schema.String, value: Schema.String, source: Schema.Literals(["stats", "what_if", "event"]) }).annotate({ identifier: "EvidenceChip" })
export const AskReply = Schema.Struct({
  headline: Schema.String,
  body: Schema.String,
  chips: Schema.Array(EvidenceChip).check(Schema.isMaxLength(4)),
  verified: Schema.Boolean,
  model: Schema.NullOr(Schema.String)
}).annotate({ identifier: "AskReply" })
export type AskReply = typeof AskReply.Type

const Base = {
  match_id: Id,
  /** The MCP stats server for this match (Streamable HTTP); the agent service only accepts loopback or allowed hosts. */
  mcp_url: Schema.String,
  segments: Schema.Array(Segment).check(Schema.isMinLength(1), Schema.isMaxLength(MAX_SEGMENTS))
}

/** New signals for a match, oldest first, as of `now_frame`. */
export const SignalsRequest = Schema.Struct({
  kind: Schema.Literal("signals"),
  ...Base,
  now_frame: NonNegInt,
  signals: Schema.Array(Signal)
}).annotate({ identifier: "SignalsRequest" })

export const RecapRequest = Schema.Struct({
  kind: Schema.Literal("recap"),
  ...Base,
  recap: Schema.Literals(["half_time", "full_time"]),
  at_frame: NonNegInt
}).annotate({ identifier: "RecapRequest" })

/** The data part of every A2A message the gateway sends. */
export const AgentRequest = Schema.Union([SignalsRequest, RecapRequest, ManageRequest, AskIntentRequest, AskAnswerRequest]).annotate({ identifier: "AgentRequest" })
export type AgentRequest = typeof AgentRequest.Type
/** The requests of a match's commentary timeline (the gateway's batches and recaps). */
export type MatchRequest = typeof SignalsRequest.Type | typeof RecapRequest.Type

/** A2A artifact names and the contract each one carries. */
export const ARTIFACTS = { cue: Cue, trace: MomentTrace, recap: Recap, manager: ManagerReply, ask_intent: AskIntent, ask_stage: AskStage, ask_reply: AskReply } as const

/** All contracts in one document (the JSON Schema export's root). */
export const AgentContracts = Schema.Struct({
  signal: Signal,
  moment: Moment,
  claim: Claim,
  analysis: Analysis,
  draft: Draft,
  verdict: Verdict,
  cue: Cue,
  recap: Recap,
  trace: MomentTrace,
  request: AgentRequest,
  manager_reply: ManagerReply,
  ask_intent: AskIntent,
  ask_stage: AskStage,
  ask_reply: AskReply
}).annotate({ identifier: "AgentContracts" })

export const decodeCue = Schema.decodeUnknownSync(Cue)
export const decodeMomentTrace = Schema.decodeUnknownSync(MomentTrace)
export const decodeRecap = Schema.decodeUnknownSync(Recap)
export const decodeAgentRequest = Schema.decodeUnknownSync(AgentRequest)

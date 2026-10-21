import type { Period, Side, Vec2, Vec3 } from "./geometry.js"
import type { Params, PosGroup, ShapeRow } from "./params.js"
import type { RngState } from "./rng.js"
import type { Script, ScriptEntry } from "./script.js"
import type { SetPieceKind } from "./setpiece.js"

export type Role = "GK" | "CB" | "FB" | "DM" | "CM" | "AM" | "W" | "ST"
export type FormationName = "4-3-3" | "4-4-2" | "4-2-3-1" | "3-5-2"
export type { Period } from "./geometry.js"

/** All attributes are 0..1. */
export interface PlayerAttrs {
  readonly pace: number
  readonly acceleration: number
  readonly shortPassing: number
  readonly longPassing: number
  readonly vision: number
  readonly crossing: number
  readonly dribbling: number
  readonly finishing: number
  readonly heading: number
  readonly tackling: number
  readonly composure: number
  readonly stamina: number
  readonly handling: number
  readonly reflexes: number
}

export interface TeamStyle {
  readonly archetype: "high_press" | "possession" | "direct" | "low_block"
  /** 0..1, drives press trigger rate (target PPDA). */
  readonly pressIntensity: number
  /** -1 (deep) .. 1 (high). */
  readonly lineHeight: number
  /** 0..1, higher = narrower block. */
  readonly compactness: number
  readonly tempo: number
  /** -1..1 bias on long passes. */
  readonly longBallBias: number
  readonly crossBias: number
  readonly riskTolerance: number
}

export type Foot = "left" | "right"

export interface PlayerSetup {
  readonly id: string
  readonly role: Role
  readonly jersey: number
  readonly attrs: PlayerAttrs
  /** Stronger foot; right when not given. */
  readonly preferredFoot?: Foot
}

export interface TeamSetup {
  readonly id: string
  readonly name: string
  readonly formation: FormationName
  readonly style: TeamStyle
  /** Exactly 11 starters in formation slot order; slot 0 is the goalkeeper. */
  readonly starters: ReadonlyArray<PlayerSetup>
  /** Substitutes available to come on (none when absent). */
  readonly bench?: ReadonlyArray<PlayerSetup>
}

export interface MatchConfig {
  readonly matchId: string
  readonly seed: number
  readonly kickoffTime: string
  readonly home: TeamSetup
  readonly away: TeamSetup
  readonly params: Params
  /** Seconds per tick; 0.1 for 10 Hz, 0.04 for 25 Hz render runs. */
  readonly dt: number
  /** Scenario script whose nudges apply inside their windows (none when absent). */
  readonly script?: Script
  /** Teams whose manager decides their substitutions (orders.ts); they make no automatic ones. */
  readonly managed?: ReadonlyArray<Side>
}

export type Intent =
  | { readonly kind: "shape" }
  | { readonly kind: "press"; readonly targetId: string }
  | { readonly kind: "run_in_behind"; readonly target: Vec2; readonly overlap?: true }
  | { readonly kind: "chase"; readonly target: Vec2 }
  | { readonly kind: "carry"; readonly dir: Vec2; readonly speed: number }
  | { readonly kind: "hold" }
  /** A4 recovery run (realism v2 P4): back to his out-of-possession shape spot after a loss. */
  | { readonly kind: "recover"; readonly target: Vec2 }
  /** A6 rotation (realism v2 P5): a held spot (winger inside, full-back inversion, CM drop), jogged to. */
  | { readonly kind: "rotate"; readonly target: Vec2; readonly since: number }

export interface PlayerState {
  readonly id: string
  readonly side: Side
  readonly role: Role
  readonly slot: number
  readonly jersey: number
  readonly attrs: PlayerAttrs
  readonly foot: Foot
  readonly pos: Vec2
  readonly vel: Vec2
  readonly intent: Intent
  /** Global tick at which the current intent expires. */
  readonly intentUntil: number
  /** 1 = fresh, 0 = exhausted. */
  readonly energy: number
  readonly yellow: number
  readonly sentOff: boolean
}

export interface BallState {
  readonly pos: Vec3
  readonly vel: Vec3
  /** Spin about the horizontal axis across the ball's path (rad/s, topspin positive); absent means none. */
  readonly spin?: number
}

export type ActionKind = "pass" | "shot" | "clearance" | "deflection"

/** A ball in flight whose outcome was resolved at release (see resolve.ts and shot.ts). */
export interface Flight {
  readonly kind: ActionKind
  readonly fromId: string
  readonly side: Side
  readonly releaseTick: number
  readonly resolveTick: number
  /** Player who gains the ball at resolveTick, or null when it goes out / stops loose. */
  readonly winnerId: string | null
  readonly outcome: FlightOutcome
  /** Main event (pass / shot / clearance), emitted at resolution with frame_id = releaseTick. */
  readonly pending: PendingEvent
  /** Events emitted right after the main one (reception, interception, goal, keeper_save, ...). */
  readonly extra: ReadonlyArray<PendingEvent>
  /** Straight-line path for shots; null means the ball follows stepBall physics. */
  readonly path: { readonly from: Vec3; readonly to: Vec3 } | null
  /** Restart that follows the resolution (ball out, offside, goal), if any. */
  readonly restartAfter: { readonly restart: RestartKind; readonly side: Side; readonly at: Vec2 } | null
  /** Ball state to set after resolution when the ball stays live but loose (parry, block). */
  readonly looseBall: BallState | null
  /** After resolution the ball is deflected straight out over the goal line to this point (a corner). */
  readonly deflectTo: Vec3 | null
  /** An aerial foul decided at release (realism v2 P4, aerial seam), applied at resolution; absent: none. */
  readonly foul?: FlightFoul
}

/** The kinds of foul (realism v2 P4): attrs.kind of a foul event. */
export type FoulKind = "tackle" | "take_on" | "shielding" | "aerial"

/** An aerial foul carried by a flight (P4): offender, victim, the contact point, and the offender's yellows at release. */
export interface FlightFoul {
  readonly offenderId: string
  readonly victimId: string
  readonly at: Vec2
  readonly offenderYellow: number
}

export type FlightOutcome =
  | "successful"
  | "intercepted"
  | "out_of_play"
  | "offside"
  | "loose"
  | "goal"
  | "saved"
  | "blocked"
  | "wide"

export type Possession =
  | { readonly kind: "owned"; readonly playerId: string; readonly since: number; readonly restart: RestartKind | null; readonly inHands?: boolean; readonly holdTicks?: number }
  | { readonly kind: "in_flight"; readonly flight: Flight }
  /** A loose ball; after a bad first touch the toucher cannot play it again until `noTouchUntil` (global tick). */
  | { readonly kind: "loose"; readonly noTouchId?: string; readonly noTouchUntil?: number }
  | { readonly kind: "dead" }

export type RestartKind = "kickoff" | "throw_in" | "corner" | "goal_kick" | "free_kick" | "penalty"

export type Phase =
  | { readonly kind: "open_play" }
  | {
      readonly kind: "restart"
      readonly restart: RestartKind
      readonly side: Side
      readonly at: Vec2
      readonly resumeTick: number
    }
  | { readonly kind: "full_time" }

export type EventType =
  | "match_start"
  | "period_start"
  | "period_end"
  | "match_end"
  | "pass"
  | "reception"
  | "carry"
  | "take_on"
  | "shot"
  | "goal"
  | "keeper_save"
  | "keeper_distribution"
  | "keeper_claim"
  | "keeper_punch"
  | "aerial_duel"
  | "pressure"
  | "tackle"
  | "interception"
  | "block"
  | "clearance"
  | "ball_recovery"
  | "possession_change"
  | "ball_out"
  | "foul"
  | "card"
  | "offside"
  | "set_piece"
  | "off_ball_run"
  | "substitution"
  | "ground_duel"

/** One alternative the player could have chosen, recorded at the moment of decision. */
export interface OptionRecord {
  readonly action: string
  readonly receiver_id: string
  readonly kind: string
  readonly target_x: number
  readonly target_y: number
  readonly xpass: number
  readonly value: number
}

export type AttrValue =
  | string
  | number
  | boolean
  | null
  | ReadonlyArray<string>
  | ReadonlyArray<OptionRecord>
  | Readonly<Record<string, number>>

export interface DomainEvent {
  readonly id: string
  readonly match_id: string
  readonly type: EventType
  /** Global tick (counts across periods). */
  readonly frame_id: number
  /** CDF frame id (restarts at 0 each period). */
  readonly period_frame_id: number
  readonly period: Period
  readonly match_clock: string
  readonly team_id: string | null
  readonly player_id: string | null
  readonly x: number | null
  readonly y: number | null
  readonly x_end: number | null
  readonly y_end: number | null
  readonly frame_id_end: number | null
  readonly outcome: string | null
  readonly source: "sim"
  readonly confidence: 1
  readonly attrs: Readonly<Record<string, AttrValue>>
}

/** Event under construction, emitted later (flights) or immediately. */
export interface PendingEvent {
  readonly type: EventType
  readonly frame_id: number
  readonly team_id: string | null
  readonly player_id: string | null
  readonly x: number | null
  readonly y: number | null
  readonly x_end: number | null
  readonly y_end: number | null
  readonly attrs: Readonly<Record<string, AttrValue>>
}

export interface FramePlayer {
  readonly id: string
  readonly x: number
  readonly y: number
  /** Speed in m/s (CDF "vel"). */
  readonly vel: number
  /** What the player is doing this frame: the intent kind, or "on_ball" for the ball carrier. */
  readonly intent: Intent["kind"] | "on_ball"
}

export interface Frame {
  /** Global tick. */
  readonly tick: number
  /** CDF frame id (restarts at 0 each period). */
  readonly frame_id: number
  readonly period: Period
  readonly timestamp: string
  readonly home: ReadonlyArray<FramePlayer>
  readonly away: ReadonlyArray<FramePlayer>
  readonly ball: Vec3
  readonly ball_in_play: boolean
  readonly possession_side: Side | null
}

export const CONCERNS = ["decision", "execution", "duel", "referee", "movement", "restart", "script", "bench", "keeper", "caution", "drift", "boot", "release", "foul", "aerial", "counter", "press", "contact", "setpiece", "dead", "roles"] as const
export type Concern = (typeof CONCERNS)[number]

/** One team's substitutions: planned windows (match minutes) still to come, changes made, windows used, bench players used. */
export interface SubsState {
  readonly plan: ReadonlyArray<{ readonly minute: number; readonly players: number }>
  readonly made: number
  readonly windows: number
  readonly used: ReadonlyArray<string>
}

/**
 * Weights over the spots a team blends between (they sum to 1): the three table rows, and outK, the "out" row with its
 * depth capped at positioning.vsKeeperCapU while the other team's keeper has the ball.
 */
export interface RowMix { readonly in: number; readonly out: number; readonly gk: number; readonly outK: number }

/** One team's positioning state (realism v2, P2): its row, the row it is blending out of since `since`, and its team-common drift. */
export interface TeamShapeState {
  readonly row: ShapeRow
  readonly prev: ShapeRow
  /** Global tick of the last row switch. */
  readonly since: number
  /** Team-common drift in the team frame (u along the attack, y toward the team's left when attacking), metres. */
  readonly drift: { readonly u: number; readonly y: number }
  /** The raw OU behind the smoothed team drift (drift.ts smoothOuStep); absent: equal to `drift`. */
  readonly driftRaw?: { readonly u: number; readonly y: number }
  /** The row is "out" and the other team's keeper has the ball: the target is outK (absent: false). */
  readonly capped?: boolean
  /**
   * Per group, where the blend stood at the last switch (depth u and lateral y mixes); the new blend starts from there,
   * so a flip partway through a blend is continuous. Absent: the blend starts from `prev` alone.
   */
  readonly start?: Readonly<Record<PosGroup, { readonly u: RowMix; readonly y: RowMix }>>
}

/** One outfield player's drift in the team frame: match offsets with and without the ball, and a slow drift. s is + toward his own touchline (y_team for central slots). */
export interface PlayerDriftState {
  readonly offIn: { readonly u: number; readonly s: number }
  readonly offOut: { readonly u: number; readonly s: number }
  readonly slow: { readonly u: number; readonly s: number }
  /** The raw OU behind the smoothed slow drift (drift.ts smoothOuStep); absent: equal to `slow`. */
  readonly raw?: { readonly u: number; readonly s: number }
}

/** Positioning state (P2): the ball over the last positioning.ballLagS seconds, each team's row and drift, each outfielder's drift. */
export interface AnchorState {
  /** The ball's flat position at each of the last round(ballLagS / dt) + 1 ticks, oldest first. */
  readonly ballLag: ReadonlyArray<Vec2>
  readonly teams: Readonly<Record<Side, TeamShapeState>>
  readonly players: Readonly<Record<string, PlayerDriftState>>
  /** A side that has won the ball but not yet held it for positioning.commitS (the rows keep the old side), and since when. */
  readonly pending?: { readonly side: Side; readonly since: number }
  /** The period the ball ring was last filled in (a new period refills it). */
  readonly period?: Period
}

/** A what-if instruction: at their next decision, this player plays the pass to `receiverId` (see whatif.ts). */
export interface PassOverride {
  readonly playerId: string
  readonly receiverId: string
  /** The kind of pass (short, through, ...); the best-valued kind to that receiver when absent. */
  readonly kind?: string
  /** The last tick the override may be used at; after it the override is dropped, played or not. */
  readonly untilTick: number
}

export interface MatchState {
  readonly config: MatchConfig
  readonly tick: number
  readonly period: Period
  readonly periodTick: number
  readonly periodTicks: number
  readonly periodStartMs: number
  readonly phase: Phase
  readonly ball: BallState
  readonly possession: Possession
  readonly players: ReadonlyArray<PlayerState>
  readonly score: { readonly home: number; readonly away: number }
  readonly lastTouch: { readonly playerId: string; readonly side: Side } | null
  readonly pressedBy: ReadonlyArray<string>
  /** Carry in progress (start point and tick), to emit a carry event when it ends. */
  readonly carry: {
    readonly playerId: string
    readonly at: Vec2
    readonly tick: number
    /** Decision record copied onto the carry event when it ends. */
    readonly decision: Readonly<Record<string, AttrValue>>
  } | null
  readonly subs: Readonly<Record<Side, SubsState>>
  /** Script entries whose outcome is forced on the team's next qualifying action (set by the scenario runner). */
  readonly forced: ReadonlyArray<ScriptEntry>
  /** Goals scored so far inside each script entry's window (index-aligned with config.script.entries). */
  readonly scriptGoals: ReadonlyArray<number>
  readonly rng: Readonly<Record<Concern, RngState>>
  readonly eventSeq: number
  /** A pass to force at the player's next decision (what-if forks only; absent in played matches). */
  readonly override?: PassOverride
  /** Substitutions a manager ordered, made at the start of the next tick (orders.ts). */
  readonly subOrders?: Readonly<Partial<Record<Side, ReadonlyArray<{ readonly off: string; readonly on: string }>>>>
  /** Positioning state; absent while params positioning.rule is 0 (the old template). */
  readonly anchor?: AnchorState
  /** Recent high-intensity metres per player (fatigue.tiring); absent while it is 0. */
  readonly load?: Readonly<Record<string, number>>
  /** Support rule 1 pressure gate for the current carrier (hysteresis); absent while support.rule is 0 or nobody has the ball. */
  readonly supportGate?: SupportGate
  /** A4 transition after the last live-play loss (realism v2 P4); absent while transition.rule is 0 or none is live. */
  readonly transition?: TransitionState
  /** A5 team-press state (realism v2 P4); absent while press.rule is 0. */
  readonly press?: PressState
  /** P5 plan for the restart being set up (realism v2 P5); absent while every P5 rule that plans one is 0, or in open play. */
  readonly restartPlan?: RestartPlan
  /** P5: the set piece just taken (realism v2 P5, the attacking set-piece seam); absent while setAttack.rule is 0 or none is live. */
  readonly setPiece?: SetPieceLive
}

/**
 * P5 (plan 8e): what the P5 seams decided at a restart's start, read until the kick. Every field but `kind` belongs to
 * one seam: dead-ball (readyTick, walkMps, arrivedTick, arrivedId, pauseTicks), keeper-restart (keeperTaker), attacking set-piece
 * (restKeep, restSpot), defending set-piece (wall, jitter, outlet). Ids that have left the pitch since are skipped.
 */
export interface RestartPlan {
  readonly kind: SetPieceKind
  /** S8: per player, the tick he should be settled by. */
  readonly readyTick?: Readonly<Record<string, number>>
  /** S8: per player, his walking speed (m/s). */
  readonly walkMps?: Readonly<Record<string, number>>
  /** S8: the tick the taker first stood within 1 m of the spot, and who he was (a new taker restarts the pause). */
  readonly arrivedTick?: number
  readonly arrivedId?: string
  /** S8: how long the taker pauses on the spot before the kick (ticks). */
  readonly pauseTicks?: number
  /** S4: the players kept back in rest defence, and their spots. */
  readonly restKeep?: ReadonlyArray<string>
  readonly restSpot?: Readonly<Record<string, Vec2>>
  /** G3: the keeper takes this free kick. */
  readonly keeperTaker?: boolean
  /** S3: the wall's members, and each one's jitter toward the ball (m). */
  readonly wall?: ReadonlyArray<string>
  readonly jitter?: Readonly<Record<string, number>>
  /** S2: the striker left up as an outlet at a wide free kick. */
  readonly outlet?: string
}

/** P5 (plan 8e): a set piece just taken: its kind, the taking side, the kick's tick and the taker (the run window). */
export interface SetPieceLive {
  readonly kind: SetPieceKind
  readonly side: Side
  readonly tick: number
  readonly takerId: string
  /** S4: the rest-defence players (copied from the plan at the kick), whom the run after the kick leaves back. */
  readonly restKeep?: ReadonlyArray<string>
}

/** A4 (P4): the side that lost the ball, when and where, and who counter-presses. */
export interface TransitionState {
  readonly loser: Side
  readonly tick: number
  readonly at: Vec2
  readonly joiners: ReadonlyArray<string>
  /** P5 pause (plan 8e ruling 20): each losing outfielder's speed at the loss (m/s); absent while transition.pauseRule is 0. */
  readonly speeds?: Readonly<Record<string, number>>
}

/** A5 (P4): the last completed reception (back-to-goal trigger) and the second-presser draw for the current first press. */
export interface PressState {
  readonly reception: { readonly playerId: string; readonly tick: number; readonly ballMps: number } | null
  readonly secondFor: string | null
  readonly secondId: string | null
}

/** Whether support rule 1 counts the carrier as pressed, and for which carrier that was judged. */
export interface SupportGate {
  readonly carrierId: string
  readonly pressed: boolean
  /** Tick the gate last changed (or was judged afresh for this carrier): it holds for support.gateHoldS after that. */
  readonly sinceTick: number
}

export interface StepResult {
  readonly state: MatchState
  readonly frame: Frame | null
  readonly events: ReadonlyArray<DomainEvent>
}

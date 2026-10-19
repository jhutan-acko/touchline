import { Schema } from "effect"

export const EventType = Schema.Literals([
  "match_start", "period_start", "period_end", "match_end", "pass", "reception", "carry", "take_on", "shot", "goal",
  "keeper_save", "keeper_distribution", "keeper_claim", "keeper_punch", "aerial_duel", "pressure", "tackle", "interception", "block", "clearance",
  "ball_recovery", "possession_change", "ball_out", "foul", "card", "offside", "set_piece", "off_ball_run", "substitution", "ground_duel"
])
export const Period = Schema.Literals(["first_half", "second_half"])
export const OptionRecord = Schema.Struct({
  action: Schema.String,
  receiver_id: Schema.String,
  kind: Schema.String,
  target_x: Schema.Finite,
  target_y: Schema.Finite,
  xpass: Schema.Finite,
  value: Schema.Finite
})
export const AttrValue = Schema.Union([
  Schema.String,
  Schema.Number,
  Schema.Boolean,
  Schema.Null,
  Schema.Array(Schema.String),
  Schema.Array(OptionRecord),
  Schema.Record(Schema.String, Schema.Finite)
])

export const DomainEvent = Schema.Struct({
  id: Schema.String,
  match_id: Schema.String,
  type: EventType,
  frame_id: Schema.Int,
  period_frame_id: Schema.Int,
  period: Period,
  match_clock: Schema.String,
  team_id: Schema.NullOr(Schema.String),
  player_id: Schema.NullOr(Schema.String),
  x: Schema.NullOr(Schema.Finite),
  y: Schema.NullOr(Schema.Finite),
  x_end: Schema.NullOr(Schema.Finite),
  y_end: Schema.NullOr(Schema.Finite),
  frame_id_end: Schema.NullOr(Schema.Int),
  outcome: Schema.NullOr(Schema.String),
  source: Schema.Literals(["sim", "replay", "vision"]),
  confidence: Schema.Finite,
  attrs: Schema.Record(Schema.String, AttrValue)
})
export type DomainEvent = typeof DomainEvent.Type

export const Intent = Schema.Literals(["shape", "press", "run_in_behind", "chase", "carry", "hold", "on_ball", "recover", "rotate"])
const FramePlayer = Schema.Struct({ id: Schema.String, x: Schema.Finite, y: Schema.Finite, vel: Schema.Finite, intent: Intent })
export const Frame = Schema.Struct({
  tick: Schema.Int,
  frame_id: Schema.Int,
  period: Period,
  timestamp: Schema.String,
  home: Schema.Array(FramePlayer),
  away: Schema.Array(FramePlayer),
  ball: Schema.Struct({ x: Schema.Finite, y: Schema.Finite, z: Schema.Finite }),
  ball_in_play: Schema.Boolean,
  possession_side: Schema.NullOr(Schema.Literals(["home", "away"]))
})
export type Frame = typeof Frame.Type

export const decodeDomainEvent = Schema.decodeUnknownSync(DomainEvent)
export const decodeFrame = Schema.decodeUnknownSync(Frame)

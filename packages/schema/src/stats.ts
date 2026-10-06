import { Schema } from "effect"

/** Stable metric ids (spec §5.2); agents cite them in every numeric claim. */
export const MetricId = Schema.Literals([
  "pass.dist", "pass.acc", "pass.xp", "ball.speed", "shot.speed", "plyr.vmax", "plyr.dist", "shot.xg",
  "team.mom", "team.press", "ppda", "tilt", "game.chaos", "team.poss", "act.xt", "pitch.ctrl"
])
export type MetricId = typeof MetricId.Type

export const SignalType = Schema.Literals([
  "goal", "big_chance", "pressure_shift", "momentum_swing", "chaos_spike", "speed_alert", "distance_milestone",
  "difficult_pass_completed", "player_milestone", "card", "substitution_impact"
])
export type SignalType = typeof SignalType.Type

/** A threshold crossing raised by the stats engine; the Moment Detector ranks signals into moments. */
export const Signal = Schema.Struct({
  id: Schema.String,
  match_id: Schema.String,
  type: SignalType,
  /** Global tick at which the signal was raised. */
  frame_id: Schema.Int,
  /** Global ticks of the play the signal describes. */
  frame_from: Schema.Int,
  frame_to: Schema.Int,
  period: Schema.Literals(["first_half", "second_half"]),
  match_clock: Schema.String,
  team_id: Schema.NullOr(Schema.String),
  player_id: Schema.NullOr(Schema.String),
  /** The metric the signal is about and its value, when there is one (a card has none). */
  metric: Schema.NullOr(MetricId),
  value: Schema.NullOr(Schema.Finite),
  /** 0..1: how notable the signal is on its own (the fallback ranking when no model is available). */
  salience: Schema.Finite,
  /** Event ids and metric references (`metric@from-to`) that support the signal. */
  evidence: Schema.Array(Schema.String),
  data: Schema.Record(Schema.String, Schema.Finite)
})
export type Signal = typeof Signal.Type

export const decodeSignal = Schema.decodeUnknownSync(Signal)

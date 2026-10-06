import { ACTION_ZONES, DEFAULT_PARAMS, type Action, type Params } from "@touchline/sim-core"

/**
 * The settings the tuner may move, each a pure transform of the base parameters.
 * `apply(p, v)` returns new params with knob value v; `init` is the identity value.
 */
export interface Knob {
  readonly name: string
  readonly what: string
  readonly init: number
  readonly min: number
  readonly max: number
  readonly step: number
  readonly apply: (p: Params, v: number) => Params
}

/** A probability scaled by a knob, kept at most 1. */
const share = (x: number): number => Math.min(1, x)

const shiftLogits = (p: Params, actions: ReadonlyArray<Action>, v: number): Params => {
  const logits = { ...p.actions.logits }
  for (const z of ACTION_ZONES) {
    const row = { ...logits[z] }
    for (const a of actions) row[a] = row[a] + v
    logits[z] = row
  }
  return { ...p, actions: { ...p.actions, logits } }
}

export const KNOBS: ReadonlyArray<Knob> = [
  { name: "decision_scale", what: "time on the ball before each decision (passes per match)", init: 1, min: 0.6, max: 2.5, step: 0.25,
    apply: (p, v) => ({ ...p, timing: { ...p.timing, decisionMinS: p.timing.decisionMinS * v, decisionMaxS: p.timing.decisionMaxS * v } }) },
  { name: "long_bias", what: "logit shift for long passes, switches and lofted through balls", init: 0, min: -1, max: 3, step: 0.5,
    apply: (p, v) => shiftLogits(p, ["long_pass", "switch", "lofted_through"], v) },
  { name: "cross_bias", what: "logit shift for crosses (corners)", init: 0, min: -1, max: 3, step: 0.5, apply: (p, v) => shiftLogits(p, ["cross"], v) },
  { name: "shot_bias", what: "logit shift for shooting (shots per match)", init: 0, min: -2, max: 1.5, step: 0.4, apply: (p, v) => shiftLogits(p, ["shot"], v) },
  { name: "aim_noise", what: "shot aiming error (on-target share)", init: 1, min: 0.6, max: 2.2, step: 0.2,
    apply: (p, v) => ({ ...p, shot: { ...p.shot, aimNoise: v } }) },
  { name: "xg_b0", what: "xG intercept (goals per shot)", init: DEFAULT_PARAMS.shot.xg.b0, min: -2.5, max: 0, step: 0.25,
    apply: (p, v) => ({ ...p, shot: { ...p.shot, xg: { ...p.shot.xg, b0: v } } }) },
  { name: "exec_scale", what: "kick execution error (completion)", init: 1, min: 0.5, max: 3, step: 0.3,
    apply: (p, v) => ({ ...p, execution: { ...p.execution, dirSigma: p.execution.dirSigma * v, distSigma: p.execution.distSigma * v } }) },
  { name: "reach_margin", what: "share of straight-line reach when judging who reaches a ball (completion, interceptions)", init: 0.75, min: 0.5, max: 0.95, step: 0.05,
    apply: (p, v) => ({ ...p, kinematics: { ...p.kinematics, reachMargin: v } }) },
  { name: "tackle_rate", what: "tackle attempts per second when close (turnovers)", init: 0.35, min: 0.1, max: 1.5, step: 0.15,
    apply: (p, v) => ({ ...p, defending: { ...p.defending, tackleRatePerS: v } }) },
  { name: "foul_per_tackle", what: "share of tackles that are fouls (fouls, free kicks)", init: 0.18, min: 0.05, max: 0.6, step: 0.06,
    apply: (p, v) => ({ ...p, defending: { ...p.defending, foulPerTackle: v } }) },
  { name: "yellow_per_foul", what: "share of fouls booked (cards)", init: 0.15, min: 0.05, max: 0.5, step: 0.05,
    apply: (p, v) => ({ ...p, defending: { ...p.defending, yellowPerFoul: v } }) },
  { name: "box_intensity", what: "extra pressing and tackling near a team's own goal (shot quality, goals)", init: 0, min: 0, max: 8, step: 1,
    apply: (p, v) => ({ ...p, defending: { ...p.defending, boxIntensity: v } }) },
  { name: "box_carry", what: "logit shift for carrying and dribbling inside the box (shot distance)", init: 0, min: -3, max: 1, step: 0.5,
    apply: (p, v) => ({ ...p, actions: { ...p.actions, logits: { ...p.actions.logits, box: { ...p.actions.logits.box, carry: p.actions.logits.box.carry + v, take_on: p.actions.logits.box.take_on + v } } } }) },
  { name: "loose_share", what: "share of won tackles that knock the ball loose (throw-ins)", init: 0.4, min: 0.1, max: 0.9, step: 0.1,
    apply: (p, v) => ({ ...p, defending: { ...p.defending, tackleLooseShare: v } }) },
  { name: "restart_scale", what: "restart delays (ball-in-play share)", init: 1, min: 0.6, max: 2.5, step: 0.2,
    apply: (p, v) => ({ ...p, timing: { ...p.timing, restartDelayS: Object.fromEntries(Object.entries(p.timing.restartDelayS).map(([k, s]) => [k, s * v])) as Params["timing"]["restartDelayS"] } }) },
  { name: "shape_width", what: "team width, mostly in possession (throw-ins, pass length)", init: 1, min: 0.8, max: 1.6, step: 0.1,
    apply: (p, v) => ({ ...p, shape: { ...p.shape, width: v } }) },
  { name: "shape_depth", what: "distance between lines (pass length, long passes)", init: 1, min: 0.8, max: 1.6, step: 0.1,
    apply: (p, v) => ({ ...p, shape: { ...p.shape, depth: v } }) },
  { name: "shape_speed", what: "share of top speed used when moving into shape (speeds, distance)", init: 0.7, min: 0.5, max: 1, step: 0.05,
    apply: (p, v) => ({ ...p, movement: { ...p.movement, shapeSpeedShare: v } }) },
  { name: "deflect_behind", what: "scale on the shares of blocks, headers and sliced clearances that go behind (corners)", init: 1, min: 0.3, max: 2, step: 0.25,
    apply: (p, v) => ({
      ...p,
      defending: { ...p.defending, crossBlockBehind: share(p.defending.crossBlockBehind * v), headBehind: share(p.defending.headBehind * v), clearSliceBehind: share(p.defending.clearSliceBehind * v) },
      shot: { ...p.shot, blockBehind: share(p.shot.blockBehind * v) }
    }) },
  { name: "save_b0", what: "keeper save model intercept (save rate, shots on target, goals)", init: DEFAULT_PARAMS.shot.save.b0, min: -1, max: 3.5, step: 0.25,
    apply: (p, v) => ({ ...p, shot: { ...p.shot, save: { ...p.shot.save, b0: v } } }) },
  { name: "pass_pc_weight", what: "weight of pitch control in a passer's estimate of a pass arriving (pass completion)", init: DEFAULT_PARAMS.pass.pitchControlWeight, min: 0, max: 0.8, step: 0.2,
    apply: (p, v) => ({ ...p, pass: { ...p.pass, pitchControlWeight: v } }) },
  { name: "pass_safety", what: "how much the safest option of each kind of pass sways the choice of pass (completion, long-pass share)", init: DEFAULT_PARAMS.pass.safetyWeight, min: 0, max: 6, step: 1,
    apply: (p, v) => ({ ...p, pass: { ...p.pass, safetyWeight: v } }) },
  { name: "pass_arrive", what: "ground passes are struck to arrive at this speed (m/s): faster passes are intercepted less but run out more", init: DEFAULT_PARAMS.pass.arriveSpeed, min: 5, max: 12, step: 1,
    apply: (p, v) => ({ ...p, pass: { ...p.pass, arriveSpeed: v } }) },
  { name: "clear_to_touch", what: "share of wide clearances kicked into touch (throw-ins)", init: DEFAULT_PARAMS.defending.clearToTouch, min: 0, max: 0.7, step: 0.1,
    apply: (p, v) => ({ ...p, defending: { ...p.defending, clearToTouch: v } }) }
]

export type KnobValues = Readonly<Record<string, number>>

export const initialKnobs = (): Record<string, number> => Object.fromEntries(KNOBS.map((k) => [k.name, k.init]))

export const applyKnobs = (base: Params, values: KnobValues): Params =>
  KNOBS.reduce((p, k) => (values[k.name] === undefined || values[k.name] === k.init ? p : k.apply(p, values[k.name]!)), base)

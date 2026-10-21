import { ACTION_ZONES, DEFAULT_PARAMS, type Action, type Params, type PassAction, type ShapeRow } from "@touchline/sim-core"

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

/** The D1 kind shifts of `kinds` moved by v (on top of the shifts Task 9 fitted into DEFAULT_PARAMS). */
const shiftKinds = (p: Params, kinds: ReadonlyArray<PassAction>, v: number): Params => ({
  ...p,
  choice: { ...p.choice, kindShift: { ...p.choice.kindShift, ...Object.fromEntries(kinds.map((k) => [k, p.choice.kindShift[k] + v])) } }
})

/** Every outfield group's row `row` moved upfield by v metres (the rule table's depth intercepts). */
const shiftRows = (p: Params, row: ShapeRow, v: number): Params => ({
  ...p,
  positioning: {
    ...p.positioning,
    roles: Object.fromEntries(
      Object.entries(p.positioning.roles).map(([g, r]) => [g, g === "GK" ? r : { ...r, [row]: { ...r[row], a: r[row].a + v } }])
    ) as Params["positioning"]["roles"]
  }
})

export const KNOBS: ReadonlyArray<Knob> = [
  // P5 ruling 22 (Question 5): also scales the free release base release.freeS, in a narrowed 0.8-1.2, so the tuner keeps a
  // passes lever without pushing the release median far from 1.40 s.
  { name: "decision_scale", what: "time on the ball before each decision (passes per match, release median)", init: 1, min: 0.8, max: 1.2, step: 0.1,
    apply: (p, v) => ({
      ...p,
      timing: { ...p.timing, decisionMinS: p.timing.decisionMinS * v, decisionMaxS: p.timing.decisionMaxS * v },
      release: { ...p.release, freeS: [p.release.freeS[0] * v, p.release.freeS[1] * v] }
    }) },
  { name: "shot_bias", what: "logit shift for shooting (shots per match)", init: 0, min: -2, max: 1.5, step: 0.4, apply: (p, v) => shiftLogits(p, ["shot"], v) },
  { name: "long_shift", what: "pass-choice shift for long passes and lofted through balls (long-pass share)", init: 0, min: -2, max: 2, step: 0.5,
    apply: (p, v) => shiftKinds(p, ["long_pass", "lofted_through"], v) },
  { name: "switch_shift", what: "pass-choice shift for switches of play", init: 0, min: -2, max: 2, step: 0.5,
    apply: (p, v) => shiftKinds(p, ["switch"], v) },
  { name: "cross_shift", what: "pass-choice shift for crosses and cut-backs (corners, crosses)", init: 0, min: -2, max: 2, step: 0.5,
    apply: (p, v) => shiftKinds(p, ["cross", "cutback"], v) },
  { name: "choice_temp", what: "receiver-choice temperature (how often passers pick a lesser option; completion)", init: DEFAULT_PARAMS.choice.temperature, min: 0.6, max: 1.6, step: 0.2,
    apply: (p, v) => ({ ...p, choice: { ...p.choice, temperature: v } }) },
  { name: "iv_centre", what: "passing against carrying and holding (passes per match)", init: DEFAULT_PARAMS.choice.ivCentre, min: -2, max: 4, step: 0.5,
    apply: (p, v) => ({ ...p, choice: { ...p.choice, ivCentre: v } }) },
  { name: "aim_noise", what: "shot aiming error (on-target share)", init: 1, min: 0.6, max: 2.2, step: 0.2,
    apply: (p, v) => ({ ...p, shot: { ...p.shot, aimNoise: v } }) },
  // P6 ruling 14: the refit xG (shotModel.xg, read under shotModel.rule 1) within the DFL fit +- 0.5.
  { name: "xg_b0", what: "xG intercept (shot selection, recorded xG)", init: DEFAULT_PARAMS.shotModel.xg.b0, min: DEFAULT_PARAMS.shotModel.xg.b0 - 0.5, max: DEFAULT_PARAMS.shotModel.xg.b0 + 0.5, step: 0.25,
    apply: (p, v) => ({ ...p, shotModel: { ...p.shotModel, xg: { ...p.shotModel.xg, b0: v } } }) },
  { name: "exec_scale", what: "kick execution error (completion)", init: 1, min: 0.5, max: 3, step: 0.3,
    apply: (p, v) => ({ ...p, execution: { ...p.execution, dirSigma: p.execution.dirSigma * v, distSigma: p.execution.distSigma * v } }) },
  { name: "reach_margin", what: "share of straight-line reach when judging who reaches a ball (completion, interceptions)", init: 0.75, min: 0.5, max: 0.95, step: 0.05,
    apply: (p, v) => ({ ...p, kinematics: { ...p.kinematics, reachMargin: v } }) },
  { name: "tackle_rate", what: "tackle attempts per second when close (turnovers)", init: 0.35, min: 0.1, max: 1.5, step: 0.15,
    apply: (p, v) => ({ ...p, defending: { ...p.defending, tackleRatePerS: v } }) },
  { name: "foul_per_tackle", what: "share of tackles that are fouls (fouls, free kicks)", init: 0.18, min: 0.05, max: 0.6, step: 0.06,
    apply: (p, v) => ({ ...p, defending: { ...p.defending, foulPerTackle: v } }) },
  // P4 ruling 26: 0.10-0.25, so the tuner cannot buy back cards when fouls miss (real 3.29 foul yellows / 22.9 fouls = 0.144).
  { name: "yellow_per_foul", what: "share of fouls booked (cards)", init: 0.15, min: 0.1, max: 0.25, step: 0.05,
    apply: (p, v) => ({ ...p, defending: { ...p.defending, yellowPerFoul: v } }) },
  { name: "box_intensity", what: "extra pressing and tackling near a team's own goal (shot quality, goals)", init: 0, min: 0, max: 8, step: 1,
    apply: (p, v) => ({ ...p, defending: { ...p.defending, boxIntensity: v } }) },
  { name: "box_carry", what: "logit shift for carrying and dribbling inside the box (shot distance)", init: 0, min: -3, max: 1, step: 0.5,
    apply: (p, v) => ({ ...p, actions: { ...p.actions, logits: { ...p.actions.logits, box: { ...p.actions.logits.box, carry: p.actions.logits.box.carry + v, take_on: p.actions.logits.box.take_on + v } } } }) },
  { name: "loose_share", what: "share of won tackles that knock the ball loose (throw-ins)", init: 0.4, min: 0.1, max: 0.9, step: 0.1,
    apply: (p, v) => ({ ...p, defending: { ...p.defending, tackleLooseShare: v } }) },
  // P5 ruling 27: also scales the S8 delay medians (deadBall.medianS), in a narrowed 0.8-1.25 around the real medians.
  { name: "restart_scale", what: "restart delays (ball-in-play share, dead time by restart)", init: 1, min: 0.8, max: 1.25, step: 0.1,
    apply: (p, v) => ({
      ...p,
      timing: { ...p.timing, restartDelayS: Object.fromEntries(Object.entries(p.timing.restartDelayS).map(([k, s]) => [k, s * v])) as Params["timing"]["restartDelayS"] },
      deadBall: { ...p.deadBall, medianS: Object.fromEntries(Object.entries(p.deadBall.medianS).map(([k, s]) => [k, s * v])) as Params["deadBall"]["medianS"] }
    }) },
  { name: "shape_width", what: "team width, mostly in possession (throw-ins, pass length)", init: 1, min: 0.8, max: 1.6, step: 0.1,
    apply: (p, v) => ({ ...p, shape: { ...p.shape, width: v } }) },
  { name: "shape_depth", what: "distance between lines (pass length, long passes)", init: 1, min: 0.8, max: 1.6, step: 0.1,
    apply: (p, v) => ({ ...p, shape: { ...p.shape, depth: v } }) },
  { name: "deflect_behind", what: "scale on the shares of blocks, headers and sliced clearances that go behind (corners)", init: 1, min: 0.3, max: 2, step: 0.25,
    apply: (p, v) => ({
      ...p,
      defending: { ...p.defending, crossBlockBehind: share(p.defending.crossBlockBehind * v), headBehind: share(p.defending.headBehind * v), clearSliceBehind: share(p.defending.clearSliceBehind * v) },
      shot: { ...p.shot, blockBehind: share(p.shot.blockBehind * v) }
    }) },
  { name: "save_b0", what: "keeper save model intercept (save rate, shots on target, goals)", init: DEFAULT_PARAMS.shot.save.b0, min: -1, max: 3.5, step: 0.25,
    apply: (p, v) => ({ ...p, shot: { ...p.shot, save: { ...p.shot.save, b0: v } } }) },
  { name: "pass_arrive", what: "ground passes are struck to arrive at this speed (m/s): faster passes are intercepted less but run out more", init: DEFAULT_PARAMS.pass.arriveSpeed, min: 5, max: 12, step: 1,
    apply: (p, v) => ({ ...p, pass: { ...p.pass, arriveSpeed: v } }) },
  { name: "clear_to_touch", what: "share of wide clearances kicked into touch (throw-ins)", init: DEFAULT_PARAMS.defending.clearToTouch, min: 0, max: 0.7, step: 0.1,
    apply: (p, v) => ({ ...p, defending: { ...p.defending, clearToTouch: v } }) },
  { name: "def_depth", what: "extra squeeze between the lines without the ball (defending team length)", init: DEFAULT_PARAMS.shape.defDepth, min: 0.5, max: 1.2, step: 0.1,
    apply: (p, v) => ({ ...p, shape: { ...p.shape, defDepth: v } }) },
  { name: "pos_in_shift", what: "metres every in-possession row moves upfield (block height with the ball, territory); shifts only the in row, decoupled from the gk row", init: 0, min: -6, max: 6, step: 1.5,
    apply: (p, v) => shiftRows(p, "in", v) },
  { name: "pos_out_shift", what: "metres every out-of-possession row moves upfield (defensive line height, defending length)", init: 0, min: -6, max: 6, step: 1.5,
    apply: (p, v) => shiftRows(p, "out", v) },
  { name: "team_drift", what: "scale on the team-common drift (line-height variability, territory)", init: 1, min: 0, max: 1.5, step: 0.25,
    apply: (p, v) => ({ ...p, positioning: { ...p.positioning, drift: { ...p.positioning.drift, teamUSdM: p.positioning.drift.teamUSdM * v, teamYSdM: p.positioning.drift.teamYSdM * v } } }) },
  { name: "player_drift", what: "scale on each player's slow drift (positional variability, running between restarts)", init: 1, min: 0, max: 1.5, step: 0.25,
    apply: (p, v) => ({ ...p, positioning: { ...p.positioning, drift: { ...p.positioning.drift, playerUSdM: p.positioning.drift.playerUSdM * v, playerSSdM: Object.fromEntries(Object.entries(p.positioning.drift.playerSSdM).map(([g, x]) => [g, x * v])) as Params["positioning"]["drift"]["playerSSdM"] } } }) },
  { name: "relax_cap", what: "share of top speed for relaxed shape movement (speeds, high-speed running)", init: DEFAULT_PARAMS.movement.relaxCap, min: 0.4, max: 0.85, step: 0.05,
    apply: (p, v) => ({ ...p, movement: { ...p.movement, relaxCap: v } }) },
  { name: "marking_weight", what: "how tightly defenders mark (free space, fouls, turnovers)", init: DEFAULT_PARAMS.marking.weight, min: 0, max: 1, step: 0.25,
    apply: (p, v) => ({ ...p, marking: { ...p.marking, weight: v } }) },
  { name: "support_dist", what: "distance supporters offer from the carrier (support, pass length)", init: DEFAULT_PARAMS.support.distM, min: 8, max: 18, step: 2,
    apply: (p, v) => ({ ...p, support: { ...p.support, distM: v } }) },
  // Support rule 1 (P3 Task 10d): the space other teammates keep from an outfield carrier, and in the attacking third
  // (spaceAttM never wider than spaceM: each knob clamps the attacking-third value to the general one).
  { name: "support_space", what: "space teammates keep from the carrier (open near options, support within 15 m, pass length)", init: DEFAULT_PARAMS.support.spaceM, min: 12, max: 20, step: 2,
    apply: (p, v) => ({ ...p, support: { ...p.support, spaceM: v, spaceAttM: Math.min(p.support.spaceAttM, v) } }) },
  // The file records the tuner's value, not the clamped one: with support_space_att above support_space the engine uses
  // support_space, so the tuner can sit on a flat stretch there (harmless at the calibrated 16 and 11).
  { name: "support_space_att", what: "space teammates keep from the carrier in the attacking third (chances, crosses, support)", init: DEFAULT_PARAMS.support.spaceAttM, min: 7, max: 15, step: 2,
    apply: (p, v) => ({ ...p, support: { ...p.support, spaceAttM: Math.min(v, p.support.spaceM) } }) },
  // P4 (ruling 26): narrow scales on measured values. No knob on tackle.base, the foul zone and angle factors or the shape
  // of the join table: they are fitted.
  { name: "attacker_foul", what: "scale on the shielding-foul chance of a slow carrier (attacker fouls, fouls, free kicks)", init: 1, min: 0.5, max: 1.5, step: 0.25,
    apply: (p, v) => ({ ...p, fouls: { ...p.fouls, attackerShare: share(p.fouls.attackerShare * v) } }) },
  { name: "aerial_contest", what: "metres a nearly-reaching opponent may miss a high ball by and still contest it (aerial duels)", init: DEFAULT_PARAMS.aerial.contestM, min: DEFAULT_PARAMS.aerial.contestM - 0.5, max: DEFAULT_PARAMS.aerial.contestM + 0.5, step: 0.25,
    apply: (p, v) => ({ ...p, aerial: { ...p.aerial, contestM: v } }) },
  { name: "aerial_foul", what: "scale on the chance an aerial duel ends in a foul by the loser (aerial fouls, fouls)", init: 1, min: 0.5, max: 1.5, step: 0.25,
    apply: (p, v) => ({ ...p, aerial: { ...p.aerial, foulShare: share(p.aerial.foulShare * v) } }) },
  { name: "counter_join", what: "scale on every counter-press join chance after a loss (counter-press joiners, regains within 5 s)", init: 1, min: 0.75, max: 1.25, step: 0.125,
    apply: (p, v) => ({ ...p, transition: { ...p.transition, joinP: p.transition.joinP.map((x) => share(x * v)) } }) },
  { name: "recovery_rate", what: "scale on the recovery-sprint hazard after a loss (recovery share at 5-6 s, distance)", init: 1, min: 0.5, max: 1.5, step: 0.25,
    apply: (p, v) => ({ ...p, transition: { ...p.transition, recoverRatePerS: p.transition.recoverRatePerS * v } }) },
  { name: "press_rate", what: "scale on the team-press hazard (press episodes, tackles, fouls, ball pressure)", init: 1, min: 0.75, max: 1.25, step: 0.125,
    apply: (p, v) => ({ ...p, press: { ...p.press, rateScale: p.press.rateScale * v } }) },
  // P5 (plan 8e ruling 27): no knob on role tables, walls, zonal spots or delay shapes. Ranges around each task's value.
  { name: "fk_shot", what: "logit shift for shooting at central attacking free kicks (direct free-kick shot share)", init: DEFAULT_PARAMS.directFk.shotShift, min: DEFAULT_PARAMS.directFk.shotShift - 1, max: DEFAULT_PARAMS.directFk.shotShift + 1, step: 0.5,
    apply: (p, v) => ({ ...p, directFk: { ...p.directFk, shotShift: v } }) },
  { name: "gk_long", what: "logit shift for long passes and switches at goal kicks and keeper free kicks (long goal-kick share)", init: DEFAULT_PARAMS.keeperRestarts.longShift, min: DEFAULT_PARAMS.keeperRestarts.longShift - 1, max: DEFAULT_PARAMS.keeperRestarts.longShift + 1, step: 0.5,
    apply: (p, v) => ({ ...p, keeperRestarts: { ...p.keeperRestarts, longShift: v } }) },
  { name: "gk_long_error", what: "scale on the kick error of long goal kicks and keeper free kicks (long goal-kick completion)", init: 1, min: 0.75, max: 1.25, step: 0.125,
    apply: (p, v) => ({ ...p, keeperRestarts: { ...p.keeperRestarts, longErrorScale: p.keeperRestarts.longErrorScale * v } }) },
  { name: "role_rate", what: "scale on every A6 role-move rate: run start weights, overlaps, wingers inside, full-back inversions, CM drops (role-move counts)", init: 1, min: 0.75, max: 1.25, step: 0.125,
    apply: (p, v) => {
      const r = p.roleMoves
      return {
        ...p,
        roleMoves: {
          ...r,
          run: { ...r.run, roleWeight: Object.fromEntries(Object.entries(r.run.roleWeight).map(([k, w]) => [k, w * v])) as typeof r.run.roleWeight },
          overlap: { ...r.overlap, ratePerS: r.overlap.ratePerS * v },
          inside: { ...r.inside, ratePerS: r.inside.ratePerS * v },
          invert: { ...r.invert, ratePerS: r.invert.ratePerS * v },
          cmDrop: { ...r.cmDrop, ratePerS: r.cmDrop.ratePerS * v }
        }
      }
    } },
  { name: "max_gap", what: "zonal cap: the farthest a zonal marker stands from his man, m (free space, tight marking, ball pressure)", init: DEFAULT_PARAMS.marking.maxGapM, min: DEFAULT_PARAMS.marking.maxGapM - 1.5, max: DEFAULT_PARAMS.marking.maxGapM + 1.5, step: 0.5,
    apply: (p, v) => ({ ...p, marking: { ...p.marking, maxGapM: v } }) },
  // Re-added in P5: zonal marking (marking.rule) is on, so laneShare is live again.
  { name: "lane_share", what: "share of the way from the ball to the man where a zonal marker stands (free space, ball pressure)", init: DEFAULT_PARAMS.marking.laneShare, min: 0.3, max: 0.5, step: 0.05,
    apply: (p, v) => ({ ...p, marking: { ...p.marking, laneShare: v } }) },
  // P6 (plan 8f ruling 14): the open-play shot term's slope on xG. No knob on firstTime, header, saveGeo or execFatigue.
  { name: "shot_xg_slope", what: "slope of the open-play shot logit on xG (shots per match, shot quality)", init: DEFAULT_PARAMS.shotModel.bXg, min: 1.5, max: 4.5, step: 0.5,
    apply: (p, v) => ({ ...p, shotModel: { ...p.shotModel, bXg: v } }) }
]

export type KnobValues = Readonly<Record<string, number>>

export const initialKnobs = (): Record<string, number> => Object.fromEntries(KNOBS.map((k) => [k.name, k.init]))

export const applyKnobs = (base: Params, values: KnobValues): Params =>
  KNOBS.reduce((p, k) => (values[k.name] === undefined || values[k.name] === k.init ? p : k.apply(p, values[k.name]!)), base)

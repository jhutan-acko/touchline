/**
 * Realism v2 P6 (plan 8f Task 3), SH1: a receiver near goal strikes the ball first time, lays it off first time, or
 * controls it. The choice is made at contact (the pass's resolve tick) and drawn from the `contact` stream; step.ts's
 * first-time seam builds the inputs and the contact executor carries the plan out.
 */
import { arrivalCos, coneCount, contactDecision, CONTROL, type ContactPlan } from "./contact.js"
import { buildCandidatesIn, candidateContext, choiceShares, OPTIONS_RECORDED, toOption, xgOf, type Candidate, type DecisionInput } from "./decide.js"
import { dist, goalOf, type Period } from "./geometry.js"
import type { Params } from "./params.js"
import type { Rng } from "./rng.js"
import type { BallState, PlayerState, RestartKind } from "./types.js"

/** Pass actions a first-time lay-off can be (ruling 6); it is recorded as `short_pass`. */
const LAY_OFF_ACTIONS: ReadonlySet<string> = new Set(["short_pass", "back_pass", "cutback"])

/** How far `pl` stands from the centre of the goal he attacks. */
export const goalDistM = (pl: PlayerState, period: Period): number => dist(pl.pos, goalOf(pl.side, period))

/**
 * Whether a receiver may play it first time (ruling 3): within maxGoalM of the goal centre he attacks, the ball at foot
 * height (contact z no higher than kinematics.controlHeightM), in open play or from a corner or free-kick delivery when
 * setPieces is 1 (never a throw-in, kickoff or goal kick), and never a keeper.
 */
export const firstTimeEligible = (dGoalM: number, contactZ: number, restart: RestartKind | null, isKeeper: boolean, p: Params): boolean => {
  if (isKeeper) return false
  if (dGoalM > p.firstTime.maxGoalM || contactZ > p.kinematics.controlHeightM) return false
  return restart === null || ((restart === "corner" || restart === "free_kick") && p.firstTime.setPieces === 1)
}

/**
 * The contact choice (ruling 4): softmax of U_shot = b0 + bXg xg + bArrival cos(arrival) + the script's shot bias,
 * U_layoff = layOffLogit when a lay-off option exists (otherwise none: short_pass 0), and U_control = 0 (`hold`).
 * Pressure does not enter the choice; it widens the execution (planShot).
 */
export const firstTimeShares = (
  xg: number,
  cosD: number,
  layOff: boolean,
  scriptShot: number,
  ft: Params["firstTime"]
): { shot: number; short_pass: number; hold: number } => {
  const uShot = ft.b0 + ft.bXg * xg + ft.bArrival * cosD + scriptShot
  const us = layOff ? [uShot, ft.layOffLogit, 0] : [uShot, 0]
  const m = Math.max(...us)
  const e = us.map((u) => Math.exp(u - m))
  const z = e.reduce((a, b) => a + b, 0)
  return layOff ? { shot: e[0]! / z, short_pass: e[1]! / z, hold: e[2]! / z } : { shot: e[0]! / z, short_pass: 0, hold: e[1]! / z }
}

/**
 * How much wider a first-time shot is aimed (ruling 5), across and in height alike: 1 for a ball from the goal side
 * (cos -1) at up to speedRefMps, + arrivalAimK for one from behind (cos +1), + speedAimK per 10 m/s above speedRefMps.
 */
export const firstTimeAim = (cosD: number, ballMps: number, ft: Params["firstTime"]): { aimY: number; aimZ: number } => {
  const k = 1 + (ft.arrivalAimK * (1 + cosD)) / 2 + (ft.speedAimK * Math.max(0, ballMps - ft.speedRefMps)) / 10
  return { aimY: k, aimZ: k }
}

/**
 * The receiver's lay-off options (ruling 6): his short passes, back passes and cutbacks to a teammate standing within
 * maxM of him.
 */
export const layOffOptions = (candidates: ReadonlyArray<Candidate>, receiver: PlayerState, teammates: ReadonlyArray<PlayerState>, maxM: number): Candidate[] =>
  candidates.filter((c) => {
    if (!LAY_OFF_ACTIONS.has(c.action)) return false
    const tm = teammates.find((t) => t.id === c.receiverId)
    return tm !== undefined && dist(tm.pos, receiver.pos) <= maxM
  })

/**
 * The first-time choice of an eligible receiver (`input.owner`, with `input.restart` null) for the ball as it arrives:
 * one draw on `rng` (the contact stream) for shot, lay-off or control, and one more for the lay-off's receiver.
 * `pressure` is his pressure at contact (pressureFrom), recorded and used by the shot's execution.
 */
export const firstTimeChoice = (input: DecisionInput, ball: BallState, pressure: number, p: Params, rng: Rng): ContactPlan => {
  const ft = p.firstTime
  const me = input.owner
  const goal = goalOf(me.side, input.period)
  const xg = xgOf(p, me.side, input.period, me.pos, false, coneCount(me.side, input.period, me.pos, input.opponents))
  const cosD = arrivalCos(ball.vel, me.pos, goal)
  const ctx = candidateContext(input, p, pressure)
  const layOffs = layOffOptions(buildCandidatesIn(ctx), me, input.teammates, ft.layOffMaxM)
  const shares = firstTimeShares(xg, cosD, layOffs.length > 0, input.scriptBias.shot ?? 0, ft)
  const probs = layOffs.length > 0 ? shares : { shot: shares.shot, hold: shares.hold }
  const options = [...layOffs].sort((a, b) => b.value - a.value).slice(0, OPTIONS_RECORDED).map(toOption)
  const pick = rng.weighted([shares.shot, shares.short_pass, shares.hold])
  if (pick === 0) {
    const speed = Math.hypot(ball.vel.x, ball.vel.y, ball.vel.z)
    return { kind: "shot", decision: contactDecision(probs, "shot", null, options, xg, pressure), how: { header: false, firstTime: true, mods: firstTimeAim(cosD, speed, ft) } }
  }
  if (pick === 1) {
    const chosen = layOffs[Math.max(0, rng.weighted(choiceShares(layOffs, ctx)))]!
    return { kind: "layoff", decision: contactDecision(probs, "short_pass", chosen, options, null, pressure) }
  }
  return CONTROL
}

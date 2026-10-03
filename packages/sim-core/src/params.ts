import type { ActionZone } from "./geometry.js"

export const ACTIONS = [
  "short_pass",
  "long_pass",
  "through_ball",
  "lofted_through",
  "switch",
  "cross",
  "cutback",
  "back_pass",
  "carry",
  "take_on",
  "shot",
  "clear",
  "hold"
] as const
export type Action = (typeof ACTIONS)[number]

export const ALLOWED_LICENCES = ["CC-BY-4.0", "MIT", "hand-set-prior"] as const

export interface Provenance {
  readonly dataset: string
  readonly licence: string
  readonly attribution: string
  readonly fitted_at: string
  readonly version: string
}

export interface ClassifierThresholds {
  readonly longPassM: number
  readonly switchLateralM: number
  readonly backPassM: number
  readonly carryMinM: number
  readonly crossOriginAbsY: number
  readonly finalThirdAttackX: number
  readonly cutbackOriginAttackX: number
  readonly cutbackTargetAttackXMin: number
  readonly cutbackTargetAttackXMax: number
  readonly cutbackTargetAbsY: number
}

export interface Params {
  readonly provenance: Provenance
  readonly kinematics: {
    readonly vmaxBase: number
    readonly accelMax: number
    readonly reactionS: number
    readonly reachM: number
    readonly controlHeightM: number
    readonly headerHeightM: number
  }
  readonly ball: {
    readonly drag: number
    readonly rollDecel: number
    readonly bounce: number
    readonly gravity: number
    readonly substeps: number
  }
  readonly timing: {
    readonly decisionMinS: number
    readonly decisionMaxS: number
    readonly keeperHoldS: number
    readonly restartDelayS: Readonly<Record<"kickoff" | "throw_in" | "corner" | "goal_kick" | "free_kick" | "penalty", number>>
    readonly addedTimeMinS: readonly [number, number]
  }
  readonly actions: {
    readonly logits: Readonly<Record<ActionZone, Readonly<Record<Action, number>>>>
    readonly styleWeight: number
    readonly pressureWeight: number
  }
  readonly pass: {
    readonly xpass: { readonly b0: number; readonly bDist: number; readonly bLane: number; readonly bPressure: number; readonly bHigh: number }
    readonly arriveSpeed: number
    readonly highLaunchDeg: number
    readonly throughLeadM: number
    readonly choiceTemperature: number
  }
  readonly execution: {
    readonly dirSigma: number
    readonly distSigma: number
    readonly pressureK: number
    readonly weakFootK: number
    readonly mishitBase: number
    readonly mishitK: number
  }
  readonly shot: {
    readonly xg: { readonly b0: number; readonly bDist: number; readonly bAngle: number; readonly bHeader: number; readonly bDefenders: number }
    readonly maxDistanceM: number
    readonly speed: number
    readonly onTargetRate: number
    readonly blockPerDefender: number
  }
  readonly defending: {
    readonly pressRatePerS: number
    readonly pressRadiusM: number
    readonly tackleRatePerS: number
    readonly tackleRadiusM: number
    readonly tackleBase: number
    readonly foulPerTackle: number
    readonly yellowPerFoul: number
    readonly redPerFoul: number
    /** Share of won tackles / ground interceptions that knock the ball loose instead of winning it cleanly. */
    readonly tackleLooseShare: number
    readonly interceptLooseShare: number
  }
  readonly takeOn: { readonly b0: number; readonly bSkill: number; readonly bPressure: number }
  readonly carry: { readonly speed: number; readonly durationS: readonly [number, number] }
  readonly runs: { readonly runInBehindRatePerS: number }
  readonly classifier: ClassifierThresholds
}

const row = (o: Partial<Record<Action, number>>): Record<Action, number> => {
  const out = {} as Record<Action, number>
  for (const a of ACTIONS) out[a] = o[a] ?? -4
  return out
}

/**
 * Hand-set priors so the engine runs before the offline fit (Plan 2) replaces them.
 * Values are order-of-magnitude guesses, not fitted.
 */
export const DEFAULT_PARAMS: Params = {
  provenance: {
    dataset: "none (hand-set priors)",
    licence: "hand-set-prior",
    attribution: "Touchline authors",
    fitted_at: "2026-10-03",
    version: "prior-0"
  },
  kinematics: { vmaxBase: 9.2, accelMax: 4.5, reactionS: 0.7, reachM: 1.0, controlHeightM: 1.0, headerHeightM: 2.4 },
  ball: { drag: 0.013, rollDecel: 1.2, bounce: 0.55, gravity: 9.81, substeps: 4 },
  timing: {
    decisionMinS: 0.9,
    decisionMaxS: 2.2,
    keeperHoldS: 4,
    restartDelayS: { kickoff: 45, throw_in: 18, corner: 37, goal_kick: 30, free_kick: 25, penalty: 60 },
    addedTimeMinS: [60, 300]
  },
  actions: {
    logits: {
      def_wide: row({ short_pass: 1.6, long_pass: 0.4, switch: -0.6, back_pass: -0.1, carry: 0.5, take_on: -1.2, clear: -0.4, hold: -0.6 }),
      def_central: row({ short_pass: 1.8, long_pass: 0.5, switch: -0.4, back_pass: -0.2, carry: 0.4, take_on: -1.5, clear: -0.2, hold: -0.6 }),
      mid_wide: row({ short_pass: 1.7, long_pass: 0.0, through_ball: -0.6, lofted_through: -1.0, switch: -0.5, cross: -1.2, back_pass: -0.3, carry: 0.7, take_on: -0.4, hold: -0.6 }),
      mid_central: row({ short_pass: 1.9, long_pass: -0.1, through_ball: -0.3, lofted_through: -0.9, switch: -0.4, back_pass: -0.2, carry: 0.6, take_on: -0.6, shot: -3.0, hold: -0.6 }),
      att_wide: row({ short_pass: 1.3, long_pass: -1.0, through_ball: -0.4, lofted_through: -1.0, cross: 0.6, cutback: -0.2, back_pass: -0.2, carry: 0.6, take_on: 0.0, shot: -2.0, hold: -0.4 }),
      att_central: row({ short_pass: 1.4, long_pass: -1.2, through_ball: 0.1, lofted_through: -0.6, back_pass: -0.3, carry: 0.6, take_on: -0.2, shot: -1.2, hold: -0.5 }),
      box: row({ short_pass: 0.6, through_ball: -0.4, cutback: 0.4, back_pass: -0.7, carry: 0.2, take_on: 0.1, shot: 0.3, clear: -2.0, hold: -0.8 })
    },
    styleWeight: 1.0,
    pressureWeight: 1.0
  },
  pass: {
    xpass: { b0: 3.24, bDist: -0.08, bLane: -1.0, bPressure: -0.8, bHigh: -0.4 },
    arriveSpeed: 7,
    highLaunchDeg: 30,
    throughLeadM: 8,
    choiceTemperature: 0.35
  },
  execution: { dirSigma: 0.035, distSigma: 0.07, pressureK: 1.6, weakFootK: 1.45, mishitBase: 0.006, mishitK: 0.11 },
  shot: {
    xg: { b0: -3.38, bDist: -0.0443, bAngle: 5.06, bHeader: -1.0, bDefenders: -0.3 },
    maxDistanceM: 32,
    speed: 26,
    onTargetRate: 0.38,
    blockPerDefender: 0.15
  },
  defending: {
    pressRatePerS: 0.6,
    pressRadiusM: 3,
    tackleRatePerS: 0.35,
    tackleRadiusM: 1.6,
    tackleBase: 0.0,
    foulPerTackle: 0.18,
    yellowPerFoul: 0.15,
    redPerFoul: 0.004,
    tackleLooseShare: 0.4,
    interceptLooseShare: 0.3
  },
  takeOn: { b0: -0.2, bSkill: 3.0, bPressure: -0.8 },
  carry: { speed: 5.5, durationS: [0.8, 2.0] },
  runs: { runInBehindRatePerS: 0.12 },
  classifier: {
    longPassM: 32,
    switchLateralM: 25,
    backPassM: 5,
    carryMinM: 3,
    crossOriginAbsY: 20.16,
    finalThirdAttackX: 17.5,
    cutbackOriginAttackX: 41,
    cutbackTargetAttackXMin: 41.5,
    cutbackTargetAttackXMax: 47,
    cutbackTargetAbsY: 11
  }
}

export class ParamsError extends Error {}

/** Reject parameter files whose provenance licence is not on the allowed list. */
export const assertProvenance = (p: { provenance?: Partial<Provenance> }): void => {
  const pv = p.provenance
  if (!pv || !pv.dataset || !pv.licence || !pv.version) throw new ParamsError("params file is missing provenance")
  if (!(ALLOWED_LICENCES as ReadonlyArray<string>).includes(pv.licence))
    throw new ParamsError(`licence "${pv.licence}" is not allowed (allowed: ${ALLOWED_LICENCES.join(", ")})`)
  if (/statsbomb/i.test(pv.dataset)) throw new ParamsError("StatsBomb-derived parameters are not allowed")
}

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
    /** Share of the straight-line reach used when judging who can get to a ball (see resolve.ts). */
    readonly reachMargin: number
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
    /** Multiplier on shot aiming error (calibration knob for on-target share). */
    readonly aimNoise: number
    /**
     * Each outfield defender within blockWidthM of the shot's line blocks it with probability blockPerDefender x (1 - distance / blockWidthM);
     * the defender closing the shooter down blocks with probability blockPressure x pressure.
     */
    readonly blockPerDefender: number
    readonly blockWidthM: number
    readonly blockPressure: number
    /** Share of blocked shots deflected behind the goal line (corners). */
    readonly blockBehind: number
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
    /** Extra pressing and tackling near a team's own goal: rates scale by 1 + boxIntensity x danger (0..1 within 30 m). */
    readonly boxIntensity: number
    /** Foul probability multiplier when the fouled player is inside the opponent's penalty area (defenders are careful there). */
    readonly boxFoulFactor: number
    /** Keeper comes off the line to close down a ball carrier within this distance of goal (m). */
    readonly keeperRushM: number
    /** Chance that a defender within crossBlockM of the crosser blocks the cross; share of blocks deflected behind. */
    readonly crossBlock: number
    readonly crossBlockM: number
    readonly crossBlockBehind: number
    /** Share of high balls won by defenders in their own third that are headed away (else controlled); share of those within 20 m of their goal line glanced behind. */
    readonly headClearShare: number
    readonly headBehind: number
    /** Share of clearances from wide positions kicked into touch on purpose. */
    readonly clearToTouch: number
    /** Share of clearances from inside a team's own box that are sliced behind for a corner (a defensive slip). */
    readonly clearSliceBehind: number
  }
  /**
   * Keepers coming for high balls: reach (m) and depth from the goal line (m), how often they come, catch vs punch vs fumble;
   * and the share of balls running out over their own goal line they let go for a goal kick instead of collecting.
   */
  readonly keeper: {
    readonly letRunShare: number
    readonly claimRangeM: number
    readonly claimDepthM: number
    readonly comeShare: number
    readonly catchBase: number
    readonly catchHandling: number
    readonly fumbleShare: number
  }
  readonly takeOn: { readonly b0: number; readonly bSkill: number; readonly bPressure: number }
  readonly carry: { readonly speed: number; readonly durationS: readonly [number, number] }
  readonly runs: { readonly runInBehindRatePerS: number }
  /** Share of top speed players use when moving back into shape (calibration knob for speeds and distance). */
  readonly movement: { readonly shapeSpeedShare: number }
  /** Team shape spread: width (fully in possession, partly without) and depth between lines. */
  readonly shape: { readonly width: number; readonly depth: number }
  /**
   * Energy (1 fresh .. 0 exhausted) drains per second by (drainBase + drainSpeed2 x speed^2) x (1 + staminaSlope x (0.5 - stamina));
   * players recover halfTimeRecovery at the break; tiredness widens execution error by up to executionK.
   */
  readonly fatigue: { readonly drainBase: number; readonly drainSpeed2: number; readonly staminaSlope: number; readonly halfTimeRecovery: number; readonly executionK: number }
  /** Substitution policy: planned windows (match minute, mean and SD), players per window, chance of a half-time change. */
  /**
   * First touch on a reception: P(error) = sigmoid(b0 + bSpeed x (speed - 12) / 10 + bHigh x height share + bPressure x pressure + bSkill x (skill - 0.6));
   * errors split into missed, miscontrol and (the rest) heavy.
   */
  readonly firstTouch: { readonly b0: number; readonly bSpeed: number; readonly bHigh: number; readonly bPressure: number; readonly bSkill: number; readonly missedShare: number; readonly miscontrolShare: number }
  /** Loose balls two opponents can both reach are decided by a ground duel: logit = bSkill x skill difference + bReach x reach advantage (m). */
  readonly groundDuel: { readonly bSkill: number; readonly bReach: number; readonly contestM: number }
  /**
   * Game state on scoring: a multiplier per 15-minute bin (mean 1; the last bin includes added time), and the
   * red-card factors for the team down to fewer players and for its opponent.
   */
  readonly gameState: { readonly minuteProfile: readonly [number, number, number, number, number, number]; readonly redCardOwn: number; readonly redCardOpponent: number }
  readonly substitutions: {
    readonly windowMinutes: readonly [number, number, number]
    readonly windowSdMin: number
    readonly perWindow: readonly [number, number, number]
    /** Chance that each planned window is used. */
    readonly windowChance: readonly [number, number, number]
    readonly halfTimeChance: number
  }
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
  kinematics: { vmaxBase: 9.2, accelMax: 4.5, reactionS: 0.7, reachM: 1.0, reachMargin: 0.75, controlHeightM: 1.0, headerHeightM: 2.4 },
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
    // Fitted to an approximate public reference xG curve (central and off-centre open-play shots, 2-30 m); a prior, not data-derived.
    xg: { b0: -1.25, bDist: -0.08, bAngle: 1.2, bHeader: -1.0, bDefenders: -0.3 },
    maxDistanceM: 32,
    speed: 26,
    onTargetRate: 0.38,
    aimNoise: 1.0,
    // Set so that about 23 % of shots are blocked, as in the IDSSE matches (39 of 171 shots).
    blockPerDefender: 0.23,
    blockWidthM: 3.5,
    blockPressure: 0.2,
    blockBehind: 0.5
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
    interceptLooseShare: 0.3,
    boxIntensity: 0,
    boxFoulFactor: 0.2,
    keeperRushM: 12,
    crossBlock: 0.6,
    crossBlockM: 4.0,
    crossBlockBehind: 0.6,
    headClearShare: 0.85,
    headBehind: 0.35,
    clearToTouch: 0.2,
    clearSliceBehind: 0.2
  },
  keeper: { letRunShare: 0.85, claimRangeM: 11, claimDepthM: 13, comeShare: 0.85, catchBase: 0.4, catchHandling: 0.35, fumbleShare: 0.06 },
  takeOn: { b0: -0.2, bSkill: 3.0, bPressure: -0.8 },
  carry: { speed: 5.5, durationS: [0.8, 2.0] },
  runs: { runInBehindRatePerS: 0.12 },
  movement: { shapeSpeedShare: 0.7 },
  shape: { width: 1, depth: 1 },
  fatigue: { drainBase: 0.00004, drainSpeed2: 0.000012, staminaSlope: 0.8, halfTimeRecovery: 0.1, executionK: 0.25 },
  firstTouch: { b0: -3.9, bSpeed: 1.0, bHigh: 1.2, bPressure: 1.5, bSkill: -3.5, missedShare: 0.15, miscontrolShare: 0.35 },
  groundDuel: { bSkill: 3, bReach: 2, contestM: 0.6 },
  // Hand-set prior with more goals late (refit from Wyscout goal minutes when that data is available); red-card factors from the spec.
  gameState: { minuteProfile: [0.85, 0.95, 1.05, 0.95, 1.05, 1.15], redCardOwn: 0.67, redCardOpponent: 1.2 },
  // About four changes per team on average (Bundesliga teams make roughly 4-4.5 of their 5).
  substitutions: { windowMinutes: [62, 72, 81], windowSdMin: 5, perWindow: [2, 2, 1], windowChance: [1, 0.8, 0.5], halfTimeChance: 0.2 },
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
  if (pv.licence !== "hand-set-prior" && (!pv.attribution || !pv.fitted_at))
    throw new ParamsError(`licence "${pv.licence}" requires provenance attribution and fitted_at`)
  if (/statsbomb/i.test(`${pv.dataset} ${pv.attribution ?? ""}`)) throw new ParamsError("StatsBomb-derived parameters are not allowed")
}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v)

/** Merge `over` onto `base`, keeping only keys `base` owns; every value must have its default's type. */
const mergeInto = (base: unknown, over: unknown, path: string): unknown => {
  if (over === undefined) return base
  const bad = (): never => {
    throw new ParamsError(`params field ${path} has the wrong type (expected ${Array.isArray(base) ? `array of ${(base as unknown[]).length}` : typeof base})`)
  }
  if (Array.isArray(base)) {
    if (!Array.isArray(over) || over.length !== base.length) bad()
    return base.map((b, i) => mergeInto(b, (over as unknown[])[i], `${path}[${i}]`))
  }
  if (isObject(base)) {
    if (!isObject(over)) bad()
    const out: Record<string, unknown> = { ...base }
    for (const [k, v] of Object.entries(over as Record<string, unknown>)) if (Object.hasOwn(base, k)) out[k] = mergeInto(base[k], v, `${path}.${k}`)
    return out
  }
  if (typeof base === "number" ? typeof over !== "number" || !Number.isFinite(over) : typeof over !== typeof base) bad()
  return over
}

/**
 * Parameters from a JSON file: the provenance gate first, then a deep merge onto DEFAULT_PARAMS
 * (fields the file omits keep their defaults; keys the engine does not know are ignored).
 */
/** Model coefficients and logits, which may take any sign. */
const SIGNED = [/^actions\.logits\./, /^pass\.xpass\./, /^shot\.xg\./, /^takeOn\./, /^firstTouch\.b/, /^groundDuel\.b/, /^defending\.tackleBase$/]
/** Probabilities and shares, which must lie in 0..1. */
const PROBABILITIES = new Set([
  "kinematics.reachMargin", "ball.bounce", "execution.mishitBase", "movement.shapeSpeedShare",
  "shot.onTargetRate", "shot.blockPerDefender", "shot.blockPressure", "shot.blockBehind",
  "defending.foulPerTackle", "defending.yellowPerFoul", "defending.redPerFoul", "defending.tackleLooseShare", "defending.interceptLooseShare",
  "defending.crossBlock", "defending.crossBlockBehind", "defending.headClearShare", "defending.headBehind", "defending.clearToTouch", "defending.clearSliceBehind",
  "keeper.letRunShare", "keeper.comeShare", "keeper.catchBase", "keeper.catchHandling", "keeper.fumbleShare",
  "firstTouch.missedShare", "firstTouch.miscontrolShare", "substitutions.windowChance", "substitutions.halfTimeChance"
])

/** Check every number: probabilities in 0..1, coefficients any sign, everything else not negative. */
const checkRanges = (v: unknown, path: string): void => {
  if (Array.isArray(v)) return v.forEach((x) => checkRanges(x, path))
  if (isObject(v)) return Object.entries(v).forEach(([k, x]) => checkRanges(x, path ? `${path}.${k}` : k))
  if (typeof v !== "number" || SIGNED.some((r) => r.test(path))) return
  if (PROBABILITIES.has(path) && (v < 0 || v > 1)) throw new ParamsError(`params field ${path} must be between 0 and 1 (got ${v})`)
  if (v < 0) throw new ParamsError(`params field ${path} must not be negative (got ${v})`)
}

export const paramsFromJson = (json: unknown): Params => {
  if (!isObject(json)) throw new ParamsError("params file must be a JSON object")
  assertProvenance(json as { provenance?: Partial<Provenance> })
  const merged = mergeInto(DEFAULT_PARAMS, json, "params") as Params
  const { provenance: _, ...values } = merged
  checkRanges(values, "")
  return merged
}

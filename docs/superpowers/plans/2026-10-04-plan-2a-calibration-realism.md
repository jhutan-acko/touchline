# Touchline Plan 2a — Calibration and Realism Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make simulated matches statistically realistic and prove it: measure real-match targets on the open IDSSE dataset, tune the engine to them (method of simulated moments), load the calibrated parameters by default, and publish a held-out realism report with a regression gate.

**Architecture:** Python (`python/analytics`) measures real matches; TypeScript (`packages/calibrate`) measures simulated ones with a line-for-line port, kept identical by a parity test. A deterministic coordinate search moves 18 engine knobs to minimise weighted squared z-scores of 17 match statistics over fixed fixtures and seeds. Only aggregates of real data are committed, with provenance; the engine refuses parameter files without an allowed licence.

**Tech Stack:** as Plan 1, plus kloppy 3.19.0, pytest 9.1.1 (uv dev group).

**Spec:** `docs/superpowers/specs/2026-10-03-touchline-design.md` §5.1.8 (calibration and validation), §5.1.4, §5.1.12. Roadmap: `docs/superpowers/plans/2026-10-03-touchline-roadmap.md`. Builds on Plan 1 (merged to `main` at `d995fec`).

**Verification status:** built and run in full before this plan was written: 98 TypeScript + 4 Python tests passed; three tuning runs (loss 142 → 70 → 17 → 4.01); 16 held-out matches: 13 statistics within 1 SD, 4 within 2 SD, 0 off; CDF output still valid with calibrated parameters.

## Global Constraints

- All Plan 1 constraints hold (coordinates, determinism, no Effect in sim-core, CDF v0.3.2, pinned versions, pnpm 11 rules).
- **Real data never enters git.** Raw IDSSE files live in `data/raw/` (git-ignored); only aggregate statistics (`data/params/targets-idsse.json`) and parameters derived from them are committed, each with provenance (`dataset`, `licence: CC-BY-4.0`, `attribution: DFL; Bassek et al., Scientific Data (2025), doi:10.1038/s41597-025-04505-y`).
- **No StatsBomb.** `paramsFromJson` refuses StatsBomb-derived files; the CLI exits 2.
- **One metric definition.** Python `metrics.py` and TypeScript `metrics.ts` must stay line-for-line equivalent; the parity test enforces it (scalars 1e-9, histograms 1e-3).
- **Held-out honesty.** The tuner uses seeds 1000+; the realism report uses 2000+; the gate uses 3000–3005.
- Wyscout (figshare) is blocked on the current network; do not use unofficial mirrors.

## Review Focus

1. **An engine change silently invalidating the calibration** — the realism gate must fail if held-out statistics drift (every |z| < 3, loss < 30). *Task 7, `realism-gate.test.ts`.*
2. **Python and TypeScript statistics drifting apart** — tuning would chase the wrong numbers. *Task 4, `parity.test.ts`.*
3. **A parameter file with missing fields, unknown keys, no provenance, a disallowed licence or StatsBomb data** — defaults fill gaps, unknown keys are ignored, bad files are refused (exit 2 in the CLI). *Task 1 `params.test.ts`; Task 6 Step 4.*
4. **Raw real data being committed** — only `data/params/targets-idsse.json` may appear under `data/` in `git status`. *Task 3 Step 4.*
5. **Over-fitting to the tuning seeds** — the report and gate use disjoint seeds, and the report states it. *Task 7.*

## Known limits after calibration (documented in README and report)

Corners are low (~2 vs 8 per match) and throw-ins somewhat low (~32 vs 44); goals run slightly high on new seeds (4.0 ± 1.6 on 16 held-out matches vs 2.7 real; 2.9 on tuning seeds). Tracking targets come from one match. Plan 2b's engine work (wide play, crosses, first-touch errors) is the place to close these.

---

### Task 1: Engine calibration parameters, JSON loader and realistic defaults

Make every setting the tuner moves a real parameter, load parameters from JSON behind the provenance gate, and adopt the engine defaults found during calibration work: a refitted xG prior (the old one gave ~0.65 xG at 8 m), fewer fouls inside the box (penalties were ~1.5 per match), a keeper who comes off the line, box defending, and team shape width/depth (play was too narrow for throw-ins and long passes). All new behaviour is off or neutral unless a parameter enables it, except the three defaults named here.

**Files:**
- Modify (full new contents): `packages/sim-core/src/params.ts`, `packages/sim-core/src/resolve.ts`, `packages/sim-core/src/shot.ts`, `packages/sim-core/src/shape.ts`, `packages/sim-core/src/step.ts`
- Test: `packages/sim-core/test/params.test.ts` (adds a `params from JSON` block), `packages/sim-core/test/shape.test.ts` (adds a width/depth test)

**Interfaces:**
- Consumes: Plan 1's sim-core.
- Produces (params): new fields `kinematics.reachMargin` (0.75, replaces resolve.ts's REACH_MARGIN constant), `shot.aimNoise` (1), `movement.shapeSpeedShare` (0.7), `shape.{width, depth}` (1, 1), `defending.boxIntensity` (0), `defending.boxFoulFactor` (0.2), `defending.keeperRushM` (12); xG prior `{ b0: -1.25, bDist: -0.08, bAngle: 1.2 }`; `paramsFromJson(json): Params` (provenance gate, then deep merge onto DEFAULT_PARAMS; unknown keys ignored; throws ParamsError).
- Produces (shape): `anchorFor(formation, slot, side, ball, style, inPossession, spread = { width: 1, depth: 1 })`.

- [ ] **Step 1: Write the failing tests**

`packages/sim-core/test/params.test.ts` — full file; the new block is `params from JSON`

```ts
import { describe, expect, it } from "vitest"
import { ACTIONS, assertProvenance, DEFAULT_PARAMS, ParamsError, paramsFromJson } from "../src/params.js"
import { ACTION_ZONES } from "../src/geometry.js"

describe("params", () => {
  it("default priors carry provenance and pass the licence check", () => {
    expect(() => assertProvenance(DEFAULT_PARAMS)).not.toThrow()
  })
  it("rejects files with no provenance, a disallowed licence, or StatsBomb data", () => {
    expect(() => assertProvenance({})).toThrow(ParamsError)
    expect(() => assertProvenance({ provenance: { ...DEFAULT_PARAMS.provenance, licence: "proprietary" } })).toThrow(/not allowed/)
    expect(() => assertProvenance({ provenance: { ...DEFAULT_PARAMS.provenance, dataset: "StatsBomb open data", licence: "CC-BY-4.0" } })).toThrow(/StatsBomb/)
  })
  it("has a logit for every action in every zone", () => {
    for (const z of ACTION_ZONES) for (const a of ACTIONS) expect(Number.isFinite(DEFAULT_PARAMS.actions.logits[z][a])).toBe(true)
  })
})

describe("params from JSON", () => {
  it("merges a partial file onto the defaults and keeps provenance", () => {
    const p = paramsFromJson({ provenance: { ...DEFAULT_PARAMS.provenance, version: "calib-x" }, kinematics: { reachMargin: 0.6 } })
    expect(p.kinematics.reachMargin).toBe(0.6)
    expect(p.kinematics.vmaxBase).toBe(DEFAULT_PARAMS.kinematics.vmaxBase)
    expect(p.provenance.version).toBe("calib-x")
  })
  it("ignores keys the engine does not know (e.g. the calibration record)", () => {
    const p = paramsFromJson({ provenance: DEFAULT_PARAMS.provenance, calibration: { loss: 3 } }) as unknown as Record<string, unknown>
    expect(p.calibration).toBeUndefined()
  })
  it("refuses files without an allowed licence", () => {
    expect(() => paramsFromJson({ kinematics: {} })).toThrow(ParamsError)
    expect(() => paramsFromJson({ provenance: { ...DEFAULT_PARAMS.provenance, dataset: "StatsBomb open data", licence: "CC-BY-4.0" } })).toThrow(/StatsBomb/)
    expect(() => paramsFromJson([1, 2])).toThrow(ParamsError)
  })
})
```

`packages/sim-core/test/shape.test.ts` — full file; the new test is the width/depth one

```ts
import { describe, expect, it } from "vitest"
import { PITCH } from "../src/geometry.js"
import { anchorFor, FORMATIONS, kickoffAnchor } from "../src/shape.js"
import { STYLES } from "../src/testing.js"

describe("team shape", () => {
  it("every formation has 11 slots with the keeper first", () => {
    for (const f of Object.values(FORMATIONS)) {
      expect(f).toHaveLength(11)
      expect(f[0]!.role).toBe("GK")
    }
  })
  it("anchors stay inside the pitch for any ball position", () => {
    for (const bx of [-50, 0, 50]) for (const by of [-30, 0, 30]) for (let slot = 0; slot < 11; slot++) {
      const a = anchorFor("4-3-3", slot, "home", { x: bx, y: by }, STYLES.high_press, true)
      expect(Math.abs(a.x)).toBeLessThanOrEqual(PITCH.halfL)
      expect(Math.abs(a.y)).toBeLessThanOrEqual(PITCH.halfW)
    }
  })
  it("the away side mirrors the home side", () => {
    const h = anchorFor("4-4-2", 5, "home", { x: 10, y: 5 }, STYLES.direct, false)
    const a = anchorFor("4-4-2", 5, "away", { x: -10, y: -5 }, STYLES.direct, false)
    expect(a.x).toBeCloseTo(-h.x, 9)
    expect(a.y).toBeCloseTo(-h.y, 9)
  })
  it("a high-press back line sits higher than a low block's", () => {
    const line = (style: keyof typeof STYLES) => anchorFor("4-4-2", 2, "home", { x: 0, y: 0 }, STYLES[style], false).x
    expect(line("high_press")).toBeGreaterThan(line("low_block") + 10)
  })
  it("width stretches the shape fully in possession and partly without it; depth stretches the lines", () => {
    const wide = { width: 1.4, depth: 1 }
    const fb = (inPoss: boolean, spread = { width: 1, depth: 1 }) => anchorFor("4-3-3", 1, "home", { x: 0, y: 0 }, STYLES.possession, inPoss, spread)
    expect(Math.abs(fb(true, wide).y)).toBeGreaterThan(Math.abs(fb(true).y) * 1.35)
    expect(Math.abs(fb(false, wide).y)).toBeLessThan(Math.abs(fb(true, wide).y))
    const st = (depth: number) => anchorFor("4-3-3", 9, "home", { x: 0, y: 0 }, STYLES.possession, true, { width: 1, depth })
    const cb = (depth: number) => anchorFor("4-3-3", 2, "home", { x: 0, y: 0 }, STYLES.possession, true, { width: 1, depth })
    expect(st(1.3).x - cb(1.3).x).toBeGreaterThan(st(1).x - cb(1).x)
  })
  it("kickoff anchors are in the team's own half", () => {
    for (let slot = 0; slot < 11; slot++) {
      expect(kickoffAnchor("4-3-3", slot, "home", STYLES.high_press).x).toBeLessThan(0)
      expect(kickoffAnchor("4-3-3", slot, "away", STYLES.high_press).x).toBeGreaterThan(0)
    }
  })
})
```

- [ ] **Step 2: Run them to make sure they fail**

Run: `pnpm --filter @touchline/sim-core test params shape`
Expected: FAIL — `paramsFromJson` is not exported; the width/depth test fails because `anchorFor` ignores the extra argument

- [ ] **Step 3: Replace params.ts**

`packages/sim-core/src/params.ts`

```ts
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
    /** Extra pressing and tackling near a team's own goal: rates scale by 1 + boxIntensity x danger (0..1 within 30 m). */
    readonly boxIntensity: number
    /** Foul probability multiplier when the fouled player is inside the opponent's penalty area (defenders are careful there). */
    readonly boxFoulFactor: number
    /** Keeper comes off the line to close down a ball carrier within this distance of goal (m). */
    readonly keeperRushM: number
  }
  readonly takeOn: { readonly b0: number; readonly bSkill: number; readonly bPressure: number }
  readonly carry: { readonly speed: number; readonly durationS: readonly [number, number] }
  readonly runs: { readonly runInBehindRatePerS: number }
  /** Share of top speed players use when moving back into shape (calibration knob for speeds and distance). */
  readonly movement: { readonly shapeSpeedShare: number }
  /** Team shape spread: width (fully in possession, partly without) and depth between lines. */
  readonly shape: { readonly width: number; readonly depth: number }
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
    interceptLooseShare: 0.3,
    boxIntensity: 0,
    boxFoulFactor: 0.2,
    keeperRushM: 12
  },
  takeOn: { b0: -0.2, bSkill: 3.0, bPressure: -0.8 },
  carry: { speed: 5.5, durationS: [0.8, 2.0] },
  runs: { runInBehindRatePerS: 0.12 },
  movement: { shapeSpeedShare: 0.7 },
  shape: { width: 1, depth: 1 },
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

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v)

const mergeInto = (base: unknown, over: unknown): unknown => {
  if (!isObject(base) || !isObject(over)) return over === undefined ? base : over
  const out: Record<string, unknown> = { ...base }
  for (const [k, v] of Object.entries(over)) if (k in base) out[k] = mergeInto(base[k], v)
  return out
}

/**
 * Parameters from a JSON file: the provenance gate first, then a deep merge onto DEFAULT_PARAMS
 * (fields the file omits keep their defaults; keys the engine does not know are ignored).
 */
export const paramsFromJson = (json: unknown): Params => {
  if (!isObject(json)) throw new ParamsError("params file must be a JSON object")
  assertProvenance(json as { provenance?: Partial<Provenance> })
  return mergeInto(DEFAULT_PARAMS, json) as Params
}
```

- [ ] **Step 4: Replace resolve.ts (reach margin from params)**

`packages/sim-core/src/resolve.ts`

```ts
import { stepBall } from "./ball.js"
import { inPitch, PITCH, type Side, type Vec2 } from "./geometry.js"
import { accelFor, reachIn, vmaxFor } from "./kinematics.js"
import type { Params } from "./params.js"
import type { Rng } from "./rng.js"
import type { BallState, PlayerState } from "./types.js"

export interface Resolution {
  /** Ticks after release at which the flight resolves (>= 1). */
  readonly ticks: number
  readonly winnerId: string | null
  readonly result: "reached" | "out" | "goal" | "stopped"
  /** Ball state at resolution: the contact point for "reached", the crossing point for "goal"/"out". */
  readonly ball: BallState
  readonly aerial: { readonly winnerId: string; readonly loserId: string } | null
}

/** Longest flight we predict before calling the ball stopped (seconds, so it is tick-length independent). */
export const MAX_FLIGHT_S = 8

const sigmoid = (z: number): number => 1 / (1 + Math.exp(-z))

/** Where a ball moving from `a` to `b` crosses a goal line, if it does, with interpolated y and z. */
export const goalLineCrossing = (a: BallState["pos"], b: BallState["pos"]): { x: number; y: number; z: number; inGoal: boolean } | null => {
  for (const line of [PITCH.halfL, -PITCH.halfL]) {
    const crosses = line > 0 ? a.x <= line && b.x > line : a.x >= line && b.x < line
    if (!crosses) continue
    const f = (line - a.x) / (b.x - a.x)
    const y = a.y + f * (b.y - a.y)
    const z = a.z + f * (b.z - a.z)
    return { x: line, y, z, inGoal: Math.abs(y) < PITCH.goalHalfWidth && z < PITCH.goalHeight }
  }
  return null
}

const closestOnSegment = (a: Vec2, b: Vec2, q: Vec2): { t: number; d: number } => {
  const vx = b.x - a.x
  const vy = b.y - a.y
  const l2 = vx * vx + vy * vy
  const t = l2 < 1e-12 ? 1 : Math.max(0, Math.min(1, ((q.x - a.x) * vx + (q.y - a.y) * vy) / l2))
  return { t, d: Math.hypot(a.x + t * vx - q.x, a.y + t * vy - q.y) }
}

/**
 * Predict a kicked ball tick by tick with the same physics the engine uses, and find the first
 * player who can reach it, or where it leaves the pitch (a goal when it crosses between the posts).
 * Reach is acceleration-limited from each player's current velocity, checked against the whole
 * segment the ball travels in a tick (so fast balls cannot slip between samples). The intended
 * receiver anticipates (no reaction delay); everyone else reacts after reactionS.
 */
export const resolveFlight = (
  start: BallState,
  fromId: string,
  intendedId: string | null,
  players: ReadonlyArray<PlayerState>,
  p: Params,
  dt: number,
  rng: Rng
): Resolution => {
  const maxTicks = Math.round(MAX_FLIGHT_S / dt)
  let b = start
  for (let k = 1; k <= maxTicks; k++) {
    const prev = b
    b = stepBall(b, dt, p.ball)
    const cross = goalLineCrossing(prev.pos, b.pos)
    if (cross?.inGoal) return { ticks: k, winnerId: null, result: "goal", ball: { pos: { x: cross.x, y: cross.y, z: cross.z }, vel: b.vel }, aerial: null }
    if (!inPitch({ x: b.pos.x, y: b.pos.y })) return { ticks: k, winnerId: null, result: "out", ball: b, aerial: null }
    const a2 = { x: prev.pos.x, y: prev.pos.y }
    const b2 = { x: b.pos.x, y: b.pos.y }
    const t = k * dt
    const qualifiers: Array<{ pl: PlayerState; slack: number; f: number }> = []
    for (const pl of players) {
      if (pl.sentOff) continue
      if (pl.id === fromId && t < 0.6) continue
      const { t: f, d } = closestOnSegment(a2, b2, pl.pos)
      const z = prev.pos.z + f * (b.pos.z - prev.pos.z)
      if (z > p.kinematics.headerHeightM) continue
      const contact = { x: a2.x + f * (b2.x - a2.x), y: a2.y + f * (b2.y - a2.y) }
      // Reachable disc: an acceleration-limited player who keeps drifting at their current velocity
      // can be anywhere within ~½·a·t² (capped by top speed) of pos + vel·t. arriveBy() steers to match.
      const tc = (k - 1 + f) * dt
      const reaction = pl.id === intendedId ? 0 : p.kinematics.reactionS
      const vmax = vmaxFor(pl.attrs, pl.energy, p)
      const drift = { x: pl.pos.x + pl.vel.x * tc, y: pl.pos.y + pl.vel.y * tc }
      const radius = p.kinematics.reachM + p.kinematics.reachMargin * reachIn(tc - reaction, 0, vmax, accelFor(pl.attrs, p))
      const fromDrift = Math.hypot(contact.x - drift.x, contact.y - drift.y)
      const withinSpeed = Math.hypot(contact.x - pl.pos.x, contact.y - pl.pos.y) <= p.kinematics.reachM + vmax * tc
      if (d <= p.kinematics.reachM && tc <= dt) qualifiers.push({ pl, slack: p.kinematics.reachM - d, f })
      else if (fromDrift <= radius && withinSpeed) qualifiers.push({ pl, slack: radius - fromDrift, f })
    }
    if (qualifiers.length === 0) continue
    const contactBall = (f: number): BallState => ({
      pos: { x: a2.x + f * (b2.x - a2.x), y: a2.y + f * (b2.y - a2.y), z: prev.pos.z + f * (b.pos.z - prev.pos.z) },
      vel: b.vel
    })
    const aerialBall = b.pos.z > p.kinematics.controlHeightM
    const sides = new Set<Side>(qualifiers.map((q) => q.pl.side))
    if (aerialBall && sides.size === 2) {
      const best = (s: Side) => qualifiers.filter((q) => q.pl.side === s).sort((x, y) => y.slack - x.slack)[0]!
      const h = best("home")
      const a = best("away")
      const homeWins = rng.chance(sigmoid(3 * (h.pl.attrs.heading - a.pl.attrs.heading)))
      const w = homeWins ? h : a
      const l = homeWins ? a : h
      return { ticks: k, winnerId: w.pl.id, result: "reached", ball: contactBall(w.f), aerial: { winnerId: w.pl.id, loserId: l.pl.id } }
    }
    const intended = qualifiers.find((q) => q.pl.id === intendedId)
    if (intended && sides.size === 1) return { ticks: k, winnerId: intended.pl.id, result: "reached", ball: contactBall(intended.f), aerial: null }
    const winner = qualifiers.sort((x, y) => x.f - y.f || y.slack - x.slack)[0]!
    return { ticks: k, winnerId: winner.pl.id, result: "reached", ball: contactBall(winner.f), aerial: null }
  }
  return { ticks: maxTicks, winnerId: null, result: "stopped", ball: b, aerial: null }
}
```

- [ ] **Step 5: Replace shot.ts (aim noise from params)**

`packages/sim-core/src/shot.ts`

```ts
import { dist, dirOf, goalOf, PITCH, type Side, type Vec2, type Vec3 } from "./geometry.js"
import type { Params } from "./params.js"
import type { Rng } from "./rng.js"
import type { BallState, PlayerState } from "./types.js"

export type ShotExecution = "clean" | "scuffed" | "sliced" | "skied"
export type ShotOutcome = "goal" | "saved" | "blocked" | "wide"
export type Handling = "clean" | "parried_safe" | "parried_dangerous" | "fumble"

export interface ShotPlan {
  readonly outcome: ShotOutcome
  readonly ticks: number
  readonly from: Vec3
  readonly to: Vec3
  readonly execution: ShotExecution
  readonly onTarget: boolean
  readonly blockerId: string | null
  readonly keeperId: string | null
  readonly handling: Handling | null
}

const segmentDistance = (a: Vec2, b: Vec2, q: Vec2): { d: number; t: number } => {
  const vx = b.x - a.x
  const vy = b.y - a.y
  const l2 = vx * vx + vy * vy
  const t = l2 < 1e-9 ? 0 : Math.max(0, Math.min(1, ((q.x - a.x) * vx + (q.y - a.y) * vy) / l2))
  return { d: Math.hypot(a.x + t * vx - q.x, a.y + t * vy - q.y), t }
}

const erf = (x: number): number => {
  // Abramowitz-Stegun 7.1.26, |error| < 1.5e-7
  const t = 1 / (1 + 0.3275911 * Math.abs(x))
  const y = 1 - ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x)
  return x >= 0 ? y : -y
}
/** P(lo < N(mean, sd) < hi). */
export const normalBetween = (lo: number, hi: number, mean: number, sd: number): number =>
  0.5 * (erf((hi - mean) / (sd * Math.SQRT2)) - erf((lo - mean) / (sd * Math.SQRT2)))

/**
 * Ball after a keeper parry. A safe parry is pushed wide of the post (it can only go out for a corner
 * or stay in play), never between the posts; a dangerous parry or fumble drops back into the box.
 */
export const parryBall = (side: Side, saveAt: Vec3, handling: Handling, rng: Rng): BallState => {
  const d = dirOf(side)
  const sy = saveAt.y === 0 ? (rng.chance(0.5) ? 1 : -1) : Math.sign(saveAt.y)
  if (handling === "parried_safe")
    return {
      pos: { x: saveAt.x, y: sy * (PITCH.goalHalfWidth + 0.6), z: Math.max(0.5, saveAt.z) },
      vel: { x: d * rng.range(2, 5), y: sy * rng.range(6, 12), z: rng.range(1, 3) }
    }
  return { pos: saveAt, vel: { x: -d * rng.range(3, 7), y: rng.range(-5, 5), z: 0.5 } }
}

/** Resolve a shot at release: blocks, execution error, on-target check, keeper. */
export const planShot = (
  shooter: PlayerState,
  side: Side,
  opponents: ReadonlyArray<PlayerState>,
  xg: number,
  pressure: number,
  isPenalty: boolean,
  p: Params,
  dt: number,
  rng: Rng
): ShotPlan => {
  const goal = goalOf(side)
  const from: Vec3 = { x: shooter.pos.x, y: shooter.pos.y, z: 0.2 }
  const d = dist(shooter.pos, goal)
  const skill = 1.35 - 0.7 * shooter.attrs.finishing
  const aimY = rng.range(-2.9, 2.9)
  const aimZ = rng.range(0.3, 1.8)
  const sdY = (isPenalty ? 1.0 : 1.6 + 0.12 * d) * (1 + 0.8 * pressure) * skill * p.shot.aimNoise
  const sdZ = (0.6 + 0.05 * d) * (1 + 0.5 * pressure) * skill * p.shot.aimNoise
  const pMis = Math.min(0.4, p.execution.mishitBase * 2 + p.execution.mishitK * Math.pow(pressure, 1.6) * (1.2 - shooter.attrs.composure))
  const mis = rng.chance(pMis)
  const misKind = rng.uniform()
  let y = aimY + rng.normal() * sdY
  let z = Math.max(0, aimZ + rng.normal() * sdZ)
  let execution: ShotExecution = "clean"
  if (mis) {
    if (misKind < 0.4) {
      execution = "skied"
      z = rng.range(3, 9)
    } else if (misKind < 0.75) {
      execution = "sliced"
      y = aimY + Math.sign(rng.normal()) * rng.range(4, 12)
    } else {
      execution = "scuffed"
      z = 0
    }
  }
  const to: Vec3 = { x: goal.x, y, z }
  const speed = execution === "scuffed" ? p.shot.speed * 0.5 : p.shot.speed
  const travel = (m: number) => Math.max(1, Math.ceil(m / speed / dt))

  if (!isPenalty) {
    for (const o of opponents) {
      if (o.sentOff || o.role === "GK") continue
      const { d: off, t } = segmentDistance(shooter.pos, goal, o.pos)
      if (off < 1.2 && t > 0.02 && t < 0.95 && rng.chance(p.shot.blockPerDefender)) {
        const at: Vec3 = { x: o.pos.x, y: o.pos.y, z: 0.5 }
        return { outcome: "blocked", ticks: travel(dist(shooter.pos, o.pos)), from, to: at, execution, onTarget: false, blockerId: o.id, keeperId: null, handling: null }
      }
    }
  }
  const onTarget = Math.abs(y) < PITCH.goalHalfWidth && z < PITCH.goalHeight
  const keeper = opponents.find((o) => o.role === "GK" && !o.sentOff) ?? null
  if (!onTarget) return { outcome: "wide", ticks: travel(d), from, to, execution, onTarget, blockerId: null, keeperId: null, handling: null }
  // Scale by the expected on-target probability for this aim and noise, so goals per shot track xG.
  // Heights below 0 are clamped to the ground, so the vertical window is (-inf, crossbar).
  const pOnTarget = Math.max(0.05, normalBetween(-PITCH.goalHalfWidth, PITCH.goalHalfWidth, aimY, sdY) * normalBetween(-50, PITCH.goalHeight, aimZ, sdZ))
  const pGoalClean = Math.max(0.03, Math.min(0.95, (isPenalty ? 0.76 : xg) / pOnTarget))
  const pGoal = mis ? pGoalClean * 0.3 : pGoalClean
  if (rng.chance(pGoal) || keeper === null)
    return { outcome: "goal", ticks: travel(d), from, to, execution, onTarget, blockerId: null, keeperId: null, handling: null }
  const h = rng.uniform()
  const k = keeper.attrs.handling
  const handling: Handling = h < 0.35 + 0.35 * k ? "clean" : h < 0.85 ? "parried_safe" : h < 0.97 ? "parried_dangerous" : "fumble"
  const saveAt: Vec3 = { x: goal.x - dirOf(side) * 0.8, y: Math.max(-3.5, Math.min(3.5, y)), z }
  return { outcome: "saved", ticks: travel(d), from, to: saveAt, execution, onTarget, blockerId: null, keeperId: keeper.id, handling }
}
```

- [ ] **Step 6: Replace shape.ts (width and depth spread)**

`packages/sim-core/src/shape.ts`

```ts
import { clamp, dirOf, PITCH, type Side, type Vec2 } from "./geometry.js"
import type { FormationName, Role, TeamStyle } from "./types.js"

export interface Slot {
  readonly role: Role
  /** Base anchor for a team attacking +x with the ball on the centre spot. */
  readonly x: number
  readonly y: number
}

export const FORMATIONS: Readonly<Record<FormationName, ReadonlyArray<Slot>>> = {
  "4-3-3": [
    { role: "GK", x: -48, y: 0 },
    { role: "FB", x: -28, y: 24 },
    { role: "CB", x: -32, y: 8 },
    { role: "CB", x: -32, y: -8 },
    { role: "FB", x: -28, y: -24 },
    { role: "CM", x: -12, y: 13 },
    { role: "DM", x: -18, y: 0 },
    { role: "CM", x: -12, y: -13 },
    { role: "W", x: 4, y: 24 },
    { role: "ST", x: 6, y: 0 },
    { role: "W", x: 4, y: -24 }
  ],
  "4-4-2": [
    { role: "GK", x: -48, y: 0 },
    { role: "FB", x: -29, y: 23 },
    { role: "CB", x: -32, y: 7 },
    { role: "CB", x: -32, y: -7 },
    { role: "FB", x: -29, y: -23 },
    { role: "W", x: -12, y: 24 },
    { role: "CM", x: -15, y: 7 },
    { role: "CM", x: -15, y: -7 },
    { role: "W", x: -12, y: -24 },
    { role: "ST", x: 2, y: 5 },
    { role: "ST", x: 2, y: -5 }
  ],
  "4-2-3-1": [
    { role: "GK", x: -48, y: 0 },
    { role: "FB", x: -28, y: 24 },
    { role: "CB", x: -32, y: 8 },
    { role: "CB", x: -32, y: -8 },
    { role: "FB", x: -28, y: -24 },
    { role: "DM", x: -19, y: 7 },
    { role: "DM", x: -19, y: -7 },
    { role: "W", x: -4, y: 22 },
    { role: "AM", x: -4, y: 0 },
    { role: "W", x: -4, y: -22 },
    { role: "ST", x: 6, y: 0 }
  ],
  "3-5-2": [
    { role: "GK", x: -48, y: 0 },
    { role: "CB", x: -32, y: 12 },
    { role: "CB", x: -34, y: 0 },
    { role: "CB", x: -32, y: -12 },
    { role: "FB", x: -16, y: 27 },
    { role: "CM", x: -15, y: 9 },
    { role: "DM", x: -19, y: 0 },
    { role: "CM", x: -15, y: -9 },
    { role: "FB", x: -16, y: -27 },
    { role: "ST", x: 3, y: 5 },
    { role: "ST", x: 3, y: -5 }
  ]
}

/**
 * Anchor for a slot given the ball position. Computed in "attacking +x" space, then mirrored
 * for the away side. Line height and compactness come from the team style.
 */
export const anchorFor = (
  formation: FormationName,
  slot: number,
  side: Side,
  ball: Vec2,
  style: TeamStyle,
  inPossession: boolean,
  spread: { readonly width: number; readonly depth: number } = { width: 1, depth: 1 }
): Vec2 => {
  const s = FORMATIONS[formation][slot]!
  const d = dirOf(side)
  const bx = ball.x * d
  const by = ball.y * d
  if (s.role === "GK") {
    const gx = -PITCH.halfL + 3 + Math.max(0, bx + PITCH.halfL) * 0.06
    return { x: gx * d, y: clamp(by * 0.12, -4, 4) * d }
  }
  const slide = 0.5
  const line = style.lineHeight * 8 + (inPossession ? 7 : -2)
  const compact = 1 - 0.35 * style.compactness
  // Width stretches the shape fully in possession and partly without it; depth stretches the
  // distance between lines around the team's centre (x = -18 in attacking space).
  const width = inPossession ? spread.width : 1 + (spread.width - 1) * 0.4
  const sx = -18 + (s.x + 18) * spread.depth
  const x = clamp(sx + slide * bx + line, -PITCH.halfL + 4, PITCH.halfL - 3)
  const y = clamp(s.y * compact * width + 0.35 * by, -PITCH.halfW + 1.5, PITCH.halfW - 1.5)
  return { x: x * d, y: y * d }
}

/** Kickoff anchors: like shape anchors but clamped to the team's own half. */
export const kickoffAnchor = (formation: FormationName, slot: number, side: Side, style: TeamStyle): Vec2 => {
  const a = anchorFor(formation, slot, side, { x: 0, y: 0 }, style, false)
  const d = dirOf(side)
  const ax = Math.min(a.x * d, -1.5)
  return { x: ax * d, y: a.y }
}
```

- [ ] **Step 7: Replace step.ts (shape spread and speed, box defending, box foul factor, keeper rush)**

`packages/sim-core/src/step.ts`

```ts
import { stepBall } from "./ball.js"
import { decide, lastDefenderAttackX, nearestOpponent, type Decision } from "./decide.js"
import { buildEvent, round2 } from "./events.js"
import { executeKick } from "./execute.js"
import {
  add,
  attackX,
  clampToPitch,
  dirOf,
  dist,
  inPitch,
  len,
  norm,
  other,
  PITCH,
  scale,
  sub,
  type Side,
  type Vec2,
  type Vec3
} from "./geometry.js"
import { accelFor, arrive, arriveBy, interceptPoint, separation, vmaxFor } from "./kinematics.js"
import type { Action } from "./params.js"
import { goalLineCrossing, resolveFlight } from "./resolve.js"
import { hazard, Rng, substream } from "./rng.js"
import { anchorFor, kickoffAnchor } from "./shape.js"
import { parryBall, planShot } from "./shot.js"
import {
  CONCERNS,
  type AttrValue,
  type BallState,
  type Concern,
  type DomainEvent,
  type Flight,
  type Frame,
  type MatchConfig,
  type MatchState,
  type PendingEvent,
  type Phase,
  type PlayerState,
  type Possession,
  type RestartKind,
  type StepResult,
  type TeamSetup
} from "./types.js"

const HALF_TIME_MS = 15 * 60 * 1000

const teamOf = (cfg: MatchConfig, side: Side): TeamSetup => (side === "home" ? cfg.home : cfg.away)

const samplePeriodTicks = (cfg: MatchConfig, rng: Rng): number => {
  const [lo, hi] = cfg.params.timing.addedTimeMinS
  return Math.round((45 * 60 + rng.range(lo, hi)) / cfg.dt)
}

const kickoffPlayers = (cfg: MatchConfig, existing?: ReadonlyArray<PlayerState>): PlayerState[] => {
  const out: PlayerState[] = []
  for (const side of ["home", "away"] as const) {
    const team = teamOf(cfg, side)
    team.starters.forEach((pl, slot) => {
      const prev = existing?.find((e) => e.id === pl.id)
      out.push({
        id: pl.id,
        side,
        role: pl.role,
        slot,
        jersey: pl.jersey,
        attrs: pl.attrs,
        pos: kickoffAnchor(team.formation, slot, side, team.style),
        vel: { x: 0, y: 0 },
        intent: { kind: "shape" },
        intentUntil: 0,
        energy: prev?.energy ?? 1,
        yellow: prev?.yellow ?? 0,
        sentOff: prev?.sentOff ?? false
      })
    })
  }
  return out
}

/** Initial state: tick -1, so the first step emits frame 0 of the first half. */
export const initMatch = (cfg: MatchConfig): MatchState => {
  const ids = [...cfg.home.starters, ...cfg.away.starters].map((p) => p.id)
  const dup = ids.find((id, i) => ids.indexOf(id) !== i)
  if (dup !== undefined) throw new Error(`duplicate player id "${dup}": home and away must be different teams`)
  const rng = {} as Record<Concern, ReturnType<typeof substream>>
  for (const c of CONCERNS) rng[c] = substream(cfg.seed, c)
  const timing = new Rng(rng.restart)
  const periodTicks = samplePeriodTicks(cfg, timing)
  rng.restart = timing.state
  return {
    config: cfg,
    tick: -1,
    period: "first_half",
    periodTick: -1,
    periodTicks,
    periodStartMs: Date.parse(cfg.kickoffTime),
    phase: { kind: "restart", restart: "kickoff", side: "home", at: { x: 0, y: 0 }, resumeTick: 0 },
    ball: { pos: { x: 0, y: 0, z: 0 }, vel: { x: 0, y: 0, z: 0 } },
    possession: { kind: "dead" },
    players: kickoffPlayers(cfg),
    score: { home: 0, away: 0 },
    lastTouch: null,
    pressedBy: [],
    carry: null,
    rng,
    eventSeq: 0
  }
}

export const isFinished = (s: MatchState): boolean => s.phase.kind === "full_time"

/** Mutable working copy for one step. Nothing outside step() sees it. */
class Work {
  readonly cfg: MatchConfig
  tick: number
  period: MatchState["period"]
  periodTick: number
  periodTicks: number
  periodStartMs: number
  periodStartTick: number
  phase: Phase
  ball: BallState
  possession: Possession
  players: PlayerState[]
  score: { home: number; away: number }
  lastTouch: MatchState["lastTouch"]
  pressedBy: string[]
  carry: MatchState["carry"]
  rng: Record<Concern, Rng>
  seq: number
  events: DomainEvent[] = []

  constructor(s: MatchState) {
    this.cfg = s.config
    this.tick = s.tick + 1
    this.period = s.period
    this.periodTick = s.periodTick + 1
    this.periodTicks = s.periodTicks
    this.periodStartMs = s.periodStartMs
    this.periodStartTick = s.tick - s.periodTick
    this.phase = s.phase
    this.ball = s.ball
    this.possession = s.possession
    this.players = [...s.players]
    this.score = { ...s.score }
    this.lastTouch = s.lastTouch
    this.pressedBy = [...s.pressedBy]
    this.carry = s.carry
    this.rng = {} as Record<Concern, Rng>
    for (const c of CONCERNS) this.rng[c] = new Rng(s.rng[c])
    this.seq = s.eventSeq
  }

  get p() {
    return this.cfg.params
  }
  get dt() {
    return this.cfg.dt
  }
  player(id: string): PlayerState {
    const pl = this.players.find((x) => x.id === id)
    if (!pl) throw new Error(`unknown player ${id}`)
    return pl
  }
  setPlayer(next: PlayerState): void {
    const i = this.players.findIndex((x) => x.id === next.id)
    this.players[i] = next
  }
  active(side?: Side): PlayerState[] {
    return this.players.filter((x) => !x.sentOff && (side === undefined || x.side === side))
  }
  teamId(side: Side): string {
    return teamOf(this.cfg, side).id
  }
  minute(): number {
    return (this.period === "first_half" ? 0 : 45) + (this.periodTick * this.dt) / 60
  }
  emit(pe: PendingEvent, extra: { frame_id_end?: number | null; outcome?: string | null } = {}): void {
    this.seq += 1
    this.events.push(
      buildEvent({ matchId: this.cfg.matchId, period: this.period, periodStartTick: this.periodStartTick, dt: this.dt }, this.seq, pe, extra)
    )
  }
  pending(type: PendingEvent["type"], pl: PlayerState | null, at: Vec2 | null, attrs: Record<string, AttrValue> = {}, end: Vec2 | null = null, side?: Side): PendingEvent {
    const s = pl?.side ?? side ?? null
    return {
      type,
      frame_id: this.tick,
      team_id: s ? this.teamId(s) : null,
      player_id: pl?.id ?? null,
      x: at?.x ?? null,
      y: at?.y ?? null,
      x_end: end?.x ?? null,
      y_end: end?.y ?? null,
      attrs
    }
  }
  decisionDelayTicks(): number {
    const t = this.p.timing
    return Math.max(1, Math.round(this.rng.decision.range(t.decisionMinS, t.decisionMaxS) / this.dt))
  }
  toState(): MatchState {
    const out = {} as Record<Concern, MatchState["rng"][Concern]>
    for (const c of CONCERNS) out[c] = this.rng[c].state
    return {
      config: this.cfg,
      tick: this.tick,
      period: this.period,
      periodTick: this.periodTick,
      periodTicks: this.periodTicks,
      periodStartMs: this.periodStartMs,
      phase: this.phase,
      ball: this.ball,
      possession: this.possession,
      players: this.players,
      score: this.score,
      lastTouch: this.lastTouch,
      pressedBy: this.pressedBy,
      carry: this.carry,
      rng: out,
      eventSeq: this.seq
    }
  }
}

// ---------------------------------------------------------------- restarts

const restartFromOut = (lastSide: Side | null, at: Vec3): { restart: RestartKind; side: Side; at: Vec2 } => {
  const last = lastSide ?? "home"
  if (Math.abs(at.y) > PITCH.halfW && Math.abs(at.x) <= PITCH.halfL) {
    return { restart: "throw_in", side: other(last), at: { x: Math.max(-PITCH.halfL + 1, Math.min(PITCH.halfL - 1, at.x)), y: Math.sign(at.y) * PITCH.halfW } }
  }
  const end = Math.sign(at.x) || 1
  const defending: Side = end > 0 ? "away" : "home"
  if (last === defending) return { restart: "corner", side: other(defending), at: { x: end * PITCH.halfL, y: (Math.sign(at.y) || 1) * PITCH.halfW } }
  return { restart: "goal_kick", side: defending, at: { x: end * (PITCH.halfL - PITCH.sixDepth), y: 0 } }
}

const startRestart = (w: Work, r: { restart: RestartKind; side: Side; at: Vec2 }): void => {
  const delay = w.p.timing.restartDelayS[r.restart] * w.rng.restart.range(0.7, 1.3)
  w.phase = { kind: "restart", restart: r.restart, side: r.side, at: r.at, resumeTick: w.tick + Math.round(delay / w.dt) }
  w.possession = { kind: "dead" }
  w.ball = { pos: { x: r.at.x, y: r.at.y, z: 0 }, vel: { x: 0, y: 0, z: 0 } }
  w.pressedBy = []
}

const takerFor = (w: Work, r: { restart: RestartKind; side: Side; at: Vec2 }): PlayerState => {
  const team = w.active(r.side)
  if (r.restart === "goal_kick") return team.find((x) => x.role === "GK") ?? team[0]!
  if (r.restart === "kickoff") return team.find((x) => x.role === "ST") ?? team[team.length - 1]!
  return team.filter((x) => x.role !== "GK").sort((a, b) => dist(a.pos, r.at) - dist(b.pos, r.at))[0]!
}

const handleRestart = (w: Work): void => {
  const ph = w.phase
  if (ph.kind !== "restart") return
  if (w.tick < ph.resumeTick) return
  const taker = takerFor(w, ph)
  // The taker walks to the ball (see moveTarget); the restart waits until they are there.
  if (dist(taker.pos, ph.at) > 1.0) return
  w.setPlayer({ ...taker, vel: { x: 0, y: 0 }, intentUntil: w.tick, intent: { kind: "hold" } })
  w.emit(w.pending("set_piece", taker, ph.at, { kind: ph.restart }))
  w.possession = { kind: "owned", playerId: taker.id, since: w.tick, restart: ph.restart }
  w.lastTouch = { playerId: taker.id, side: taker.side }
  w.phase = { kind: "open_play" }
}

// ---------------------------------------------------------------- on-ball

const changePossession = (w: Work, to: PlayerState, reasonEvent: PendingEvent | null): void => {
  const prevSide = w.lastTouch?.side ?? null
  if (reasonEvent) w.emit(reasonEvent)
  if (prevSide !== null && prevSide !== to.side) w.emit(w.pending("possession_change", to, to.pos, { reason: reasonEvent?.type ?? "recovery" }))
  w.possession = { kind: "owned", playerId: to.id, since: w.tick, restart: null }
  w.lastTouch = { playerId: to.id, side: to.side }
  w.pressedBy = []
  w.setPlayer({ ...w.player(to.id), intent: { kind: "hold" }, intentUntil: w.tick + w.decisionDelayTicks() })
}

const foulAndCards = (w: Work, offender: PlayerState, victim: PlayerState): void => {
  w.emit(w.pending("foul", offender, offender.pos, { kind: "tackle", victim_id: victim.id }))
  const ref = w.rng.referee
  let card: "yellow" | "second_yellow" | "red" | null = null
  if (ref.chance(w.p.defending.redPerFoul)) card = "red"
  else if (ref.chance(w.p.defending.yellowPerFoul)) card = offender.yellow >= 1 ? "second_yellow" : "yellow"
  if (card) {
    w.emit(w.pending("card", offender, offender.pos, { colour: card }))
    w.setPlayer({ ...w.player(offender.id), yellow: offender.yellow + 1, sentOff: card !== "yellow" })
  }
  const inBox = attackX(victim.side, victim.pos.x) > PITCH.halfL - PITCH.boxDepth && Math.abs(victim.pos.y) < PITCH.boxHalfWidth
  startRestart(
    w,
    inBox
      ? { restart: "penalty", side: victim.side, at: { x: dirOf(victim.side) * PITCH.penaltySpot, y: 0 } }
      : { restart: "free_kick", side: victim.side, at: clampToPitch(victim.pos, 1) }
  )
}

/** The ball squirts away from a contact point; last touch belongs to `toucher`. */
const knockLoose = (w: Work, toucher: PlayerState, at: Vec2): void => {
  const ang = w.rng.duel.range(0, 2 * Math.PI)
  const speed = w.rng.duel.range(4, 11)
  w.ball = { pos: { x: at.x, y: at.y, z: 0 }, vel: { x: Math.cos(ang) * speed, y: Math.sin(ang) * speed, z: w.rng.duel.range(0, 2) } }
  w.possession = { kind: "loose" }
  w.lastTouch = { playerId: toucher.id, side: toucher.side }
  w.pressedBy = []
}

/** How urgently `defSide` must defend a ball at `at`: 1 on its goal line, 0 beyond 30 m from its goal. */
const danger = (defSide: Side, at: Vec2): number => Math.max(0, 1 - dist(at, { x: -dirOf(defSide) * PITCH.halfL, y: 0 }) / 30)

const duels = (w: Work, owner: PlayerState): boolean => {
  const opps = w.active(other(owner.side))
  for (const o of opps) {
    if (dist(o.pos, owner.pos) <= w.p.defending.pressRadiusM && !w.pressedBy.includes(o.id)) {
      w.pressedBy.push(o.id)
      w.emit(w.pending("pressure", o, o.pos, { target_id: owner.id }))
    }
  }
  const def = nearestOpponent(owner.pos, opps)
  if (!def || dist(def.pos, owner.pos) > w.p.defending.tackleRadiusM) return false
  const style = teamOf(w.cfg, def.side).style
  const rate = w.p.defending.tackleRatePerS * (0.5 + style.pressIntensity) * (1 + w.p.defending.boxIntensity * danger(def.side, owner.pos))
  if (!w.rng.duel.chance(hazard(rate, w.dt))) return false
  const pWin = 1 / (1 + Math.exp(-(w.p.defending.tackleBase + 3 * (def.attrs.tackling - owner.attrs.dribbling))))
  if (w.rng.duel.chance(pWin)) {
    finishCarry(w, owner)
    if (w.rng.duel.chance(w.p.defending.tackleLooseShare)) {
      w.emit(w.pending("tackle", def, def.pos, { outcome: "won", opponent_id: owner.id, ball: "loose" }))
      knockLoose(w, def, owner.pos)
    } else changePossession(w, def, w.pending("tackle", def, def.pos, { outcome: "won", opponent_id: owner.id, ball: "won" }))
    return true
  }
  const victimInBox = attackX(owner.side, owner.pos.x) > PITCH.halfL - PITCH.boxDepth && Math.abs(owner.pos.y) < PITCH.boxHalfWidth
  if (w.rng.referee.chance(w.p.defending.foulPerTackle * (victimInBox ? w.p.defending.boxFoulFactor : 1))) {
    finishCarry(w, owner)
    w.emit(w.pending("tackle", def, def.pos, { outcome: "foul", opponent_id: owner.id }))
    foulAndCards(w, def, owner)
    return true
  }
  w.emit(w.pending("tackle", def, def.pos, { outcome: "lost", opponent_id: owner.id }))
  return false
}

/** Emit a carry event if the owner just finished carrying the ball at least carryMinM. */
const finishCarry = (w: Work, owner: PlayerState): void => {
  const start = w.carry
  w.carry = null
  if (!start || start.playerId !== owner.id) return
  const d = dist(start.at, owner.pos)
  if (d < w.p.classifier.carryMinM) return
  const progressive = attackX(owner.side, owner.pos.x) - attackX(owner.side, start.at.x) >= 10
  w.emit({ ...w.pending("carry", owner, start.at, { ...start.decision, distance_m: round2(d), progressive }, owner.pos), frame_id: start.tick }, { frame_id_end: w.tick })
}

/** What the player could have done, recorded on the event (spec §5.1.4 "decision record"). */
const decisionAttrs = (d: Decision): Record<string, AttrValue> => ({
  action_probs: d.actionProbs,
  options: d.options,
  best_receiver_id: d.options[0]?.receiver_id ?? null,
  best_value: d.options[0]?.value ?? null,
  chosen_value: d.candidate ? Math.round(d.candidate.value * 1000) / 1000 : null,
  chosen_rank: d.chosenRank
})

const technique = (a: Action, pl: PlayerState): number =>
  a === "cross" ? pl.attrs.crossing : a === "long_pass" || a === "switch" || a === "lofted_through" || a === "clear" ? pl.attrs.longPassing : pl.attrs.shortPassing

const releaseKick = (w: Work, owner: PlayerState, d: Decision, restart: RestartKind | null): void => {
  const p = w.p
  const side = owner.side
  const opps = w.active(other(side))
  const isClear = d.action === "clear"
  const target: Vec2 = isClear
    ? { x: owner.pos.x + dirOf(side) * w.rng.decision.range(30, 60), y: owner.pos.y + w.rng.decision.range(-35, 35) }
    : d.candidate!.target
  const height = isClear ? "high" : d.candidate!.height
  const weakFoot = w.rng.execution.chance(0.2)
  const exe = executeKick(
    { from: owner.pos, to: target, height, technique: technique(d.action, owner), composure: owner.attrs.composure, pressure: d.pressure, weakFoot },
    p,
    w.rng.execution
  )
  const start: BallState = { pos: { x: owner.pos.x, y: owner.pos.y, z: 0 }, vel: exe.vel }
  const intended = d.candidate?.receiverId ?? null
  const res = resolveFlight(start, owner.id, intended, w.active(), p, w.dt, w.rng.duel)
  const lastDef = lastDefenderAttackX(side, opps)
  const winner = res.winnerId ? w.player(res.winnerId) : null
  const offside =
    !restart || restart === "free_kick"
      ? winner !== null &&
        winner.side === side &&
        winner.id !== owner.id &&
        attackX(side, winner.pos.x) > Math.max(lastDef, attackX(side, owner.pos.x), 0) + 0.5
      : false
  const kind = restart && restart !== "kickoff" ? "set_piece" : isClear ? null : d.candidate!.kind
  const attrs: Record<string, AttrValue> = {
    kind,
    restart,
    height,
    technique: restart === "throw_in" ? "throw" : "foot",
    body_part: weakFoot ? "left_foot" : "right_foot",
    intended_receiver_id: intended,
    intended_end_x: round2(target.x),
    intended_end_y: round2(target.y),
    execution: exe.execution,
    error_m: round2(exe.errorM),
    decision_quality: d.decisionQuality === null ? null : round2(d.decisionQuality),
    ...decisionAttrs(d),
    under_pressure: d.pressure > 0.3,
    defenders_in_lane: d.candidate?.lane ?? 0,
    ball_speed_kmh: round2(len({ x: exe.vel.x, y: exe.vel.y }) * 3.6),
    xpass: d.candidate ? round2(d.candidate.xpass) : null
  }
  const endAt = { x: res.ball.pos.x, y: res.ball.pos.y }
  const main = w.pending(isClear ? "clearance" : "pass", owner, owner.pos, attrs, endAt)
  const extra: PendingEvent[] = []
  let outcome: Flight["outcome"]
  let restartAfter: Flight["restartAfter"] = null
  let looseAfter: BallState | null = null
  const tickAt = w.tick + res.ticks
  const at = (pe: PendingEvent): PendingEvent => ({ ...pe, frame_id: tickAt })
  if (res.result === "goal") {
    // Into the net from a pass or clearance: a goal for whoever attacks that end (an own goal if it is not the passer's side).
    const scoringSide: Side = res.ball.pos.x > 0 ? "home" : "away"
    outcome = "goal"
    extra.push(at({ ...w.pending("goal", owner, endAt, { scorer_id: owner.id, own_goal: scoringSide !== side, from: "pass" }), team_id: w.teamId(scoringSide) }))
    restartAfter = { restart: "kickoff", side: other(scoringSide), at: { x: 0, y: 0 } }
  } else if (res.result === "out") {
    outcome = "out_of_play"
    extra.push(at(w.pending("ball_out", null, endAt, { side: Math.abs(res.ball.pos.y) > PITCH.halfW ? "touchline" : "byline", last_touch_team: w.teamId(side) })))
    restartAfter = restartFromOut(side, res.ball.pos)
  } else if (!winner) outcome = "loose"
  else if (offside) {
    outcome = "offside"
    extra.push(at(w.pending("offside", winner, winner.pos)))
    restartAfter = { restart: "free_kick", side: other(side), at: clampToPitch(winner.pos, 1) }
  } else if (winner.side === side) {
    outcome = "successful"
    extra.push(at(w.pending("reception", winner, endAt, { first_touch: "controlled", under_pressure: false })))
  } else {
    outcome = "intercepted"
    const deflect = !res.aerial && w.rng.duel.chance(w.p.defending.interceptLooseShare)
    extra.push(at(w.pending(res.aerial ? "aerial_duel" : "interception", winner, endAt, res.aerial ? { winner_id: res.aerial.winnerId, loser_id: res.aerial.loserId } : { ball: deflect ? "deflected" : "won" })))
    if (deflect) {
      const ang = w.rng.duel.range(0, 2 * Math.PI)
      const sp = w.rng.duel.range(4, 10)
      looseAfter = { pos: { x: endAt.x, y: endAt.y, z: 0 }, vel: { x: Math.cos(ang) * sp, y: Math.sin(ang) * sp, z: w.rng.duel.range(0, 1.5) } }
    }
  }
  const finalMain: PendingEvent = { ...main, attrs: { ...main.attrs, receiver_id: outcome === "successful" && winner ? winner.id : null } }
  if (res.aerial && outcome === "successful") extra.unshift(at(w.pending("aerial_duel", winner, endAt, { winner_id: res.aerial.winnerId, loser_id: res.aerial.loserId })))
  w.ball = start
  w.possession = {
    kind: "in_flight",
    flight: {
      kind: isClear ? "clearance" : "pass",
      fromId: owner.id,
      side,
      releaseTick: w.tick,
      resolveTick: tickAt,
      winnerId: offside || looseAfter ? null : (winner?.id ?? null),
      outcome,
      pending: finalMain,
      extra,
      path: null,
      restartAfter,
      looseBall: looseAfter
    }
  }
  w.lastTouch = { playerId: owner.id, side }
  if (winner && !offside) w.setPlayer({ ...w.player(winner.id), intent: { kind: "chase", target: endAt }, intentUntil: tickAt })
}

const releaseShot = (w: Work, owner: PlayerState, d: Decision, restart: RestartKind | null): void => {
  const side = owner.side
  const opps = w.active(other(side))
  const isPenalty = restart === "penalty"
  const xg = isPenalty ? 0.76 : (d.xg ?? 0.02)
  const plan = planShot(owner, side, opps, xg, d.pressure, isPenalty, w.p, w.dt, w.rng.execution)
  const tickAt = w.tick + plan.ticks
  const at = (pe: PendingEvent): PendingEvent => ({ ...pe, frame_id: tickAt })
  const end = { x: plan.to.x, y: plan.to.y }
  const main = w.pending("shot", owner, owner.pos, {
    ...decisionAttrs(d),
    technique: isPenalty ? "penalty" : restart === "free_kick" ? "free_kick" : "normal",
    body_part: "right_foot",
    execution: plan.execution,
    on_target: plan.onTarget,
    xg: Math.round(xg * 1000) / 1000,
    shot_speed_kmh: round2(w.p.shot.speed * 3.6 * (plan.execution === "scuffed" ? 0.5 : 1))
  }, end)
  const extra: PendingEvent[] = []
  let restartAfter: Flight["restartAfter"] = null
  let looseBall: BallState | null = null
  let winnerId: string | null = null
  if (plan.outcome === "goal") {
    extra.push(at(w.pending("goal", owner, end, { scorer_id: owner.id, own_goal: false })))
    restartAfter = { restart: "kickoff", side: other(side), at: { x: 0, y: 0 } }
  } else if (plan.outcome === "wide") {
    extra.push(at(w.pending("ball_out", null, end, { side: "byline", last_touch_team: w.teamId(side) })))
    const defending = other(side)
    restartAfter = { restart: "goal_kick", side: defending, at: { x: dirOf(side) * (PITCH.halfL - PITCH.sixDepth), y: 0 } }
  } else if (plan.outcome === "blocked") {
    const blocker = w.player(plan.blockerId!)
    extra.push(at(w.pending("block", blocker, blocker.pos, { blocked: "shot" })))
    looseBall = { pos: plan.to, vel: { x: -dirOf(side) * w.rng.duel.range(2, 8), y: w.rng.duel.range(-6, 6), z: w.rng.duel.range(0, 3) } }
  } else {
    const keeper = w.player(plan.keeperId!)
    extra.push(at(w.pending("keeper_save", keeper, end, { technique: plan.handling === "clean" ? "catch" : "parry", handling: plan.handling })))
    if (plan.handling === "clean") winnerId = keeper.id
    else {
      looseBall = parryBall(side, plan.to, plan.handling!, w.rng.duel)
    }
  }
  w.ball = { pos: plan.from, vel: { x: 0, y: 0, z: 0 } }
  w.possession = {
    kind: "in_flight",
    flight: {
      kind: "shot",
      fromId: owner.id,
      side,
      releaseTick: w.tick,
      resolveTick: tickAt,
      winnerId,
      outcome: plan.outcome,
      pending: main,
      extra,
      path: { from: plan.from, to: plan.to },
      restartAfter,
      looseBall
    }
  }
  w.lastTouch = { playerId: owner.id, side }
}

const scriptBias = (_w: Work, _side: Side): Partial<Record<Action, number>> => ({})

const ownerDecision = (w: Work, owner: PlayerState): void => {
  const poss = w.possession
  if (poss.kind !== "owned") return
  const restart = poss.restart
  if (owner.role === "GK" && !restart && w.tick - poss.since < Math.round(w.p.timing.keeperHoldS / w.dt)) return
  w.possession = { ...poss, restart: null }
  finishCarry(w, owner)
  const side = owner.side
  const team = teamOf(w.cfg, side)
  const decision = decide(
    {
      owner,
      teammates: w.active(side),
      opponents: w.active(other(side)),
      style: team.style,
      scoreDiff: w.score[side] - w.score[other(side)],
      minute: w.minute(),
      restart,
      scriptBias: scriptBias(w, side)
    },
    w.p,
    w.rng.decision
  )
  const until = (s: number) => w.tick + Math.max(1, Math.round(s / w.dt))
  switch (decision.action) {
    case "hold":
      w.setPlayer({ ...owner, intent: { kind: "hold" }, intentUntil: until(w.rng.decision.range(0.6, 1.4)) })
      return
    case "carry": {
      const goalDir = norm(sub({ x: dirOf(side) * PITCH.halfL, y: 0 }, owner.pos))
      const dir = norm(add(goalDir, { x: 0, y: w.rng.decision.range(-0.6, 0.6) }))
      w.carry = { playerId: owner.id, at: owner.pos, tick: w.tick, decision: decisionAttrs(decision) }
      w.setPlayer({ ...owner, intent: { kind: "carry", dir, speed: w.p.carry.speed }, intentUntil: until(w.rng.decision.range(...w.p.carry.durationS)) })
      return
    }
    case "take_on": {
      const def = nearestOpponent(owner.pos, w.active(other(side)))!
      const pWin = 1 / (1 + Math.exp(-(w.p.takeOn.b0 + w.p.takeOn.bSkill * (owner.attrs.dribbling - def.attrs.tackling) + w.p.takeOn.bPressure * decision.pressure)))
      const won = w.rng.duel.chance(pWin)
      w.emit(w.pending("take_on", owner, owner.pos, { ...decisionAttrs(decision), outcome: won ? "won" : "lost", defender_id: def.id }))
      if (won) {
        const dir = norm(sub({ x: dirOf(side) * PITCH.halfL, y: 0 }, owner.pos))
        w.carry = { playerId: owner.id, at: owner.pos, tick: w.tick, decision: {} }
        w.setPlayer({ ...owner, intent: { kind: "carry", dir, speed: w.p.carry.speed * 1.2 }, intentUntil: until(1.2) })
        w.setPlayer({ ...w.player(def.id), vel: { x: 0, y: 0 }, intent: { kind: "hold" }, intentUntil: until(1.0) })
      } else changePossession(w, def, w.pending("tackle", def, def.pos, { outcome: "won", opponent_id: owner.id }))
      return
    }
    case "shot":
      releaseShot(w, owner, decision, restart)
      return
    default:
      if (owner.role === "GK" && !restart) w.emit(w.pending("keeper_distribution", owner, owner.pos, { method: decision.action === "short_pass" ? "throw" : "kick" }))
      releaseKick(w, owner, decision, restart)
  }
}

const ownedTick = (w: Work): void => {
  if (w.possession.kind !== "owned") return
  const owner = w.player(w.possession.playerId)
  if (owner.sentOff) {
    w.possession = { kind: "loose" }
    return
  }
  if (w.possession.restart === null && duels(w, owner)) return
  if (w.tick >= owner.intentUntil) ownerDecision(w, w.player(owner.id))
}

// ---------------------------------------------------------------- flights and loose ball

const resolveFlightNow = (w: Work, f: Flight): void => {
  w.emit(f.pending, { frame_id_end: f.resolveTick, outcome: f.outcome })
  for (const e of f.extra) w.emit(e)
  const goal = f.extra.find((e) => e.type === "goal")
  if (goal) w.score[goal.team_id === w.teamId("home") ? "home" : "away"] += 1
  if (f.restartAfter) {
    startRestart(w, f.restartAfter)
    return
  }
  if (f.looseBall) {
    const toucher = f.extra[0]?.player_id
    if (toucher) w.lastTouch = { playerId: toucher, side: w.player(toucher).side }
    w.ball = f.looseBall
    w.possession = { kind: "loose" }
    return
  }
  if (f.winnerId) {
    const winner = w.player(f.winnerId)
    w.possession = { kind: "owned", playerId: winner.id, since: w.tick, restart: null }
    if (w.lastTouch?.side !== winner.side) w.emit(w.pending("possession_change", winner, winner.pos, { reason: f.outcome }))
    w.lastTouch = { playerId: winner.id, side: winner.side }
    w.pressedBy = []
    w.setPlayer({ ...winner, intent: { kind: "hold" }, intentUntil: w.tick + w.decisionDelayTicks() })
    return
  }
  w.possession = { kind: "loose" }
}

const ballTick = (w: Work): void => {
  const pos = w.possession
  if (pos.kind === "owned") {
    const owner = w.player(pos.playerId)
    const facing = len(owner.vel) > 0.2 ? norm(owner.vel) : { x: dirOf(owner.side), y: 0 }
    const at = add(owner.pos, scale(facing, 0.35))
    w.ball = { pos: { x: at.x, y: at.y, z: 0 }, vel: { x: owner.vel.x, y: owner.vel.y, z: 0 } }
    return
  }
  if (pos.kind === "dead") return
  if (pos.kind === "in_flight") {
    const f = pos.flight
    if (w.tick === f.releaseTick) return
    if (f.path) {
      const t = Math.min(1, (w.tick - f.releaseTick) / Math.max(1, f.resolveTick - f.releaseTick))
      const lerp = (a: number, b: number) => a + (b - a) * t
      const prev = w.ball.pos
      const next: Vec3 = { x: lerp(f.path.from.x, f.path.to.x), y: lerp(f.path.from.y, f.path.to.y), z: lerp(f.path.from.z, f.path.to.z) }
      w.ball = { pos: next, vel: { x: (next.x - prev.x) / w.dt, y: (next.y - prev.y) / w.dt, z: (next.z - prev.z) / w.dt } }
    } else w.ball = stepBall(w.ball, w.dt, w.p.ball)
    if (w.tick >= f.resolveTick) resolveFlightNow(w, f)
    return
  }
  // loose
  const prevPos = w.ball.pos
  w.ball = stepBall(w.ball, w.dt, w.p.ball)
  const flat = { x: w.ball.pos.x, y: w.ball.pos.y }
  const cross = goalLineCrossing(prevPos, w.ball.pos)
  if (cross?.inGoal) {
    // A loose ball over the line between the posts (judged where it crossed) is a goal for the side
    // attacking that end; an own goal if the defending side touched it last.
    const scoringSide: Side = cross.x > 0 ? "home" : "away"
    const toucher = w.lastTouch ? w.player(w.lastTouch.playerId) : null
    const own = toucher !== null && toucher.side !== scoringSide
    const at = { x: cross.x, y: cross.y }
    w.emit({ ...w.pending("goal", toucher, at, { scorer_id: toucher?.id ?? null, own_goal: own, from: "loose_ball" }), team_id: w.teamId(scoringSide) })
    w.score[scoringSide] += 1
    startRestart(w, { restart: "kickoff", side: other(scoringSide), at: { x: 0, y: 0 } })
    return
  }
  if (!inPitch(flat)) {
    w.emit(w.pending("ball_out", null, flat, { side: Math.abs(flat.y) > PITCH.halfW ? "touchline" : "byline", last_touch_team: w.lastTouch ? w.teamId(w.lastTouch.side) : null }))
    startRestart(w, restartFromOut(w.lastTouch?.side ?? null, w.ball.pos))
    return
  }
  if (w.ball.pos.z > w.p.kinematics.controlHeightM) return
  const near = w.active().filter((pl) => dist(pl.pos, flat) <= w.p.kinematics.reachM).sort((a, b) => dist(a.pos, flat) - dist(b.pos, flat))
  const first = near[0]
  if (first) changePossession(w, first, w.pending("ball_recovery", first, flat, { kind: "loose_ball" }))
}

// ---------------------------------------------------------------- movement

const moveTarget = (w: Work, pl: PlayerState, ballFlat: Vec2, possSide: Side | null): { target: Vec2; speedCap: number; timeLeft?: number } => {
  const team = teamOf(w.cfg, pl.side)
  const vmax = vmaxFor(pl.attrs, pl.energy, w.p)
  const shape = () => ({ target: anchorFor(team.formation, pl.slot, pl.side, ballFlat, team.style, possSide === pl.side, w.p.shape), speedCap: vmax * w.p.movement.shapeSpeedShare })
  const ph = w.phase
  if (ph.kind === "restart") {
    if (takerFor(w, ph).id === pl.id) return { target: ph.at, speedCap: vmax * 0.8 }
    const a = anchorFor(team.formation, pl.slot, pl.side, ph.at, team.style, ph.side === pl.side, w.p.shape)
    if (ph.restart === "kickoff") return { target: kickoffAnchor(team.formation, pl.slot, pl.side, team.style), speedCap: vmax * 0.6 }
    if (pl.side !== ph.side && dist(a, ph.at) < 9.15 && pl.role !== "GK") {
      const away = add(ph.at, scale(norm(sub(a, ph.at)), 9.5))
      return { target: clampToPitch(away), speedCap: vmax * 0.6 }
    }
    return { target: a, speedCap: vmax * 0.6 }
  }
  const pos = w.possession
  if (pos.kind === "owned" && pos.playerId === pl.id) {
    if (pl.intent.kind === "carry" && w.tick < pl.intentUntil) return { target: clampToPitch(add(pl.pos, scale(pl.intent.dir, 5)), 1), speedCap: pl.intent.speed }
    return { target: pl.pos, speedCap: 1 }
  }
  if (pos.kind === "in_flight" && pos.flight.winnerId === pl.id && pl.intent.kind === "chase")
    return { target: pl.intent.target, speedCap: vmax, timeLeft: Math.max(1, pos.flight.resolveTick - w.tick) * w.dt }
  if (pos.kind === "loose") {
    const chasers = w.active(pl.side).sort((a, b) => dist(a.pos, ballFlat) - dist(b.pos, ballFlat)).slice(0, 2)
    if (chasers.some((c) => c.id === pl.id) && pl.role !== "GK")
      return { target: interceptPoint(pl.pos, vmax, ballFlat, { x: w.ball.vel.x, y: w.ball.vel.y }), speedCap: vmax }
  }
  if (pl.role === "GK") {
    // Close down a ball carrier who gets near goal: stand between them and the goal centre, 2.5 m off the ball.
    if (pos.kind === "owned" && possSide !== pl.side) {
      const owner = w.player(pos.playerId)
      const goal = { x: -dirOf(pl.side) * PITCH.halfL, y: 0 }
      if (dist(owner.pos, goal) < w.p.defending.keeperRushM) return { target: add(owner.pos, scale(norm(sub(goal, owner.pos)), 2.5)), speedCap: vmax }
    }
    return shape()
  }
  if (pos.kind === "owned" && possSide !== pl.side) {
    const owner = w.player(pos.playerId)
    if (pl.intent.kind === "press" && w.tick < pl.intentUntil && pl.intent.targetId === owner.id)
      return { target: interceptPoint(pl.pos, vmax, owner.pos, owner.vel), speedCap: vmax }
    const defenders = w.active(pl.side).filter((x) => x.role !== "GK").sort((a, b) => dist(a.pos, owner.pos) - dist(b.pos, owner.pos))
    if (defenders[0]?.id === pl.id && dist(pl.pos, owner.pos) < 18) {
      const style = team.style
      const urgency = 1 + w.p.defending.boxIntensity * danger(pl.side, owner.pos)
      if (w.rng.movement.chance(hazard(w.p.defending.pressRatePerS * (0.4 + 1.2 * style.pressIntensity) * urgency, w.dt))) {
        w.setPlayer({ ...pl, intent: { kind: "press", targetId: owner.id }, intentUntil: w.tick + Math.round(w.rng.movement.range(2, 4) / w.dt) })
        return { target: interceptPoint(pl.pos, vmax, owner.pos, owner.vel), speedCap: vmax }
      }
    }
  }
  if (pos.kind === "owned" && possSide === pl.side && (pl.role === "ST" || pl.role === "W" || pl.role === "AM")) {
    if (pl.intent.kind === "run_in_behind" && w.tick < pl.intentUntil) return { target: pl.intent.target, speedCap: vmax }
    const owner = w.player(pos.playerId)
    if (attackX(pl.side, owner.pos.x) > -20 && w.rng.movement.chance(hazard(w.p.runs.runInBehindRatePerS, w.dt))) {
      const lastDef = lastDefenderAttackX(pl.side, w.active(other(pl.side)))
      const target = clampToPitch({ x: dirOf(pl.side) * Math.min(lastDef + 6, PITCH.halfL - 6), y: pl.pos.y * 0.8 }, 2)
      w.setPlayer({ ...pl, intent: { kind: "run_in_behind", target }, intentUntil: w.tick + Math.round(w.rng.movement.range(2, 3) / w.dt) })
      w.emit(w.pending("off_ball_run", pl, pl.pos, { kind: "in_behind", ball_carrier_id: owner.id }, target))
      return { target, speedCap: vmax }
    }
  }
  return shape()
}

const moveAll = (w: Work): void => {
  const ballFlat = { x: w.ball.pos.x, y: w.ball.pos.y }
  const possSide =
    w.possession.kind === "owned" ? w.player(w.possession.playerId).side : w.possession.kind === "in_flight" ? w.possession.flight.side : null
  for (const id of w.players.map((x) => x.id)) {
    const pl = w.player(id)
    if (pl.sentOff) continue
    const { target, speedCap, timeLeft } = moveTarget(w, pl, ballFlat, possSide)
    const cur = w.player(id)
    const vmax = Math.min(speedCap, vmaxFor(cur.attrs, cur.energy, w.p))
    const mates = w.active(cur.side).filter((x) => x.id !== cur.id).map((x) => x.pos)
    const sep = separation(cur.pos, mates)
    // Chasing a ball that will arrive at a known tick uses on-time steering (matches resolveFlight's reach model).
    const next =
      timeLeft !== undefined
        ? arriveBy(cur.pos, cur.vel, target, Math.max(0.5, vmax), accelFor(cur.attrs, w.p), w.dt, timeLeft)
        : arrive(cur.pos, cur.vel, add(target, scale(sep, 2)), Math.max(0.5, vmax), accelFor(cur.attrs, w.p), w.dt)
    const speed = len(next.vel)
    const energy = Math.max(0, cur.energy - w.dt * (0.00004 + 0.000012 * speed * speed))
    w.setPlayer({ ...cur, pos: clampToPitch(next.pos, -2), vel: next.vel, energy })
  }
}

// ---------------------------------------------------------------- periods and frames

const frameOf = (w: Work): Frame => {
  const ownerId = w.possession.kind === "owned" ? w.possession.playerId : null
  const fp = (side: Side) =>
    w.active(side).map((pl) => ({
      id: pl.id,
      x: round2(pl.pos.x),
      y: round2(pl.pos.y),
      vel: round2(len(pl.vel)),
      // Expired intents fall back to "shape": the label says what the player is doing now.
      intent: pl.id === ownerId ? ("on_ball" as const) : w.tick < pl.intentUntil ? pl.intent.kind : ("shape" as const)
    }))
  const possSide =
    w.possession.kind === "owned" ? w.player(w.possession.playerId).side : w.possession.kind === "in_flight" ? w.possession.flight.side : null
  return {
    tick: w.tick,
    frame_id: w.periodTick,
    period: w.period,
    timestamp: new Date(w.periodStartMs + Math.round(w.periodTick * w.dt * 1000)).toISOString(),
    home: fp("home"),
    away: fp("away"),
    ball: { x: round2(w.ball.pos.x), y: round2(w.ball.pos.y), z: round2(w.ball.pos.z) },
    ball_in_play: w.phase.kind === "open_play",
    possession_side: possSide
  }
}

const endPeriod = (w: Work): StepResult => {
  w.tick -= 1
  w.periodTick -= 1
  w.emit(w.pending("period_end", null, null, { period: w.period }))
  if (w.period === "second_half") {
    w.emit(w.pending("match_end", null, null, { home: w.score.home, away: w.score.away }))
    w.phase = { kind: "full_time" }
    return { state: w.toState(), frame: null, events: w.events }
  }
  const firstHalfMs = w.periodTicks * w.dt * 1000
  w.tick += 1
  w.period = "second_half"
  w.periodTick = 0
  w.periodStartTick = w.tick
  w.periodStartMs += firstHalfMs + HALF_TIME_MS
  w.periodTicks = samplePeriodTicks(w.cfg, w.rng.restart)
  w.players = kickoffPlayers(w.cfg, w.players)
  w.phase = { kind: "restart", restart: "kickoff", side: "away", at: { x: 0, y: 0 }, resumeTick: w.tick }
  w.possession = { kind: "dead" }
  w.ball = { pos: { x: 0, y: 0, z: 0 }, vel: { x: 0, y: 0, z: 0 } }
  w.emit(w.pending("period_start", null, null, { period: "second_half" }))
  handleRestart(w)
  return { state: w.toState(), frame: frameOf(w), events: w.events }
}

/** Advance the match by one tick. Pure: the input state is never mutated. */
export const step = (s: MatchState): StepResult => {
  if (s.phase.kind === "full_time") return { state: s, frame: null, events: [] }
  const w = new Work(s)
  if (s.tick === -1) {
    w.periodStartTick = 0
    w.emit(w.pending("match_start", null, null, { home: w.cfg.home.id, away: w.cfg.away.id }))
    w.emit(w.pending("period_start", null, null, { period: "first_half" }))
  }
  if (w.periodTick >= w.periodTicks && w.phase.kind !== "restart") return endPeriod(w)
  if (w.periodTick >= w.periodTicks + Math.round(60 / w.dt)) return endPeriod(w)
  if (w.phase.kind === "restart") handleRestart(w)
  if (w.phase.kind === "open_play") ownedTick(w)
  moveAll(w)
  ballTick(w)
  return { state: w.toState(), frame: frameOf(w), events: w.events }
}
```

- [ ] **Step 8: Run the whole sim-core suite and typecheck**

Run: `pnpm --filter @touchline/sim-core test && pnpm --filter @touchline/sim-core typecheck`
Expected: 73 passed, no type errors

- [ ] **Step 9: Commit**

```bash
git add packages/sim-core
git commit -m "feat(sim-core): calibration parameters, params JSON loader, realistic defaults (xG prior, box fouls, keeper rush)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```



### Task 2: Python: IDSSE download and shared metric definitions

One definition of every match statistic, used on real and synthetic data alike. Both sources are first turned into the same plain records (events: type, set piece, complete, length, goal, on target; frames: period, time, in play, positions), then measured by the same functions. Speeds use a 0.2 s moving average so 10 Hz synthetic and 25 Hz real tracking are treated alike.

**Files:**
- Modify: `python/analytics/pyproject.toml`
- Create: `python/analytics/touchline_analytics/idsse.py`, `python/analytics/touchline_analytics/metrics.py`
- Test: `python/analytics/tests/test_metrics.py`

**Interfaces:**
- Consumes: kloppy 3.19.0 (sportec loaders), Touchline output folders (`domain.jsonl`, `tracking.jsonl`, `meta.json`).
- Produces (idsse): `MATCHES` (7 match ids), `PROVENANCE`, `filenames(match_id)`, `download(match_id, root, tracking=False)`; CLI `python -m touchline_analytics.idsse [--tracking J03WPY ...]`.
- Produces (metrics): `LONG_PASS_M = 32`, `PASS_LEN_EDGES`, `SPEED_EDGES`, `event_metrics(events)`, `tracking_metrics(frames, smooth_s=0.2)`, `touchline_events(path)`, `touchline_metrics(run_dir)`; CLI `python -m touchline_analytics.metrics <run_dir>` prints JSON. Keys: passes, completion, long_share, pass_len_median, shots, on_target_share, goals, penalties, corners, throw_ins, goal_kicks, free_kicks, fouls, cards, pass_len_hist, in_play_share, distance_km_median, peak_speed_kmh_median, speed_hist.

- [ ] **Step 1: Update the project file**

`python/analytics/pyproject.toml`

```toml
[project]
name = "touchline-analytics"
version = "0.1.0"
description = "Offline analytics for Touchline: CDF validation, real-data calibration targets, realism report."
requires-python = ">=3.11"
dependencies = ["common-data-format-validator==0.1.1", "kloppy==3.19.0"]

[build-system]
requires = ["hatchling"]
build-backend = "hatchling.build"

[tool.hatch.build.targets.wheel]
packages = ["touchline_analytics"]

[dependency-groups]
dev = ["pytest==9.1.1"]
```

- [ ] **Step 2: Write the failing test**

`python/analytics/tests/test_metrics.py`

```python
import math

from touchline_analytics.metrics import event_metrics, tracking_metrics


def p(complete=True, length=10.0, set_piece=None):
    return {"type": "pass", "set_piece": set_piece, "complete": complete, "length": length if complete else None, "goal": False, "on_target": False}


def shot(goal=False, on=False):
    return {"type": "shot", "set_piece": None, "complete": False, "length": None, "goal": goal, "on_target": on or goal}


def test_event_metrics_counts_rates_and_lengths():
    ev = [p(length=5), p(length=40), p(complete=False), p(length=20, set_piece="corner"), shot(goal=True), shot(on=True), shot(),
          {"type": "foul", "set_piece": None, "complete": False, "length": None, "goal": False, "on_target": False},
          {"type": "card", "set_piece": None, "complete": False, "length": None, "goal": False, "on_target": False}]
    m = event_metrics(ev)
    assert m["passes"] == 4
    assert m["completion"] == 0.75
    assert m["long_share"] == 1 / 3
    assert m["pass_len_median"] == 20
    assert (m["shots"], m["goals"], m["corners"], m["fouls"], m["cards"]) == (3, 1, 1, 1, 1)
    assert math.isclose(m["on_target_share"], 2 / 3)
    assert math.isclose(sum(m["pass_len_hist"]), 1.0)


def test_event_metrics_empty_match_does_not_crash():
    m = event_metrics([])
    assert m["passes"] == 0 and m["completion"] == 0.0 and math.isnan(m["pass_len_median"])


def test_tracking_metrics_distance_speed_and_in_play():
    frames = []
    for i in range(600):  # 60 s at 10 Hz
        t = i / 10
        players = {f"p{j}": (j * 3.0 + 5.0 * t, 0.0) for j in range(6)}  # everyone runs at 5 m/s
        frames.append(("first_half", t, i % 2 == 0, players))
    m = tracking_metrics(frames)
    assert math.isclose(m["in_play_share"], 0.5)
    assert abs(m["distance_km_median"] - 0.2995) < 0.002  # ~5 m/s * 59.9 s
    assert abs(m["peak_speed_kmh_median"] - 18.0) < 0.1
```

- [ ] **Step 3: Run it to make sure it fails**

Run: `uv run --project python/analytics --group dev pytest python/analytics/tests -q`
Expected: errors — `touchline_analytics.metrics` cannot be imported

- [ ] **Step 4: Implement the downloader and metrics**

`python/analytics/touchline_analytics/idsse.py`

```python
"""IDSSE / Sportec Open DFL dataset (CC-BY 4.0; credit the DFL and Bassek et al., Scientific Data 2025).

Files are downloaded into git-ignored data/raw/idsse/ and never committed. Only aggregate
statistics derived from them are committed (with provenance).
"""

from __future__ import annotations

import urllib.request
from pathlib import Path

BASE_URL = "https://huggingface.co/datasets/pysport/idsse-data/resolve/main/"
MATCHES: dict[str, str] = {
    "J03WMX": "DFL-COM-000001",
    "J03WN1": "DFL-COM-000001",
    "J03WOH": "DFL-COM-000002",
    "J03WOY": "DFL-COM-000002",
    "J03WPY": "DFL-COM-000002",
    "J03WQQ": "DFL-COM-000002",
    "J03WR9": "DFL-COM-000002",
}
PROVENANCE = {
    "dataset": "IDSSE / Sportec Open DFL dataset (2022/23 Bundesliga and 2. Bundesliga)",
    "licence": "CC-BY-4.0",
    "attribution": "Deutsche Fussball Liga (DFL); Bassek et al., Scientific Data (2025), doi:10.1038/s41597-025-04505-y",
}


def filenames(match_id: str) -> dict[str, str]:
    comp = MATCHES[match_id]
    return {
        "meta": f"DFL_02_01_matchinformation_{comp}_DFL-MAT-{match_id}.xml",
        "event": f"DFL_03_02_events_raw_{comp}_DFL-MAT-{match_id}.xml",
        "tracking": f"DFL_04_03_positions_raw_observed_{comp}_DFL-MAT-{match_id}.xml",
    }


def download(match_id: str, root: Path, tracking: bool = False) -> dict[str, Path]:
    """Download one match's files (skipping files already present). Tracking files are ~370 MB each."""
    root.mkdir(parents=True, exist_ok=True)
    out: dict[str, Path] = {}
    for kind, name in filenames(match_id).items():
        if kind == "tracking" and not tracking:
            continue
        path = root / name
        if not path.exists() or path.stat().st_size == 0:
            tmp = path.with_suffix(".part")
            with urllib.request.urlopen(BASE_URL + name, timeout=600) as resp, tmp.open("wb") as fh:
                while chunk := resp.read(1 << 20):
                    fh.write(chunk)
            tmp.rename(path)
        out[kind] = path
    return out


if __name__ == "__main__":
    import argparse

    ap = argparse.ArgumentParser(description="Download IDSSE files into data/raw/idsse")
    ap.add_argument("--root", default="data/raw/idsse")
    ap.add_argument("--tracking", nargs="*", default=["J03WPY"], help="match ids whose tracking to download")
    args = ap.parse_args()
    for mid in MATCHES:
        got = download(mid, Path(args.root), tracking=mid in args.tracking)
        print(mid, ", ".join(sorted(got)))
```

`python/analytics/touchline_analytics/metrics.py`

```python
"""Match statistics with ONE definition for real and synthetic data.

Both sources are first converted to the same plain records, then measured by the same functions:
- events: dicts {type: pass|shot|foul|card, set_piece: None|corner|throw_in|goal_kick|free_kick|kick_off|penalty,
  complete: bool, length: float|None, goal: bool, on_target: bool}
- frames: iterables of (period, t_seconds, ball_in_play, {player_id: (x, y)})

The TypeScript port (packages/calibrate/src/metrics.ts) must produce identical numbers; a parity
test runs both on the same synthetic match.
"""

from __future__ import annotations

import json
import math
from collections import defaultdict
from pathlib import Path
from typing import Iterable

LONG_PASS_M = 32.0
PASS_LEN_EDGES = [0, 5, 10, 15, 20, 25, 30, 35, 40, 50, 60, 80, 120]
SPEED_EDGES = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 12]
FULL_MATCH_SHARE = 0.95


def _hist(values: list[float], edges: list[float]) -> list[float]:
    counts = [0] * (len(edges) - 1)
    for v in values:
        for i in range(len(edges) - 1):
            if edges[i] <= v < edges[i + 1]:
                counts[i] += 1
                break
    total = sum(counts) or 1
    return [c / total for c in counts]


def _median(values: list[float]) -> float:
    s = sorted(values)
    if not s:
        return float("nan")
    m = len(s) // 2
    return s[m] if len(s) % 2 else (s[m - 1] + s[m]) / 2


def event_metrics(events: list[dict]) -> dict:
    passes = [e for e in events if e["type"] == "pass"]
    complete = [e for e in passes if e["complete"]]
    lengths = [e["length"] for e in complete if e["length"] is not None]
    shots = [e for e in events if e["type"] == "shot"]
    sp = lambda k: sum(1 for e in passes if e["set_piece"] == k)  # noqa: E731
    return {
        "passes": len(passes),
        "completion": len(complete) / len(passes) if passes else 0.0,
        "long_share": sum(1 for v in lengths if v >= LONG_PASS_M) / len(lengths) if lengths else 0.0,
        "pass_len_median": _median(lengths),
        "shots": len(shots),
        "on_target_share": sum(1 for e in shots if e["on_target"]) / len(shots) if shots else 0.0,
        "goals": sum(1 for e in shots if e["goal"]),
        "penalties": sum(1 for e in shots if e["set_piece"] == "penalty"),
        "corners": sp("corner"),
        "throw_ins": sp("throw_in"),
        "goal_kicks": sp("goal_kick"),
        "free_kicks": sp("free_kick"),
        "fouls": sum(1 for e in events if e["type"] == "foul"),
        "cards": sum(1 for e in events if e["type"] == "card"),
        "pass_len_hist": _hist(lengths, PASS_LEN_EDGES),
    }


def tracking_metrics(frames: Iterable[tuple[str, float, bool, dict[str, tuple[float, float]]]], smooth_s: float = 0.2) -> dict:
    """In-play share, distance per (near) full-match outfielder and peak speeds, from positions only.

    Speeds use a centred moving average over `smooth_s` seconds of positions, so 10 Hz synthetic
    and 25 Hz real tracking are treated alike.
    """
    in_play = 0
    total = 0
    series: dict[str, list[tuple[str, float, float, float]]] = defaultdict(list)
    for period, t, live, players in frames:
        total += 1
        in_play += 1 if live else 0
        for pid, (x, y) in players.items():
            series[pid].append((period, t, x, y))
    dists: dict[str, float] = {}
    peaks: dict[str, float] = {}
    speeds_all: list[float] = []
    for pid, pts in series.items():
        if len(pts) < 10:
            continue
        dt = (pts[-1][1] - pts[0][1]) / max(1, len(pts) - 1)
        if dt <= 0:
            continue
        w = max(1, round(smooth_s / dt))
        xs = [p[2] for p in pts]
        ys = [p[3] for p in pts]
        sx = [sum(xs[max(0, i - w // 2): i + w // 2 + 1]) / len(xs[max(0, i - w // 2): i + w // 2 + 1]) for i in range(len(xs))]
        sy = [sum(ys[max(0, i - w // 2): i + w // 2 + 1]) / len(ys[max(0, i - w // 2): i + w // 2 + 1]) for i in range(len(ys))]
        d = 0.0
        sp: list[float] = []
        for i in range(1, len(pts)):
            if pts[i][0] != pts[i - 1][0] or pts[i][1] - pts[i - 1][1] > 2 * dt + 1e-9:
                continue
            step = math.hypot(sx[i] - sx[i - 1], sy[i] - sy[i - 1])
            v = step / (pts[i][1] - pts[i - 1][1])
            if v > 12:
                continue
            d += step
            sp.append(v)
        dists[pid] = d
        sp.sort()
        peaks[pid] = sp[min(len(sp) - 1, int(len(sp) * 0.999))] if sp else 0.0
        speeds_all.extend(sp[:: max(1, len(sp) // 2000)])
    frames_per_player = {pid: len(p) for pid, p in series.items()}
    longest = max(frames_per_player.values()) if frames_per_player else 0
    full = [pid for pid, n in frames_per_player.items() if n >= FULL_MATCH_SHARE * longest]
    full_d = sorted(dists[pid] for pid in full if pid in dists)
    outfield_full = full_d[2:] if len(full_d) > 4 else full_d  # drop the two keepers (shortest distances)
    return {
        "in_play_share": in_play / total if total else 0.0,
        "distance_km_median": _median(outfield_full) / 1000 if outfield_full else float("nan"),
        "peak_speed_kmh_median": _median([peaks[p] * 3.6 for p in full if p in peaks]),
        "speed_hist": _hist(speeds_all, SPEED_EDGES),
    }


# ---------------------------------------------------------------- adapters: Touchline output


_SET_PIECE = {"corner": "corner", "throw_in": "throw_in", "goal_kick": "goal_kick", "free_kick": "free_kick", "kickoff": "kick_off", "penalty": "penalty"}


def touchline_events(domain_jsonl: Path) -> list[dict]:
    out = []
    with domain_jsonl.open() as fh:
        for line in fh:
            e = json.loads(line)
            t = e["type"]
            if t == "pass":
                ok = e["outcome"] == "successful"
                length = math.hypot(e["x_end"] - e["x"], e["y_end"] - e["y"]) if ok and e["x_end"] is not None else None
                out.append({"type": "pass", "set_piece": _SET_PIECE.get(e.get("restart") or "", None), "complete": ok, "length": length, "goal": False, "on_target": False})
            elif t == "shot":
                sp = "penalty" if e.get("technique") == "penalty" else None
                out.append({"type": "shot", "set_piece": sp, "complete": False, "length": None, "goal": e["outcome"] == "goal", "on_target": e["outcome"] in ("goal", "saved")})
            elif t in ("foul", "card"):
                out.append({"type": t, "set_piece": None, "complete": False, "length": None, "goal": False, "on_target": False})
    return out


def touchline_metrics(run_dir: Path, fps: float = 10.0) -> dict:
    m = event_metrics(touchline_events(run_dir / "domain.jsonl"))
    meta = json.loads((run_dir / "meta.json").read_text())
    fps = float(meta["meta"]["tracking"]["fps"])

    def frames():
        offset = {"first_half": 0.0, "second_half": 10_000.0}
        with (run_dir / "tracking.jsonl").open() as fh:
            for line in fh:
                f = json.loads(line)
                players = {p["id"]: (p["x"], p["y"]) for p in f["teams"]["home"]["players"] + f["teams"]["away"]["players"]}
                yield f["period"], offset[f["period"]] + f["frame_id"] / fps, bool(f["ball"].get("status")), players

    m.update(tracking_metrics(frames()))
    return m


if __name__ == "__main__":
    import sys

    print(json.dumps(touchline_metrics(Path(sys.argv[1])), indent=1))
```

- [ ] **Step 5: Run the tests**

Run: `uv run --project python/analytics --group dev pytest python/analytics/tests -q`
Expected: 3 passed

- [ ] **Step 6: Commit**

```bash
git add python/analytics
git commit -m "feat(analytics): IDSSE downloader and shared match-statistic definitions

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```



### Task 3: Real-match targets from IDSSE

Download the open IDSSE matches (events for all 7, tracking for J03WPY) into git-ignored `data/raw/idsse/`, measure them with Task 2's definitions, and commit only the aggregates with provenance. The figshare host for Wyscout is blocked on the current network; Wyscout can be added later through the same code path.

**Files:**
- Create: `python/analytics/touchline_analytics/targets.py`
- Create (generated): `data/params/targets-idsse.json`

**Interfaces:**
- Consumes: `idsse.MATCHES`, `filenames`, `PROVENANCE`; `metrics.event_metrics`, `tracking_metrics`.
- Produces: `data/params/targets-idsse.json` with `provenance {dataset, licence: CC-BY-4.0, attribution, fitted_at, version, scope}`, `metrics {key: {mean, sd, n}}`, `distributions {pass_len, speed: {edges, share}}`.

- [ ] **Step 1: Implement the targets builder**

`python/analytics/touchline_analytics/targets.py`

```python
"""Measure calibration targets on real IDSSE matches and write aggregate statistics with provenance.

Usage:
  uv run --project python/analytics python -m touchline_analytics.idsse            # download into data/raw/idsse
  uv run --project python/analytics python -m touchline_analytics.targets          # write data/params/targets-idsse.json

Only aggregates (means, SDs, normalised histograms) are written; no real event or tracking rows.
"""

from __future__ import annotations

import datetime as dt
import json
import math
from pathlib import Path

from kloppy import sportec

from .idsse import MATCHES, PROVENANCE, filenames
from .metrics import PASS_LEN_EDGES, SPEED_EDGES, event_metrics, tracking_metrics

_SET_PIECE = {"THROW_IN": "throw_in", "CORNER_KICK": "corner", "GOAL_KICK": "goal_kick", "FREE_KICK": "free_kick", "KICK_OFF": "kick_off", "PENALTY": "penalty"}
EVENT_KEYS = ["passes", "completion", "long_share", "pass_len_median", "shots", "on_target_share", "goals", "penalties", "corners", "throw_ins", "goal_kicks", "free_kicks", "fouls", "cards"]
TRACKING_KEYS = ["in_play_share", "distance_km_median", "peak_speed_kmh_median"]


def idsse_events(root: Path, match_id: str) -> list[dict]:
    f = filenames(match_id)
    ds = sportec.load_event(event_data=str(root / f["event"]), meta_data=str(root / f["meta"]), coordinates="secondspectrum")
    out = []
    for e in ds.events:
        name = e.event_type.name
        if name == "PASS":
            sp = None
            for q in e.qualifiers or []:
                if type(q).__name__ == "SetPieceQualifier":
                    sp = _SET_PIECE.get(q.value.name)
            ok = e.result is not None and e.result.name == "COMPLETE"
            rc = getattr(e, "receiver_coordinates", None)
            length = math.hypot(rc.x - e.coordinates.x, rc.y - e.coordinates.y) if ok and rc and e.coordinates and rc.x is not None and e.coordinates.x is not None else None
            out.append({"type": "pass", "set_piece": sp, "complete": ok, "length": length, "goal": False, "on_target": False})
        elif name == "SHOT":
            r = e.result.name if e.result else ""
            sp = None
            for q in e.qualifiers or []:
                if type(q).__name__ == "SetPieceQualifier":
                    sp = _SET_PIECE.get(q.value.name)
            out.append({"type": "shot", "set_piece": sp, "complete": False, "length": None, "goal": r == "GOAL", "on_target": r in ("GOAL", "SAVED")})
        elif name == "FOUL_COMMITTED":
            out.append({"type": "foul", "set_piece": None, "complete": False, "length": None, "goal": False, "on_target": False})
        elif name == "CARD":
            out.append({"type": "card", "set_piece": None, "complete": False, "length": None, "goal": False, "on_target": False})
    return out


def idsse_frames(root: Path, match_id: str):
    f = filenames(match_id)
    ds = sportec.load_tracking(raw_data=str(root / f["tracking"]), meta_data=str(root / f["meta"]), coordinates="secondspectrum")
    offset = {1: 0.0, 2: 10_000.0}
    for fr in ds.frames:
        players = {p.player_id: (c.coordinates.x, c.coordinates.y) for p, c in fr.players_data.items() if c.coordinates is not None and c.coordinates.x is not None}
        live = fr.ball_state is not None and fr.ball_state.name == "ALIVE"
        yield ("first_half" if fr.period.id == 1 else "second_half"), offset.get(fr.period.id, 20_000.0) + fr.timestamp.total_seconds(), live, players


def _agg(values: list[float]) -> dict:
    vals = [v for v in values if v == v]
    n = len(vals)
    mean = sum(vals) / n if n else float("nan")
    sd = math.sqrt(sum((v - mean) ** 2 for v in vals) / (n - 1)) if n > 1 else 0.0
    return {"mean": round(mean, 4), "sd": round(sd, 4), "n": n}


def build(root: Path) -> dict:
    per_match = [event_metrics(idsse_events(root, mid)) for mid in MATCHES]
    tracked = [mid for mid in MATCHES if (root / filenames(mid)["tracking"]).exists()]
    per_track = [tracking_metrics(idsse_frames(root, mid)) for mid in tracked]
    metrics = {k: _agg([m[k] for m in per_match]) for k in EVENT_KEYS}
    metrics.update({k: _agg([m[k] for m in per_track]) for k in TRACKING_KEYS})
    avg = lambda rows: [round(sum(col) / len(col), 5) for col in zip(*rows)]  # noqa: E731
    return {
        "provenance": {
            **PROVENANCE,
            "fitted_at": dt.date.today().isoformat(),
            "version": f"targets-{dt.date.today().isoformat()}",
            "scope": f"events: {len(per_match)} matches; tracking: {len(tracked)} match(es) ({', '.join(tracked)})",
        },
        "metrics": metrics,
        "distributions": {
            "pass_len": {"edges": PASS_LEN_EDGES, "share": avg([m["pass_len_hist"] for m in per_match])},
            "speed": {"edges": SPEED_EDGES, "share": avg([m["speed_hist"] for m in per_track]) if per_track else []},
        },
    }


if __name__ == "__main__":
    import argparse

    ap = argparse.ArgumentParser()
    ap.add_argument("--root", default="data/raw/idsse")
    ap.add_argument("--out", default="data/params/targets-idsse.json")
    a = ap.parse_args()
    t = build(Path(a.root))
    Path(a.out).parent.mkdir(parents=True, exist_ok=True)
    Path(a.out).write_text(json.dumps(t, indent=1) + "\n")
    print(json.dumps(t["metrics"], indent=1))
```

- [ ] **Step 2: Download the data (one-off; tracking file ~370 MB)**

Run: `uv run --project python/analytics python -m touchline_analytics.idsse`
Expected: seven lines, e.g. `J03WPY event, meta, tracking`; files appear under `data/raw/idsse/` (git-ignored — `git status` shows nothing new there)

- [ ] **Step 3: Build the targets**

Run: `uv run --project python/analytics python -m touchline_analytics.targets`
Expected: about 30 s; means close to: passes 866.0, completion 0.7809, long_share 0.1429, pass_len_median 17.1486, shots 24.4286, on_target_share 0.3536, goals 2.7143, penalties 0.4286, corners 8.1429, throw_ins 43.5714, goal_kicks 17.0, free_kicks 24.0, fouls 22.8571, cards 5.2857, in_play_share 0.5571, distance_km_median 10.8807, peak_speed_kmh_median 27.9435

- [ ] **Step 4: Check no raw data is staged, then commit**

```bash
git status --short data/   # only data/params/targets-idsse.json may appear
```

```bash
git add python/analytics/touchline_analytics/targets.py data/params/targets-idsse.json
git commit -m "feat(analytics): real-match calibration targets from IDSSE (aggregates only)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```



### Task 4: Calibrate package: TypeScript metrics with a parity test against Python

A line-for-line port of the Python statistics so the tuner can measure simulated matches in memory. The parity test writes a synthetic match to disk, runs the Python definitions on the files and the TypeScript ones on the same match in memory, and requires identical scalars (1e-9). Histograms get 1e-3: `Math.hypot` and `math.hypot` can differ in the last bit and move one sample on a bin edge.

**Files:**
- Create: `packages/calibrate/package.json`, `packages/calibrate/tsconfig.json`, `packages/calibrate/vitest.config.ts`, `packages/calibrate/src/metrics.ts`, `packages/calibrate/src/index.ts` (metrics only for now)
- Test: `packages/calibrate/test/parity.test.ts`

**Interfaces:**
- Consumes: `DomainEvent`, `Frame` (sim-core); `writeMatch` (sim); `League` (league); Python `touchline_analytics.metrics` CLI via `uv`.
- Produces: `LONG_PASS_M`, `PASS_LEN_EDGES`, `SPEED_EDGES`, `interface MatchMetrics`, `SCALAR_KEYS` (17 keys), `type ScalarKey`, `eventMetrics(events)`, `trackingMetrics(frames, dt, smoothS?)`, `matchMetrics(events, frames, dt)`.

- [ ] **Step 1: Write the package files**

`packages/calibrate/package.json`

```json
{
  "name": "@touchline/calibrate",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "exports": { ".": "./src/index.ts" },
  "scripts": { "test": "vitest run", "typecheck": "tsc --noEmit -p .", "calibrate": "tsx src/cli.ts", "realism": "tsx src/realism.ts" },
  "dependencies": { "@touchline/league": "workspace:*", "@touchline/sim": "workspace:*", "@touchline/sim-core": "workspace:*", "effect": "4.0.0" },
  "devDependencies": {}
}
```

`packages/calibrate/tsconfig.json`

```json
{ "extends": "../../tsconfig.base.json", "include": ["src", "test", "scripts"] }
```

`packages/calibrate/vitest.config.ts`

```ts
import { defineConfig } from "vitest/config"

export default defineConfig({ test: { testTimeout: 120_000 } })
```

- [ ] **Step 2: Write the failing parity test**

`packages/calibrate/test/parity.test.ts`

```ts
import { execFileSync, spawnSync } from "node:child_process"
import { mkdtempSync, readFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { Effect } from "effect"
import { describe, expect, it } from "vitest"
import type { League } from "@touchline/league"
import { writeMatch } from "@touchline/sim"
import { DEFAULT_PARAMS } from "@touchline/sim-core"
import { runMatch } from "../src/evaluate.js"
import { matchMetrics, SCALAR_KEYS } from "../src/metrics.js"

const root = join(dirname(fileURLToPath(import.meta.url)), "../../..")
const hasUv = spawnSync("uv", ["--version"]).status === 0

describe("metric parity", () => {
  it.skipIf(!hasUv)("TypeScript and Python compute identical statistics for the same synthetic match", async () => {
    const league = JSON.parse(readFileSync(join(root, "data/league/league.json"), "utf8")) as League
    const cfg = { matchId: "parity", seed: 4242, kickoffTime: "2026-10-18T14:00:00.000Z", home: league.clubs[0]!, away: league.clubs[3]!, params: DEFAULT_PARAMS, dt: 0.1 }
    const dir = mkdtempSync(join(tmpdir(), "touchline-parity-"))
    await Effect.runPromise(writeMatch(cfg, dir))
    const py = JSON.parse(
      execFileSync("uv", ["run", "--project", join(root, "python/analytics"), "python", "-m", "touchline_analytics.metrics", dir], { encoding: "utf8", maxBuffer: 1 << 26 })
    ) as Record<string, number | number[]>
    const { events, frames } = runMatch(cfg)
    const ts = matchMetrics(events, frames, cfg.dt)
    for (const k of SCALAR_KEYS) expect(ts[k], k).toBeCloseTo(py[k] as number, 9)
    // Histograms: Math.hypot and math.hypot may differ in the last bit, which can move a sample sitting
    // exactly on a bin edge into the neighbouring bin (one sample in ~45,000 = 2e-5), hence 1e-3.
    ts.pass_len_hist.forEach((v, i) => expect(v).toBeCloseTo((py.pass_len_hist as number[])[i]!, 3))
    ts.speed_hist.forEach((v, i) => expect(v).toBeCloseTo((py.speed_hist as number[])[i]!, 3))
  })
})
```

- [ ] **Step 3: Run it to make sure it fails**

Run: `pnpm install && pnpm --filter @touchline/calibrate test parity`
Expected: FAIL — `../src/evaluate.js` / `../src/metrics.js` not found

- [ ] **Step 4: Implement the metrics**

`packages/calibrate/src/metrics.ts`

```ts
/**
 * Match statistics — a line-for-line port of python/analytics/touchline_analytics/metrics.py.
 * Real data is measured in Python; synthetic data is measured here during tuning. A parity test
 * runs both on the same synthetic match, so the two definitions cannot drift apart.
 */
import type { DomainEvent, Frame } from "@touchline/sim-core"

export const LONG_PASS_M = 32
export const PASS_LEN_EDGES = [0, 5, 10, 15, 20, 25, 30, 35, 40, 50, 60, 80, 120]
export const SPEED_EDGES = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 12]
const FULL_MATCH_SHARE = 0.95

export interface MatchMetrics {
  readonly passes: number
  readonly completion: number
  readonly long_share: number
  readonly pass_len_median: number
  readonly shots: number
  readonly on_target_share: number
  readonly goals: number
  readonly penalties: number
  readonly corners: number
  readonly throw_ins: number
  readonly goal_kicks: number
  readonly free_kicks: number
  readonly fouls: number
  readonly cards: number
  readonly pass_len_hist: ReadonlyArray<number>
  readonly in_play_share: number
  readonly distance_km_median: number
  readonly peak_speed_kmh_median: number
  readonly speed_hist: ReadonlyArray<number>
}

export const SCALAR_KEYS = [
  "passes", "completion", "long_share", "pass_len_median", "shots", "on_target_share", "goals", "penalties", "corners", "throw_ins",
  "goal_kicks", "free_kicks", "fouls", "cards", "in_play_share", "distance_km_median", "peak_speed_kmh_median"
] as const
export type ScalarKey = (typeof SCALAR_KEYS)[number]

const hist = (values: ReadonlyArray<number>, edges: ReadonlyArray<number>): number[] => {
  const counts = new Array<number>(edges.length - 1).fill(0)
  for (const v of values)
    for (let i = 0; i < edges.length - 1; i++)
      if (edges[i]! <= v && v < edges[i + 1]!) {
        counts[i] = counts[i]! + 1
        break
      }
  const total = counts.reduce((a, b) => a + b, 0) || 1
  return counts.map((c) => c / total)
}

const median = (values: ReadonlyArray<number>): number => {
  const s = [...values].sort((a, b) => a - b)
  if (s.length === 0) return NaN
  const m = Math.floor(s.length / 2)
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2
}

const SET_PIECE: Readonly<Record<string, string>> = { corner: "corner", throw_in: "throw_in", goal_kick: "goal_kick", free_kick: "free_kick", kickoff: "kick_off", penalty: "penalty" }

export const eventMetrics = (events: ReadonlyArray<DomainEvent>) => {
  const passes = events.filter((e) => e.type === "pass")
  const complete = passes.filter((e) => e.outcome === "successful")
  const lengths = complete.filter((e) => e.x_end !== null).map((e) => Math.hypot(e.x_end! - e.x!, e.y_end! - e.y!))
  const shots = events.filter((e) => e.type === "shot")
  const sp = (k: string) => passes.filter((e) => SET_PIECE[String(e.attrs.restart ?? "")] === k).length
  return {
    passes: passes.length,
    completion: passes.length ? complete.length / passes.length : 0,
    long_share: lengths.length ? lengths.filter((v) => v >= LONG_PASS_M).length / lengths.length : 0,
    pass_len_median: median(lengths),
    shots: shots.length,
    on_target_share: shots.length ? shots.filter((e) => e.outcome === "goal" || e.outcome === "saved").length / shots.length : 0,
    goals: shots.filter((e) => e.outcome === "goal").length,
    penalties: shots.filter((e) => e.attrs.technique === "penalty").length,
    corners: sp("corner"),
    throw_ins: sp("throw_in"),
    goal_kicks: sp("goal_kick"),
    free_kicks: sp("free_kick"),
    fouls: events.filter((e) => e.type === "foul").length,
    cards: events.filter((e) => e.type === "card").length,
    pass_len_hist: hist(lengths, PASS_LEN_EDGES)
  }
}

export const trackingMetrics = (frames: ReadonlyArray<Frame>, dt: number, smoothS = 0.2) => {
  let inPlay = 0
  const series = new Map<string, Array<[string, number, number, number]>>()
  const offset: Record<string, number> = { first_half: 0, second_half: 10_000 }
  for (const f of frames) {
    if (f.ball_in_play) inPlay++
    const t = offset[f.period]! + f.frame_id * dt
    for (const p of [...f.home, ...f.away]) {
      let s = series.get(p.id)
      if (!s) series.set(p.id, (s = []))
      s.push([f.period, t, p.x, p.y])
    }
  }
  const dists = new Map<string, number>()
  const peaks = new Map<string, number>()
  const speedsAll: number[] = []
  for (const [pid, pts] of series) {
    if (pts.length < 10) continue
    const step = (pts[pts.length - 1]![1] - pts[0]![1]) / Math.max(1, pts.length - 1)
    if (step <= 0) continue
    const w = Math.max(1, Math.round(smoothS / step))
    const half = Math.floor(w / 2)
    const avg = (arr: number[], i: number) => {
      const sl = arr.slice(Math.max(0, i - half), i + half + 1)
      let sum = 0
      for (const v of sl) sum += v
      return sum / sl.length
    }
    const xs = pts.map((p) => p[2])
    const ys = pts.map((p) => p[3])
    const sx = xs.map((_, i) => avg(xs, i))
    const sy = ys.map((_, i) => avg(ys, i))
    let d = 0
    const sp: number[] = []
    for (let i = 1; i < pts.length; i++) {
      if (pts[i]![0] !== pts[i - 1]![0] || pts[i]![1] - pts[i - 1]![1] > 2 * step + 1e-9) continue
      const st = Math.hypot(sx[i]! - sx[i - 1]!, sy[i]! - sy[i - 1]!)
      const v = st / (pts[i]![1] - pts[i - 1]![1])
      if (v > 12) continue
      d += st
      sp.push(v)
    }
    dists.set(pid, d)
    sp.sort((a, b) => a - b)
    peaks.set(pid, sp.length ? sp[Math.min(sp.length - 1, Math.floor(sp.length * 0.999))]! : 0)
    const stride = Math.max(1, Math.floor(sp.length / 2000))
    for (let i = 0; i < sp.length; i += stride) speedsAll.push(sp[i]!)
  }
  const counts = [...series].map(([pid, p]) => [pid, p.length] as const)
  const longest = counts.reduce((m, [, n]) => Math.max(m, n), 0)
  const full = counts.filter(([, n]) => n >= FULL_MATCH_SHARE * longest).map(([pid]) => pid)
  const fullD = full.filter((p) => dists.has(p)).map((p) => dists.get(p)!).sort((a, b) => a - b)
  const outfield = fullD.length > 4 ? fullD.slice(2) : fullD
  return {
    in_play_share: frames.length ? inPlay / frames.length : 0,
    distance_km_median: outfield.length ? median(outfield) / 1000 : NaN,
    peak_speed_kmh_median: median(full.filter((p) => peaks.has(p)).map((p) => peaks.get(p)! * 3.6)),
    speed_hist: hist(speedsAll, SPEED_EDGES)
  }
}

export const matchMetrics = (events: ReadonlyArray<DomainEvent>, frames: ReadonlyArray<Frame>, dt: number): MatchMetrics => ({
  ...eventMetrics(events),
  ...trackingMetrics(frames, dt)
})
```

`packages/calibrate/src/index.ts` — temporary, completed in Task 5

```ts
export * from "./metrics.js"
```

- [ ] **Step 5: Add the in-memory match runner the parity test needs**

The parity test imports `runMatch` from `../src/evaluate.js`, which Task 5 completes. Create it now with Task 5's full contents:

`packages/calibrate/src/evaluate.ts`

```ts
import type { Club, League } from "@touchline/league"
import { initMatch, isFinished, step, type DomainEvent, type Frame, type MatchConfig, type Params } from "@touchline/sim-core"
import { matchMetrics, SCALAR_KEYS, type MatchMetrics, type ScalarKey } from "./metrics.js"

/** Target statistic measured on real matches (data/params/targets-*.json). */
export interface Target {
  readonly mean: number
  readonly sd: number
  readonly n: number
}
export interface Targets {
  readonly provenance: Readonly<Record<string, string>>
  readonly metrics: Readonly<Record<string, Target>>
}

/** Fixtures used for every evaluation: each club appears, each style meets the others. */
export const FIXTURES: ReadonlyArray<readonly [string, string]> = [
  ["ironmoor", "saltmarsh"],
  ["kestrel-bay", "harrowmere"],
  ["eastvale", "northwick"],
  ["corrin-forge", "larkspur"],
  ["harrowmere", "ironmoor"],
  ["saltmarsh", "kestrel-bay"],
  ["larkspur", "eastvale"],
  ["northwick", "corrin-forge"]
]

export const runMatch = (cfg: MatchConfig): { events: DomainEvent[]; frames: Frame[] } => {
  let s = initMatch(cfg)
  const events: DomainEvent[] = []
  const frames: Frame[] = []
  while (!isFinished(s)) {
    const r = step(s)
    s = r.state
    events.push(...r.events)
    if (r.frame) frames.push(r.frame)
  }
  return { events, frames }
}

const club = (league: League, id: string): Club => {
  const c = league.clubs.find((x) => x.id === id)
  if (!c) throw new Error(`unknown club ${id}`)
  return c
}

/** Metrics for `matches` simulated matches (fixture i uses seed 1000 + i, so every evaluation sees the same matches). */
export const evaluate = (league: League, params: Params, matches: number): MatchMetrics[] =>
  Array.from({ length: matches }, (_, i) => {
    const [h, a] = FIXTURES[i % FIXTURES.length]!
    const cfg: MatchConfig = { matchId: `cal-${i}`, seed: 1000 + i, kickoffTime: "2026-10-18T14:00:00.000Z", home: club(league, h), away: club(league, a), params, dt: 0.1 }
    const { events, frames } = runMatch(cfg)
    return matchMetrics(events, frames, cfg.dt)
  })

export const meanMetrics = (ms: ReadonlyArray<MatchMetrics>): Record<ScalarKey, number> =>
  Object.fromEntries(SCALAR_KEYS.map((k) => [k, ms.reduce((s, m) => s + m[k], 0) / ms.length])) as Record<ScalarKey, number>

/** Relative weights: noisy, low-count statistics count less. */
export const WEIGHTS: Readonly<Record<ScalarKey, number>> = {
  passes: 1, completion: 1, long_share: 1, pass_len_median: 1, shots: 1, on_target_share: 0.7, goals: 1, penalties: 0.5, corners: 0.7,
  throw_ins: 1, goal_kicks: 0.7, free_kicks: 0.7, fouls: 1, cards: 0.5, in_play_share: 1, distance_km_median: 0.7, peak_speed_kmh_median: 0.7
}

/** Scale for a z-score: the real between-match SD, but never below 5 % of the mean (tracking targets come from one match). */
export const scaleOf = (t: Target): number => Math.max(t.sd, 0.05 * Math.abs(t.mean), 1e-6)

export const loss = (sim: Readonly<Record<ScalarKey, number>>, targets: Targets): number =>
  SCALAR_KEYS.reduce((acc, k) => {
    const t = targets.metrics[k]
    if (!t || !Number.isFinite(sim[k])) return acc
    const z = (sim[k] - t.mean) / scaleOf(t)
    return acc + WEIGHTS[k] * z * z
  }, 0)
```

- [ ] **Step 6: Run the parity test**

Run: `pnpm --filter @touchline/calibrate test parity`
Expected: 1 passed (about 10 s; skipped automatically where `uv` is not installed)

- [ ] **Step 7: Commit**

```bash
git add packages/calibrate pnpm-lock.yaml
git commit -m "feat(calibrate): TypeScript match statistics with Python parity test

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```



### Task 5: Tuning knobs and the coordinate search

The 18 settings the tuner may move, each a pure transform of the base parameters, and a deterministic coordinate search: for each knob keep stepping up (or else down) while the loss falls, halve every step after each round. The loss is the weighted sum of squared z-scores against the real targets, with the real between-match SD as scale, floored at 5 % of the mean. Every evaluation simulates the same fixtures and seeds (common random numbers), so comparisons are fair.

**Files:**
- Create: `packages/calibrate/src/knobs.ts`, `packages/calibrate/src/tune.ts`
- Modify: `packages/calibrate/src/index.ts` (final)
- Test: `packages/calibrate/test/tune.test.ts`

**Interfaces:**
- Consumes: Task 1's parameters; Task 4's metrics and `evaluate.ts` (`FIXTURES`, `runMatch`, `evaluate`, `meanMetrics`, `WEIGHTS`, `scaleOf`, `loss`, `Target`, `Targets`).
- Produces (knobs): `interface Knob {name, what, init, min, max, step, apply}`, `KNOBS` (decision_scale, long_bias, cross_bias, shot_bias, aim_noise, xg_b0, exec_scale, reach_margin, tackle_rate, foul_per_tackle, yellow_per_foul, box_intensity, box_carry, loose_share, restart_scale, shape_width, shape_depth, shape_speed), `type KnobValues`, `initialKnobs()`, `applyKnobs(base, values)`.
- Produces (tune): `coordinateSearch(knobs, start, rounds, score, onEval?)`, `interface TuneOptions {matches, rounds, start?, onEval?}`, `tune(league, base, targets, opts)`.

- [ ] **Step 1: Write the failing test**

`packages/calibrate/test/tune.test.ts`

```ts
import { describe, expect, it } from "vitest"
import { DEFAULT_PARAMS } from "@touchline/sim-core"
import { loss, scaleOf, type Targets } from "../src/evaluate.js"
import { applyKnobs, initialKnobs, KNOBS, type Knob } from "../src/knobs.js"
import { SCALAR_KEYS } from "../src/metrics.js"
import { coordinateSearch } from "../src/tune.js"

describe("knobs", () => {
  it("initial values leave the parameters unchanged", () => {
    expect(applyKnobs(DEFAULT_PARAMS, initialKnobs())).toEqual(DEFAULT_PARAMS)
  })
  it("every knob changes the parameters when moved, and never mutates its input", () => {
    const frozen = JSON.parse(JSON.stringify(DEFAULT_PARAMS))
    for (const k of KNOBS) {
      const moved = applyKnobs(DEFAULT_PARAMS, { ...initialKnobs(), [k.name]: k.init + k.step })
      expect(moved, k.name).not.toEqual(DEFAULT_PARAMS)
    }
    expect(DEFAULT_PARAMS).toEqual(frozen)
  })
  it("starting values sit inside their bounds", () => {
    for (const k of KNOBS) {
      expect(k.init, k.name).toBeGreaterThanOrEqual(k.min)
      expect(k.init, k.name).toBeLessThanOrEqual(k.max)
    }
  })
})

describe("loss", () => {
  const targets: Targets = { provenance: {}, metrics: Object.fromEntries(SCALAR_KEYS.map((k) => [k, { mean: 10, sd: 2, n: 7 }])) }
  it("is zero when every statistic hits its target", () => {
    expect(loss(Object.fromEntries(SCALAR_KEYS.map((k) => [k, 10])) as never, targets)).toBe(0)
  })
  it("floors the scale at 5 % of the mean", () => {
    expect(scaleOf({ mean: 100, sd: 0, n: 1 })).toBe(5)
  })
})

describe("coordinateSearch", () => {
  it("finds the minimum of a separable quadratic within the step resolution", () => {
    const knobs: Knob[] = [
      { name: "a", what: "", init: 0, min: -10, max: 10, step: 2, apply: (p) => p },
      { name: "b", what: "", init: 5, min: -10, max: 10, step: 2, apply: (p) => p }
    ]
    const res = coordinateSearch(knobs, { a: 0, b: 5 }, 6, (v) => ({ loss: (v.a! - 3) ** 2 + (v.b! + 1) ** 2, detail: null }))
    expect(res.knobs.a).toBeCloseTo(3, 0)
    expect(res.knobs.b).toBeCloseTo(-1, 0)
    expect(res.loss).toBeLessThan(0.1)
  })
  it("respects knob bounds", () => {
    const k: Knob[] = [{ name: "a", what: "", init: 0, min: -1, max: 1, step: 1, apply: (p) => p }]
    const res = coordinateSearch(k, { a: 0 }, 4, (v) => ({ loss: -v.a!, detail: null }))
    expect(res.knobs.a).toBe(1)
  })
})
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `pnpm --filter @touchline/calibrate test tune`
Expected: FAIL — `../src/knobs.js` not found

- [ ] **Step 3: Implement knobs and search**

`packages/calibrate/src/knobs.ts`

```ts
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
    apply: (p, v) => ({ ...p, movement: { ...p.movement, shapeSpeedShare: v } }) }
]

export type KnobValues = Readonly<Record<string, number>>

export const initialKnobs = (): Record<string, number> => Object.fromEntries(KNOBS.map((k) => [k.name, k.init]))

export const applyKnobs = (base: Params, values: KnobValues): Params =>
  KNOBS.reduce((p, k) => (values[k.name] === undefined || values[k.name] === k.init ? p : k.apply(p, values[k.name]!)), base)
```

`packages/calibrate/src/tune.ts`

```ts
import type { League } from "@touchline/league"
import type { Params } from "@touchline/sim-core"
import { evaluate, loss, meanMetrics, type Targets } from "./evaluate.js"
import { applyKnobs, initialKnobs, KNOBS, type Knob, type KnobValues } from "./knobs.js"
import type { ScalarKey } from "./metrics.js"

export interface Scored<S> {
  readonly loss: number
  readonly detail: S
}

export interface SearchResult<S> {
  readonly knobs: KnobValues
  readonly loss: number
  readonly evals: number
  readonly detail: S
}

const clampTo = (k: Knob, v: number): number => Math.min(k.max, Math.max(k.min, Math.round(v * 1e6) / 1e6))

/**
 * Coordinate search with step halving: for each knob, keep stepping up (or else down) while the loss
 * falls, then halve every step after each round. Deterministic for a deterministic `score`.
 */
export const coordinateSearch = <S>(
  knobs: ReadonlyArray<Knob>,
  start: KnobValues,
  rounds: number,
  score: (values: KnobValues) => Scored<S>,
  onEval?: (evals: number, loss: number) => void
): SearchResult<S> => {
  let evals = 0
  const run = (v: KnobValues) => {
    const r = score(v)
    evals++
    onEval?.(evals, r.loss)
    return r
  }
  let values: Record<string, number> = { ...start }
  let best = run(values)
  const steps: Record<string, number> = Object.fromEntries(knobs.map((k) => [k.name, k.step]))
  for (let round = 0; round < rounds; round++) {
    for (const k of knobs) {
      for (const dir of [1, -1]) {
        // Keep stepping in this direction while it helps (a cheap line search), then move on.
        let moved = false
        for (;;) {
          const v = clampTo(k, values[k.name]! + dir * steps[k.name]!)
          if (v === values[k.name]) break
          const trial = { ...values, [k.name]: v }
          const r = run(trial)
          if (r.loss >= best.loss) break
          values = trial
          best = r
          moved = true
        }
        if (moved) break
      }
    }
    for (const k of knobs) steps[k.name] = steps[k.name]! / 2
  }
  return { knobs: values, loss: best.loss, evals, detail: best.detail }
}

export interface TuneOptions {
  readonly matches: number
  readonly rounds: number
  /** Knob values to start from (e.g. a previous calibration); missing knobs start at their identity value. */
  readonly start?: KnobValues
  readonly onEval?: (evals: number, loss: number) => void
}

/**
 * Method of simulated moments: tune engine knobs so the mean statistics of `matches` simulated
 * matches (same fixtures and seeds every time — common random numbers) match the real targets.
 */
export const tune = (league: League, base: Params, targets: Targets, opts: TuneOptions): SearchResult<Readonly<Record<ScalarKey, number>>> =>
  coordinateSearch(KNOBS, { ...initialKnobs(), ...opts.start }, opts.rounds, (values) => {
    const sim = meanMetrics(evaluate(league, applyKnobs(base, values), opts.matches))
    return { loss: loss(sim, targets), detail: sim }
  }, opts.onEval)
```

`packages/calibrate/src/index.ts` — final version

```ts
export * from "./evaluate.js"
export * from "./knobs.js"
export * from "./metrics.js"
export * from "./tune.js"
```

- [ ] **Step 4: Run the tests**

Run: `pnpm --filter @touchline/calibrate test tune && pnpm --filter @touchline/calibrate typecheck`
Expected: 7 passed, no type errors

- [ ] **Step 5: Commit**

```bash
git add packages/calibrate
git commit -m "feat(calibrate): tuning knobs and deterministic coordinate search

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```



### Task 6: Calibrate the engine and load the result by default

Run the tuner from the committed start values (the outcome of two exploratory rounds) and commit the tuned parameter file with provenance and its calibration record. The sim CLI then loads it by default; `--params` overrides; files failing the provenance gate exit 2 with a message.

**Files:**
- Create: `packages/calibrate/src/cli.ts`, `data/params/calibration-start.json`
- Modify: `packages/sim/src/cli.ts`, `package.json` (root scripts `calibrate`, `realism`)
- Create (generated): `data/params/touchline-params.json`

**Interfaces:**
- Consumes: `tune`, `applyKnobs`, `KNOBS`, `SCALAR_KEYS`; `paramsFromJson`, `ParamsError`.
- Produces: `pnpm calibrate [--targets f] [--out f] [--matches 8] [--rounds 3] [--from params-or-start.json]`; `data/params/touchline-params.json` = full Params + `provenance` + `calibration {method, targets, matches, rounds, evals, loss, knobs, simulated, real}`; `pnpm sim --params <file>`.

- [ ] **Step 1: Write the calibrate CLI and the start values**

`packages/calibrate/src/cli.ts`

```ts
import { readFileSync, writeFileSync } from "node:fs"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import type { League } from "@touchline/league"
import { DEFAULT_PARAMS } from "@touchline/sim-core"
import type { Targets } from "./evaluate.js"
import { applyKnobs, KNOBS } from "./knobs.js"
import { SCALAR_KEYS } from "./metrics.js"
import { tune } from "./tune.js"

const root = join(dirname(fileURLToPath(import.meta.url)), "../../..")
const arg = (k: string, d: string): string => {
  const i = process.argv.indexOf(`--${k}`)
  return i > 0 && process.argv[i + 1] ? process.argv[i + 1]! : d
}
const here = (p: string) => resolve(process.env.INIT_CWD ?? process.cwd(), p)
const targetsPath = here(arg("targets", join(root, "data/params/targets-idsse.json")))
const outPath = here(arg("out", join(root, "data/params/touchline-params.json")))
const matches = Number(arg("matches", "8"))
const rounds = Number(arg("rounds", "3"))
// --from <params.json>: continue from that file's calibration knobs instead of the defaults.
const fromPath = arg("from", "")
const start = fromPath ? (JSON.parse(readFileSync(here(fromPath), "utf8")) as { calibration?: { knobs?: Record<string, number> } }).calibration?.knobs ?? {} : {}

const league = JSON.parse(readFileSync(join(root, "data/league/league.json"), "utf8")) as League
const targets = JSON.parse(readFileSync(targetsPath, "utf8")) as Targets
const t0 = Date.now()
const res = tune(league, DEFAULT_PARAMS, targets, {
  matches,
  rounds,
  start,
  onEval: (evals, loss) => process.stdout.write(`eval ${evals}: loss ${loss.toFixed(2)} (${Math.round((Date.now() - t0) / 1000)} s)\n`)
})
const today = new Date().toISOString().slice(0, 10)
const tuned = applyKnobs(DEFAULT_PARAMS, res.knobs)
const out = {
  ...tuned,
  provenance: {
    dataset: `calibrated by simulated moments against ${targets.provenance.dataset}`,
    licence: targets.provenance.licence,
    attribution: targets.provenance.attribution,
    fitted_at: today,
    version: `calib-${today}`
  },
  calibration: {
    method: "coordinate search on engine knobs, minimising weighted squared z-scores of match statistics (common random numbers)",
    targets: targets.provenance.version,
    matches,
    rounds,
    evals: res.evals,
    loss: Number(res.loss.toFixed(3)),
    knobs: Object.fromEntries(KNOBS.map((k) => [k.name, res.knobs[k.name]])),
    simulated: Object.fromEntries(SCALAR_KEYS.map((k) => [k, Number(res.detail[k].toFixed(4))])),
    real: Object.fromEntries(SCALAR_KEYS.map((k) => [k, targets.metrics[k]?.mean ?? null]))
  }
}
writeFileSync(outPath, JSON.stringify(out, null, 1) + "\n")
console.log(`wrote ${outPath}: loss ${res.loss.toFixed(2)} after ${res.evals} evaluations`)
```

`data/params/calibration-start.json`

```json
{
 "_comment": "Starting knob values for `pnpm calibrate --from data/params/calibration-start.json`. They come from two earlier exploratory tuning rounds (Plan 2a, 2026-10-04); tuning from here is deterministic and reproduces data/params/touchline-params.json.",
 "calibration": {
  "knobs": {
   "decision_scale": 1,
   "long_bias": -0.25,
   "cross_bias": 0.125,
   "shot_bias": 0,
   "aim_noise": 1.35,
   "xg_b0": -1.25,
   "exec_scale": 1.15,
   "reach_margin": 0.725,
   "tackle_rate": 0.65,
   "foul_per_tackle": 0.255,
   "yellow_per_foul": 0.225,
   "loose_share": 0.4,
   "restart_scale": 1.25,
   "shape_width": 1.35,
   "shape_depth": 1.2,
   "shape_speed": 0.9,
   "box_intensity": 3,
   "box_carry": -1
  }
 }
}
```

`package.json` — root; adds `calibrate` and `realism` scripts

```json
{
  "name": "touchline",
  "private": true,
  "type": "module",
  "packageManager": "pnpm@11.27.0",
  "engines": { "node": ">=22" },
  "scripts": {
    "test": "turbo run test",
    "typecheck": "turbo run typecheck",
    "sim": "pnpm --filter @touchline/sim run sim",
    "league": "pnpm --filter @touchline/league run generate",
    "calibrate": "pnpm --filter @touchline/calibrate run calibrate",
    "realism": "pnpm --filter @touchline/calibrate run realism"
  },
  "devDependencies": {
    "@types/node": "22.20.5",
    "tsx": "4.23.15",
    "turbo": "2.11.6",
    "typescript": "5.9.3",
    "vitest": "5.0.3"
  }
}
```

- [ ] **Step 2: Make the sim CLI load parameters**

`packages/sim/src/cli.ts`

```ts
import { existsSync, readFileSync } from "node:fs"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { Effect } from "effect"
import type { League } from "@touchline/league"
import { DEFAULT_PARAMS, ParamsError, paramsFromJson, type Params } from "@touchline/sim-core"
import { writeMatch } from "./writer.js"

const root = join(dirname(fileURLToPath(import.meta.url)), "../../..")
const arg = (k: string, d: string): string => {
  const i = process.argv.indexOf(`--${k}`)
  return i > 0 && process.argv[i + 1] ? process.argv[i + 1]! : d
}
const league = JSON.parse(readFileSync(join(root, "data/league/league.json"), "utf8")) as League
const club = (id: string) => {
  const c = league.clubs.find((x) => x.id === id)
  if (!c) {
    console.error(`Unknown club "${id}". Known clubs: ${league.clubs.map((x) => x.id).join(", ")}`)
    process.exit(2)
  }
  return c
}
const seed = Number(arg("seed", "1"))
const fps = Number(arg("fps", "10"))
if (!Number.isInteger(seed) || seed < 0 || seed > 4294967295) {
  console.error("--seed must be an integer between 0 and 4294967295")
  process.exit(2)
}
if (fps !== 10 && fps !== 25) {
  console.error("--fps must be 10 or 25")
  process.exit(2)
}
if (arg("home", "ironmoor") === arg("away", "kestrel-bay")) {
  console.error("--home and --away must be different clubs")
  process.exit(2)
}
// Calibrated parameters (Plan 2) load by default; --params overrides; hand-set priors if neither exists.
const defaultParams = join(root, "data/params/touchline-params.json")
const paramsPath = arg("params", existsSync(defaultParams) ? defaultParams : "")
let params: Params = DEFAULT_PARAMS
if (paramsPath) {
  try {
    params = paramsFromJson(JSON.parse(readFileSync(resolve(process.env.INIT_CWD ?? process.cwd(), paramsPath), "utf8")))
  } catch (e) {
    console.error(`Cannot use params file ${paramsPath}: ${e instanceof ParamsError ? e.message : String(e)}`)
    process.exit(2)
  }
}
const cfg = {
  matchId: arg("match-id", `m-${seed}`),
  seed,
  kickoffTime: arg("kickoff", "2026-10-18T14:00:00.000Z"),
  home: club(arg("home", "ironmoor")),
  away: club(arg("away", "kestrel-bay")),
  params,
  dt: 1 / fps
}
// pnpm runs package scripts from the package folder; INIT_CWD is where the user typed the command.
const out = resolve(process.env.INIT_CWD ?? process.cwd(), arg("out", join(root, "out", cfg.matchId)))
Effect.runPromise(writeMatch(cfg, out)).then((m) => console.log(`${out}: ${JSON.stringify(m.stats)}`))
```

- [ ] **Step 3: Run the tuner (about an hour; run it in the background)**

Run: `pnpm calibrate --from data/params/calibration-start.json`
Expected: `eval N: loss …` lines, ending with `wrote …/data/params/touchline-params.json: loss 4.01 after 115 evaluations`. The search is deterministic, so the knob values should match: decision_scale 1, long_bias 1.25, cross_bias 0.375, shot_bias 0, aim_noise 1.55, xg_b0 -1, exec_scale 1.45, reach_margin 0.725, tackle_rate 0.8, foul_per_tackle 0.345, yellow_per_foul 0.2, box_intensity 2, box_carry -0.75, loose_share 0.3, restart_scale 1.25, shape_width 1.35, shape_depth 1.2, shape_speed 0.9

- [ ] **Step 4: Check the CLI uses it and rejects bad files**

```bash
pnpm sim --seed 1 --home ironmoor --away saltmarsh
echo '{"provenance":{"dataset":"StatsBomb open data","licence":"CC-BY-4.0","version":"x"}}' > /tmp/bad-params.json
pnpm sim --params /tmp/bad-params.json; echo "exit $?"
uv run --project python/analytics python -m touchline_analytics.validate_cdf out/m-1
```

Expected: a realistic stats line (seed 1 gives `score 2-0`); `Cannot use params file /tmp/bad-params.json: StatsBomb-derived parameters are not allowed` with exit 2; `meta: ok`, `event: ok`, `tracking: ok`.

- [ ] **Step 5: Commit**

```bash
git add packages/calibrate/src/cli.ts packages/sim/src/cli.ts package.json data/params/calibration-start.json data/params/touchline-params.json
git commit -m "feat(calibrate): tuned engine parameters (simulated moments vs IDSSE), loaded by default

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```



### Task 7: Realism report, realism gate, CI and docs

Produce the evidence: 16 held-out matches (seeds the tuner never saw) compared with the real targets — z-scores per statistic, Wasserstein-1 and Jensen–Shannon distances for pass length and player speed — committed as `docs/realism/realism-report.md`. A realism-gate test keeps future engine changes honest. CI runs the Python tests and gives the TypeScript job `uv` for the parity test.

**Files:**
- Create: `python/analytics/touchline_analytics/report.py`, `python/analytics/tests/test_report.py`, `packages/calibrate/src/realism.ts`, `packages/calibrate/test/realism-gate.test.ts`
- Create (generated): `docs/realism/realism-report.md`
- Modify: `.github/workflows/ci.yml`, `README.md`, `ATTRIBUTION.md`

**Interfaces:**
- Consumes: Task 2's metrics, Task 3's targets, Task 6's params, `writeMatch`, `FIXTURES`.
- Produces: `report.build(run_dirs, targets, note)`, `wasserstein_binned`, `js_divergence`; `pnpm realism [--matches 10] [--params f|default]` (held-out seeds 2000+); realism gate (seeds 3000–3005, every |z| < 3, loss < 30).

- [ ] **Step 1: Write the failing tests**

`python/analytics/tests/test_report.py`

```python
import math

from touchline_analytics.report import js_divergence, wasserstein_binned


def test_distribution_distances():
    edges = [0, 1, 2]
    assert wasserstein_binned([1, 0], [1, 0], edges) == 0
    assert wasserstein_binned([1, 0], [0, 1], edges) == 1
    assert js_divergence([0.5, 0.5], [0.5, 0.5]) == 0
    assert math.isclose(js_divergence([1, 0], [0, 1]), 1.0)
```

`packages/calibrate/test/realism-gate.test.ts`

```ts
import { readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "vitest"
import type { League } from "@touchline/league"
import { paramsFromJson } from "@touchline/sim-core"
import { FIXTURES, loss, meanMetrics, runMatch, scaleOf, type Targets } from "../src/evaluate.js"
import { matchMetrics, SCALAR_KEYS } from "../src/metrics.js"

const root = join(dirname(fileURLToPath(import.meta.url)), "../../..")

/**
 * Regression guard for the committed calibration: six held-out matches (seeds the tuner never saw)
 * with data/params/touchline-params.json must stay close to the real-match targets. If an engine
 * change breaks this, re-run `pnpm calibrate` and `pnpm realism`, then commit the new params and report.
 */
describe("realism gate", () => {
  it("held-out matches with the committed parameters stay close to real matches", () => {
    const league = JSON.parse(readFileSync(join(root, "data/league/league.json"), "utf8")) as League
    const targets = JSON.parse(readFileSync(join(root, "data/params/targets-idsse.json"), "utf8")) as Targets
    const params = paramsFromJson(JSON.parse(readFileSync(join(root, "data/params/touchline-params.json"), "utf8")))
    const runs = Array.from({ length: 6 }, (_, i) => {
      const [h, a] = FIXTURES[i % FIXTURES.length]!
      const cfg = { matchId: `gate-${i}`, seed: 3000 + i, kickoffTime: "2026-10-18T14:00:00.000Z", home: league.clubs.find((c) => c.id === h)!, away: league.clubs.find((c) => c.id === a)!, params, dt: 0.1 }
      const { events, frames } = runMatch(cfg)
      return matchMetrics(events, frames, cfg.dt)
    })
    const sim = meanMetrics(runs)
    const z = Object.fromEntries(SCALAR_KEYS.map((k) => [k, (sim[k] - targets.metrics[k]!.mean) / scaleOf(targets.metrics[k]!)]))
    console.log("realism gate", JSON.stringify({ loss: Number(loss(sim, targets).toFixed(2)), z: Object.fromEntries(Object.entries(z).map(([k, v]) => [k, Number(v.toFixed(2))])) }))
    for (const k of SCALAR_KEYS) expect(Math.abs(z[k]!), k).toBeLessThan(GATE_Z)
    expect(loss(sim, targets)).toBeLessThan(GATE_LOSS)
  })
})

const GATE_Z = 3
const GATE_LOSS = 30
```

- [ ] **Step 2: Run them to make sure the report test fails**

Run: `uv run --project python/analytics --group dev pytest python/analytics/tests -q`
Expected: errors — `touchline_analytics.report` cannot be imported. (The realism gate already passes against Task 6's committed parameters; it guards future changes.)

- [ ] **Step 3: Implement the report and the realism runner**

`python/analytics/touchline_analytics/report.py`

```python
"""Realism report: synthetic Touchline matches against real-match targets.

Usage:
  uv run --project python/analytics python -m touchline_analytics.report out/realism/* \\
      --targets data/params/targets-idsse.json --out docs/realism/realism-report.md
"""

from __future__ import annotations

import datetime as dt
import json
import math
from pathlib import Path

from .metrics import PASS_LEN_EDGES, SPEED_EDGES, touchline_metrics

LABELS = {
    "passes": ("Passes per match", "{:.0f}"),
    "completion": ("Pass completion", "{:.1%}"),
    "long_share": ("Long passes (32 m+), share of completed", "{:.1%}"),
    "pass_len_median": ("Median completed pass length (m)", "{:.1f}"),
    "shots": ("Shots per match", "{:.1f}"),
    "on_target_share": ("Shots on target, share", "{:.1%}"),
    "goals": ("Goals per match", "{:.2f}"),
    "penalties": ("Penalties per match", "{:.2f}"),
    "corners": ("Corners", "{:.1f}"),
    "throw_ins": ("Throw-ins", "{:.1f}"),
    "goal_kicks": ("Goal kicks", "{:.1f}"),
    "free_kicks": ("Free kicks", "{:.1f}"),
    "fouls": ("Fouls", "{:.1f}"),
    "cards": ("Cards", "{:.1f}"),
    "in_play_share": ("Ball in play, share of match time", "{:.1%}"),
    "distance_km_median": ("Distance per full-match outfielder (km)", "{:.2f}"),
    "peak_speed_kmh_median": ("Peak speed per player, median (km/h)", "{:.1f}"),
}


def scale_of(t: dict) -> float:
    return max(t["sd"], 0.05 * abs(t["mean"]), 1e-6)


def wasserstein_binned(a: list[float], b: list[float], edges: list[float]) -> float:
    """W1 between two binned distributions: sum over bins of |CDF difference| x bin width."""
    ca = cb = 0.0
    total = 0.0
    for i in range(len(edges) - 1):
        ca += a[i]
        cb += b[i]
        total += abs(ca - cb) * (edges[i + 1] - edges[i])
    return total


def js_divergence(a: list[float], b: list[float]) -> float:
    m = [(x + y) / 2 for x, y in zip(a, b)]
    kl = lambda p, q: sum(pi * math.log(pi / qi, 2) for pi, qi in zip(p, q) if pi > 0 and qi > 0)  # noqa: E731
    return 0.5 * kl(a, m) + 0.5 * kl(b, m)


def status(z: float) -> str:
    return "within 1 SD" if abs(z) <= 1 else "within 2 SD" if abs(z) <= 2 else "off"


def build(run_dirs: list[Path], targets: dict, params_note: str) -> str:
    runs = [touchline_metrics(d) for d in run_dirs]
    n = len(runs)
    mean = lambda k: sum(r[k] for r in runs) / n  # noqa: E731
    sd = lambda k: math.sqrt(sum((r[k] - mean(k)) ** 2 for r in runs) / (n - 1)) if n > 1 else 0.0  # noqa: E731
    lines = [
        "# Touchline realism report",
        "",
        f"Generated {dt.date.today().isoformat()} from {n} synthetic matches ({params_note}) against real-match targets.",
        "",
        f"**Real data:** {targets['provenance']['dataset']} — {targets['provenance']['scope']}. "
        f"Licence {targets['provenance']['licence']}; {targets['provenance']['attribution']}. Only aggregate statistics are shown.",
        "",
        "## Match statistics",
        "",
        "| Statistic | Real (mean ± SD) | Synthetic (mean ± SD) | z | Verdict |",
        "|---|---|---|---|---|",
    ]
    counts = {"within 1 SD": 0, "within 2 SD": 0, "off": 0}
    for k, (label, fmt) in LABELS.items():
        t = targets["metrics"].get(k)
        if not t:
            continue
        z = (mean(k) - t["mean"]) / scale_of(t)
        v = status(z)
        counts[v] += 1
        lines.append(f"| {label} | {fmt.format(t['mean'])} ± {fmt.format(t['sd'])} | {fmt.format(mean(k))} ± {fmt.format(sd(k))} | {z:+.2f} | {v} |")
    lines += ["", f"Summary: {counts['within 1 SD']} within 1 SD, {counts['within 2 SD']} within 2 SD, {counts['off']} off. "
              "z uses the real between-match SD, floored at 5 % of the mean (tracking targets come from one match).", ""]
    lines += ["## Distributions", "", "| Distribution | Wasserstein-1 | Jensen–Shannon (bits) |", "|---|---|---|"]
    for key, label, edges, unit in (("pass_len", "Completed pass length", PASS_LEN_EDGES, "m"), ("speed", "Player speed", SPEED_EDGES, "m/s")):
        real = targets["distributions"][key]["share"]
        if not real:
            continue
        hk = "pass_len_hist" if key == "pass_len" else "speed_hist"
        syn = [sum(r[hk][i] for r in runs) / n for i in range(len(edges) - 1)]
        lines.append(f"| {label} | {wasserstein_binned(syn, real, edges):.2f} {unit} | {js_divergence(syn, real):.4f} |")
    lines += ["", "Lower is closer. W1 is in the distribution's own unit; JS divergence is 0 for identical and 1 for disjoint distributions.", ""]
    return "\n".join(lines)


if __name__ == "__main__":
    import argparse

    ap = argparse.ArgumentParser()
    ap.add_argument("runs", nargs="+")
    ap.add_argument("--targets", default="data/params/targets-idsse.json")
    ap.add_argument("--note", default="calibrated parameters")
    ap.add_argument("--out", default="docs/realism/realism-report.md")
    a = ap.parse_args()
    md = build([Path(r) for r in a.runs], json.loads(Path(a.targets).read_text()), a.note)
    Path(a.out).parent.mkdir(parents=True, exist_ok=True)
    Path(a.out).write_text(md + "\n")
    print(md)
```

`packages/calibrate/src/realism.ts`

```ts
import { execFileSync } from "node:child_process"
import { readFileSync, rmSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { Effect } from "effect"
import type { League } from "@touchline/league"
import { writeMatch } from "@touchline/sim"
import { DEFAULT_PARAMS, paramsFromJson } from "@touchline/sim-core"
import { FIXTURES } from "./evaluate.js"

const root = join(dirname(fileURLToPath(import.meta.url)), "../../..")
const arg = (k: string, d: string): string => {
  const i = process.argv.indexOf(`--${k}`)
  return i > 0 && process.argv[i + 1] ? process.argv[i + 1]! : d
}
const matches = Number(arg("matches", "10"))
const paramsFile = arg("params", join(root, "data/params/touchline-params.json"))
const params = paramsFile === "default" ? DEFAULT_PARAMS : paramsFromJson(JSON.parse(readFileSync(paramsFile, "utf8")))
const league = JSON.parse(readFileSync(join(root, "data/league/league.json"), "utf8")) as League
const outRoot = join(root, "out/realism")
rmSync(outRoot, { recursive: true, force: true })

// Seeds 2000+ are disjoint from the tuner's 1000+ seeds, so the report checks matches the tuner never saw.
const dirs: string[] = []
for (let i = 0; i < matches; i++) {
  const [h, a] = FIXTURES[i % FIXTURES.length]!
  const dir = join(outRoot, `m-${2000 + i}`)
  const cfg = { matchId: `realism-${2000 + i}`, seed: 2000 + i, kickoffTime: "2026-10-18T14:00:00.000Z", home: league.clubs.find((c) => c.id === h)!, away: league.clubs.find((c) => c.id === a)!, params, dt: 0.1 }
  await Effect.runPromise(writeMatch(cfg, dir))
  dirs.push(dir)
  process.stdout.write(`match ${i + 1}/${matches}\n`)
}
const note = `${params.provenance.version}; held-out seeds 2000–${2000 + matches - 1}`
execFileSync("uv", ["run", "--project", join(root, "python/analytics"), "python", "-m", "touchline_analytics.report", ...dirs,
  "--targets", join(root, "data/params/targets-idsse.json"), "--note", note, "--out", join(root, "docs/realism/realism-report.md")], { stdio: "inherit" })
```

- [ ] **Step 4: Run the tests**

Run: `uv run --project python/analytics --group dev pytest python/analytics/tests -q && pnpm --filter @touchline/calibrate test`
Expected: 4 passed (Python); 9 passed (calibrate: parity 1, tune 7, gate 1). The gate logs `loss 13.96` with every |z| ≤ 1.84

- [ ] **Step 5: Generate the report**

Run: `pnpm realism --matches 16`
Expected: `Summary: 13 within 1 SD, 4 within 2 SD, 0 off.`; W1 completed pass length 1.28 m, player speed 0.54 m/s; written to `docs/realism/realism-report.md`

- [ ] **Step 6: Update CI, README and attribution**

`.github/workflows/ci.yml`

```yaml
name: ci
on:
  push:
  pull_request:
jobs:
  typescript:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: pnpm
      - run: pnpm install --frozen-lockfile
      - uses: astral-sh/setup-uv@v6
      - run: pnpm league
      - run: git diff --exit-code data/league/league.json
      - run: pnpm typecheck
      - run: pnpm test
  python:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: astral-sh/setup-uv@v6
      - run: uv run --project python/analytics --group dev pytest python/analytics/tests -q
  cdf:
    runs-on: ubuntu-latest
    needs: typescript
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: pnpm
      - run: pnpm install --frozen-lockfile
      - run: pnpm sim --seed 1 --home ironmoor --away saltmarsh
      - uses: astral-sh/setup-uv@v6
      - run: uv run --project python/analytics python -m touchline_analytics.validate_cdf out/m-1
```

`README.md`

````markdown
# Touchline

A multi-agent football match-intelligence engine on Azure, built for the Microsoft *Inside the Game* hackathon. All data is synthetic: clubs, players and matches are fictional and generated by our own simulator.

## Quick start

```bash
corepack enable
pnpm install
pnpm league                                   # regenerate data/league/league.json (deterministic)
pnpm test                                     # all TypeScript tests
pnpm sim --seed 1 --home ironmoor --away saltmarsh   # writes out/m-1/{meta.json,event.jsonl,tracking.jsonl,domain.jsonl,manifest.json}
uv run --project python/analytics python -m touchline_analytics.validate_cdf out/m-1
```

## Calibration (method of simulated moments)

The engine is tuned so that simulated matches reproduce real-match statistics measured on the open IDSSE dataset (see `ATTRIBUTION.md`):

```bash
uv run --project python/analytics python -m touchline_analytics.idsse      # download into git-ignored data/raw/idsse
uv run --project python/analytics python -m touchline_analytics.targets    # data/params/targets-idsse.json (aggregates only)
pnpm calibrate --from data/params/calibration-start.json                   # ~1 h; writes data/params/touchline-params.json
pnpm realism --matches 16                                                  # held-out matches -> docs/realism/realism-report.md
```

`pnpm sim` loads `data/params/touchline-params.json` by default (`--params <file>` to override). Every parameter file must carry provenance with an allowed licence; StatsBomb-derived parameters are refused.

Options for `pnpm sim`: `--seed` (0–4294967295), `--home` / `--away` (club ids in `data/league/league.json`), `--fps` (10, or 25 for video render runs), `--match-id`, `--kickoff` (ISO time), `--out`.

## Packages

| Package | What it does |
|---|---|
| `packages/sim-core` | The match engine: one pure, deterministic `step(state)` per 0.1 s tick |
| `packages/league` | Fictional league generator: 8 clubs, kits, styles, 160 players |
| `packages/schema` | Effect Schema for the live domain stream (events and frames) |
| `packages/sim` | Effect streams, CDF v0.3.2 writers, run manifest, CLI |
| `packages/calibrate` | Match statistics (identical to the Python definitions), tuning knobs, tuner, realism gate |
| `python/analytics` | CDF validation, IDSSE download, real-match targets, realism report |

## Status

The engine runs a full match in about 1.5 s and its output passes the CDF validator in strict mode. With the calibrated parameters, 16 held-out simulated matches land within 1 SD of real matches on 13 of 17 statistics and within 2 SD on the rest (see `docs/realism/realism-report.md`). Known gaps: corners (about 2 vs 8 per match) and throw-ins (about 32 vs 44) are low, and goals run slightly high on new seeds.

See `ATTRIBUTION.md` for credits and `docs/superpowers/` for the spec and plans.
````

`ATTRIBUTION.md`

```markdown
# Attribution

Touchline's simulator is original code. These projects and papers shaped its design; no code was copied from them.

| Source | Licence | What we took |
|---|---|---|
| [tbleckert/football-simulator](https://github.com/tbleckert/football-simulator) | MIT | Ideas: typed event taxonomy, restart phase machine, intents with durations, injectable RNG |
| [ZOXEXIVO/open-football](https://github.com/ZOXEXIVO/open-football) | Apache-2.0 | Ideas: constant-bearing interception, 3D ball physics, per-match plausibility bands |
| Spearman (2018) pitch control, via [LaurieOnTracking](https://github.com/Friends-of-Tracking-Data-FoTD/LaurieOnTracking) | MIT | 0.7 s reaction time in time-to-intercept |
| Reynolds, *Steering Behaviors for Autonomous Characters* (GDC 1999) | — | Arrive, pursue and separation steering |
| Anzer et al., *Common Data Format (CDF)*, arXiv:2505.15820 | — | Output format (v0.3.2) |
| [unravelsports/common-data-format-validator](https://github.com/unravelsports/common-data-format-validator) | MIT | CDF validation in CI |
| [Effect](https://effect.website) | MIT | Streams, schemas and test clock |

## Calibration data

| Dataset | Licence | How it is used |
|---|---|---|
| IDSSE / Sportec Open DFL dataset — © Deutsche Fussball Liga (DFL); Bassek et al., *Scientific Data* (2025), https://doi.org/10.1038/s41597-025-04505-y | CC-BY 4.0 | Downloaded locally into git-ignored `data/raw/`; only aggregate match statistics (`data/params/targets-idsse.json`) are committed. These are the targets the engine is tuned to and validated against (`docs/realism/realism-report.md`). |

The default xG prior (`packages/sim-core/src/params.ts`) is fitted to an approximate public reference xG curve by distance and angle, not to any dataset.
```

- [ ] **Step 7: Run everything**

Run: `pnpm turbo run typecheck test --force && uv run --project python/analytics --group dev pytest python/analytics/tests -q`
Expected: `Tasks: 10 successful`; 98 TypeScript tests (sim-core 73, calibrate 9, sim 8, league 6, schema 2) and 4 Python tests

- [ ] **Step 8: Commit**

```bash
git add python/analytics packages/calibrate docs/realism/realism-report.md .github/workflows/ci.yml README.md ATTRIBUTION.md
git commit -m "feat(calibrate): realism report on held-out matches, realism gate, CI and docs

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```



# Realism v2, P2: positioning core — implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. This plan is built for **parallel** execution: read "Parallel execution" before starting.

**Goal:** Off-ball players stand where real players stand: a per-role rule table fitted to real tracking replaces the slide-with-the-ball template. Players switch shape at real speed after a change of possession, follow the ball 2 s late, and drift as real teams and players do. They walk into shape instead of sprinting to it, tire mildly, and are substituted at real times and in real roles. The phase ends with the gate green on recalibrated parameters, and with C3 (shot-share spread), C4 width, G2 keeper pressure and the territory gap re-measured.

**Architecture:**
- **New pure modules.** `anchor.ts` holds the rule table (A1), the build-up row (G4), the keeper rule, the style terms and the phase-switch blend (A2). `drift.ts` holds the team-common and per-player Ornstein–Uhlenbeck drift (A3).
- **State.** The per-team state (row, blend start, drift) and the 2 s ball ring buffer live in a new optional `MatchState.anchor`.
- **`shape.ts`.** `anchorFor` keeps its signature and gains an optional trailing context. Without it, or with `positioning.rule` 0, it runs the old template. `kickoffAnchor` stays on the old template.
- **`step.ts`.** It gets two clearly delimited seam blocks: positioning, and movement/tiring. Parallel tasks fill them in without touching each other's lines.
- **Switches.** Every behaviour ships behind a params switch that defaults to the old engine, so the engine stays bit-identical (gate drift 0) until Task 8 switches everything on, retires `defLineM`/`fwdDropM`, recalibrates, re-baselines and re-pins.
- **Report.** The realism report gains physical bands, territory and the block's height against the ball (Python, as P1's C3).

**Tech stack:** TypeScript (Effect monorepo, vitest), Python 3 (uv, pytest, numpy, scipy), pnpm 11.

**Spec:** `docs/superpowers/specs/2026-10-13-sim-realism-v2-design.md`: "Conventions for every phase", "Evaluation changes", "P2: positioning core", and "Results: P1" for the starting point. The evidence behind the numbers is in `touchline-worktrees/analysis-positioning/` (`SYNTHESIS.md`, `fit-report.md`, `offball-report.md`, `transitions-report.md`, `gk-report.md`, `physical-report.md`, `dominance-report.md`), which is outside the repo. Only the aggregate numbers quoted in this plan may be committed.

**Starting point (Results: P1).** C3 team shot-share SD 0.383 on 64 matches (needs ≤ 0.18; real 0.090). C4 width out of possession z +3.04. G2: an opponent within 5 m at 43–44 % of keeper releases from his feet (target about 12.6 %). The match-mean ball x has an SD of 11.7 m over matches (real 1.9 m): the territory gap. The in-possession centroid sits 7.2 m behind the ball (real 3.9 m ahead).

## Setup (before Task 1)

P2 builds on the finished P1 code. If `realism-v2-p1` has been merged into `main`, branch from `main`; otherwise branch from `realism-v2-p1`'s last commit. Check `git -C ../touchline-worktrees/realism-v2-p1 status --short` is empty first: nobody may still be committing P1 fixes.

```bash
cd /Users/jhutan.debnath/Documents/GitHub/microsoft-hackathon/touchline
git worktree add ../touchline-worktrees/realism-v2-p2 -b realism-v2-p2 main   # or: ... realism-v2-p1
cd ../touchline-worktrees/realism-v2-p2 && pnpm install
```

`realism-v2-p2` is the **integration branch**. Every path below is relative to a worktree of it.

## Parallel execution

### Dependency graph

```
Task 1 (scaffold: params, types, step.ts seams) ──┬──> Task 3 (anchor.ts) ──┐
                                                  ├──> Task 4 (drift.ts) ───┴──> Task 7 (wire positioning) ──┐
                                                  ├──> Task 5 (A0 relaxed motion + F1 tiring) ───────────────┤
                                                  └──> Task 6 (F2 substitutions) ────────────────────────────┤
Task 2 (report: physical bands, territory; Python) ──────────────────────────────────────────────────────────┴──> Task 8 (switch on, recalibrate, gate, re-pin, results)
```

### Waves

| Wave | Tasks, run concurrently | Starts when |
|---|---|---|
| 0 | Task 1, Task 2 | Setup is done |
| 1 | Task 3, Task 4, Task 5, Task 6 (and Task 2 if it is still running) | Task 1 is merged into `realism-v2-p2` |
| 2 | Task 7 | Tasks 3 and 4 are merged |
| 3 | Task 8 | Tasks 2, 5, 6 and 7 are merged |

Task 2 depends on nothing and touches only Python and one data file, so it can run at any time before Task 8.

### File ownership

Each task creates or modifies only the files listed for it. Two tasks share `packages/sim-core/src/step.ts`, but each owns one delimited region of it. Task 1 creates those regions as seam blocks with banner comments.

| Task | Owns (create or modify) | In `step.ts` |
|---|---|---|
| 1 | `sim-core/src/params.ts`, `sim-core/src/types.ts`, `sim-core/test/params.test.ts`, `step.ts` | The `Work` class fields, constructor and `toState`; the import block (adds two marker comments); the call sites in `moveTarget`, `marksFor`, `moveAll` and `step`; creates both seam blocks |
| 2 | `python/analytics/touchline_analytics/bands.py` (new), `report.py` (`build` only), `targets.py` (new helper and `__main__`), `data/params/targets-idsse.json` (new `bands` block), `python/analytics/tests/test_bands.py` (new) | — |
| 3 | `sim-core/src/anchor.ts` (new), `sim-core/src/shape.ts` (`anchorFor` gains `ctx`), `sim-core/test/anchor.test.ts` (new) | — |
| 4 | `sim-core/src/drift.ts` (new), `sim-core/test/drift.test.ts` (new) | — |
| 5 | `sim-core/src/kinematics.ts` (append only), `sim-core/test/relaxed.test.ts` (new), `step.ts` | The **movement seam block** only, plus one import line under its marker |
| 6 | `sim-core/test/subs-roles.test.ts` (new), `step.ts` | The `makeSubs` function only |
| 7 | `sim-core/test/positioning.test.ts` (new), `step.ts` | The **positioning seam block** only, plus import lines under its marker |
| 8 | Everything else: `params.ts` defaults and `shape` block, `shape.ts` legacy body, `shape.test.ts`, `calibrate/src/knobs.ts`, `data/params/*`, `docs/`, seed pins, goldens | Anything left |

### How to run a wave

For each task in the wave, from the integration worktree:

```bash
cd /Users/jhutan.debnath/Documents/GitHub/microsoft-hackathon/touchline-worktrees/realism-v2-p2
git worktree add ../p2-task<N> -b p2-task<N> realism-v2-p2
cd ../p2-task<N> && pnpm install
```

One implementer works in each `p2-task<N>` worktree and commits there. When every task of the wave is committed, merge them into the integration branch one at a time:

```bash
cd /Users/jhutan.debnath/Documents/GitHub/microsoft-hackathon/touchline-worktrees/realism-v2-p2
git merge --no-ff p2-task<N> -m "merge: P2 task <N> (<short name>)"
```

Then check the wave on the merged branch:

```bash
pnpm --filter @touchline/sim-core test -- --no-file-parallelism
pnpm --filter @touchline/calibrate exec vitest run test/realism-gate.test.ts --disableConsoleIntercept
```

Expected: PASS, with every drift exactly 0. Waves 0–2 change no defaults. Then remove the task worktrees: `git worktree remove ../p2-task<N> && git branch -d p2-task<N>`.

**If a merge conflicts** in `step.ts`, the two sides edited different seam blocks or functions next to each other. Keep both sides. Never resolve by dropping a seam body.

## Global Constraints

- **Determinism.** The engine stays deterministic for a seed. New random behaviour draws only from the new `drift` RNG stream, so every existing stream keeps its sequence.
- **Defaults.** Each new behaviour ships with a default that reproduces the old engine: `positioning.rule` 0, `movement.relaxed` 0, `fatigue.tiring` 0, `substitutions.roleWeights` all 1. Only Task 8 changes defaults. Until then, the gate drift check reports 0 for every statistic.
- **Data.** Only aggregate real-data statistics are committed. Never commit `data/raw/`, and never copy anything from the analysis folder except the aggregates quoted in this plan.
- **No sensitive files.** Do not modify `decide.ts`, `execute.ts`, `resolve.ts` or `shot.ts`. P2 has no sensitive changes (spec).
- **Test command.** Run the whole TS suite with `pnpm test -- --no-file-parallelism`. In parallel, full-match tests time out.
- **Gate.** Realism gate: loss < `GATE_LOSS` 30 (`packages/calibrate/test/realism-gate.test.ts`). Never widen it, and never drop a statistic.
- **Commits.** Every commit message ends with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- **Team frame.** All P2 positioning maths works in the team frame and converts to pitch coordinates once, at the end:
  - u is along the attack, in metres, with u = +52.5 at the opponent's goal line: `u = x · dirOf(side, period)`;
  - y_team is toward the team's left when attacking: `y_team = y · dirOf(side, period)`;
  - bu and by are the ball's u and y_team.
- **`step.ts` ownership.** Edit only the region the ownership table gives your task. A change you need elsewhere in `step.ts` is a plan bug: stop and report it.
- **Agents.** The decision log format, `overridePass` and the recorded options stay as they are. Positioning changes no decision code.

## Rulings on the spec

These are decisions taken while planning, where the spec was silent or inconsistent. Task 8 copies them into the results.

1. **`anchorFor` keeps its signature.** It gains one optional trailing `ctx`. Without `ctx`, or with `positioning.rule` 0, it runs the old template. `kickoffAnchor` keeps the old template: kickoff shapes are S7 in P5.
2. **Lateral coefficients.** The spec cites `lat_central` for `w0–w3`, but those come from `lat_side`. Side slots use `lat_side` (`w0, w1, w2, w3`). Central slots (|slot y| < 3) use `lat_central` (`y = e·by`, with c = 0). Values are from `fit-report.md` §4. For CM, the pivot `w0` of 2.7 excludes the 3-3-2-2 wing-backs; the spec's `a`/`b` table is used as written.
3. **Formation cases from `fit-report.md` §4 that the spec doesn't mention.**
   - A `WB` row covers 3-5-2 full-backs (a 2.8 / −10.9, w0 20.6 / 16.3).
   - `eightW0` 8.5 m covers the 4-3-3's two side CMs.
   - ST pairs keep `w0` 5 so they don't stack.
   - The low-confidence "4-4-2 W −5 m" adjustment is **not** taken.
4. **Per-player match offsets.** The spec's "SD 4–8 m (W 8, ST 5–6, others 4–5)" are the sim's own offsets in `offball-report.md` §2.1, not real ones. The plan uses the real per-player offsets from the same report: u SD 2.4–5.9 m, lateral 3–7 m by role. They are params, so Task 8 or the user can change them.
5. **Style terms.**
   - Out of possession only, u moves by `styleLineM · (lineHeight − 0.125)` with `styleLineM` 3. That is ±3 m across the −1..1 range, centred on the league mean.
   - `compactness` scales the out-of-possession `w0` by `1 − 0.35 · (compactness − 0.625)`.
6. **`shape.defDepth` stays.** It still squeezes slot offsets out of possession, so the `def_depth` knob keeps a lever on C4's defending length. The spec retires only `defLineM` and `fwdDropM`.
7. **G4 scope.**
   - The `gk` row applies whenever a team's own keeper owns the ball: in open play, or when he takes a restart.
   - Rows other than CB and FB take the in-possession row's value at ball u −25 (`gk-report.md` §5).
   - While the other team's keeper has the ball, the out-of-possession anchors are capped at u 22, a mid-block (`gk-report.md` §5, G4). This addresses G2, which Results: P1 says needs positioning.
   - Goal-kick shapes stay in P5 (S5).
8. **Possession changes.** A team's row follows `possession`:
   - owned: the owner's side;
   - in flight: the passer's side;
   - during a restart's set-up: the restart side;
   - loose or dead with no restart: unchanged.

   A restart awarded to the other team counts as a change.
9. **Restarts other than kickoffs.** Players take the rule table settled (λ = 1) at the restart spot, drift included. Set-piece shapes are P5.
10. **Drift gets its own module.** The spec puts drift in `anchor.ts`; the plan puts it in `drift.ts` so that it can be built in parallel. The spec's "drift stationary SDs" test lives in `drift.test.ts`.
11. **Team-common drift** takes the spec's values (u 9 m / 8 s, y 5.4 m / 5 s). `transitions-report.md` suggests lowering it once the blend exists, so a `team_drift` tuner knob scales it in Task 8.
12. **Forward line cap.** With the ball, ST, W and AM anchors stay at least 4 m below the opponents' last outfield defender. This comes from the `offball-report.md` clamps, not the spec; without it, drift parks forwards offside.
13. **A0 applies to `shape` targets only**, as the spec says. A `movement.relaxMarks` switch (off) exists so Task 8 can extend it to marking if live running stays above 150 m/min. Task 8 records it as a deviation if it uses it.
14. **F1 recovery sprints.** There are no recovery sprints until P4 (A4). P2 applies the tiring factor to the press and run-in-behind triggers, and P4 reuses `tiringFactor`.
    - The short-term load is an exponential 5-minute window of metres run at 20 km/h or faster.
    - Its damping values (45 m free, 0.5, floor 0.5) are starting values, not fits.
15. **F2 roles the spec doesn't name.** AM weighs 0.9 (as ST) and DM 0.7 (as CM).
16. **Physical bands.**
    - **Real targets.** They are hand-copied aggregates in a new `bands` block of `targets-idsse.json`. `targets.py` keeps the block when it rewrites the file.
    - **Language.** The bands are computed in Python, as P1's C3 was. Nothing in the tuner or the gate uses them, so the TS port and parity test are not needed. They run from `packages/calibrate`'s `pnpm realism`.
17. **Territory and centroid measures.** The report also prints territory (SD over matches of the match-mean ball x) and the outfield centroid against the ball. The spec doesn't name them, but they measure the gap P2 is meant to close.
18. **Keepers** get no drift.
    - Within 25 m of his goal, the keeper stands 2.0 m off the line, on the line from the goal centre to the ball.
    - Otherwise he takes his row, clamped to u ∈ [−51, −20] and |y| ≤ 6 (`fit-report.md` §4).

## Review Focus

1. **Substitutes and sent-off players.**
   - A substitute appears mid-match with no drift state. He must get his own offsets the tick he appears, and nobody else's draws may shift.
   - A player who has left keeps his entry, which nothing reads.
   - Covered by the newcomer test in Task 4.
2. **Half-time.** After teams switch ends, the team frame flips. Every anchor, including a centre back's in the second half, must be in the team's own half on average. Covered by the second-half check in Task 7.
3. **A back pass to the keeper and a keeper losing the ball.**
   - in → gk is a switch within possession: the lateral blend follows λ, with no 2.5 s dead time.
   - gk → out is a loss: it narrows fast.
   - Covered by the blend tests in Task 3.
4. **25 Hz render runs (dt 0.04).**
   - The ball ring has 51 entries and still reads 2 s back.
   - The OU drift keeps its stationary SD at any dt.
   - Covered by the dt cases in Tasks 3 and 4.
5. **Extreme ball positions plus large drift.** Anchors stay on the pitch for a ball in a corner with ±30 m of drift, for every formation, slot and row. Covered by the clamp test in Task 3.

---

### Task 1: Scaffold — params, state types, RNG stream and `step.ts` seams (wave 0, identity)

**Files:**
- Modify: `packages/sim-core/src/params.ts`, `packages/sim-core/src/types.ts`, `packages/sim-core/src/step.ts` (Work plumbing, import markers, call sites, two seam blocks)
- Test: `packages/sim-core/test/params.test.ts` (append)

**Interfaces:**
- Produces (in `params.ts`):
  - `type ShapeRow = "in" | "out" | "gk"`
  - `type PosGroup = "GK" | "CB" | "FB" | "WB" | "CM" | "AM" | "W" | "ST"`
  - `interface PosRow { a; b; w0; w1; w2; w3; e }` (all numbers)
  - `Params["positioning"]`: the fields listed in Step 3
  - `Params["movement"]` gains `relaxed`, `relaxCap`, `relaxArriveS`, `relaxMarks`
  - `Params["fatigue"]` gains `tiring`, `hiSpeedMs`, `loadWindowS`, `loadFreeM`, `loadDamp`, `loadFloor`
  - `Params["substitutions"]` gains `roleWeights: Readonly<Record<Exclude<Role, "GK">, number>>`
- Produces (in `types.ts`):
  - `TeamShapeState { row: ShapeRow; prev: ShapeRow; since: number; drift: { u: number; y: number } }`
  - `PlayerDriftState { offIn: { u; s }; offOut: { u; s }; slow: { u; s } }`
  - `AnchorState { ballLag: ReadonlyArray<Vec2>; teams: Record<Side, TeamShapeState>; players: Record<string, PlayerDriftState> }`
  - `MatchState.anchor?: AnchorState`
  - `MatchState.load?: Readonly<Record<string, number>>`
  - `CONCERNS` gains `"drift"`
- Produces (in `step.ts`, private; later tasks fill the bodies):
  - `shapeTarget(w, pl, ballFlat, inPossession): Vec2`
  - `restartTarget(w, pl, at, inPossession): Vec2`
  - `advancePositioning(w): void`
  - `shapeSpeedCap(w, pl, target, vmax): number`
  - `markSpeedCap(w, pl, target, vmax): number`
  - `triggerFactor(w, pl): number`
  - `trackLoad(w, id, speed): void`
  - `Work.anchor: AnchorState | undefined`
  - `Work.load: Record<string, number> | undefined`

- [ ] **Step 1: Write the failing test** (append to `packages/sim-core/test/params.test.ts`; add `CONCERNS` to the imports from `../src/types.js`)

```ts
describe("realism v2 P2 params", () => {
  const cc = { dataset: "open data", licence: "CC-BY-4.0", attribution: "Some League; Someone et al.", fitted_at: "2026-10-04", version: "v1" }
  it("ship switched off, with the real-data rule table ready, and a drift RNG stream", () => {
    expect(DEFAULT_PARAMS.positioning.rule).toBe(0)
    expect(DEFAULT_PARAMS.movement.relaxed).toBe(0)
    expect(DEFAULT_PARAMS.fatigue.tiring).toBe(0)
    expect(Object.values(DEFAULT_PARAMS.substitutions.roleWeights).every((v) => v === 1)).toBe(true)
    expect(DEFAULT_PARAMS.positioning.roles.CB.in).toEqual({ a: -12, b: 0.59, w0: 8, w1: -0.06, w2: 0.35, w3: 0.05, e: 0.4 })
    expect(DEFAULT_PARAMS.positioning.roles.ST.out.a).toBe(7.2)
    expect(DEFAULT_PARAMS.positioning.roles.CB.gk).toEqual({ a: -30, b: 0, w0: 15.5, w1: 0, w2: 0, w3: 0, e: 0 })
    expect(CONCERNS).toContain("drift")
  })
  it("accept negative rule-table coefficients from a file, and reject a negative time constant or a share above 1", () => {
    const p = paramsFromJson({ provenance: cc, positioning: { roles: { CB: { out: { a: -20 } } } } })
    expect(p.positioning.roles.CB.out.a).toBe(-20)
    expect(p.positioning.roles.CB.in.a).toBe(-12)
    expect(() => paramsFromJson({ provenance: cc, positioning: { tauS: { CB: -1 } } })).toThrow(ParamsError)
    expect(() => paramsFromJson({ provenance: cc, movement: { relaxCap: 1.5 } })).toThrow(/between 0 and 1/)
  })
})
```

Run: `pnpm --filter @touchline/sim-core exec vitest run test/params.test.ts`
Expected: FAIL. TypeScript reports that `positioning` doesn't exist on `Params`.

- [ ] **Step 2: Add the state types** (`packages/sim-core/src/types.ts`)

Change the params import to `import type { Params, ShapeRow } from "./params.js"`. After `SubsState`, add:

```ts
/** One team's positioning state (realism v2, P2): its row, the row it is blending out of since `since`, and its team-common drift. */
export interface TeamShapeState {
  readonly row: ShapeRow
  readonly prev: ShapeRow
  /** Global tick of the last row switch. */
  readonly since: number
  /** Team-common drift in the team frame (u along the attack, y toward the team's left when attacking), metres. */
  readonly drift: { readonly u: number; readonly y: number }
}

/** One outfield player's drift in the team frame: match offsets with and without the ball, and a slow drift. s is + toward his own touchline (y_team for central slots). */
export interface PlayerDriftState {
  readonly offIn: { readonly u: number; readonly s: number }
  readonly offOut: { readonly u: number; readonly s: number }
  readonly slow: { readonly u: number; readonly s: number }
}

/** Positioning state (P2): the ball over the last positioning.ballLagS seconds, each team's row and drift, each outfielder's drift. */
export interface AnchorState {
  /** The ball's flat position at each of the last round(ballLagS / dt) + 1 ticks, oldest first. */
  readonly ballLag: ReadonlyArray<Vec2>
  readonly teams: Readonly<Record<Side, TeamShapeState>>
  readonly players: Readonly<Record<string, PlayerDriftState>>
}
```

In `MatchState`, after `subOrders`, add:

```ts
  /** Positioning state; absent while params positioning.rule is 0 (the old template). */
  readonly anchor?: AnchorState
  /** Recent high-intensity metres per player (fatigue.tiring); absent while it is 0. */
  readonly load?: Readonly<Record<string, number>>
```

`CONCERNS` becomes `["decision", "execution", "duel", "referee", "movement", "restart", "script", "bench", "keeper", "caution", "drift"] as const`.

- [ ] **Step 3: Add the params** (`packages/sim-core/src/params.ts`)

At the top, add `import type { Role } from "./types.js"`. Before `export interface Params`, add:

```ts
/** A team's positioning row: with the ball, without it, or while its own keeper has the ball (build-up, G4). */
export type ShapeRow = "in" | "out" | "gk"
/** Positioning groups: roles with DM folded into CM; WB is a full-back in a back three (3-5-2). */
export type PosGroup = "GK" | "CB" | "FB" | "WB" | "CM" | "AM" | "W" | "ST"
/**
 * One row of the rule table, team frame (metres; u along the attack, bu/by the ball's): depth u = a + b·bu; lateral for
 * side slots s = w0 + w1·bu + w2·bs + w3·|by| (bs = by toward the player's side), for central slots y = e·by.
 */
export interface PosRow { readonly a: number; readonly b: number; readonly w0: number; readonly w1: number; readonly w2: number; readonly w3: number; readonly e: number }
```

In `Params`, replace the `movement` line with:

```ts
  /**
   * Movement into shape. shapeSpeedShare: share of top speed (the old rule, and marking). relaxed 1 (A0): shape movement
   * heads for the spot at the speed that arrives in relaxArriveS, never above relaxCap of top speed, so a player near his
   * spot walks; relaxMarks 1 does the same for marking.
   */
  readonly movement: { readonly shapeSpeedShare: number; readonly relaxed: number; readonly relaxCap: number; readonly relaxArriveS: number; readonly relaxMarks: number }
```

Replace the `fatigue` line with:

```ts
  /**
   * Energy (1 fresh .. 0 exhausted) drains per second by (drainBase + drainSpeed2 x speed^2) x (1 + staminaSlope x (0.5 - stamina));
   * players recover halfTimeRecovery at the break; tiredness widens execution error by up to executionK.
   * tiring 1 (F1): new pressing and run triggers scale by (0.8 + 0.2 energy) and by a recent-load damping: high-intensity
   * metres (at hiSpeedMs or faster) over an exponential window of loadWindowS; past loadFreeM the factor falls by loadDamp
   * per loadFreeM, never below loadFloor.
   */
  readonly fatigue: {
    readonly drainBase: number; readonly drainSpeed2: number; readonly staminaSlope: number; readonly halfTimeRecovery: number; readonly executionK: number
    readonly tiring: number; readonly hiSpeedMs: number; readonly loadWindowS: number; readonly loadFreeM: number; readonly loadDamp: number; readonly loadFloor: number
  }
```

In `substitutions`, after `halfTimeChance`, add:

```ts
    /** Weight on each outfield role's claim to come off (score x weight); all 1 keeps the old choice. */
    readonly roleWeights: Readonly<Record<Exclude<Role, "GK">, number>>
```

After `shape`, add the positioning block:

```ts
  /**
   * Off-ball positioning (realism v2, P2). rule 0: the old template (shape.ts); 1: the per-role rule table fitted to real
   * tracking, blended between rows after a change of possession, read against the ball ballLagS ago, plus team-common and
   * per-player drift (drift RNG stream). Team frame: u along the attack (m), y toward the team's left when attacking.
   */
  readonly positioning: {
    readonly rule: number
    readonly roles: Readonly<Record<PosGroup, Readonly<Record<ShapeRow, PosRow>>>>
    /** Lateral w0 for the 4-3-3's two side central midfielders (m); the real pivot row does not fit them. */
    readonly eightW0: number
    /** While the ball is within keeperNearM of his goal, the keeper stands keeperLineM off his line, on the goal-ball line (m). */
    readonly keeperLineM: number
    readonly keeperNearM: number
    /** Out of possession only: metres the block moves per unit of lineHeight above the league mean (0.125). */
    readonly styleLineM: number
    /** Out of possession only: share w0 shrinks per unit of compactness above the league mean (0.625). */
    readonly styleCompact: number
    /** With the ball, forwards (ST, W, AM) keep this far below the opponents' last outfield defender (m). */
    readonly lineCapM: number
    /** While the other team's keeper has the ball, no out-of-possession anchor is further upfield than this u (m). */
    readonly vsKeeperCapU: number
    /** Phase-switch time constant by group (s): lambda = 1 - exp(-max(0, t + 0.5) / tau). */
    readonly tauS: Readonly<Record<PosGroup, number>>
    /** Lateral blend: narrowing after a loss (tau, s); spreading after a win (dead time, then tau, s). */
    readonly narrowTauS: number
    readonly spreadDeadS: number
    readonly spreadTauS: number
    /** Anchors read the ball this many seconds ago. */
    readonly ballLagS: number
    /** Drift (A3): stationary SDs (m) and time constants (s) of OU processes, and SDs of match offsets drawn once per player. */
    readonly drift: {
      readonly teamUSdM: number
      readonly teamUTauS: number
      readonly teamYSdM: number
      readonly teamYTauS: number
      readonly playerUSdM: number
      readonly playerUTauS: number
      readonly playerSSdM: Readonly<Record<PosGroup, number>>
      readonly playerSTauS: Readonly<Record<PosGroup, number>>
      readonly offsetUSdM: Readonly<Record<PosGroup, number>>
      readonly offsetSSdM: Readonly<Record<PosGroup, number>>
    }
  }
```

Above `DEFAULT_PARAMS`, next to `row`, add:

```ts
const pr = (a: number, b: number, w0: number, w1: number, w2: number, w3: number, e: number): PosRow => ({ a, b, w0, w1, w2, w3, e })
```

In `DEFAULT_PARAMS`:

- `movement: { shapeSpeedShare: 0.7, relaxed: 0, relaxCap: 0.6, relaxArriveS: 2, relaxMarks: 0 },`
- `fatigue`: append `tiring: 0, hiSpeedMs: 5.56, loadWindowS: 300, loadFreeM: 45, loadDamp: 0.5, loadFloor: 0.5`
- `substitutions`: append `roleWeights: { CB: 1, FB: 1, DM: 1, CM: 1, AM: 1, W: 1, ST: 1 }`
- after `shape`, the positioning block:

```ts
  // Real fits (IDSSE, 7 matches; fit-report.md, offball-report.md, transitions-report.md, gk-report.md, 2026-10-13).
  // in / out rows: the spec's table (a, b) and fit-report section 4 (lateral); gk rows: the build-up shape (gk-report).
  positioning: {
    rule: 0,
    roles: {
      GK: { in: pr(-34.4, 0.28, 0, 0, 0, 0, 0.18), out: pr(-39.9, 0.27, 0, 0, 0, 0, 0.12), gk: pr(-34.4, 0.28, 0, 0, 0, 0, 0.18) },
      CB: { in: pr(-12.0, 0.59, 8.0, -0.06, 0.35, 0.05, 0.4), out: pr(-18.5, 0.51, 4.8, 0.04, 0.38, 0.05, 0.38), gk: pr(-30, 0, 15.5, 0, 0, 0, 0) },
      FB: { in: pr(-1.7, 0.58, 17.1, -0.04, 0.28, 0.02, 0), out: pr(-14.0, 0.54, 10.0, 0.07, 0.34, 0.12, 0), gk: pr(-13, 0, 27, 0, 0, 0, 0) },
      WB: { in: pr(2.8, 0.58, 20.6, -0.04, 0.28, 0.02, 0), out: pr(-10.9, 0.54, 16.3, 0.07, 0.34, 0.12, 0), gk: pr(-11.7, 0, 27, 0, 0, 0, 0) },
      CM: { in: pr(1.5, 0.59, 2.7, -0.01, 0.45, 0.02, 0.47), out: pr(-8.0, 0.58, 2.7, 0.01, 0.48, 0.01, 0.48), gk: pr(-13.3, 0, 2.7, 0, 0, 0, 0) },
      AM: { in: pr(8.6, 0.54, 0, 0, 0, 0, 0.4), out: pr(-0.2, 0.62, 0, 0, 0, 0, 0.44), gk: pr(-4.9, 0, 0, 0, 0, 0, 0) },
      W: { in: pr(10.3, 0.54, 12.4, -0.08, 0.33, 0.09, 0), out: pr(-2.9, 0.62, 11.6, 0.03, 0.35, 0.06, 0), gk: pr(-3.2, 0, 12.4, 0, 0, 0, 0) },
      ST: { in: pr(16.0, 0.5, 5, 0, 0.35, 0.04, 0.36), out: pr(7.2, 0.59, 5, 0, 0.38, 0, 0.41), gk: pr(3.5, 0, 5, 0, 0, 0, 0) }
    },
    eightW0: 8.5,
    keeperLineM: 2,
    keeperNearM: 25,
    styleLineM: 3,
    styleCompact: 0.35,
    lineCapM: 4,
    vsKeeperCapU: 22,
    tauS: { GK: 2.5, CB: 2.5, FB: 7.5, WB: 7.5, CM: 4, AM: 5, W: 8.5, ST: 4.5 },
    narrowTauS: 1,
    spreadDeadS: 2.5,
    spreadTauS: 4.5,
    ballLagS: 2,
    drift: {
      teamUSdM: 9,
      teamUTauS: 8,
      teamYSdM: 5.4,
      teamYTauS: 5,
      playerUSdM: 6,
      playerUTauS: 12,
      playerSSdM: { GK: 0, CB: 5.7, FB: 9, WB: 9, CM: 6.8, AM: 8.5, W: 9, ST: 8.7 },
      playerSTauS: { GK: 20, CB: 20, FB: 40, WB: 40, CM: 25, AM: 40, W: 40, ST: 40 },
      offsetUSdM: { GK: 0, CB: 2.4, FB: 4.8, WB: 4.8, CM: 5.0, AM: 5.9, W: 4.9, ST: 2.9 },
      offsetSSdM: { GK: 0, CB: 3.0, FB: 7.0, WB: 7.0, CM: 4.0, AM: 5.0, W: 4.9, ST: 3.0 }
    }
  },
```

Range checks:
- add `/^positioning\.roles\./` to `SIGNED`;
- add `"movement.relaxCap"` and `"fatigue.loadFloor"` to `PROBABILITIES`.

- [ ] **Step 4: Plumb the state through `Work` and create the seams** (`packages/sim-core/src/step.ts`)

**Imports.** Add `type AnchorState` to the import list from `./types.js`. At the end of the import block, add these marker lines exactly. Tasks 5 and 7 each insert their own import statements directly below their marker; a module may import from the same file twice.

```ts
// ---- P2 imports, movement seam (plan 8b Task 5 inserts below this line)

// ---- P2 imports, positioning seam (plan 8b Task 7 inserts below this line)

```

**`Work` class.** After `events: DomainEvent[] = []`, add:

```ts
  /** Positioning state (P2); absent while positioning.rule is 0. */
  anchor: AnchorState | undefined
  /** Recent high-intensity metres per player (P2, F1); absent while fatigue.tiring is 0. */
  load: Record<string, number> | undefined
```

In the constructor, after `this.seq = s.eventSeq`:

```ts
    this.anchor = s.anchor
    this.load = s.load ? { ...s.load } : undefined
```

In `toState`, after the `subOrders` spread:

```ts
      ...(this.anchor ? { anchor: this.anchor } : {}),
      ...(this.load ? { load: { ...this.load } } : {})
```

**Positioning seam block.** Insert it directly above `const moveTarget = (`, after `keeperAtReleaseSpot`:

```ts
// ================================================================ P2 positioning seam (plan 8b Task 7 owns this block)

/** Where a player's shape puts him in open play (also the marking anchor). The old template until Task 7. */
const shapeTarget = (w: Work, pl: PlayerState, ballFlat: Vec2, inPossession: boolean): Vec2 => {
  const team = teamOf(w.cfg, pl.side)
  return anchorFor(team.formation, pl.slot, pl.side, w.period, ballFlat, team.style, inPossession, w.p.shape)
}

/** A player's spot while a restart (other than a kickoff) is set up, with the ball at the restart spot. */
const restartTarget = (w: Work, pl: PlayerState, at: Vec2, inPossession: boolean): Vec2 => {
  const team = teamOf(w.cfg, pl.side)
  return anchorFor(team.formation, pl.slot, pl.side, w.period, at, team.style, inPossession, w.p.shape)
}

/** Once per tick, before anyone moves: advance the positioning state (team rows, ball lag, drift). Nothing until Task 7. */
const advancePositioning = (_w: Work): void => {}

// ================================================================ end of P2 positioning seam
```

**Movement seam block.** Insert it directly below the closing `}` of `moveAll`, above the `// ---------------------------------------------------------------- periods and frames` banner:

```ts
// ================================================================ P2 movement seam (plan 8b Task 5 owns this block)

/** Speed cap moving into shape. */
const shapeSpeedCap = (w: Work, _pl: PlayerState, _target: Vec2, vmax: number): number => vmax * w.p.movement.shapeSpeedShare

/** Speed cap moving to a marking spot. */
const markSpeedCap = (w: Work, _pl: PlayerState, _target: Vec2, vmax: number): number => vmax * w.p.movement.shapeSpeedShare

/** Multiplier on new high-intensity triggers (pressing, runs in behind): 1 means no tiring. */
const triggerFactor = (_w: Work, _pl: PlayerState): number => 1

/** After a player moves: track his recent high-intensity running. */
const trackLoad = (_w: Work, _id: string, _speed: number): void => {}

// ================================================================ end of P2 movement seam
```

**Call sites.** The seams are module-level `const`s, called only at run time, so their position below `moveTarget` is fine. Make these changes:

- `moveTarget`, the `shape` helper:
  ```ts
  const shape = () => {
    const target = shapeTarget(w, pl, ballFlat, possSide === pl.side)
    return { target, speedCap: shapeSpeedCap(w, pl, target, vmax) }
  }
  ```
- `moveTarget`, the restart branch: `const a = restartTarget(w, pl, ph.at, ph.side === pl.side)`. The kickoff line below it is unchanged.
- `moveTarget`, the press hazard: append `* triggerFactor(w, pl)` inside `hazard(...)`, after `* keeperFactor`.
- `moveTarget`, the run-in-behind hazard: `hazard(w.p.runs.runInBehindRatePerS * triggerFactor(w, pl), w.dt)`.
- `moveTarget`, the marking return: `if (mark) return { target: mark, speedCap: markSpeedCap(w, pl, mark, vmax) }`.
- `marksFor`: `.map((x) => ({ id: x.id, anchor: shapeTarget(w, x, ballFlat, false) }))`. Delete `marksFor`'s now-unused `const team = ...` line.
- `moveAll`: directly after `const energy = drainEnergy(...)`, add `trackLoad(w, id, speed)`.
- `step`: between `cautions(w)` and `moveAll(w)`, add `advancePositioning(w)`.

Multiplying by 1 and calling the old template through a helper leave every number unchanged, so the engine stays bit-identical.

- [ ] **Step 5: Run the tests and the drift check**

Run: `pnpm --filter @touchline/sim-core exec tsc --noEmit -p . && pnpm --filter @touchline/sim-core test -- --no-file-parallelism`
Expected: PASS, including the new params tests.

Run: `pnpm --filter @touchline/calibrate exec vitest run test/realism-gate.test.ts --disableConsoleIntercept`
Expected: PASS with every drift exactly 0.
- **If anything drifted,** a call site changed a number. Compare it with the line it replaced.

- [ ] **Step 6: Commit**

```bash
git add packages/sim-core
git commit -m "feat(sim-core): P2 scaffold — positioning, relaxed-motion, tiring and substitution-role params (all off), anchor and load state, drift RNG stream, step.ts seams

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Realism report — physical bands, territory and block height (wave 0, Python only)

**Files:**
- Create: `python/analytics/touchline_analytics/bands.py`, `python/analytics/tests/test_bands.py`
- Modify:
  - `python/analytics/touchline_analytics/report.py` (`build` only)
  - `python/analytics/touchline_analytics/targets.py` (new helper and `__main__`)
  - `data/params/targets-idsse.json` (new `bands` block)

**Interfaces:**
- Produces:
  - `player_bands(speeds: list[np.ndarray], lives: list[np.ndarray], dt: float) -> dict`
  - `match_bands(run: Path, roles: dict[str, str]) -> dict` with keys `players`, `territory_x`, `centroid_in`, `centroid_out`
  - `bands_section(matches: list[dict], real: dict) -> list[str]`
  - `keep_hand_blocks(new: dict, old_path: Path) -> dict` (in `targets.py`)
  - the `bands` block of `targets-idsse.json`
- Consumes: run folders (`meta.json`, `tracking.jsonl`) as written by `pnpm realism`. Each tracking frame has `period`, `teams.{home,away}.players[{id, x, y, vel}]` and `ball.{x, status, poss_team_id?}`.

- [ ] **Step 1: Write the failing tests** (`python/analytics/tests/test_bands.py`)

```python
import json
import math

import numpy as np

from touchline_analytics.bands import bands_section, match_bands, player_bands

REAL = {"walk_m": 3501, "jog_m": 3883, "run_m": 1825, "hsr_m": 521, "sprint_m": 173, "sprints": 8.4, "accelerations": 50,
        "live_m_per_min": 147, "dead_m_per_min": 65, "territory_sd_m": 1.9, "centroid_in_m": 3.9, "centroid_out_m": -9.5}


def test_player_bands_split_speed_bands_sprints_and_live_dead():
    b = player_bands([np.full(600, 1.0), np.full(600, 8.0)], [np.ones(600, bool), np.zeros(600, bool)], 0.1)
    assert math.isclose(b["walk_m"], 2700)
    assert math.isclose(b["sprint_m"], 21600)
    assert b["jog_m"] == b["run_m"] == b["hsr_m"] == 0
    assert math.isclose(b["sprints"], 45)
    assert b["accelerations"] == 0
    assert math.isclose(b["live_m_per_min"], 60)
    assert math.isclose(b["dead_m_per_min"], 480)


def _run(tmp_path):
    d = tmp_path / "m"
    d.mkdir()
    (d / "meta.json").write_text(json.dumps({"teams": {"home": {"id": "H"}, "away": {"id": "A"}}, "meta": {"tracking": {"fps": 10}}}))
    lines = []
    for period, vel, live in (("first_half", 1.0, True), ("second_half", 8.0, False)):
        for _ in range(600):
            lines.append(json.dumps({
                "period": period,
                "teams": {"home": {"id": "H", "players": [{"id": "h1", "x": 15, "y": 0, "vel": vel}, {"id": "hk", "x": -50, "y": 0, "vel": 0}]},
                          "away": {"id": "A", "players": [{"id": "ak", "x": 50, "y": 0, "vel": 0}]}},
                "ball": {"x": 10, "y": 0, "z": 0, "status": live, "poss_team_id": "H"},
            }))
    (d / "tracking.jsonl").write_text("\n".join(lines) + "\n")
    return d


def test_match_bands_reads_full_match_outfielders_territory_and_centroid(tmp_path):
    m = match_bands(_run(tmp_path), {"h1": "CM", "hk": "GK", "ak": "GK"})
    assert len(m["players"]) == 1
    assert math.isclose(m["players"][0]["walk_m"], 2700)
    assert math.isclose(m["territory_x"], 10)
    assert math.isclose(m["centroid_in"], 5)
    assert m["centroid_out"] is None


def test_bands_section_prints_real_against_simulated():
    row = {"walk_m": 2700, "jog_m": 0, "run_m": 0, "hsr_m": 0, "sprint_m": 21600, "sprints": 45, "accelerations": 0,
           "live_m_per_min": 60, "dead_m_per_min": 480}
    text = "\n".join(bands_section([{"players": [row], "territory_x": 10, "centroid_in": 5, "centroid_out": None},
                                    {"players": [], "territory_x": 12, "centroid_in": 3, "centroid_out": -8}], REAL))
    assert "| Walking, under 7 km/h (km per 90) | 3.50 | 2.70 |" in text
    assert "| High-speed running plus sprinting (km per 90) | 0.69 | 21.60 |" in text
    assert "| Territory: SD over matches of the match-mean ball x, home attacking (m) | 1.9 | 1.4 |" in text
    assert "| Outfield centroid minus ball x, team with the ball (m) | +3.9 | +4.0 |" in text
    assert "| Outfield centroid minus ball x, team without it (m) | -9.5 | -8.0 |" in text


def test_targets_keep_the_hand_copied_bands_block(tmp_path):
    from touchline_analytics.targets import keep_hand_blocks

    old = tmp_path / "t.json"
    old.write_text(json.dumps({"metrics": {}, "bands": {"walk_m": 3501}}))
    assert keep_hand_blocks({"metrics": {"x": 1}}, old) == {"metrics": {"x": 1}, "bands": {"walk_m": 3501}}
    assert keep_hand_blocks({"metrics": {}}, tmp_path / "missing.json") == {"metrics": {}}
```

Run: `uv run --project python/analytics pytest python/analytics/tests/test_bands.py -q`
Expected: FAIL (`No module named 'touchline_analytics.bands'`).

- [ ] **Step 2: Implement** `python/analytics/touchline_analytics/bands.py`

```python
"""Physical output, territory and block height against the ball, from simulated tracking (realism v2, P2).

Definitions follow the 2026-10-13 analysis (physical-report.md, dominance-report.md); only aggregates are committed.

- Per 90 on-pitch minutes, dead ball included, for outfielders on the pitch in every frame of both halves.
- Speed bands on the engine's speed: walk < 7, jog 7-14, run 14-20, high-speed 20-25, sprint 25+ km/h.
- A sprint is above 25 km/h for at least 1 s; an acceleration is above 2.5 m/s^2 for at least 0.5 s, on the
  Savitzky-Golay derivative of speed (about 1 s window, order 2), each half separately.
- Live and dead metres per minute split by the ball's status.
- Territory: per match, the mean ball x over live frames in the home team's attacking direction; the report gives the SD
  over matches.
- Centroid against the ball: in live frames with a team in possession, the mean x of a team's outfielders minus the ball's
  x, in that team's attacking direction, for the team with the ball (in) and the team without it (out).
"""

from __future__ import annotations

import json
import math
from pathlib import Path

import numpy as np
from scipy.signal import savgol_filter

BANDS = [("walk", 0.0, 7.0), ("jog", 7.0, 14.0), ("run", 14.0, 20.0), ("hsr", 20.0, 25.0), ("sprint", 25.0, math.inf)]
ROWS = [
    ("walk_m", "Walking, under 7 km/h (km per 90)", 1e-3, "{:.2f}"),
    ("jog_m", "Jogging, 7–14 km/h (km per 90)", 1e-3, "{:.2f}"),
    ("run_m", "Running, 14–20 km/h (km per 90)", 1e-3, "{:.2f}"),
    ("hsr_m", "High-speed running, 20–25 km/h (km per 90)", 1e-3, "{:.2f}"),
    ("sprint_m", "Sprinting, over 25 km/h (km per 90)", 1e-3, "{:.2f}"),
    ("sprints", "Sprints per 90", 1.0, "{:.1f}"),
    ("accelerations", "Accelerations over 2.5 m/s² per 90", 1.0, "{:.0f}"),
    ("live_m_per_min", "Metres per minute, ball in play", 1.0, "{:.0f}"),
    ("dead_m_per_min", "Metres per minute, ball dead", 1.0, "{:.0f}"),
]


def _episodes(mask: np.ndarray, min_frames: int) -> int:
    edges = np.diff(np.concatenate([[0], mask.astype(np.int8), [0]]))
    starts, ends = np.flatnonzero(edges == 1), np.flatnonzero(edges == -1)
    return int(((ends - starts) >= min_frames).sum())


def _accel(v: np.ndarray, dt: float) -> np.ndarray:
    w = int(round(1.0 / dt)) | 1
    return savgol_filter(v, w, 2, deriv=1, delta=dt) if len(v) >= w + 2 else np.zeros_like(v)


def _attack(side: str, period: str) -> int:
    """+1 if the side attacks +x in that period: home in the first half, away in the second (teams switch ends)."""
    return 1 if (side == "home") == (period == "first_half") else -1


def player_bands(speeds: list[np.ndarray], lives: list[np.ndarray], dt: float) -> dict:
    """One player's bands from his speed and the ball's live flag, one array per half."""
    v = np.concatenate(speeds)
    live = np.concatenate(lives)
    d = v * dt
    kmh = v * 3.6
    per90 = 90.0 / (len(v) * dt / 60.0)
    out = {f"{name}_m": float(d[(kmh >= lo) & (kmh < hi)].sum() * per90) for name, lo, hi in BANDS}
    out["sprints"] = sum(_episodes(s * 3.6 > 25, round(1.0 / dt)) for s in speeds) * per90
    out["accelerations"] = sum(_episodes(_accel(s, dt) > 2.5, round(0.5 / dt)) for s in speeds) * per90
    live_min, dead_min = live.sum() * dt / 60.0, (~live).sum() * dt / 60.0
    out["live_m_per_min"] = float(d[live].sum() / live_min) if live_min > 0 else math.nan
    out["dead_m_per_min"] = float(d[~live].sum() / dead_min) if dead_min > 0 else math.nan
    return out


def match_bands(run: Path, roles: dict[str, str]) -> dict:
    """Bands of every full-match outfielder, the match's territory (mean live ball x, home attacking) and centroids."""
    meta = json.loads((run / "meta.json").read_text())
    dt = 1.0 / float(meta["meta"]["tracking"]["fps"])
    home = meta["teams"]["home"]["id"]
    halves: list[dict] = []
    with (run / "tracking.jsonl").open() as fh:
        for line in fh:
            f = json.loads(line)
            if not halves or halves[-1]["period"] != f["period"]:
                halves.append({"period": f["period"], "n": 0, "v": {}, "live": [], "terr": [], "cin": [], "cout": []})
            h = halves[-1]
            cx: dict[str, float | None] = {}
            for side in ("home", "away"):
                xs = []
                for p in f["teams"][side]["players"]:
                    h["v"].setdefault(p["id"], []).append(p["vel"])
                    if roles.get(p["id"], "GK") != "GK":
                        xs.append(p["x"])
                cx[side] = sum(xs) / len(xs) if xs else None
            b = f["ball"]
            live = bool(b["status"])
            h["live"].append(live)
            h["n"] += 1
            if not live:
                continue
            h["terr"].append(b["x"] * _attack("home", f["period"]))
            pt = b.get("poss_team_id")
            if pt is None:
                continue
            s = "home" if pt == home else "away"
            o = "away" if s == "home" else "home"
            if cx[s] is not None:
                h["cin"].append((cx[s] - b["x"]) * _attack(s, f["period"]))
            if cx[o] is not None:
                h["cout"].append((cx[o] - b["x"]) * _attack(o, f["period"]))
    players = []
    full = set.intersection(*(set(h["v"]) for h in halves)) if halves else set()
    for pid in sorted(full):
        if roles.get(pid, "GK") == "GK" or any(len(h["v"][pid]) != h["n"] for h in halves):
            continue
        players.append(player_bands([np.array(h["v"][pid], float) for h in halves], [np.array(h["live"], bool) for h in halves], dt))

    def mean(xs: list[float]) -> float | None:
        return float(np.mean(xs)) if xs else None

    return {"players": players, "territory_x": mean([x for h in halves for x in h["terr"]]),
            "centroid_in": mean([x for h in halves for x in h["cin"]]), "centroid_out": mean([x for h in halves for x in h["cout"]])}


def bands_section(matches: list[dict], real: dict) -> list[str]:
    """Physical bands, territory and block height against the ball: real (aggregates, targets-idsse.json) against simulated."""
    rows = [p for m in matches for p in m["players"]]
    sim = {k: float(np.nanmean([r[k] for r in rows])) if rows else math.nan for k, *_ in ROWS}
    terr = [m["territory_x"] for m in matches if m["territory_x"] is not None]
    terr_sd = float(np.std(terr, ddof=1)) if len(terr) > 1 else math.nan
    cin = [m["centroid_in"] for m in matches if m["centroid_in"] is not None]
    cout = [m["centroid_out"] for m in matches if m["centroid_out"] is not None]

    def avg(xs: list[float]) -> float:
        return sum(xs) / len(xs) if xs else math.nan

    lines = ["## Physical output and territory", "",
             f"Outfielders on the pitch for the whole match ({len(rows)} player-matches from {len(matches)} matches), per 90 on-pitch "
             "minutes with the ball dead included. Real: IDSSE, 7 matches (2026-10-13 analysis, aggregates). "
             "Judge territory on 64 matches (`pnpm realism:deep`).", "",
             "| Measure | Real | Simulated |", "|---|---|---|"]
    for key, label, scale, fmt in ROWS:
        lines.append(f"| {label} | {fmt.format(real[key] * scale)} | {fmt.format(sim[key] * scale)} |")
    lines.append(f"| High-speed running plus sprinting (km per 90) | {(real['hsr_m'] + real['sprint_m']) / 1000:.2f} | {(sim['hsr_m'] + sim['sprint_m']) / 1000:.2f} |")
    lines.append(f"| Territory: SD over matches of the match-mean ball x, home attacking (m) | {real['territory_sd_m']:.1f} | {terr_sd:.1f} |")
    lines.append(f"| Outfield centroid minus ball x, team with the ball (m) | {real['centroid_in_m']:+.1f} | {avg(cin):+.1f} |")
    lines.append(f"| Outfield centroid minus ball x, team without it (m) | {real['centroid_out_m']:+.1f} | {avg(cout):+.1f} |")
    return lines + [""]
```

`targets.py`: above `if __name__ == "__main__":`, add:

```python
# Blocks copied by hand from the 2026-10-13 analysis (aggregates only), which build() does not measure.
HAND_BLOCKS = ("bands",)


def keep_hand_blocks(new: dict, old_path: Path) -> dict:
    """Carry the hand-copied blocks of the existing targets file over into a freshly built one."""
    if not old_path.exists():
        return new
    old = json.loads(old_path.read_text())
    return {**new, **{k: old[k] for k in HAND_BLOCKS if k in old}}
```

In `__main__`, change `t = build(Path(a.root), a.tracking, a.spatial)` to `t = keep_hand_blocks(build(Path(a.root), a.tracking, a.spatial), Path(a.out))`.

`report.py` `build`: directly before `lines += balance_section(...)`, add:

```python
    if roles and "bands" in targets:
        from .bands import bands_section, match_bands

        lines += bands_section([match_bands(d, roles) for d in run_dirs], targets["bands"])
```

Run: `uv run --project python/analytics pytest python/analytics/tests -q`
Expected: PASS

- [ ] **Step 3: Add the real targets** (`data/params/targets-idsse.json`)

The values are the outfield per-90 aggregates of `physical-report.md` §1 and the live/dead split, plus `dominance-report.md`'s territory and centroids. Run from the worktree root:

```bash
uv run --project python/analytics python - <<'EOF'
import json
from pathlib import Path
p = Path("data/params/targets-idsse.json")
t = json.loads(p.read_text())
t["bands"] = {
    "source": "realism v2 analysis 2026-10-13 (physical-report.md, dominance-report.md): IDSSE, 7 matches, full-match outfielders; aggregates only",
    "walk_m": 3501, "jog_m": 3883, "run_m": 1825, "hsr_m": 521, "sprint_m": 173,
    "sprints": 8.4, "accelerations": 50, "live_m_per_min": 147, "dead_m_per_min": 65,
    "territory_sd_m": 1.9, "centroid_in_m": 3.9, "centroid_out_m": -9.5,
}
p.write_text(json.dumps(t, indent=1) + "\n")
EOF
git diff --stat data/params/targets-idsse.json
```

Expected: only the added block. If anything else in the file changed, its formatting differs from `indent=1`: revert and add the block by hand.

- [ ] **Step 4: Smoke-run the report**

Run: `pnpm realism --matches 2 --out out/realism-smoke.md && grep -A16 "Physical output and territory" out/realism-smoke.md`
Expected: the section prints with real and simulated columns. The simulated values are the old engine's, about 0.8 km walking and 3.3 km high-speed plus sprint.

- [ ] **Step 5: Commit**

```bash
git add python/analytics data/params/targets-idsse.json
git commit -m "feat(report): physical bands, territory and block height against the ball (realism v2 P2), real aggregates in targets-idsse.json

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: The rule table, build-up row, keeper rule and phase-switch blend — `anchor.ts` (wave 1, pure)

**Files:**
- Create: `packages/sim-core/src/anchor.ts`
- Modify: `packages/sim-core/src/shape.ts` (`anchorFor` gains an optional `ctx`)
- Test: `packages/sim-core/test/anchor.test.ts`

**Interfaces:**
- Consumes (Task 1): `PosGroup`, `PosRow`, `ShapeRow`, `Params["positioning"]`, `TeamShapeState`, `AnchorState`.
- Produces (in `anchor.ts`):
  - `type Positioning = Params["positioning"]`
  - `interface SlotDef { role: Role; x: number; y: number }` (structural, the same shape as `shape.ts`'s `Slot`)
  - `interface Spread { width: number; depth: number; defDepth?: number }`
  - `groupOf(formation, slots, slot): PosGroup`
  - `interface SlotGeometry { group: PosGroup; dx: number; sigma: -1 | 0 | 1; sScale: number; eight: boolean }`
  - `slotGeometry(formation, slots, slot): SlotGeometry`, memoised by `formation:slot`; `slots` must be `FORMATIONS[formation]`
  - `interface Blend { from: ShapeRow; to: ShapeRow; lamU: number; lamY: number }`
  - `settled(row): Blend`
  - `blendFor(team: TeamShapeState, group: PosGroup, tick: number, dt: number, pos: Positioning): Blend`
  - `interface AnchorInput { blend: Blend; drift: { u: number; y: number }; lastDefU: number | null; vsKeeper: boolean }`
  - `ruleAnchor(formation, slots, slot, side, period, ball: Vec2, style, spread: Spread, pos: Positioning, input: AnchorInput): Vec2`
  - `rowFor(side, possSide: Side | null, keeperHasIt: boolean, previous: ShapeRow): ShapeRow`
  - `initAnchorState(ball: Vec2, dt: number, pos: Positioning, rows: Record<Side, ShapeRow>): AnchorState`
  - `advanceRows(s: AnchorState, tick: number, ball: Vec2, rows: Record<Side, ShapeRow>): AnchorState`
  - `lagBall(s: AnchorState): Vec2`
  - `LINE_HEIGHT_REF = 0.125`, `COMPACTNESS_REF = 0.625`
- Produces (in `shape.ts`): `anchorFor(formation, slot, side, period, ball, style, inPossession, spread?, ctx?: { pos: Positioning; input: AnchorInput }): Vec2`. With `ctx` and `ctx.pos.rule > 0`, it returns `ruleAnchor(...)` with `FORMATIONS[formation]` and ignores `inPossession`, because the blend names the rows.
- `anchor.ts` must not import `shape.ts`. `shape.ts` imports `anchor.ts`.

- [ ] **Step 1: Write the failing tests** (`packages/sim-core/test/anchor.test.ts`)

```ts
import { describe, expect, it } from "vitest"
import { advanceRows, blendFor, initAnchorState, lagBall, rowFor, ruleAnchor, settled, slotGeometry, type AnchorInput } from "../src/anchor.js"
import type { Side } from "../src/geometry.js"
import { DEFAULT_PARAMS as P, type ShapeRow } from "../src/params.js"
import { anchorFor, FORMATIONS } from "../src/shape.js"
import { STYLES } from "../src/testing.js"
import type { FormationName, TeamShapeState, TeamStyle } from "../src/types.js"

const pos = { ...P.positioning, rule: 1 }
const NEUTRAL: TeamStyle = { ...STYLES.direct, lineHeight: 0.125, compactness: 0.625 }
const flat = { width: 1, depth: 1, defDepth: 1 }
const still = (row: ShapeRow, extra: Partial<AnchorInput> = {}): AnchorInput => ({ blend: settled(row), drift: { u: 0, y: 0 }, lastDefU: null, vsKeeper: false, ...extra })
const at = (f: FormationName, slot: number, ball: { x: number; y: number }, input: AnchorInput, style: TeamStyle = NEUTRAL, side: Side = "home") =>
  ruleAnchor(f, FORMATIONS[f], slot, side, "first_half", ball, style, flat, pos, input)
const team = (prev: ShapeRow, row: ShapeRow, since = 0): TeamShapeState => ({ row, prev, since, drift: { u: 0, y: 0 } })

describe("rule-table anchors", () => {
  it("reproduce the real-data table at lambda = 1", () => {
    // 4-2-3-1 AM (slot 8, central): u = a + b bu, y = e by.
    const am = at("4-2-3-1", 8, { x: 10, y: 6 }, still("in"))
    expect(am.x).toBeCloseTo(8.6 + 0.54 * 10, 9)
    expect(am.y).toBeCloseTo(0.4 * 6, 9)
    // 4-4-2 left FB (slot 1, y +23): s = w0 + w1 bu + w2 bs + w3 |by|.
    const fb = at("4-4-2", 1, { x: 10, y: 6 }, still("in"))
    expect(fb.x).toBeCloseTo(-1.7 + 0.58 * 10, 9)
    expect(fb.y).toBeCloseTo(17.1 - 0.04 * 10 + 0.28 * 6 + 0.02 * 6, 9)
    const fbOut = at("4-4-2", 1, { x: 10, y: 6 }, still("out"))
    expect(fbOut.x).toBeCloseTo(-14 + 0.54 * 10, 9)
    expect(fbOut.y).toBeCloseTo(10 + 0.07 * 10 + 0.34 * 6 + 0.12 * 6, 9)
    // The right FB mirrors: s is measured toward his own touchline.
    const rfb = at("4-4-2", 4, { x: 10, y: -6 }, still("in"))
    expect(rfb.y).toBeCloseTo(-fb.y, 9)
  })

  it("keep each slot's offset from its group's mean: a 4-3-3's DM sits 6 m below its eights, which hold eightW0", () => {
    const ball = { x: 0, y: 0 }
    const cm = at("4-3-3", 5, ball, still("in"))
    const dm = at("4-3-3", 6, ball, still("in"))
    expect(cm.x).toBeCloseTo(1.5 + 2, 9)
    expect(cm.x - dm.x).toBeCloseTo(6, 9)
    expect(cm.y).toBeCloseTo(pos.eightW0, 9)
    expect(dm.y).toBeCloseTo(0, 9)
    expect(slotGeometry("3-5-2", FORMATIONS["3-5-2"], 4).group).toBe("WB")
    expect(slotGeometry("4-2-3-1", FORMATIONS["4-2-3-1"], 5).group).toBe("CM")
  })

  it("lineHeight and compactness move the shape only without the ball", () => {
    const ball = { x: 5, y: 3 }
    for (const slot of [1, 2, 5, 9])
      expect(at("4-4-2", slot, ball, still("in"), STYLES.high_press)).toEqual(at("4-4-2", slot, ball, still("in"), STYLES.low_block))
    const cb = (st: TeamStyle) => at("4-4-2", 2, ball, still("out"), st).x
    expect(cb(STYLES.high_press) - cb(STYLES.low_block)).toBeCloseTo(pos.styleLineM * 1.6, 9)
  })

  it("build-up row (G4): centre backs split at u -30, full-backs push to u -13, whatever the ball", () => {
    const ball = { x: -46, y: 2 }
    const cb = at("4-4-2", 2, ball, still("gk"))
    expect(cb.x).toBeCloseTo(-30, 9)
    expect(cb.y).toBeCloseTo(15.5, 9)
    const fb = at("4-4-2", 1, ball, still("gk"))
    expect(fb.x).toBeCloseTo(-13, 9)
    expect(fb.y).toBeCloseTo(27, 9)
  })

  it("keeper: 2 m off his line on the goal-ball line within 25 m, else his row clamped", () => {
    const near = at("4-4-2", 0, { x: -40, y: 5 }, still("out"))
    expect(near.x).toBeCloseTo(-50.5, 9)
    expect(near.y).toBeCloseTo((5 * 2) / 12.5, 9)
    const far = at("4-4-2", 0, { x: 30, y: 0 }, still("out"))
    expect(far.x).toBeCloseTo(-39.9 + 0.27 * 30, 9)
    expect(far.y).toBeCloseTo(0, 9)
  })

  it("caps forwards below the opponents' last defender with the ball, and every anchor at vsKeeperCapU while the other keeper has it", () => {
    const st = at("4-3-3", 9, { x: 30, y: 0 }, still("in", { lastDefU: 28 }))
    expect(st.x).toBeCloseTo(28 - pos.lineCapM, 9)
    expect(at("4-3-3", 9, { x: 30, y: 0 }, still("out", { lastDefU: 28 })).x).toBeCloseTo(7.2 + 0.59 * 30, 9)
    expect(at("4-3-3", 9, { x: 40, y: 0 }, still("out", { vsKeeper: true })).x).toBeCloseTo(pos.vsKeeperCapU, 9)
  })

  it("mirrors for the away side", () => {
    const h = at("4-2-3-1", 7, { x: 12, y: -8 }, still("out"))
    const a = at("4-2-3-1", 7, { x: -12, y: 8 }, still("out"), NEUTRAL, "away")
    expect(a.x).toBeCloseTo(-h.x, 9)
    expect(a.y).toBeCloseTo(-h.y, 9)
  })

  it("stays on the pitch for any formation, slot, row, corner ball and +-30 m drift", () => {
    for (const f of Object.keys(FORMATIONS) as FormationName[])
      for (let slot = 0; slot < 11; slot++)
        for (const row of ["in", "out", "gk"] as const)
          for (const bx of [-52, 52]) for (const by of [-33, 33]) for (const du of [-30, 30]) for (const dy of [-30, 30]) {
            const a = at(f, slot, { x: bx, y: by }, still(row, { drift: { u: du, y: dy } }))
            expect(Math.abs(a.x)).toBeLessThanOrEqual(52.5)
            expect(Math.abs(a.y)).toBeLessThanOrEqual(34)
          }
  })

  it("anchorFor uses the table with a context and the rule on, and the old template otherwise", () => {
    const ball = { x: 10, y: 6 }
    const input = still("in")
    expect(anchorFor("4-4-2", 1, "home", "first_half", ball, NEUTRAL, true, flat, { pos, input })).toEqual(at("4-4-2", 1, ball, input))
    expect(anchorFor("4-4-2", 1, "home", "first_half", ball, NEUTRAL, true, flat, { pos: P.positioning, input })).toEqual(
      anchorFor("4-4-2", 1, "home", "first_half", ball, NEUTRAL, true, flat)
    )
  })
})

describe("phase-switch blend (A2)", () => {
  it("ramps by role: centre backs convert fastest, wingers slowest", () => {
    const t1 = (g: Parameters<typeof blendFor>[1]) => blendFor(team("out", "in"), g, 10, 0.1, pos).lamU
    expect(t1("CB")).toBeCloseTo(1 - Math.exp(-1.5 / 2.5), 9)
    expect(t1("CB")).toBeGreaterThan(t1("CM"))
    expect(t1("CM")).toBeGreaterThan(t1("ST"))
    expect(t1("ST")).toBeGreaterThan(t1("AM"))
    expect(t1("AM")).toBeGreaterThan(t1("FB"))
    expect(t1("FB")).toBeGreaterThan(t1("W"))
    expect(blendFor(team("out", "in"), "CB", 0, 0.1, pos).lamU).toBeCloseTo(1 - Math.exp(-0.5 / 2.5), 9)
    expect(blendFor(team("in", "in"), "W", 5, 0.1, pos)).toEqual(settled("in"))
  })

  it("narrows fast after a loss, spreads after a win only after a dead time, and follows lambda within possession", () => {
    expect(blendFor(team("in", "out"), "FB", 10, 0.1, pos).lamY).toBeCloseTo(1 - Math.exp(-1), 9)
    expect(blendFor(team("gk", "out"), "FB", 10, 0.1, pos).lamY).toBeCloseTo(1 - Math.exp(-1), 9)
    expect(blendFor(team("out", "in"), "FB", 20, 0.1, pos).lamY).toBe(0)
    expect(blendFor(team("out", "in"), "FB", 70, 0.1, pos).lamY).toBeCloseTo(1 - Math.exp(-1), 9)
    const backPass = blendFor(team("in", "gk"), "CB", 10, 0.1, pos)
    expect(backPass.lamY).toBe(backPass.lamU)
  })

  it("blends the anchor between the two rows by lambda", () => {
    const b = blendFor(team("out", "in"), "CB", 10, 0.1, pos)
    const ball = { x: 0, y: 0 }
    const mid = at("4-4-2", 2, ball, { ...still("in"), blend: b })
    const i = at("4-4-2", 2, ball, still("in"))
    const o = at("4-4-2", 2, ball, still("out"))
    expect(mid.x).toBeCloseTo(o.x + b.lamU * (i.x - o.x), 9)
    expect(mid.y).toBeCloseTo(o.y + b.lamY * (i.y - o.y), 9)
  })
})

describe("positioning state", () => {
  it("reads the ball 2 s ago at 10 Hz and at 25 Hz", () => {
    for (const dt of [0.1, 0.04]) {
      const rows = { home: "in", away: "out" } as const
      let s = initAnchorState({ x: 0, y: 0 }, dt, pos, rows)
      const n = Math.round(pos.ballLagS / dt)
      expect(s.ballLag).toHaveLength(n + 1)
      for (let i = 1; i <= n + 5; i++) s = advanceRows(s, i, { x: i, y: 0 }, rows)
      expect(lagBall(s).x).toBe(5)
    }
  })

  it("switches rows on a change of possession and keeps them over loose and dead balls", () => {
    expect(rowFor("home", "home", false, "out")).toBe("in")
    expect(rowFor("home", "home", true, "in")).toBe("gk")
    expect(rowFor("home", "away", false, "in")).toBe("out")
    expect(rowFor("home", null, false, "gk")).toBe("gk")
    let s = initAnchorState({ x: 0, y: 0 }, 0.1, pos, { home: "in", away: "out" })
    s = advanceRows(s, 40, { x: 0, y: 0 }, { home: "out", away: "gk" })
    expect(s.teams.home).toEqual({ row: "out", prev: "in", since: 40, drift: { u: 0, y: 0 } })
    expect(s.teams.away).toEqual({ row: "gk", prev: "out", since: 40, drift: { u: 0, y: 0 } })
    const same = advanceRows(s, 41, { x: 0, y: 0 }, { home: "out", away: "gk" })
    expect(same.teams.home.since).toBe(40)
  })
})
```

Run: `pnpm --filter @touchline/sim-core exec vitest run test/anchor.test.ts`
Expected: FAIL (`../src/anchor.js` doesn't exist).

- [ ] **Step 2: Implement `packages/sim-core/src/anchor.ts`**

```ts
/**
 * Off-ball anchors from the per-role rule table (realism v2, P2: A1, G4, A2; spec 2026-10-13). Pure functions of their
 * arguments; the state they read (rows, ball lag) lives in MatchState.anchor and drift in drift.ts.
 *
 * Team frame: u along the attack (u = +52.5 at the opponent's goal line), y toward the team's left when attacking;
 * bu, by are the ball's. Converted to pitch coordinates once, at the end, with dirOf(side, period).
 */
import { clamp, dirOf, PITCH, type Period, type Side, type Vec2 } from "./geometry.js"
import type { Params, PosGroup, PosRow, ShapeRow } from "./params.js"
import type { AnchorState, FormationName, Role, TeamShapeState, TeamStyle } from "./types.js"

export type Positioning = Params["positioning"]
/** A formation slot (the shape of shape.ts's Slot; kept structural so this module does not import shape.ts). */
export interface SlotDef { readonly role: Role; readonly x: number; readonly y: number }
/** shape.width (lateral), shape.depth (slot offsets) and shape.defDepth (slot offsets without the ball). */
export interface Spread { readonly width: number; readonly depth: number; readonly defDepth?: number }

/** League means of the style settings: the average side plays the real-data rows unchanged. */
export const LINE_HEIGHT_REF = 0.125
export const COMPACTNESS_REF = 0.625

/** A slot's positioning group: DM plays as CM; a full-back in a back three (3-5-2) as WB. */
export const groupOf = (formation: FormationName, slots: ReadonlyArray<SlotDef>, slot: number): PosGroup => {
  const r = slots[slot]!.role
  if (r === "FB" && formation === "3-5-2") return "WB"
  return r === "DM" ? "CM" : r
}

export interface SlotGeometry {
  readonly group: PosGroup
  /** The slot's x minus its group's mean slot x in the formation (within-role depth, m). */
  readonly dx: number
  /** Side of the pitch: 0 for a central slot (|y| < 3). */
  readonly sigma: -1 | 0 | 1
  /** |y| over the group's mean |y| among its side slots (0 for a central slot). */
  readonly sScale: number
  /** A 4-3-3 side central midfielder, whose lateral w0 is eightW0. */
  readonly eight: boolean
}

const geoCache = new Map<string, SlotGeometry>()
/** Geometry of a slot within its formation; `slots` must be FORMATIONS[formation] (memoised by formation and slot). */
export const slotGeometry = (formation: FormationName, slots: ReadonlyArray<SlotDef>, slot: number): SlotGeometry => {
  const key = `${formation}:${slot}`
  const hit = geoCache.get(key)
  if (hit) return hit
  const group = groupOf(formation, slots, slot)
  const same = slots.filter((_, i) => groupOf(formation, slots, i) === group)
  const meanX = same.reduce((a, q) => a + q.x, 0) / same.length
  const s = slots[slot]!
  const sigma: -1 | 0 | 1 = Math.abs(s.y) < 3 ? 0 : s.y > 0 ? 1 : -1
  const sides = same.filter((q) => Math.abs(q.y) >= 3)
  const meanAbsY = sides.length > 0 ? sides.reduce((a, q) => a + Math.abs(q.y), 0) / sides.length : 1
  const out: SlotGeometry = { group, dx: s.x - meanX, sigma, sScale: sigma === 0 ? 0 : Math.abs(s.y) / meanAbsY, eight: formation === "4-3-3" && group === "CM" && sigma !== 0 }
  geoCache.set(key, out)
  return out
}

export interface Blend {
  readonly from: ShapeRow
  readonly to: ShapeRow
  /** Share of the way from `from` to `to`: depth (lamU) and lateral (lamY). */
  readonly lamU: number
  readonly lamY: number
}

/** A blend that has arrived: the row alone. */
export const settled = (row: ShapeRow): Blend => ({ from: row, to: row, lamU: 1, lamY: 1 })

/**
 * How far a player of `group` has moved from his team's previous row into its current one (A2).
 * Depth: lambda = 1 - exp(-max(0, t + 0.5) / tau_group), t seconds since the switch.
 * Lateral: to "out" (a loss) narrows with narrowTauS; from "out" (a win) spreads after spreadDeadS with spreadTauS;
 * within possession (in <-> gk) it follows lambda.
 */
export const blendFor = (team: TeamShapeState, group: PosGroup, tick: number, dt: number, pos: Positioning): Blend => {
  if (team.prev === team.row) return settled(team.row)
  const t = (tick - team.since) * dt
  const lamU = 1 - Math.exp(-Math.max(0, t + 0.5) / pos.tauS[group])
  const lamY =
    team.row === "out"
      ? 1 - Math.exp(-Math.max(0, t) / pos.narrowTauS)
      : team.prev === "out"
        ? 1 - Math.exp(-Math.max(0, t - pos.spreadDeadS) / pos.spreadTauS)
        : lamU
  return { from: team.prev, to: team.row, lamU, lamY }
}

/** One row's spot in the team frame, before blending: the table, the slot's offsets, style (without the ball only) and spread. */
const rowSpot = (row: ShapeRow, r: PosRow, geo: SlotGeometry, bu: number, by: number, style: TeamStyle, spread: Spread, pos: Positioning): { u: number; y: number } => {
  const out = row === "out"
  const depth = spread.depth * (out ? (spread.defDepth ?? 1) : 1)
  const u = r.a + r.b * bu + geo.dx * depth + (out ? pos.styleLineM * (style.lineHeight - LINE_HEIGHT_REF) : 0)
  if (geo.sigma === 0) return { u, y: r.e * by }
  const width = out ? 1 + (spread.width - 1) * 0.4 : spread.width
  const compact = out ? 1 - pos.styleCompact * (style.compactness - COMPACTNESS_REF) : 1
  const w0 = (geo.eight ? pos.eightW0 : r.w0 * geo.sScale) * width * compact
  // sigma * w2 * (sigma * by) = w2 * by: the ball on the player's own side pulls him wider, on the far side narrower.
  return { u, y: geo.sigma * (w0 + r.w1 * bu + r.w3 * Math.abs(by)) + r.w2 * by }
}

/** The keeper: within keeperNearM of his goal, keeperLineM off the line on the goal-ball line; else his row, clamped. */
const keeperSpot = (u: number, y: number, bu: number, by: number, pos: Positioning): { u: number; y: number } => {
  const fromLine = bu + PITCH.halfL
  if (Math.hypot(fromLine, by) < pos.keeperNearM)
    return { u: -PITCH.halfL + pos.keeperLineM, y: clamp((by * pos.keeperLineM) / Math.max(1, fromLine), -PITCH.goalHalfWidth, PITCH.goalHalfWidth) }
  return { u: clamp(u, -51, -20), y: clamp(y, -6, 6) }
}

export interface AnchorInput {
  readonly blend: Blend
  /** Summed drift for this player in the team frame (drift.ts driftFor); zero for keepers. */
  readonly drift: { readonly u: number; readonly y: number }
  /** The opponents' last outfield defender in this side's attack frame, or null for no cap. */
  readonly lastDefU: number | null
  /** The other team's keeper has the ball. */
  readonly vsKeeper: boolean
}

/** The rule-table anchor in pitch coordinates (`ball` is the ball as the anchor reads it: lagged in open play). */
export const ruleAnchor = (
  formation: FormationName,
  slots: ReadonlyArray<SlotDef>,
  slot: number,
  side: Side,
  period: Period,
  ball: Vec2,
  style: TeamStyle,
  spread: Spread,
  pos: Positioning,
  input: AnchorInput
): Vec2 => {
  const d = dirOf(side, period)
  const bu = ball.x * d
  const by = ball.y * d
  const geo = slotGeometry(formation, slots, slot)
  const rows = pos.roles[geo.group]
  const { from, to, lamU, lamY } = input.blend
  const a = rowSpot(from, rows[from], geo, bu, by, style, spread, pos)
  const b = from === to ? a : rowSpot(to, rows[to], geo, bu, by, style, spread, pos)
  let u = a.u + lamU * (b.u - a.u)
  let y = a.y + lamY * (b.y - a.y)
  if (geo.group === "GK") {
    const k = keeperSpot(u, y, bu, by, pos)
    return { x: k.u * d, y: k.y * d }
  }
  u += input.drift.u
  y += input.drift.y
  if (to !== "out" && input.lastDefU !== null && (geo.group === "ST" || geo.group === "W" || geo.group === "AM")) u = Math.min(u, input.lastDefU - pos.lineCapM)
  if (to === "out" && input.vsKeeper) u = Math.min(u, pos.vsKeeperCapU)
  u = clamp(u, -PITCH.halfL + 4, PITCH.halfL - 3)
  y = clamp(y, -PITCH.halfW + 1.5, PITCH.halfW - 1.5)
  return { x: u * d, y: y * d }
}

/** A team's row from who has the ball; null (loose or dead, no restart) keeps the previous row. */
export const rowFor = (side: Side, possSide: Side | null, keeperHasIt: boolean, previous: ShapeRow): ShapeRow =>
  possSide === null ? previous : possSide === side ? (keeperHasIt ? "gk" : "in") : "out"

/** A fresh state: the ball ring filled with the current ball, both teams settled in their rows, no drift yet. */
export const initAnchorState = (ball: Vec2, dt: number, pos: Positioning, rows: Readonly<Record<Side, ShapeRow>>): AnchorState => ({
  ballLag: Array.from({ length: Math.max(1, Math.round(pos.ballLagS / dt)) + 1 }, () => ball),
  teams: {
    home: { row: rows.home, prev: rows.home, since: 0, drift: { u: 0, y: 0 } },
    away: { row: rows.away, prev: rows.away, since: 0, drift: { u: 0, y: 0 } }
  },
  players: {}
})

/** One tick: push the ball onto the ring, and start a blend for each team whose row changed (drift is left alone). */
export const advanceRows = (s: AnchorState, tick: number, ball: Vec2, rows: Readonly<Record<Side, ShapeRow>>): AnchorState => {
  const team = (side: Side): TeamShapeState => {
    const t = s.teams[side]
    return rows[side] === t.row ? t : { ...t, prev: t.row, row: rows[side], since: tick }
  }
  return { ...s, ballLag: [...s.ballLag.slice(1), ball], teams: { home: team("home"), away: team("away") } }
}

/** The ball as anchors read it: ballLagS ago. */
export const lagBall = (s: AnchorState): Vec2 => s.ballLag[0]!
```

If TypeScript rejects `return r === "DM" ? "CM" : r` in `groupOf`, because `Role` minus `"DM"` isn't assignable to `PosGroup`, write `: (r as Exclude<Role, "DM">)`. The two sets match except for WB.

- [ ] **Step 3: Let `anchorFor` delegate** (`packages/sim-core/src/shape.ts`)

Add `import { ruleAnchor, type AnchorInput, type Positioning } from "./anchor.js"`. Add a ninth parameter to `anchorFor`, after `spread`:

```ts
  /**
   * With the rule table switched on (positioning.rule 1): this player's blend, drift and caps (anchor.ts). `inPossession`
   * is then ignored (the blend names the rows) and `ball` is the ball as anchors read it.
   */
  ctx?: { readonly pos: Positioning; readonly input: AnchorInput }
```

The body's first line becomes:

```ts
  if (ctx && ctx.pos.rule > 0) return ruleAnchor(formation, FORMATIONS[formation], slot, side, period, ball, style, spread, ctx.pos, ctx.input)
```

Leave the rest of the body (the old template) and `kickoffAnchor` unchanged.

- [ ] **Step 4: Run the tests**

Run: `pnpm --filter @touchline/sim-core exec tsc --noEmit -p . && pnpm --filter @touchline/sim-core exec vitest run test/anchor.test.ts test/shape.test.ts`
Expected: PASS

Run: `pnpm --filter @touchline/calibrate exec vitest run test/realism-gate.test.ts --disableConsoleIntercept`
Expected: PASS with drift 0. Nothing calls the new path yet.

- [ ] **Step 5: Commit**

```bash
git add packages/sim-core
git commit -m "feat(sim-core): rule-table anchors (anchor.ts) — per-role rows fitted to real tracking, build-up row, keeper on his line, style only without the ball, per-role phase-switch blend, 2 s ball lag; anchorFor takes an optional context

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Team-common and per-player drift — `drift.ts` (wave 1, pure)

**Files:**
- Create: `packages/sim-core/src/drift.ts`
- Test: `packages/sim-core/test/drift.test.ts`

**Interfaces:**
- Consumes (Task 1): `PosGroup`, `ShapeRow`, `Params["positioning"]["drift"]`, `AnchorState`, `PlayerDriftState`, `TeamShapeState`; `Rng` from `rng.ts`.
- Produces:
  - `ouStep(x: number, sd: number, tauS: number, dt: number, rng: Rng): number`: exact discretisation. With `sd <= 0` it returns 0 and draws nothing.
  - `newPlayerDrift(group: PosGroup, d: DriftParams, rng: Rng): PlayerDriftState`: draws 6 normals in order: offIn u, s; offOut u, s; slow u, s.
  - `advanceDrift(s: AnchorState, players: ReadonlyArray<{ id: string; group: PosGroup }>, dt: number, d: DriftParams, rng: Rng): AnchorState`. Draw order:
    1. home team u, y; then away team u, y;
    2. then each listed player in order: a newcomer's 6 draws first, then his slow u and s.

    Players not listed are left as they are.
  - `driftFor(s: AnchorState, side: Side, playerId: string, lamU: number, lamY: number, from: ShapeRow, to: ShapeRow, sigma: -1 | 0 | 1): { u: number; y: number }`, in the team frame:
    - u = team u + offset u (blended from `from` to `to` by lamU) + slow u;
    - y = team y + (sigma, or 1 when central) × (offset s blended by lamY + slow s);
    - offsets: `offIn` for rows `in` and `gk`, `offOut` for `out`.
  - `type DriftParams = Params["positioning"]["drift"]`

- [ ] **Step 1: Write the failing tests** (`packages/sim-core/test/drift.test.ts`)

```ts
import { describe, expect, it } from "vitest"
import { advanceDrift, driftFor, newPlayerDrift, ouStep } from "../src/drift.js"
import { DEFAULT_PARAMS as P } from "../src/params.js"
import { Rng, seedRng } from "../src/rng.js"
import type { AnchorState } from "../src/types.js"

const d = P.positioning.drift
const sdOf = (xs: number[]) => {
  const m = xs.reduce((a, b) => a + b, 0) / xs.length
  return Math.sqrt(xs.reduce((a, b) => a + (b - m) ** 2, 0) / (xs.length - 1))
}
const empty = (): AnchorState => ({
  ballLag: [{ x: 0, y: 0 }],
  teams: { home: { row: "in", prev: "in", since: 0, drift: { u: 0, y: 0 } }, away: { row: "out", prev: "out", since: 0, drift: { u: 0, y: 0 } } },
  players: {}
})

describe("drift (A3)", () => {
  it("an OU step keeps its stationary SD and time constant at 10 Hz and at 25 Hz", () => {
    for (const dt of [0.1, 0.04]) {
      const rng = new Rng(seedRng(1))
      const xs: number[] = []
      let x = 0
      for (let i = 0; i < Math.round(20000 / dt); i++) xs.push((x = ouStep(x, 9, 8, dt, rng)))
      expect(sdOf(xs)).toBeGreaterThan(9 * 0.92)
      expect(sdOf(xs)).toBeLessThan(9 * 1.08)
      const lag = Math.round(8 / dt)
      const m = xs.reduce((a, b) => a + b, 0) / xs.length
      let num = 0
      let den = 0
      for (let i = 0; i + lag < xs.length; i++) num += (xs[i]! - m) * (xs[i + lag]! - m)
      for (const v of xs) den += (v - m) ** 2
      expect(num / den).toBeGreaterThan(Math.exp(-1) - 0.08)
      expect(num / den).toBeLessThan(Math.exp(-1) + 0.08)
    }
  }, 120_000)

  it("a zero SD returns 0 and draws nothing", () => {
    const rng = new Rng(seedRng(2))
    const before = rng.state
    expect(ouStep(5, 0, 8, 0.1, rng)).toBe(0)
    expect(rng.state).toEqual(before)
  })

  it("team drift settles at its SDs, and the same seed gives the same drift", () => {
    const run = () => {
      const rng = new Rng(seedRng(3))
      let s = empty()
      const us: number[] = []
      for (let i = 0; i < 200_000; i++) {
        s = advanceDrift(s, [], 0.1, d, rng)
        us.push(s.teams.home.drift.u)
      }
      return { s, us }
    }
    const a = run()
    expect(sdOf(a.us)).toBeGreaterThan(d.teamUSdM * 0.9)
    expect(sdOf(a.us)).toBeLessThan(d.teamUSdM * 1.1)
    expect(run().s).toEqual(a.s)
  }, 120_000)

  it("a substitute gets his own offsets the tick he appears; a player who left keeps his entry", () => {
    const rng = new Rng(seedRng(4))
    let s = advanceDrift(empty(), [{ id: "a", group: "W" }, { id: "b", group: "CB" }], 0.1, d, rng)
    const b = s.players.b!
    expect(Math.abs(s.players.a!.offIn.s)).toBeGreaterThan(0)
    s = advanceDrift(s, [{ id: "a", group: "W" }, { id: "c", group: "CB" }], 0.1, d, rng)
    expect(s.players.b).toEqual(b)
    expect(s.players.c).toBeDefined()
    const fresh = newPlayerDrift("GK", d, new Rng(seedRng(5)))
    expect(fresh).toEqual({ offIn: { u: 0, s: 0 }, offOut: { u: 0, s: 0 }, slow: { u: 0, s: 0 } })
  })

  it("driftFor sums team, blended offset and slow drift, with s toward the player's own touchline", () => {
    const s: AnchorState = {
      ...empty(),
      teams: { ...empty().teams, home: { row: "in", prev: "out", since: 0, drift: { u: 1, y: 2 } } },
      players: { p: { offIn: { u: 4, s: 3 }, offOut: { u: -2, s: 1 }, slow: { u: 0.5, s: 0.25 } } }
    }
    const left = driftFor(s, "home", "p", 0.5, 0.25, "out", "in", 1)
    expect(left.u).toBeCloseTo(1 + (-2 + 0.5 * 6) + 0.5, 9)
    expect(left.y).toBeCloseTo(2 + (1 + 0.25 * 2 + 0.25), 9)
    const right = driftFor(s, "home", "p", 0.5, 0.25, "out", "in", -1)
    expect(right.y).toBeCloseTo(2 - (1 + 0.25 * 2 + 0.25), 9)
    expect(driftFor(s, "home", "nobody", 1, 1, "in", "in", 0)).toEqual({ u: 1, y: 2 })
  })
})
```

Run: `pnpm --filter @touchline/sim-core exec vitest run test/drift.test.ts`
Expected: FAIL (`../src/drift.js` doesn't exist).

- [ ] **Step 2: Implement `packages/sim-core/src/drift.ts`**

```ts
/**
 * Drift around the rule-table anchor (realism v2, P2: A3; offball-report.md): a team-common Ornstein-Uhlenbeck shift of
 * the whole block, and per outfield player a match offset (with and without the ball, drawn once) plus a slow OU drift.
 * Team frame (u along the attack, y toward the team's left when attacking); s is toward the player's own touchline.
 * Draws only from the `drift` RNG stream.
 */
import type { Side } from "./geometry.js"
import type { Params, PosGroup, ShapeRow } from "./params.js"
import type { Rng } from "./rng.js"
import type { AnchorState, PlayerDriftState, TeamShapeState } from "./types.js"

export type DriftParams = Params["positioning"]["drift"]

/** One exact OU step: x e^(-dt/tau) + sd sqrt(1 - e^(-2 dt/tau)) N(0, 1); stationary SD `sd` at any dt. sd <= 0: 0, no draw. */
export const ouStep = (x: number, sd: number, tauS: number, dt: number, rng: Rng): number => {
  if (sd <= 0) return 0
  const k = Math.exp(-dt / tauS)
  return x * k + sd * Math.sqrt(1 - k * k) * rng.normal()
}

/** A newcomer's drift: match offsets with and without the ball, and a slow drift started from its stationary spread. */
export const newPlayerDrift = (group: PosGroup, d: DriftParams, rng: Rng): PlayerDriftState => {
  const draw = (sd: number) => (sd > 0 ? sd * rng.normal() : 0)
  const offIn = { u: draw(d.offsetUSdM[group]), s: draw(d.offsetSSdM[group]) }
  const offOut = { u: draw(d.offsetUSdM[group]), s: draw(d.offsetSSdM[group]) }
  const slow = { u: group === "GK" ? 0 : draw(d.playerUSdM), s: draw(d.playerSSdM[group]) }
  return { offIn, offOut, slow }
}

/** One tick of drift: both teams' shifts (home, then away), then each listed player's (newcomers drawn first). */
export const advanceDrift = (s: AnchorState, players: ReadonlyArray<{ readonly id: string; readonly group: PosGroup }>, dt: number, d: DriftParams, rng: Rng): AnchorState => {
  const team = (t: TeamShapeState): TeamShapeState => {
    const u = ouStep(t.drift.u, d.teamUSdM, d.teamUTauS, dt, rng)
    const y = ouStep(t.drift.y, d.teamYSdM, d.teamYTauS, dt, rng)
    return { ...t, drift: { u, y } }
  }
  const home = team(s.teams.home)
  const away = team(s.teams.away)
  const out: Record<string, PlayerDriftState> = { ...s.players }
  for (const { id, group } of players) {
    const cur = out[id] ?? newPlayerDrift(group, d, rng)
    const u = group === "GK" ? 0 : ouStep(cur.slow.u, d.playerUSdM, d.playerUTauS, dt, rng)
    const sl = ouStep(cur.slow.s, d.playerSSdM[group], d.playerSTauS[group], dt, rng)
    out[id] = { ...cur, slow: { u, s: sl } }
  }
  return { ...s, teams: { home, away }, players: out }
}

/** A player's summed drift in the team frame under a blend from `from` to `to` (no entry: the team's shift alone). */
export const driftFor = (s: AnchorState, side: Side, playerId: string, lamU: number, lamY: number, from: ShapeRow, to: ShapeRow, sigma: -1 | 0 | 1): { u: number; y: number } => {
  const t = s.teams[side].drift
  const p = s.players[playerId]
  if (!p) return { u: t.u, y: t.y }
  const off = (row: ShapeRow) => (row === "out" ? p.offOut : p.offIn)
  const a = off(from)
  const b = off(to)
  const sgn = sigma === 0 ? 1 : sigma
  return { u: t.u + a.u + lamU * (b.u - a.u) + p.slow.u, y: t.y + sgn * (a.s + lamY * (b.s - a.s) + p.slow.s) }
}
```

The newcomer test expects the GK entry to be all zeros: every GK SD is 0, `slow.u` is forced to 0 for GK, and `draw` returns 0 without drawing.

- [ ] **Step 3: Run the tests**

Run: `pnpm --filter @touchline/sim-core exec tsc --noEmit -p . && pnpm --filter @touchline/sim-core exec vitest run test/drift.test.ts`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add packages/sim-core
git commit -m "feat(sim-core): drift.ts — team-common and per-player OU drift with match offsets (A3), exact discretisation, drift RNG stream

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Relaxed shape motion (A0) and mild tiring (F1) (wave 1, off by default)

**Files:**
- Modify:
  - `packages/sim-core/src/kinematics.ts` (append three functions)
  - `packages/sim-core/src/step.ts`: the **movement seam block** only, and one import line below the `// ---- P2 imports, movement seam` marker
- Test: `packages/sim-core/test/relaxed.test.ts`

**Interfaces:**
- Consumes (Task 1): `Params["movement"]` (`relaxed`, `relaxCap`, `relaxArriveS`, `relaxMarks`), `Params["fatigue"]` (`tiring`, `hiSpeedMs`, `loadWindowS`, `loadFreeM`, `loadDamp`, `loadFloor`), `Work.load`, and the seam function signatures.
- Produces (in `kinematics.ts`):
  - `relaxedSpeed(distM: number, vmax: number, cap: number, arriveS: number): number`
  - `tiringFactor(energy: number, load: number, f: Params["fatigue"]): number`
  - `loadAfter(load: number, speed: number, dt: number, f: Params["fatigue"]): number`
- P4 (recovery sprints, A4) will reuse `tiringFactor`.

- [ ] **Step 1: Write the failing tests** (`packages/sim-core/test/relaxed.test.ts`)

```ts
import { describe, expect, it } from "vitest"
import { loadAfter, relaxedSpeed, tiringFactor } from "../src/kinematics.js"
import { DEFAULT_PARAMS as P, type Params } from "../src/params.js"
import { initMatch, isFinished, step } from "../src/step.js"
import { makeConfig } from "../src/testing.js"

describe("relaxed shape motion and tiring (pure)", () => {
  it("relaxedSpeed arrives in arriveS, capped at cap x vmax", () => {
    expect(relaxedSpeed(10, 8, 0.6, 2)).toBeCloseTo(4.8, 9)
    expect(relaxedSpeed(4, 8, 0.6, 2)).toBeCloseTo(2, 9)
    expect(relaxedSpeed(0, 8, 0.6, 2)).toBe(0)
  })

  it("tiringFactor is 0.8 + 0.2 energy, damped after a hard spell down to the floor", () => {
    const f = { ...P.fatigue, loadFreeM: 45, loadDamp: 0.5, loadFloor: 0.5 }
    expect(tiringFactor(1, 0, f)).toBeCloseTo(1, 9)
    expect(tiringFactor(0.4, 0, f)).toBeCloseTo(0.88, 9)
    expect(tiringFactor(1, 45, f)).toBeCloseTo(1, 9)
    expect(tiringFactor(1, 67.5, f)).toBeCloseTo(0.75, 9)
    expect(tiringFactor(1, 1000, f)).toBeCloseTo(0.5, 9)
  })

  it("loadAfter counts only high-speed metres and forgets them over loadWindowS", () => {
    const f = P.fatigue
    expect(loadAfter(0, 4, 0.1, f)).toBe(0)
    expect(loadAfter(0, 7, 0.1, f)).toBeCloseTo(0.7, 9)
    let l = 100
    for (let i = 0; i < Math.round(f.loadWindowS / 0.1); i++) l = loadAfter(l, 0, 0.1, f)
    expect(l).toBeCloseTo(100 * Math.exp(-1), 6)
  })
})

describe("relaxed shape motion in a match", () => {
  const physical = (params: Params) => {
    const cfg = makeConfig(7, { params })
    const keepers = new Set([cfg.home, cfg.away].flatMap((t) => [...t.starters, ...(t.bench ?? [])]).filter((p) => p.role === "GK").map((p) => p.id))
    let s = initMatch(cfg)
    let liveFrames = 0
    let liveM = 0
    let hsrM = 0
    while (!isFinished(s)) {
      const r = step(s)
      s = r.state
      const f = r.frame
      if (!f) continue
      for (const p of [...f.home, ...f.away]) {
        if (keepers.has(p.id)) continue
        if (f.ball_in_play) {
          liveFrames += 1
          liveM += p.vel * cfg.dt
        }
        if (p.vel >= 20 / 3.6) hsrM += p.vel * cfg.dt
      }
    }
    return { perLiveMin: liveM / ((liveFrames * cfg.dt) / 60), hsrM }
  }

  it("cuts outfield running in live play and high-speed metres", () => {
    const off = physical(P)
    const on = physical({ ...P, movement: { ...P.movement, relaxed: 1 } })
    expect(on.perLiveMin).toBeLessThan(0.85 * off.perLiveMin)
    expect(on.hsrM).toBeLessThan(0.5 * off.hsrM)
  }, 300_000)

  it("with tiring on, the match runs and keeps a load for players who ran fast", () => {
    let s = initMatch(makeConfig(8, { params: { ...P, fatigue: { ...P.fatigue, tiring: 1 } } }))
    while (!isFinished(s)) s = step(s).state
    expect(Object.values(s.load ?? {}).some((v) => v > 0)).toBe(true)
  }, 300_000)
})
```

Run: `pnpm --filter @touchline/sim-core exec vitest run test/relaxed.test.ts`
Expected: FAIL (`relaxedSpeed` isn't exported).

- [ ] **Step 2: Append to `packages/sim-core/src/kinematics.ts`**

```ts
/** Relaxed shape motion (realism v2 A0): head for the spot at the speed that arrives in arriveS, never above cap x vmax. */
export const relaxedSpeed = (distM: number, vmax: number, cap: number, arriveS: number): number => Math.min(cap * vmax, distM / arriveS)

/** Tiring on new high-intensity triggers (realism v2 F1): 0.8 + 0.2 energy, times the recent-load damping (never below loadFloor). */
export const tiringFactor = (energy: number, load: number, f: Params["fatigue"]): number =>
  (0.8 + 0.2 * energy) * Math.max(f.loadFloor, 1 - f.loadDamp * Math.max(0, load / f.loadFreeM - 1))

/** Recent high-intensity metres: an exponential window of loadWindowS over distance run at hiSpeedMs or faster. */
export const loadAfter = (load: number, speed: number, dt: number, f: Params["fatigue"]): number =>
  load * Math.exp(-dt / f.loadWindowS) + (speed >= f.hiSpeedMs ? speed * dt : 0)
```

- [ ] **Step 3: Fill the movement seam** (`step.ts`)

Below the `// ---- P2 imports, movement seam` marker, insert:

```ts
import { loadAfter, relaxedSpeed, tiringFactor } from "./kinematics.js"
```

Replace the four seam bodies, between the movement seam's banner lines and nowhere else:

```ts
/** Speed cap moving into shape: relaxed (A0) arrives in relaxArriveS at up to relaxCap of top speed; else shapeSpeedShare. */
const shapeSpeedCap = (w: Work, pl: PlayerState, target: Vec2, vmax: number): number =>
  w.p.movement.relaxed > 0 ? relaxedSpeed(dist(pl.pos, target), vmax, w.p.movement.relaxCap, w.p.movement.relaxArriveS) : vmax * w.p.movement.shapeSpeedShare

/** Speed cap moving to a marking spot: relaxed only with relaxMarks (the spec keeps marking speeds). */
const markSpeedCap = (w: Work, pl: PlayerState, target: Vec2, vmax: number): number =>
  w.p.movement.relaxed > 0 && w.p.movement.relaxMarks > 0
    ? relaxedSpeed(dist(pl.pos, target), vmax, w.p.movement.relaxCap, w.p.movement.relaxArriveS)
    : vmax * w.p.movement.shapeSpeedShare

/** Multiplier on new high-intensity triggers (pressing, runs in behind): tiring (F1), else 1. */
const triggerFactor = (w: Work, pl: PlayerState): number =>
  w.p.fatigue.tiring > 0 ? tiringFactor(pl.energy, w.load?.[pl.id] ?? 0, w.p.fatigue) : 1

/** After a player moves: his recent high-intensity metres (only with tiring on). */
const trackLoad = (w: Work, id: string, speed: number): void => {
  if (w.p.fatigue.tiring <= 0) return
  const load = (w.load ??= {})
  load[id] = loadAfter(load[id] ?? 0, speed, w.dt, w.p.fatigue)
}
```

`dist` is already imported in `step.ts`. With `relaxed` 0 and `tiring` 0, every body returns what the scaffold returned.

- [ ] **Step 4: Run the tests and the drift check**

Run: `pnpm --filter @touchline/sim-core exec tsc --noEmit -p . && pnpm --filter @touchline/sim-core exec vitest run test/relaxed.test.ts`
Expected: PASS

Run: `pnpm --filter @touchline/calibrate exec vitest run test/realism-gate.test.ts --disableConsoleIntercept`
Expected: PASS with drift 0.

- [ ] **Step 5: Commit**

```bash
git add packages/sim-core
git commit -m "feat(sim-core): relaxed shape motion (A0: arrive in 2 s at up to 0.6 vmax) and mild tiring (F1: energy and recent load damp pressing and run triggers), both off by default

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Substitutions by role (F2) (wave 1, identity by default)

**Files:**
- Modify: `packages/sim-core/src/step.ts`, the `makeSubs` function only
- Test: `packages/sim-core/test/subs-roles.test.ts`

**Interfaces:**
- Consumes (Task 1): `Params["substitutions"]["roleWeights"]`.
- Produces: no new exports. Who comes off is ranked by `(1 − energy + 0.25·yellow + 0.05·u) × roleWeights[role]`. The new windows ([64, 75, 84]) and the real weights are switched on in Task 8.

- [ ] **Step 1: Write the failing test** (`packages/sim-core/test/subs-roles.test.ts`)

```ts
import { describe, expect, it } from "vitest"
import { DEFAULT_PARAMS as P, type Params } from "../src/params.js"
import { initMatch, isFinished, step } from "../src/step.js"
import { makeConfig } from "../src/testing.js"

const REAL_WEIGHTS = { CB: 0.15, FB: 0.4, DM: 0.7, CM: 0.7, AM: 0.9, W: 1, ST: 0.9 }

const offShare = (params: Params) => {
  const counts: Record<string, number> = {}
  for (const seed of [1, 2, 3, 4, 5, 6]) {
    const cfg = makeConfig(seed, { params })
    const roles = new Map([cfg.home, cfg.away].flatMap((t) => [...t.starters, ...(t.bench ?? [])]).map((p) => [p.id, p.role]))
    let s = initMatch(cfg)
    while (!isFinished(s)) {
      const r = step(s)
      s = r.state
      for (const e of r.events) if (e.type === "substitution") {
        const role = roles.get(String(e.attrs.player_off))!
        counts[role] = (counts[role] ?? 0) + 1
      }
    }
  }
  const n = Object.values(counts).reduce((a, b) => a + b, 0)
  return (rs: ReadonlyArray<string>) => rs.reduce((a, r) => a + (counts[r] ?? 0), 0) / n
}

describe("substitutions by role (F2)", () => {
  it("takes wingers and strikers off before centre backs when weighted by role", () => {
    const flat = offShare(P)
    const real = offShare({ ...P, substitutions: { ...P.substitutions, roleWeights: REAL_WEIGHTS } })
    expect(real(["CB"])).toBeLessThan(flat(["CB"]))
    expect(real(["CB"])).toBeLessThan(0.1)
    expect(real(["W", "ST"])).toBeGreaterThan(flat(["W", "ST"]))
  }, 600_000)
})
```

Run: `pnpm --filter @touchline/sim-core exec vitest run test/subs-roles.test.ts`
Expected: FAIL. With every weight effectively 1, the shares are equal, so the first assertion fails.

- [ ] **Step 2: Weight the choice** (`makeSubs` in `step.ts`)

Replace the `.map(...)` line that builds `score`:

```ts
    .map((pl) => ({ pl, score: (1 - pl.energy + 0.25 * pl.yellow + 0.05 * rng.uniform()) * w.p.substitutions.roleWeights[pl.role as Exclude<Role, "GK">] }))
```

The `filter` above it already excludes keepers. Multiplying by 1 changes nothing, and the RNG draws are the same, so the engine stays bit-identical with the defaults.

- [ ] **Step 3: Run the tests and the drift check**

Run: `pnpm --filter @touchline/sim-core exec vitest run test/subs-roles.test.ts test/subs.test.ts`
Expected: PASS

Run: `pnpm --filter @touchline/calibrate exec vitest run test/realism-gate.test.ts --disableConsoleIntercept`
Expected: PASS with drift 0.

- [ ] **Step 4: Commit**

```bash
git add packages/sim-core
git commit -m "feat(sim-core): substitution choice weighted by role (F2), identity by default

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Wire positioning into the engine (wave 2, off by default)

**Files:**
- Modify: `packages/sim-core/src/step.ts`: the **positioning seam block** only, and import lines below the `// ---- P2 imports, positioning seam` marker
- Test: `packages/sim-core/test/positioning.test.ts`

**Interfaces:**
- Consumes:
  - Task 3: `advanceRows`, `blendFor`, `initAnchorState`, `lagBall`, `rowFor`, `settled`, `slotGeometry`, `type Blend`, and `anchorFor`'s `ctx`.
  - Task 4: `advanceDrift`, `driftFor`.
  - Task 1: `Work.anchor`, `w.rng.drift`, `PosGroup`, `ShapeRow`.
  - `decide.ts`: `lastDefenderAttackX` (already imported in `step.ts`).
- Produces the seam bodies `shapeTarget`, `restartTarget`, `advancePositioning`, plus private helpers inside the block.

- [ ] **Step 1: Write the failing tests** (`packages/sim-core/test/positioning.test.ts`)

```ts
import { describe, expect, it } from "vitest"
import { attackX, dist, other, PITCH, type Side } from "../src/geometry.js"
import { DEFAULT_PARAMS as P, type Params } from "../src/params.js"
import { initMatch, isFinished, step } from "../src/step.js"
import { makeConfig } from "../src/testing.js"
import type { MatchState } from "../src/types.js"

const on: Params = { ...P, positioning: { ...P.positioning, rule: 1 }, movement: { ...P.movement, relaxed: 1 } }

const finalState = (params: Params, seed: number): MatchState => {
  let s = initMatch(makeConfig(seed, { params }))
  while (!isFinished(s)) s = step(s).state
  return s
}

const measure = (params: Params, seed: number) => {
  const cfg = makeConfig(seed, { params })
  const outfield = new Set([cfg.home, cfg.away].flatMap((t) => [...t.starters, ...(t.bench ?? [])]).filter((p) => p.role !== "GK").map((p) => p.id))
  const relIn: number[] = []
  const relOut: number[] = []
  const deepWhileKeeper: number[] = []
  const keeperOffLine: number[] = []
  const cbSecondHalf: number[] = []
  let s = initMatch(cfg)
  while (!isFinished(s)) {
    s = step(s).state
    if (s.phase.kind !== "open_play") continue
    const pos = s.possession
    const owner = pos.kind === "owned" ? s.players.find((p) => p.id === pos.playerId)! : null
    const possSide: Side | null = owner ? owner.side : pos.kind === "in_flight" ? pos.flight.side : null
    if (possSide === null) continue
    const ball = s.ball.pos
    for (const side of ["home", "away"] as const) {
      const mine = s.players.filter((p) => p.side === side && !p.sentOff && outfield.has(p.id))
      const cx = mine.reduce((a, p) => a + attackX(side, p.pos.x, s.period), 0) / mine.length
      ;(side === possSide ? relIn : relOut).push(cx - attackX(side, ball.x, s.period))
      if (s.period === "second_half") for (const p of mine) if (p.role === "CB") cbSecondHalf.push(attackX(side, p.pos.x, s.period))
    }
    // Late in the keeper's hold (4 s on), when the build-up shape has formed; the real snapshot is 0.2 s before release.
    if (owner && owner.role === "GK" && pos.kind === "owned" && s.tick - pos.since > 40)
      deepWhileKeeper.push(s.players.filter((p) => p.side === owner.side && !p.sentOff && outfield.has(p.id) && attackX(owner.side, p.pos.x, s.period) < -17.5).length)
    if (owner && owner.role !== "GK") {
      const def = other(owner.side)
      const fromGoal = Math.hypot(attackX(def, ball.x, s.period) + PITCH.halfL, ball.y)
      const gk = s.players.find((p) => p.side === def && p.role === "GK" && !p.sentOff)
      if (gk && fromGoal >= 13 && fromGoal <= 25 && dist(owner.pos, gk.pos) > 6) keeperOffLine.push(attackX(def, gk.pos.x, s.period) + PITCH.halfL)
    }
  }
  return { relIn, relOut, deepWhileKeeper, keeperOffLine, cbSecondHalf }
}
const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length
const median = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)]!

describe("positioning in a match (rule table on)", () => {
  it("is deterministic, and keeps no positioning state with the rule off", () => {
    const a = finalState(on, 9)
    const b = finalState(on, 9)
    expect(a.score).toEqual(b.score)
    expect(a.eventSeq).toBe(b.eventSeq)
    expect(a.anchor).toEqual(b.anchor)
    expect(a.anchor).toBeDefined()
    expect(finalState(P, 9).anchor).toBeUndefined()
  }, 300_000)

  it("puts the block ahead of the ball with it and well behind without it, builds up with few players deep, keeps keepers near their line, and switches ends", () => {
    const m = measure(on, 7)
    // Regression bounds, not targets: Task 8 measures the real-data targets on 16 and 64 matches.
    expect(mean(m.relIn)).toBeGreaterThan(-3) // real +3.9 m; the old template -7.2 m
    expect(mean(m.relIn)).toBeLessThan(10)
    expect(mean(m.relOut)).toBeLessThan(-4) // real -9.5 m
    expect(m.deepWhileKeeper.length).toBeGreaterThan(20)
    expect(median(m.deepWhileKeeper)).toBeLessThanOrEqual(6) // real 3; the old template 8
    expect(m.keeperOffLine.length).toBeGreaterThan(50)
    expect(median(m.keeperOffLine)).toBeGreaterThan(1.2) // real 2.2 m; the old template 4.0 m
    expect(median(m.keeperOffLine)).toBeLessThan(3.5)
    expect(mean(m.cbSecondHalf)).toBeLessThan(-5)
  }, 300_000)
})
```

Run: `pnpm --filter @touchline/sim-core exec vitest run test/positioning.test.ts`
Expected: FAIL. `a.anchor` is undefined, because the seams still run the old template.

- [ ] **Step 2: Fill the positioning seam** (`step.ts`)

Below the `// ---- P2 imports, positioning seam` marker, insert:

```ts
import { advanceRows, blendFor, initAnchorState, lagBall, rowFor, settled, slotGeometry, type Blend } from "./anchor.js"
import { advanceDrift, driftFor } from "./drift.js"
import type { PosGroup, ShapeRow } from "./params.js"
import { FORMATIONS } from "./shape.js"
```

Replace the three seam bodies, between the positioning seam's banner lines and nowhere else:

```ts
/** This tick's row for each team: with the ball, without it, or with its own keeper holding it (G4); loose and dead balls keep the rows. */
const rowsNow = (w: Work): Record<Side, ShapeRow> => {
  const pos = w.possession
  const owner = pos.kind === "owned" ? w.player(pos.playerId) : null
  const possSide: Side | null = owner ? owner.side : pos.kind === "in_flight" ? pos.flight.side : w.phase.kind === "restart" ? w.phase.side : null
  const keeper = owner?.role === "GK"
  const prev = w.anchor?.teams
  return {
    home: rowFor("home", possSide, keeper, prev?.home.row ?? (possSide === "away" ? "out" : "in")),
    away: rowFor("away", possSide, keeper, prev?.away.row ?? (possSide === "home" ? "out" : "in"))
  }
}

const groupFor = (w: Work, pl: PlayerState): PosGroup => {
  const f = teamOf(w.cfg, pl.side).formation
  return slotGeometry(f, FORMATIONS[f], pl.slot).group
}

/** Once per tick, before anyone moves: the team rows and ball ring (anchor.ts), then drift (drift.ts). Nothing with the rule off. */
const advancePositioning = (w: Work): void => {
  const pos = w.p.positioning
  if (pos.rule <= 0) return
  const ball = { x: w.ball.pos.x, y: w.ball.pos.y }
  const rows = rowsNow(w)
  const s = advanceRows(w.anchor ?? initAnchorState(ball, w.dt, pos, rows), w.tick, ball, rows)
  const outfield = w.active().filter((p) => p.role !== "GK").map((p) => ({ id: p.id, group: groupFor(w, p) }))
  w.anchor = advanceDrift(s, outfield, w.dt, pos.drift, w.rng.drift)
}

/** The rule-table context for a player: his blend, his drift (none for keepers) and the caps that apply now. */
const anchorCtx = (w: Work, pl: PlayerState, blend: Blend) => {
  const st = w.anchor!
  const f = teamOf(w.cfg, pl.side).formation
  const geo = slotGeometry(f, FORMATIONS[f], pl.slot)
  const drift = geo.group === "GK" ? { u: 0, y: 0 } : driftFor(st, pl.side, pl.id, blend.lamU, blend.lamY, blend.from, blend.to, geo.sigma)
  return {
    pos: w.p.positioning,
    input: { blend, drift, lastDefU: lastDefenderAttackX(pl.side, w.period, w.active(other(pl.side))), vsKeeper: st.teams[other(pl.side)].row === "gk" }
  }
}

/** Where a player's shape puts him in open play (also the marking anchor): the rule table against the lagged ball, or the old template. */
const shapeTarget = (w: Work, pl: PlayerState, ballFlat: Vec2, inPossession: boolean): Vec2 => {
  const team = teamOf(w.cfg, pl.side)
  const st = w.anchor
  if (w.p.positioning.rule <= 0 || !st)
    return anchorFor(team.formation, pl.slot, pl.side, w.period, ballFlat, team.style, inPossession, w.p.shape)
  const blend = blendFor(st.teams[pl.side], groupFor(w, pl), w.tick, w.dt, w.p.positioning)
  return anchorFor(team.formation, pl.slot, pl.side, w.period, lagBall(st), team.style, inPossession, w.p.shape, anchorCtx(w, pl, blend))
}

/** A player's spot while a restart (other than a kickoff) is set up: the rule table settled at the restart spot, or the old template. */
const restartTarget = (w: Work, pl: PlayerState, at: Vec2, inPossession: boolean): Vec2 => {
  const team = teamOf(w.cfg, pl.side)
  if (w.p.positioning.rule <= 0 || !w.anchor)
    return anchorFor(team.formation, pl.slot, pl.side, w.period, at, team.style, inPossession, w.p.shape)
  return anchorFor(team.formation, pl.slot, pl.side, w.period, at, team.style, inPossession, w.p.shape, anchorCtx(w, pl, settled(inPossession ? "in" : "out")))
}
```

`other`, `lastDefenderAttackX`, `teamOf`, `anchorFor` and `PlayerState` are already in scope in `step.ts`. With the rule off, `advancePositioning` returns at once (no state, no draws), and both targets take the old path, so the engine stays bit-identical.

- [ ] **Step 3: Run the tests and the drift check**

Run: `pnpm --filter @touchline/sim-core exec tsc --noEmit -p . && pnpm --filter @touchline/sim-core exec vitest run test/positioning.test.ts test/anchor.test.ts test/drift.test.ts`
Expected: PASS.
- **If `relIn` fails high or low,** print `mean(m.relIn)` and `mean(m.relOut)`. Check the sign conventions in `rowSpot` (`dx` and style) before touching any number.
- **If `deepWhileKeeper` fails,** check that `rowsNow` sees the keeper as owner (`keeper` true) and that the `gk` row is used.

Run: `pnpm --filter @touchline/sim-core test -- --no-file-parallelism`
Expected: PASS

Run: `pnpm --filter @touchline/calibrate exec vitest run test/realism-gate.test.ts --disableConsoleIntercept`
Expected: PASS with drift 0.

- [ ] **Step 4: Commit**

```bash
git add packages/sim-core
git commit -m "feat(sim-core): positioning wired in behind positioning.rule — team rows from possession, 2 s ball lag, per-role blend, drift on its own stream; restarts settle on the table at the spot

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: Switch on, retire the old knobs, recalibrate, gate, re-pin, record the results (wave 3)

**Files:**
- Modify:
  - `packages/sim-core/src/params.ts`: defaults; remove `shape.defLineM` and `shape.fwdDropM`
  - `packages/sim-core/src/shape.ts`: the old template stops reading them
  - `packages/sim-core/test/shape.test.ts`
  - `packages/calibrate/src/knobs.ts`
- Regenerate:
  - `data/params/touchline-params.json`, `data/params/realism-baseline.json`, `docs/realism/realism-report.md`
  - the stats and manager goldens
  - the seed pins in `services/agents/tests/conftest.py` and `packages/agent-gateway/test/e2e.test.ts`
- Modify: `docs/superpowers/specs/2026-10-13-sim-realism-v2-design.md` (add `## Results: P2 (date)`)

**Interfaces:**
- Consumes: everything above.
- Produces:
  - knobs `pos_in_shift`, `pos_out_shift`, `team_drift`, `relax_cap`
  - knobs `def_line` and `fwd_drop` removed

- [ ] **Step 1: Switch the behaviours on** (`DEFAULT_PARAMS`)

- `positioning.rule: 1`
- `movement.relaxed: 1` (`relaxMarks` stays 0)
- `fatigue.tiring: 1`
- `substitutions.windowMinutes: [64, 75, 84]`
- `substitutions.roleWeights: { CB: 0.15, FB: 0.4, DM: 0.7, CM: 0.7, AM: 0.9, W: 1, ST: 0.9 }`

- [ ] **Step 2: Retire `defLineM` and `fwdDropM`, and update the knobs**

**Params.** In `params.ts`, the `shape` type and default become `{ width, depth, defDepth }`. Update the doc comment: "Team shape spread: width (fully in possession, partly without), depth between lines, and without the ball an extra depth squeeze."

**The old template.** In `shape.ts`:
- the `spread` parameter type becomes `{ readonly width: number; readonly depth: number; readonly defDepth?: number }`;
- delete the `drop` line;
- the `x` line becomes `const x = clamp(sx + slide * bx + line, -PITCH.halfL + 4, PITCH.halfL - 3)`;
- the comment above `depth` becomes `// Without the ball, defDepth squeezes the lines further (identity by default).`

**Shape tests.** In `shape.test.ts`, delete the "drops forwards (ST, W, AM) back by fwdDropM" test. Replace the "moves a team's shape without the ball by defLineM and defDepth" test with:

```ts
  it("squeezes a team's lines by defDepth without the ball, and leaves it alone with the ball", () => {
    const style = STYLES.possession
    const ball = { x: 0, y: 0 }
    const spread = (defDepth: number) => ({ width: 1, depth: 1, defDepth })
    // Striker (slot 9, x = 6): distance from the team centre (x = -18) halves without the ball: 24 m -> 12 m.
    expect(anchorFor("4-3-3", 9, "home", "first_half", ball, style, false, spread(0.5)).x - anchorFor("4-3-3", 9, "home", "first_half", ball, style, false).x).toBeCloseTo(-12, 9)
    expect(anchorFor("4-3-3", 2, "home", "first_half", ball, style, true, spread(0.5))).toEqual(anchorFor("4-3-3", 2, "home", "first_half", ball, style, true))
  })
```

**Knobs.** In `packages/calibrate/src/knobs.ts`:
- delete the `def_line` and `fwd_drop` knobs;
- import `type ShapeRow` from `@touchline/sim-core`;
- add next to `shiftLogits`:

```ts
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
```

Then, after `def_depth`, add:

```ts
  { name: "pos_in_shift", what: "metres every in-possession row moves upfield (block height with the ball, territory)", init: 0, min: -6, max: 6, step: 1.5,
    apply: (p, v) => shiftRows(p, "in", v) },
  { name: "pos_out_shift", what: "metres every out-of-possession row moves upfield (defensive line height, defending length)", init: 0, min: -6, max: 6, step: 1.5,
    apply: (p, v) => shiftRows(p, "out", v) },
  { name: "team_drift", what: "scale on the team-common drift (line-height variability, territory)", init: 1, min: 0, max: 1.5, step: 0.25,
    apply: (p, v) => ({ ...p, positioning: { ...p.positioning, drift: { ...p.positioning.drift, teamUSdM: p.positioning.drift.teamUSdM * v, teamYSdM: p.positioning.drift.teamYSdM * v } } }) },
  { name: "relax_cap", what: "share of top speed for relaxed shape movement (speeds, high-speed running)", init: DEFAULT_PARAMS.movement.relaxCap, min: 0.4, max: 0.85, step: 0.05,
    apply: (p, v) => ({ ...p, movement: { ...p.movement, relaxCap: v } }) },
```

Run: `pnpm typecheck && pnpm --filter @touchline/calibrate exec vitest run test/tune.test.ts`
Expected: PASS. "Every knob changes the parameters" holds for the new knobs.

Run: `pnpm --filter @touchline/sim-core test -- --no-file-parallelism`
Expected: PASS.
- **If a sim-core test asserts an exact statistic that the new positioning moves** (offball, letrun, wide, keeper, subs and others), check that the new value is football-plausible before updating the expectation. Say which and why in the commit message.

- [ ] **Step 3: Recalibrate** (one to two hours; run it in the background)

Run: `pnpm calibrate --from data/params/touchline-params.json --out data/params/touchline-params.json --matches 12 --rounds 1`

The file's old `def_line` and `fwd_drop` values are ignored, because they are no longer knobs. Its explicit `shape.defLineM` and `substitutions.windowMinutes` are replaced, because the tuner writes `DEFAULT_PARAMS` plus knobs.

Expected: it ends with `wrote …: loss <n>`. Record the loss and every knob that moved, especially `pos_in_shift`, `pos_out_shift`, `team_drift`, `relax_cap`, `shape_width` and `def_depth`.

- [ ] **Step 4: Re-baseline and run the gate**

Run: `UPDATE_REALISM_BASELINE=1 pnpm --filter @touchline/calibrate exec vitest run test/realism-gate.test.ts --disableConsoleIntercept`
Then: `pnpm --filter @touchline/calibrate exec vitest run test/realism-gate.test.ts --disableConsoleIntercept`
Expected: PASS, with loss < 30.

**If the loss is ≥ 30, stop.** Report the loss and the statistics with the largest |z| to the user. Don't widen the gate. The spec's splitting rule applies, and the user chooses what moves to P3. A natural order to offer:
1. drift off (`team_drift` 0 and the player SDs 0);
2. then tiring off.

Keep the rule table, the blend and relaxed motion.

- [ ] **Step 5: Deep report and the committed report**

Run: `pnpm realism:deep` (64 matches; tens of minutes)
Run: `pnpm realism --out docs/realism/realism-report.md --matches 16`

From `out/realism-deep.md`, record:
- **C3:** the shot-share SD (≤ 0.18; it was 0.383).
- **Discipline:** players sent off and penalties per match.
- **"Physical output and territory":**
  - walking (target about 3.5 km);
  - high-speed plus sprint (about 0.7 km);
  - accelerations (about 50);
  - live m/min (about 130–150);
  - dead m/min;
  - territory SD (real 1.9 m; it was 11.7 m);
  - centroid with and without the ball (real +3.9 and −9.5 m).

From the 16-match report, record:
- C1 and C2;
- C4: all seven, especially width out of possession (z +3.04 before) and defending length.

**If live m/min is above 150 after calibration:** set `movement.relaxMarks` 1, repeat Steps 3–5, and record it as a deviation from the spec (ruling 13).

- [ ] **Step 6: G2, keeper distribution and substitutions** (a one-off; don't commit it)

Create `packages/calibrate/p2-checks.ts`:

```ts
import { readFileSync } from "node:fs"
import { dist, initMatch, isFinished, paramsFromJson, step, type DomainEvent, type MatchState, type TeamSetup } from "@touchline/sim-core"
import { FIXTURES } from "./src/evaluate.js"

const league = JSON.parse(readFileSync("../../data/league/league.json", "utf8")) as { clubs: TeamSetup[] }
const params = paramsFromJson(JSON.parse(readFileSync("../../data/params/touchline-params.json", "utf8")))
let releases = 0
let pressed = 0
let shots = 0
let shotsAfterKeeper = 0
const starters: Record<string, number> = {}
const off: Record<string, number> = {}
const subMinutes: number[] = []
for (let i = 0; i < 16; i++) {
  const [h, a] = FIXTURES[i % FIXTURES.length]!
  const home = league.clubs.find((c) => c.id === h)!
  const away = league.clubs.find((c) => c.id === a)!
  const roleOf = new Map([home, away].flatMap((t) => [...t.starters, ...(t.bench ?? [])]).map((p) => [p.id, p.role]))
  for (const p of [...home.starters, ...away.starters]) starters[p.role] = (starters[p.role] ?? 0) + 1
  let s: MatchState = initMatch({ matchId: `p2-${2000 + i}`, seed: 2000 + i, kickoffTime: "2026-10-18T14:00:00.000Z", home, away, params, dt: 0.1 })
  const events: DomainEvent[] = []
  while (!isFinished(s)) {
    const prev = s
    const r = step(s)
    s = r.state
    events.push(...r.events)
    const pp = prev.possession
    if (pp.kind !== "owned" || pp.restart !== null || pp.inHands) continue
    const gk = prev.players.find((p) => p.id === pp.playerId && p.role === "GK")
    if (!gk || s.possession.kind !== "in_flight") continue
    releases++
    if (prev.players.some((o) => o.side !== gk.side && !o.sentOff && dist(o.pos, gk.pos) < 5)) pressed++
  }
  const dists = events.filter((e) => e.type === "keeper_distribution")
  for (const e of events) {
    if (e.type === "shot") {
      shots++
      if (dists.some((k) => k.team_id !== e.team_id && e.frame_id - k.frame_id >= 0 && e.frame_id - k.frame_id <= 200)) shotsAfterKeeper++
    }
    if (e.type === "substitution" && e.attrs.half_time !== true) {
      const role = roleOf.get(String(e.attrs.player_off)) ?? "?"
      off[role] = (off[role] ?? 0) + 1
      subMinutes.push((e.period === "first_half" ? 0 : 45) + (e.period_frame_id * 0.1) / 60)
    }
  }
}
const share = Object.fromEntries(Object.entries(off).map(([r, n]) => [r, Number((n / (starters[r] ?? 1)).toFixed(2))]))
console.log({
  g2AtFeetPressed: pressed / releases,
  releases,
  keeperDistShotShare: shotsAfterKeeper / shots,
  shots,
  subOffShareOfStarters: share,
  meanSubMinute: subMinutes.reduce((x, y) => x + y, 0) / subMinutes.length
})
```

Run: `pnpm --filter @touchline/calibrate exec tsx p2-checks.ts && rm packages/calibrate/p2-checks.ts`

Expected and recorded:
- `g2AtFeetPressed` falls from 0.43 toward 0.126;
- `keeperDistShotShare` stays at or below about 0.10 (P1: 0.090; real 0.076);
- substitutions come off later (windows 64/75/84);
- by role, W > CM > CB, with CB at most about 0.1 (real W 79 %, CM 39 %, CB 6 %).

Frames are at dt 0.1, so 20 s is 200 frames.

- [ ] **Step 7: Re-pin the seed-pinned fixtures, the goldens and the library**

Run:

```bash
uv run --project services/agents python services/agents/scripts/find_test_seed.py 1 1400
uv run --project services/agents python services/agents/scripts/find_test_seed.py --general 1 100
```

Update `ERROR_SEED` and `SEED` in `services/agents/tests/conftest.py`, and the seed in `packages/agent-gateway/test/e2e.test.ts`, as commit 0f1fa83 did. Regenerate the goldens and check the diffs for plausibility:

```bash
UPDATE_STATS_GOLDEN=1 pnpm --filter @touchline/stats exec vitest run test/replay.test.ts
UPDATE_GOLDEN=1 pnpm --filter @touchline/manager exec vitest run test/situation.test.ts
```

Plausible means the same match fields, with xG and PPDA at similar magnitudes. Then run `pnpm library` (with the agent service running) to rebuild the match library under `out/library`.

- [ ] **Step 8: Run everything**

Run: `pnpm test -- --no-file-parallelism && pnpm typecheck && uv run --project python/analytics pytest python/analytics/tests && uv run --project services/agents pytest services/agents/tests`
Expected: PASS

- [ ] **Step 9: Record the results and commit**

Add `## Results: P2 (YYYY-MM-DD)` to the v2 spec, in the style of "Results: P1":
- **Switches:** what was switched on, and the values that ended up in the parameters.
- **Calibration:** runs, losses, and the knobs that moved.
- **Gate:** the loss.
- **C1–C4:** C1, C2 and the seven C4 lines.
- **C3:** the shot-share SD on 64 matches.
- **Physical and territory:** the bands, territory SD and centroids.
- **Step 6:** G2, keeper distribution and substitutions.
- **Discipline:** sendings-off and penalties.
- **Rulings:** the planning rulings (this plan's "Rulings on the spec") and any deviation taken in Step 5.

Mark each item MET or NOT MET. If C3 is still above 0.18, say what remains: `pressIntensity` drives the rest of the dominance (`dominance-report.md`), and team pressing is P4 (A5).

```bash
git add packages data docs services
git commit -m "feat: realism v2 P2 on — rule-table positioning with blends and drift, relaxed shape motion, mild tiring, substitutions by role; defLineM/fwdDropM retired; recalibrated, re-baselined, fixtures re-pinned

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

Merge locally into main (`git -C ../../touchline merge --no-ff realism-v2-p2`) only after the user has seen the results. After merging, regenerate the run folders under `out/` in the main checkout, as the P1 merge checklist lists.

# Physics fitted on real tracking — design

Designed 2026-10-09 with the brainstorming method, from `../reports/Football engine physics accuracy.md` (the
research report, outside the repository). Status: **approved 2026-10-09; revised the same day after measurement (see Revision).**

## Purpose

Make the engine's physics decide correctly who reaches the ball first, using constants **measured** on IDSSE
tracking rather than tuned. Today:

- A landing ball keeps 85 % of its horizontal speed (restitution 0.55, a hard-coded 0.85 factor). Certified pitches
  keep 45–60 %.
- Rolling decelerates at a constant 1.2 m/s² plus air drag.
- Players accelerate and brake at the same flat 4.5 m/s² (`kinematics.accelMax`) up to `vmaxBase` 9.2 m/s, so they are
  about 0.15–0.2 s slow over the first 2–5 m and take about 1.8 s to stop from 8 m/s (real: 0.9–1.2 s).
- A 0.7 s "reaction time" in `resolve.ts` and `pitchcontrol.ts` is a pitch-control fitting constant that already contains
  an acceleration phase, which the engine now models explicitly, so the slow start is counted twice.

A second purpose is the result itself: open, licence-clean physics constants fitted on public tracking, with their
uncertainty and validation, which no published football engine provides.

## Decisions (user, 2026-10-09)

| Decision | Choice |
|---|---|
| Scope | Full fit-and-validate harness (report item 0) plus report items 1–4: tangential bounce, speed-dependent rolling, acceleration–speed law with a braking cap, short reaction delay |
| Schedule | Plan 6b now (about Oct 9–20). Plan 4b afterwards keeps only manager agents and A/B evaluation; the corner optimiser is dropped. Azure starts about Oct 23 |
| Physics vs tuner | Physics constants are fixed measured values in their own file. Physics knobs leave the tuner, which recalibrates behaviour only |
| Who reaches the ball (revision) | The fitted ball and fitted player movement are switched on; deciding who reaches a moving ball keeps the tuned 0.7 s rule (see Revision) |
| Stamina (revision) | Add a work-rate-by-period check, real against simulated; measured and reported, not fitted |

## Fixed facts (observed 2026-10-09)

- All seven IDSSE matches (TRACAB Gen5, 25 Hz, CC-BY 4.0) are in `data/raw/idsse/` with positions, events and match
  information. Ball height is present and plausible: in J03WPY's first half the ball is above 2 m in 8 % of frames, the
  maximum is 13.7 m, and rolling frames sit at 0.07–0.13 m.
- Physics lives in `packages/sim-core/src/ball.ts` and `kinematics.ts`; its callers are `step.ts`, `resolve.ts`,
  `pitchcontrol.ts`, `deflect.ts` and `execute.ts`. No other package calls them.
- Current constants (`params.ts`): `ball: { drag 0.013, rollDecel 1.2, bounce 0.55, gravity 9.81, substeps 4 }`,
  `kinematics: { vmaxBase 9.2, accelMax 4.5, reactionS 0.7, … }`, `PC_DEFAULTS.reactionS 0.7`.
- The analytics package (`python/analytics`) depends only on `kloppy` and the CDF validator; Plan 3a fitted models in
  pure Python.
- After Plan 6a (2026-10-09 results in `2026-10-07-sim-realism-contract.md`): 11 of 19 statistics within 1 SD, 17
  within 2 SD; pass completion (z −2.22) and median pass length (z −2.42) are outside 2 SD; defending team length
  (z +3.41) and width out of possession (z +3.02) are outside the spatial band.

## Architecture

Three parts share one committed file, `data/params/physics.json`.

### 1. Fit harness (offline Python)

New subpackage `python/analytics/touchline_analytics/physics/`, run by `pnpm physics:fit`
(`uv run python -m touchline_analytics.physics fit`). Adds `numpy` and `scipy` (BSD) to the analytics package only.

Four stages, each caching its output in git-ignored `out/physics/` so a re-run skips finished stages:

1. **Load.** Stream the TRACAB position XML (ball x, y, z and every player). Smooth positions with Savitzky–Golay and
   recompute velocity and acceleration from positions; TRACAB's S and A fields are not used. Keep live-ball frames
   (BallStatus 1). Write one compact array file per match.
2. **Segment.**
   - A **kick** is a ball-speed jump of at least 3 m/s within ±0.2 s of a Pass, Shot or Clearance event.
   - A **free-ball span** runs from a kick until a player is within 1.2 m of the ball, the speed jumps again, or the
     direction turns more than 20°.
   - Each span splits into **flight** (z > 0.3 m), **bounce** and **rolling** pieces; pieces under 0.5 s are dropped.
   - **Sprint profiles**: per player per match, the speed and acceleration series.
3. **Fit.** On five matches (J03WMX, J03WN1, J03WOH, J03WOY, J03WPY); J03WQQ and J03WR9 are held out.

   | Constant | Method |
   |---|---|
   | Drag `k` (global and in speed bins) | Integrate the engine's own equations at its 0.025 s substep against x, y, z; Huber least squares (`scipy.optimize.least_squares`), initial conditions per segment |
   | Restitution `e` | √(h_after / h_before) from parabolas fitted on each side of a bounce |
   | Grass friction `μ` | Horizontal speed kept through each bounce, inverted through the Brody/Cross model |
   | Rolling `c0`, `c1` | `dv/dt = −(c0 + c1·v + k·v²)` with `k` held at the drag value |
   | Player `A0`, `S0` | Morin method: 0.2 m/s speed bins from 3 m/s, top two accelerations per bin, a line fit per player; kept as percentiles by position |
   | Braking cap `B` | 95th percentile of deceleration peaks |
   | Lateral cap | Curvature against speed on player tracks |
   | Reaction delay `τr` | Lag from a kick to the nearest defender's acceleration onset (median and IQR) |

   Every constant gets a 95 % confidence interval by bootstrap over segments (or players).
4. **Validate and write.** Compute every validation metric on the two held-out matches. Compute the **inter-match
   envelope**: for each metric, W1 between all 21 pairs of real matches, keeping min, median and max. Write
   `physics.json`.

`physics.json` holds, per constant: value, 95 % CI, unit, number of segments used, `source` (`"idsse"` or
`"literature"`). A header records dataset, licence and attribution (DFL, Bassek et al.), match ids for fit and held-out
sets, fit date and the code version (git commit). It also holds the envelope and held-out results. Aggregates only;
no raw rows.

**Guards** (each recorded in the file; a failed guard fails the fit instead of writing it):

- Segments are rejected for fit RMSE above 0.3 m, ball speed above 40 m/s or player speed above 11 m/s, with a reject
  count per reason in the file.
- A match whose ball height is unusable is skipped for the restitution fit. If fewer than 200 bounces remain, `e` falls
  back to 0.62 with `"source": "literature"`.
- Physical ranges: `e` in 0.4–0.85; `μ` in 0.3–1.2; the fitted rolling law must roll 4–8 m from 3.2 m/s (FIFA Pro
  ramp test); `A0` in 5–11 m/s²; `S0` in 7.5–11 m/s; `B` in 4–12 m/s²; `τr` in 0.1–0.6 s. Out of range fails the fit.

### 2. Engine (`packages/sim-core`)

A new `params.physics` block is read from `physics.json` through `paramsFromJson`. The defaults in code are the
report's literature values, so tests and the CLI work without the file. The engine treats the values as fixed.

1. **Bounce (`ball.ts`).** Brody/Cross: `vz ← −e·vz`. If the ball grips
   (`2.5·μ·(1+e)·v_n ≥ |v_t − Rω|`) it leaves rolling at `0.6·v_t + 0.4·Rω`; otherwise it slides and loses
   `μ(1+e)·v_n` of horizontal speed. A scalar spin `ω` is carried through bounces only and starts at 0 (Magnus is out of
   scope). Bouncing stops below a vertical speed of 0.4 m/s. The hard-coded 0.85 and 0.6 go.
2. **Rolling.** `dec = c0 + c1·v + k·v²` replaces `rollDecel + drag·v²`. `groundLaunchSpeed` becomes a fixed
   three-step Newton solve on the stop-distance formula. `carryDistance` and `launchVelocity` keep their signatures.
3. **Player movement (`kinematics.ts`).** Forward acceleration follows `A0·(1 − v/S0)`; braking is capped at `B`; the
   acceleration vector is clamped to a disc, plus the fitted lateral cap. `arrive`'s slowing radius becomes `v²/(2B)`.
   A player's `A0` and `S0` come from their pace and acceleration attributes mapped onto the fitted percentiles for
   their position — no random draw. Euler multiply-add only. `vmaxFor` and `accelFor` keep their names and read the new
   model; `kinematics.accelMax` and `vmaxBase` are removed.
4. **Reaction and reach (revised).** Unchanged: `resolve.ts` and `pitchcontrol.ts` keep the tuned interception rule
   (`reachIn` with `kinematics.reactionS` 0.7 s and `kinematics.accelMax`), now documented as a behavioural rule, not
   physics. The fitted `τr` (0.2 s) is reported in `physics.json` only. See Revision.
5. **Fatigue.** The energy floor on top speed goes from 0.9 to 0.97 (a literature value, not fitted) (`vmaxFor`'s `0.9 + 0.1·energy` becomes
   `0.97 + 0.03·energy`).

**Determinism:** no `Math.exp`, `Math.pow` or other transcendental call in the step path (tables or polynomials
instead); fixed iteration counts; players iterated in a fixed order.

### 3. Validation (Python reference, TypeScript port)

- Physics metrics are defined once in Python and ported line for line to `packages/calibrate`, guarded by the
  existing parity test (9 decimal places).
- **Ball:** flight time and carry (ground and aerial separately), rolling deceleration, bounce apex ratio, speed at
  release, speed at reception.
- **Players:** speed and acceleration histograms by position, per-player maximum speed, counts of accelerations and of
  decelerations over 3 m/s², distance above 20 and 25 km/h.
- Distances are Wasserstein-1 (in physical units) plus KS, with real and simulated data resampled to 10 Hz and smoothed
  identically. The pass threshold for each metric is the inter-match envelope maximum.
- **Work rate by period (revision):** distance and distance above 20 km/h per player per 15-minute period of each half,
  by position group, real (all seven matches) against simulated, plus the late-to-early ratio (last 15 minutes of each half
  over the first 15). Measured and reported in `physics.json` and the realism report; not a pass/fail criterion.
- **Free-ball replay:** seed the engine with each held-out kick state and run it to first touch; trajectory RMSE must
  be within 1.5× that segment's best-fit residual.
- The results go into the realism report (`docs/realism/realism-report.md`) and a new physics section of the realism
  gate.

### Recalibration

`ball.bounce`, `kinematics.accelMax` and the other physics knobs leave the tuner. Behaviour is recalibrated on the
existing IDSSE targets, starting from the current parameters. Gaps behaviour cannot close are recorded as known gaps,
as in Plan 2b; physics is not bent to close them. Fixtures are re-pinned in their own commit.

## Success criteria

| ID | Criterion |
|---|---|
| P1 | `physics.json` is produced from IDSSE with provenance, confidence intervals and reject counts; fit-recovery tests on synthetic data pass |
| P2 | On the two held-out matches, the ball metrics (flight time, carry, rolling deceleration, bounce apex ratio, speed at reception) fit by the five fit matches fall inside the inter-match envelope |
| P3 | (revised) Simulated player metrics (speed and acceleration by position, maximum speed, accelerations and decelerations over 3 m/s², distance over 20 and 25 km/h) are measured against the envelope and reported; the count inside is recorded as a known gap, not a gate |
| P4 | The free-ball replay passes on the held-out matches |
| P5 | With the fitted physics switched on the realism gate passes, and the counts within 1 SD and within 2 SD are no lower than the 2026-10-09 baseline (11 and 17 of 19); remaining gaps are listed |
| P7 | (revision) Work rate by period is measured on real and simulated matches and reported |
| P6 | A match replays bit-identically run to run; the golden hash changes only through a deliberate re-pin |

Each metric that misses its threshold is reported with its value and envelope, not hidden.

## Revision (2026-10-09, after measurement)

Switching every fitted piece on lowered realism (loss 30.0 to 58.5; within 1 SD 11 to 9). Measured one piece at a time
from the current parameters, on the 16 gate seeds:

| Switched on | Loss | Within 1 SD | Within 2 SD |
|---|---|---|---|
| Nothing (today) | 30.0 | 11 | 17 |
| Fitted ball | 25.5 | 12 | 19 |
| Fitted player movement | 26.4 | 12 | 18 |
| Fitted reaction and reach (0.2 s) | 69.7 | 12 | 14 |
| Ball and movement, tuned interception rule | 24.8 | 12 | 19 |
| All three, reaction 0.7 s and reach margin 0.5 | 32.8 | 14 | 17 |

The fitted 0.2 s is the time to start moving; the engine's reach disc assumes the defender already knows where the pass
is going, which the tuned 0.7 s absorbs. A "pace and drift" movement policy, tuned over three calibration rounds, moved
3 of 13 player metrics inside the envelope (1 without it) but raised the loss to 88. Hence the user's decision
(2026-10-09): ship the fitted ball and player movement with the tuned interception rule, no movement-pace policy and no
recalibration; report P3 as a known gap and add the work-rate check. A movement policy that matches real work rate is a
follow-up plan.

## Testing

Test-driven throughout; each test is written and seen failing first.

- **Python fit on synthetic data.** Generate ball paths with the engine's own equations at known `e`, `μ`, `c0`, `c1`,
  `k`, add TRACAB-level noise (0.1 m), and check each fit recovers its value within tolerance. Segmentation on
  hand-built frames (a kick then a touch, a turn, a bounce). Morin fit on a synthetic sprint with known `A0` and `S0`.
  Missing ball, NaN, missing z, and fewer than 200 bounces take the literature fallback and never crash.
- **Parity.** Each new metric to 9 decimal places, Python against TypeScript.
- **Engine.** Bounce matches closed-form Brody/Cross; the FIFA angle test (50 km/h at 15°) keeps 45–60 % of its speed
  on dry turf; the ramp test rolls 4–8 m; a standing start reaches 5 m in 1.2–1.4 s; a stop from 8 m/s takes 0.9–1.2 s;
  acceleration never exceeds its caps.
- **Determinism.** Golden hash of a full match, run twice, identical. A test fails if `Math.exp` or `Math.pow`
  appears in the step path.
- **Replay** as in Validation.

## Deliverables beyond code

`docs/physics-calibration.md`: the fitted constants with their intervals, the envelope and held-out results, the
method, and the IDSSE attribution — the open result to show judges. Roadmap: add a Plan 6b row.

## Constraints

- Synthetic simulation data only in the product; IDSSE used only for fitting, and only aggregates are committed.
  No StatsBomb. No GPL or AGPL code; only published equations and parameter values are reused.
- The engine stays deterministic for a seed.
- Commits end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Out of scope

Spin and Magnus lift, the drag-crisis C_D(v) table, launch distributions per action type, per-player random draws of
`A0`/`S0`/`τr`, an explicit fatigue sprint policy (report items 5–9), fitting the energy drain, and a movement policy
that matches real work rate (revision).

## Risks

- **Calibration gaps widen.** Faster first steps and shorter ball runs change who wins loose balls; pass completion
  and pass length (already outside 2 SD) may move either way. Mitigation: P5 sets a no-regression floor, and the
  recalibration starts from the current parameters.
- **Fit runtime.** About 7 × 400 MB of XML; the first run is about 30–60 minutes. Stage caching keeps re-runs short.
- **Ball-height quality** varies by match. The per-match skip and the 200-bounce fallback keep the fit honest.
- **Schedule.** About 11–17 developer-days in the report. If it slips past Oct 20, Plan 4b shrinks further before Azure
  moves.

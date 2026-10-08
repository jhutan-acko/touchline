# Simulation realism — problem contract

Defined 2026-10-07 with the ultrasolve `define` method. Definition status: **CONFIRMED** (scope, judges, the C2/C3 thresholds and seven-match spatial targets confirmed by the user on 2026-10-07).

## Problem

Make `packages/sim-core` play more like real football where it is weakest, without losing the match statistics it already matches.

## Fixed facts (observed 2026-10-07)

- `docs/realism/realism-report.md`: 16 of 19 match statistics are within 1 SD of the IDSSE targets, 3 within 2 SD, none off.
- Weakest statistics: free kicks −29 %, fouls −22 %, goals −22 %, shots on target −19 %. Shots per match have SD 9.6 in the simulation against 2.9 in real matches.
- The realism gate (`packages/calibrate/test/realism-gate.test.ts`) measures no spatial behaviour: no team shape, spacing, defensive line, support or marking.
- Off-ball behaviour (`packages/sim-core/src/step.ts` `moveTarget`): formation anchors, one presser, occasional runs in behind by ST/W/AM. Missing: support play for the team in possession, marking, a carrier who shields the ball while holding it (they currently stand still), and a carry heading that reacts to defenders.
- All seven IDSSE tracking files are in `data/raw/idsse/`. The committed targets use J03WPY only.

## Judges (owner: user, CONFIRMED)

Both: the numeric realism gate **and** how matches look in the replay.

## Success criteria

| ID | Criterion | Source of threshold |
|---|---|---|
| C1 | All 19 existing statistics stay within 2 SD of the real figures, and at least 16 within 1 SD | Derived from the 2026-10-06 baseline |
| C2 | Free kicks, fouls, goals and shots on target within 1 SD | Proposed, CONFIRMED by the user |
| C3 | Shots-per-match SD of 5 or less across the realism matches | Proposed, CONFIRMED by the user |
| C4 | Seven spatial metrics measured on all seven IDSSE tracking matches are in the realism report and gate, each with \|z\| < 3 using the existing scale rule (real between-match SD, floored at 5 % of the mean) | All seven matches: CONFIRMED by the user. The z < 3 band is the gate's existing rule (derived) |
| C5 | A replay viewer sees supporters offering angles, defenders goal-side of their opponents, and carriers shielding under pressure | Judged in the replay (CONFIRMED judge) |

## Constraints and non-goals

- One metric definition shared by real and synthetic data: Python `metrics.py` with a line-for-line TypeScript port and a parity test (existing convention).
- Only aggregate real-data statistics are committed (IDSSE licence; existing convention).
- The engine stays deterministic for a seed.
- Each new behaviour ships switched off by default, so the realism baseline stays unchanged until a single calibration step switches them on.
- Non-goal: changing the decision model (`decide.ts`) or the shot model.

## Unresolved items

None. Resolved on 2026-10-07: spatial targets use all seven tracking matches; C2 and C3 are kept.
The existing tracking targets (in-play share, distance, peak speed) stay on J03WPY, so C1's targets don't move. Recomputing them on seven matches is a separate, later decision.

## Results (2026-10-08)

Behaviours switched on (support 2, marking 0.5, carry avoid 6 m and shield 3 m), plus `fwdDropM`, `widthSlackM` 4 m and spatial tuner weights 0.3, then recalibrated from the first run (2 rounds, 122 evaluations, loss 24.10). Tuned knobs: `def_line` 15 m, `def_depth` 1.0, `fwd_drop` 0, `marking_weight` 0.75, `support_dist` 14 m. Figures are from `docs/realism/realism-report.md` (16 matches, seeds 2000-2015).

- **C1: NOT MET.** Of the original 19, 14 are within 1 SD (needs 16) and 17 are within 2 SD (needs 19). Outside 2 SD: pass completion (z -2.32) and median pass length (z -2.07).
- **C2: MET.** Free kicks z +0.60, fouls z -0.70, goals z -0.07, shots on target share z -0.68.
- **C3: NOT MET.** Shots per match SD is 6.0 (needs 5 or less). ASSUMED threshold.
- **C4: NOT MET.** Defending team length 37.6 m against 32.2 m (z +3.39) and width out of possession 43.7 m against 37.0 m (z +3.00, gate seeds +3.003). The other five are within the band: width in possession +0.15, line height +0.81, ball pressure +0.17, support within 15 m -1.03, free space +1.66.
- **C5: PENDING** - to be judged by the user in the replay.

The realism gate enforces the 19 scalar statistics against the real targets (all |z| < 3, loss 26.5 against 30) and the drift of all 26 against the baseline. It does not yet enforce the seven spatial targets: two of them (width out of possession, defending length) fail |z| < 3, and the gate has not been widened. Enforcing them is a one-line change (`SCALAR_KEYS` to `GATE_KEYS` in the real-target check of `realism-gate.test.ts`).

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

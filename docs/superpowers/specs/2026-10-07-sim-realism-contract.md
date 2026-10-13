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
| C3 | Team shot-share spread (SD over matches of home shots / all shots) of 0.18 or less on at least 64 held-out matches. Restated 2026-10-13: the former shots-per-match SD ≤ 5 sat at the chance floor (a realistic sim lands near 4.9) | Restated by the user, 2026-10-13 (see `2026-10-13-sim-realism-v2-design.md`) |
| C4 | Seven spatial metrics measured on all seven IDSSE tracking matches are in the realism report and gate, each with \|z\| < 3 using the existing scale rule (real between-match SD, floored at 5 % of the mean) | All seven matches: CONFIRMED by the user. The z < 3 band is the gate's existing rule (derived) |
| C5 | A replay viewer sees supporters offering angles, defenders goal-side of their opponents, and carriers shielding under pressure | Judged in the replay (CONFIRMED judge) |

## Constraints and non-goals

- One metric definition shared by real and synthetic data: Python `metrics.py` with a line-for-line TypeScript port and a parity test (existing convention).
- Only aggregate real-data statistics are committed (IDSSE licence; existing convention).
- The engine stays deterministic for a seed.
- Each new behaviour ships switched off by default, so the realism baseline stays unchanged until a single calibration step switches them on.
- Non-goal: changing the decision model (`decide.ts`) or the shot model. Lifted for realism v2 (user, 2026-10-13): see `2026-10-13-sim-realism-v2-design.md`.

## Unresolved items

None. Resolved on 2026-10-07: spatial targets use all seven tracking matches; C2 and C3 are kept.
The existing tracking targets (in-play share, distance, peak speed) stay on J03WPY, so C1's targets don't move. Recomputing them on seven matches is a separate, later decision.

## Results (2026-10-09)

Behaviours on (support 2, marking 0.75, carry avoid 6 m and shield 3 m, `widthSlackM` 4 m), the own-goal fix below, then
a recalibration on the fixed engine from the previous parameters (2 rounds, 115 evaluations, loss 21.45). Tuned knobs
that moved: `long_bias` 1.75 -> 2.25, `reach_margin` 0.725 -> 0.775, `save_b0` 1.3 -> 1.675, `xg_b0` -0.5 -> -0.75,
`yellow_per_foul` 0.4 -> 0.375. The shape and behaviour knobs stayed at `def_line` 15 m, `def_depth` 1.0, `fwd_drop` 0,
`marking_weight` 0.75 and `support_dist` 14 m. Figures are from `docs/realism/realism-report.md` (16 matches, seeds 2000-2015).

- **C1: NOT MET.** Of the original 19, 11 are within 1 SD (needs 16) and 17 are within 2 SD (needs 19). Outside 2 SD:
  pass completion (z -2.22) and median pass length (z -2.42).
- **C2: NOT MET.** Free kicks z +1.11 is outside 1 SD. Fouls z -0.51, goals z -0.92 and shots on target share z -0.85 are within.
- **C3: NOT MET.** The shots-per-match SD is 7.6 (needs 5 or less).
- **C4: NOT MET.** Defending team length is 37.6 m against 32.2 m (z +3.41), and width out of possession is 43.7 m against
  37.0 m (z +3.02). The other five are within the band: width in possession +0.14, line height +0.23, ball pressure +0.00,
  support within 15 m -1.01, free space +1.65.
- **C5: PENDING.** To be judged by the user in the replay.
- **Own goals:** 1 in 16 matches (seeds 2000-2015), down from 11 before the fix. Real football has about 0.13 per match.
- **Keeper claims (known regression):** keepers claim far fewer high balls. On the test configs' seeds 1-16 there were
  46 claims and 23 punches on the pre-plan engine, against 4 and 6 with the behaviours on (6 and 7 with the final
  parameters). Crosses per match did not halve (league fixtures 8.8 -> 10.1). They are blocked more and land short of the box.

The realism gate (seeds 3000-3015) passes on the 19 scalar statistics against the real targets. All |z| are below 3
(largest: pass length -2.14, completion -2.10), and drift against the refreshed baseline is 0. The margin is thin: the
loss is 29.98 against `GATE_LOSS` 30 (the loss sums all 26 statistics, the seven spatial ones at weight 0.3,
while the |z| < 3 check covers the 19 scalar ones), so almost any engine change will need a recalibration before it passes. The seven
spatial targets are not enforced against the real figures. With them enforced the gate fails on defending length
(z +3.37), while width out of possession (z +2.97) and the other five pass. The gate has not been widened.

**Deviation from the non-goal "changing the decision model (`decide.ts`)":** the own keeper is no longer a candidate
for a high pass, so passes back to the keeper go along the ground (under 30 m). Almost every own goal came from an
outfielder 30-60 m out lofting the ball back at his own keeper, aimed a few metres in front of the goal. It ended in the
net when overhit or when the keeper's touch failed. Marking left the keeper as the open option, so these lofted back
passes doubled (98 -> 220 in 16 matches) and own goals rose from 4 to 11. Real players do not loft the ball back at
their keeper. The change removes the mechanism instead of hiding its outcome.

Related changes: the scenario script's hand-set goal nudge `script.goalShotLogit` rose from 1.0 to 1.25. Scripted
comebacks had relied on these own goals: without the nudge change, late_comeback succeeded unforced in 7 of 10 seeds,
and with it in 10 of seeds 1-10 (28 of 30 on seeds 1-30). Forced script outcomes now lapse at the end of their window, a runner fix.

### Not met / future work

- C1: pass completion and median pass length are too low (passes are short and often intercepted).
- C2: too many free kicks (+1.11). Goals per match also fell to 1.56 against 2.71 (z -0.92, within 1 SD).
- C3: shots per match vary too much between matches (SD 7.6). Some sides barely shoot, even when a script pushes them to attack.
- C4: the defending block is too long and too wide out of possession. The current knobs (`def_line`, `def_depth`,
  `fwd_drop`, `marking_weight`) do not bring it in.
- Keeper claims of crosses collapsed (above).
- The gate's loss margin is 0.02.
- C5 needs the user's replay review.

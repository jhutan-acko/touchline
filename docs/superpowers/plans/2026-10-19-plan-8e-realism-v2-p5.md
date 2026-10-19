# Realism v2, P5: role moves and set pieces — implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. This plan is built for **parallel** execution, and P6 (plan 8f) runs beside it: read "Parallel execution" and "Cross-phase contacts" before starting.

**Goal:** Restarts and off-ball roles look and play like real football. Corners and wide free kicks load the box and are defended man-to-man and zonally (S1, S2). Free kicks get walls (S3), teams keep real rest defence (S4), goal kicks, throw-ins and kickoffs take their real shapes (S5–S7), and dead balls last as long as real ones, with players walking into place (S8). Keepers take own-third free kicks and goal kicks go long half the time (G3). Central free kicks are shot directly (S9). Full-backs overlap and invert, wingers come inside, runners hold the line and CMs drop between the CBs (A6). P4's carried work lands too: zonal marking with a free-space lever, aerial-duel volume, the pause and recovery timing, press trigger lifts, the release median, M10 and P3's deferred tests. The phase ends with the gate green on recalibrated parameters and every P5 target re-measured, MET or NOT MET.

**Architecture:**
- **Seams first.** Task 1 adds every P5 params block (all off), three RNG streams, the `rotate` intent, the restart-plan and set-piece state, a pure `setpiece.ts` (classification and role-table geometry), seven banner-delimited seam blocks in `step.ts` and two in `decide.ts`. Each seam's rule-0 body is today's code, so the output is bit-identical (gate drift 0).
- **One owner per block.** Each wave task fills one seam block (or takes over one P3/P4 block, named in the ownership table), plus its own new module, its own test file and the values of its own params block.
- **Switches.** Every behaviour ships behind a `rule` switch (validated 0 or 1). Task 14 switches everything on, recalibrates, re-baselines and re-pins.
- **Diagnostic first.** Task 2 adds a Python `setpieces` section (set pieces, keeper restarts, direct free kicks, role moves), with real aggregates and `--only setpieces`, and commits the P4 baseline.

**Tech stack:** TypeScript (Effect monorepo, vitest), Python 3 (uv, pytest, numpy), pnpm 11.

**Spec:** `docs/superpowers/specs/2026-10-13-sim-realism-v2-design.md`: "Decisions", "Conventions for every phase", "P5: role moves and set pieces", "Results: P3" ("Gaps outside P3", "Carried to P4/P5", "Rulings") and, once written, "Results: P4".

The evidence is in `touchline-worktrees/analysis-positioning/`, outside the repo: `setpieces-report.md` (R1–R9 and its tables), `offball-report.md` (Step 3, T4, T5, §4.4 B3–B6), `gk-report.md` (G3), `physical-report.md`. The metric definitions are in `sp_analysis.py` and `off_analysis.py`; Task 2 may read them. Only the aggregates quoted in this plan may be committed.

**Starting point** (P4 expected outcome; Task 2 re-measures on the P4 merge):
- **Set pieces** (analysis on the pre-P1 engine): corner box 1.3 attackers and 2.8 defenders (real 5.5 and 9.2); walls at central free kicks 30 % (real 100 %); 2.9 opponents inside the box at goal kicks (real 0.18); dead time 9–16 s too long except attacking free kicks (12 s too short); players stand still while the ball is dead (0.2–0.4 m/s, real 1.0–1.5).
- **Keeper and goal kicks:** goal kicks 89.5 % short (real 50/50), long ones 100 % completed (real 49 %); keepers never take free kicks (real 3 per team-match).
- **Direct free kicks:** 0 % of central attacking free kicks shot (real 36 %).
- **Role moves** per team-match, real (sim): overlap 13.9 (0.6), W inside 61.9 (1.4), FB inversion 36.4 (6.2), runs in behind 34.6 (59.3), CM drops 44.7 (11.4).
- **P4 not met:** aerial duels 16–21 per match (47); aerial fouls 2 (5); penalties 0.2 (0.43); the recovery curve and the pause speed ratio 1.0 (0.87); press trigger lifts about 1.1 (2); release median 2.0 s (1.40); free kicks exceed fouls by about 11 per match (offsides).
- **P4 switches:** tackle, fouls, aerial, transition, `firstTick.scopeRule` and `release.rejudge` ship on. `marking.rule` ships **off** (free space 9.6 m against 6.0). `press.rule` ships **either** on at `rateScale` 0.5 **or** off; every press step below is written for both cases.
- **Gate blind spot:** `GATE_Z` (|z| < 3) covers only `SCALAR_KEYS`, so `ball_pressure_m` reached z +4 unflagged (Question 1).

## Setup (before Task 1)

The worktree exists at `touchline-worktrees/realism-v2-p5` (branch `realism-v2-p5`, base 79d6088: P4 Tasks 1–9 merged, switches off). **Wave 0 code starts once P4 is merged to `main`:**

```bash
cd /Users/jhutan.debnath/Documents/GitHub/microsoft-hackathon/touchline-worktrees/realism-v2-p5
git fetch . main:main 2>/dev/null; git rebase main   # the plan commit rides along
pnpm install
```

If P4 is still unmerged, Tasks 1 and 2 may start on 79d6088, but no task takes a measurement (Step "Measure") until the branch is rebased onto the P4 merge. Every path below is relative to a worktree of `realism-v2-p5`, the **integration branch**.

## Parallel execution

### Dependency graph

```
Task 1 (scaffold) ──┬──> Task 3 (S1/S4 attacking set pieces) ──┬──> Task 8 (S9 direct free kicks) ────┐
Task 2 (diagnostic)─┤    Task 4 (S2/S3 defending, walls) ──────┤                                     │
                    ├──> Task 5 (S5–S7 GK, throw-in, kickoff) ─┼──> Task 7 (G3 keeper restarts) ─────┤
                    ├──> Task 6 (S8 restart timing) ───────────┤                                     ├──> Task 14 (switch on,
                    ├──> Task 9 (A6 runs, overlaps) ───────────┼──> Task 11 (zonal + aerial volume) ─┤     recalibrate, gate,
                    ├──> Task 10 (A6 rotations, CM drop) ──────┤      └──> Task 12 (pause, recovery, │     re-pin, results)
                    └──> Task 13 (release median, P3 tests) ───┘           press lifts) ─────────────┘
```

### Waves

| Wave | Tasks, run concurrently | Starts when |
|---|---|---|
| 0 | Task 1, Task 2, pre-flight scan | Setup is done |
| 1 | Tasks 3, 4, 5, 6, 9, 10, 13 | Tasks 1 and 2 are merged |
| 2 | Tasks 7, 8, 11; then Task 12 | Every wave-1 task is merged; Task 12 after Task 11 |
| 3 | Task 14 | Tasks 7, 8, 11 and 12 are merged |

- **Why wave 2.** G3's long goal kicks need S5's build-up shape (targets beyond 32 m). S9 shoots past S3's wall from S1's loaded box. Aerial volume is measured with every set-piece shape on. Task 12's press values are measured with Task 11's marking.
- **Pre-flight scan.** Before dispatching Task 1, a read-only scan (opus) of this plan against the code at the integration base, looking for fixture contradictions, seam signature mismatches, "off" assertions that rely on `DEFAULT_PARAMS`, and rule-0 non-identity. Findings become rulings in each task's brief.

### File ownership

A task creates or modifies only the files listed for it. **Shared files are in bold.** In `step.ts` and `decide.ts` each task edits only its own banner block and its own import lines under its own marker.

| Task | Model | Owns (create or modify) | In **`step.ts`** | In **`params.ts`** |
|---|---|---|---|---|
| 1 | opus | **`sim-core/src/{params,types,step,decide}.ts`**, `sim-core/src/setpiece.ts` (new), `schema/src/domain.ts` (`Intent`), `sim-core/test/{params,setpiece}.test.ts` | Markers, seven P5 blocks, the call sites in Task 1 | Every P5 block and field (all off), validation, the `cross.zones` regex |
| 2 | opus | `python/analytics/touchline_analytics/{setpieces,rolemoves}.py` (new), `report.py`, `targets.py`, `python/analytics/tests/test_setpieces.py` (new), `data/params/targets-idsse.json` (`setpieces` block), `calibrate/src/realism.ts` (`--only setpieces`), `docs/realism/p5-setpieces-baseline.md` (new) | — | — |
| 3 | opus | `sim-core/src/setpiece-attack.ts`, `sim-core/test/setpiece-attack.test.ts` | **Attacking set-piece seam** | `setAttack` values |
| 4 | opus | `sim-core/src/setpiece-defend.ts`, `sim-core/test/setpiece-defend.test.ts` | **Defending set-piece seam** | `setDefend` values |
| 5 | sonnet | `sim-core/src/setpiece-shapes.ts`, `sim-core/test/setpiece-shapes.test.ts` | **Restart-shape seam** | `setShapes` values |
| 6 | opus | `sim-core/src/deadball.ts`, `sim-core/test/deadball.test.ts` | **Dead-ball seam** | `deadBall` values |
| 7 | opus | `sim-core/test/keeper-restarts.test.ts`; **`decide.ts`**: the **P5 goal-kick block** only | **Keeper-restart seam** | `keeperRestarts` values |
| 8 | opus | `sim-core/test/direct-fk.test.ts`; **`decide.ts`**: the **P5 direct-free-kick block** only | — | `directFk` values |
| 9 | opus | `sim-core/src/runs.ts`, `sim-core/test/runs.test.ts` | **Role-run seam** | `roleMoves.overlap`, `roleMoves.run` |
| 10 | sonnet | `sim-core/src/rotate.ts`, `sim-core/test/rotate.test.ts` | **Rotation seam** | `roleMoves.inside`, `invert`, `cmDrop`, `jogMps` |
| 11 | opus | `sim-core/src/offball.ts` (append), `sim-core/test/marking-p5.test.ts` | **P4 marking seam** (taken over) | `marking.laneShare`, `maxGapM`, `landing*` |
| 12 | sonnet | `sim-core/src/transition.ts`, `sim-core/src/press.ts`, `sim-core/test/transition-p5.test.ts` | **P4 transition seam** and **P4 team-press seam** (taken over) | `transition` and `press` values |
| 13 | sonnet | `sim-core/src/release.ts`, `sim-core/test/{release-p5,distribution,identity}.test.ts`, `calibrate/test/pass-length.test.ts`, the support case in `sim-core/test/offball.test.ts` (append) | **P3 release seam** (taken over) | `release.freeS` |
| 14 | opus | Everything else: the switches, `params.test.ts`, `calibrate/src/knobs.ts`, `data/params/*`, `docs/`, seed pins, goldens, `sim-core/test/setpieces-targets.test.ts` (new) | anything left | the switches |

- Tests import modules directly (`../src/runs.js`); no task touches `index.ts`.
- The calibrated file `data/params/touchline-params.json` is Task 14's alone. A wave task that finds a better value for an existing knob records it in its report.

### How to run a wave

As P4 (plan 8d "How to run a wave"), with `p5-task<N>` worktrees and branches, `git merge --no-ff p5-task<N> -m "merge: P5 task <N> (<short name>)"`, the sim-core suite and the gate after each merge (every drift exactly 0 in waves 0–2), and measurements as `pnpm realism --matches 16 --only setpieces --set <keys> --runs out/p5-t<N>-runs --out out/p5-t<N>-<label>.md`, deleting each run folder after its report (about 1.3 GB; check `df -h .` first).

## Global Constraints

- Never commit `data/raw/`. Use only aggregated real data.
- Commit trailer: `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Never widen the gate, and never loosen a test.
- Never use a bare `git stash`.
- Merge to main only after the user has seen the results.
- Put every new behaviour behind a `rule` switch that stays off until the final task. With rule 0, output must be byte-identical.
- Each concern draws from its own named substream, `substream(seed, concern)`.
- `decide.ts`, `execute.ts`, `resolve.ts` and `shot.ts` are sensitive. A phase may touch only the parts the spec names for it.
- **Gate values.** `GATE_LOSS` 30, `DRIFT_Z` 3.5, `GATE_Z` 3, `WITHIN_1SD` 11, `WITHIN_2SD` 17, `PHYSICS_INSIDE` 2; no statistic dropped. A missed real target goes in `it.fails`, unwidened, titled `NOT MET:`, with the measured value in a comment.
- **Sensitive files in P5.** `decide.ts`: only the two P5 blocks and Task 1's five call-site lines in `decide()` (S9 and G3, as the spec approves). `execute.ts`, `resolve.ts` and `shot.ts`: **untouched** (ruling 12). The shot model (`xgOf` constants, the shot-logit line, `releaseShot`, `planShot`) is P6's.
- **Streams.** Three new streams, appended to `CONCERNS` in this order:

  | Stream | Draws |
  |---|---|
  | `setpiece` | Rest-defence keepers, wall size and members, wall jitter, outlet draws |
  | `dead` | Restart delays (S8), walk speeds, settle times, taker pauses, keeper free-kick share |
  | `roles` | Role-move hazards, wide-lane picks and durations (A6) |

  With every P5 rule at 0 no new draw happens. No `Math.random`, no `Date`.
- **Defaults.** `setAttack.rule`, `setDefend.rule`, `setShapes.rule`, `deadBall.rule`, `keeperRestarts.rule`, `directFk.rule`, `roleMoves.runRule`, `roleMoves.rotateRule`, `marking.landingRule`, `transition.pauseRule` and `release.freeRule` are 0; `marking.maxGapM` 0 means no cap. `paramsFromJson` rejects a switch other than 0 or 1. Only Task 14 turns them on.
- **Test fixtures.** Explicit `off` and `on` params (`{ ...P, setAttack: { ...P.setAttack, rule: 1 } }`), never `DEFAULT_PARAMS` as "off". A mechanism test asserts only what its rule adds, against the same fixture under `off`, after asserting its precondition (P3 F1, F2, F11).
- **Tick rate.** Windows in seconds, converted with `Math.round(s / dt)`; each window test runs at dt 0.1 and dt 0.04.
- **Frames.** Team frame: u = `attackX(side, x, period)`, +52.5 the opponents' goal line. Set-piece tables are in the **restarting** team's frame (defenders too, as the analysis measures them), with |y| and a sign. Box u > 36, |y| < 20.16; six-yard box u > 47, |y| < 9.16; own third u < −17.5; attacking third u > 17.5; wide free kick |y| > 20.16.
- **Agents.** The decision log format, `overridePass`, `DecisionInput` and the recorded options are unchanged. The frame `intent` vocabulary gains `rotate` (additive); `off_ball_run` gains kinds `overlap`, `inside`, `invert`, `cm_drop` (additive). No new event types.
- **Region ownership.** Edit only the region the ownership table gives your task. A change you need elsewhere is a plan bug: stop and report it.

## Review Focus

1. **A missing or sent-off role.** A formation with no W (3-5-2), a sent-off CB, ten men or fewer: role tables fall back (ruling 4), rest-defence and wall counts are capped at the outfielders available, man-marking with more attackers than defenders leaves the extras to zonal spots, an overlap with no same-side W never fires. Covered in Tasks 3, 4, 9 and 10.
2. **Second half and the other side.** Table spots, the near post, wall shading, the goal-kick box clamp, the kickoff half and the CM drop zone mirror when home attacks −x after half-time. Covered in Tasks 1, 3, 4, 5 and 10.
3. **Restart spots at the edges.** A corner at the flag, a free kick 3 m from the byline (its 9.15 m wall spot would be off the pitch or in the goal), a throw-in at the halfway line: every spot is clamped inside the pitch and walls never stand behind the goal line. Covered in Tasks 3, 4 and 5.
4. **A restart interrupted.** A substitution or a red card while the ball is dead leaves plan ids that no longer exist; a period ending while a restart is pending; a taker sent off during his pause. Lookups tolerate missing ids and the taker is re-picked. Covered in Tasks 4 and 6.
5. **25 Hz renders (dt 0.04).** Taker pause, settle deadlines, the 2 s run window, rotation durations and the 5 s CM-drop window. Covered in Tasks 3, 6 and 10.

## Planning rulings

**User decisions** come from "Questions for the user" below; until answered, the recommended option applies.

1. **Plan name.** Plan 8e; banners `// ===== P5 <block> seam (plan 8e Task N owns this block)` … `// ===== end of P5 <block> seam`; import markers `// ---- P5 imports, <block> seam (plan 8e Task N inserts below this line)`, after the P4 markers. P6 (plan 8f) puts its markers and blocks after these.
2. **Params blocks.** New: `setAttack` (S1, S4), `setDefend` (S2, S3), `setShapes` (S5–S7), `deadBall` (S8), `keeperRestarts` (G3), `directFk` (S9), `roleMoves` (A6). Fields: `marking` gains `maxGapM`, `landingRule`, `landingGoalSideM`, `landingReactM`; `transition` gains `pauseRule`, `pauseDip`, `pauseEndS`; `release` gains `freeRule`, `freeS`. Nothing goes in the `shot` block (P6's).
3. **One `setpiece.ts`, four modules.** The spec's `setpiece.ts` holds the shared pure helpers (Task 1). The behaviours live in one module per task (`setpiece-attack.ts`, `setpiece-defend.ts`, `setpiece-shapes.ts`, `deadball.ts`), so wave-1 tasks never share a file.
4. **Role tables.** Spots are real role means (u, |y|) in the restarting team's frame, copied from `setpieces-report.md`. A player's sign is the sign of his open-play anchor's y (0 for a central slot, which stands on y 0); DM uses CM. A role missing from the formation simply has no player; a player whose role has no row (none today) keeps his old restart target. Duplicates on one spot are separated by `separation` in `moveAll`.
5. **Restart-phase precedence** (Task 1's dispatcher in `moveTarget`): taker → his old target; restarting side → `attackSpot ?? shapeSpot`; the other side → `defendSpot ?? shapeSpot`; neither → today's target and 9.15 m push. Then `deadMove` sets the speed. Set-piece modules apply the 9.15 m law themselves (walls with their jitter).
6. **S1.** Corners use the spec's targets; the keeper goes to u −12. Free kicks use one pooled attacking-third table (`fk_att` real means); Task 3 may shift the wide-free-kick u by up to +3 m to reach 3.8 in the box. Attackers stand `holdBackM` 2 m short of their spot (toward their own goal) until the kick, then run to it at `runSpeedShare` × vmax for `runWindowS` 2 s (`setPieceRun`).
7. **S4.** At corners, wide and central attacking free kicks and attacking-third throw-ins, the side keeps floor(k) players back plus one more with chance frac(k) (`setpiece` stream), k = `restKeep[kind]` (1.4, 2.7, 2.3, 4.1). They are the deepest by role order FB, CM, DM, CB, at u U(20, 25) spread over y ±12. Others take their table spot.
8. **S2.** At corners and wide free kicks, every defending outfielder goes into the box: attackers in the box (and those whose table spot is in the box) within `manM` 12 m are assigned with `assignMarks` and marked goal-side at `goalSideM` 1 m, weight 1; unassigned defenders take zonal spots in order (u 47, y −5.5 / 0 / +5.5; then the penalty spot), then the corner defending table. At wide free kicks one ST stays up with chance `outletShare` 0.24; at corners nobody does. Central free kicks: the wall (ruling 9) plus the same marking for the rest.
9. **S3.** Central attacking free kicks: a wall of 3 or 4 (equal chance); wide ones: 1 or 2 with chance 0.76, else none. Members are the defending outfielders other than CBs and GK nearest the wall point, picked at the restart's start. The wall stands `wallM` 9.15 m from the ball on the line to a point `shadeM` 1 m inside the near post, players 0.6 m apart across the line, each `U(-jitterM, 0)` closer (0.5 m), clamped inside the pitch and never past the goal line.
10. **S5–S7.** Goal kicks and kickoffs use the real role tables for both sides. Goal kicks: opponents clamped outside the box (u > −36 + 0.5 in the kicker's frame when |y| < 20.66). Kickoffs: everyone in his own half; defenders at least 9.15 m from the centre. Throw-ins: the 3 nearest outfield teammates of the taker take `supportSpot(at, anchor, side, period, opps, 10, true)`; the defending side marks them with `markTarget(..., goalSideM 1, weight 0.75)` through `assignMarks` (radius 15 m).
11. **S8.**
    - **Delays.** Lognormal on the `dead` stream: median `medianS[key]`, σ `sigma[key]` = ln(q75/q25)/1.349 from the report's IQRs (throw-in 0.68, goal kick 0.47, corner 0.18, attacking free kick 0.31, other free kick 0.57, kickoff after a goal 0.22), floored at `minS` 3, times `1 + lateGrowth·(minute/90 − 0.5)` so the match median holds while late delays lengthen. Keys: `free_kick_att` when the spot is in the taking side's attacking third, else `free_kick`. Penalties keep the old draw on the `restart` stream (spec silent).
    - **Walking.** At the restart's start each player draws a walk speed U(1, 1.5) m/s and a settle time: U(2.5, 3.5) s before the resume tick, or, at corners and attacking free kicks, U(6, 7) s (attackers) and U(13, 19) s (defenders). Speed cap = min(0.8·vmax, max(walk, distance ÷ seconds left to his deadline)).
    - **Taker pause.** The kick waits until the taker has stood within 1 m of the spot for U(0.5, 1) s (`takerReady`); the phase stays `restart`, so everyone holds his set-piece spot during the pause.
12. **G3 without `execute.ts`.** Long-kick completion is set through `KickIntent.errorScale` from the P3 `kickStyle` (step.ts): a goal kick or keeper free kick whose target is at least `longM` 32 m away is struck with `longErrorScale`. Contested landings come from S5's shapes and Task 11's landing marking, decided by P4's aerial duels. `execute.ts:46` stays P6 SH4's alone. Cost if wrong: completion may not reach 49 % with error alone; Task 7 records how far it gets and Task 11 adds the contest.
13. **G3 choice.** `keeperRestarts.longShift` is added to the `long_pass` and `switch` logits at goal kicks and keeper-taken free kicks (`restartKindShift`). Task 7 tunes it to a long share (first contact beyond 32 m) of 0.48. Keepers take free kicks in their own third (u < −17.5) with chance `fkShare`, tuned to 3.0 per team-match.
14. **S9.** For a free kick in the taker's attacking third with |y| ≤ 20.16 and goal distance ≤ `directFk.maxDistanceM` 35: the shot is available; the shot logit gains `shotShift`; the shot's xG is `sigmoid(logit(xgOf(p, side, period, pos, false, 0)) + xgLogit)` (no wall in the cone; the wall still blocks in `planShot`). Task 8 tunes `shotShift` to a 0.36 shot share and `xgLogit` to a mean direct-free-kick xG of 0.06. The shot goes through the existing `releaseShot` path (`technique: "free_kick"` is already recorded).
15. **A6 runs and overlaps keep `run_in_behind`.** Both use the existing intent kind, so P3 D4 offers through balls to them without a `decide.ts` change (Question 3). The event says which: `off_ball_run` kind `in_behind` or `overlap`.
    - **Runs** (rule 1): eligible ST, W, AM and FB with `run.roleWeight` (start ST 0.45, W 1.4, AM 0.5, FB 0.6) on the existing hazard; trigger: carrier a CM, DM or AM moving forward (velocity u > 0.5 m/s), carrier u > −20, and space behind the line (last defender u < 52.5 − 10). The target is u = lastDef − `holdM` 1, re-aimed each tick while the run lives; with chance `wideShare` 0.6 the runner's y moves to the wide lane (|y| ≥ 14) on his side.
    - **Overlaps:** an FB whose same-side W or CM has the ball in the mid or attacking third and the wide lane, with the FB within 15 m behind the carrier, at hazard `overlap.ratePerS`. Target: 3 m outside the carrier (kept 1.5 m inside the touchline), 6 m beyond him; speed cap `overlap.speed` 5 m/s; 1–2 s.
16. **A6 rotations** use the new `rotate` intent (a held spot, jogged to at `jogMps` 3.5 m/s at most).
    - **W inside:** in possession, ball u > 17.5; the W moves to |y| U(5, 8) at his shape u, for U(1.5, 3.5) s.
    - **FB inversion/underlap:** in possession, ball u > −17.5, his same-side W wide (|y| > 20) or on the ball and not rotating inside; the FB moves to |y| = |W y| − U(5, 10), u = max(shape u, own last outfielder u + 15), for U(1.5, 4.5) s. When the W rotates inside, the FB keeps his width (the pair is gated both ways).
    - **CM drop:** within 5 s of his side winning the ball (`w.transition`, loser = the other side) with the ball in his own third, one CM or DM (the deepest) drops between or beside the CBs: u = mean CB u + 1, y = midpoint of the CBs, or, if they are within 6 m of each other, 3 m outside the CB on the ball's side, for U(1.5, 3) s. With `transition.rule` 0 there is no drop.
    - Rates `inside.ratePerS`, `invert.ratePerS`, `cmDrop.ratePerS` are tuned to 61.9, 36.4 and 44.7 per team-match.
17. **Zonal marking returns with a cap.** `marking.maxGapM` > 0 pulls P4's lane spot toward the attacker until it is within `maxGapM` of him. Task 11 tunes it toward `free_space_m` 6.0 with `tight_share` in 0.06–0.12; `marking.rule` is switched on in Task 14.
18. **Aerial volume: landing-spot marking and reaction** (`marking.landingRule`).
    - **Marking:** while the opponents' carrier is a keeper (in hands or at his feet) or a CB or FB in his own third, the defending CB nearest the opponents' most advanced outfielder marks him goal-side at `landingGoalSideM` 1 m, weight 1.
    - **Reaction:** during a high flight whose winner is an attacker, the defender marking that winner (`markSpot`'s attacker is `flight.winnerId`) goes to the contact point when it is within `landingReactM` 10 m of him. It changes second balls, not the contest already decided at release.
    - P5 does not touch `resolve.ts` (P6 SH2 owns the aerial branch). Set-piece shapes and G3 supply most of the extra duels; Task 11 measures what remains.
19. **Penalties.** No penalty mechanism (P4 user ruling: no box-foul inflation). Box loading (S1), runs (A6) and corner aerial fouls are the route. Task 14 reports 64-match penalties (Question 4).
20. **Pause and recovery** (`transition.pauseRule`).
    - **Pause:** at the loss, `noteLoss` records each losing outfielder's speed (`TransitionState.speeds`). During `pauseS`, a paused player's speed cap is min(base cap, `pauseDip` 0.87 × his speed at the loss), not P4's min(current, 0.55·vmax).
    - **End:** over `pauseEndS` 0.5 s after the pause, his target is `base`'s and his speed cap ramps linearly from the pause cap to `base`'s.
    - **Recovery timing:** values only (`recoverFromS`, `recoverRatePerS`, `recoverS`, `recoverToS`), tuned to the curve rows.
21. **Press trigger lifts.** Values only: Task 12 raises `backToGoalLift` and `ownThirdLift` (each at most 4) until the measured lifts reach their bands, and re-normalises `rateScale` so press episodes stay 365–445 per 90 and `ball_pressure_m` |z| < 3. **If P4 shipped `press.rule` 0**, Task 12 also re-tunes `rateScale` with Task 11's marking, and Task 14 switches `press.rule` on.
22. **Release median** (`release.freeRule`). Under rule 1 the free (unpressed) base draw is `release.freeS` instead of `timing.decisionMinS..MaxS`; Task 13 sets it to give a 1.40 s release median and 0.16 held over 3 s at the P4 cap. The `decision_scale` knob scales `freeS` too, with its range narrowed to 0.8–1.2 (Question 5).
23. **M10.** Bounds and seeds never change. Task 14 judges each on-bound test (punts per team-match, punt share, positioning deep count) against its 64-match value from the deep report: one whose 64-match value is outside its bound becomes `it.fails` (`NOT MET:`, both values in a comment). Punts are 0.63 on 64 matches against bound 1.0, so that test is expected to move.
24. **Deferred P3 tests** go to Task 13: the `pPunt` 0 and 1 branches, the throw lower bound and punt by foot, rule-off bit-identity at unit level, an in-match support-hold carry at dt 0.1 and 0.04, and the `pass-length.test.ts` EventType parse. Task 1 narrows the `cross.zones` `SIGNED` regex (it edits that line anyway). The two cases P4 Task 4 took (keeper free kick, `takerFor` fallback) are done.
25. **Offside free kicks** (about 11 per match above fouls) are recorded, not targeted: A6 runs that hold at lastDef − 1 should cut offsides; Task 9 records the offside count (Question 6).
26. **Diagnostics in Python** (P3 ruling 17); a hand-copied `setpieces` block in `targets-idsse.json`, kept by `HAND_BLOCKS`. Role moves are measured from frames with the analysis definitions, so sim and real are judged alike; the TS real-target test uses engine intent starts as a proxy.
27. **Knobs** (Task 14). No knob on role tables, walls, zonal spots or delay shapes. New:

    | Knob | Moves | Range |
    |---|---|---|
    | `fk_shot` | `directFk.shotShift` | Task 8's value ± 1 |
    | `gk_long` | `keeperRestarts.longShift` | Task 7's value ± 1 |
    | `gk_long_error` | × `keeperRestarts.longErrorScale` | 0.75–1.25 |
    | `role_rate` | × every A6 rate | 0.75–1.25 |
    | `max_gap` | `marking.maxGapM` | Task 11's value ± 1.5 |
    | `lane_share` | `marking.laneShare` | 0.3–0.5 |

    Changed: `restart_scale` also scales `deadBall.medianS` (range 0.8–1.25); `decision_scale` also scales `release.freeS` (range 0.8–1.2).
28. **Gate fallback order** (Task 14, Question 2): diagnose first; then switch off `roleMoves.rotateRule`, then `roleMoves.runRule`, then `marking.rule`, then `transition.pauseRule`. Always keep S1–S9 and G3. Stop and report before merging anything partial.

## Cross-phase contacts (P5 plan 8e ↔ P6 plan 8f)

P5's final task calibrates first; P6's final task rebases onto P5's merged result and calibrates on top. Each region has one owner.

| File / region | P5 (owner unless noted) | P6 | How the merge stays mechanical |
|---|---|---|---|
| `decide.ts` `decide()` body | Task 1 adds five standalone lines: `const rs = restartShot(...)` after the `xg` line; the `case "shot"` return becomes `rs ? rs.available : <today>`; `if (a === "shot" && rs) l += rs.shift`; `l += restartKindShift(input, a, p)` before the `scriptBias` line; the NON_PASS return's `xg` becomes `rs?.xg ?? xg` | Owns the shot-logit line `3 * (xg - 0.1) + 0.3 * …` (SH refit) and any SH1/SH2 contact functions | Different lines. P6 rebases and keeps both; P5 never edits the shot-logit line, P6 never edits P5's lines |
| `decide.ts` P5 direct-free-kick block (`restartShot`) | Task 8 | Reads only. **Seam for P6:** S9 adds `shotShift` on top of whatever shot logit P6 fits, and builds its xG by an offset on P6's `xgOf`, so a refit flows through. P6's final re-measures `fk_central_shot_share` and may re-set **only the value** `directFk.shotShift` (knob `fk_shot`) | Separate banner block; values in P5's own `directFk` params block |
| `decide.ts` P5 goal-kick block (`restartKindShift`) | Task 7 | Untouched | Separate block |
| `decide.ts` `xgOf`, `shot.maxDistanceM`, shot constants | Reads (`restartShot` calls `xgOf`) | Owner | P5 uses its own `directFk.maxDistanceM` |
| `execute.ts` (`:46` fatigue in `skill`) | Untouched (ruling 12) | SH4 owner | No overlap. P6's final re-measures `gk_long_completion` and may re-set the value `keeperRestarts.longErrorScale` (knob `gk_long_error`) |
| `resolve.ts` aerial branch | Untouched (ruling 18) | SH2 owner | No overlap. P6's final re-measures `aerial_duels_per_match` |
| `shot.ts`, `releaseShot`, `planShot` | Untouched | Owner | — |
| `step.ts` P5 blocks: attacking set-piece, defending set-piece, restart-shape, dead-ball, keeper-restart, role-run, rotation | Owner | Untouched | Banner blocks; P6 adds its own `P6 … (plan 8f)` blocks below P5's |
| `step.ts` taken-over blocks: P4 marking, transition, team-press; P3 release; P3 keeper-distribution (`kickStyle` gains `× longKickScale`) | Owner | Untouched | — |
| `step.ts` call sites | `startRestart`, `handleRestart`, `takerFor`, `moveTarget` (restart branch, run branch, two insertions), `kickStyle` | `resolveFlightNow` reception branch (SH1), `releaseKick` aerial handling (SH2), `releaseShot` | Disjoint functions. If P6 needs a `moveTarget` line, it writes against P5's dispatcher after rebase |
| `params.ts` | Blocks of ruling 2; `checkRuleSwitches`, `SIGNED`, `PROBABILITIES` entries appended | `shot`, `fatigue.executionK`, its own blocks and entries | Separate blocks; P6 appends its list entries after P5's |
| `types.ts` | `CONCERNS` + `setpiece`, `dead`, `roles`; `Intent` + `rotate`; `MatchState.restartPlan`, `setPiece`; `TransitionState.speeds` | Its own additions after P5's | Append-only; stream sequences are keyed by name, so order is free |
| `knobs.ts` | Appends a `// P5 (plan 8e)` block; changes `restart_scale`, `decision_scale`; re-adds `lane_share` | Changes `shot_bias`, `xg_b0`, `save_b0`, `aim_noise`; appends its block after P5's | Disjoint entries |
| `targets-idsse.json`, `targets.py` `HAND_BLOCKS` | `setpieces` block | Its own block | Union |
| `report.py` `build` and `--only`; `realism.ts` `--only` | Adds `setpieces` after `duels` | Adds its section after `setpieces` | Union of choices |
| Calibrated params, baseline, goldens, seed pins | Task 14 regenerates first | Regenerates after rebasing onto P5 | Sequential, never concurrent |
| Shared targets | Records P5 values for `corner_shots_per100` and `fk_central_shot_share` | SH1 (first-time finishes off deliveries) and SH2 (headers) move both; P6's final judges them MET or NOT MET | P6 reads P5's rows; no new row needed |

---

### Task 1: Scaffold — params, streams, state, `setpiece.ts`, seams (wave 0, identity; opus)

**Files:**
- Modify: **`packages/sim-core/src/{params,types,step,decide}.ts`**, `packages/schema/src/domain.ts:50` (`Intent` literal)
- Create: `packages/sim-core/src/setpiece.ts`, `packages/sim-core/test/setpiece.test.ts`
- Test: `packages/sim-core/test/params.test.ts` (append)

**Interfaces:**
- Produces (in `params.ts`; defaults are the spec and report values with every switch 0). `RoleTable = Readonly<Record<Role, readonly [number, number]>>`, (u, |y|), DM = CM:
  - `setAttack: { rule: 0, corner: {GK:[-12,0],CB:[42,4],FB:[30,7],DM:[39,10],CM:[39,10],AM:[43,16],W:[37,11],ST:[43,4]}, fk: {GK:[-13,0],CB:[34,5],FB:[22,8],DM:[32.5,11],CM:[32.5,11],AM:[28,13],W:[30,9],ST:[37,4]}, fkWideShiftU: 0, holdBackM: 2, runWindowS: 2, runSpeedShare: 0.75, restKeep: { corner: 1.4, fk_wide: 2.7, fk_central: 2.3, throw_att: 4.1 }, restU: [20, 25], restSpreadM: 12 }`
  - `setDefend: { rule: 0, manM: 12, goalSideM: 1, zonal: [[47,-5.5],[47,0],[47,5.5],[41.5,0]], corner: {GK:[51,0],CB:[45.5,2.5],FB:[45,3.6],DM:[43,4],CM:[43,4],AM:[43.6,6.7],W:[40,5.5],ST:[45,3.5]}, outletShare: 0.24, wallCentral: [3, 4], wallWide: [1, 2], wallWideShare: 0.76, wallM: 9.15, wallGapM: 0.6, shadeM: 1, jitterM: 0.5 }`
  - `setShapes: { rule: 0, goalKick: { att: {GK:[-48,3],CB:[-31.5,11],FB:[-20,21],DM:[-15,11],CM:[-15,11],AM:[-5,13],W:[-0.4,18],ST:[5,12]}, def: {GK:[31,3],CB:[6.6,9],FB:[2,15],DM:[-5.6,9],CM:[-5.6,9],AM:[-18,9],W:[-13.6,15],ST:[-24,9]} }, kickoff: { att: {GK:[-37.4,0],CB:[-17,8.4],FB:[-7.2,21.4],DM:[-6.1,9],CM:[-6.1,9],AM:[-1.9,12],W:[-0.7,19.5],ST:[0.3,9.6]}, def: {GK:[44,0],CB:[17.3,5],FB:[14,14.6],DM:[8.8,5],CM:[8.8,5],AM:[4.8,10.6],W:[4.5,15.2],ST:[0.5,9.4]} }, throwShort: 3, throwShortM: 10, throwMarkWeight: 0.75 }`
  - `deadBall: { rule: 0, medianS: { throw_in: 13.5, goal_kick: 22, corner: 33, free_kick_att: 42, free_kick: 28, kickoff: 70 }, sigma: { throw_in: 0.68, goal_kick: 0.47, corner: 0.18, free_kick_att: 0.31, free_kick: 0.57, kickoff: 0.22 }, minS: 3, lateGrowth: 0, walkMps: [1, 1.5], settleS: [2.5, 3.5], settleAttS: [6, 7], settleDefS: [13, 19], takerPauseS: [0.5, 1] }`
  - `keeperRestarts: { rule: 0, fkU: -17.5, fkShare: 1, longShift: 0, longM: 32, longErrorScale: 1 }`
  - `directFk: { rule: 0, shotShift: 0, xgLogit: 0, maxDistanceM: 35 }`
  - `roleMoves: { runRule: 0, rotateRule: 0, run: { roleWeight: { ST: 0.45, W: 1.4, AM: 0.5, FB: 0.6 }, holdM: 1, wideShare: 0.6, spaceBehindM: 10 }, overlap: { ratePerS: 0.2, behindM: 15, outsideM: 3, aheadM: 6, speed: 5, durS: [1, 2] }, inside: { ratePerS: 0.1, halfSpaceY: [5, 8], durS: [1.5, 3.5] }, invert: { ratePerS: 0.1, inM: [5, 10], aboveLastM: 15, durS: [1.5, 4.5] }, cmDrop: { ratePerS: 0.3, winS: 5, durS: [1.5, 3] }, jogMps: 3.5 }`
  - `marking` gains `maxGapM: 0, landingRule: 0, landingGoalSideM: 1, landingReactM: 10`
  - `transition` gains `pauseRule: 0, pauseDip: 0.87, pauseEndS: 0.5`
  - `release` gains `freeRule: 0, freeS: [0.9, 2.2]`
- Produces (in `types.ts`):
  - `CONCERNS` gains `"setpiece", "dead", "roles"`, appended in that order.
  - `Intent` gains `{ readonly kind: "rotate"; readonly target: Vec2 }`.
  - `interface RestartPlan { kind: SetPieceKind; readyTick?: Readonly<Record<string, number>>; walkMps?: Readonly<Record<string, number>>; arrivedTick?: number; pauseTicks?: number; restKeep?: ReadonlyArray<string>; restSpot?: Readonly<Record<string, Vec2>>; keeperTaker?: boolean; wall?: ReadonlyArray<string>; jitter?: Readonly<Record<string, number>>; outlet?: string }`; `MatchState.restartPlan?: RestartPlan`
  - `interface SetPieceLive { kind: SetPieceKind; side: Side; tick: number; takerId: string }`; `MatchState.setPiece?: SetPieceLive`
  - `TransitionState.speeds?: Readonly<Record<string, number>>`
- Produces (in `setpiece.ts`, pure):
  - `type SetPieceKind = "corner" | "fk_wide" | "fk_central" | "fk_other" | "throw_def" | "throw_mid" | "throw_att" | "goal_kick" | "kickoff" | "penalty"`
  - `setPieceKind(restart: RestartKind, at: Vec2, side: Side, period: Period): SetPieceKind`
  - `deadKey(kind: SetPieceKind): keyof Params["deadBall"]["medianS"] | null` (null for penalty)
  - `framePoint(side: Side, period: Period, u: number, y: number): Vec2` (pitch coordinates of team-frame u, y)
  - `roleSpot(table: RoleTable, role: Role, ySign: number, frameSide: Side, period: Period): Vec2`
  - `ySignOf(anchor: Vec2): -1 | 0 | 1`
- Produces (in `step.ts`): `Work` gains `restartPlan` and `setPiece`, persisted by `toState` like `transition`. The module-private seams and their rule-0 bodies:

  | Block (owner) | Function | Rule-0 body |
  |---|---|---|
  | Attacking set-piece (Task 3) | `planAttack(w, r, kind): Partial<RestartPlan>` | `{}`, no draw |
  | | `attackSpot(w, pl, ph): Vec2 \| null` | `null` |
  | | `noteSetPiece(w, ph, taker): void` | no-op |
  | | `setPieceRun(w, pl, vmax): MoveTarget \| null` | `null` |
  | Defending set-piece (Task 4) | `planDefend(w, r, kind): Partial<RestartPlan>` | `{}` |
  | | `defendSpot(w, pl, ph): Vec2 \| null` | `null` |
  | Restart-shape (Task 5) | `shapeSpot(w, pl, ph): Vec2 \| null` | `null` |
  | Dead-ball (Task 6) | `restartDelayTicks(w, r): number` | `Math.round(timing.restartDelayS[r.restart] × restart.range(0.7, 1.3) / dt)` |
  | | `planDead(w, r, kind, resumeTick): Partial<RestartPlan>` | `{}` |
  | | `deadMove(w, pl, mt: MoveTarget): MoveTarget` | `mt` (the same object) |
  | | `takerReady(w, ph, taker): boolean` | `dist(taker.pos, ph.at) <= 1.0` |
  | Keeper-restart (Task 7) | `planKeeper(w, r, kind): Partial<RestartPlan>` | `{}`, no draw |
  | | `keeperTakes(w, r): boolean` | `false`, no draw |
  | | `longKickScale(w, d, restart): number` | `1` |
  | Role-run (Task 9) | `runMove(w, pl, owner): MoveTarget \| null` | today's run-in-behind branch of `moveTarget`, moved verbatim (returns null where today falls through) |
  | Rotation (Task 10) | `rotateMove(w, pl, owner, base: () => MoveTarget): MoveTarget \| null` | `null` |

- Produces (in `decide.ts`, exported for tests):

  | Block (owner) | Function | Rule-0 body |
  |---|---|---|
  | P5 direct-free-kick (Task 8) | `interface RestartShot { available: boolean; shift: number; xg: number }`; `restartShot(input: DecisionInput, p: Params, goalDist: number, ax: number): RestartShot \| null` | `null` |
  | P5 goal-kick (Task 7) | `restartKindShift(input: DecisionInput, a: Action, p: Params): number` | `0` |

- [ ] **Step 1: Write the failing tests**

`params.test.ts`, describe `"realism v2 P5 params"`:

```ts
it("ship switched off, with the real role tables, delay medians and three new RNG streams", () => {
  const P = DEFAULT_PARAMS
  for (const r of [P.setAttack.rule, P.setDefend.rule, P.setShapes.rule, P.deadBall.rule, P.keeperRestarts.rule, P.directFk.rule,
    P.roleMoves.runRule, P.roleMoves.rotateRule, P.marking.landingRule, P.transition.pauseRule, P.release.freeRule]) expect(r).toBe(0)
  expect(P.marking.maxGapM).toBe(0)
  expect(P.setAttack.corner.CB).toEqual([42, 4])
  expect(P.deadBall.medianS).toEqual({ throw_in: 13.5, goal_kick: 22, corner: 33, free_kick_att: 42, free_kick: 28, kickoff: 70 })
  expect(P.setAttack.restKeep).toEqual({ corner: 1.4, fk_wide: 2.7, fk_central: 2.3, throw_att: 4.1 })
  for (const c of ["setpiece", "dead", "roles"]) expect(CONCERNS).toContain(c)
})
it("reject a P5 switch other than 0 or 1, a wall share above 1, a reversed range, and accept negative table u", () => {
  expect(() => paramsFromJson({ provenance: cc, deadBall: { rule: 2 } })).toThrow(/deadBall\.rule must be 0 or 1/)
  expect(() => paramsFromJson({ provenance: cc, roleMoves: { rotateRule: 0.5 } })).toThrow(/roleMoves\.rotateRule must be 0 or 1/)
  expect(() => paramsFromJson({ provenance: cc, setDefend: { wallWideShare: 1.3 } })).toThrow(/between 0 and 1/)
  expect(() => paramsFromJson({ provenance: cc, deadBall: { walkMps: [1.5, 1] } })).toThrow(/deadBall\.walkMps/)
  expect(paramsFromJson({ provenance: cc, setShapes: { goalKick: { def: { ST: [-24, 9] } } } }).setShapes.goalKick.def.ST).toEqual([-24, 9])
  const z = DEFAULT_PARAMS.cross.zones[0]!
  expect(() => paramsFromJson({ provenance: cc, cross: { zones: [{ ...z, u: -5 }] } })).toThrow()   // the narrowed SIGNED regex
  expect(paramsFromJson({ provenance: cc, cross: { zones: [{ ...z, s: -3 }] } }).cross.zones[0]!.s).toBe(-3)
})
```

`setpiece.test.ts`:
- `"classifies restarts in the taking side's frame, mirrored after half-time"`: home first half: corner → `corner`; free kick at (30, 25) → `fk_wide`, (30, 5) → `fk_central`, (10, 5) → `fk_other`; throw-in at x −30 → `throw_def`, 0 → `throw_mid`, 30 → `throw_att`. Home second half: free kick at (−30, 5) → `fk_central`. `deadKey("fk_central")` = `free_kick_att`, `deadKey("fk_other")` = `free_kick`, `deadKey("penalty")` = null.
- `"role spots: table u and |y| in the restarting frame, the player's own sign"`: `roleSpot(corner, "CB", -1, "home", "first_half")` = (42, −4); the same in the second half = (−42, −4); `"DM"` equals `"CM"`; ySign 0 gives y 0; `ySignOf({x:3,y:-0.0})` is 0.

Run: `pnpm --filter @touchline/sim-core exec vitest run test/params.test.ts test/setpiece.test.ts`
Expected: FAIL (`DEFAULT_PARAMS.setAttack` undefined; `setpiece.ts` missing).

- [ ] **Step 2: Implement the params, types, schema literal and `setpiece.ts`**
  - Each block on its own lines with a doc comment naming the spec item and "rule 0: the old behaviour".
  - `checkRuleSwitches` gains the eleven switches.
  - `SIGNED` gains `/^setAttack\.(corner|fk)\./`, `/^setAttack\.fkWideShiftU$/`, `/^setDefend\.(corner|zonal)/`, `/^setShapes\.(goalKick|kickoff)\./`, `/^keeperRestarts\.(fkU|longShift)$/`, `/^directFk\.(shotShift|xgLogit)$/`; `/^cross\.zones/` narrows to `/^cross\.zones\.\d+\.(s|minOriginU)$/` (zone `u` must be positive; check the calibrated file still loads).
  - `PROBABILITIES` gains `setDefend.outletShare`, `setDefend.wallWideShare`, `keeperRestarts.fkShare`, `roleMoves.run.wideShare`, `setAttack.runSpeedShare`, `transition.pauseDip`.
  - A new `checkRanges` requires `lo ≤ hi` for every `[lo, hi]` pair in the P5 blocks.

- [ ] **Step 3: Build the seams in `step.ts` and `decide.ts`**
  - Markers and blocks as ruling 1. Attacking, defending, restart-shape and dead-ball blocks go just above `takerFor`; keeper-restart just below the P3 keeper-distribution block; role-run and rotation just above `moveTarget`. In `decide.ts` both blocks go just above `RESTART_ACTIONS`.
  - **Call sites** (all identity under rule 0):
    1. `startRestart`: `resumeTick: w.tick + restartDelayTicks(w, r)`; then `const kind = setPieceKind(r.restart, r.at, r.side, w.period)`; `w.restartPlan = { kind }` and, in this order, `w.restartPlan = { ...w.restartPlan, ...planDead(w, r, kind, resumeTick) }`, then `planKeeper`, `planAttack`, `planDefend` the same way (each sees the fields before it, so `takerFor` already knows the keeper choice); finally `w.restartPlan` becomes `undefined` if it holds nothing but `kind`.
    2. `takerFor`: before the outfielder pick, `if (r.restart === "free_kick" && keeperTakes(w, r)) { const gk = team.find((x) => x.role === "GK"); if (gk) return gk }`. `keeperTakes` makes no draw: it reads `w.restartPlan?.keeperTaker`, drawn once by `planKeeper` (below).
    3. `handleRestart`: `if (!takerReady(w, ph, taker)) return` replaces the 1 m line; after the `set_piece` event, `noteSetPiece(w, ph, taker)` and `w.restartPlan = undefined`.
    4. `moveTarget` restart branch: the taker line stays; then `const spot = pl.side === ph.side ? attackSpot(w, pl, ph) ?? shapeSpot(w, pl, ph) : defendSpot(w, pl, ph) ?? shapeSpot(w, pl, ph)`; `if (spot) return deadMove(w, pl, { target: clampToPitch(spot, 0.5), speedCap: vmax * 0.6 })`; today's code follows, each `return x` becoming `return deadMove(w, pl, x)` (the taker's too).
    5. `moveTarget` open play: after the loose-ball chasers, `const sp = setPieceRun(w, pl, vmax); if (sp) return sp`.
    6. `moveTarget`: today's run-in-behind `if` block becomes `if (pos.kind === "owned" && possSide === pl.side) { const rm = runMove(w, pl, w.player(pos.playerId)); if (rm) return rm; const ro = rotateMove(w, pl, w.player(pos.playerId), shape); if (ro) return ro }`, keeping today's role and order conditions inside `runMove`'s rule-0 body.
    7. `kickStyle`: each returned `errorScale` is multiplied by `longKickScale(w, d, restart)`.
    8. `decide()`: the five lines of the Cross-phase contacts table.
    9. `marksFor`'s filter also drops live `rotate` intents.

- [ ] **Step 4: Verify identity**

Run: `pnpm typecheck && pnpm --filter @touchline/sim-core exec vitest run --no-file-parallelism` — Expected: PASS (the P4 count plus the new cases).
Run the gate — Expected: PASS, maxDrift 0, loss unchanged from the P4 baseline.
Run: `pnpm --filter @touchline/schema exec vitest run && uv run --project python/analytics pytest python/analytics/tests -q` — Expected: PASS.

- [ ] **Step 5: Commit** — `"feat(sim-core): P5 scaffold — params blocks (off), setpiece/dead/roles streams, rotate intent, restart plan and set-piece state, setpiece.ts, seven step.ts and two decide.ts seams (identity)"` with the trailer.

---

### Task 2: Set-pieces diagnostic — report section, real targets, `--only setpieces`, P4 baseline (wave 0; opus)

**Files:**
- Create: `python/analytics/touchline_analytics/setpieces.py`, `python/analytics/touchline_analytics/rolemoves.py`, `python/analytics/tests/test_setpieces.py`, `docs/realism/p5-setpieces-baseline.md`
- Modify: `report.py` (`build` adds `setpieces_section` after duels when `"setpieces" in targets`; `--only` gains `"setpieces"`), `targets.py` (`HAND_BLOCKS` gains `"setpieces"`), `data/params/targets-idsse.json` (new `setpieces` block, `{label, real, lo, hi, fmt}` rows), `packages/calibrate/src/realism.ts` (`--only` accepts `"setpieces"`)

**Interfaces:**
- Produces: `match_setpieces(run: Path, roles: dict[str, str]) -> dict`, `match_rolemoves(run: Path, roles: dict[str, str]) -> dict`, `setpieces_section(ms: list[dict], t: dict) -> list[str]`, and the rows below by key.
- Definitions, ported from `sp_analysis.py` and `off_analysis.py` with frames and events as `passing.py` reads them:
  - **Snapshot** at the `set_piece` event's frame, in the restarting team's frame; kinds by `setPieceKind`'s rules. Box, six-yard box, rest defence (outfielders at u < 28), left up (defending outfielders at u < 17.5), tight (box defender within 2 m of an attacker), wall (defending outfielders 6–11.5 m from the ball within ±25° of the ball→goal-centre bearing).
  - **First contact:** the first non-taker within 1.5 m of the ball 0.3–5 s after the kick (taker excluded for 1 s); long = distance from the spot > 32 m; completion = first contact by the kicking side.
  - **Dead time:** from the frame the ball goes dead to the `set_piece` frame, per `deadKey`. Dead speed: mean outfield speed while dead.
  - **Shots ≤ 10 s** after a restart, per 100 restarts of the kind. Direct free kicks: a `shot` with `technique: "free_kick"`.
  - **Role moves:** the analysis episode definitions (`fb_overlap`, `fb_underlap_inversion`, `w_comes_inside`, `cm_drops_into_back_line`, `run_in_behind` with its wide-lane and beyond-the-line shares, `drop_to_receive`), at 5 Hz, per team-match.

| Key | Real | lo–hi | | Key | Real | lo–hi |
|---|---|---|---|---|---|---|
| `corner_att_box` | 5.49 | 4.8–6.2 | | `gk_long_share` | 0.48 | 0.40–0.56 |
| `corner_att_six` | 1.07 | 0.7–1.4 | | `gk_long_completion` | 0.49 | 0.40–0.58 |
| `corner_def_box` | 9.15 | 8.5–9.8 | | `gk_shots_against_per100` | 0.9 | 0–4 |
| `corner_tight` | 0.54 | 0.45–0.63 | | `keeper_fk_per_team` | 3.0 | 2.3–3.7 |
| `corner_def_up` | 0.02 | 0–0.2 | | `fk_central_shot_share` | 0.36 | 0.20–0.50 |
| `corner_rest` | 1.43 | 1.0–1.9 | | `corner_shots_per100` | 32.1 | 25–39 |
| `corner_delivery_completed` | 0.43 | 0.33–0.53 | | `dead_throw_in_s` | 13.5 | 11–16 |
| `fk_wide_att_box` | 3.76 | 3.2–4.4 | | `dead_goal_kick_s` | 22 | 19–25 |
| `fk_central_att_box` | 3.09 | 2.5–3.7 | | `dead_corner_s` | 33 | 30–36 |
| `fk_wide_rest` | 2.71 | 2.2–3.2 | | `dead_fk_att_s` | 42 | 37–47 |
| `fk_central_rest` | 2.27 | 1.8–2.8 | | `dead_fk_other_s` | 28 | 24–32 |
| `throw_att_rest` | 4.10 | 3.5–4.7 | | `dead_kickoff_s` | 70 | 62–78 |
| `wall_central_present` | 1.0 | 0.9–1.0 | | `dead_speed_mps` | 1.2 | 0.9–1.5 |
| `wall_central_players` | 2.46 | 2.0–3.0 | | `fb_overlap` | 13.9 | 11–17 |
| `wall_wide_present` | 0.76 | 0.6–0.9 | | `w_inside` | 61.9 | 52–72 |
| `wall_min_dist_m` | 9.76 | 8.6–10.0 | | `fb_invert` | 36.4 | 30–43 |
| `gk_opp_box` | 0.18 | 0–0.4 | | `run_in_behind` | 34.6 | 29–40 |
| `gk_opp_def_third` | 2.64 | 2.0–3.2 | | `run_wide_share` | 0.64 | 0.55–0.72 |
| `gk_cb_u` | −31.4 | −34 to −28 | | `run_beyond_share` | 0.26 | 0.18–0.34 |
| `throw_mates_10m` | 0.94 | 0.7–1.2 | | `cm_drop` | 44.7 | 38–52 |
| `throw_first_contact_m` | 9.5 | 8–11 | | `drop_to_receive`, `offsides_per_match`, `in_play_first15`, `in_play_last15` | 56.9, —, 0.62, 0.43 | info |
| `kickoff_nearest_opp_m` | 8.6 | 8.0–10 | | | | |

`source`: "realism v2 analysis 2026-10-13 (setpieces-report.md, offball-report.md T4/T5, gk-report.md G3, spec P5); IDSSE, 7 matches; aggregates only. Bands are plan 8e rulings." The section notes that `fk_central_shot_share` rests on 11 real free kicks and is judged on ≥ 64 matches.

- [ ] **Step 1: Write the failing tests** (`test_setpieces.py`, hand-built match folders in the style of `test_duels.py`)
  - `test_corner_snapshot_counts_box_six_rest_and_tight`: a corner with 6 attackers in the box (1 in the six-yard box), 2 kept back at u < 28, 9 defenders in the box of which 5 within 2 m of an attacker → `corner_att_box == 6`, `corner_att_six == 1`, `corner_rest == 2`, `corner_tight == 5/9`.
  - `test_frame_mirrors_after_half_time`: the same corner for home in the second half (x mirrored) gives the same counts.
  - `test_wall_counts_players_in_the_cone`: a central free kick with 3 defenders at 9 m within ±20° and one at 9 m at 40° → 3 players, present.
  - `test_goal_kick_first_contact_long_and_completion`: two goal kicks, first contacts at 40 m (own side) and 12 m → `gk_long_share == 0.5`, `gk_long_completion == 1.0`.
  - `test_dead_time_by_key`: a throw-in dead 12 s and an attacking free kick dead 40 s land in `dead_throw_in_s` and `dead_fk_att_s`.
  - `test_overlap_episode_needs_fb_outside_and_beyond_the_w`: an FB passing outside and beyond his W for 0.6 s counts once; inside him, none.
  - `test_setpieces_rows_have_targets`: every key of `setpieces_section` has a row in the block.

Run: `uv run --project python/analytics pytest python/analytics/tests/test_setpieces.py -q` — Expected: FAIL (`ModuleNotFoundError`).

- [ ] **Step 2: Implement** the modules, the report wiring, the block and `--only setpieces`. Run the pytest command and `pnpm --filter @touchline/calibrate exec vitest run test/cli.test.ts` — Expected: PASS.

- [ ] **Step 3: Measure the P4 baseline** (after the rebase onto the P4 merge)

Run: `pnpm realism --matches 16 --only setpieces --runs out/p5-t2-runs --out docs/realism/p5-setpieces-baseline.md && rm -rf out/p5-t2-runs`. Check by hand that `fk_central_shot_share` is 0 and `corner_att_box` is about 1–2.

- [ ] **Step 4: Commit** — `"feat(analytics): P5 set-pieces section — box set-ups, walls, rest defence, goal kicks, dead time, keeper restarts, direct free kicks, role moves against real aggregates; --only setpieces; P4 baseline"`.

---

### Task 3: S1/S4 — attacking box loading, rest defence, the run at the kick (wave 1; opus)

**Files:** Create `packages/sim-core/src/setpiece-attack.ts`, `packages/sim-core/test/setpiece-attack.test.ts`. Modify the **attacking set-piece seam**; `setAttack` values.

**Interfaces:**
- Consumes: `setPieceKind`, `roleSpot`, `ySignOf`, `framePoint`, `RestartPlan`, `SetPieceLive`, the four seam functions (Task 1).
- Produces (in `setpiece-attack.ts`):
  - `restKeepers(team: ReadonlyArray<PlayerState>, takerId: string, k: number, rng: Rng): string[]` (deepest by FB, CM, DM, CB order; at most the outfielders available minus the taker)
  - `attackTable(kind: SetPieceKind, s: Params["setAttack"]): RoleTable | null` (corner, fk_wide (u + `fkWideShiftU`), fk_central; null otherwise)
  - `holdSpot(spot: Vec2, side: Side, period: Period, holdBackM: number): Vec2`

- [ ] **Step 1: Write the failing tests**
  - `"corner spots: both CBs go up, the keeper to u -12, attackers hold 2 m short"`: `on`, a home corner at (52.5, 34) first half: the two CBs' `attackSpot` are within 0.1 m of (40, ±4) (spot 42 minus `holdBackM`), the GK's of (−12, 0); in the second half the mirror. Under `off` every `attackSpot` is null.
  - `"rest defence keeps the deepest FB or CM first, at u 20-25"`: `restKeepers` with k 1.4 over 1000 draws keeps 1 player 60 % ± 4 % and 2 players 40 % ± 4 %; the first kept is an FB when one exists, else a CM; with 7 outfielders and k 4.1 it never returns more than 6.
  - `"at an attacking-third throw-in only the rest keepers move"`: `attackSpot` is non-null for the rest keepers and null for everyone else.
  - `"the run at the kick: to the spot for 2 s at 10 Hz and 25 Hz"`: after `noteSetPiece`, an attacker's `setPieceRun` targets his spot until tick + 19 and is null at + 20 (dt 0.1); + 49 / + 50 (dt 0.04); it is null for the ball owner, the flight's winner and the defending side.
  - `"ten men: a sent-off CB leaves his spot empty and nothing throws"`: `planAttack` with one CB sent off returns keepers drawn from the 9 left.
  - `"in matches, corners load the box"` (seeds 7 and 9, `on` against `off`): attackers in the box at the `set_piece` frame of corners average ≥ 4 under `on`, against < 2.5 under `off`, with at least 8 corners per arm.

Run: `pnpm --filter @touchline/sim-core exec vitest run test/setpiece-attack.test.ts` — Expected: FAIL (module missing).

- [ ] **Step 2: Implement the module and fill the seam** (rulings 4, 6, 7). `planAttack` draws on `w.rng.setpiece` (rest keepers and their u, y) only under `setAttack.rule` 1. `noteSetPiece` sets `w.setPiece` (rule 1 only); `setPieceRun` clears it after `runWindowS` or on a possession change to the other side. Run the tests: Expected PASS.

- [ ] **Step 3: Measure** — 16 matches `--set setAttack.rule=1`, then `fkWideShiftU` 0 / 1.5 / 3. Commit the shift whose `fk_wide_att_box` is nearest 3.76. Record every S1/S4 row, `corner_shots_per100`, `corner_delivery_completed`, and from `--only duels` `aerial_duels_per_match`, `aerial_fouls_per_match`, `penalties_per_match`.

- [ ] **Step 4: Gate and commit** (PASS, drift 0) — `"feat(sim-core): S1 box loading and the run at the kick, S4 rest defence (setAttack.rule, off); corner box <a>, rest <r>, wide/central FK box <w>/<c>"`.

---

### Task 4: S2/S3 — defending corners and wide free kicks, walls (wave 1; opus)

**Files:** Create `packages/sim-core/src/setpiece-defend.ts`, `packages/sim-core/test/setpiece-defend.test.ts`. Modify the **defending set-piece seam**; `setDefend` values.

**Interfaces:**
- Consumes: Task 1's helpers and seams; `assignMarks`, `markTarget` (`offball.ts`, read only).
- Produces (in `setpiece-defend.ts`):
  - `wallSpots(ball: Vec2, defSide: Side, period: Period, n: number, jitter: ReadonlyArray<number>, s: Params["setDefend"]): Vec2[]`
  - `wallSize(kind: SetPieceKind, s: Params["setDefend"], rng: Rng): number`
  - `zonalSpot(i: number, defSide: Side, period: Period, s: Params["setDefend"]): Vec2`

- [ ] **Step 1: Write the failing tests**
  - `"a central wall: 3 or 4 at 9.15 m on the near-post line, never closer than 8.65 m"`: `wallSize("fk_central")` over 2000 draws is 3 or 4, each 50 % ± 3 %; `wallSpots` for a ball at (25, 5) home attacking +x: every spot is 8.65–9.15 m from the ball, their mean lies on the line from the ball to (52.5, 3.66 − 1) within 0.3 m, and neighbours are 0.6 m apart.
  - `"a wide wall 76 % of the time, 1 or 2 players"`: 4000 draws: none 24 % ± 2 %, otherwise 1 or 2.
  - `"walls at the edges stay on the pitch"`: a free kick at (49, 22): every wall spot has x ≤ 52.5 − 0.5 and |y| ≤ 33.5.
  - `"corners: nine in the box, man-marking within 12 m, the rest zonal, nobody up"`: `on`, a corner with 6 attackers in the box: every defending outfielder's `defendSpot` is in the box; the 6 attackers each have a marker whose spot is 1 m goal-side of him; the first unassigned defender's spot is (47, −5.5) in the defenders' frame; no defender spot at u < 17.5 (restarting frame). Second half: the mirror.
  - `"more attackers than defenders: the extras go unmarked, no throw"`: 8 attackers, 7 defenders available (3 sent off).
  - `"a wall member sent off or substituted while the ball is dead keeps the wall valid"`: removing a plan id leaves `defendSpot` defined for the others and null for nobody else.
  - `"in matches, central free kicks always have a wall"` (seeds 7, 9, 11, `on`): every central attacking free kick has ≥ 2 defending outfielders 8–10 m from the ball inside ±25°, with at least 3 such free kicks; `off` has a wall in fewer than half.

Run: `pnpm --filter @touchline/sim-core exec vitest run test/setpiece-defend.test.ts` — Expected: FAIL.

- [ ] **Step 2: Implement and fill the seam** (rulings 8, 9). `planDefend` draws wall size, members, jitter and the outlet on `w.rng.setpiece`. Run the tests: Expected PASS.

- [ ] **Step 3: Measure** — 16 matches `--set setDefend.rule=1` and with `setAttack.rule=1` too. Record every S2/S3 row, `corner_shots_per100`, `corner_delivery_completed` and the gate's `goals` and `corners`.

- [ ] **Step 4: Gate and commit** — `"feat(sim-core): S2 corner and wide free-kick defence (man within 12 m, zonal six-yard line), S3 walls (setDefend.rule, off); corner def box <d>, tight <t>, central wall <w>"`.

---

### Task 5: S5–S7 — goal kicks, throw-ins, kickoffs (wave 1; sonnet)

**Files:** Create `packages/sim-core/src/setpiece-shapes.ts`, `packages/sim-core/test/setpiece-shapes.test.ts`. Modify the **restart-shape seam**; `setShapes` values.

**Interfaces:**
- Consumes: Task 1's helpers; `supportSpot`, `assignMarks`, `markTarget` (read only).
- Produces: `outsideBox(spot: Vec2, kickerSide: Side, period: Period): Vec2`; `kickoffLegal(spot: Vec2, side: Side, period: Period, restarting: boolean): Vec2`; `throwShortIds(team: ReadonlyArray<PlayerState>, takerId: string, at: Vec2, n: number): string[]`.

- [ ] **Step 1: Write the failing tests**
  - `"goal kicks: the real build-up shape, opponents outside the box"`: `on`, a home goal kick first half: the CBs' spots are (−31.5, ±11); every away player's spot satisfies u > −35.5 (home frame) or |y| > 20.66; `outsideBox((-45, 5))` = (−35.5, 5). Second half: the mirror.
  - `"kickoffs: the real shapes, own half, 9.15 m"`: every restarting player's spot has u ≤ 0, every defender's spot is ≥ 9.15 m from (0, 0) and u ≥ 0 in the restarting frame; the restarting CBs at (−17, ±8.4).
  - `"throw-ins: three nearest come short to about 10 m and are marked"`: the 3 nearest outfield teammates (not the GK) have spots 9–11 m from the throw; their nearest defending opponents' spots are within 3 m of them; nobody else gets a spot.
  - `"a throw-in at the halfway line near the touchline keeps spots on the pitch"`.
  - `"in matches, opponents leave the box at goal kicks"` (seeds 7, 9; `on` against `off`): opponents inside the box at the goal-kick `set_piece` frame average < 0.4 under `on`, ≥ 1 under `off`, with ≥ 20 goal kicks per arm.

Run the file — Expected: FAIL.

- [ ] **Step 2: Implement and fill the seam** (ruling 10; no draws). Run: Expected PASS.

- [ ] **Step 3: Measure** — 16 matches `--set setShapes.rule=1`. Record `gk_opp_box`, `gk_opp_def_third`, `gk_cb_u`, `gk_long_share`, `gk_shots_against_per100`, the throw rows, `kickoff_nearest_opp_m`, and the gate's `throw_ins` and `goal_kicks`.

- [ ] **Step 4: Gate and commit** — `"feat(sim-core): S5 goal-kick build-up and the box law, S6 throw-in support and marking, S7 kickoff shapes and 9.15 m (setShapes.rule, off); GK opp box <b>, long <l>"`.

---

### Task 6: S8 — restart timing, walking into place, the taker's pause (wave 1; opus)

**Files:** Create `packages/sim-core/src/deadball.ts`, `packages/sim-core/test/deadball.test.ts`. Modify the **dead-ball seam**; `deadBall` values.

**Interfaces:**
- Consumes: `deadKey`, `RestartPlan`, the four dead-ball seams (Task 1).
- Produces (in `deadball.ts`):
  - `restartDelayS(key: DeadKey, minute: number, d: Params["deadBall"], rng: Rng): number`
  - `settleS(kind: SetPieceKind, attacking: boolean, d: Params["deadBall"], rng: Rng): number`
  - `walkCap(distM: number, secondsLeft: number, walkMps: number, vmax: number): number`

- [ ] **Step 1: Write the failing tests**
  - `"lognormal delays at the real medians"`: 4000 draws per key at minute 45 with `lateGrowth` 0: each median within 4 % of `medianS`, the throw-in p25/p75 within 15 % of 8 and 20 s; nothing below `minS`.
  - `"delays lengthen through the match and keep the median"`: with `lateGrowth` 0.6, the median at minute 85 is above the median at minute 5 by a factor 1.65–1.80 (exact 1.727); the median over uniform minutes stays within 5 % of `medianS`.
  - `"free kicks split by the attacking third"`: a free kick at u 30 uses `free_kick_att`; at u 0, `free_kick`; a penalty keeps the old `restart`-stream draw (its delay equals the rule-0 delay for the same state).
  - `"players walk at 1-1.5 m/s and arrive by their deadline"`: `walkCap(5, 20, 1.2, 8)` = 1.2; `walkCap(30, 10, 1.2, 8)` = 3; `walkCap(80, 1, 1.2, 8)` = 6.4.
  - `"the taker pauses 0.5-1 s on the spot (10 Hz and 25 Hz)"`: `on`, the taker on the spot at the resume tick: no `set_piece` before + 5 ticks (dt 0.1) / + 13 (dt 0.04); one by + 10 / + 25; the phase is `restart` throughout.
  - `"a taker sent off during the pause: the restart is re-picked and still taken"`.
  - `"rule off keeps today's delay and speeds"`: `restartDelayTicks` and `deadMove` under `off` equal the old values on the same state.
  - `"in a match, dead-ball speed rises and throw-ins restart faster"` (seed 7, `on` against `off`): mean outfield speed while dead ≥ 0.8 m/s (`off` < 0.5); median throw-in dead time 11–16 s.

Run the file — Expected: FAIL.

- [ ] **Step 2: Implement and fill the seam** (ruling 11; all draws on `w.rng.dead`). Run: Expected PASS.

- [ ] **Step 3: Measure and set `lateGrowth`** — 16 matches `--set deadBall.rule=1,deadBall.lateGrowth=<g>` for g in 0, 0.4, 0.8. Pick g whose `in_play_first15` / `in_play_last15` ratio is nearest 0.62 / 0.43 and commit it. Record every dead row, `dead_speed_mps`, the bands' `dead_m_per_min`, and the gate's `in_play_share` (expected to rise; Task 14 retunes it).

- [ ] **Step 4: Gate and commit** — `"feat(sim-core): S8 lognormal restart delays at real medians, free_kick split, arrival deadlines and walking, taker pause, late lengthening (deadBall.rule, off); in play <p>, dead speed <s>"`.

---

### Task 7: G3 — keeper free kicks, goal-kick short/long choice, long-kick completion (wave 2; sensitive `decide.ts`, approved; opus)

**Files:** Modify the **keeper-restart seam** (`step.ts`), the **P5 goal-kick block** (`decide.ts`), `keeperRestarts` values. Create `packages/sim-core/test/keeper-restarts.test.ts`.

**Interfaces:**
- Consumes: `keeperTakes`, `longKickScale`, `restartKindShift`, `RestartPlan` (Task 1); Task 5's shapes (merged).
- Produces: nothing new for later tasks.

- [ ] **Step 1: Write the failing tests**
  - `"the keeper takes own-third free kicks"`: `on` with `fkShare` 1: a home free kick at u −30 is taken by the home GK (`set_piece.player_id`); at u −10 by an outfielder; `fkShare` 0 never. `planKeeper` draws once per restart (`dead` stream) into `keeperTaker`, so `takerFor` is stable across ticks; with the GK sent off an outfielder takes it.
  - `"a keeper free kick uses the build-up row"`: `keeperRestart(w)` is true for it (precondition: false under `off`).
  - `"long shift moves goal kicks long"`: on a goal-kick fixture with targets at 15 m and 45 m, the share of `long_pass` + `switch` in `actionProbs` rises with `longShift` 1 against 0; `restartKindShift` is 0 for open play and for an outfielder's free kick.
  - `"long goal kicks get the long error scale"`: `longKickScale` is `longErrorScale` for a goal kick to a target ≥ 32 m, 1 for one at 20 m and for open-play passes.
  - `"rule off: the decision is unchanged"`: `decide` under `off` equals the rule-0 decision on a goal-kick fixture (same rng start, same `actionProbs`).

Run the file — Expected: FAIL.

- [ ] **Step 2: Implement** (rulings 12, 13; the free-kick share draws on `w.rng.dead`). Run: Expected PASS.

- [ ] **Step 3: Measure and set the values** — 16 matches `--set setShapes.rule=1,keeperRestarts.rule=1`: sweep `longShift` 0 / 0.75 / 1.5 toward `gk_long_share` 0.48; `fkShare` toward `keeper_fk_per_team` 3.0; then `longErrorScale` 1 / 1.5 / 2 toward `gk_long_completion` 0.49 (record how far error alone gets: ruling 12). Commit the three. Record the G3 rows, the passing section's `long_share`, switches, keeper passes per team-match, and `aerial_duels_per_match`.

- [ ] **Step 4: Gate and commit** — `"feat(sim-core): G3 keeper own-third free kicks, goal-kick long shift, long-kick error scale (keeperRestarts.rule, off); long share <l>, completion <c>, keeper FK <k>/team"`.

---

### Task 8: S9 — direct free kicks (wave 2; sensitive `decide.ts`, approved; opus)

**Files:** Modify the **P5 direct-free-kick block** (`decide.ts`), `directFk` values. Create `packages/sim-core/test/direct-fk.test.ts`.

**Interfaces:**
- Consumes: `restartShot`, `RestartShot` (Task 1); `xgOf` (read only); Tasks 3 and 4 merged (box and wall).
- Produces: `restartShot` as Task 1 typed it (P6 reads it; Cross-phase contacts).

- [ ] **Step 1: Write the failing tests**
  - `"a central attacking free kick may be shot"`: `on`, a free kick at (25, 4) home first half: `restartShot` returns `available: true`; at (25, 25) (wide), (10, 4) (not attacking third) and (17, 0) beyond 35 m it returns null; second half at (−25, 4): available.
  - `"the free-kick xG ignores the wall and adds xgLogit"`: `xg` equals `sigmoid(logit(xgOf(p, "home", "first_half", pos, false, 0)) + xgLogit)` for xgLogit 0 and 0.5, with three wall players in the cone.
  - `"the shift moves the shot share"`: over 2000 decisions on that fixture, the shot share with `shotShift` 1 exceeds that with 0; under `off` the share equals today's.
  - `"a direct free kick is a shot event with technique free_kick"`: in a forced fixture (`shotShift` 10), the restart produces a `shot` with `technique: "free_kick"` and recorded `xg` equal to `restartShot(...).xg`.

Run the file — Expected: FAIL.

- [ ] **Step 2: Implement** (ruling 14). Run: Expected PASS.

- [ ] **Step 3: Measure and set the values** — 16 matches `--set setAttack.rule=1,setDefend.rule=1,directFk.rule=1` (central free kicks are rare: run 32 matches, deleting folders): sweep `shotShift` 0 / 1 / 2 toward `fk_central_shot_share` 0.36, then `xgLogit` toward a mean direct-free-kick xG of 0.06 (read from the shot events). Commit both. Record the direct-free-kick blocked share (the wall in `planShot`), conversion, and the gate's `shots`, `goals` and `blocked_share`.

- [ ] **Step 4: Gate and commit** — `"feat(sim-core): S9 direct free-kick shots from central attacking free kicks with a free-kick xG offset (directFk.rule, off); shot share <s>, mean xG <x>"`.

---

### Task 9: A6 — runs in behind reshaped, FB overlaps (wave 1; opus)

**Files:** Create `packages/sim-core/src/runs.ts`, `packages/sim-core/test/runs.test.ts`. Modify the **role-run seam**; `roleMoves.overlap` and `roleMoves.run` values.

**Interfaces:**
- Consumes: `runMove` (Task 1), `lastDefenderAttackX` (read only).
- Produces (in `runs.ts`): `holdLineTarget(lastDefU: number, y: number, wide: boolean, side: Side, period: Period, r: Params["roleMoves"]["run"]): Vec2`; `overlapTarget(carrier: Vec2, side: Side, period: Period, o: Params["roleMoves"]["overlap"]): Vec2`; `overlapEligible(fb: PlayerState, carrier: PlayerState, period: Period, o: Params["roleMoves"]["overlap"]): boolean`.

- [ ] **Step 1: Write the failing tests**
  - `"runners hold one metre onside and re-aim as the line moves"`: `holdLineTarget(20, 5, false, "home", "first_half")` has x 19; with `wide` true, |y| ≥ 14 on his side; a live run's target follows the last defender from u 20 to 24 (x 19 → 23) over ticks.
  - `"runs are triggered by a forward-facing CM or AM with space behind"`: a CM carrier moving forward at 2 m/s with the line at u 30 can trigger; standing still, or with the line at u 45, never (forced rate fixture, 200 seeds).
  - `"role weights: wingers run more, strikers less"`: over 400 forced seeds the W:ST trigger ratio is within 15 % of 1.4 / 0.45.
  - `"an overlap goes outside and beyond the carrier at up to 5 m/s"`: a W at (10, 25) on the ball, FB at (2, 22) → eligible; `overlapTarget` = (16, 28); the FB 20 m behind or with the carrier in his own third → not eligible; no same-side W or CM (3-5-2 wing-back fixture) → never. The intent is `run_in_behind` and the event `off_ball_run` kind `overlap`.
  - `"rule off moves runs exactly as before"`: `runMove` under `off` returns today's target and makes the same `movement` draw.
  - `"in matches, fewer and wider runs, and overlaps exist"` (seeds 7, 9; `on` against `off`): run starts per team-match fall; the wide share rises; overlaps ≥ 3 per team-match; at dt 0.1 and 0.04.

Run the file — Expected: FAIL.

- [ ] **Step 2: Implement and fill the seam** (ruling 15; draws on `w.rng.roles`). Run: Expected PASS.

- [ ] **Step 3: Measure and tune** — 16 matches `--set roleMoves.runRule=1`: tune `runs.runInBehindRatePerS` scale via `run.roleWeight` (values only) toward `run_in_behind` 34.6 and `overlap.ratePerS` toward `fb_overlap` 13.9. Record `run_wide_share`, `run_beyond_share`, `offsides_per_match` (ruling 25), shots after a through ball (`--only passing`) and `penalties_per_match`.

- [ ] **Step 4: Gate and commit** — `"feat(sim-core): A6 runs hold the line, wider and from W/FB, FB overlaps (roleMoves.runRule, off); runs <r>, wide <w>, beyond <b>, overlaps <o>, offsides <x>"`.

---

### Task 10: A6 — W comes inside, FB inversion, CM drops between the CBs (wave 1; sonnet)

**Files:** Create `packages/sim-core/src/rotate.ts`, `packages/sim-core/test/rotate.test.ts`. Modify the **rotation seam**; `roleMoves.inside`, `invert`, `cmDrop`, `jogMps`.

**Interfaces:**
- Consumes: `rotateMove`, the `rotate` intent (Task 1); `w.transition` (P4).
- Produces (in `rotate.ts`): `insideTarget(shape: Vec2, ySign: number, y: number): Vec2`; `invertTarget(shape: Vec2, wY: number, inM: number, lastOwnU: number, side: Side, period: Period, aboveLastM: number): Vec2`; `dropTarget(cbs: ReadonlyArray<Vec2>, ballY: number, side: Side, period: Period): Vec2`.

- [ ] **Step 1: Write the failing tests**
  - `"targets"`: `insideTarget((25, 22), 1, 6)` = (25, 6); `invertTarget` with W at y 26, inM 7, own last u −20 and shape u −10 gives |y| 19 and u ≥ −5; `dropTarget` between CBs at (−35, ±10) gives (−34, 0), and two CBs 4 m apart at (−35, ±2) with the ball at y 20 give (−34, 5) (3 m outside the CB on the ball's side).
  - `"the W-FB pair is gated both ways"`: with the W rotating inside, the FB's `rotateMove` is null; with the FB inverted, the W can still go inside and then the FB's rotation ends.
  - `"the CM drop lives 5 s after a win in the own third, at 10 Hz and 25 Hz"`: forced rate; possible at win + 49 ticks, not + 50 (dt 0.1); + 124 / + 125 (dt 0.04); the ball at u 0: never; `transition.rule` 0: never.
  - `"rotations are jogs"`: every `rotateMove` speed cap ≤ `jogMps`.
  - `"second half mirrors"`: the drop and inversion targets mirror.
  - `"rule off returns null"`.
  - `"in matches, rotations appear"` (seeds 7, 9; `on`): W inside ≥ 20, inversions ≥ 10, CM drops ≥ 15 per team-match (engine intent starts).

Run the file — Expected: FAIL.

- [ ] **Step 2: Implement and fill the seam** (ruling 16; `rotate` events `off_ball_run` kinds `inside`, `invert`, `cm_drop`; draws on `w.rng.roles`). Run: Expected PASS.

- [ ] **Step 3: Measure and tune** — 16 matches `--set roleMoves.rotateRule=1`: tune the three rates toward 61.9, 36.4, 44.7 (frame-measured rows), at most 3 rounds. Record the gate's `width_poss_m`, `support_15m`, `free_space_m`, and `drop_to_receive`.

- [ ] **Step 4: Gate and commit** — `"feat(sim-core): A6 W comes inside, FB inversion, CM drops between the CBs (roleMoves.rotateRule, off); inside <i>, invert <v>, drops <d>"`.

---

### Task 11: Carry — zonal marking with a free-space cap, landing-spot marking and reaction (wave 2; opus)

**Files:** Modify `packages/sim-core/src/offball.ts` (append), the **P4 marking seam** (taken over from plan 8d Task 8), `marking.laneShare`, `maxGapM`, `landing*`. Create `packages/sim-core/test/marking-p5.test.ts`.

**Interfaces:**
- Consumes: `markSpot`, `laneMarkTarget`, `stepsOut` (P4).
- Produces (in `offball.ts`): `capGap(spot: Vec2, attacker: Vec2, maxGapM: number): Vec2`; `landingTarget(defs: ReadonlyArray<PlayerState>, attackers: ReadonlyArray<PlayerState>, defSide: Side, period: Period): { defId: string; attackerId: string } | null`. Both are applied inside `markSpot` (the reaction too: ruling 18), so no new call site is needed.

- [ ] **Step 1: Write the failing tests**
  - `"the cap pulls the lane spot to within maxGapM of the attacker"`: a lane spot 9 m from the attacker with `maxGapM` 5 moves along the line to 5 m; one 3 m away is unchanged; `maxGapM` 0 never moves it.
  - `"landing-spot marking: the nearest CB marks the most advanced attacker tightly while their keeper has it"`: `on` with `landingRule` 1, opponent GK in hands: the CB nearest the opponents' most advanced outfielder gets the goal-side spot at 1 m, weight 1; with an opponent CM on the ball in midfield, he does not.
  - `"reaction: during a high flight the winner's marker within 10 m goes to the contact"`; 14 m away, or a ground pass: his normal mark spot.
  - `"second half mirrors"`; `"rule off marks exactly as P4"` (`markSpot` under `off` equals P4's on the same fixture, for both `marking.rule` values).
  - `"in matches, free space falls with the cap"` (seeds 7, 9; `marking.rule` 1): median free space with `maxGapM` 5 is lower than with 0, with ≥ 1000 samples each.

Run the file — Expected: FAIL.

- [ ] **Step 2: Implement** (rulings 17, 18). Run: Expected PASS.

- [ ] **Step 3: Measure and set the values** — 16 matches with every wave-1 rule and Task 7 on, `marking.rule=1`: sweep `maxGapM` 4 / 5 / 6 / 8 toward `free_space_m` 6.0 with `tight_share` in 0.06–0.12 and `ball_pressure_m` |z| < 3; then `landingRule` 0 against 1. Commit `maxGapM` (and `laneShare` if it moved). Record `aerial_duels_per_match` and `aerial_fouls_per_match` before and after landing marking, `gk_long_completion`, `penalties_per_match`, and the gate's `free_space_m`, `ball_pressure_m`, `fouls`.

- [ ] **Step 4: Gate and commit** — `"feat(sim-core): zonal marking capped at maxGapM, landing-spot marking and reaction for long balls (marking.landingRule, off); free space <f>, tight <t>, aerial duels <a>"`.

---

### Task 12: Carry — the pause and its end, recovery timing, press trigger lifts (wave 2, after Task 11; sonnet)

**Files:** Modify `packages/sim-core/src/transition.ts`, `packages/sim-core/src/press.ts`, the **P4 transition seam** and **P4 team-press seam** (taken over from plan 8d Tasks 6 and 7), `transition` and `press` values. Create `packages/sim-core/test/transition-p5.test.ts`.

**Interfaces:**
- Consumes: `TransitionState.speeds` (Task 1); `noteLoss`, `transitionMove`, `pauseTarget` (P4).
- Produces (in `transition.ts`): `pauseCap(speedAtLoss: number, t: Params["transition"]): number`; `pauseEndCap(sinceS: number, pauseCapV: number, baseCap: number, t: Params["transition"]): number`.

- [ ] **Step 1: Write the failing tests**
  - `"the pause caps at 0.87 of the speed at the loss"`: `on` with `pauseRule` 1: a far non-joiner moving 4 m/s at the loss gets cap 3.48 during the pause; `noteLoss` records speeds only under `pauseRule` 1.
  - `"the pause ends on a ramp (10 Hz and 25 Hz)"`: at pause end + 0 the cap is the pause cap, at + 0.25 s halfway to base, at + 0.5 s base's, with base's target throughout; ticks per `Math.round(s / dt)` at dt 0.1 and 0.04.
  - `"pauseRule 0 keeps P4's pause"`: `transitionMove` under `pauseRule` 0 equals P4's on the same fixture.
  - `"press lifts stay multiplicative"`: `pressLift(true, true)` with lifts 3 and 3 = 9.

Run the file — Expected: FAIL.

- [ ] **Step 2: Implement** (ruling 20). Run: Expected PASS.

- [ ] **Step 3: Tune** — 16 matches, P4 switches as shipped plus `transition.pauseRule=1` and Task 11's marking:
  1. `pause_speed_ratio` toward 0.87; recovery values toward every `recover_*` row (`recover_pre` ≤ 0.03), at most 3 rounds.
  2. Lifts (ruling 21): `backToGoalLift`, `ownThirdLift` toward `lift_back_to_goal` 2.08 and `lift_own_third` 1.97, `rateScale` toward `press_episodes_per90` 405. **If `press.rule` shipped 0**, run with `press.rule=1` here and record that Task 14 switches it on.
  3. Commit the values. Record the transition and pressing rows, `distance_km`, and the gate's `ball_pressure_m`, `fouls`, `distance_km_median`.

- [ ] **Step 4: Gate and commit** — `"feat(sim-core): pause capped at 0.87 of the speed at the loss with a 0.5 s ramp out (transition.pauseRule, off); recovery and press-lift values; pause ratio <q>, lifts <b>/<o>, episodes <e>"`.

---

### Task 13: Carry — release median, P3's deferred tests (wave 1; sonnet)

**Files:** Modify `packages/sim-core/src/release.ts`, the **P3 release seam** (taken over from plan 8d Task 9), `release.freeS`. Tests: create `packages/sim-core/test/release-p5.test.ts`, `packages/sim-core/test/identity.test.ts`; append to `packages/sim-core/test/distribution.test.ts` and `packages/sim-core/test/offball.test.ts`; fix `packages/calibrate/test/pass-length.test.ts`.

**Interfaces:**
- Consumes: `releaseDelayS(nearestOppM, p, rng)` (P3/P4).
- Produces: the same signature; under `release.freeRule` 1 the free base is `rng.range(freeS[0], freeS[1])`.

- [ ] **Step 1: Write the failing tests**
  - `release-p5.test.ts`: `"freeRule 1 draws the free base from freeS"`: 20 000 draws with `freeS` [0.5, 1.5], no tail, no cap: min ≥ 0.5, max ≤ 1.5, median 1.0 ± 0.03; under `freeRule` 0 the draws equal today's for the same rng; pressed draws unchanged under both.
  - `distribution.test.ts` (deferred): `"pPunt 0 never punts, 1 always punts"` (`puntLogit` −50 / +50, 200 hands releases each); `"a throw is never shorter than the throw lower bound and a punt is struck by foot"`.
  - `identity.test.ts` (deferred): `"every P3 rule at 0 gives the pre-P3 engine bit for bit at unit level"`: for each of `firstTick`, `choice`, `release`, `cross`, `through`, `distribution`, a 300-tick state under that rule 0 equals the same state with the rule's other fields perturbed (they are not read).
  - `offball.test.ts` (deferred): `"the support hold carries across ticks for the same carrier at dt 0.1 and dt 0.04"`.
  - `pass-length.test.ts`: the EventType parse reads the whole union (to its terminating line), not to the first blank line; a fixture source with a blank line inside the union still yields every type.

Run: `pnpm --filter @touchline/sim-core exec vitest run test/release-p5.test.ts test/distribution.test.ts test/identity.test.ts test/offball.test.ts && pnpm --filter @touchline/calibrate exec vitest run test/pass-length.test.ts`
Expected: FAIL in `release-p5.test.ts` and `pass-length.test.ts` only. A deferred case that fails is a real bug: stop and report it.

- [ ] **Step 2: Implement** (ruling 22). Run: Expected PASS.

- [ ] **Step 3: Measure and set `freeS`** — 16 matches `--only passing --set release.freeRule=1,release.freeS=<lo,hi>` for [0.5, 1.6], [0.6, 1.9], [0.7, 2.2]: pick the one with `release_median_s` nearest 1.40, `release_over3` in band and `release_median_lt2_s` in 0.2–0.7; commit it. Record `passes_per_match` (band 776–956).

- [ ] **Step 4: Gate and commit** — `"feat(sim-core): release free base from release.freeS (release.freeRule, off), P3 deferred tests, pass-length EventType parse; release median <m>, passes <p>"`.

---

### Task 14: Switch on, recalibrate, gate, baseline, re-pin, deep report, Results: P5 (wave 3; opus)

**Files:**
- Modify: `params.ts` (the switches to 1, and `marking.rule` 1; `press.rule` 1 if P4 shipped it 0), `params.test.ts` ("ship switched off" → "ship switched on"), `calibrate/src/knobs.ts`, the spec (`## Results: P5 (date)`)
- Create: `packages/sim-core/test/setpieces-targets.test.ts`
- Regenerate: `data/params/touchline-params.json`, `data/params/realism-baseline.json`, `docs/realism/realism-report.md`, `docs/realism/realism-deep-report.md`, the stats and manager goldens, and the seed pins by each file's rule (as plan 8d Task 10's list)

**Interfaces:** Consumes every task's recorded values. Produces the knobs of ruling 27.

- [ ] **Step 1: Switch on.** Set the eleven P5 switches and `marking.rule` to 1 (and `press.rule` per ruling 21). Flip the params test. Run the sim-core suite; for each red test: an exact-statistic test the P5 behaviours move (restart counts, `positioning`, `passing-targets`, `keeper.test`) — check the new value is football-plausible, update it and name it in the commit; an M10 test — ruling 23; never loosen a real-target bound.

- [ ] **Step 2: Knobs.** Add ruling 27's knobs with `what` naming the statistic; change `restart_scale` and `decision_scale`. Run: `pnpm typecheck && pnpm --filter @touchline/calibrate exec vitest run test/tune.test.ts` — Expected: PASS.

- [ ] **Step 3: Recalibrate** (background): `pnpm calibrate --from data/params/touchline-params.json --out data/params/touchline-params.json --matches 24 --rounds 1 --workers <N>`. Record the loss and every knob that moved, especially `restart_scale`, `decision_scale`, `shot_bias`, `cross_shift`, `marking_weight` and the six new knobs.

- [ ] **Step 4: Re-baseline and gate.** `UPDATE_REALISM_BASELINE=1 pnpm --filter @touchline/calibrate exec vitest run test/realism-gate.test.ts --disableConsoleIntercept`, then the gate. Expected: PASS, held-out loss < 30. **If not, STOP and diagnose** (16-match `pnpm realism` and `--only setpieces` on the candidate; the top |z| statistics; ablate each P5 switch), report to the user, and offer ruling 28's order. Also print the spatial statistics' z and, if Question 1 is answered yes, require |z| < 3 on them.

- [ ] **Step 5: Compare the setpieces section before and after the tuner** (16 matches each). Any row that went from MET to NOT MET because of a knob is recorded with that knob's move.

- [ ] **Step 6: Real-target test** (`setpieces-targets.test.ts`; calibrated params, test teams, seeds `[7, 9, 11, 13]` fixed by this file's rule; one cached measure pass as `passing-targets.test.ts`):

  | Case | Bound |
  |---|---|
  | `"about 5.5 attackers in the box at corners (S1)"` | 4.5–6.5 |
  | `"about 9 defenders in the box at corners (S2)"` | 8–10 |
  | `"central free kicks have a wall (S3)"` | ≥ 0.9 of them |
  | `"opponents stay out of the box at goal kicks (S5)"` | ≤ 0.4 |
  | `"about half of goal kicks go long (G3)"` | 0.40–0.56 |
  | `"keepers take about 3 free kicks per team-match (G3)"` | 2.0–4.0 |
  | `"throw-ins restart in about 13.5 s (S8)"` | median 11–16 |
  | `"overlaps, inside moves, runs and CM drops near real (A6, intent starts)"` | 11–17, 52–72, 29–40, 38–52 per team-match |

  Each failing case becomes `it.fails` (`NOT MET:`, measured value); bounds unchanged.

- [ ] **Step 7: Reports.** `pnpm realism --matches 64 --runs out/p5-deep-runs --out docs/realism/realism-deep-report.md && rm -rf out/p5-deep-runs`; `pnpm realism --matches 16 --runs out/p5-report-runs --out docs/realism/realism-report.md && rm -rf out/p5-report-runs`. Record every setpieces row (S9 and penalties only from the 64), the duels rows `aerial_duels_per_match`, `aerial_fouls_per_match`, `penalties_per_match`, the transition and press rows, the release rows, C1–C4, physical bands (dead m/min), territory and distance; the M10 values (ruling 23). Manager A/B for information: `pnpm managers:ab --arms none,rules --seeds 40 --out out/p5-ab --runs out/p5-ab-runs`, then delete the runs.

- [ ] **Step 8: Re-pin and goldens** (`find_test_seed.py`, each seed by its file's rule; regenerate goldens; check diffs are plausible).

- [ ] **Step 9: Run everything.** `pnpm test -- --no-file-parallelism && pnpm typecheck && uv run --project python/analytics pytest python/analytics/tests && uv run --project services/agents pytest services/agents/tests` — Expected: PASS (a red scenario 9-of-10 test: nudge its script, never the bound).

- [ ] **Step 10: Results and commit.** `## Results: P5 (YYYY-MM-DD)` in the style of Results: P3: switched on and values; deviations (rulings 3, 5–18, 20–22 and measurement changes); calibration and the pre/post-tuner comparison; gate; P5 targets (64 matches) MET or NOT MET against Task 2's baseline; the P4 carry-overs; C1–C4, physical bands and distance; real-target tests and M10; manager A/B; gaps outside P5; **"Handed to P6"**: the rows P6 must re-judge (`fk_central_shot_share`, `corner_shots_per100`, `gk_long_completion`, `aerial_duels_per_match`) and the values P6 may re-set (`directFk.shotShift`, `keeperRestarts.longErrorScale`). Commit `"feat: realism v2 P5 on — set-piece shapes, walls, rest defence, restart timing, keeper restarts, direct free kicks, role moves, zonal marking and P4 carry-overs; recalibrated, re-baselined, re-pinned"` with the trailer. Merge to `main` only after the user has seen the results; then tell the P6 controller the merge commit to rebase onto.

---

## Questions for the user

Written with the recommended option; each can be changed before its task starts.

1. **The gate's spatial blind spot.** `GATE_Z` checks only `SCALAR_KEYS`, so `ball_pressure_m` reached z +4 unflagged in P4. (a) Add the seven spatial statistics to the |z| < 3 check from Task 14 on (tightens the gate; may block the merge). (b) Print their z in the gate and judge them by hand. (c) Leave as is. **Recommend (a)**: P5's marking and set-piece shapes move exactly these statistics; if it blocks, the fallback order applies.
2. **Gate fallback order** (ruling 28). (a) Rotations, runs, zonal marking, pause, keeping S1–S9 and G3. (b) Set-piece timing (S8) first, since it moves `in_play_share`. (c) Decide at the time. **Recommend (a)**: the set pieces are the phase's core and the most visible change in the replay.
3. **Overlap runners as pass targets.** (a) Reuse the `run_in_behind` intent kind, so P3 D4 offers through balls with no `decide.ts` change. (b) A new `overlap` intent plus a one-line `decide.ts` change in `throughTargets` (a further sensitive edit). (c) No through-ball option for overlaps. **Recommend (a)**: no new sensitive edit, and the event still names the move.
4. **Penalties if still short** (0.2 against 0.43 after P4). (a) Record NOT MET; box loading and runs are the only route (consistent with your P4 ruling). (b) Allow Task 14 a narrow knob on the box foul factor. (c) Defer to P6, where headers add box duels. **Recommend (a).**
5. **Release median vs the `decision_scale` knob.** (a) Own free base `release.freeS`, with `decision_scale` scaling it in a narrowed 0.8–1.2. (b) Free `decision_scale` entirely from the release (passes per match then has no knob). (c) Leave it; record NOT MET. **Recommend (a)**: it keeps a passes lever while stopping the tuner pushing the median to 2.0 s.
6. **Offside free kicks** (about 11 per match more free kicks than fouls). (a) Record only; A6's hold-the-line runs should cut them. (b) Add an offside target and tune run timing to it in Task 9. **Recommend (a)**; revisit if Task 9's measurement shows no fall.

No carry-over was dropped: all fit as Tasks 11–13 and rulings 19, 23–25.

## Self-review

**Spec coverage.**

| Spec item | Where |
|---|---|
| A6 overlap, W inside / FB inversion, runs in behind (60 % wide, hold at lastDef − 1), CM drops, drops are jogs | Tasks 9, 10 (rulings 15, 16) |
| S1 corner targets, hold 2 m and run, box counts 3.8 / 3.1 | Task 3 (ruling 6) |
| S2 nine in the box, man within 12 m goal-side 1 m, zonal six-yard line, nobody up | Task 4 (ruling 8) |
| S3 walls 3–4 central, 1–2 wide 76 %, −0.5 m jitter | Task 4 (ruling 9) |
| S4 rest defence counts, deepest FB/CM first | Task 3 (ruling 7) |
| S5 goal kicks: box law, build-up, 2.6 in the defensive third | Task 5 (ruling 10) |
| S6 throw-ins: 3 nearest at about 10 m, marked | Task 5 |
| S7 kickoffs: real shapes, 9.15 m | Task 5 |
| S8 lognormal medians, `free_kick` split, deadlines and walking, taker pause, late lengthening, `in_play_share` retuned | Task 6 (ruling 11), Task 14 (`restart_scale`) |
| G3 keeper free kicks, short/long choice in `decide.ts`, long completion 49 % | Task 7 (rulings 12, 13) |
| S9 restart shot logit, free-kick xG adjustment, 36 % | Task 8 (ruling 14) |
| Checks: `setpiece.ts` unit tests per restart type; box counts, walls, rest defence; corner shots 32 per 100; role-move counts | Tasks 1, 3–5 tests; Task 2 rows; Task 14 test and deep report |
| Carry: zonal marking with a free-space lever | Task 11 (ruling 17) |
| Carry: aerial-duel volume | Task 11 (ruling 18), Tasks 3, 5, 7 measure it |
| Carry: penalties | Ruling 19, Question 4 |
| Carry: recovery timing, end of the pause | Task 12 (ruling 20) |
| Carry: press trigger lifts, team pressing if off | Task 12 (ruling 21), Task 14 Step 1 |
| Carry: release median | Task 13 (ruling 22) |
| Carry: M10 and P3's deferred tests | Ruling 23, Task 14; Task 13 and Task 1 (ruling 24) |

**Step scan.** Every code step names its signature, file and values; `<…>` appear only in commit-message templates filled from the task's own measurement.

**Type consistency.** `SetPieceKind`, `RoleTable`, `RestartPlan`, `SetPieceLive`, `RestartShot`, `MoveTarget` and the seam names (`planAttack`, `attackSpot`, `noteSetPiece`, `setPieceRun`, `planDefend`, `defendSpot`, `shapeSpot`, `restartDelayTicks`, `planDead`, `deadMove`, `takerReady`, `keeperTakes`, `longKickScale`, `runMove`, `rotateMove`, `restartShot`, `restartKindShift`) are spelled the same in Task 1 and in their owners.

**Review Focus.** Missing roles: Tasks 3, 4, 9, 10. Second half: Tasks 1, 3, 4, 5, 10. Edges: Tasks 3, 4, 5. Interrupted restarts: Tasks 4, 6. dt 0.04: Tasks 3, 6, 10 (and 12, 13).

**Proportion.** Shorter than plan 8d, with code only as signatures, defaults and assertions.

## User decisions (2026-10-19)

- **Spatial statistics in the gate (P5 Q1):** add the seven spatial statistics to the |z| < 3 check from P5's final task on.
- **xG (P6 Q2):** refit to DFL's model xG on the 7 matches.
- **C5 (P6 Q3):** 4 matches plus a clip list, with no LLM.
- **P5 gate fallback (P5 Q2):** switch off rotations, then runs and overlaps, then zonal marking, then the pause and recovery changes. S1–S9 and G3 are always kept.
- **Every other question in either plan:** the plan's recommended option, as written.
- **Execution:** P5 and P6 run in parallel with subagent-driven development. Wave 0 starts on 79d6088 before P4 merges, and no measurement is taken until the branch is merged with P4's result (P5 plan line 38; P6 Task 8).

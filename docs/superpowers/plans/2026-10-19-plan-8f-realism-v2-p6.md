# Realism v2, P6: shot model — implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. This plan is built for **parallel** execution, and it runs **alongside P5** (plan 8e): read "Parallel execution" and "Cross-phase contacts" before starting.

**Goal:** Shots are taken and finished like real football. A pass or cross that reaches a teammate near goal can be struck first time, laid off or controlled (SH1). An attacker who wins a high ball in the box can head at goal (SH2). Saves depend on where the keeper stands and how long he has to react (SH3). Tiredness widens kick error by a refitted amount (SH4). The shot logit and xG are refitted with goals kept near 2.7 per match. The phase ends, on top of the merged P5 result, with the gate green, the shot-type table and conversion by pressure measured MET or NOT MET, the manager A/B re-run, and a replay set ready for the user's C5 review.

**Architecture:**
- **Seams first.** Task 1 adds every P6 params block (all off), the `contact` RNG stream, a `contact.ts` module of shared types, generic hooks in `planShot`, a `fatigueScale` function at `execute.ts:46`, an `xgCoefs`/`shotTerm` block in `decide.ts`, and three banner-delimited seam blocks in `step.ts` around one new call site in `resolveFlightNow`. Each rule-0 body is today's code, so output is bit-identical (gate drift 0).
- **One owner per block.** Each wave task fills one seam block or one function, plus its own module, its own test file and the values of its own params block.
- **Switches.** Every behaviour ships behind a `rule` switch (validated 0 or 1). Task 8 switches everything on, after merging the P5 result.
- **Diagnostic first.** Task 2 adds a Python `shots` section (the shot-type table, conversion by pressure and by technique, keeper at the shot, late-match completion), computes the real rows it can from `data/raw/idsse`, fits xG to DFL's model xG, and commits the baseline.

**Tech stack:** TypeScript (Effect monorepo, vitest), Python 3 (uv, pytest, numpy, kloppy), pnpm 11.

**Spec:** `docs/superpowers/specs/2026-10-13-sim-realism-v2-design.md`: "Decisions", "Conventions for every phase", "Evaluation changes", "P6: shot model", and "Results: P3" (in particular "Carried to P4/P5" and "Rulings"). The evidence is `touchline-worktrees/analysis-positioning/finalthird-report.md` (A3, R6) and `finalthird.json` (`extras.shot_timing`, `extras.conv_by_geometry`); definitions are in that folder's `ft_analysis.py` (shot rows, setups, `carrier_spell`) and `ft_real_events.py` (DFL shot attributes). Only the aggregates quoted in this plan may be committed.

**Starting point** (finalthird-report A3, pre-P1 engine, 16 matches; Task 2 re-measures on the current engine):
- **Volume.** Shots 28.4 per match (real 24.4), open play 19.6 (17.1), goals 2.88 (2.71); P3 deep report: goals z −0.57.
- **Technique.** First-time shots 0 % (real 41 % of open-play shots, 55 % of goals, conversion 12.2 % against 7.0 %). Headers 0 % (14 %, conversion 6 %). Every shot follows a decision delay after control, and `xgOf` is always called with `header = false`.
- **Pressure.** Conversion by nearest defender < 1.5 / 1.5–3 / ≥ 3 m: sim 4.7 / 6.4 / 10.9 %, real 11.8 / 10.9 / 3.2 %. Nearest defender median 3.66 m (2.04). Blocked 12.8 % (21.7 %).
- **Setups.** Loose ball or regain 28 % of open-play shots (real 13 %), cross 6 % (17 %), through ball 15 % (2.5 %; P3 brought it to 4.3 %).
- **Saves.** `saveChance` has no keeper-position term. The keeper stood 3.97 m off the line at shots (real 2.23); P2's anchor rule moved him toward 1.5–2.5 m.
- **xG.** The decision xG averages 0.196 per open-play shot against DFL's 0.101 (different models).
- **P4 state** (not yet merged when this plan was written): zonal marking ships off and is carried to P5; team pressing (`press.rule`) ships either on at a higher `rateScale` or off and carried to P5. Aerial duels are 16–21 per match against 47. P6 depends on neither outcome; Task 8 records which held.

## Setup (before Task 1)

The integration worktree already exists: `touchline-worktrees/realism-v2-p6`, branch `realism-v2-p6`, at 79d6088 (P4 Tasks 1–9 merged, switches off), with this plan committed. Every path below is relative to a worktree of it. Run `pnpm install` once.

## Parallel execution

### Dependency graph

```
Task 1 (scaffold: params, stream, contact.ts, hooks, seams) ──┬──> Task 3 (SH1 first-time finishes) ─┐
Task 2 (diagnostic: shots section, real rows, xG fit) ────────┤    Task 4 (SH2 headers) ────────────┼──> Task 7 (shot logit + xG refit) ──> Task 8 (merge P5 result,
                                                              ├──> Task 5 (SH3 keeper-position saves)┤                                        switch on, recalibrate, gate,
                                                              └──> Task 6 (SH4 tiring refit) ────────┘                                        re-pin, C5 replays, results)
```

### Waves

| Wave | Tasks, run concurrently | Starts when |
|---|---|---|
| 0 | Task 1, Task 2, and the pre-flight scan | Setup is done |
| 1 | Task 3, Task 4, Task 5, Task 6 | Tasks 1 and 2 are merged |
| 2 | Task 7 | Every wave-1 task is merged |
| 3 | Task 8 | Task 7 is merged **and P5 is merged to `main`** (the user has seen P5's results) |

- **P5 runs alongside.** P5's mechanism tasks run on `realism-v2-p5` at the same time as waves 0–2 here. P5's final task calibrates first. P6's final task then merges `main` (with P5) into this branch, checks that P6 is still identity, and only then switches on and calibrates (ruling 19).
- **Pre-flight scan.** Before dispatching Task 1, run a read-only scan (opus) of this plan against the code at the integration base and against plan 8e's Cross-phase contacts section, if it exists by then. It looks for fixture contradictions, seam signature mismatches, "off" assertions that rely on `DEFAULT_PARAMS`, rule-0 non-identity, and any region both plans claim. Its findings become rulings carried into each task's brief. It runs alongside Task 2.

### File ownership

A task creates or modifies only the files listed for it. **Shared files are in bold.**

| Task | Model | Owns (create or modify) | In **`step.ts`** | In **`params.ts`** |
|---|---|---|---|---|
| 1 | opus | **`sim-core/src/{params,types,step}.ts`**; `sim-core/src/contact.ts` (new); `shot.ts` (`ShotMods`, `ShotOnTarget` and the hook lines in `planShot` only); `execute.ts` (line 46 and the new `fatigueScale`); `decide.ts` (one line in `xgOf`, the shot line in `decide`'s logits map, the new P6 shot-model block); `sim-core/test/params.test.ts` (append); `sim-core/test/contact.test.ts` (new) | Import markers, three seam blocks, `releaseShot`'s `how` parameter, the two `resolveFlightNow` call sites | Types and every P6 block (all off), switch validation |
| 2 | opus | `python/analytics/touchline_analytics/shots.py` (new), `report.py`, `targets.py` (`HAND_BLOCKS`), `python/analytics/tests/test_shots.py` (new), `data/params/targets-idsse.json` (new `shots` block), `calibrate/src/realism.ts` (`--only shots`), `docs/realism/p6-shots-baseline.md` (new) | — | — |
| 3 | opus | `sim-core/src/firsttime.ts` (new), `sim-core/test/firsttime.test.ts` (new) | **First-time seam** | `firstTime` values (not `rule`) |
| 4 | opus | `sim-core/src/header.ts` (new), `sim-core/test/header.test.ts` (new) | **Header seam** | `header` values (not `rule`) |
| 5 | opus | `shot.ts`: `saveChance` and a new `saveGeometry` only; `sim-core/test/savegeo.test.ts` (new) | — | `saveGeo` values (not `rule`) |
| 6 | sonnet | `execute.ts`: the body of `fatigueScale` only; `sim-core/test/fatigue-exec.test.ts` (new) | — | `execFatigue` values (not `rule`) |
| 7 | opus | `decide.ts`: the bodies in the P6 shot-model block only; `sim-core/test/shotmodel.test.ts` (new) | — | `shotModel` values (not `rule`) |
| 8 | opus | Everything else: the merge of `main`, the `rule` switches, `params.test.ts`, `calibrate/src/knobs.ts`, `data/params/*`, `docs/`, seed pins, goldens, `sim-core/test/shots-targets.test.ts` (new), the C5 replay set | anything left | the five switches |

- **Tests import modules directly** (`../src/firsttime.js`), so no task touches `index.ts`.
- **The calibrated file** `data/params/touchline-params.json` is Task 8's alone. A wave task that finds a better value for an existing knob (`save_b0`, `aim_noise`, `shot_bias`) records it in its report and does not commit it.

### How to run a wave

As in plan 8d: `git worktree add ../p6-task<N> -b p6-task<N> realism-v2-p6`, `pnpm install`, merge finished tasks one at a time with `git merge --no-ff p6-task<N> -m "merge: P6 task <N> (<short name>)"`, then run the sim-core suite and the gate on the merged branch (Expected: PASS, every drift exactly 0), and remove the worktree.
- **Measurements:** `pnpm realism --matches 16 --only shots --set <keys> --runs out/p6-t<N>-runs --out out/p6-t<N>-<label>.md`. Every `--set` includes the measurement base of ruling 18.
- **Disk.** A 16-match run is about 1.3 GB. Delete the run folder right after each report, and check `df -h .` before starting one.

## Global Constraints

- Never commit `data/raw/`. Use only aggregated real data.
- Commit trailer: `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Never widen the gate, and never loosen a test.
- Never use a bare `git stash`.
- Merge to main only after the user has seen the results.
- Put every new behaviour behind a `rule` switch that stays off until the final task. With rule 0, output must be byte-identical.
- Each concern draws from its own named substream, `substream(seed, concern)`.
- `decide.ts`, `execute.ts`, `resolve.ts` and `shot.ts` are sensitive. A phase may touch only the parts the spec names for it.
- **P6's sensitive regions** (the spec's approved shot model): in `decide.ts`, `xgOf` and the open-play shot term of `decide`; in `execute.ts`, the fatigue factor at line 46; in `shot.ts`, `saveChance` and the `planShot` hooks; in `step.ts`, `releaseShot` and the contact call in `resolveFlightNow`. **`resolve.ts` is not touched** (ruling 9). Nothing P5 owns is touched (see Cross-phase contacts).
- **Gate.** `GATE_LOSS` 30, `DRIFT_Z` 3.5, `WITHIN_1SD` 11, `WITHIN_2SD` 17, `PHYSICS_INSIDE` 2; no statistic dropped. A real target still missed goes in `it.fails`, unwidened, titled `NOT MET:`, with the measured value in a comment.
- **Determinism.** One new stream, `contact` (SH1 and SH2 choices, lay-off receiver). SH3 and SH4 draw nothing. With every P6 rule at 0, no new draw happens. No `Math.random`, no `Date`.
- **Defaults.** `firstTime.rule`, `header.rule`, `saveGeo.rule`, `execFatigue.rule` and `shotModel.rule` are 0; `paramsFromJson` rejects any other value than 0 or 1 (also for `firstTime.setPieces`). Only Task 8 turns them on.
- **Test fixtures** define explicit `off` and `on` params; never `DEFAULT_PARAMS` as "off". A mechanism test asserts only what its rule adds, against the same fixture under `off`, after asserting the fixture's precondition (no vacuous loops: every loop asserts a minimum count).
- **Tick rate.** Contact decisions happen in the resolve tick; any window is in seconds and converted with `Math.round(s / dt)`. Each in-match test runs at dt 0.1 and dt 0.04.
- **Team frame.** u = `attackX(side, x, period)`; the box he attacks is u > 36 and |y| < 20.16; the goal is `goalOf(side, period)`.
- **Commands.** Tests: `pnpm --filter <pkg> exec vitest run --no-file-parallelism`. Gate: `pnpm --filter @touchline/calibrate exec vitest run test/realism-gate.test.ts --disableConsoleIntercept`.
- **Agents.** The decision log format, `overridePass` and the recorded options stay compatible: contact decisions are recorded with existing action names (ruling 6). No new event types (ruling 7).
- **Region ownership.** Edit only the region the ownership table gives your task. A change you need elsewhere is a plan bug: stop and report it.

## Planning rulings

Task 8 copies them into the results.

1. **Params blocks** (new, top-level, each on its own lines under a `// ---- realism v2 P6 (plan 8f)` banner): `firstTime` (SH1), `header` (SH2), `saveGeo` (SH3), `execFatigue` (SH4), `shotModel` (shot logit and xG). P6 adds **no field** to `shot`, `fatigue`, `actions` or `timing`, which P5 may also extend.
2. **Where "at contact" is.** The decision is made in `resolveFlightNow`, at the resolution of a pass flight whose outcome is `successful` and whose winner is the passer's teammate, before the first touch is drawn. `resolveFlight` already decides who arrives and where; the ball state at resolution gives the contact height and velocity.
3. **SH1 eligibility.** Not a keeper, no aerial foul on the flight (`f.foul`), no pending what-if override for the receiver (`w.override?.playerId`), receiver within `firstTime.maxGoalM` (25 m) of the goal centre, contact z ≤ `kinematics.controlHeightM` (1.0 m; higher balls are SH2's or controlled). Restarts: corner and free-kick deliveries count when `firstTime.setPieces` is 1 (Question 1); throw-ins, kickoffs and goal kicks never.
4. **SH1 choice.** A three-way softmax on the `contact` stream:
   - U_shot = `b0 + bXg·xg + bArrival·cosδ + scriptBias.shot`, where xg = `xgOf` at the contact point with the decide-style cone count, and cosδ = (unit ground velocity of the arriving ball) · (unit vector receiver → goal centre). cosδ = −1 is a ball coming toward him from the goal side (cutback, lay-back); +1 is a ball from behind.
   - U_layoff = `layOffLogit` when a lay-off option exists (ruling 6), else −∞; U_control = 0.
   - **Pressure is not in the choice** (spec). `bArrival` −0.5 is a prior, not fitted: 120 real open-play shots cannot fit it. Cost if wrong: the arrival mix of first-time shots is off; their share is still calibrated through `b0`.
5. **SH1 execution.** A first-time shot goes through `releaseShot` → `planShot` with the receiver's pressure at contact (`pressureFrom`), so the existing pressure terms widen aim and mis-hits. It adds `aimY = aimZ = 1 + arrivalAimK·(1 + cosδ)/2 + speedAimK·max(0, ballMps − speedRefMps)/10` (0.3, 0.2, 12 m/s).
6. **Lay-off and the decision record.** Lay-off options are `buildCandidatesIn(candidateContext(…))` filtered to `short_pass`, `back_pass` and `cutback` with the receiver within `layOffMaxM` (12 m); the receiver is drawn by `choiceShares` on the `contact` stream; the pass goes through `releaseKick` with `restart` null. The contact `Decision` records `actionProbs` keyed `shot`, `short_pass` (lay-off) and `hold` (control), and the lay-off options as `options`, so the agents' format is unchanged.
7. **Events.** A first-time shot or header emits **no** `reception`; the pass keeps outcome `successful` and its `receiver_id`; the `shot` event is in the pass's resolve frame with `attrs.first_time: true`. A header has `body_part: "head"` (CDF and SPADL already map it); `technique` stays `"normal"`, so the penalty count is unchanged. A lay-off pass has `attrs.first_time: true`. No new event types.
8. **SH2.** Eligible when the contact z is in [`zMin` 1.0, `zMax` 2.4] (the engine's `controlHeightM` and `headerHeightM`) and the receiver is in the box he attacks; otherwise the SH1 path applies. A binary choice on the `contact` stream: U_head = `b0 + bXg·xg(header = true) + bHeading·(heading − 0.6) + scriptBias.shot` against control 0. The header shot uses `heading` in place of `finishing`, aim × `aimK` (1.3), ball speed × `speedShare` (0.55), and starts at the contact height. No headed lay-off (YAGNI). Who wins the ball is P4's aerial duel; SH2 acts on its winner.
9. **No `resolve.ts` edit.** The spec names the aerial branch for SH2, but the contact height and the winner are already in the resolution. Leaving `resolve.ts` alone removes the only textual contact with P5's carried aerial-volume work. Cost if wrong: a header cannot see how well placed the winner was (the duel's slack); add it later as an optional `Resolution` field if the shots section needs it.
10. **SH3 terms.** Under `saveGeo.rule` 1, `saveChance` adds `bOffLine·(offLine − offLineRefM) + bOffBisector·offBisector + bFlightS·min(flightCapS, flight − reactionS)` and **stops reading `bDistance`**, because flight time carries distance. offLine = |keeper x − goal-line x|; offBisector = the keeper's distance from the segment shot origin → goal centre; flight = distance from origin to the crossing point ÷ ball speed. Priors: `offLineRefM` 2.2 (real median at shots), `bOffLine` −0.15, `bOffBisector` −0.6, `reactionS` 0.2, `bFlightS` 2.5, `flightCapS` 1.0. Not fitted (about 39 real on-target open-play shots); Task 5 sets `bFlightS` and `bOffBisector` from the conversion ordering.
11. **SH4.** `fatigueScale(f, p)` = `1 + executionK·f` under rule 0; under rule 1, `1 + k·max(0, f − ref)^power` (start k 0.25, ref 0, power 1, numerically equal to rule 0). Target: the late-match completion drop (completion over 75–90+ minus over 0–15) equals the real one Task 2 computes. Scope: kicks only. Shots have no fatigue term today and get none (the spec names `execute.ts:46`).
12. **Shot logit.** Under `shotModel.rule` 1, `decide`'s open-play shot term becomes `bXg·(xg − pivot) + bRisk·riskTolerance`. **With a restart (`input.restart !== null`) it returns the rule-0 value**, so P5's direct free-kick logit (S9) keeps its calibration. Task 7 sets `bXg` and `pivot` so that open-play owner shots fall to make room for first-time shots and headers.
13. **xG refit.** `shotModel.xg` is fitted by Task 2 to DFL's model xG on the 7 IDSSE matches: least squares of logit(xG) on `xgOf`'s features computed from each shot's position (distance, goal-mouth angle), `header` from `TypeOfShot = head`, defenders = max(0, `AmountOfDefenders` − 1) (the analysis found DFL counts about one more than the cone). Under rule 1 `xgOf` reads `shotModel.xg`. The recorded `xg`, the advisor and the agents read the refitted value (Question 2).
14. **Goals about 2.7.** The tuner keeps `save_b0`, `aim_noise` and `shot_bias`; `xg_b0` moves `shotModel.xg.b0` within the fit ± 0.5; a new `shot_xg_slope` moves `shotModel.bXg` (1.5–4.5). **No tuner knob** on `firstTime`, `header`, `saveGeo` or `execFatigue`: the gate does not see composition, so a knob there would buy loss by distorting it.
15. **Diagnostics in Python** (P3 ruling 17), no TS port. The real rows come from two places: computed in-repo from `data/raw/idsse` (DFL shot attributes by `ElementTree`, completion by time through `targets.idsse_events`), or hand-copied from finalthird-report for the tracking-based rows (first-time, nearest defender, keeper position, setups). The block is `shots` in `targets-idsse.json`, kept by `HAND_BLOCKS`.
16. **First-time in the sim** is measured from events, independent of `attrs.first_time`: a shot whose frame is less than round(0.3·fps) frames after the shooter gained the ball (the end frame of a completed pass to him, or his interception or recovery). A sim first-time shot is released in the reception frame, so this matches the real tracking proxy (spell < 0.3 s).
17. **Real-target tests** live in Task 8's `shots-targets.test.ts`: calibrated params, test teams, seeds `[7, 9, 11, 13, 15, 17, 19, 21]` (8 matches, about 190 shots, because conversion splits need the sample), fixed by the file's rule.
18. **Measurement base.** The integration branch starts with P4's switches off. Before wave 1: if P4 is merged to `main`, merge `main` into `realism-v2-p6` and check identity (drift 0); otherwise every measurement adds `--set` with P4's switches on (`tackle.rule=1,fouls.rule=1,aerial.rule=1,transition.rule=1,firstTick.scopeRule=1,release.rejudge=1`, plus `press.rule=1` only if P4 ships it on). Wave-task values are provisional; Task 8 re-checks them on P5's result.
19. **"Rebase onto P5" is a merge.** Task 8 runs `git merge --no-ff main` into `realism-v2-p6` rather than `git rebase`: the content is identical, conflicts are resolved once instead of once per task commit, and the task-merge history stays readable. Cost if wrong: a non-linear history, which the merge to `main` can squash.
20. **P5 rows that P6 moves.** Headers and first-time finishes change set-piece outcomes, the xG refit changes the free-kick xG, and SH4 changes long-kick error. Task 8 re-measures P5's corner shots per 100 (about 32), direct free-kick shot share (0.36) and long goal-kick completion (about 49 %). A P5 row that goes from MET to NOT MET because of P6 is reported to the user. P6 does not retune P5's blocks without the user.
21. **C5.** The user judges replays. Task 8 produces the replay set: 4 matches written by `pnpm sim` into `out/c5-review/` (gate seeds 3000 and 3001, scenarios `keeper_heroics` and `late_comeback`), played through `pnpm api --library out/c5-review` and `pnpm web`. A clip list `docs/realism/c5-review.md` (from Task 2's `shot_clips`) gives match minutes for each category: first-time shots and goals, headers, lay-offs, saves with flight under 0.5 s, the contract's C5 items (supporters offering angles, defenders goal-side, shielding under pressure), and late-match passes. No agent service or LLM is needed: without a cue cache the matches play with no cues. Question 3.
22. **Scenario scripts.** Contact shots go through `releaseShot`, so forced goals, `keeper_heroics` saves and `keeper_howler` errors apply and are used up as for any shot. `scriptBias.shot` enters U_shot and U_head (ruling 4, 8).

## Questions for the user

Each is written into the plan with the recommended option; the user may overrule before Task 8.

1. **First-time finishes and headers at set pieces.** (a) Corners and free-kick deliveries too (recommended: most real headers come from them, and P5's box loading makes them realistic; open-play targets are still judged on open play). (b) Open play only. (c) Corners only. It is `firstTime.setPieces` (1 = a); either way Task 8 records P5's corner shots per 100.
2. **What xG means after P6.** (a) Refit to DFL's model xG on the 7 matches (recommended; real, and it halves today's 0.196 per shot toward 0.101). (b) Keep the hand-set prior and tune only its intercept. (c) Fit to the sim's own conversion. The agents and the advisor show this number, so (a) changes what users read.
3. **C5 replay set.** (a) 4 matches with a clip list of minute marks (recommended). (b) Regenerate the whole `out/library` (needs the agent service and the LLM, about an hour). (c) One match, watched in full.
4. **Gate fallback order** if switching everything on fails the gate after diagnosis: (a) keep SH1, SH4 and the refit; switch off SH3, then SH2 (recommended: SH1 carries most of the goal composition). (b) Switch off SH1's lay-off branch first (`layOffLogit` → −∞), then SH3. (c) Stop and decide after the diagnosis, with no default.
5. **If P5 is not merged when wave 2 ends.** (a) Wait for the user's P5 review and merge (recommended; P6 calibrates on the engine that ships). (b) Merge P5's branch tip unmerged and calibrate now, recalibrating after P5's merge (two calibrations, about 80 minutes more).

## Cross-phase contacts

Every region P6 touches that P5 (plan 8e) may also touch. One owner each. "Keep both" means the conflict is adjacency only.

| File | Region (function or block) | P6 change | P5 change (expected) | Owner | How the merge stays mechanical |
|---|---|---|---|---|---|
| `decide.ts` | `xgOf` body | One line: `const c = xgCoefs(p)` | S9 may call `xgOf` for the free-kick xG | P6 | P5 adds its free-kick adjustment outside `xgOf` (in its own S9 function), never in its body |
| `decide.ts` | `decide`, logits map, the `a === "shot"` line | Replaced by `l += shotTerm(xg, style, input.restart, p)` | S9 adds its own line for central attacking-third free kicks | P6 owns that line; P5 owns its new line | Separate lines; `shotTerm` returns the rule-0 value under a restart, so S9's calibration holds (ruling 12). Keep both |
| `decide.ts` | New block "P6 shot-model seam (plan 8f)" directly below `xgOf` | `xgCoefs`, `shotTerm` | — | P6 | P5 places its S9 and goal-kick blocks after the P3 keeper-hands seam, not here |
| `decide.ts` | `RESTART_ACTIONS`, the goal-kick short/long choice (G3) | Not touched | G3 | P5 | — |
| `execute.ts` | `executeKick`, the `skill` line (line 46) | `(1 + executionK·f)` → `fatigueScale(k.fatigue ?? 0, p)` | G3 long goal-kick completion | P6 | P5 sets long goal-kick error through `KickIntent.errorScale` at the call site (`kickStyle`, step.ts) or a new field read on a new line, never on line 46 |
| `execute.ts` | New exported `fatigueScale`, after `pressureFrom` | Created (Task 1), filled (Task 6) | — | P6 | — |
| `resolve.ts` | Aerial branch | **Not touched** (ruling 9) | Possibly aerial-duel volume | P5 | No textual contact. Semantic: headers scale with attacker-won high balls in the box; Task 8 re-measures the header share after the merge |
| `shot.ts` | `ShotMods`, `ShotOnTarget`, `planShot` hooks, `saveChance`, `saveGeometry` | All | Not touched (S9 uses the existing shot path) | P6 | If P5 needs a free-kick aim effect, it uses `ShotMods` after the merge |
| `step.ts` | `releaseShot` | Optional `how: ShotHow` parameter; merged mods; `body_part` and `first_time` attrs | Not touched (`technique: "free_kick"` exists) | P6 | P5 does not edit `releaseShot` |
| `step.ts` | `resolveFlightNow` | Two inserted statements (contact plan before the extras loop; executor branch before the first-touch branch) | Not expected | P6 | If P5 must edit it, keep both |
| `step.ts` | Banner blocks "P6 first-time seam", "P6 header seam", "P6 contact executor", above `resolveFlightNow` | Created | P5's set-piece, restart-timing and keeper free-kick blocks near `moveTarget`, `startRestart`, `handleRestart`, `takerFor` | Each its own | Separate banner blocks in separate parts of the file |
| `step.ts` | Import markers after the P4 marking marker | Three P6 markers | P5's markers | Each its own | Keep both |
| `step.ts` | `ownerDecision`, `releaseKick`, `kickStyle`, `startRestart`, `takerFor` | Not touched (a lay-off calls `releaseKick` unchanged) | G3, S8 | P5 | — |
| `params.ts` | New top-level blocks; `checkRuleSwitches`, `SIGNED`, `PROBABILITIES`, new checks | Five blocks; one appended line per list | P5's blocks and list entries; the `free_kick` restart-delay split | Each its own block | Keep both; P6 adds no field to an existing block (ruling 1) |
| `types.ts` | `CONCERNS` | Appends `"contact"` | Appends its own streams | Each its own entry | Keep both. Streams are keyed by name hash, so order does not change any sequence |
| `calibrate/src/knobs.ts` | `KNOBS` entries | Adds `shot_xg_slope`; `xg_b0` retargeted to `shotModel.xg.b0` | P5's knobs; `restart_scale` over the split keys | Each its own entry | P6 appends after P5's entries during Task 8's merge |
| `data/params/targets-idsse.json`, `targets.py` `HAND_BLOCKS` | New hand block | `shots` | P5's set-piece and role-move block | Each its own | Keep both entries in `HAND_BLOCKS` |
| `report.py`, `calibrate/src/realism.ts` | `build` sections, `--only` choices | `shots_section`, `"shots"` | P5's section and choice | Each its own | Keep both |
| `touchline-params.json`, `realism-baseline.json`, goldens, seed pins, `realism-report.md`, `realism-deep-report.md` | Generated | Regenerated in Task 8 after the merge | Regenerated in P5's final task | P5 first, then P6 | Task 8 takes `main`'s versions in the merge, then regenerates; never hand-merges them |
| Spec | Results sections | Adds `## Results: P6` after P5's | Adds `## Results: P5` | Each its own | Keep both |
| Tests | P5's real-target tests (corner shots per 100, S9 share, long goal kicks) | Re-run in Task 8 | Created by P5 | P5 | Never loosened; a P5 row P6 breaks is reported (ruling 20) |

## Review Focus

1. **25 Hz renders (dt 0.04).** The contact decision happens once, in the resolve tick, at any tick rate, and the event-based first-time measure uses round(0.3·fps) frames. Covered by the dt cases in Tasks 3 and 4.
2. **Second half and the other side.** The 25 m test, the box test, cosδ and the save geometry use `goalOf(side, period)` and must mirror when home attacks −x. Covered by the second-half cases in Tasks 3, 4 and 5.
3. **Flights that are not clean receptions.** An aerial foul, an offside, a block, a keeper claim, a header away or a loose ball never produces a contact decision. Covered in Task 3 (`contactPlan` returns control for each).
4. **A keeper receiving, or a pending what-if override.** A keeper never shoots first time; a receiver with an override always controls, so the what-if pass still happens. Covered in Task 3.
5. **Scenario scripts on contact shots.** A forced `keeper_heroics` save is used up by a first-time shot or header; a forced goal applies. Covered in Tasks 3 and 4.

---

### Task 1: Scaffold — params, stream, `contact.ts`, hooks and seams (wave 0, identity; opus)

**Files:**
- Modify: **`packages/sim-core/src/params.ts`**, **`types.ts`**, **`step.ts`**; `shot.ts` (types and hook lines); `execute.ts:46`; `decide.ts` (`xgOf` line, the shot line, the new block)
- Create: `packages/sim-core/src/contact.ts`, `packages/sim-core/test/contact.test.ts`
- Test: `packages/sim-core/test/params.test.ts` (append)

**Interfaces:**
- Produces (in `params.ts`), every switch 0:
  - `firstTime: { rule: 0, setPieces: 1, maxGoalM: 25, b0: -1, bXg: 6, bArrival: -0.5, layOffLogit: -1.5, layOffMaxM: 12, arrivalAimK: 0.3, speedAimK: 0.2, speedRefMps: 12 }`
  - `header: { rule: 0, zMin: 1, zMax: 2.4, b0: -0.5, bXg: 6, bHeading: 2, aimK: 1.3, speedShare: 0.55 }`
  - `saveGeo: { rule: 0, offLineRefM: 2.2, bOffLine: -0.15, bOffBisector: -0.6, reactionS: 0.2, bFlightS: 2.5, flightCapS: 1 }`
  - `execFatigue: { rule: 0, k: 0.25, ref: 0, power: 1 }`
  - `shotModel: { rule: 0, xg: { b0: -1.25, bDist: -0.08, bAngle: 1.2, bHeader: -1, bDefenders: -0.3 }, bXg: 3, pivot: 0.1, bRisk: 0.3 }`
- Produces (in `types.ts`): `CONCERNS` gains `"contact"`, appended.
- Produces (in `shot.ts`):
  - `ShotMods` gains `aimY?`, `aimZ?` (multiply `sdY`, `sdZ`), `skill?` (replaces `finishing` in the skill term), `mishit?` (multiplies `pMis` inside its `min`), `fromZ?` (origin height, default 0.2), `speed?` (multiplies `p.shot.speed`).
  - `ShotOnTarget` gains `from?: Vec2; goal?: Vec2; speed?: number`, which `planShot` fills; `saveChance` does not read them yet.
- Produces (in `execute.ts`): `fatigueScale(fatigue: number, p: Params): number`, rule-0 body `1 + p.fatigue.executionK * fatigue`.
- Produces (in `decide.ts`, block "P6 shot-model seam (plan 8f Task 7 owns this block)" below `xgOf`):
  - `xgCoefs(p: Params): Params["shot"]["xg"]`, rule-0 body `p.shot.xg`;
  - `shotTerm(xg: number, style: TeamStyle, restart: RestartKind | null, p: Params): number`, rule-0 body `3 * (xg - 0.1) + 0.3 * style.riskTolerance` (same expression, same order).
- Produces (in `contact.ts`):
  - `type ContactPlan = { kind: "control" } | { kind: "shot"; decision: Decision; how: ShotHow } | { kind: "layoff"; decision: Decision }`
  - `interface ShotHow { header: boolean; firstTime: boolean; mods: Pick<ShotMods, "aimY" | "aimZ" | "skill" | "mishit" | "fromZ" | "speed"> }`; `OPEN_SHOT: ShotHow` = `{ header: false, firstTime: false, mods: {} }`; `CONTROL: ContactPlan`
  - `arrivalCos(ballVel: Vec3, at: Vec2, goal: Vec2): number` (0 when the ball's ground speed is below 0.1 m/s)
  - `contactDecision(probs: { shot: number; short_pass?: number; hold: number }, action: "shot" | "short_pass", candidate: Candidate | null, options: ReadonlyArray<OptionRecord>, xg: number | null, pressure: number): Decision`
- Produces (in `step.ts`): `releaseShot(w, owner, d, restart, how: ShotHow = OPEN_SHOT)`, and three blocks above `resolveFlightNow`:

  | Block (owner) | Function | Rule-0 body |
  |---|---|---|
  | P6 contact executor (Task 1; no wave task edits it) | `contactPlan(w, f): { receiver: PlayerState; plan: ContactPlan } \| null` | `null` when `firstTime.rule` and `header.rule` are both 0 (no work, no draw); else the shared part of ruling 3 (winner is the passer's teammate, not a keeper, no `f.foul`, no override for him, restart allowed), then `headerPlan(…) ?? firstTimePlan(…)` |
  | | `executeContact(w, f, receiver, plan): void` | shot → `releaseShot(w, receiver, plan.decision, null, plan.how)`; layoff → `releaseKick(w, receiver, plan.decision, null)`, then `first_time: true` added to the new flight's `pending.attrs` (so `releaseKick` itself is unchanged); then `w.pressedBy = []` |
  | P6 header seam (Task 4) | `headerPlan(w, f, receiver): ContactPlan \| null` | `null` |
  | P6 first-time seam (Task 3) | `firstTimePlan(w, f, receiver): ContactPlan` | `CONTROL` |

- [ ] **Step 1: Write the failing tests**

Append to `params.test.ts` (describe `"realism v2 P6 params"`):

```ts
it("ship switched off, with the spec's header band and the contact stream", () => {
  const P = DEFAULT_PARAMS
  for (const r of [P.firstTime.rule, P.header.rule, P.saveGeo.rule, P.execFatigue.rule, P.shotModel.rule]) expect(r).toBe(0)
  expect([P.firstTime.maxGoalM, P.header.zMin, P.header.zMax]).toEqual([25, 1, 2.4])
  expect(P.shotModel.xg).toEqual(P.shot.xg)
  expect(CONCERNS).toContain("contact")
})
it("reject a P6 switch other than 0 or 1 and a header band out of order", () => {
  expect(() => paramsFromJson({ provenance: cc, firstTime: { rule: 2 } })).toThrow(/firstTime\.rule must be 0 or 1/)
  expect(() => paramsFromJson({ provenance: cc, firstTime: { setPieces: 0.5 } })).toThrow(/firstTime\.setPieces must be 0 or 1/)
  expect(() => paramsFromJson({ provenance: cc, header: { zMin: 2.5 } })).toThrow(/header\.zMin/)
  expect(paramsFromJson({ provenance: cc, shotModel: { xg: { b0: -2 } } }).shotModel.xg.b0).toBe(-2)
})
```

`contact.test.ts`:
- `"arrivalCos: -1 for a cutback from the byline, +1 from behind, mirrored after half-time"`: goal (52.5, 0), receiver (40, 0); ball velocity (−10, 0, 0) → −1; (10, 0, 0) → +1; (0, 10, 0) → 0; with goal (−52.5, 0), receiver (−40, 0) and velocity (10, 0, 0) → −1; velocity (0.05, 0, 0) → 0.
- `"contactDecision records shot, short_pass and hold with the existing action names"`: `actionProbs` keys ⊆ `{shot, short_pass, hold}`, `action` as given, `xg` kept, `chosenRank` null for a shot.
- `"rule off: planShot hooks, fatigueScale, xgCoefs and shotTerm are identity"`:
  - 2000 `planShot` draws with `mods: {}` and with `{ aimY: 1, aimZ: 1, mishit: 1, speed: 1 }` give identical plans from equal rng states;
  - `fatigueScale(0.4, P) === 1 + P.fatigue.executionK * 0.4`;
  - `shotTerm(0.2, style, null, P) === 3 * (0.2 - 0.1) + 0.3 * style.riskTolerance`.

Run: `pnpm --filter @touchline/sim-core exec vitest run test/params.test.ts test/contact.test.ts`
Expected: FAIL (`DEFAULT_PARAMS.firstTime` is undefined; `contact.ts` does not exist).

- [ ] **Step 2: Implement params, the stream and `contact.ts`**
  - Blocks as in Interfaces, under the ruling-1 banner, each with a doc comment naming the spec item and "rule 0: the old behaviour".
  - `checkRuleSwitches` gains the five switches and `firstTime.setPieces`; `SIGNED` gains `/^firstTime\.(b0|bArrival|layOffLogit)$/`, `/^header\.b0$/`, `/^saveGeo\.b/`, `/^shotModel\.xg\./`; a new `checkP6` requires `header.zMin < header.zMax`, `0 ≤ execFatigue.ref < 1` and `execFatigue.power > 0`.

- [ ] **Step 3: Add the hooks**
  - `shot.ts`: the six `ShotMods` fields, each multiplying or replacing at its one site, written so that an absent field multiplies by exactly 1; `planShot` passes `{ y, z, distance: d, from: shooter.pos, goal, speed }` to `saveChance`.
  - `execute.ts:46`: `fatigueScale(k.fatigue ?? 0, p)` in place of the fatigue factor.
  - `decide.ts`: `xgOf` takes `const c = xgCoefs(p)`; the logits-map shot line becomes `if (a === "shot") l += shotTerm(xg, style, input.restart, p)`.

- [ ] **Step 4: Build the seams in `step.ts`**
  - Import markers after the P4 marking marker: `// ---- P6 imports, <block> seam (plan 8f Task N inserts below this line)`.
  - The three blocks of the Interfaces table, banner-delimited (`// ===== P6 <block> seam (plan 8f Task N owns this block)` … `// ===== end of P6 <block> seam`), just after the `// ---- flights and loose ball` comment.
  - `releaseShot`: the `how` parameter; `planShot` gets `{ ...mods, ...how.mods }`; when `how.header`, no weak-foot draw and `body_part: "head"`; when `how.firstTime`, `first_time: true` in the attrs.
  - `resolveFlightNow`, two call sites:
    1. before the extras loop: `const contact = f.kind === "pass" && f.outcome === "successful" && f.winnerId ? contactPlan(w, f) : null`; the loop skips the `reception` extra when `contact && contact.plan.kind !== "control"`;
    2. after the `f.looseBall` branch and before the first-touch branch: `if (contact && contact.plan.kind !== "control") { executeContact(w, f, contact.receiver, contact.plan); return }`.

- [ ] **Step 5: Verify identity**

Run: `pnpm typecheck && pnpm --filter @touchline/sim-core exec vitest run --no-file-parallelism`
Expected: PASS (the existing count plus the new cases, the same expected failures).

Run the gate command. Expected: PASS, maxDrift 0.

Run: `uv run --project python/analytics pytest python/analytics/tests -q`. Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/sim-core
git commit -m "feat(sim-core): P6 scaffold — firstTime/header/saveGeo/execFatigue/shotModel params (off), contact stream, contact.ts, planShot hooks, fatigueScale, xgCoefs/shotTerm, three contact seams (identity)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Shots diagnostic — report section, real rows, xG fit, baseline (wave 0; opus)

**Files:**
- Create: `python/analytics/touchline_analytics/shots.py`, `python/analytics/tests/test_shots.py`, `docs/realism/p6-shots-baseline.md`
- Modify: `report.py` (`build` adds `shots_section` when `"shots" in targets`; `--only` gains `"shots"`), `targets.py` (`HAND_BLOCKS` gains `"shots"`), `data/params/targets-idsse.json` (new `shots` block, rows `{label, real, lo, hi, fmt}`), `packages/calibrate/src/realism.ts` (`--only shots`)

**Interfaces:**
- Produces:
  - `match_shots(run: Path, roles: dict[str, str]) -> dict`; `shots_section(ms: list[dict], t: dict) -> list[str]`; `shots_report(run_dirs, targets, note, roles) -> str`
  - `shot_clips(run: Path) -> list[dict]`, each `{category, minute, second, player_id}`, for Task 8's C5 list
  - `real_shot_rows(root: Path, match_id: str) -> list[dict]` (DFL `ShotAtGoal` attributes and the shot's position) and `fit_xg(rows: list[dict]) -> dict[str, float]` (keys `b0, bDist, bAngle, bHeader, bDefenders`)
  - `real_completion_by_bin(root: Path, match_id: str) -> list[tuple[int, int]]` (completed, total per 15-minute bin; the last bin includes added time)
  - CLI: `python -m touchline_analytics.shots real` prints the computed real rows and the xG fit; `python -m touchline_analytics.shots clips <runs…>` prints the C5 list as Markdown
- Definitions (sim side, from `domain.jsonl` and tracking, as `passing.py` reads them; ported from `ft_analysis.py`):
  - **Open play:** not a penalty and more than 10 s after the last `set_piece`.
  - **First-time:** ruling 16. **Header:** `body_part == "head"`.
  - **Nearest defender** and **keeper off the line / off the ball–goal line:** from the tracking frame of the shot.
  - **Setup:** as `ft_analysis.py` classifies (pass, dribble ≥ 1.5 s and ≥ 5 m, cross, loose ball or regain, through ball, rebound).
  - **Completion by bin:** open-play passes by match minute.

| Key | Real | lo–hi | | Key | Real | lo–hi |
|---|---|---|---|---|---|---|
| `shots_per_match` | 24.4 | 21–28 | | `conv_tight` (< 1.5 m) | 0.118 | 0.08–0.16 |
| `open_shots_per_match` | 17.1 | 14.5–19.7 | | `conv_mid` (1.5–3 m) | 0.109 | 0.07–0.15 |
| `goals_per_match` | 2.71 | 2.4–3.0 | | `conv_open` (≥ 3 m) | 0.032 | 0.01–0.06 |
| `open_conv` | 0.092 | 0.07–0.11 | | `conv_tight_minus_open` | 0.086 | 0.03–0.14 |
| `first_time_share` | 0.41 | 0.33–0.49 | | `near_def_median` | 2.04 | 1.6–2.5 |
| `first_time_goal_share` | 0.55 | 0.40–0.70 | | `in_box_share` | 0.59 | 0.52–0.66 |
| `conv_first_time` | 0.122 | 0.09–0.15 | | `in_box_conv` / `out_box_conv` | 0.127 / 0.041 | 0.09–0.16 / 0.02–0.06 |
| `conv_other` | 0.070 | 0.05–0.09 | | `blocked_share` | 0.217 | 0.17–0.27 |
| `header_share` | 0.14 | 0.10–0.18 | | `setup_pass` / `_dribble` / `_cross` | 0.33 / 0.31 / 0.17 | ± 0.06 |
| `conv_header` | 0.06 | 0.03–0.09 | | `setup_loose` / `_through` | 0.13 / 0.025 | 0.07–0.19 / 0–0.05 |
| `gk_off_line_at_shot` | 2.23 | info | | `late_completion_drop` | computed | computed ± 0.02 |
| `gk_off_bisector_at_shot` | 0.32 | info | | `xg_per_shot` | 0.101 (DFL) | info |

`source`: "realism v2 analysis 2026-10-13 (finalthird-report.md A3, R6; finalthird.json extras); late_completion_drop and the xG fit computed from IDSSE events (7 matches); aggregates only. Bands are plan 8f rulings." The section prints "conversion splits: judge on ≥ 64 matches".

- [ ] **Step 1: Write the failing tests** (`test_shots.py`, a hand-built match folder in the style of `test_passing.py`)
  - `test_first_time_by_frames_not_attrs`: a shot 2 frames (10 fps) after a completed pass to the shooter counts; one 4 frames after does not; a shot with `first_time: true` but 5 frames after a recovery does not.
  - `test_header_and_conversion_by_technique`: 4 shots (2 headers, 1 goal), assert `header_share == 0.5`, `conv_header == 0.5`.
  - `test_conversion_by_nearest_defender_mirrors_by_half`: defenders at 1 m and 4 m in each half give one tight and one open shot per half.
  - `test_keeper_off_line_and_bisector`: keeper at (50.5, 1), shot from (40, 0), home attacking +x → 2.0 and 1.0; mirrored second half → same.
  - `test_completion_by_bin_counts_added_time_in_last_bin`.
  - `test_fit_xg_recovers_known_coefficients`: 400 synthetic rows from known coefficients → each within 0.05.
  - `test_shot_clips_categories`: the fixture gives one `first_time`, one `header` and one `late_pass` clip with minutes.
  - `test_shots_rows_have_targets`: every key of `shots_section` has a row.

Run: `uv run --project python/analytics pytest python/analytics/tests/test_shots.py -q`
Expected: FAIL (`ModuleNotFoundError: touchline_analytics.shots`).

- [ ] **Step 2: Implement `shots.py`, the wiring and `--only shots`**

Run the pytest command, then `pnpm --filter @touchline/calibrate exec vitest run test/cli.test.ts`. Expected: PASS.

- [ ] **Step 3: Compute the real rows**

Run: `uv run --project python/analytics python -m touchline_analytics.shots real`
Expected: the header share within 0.02 of 0.14 (a check on the XML parse), `late_completion_drop`, and the xG fit. Copy the drop into its row and the five coefficients into `shots.xgFit` (aggregates only).

- [ ] **Step 4: Measure the baseline**

Run: `pnpm realism --matches 16 --only shots --set <ruling 18 base> --runs out/p6-t2-runs --out docs/realism/p6-shots-baseline.md && rm -rf out/p6-t2-runs`
Expected: a full table. Check by hand that `first_time_share` and `header_share` are 0.

- [ ] **Step 5: Commit**

Message: `"feat(analytics): P6 shots section — shot types, conversion by technique and pressure, keeper at the shot, late completion; real rows and DFL xG fit from IDSSE; --only shots; baseline"` with the trailer.

---

### Task 3: SH1 — first-time finishes and lay-offs (wave 1; opus)

**Files:**
- Create: `packages/sim-core/src/firsttime.ts`, `packages/sim-core/test/firsttime.test.ts`
- Modify: the **first-time seam** in `step.ts`; the `firstTime` values in `params.ts`

**Interfaces:**
- Consumes: `ContactPlan`, `ShotHow`, `CONTROL`, `arrivalCos`, `contactDecision` (`contact.ts`); `contactPlan`, `executeContact` (Task 1); `xgOf`, `candidateContext`, `buildCandidatesIn`, `choiceShares`, `toOption` (`decide.ts`, read-only).
- Produces (in `firsttime.ts`):
  - `firstTimeShares(xg: number, cosD: number, layOff: boolean, scriptShot: number, ft: Params["firstTime"]): { shot: number; short_pass: number; hold: number }` (no pressure parameter, by ruling 4)
  - `firstTimeAim(cosD: number, ballMps: number, ft: Params["firstTime"]): { aimY: number; aimZ: number }`
  - `firstTimeEligible(dGoalM: number, contactZ: number, restart: RestartKind | null, isKeeper: boolean, p: Params): boolean`

- [ ] **Step 1: Write the failing tests** (`firsttime.test.ts`; `off` and `on` explicit)
  - `"eligible within 25 m, at foot height, in open play or from a corner or free kick; never a keeper, a throw-in or a goal kick"`: (24, 0.5, null, false) → true; (26, …) → false; z 1.2 → false; `"throw_in"` → false; `"corner"` → true, and false with `setPieces` 0; keeper → false.
  - `"the shot share rises with xG and with balls arriving from the goal side"`: shares sum to 1; `shot` at xg 0.3 > at xg 0.05; at cosδ −1 > at +1; `short_pass` is 0 when `layOff` is false.
  - `"execution: balls from behind and fast balls widen the aim"`: `firstTimeAim(-1, 10)` = {1, 1}; `firstTimeAim(1, 10).aimY` = 1.3; `firstTimeAim(-1, 22).aimY` = 1.2.
  - `"pressure lowers execution, not the choice"`: over 4000 `planShot` draws with the same mods, the on-target share at pressure 1 is below that at pressure 0 (precondition on existing code); `firstTimeShares` has no pressure input (a type-level check by arity: `firstTimeShares.length === 5`).
  - `"a first-time shot replaces the reception"`: a state fixture with a ground pass reaching a striker 12 m out, `on`, `b0` 20. In the resolve frame, no `reception`; a `shot` by the receiver with `first_time: true`; `action_probs` keys ⊆ {shot, short_pass, hold}; the pass is `successful` with `receiver_id` the shooter. Under `off`: a `reception` and no shot in that frame.
  - `"a lay-off is a one-touch pass to a teammate within 12 m"`: same fixture with `b0` −20, `layOffLogit` 20 and a teammate 8 m away: a `pass` from the receiver in the resolve frame, `first_time: true`, receiver within 12 m.
  - `"no contact decision on a foul, an offside, a block, a keeper claim or a loose ball, nor for a keeper or a receiver with a what-if override"`: each fixture under `on` with `b0` 20 gives no first-time shot; the override fixture's what-if pass is played.
  - `"rule off draws nothing on the contact stream"`: after a resolved pass under `off`, `w.rng.contact` state equals a fresh `substream(seed, "contact")`.
  - `"a forced keeper save is used up by a first-time shot"`: `keeper_heroics` active, `b0` 20: the shot is `saved` with `scripted: true` and the force is consumed.
  - `"mirrored after half-time"`: the fixture mirrored (home attacking −x) gives the same shot and the same cosδ.
  - `"in matches, about two in five open-play shots are first time (dt 0.1 and 0.04)"`: seeds 7 and 9, `on`: share of shots with `first_time` 0.2–0.6 over ≥ 40 shots; first-time conversion ≥ other conversion − 0.02.

Run: `pnpm --filter @touchline/sim-core exec vitest run test/firsttime.test.ts`
Expected: FAIL (`firsttime.ts` does not exist).

- [ ] **Step 2: Implement `firsttime.ts` and fill the seam** (rulings 3–6; draws on `w.rng.contact`)

Run the tests. Expected: PASS.

- [ ] **Step 3: Set `b0` and `layOffLogit`**

Run 16 matches with `--set <base>,firstTime.rule=1,firstTime.b0=<b>` for b in −2, −1, 0, then `layOffLogit` in −2.5, −1.5, −0.5 at the chosen b.
1. Pick b with `first_time_share` nearest 0.41, then the lay-off value that keeps passes per match within ± 20 of the baseline.
2. Commit both. Record every shots row, `goals_per_match`, the gate's `shots`, `on_target_share`, `blocked_share`, `save_rate`, `goals`, and passes per match. Delete the run folders.

- [ ] **Step 4: Gate and commit** (PASS, drift 0)

Message: `"feat(sim-core): SH1 first-time finishes and lay-offs decided at contact (firstTime.rule, off); b0 <b>: first-time share 0→<s>, conversion <c>/<o>, goals <g>"`.

---

### Task 4: SH2 — headers at goal (wave 1; opus)

**Files:**
- Create: `packages/sim-core/src/header.ts`, `packages/sim-core/test/header.test.ts`
- Modify: the **header seam** in `step.ts`; the `header` values in `params.ts`

**Interfaces:**
- Consumes: as Task 3 (`contact.ts`, `xgOf`), and `releaseShot`'s `how`.
- Produces (in `header.ts`):
  - `headerEligible(contactZ: number, inBox: boolean, isKeeper: boolean, h: Params["header"]): boolean`
  - `headShare(xgHeader: number, heading: number, scriptShot: number, h: Params["header"]): number`
  - `headerHow(heading: number, contactZ: number, h: Params["header"]): ShotHow` (`header: true`, `firstTime: true`, `mods: { skill: heading, aimY: aimK, aimZ: aimK, fromZ: contactZ, speed: speedShare }`)

- [ ] **Step 1: Write the failing tests** (`header.test.ts`)
  - `"eligible for a contact between 1.0 and 2.4 m in the box he attacks, mirrored"`: 1.5 m in the box → true; 0.8 m → false; 1.5 m outside the box → false; a home receiver at x −45 in the second half is in the box he attacks.
  - `"header xG is below foot xG at the same spot, and better headers head more"`: `xgOf(…, true, 0) < xgOf(…, false, 0)`; `headShare(x, 0.8) > headShare(x, 0.4)`.
  - `"a header starts at the contact height, flies slower and aims by heading"`: from equal rng states, a header plan's `ticks` exceed a foot shot's from the same spot; over 4000 draws, on-target share with heading 0.9 > with heading 0.3; the shot event has `body_part: "head"` and no weak-foot draw (the execution stream advanced one fewer `chance`).
  - `"a header replaces the reception; a high ball outside the box is controlled"`: a cross reaching a striker at 1.6 m in the box, `on`, `b0` 20: a `shot` with `body_part: "head"` in the resolve frame and no `reception`; the same ball 25 m out gives a `reception`.
  - `"after a won aerial duel the winner can head"`: with `aerial.rule` 1 and the attacker winning (forced by heading 1 against 0), the `aerial_duel` event precedes the header.
  - `"rule off: no header, nothing drawn"`.
  - `"in matches, headers appear (dt 0.1 and 0.04)"`: seeds 7, 9, 11, 13, `on` with `firstTime.setPieces` 1: header share of shots 0.05–0.25, ≥ 8 headers.

Run: `pnpm --filter @touchline/sim-core exec vitest run test/header.test.ts`
Expected: FAIL (`header.ts` does not exist).

- [ ] **Step 2: Implement `header.ts` and fill the seam** (ruling 8; draws on `w.rng.contact`)

Run the tests. Expected: PASS.

- [ ] **Step 3: Set `b0`**

Run 16 matches with `--set <base>,header.rule=1,header.b0=<b>` for b in −1.5, −0.5, 0.5. Pick b with `header_share` nearest 0.14 and commit it. Record the header rows, `conv_header`, the gate's `corners` and `goals`, and the attacker-won aerial contacts in the box per match (the volume P5 may raise). Delete the run folders.

- [ ] **Step 4: Gate and commit** (PASS, drift 0)

Message: `"feat(sim-core): SH2 headers at goal from high balls won in the box (header.rule, off); b0 <b>: header share 0→<s>, conversion <c>"`.

---

### Task 5: SH3 — saves that depend on the keeper's position (wave 1; sensitive `shot.ts`, approved; opus)

**Files:**
- Modify: `packages/sim-core/src/shot.ts` (`saveChance`, a new `saveGeometry`); the `saveGeo` values in `params.ts`
- Create: `packages/sim-core/test/savegeo.test.ts`

**Interfaces:**
- Consumes: `ShotOnTarget.from`, `goal`, `speed` (Task 1).
- Produces: `saveGeometry(s: ShotOnTarget, keeper: PlayerState): { offLineM: number; offBisectorM: number; flightS: number } | null` (null when `from`, `goal` or `speed` is missing).

- [ ] **Step 1: Write the failing tests** (`savegeo.test.ts`)
  - `"geometry: off the line, off the ball-goal line, flight time; mirrored"`: goal (52.5, 0), shot from (40, 0) crossing at y 2, speed 26, keeper at (50.5, 1) → offLine 2.0, offBisector 1.0, flight `hypot(12.5, 2) / 26`; the mirror (goal −52.5, keeper −50.5) gives the same.
  - `"rule on: a keeper off the bisector saves less, and so does a quick shot"`: under `on`, keeper on the bisector > keeper 1.5 m off it; flight 0.3 s < flight 0.8 s; keeper 4 m off the line < 2.2 m.
  - `"rule on: bDistance is not read"`: changing `shot.save.bDistance` leaves `saveChance` unchanged under `on` and changes it under `off`.
  - `"rule off ignores the geometry"`: `saveChance` with and without `from/goal/speed` is equal under `off`.
  - `"in matches, quick shots convert more (dt 0.1 and 0.04)"`: seeds 7 and 9, `on`: conversion of on-target shots with flight < 0.5 s exceeds that with flight > 0.8 s, each bin ≥ 25 shots.

Run: `pnpm --filter @touchline/sim-core exec vitest run test/savegeo.test.ts`
Expected: FAIL (`saveGeometry` is not exported).

- [ ] **Step 2: Implement** (ruling 10). Run the tests: Expected PASS.

- [ ] **Step 3: Set `bFlightS` and `bOffBisector`**

Run 16 matches with `--set <base>,saveGeo.rule=1,saveGeo.bFlightS=<f>` for f in 1.5, 2.5, 3.5, then `bOffBisector` in −0.3, −0.6, −1.0.
1. Pick the pair with the largest `conv_tight_minus_open` while the gate's `save_rate` moves by at most 0.05 from the baseline (the level is the tuner's, through `save_b0`).
2. Commit them. Record conversion by nearest defender, the save rate and goals. Delete the run folders.

- [ ] **Step 4: Gate and commit** (PASS, drift 0)

Message: `"feat(sim-core): SH3 save chance from keeper position and reaction time (saveGeo.rule, off); tight−open conversion <before>→<after>, save rate <s>"`.

---

### Task 6: SH4 — refit tiring for execution (wave 1; sensitive `execute.ts:46`, approved; sonnet)

**Files:**
- Modify: `packages/sim-core/src/execute.ts` (the body of `fatigueScale` only); the `execFatigue` values in `params.ts`
- Create: `packages/sim-core/test/fatigue-exec.test.ts`

**Interfaces:**
- Consumes: `fatigueScale` (Task 1); the real `late_completion_drop` (Task 2).
- Produces: `fatigueScale` under rule 1 (ruling 11).

- [ ] **Step 1: Write the failing tests** (`fatigue-exec.test.ts`)
  - `"rule off is the old factor exactly"`: for f in 0, 0.3, 1: `fatigueScale(f, off) === 1 + off.fatigue.executionK * f`.
  - `"rule on: flat below ref, rising after, by k and power"`: with k 0.5, ref 0.2, power 2: f 0.1 → 1; f 0.6 → 1 + 0.5·0.16; monotone over 0..1.
  - `"rule on with the defaults equals rule off"`: k 0.25, ref 0, power 1 → equal to off for f in 0..1 (the starting point is numerically the old behaviour).
  - `"tired kicks miss by more"`: 3000 `executeKick` draws at fatigue 0.6 against 0 under `on` with k 0.5: mean `errorM` ratio > 1.05.

Run: `pnpm --filter @touchline/sim-core exec vitest run test/fatigue-exec.test.ts`
Expected: FAIL (the rule-1 cases).

- [ ] **Step 2: Implement.** Run the tests: Expected PASS.

- [ ] **Step 3: Fit k and ref**

Run 16 matches with `--set <base>,execFatigue.rule=1,execFatigue.k=<k>,execFatigue.ref=<r>` over k in 0.25, 0.5, 0.8 and ref in 0, 0.2.
1. Pick the pair whose `late_completion_drop` is nearest the real one and commit it.
2. Record completion by bin, the gate's `completion`, and mean energy at 75–90 (info). Delete the run folders.

- [ ] **Step 4: Gate and commit** (PASS, drift 0)

Message: `"feat(sim-core): SH4 refit of how tiredness widens kick error (execFatigue.rule, off); k <k>, ref <r>: late completion drop <sim> against <real>"`.

---

### Task 7: Shot logit and xG refit (wave 2; sensitive `decide.ts`, approved; opus)

**Files:**
- Modify: `packages/sim-core/src/decide.ts` (the bodies of `xgCoefs` and `shotTerm` only); the `shotModel` values in `params.ts`
- Create: `packages/sim-core/test/shotmodel.test.ts`

**Interfaces:**
- Consumes: `xgCoefs`, `shotTerm` (Task 1); `shots.xgFit` (Task 2); Tasks 3–6 merged.
- Produces: rulings 12 and 13 under `shotModel.rule` 1.

- [ ] **Step 1: Write the failing tests** (`shotmodel.test.ts`)
  - `"rule on: xgOf reads shotModel.xg"`: with `shotModel.xg.b0` −2 under `on`, `xgOf` at (40, 0) equals sigmoid of the shotModel terms; under `off` it is unchanged.
  - `"rule on: the open-play shot term uses bXg, pivot and bRisk"`: `shotTerm(0.3, style, null, on)` = `bXg·(0.3 − pivot) + bRisk·risk`.
  - `"a restart keeps the old term, so P5's free-kick logit is untouched"`: `shotTerm(0.3, style, "free_kick", on) === 3 * (0.3 - 0.1) + 0.3 * style.riskTolerance`.
  - `"the fitted xG is lower for a header and for defenders in the cone"`: with the committed values, `xgOf(…, true, 0) < xgOf(…, false, 0)` and `xgOf(…, false, 2) < xgOf(…, false, 0)`.

Run: `pnpm --filter @touchline/sim-core exec vitest run test/shotmodel.test.ts`
Expected: FAIL.

- [ ] **Step 2: Implement and set `shotModel.xg`** to Task 2's fit. Run the tests: Expected PASS.

- [ ] **Step 3: Set `bXg` and `pivot`**

With every P6 rule on (`--set <base>,firstTime.rule=1,header.rule=1,saveGeo.rule=1,execFatigue.rule=1,shotModel.rule=1`), run 16 matches for bXg in 2, 3, 4 and pivot in 0.05, 0.1.
1. Pick the pair with `open_shots_per_match` nearest 17.1 and `setup_loose` nearest 0.13, and commit it.
2. Record the full shots section, `xg_per_shot`, goals and the gate's shot statistics. Record the `save_b0`, `aim_noise` and `shot_bias` values that would bring goals to 2.7, for Task 8 only. Delete the run folders.

- [ ] **Step 4: Gate and commit** (PASS, drift 0)

Message: `"feat(sim-core): shot logit and xG refit — xG fitted to DFL model xG, open-play shot term bXg <b>, pivot <p> (shotModel.rule, off); open-play shots <n>, xG/shot <x>"`.

---

### Task 8: Merge the P5 result, switch on, recalibrate, gate, re-pin, C5 replays, Results: P6 (wave 3; opus)

**Files:**
- Modify: `params.ts` (the five switches to 1), `params.test.ts` (P6 "ship switched off" → "ship switched on"), `calibrate/src/knobs.ts`, the spec (`## Results: P6 (date)`)
- Create: `packages/sim-core/test/shots-targets.test.ts`, `docs/realism/c5-review.md`
- Regenerate: `data/params/touchline-params.json`, `data/params/realism-baseline.json`, `docs/realism/realism-report.md`, `docs/realism/realism-deep-report.md`, the stats and manager goldens, and the seed pins by each file's rule (`services/agents/tests/conftest.py`, `packages/agent-gateway/test/e2e.test.ts`, the `whatif.test.ts` forced window, `wide.test.ts` CLAIM_SEEDS, the `carriers.test.ts` parity seed, the manager `situation` seed, the api library fixture)

**Interfaces:**
- Consumes: every task's recorded values; Task 7's suggested `save_b0`, `aim_noise`, `shot_bias`.
- Produces: the `shot_xg_slope` knob and the retargeted `xg_b0` (ruling 14).

- [ ] **Step 1: Merge `main` with P5** (ruling 19; precondition: P5 merged to `main` after the user's review, else Question 5)

```bash
git merge --no-ff main -m "merge: main (realism v2 P5) into realism-v2-p6"
```

Resolve conflicts by the Cross-phase contacts table: keep both sides in shared lists and import markers; take `main`'s generated files. Then run the sim-core suite and the gate with every P6 rule still 0.
Expected: PASS, **drift 0 against P5's baseline**: P6 is identity on top of P5. If not, stop and report.

- [ ] **Step 2: Switch on.** Set the five switches to 1 and flip the params test. Run the sim-core suite. For each red test: one asserting an exact shot or goal statistic P6 moves — check the new value is plausible, update it and name it in the commit; a real-target test — never loosen it (it becomes `it.fails`).

- [ ] **Step 3: Knobs.** Add `shot_xg_slope` (`shotModel.bXg`, 1.5–4.5, step 0.5); point `xg_b0` at `shotModel.xg.b0` with range fit ± 0.5. In the calibrated file, set `save_b0`, `aim_noise` and `shot_bias` to Task 7's suggestions before tuning.
Run: `pnpm typecheck && pnpm --filter @touchline/calibrate exec vitest run test/tune.test.ts`. Expected: PASS.

- [ ] **Step 4: Recalibrate** (30–40 minutes, background): `pnpm calibrate --from data/params/touchline-params.json --out data/params/touchline-params.json --matches 24 --rounds 1 --workers <N>`. Record the loss and every knob that moved, in particular `shot_bias`, `xg_b0`, `shot_xg_slope`, `save_b0`, `aim_noise`, `box_intensity` and `exec_scale`.

- [ ] **Step 5: Re-baseline and gate.** `UPDATE_REALISM_BASELINE=1 pnpm --filter @touchline/calibrate exec vitest run test/realism-gate.test.ts --disableConsoleIntercept`, then the gate. Expected: PASS, held-out loss < 30.
**If the loss is 30 or more, STOP and diagnose before any re-tuning:** run `pnpm realism --matches 16` and `--only shots`, list the largest |z|, ablate each P6 switch (16 matches each), and report to the user, who picks from Question 4. The gate is never widened.

- [ ] **Step 6: Before and after the tuner, and P5's rows.** Run 16 matches `--only shots` on the pre-tuner and tuned params; record any shots row a knob turned NOT MET. Re-measure P5's corner shots per 100, direct free-kick shot share and long goal-kick completion (ruling 20), and the header share against Task 4's value now that P5's aerial volume is in.

- [ ] **Step 7: Real-target test** (`shots-targets.test.ts`; calibrated params, test teams, seeds `[7, 9, 11, 13, 15, 17, 19, 21]`; one cached measure pass in the style of `passing-targets.test.ts`)

| Case | Bound |
|---|---|
| `"about two in five open-play shots are first time (SH1)"` | 0.33–0.49 |
| `"first-time shots convert better than the rest (SH1)"` | conv_ft − conv_other ≥ 0.02 |
| `"about one shot in seven is a header (SH2)"` | 0.10–0.18 |
| `"tight shots convert better than open ones (SH3)"` | conv_tight − conv_open ≥ 0.03 |
| `"goals stay about 2.7 per match"` | 2.3–3.1 |
| `"late-match completion falls as in real matches (SH4)"` | real drop ± 0.02 |

Each case that fails becomes `it.fails`, titled `NOT MET:`, with the measured value in a comment; bounds unchanged. Run again: PASS.

- [ ] **Step 8: Reports and the manager A/B**

Run: `pnpm realism --matches 64 --runs out/p6-deep-runs --out docs/realism/realism-deep-report.md && rm -rf out/p6-deep-runs`, then the 16-match `realism-report.md` likewise. Record every shots row (conversion splits only from the 64), the shot-type table, conversion by pressure, C1–C4 and goals.
Run the manager A/B for information: `pnpm managers:ab --arms none,rules --seeds 40 --out out/p6-ab --runs out/p6-ab-runs`, then delete `out/p6-ab-runs`.

- [ ] **Step 9: Re-pin and goldens.** Run `find_test_seed.py` as P3 Task 10 did; re-pick each failing seed by the rule written next to it; regenerate the stats and manager goldens and check the diffs are plausible.

- [ ] **Step 10: Run everything.** `pnpm test -- --no-file-parallelism && pnpm typecheck && uv run --project python/analytics pytest python/analytics/tests && uv run --project services/agents pytest services/agents/tests`. Expected: PASS. A red scenario 9-of-10 test gets a script nudge, never a looser bound.

- [ ] **Step 11: Produce the C5 replay set** (ruling 21)

```bash
for s in 3000 3001; do pnpm sim --seed $s --match-id c5-$s --out out/c5-review/c5-$s; done
pnpm sim --scenario keeper_heroics --seed 1 --match-id c5-heroics --out out/c5-review/c5-heroics
pnpm sim --scenario late_comeback --seed 1 --match-id c5-comeback --out out/c5-review/c5-comeback
uv run --project python/analytics python -m touchline_analytics.shots clips out/c5-review/* > docs/realism/c5-review.md
```

Check that `c5-review.md` lists at least 3 clips per category per match (fewer is recorded, not padded), and that `pnpm api --library out/c5-review` lists all four matches. Add to the top of `c5-review.md` how to watch: `pnpm api --library out/c5-review` and `pnpm web`, start each match at the listed minute ("from minute"), and what to judge in each category (finishing technique and timing, header situations, lay-offs, keeper positioning on quick shots, late-match passing, and C5's supporters, goal-side defenders and shielding).

- [ ] **Step 12: Results and commit**

Add `## Results: P6 (YYYY-MM-DD)` in the style of Results: P3: switched on and every value the tasks set; deviations (rulings 3–5, 8–14, 19 and measurement changes); the merge of P5 and its identity check; calibration and the pre/post-tuner comparison; the gate; the shot-type table and conversion by pressure (64 matches) against Task 2's baseline; xG per shot; goals; C1–C4; the real-target tests and their `it.fails`; P5's re-measured rows; the manager A/B; **C5: PENDING — the user's replay review of `out/c5-review` with `docs/realism/c5-review.md`**; gaps; carried items.

Commit with message `"feat: realism v2 P6 on — first-time finishes and lay-offs, headers, keeper-position saves, tiring refit, shot logit and xG refit; on top of P5; recalibrated, re-baselined, re-pinned; C5 replay set"` and the trailer.

Hand the replay set to the user. Merge into `main` only after the user has seen the results and given the C5 verdict, which is then recorded in the spec and the realism contract.

---

## Self-review

**Spec coverage.**

| Spec item | Where |
|---|---|
| SH1: decision at contact within about 25 m; shoot, control or lay off | Task 3 (rulings 2–6) |
| SH1: weight from xG at contact and arrival angle; pressure lowers execution, not the choice | Task 3 (rulings 4, 5; the arity test) |
| SH1 targets: 41 % of shots, 55 % of goals, 12 % against 7 % | Task 2 rows; Task 3 Step 3; Task 8 Steps 7–8 |
| SH2: high ball 1.0–2.4 m in the box, `xgOf(header = true)`, heading | Task 4 (ruling 8; ruling 9 on `resolve.ts`) |
| SH2 targets: 14 % of shots, about 6 % conversion | Task 2 rows; Task 4 Step 3; Task 8 |
| SH3: distance off the line, off the ball–goal line, reaction time | Task 5 (ruling 10) |
| SH3 target: conversion rises with defender proximity | `conv_tight_minus_open`; Task 5 Step 3; Task 8 Step 7 |
| SH4: refit tiring at `execute.ts:46` | Task 6 (ruling 11) |
| Shot logits and xG refit; goals about 2.7 | Tasks 2 (fit), 7, 8 (rulings 12–14) |
| Shot-type table, conversion by pressure | Task 2 section; Task 8 Step 8 |
| Manager A/B for information | Task 8 Step 8 |
| C5: the user's replay review | Task 8 Step 11 (ruling 21, Question 3) |
| Conventions: switches, streams, Python diagnostics, agents, exit checks, splitting | Global Constraints; rulings 6, 7, 15; Task 8 |
| Parallel with P5; calibrate on P5's result | Waves, ruling 19, Cross-phase contacts, Task 8 Step 1 |

**Step scan.** Code steps name the function, file, signature and spec values; test steps name the test and its assertions with the values. `<…>` markers appear only in commit-message templates and `--set` sweeps filled from the task's own measurement. The real `late_completion_drop` value is computed in Task 2 Step 3 by a named command, not left open.

**Type consistency.** These names keep one signature across Task 1's table and their consumers: `ContactPlan`, `ShotHow`, `OPEN_SHOT`, `CONTROL`, `arrivalCos`, `contactDecision`, `contactPlan`, `executeContact`, `firstTimePlan`, `headerPlan`, `releaseShot(…, how)`, `fatigueScale`, `xgCoefs`, `shotTerm(xg, style, restart, p)`, `saveGeometry`, `firstTimeShares`, `firstTimeAim`, `firstTimeEligible`, `headerEligible`, `headShare`, `headerHow`, and the Python `match_shots`, `shots_section`, `shot_clips`, `real_shot_rows`, `fit_xg`, `real_completion_by_bin`.

**Review Focus.** dt 0.04: Tasks 3 and 4; second half: Tasks 3, 4, 5 and Task 2's Python tests; non-reception flights: Task 3; keeper and override: Task 3; scenario scripts: Tasks 3 and 4.

**Proportion.** Shorter than plan 8d; code appears only as signatures, the params test and test assertions.

## User decisions (2026-10-19)

- **Spatial statistics in the gate (P5 Q1):** add the seven spatial statistics to the |z| < 3 check from P5's final task on.
- **xG (P6 Q2):** refit to DFL's model xG on the 7 matches.
- **C5 (P6 Q3):** 4 matches plus a clip list, with no LLM.
- **P5 gate fallback (P5 Q2):** switch off rotations, then runs and overlaps, then zonal marking, then the pause and recovery changes. S1–S9 and G3 are always kept.
- **Every other question in either plan:** the plan's recommended option, as written.
- **Execution:** P5 and P6 run in parallel with subagent-driven development. Wave 0 starts on 79d6088 before P4 merges, and no measurement is taken until the branch is merged with P4's result (P5 plan line 38; P6 Task 8).

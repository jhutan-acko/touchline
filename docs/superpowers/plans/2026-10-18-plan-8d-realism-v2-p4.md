# Realism v2, P4: duels and transitions — implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. This plan is built for **parallel** execution: read "Parallel execution" before starting.

**Goal:** Duels, fouls and transitions behave like real football. Tackles are won or lost by approach, support, carrier speed and zone (T2). Fouls depend on where and from which side the challenge comes (T3). Attackers, dribbles and headers produce their own fouls, and contested high balls become aerial duels (T4). After a loss, nearby players counter-press, the rest pause and then some sprint back (A4). Teams press on triggers, with a second presser, a real role mix, CBs stepping out and zonal lane marking (A5). P3's carried fixes M5 and M6 land too. The phase ends with the gate green on recalibrated parameters and every P4 target re-measured, MET or NOT MET.

**Architecture:**
- **Seams first.** Task 1 adds every P4 params block (all off), four RNG streams, the `recover` intent, the flight-foul and transition/press state, and eight banner-delimited seam blocks in `step.ts`. Each seam's rule-0 body is today's code, so the output is bit-identical (gate drift 0).
- **One owner per block.** Each wave task fills one seam block, plus its own new module, its own test file and the values of its own params block. Tasks in the same wave never edit the same lines.
- **Switches.** Every behaviour ships behind a `rule` switch (validated 0 or 1). Task 10 switches everything on, recalibrates, re-baselines and re-pins.
- **Diagnostic first.** Task 2 adds a Python `duels` section to the realism report, with the real aggregates and `--only duels`, and commits the P3 baseline. Every later task measures before and after with it.

**Tech stack:** TypeScript (Effect monorepo, vitest), Python 3 (uv, pytest, numpy), pnpm 11.

**Spec:** `docs/superpowers/specs/2026-10-13-sim-realism-v2-design.md`. The relevant sections are:
- "Decisions";
- "Conventions for every phase";
- "Evaluation changes";
- "P4: duels and transitions";
- "Results: P3", in particular "Gaps outside P3", "Carried to P4/P5" and "Rulings".

The evidence is in `touchline-worktrees/analysis-positioning/`, outside the repo: `tackles-report.md`/`tackles.json`, `transitions-report.md`, `finalthird-report.md` (B2), `carrier-report.md` (C1) and `offball-report.md` (B1, B2). The metric definitions are in that folder's `tk_analysis.py`, `tk_real_events.py`, `trans_analysis.py` and `ft_analysis.py` (`pressing()`); Task 2 may read these scripts. Only the aggregates quoted in this plan may be committed.

**Starting point (Results: P3; 64 matches unless noted).**
- **Gate:** loss 26.87, all |z| < 3.
- **Fouls:** 13.4 per match against 22.9 (C2 z −2.05). The only foul kind is a defender's tackle, with a box factor of 0.2.
- **Discipline:** 0.75 sent off per match against 0.29 real. The calibrated `yellow_per_foul` is 0.45, because the tuner buys back cards that the low foul count loses. Penalties 0.09 against 0.43.
- **Duels (analysis on the pre-P1 engine; Task 2 re-measures):**
  - aerial duels 19 per match against 47;
  - defender wins 0.53 of tackles and 0.70 of take-ons, against 0.48 real;
  - 75 % of sim duels come from behind (real 34 %);
  - no attacker, take-on or aerial fouls;
  - free kicks within 30 m about 2 per match against 0.86.
- **Marking and pressing:**
  - tightly marked receivers 0.100 (real 0.09, MET);
  - near-1 completion 0.474 (0.70);
  - open teammates at 4–10 m 0.47 (0.33);
  - ball pressure z +1.56;
  - C3 shot-share SD 0.227 (≤ 0.18).
- **Distance:** outfield 9.16 km per 90 against 10.88 (gate z −2.73).

## Setup (before Task 1)

Branch from `main` (95f2a5f or later, with this plan committed):

```bash
cd /Users/jhutan.debnath/Documents/GitHub/microsoft-hackathon/touchline
git worktree add ../touchline-worktrees/realism-v2-p4 -b realism-v2-p4 main
cd ../touchline-worktrees/realism-v2-p4 && pnpm install
```

`realism-v2-p4` is the **integration branch**. Every path below is relative to a worktree of it.

## Parallel execution

### Dependency graph

```
Task 1 (scaffold: params, streams, state, seams) ──┬──> Task 3 (T2 tackle success) ───┬──> Task 4 (T3/T4 fouls and cards) ──┐
Task 2 (diagnostic: duels section, baseline) ──────┤    Task 5 (T4 aerial duels) ──────┤                                    │
                                                   ├──> Task 6 (A4 transitions) ──────┼──> Task 7 (A5 team pressing) ───────┼──> Task 10 (switch on,
                                                   ├──> Task 8 (A5 zonal marking) ────┤                                    │     recalibrate, gate,
                                                   └──> Task 9 (M5, M6 carry fixes) ──┘                                    │     re-pin, results)
                                                                                     (Tasks 5, 6, 8, 9 also feed 10) ──────┘
```

### Waves

| Wave | Tasks, run concurrently | Starts when |
|---|---|---|
| 0 | Task 1, Task 2, and the pre-flight scan | Setup is done |
| 1 | Task 3, Task 5, Task 6, Task 8, Task 9 | Tasks 1 and 2 are merged |
| 2 | Task 4, Task 7 | Every wave-1 task is merged, **Task 3 first** |
| 3 | Task 10 | Tasks 4 and 7 are merged |

- **Merge Task 3 (T2) first** (tackles-report: "T2 before A5", "T2 and T3 before box loading").
  - Task 4 sets foul rates on top of T2's win rates, because fouls are drawn on lost tackles.
  - Task 7 measures pressing with T2, A4 and zonal marking on.
- **Pre-flight scan.** P3's scan found 6 task-blocking plan bugs. Before dispatching Task 1, run a read-only scan (opus) of this plan against the code at the integration base. It looks for:
  - fixture contradictions;
  - seam signature mismatches;
  - "off" assertions that rely on `DEFAULT_PARAMS`;
  - rule-0 non-identity.

  Its findings become rulings carried into each task's brief. It runs alongside Task 2.

### File ownership

A task creates or modifies only the files listed for it. `step.ts`, `params.ts` and `types.ts` are shared: Task 1 creates banner-commented blocks in `step.ts`, and each wave task edits only its own block, plus its own import lines under its own import marker. **Shared files are in bold.**

| Task | Model | Owns (create or modify) | In **`step.ts`** | In **`params.ts`** |
|---|---|---|---|---|
| 1 | opus | **`sim-core/src/{params,types,step}.ts`**, `sim-core/src/resolve.ts` (`Resolution.contest` type only), `schema/src/domain.ts` (`Intent` literal), `sim-core/test/params.test.ts` (append) | Import markers, eight seam blocks, the call sites listed in Task 1 | Types and every P4 block (all off), switch validation |
| 2 | opus | `python/analytics/touchline_analytics/duels.py` (new), `report.py`, `targets.py` (`HAND_BLOCKS`), `python/analytics/tests/test_duels.py` (new), `data/params/targets-idsse.json` (new `duels` block), `calibrate/src/realism.ts` (`--only duels`), `docs/realism/p4-duels-baseline.md` (new) | — | — |
| 3 | sonnet | `sim-core/src/duel.ts` (new), `sim-core/test/tackle.test.ts` (new) | **Tackle seam** | `tackle` values (not `rule`) |
| 4 | opus | `sim-core/src/fouls.ts` (new), `sim-core/test/fouls.test.ts` (new), appended cases in `sim-core/test/distribution.test.ts` and `sim-core/test/cards.test.ts` (test-only) | **Foul seam** | `fouls` values (not `rule`) |
| 5 | opus | `sim-core/src/resolve.ts` (aerial branch only), `sim-core/test/aerial.test.ts` (new) | **Aerial seam** | `aerial` values (not `rule`) |
| 6 | opus | `sim-core/src/transition.ts` (new), `sim-core/test/transition.test.ts` (new) | **Transition seam** | `transition` values (not `rule`) |
| 7 | opus | `sim-core/src/press.ts` (new), `sim-core/test/press.test.ts` (new) | **Team-press seam** | `press` values (not `rule`) |
| 8 | sonnet | `sim-core/src/offball.ts` (append only), `sim-core/test/marking.test.ts` (new) | **Marking seam** | `marking.laneShare`, `cbStepM`, `dropMps` |
| 9 | sonnet | `sim-core/src/release.ts`, `sim-core/test/carryfix.test.ts` (new) | **P3 boot-block seam** and **P3 release seam** (now P4 Task 9's) | `release.capS` |
| 10 | opus | Everything else: the `rule` switches, `params.test.ts`, `calibrate/src/knobs.ts`, `data/params/*`, `docs/`, seed pins, goldens, `sim-core/test/duels-targets.test.ts` (new) | anything left | the eight switches |

- **Tests import modules directly** (`../src/duel.js`), so no task touches `index.ts`.
- **"Values (not `rule`)"** means numbers in the task's own block only.
- **The calibrated file** `data/params/touchline-params.json` is Task 10's alone. A wave task that finds a better value for an existing knob (for example `defending.foulPerTackle`) records it in its report and does not commit it.

### How to run a wave

For each task in the wave, from the integration worktree:

```bash
cd /Users/jhutan.debnath/Documents/GitHub/microsoft-hackathon/touchline-worktrees/realism-v2-p4
git worktree add ../p4-task<N> -b p4-task<N> realism-v2-p4
cd ../p4-task<N> && pnpm install
```

Merge finished tasks one at a time (`git merge --no-ff p4-task<N> -m "merge: P4 task <N> (<short name>)"`). Then check the merged branch:

```bash
pnpm --filter @touchline/sim-core exec vitest run --no-file-parallelism
pnpm --filter @touchline/calibrate exec vitest run test/realism-gate.test.ts --disableConsoleIntercept
```

Expected: PASS with every drift exactly 0 (waves 0–2 change no switch). Then remove the worktree: `git worktree remove ../p4-task<N> && git branch -d p4-task<N>`.

- **On a merge conflict** in `step.ts`, `params.ts` or `types.ts`, two tasks edited neighbouring blocks. Keep both sides and never drop a seam body.
- **Measurements.** Measure with `pnpm realism --matches 16 --only duels --set <keys> --runs out/p4-t<N>-runs --out out/p4-t<N>-<label>.md`.
- **Disk.** A 16-match run is about 1.3 GB. Delete the run folder right after each report (`rm -rf out/p4-t<N>-runs`), and check `df -h .` before starting one.

## Global Constraints

- **Data.** Never commit `data/raw/`. Commit only aggregate real statistics, and copy from the analysis folder only the aggregates quoted in this plan.
- **Gate and tests.**
  - The gate is never widened: `GATE_LOSS` 30, `DRIFT_Z` 3.5, `WITHIN_1SD` 11, `WITHIN_2SD` 17, `PHYSICS_INSIDE` 2, and no statistic is dropped.
  - Tests are never loosened.
  - A real target that is still missed goes in `it.fails`, unwidened, with a `NOT MET:` title and the measured value in a comment.
- **Sensitive files.**
  - `decide.ts` and `execute.ts` are untouched in P4.
  - `resolve.ts` changes only in its aerial branch (Task 5) and in one optional type field (Task 1). That is the spec's approved aerial part.
  - **The shot model is untouched** until P6: `shot.ts`, `xgOf`, the shot logit and `releaseShot`.
  - No P5 work: role moves, set-piece shapes and keeper catch volume.
- **Determinism.** The engine stays deterministic for a seed. P4's new random behaviour draws only from four new named streams, `substream(seed, concern)`:

  | Stream | Draws |
  |---|---|
  | `foul` | Attacker, take-on and aerial foul draws |
  | `aerial` | Aerial-duel winners |
  | `counter` | Counter-press joins and recovery triggers |
  | `press` | Second-presser draws |

  With every P4 rule at 0, no new draw happens and every existing stream keeps its sequence. No `Math.random`, no `Date`.
- **Defaults.** Every P4 behaviour ships off:
  - `tackle.rule`, `fouls.rule`, `aerial.rule`, `transition.rule`, `press.rule`, `marking.rule`, `firstTick.scopeRule` and `release.rejudge` are 0;
  - `release.capS` is 0, meaning no cap.

  `paramsFromJson` rejects any switch other than 0 or 1. Only Task 10 turns them on.
- **Test fixtures.** Every test defines explicit `off` and `on` params (`{ ...P, tackle: { ...P.tackle, rule: 0 } }`). It never uses `DEFAULT_PARAMS` as "off", because Task 10 flips the defaults.
- **Test validity.**
  - A mechanism test asserts only what its rule adds, compared against the same fixture under `off`.
  - Before its main assertion, it asserts the fixture's precondition, so it cannot pass vacuously and does not contradict existing engine behaviour (P3 F1, F2, F11).
- **Tick rate.** Every time window is in seconds and converted with `Math.round(s / dt)`: 3 s, 1.5 s, 2.5–8 s, and the 1.5 s back-to-goal window. Each window test runs at dt 0.1 and at dt 0.04 (25 Hz).
- **Team frame.** u = `x · dirOf(side, period)` (`attackX`); u = +52.5 is the opponent's goal line. Zones are the analysis zones: own third u < −17.5, final third u > 17.5, box u > 36 and |y| < 20.16. The keeper-hands test is `possession.inHands === true` (P1 `keeper.handsRule`).
- **Commands.**
  - Tests: `pnpm --filter <pkg> exec vitest run --no-file-parallelism`.
  - Gate: `pnpm --filter @touchline/calibrate exec vitest run test/realism-gate.test.ts --disableConsoleIntercept`.
- **Commits.** Every commit message ends with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Never use bare `git stash`; use `git stash push -m <name>` and pop it by name. Merge to `main` only after the user has seen the results.
- **Region ownership.** Edit only the region the ownership table gives your task. A change you need elsewhere is a plan bug: stop and report it.
- **Agents.** The decision log format, `overridePass` and the recorded options are unchanged (P4 does not touch `decide.ts`). The frame `intent` vocabulary gains `recover`, an additive change.
- **No new event types.** New fouls are `foul` events whose `attrs.kind` is `"tackle"`, `"take_on"`, `"shielding"` or `"aerial"`. New duels are `aerial_duel` events. The pass-length `EventType` classification and the TS/Python metric parity are therefore unaffected.

## Rulings on the spec

Decisions taken while planning, where the spec was silent, ambiguous, or in conflict with the code or data. Task 10 copies them into the results.

**User decisions (2026-10-18), on the planner's open questions:**
- **Take-on win rate** (defender 0.70 against 0.48 real): report only, as NOT MET. P4 adds take-on fouls but does not change who wins.
- **Penalties** (0.09 against 0.43): record as NOT MET; box occupancy is P5. Do not inflate box fouls to compensate, and do not widen the box foul factor's knob range for it.
- **Gate fallback order in Task 10:** if switching everything on fails the gate, diagnose first, then switch off in this order: press (Task 7), transitions (Task 6), aerial (Task 5). Always keep the discipline fix (Task 4). Stop and report to the user before merging anything partial.
- **Press-run speed** (real peak 5.1 m/s, sim 6.4): out of P4 scope; record it as a gap.

1. **Params names.** The new blocks are `tackle` (T2), `fouls` (T3, ground T4), `aerial` (aerial T4), `transition` (A4) and `press` (A5 pressing). Existing blocks gain fields: `marking` gets `rule`, `laneShare`, `cbStepM` and `dropMps`; `firstTick` gets `scopeRule` (M5); `release` gets `capS` and `rejudge` (M6).
2. **T2 terms** (tackle attempts in `duels()`; `step.ts:565` today). Under rule 1:

   ```
   logit = tackle.base + 3(tackling − dribbling) + approach + supportLogit·min(n, supportMax) + speedLogit·|carrier v| + (carrier in the box he attacks ? boxLogit : 0)
   ```

   - **Approach.** Measured as the analysis does: the tackler's bearing from the carrier, relative to the carrier's velocity. Below `headingMinMps` (1 m/s) the carrier's attack direction is used instead. Under `frontDeg` (60°) the approach is front, +0.35; at `behindDeg` (120°) or more it is behind, −0.35; side is 0.
   - **Support (n).** The defending outfielders other than the tackler within `supportM` (5 m) of the carrier; keepers and sent-off players are excluded. The spec's "+0.4 per supporting defender within 5 m (up to 2)" is `supportMax` 2.
   - **Carrier speed.** −0.1 per m/s (spec "carrier speed"; real 0.53 slow against 0.45 fast, about 3 m/s apart).
   - **Box.** +0.3.
   - **`tackle.base`** replaces `defending.tackleBase` under rule 1. Task 3 sets it so tackle attempts are won 0.48 overall.
   - **Scope.** T2 applies to tackle attempts only, the spec's anchor. The take-on model keeps its own logistic and gains only fouls (ruling 5). The pooled ground-duel win (tackles plus take-ons) is reported for information.
3. **T3 foul chance.** Under rule 1, after a tackle that the defender does not win, the existing `referee` draw uses

   ```
   p = defending.foulPerTackle · zone(u, box) · angle(bearing) · mods.foul · booked
   ```

   - **Zone.** Measured on the carrier's u in his own attacking frame: 1.0 at u ≤ 0 (own half), linear to `finalThird` 0.4 at u = `finalThirdU` 17.5, 0.4 beyond that, and `box` 0.12 inside the box he attacks.
   - **Angle.** Front 1.0, side `side` 1.6 and behind `behind` 2.4. The side value is a ruling; the real per-duel foul rates are 0.05, 0.08 and 0.12.
   - **What it replaces.** `defending.boxFoulFactor` is not read under rule 1, which replaces the flat rate and the box ×0.2.
   - **The base.** `defending.foulPerTackle` stays the base, so the `foul_per_tackle` knob keeps its meaning.
   - **Draw count.** The draw is still one `referee` draw per lost tackle; only its probability changes.
4. **Attacker fouls** (T4, "shielding or holding"). When a tackle attempt fires and the carrier moves slower than `fouls.shieldSpeedMax` (2 m/s), the carrier fouls the tackler with chance `fouls.attackerShare` × the carrier's booked factor × his side's `mods.foul`. The draw is on the `foul` stream and comes before the win draw. The result is a `foul` with kind `shielding`, offender the carrier, and a free kick to the tackler's side at the tackler.
5. **Take-on fouls.** When the carrier **beats** his defender in a take-on, the beaten defender fouls him with chance `fouls.takeOnShare` × zone × angle × booked × `mods.foul` (`foul` stream). The result is a `foul` with kind `take_on`; the dribble's carry does not start. These count among the spec's about 15 defender fouls.
6. **Aerial duels.** No `jumping` attribute exists, and P4 adds none: that would change league data and agent interfaces.
   - **Who contests.** Under `aerial.rule` 1, `resolveFlight` makes **no draw** for high balls. When an aerial contact (z > `controlHeightM`) is reached by one side, it reports the best opponent whose reachable disc misses the contact by at most `aerial.contestM` as `Resolution.contest`. When both sides reach it, it reports the other side's best qualifier.
   - **The winner.** The step seam draws the winner on the `aerial` stream with `sigmoid(bHeading·Δheading + bSlack·Δslack)`, where slack is metres of reach margin (negative for a contender). Slack is the "jumping" proxy: who arrives better placed.
   - **The contact point** stays the first qualifier's contact.
   - **Volume.** Task 5 sets `contestM` so aerial duels are about 47 per match.
7. **Aerial fouls.**
   - **Who.** With chance `aerial.foulShare` × zone (the victim's frame, at the contact) × the offender's booked factor × `mods.foul`, the duel loser fouls the winner.
   - **When.** The foul is decided at release, on the `foul` stream, and stored on the flight as `Flight.foul`.
   - **The pass.** Its outcome is `successful` if the victim is the passer's teammate, else `intercepted`. No reception event is emitted, and the keeper-comes and heads-away branches are skipped.
   - **At resolution.** `foulAndCards(offender, victim, "aerial", contact)` books and restarts: a penalty if the victim is in the box he attacks, else a free kick at the contact.
   - **If something changed in flight.** The foul is dropped if either player has been sent off since release. If the offender has been booked since release, it is kept only with chance `bookedFoulFactor` (`foul` stream). This keeps `cards.test`'s "booked players commit no fouls" true.
8. **Cards.** P4 adds no card mechanism. Every foul kind goes through `foulAndCards`, so foul cards scale linearly with fouls through `yellowPerFoul` (× `bookedYellowFactor` for booked offenders), plus the P1 conduct cautions (1.7 per match).
   - **The arithmetic.** With fouls near 22.9, the real 3.29 foul yellows per match need `yellowPerFoul` ≈ 0.144. The P1 value 0.15 then gives about 5 cards per match, against the gate's `cards` target of 5.29. Second yellows fall with it, toward the real 0.29 sent off.
   - **Calibration.** Task 10 starts `yellow_per_foul` at 0.15 and narrows its knob range to 0.10–0.25, so the tuner cannot buy back cards when fouls miss.
   - **Targets** (Task 2 rows): yellows 5.0 per match, sent off 0.2–0.3, cards per foul 0.14.
9. **A4 "loss".** A live-play possession change:
   - `changePossession` with a side change (won tackles, lost take-ons, loose-ball recoveries);
   - an interception in `resolveFlightNow`.

   Restarts are not losses, and `startRestart` clears the transition state.
10. **Counter-press.**
    - **Who joins.** At the loss, each losing outfielder (not a keeper, not sent off) joins with the spec's chance for his distance to the ball. Any role may join (no role multipliers). The draws are made once, on the `counter` stream.
    - **What joiners do.** For `windowS` (3 s), while the opponents have the ball and it is not a keeper's ball in hands, joiners run to the carrier's intercept point, or to the loose ball, with a speed cap of `transition.speed` 4.5 m/s. They carry a `press` intent on the winner, live until the window ends.
    - **What it replaces.** During the window, the losing side's hazard-started team press is off; this replaces the spec's "nearest player only".
    - **When it ends.** At `windowS`, at the next loss, or at a restart.
11. **Reaction pause.** The spec's "the losing team holds speed about 1.5 s before turning" is read as holding course. For `pauseS` (1.5 s), a losing outfielder who is not a joiner and is more than `pauseRadiusM` (10 m) from the ball keeps going: target = position + velocity × 1 s, speed cap = min(current speed, `pauseShare` 0.55 × vmax). This reproduces the real line still stepping up through the change, and the real speed dip (0.87× the speed 1 s before, at 0.8–1.4 s).
12. **Recovery sprints.**
    - **Who.** A losing outfielder who is not counter-pressing.
    - **When and how often.** From `recoverFromS` (2.5 s) to `recoverToS` (8 s) after the loss, while the ball is still lost, at a per-second hazard of `recoverRatePerS` × ramp(t). The ramp goes 0 → 1 over 2.5–5 s, holds at 1 over 5–6 s (`recoverPeakS`) and falls to 0 at 8 s.
    - **Who is likelier.** The hazard is × `recoverBehindFactor` (0.33) if he is more than 10 m goal-side of the ball in his team's frame (u − ball u < `recoverUpfieldM` −10).
    - **The run.** A new `recover` intent (engine and schema), targeting his out-of-possession shape spot at trigger time, at `recoverSpeedShare` 0.9 × vmax, for `recoverS` 1.5–3 s (`counter` stream).
    - **Tuning.** Task 6 sets `recoverRatePerS` so about 15 % of the losing team runs back at 5–6 s.
13. **A5 triggers** replace the even hazard by multiplying it.
    - **Back to goal (× `backToGoalLift` 2).** The carrier received a completed pass at most `backToGoalS` (1.5 s) ago, and the ball arrived moving toward the opponents' goal at more than `backToGoalBallMps` (5 m/s). This is the analysis definition (`ft_analysis.py`).
    - **Own third (× `ownThirdLift` 2).** The ball is in the pressing team's own third.
    - **Both** give ×4. `press.rateScale` (start 1) re-normalises the hazard; Task 7 sets it toward 405 press episodes per 90 open minutes.
14. **Second presser.**
    - **When.** A live first presser within `secondM` (12 m) of the carrier, the spec's "a teammate within 12 m".
    - **Who.** The next-best presser (ruling 15's score) within `secondRadiusM` (15 m) joins with chance `secondShare` (0.45, offball-report B2). The draw is once per first-press start, on the `press` stream.
    - **Where.** He takes the cover-shadow spot `shadowM` (4 m) from the carrier, toward the carrier's nearest other teammate.
15. **Who presses.** The presser is the outfielder within 18 m with the smallest distance ÷ `roleWeight[role]`; the choice makes no draw. DM counts as CM. Task 7 tunes the weights (start: CB 0.6, FB 0.9, DM 1, CM 1, AM 0.8, W 1, ST 0.7) to the real presser mix: CM 37 %, W 19 %, FB 13 %, AM 11 %, ST 11 %, CB 10 %.
16. **CBs step out** (marking seam). A CB marking an ST or AM who is dropping (velocity toward his own goal above `dropMps`, 1 m/s) follows him tightly while the attacker is at most `cbStepM` (10 m) upfield of the CB's anchor: the old goal-side spot at weight 1. Beyond 10 m the CB releases to the zonal target.
17. **Zonal marking.**
    - **The target.** The marker goes `weight` of the way from his anchor to a lane spot `laneShare` (0.4) of the way from the **ball** to the attacker; the ball is used because a pass may be in flight. The width-slack clamp stays.
    - **Targets.** Tightly marked about 9 % (P3 0.100, keep it in 0.06–0.12); teammates open by 3 m 7.96 per pass; clear lanes 4.95.
18. **Keeper-hands exemption: verify, don't duplicate.** It already exists:
    - `keeperHolding` in the press branch (`step.ts:1362`);
    - `endPressesOnHands` (`step.ts:486-492`);
    - the in-hands tackle exemption in `ownedTick`.

    Tasks 6 and 7 add tests that counter-press, second presser and team press never target a keeper with the ball in his hands; they add no new check where those already apply.
19. **M5 without touching `resolve.ts`.** Under `firstTick.scopeRule` 1:
    - (a) `bootBlock` returns null for a release with `d.candidate?.method` set (a keeper's throw or punt from his hands);
    - (b) a clearance's flight is resolved with `firstTick.rule` 0 (a params copy passed to `resolveFlight` and `keeperLetsRun`), so a defender in front can charge it down on the first tick again.
20. **M6.**
    - **Cap.** `release.capS` > 0 caps a free (unpressed) release delay at `capS` seconds.
    - **Re-judge.** With `release.rejudge` 1, a holder whose remaining hold exceeds `pressedS[1]` is re-judged once an opponent comes within `pressedM`: his hold is cut to now + a `pressedS` draw (`release` stream).
    - **Scope.** It applies only with `release.rule` 1, never to a keeper with the ball in his hands, and never at a restart.
21. **M10.** P4 leaves the three on-bound assertions alone: punts 1.00 against bound 1.0, punt share 0.40 against 0.40, and positioning deep count 6 against 6.
    - Their bounds and seeds never change.
    - If Task 10's switch-on turns one red, it becomes `it.fails` (`NOT MET:`), with the measured value and the 64-match value in a comment.
    - P4 does not strengthen them further: their honest values are already recorded as NOT MET or on the bound.
22. **Deferred P3 tests that touch P4 code** go to Task 4: the free-kick restart case for the keeper-hands seam (more fouls mean more keeper-taken free kicks), and the sent-off `takerFor` restart fallback (more fouls mean more reds). The other deferred tests (`pPunt` branches, throw bounds, `cross.zones` regex, the EventType parse) do not touch P4 code and stay deferred.
23. **Diagnostics in Python** (P3 ruling 17). Nothing in the tuner or the gate reads them, so there is no TS port or parity test. The real aggregates go in a hand-copied `duels` block of `targets-idsse.json`, kept by `targets.py`'s `HAND_BLOCKS`.
24. **Real-target tests** live in Task 10's `duels-targets.test.ts`: the calibrated parameters, the test teams, seeds 7, 9, 11 and 13, fixed by the file's own rule and never re-picked.
25. **Distance** (9.2 against 10.9 km) is not a P4 target. Every A4/A5 task records it before and after (the duels section's info row), and Task 10 reports it.
26. **Knobs** (Task 10).
    - **No knob on** `tackle.base`, the zone or angle factors, or the shape of the join table: they are fitted.
    - **New knobs**, each a narrow scale on a measured value:

      | Knob | Moves | Range |
      |---|---|---|
      | `attacker_foul` | × `fouls.attackerShare` | 0.5–1.5 |
      | `aerial_contest` | `aerial.contestM` | Task 5's value ± 0.5 m |
      | `aerial_foul` | × `aerial.foulShare` | 0.5–1.5 |
      | `counter_join` | × every `transition.joinP` | 0.75–1.25 |
      | `recovery_rate` | × `transition.recoverRatePerS` | 0.5–1.5 |
      | `press_rate` | × `press.rateScale` | 0.75–1.25 |
      | `lane_share` | `marking.laneShare` | 0.3–0.5 |

    - **Changed:** `yellow_per_foul` starts at 0.15 with range 0.10–0.25.

## Lessons from P3, applied to every task

- Use explicit `off`/`on` params in every test; never use `DEFAULT_PARAMS` as "off" (F4).
- A mechanism test must not contradict the existing engine: assert the precondition under `off` first (F1, F2), and give every loop a non-vacuous count assertion (F11).
- Run windows and draws at dt 0.04 as well as 0.1 (P3 Task 3 boot window, Task 4 release).
- When the switch-on recalibration fails the gate, **diagnose the cause before re-tuning** (P3 Task 10b), and report to the user.
- Never widen a bound. A missed real target goes in `it.fails` with its measured value.
- Rule switches are validated as 0 or 1 in `paramsFromJson` (P3 M7, extended here).
- Seed re-pins follow each file's stated rule (P3 Task 10).
- The tuner can buy loss by pulling statistics away from real. The knob ranges above are narrow, and Task 10 compares the duels section before and after the tuner.

## Review Focus

1. **25 Hz renders (dt 0.04).** The 3 s window is 75 ticks, the 1.5 s pause 38 ticks, recovery 63–200 ticks, and back-to-goal 38 ticks. Each window is open while `tick − start < Math.round(s / dt)`. Hazards are per second through `hazard(rate, dt)`. Covered by the dt cases in Tasks 6, 7 and 9.
2. **Second half and the other side.** Zone factors, the box test, approach bearings, the own-third trigger, recovery's goal-side test and CB step-out must mirror when home attacks −x after half-time. Covered by the second-half cases in Tasks 3, 4, 6, 7 and 8.
3. **A keeper with the ball in his hands.** No counter-press joiner, team presser or second presser targets him, and no boot block hits his throw or punt. Covered in Tasks 6, 7 and 9.
4. **Ten men or fewer.** Support counts, join draws and presser choice skip sent-off players. A free kick with every outfielder sent off is taken by the keeper. An aerial foul whose offender is sent off in flight is dropped. Covered in Tasks 3, 4, 5 and 6.
5. **A standing carrier** (speed below 1 m/s). The approach bearing falls back to the attack direction, and is never NaN from a zero-length velocity. Covered in Task 3.

---

### Task 1: Scaffold — params, streams, state and seams (wave 0, identity; opus)

**Files:**
- Modify:
  - **`packages/sim-core/src/params.ts`**
  - **`packages/sim-core/src/types.ts`**
  - **`packages/sim-core/src/step.ts`**: markers, seam blocks and call sites
  - `packages/sim-core/src/resolve.ts`: the optional `Resolution.contest` field only
  - `packages/schema/src/domain.ts:50`: the `Intent` literal
- Test: `packages/sim-core/test/params.test.ts` (append)

**Interfaces:**
- Produces (in `params.ts`). The blocks below; the defaults are the spec values with every switch 0:
  - `tackle: { rule: 0, base: 0, frontLogit: 0.35, behindLogit: -0.35, frontDeg: 60, behindDeg: 120, supportLogit: 0.4, supportM: 5, supportMax: 2, speedLogit: -0.1, boxLogit: 0.3, headingMinMps: 1 }`
  - `fouls: { rule: 0, finalThirdU: 17.5, finalThird: 0.4, box: 0.12, side: 1.6, behind: 2.4, attackerShare: 0.05, shieldSpeedMax: 2, takeOnShare: 0.15 }`
  - `aerial: { rule: 0, contestM: 1, bHeading: 3, bSlack: 1, foulShare: 0.13 }`
  - `transition: { rule: 0, windowS: 3, joinM: [5, 10, 15, 20, 30], joinP: [0.8, 0.3, 0.23, 0.13, 0.07], speed: 4.5, pauseS: 1.5, pauseShare: 0.55, pauseRadiusM: 10, recoverFromS: 2.5, recoverPeakS: [5, 6], recoverToS: 8, recoverRatePerS: 0.1, recoverBehindFactor: 0.33, recoverUpfieldM: -10, recoverS: [1.5, 3], recoverSpeedShare: 0.9 }`
  - `press: { rule: 0, rateScale: 1, backToGoalLift: 2, backToGoalS: 1.5, backToGoalBallMps: 5, ownThirdLift: 2, ownThirdU: 17.5, roleWeight: { CB: 0.6, FB: 0.9, DM: 1, CM: 1, AM: 0.8, W: 1, ST: 0.7 }, secondM: 12, secondRadiusM: 15, secondShare: 0.45, shadowM: 4 }`
  - `marking` gains `rule: 0, laneShare: 0.4, cbStepM: 10, dropMps: 1`
  - `firstTick` gains `scopeRule: 0`
  - `release` gains `capS: 0, rejudge: 0`
- Produces (in `types.ts`):
  - `CONCERNS` gains `"foul", "aerial", "counter", "press"`, appended in that order.
  - `Intent` gains `{ readonly kind: "recover"; readonly target: Vec2 }`.
  - `type FoulKind = "tackle" | "take_on" | "shielding" | "aerial"`
  - `interface FlightFoul { offenderId: string; victimId: string; at: Vec2; offenderYellow: number }`; `Flight.foul?: FlightFoul`
  - `interface TransitionState { loser: Side; tick: number; at: Vec2; joiners: ReadonlyArray<string> }`; `MatchState.transition?: TransitionState`
  - `interface PressState { reception: { playerId: string; tick: number; ballMps: number } | null; secondFor: string | null; secondId: string | null }`; `MatchState.press?: PressState`
- Produces (in `resolve.ts`): `Resolution.contest?: { readonly id: string; readonly slack: number }`. It is never set in Task 1.
- Produces (in `step.ts`). `interface MoveTarget { target: Vec2; speedCap: number; timeLeft?: number }`, returned by `moveTarget`. `Work` gains `transition` and `press`, persisted by `toState` like `supportGate` (`step.ts:338-340`). The module-private seams and their rule-0 bodies:

  | Block (owner) | Function | Rule-0 body (today's code) |
  |---|---|---|
  | Tackle (Task 3) | `tackleWinLogit(w, def, owner): number` | `defending.tackleBase + 3·(tackling − dribbling)` |
  | Foul (Task 4) | `foulChance(w, def, owner): number` | `min(1, foulPerTackle × (victimInBox ? boxFoulFactor : 1) × mods.foul × booked)` |
  | | `shieldingFoul(w, def, owner): boolean` | `false`, no draw |
  | | `takeOnFoul(w, owner, def): boolean` | `false`, no draw |
  | | `foulZone(w, victim, at): number` | `1` |
  | Aerial (Task 5) | `aerialDuel(w, res, owner): { res: Resolution; foul: FlightFoul \| null }` | `{ res, foul: null }` |
  | | `applyFlightFoul(w, foul): boolean` | `false` |
  | Transition (Task 6) | `noteLoss(w, loser, at): void` | no-op |
  | | `inCounterWindow(w, side): boolean` | `false` |
  | | `transitionMove(w, pl, base, possSide): MoveTarget` | returns `base` (the same object) |
  | Team press (Task 7) | `teamPressMove(w, pl, owner, vmax, keeperFactor): MoveTarget \| null` | today's `step.ts:1364-1377`, moved verbatim |
  | | `noteReception(w, receiver, f): void` | no-op |
  | Marking (Task 8) | `markSpot(w, defSide, defId, anchor, attacker, ballFlat): Vec2` | today's `markTarget(...)` call |
  | P3 boot-block (Task 9) | `bootBlock(w, owner, d)`, regaining its `d` parameter | today's body |
  | | `flightParams(w, isClear): Params` | `w.p` (the same object) |
  | P3 release (Task 9) | `rejudgeRelease(w, owner): void` | no-op |

- Produces: `foulAndCards(w, offender, victim, kind: FoulKind = "tackle", at: Vec2 = victim.pos)`. It emits `foul` with `attrs.kind = kind`, and decides penalty or free kick from `at` in the victim's attacking frame. With the defaults it is identical to today.

- [ ] **Step 1: Write the failing test** (append to `params.test.ts`, describe `"realism v2 P4 params"`)

```ts
it("ship switched off, with the spec's join table, tackle terms and foul factors, and four new RNG streams", () => {
  const P = DEFAULT_PARAMS
  for (const r of [P.tackle.rule, P.fouls.rule, P.aerial.rule, P.transition.rule, P.press.rule, P.marking.rule, P.firstTick.scopeRule, P.release.rejudge]) expect(r).toBe(0)
  expect(P.release.capS).toBe(0)
  expect(P.transition.joinP).toEqual([0.8, 0.3, 0.23, 0.13, 0.07])
  expect([P.tackle.frontLogit, P.tackle.behindLogit, P.tackle.supportLogit, P.tackle.boxLogit]).toEqual([0.35, -0.35, 0.4, 0.3])
  expect([P.fouls.finalThird, P.fouls.box, P.fouls.behind]).toEqual([0.4, 0.12, 2.4])
  for (const c of ["foul", "aerial", "counter", "press"]) expect(CONCERNS).toContain(c)
})
it("reject a P4 switch other than 0 or 1, a join chance above 1, a join table out of order, and accept a negative tackle base", () => {
  expect(() => paramsFromJson({ provenance: cc, press: { rule: 0.5 } })).toThrow(/press\.rule must be 0 or 1/)
  expect(() => paramsFromJson({ provenance: cc, firstTick: { scopeRule: 2 } })).toThrow(/firstTick\.scopeRule must be 0 or 1/)
  expect(() => paramsFromJson({ provenance: cc, transition: { joinP: [1.2, 0.3, 0.23, 0.13, 0.07] } })).toThrow(/between 0 and 1/)
  expect(() => paramsFromJson({ provenance: cc, transition: { joinM: [5, 15, 10, 20, 30] } })).toThrow(/transition\.joinM/)
  expect(paramsFromJson({ provenance: cc, tackle: { base: -0.4 } }).tackle.base).toBe(-0.4)
})
```

Run: `pnpm --filter @touchline/sim-core exec vitest run test/params.test.ts`
Expected: FAIL with a TypeError, because `DEFAULT_PARAMS.tackle` is undefined.

- [ ] **Step 2: Implement the params**
  - Add the blocks and fields above, each P4 block on its own lines, with a doc comment naming the spec item and "rule 0: the old behaviour".
  - `checkRuleSwitches` (`params.ts:739`) gains the eight switches.
  - `SIGNED` gains `/^tackle\.(base|behindLogit|speedLogit)$/` and `/^transition\.recoverUpfieldM$/`.
  - `PROBABILITIES` gains `transition.joinP`, `transition.pauseShare`, `transition.recoverSpeedShare`, `press.secondShare`, `fouls.attackerShare`, `fouls.takeOnShare`, `aerial.foulShare` and `marking.laneShare`.
  - A new `checkTransition` requires `joinM` strictly increasing and the same length as `joinP`.

- [ ] **Step 3: Add the types, the schema literal and the stream names**

All are as listed in Interfaces. `runner.ts` and `whatif.ts` iterate `CONCERNS`, so forks carry the new streams, and saved states without them fall back to `substream`.

- [ ] **Step 4: Build the seams in `step.ts`**
  - **Import markers.** One per P4 block, after the P3 markers (`step.ts:66-71`): `// ---- P4 imports, <block> seam (plan 8d Task N inserts below this line)`.
  - **Seam blocks.** Each is banner-delimited (`// ===== P4 <block> seam (plan 8d Task N owns this block)` … `// ===== end of P4 <block> seam`) and holds the rule-0 bodies above. The tackle and foul blocks go just above `duels`, the aerial block just above `releaseKick`, and the transition, team-press and marking blocks just above `moveTarget`.
  - **Call sites.** All are identity under rule 0:
    1. `duels` (`step.ts:552-584`):
       - the `pWin` logit becomes `tackleWinLogit(w, def, owner)`;
       - right after the hazard draw succeeds: `if (shieldingFoul(w, def, owner)) { finishCarry(w, owner); foulAndCards(w, owner, def, "shielding", def.pos); return true }`;
       - the referee chance becomes `foulChance(w, def, owner)`, keeping `|| w.hasForced(def.side, "red_card")`.
    2. Take-on (`step.ts:963-975`): after the `take_on` event, `if (won && takeOnFoul(w, owner, def)) { foulAndCards(w, def, owner, "take_on"); return }`.
    3. `releaseKick`:
       - name the `keeperLetsRun(...)` result `raw`;
       - `const ad = aerialDuel(w, raw, owner); const res = ad.res`, before `winner` and `offside` are computed;
       - `!ad.foul &&` joins `keeperComes` and `headsAway`;
       - a new branch after `blocked`: `else if (ad.foul) { outcome = w.player(ad.foul.victimId).side === side ? "successful" : "intercepted"; extra.push(at(aerial_duel event from res.aerial)) }`;
       - the `extra.unshift` of `aerial_duel` (`:793`) gains `&& !ad.foul`;
       - the flight gets `...(ad.foul ? { foul: ad.foul } : {})`;
       - `resolveFlight(...)` and `keeperLetsRun(...)` take `flightParams(w, isClear)` in place of `p`;
       - the boot call passes `d`: `bootBlock(w, owner, d)`.
    4. `resolveFlightNow`:
       - after the extras loop, `if (f.foul && applyFlightFoul(w, f.foul)) return`;
       - in the winner branch (`:1059-1066`): `noteReception(w, winner, f)` when `winner.side === f.side`, and `noteLoss(w, w.lastTouch!.side, winner.pos)` where `possession_change` is emitted, before `lastTouch` is overwritten.
    5. `changePossession` (`:494-503`): `noteLoss(w, prevSide, to.pos)` where `possession_change` is emitted.
    6. `startRestart` (`:359`): `w.transition = undefined`.
    7. `ownedTick` (`:988-1001`): `rejudgeRelease(w, owner)` after the duels line, before the decision check.
    8. `moveTarget`'s press branch (`:1358-1377`): `if (!keeperHolding && !inCounterWindow(w, pl.side)) { const tp = teamPressMove(w, pl, owner, vmax, keeperFactor); if (tp) return tp }`.
    9. `marksFor` (`:1419-1431`):
       - the filter also drops live `recover` intents;
       - the target comes from `markSpot(w, defSide, id, anchors.get(id)!, a, ballFlat)`.
    10. `moveAll` (`:1466-1490`): `transitionMove(w, pl, moveTarget(...), possSide)`.

- [ ] **Step 5: Verify identity**

Run: `pnpm typecheck && pnpm --filter @touchline/sim-core exec vitest run --no-file-parallelism`
Expected: PASS (347 passed plus the existing expected failures).

Run the gate command.
Expected: PASS, loss 26.87, maxDrift 0.

Run: `pnpm --filter @touchline/schema exec vitest run && uv run --project python/analytics pytest python/analytics/tests -q`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/sim-core packages/schema
git commit -m "feat(sim-core): P4 scaffold — params blocks (off), foul/aerial/counter/press streams, recover intent, flight fouls, transition and press state, eight seams (identity)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Duels diagnostic — report section, real targets, `--only duels`, P3 baseline (wave 0; opus)

**Files:**
- Create:
  - `python/analytics/touchline_analytics/duels.py`
  - `python/analytics/tests/test_duels.py`
  - `docs/realism/p4-duels-baseline.md`
- Modify:
  - `python/analytics/touchline_analytics/report.py`: `build` adds `duels_section` when `"duels" in targets`; `--only` choices gain `"duels"`
  - `targets.py`: `HAND_BLOCKS` gains `"duels"`
  - `data/params/targets-idsse.json`: a new `duels` block in the `passing` block's row format, `{label, real, lo, hi, fmt}`
  - `packages/calibrate/src/realism.ts`: `--only` accepts `"passing"` or `"duels"`, and the help text names both

**Interfaces:**
- Produces:
  - `match_duels(run: Path, roles: dict[str, str]) -> dict`
  - `duels_section(ms: list[dict], t: dict) -> list[str]`
  - `duels_report(run_dirs, targets, note, roles) -> str`
  - the `duels` rows below, by key; every later task reads them
- Definitions are ported from the analysis scripts, with frames and events as `passing.py` reads them:
  - **Duels.** A tackle attempt is a `tackle` event with outcome `won`, `lost` or `foul`; the defender wins on `won`. Bearing, support and speed are taken at the event's frame (velocity from the frames ±1 tick), with T2's thresholds. A ground duel is a tackle attempt or a `take_on`.
  - **Fouls.** Defender fouls are `foul` events of kind `tackle` or `take_on`; attacker fouls are kind `shielding`; aerial fouls are kind `aerial`.
  - **Restarts and cards.** A free kick within 30 m is a `set_piece` free kick whose spot is within 30 m of the goal its side attacks. Penalties are counted as in `balance()`. Yellows are cards with colour `yellow` or `second_yellow`; sent off means `second_yellow` or `red`. Cards per foul = cards without `reason` `conduct` ÷ fouls.
  - **Losses.** A loss is a `possession_change` in open play where the previous possession lasted at least 5 s (the report's main filter).
  - **Counter-press.** Reach is measured as `trans_analysis.py` does (≤ 3 m within 3 s, by distance at the loss; ≤ 5 m within 3 s per loss). Regained within 5 s is the losing side owning the ball again within 5 s.
  - **Recovery share.** The share of losing outfielders with velocity toward their own goal above 4 m/s, at 2, 3, 5–6 and 10 s, plus its maximum over 0–1.4 s.
  - **Pause speed ratio.** Losing outfield mean speed over 0.8–1.4 s ÷ the same at −1 s.
  - **Pressing.**
    - **Press episodes and engagement**, as `ft_analysis.py pressing()` defines them: engaged means within 3 m, or within 6 m and closing at more than 1.5 m/s; an episode starts at ≥ 2 engaged after 1 s with fewer.
    - **Trigger lifts:** the share at press start ÷ a 1 Hz carrier baseline.
    - **Presser roles:** approaches of at least 0.6 s starting at least 5 m away; DM counts as CM.
  - **Options per pass.** Open by 3 m and clear-lane teammates follow `carrier-report.md` C1, with `passing.py`'s lane and openness helpers.

| Key | Real | lo–hi | | Key | Real | lo–hi |
|---|---|---|---|---|---|---|
| `tackle_win` | 0.48 | 0.43–0.53 | | `join_0_5` | 0.79 | 0.74–0.84 |
| `tackle_win_front` | 0.54 | 0.49–0.59 | | `join_5_10` | 0.28 | 0.23–0.33 |
| `tackle_win_behind` | 0.45 | 0.40–0.50 | | `join_10_15` | 0.23 | 0.18–0.28 |
| `tackle_win_alone` | 0.36 | 0.31–0.41 | | `join_15_20` | 0.13 | 0.09–0.17 |
| `tackle_win_support` | 0.60 | 0.55–0.65 | | `join_20_30` | 0.07 | 0.04–0.10 |
| `ground_duels_per_match` | 154.7 | 135–175 | | `cp_reach5` | 2.29 | 2.0–2.6 |
| `defender_fouls_per_match` | 15 | 12–18 | | `cp_reach5_ge3` | 0.43 | 0.35–0.51 |
| `attacker_fouls_per_match` | 3 | 2–4 | | `cp_peak_speed` | 4.5 | 4.0–5.0 |
| `aerial_duels_per_match` | 47 | 40–54 | | `regain_5s` | 0.40 | 0.35–0.45 |
| `aerial_fouls_per_match` | 5 | 3.5–6.5 | | `recover_pre` | 0.02 | 0–0.03 |
| `fouls_per_match` | 22.9 | 19–27 | | `recover_2s` | 0.06 | 0.03–0.09 |
| `fk_30m_per_match` | 0.86 | 0.6–1.2 | | `recover_3s` | 0.10 | 0.07–0.13 |
| `penalties_per_match` | 0.43 | 0.25–0.50 | | `recover_5_6s` | 0.15 | 0.12–0.18 |
| `yellows_per_match` | 5.0 | 4.0–6.0 | | `recover_10s` | 0.12 | 0.09–0.15 |
| `sent_off_per_match` | 0.29 | 0.2–0.3 | | `pause_speed_ratio` | 0.87 | 0.80–0.90 |
| `cards_per_foul` | 0.14 | 0.11–0.17 | | `press_episodes_per90` | 405 | 365–445 |
| `presser_cm` | 0.37 | 0.32–0.42 | | `engaged3_share` | 0.049 | 0.035–0.065 |
| `presser_w` | 0.19 | 0.14–0.24 | | `lift_back_to_goal` | 2.08 | 1.6–2.6 |
| `presser_fb` | 0.13 | 0.08–0.18 | | `lift_own_third` | 1.97 | 1.5–2.5 |
| `presser_am` | 0.11 | 0.06–0.16 | | `open3_per_pass` | 7.96 | 7.2–8.7 |
| `presser_st` | 0.11 | 0.06–0.16 | | `clear_lane_per_pass` | 4.95 | 4.5–5.4 |
| `presser_cb` | 0.10 | 0.05–0.15 | | `press_peak_speed`, `distance_km` | 5.1, 10.88 | info (no band) |

`source`: "realism v2 analysis 2026-10-13 (tackles-report.md, transitions-report.md, finalthird-report.md B2, carrier-report.md C1); spec P4 for defender, attacker and aerial fouls; IDSSE, 7 matches; aggregates only. Bands are plan 8d rulings." The section prints a penalties and sendings-off note: "judge on ≥ 64 matches".

- [ ] **Step 1: Write the failing tests** (`test_duels.py`, on a hand-built match folder in the style of `test_passing.py`)
  - `test_tackle_win_split_by_bearing_and_support`. Fixture: 4 tackle attempts (front won, front lost, behind won with one supporter at 4 m, behind foul). Assert `tackle_win == 0.5`, `front == 0.5`, `behind == 0.5`, `alone == 1/3` and `support == 1.0`.
  - `test_standing_carrier_uses_attack_direction`. A carrier at 0 m/s with the defender goal-side counts as `front` in the first half, and the mirrored fixture counts as `front` in the second half.
  - `test_fouls_by_kind_and_cards_per_foul`. Fouls of kinds tackle, take_on, shielding and aerial, with 2 foul yellows and 1 conduct yellow. Assert defender 2, attacker 1, aerial 1, `cards_per_foul == 0.5`, `yellows == 3`.
  - `test_fk_within_30m_mirrors_by_half`. A free kick at x = 25 for home in the first half counts; the same spot for home in the second half does not.
  - `test_join_reach_by_distance_bins`. One loss with losers at 3 m and 12 m, where only the 3 m player reaches ≤ 3 m within 3 s. Assert `join_0_5 == 1` and `join_10_15 == 0`.
  - `test_press_episode_needs_one_second_below_two`. Two engagements 0.6 s apart count as one episode; 1.2 s apart, two.
  - `test_duels_rows_have_targets`. Every key of `duels_section` has a row in the `duels` block.

Run: `uv run --project python/analytics pytest python/analytics/tests/test_duels.py -q`
Expected: FAIL (`ModuleNotFoundError: touchline_analytics.duels`).

- [ ] **Step 2: Implement `duels.py`, the report wiring, the targets block and `--only duels`**

Rows print as `passing_section` does: real, simulated, band, MET or NOT MET; the info rows print "—".

Run: the pytest command above, then `pnpm --filter @touchline/calibrate exec vitest run test/cli.test.ts`.
Expected: PASS.

- [ ] **Step 3: Measure the P3 baseline**

Run: `pnpm realism --matches 16 --only duels --runs out/p4-t2-runs --out docs/realism/p4-duels-baseline.md && rm -rf out/p4-t2-runs`
Expected: a full table. Check by hand that `fouls_per_match` is about 13–14 and `aerial_duels_per_match` is about 19.

- [ ] **Step 4: Commit**

```bash
git add python/analytics data/params/targets-idsse.json packages/calibrate/src/realism.ts docs/realism/p4-duels-baseline.md
git commit -m "feat(analytics): P4 duels section — tackles, fouls, cards, counter-press, recovery, pressing and marking against real aggregates; --only duels; P3 baseline

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: T2 — tackle success terms (wave 1, merge first; sonnet)

**Files:**
- Create: `packages/sim-core/src/duel.ts`, `packages/sim-core/test/tackle.test.ts`
- Modify: the **tackle seam** in `step.ts`; the `tackle` values in `params.ts`

**Interfaces:**
- Consumes: `Params.tackle` and the `tackleWinLogit` seam (Task 1).
- Produces (in `duel.ts`, also used by Task 4):
  - `type Bearing = "front" | "side" | "behind"`
  - `bearingOf(carrier: Vec2, carrierVel: Vec2, attackDir: number, def: Vec2, t: Params["tackle"]): Bearing`
  - `supportCount(carrier: Vec2, tacklerId: string, opponents: ReadonlyArray<PlayerState>, radiusM: number): number`
  - `tackleLogit(base: number, skillDiff: number, bearing: Bearing, support: number, carrierSpeed: number, inBox: boolean, t: Params["tackle"]): number`

- [ ] **Step 1: Write the failing tests** (`tackle.test.ts`; `off` and `on` are explicit)
  - `"bearing: front within 60 degrees of the carrier's run, behind from 120, the attack direction when he stands"`:
    - a carrier moving +x at 3 m/s, defender at (+2, 0.5) → `front`, at (−2, 0) → `behind`, at (0, 2) → `side`;
    - the same carrier at 0.5 m/s with attackDir −1 (second half, home): the defender at (−2, 0) is `front`;
    - no NaN at speed 0.
  - `"support counts other outfield defenders within 5 m, not the tackler, keepers or the sent off"`: the fixture has the tackler, a CB at 4 m, a CM at 6 m, a GK at 3 m and a sent-off FB at 2 m → 1.
  - `"the terms add as the spec says"`:
    - `tackleLogit(0,0,"front",0,0,false,t) − tackleLogit(0,0,"behind",0,0,false,t) ≈ 0.7`;
    - support 3 against 0 → +0.8 (capped at 2);
    - speed 4 → −0.4;
    - in the box → +0.3.
  - `"rule off reproduces the old logit"`: `tackleWinLogit` under `off` equals `tackleBase + 3·Δ` on a fixture. The seam is reached through a one-tackle state, as `x1.test.ts` reaches the boot seam.
  - `"in matches, front beats behind and support helps (dt 0.1 and dt 0.04)"`, seeds 7 and 9, `on`:
    - win(front) − win(behind) > 0.05;
    - win(support) − win(alone) > 0.1;
    - at least 30 attempts in each bin; at dt 0.04 the same signs hold.

Run: `pnpm --filter @touchline/sim-core exec vitest run test/tackle.test.ts`
Expected: FAIL, because `duel.ts` does not exist.

- [ ] **Step 2: Implement `duel.ts` and fill the tackle seam**

Under `tackle.rule` 1 the seam returns `tackleLogit(t.base, def.tackling − owner.dribbling, …)`. `inBox` means the carrier is in the box he attacks (`attackX`, `PITCH.boxDepth`, `boxHalfWidth`). Run the tests: Expected PASS.

- [ ] **Step 3: Set `tackle.base`**

Run 16 matches with `--set tackle.rule=1,tackle.base=<b>` for b in 0, −0.2, −0.4.

Pick the b whose `tackle_win` is nearest 0.48, and commit it as `tackle.base`.

Record every T2 row, `ground_duels_per_match` and `fouls_per_match` (lost tackles change the foul count) against the Task 2 baseline. Delete each run folder.

- [ ] **Step 4: Gate and commit**

Run the sim-core suite and the gate. Expected: PASS, drift 0.

Commit message: `"feat(sim-core): T2 tackle success by approach, support, carrier speed and box (tackle.rule, off); base <b>: win 0.53→<x>, front/behind <f>/<bh>, alone/support <a>/<s>"` with the trailer.

---

### Task 4: T3/T4 — fouls by zone and angle, attacker and take-on fouls, cards (wave 2; opus)

**Files:**
- Create: `packages/sim-core/src/fouls.ts`, `packages/sim-core/test/fouls.test.ts`
- Modify: the **foul seam** in `step.ts`; the `fouls` values in `params.ts`
- Test (append, test-only): `packages/sim-core/test/distribution.test.ts`, `packages/sim-core/test/cards.test.ts`

**Interfaces:**
- Consumes: `bearingOf` and `Bearing` (Task 3, `duel.ts`); the foul seam and `foulAndCards(…, kind, at)` (Task 1).
- Produces (in `fouls.ts`):
  - `zoneFactor(u: number, inBox: boolean, f: Params["fouls"]): number`
  - `angleFactor(b: Bearing, f: Params["fouls"]): number`
- Produces: `foulZone(w, victim, at)`, which Task 5's aerial fouls call. It is 1 under `fouls.rule` 0.

- [ ] **Step 1: Write the failing tests** (`fouls.test.ts`)
  - `"zone factor: 1 in the own half, 0.4 from the final third, 0.12 in the box"`:
    - `zoneFactor(-30)` = 1, `(0)` = 1, `(8.75)` = 0.7, `(17.5)` = 0.4, `(30, false)` = 0.4, `(40, true)` = 0.12;
    - `foulZone` for a home victim at x = −40 in the second half (u = +40) is 0.12.
  - `"angle factor: front 1, side 1.6, behind 2.4"`.
  - `"rule off keeps the flat rate and the box x0.2"`: on a one-tackle state, `foulChance` under `off` equals `foulPerTackle × 0.2` in the box and `foulPerTackle` outside it.
  - `"shielding fouls come only from slow carriers and give the free kick to the defenders"`:
    - fixture: `on` with `attackerShare` 1 and the carrier at 0.5 m/s;
    - the `foul` event has kind `shielding`, player = carrier, victim = tackler, and the restart is a `free_kick` for the tackler's side;
    - the carrier at 3 m/s gives no shielding foul;
    - `off` with the same fixture gives none.
  - `"a take-on foul follows a won take-on and stops the dribble"`: fixture `on` with `takeOnShare` 1; the `take_on` won event is followed in the same frame by `foul` kind `take_on`, the free kick goes to the carrier's side, and the carrier has no `carry` intent.
  - `"booked players commit no fouls of any kind when bookedFoulFactor is 0"`: a full match `on` (seed 7) with `yellowPerFoul` 1 and `bookedFoulFactor` 0. No `foul` event of any kind by a player after his first card, and at least one `shielding` and one `take_on` foul occur. This extends the existing `cards.test.ts` invariant to the new kinds.
  - `"in matches, defender fouls fall in the final third and the box"`: seeds 7 and 9, `on` against `off`. The share of defender fouls with the victim in the final third or box is lower under `on`, with at least 20 fouls per arm.
- Append to `cards.test.ts` (deferred test, ruling 22): `"a free kick with every outfielder sent off is taken by the keeper"`. Set every outfielder of one side `sentOff`, start a free-kick restart for that side, step until `set_piece`, and assert its `player_id` is that side's GK. The precondition asserts that side has 0 active outfielders.
- Append to `distribution.test.ts` (deferred test): `"a keeper taking a free kick has no throw or punt"`. A free-kick restart taken by the keeper in his own half under `distribution.rule` 1 gives a pass with no `method` on the candidate and `keeper_distribution.method` absent. It mirrors the existing goal-kick case.

Run: `pnpm --filter @touchline/sim-core exec vitest run test/fouls.test.ts test/cards.test.ts test/distribution.test.ts`
Expected: FAIL in `fouls.test.ts`, because `fouls.ts` does not exist. The two appended cases should pass already, since they cover existing code. If one fails, stop and report it.

- [ ] **Step 2: Implement `fouls.ts` and fill the foul seam** (rulings 3–5; `shieldingFoul` and `takeOnFoul` draw on `w.rng.foul`)

Run the tests: Expected PASS.

- [ ] **Step 3: Measure and set the shares**

Use `--set tackle.rule=1,aerial.rule=1,fouls.rule=1,defending.yellowPerFoul=0.15`, 16 matches, sweeping `defending.foulPerTackle` (0.2, 0.3, 0.4).

1. Choose `fouls.attackerShare` so attacker fouls are 3 ± 1 per match, and `fouls.takeOnShare` so the defender fouls (tackle plus take-on) reach 15 ± 3 together with the `foulPerTackle` sweep.
2. Commit `attackerShare` and `takeOnShare` in `fouls`. **Do not commit** `foulPerTackle` or `yellowPerFoul`; record the chosen `foulPerTackle` for Task 10.
3. Record:
   - every foul and discipline row: defender, attacker and aerial fouls, total fouls, free kicks within 30 m, penalties (16 matches, noisy), yellows, sent off, cards per foul;
   - the free-kicks gate statistic, `free_kicks` from the full report, because offside free kicks add to it.

Delete the run folders.

- [ ] **Step 4: Gate and commit** (PASS, drift 0)

Commit message: `"feat(sim-core): T3 foul chance by zone and angle, T4 shielding and take-on fouls (fouls.rule, off); fouls <n>/match (def <d>, att <a>), FK<30 m <k>, yellows <y>, sent off <s> at foulPerTackle <f>, yellowPerFoul 0.15"`.

---

### Task 5: T4 — aerial duels and aerial fouls (wave 1; sensitive `resolve.ts`, approved; opus)

**Files:**
- Modify: `packages/sim-core/src/resolve.ts`, **only** the aerial block (`resolve.ts:155-163`) and the qualifier loop's contender bookkeeping; the **aerial seam** in `step.ts`; the `aerial` values in `params.ts`
- Create: `packages/sim-core/test/aerial.test.ts`

**Interfaces:**
- Consumes: `Resolution.contest`, `FlightFoul`, `Flight.foul`, `aerialDuel`, `applyFlightFoul`, `foulAndCards` (Task 1), and `foulZone` (Task 4's seam; it returns 1 until Task 4 merges).
- Produces: `aerialWinShare(dHeading: number, dSlack: number, a: Params["aerial"]): number`, exported from `resolve.ts` for tests.

- [ ] **Step 1: Write the failing tests** (`aerial.test.ts`)
  - `"rule off: a two-sided header still makes its one draw"`. A fixture with a cross and one header-height qualifier per side, under `off`:
    - `aerial` is set and `contest` is undefined;
    - the rng's state afterwards equals a copy advanced by exactly one `chance` call;
    - under `on` the state is unchanged.
  - `"rule on: resolve makes no draw for high balls and reports the contender"`:
    - one side reaches an aerial contact while an opponent's disc misses it by 0.6 m (`contestM` 1): `contest.id` is the opponent, `aerial` is null, and the rng state is unchanged;
    - the same opponent 2 m short gives no contest;
    - a ground pass gives no contest.
  - `"the duel goes to heading and arrival"`: `aerialWinShare(0, 0)` = 0.5; `aerialWinShare(0.2, 0)` = sigmoid(0.6); over 4000 seam draws (`aerial` stream) the shares are within ±0.03.
  - `"an aerial foul: the loser fouls the winner, no reception, the right restart"`:
    - with `foulShare` 1, a defender losing to an attacker in the attacker's box gives a `penalty`;
    - an attacker losing to a defender in the defenders' box gives a `free_kick` for the defenders at the contact;
    - neither flight emits a `reception`;
    - the pass outcome is `successful` or `intercepted` by the victim's side.
  - `"a foul whose offender was sent off in flight is dropped"`: `applyFlightFoul` returns false and the flight resolves normally (the winner owns the ball).
  - `"in matches, more aerial duels and every aerial foul restarts for the victim"`:
    - seed 7, `on` against `off`, at dt 0.1 and at dt 0.04;
    - aerial duels `on` ≥ 1.5 × `off`;
    - each `foul` of kind `aerial` is followed by a `set_piece` for the victim's side;
    - at least 1 aerial foul with `foulShare` 0.13 × 4 (raised for the sample).

Run: `pnpm --filter @touchline/sim-core exec vitest run test/aerial.test.ts`
Expected: FAIL (`aerialWinShare` is not exported).

- [ ] **Step 2: Implement** (rulings 6 and 7)
  - **`resolve.ts`.** Under `aerial.rule` 1 the two-sided branch returns the best qualifier by slack, with `contest` set to the other side's best and no draw. On a one-sided aerial tick, the loop's best non-qualifying opponent within `contestM` of his disc becomes `contest` (slack = radius − distance, negative). Under rule 0 the code path is unchanged.
  - **`aerialDuel`.** It draws the winner on `w.rng.aerial`, sets `res.aerial`, and swaps `winnerId` if the contender wins. It then draws the foul on `w.rng.foul`: `foulShare × foulZone(victim, contact) × booked(offender) × mods(offender.side).foul`.
  - **`applyFlightFoul`.** It re-checks sent-off state and the booked thinning, then calls `foulAndCards(w, offender, victim, "aerial", at)`.

  Run the tests: Expected PASS.

- [ ] **Step 3: Set `contestM` and `foulShare`**

Run 16 matches with `--set aerial.rule=1,aerial.contestM=<c>` for c in 0.5, 1, 1.5, 2.

1. Pick c with `aerial_duels_per_match` nearest 47, then set `foulShare` so `aerial_fouls_per_match` is about 5.
2. Commit both.
3. Record the aerial rows, `fouls_per_match`, `penalties_per_match`, and the gate statistics `corners` and `goals`, which header outcomes may move.

Delete the run folders.

- [ ] **Step 4: Gate and commit** (PASS, drift 0)

Commit message: `"feat(sim-core): T4 contested high balls become aerial duels (heading and arrival), aerial fouls at resolution (aerial.rule, off); contestM <c>: aerial duels 19→<n>, aerial fouls <f>"`.

---

### Task 6: A4 — counter-press, reaction pause, recovery sprints (wave 1; opus)

**Files:**
- Create: `packages/sim-core/src/transition.ts`, `packages/sim-core/test/transition.test.ts`
- Modify: the **transition seam** in `step.ts`; the `transition` values in `params.ts`

**Interfaces:**
- Consumes: `TransitionState`, the `recover` intent, `noteLoss`, `inCounterWindow`, `transitionMove` and `MoveTarget` (Task 1).
- Produces (in `transition.ts`):
  - `joinChance(distM: number, t: Params["transition"]): number`
  - `recoverRamp(tS: number, t: Params["transition"]): number`
  - `pauseTarget(pos: Vec2, vel: Vec2, vmax: number, t: Params["transition"]): { target: Vec2; speedCap: number }`

- [ ] **Step 1: Write the failing tests** (`transition.test.ts`)
  - `"join chance by distance at the loss"`: 3 → 0.8, 7 → 0.3, 12 → 0.23, 17 → 0.13, 25 → 0.07, 31 → 0.
  - `"recovery ramp: 0 before 2.5 s, 1 over 5-6 s, 0 from 8 s"`: 2 → 0, 3.75 → 0.5, 5.5 → 1, 7 → 0.5, 8 → 0.
  - `"noteLoss draws joiners from losing outfielders only, on the counter stream"`:
    - fixture `on`: the GK and a sent-off CM are never joiners over 200 seeds;
    - after `noteLoss` every other stream's state is unchanged;
    - the same seed gives the same joiners.
  - `"the window is 3 s at 10 Hz and at 25 Hz"`: `inCounterWindow` is true at tick + 29 and false at + 30 (dt 0.1); true at + 74 and false at + 75 (dt 0.04).
  - `"joiners press at 4.5 m/s; far non-joiners hold course for 1.5 s"`:
    - a joiner's `speedCap` ≤ 4.5;
    - a non-joiner 20 m from the ball moving at 3 m/s keeps target = pos + vel and cap 3 at offset +14 and gets `base` at +15 (dt 0.1); at dt 0.04 the same holds at +37 and +38;
    - a non-joiner 6 m from the ball gets `base`.
  - `"no counter-press on a keeper with the ball in his hands"`: the carrier is the GK with `inHands` in his box, so `transitionMove` returns `base` for joiners.
  - `"recovery: only from 2.5 s, likelier upfield of the ball, toward the own goal, mirrored after half-time"`:
    - with `recoverRatePerS` 50 (a forced fixture) there is no `recover` intent before 2.5 s;
    - an upfield player triggers at the forced rate and a goal-side one at × 0.33 (counts over 400 seeds, ratio 0.25–0.42);
    - the target's u is below his u in the second-half mirror too.
  - `"rule off returns base unchanged"`: `transitionMove(w, pl, base, side) === base` under `off`.
  - `"in a match, losses draw about two joiners"`: seed 7, `on`. Mean joiners per loss is 1.5–3.5, with at least 50 losses, at dt 0.1 and 0.04.

Run: `pnpm --filter @touchline/sim-core exec vitest run test/transition.test.ts`
Expected: FAIL (`transition.ts` does not exist).

- [ ] **Step 2: Implement `transition.ts` and fill the seam** (rulings 9–12)
  - Joins and recovery draws use `w.rng.counter`.
  - Joiners get `press` intents on the winner, live until the window ends.
  - `transitionMove` returns `base` during restarts, for the ball owner, for `timeLeft` chases and for keepers.

  Run the tests: Expected PASS.

- [ ] **Step 3: Measure and set `recoverRatePerS`**

Run 16 matches with `--set transition.rule=1,transition.recoverRatePerS=<r>` for r in 0.05, 0.1, 0.2.

1. Pick r with `recover_5_6s` nearest 0.15 and `recover_pre` ≤ 0.03, and commit it.
2. Record:
   - every transition row (join bins, `cp_reach5`, `cp_reach5_ge3`, `regain_5s`, the recovery curve, `pause_speed_ratio`);
   - `distance_km`;
   - the gate's `distance_km_median` and `peak_speed_kmh_median`.

Delete the run folders.

- [ ] **Step 4: Gate and commit** (PASS, drift 0)

Commit message: `"feat(sim-core): A4 counter-press by distance, reaction pause, recovery sprints (transition.rule, off); joiners <j>/loss, reach<=5 m <r>, recovery peak <p>, pause ratio <q>, distance <km>"`.

---

### Task 7: A5 — press triggers, second presser, presser role mix (wave 2; opus)

**Files:**
- Create: `packages/sim-core/src/press.ts`, `packages/sim-core/test/press.test.ts`
- Modify: the **team-press seam** in `step.ts`; the `press` values in `params.ts`

**Interfaces:**
- Consumes: `PressState`, `teamPressMove`, `noteReception` (Task 1), and `inCounterWindow` (Task 6, merged).
- Produces (in `press.ts`):
  - `pressLift(backToGoal: boolean, ownThird: boolean, pr: Params["press"]): number`
  - `presserScore(distM: number, role: Role, pr: Params["press"]): number`
  - `shadowSpot(carrier: Vec2, mate: Vec2, shadowM: number): Vec2`

- [ ] **Step 1: Write the failing tests** (`press.test.ts`)
  - `"lifts multiply: 2 back to goal, 2 in our third, 4 both, 1 neither"`.
  - `"back to goal lasts 1.5 s at 10 Hz and 25 Hz and needs a ball arriving faster than 5 m/s forward"`:
    - after `noteReception` with ballMps 6, the trigger holds at +14 and not at +15 (dt 0.1), and at +37 and not at +38 (dt 0.04);
    - with ballMps 4 it never holds.
  - `"the presser is chosen by distance over role weight"`: a CB at 8 m (8 / 0.6 = 13.3) and a W at 9 m (9 / 1 = 9) give the W. With every weight at 1 the CB is chosen (precondition: the old nearest rule).
  - `"a second presser joins in the cover shadow"`:
    - `on` with `secondShare` 1: the first presser is live 10 m from the carrier, and the next-best within 15 m gets a press whose target is 4 m from the carrier toward the carrier's nearest teammate;
    - with `secondShare` 0 nobody joins;
    - with the first presser at 14 m nobody joins.
  - `"never press a keeper with the ball in his hands"`: the carrier is the GK `inHands` in his box, under `on` with `secondShare` 1 and the lifts forced. No press intent targets him over 50 ticks.
  - `"own third mirrors after half-time"`: a home carrier at x = −30 in the second half is in the away side's own third.
  - `"in matches, wide players press more"`: seeds 7 and 9, `on` against `off`. The share of press intents started by W and FB rises, with at least 100 presses per arm.

Run: `pnpm --filter @touchline/sim-core exec vitest run test/press.test.ts`
Expected: FAIL (`press.ts` does not exist).

- [ ] **Step 2: Implement `press.ts` and fill the seam** (rulings 13–15)

The hazard keeps every existing factor and gains `rateScale × pressLift`. The second-presser draw uses `w.rng.press`. Run the tests: Expected PASS.

- [ ] **Step 3: Tune the values**

Use `--set tackle.rule=1,transition.rule=1,marking.rule=1,press.rule=1`, 16 matches.

1. Tune `rateScale` toward `press_episodes_per90` 405, and `secondShare` toward `engaged3_share` 0.049.
2. Tune `roleWeight` so each presser share lands in its band; at most 3 rounds, values only.
3. Record:
   - the pressing rows and the trigger lifts;
   - `tight_share` and the near-1 completion (from `--only passing`);
   - `distance_km`;
   - the gate's `ball_pressure_m`, `free_space_m` and `fouls`.

Delete the run folders.

- [ ] **Step 4: Gate and commit** (PASS, drift 0)

Commit message: `"feat(sim-core): A5 press triggers, second presser in the cover shadow, presser role mix (press.rule, off); episodes <e>/90, >=3 engaged <g>, roles CM/W/FB <..>"`.

---

### Task 8: A5 — zonal lane marking and CBs stepping out (wave 1; sonnet)

**Files:**
- Modify: `packages/sim-core/src/offball.ts` (append only); the **marking seam** in `step.ts`; `marking.laneShare`, `cbStepM` and `dropMps` in `params.ts`
- Create: `packages/sim-core/test/marking.test.ts`

**Interfaces:**
- Consumes: the `markSpot` seam (Task 1).
- Produces (in `offball.ts`):
  - `laneMarkTarget(anchor: Vec2, ball: Vec2, attacker: Vec2, weight: number, laneShare: number, widthSlackM?: number): Vec2`
  - `stepsOut(cbAnchor: Vec2, attacker: PlayerState, defSide: Side, period: Period, m: Params["marking"]): boolean`

- [ ] **Step 1: Write the failing tests** (`marking.test.ts`)
  - `"the marker goes weight of the way to a spot 40 % from the ball to his man"`: anchor (−20, 0), ball (0, 0), attacker (10, 10), weight 0.75, laneShare 0.4 → (−2, 3). Weight 0 → anchor. With `widthSlackM` 4, y is clamped to |anchor.y| + 4.
  - `"a CB follows a dropping striker up to 10 m, then lets him go"`:
    - for a first-half home CB with anchor u −30, an ST 6 m upfield of the anchor dropping at 2 m/s → true;
    - at 12 m → false; not dropping (0.5 m/s) → false;
    - the second-half mirror gives the same answers.
  - `"the step-out uses the old tight goal-side spot"`: under `on`, `markSpot` for that CB equals `markTarget(anchor, st.pos, side, period, goalSideM, 1, widthSlackM)`.
  - `"rule off marks exactly as before"`: under `off`, `markSpot` equals `markTarget(..., weight, widthSlackM)` on the same fixture.
  - `"in matches, receivers are marked less tightly"`: seeds 7 and 9, `on` against `off`. The share of completed passes whose receiver's nearest opponent is under 3 m is lower under `on`, with at least 400 passes per arm.

Run: `pnpm --filter @touchline/sim-core exec vitest run test/marking.test.ts`
Expected: FAIL (`laneMarkTarget` is not exported).

- [ ] **Step 2: Implement and fill the seam** (rulings 16 and 17)

Run the tests: Expected PASS.

- [ ] **Step 3: Measure**

Run 16 matches with `--set marking.rule=1` and with `laneShare` 0.3, 0.4 and 0.5, both `--only duels` and `--only passing`.

1. Keep 0.4 unless `tight_share` leaves 0.06–0.12.
2. Record:
   - `tight_share`, `open3_per_pass`, `clear_lane_per_pass` and the near-1 completion;
   - the gate's `ball_pressure_m` and `free_space_m`;
   - the CB press share, from `presser_cb`.

Delete the run folders.

- [ ] **Step 4: Gate and commit** (PASS, drift 0)

Commit message: `"feat(sim-core): A5 zonal lane marking and CBs stepping out with a dropping striker (marking.rule, off); tight <t>, open3 <o>, clear lanes <c>"`.

---

### Task 9: M5 and M6 — boot-block scope, clearance charge-down, release cap and re-judging (wave 1; sonnet)

**Files:**
- Modify:
  - **`step.ts`**: the P3 boot-block seam (`bootBlock`, `flightParams`) and the P3 release seam (`rejudgeRelease`)
  - `packages/sim-core/src/release.ts`: the cap
  - `params.ts`: `release.capS`
- Create: `packages/sim-core/test/carryfix.test.ts`

**Interfaces:**
- Consumes: `bootBlock(w, owner, d)`, `flightParams`, `rejudgeRelease` (Task 1).
- Produces: `releaseDelayS(nearestOppM, p, rng)`, the same signature, capped at `capS` when it is above 0.

- [ ] **Step 1: Write the failing tests** (`carryfix.test.ts`)
  - `"M5a: a keeper's throw or punt from his hands is never boot-blocked"`. Fixture: keeper in hands, an opponent 0.8 m away, `bootBlock` 1.
    - Precondition: with `scopeRule` 0 the release **is** blocked (`block` with `blocked: "pass"`).
    - With `scopeRule` 1 it is not, over 20 seeds.
  - `"M5b: a defender in front charges down a clearance on the first tick again"`. Fixture: a clearance, with a defender 0.7 m in front within the cone.
    - With `scopeRule` 0 and `firstTick.rule` 1 the first resolution is not his (precondition: P3's X1 behaviour).
    - With `scopeRule` 1 he wins it at tick 1.
  - `"M6 cap: a free release never exceeds capS"`: 20 000 draws at capS 4 are all ≤ 4; capS 0 leaves the tail.
  - `"M6 re-judge: a presser arriving cuts a long hold, at 10 Hz and 25 Hz"`:
    - a holder with 30 ticks left and an opponent stepping within 2 m gets `intentUntil` ≤ tick + 7 (dt 0.1);
    - at dt 0.04, ≤ tick + 18;
    - a keeper in hands, a restart, and `rejudge` 0 are left alone;
    - with `release.rule` 0 it is a no-op.

Run: `pnpm --filter @touchline/sim-core exec vitest run test/carryfix.test.ts`
Expected: FAIL. Under `scopeRule` 1 the hands release is still blocked.

- [ ] **Step 2: Implement** (rulings 19 and 20; the re-judge draws on `w.rng.release`)

Run the tests: Expected PASS.

- [ ] **Step 3: Measure and set `capS`**

Run 16 matches with `--set firstTick.scopeRule=1,release.rejudge=1,release.capS=<c>` for c in 0, 6, 4, using `--only passing`.

1. Pick c so that `release_over3` moves toward 0.16 and `release_median_s` toward 1.40, while `release_median_lt2_s` stays in 0.2–0.7, and commit it.
2. Record `first_tick_share`, the near-1 completion, and `passes_per_match`.

Delete the run folders.

- [ ] **Step 4: Gate and commit** (PASS, drift 0)

Commit message: `"fix(sim-core): M5 no boot block on hand releases and clearance charge-down restored (firstTick.scopeRule), M6 release cap <c> s and re-judge on pressure (release.rejudge), off"`.

---

### Task 10: Switch on, recalibrate, gate, baseline, re-pin, deep report, Results: P4 (wave 3; opus)

**Files:**
- Modify:
  - `packages/sim-core/src/params.ts`: the eight switches to 1
  - `packages/sim-core/test/params.test.ts`: the P4 "ship switched off" case becomes "ship switched on"
  - `packages/calibrate/src/knobs.ts`
  - `docs/superpowers/specs/2026-10-13-sim-realism-v2-design.md`: `## Results: P4 (date)`
- Create: `packages/sim-core/test/duels-targets.test.ts`
- Regenerate:
  - `data/params/touchline-params.json`, `data/params/realism-baseline.json`
  - `docs/realism/realism-report.md`, `docs/realism/realism-deep-report.md`
  - the stats and manager goldens
  - the seed pins, each by its file's rule: `services/agents/tests/conftest.py`, `packages/agent-gateway/test/e2e.test.ts`, the `whatif.test.ts` forced window, the `wide.test.ts` CLAIM_SEEDS, the `carriers.test.ts` parity seed, the manager `situation` seed, and the api library fixture

**Interfaces:**
- Consumes: every task's recorded values, including Task 4's `foulPerTackle`.
- Produces: the seven knobs and the changed `yellow_per_foul` of ruling 26.

- [ ] **Step 1: Switch on**

Set `tackle.rule`, `fouls.rule`, `aerial.rule`, `transition.rule`, `press.rule`, `marking.rule`, `firstTick.scopeRule` and `release.rejudge` to 1. Flip the params test.

Run the sim-core suite. For each red test:
- a test that asserts an exact statistic the P4 behaviours move (`keeper.test` press counts, `positioning`, `passing-targets`, `subs`/`edge` red-card fixtures): check the new value is football-plausible, then update the expectation and name it in the commit message;
- an M10 on-bound test that turns red: ruling 21;
- never loosen a real-target bound.

- [ ] **Step 2: Knobs**

Add the seven knobs to `knobs.ts`, each with `what` naming the statistic it moves, and set `yellow_per_foul` to `init 0.15, min 0.10, max 0.25`.

In the calibrated file, set `defending.yellowPerFoul` 0.15 and `defending.foulPerTackle` to Task 4's value before tuning.

Run: `pnpm typecheck && pnpm --filter @touchline/calibrate exec vitest run test/tune.test.ts`
Expected: PASS.

- [ ] **Step 3: Recalibrate** (30–40 minutes, in the background)

Run: `pnpm calibrate --from data/params/touchline-params.json --out data/params/touchline-params.json --matches 24 --rounds 1 --workers <N>`

Record:
- the loss and every knob that moved;
- in particular `tackle_rate`, `foul_per_tackle`, `yellow_per_foul`, `marking_weight`, `box_intensity` and the seven new knobs.

These existing knobs can pull P4 statistics away from real: duel volume, fouls, cards, tight marking and penalties.

- [ ] **Step 4: Re-baseline and gate**

Run: `UPDATE_REALISM_BASELINE=1 pnpm --filter @touchline/calibrate exec vitest run test/realism-gate.test.ts --disableConsoleIntercept`, then the gate command.
Expected: PASS, held-out loss < 30.

**If the loss is 30 or more, STOP and diagnose before any re-tuning** (P3 Task 10b):
1. Run `pnpm realism --matches 16` and `--only duels` on the candidate params.
2. List the statistics with the largest |z|.
3. Ablate each P4 switch (16 matches each, deleting the run folders) to find the mechanism that moved them.

Report the loss, the top |z| statistics and the cause to the user. The gate is never widened. The spec's splitting rule applies and the user chooses. A natural order to offer, keeping the discipline fix (T2, T3, T4):
1. `press.rule` 0;
2. then `transition.rule` 0;
3. then `aerial.rule` 0.

- [ ] **Step 5: Compare the duels section before and after the tuner**

Run 16 matches `--only duels` on the pre-tuner and the tuned params. Any P4 row that went from MET to NOT MET because of a knob is recorded with that knob's move.

- [ ] **Step 6: Real-target test** (`duels-targets.test.ts`; calibrated params, test teams, seeds `[7, 9, 11, 13]` fixed by this file's rule)

The structure follows `passing-targets.test.ts`: one measure pass over 4 matches, cached. Cases:

| Case | Bound |
|---|---|
| `"defenders win about 48 % of tackle attempts (T2)"` | 0.43–0.53 |
| `"front approaches win more than those from behind (T2)"` | win(front) − win(behind) ≥ 0.04 |
| `"support helps the tackler (T2)"` | win(support) − win(alone) ≥ 0.15 |
| `"about 15 defender fouls per match (T3)"` | 12–18 |
| `"about 23 fouls per match in all (T3, T4)"` | 19–27 |
| `"about 47 aerial duels per match (T4)"` | 40–54 |
| `"about 2.3 losing players reach the ball within 3 s (A4)"` | 2.0–2.6, from frames |

Run it. Each case that fails becomes `it.fails`, titled `NOT MET:`, with the measured value in a comment; bounds unchanged. Run again: PASS.

- [ ] **Step 7: Reports**

Run: `pnpm realism --matches 64 --runs out/p4-deep-runs --out docs/realism/realism-deep-report.md && rm -rf out/p4-deep-runs` (about 5 GB while it runs).

Run: `pnpm realism --matches 16 --runs out/p4-report-runs --out docs/realism/realism-report.md && rm -rf out/p4-report-runs`.

From the deep report record, against Results: P3:
- every duels row, MET or NOT MET (penalties and sendings-off only from these 64);
- the passing rows `tight_share`, near-1 and the release rows;
- C3, the physical bands and territory;
- outfield distance.

From the 16-match report record C1, C2 and C4.

Run the manager A/B for information: `pnpm managers:ab --arms none,rules --seeds 40 --out out/p4-ab --runs out/p4-ab-runs`, then delete `out/p4-ab-runs`.

- [ ] **Step 8: Re-pin and goldens**

Run `find_test_seed.py`, as P3 Task 10 Step 7 did. Re-pick each seed that now fails by the rule written next to it, never by loosening an assertion. Regenerate the stats and manager goldens, and check the diffs are plausible.

- [ ] **Step 9: Run everything**

Run: `pnpm test -- --no-file-parallelism && pnpm typecheck && uv run --project python/analytics pytest python/analytics/tests && uv run --project services/agents pytest services/agents/tests`
Expected: PASS. If a scenario 9-of-10 test is red, nudge its script, never the bound (P3 ruling).

- [ ] **Step 10: Results and commit**

Add `## Results: P4 (YYYY-MM-DD)` in the style of Results: P3:
- **Switched on:** every value the tasks set.
- **Deviations:** the planning rulings that changed the spec (2, 3 side ×1.6, 6, 7, 10–12, 15–17, 19), plus measurement changes.
- **Calibration:** the run, the knobs that moved, and the pre/post-tuner comparison.
- **Gate.**
- **P4 targets** (64 matches): each row MET or NOT MET, with Task 2's baseline alongside.
- **Discipline:** fouls, cards per foul, yellows, sent off and penalties against P3 (13.4, 0.75, 0.09).
- **C1–C4, physical bands and distance.**
- **Real-target tests:** which are `it.fails`, with values, and the M10 status.
- **Manager A/B.**
- **Gaps outside P4.**
- **Carried to P5/P6.**

Commit with message `"feat: realism v2 P4 on — tackle terms, fouls by zone and angle, attacker/take-on/aerial fouls, aerial duels, counter-press, pause and recovery, press triggers and second presser, zonal marking, M5/M6; recalibrated, re-baselined, re-pinned"` and the trailer.

Merge into `main` only after the user has seen the results. Afterwards, regenerate the `out/` run folders in main. `pnpm library` waits for the user's OK, because it needs the agent service and the LLM.

---

## Self-review

**Spec coverage.**

| Spec item | Where |
|---|---|
| T2 terms and table | Task 3 (rows in Task 2, test in Task 10) |
| T3 zone and angle, replaces the flat rate and box ×0.2; targets 15, 0.9, 0.43 on ≥ 64 | Task 4 (ruling 3), Task 2 rows, Task 10 deep report |
| T4 attacker fouls about 3 | Task 4 (ruling 4) |
| T4 take-on fouls | Task 4 (ruling 5) |
| T4 aerial duels about 47 with about 5 fouls, in `resolve.ts` | Task 5 (rulings 6–7) |
| A4 join table, 4.5 m/s, replaces nearest only | Task 6 (ruling 10) |
| A4 recovery from 2.5 s, peak 5–6 s, about 15 %, upfield likelier | Task 6 (ruling 12) |
| A4 pause 1.5 s | Task 6 (ruling 11) |
| A5 triggers ×2 / ×2 | Task 7 (ruling 13) |
| A5 second presser within 12 m, cover shadow | Task 7 (ruling 14) |
| A5 CB step-out about 10 m | Task 8 (ruling 16) |
| A5 role mix CM 37 / W 19 / FB 13 | Task 7 (ruling 15) |
| A5 keeper-hands exemption (exists; verified) | Tasks 6 and 7 tests (ruling 18) |
| A5 zonal marking 40 %, tight about 9 % | Task 8 (ruling 17) |
| Checks: counter-press and recovery tables, press episodes 405 and 4.9 %, fouls, free kicks, cards | Task 2 rows, measured in Tasks 4, 6, 7 and 10 |
| P3 carry: M5 | Task 9 (ruling 19) |
| P3 carry: M6 | Task 9 (ruling 20) |
| P3 carry: M10 | Ruling 21, Task 10 Step 1 |
| P3 carry: deferred tests on P4 code | Task 4 (ruling 22) |
| Cards and discipline | Ruling 8, Task 4 Step 3, Task 10 Steps 2 and 7 |
| Distance | Ruling 25 |

- **Conventions:** worktree and branch (Setup); named streams (Global Constraints); switches; Python diagnostics (ruling 23); agents unaffected (no `decide.ts`); exit checks (Task 10); splitting (Task 10 Step 4).

**Step scan.** Every code step names its signature, file and spec values. The test steps carry names and assertions with the values. The `<…>` markers appear only in commit-message templates, filled from that task's own measurement.

**Type consistency.** These names keep the same signature in Task 1's table and in their consumers:
- `tackleWinLogit`, `foulChance`, `shieldingFoul`, `takeOnFoul`, `foulZone`;
- `aerialDuel`, `applyFlightFoul`;
- `noteLoss`, `inCounterWindow`, `transitionMove`;
- `teamPressMove`, `noteReception`;
- `markSpot`, `bootBlock(w, owner, d)`, `flightParams`, `rejudgeRelease`;
- the types `MoveTarget`, `FlightFoul`, `TransitionState`, `PressState`, `FoulKind`, `Bearing`;
- `bearingOf` (Task 3, used by Task 4) and `foulZone` (Task 4, used by Task 5).

**Review Focus.** Each line has its test:
- dt 0.04: Task 6 (window and pause), Task 7 (back to goal), Task 9 (re-judge);
- second half: Tasks 3, 4, 6, 7 and 8;
- keeper in hands: Tasks 6, 7 and 9;
- ten men: Task 3 (support), Task 4 (`takerFor`), Task 5 (sent off in flight), Task 6 (join pool);
- standing carrier: Task 3.

**Proportion.** About half the length of plan 8c, with code given only as signatures and test assertions.

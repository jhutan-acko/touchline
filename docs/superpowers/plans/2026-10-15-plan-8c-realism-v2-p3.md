# Realism v2, P3: passing execution and choice — implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. This plan is built for **parallel** execution: read "Parallel execution" before starting.

**Goal:** Passes behave like real passes. A defender standing at the passer's boot no longer takes every ball whatever its direction (X1); long balls stop over-completing (X2). Passers choose receivers with the weights real players use, including pressure, open lanes and the back pass to the keeper (D1); they release quickly when pressed and sometimes hold longer when free (D2); wide carriers cross to zones (D3); runners get balls into space (D4); keepers throw and punt from their hands (G5). The phase ends with the gate green on recalibrated parameters and every P3 target re-measured, MET or NOT MET.

**Architecture:**
- **Seams first.** Task 1 restructures `decide.ts` into a shared candidate path (`candidateContext`, `pushCandidate`) plus four delimited seam blocks (choice, crosses, through balls, keeper hands), adds three seam blocks to `step.ts` (boot block, release timing, keeper distribution), one optional field to `execute.ts`, and every P3 params block. All arithmetic stays bit-identical (gate drift 0).
- **One owner per block.** Each later task fills one seam block (plus its own new files and its own params block), so the tasks of a wave never edit the same lines.
- **Switches.** Every behaviour ships behind a `rule` switch (or a zero) that reproduces the old engine. Task 10 switches everything on, retires the knobs P3 makes inert, recalibrates with the parallel tuner, re-baselines and re-pins.
- **Diagnostic first.** Task 2 adds a passing section to the realism report (Python, as P2's bands) with the real aggregates, the conditional-logit refit, and a fast `--only passing --set key=value` mode, then commits the measured P2 baseline. Every later task measures before/after with it.
- **Choice without double counting.** D1 prices options with the real conditional-logit coefficients, measured where they were fitted (receivers' current positions at release), and keeps the two-step choice as a nested logit whose kind stage carries each kind's inclusive value. With equal kind shifts and temperature 1 the two steps reproduce the flat fitted logit exactly; a test pins that.

**Tech stack:** TypeScript (Effect monorepo, vitest), Python 3 (uv, pytest, numpy), pnpm 11.

**Spec:** `docs/superpowers/specs/2026-10-13-sim-realism-v2-design.md`: "Decisions", "Conventions for every phase", "Evaluation changes", "P3: passing execution and choice", "Non-goals", "Results: P1" and "Results: P2". The evidence is in `touchline-worktrees/analysis-positioning/` (`carrier-report.md`, `carrier.json`, `gk-report.md`, `finalthird-report.md`, `finalthird.json`), outside the repo, and in P2's `task-8-report.md` / `task-8b-report.md`. Only the aggregate numbers quoted in this plan may be committed.

**Starting point (Results: P2 and the P2 runs).**
- Gate loss 26.87; passes **1054–1075 per match against 866** (z +2.1 to +2.3); completion 0.729 against 0.781; long-pass share 0.185 against 0.143.
- **Ball upfield:** while a team has the ball its mean ball u is +2.4 m (real −5.2); by thirds 18 / 58 / 24 % (real 35 / 43 / 22 %). This is 85 % of the line-height deficit (task-8b-report).
- Preliminary, events only, from the P2 worktree's 16 realism runs (seeds 2000–2015): 8.5 % of open-play passes are intercepted on the first tick; switches 16.6 % of open-play passes (real 6.1 %); passes back to the keeper 1.1 % (real 6.2 %); keeper passes 17 per team-match (real 45.4); 7.4 open-play crosses per match (real 14.9 outside the 10 s post-restart window); 46 through or lofted through balls per match. Task 2 re-measures all of these properly.

## Setup (before Task 1)

P3 builds on the finished P2 code. If `realism-v2-p2` has been merged into `main`, branch from `main`. Otherwise branch from `realism-v2-p2`'s last commit, and only once P2's exit commits are on it: the spec has a "Results: P2" section, `data/params/realism-baseline.json` and the goldens are refreshed, and `git -C ../touchline-worktrees/p2-task8 status --short` and `git -C ../touchline-worktrees/realism-v2-p2 status --short` are both empty (nobody is still committing P2).

```bash
cd /Users/jhutan.debnath/Documents/GitHub/microsoft-hackathon/touchline
git worktree add ../touchline-worktrees/realism-v2-p3 -b realism-v2-p3 main   # or: ... realism-v2-p2
cd ../touchline-worktrees/realism-v2-p3 && pnpm install
```

`realism-v2-p3` is the **integration branch**. Every path below is relative to a worktree of it.

## Parallel execution

### Dependency graph

```
Task 1 (scaffold: params, decide/step/execute seams) ──┬──> Task 3 (X1 first tick, boot blocks) ──┬──> Task 8 (X2 pass length) ──┐
Task 2 (diagnostic: passing report, --set, baseline) ──┤    Task 4 (D2 release timing) ───────────┤                             │
                                                       ├──> Task 5 (D3 crosses) ───────────────────┼──> Task 9 (D1 pass choice) ──┼──> Task 10 (switch on, recalibrate,
                                                       ├──> Task 6 (D4 through balls) ─────────────┤                             │     gate, re-pin, results)
                                                       └──> Task 7 (G5 keeper distribution) ───────┘                             │
                                                                                                    (Tasks 4–7 also feed 10) ────┘
```

### Waves

| Wave | Tasks, run concurrently | Starts when |
|---|---|---|
| 0 | Task 1, Task 2 | Setup is done |
| 1 | Task 3, Task 4, Task 5, Task 6, Task 7 | Tasks 1 and 2 are merged into `realism-v2-p3` |
| 2 | Task 8, Task 9 | Every wave-1 task is merged, **Task 3 first** |
| 3 | Task 10 | Tasks 8 and 9 are merged |

- **X1 first (spec).** Merge Task 3 before any other wave-1 task. D1, the pass-choice refit, is in wave 2 and measures with X1 on. D3, D4 and G5 only add options behind switches in wave 1; nothing is refitted before X1.
- **Measurements need Task 2.** Every wave-1 and wave-2 task ends with a before/after measurement using Task 2's diagnostic, so wave 1 starts only after Task 2 is merged.

### File ownership

Each task creates or modifies only the files listed for it. Three files are shared by delimited regions that Task 1 creates as banner-commented blocks; a task edits only its own block, plus its own import lines directly under its import marker (a module may be imported twice).

| Task | Owns (create or modify) | In `decide.ts` | In `step.ts` | In `params.ts` |
|---|---|---|---|---|
| 1 | `sim-core/src/{params,types,decide,execute,step}.ts`, `sim-core/test/params.test.ts` (append) | Whole file (restructure, create the seams) | Import markers, three seam blocks, call sites in `changePossession`, `resolveFlightNow`, `releaseKick`, `ownerDecision` | Types and every P3 block (all off) |
| 2 | `python/analytics/touchline_analytics/passing.py` (new), `report.py`, `targets.py`, `python/analytics/tests/test_passing.py` (new), `data/params/targets-idsse.json` (new `passing` block), `calibrate/src/overrides.ts` (new), `calibrate/src/realism.ts`, `calibrate/test/overrides.test.ts` (new), `docs/realism/p3-passing-baseline.md` (new) | — | — | — |
| 3 | `sim-core/src/resolve.ts`, `sim-core/src/deflect.ts` (append), `sim-core/test/x1.test.ts` (new) | — | **Boot-block seam** block and its import marker | `firstTick` values (not `rule`) |
| 4 | `sim-core/src/release.ts` (new), `sim-core/test/release.test.ts` (new) | — | **Release seam** block and its import marker | `release` values (not `rule`) |
| 5 | `sim-core/test/crosses.test.ts` (new) | **Cross seam** block and its import marker | — | `cross` values (not `rule`) |
| 6 | `sim-core/test/through.test.ts` (new) | **Through-ball seam** block and its import marker | — | `through` values (not `rule`) |
| 7 | `sim-core/test/distribution.test.ts` (new) | **Keeper-hands seam** block and its import marker | **Keeper-distribution seam** block | `distribution` values (not `rule`) |
| 8 | `sim-core/src/execute.ts` (`executeKick` body), `sim-core/test/x2.test.ts` (new) | — | — | the `pass.longErrorPerM` / `longErrorFromM` line |
| 9 | `sim-core/test/choice.test.ts` (new) | **Choice seam** block and its import marker | — | `choice` values (not `rule`) |
| 10 | Everything else: switches in `params.ts`, `params.test.ts` switch test, `calibrate/src/knobs.ts`, `data/params/*`, `docs/`, seed pins, goldens, `sim-core/test/passing-targets.test.ts` (new) | — | anything left | the six `rule` switches |

"Values (not `rule`)" means a task may change the non-switch numbers of its own params block from its measurement (for example `firstTick.bootBlock`), never another block, and never a `rule`. Task 1 places each P3 block on its own lines, away from the other P3 blocks, so these edits merge cleanly.

### How to run a wave

For each task in the wave, from the integration worktree:

```bash
cd /Users/jhutan.debnath/Documents/GitHub/microsoft-hackathon/touchline-worktrees/realism-v2-p3
git worktree add ../p3-task<N> -b p3-task<N> realism-v2-p3
cd ../p3-task<N> && pnpm install
```

One implementer works in each `p3-task<N>` worktree and commits there. When every task of the wave is committed, merge them into the integration branch one at a time (wave 1: Task 3 first):

```bash
cd /Users/jhutan.debnath/Documents/GitHub/microsoft-hackathon/touchline-worktrees/realism-v2-p3
git merge --no-ff p3-task<N> -m "merge: P3 task <N> (<short name>)"
```

Then check the wave on the merged branch:

```bash
pnpm --filter @touchline/sim-core exec vitest run --no-file-parallelism
pnpm --filter @touchline/calibrate exec vitest run test/realism-gate.test.ts --disableConsoleIntercept
```

Expected: PASS, with every drift exactly 0: waves 0–2 change no switch, and the values a task may change are read only behind its switch. Then remove the task worktrees: `git worktree remove ../p3-task<N> && git branch -d p3-task<N>`.

**If a merge conflicts** in `decide.ts`, `step.ts` or `params.ts`, the two sides edited neighbouring blocks. Keep both sides. Never resolve by dropping a seam body.

## Global Constraints

- **Data.** Never commit `data/raw/`. Only aggregate real-data statistics are committed, and only the aggregates quoted in this plan may be copied from the analysis folder.
- **Tests and gate.** Tests are never loosened and the gate is never widened. Realism gate: loss < `GATE_LOSS` 30 (`packages/calibrate/test/realism-gate.test.ts`); never raise it and never drop a statistic. A real target that still fails goes in `it.fails`, unwidened, with the measured value in a comment.
- **Determinism.** The engine stays deterministic for a seed. New random behaviour draws from its own named stream, `substream(seed, concern)`: P3 adds `boot` (X1 boot blocks) and `release` (D2). Choices made inside `decide` draw from the `decision` stream, as every `decide` draw does. No `Math.random`, no `Date`.
- **Defaults.** Every P3 behaviour ships off: `firstTick.rule`, `choice.rule`, `release.rule`, `cross.rule`, `through.rule`, `distribution.rule` 0, `pass.longErrorPerM` 0. Only Task 10 turns them on. Until then the gate drift check reports 0 for every statistic.
- **Sensitive files.** The user approved changes to `decide.ts`, `execute.ts` and `resolve.ts` **for P3 only**, as this plan lays them out. **The shot model is untouched** (`shot.ts`, `xgOf`, the shot logit and `releaseShot`; that is P6). No P4/P5 work: tackles, fouls, aerial duels, pressing, role moves and set pieces stay as they are.
- **Test command.** `pnpm --filter <pkg> exec vitest run --no-file-parallelism` (full-match tests time out in parallel).
- **Gate check.** `pnpm --filter @touchline/calibrate exec vitest run test/realism-gate.test.ts --disableConsoleIntercept`.
- **Team frame.** u is along the attack, in metres, u = +52.5 at the opponent's goal line: `u = x · dirOf(side, period)` (`attackX`). The near side of a cross is the crosser's own touchline, `Math.sign(owner.pos.y)` in pitch coordinates.
- **Commits.** Every commit message ends with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- **Agents.** The decision log format, `overridePass` and the recorded options stay compatible: same fields, same action names. Under D1 an option's `value` is a utility and may be negative.
- **Region ownership.** Edit only the region the ownership table gives your task. A change you need elsewhere is a plan bug: stop and report it.

## Rulings on the spec

Decisions taken while planning, where the spec was silent, ambiguous, or in conflict with the code or data. Task 10 copies them into the results.

1. **Params names.** Each behaviour gets its own top-level block: `firstTick` (X1), `choice` (D1), `release` (D2), `cross` (D3), `through` (D4), `distribution` (G5). The spec's `pass.longErrorPerM` keeps its name, with a companion `pass.longErrorFromM` (30 m).
2. **X1 geometry (spec conflict).** The spec's fallback "otherwise the reachable-disc test applies, including reactionS" does not stop the boot interception: while a defender is still reacting his disc radius is `reachM` (1 m), and the closest point of the first tick's segment to a defender behind the passer is the ball's start, so any defender within 1 m of the passer still qualifies. Ruling: on the first tick, for **opponents** only, the contact point is clamped to the part of the path at least `alongM` (0.5 m) from the start. He takes the ball outright if that contact is within `reachM` **and** he stands within `coneDeg` (±60°) of the pass direction from the passer; otherwise the disc test runs on the clamped contact. Teammates keep the old rule.
3. **Boot blocks.** The nearest outfield opponent within `firstTick.bootM` (1 m) of the passer blocks an open-play pass with chance `firstTick.bootBlock` (the `boot` stream); the ball is knocked loose at 2–6 m/s (`deflectLoose`). Not for clearances, restarts or crosses (crosses keep `defending.crossBlock`). Task 3 sets `bootBlock` so passes released with an opponent within 1 m complete about 70 % (real 64 % below 0.75 m, 76 % at 0.75–1 m).
4. **X2 is conditional (spec).** `pass.longErrorPerM` multiplies a high ball's execution error by `1 + longErrorPerM · (length − 30)` beyond 30 m; no new random draws. Task 8 sets it only if, with X1 on, passes of 30 m or more to an available receiver complete above 0.85 (real 0.74–0.85).
5. **D1 coefficients.** The utility uses the real pooled fit (carrier-report C3, all passes): distance −1.33, forward +0.56, lateral +0.18, lane blocked −0.55, openness +1.27, line-breaking +0.04, keeper +0.95 (per unit of each feature, as fitted). Pressure interactions are centred on the real mean pressure at release (0.366) and come from the < 2 m and > 5 m fits divided by 0.875 (the mean pressure of the < 2 m bin): forward +0.22, lateral −0.46, openness −0.58, line-breaking −0.58, keeper +0.98, distance and lane 0.
6. **"Pressed carriers favour near options" (spec vs data).** The data has no pressure effect on distance (−1.33 under 2 m, −1.34 beyond 5 m). Real pressed carriers end up nearer because they avoid switches (lateral +0.34 → −0.06), accept tighter receivers and go back to the keeper. Ruling 5's interactions carry that; there is no distance interaction.
7. **Where features are measured.** As fitted: at the receiver's **current** position at release, with the lane blocked if an opponent is within 2 m of the passer→receiver segment (0.05 < t < 0.95), openness `min(nearest opponent, 10)/5`, line-breaking against the opponents' midfield line (mean u of their 5th–8th deepest outfielders; 0 with fewer than 8). The 0.5 s lead stays the aim point. Through-ball and cross targets use the target point.
8. **"Lanes at release and at the lead point."** The release lane carries the fitted −0.55. The lane to the aimed point adds `choice.leadLane` (default 0, so the fit is not double-counted). Task 9 raises it only if completion needs it, and records that.
9. **Pitch control (spec gap).** There is no fitted pitch-control share in `carrier.json` or any report. Under D1, pitch control leaves the utility; it stays only in the recorded `xpass`. The `pass_pc_weight` and `pass_safety` knobs, inert under D1, are retired in Task 10.
10. **Two-step choice as a nested logit.** The kind stage keeps the zone logits for non-pass actions. A pass kind's logit becomes the zone's `short_pass` logit + `choice.kindShift[kind]` + `choice.inclusive · (IV − choice.ivCentre)`, with IV = T·log Σ exp(U/T) over that kind's options, plus the existing style, pressure and script terms. The receiver is drawn by softmax(U/T), T = `choice.temperature · (1.4 − vision) / 0.8` (0.8 = 1.4 − the league's mean vision 0.6). With equal shifts, inclusive 1 and T 1, the two steps equal the flat fitted logit (Task 9 test). The spec's "switch and long_pass zone logits are refitted" becomes `kindShift.switch` and `kindShift.long_pass` (with `lofted_through`), set by Task 9's measurement. The old safety lean does not apply under D1.
11. **Decision record under D1.** `value` is the utility; `decisionQuality` = exp((U_chosen − U_best)/T), in (0, 1]; `action_probs`, `options`, `chosen_rank` keep their format.
12. **Keeper as receiver (G5a).** Inside D1: the fitted keeper coefficient is the "safety term". The rule that never lofts a ball back at the keeper stays.
13. **G5 from the hands.** In open play, a keeper with the ball in his hands either throws (to a teammate 4–35 m away, along the ground, error × 0.5) or punts (to a ST, W or AM 35–70 m away, high, error × 1.6), punting with chance sigmoid(−0.75) = 0.32 (real: 1.6 punts against 3.4 throws per team-match). No new `Action` values: the method rides on the candidate, the decision records the method probabilities under `long_pass` (punt) and `short_pass` (throw), and `keeper_distribution.method` becomes truthful ("throw", "punt" or "kick"). Restarts (goal kicks) are unaffected.
14. **D2.** "Pressed" means an opponent within 2 m at the moment the player wins or receives the ball; then 0.2–0.7 s. Otherwise `timing.decisionMinS..MaxS` plus, with chance `release.tailShare` (start 0.25), an exponential extra of mean `release.tailMeanS` (start 1.5 s); Task 4 tunes the tail so on-ball times over 3 s are about 16 % (real). The `decision_scale` knob still scales the base range.
15. **D3 zones.** The spec's four: near post (u 47.5, 3 m to the crosser's side), penalty spot (41.5, 0), far post (47, 4 m to the far side), cut-back (42, 6 m to the crosser's side, along the ground, only from u ≥ 44). "Wide carrier in the final third" uses the classifier's own cross geometry: u > 17.5 and |y| > 20.16. A zone is offered if an attacker can be there by the ball's arrival, and is worth `cross.attackerValue` (0.3) per such attacker on top of the option's normal value.
16. **D4 run intents (spec gap).** The `overlap` intent does not exist until P5 (A6). D4 keys on `run_in_behind` through `isRunIntent`, so P5 can add `overlap`. Under D4 only runners get a through target (the old fixed 8 m lead for anyone near the last defender goes): through-ball shots are already 15 % of sim shots against 2.5 % real (finalthird-report).
17. **Diagnostics in Python.** As P2's bands (P2 ruling 16): nothing in the tuner or the gate uses them, so there is no TypeScript port or parity test. The real aggregates are hand-copied into a new `passing` block of `targets-idsse.json`, with MET bands that turn the spec's "about" into ranges (listed in Task 2). `targets.py` keeps the block.
18. **P2's two problems.** **Passes per match (1075 against 866): Task 4 (D2) owns it** — the count is set by time on the ball. **Ball upfield (18 % own third against 35 %): Task 9 (D1) owns it** — most-forward choices 45 % against 20 %, almost no back passes to the keeper; Tasks 4 and 7 contribute. Every task records both numbers before and after.
19. **Real-target tests.** Mechanism tests live in each task. Task 10 adds `passing-targets.test.ts`, which measures the event-level targets on the calibrated parameters (4 matches); targets still missed go in `it.fails`, unwidened.
20. **Choice-refit comparison.** The sim refit uses the engine's true intended receiver; the real fit used inferred receivers for failed passes (the "all" basis, 59–82 % accurate). Option sets come from tracking, so they include teammates the engine never offers (for example a keeper beyond 30 m, whom nobody lofts the ball to); that can pull the sim's keeper coefficient down. Task 9 and Task 10 record the refit as measured.

## Review Focus

1. **25 Hz render runs (dt 0.04).** The first tick then covers 0.04 s and the ball moves only 0.6–0.8 m, so X1's 0.5 m clamp sits close to the segment's end; D2's 0.2 s minimum is 5 ticks. A pass straight away from an adjacent defender must still complete at dt 0.04, and pressed release delays must be 5–18 ticks. Covered by the dt cases in Tasks 3 and 4.
2. **A keeper with the ball in his hands at a restart.** `keeperHands` is set only from an open-play hands possession; a goal kick or free kick taken by the keeper must keep the normal restart options, with no throw or punt. Covered by the restart case in Task 7.
3. **Ten men, or fewer than 8 opponent outfielders.** The opponents' midfield line is undefined; line-breaking must be 0 and the utility finite, never NaN. Covered by the sent-off case in Task 9.
4. **What-if forced passes and the decision log under D1.** `overridePass` must still return a forced decision whose `decisionQuality` is in [0, 1] when utilities are negative. Covered by the override case in Task 9.
5. **Second half and the left touchline.** Cross zones and through leads must mirror: in the second half home attacks −x, and a cross from the left (y < 0) has its near post at y < 0. Covered by the mirror cases in Tasks 5 and 6.

---

### Task 1: Scaffold — params, decide/step/execute seams, RNG streams (wave 0, identity)

**Files:**
- Modify: `packages/sim-core/src/params.ts`, `packages/sim-core/src/types.ts`, `packages/sim-core/src/decide.ts` (restructure), `packages/sim-core/src/execute.ts` (one field, one line), `packages/sim-core/src/step.ts` (markers, three seam blocks, call sites)
- Test: `packages/sim-core/test/params.test.ts` (append)

**Interfaces:**
- Produces (in `params.ts`):
  - `type PassAction = Exclude<Action, "carry" | "take_on" | "shot" | "clear" | "hold">`
  - `interface ChoiceCoefs { dist; fwd; lat; lane; open; lineBreak; keeper }` (numbers)
  - `interface CrossZone { u: number; s: number; height: "high" | "ground"; minOriginU: number }`
  - `Params.firstTick: { rule; alongM; coneDeg; bootM; bootBlock }`
  - `Params.pass` gains `longErrorPerM`, `longErrorFromM`
  - `Params.choice: { rule; base: ChoiceCoefs; press: ChoiceCoefs; pressCentre; leadLane; inclusive; ivCentre; temperature; kindShift: Record<PassAction, number> }`
  - `Params.release: { rule; pressedM; pressedS: [number, number]; tailShare; tailMeanS }`
  - `Params.cross: { rule; zones: CrossZone[]; flightSpeed; runSpeed; arriveSlackS; attackerValue }`
  - `Params.through: { rule; ballSpeed; runSpeed; leadMaxM }`
  - `Params.distribution: { rule; throwMaxM; throwErrorScale; puntMinM; puntMaxM; puntErrorScale; puntLogit }`
- Produces (in `types.ts`): `CONCERNS` gains `"boot"` and `"release"`.
- Produces (in `execute.ts`): `KickIntent.errorScale?: number` (multiplies the Gaussian error; undefined = 1).
- Produces (in `decide.ts`, exported):
  - `Candidate.method?: "throw" | "punt"`; `DecisionInput.keeperHands?: boolean`
  - `interface CandidateContext { input; p; pressure; side; period; dir; lastDef; ownerThreat; pc }`
  - `interface PushOptions { featureAt?: Vec2; bonus?: number; method?: "throw" | "punt" }`
  - `candidateContext(input, p, pressure): CandidateContext`
  - `pushCandidate(ctx, out: Candidate[], receiver: PlayerState, target: Vec2, height: PassHeight, o?: PushOptions): void`
  - `buildCandidatesIn(ctx): Candidate[]`; `buildCandidates(input, p, pressure)` unchanged
  - `softmaxPick(logits, rng): number`
  - `interface CrossOption { receiver: PlayerState; target: Vec2; height: PassHeight; bonus: number }`
  - `interface ThroughOption { target: Vec2; height: PassHeight }`
- Produces (in `decide.ts`, module-private seams; later tasks fill the bodies):
  - choice seam (Task 9): `choiceValue(ctx, receiver, target, featureAt, lane, xp): number`, `kindTerm(ctx, candidates, a, base): number`, `receiverPick(ctx, options, rng): number`, `optionQuality(ctx, chosen, best): number`
  - cross seam (Task 5): `crossTargets(ctx): CrossOption[]`
  - through seam (Task 6): `throughTargets(ctx, tm): ThroughOption[]`
  - keeper-hands seam (Task 7): `keeperHandsDecision(ctx, rng): Decision | null`
- Produces (in `step.ts`, private seams):
  - boot-block seam (Task 3): `bootBlock(w, owner, d, target): { blocker: PlayerState; loose: BallState } | null`
  - release seam (Task 4): `releaseDelayTicks(w, pl): number`
  - keeper-distribution seam (Task 7): `keeperMethod(w, d): string`, `kickStyle(w, d, restart): { technique: "throw" | "foot"; hands: boolean; errorScale: number }`

- [ ] **Step 1: Write the failing test** (append to `packages/sim-core/test/params.test.ts`; `CONCERNS`, `DEFAULT_PARAMS`, `ParamsError`, `paramsFromJson` are already imported)

```ts
describe("realism v2 P3 params", () => {
  const cc = { dataset: "open data", licence: "CC-BY-4.0", attribution: "Some League; Someone et al.", fitted_at: "2026-10-04", version: "v1" }
  it("ship switched off, with the real choice coefficients, four cross zones and two new RNG streams", () => {
    for (const rule of [DEFAULT_PARAMS.firstTick.rule, DEFAULT_PARAMS.choice.rule, DEFAULT_PARAMS.release.rule, DEFAULT_PARAMS.cross.rule, DEFAULT_PARAMS.through.rule, DEFAULT_PARAMS.distribution.rule]) expect(rule).toBe(0)
    expect(DEFAULT_PARAMS.pass.longErrorPerM).toBe(0)
    expect(DEFAULT_PARAMS.choice.base).toEqual({ dist: -1.33, fwd: 0.56, lat: 0.18, lane: -0.55, open: 1.27, lineBreak: 0.04, keeper: 0.95 })
    expect(DEFAULT_PARAMS.choice.press).toEqual({ dist: 0, fwd: 0.22, lat: -0.46, lane: 0, open: -0.58, lineBreak: -0.58, keeper: 0.98 })
    expect(DEFAULT_PARAMS.cross.zones.map((z) => [z.u, z.s, z.height])).toEqual([[47.5, 3, "high"], [41.5, 0, "high"], [47, -4, "high"], [42, 6, "ground"]])
    expect(CONCERNS).toContain("boot")
    expect(CONCERNS).toContain("release")
  })
  it("accept negative choice shifts and zone offsets from a file, and reject a boot-block share above 1 or a negative tail", () => {
    const p = paramsFromJson({ provenance: cc, choice: { kindShift: { switch: -1.25 } } })
    expect(p.choice.kindShift.switch).toBe(-1.25)
    expect(p.choice.kindShift.long_pass).toBe(0)
    expect(paramsFromJson({ provenance: cc }).cross.zones[2]!.s).toBe(-4)
    expect(() => paramsFromJson({ provenance: cc, firstTick: { bootBlock: 1.5 } })).toThrow(/between 0 and 1/)
    expect(() => paramsFromJson({ provenance: cc, release: { tailMeanS: -1 } })).toThrow(ParamsError)
  })
})
```

Run: `pnpm --filter @touchline/sim-core exec vitest run test/params.test.ts`
Expected: FAIL. TypeScript reports that `firstTick` does not exist on `Params`.

- [ ] **Step 2: Add the params** (`packages/sim-core/src/params.ts`)

After the `PosRow` interface, add:

```ts
/** The pass actions: every action that plays the ball to a teammate. */
export type PassAction = Exclude<Action, "carry" | "take_on" | "shot" | "clear" | "hold">
/** Pass-choice coefficients (or features), per unit of: distance/10, forward gain/10, |lateral|/10, lane blocked, min(open,10)/5, line-breaking, keeper. */
export interface ChoiceCoefs { readonly dist: number; readonly fwd: number; readonly lat: number; readonly lane: number; readonly open: number; readonly lineBreak: number; readonly keeper: number }
/** A cross target (D3): team-frame u, s metres toward the crosser's own touchline, height, and the least origin u it is offered from (0 = any). */
export interface CrossZone { readonly u: number; readonly s: number; readonly height: "high" | "ground"; readonly minOriginU: number }
```

In `Params`, after `kinematics`, add:

```ts
  /**
   * X1 (realism v2 P3). On a pass's first tick an opponent's contact point is taken at least alongM along the path; he
   * takes the ball outright only if it is within reach and he stands within coneDeg of the pass direction from the passer,
   * otherwise the reachable disc (with reactionS) decides. The nearest outfield opponent within bootM of the passer blocks
   * an open-play pass at the boot with chance bootBlock (boot RNG stream). rule 0: the old first-tick rule, no boot blocks.
   */
  readonly firstTick: { readonly rule: number; readonly alongM: number; readonly coneDeg: number; readonly bootM: number; readonly bootBlock: number }
```

In `Params.pass`, after `safetyWeight`, add:

```ts
    /** X2: a high ball's execution error grows by longErrorPerM per metre beyond longErrorFromM (multiplier 1 + ...; 0 = off). */
    readonly longErrorPerM: number
    readonly longErrorFromM: number
```

After `Params.shot`, add:

```ts
  /**
   * D1 (P3): pass choice as the real conditional logit (carrier-report C3). An option's utility is
   * sum_k (base_k + press_k (pressure - pressCentre)) feature_k, plus leadLane when the lane to the aimed point is blocked.
   * A pass kind's logit is the zone's short_pass logit + kindShift[kind] + inclusive (T log sum exp(U / T) - ivCentre), and
   * the receiver is drawn by softmax(U / T), T = temperature (1.4 - vision) / 0.8. rule 0: the old value and choice.
   */
  readonly choice: {
    readonly rule: number
    readonly base: ChoiceCoefs
    readonly press: ChoiceCoefs
    readonly pressCentre: number
    readonly leadLane: number
    readonly inclusive: number
    readonly ivCentre: number
    readonly temperature: number
    readonly kindShift: Readonly<Record<PassAction, number>>
  }
```

After `Params.timing`, add:

```ts
  /** D2 (P3): time on the ball after winning or receiving it (release.ts). rule 0: the flat timing.decisionMinS..MaxS draw. */
  readonly release: { readonly rule: number; readonly pressedM: number; readonly pressedS: readonly [number, number]; readonly tailShare: number; readonly tailMeanS: number }
```

After `Params.defending`, add:

```ts
  /**
   * D3 (P3): a wide carrier in the final third also aims crosses at zones, each offered if an attacker can be there when
   * the ball arrives (flight at flightSpeed, run at runSpeed, plus arriveSlackS) and worth attackerValue per such attacker.
   * rule 0: crosses only to teammates' positions.
   */
  readonly cross: { readonly rule: number; readonly zones: ReadonlyArray<CrossZone>; readonly flightSpeed: number; readonly runSpeed: number; readonly arriveSlackS: number; readonly attackerValue: number }
```

After `Params.keeper`, add:

```ts
  /**
   * G5 (P3): in open play a keeper with the ball in his hands throws (4..throwMaxM, error x throwErrorScale) or punts to a
   * forward (puntMinM..puntMaxM, high, error x puntErrorScale), punting with chance sigmoid(puntLogit). rule 0: from his feet.
   */
  readonly distribution: { readonly rule: number; readonly throwMaxM: number; readonly throwErrorScale: number; readonly puntMinM: number; readonly puntMaxM: number; readonly puntErrorScale: number; readonly puntLogit: number }
```

After `Params.runs`, add:

```ts
  /** D4 (P3): a teammate on a run gets the ball into the space where he will be when it arrives (at most leadMaxM along his run); nobody else gets a through target. rule 0: the old 8 m lead for anyone near the last defender. */
  readonly through: { readonly rule: number; readonly ballSpeed: number; readonly runSpeed: number; readonly leadMaxM: number }
```

In `DEFAULT_PARAMS` (each block on its own lines, in these places):

- after the `kinematics` line:
  ```ts
  // P3 X1 (plan 8c Task 3 may change the values, not rule).
  firstTick: { rule: 0, alongM: 0.5, coneDeg: 60, bootM: 1, bootBlock: 0.25 },
  ```
- after `timing: { ... },`:
  ```ts
  // P3 D2 (plan 8c Task 4 may change the values, not rule).
  release: { rule: 0, pressedM: 2, pressedS: [0.2, 0.7], tailShare: 0.25, tailMeanS: 1.5 },
  ```
- in `pass`, after `safetyWeight: 0` (add the comma), on its own line:
  ```ts
    // P3 X2 (plan 8c Task 8 may change this line).
    longErrorPerM: 0, longErrorFromM: 30
  ```
- after `shot: { ... },`:
  ```ts
  // P3 D1 (plan 8c Task 9 may change the values, not rule). Real pooled fit (carrier-report C3, all passes, IDSSE 7 matches)
  // and the change per unit of pressure about the real mean pressure at release (0.366).
  choice: {
    rule: 0,
    base: { dist: -1.33, fwd: 0.56, lat: 0.18, lane: -0.55, open: 1.27, lineBreak: 0.04, keeper: 0.95 },
    press: { dist: 0, fwd: 0.22, lat: -0.46, lane: 0, open: -0.58, lineBreak: -0.58, keeper: 0.98 },
    pressCentre: 0.366,
    leadLane: 0,
    inclusive: 1,
    ivCentre: 0,
    temperature: 1,
    kindShift: { short_pass: 0, long_pass: 0, through_ball: 0, lofted_through: 0, switch: 0, cross: 0, cutback: 0, back_pass: 0 }
  },
  ```
- after `defending: { ... },`:
  ```ts
  // P3 D3 (plan 8c Task 5 may change the values, not rule). Zones in the team frame; s toward the crosser's touchline.
  cross: {
    rule: 0,
    zones: [
      { u: 47.5, s: 3, height: "high", minOriginU: 0 },
      { u: 41.5, s: 0, height: "high", minOriginU: 0 },
      { u: 47, s: -4, height: "high", minOriginU: 0 },
      { u: 42, s: 6, height: "ground", minOriginU: 44 }
    ],
    flightSpeed: 18,
    runSpeed: 7,
    arriveSlackS: 0.3,
    attackerValue: 0.3
  },
  ```
- after the `keeper` line:
  ```ts
  // P3 G5 (plan 8c Task 7 may change the values, not rule). Real: 3.4 throws and 1.6 punts per team-match (gk-report).
  distribution: { rule: 0, throwMaxM: 35, throwErrorScale: 0.5, puntMinM: 35, puntMaxM: 70, puntErrorScale: 1.6, puntLogit: -0.75 },
  ```
- after the `runs` line:
  ```ts
  // P3 D4 (plan 8c Task 6 may change the values, not rule).
  through: { rule: 0, ballSpeed: 14, runSpeed: 7, leadMaxM: 15 },
  ```

Range checks: append to `SIGNED` the patterns `/^choice\.(base|press|kindShift)\./`, `/^choice\.(leadLane|ivCentre)$/`, `/^cross\.zones/`, `/^distribution\.puntLogit$/`; add `"firstTick.bootBlock"` and `"release.tailShare"` to `PROBABILITIES`.

- [ ] **Step 3: Add the RNG streams** (`packages/sim-core/src/types.ts`)

`CONCERNS` becomes `["decision", "execution", "duel", "referee", "movement", "restart", "script", "bench", "keeper", "caution", "drift", "boot", "release"] as const`.

- [ ] **Step 4: Add `errorScale`** (`packages/sim-core/src/execute.ts`)

In `KickIntent`, after `forceMishit`:

```ts
  /** Multiplies the direction and distance error (keeper throws below 1, punts above; P3 G5). Undefined means 1. */
  readonly errorScale?: number
```

The `skill` line becomes:

```ts
  const skill = (1.35 - 0.7 * k.technique) * (1 + p.fatigue.executionK * (k.fatigue ?? 0)) * (k.errorScale ?? 1)
```

- [ ] **Step 5: Restructure `decide.ts` into the shared path and the seams**

Replace `packages/sim-core/src/decide.ts` with the file below. Everything above "P3 candidate plumbing" is the old file with two new optional fields; the plumbing and the seams hold the old arithmetic, moved, not changed.

```ts
import { classifyPass, type PassHeight, type PassKind } from "./classify.js"
import { actionZone, attackX, dirOf, dist, goalAngle, goalOf, PITCH, type Period, type Side, type Vec2 } from "./geometry.js"
import { ACTIONS, type Action, type Params } from "./params.js"
import { pitchControlAt, type PcPlayer } from "./pitchcontrol.js"
import type { Rng } from "./rng.js"
import type { OptionRecord, PlayerState, RestartKind, TeamStyle } from "./types.js"
// ---- P3 imports, choice seam (plan 8c Task 9 inserts below this line)

// ---- P3 imports, cross seam (plan 8c Task 5 inserts below this line)

// ---- P3 imports, through-ball seam (plan 8c Task 6 inserts below this line)

// ---- P3 imports, keeper-hands seam (plan 8c Task 7 inserts below this line)

export const KIND_TO_ACTION: Readonly<Record<Exclude<PassKind, "set_piece">, Action>> = {
  short: "short_pass",
  long: "long_pass",
  through: "through_ball",
  lofted_through: "lofted_through",
  switch: "switch",
  cross: "cross",
  cutback: "cutback",
  back: "back_pass"
}

export interface Candidate {
  readonly action: Action
  readonly kind: PassKind
  readonly receiverId: string
  readonly target: Vec2
  readonly height: PassHeight
  readonly xpass: number
  readonly value: number
  readonly lane: number
  /** How a keeper plays it from his hands (P3 G5); absent for every other pass. */
  readonly method?: "throw" | "punt"
}

export interface DecisionInput {
  readonly period: Period
  readonly owner: PlayerState
  readonly teammates: ReadonlyArray<PlayerState>
  readonly opponents: ReadonlyArray<PlayerState>
  readonly style: TeamStyle
  /** Own score minus opponent score. */
  readonly scoreDiff: number
  readonly minute: number
  readonly restart: RestartKind | null
  /** Additive logit bias from scenario scripts. */
  readonly scriptBias: Partial<Record<Action, number>>
  /** Seconds the player has had the ball (0 when not given). */
  readonly onBallS?: number
  /** True when the owner is a keeper whose hold in his hands has just ended (open play; P3 G5). */
  readonly keeperHands?: boolean
}

export interface Decision {
  readonly action: Action
  readonly candidate: Candidate | null
  /** Chosen option value / best option value (null when no pass was chosen). */
  readonly decisionQuality: number | null
  readonly xg: number | null
  readonly pressure: number
  /** Probability of each available action at the moment of decision (unavailable actions omitted). */
  readonly actionProbs: Readonly<Record<string, number>>
  /** The best pass options available, highest value first (at most OPTIONS_RECORDED). */
  readonly options: ReadonlyArray<OptionRecord>
  /** 1 when the chosen pass was the best available option, 2 for the second best, ...; null when no pass was chosen. */
  readonly chosenRank: number | null
  /** True when no option of the chosen action existed (a forced restart) and the best pass of any kind was played. */
  readonly fallback: boolean
  /** True when a what-if override chose the pass (recorded as `forced_pass` on the event). */
  readonly forced?: boolean
}

export const OPTIONS_RECORDED = 5
/** A pass type whose safest option is expected to arrive more (less) often than this gains (loses) logit, by pass.safetyWeight. */
export const SAFETY_PIVOT = 0.75

const r3 = (v: number): number => Math.round(v * 1000) / 1000

export const toOption = (c: Candidate): OptionRecord => ({
  action: c.action,
  receiver_id: c.receiverId,
  kind: c.kind,
  target_x: Math.round(c.target.x * 100) / 100,
  target_y: Math.round(c.target.y * 100) / 100,
  xpass: r3(c.xpass),
  value: r3(c.value)
})

const sigmoid = (z: number): number => 1 / (1 + Math.exp(-z))

/** Simple threat surface: 1 at the goal mouth, decaying with distance. Replaced by fitted xT in Plan 2. */
export const threat = (side: Side, period: Period, pos: Vec2): number => Math.exp(-dist(pos, goalOf(side, period)) / 20)

export const lastDefenderAttackX = (side: Side, period: Period, opponents: ReadonlyArray<PlayerState>): number => {
  let best = -PITCH.halfL
  for (const o of opponents) if (o.role !== "GK" && !o.sentOff) best = Math.max(best, attackX(side, o.pos.x, period))
  return best
}

const segmentDistance = (a: Vec2, b: Vec2, q: Vec2): { d: number; t: number } => {
  const vx = b.x - a.x
  const vy = b.y - a.y
  const l2 = vx * vx + vy * vy
  const t = l2 < 1e-9 ? 0 : Math.max(0, Math.min(1, ((q.x - a.x) * vx + (q.y - a.y) * vy) / l2))
  return { d: Math.hypot(a.x + t * vx - q.x, a.y + t * vy - q.y), t }
}

export const defendersInLane = (from: Vec2, to: Vec2, opponents: ReadonlyArray<PlayerState>, width = 2): number => {
  let n = 0
  for (const o of opponents) {
    if (o.sentOff) continue
    const { d, t } = segmentDistance(from, to, o.pos)
    if (d < width && t > 0.05 && t < 0.95) n++
  }
  return n
}

export const xpassOf = (p: Params, distance: number, lane: number, pressure: number, height: PassHeight): number => {
  const c = p.pass.xpass
  return sigmoid(c.b0 + c.bDist * distance + c.bLane * lane + c.bPressure * pressure + c.bHigh * (height === "ground" ? 0 : 1))
}

export const xgOf = (p: Params, side: Side, period: Period, pos: Vec2, header: boolean, defendersInCone: number): number => {
  const c = p.shot.xg
  const d = dist(pos, goalOf(side, period))
  return sigmoid(c.b0 + c.bDist * d + c.bAngle * goalAngle(side, period, pos) + (header ? c.bHeader : 0) + c.bDefenders * defendersInCone)
}

export const nearestOpponent = (pos: Vec2, opponents: ReadonlyArray<PlayerState>): PlayerState | null => {
  let best: PlayerState | null = null
  let bd = Infinity
  for (const o of opponents) {
    if (o.sentOff) continue
    const d = dist(pos, o.pos)
    if (d < bd) {
      bd = d
      best = o
    }
  }
  return best
}

// ================================================================ P3 candidate plumbing (plan 8c Task 1; shared, no task edits it)

/** What every option builder needs: the decision input, the passer's frame and the pitch-control snapshot. */
export interface CandidateContext {
  readonly input: DecisionInput
  readonly p: Params
  /** 0..1 from the passer's nearest opponent (1 within 1 m, 0 beyond 5 m). */
  readonly pressure: number
  readonly side: Side
  readonly period: Period
  /** +1 when the passer's side attacks +x this period. */
  readonly dir: number
  /** Attack-normalised x of the opponents' last outfield defender. */
  readonly lastDef: number
  readonly ownerThreat: number
  readonly pc: { readonly att: PcPlayer[]; readonly def: PcPlayer[] } | null
}

export interface PushOptions {
  /** Where the choice features are measured (P3 D1); default the target. */
  readonly featureAt?: Vec2
  /** Added to the option's value (P3 D3: attackers expected at a cross zone). */
  readonly bonus?: number
  /** A keeper's throw or punt from his hands (P3 G5). */
  readonly method?: "throw" | "punt"
}

export const candidateContext = (input: DecisionInput, p: Params, pressure: number): CandidateContext => {
  const side = input.owner.side
  const period = input.period
  const toPc = (pl: PlayerState): PcPlayer => ({ x: pl.pos.x, y: pl.pos.y, vx: pl.vel.x, vy: pl.vel.y, gk: pl.role === "GK" })
  return {
    input,
    p,
    pressure,
    side,
    period,
    dir: dirOf(side, period),
    lastDef: lastDefenderAttackX(side, period, input.opponents),
    ownerThreat: threat(side, period, input.owner.pos),
    // With a pitch-control weight, a passer blends the lane-based xPass with who would win a ball played there.
    pc: p.pass.pitchControlWeight > 0 ? { att: input.teammates.filter((t) => t.id !== input.owner.id && !t.sentOff).map(toPc), def: input.opponents.filter((o) => !o.sentOff).map(toPc) } : null
  }
}

/** Classify, price and record one option: the one path every option builder uses. */
export const pushCandidate = (ctx: CandidateContext, out: Candidate[], receiver: PlayerState, target: Vec2, height: PassHeight, o: PushOptions = {}): void => {
  const { input, p, side, period } = ctx
  const owner = input.owner
  const kind = classifyPass({ side, period, from: owner.pos, to: target, height, lastDefenderAttackX: ctx.lastDef }, p.classifier)
  if (kind === "set_piece") return
  const distance = dist(owner.pos, target)
  const lane = defendersInLane(owner.pos, target, input.opponents)
  const lanes = xpassOf(p, distance, lane, ctx.pressure, height)
  const w = p.pass.pitchControlWeight
  const xp = ctx.pc ? (1 - w) * lanes + w * pitchControlAt(target, ctx.pc.att, ctx.pc.def, owner.pos).att : lanes
  const value = choiceValue(ctx, receiver, target, o.featureAt ?? target, lane, xp) + (o.bonus ?? 0)
  out.push({ action: KIND_TO_ACTION[kind], kind, receiverId: receiver.id, target, height, xpass: xp, value, lane, ...(o.method ? { method: o.method } : {}) })
}

export const buildCandidatesIn = (ctx: CandidateContext): Candidate[] => {
  const { owner, teammates } = ctx.input
  const out: Candidate[] = []
  for (const tm of teammates) {
    if (tm.id === owner.id || tm.sentOff) continue
    const lead = { x: tm.pos.x + tm.vel.x * 0.5, y: tm.pos.y + tm.vel.y * 0.5 }
    const distance = dist(owner.pos, lead)
    if (distance < 4 || distance > 65) continue
    const inBox = attackX(ctx.side, lead.x, ctx.period) > PITCH.halfL - PITCH.boxDepth && Math.abs(lead.y) < PITCH.boxHalfWidth
    const wideOwner = Math.abs(owner.pos.y) > PITCH.boxHalfWidth
    const height: PassHeight = wideOwner && inBox ? "high" : distance < 30 ? "ground" : "high"
    // Nobody lofts the ball back at their own keeper: a high ball dropping in front of the goal ends in the net
    // when it is overhit or the keeper miscontrols it. Back passes to the keeper go along the ground, from close.
    if (tm.role === "GK" && height === "high") continue
    pushCandidate(ctx, out, tm, lead, height, { featureAt: tm.pos })
    for (const t of throughTargets(ctx, tm)) pushCandidate(ctx, out, tm, t.target, t.height)
  }
  for (const c of crossTargets(ctx)) pushCandidate(ctx, out, c.receiver, c.target, c.height, { bonus: c.bonus })
  return out
}

export const buildCandidates = (input: DecisionInput, p: Params, pressure: number): Candidate[] => buildCandidatesIn(candidateContext(input, p, pressure))

export const softmaxPick = (logits: ReadonlyArray<number>, rng: Rng): number => {
  const m = Math.max(...logits)
  return rng.weighted(logits.map((l) => (Number.isFinite(l) ? Math.exp(l - m) : 0)))
}

// ================================================================ P3 choice seam (plan 8c Task 9 owns this block)

/** An option's value: the old expected-threat value until Task 9. `featureAt` is where D1 measures the choice features. */
const choiceValue = (ctx: CandidateContext, _receiver: PlayerState, target: Vec2, _featureAt: Vec2, _lane: number, xp: number): number =>
  xp * (0.3 + threat(ctx.side, ctx.period, target)) - (1 - xp) * 0.3 * (1 - ctx.ownerThreat)

/** Extra logit for pass kind `a` from its options: the old safety lean (0 while pass.safetyWeight is 0). */
const kindTerm = (ctx: CandidateContext, candidates: ReadonlyArray<Candidate>, a: Action, _base: Readonly<Record<Action, number>>): number => {
  const sw = ctx.p.pass.safetyWeight
  if (sw <= 0) return 0
  let best = -Infinity
  for (const c of candidates) if (c.action === a && c.xpass > best) best = c.xpass
  return Number.isFinite(best) ? sw * (best - SAFETY_PIVOT) : 0
}

/** Index of the chosen option among `options` (all of the chosen kind). */
const receiverPick = (ctx: CandidateContext, options: ReadonlyArray<Candidate>, rng: Rng): number => {
  const temp = ctx.p.pass.choiceTemperature * (1.4 - ctx.input.owner.attrs.vision)
  return softmaxPick(options.map((c) => c.value / Math.max(0.05, temp)), rng)
}

/** The decision record's quality of the chosen option against the best one, 0..1. */
const optionQuality = (_ctx: CandidateContext, chosen: Candidate, best: number): number => (best > 0 ? Math.max(0, Math.min(1, chosen.value / best)) : 1)

// ================================================================ end of P3 choice seam

// ================================================================ P3 cross seam (plan 8c Task 5 owns this block)

export interface CrossOption { readonly receiver: PlayerState; readonly target: Vec2; readonly height: PassHeight; readonly bonus: number }

/** Crosses aimed at zones rather than teammates (D3). None until Task 5. */
const crossTargets = (_ctx: CandidateContext): CrossOption[] => []

// ================================================================ end of P3 cross seam

// ================================================================ P3 through-ball seam (plan 8c Task 6 owns this block)

export interface ThroughOption { readonly target: Vec2; readonly height: PassHeight }

/** Through-ball targets for teammate `tm`: the old rule, an 8 m lead for anyone near the last defender or on a run. */
const throughTargets = (ctx: CandidateContext, tm: PlayerState): ThroughOption[] => {
  const ahead = attackX(ctx.side, tm.pos.x, ctx.period) > ctx.lastDef - 4 || tm.intent.kind === "run_in_behind"
  if (!ahead || tm.role === "GK") return []
  const target = { x: tm.pos.x + ctx.dir * ctx.p.pass.throughLeadM, y: tm.pos.y }
  return Math.abs(target.x) < PITCH.halfL - 2 ? [{ target, height: dist(ctx.input.owner.pos, target) < 30 ? "ground" : "high" }] : []
}

// ================================================================ end of P3 through-ball seam

// ================================================================ P3 keeper-hands seam (plan 8c Task 7 owns this block)

/** A keeper's throw or punt from his hands (G5); null keeps the normal decision. Nothing until Task 7. */
const keeperHandsDecision = (_ctx: CandidateContext, _rng: Rng): Decision | null => null

// ================================================================ end of P3 keeper-hands seam

const NON_PASS: ReadonlyArray<Action> = ["shot", "carry", "hold", "take_on", "clear"]

const RESTART_ACTIONS: Readonly<Record<RestartKind, ReadonlyArray<Action>>> = {
  kickoff: ["short_pass", "back_pass"],
  throw_in: ["short_pass", "back_pass", "through_ball"],
  corner: ["cross", "short_pass"],
  goal_kick: ["short_pass", "long_pass", "switch"],
  free_kick: ["short_pass", "long_pass", "cross", "switch", "back_pass", "shot"],
  penalty: ["shot"]
}

/** Choose an action (and a pass option) for the player on the ball. */
export const decide = (input: DecisionInput, p: Params, rng: Rng): Decision => {
  const { owner, style } = input
  const side = owner.side
  const { period } = input
  const opp = nearestOpponent(owner.pos, input.opponents)
  const oppDist = opp ? dist(owner.pos, opp.pos) : 50
  const pressure = Math.max(0, Math.min(1, 1 - (oppDist - 1) / 4))
  const ctx = candidateContext(input, p, pressure)
  const hands = keeperHandsDecision(ctx, rng)
  if (hands) return hands
  const zone = actionZone(side, period, owner.pos)
  const candidates = buildCandidatesIn(ctx)
  const goalDist = dist(owner.pos, goalOf(side, period))
  const cone = input.opponents.filter((o) => {
    const g = goalOf(side, period)
    const { d, t } = segmentDistance(owner.pos, g, o.pos)
    return d < 1.5 && t > 0 && t < 1 && o.role !== "GK"
  }).length
  const xg = goalDist <= p.shot.maxDistanceM ? xgOf(p, side, period, owner.pos, false, cone) : 0
  const ax = attackX(side, owner.pos.x, period)
  const allowed = input.restart ? new Set(RESTART_ACTIONS[input.restart]) : null

  const available = (a: Action): boolean => {
    if (allowed && !allowed.has(a)) return false
    switch (a) {
      case "shot":
        return input.restart === "penalty" || (goalDist <= p.shot.maxDistanceM && ax > 15)
      case "carry":
      case "hold":
        return input.restart === null
      case "take_on":
        // Keepers do not try to dribble past attackers.
        return input.restart === null && opp !== null && oppDist < 4 && owner.role !== "GK"
      case "clear":
        return input.restart === null && ax < -10
      default:
        return candidates.some((c) => c.action === a)
    }
  }

  const base = p.actions.logits[zone]
  const sw = p.actions.styleWeight
  const pw = p.actions.pressureWeight
  const lateTrailing = input.minute > 75 && input.scoreDiff < 0
  const lateLeading = input.minute > 75 && input.scoreDiff > 0
  const logits = ACTIONS.map((a) => {
    if (!available(a)) return -Infinity
    let l = base[a]
    if (a === "long_pass" || a === "lofted_through" || a === "switch") l += sw * 0.8 * style.longBallBias
    if (a === "short_pass") l -= sw * 0.3 * style.longBallBias
    if (a === "cross") l += sw * 0.8 * style.crossBias
    if (a === "through_ball") l += sw * (style.riskTolerance - 0.5)
    if (a === "hold") l += sw * (0.4 * (1 - style.tempo) - 0.2)
    if (a === "clear") l += pw * 1.5 * pressure
    if (a === "long_pass") l += pw * 0.6 * pressure
    if (a === "hold") l -= pw * 1.0 * pressure + p.actions.holdDecayPerS * (input.onBallS ?? 0)
    if (a === "carry") l -= pw * 0.6 * pressure
    if (a === "take_on") l += pw * 0.3 * pressure
    if (a === "short_pass") l -= pw * 0.2 * pressure
    if (a === "shot") l += 3 * (xg - 0.1) + 0.3 * style.riskTolerance
    if (lateTrailing && (a === "shot" || a === "cross" || a === "long_pass")) l += 0.4
    if (lateLeading && (a === "hold" || a === "back_pass")) l += 0.4
    l += input.scriptBias[a] ?? 0
    // Passers weigh each kind of pass by its options (old engine: the lean towards kinds that have a safe option now).
    if (!NON_PASS.includes(a)) l += kindTerm(ctx, candidates, a, base)
    return l
  })
  const finite = logits.filter((l) => Number.isFinite(l))
  const lmax = finite.length ? Math.max(...finite) : 0
  const z = logits.reduce((s, l) => s + (Number.isFinite(l) ? Math.exp(l - lmax) : 0), 0)
  const actionProbs: Record<string, number> = {}
  ACTIONS.forEach((a, i) => {
    if (Number.isFinite(logits[i]!)) actionProbs[a] = r3(Math.exp(logits[i]! - lmax) / z)
  })
  const options = [...candidates].sort((a, b) => b.value - a.value).slice(0, OPTIONS_RECORDED).map(toOption)
  const record = { actionProbs, options, chosenRank: null as number | null, fallback: false }

  let idx = softmaxPick(logits, rng)
  if (idx < 0) idx = ACTIONS.indexOf(allowed ? [...allowed][0]! : "hold")
  const action = ACTIONS[idx]!

  let passOptions = candidates.filter((c) => c.action === action)
  if (NON_PASS.includes(action)) return { action, candidate: null, decisionQuality: null, xg: action === "shot" ? xg : null, pressure, ...record }
  let fallback = false
  if (passOptions.length === 0) {
    // Forced restart with no option of the allowed kinds: play the best available pass, or clear it.
    if (candidates.length === 0) return { action: "clear", candidate: null, decisionQuality: null, xg: null, pressure, ...record, fallback: true }
    const bestAny = candidates.reduce((a, b) => (b.value > a.value ? b : a))
    passOptions = [bestAny]
    fallback = true
  }
  const pick = receiverPick(ctx, passOptions, rng)
  const chosen = passOptions[Math.max(0, pick)]!
  const best = Math.max(...candidates.map((c) => c.value))
  const quality = optionQuality(ctx, chosen, best)
  const chosenRank = 1 + candidates.filter((c) => c.value > chosen.value).length
  // The chosen option is always recorded, even when it ranks below the top OPTIONS_RECORDED.
  const chosenOption = toOption(chosen)
  const same = (o: OptionRecord) => o.receiver_id === chosenOption.receiver_id && o.target_x === chosenOption.target_x && o.target_y === chosenOption.target_y
  const recorded = options.some(same) ? options : [...options, chosenOption]
  return { action: chosen.action, candidate: chosen, decisionQuality: quality, xg: null, pressure, ...record, options: recorded, chosenRank, fallback }
}

/**
 * A decision whose pass is replaced by a what-if override: the best-valued pass to `receiverId` (of `kind` if
 * given). The record keeps the probabilities and options the player weighed, with the forced pass ranked among
 * them. Returned unchanged when no such pass is available (the receiver too close, too far or sent off).
 */
export const overridePass = (d: Decision, input: DecisionInput, o: { readonly receiverId: string; readonly kind?: string }, p: Params): Decision => {
  const ctx = candidateContext(input, p, d.pressure)
  const candidates = buildCandidatesIn(ctx)
  const matching = candidates.filter((c) => c.receiverId === o.receiverId && (o.kind === undefined || c.kind === o.kind))
  if (matching.length === 0) return d
  const chosen = matching.reduce((a, b) => (b.value > a.value ? b : a))
  const best = Math.max(...candidates.map((c) => c.value))
  const option = toOption(chosen)
  const same = (r: OptionRecord) => r.receiver_id === option.receiver_id && r.target_x === option.target_x && r.target_y === option.target_y
  return {
    ...d,
    action: chosen.action,
    candidate: chosen,
    decisionQuality: optionQuality(ctx, chosen, best),
    xg: null,
    chosenRank: 1 + candidates.filter((c) => c.value > chosen.value).length,
    options: d.options.some(same) ? d.options : [...d.options, option],
    fallback: false,
    forced: true
  }
}
```

Why this is identical: the context computes the same `pc`, `lastDef` and `ownerThreat` as before (no RNG); `pushCandidate` computes the same `xp` and old value (adding a bonus of 0 is exact); the through targets come out in the same order and with the same height rule; the cross list is empty; `kindTerm` returns exactly what the old safety block added (0 when `safetyWeight` is 0); `receiverPick` and `optionQuality` are the old expressions.

- [ ] **Step 6: Create the `step.ts` seams**

**Import markers.** At the end of the import block (after the P2 positioning-seam imports), add exactly:

```ts
// ---- P3 imports, boot-block seam (plan 8c Task 3 inserts below this line)

// ---- P3 imports, release seam (plan 8c Task 4 inserts below this line)

// ---- P3 imports, keeper-distribution seam (plan 8c Task 7 inserts below this line)

```

**Seam blocks.** Insert directly above `const releaseKick = (`, after `technique`:

```ts
// ================================================================ P3 boot-block seam (plan 8c Task 3 owns this block)

/** A defender at the passer's boot blocks this open-play pass (X1): who, and where the ball goes. null until Task 3. */
const bootBlock = (_w: Work, _owner: PlayerState, _d: Decision, _target: Vec2): { blocker: PlayerState; loose: BallState } | null => null

// ================================================================ end of P3 boot-block seam

// ================================================================ P3 release seam (plan 8c Task 4 owns this block)

/** Ticks a player takes before his first decision after winning or receiving the ball: the flat draw until Task 4. */
const releaseDelayTicks = (w: Work, _pl: PlayerState): number => w.decisionDelayTicks()

// ================================================================ end of P3 release seam

// ================================================================ P3 keeper-distribution seam (plan 8c Task 7 owns this block)

/** keeper_distribution's method attribute: the old label (any short pass is a "throw") until Task 7. */
const keeperMethod = (_w: Work, d: Decision): string => (d.action === "short_pass" ? "throw" : "kick")

/** How a pass is struck: the technique and body-part attributes and the execution-error multiplier. */
const kickStyle = (_w: Work, _d: Decision, restart: RestartKind | null): { technique: "throw" | "foot"; hands: boolean; errorScale: number } =>
  restart === "throw_in" ? { technique: "throw", hands: true, errorScale: 1 } : { technique: "foot", hands: false, errorScale: 1 }

// ================================================================ end of P3 keeper-distribution seam
```

**Call sites.**

- `changePossession`: `intentUntil: w.tick + releaseDelayTicks(w, w.player(to.id))`.
- `resolveFlightNow`, the winner branch at the end: `intentUntil: w.tick + releaseDelayTicks(w, winner)`.
- `releaseKick`, before `executeKick`: `const style = kickStyle(w, d, restart)`; inside the `executeKick` intent add `errorScale: style.errorScale` after `forceMishit`.
- `releaseKick`, the two blocker lines become:
  ```ts
  const crossBlock = d.candidate?.kind === "cross" && restart === null ? crossBlocker(owner, opps, p) : null
  // A defender at the boot may block any other open-play pass (X1); always null while firstTick.rule is 0.
  const boot = crossBlock === null && !isClear && restart === null ? bootBlock(w, owner, d, target) : null
  const blocker = crossBlock ?? boot?.blocker ?? null
  const blocked = boot !== null || (crossBlock !== null && w.rng.duel.chance(p.defending.crossBlock))
  ```
- `releaseKick`, the attrs: `technique: style.technique,` and `body_part: style.hands ? "hands" : footPart(owner, weakFoot),`.
- `releaseKick`, the `if (blocked)` branch becomes:
  ```ts
  if (blocked) {
    outcome = "blocked"
    extra.push(at(w.pending("block", blocker, blocker!.pos, { blocked: boot ? "pass" : "cross" })))
    if (boot) looseAfter = boot.loose
    else if (w.rng.duel.chance(p.defending.crossBlockBehind)) deflectTo = behindPoint(defSide, w.period, blocker!.pos, w.rng.duel)
    else looseAfter = deflectLoose(defSide, w.period, blocker!.pos, w.rng.duel, [3, 8], [0.5, 3])
  }
  ```
- `ownerDecision`: directly before the line that reassigns `w.possession` (the "hold is over" comment), add `const keeperHands = poss.inHands === true`; add `keeperHands` as the last field of `input`.
- `ownerDecision`, the default branch: `w.emit(w.pending("keeper_distribution", owner, owner.pos, { method: keeperMethod(w, decision) }))`.

With `boot` null the blocker is the cross blocker and the duel draw happens exactly when it did; the style is the old technique and body part with an error multiplier of 1; the delay is the old draw. The engine stays bit-identical.

- [ ] **Step 7: Run the tests and the drift check**

Run: `pnpm --filter @touchline/sim-core exec tsc --noEmit -p . && pnpm --filter @touchline/sim-core exec vitest run --no-file-parallelism`
Expected: PASS, including the new params tests.

Run: `pnpm typecheck` (the whole monorepo: `whatif.ts` and the agent packages build `DecisionInput`).
Expected: PASS.

Run: `pnpm --filter @touchline/calibrate exec vitest run test/realism-gate.test.ts --disableConsoleIntercept`
Expected: PASS with every drift exactly 0. **If anything drifted,** a call site changed a number or an RNG draw; compare it with the line it replaced.

- [ ] **Step 8: Commit**

```bash
git add packages/sim-core
git commit -m "feat(sim-core): P3 scaffold — first-tick, choice, release, cross, through-ball and distribution params (all off), boot and release RNG streams, decide.ts candidate path and seams, step.ts seams, kick errorScale

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Passing diagnostic — report section, real targets, `--set` / `--only`, P2 baseline (wave 0)

**Files:**
- Create: `python/analytics/touchline_analytics/passing.py`, `python/analytics/tests/test_passing.py`, `packages/calibrate/src/overrides.ts`, `packages/calibrate/test/overrides.test.ts`, `docs/realism/p3-passing-baseline.md`
- Modify: `python/analytics/touchline_analytics/report.py` (`build` and `__main__`), `python/analytics/touchline_analytics/targets.py` (`HAND_BLOCKS`), `data/params/targets-idsse.json` (new `passing` block), `packages/calibrate/src/realism.ts`

**Interfaces:**
- Consumes: nothing from Task 1 (it runs on the P2 engine).
- Produces:
  - `pnpm realism --matches <n> --only passing --set <k=v,...> --runs <dir> --out <file>`: simulates seeds 2000.. with the parameter file plus overrides, and writes only the passing section. Later tasks run it for before/after numbers.
  - The full realism report (`pnpm realism`, `pnpm realism:deep`) gains a "Passing (realism v2, P3)" section.
  - `targets-idsse.json` `passing.rows[key]` = `{ label, real, lo, hi, fmt }` and `passing.choice` = `{ features, b, se }`.
  - Python: `match_passing(run_dir, roles) -> dict`, `summarize(ms) -> dict`, `passing_section(ms, t) -> list[str]`, `passing_report(run_dirs, targets, note, roles) -> str`, `options(pos, period, passer, roles) -> list[dict]`, `clogit(groups) -> (b, se, n)`.
  - TS: `parseSets(spec): Array<readonly [string, number | string]>`, `applySets(json, sets): Record<string, unknown>`.
  - `docs/realism/p3-passing-baseline.md`: the P2 engine's numbers on seeds 2000–2015.

**Definitions** (module docstring of `passing.py`; one code path for every measure):

| Key | Definition | Real | MET band |
|---|---|---|---|
| `passes_per_match` | all passes | 866 | 776–956 |
| `first_tick_share` | open-play passes intercepted on the first tick less than 1 m from the passer | 0 | 0–0.01 |
| `near1_completion` | open-play passes released with an opponent within 1 m | 0.70 | 0.64–0.76 |
| `avail_10_20_completion` | intended receiver 10–20 m away and available (clear 2 m lane, no opponent within 3 m), passer's nearest opponent ≥ 2 m | 0.936 | 0.90–0.97 |
| `avail_30p_completion` | as above, 30 m or more | 0.805 | 0.74–0.85 |
| `long_share` | completed passes of 32 m or more | 0.143 | 0.12–0.17 |
| `switch_share` | open-play passes with \|y_end − y\| > 25 m | 0.061 | 0.04–0.08 |
| `tight_share` | completed open-play passes whose receiver had an opponent within 3 m | 0.09 | 0.06–0.12 |
| `back_gk_share` | passes whose intended receiver is the passer's own keeper, of all passes | 0.062 | 0.045–0.08 |
| `most_fwd_share` | completed open-play passes to an available receiver with ≥ 2 available: receiver = the most forward available | 0.20 | 0.15–0.25 |
| `crosses_per_match` | open-play crosses more than 10 s after the last set piece | 14.9 | 12–18 |
| `cross_contact_m` | median metres from the attacked goal line to the cross's end point | 10.0 | 8–12 |
| `through_per_match` | open-play through and lofted through balls | — | — |
| `through_shot_share` | open-play shots whose team's last completed pass within 6 s was a through ball | 0.025 | 0–0.05 |
| `keeper_passes_per_team` | passes by keepers per team-match | 45.4 | 35–55 |
| `keeper_open_completion` | open-play keeper passes completed | 0.779 | 0.72–0.84 |
| `punts_per_team` | `keeper_distribution` method punt per team-match | 1.6 | 1.0–2.2 |
| `throws_per_team` | method throw per team-match | 3.4 | 2.4–4.4 |
| `release_median_lt2_s` | median reception → same player's next open-play pass, received with an opponent within 2 m | 0.4 | 0.2–0.7 |
| `release_under1_lt2` | share of those under 1 s | 0.63 | 0.50–0.75 |
| `release_median_s` | median, all receptions | 1.4 | 1.2–1.6 |
| `release_over3` | share over 3 s, all receptions | 0.16 | 0.12–0.20 |
| `ball_own_third` | live frames with a team in possession: share with the ball in its own third | 0.35 | 0.30–0.40 |
| `ball_u_mean` | mean ball u in the possessing team's frame | −5.2 | −8 to −2 |

Sources: `carrier-report.md` C3, C5, C6, C9, C10; `gk-report.md` §1–2; `finalthird.json` `A2_crosses`, `A3_shots.setup`; P2 `task-8b-report.md` (ball thirds); `targets-idsse.json` metrics (passes, long share). The bands are planning rulings (ruling 17).

- [ ] **Step 1: Write the failing Python tests** (`python/analytics/tests/test_passing.py`)

```python
import json
import math

import numpy as np

from touchline_analytics.passing import clogit, match_passing, options, passing_section, summarize

ROLES = {"h1": "CB", "h2": "GK", "h3": "ST", "h4": "CM", "a1": "CB", "a2": "GK"}


def test_options_lane_openness_and_no_line_with_few_opponents():
    pos = {"p": (0, 0, "home"), "t1": (10, 0, "home"), "t2": (0, 20, "home"), "o1": (5, 0.5, "away"), "o2": (0, 23, "away")}
    o = {x["id"]: x for x in options(pos, "first_half", "p", {k: "CM" for k in pos})}
    assert o["t1"]["lane"] == 1 and math.isclose(o["t1"]["open"], math.hypot(5, 0.5)) and o["t1"]["du"] == 10
    assert o["t2"]["lane"] == 0 and math.isclose(o["t2"]["open"], 3.0) and o["t2"]["dv"] == 20
    assert o["t1"]["lb"] == 0 and o["t2"]["lb"] == 0
    # Second half: home attacks -x, so a teammate at x = -10 is 10 m forward.
    o2 = {x["id"]: x for x in options({**pos, "t1": (-10, 0, "home")}, "second_half", "p", {k: "CM" for k in pos})}
    assert o2["t1"]["du"] == 10


def test_clogit_recovers_known_coefficients():
    rng = np.random.default_rng(3)
    b = np.array([-1.3, 0.5, 0.2, -0.5, 1.2, 0.1, 0.9])
    groups = []
    for _ in range(4000):
        x = np.column_stack([rng.uniform(0.4, 6.5, 8), rng.normal(0, 1.5, 8), rng.uniform(0, 4, 8), rng.integers(0, 2, 8), rng.uniform(0, 2, 8), rng.integers(0, 2, 8), (np.arange(8) == 0).astype(float)])
        u = x @ b
        p = np.exp(u - u.max())
        groups.append((x, int(rng.choice(8, p=p / p.sum()))))
    fit, se, n = clogit(groups)
    assert n == 4000
    assert np.all(np.abs(fit - b) < 4 * se)


def _run(tmp_path):
    d = tmp_path / "m"
    d.mkdir()
    (d / "meta.json").write_text(json.dumps({"teams": {"home": {"id": "H"}, "away": {"id": "A"}}, "meta": {"tracking": {"fps": 10}}}))
    home = [("h1", -30, 0), ("h2", -48, 0), ("h3", 20, 25), ("h4", -20, 30)]
    away = [("a1", -29.5, 0), ("a2", 50, 0)]
    frames = [json.dumps({"frame_id": i, "period": "first_half",
                          "teams": {"home": {"id": "H", "players": [{"id": p, "x": x, "y": y, "vel": 0} for p, x, y in home]},
                                    "away": {"id": "A", "players": [{"id": p, "x": x, "y": y, "vel": 0} for p, x, y in away]}},
                          "ball": {"x": -30, "y": 0, "z": 0, "status": True, "poss_team_id": "H"}}) for i in range(300)]
    (d / "tracking.jsonl").write_text("\n".join(frames) + "\n")

    def ev(t, f, pid, team="H", **kw):
        e = {"type": t, "frame_id": f, "period_frame_id": f, "period": "first_half", "team_id": team, "player_id": pid,
             "x": kw.pop("x", None), "y": kw.pop("y", None), "x_end": kw.pop("x_end", None), "y_end": kw.pop("y_end", None),
             "frame_id_end": kw.pop("frame_id_end", None), "outcome": kw.pop("outcome", None), "attrs": kw}
        return json.dumps(e)

    events = [
        ev("set_piece", 0, "h1", kind="kickoff"),
        # Intercepted on the first tick, 0.4 m from the passer, with an opponent within 1 m.
        ev("pass", 10, "h1", x=-30, y=0, x_end=-29.6, y_end=0, frame_id_end=11, outcome="intercepted", restart=None, kind="short", intended_receiver_id="h3"),
        # A switch (|dy| 30).
        ev("pass", 20, "h1", x=-30, y=0, x_end=-20, y_end=30, frame_id_end=30, outcome="successful", restart=None, kind="switch", intended_receiver_id="h4", receiver_id="h4"),
        # Back to the keeper.
        ev("pass", 30, "h1", x=-30, y=0, x_end=-48, y_end=0, frame_id_end=35, outcome="successful", restart=None, kind="back", intended_receiver_id="h2", receiver_id="h2"),
        ev("reception", 40, "h4", first_touch="controlled"),
        ev("pass", 45, "h4", x=-20, y=30, x_end=-30, y_end=10, frame_id_end=50, outcome="successful", restart=None, kind="short", intended_receiver_id="h1", receiver_id="h1"),
        # A cross 20 s after the kickoff, ending 7.5 m from the goal line.
        ev("pass", 200, "h3", x=20, y=25, x_end=45, y_end=2, frame_id_end=210, outcome="intercepted", restart=None, kind="cross", intended_receiver_id="h1"),
        ev("keeper_distribution", 250, "h2", method="punt"),
    ]
    (d / "domain.jsonl").write_text("\n".join(events) + "\n")
    return d


def test_match_passing_counts_each_measure(tmp_path):
    s = summarize([match_passing(_run(tmp_path), ROLES)])
    assert math.isclose(s["first_tick_share"], 1 / 5)
    assert math.isclose(s["switch_share"], 1 / 5)
    assert math.isclose(s["back_gk_share"], 1 / 5)
    # h1 passes three times with a1 0.5 m away: intercepted, then two completions.
    assert math.isclose(s["near1_completion"], 2 / 3)
    assert s["crosses_per_match"] == 1 and math.isclose(s["cross_contact_m"], 7.5)
    assert s["punts_per_team"] == 0.5 and s["keeper_passes_per_team"] == 0
    assert math.isclose(s["release_median_s"], 0.5)
    assert s["ball_own_third"] == 1.0 and math.isclose(s["ball_u_mean"], -30)


def test_passing_section_marks_met_and_not_met(tmp_path):
    t = {"rows": {"switch_share": {"label": "Switches", "real": 0.061, "lo": 0.04, "hi": 0.08, "fmt": "{:.3f}"},
                  "back_gk_share": {"label": "Back to the keeper", "real": 0.062, "lo": 0.045, "hi": 0.3, "fmt": "{:.3f}"}},
         "choice": {"features": ["a"], "b": [0.0], "se": [1.0]}}
    md = "\n".join(passing_section([match_passing(_run(tmp_path), ROLES)], t))
    assert "| Switches | 0.061 | 0.200 | 0.040–0.080 | NOT MET |" in md
    assert "| Back to the keeper | 0.062 | 0.200 | 0.045–0.300 | MET |" in md
```

Run: `uv run --project python/analytics pytest python/analytics/tests/test_passing.py -q`
Expected: FAIL with `ModuleNotFoundError: touchline_analytics.passing`.

- [ ] **Step 2: Write `passing.py`**

```python
"""Passing diagnostics against real aggregates (realism v2, P3).

Definitions follow the 2026-10-13 analysis (carrier-report.md, gk-report.md, finalthird-report.md) and P2's Task 8b report
(ball thirds); only aggregates are committed. Positions are read at a pass's own tick: the tracking frame with the same
period and period frame id. Open play = the pass has no restart. Keys and real values: targets-idsse.json "passing".

- first-tick share: open-play passes intercepted one tick after release less than 1 m from the passer.
- near-1 completion: open-play passes released with an opponent within 1 m of the passer.
- available-receiver completion: intended receiver 4-65 m away with no opponent within 2 m of the passer->receiver segment
  (0.05 < t < 0.95) and none within 3 m of him; the passer's nearest opponent 2 m or more; by length 10-20 m and 30 m+.
- choice model: conditional logit over the passer's teammates 4-65 m away (current positions), the intended receiver chosen;
  features as carrier-report C3: dist/10, forward du/10, |dv|/10, lane blocked, min(open, 10)/5, line-breaking, keeper.
- switch: |y_end - y| > 25 m. tight: completed, receiver's nearest opponent under 3 m. long: completed, 32 m or more.
- back to the keeper: passes (all) whose intended receiver is the passer's own keeper, over all passes.
- most forward: completed passes to an available receiver with >= 2 available: he is the most forward available.
- crosses: open-play passes of kind cross more than 10 s after the last set piece; contact depth = metres from the attacked
  goal line to the pass end.
- through-ball shots: open-play shots whose team's last completed pass within 6 s was a through or lofted through ball.
- keeper: passes by keepers per team-match; open-play keeper completion; keeper_distribution methods per team-match.
- release timing: a controlled reception, then the receiver's next open-play pass, with no possession change or other-team
  event between, same period, under 15 s; pressure = the receiver's nearest opponent at the reception.
- ball thirds: live frames with a team in possession, ball u in that team's attacking direction; thirds at +-17.5 m.
"""

from __future__ import annotations

import json
import math
from pathlib import Path

import numpy as np

LANE_W, OPEN_M, MIN_D, MAX_D, THIRD, LONG_M = 2.0, 3.0, 4.0, 65.0, 17.5, 32.0
FEAT = ["dist/10", "fwd du/10", "|dv|/10", "lane blocked", "open (min(d,10)/5)", "line-breaking", "GK"]


def _attack(side: str, period: str) -> int:
    """+1 if the side attacks +x in that period: home in the first half, away in the second."""
    return 1 if (side == "home") == (period == "first_half") else -1


def _lane(pu: float, py: float, tu: float, ty: float, ou: np.ndarray, oy: np.ndarray) -> int:
    vx, vy = tu - pu, ty - py
    l2 = max(vx * vx + vy * vy, 1e-9)
    t = np.clip(((ou - pu) * vx + (oy - py) * vy) / l2, 0.0, 1.0)
    d = np.hypot(pu + t * vx - ou, py + t * vy - oy)
    return int(((d < LANE_W) & (t > 0.05) & (t < 0.95)).sum())


def _mid_line(opp_outfield_u: np.ndarray) -> float:
    """Opponents' midfield line: mean u of their 5th-8th deepest outfielders (largest u = deepest); NaN with fewer than 8."""
    s = np.sort(opp_outfield_u)[::-1]
    return float(np.mean(s[4:8])) if len(s) >= 8 else math.nan


def options(pos: dict, period: str, passer: str, roles: dict[str, str]) -> list[dict]:
    """The passer's teammates as options in his team frame; pos = {player_id: (x, y, side)}."""
    side = pos[passer][2]
    a = _attack(side, period)
    pu, py = pos[passer][0] * a, pos[passer][1] * a
    opp = [(x * a, y * a, roles.get(pid) == "GK") for pid, (x, y, s) in pos.items() if s != side]
    ou = np.array([o[0] for o in opp], dtype=float)
    oy = np.array([o[1] for o in opp], dtype=float)
    ml = _mid_line(np.array([o[0] for o in opp if not o[2]], dtype=float))
    out = []
    for pid, (x, y, s) in pos.items():
        if s != side or pid == passer:
            continue
        tu, ty = x * a, y * a
        du, dv = tu - pu, ty - py
        out.append({
            "id": pid, "d": math.hypot(du, dv), "du": du, "dv": dv,
            "lane": _lane(pu, py, tu, ty, ou, oy) if len(opp) else 0,
            "open": float(np.hypot(ou - tu, oy - ty).min()) if len(opp) else 99.0,
            "lb": float(bool(np.isfinite(ml) and pu < ml and tu > ml)),
            "gk": float(roles.get(pid) == "GK"),
        })
    return out


def feats(o: dict) -> list[float]:
    return [o["d"] / 10, o["du"] / 10, abs(o["dv"]) / 10, float(o["lane"] > 0), min(o["open"], 10.0) / 5, o["lb"], o["gk"]]


def clogit(groups: list[tuple[np.ndarray, int]], iters: int = 60) -> tuple[np.ndarray, np.ndarray, int]:
    """Conditional logit over groups of (option features, index chosen): Newton's method with the analysis's 1e-3 ridge."""
    X = np.vstack([g[0] for g in groups])
    gi = np.concatenate([np.full(len(g[0]), i) for i, g in enumerate(groups)])
    y = np.zeros(len(X))
    off = 0
    for g, c in groups:
        y[off + c] = 1.0
        off += len(g)
    n = len(groups)
    b = np.zeros(X.shape[1])
    H = np.eye(len(b))
    for _ in range(iters):
        xb = X @ b
        e = np.exp(xb - xb.max())
        p = e / np.bincount(gi, weights=e, minlength=n)[gi]
        xbar = np.column_stack([np.bincount(gi, weights=p * X[:, j], minlength=n) for j in range(X.shape[1])])
        grad = (y[:, None] * X).sum(0) - xbar.sum(0) - 1e-3 * b
        dx = X - xbar[gi]
        H = (dx * p[:, None]).T @ dx + 1e-3 * np.eye(len(b))
        step = np.linalg.solve(H, grad)
        if np.abs(step).max() > 2:
            step *= 2 / np.abs(step).max()
        b += step
        if np.abs(step).max() < 1e-7:
            break
    return b, np.sqrt(np.diag(np.linalg.inv(H))), n


def _nearest(pos: dict, pid: str) -> float:
    x0, y0, s0 = pos[pid]
    return min((math.hypot(x - x0, y - y0) for q, (x, y, s) in pos.items() if s != s0), default=99.0)


def match_passing(run: Path, roles: dict[str, str]) -> dict:
    """Raw counts of one simulated match (summarize() pools them)."""
    meta = json.loads((run / "meta.json").read_text())
    fps = float(meta["meta"]["tracking"]["fps"])
    home = meta["teams"]["home"]["id"]
    side_of = lambda team: "home" if team == home else "away"  # noqa: E731
    events = [json.loads(line) for line in (run / "domain.jsonl").read_text().splitlines() if line.strip()]
    keys = {(e["period"], e["period_frame_id"]) for e in events if e["type"] in ("pass", "reception")}
    snaps: dict = {}
    thirds = [0, 0, 0]
    us: list[float] = []
    with (run / "tracking.jsonl").open() as fh:
        for line in fh:
            f = json.loads(line)
            b = f["ball"]
            pt = b.get("poss_team_id")
            if b.get("status") and pt is not None:
                u = b["x"] * _attack(side_of(pt), f["period"])
                us.append(u)
                thirds[0 if u < -THIRD else 2 if u > THIRD else 1] += 1
            k = (f["period"], f["frame_id"])
            if k in keys:
                snaps[k] = {p["id"]: (p["x"], p["y"], s) for s in ("home", "away") for p in f["teams"][s]["players"]}
    m = {"passes": 0, "open": 0, "first_tick": 0, "near1": [0, 0], "avail": {"10-20": [0, 0], "30+": [0, 0]}, "long": [0, 0],
         "groups": [], "switch": 0, "tight": [0, 0], "back_gk": 0, "most_fwd": [0, 0], "crosses": 0, "cross_depth": [],
         "through": 0, "shots": 0, "through_shots": 0, "gk_passes": 0, "gk_open": [0, 0], "methods": {}, "release": [],
         "thirds": thirds, "ball_u": us}
    last_sp = -1e18
    last_completed: dict = {}
    for e in events:
        t, a = e["type"], e["attrs"]
        if t == "set_piece":
            last_sp = e["frame_id"]
        elif t == "keeper_distribution":
            m["methods"][a.get("method")] = m["methods"].get(a.get("method"), 0) + 1
        elif t == "shot" and not a.get("restart") and a.get("technique") != "penalty":
            m["shots"] += 1
            lc = last_completed.get(e["team_id"])
            if lc and e["frame_id"] - lc[0] <= 6 * fps and lc[1] in ("through", "lofted_through"):
                m["through_shots"] += 1
        if t != "pass":
            continue
        passer, intended, ok = e["player_id"], a.get("intended_receiver_id"), e["outcome"] == "successful"
        side = side_of(e["team_id"])
        m["passes"] += 1
        m["gk_passes"] += roles.get(passer) == "GK"
        m["back_gk"] += bool(intended) and roles.get(intended) == "GK" and roles.get(passer) != "GK"
        if ok and e["x_end"] is not None:
            m["long"][0] += 1
            m["long"][1] += math.hypot(e["x_end"] - e["x"], e["y_end"] - e["y"]) >= LONG_M
            last_completed[e["team_id"]] = (e["frame_id"], a.get("kind"))
        if a.get("restart"):
            continue
        m["open"] += 1
        if roles.get(passer) == "GK":
            m["gk_open"][0] += 1
            m["gk_open"][1] += ok
        ends = e["x_end"] is not None
        if e["outcome"] == "intercepted" and e["frame_id_end"] is not None and e["frame_id_end"] - e["frame_id"] <= 1 and ends \
                and math.hypot(e["x_end"] - e["x"], e["y_end"] - e["y"]) < 1:
            m["first_tick"] += 1
        if ends and abs(e["y_end"] - e["y"]) > 25:
            m["switch"] += 1
        if a.get("kind") in ("through", "lofted_through"):
            m["through"] += 1
        if a.get("kind") == "cross" and e["frame_id"] - last_sp > 10 * fps:
            m["crosses"] += 1
            if ends:
                m["cross_depth"].append(52.5 - e["x_end"] * _attack(side, e["period"]))
        pos = snaps.get((e["period"], e["period_frame_id"]))
        if pos is None or passer not in pos:
            continue
        opts = options(pos, e["period"], passer, roles)
        near = _nearest(pos, passer)
        if near < 1:
            m["near1"][0] += 1
            m["near1"][1] += ok
        avail = [o for o in opts if o["lane"] == 0 and o["open"] >= OPEN_M and MIN_D <= o["d"] <= MAX_D]
        oi = next((o for o in opts if o["id"] == intended), None)
        if oi is not None and near >= 2 and oi in avail:
            cell = "10-20" if 10 <= oi["d"] < 20 else "30+" if oi["d"] >= 30 else None
            if cell:
                m["avail"][cell][0] += 1
                m["avail"][cell][1] += ok
        window = [o for o in opts if MIN_D <= o["d"] <= MAX_D]
        ci = next((j for j, o in enumerate(window) if o["id"] == intended), None)
        if ci is not None and len(window) >= 2:
            m["groups"].append((np.array([feats(o) for o in window]), ci))
        if ok:
            orc = next((o for o in opts if o["id"] == a.get("receiver_id")), None)
            if orc is not None:
                m["tight"][0] += 1
                m["tight"][1] += orc["open"] < OPEN_M
                if orc in avail and len(avail) >= 2:
                    m["most_fwd"][0] += 1
                    m["most_fwd"][1] += orc["du"] == max(o["du"] for o in avail)
    for i, e in enumerate(events):
        if e["type"] != "reception" or e["attrs"].get("first_touch") != "controlled":
            continue
        for g in events[i + 1:]:
            if g["period"] != e["period"] or g["frame_id"] - e["frame_id"] > 15 * fps or g["type"] == "possession_change":
                break
            if g["team_id"] is not None and g["team_id"] != e["team_id"]:
                break
            if g["type"] == "pass":
                pos = snaps.get((e["period"], e["period_frame_id"]))
                if g["player_id"] == e["player_id"] and not g["attrs"].get("restart") and pos and e["player_id"] in pos:
                    m["release"].append(((g["frame_id"] - e["frame_id"]) / fps, _nearest(pos, e["player_id"])))
                break
    return m


def _rate(pairs: list) -> float:
    t = sum(p[0] for p in pairs)
    return sum(p[1] for p in pairs) / t if t else math.nan


def summarize(ms: list[dict]) -> dict:
    n = len(ms)
    tot = lambda k: sum(x[k] for x in ms)  # noqa: E731
    rel = [r for x in ms for r in x["release"]]
    lt2 = [t for t, d in rel if d < 2]
    alls = [t for t, _ in rel]
    th = [sum(x["thirds"][i] for x in ms) for i in range(3)]
    us = [u for x in ms for u in x["ball_u"]]
    depths = [d for x in ms for d in x["cross_depth"]]
    methods: dict = {}
    for x in ms:
        for k, v in x["methods"].items():
            methods[k] = methods.get(k, 0) + v
    med = lambda v: float(np.median(v)) if v else math.nan  # noqa: E731
    share = lambda v, f: sum(1 for t in v if f(t)) / len(v) if v else math.nan  # noqa: E731
    return {
        "passes_per_match": tot("passes") / n,
        "first_tick_share": tot("first_tick") / max(1, tot("open")),
        "near1_completion": _rate([x["near1"] for x in ms]),
        "avail_10_20_completion": _rate([x["avail"]["10-20"] for x in ms]),
        "avail_30p_completion": _rate([x["avail"]["30+"] for x in ms]),
        "long_share": _rate([x["long"] for x in ms]),
        "switch_share": tot("switch") / max(1, tot("open")),
        "tight_share": _rate([x["tight"] for x in ms]),
        "back_gk_share": tot("back_gk") / max(1, tot("passes")),
        "most_fwd_share": _rate([x["most_fwd"] for x in ms]),
        "crosses_per_match": tot("crosses") / n,
        "cross_contact_m": med(depths),
        "through_per_match": tot("through") / n,
        "through_shot_share": tot("through_shots") / max(1, tot("shots")),
        "keeper_passes_per_team": tot("gk_passes") / (2 * n),
        "keeper_open_completion": _rate([x["gk_open"] for x in ms]),
        "punts_per_team": methods.get("punt", 0) / (2 * n),
        "throws_per_team": methods.get("throw", 0) / (2 * n),
        "release_median_lt2_s": med(lt2),
        "release_under1_lt2": share(lt2, lambda t: t < 1),
        "release_median_s": med(alls),
        "release_over3": share(alls, lambda t: t > 3),
        "ball_own_third": th[0] / sum(th) if sum(th) else math.nan,
        "ball_u_mean": float(np.mean(us)) if us else math.nan,
    }


def passing_section(ms: list[dict], t: dict) -> list[str]:
    s = summarize(ms)
    lines = ["## Passing (realism v2, P3)", "", "| Measure | Real | Simulated | Band | Status |", "|---|---|---|---|---|"]
    for key, r in t["rows"].items():
        fmt = r.get("fmt", "{:.3f}")
        v = s.get(key, math.nan)
        real = "—" if r.get("real") is None else fmt.format(r["real"])
        band = "—" if r.get("lo") is None else f"{fmt.format(r['lo'])}–{fmt.format(r['hi'])}"
        status = "—" if r.get("lo") is None or not math.isfinite(v) else ("MET" if r["lo"] <= v <= r["hi"] else "NOT MET")
        lines.append(f"| {r['label']} | {real} | {fmt.format(v) if math.isfinite(v) else 'n/a'} | {band} | {status} |")
    groups = [g for x in ms for g in x["groups"]]
    lines += ["", "### Pass-choice model refit", "",
              "Conditional logit over the passer's teammates 4–65 m away at release, intended receiver chosen (carrier-report C3). "
              "Real: the pooled fit with its 90 % interval.", ""]
    if len(groups) < 50:
        return lines + [f"Too few passes with positions to refit ({len(groups)}).", ""]
    b, se, n = clogit(groups)
    lines += [f"{n} passes.", "", "| Feature | Real (90 % interval) | Simulated | Status |", "|---|---|---|---|"]
    for i, name in enumerate(t["choice"]["features"]):
        rb, rs = t["choice"]["b"][i], t["choice"]["se"][i]
        lo, hi = rb - 1.645 * rs, rb + 1.645 * rs
        lines.append(f"| {name} | {rb:+.2f} ({lo:+.2f} to {hi:+.2f}) | {b[i]:+.2f} ± {se[i]:.2f} | {'MET' if lo <= b[i] <= hi else 'NOT MET'} |")
    return lines + [""]


def passing_report(run_dirs: list[Path], targets: dict, note: str, roles: dict[str, str]) -> str:
    ms = [match_passing(d, roles) for d in run_dirs]
    return "\n".join(["# Touchline passing diagnostics", "", f"{len(ms)} synthetic matches ({note}).", ""] + passing_section(ms, targets["passing"]))
```

- [ ] **Step 3: Add the real targets** (`data/params/targets-idsse.json`, new top-level block; keep every other block)

```json
 "passing": {
  "source": "realism v2 analysis 2026-10-13 (carrier-report.md C3/C5/C6/C9/C10, gk-report.md, finalthird.json A2/A3) and P2 task-8b-report.md (ball thirds): IDSSE, 7 matches; aggregates only. Bands are plan 8c rulings.",
  "rows": {
   "passes_per_match": {"label": "Passes per match", "real": 866, "lo": 776, "hi": 956, "fmt": "{:.0f}"},
   "first_tick_share": {"label": "Open-play passes dying at the boot (first tick, under 1 m)", "real": 0.0, "lo": 0.0, "hi": 0.01, "fmt": "{:.3f}"},
   "near1_completion": {"label": "Completion, opponent within 1 m at release", "real": 0.70, "lo": 0.64, "hi": 0.76, "fmt": "{:.3f}"},
   "avail_10_20_completion": {"label": "Completion to an available receiver, 10–20 m", "real": 0.936, "lo": 0.90, "hi": 0.97, "fmt": "{:.3f}"},
   "avail_30p_completion": {"label": "Completion to an available receiver, 30 m+", "real": 0.805, "lo": 0.74, "hi": 0.85, "fmt": "{:.3f}"},
   "long_share": {"label": "Completed passes of 32 m+", "real": 0.143, "lo": 0.12, "hi": 0.17, "fmt": "{:.3f}"},
   "switch_share": {"label": "Switches (|dy| > 25 m), open play", "real": 0.061, "lo": 0.04, "hi": 0.08, "fmt": "{:.3f}"},
   "tight_share": {"label": "Receiver tightly marked (under 3 m), completed", "real": 0.09, "lo": 0.06, "hi": 0.12, "fmt": "{:.3f}"},
   "back_gk_share": {"label": "Passes back to the keeper", "real": 0.062, "lo": 0.045, "hi": 0.08, "fmt": "{:.3f}"},
   "most_fwd_share": {"label": "Most forward available option chosen", "real": 0.20, "lo": 0.15, "hi": 0.25, "fmt": "{:.3f}"},
   "crosses_per_match": {"label": "Open-play crosses per match (10 s after restarts excluded)", "real": 14.9, "lo": 12, "hi": 18, "fmt": "{:.1f}"},
   "cross_contact_m": {"label": "Cross end point from the goal line, median (m)", "real": 10.0, "lo": 8, "hi": 12, "fmt": "{:.1f}"},
   "through_per_match": {"label": "Through balls per match", "real": null, "lo": null, "hi": null, "fmt": "{:.1f}"},
   "through_shot_share": {"label": "Shots after a through ball", "real": 0.025, "lo": 0.0, "hi": 0.05, "fmt": "{:.3f}"},
   "keeper_passes_per_team": {"label": "Keeper passes per team-match", "real": 45.4, "lo": 35, "hi": 55, "fmt": "{:.1f}"},
   "keeper_open_completion": {"label": "Keeper open-play completion", "real": 0.779, "lo": 0.72, "hi": 0.84, "fmt": "{:.3f}"},
   "punts_per_team": {"label": "Punts per team-match", "real": 1.6, "lo": 1.0, "hi": 2.2, "fmt": "{:.2f}"},
   "throws_per_team": {"label": "Keeper throws per team-match", "real": 3.4, "lo": 2.4, "hi": 4.4, "fmt": "{:.2f}"},
   "release_median_lt2_s": {"label": "Time to release, received under 2 m pressure, median (s)", "real": 0.4, "lo": 0.2, "hi": 0.7, "fmt": "{:.2f}"},
   "release_under1_lt2": {"label": "Released within 1 s, received under 2 m pressure", "real": 0.63, "lo": 0.50, "hi": 0.75, "fmt": "{:.3f}"},
   "release_median_s": {"label": "Time to release, median (s)", "real": 1.4, "lo": 1.2, "hi": 1.6, "fmt": "{:.2f}"},
   "release_over3": {"label": "On the ball over 3 s", "real": 0.16, "lo": 0.12, "hi": 0.20, "fmt": "{:.3f}"},
   "ball_own_third": {"label": "Ball in the possessing team's own third", "real": 0.35, "lo": 0.30, "hi": 0.40, "fmt": "{:.3f}"},
   "ball_u_mean": {"label": "Ball u in possession, mean (m)", "real": -5.2, "lo": -8, "hi": -2, "fmt": "{:.1f}"}
  },
  "choice": {
   "features": ["dist/10", "fwd du/10", "|dv|/10", "lane blocked", "open (min(d,10)/5)", "line-breaking", "GK"],
   "b": [-1.3254, 0.5586, 0.1772, -0.5532, 1.2715, 0.0388, 0.9477],
   "se": [0.0336, 0.0254, 0.0308, 0.0399, 0.0389, 0.0625, 0.0848]
  }
 }
```

In `targets.py`: `HAND_BLOCKS = ("bands", "passing")`.

- [ ] **Step 4: Hook the section into the report** (`report.py`)

In `build`, after the bands block:

```python
    if roles and "passing" in targets:
        from .passing import match_passing, passing_section

        lines += passing_section([match_passing(d, roles) for d in run_dirs], targets["passing"])
```

In `__main__`: add `ap.add_argument("--only", default="", choices=["", "passing"], help="passing: write only the P3 passing section")`; the `roles` line loads when `physics or carriers or a.only`; and replace the `md = build(...)` line with:

```python
    if a.only == "passing":
        from .passing import passing_report

        md = passing_report([Path(r) for r in a.runs], json.loads(Path(a.targets).read_text()), a.note, roles)
    else:
        md = build([Path(r) for r in a.runs], json.loads(Path(a.targets).read_text()), a.note, physics, roles, carriers)
```

Run: `uv run --project python/analytics pytest python/analytics/tests -q`
Expected: PASS (the new tests and every old one, including `test_report.py` and `test_bands.py`).

- [ ] **Step 5: Write the failing TS test** (`packages/calibrate/test/overrides.test.ts`)

```ts
import { describe, expect, it } from "vitest"
import { DEFAULT_PARAMS, paramsFromJson } from "@touchline/sim-core"
import { applySets, parseSets } from "../src/overrides.js"

describe("--set overrides", () => {
  it("parse comma-separated key=value pairs, numbers as numbers", () => {
    expect(parseSets("movement.relaxCap=0.5, positioning.drift.deadRate=0,foo.bar=x")).toEqual([["movement.relaxCap", 0.5], ["positioning.drift.deadRate", 0], ["foo.bar", "x"]])
    expect(parseSets("")).toEqual([])
    expect(() => parseSets("movement.relaxCap")).toThrow(/key=value/)
  })
  it("set nested fields on a copy, creating missing blocks; the result merges onto the defaults", () => {
    const base = { provenance: DEFAULT_PARAMS.provenance, movement: { relaxCap: 0.6 } }
    const out = applySets(base, parseSets("movement.relaxCap=0.5,positioning.drift.deadRate=0"))
    expect(base.movement.relaxCap).toBe(0.6)
    const p = paramsFromJson(out)
    expect(p.movement.relaxCap).toBe(0.5)
    expect(p.positioning.drift.deadRate).toBe(0)
    expect(p.positioning.drift.outS).toBe(DEFAULT_PARAMS.positioning.drift.outS)
  })
})
```

Run: `pnpm --filter @touchline/calibrate exec vitest run test/overrides.test.ts`
Expected: FAIL (cannot find `../src/overrides.js`).

- [ ] **Step 6: Write `overrides.ts` and wire it into `realism.ts`**

`packages/calibrate/src/overrides.ts`:

```ts
import { CliError } from "@touchline/sim"

/** Parse "a.b=1,c=x" into [path, value] pairs; numeric values become numbers. */
export const parseSets = (spec: string): Array<readonly [string, number | string]> =>
  spec
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .map((kv) => {
      const i = kv.indexOf("=")
      if (i <= 0 || i === kv.length - 1) throw new CliError(`--set expects key=value pairs separated by commas, got "${kv}"`)
      const k = kv.slice(0, i).trim()
      const v = kv.slice(i + 1).trim()
      return [k, Number.isFinite(Number(v)) ? Number(v) : v] as const
    })

/** A deep copy of `json` with each path set (missing objects are created); still to be checked by paramsFromJson. */
export const applySets = (json: unknown, sets: ReadonlyArray<readonly [string, number | string]>): Record<string, unknown> => {
  const out = structuredClone(json) as Record<string, unknown>
  for (const [path, value] of sets) {
    const keys = path.split(".")
    let o = out
    for (const k of keys.slice(0, -1)) {
      const next = o[k]
      if (typeof next !== "object" || next === null || Array.isArray(next)) o[k] = {}
      o = o[k] as Record<string, unknown>
    }
    o[keys[keys.length - 1]!] = value
  }
  return out
}
```

`packages/calibrate/src/realism.ts`:
- import `{ applySets, parseSets } from "./overrides.js"`;
- add three options after `params`:
  ```ts
  set: { default: "", help: "comma-separated key=value overrides on the parameter file, e.g. firstTick.rule=1,firstTick.bootBlock=0.3" },
  only: { default: "", help: "\"passing\": write only the P3 passing section (faster)" },
  runs: { default: join(root, "out/realism"), help: "folder for the simulated matches; use a separate one for each concurrent run" }
  ```
- replace the `params` block with:
  ```ts
  const sets = exitOnUserError(() => {
    if (o.only !== "" && o.only !== "passing") throw new CliError(`--only must be "passing", got "${o.only}"`)
    return parseSets(o.set)
  })
  const params: Params = exitOnUserError(() => {
    if (o.params === "default" && sets.length === 0) return DEFAULT_PARAMS
    try {
      const json: unknown = o.params === "default" ? structuredClone(DEFAULT_PARAMS) : JSON.parse(readFileSync(here(o.params), "utf8"))
      return paramsFromJson(applySets(json, sets))
    } catch (e) {
      throw new CliError(`Cannot use params file ${o.params}${o.set ? ` with --set ${o.set}` : ""}: ${e instanceof ParamsError ? e.message : String(e)}`)
    }
  })
  ```
- `const outRoot = here(o.runs)`;
- `const note = \`${params.provenance.version}${o.set ? \`; --set ${o.set}\` : ""}; held-out seeds 2000–${2000 + matches - 1}\``;
- add `...(o.only ? ["--only", o.only] : [])` to the Python arguments, after `--out`.

Run: `pnpm --filter @touchline/calibrate exec vitest run test/overrides.test.ts && pnpm --filter @touchline/calibrate exec tsc --noEmit -p .`
Expected: PASS.

- [ ] **Step 7: Measure and commit the P2 baseline** (about 5 minutes)

Run: `pnpm realism --matches 16 --only passing --out docs/realism/p3-passing-baseline.md`
Expected: a "Touchline passing diagnostics" file with every row filled and the refit table. Check it against the preliminary numbers in "Starting point": first-tick share of the order of 0.08, switches about 0.17, back to the keeper about 0.01, keeper passes about 17, crosses about 7 (fewer here: the 10 s window is excluded). **If the refit's coefficients look nothing like carrier-report's sim column** (distance about −0.7, lateral about +0.5, lane about 0), check the frame keying (tracking frame ids restart each period) before going on.

- [ ] **Step 8: Commit**

```bash
git add python/analytics data/params/targets-idsse.json packages/calibrate docs/realism/p3-passing-baseline.md
git commit -m "feat(realism): P3 passing diagnostic — passing section and real aggregates (targets-idsse passing block), choice-model refit, pnpm realism --only passing --set --runs; P2 baseline on seeds 2000-2015

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: X1 — the first-tick interception fix and boot blocks (wave 1, off by default; merge first)

**Files:**
- Modify: `packages/sim-core/src/resolve.ts` (`resolveFlight`), `packages/sim-core/src/deflect.ts` (append `bootBlocker`), `packages/sim-core/src/step.ts` (**boot-block seam** block and one import under its marker), `packages/sim-core/src/params.ts` (`firstTick` values only)
- Test: `packages/sim-core/test/x1.test.ts` (new)

**Interfaces:**
- Consumes: `Params.firstTick`; the `bootBlock` seam and the `boot` RNG stream (Task 1); `pnpm realism --only passing --set` (Task 2).
- Produces: `export const outrightAtBoot = (start: Vec2, dir: Vec2, pl: Vec2, p: Params): boolean` (resolve.ts); `export const bootBlocker = (passer: PlayerState, opponents: ReadonlyArray<PlayerState>, p: Params): PlayerState | null` (deflect.ts).

- [ ] **Step 1: Write the failing tests** (`packages/sim-core/test/x1.test.ts`)

```ts
import { describe, expect, it } from "vitest"
import { launchVelocity } from "../src/ball.js"
import { bootBlocker } from "../src/deflect.js"
import { DEFAULT_PARAMS as P, type Params } from "../src/params.js"
import { resolveFlight } from "../src/resolve.js"
import { Rng, seedRng } from "../src/rng.js"
import { initMatch, isFinished, step } from "../src/step.js"
import type { DomainEvent, PlayerState } from "../src/types.js"
import { kickoffPlayersFor, makeConfig } from "../src/testing.js"

const base = kickoffPlayersFor(makeConfig(1))
const at = (p: PlayerState, x: number, y: number): PlayerState => ({ ...p, pos: { x, y }, vel: { x: 0, y: 0 } })
const on: Params = { ...P, firstTick: { ...P.firstTick, rule: 1 } }
const passer = at(base[2]!, 0, 0)
const receiver = at(base[5]!, 15, 0)
const winner = (def: PlayerState, p: Params, dt = 0.1) => {
  const ball = { pos: { x: 0, y: 0, z: 0 }, vel: launchVelocity(passer.pos, receiver.pos, "ground", p) }
  return resolveFlight(ball, passer.id, receiver.id, [passer, receiver, def], p, dt, new Rng(seedRng(1))).winnerId
}

describe("X1: the first tick", () => {
  it("a pass played directly away from an adjacent defender is not cut out (the old rule cut it out)", () => {
    const behind = at(base[13]!, -0.8, 0)
    expect(winner(behind, P)).toBe(behind.id)
    expect(winner(behind, on)).toBe(receiver.id)
  })
  it("a pass played through an adjacent defender is", () => {
    const front = at(base[13]!, 1.0, 0.2)
    expect(winner(front, on)).toBe(front.id)
  })
  it("holds at 25 Hz too (dt 0.04)", () => {
    expect(winner(at(base[13]!, -0.8, 0), on, 0.04)).toBe(receiver.id)
    expect(winner(at(base[13]!, 1.0, 0.2), on, 0.04)).toBe(base[13]!.id)
  })
  it("a teammate at the boot keeps the old rule", () => {
    const mate = at(base[4]!, -0.8, 0)
    expect(winner(mate, on)).toBe(mate.id)
  })
})

describe("X1: boot blocks", () => {
  it("the nearest outfield opponent within bootM of the passer can block; keepers and players further away cannot", () => {
    const near = at(base[13]!, 0.6, 0.3), far = at(base[14]!, 1.5, 0), gk = at(base[11]!, 0.2, 0.2)
    expect(bootBlocker(passer, [far, near, gk], on)?.id).toBe(near.id)
    expect(bootBlocker(passer, [far, gk], on)).toBeNull()
  })
})

const bootDeaths = (p: Params, seed: number) => {
  let s = initMatch(makeConfig(seed, { params: p }))
  const events: DomainEvent[] = []
  while (!isFinished(s)) {
    const r = step(s)
    s = r.state
    events.push(...r.events)
  }
  const open = events.filter((e) => e.type === "pass" && !e.attrs.restart)
  const dead = open.filter((e) => e.outcome === "intercepted" && e.frame_id_end! - e.frame_id <= 1 && Math.hypot(e.x_end! - e.x!, e.y_end! - e.y!) < 1)
  return { share: dead.length / open.length, blocks: events.filter((e) => e.type === "block" && e.attrs.blocked === "pass").length }
}

describe("X1 in a match", () => {
  it("passes stop dying at the passer's boot, and some are blocked there instead", () => {
    const off = bootDeaths(P, 7)
    const x1 = bootDeaths(on, 7)
    expect(x1.share).toBeLessThan(off.share / 2)
    expect(off.blocks).toBe(0)
    expect(x1.blocks).toBeGreaterThan(0)
  }, 120_000)
})
```

Run: `pnpm --filter @touchline/sim-core exec vitest run test/x1.test.ts`
Expected: FAIL: `bootBlocker` is not exported, and the "directly away" case still returns the defender under `on`.

- [ ] **Step 2: Change the first-tick rule** (`resolve.ts`)

Add, above `resolveFlight`:

```ts
/**
 * X1: whether an opponent standing at `pl` is in front of the pass: within firstTick.coneDeg of the pass direction `dir`
 * (a unit vector) as seen from the ball's start.
 */
export const outrightAtBoot = (start: Vec2, dir: Vec2, pl: Vec2, p: Params): boolean => {
  const vx = pl.x - start.x
  const vy = pl.y - start.y
  const r = Math.hypot(vx, vy)
  if (r < 1e-9) return false
  return (vx * dir.x + vy * dir.y) / r >= Math.cos((p.firstTick.coneDeg * Math.PI) / 180)
}
```

In `resolveFlight`, before the loop:

```ts
  // X1: the passer's side, the pass direction and its start, for the first-tick rule.
  const x1 = p.firstTick.rule > 0
  const passerSide = players.find((x) => x.id === fromId)?.side
  const v0 = Math.hypot(start.vel.x, start.vel.y)
  const dir0 = v0 > 1e-9 ? { x: start.vel.x / v0, y: start.vel.y / v0 } : null
  const start0 = { x: start.pos.x, y: start.pos.y }
```

Inside the loop, replace from `const { t: f, d } = closestOnSegment(a2, b2, pl.pos)` down to the two `qualifiers.push` lines with:

```ts
      let { t: f, d } = closestOnSegment(a2, b2, pl.pos)
      // X1: on the first tick an opponent meets the ball no nearer than alongM along its path: not at the passer's feet.
      const boot = x1 && k === 1 && dir0 !== null && passerSide !== undefined && pl.side !== passerSide
      if (boot) {
        const seg = Math.hypot(b2.x - a2.x, b2.y - a2.y)
        const fMin = seg > 1e-9 ? Math.min(1, p.firstTick.alongM / seg) : 1
        if (f < fMin) {
          f = fMin
          d = Math.hypot(a2.x + f * (b2.x - a2.x) - pl.pos.x, a2.y + f * (b2.y - a2.y) - pl.pos.y)
        }
      }
      const z = prev.pos.z + f * (b.pos.z - prev.pos.z)
      if (z > p.kinematics.headerHeightM) continue
      const contact = { x: a2.x + f * (b2.x - a2.x), y: a2.y + f * (b2.y - a2.y) }
      // Reachable disc: an acceleration-limited player who keeps drifting at their current velocity
      // can be anywhere within ~½·a·t² (capped by top speed) of pos + vel·t. arriveBy() steers to match.
      const tc = (k - 1 + f) * dt
      const reaction = pl.id === intendedId ? 0 : p.kinematics.reactionS
      const vmax = vmaxFor(pl, pl.energy, p)
      const drift = { x: pl.pos.x + pl.vel.x * tc, y: pl.pos.y + pl.vel.y * tc }
      const radius = p.kinematics.reachM + p.kinematics.reachMargin * reachIn(tc - reaction, 0, vmax, accelFor(pl.attrs, p))
      const fromDrift = Math.hypot(contact.x - drift.x, contact.y - drift.y)
      const withinSpeed = Math.hypot(contact.x - pl.pos.x, contact.y - pl.pos.y) <= p.kinematics.reachM + vmax * tc
      const outright = d <= p.kinematics.reachM && tc <= dt && (!boot || outrightAtBoot(start0, dir0!, pl.pos, p))
      if (outright) qualifiers.push({ pl, slack: p.kinematics.reachM - d, f })
      else if (fromDrift <= radius && withinSpeed) qualifiers.push({ pl, slack: radius - fromDrift, f })
```

With `rule` 0, `boot` is false: `f` and `d` are the old values and `outright` is the old condition, so the arithmetic is unchanged.

- [ ] **Step 3: Add `bootBlocker`** (append to `deflect.ts`)

```ts
/** X1: the nearest outfield opponent within firstTick.bootM of the passer, who may block the pass at the boot. */
export const bootBlocker = (passer: PlayerState, opponents: ReadonlyArray<PlayerState>, p: Params): PlayerState | null => {
  let best: PlayerState | null = null
  let bd = Infinity
  for (const o of opponents) {
    if (o.sentOff || o.role === "GK") continue
    const d = dist(o.pos, passer.pos)
    if (d <= p.firstTick.bootM && d < bd) {
      best = o
      bd = d
    }
  }
  return best
}
```

- [ ] **Step 4: Fill the boot-block seam** (`step.ts`)

Under the marker `// ---- P3 imports, boot-block seam ...` add `import { bootBlocker } from "./deflect.js"`. The seam body becomes:

```ts
/** A defender at the passer's boot blocks this open-play pass (X1): who, and where the ball goes. Draws from the boot stream. */
const bootBlock = (w: Work, owner: PlayerState, _d: Decision, _target: Vec2): { blocker: PlayerState; loose: BallState } | null => {
  if (w.p.firstTick.rule <= 0) return null
  const b = bootBlocker(owner, w.active(other(owner.side)), w.p)
  if (!b || !w.rng.boot.chance(w.p.firstTick.bootBlock)) return null
  return { blocker: b, loose: deflectLoose(b.side, w.period, b.pos, w.rng.boot, [2, 6], [0, 1]) }
}
```

- [ ] **Step 5: Run the tests**

Run: `pnpm --filter @touchline/sim-core exec vitest run test/x1.test.ts test/resolve-shot.test.ts`
Expected: PASS.

- [ ] **Step 6: Calibrate `bootBlock` and measure** (about 20 minutes; the sweeps can run concurrently, each with its own `--runs`)

Before (the baseline is `docs/realism/p3-passing-baseline.md`). Sweep the boot-block share with X1 on:

```bash
for b in 0.1 0.25 0.4; do
  pnpm realism --matches 16 --only passing --set firstTick.rule=1,firstTick.bootBlock=$b --runs out/p3-x1-$b --out out/p3-x1-$b.md &
done; wait
```

Pick the share whose `near1_completion` is closest to 0.70 (band 0.64–0.76); interpolate between the three if needed, then confirm the chosen value with one more run. Set it as `firstTick.bootBlock` in `DEFAULT_PARAMS` (the `rule` stays 0). Record from the confirming run against the baseline: first-tick share, near-1 completion, completion by length (`avail_*`), keeper open completion, passes per match, ball in own third.

Run: `pnpm --filter @touchline/sim-core exec vitest run --no-file-parallelism && pnpm --filter @touchline/calibrate exec vitest run test/realism-gate.test.ts --disableConsoleIntercept`
Expected: PASS, drift 0 (the switch is off).

- [ ] **Step 7: Commit**

```bash
git add packages/sim-core
git commit -m "feat(sim-core): P3 X1 — first-tick interceptions only from in front and past the boot (firstTick.rule), boot blocks on their own stream; bootBlock <value> for completion ~0.70 with an opponent within 1 m

Before/after on seeds 2000-2015 (pnpm realism --only passing): first-tick share <b> -> <a>, near-1 completion <b> -> <a>, ...

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

(Fill the `<value>`, `<b>` and `<a>` placeholders in the message with the measured numbers; they are outputs of Step 6, not plan gaps.)

---

### Task 4: D2 — release timing by pressure (wave 1, off by default; owns passes per match)

**Files:**
- Create: `packages/sim-core/src/release.ts`
- Modify: `packages/sim-core/src/step.ts` (**release seam** block and one import under its marker), `packages/sim-core/src/params.ts` (`release` values only)
- Test: `packages/sim-core/test/release.test.ts` (new)

**Interfaces:**
- Consumes: `Params.release`, `timing.decisionMinS/MaxS`; the `releaseDelayTicks` seam and the `release` stream (Task 1); `pnpm realism --only passing --set` (Task 2).
- Produces: `export const releaseDelayS = (nearestOppM: number, p: Params, rng: Rng): number` (release.ts).

- [ ] **Step 1: Write the failing tests** (`packages/sim-core/test/release.test.ts`)

```ts
import { describe, expect, it } from "vitest"
import { DEFAULT_PARAMS as P, type Params } from "../src/params.js"
import { releaseDelayS } from "../src/release.js"
import { Rng, seedRng } from "../src/rng.js"
import { initMatch, isFinished, step } from "../src/step.js"
import type { DomainEvent } from "../src/types.js"
import { makeConfig } from "../src/testing.js"

// The tail is fixed here: Step 4 may move the defaults.
const on: Params = { ...P, release: { ...P.release, rule: 1, tailShare: 0.25, tailMeanS: 1.5 } }
const draws = (d: number, n = 4000) => {
  const r = new Rng(seedRng(5))
  return Array.from({ length: n }, () => releaseDelayS(d, on, r)).sort((a, b) => a - b)
}

describe("D2: release timing", () => {
  it("a pressed player releases within 0.2-0.7 s", () => {
    const v = draws(1.5)
    expect(v[0]).toBeGreaterThanOrEqual(0.2)
    expect(v[v.length - 1]).toBeLessThanOrEqual(0.7)
  })
  it("a free player keeps the base range and sometimes holds much longer", () => {
    const v = draws(8)
    expect(v[0]).toBeGreaterThanOrEqual(P.timing.decisionMinS)
    const over = v.filter((s) => s > P.timing.decisionMaxS + 1).length / v.length
    // Base 0.9-2.2 s plus, a quarter of the time, Exp(1.5 s): about 7.5 % end up over 3.2 s.
    expect(over).toBeGreaterThan(0.04)
    expect(over).toBeLessThan(0.15)
  })
  it("in ticks at 25 Hz a pressed release is 5-18 ticks", () => {
    for (const s of draws(1.5, 500)) {
      const ticks = Math.max(1, Math.round(s / 0.04))
      expect(ticks).toBeGreaterThanOrEqual(5)
      expect(ticks).toBeLessThanOrEqual(18)
    }
  })
})

/** Seconds from a controlled reception to the receiver's next open-play pass, for receptions with an opponent within 2 m. */
const pressedReleases = (p: Params, seed: number): number[] => {
  let s = initMatch(makeConfig(seed, { params: p }))
  const events: DomainEvent[] = []
  const near = new Map<string, number>()
  while (!isFinished(s)) {
    const r = step(s)
    s = r.state
    for (const e of r.events) {
      if (e.type === "reception" && e.attrs.first_touch === "controlled") {
        const me = s.players.find((x) => x.id === e.player_id)!
        near.set(e.id, Math.min(...s.players.filter((x) => x.side !== me.side && !x.sentOff).map((x) => Math.hypot(x.pos.x - me.pos.x, x.pos.y - me.pos.y))))
      }
    }
    events.push(...r.events)
  }
  const out: number[] = []
  events.forEach((e, i) => {
    if (e.type !== "reception" || (near.get(e.id) ?? 99) >= 2) return
    const next = events.slice(i + 1).find((g) => g.type === "pass" || g.type === "possession_change")
    if (next?.type === "pass" && next.player_id === e.player_id && !next.attrs.restart) out.push((next.frame_id - e.frame_id) * 0.1)
  })
  return out.sort((a, b) => a - b)
}

describe("D2 in a match", () => {
  it("pressed receivers release much sooner with the rule on", () => {
    const median = (v: number[]) => v[Math.floor(v.length / 2)]!
    const off = median(pressedReleases(P, 7))
    expect(off).toBeGreaterThanOrEqual(P.timing.decisionMinS)
    expect(median(pressedReleases(on, 7))).toBeLessThan(off - 0.3)
  }, 120_000)
})
```

Run: `pnpm --filter @touchline/sim-core exec vitest run test/release.test.ts`
Expected: FAIL (cannot find `../src/release.js`).

- [ ] **Step 2: Write `release.ts`**

```ts
import type { Params } from "./params.js"
import type { Rng } from "./rng.js"

/**
 * Seconds a player takes on the ball before his first decision after winning or receiving it (realism v2 P3, D2). With an
 * opponent within release.pressedM: release.pressedS (real median 0.4 s, 63 % within 1 s). Otherwise the base range
 * timing.decisionMinS..MaxS, plus, with chance release.tailShare, an exponential extra of mean release.tailMeanS: real
 * players hold the ball over 3 s 16 % of the time (carrier-report C6).
 */
export const releaseDelayS = (nearestOppM: number, p: Params, rng: Rng): number => {
  const r = p.release
  if (nearestOppM < r.pressedM) return rng.range(r.pressedS[0], r.pressedS[1])
  const base = rng.range(p.timing.decisionMinS, p.timing.decisionMaxS)
  return rng.chance(r.tailShare) ? base - r.tailMeanS * Math.log(1 - rng.uniform()) : base
}
```

- [ ] **Step 3: Fill the release seam** (`step.ts`)

Under the marker `// ---- P3 imports, release seam ...` add `import { releaseDelayS } from "./release.js"`. The seam body becomes:

```ts
/** Ticks a player takes before his first decision after winning or receiving the ball (D2; release stream). */
const releaseDelayTicks = (w: Work, pl: PlayerState): number => {
  if (w.p.release.rule <= 0) return w.decisionDelayTicks()
  const opp = nearestOpponent(pl.pos, w.active(other(pl.side)))
  return Math.max(1, Math.round(releaseDelayS(opp ? dist(opp.pos, pl.pos) : 50, w.p, w.rng.release) / w.dt))
}
```

Run: `pnpm --filter @touchline/sim-core exec vitest run test/release.test.ts`
Expected: PASS.

- [ ] **Step 4: Tune the tail and measure** (about 15 minutes)

```bash
for t in 0.15 0.25 0.35; do
  pnpm realism --matches 16 --only passing --set release.rule=1,release.tailShare=$t --runs out/p3-d2-$t --out out/p3-d2-$t.md &
done; wait
```

Pick the `tailShare` whose `release_over3` is nearest 0.16 (band 0.12–0.20) while `release_median_s` stays within 1.2–1.6; if the median runs high at every share, lower `tailMeanS` to 1.0 and repeat once. Set the chosen values in `DEFAULT_PARAMS.release` (rule stays 0). Record against the baseline: **passes per match** (this task owns the 1075 against 866 gap; expected to fall), the four release rows, completion near 1 m, ball in own third.

Run: `pnpm --filter @touchline/sim-core exec vitest run --no-file-parallelism && pnpm --filter @touchline/calibrate exec vitest run test/realism-gate.test.ts --disableConsoleIntercept`
Expected: PASS, drift 0.

- [ ] **Step 5: Commit**

```bash
git add packages/sim-core
git commit -m "feat(sim-core): P3 D2 — release timing by pressure (release.rule): 0.2-0.7 s within 2 m, else the base range with a long-hold tail on its own stream

Before/after on seeds 2000-2015: passes per match <b> -> <a>, release median under pressure <b> -> <a>, over 3 s <b> -> <a>, ...

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: D3 — crosses to zones (wave 1, off by default)

**Files:**
- Modify: `packages/sim-core/src/decide.ts` (**cross seam** block only), `packages/sim-core/src/params.ts` (`cross` values only)
- Test: `packages/sim-core/test/crosses.test.ts` (new)

**Interfaces:**
- Consumes: `CandidateContext`, `CrossOption`, `pushCandidate` (through `buildCandidatesIn`), `Params.cross`, `classifier.finalThirdAttackX`, `classifier.crossOriginAbsY` (Task 1).
- Produces: the body of `crossTargets(ctx): CrossOption[]`.

- [ ] **Step 1: Write the failing tests** (`packages/sim-core/test/crosses.test.ts`)

```ts
import { describe, expect, it } from "vitest"
import { buildCandidates, type Candidate } from "../src/decide.js"
import { DEFAULT_PARAMS as P, type Params } from "../src/params.js"
import type { Period } from "../src/geometry.js"
import type { PlayerState } from "../src/types.js"
import { kickoffPlayersFor, makeConfig, STYLES } from "../src/testing.js"

const players = kickoffPlayersFor(makeConfig(1))
const at = (p: PlayerState, x: number, y: number): PlayerState => ({ ...p, pos: { x, y }, vel: { x: 0, y: 0 } })
const home = players.filter((p) => p.side === "home")
const away = players.filter((p) => p.side === "away")
const on: Params = { ...P, cross: { ...P.cross, rule: 1 } }

/** Home (4-3-3) winger on the ball at (ox, oy), the striker at (sx, sy), everyone else far away; d = +1 first half, -1 second. */
const crosses = (p: Params, period: Period, d: number, o: [number, number], st: [number, number]): Candidate[] => {
  const owner = at(home[8]!, d * o[0], o[1])
  const striker = at(home[9]!, d * st[0], st[1])
  const teammates = home.map((x) => (x.id === owner.id ? owner : x.id === striker.id ? striker : at(x, d * (-30 + x.slot), -30)))
  const opponents = away.map((x) => (x.role === "GK" ? at(x, d * 51, 0) : at(x, d * (5 + x.slot), 30)))
  return buildCandidates({ period, owner, teammates, opponents, style: STYLES.direct, scoreDiff: 0, minute: 30, restart: null, scriptBias: {} }, p, 0).filter((c) => c.kind === "cross")
}

describe("D3: crosses to zones", () => {
  it("a wide carrier crosses to the penalty spot when a striker outside the box can get there; none without the rule", () => {
    expect(crosses(P, "first_half", 1, [38, 28], [33, 5])).toEqual([])
    const c = crosses(on, "first_half", 1, [38, 28], [33, 5])
    expect(c).toHaveLength(1)
    expect(c[0]!.target.x).toBeCloseTo(41.5, 6)
    expect(c[0]!.target.y).toBeCloseTo(0, 6)
    expect(c[0]!.height).toBe("high")
    expect(c[0]!.receiverId).toBe(home[9]!.id)
  })
  it("no zone is offered that nobody can reach in time", () => {
    expect(crosses(on, "first_half", 1, [38, 28], [10, 5])).toEqual([])
  })
  it("mirrors in the second half and from the left: the near post is on the crosser's side", () => {
    const c = crosses(on, "second_half", -1, [38, -28], [44, -6])
    expect(c.some((x) => Math.abs(x.target.x + 47.5) < 1e-6 && Math.abs(x.target.y + 3) < 1e-6)).toBe(true)
    expect(c.some((x) => Math.abs(x.target.x + 47.5) < 1e-6 && Math.abs(x.target.y - 3) < 1e-6)).toBe(false)
  })
  it("the cut-back is offered only from near the byline", () => {
    const deep = crosses(on, "first_half", 1, [46, 26], [40, 8])
    expect(deep.some((x) => x.height === "ground" && Math.abs(x.target.x - 42) < 1e-6 && Math.abs(x.target.y - 6) < 1e-6)).toBe(true)
    const early = crosses(on, "first_half", 1, [38, 28], [40, 8])
    expect(early.some((x) => x.height === "ground")).toBe(false)
  })
})
```

Run: `pnpm --filter @touchline/sim-core exec vitest run test/crosses.test.ts`
Expected: FAIL at the second test case's `toHaveLength(1)` (no zone crosses yet).

- [ ] **Step 2: Fill the cross seam** (`decide.ts`)

```ts
/**
 * Crosses aimed at zones rather than teammates (D3). A carrier in the final third (u beyond classifier.finalThirdAttackX)
 * and wide (|y| beyond classifier.crossOriginAbsY) gets one option per zone that an attacker can reach by the ball's
 * arrival: the fastest such attacker is the intended receiver, and each one adds cross.attackerValue.
 */
const crossTargets = (ctx: CandidateContext): CrossOption[] => {
  const { input, p } = ctx
  const c = p.cross
  if (c.rule <= 0 || input.restart !== null) return []
  const owner = input.owner
  const ou = attackX(ctx.side, owner.pos.x, ctx.period)
  if (ou <= p.classifier.finalThirdAttackX || Math.abs(owner.pos.y) <= p.classifier.crossOriginAbsY) return []
  const near = Math.sign(owner.pos.y)
  const out: CrossOption[] = []
  for (const zone of c.zones) {
    if (ou < zone.minOriginU) continue
    const target = { x: ctx.dir * zone.u, y: near * zone.s }
    const arrive = dist(owner.pos, target) / (zone.height === "high" ? c.flightSpeed : p.pass.arriveSpeed) + c.arriveSlackS
    let receiver: PlayerState | null = null
    let fastest = Infinity
    let n = 0
    for (const tm of input.teammates) {
      if (tm.id === owner.id || tm.sentOff || tm.role === "GK") continue
      const t = dist(tm.pos, target) / c.runSpeed
      if (t > arrive) continue
      n++
      if (t < fastest) {
        fastest = t
        receiver = tm
      }
    }
    if (receiver) out.push({ receiver, target, height: zone.height, bonus: c.attackerValue * n })
  }
  return out
}
```

Run: `pnpm --filter @touchline/sim-core exec vitest run test/crosses.test.ts test/wide.test.ts`
Expected: PASS.

- [ ] **Step 3: Measure** (about 5 minutes)

Run: `pnpm realism --matches 16 --only passing --set cross.rule=1 --runs out/p3-d3 --out out/p3-d3.md`

Record against the baseline: crosses per match (target 12–18), cross contact depth (8–12 m), through-ball shot share, passes per match, ball in own third. **If crosses stay well under 12**, try `cross.attackerValue=0.6` and `cross.arriveSlackS=0.6` once and keep the better pair (record both). The box is nearly empty in the sim (0.72 attackers at delivery against 2.37 real); box arrivals are P5 (A6, S1), so a shortfall here is recorded, not forced.

Run: `pnpm --filter @touchline/sim-core exec vitest run --no-file-parallelism && pnpm --filter @touchline/calibrate exec vitest run test/realism-gate.test.ts --disableConsoleIntercept`
Expected: PASS, drift 0.

- [ ] **Step 4: Commit**

```bash
git add packages/sim-core
git commit -m "feat(sim-core): P3 D3 — crosses to zones (near post, penalty spot, far post, cut-back) valued by the attackers who can arrive (cross.rule)

Before/after on seeds 2000-2015: crosses per match <b> -> <a>, contact depth <b> -> <a> m, ...

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: D4 — through balls into space for runners (wave 1, off by default)

**Files:**
- Modify: `packages/sim-core/src/decide.ts` (**through-ball seam** block and one import under its marker), `packages/sim-core/src/params.ts` (`through` values only)
- Test: `packages/sim-core/test/through.test.ts` (new)

**Interfaces:**
- Consumes: `CandidateContext`, `ThroughOption`, `Params.through`, `pass.throughLeadM` (Task 1).
- Produces: `export const isRunIntent = (intent: Intent): boolean` and the body of `throughTargets(ctx, tm): ThroughOption[]`.

- [ ] **Step 1: Write the failing tests** (`packages/sim-core/test/through.test.ts`)

```ts
import { describe, expect, it } from "vitest"
import { buildCandidates } from "../src/decide.js"
import { DEFAULT_PARAMS as P, type Params } from "../src/params.js"
import type { Period } from "../src/geometry.js"
import type { PlayerState } from "../src/types.js"
import { kickoffPlayersFor, makeConfig, STYLES } from "../src/testing.js"

const players = kickoffPlayersFor(makeConfig(1))
const at = (p: PlayerState, x: number, y: number): PlayerState => ({ ...p, pos: { x, y }, vel: { x: 0, y: 0 } })
const home = players.filter((p) => p.side === "home")
const away = players.filter((p) => p.side === "away")
const on: Params = { ...P, through: { ...P.through, rule: 1 } }

/** Home CM on the ball at the centre; the striker runs in behind from (15, 5) to (30, 5); a winger stands beyond the line at (25, -20). */
const through = (p: Params, period: Period, d: number) => {
  const owner = at(home[5]!, 0, 0)
  const st = { ...at(home[9]!, d * 15, 5), intent: { kind: "run_in_behind" as const, target: { x: d * 30, y: 5 } } }
  const w = at(home[10]!, d * 25, -20)
  const teammates = home.map((x) => (x.id === owner.id ? owner : x.id === st.id ? st : x.id === w.id ? w : at(x, d * (-30 + x.slot), 30)))
  const opponents = away.map((x) => (x.role === "GK" ? at(x, d * 51, 0) : x.role === "CB" ? at(x, d * 22, x.slot === 2 ? 8 : -8) : at(x, d * (-5 - x.slot), 30)))
  const cands = buildCandidates({ period, owner, teammates, opponents, style: STYLES.possession, scoreDiff: 0, minute: 30, restart: null, scriptBias: {} }, p, 0)
  return { st: cands.filter((c) => c.receiverId === st.id && (c.kind === "through" || c.kind === "lofted_through")), w: cands.filter((c) => c.receiverId === w.id && (c.kind === "through" || c.kind === "lofted_through")) }
}

describe("D4: through balls into space", () => {
  it("the old rule gives a fixed 8 m lead to anyone near the last defender", () => {
    const old = through(P, "first_half", 1)
    expect(old.w.map((c) => c.target)).toEqual([{ x: 33, y: -20 }])
    expect(old.st.map((c) => c.target)).toEqual([{ x: 23, y: 5 }])
  })
  it("with the rule the runner gets the ball where he will be when it arrives, and the static winger gets none", () => {
    const now = through(on, "first_half", 1)
    expect(now.w).toEqual([])
    expect(now.st).toHaveLength(1)
    expect(now.st[0]!.target.x).toBeCloseTo(26.7, 1)
    expect(now.st[0]!.target.y).toBeCloseTo(5, 6)
    expect(now.st[0]!.kind).toBe("through")
  })
  it("mirrors in the second half", () => {
    const now = through(on, "second_half", -1)
    expect(now.st[0]!.target.x).toBeCloseTo(-26.7, 1)
  })
})
```

The 26.7 m: the ball at 14 m/s reaches the runner's start in 1.13 s, by which he has run 7.9 m; re-aimed there it takes 1.67 s, by which he has run 11.7 m along his run, so the lead is (15 + 11.7, 5).

Run: `pnpm --filter @touchline/sim-core exec vitest run test/through.test.ts`
Expected: the first case PASSES (it pins the old rule); the second and third FAIL.

- [ ] **Step 2: Fill the through-ball seam** (`decide.ts`)

Under the marker `// ---- P3 imports, through-ball seam ...` add:

```ts
import { add, clampToPitch, norm, scale, sub } from "./geometry.js"
import type { Intent } from "./types.js"
```

The seam body becomes:

```ts
export interface ThroughOption { readonly target: Vec2; readonly height: PassHeight }

/** Off-ball runs that ask for a ball into space (D4). P5 (A6) adds overlap runs here. */
export const isRunIntent = (intent: Intent): boolean => intent.kind === "run_in_behind"

/**
 * Through-ball targets for teammate `tm`. Old rule: an 8 m lead straight upfield for anyone near the last defender or on a
 * run. D4 (through.rule): only a runner, and the ball goes where he will be when it arrives, at most leadMaxM along his run.
 */
const throughTargets = (ctx: CandidateContext, tm: PlayerState): ThroughOption[] => {
  const owner = ctx.input.owner
  const heightTo = (target: Vec2): PassHeight => (dist(owner.pos, target) < 30 ? "ground" : "high")
  if (ctx.p.through.rule <= 0) {
    const ahead = attackX(ctx.side, tm.pos.x, ctx.period) > ctx.lastDef - 4 || tm.intent.kind === "run_in_behind"
    if (!ahead || tm.role === "GK") return []
    const target = { x: tm.pos.x + ctx.dir * ctx.p.pass.throughLeadM, y: tm.pos.y }
    return Math.abs(target.x) < PITCH.halfL - 2 ? [{ target, height: heightTo(target) }] : []
  }
  if (tm.role === "GK" || tm.intent.kind !== "run_in_behind" || !isRunIntent(tm.intent)) return []
  const t = ctx.p.through
  const goal = tm.intent.target
  const along = norm(sub(goal, tm.pos))
  const room = dist(tm.pos, goal)
  let lead = tm.pos
  let flight = dist(owner.pos, tm.pos) / t.ballSpeed
  for (let i = 0; i < 2; i++) {
    lead = add(tm.pos, scale(along, Math.min(room, t.runSpeed * flight, t.leadMaxM)))
    flight = dist(owner.pos, lead) / t.ballSpeed
  }
  const target = clampToPitch(lead, 2)
  return [{ target, height: heightTo(target) }]
}
```

(The `tm.intent.kind !== "run_in_behind"` check narrows the type so `tm.intent.target` is readable; `isRunIntent` is the extension point.)

Run: `pnpm --filter @touchline/sim-core exec vitest run test/through.test.ts test/letrun.test.ts test/passing.test.ts`
Expected: PASS.

- [ ] **Step 3: Measure** (about 5 minutes)

Run: `pnpm realism --matches 16 --only passing --set through.rule=1 --runs out/p3-d4 --out out/p3-d4.md`

Record against the baseline: through balls per match, **through-ball shot share** (real 0.025; it was about 0.15 in the analysis), completion by length, passes per match, ball in own third.

Run: `pnpm --filter @touchline/sim-core exec vitest run --no-file-parallelism && pnpm --filter @touchline/calibrate exec vitest run test/realism-gate.test.ts --disableConsoleIntercept`
Expected: PASS, drift 0.

- [ ] **Step 4: Commit**

```bash
git add packages/sim-core
git commit -m "feat(sim-core): P3 D4 — through balls into the space ahead of a runner (through.rule); static players beyond the line no longer get a through target

Before/after on seeds 2000-2015: through balls per match <b> -> <a>, through-ball shot share <b> -> <a>, ...

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: G5 — keeper distribution from the hands (wave 1, off by default)

**Files:**
- Modify: `packages/sim-core/src/decide.ts` (**keeper-hands seam** block only), `packages/sim-core/src/step.ts` (**keeper-distribution seam** block only), `packages/sim-core/src/params.ts` (`distribution` values only)
- Test: `packages/sim-core/test/distribution.test.ts` (new)

**Interfaces:**
- Consumes: `CandidateContext`, `pushCandidate`, `receiverPick`, `optionQuality`, `toOption`, `OPTIONS_RECORDED`, `DecisionInput.keeperHands`, `Candidate.method`, `KickIntent.errorScale`, `Params.distribution` (Task 1).
- Produces: the bodies of `keeperHandsDecision(ctx, rng)`, `keeperMethod(w, d)`, `kickStyle(w, d, restart)`.

- [ ] **Step 1: Write the failing tests** (`packages/sim-core/test/distribution.test.ts`)

```ts
import { describe, expect, it } from "vitest"
import { decide, type DecisionInput } from "../src/decide.js"
import { DEFAULT_PARAMS as P, type Params } from "../src/params.js"
import { Rng, seedRng } from "../src/rng.js"
import { initMatch, isFinished, step } from "../src/step.js"
import type { DomainEvent, PlayerState } from "../src/types.js"
import { kickoffPlayersFor, makeConfig, STYLES } from "../src/testing.js"

const players = kickoffPlayersFor(makeConfig(1))
const at = (p: PlayerState, x: number, y: number): PlayerState => ({ ...p, pos: { x, y }, vel: { x: 0, y: 0 } })
const home = players.filter((p) => p.side === "home")
const away = players.filter((p) => p.side === "away")
const on: Params = { ...P, distribution: { ...P.distribution, rule: 1 } }
const keeper = at(home[0]!, -38, 0)
// A centre back 17 m away, a striker 48 m upfield, the rest spread out; opponents far away.
const teammates = home.map((x) => (x.id === keeper.id ? keeper : x.role === "ST" ? at(x, 10, 0) : x.slot === 2 ? at(x, -30, 15) : at(x, -10 + x.slot, 25)))
const opponents = away.map((x, i) => at(x, 20 + i, -30))
const input = (o: Partial<DecisionInput>): DecisionInput => ({ period: "first_half", owner: keeper, teammates, opponents, style: STYLES.possession, scoreDiff: 0, minute: 30, restart: null, scriptBias: {}, keeperHands: true, ...o })

describe("G5: from the keeper's hands", () => {
  it("throws short along the ground or punts long and high to a forward, punting about a third of the time", () => {
    const r = new Rng(seedRng(9))
    let punts = 0
    for (let i = 0; i < 400; i++) {
      const d = decide(input({}), on, r)
      const c = d.candidate!
      const len = Math.hypot(c.target.x - keeper.pos.x, c.target.y - keeper.pos.y)
      if (c.method === "punt") {
        punts++
        expect(c.height).toBe("high")
        expect(len).toBeGreaterThanOrEqual(35)
        expect(["ST", "W", "AM"]).toContain(teammates.find((t) => t.id === c.receiverId)!.role)
      } else {
        expect(c.method).toBe("throw")
        expect(c.height).toBe("ground")
        expect(len).toBeLessThanOrEqual(35)
      }
    }
    expect(punts / 400).toBeGreaterThan(0.24)
    expect(punts / 400).toBeLessThan(0.4)
  })
  it("plays normally from his feet, at a restart, or with the rule off", () => {
    const r = new Rng(seedRng(9))
    expect(decide(input({ keeperHands: false }), on, r).candidate?.method).toBeUndefined()
    expect(decide(input({ restart: "goal_kick" }), on, r).candidate?.method).toBeUndefined()
    expect(decide(input({}), P, r).candidate?.method).toBeUndefined()
  })
})

describe("G5 in a match", () => {
  it("keeper distributions are labelled truthfully, and throws are thrown", () => {
    let s = initMatch(makeConfig(7, { params: on }))
    const events: DomainEvent[] = []
    while (!isFinished(s)) {
      const r = step(s)
      s = r.state
      events.push(...r.events)
    }
    const dist = events.filter((e) => e.type === "keeper_distribution")
    expect(dist.length).toBeGreaterThan(0)
    for (const e of dist) expect(["throw", "punt", "kick"]).toContain(e.attrs.method)
    events.forEach((e, i) => {
      if (e.type !== "keeper_distribution" || e.attrs.method !== "throw") return
      const pass = events.slice(i + 1).find((g) => g.type === "pass")!
      expect(pass.attrs.technique).toBe("throw")
      expect(pass.attrs.body_part).toBe("hands")
    })
  }, 120_000)
})
```

Run: `pnpm --filter @touchline/sim-core exec vitest run test/distribution.test.ts`
Expected: FAIL: `candidate` has no `method`.

- [ ] **Step 2: Fill the keeper-hands seam** (`decide.ts`)

```ts
/**
 * A keeper's distribution from his hands (G5): open play only, and only when his hold in his hands has just ended. He
 * throws to a teammate 4..throwMaxM away along the ground, or punts high to a forward (ST, W, AM) puntMinM..puntMaxM away,
 * punting with chance sigmoid(distribution.puntLogit); then the receiver is drawn as for any pass. The method
 * probabilities are recorded under long_pass (punt) and short_pass (throw).
 */
const keeperHandsDecision = (ctx: CandidateContext, rng: Rng): Decision | null => {
  const { input, p } = ctx
  const g = p.distribution
  if (g.rule <= 0 || input.keeperHands !== true || input.restart !== null || input.owner.role !== "GK") return null
  const owner = input.owner
  const throws: Candidate[] = []
  const punts: Candidate[] = []
  for (const tm of input.teammates) {
    if (tm.id === owner.id || tm.sentOff) continue
    const lead = { x: tm.pos.x + tm.vel.x * 0.5, y: tm.pos.y + tm.vel.y * 0.5 }
    const d = dist(owner.pos, lead)
    if (d >= 4 && d <= g.throwMaxM) pushCandidate(ctx, throws, tm, lead, "ground", { featureAt: tm.pos, method: "throw" })
    else if (d >= g.puntMinM && d <= g.puntMaxM && (tm.role === "ST" || tm.role === "W" || tm.role === "AM")) pushCandidate(ctx, punts, tm, lead, "high", { featureAt: tm.pos, method: "punt" })
  }
  if (throws.length + punts.length === 0) return null
  const pPunt = punts.length === 0 ? 0 : throws.length === 0 ? 1 : sigmoid(g.puntLogit)
  const pool = rng.chance(pPunt) ? punts : throws
  const chosen = pool[Math.max(0, receiverPick(ctx, pool, rng))]!
  const all = [...throws, ...punts]
  const best = Math.max(...all.map((c) => c.value))
  const options = [...all].sort((a, b) => b.value - a.value).slice(0, OPTIONS_RECORDED).map(toOption)
  const chosenOption = toOption(chosen)
  const same = (o: OptionRecord) => o.receiver_id === chosenOption.receiver_id && o.target_x === chosenOption.target_x && o.target_y === chosenOption.target_y
  return {
    action: chosen.action,
    candidate: chosen,
    decisionQuality: optionQuality(ctx, chosen, best),
    xg: null,
    pressure: ctx.pressure,
    actionProbs: { short_pass: r3(1 - pPunt), long_pass: r3(pPunt) },
    options: options.some(same) ? options : [...options, chosenOption],
    chosenRank: 1 + all.filter((c) => c.value > chosen.value).length,
    fallback: false
  }
}
```

- [ ] **Step 3: Fill the keeper-distribution seam** (`step.ts`)

```ts
/** keeper_distribution's method: with distribution.rule, the real one (throw, punt, or a kick from his feet); else the old label. */
const keeperMethod = (w: Work, d: Decision): string =>
  w.p.distribution.rule > 0 ? (d.candidate?.method ?? "kick") : d.action === "short_pass" ? "throw" : "kick"

/** How a pass is struck: throw-ins and keeper throws by hand (throws more accurately), punts with more error. */
const kickStyle = (w: Work, d: Decision, restart: RestartKind | null): { technique: "throw" | "foot"; hands: boolean; errorScale: number } => {
  if (restart === "throw_in") return { technique: "throw", hands: true, errorScale: 1 }
  if (d.candidate?.method === "throw") return { technique: "throw", hands: true, errorScale: w.p.distribution.throwErrorScale }
  if (d.candidate?.method === "punt") return { technique: "foot", hands: false, errorScale: w.p.distribution.puntErrorScale }
  return { technique: "foot", hands: false, errorScale: 1 }
}
```

Run: `pnpm --filter @touchline/sim-core exec vitest run test/distribution.test.ts test/keeper.test.ts test/wide.test.ts`
Expected: PASS.

- [ ] **Step 4: Measure** (about 5 minutes)

Run: `pnpm realism --matches 16 --only passing --set distribution.rule=1 --runs out/p3-g5 --out out/p3-g5.md`

Record against the baseline: throws and punts per team-match (real 3.4 / 1.6), keeper passes per team-match (most of the real 45.4 are back passes, which are D1's), keeper open completion, ball in own third. If punts are outside 1.0–2.2 per team-match, adjust `puntLogit` by ± 0.5 once and record.

Run: `pnpm --filter @touchline/sim-core exec vitest run --no-file-parallelism && pnpm --filter @touchline/calibrate exec vitest run test/realism-gate.test.ts --disableConsoleIntercept`
Expected: PASS, drift 0.

- [ ] **Step 5: Commit**

```bash
git add packages/sim-core
git commit -m "feat(sim-core): P3 G5 — keepers throw or punt from their hands (distribution.rule); keeper_distribution method truthful, throws by hand

Before/after on seeds 2000-2015: throws <b> -> <a>, punts <b> -> <a> per team-match, keeper passes <b> -> <a>, ...

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: X2 — long-pass error, if long balls are still too easy (wave 2, off by default)

**Files:**
- Modify: `packages/sim-core/src/execute.ts` (`executeKick`), `packages/sim-core/src/params.ts` (the `longErrorPerM` line only)
- Test: `packages/sim-core/test/x2.test.ts` (new)

**Interfaces:**
- Consumes: `Params.pass.longErrorPerM`, `longErrorFromM` (Task 1); X1 merged (Task 3).
- Produces: nothing new; `executeKick` reads the two params.

- [ ] **Step 1: Write the failing test** (`packages/sim-core/test/x2.test.ts`)

```ts
import { describe, expect, it } from "vitest"
import { DEFAULT_PARAMS as P, type Params } from "../src/params.js"
import { executeKick } from "../src/execute.js"
import type { PassHeight } from "../src/classify.js"
import { Rng, seedRng } from "../src/rng.js"

const meanError = (p: Params, length: number, height: PassHeight) => {
  const r = new Rng(seedRng(4))
  let err = 0
  for (let i = 0; i < 3000; i++) err += executeKick({ from: { x: 0, y: 0 }, to: { x: length, y: 0 }, height, technique: 0.6, composure: 0.6, pressure: 0, weakFoot: false }, p, r).errorM / 3000
  return err
}
const on: Params = { ...P, pass: { ...P.pass, longErrorPerM: 0.03 } }

describe("X2: long-pass error", () => {
  it("grows for high balls beyond 30 m, by 1 + longErrorPerM per metre", () => {
    expect(meanError(on, 45, "high") / meanError(P, 45, "high")).toBeGreaterThan(1.3)
    expect(meanError(on, 45, "high") / meanError(P, 45, "high")).toBeLessThan(1.6)
  })
  it("leaves short high balls and ground passes alone, and is exact when off", () => {
    expect(meanError(on, 20, "high")).toBe(meanError(P, 20, "high"))
    expect(meanError(on, 45, "ground")).toBe(meanError(P, 45, "ground"))
  })
})
```

Run: `pnpm --filter @touchline/sim-core exec vitest run test/x2.test.ts`
Expected: FAIL on the first case (ratio 1).

- [ ] **Step 2: Implement** (`execute.ts`, the non-mis-hit branch)

```ts
  } else {
    // X2: a high ball beyond pass.longErrorFromM misses by more per metre (pass.longErrorPerM; 0 = off, exactly).
    const longScale = k.height === "high" ? 1 + p.pass.longErrorPerM * Math.max(0, intendedLen - p.pass.longErrorFromM) : 1
    ang = ang0 + g1 * e.dirSigma * pressureScale * skill * foot * longScale
    actualLen = intendedLen * (1 + g2 * e.distSigma * pressureScale * skill * foot * longScale)
  }
```

Run: `pnpm --filter @touchline/sim-core exec vitest run test/x2.test.ts test/execute-decide.test.ts`
Expected: PASS.

- [ ] **Step 3: Decide whether X2 is needed and measure** (about 15 minutes)

Measure with X1 on: `pnpm realism --matches 16 --only passing --set firstTick.rule=1 --runs out/p3-x2-0 --out out/p3-x2-0.md`

- **If `avail_30p_completion` is 0.85 or below:** X2 is not needed. Leave `longErrorPerM` 0 and record the measurement (spec: "if long passes are still too easy").
- **If it is above 0.85:** sweep `longErrorPerM` over 0.01, 0.02, 0.04 (each with `firstTick.rule=1`, concurrently, separate `--runs`), and choose the smallest value that brings it into 0.74–0.85 without pushing `avail_10_20_completion` below 0.90. `longErrorPerM` is its own switch (any non-zero value changes the engine), so `DEFAULT_PARAMS` keeps 0: record the chosen value in the commit message, and Task 10 applies it.

Run: `pnpm --filter @touchline/sim-core exec vitest run --no-file-parallelism && pnpm --filter @touchline/calibrate exec vitest run test/realism-gate.test.ts --disableConsoleIntercept`
Expected: PASS, drift 0.

- [ ] **Step 4: Commit**

```bash
git add packages/sim-core
git commit -m "feat(sim-core): P3 X2 — long-pass error for high balls beyond 30 m (pass.longErrorPerM, 0 = off); measured with X1 on: 30 m+ completion to available receivers <v> -> chosen longErrorPerM <x> (or not needed)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 9: D1 — pass choice from the real choice model (wave 2, off by default; owns the ball-upfield gap)

**Files:**
- Modify: `packages/sim-core/src/decide.ts` (**choice seam** block and one import under its marker), `packages/sim-core/src/params.ts` (`choice` values only)
- Test: `packages/sim-core/test/choice.test.ts` (new)

**Interfaces:**
- Consumes: `CandidateContext`, `defendersInLane`, `threat`, `SAFETY_PIVOT`, `softmaxPick`, `Params.choice`, `PassAction` (Task 1); X1 merged (Task 3); the D3, D4 and G5 seams merged (their options flow through this seam).
- Produces (exported from `decide.ts`):
  - `midLine(ctx: CandidateContext): number`
  - `choiceFeatures(ctx, receiver: PlayerState, at: Vec2): ChoiceCoefs`
  - `choiceUtility(ctx, receiver, at: Vec2, leadLane: number): number`
  - `choiceTemperature(ctx): number`
  - `inclusiveValue(values: ReadonlyArray<number>, T: number): number`
  - the bodies of `choiceValue`, `kindTerm`, `receiverPick`, `optionQuality`

- [ ] **Step 1: Write the failing tests** (`packages/sim-core/test/choice.test.ts`)

```ts
import { describe, expect, it } from "vitest"
import { buildCandidates, candidateContext, choiceFeatures, choiceUtility, decide, overridePass, type DecisionInput } from "../src/decide.js"
import { DEFAULT_PARAMS as P, type Params } from "../src/params.js"
import { Rng, seedRng } from "../src/rng.js"
import type { PlayerState } from "../src/types.js"
import { kickoffPlayersFor, makeConfig, STYLES } from "../src/testing.js"

const players = kickoffPlayersFor(makeConfig(1))
const at = (p: PlayerState, x: number, y: number): PlayerState => ({ ...p, pos: { x, y }, vel: { x: 0, y: 0 } })
const home = players.filter((p) => p.side === "home")
const away = players.filter((p) => p.side === "away")
const on: Params = { ...P, choice: { ...P.choice, rule: 1, kindShift: { ...P.choice.kindShift, switch: 0, long_pass: 0, lofted_through: 0 }, ivCentre: 0, temperature: 1 } }
const input = (o: Partial<DecisionInput>): DecisionInput => ({ period: "first_half", owner: home[5]!, teammates: home, opponents: away, style: STYLES.possession, scoreDiff: 0, minute: 30, restart: null, scriptBias: {}, ...o })

describe("D1: features as fitted (same fixture as test_passing.py)", () => {
  it("distance, forward, lateral, lane, openness, line-breaking and keeper at the receiver's position", () => {
    const owner = at(home[5]!, 0, 0), t1 = at(home[6]!, 10, 0), t2 = at(home[7]!, 0, 20)
    const ctx = candidateContext(input({ owner, teammates: [owner, t1, t2], opponents: [at(away[2]!, 5, 0.5), at(away[3]!, 0, 23)] }), on, 0)
    expect(choiceFeatures(ctx, t1, t1.pos)).toEqual({ dist: 1, fwd: 1, lat: 0, lane: 1, open: Math.hypot(5, 0.5) / 5, lineBreak: 0, keeper: 0 })
    expect(choiceFeatures(ctx, t2, t2.pos)).toEqual({ dist: 2, fwd: 0, lat: 2, lane: 0, open: 0.6, lineBreak: 0, keeper: 0 })
  })
  it("with ten men (7 opponent outfielders) there is no midfield line: line-breaking 0 and a finite utility", () => {
    const owner = at(home[5]!, -20, 0), far = at(home[9]!, 30, 0)
    const opp = away.map((x, i) => (i >= 1 && i <= 3 ? { ...x, sentOff: true } : at(x, 10 + i, -10 + 2 * i)))
    const ctx = candidateContext(input({ owner, teammates: [owner, far], opponents: opp }), on, 0)
    expect(choiceFeatures(ctx, far, far.pos).lineBreak).toBe(0)
    expect(Number.isFinite(choiceUtility(ctx, far, far.pos, 0))).toBe(true)
  })
  it("pressed carriers turn away from wide options", () => {
    const owner = at(home[5]!, 0, 0), near = at(home[6]!, 8, 3), wide = at(home[1]!, 0, 30)
    const gap = (pressure: number) => {
      const ctx = candidateContext(input({ owner, teammates: [owner, near, wide], opponents: [at(away[9]!, 40, 0)] }), on, pressure)
      return choiceUtility(ctx, wide, wide.pos, 0) - choiceUtility(ctx, near, near.pos, 0)
    }
    expect(gap(1)).toBeLessThan(gap(0))
  })
})

describe("D1: the two-step choice is the fitted logit", () => {
  it("with equal kind shifts and temperature 1, P(kind) is the sum of the flat softmax over that kind's options", () => {
    const keeper = at(home[0]!, -47, 0)
    const team = home.map((x, i) => (i === 0 ? keeper : at(x, -40 + 4 * i, i % 2 ? 25 : -20)))
    const neutral = { ...STYLES.possession, longBallBias: 0, crossBias: 0, riskTolerance: 0.5 }
    const opp = away.map((x, i) => at(x, 30 + i, 30))
    const owner = { ...keeper, attrs: { ...keeper.attrs, vision: 0.6 } }
    const inp = input({ owner, teammates: team.map((x) => (x.id === owner.id ? owner : x)), opponents: opp, style: neutral, restart: "goal_kick" })
    const d = decide(inp, on, new Rng(seedRng(1)))
    const cands = buildCandidates(inp, on, d.pressure)
    const m = Math.max(...cands.map((c) => c.value))
    const z = cands.reduce((s, c) => s + Math.exp(c.value - m), 0)
    for (const a of ["short_pass", "long_pass", "switch"]) {
      const flat = cands.filter((c) => c.action === a).reduce((s, c) => s + Math.exp(c.value - m) / z, 0)
      if (flat > 0) expect(d.actionProbs[a]).toBeCloseTo(flat, 2)
    }
  })
})

describe("D1: the decision record", () => {
  it("utilities can be negative; quality stays in (0, 1] for chosen and forced passes", () => {
    const r = new Rng(seedRng(2))
    for (let i = 0; i < 50; i++) {
      const d = decide(input({}), on, r)
      if (d.decisionQuality !== null) {
        expect(d.decisionQuality).toBeGreaterThan(0)
        expect(d.decisionQuality).toBeLessThanOrEqual(1)
      }
    }
    const d = decide(input({}), on, new Rng(seedRng(3)))
    const forced = overridePass(d, input({}), { receiverId: home[2]!.id }, on)
    if (forced.forced) {
      expect(forced.decisionQuality!).toBeGreaterThanOrEqual(0)
      expect(forced.decisionQuality!).toBeLessThanOrEqual(1)
    }
  })
})
```

Run: `pnpm --filter @touchline/sim-core exec vitest run test/choice.test.ts`
Expected: FAIL: `choiceFeatures` is not exported.

- [ ] **Step 2: Fill the choice seam** (`decide.ts`)

Under the marker `// ---- P3 imports, choice seam ...` add `import type { ChoiceCoefs, PassAction } from "./params.js"`. The seam body becomes:

```ts
/** The opponents' midfield line in the passer's frame: mean u of their 5th-8th deepest outfielders; NaN with fewer than 8. */
export const midLine = (ctx: CandidateContext): number => {
  const us = ctx.input.opponents.filter((o) => !o.sentOff && o.role !== "GK").map((o) => attackX(ctx.side, o.pos.x, ctx.period)).sort((a, b) => b - a)
  return us.length >= 8 ? (us[4]! + us[5]! + us[6]! + us[7]!) / 4 : NaN
}

const midLines = new WeakMap<CandidateContext, number>()
const midLineOf = (ctx: CandidateContext): number => {
  let m = midLines.get(ctx)
  if (m === undefined) {
    m = midLine(ctx)
    midLines.set(ctx, m)
  }
  return m
}

/** The real choice model's features (carrier-report C3) for a pass to `receiver`, measured at `at`, in the passer's frame. */
export const choiceFeatures = (ctx: CandidateContext, receiver: PlayerState, at: Vec2): ChoiceCoefs => {
  const owner = ctx.input.owner
  const du = (at.x - owner.pos.x) * ctx.dir
  const dv = at.y - owner.pos.y
  let open = 99
  for (const o of ctx.input.opponents) if (!o.sentOff) open = Math.min(open, dist(o.pos, at))
  const ml = midLineOf(ctx)
  const pu = attackX(ctx.side, owner.pos.x, ctx.period)
  const tu = attackX(ctx.side, at.x, ctx.period)
  return {
    dist: Math.hypot(du, dv) / 10,
    fwd: du / 10,
    lat: Math.abs(dv) / 10,
    lane: defendersInLane(owner.pos, at, ctx.input.opponents) > 0 ? 1 : 0,
    open: Math.min(open, 10) / 5,
    lineBreak: Number.isFinite(ml) && pu < ml && tu > ml ? 1 : 0,
    keeper: receiver.role === "GK" ? 1 : 0
  }
}

const FEATURES = ["dist", "fwd", "lat", "lane", "open", "lineBreak", "keeper"] as const

/** Utility of a pass: the fitted coefficients, moving with pressure about the real mean, plus leadLane for a blocked aim. */
export const choiceUtility = (ctx: CandidateContext, receiver: PlayerState, at: Vec2, leadLane: number): number => {
  const c = ctx.p.choice
  const x = choiceFeatures(ctx, receiver, at)
  let u = leadLane > 0 ? c.leadLane : 0
  for (const k of FEATURES) u += (c.base[k] + c.press[k] * (ctx.pressure - c.pressCentre)) * x[k]
  return u
}

/** Receiver-choice temperature: choice.temperature at the league's mean vision (0.6), sharper for better passers. */
export const choiceTemperature = (ctx: CandidateContext): number => Math.max(0.05, (ctx.p.choice.temperature * (1.4 - ctx.input.owner.attrs.vision)) / 0.8)

/** Inclusive value T log sum exp(U / T) of a non-empty set of utilities. */
export const inclusiveValue = (values: ReadonlyArray<number>, T: number): number => {
  const m = Math.max(...values)
  return m + T * Math.log(values.reduce((s, v) => s + Math.exp((v - m) / T), 0))
}

/** An option's value: the D1 utility (features at `featureAt`, the lane to the aimed point), or the old expected-threat value. */
const choiceValue = (ctx: CandidateContext, receiver: PlayerState, target: Vec2, featureAt: Vec2, lane: number, xp: number): number => {
  if (ctx.p.choice.rule <= 0) return xp * (0.3 + threat(ctx.side, ctx.period, target)) - (1 - xp) * 0.3 * (1 - ctx.ownerThreat)
  return choiceUtility(ctx, receiver, featureAt, lane)
}

/**
 * Extra logit for pass kind `a`. D1: a nested logit, so the kind sits at the pass family's level (the zone's short_pass
 * logit) plus its fitted shift plus the inclusive value of its options. Old engine: the safety lean.
 */
const kindTerm = (ctx: CandidateContext, candidates: ReadonlyArray<Candidate>, a: Action, base: Readonly<Record<Action, number>>): number => {
  const c = ctx.p.choice
  if (c.rule <= 0) {
    const sw = ctx.p.pass.safetyWeight
    if (sw <= 0) return 0
    let best = -Infinity
    for (const x of candidates) if (x.action === a && x.xpass > best) best = x.xpass
    return Number.isFinite(best) ? sw * (best - SAFETY_PIVOT) : 0
  }
  const values = candidates.filter((x) => x.action === a).map((x) => x.value)
  if (values.length === 0) return 0
  return base.short_pass - base[a] + c.kindShift[a as PassAction] + c.inclusive * (inclusiveValue(values, choiceTemperature(ctx)) - c.ivCentre)
}

/** Index of the chosen option among `options` (all of the chosen kind): softmax(U / T) under D1, else the old rule. */
const receiverPick = (ctx: CandidateContext, options: ReadonlyArray<Candidate>, rng: Rng): number => {
  if (ctx.p.choice.rule > 0) {
    const T = choiceTemperature(ctx)
    return softmaxPick(options.map((c) => c.value / T), rng)
  }
  const temp = ctx.p.pass.choiceTemperature * (1.4 - ctx.input.owner.attrs.vision)
  return softmaxPick(options.map((c) => c.value / Math.max(0.05, temp)), rng)
}

/** Quality of the chosen option: exp((U - U_best) / T) under D1 (utilities can be negative), else chosen / best value. */
const optionQuality = (ctx: CandidateContext, chosen: Candidate, best: number): number => {
  if (ctx.p.choice.rule > 0) return Math.max(0, Math.min(1, Math.exp((chosen.value - best) / choiceTemperature(ctx))))
  return best > 0 ? Math.max(0, Math.min(1, chosen.value / best)) : 1
}
```

Run: `pnpm --filter @touchline/sim-core exec vitest run test/choice.test.ts test/backpass.test.ts test/passing.test.ts test/execute-decide.test.ts test/whatif.test.ts`
Expected: PASS.

- [ ] **Step 3: First measurement with X1 on, and the no-double-count check** (about 5 minutes)

Run: `pnpm realism --matches 16 --only passing --set firstTick.rule=1,choice.rule=1 --runs out/p3-d1-0 --out out/p3-d1-0.md`

Compare the refit table against the real intervals. This is the P2 lesson (the refit there double-counted the engine's own lag): with this engine's own pipeline the refit should land near the coefficients the engine uses (ruling 5). A coefficient far from its input value points at a mechanism, not at calibration:
- **lateral much above +0.18:** the action stage still favours switches → `kindShift.switch` (next step);
- **keeper well below +0.95:** ruling 20 (keepers beyond 30 m are never offered) or few keepers in the window;
- **distance or openness at half their input:** check that `featureAt` reaches `choiceValue` (current positions, not the lead).

Record the seven coefficients and the shares (switch, tight, back to the keeper, most forward), passes per match and **ball in own third / ball u** (this task owns that gap).

- [ ] **Step 4: Fit `ivCentre` and the kind shifts** (about 25 minutes; each round's runs concurrently, separate `--runs`)

1. `ivCentre`: from the first run, read passes per match. Try `choice.ivCentre` 1 and 2 (with `firstTick.rule=1,choice.rule=1`). Keep the value whose passes per match is nearest the X1-only run from Task 8's measurement (`out/p3-x2-0.md` if present; else run `--set firstTick.rule=1` once): the inclusive value should not add or remove passing by itself.
2. `kindShift.switch` over −1.5, −1, −0.5 (and the chosen `ivCentre`): pick the one with `switch_share` nearest 0.061 (band 0.04–0.08).
3. `kindShift.long_pass` and `kindShift.lofted_through` together over −0.5, 0, 0.5: pick the one with `long_share` nearest 0.143 (0.12–0.17).
4. Confirm with one run of the chosen values. If `completion` or `near1_completion` fell clearly, try `choice.leadLane=-0.3` once and keep it only if the refit's lane coefficient stays within its interval.

Set the chosen `ivCentre`, `kindShift` and (if used) `leadLane` in `DEFAULT_PARAMS.choice` (rule stays 0). Also run all P3 behaviours on once, for Task 10's starting point:

`pnpm realism --matches 16 --only passing --set firstTick.rule=1,choice.rule=1,release.rule=1,cross.rule=1,through.rule=1,distribution.rule=1 --runs out/p3-all --out out/p3-all.md`

Run: `pnpm --filter @touchline/sim-core exec vitest run --no-file-parallelism && pnpm --filter @touchline/calibrate exec vitest run test/realism-gate.test.ts --disableConsoleIntercept`
Expected: PASS, drift 0.

- [ ] **Step 5: Commit**

```bash
git add packages/sim-core
git commit -m "feat(sim-core): P3 D1 — pass choice from the real conditional logit (choice.rule): fitted coefficients with pressure terms, features at the receiver's position, nested-logit kind stage with inclusive values, keeper as a normal option; kindShift switch <s>, long <l>, ivCentre <c>

With X1 on, seeds 2000-2015: refit dist <b>, fwd <b>, lat <b>, lane <b>, open <b>, lb <b>, GK <b> (real intervals ...); switches <b> -> <a>, back to keeper <b> -> <a>, most forward <b> -> <a>, ball in own third <b> -> <a>, passes <b> -> <a>. All P3 on: ...

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 10: Switch on, retire inert knobs, recalibrate, gate, re-pin, record the results (wave 3)

**Files:**
- Modify:
  - `packages/sim-core/src/params.ts`: the six `rule` switches (and `pass.longErrorPerM` if Task 8 chose a value)
  - `packages/sim-core/test/params.test.ts`: the P3 "ship switched off" case becomes "ship switched on"
  - `packages/calibrate/src/knobs.ts`
- Create: `packages/sim-core/test/passing-targets.test.ts`
- Regenerate:
  - `data/params/touchline-params.json`, `data/params/realism-baseline.json`
  - `docs/realism/realism-report.md`, `docs/realism/realism-deep-report.md`
  - the stats and manager goldens
  - the seed pins in `services/agents/tests/conftest.py`, `packages/agent-gateway/test/e2e.test.ts`, and any sim-core or calibrate test whose documented rule picks a seed (`whatif.test.ts`, `wide.test.ts` CLAIM_SEEDS, `carriers.test.ts` parity seed)
- Modify: `docs/superpowers/specs/2026-10-13-sim-realism-v2-design.md` (add `## Results: P3 (date)`)

**Interfaces:**
- Consumes: everything above; the values each task recorded in its commit message.
- Produces:
  - knobs `long_shift`, `switch_shift`, `cross_shift`, `choice_temp`, `iv_centre`
  - knobs `long_bias`, `cross_bias`, `pass_pc_weight`, `pass_safety` removed (inert under D1)

- [ ] **Step 1: Switch the behaviours on** (`DEFAULT_PARAMS`)

`firstTick.rule: 1`, `choice.rule: 1`, `release.rule: 1`, `cross.rule: 1`, `through.rule: 1`, `distribution.rule: 1`; and `pass.longErrorPerM` to the value Task 8 recorded (stay 0 if it found X2 not needed). In `params.test.ts`, the P3 case's loop becomes `expect(rule).toBe(1)` and its title "ship switched on, ..."; say so in the commit message.

- [ ] **Step 2: Update the knobs** (`packages/calibrate/src/knobs.ts`)

Delete the `long_bias`, `cross_bias`, `pass_pc_weight` and `pass_safety` knobs. Import `type PassAction` from `@touchline/sim-core`. Add next to `shiftLogits`:

```ts
/** The D1 kind shifts of `kinds` moved by v (on top of the shifts Task 9 fitted into DEFAULT_PARAMS). */
const shiftKinds = (p: Params, kinds: ReadonlyArray<PassAction>, v: number): Params => ({
  ...p,
  choice: { ...p.choice, kindShift: { ...p.choice.kindShift, ...Object.fromEntries(kinds.map((k) => [k, p.choice.kindShift[k] + v])) } }
})
```

and, after `shot_bias`:

```ts
  { name: "long_shift", what: "pass-choice shift for long passes and lofted through balls (long-pass share)", init: 0, min: -2, max: 2, step: 0.5,
    apply: (p, v) => shiftKinds(p, ["long_pass", "lofted_through"], v) },
  { name: "switch_shift", what: "pass-choice shift for switches of play", init: 0, min: -2, max: 2, step: 0.5,
    apply: (p, v) => shiftKinds(p, ["switch"], v) },
  { name: "cross_shift", what: "pass-choice shift for crosses and cut-backs (corners, crosses)", init: 0, min: -2, max: 2, step: 0.5,
    apply: (p, v) => shiftKinds(p, ["cross", "cutback"], v) },
  { name: "choice_temp", what: "receiver-choice temperature (how often passers pick a lesser option; completion)", init: DEFAULT_PARAMS.choice.temperature, min: 0.6, max: 1.6, step: 0.2,
    apply: (p, v) => ({ ...p, choice: { ...p.choice, temperature: v } }) },
  { name: "iv_centre", what: "passing against carrying and holding (passes per match)", init: DEFAULT_PARAMS.choice.ivCentre, min: -2, max: 4, step: 0.5,
    apply: (p, v) => ({ ...p, choice: { ...p.choice, ivCentre: v } }) },
```

Run: `pnpm typecheck && pnpm --filter @touchline/calibrate exec vitest run test/tune.test.ts`
Expected: PASS ("every knob changes the parameters" holds for the new knobs).

Run: `pnpm --filter @touchline/sim-core exec vitest run --no-file-parallelism`
Expected: PASS. **If a sim-core test asserts an exact statistic that the P3 behaviours move** (passing, wide, keeper, letrun and others), check the new value is football-plausible before updating the expectation, and name each one and why in the commit message. Never loosen a real-target bound.

- [ ] **Step 3: Recalibrate** (about 30 minutes with the parallel tuner; run it in the background)

Run: `pnpm calibrate --from data/params/touchline-params.json --out data/params/touchline-params.json --matches 24 --rounds 1`

The file's `long_bias`, `cross_bias`, `pass_pc_weight` and `pass_safety` values are ignored (no longer knobs). Expected: it ends with `wrote …: loss <n>`. Record the loss and every knob that moved, especially the five new ones and `decision_scale`.

- [ ] **Step 4: Re-baseline and run the gate**

Run: `UPDATE_REALISM_BASELINE=1 pnpm --filter @touchline/calibrate exec vitest run test/realism-gate.test.ts --disableConsoleIntercept`
Then: `pnpm --filter @touchline/calibrate exec vitest run test/realism-gate.test.ts --disableConsoleIntercept`
Expected: PASS, held-out loss < 30.

**If the loss is 30 or more, STOP.** Report the loss and the statistics with the largest |z| to the user. `GATE_LOSS` 30 is never widened. The spec's splitting rule applies and the user chooses what moves to P4. A natural order to offer, keeping X1 and D1:
1. `through.rule` 0;
2. then `cross.rule` 0;
3. then `release.rule` 0.

- [ ] **Step 5: Add the real-target test** (`packages/sim-core/test/passing-targets.test.ts`)

```ts
import { readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "vitest"
import { initMatch, isFinished, paramsFromJson, step, type DomainEvent } from "../src/index.js"
import { makeConfig } from "../src/testing.js"

// P3 targets on the calibrated parameters, 4 matches. Those that hold are plain tests; those not met yet are it.fails,
// unwidened, with the measured value: each flips (and fails the suite) once it is met, and then moves back to a plain test.
const root = join(dirname(fileURLToPath(import.meta.url)), "../../..")
const params = paramsFromJson(JSON.parse(readFileSync(join(root, "data/params/touchline-params.json"), "utf8")))
const SEEDS = [7, 9, 11, 13]

interface M { open: number; bootDeaths: number; switches: number; passes: number; toKeeper: number; crosses: number; punts: number; pressed: number[] }

const measure = (seed: number): M => {
  const cfg = makeConfig(seed, { params })
  const role = new Map([cfg.home, cfg.away].flatMap((t) => [...t.starters, ...(t.bench ?? [])]).map((p) => [p.id, p.role]))
  let s = initMatch(cfg)
  const events: DomainEvent[] = []
  const near = new Map<string, number>()
  while (!isFinished(s)) {
    const r = step(s)
    s = r.state
    for (const e of r.events) {
      if (e.type !== "reception" || e.attrs.first_touch !== "controlled") continue
      const me = s.players.find((x) => x.id === e.player_id)!
      near.set(e.id, Math.min(...s.players.filter((x) => x.side !== me.side && !x.sentOff).map((x) => Math.hypot(x.pos.x - me.pos.x, x.pos.y - me.pos.y))))
    }
    events.push(...r.events)
  }
  const m: M = { open: 0, bootDeaths: 0, switches: 0, passes: 0, toKeeper: 0, crosses: 0, punts: 0, pressed: [] }
  let lastSetPiece = -Infinity
  events.forEach((e, i) => {
    if (e.type === "set_piece") lastSetPiece = e.frame_id
    if (e.type === "keeper_distribution" && e.attrs.method === "punt") m.punts++
    if (e.type === "reception" && (near.get(e.id) ?? 99) < 2) {
      const next = events.slice(i + 1).find((g) => g.type === "pass" || g.type === "possession_change")
      if (next?.type === "pass" && next.player_id === e.player_id && !next.attrs.restart) m.pressed.push((next.frame_id - e.frame_id) * cfg.dt)
    }
    if (e.type !== "pass") return
    m.passes++
    const to = e.attrs.intended_receiver_id
    if (typeof to === "string" && role.get(to) === "GK" && role.get(e.player_id!) !== "GK") m.toKeeper++
    if (e.attrs.restart) return
    m.open++
    if (e.outcome === "intercepted" && e.frame_id_end! - e.frame_id <= 1 && Math.hypot(e.x_end! - e.x!, e.y_end! - e.y!) < 1) m.bootDeaths++
    if (e.y_end !== null && Math.abs(e.y_end - e.y!) > 25) m.switches++
    if (e.attrs.kind === "cross" && (e.frame_id - lastSetPiece) * cfg.dt > 10) m.crosses++
  })
  return m
}

let all: M[] | undefined
const ms = () => (all ??= SEEDS.map(measure))
const sum = (k: Exclude<keyof M, "pressed">) => ms().reduce((s, m) => s + m[k], 0)
const median = (v: number[]) => [...v].sort((a, b) => a - b)[Math.floor(v.length / 2)]!

describe("P3 real-data targets on the calibrated parameters (4 matches)", () => {
  it("passes rarely die at the passer's boot (X1; real 0, at most 1 %)", () => {
    expect(sum("bootDeaths") / sum("open")).toBeLessThanOrEqual(0.01)
  }, 600_000)
  it("switches are about 6 % of open-play passes (D1; 4-8 %)", () => {
    const v = sum("switches") / sum("open")
    expect(v).toBeGreaterThanOrEqual(0.04)
    expect(v).toBeLessThanOrEqual(0.08)
  }, 600_000)
  it("about 6 % of passes go back to the keeper (D1, G5a; 4.5-8 %)", () => {
    const v = sum("toKeeper") / sum("passes")
    expect(v).toBeGreaterThanOrEqual(0.045)
    expect(v).toBeLessThanOrEqual(0.08)
  }, 600_000)
  it("about 15 open-play crosses per match (D3; 12-18)", () => {
    const v = sum("crosses") / SEEDS.length
    expect(v).toBeGreaterThanOrEqual(12)
    expect(v).toBeLessThanOrEqual(18)
  }, 600_000)
  it("about 1.6 punts per team-match (G5; 1.0-2.2)", () => {
    const v = sum("punts") / (2 * SEEDS.length)
    expect(v).toBeGreaterThanOrEqual(1.0)
    expect(v).toBeLessThanOrEqual(2.2)
  }, 600_000)
  it("pressed receivers release quickly (D2; median 0.2-0.7 s)", () => {
    const v = median(ms().flatMap((m) => m.pressed))
    expect(v).toBeGreaterThanOrEqual(0.2)
    expect(v).toBeLessThanOrEqual(0.7)
  }, 600_000)
})
```

Run: `pnpm --filter @touchline/sim-core exec vitest run test/passing-targets.test.ts`
For each case that fails, change `it(` to `it.fails(`, prefix its title with `NOT MET:` and add a comment line above it with the measured value. Do not change any bound. Run again: Expected PASS.

- [ ] **Step 6: Deep report and the committed reports**

Run: `pnpm realism --matches 64 --out docs/realism/realism-deep-report.md` (tens of minutes)
Run: `pnpm realism --out docs/realism/realism-report.md --matches 16`

From the deep report's passing section, record every row (MET / NOT MET) and the refit table; also C3, discipline, the physical bands and territory, compared with Results: P2. From the 16-match report record C1, C2 and C4.

Manager A/B for information (no LLM needed): `pnpm managers:ab --arms none,rules --seeds 40 --out out/p3-ab --runs out/p3-ab-runs`; record the headline from `out/p3-ab/manager-ab.md`.

- [ ] **Step 7: Re-pin the seed-pinned fixtures and the goldens**

```bash
uv run --project services/agents python services/agents/scripts/find_test_seed.py 1 1400
uv run --project services/agents python services/agents/scripts/find_test_seed.py --general 1 100
```

Update `ERROR_SEED` and `SEED` in `services/agents/tests/conftest.py` and the seed in `packages/agent-gateway/test/e2e.test.ts`, as P2's re-pin commit did. Re-pick any sim-core or calibrate seed that now fails by the rule written next to it (`whatif.test.ts` forced window, `wide.test.ts` CLAIM_SEEDS, `carriers.test.ts` parity seed), never by loosening the assertion. Regenerate the goldens and check the diffs are plausible (same match fields, xG and PPDA at similar magnitudes):

```bash
UPDATE_STATS_GOLDEN=1 pnpm --filter @touchline/stats exec vitest run test/replay.test.ts
UPDATE_GOLDEN=1 pnpm --filter @touchline/manager exec vitest run test/situation.test.ts
```

- [ ] **Step 8: Run everything**

Run: `pnpm test -- --no-file-parallelism && pnpm typecheck && uv run --project python/analytics pytest python/analytics/tests && uv run --project services/agents pytest services/agents/tests`
Expected: PASS. The agent decision-log replay tests (manager, agent-gateway, services/agents) are part of this run.

- [ ] **Step 9: Record the results and commit**

Add `## Results: P3 (YYYY-MM-DD)` to the v2 spec, in the style of "Results: P2":
- **Switched on:** the six switches and every value the tasks set (boot-block share, release tail, cross values, punt logit, kind shifts, `ivCentre`, `leadLane`, `longErrorPerM` or "X2 not needed").
- **Deviations:** the planning rulings above that changed the spec (2, 5–10, 13, 16) and anything a task changed on measurement.
- **Calibration:** the run, its loss, the knobs that moved, the retired knobs.
- **Gate:** held-out loss, within-1 and within-2 SD counts, maxDrift.
- **P3 targets** (64 matches, deep report): every passing row with MET / NOT MET; the choice-model refit, each coefficient against its interval; the per-task before/after numbers.
- **P2's carried problems:** passes per match (owner D2) and ball in own third / ball u (owner D1), each MET / NOT MET.
- **C1–C4, physical bands, territory, discipline** against Results: P2.
- **Real-target tests:** which are `it.fails`, with the measured values.
- **Manager A/B:** the headline, for information.
- **Gaps outside P3:** for example crosses needing box occupancy (P5 A6, S1), keeper free kicks (P5 G3), tight receivers and marking (P4 A5).

Mark each item MET or NOT MET honestly.

```bash
git add packages data docs services
git commit -m "feat: realism v2 P3 on — first-tick fix and boot blocks, release timing by pressure, crosses to zones, through balls into space, keeper throws and punts, pass choice from the real choice model; inert knobs retired; recalibrated, re-baselined, fixtures re-pinned

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

Merge locally into main (`git -C ../../touchline merge --no-ff realism-v2-p3`) only after the user has seen the results. After merging, regenerate the run folders under `out/` in the main checkout, as the P1 merge checklist lists (`pnpm library` needs the agent service).

---

## Self-review

**Spec coverage.**
- X1 first-tick fix → Task 3 (geometry tests directly away / through him; ruling 2 for the disc conflict); boot blocks via `deflect.ts`, calibrated to ~70 % → Task 3 Step 6. Order first → wave 1, merged first; D1 in wave 2.
- X2 re-measure and `pass.longErrorPerM` → Task 8, conditional as the spec says.
- D1 utility (distance, openness, lateral, lane at release, forward, pressure interaction), lanes at release and lead point, pitch-control share, two-step choice kept with refitted switch/long logits, keeper G5a, targets (refit in CI, switches, tight, keeper share, most forward) → Task 9 (rulings 5–12), measured by Task 2's section, checked in Task 10.
- D2 → Task 4. D3 → Task 5. D4 → Task 6 (ruling 16 for the missing overlap intent). G5 (throw, punt, at-feet normal, targets) → Task 7 and Task 2's keeper rows.
- "Tests and checks": X1 geometry tests (Task 3); choice-model refit, switch share, keeper share, crosses per match (Task 2 section, Task 9, Task 10 Step 5); agent decision-log replay tests (Task 10 Step 8); manager A/B (Task 10 Step 6).
- Conventions: worktree and branch (Setup); determinism (two named streams); switches; metric convention (ruling 17); agents' log compatibility (ruling 11); exit checks (Task 10); splitting (Task 10 Step 4).
- Evaluation changes: realism:deep gains the pass-choice aggregates (Task 2); targets in `targets-idsse.json` (Task 2).
- P2's carried problems: passes → Task 4, ball upfield → Task 9 (ruling 18), measured in every task.
- Shot model untouched: no task touches `shot.ts`, `xgOf`, the shot logit or `releaseShot`. P4/P5 untouched.

**Placeholder scan.** Code steps carry full code. The only `<...>` markers are in commit-message templates, filled from that task's own measurement step (named as outputs, not gaps).

**Type consistency.** `CandidateContext`, `pushCandidate`, `PushOptions`, `CrossOption`, `ThroughOption`, `ChoiceCoefs`, `PassAction`, `releaseDelayS`, `bootBlocker`, `outrightAtBoot`, `kickStyle`, `keeperMethod`, `releaseDelayTicks`, `bootBlock`, `receiverPick`, `optionQuality`, `kindTerm`, `choiceValue` keep the same names and signatures across Tasks 1 and 3–10. `Candidate.method` and `DecisionInput.keeperHands` are defined in Task 1 and read in Task 7. The `passing` targets keys in Task 2's table, JSON and `summarize` match.

**Review Focus.** Each of the five lines has its test: dt 0.04 (Task 3 "holds at 25 Hz", Task 4 "5-18 ticks"), keeper at a restart (Task 7 second case), ten men (Task 9), forced pass quality (Task 9), second half and left touchline (Task 5 mirror, Task 6 mirror).

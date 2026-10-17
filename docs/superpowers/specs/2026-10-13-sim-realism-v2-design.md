# Simulation realism v2: design

Agreed with the user on 2026-10-13, after the real-vs-sim analysis of positioning, movement, passing, duels, the keeper, set pieces, physical output and match dominance. The evidence is in `touchline-worktrees/analysis-positioning/` (outside the repo, aggregates only), summarised in its `SYNTHESIS.md`; this spec names the report behind each change.

## Goal

Make `packages/sim-core` play like real football in the places the analysis found it furthest off, judged by the realism contract (`2026-10-07-sim-realism-contract.md`, C1–C5, with C3 restated below) and the replay.

**Root cause.** Off-ball players follow one rigid template that snaps to the ball and is chased at near sprint speed. Its consequences:

- wrong shape (in/out depth inverted, forwards don't drop, back line too deep in possession);
- players 1.46× too fast in live play (49.8 sprints per 90 against 8.4);
- one team dominating every fixture (the `lineHeight` block offset);
- the keeper's team collapsing into its own box.

Execution and decision flaws compound it:

- the first-tick interception rule;
- pass choice that ignores pressure;
- no first-time shots or headers;
- flat foul and card rates;
- no set-piece shapes.

## Decisions (user, 2026-10-13)

| Topic | Decision |
|---|---|
| Packaging | One spec; six phases, each with its own implementation plan, branch, recalibration and merge |
| Gate | The realism gate is green (loss < `GATE_LOSS` 30) at every phase merge; main always works for agents and the web app |
| Positioning model | Option 1: a per-role rule table fitted to real data, with formation offsets and small style terms (not a lookup of real positions, not a retune of the template) |
| Sensitive code | All approved in principle: first-tick interception fix (`resolve.ts`), pass choice (`decide.ts`), shot model, keeper and aerial execution (`execute.ts`/`resolve.ts`) |
| C3 | Restated as team shot-share spread ≤ 0.18 on ≥ 64 matches (was: shots-per-match SD ≤ 5) |
| Phase order | P1 → P6 as below |

## Conventions for every phase

- **Branches.** Worktree and branch from current main; merge back locally once the exit checks pass.
- **Determinism.** The engine stays deterministic for a seed. New random behaviour (drift, joining, cautions) draws from its own named RNG stream, so existing streams keep their sequences.
- **Switches.** Each behaviour lands behind a params switch (off = old behaviour). The phase's calibration step switches it on, so the old baseline stays testable during the phase.
- **Metrics.** Shared definitions between Python and TypeScript keep the existing parity convention: `metrics.py` plus a TS port and a parity test. Only aggregate real statistics are committed.
- **Agents.** The decision log format, `overridePass` and the recorded options stay compatible.
- **Exit checks.**
  - Tuner recalibration (`packages/calibrate`); gate green.
  - `pnpm test -- --no-file-parallelism` green.
  - Seed-pinned fixtures re-pinned with `find_test_seed.py`; `data/params/realism-baseline.json` updated.
  - `realism:deep` (below) run and its results recorded in the phase's plan.
- **Splitting.** If a phase can't get the gate green, the green part merges and the rest moves into the next phase's plan.

## Evaluation changes (built in P1)

- **`pnpm realism:deep`.** Simulates 64 held-out seeds and reports:
  - team shot-share spread (C3): per match, home shots / (home + away); SD over matches;
  - penalties and sendings-off per match;
  - from P2 on: physical bands (walk, jog, run, high-speed, sprint distance; sprints; accelerations > 2.5 m/s²; live and dead m/min);
  - as later phases add them: the transition, keeper, set-piece, pass-choice and shot-type aggregates named in their phases.

  The definitions come from the analysis scripts and are ported into `packages/calibrate`.
- **Real targets.** Aggregate real targets for these go into `data/params/targets-idsse.json`.
- **Gate.** The gate test keeps its 16 seeds for speed.
- **Contract.** C3 in the realism contract is reworded to the shot-share measure.

## P1: correctness and cheap wins (no sensitive files)

**T6: teams switch ends at half-time** (`tackles-report.md`)

- `dirOf(side)` becomes `dirOf(side, period)` (`geometry.ts:19`); `attackX` and the other direction helpers take the period too.
- Hard-coded directions move onto the helper: `step.ts` goal crediting (:662, :981), corner vs goal kick (:322-325), half-time restart (:1207-1214), and `runner.ts:88`.
- Frames and events carry each team's attack direction per period.
- Readers stop assuming home attacks +x and use that field instead: `stats/engine.ts`, `stats/derive.ts`, `cdf.ts`, `spadl.ts`, `apps/api/src/whatif.ts`, `advisor/value.ts`. Calibrate and the Python metrics already read direction from the data.
- **Test.** A full match where every goal is credited correctly in both halves, and each team's second-half attacking third is at the other end.

**G1/G2: the keeper with the ball** (`gk-report.md`)

- Keeper possession is either *in hands* (held saves, claims, catches) or *at feet* (back passes, loose balls).
- The hold (`step.ts:809`, `keeperHoldS` 4) applies only in hands, drawn from 5–12 s. At feet he uses the normal decision delay.
- At feet he loses the tackle exemption (`step.ts:875`).
- Pressing (`step.ts:1081-1090`):
  - skips a keeper with the ball in his hands;
  - at feet, a press-rate multiplier is calibrated so an opponent is within 5 m at release about 12.6 % of the time (sim now 85 %).
- **Test.**
  - No opponent within 5 m of a keeper with the ball in his hands.
  - The share of shots within 20 s of the conceding team's keeper distribution falls from 25 % toward about 10 % (real 7.6 %).

**T1: cards** (`tackles-report.md`)

- A new `defending.cautionPerMatch` of about 1.7 gives non-foul bookings at random times (Poisson, own RNG stream).
- A booked player is about half as likely to commit a foul, and is booked for one at 0.6× the normal rate.
- The tuner refits `yellowPerFoul`: it now sits at 0.375, because non-foul cards don't exist; expect about 0.15.
- **Target.** About 5 yellows and 0.2–0.3 sendings-off per match (now 0.89).

**T5 and C3.** Build `realism:deep`, add the shot-share measure, reword C3, and judge penalties only on ≥ 64 matches (0.44 against 0.43 real on 80 matches).

## P2: positioning core (no sensitive files)

**New module `anchor.ts`** (`fit-report.md`, `offball-report.md`, `transitions-report.md`, `dominance-report.md`, `physical-report.md`)

- It replaces the body of `anchorFor` in `shape.ts`. `shape.ts` keeps `FORMATIONS` and `kickoffAnchor`, and the call signature stays.
- It keeps a small per-team state (possession age, a 2 s ball ring buffer, drift processes) in the game state.

**A1: per-role rule table.** New params block `positioning.roles[role][phase]`, in the team frame (u along the attack, metres). Starting values are the real fits; the tuner may adjust them.

| Role | a in / out | b in / out |
|---|---|---|
| GK | −31.6 / −42.0 | 0.31 / 0.25 |
| CB | −8.6 / −22.5 | 0.64 / 0.46 |
| FB | 4.6 / −19.5 | 0.59 / 0.48 |
| WB | 8.7 / −18.0 | 0.59 / 0.51 |
| CM | 5.3 / −12.7 | 0.61 / 0.56 |
| AM | 13.2 / −4.5 | 0.57 / 0.62 |
| W | 15.4 / −8.8 | 0.54 / 0.59 |
| ST | 19.6 / 2.7 | 0.53 / 0.59 |

**Re-fit (Task 7c, 2026-10-14).** The first table (GK −34.4 / −39.9, CB −12.0 / −18.5, FB −1.7 / −14.0, CM 1.5 / −8.0,
AM 8.6 / −0.2, W 10.3 / −2.9, ST 16.0 / 7.2) regressed positions on the *current* ball over *all* frames of each
possession phase. That double-counts the engine's own mechanics: the engine reads the ball 2 s ago and blends rows after
every switch, and the all-frames fit had both already baked in, so the engine pulled every row toward the middle twice.
The re-fit regresses on the ball 2 s earlier and uses only frames 8 s or more after the team's last row switch; τ was
re-fitted in the engine's own blend form against the new rows (below). Closed-form validation on the real phase sequences
(engine model, no sim; real +3.90 / −9.52 in / out of possession):

- old table, engine model (lag + blend, old τ): +0.41 / −5.36;
- new table, old τ: +1.71 / −7.86;
- **new table, new τ: +3.38 / −9.60** (+3.13 / −9.71 with the forward-line and vs-keeper caps);
- per-role mean depth error: old −2.4 to −5.7 in, +2.7 to +6.5 out; new −0.1 to −1.0 in, −0.3 to +0.8 out.

The lateral w0 of the in and out rows were re-fitted too (with the ball settled shapes are wider). The `gk` rows take the
re-fitted depth intercepts (CB −30.5, FB −17.5, WB −15.9, CM −15.5, AM −3.6, W −2.9, ST 4.3) but keep their old widths
(w0 CB 15.5, FB 27, WB 27, W 12.4, CM 2.7): the blend-inversion widths are low-confidence (short holds and claims from
`out`, where the spread ramp barely starts), and widths do not move the depth centroid.
Task 8b moved the FB `gk` depth from the re-fitted −17.5 to the G4 value −13: at −17.5 the full-backs sat on the
defensive-third counting threshold and the deep count stayed at 7 (real 3).

- **Depth:** `u = a[phase] + b[phase]·bu + slotOffset + style`.
- **Lateral:** `s = w0 + w1·bu + w2·bs + w3·|by|`, with the coefficients per role and phase from `fit.json` (`lat_central`).
- **Slot offsets.** Formation slots give the within-role offsets: each slot's x re-centred on its role's mean.
- **Keeper.** He follows the ball's angle; inside 25 m of his goal he holds 1.5–2.5 m off the line (real 2.2 m; sim now 4.0 m).
- **Style.**
  - `lineHeight` shifts the shape only out of possession, by ±3 m; in possession it has no effect. This removes the dominance mechanism: block offset ±6.4 m × slide 0.5.
  - `compactness` scales the out-of-possession `w0`.
  - Orders and agents keep setting `lineHeight` and `compactness`.
- **Retired settings.** `shape.defLineM` and `shape.fwdDropM` are removed (params, `knobs.ts`, `shape.test.ts`), in the same step that switches the rule table on; until then the old template is the switch-off path. `shape.width` and `shape.depth` remain as tunable multipliers.
- **Target.** The in-possession centroid sits about 4 m ahead of the ball (sim now 7 m behind).

**G4: build-up shape.** A third phase row, `gk`, applies while our keeper has the ball and blends out on release at the A2 rate.

- CBs at u −30, split 31 m.
- FBs at u −13.
- About 3 outfielders in the defensive third (sim now 8).

**A2: phase-switch timing.**

- Per player, `λ = 1 − exp(−max(0, t + 0.5) / τ_role)` from the possession change; the anchor blends the old phase's rule into the new one by λ.
- τ by role: CB 2.5, CM 4, ST 4.5, AM 5, FB 7.5, W 8.5 s. **Re-fitted (Task 7c):** CB 3, FB and WB 3.5, CM 2.75,
  AM 2.75, W 3.25, ST 2.75 s (GK 2.5). The first τ came from a free-asymptote fit against the all-frames rows; against
  the settled rows the real curve is a fast jump (about 0.4 within 0.5 s) and a slow tail, and a single exponential with
  τ ≈ 3 s is its least-squares fit.
- **Lateral asymmetry.** Narrowing after a loss: τ ≈ 1 s. Spreading after a win: a 2.5 s dead time, then τ ≈ 4.5 s.
- **Ball lag.** Anchors read the ball 2 s ago.

**A3: team shift and per-player drift.** Ornstein–Uhlenbeck (OU) processes on their own RNG stream.

- **Team-common:** u SD 9 m, τ 8 s; y SD 5.4 m, τ 5 s.
- **Per player:**
  - a match offset, SD 4–8 m by role (W 8, ST 5–6, others 4–5);
  - slow drift: u SD 6 m, τ 12 s; lateral SD 5–9 m, τ 20–60 s (FB/W/AM/ST longest).

**A0: relaxed shape motion.**

- For `shape` intents only: target speed = `min(0.6·vmax, dist / 2 s)`, so a player walks once near his anchor.
- Marking, pressing, chasing the ball and runs keep their speeds.
- **Targets per outfielder per 90:**
  - live play about 130–150 m/min (now 215; real 147);
  - high-speed plus sprint about 0.7 km (now 3.35; real 0.69);
  - about 50 accelerations > 2.5 m/s² (now 712);
  - walking about 3.5 km (now 0.8).

**F1: mild tiring.**

- Energy scales the pressing rate, run triggers and recovery-sprint speed by `0.8 + 0.2·energy`.
- A short-term load term (high-intensity distance over the last 5 min) damps new high-intensity triggers after a hard spell (real: 0.58× in the 5 min after a peak).
- `vmaxFor` (`kinematics.ts:34`) is unchanged.

**F2: substitutions.**

- `substitutions.windowMinutes` moves from [62, 72, 81] to [64, 75, 84].
- The choice of who comes off is weighted by role: W 1.0, ST 0.9, CM 0.7, FB 0.4, CB 0.15 (real shares: W 79 %, CM 39 %, CB 6 %).

**Tests and checks.**

- `anchor.ts` unit tests: the table is reproduced at λ = 1, λ ramps by role, the drift's stationary SDs, and lineHeight has no effect in possession.
- C4 rerun on all 7 matches.
- Physical bands.
- Shot-share spread (expected ≤ 0.18; ablation evidence: style-equalised shots SD 3.8 against 10.7).

## P3: passing execution and choice (sensitive, approved)

Source: `carrier-report.md`, `finalthird-report.md`, `gk-report.md`.

**X1: first-tick interception fix** (`resolve.ts:88`)

- Today any opponent within `reachM` (1 m) of the path qualifies outright on the first tick, and the path starts at the passer's feet. With an opponent within 1 m, passes complete 2–14 % (real 64–76 %).
- New rule: on the first tick, an opponent qualifies outright only if the contact point is ≥ 0.5 m along the path **and** he is within ±60° of the pass direction from the passer. Otherwise the reachable-disc test applies, including `reactionS`.
- Blocks at the boot remain possible through `deflect.ts`, calibrated so passes with an opponent within 1 m complete about 70 %.
- **Order.** First in P3, before pass choice is refitted.

**X2: pass length** (`execute.ts`)

- After X1 and P2, re-measure completion by length (real: 10–20 m 93 %, long 74–85 %; sim now 73 % and 91–94 %).
- If long passes are still too easy, add `pass.longErrorPerM`: aim error growing with distance for high passes.

**D1: pass-choice reweighting** (`decide.ts`)

- **Utility.** Receiver value becomes a utility fitted to the real conditional-logit coefficients (`carrier.json`): distance, openness, lateral |Δy|, lane blocked at release (real −0.55, sim −0.01), forward gain, and a pressure interaction so pressed carriers favour near options.
- **Lanes.** Judged both at release and at the lead point. The pitch-control share drops from 80 % to the fitted value.
- **Two-step choice kept.** The action type is chosen first, then the receiver. The `switch` and `long_pass` zone logits are refitted.
- **Keeper (G5a).** He is a normal back-pass candidate, with a safety term.
- **Targets.**
  - Choice coefficients refit on sim output fall within the real 90 % CIs.
  - Switches about 6 % (now 12.5 %).
  - Tightly marked receivers about 9 % (now 30 %).
  - Back passes to the keeper about 6 % of passes (now 0.64 %).
  - Most-forward option about 20 % (now 45 %).

**D2: release timing** (`step.ts`)

- The decision delay depends on pressure: an opponent within 2 m gives 0.2–0.7 s (real 0.4 s median, 63 % within 1 s); otherwise the current range with a right-skewed tail.
- This replaces the flat `decisionMinS`/`decisionMaxS` draw.

**D3: crosses** (`decide.ts`)

- A wide carrier in the final third gets zone targets: near post, penalty spot, far post, cut-back.
- Each is valued by the attackers expected there at arrival.
- **Target.** About 15 crosses per match (now 7.5) at real landing depth.

**D4: through balls** (`decide.ts`). A teammate on a run intent (`run_in_behind`, `overlap`) gets a lead target in space.

**G5: keeper distribution** (`decide.ts`/`execute.ts`)

- In hands: a throw (≤ 35 m, low error) or a punt (high, long, more error).
- At feet: normal passes.
- **Targets per team-match.** About 45 keeper passes, 78 % open-play completion, 1.6 punts.

**Tests and checks.**

- X1 geometry unit tests: a pass directly away from an adjacent defender is not cut out; one through him is.
- Choice-model refit, switch share, keeper share, crosses per match.
- The agent decision-log replay tests still pass.
- Manager A/B re-run for information.

## P4: duels and transitions (aerial part sensitive, approved)

Source: `tackles-report.md`, `transitions-report.md`, `finalthird-report.md`, `carrier-report.md`.

**T2: tackle success** (`step.ts:502`). New terms on the logistic of tackling minus dribbling: approach from the front +0.35 logit, from behind −0.35; +0.4 per supporting defender within 5 m (up to 2); carrier speed; in the box +0.3.

| Situation | Defender wins |
|---|---|
| Overall | 0.48 |
| From the front | 0.54 |
| From behind | 0.45 |
| No support | 0.36 |
| With support | 0.60 |

**T3: foul risk by zone** (`step.ts:511`)

- Foul probability per duel = `base × zone × angle`:
  - zone, by the carrier's position along the pitch: own deep half ×1.0 → final third ×0.4 → box ×0.12;
  - from behind ×2.4.
- This replaces the flat rate and the box ×0.2.
- **Targets.** About 15 defender fouls per match, free kicks within 30 m about 0.9 (now about 2), penalties about 0.43 on ≥ 64 seeds.

**T4: other fouls.**

- Attacker fouls from shielding or holding: about 3 per match.
- Take-on fouls.
- **Aerial duels** (`resolve.ts` aerial branch): contested high balls become a duel decided by heading and jumping, about 47 per match (now 19), with about 5 aerial fouls.

**A4: transitions** (`offball.ts`/`step.ts`)

- **Counter-press.** For 3 s after a loss, players join by distance at the loss, any role:

  | Distance at the loss | Join chance |
  |---|---|
  | 0–5 m | 0.8 |
  | 5–10 m | 0.3 |
  | 10–15 m | 0.23 |
  | 15–20 m | 0.13 |
  | 20–30 m | 0.07 |

  They press at about 4.5 m/s. This replaces "nearest player only".
- **Recovery sprints.** From 2.5 s, on a ramp peaking at 5–6 s with about 15 % of the losing team. Likely if upfield of the ball, rare if already behind it.
- **Reaction pause.** The losing team holds speed about 1.5 s before turning.

**A5: team pressing.**

- **Triggers** replace the even hazard: a receiver facing his own goal (lift ×2), and the ball entering our defensive third (×2).
- **Second presser.** Joins when a teammate is within 12 m, taking the cover-shadow line.
- **CBs step out** after a dropping striker, up to about 10 m.
- **Who presses** is weighted toward the real mix: CM 37 %, W 19 %, FB 13 %.
- **Exemption.** Never press a keeper with the ball in his hands.
- **Zonal marking.**
  - `assignMarks`/`markTarget`: the 0.75 marking weight moves toward a lane target, about 40 % of the way from the carrier to the receiver.
  - Target: tightly marked receivers about 9 %.

**Checks.**

- Counter-press and recovery tables (`transitions-report.md`).
- Press episodes with ≥ 2 engaged: about 405 per 90; ≥ 3 engaged: 4.9 % of the time.
- Fouls, free kicks and cards.

## P5: role moves and set pieces (S9 and long goal kicks sensitive, approved)

Source: `offball-report.md`, `setpieces-report.md`, `gk-report.md`, `physical-report.md`.

**A6: role moves** (`offball.ts`). New intents, triggered by situation. Targets per team-match, real (sim now):

| Move | Trigger | Target |
|---|---|---|
| FB overlap | Same-side W or CM on the ball, mid or attacking third, wide lane | 13.9 (0.6) |
| W comes inside, paired with FB inversion or underlap | In possession | 61.9 / 36.4 (1.4 / 6.2) |
| Run in behind | CM or AM on the ball facing forward, space behind the line | 34.6 (59.3) |
| CM drops between or beside the CBs | Within 5 s of a win in our defensive third | 44.7 (11.4) |

- **Runs in behind.** 60 % to W/FB and the wide lane; runners hold at `lastDef − 1` until the pass, rather than sprinting to `lastDef + 6`.
- **Drops to receive** are jogs.

**S1–S8: set pieces.** A new `setpiece.ts`, used by the restart branch of `moveTarget`.

- **S1: attacking box loading.**
  - Corner targets (u, |y|): CB (42, 4) with both CBs going up; ST (43, 4); CM (39, 10); W (37, 11); AM (43, 16); FB (30, 7).
  - Attackers hold about 2 m behind those spots and run at the kick.
  - Box counts: wide free kicks about 3.8, central free kicks about 3.1.
- **S2: defending corners and wide free kicks.**
  - 9 outfielders defend in the box at corners.
  - Man-to-man within 12 m (goal-side 1 m); the rest take zonal spots on the six-yard line.
  - Nobody left upfield.
- **S3: walls.**
  - Central free kicks: 3–4 players at 9.15 m, shaded to the near post.
  - Wide free kicks: 1–2 players, 76 % of the time.
  - −0.5 m encroachment jitter.
- **S4: rest defence.** Outfielders kept below u 28 (rest-defence counts): corner 1.4, wide free kick 2.7, central free kick 2.3, attacking-third throw-in 4.1. The deepest FB or CM is chosen first.
- **S5: goal kicks.** Opponents stay outside the box; the G4 build-up shape; about 2.6 opponents in the defensive third.
- **S6: throw-ins.** The 3 nearest teammates come short (`supportSpot`, about 10 m) and are marked.
- **S7: kickoffs.** The real shape for each side, with 9.15 m enforced.
- **S8: restart timing.**
  - Lognormal delays at the real medians:

    | Restart | Median |
    |---|---|
    | Throw-in | 13.5 s |
    | Goal kick | 22 s |
    | Corner | 33 s |
    | Attacking-third free kick | 42 s |
    | Other free kick | 28 s |
    | Kickoff after a goal | 70 s |

  - `free_kick` splits into two keys.
  - Each player gets an arrival deadline and walks at 1–1.5 m/s while repositioning (about 65 m/min dead-ball).
  - The taker pauses 0.5–1 s.
  - Delays lengthen through the match (real ball in play 62 % → 43 %).
  - `in_play_share` is retuned with the gate.

**G3: keeper free kicks and long goal kicks.**

- The keeper takes own-third free kicks.
- Goal kicks get a short/long restart choice in `decide.ts`, about 50/50 (now 89.5 % short).
- Long goal kicks complete about 49 % via `execute.ts`.

**S9: direct free kicks** (`decide.ts`)

- A restart shot logit for central attacking-third free kicks: real players shoot 36 % (sim 0 %).
- It uses the existing shot path with a free-kick xG adjustment.
- Requires T3.

**Checks.**

- `setpiece.ts` unit tests per restart type.
- Box counts, wall sizes, rest defence.
- Corner shots about 32 per 100.
- Role-move counts.

## P6: shot model (sensitive, approved)

Source: `finalthird-report.md`.

**SH1: first-time finishes** (`step.ts`/`decide.ts`/`resolve.ts`)

- A pass or cross arriving at a teammate within about 25 m of goal triggers a decision at contact: shoot, control or lay off.
- The shot weight comes from xG at contact and the arrival angle. Pressure lowers execution, not the choice.
- **Targets.** 41 % of open-play shots and 55 % of goals; conversion about 12 % for first-time shots, 7 % for others.

**SH2: headers** (`resolve.ts` aerial branch, `decide.ts`)

- An attacker who wins a high ball (z 1.0–2.4 m) in the box can head at goal, using `xgOf(header = true)` and heading attributes.
- **Targets.** 14 % of shots, about 6 % conversion.

**SH3: saves that depend on the keeper's position** (`shot.ts` `saveChance`)

- New terms: the keeper's distance off the line, his distance from the ball–goal-centre line, and reaction time from the shot's distance and speed.
- **Target.** Conversion rises with defender proximity as in real data (tight 11.8 %, open 3.2 %; the sim is now the reverse).

**SH4: re-fit tiring for execution** (`execute.ts:46`). Refit how energy widens execution error after P2's energy changes, so late-match error stays calibrated.

**Calibration and checks.**

- Shot logits and xG constants refit. Goals stay about 2.7 per match.
- Shot-type table, conversion by pressure.
- Manager A/B re-run for information.
- **C5: the user's replay review.**

## Non-goals

- Changing the agent or manager interfaces.
- Recomputing C1's single-match tracking targets on seven matches (a separate decision in the contract).
- Exporting any real per-frame or per-player data.

## Results: P1 (2026-10-14)

Switched on in `DEFAULT_PARAMS`: teams switch ends, `keeper.handsRule` 1 (`feetPressFactor` 0.25),
`defending.cautionPerMatch` 1.7, `bookedFoulFactor` 0.5, `bookedYellowFactor` 0.6.

**Keeper hold, two changes from the plan above.** At 5–12 s, keepers stood still with the ball longer than real keepers
do. Seed 11 had 20.1 s in 7 stretches, against a real maximum of 15.8 s and 5 stretches. The cause: in his hands the
keeper walks to his release spot (14 m out) and then stands there until the hold ends. So:

- the hold is drawn from **5–10 s**;
- a keeper who is already at his release spot lets the ball go once the 5 s minimum has passed (`step.ts`
  `ownerDecision`).

Without the second change, the recalibrated parameters still put seed 11 at 17.2 s, with one 8.6 s stretch.

**Calibration.** Four runs, each 12 matches and 1 round:

| Run | Engine | Start | Loss |
|---|---|---|---|
| 1 | 5–12 s hold | previous knobs | 19.60 (`yellow_per_foul` stopped at 0.325, 7.7 cards per match) |
| 2 | 5–12 s hold | `yellow_per_foul` 0.15 | 17.81 |
| 3 | 5–10 s hold | run 2 | 18.47; gate 19.28. Kept C2 and sendings-off in band but failed the keeper still-time check |
| 4 | final engine | run 3 | 21.69 at the start -> **19.27**, the committed one |

Knobs that moved in run 4: `long_bias` 2.25 -> 2.75, `cross_bias` 0.625 -> 0.125, `xg_b0` -0.5 -> -0.75,
`yellow_per_foul` 0.15 -> 0.2, `deflect_behind` 1.375 -> 1.625. `foul_per_tackle` went 0.405 -> 0.465 in run 3.

**Net knob change vs pre-P1** (`data/params/touchline-params.json` at a55a39b against the committed file):
`exec_scale` 0.85 -> 1.15, `aim_noise` 1.35 -> 1.15, `reach_margin` 0.775 -> 0.725, `save_b0` 1.925 -> 2.175,
`deflect_behind` 1.125 -> 1.625, `fwd_drop` 0 -> 2.5, `long_bias` 2.25 -> 2.75, `cross_bias` 0.625 -> 0.125,
`foul_per_tackle` 0.405 -> 0.465, `yellow_per_foul` 0.375 -> 0.2. `xg_b0` ended where it started (-0.75, via -0.5).
Outside the knobs: `script.goalShotLogit` 1.5 -> 1.75, and the new P1 parameters listed at the top of this section.
Part of the C4 and C1 movement below comes from this recalibration (`fwd_drop` moves the forwards' shape, `exec_scale`
widens pass execution error), not from the P1 behaviours themselves.

**Sources.** C1, C2 and C4 come from `docs/realism/realism-report.md` (16 matches, seeds 2000-2015). C3, sendings-off and
penalties come from `pnpm realism:deep` (64 matches, seeds 2000-2063).

- **Gate: MET.** Loss 21.23 against `GATE_LOSS` 30, drift 0 against the refreshed baseline. Before P1 (behaviours off)
  it was 22.9.
- **C1: NOT MET.**
  - Of the original 19, 15 are within 1 SD (needs 16) and 18 within 2 SD (needs 19). Before P1 it was about 12 of 19
    within 1 SD.
  - Outside 2 SD: pass completion (z -2.53).
  - Within 2 SD but not 1: passes +1.19, blocked shots -1.35, ball in play -1.95.
  - Across the fix rounds two of these got worse: pass completion went from z -2.15 to -2.53, and ball in play from
    -1.11 to -1.95.
- **C2: MET.** Free kicks z +0.58, fouls -0.69, goals -0.32, shots on target share +0.17.
- **C3: NOT MET.**
  - Team shot-share SD over 64 matches is 0.383 (needs 0.18 or less; real 0.090).
  - It was already about 0.34 before P1 (previous parameters, keeper and caution switches off, seeds 2000-2015).
  - In most matches one side takes most of the shots (30-3, 31-0, 41-1). This is the territory problem P2 targets.
- **C4: NOT MET.** Width out of possession is z +3.04. The other six are within the band: width in possession +0.13,
  defending length +1.84, line height +0.12, ball pressure -0.90, support within 15 m -1.15, free space +1.57.
- **Sendings-off: NOT MET (just above).**
  - 0.34 per match (target about 0.2-0.3; real 0.29; 0.89 before P1).
  - Calibration run 3 gave 0.22, but failed the keeper still-time check. The 5–10 s hold without recalibration gave 0.16.
- **Penalties: MET.** 0.45 per match against 0.43 real.
- **Cards: MET.** 5.3 per match on 64 matches (real 5.3).
- **Keeper distribution: MET.** Open-play shots within 20 s after the conceding team's keeper distribution are 9.0 % of
  shots (34 of 379, 16 matches). That is down from 25 % (real 7.6 %).
- **`yellowPerFoul`: MET.** 0.2 (expected 0.15–0.2). Conduct cautions supply the rest of the cards.
- **Keeper still with the ball: MET.** Each test match is within the real bounds (at most 5 stretches and 15.8 s).
- **`feetPressFactor` 0.25; G2 at-feet pressure: NOT MET.**
  - An opponent is within 5 m at 43 % of the keeper's open-play releases from his feet (60 of 138; the 16 realism
    matches, seeds 2000-2015, re-measured on the final engine and parameters; target about 12.6 %).
  - The factor barely moves it. Measured on the 5–12 s hold engine before the recalibration: 56 % at 1, 55 % at 0.5,
    44 % at 0.25, 41 % at 0.1, 40 % at 0 (no pressing at all).
  - The rest are strikers already standing near him when the back pass arrives (holding, running in behind, or still
    pressing from before). Lowering the factor further doesn't help; fixing it needs positioning work (P2).
- **Keeper claims:** 25 claims and 8 punches on the test configs' seeds 1-40 (16 and 4 before P1).
- **Scenario nudge:** `script.goalShotLogit` 1.5 -> 1.75.
  - With the switches on, `late_comeback` reached its target unforced in 17 of seeds 1-20 (8 of 1-10, below the 90 % this
    design asks for).
  - At 1.75 every built-in scenario does in 20 of 20. Unscripted matches, and so the gate, are unaffected.

**Merge checklist.** After merging, regenerate every run folder under `out/` in the main checkout: `pnpm library`
(with the agent service running), plus `demo-7`, `m-1`, `eval-ci` and any run folders among those present on 2026-10-14
(`m-2`, `m-2-25fps`, `m-3-noisy`, `m-7`, `halt-check`, `ab-pilot`, `manager-ab`, `realism`; `library-old` can be deleted). Folders written
before P1 have their second half played left to right; `readRun`, the advisor and the API library now refuse them.

## Results: P2 (2026-10-15)

**Switched on** in `DEFAULT_PARAMS`:
- `positioning.rule` 1 (the re-fitted rule table and τ above, with blends, the 2 s ball lag and drift);
- `movement.relaxed` 1;
- `fatigue.tiring` 1;
- `substitutions.windowMinutes` [64, 75, 84] and `roleWeights` CB 0.15, FB 0.4, DM/CM 0.7, AM/ST 0.9, W 1.

`shape.defLineM` and `shape.fwdDropM` are retired, and so are their knobs (`def_line`, `fwd_drop`). New knobs:
`pos_in_shift`, `pos_out_shift`, `team_drift`, `relax_cap` and, as a deviation, `player_drift`.

**Sources.**
- C1, C2 and C4 come from `docs/realism/realism-report.md` (16 matches, seeds 2000–2015).
- C3, the physical bands, territory, centroids and discipline come from `docs/realism/realism-deep-report.md` (64
  matches, seeds 2000–2063).
- The G2, keeper-distribution and substitution checks were run on 16 matches, seeds 2000–2015.

### Deviations from the plan

1. **Drift: team drift scaled to 0.25; player drift kept at 1.**
   - At the fitted SDs, the smoothed drift moves anchors at an RMS speed of about sd/√(smoothS·(τ − smoothS)): team u
     3.4 m/s and team y 2.7 m/s, plus 1–2 m/s per player.
   - Players chased those anchors: 19.7 km per outfielder, 210 m/min with the ball dead, 623 accelerations per 90.
   - The real residual SDs include motion the engine already produces through pressing, marking and support, so at full
     size they double-count it.
   - The `player_drift` knob was added so the tuner could scale the player processes as well as the team ones.
2. **`positioning.drift.smoothS` 1 → 3** (capped at τ/3 per process). It was untuned before.
3. **`movement.relaxMarks` 1 (Ruling 13).** Live running without drift was 172 m/min against 130–150. It was switched on
   before calibrating, not after.
4. **Task 8b engine fixes.** Each one's "off" value reproduces the old arithmetic.
   - **`positioning.drift.deadRate` 0.25.** Drift advances at a quarter rate while a restart is set up. Dead-ball running
     falls from 83 to 49–52 m/min.
   - **`backLineOutU` 0.25.** CB/FB/WB keep a quarter of their own depth drift without the ball. That makes a flat back
     line: depth SD by third 3.0 / 3.8 / 4.1 against real 2.8 / 3.3 / 4.6.
   - **`outS` 0.5.** Every outfielder keeps half his own lateral drift without the ball (a compact block).
   - **`positioning.gkTauS` 1.5 s** for the blend into the gk row.
   - **FB `gk` a −13**, the G4 value. The re-fit's −17.5 sat exactly on the deep-count threshold.
   - **`marking.radiusM` 10 → 15.** About half the non-carrying attackers had no marker.
5. **The re-fitted `gk` rows keep their old widths (w0).** The blend-inversion widths are low-confidence.
6. **`positioning.test.ts`.** The plan's real-target bounds are restored, unwidened, on DEFAULT_PARAMS, seed 7. The two
   that fail are in `it.fails`, marked NOT MET (user ruling):
   - relIn > −3 (measured −3.63);
   - deep count while the keeper holds ≤ 6 (measured 7).

   These tests measure on `DEFAULT_PARAMS` (team drift SD 9), not on the shipped JSON (team drift scaled to 2.25).
7. **Task 7b/7d engine changes beyond the plan.**
   - The keeper reads the current ball, not the lagged one (7b).
   - The blend is continuous: a change of row eases at the group's rate instead of switching (7b).
   - The keeper and forward-line caps are eased in and out with the blend, not applied as hard caps (7b, 7d).
   - Deflections keep the row (7b).
   - `commitS` and `clearanceLoose` ship at 0 (off).
   - The drift is smooth: a smoothed OU, two draws per process (7d; see deviation 2).

### Calibration

- **Task 8, runs 1–5** (12 or 24 matches per evaluation):
  - from the P1 knobs with drift ×0.25, the tuner loss went 49.19 → 34.43 (held-out 40.5);
  - from shape_width 1.4 and player drift ×0.5, it went 34.22 → 28.22;
  - two more runs (2 rounds; then 24 matches) ended at 28.22 and 27.94, with **held-out 30.95**. That failed the gate,
    and the work stopped for a decision.
- **After the Task 8b fixes:**
  - a parallel tuner, 24 matches, 1 round: tuner 26.89, held-out 28.06;
  - that passed the loss but had 10 statistics within 1 SD against the gate's 11;
  - one more run (24 matches, 2 rounds): **tuner 26.78, held-out 26.87**, 11 within 1 SD and 19 within 2 SD.
- **Net knob change against the P1 parameters:**
  - long_bias 2.75 → 2.5, shot_bias 0 → 0.8, aim_noise 1.15 → 1.35, xg_b0 −0.75 → −1;
  - reach_margin 0.725 → 0.675, tackle_rate 0.425 → 0.575, foul_per_tackle 0.465 → 0.405, yellow_per_foul 0.2 → 0.35;
  - loose_share 0.4 → 0.3, shape_width 1.25 → 1.4, deflect_behind 1.625 → 1.875, save_b0 2.175 → 2.05;
  - team_drift 0.25, player_drift 1;
  - def_line (15) and fwd_drop (2.5) are retired.
  - pos_in_shift, pos_out_shift and relax_cap stayed at their identity values (0, 0, 0.6).

### Results

- **Gate: MET** (the gate's figures come from the held-out seeds). Loss 26.87 against `GATE_LOSS` 30, maxDrift 0 against the refreshed baseline, 11 within 1 SD and 19
  within 2 SD. Physics: 2 of 13 inside (max_speed and, new, metres above 25 km/h). It was 21.23 at P1.
- **C1: NOT MET.**
  - Of the 19, 9 are within 1 SD (needs 16) and 18 within 2 SD (needs 19).
  - Outside 2 SD: passes, z +2.08 (1054 per match, short: median length −1.98).
- **C2: NOT MET.** Free kicks +0.05 and shots on target −0.63 are within 1 SD; fouls −1.64 and goals −1.27 are not.
  Goals are 1.12 per match on 16 matches, against 2.71.
- **C3: NOT MET, improved.** Team shot-share SD on 64 matches is **0.223** (was 0.383; needs ≤ 0.18; real 0.090).
  - What remains is `pressIntensity`, which drives the rest of the dominance (`dominance-report.md`).
  - Team pressing is P4 (A5).
- **C4: MET** (all seven |z| < 3; P1 had width out of possession at +3.04):

  | metric | z |
  |---|---|
  | width in possession | +0.61 |
  | width out of possession | +0.42 |
  | defending length | −1.97 |
  | line height | −1.98 |
  | ball pressure | +1.22 |
  | support within 15 m | +2.52 |
  | free space | +1.85 |

- **Physical bands** (64 matches, per 90, against real):

  | band | sim | real | status |
  |---|---|---|---|
  | walking (km) | 1.93 | 3.50 | NOT MET |
  | high-speed + sprint (km) | 1.01 | 0.69 | NOT MET; was 3.35 |
  | accelerations over 2.5 m/s² | 289 | 50 | NOT MET; was 712 |
  | live running (m/min) | 156 | 130–150 | NOT MET, just above |
  | dead-ball running (m/min) | 50 | 65 | NOT MET |
  | sprints | 4.9 | 8.4 | NOT MET |
  | distance (km) | 9.99 | 10.88 | z −1.65 |

- **Territory and centroids** (64 matches):
  - territory SD 4.5 m, against real 1.9: NOT MET (was 11.7);
  - centroid minus ball with the ball −3.0 m, against +3.9: NOT MET;
  - without the ball −4.6 m, against −9.5: NOT MET.
- **G2, keeper-distribution and substitution checks** (16 matches):
  - **G2 at-feet pressure: NOT MET (overshoots).** An opponent is within 5 m at 1.5 % of open-play releases from the
    keeper's feet (3 of 200; real 12.6 %; P1 43 %). The vsKeeper cap and the build-up shape keep the strikers away.
  - **Keeper distribution: MET.** 4.8 % of shots follow the opponents' keeper distribution within 20 s (P1 9.0 %; real
    7.6 %).
  - **Substitutions: MET.** Mean minute 70.4. Share of starters taken off by role: W 0.85, AM 0.75, ST 0.71, CM 0.63,
    DM 0.47, FB 0.05, CB 0 (real W 79 %, CM 39 %, CB 6 %).
- **Keeper off his line** (DEFAULT_PARAMS, seeds 7 / 9 / 11): medians 2.76 / 3.04 / 2.85 m, inside 1.2–3.5 (real 2.2):
  MET. It was 4.0 on the old template.
- **Deep count while the keeper holds:** median 5 per match, mean 5.67 (Task 8b, 48 matches; real 3): NOT MET. At
  release the median is 5 for holds in the hands and 3 at the feet. About 1.3 players of the gap is the tracking lag
  below.
- **Discipline** (64 matches): 0.50 players sent off per match (real 0.29, target about 0.2–0.3): NOT MET. Penalties 0.28
  (real 0.43). The re-tune raised `yellow_per_foul` to 0.35.

- **Scenario nudge: `script.goalShotLogit` 1.75 → 2.**
  - At 1.75, `late_comeback` reached its target unforced in 8 of seeds 1–10 and 9 of 11–20, against the 90 % this
    design asks for.
  - At 2 it is 9 and 10, and the other built-in scenarios are unchanged (all 9–10 of 10).
  - Unscripted matches, and so the gate, are unaffected.

### Gaps outside P2 (found by Task 8b)

- **Ball upfield (P3, decision side).** While a team has the ball, the sim's mean ball u is +2.4, against −5.2 in real
  matches; by thirds the sim is 18 / 58 / 24 % against real 35 / 43 / 22 %.
  - Because centroid − ball = ā + (b − 1)·bu with b ≈ 0.6, this accounts for about 3.5 m of each centroid gap, and for
    about 85 % of the line-height deficit.
  - The lag and blend match the closed form (−6.0 / +4.8 against −5.6 / +5.6).
- **Dead-ball running (P5, set pieces).** With drift slowed during restarts, live 147, dead 65 and 10.9 km cannot all
  be met. The missing dead-ball motion is set-piece movement.
- **Tracking double lag (P2, left unfixed by choice).**
  - Relaxed motion adds about 2 s of first-order lag on top of a lag and blend fitted to real positions: −1.9 m in
    possession, +2.3 m out of it.
  - Leading the target by `relaxArriveS` closes it, but raises live running to 170–176 m/min and bunching. It is left for
    a later phase, together with a lower relax cap.
- **Defending length at the extremes.** The sim is 4.5–8 m short of real per third when the ball is deep in a team's own
  third or it presses high. A linear table cannot produce that; it needs a per-third depth refit.

### Rulings

The plan's rulings ("Rulings on the spec", plan 8b) hold as written, with these notes:
- Rulings 1–18 hold. Ruling 18's 25 m keeper rule became a 22–30 m blend (Task 7b).
- Ruling 4: offsets are the real per-player ones.
- Ruling 11: team drift is scaled by `team_drift` 0.25.
- Ruling 13: `relaxMarks` is on (deviation 3).

`pnpm library` was not rebuilt. It needs the agent service and the LLM, and is on the merge checklist (as for P1).

### P2 merge checklist

- Regenerate every `out/` run folder in main (pre-P1 folders are refused).
- Regenerate `realism-deep.md`.
- Run `pnpm library`. It needs the agent service and the LLM, and stays pending until the user OKs it.

## Results: P3 (2026-10-17)

**Switched on** in `DEFAULT_PARAMS`:
- `firstTick.rule` 1, `choice.rule` 1, `release.rule` 1, `cross.rule` 1, `through.rule` 1 and `distribution.rule` 1. D1 and D4
  went on together, because D1 alone doubles through balls.
- `support.rule` 1 (Task 10d; a deviation, see below).

**Values the tasks set:**
- **X1:** `alongM` 0.5, `coneDeg` 60, `bootM` 1, `bootBlock` 0.10.
- **D2:** `pressedS` 0.2–0.7 (spec), `tailShare` 0.35, `tailMeanS` 2.5.
- **D3:** zones as the spec (ruling 15), `arriveSlackS` 0.6, `attackerValue` 0.6.
- **D4:** `ballSpeed` 14, `runSpeed` 7, `leadMaxM` 15.
- **G5:** `puntLogit` −0.25 (one allowed step from −0.75), throw error ×0.5, punt error ×1.6.
- **D1:** the real pooled coefficients and pressure interactions (ruling 5), `ivCentre` 1, `temperature` 1, `leadLane` 0
  (not needed). `kindShift` is 0 except `through_ball` −1.5, from Task 10's sweep (below); the tuner adds `switch_shift` +2 in
  the calibrated file.
- **X2 not needed:** `pass.longErrorPerM` 0. With X1 on, completion to an available receiver at 30 m+ was 0.812, within
  0.85.
- **Support rule 1:**
  - `pressM` 5, `count` 2, `calmCount` 0, `spaceM` 16, `spaceAttM` 11, `gateHoldS` 1;
  - `pressExitM` 5 (no band);
  - `distM` 14 in the calibrated file.

**Retired knobs:** `long_bias`, `cross_bias`, `pass_pc_weight` and `pass_safety` (inert under D1; rulings 9 and 10).
**New knobs:** `long_shift`, `switch_shift`, `cross_shift`, `choice_temp`, `iv_centre`, `support_space` and
`support_space_att`. There is no knob on D1's fitted distance coefficient (ruling).

**Sources.**
- C1, C2 and C4: `docs/realism/realism-report.md` (16 matches, seeds 2000–2015).
- The P3 passing targets, the choice refit, C3, the physical bands, territory and discipline:
  `docs/realism/realism-deep-report.md` (64 matches, seeds 2000–2063).
- Real-target tests: `passing-targets.test.ts` (4 matches, test teams).

### Deviations from the plan

Planning rulings that changed the spec:
- **2:** first-tick contact clamped and cone-gated. Task 3 extended the cone to the disc test (variant A), and applied it to
  every tick in the first 0.1 s at 25 Hz.
- **5–10:** D1 as a nested logit with the real coefficients, features measured as fitted, `leadLane` 0, pitch control out of
  the utility, and kind shifts for the refitted switch and long logits.
- **13:** G5 throw or punt from the hands.
- **16:** D4 keys on `run_in_behind`; there is no overlap intent until P5.

Changes made on measurement:
1. **Task 3 (variant A).** The ±60° cone also gates the first-tick disc test. `bootBlock` is 0.10, not about 70 %
   completion: near-1 completion cannot reach 0.70 through blocks, so that target moved to the P3 exit.
2. **Task 4.** Tail 0.35 / 2.5 s, chosen outside the brief's sweep; it hits the 1.40 s median.
3. **Task 7.** `puntLogit` −0.25.
4. **Task 9 review.** D1 prices every option at its receiver's current position (as fitted); the aimed point enters only
   through the lane.
5. **Task 10, `kindShift.through_ball` −1.5.** Sweep with all P3 on, 16 matches:

   | Shift | 0 | −0.5 | −1 | −1.5 |
   |---|---|---|---|---|
   | Shots after a through ball | 0.119 | 0.141 | 0.077 | 0.043 |
   | Own third | 0.244 | 0.226 | 0.238 | 0.230 |

   Passes were 872–882 throughout.
6. **Task 10, `release.pressedS` stays 0.2–0.7.** 0.2–1.2 put pressed-within-1 s in band (0.616), but the pressed median went
   to 0.80 s (band 0.2–0.7).
7. **Task 10, records and what-ifs.**
   - The keeper-hands recorded probabilities use D1's `choiceShares`, so they match the draw.
   - A what-if pass from the keeper's hands is a throw or a punt.
   - A new test checks that crosses, clearances and restarts never boot-block (F17).
8. **Task 10b, diagnosis (no commit).** The first recalibration was blocked: held-out 46.35, pass length z −4.04. The causes
   were:
   - the sim offers 0.72 open teammates at 4–10 m per pass, against 0.33 real (P2 support runners);
   - the gate measured pass length to the reception point, while the real target ends at the receiver's next action.
9. **Task 10c (user ruling).** The sim's `pass_len_median`, in both TS and Python, ends each completed pass at the receiver's
   next on-ball action, as kloppy's `receiver_coordinates` does. The real target (17.15 m) is unchanged. This changes a gate
   statistic's definition, approved by the user; the baseline was refreshed.
10. **Task 10d (user ruling).** P3 reworked the P2 support runs:
    - supporters come short only when the carrier is pressed, held 1 s;
    - other teammates keep 16 m from an outfield carrier (11 m in the attacking third), under the forward-line cap.

    Measured: open teammates at 4–10 m 0.77 → 0.47 (real 0.33), support_15m 2.47 → 2.13 (2.10). It also fixed two old bugs:
    a restart with every outfielder sent off, and a press kept on a keeper with the ball in his hands.
11. **Task 10 test changes** (no bound widened):
    - `release.test` and `choice.test` fixtures pin the other P3 rules off (F4).
    - `keeper.test` counts a press only while it is live (tick < intentUntil).
    - `execute-decide.test` states `recordOf`'s rule (best 5 plus the chosen option when it ranks below them).
    - `positioning.test`: both NOT MET `it.fails` now hold (relIn +0.09; deep count 6, on its bound) and are plain tests again.
    - Seeds re-picked by each file's rule: `whatif` forced window; manager `situation` "adds up" (seed 12; it asserts its
      precondition).

### Calibration

| Run | Start | Tuner loss | Held-out loss | Knobs that moved |
|---|---|---|---|---|
| 1 (from the P2 params, all P3 on; 24 matches, 1 round) | 90.42 | 42.58 | **46.35** (blocked) | decision_scale 0.75 → 0.6, switch_shift → 2, shot_bias 0.8 → 1.2, aim_noise 1.35 → 1.15, xg_b0 −1 → −1.25, save_b0 2.05 → 1.8, tackle_rate 0.575 → 0.275, foul_per_tackle 0.405 → 0.345, yellow_per_foul 0.35 → 0.45, box_intensity 2 → 1, deflect_behind 1.875 → 2 |
| 2 (from run 1, after Tasks 10c and 10d; 24 matches, 1 round) | 30.63 | **25.46** | **26.87** | decision_scale 0.6 → 1.1, xg_b0 −1.25 → −1.5 |

- `long_shift`, `cross_shift`, `choice_temp` and `iv_centre` stayed at their identity values.
- `support_space` stayed at 16 and `support_space_att` at 11.

### Results

- **Gate: MET.** Held-out loss **26.87** (< 30), maxDrift 0 against the refreshed baseline, **15 within 1 SD and 25 within
  2 SD** (P2: 11 and 19), every |z| < 3. The largest:

  | Statistic | z |
  |---|---|
  | distance | −2.73 |
  | throw-ins | −1.90 |
  | peak speed | −1.84 |
  | fouls | −1.83 |
  | line height | −1.81 |
  | pass length | −1.64 |

  Physics: 2 of 13 inside (max_speed and hsr25).
- **C1: NOT MET.** 12 of 19 within 1 SD (needs 16), 17 within 2 SD (needs 19). Off: fouls (z −2.05) and distance (−3.17).
  P2 had 9 and 18.
- **C2: NOT MET.**

  | Statistic | z |
  |---|---|
  | Free kicks | −0.44 |
  | Goals | −0.57 |
  | Shots on target | −0.90 |
  | Fouls | **−2.05** (13.4 per match against 22.9; P2 −1.64) |

- **C3: NOT MET.** Team shot-share SD 0.227 on 64 matches (P2 0.223; real 0.090, needs ≤ 0.18). Pressing is P4 (A5).
- **C4: MET.** All seven |z| < 2:

  | Metric | z |
  |---|---|
  | Width in possession | +1.00 |
  | Width out of possession | +0.54 |
  | Defending length | −1.60 |
  | Line height | −1.98 |
  | Ball pressure | +1.56 |
  | Support within 15 m | +0.32 (P2 +2.52) |
  | Free space | +1.29 |

- **P3 passing targets** (64 matches; pre-P3 values from `p3-passing-baseline.md`, 16 matches):

  | Measure | Real | Pre-P3 | P3 | Status |
  |---|---|---|---|---|
  | Passes per match | 866 | 1054 | 806 | MET |
  | Open-play passes dying at the boot | 0 | 0.052 | 0.049 | NOT MET |
  | Completion, opponent within 1 m | 0.70 | 0.081 | 0.474 | NOT MET |
  | Completion to available, 10–20 m | 0.936 | 0.828 | 0.902 | MET |
  | Completion to available, 30 m+ | 0.805 | 0.799 | 0.818 | MET |
  | Completed 32 m+ share | 0.143 | 0.150 | 0.112 | NOT MET |
  | Switches | 0.061 | 0.166 | 0.135 | NOT MET |
  | Tightly marked, completed | 0.090 | 0.170 | 0.100 | MET |
  | Back to the keeper | 0.062 | 0.011 | 0.022 | NOT MET |
  | Most forward chosen | 0.20 | 0.355 | 0.276 | NOT MET |
  | Open-play crosses per match | 14.9 | 5.6 | 7.0 | NOT MET |
  | Cross end point, median (m) | 10.0 | 12.2 | 10.0 | MET |
  | Shots after a through ball | 0.025 | 0.138 | 0.043 | MET |
  | Keeper passes per team-match | 45.4 | 17.1 | 21.3 | NOT MET |
  | Keeper open-play completion | 0.779 | 0.760 | 0.893 | NOT MET (over) |
  | Punts per team-match | 1.60 | 0 | 0.63 | NOT MET |
  | Keeper throws per team-match | 3.40 | 3.69 (old label) | 2.97 | MET |
  | Pressed release median (s) | 0.40 | 1.20 | 0.50 | MET |
  | Pressed released within 1 s | 0.63 | 0.216 | 0.786 | NOT MET (over) |
  | Release median (s) | 1.40 | 1.20 | 2.00 | NOT MET |
  | On the ball over 3 s | 0.16 | 0.022 | 0.217 | NOT MET |
  | Ball in own third | 0.35 | 0.161 | 0.206 | NOT MET |
  | Ball u in possession (m) | −5.2 | +2.7 | +0.1 | NOT MET |

  The tuner's `decision_scale` 1.1 lengthens time on the ball, so the release median and the over-3 s share overshoot. It
  also brings passes per match to 806.

- **Choice-model refit** (64 matches, 45 537 passes):

  | Coefficient | Real (90 % interval) | P3 | Status |
  |---|---|---|---|
  | Distance | −1.33 (−1.38, −1.27) | −1.16 | NOT MET |
  | Forward | +0.56 (+0.52, +0.60) | +0.58 | MET |
  | Lateral | +0.18 (+0.13, +0.23) | +0.55 | NOT MET (`switch_shift` +2) |
  | Lane | −0.55 (−0.62, −0.49) | −0.45 | NOT MET |
  | Openness | +1.27 (+1.21, +1.34) | +1.22 | MET |
  | Line-breaking | +0.04 (−0.06, +0.14) | +0.01 | MET |
  | Keeper | +0.95 (+0.81, +1.09) | +0.57 | NOT MET |

  Before D1, only the keeper coefficient was MET (`p3-passing-baseline.md`).

- **Per task** (16 matches each, before → after, details in the task reports):

  | Task | Change | Before → after |
  |---|---|---|
  | X1 | First-tick share | 0.052 → 0.019 |
  | X1 | Near-1 completion | 0.081 → 0.44 |
  | D2 | Passes per match | 1054 → 948 |
  | D2 | Pressed median (s) | 1.20 → 0.50 |
  | D3 | Crosses per match | 5.6 → 6.4 |
  | D3 | Cross depth (m) | 12.2 → 10.6 |
  | D4 | Through shot share | 0.138 → 0.104 |
  | G5 | Punts per team-match | 0 → 0.75 |
  | G5 | Throws per team-match (by hand) | → 2.19 |
  | D1 (with X1) | Own third | 0.163 → 0.249 |
  | D1 (with X1) | Switches | 0.176 → 0.052 |
  | D1 (with X1) | Back to the keeper | 0.011 → 0.032 |
  | D1 (with X1) | 32 m+ share | 0.156 → 0.049 |
  | 10d (support) | Open at 4–10 m | 0.77 → 0.47 |
  | 10d (support) | support_15m | 2.47 → 2.13 |

- **P2's carried problems:**
  - **Passes per match: MET** (owner D2). 1054 → 806 (band 776–956).
  - **Ball in own third: NOT MET** (owner D1). 0.161 → 0.206 (real 0.35); ball u +2.7 → +0.1 (real −5.2). It reached 0.23–0.25
    before support rule 1 and the recalibration.
- **Physical bands** (64 matches; P2 → P3, real):

  | Band | P2 | P3 | Real | Status |
  |---|---|---|---|---|
  | Walking (km) | 1.93 | 2.24 | 3.50 | NOT MET |
  | High-speed + sprint (km) | 1.01 | 0.80 | 0.69 | NOT MET, closer |
  | Accelerations over 2.5 m/s² | 289 | 253 | 50 | NOT MET |
  | Live running (m/min) | 156 | 140 | 130–150 | MET |
  | Dead-ball running (m/min) | 50 | 45 | 65 | NOT MET |
  | Sprints | 4.9 | 4.0 | 8.4 | NOT MET |
  | Distance (km, 16-match report) | — | 9.16 | 10.88 | z −3.17, worse |

- **Territory and centroids** (64 matches):

  | Measure | P2 | P3 | Real | Status |
  |---|---|---|---|---|
  | Territory SD (m) | 4.5 | 5.6 | 1.9 | NOT MET |
  | Centroid minus ball, with the ball (m) | −3.0 | −0.4 | +3.9 | NOT MET, closer |
  | Centroid minus ball, without the ball (m) | −4.6 | −7.2 | −9.5 | NOT MET, closer |

- **Discipline** (64 matches): 0.75 sent off per match (P2 0.50; real 0.29): NOT MET, worse. The tuner raised
  `yellow_per_foul` to 0.45. Penalties 0.09 (P2 0.28; real 0.43).
- **Real-target tests** (`passing-targets.test.ts`, calibrated params, 4 matches):

  | Target | Measured | Bound | Status |
  |---|---|---|---|
  | Punts per team-match | 1.00 | 1.0–2.2 | MET, on the bound |
  | Punt share of hands distributions | 0.40 | 0.24–0.40 (real 0.32) | MET, on the bound |
  | Pressed release median (s) | 0.50 | 0.2–0.7 | MET |
  | Boot deaths | 0.046 | ≤ 0.01 | NOT MET, `it.fails` |
  | Switches | 0.146 | 0.04–0.08 | NOT MET, `it.fails` |
  | Back to the keeper | 0.019 | 0.045–0.08 | NOT MET, `it.fails` |
  | Open-play crosses per match | 7.25 | 12–18 | NOT MET, `it.fails` |

- **Scenarios** (calibrated params, seeds 1–10): `late_comeback` 9/10 and `keeper_heroics` 10/10. No script nudge was needed.
- **Manager A/B** (rules against none, 40 seeds, for information): xG difference +0.108 per match (95 % interval −0.061 to
  0.281), no detectable difference.

### Gaps outside P3

- **Crosses need box occupancy** (P5 A6, S1). There are 7 open-play crosses per match against 14.9, and the box is empty when
  a cross is on.
- **Keeper volume.**
  - Hands distributions are about 3 per team-match against 5 real, so punts and throws fall short (P5 G3: keeper catches,
    claims and free kicks).
  - Keeper passes are 21 per team-match against 45.
- **Long passes.** Much of the real 32 m+ share is goal kicks and keeper free kicks (P5). `long_shift` did not move, and long
  options are mostly classed as switches, which drives `switch_shift` to its +2 maximum and switches to 0.135.
- **Tight receivers, marking and pressing** (P4 A5). Near-1 completion is 0.47 against 0.70, and open teammates at 4–10 m are
  0.47 against 0.33 (defenders stand off: ball pressure z +1.56).
- **Boot deaths 0.049.** These are defenders in front of the pass taking it on the first tick, which X1 keeps by ruling 2.
  Part of it is P4's duels.
- **Fouls and distance.** Fouls are 13–14 against 22.9; outfield distance is 9.2–9.4 km against 10.9.

### Rulings

The plan's rulings ("Rulings on the spec", plan 8c) hold as written, with these notes:

1. **Params names:** `firstTick`, `choice`, `release`, `cross`, `through`, `distribution`; `pass.longErrorPerM` with
   `longErrorFromM` 30.
2. **X1 geometry:** first tick, opponents only, contact clamped to ≥ `alongM` from the start, outright within `reachM` inside
   ±`coneDeg`, else the disc test on the clamped contact. As amended by Task 3 (variant A), the disc test is cone-gated too.
3. **Boot blocks:** the nearest outfield opponent within `bootM`, chance `bootBlock` (boot stream), knocked loose at 2–6 m/s;
   not for clearances, restarts or crosses.
4. **X2 is conditional;** it was not needed.
5. **D1 coefficients:** the real pooled fit, with pressure interactions centred on 0.366.
6. **No pressure interaction on distance.**
7. **Features measured as fitted,** at the receiver's current position (also for through balls and crosses, Task 9 review
   ruling); the aim point stays the aim.
8. **`leadLane`** stays 0 (not needed).
9. **Pitch control** leaves the utility; `pass_pc_weight` and `pass_safety` are retired.
10. **Nested-logit two-step choice;** kind shifts replace the refitted zone logits.
11. **Decision record under D1:** value = utility; quality = exp((U − U_best)/T).
12. **Keeper as receiver (G5a)** via the fitted keeper coefficient; no lofted ball back to him.
13. **G5 from the hands:** throw or punt, punting with chance sigmoid(`puntLogit`), method on the candidate, method recorded
    truthfully.
14. **D2:** pressed means an opponent within 2 m at the reception; 0.2–0.7 s; otherwise the base range plus the tail.
15. **D3 zones** as the spec, with the classifier's wide-carrier geometry.
16. **D4 keys on `run_in_behind`.**
17. **Diagnostics in Python** (no TS port).
18. **P2's two problems:** passes owned by D2, ball upfield by D1.
19. **Real-target tests** in `passing-targets.test.ts`, misses in `it.fails` unwidened.
20. **The choice refit** uses the engine's true intended receiver.

Controller and user rulings during execution (progress.md):

- **Process:**
  - The pre-flight scan was delegated and run concurrently with Task 2.
  - The punts row reads 0 until Task 7, by design.
- **Pre-flight findings:**

  | Finding | Ruling |
  |---|---|
  | F1 | Task 5's test asserts only what the rule adds, against the rule-off set |
  | F2 | Task 6's fixture: winger at (20, −20), old target (28, −20) |
  | F3 | Keeper-hands `actionProbs` keyed by each candidate's classified action; the chosen action is in `actionProbs` |
  | F4 | Tests define explicit off/on params, not DEFAULT_PARAMS |
  | F5 | Task 10 updates the longErrorPerM assertion; it stays 0 |
  | F6 | `passing.test` safety and pitch-control cases pinned to `choice.rule` 0 |
  | F7 | Reword the expected-failure lines (cosmetic) |
  | F8 | Import markers after the last import (cosmetic) |
  | F9 | Shared `recordOf` and `leadOf` |
  | F10 | Test-measure duplication accepted |
  | F11 | No vacuous tests (`forced`, at least one quality, at least one throw) |
  | F12 | Task 2's scan already fixed; no plan change |
  | F13 | Task 2's stricter `--set` key check accepted |
  | F14 | Task 9 runs its own X1 baseline |
  | F15 | Ownership table aligned with the Files blocks |
  | F16 | Task 4 comment "about 8.6 %" |
  | F17 | Boot call-site condition excludes crosses, clearances and restarts |

- **Task 4:**
  - The 0.35 / 2.5 s tail was accepted, though chosen outside the brief's sweep.
  - `pressedS` stays 0.2–0.7; Task 10 revisited it and kept it.
- **Task 6:**
  - Granted out-of-region edits: `DecisionInput.tick` and `whatif.ts`.
  - A run counts only while tick < intentUntil.
- **Task 3:**
  - Variant A (the cone also gates the disc test).
  - `bootBlock` 0.10, and the near-1 target moves to the P3 exit.
- **Task 7:**
  - The punt-share mechanism test is sigmoid(`puntLogit`) ± 0.08; the real 0.32 share is in `passing-targets.test`.
  - The punt and throw volume shortfall is keeper catch volume (P5).
- **Wave 2:**
  - Started without waiting for Task 5.
  - Task 8 reuses Task 3's measurement: X2 not needed.
  - Task 9 exports `choiceShares` for Task 10.
- **Task 9:**
  - `kindShift.long_pass` stays 0, and the tuner gets `long_shift`.
  - Features are measured at the receiver's position for every option with a receiver.
  - `kindShift.through_ball` is set by Task 10's sweep (−1.5).
- **User rulings after the first gate failure:**
  - Diagnose, fix, recalibrate (Task 10b).
  - Pass length measured the way the real target is (Task 10c).
  - P3 may rework the P2 support runs (Task 10d).
- **Afterwards:**
  - No tuner knob on D1's fitted distance coefficient: pass length is moved by the support fix and the support knobs.
  - The scenario 9-of-10 tests are handled after recalibration by the script nudge, never the bound. No nudge was needed.

`pnpm library` was not rebuilt. It needs the agent service and the LLM, and is on the merge checklist.

### P3 merge checklist

- Regenerate every `out/` run folder in main.
- Regenerate `realism-deep.md` (`pnpm realism:deep`).
- Run `pnpm library`. It needs the agent service and the LLM, and stays pending until the user OKs it.

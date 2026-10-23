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
In the calibrated file, `pass.pitchControlWeight` 0.8 → 0 and `pass.safetyWeight` 3 → 0, so the logged `xpass` (decision
records, `options[].xpass`) is now the lane-only model. The advisor and the agents read this value. Sim outcomes are
unchanged under D1, which reads neither.
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
    - Seeds re-picked by each file's rule:
      - `whatif` forced window;
      - manager `situation` "adds up" (seed 12; it asserts its precondition);
      - api library fixture 2 → 5;
      - agents ERROR_SEED 164 → 62 and SEED 9 → 2;
      - gateway e2e 62.
    - The advisor explain-pass check uses the verdict's own `clearlyBetter` rule, not a bare 2 SE.
    - The stats and manager goldens were regenerated.

### Calibration

| Run | Start | Tuner loss | Held-out loss | Knobs that moved |
|---|---|---|---|---|
| 1 (from the P2 params, all P3 on; 24 matches, 1 round) | 90.42 | 42.58 | **46.35** (blocked) | decision_scale 0.75 → 0.6, switch_shift → 2, shot_bias 0.8 → 1.2, aim_noise 1.35 → 1.15, xg_b0 −1 → −1.25, save_b0 2.05 → 1.8, tackle_rate 0.575 → 0.275, foul_per_tackle 0.405 → 0.345, yellow_per_foul 0.35 → 0.45, box_intensity 2 → 1, deflect_behind 1.875 → 2 |
| 2 (from run 1, after Tasks 10c and 10d; 24 matches, 1 round) | 30.63 | **25.46** | **26.87** | decision_scale 0.6 → 1.1, xg_b0 −1.25 → −1.5 |

- `long_shift`, `cross_shift`, `choice_temp` and `iv_centre` stayed at their identity values.
- `support_space` stayed at 16 and `support_space_att` at 11.
- `movement.shapeSpeedShare` went 0.85 → 0.7 in the calibrated file (it comes from the default) and the `shape_speed` knob entry
  was dropped. Neither has an effect: `relaxed` is 1, so the share is not read.

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
  | Completion, opponent within 1 m at release | 0.303 (251 passes) | 0.64–0.76 (real 0.70) | NOT MET, `it.fails` (deep report 0.474) |

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

### Carried to P4/P5

Found in the final review and left alone, because each changes behaviour (the sim outcomes and the baseline stay as they are):

- **M5:** boot blocks apply to a keeper's throw or punt from his hands (preventing a release from the hands is an offence;
  rare, since presses on an in-hands keeper end). X1's first-tick exemption also covers clearances, which have no boot block,
  so clearances lost their first-tick charge-down entirely. Fix: exclude `d.candidate?.method` from `bootBlock`; P4 duels.
- **M6:** the D2 release tail is uncapped and not re-checked when a presser arrives. About 0.6 % of free receptions hold
  more than 10 s. A cap, or a re-judgement on pressure, is cheap (release-median work).
- **M10:** three tests pass on their exact bounds: punts per team-match 1.00 (bound 1.0; 0.63 over 64 matches, NOT MET),
  punt share 0.40 (bound 0.40), and positioning deep count 6 (bound 6). The punt test passes by the luck of its 4 seeds, so
  an engine change may flip it red without being a regression.
- **Deferred missing tests:** a free-kick restart case for the keeper-hands seam; the `pPunt` 0/1 branches; the throw
  lower bound and punt-by-foot; rule-off bit-identity at unit level (the gate covers it); an in-match test of the support
  hold carry and of dt 0.04; a sim-core test of the sent-off restart fix (`takerFor` fallback); `cross.zones` SIGNED regex
  is broad; the EventType parse in `pass-length.test.ts` stops at the first blank line.
- **10d gate not cleared at half-time:** the support gate is keyed by carrier id and the restart phase returns before the
  support branch, so at most 1 s of stale state for the same carrier. Not Important.

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

## Results: P4 (2026-10-19)

**Switched on** in `DEFAULT_PARAMS`:
- `tackle.rule` 1 (T2), `fouls.rule` 1 (T3/T4), `aerial.rule` 1 (T4 aerial), `transition.rule` 1 (A4) and `press.rule` 1 (A5
  team pressing).
- `firstTick.scopeRule` 1 (M5), `release.rejudge` 1 and `release.capS` 6 (M6).
- **`marking.rule` 0 — built, but ships off** (A5 zonal marking, user ruling; see "Zonal marking and the press").

**Values the tasks set:**
- **T2:**
  - `tackle.base` +0.25 (Task 3's sweep; win 0.480 with T2 alone);
  - front +0.35 and behind −0.35 at 60° / 120°;
  - support +0.4 per defender within 5 m, up to 2;
  - −0.1 per m/s of carrier speed;
  - box +0.3.
- **T3:**
  - zone 1.0 (own half), linear to 0.4 at u = 17.5, 0.4 beyond, 0.12 in the box;
  - angle front 1.0, side 1.6, behind 2.4;
  - `defending.foulPerTackle` is the base.
- **T4:**
  - `fouls.attackerShare` 0.05 below `shieldSpeedMax` 2 m/s, and `takeOnShare` 0.15;
  - `aerial.contestM` 2, `bHeading` 3, `bSlack` 1, `foulShare` 0.13.
  - **Shipped in the calibrated file** (through the knobs): `attackerShare` **0.075** (`attacker_foul` 1.5),
    `aerial.contestM` **2.25** (`aerial_contest`) and `foulShare` **0.195** (`aerial_foul` 1.5).
- **A4:**
  - join table 0.8 / 0.3 / 0.23 / 0.13 / 0.07 at 0–5 / 5–10 / 10–15 / 15–20 / 20–30 m (default). **Shipped:**
    1.0 / 0.375 / 0.2875 / 0.1625 / 0.0875 (`counter_join` 1.25);
  - window 3 s, speed 4.5 m/s;
  - pause 1.5 s at 0.55 × vmax beyond 10 m;
  - recovery from 2.5 to 8 s, peak 5–6 s, `recoverRatePerS` 0.05, behind × 0.33, runs of 1.5–3 s at 0.9 × vmax.
- **A5 pressing:**
  - triggers back to goal × 2 (1.5 s, ball faster than 5 m/s) and own third × 2;
  - second presser within 12 m (radius 15 m, share 0.45, shadow 4 m);
  - role weights CB 0.6, FB 0.8, DM 1, CM 0.9, AM 1.6, W 1.4, ST 0.55;
  - **`rateScale` 0.5** (Task 7 set 0.1; Task 10's sweep, below).
- **A5 marking (off):** `laneShare` 0.4, `cbStepM` 10, `dropMps` 1.
- **M5:** boot blocks skip a release from the hands; clearances are judged with `firstTick.rule` 0.
- **M6:** cap 6 s on a free release; re-judge when an opponent comes within `pressedM`.
- **Script nudges** (scripts only, never the bounds; scripted matches only):
  - `script.pressSurge` 4 → 20, because the press hazard is now scaled by `rateScale`;
  - `script.howlerSave` 1.5 → 2, because the recalibrated keeper lets in 44 % of shots on target.

**New knobs** (ruling 26):

| Knob | Range |
|---|---|
| `attacker_foul` | 0.5–1.5 |
| `aerial_contest` | 1.5–2.5 m |
| `aerial_foul` | 0.5–1.5 |
| `counter_join` | 0.75–1.25 |
| `recovery_rate` | 0.5–1.5 |
| `press_rate` | 0.75–1.25 |

- `yellow_per_foul` now starts at 0.15 with range 0.10–0.25.
- The `lane_share` knob was added, then removed (user ruling): it is inert while marking is off. `marking_weight` stays, as
  the lever for ball pressure.

**Sources:**
- C1, C2 and C4: `docs/realism/realism-report.md` (16 matches, seeds 2000–2015).
- P4 targets, discipline, C3, physical bands, territory and the P3 passing rows: `docs/realism/realism-deep-report.md`
  (64 matches, seeds 2000–2063).
- Real-target tests: `duels-targets.test.ts` (4 matches, test teams).

### Deviations from the plan

Planning rulings that changed the spec:
- **2:** T2 terms as a logit on tackling minus dribbling. The support term is the spec's +0.4 per defender within 5 m, but
  the targets are measured the real way (G3: defenders within 3 m, tackler included; alone 0.51, supported 0.60).
- **3:** T3 zone measured in the carrier's attacking frame. **Side × 1.6** is a ruling (the spec gives only behind × 2.4).
- **6:** No jumping attribute. Contests come from `resolve.ts` (no draw there); the winner is drawn on the `aerial` stream
  from heading and reach slack.
- **7:** Aerial fouls are decided at release and stored on the flight.
- **10:** A4 joiners replace the spec's "nearest player only" for 3 s.
- **11:** The pause is read as holding course.
- **12:** Recovery hazard on a ramp.
- **15:** The presser is ranked by distance ÷ role weight.
- **16:** CBs step out only while within 10 m.
- **17:** Zonal lane spot from the ball, not the carrier.
- **19:** M5 without touching `resolve.ts`.

Changes made on measurement:
1. **G3 (Task 2).** "Support helps" is measured as defenders within 3 m including the tackler, with bound ≥ 0.05. The
   spec's 0.36 "no support" bin has no sim analogue.
2. **G25.** Shielding fouls count as defensive actions for the attacking team in PPDA (`stats/src/engine.ts`). This shows
   in the stats golden; it is unchanged.
3. **G26.** The A4 join rows are reach rates (reaching 3 m of the ball within 3 s), not join decisions.
4. **Task 5.** Aerial duels reached about 21 per match against 47 at the brief's `contestM` range. Only the intended
   receiver anticipates a high ball, and defenders do not mark landing spots (P5). Task 5's ruling kept `foulShare` at
   0.13 per duel in the defaults; the tuner's `aerial_foul` 1.5 (in range) ships 0.195, which reverses it through a knob.
5. **Task 7.** `rateScale` 0.1 hit 405 press episodes but cut fouls from 16.1 to 9.9. Task 10 raised it to 0.5 (below).
6. **Task 10, `foul_per_tackle` start.** Sweep with everything on (16 matches):

   | foulPerTackle | Fouls per match |
   |---|---|
   | 0.2 | 10.3 |
   | 0.25 | 11.7 |
   | 0.3 | 12.9 |
   | 0.45 | 16.8 |
   | 0.6 | 17.9 |

   Defender fouls are already on target at 0.45 (14.6). The shortfall is attacker and aerial fouls, which follow duel
   volume. The tuner started at 0.45.
7. **Task 10, test changes** (no bound widened):
   - **Mechanism tests of retired or single rules pin P4 off (F4):** the offball rule-0 support test, `passing` completion,
     the aerial in-match test, and `tackle.test` `onAlone` (`capS` 0). The support-rule-1 crowd test runs on the shipped
     defaults (its pin was only needed while zonal marking was on; final review).
   - **`transition.test`:** the inert-rule window is 6000 ticks. Joiner distances are read where `noteLoss` runs: before
     movement for a tackle (`ownedTick`), after it for an interception or a loose-ball recovery (`ballTick`).
   - **`params.test`:** asserts the switches and marking off.
8. **Final review, half-time fix.** The half-time reset cleared players' intents but not the A4 transition or the A5
   press state. A loss in the last seconds of the first half carried into the second-half kickoff: its pause, its
   recovery runs and its team-press-off window (3 of 12 seeds in the review's probe). The reset now clears `transition`,
   `press` and `pressedBy` (ruling 9: a restart is not a loss). New test: no carry-over on seeds 1–6, at least one with a
   loss in the last 8 s. It moved the gate from 20.26 to 20.49 and the reports by noise.
9. **Final review, code tidy.**
   - The `resolve.ts` keeper comment is corrected: a keeper first to a contact takes it outright, with no duel, and
     keepers never contest.
   - The unused `_def` and `_owner` parameters are removed, and the `./resolve.js` imports merged.
   - `duels-targets.test` notes that its two passing T2 comparisons are fragile.

### Zonal marking and the press (user rulings)

**First recalibration, everything on** (`marking.rule` 1, `rateScale` 0.1): held-out loss **47.79**, blocked. Free space
(off-ball attacker to nearest defender) was 9.63 m against 6.03 real (z +7.58, 17.2 of the loss). Ablating each P4 switch
on the gate seeds:

| Off | Loss | Main change |
|---|---|---|
| — (all on) | 47.79 | free space z +7.58 |
| tackle | 39.32 | free space +7.09 |
| fouls | 40.04 | fouls 11.3 (z −2.51) |
| aerial | 39.64 | free space +7.21 |
| transition | 41.12 | free space +7.42 |
| press | 60.26 | free kicks 45 (z +4.51), fouls 33 |
| **marking** | **28.94** | ball pressure 7.19 (z +4.15) |
| M5 | 40.38 | free space +7.40 |
| M6 | 49.51 | free kicks 40.4 |

Only zonal marking moved the dominant term; the 39–41 rows are within 16-match noise.

**User ruling: zonal marking ships off and is carried to P5.**

**Second recalibration (marking off):** held-out loss **29.26**, but the gate failed:
- the physics check had 1 statistic inside the envelope against 2 required (`hsr25` 51.31 against a maximum of 51.05);
- ball pressure was at z **+4.11**.

The knobs-versus-rules split (16 gate seeds):

| Knobs | P4 rules | Ball pressure (m) |
|---|---|---|
| Tuned or P3 | on | 7.0–7.2 |
| Tuned or P3 | off | 5.9 |
| Single ablations of every rule but the press | on | z 3.8–4.1 |
| Press off | on | 6.17 (z 2.09), but loss 39 |

So `rateScale` 0.1 pressed too rarely to keep a defender near the ball; zonal marking had hidden it (ball pressure +0.88
with marking on).

**User ruling: sweep `rateScale`.**

| rateScale | Ball pressure (z) | Loss | Physics inside |
|---|---|---|---|
| 0.2 | +3.48 | 26.14 | 2 |
| 0.3 | +3.17 | 27.43 | 2 |
| **0.5** | **+2.95** | 29.79 | 2 |

0.5 is the lowest under 3, so it was committed and recalibrated. Press episodes stay in band: 391 before the tuner, 409 on
64 matches.

**Free kicks above fouls.** Every `free_kick` restart follows a foul or an offside; nothing else. With marking on, offsides
were 12.3 per match against 6.7 in P3 (3 seeds). On 16 seeds the split was:

| Configuration | Offsides per match |
|---|---|
| P3 | 8.5 |
| P4 rules alone | 9.3 |
| Tuned knobs alone | 9.0 |
| Both | 11.75 |

Both contribute and no single switch accounts for it. There is no P4 bug: the offside call is not P4 code. With the final
parameters, free kicks are 27.0 against 18.6 fouls (8.8 offsides) on the gate seeds, the P3 gap again.

### Calibration

| Run | Start | Tuner loss | Held-out loss | Knobs that moved |
|---|---|---|---|---|
| 1 (from P3, all P4 on incl. marking; 24 matches, 1 round) | 52.13 | 35.29 | **47.79** (blocked) | decision_scale 1.1 → 1.35, shot_bias 1.2 → 0.8, long_shift 0 → −1, cross_shift 0 → 0.5, yellow_per_foul 0.15 → 0.2, restart_scale 1.25 → 1.05, shape_width 1.4 → 1.5, deflect_behind 2 → 1.75, aerial_contest 2 → 2.25, aerial_foul 1 → 1.25 |
| 2 (from run 1, marking off) | 24.09 | 23.71 | **29.26** (blocked: physics, ball pressure) | save_b0 1.8 → 1.55 |
| 3 (from run 2, `rateScale` 0.5) — **ships** | 32.55 | **19.37** | **20.26**; **20.49** after the half-time fix | decision_scale 1.35 → 0.85, shot_bias 0.8 → 0.4, long_shift −1 → −0.5, xg_b0 −1.5 → −1.25, exec_scale 1.15 → 2.05, **tackle_rate 0.275 → 0.1 (min)**, **foul_per_tackle 0.45 → 0.6 (max)**, **yellow_per_foul 0.2 → 0.1 (min)**, deflect_behind 1.75 → 1.25, relax_cap 0.6 → 0.55, marking_weight 0.75 → 1, support_space 16 → 20, support_space_att 11 → 13, attacker_foul → 1.5 (max), aerial_foul 1.25 → 1.5 (max), counter_join → 1.25 (max) |

| 4 (from run 3; `tackle_rate` 0.2–0.4, `foul_per_tackle` ≤ 0.4; final review) | 27.47 | 20.32 | **26.56** (blocked: physics 1 inside, hsr25 61.7 against 51.05) | decision_scale 0.85 → 0.6 (min), shot_bias 0.4 → 0.8, choice_temp 1 → 1.2, xg_b0 −1.25 → −1, save_b0 1.55 → 1.3, clear_to_touch 0.05 → 0 (min); tackle_rate stayed 0.275, foul_per_tackle 0.4 (max) |

- **The tuner buys fouls with fewer tackles that foul more often, and cards with the lowest booking rate.** Ground duels
  fall to 112 against 155 real.
- **Run 4 (not shipped; user ruling: keep run 3 plus the half-time fix).** With `tackle_rate` narrowed to 0.2–0.4 the tuner
  stayed at 0.275, about 2.75 × the tackle attempts, and `hsr25` (metres above 25 km/h) left its real envelope: 61.7 against
  51.05. Setting only `tackleRatePerS` back to 0.1 on run 4's params brought it inside again (45.6, loss 23.19). Run 3's
  params on the fixed engine give 20.49 with `hsr25` 42.4. So `tackle_rate` 0.1 is what keeps sprinting inside the
  envelope, at the cost of duel volume: a **tackle–sprint link**, carried to P5.
- `counter_join` 1.25 makes the 0–5 m join chance exactly 1.0 (0.8 × 1.25), so the knob's `min(1, x)` never clips and
  the table keeps its shape. The cost: the 0–5 m row is now deterministic, and its reach is 0.933 against 0.79 real
  (further from real). A higher `counter_join` would clip, change the shape and need a ruling.
- `box_intensity`, `recovery_rate` and `press_rate` did not move.

**Knobs on their bounds (user ruling: accepted as shipped, carried to P5).** In the shipped calibration (run 3) nine knobs
sit on a range limit:

| Knob | Value (bound) | What it costs |
|---|---|---|
| `tackle_rate` | 0.1 (min) | ground duels 153.5 before the tuner (MET) → 112 (real 155); T2 test NOT MET (0.568 on 88 attempts); attacker fouls 0.9 against 3 (they follow tackle volume). Raising it pushes `hsr25` out of its envelope (run 4) |
| `foul_per_tackle` | 0.6 (max) | the T3 chance **saturates**: in the carrier's own half (zone 1) a foul from behind is 0.6 × 2.4 = 1.44, clipped to 1, and from the side 0.96, so nearly every lost side or behind tackle there is a foul and the fitted angle shape 1 : 1.6 : 2.4 collapses to about 1 : 1.6 : 1.67. Ruling 26 gave the angle factors no knob; the base flattened them. Side and behind are 75 of the 88 test-team attempts, so the clip covers most tackle fouls, which is why fouls respond weakly near the top (16.8 at 0.45, 17.9 at 0.6) |
| `yellow_per_foul` | 0.10 (min) | yellows 3.30 against 5.0, cards per foul 0.101 against 0.14: the floor did not keep cards near real, the tuner went to it |
| `marking_weight` | 1 (max) | the lever for ball pressure is at its limit: ball pressure z +2.70 is held at a bound |
| `support_space` | 20 (max) | supporters keep the widest space allowed; support within 15 m 1.92 against 2.10 |
| `attacker_foul` | 1.5 (max) | shielding fouls 0.9 against 3 even at the top of the range |
| `aerial_foul` | 1.5 (max) | `foulShare` 0.195 (Task 5's ruling 0.13 reversed through the knob); aerial fouls 4.0 MET but per duel above real |
| `counter_join` | 1.25 (max) | 0–5 m join chance exactly 1.0 (no clipping, shape kept); 0–5 m reach 0.934 against 0.79 |
| `switch_shift` | 2 (max, since P3) | switches 0.144 against 0.061 (P3 gap) |

**Pre/post-tuner duels** (16 matches, seeds 2000–2015):
- **MET → NOT MET because of a knob:**
  - ground duels 153.5 → 114.4 (`tackle_rate` 0.1);
  - penalties 0.31 → 0.19 (the same, with 16-match noise).
- **NOT MET → MET:**

  | Row | Before → after |
  |---|---|
  | Tackle win | 0.535 → 0.509 |
  | Front | 0.595 → 0.563 |
  | Behind | 0.520 → 0.492 |
  | Defender fouls | 25.2 → 13.3 |
  | Aerial fouls | 2.9 → 4.1 |
  | Sent off | 0.44 → 0.25 |
  | Recovery at 10 s | 0.081 → 0.099 |

### Results

- **Gate: MET.**
  - Held-out loss **20.49** (run 3 plus the half-time fix), maxDrift 0 against the refreshed baseline.
  - Physics 2 of 13 inside (`max_speed`, `hsr25` 42.4 against 51.05).
  - Of the 19 scalars, 13 within 1 SD and 18 within 2 SD (completion −2.11 the one beyond).
  - **Every gated statistic, spatial ones included, has |z| < 3.** The largest:

    | Statistic | z |
    |---|---|
    | Ball pressure | +2.70 |
    | Completion | −2.11 |
    | Free space | +1.89 |
    | Line height | −1.88 |
    | Peak speed | −1.70 |
    | Width in possession | +1.65 |

  - **Concern, recorded only, the gate unchanged:** the gate's |z| < 3 assertion (`GATE_Z`) covers only the 19 scalar
    statistics. The seven spatial ones enter the loss but are never bounded on their own. Ball pressure at z +4.11 passed
    that check in the second candidate.
- **C1: NOT MET.** 15 of 19 within 1 SD (needs 16; P3 12), 19 within 2 SD (MET part; P3 17). Outside 1 SD:

  | Statistic | z |
  |---|---|
  | Completion | −1.94 |
  | Peak speed | −1.72 |
  | Distance | −1.68 |
  | In-play share | −1.35 |

- **C2: MET** (P3 NOT MET):

  | Statistic | z |
  |---|---|
  | Free kicks | +0.93 |
  | Goals | +0.43 |
  | Shots on target | −0.78 |
  | Fouls | −0.92 (18.6 against 22.9; P3 −2.05) |

- **C3: MET.** Team shot-share SD 0.175 on 64 matches (P3 0.227; needs ≤ 0.18).
- **C4: MET** (contract |z| < 3):

  | Metric | z |
  |---|---|
  | Width in possession | +1.70 |
  | Width out of possession | +1.18 |
  | Defending length | −1.51 |
  | Line height | −1.78 |
  | Ball pressure | +2.36 |
  | Support within 15 m | −1.31 |
  | Free space | +1.70 |

- **Free space, width and length** (16-match report):

  | Measure | P3 | Task 8 (marking on) | P4 final (marking off) | Real |
  |---|---|---|---|---|
  | Free space (m) | 6.6 | 9.0 | 6.8 | 6.0 |
  | Width out of possession (m) | 38.2 | 30.9 | 39.6 | 37.0 |
  | Defending length (m) | 29.6 | 27.1 | 29.7 | 32.2 |

- **P4 targets** (64 matches; Task 2's baseline from `p4-duels-baseline.md`, 16 matches, P3 engine):

  | Measure | Real | Task 2 | P4 | Status |
  |---|---|---|---|---|
  | Tackle attempts won | 0.48 | 0.517 | 0.535 | NOT MET (band top 0.53) |
  | — from the front | 0.54 | 0.566 | 0.561 | MET |
  | — from the side or behind | 0.45 | 0.510 | 0.530 | NOT MET |
  | — tackler alone within 3 m | 0.51 | 0.519 | 0.495 | MET |
  | — 2+ within 3 m | 0.60 | 0.523 | 0.619 | MET |
  | Ground duels per match | 154.7 | 150.9 | 111.8 | NOT MET (`tackle_rate` 0.1) |
  | Aerial duels per match | 47 | 8.1 | 29.5 | NOT MET (P5) |
  | Fouls per match | 22.9 | 13.4 | 18.3 | NOT MET |
  | Defender fouls | 15 | 13.4 | 13.3 | MET |
  | Attacker fouls | 3 | 0 | 0.9 | NOT MET |
  | Aerial fouls | 5 | 0 | 4.0 | MET |
  | Free kicks within 30 m | 0.86 | 0.69 | 1.30 | NOT MET (over) |
  | Penalties (64 only) | 0.43 | 0.12 | 0.23 | NOT MET |
  | Yellows | 5.0 | 6.94 | 3.30 | NOT MET (`yellow_per_foul` 0.1) |
  | Sent off (64 only) | 0.29 | 0.25 | 0.30 | MET |
  | Cards per foul | 0.14 | 0.414 | 0.101 | NOT MET |
  | Join (reach 3 m in 3 s), 0–5 m | 0.79 | 0.895 | 0.934 | NOT MET |
  | — 5–10 m | 0.28 | 0.237 | 0.311 | MET |
  | — 10–15 m | 0.23 | 0.101 | 0.120 | NOT MET |
  | — 15–20 m | 0.13 | 0.046 | 0.056 | NOT MET |
  | — 20–30 m | 0.07 | 0.022 | 0.021 | NOT MET |
  | Losers within 5 m in 3 s | 2.29 | 1.85 | 1.95 | NOT MET |
  | — 3 or more | 0.43 | 0.230 | 0.291 | NOT MET |
  | Counter-press peak speed (m/s) | 4.5 | 4.81 | 4.52 | MET |
  | Regained within 5 s | 0.40 | 0.331 | 0.408 | MET |
  | Running back, 0–1.4 s | 0.02 | 0.111 | 0.048 | NOT MET |
  | — at 2 s | 0.06 | 0.135 | 0.100 | NOT MET |
  | — at 3 s | 0.10 | 0.153 | 0.203 | NOT MET |
  | — at 5–6 s | 0.15 | 0.145 | 0.239 | NOT MET |
  | — at 10 s | 0.12 | 0.062 | 0.098 | MET |
  | Pause speed ratio | 0.87 | 1.102 | 0.977 | NOT MET |
  | Press episodes per 90 | 405 | 272 | 410 | MET |
  | ≥ 3 engaged | 0.049 | 0.031 | 0.058 | MET |
  | Lift, back to goal | 2.08 | 0.81 | 0.84 | NOT MET |
  | Lift, own third | 1.97 | 1.22 | 1.25 | NOT MET |
  | Pressers CM / W / FB | .37 / .19 / .13 | .408 / .113 / .145 | .379 / .140 / .155 | CM, FB MET; W NOT MET (0.140 just under 0.14) |
  | Pressers AM / ST / CB | .11 / .11 / .10 | .042 / .165 / .127 | .045 / .149 / .132 | AM NOT MET; ST, CB MET |
  | Press-run peak speed (m/s; info) | 5.1 | 5.23 | 5.01 | (P4 gap closed) |
  | Open by 3 m per pass | 7.96 | 8.10 | 8.12 | MET |
  | Clear lanes per pass | 4.95 | 6.01 | 5.99 | NOT MET (zonal marking off) |
  | Distance per outfielder (km; info) | 10.88 | 9.16 | 10.04 | closer |

- **Discipline** (64 matches, against P3):

  | Measure | P3 | P4 | Real |
  |---|---|---|---|
  | Fouls | 13.4 | 18.3 | 22.9 |
  | Cards per foul | 0.414 | 0.101 | 0.14 |
  | Yellows | 6.94 | 3.30 | 5.0 |
  | Sent off | 0.75 | 0.30 | 0.29 |
  | Penalties | 0.09 | 0.23 | 0.43 |

  Sending-offs are back at real (0.30 against 0.29, MET). Ruling 26's narrower `yellow_per_foul` range did not keep cards near
  real: the tuner went to its 0.10 floor and pushed cards below real (yellows 3.30 against 5.0, cards per foul 0.101 against
  0.14).
- **P3 passing rows** (64 matches, P3 → P4):
  - tightly marked 0.100 → **0.121** (NOT MET by 0.001; zonal marking off);
  - near-1 completion 0.474 → 0.424;
  - **release median 2.00 → 1.60 (MET)**, over 3 s 0.217 → 0.164 (MET): `decision_scale` 0.85 plus M6;
  - pressed median 0.50 (MET); pressed within 1 s 0.786 → 0.787;
  - completion to available 10–20 m 0.902 → 0.851 (NOT MET; `exec_scale` 2.05);
  - passes 914 (MET).
- **Physical bands** (64 matches, P3 → P4, real):

  | Band | P3 | P4 | Real |
  |---|---|---|---|
  | Walking (km) | 2.24 | 2.00 | 3.50 |
  | High-speed + sprint (km) | 0.80 | 0.71 | 0.69 |
  | Accelerations | 253 | 297 | 50 |
  | Live running (m/min) | 140 | 150 | 130–150 |
  | Dead-ball running (m/min) | 45 | 56 | 65 |
  | Sprints | 4.0 | 4.2 | 8.4 |
  | Distance (km, 16-match report) | 9.16 | **9.97** | 10.88 (z −1.68; P3 −3.17) |

- **Territory** (64 matches): territory SD 4.8 m (P3 5.6; real 1.9). Centroid minus ball with the ball −0.6 (P3 −0.4;
  real +3.9), without it −6.4 (P3 −7.2; real −9.5).
- **Real-target tests** (`duels-targets.test.ts`, calibrated params, test teams, seeds 7, 9, 11 and 13):

  | Target | Measured | Bound | Status |
  |---|---|---|---|
  | Tackle attempts won | 0.568 (88 attempts) | 0.43–0.53 | NOT MET, `it.fails` |
  | Front − behind | +0.055 (13 / 75) | ≥ 0.04 | MET (within noise: 13 front attempts, SE about 0.14; the deep report agrees, +0.054) |
  | Supported − alone | +0.080 (34 / 54) | ≥ 0.05 (G3) | MET |
  | Defender fouls | 11.75 | 12–18 | NOT MET, `it.fails` |
  | All fouls | 18.75 | 19–27 | NOT MET, `it.fails` |
  | Aerial duels | 35.5 | 40–54 | NOT MET, `it.fails` |
  | Losers within 5 m in 3 s | 1.954 | 2.0–2.6 | NOT MET, `it.fails` |

  **M10:** the three on-bound tests pass unchanged (punts per team-match, punt share, positioning deep count); no
  `it.fails` was needed.
- **Manager A/B** (rules against none, 40 seeds, for information): xG difference −0.276 per match (95 % interval −0.640 to
  0.081), no detectable difference.

### Gaps outside P4

- **Zonal marking needs a free-space lever.** Built, it delivers its own targets (tight 0.079 and clear lanes 4.77 in Task
  8), but defenders stand 9.6 m from off-ball attackers. No `laneShare` in 0.3–0.5 restores it.
- **Duel volume.** Ground duels are 112 against 155, because the tuner pins `tackle_rate` at 0.1 and `foul_per_tackle` at
  0.6 to buy fouls. Attacker fouls (0.9 against 3) follow tackle volume. Raising `tackle_rate` breaks the sprint envelope
  (run 4).
- **Aerial duels:** 30 against 47. Landing-spot marking and reaction (P5).
- **Penalties:** 0.23 against 0.43. Box occupancy (P5, user decision).
- **Counter-press and recovery shape:** joiners from 10 m and further reach the ball half as often as real; recovery runs
  peak early (0.20 at 3 s against 0.10); the pause holds speed (0.98 against 0.87).
- **Press triggers:** back to goal 0.84 and own third 1.25 against about 2. The lifts multiply a hazard that is rarely what
  starts a press.
- **Accelerations** are 297 against 50 (P2 carry).

### Carried to P5/P6

- **A5 zonal marking** (`marking.rule`), off with values intact. Needs a free-space lever, and then `lane_share` back as a
  knob.
- **A5 press:** triggers and the second presser are on, at `rateScale` 0.5; the trigger lifts are NOT MET. AM presser share
  0.045.
- **T4 aerial volume** (landing spots), **penalties** (box occupancy), **attacker fouls**.
- **The tackle–sprint link and the discipline knobs** (user ruling: ship run 3).
  - With `tackle_rate` at 0.275 (run 4), `hsr25` reached 61.7 against 51.05; at 0.1 it is 42.4. More tackles mean more
    sprinting than real.
  - So duel volume (112 against 155), yellows (3.30 against 5.0, `yellow_per_foul` at its 0.10 floor) and the T3
    saturation (`foul_per_tackle` 0.6 × behind 2.4 clips to 1 in the own half) are carried together.
  - P5 needs a lever on sprinting after a tackle, or a duel-volume statistic in the gate, before narrowing the knobs again.
- **Keeper claims in aerial contacts** (final review 5): a keeper who is first to a contact takes it outright with no duel
  (rule 0 drew a header). Untested; it belongs with keeper catch volume.
- **`resolve.ts` scope** (final review 6): the near-miss collection runs for every contact, ground balls included (identical
  at rule 0). `aerialWinShare` is a step-side helper living in the sensitive file. Optional: move it to `duel.ts`, and
  collect near misses only above `controlHeightM`.
- **A voided flight foul resolves without a reception** (final review 7). If `applyFlightFoul` drops the foul (offender
  sent off, replaced or booked since release), the pass resolves with no reception event and no first-touch draw. It is
  rare but breaks "every completed pass has a reception". Decide the fallback.
- **Python fixture tests** (final review 11) for the recovery curve, the pause ratio, the trigger lifts and the presser
  roles. The back-to-goal lift reads 0.84, below 1, although the engine doubles the hazard; a measurement bug is not ruled
  out.
- **The passing T2 real-target comparisons are fragile** (final review 12): they rest on 13 front attempts and flip sign
  when read before the step's movement. The mechanism guard is `tackle.test`.
- **The A4 recovery curve and the pause end** (Task 6).
- **The release median** reached 1.60 here through `decision_scale`; M6 alone left it at 2.0.
- **`GATE_Z` omits the spatial statistics** (recorded, not changed).
- **The `index.ts` seam exports** (final review 9): about 20 `@internal` seams are published; acceptable as is, tidy behind
  `./testing` later.

### Rulings

The plan's rulings 1–26 (plan 8d) hold as written, with the deviations above. The controller and user rulings during
execution are in the plan's ledger:
- the pre-flight findings G1–G29;
- aerial `foulShare` 0.13;
- duels NOT MET carried to P5;
- `rateScale` 0.1 in Task 7, then 0.5 here;
- fouls restored through `foul_per_tackle`;
- **zonal marking off** and **`lane_share` dropped** (user, Task 10);
- the **`rateScale` sweep** with press-off as the fallback (user, Task 10);
- after the final review: fix the half-time leak, and try narrower discipline knobs (run 4); when run 4 failed the physics
  check, **ship run 3's calibration with the half-time fix** (user);
- seeds re-picked by each file's rule (below).

**Seeds and fixtures re-picked** (each by its file's rule):

| Fixture | Change |
|---|---|
| `whatif.test` forced window | 1 → 5 |
| `carriers.test` and `physics.test` parity | 4243 → 4244 |
| Manager `MOMENTS_SEED` (situation, moments, what-if, agent, e2e) | 11 → 13; golden renamed `situation-m-13-minute_60.json` |
| Advisor explainer pass | 3 → 15 |
| API library fixture | 5 → 4 |
| Agents `ERROR_SEED` / `SEED` | 62 → 65 / 2 → 6 (`find_test_seed.py`: 84 error-shape seeds of 1–1400; 56 general of 1–100) |
| Gateway e2e | 62 → 65 (with `ERROR_SEED`) |

The stats and manager goldens were regenerated: same fields; PPDA about 3.7 (G25), xG at similar magnitudes.

`pnpm library` was not rebuilt. It needs the agent service and the LLM.

### P4 merge checklist

- Regenerate every `out/` run folder in main.
- Regenerate `realism-deep.md` (`pnpm realism:deep`).
- Run `pnpm library` once the user OKs it (agent service and LLM).

## Results: P5 (2026-10-20)

**Switched on** in `DEFAULT_PARAMS` (and so in the calibrated file):
- `setAttack.rule` (S1, S4), `setDefend.rule` (S2, S3), `setShapes.rule` (S5–S7), `deadBall.rule` (S8),
  `keeperRestarts.rule` (G3), `directFk.rule` (S9).
- `roleMoves.runRule` (A6 runs and overlaps) and `roleMoves.rotateRule` (A6 W inside, FB inversion, CM drop).
- **`marking.rule` 1** (P4 A5 zonal marking, carried) with the P5 cap `marking.maxGapM` 5, and `marking.landingRule` 1.
- `transition.pauseRule` 1 (pause at 0.855 of the speed at the loss, 0.5 s ramp), `release.freeRule` 1 (`freeS`).
- `press.rule` already shipped 1 in P4 (ruling 21: nothing to switch).
- **No switch was turned off.** The gate passed with everything on, so the fallback order (rotations, runs, zonal marking,
  pause; user Q2) was not used.

**Values the tasks set** (defaults; the calibrated file differs only where a knob moved, below):
- **S1/S4 (Task 3):** the spec's corner and pooled free-kick tables, `fkWideShiftU` 3 (end of the grid), hold 2 m, run 2 s at
  0.75 vmax, rest keepers 1.4 / 2.7 / 2.3 / 4.1 at u 20–25.
- **S2/S3 (Task 4):** `manM` 12, `goalSideM` 1, zonal six-yard spots then the penalty spot, outlet 0.24, walls 3–4 central and
  1–2 wide (0.76), 9.15 m, shade 1 m, jitter 0.5 m. **`wallGapM` 1.5** (Task 14, Task 4's option; ruling 9 said 0.6).
- **S5–S7 (Task 5):** the real goal-kick and kickoff tables; throw-in support `throwShort` 1 at `throwShortM` 10, marked at 0.75.
- **S8 (Task 6):** the real lognormal medians and IQR sigmas, `minS` 3, `lateGrowth` 0.8, walking 1–1.5 m/s, settle times,
  taker pause 0.5–1 s.
- **G3 (Task 7):** `fkShare` 0.5, `longShift` 2.5, `longErrorScale` 2.
- **S9 (Task 8):** `shotShift` 4 (calibrated **4.5**), `xgLogit` 0.45, `maxDistanceM` 35.
- **A6 (Tasks 9, 10):** run weights ST 0.45 / W 1.4 / AM 0.5 / FB 0.6, `overlap.ratePerS` 0.1, `inside` 0.5 for 4–6 s,
  `invert` 0.1, `cmDrop` 0.3, `jogMps` 3.5.
- **Marking (Task 11):** `maxGapM` 5, `laneShare` 0.4, landing 1 m goal-side, react within 10 m.
- **Pause (Task 12):** `pauseDip` 0.855, `pauseEndS` 0.5. Recovery and press values unchanged (F23; nothing measured helped).
- **Release (Task 13):** `freeS` [0.6, 1.9] (calibrated [0.48, 1.52] through `decision_scale` 0.8).
- **Script nudge** (script only, bound unchanged): `script.momentumLogit` 1 → 1.25.

**New knobs** (ruling 27): `fk_shot` 3–5, `gk_long` 1.5–3.5, `gk_long_error` × 0.75–1.25, `role_rate` × 0.75–1.25 (the four
A6 `ratePerS` and the run start weights), `max_gap` 3.5–6.5, `lane_share` 0.3–0.5 (re-added: zonal marking is on).
Changed: `restart_scale` also scales `deadBall.medianS`, range 0.8–1.25 (was 0.6–2.5); `decision_scale` also scales
`release.freeS`, range 0.8–1.2 (was 0.6–2.5).

**The gate** (user Q1 (a)): the realism gate now asserts |z| < 3 on every gated statistic, the seven spatial ones included,
and prints their z. The 1-SD and 2-SD counts stay over the 19 scalars. A tightening only.

**Sources:** C1, C2 and C4 from `docs/realism/realism-report.md` (16 matches); P5 targets, the P4 and P3 rows, C3, physical
bands and territory from `docs/realism/realism-deep-report.md` (64 matches); Task 2's baseline is
`docs/realism/p5-setpieces-baseline.md` (16 matches, P4 engine, P5 rules 0).

### Deviations from the plan

Planning rulings that changed the spec: 3 (one helper module, four behaviour modules), 5 (restart precedence), 6 (hold and
run; `fkWideShiftU` 3), 7 (rest keepers by role order, deepest first), 8 (nine in the box, F19), 9 (wall on the 9.15 m arc,
F21; gap 1.5 here), 10, 11 (lognormal delays with `lateGrowth`), 12 (G3 completion through `errorScale`, no `execute.ts`),
13, 14 (S9 through `restartShot`), 15 (runs and overlaps share `run_in_behind`, with `overlap?: true` in `types.ts`), 16
(`rotate` intent with `since`), 17 (cap on the final zonal target), 18 (landing marking; `marksFor` gains the landing CB,
controller ruling), 20, 21 (press values only), 22.

Measurement changes:
1. **Dead-ball speed** (Task 6, Task 14): the Python `dead_speed_mps` row now counts moving outfielders only (0.5 m/s or more
   per 5 Hz step; mean per step, mean per spell, median over restarts), the ruled definition the in-match test uses. The
   all-outfielder reading was 0.93.
2. **Corner test** (Task 3): on − off ≥ 2 with on ≥ 4 and seed 11 added (controller ratified).
3. **Goal-kick in-match test** (Task 5): off − on ≥ 0.1, re-measured on the P4 engine (spec bound on < 0.4 unchanged).
4. **identity.test** (post-merge): the distribution block runs 9000 ticks.
5. **Task 14 test changes** (no bound widened):
   - Mechanism tests of earlier rules pin P5 to the engine they were written on (P4's F4 precedent): `choice` (G3 off),
     `direct-fk` (explicit rule 0), `release` (`freeRule` 0), `transition` (`pauseRule` 0), `setpiece-defend` (S1 off,
     `wallGapM` 0.6, the shipped 1.5 pinned in `params.test`), `rotate` in matches (other P5 rules off), the two `offball`
     support tests, `passing` completion and `fouls` in matches (P5 and zonal marking off).
   - `match.test` intent vocabulary gains `rotate` (F13).
   - New `setpieces-targets.test.ts` (below).

### Calibration

| Run | Start | Tuner loss | Held-out loss | Knobs that moved |
|---|---|---|---|---|
| 1 (from P4's knobs, every P5 rule on; 24 matches, 1 round, 88 evals) — **ships** | 25.56 | **19.15** | **23.77** | `decision_scale` 0.85 → **0.8 (min)**, `aim_noise` 1.15 → 0.95, `xg_b0` −1.25 → −1.5, `foul_per_tackle` 0.6 → 0.48, `clear_to_touch` 0.05 → **0 (min)**, `fk_shot` 4 → 4.5 |

`restart_scale` (1.05), `shot_bias` (0.4), `cross_shift` (0.5), `marking_weight` (1, max) and the five other new knobs
(`gk_long` 2.5, `gk_long_error` 1, `role_rate` 1, `max_gap` 5, `lane_share` 0.4) did not move.

Before the tuner, on the gate seeds: loss 26.55, largest |z| completion −2.65.

**Knobs on their bounds:**

| Knob | Value (bound) | What it costs |
|---|---|---|
| `decision_scale` | 0.8 (min, narrowed range) | release median 1.20 s (band edge 1.2–1.6; 1.30 before the tuner) |
| `clear_to_touch` | 0 (min) | wide clearances never kicked into touch; throw-ins 43.1 (MET) |
| `tackle_rate` | 0.1 (min, since P4) | ground duels 122 against 155 |
| `yellow_per_foul` | 0.1 (min, since P4) | yellows 3.50 against 5.0 (NOT MET), cards per foul 0.111 (MET by 0.001) |
| `marking_weight` | 1 (max, since P4) | the ball-pressure lever is at its limit (z +0.56 now, with zonal marking) |
| `support_space` | 20 (max, since P4) | support within 15 m 2.16 (MET) |
| `attacker_foul`, `aerial_foul`, `counter_join` | 1.5 / 1.5 / 1.25 (max, since P4) | attacker fouls 1.1 against 3; 0–5 m join 0.919 |
| `switch_shift` | 2 (max, since P3) | switches 0.127 against 0.061 |

`foul_per_tackle` came off its 0.6 maximum (0.48), so the T3 saturation is smaller.

**Pre/post-tuner** (16 matches each, seeds 2000–2015, full report):
- **MET → NOT MET because of a knob:** yellows 4.06 → 3.38 and cards per foul 0.135 → 0.103 (`foul_per_tackle` 0.48: fewer
  fouls); receivers tightly marked 0.115 → 0.122; supported tackles 0.591 → 0.538; goal-kick shots against 3.2 → 4.5;
  C3 0.172 → 0.232 (16 matches). The set-piece rows moved by noise only.
- **NOT MET → MET:** front tackles, free kicks within 30 m (1.62 → 1.12), ≥ 3 engaged, kickoff nearest opponent,
  attacking free-kick dead time.
- `fk_shot` 4.5 lifts the direct free-kick share 0.47 → 0.50, on the band's top edge (real 0.36).

### Results

- **Gate: MET.** Held-out loss **23.77**, maxDrift 0 against the refreshed baseline, physics **5** of 13 inside (P4 2:
  speeds of keepers, defenders and forwards, `max_speed`, `hsr25`). **Every gated |z| < 3, spatial included:**

  | Statistic | z |
  |---|---|
  | Completion | −2.64 |
  | Free space | +1.98 |
  | Defending length | −1.95 |
  | In-play share | −1.93 |
  | Distance | −1.65 |
  | Peak speed | −1.52 |
  | Line height | −1.16 |
  | Width in possession | +0.75 |
  | Ball pressure | +0.56 |
  | Support within 15 m | +0.40 |
  | Width out of possession | +0.24 |

- **C1: NOT MET.** 14 of 19 within 1 SD (P4 15), 16 within 2 SD (P4 19). Beyond 2 SD: completion −2.58, in-play −2.24,
  distance −2.13.
- **C2: MET.** Free kicks +0.83, fouls −0.73, goals +0.43, shots on target +0.03.
- **C3: NOT MET.** Team shot-share SD 0.209 on 64 matches (P4 0.175; needs ≤ 0.18).
- **C4: MET.** Width in possession +0.75, out +0.24, defending length −2.07, line height −1.26, ball pressure +0.61, support
  +0.43, free space +1.86.
- **P5 targets** (64 matches; Task 2's baseline, 16 matches, P4 engine). **26 of 43 MET, against 12 in the baseline.**

  | Measure | Real | Task 2 | P5 | Status |
  |---|---|---|---|---|
  | Corner: attackers in the box | 5.49 | 3.32 | 5.76 | **MET** |
  | — in the six-yard box | 1.07 | 0.11 | 0.00 | NOT MET (deepest spot u 43, held to 41) |
  | Corner: defenders in the box | 9.15 | 5.81 | 9.00 | **MET** |
  | — within 2 m of an attacker | 0.54 | 0.10 | 0.67 | NOT MET (`manM` 12; 10 meets it but corner shots 51 per 100) |
  | — left up | 0.02 | 0.09 | 0.00 | MET |
  | Corner: attackers kept back | 1.43 | 2.02 | 1.38 | **MET** |
  | Corner delivery completed | 0.43 | 0.65 | 0.68 | NOT MET |
  | Wide FK: attackers in the box | 3.76 | 0.16 | 1.23 | NOT MET (by construction, below) |
  | Central FK: attackers in the box | 3.09 | 0.34 | 0.00 | NOT MET (by construction) |
  | Wide FK: kept back | 2.71 | 6.64 | 2.72 | **MET** |
  | Central FK: kept back | 2.27 | 6.51 | 2.57 | **MET** |
  | Attacking-third throw-ins: kept back | 4.10 | 6.36 | 7.40 | NOT MET |
  | Central FK: wall present | 1.00 | 0.60 | 1.00 | **MET** |
  | — players in the wall | 2.46 | 0.91 | 3.98 | NOT MET (F30, by construction) |
  | Wide FK: wall present | 0.76 | 0.48 | 0.77 | **MET** |
  | Nearest wall player (m) | 9.76 | 9.44 | 8.65 | MET (edge; 8.33 at gap 0.6) |
  | Goal kicks: opponents beyond the box line | 0.18 | 0.08 | 0.00 | MET |
  | — opponents in the kicker's defensive third | 2.64 | 2.99 | 1.71 | **NOT MET** (was MET) |
  | — kicking CBs' u (m) | −31.4 | −29.2 | −30.7 | MET |
  | Middle-third throw-ins: mates within 10 m | 0.94 | 0.97 | 1.08 | MET |
  | Throw-in first contact (m) | 9.6 | 9.3 | 10.8 | MET |
  | Kickoff nearest opponent (m) | 8.6 | 2.9 | 8.0 | NOT MET (on the 8.0 edge) |
  | Goal kicks long (first contact > 32 m) | 0.48 | 0.34 | 0.18 | NOT MET (targets 32–34 m) |
  | Long goal kicks completed | 0.49 | 0.71 | 0.63 | NOT MET |
  | Goal kicks: opponents' shots in 10 s, per 100 | 0.9 | 2.5 | 4.4 | **NOT MET** (was MET) |
  | Keeper free kicks per team-match | 3.00 | 0.00 | 2.98 | **MET** |
  | Central FK shot directly | 0.36 | 0.06 | 0.50 | **MET** (top edge; `fk_shot` 4.5) |
  | Corner shots in 10 s, per 100 | 32.1 | 29.8 | 36.7 | MET |
  | Dead time: throw-ins / goal kicks / corners (s) | 13.5 / 22 / 33 | 18.8 / 31.2 / 38.3 | 14.2 / 22.7 / 35.6 | **MET** ×3 |
  | Dead time: attacking FK / other FK / kickoff (s) | 42 / 28 / 70 | 25.0 / 25.9 / 47.9 | 43.6 / 28.4 / 70.0 | **MET** ×2, MET |
  | Dead-ball speed, moving players (m/s) | 1.20 | (0.94 all players) | 1.34 | **MET** |
  | FB overlaps | 13.9 | 21.1 | 30.9 | NOT MET (further off) |
  | W comes inside | 61.9 | 19.7 | 22.5 | NOT MET |
  | FB underlap / inversion | 36.4 | 36.8 | 39.0 | MET |
  | Runs in behind | 34.6 | 56.2 | 17.0 | NOT MET (now under) |
  | — wide-lane share | 0.64 | 0.61 | 0.46 | **NOT MET** (was MET) |
  | — beyond-the-line share | 0.26 | 0.77 | 0.72 | NOT MET |
  | CM drops | 44.7 | 53.8 | 51.6 | **MET** (edge) |

  Offsides 10.7 per match (P4 10.1; ruling 25: recorded only, Question 6). In play first/last 15 minutes 0.60 / 0.44 (real
  0.62 / 0.43).
- **P4 carry-overs** (64 matches, P4 → P5):

  | Measure | Real | P4 | P5 | Status |
  |---|---|---|---|---|
  | Aerial duels | 47 | 29.5 | 34.2 | NOT MET (P6 SH2) |
  | Aerial fouls | 5 | 4.0 | 4.2 | MET |
  | Penalties | 0.43 | 0.23 | 0.20 | NOT MET (user Q4 (a): no knob) |
  | Free space (m) | 6.0 | 6.8 (16) | 7.0 | NOT MET, z +2.00, with zonal marking on |
  | Ball pressure (m) | 5.1 | 6.4 | 5.5 | MET, z +0.70 (P4 +2.57) |
  | Tight receivers | 0.09 | 0.121 | 0.115 | **MET** |
  | Clear lanes per pass | 4.95 | 5.99 | 5.24 | **MET** (zonal marking) |
  | Pause speed ratio | 0.87 | 0.977 | 0.855 | **MET** |
  | Recovery at 3 s / 5–6 s | 0.10 / 0.15 | 0.203 / 0.239 | 0.159 / 0.210 | NOT MET (shape-return movement) |
  | Recovery 0–1.4 s / 2 s / 10 s | 0.02 / 0.06 / 0.12 | 0.048 / 0.100 / 0.098 | 0.039 / 0.084 / 0.102 | NOT MET / **MET** / MET |
  | Press episodes per 90 | 405 | 410 | 539 | **NOT MET** (was MET; zonal markers near the ball count as engaged) |
  | Lifts, back to goal / own third | 2.08 / 1.97 | 0.84 / 1.25 | 0.91 / 1.12 | NOT MET |
  | Release median (s) | 1.40 | 1.60 | 1.20 | MET (lower edge) |
  | On the ball over 3 s | 0.16 | 0.164 | 0.124 | MET |
  | Losers within 5 m in 3 s | 2.29 | 1.95 | 2.06 | **MET** |
  | Tackle win | 0.48 | 0.535 | 0.544 | NOT MET |
  | Ground duels | 154.7 | 111.8 | 122.3 | NOT MET |
  | Fouls | 22.9 | 18.3 | 18.2 | NOT MET |
  | Yellows / cards per foul | 5.0 / 0.14 | 3.30 / 0.101 | 3.50 / 0.111 | NOT MET / **MET** |
  | Sent off | 0.29 | 0.30 | 0.25 | MET |

- **Physical bands** (64 matches, P4 → P5, real): walking 2.00 → 2.64 (3.50); high-speed plus sprint 0.71 → 0.42 (0.69);
  accelerations 297 → 269 (50); live m/min 150 → 159 (147); **dead-ball m/min 56 → 47 (65)**, players now walk while the
  ball is dead; sprints 4.2 → 7.5 (8.4). Distance 9.90 km on 64 (16-match 9.72, z −2.13; P4 9.97).
- **Territory** (64): SD 5.3 m (P4 4.8; real 1.9); centroid minus ball with the ball −1.3 (P4 −0.6; real +3.9), without it
  −5.0 (P4 −6.4; real −9.5).
- **Real-target tests:**
  - `setpieces-targets.test.ts` (new; calibrated params, test teams, seeds 7, 9, 11 and 13): corner attackers 5.51 and
    defenders 9.00 (43 corners), wall at 9 of 9 central free kicks, 0.00 goal-kick opponents beyond the box line (72), 3.13
    keeper free kicks per team-match, throw-in median 15.2 s (165): MET. **NOT MET (`it.fails`):** goal kicks long 0.309 (68);
    A6 intent starts per team-match overlaps 7.0, inside 53.75 (in band), runs 55.4, CM drops 14.9.
  - `duels-targets.test.ts`: "losers reach within 3 s" now **MET** (2.069 over 519 losses; it leaves `it.fails`); "front
    approaches win more" now **NOT MET** (front 0.500 of 14 against behind 0.630 of 73), the P4-noted fragility. Tackle
    win 0.609, defender fouls 11.75, fouls 17.75, aerial duels 37.75 stay NOT MET.
  - `wide.test` "deflected shots rarely end in own goals": **NOT MET** (4 over seeds 1–16, bound 3), see gaps.
  - **M10 (ruling 23):** punts per team-match 0.60 and punt share 0.16 on 64 matches are outside their bounds (1.0–2.2,
    0.24–0.40): both are now `it.fails` (4-match values 0.50 and 0.182). The positioning deep count passes (no 64-match row).
- **Manager A/B** (rules against none, 40 seeds, for information): **+0.297 xG difference per match (95 % interval 0.052 to
  0.560)**, the rule-based manager does better (P4: −0.276, no detectable difference).

### Decisions on the items handed to Task 14

- **Wall distance (Task 4):** `wallGapM` 1.5, a value; exempting wall members from separation would be a mechanism change
  outside the table. Nearest wall player 8.65 m (MET, edge).
- **Corner tight marking 0.67 and delivery completion 0.68:** recorded NOT MET. `manM` 10 meets tight but lifts corner shots
  to 51 per 100 (Task 4); no lever for delivery completion in P5's values.
- **Dead-speed row (Task 6):** aligned (above).
- **Free-kick box counts (Task 3):** NOT MET by construction (every `fk` table u ≤ 37, held 2 m back); the hold is shared with
  corners (dropping it would push the corner box over its band) and ruling 27 has no knob on tables. Kept.
- **Throw-in kept-back count (Task 3):** NOT MET at 7.40; at attacking-third throw-ins only the rest keepers and the S6 trio
  move.
- **Goal-kick long share (Task 7):** NOT MET 0.18; the long options are the S5 FB and CM spots at 32–34 m. Targets were not
  lengthened (that is a role-table or receiver-pick change), so `longShift` stays 2.5.
- **S9 at full switch-on (Task 8):** the tuner moved `fk_shot` to 4.5; the share is 0.50, the band's top. P6's xG refit moves
  it again.
- **Runs in behind (Task 9):** NOT MET 17.0; it needs a mechanism change (a minimum start gap or a break on the carrier's
  release), not done. Overlaps 30.9 (natural 21 already above the band). No re-aim.
- **W inside (Task 10):** NOT MET 22.5; `jogMps` and the start width were not changed.
- **Zonal marking (Task 11):** on at `maxGapM` 5; the gate passed (completion −2.64, free space +1.98).
- **Recovery and press (Task 12):** no values applied (F23 values unchanged); nothing measured helped.

### Gaps outside P5

- **Own goals from passes:** about 0.3–0.4 per match against about 0.1 real; `wide.test` now NOT MET (4 in 16).
- **Keeper hands distributions:** throws 3.20 and punts 0.60 per team-match (real 3.4 and 1.6); keeper passes 24.3 against
  45.4. Keeper claims are not in the deep report.
- **Open-play crosses:** 5.5 per match against 14.9 (P4 about 7). S1 loads the box only at set pieces.
- **10d support gate not cleared at half-time** (P3, Not Important): unchanged.
- **C3 shot-share spread:** 0.209 against ≤ 0.18 (P4 0.175).
- **Completion** −2.6 z and **distance** 9.7–9.9 km stay the largest gated misses.
- **Dead-ball running** 47 m/min against 65: walking at 1–1.5 m/s lowered it from 56.
- **Press episodes** 539 against 405, with zonal marking on.

### Handed to P6

- Rows P6 must re-judge: `fk_central_shot_share` (0.50, top edge), `corner_shots_per100` (36.7), `gk_long_completion`
  (0.63, NOT MET) and `aerial_duels_per_match` (34.2, NOT MET).
- Values P6 may re-set: `directFk.shotShift` (calibrated 4.5; knob `fk_shot` 3–5) and `keeperRestarts.longErrorScale`
  (2; knob `gk_long_error`).
- The mean direct free-kick xG was 0.060 at `xgLogit` 0.45 (Task 8, F24).

### Rulings

The plan's rulings 1–28 (plan 8e) hold as written, with the deviations above. The controller and user rulings are in the
plan's ledger: the preflight findings F1–F35; the wave-1 phase-B values; the two Task 11 plan bugs; user Q1 (a) spatial
statistics in `GATE_Z`, Q2 (a) fallback order (not needed), Q3–Q6 the recommended options (Q4: penalties NOT MET, no knob).

**Seeds and fixtures re-picked** (each by its file's rule):

| Fixture | Change |
|---|---|
| `whatif.test` forced window | 5 → 6 |
| Stats golden (`replay.test`) | 4245 → 4246 (first from 4245 that raises a `costly_error`); golden renamed `late-comeback-4246.json` |
| Manager `run.test` | 13 → 14 |
| Advisor explainer pass | 15 → 3 |
| API library fixture (and so the web client test) | 4 → 1 |
| Agents `ERROR_SEED` / `SEED` | 65 → 17 / 6 → 1 (`find_test_seed.py`: 64 error-shape seeds of 1–1400; 58 general of 1–100) |
| Gateway e2e | 65 → 17 (with `ERROR_SEED`) |

The stats and manager goldens were regenerated. `pnpm library` was not rebuilt (it needs the agent service and the LLM).

### P5 merge checklist

- Regenerate every `out/` run folder in main.
- Run `pnpm library` once the user OKs it.
- Tell the P6 controller the merge commit to rebase onto.

## Results: P6 (2026-10-21)

**Switched on** in `DEFAULT_PARAMS` (and so in the calibrated file):
- `firstTime.rule` (SH1), with `firstTime.setPieces` 1 (user Q1 (a): corners and free-kick deliveries too).
- `header.rule` (SH2), `saveGeo.rule` (SH3), `execFatigue.rule` (SH4) and `shotModel.rule` (shot logit and xG refit).
- **No switch was turned off.** The gate passed with everything on, so the fallback (user Q4 (a): SH3 off, then SH2 off) was not
  used.

**Values the tasks set:**
- **SH1 (Task 3):** `b0` 0 (the top of the grid), `bXg` 6, `bArrival` −0.5 (a prior), `layOffLogit` −1.5, `layOffMaxM` 12,
  `maxGoalM` 25, aim 0.3 / 0.2 at 12 m/s.
- **SH2 (Task 4):** `b0` 0.5 (the top of the grid), band 1.0–2.4 m, `bHeading` 2, `aimK` 1.3, `speedShare` 0.55.
- **SH3 (Task 5):** `bFlightS` 3.5 and `bOffBisector` −0.3 (the pair that moves the save rate least); priors `offLineRefM` 2.2,
  `bOffLine` −0.15, `reactionS` 0.2, `flightCapS` 1.
- **SH4 (Task 6):** `k` 0.25, `ref` 0, `power` 1. On, this is numerically the old `1 + executionK·f`: no grid pair beat it.
- **Shot model (Task 7):**
  - `shotModel.xg` is Task 2's fractional-logit fit to DFL model xG: b0 −3.004, bDist −0.0392, bAngle 4.059, bHeader −1.617,
    bDefenders −0.342, with a fitted mean of 0.0916, equal to DFL's.
  - `bXg` 3 (calibrated **3.5**), `pivot` 0.1, `bRisk` 0.3.

**Knobs:**
- New: `shot_xg_slope` (`shotModel.bXg`, 1.5–4.5).
- Retargeted: `xg_b0` now moves `shotModel.xg.b0` within the fit ± 0.5 (−3.504 to −2.504); before, it moved `shot.xg.b0`,
  which rule 1 no longer reads.
- No knob on `firstTime`, `header`, `saveGeo` or `execFatigue` (ruling 14).

**Sources:**
- C1, C2 and C4 come from `docs/realism/realism-report.md` (16 matches).
- The shots table, C3, the P5 rows and the P4 rows come from `docs/realism/realism-deep-report.md` (64 matches).
- Task 2's baseline is `docs/realism/p6-shots-baseline.md` (16 matches, P4 engine, P6 rules 0).
- P5's figures are from Results: P5 above.

### Deviations from the plan

- **Planning rulings that changed the spec:**
  - 3–5: SH1's eligibility, its three-way choice, and pressure acting on execution only.
  - 8, 9: SH2 acts on P4's duel winner, with no `resolve.ts` edit and no headed lay-off.
  - 10: SH3's flight-time term replaces `bDistance`.
  - 11: SH4 acts on kicks only.
  - 12: restarts keep the old shot term.
  - 13: the xG fit is a **mean-preserving fractional logit** in place of least squares (ledger ruling: least squares missed
    DFL's mean, 0.076 against 0.092).
  - 14: the tuner knobs above.
  - 19: P5 came in by merge, not by rebase.
- **Measurement and test changes** (no bound widened):
  1. Mechanism tests written on earlier engines now pin P6 off (the P4/P5 F4 precedent). The switch-on had moved them across a
     bound by seed noise. The cases:

     | Test | With P6 on | Bound |
     |---|---|---|
     | `rotate`, rotations appear | 19 and 14 | 20 and 15 |
     | `fouls`, defender fouls by zone | final-third share 0.173 | below 0.156 |
     | `tackle`, the dt 0.04 case | front count 13 | 15 |
     | `passing`, the whole-match gain | 0.011 | 0.015 |
     | `setpiece-attack`, corners in matches | on − off 1.90 | 2 |
     | `identity` | the distribution block's base: the precondition could no longer see the perturbation | — |
     | `edge`, 25 Hz parity | interception ratio 1.158 | 1.15 |

     The `edge` case was probed on 8 seeds: 1.173 with P6 on and 1.083 off. Interceptions per pass at 25 Hz over 10 Hz are
     equal either way (1.12 and 1.13), so the excess is pass volume.
  2. `positioning`: the keeper-off-line clause is split into its own `it.fails` (NOT MET, below). Its bounds are unchanged;
     the other clauses stay a plain test.
  3. `shots-targets.test.ts` is new (ruling 17: calibrated params, test teams, seeds 7–21).

### Merge of P5 and the identity check

- `main` 796e111 (P5 on) was merged into `realism-v2-p6` as 4b0f368. Conflicts were resolved by keeping both sides (the
  Cross-phase contacts table).
- With every P6 rule 0, the gate read `{"loss":23.77,"maxDrift":0}`, identical to `main`, so P6 is identity on top of P5.
- One test changed in the fallout (9a920e1): firsttime.test's 0.2 clause moved from `it.fails` to `it`.

### Calibration

| Run | Start | Tuner loss | Held-out loss | Knobs that moved |
|---|---|---|---|---|
| 1: from P5's knobs plus Task 7's starting values, every P6 rule on; 24 matches, 1 round, 94 evals. **Ships.** | 26.12 | **17.42** | **21.36** | 14 knobs, below |

**Starting values from Task 7,** applied to P5's file:

| Knob | P5 value | Start | Why |
|---|---|---|---|
| `save_b0` | 1.55 | 1.8 | +0.25, between Task 7's +0.07 and +0.28 |
| `shot_bias` | 0.4 | 0.1 | −0.3, Task 7's pivot-0.2 run |
| `aim_noise` | 0.95 | 0.95 | Task 7: no change |
| `xg_b0` | — | −3.004 | the refit's intercept |
| `shot_xg_slope` | — | 3 | the new knob's default |

**Knobs that moved,** start → tuned:

| Knob | Start | Tuned | Note |
|---|---|---|---|
| `shot_bias` | 0.1 | **−0.3** | |
| `shot_xg_slope` | 3 | **3.5** | |
| `save_b0` | 1.8 | **1.55** | back to P5's value |
| `aim_noise` | 0.95 | **1.15** | back to P4's value |
| `exec_scale` | 2.05 | 1.75 | |
| `long_shift` | −0.5 | 0 | |
| `deflect_behind` | 1.25 | 1 | |
| `foul_per_tackle` | 0.48 | **0.6 (max)** | |
| `marking_weight` | 1 | **0.25** | |
| `support_dist` | 14 | 16 | |
| `attacker_foul` | 1.5 | 1.25 | off its maximum |
| `aerial_contest` | 2.25 | **2.5 (max)** | |
| `fk_shot` | 4.5 | **4** | P5 knob |
| `gk_long` | 2.5 | **2** | P5 knob |

These did not move: `xg_b0` (−3.004), `box_intensity` (1), `decision_scale` (0.8, min), `restart_scale` (1.05),
`gk_long_error` (1), `role_rate` (1), `max_gap` (5) and `lane_share` (0.4).

**P5's knobs** (ruling F22: the tuner may move them within P5's ranges, and every move is reported):
- Two of the knobs P5 added moved: **`fk_shot` 4.5 → 4** and **`gk_long` 2.5 → 2**.
- Several knobs P5's own tuner had moved also moved again:
  - **`aim_noise` 0.95 → 1.15**, back to P4's value.
  - **`foul_per_tackle` 0.48 → 0.6**, back to the maximum.
  - **`xg_b0`** now acts on `shotModel.xg.b0` and stays at −3.004. P5's −1.5 on `shot.xg.b0` is inert under rule 1; the file now
    holds `shot.xg.b0` −1.25, the default.
- Unchanged: `decision_scale` 0.8, `clear_to_touch` 0, `gk_long_error` 1, `role_rate` 1, `max_gap` 5, `lane_share` 0.4,
  `restart_scale` 1.05.

**Knobs on their bounds:**
- At the minimum: `decision_scale` 0.8, `tackle_rate` 0.1, `yellow_per_foul` 0.1, `clear_to_touch` 0.
- At the maximum: `switch_shift` 2, `foul_per_tackle` 0.6 (back on its maximum), `support_space` 20, **`aerial_contest` 2.5
  (new)**, `aerial_foul` 1.5, `counter_join` 1.25.
- No longer on a bound: `marking_weight` (P5: 1, max; now 0.25) and `attacker_foul` (1.25).

**Before and after the tuner** (16 matches each, seeds 2000–2015, full report):

| Shots row | Pre-tuner | Tuned | Real |
|---|---|---|---|
| Shots | 30.1 | 25.2 | 24.4 |
| Open-play shots | 19.6 | 18.9 | 17.1 |
| Goals (events) | 3.69 | 3.25 | 2.71 |
| Open-play conversion | 0.121 | 0.119 | 0.092 |
| First-time share | 0.262 | 0.307 | 0.41 |
| First-time conversion | 0.085 | 0.108 | 0.122 |
| Conversion of other open-play shots | 0.134 | 0.124 | 0.070 |
| Header share | 0.010 | 0.017 | 0.14 |
| Conversion with a defender within 1.5 m | 0.086 | 0.054 | 0.118 |
| Conversion with no defender within 3 m | 0.151 | 0.155 | 0.032 |
| Blocked share | 0.109 | 0.162 | 0.217 |
| xG per open-play shot | 0.160 | 0.152 | 0.101 |

- **Shots rows a knob turned NOT MET:** conversion with a defender within 1.5 m (0.086 → 0.054).
- **Shots rows a knob turned MET:** shots (30.1 → 25.2) and first-time conversion (0.085 → 0.108).
- **Other rows the tuner turned NOT MET:**
  - passes 946 → 969
  - clear lanes 5.23 → 5.79 (`marking_weight` 0.25)
  - keeper throws 3.44 → 2.25
  - keeper open-play completion 0.780 → 0.868
  - losers within 5 m in 3 s 2.08 → 1.99
  - recovery running at 2 s and 10 s
  - free kicks within 30 m 1.12 → 1.31
  - penalties
  - cross end point
  - side tackle win
  - kickoff dead time 76.2 → 78.7 s
- **Other rows the tuner turned MET:**
  - press episodes 539 → 416
  - press episodes with 3 or more engaged
  - winger press runs
  - fouls 18.9 → 19.8
  - receiver tightly marked
  - 30 m+ completion
  - goal-kick shots against 6.5 → 1.1 per 100
  - **direct free-kick shot share 0.67 → 0.41**

### Results

- **Gate: MET.** Held-out loss **21.36**, maxDrift 0 against the refreshed baseline, physics **4** of 13 inside (`speed_DEF`,
  `speed_FWD`, `max_speed`, `hsr25`). The 1-SD and 2-SD counts on the gate seeds are 13 and 18 (the gate needs 11 and 17).
  **Every gated |z| < 3, spatial included:**

  | Statistic | z |
  |---|---|
  | Free space | +2.57 |
  | Distance | −2.23 |
  | Ball pressure | +2.07 |
  | Line height | −1.87 |
  | In-play share | −1.75 |
  | Defending length | −1.59 |
  | Completion | −1.50 |
  | Peak speed | −1.47 |
  | Blocked share | −1.37 |
  | Width in possession | +1.19 |
  | Passes | +1.10 |
  | Goals (3.44 shot goals on the gate seeds) | +0.58 |
  | Width out of possession | +0.54 |
  | Support within 15 m | −0.51 |
  | Shots (25.0) | +0.19 |

- **C1: NOT MET.** 14 of 19 within 1 SD (P5 14), 18 within 2 SD (P5 16). Beyond 2 SD: distance −2.30 only. Completion is now
  −1.42 (P5 −2.58) and in-play share −1.33 (P5 −2.24).
- **C2: MET.** Free kicks +0.91, fouls −0.66, goals +0.18, shots on target −0.79.
- **C3: NOT MET.** Team shot-share SD 0.209 on 64 matches (P5 0.209; needs ≤ 0.18).
- **C4: MET.** Width in possession +1.22, out +0.65, defending length −1.85, line height −1.74, ball pressure +2.09, support
  −0.35, free space +2.39.
- **Goals and shots** (64 matches):
  - Goal events: 2.81 per match in the match table (z +0.08) and 3.14 in the shots section, which adds own goals (P5: 3.27).
  - Real goals: 2.71.
  - Shots: 26.4 per match (P5 28.3; real 24.4).
  - Open-play shots: 18.3.
- **xG per open-play shot:** 0.170 on the refit scale (DFL real 0.101; Task 2's baseline 0.128 on the old model).
- **Shot-type table and conversion by pressure** (64 matches, 1173 open-play shots; Task 2's baseline on 16 matches, P4
  engine, P6 off):

  | Measure | Real | Task 2 | P6 | Status |
  |---|---|---|---|---|
  | First-time share of open-play shots | 0.410 | 0.000 | 0.310 | NOT MET (band 0.33–0.49) |
  | First-time share of open-play goals | 0.550 | 0.000 | 0.254 | NOT MET |
  | Conversion, first-time shots | 0.122 | n/a | 0.096 | **MET** |
  | Conversion, other open-play shots | 0.070 | 0.134 | 0.127 | NOT MET |
  | Header share of open-play shots | 0.140 | 0.000 | 0.015 | NOT MET |
  | Conversion, headers | 0.060 | n/a | 0.111 | NOT MET (few headers) |
  | Conversion, nearest defender < 1.5 m | 0.118 | 0.108 | 0.057 | **NOT MET** (was MET) |
  | Conversion, 1.5–3 m | 0.109 | 0.147 | 0.116 | MET |
  | Conversion, ≥ 3 m | 0.032 | 0.152 | 0.150 | NOT MET |
  | Tight minus open | 0.086 | −0.044 | −0.093 | NOT MET (further off) |
  | Nearest defender, median (m) | 2.04 | 2.18 | 3.47 | **NOT MET** (was MET) |
  | In-box share | 0.590 | 0.703 | 0.590 | **MET** |
  | Conversion in the box / outside | 0.127 / 0.041 | 0.168 / 0.054 | 0.159 / 0.058 | **MET** / MET |
  | Blocked share | 0.217 | 0.166 | 0.145 | NOT MET |
  | Setup: pass / dribble / cross / loose / through | 0.33 / 0.31 / 0.17 / 0.13 / 0.025 | 0.131 / 0.578 / 0.029 / 0.147 / 0.105 | 0.341 / 0.452 / 0.036 / 0.120 / 0.032 | **MET** / NOT MET / NOT MET / MET / **MET** |
  | Keeper off his line / off the ball–goal line (m; info) | 2.23 / 0.32 | 2.95 / 0.57 | 3.03 / 0.67 | — |
  | Late completion drop (75–90+ minus 0–15) | −0.063 | −0.023 | −0.002 | NOT MET |
  | Open-play conversion | 0.092 | 0.134 | 0.118 | NOT MET |
  | Shots / open-play shots per match | 24.4 / 17.1 | 25.8 / 19.6 | 26.4 / 18.3 | MET / MET |

- **Real-target tests:**
  - **`shots-targets.test.ts`** (new; calibrated params, test teams, seeds 7–21):
    - The non-vacuity case passes.
    - **Every target is NOT MET (`it.fails`):**

      | Case | Measured | Target |
      |---|---|---|
      | First-time share | 0.279 | 0.33–0.49 |
      | First-time conversion minus the rest | −0.136 | ≥ 0.02 |
      | Header share | 0.008 | 0.10–0.18 |
      | Tight minus open | −0.092 | ≥ 0.03 |
      | Goal events per match on the test teams | 4.25 | 2.3–3.1 |
      | Late completion drop | −0.020 | real −0.063 ± 0.02 |

  - `duels-targets.test.ts`:
    - **Now MET** (they leave `it.fails`): front approaches beat behind (0.714 of 14 against 0.500 of 84), defender fouls 15.0,
      fouls 21.25. These follow `foul_per_tackle` 0.6.
    - **Now NOT MET:** losers reaching the ball within 3 s, 1.947 over 526 losses (P5 2.069). This follows `marking_weight` 0.25.
    - Tackle win 0.531 and aerial duels 39.25 stay NOT MET.
  - `positioning`: **NOT MET**, keeper off his line with the ball 13–25 m out:
    - 3.83 m on seed 7 (band 1.2–3.5). With P6 off it is 3.36 m.
    - First-time finishes end most owner spells in that zone, and so halve the samples.
  - `firsttime.test`'s in-match 0.2 clause stays MET from the merge.
- **P5's rows** (ruling 20; 64 matches, P5 → P6):
  - **Corner shots within 10 s: 36.7 → 53.1 per 100, MET → NOT MET because of P6.** First-time finishes and headers at corners
    come with `firstTime.setPieces` 1 (Q1 (a)). The user must judge this.
  - Direct free-kick shot share 0.50 → **0.39**, MET, in mid-band now. `fk_shot` is 4, and the refit xG is lower in the old
    restart term.
  - Long goal kicks completed 0.63 → 0.68, NOT MET as before. The goal-kick long share is 0.19.
  - Goal-kick shots against 4.4 → 2.7 per 100, NOT MET → MET.
  - Header share: 0.015 on 64 matches (Task 4: 0.025 on the P4 engine). P5's aerial volume added no headers: aerial duels are
    37.8 (P5 34.2), and open-play crosses are 6.6 (P5 5.5; real 14.9).
  - Other P5 or P4 rows that changed status (all from the tuner's knobs, see the pre/post list):
    - press episodes 539 → 406, MET
    - clear lanes 5.24 → 5.83, NOT MET
    - keeper throws 3.20 → 2.39, NOT MET
    - keeper open-play completion, NOT MET
    - losers within 5 m in 3 s, NOT MET
    - recovery at 10 s, NOT MET
    - fouls 18.2 → 19.1, MET
- **Manager A/B** (rules against none, 40 seeds, for information): **+0.407 xG difference per match (95 % interval 0.048 to
  0.768)**. The rule-based manager does better (P5: +0.297). The goal difference is −0.275 [−0.775, 0.200].
- **C5: PENDING.** It waits for the user's replay review of `out/c5-review` with `docs/realism/c5-review.md`.
  - The set is 4 matches: seeds 3000 and 3001, `keeper_heroics` and `late_comeback`. `pnpm api --library out/c5-review` lists
    all four.
  - The clip list has 3 or more clips per category per match for first-time shots and late passes. Several categories fall
    short and are recorded in the file, not padded:
    - first-time goals: 1 in all four matches
    - lay-offs: 2
    - quick saves: 4
    - headers: 2 in `c5-3000`

### Gaps

- **Shot location and pressure.**
  - The nearest defender at the shot is 3.47 m against 2.04 m.
  - Open shots convert at 0.150 against 0.032.
  - Tight shots now convert at only 0.057.
  - SH3 cannot fix the ordering, because shot selection puts the sim's shooters in space (Task 5).
- **First-time volume.** The first-time share is 0.31 against 0.41: there are too few clean ground receptions within 25 m.
  First-time goals are 0.25 of open-play goals against 0.55, and first-time shots convert 0.096 against the others' 0.127.
- **Headers** are 0.015 of open-play shots against 0.14. The volume is set by open-play crosses (6.6 against 14.9) and aerial
  duels in the box, both outside P6.
- **Late completion drop:** −0.002 against −0.063. Execution fatigue is not the driver (Task 6).
- **Own goals from passes:** about 0.3 per match (shots-section goals 3.14 against 2.81 in the match table), against about 0.1
  real.
- **C3 shot-share spread:** 0.209 against ≤ 0.18.
- **Corner shots:** 53.1 per 100 against 32.1.
- **Goals on the test teams:** 4.25 per match (the league fixtures read 2.81). The test teams' attributes amplify P6's finishing.

### Carried

- Every P5 gap above.
- Headed knock-downs in the box: real football, outside the plan.
- A possible lay-off volume check: there is no real lay-off row.
- The `edge` parity pass-volume question.

### Rulings

- The plan's rulings 1–22 (plan 8f) hold as written, with the deviations above.
- The controller and user rulings are in the plan's ledger:
  - the preflight findings F1–F24
  - the wave-1 phase-B values
  - the Task 7 choice
  - the post-merge test rulings
  - user Q1 (a) set pieces on, Q2 (a) DFL xG, Q3 (a) the 4-match C5 set, Q4 (a) the fallback order (not needed)

**Seeds and fixtures re-picked** (each by its file's rule):

| Fixture | Change |
|---|---|
| Agents `ERROR_SEED` / `SEED` | 17 → **2** / 1 → **8** (`find_test_seed.py`: 24 error-shape seeds in 1–300, 2 the first to pass; 50 general of 1–100) |
| Gateway e2e | 17 → 2 (with `ERROR_SEED`) |
| Stats golden (`replay.test`) | 4246 → **4245** (the first from 4245 that raises a `costly_error`; 4245 raises one again); golden renamed `late-comeback-4245.json` |
| Carrier parity (`carriers.test`) | 4244 → **4246** (the first from 4243 with a still stretch) |
| Manager `run.test` | 14 → **13** |
| Manager `situation` adds-up | 12 → **11** |
| Manager A/B "same match until the first decision" | fixture seed 5000 → **5001** (the first from 5000 whose first decision follows ≥ 100 events; new rule written in the file) |
| API library fixture (and so the web client test) | 1 → **6** (the first of 1–30 that fits) |

- Unchanged: `MOMENTS_SEED` 13, the `whatif.test` forced window, and `wide.test` `CLAIM_SEEDS`. Their tests pass.
- The stats and manager situation goldens were regenerated.
- `pnpm library` was not rebuilt (it needs the agent service and the LLM).

### Pre-merge fixes (2026-10-21)

The user approved three fixes before the merge (2026-10-21). The branch was then recalibrated, re-baselined and re-pinned.
Commits on `p6-task8`: `29daa82`, `93b7ffc`, `0b37516`, `fb1432b`, then the reports, re-picks and this section.

**The fixes:**
1. **Set-piece contacts off.** `firstTime.setPieces` is 0. `contactPlan` gates both contact rules on it, so set-piece
   first-time finishes and set-piece headers are off together (the user's choice; a comment at the gate says so). Q1 (a) is
   reversed.
2. **`marking_weight` range 0.75–1** (was 0–1). The P6 tuner had moved it to 0.25. A knob's identity value must sit inside
   its range, so `DEFAULT_PARAMS.marking.weight` moved 0.5 → 1.
3. **One xG.** The stats engine (and through it the analyst agent, the manager situation and the advisor) now computes the
   simulator's xG: `xgCoefs(params)` from the parameter file the matches run with (the DFL refit under `shotModel.rule` 1),
   with sim-core's `xgFrom`, `shotLineCount` and `directFkXg`. Features: distance (m), goal-mouth angle, header, outfield
   defenders within 1.5 m of the line to the goal centre (keepers by role). A shot after control is measured in the frame
   before its tick, a first-time shot or header in its own frame. `stats-models.json` (stats-models-2) keeps only the xG
   feature names and the penalty rate; xPass is unchanged. Python follows (`stats_models.py`, `xt.py`); `xt-grid.json` is
   not refit.
   - Tests: the stats xG equals `xgOf` to 1e-12 on 400 placed shots; it equals the recorded `attrs.xg` within 0.002 on every
     shot of two matches (`attrs.xg` is rounded to 0.001 and frame positions to 0.01 m; worst 0.00136). The TypeScript and
     Python feature parity test passes, shots included.

**Calibration.** `pnpm calibrate --from` the P6 file, 24 matches, 1 round, 90 evals: 21.63 → 18.08.
- The tuned file failed the gate on free space: `{"loss":22.68,"maxDrift":0}`, free space z +3.65, line height −2.70.
- The controller ruled a one-change gate probe before any re-calibration (16 gate seeds; the probe reproduces the gate
  exactly on the tuned file):

  | Probe | Loss | Within 1 / 2 SD | Physics inside | Largest \|z\| | Free space | Line height | Passes |
  |---|---|---|---|---|---|---|---|
  | Tuned (`pos_out_shift` −3, `marking_weight` 1) | 22.68 | 12 / 19 | 6 | free space 3.65 | +3.65 | −2.70 | no |
  | (a) `pos_out_shift` 0 | 23.45 | 13 / 18 | 5 | completion 2.34 | +2.12 | −1.17 | yes |
  | **(b) (a) and `marking_weight` 0.75** | **20.95** | 14 / 18 | 5 | free space 2.19 | +2.19 | −1.60 | **yes, ships** |
  | (c) pre-recalibration knobs, `marking_weight` 1, `setPieces` 0 | 22.30 | 11 / 18 | 6 | completion 2.22 | +2.20 | −1.20 | yes |

- **Knobs that moved** (tuner, kept): `long_shift` 0 → 0.5, `reach_margin` 0.675 → 0.625, `yellow_per_foul` 0.1 → 0.15,
  `loose_share` 0.3 → 0.4, `deflect_behind` 1 → 1.25, `save_b0` 1.55 → 1.8, `aerial_contest` 2.5 → 2.25, `press_rate`
  1 → 0.875, **`gk_long` 2 → 1.5 (P5 knob, now on its minimum)**. Set after the tuner (probe b): `pos_out_shift` 0 (the
  tuner's −3 dropped), `marking_weight` 0.75 (Task 8: 0.25). Not moved: `xg_b0` (−3.004), `shot_xg_slope` 3.5,
  `shot_bias` −0.3, `fk_shot` 4, `aim_noise` 1.15, every other P5 knob.
- **On their bounds:** `decision_scale` 0.8, `tackle_rate` 0.1, `clear_to_touch` 0, `gk_long` 1.5 (minimum);
  `marking_weight` 0.75 (new minimum); `switch_shift` 2, `foul_per_tackle` 0.6, `support_space` 20, `counter_join` 1.25
  (maximum). Off a bound now: `yellow_per_foul`, `aerial_contest`.

**Gate: MET.** `{"loss":20.95,"maxDrift":0}` after re-baselining, physics 5 of 13 inside (`speed_GK`, `speed_DEF`,
`speed_FWD`, `max_speed`, `hsr25`), 14 / 18 within 1 / 2 SD, every gated |z| < 3. Spatial z: width in possession +1.07, out
+0.10, defending length −1.88, line height −1.60, ball pressure +1.08, support −0.05, free space +2.19. Largest scalar z:
completion −2.12, in-play −1.82, distance −1.71.

**Re-measured** (64 matches unless noted; Task 8 → pre-merge fixes):

| Row | Real | Task 8 | Now | Status |
|---|---|---|---|---|
| Corner shots within 10 s, per 100 | 32.1 | 53.1 | **36.7** | **MET** (was NOT MET) |
| Nearest outfield defender at the shot, median (m) | 2.04 | 3.47 | 3.40 | NOT MET |
| Conversion, nearest defender < 1.5 m | 0.118 | 0.057 | **0.099** | **MET** (was NOT MET) |
| Conversion, ≥ 3 m | 0.032 | 0.150 | 0.124 | NOT MET |
| Tight minus open | 0.086 | −0.093 | −0.025 | NOT MET (closer) |
| Clear lanes per open-play pass | 4.95 | 5.83 | **5.34** | **MET** (was NOT MET) |
| Losers within 5 m in 3 s, per loss | 2.29 | 1.96 | **2.06** | **MET** (was NOT MET) |
| Losses with 3 or more losers within 5 m | 0.430 | 0.287 | 0.334 | NOT MET |
| Goals, match table (shot goals) | 2.71 | 2.81 (z +0.08) | 2.89 (z +0.14) | MET (z) |
| Goals, goal events (own goals included) | 2.71 | 3.14 | 3.23 | NOT MET (band 2.40–3.00) |
| Shots / open-play shots per match | 24.4 / 17.1 | 26.4 / 18.3 | 24.2 / 17.3 | MET / MET |
| First-time share of open-play shots | 0.410 | 0.310 | 0.297 | NOT MET (open play only, as expected) |
| First-time conversion | 0.122 | 0.096 | 0.067 | **NOT MET** (was MET) |
| Header share of open-play shots | 0.140 | 0.015 | 0.012 | NOT MET |
| Open-play conversion | 0.092 | 0.118 | 0.112 | NOT MET |
| xG per open-play shot (refit scale) | 0.101 | 0.170 | 0.170 | — |
| Direct free-kick shot share | 0.36 | 0.39 | 0.33 | MET |
| Long goal kicks completed | 0.49 | 0.68 | 0.64 | NOT MET |
| Goal-kick shots against, per 100 | 0.9 | 2.7 | 4.4 | **NOT MET** (was MET; `gk_long` 1.5) |
| Press episodes per 90 | 405 | 406 | 485 | **NOT MET** (was MET; `press_rate` 0.875, tighter marking) |
| Keeper open-play completion | 0.779 | 0.842 | 0.783 | **MET** (was NOT MET) |
| Fouls per match | 22.9 | 19.1 | 18.8 | NOT MET (just under the band) |

- **C1: NOT MET.** 12 of 19 within 1 SD, 18 within 2 SD (Task 8: 14 / 18). Beyond 2 SD: completion −2.28 only.
- **C2: NOT MET** (was MET). Free kicks +0.94, goals −0.02, on target −0.63, but fouls −1.00, on the edge.
- **C3: NOT MET.** 0.203 (Task 8 0.209; needs ≤ 0.18).
- **C4: MET.** Width in +0.91, out +0.36, defending length −2.05, line height −1.19, ball pressure +1.05, support −0.04,
  free space +1.94 (16-match report).

**Script nudges** (scripts only, bounds unchanged; spec §5.1.1 precedent): `pressSurge` 20 → 30 (the stats pressure-shift
signal fired in 4 of 6 seeds; 5 at 30), `heroicsSave` 1.5 → 1.75 (heroics let in 0.2258 against the bound 0.2257; 0.170 at
1.75), `goalRatePerMin` 0.016 → 0.02 (`late_comeback` reached its target unforced in 8 of 10 seeds; 10 at 0.02).

**Tests changed** (no bound widened):
- Re-picked by each file's rule: agents `ERROR_SEED` 2 → 7 and `SEED` 8 (unchanged after the search), gateway e2e 2 → 7,
  stats golden 4245 → 4246 (renamed `late-comeback-4246.json`), carriers parity 4246 → 4243, manager `run` 13 → 11,
  advisor better-pass case pass 3 → 4, API library fixture 6 → 3, `whatif` forced window seed 6 → 1.
- Goldens regenerated: stats (3-3, 75 signals; xG now the simulator's) and the manager situation (xG 0.62 / 1.67 for 5 / 12
  shots, where the old model gave 0.76 / 0.45 for 8 / 8).
- Flipped to MET (`it.fails` → `it`): duels-targets tackle win 0.489, aerial duels 40.25, losers in 3 s 2.052;
  shots-targets first-time conversion minus the rest +0.064; wide own goals 3 over 16 seeds (on the bound); positioning
  keeper off his line 3.16 m.
- Flipped to NOT MET (`it` → `it.fails`; DEFAULT_PARAMS real-target cases moved by the marking default): positioning
  build-up players deep, median 8 (≤ 6); deadball throw-in dead time 17.35 s (11–16; the shipped file reads 14.4 s, MET).
- Pinned: `aerial` in-match counts at `marking.weight` 0.5 (the default they were measured on), `offball` crowding with P6
  off (F4 precedent). `header.test`'s in-match case keeps `setPieces` 1: with the shipped 0 the 8 seeds give 2 headers,
  under its non-vacuity floor of 8.
- `record.test`: a lay-off's action is short_pass (the first-time choice it records, ruling F21), whatever kind the pass
  classifies as; seed 1 now has a lay-off played backwards.
- `shots-targets` (test teams): first-time share 0.169, header 0.014, tight minus open −0.091, goals 3.875, late drop
  −0.021, all still NOT MET.

**Test lines.** Full suite, `pnpm exec turbo run test --concurrency=1 -- --no-file-parallelism`: nine packages passed in
the full run (stats 55, manager 55, sim 52, advisor 20, agent-gateway 20, web 101, league 7, rpc 9, schema 11); the Mac slept
mid-run (lid closed, on battery), so api, calibrate, mcp-stats and sim-core failed only on timeouts and were re-run once,
sequentially: api 74 passed, calibrate 44 passed, mcp-stats 18 passed, sim-core 639 passed and 16 expected fail (655).
`pnpm typecheck` 13 of 13. Analytics pytest 165 passed; agents pytest 175 passed, 7 deselected. Gate 1 passed,
`{"loss":20.95,"maxDrift":0}`.

**Concerns carried:** goal-kick shots against and press episodes turned NOT MET; first-time conversion turned NOT MET on 64
matches (MET on the test teams); C2 lost fouls by 0.004 of an SD; `xt-grid.json` still rests on the old goal logistic.
C5 stays PENDING on the rebuilt set.

### P6 merge checklist

- Merge to `main` only after the user has seen these results and given the C5 verdict. Record the verdict here and in the
  realism contract.
- Regenerate every `out/` run folder in `main`, and `out/c5-review` if it is needed again (commands in
  `docs/realism/c5-review.md`).
- Run `pnpm library` once the user OKs it.

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
| GK | −34.4 / −39.9 | 0.28 / 0.27 |
| CB | −12.0 / −18.5 | 0.59 / 0.51 |
| FB | −1.7 / −14.0 | 0.58 / 0.54 |
| CM | 1.5 / −8.0 | 0.59 / 0.58 |
| AM | 8.6 / −0.2 | 0.54 / 0.62 |
| W | 10.3 / −2.9 | 0.54 / 0.62 |
| ST | 16.0 / 7.2 | 0.50 / 0.59 |

- **Depth:** `u = a[phase] + b[phase]·bu + slotOffset + style`.
- **Lateral:** `s = w0 + w1·bu + w2·bs + w3·|by|`, with the coefficients per role and phase from `fit.json` (`lat_central`).
- **Slot offsets.** Formation slots give the within-role offsets: each slot's x re-centred on its role's mean.
- **Keeper.** He follows the ball's angle; inside 25 m of his goal he holds 1.5–2.5 m off the line (real 2.2 m; sim now 4.0 m).
- **Style.**
  - `lineHeight` shifts the shape only out of possession, by ±3 m; in possession it has no effect. This removes the dominance mechanism: block offset ±6.4 m × slide 0.5.
  - `compactness` scales the out-of-possession `w0`.
  - Orders and agents keep setting `lineHeight` and `compactness`.
- **Retired settings.** `shape.defLineM` and `shape.fwdDropM` are removed (params, `knobs.ts`, `shape.test.ts`). `shape.width` and `shape.depth` remain as tunable multipliers.
- **Target.** The in-possession centroid sits about 4 m ahead of the ball (sim now 7 m behind).

**G4: build-up shape.** A third phase row, `gk`, applies while our keeper has the ball and blends out on release at the A2 rate.

- CBs at u −30, split 31 m.
- FBs at u −13.
- About 3 outfielders in the defensive third (sim now 8).

**A2: phase-switch timing.**

- Per player, `λ = 1 − exp(−max(0, t + 0.5) / τ_role)` from the possession change; the anchor blends the old phase's rule into the new one by λ.
- τ by role: CB 2.5, CM 4, ST 4.5, AM 5, FB 7.5, W 8.5 s.
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

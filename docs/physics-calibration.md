# Physics measured on real tracking

Touchline's ball physics and player movement are not hand-set: every constant below was fitted on public tracking
data, with an interval and a held-out check. As far as we know this is the only open, licence-clean physics calibration
of a football engine.

**Data.** IDSSE / Sportec Open DFL dataset: seven 2022/23 Bundesliga and 2. Bundesliga matches tracked by TRACAB
Gen5 at 25 Hz, ball height included (CC-BY 4.0; Deutsche Fussball Liga, Bassek et al., *Scientific Data* 2025,
doi:10.1038/s41597-025-04505-y). Five matches are fitted (J03WMX, J03WN1, J03WOH, J03WOY, J03WPY) and two held out
(J03WQQ, J03WR9). Only aggregates are committed (`data/params/physics.json`); the raw files are never in the repository.

**Reproduce.** `pnpm physics:fit` (about 15 minutes). Method: `python/analytics/touchline_analytics/physics/`;
design, criteria and the revision after measurement: `docs/superpowers/specs/2026-10-09-physics-fit-design.md`.

## The ball

| Constant | Fitted | 95 % interval | Sample | Literature |
|---|---|---|---|---|
| Drag k (a = −k·\|v\|·v) | 0.0153 /m | 0.0150–0.0156 | 1,023 flights | 0.013 (C_D ≈ 0.24) |
| — below 12 m/s | 0.0176 /m | 0.0168–0.0183 | 434 | drag crisis: up to 2× |
| — 12–18, 18–24, 24–40 m/s | 0.0139, 0.0150, 0.0150 /m | | 269, 190, 130 | |
| Restitution e | 0.747 | 0.738–0.761 | 171 bounces | 0.62 certified turf; 0.74–0.76 irrigated grass |
| Bounce friction μ | 0.24 | 0.23–0.25 | 405 first bounces | 0.7–1.05 to pass FIFA's turf angle test |
| Skid friction μ_s | 0.35 | 0.30–0.38 | 2,646 ground passes | ball–grass 0.3–0.6 |
| Rolling resistance c0 + c1·v | 0.55 + 0.11·v m/s² | c0 0.34–0.56, c1 0.09–0.15 | 2,646 | 0.40 + 0.17·v (turf, ≤ 3.5 m/s) |
| FIFA ramp check (3.2 m/s, rolling) | rolls 6.1 m | | | Pro band 4–8 m |

What the data says about the ball:

- **Natural grass lets a landing ball slide.** A lofted ball keeps about 73 % of its horizontal speed through a
  bounce, more than a ball that grips can (60 %), so the contact point slides throughout the impact; the effective
  friction (0.24) is far below the artificial-turf values certification tests imply.
- **A struck ball skids before it rolls.** A ground pass leaves the foot without spin; grass friction both slows it
  and spins it up until it rolls. Without the skid phase no rolling law fits the data.
- **The drag crisis is visible in match data**: slow balls feel about 20 % more drag than fast ones.

## The players

| Constant | Fitted | Sample | Literature |
|---|---|---|---|
| A0 (acceleration at standstill), median by group | GK 8.8, DEF 8.5, MID 8.7, FWD 8.5 m/s² | 156 player-matches | 8.3–8.7 |
| S0 (top speed of the line), median | GK 7.4, DEF 9.0, MID 8.8, FWD 9.2 m/s | | 9.2–9.5 |
| Braking cap (95th pct. of deceleration peaks) | 6.17 m/s² (6.09–6.23) | 276 players | 6–8 |
| Lateral cap (95th pct. across the run, ≥ 4 m/s) | 3.80 m/s² (3.74–3.86) | | no published value |
| Reaction delay after a kick | 0.20 s (IQR 0.08–0.40) | 2,787 reactions | 0.2–0.4; pitch control's 0.7 s is a lump |

Acceleration–speed profiles follow Morin et al. (2021): in each 0.2 m/s speed bin the two largest accelerations
along the run, and a straight line a = A0·(1 − v/S0) through them. Each player's A0 and S0 come from their pace and
acceleration attributes, placed among the league's own percentiles, onto the fitted spread for their position. The
reaction delay is the lag from a kick until the nearest opponent's velocity has changed by 1 m/s, minus the time the
acceleration law itself needs for that change. Top speed loses at most 3 % when a player is tired (a literature value,
not fitted).

## What the engine uses

Switching every fitted piece on lowered match realism, so each was measured on its own, from the calibrated
parameters, on the 16 realism-gate matches (realism loss sums the squared distance of 19 match statistics from real
matches; lower is better):

| Switched on | Loss | Within 1 SD | Within 2 SD |
|---|---|---|---|
| Nothing (before) | 30.0 | 11 | 17 |
| Fitted ball | 25.5 | 12 | 19 |
| Fitted player movement | 26.4 | 12 | 18 |
| Fitted reaction and reach (0.2 s) for who wins a moving ball | 69.7 | 12 | 14 |
| **Ball and movement (shipped)** | **24.8** | **12** | **19** |

The engine uses the fitted ball and the fitted player movement. Deciding who reaches a moving ball keeps the tuned
rule (a 0.7 s delay, then a gentle constant acceleration): the fitted 0.2 s is when a player starts moving, but the
engine's reach disc sends the player straight to where the ball will be, as if they knew where the pass was going. The tuned
delay also covers reading the pass; with 0.2 s, defenders cut out far too many passes (completion z −3.6, median pass
length z −4.8). The 0.2 s stays in `physics.json` as a measured result.

## Validation

- **Held-out ball statistics (P2):** replaying every free-ball span of the two held-out matches with the fitted
  model, all seven ball statistics (flight time, aerial carry, ground run, rolling deceleration, bounce ratio, release
  and reception speed) fall within the spread between real matches (W1 against the largest real pair-to-pair W1).
- **Free-ball replay (P4):** on 200 held-out spans, the fitted constants explain a span with a median error ratio of
  1.09 against constants refitted to that span alone (threshold 1.5); median trajectory error 0.13 m.
- **Match realism (P5):** realism loss 24.8 (30.0 before), 12 of 19 statistics within 1 SD and 19 of 19 within 2 SD
  on the gate matches. On the report's held-out seeds, pass completion and median pass length move from outside 2 SD to
  inside it (`docs/realism/realism-report.md`).
- **Players in the simulation (P3), a known gap:** 1 of 13 player movement statistics is inside the real spread (top
  speed). The engine's players stand still about half the match and move in sudden bursts; real players are almost
  always moving, mostly below 2 m/s, and change speed gently. Distance above 20 km/h is about four times the real
  figure. This is how players choose to move, not a physics constant; a movement policy tried for it (settle at a
  jog, drift around the position) moved 3 of 13 inside but raised the realism loss to 88, so it is not shipped.
- **Work rate by period (P7, reported):** real outfielders who play the whole match cover 122 m/min in the first 15
  minutes and 99 m/min in the last 15; within a half the last 15 minutes average 0.91 of the first 15 (0.84–0.99 across
  matches). Simulated players fade a little within a half (0.95 on the report's seeds) but start the second half as
  fresh as the first (121 m/min against 113 real), so the decline across the match is missing. The energy drain is a
  tuned setting, not fitted.

## Rejected data

15 spans faster than 40 m/s; 284 flights the drag model could not follow (RMSE > 0.3 m, typically an unseen touch or a
deflection); 863 tracking jumps (a player frozen for a few frames and then moved), each blanked for a second.

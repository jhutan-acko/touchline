# Touchline realism report

Generated 2026-10-21 from 16 synthetic matches (calib-2026-10-21; held-out seeds 2000–2015) against real-match targets.

**Real data:** IDSSE / Sportec Open DFL dataset (2022/23 Bundesliga and 2. Bundesliga) — events: 7 matches; tracking: 1 match(es) (J03WPY); spatial: 7 matches. Licence CC-BY-4.0; Deutsche Fussball Liga (DFL); Bassek et al., Scientific Data (2025), doi:10.1038/s41597-025-04505-y. Only aggregate statistics are shown.

## Match statistics

| Statistic | Real (mean ± SD) | Synthetic (mean ± SD) | z | Off by | Verdict |
|---|---|---|---|---|---|
| Passes per match | 866 ± 90 | 958 ± 32 | +1.02 | +11 % | within 2 SD |
| Pass completion | 78.1% ± 3.8% | 69.2% ± 2.0% | -2.28 | -11 % | off |
| Long passes (32 m+), share of completed | 14.3% ± 2.5% | 12.6% ± 1.7% | -0.68 | -12 % | within 1 SD |
| Median completed pass length (m) | 17.1 ± 1.3 | 16.5 ± 0.4 | -0.52 | -4 % | within 1 SD |
| Shots per match | 24.4 ± 2.9 | 22.3 ± 5.3 | -0.72 | -9 % | within 1 SD |
| Shots on target, share | 35.4% ± 7.2% | 30.8% ± 9.4% | -0.63 | -13 % | within 1 SD |
| Shots blocked, share | 22.7% ± 6.1% | 11.9% ± 6.7% | -1.77 | -48 % | within 2 SD |
| Saves, share of shots on target | 66.9% ± 16.8% | 59.5% ± 16.0% | -0.44 | -11 % | within 1 SD |
| Goals per match | 2.71 ± 1.25 | 2.69 ± 1.40 | -0.02 | -1 % | within 1 SD |
| Penalties per match | 0.43 ± 0.53 | 0.25 ± 0.58 | -0.33 | -42 % | within 1 SD |
| Corners | 8.1 ± 4.2 | 6.4 ± 3.2 | -0.40 | -21 % | within 1 SD |
| Throw-ins | 43.6 ± 7.2 | 44.9 ± 6.6 | +0.18 | +3 % | within 1 SD |
| Goal kicks | 17.0 ± 1.6 | 17.6 ± 3.4 | +0.38 | +4 % | within 1 SD |
| Free kicks | 24.0 ± 4.7 | 28.4 ± 5.6 | +0.94 | +18 % | within 1 SD |
| Fouls | 22.9 ± 4.6 | 18.2 ± 5.6 | -1.00 | -20 % | within 2 SD |
| Cards | 5.3 ± 3.4 | 3.8 ± 1.9 | -0.45 | -29 % | within 1 SD |
| Ball in play, share of match time | 55.7% ± 0.0% | 51.1% ± 1.9% | -1.65 | -8 % | within 2 SD |
| Distance per full-match outfielder (km) | 10.88 ± 0.00 | 9.84 ± 0.31 | -1.91 | -10 % | within 2 SD |
| Peak speed per player, median (km/h) | 27.9 ± 0.0 | 25.8 ± 0.6 | -1.50 | -8 % | within 2 SD |
| Team width in possession (m) | 45.9 ± 4.3 | 49.8 ± 2.2 | +0.91 | +9 % | within 1 SD |
| Team width out of possession (m) | 37.0 ± 2.2 | 37.8 ± 2.3 | +0.36 | +2 % | within 1 SD |
| Defending team length, keeper excluded (m) | 32.2 ± 1.2 | 28.9 ± 1.2 | -2.05 | -10 % | off |
| Defensive line height from own goal (m) | 35.1 ± 1.5 | 33.0 ± 0.8 | -1.19 | -6 % | within 2 SD |
| Nearest defender to the ball (m) | 5.1 ± 0.5 | 5.6 ± 0.3 | +1.05 | +10 % | within 2 SD |
| Teammates within 15 m of the ball | 2.10 ± 0.14 | 2.10 ± 0.08 | -0.04 | -0 % | within 1 SD |
| Off-ball attacker to nearest defender (m) | 6.0 ± 0.5 | 7.0 ± 0.2 | +1.94 | +15 % | within 2 SD |

Summary: 15 within 1 SD, 9 within 2 SD, 2 off. z uses the real between-match SD, floored at 5 % of the mean (tracking targets come from one match).

More than 30 % from the real mean: Shots blocked, share (-48 %), Penalties per match (-42 %).

## Distributions

| Distribution | Wasserstein-1 | Jensen–Shannon (bits) |
|---|---|---|
| Completed pass length | 1.75 m | 0.0155 |
| Player speed | 0.15 m/s | 0.0080 |

Lower is closer. W1 is in the distribution's own unit; JS divergence is 0 for identical and 1 for disjoint distributions.

## Player movement against real tracking

Each statistic is a distribution; it is inside when its distance (W1) to the real matches is no larger than the largest distance between two real matches (data/params/physics.json).

| Statistic | W1 to real | Largest real-to-real | Inside |
|---|---|---|---|
| Speed, keepers (m/s) | 0.148 | 0.167 | yes |
| Speed, defenders (m/s) | 0.172 | 0.230 | yes |
| Speed, midfielders (m/s) | 0.197 | 0.201 | yes |
| Speed, forwards (m/s) | 0.158 | 0.297 | yes |
| Change of speed, keepers (m/s²) | 0.133 | 0.065 | no |
| Change of speed, defenders (m/s²) | 0.285 | 0.080 | no |
| Change of speed, midfielders (m/s²) | 0.349 | 0.080 | no |
| Change of speed, forwards (m/s²) | 0.329 | 0.074 | no |
| Top speed per player (m/s) | 0.201 | 0.460 | yes |
| Metres above 20 km/h per 90 minutes | 244.830 | 173.148 | no |
| Metres above 25 km/h per 90 minutes | 22.856 | 51.052 | yes |
| Accelerations past 3 m/s² per 90 minutes | 89.557 | 28.864 | no |
| Decelerations past 3 m/s² per 90 minutes | 66.549 | 30.909 | no |

Inside the real envelope: 6 of 13.

### Work rate by 15-minute period

Outfielders on the pitch for the whole match, metres per minute.

| Minutes | Real | Simulated | Real above 20 km/h | Simulated above 20 km/h |
|---|---|---|---|---|
| 0–15 | 121.8 | 121.9 | 8.5 | 6.8 |
| 15–30 | 120.5 | 107.1 | 9.2 | 4.6 |
| 30–45 | 114.3 | 107.8 | 8.7 | 5.1 |
| 45–60 | 113.2 | 103.7 | 7.9 | 4.5 |
| 60–75 | 102.3 | 93.9 | 6.9 | 3.8 |
| 75–90 | 99.4 | 89.5 | 6.5 | 3.3 |

Last 15 minutes of a half over its first 15 (late-to-early ratio): distance 0.87 simulated (real 0.84–0.99, mean 0.91); above 20 km/h 0.74 simulated (real 0.69–1.22, mean 0.95).

## Frozen ball carriers

Stretches of 1.5 s or more with the ball in play where the ball and the player nearest it both stand still (touchline_analytics.carriers; real values from the seven IDSSE matches).

| Players | Simulated per match | Most in a simulated match | Real per match | Simulated seconds per match | Real seconds per match |
|---|---|---|---|---|---|
| Outfielders | 0.1 | 1 | 0–1 (mean 0.1) | 0.2 | 0.0–2.5 |
| Keepers | 0.9 | 2 | 0–5 (mean 2.7) | 2.2 | 0.0–15.8 |

## Physical output and territory

Outfielders on the pitch for the whole match (183 player-matches from 16 matches), per 90 on-pitch minutes with the ball dead included. Real: IDSSE, 7 matches (2026-10-13 analysis, aggregates). Judge territory on 64 matches (`pnpm realism:deep`).

| Measure | Real | Simulated |
|---|---|---|
| Walking, under 7 km/h (km per 90) | 3.50 | 2.68 |
| Jogging, 7–14 km/h (km per 90) | 3.88 | 3.48 |
| Running, 14–20 km/h (km per 90) | 1.82 | 2.72 |
| High-speed running, 20–25 km/h (km per 90) | 0.52 | 0.27 |
| Sprinting, over 25 km/h (km per 90) | 0.17 | 0.14 |
| Sprints per 90 | 8.4 | 7.2 |
| Accelerations over 2.5 m/s² per 90 | 50 | 264 |
| Metres per minute, ball in play | 147 | 157 |
| Metres per minute, ball dead | 65 | 47 |
| High-speed running plus sprinting (km per 90) | 0.69 | 0.41 |
| Territory: SD over matches of the match-mean ball x, home attacking (m) | 1.9 | 4.8 |
| Outfield centroid minus ball x, team with the ball (m) | +3.9 | -1.2 |
| Outfield centroid minus ball x, team without it (m) | -9.5 | -5.1 |

## Passing (realism v2, P3)

| Measure | Real | Simulated | Band | Status |
|---|---|---|---|---|
| Passes per match | 866 | 958 | 776–956 | NOT MET |
| Open-play passes dying at the boot (first tick, under 1 m) | 0.000 | 0.067 | 0.000–0.010 | NOT MET |
| Completion, opponent within 1 m at release | 0.700 | 0.433 | 0.640–0.760 | NOT MET |
| Completion to an available receiver, 10–20 m | 0.936 | 0.867 | 0.900–0.970 | NOT MET |
| Completion to an available receiver, 30 m+ | 0.805 | 0.749 | 0.740–0.850 | MET |
| Completed passes of 32 m+ | 0.143 | 0.115 | 0.120–0.170 | NOT MET |
| Switches (\|dy\| > 25 m), open play | 0.061 | 0.136 | 0.040–0.080 | NOT MET |
| Receiver tightly marked (under 3 m), completed | 0.090 | 0.111 | 0.060–0.120 | MET |
| Passes back to the keeper | 0.062 | 0.022 | 0.045–0.080 | NOT MET |
| Most forward available option chosen | 0.200 | 0.298 | 0.150–0.250 | NOT MET |
| Open-play crosses per match (10 s after restarts excluded) | 14.9 | 5.8 | 12.0–18.0 | NOT MET |
| Cross end point from the goal line, median (m) | 10.0 | 10.4 | 8.0–12.0 | MET |
| Through balls per match | — | 16.4 | — | — |
| Shots after a through ball | 0.025 | 0.051 | 0.000–0.050 | NOT MET |
| Keeper passes per team-match | 45.4 | 24.3 | 35.0–55.0 | NOT MET |
| Keeper open-play completion | 0.779 | 0.780 | 0.720–0.840 | MET |
| Punts per team-match | 1.60 | 0.41 | 1.00–2.20 | NOT MET |
| Keeper throws per team-match | 3.40 | 2.44 | 2.40–4.40 | MET |
| Time to release, received under 2 m pressure, median (s) | 0.40 | 0.50 | 0.20–0.70 | MET |
| Released within 1 s, received under 2 m pressure | 0.630 | 0.759 | 0.500–0.750 | NOT MET |
| Time to release, median (s) | 1.40 | 1.30 | 1.20–1.60 | MET |
| On the ball over 3 s | 0.160 | 0.133 | 0.120–0.200 | MET |
| Ball in the possessing team's own third | 0.350 | 0.207 | 0.300–0.400 | NOT MET |
| Ball u in possession, mean (m) | -5.2 | 0.2 | -8.0–-2.0 | NOT MET |

### Pass-choice model refit

Conditional logit over the passer's teammates 4–65 m away at release, intended receiver chosen (carrier-report C3). Real: the pooled fit with its 90 % interval.

13340 passes.

| Feature | Real (90 % interval) | Simulated | Status |
|---|---|---|---|
| dist/10 | -1.33 (-1.38 to -1.27) | -1.13 ± 0.02 | NOT MET |
| fwd du/10 | +0.56 (+0.52 to +0.60) | +0.59 ± 0.01 | MET |
| \|dv\|/10 | +0.18 (+0.13 to +0.23) | +0.53 ± 0.02 | NOT MET |
| lane blocked | -0.55 (-0.62 to -0.49) | -0.44 ± 0.02 | NOT MET |
| open (min(d,10)/5) | +1.27 (+1.21 to +1.34) | +1.18 ± 0.02 | NOT MET |
| line-breaking | +0.04 (-0.06 to +0.14) | -0.04 ± 0.04 | MET |
| GK | +0.95 (+0.81 to +1.09) | +0.63 ± 0.07 | NOT MET |

## Duels, transitions and pressing (realism v2, P4)

| Measure | Real | Simulated | Band | Status |
|---|---|---|---|---|
| Tackle attempts won by the defender | 0.480 | 0.530 | 0.430–0.530 | NOT MET |
| Tackle attempts won, approach from the front | 0.540 | 0.709 | 0.490–0.590 | NOT MET |
| Tackle attempts won, approach from the side or behind (60° or more) | 0.450 | 0.487 | 0.400–0.500 | MET |
| Tackle attempts won, no defender within 3 m, tackler included (info; no sim analogue) | 0.360 | n/a | — | — |
| Tackle attempts won, tackler the only defender within 3 m | 0.510 | 0.508 | 0.450–0.570 | MET |
| Tackle attempts won, 2 or more defenders within 3 m (tackler included) | 0.600 | 0.580 | 0.540–0.660 | MET |
| Take-ons won by the defender (info) | — | 0.733 | — | — |
| Ground duels (tackle attempts and take-ons) won by the defender (info) | — | 0.687 | — | — |
| Ground duels per match (tackle attempts and take-ons) | 154.7 | 117.4 | 135.0–175.0 | NOT MET |
| Aerial duels per match | 47.0 | 32.6 | 40.0–54.0 | NOT MET |
| Fouls per match | 22.9 | 18.2 | 19.0–27.0 | NOT MET |
| Defender fouls per match (tackle and take-on) | 15.0 | 13.1 | 12.0–18.0 | MET |
| Attacker fouls per match (shielding) | 3.0 | 0.6 | 2.0–4.0 | NOT MET |
| Aerial fouls per match | 5.0 | 4.6 | 3.5–6.5 | MET |
| Free kicks within 30 m of goal per match | 0.86 | 0.81 | 0.60–1.20 | MET |
| Penalties per match | 0.43 | 0.25 | 0.25–0.50 | MET |
| Yellow cards per match (incl. second yellows) | 5.00 | 3.75 | 4.00–6.00 | NOT MET |
| Players sent off per match | 0.29 | 0.06 | 0.20–0.30 | NOT MET |
| Cards per foul (conduct cautions excluded) | 0.140 | 0.130 | 0.110–0.170 | MET |
| Counter-press: loser reaches 3 m of the ball within 3 s, 0–5 m away at the loss | 0.790 | 0.908 | 0.740–0.840 | NOT MET |
| Counter-press: reaches 3 m within 3 s, 5–10 m away | 0.280 | 0.290 | 0.230–0.330 | MET |
| Counter-press: reaches 3 m within 3 s, 10–15 m away | 0.230 | 0.123 | 0.180–0.280 | NOT MET |
| Counter-press: reaches 3 m within 3 s, 15–20 m away | 0.130 | 0.071 | 0.090–0.170 | NOT MET |
| Counter-press: reaches 3 m within 3 s, 20–30 m away | 0.070 | 0.026 | 0.040–0.100 | NOT MET |
| Losers within 5 m of the ball within 3 s, per loss | 2.29 | 2.08 | 2.00–2.60 | MET |
| Losses with 3 or more losers within 5 m within 3 s | 0.430 | 0.349 | 0.350–0.510 | NOT MET |
| Peak speed within 3 s, losers 0–5 m away, median (m/s) | 4.50 | 4.51 | 4.00–5.00 | MET |
| Ball regained within 5 s of a loss | 0.400 | 0.412 | 0.350–0.450 | MET |
| Losers running back above 4 m/s, highest share at 0–1.4 s | 0.020 | 0.041 | 0.000–0.030 | NOT MET |
| Losers running back above 4 m/s, at 2 s | 0.060 | 0.083 | 0.030–0.090 | MET |
| Losers running back above 4 m/s, at 3 s | 0.100 | 0.158 | 0.070–0.130 | NOT MET |
| Losers running back above 4 m/s, at 5–6 s | 0.150 | 0.204 | 0.120–0.180 | NOT MET |
| Losers running back above 4 m/s, at 10 s | 0.120 | 0.085 | 0.090–0.150 | NOT MET |
| Loser outfield speed at 0.8–1.4 s over speed at −1 s | 0.870 | 0.859 | 0.800–0.900 | MET |
| Press episodes per 90 open-play minutes | 405 | 492 | 365–445 | NOT MET |
| Press episodes with 3 or more engaged | 0.049 | 0.055 | 0.035–0.065 | MET |
| Press trigger lift: receiver with his back to goal | 2.08 | 0.88 | 1.60–2.60 | NOT MET |
| Press trigger lift: ball in the defenders' own third | 1.97 | 1.09 | 1.50–2.50 | NOT MET |
| Press runs by central midfielders (DM and CM) | 0.370 | 0.386 | 0.320–0.420 | MET |
| Press runs by wingers | 0.190 | 0.158 | 0.140–0.240 | MET |
| Press runs by full-backs | 0.130 | 0.151 | 0.080–0.180 | MET |
| Press runs by attacking midfielders | 0.110 | 0.049 | 0.060–0.160 | NOT MET |
| Press runs by strikers | 0.110 | 0.136 | 0.060–0.160 | MET |
| Press runs by centre-backs | 0.100 | 0.119 | 0.050–0.150 | MET |
| Press run peak speed, median (m/s; info) | 5.10 | 4.85 | — | — |
| Teammates open by 3 m per open-play pass | 7.96 | 8.54 | 7.20–8.70 | MET |
| Teammates with a clear lane per open-play pass | 4.95 | 5.32 | 4.50–5.40 | MET |
| Distance per full-match outfielder (km; info) | 10.88 | 9.84 | — | — |

- Penalties and players sent off are rare: judge them on ≥ 64 matches (`pnpm realism:deep`); this report has 16.

## Shots (realism v2, P6)

| Measure | Real | Simulated | Band | Status |
|---|---|---|---|---|
| Shots per match (all) | 24.4 | 22.3 | 21.0–28.0 | MET |
| Open-play shots per match | 17.1 | 16.6 | 14.5–19.7 | MET |
| Goals per match | 2.71 | 3.00 | 2.40–3.00 | MET |
| Open-play conversion | 0.092 | 0.121 | 0.070–0.110 | NOT MET |
| First-time shots (on the ball < 0.3 s), share of open-play shots | 0.410 | 0.298 | 0.330–0.490 | NOT MET |
| First-time shots, share of open-play goals | 0.550 | 0.094 | 0.400–0.700 | NOT MET |
| Conversion, first-time shots | 0.122 | 0.038 | 0.090–0.150 | NOT MET |
| Conversion, other open-play shots | 0.070 | 0.156 | 0.050–0.090 | NOT MET |
| Headers, share of open-play shots | 0.140 | 0.004 | 0.100–0.180 | NOT MET |
| Conversion, headers | 0.060 | 0.000 | 0.030–0.090 | NOT MET |
| Conversion, nearest defender < 1.5 m | 0.118 | 0.122 | 0.080–0.160 | MET |
| Conversion, nearest defender 1.5–3 m | 0.109 | 0.159 | 0.070–0.150 | NOT MET |
| Conversion, nearest defender 3 m or more | 0.032 | 0.108 | 0.010–0.060 | NOT MET |
| Conversion, tight minus open (< 1.5 m minus ≥ 3 m) | 0.086 | 0.014 | 0.030–0.140 | NOT MET |
| Nearest outfield defender at the shot, median (m) | 2.04 | 3.19 | 1.60–2.50 | NOT MET |
| Open-play shots from inside the box, share | 0.590 | 0.581 | 0.520–0.660 | MET |
| Conversion, inside the box | 0.127 | 0.195 | 0.090–0.160 | NOT MET |
| Conversion, outside the box | 0.041 | 0.018 | 0.020–0.060 | NOT MET |
| Open-play shots blocked, share | 0.217 | 0.113 | 0.170–0.270 | NOT MET |
| Setup: pass, share of open-play shots | 0.330 | 0.309 | 0.270–0.390 | MET |
| Setup: dribble (1.5 s and 5 m on the ball), share | 0.310 | 0.460 | 0.250–0.370 | NOT MET |
| Setup: cross, share | 0.170 | 0.045 | 0.110–0.230 | NOT MET |
| Setup: loose ball or regain, share | 0.130 | 0.117 | 0.070–0.190 | MET |
| Setup: through ball, share | 0.025 | 0.053 | 0.000–0.050 | NOT MET |
| Keeper off his line at open-play shots, median (m; info) | 2.23 | 3.30 | — | — |
| Keeper off the ball–goal line at open-play shots, median (m; info) | 0.32 | 0.63 | — | — |
| Open-play pass completion, 75–90+ minus 0–15 | -0.063 | -0.029 | -0.083–-0.043 | NOT MET |
| xG per open-play shot (real: DFL model; info) | 0.101 | 0.178 | — | — |

- conversion splits: judge on ≥ 64 matches (`pnpm realism:deep`); this report has 16 matches and 265 open-play shots.
- xG refit (fractional logit of DFL xG, 159 IDSSE shots with a defender count; method in shots.fit_xg): b0 -3.004, bDist -0.0392/m, bAngle +4.059/rad, bHeader -1.617, bDefenders -0.342; `shotModel.xg` under `shotModel.rule` 1.

## Set pieces, keeper restarts and role moves (realism v2, P5)

| Measure | Real | Simulated | Band | Status |
|---|---|---|---|---|
| Corners: attackers in the box, taker excluded | 5.49 | 5.93 | 4.80–6.20 | MET |
| Corners: attackers in the six-yard box | 1.07 | 0.00 | 0.70–1.40 | NOT MET |
| Corners: defending outfielders in the box | 9.15 | 9.00 | 8.50–9.80 | MET |
| Corners: box defenders within 2 m of an attacker, share | 0.54 | 0.68 | 0.45–0.63 | NOT MET |
| Corners: defending outfielders left up (u < 17.5) | 0.02 | 0.00 | 0.00–0.20 | MET |
| Corners: attackers kept back (u < 28) | 1.43 | 1.45 | 1.00–1.90 | MET |
| Corners: delivery completed (restart pass successful) | 0.43 | 0.60 | 0.33–0.53 | NOT MET |
| Wide attacking free kicks: attackers in the box | 3.76 | 1.21 | 3.20–4.40 | NOT MET |
| Central attacking free kicks: attackers in the box | 3.09 | 0.00 | 2.50–3.70 | NOT MET |
| Wide attacking free kicks: attackers kept back (u < 28) | 2.71 | 2.64 | 2.20–3.20 | MET |
| Central attacking free kicks: attackers kept back (u < 28) | 2.27 | 2.56 | 1.80–2.80 | MET |
| Attacking-third throw-ins: outfielders kept back (u < 28) | 4.10 | 7.37 | 3.50–4.70 | NOT MET |
| Central attacking free kicks: wall present, share | 1.00 | 1.00 | 0.90–1.00 | MET |
| Central attacking free kicks: players in the wall | 2.46 | 3.78 | 2.00–3.00 | NOT MET |
| Wide attacking free kicks: wall present, share | 0.76 | 0.71 | 0.60–0.90 | MET |
| Central attacking free kicks: nearest wall player to the ball, median (m) | 9.76 | 8.69 | 8.60–10.00 | MET |
| Goal kicks: opponents deeper than the box line (u < -36) | 0.18 | 0.00 | 0.00–0.40 | MET |
| Goal kicks: opponents in the kicking side's defensive third | 2.64 | 1.75 | 2.00–3.20 | NOT MET |
| Goal kicks: kicking side's CBs, mean u (m) | -31.4 | -30.8 | -34.0–-28.0 | MET |
| Middle-third throw-ins: team-mates within 10 m of the ball | 0.94 | 1.06 | 0.70–1.20 | MET |
| Throw-ins: first-contact distance, median (m) | 9.6 | 11.0 | 8.1–11.1 | MET |
| Kickoffs: nearest opponent to the ball (m) | 8.6 | 7.8 | 8.0–10.0 | NOT MET |
| Goal kicks: first contact beyond 32 m, share | 0.48 | 0.20 | 0.40–0.56 | NOT MET |
| Long goal kicks (32 m or more): restart pass completed, share | 0.49 | 0.65 | 0.40–0.58 | NOT MET |
| Goal kicks: opponents' shots within 10 s, per 100 | 0.9 | 3.5 | 0.0–4.0 | MET |
| Free kicks taken by the keeper, per team-match | 3.00 | 3.47 | 2.30–3.70 | MET |
| Central attacking free kicks shot directly, share | 0.36 | 0.28 | 0.20–0.50 | MET |
| Corners: shots within 10 s, per 100 | 32.1 | 29.1 | 25.0–39.0 | MET |
| Dead time before throw-ins, median (s) | 13.5 | 14.3 | 11.0–16.0 | MET |
| Dead time before goal kicks, median (s) | 22.0 | 22.5 | 19.0–25.0 | MET |
| Dead time before corners, median (s) | 33.0 | 36.5 | 30.0–36.0 | NOT MET |
| Dead time before attacking-third free kicks, median (s) | 42.0 | 41.5 | 37.0–47.0 | MET |
| Dead time before other free kicks, median (s) | 28.0 | 29.1 | 24.0–32.0 | MET |
| Dead time before kickoffs after a goal, median (s) | 70.0 | 67.7 | 62.0–78.0 | MET |
| Moving outfielders' (0.5 m/s or more) mean speed while the ball is dead, median over restarts (m/s) | 1.20 | 1.32 | 1.00–1.50 | MET |
| FB overlaps per team-match | 13.9 | 27.8 | 11.0–17.0 | NOT MET |
| Wingers coming inside per team-match | 61.9 | 23.2 | 52.0–72.0 | NOT MET |
| FB underlaps and inversions per team-match | 36.4 | 36.5 | 30.0–43.0 | MET |
| Runs in behind per team-match | 34.6 | 20.9 | 29.0–40.0 | NOT MET |
| Runs in behind starting with the ball in a wide lane, share | 0.64 | 0.52 | 0.55–0.72 | NOT MET |
| Runs in behind ending beyond the last line, share | 0.26 | 0.73 | 0.18–0.34 | NOT MET |
| CM drops into the back line per team-match | 44.7 | 44.7 | 38.0–52.0 | MET |
| Drops to receive per team-match (info) | 56.9 | 27.4 | — | — |
| Offsides per match (info) | — | 11.1 | — | — |
| Ball in play, first 15 minutes (info) | 0.62 | 0.61 | — | — |
| Ball in play, minutes 75-90 (info) | 0.43 | 0.43 | — | — |

- From 16 matches: 103 corners, 14 wide attacking free kicks, 36 central attacking free kicks, 282 goal kicks, 79 kickoffs; 718 throw-ins (93 in the attacking third).
- The direct free-kick share rests on 11 real free kicks: judge it on ≥ 64 matches (`pnpm realism:deep`); this report has 16.
- Role moves are counted from frames with the analysis's episode definitions (touchline_analytics.rolemoves), per team-match.

## Match balance and discipline

From 16 matches. These are rare or noisy measures: judge them on 64 or more (`pnpm realism:deep`); this report has fewer than 64 matches.

| Measure | Real | Simulated | Target | Status |
|---|---|---|---|---|
| Team shot share, SD over matches (C3) | 0.090 | 0.204 | ≤ 0.18 | NOT MET |
| Players sent off per match | 0.29 | 0.06 | about 0.2–0.3 | — |
| Penalties per match | 0.43 | 0.25 | — | — |


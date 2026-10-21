# Touchline realism report

Generated 2026-10-21 from 16 synthetic matches (calib-2026-10-21; held-out seeds 2000–2015) against real-match targets.

**Real data:** IDSSE / Sportec Open DFL dataset (2022/23 Bundesliga and 2. Bundesliga) — events: 7 matches; tracking: 1 match(es) (J03WPY); spatial: 7 matches. Licence CC-BY-4.0; Deutsche Fussball Liga (DFL); Bassek et al., Scientific Data (2025), doi:10.1038/s41597-025-04505-y. Only aggregate statistics are shown.

## Match statistics

| Statistic | Real (mean ± SD) | Synthetic (mean ± SD) | z | Off by | Verdict |
|---|---|---|---|---|---|
| Passes per match | 866 ± 90 | 969 ± 47 | +1.14 | +12 % | within 2 SD |
| Pass completion | 78.1% ± 3.8% | 72.6% ± 1.5% | -1.42 | -7 % | within 2 SD |
| Long passes (32 m+), share of completed | 14.3% ± 2.5% | 12.4% ± 1.6% | -0.76 | -14 % | within 1 SD |
| Median completed pass length (m) | 17.1 ± 1.3 | 16.3 ± 0.5 | -0.65 | -5 % | within 1 SD |
| Shots per match | 24.4 ± 2.9 | 25.2 ± 5.0 | +0.28 | +3 % | within 1 SD |
| Shots on target, share | 35.4% ± 7.2% | 29.7% ± 7.1% | -0.79 | -16 % | within 1 SD |
| Shots blocked, share | 22.7% ± 6.1% | 18.2% ± 8.5% | -0.73 | -20 % | within 1 SD |
| Saves, share of shots on target | 66.9% ± 16.8% | 60.7% ± 19.2% | -0.37 | -9 % | within 1 SD |
| Goals per match | 2.71 ± 1.25 | 2.94 ± 1.61 | +0.18 | +8 % | within 1 SD |
| Penalties per match | 0.43 ± 0.53 | 0.19 ± 0.40 | -0.45 | -56 % | within 1 SD |
| Corners | 8.1 ± 4.2 | 6.1 ± 3.0 | -0.49 | -26 % | within 1 SD |
| Throw-ins | 43.6 ± 7.2 | 41.0 ± 7.7 | -0.36 | -6 % | within 1 SD |
| Goal kicks | 17.0 ± 1.6 | 16.8 ± 3.0 | -0.11 | -1 % | within 1 SD |
| Free kicks | 24.0 ± 4.7 | 28.2 ± 5.0 | +0.91 | +18 % | within 1 SD |
| Fouls | 22.9 ± 4.6 | 19.8 ± 3.3 | -0.66 | -13 % | within 1 SD |
| Cards | 5.3 ± 3.4 | 4.0 ± 2.1 | -0.38 | -24 % | within 1 SD |
| Ball in play, share of match time | 55.7% ± 0.0% | 52.0% ± 2.9% | -1.33 | -7 % | within 2 SD |
| Distance per full-match outfielder (km) | 10.88 ± 0.00 | 9.63 ± 0.52 | -2.30 | -11 % | off |
| Peak speed per player, median (km/h) | 27.9 ± 0.0 | 26.0 ± 0.6 | -1.38 | -7 % | within 2 SD |
| Team width in possession (m) | 45.9 ± 4.3 | 51.1 ± 2.1 | +1.22 | +11 % | within 2 SD |
| Team width out of possession (m) | 37.0 ± 2.2 | 38.5 ± 2.4 | +0.65 | +4 % | within 1 SD |
| Defending team length, keeper excluded (m) | 32.2 ± 1.2 | 29.2 ± 1.1 | -1.85 | -9 % | within 2 SD |
| Defensive line height from own goal (m) | 35.1 ± 1.5 | 32.1 ± 0.8 | -1.74 | -9 % | within 2 SD |
| Nearest defender to the ball (m) | 5.1 ± 0.5 | 6.2 ± 0.3 | +2.09 | +20 % | off |
| Teammates within 15 m of the ball | 2.10 ± 0.14 | 2.05 ± 0.08 | -0.35 | -2 % | within 1 SD |
| Off-ball attacker to nearest defender (m) | 6.0 ± 0.5 | 7.2 ± 0.3 | +2.39 | +19 % | off |

Summary: 16 within 1 SD, 7 within 2 SD, 3 off. z uses the real between-match SD, floored at 5 % of the mean (tracking targets come from one match).

More than 30 % from the real mean: Penalties per match (-56 %).

## Distributions

| Distribution | Wasserstein-1 | Jensen–Shannon (bits) |
|---|---|---|
| Completed pass length | 1.82 m | 0.0143 |
| Player speed | 0.17 m/s | 0.0084 |

Lower is closer. W1 is in the distribution's own unit; JS divergence is 0 for identical and 1 for disjoint distributions.

## Player movement against real tracking

Each statistic is a distribution; it is inside when its distance (W1) to the real matches is no larger than the largest distance between two real matches (data/params/physics.json).

| Statistic | W1 to real | Largest real-to-real | Inside |
|---|---|---|---|
| Speed, keepers (m/s) | 0.162 | 0.167 | yes |
| Speed, defenders (m/s) | 0.162 | 0.230 | yes |
| Speed, midfielders (m/s) | 0.197 | 0.201 | yes |
| Speed, forwards (m/s) | 0.179 | 0.297 | yes |
| Change of speed, keepers (m/s²) | 0.130 | 0.065 | no |
| Change of speed, defenders (m/s²) | 0.256 | 0.080 | no |
| Change of speed, midfielders (m/s²) | 0.333 | 0.080 | no |
| Change of speed, forwards (m/s²) | 0.307 | 0.074 | no |
| Top speed per player (m/s) | 0.157 | 0.460 | yes |
| Metres above 20 km/h per 90 minutes | 264.424 | 173.148 | no |
| Metres above 25 km/h per 90 minutes | 21.050 | 51.052 | yes |
| Accelerations past 3 m/s² per 90 minutes | 89.230 | 28.864 | no |
| Decelerations past 3 m/s² per 90 minutes | 66.782 | 30.909 | no |

Inside the real envelope: 6 of 13.

### Work rate by 15-minute period

Outfielders on the pitch for the whole match, metres per minute.

| Minutes | Real | Simulated | Real above 20 km/h | Simulated above 20 km/h |
|---|---|---|---|---|
| 0–15 | 121.8 | 117.9 | 8.5 | 6.8 |
| 15–30 | 120.5 | 111.0 | 9.2 | 5.4 |
| 30–45 | 114.3 | 105.2 | 8.7 | 4.7 |
| 45–60 | 113.2 | 97.2 | 7.9 | 3.5 |
| 60–75 | 102.3 | 90.7 | 6.9 | 3.2 |
| 75–90 | 99.4 | 91.6 | 6.5 | 3.0 |

Last 15 minutes of a half over its first 15 (late-to-early ratio): distance 0.92 simulated (real 0.84–0.99, mean 0.91); above 20 km/h 0.77 simulated (real 0.69–1.22, mean 0.95).

## Frozen ball carriers

Stretches of 1.5 s or more with the ball in play where the ball and the player nearest it both stand still (touchline_analytics.carriers; real values from the seven IDSSE matches).

| Players | Simulated per match | Most in a simulated match | Real per match | Simulated seconds per match | Real seconds per match |
|---|---|---|---|---|---|
| Outfielders | 0.1 | 1 | 0–1 (mean 0.1) | 0.3 | 0.0–2.5 |
| Keepers | 0.7 | 2 | 0–5 (mean 2.7) | 1.9 | 0.0–15.8 |

## Physical output and territory

Outfielders on the pitch for the whole match (180 player-matches from 16 matches), per 90 on-pitch minutes with the ball dead included. Real: IDSSE, 7 matches (2026-10-13 analysis, aggregates). Judge territory on 64 matches (`pnpm realism:deep`).

| Measure | Real | Simulated |
|---|---|---|
| Walking, under 7 km/h (km per 90) | 3.50 | 2.74 |
| Jogging, 7–14 km/h (km per 90) | 3.88 | 3.48 |
| Running, 14–20 km/h (km per 90) | 1.82 | 2.48 |
| High-speed running, 20–25 km/h (km per 90) | 0.52 | 0.25 |
| Sprinting, over 25 km/h (km per 90) | 0.17 | 0.14 |
| Sprints per 90 | 8.4 | 7.2 |
| Accelerations over 2.5 m/s² per 90 | 50 | 239 |
| Metres per minute, ball in play | 147 | 151 |
| Metres per minute, ball dead | 65 | 46 |
| High-speed running plus sprinting (km per 90) | 0.69 | 0.39 |
| Territory: SD over matches of the match-mean ball x, home attacking (m) | 1.9 | 4.8 |
| Outfield centroid minus ball x, team with the ball (m) | +3.9 | -1.3 |
| Outfield centroid minus ball x, team without it (m) | -9.5 | -5.5 |

## Passing (realism v2, P3)

| Measure | Real | Simulated | Band | Status |
|---|---|---|---|---|
| Passes per match | 866 | 969 | 776–956 | NOT MET |
| Open-play passes dying at the boot (first tick, under 1 m) | 0.000 | 0.062 | 0.000–0.010 | NOT MET |
| Completion, opponent within 1 m at release | 0.700 | 0.452 | 0.640–0.760 | NOT MET |
| Completion to an available receiver, 10–20 m | 0.936 | 0.888 | 0.900–0.970 | NOT MET |
| Completion to an available receiver, 30 m+ | 0.805 | 0.778 | 0.740–0.850 | MET |
| Completed passes of 32 m+ | 0.143 | 0.116 | 0.120–0.170 | NOT MET |
| Switches (\|dy\| > 25 m), open play | 0.061 | 0.146 | 0.040–0.080 | NOT MET |
| Receiver tightly marked (under 3 m), completed | 0.090 | 0.099 | 0.060–0.120 | MET |
| Passes back to the keeper | 0.062 | 0.020 | 0.045–0.080 | NOT MET |
| Most forward available option chosen | 0.200 | 0.283 | 0.150–0.250 | NOT MET |
| Open-play crosses per match (10 s after restarts excluded) | 14.9 | 7.6 | 12.0–18.0 | NOT MET |
| Cross end point from the goal line, median (m) | 10.0 | 12.1 | 8.0–12.0 | NOT MET |
| Through balls per match | — | 14.8 | — | — |
| Shots after a through ball | 0.025 | 0.035 | 0.000–0.050 | MET |
| Keeper passes per team-match | 45.4 | 22.7 | 35.0–55.0 | NOT MET |
| Keeper open-play completion | 0.779 | 0.868 | 0.720–0.840 | NOT MET |
| Punts per team-match | 1.60 | 0.56 | 1.00–2.20 | NOT MET |
| Keeper throws per team-match | 3.40 | 2.25 | 2.40–4.40 | NOT MET |
| Time to release, received under 2 m pressure, median (s) | 0.40 | 0.50 | 0.20–0.70 | MET |
| Released within 1 s, received under 2 m pressure | 0.630 | 0.768 | 0.500–0.750 | NOT MET |
| Time to release, median (s) | 1.40 | 1.20 | 1.20–1.60 | MET |
| On the ball over 3 s | 0.160 | 0.130 | 0.120–0.200 | MET |
| Ball in the possessing team's own third | 0.350 | 0.191 | 0.300–0.400 | NOT MET |
| Ball u in possession, mean (m) | -5.2 | 0.8 | -8.0–-2.0 | NOT MET |

### Pass-choice model refit

Conditional logit over the passer's teammates 4–65 m away at release, intended receiver chosen (carrier-report C3). Real: the pooled fit with its 90 % interval.

13615 passes.

| Feature | Real (90 % interval) | Simulated | Status |
|---|---|---|---|
| dist/10 | -1.33 (-1.38 to -1.27) | -1.14 ± 0.02 | NOT MET |
| fwd du/10 | +0.56 (+0.52 to +0.60) | +0.58 ± 0.01 | MET |
| \|dv\|/10 | +0.18 (+0.13 to +0.23) | +0.56 ± 0.02 | NOT MET |
| lane blocked | -0.55 (-0.62 to -0.49) | -0.46 ± 0.02 | NOT MET |
| open (min(d,10)/5) | +1.27 (+1.21 to +1.34) | +1.22 ± 0.02 | MET |
| line-breaking | +0.04 (-0.06 to +0.14) | +0.01 ± 0.04 | MET |
| GK | +0.95 (+0.81 to +1.09) | +0.53 ± 0.07 | NOT MET |

## Duels, transitions and pressing (realism v2, P4)

| Measure | Real | Simulated | Band | Status |
|---|---|---|---|---|
| Tackle attempts won by the defender | 0.480 | 0.518 | 0.430–0.530 | MET |
| Tackle attempts won, approach from the front | 0.540 | 0.581 | 0.490–0.590 | MET |
| Tackle attempts won, approach from the side or behind (60° or more) | 0.450 | 0.505 | 0.400–0.500 | NOT MET |
| Tackle attempts won, no defender within 3 m, tackler included (info; no sim analogue) | 0.360 | n/a | — | — |
| Tackle attempts won, tackler the only defender within 3 m | 0.510 | 0.493 | 0.450–0.570 | MET |
| Tackle attempts won, 2 or more defenders within 3 m (tackler included) | 0.600 | 0.580 | 0.540–0.660 | MET |
| Take-ons won by the defender (info) | — | 0.733 | — | — |
| Ground duels (tackle attempts and take-ons) won by the defender (info) | — | 0.685 | — | — |
| Ground duels per match (tackle attempts and take-ons) | 154.7 | 119.2 | 135.0–175.0 | NOT MET |
| Aerial duels per match | 47.0 | 38.2 | 40.0–54.0 | NOT MET |
| Fouls per match | 22.9 | 19.8 | 19.0–27.0 | MET |
| Defender fouls per match (tackle and take-on) | 15.0 | 14.7 | 12.0–18.0 | MET |
| Attacker fouls per match (shielding) | 3.0 | 0.5 | 2.0–4.0 | NOT MET |
| Aerial fouls per match | 5.0 | 4.6 | 3.5–6.5 | MET |
| Free kicks within 30 m of goal per match | 0.86 | 1.31 | 0.60–1.20 | NOT MET |
| Penalties per match | 0.43 | 0.19 | 0.25–0.50 | NOT MET |
| Yellow cards per match (incl. second yellows) | 5.00 | 3.81 | 4.00–6.00 | NOT MET |
| Players sent off per match | 0.29 | 0.31 | 0.20–0.30 | NOT MET |
| Cards per foul (conduct cautions excluded) | 0.140 | 0.132 | 0.110–0.170 | MET |
| Counter-press: loser reaches 3 m of the ball within 3 s, 0–5 m away at the loss | 0.790 | 0.913 | 0.740–0.840 | NOT MET |
| Counter-press: reaches 3 m within 3 s, 5–10 m away | 0.280 | 0.289 | 0.230–0.330 | MET |
| Counter-press: reaches 3 m within 3 s, 10–15 m away | 0.230 | 0.121 | 0.180–0.280 | NOT MET |
| Counter-press: reaches 3 m within 3 s, 15–20 m away | 0.130 | 0.054 | 0.090–0.170 | NOT MET |
| Counter-press: reaches 3 m within 3 s, 20–30 m away | 0.070 | 0.024 | 0.040–0.100 | NOT MET |
| Losers within 5 m of the ball within 3 s, per loss | 2.29 | 1.99 | 2.00–2.60 | NOT MET |
| Losses with 3 or more losers within 5 m within 3 s | 0.430 | 0.292 | 0.350–0.510 | NOT MET |
| Peak speed within 3 s, losers 0–5 m away, median (m/s) | 4.50 | 4.52 | 4.00–5.00 | MET |
| Ball regained within 5 s of a loss | 0.400 | 0.415 | 0.350–0.450 | MET |
| Losers running back above 4 m/s, highest share at 0–1.4 s | 0.020 | 0.046 | 0.000–0.030 | NOT MET |
| Losers running back above 4 m/s, at 2 s | 0.060 | 0.093 | 0.030–0.090 | NOT MET |
| Losers running back above 4 m/s, at 3 s | 0.100 | 0.175 | 0.070–0.130 | NOT MET |
| Losers running back above 4 m/s, at 5–6 s | 0.150 | 0.205 | 0.120–0.180 | NOT MET |
| Losers running back above 4 m/s, at 10 s | 0.120 | 0.077 | 0.090–0.150 | NOT MET |
| Loser outfield speed at 0.8–1.4 s over speed at −1 s | 0.870 | 0.836 | 0.800–0.900 | MET |
| Press episodes per 90 open-play minutes | 405 | 416 | 365–445 | MET |
| Press episodes with 3 or more engaged | 0.049 | 0.048 | 0.035–0.065 | MET |
| Press trigger lift: receiver with his back to goal | 2.08 | 0.73 | 1.60–2.60 | NOT MET |
| Press trigger lift: ball in the defenders' own third | 1.97 | 1.20 | 1.50–2.50 | NOT MET |
| Press runs by central midfielders (DM and CM) | 0.370 | 0.381 | 0.320–0.420 | MET |
| Press runs by wingers | 0.190 | 0.149 | 0.140–0.240 | MET |
| Press runs by full-backs | 0.130 | 0.152 | 0.080–0.180 | MET |
| Press runs by attacking midfielders | 0.110 | 0.053 | 0.060–0.160 | NOT MET |
| Press runs by strikers | 0.110 | 0.148 | 0.060–0.160 | MET |
| Press runs by centre-backs | 0.100 | 0.118 | 0.050–0.150 | MET |
| Press run peak speed, median (m/s; info) | 5.10 | 5.18 | — | — |
| Teammates open by 3 m per open-play pass | 7.96 | 8.53 | 7.20–8.70 | MET |
| Teammates with a clear lane per open-play pass | 4.95 | 5.79 | 4.50–5.40 | NOT MET |
| Distance per full-match outfielder (km; info) | 10.88 | 9.63 | — | — |

- Penalties and players sent off are rare: judge them on ≥ 64 matches (`pnpm realism:deep`); this report has 16.

## Shots (realism v2, P6)

| Measure | Real | Simulated | Band | Status |
|---|---|---|---|---|
| Shots per match (all) | 24.4 | 25.2 | 21.0–28.0 | MET |
| Open-play shots per match | 17.1 | 18.9 | 14.5–19.7 | MET |
| Goals per match | 2.71 | 3.25 | 2.40–3.00 | NOT MET |
| Open-play conversion | 0.092 | 0.119 | 0.070–0.110 | NOT MET |
| First-time shots (on the ball < 0.3 s), share of open-play shots | 0.410 | 0.307 | 0.330–0.490 | NOT MET |
| First-time shots, share of open-play goals | 0.550 | 0.278 | 0.400–0.700 | NOT MET |
| Conversion, first-time shots | 0.122 | 0.108 | 0.090–0.150 | MET |
| Conversion, other open-play shots | 0.070 | 0.124 | 0.050–0.090 | NOT MET |
| Headers, share of open-play shots | 0.140 | 0.017 | 0.100–0.180 | NOT MET |
| Conversion, headers | 0.060 | 0.200 | 0.030–0.090 | NOT MET |
| Conversion, nearest defender < 1.5 m | 0.118 | 0.054 | 0.080–0.160 | NOT MET |
| Conversion, nearest defender 1.5–3 m | 0.109 | 0.111 | 0.070–0.150 | MET |
| Conversion, nearest defender 3 m or more | 0.032 | 0.155 | 0.010–0.060 | NOT MET |
| Conversion, tight minus open (< 1.5 m minus ≥ 3 m) | 0.086 | -0.101 | 0.030–0.140 | NOT MET |
| Nearest outfield defender at the shot, median (m) | 2.04 | 3.62 | 1.60–2.50 | NOT MET |
| Open-play shots from inside the box, share | 0.590 | 0.620 | 0.520–0.660 | MET |
| Conversion, inside the box | 0.127 | 0.170 | 0.090–0.160 | NOT MET |
| Conversion, outside the box | 0.041 | 0.035 | 0.020–0.060 | MET |
| Open-play shots blocked, share | 0.217 | 0.162 | 0.170–0.270 | NOT MET |
| Setup: pass, share of open-play shots | 0.330 | 0.340 | 0.270–0.390 | MET |
| Setup: dribble (1.5 s and 5 m on the ball), share | 0.310 | 0.439 | 0.250–0.370 | NOT MET |
| Setup: cross, share | 0.170 | 0.043 | 0.110–0.230 | NOT MET |
| Setup: loose ball or regain, share | 0.130 | 0.109 | 0.070–0.190 | MET |
| Setup: through ball, share | 0.025 | 0.043 | 0.000–0.050 | MET |
| Keeper off his line at open-play shots, median (m; info) | 2.23 | 3.04 | — | — |
| Keeper off the ball–goal line at open-play shots, median (m; info) | 0.32 | 0.75 | — | — |
| Open-play pass completion, 75–90+ minus 0–15 | -0.063 | 0.002 | -0.083–-0.043 | NOT MET |
| xG per open-play shot (real: DFL model; info) | 0.101 | 0.152 | — | — |

- conversion splits: judge on ≥ 64 matches (`pnpm realism:deep`); this report has 16 matches and 303 open-play shots.
- xG refit (fractional logit of DFL xG, 159 IDSSE shots with a defender count; method in shots.fit_xg): b0 -3.004, bDist -0.0392/m, bAngle +4.059/rad, bHeader -1.617, bDefenders -0.342; `shotModel.xg` under `shotModel.rule` 1.

## Set pieces, keeper restarts and role moves (realism v2, P5)

| Measure | Real | Simulated | Band | Status |
|---|---|---|---|---|
| Corners: attackers in the box, taker excluded | 5.49 | 5.76 | 4.80–6.20 | MET |
| Corners: attackers in the six-yard box | 1.07 | 0.00 | 0.70–1.40 | NOT MET |
| Corners: defending outfielders in the box | 9.15 | 9.00 | 8.50–9.80 | MET |
| Corners: box defenders within 2 m of an attacker, share | 0.54 | 0.67 | 0.45–0.63 | NOT MET |
| Corners: defending outfielders left up (u < 17.5) | 0.02 | 0.00 | 0.00–0.20 | MET |
| Corners: attackers kept back (u < 28) | 1.43 | 1.40 | 1.00–1.90 | MET |
| Corners: delivery completed (restart pass successful) | 0.43 | 0.56 | 0.33–0.53 | NOT MET |
| Wide attacking free kicks: attackers in the box | 3.76 | 1.30 | 3.20–4.40 | NOT MET |
| Central attacking free kicks: attackers in the box | 3.09 | 0.00 | 2.50–3.70 | NOT MET |
| Wide attacking free kicks: attackers kept back (u < 28) | 2.71 | 2.70 | 2.20–3.20 | MET |
| Central attacking free kicks: attackers kept back (u < 28) | 2.27 | 2.60 | 1.80–2.80 | MET |
| Attacking-third throw-ins: outfielders kept back (u < 28) | 4.10 | 7.24 | 3.50–4.70 | NOT MET |
| Central attacking free kicks: wall present, share | 1.00 | 1.00 | 0.90–1.00 | MET |
| Central attacking free kicks: players in the wall | 2.46 | 4.00 | 2.00–3.00 | NOT MET |
| Wide attacking free kicks: wall present, share | 0.76 | 0.78 | 0.60–0.90 | MET |
| Central attacking free kicks: nearest wall player to the ball, median (m) | 9.76 | 8.69 | 8.60–10.00 | MET |
| Goal kicks: opponents deeper than the box line (u < -36) | 0.18 | 0.00 | 0.00–0.40 | MET |
| Goal kicks: opponents in the kicking side's defensive third | 2.64 | 1.72 | 2.00–3.20 | NOT MET |
| Goal kicks: kicking side's CBs, mean u (m) | -31.4 | -30.6 | -34.0–-28.0 | MET |
| Middle-third throw-ins: team-mates within 10 m of the ball | 0.94 | 1.08 | 0.70–1.20 | MET |
| Throw-ins: first-contact distance, median (m) | 9.6 | 10.7 | 8.1–11.1 | MET |
| Kickoffs: nearest opponent to the ball (m) | 8.6 | 7.9 | 8.0–10.0 | NOT MET |
| Goal kicks: first contact beyond 32 m, share | 0.48 | 0.19 | 0.40–0.56 | NOT MET |
| Long goal kicks (32 m or more): restart pass completed, share | 0.49 | 0.68 | 0.40–0.58 | NOT MET |
| Goal kicks: opponents' shots within 10 s, per 100 | 0.9 | 1.1 | 0.0–4.0 | MET |
| Free kicks taken by the keeper, per team-match | 3.00 | 2.94 | 2.30–3.70 | MET |
| Central attacking free kicks shot directly, share | 0.36 | 0.41 | 0.20–0.50 | MET |
| Corners: shots within 10 s, per 100 | 32.1 | 40.2 | 25.0–39.0 | NOT MET |
| Dead time before throw-ins, median (s) | 13.5 | 14.1 | 11.0–16.0 | MET |
| Dead time before goal kicks, median (s) | 22.0 | 22.3 | 19.0–25.0 | MET |
| Dead time before corners, median (s) | 33.0 | 34.3 | 30.0–36.0 | MET |
| Dead time before attacking-third free kicks, median (s) | 42.0 | 45.7 | 37.0–47.0 | MET |
| Dead time before other free kicks, median (s) | 28.0 | 29.6 | 24.0–32.0 | MET |
| Dead time before kickoffs after a goal, median (s) | 70.0 | 78.7 | 62.0–78.0 | NOT MET |
| Moving outfielders' (0.5 m/s or more) mean speed while the ball is dead, median over restarts (m/s) | 1.20 | 1.32 | 1.00–1.50 | MET |
| FB overlaps per team-match | 13.9 | 29.0 | 11.0–17.0 | NOT MET |
| Wingers coming inside per team-match | 61.9 | 21.9 | 52.0–72.0 | NOT MET |
| FB underlaps and inversions per team-match | 36.4 | 37.5 | 30.0–43.0 | MET |
| Runs in behind per team-match | 34.6 | 19.5 | 29.0–40.0 | NOT MET |
| Runs in behind starting with the ball in a wide lane, share | 0.64 | 0.52 | 0.55–0.72 | NOT MET |
| Runs in behind ending beyond the last line, share | 0.26 | 0.73 | 0.18–0.34 | NOT MET |
| CM drops into the back line per team-match | 44.7 | 44.2 | 38.0–52.0 | MET |
| Drops to receive per team-match (info) | 56.9 | 27.3 | — | — |
| Offsides per match (info) | — | 9.8 | — | — |
| Ball in play, first 15 minutes (info) | 0.62 | 0.62 | — | — |
| Ball in play, minutes 75-90 (info) | 0.43 | 0.47 | — | — |

- From 16 matches: 97 corners, 24 wide attacking free kicks, 44 central attacking free kicks, 269 goal kicks, 84 kickoffs; 656 throw-ins (84 in the attacking third).
- The direct free-kick share rests on 11 real free kicks: judge it on ≥ 64 matches (`pnpm realism:deep`); this report has 16.
- Role moves are counted from frames with the analysis's episode definitions (touchline_analytics.rolemoves), per team-match.

## Match balance and discipline

From 16 matches. These are rare or noisy measures: judge them on 64 or more (`pnpm realism:deep`); this report has fewer than 64 matches.

| Measure | Real | Simulated | Target | Status |
|---|---|---|---|---|
| Team shot share, SD over matches (C3) | 0.090 | 0.196 | ≤ 0.18 | NOT MET |
| Players sent off per match | 0.29 | 0.31 | about 0.2–0.3 | — |
| Penalties per match | 0.43 | 0.19 | — | — |


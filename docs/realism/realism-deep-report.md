# Touchline realism report

Generated 2026-10-20 from 64 synthetic matches (calib-2026-10-19; held-out seeds 2000–2063) against real-match targets.

**Real data:** IDSSE / Sportec Open DFL dataset (2022/23 Bundesliga and 2. Bundesliga) — events: 7 matches; tracking: 1 match(es) (J03WPY); spatial: 7 matches. Licence CC-BY-4.0; Deutsche Fussball Liga (DFL); Bassek et al., Scientific Data (2025), doi:10.1038/s41597-025-04505-y. Only aggregate statistics are shown.

## Match statistics

| Statistic | Real (mean ± SD) | Synthetic (mean ± SD) | z | Off by | Verdict |
|---|---|---|---|---|---|
| Passes per match | 866 ± 90 | 914 ± 53 | +0.53 | +6 % | within 1 SD |
| Pass completion | 78.1% ± 3.8% | 70.4% ± 1.8% | -1.97 | -10 % | within 2 SD |
| Long passes (32 m+), share of completed | 14.3% ± 2.5% | 12.7% ± 1.7% | -0.64 | -11 % | within 1 SD |
| Median completed pass length (m) | 17.1 ± 1.3 | 16.4 ± 0.5 | -0.58 | -4 % | within 1 SD |
| Shots per match | 24.4 ± 2.9 | 25.7 ± 5.1 | +0.44 | +5 % | within 1 SD |
| Shots on target, share | 35.4% ± 7.2% | 30.3% ± 8.3% | -0.70 | -14 % | within 1 SD |
| Shots blocked, share | 22.7% ± 6.1% | 16.2% ± 7.5% | -1.05 | -28 % | within 2 SD |
| Saves, share of shots on target | 66.9% ± 16.8% | 60.7% ± 20.9% | -0.37 | -9 % | within 1 SD |
| Goals per match | 2.71 ± 1.25 | 2.97 ± 1.59 | +0.20 | +9 % | within 1 SD |
| Penalties per match | 0.43 ± 0.53 | 0.23 ± 0.53 | -0.36 | -45 % | within 1 SD |
| Corners | 8.1 ± 4.2 | 9.6 ± 4.0 | +0.35 | +18 % | within 1 SD |
| Throw-ins | 43.6 ± 7.2 | 46.7 ± 6.6 | +0.43 | +7 % | within 1 SD |
| Goal kicks | 17.0 ± 1.6 | 18.2 ± 3.8 | +0.76 | +7 % | within 1 SD |
| Free kicks | 24.0 ± 4.7 | 28.0 ± 5.4 | +0.87 | +17 % | within 1 SD |
| Fouls | 22.9 ± 4.6 | 18.3 ± 3.7 | -1.00 | -20 % | within 1 SD |
| Cards | 5.3 ± 3.4 | 3.4 ± 2.1 | -0.55 | -35 % | within 1 SD |
| Ball in play, share of match time | 55.7% ± 0.0% | 52.6% ± 2.9% | -1.13 | -6 % | within 2 SD |
| Distance per full-match outfielder (km) | 10.88 ± 0.00 | 10.04 ± 0.47 | -1.54 | -8 % | within 2 SD |
| Peak speed per player, median (km/h) | 27.9 ± 0.0 | 25.4 ± 0.6 | -1.81 | -9 % | within 2 SD |
| Team width in possession (m) | 45.9 ± 4.3 | 52.8 ± 2.6 | +1.61 | +15 % | within 2 SD |
| Team width out of possession (m) | 37.0 ± 2.2 | 39.6 ± 2.5 | +1.15 | +7 % | within 2 SD |
| Defending team length, keeper excluded (m) | 32.2 ± 1.2 | 29.8 ± 1.1 | -1.45 | -7 % | within 2 SD |
| Defensive line height from own goal (m) | 35.1 ± 1.5 | 32.1 ± 1.1 | -1.72 | -9 % | within 2 SD |
| Nearest defender to the ball (m) | 5.1 ± 0.5 | 6.4 ± 0.3 | +2.57 | +25 % | off |
| Teammates within 15 m of the ball | 2.10 ± 0.14 | 1.92 ± 0.10 | -1.31 | -9 % | within 2 SD |
| Off-ball attacker to nearest defender (m) | 6.0 ± 0.5 | 6.8 ± 0.4 | +1.71 | +13 % | within 2 SD |

Summary: 14 within 1 SD, 11 within 2 SD, 1 off. z uses the real between-match SD, floored at 5 % of the mean (tracking targets come from one match).

More than 30 % from the real mean: Penalties per match (-45 %), Cards (-35 %).

## Distributions

| Distribution | Wasserstein-1 | Jensen–Shannon (bits) |
|---|---|---|
| Completed pass length | 1.65 m | 0.0124 |
| Player speed | 0.32 m/s | 0.0560 |

Lower is closer. W1 is in the distribution's own unit; JS divergence is 0 for identical and 1 for disjoint distributions.

## Player movement against real tracking

Each statistic is a distribution; it is inside when its distance (W1) to the real matches is no larger than the largest distance between two real matches (data/params/physics.json).

| Statistic | W1 to real | Largest real-to-real | Inside |
|---|---|---|---|
| Speed, keepers (m/s) | 0.204 | 0.167 | no |
| Speed, defenders (m/s) | 0.395 | 0.230 | no |
| Speed, midfielders (m/s) | 0.401 | 0.201 | no |
| Speed, forwards (m/s) | 0.381 | 0.297 | no |
| Change of speed, keepers (m/s²) | 0.187 | 0.065 | no |
| Change of speed, defenders (m/s²) | 0.297 | 0.080 | no |
| Change of speed, midfielders (m/s²) | 0.387 | 0.080 | no |
| Change of speed, forwards (m/s²) | 0.418 | 0.074 | no |
| Top speed per player (m/s) | 0.225 | 0.460 | yes |
| Metres above 20 km/h per 90 minutes | 269.216 | 173.148 | no |
| Metres above 25 km/h per 90 minutes | 38.299 | 51.052 | yes |
| Accelerations past 3 m/s² per 90 minutes | 95.732 | 28.864 | no |
| Decelerations past 3 m/s² per 90 minutes | 71.618 | 30.909 | no |

Inside the real envelope: 2 of 13.

### Work rate by 15-minute period

Outfielders on the pitch for the whole match, metres per minute.

| Minutes | Real | Simulated | Real above 20 km/h | Simulated above 20 km/h |
|---|---|---|---|---|
| 0–15 | 121.8 | 105.7 | 8.5 | 8.2 |
| 15–30 | 120.5 | 105.2 | 9.2 | 8.0 |
| 30–45 | 114.3 | 105.5 | 8.7 | 7.7 |
| 45–60 | 113.2 | 106.7 | 7.9 | 7.7 |
| 60–75 | 102.3 | 104.3 | 6.9 | 7.8 |
| 75–90 | 99.4 | 105.0 | 6.5 | 7.3 |

Last 15 minutes of a half over its first 15 (late-to-early ratio): distance 0.99 simulated (real 0.84–0.99, mean 0.91); above 20 km/h 0.94 simulated (real 0.69–1.22, mean 0.95).

## Frozen ball carriers

Stretches of 1.5 s or more with the ball in play where the ball and the player nearest it both stand still (touchline_analytics.carriers; real values from the seven IDSSE matches).

| Players | Simulated per match | Most in a simulated match | Real per match | Simulated seconds per match | Real seconds per match |
|---|---|---|---|---|---|
| Outfielders | 0.2 | 1 | 0–1 (mean 0.1) | 0.5 | 0.0–2.5 |
| Keepers | 1.0 | 4 | 0–5 (mean 2.7) | 2.7 | 0.0–15.8 |

## Physical output and territory

Outfielders on the pitch for the whole match (734 player-matches from 64 matches), per 90 on-pitch minutes with the ball dead included. Real: IDSSE, 7 matches (2026-10-13 analysis, aggregates). Judge territory on 64 matches (`pnpm realism:deep`).

| Measure | Real | Simulated |
|---|---|---|
| Walking, under 7 km/h (km per 90) | 3.50 | 2.00 |
| Jogging, 7–14 km/h (km per 90) | 3.88 | 3.22 |
| Running, 14–20 km/h (km per 90) | 1.82 | 3.53 |
| High-speed running, 20–25 km/h (km per 90) | 0.52 | 0.62 |
| Sprinting, over 25 km/h (km per 90) | 0.17 | 0.09 |
| Sprints per 90 | 8.4 | 4.2 |
| Accelerations over 2.5 m/s² per 90 | 50 | 297 |
| Metres per minute, ball in play | 147 | 150 |
| Metres per minute, ball dead | 65 | 56 |
| High-speed running plus sprinting (km per 90) | 0.69 | 0.71 |
| Territory: SD over matches of the match-mean ball x, home attacking (m) | 1.9 | 4.8 |
| Outfield centroid minus ball x, team with the ball (m) | +3.9 | -0.6 |
| Outfield centroid minus ball x, team without it (m) | -9.5 | -6.4 |

## Passing (realism v2, P3)

| Measure | Real | Simulated | Band | Status |
|---|---|---|---|---|
| Passes per match | 866 | 914 | 776–956 | MET |
| Open-play passes dying at the boot (first tick, under 1 m) | 0.000 | 0.069 | 0.000–0.010 | NOT MET |
| Completion, opponent within 1 m at release | 0.700 | 0.424 | 0.640–0.760 | NOT MET |
| Completion to an available receiver, 10–20 m | 0.936 | 0.851 | 0.900–0.970 | NOT MET |
| Completion to an available receiver, 30 m+ | 0.805 | 0.762 | 0.740–0.850 | MET |
| Completed passes of 32 m+ | 0.143 | 0.115 | 0.120–0.170 | NOT MET |
| Switches (\|dy\| > 25 m), open play | 0.061 | 0.144 | 0.040–0.080 | NOT MET |
| Receiver tightly marked (under 3 m), completed | 0.090 | 0.121 | 0.060–0.120 | NOT MET |
| Passes back to the keeper | 0.062 | 0.024 | 0.045–0.080 | NOT MET |
| Most forward available option chosen | 0.200 | 0.279 | 0.150–0.250 | NOT MET |
| Open-play crosses per match (10 s after restarts excluded) | 14.9 | 9.5 | 12.0–18.0 | NOT MET |
| Cross end point from the goal line, median (m) | 10.0 | 11.6 | 8.0–12.0 | MET |
| Through balls per match | — | 18.9 | — | — |
| Shots after a through ball | 0.025 | 0.050 | 0.000–0.050 | MET |
| Keeper passes per team-match | 45.4 | 22.3 | 35.0–55.0 | NOT MET |
| Keeper open-play completion | 0.779 | 0.851 | 0.720–0.840 | NOT MET |
| Punts per team-match | 1.60 | 0.62 | 1.00–2.20 | NOT MET |
| Keeper throws per team-match | 3.40 | 3.16 | 2.40–4.40 | MET |
| Time to release, received under 2 m pressure, median (s) | 0.40 | 0.50 | 0.20–0.70 | MET |
| Released within 1 s, received under 2 m pressure | 0.630 | 0.787 | 0.500–0.750 | NOT MET |
| Time to release, median (s) | 1.40 | 1.60 | 1.20–1.60 | MET |
| On the ball over 3 s | 0.160 | 0.164 | 0.120–0.200 | MET |
| Ball in the possessing team's own third | 0.350 | 0.217 | 0.300–0.400 | NOT MET |
| Ball u in possession, mean (m) | -5.2 | 0.1 | -8.0–-2.0 | NOT MET |

### Pass-choice model refit

Conditional logit over the passer's teammates 4–65 m away at release, intended receiver chosen (carrier-report C3). Real: the pooled fit with its 90 % interval.

50428 passes.

| Feature | Real (90 % interval) | Simulated | Status |
|---|---|---|---|
| dist/10 | -1.33 (-1.38 to -1.27) | -1.20 ± 0.01 | NOT MET |
| fwd du/10 | +0.56 (+0.52 to +0.60) | +0.59 ± 0.01 | MET |
| \|dv\|/10 | +0.18 (+0.13 to +0.23) | +0.58 ± 0.01 | NOT MET |
| lane blocked | -0.55 (-0.62 to -0.49) | -0.42 ± 0.01 | NOT MET |
| open (min(d,10)/5) | +1.27 (+1.21 to +1.34) | +1.21 ± 0.01 | MET |
| line-breaking | +0.04 (-0.06 to +0.14) | -0.03 ± 0.02 | MET |
| GK | +0.95 (+0.81 to +1.09) | +0.62 ± 0.03 | NOT MET |

## Duels, transitions and pressing (realism v2, P4)

| Measure | Real | Simulated | Band | Status |
|---|---|---|---|---|
| Tackle attempts won by the defender | 0.480 | 0.535 | 0.430–0.530 | NOT MET |
| Tackle attempts won, approach from the front | 0.540 | 0.561 | 0.490–0.590 | MET |
| Tackle attempts won, approach from the side or behind (60° or more) | 0.450 | 0.530 | 0.400–0.500 | NOT MET |
| Tackle attempts won, no defender within 3 m, tackler included (info; no sim analogue) | 0.360 | n/a | — | — |
| Tackle attempts won, tackler the only defender within 3 m | 0.510 | 0.495 | 0.450–0.570 | MET |
| Tackle attempts won, 2 or more defenders within 3 m (tackler included) | 0.600 | 0.619 | 0.540–0.660 | MET |
| Take-ons won by the defender (info) | — | 0.723 | — | — |
| Ground duels (tackle attempts and take-ons) won by the defender (info) | — | 0.680 | — | — |
| Ground duels per match (tackle attempts and take-ons) | 154.7 | 111.8 | 135.0–175.0 | NOT MET |
| Aerial duels per match | 47.0 | 29.5 | 40.0–54.0 | NOT MET |
| Fouls per match | 22.9 | 18.3 | 19.0–27.0 | NOT MET |
| Defender fouls per match (tackle and take-on) | 15.0 | 13.3 | 12.0–18.0 | MET |
| Attacker fouls per match (shielding) | 3.0 | 0.9 | 2.0–4.0 | NOT MET |
| Aerial fouls per match | 5.0 | 4.0 | 3.5–6.5 | MET |
| Free kicks within 30 m of goal per match | 0.86 | 1.30 | 0.60–1.20 | NOT MET |
| Penalties per match | 0.43 | 0.23 | 0.25–0.50 | NOT MET |
| Yellow cards per match (incl. second yellows) | 5.00 | 3.30 | 4.00–6.00 | NOT MET |
| Players sent off per match | 0.29 | 0.30 | 0.20–0.30 | MET |
| Cards per foul (conduct cautions excluded) | 0.140 | 0.101 | 0.110–0.170 | NOT MET |
| Counter-press: loser reaches 3 m of the ball within 3 s, 0–5 m away at the loss | 0.790 | 0.934 | 0.740–0.840 | NOT MET |
| Counter-press: reaches 3 m within 3 s, 5–10 m away | 0.280 | 0.311 | 0.230–0.330 | MET |
| Counter-press: reaches 3 m within 3 s, 10–15 m away | 0.230 | 0.120 | 0.180–0.280 | NOT MET |
| Counter-press: reaches 3 m within 3 s, 15–20 m away | 0.130 | 0.056 | 0.090–0.170 | NOT MET |
| Counter-press: reaches 3 m within 3 s, 20–30 m away | 0.070 | 0.021 | 0.040–0.100 | NOT MET |
| Losers within 5 m of the ball within 3 s, per loss | 2.29 | 1.95 | 2.00–2.60 | NOT MET |
| Losses with 3 or more losers within 5 m within 3 s | 0.430 | 0.291 | 0.350–0.510 | NOT MET |
| Peak speed within 3 s, losers 0–5 m away, median (m/s) | 4.50 | 4.52 | 4.00–5.00 | MET |
| Ball regained within 5 s of a loss | 0.400 | 0.408 | 0.350–0.450 | MET |
| Losers running back above 4 m/s, highest share at 0–1.4 s | 0.020 | 0.048 | 0.000–0.030 | NOT MET |
| Losers running back above 4 m/s, at 2 s | 0.060 | 0.100 | 0.030–0.090 | NOT MET |
| Losers running back above 4 m/s, at 3 s | 0.100 | 0.203 | 0.070–0.130 | NOT MET |
| Losers running back above 4 m/s, at 5–6 s | 0.150 | 0.239 | 0.120–0.180 | NOT MET |
| Losers running back above 4 m/s, at 10 s | 0.120 | 0.098 | 0.090–0.150 | MET |
| Loser outfield speed at 0.8–1.4 s over speed at −1 s | 0.870 | 0.977 | 0.800–0.900 | NOT MET |
| Press episodes per 90 open-play minutes | 405 | 410 | 365–445 | MET |
| Press episodes with 3 or more engaged | 0.049 | 0.058 | 0.035–0.065 | MET |
| Press trigger lift: receiver with his back to goal | 2.08 | 0.84 | 1.60–2.60 | NOT MET |
| Press trigger lift: ball in the defenders' own third | 1.97 | 1.25 | 1.50–2.50 | NOT MET |
| Press runs by central midfielders (DM and CM) | 0.370 | 0.379 | 0.320–0.420 | MET |
| Press runs by wingers | 0.190 | 0.140 | 0.140–0.240 | NOT MET |
| Press runs by full-backs | 0.130 | 0.155 | 0.080–0.180 | MET |
| Press runs by attacking midfielders | 0.110 | 0.045 | 0.060–0.160 | NOT MET |
| Press runs by strikers | 0.110 | 0.149 | 0.060–0.160 | MET |
| Press runs by centre-backs | 0.100 | 0.132 | 0.050–0.150 | MET |
| Press run peak speed, median (m/s; info) | 5.10 | 5.01 | — | — |
| Teammates open by 3 m per open-play pass | 7.96 | 8.12 | 7.20–8.70 | MET |
| Teammates with a clear lane per open-play pass | 4.95 | 5.99 | 4.50–5.40 | NOT MET |
| Distance per full-match outfielder (km; info) | 10.88 | 10.04 | — | — |

- Penalties and players sent off are rare: judge them on ≥ 64 matches (`pnpm realism:deep`); this report has 64.

## Match balance and discipline

From 64 matches.

| Measure | Real | Simulated | Target | Status |
|---|---|---|---|---|
| Team shot share, SD over matches (C3) | 0.090 | 0.175 | ≤ 0.18 | MET |
| Players sent off per match | 0.29 | 0.30 | about 0.2–0.3 | — |
| Penalties per match | 0.43 | 0.23 | — | — |


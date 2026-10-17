# Touchline realism report

Generated 2026-10-17 from 16 synthetic matches (calib-2026-10-17; held-out seeds 2000–2015) against real-match targets.

**Real data:** IDSSE / Sportec Open DFL dataset (2022/23 Bundesliga and 2. Bundesliga) — events: 7 matches; tracking: 1 match(es) (J03WPY); spatial: 7 matches. Licence CC-BY-4.0; Deutsche Fussball Liga (DFL); Bassek et al., Scientific Data (2025), doi:10.1038/s41597-025-04505-y. Only aggregate statistics are shown.

## Match statistics

| Statistic | Real (mean ± SD) | Synthetic (mean ± SD) | z | Off by | Verdict |
|---|---|---|---|---|---|
| Passes per match | 866 ± 90 | 782 ± 45 | -0.94 | -10 % | within 1 SD |
| Pass completion | 78.1% ± 3.8% | 74.9% ± 1.4% | -0.81 | -4 % | within 1 SD |
| Long passes (32 m+), share of completed | 14.3% ± 2.5% | 12.6% ± 2.0% | -0.67 | -12 % | within 1 SD |
| Median completed pass length (m) | 17.1 ± 1.3 | 15.2 ± 0.5 | -1.56 | -12 % | within 2 SD |
| Shots per match | 24.4 ± 2.9 | 27.7 ± 5.1 | +1.11 | +13 % | within 2 SD |
| Shots on target, share | 35.4% ± 7.2% | 28.9% ± 9.3% | -0.90 | -18 % | within 1 SD |
| Shots blocked, share | 22.7% ± 6.1% | 17.7% ± 6.4% | -0.81 | -22 % | within 1 SD |
| Saves, share of shots on target | 66.9% ± 16.8% | 74.0% ± 16.9% | +0.42 | +10 % | within 1 SD |
| Goals per match | 2.71 ± 1.25 | 2.00 ± 1.55 | -0.57 | -26 % | within 1 SD |
| Penalties per match | 0.43 ± 0.53 | 0.12 ± 0.34 | -0.57 | -71 % | within 1 SD |
| Corners | 8.1 ± 4.2 | 9.9 ± 2.7 | +0.43 | +22 % | within 1 SD |
| Throw-ins | 43.6 ± 7.2 | 31.9 ± 4.8 | -1.63 | -27 % | within 2 SD |
| Goal kicks | 17.0 ± 1.6 | 19.1 ± 5.1 | +1.26 | +12 % | within 2 SD |
| Free kicks | 24.0 ± 4.7 | 21.9 ± 4.6 | -0.44 | -9 % | within 1 SD |
| Fouls | 22.9 ± 4.6 | 13.4 ± 3.6 | -2.05 | -41 % | off |
| Cards | 5.3 ± 3.4 | 6.9 ± 3.0 | +0.49 | +31 % | within 1 SD |
| Ball in play, share of match time | 55.7% ± 0.0% | 53.1% ± 2.4% | -0.94 | -5 % | within 1 SD |
| Distance per full-match outfielder (km) | 10.88 ± 0.00 | 9.16 ± 0.45 | -3.17 | -16 % | off |
| Peak speed per player, median (km/h) | 27.9 ± 0.0 | 25.5 ± 0.7 | -1.78 | -9 % | within 2 SD |
| Team width in possession (m) | 45.9 ± 4.3 | 50.2 ± 2.5 | +1.00 | +9 % | within 2 SD |
| Team width out of possession (m) | 37.0 ± 2.2 | 38.2 ± 2.6 | +0.54 | +3 % | within 1 SD |
| Defending team length, keeper excluded (m) | 32.2 ± 1.2 | 29.6 ± 1.2 | -1.60 | -8 % | within 2 SD |
| Defensive line height from own goal (m) | 35.1 ± 1.5 | 31.6 ± 1.1 | -1.98 | -10 % | within 2 SD |
| Nearest defender to the ball (m) | 5.1 ± 0.5 | 5.9 ± 0.3 | +1.56 | +15 % | within 2 SD |
| Teammates within 15 m of the ball | 2.10 ± 0.14 | 2.14 ± 0.11 | +0.32 | +2 % | within 1 SD |
| Off-ball attacker to nearest defender (m) | 6.0 ± 0.5 | 6.6 ± 0.3 | +1.29 | +10 % | within 2 SD |

Summary: 14 within 1 SD, 10 within 2 SD, 2 off. z uses the real between-match SD, floored at 5 % of the mean (tracking targets come from one match).

More than 30 % from the real mean: Penalties per match (-71 %), Fouls (-41 %), Cards (+31 %).

## Distributions

| Distribution | Wasserstein-1 | Jensen–Shannon (bits) |
|---|---|---|
| Completed pass length | 1.93 m | 0.0134 |
| Player speed | 0.31 m/s | 0.0535 |

Lower is closer. W1 is in the distribution's own unit; JS divergence is 0 for identical and 1 for disjoint distributions.

## Player movement against real tracking

Each statistic is a distribution; it is inside when its distance (W1) to the real matches is no larger than the largest distance between two real matches (data/params/physics.json).

| Statistic | W1 to real | Largest real-to-real | Inside |
|---|---|---|---|
| Speed, keepers (m/s) | 0.241 | 0.167 | no |
| Speed, defenders (m/s) | 0.354 | 0.230 | no |
| Speed, midfielders (m/s) | 0.363 | 0.201 | no |
| Speed, forwards (m/s) | 0.335 | 0.297 | no |
| Change of speed, keepers (m/s²) | 0.175 | 0.065 | no |
| Change of speed, defenders (m/s²) | 0.230 | 0.080 | no |
| Change of speed, midfielders (m/s²) | 0.338 | 0.080 | no |
| Change of speed, forwards (m/s²) | 0.360 | 0.074 | no |
| Top speed per player (m/s) | 0.334 | 0.460 | yes |
| Metres above 20 km/h per 90 minutes | 270.117 | 173.148 | no |
| Metres above 25 km/h per 90 minutes | 41.483 | 51.052 | yes |
| Accelerations past 3 m/s² per 90 minutes | 93.410 | 28.864 | no |
| Decelerations past 3 m/s² per 90 minutes | 69.395 | 30.909 | no |

Inside the real envelope: 2 of 13.

### Work rate by 15-minute period

Outfielders on the pitch for the whole match, metres per minute.

| Minutes | Real | Simulated | Real above 20 km/h | Simulated above 20 km/h |
|---|---|---|---|---|
| 0–15 | 121.8 | 94.2 | 8.5 | 9.5 |
| 15–30 | 120.5 | 99.5 | 9.2 | 8.9 |
| 30–45 | 114.3 | 95.7 | 8.7 | 8.7 |
| 45–60 | 113.2 | 96.0 | 7.9 | 9.2 |
| 60–75 | 102.3 | 96.5 | 6.9 | 8.9 |
| 75–90 | 99.4 | 94.1 | 6.5 | 8.3 |

Last 15 minutes of a half over its first 15 (late-to-early ratio): distance 1.00 simulated (real 0.84–0.99, mean 0.91); above 20 km/h 0.91 simulated (real 0.69–1.22, mean 0.95).

## Frozen ball carriers

Stretches of 1.5 s or more with the ball in play where the ball and the player nearest it both stand still (touchline_analytics.carriers; real values from the seven IDSSE matches).

| Players | Simulated per match | Most in a simulated match | Real per match | Simulated seconds per match | Real seconds per match |
|---|---|---|---|---|---|
| Outfielders | 0.2 | 2 | 0–1 (mean 0.1) | 0.8 | 0.0–2.5 |
| Keepers | 1.7 | 3 | 0–5 (mean 2.7) | 5.5 | 0.0–15.8 |

## Physical output and territory

Outfielders on the pitch for the whole match (180 player-matches from 16 matches), per 90 on-pitch minutes with the ball dead included. Real: IDSSE, 7 matches (2026-10-13 analysis, aggregates). Judge territory on 64 matches (`pnpm realism:deep`).

| Measure | Real | Simulated |
|---|---|---|
| Walking, under 7 km/h (km per 90) | 3.50 | 2.22 |
| Jogging, 7–14 km/h (km per 90) | 3.88 | 3.07 |
| Running, 14–20 km/h (km per 90) | 1.82 | 2.49 |
| High-speed running, 20–25 km/h (km per 90) | 0.52 | 0.72 |
| Sprinting, over 25 km/h (km per 90) | 0.17 | 0.09 |
| Sprints per 90 | 8.4 | 4.1 |
| Accelerations over 2.5 m/s² per 90 | 50 | 252 |
| Metres per minute, ball in play | 147 | 139 |
| Metres per minute, ball dead | 65 | 45 |
| High-speed running plus sprinting (km per 90) | 0.69 | 0.81 |
| Territory: SD over matches of the match-mean ball x, home attacking (m) | 1.9 | 5.3 |
| Outfield centroid minus ball x, team with the ball (m) | +3.9 | -0.5 |
| Outfield centroid minus ball x, team without it (m) | -9.5 | -6.9 |

## Passing (realism v2, P3)

| Measure | Real | Simulated | Band | Status |
|---|---|---|---|---|
| Passes per match | 866 | 782 | 776–956 | MET |
| Open-play passes dying at the boot (first tick, under 1 m) | 0.000 | 0.050 | 0.000–0.010 | NOT MET |
| Completion, opponent within 1 m at release | 0.700 | 0.475 | 0.640–0.760 | NOT MET |
| Completion to an available receiver, 10–20 m | 0.936 | 0.894 | 0.900–0.970 | NOT MET |
| Completion to an available receiver, 30 m+ | 0.805 | 0.817 | 0.740–0.850 | MET |
| Completed passes of 32 m+ | 0.143 | 0.114 | 0.120–0.170 | NOT MET |
| Switches (\|dy\| > 25 m), open play | 0.061 | 0.136 | 0.040–0.080 | NOT MET |
| Receiver tightly marked (under 3 m), completed | 0.090 | 0.107 | 0.060–0.120 | MET |
| Passes back to the keeper | 0.062 | 0.020 | 0.045–0.080 | NOT MET |
| Most forward available option chosen | 0.200 | 0.275 | 0.150–0.250 | NOT MET |
| Open-play crosses per match (10 s after restarts excluded) | 14.9 | 7.2 | 12.0–18.0 | NOT MET |
| Cross end point from the goal line, median (m) | 10.0 | 10.1 | 8.0–12.0 | MET |
| Through balls per match | — | 18.4 | — | — |
| Shots after a through ball | 0.025 | 0.050 | 0.000–0.050 | MET |
| Keeper passes per team-match | 45.4 | 21.2 | 35.0–55.0 | NOT MET |
| Keeper open-play completion | 0.779 | 0.885 | 0.720–0.840 | NOT MET |
| Punts per team-match | 1.60 | 0.91 | 1.00–2.20 | NOT MET |
| Keeper throws per team-match | 3.40 | 3.44 | 2.40–4.40 | MET |
| Time to release, received under 2 m pressure, median (s) | 0.40 | 0.50 | 0.20–0.70 | MET |
| Released within 1 s, received under 2 m pressure | 0.630 | 0.810 | 0.500–0.750 | NOT MET |
| Time to release, median (s) | 1.40 | 2.00 | 1.20–1.60 | NOT MET |
| On the ball over 3 s | 0.160 | 0.217 | 0.120–0.200 | NOT MET |
| Ball in the possessing team's own third | 0.350 | 0.206 | 0.300–0.400 | NOT MET |
| Ball u in possession, mean (m) | -5.2 | 0.3 | -8.0–-2.0 | NOT MET |

### Pass-choice model refit

Conditional logit over the passer's teammates 4–65 m away at release, intended receiver chosen (carrier-report C3). Real: the pooled fit with its 90 % interval.

10946 passes.

| Feature | Real (90 % interval) | Simulated | Status |
|---|---|---|---|
| dist/10 | -1.33 (-1.38 to -1.27) | -1.11 ± 0.02 | NOT MET |
| fwd du/10 | +0.56 (+0.52 to +0.60) | +0.58 ± 0.02 | MET |
| \|dv\|/10 | +0.18 (+0.13 to +0.23) | +0.53 ± 0.02 | NOT MET |
| lane blocked | -0.55 (-0.62 to -0.49) | -0.45 ± 0.03 | NOT MET |
| open (min(d,10)/5) | +1.27 (+1.21 to +1.34) | +1.20 ± 0.02 | NOT MET |
| line-breaking | +0.04 (-0.06 to +0.14) | +0.02 ± 0.04 | MET |
| GK | +0.95 (+0.81 to +1.09) | +0.47 ± 0.08 | NOT MET |

## Match balance and discipline

From 16 matches. These are rare or noisy measures: judge them on 64 or more (`pnpm realism:deep`); this report has fewer than 64 matches.

| Measure | Real | Simulated | Target | Status |
|---|---|---|---|---|
| Team shot share, SD over matches (C3) | 0.090 | 0.211 | ≤ 0.18 | NOT MET |
| Players sent off per match | 0.29 | 0.25 | about 0.2–0.3 | — |
| Penalties per match | 0.43 | 0.12 | — | — |


# Touchline realism report

Generated 2026-10-17 from 64 synthetic matches (calib-2026-10-17; held-out seeds 2000–2063) against real-match targets.

**Real data:** IDSSE / Sportec Open DFL dataset (2022/23 Bundesliga and 2. Bundesliga) — events: 7 matches; tracking: 1 match(es) (J03WPY); spatial: 7 matches. Licence CC-BY-4.0; Deutsche Fussball Liga (DFL); Bassek et al., Scientific Data (2025), doi:10.1038/s41597-025-04505-y. Only aggregate statistics are shown.

## Match statistics

| Statistic | Real (mean ± SD) | Synthetic (mean ± SD) | z | Off by | Verdict |
|---|---|---|---|---|---|
| Passes per match | 866 ± 90 | 806 ± 46 | -0.66 | -7 % | within 1 SD |
| Pass completion | 78.1% ± 3.8% | 76.2% ± 2.1% | -0.49 | -2 % | within 1 SD |
| Long passes (32 m+), share of completed | 14.3% ± 2.5% | 12.3% ± 1.9% | -0.79 | -14 % | within 1 SD |
| Median completed pass length (m) | 17.1 ± 1.3 | 15.1 ± 0.4 | -1.62 | -12 % | within 2 SD |
| Shots per match | 24.4 ± 2.9 | 26.1 ± 4.6 | +0.58 | +7 % | within 1 SD |
| Shots on target, share | 35.4% ± 7.2% | 27.7% ± 9.1% | -1.06 | -22 % | within 2 SD |
| Shots blocked, share | 22.7% ± 6.1% | 18.1% ± 8.6% | -0.75 | -20 % | within 1 SD |
| Saves, share of shots on target | 66.9% ± 16.8% | 71.5% ± 19.2% | +0.27 | +7 % | within 1 SD |
| Goals per match | 2.71 ± 1.25 | 1.95 ± 1.37 | -0.61 | -28 % | within 1 SD |
| Penalties per match | 0.43 ± 0.53 | 0.09 ± 0.29 | -0.63 | -78 % | within 1 SD |
| Corners | 8.1 ± 4.2 | 9.9 ± 3.6 | +0.42 | +22 % | within 1 SD |
| Throw-ins | 43.6 ± 7.2 | 30.0 ± 4.9 | -1.88 | -31 % | within 2 SD |
| Goal kicks | 17.0 ± 1.6 | 18.2 ± 4.1 | +0.77 | +7 % | within 1 SD |
| Free kicks | 24.0 ± 4.7 | 21.6 ± 4.9 | -0.52 | -10 % | within 1 SD |
| Fouls | 22.9 ± 4.6 | 13.9 ± 3.6 | -1.95 | -39 % | within 2 SD |
| Cards | 5.3 ± 3.4 | 7.4 ± 2.8 | +0.63 | +41 % | within 1 SD |
| Ball in play, share of match time | 55.7% ± 0.0% | 54.7% ± 3.1% | -0.36 | -2 % | within 1 SD |
| Distance per full-match outfielder (km) | 10.88 ± 0.00 | 9.26 ± 0.48 | -2.97 | -15 % | off |
| Peak speed per player, median (km/h) | 27.9 ± 0.0 | 25.3 ± 0.6 | -1.88 | -9 % | within 2 SD |
| Team width in possession (m) | 45.9 ± 4.3 | 50.7 ± 2.6 | +1.11 | +10 % | within 2 SD |
| Team width out of possession (m) | 37.0 ± 2.2 | 38.2 ± 2.6 | +0.51 | +3 % | within 1 SD |
| Defending team length, keeper excluded (m) | 32.2 ± 1.2 | 29.7 ± 1.1 | -1.53 | -8 % | within 2 SD |
| Defensive line height from own goal (m) | 35.1 ± 1.5 | 31.7 ± 1.3 | -1.96 | -10 % | within 2 SD |
| Nearest defender to the ball (m) | 5.1 ± 0.5 | 6.0 ± 0.3 | +1.77 | +17 % | within 2 SD |
| Teammates within 15 m of the ball | 2.10 ± 0.14 | 2.14 ± 0.11 | +0.26 | +2 % | within 1 SD |
| Off-ball attacker to nearest defender (m) | 6.0 ± 0.5 | 6.7 ± 0.4 | +1.51 | +12 % | within 2 SD |

Summary: 15 within 1 SD, 10 within 2 SD, 1 off. z uses the real between-match SD, floored at 5 % of the mean (tracking targets come from one match).

More than 30 % from the real mean: Penalties per match (-78 %), Throw-ins (-31 %), Fouls (-39 %), Cards (+41 %).

## Distributions

| Distribution | Wasserstein-1 | Jensen–Shannon (bits) |
|---|---|---|
| Completed pass length | 2.08 m | 0.0131 |
| Player speed | 0.29 m/s | 0.0493 |

Lower is closer. W1 is in the distribution's own unit; JS divergence is 0 for identical and 1 for disjoint distributions.

## Player movement against real tracking

Each statistic is a distribution; it is inside when its distance (W1) to the real matches is no larger than the largest distance between two real matches (data/params/physics.json).

| Statistic | W1 to real | Largest real-to-real | Inside |
|---|---|---|---|
| Speed, keepers (m/s) | 0.234 | 0.167 | no |
| Speed, defenders (m/s) | 0.335 | 0.230 | no |
| Speed, midfielders (m/s) | 0.344 | 0.201 | no |
| Speed, forwards (m/s) | 0.321 | 0.297 | no |
| Change of speed, keepers (m/s²) | 0.168 | 0.065 | no |
| Change of speed, defenders (m/s²) | 0.235 | 0.080 | no |
| Change of speed, midfielders (m/s²) | 0.347 | 0.080 | no |
| Change of speed, forwards (m/s²) | 0.370 | 0.074 | no |
| Top speed per player (m/s) | 0.337 | 0.460 | yes |
| Metres above 20 km/h per 90 minutes | 260.707 | 173.148 | no |
| Metres above 25 km/h per 90 minutes | 39.523 | 51.052 | yes |
| Accelerations past 3 m/s² per 90 minutes | 93.214 | 28.864 | no |
| Decelerations past 3 m/s² per 90 minutes | 69.103 | 30.909 | no |

Inside the real envelope: 2 of 13.

### Work rate by 15-minute period

Outfielders on the pitch for the whole match, metres per minute.

| Minutes | Real | Simulated | Real above 20 km/h | Simulated above 20 km/h |
|---|---|---|---|---|
| 0–15 | 121.8 | 97.8 | 8.5 | 9.5 |
| 15–30 | 120.5 | 97.5 | 9.2 | 9.0 |
| 30–45 | 114.3 | 94.9 | 8.7 | 8.6 |
| 45–60 | 113.2 | 97.1 | 7.9 | 8.8 |
| 60–75 | 102.3 | 98.7 | 6.9 | 8.8 |
| 75–90 | 99.4 | 97.4 | 6.5 | 8.3 |

Last 15 minutes of a half over its first 15 (late-to-early ratio): distance 0.99 simulated (real 0.84–0.99, mean 0.91); above 20 km/h 0.92 simulated (real 0.69–1.22, mean 0.95).

## Frozen ball carriers

Stretches of 1.5 s or more with the ball in play where the ball and the player nearest it both stand still (touchline_analytics.carriers; real values from the seven IDSSE matches).

| Players | Simulated per match | Most in a simulated match | Real per match | Simulated seconds per match | Real seconds per match |
|---|---|---|---|---|---|
| Outfielders | 0.2 | 2 | 0–1 (mean 0.1) | 0.7 | 0.0–2.5 |
| Keepers | 1.4 | 5 | 0–5 (mean 2.7) | 4.9 | 0.0–15.8 |

## Physical output and territory

Outfielders on the pitch for the whole match (706 player-matches from 64 matches), per 90 on-pitch minutes with the ball dead included. Real: IDSSE, 7 matches (2026-10-13 analysis, aggregates). Judge territory on 64 matches (`pnpm realism:deep`).

| Measure | Real | Simulated |
|---|---|---|
| Walking, under 7 km/h (km per 90) | 3.50 | 2.24 |
| Jogging, 7–14 km/h (km per 90) | 3.88 | 3.15 |
| Running, 14–20 km/h (km per 90) | 1.82 | 2.53 |
| High-speed running, 20–25 km/h (km per 90) | 0.52 | 0.71 |
| Sprinting, over 25 km/h (km per 90) | 0.17 | 0.09 |
| Sprints per 90 | 8.4 | 4.0 |
| Accelerations over 2.5 m/s² per 90 | 50 | 253 |
| Metres per minute, ball in play | 147 | 140 |
| Metres per minute, ball dead | 65 | 45 |
| High-speed running plus sprinting (km per 90) | 0.69 | 0.80 |
| Territory: SD over matches of the match-mean ball x, home attacking (m) | 1.9 | 5.6 |
| Outfield centroid minus ball x, team with the ball (m) | +3.9 | -0.4 |
| Outfield centroid minus ball x, team without it (m) | -9.5 | -7.2 |

## Passing (realism v2, P3)

| Measure | Real | Simulated | Band | Status |
|---|---|---|---|---|
| Passes per match | 866 | 806 | 776–956 | MET |
| Open-play passes dying at the boot (first tick, under 1 m) | 0.000 | 0.049 | 0.000–0.010 | NOT MET |
| Completion, opponent within 1 m at release | 0.700 | 0.474 | 0.640–0.760 | NOT MET |
| Completion to an available receiver, 10–20 m | 0.936 | 0.902 | 0.900–0.970 | MET |
| Completion to an available receiver, 30 m+ | 0.805 | 0.818 | 0.740–0.850 | MET |
| Completed passes of 32 m+ | 0.143 | 0.112 | 0.120–0.170 | NOT MET |
| Switches (\|dy\| > 25 m), open play | 0.061 | 0.135 | 0.040–0.080 | NOT MET |
| Receiver tightly marked (under 3 m), completed | 0.090 | 0.100 | 0.060–0.120 | MET |
| Passes back to the keeper | 0.062 | 0.022 | 0.045–0.080 | NOT MET |
| Most forward available option chosen | 0.200 | 0.276 | 0.150–0.250 | NOT MET |
| Open-play crosses per match (10 s after restarts excluded) | 14.9 | 7.0 | 12.0–18.0 | NOT MET |
| Cross end point from the goal line, median (m) | 10.0 | 10.0 | 8.0–12.0 | MET |
| Through balls per match | — | 17.7 | — | — |
| Shots after a through ball | 0.025 | 0.043 | 0.000–0.050 | MET |
| Keeper passes per team-match | 45.4 | 21.3 | 35.0–55.0 | NOT MET |
| Keeper open-play completion | 0.779 | 0.893 | 0.720–0.840 | NOT MET |
| Punts per team-match | 1.60 | 0.63 | 1.00–2.20 | NOT MET |
| Keeper throws per team-match | 3.40 | 2.97 | 2.40–4.40 | MET |
| Time to release, received under 2 m pressure, median (s) | 0.40 | 0.50 | 0.20–0.70 | MET |
| Released within 1 s, received under 2 m pressure | 0.630 | 0.786 | 0.500–0.750 | NOT MET |
| Time to release, median (s) | 1.40 | 2.00 | 1.20–1.60 | NOT MET |
| On the ball over 3 s | 0.160 | 0.217 | 0.120–0.200 | NOT MET |
| Ball in the possessing team's own third | 0.350 | 0.206 | 0.300–0.400 | NOT MET |
| Ball u in possession, mean (m) | -5.2 | 0.1 | -8.0–-2.0 | NOT MET |

### Pass-choice model refit

Conditional logit over the passer's teammates 4–65 m away at release, intended receiver chosen (carrier-report C3). Real: the pooled fit with its 90 % interval.

45537 passes.

| Feature | Real (90 % interval) | Simulated | Status |
|---|---|---|---|
| dist/10 | -1.33 (-1.38 to -1.27) | -1.16 ± 0.01 | NOT MET |
| fwd du/10 | +0.56 (+0.52 to +0.60) | +0.58 ± 0.01 | MET |
| \|dv\|/10 | +0.18 (+0.13 to +0.23) | +0.55 ± 0.01 | NOT MET |
| lane blocked | -0.55 (-0.62 to -0.49) | -0.45 ± 0.01 | NOT MET |
| open (min(d,10)/5) | +1.27 (+1.21 to +1.34) | +1.22 ± 0.01 | MET |
| line-breaking | +0.04 (-0.06 to +0.14) | +0.01 ± 0.02 | MET |
| GK | +0.95 (+0.81 to +1.09) | +0.57 ± 0.04 | NOT MET |

## Match balance and discipline

From 64 matches.

| Measure | Real | Simulated | Target | Status |
|---|---|---|---|---|
| Team shot share, SD over matches (C3) | 0.090 | 0.227 | ≤ 0.18 | NOT MET |
| Players sent off per match | 0.29 | 0.75 | about 0.2–0.3 | — |
| Penalties per match | 0.43 | 0.09 | — | — |


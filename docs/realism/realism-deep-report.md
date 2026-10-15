# Touchline realism report

Generated 2026-10-15 from 64 synthetic matches (calib-2026-10-15; held-out seeds 2000–2063) against real-match targets.

**Real data:** IDSSE / Sportec Open DFL dataset (2022/23 Bundesliga and 2. Bundesliga) — events: 7 matches; tracking: 1 match(es) (J03WPY); spatial: 7 matches. Licence CC-BY-4.0; Deutsche Fussball Liga (DFL); Bassek et al., Scientific Data (2025), doi:10.1038/s41597-025-04505-y. Only aggregate statistics are shown.

## Match statistics

| Statistic | Real (mean ± SD) | Synthetic (mean ± SD) | z | Off by | Verdict |
|---|---|---|---|---|---|
| Passes per match | 866 ± 90 | 1055 ± 67 | +2.10 | +22 % | off |
| Pass completion | 78.1% ± 3.8% | 72.3% ± 1.4% | -1.48 | -7 % | within 2 SD |
| Long passes (32 m+), share of completed | 14.3% ± 2.5% | 14.9% ± 1.9% | +0.24 | +4 % | within 1 SD |
| Median completed pass length (m) | 17.1 ± 1.3 | 14.8 ± 0.7 | -1.87 | -14 % | within 2 SD |
| Shots per match | 24.4 ± 2.9 | 21.8 ± 4.2 | -0.89 | -11 % | within 1 SD |
| Shots on target, share | 35.4% ± 7.2% | 28.5% ± 11.1% | -0.95 | -19 % | within 1 SD |
| Shots blocked, share | 22.7% ± 6.1% | 12.6% ± 7.8% | -1.65 | -44 % | within 2 SD |
| Saves, share of shots on target | 66.9% ± 16.8% | 78.0% ± 21.0% | +0.66 | +17 % | within 1 SD |
| Goals per match | 2.71 ± 1.25 | 1.28 ± 1.00 | -1.14 | -53 % | within 2 SD |
| Penalties per match | 0.43 ± 0.53 | 0.28 ± 0.49 | -0.28 | -34 % | within 1 SD |
| Corners | 8.1 ± 4.2 | 6.6 ± 3.0 | -0.36 | -19 % | within 1 SD |
| Throw-ins | 43.6 ± 7.2 | 41.4 ± 5.8 | -0.31 | -5 % | within 1 SD |
| Goal kicks | 17.0 ± 1.6 | 17.6 ± 3.6 | +0.34 | +3 % | within 1 SD |
| Free kicks | 24.0 ± 4.7 | 25.6 ± 4.2 | +0.34 | +7 % | within 1 SD |
| Fouls | 22.9 ± 4.6 | 16.1 ± 3.9 | -1.46 | -29 % | within 2 SD |
| Cards | 5.3 ± 3.4 | 6.8 ± 2.6 | +0.43 | +28 % | within 1 SD |
| Ball in play, share of match time | 55.7% ± 0.0% | 51.5% ± 3.0% | -1.49 | -7 % | within 2 SD |
| Distance per full-match outfielder (km) | 10.88 ± 0.00 | 9.99 ± 0.49 | -1.65 | -8 % | within 2 SD |
| Peak speed per player, median (km/h) | 27.9 ± 0.0 | 25.7 ± 0.5 | -1.60 | -8 % | within 2 SD |
| Team width in possession (m) | 45.9 ± 4.3 | 48.4 ± 2.5 | +0.57 | +5 % | within 1 SD |
| Team width out of possession (m) | 37.0 ± 2.2 | 38.1 ± 2.6 | +0.50 | +3 % | within 1 SD |
| Defending team length, keeper excluded (m) | 32.2 ± 1.2 | 29.2 ± 1.2 | -1.85 | -9 % | within 2 SD |
| Defensive line height from own goal (m) | 35.1 ± 1.5 | 31.8 ± 1.0 | -1.88 | -9 % | within 2 SD |
| Nearest defender to the ball (m) | 5.1 ± 0.5 | 5.7 ± 0.2 | +1.18 | +12 % | within 2 SD |
| Teammates within 15 m of the ball | 2.10 ± 0.14 | 2.45 ± 0.13 | +2.57 | +17 % | off |
| Off-ball attacker to nearest defender (m) | 6.0 ± 0.5 | 6.9 ± 0.4 | +1.81 | +14 % | within 2 SD |

Summary: 12 within 1 SD, 12 within 2 SD, 2 off. z uses the real between-match SD, floored at 5 % of the mean (tracking targets come from one match).

More than 30 % from the real mean: Shots blocked, share (-44 %), Goals per match (-53 %), Penalties per match (-34 %).

## Distributions

| Distribution | Wasserstein-1 | Jensen–Shannon (bits) |
|---|---|---|
| Completed pass length | 2.33 m | 0.0262 |
| Player speed | 0.33 m/s | 0.0602 |

Lower is closer. W1 is in the distribution's own unit; JS divergence is 0 for identical and 1 for disjoint distributions.

## Player movement against real tracking

Each statistic is a distribution; it is inside when its distance (W1) to the real matches is no larger than the largest distance between two real matches (data/params/physics.json).

| Statistic | W1 to real | Largest real-to-real | Inside |
|---|---|---|---|
| Speed, keepers (m/s) | 0.186 | 0.167 | no |
| Speed, defenders (m/s) | 0.402 | 0.230 | no |
| Speed, midfielders (m/s) | 0.433 | 0.201 | no |
| Speed, forwards (m/s) | 0.375 | 0.297 | no |
| Change of speed, keepers (m/s²) | 0.179 | 0.065 | no |
| Change of speed, defenders (m/s²) | 0.310 | 0.080 | no |
| Change of speed, midfielders (m/s²) | 0.414 | 0.080 | no |
| Change of speed, forwards (m/s²) | 0.417 | 0.074 | no |
| Top speed per player (m/s) | 0.257 | 0.460 | yes |
| Metres above 20 km/h per 90 minutes | 222.033 | 173.148 | no |
| Metres above 25 km/h per 90 minutes | 34.499 | 51.052 | yes |
| Accelerations past 3 m/s² per 90 minutes | 94.204 | 28.864 | no |
| Decelerations past 3 m/s² per 90 minutes | 70.791 | 30.909 | no |

Inside the real envelope: 2 of 13.

### Work rate by 15-minute period

Outfielders on the pitch for the whole match, metres per minute.

| Minutes | Real | Simulated | Real above 20 km/h | Simulated above 20 km/h |
|---|---|---|---|---|
| 0–15 | 121.8 | 106.1 | 8.5 | 11.6 |
| 15–30 | 120.5 | 104.5 | 9.2 | 11.2 |
| 30–45 | 114.3 | 104.6 | 8.7 | 11.0 |
| 45–60 | 113.2 | 105.2 | 7.9 | 11.2 |
| 60–75 | 102.3 | 104.2 | 6.9 | 10.7 |
| 75–90 | 99.4 | 104.1 | 6.5 | 10.5 |

Last 15 minutes of a half over its first 15 (late-to-early ratio): distance 0.99 simulated (real 0.84–0.99, mean 0.91); above 20 km/h 0.94 simulated (real 0.69–1.22, mean 0.95).

## Frozen ball carriers

Stretches of 1.5 s or more with the ball in play where the ball and the player nearest it both stand still (touchline_analytics.carriers; real values from the seven IDSSE matches).

| Players | Simulated per match | Most in a simulated match | Real per match | Simulated seconds per match | Real seconds per match |
|---|---|---|---|---|---|
| Outfielders | 0.0 | 0 | 0–1 (mean 0.1) | 0.0 | 0.0–2.5 |
| Keepers | 0.3 | 2 | 0–5 (mean 2.7) | 0.8 | 0.0–15.8 |

## Physical output and territory

Outfielders on the pitch for the whole match (721 player-matches from 64 matches), per 90 on-pitch minutes with the ball dead included. Real: IDSSE, 7 matches (2026-10-13 analysis, aggregates). Judge territory on 64 matches (`pnpm realism:deep`).

| Measure | Real | Simulated |
|---|---|---|
| Walking, under 7 km/h (km per 90) | 3.50 | 1.93 |
| Jogging, 7–14 km/h (km per 90) | 3.88 | 3.35 |
| Running, 14–20 km/h (km per 90) | 1.82 | 3.13 |
| High-speed running, 20–25 km/h (km per 90) | 0.52 | 0.90 |
| Sprinting, over 25 km/h (km per 90) | 0.17 | 0.11 |
| Sprints per 90 | 8.4 | 4.9 |
| Accelerations over 2.5 m/s² per 90 | 50 | 289 |
| Metres per minute, ball in play | 147 | 156 |
| Metres per minute, ball dead | 65 | 50 |
| High-speed running plus sprinting (km per 90) | 0.69 | 1.01 |
| Territory: SD over matches of the match-mean ball x, home attacking (m) | 1.9 | 4.5 |
| Outfield centroid minus ball x, team with the ball (m) | +3.9 | -3.0 |
| Outfield centroid minus ball x, team without it (m) | -9.5 | -4.6 |

## Match balance and discipline

From 64 matches.

| Measure | Real | Simulated | Target | Status |
|---|---|---|---|---|
| Team shot share, SD over matches (C3) | 0.090 | 0.223 | ≤ 0.18 | NOT MET |
| Players sent off per match | 0.29 | 0.50 | about 0.2–0.3 | — |
| Penalties per match | 0.43 | 0.28 | — | — |


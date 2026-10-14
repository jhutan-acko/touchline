# Touchline realism report

Generated 2026-10-14 from 16 synthetic matches (calib-2026-10-14; held-out seeds 2000–2015) against real-match targets.

**Real data:** IDSSE / Sportec Open DFL dataset (2022/23 Bundesliga and 2. Bundesliga) — events: 7 matches; tracking: 1 match(es) (J03WPY); spatial: 7 matches. Licence CC-BY-4.0; Deutsche Fussball Liga (DFL); Bassek et al., Scientific Data (2025), doi:10.1038/s41597-025-04505-y. Only aggregate statistics are shown.

## Match statistics

| Statistic | Real (mean ± SD) | Synthetic (mean ± SD) | z | Off by | Verdict |
|---|---|---|---|---|---|
| Passes per match | 866 ± 90 | 973 ± 92 | +1.19 | +12 % | within 2 SD |
| Pass completion | 78.1% ± 3.8% | 68.2% ± 2.4% | -2.53 | -13 % | off |
| Long passes (32 m+), share of completed | 14.3% ± 2.5% | 16.0% ± 6.6% | +0.68 | +12 % | within 1 SD |
| Median completed pass length (m) | 17.1 ± 1.3 | 17.2 ± 3.1 | +0.02 | +0 % | within 1 SD |
| Shots per match | 24.4 ± 2.9 | 23.7 ± 7.3 | -0.25 | -3 % | within 1 SD |
| Shots on target, share | 35.4% ± 7.2% | 36.6% ± 10.5% | +0.17 | +4 % | within 1 SD |
| Shots blocked, share | 22.7% ± 6.1% | 14.4% ± 8.9% | -1.35 | -36 % | within 2 SD |
| Saves, share of shots on target | 66.9% ± 16.8% | 72.0% ± 13.8% | +0.30 | +8 % | within 1 SD |
| Goals per match | 2.71 ± 1.25 | 2.31 ± 1.25 | -0.32 | -15 % | within 1 SD |
| Penalties per match | 0.43 ± 0.53 | 0.19 ± 0.40 | -0.45 | -56 % | within 1 SD |
| Corners | 8.1 ± 4.2 | 8.8 ± 3.4 | +0.16 | +8 % | within 1 SD |
| Throw-ins | 43.6 ± 7.2 | 37.4 ± 7.0 | -0.85 | -14 % | within 1 SD |
| Goal kicks | 17.0 ± 1.6 | 16.2 ± 4.1 | -0.50 | -5 % | within 1 SD |
| Free kicks | 24.0 ± 4.7 | 26.7 ± 6.5 | +0.58 | +11 % | within 1 SD |
| Fouls | 22.9 ± 4.6 | 19.7 ± 4.5 | -0.69 | -14 % | within 1 SD |
| Cards | 5.3 ± 3.4 | 5.5 ± 2.6 | +0.06 | +4 % | within 1 SD |
| Ball in play, share of match time | 55.7% ± 0.0% | 50.3% ± 4.3% | -1.95 | -10 % | within 2 SD |
| Distance per full-match outfielder (km) | 10.88 ± 0.00 | 11.01 ± 0.87 | +0.24 | +1 % | within 1 SD |
| Peak speed per player, median (km/h) | 27.9 ± 0.0 | 27.6 ± 0.5 | -0.28 | -1 % | within 1 SD |
| Team width in possession (m) | 45.9 ± 4.3 | 46.5 ± 2.5 | +0.13 | +1 % | within 1 SD |
| Team width out of possession (m) | 37.0 ± 2.2 | 43.8 ± 1.5 | +3.04 | +18 % | off |
| Defending team length, keeper excluded (m) | 32.2 ± 1.2 | 35.1 ± 1.3 | +1.84 | +9 % | within 2 SD |
| Defensive line height from own goal (m) | 35.1 ± 1.5 | 35.3 ± 2.0 | +0.12 | +1 % | within 1 SD |
| Nearest defender to the ball (m) | 5.1 ± 0.5 | 4.7 ± 0.2 | -0.90 | -9 % | within 1 SD |
| Teammates within 15 m of the ball | 2.10 ± 0.14 | 1.94 ± 0.21 | -1.15 | -7 % | within 2 SD |
| Off-ball attacker to nearest defender (m) | 6.0 ± 0.5 | 6.8 ± 2.0 | +1.57 | +12 % | within 2 SD |

Summary: 18 within 1 SD, 6 within 2 SD, 2 off. z uses the real between-match SD, floored at 5 % of the mean (tracking targets come from one match).

More than 30 % from the real mean: Shots blocked, share (-36 %), Penalties per match (-56 %).

## Distributions

| Distribution | Wasserstein-1 | Jensen–Shannon (bits) |
|---|---|---|
| Completed pass length | 1.94 m | 0.0258 |
| Player speed | 0.68 m/s | 0.1153 |

Lower is closer. W1 is in the distribution's own unit; JS divergence is 0 for identical and 1 for disjoint distributions.

## Player movement against real tracking

Each statistic is a distribution; it is inside when its distance (W1) to the real matches is no larger than the largest distance between two real matches (data/params/physics.json).

| Statistic | W1 to real | Largest real-to-real | Inside |
|---|---|---|---|
| Speed, keepers (m/s) | 0.465 | 0.167 | no |
| Speed, defenders (m/s) | 0.772 | 0.230 | no |
| Speed, midfielders (m/s) | 0.838 | 0.201 | no |
| Speed, forwards (m/s) | 0.801 | 0.297 | no |
| Change of speed, keepers (m/s²) | 0.278 | 0.065 | no |
| Change of speed, defenders (m/s²) | 1.093 | 0.080 | no |
| Change of speed, midfielders (m/s²) | 1.063 | 0.080 | no |
| Change of speed, forwards (m/s²) | 1.067 | 0.074 | no |
| Top speed per player (m/s) | 0.246 | 0.460 | yes |
| Metres above 20 km/h per 90 minutes | 624.510 | 173.148 | no |
| Metres above 25 km/h per 90 minutes | 346.626 | 51.052 | no |
| Accelerations past 3 m/s² per 90 minutes | 99.078 | 28.864 | no |
| Decelerations past 3 m/s² per 90 minutes | 71.436 | 30.909 | no |

Inside the real envelope: 1 of 13.

### Work rate by 15-minute period

Outfielders on the pitch for the whole match, metres per minute.

| Minutes | Real | Simulated | Real above 20 km/h | Simulated above 20 km/h |
|---|---|---|---|---|
| 0–15 | 121.8 | 124.2 | 8.5 | 38.7 |
| 15–30 | 120.5 | 111.1 | 9.2 | 35.1 |
| 30–45 | 114.3 | 110.8 | 8.7 | 34.8 |
| 45–60 | 113.2 | 121.2 | 7.9 | 38.1 |
| 60–75 | 102.3 | 113.1 | 6.9 | 34.0 |
| 75–90 | 99.4 | 123.8 | 6.5 | 38.9 |

Last 15 minutes of a half over its first 15 (late-to-early ratio): distance 0.96 simulated (real 0.84–0.99, mean 0.91); above 20 km/h 0.96 simulated (real 0.69–1.22, mean 0.95).

## Frozen ball carriers

Stretches of 1.5 s or more with the ball in play where the ball and the player nearest it both stand still (touchline_analytics.carriers; real values from the seven IDSSE matches).

| Players | Simulated per match | Most in a simulated match | Real per match | Simulated seconds per match | Real seconds per match |
|---|---|---|---|---|---|
| Outfielders | 0.0 | 0 | 0–1 (mean 0.1) | 0.0 | 0.0–2.5 |
| Keepers | 0.6 | 2 | 0–5 (mean 2.7) | 1.6 | 0.0–15.8 |

## Match balance and discipline

From 16 matches. These are rare or noisy measures: judge them on 64 or more (`pnpm realism:deep`); this report has fewer than 64 matches.

| Measure | Real | Simulated | Target | Status |
|---|---|---|---|---|
| Team shot share, SD over matches (C3) | 0.090 | 0.424 | ≤ 0.18 | NOT MET |
| Players sent off per match | 0.29 | 0.25 | about 0.2–0.3 | — |
| Penalties per match | 0.43 | 0.19 | — | — |


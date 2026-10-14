# Touchline realism report

Generated 2026-10-14 from 16 synthetic matches (calib-2026-10-13; held-out seeds 2000–2015) against real-match targets.

**Real data:** IDSSE / Sportec Open DFL dataset (2022/23 Bundesliga and 2. Bundesliga) — events: 7 matches; tracking: 1 match(es) (J03WPY); spatial: 7 matches. Licence CC-BY-4.0; Deutsche Fussball Liga (DFL); Bassek et al., Scientific Data (2025), doi:10.1038/s41597-025-04505-y. Only aggregate statistics are shown.

## Match statistics

| Statistic | Real (mean ± SD) | Synthetic (mean ± SD) | z | Off by | Verdict |
|---|---|---|---|---|---|
| Passes per match | 866 ± 90 | 1033 ± 92 | +1.85 | +19 % | within 2 SD |
| Pass completion | 78.1% ± 3.8% | 69.7% ± 2.0% | -2.15 | -11 % | off |
| Long passes (32 m+), share of completed | 14.3% ± 2.5% | 13.8% ± 4.8% | -0.20 | -3 % | within 1 SD |
| Median completed pass length (m) | 17.1 ± 1.3 | 16.0 ± 2.3 | -0.93 | -7 % | within 1 SD |
| Shots per match | 24.4 ± 2.9 | 25.8 ± 7.1 | +0.45 | +5 % | within 1 SD |
| Shots on target, share | 35.4% ± 7.2% | 33.4% ± 9.7% | -0.28 | -6 % | within 1 SD |
| Shots blocked, share | 22.7% ± 6.1% | 17.8% ± 7.7% | -0.80 | -21 % | within 1 SD |
| Saves, share of shots on target | 66.9% ± 16.8% | 76.9% ± 19.5% | +0.59 | +15 % | within 1 SD |
| Goals per match | 2.71 ± 1.25 | 1.94 ± 1.69 | -0.62 | -29 % | within 1 SD |
| Penalties per match | 0.43 ± 0.53 | 0.31 ± 0.60 | -0.22 | -27 % | within 1 SD |
| Corners | 8.1 ± 4.2 | 8.6 ± 4.3 | +0.10 | +5 % | within 1 SD |
| Throw-ins | 43.6 ± 7.2 | 33.8 ± 4.4 | -1.36 | -22 % | within 2 SD |
| Goal kicks | 17.0 ± 1.6 | 16.6 ± 5.2 | -0.27 | -3 % | within 1 SD |
| Free kicks | 24.0 ± 4.7 | 26.2 ± 7.0 | +0.47 | +9 % | within 1 SD |
| Fouls | 22.9 ± 4.6 | 18.4 ± 4.5 | -0.97 | -20 % | within 1 SD |
| Cards | 5.3 ± 3.4 | 4.1 ± 2.2 | -0.34 | -22 % | within 1 SD |
| Ball in play, share of match time | 55.7% ± 0.0% | 52.6% ± 4.4% | -1.11 | -6 % | within 2 SD |
| Distance per full-match outfielder (km) | 10.88 ± 0.00 | 11.44 ± 0.91 | +1.02 | +5 % | within 2 SD |
| Peak speed per player, median (km/h) | 27.9 ± 0.0 | 27.9 ± 0.7 | -0.07 | -0 % | within 1 SD |
| Team width in possession (m) | 45.9 ± 4.3 | 46.5 ± 2.4 | +0.14 | +1 % | within 1 SD |
| Team width out of possession (m) | 37.0 ± 2.2 | 43.8 ± 1.5 | +3.06 | +18 % | off |
| Defending team length, keeper excluded (m) | 32.2 ± 1.2 | 35.1 ± 1.2 | +1.84 | +9 % | within 2 SD |
| Defensive line height from own goal (m) | 35.1 ± 1.5 | 35.3 ± 1.6 | +0.09 | +0 % | within 1 SD |
| Nearest defender to the ball (m) | 5.1 ± 0.5 | 4.6 ± 0.2 | -1.00 | -10 % | within 2 SD |
| Teammates within 15 m of the ball | 2.10 ± 0.14 | 1.98 ± 0.19 | -0.86 | -6 % | within 1 SD |
| Off-ball attacker to nearest defender (m) | 6.0 ± 0.5 | 6.7 ± 1.9 | +1.34 | +11 % | within 2 SD |

Summary: 17 within 1 SD, 7 within 2 SD, 2 off. z uses the real between-match SD, floored at 5 % of the mean (tracking targets come from one match).

Every statistic is within 30 % of the real mean.

## Distributions

| Distribution | Wasserstein-1 | Jensen–Shannon (bits) |
|---|---|---|
| Completed pass length | 2.03 m | 0.0243 |
| Player speed | 0.69 m/s | 0.1106 |

Lower is closer. W1 is in the distribution's own unit; JS divergence is 0 for identical and 1 for disjoint distributions.

## Player movement against real tracking

Each statistic is a distribution; it is inside when its distance (W1) to the real matches is no larger than the largest distance between two real matches (data/params/physics.json).

| Statistic | W1 to real | Largest real-to-real | Inside |
|---|---|---|---|
| Speed, keepers (m/s) | 0.463 | 0.167 | no |
| Speed, defenders (m/s) | 0.772 | 0.230 | no |
| Speed, midfielders (m/s) | 0.841 | 0.201 | no |
| Speed, forwards (m/s) | 0.806 | 0.297 | no |
| Change of speed, keepers (m/s²) | 0.279 | 0.065 | no |
| Change of speed, defenders (m/s²) | 1.133 | 0.080 | no |
| Change of speed, midfielders (m/s²) | 1.102 | 0.080 | no |
| Change of speed, forwards (m/s²) | 1.111 | 0.074 | no |
| Top speed per player (m/s) | 0.221 | 0.460 | yes |
| Metres above 20 km/h per 90 minutes | 626.375 | 173.148 | no |
| Metres above 25 km/h per 90 minutes | 350.099 | 51.052 | no |
| Accelerations past 3 m/s² per 90 minutes | 99.078 | 28.864 | no |
| Decelerations past 3 m/s² per 90 minutes | 71.048 | 30.909 | no |

Inside the real envelope: 1 of 13.

### Work rate by 15-minute period

Outfielders on the pitch for the whole match, metres per minute.

| Minutes | Real | Simulated | Real above 20 km/h | Simulated above 20 km/h |
|---|---|---|---|---|
| 0–15 | 121.8 | 123.3 | 8.5 | 38.7 |
| 15–30 | 120.5 | 119.1 | 9.2 | 37.0 |
| 30–45 | 114.3 | 120.2 | 8.7 | 36.7 |
| 45–60 | 113.2 | 122.3 | 7.9 | 38.9 |
| 60–75 | 102.3 | 117.9 | 6.9 | 35.8 |
| 75–90 | 99.4 | 116.8 | 6.5 | 36.4 |

Last 15 minutes of a half over its first 15 (late-to-early ratio): distance 0.97 simulated (real 0.84–0.99, mean 0.91); above 20 km/h 0.94 simulated (real 0.69–1.22, mean 0.95).

## Frozen ball carriers

Stretches of 1.5 s or more with the ball in play where the ball and the player nearest it both stand still (touchline_analytics.carriers; real values from the seven IDSSE matches).

| Players | Simulated per match | Most in a simulated match | Real per match | Simulated seconds per match | Real seconds per match |
|---|---|---|---|---|---|
| Outfielders | 0.0 | 0 | 0–1 (mean 0.1) | 0.0 | 0.0–2.5 |
| Keepers | 3.1 | 8 | 0–5 (mean 2.7) | 9.7 | 0.0–15.8 |

## Match balance and discipline

From 16 matches. These are rare or noisy measures: judge them on 64 or more (`pnpm realism:deep`); this report has fewer than 64 matches.

| Measure | Real | Simulated | Target | Status |
|---|---|---|---|---|
| Team shot share, SD over matches (C3) | 0.090 | 0.383 | ≤ 0.18 | NOT MET |
| Players sent off per match | 0.29 | 0.25 | about 0.2–0.3 | — |
| Penalties per match | 0.43 | 0.31 | — | — |


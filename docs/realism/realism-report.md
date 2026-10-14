# Touchline realism report

Generated 2026-10-14 from 16 synthetic matches (calib-2026-10-13; held-out seeds 2000–2015) against real-match targets.

**Real data:** IDSSE / Sportec Open DFL dataset (2022/23 Bundesliga and 2. Bundesliga) — events: 7 matches; tracking: 1 match(es) (J03WPY); spatial: 7 matches. Licence CC-BY-4.0; Deutsche Fussball Liga (DFL); Bassek et al., Scientific Data (2025), doi:10.1038/s41597-025-04505-y. Only aggregate statistics are shown.

## Match statistics

| Statistic | Real (mean ± SD) | Synthetic (mean ± SD) | z | Off by | Verdict |
|---|---|---|---|---|---|
| Passes per match | 866 ± 90 | 1009 ± 76 | +1.58 | +16 % | within 2 SD |
| Pass completion | 78.1% ± 3.8% | 69.5% ± 2.2% | -2.21 | -11 % | off |
| Long passes (32 m+), share of completed | 14.3% ± 2.5% | 13.8% ± 4.0% | -0.20 | -4 % | within 1 SD |
| Median completed pass length (m) | 17.1 ± 1.3 | 16.0 ± 2.0 | -0.91 | -7 % | within 1 SD |
| Shots per match | 24.4 ± 2.9 | 27.7 ± 8.7 | +1.11 | +13 % | within 2 SD |
| Shots on target, share | 35.4% ± 7.2% | 33.6% ± 10.4% | -0.25 | -5 % | within 1 SD |
| Shots blocked, share | 22.7% ± 6.1% | 19.2% ± 7.9% | -0.57 | -15 % | within 1 SD |
| Saves, share of shots on target | 66.9% ± 16.8% | 76.9% ± 13.3% | +0.59 | +15 % | within 1 SD |
| Goals per match | 2.71 ± 1.25 | 2.06 ± 1.24 | -0.52 | -24 % | within 1 SD |
| Penalties per match | 0.43 ± 0.53 | 0.50 ± 0.82 | +0.13 | +17 % | within 1 SD |
| Corners | 8.1 ± 4.2 | 9.1 ± 4.0 | +0.22 | +11 % | within 1 SD |
| Throw-ins | 43.6 ± 7.2 | 35.5 ± 6.5 | -1.12 | -19 % | within 2 SD |
| Goal kicks | 17.0 ± 1.6 | 17.2 ± 5.0 | +0.11 | +1 % | within 1 SD |
| Free kicks | 24.0 ± 4.7 | 25.8 ± 8.7 | +0.38 | +7 % | within 1 SD |
| Fouls | 22.9 ± 4.6 | 17.2 ± 5.2 | -1.23 | -25 % | within 2 SD |
| Cards | 5.3 ± 3.4 | 3.7 ± 1.9 | -0.47 | -30 % | within 1 SD |
| Ball in play, share of match time | 55.7% ± 0.0% | 51.3% ± 4.2% | -1.60 | -8 % | within 2 SD |
| Distance per full-match outfielder (km) | 10.88 ± 0.00 | 11.26 ± 0.93 | +0.69 | +3 % | within 1 SD |
| Peak speed per player, median (km/h) | 27.9 ± 0.0 | 27.6 ± 0.6 | -0.21 | -1 % | within 1 SD |
| Team width in possession (m) | 45.9 ± 4.3 | 46.6 ± 2.2 | +0.17 | +2 % | within 1 SD |
| Team width out of possession (m) | 37.0 ± 2.2 | 43.7 ± 1.6 | +3.03 | +18 % | off |
| Defending team length, keeper excluded (m) | 32.2 ± 1.2 | 35.0 ± 1.3 | +1.77 | +9 % | within 2 SD |
| Defensive line height from own goal (m) | 35.1 ± 1.5 | 34.9 ± 1.9 | -0.12 | -1 % | within 1 SD |
| Nearest defender to the ball (m) | 5.1 ± 0.5 | 4.7 ± 0.2 | -0.88 | -9 % | within 1 SD |
| Teammates within 15 m of the ball | 2.10 ± 0.14 | 1.98 ± 0.20 | -0.89 | -6 % | within 1 SD |
| Off-ball attacker to nearest defender (m) | 6.0 ± 0.5 | 6.7 ± 2.0 | +1.38 | +11 % | within 2 SD |

Summary: 17 within 1 SD, 7 within 2 SD, 2 off. z uses the real between-match SD, floored at 5 % of the mean (tracking targets come from one match).

More than 30 % from the real mean: Cards (-30 %).

## Distributions

| Distribution | Wasserstein-1 | Jensen–Shannon (bits) |
|---|---|---|
| Completed pass length | 2.02 m | 0.0243 |
| Player speed | 0.68 m/s | 0.1129 |

Lower is closer. W1 is in the distribution's own unit; JS divergence is 0 for identical and 1 for disjoint distributions.

## Player movement against real tracking

Each statistic is a distribution; it is inside when its distance (W1) to the real matches is no larger than the largest distance between two real matches (data/params/physics.json).

| Statistic | W1 to real | Largest real-to-real | Inside |
|---|---|---|---|
| Speed, keepers (m/s) | 0.466 | 0.167 | no |
| Speed, defenders (m/s) | 0.769 | 0.230 | no |
| Speed, midfielders (m/s) | 0.829 | 0.201 | no |
| Speed, forwards (m/s) | 0.803 | 0.297 | no |
| Change of speed, keepers (m/s²) | 0.281 | 0.065 | no |
| Change of speed, defenders (m/s²) | 1.108 | 0.080 | no |
| Change of speed, midfielders (m/s²) | 1.076 | 0.080 | no |
| Change of speed, forwards (m/s²) | 1.097 | 0.074 | no |
| Top speed per player (m/s) | 0.216 | 0.460 | yes |
| Metres above 20 km/h per 90 minutes | 627.505 | 173.148 | no |
| Metres above 25 km/h per 90 minutes | 350.108 | 51.052 | no |
| Accelerations past 3 m/s² per 90 minutes | 99.078 | 28.864 | no |
| Decelerations past 3 m/s² per 90 minutes | 71.282 | 30.909 | no |

Inside the real envelope: 1 of 13.

### Work rate by 15-minute period

Outfielders on the pitch for the whole match, metres per minute.

| Minutes | Real | Simulated | Real above 20 km/h | Simulated above 20 km/h |
|---|---|---|---|---|
| 0–15 | 121.8 | 125.7 | 8.5 | 39.6 |
| 15–30 | 120.5 | 121.3 | 9.2 | 37.7 |
| 30–45 | 114.3 | 113.9 | 8.7 | 35.6 |
| 45–60 | 113.2 | 120.5 | 7.9 | 37.1 |
| 60–75 | 102.3 | 116.0 | 6.9 | 36.0 |
| 75–90 | 99.4 | 115.5 | 6.5 | 35.7 |

Last 15 minutes of a half over its first 15 (late-to-early ratio): distance 0.93 simulated (real 0.84–0.99, mean 0.91); above 20 km/h 0.93 simulated (real 0.69–1.22, mean 0.95).

## Frozen ball carriers

Stretches of 1.5 s or more with the ball in play where the ball and the player nearest it both stand still (touchline_analytics.carriers; real values from the seven IDSSE matches).

| Players | Simulated per match | Most in a simulated match | Real per match | Simulated seconds per match | Real seconds per match |
|---|---|---|---|---|---|
| Outfielders | 0.0 | 0 | 0–1 (mean 0.1) | 0.0 | 0.0–2.5 |
| Keepers | 1.4 | 4 | 0–5 (mean 2.7) | 4.3 | 0.0–15.8 |

## Match balance and discipline

From 16 matches. These are rare or noisy measures: judge them on 64 or more (`pnpm realism:deep`); this report has fewer than 64 matches.

| Measure | Real | Simulated | Target | Status |
|---|---|---|---|---|
| Team shot share, SD over matches (C3) | 0.090 | 0.400 | ≤ 0.18 | NOT MET |
| Players sent off per match | 0.29 | 0.12 | about 0.2–0.3 | — |
| Penalties per match | 0.43 | 0.50 | — | — |


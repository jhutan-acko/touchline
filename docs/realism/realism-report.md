# Touchline realism report

Generated 2026-10-10 from 16 synthetic matches (calib-2026-10-08; held-out seeds 2000–2015) against real-match targets.

**Real data:** IDSSE / Sportec Open DFL dataset (2022/23 Bundesliga and 2. Bundesliga) — events: 7 matches; tracking: 1 match(es) (J03WPY); spatial: 7 matches. Licence CC-BY-4.0; Deutsche Fussball Liga (DFL); Bassek et al., Scientific Data (2025), doi:10.1038/s41597-025-04505-y. Only aggregate statistics are shown.

## Match statistics

| Statistic | Real (mean ± SD) | Synthetic (mean ± SD) | z | Off by | Verdict |
|---|---|---|---|---|---|
| Passes per match | 866 ± 90 | 995 ± 83 | +1.43 | +15 % | within 2 SD |
| Pass completion | 78.1% ± 3.8% | 71.2% ± 2.8% | -1.76 | -9 % | within 2 SD |
| Long passes (32 m+), share of completed | 14.3% ± 2.5% | 13.6% ± 4.1% | -0.27 | -5 % | within 1 SD |
| Median completed pass length (m) | 17.1 ± 1.3 | 15.7 ± 2.1 | -1.13 | -8 % | within 2 SD |
| Shots per match | 24.4 ± 2.9 | 22.8 ± 7.5 | -0.57 | -7 % | within 1 SD |
| Shots on target, share | 35.4% ± 7.2% | 26.9% ± 12.7% | -1.17 | -24 % | within 2 SD |
| Shots blocked, share | 22.7% ± 6.1% | 17.3% ± 8.1% | -0.89 | -24 % | within 1 SD |
| Saves, share of shots on target | 66.9% ± 16.8% | 64.6% ± 16.2% | -0.14 | -4 % | within 1 SD |
| Goals per match | 2.71 ± 1.25 | 2.19 ± 1.38 | -0.42 | -19 % | within 1 SD |
| Penalties per match | 0.43 ± 0.53 | 0.69 ± 0.70 | +0.48 | +60 % | within 1 SD |
| Corners | 8.1 ± 4.2 | 7.3 ± 4.0 | -0.20 | -10 % | within 1 SD |
| Throw-ins | 43.6 ± 7.2 | 31.8 ± 7.7 | -1.64 | -27 % | within 2 SD |
| Goal kicks | 17.0 ± 1.6 | 17.7 ± 5.0 | +0.42 | +4 % | within 1 SD |
| Free kicks | 24.0 ± 4.7 | 29.8 ± 8.3 | +1.25 | +24 % | within 2 SD |
| Fouls | 22.9 ± 4.6 | 23.1 ± 5.5 | +0.04 | +1 % | within 1 SD |
| Cards | 5.3 ± 3.4 | 8.4 ± 2.6 | +0.93 | +60 % | within 1 SD |
| Ball in play, share of match time | 55.7% ± 0.0% | 51.1% ± 3.9% | -1.65 | -8 % | within 2 SD |
| Distance per full-match outfielder (km) | 10.88 ± 0.00 | 10.99 ± 0.86 | +0.21 | +1 % | within 1 SD |
| Peak speed per player, median (km/h) | 27.9 ± 0.0 | 29.0 ± 0.8 | +0.78 | +4 % | within 1 SD |
| Team width in possession (m) | 45.9 ± 4.3 | 46.3 ± 2.7 | +0.08 | +1 % | within 1 SD |
| Team width out of possession (m) | 37.0 ± 2.2 | 43.7 ± 1.5 | +3.04 | +18 % | off |
| Defending team length, keeper excluded (m) | 32.2 ± 1.2 | 37.2 ± 0.8 | +3.12 | +16 % | off |
| Defensive line height from own goal (m) | 35.1 ± 1.5 | 36.0 ± 1.6 | +0.49 | +2 % | within 1 SD |
| Nearest defender to the ball (m) | 5.1 ± 0.5 | 4.9 ± 0.3 | -0.48 | -5 % | within 1 SD |
| Teammates within 15 m of the ball | 2.10 ± 0.14 | 1.90 ± 0.17 | -1.44 | -9 % | within 2 SD |
| Off-ball attacker to nearest defender (m) | 6.0 ± 0.5 | 6.7 ± 1.7 | +1.33 | +10 % | within 2 SD |

Summary: 15 within 1 SD, 9 within 2 SD, 2 off. z uses the real between-match SD, floored at 5 % of the mean (tracking targets come from one match).

More than 30 % from the real mean: Penalties per match (+60 %), Cards (+60 %).

## Distributions

| Distribution | Wasserstein-1 | Jensen–Shannon (bits) |
|---|---|---|
| Completed pass length | 2.14 m | 0.0270 |
| Player speed | 0.68 m/s | 0.1212 |

Lower is closer. W1 is in the distribution's own unit; JS divergence is 0 for identical and 1 for disjoint distributions.

## Player movement against real tracking

Each statistic is a distribution; it is inside when its distance (W1) to the real matches is no larger than the largest distance between two real matches (data/params/physics.json).

| Statistic | W1 to real | Largest real-to-real | Inside |
|---|---|---|---|
| Speed, keepers (m/s) | 0.478 | 0.167 | no |
| Speed, defenders (m/s) | 0.768 | 0.230 | no |
| Speed, midfielders (m/s) | 0.844 | 0.201 | no |
| Speed, forwards (m/s) | 0.824 | 0.297 | no |
| Change of speed, keepers (m/s²) | 0.291 | 0.065 | no |
| Change of speed, defenders (m/s²) | 1.146 | 0.080 | no |
| Change of speed, midfielders (m/s²) | 1.121 | 0.080 | no |
| Change of speed, forwards (m/s²) | 1.131 | 0.074 | no |
| Top speed per player (m/s) | 0.076 | 0.460 | yes |
| Metres above 20 km/h per 90 minutes | 625.512 | 173.148 | no |
| Metres above 25 km/h per 90 minutes | 360.435 | 51.052 | no |
| Accelerations past 3 m/s² per 90 minutes | 99.078 | 28.864 | no |
| Decelerations past 3 m/s² per 90 minutes | 71.480 | 30.909 | no |

Inside the real envelope: 1 of 13.

### Work rate by 15-minute period

Outfielders on the pitch for the whole match, metres per minute.

| Minutes | Real | Simulated | Real above 20 km/h | Simulated above 20 km/h |
|---|---|---|---|---|
| 0–15 | 121.8 | 118.2 | 8.5 | 36.3 |
| 15–30 | 120.5 | 116.6 | 9.2 | 36.8 |
| 30–45 | 114.3 | 112.4 | 8.7 | 35.6 |
| 45–60 | 113.2 | 121.5 | 7.9 | 37.9 |
| 60–75 | 102.3 | 111.2 | 6.9 | 34.4 |
| 75–90 | 99.4 | 116.3 | 6.5 | 36.2 |

Last 15 minutes of a half over its first 15 (late-to-early ratio): distance 0.95 simulated (real 0.84–0.99, mean 0.91); above 20 km/h 0.97 simulated (real 0.69–1.22, mean 0.95).


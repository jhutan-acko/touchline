# Touchline realism report

Generated 2026-10-10 from 10 synthetic matches (calib-2026-10-10; held-out seeds 2000–2009) against real-match targets.

**Real data:** IDSSE / Sportec Open DFL dataset (2022/23 Bundesliga and 2. Bundesliga) — events: 7 matches; tracking: 1 match(es) (J03WPY); spatial: 7 matches. Licence CC-BY-4.0; Deutsche Fussball Liga (DFL); Bassek et al., Scientific Data (2025), doi:10.1038/s41597-025-04505-y. Only aggregate statistics are shown.

## Match statistics

| Statistic | Real (mean ± SD) | Synthetic (mean ± SD) | z | Off by | Verdict |
|---|---|---|---|---|---|
| Passes per match | 866 ± 90 | 1022 ± 85 | +1.73 | +18 % | within 2 SD |
| Pass completion | 78.1% ± 3.8% | 69.6% ± 2.7% | -2.18 | -11 % | off |
| Long passes (32 m+), share of completed | 14.3% ± 2.5% | 14.4% ± 5.0% | +0.04 | +1 % | within 1 SD |
| Median completed pass length (m) | 17.1 ± 1.3 | 15.9 ± 2.3 | -0.96 | -7 % | within 1 SD |
| Shots per match | 24.4 ± 2.9 | 26.4 ± 5.8 | +0.67 | +8 % | within 1 SD |
| Shots on target, share | 35.4% ± 7.2% | 34.8% ± 8.6% | -0.08 | -2 % | within 1 SD |
| Shots blocked, share | 22.7% ± 6.1% | 11.7% ± 6.6% | -1.79 | -48 % | within 2 SD |
| Saves, share of shots on target | 66.9% ± 16.8% | 72.6% ± 18.7% | +0.34 | +8 % | within 1 SD |
| Goals per match | 2.71 ± 1.25 | 2.80 ± 2.10 | +0.07 | +3 % | within 1 SD |
| Penalties per match | 0.43 ± 0.53 | 0.80 ± 0.92 | +0.69 | +87 % | within 1 SD |
| Corners | 8.1 ± 4.2 | 6.4 ± 2.4 | -0.41 | -21 % | within 1 SD |
| Throw-ins | 43.6 ± 7.2 | 31.4 ± 5.5 | -1.69 | -28 % | within 2 SD |
| Goal kicks | 17.0 ± 1.6 | 18.6 ± 3.7 | +0.98 | +9 % | within 1 SD |
| Free kicks | 24.0 ± 4.7 | 25.6 ± 6.4 | +0.34 | +7 % | within 1 SD |
| Fouls | 22.9 ± 4.6 | 16.9 ± 2.8 | -1.30 | -26 % | within 2 SD |
| Cards | 5.3 ± 3.4 | 6.2 ± 1.8 | +0.27 | +17 % | within 1 SD |
| Ball in play, share of match time | 55.7% ± 0.0% | 52.7% ± 3.5% | -1.09 | -5 % | within 2 SD |
| Distance per full-match outfielder (km) | 10.88 ± 0.00 | 11.46 ± 0.84 | +1.06 | +5 % | within 2 SD |
| Peak speed per player, median (km/h) | 27.9 ± 0.0 | 27.8 ± 0.6 | -0.12 | -1 % | within 1 SD |
| Team width in possession (m) | 45.9 ± 4.3 | 46.3 ± 2.9 | +0.09 | +1 % | within 1 SD |
| Team width out of possession (m) | 37.0 ± 2.2 | 43.7 ± 1.7 | +3.02 | +18 % | off |
| Defending team length, keeper excluded (m) | 32.2 ± 1.2 | 37.5 ± 0.8 | +3.32 | +17 % | off |
| Defensive line height from own goal (m) | 35.1 ± 1.5 | 35.7 ± 2.0 | +0.32 | +2 % | within 1 SD |
| Nearest defender to the ball (m) | 5.1 ± 0.5 | 4.8 ± 0.2 | -0.71 | -7 % | within 1 SD |
| Teammates within 15 m of the ball | 2.10 ± 0.14 | 1.92 ± 0.15 | -1.33 | -9 % | within 2 SD |
| Off-ball attacker to nearest defender (m) | 6.0 ± 0.5 | 6.1 ± 1.5 | +0.11 | +1 % | within 1 SD |

Summary: 16 within 1 SD, 7 within 2 SD, 3 off. z uses the real between-match SD, floored at 5 % of the mean (tracking targets come from one match).

More than 30 % from the real mean: Shots blocked, share (-48 %), Penalties per match (+87 %).

## Distributions

| Distribution | Wasserstein-1 | Jensen–Shannon (bits) |
|---|---|---|
| Completed pass length | 2.01 m | 0.0259 |
| Player speed | 0.69 m/s | 0.1111 |

Lower is closer. W1 is in the distribution's own unit; JS divergence is 0 for identical and 1 for disjoint distributions.

## Player movement against real tracking

Each statistic is a distribution; it is inside when its distance (W1) to the real matches is no larger than the largest distance between two real matches (data/params/physics.json).

| Statistic | W1 to real | Largest real-to-real | Inside |
|---|---|---|---|
| Speed, keepers (m/s) | 0.461 | 0.167 | no |
| Speed, defenders (m/s) | 0.774 | 0.230 | no |
| Speed, midfielders (m/s) | 0.840 | 0.201 | no |
| Speed, forwards (m/s) | 0.828 | 0.297 | no |
| Change of speed, keepers (m/s²) | 0.283 | 0.065 | no |
| Change of speed, defenders (m/s²) | 1.142 | 0.080 | no |
| Change of speed, midfielders (m/s²) | 1.111 | 0.080 | no |
| Change of speed, forwards (m/s²) | 1.121 | 0.074 | no |
| Top speed per player (m/s) | 0.219 | 0.460 | yes |
| Metres above 20 km/h per 90 minutes | 628.390 | 173.148 | no |
| Metres above 25 km/h per 90 minutes | 348.497 | 51.052 | no |
| Accelerations past 3 m/s² per 90 minutes | 99.078 | 28.864 | no |
| Decelerations past 3 m/s² per 90 minutes | 71.592 | 30.909 | no |

Inside the real envelope: 1 of 13.

### Work rate by 15-minute period

Outfielders on the pitch for the whole match, metres per minute.

| Minutes | Real | Simulated | Real above 20 km/h | Simulated above 20 km/h |
|---|---|---|---|---|
| 0–15 | 121.8 | 119.3 | 8.5 | 37.9 |
| 15–30 | 120.5 | 123.1 | 9.2 | 38.1 |
| 30–45 | 114.3 | 127.2 | 8.7 | 37.9 |
| 45–60 | 113.2 | 123.1 | 7.9 | 37.9 |
| 60–75 | 102.3 | 118.4 | 6.9 | 36.6 |
| 75–90 | 99.4 | 119.5 | 6.5 | 37.5 |

Last 15 minutes of a half over its first 15 (late-to-early ratio): distance 1.02 simulated (real 0.84–0.99, mean 0.91); above 20 km/h 1.00 simulated (real 0.69–1.22, mean 0.95).

## Frozen ball carriers

Stretches of 1.5 s or more with the ball in play where the ball and the player nearest it both stand still (touchline_analytics.carriers; real values from the seven IDSSE matches).

| Players | Simulated per match | Most in a simulated match | Real per match | Simulated seconds per match | Real seconds per match |
|---|---|---|---|---|---|
| Outfielders | 0.3 | 2 | 0–1 (mean 0.1) | 0.7 | 0.0–2.5 |
| Keepers | 0.9 | 2 | 0–5 (mean 2.7) | 2.3 | 0.0–15.8 |


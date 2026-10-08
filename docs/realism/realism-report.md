# Touchline realism report

Generated 2026-10-08 from 16 synthetic matches (calib-2026-10-07; held-out seeds 2000–2015) against real-match targets.

**Real data:** IDSSE / Sportec Open DFL dataset (2022/23 Bundesliga and 2. Bundesliga) — events: 7 matches; tracking: 1 match(es) (J03WPY); spatial: 7 matches. Licence CC-BY-4.0; Deutsche Fussball Liga (DFL); Bassek et al., Scientific Data (2025), doi:10.1038/s41597-025-04505-y. Only aggregate statistics are shown.

## Match statistics

| Statistic | Real (mean ± SD) | Synthetic (mean ± SD) | z | Off by | Verdict |
|---|---|---|---|---|---|
| Passes per match | 866 ± 90 | 946 ± 61 | +0.89 | +9 % | within 1 SD |
| Pass completion | 78.1% ± 3.8% | 69.0% ± 2.1% | -2.32 | -12 % | off |
| Long passes (32 m+), share of completed | 14.3% ± 2.5% | 11.3% ± 3.4% | -1.18 | -21 % | within 2 SD |
| Median completed pass length (m) | 17.1 ± 1.3 | 14.5 ± 1.8 | -2.07 | -15 % | off |
| Shots per match | 24.4 ± 2.9 | 21.9 ± 6.0 | -0.87 | -10 % | within 1 SD |
| Shots on target, share | 35.4% ± 7.2% | 30.5% ± 10.1% | -0.68 | -14 % | within 1 SD |
| Shots blocked, share | 22.7% ± 6.1% | 18.2% ± 7.9% | -0.73 | -20 % | within 1 SD |
| Saves, share of shots on target | 66.9% ± 16.8% | 58.3% ± 21.1% | -0.51 | -13 % | within 1 SD |
| Goals per match | 2.71 ± 1.25 | 2.62 ± 1.36 | -0.07 | -3 % | within 1 SD |
| Penalties per match | 0.43 ± 0.53 | 0.31 ± 0.79 | -0.22 | -27 % | within 1 SD |
| Corners | 8.1 ± 4.2 | 7.6 ± 2.4 | -0.12 | -6 % | within 1 SD |
| Throw-ins | 43.6 ± 7.2 | 36.1 ± 8.3 | -1.04 | -17 % | within 2 SD |
| Goal kicks | 17.0 ± 1.6 | 15.4 ± 4.5 | -0.96 | -9 % | within 1 SD |
| Free kicks | 24.0 ± 4.7 | 26.8 ± 7.5 | +0.60 | +12 % | within 1 SD |
| Fouls | 22.9 ± 4.6 | 19.6 ± 4.7 | -0.70 | -14 % | within 1 SD |
| Cards | 5.3 ± 3.4 | 7.3 ± 2.7 | +0.60 | +38 % | within 1 SD |
| Ball in play, share of match time | 55.7% ± 0.0% | 51.8% ± 2.9% | -1.40 | -7 % | within 2 SD |
| Distance per full-match outfielder (km) | 10.88 ± 0.00 | 10.73 ± 0.64 | -0.28 | -1 % | within 1 SD |
| Peak speed per player, median (km/h) | 27.9 ± 0.0 | 28.3 ± 0.2 | +0.22 | +1 % | within 1 SD |
| Team width in possession (m) | 45.9 ± 4.3 | 46.6 ± 2.4 | +0.15 | +1 % | within 1 SD |
| Team width out of possession (m) | 37.0 ± 2.2 | 43.7 ± 1.5 | +3.00 | +18 % | off |
| Defending team length, keeper excluded (m) | 32.2 ± 1.2 | 37.6 ± 0.5 | +3.39 | +17 % | off |
| Defensive line height from own goal (m) | 35.1 ± 1.5 | 36.5 ± 1.7 | +0.81 | +4 % | within 1 SD |
| Nearest defender to the ball (m) | 5.1 ± 0.5 | 5.2 ± 0.3 | +0.17 | +2 % | within 1 SD |
| Teammates within 15 m of the ball | 2.10 ± 0.14 | 1.96 ± 0.21 | -1.03 | -7 % | within 2 SD |
| Off-ball attacker to nearest defender (m) | 6.0 ± 0.5 | 6.8 ± 1.1 | +1.66 | +13 % | within 2 SD |

Summary: 17 within 1 SD, 5 within 2 SD, 4 off. z uses the real between-match SD, floored at 5 % of the mean (tracking targets come from one match).

More than 30 % from the real mean: Cards (+38 %).

## Distributions

| Distribution | Wasserstein-1 | Jensen–Shannon (bits) |
|---|---|---|
| Completed pass length | 3.04 m | 0.0228 |
| Player speed | 0.61 m/s | 0.1081 |

Lower is closer. W1 is in the distribution's own unit; JS divergence is 0 for identical and 1 for disjoint distributions.


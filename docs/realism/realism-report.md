# Touchline realism report

Generated 2026-10-09 from 16 synthetic matches (calib-2026-10-08; held-out seeds 2000–2015) against real-match targets.

**Real data:** IDSSE / Sportec Open DFL dataset (2022/23 Bundesliga and 2. Bundesliga) — events: 7 matches; tracking: 1 match(es) (J03WPY); spatial: 7 matches. Licence CC-BY-4.0; Deutsche Fussball Liga (DFL); Bassek et al., Scientific Data (2025), doi:10.1038/s41597-025-04505-y. Only aggregate statistics are shown.

## Match statistics

| Statistic | Real (mean ± SD) | Synthetic (mean ± SD) | z | Off by | Verdict |
|---|---|---|---|---|---|
| Passes per match | 866 ± 90 | 1002 ± 86 | +1.51 | +16 % | within 2 SD |
| Pass completion | 78.1% ± 3.8% | 69.4% ± 3.0% | -2.22 | -11 % | off |
| Long passes (32 m+), share of completed | 14.3% ± 2.5% | 11.7% ± 3.8% | -1.03 | -18 % | within 2 SD |
| Median completed pass length (m) | 17.1 ± 1.3 | 14.1 ± 1.6 | -2.42 | -18 % | off |
| Shots per match | 24.4 ± 2.9 | 20.2 ± 7.6 | -1.42 | -17 % | within 2 SD |
| Shots on target, share | 35.4% ± 7.2% | 29.2% ± 12.0% | -0.85 | -17 % | within 1 SD |
| Shots blocked, share | 22.7% ± 6.1% | 12.3% ± 9.1% | -1.71 | -46 % | within 2 SD |
| Saves, share of shots on target | 66.9% ± 16.8% | 67.3% ± 22.6% | +0.02 | +1 % | within 1 SD |
| Goals per match | 2.71 ± 1.25 | 1.56 ± 1.09 | -0.92 | -42 % | within 1 SD |
| Penalties per match | 0.43 ± 0.53 | 0.38 ± 0.50 | -0.10 | -13 % | within 1 SD |
| Corners | 8.1 ± 4.2 | 5.7 ± 2.9 | -0.58 | -30 % | within 1 SD |
| Throw-ins | 43.6 ± 7.2 | 34.7 ± 9.0 | -1.24 | -20 % | within 2 SD |
| Goal kicks | 17.0 ± 1.6 | 16.9 ± 3.9 | -0.08 | -1 % | within 1 SD |
| Free kicks | 24.0 ± 4.7 | 29.2 ± 6.6 | +1.11 | +22 % | within 2 SD |
| Fouls | 22.9 ± 4.6 | 20.5 ± 4.2 | -0.51 | -10 % | within 1 SD |
| Cards | 5.3 ± 3.4 | 7.7 ± 2.9 | +0.71 | +45 % | within 1 SD |
| Ball in play, share of match time | 55.7% ± 0.0% | 53.4% ± 4.4% | -0.82 | -4 % | within 1 SD |
| Distance per full-match outfielder (km) | 10.88 ± 0.00 | 11.02 ± 0.82 | +0.26 | +1 % | within 1 SD |
| Peak speed per player, median (km/h) | 27.9 ± 0.0 | 28.2 ± 0.2 | +0.20 | +1 % | within 1 SD |
| Team width in possession (m) | 45.9 ± 4.3 | 46.5 ± 2.5 | +0.14 | +1 % | within 1 SD |
| Team width out of possession (m) | 37.0 ± 2.2 | 43.7 ± 1.6 | +3.02 | +18 % | off |
| Defending team length, keeper excluded (m) | 32.2 ± 1.2 | 37.6 ± 0.7 | +3.41 | +17 % | off |
| Defensive line height from own goal (m) | 35.1 ± 1.5 | 35.5 ± 2.4 | +0.23 | +1 % | within 1 SD |
| Nearest defender to the ball (m) | 5.1 ± 0.5 | 5.1 ± 0.3 | +0.00 | +0 % | within 1 SD |
| Teammates within 15 m of the ball | 2.10 ± 0.14 | 1.96 ± 0.17 | -1.01 | -7 % | within 2 SD |
| Off-ball attacker to nearest defender (m) | 6.0 ± 0.5 | 6.8 ± 1.4 | +1.65 | +13 % | within 2 SD |

Summary: 14 within 1 SD, 8 within 2 SD, 4 off. z uses the real between-match SD, floored at 5 % of the mean (tracking targets come from one match).

More than 30 % from the real mean: Shots blocked, share (-46 %), Goals per match (-42 %), Corners (-30 %), Cards (+45 %).

## Distributions

| Distribution | Wasserstein-1 | Jensen–Shannon (bits) |
|---|---|---|
| Completed pass length | 3.39 m | 0.0339 |
| Player speed | 0.62 m/s | 0.1044 |

Lower is closer. W1 is in the distribution's own unit; JS divergence is 0 for identical and 1 for disjoint distributions.


# Touchline realism report

Generated 2026-10-07 from 16 synthetic matches (calib-2026-10-06; held-out seeds 2000–2015) against real-match targets.

**Real data:** IDSSE / Sportec Open DFL dataset (2022/23 Bundesliga and 2. Bundesliga) — events: 7 matches; tracking: 1 match(es) (J03WPY); spatial: 7 matches. Licence CC-BY-4.0; Deutsche Fussball Liga (DFL); Bassek et al., Scientific Data (2025), doi:10.1038/s41597-025-04505-y. Only aggregate statistics are shown.

## Match statistics

| Statistic | Real (mean ± SD) | Synthetic (mean ± SD) | z | Off by | Verdict |
|---|---|---|---|---|---|
| Passes per match | 866 ± 90 | 934 ± 73 | +0.75 | +8 % | within 1 SD |
| Pass completion | 78.1% ± 3.8% | 75.3% ± 4.4% | -0.71 | -4 % | within 1 SD |
| Long passes (32 m+), share of completed | 14.3% ± 2.5% | 14.2% ± 4.2% | -0.02 | -0 % | within 1 SD |
| Median completed pass length (m) | 17.1 ± 1.3 | 16.9 ± 1.8 | -0.17 | -1 % | within 1 SD |
| Shots per match | 24.4 ± 2.9 | 26.6 ± 9.6 | +0.73 | +9 % | within 1 SD |
| Shots on target, share | 35.4% ± 7.2% | 28.7% ± 10.3% | -0.92 | -19 % | within 1 SD |
| Shots blocked, share | 22.7% ± 6.1% | 20.6% ± 9.8% | -0.33 | -9 % | within 1 SD |
| Saves, share of shots on target | 66.9% ± 16.8% | 71.7% ± 16.3% | +0.28 | +7 % | within 1 SD |
| Goals per match | 2.71 ± 1.25 | 2.12 ± 1.63 | -0.47 | -22 % | within 1 SD |
| Penalties per match | 0.43 ± 0.53 | 0.50 ± 0.63 | +0.13 | +17 % | within 1 SD |
| Corners | 8.1 ± 4.2 | 7.8 ± 3.9 | -0.09 | -5 % | within 1 SD |
| Throw-ins | 43.6 ± 7.2 | 46.2 ± 11.7 | +0.37 | +6 % | within 1 SD |
| Goal kicks | 17.0 ± 1.6 | 15.2 ± 4.5 | -1.11 | -11 % | within 2 SD |
| Free kicks | 24.0 ± 4.7 | 17.1 ± 4.2 | -1.48 | -29 % | within 2 SD |
| Fouls | 22.9 ± 4.6 | 17.8 ± 4.4 | -1.10 | -22 % | within 2 SD |
| Cards | 5.3 ± 3.4 | 5.9 ± 2.1 | +0.17 | +11 % | within 1 SD |
| Ball in play, share of match time | 55.7% ± 0.0% | 53.6% ± 3.1% | -0.77 | -4 % | within 1 SD |
| Distance per full-match outfielder (km) | 10.88 ± 0.00 | 11.05 ± 0.92 | +0.31 | +2 % | within 1 SD |
| Peak speed per player, median (km/h) | 27.9 ± 0.0 | 28.2 ± 0.2 | +0.17 | +1 % | within 1 SD |
| Team width in possession (m) | 45.9 ± 4.3 | 49.8 ± 3.0 | +0.91 | +8 % | within 1 SD |
| Team width out of possession (m) | 37.0 ± 2.2 | 45.1 ± 1.6 | +3.63 | +22 % | off |
| Defending team length, keeper excluded (m) | 32.2 ± 1.2 | 45.3 ± 0.6 | +8.18 | +41 % | off |
| Defensive line height from own goal (m) | 35.1 ± 1.5 | 18.3 ± 2.3 | -9.57 | -48 % | off |
| Nearest defender to the ball (m) | 5.1 ± 0.5 | 7.6 ± 0.6 | +4.95 | +48 % | off |
| Teammates within 15 m of the ball | 2.10 ± 0.14 | 1.43 ± 0.16 | -4.92 | -32 % | off |
| Off-ball attacker to nearest defender (m) | 6.0 ± 0.5 | 13.4 ± 1.5 | +15.58 | +123 % | off |

Summary: 17 within 1 SD, 3 within 2 SD, 6 off. z uses the real between-match SD, floored at 5 % of the mean (tracking targets come from one match).

More than 30 % from the real mean: Defending team length, keeper excluded (m) (+41 %), Defensive line height from own goal (m) (-48 %), Nearest defender to the ball (m) (+48 %), Teammates within 15 m of the ball (-32 %), Off-ball attacker to nearest defender (m) (+123 %).

## Distributions

| Distribution | Wasserstein-1 | Jensen–Shannon (bits) |
|---|---|---|
| Completed pass length | 1.43 m | 0.0183 |
| Player speed | 0.62 m/s | 0.1099 |

Lower is closer. W1 is in the distribution's own unit; JS divergence is 0 for identical and 1 for disjoint distributions.


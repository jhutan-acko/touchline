# Touchline realism report

Generated 2026-10-05 from 16 synthetic matches (calib-2026-10-05; held-out seeds 2000–2015) against real-match targets.

**Real data:** IDSSE / Sportec Open DFL dataset (2022/23 Bundesliga and 2. Bundesliga) — events: 7 matches; tracking: 1 match(es) (J03WPY). Licence CC-BY-4.0; Deutsche Fussball Liga (DFL); Bassek et al., Scientific Data (2025), doi:10.1038/s41597-025-04505-y. Only aggregate statistics are shown.

## Match statistics

| Statistic | Real (mean ± SD) | Synthetic (mean ± SD) | z | Off by | Verdict |
|---|---|---|---|---|---|
| Passes per match | 866 ± 90 | 868 ± 63 | +0.03 | +0 % | within 1 SD |
| Pass completion | 78.1% ± 3.8% | 72.5% ± 5.1% | -1.44 | -7 % | within 2 SD |
| Long passes (32 m+), share of completed | 14.3% ± 2.5% | 14.6% ± 4.1% | +0.13 | +2 % | within 1 SD |
| Median completed pass length (m) | 17.1 ± 1.3 | 16.7 ± 1.3 | -0.33 | -2 % | within 1 SD |
| Shots per match | 24.4 ± 2.9 | 27.7 ± 9.0 | +1.11 | +13 % | within 2 SD |
| Shots on target, share | 35.4% ± 7.2% | 20.4% ± 9.1% | -2.07 | -42 % | off |
| Goals per match | 2.71 ± 1.25 | 2.44 ± 1.31 | -0.22 | -10 % | within 1 SD |
| Penalties per match | 0.43 ± 0.53 | 0.75 ± 0.77 | +0.60 | +75 % | within 1 SD |
| Corners | 8.1 ± 4.2 | 8.4 ± 4.1 | +0.05 | +3 % | within 1 SD |
| Throw-ins | 43.6 ± 7.2 | 37.8 ± 7.5 | -0.81 | -13 % | within 1 SD |
| Goal kicks | 17.0 ± 1.6 | 18.0 ± 3.5 | +0.61 | +6 % | within 1 SD |
| Free kicks | 24.0 ± 4.7 | 18.1 ± 5.1 | -1.26 | -24 % | within 2 SD |
| Fouls | 22.9 ± 4.6 | 19.4 ± 5.1 | -0.74 | -15 % | within 1 SD |
| Cards | 5.3 ± 3.4 | 3.1 ± 1.6 | -0.65 | -42 % | within 1 SD |
| Ball in play, share of match time | 55.7% ± 0.0% | 52.9% ± 4.2% | -1.00 | -5 % | within 1 SD |
| Distance per full-match outfielder (km) | 10.88 ± 0.00 | 10.64 ± 0.93 | -0.44 | -2 % | within 1 SD |
| Peak speed per player, median (km/h) | 27.9 ± 0.0 | 28.2 ± 0.2 | +0.19 | +1 % | within 1 SD |

Summary: 13 within 1 SD, 3 within 2 SD, 1 off. z uses the real between-match SD, floored at 5 % of the mean (tracking targets come from one match).

More than 30 % from the real mean: Shots on target, share (-42 %), Penalties per match (+75 %), Cards (-42 %).

## Distributions

| Distribution | Wasserstein-1 | Jensen–Shannon (bits) |
|---|---|---|
| Completed pass length | 1.56 m | 0.0209 |
| Player speed | 0.60 m/s | 0.1107 |

Lower is closer. W1 is in the distribution's own unit; JS divergence is 0 for identical and 1 for disjoint distributions.


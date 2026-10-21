# Touchline realism report

Generated 2026-10-20 from 16 synthetic matches (calib-2026-10-20; held-out seeds 2000–2015) against real-match targets.

**Real data:** IDSSE / Sportec Open DFL dataset (2022/23 Bundesliga and 2. Bundesliga) — events: 7 matches; tracking: 1 match(es) (J03WPY); spatial: 7 matches. Licence CC-BY-4.0; Deutsche Fussball Liga (DFL); Bassek et al., Scientific Data (2025), doi:10.1038/s41597-025-04505-y. Only aggregate statistics are shown.

## Match statistics

| Statistic | Real (mean ± SD) | Synthetic (mean ± SD) | z | Off by | Verdict |
|---|---|---|---|---|---|
| Passes per match | 866 ± 90 | 939 ± 90 | +0.81 | +8 % | within 1 SD |
| Pass completion | 78.1% ± 3.8% | 68.0% ± 1.7% | -2.58 | -13 % | off |
| Long passes (32 m+), share of completed | 14.3% ± 2.5% | 12.0% ± 1.3% | -0.90 | -16 % | within 1 SD |
| Median completed pass length (m) | 17.1 ± 1.3 | 16.0 ± 0.4 | -0.89 | -7 % | within 1 SD |
| Shots per match | 24.4 ± 2.9 | 28.6 ± 5.0 | +1.43 | +17 % | within 2 SD |
| Shots on target, share | 35.4% ± 7.2% | 35.6% ± 8.8% | +0.03 | +1 % | within 1 SD |
| Shots blocked, share | 22.7% ± 6.1% | 18.9% ± 7.9% | -0.62 | -17 % | within 1 SD |
| Saves, share of shots on target | 66.9% ± 16.8% | 66.2% ± 17.8% | -0.04 | -1 % | within 1 SD |
| Goals per match | 2.71 ± 1.25 | 3.25 ± 1.61 | +0.43 | +20 % | within 1 SD |
| Penalties per match | 0.43 ± 0.53 | 0.25 ± 0.45 | -0.33 | -42 % | within 1 SD |
| Corners | 8.1 ± 4.2 | 8.5 ± 2.9 | +0.08 | +4 % | within 1 SD |
| Throw-ins | 43.6 ± 7.2 | 43.1 ± 7.0 | -0.06 | -1 % | within 1 SD |
| Goal kicks | 17.0 ± 1.6 | 16.8 ± 3.3 | -0.15 | -1 % | within 1 SD |
| Free kicks | 24.0 ± 4.7 | 27.9 ± 5.3 | +0.83 | +16 % | within 1 SD |
| Fouls | 22.9 ± 4.6 | 19.5 ± 4.4 | -0.73 | -15 % | within 1 SD |
| Cards | 5.3 ± 3.4 | 3.4 ± 2.2 | -0.56 | -36 % | within 1 SD |
| Ball in play, share of match time | 55.7% ± 0.0% | 49.5% ± 4.5% | -2.24 | -11 % | off |
| Distance per full-match outfielder (km) | 10.88 ± 0.00 | 9.72 ± 0.49 | -2.13 | -11 % | off |
| Peak speed per player, median (km/h) | 27.9 ± 0.0 | 25.9 ± 0.6 | -1.49 | -7 % | within 2 SD |
| Team width in possession (m) | 45.9 ± 4.3 | 49.1 ± 2.4 | +0.75 | +7 % | within 1 SD |
| Team width out of possession (m) | 37.0 ± 2.2 | 37.5 ± 2.0 | +0.24 | +1 % | within 1 SD |
| Defending team length, keeper excluded (m) | 32.2 ± 1.2 | 28.8 ± 1.1 | -2.07 | -10 % | off |
| Defensive line height from own goal (m) | 35.1 ± 1.5 | 32.9 ± 0.9 | -1.26 | -6 % | within 2 SD |
| Nearest defender to the ball (m) | 5.1 ± 0.5 | 5.4 ± 0.2 | +0.61 | +6 % | within 1 SD |
| Teammates within 15 m of the ball | 2.10 ± 0.14 | 2.16 ± 0.09 | +0.43 | +3 % | within 1 SD |
| Off-ball attacker to nearest defender (m) | 6.0 ± 0.5 | 6.9 ± 0.2 | +1.86 | +15 % | within 2 SD |

Summary: 18 within 1 SD, 4 within 2 SD, 4 off. z uses the real between-match SD, floored at 5 % of the mean (tracking targets come from one match).

More than 30 % from the real mean: Penalties per match (-42 %), Cards (-36 %).

## Distributions

| Distribution | Wasserstein-1 | Jensen–Shannon (bits) |
|---|---|---|
| Completed pass length | 2.06 m | 0.0139 |
| Player speed | 0.18 m/s | 0.0095 |

Lower is closer. W1 is in the distribution's own unit; JS divergence is 0 for identical and 1 for disjoint distributions.

## Player movement against real tracking

Each statistic is a distribution; it is inside when its distance (W1) to the real matches is no larger than the largest distance between two real matches (data/params/physics.json).

| Statistic | W1 to real | Largest real-to-real | Inside |
|---|---|---|---|
| Speed, keepers (m/s) | 0.166 | 0.167 | yes |
| Speed, defenders (m/s) | 0.178 | 0.230 | yes |
| Speed, midfielders (m/s) | 0.206 | 0.201 | no |
| Speed, forwards (m/s) | 0.181 | 0.297 | yes |
| Change of speed, keepers (m/s²) | 0.139 | 0.065 | no |
| Change of speed, defenders (m/s²) | 0.289 | 0.080 | no |
| Change of speed, midfielders (m/s²) | 0.356 | 0.080 | no |
| Change of speed, forwards (m/s²) | 0.335 | 0.074 | no |
| Top speed per player (m/s) | 0.223 | 0.460 | yes |
| Metres above 20 km/h per 90 minutes | 252.088 | 173.148 | no |
| Metres above 25 km/h per 90 minutes | 25.233 | 51.052 | yes |
| Accelerations past 3 m/s² per 90 minutes | 89.604 | 28.864 | no |
| Decelerations past 3 m/s² per 90 minutes | 66.719 | 30.909 | no |

Inside the real envelope: 5 of 13.

### Work rate by 15-minute period

Outfielders on the pitch for the whole match, metres per minute.

| Minutes | Real | Simulated | Real above 20 km/h | Simulated above 20 km/h |
|---|---|---|---|---|
| 0–15 | 121.8 | 119.1 | 8.5 | 6.3 |
| 15–30 | 120.5 | 111.6 | 9.2 | 5.2 |
| 30–45 | 114.3 | 106.1 | 8.7 | 4.5 |
| 45–60 | 113.2 | 99.3 | 7.9 | 3.9 |
| 60–75 | 102.3 | 90.0 | 6.9 | 3.1 |
| 75–90 | 99.4 | 90.2 | 6.5 | 3.5 |

Last 15 minutes of a half over its first 15 (late-to-early ratio): distance 0.90 simulated (real 0.84–0.99, mean 0.91); above 20 km/h 0.81 simulated (real 0.69–1.22, mean 0.95).

## Frozen ball carriers

Stretches of 1.5 s or more with the ball in play where the ball and the player nearest it both stand still (touchline_analytics.carriers; real values from the seven IDSSE matches).

| Players | Simulated per match | Most in a simulated match | Real per match | Simulated seconds per match | Real seconds per match |
|---|---|---|---|---|---|
| Outfielders | 0.0 | 0 | 0–1 (mean 0.1) | 0.0 | 0.0–2.5 |
| Keepers | 0.6 | 2 | 0–5 (mean 2.7) | 1.7 | 0.0–15.8 |

## Physical output and territory

Outfielders on the pitch for the whole match (180 player-matches from 16 matches), per 90 on-pitch minutes with the ball dead included. Real: IDSSE, 7 matches (2026-10-13 analysis, aggregates). Judge territory on 64 matches (`pnpm realism:deep`).

| Measure | Real | Simulated |
|---|---|---|
| Walking, under 7 km/h (km per 90) | 3.50 | 2.67 |
| Jogging, 7–14 km/h (km per 90) | 3.88 | 3.41 |
| Running, 14–20 km/h (km per 90) | 1.82 | 2.68 |
| High-speed running, 20–25 km/h (km per 90) | 0.52 | 0.26 |
| Sprinting, over 25 km/h (km per 90) | 0.17 | 0.13 |
| Sprints per 90 | 8.4 | 6.7 |
| Accelerations over 2.5 m/s² per 90 | 50 | 266 |
| Metres per minute, ball in play | 147 | 158 |
| Metres per minute, ball dead | 65 | 46 |
| High-speed running plus sprinting (km per 90) | 0.69 | 0.39 |
| Territory: SD over matches of the match-mean ball x, home attacking (m) | 1.9 | 5.7 |
| Outfield centroid minus ball x, team with the ball (m) | +3.9 | -1.3 |
| Outfield centroid minus ball x, team without it (m) | -9.5 | -4.8 |

## Passing (realism v2, P3)

| Measure | Real | Simulated | Band | Status |
|---|---|---|---|---|
| Passes per match | 866 | 939 | 776–956 | MET |
| Open-play passes dying at the boot (first tick, under 1 m) | 0.000 | 0.072 | 0.000–0.010 | NOT MET |
| Completion, opponent within 1 m at release | 0.700 | 0.438 | 0.640–0.760 | NOT MET |
| Completion to an available receiver, 10–20 m | 0.936 | 0.862 | 0.900–0.970 | NOT MET |
| Completion to an available receiver, 30 m+ | 0.805 | 0.773 | 0.740–0.850 | MET |
| Completed passes of 32 m+ | 0.143 | 0.112 | 0.120–0.170 | NOT MET |
| Switches (\|dy\| > 25 m), open play | 0.061 | 0.131 | 0.040–0.080 | NOT MET |
| Receiver tightly marked (under 3 m), completed | 0.090 | 0.122 | 0.060–0.120 | NOT MET |
| Passes back to the keeper | 0.062 | 0.021 | 0.045–0.080 | NOT MET |
| Most forward available option chosen | 0.200 | 0.329 | 0.150–0.250 | NOT MET |
| Open-play crosses per match (10 s after restarts excluded) | 14.9 | 5.6 | 12.0–18.0 | NOT MET |
| Cross end point from the goal line, median (m) | 10.0 | 9.4 | 8.0–12.0 | MET |
| Through balls per match | — | 14.1 | — | — |
| Shots after a through ball | 0.025 | 0.031 | 0.000–0.050 | MET |
| Keeper passes per team-match | 45.4 | 23.7 | 35.0–55.0 | NOT MET |
| Keeper open-play completion | 0.779 | 0.775 | 0.720–0.840 | MET |
| Punts per team-match | 1.60 | 0.75 | 1.00–2.20 | NOT MET |
| Keeper throws per team-match | 3.40 | 3.19 | 2.40–4.40 | MET |
| Time to release, received under 2 m pressure, median (s) | 0.40 | 0.60 | 0.20–0.70 | MET |
| Released within 1 s, received under 2 m pressure | 0.630 | 0.788 | 0.500–0.750 | NOT MET |
| Time to release, median (s) | 1.40 | 1.20 | 1.20–1.60 | MET |
| On the ball over 3 s | 0.160 | 0.125 | 0.120–0.200 | MET |
| Ball in the possessing team's own third | 0.350 | 0.209 | 0.300–0.400 | NOT MET |
| Ball u in possession, mean (m) | -5.2 | 0.3 | -8.0–-2.0 | NOT MET |

### Pass-choice model refit

Conditional logit over the passer's teammates 4–65 m away at release, intended receiver chosen (carrier-report C3). Real: the pooled fit with its 90 % interval.

13026 passes.

| Feature | Real (90 % interval) | Simulated | Status |
|---|---|---|---|
| dist/10 | -1.33 (-1.38 to -1.27) | -1.14 ± 0.02 | NOT MET |
| fwd du/10 | +0.56 (+0.52 to +0.60) | +0.59 ± 0.01 | MET |
| \|dv\|/10 | +0.18 (+0.13 to +0.23) | +0.54 ± 0.02 | NOT MET |
| lane blocked | -0.55 (-0.62 to -0.49) | -0.44 ± 0.02 | NOT MET |
| open (min(d,10)/5) | +1.27 (+1.21 to +1.34) | +1.21 ± 0.02 | NOT MET |
| line-breaking | +0.04 (-0.06 to +0.14) | -0.07 ± 0.04 | NOT MET |
| GK | +0.95 (+0.81 to +1.09) | +0.63 ± 0.07 | NOT MET |

## Duels, transitions and pressing (realism v2, P4)

| Measure | Real | Simulated | Band | Status |
|---|---|---|---|---|
| Tackle attempts won by the defender | 0.480 | 0.501 | 0.430–0.530 | MET |
| Tackle attempts won, approach from the front | 0.540 | 0.580 | 0.490–0.590 | MET |
| Tackle attempts won, approach from the side or behind (60° or more) | 0.450 | 0.485 | 0.400–0.500 | MET |
| Tackle attempts won, no defender within 3 m, tackler included (info; no sim analogue) | 0.360 | n/a | — | — |
| Tackle attempts won, tackler the only defender within 3 m | 0.510 | 0.482 | 0.450–0.570 | MET |
| Tackle attempts won, 2 or more defenders within 3 m (tackler included) | 0.600 | 0.538 | 0.540–0.660 | NOT MET |
| Take-ons won by the defender (info) | — | 0.723 | — | — |
| Ground duels (tackle attempts and take-ons) won by the defender (info) | — | 0.673 | — | — |
| Ground duels per match (tackle attempts and take-ons) | 154.7 | 125.4 | 135.0–175.0 | NOT MET |
| Aerial duels per match | 47.0 | 36.1 | 40.0–54.0 | NOT MET |
| Fouls per match | 22.9 | 19.5 | 19.0–27.0 | MET |
| Defender fouls per match (tackle and take-on) | 15.0 | 14.4 | 12.0–18.0 | MET |
| Attacker fouls per match (shielding) | 3.0 | 0.8 | 2.0–4.0 | NOT MET |
| Aerial fouls per match | 5.0 | 4.3 | 3.5–6.5 | MET |
| Free kicks within 30 m of goal per match | 0.86 | 1.12 | 0.60–1.20 | MET |
| Penalties per match | 0.43 | 0.25 | 0.25–0.50 | MET |
| Yellow cards per match (incl. second yellows) | 5.00 | 3.38 | 4.00–6.00 | NOT MET |
| Players sent off per match | 0.29 | 0.25 | 0.20–0.30 | MET |
| Cards per foul (conduct cautions excluded) | 0.140 | 0.103 | 0.110–0.170 | NOT MET |
| Counter-press: loser reaches 3 m of the ball within 3 s, 0–5 m away at the loss | 0.790 | 0.921 | 0.740–0.840 | NOT MET |
| Counter-press: reaches 3 m within 3 s, 5–10 m away | 0.280 | 0.292 | 0.230–0.330 | MET |
| Counter-press: reaches 3 m within 3 s, 10–15 m away | 0.230 | 0.126 | 0.180–0.280 | NOT MET |
| Counter-press: reaches 3 m within 3 s, 15–20 m away | 0.130 | 0.059 | 0.090–0.170 | NOT MET |
| Counter-press: reaches 3 m within 3 s, 20–30 m away | 0.070 | 0.028 | 0.040–0.100 | NOT MET |
| Losers within 5 m of the ball within 3 s, per loss | 2.29 | 2.05 | 2.00–2.60 | MET |
| Losses with 3 or more losers within 5 m within 3 s | 0.430 | 0.331 | 0.350–0.510 | NOT MET |
| Peak speed within 3 s, losers 0–5 m away, median (m/s) | 4.50 | 4.51 | 4.00–5.00 | MET |
| Ball regained within 5 s of a loss | 0.400 | 0.412 | 0.350–0.450 | MET |
| Losers running back above 4 m/s, highest share at 0–1.4 s | 0.020 | 0.040 | 0.000–0.030 | NOT MET |
| Losers running back above 4 m/s, at 2 s | 0.060 | 0.084 | 0.030–0.090 | MET |
| Losers running back above 4 m/s, at 3 s | 0.100 | 0.164 | 0.070–0.130 | NOT MET |
| Losers running back above 4 m/s, at 5–6 s | 0.150 | 0.201 | 0.120–0.180 | NOT MET |
| Losers running back above 4 m/s, at 10 s | 0.120 | 0.098 | 0.090–0.150 | MET |
| Loser outfield speed at 0.8–1.4 s over speed at −1 s | 0.870 | 0.857 | 0.800–0.900 | MET |
| Press episodes per 90 open-play minutes | 405 | 548 | 365–445 | NOT MET |
| Press episodes with 3 or more engaged | 0.049 | 0.064 | 0.035–0.065 | MET |
| Press trigger lift: receiver with his back to goal | 2.08 | 0.86 | 1.60–2.60 | NOT MET |
| Press trigger lift: ball in the defenders' own third | 1.97 | 1.13 | 1.50–2.50 | NOT MET |
| Press runs by central midfielders (DM and CM) | 0.370 | 0.381 | 0.320–0.420 | MET |
| Press runs by wingers | 0.190 | 0.139 | 0.140–0.240 | NOT MET |
| Press runs by full-backs | 0.130 | 0.156 | 0.080–0.180 | MET |
| Press runs by attacking midfielders | 0.110 | 0.054 | 0.060–0.160 | NOT MET |
| Press runs by strikers | 0.110 | 0.138 | 0.060–0.160 | MET |
| Press runs by centre-backs | 0.100 | 0.133 | 0.050–0.150 | MET |
| Press run peak speed, median (m/s; info) | 5.10 | 4.76 | — | — |
| Teammates open by 3 m per open-play pass | 7.96 | 8.52 | 7.20–8.70 | MET |
| Teammates with a clear lane per open-play pass | 4.95 | 5.21 | 4.50–5.40 | MET |
| Distance per full-match outfielder (km; info) | 10.88 | 9.72 | — | — |

- Penalties and players sent off are rare: judge them on ≥ 64 matches (`pnpm realism:deep`); this report has 16.

## Set pieces, keeper restarts and role moves (realism v2, P5)

| Measure | Real | Simulated | Band | Status |
|---|---|---|---|---|
| Corners: attackers in the box, taker excluded | 5.49 | 5.76 | 4.80–6.20 | MET |
| Corners: attackers in the six-yard box | 1.07 | 0.00 | 0.70–1.40 | NOT MET |
| Corners: defending outfielders in the box | 9.15 | 9.00 | 8.50–9.80 | MET |
| Corners: box defenders within 2 m of an attacker, share | 0.54 | 0.67 | 0.45–0.63 | NOT MET |
| Corners: defending outfielders left up (u < 17.5) | 0.02 | 0.00 | 0.00–0.20 | MET |
| Corners: attackers kept back (u < 28) | 1.43 | 1.37 | 1.00–1.90 | MET |
| Corners: delivery completed (restart pass successful) | 0.43 | 0.66 | 0.33–0.53 | NOT MET |
| Wide attacking free kicks: attackers in the box | 3.76 | 1.38 | 3.20–4.40 | NOT MET |
| Central attacking free kicks: attackers in the box | 3.09 | 0.00 | 2.50–3.70 | NOT MET |
| Wide attacking free kicks: attackers kept back (u < 28) | 2.71 | 2.76 | 2.20–3.20 | MET |
| Central attacking free kicks: attackers kept back (u < 28) | 2.27 | 2.51 | 1.80–2.80 | MET |
| Attacking-third throw-ins: outfielders kept back (u < 28) | 4.10 | 7.37 | 3.50–4.70 | NOT MET |
| Central attacking free kicks: wall present, share | 1.00 | 1.00 | 0.90–1.00 | MET |
| Central attacking free kicks: players in the wall | 2.46 | 3.90 | 2.00–3.00 | NOT MET |
| Wide attacking free kicks: wall present, share | 0.76 | 0.90 | 0.60–0.90 | NOT MET |
| Central attacking free kicks: nearest wall player to the ball, median (m) | 9.76 | 8.66 | 8.60–10.00 | MET |
| Goal kicks: opponents deeper than the box line (u < -36) | 0.18 | 0.00 | 0.00–0.40 | MET |
| Goal kicks: opponents in the kicking side's defensive third | 2.64 | 1.72 | 2.00–3.20 | NOT MET |
| Goal kicks: kicking side's CBs, mean u (m) | -31.4 | -30.8 | -34.0–-28.0 | MET |
| Middle-third throw-ins: team-mates within 10 m of the ball | 0.94 | 1.06 | 0.70–1.20 | MET |
| Throw-ins: first-contact distance, median (m) | 9.6 | 10.2 | 8.1–11.1 | MET |
| Kickoffs: nearest opponent to the ball (m) | 8.6 | 8.0 | 8.0–10.0 | MET |
| Goal kicks: first contact beyond 32 m, share | 0.48 | 0.21 | 0.40–0.56 | NOT MET |
| Long goal kicks (32 m or more): restart pass completed, share | 0.49 | 0.61 | 0.40–0.58 | NOT MET |
| Goal kicks: opponents' shots within 10 s, per 100 | 0.9 | 4.5 | 0.0–4.0 | NOT MET |
| Free kicks taken by the keeper, per team-match | 3.00 | 3.25 | 2.30–3.70 | MET |
| Central attacking free kicks shot directly, share | 0.36 | 0.50 | 0.20–0.50 | MET |
| Corners: shots within 10 s, per 100 | 32.1 | 39.0 | 25.0–39.0 | MET |
| Dead time before throw-ins, median (s) | 13.5 | 14.6 | 11.0–16.0 | MET |
| Dead time before goal kicks, median (s) | 22.0 | 21.8 | 19.0–25.0 | MET |
| Dead time before corners, median (s) | 33.0 | 35.9 | 30.0–36.0 | MET |
| Dead time before attacking-third free kicks, median (s) | 42.0 | 44.4 | 37.0–47.0 | MET |
| Dead time before other free kicks, median (s) | 28.0 | 28.1 | 24.0–32.0 | MET |
| Dead time before kickoffs after a goal, median (s) | 70.0 | 68.7 | 62.0–78.0 | MET |
| Moving outfielders' (0.5 m/s or more) mean speed while the ball is dead, median over restarts (m/s) | 1.20 | 1.33 | 1.00–1.50 | MET |
| FB overlaps per team-match | 13.9 | 24.8 | 11.0–17.0 | NOT MET |
| Wingers coming inside per team-match | 61.9 | 20.7 | 52.0–72.0 | NOT MET |
| FB underlaps and inversions per team-match | 36.4 | 39.9 | 30.0–43.0 | MET |
| Runs in behind per team-match | 34.6 | 16.8 | 29.0–40.0 | NOT MET |
| Runs in behind starting with the ball in a wide lane, share | 0.64 | 0.45 | 0.55–0.72 | NOT MET |
| Runs in behind ending beyond the last line, share | 0.26 | 0.69 | 0.18–0.34 | NOT MET |
| CM drops into the back line per team-match | 44.7 | 48.3 | 38.0–52.0 | MET |
| Drops to receive per team-match (info) | 56.9 | 27.7 | — | — |
| Offsides per match (info) | — | 10.0 | — | — |
| Ball in play, first 15 minutes (info) | 0.62 | 0.59 | — | — |
| Ball in play, minutes 75-90 (info) | 0.43 | 0.43 | — | — |

- From 16 matches: 136 corners, 21 wide attacking free kicks, 40 central attacking free kicks, 268 goal kicks, 97 kickoffs; 690 throw-ins (88 in the attacking third).
- The direct free-kick share rests on 11 real free kicks: judge it on ≥ 64 matches (`pnpm realism:deep`); this report has 16.
- Role moves are counted from frames with the analysis's episode definitions (touchline_analytics.rolemoves), per team-match.

## Match balance and discipline

From 16 matches. These are rare or noisy measures: judge them on 64 or more (`pnpm realism:deep`); this report has fewer than 64 matches.

| Measure | Real | Simulated | Target | Status |
|---|---|---|---|---|
| Team shot share, SD over matches (C3) | 0.090 | 0.232 | ≤ 0.18 | NOT MET |
| Players sent off per match | 0.29 | 0.25 | about 0.2–0.3 | — |
| Penalties per match | 0.43 | 0.25 | — | — |


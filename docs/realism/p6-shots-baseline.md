# Touchline shots diagnostics

16 synthetic matches (calib-2026-10-19; held-out seeds 2000–2015).

Base (ruling 18): the branch merged with main, P4 switched on (ad54168), every P6 rule 0, so no `--set`. Checked by hand: header share 0 and first-time share 0.000 (F11 expected a few percent; on this engine no open-play shot falls within 0.3 s of gaining the ball).


## Shots (realism v2, P6)

| Measure | Real | Simulated | Band | Status |
|---|---|---|---|---|
| Shots per match (all) | 24.4 | 25.8 | 21.0–28.0 | MET |
| Open-play shots per match | 17.1 | 19.6 | 14.5–19.7 | MET |
| Goals per match | 2.71 | 3.69 | 2.40–3.00 | NOT MET |
| Open-play conversion | 0.092 | 0.134 | 0.070–0.110 | NOT MET |
| First-time shots (on the ball < 0.3 s), share of open-play shots | 0.410 | 0.000 | 0.330–0.490 | NOT MET |
| First-time shots, share of open-play goals | 0.550 | 0.000 | 0.400–0.700 | NOT MET |
| Conversion, first-time shots | 0.122 | n/a | 0.090–0.150 | — |
| Conversion, other open-play shots | 0.070 | 0.134 | 0.050–0.090 | NOT MET |
| Headers, share of open-play shots | 0.140 | 0.000 | 0.100–0.180 | NOT MET |
| Conversion, headers | 0.060 | n/a | 0.030–0.090 | — |
| Conversion, nearest defender < 1.5 m | 0.118 | 0.108 | 0.080–0.160 | MET |
| Conversion, nearest defender 1.5–3 m | 0.109 | 0.147 | 0.070–0.150 | MET |
| Conversion, nearest defender 3 m or more | 0.032 | 0.152 | 0.010–0.060 | NOT MET |
| Conversion, tight minus open (< 1.5 m minus ≥ 3 m) | 0.086 | -0.044 | 0.030–0.140 | NOT MET |
| Nearest outfield defender at the shot, median (m) | 2.04 | 2.18 | 1.60–2.50 | MET |
| Open-play shots from inside the box, share | 0.590 | 0.703 | 0.520–0.660 | NOT MET |
| Conversion, inside the box | 0.127 | 0.168 | 0.090–0.160 | NOT MET |
| Conversion, outside the box | 0.041 | 0.054 | 0.020–0.060 | MET |
| Open-play shots blocked, share | 0.217 | 0.166 | 0.170–0.270 | NOT MET |
| Setup: pass, share of open-play shots | 0.330 | 0.131 | 0.270–0.390 | NOT MET |
| Setup: dribble (1.5 s and 5 m on the ball), share | 0.310 | 0.578 | 0.250–0.370 | NOT MET |
| Setup: cross, share | 0.170 | 0.029 | 0.110–0.230 | NOT MET |
| Setup: loose ball or regain, share | 0.130 | 0.147 | 0.070–0.190 | MET |
| Setup: through ball, share | 0.025 | 0.105 | 0.000–0.050 | NOT MET |
| Keeper off his line at open-play shots, median (m; info) | 2.23 | 2.95 | — | — |
| Keeper off the ball–goal line at open-play shots, median (m; info) | 0.32 | 0.57 | — | — |
| Open-play pass completion, 75–90+ minus 0–15 | -0.063 | -0.023 | -0.083–-0.043 | NOT MET |
| xG per open-play shot (real: DFL model; info) | 0.101 | 0.128 | — | — |

- conversion splits: judge on ≥ 64 matches (`pnpm realism:deep`); this report has 16 matches and 313 open-play shots.
- Headers read 0: the engine makes them only under `header.rule` 1 (P6 Task 4). Before `firstTime.rule` 1 (Task 3) the first-time share is a few percent at most: pressed receivers who release within 0.3 s.
- xG refit (fractional logit of DFL xG, 159 IDSSE shots with a defender count; method in shots.fit_xg): b0 -3.004, bDist -0.0392/m, bAngle +4.059/rad, bHeader -1.617, bDefenders -0.342; `shotModel.xg` under `shotModel.rule` 1.


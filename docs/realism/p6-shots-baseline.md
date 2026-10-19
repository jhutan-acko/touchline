# Touchline shots diagnostics

No synthetic matches yet (baseline pending P4 merge).


Note: the simulated column is pending P4's final result. No sim measurement is taken before the P6 branch is merged with P4 (user decision 2026-10-19; preflight F10). After the merge, fill it with `pnpm realism --matches 16 --only shots --runs out/p6-t2-runs --out docs/realism/p6-shots-baseline.md && rm -rf out/p6-t2-runs`, then check by hand that `header_share` reads 0 and record `first_time_share`, which should be a few percent, not 0: a pressed receiver can release 0.2 s after the reception, under ruling 16's 0.3 s (preflight F11). Real rows computed in-repo from data/raw/idsse (header share 0.152 against the tracking-based 0.14 as a parse check; late completion drop −0.063, from completion 0.804 over 0–15 and 0.741 over 75–90+); the rest are copied from finalthird-report.md A3.

## Shots (realism v2, P6)

| Measure | Real | Simulated | Band | Status |
|---|---|---|---|---|
| Shots per match (all) | 24.4 | pending P4 merge | 21.0–28.0 | — |
| Open-play shots per match | 17.1 | pending P4 merge | 14.5–19.7 | — |
| Goals per match | 2.71 | pending P4 merge | 2.40–3.00 | — |
| Open-play conversion | 0.092 | pending P4 merge | 0.070–0.110 | — |
| First-time shots (on the ball < 0.3 s), share of open-play shots | 0.410 | pending P4 merge | 0.330–0.490 | — |
| First-time shots, share of open-play goals | 0.550 | pending P4 merge | 0.400–0.700 | — |
| Conversion, first-time shots | 0.122 | pending P4 merge | 0.090–0.150 | — |
| Conversion, other open-play shots | 0.070 | pending P4 merge | 0.050–0.090 | — |
| Headers, share of open-play shots | 0.140 | pending P4 merge | 0.100–0.180 | — |
| Conversion, headers | 0.060 | pending P4 merge | 0.030–0.090 | — |
| Conversion, nearest defender < 1.5 m | 0.118 | pending P4 merge | 0.080–0.160 | — |
| Conversion, nearest defender 1.5–3 m | 0.109 | pending P4 merge | 0.070–0.150 | — |
| Conversion, nearest defender 3 m or more | 0.032 | pending P4 merge | 0.010–0.060 | — |
| Conversion, tight minus open (< 1.5 m minus ≥ 3 m) | 0.086 | pending P4 merge | 0.030–0.140 | — |
| Nearest outfield defender at the shot, median (m) | 2.04 | pending P4 merge | 1.60–2.50 | — |
| Open-play shots from inside the box, share | 0.590 | pending P4 merge | 0.520–0.660 | — |
| Conversion, inside the box | 0.127 | pending P4 merge | 0.090–0.160 | — |
| Conversion, outside the box | 0.041 | pending P4 merge | 0.020–0.060 | — |
| Open-play shots blocked, share | 0.217 | pending P4 merge | 0.170–0.270 | — |
| Setup: pass, share of open-play shots | 0.330 | pending P4 merge | 0.270–0.390 | — |
| Setup: dribble (1.5 s and 5 m on the ball), share | 0.310 | pending P4 merge | 0.250–0.370 | — |
| Setup: cross, share | 0.170 | pending P4 merge | 0.110–0.230 | — |
| Setup: loose ball or regain, share | 0.130 | pending P4 merge | 0.070–0.190 | — |
| Setup: through ball, share | 0.025 | pending P4 merge | 0.000–0.050 | — |
| Keeper off his line at open-play shots, median (m; info) | 2.23 | pending P4 merge | — | — |
| Keeper off the ball–goal line at open-play shots, median (m; info) | 0.32 | pending P4 merge | — | — |
| Open-play pass completion, 75–90+ minus 0–15 | -0.063 | pending P4 merge | -0.083–-0.043 | — |
| xG per open-play shot (real: DFL model; info) | 0.101 | pending P4 merge | — | — |

- conversion splits: judge on ≥ 64 matches (`pnpm realism:deep`); this report has 0 matches and 0 open-play shots.
- xG refit (fractional logit of DFL xG, 159 IDSSE shots with a defender count; method in shots.fit_xg): b0 -3.004, bDist -0.0392/m, bAngle +4.059/rad, bHeader -1.617, bDefenders -0.342; `shotModel.xg` under `shotModel.rule` 1.


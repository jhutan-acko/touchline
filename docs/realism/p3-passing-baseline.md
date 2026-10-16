# Touchline passing diagnostics

16 synthetic matches (calib-2026-10-15; held-out seeds 2000–2015).

Note: punts read 0 until Task 7 (G5) makes the engine emit method punt; until then keeper kicks are recorded as kick.

## Passing (realism v2, P3)

| Measure | Real | Simulated | Band | Status |
|---|---|---|---|---|
| Passes per match | 866 | 1054 | 776–956 | NOT MET |
| Open-play passes dying at the boot (first tick, under 1 m) | 0.000 | 0.052 | 0.000–0.010 | NOT MET |
| Completion, opponent within 1 m at release | 0.700 | 0.081 | 0.640–0.760 | NOT MET |
| Completion to an available receiver, 10–20 m | 0.936 | 0.828 | 0.900–0.970 | NOT MET |
| Completion to an available receiver, 30 m+ | 0.805 | 0.799 | 0.740–0.850 | MET |
| Completed passes of 32 m+ | 0.143 | 0.150 | 0.120–0.170 | MET |
| Switches (\|dy\| > 25 m), open play | 0.061 | 0.166 | 0.040–0.080 | NOT MET |
| Receiver tightly marked (under 3 m), completed | 0.090 | 0.170 | 0.060–0.120 | NOT MET |
| Passes back to the keeper | 0.062 | 0.011 | 0.045–0.080 | NOT MET |
| Most forward available option chosen | 0.200 | 0.355 | 0.150–0.250 | NOT MET |
| Open-play crosses per match (10 s after restarts excluded) | 14.9 | 5.6 | 12.0–18.0 | NOT MET |
| Cross end point from the goal line, median (m) | 10.0 | 12.2 | 8.0–12.0 | NOT MET |
| Through balls per match | — | 46.2 | — | — |
| Shots after a through ball | 0.025 | 0.138 | 0.000–0.050 | NOT MET |
| Keeper passes per team-match | 45.4 | 17.1 | 35.0–55.0 | NOT MET |
| Keeper open-play completion | 0.779 | 0.760 | 0.720–0.840 | MET |
| Punts per team-match | 1.60 | 0.00 | 1.00–2.20 | NOT MET |
| Keeper throws per team-match | 3.40 | 3.69 | 2.40–4.40 | MET |
| Time to release, received under 2 m pressure, median (s) | 0.40 | 1.20 | 0.20–0.70 | NOT MET |
| Released within 1 s, received under 2 m pressure | 0.630 | 0.216 | 0.500–0.750 | NOT MET |
| Time to release, median (s) | 1.40 | 1.20 | 1.20–1.60 | MET |
| On the ball over 3 s | 0.160 | 0.022 | 0.120–0.200 | NOT MET |
| Ball in the possessing team's own third | 0.350 | 0.161 | 0.300–0.400 | NOT MET |
| Ball u in possession, mean (m) | -5.2 | 2.7 | -8.0–-2.0 | NOT MET |

### Pass-choice model refit

Conditional logit over the passer's teammates 4–65 m away at release, intended receiver chosen (carrier-report C3). Real: the pooled fit with its 90 % interval.

14963 passes.

| Feature | Real (90 % interval) | Simulated | Status |
|---|---|---|---|
| dist/10 | -1.33 (-1.38 to -1.27) | -0.83 ± 0.02 | NOT MET |
| fwd du/10 | +0.56 (+0.52 to +0.60) | +0.75 ± 0.01 | NOT MET |
| \|dv\|/10 | +0.18 (+0.13 to +0.23) | +0.70 ± 0.02 | NOT MET |
| lane blocked | -0.55 (-0.62 to -0.49) | -0.09 ± 0.02 | NOT MET |
| open (min(d,10)/5) | +1.27 (+1.21 to +1.34) | +0.46 ± 0.02 | NOT MET |
| line-breaking | +0.04 (-0.06 to +0.14) | -0.15 ± 0.03 | NOT MET |
| GK | +0.95 (+0.81 to +1.09) | +0.87 ± 0.09 | MET |


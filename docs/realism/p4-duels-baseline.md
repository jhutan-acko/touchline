# Touchline duels diagnostics

16 synthetic matches (calib-2026-10-17; held-out seeds 2000–2015).

Note: the P3 engine, before any P4 change (`pnpm realism --matches 16 --only duels`). Aerial duels read 8.1 per match here; the plan's figure of about 19 comes from the 2026-10-13 analysis on the parameters of that date. Support counts the tackler's outfield teammates within 5 m of the carrier (plan 8d ruling 2); the real split it is compared with counted opponents within 3 m.

## Duels, transitions and pressing (realism v2, P4)

| Measure | Real | Simulated | Band | Status |
|---|---|---|---|---|
| Tackle attempts won by the defender | 0.480 | 0.517 | 0.430–0.530 | MET |
| Tackle attempts won, approach from the front | 0.540 | 0.566 | 0.490–0.590 | MET |
| Tackle attempts won, approach from behind | 0.450 | 0.485 | 0.400–0.500 | MET |
| Tackle attempts won, no supporting defender within 5 m | 0.360 | 0.517 | 0.310–0.410 | NOT MET |
| Tackle attempts won, a supporting defender within 5 m | 0.600 | 0.528 | 0.550–0.650 | NOT MET |
| Take-ons won by the defender (info) | — | 0.706 | — | — |
| Ground duels (tackle attempts and take-ons) won by the defender (info) | — | 0.593 | — | — |
| Ground duels per match (tackle attempts and take-ons) | 154.7 | 150.9 | 135.0–175.0 | MET |
| Aerial duels per match | 47.0 | 8.1 | 40.0–54.0 | NOT MET |
| Fouls per match | 22.9 | 13.4 | 19.0–27.0 | NOT MET |
| Defender fouls per match (tackle and take-on) | 15.0 | 13.4 | 12.0–18.0 | MET |
| Attacker fouls per match (shielding) | 3.0 | 0.0 | 2.0–4.0 | NOT MET |
| Aerial fouls per match | 5.0 | 0.0 | 3.5–6.5 | NOT MET |
| Free kicks within 30 m of goal per match | 0.86 | 0.69 | 0.60–1.20 | MET |
| Penalties per match | 0.43 | 0.12 | 0.25–0.50 | NOT MET |
| Yellow cards per match (incl. second yellows) | 5.00 | 6.94 | 4.00–6.00 | NOT MET |
| Players sent off per match | 0.29 | 0.25 | 0.20–0.30 | MET |
| Cards per foul (conduct cautions excluded) | 0.140 | 0.414 | 0.110–0.170 | NOT MET |
| Counter-press: loser reaches 3 m of the ball within 3 s, 0–5 m away at the loss | 0.790 | 0.895 | 0.740–0.840 | NOT MET |
| Counter-press: reaches 3 m within 3 s, 5–10 m away | 0.280 | 0.237 | 0.230–0.330 | MET |
| Counter-press: reaches 3 m within 3 s, 10–15 m away | 0.230 | 0.101 | 0.180–0.280 | NOT MET |
| Counter-press: reaches 3 m within 3 s, 15–20 m away | 0.130 | 0.046 | 0.090–0.170 | NOT MET |
| Counter-press: reaches 3 m within 3 s, 20–30 m away | 0.070 | 0.022 | 0.040–0.100 | NOT MET |
| Losers within 5 m of the ball within 3 s, per loss | 2.29 | 1.85 | 2.00–2.60 | NOT MET |
| Losses with 3 or more losers within 5 m within 3 s | 0.430 | 0.230 | 0.350–0.510 | NOT MET |
| Peak speed within 3 s, losers 0–5 m away, median (m/s) | 4.50 | 4.81 | 4.00–5.00 | MET |
| Ball regained within 5 s of a loss | 0.400 | 0.331 | 0.350–0.450 | NOT MET |
| Losers running back above 4 m/s, highest share at 0–1.4 s | 0.020 | 0.111 | 0.000–0.030 | NOT MET |
| Losers running back above 4 m/s, at 2 s | 0.060 | 0.135 | 0.030–0.090 | NOT MET |
| Losers running back above 4 m/s, at 3 s | 0.100 | 0.153 | 0.070–0.130 | NOT MET |
| Losers running back above 4 m/s, at 5–6 s | 0.150 | 0.145 | 0.120–0.180 | MET |
| Losers running back above 4 m/s, at 10 s | 0.120 | 0.062 | 0.090–0.150 | NOT MET |
| Loser outfield speed at 0.8–1.4 s over speed at −1 s | 0.870 | 1.102 | 0.800–0.900 | NOT MET |
| Press episodes per 90 open-play minutes | 405 | 272 | 365–445 | NOT MET |
| Press episodes with 3 or more engaged | 0.049 | 0.031 | 0.035–0.065 | NOT MET |
| Press trigger lift: receiver with his back to goal | 2.08 | 0.81 | 1.60–2.60 | NOT MET |
| Press trigger lift: ball in the defenders' own third | 1.97 | 1.22 | 1.50–2.50 | NOT MET |
| Press runs by central midfielders (DM and CM) | 0.370 | 0.408 | 0.320–0.420 | MET |
| Press runs by wingers | 0.190 | 0.113 | 0.140–0.240 | NOT MET |
| Press runs by full-backs | 0.130 | 0.145 | 0.080–0.180 | MET |
| Press runs by attacking midfielders | 0.110 | 0.042 | 0.060–0.160 | NOT MET |
| Press runs by strikers | 0.110 | 0.165 | 0.060–0.160 | NOT MET |
| Press runs by centre-backs | 0.100 | 0.127 | 0.050–0.150 | MET |
| Press run peak speed, median (m/s; info) | 5.10 | 5.23 | — | — |
| Teammates open by 3 m per open-play pass | 7.96 | 8.10 | 7.20–8.70 | MET |
| Teammates with a clear lane per open-play pass | 4.95 | 6.01 | 4.50–5.40 | NOT MET |
| Distance per full-match outfielder (km; info) | 10.88 | 9.16 | — | — |

- Penalties and players sent off are rare: judge them on ≥ 64 matches (`pnpm realism:deep`); this report has 16.
- Attacker (shielding) fouls read 0: the engine emits them only under `fouls.rule` 1 (P4 Task 4).
- Defender fouls are tackle fouls only: take-on fouls come with `fouls.rule` 1 (P4 Task 4).
- Aerial fouls read 0: the engine emits them only under `aerial.rule` 1 (P4 Task 5).


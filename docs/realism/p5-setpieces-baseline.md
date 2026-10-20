# Touchline set-pieces diagnostics

16 synthetic matches (calib-2026-10-19; held-out seeds 2000–2015).

Note: the P4 engine (P4 rules on, every P5 rule at 0), measured on realism-v2-p5 after the P4 merge (2d43dbc) with `pnpm realism --matches 16 --only setpieces --runs out/p5-t2-runs --out docs/realism/p5-setpieces-baseline.md`. Hand checks: corner attackers in the box read 3.32, above the plan's expected 1–2 (the plan's estimate, made before P4; recorded as measured); the direct free-kick share reads 0.06 (2 of 35 central attacking free kicks), not 0, because `decide.ts` already offers a shot at free kicks within 32 m (preflight F18). Real values: the 2026-10-13 realism analysis, IDSSE, 7 matches (aggregates only); bands are plan 8e rulings. The direct free-kick share rests on 11 real free kicks and is judged on ≥ 64 matches. Role moves are counted from frames with the analysis's episode definitions, per team-match; the port reproduces the analysis's own sim counts on its 16 sim dumps (overlap 0.6, inversion 6.2, W inside 1.4, CM drop 11.4, runs in behind 59.1 against 59.3).


## Set pieces, keeper restarts and role moves (realism v2, P5)

| Measure | Real | Simulated | Band | Status |
|---|---|---|---|---|
| Corners: attackers in the box, taker excluded | 5.49 | 3.32 | 4.80–6.20 | NOT MET |
| Corners: attackers in the six-yard box | 1.07 | 0.11 | 0.70–1.40 | NOT MET |
| Corners: defending outfielders in the box | 9.15 | 5.81 | 8.50–9.80 | NOT MET |
| Corners: box defenders within 2 m of an attacker, share | 0.54 | 0.10 | 0.45–0.63 | NOT MET |
| Corners: defending outfielders left up (u < 17.5) | 0.02 | 0.09 | 0.00–0.20 | MET |
| Corners: attackers kept back (u < 28) | 1.43 | 2.02 | 1.00–1.90 | NOT MET |
| Corners: delivery completed (restart pass successful) | 0.43 | 0.65 | 0.33–0.53 | NOT MET |
| Wide attacking free kicks: attackers in the box | 3.76 | 0.16 | 3.20–4.40 | NOT MET |
| Central attacking free kicks: attackers in the box | 3.09 | 0.34 | 2.50–3.70 | NOT MET |
| Wide attacking free kicks: attackers kept back (u < 28) | 2.71 | 6.64 | 2.20–3.20 | NOT MET |
| Central attacking free kicks: attackers kept back (u < 28) | 2.27 | 6.51 | 1.80–2.80 | NOT MET |
| Attacking-third throw-ins: outfielders kept back (u < 28) | 4.10 | 6.36 | 3.50–4.70 | NOT MET |
| Central attacking free kicks: wall present, share | 1.00 | 0.60 | 0.90–1.00 | NOT MET |
| Central attacking free kicks: players in the wall | 2.46 | 0.91 | 2.00–3.00 | NOT MET |
| Wide attacking free kicks: wall present, share | 0.76 | 0.48 | 0.60–0.90 | NOT MET |
| Central attacking free kicks: nearest wall player to the ball, median (m) | 9.76 | 9.44 | 8.60–10.00 | MET |
| Goal kicks: opponents deeper than the box line (u < -36) | 0.18 | 0.08 | 0.00–0.40 | MET |
| Goal kicks: opponents in the kicking side's defensive third | 2.64 | 2.99 | 2.00–3.20 | MET |
| Goal kicks: kicking side's CBs, mean u (m) | -31.4 | -29.2 | -34.0–-28.0 | MET |
| Middle-third throw-ins: team-mates within 10 m of the ball | 0.94 | 0.97 | 0.70–1.20 | MET |
| Throw-ins: first-contact distance, median (m) | 9.6 | 9.3 | 8.1–11.1 | MET |
| Kickoffs: nearest opponent to the ball (m) | 8.6 | 2.9 | 8.0–10.0 | NOT MET |
| Goal kicks: first contact beyond 32 m, share | 0.48 | 0.34 | 0.40–0.56 | NOT MET |
| Long goal kicks (32 m or more): restart pass completed, share | 0.49 | 0.71 | 0.40–0.58 | NOT MET |
| Goal kicks: opponents' shots within 10 s, per 100 | 0.9 | 2.5 | 0.0–4.0 | MET |
| Free kicks taken by the keeper, per team-match | 3.00 | 0.00 | 2.30–3.70 | NOT MET |
| Central attacking free kicks shot directly, share | 0.36 | 0.06 | 0.20–0.50 | NOT MET |
| Corners: shots within 10 s, per 100 | 32.1 | 29.8 | 25.0–39.0 | MET |
| Dead time before throw-ins, median (s) | 13.5 | 18.8 | 11.0–16.0 | NOT MET |
| Dead time before goal kicks, median (s) | 22.0 | 31.2 | 19.0–25.0 | NOT MET |
| Dead time before corners, median (s) | 33.0 | 38.3 | 30.0–36.0 | NOT MET |
| Dead time before attacking-third free kicks, median (s) | 42.0 | 25.0 | 37.0–47.0 | NOT MET |
| Dead time before other free kicks, median (s) | 28.0 | 25.9 | 24.0–32.0 | MET |
| Dead time before kickoffs after a goal, median (s) | 70.0 | 47.9 | 62.0–78.0 | NOT MET |
| Outfielders' mean speed while the ball is dead, median over restarts (m/s) | 1.20 | 0.94 | 1.00–1.50 | NOT MET |
| FB overlaps per team-match | 13.9 | 21.1 | 11.0–17.0 | NOT MET |
| Wingers coming inside per team-match | 61.9 | 19.7 | 52.0–72.0 | NOT MET |
| FB underlaps and inversions per team-match | 36.4 | 36.8 | 30.0–43.0 | MET |
| Runs in behind per team-match | 34.6 | 56.2 | 29.0–40.0 | NOT MET |
| Runs in behind starting with the ball in a wide lane, share | 0.64 | 0.61 | 0.55–0.72 | MET |
| Runs in behind ending beyond the last line, share | 0.26 | 0.77 | 0.18–0.34 | NOT MET |
| CM drops into the back line per team-match | 44.7 | 53.8 | 38.0–52.0 | NOT MET |
| Drops to receive per team-match (info) | 56.9 | 28.5 | — | — |
| Offsides per match (info) | — | 10.1 | — | — |
| Ball in play, first 15 minutes (info) | 0.62 | 0.55 | — | — |
| Ball in play, minutes 75-90 (info) | 0.43 | 0.54 | — | — |

- From 16 matches: 171 corners, 25 wide attacking free kicks, 35 central attacking free kicks, 284 goal kicks, 90 kickoffs; 741 throw-ins (121 in the attacking third).
- The direct free-kick share rests on 11 real free kicks: judge it on ≥ 64 matches (`pnpm realism:deep`); this report has 16.
- Role moves are counted from frames with the analysis's episode definitions (touchline_analytics.rolemoves), per team-match.


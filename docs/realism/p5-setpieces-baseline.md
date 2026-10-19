# Touchline set-pieces diagnostics

**Simulated column pending P4 merge.** This baseline is measured on the P4 merge with the P4 rules on, after this branch is rebased onto it:

```bash
pnpm realism --matches 16 --only setpieces --runs out/p5-t2-runs --out docs/realism/p5-setpieces-baseline.md && rm -rf out/p5-t2-runs
```

That command rewrites this file with the measured column. Then check by hand that corner attackers in the box read about 1–2 and the direct free-kick share near 0 (record the measured value: `decide.ts` already offers a shot at free kicks within 32 m, so it may sit above 0; preflight F18), and add a `Note:` paragraph under the title (as `p4-duels-baseline.md` has) carrying the paragraph below.

Real values: the 2026-10-13 realism analysis, IDSSE, 7 matches (aggregates only); bands are plan 8e rulings. The direct free-kick share rests on 11 real free kicks and is judged on ≥ 64 matches. Role moves are counted from frames with the analysis's episode definitions, per team-match; the port reproduces the analysis's own sim counts on its 16 sim dumps (overlap 0.6, inversion 6.2, W inside 1.4, CM drop 11.4, runs in behind 59.1 against 59.3).

## Set pieces, keeper restarts and role moves (realism v2, P5)

| Measure | Real | Simulated | Band | Status |
|---|---|---|---|---|
| Corners: attackers in the box, taker excluded | 5.49 | pending P4 merge | 4.80–6.20 | pending |
| Corners: attackers in the six-yard box | 1.07 | pending P4 merge | 0.70–1.40 | pending |
| Corners: defending outfielders in the box | 9.15 | pending P4 merge | 8.50–9.80 | pending |
| Corners: box defenders within 2 m of an attacker, share | 0.54 | pending P4 merge | 0.45–0.63 | pending |
| Corners: defending outfielders left up (u < 17.5) | 0.02 | pending P4 merge | 0.00–0.20 | pending |
| Corners: attackers kept back (u < 28) | 1.43 | pending P4 merge | 1.00–1.90 | pending |
| Corners: delivery completed (restart pass successful) | 0.43 | pending P4 merge | 0.33–0.53 | pending |
| Wide attacking free kicks: attackers in the box | 3.76 | pending P4 merge | 3.20–4.40 | pending |
| Central attacking free kicks: attackers in the box | 3.09 | pending P4 merge | 2.50–3.70 | pending |
| Wide attacking free kicks: attackers kept back (u < 28) | 2.71 | pending P4 merge | 2.20–3.20 | pending |
| Central attacking free kicks: attackers kept back (u < 28) | 2.27 | pending P4 merge | 1.80–2.80 | pending |
| Attacking-third throw-ins: outfielders kept back (u < 28) | 4.10 | pending P4 merge | 3.50–4.70 | pending |
| Central attacking free kicks: wall present, share | 1.00 | pending P4 merge | 0.90–1.00 | pending |
| Central attacking free kicks: players in the wall | 2.46 | pending P4 merge | 2.00–3.00 | pending |
| Wide attacking free kicks: wall present, share | 0.76 | pending P4 merge | 0.60–0.90 | pending |
| Central attacking free kicks: nearest wall player to the ball, median (m) | 9.76 | pending P4 merge | 8.60–10.00 | pending |
| Goal kicks: opponents deeper than the box line (u < -36) | 0.18 | pending P4 merge | 0.00–0.40 | pending |
| Goal kicks: opponents in the kicking side's defensive third | 2.64 | pending P4 merge | 2.00–3.20 | pending |
| Goal kicks: kicking side's CBs, mean u (m) | -31.4 | pending P4 merge | -34.0–-28.0 | pending |
| Throw-ins: team-mates within 10 m of the ball | 0.94 | pending P4 merge | 0.70–1.20 | pending |
| Throw-ins: first-contact distance, median (m) | 9.5 | pending P4 merge | 8.0–11.0 | pending |
| Kickoffs: nearest opponent to the ball (m) | 8.6 | pending P4 merge | 8.0–10.0 | pending |
| Goal kicks: first contact beyond 32 m, share | 0.48 | pending P4 merge | 0.40–0.56 | pending |
| Long goal kicks: first contact by the kicking side, share | 0.49 | pending P4 merge | 0.40–0.58 | pending |
| Goal kicks: opponents' shots within 10 s, per 100 | 0.9 | pending P4 merge | 0.0–4.0 | pending |
| Free kicks taken by the keeper, per team-match | 3.00 | pending P4 merge | 2.30–3.70 | pending |
| Central attacking free kicks shot directly, share | 0.36 | pending P4 merge | 0.20–0.50 | pending |
| Corners: shots within 10 s, per 100 | 32.1 | pending P4 merge | 25.0–39.0 | pending |
| Dead time before throw-ins, median (s) | 13.5 | pending P4 merge | 11.0–16.0 | pending |
| Dead time before goal kicks, median (s) | 22.0 | pending P4 merge | 19.0–25.0 | pending |
| Dead time before corners, median (s) | 33.0 | pending P4 merge | 30.0–36.0 | pending |
| Dead time before attacking-third free kicks, median (s) | 42.0 | pending P4 merge | 37.0–47.0 | pending |
| Dead time before other free kicks, median (s) | 28.0 | pending P4 merge | 24.0–32.0 | pending |
| Dead time before kickoffs after a goal, median (s) | 70.0 | pending P4 merge | 62.0–78.0 | pending |
| Outfielders' mean speed while the ball is dead, median over restarts (m/s) | 1.20 | pending P4 merge | 0.90–1.50 | pending |
| FB overlaps per team-match | 13.9 | pending P4 merge | 11.0–17.0 | pending |
| Wingers coming inside per team-match | 61.9 | pending P4 merge | 52.0–72.0 | pending |
| FB underlaps and inversions per team-match | 36.4 | pending P4 merge | 30.0–43.0 | pending |
| Runs in behind per team-match | 34.6 | pending P4 merge | 29.0–40.0 | pending |
| Runs in behind starting with the ball in a wide lane, share | 0.64 | pending P4 merge | 0.55–0.72 | pending |
| Runs in behind ending beyond the last line, share | 0.26 | pending P4 merge | 0.18–0.34 | pending |
| CM drops into the back line per team-match | 44.7 | pending P4 merge | 38.0–52.0 | pending |
| Drops to receive per team-match (info) | 56.9 | pending P4 merge | — | pending |
| Offsides per match (info) | — | pending P4 merge | — | pending |
| Ball in play, first 15 minutes (info) | 0.62 | pending P4 merge | — | pending |
| Ball in play, minutes 75-90 (info) | 0.43 | pending P4 merge | — | pending |

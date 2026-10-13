# Manager agents: A/B evaluation

Generated 2026-10-13 by `pnpm managers:ab`. Seeds 5000–5119 (120); arms: none, rules, agent; agent model: openai:gpt-6.1-sol; options tested on 20 forks over 10 minutes.

Each seed is one fixture played once per arm. Only the managed team's manager changes between arms; the opponent never has one, and the arms are the same match until the first key moment. The primary metric, declared before the run, is the managed team's xG difference per match (the engine's shot xG). Intervals are 95 %: paired bootstrap (10,000 resamples) for differences, Wilson for win rates.

**The agent manager shows no detectable difference from the rule-based manager: 0.168 xG difference per match (95 % interval -0.092 to 0.440, 120 paired matches).**

## Paired differences

| Comparison | xG difference | Goal difference | Points | Verdict (xG) |
|---|---|---|---|---|
| agent manager − no manager | 0.412 [0.101, 0.739] | 0.292 [0.017, 0.567] | 0.008 [-0.208, 0.225] | better |
| agent manager − rule-based manager | 0.168 [-0.092, 0.440] | 0.133 [-0.158, 0.425] | 0.008 [-0.233, 0.250] | no detectable difference |
| rule-based manager − no manager | 0.245 [-0.026, 0.515] | 0.158 [-0.083, 0.400] | 0.000 [-0.192, 0.200] | no detectable difference |

## Per arm

| Arm | Matches | xG difference | Goal difference | Points per match | Win rate | Draws | Losses |
|---|---|---|---|---|---|---|---|
| no manager | 120 | -0.089 | 0.025 | 1.43 | 42 % [33 %, 51 %] | 21 | 49 |
| rule-based manager | 120 | 0.156 | 0.183 | 1.43 | 38 % [30 %, 47 %] | 33 | 41 |
| agent manager | 120 | 0.323 | 0.317 | 1.43 | 40 % [32 %, 49 %] | 28 | 44 |

## The agent manager's decisions

- 620 decisions (5.17 per match); "no change" picked 50 %.
- Fallbacks: propose 0 %, choose 0 %, service 0 % of decisions.
- Options with orders the engine refused: 0 %. Options that could not be tested: 0 %. Picked the option with the best what-if xG: 58 %.
- Latency: propose p50 12.3 s / p95 16.4 s; choose p50 5.1 s / p95 7.7 s; whole decision p50 49.4 s / p95 58.8 s.
- Tokens per match: 31472.06 in, 1880.98 out. Cost per match: not known (no price configured: TOUCHLINE_PRICE_USD_PER_MTOK).

## The rule-based manager's decisions

- 622 decisions (5.18 per match); "no change" picked 33 %.

# Touchline Build Roadmap

> Index of implementation plans. Each plan produces working, tested software on its own and is written against the real interfaces of the plans before it. **Spec:** `docs/superpowers/specs/2026-10-03-touchline-design.md`.

| # | Plan | Dates (2026) | Delivers | Status |
|---|---|---|---|---|
| 1 | **Simulator engine** — `2026-10-03-plan-1-simulator-engine.md` | Oct 4–7 | Monorepo, deterministic engine, fictional league, domain schema, CDF export validated in CI, CLI | Merged (`d995fec`) |
| 2a | **Calibration and realism** — `2026-10-04-plan-2a-calibration-realism.md` | Oct 4–7 | IDSSE targets, shared Python/TS statistics with parity test, tuner (simulated moments), calibrated params loaded by default, held-out realism report, realism gate | Merged (`fbc3b07`) |
| 2b | **Engine completeness** — `2026-10-04-plan-2b-engine-completeness.md` | Oct 5–6 | Strict CLIs, frame-ordered files, half-time and decision-record fixes, preferred foot, stamina and substitutions, first-touch errors, ground duels, wide play (blocks, keeper claims and punches, headed and sliced clearances, deflections behind), keepers letting balls run out, game-state scoring, IDSSE checksums, recalibration (held-out: corners 8.4/8.1, goal kicks 18.0/17.0) and realism report; all open Plan 1 and 2a minors | Merged (`4420f4e`) |
| 2c | Scenarios, outputs and shot model | Oct 7–11 | **Shot model** with separate block, aim and save steps (fixes shots on target 20 % vs 35 % real; IDSSE splits: 38 % off target, 23 % blocked, 25 % saved, 10 % goals) and recalibration; scenario scripts (nudge/retry/force from checkpoints, built-in scenarios, ≥ 90 % without forcing), ground truth in the run manifest (scripted events, mis-hits, critical errors, tactical truths such as PPDA), SPADL view, realism-noise flag, real-player name blocklist (Wikidata CC0, hashes only); Plan 2b deferred minors | Next |
| 3 | Stats engine, what-if simulation and MCP stats server | Oct 12–14 | Incremental metrics and signals (§5.2) on the domain stream; **match snapshot and what-if re-simulation** (fork the state at a tick, override an intent, decision or tactic, simulate ahead over several seeds, compare outcomes) — the basis for verified "better option" explanations, a positioning advisor and manager agents; independent re-scoring of pass options from tracking (pitch control / xT, MIT-licensed references in `research/repos`); MCP tools for agents | |
| 4 | Agents, A2A gateway and evaluation harness | Oct 12–18 | Agent Framework workflow (six agents), Fact-Checker, A2A server and Effect gateway, ground-truth evaluation harness (§5.3.1) | |
| 5 | API and front end | Oct 14–18 | Effect RPC API and cue bus, fan app (pitch, overlays, profiles, "Why?"), studio console, EN/ES/HI | |
| 6 | Azure, demo and submission | Oct 19–27 | azd + Bicep, Foundry hosted agents, Container Apps, Cosmos DB, tracing, evaluations in Foundry, demo replays, video, submission | |

Notes:
- Wyscout's figshare host is blocked on the current network (corporate proxy); Plan 2 starts with IDSSE (Hugging Face, reachable) and adds Wyscout when downloaded from another network.
- Plans 3–5 can overlap once Plan 1's domain schema (Task 10) exists.
- Agent design input (research, 2026-10-05: `reports/Player agents and simulator references.md`): agents act as managers or unit leads choosing intents at stoppages (clock paused, typed and validated, fallback to the previous plan), every decision logged by tick so matches replay without model calls; learned player control (multi-agent RL) is research-scale and out of scope.

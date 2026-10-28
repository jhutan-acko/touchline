# Touchline for judges

**Demo video (1:53):** https://youtu.be/_2h2AMWYj6g · **Category:** Multi-Agent

This page maps Touchline to each judging criterion and points to the code behind every claim. The overview is in the [README](README.md).

## In one paragraph

TV gives fans a stream and someone else's opinion. Touchline is an insight layer that sits on top of that stream:
- **Live stat tags:** sprint speeds, shot speed and xG, pass difficulty.
- **Match pulse:** momentum and control versus chaos.
- **Follow my player:** a ring, a camera and a live card for your favourite player.
- **Pause and ask the match:** freeze any frame and ask "why didn't he pass?". A team of Microsoft Agent Framework agents answers in English, Spanish or Hindi, with every number fact-checked. The engine re-simulates the alternative 20 times to show what would have happened.

## Technological implementation

| Claim | Where to look |
|---|---|
| A deterministic match engine at 10 frames per second, calibrated to real tracking data | `packages/sim-core`, `packages/calibrate` |
| A test gate that fails if realism drifts | `packages/calibrate/test/realism-gate.test.ts`; report in `docs/realism/realism-report.md` (24 of 26 match statistics within 2 SD of real matches) |
| Typed, streaming API: Effect RPC over WebSocket, with frame-anchored cues, events and Ask | `apps/api/src/session.ts`, `apps/api/src/playback.ts`, `packages/rpc` |
| What-if re-simulation: the engine forks at the paused frame and runs 20 seeds over a 10 s horizon | `apps/api/src/askclip.ts`, `apps/api/src/whatif.ts`, `packages/advisor` |
| Tests | Vitest across 13 TypeScript packages (web 221, api 111, calibrate 44, stats 55, manager 55 and more) and 220 Python tests in `services/agents` |

## Agentic design

| Claim | Where to look |
|---|---|
| The Ask workflow has five distinct stages: question agent (fast model) → what-if re-run → analyst (large model) → rule-based fact-checker → personaliser (fast model) | `services/agents/touchline_agents/question.py`, `analyst.py`, `factchecker.py`, `personalizer.py`, `ask_answer.py` |
| Agents never compute numbers themselves; they read the match only through MCP tools | `packages/mcp-stats` (`get_metric`, `what_if`, `explain_pass`, `verify_claim` and more) |
| The fact-checker gets one retry; any sentence it still can't verify is dropped, never shipped | `services/agents/touchline_agents/factchecker.py`, `workflow.py` |
| Every agent has a deterministic fallback and a timeout, so the stream never stalls | `services/agents/touchline_agents/workflow.py`, `config.py` |
| It's honest by design: when the re-simulations can't separate the two options, the answer is "too close to call", and when the player chose well, it says so | verdicts in `apps/api/src/askclip.ts`; demo moments in `docs/demo/ask-moments.md` |
| Spoiler-free: the agents see nothing after the paused frame | `apps/web/src/pane.ts`, `apps/api/src/askframe.ts` |
| Agent evaluations against scripted ground truth | `uv run --project services/agents touchline-eval suite --suite ci`; results in `docs/evals/` |

## Real-world impact

- Broadcasts already exist; Touchline adds the layer fans actually want: answers to *their* question about *this* moment, not a pundit's opinion.
- Casual fans and analysts get genuinely different experiences: the tags, the player card, the match pulse and the answers all change with the viewer's mode and language.
- The match library is spoiler-free: scores are hidden until the viewer asks for them.
- All data is synthetic; only aggregate statistics from an open dataset (CC-BY 4.0) are used.

## User experience and presentation

- The video above shows all of it, live in the app.
- Watch page: `apps/web/src/Watch.tsx`. Ask panel: `AskPanel.tsx`, `AskSplit.tsx`. Tags: `StatTags.tsx`, `view3d/StatTags3D.tsx`. Player card: `PlayerCard.tsx`. Match pulse: `PulseStrip.tsx`.
- Every string exists in English, Spanish and Hindi: `apps/web/src/i18n.ts`.

## Category: Multi-Agent

The answers depend on several specialised agents. No single agent could produce them:
- The question agent decides *what* is being asked.
- The simulation produces the evidence.
- The analyst interprets the evidence.
- The fact-checker rejects any number that doesn't match the evidence.
- The personaliser rewrites only verified claims for this viewer.

A second team runs alongside them (Moment Detector, Narrator, Recap Producer and the Manager agents). Both teams are exposed over **A2A** (skills `ask`, `moments`, `recap`, `manage`) and built on **Microsoft Agent Framework**.

## Run it

No API key is needed: the default stub model runs offline. See [Quickstart](README.md#quickstart).

## Known gaps

We've stated these openly rather than hidden them. Six statistical engine tests fail on the current calibration and have been left failing rather than loosened; the [README](README.md#known-gaps) lists them. Azure and Microsoft Foundry are not used.

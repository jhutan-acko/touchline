# Pause and Ask: insight viewing design

Date: 2026-10-22. Status: draft for approval. Deadline context: hackathon submission 2026-10-27 23:59 PT; the demo video is recorded 2026-10-25/26, so this feature must be demo-ready by the end of 2026-10-25.

## Intent and why

In real life a fan watches a match as a video stream. The match picture is not where Touchline should innovate. The insights are. The user wants the insight layer to feel like "nobody has done this before", and it has to be practical for something that would sit on top of a normal broadcast.

The idea: **you can pause the match and ask it a question in your own words.** A visible team of agents answers. The answer is proved by re-simulating the moment ("what if he'd passed to the winger?") and showing the alternative as a 3D clip next to what really happened. A second, quieter layer of **smart overlays** sits on the stream itself. These are graphics pinned to players that appear only when the agents judge a moment worth one, and tapping one opens Ask with the question filled in.

Why it scores: it makes the multi-agent design visible and useful (agentic design, category fit "Best Multi-Agent System"). It is the headline moment of the < 2 min video (UX/video). It reuses the engine's what-if, which no commentary product can do (tech, impact).

User decisions so far: lead with "pause and ask" (mockup D), with smart overlays (mockup A) as the layer on the stream. Drop the phone companion (C). The story ribbon (B) is optional, not in this design.

## Goals

1. **Per-viewer pause and Ask panel.** Pausing (button, space key, or tapping an overlay) freezes this viewer's picture at a frame and opens an Ask panel for that frame. Other viewers of the session are unaffected.
2. **Suggested questions.** The panel shows 3–4 question chips built from the frozen frame: the player on the ball, the nearest pressers, the pass options and the latest moment. It also has a free-text box. Questions and answers work in EN, ES and HI, following the viewer's profile language.
3. **Visible agent team answering.** An Ask request runs through agents whose progress the panel shows as stages, each with a short status line:
   - **question agent** (new): turns the question plus the frame into a structured intent, either `explain` (why / who / what is happening) or `what_if` (an alternative action);
   - **analyst**: gathers evidence with the MCP stats tools, and for `what_if` runs the re-simulation;
   - **fact-checker**: checks every number in the draft against the evidence (existing rules, 1 retry);
   - **personaliser**: writes the final answer for the viewer's mode (casual: one or two sentences; analyst: adds numbers) and language.
4. **Answer card.** One headline, 2–4 evidence chips (each a checked number with its source), a "fact-checked ✓" mark, and a **Show me** button when there is a what-if.
5. **Show me.** Opens the existing 3D side-by-side (WhatIfSplit / Stage3D split) with the real moment and the typical re-simulated alternative, plus the counts over seeds (shots, goals, gain).
6. **What-if from any frame**, not only passes the detector flagged. The interventions supported are the ones sim-core already has: `pass_to` (pass to player X) and `move_player` (player X stood at Y). `none` is the baseline arm.
7. **Honest refusals.** If the intent can't be mapped to a supported intervention, the agents can't verify a claim, or the run times out, the answer says so plainly ("I can't re-run a shot yet; here's what the numbers say about the chance"). It never invents.
8. **Smart overlays on the stream** (layer A):
   - cues are frame-anchored, showing between `anchor.frame_from` and `frame_to` in match time; they freeze while paused and do not expire on wall-clock `ttl_ms` while paused;
   - the `pitch_marker` slot is rendered in the 3D view as graphics pinned to players or pitch points: a pass-difficulty arc, a pressure ring with a count, and a ghost marker for a better run or position;
   - density follows the profile, so analyst mode shows more cues and casual mode shows only priority 1;
   - tapping a marker pauses and opens Ask with the matching question pre-filled.
9. **Instant answers for the demo moments.** For a chosen demo match, the suggested-question answers at 3–5 key moments are computed ahead of time with the real model and cached with their what-if clips, so they appear instantly in the video. Typed questions go live, with the stage display, and arrive in seconds.

## Non-goals

- Real video ingestion. The 3D broadcast camera stands in for the TV feed. The design keeps insights as a layer that could sit over any stream, using frame and clock anchors.
- Voice input: a stretch goal only, if everything else is done (browser speech-to-text into the same box).
- Phone or second-screen companion, story ribbon, catch-up recap.
- Timeline seek or scrubbing. Pause, ask and resume only; resume continues from the live position.
- New sim-core intervention kinds (shot, dribble, run overrides). The engine is frozen after P6.
- Multi-turn chat. Each question is answered on its own; follow-ups are new questions on the same frame.

## Anti-goals (failure even if it works)

- An answer that states a number the fact-checker didn't verify, or a what-if presented as proof when the verdict is `not_verified`.
- Ask that blocks or slows the live cue pipeline (moments, recap, manager) or the playback stream.
- A chatbot bolted beside the match: answers must be about the frozen frame, with evidence, not generic football talk.
- Overlay clutter. Casual mode must stay close to a clean broadcast.
- Anything that endangers the submission timeline. If day 3 slips, cut in the order given under Constraints.
- Any change to the engine, the gate or the calibration.

## Constraints

- **Engine frozen.** sim-core is read-only for this work. Use `forkState`, `applyIntervention`, `playAhead` and `Session.stateAt(tick)` as they are. The decide.ts, execute.ts, resolve.ts and shot.ts rule stands.
- **Contracts flow** as today: Effect Schema in `packages/schema` and `packages/rpc/src/contracts.ts`; Python contracts generated by `services/agents/scripts/gen_contracts.py`. New shapes go through the same generator.
- **Agents** follow the existing MAF patterns: an A2A skill on the agent server (`server.py` AgentCard, beside `moments`, `recap` and `manage`), `@stub_responder` for the stub LLM, per-agent timeouts in `config.py`, `TOUCHLINE_LLM` = stub | openai (| foundry once Foundry core lands). The stub must give deterministic, sensible answers so tests and offline demos work.
- **Latency:**
  - the question agent plus the what-if must start returning stage updates within 1 s;
  - a typed question should complete within 10 s with the real model;
  - the what-if worker keeps its existing 10 s timeout (20 seeds, 10–20 s horizon, < 5 s typical);
  - Ask runs off the live budget (250 ms / 4 s), on its own path.
- **i18n:** EN, ES and HI strings go in `i18n.ts`, with template fallbacks as the existing personaliser does.
- **CPU rule:** implementers run only their own tests, single-threaded; the controller runs the full suite once per merge.
- **Data rules:** never commit data/raw; demo caches are derived from simulated matches only.
- **Cut order if time runs short:** voice (already a stretch) → `move_player` what-ifs (keep `pass_to`) → player-pinned overlay graphics (keep frame-anchored cues) → live typed questions on the real model (fall back to suggested chips only, still live through the agents).

## What the user decided

- Lead with pause-and-ask; overlays as the stream layer; no phone companion; no story ribbon.
- Insights must suit a real, practical setting where the match is a plain video stream.
- **No spoilers.** The real side of Show me plays only up to the frame where the viewer paused. The alternative side plays on from the fork for the full horizon. The re-simulation itself may run to the full horizon so the counts are honest; only the real frames shown, and any real-match facts in the answer, stop at the paused frame. Ask and its agents never state anything that happened after the paused frame. The existing `known(at_frame)` rule in mcp-stats is the model: `at_frame` = the paused frame.
- **Mixed models for speed.**
  - The question agent and the personaliser use the small model (gpt-5.4-mini; its config key sits beside the main model's).
  - The fact-checker stays rule-based.
  - Only the analyst uses gpt-6.1-sol.
  - The target is a typed question answered in about 6–10 s, with the stage display running throughout.
  - Under the stub LLM all stages are deterministic.

## Calls I made (the user can override)

- Input is suggested chips plus typed text; voice is a stretch.
- The 3D broadcast camera stands in for the TV feed.
- Demo moments are pre-computed and cached; typed questions are live with a visible "agents working" stage display.
- The question agent is a new agent rather than an analyst prompt change, so the team grows visibly (detect → analyse → narrate → fact-check → personalise, plus **ask**).
- Pause becomes per-viewer on the client: the client buffers frames and freezes its own picture while the server stream continues. The server-side shared `Control` pause stays as it is for the studio.
- Ask streams its stage updates (an Effect RPC stream), like `Watch`, so the panel can show the agents working.
- When the question names no player, it defaults to the player on the ball at the frozen frame.
- **The API runs the re-simulation, and that is the only place it runs.** `whatIfAt` in the API, on the existing worker, produces the clip and its counts. The analyst receives those numbers as evidence and does not call the MCP `what_if` tool for Ask. This avoids running 20 seeds twice and guarantees the answer's numbers match the counts under the Show me clip.
- **Verdict rule for any what-if:** reuse `packages/advisor/src/verdict.ts` unchanged: at least the minimum seeds, at least the minimum gain, and the t-test margin, with `comparisons = 1`, comparing the alternative against the action actually played (the `none` arm) over the same seeds. The outcomes are `better_option_found` / `played_pass_was_best` (read as "what he did was as good or better") / `not_verified`. Show me is offered for all three, but only `better_option_found` is worded as "the alternative was better", and `not_verified` is labelled "too close to call".
- **Ask works on any session**, live or replayed library match. The API starts the session's mcp-stats server lazily on the first Ask, using the same lifecycle `live.ts` uses, and stops it with the session. If the agent service is unreachable, Ask returns a clear "the analysts are offline" error. There is no silent template answer.
- **Demo match and moments:** the builder proposes a match and 3–5 candidate moments from the rebuilt library. The user picks the final set when the video script is written (2026-10-25).

## Shape of the pieces (guidance, not prescription)

- **Contracts:**
  - `Ask` RPC: payload `{ session_id, frame, question, chip_id?, mode, lang }`; streams `AskUpdate` = stage (`question` | `analyst` | `whatif` | `factcheck` | `personalise`, with status text) | answer (`AskAnswer`) | error;
  - `AskAnswer`: headline, body, evidence chips (label, value, source), verified flag, optional `what_if` (a generalised clip reference);
  - `SuggestQuestions` RPC (or chips derived client-side from the frame plus cues): returns chips with ids and pre-filled text in the viewer's language.
- **Generalised what-if:** an API-side function `whatIfAt(session, frame, intervention)` that returns a clip shaped like `WhatIfClip`. It can be a new `AnyWhatIfClip` (intervention description, real frames, variant frames, counts, gain, verdict), or `WhatIfClip` widened carefully so the existing GetWhatIf and WhatIfSplit keep working. The builder chooses. It reuses the existing worker and timeout.
- **Agents:**
  - a `question` agent turns `(question, frame summary: players, ball holder, pass options, recent events)` into intent JSON;
  - the analyst gets an `ask` entry point that uses the MCP stats tools (`what_if`, `explain_pass`, `suggest_position` in `mcp-stats` advise.ts) plus the stats tools;
  - the fact-checker and personaliser are reused;
  - a new A2A skill `ask` is added;
  - the API calls it the way it calls `manage`.
- **Web:**
  - `AskPanel.tsx` (chips, text box, stage display, answer card, Show me);
  - client-side per-viewer pause in `Watch.tsx` and `Live3D.tsx`;
  - a `PitchMarkers` layer in the 3D view rendering `pitch_marker` cues pinned to player ids or points from `cue.data`;
  - Overlays.tsx moves from wall-clock ttl to match-frame anchoring.
- **Detector and personaliser** emit `pitch_marker` cues for pressure, pass difficulty and better-option ghosts, with `data` carrying the player ids and coordinates. Density is by mode.
- **Demo cache:** a script runs Ask for chosen `(match, frame, chip)` triples with the real model and writes the answers plus clips into the library. The API serves a cached answer when the triple matches. Stage updates still replay quickly, so the team stays visible.

## Success looks like

- In the video: pause at a key moment, tap "Why didn't he pass to the winger?", watch four agent stages tick through, read a fact-checked answer, hit Show me and see the alternative play out side by side. All of it in about 20 seconds of screen time.
- A typed question in Hindi or Spanish gets a correct, checked answer in that language.
- An unanswerable question gets an honest "can't verify" answer.
- Casual mode looks almost like a clean broadcast, and analyst mode shows pinned overlays.
- The full suite, the agent pytests and typecheck are green. No engine files change.

## Left to the builder

- The exact schema names and whether to widen `WhatIfClip` or add a sibling.
- Where suggestion chips are generated (client or API) and their wording.
- The 3D marker visuals (arc, ring, ghost), within the existing R3F scene style.
- How the frame summary given to the question agent is built and sized.
- Prompt wording; the stub responses.
- Task split and parallel waves.

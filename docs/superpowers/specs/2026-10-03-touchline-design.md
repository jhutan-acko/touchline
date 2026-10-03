# Touchline — System Design Spec

- **Date:** 2026-10-03
- **Status:** Draft for review
- **Author:** Jhutan Debnath, with Claude Code
- **Visual companion:** https://claude.ai/artifact/TzdUVSecKaHafvjkpT4XWS (private design page; this spec is authoritative where they differ)

## 1. Context

Entry for Microsoft's **Inside the Game: Developer Hackathon**, challenge **"The Synthetic Match Insights Engine for Premier League Studio"**: an AI insights engine on Azure that explains the game beyond the stats, turning football events into real-time insights, key narratives and recaps, personalized for every fan, for studio and streaming use.

| Item | Value |
|---|---|
| Build window | 2026-10-06 09:00 PT – 2026-10-27 23:59 PT (projects may be created any time after 2026-09-29) |
| Judging | 2026-10-27 – 2026-11-10. The demo link must stay up and free for that whole period |
| Team | Solo developer + Claude Code |
| Target prizes | Grand Prize + **Best Multi-Agent Orchestration** |
| Deliverables | Public GitHub repo, demo video under 2 minutes (YouTube/Vimeo), project pitch, working demo link |
| Judging criteria | 20% each: technical implementation, agentic design, real-world impact, UX and presentation, category fit |

### Hard constraints

1. **Synthetic data only.** No real Premier League match data in the repo, app or video.
2. **No third-party trademarks or copyrighted material in the video.** Fictional league, clubs, crests, kits and players throughout, and generated player names are checked against real players.
3. **Licences.** No AGPL or GPL code in the repo. Open datasets (Wyscout CC-BY 4.0, IDSSE CC-BY 4.0) are used for offline calibration only; raw data is git-ignored and only fitted parameters are committed, with attribution in the README. StatsBomb data is not used.
4. **Everything in English** in submission materials.

## 2. Goals and success criteria

The product turns a live stream of synthetic match events into grounded, explainable insights, renders them as timed overlays, and reshapes the same intelligence for each audience.

Success means all of the following hold in the deployed demo:

1. A full 90-minute synthetic match replays end to end (at 1× or accelerated) with no manual steps.
2. **Zero ungrounded numbers reach the screen.** Every number in published text traces to a metric value in the state store.
3. Analyst and casual views of the same moment differ in content, depth and tone, not only in wording.
4. Output works in **English, Spanish and Hindi**.
5. Stats overlay latency is under **250 ms** from event; AI insight latency is under **4 s** from signal (p95 for each, measured).
6. The system is deployed on Azure, with the agents running on Microsoft Foundry and their traces visible.

### Non-goals

- Real broadcast video, real teams or real players.
- Per-user (rather than per-segment) LLM generation.
- User accounts or authentication. Profiles are client-side presets plus a custom builder.
- Betting, odds or win-probability products.
- Mobile-native apps. The web app is responsive.

## 3. Challenge coverage

| Brief | Requirement | Met by | Tier |
|---|---|---|---|
| (i)(a) | Ingest events as they happen | Simulator → event bus, CDF-style JSON Lines | Must |
| (i)(b) | Interpret into stats and patterns | Stats engine and signals | Must |
| (i)(c) | Explain why moments matter | Moment Detector, Tactical Analyst, Fact-Checker | Must |
| (i)(d) | Render alongside the match | Overlay cue contract, fan app, studio console | Must |
| (i)(e) | Personalize (mode, clubs, player focus, metric, language) | Profile segments + Personalizer | Must |
| (ii) | Player identification, speed and distance alerts | `pitch_marker` cues, threshold alerts | Must |
| (ii) | Pass distance, accuracy, difficulty | `pass.dist`, `pass.acc`, `pass.xp` | Must |
| (ii) | Ball and shot speed | `ball.speed`, `shot.speed` | Must |
| (ii) | Auto-eventing from video | CV on video rendered from our simulator | Stretch |
| (iii) | Narratives, player context, milestones, recaps | Narrator, Recap Producer, milestone checks | Must |
| (iv) | Control vs chaos, pressure, rhythm | `game.chaos`, `team.press`, `ppda`, `team.mom` | Must |
| (v) | Synthetic dataset creation | Calibrated simulator, published dataset + schema | Must |
| (vi) | Multi-language storytelling | Native generation in EN / ES / HI | Must |

## 4. Architecture

```
            ┌──────────── TypeScript + Effect (apps/api process) ─────────────┐
Simulator ─▶│ Event bus ─▶ Stats engine ─▶ State store (Cosmos DB)             │
(packages/  │                   │ signals            ▲                         │
 sim)       │                   ▼                    │ MCP tools               │
Replay ────▶│            Agent gateway ──A2A──▶ ┌────┴─────────────────────┐   │
files       │                   ▲               │ Python · Agent Framework │   │
            │                   └────A2A────────│ workflow on Foundry      │   │
            │                       insight cues└──────────────────────────┘   │
            │ Cue bus ──▶ Effect RPC + WebSocket ─────────────────────────────▶│──▶ Fan app / Studio console
            └─────────────────────────────────────────────────────────────────┘
```

Two paths:

- **Hot path (deterministic):** event → stats → stats cues → clients. No model calls. Budget: 250 ms.
- **Agent path (asynchronous):** signal → agent workflow → verified, personalized insight cues → clients. Every cue binds to the `frame_id` range it describes, so a slow model makes an insight late, never mismatched to the action. Budget: 4 s.

### 4.1 Language split

- **TypeScript + Effect:** everything real-time — simulator, event bus, stats engine, API, RPC, cue bus, MCP server — plus the React front end.
- **Python:**
  - `services/agents`: Microsoft Agent Framework has no TypeScript SDK (it ships for Python and .NET).
  - `python/analytics`: offline calibration with kloppy and socceraction.
- **Boundaries are protocols, never shared code.**

| From → to | Protocol |
|---|---|
| Web ↔ API | Effect RPC over HTTP; WebSocket stream for cues |
| API ↔ sim / stats | In-process Effect services (Layers); split into processes only if needed |
| API → agents | A2A (JSON-RPC 2.0): submit a moment task, stream back cue artifacts |
| Agents → stats | MCP (TypeScript MCP server): read-only tools over the state store |
| Analytics → runtime | Versioned JSON artifacts in `data/params/` (fitted distributions, xT grid, xPass coefficients) |
| Shared types | Effect Schema in `packages/schema` → JSON Schema → generated Pydantic models in `services/agents` |

### 4.2 Monorepo layout

```
touchline/
├─ apps/
│  ├─ web/            React + Vite: fan app, studio console
│  └─ api/            Effect platform server: RPC, cue bus, agent gateway
├─ packages/
│  ├─ schema/         Effect Schema: Event, MatchState, Signal, Moment, Claim, Cue, Profile
│  ├─ sim/            simulator + fictional league generator
│  ├─ stats/          stats engine on Effect Stream
│  ├─ rpc/            Effect RPC contracts (shared client/server)
│  └─ mcp-stats/      MCP server exposing stats tools
├─ services/
│  └─ agents/         Python (uv): Agent Framework workflow, A2A server
├─ python/
│  └─ analytics/      Python (uv): calibration + model fitting, offline only
├─ data/
│  ├─ params/         committed fitted parameters (JSON)
│  ├─ matches/        committed synthetic replay files (JSONL)
│  └─ raw/            git-ignored real open datasets
├─ infra/             Bicep + azure.yaml (azd)
└─ docs/
```

Tooling:
- **TypeScript:** pnpm workspaces + Turborepo.
- **Python:** uv workspace.
- **Tests:** `@effect/vitest` and pytest.
- **CI:** GitHub Actions.
- **Deploy:** `azd up`.
- **Local dev:** a single `pnpm dev` runs the whole stack.

## 5. Components

### 5.1 Simulator (`packages/sim`)

- **Fictional league:** 8 invented clubs. Each has a style profile (press-heavy, possession, direct, low-block) that adjusts the simulator's parameters, and generated squads with role, attributes and form. A name generator checks every name against a real-player blocklist. The league ships with its own crests and colours, generated as SVG.
- **Match model:** possession chains as a Markov process over states (zone × phase × pressure). Action choice, pass length and angle, success probability and shot locations are sampled from distributions in `data/params/`.
- **Physics:** a simple ball model gives speed and flight time. Players are positioned with steering behaviours (max speed about 9–10 m/s, capped acceleration) and output at **10 Hz** for speed and distance metrics. 25 Hz tracking is a stretch goal.
- **Scenarios:** seeded and scriptable — `late_comeback`, `red_card_collapse`, `keeper_heroics`, `even_contest` — so demos are reproducible and dramatic.
- **Output:** a stream of `Event` (schema below) plus optional `TrackingFrame`, each with a monotonically increasing `frame_id`. The same stream can be written to JSONL as a replay file.

Event example (CDF-style JSON Lines):

```json
{"event_id":"m042-e1187","match_id":"m042","frame_id":40213,"clock":"67:02","period":2,
 "type":"pass","team":"ironmoor","player":"p-ir-08","receiver":"p-ir-10",
 "start":[61.2,22.4],"end":[88.5,30.1],"outcome":"complete",
 "under_pressure":true,"defenders_in_lane":2,"ball_speed_kmh":71.4,"body_part":"right_foot"}
```

Event types: `match_start`, `lineup`, `kickoff`, `pass`, `carry`, `shot`, `tackle`, `interception`, `pressure`, `possession_change`, `foul`, `card`, `substitution`, `set_piece`, `goal`, `period_end`, `match_end`.

### 5.2 Stats engine (`packages/stats`)

Incremental, deterministic and unit-tested. It consumes `Event`/`TrackingFrame` and maintains `MatchState`. It emits `Signal`s when thresholds are crossed. Every metric has a stable ID that agents must cite.

| ID | Metric | Method | Tier |
|---|---|---|---|
| `pass.dist`, `pass.acc` | Pass distance, accuracy | Geometry; rolling completion per player/team | Must |
| `pass.xp` | Pass difficulty (xPass) | Logistic model: distance, angle, defenders in lane, pressure | Must |
| `ball.speed`, `shot.speed` | Ball and shot speed | From simulator ball physics | Must |
| `plyr.vmax`, `plyr.dist` | Sprint speed, distance | From 10 Hz positions; alert at > 30 km/h and at distance milestones | Must |
| `shot.xg` | xG | Distance, angle, body part, defenders in shot cone | Must |
| `team.mom` | Momentum | Exponentially decayed threat over the last 5 min | Must |
| `team.press`, `ppda`, `tilt` | Pressure index, PPDA, field tilt | Standard definitions | Must |
| `game.chaos` | Control vs chaos index | Chain length, turnover rate, momentum volatility | Must |
| `act.xt` | Expected threat | 12×8 grid fitted offline with socceraction | Should |
| `pitch.ctrl` | Pitch control | Spearman model; needs 25 Hz tracking | Stretch |

Signal types (initial): `goal`, `big_chance`, `pressure_shift`, `momentum_swing`, `chaos_spike`, `speed_alert`, `distance_milestone`, `difficult_pass_completed`, `player_milestone`, `card`, `substitution_impact`.

### 5.3 Agent workflow (`services/agents`)

A Microsoft Agent Framework graph workflow, deployed as Foundry hosted agents and exposed over A2A. All agents read state only through the MCP stats tools; **no agent computes a statistic.**

| Agent | Job | Output | Model tier | Fallback |
|---|---|---|---|---|
| Moment Detector | Ranks signals and promotes moments; applies cooldowns | `Moment` | small | Rule-based salience score |
| Tactical Analyst | Explains why: control vs chaos, pressure shift, rhythm | `Claim[]` with evidence refs | larger | Template explanation per signal type |
| Narrator | Turns claims into headline, one-liner, context, milestones | Draft narrative | small | Headline-only template |
| Fact-Checker | Checks every number, name and comparison against the state store | Verdict + reasons | small + code checks | One retry, then drop unverified sentences |
| Personalizer | Reshapes a verified cue per profile segment and language | Cue variants | small | Default English variant |
| Recap Producer | Half-time and full-time recaps, turning points, player of the match | Recap document + cards | larger | Stats-only recap |

Flow per moment:
1. A signal arrives over A2A.
2. The Moment Detector promotes it to a moment.
3. The Analyst produces claims, using the MCP tools.
4. The Narrator drafts the text.
5. The Fact-Checker checks the draft, with at most one retry.
6. The Personalizer fans out across the active segments.
7. Verified cues stream back over A2A.
8. Workflow state checkpoints to Cosmos DB.

**Fact-Checker mechanics:** the Narrator outputs text plus a structured list of the claims it contains (value, metric ID, frame range). Code checks each claimed value against the store within a tolerance. The model is used only to extract claims the Narrator failed to declare. Any sentence with an unverified number is removed. Fact-check results (pass, retry, drop) are logged as trace attributes and counted on the ops view.

**Model choice:** a small, fast Foundry model for the live agents and a larger reasoning model for the Analyst and recaps. Exact models are picked from the Foundry catalog at build time, behind one config file.

### 5.4 Overlay cue contract (`packages/schema`)

```json
{"cue_id":"m042-c0311","schema":"touchline.cue/1","match_id":"m042",
 "anchor":{"frame_from":39880,"frame_to":40213,"clock":"67:02"},
 "display":{"slot":"lower_third","priority":2,"ttl_ms":8000,"template":"pressure_shift"},
 "segment":{"mode":"casual","lang":"en","club":"ironmoor"},
 "text":{"headline":"Ironmoor turn the screw","body":"They've won the ball back 6 times in Kestrel Bay's half since the hour mark."},
 "data":{"team.press":0.71,"team.press.delta5":0.38,"recoveries.opp_half.since_60":6},
 "evidence":["team.press@39880-40213","m042-e1102","m042-e1150"],"verified":true}
```

- **Slots:**
  - `top_bar`: score, clock, momentum.
  - `lower_third`: moments.
  - `side_panel`: analyst depth.
  - `pitch_marker`: name tags, speed alerts.
  - `recap_card`.
- **Stats cues** from the hot path use the same contract with `verified: true` and no `text`, or templated text.
- **Version field:** the schema is versioned (`touchline.cue/1`), so a third-party graphics renderer can consume it.

### 5.5 Personalization

- **Profile fields:**
  - `mode`: `casual` | `analyst`.
  - `clubs[]`.
  - `player?`: player focus mode follows one player all match.
  - `focus_metric?`: a single performance metric.
  - `lang`: `en` | `es` | `hi`.
- **Segments:** profiles collapse to segment keys, so generation scales with segments, not users. Each match runs at most 12 active segments; variants are cached by `(moment_id, segment_key)`.
- **Behaviour by mode:**
  - **Casual:** short, emotional, club-framed; at most one number.
  - **Analyst:** numbers first, side panel, comparisons, evidence chips.
  - **Player focus:** pitch marker on the player; moments involving them are boosted.
  - **Metric focus:** a persistent widget plus moments that involve that metric.
- **Language:** text is generated natively in the target language, not translated afterwards. Azure AI Translator is used only as a terminology check, and only if needed.

### 5.6 Front end (`apps/web`)

- **Fan app:**
  - 2D pitch on canvas, replaying the simulated match from events/tracking.
  - Overlay layer driven by cues.
  - Profile switcher and custom builder.
  - "Why?" drawer showing evidence (metric values, mini chart, linked events).
  - Recap page.
- **Studio console:** cue queue for a producer (approve, hold, send to graphics), presenter talking points, raw cue feed view.
- **Demo mode:** split-screen of two profiles on the same match.
- **Ops view:** agent traces summary, fact-check pass/retry/drop counts, latency percentiles.

### 5.7 API (`apps/api`)

- **Effect platform server.**
- **RPC endpoints:**
  - `listMatches`, `startMatch(scenario, seed, speed)`
  - `subscribeCues(matchId, segment)` (stream)
  - `getRecap(matchId)`, `getEvidence(cueId)`
  - `studio.approve` / `studio.hold`
- **Agent gateway:** an A2A client with timeout, retry and circuit breaker, all as Effect policies. When the circuit is open, the hot path continues and template cues fill in.

## 6. Error handling and resilience

- **Every agent has a deterministic fallback** (table in 5.3), so the match never goes silent.
- **Timeouts:** each agent call has a timeout; the gateway enforces the 4 s end-to-end budget and drops late cues whose `ttl` has expired.
- **Checkpointing:** workflow state checkpoints to Cosmos DB; a restarted agent service resumes in-flight moments.
- **Cached replay mode:** a recorded match replays with its stored agent outputs, so the judges' link works even if model quota runs out. A "live" toggle re-runs the agents.
- **Typed errors:** Effect's typed errors across the TypeScript services; schema validation at every protocol boundary (RPC, A2A, MCP, file artifacts).

## 7. Testing

- **Simulator:**
  - Seeded determinism tests (same seed → identical stream).
  - Distribution tests against fitted params (pass length, completion rate, shots per match within tolerance).
  - Formation sanity checks.
- **Stats engine:** unit tests per metric on hand-built event sequences; golden-file tests on committed replays.
- **Contracts:** round-trip tests between Effect Schema and the generated Pydantic models; cue contract fixtures.
- **Agents:**
  - Fallback paths tested with a stubbed model.
  - Fact-Checker tested on seeded hallucinations, which must be caught.
  - A Foundry evaluation run on grounding and on the analyst/casual difference.
- **End to end:** a replay of a committed match through the full stack in CI with a stub model, asserting latency budgets and zero unverified cues.

## 8. Azure deployment

| Service | Role | Tier | Rough cost |
|---|---|---|---|
| Microsoft Foundry | Models, hosted agents, tracing, evaluations | Must | $10–40 tokens |
| Azure Container Apps | api, web, agents, mcp-stats; scale to zero | Must | $0–15 |
| Azure Cosmos DB (serverless) | State, checkpoints, cues | Must | $1–5 |
| Application Insights | Telemetry | Must | ~$0 |
| Azure Event Hubs | Ingest at scale | Should | ~$10 |
| Azure SignalR Service (Standard) | Client fan-out (Free tier too small) | Should | ~$1.60/day |
| Azure AI Speech | Voice commentator | Stretch | < $5 |
| Fabric Real-Time Intelligence | KQL analyst store | Stretch | trial |

These costs are planning estimates to verify against current pricing. Infrastructure is defined in Bicep and deployed with `azd`. The Azure subscription is not yet confirmed (a support email asking about credits has been sent). The build is local-first, with model access behind one interface, so Azure is needed only from the week of 2026-10-19.

## 9. Scope tiers

- **Must:**
  - Simulator and fictional league, plus replay files.
  - Stats engine with all Must metrics.
  - Six-agent workflow with the Fact-Checker and fallbacks.
  - A2A gateway and MCP stats server.
  - Cue contract.
  - Fan app with 2D pitch, overlays, profiles and the "Why?" drawer.
  - Studio console.
  - EN/ES/HI.
  - Recaps.
  - Azure deployment, tracing, README, demo video.
- **Should:** xT; Event Hubs ingest; SignalR fan-out; Foundry evaluation run; ops view.
- **Stretch:** 25 Hz tracking + pitch control; voice commentator; CV auto-eventing on rendered video with measured error; Fabric analyst store.

**Rule:** no Stretch work starts before the week-3 checkpoint passes.

## 10. Timeline

| Dates | Focus | Checkpoint |
|---|---|---|
| 10-04 – 10-11 | Monorepo, schema, league, simulator, replay files, stats engine, basic live-stats view | A full match replays with live stats on screen |
| 10-12 – 10-18 | Agent workflow, Fact-Checker, A2A, MCP, cue bus, fan app overlays, profiles, EN/ES/HI, recaps | Analyst vs casual working locally |
| 10-19 – 10-24 | Azure via azd, Foundry hosted agents, tracing, evaluations, Should items; Reactor session 10-21 | Public link works end to end |
| 10-25 – 10-27 | Demo script, 2-minute video, README, pitch; submit by 10-26 | Submitted |

## 11. Risks

| Risk | Mitigation |
|---|---|
| No Azure access in time | Local-first build; model access behind one interface; start a trial or pay-as-you-go by 10-19 |
| Solo scope creep | Strict tiers and weekly checkpoints |
| Cross-language complexity (TS ↔ Python) | Only two narrow protocols (A2A, MCP); generated types; contract tests |
| LLM latency or quota in the demo | Cached replay mode; small models live; fallbacks |
| Ungrounded numbers | Fact-Checker gate + grounding evaluation |
| Trademark or licence issues | Fictional everything; no AGPL/GPL; raw data git-ignored |
| Platform claims drift (MAF/Foundry/A2A versions) | Pin versions in week 1; verify Foundry hosted-agent and A2A support before building on them |

## 12. Open items

- Azure subscription source and start date (awaiting reply from hackathon support).
- Exact Foundry model choices: pick at build time from the catalog.
- Name: "Touchline" is also a commercial heating-control brand (Roth Touchline). Repo name `touchline-match-intelligence` avoids confusion; the product name in the UI stays "Touchline".

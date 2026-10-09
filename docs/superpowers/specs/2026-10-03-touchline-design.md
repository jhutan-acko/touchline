# Touchline — System Design Spec

- **Date:** 2026-10-03
- **Status:** Draft for review
- **Author:** Jhutan Debnath, with Claude Code
- **Visual companions:** system design https://claude.ai/artifact/TzdUVSecKaHafvjkpT4XWS · simulator design https://claude.ai/artifact/FC9YH2kcGFr8tPchooBmpF (private design pages; this spec is authoritative where they differ)
- **Research:** `../reports/Football match data simulators.md` (outside this repo, 2026-10-03)
- **Revision:** 2026-10-03 r7 — decision record (§5.1.4): options, best option, chosen rank, action probabilities; frames carry each player's speed and intent; `off_ball_run` events (§5.1.9–5.1.10)

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
3. **Licences and calibration data.**
   - No AGPL or GPL code in the repo; GPL projects (e.g., openfootmanager) are read for ideas only.
   - Simulator parameters are fitted offline on **IDSSE / Sportec Open DFL (CC-BY 4.0)** and the **Wyscout public dataset (CC BY 4.0) with all England files excluded**. Raw files live in git-ignored `data/raw/`; only aggregate parameter tables are committed. Each table records its source dataset, licence and attribution.
   - **No committed parameter is fitted on StatsBomb Open Data.** Its terms require the StatsBomb logo on anything "based on" the data. IMPECT, PFF and Metrica are also excluded on licence grounds.
   - Code adapted from MIT/Apache-2.0 projects (tbleckert/football-simulator, ZOXEXIVO/open-football) is credited in `ATTRIBUTION.md`.
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

### 2.1 Innovation: what existing solutions don't provide

The research (2026-10-03) found the separate capabilities scattered across broadcast products, open-source tools and papers, but never combined. Three of them don't exist publicly at all. Ranked by novelty:

1. **AI insights scored against known truth.**
   - **Gap:** on real broadcasts the true cause of a moment is unknown, so AI commentary and insight systems can't be scored on whether their explanations are *correct*. Published commentary research (MatchVoice, StreamSoccer) struggles with invented facts and misaligned timestamps.
   - **Touchline:** we script tactical causes ("Ironmoor raise their press at 60'"; "red card at 55'"), then score whether the agents detected the moment, explained it correctly and cited the right metrics (§5.3.1). The same ground truth scores video auto-eventing (§5.8). Synthetic data becomes the test bench for the AI, not just a stand-in for real data.
2. **An open, calibrated, scriptable match generator in the standard format.**
   - **Gap:**
     - No open engine emits CDF events plus tracking, and kloppy has no CDF exporter yet.
     - The best generative models predict only a few seconds of play, with no public weights.
     - Event-model papers don't compare whole-match statistics with real matches, so there is no standard realism benchmark.
   - **Touchline:** seeded, reproducible 11v11 matches with exact event-to-tracking sync and the true model values (xG, xPass) attached, validated against the CDF v0.3.2 schema. A published realism report compares them with IDSSE and Wyscout (§5.1.8).
3. **Every on-screen number is verified, and its evidence is one tap away.**
   - **Gap:** to our knowledge, shipped products (Bundesliga Match Facts, Prime Video Prime Insights, IBM watsonx commentary) show stats or generated text without exposing the evidence behind each claim to the viewer.
   - **Touchline:**
     - A Fact-Checker blocks any number that isn't in the state store.
     - The fan's "Why?" view shows the metric values, frame range and events behind each claim.
     - Explanation frames (control vs chaos, pressure shift, rhythm) are computed metrics, not model guesses.
4. **One verified insight, many audiences.**
   - **Gap:** broadcasters offer a main feed, or at most one analyst alt-stream.
   - **Touchline:** each verified moment is reshaped per fan segment — mode, clubs, player focus, single focus metric and language (EN/ES/HI), generated natively. A producer console keeps a human approving cues before they air.
5. **A frame-anchored, versioned overlay format.**
   - **Gap:** we found no open format for timed AI insights that a broadcast graphics system can render.
   - **Touchline:** `touchline.cue/1` ties each insight to the frame range it describes, so a slow model makes an insight late, never wrong.

**Not claimed as innovation** (good execution, not new): using Agent Framework, MCP and A2A; Azure deployment; multilingual generation; standard metrics (xG, PPDA, xT).

**Pitch line:** *"Touchline is the first match-intelligence engine that can prove its AI is right. Because we generate the match, we know the truth behind every moment and score our agents against it, so fans only ever see insights that are checked, explained, and made for them."* Competitor statements rely on public material, so the pitch says "to our knowledge".

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
│  ├─ sim-core/       simulator: pure, synchronous step function (no Effect inside)
│  ├─ sim/            Effect wrapper: streams, pacing, CDF/SPADL writers, CLI
│  ├─ league/         fictional league, squads, styles, crests
│  ├─ stats/          stats engine on Effect Stream
│  ├─ rpc/            Effect RPC contracts (shared client/server)
│  └─ mcp-stats/      MCP server exposing stats tools
├─ services/
│  ├─ agents/         Python (uv): Agent Framework workflow, A2A server
│  └─ vision/         Python (uv): stretch — renderer, detection/tracking, scoring
├─ python/
│  └─ analytics/      Python (uv): calibration + model fitting, offline only
├─ data/
│  ├─ params/         committed fitted parameters (JSON, with provenance header)
│  ├─ matches/        committed synthetic replay files (JSONL)
│  └─ raw/            git-ignored real open datasets
├─ infra/             Bicep + azure.yaml (azd)
└─ docs/
```

Tooling:
- **TypeScript:** pnpm workspaces + Turborepo.
- **Python:** uv workspace.
- **Tests:** `@effect/vitest` and pytest.
- **CI:** GitHub Actions, including CDF validation (`common-data-format-validator`, `mode="extreme"`) of simulator output.
- **Deploy:** `azd up`.
- **Local dev:** a single `pnpm dev` runs the whole stack.

## 5. Components

### 5.1 Simulator (`packages/sim-core`, `packages/sim`, `packages/league`)

No open engine or published model gives us a seeded, scriptable 11v11 match that emits CDF events plus 10 Hz tracking (research report, 2026-10-03). We build our own two-layer engine:
- a **statistical decision layer** decides *what* happens;
- a **kinematic layer** at 10 Hz decides *where* everyone is.

Design references:
- **tbleckert/football-simulator** (TypeScript, MIT): event taxonomy, restart phase machine, intents with durations, possession context, injectable RNG.
- **ZOXEXIVO/open-football** (Rust, Apache-2.0): separating the engine tick from the recording rate, constant-bearing interception, 3D ball physics, per-match plausibility bands.

#### 5.1.1 Requirements

1. **Deterministic.** The same `(seed, home, away, script, params version)` produces byte-identical `event.jsonl` and `tracking.jsonl`, whether run paced or unpaced.
2. **Fast.** A 90-minute match (about 54,000 frames) simulates unpaced in under 30 s on a laptop, and replays paced at 1×–20×.
3. **Realistic.** Calibration bands (§5.1.8) pass across 50+ seeds.
4. **Scriptable.** Scenario scripts achieve their target in ≥ 90 % of seeds without forcing an outcome.
5. **Standard output.** CDF v0.3.2 files that pass `common-data-format-validator` in `extreme` mode, plus a live domain stream for the stats engine.

#### 5.1.2 Coordinates and time

- **Pitch:** 105 × 68 m, metres, origin at the centre spot.
- **Direction:** CDF orientation is used internally too — **the home team attacks +x for the whole match**. The front end may mirror the second half for display.
- **Frames:** a fixed tick, by default **0.1 s**, so one tick is one tracking frame (`fps = 10`). `frame_id` restarts at 0 each period, as CDF requires.
- **Render runs:** `--fps 25` runs the same engine at 0.04 s for video rendering (§5.8). Because probabilities are per action or per second, the football is statistically the same at any tick. Determinism holds per `(seed, …, fps)`.
- **Ball sub-steps:** the ball takes 2–5 sub-steps per tick.
- **Timestamps:** synthetic UTC derived from the match's `kickoff_time`. `match_clock` follows the CDF convention (`MM:SS.mm`, resetting to 45:00.00 at the second half).
- **Added time:** sampled per half from fitted distributions.

#### 5.1.3 State and step

`packages/sim-core` exposes one pure function, `step(state: MatchState, params: Params): StepResult`. `StepResult` holds `state`, `frame` and `events[]`. Nothing in the step touches Effect, I/O or wall-clock time.

```
MatchState {
  clock { period, frameId, matchClockMs }, phase: MatchPhase,
  ball { x, y, z, vx, vy, vz },
  possession: Owned{playerId} | InFlight{action, from, target, eta} | Loose,
  players[22] { id, team, role, pos, vel, intent, intentUntil, stamina, cards },
  score, cards, subsRemaining, script: ScriptState, rng: RngState
}
```

Each step runs, in order:
1. **Clock and periods.**
2. **Phase machine:** `kickoff | open_play | throw_in | corner | goal_kick | free_kick | penalty | goal_celebration | half_time | full_time`. Restart delays are sampled from fitted distributions (corner about 37 s, goal kick about 30 s, throw-in about 18 s).
3. **Team shape:** each role has an anchor from the formation. Anchors shift with the ball's position, and the team's style sets line height, compactness and width.
4. **Decision layer:** runs only for players whose intent has expired, or on possession events. Details in §5.1.4.
5. **Kinematics:**
   - Reynolds steering behaviours: arrive, pursue and separation.
   - Speed is capped at about 9 m/s for elite sprints and acceleration at about 4–5 m/s², both per player attributes and stamina.
   - Ball chasers use **constant-bearing interception**, not simple pursuit.
6. **Ball physics:**
   - Gravity, quadratic drag (k ≈ 0.013 m⁻¹), rolling friction and bounce.
   - Friction and bounce coefficients are fitted from IDSSE ball trajectories.
7. **Transition detector:** emits domain events at the exact tick a state change happens (pass released, ball received, shot, tackle, out of play, foul, goal, …), stamped with `frame_id`. Event and tracking sync is therefore perfect by construction.

#### 5.1.4 Decision layer

**Probabilities are expressed per action or per second, never per tick.** Changing the tick must not change the football; tbleckert's engine fails this.

- **Action choice:** a softmax over the decision actions in §5.1.10 — `short_pass`, `long_pass`, `through_ball`, `lofted_through`, `switch`, `cross`, `cutback`, `back_pass`, `carry`, `take_on`, `shot`, `clear`, `hold`. Inputs are zone, pressure, team-style bias, game-state bias and script multipliers. Base logits come from a fitted transition table indexed by zone × possession phase.
- **Pass target:** candidates are scored by fitted pass length and angle, and by time-to-intercept. That uses a reaction time of 0.7 s plus distance over max speed, compared against the ball's flight time. The passer chooses an **intended** target and speed. The **actual** ball comes from the execution model (§5.1.12), and the outcome is decided by physics: who reaches the ball first, or whether it goes out. xPass (distance, angle, defenders in the lane, pressure) is still computed at release, as the expected success of the *intended* pass. It is used for the decision and as ground truth.
- **Shots:** a logistic xG model with inputs distance, angle, body part and defenders in the cone. The aim point and power go through the execution model, so the outcome (goal, saved, wide, skied, scuffed) comes from where the ball actually travels. Execution noise is fitted so that goals per shot still match xG on average.
- **Defending:** the press trigger rate is set from the style's target PPDA. Tackle and interception attempts come from proximity and per-second rates; fouls and cards from per-duel rates.
- **Timing:** intents carry a duration (0.3–1.0 s) and an urgency, so players commit to a choice rather than jittering. The time between events is checked against fitted distributions by event type.
- **Decision record (the "was there a better pass?" data).** At every decision the engine records what the player *could* have done:
  - `action_probs`: the probability of each available action;
  - `options`: the five best pass options, each with receiver, kind, target point, xPass and value (xPass × threat at the target);
  - `best_receiver_id` and `best_value`;
  - `chosen_value` and `chosen_rank` (1 = the best option was chosen).

  It is attached to pass, shot, carry and take-on events in the domain stream. This is ground truth only a simulator has: real event data never records the alternatives. It feeds player feedback ("a better pass was on to #11 in space") and the evaluation harness (§5.3.1). "Best" is by the engine's own value model; the stats engine (§5.2) re-scores options independently from tracking (pitch control and xT), which also works on real matches. In the Plan 1 verification run, about 37 % of passes chose the best option.
- **Game state:**
  - **Score effect:** a leading team's line drops and its tempo falls late in the match.
  - **Goal timing:** scoring intensity follows a fitted minute profile, so more goals come late.
  - **Red cards:** scoring rate ×0.67 for the team down to ten and ×1.2 for the opponent.

#### 5.1.5 Randomness

- **Generator:** a splittable, pure PRNG carried in `MatchState` — xoroshiro128+ via `pure-rand`, or a hand-written equivalent. Pin the version and keep test vectors.
- **Independent sub-streams per concern**, keyed by `hash(seed, concern, n)` — for example `possession`, `decision:<playerId>`, `kinematic_noise:<playerId>`, `referee`, `script`. A scripted change in one area then doesn't reshuffle every later draw.
- **Not Effect's `Random`.** We don't use Effect's `Random` service inside the step, so replay can't break if Effect's generator changes. (Effect 4.0.0 went stable only on 2026-10-01.)

#### 5.1.6 Teams, styles and the fictional league (`packages/league`)

- **Clubs:** 8 invented clubs, each with a crest (generated SVG), colours, a formation and a `TeamStyle`:
  - `pressIntensity`, with a target PPDA: aggressive below 8, average 11–12, passive above 14;
  - `lineHeight`, `compactness`, `width`;
  - `tempo`, `longBallBias`, `crossBias`, `riskTolerance`.
- **Styles:** at least four distinct archetypes — high press, possession, direct, low block.
- **Kits:** each club has contrasting home and away kits (primary and secondary colours chosen for high contrast and kept distinct across the league), so a detector can separate the teams.
- **Squads:** 20 players per club, with unique shirt numbers, role, preferred foot and attributes (pace, acceleration, short passing, long passing, vision, crossing, dribbling, finishing, heading/aerial, tackling, composure, stamina; keepers add handling, reflexes and distribution). A seeded name generator checks every name against a real-player blocklist. A synthetic season history supplies the milestones the narrative layer uses.
- **Stable:** the league is generated once from a fixed seed and committed as `data/league/*.json`, so IDs stay stable for the demo.

#### 5.1.7 Scenario scripts

A script is a list of `{ window: [fromMin, toMin], team, effect }`. The effect is one of `goal`, `red_card`, `press_surge`, `keeper_heroics`, `momentum_swing`, `keeper_howler` or `defensive_error`. The last two raise one player's or one unit's mis-hit and miscontrol rates in the window. Scripts are resolved in three steps:
1. **Nudge:** raise the relevant per-second intensities inside the window.
2. **Retry:** if the window closes without the target, re-simulate it from a checkpoint with a new sub-seed, up to N attempts.
3. **Force (last resort):** force the outcome on the next qualifying action and mark the event `scripted: true`. This flag is kept out of CDF and recorded in the run manifest.

Built-in scenarios:
- `even_contest`;
- `late_comeback`: down 0–2 at 70', ends 3–2;
- `red_card_collapse`;
- `keeper_heroics`;
- `costly_error`: a defender's mis-hit back pass is pounced on and leads to a goal, testing whether the agents explain *why* the goal happened.
- `high_press_vs_low_block`: measured PPDA below 9 against above 13.

#### 5.1.8 Calibration and validation

**Offline fit** (`python/analytics`, kloppy ≥ 3.17.1):
- **From IDSSE:**
  - player speed and acceleration distributions;
  - ball speeds for passes and shots;
  - ball-in-play fraction;
  - ball friction and bounce coefficients.
- **From Wyscout (excluding England):**
  - event-type transition matrix by zone and phase;
  - **action-kind mix by zone and phase** (§5.1.10): pass kinds, carries vs take-ons, duels;
  - pass length and angle by zone and kind;
  - success rates by type, kind, zone and pressure (take-on and aerial-duel win rates included);
  - xG and xPass coefficients;
  - time between events by type;
  - minute profile of goals.
- **Export:** `data/params/*.json`, each with `{ dataset, licence, attribution, fitted_at, version }`.

**Plausibility bands**, checked per seed across 50–100 seeds in CI. Sources: open-football calibration bands and published league averages.

| Metric | Band |
|---|---|
| Goals | 2.3–3.4 |
| Shots | 18–32 |
| Passes (both teams) | about 800–1,000 |
| Pass completion | 75–88 % |
| Corners | 7–13 |
| Fouls | 18–32 |
| Yellow cards | 2.5–5.5 |
| Offsides | 2–6 |
| Save rate | 62–76 % |
| Ball in play | 55–60 % of match time |
| Long-ball share of passes | about 10 % (Premier League 2024/25: 93.4 of 893.5); band set from the fit |
| Kind mix (through balls, switches, crosses, cutbacks), take-ons, aerial duels | Per-match bands set from the Wyscout and IDSSE fits |
| Passes straight out of play; turnovers by third | Bands set from the fit |
| Errors leading to a shot or goal | Rare: well under one per team per match; band from the fit and published benchmarks |

**Kinematic checks** against IDSSE:
- Wasserstein-1 distance on the speed and acceleration distributions;
- no player above 10 m/s;
- distance per outfield player within the IDSSE-fitted range;
- ball within 1 m of the passer at each pass event, and within 1.5 m of the receiver at each reception.

**Real-data validation of the simulator.** Real match data is used **only to test how realistic the synthetic output is**. It never enters the product, the demo, `data/matches/` or the video.
- **Sources:** IDSSE (events + 25 Hz tracking, CC-BY 4.0), Wyscout public excluding England (events, CC BY 4.0), SkillCorner open data (broadcast tracking, MIT, optional). No StatsBomb, Metrica, PFF or IMPECT.
- **Download:** `python/analytics/download.py` fetches the data into git-ignored `data/raw/`. Real-data tests carry a `real_data` tag and are skipped when the data is absent. An optional CI job downloads IDSSE first.
- **Comparison:** the same metric code runs on real and synthetic matches. The stats engine reads real data through a kloppy → domain-event adapter. Compared side by side:
  - event-type mix and transition matrix;
  - pass length and angle by zone; completion by zone and pressure;
  - time between events; possession-sequence length; xG per shot and per match;
  - PPDA and field tilt by team style;
  - speed, acceleration and distance per player;
  - ball speeds; ball-in-play fraction.
- **Scores:**
  - Wasserstein-1 distance for continuous distributions;
  - Jensen–Shannon divergence for categorical mixes and transitions;
  - band checks for match totals.
- **Report:** a generated `realism-report.md`, with plots, records each run. Its headline numbers go in the README with attribution ("validated against open DFL and Wyscout data").
- **Bonus:** the adapter also proves the stats engine works on a real-format feed, not just our own output.

**Other checks:**
- **Formations:** EFPI detects the intended formation (offline, Python).
- **Stretch:** OpenSTARLab LEM_3 trained on Wyscout (excluding England) as a likelihood scorer, comparing synthetic against real.

#### 5.1.9 Outputs

1. **Domain stream** (`packages/schema`, Effect Schema), consumed live by the stats engine. Domain events are richer than CDF. Event types:
   - **Match flow:** `match_start`, `period_start`, `kickoff`, `period_end`, `match_end`.
   The full taxonomy, with attributes, is in §5.1.10. In summary:
   - **Match flow:** `match_start`, `period_start`, `kickoff`, `period_end`, `match_end`.
   - **On ball:** `pass` (crosses are a pass `kind`), `reception`, `carry`, `take_on`, `shot`, `clearance`, `goal`.
   - **Goalkeeper:** `keeper_save`, `keeper_claim`, `keeper_punch`, `keeper_distribution`.
   - **Duels and defending:** `aerial_duel`, `ground_duel`, `pressure`, `tackle`, `interception`, `block`, `ball_recovery`.
   - **Possession:** `possession_change`.
   - **Stoppages and discipline:** `ball_out`, `foul`, `card`, `offside`, `substitution`.
   - **Set pieces:** `set_piece` (restart kind), followed by the delivering `pass` or `shot`.

   Every domain frame lists all 22 players with `x`, `y`, `vel` (speed, m/s) and `intent` (`shape`, `press`, `run_in_behind`, `chase`, `carry`, `hold` or `on_ball`), so off-ball positions **and** what each player is doing are both in the data. Every domain event carries `frame_id`, `source` (`sim | replay | vision`), `confidence` (1.0 for `sim`), its attributes (for example `ball_speed_kmh`, `defenders_in_lane`, `under_pressure`) and ground-truth model values (`xg`, `xpass`).
2. **CDF v0.3.2 files** per match: `meta.json`, `event.jsonl`, `tracking.jsonl`. Tracking players carry `id`, `x`, `y` and CDF's optional `vel`; `intent` and the decision record stay in the domain stream.
   - Domain events map to CDF `type`/`sub_type`/`outcome_type`; for example, carry and pressure map to the nearest CDF types.
   - Events carry `tracking.frame_id` and `frame_id_end`, with `meta.is_synced: true`.
   - `meta.tracking.fps = 10`, `meta.cdf.version = "0.3.2"`.
   - No keys outside the schema, so the strict ("extreme") validator passes.
3. **SPADL view** (Should): an in-house mapper (x + 52.5, y + 34) in socceraction's stored frame: the home team attacks left to right; socceraction's `play_left_to_right()` flips the away team for analysis.
4. **Run manifest:** seed, teams, script, params version, git SHA, scripted-event list, output hashes.
5. **Optional realism-noise flag:** event-time jitter N(−0.37 s, 1.82 s) and location noise, to imitate unsynced real data. Off by default.

Domain event example:

```json
{"id":"m042-e1187","match_id":"m042","frame_id":41124,"period":"second_half","match_clock":"67:02.40",
 "type":"pass","kind":"through","height":"ground","technique":"foot","body_part":"right_foot",
 "team_id":"ironmoor","player_id":"p-ir-08","receiver_id":"p-ir-10",
 "x":8.7,"y":-11.6,"x_end":36.0,"y_end":-3.9,"outcome":"successful","frame_id_end":41133,
 "under_pressure":true,"defenders_in_lane":2,"defenders_bypassed":4,"ball_speed_kmh":71.4,
 "xpass":0.58,"chosen_value":0.41,"chosen_rank":1,"best_receiver_id":"p-ir-10","best_value":0.41,
 "action_probs":{"short_pass":0.42,"through_ball":0.31,"carry":0.17,"hold":0.06,"back_pass":0.04},
 "options":[{"action":"through_ball","receiver_id":"p-ir-10","kind":"through","target_x":36.0,"target_y":-3.9,"xpass":0.58,"value":0.41}, …],
 "tags":["progressive","line_breaking","key_pass"],"source":"sim","confidence":1.0}
```

#### 5.1.10 Action and event taxonomy

The decision layer chooses an **action**. Executing it produces one or more **domain events**. The stats engine then adds **derived tags**.

**One rule ties these together:** pass kinds are **classified from geometry at release**, using the same classifier on synthetic and real data. Calibration and realism comparisons are therefore like for like, and a "through ball" means the same thing everywhere. The thresholds below are starting values, tuned once against the Wyscout sub-event labels.

**Decision actions** (the softmax in §5.1.4):

| Action | What the player does | Geometry and execution |
|---|---|---|
| `short_pass` | Ground pass to a nearby teammate | Length < 32 m; height `ground` |
| `long_pass` | Long ball, often lofted, to a teammate or an area | Length ≥ 32 m (35 yards, the Opta convention); height `high` or `low` |
| `through_ball` | Ground pass into space behind or between the defensive line, for a runner | Target point beyond the last defender at release; needs a receiver with a `run_in_behind` intent |
| `lofted_through` | Through ball over the line | As above, height `high` |
| `switch` | Switch of play to the far side | Lateral displacement ≥ 25 m and crossing the pitch centreline (y = 0) |
| `cross` | Delivery from a wide area into the box | Origin `\|y\|` > 20.16 m in the final third; target inside the penalty area |
| `cutback` | Pass back from near the byline into the box | Origin x > 41 m (attacking), Δx < 0, target between the penalty spot and the 6-yard line |
| `back_pass` | Recycle backwards or to the keeper | Δx < −5 m; a back pass to the keeper (feet) is flagged |
| `carry` | Move with the ball with no opponent beaten | Displacement ≥ 3 m with the ball at the feet |
| `take_on` | Try to beat a defender 1v1 | Resolved by dribbling vs tackling, pace, pressure and fitted success rates |
| `shot` | Shoot | Technique is set by ball state at contact (see below) |
| `clear` | Defensive clearance | Height `high`, long, with no specific target |
| `hold` | Shield the ball or wait for support | Short dwell, then decide again |

**Domain events and attributes:**

| Event | Key attributes |
|---|---|
| `pass` | `kind` (short, long, through, lofted_through, switch, cross, cutback, back, set_piece); `height` (ground, low, high); `technique` (foot, head, chest, throw, keeper_hand); `body_part`; `outcome` (successful, intercepted, blocked, out_of_play, offside); `receiver_id`; `intended_receiver_id`; `intended_end` (x, y); `execution` (clean, inaccurate, overhit, underhit, mishit); `error_m`; `decision_quality`; `under_pressure`; `defenders_in_lane`; `defenders_bypassed`; `ball_speed_kmh`; `xpass` |
| `reception` | `first_touch` (controlled, heavy, miscontrol, missed); `under_pressure`; `lost_possession` |
| `carry` | `distance_m`; `progressive` |
| `take_on` | `outcome` (won, lost); `defender_id` |
| `shot` | `technique` (normal, first_time, volley, half_volley, header, chip, penalty, free_kick); `body_part`; `assisted_by`; `pass_kind_before`; `outcome` (goal, saved, blocked, wide, woodwork); `execution` (clean, scuffed, sliced, skied, miskick); `on_target`; `xg`; `shot_speed_kmh` |
| `goal` | `scorer_id`; `assist_id`; `own_goal` |
| `keeper_save` | `technique` (catch, parry, dive, smother); `handling` (clean, parried_safe, parried_dangerous, fumble, spill); `shot_id` |
| `keeper_claim`, `keeper_punch` | `from` (cross, corner, free_kick) |
| `keeper_distribution` | `method` (throw, roll, kick, goal_kick); then a `pass` |
| `aerial_duel` | `winner_id`; `loser_id`; `outcome` |
| `ground_duel` | `kind` (attacking, defending, loose_ball); `winner_id`; `loser_id` |
| `pressure` | `presser_id`; `duration_s`; `forced_turnover` (within 5 s) |
| `tackle` | `outcome` (won, lost, foul) |
| `interception` | `pass_id` |
| `block` | `blocked` (shot, pass, cross) |
| `clearance` | `technique` (foot, head) |
| `ball_recovery` | `kind` (loose_ball, second_ball) |
| `possession_change` | `reason` |
| `ball_out` | `side` (touchline, byline); `last_touch_team` |
| `foul` | `kind` |
| `card` | `colour` (yellow, second_yellow, red) |
| `offside` | — |
| `substitution` | — |
| `off_ball_run` | `kind` (in_behind); `ball_carrier_id`; target as `x_end`, `y_end` |
| `set_piece` | `kind` (kickoff, throw_in, corner, goal_kick, free_kick_direct, free_kick_indirect, penalty) |

**Shot technique** comes from the ball state at contact:
- **header:** ball height above about 1.4 m;
- **volley:** ball airborne;
- **half-volley:** ball just after a bounce;
- **first-time:** no reception event since the pass.

**Derived tags** (stats engine, `tags[]`):
- **`key_pass`:** a pass followed by a shot in the same possession.
- **`assist`:** a key pass whose shot scored.
- **`progressive`:** moves the ball at least 25 % closer to the goal centre, or at least 10 m closer in the final two-thirds.
- **`line_breaking`:** `defenders_bypassed` ≥ 1 full line.
- **`switch`.**
- **`big_chance`:** xG ≥ 0.3.
- **`counter_attack`:** a recovery in the team's own half reaches the final third within 10 s.
- **Mistakes** (§5.1.12): `misplaced`, `overhit`, `underhit`, `mishit`, `wrong_option`, `giveaway` (lost in the team's own third), `heavy_touch`, `big_chance_missed`, `error_leading_to_shot` and `error_leading_to_goal` (an opponent shot or goal in the same possession within 15 s of the error), `critical_error` (either of the last two, or a giveaway in the team's own box).

**Engine implications:**
- **Ball flight:** height sets the launch angle and speed — ground passes roll, `high` uses 3D flight.
- **Through balls:** need off-ball `run_in_behind` intents and a target in space, not at a player.
- **High balls:** contested high balls resolve as an `aerial_duel` from the heading attribute, jump timing and position.
- **Take-ons:** resolve from dribbling, tackling, pace and pressure.

**Calibration:** each kind's frequency by zone and its success rate come from Wyscout sub-events. These need confirming against the dataset; expected labels:
- passes: Simple pass, High pass, Smart pass ≈ through ball, Launch ≈ long ball, Cross, Head pass;
- duels: ground attacking, ground defending, air, loose ball;
- Acceleration ≈ carry or take-on.

IDSSE's DFL events cross-check the duels and keeper actions. Our geometric classifier runs on both, and the gap between Wyscout labels and our classifier is reported in the realism report.

**Export mapping:**
- **CDF:** event types are coarse, so the full detail stays in the domain stream. Pass kinds map to `pass` (restart kinds as `sub_type`), take-ons and aerial and ground duels to `misc/other_ball_action`, `ball_recovery` to `misc/other_ball_action`, keeper actions to `goalkeeping/save | save_attempt | claim`, and tackles to `misc/tackle`. Mappings are confirmed against the validator enums in week 1.
- **SPADL:** maps more directly — `pass`, `cross`, `throw_in`, `freekick_crossed/short`, `corner_crossed/short`, `take_on`, `dribble` (our carry), `shot`, `shot_penalty`, `shot_freekick`, `keeper_save/claim/punch/pick_up`, `clearance`, `goalkick`, `bad_touch` (miscontrol), `foul`, `tackle`, `interception`.

#### 5.1.11 Effect boundary (`packages/sim`)

- **Live mode:** `Stream.iterate` over `step`, paced with `Schedule.spaced(100 ms / speed)`.
- **Batch mode:** the same stream, unpaced.
- **Writers:** the stream is teed to the domain-stream publisher and to the CDF/SPADL writers.
- **CLI:** `touchline-sim --seed --home --away --script --speed --out`.
- **Tests:** use `TestClock` to check paced and unpaced hashes are equal.
- **Version check:** Effect 4 APIs (`Stream.iterate`, `Schedule.spaced`, `TestClock`, `Schema`) are pinned to 4.0.x and verified against the current docs in week 1.

#### 5.1.12 Execution, errors and mistakes

Players don't always do what they meant to. Every on-ball action has an **intention** (the decision layer's choice) and an **execution** (what actually happened). Mistakes come from the gap between the two. They are not drawn as a separate "error" event, so their consequences play out physically in the tracking data.

**Execution model:**
- The intended target point and ball speed are perturbed by **direction**, **distance or power** and, for lofted balls, **height** errors.
- The noise scale grows with:
  - pass length and difficulty;
  - pressure on the passer (nearest-defender distance and closing speed);
  - first-time or awkward technique and weaker foot;
  - fatigue (stamina) and the player's technical attribute (passing, crossing, finishing, first touch).
- **Heavy tail.** Errors are mostly small (Gaussian core), with a small mixture weight for big mistakes. That weight is the **mis-hit probability**, and it rises sharply under pressure and with low composure. This is what produces the occasional shank, air-kick or howler.
- **Outcome:** the actual ball then flies under normal physics, and the outcome is whoever reaches it first: the intended receiver, another teammate, an opponent, or the ball goes out of play.

**Kinds of mistake:**

| Mistake | How it arises | What is recorded |
|---|---|---|
| Inaccurate or misplaced pass | Moderate direction or distance error; the receiver must adjust or loses the ball | `execution: inaccurate`, `error_m`; tag `misplaced` if possession is lost |
| Overhit or underhit | Power error: runs out of play or past the runner, or falls short into a defender | `execution: overhit` or `underhit` |
| Mis-hit or shank | A heavy-tail draw: large error in direction and power | `execution: mishit`; tag `mishit` |
| Wrong option | The decision itself was poor: the chosen pass's value (xPass × threat gained) is well below the best available option | `decision_quality` (chosen value ÷ best value); tag `wrong_option` below a threshold |
| Heavy touch or miscontrol | First-touch error on reception, driven by ball speed, height, pressure and first-touch attribute | `reception.first_touch: heavy`, `miscontrol` or `missed`; tag `heavy_touch` |
| Shot mis-execution | Shot noise: scuffed, sliced, skied, air-kick | `shot.execution`; tag `big_chance_missed` if xG ≥ 0.3 and not scored |
| Keeper handling error | Handling noise on saves and claims | `keeper_save.handling: fumble`, `spill` or `parried_dangerous` |
| Defensive slip | Failed tackle, sliced clearance, mistimed header | `tackle.outcome: lost`, `clearance.execution: sliced`, `aerial_duel` lost |
| Critical error | Any of the above in a dangerous context, leading to an opponent shot or goal | Derived: `error_leading_to_shot`, `error_leading_to_goal`, `critical_error` |

**Why this matters:**
- **Physics stays consistent.** A misplaced pass actually goes somewhere wrong in the tracking data, rather than being labelled "incomplete" at the intended spot.
- **Ground truth for the agents (§2.1, #1).** Only synthetic data knows what the player *intended*. The evaluation harness can check whether the Analyst correctly explains "a mis-hit back pass under pressure" versus "a good pass, well intercepted". Real event data never records intention.
- **Better stories.** "Wayward under pressure", "the error that turned the game", a keeper howler, a big chance missed.

**Calibration:**
- Noise scales and mis-hit weights are fitted so that synthetic data matches real data on:
  - pass completion by kind, zone and pressure;
  - where turnovers happen;
  - goals per shot against xG.
- Real data doesn't label mis-hits, so the heavy-tail weight is tuned against two proxies: how far incomplete passes end from the nearest teammate (IDSSE) and the share of passes going straight out of play.
- Rates of errors leading to a shot or goal are checked to be rare (well under one per team per match). The exact band comes from the fit and published benchmarks.

**Ground truth in the manifest:** every mis-hit and critical error is listed with its frame, player and cause (pressure, fatigue, technique, script), so the evaluation harness can score explanations of it.

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

#### 5.3.1 Ground-truth evaluation harness (`services/agents/evals`)

This harness backs innovation #1 (§2.1). Scenario scripts (§5.1.7) record **tactical truths** in the run manifest: what was injected, when, by which team, and which metrics should move. Examples: `press_surge`, `red_card`, `momentum_swing`, `keeper_heroics`, a style switch. The harness replays scripted matches through the full agent workflow and scores:

| Score | Definition |
|---|---|
| Moment recall | Share of injected truths for which a moment is published within the window, plus 2 minutes |
| Moment precision | Share of published moments that match an injected truth or a band-significant signal |
| Explanation accuracy | Whether the Analyst names the correct cause (including mistakes such as a mis-hit under pressure versus a good interception), judged against the truth label by a rubric (LLM judge, spot-checked by hand) |
| Evidence correctness | Whether cited metric IDs and frame ranges overlap the truth's expected metrics and window |
| Grounding | Share of numeric claims verified by the Fact-Checker; target 100 % after gating |
| Decision feedback | Where the Analyst or Narrator says a better option existed, does it name the option the decision record ranks first, and does it stay silent when the chosen pass was rank 1? |
| Persona separation | Whether analyst and casual variants differ in depth (number count, length) and tone, per rubric |

- **Runs:** the harness runs as **Foundry evaluations** with custom evaluators, so results appear in Foundry and are reproducible. A small fixed suite of seeds runs in CI with a stub model; the full suite runs nightly against real models.
- **Publication:** results go in the README and the demo video as the "proof" moment.

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
- **3D viewer and what-if split:** see `2026-10-09-3d-viewer-whatif-design.md` (Plan 7).

### 5.7 API (`apps/api`)

- **Effect platform server.**
- **RPC endpoints:**
  - `listMatches`, `startMatch(scenario, seed, speed)`
  - `subscribeCues(matchId, segment)` (stream)
  - `getRecap(matchId)`, `getEvidence(cueId)`
  - `studio.approve` / `studio.hold`
- **Agent gateway:** an A2A client with timeout, retry and circuit breaker, all as Effect policies. When the circuit is open, the hot path continues and template cues fill in.

### 5.8 Auto-eventing from video (Stretch, `services/vision`)

The brief asks us to *consider* running a model over a video feed to produce pass and speed metrics. We do this on **video rendered from our own simulator**, never real broadcast footage, so every detection can be scored against exact ground truth. The core build only adds the cheap hooks below; the pipeline itself is Stretch.

**Hooks in the core build:**
- `--fps 25` render runs (§5.1.2);
- `source` and `confidence` on domain events (§5.1.9);
- contrasting kits and unique shirt numbers (§5.1.6);
- a run manifest holding ground truth (§5.1.9);
- an event bus that accepts any source (§4).

**Pipeline (Stretch):**
1. **Renderer.** It projects the 25 fps tracking through a virtual broadcast camera (pan, tilt and zoom following the ball) and draws the pitch, players (kit colour, number) and ball. The camera matrix is saved per frame, so the pitch-to-image homography is exact ground truth.
   - **First choice:** a deterministic Python/OpenCV renderer.
   - **Nicer alternative:** three.js captured to MP4.
2. **Detection and tracking.** A permissively licensed detector — RF-DETR or the original RT-DETR (Apache-2.0); licences to verify. ByteTrack for tracking (MIT). Pitch keypoints estimate the homography; team split by kit colour. **No Ultralytics YOLO (AGPL-3.0).**
3. **Events.** Pitch-plane tracks are smoothed with a Kalman filter. Ball speed and shot speed come from the tracks, and passes from possession changes. Output is domain events with `source: "vision"` and a confidence.
4. **Scoring against ground truth:**
   - detection mAP;
   - tracking HOTA or IDF1;
   - homography reprojection error;
   - ball-speed and shot-speed MAE in km/h;
   - pass-distance MAE in m;
   - pass event F1 within ±0.5 s.
   Published in the realism report.
5. **Demo:** a "vision" toggle replays the same match driven by vision-derived events instead of simulator events, with a side-by-side error readout.

**Runtime:** offline batch first. Azure Container Apps serverless GPU, or Azure Machine Learning, if run in the cloud.

## 6. Error handling and resilience

- **Every agent has a deterministic fallback** (table in 5.3), so the match never goes silent.
- **Timeouts:** each agent call has a timeout; the gateway enforces the 4 s end-to-end budget and drops late cues whose `ttl` has expired.
- **Checkpointing:** workflow state checkpoints to Cosmos DB; a restarted agent service resumes in-flight moments.
- **Cached replay mode:** a recorded match replays with its stored agent outputs, so the judges' link works even if model quota runs out. A "live" toggle re-runs the agents.
- **Typed errors:** Effect's typed errors across the TypeScript services; schema validation at every protocol boundary (RPC, A2A, MCP, file artifacts).

## 7. Testing

- **Simulator:** see §5.1.8. The CI gates are:
  - **Determinism:** byte-identical hashes for a fixed seed; paced and unpaced runs match.
  - **CDF:** `extreme`-mode validation of meta, event and tracking.
  - **Plausibility:** bands green across seeds.
  - **Kinematics:** checks against the IDSSE-fitted distributions.
  - **Scripts:** each script hits its target in ≥ 90 % of seeds.
- **Stats engine:** unit tests per metric on hand-built event sequences; golden-file tests on committed replays.
- **Contracts:** round-trip tests between Effect Schema and the generated Pydantic models; cue contract fixtures.
- **Agents:**
  - Fallback paths tested with a stubbed model.
  - Fact-Checker tested on seeded hallucinations, which must be caught.
  - Ground-truth evaluation harness (§5.3.1): fixed seeds in CI with a stub model; full suite nightly with real models as Foundry evaluations.
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
  - Ground-truth evaluation harness with scripted tactical truths (§5.3.1).
  - A2A gateway and MCP stats server.
  - Cue contract.
  - Fan app with 2D pitch, overlays, profiles and the "Why?" drawer.
  - Studio console.
  - EN/ES/HI.
  - Recaps.
  - Azure deployment, tracing, README, demo video.
- **Should:** xT; Event Hubs ingest; SignalR fan-out; ops view.
- **Stretch:** 25 Hz tracking + pitch control; voice commentator; CV auto-eventing on rendered video with measured error; Fabric analyst store.

**Rule:** no Stretch work starts before the week-3 checkpoint passes.

## 10. Timeline

| Dates | Focus | Checkpoint |
|---|---|---|
| 10-04 – 10-11 | Monorepo, schema, league, simulator (§5.1 checklist: CDF writers → offline fit → shape/steering/ball → decisions → determinism → calibration → scripts), replay files, stats engine, basic live-stats view | A full match replays with live stats on screen; CDF valid; calibration bands green |
| 10-12 – 10-18 | Agent workflow, Fact-Checker, A2A, MCP, cue bus, fan app overlays, profiles, EN/ES/HI, recaps, evaluation harness (local, stub model) | Analyst vs casual working locally; first recall/precision numbers |
| 10-19 – 10-24 | Azure via azd, Foundry hosted agents, tracing, evaluation harness as Foundry evaluations, Should items; Reactor session 10-21 | Public link works end to end; evaluation scores published |
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
| Effect 4.0 is days old (stable 2026-10-01) | Keep Effect out of the simulator step; pin 4.0.x; check APIs against current docs |
| CDF schema is alpha (v0.3.2, 2026-09-09) | Pin the validator version; keep the domain stream as our internal contract and CDF as an export |
| Simulator realism falls short | Calibration bands in CI from day 4; tune parameters, not code paths; script retries rather than forced outcomes |
| Licence drift (someone fits on StatsBomb for convenience) | Provenance header required in every params file; CI rejects params without an allowed licence |

## 12. Open items

- Azure subscription source and start date (awaiting reply from hackathon support).
- Exact Foundry model choices: pick at build time from the catalog.
- Name: "Touchline" is also a commercial heating-control brand (Roth Touchline). Repo name `touchline-match-intelligence` avoids confusion; the product name in the UI stays "Touchline".

# Manager agents and A/B evaluation — design (Plan 4b, trimmed)

Date: 2026-10-10. Roadmap row 4b (`docs/superpowers/plans/2026-10-03-touchline-roadmap.md`), trimmed: the corner-setup
optimiser is dropped. Builds on the main design (`2026-10-03-touchline-design.md`: agents §5.3, evaluation §5.3.1,
latency budgets), Plan 4a (agents service, A2A, gateway, stub model) and Plan 7 (viewer, what-if).

## 1. Purpose and decisions

The manager agents are a **demo showpiece**: at a key moment a team's manager agent reads the match, proposes changes,
has the engine test them by re-simulation, picks one and says why; the change plays out in the viewer and the
commentary. An A/B evaluation backs the demo with one honest number. Judging gives 20 % to agentic design; the build
window ends 2026-10-27.

| Decision | Chosen | Rejected |
|---|---|---|
| Purpose | Demo showpiece backed by an honest A/B number | A/B result as the headline; user plays manager |
| Menu | Team style (press, line height, compactness, tempo, long-ball bias, cross bias, risk) + substitutions | Formation changes (≈2 more days of engine work); style only (too subtle on screen) |
| When | Key moments: half-time, first restart after a goal, first stoppage after 60' and after 75' | Every stoppage (≈100 calls a match); fixed 15-minute clock |
| What-if | Propose → engine tests → agent chooses (two model calls per decision) | Engine picks, agent narrates; agent alone |
| Runtime | Ahead of time; decisions logged; replay needs no model | Live in a session (latency, cost per viewing); both |
| A/B arms | `none`, `rules`, `agent` on the same seeds | Agent vs none only; agent vs agent |
| Architecture | Engine drives; Python manager agent decides over A2A; engine runs the what-ifs | Agent drives with MCP tools; all TypeScript |

Because managers run ahead of time, the pending model-latency decision does not constrain this plan: a slow model only
slows match generation.

## 2. Engine (TypeScript)

### 2.1 Orders

```ts
type ManagerOrder =
  | { kind: "style"; style: Partial<Omit<TeamStyle, "archetype">> }
  | { kind: "sub"; off: string; on: string }   // player ids
```

- **Style** orders are validated against the existing `STYLE_RANGES` (`packages/sim-core/src/whatif.ts`) and applied
  the way the `tactic` intervention is (rewriting `state.config[side].style`); they take effect from the next tick.
- **Sub** orders go to a per-team order queue in `MatchState`. Queued subs are made at the current stoppage through the
  existing substitution code path and count against `MAX_SUBS` (5) and `MAX_SUB_WINDOWS` (3); a player who has come
  off cannot return, a bench player is used once.
- A team with a manager (`rules` or `agent`) gets **no automatic substitutions** (`planSubs` / `makeSubs` / the
  half-time chance are skipped for that team). A team without a manager behaves exactly as today, so unmanaged matches,
  the realism gate and every pinned fixture are unchanged.
- A new what-if intervention `{ kind: "orders", side, orders }` applies a list of orders to a fork, so the engine can
  test a manager's option with the existing paired `whatIf`.

### 2.2 Key moments

`keyMoment(state, prev) → "half_time" | "after_goal" | "minute_60" | "minute_75" | null`, a pure function:

- `half_time`: the second-half kickoff restart, before play resumes.
- `after_goal`: the kickoff restart following a goal.
- `minute_60`, `minute_75`: the first restart (any `Phase.kind === "restart"`) at or after that match minute.
- One decision per team per moment; if two moments coincide (a goal at 61') they merge into one decision listing both
  reasons.

At each of these the ball is dead until `resumeTick`, so the state is frozen while the manager decides.

### 2.3 The managed run

A new package `packages/manager` (depends on `sim-core`, `stats`, `schema`, `agent-gateway`):

```ts
interface Manager { readonly kind: "none" | "rules" | "agent"; decide(s: Situation, ctx: DecideContext): Effect<Decision> }
runManaged(config, { home: Manager, away: Manager }): Effect<ManagedRun>   // frames, events, decisions
```

- `runManaged` steps the match; at a key moment it asks each managed team for a `Decision`, applies its orders and
  continues. Play does not advance while a decision is pending.
- `none` never decides. `rules` is a small deterministic TypeScript manager:
  - losing → raise press and tempo, and bring on attackers for the most tired players;
  - winning after 60' → lower the line and raise compactness;
  - otherwise substitute players below 60 % energy, role for role.
- `agent` calls the Python manager (§3): `propose` → the engine tests each option plus "no change" → `choose`.
- **What-if per option:** `whatIf(state, {kind:"orders", …}, { seeds: 20, horizonS: 600, side })` from the paused
  state, run on worker threads, one option per worker. Scored by the paired difference in **xG difference** against
  "no change"; goal difference is reported alongside. A worker that fails or times out (30 s) marks its option
  `untested`.
- Managed matches run **without a scenario script**: a script forcing outcomes would distort decisions and the A/B.

### 2.4 Decision log and replay

Every decision (from `rules` and `agent`) is one line of `decisions.jsonl` in the run directory:

`tick, minute, team, reasons[], situation_hash, options[{label, orders, rationale, whatif|untested|dropped_reason}],
pick, reason, orders_applied, fallback (null | "propose" | "choose" | "service"), timings_ms {propose, whatif, choose},
tokens {in, out}, cost_usd, model`.

- **Replay:** `runManaged` with `replayManager(decisions)` applies the logged orders at their ticks; the match is
  bit-identical to the original and makes no model calls. A test asserts it.
- The manifest gains `managers: {home, away}` and the sha256 of `decisions.jsonl`.
- `pnpm sim … --manage home=agent,away=rules` produces a managed match; `--replay-decisions <file>` replays one.

## 3. Manager agent (Python, `services/agents`)

A `manager` agent following the `detector.py` pattern (pydantic output, `Agent(...)`, `@stub_responder`,
`run_structured` with a fallback), on the large model tier, timeout 30 s per call. The A2A agent card gains a `manage`
skill with two tasks:

- **`propose(situation) → Proposal`**: 2–3 options, each `{label (≤ 60 chars), orders[], rationale (≤ 25 words)}`.
  "No change" is never proposed; the engine always adds it.
- **`choose(situation, whatif) → Choice`**: `{pick: option index | "no_change", reason (≤ 30 words)}`. The existing
  whole-token number check verifies that every number in the reason appears in the what-if results; a reason that cites
  an unknown number is rejected (one retry, then fallback).

The instructions state the club's archetype and ask the manager to play to it (a `low_block` side stays compact unless
chasing). They also define every field and its unit.

**Contracts:** `Situation`, `ManagerOrder`, `Proposal`, `Choice`, `WhatIfSummary` are defined once in Effect Schema in
`packages/schema`, exported to JSON Schema and generated into Pydantic by the existing `scripts/gen_contracts.py`.

**Re-validation:** the engine re-validates every proposed order against the live state (style in range; `off` on the
pitch; `on` on the bench and unused; subs and windows left). Invalid options are dropped with a reason and logged; the
decision continues with the rest.

**Fallbacks:**

| Failure | Result | Logged as |
|---|---|---|
| `propose` times out, returns garbage or no valid option | The `rules` manager's option stands in; it and "no change" are tested and the agent's `choose` runs as usual | `fallback: "propose"` |
| `choose` fails | The previous plan stays (no change) | `fallback: "choose"` |
| A2A service unreachable / circuit open | Previous plan stays | `fallback: "service"` |

**Cost:** `Outcome` gains token usage read from the OpenAI response; a price table in `config.py` turns it into
`cost_usd` per call. **Stub model** (tests, CI): `propose` returns the rules manager's options; `choose` picks the best
what-if mean (or no change if none is positive). No network in tests or CI.

## 4. What the model receives

Both tasks receive one `Situation`; `choose` also receives `whatif`. `Situation` is a closed Effect Schema struct
(no extra fields), built by `situationAt(state, events, side)` from the paused state and the events up to the pause
tick only, as the managed team sees it. Every numeric field names its unit.

- `moment`: `reasons[]`, `minute`, `added_time_expected_min`, `minutes_left`, `score {for, against}`, `score_state`
  (`"losing by 1"` etc.).
- `team`, `opponent`: `name`, `archetype`, `formation`, `style` (each value with its range and a one-line meaning),
  `stats` so far: `xg`, `shots`, `possession_pct`, `pass_completion_pct`, `ppda`, `yellow_cards`, `red_cards`
  (computed with `packages/stats` from the events up to the pause tick).
- `players` (own team only): on the pitch — `id`, `name`, `number`, `role`, `energy_pct`, `minutes_played`,
  `yellow_card`, `xg`, `key_actions`; bench — `id`, `name`, `number`, `role`, `available`.
- `limits`: `subs_left`, `windows_left`, `style_ranges`.
- `recent`: the last 10 minutes per side — `xg`, `shots`, `press_regains`. No raw event stream.
- `whatif` (`choose` only): per option `label`, `orders`, `xg_diff_vs_no_change {mean, se}`,
  `goal_diff_vs_no_change {mean, se}`, `seeds`, `horizon_min`, or `untested`; plus one sentence explaining the numbers.

**Never sent:** the seed, random-number state, scenario script, forced outcomes, truth labels; anything after the pause
tick; forked match contents (only their summary numbers); real tracking data; personal data (all names are synthetic);
secrets; the user's email.

**Enforced by tests:**
- *Allowlist:* the encoded `Situation` has exactly the documented keys.
- *No future:* the situation built during a run equals the one rebuilt from a replay truncated at that tick.
- *Golden:* one real situation is committed as a reviewed example; any payload change shows up in a diff.
- *Size:* ≤ 2,500 tokens (estimated as characters / 4).
- *Sent = logged:* `situation_hash` in the log is the sha256 of the exact payload sent.

## 5. A/B evaluation

- **Seeds** 5000–5119 (120), disjoint from calibration (1000+), the realism report (2000+) and the gate (3000+).
- **Fixtures:** each seed pairs two league clubs, rotated so every archetype appears as the managed team and as the
  opponent. The managed team alternates home/away by seed parity.
- **Arms:** each seed is played three times, the managed team having `none`, `rules` or `agent`; the opponent never has
  a manager. The three runs are identical up to the first key moment.
- **Primary metric (declared now):** the managed team's xG difference per match. **Secondary:** goal difference,
  points per match, win rate (Wilson 95 % interval).
- **Comparisons:** agent − none, agent − rules, rules − none: mean paired difference with a seeded 10,000-resample
  bootstrap 95 % interval.
- **Agent operations:** cost per match, latency p50/p95 per call and per decision, fallback rate by kind, "no change"
  rate, dropped-option rate, how often the pick was the best what-if option.
- **Honesty rule:** the headline follows the interval — "better", "no detectable difference" or "worse" — including
  when the agent does not beat `rules`.
- **Command:** `pnpm managers:ab --seeds 120 --llm openai` writes `docs/evals/manager-ab.md` and
  `docs/evals/manager-ab.json`. Matches run in parallel; estimate ≈ 600 agent decisions, ≈ 1,200 model calls,
  ≈ 40 minutes. **The real-model run needs the user's go-ahead** (it spends OpenAI credit); everything before it uses
  the stub.
- **CI:** 4 seeds with the stub: checks the pipeline, replay identity and report format, not the result.

## 6. Viewer and demo library

- A few managed matches (agent managing both teams, real model, generated once) join the demo library.
- At each key moment the viewer shows a **decision card**: the reasons, the 2–3 options and "no change" with their
  what-if bars (xG difference ± SE), the pick highlighted and the reason line. It stays a few seconds and reopens from a
  decision strip on the timeline. Substitutions and style changes then show on the pitch as they already do.
- Each decision is also a cue for the commentary pipeline, so the narrator can mention it.

## 7. Errors and testing

Every failure ends in a logged fallback, never a crashed match; the A/B report counts each kind.

- **TypeScript:** `keyMoment`; order validation; the sub queue and limits; no automatic subs for managed teams and
  unchanged behaviour for unmanaged ones; the `orders` intervention; the `rules` manager; replay identity; the payload
  tests of §4; bootstrap and Wilson maths; the gateway's `manage` skill; the 4-seed CI suite.
- **Python:** both tasks with the stub; every fallback path; the number check on `choose`; contract round-trips.
- **Unchanged:** the realism gate, pinned fixtures and the existing agent eval suite.

## 8. Out of scope

Formation changes; live (in-session) manager calls; corner-setup optimiser; manager vs manager evaluation; learned
(RL) control; changing the latency budgets or the model choice.

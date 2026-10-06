# Touchline Plan 4a — Agent Workflow, Fact-Checker, A2A and Evaluation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The six agents of spec §5.3 (Moment Detector, Tactical Analyst, Narrator, Fact-Checker, Personalizer, Recap Producer) as one Microsoft Agent Framework workflow that turns stats signals into fact-checked, personalized cues in English, Spanish and Hindi, served over A2A to an Effect gateway, and scored against the simulator's scripted ground truth.

**Architecture:** A Python service (`services/agents`, uv, Python 3.12) runs the agents. Each one reads the match only through the MCP stats server, calls a model through one interface (OpenAI `gpt-6.1-sol`, or a deterministic stub that tests and CI use), and has a deterministic fallback. The agents form an Agent Framework graph: detector → analyst → narrator → fact-checker, with one retry edge back to the narrator, a fan-out to a casual and an analyst personalizer, and a fan-in to a publisher. The graph is checkpointed, and recaps run on the same agents. The service speaks A2A v1.0. A new TypeScript package (`packages/agent-gateway`, Effect) replays a run's signals to it in batches, sends recaps at the whistles, enforces the time budget, retries once and opens a circuit after repeated failures. It validates every artifact against the contracts and writes the verified cues to a cache for replay. The contracts are Effect Schema in `packages/schema`, exported as JSON Schema and generated into Pydantic models. The stats engine gains a `costly_error` signal and observable event qualifiers, and the evaluation harness (`services/agents/evals`) computes the seven scores of spec §5.3.1.

**Tech Stack:** as Plans 3a/3b (TypeScript 5.9.3, Effect 4.0.0, vitest 5.0.3, pnpm 11.27, Turborepo 2.11.6, `@modelcontextprotocol/sdk` 1.32.0, `zod` 4.6.5), plus:
- **TypeScript:** `@a2a-js/sdk` 1.3.0.
- **Python 3.12 (uv):**
  - Runtime: `agent-framework-core` 1.20.0, `agent-framework-openai` 1.15.0, `a2a-sdk[http-server]` 1.2.2, `mcp` 1.30.0 (Agent Framework needs `mcp<2`), `pydantic` 2.13.5, `uvicorn` 0.54.0.
  - Dev: `pytest` 9.1.1, `pytest-asyncio` 1.4.0, `datamodel-code-generator` 0.83.0.

**Spec:** `docs/superpowers/specs/2026-10-03-touchline-design.md`:
- §4.1: language split and protocols.
- §5.2: signals.
- §5.3: agents, flow and Fact-Checker mechanics.
- §5.3.1: evaluation harness.
- §5.4: cue contract.
- §5.5: personalization.
- §6: fallbacks, budget, cached replay, typed errors.
- §7: agent tests.

Roadmap: `docs/superpowers/plans/2026-10-03-touchline-roadmap.md` (Plan 4 row; this is its first half, 4a). Builds on Plan 3b (merged to `main`). API research behind the pins: `research_notes/Agent framework current APIs/notes.md` (verified 2026-10-06).

**How code is given:** new files in full. Changes to existing files are exact patches, applied from the repository root with the `git apply <<'PATCH' … PATCH` block shown, each produced from the verified prototype task by task.

**Verification status:** every task was built and run in full before this plan was written: one commit per task, each commit's type checks and tests green, and the agents' Python suite green at every commit (144 passed at the end, 7 `live` tests deselected). The code blocks reproduce the prototype file for file, checked by replaying the plan on a fresh clone of `main`. Every RED step's expected failure is the output of running that task's tests against the previous task's commit. Results:
- **Stub model, six scripted matches (CI suite):** moment recall 94 %, precision 100 %, explanation accuracy 88 %, evidence correctness 94 %, grounding 100 % (first draft and published), decision feedback 100 %, persona separation 100 %. The suite runs in about 80 s and is deterministic.
- **`gpt-6.1-sol`, one scripted match** (live): 23 moments and 100 verified cues in English, Spanish and Hindi, in 14 minutes and about 200 model calls.
  - Every first draft passed the Fact-Checker; no agent fell back.
  - Explanation accuracy 100 % by the LLM judge (once 50 %: the judge varies), decision feedback 83 %, persona separation 100 %.
- **Latency:** a `gpt-6.1-sol` call takes about 5 s even at reasoning effort `low`, so a moment takes about 30 s end to end (`gpt-5.4-mini` takes 2–3 s). Real-model runs are recorded runs, replayed from the cue cache (spec §6); the stub stack answers every request within the 4 s live budget.
- **`costly_error`** equals the manifest's critical errors on all 12 matches checked.
- **Seeded hallucinations:** ten kinds are each caught by the Fact-Checker.

## Global Constraints

- All earlier constraints hold:
  - Synthetic data only; no StatsBomb.
  - No GPL or AGPL code.
  - Raw real data never in git.
  - Pinned versions.
  - Determinism of the simulator and the stats engine.
  - No answer sees the future.
- **No agent computes a statistic** (spec §5.3). Every number an agent states is a value the MCP stats server returned, and the Fact-Checker checks it against the server.
- **The simulator's ground truth never reaches an agent.** The `scripted` event attribute and the manifest's truths are read only by the evaluation harness. Agents see only what a broadcaster could see: the `qualifiers` allow-list (Task 5).
- **The OpenAI key lives only in the repo's git-ignored `.env.local`** (`OPENAI_API_KEY=...`, mode 600).
  - It is never printed, logged or committed; `Settings` keeps it out of `repr`.
  - It is sent only to OpenAI.
- **Tests and CI never call a model.** They use the deterministic stub. The few tests that call OpenAI are marked `live` and run only with `pytest -m live`.
- **Every agent has a deterministic fallback** (spec §6): a timeout, an error, unparseable output or output that breaks a rule gives the fallback, so the match never goes silent. Fallback output passes the same checks as model output.
- **Contracts are defined once,** in Effect Schema (`packages/schema/src/agents.ts`):
  - They are exported to `packages/schema/json/agent-contracts.schema.json` and generated into `services/agents/touchline_agents/contracts_gen.py`.
  - Both files are committed, and tests fail when either is stale.
  - Shared fixtures are decoded on both sides.
  - Every A2A message and artifact is validated at both ends.
- **Models:** OpenAI `gpt-6.1-sol` for both tiers, reasoning effort `low` (the lowest it accepts), behind one config file (`touchline_agents/config.py`). It has no dated snapshot, so every trace records the model label.
- **Personalized text comes only from verified claims:** casual at most one number; Hindi in Devanagari with Western digits; Spanish with a decimal comma.

## Review Focus

1. **Real-model latency against the 4 s live budget.** A `gpt-6.1-sol` call takes about 5 s, so a moment takes about 30 s end to end. A live run must degrade to template cues, never to silence or a hung match. *Task 13, `gateway.test.ts` ("times out a request over budget", "opens the circuit after repeated failures"); Task 11, `test_workflow.py` ("every agent failing still publishes template cues"); Task 7, `test_narrator.py` ("falls back to the template" on a timeout).* Real-model runs are recorded runs (cached replay), as the README says.
2. **A player who was not in the play.** Model text that names a rostered player who was not involved must not be published. *Task 8, `test_factchecker.py` ("seeded hallucinations are caught": `outsider`); Task 9, `test_personalizer.py` ("the check catches bad variants": `who was not involved`).* A name outside the roster entirely is not caught; this is a known limit, listed in the README.
3. **Spanish or Hindi that is really English.** A model may copy the English draft into a Spanish or Hindi segment. *Task 14, `test_personalizer.py` ("a variant that copies the English draft is not Spanish or Hindi"); Task 9 checks Devanagari for Hindi.*
4. **A long-lived agent service.** One process serves many matches; a finished match must release its stats connection and memory. *Task 14, `test_server.py` ("the full-time recap closes the match").*
5. **Batches with nothing worth a caption.** Most 15-second batches promote nothing; they must complete at once with no artifacts and no model calls beyond the detector's. *Task 4, `test_detector.py` ("nothing to rank skips the model"); Task 14, `test_server.py` ("a batch that promotes nothing completes without artifacts").*

---

### Task 1: Agent contracts in Effect Schema, exported as JSON Schema

Spec §4.1 says shared types are Effect Schema in `packages/schema`, exported as JSON Schema and generated into Pydantic models for the agents. This task defines the contracts and the export:
- **Model output:** `Moment` (a promoted signal), `Claim` (one checkable statement with its `quote` exactly as written), `Analysis`, `Draft`, `Verdict` (with per-sentence checks).
- **Spec §5.4:** the `Cue` contract, versioned `touchline.cue/1`.
- **Records:** `Recap`, and `MomentTrace` (what happened to a moment, for evaluation and the ops view).
- **A2A message bodies:** `SignalsRequest` and `RecapRequest`.
- **Spec §5.5:** `Segment` and its cache key `mode.lang.club`; at most 12 segments.

One bundle (`AgentContracts`) is exported to a committed JSON Schema file, and a test fails when the file is stale. Shared fixtures (valid and invalid) are decoded here and, in Task 2, by the Python side. `Signal` gets an identifier so it is a named definition.

**Files:**
- Create: `packages/schema/src/agents.ts`, `packages/schema/src/json.ts`, `packages/schema/scripts/json.ts`, `packages/schema/test/agents.test.ts`
- Create (written by a one-off script): `packages/schema/fixtures/agents/valid/*.json` (6 files), `packages/schema/fixtures/agents/invalid/*.json` (8 files)
- Create (generated): `packages/schema/json/agent-contracts.schema.json`
- Modify: `packages/schema/src/index.ts`, `packages/schema/src/stats.ts`, `packages/schema/package.json`

**Interfaces:**
- Consumes: `MetricId`, `Signal`, `SignalType` (Plan 3a).
- Produces (from `@touchline/schema`):
  - Schemas and types: `Mode`, `Lang`, `Segment`, `MAX_SEGMENTS = 12`, `Moment`, `ClaimKind`, `Claim`, `Analysis`, `Draft`, `SentenceCheck`, `Verdict`, `Slot`, `Cue`, `Recap`, `MomentTrace`, `SignalsRequest`, `RecapRequest`, `AgentRequest`, `ARTIFACTS`, `AgentContracts`.
  - Functions: `segmentKey(s)`, `decodeCue`, `decodeMomentTrace`, `decodeRecap`, `decodeAgentRequest`, `contractsJsonSchema()`, `contractsJsonText()`.
  - The constant `CONTRACTS_SCHEMA_PATH = "packages/schema/json/agent-contracts.schema.json"` and the script `pnpm --filter @touchline/schema json`.

- [ ] **Step 1: Write the shared fixtures**

Create `/tmp/write_fixtures.py` — run once from the repository root, not committed:

```python
"""Write the shared contract fixtures: packages/schema/fixtures/agents/{valid,invalid}/*.json (run from the repo root)."""
import json
import os

V = "packages/schema/fixtures/agents/valid/"
I = "packages/schema/fixtures/agents/invalid/"
os.makedirs(V, exist_ok=True)
os.makedirs(I, exist_ok=True)


def w(path, contract, value, why=None):
    d = {"contract": contract, "value": value} if why is None else {"contract": contract, "why": why, "value": value}
    open(path, "w").write(json.dumps(d, indent=2, ensure_ascii=False) + "\n")


seg = {"mode": "casual", "lang": "en", "club": "ironmoor"}
cue = {"cue_id": "m042-c0311", "schema": "touchline.cue/1", "match_id": "m042", "moment_id": "m042-mo-39880-pressure_shift",
       "anchor": {"frame_from": 39880, "frame_to": 40213, "clock": "67:02"},
       "display": {"slot": "lower_third", "priority": 2, "ttl_ms": 8000, "template": "pressure_shift"},
       "segment": seg,
       "text": {"headline": "Ironmoor turn the screw", "body": "They have pressed Kestrel Bay into their own half since the hour mark."},
       "data": {"team.press": 0.71}, "evidence": ["team.press@39880-40213", "m042-e1102", "m042-e1150"], "verified": True}
moment = {"moment_id": "m042-mo-40213-pressure_shift", "match_id": "m042", "type": "pressure_shift", "signal_ids": ["m042-pressure_shift-40213-ironmoor"],
          "frame_id": 40213, "frame_from": 39880, "frame_to": 40213, "period": "second_half", "match_clock": "67:02", "team_id": "ironmoor", "player_id": None,
          "salience": 0.82, "priority": 2, "source": "rules"}
claim = {"kind": "metric", "sentence": 1, "quote": "0.71", "metric_id": "team.press", "subject": "ironmoor", "value": 0.71, "at_frame": 40213, "window_s": None, "event_id": None, "receiver_id": None}
analysis = {"moment_id": moment["moment_id"], "cause": "sustained high press", "explanation": "Ironmoor pushed their press higher and won the ball back in Kestrel Bay's half.", "claims": [claim]}
draft = {"moment_id": moment["moment_id"], "lang": "en", "sentences": ["Ironmoor turn the screw", "Their pressing index is up to 0.71."], "claims": [claim]}
verdict = {"moment_id": moment["moment_id"], "status": "pass", "sentences": [{"index": 0, "verified": True, "reasons": []}, {"index": 1, "verified": True, "reasons": []}], "claims_checked": 1, "claims_verified": 1, "undeclared": 0}
trace = {"moment": moment, "analysis": analysis, "draft": draft, "verdicts": [verdict], "fallbacks": [], "cue_ids": ["m042-c0311"], "timings_ms": {"analyst": 812.5, "narrator": 301.0}, "model": "stub"}
recap = {"recap_id": "m042-recap-half_time", "match_id": "m042", "kind": "half_time", "at_frame": 27000, "sentences": ["Ironmoor lead at the break", "They lead 1-0."],
         "claims": [{"kind": "score", "sentence": 1, "quote": "1-0", "metric_id": None, "subject": None, "value": None, "at_frame": 27000, "window_s": None, "event_id": None, "receiver_id": None}],
         "turning_points": [moment["moment_id"]], "player_of_match": "p-iro-09", "verified": True}
signal = {"id": "m042-pressure_shift-40213-ironmoor", "match_id": "m042", "type": "pressure_shift", "frame_id": 40213, "frame_from": 39880, "frame_to": 40213,
          "period": "second_half", "match_clock": "67:02", "team_id": "ironmoor", "player_id": None, "metric": "team.press", "value": 0.71, "salience": 0.82,
          "evidence": ["team.press@39880-40213"], "data": {"before": 0.4, "after": 0.71, "pressures": 14}}
sreq = {"kind": "signals", "match_id": "m042", "mcp_url": "http://127.0.0.1:7801/mcp", "segments": [seg, {"mode": "analyst", "lang": "hi", "club": None}], "now_frame": 40213, "signals": [signal]}
rreq = {"kind": "recap", "match_id": "m042", "mcp_url": "http://127.0.0.1:7801/mcp", "segments": [seg], "recap": "full_time", "at_frame": 57000}
w(V + "cue.json", "cue", cue)
w(V + "cue-stats.json", "cue", {**cue, "cue_id": "m042-s0001", "moment_id": None, "text": None, "display": {**cue["display"], "slot": "top_bar", "template": "momentum"}})
w(V + "trace.json", "trace", trace)
w(V + "recap.json", "recap", recap)
w(V + "request-signals.json", "request", sreq)
w(V + "request-recap.json", "request", rreq)
w(I + "cue-old-schema.json", "cue", {**cue, "schema": "touchline.cue/0"}, "unknown schema version")
w(I + "cue-zero-ttl.json", "cue", {**cue, "display": {**cue["display"], "ttl_ms": 0}}, "ttl must be positive")
w(I + "cue-unknown-lang.json", "cue", {**cue, "segment": {**seg, "lang": "fr"}}, "languages are en, es and hi")
w(I + "trace-unknown-metric.json", "trace", {**trace, "analysis": {**analysis, "claims": [{**claim, "metric_id": "team.vibes"}]}}, "claims cite known metric ids only")
w(I + "request-too-many-segments.json", "request", {**sreq, "segments": [{"mode": m, "lang": l, "club": c} for m in ("casual", "analyst") for l in ("en", "es", "hi") for c in (None, "a", "b")][:13]}, "at most 12 segments")
w(I + "request-no-segments.json", "request", {**rreq, "segments": []}, "at least one segment")
w(I + "request-unknown-kind.json", "request", {**rreq, "kind": "chat"}, "only signals and recap requests")
w(I + "draft-no-sentences.json", "draft", {**draft, "sentences": []}, "a draft has a headline")
```

Run: `python3 /tmp/write_fixtures.py && ls packages/schema/fixtures/agents/*`
Expected: 6 files in `valid/` (`cue.json`, `cue-stats.json`, `recap.json`, `request-recap.json`, `request-signals.json`, `trace.json`) and 8 in `invalid/`

- [ ] **Step 2: Write the failing test**

Create `packages/schema/test/agents.test.ts`:

```ts
import { readdirSync, readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { Schema } from "effect"
import { describe, expect, it } from "vitest"
import { AgentContracts, decodeAgentRequest, decodeCue, MAX_SEGMENTS, segmentKey } from "../src/agents.js"
import { CONTRACTS_SCHEMA_PATH, contractsJsonSchema, contractsJsonText } from "../src/json.js"

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, "../../..")
const fixtures = (kind: "valid" | "invalid") =>
  readdirSync(join(here, "../fixtures/agents", kind)).map((f) => ({ file: f, ...(JSON.parse(readFileSync(join(here, "../fixtures/agents", kind, f), "utf8")) as { contract: string; value: unknown }) }))
// One decoder per contract, taken from the bundle so every fixture is checked against exactly what is exported.
const decoders = Object.fromEntries(Object.entries(AgentContracts.fields).map(([k, s]) => [k, Schema.decodeUnknownSync(s as Schema.Decoder<unknown>)]))

describe("agent contracts", () => {
  it("decodes every valid fixture", () => {
    const valid = fixtures("valid")
    expect(valid.length).toBeGreaterThanOrEqual(6)
    for (const f of valid) expect(() => decoders[f.contract]!(f.value), f.file).not.toThrow()
  })
  it("rejects every invalid fixture", () => {
    const invalid = fixtures("invalid")
    expect(invalid.length).toBeGreaterThanOrEqual(8)
    for (const f of invalid) expect(() => decoders[f.contract]!(f.value), f.file).toThrow()
  })
  it("keeps the cue shape of spec §5.4", () => {
    const cue = decodeCue(fixtures("valid").find((f) => f.file === "cue.json")!.value)
    expect(cue.schema).toBe("touchline.cue/1")
    expect(cue.anchor).toEqual({ frame_from: 39880, frame_to: 40213, clock: "67:02" })
  })
  it("tells signals and recap requests apart by kind", () => {
    const kinds = fixtures("valid").filter((f) => f.contract === "request").map((f) => decodeAgentRequest(f.value).kind)
    expect(kinds.sort()).toEqual(["recap", "signals"])
  })
  it("keys segments by mode, language and club", () => {
    expect(segmentKey({ mode: "analyst", lang: "hi", club: null })).toBe("analyst.hi.neutral")
    expect(segmentKey({ mode: "casual", lang: "es", club: "ironmoor" })).toBe("casual.es.ironmoor")
    expect(MAX_SEGMENTS).toBe(12)
  })
})

describe("JSON Schema export", () => {
  it("names every contract under $defs", () => {
    const defs = Object.keys(contractsJsonSchema().$defs as object)
    for (const name of ["Signal", "Moment", "Claim", "Analysis", "Draft", "Verdict", "Cue", "Recap", "MomentTrace", "SignalsRequest", "RecapRequest", "Segment"]) expect(defs).toContain(name)
  })
  it("matches the committed file (run `pnpm --filter @touchline/schema json` after changing a contract)", () => {
    expect(readFileSync(join(root, CONTRACTS_SCHEMA_PATH), "utf8")).toBe(contractsJsonText())
  })
})
```

- [ ] **Step 3: Run it to make sure it fails**

Run: `pnpm --filter @touchline/schema test agents`
Expected: the file fails to load: `Cannot find module '../src/agents.js'`

- [ ] **Step 4: Write the contracts**

Create `packages/schema/src/agents.ts`:

```ts
/**
 * Contracts between the agent service (Python, services/agents) and the TypeScript side (spec §4.1, §5.3–§5.5).
 * They are exported as JSON Schema (`pnpm --filter @touchline/schema json`), from which the agents' Pydantic models
 * are generated, and every A2A message and artifact is validated against them on both sides.
 */
import { Schema } from "effect"
import { MetricId, Signal, SignalType } from "./stats.js"

const NonNegInt = Schema.Int.check(Schema.isGreaterThanOrEqualTo(0))
const Id = Schema.String.check(Schema.isMinLength(1))

export const Mode = Schema.Literals(["casual", "analyst"])
export const Lang = Schema.Literals(["en", "es", "hi"])

/** A profile collapsed to what changes the text (spec §5.5): generation scales with segments, not users. */
export const Segment = Schema.Struct({
  mode: Mode,
  lang: Lang,
  /** The club the text is framed for, or null for a neutral viewer. */
  club: Schema.NullOr(Id)
}).annotate({ identifier: "Segment" })
export type Segment = typeof Segment.Type

/** At most this many segments are active per match (spec §5.5). */
export const MAX_SEGMENTS = 12

/** The cache key of a segment's variants: `mode.lang.club` (`neutral` when there is no club). */
export const segmentKey = (s: Segment): string => `${s.mode}.${s.lang}.${s.club ?? "neutral"}`

/** A signal the Moment Detector promoted: what the agents explain and the cues anchor to. */
export const Moment = Schema.Struct({
  moment_id: Id,
  match_id: Id,
  type: SignalType,
  /** The signal that was promoted first, then any others of the same play it absorbed. */
  signal_ids: Schema.Array(Id).check(Schema.isMinLength(1)),
  /** Global tick at which the moment was raised (the lead signal's frame). */
  frame_id: NonNegInt,
  frame_from: NonNegInt,
  frame_to: NonNegInt,
  period: Schema.Literals(["first_half", "second_half"]),
  match_clock: Schema.String,
  team_id: Schema.NullOr(Id),
  player_id: Schema.NullOr(Id),
  salience: Schema.Finite,
  /** 1 is the most important (goals, red cards); 3 the least. */
  priority: Schema.Literals([1, 2, 3]),
  /** Who promoted it: the model, or the rule-based fallback. */
  source: Schema.Literals(["model", "rules"])
}).annotate({ identifier: "Moment" })
export type Moment = typeof Moment.Type

/**
 * One checkable statement inside a draft. `quote` is the text exactly as written in the sentence (e.g. "0.69",
 * "69%", "2-1", "67th"), so the Fact-Checker can tell declared numbers from undeclared ones.
 * - metric: `metric_id` for `subject` as of `at_frame` (over `window_s`) is `value`; checked with verify_claim.
 * - score: the score as of `at_frame` is `quote` (home-away).
 * - minute: the moment happened in minute `value`.
 * - event: event `event_id` happened by `at_frame` (and, if `subject` is a player id, by that player).
 * - better_option: at event `event_id` a pass to `receiver_id` was the better option (the decision record's rank 1).
 */
export const ClaimKind = Schema.Literals(["metric", "score", "minute", "event", "better_option"])
export const Claim = Schema.Struct({
  kind: ClaimKind,
  /** Index of the sentence that states it: 0 is the headline, 1.. the body sentences. */
  sentence: NonNegInt,
  quote: Schema.String,
  metric_id: Schema.NullOr(MetricId),
  subject: Schema.NullOr(Id),
  value: Schema.NullOr(Schema.Finite),
  at_frame: NonNegInt,
  window_s: Schema.NullOr(Schema.Finite),
  event_id: Schema.NullOr(Id),
  receiver_id: Schema.NullOr(Id)
}).annotate({ identifier: "Claim" })
export type Claim = typeof Claim.Type

/** The Analyst's output: the cause it names and the claims that support it. */
export const Analysis = Schema.Struct({
  moment_id: Id,
  /** One short phrase naming the cause, e.g. "mis-hit pass under pressure", "sustained high press". */
  cause: Schema.String,
  /** Plain-language explanation in English (no numbers that are not also claims). */
  explanation: Schema.String,
  claims: Schema.Array(Claim)
}).annotate({ identifier: "Analysis" })
export type Analysis = typeof Analysis.Type

/** Narrated text in one language: sentence 0 is the headline, the rest the body; claims point at sentences by index. */
export const Draft = Schema.Struct({
  moment_id: Id,
  lang: Lang,
  sentences: Schema.Array(Schema.String).check(Schema.isMinLength(1)),
  claims: Schema.Array(Claim)
}).annotate({ identifier: "Draft" })
export type Draft = typeof Draft.Type

export const SentenceCheck = Schema.Struct({
  index: NonNegInt,
  verified: Schema.Boolean,
  reasons: Schema.Array(Schema.String)
}).annotate({ identifier: "SentenceCheck" })

/** The Fact-Checker's verdict on one draft: pass, ask for one retry, or drop the unverified sentences. */
export const Verdict = Schema.Struct({
  moment_id: Id,
  status: Schema.Literals(["pass", "retry", "drop"]),
  sentences: Schema.Array(SentenceCheck),
  claims_checked: NonNegInt,
  claims_verified: NonNegInt,
  /** Numbers found in the text that no claim declared (the model is asked to extract them). */
  undeclared: NonNegInt
}).annotate({ identifier: "Verdict" })
export type Verdict = typeof Verdict.Type

export const Slot = Schema.Literals(["top_bar", "lower_third", "side_panel", "pitch_marker", "recap_card"])

/** The overlay cue (spec §5.4), versioned so a third-party graphics renderer can consume it. */
export const Cue = Schema.Struct({
  cue_id: Id,
  schema: Schema.Literal("touchline.cue/1"),
  match_id: Id,
  /** The moment (or recap) it was made for; null for stats cues from the hot path. */
  moment_id: Schema.NullOr(Id),
  anchor: Schema.Struct({ frame_from: NonNegInt, frame_to: NonNegInt, clock: Schema.String }),
  display: Schema.Struct({
    slot: Slot,
    priority: Schema.Literals([1, 2, 3]),
    ttl_ms: Schema.Int.check(Schema.isGreaterThan(0)),
    template: Schema.String
  }),
  segment: Segment,
  text: Schema.NullOr(Schema.Struct({ headline: Schema.String, body: Schema.String })),
  data: Schema.Record(Schema.String, Schema.Finite),
  evidence: Schema.Array(Schema.String),
  verified: Schema.Boolean
}).annotate({ identifier: "Cue" })
export type Cue = typeof Cue.Type

/** A half-time or full-time recap (Recap Producer), fact-checked like a moment's draft. */
export const Recap = Schema.Struct({
  recap_id: Id,
  match_id: Id,
  kind: Schema.Literals(["half_time", "full_time"]),
  at_frame: NonNegInt,
  sentences: Schema.Array(Schema.String).check(Schema.isMinLength(1)),
  claims: Schema.Array(Claim),
  turning_points: Schema.Array(Id),
  player_of_match: Schema.NullOr(Id),
  verified: Schema.Boolean
}).annotate({ identifier: "Recap" })
export type Recap = typeof Recap.Type

/** What happened to one moment inside the workflow: the evaluation harness and the ops view read these. */
export const MomentTrace = Schema.Struct({
  moment: Moment,
  analysis: Analysis,
  /** The draft after the last retry, before unverified sentences were dropped. */
  draft: Draft,
  verdicts: Schema.Array(Verdict),
  /** Agents that used their deterministic fallback for this moment. */
  fallbacks: Schema.Array(Schema.String),
  cue_ids: Schema.Array(Id),
  timings_ms: Schema.Record(Schema.String, Schema.Finite),
  model: Schema.String
}).annotate({ identifier: "MomentTrace" })
export type MomentTrace = typeof MomentTrace.Type

const Base = {
  match_id: Id,
  /** The MCP stats server for this match (Streamable HTTP); the agent service only accepts loopback or allowed hosts. */
  mcp_url: Schema.String,
  segments: Schema.Array(Segment).check(Schema.isMinLength(1), Schema.isMaxLength(MAX_SEGMENTS))
}

/** New signals for a match, oldest first, as of `now_frame`. */
export const SignalsRequest = Schema.Struct({
  kind: Schema.Literal("signals"),
  ...Base,
  now_frame: NonNegInt,
  signals: Schema.Array(Signal)
}).annotate({ identifier: "SignalsRequest" })

export const RecapRequest = Schema.Struct({
  kind: Schema.Literal("recap"),
  ...Base,
  recap: Schema.Literals(["half_time", "full_time"]),
  at_frame: NonNegInt
}).annotate({ identifier: "RecapRequest" })

/** The data part of every A2A message the gateway sends. */
export const AgentRequest = Schema.Union([SignalsRequest, RecapRequest]).annotate({ identifier: "AgentRequest" })
export type AgentRequest = typeof AgentRequest.Type

/** A2A artifact names and the contract each one carries. */
export const ARTIFACTS = { cue: Cue, trace: MomentTrace, recap: Recap } as const

/** All contracts in one document (the JSON Schema export's root). */
export const AgentContracts = Schema.Struct({
  signal: Signal,
  moment: Moment,
  claim: Claim,
  analysis: Analysis,
  draft: Draft,
  verdict: Verdict,
  cue: Cue,
  recap: Recap,
  trace: MomentTrace,
  request: AgentRequest
}).annotate({ identifier: "AgentContracts" })

export const decodeCue = Schema.decodeUnknownSync(Cue)
export const decodeMomentTrace = Schema.decodeUnknownSync(MomentTrace)
export const decodeRecap = Schema.decodeUnknownSync(Recap)
export const decodeAgentRequest = Schema.decodeUnknownSync(AgentRequest)
```

Apply this change to `packages/schema/src/stats.ts` — a named definition for Signal (from the repository root):

```bash
git apply <<'PATCH'
diff --git a/packages/schema/src/stats.ts b/packages/schema/src/stats.ts
index 027ef69..7df5ed7 100644
--- a/packages/schema/src/stats.ts
+++ b/packages/schema/src/stats.ts
@@ -35,7 +35,7 @@ export const Signal = Schema.Struct({
   /** Event ids and metric references (`metric@from-to`) that support the signal. */
   evidence: Schema.Array(Schema.String),
   data: Schema.Record(Schema.String, Schema.Finite)
-})
+}).annotate({ identifier: "Signal" })
 export type Signal = typeof Signal.Type
 
 export const decodeSignal = Schema.decodeUnknownSync(Signal)
PATCH
```

- [ ] **Step 5: Write the JSON Schema export**

Create `packages/schema/src/json.ts`:

```ts
import { Schema } from "effect"
import { AgentContracts } from "./agents.js"

/** Where the exported JSON Schema lives, relative to the repo root (the agents' Pydantic models are generated from it). */
export const CONTRACTS_SCHEMA_PATH = "packages/schema/json/agent-contracts.schema.json"

/** The agent contracts as one JSON Schema (draft 2020-12) document, every named contract under `$defs`. */
export const contractsJsonSchema = (): Record<string, unknown> => {
  const doc = Schema.toJsonSchemaDocument(AgentContracts)
  return {
    $schema: "https://json-schema.org/draft/2020-12/schema",
    $id: "https://touchline.dev/schema/agent-contracts.json",
    title: "AgentContracts",
    ...(doc.definitions.AgentContracts as Record<string, unknown>),
    $defs: Object.fromEntries(Object.entries(doc.definitions).filter(([k]) => k !== "AgentContracts"))
  }
}

/** The exact file contents written to CONTRACTS_SCHEMA_PATH. */
export const contractsJsonText = (): string => JSON.stringify(contractsJsonSchema(), null, 2) + "\n"
```

Create `packages/schema/scripts/json.ts`:

```ts
import { writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { CONTRACTS_SCHEMA_PATH, contractsJsonText } from "../src/json.js"

const root = join(dirname(fileURLToPath(import.meta.url)), "../../..")
writeFileSync(join(root, CONTRACTS_SCHEMA_PATH), contractsJsonText())
console.log(`wrote ${CONTRACTS_SCHEMA_PATH}`)
```

Apply this change to `packages/schema/src/index.ts`, `packages/schema/package.json` (from the repository root):

```bash
git apply <<'PATCH'
diff --git a/packages/schema/package.json b/packages/schema/package.json
index f62ef8d..2511c4a 100644
--- a/packages/schema/package.json
+++ b/packages/schema/package.json
@@ -4,7 +4,7 @@
   "private": true,
   "type": "module",
   "exports": { ".": "./src/index.ts" },
-  "scripts": { "test": "vitest run", "typecheck": "tsc --noEmit -p ." },
+  "scripts": { "test": "vitest run", "typecheck": "tsc --noEmit -p .", "json": "tsx scripts/json.ts" },
   "dependencies": { "effect": "4.0.0" },
   "devDependencies": { "@touchline/sim-core": "workspace:*" }
 }
diff --git a/packages/schema/src/index.ts b/packages/schema/src/index.ts
index 049a676..ca204f8 100644
--- a/packages/schema/src/index.ts
+++ b/packages/schema/src/index.ts
@@ -1,2 +1,4 @@
+export * from "./agents.js"
 export * from "./domain.js"
+export * from "./json.js"
 export * from "./stats.js"
PATCH
```

- [ ] **Step 6: Export the schema and run the tests**

Run: `pnpm --filter @touchline/schema json`
Expected: `wrote packages/schema/json/agent-contracts.schema.json` (a draft 2020-12 document: the `AgentContracts` bundle at the root, every named contract under `$defs`)

Run: `pnpm --filter @touchline/schema test && pnpm --filter @touchline/schema typecheck`
Expected: 10 passed (7 new), no type errors

- [ ] **Step 7: Commit**

```bash
git add packages/schema
git commit -m "feat(schema): agent contracts (moment, claim, draft, verdict, cue, recap, trace, A2A requests), JSON Schema export and shared fixtures

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```



### Task 2: Agent service scaffold: generated contracts, config, model clients

`services/agents` is a uv project on Python 3.12, with the pins of Global Constraints. It has four parts:
- **Contracts:** the Pydantic models are generated from Task 1's JSON Schema by `datamodel-code-generator`. A test regenerates them and compares, so they cannot drift. The shared fixtures must round-trip exactly, with the cue's `schema` field written by alias.
- **Config** (`config.py`, spec §5.3 "behind one config file"):
  - Provider `stub` or `openai`; `gpt-6.1-sol` for both tiers; reasoning effort `low` (gpt-6.1-sol rejects `none` and `minimal`).
  - Per-agent timeouts with a scale for recorded runs; the hosts an MCP URL may name; an optional checkpoint folder.
  - The key comes from the environment or the repo's git-ignored `.env.local`, and never appears in `repr`.
- **Model access** (`llm.py`): every agent sends one user message, `TASK: <task>` plus its input as JSON.
- **The stub chat client:** an Agent Framework `BaseChatClient` with the function-invocation, middleware and telemetry layers. It answers each task with a registered responder and can request tool calls first. It can also fail in the three ways a real model does: an error, unparseable text, or no answer in time.

`run_structured` asks an agent for a Pydantic output and falls back to deterministic output on any failure (spec §6).

**Files:**
- Create: `services/agents/.python-version`, `services/agents/pyproject.toml`, `services/agents/touchline_agents/__init__.py` (empty), `services/agents/scripts/gen_contracts.py`, `services/agents/touchline_agents/contracts.py`, `services/agents/touchline_agents/config.py`, `services/agents/touchline_agents/llm.py`
- Create (generated): `services/agents/touchline_agents/contracts_gen.py`, `services/agents/uv.lock`
- Test: `services/agents/tests/test_config.py`, `services/agents/tests/test_contracts.py`, `services/agents/tests/test_llm.py`

**Interfaces:**
- Consumes: Task 1's `packages/schema/json/agent-contracts.schema.json` and fixtures.
- Produces:
  - `contracts.py`: the generated models (`Signal`, `Moment`, `Claim`, `Analysis`, `Draft`, `SentenceCheck`, `Verdict`, `Segment`, `Cue` with `schema_` aliased to `schema`, `Recap`, `MomentTrace`, `SignalsRequest`, `RecapRequest`), `MAX_SEGMENTS`, `parse_request(data)`, `segment_key(s)`, `dump(model)`.
  - `config.py`: `REPO`, `DEFAULT_MODEL = "gpt-6.1-sol"`, `TIMEOUTS_S`, `Settings` (`provider`, `small_model`, `large_model`, `timeout_scale`, `mcp_allowed_hosts`, `checkpoint_dir`, `reasoning_effort`, `openai_api_key`, `.model(tier)`, `.timeout(agent)`, `.model_label`), `SettingsError`, `load_settings(env=None, env_file=ENV_FILE)`, `read_env_file(path)`.
  - `llm.py`: `envelope(task, payload)`, `parse_envelope(text)`, `ToolCalls`, `STUB_RESPONDERS`, `stub_responder(task)`, `StubChatClient(behaviour="ok"|"error"|"garbage"|"slow")`, `make_client(settings, tier)`, `agent_options(settings)`, `Outcome`, `run_structured(agent, task, payload, output, *, timeout_s, fallback, accept)`.
  - Environment: `TOUCHLINE_LLM`, `OPENAI_API_KEY`, `TOUCHLINE_MODEL_SMALL`, `TOUCHLINE_MODEL_LARGE`, `TOUCHLINE_REASONING`, `TOUCHLINE_TIMEOUT_SCALE`, `TOUCHLINE_MCP_HOSTS`, `TOUCHLINE_CHECKPOINTS`.

- [ ] **Step 1: Create the project**

Create `services/agents/pyproject.toml`:

```toml
[project]
name = "touchline-agents"
version = "0.1.0"
description = "Touchline agent service: six Microsoft Agent Framework agents in one workflow, served over A2A, reading stats over MCP."
requires-python = ">=3.12"
dependencies = [
  "agent-framework-core==1.20.0",
  "agent-framework-openai==1.15.0",
  "a2a-sdk[http-server]==1.2.2",
  # Agent Framework pins mcp<2.
  "mcp==1.30.0",
  "pydantic==2.13.5",
  "uvicorn==0.54.0",
]

[project.scripts]
touchline-agents = "touchline_agents.server:main"

[build-system]
requires = ["hatchling"]
build-backend = "hatchling.build"

[tool.hatch.build.targets.wheel]
packages = ["touchline_agents"]

[dependency-groups]
dev = ["pytest==9.1.1", "pytest-asyncio==1.4.0", "datamodel-code-generator==0.83.0"]

[tool.pytest.ini_options]
asyncio_mode = "auto"
asyncio_default_fixture_loop_scope = "session"
markers = ["live: calls the real model API (needs OPENAI_API_KEY; run with -m live)"]
addopts = "-m 'not live'"
```

Create `services/agents/.python-version`:

```text
3.12
```

Create the empty package marker `services/agents/touchline_agents/__init__.py`.

Run: `uv sync --project services/agents`
Expected: Python 3.12 picked, the pinned packages installed (`uv.lock` written)

- [ ] **Step 2: Write the failing tests**

Create `services/agents/tests/test_config.py`:

```python
import pytest

from touchline_agents.config import DEFAULT_MODEL, SettingsError, load_settings, read_env_file


def test_defaults_to_the_stub_with_one_model_for_both_tiers():
    s = load_settings({}, env_file=None)
    assert s.provider == "stub"
    assert s.model("small") == s.model("large") == DEFAULT_MODEL == "gpt-6.1-sol"
    assert s.model_label == "stub"
    assert s.mcp_allowed_hosts == {"127.0.0.1", "localhost", "::1"}


def test_openai_needs_a_key():
    with pytest.raises(SettingsError, match="OPENAI_API_KEY"):
        load_settings({"TOUCHLINE_LLM": "openai"}, env_file=None)


def test_key_from_env_file_never_shows_in_repr(tmp_path):
    f = tmp_path / ".env.local"
    f.write_text("# local secrets\nexport OPENAI_API_KEY='sk-test-123'\n\nTOUCHLINE_LLM=openai\n")
    s = load_settings({}, env_file=f)
    assert s.provider == "openai" and s.openai_api_key == "sk-test-123"
    assert "sk-test" not in repr(s)
    assert s.model_label == "openai:gpt-6.1-sol"


def test_environment_wins_over_env_file(tmp_path):
    f = tmp_path / ".env.local"
    f.write_text("TOUCHLINE_MODEL_LARGE=from-file\nTOUCHLINE_MODEL_SMALL=small-file\n")
    s = load_settings({"TOUCHLINE_MODEL_LARGE": "from-env"}, env_file=f)
    assert (s.small_model, s.large_model) == ("small-file", "from-env")
    assert s.model_label == "stub"


def test_rejects_unknown_provider_and_bad_scale():
    with pytest.raises(SettingsError, match="stub"):
        load_settings({"TOUCHLINE_LLM": "llama"}, env_file=None)
    with pytest.raises(SettingsError, match="positive"):
        load_settings({"TOUCHLINE_TIMEOUT_SCALE": "0"}, env_file=None)
    with pytest.raises(SettingsError, match="number"):
        load_settings({"TOUCHLINE_TIMEOUT_SCALE": "fast"}, env_file=None)


def test_reasoning_effort():
    assert load_settings({}, env_file=None).reasoning_effort == "low"
    assert load_settings({"TOUCHLINE_REASONING": "high"}, env_file=None).reasoning_effort == "high"
    with pytest.raises(SettingsError, match="low, medium or high"):
        load_settings({"TOUCHLINE_REASONING": "none"}, env_file=None)


def test_timeouts_scale():
    s = load_settings({"TOUCHLINE_TIMEOUT_SCALE": "2.5"}, env_file=None)
    assert s.timeout("narrator") == 7.5


def test_missing_env_file_is_empty(tmp_path):
    assert read_env_file(tmp_path / "nope") == {}
```

Create `services/agents/tests/test_contracts.py`:

```python
import json
from pathlib import Path

import pytest
from pydantic import TypeAdapter, ValidationError

from touchline_agents import contracts as c
from touchline_agents.contracts_gen import AgentContracts

FIXTURES = Path(__file__).resolve().parents[3] / "packages/schema/fixtures/agents"
# The same contract names as the TypeScript bundle (AgentContracts' fields).
ADAPTERS = {name: TypeAdapter(field.annotation) for name, field in AgentContracts.model_fields.items()}


def load(kind: str) -> list[tuple[str, dict]]:
    return [(p.name, json.loads(p.read_text())) for p in sorted((FIXTURES / kind).glob("*.json"))]


@pytest.mark.parametrize(("name", "fixture"), load("valid"))
def test_valid_fixture_round_trips(name, fixture):
    adapter = ADAPTERS[fixture["contract"]]
    value = adapter.validate_python(fixture["value"])
    # What Python writes back must be exactly what TypeScript wrote: same keys (by alias: `schema`), same values.
    assert adapter.dump_python(value, mode="json", by_alias=True) == fixture["value"]


@pytest.mark.parametrize(("name", "fixture"), load("invalid"))
def test_invalid_fixture_rejected(name, fixture):
    with pytest.raises(ValidationError):
        ADAPTERS[fixture["contract"]].validate_python(fixture["value"])


def test_requests_parse_by_kind():
    kinds = sorted(c.parse_request(f["value"]).kind for _, f in load("valid") if f["contract"] == "request")
    assert kinds == ["recap", "signals"]


def test_segment_key_matches_typescript():
    assert c.segment_key(c.Segment(mode="analyst", lang="hi", club=None)) == "analyst.hi.neutral"
    assert c.segment_key(c.Segment(mode="casual", lang="es", club="ironmoor")) == "casual.es.ironmoor"


def test_dump_uses_wire_names():
    _, cue = next(f for f in load("valid") if f[0] == "cue.json")
    assert c.dump(c.Cue.model_validate(cue["value"]))["schema"] == "touchline.cue/1"


def test_unknown_fields_rejected():
    _, cue = next(f for f in load("valid") if f[0] == "cue.json")
    with pytest.raises(ValidationError):
        c.Cue.model_validate({**cue["value"], "colour": "red"})


def test_generated_models_match_schema(tmp_path):
    import sys

    sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))
    from gen_contracts import OUTPUT, generate

    generate(tmp_path / "gen.py")
    assert (tmp_path / "gen.py").read_text() == OUTPUT.read_text(), "run scripts/gen_contracts.py after changing the contracts"
```

Create `services/agents/tests/test_llm.py`:

```python
import asyncio
import json

import pytest
from agent_framework import Agent, tool
from pydantic import BaseModel

from touchline_agents.config import load_settings
from touchline_agents.llm import STUB_RESPONDERS, StubChatClient, ToolCalls, agent_options, envelope, make_client, parse_envelope, run_structured


class Answer(BaseModel):
    text: str
    n: int


@pytest.fixture(autouse=True)
def responders():
    STUB_RESPONDERS["echo"] = lambda payload, results: {"text": payload["say"], "n": len(results)}
    STUB_RESPONDERS["lookup"] = lambda payload, results: (
        ToolCalls([("double", {"x": payload["x"]})]) if not results else {"text": results[0], "n": len(results)}
    )
    yield
    STUB_RESPONDERS.pop("echo")
    STUB_RESPONDERS.pop("lookup")


@tool(description="Double a number")
def double(x: int) -> int:
    return 2 * x


def test_envelope_round_trips():
    task, payload = parse_envelope(envelope("narrate", {"b": 1, "a": "é"}))
    assert task == "narrate" and payload == {"a": "é", "b": 1}
    with pytest.raises(ValueError):
        parse_envelope("hello")


async def test_stub_answers_through_an_agent_with_structured_output():
    agent = Agent(client=StubChatClient(), name="echo", instructions="Echo.")
    r = await agent.run(envelope("echo", {"say": "hi"}), options={"response_format": Answer})
    assert r.value == Answer(text="hi", n=0)


async def test_stub_calls_tools_before_answering():
    agent = Agent(client=StubChatClient(), name="lookup", instructions="Look up.", tools=[double])
    r = await agent.run(envelope("lookup", {"x": 21}), options={"response_format": Answer})
    assert r.value == Answer(text="42", n=1)


@pytest.mark.parametrize(("behaviour", "reason"), [("error", "RuntimeError"), ("garbage", "ValidationError"), ("slow", "timeout")])
async def test_failures_use_the_fallback(behaviour, reason):
    agent = Agent(client=StubChatClient(behaviour, slow_s=5), name="echo", instructions="Echo.")
    out = await run_structured(agent, "echo", {"say": "hi"}, Answer, timeout_s=0.2, fallback=lambda: Answer(text="fallback", n=-1))
    assert out.fallback and out.reason == reason and out.value.text == "fallback"


async def test_rejected_output_uses_the_fallback():
    agent = Agent(client=StubChatClient(), name="echo", instructions="Echo.")
    out = await run_structured(agent, "echo", {"say": "hi"}, Answer, timeout_s=1, fallback=lambda: Answer(text="fb", n=0), accept=lambda a: a.text != "hi")
    assert out.fallback and out.reason == "invalid"
    ok = await run_structured(agent, "echo", {"say": "yo"}, Answer, timeout_s=1, fallback=lambda: Answer(text="fb", n=0))
    assert not ok.fallback and ok.value.text == "yo" and ok.ms >= 0


def test_stub_provider_makes_a_stub_client():
    stub = load_settings({}, env_file=None)
    assert isinstance(make_client(stub, "small"), StubChatClient)
    assert agent_options(stub) == {}
    assert agent_options(load_settings({"TOUCHLINE_LLM": "openai", "OPENAI_API_KEY": "k"}, env_file=None)) == {"reasoning": {"effort": "low"}}


@pytest.mark.live
async def test_openai_answers_with_structured_output():
    settings = load_settings({"TOUCHLINE_LLM": "openai"})
    agent = Agent(client=make_client(settings, "small"), name="echo", instructions="Reply with JSON: text = the INPUT's `say`, n = 7.", default_options=agent_options(settings))
    out = await run_structured(agent, "echo", {"say": "hi"}, Answer, timeout_s=60, fallback=lambda: Answer(text="fallback", n=0))
    assert not out.fallback, out.reason
    assert out.value == Answer(text="hi", n=7)
```

- [ ] **Step 3: Run them to make sure they fail**

Run: `uv run --project services/agents pytest -q services/agents`
Expected: three collection errors: `ModuleNotFoundError: No module named 'touchline_agents.config'` (twice) and `ImportError: cannot import name 'contracts' from 'touchline_agents'`

- [ ] **Step 4: Generate the Pydantic models**

Create `services/agents/scripts/gen_contracts.py`:

```python
"""Generate touchline_agents/contracts_gen.py from the JSON Schema that packages/schema exports.

Run after `pnpm --filter @touchline/schema json`:  uv run python scripts/gen_contracts.py
"""

import subprocess
import sys
from pathlib import Path

AGENTS = Path(__file__).resolve().parents[1]
SCHEMA = AGENTS.parents[1] / "packages/schema/json/agent-contracts.schema.json"
OUTPUT = AGENTS / "touchline_agents/contracts_gen.py"
ARGS = [
    "--input-file-type", "jsonschema",
    "--output-model-type", "pydantic_v2.BaseModel",
    "--target-python-version", "3.12",
    "--enum-field-as-literal", "all",
    "--use-standard-collections",
    "--use-union-operator",
    "--collapse-root-models",
    "--extra-fields", "forbid",
    "--use-double-quotes",
    "--disable-timestamp",
    "--formatters", "builtin",
]


def generate(output: Path) -> None:
    """Write the Pydantic models for every contract to `output`."""
    subprocess.run(
        [sys.executable, "-m", "datamodel_code_generator", "--input", str(SCHEMA), "--output", str(output), *ARGS],
        check=True,
        capture_output=True,
    )


if __name__ == "__main__":
    generate(OUTPUT)
    print(f"wrote {OUTPUT.relative_to(AGENTS)}")
```

Run: `uv run --project services/agents python services/agents/scripts/gen_contracts.py`
Expected: `wrote touchline_agents/contracts_gen.py` (models with `extra="forbid"`; the cue's `schema` field is `schema_` with alias `schema`)

- [ ] **Step 5: Write the contracts helpers, the config and the model access**

Create `services/agents/touchline_agents/contracts.py`:

```python
"""The agent contracts (generated from packages/schema, spec §4.1) plus the helpers the TypeScript side also has."""

from typing import Annotated

from pydantic import BaseModel, Field, TypeAdapter

from .contracts_gen import (
    Analysis,
    Anchor,
    Claim,
    Cue,
    Display,
    Draft,
    Moment,
    MomentTrace,
    Recap,
    RecapRequest,
    Segment,
    SentenceCheck,
    Signal,
    SignalsRequest,
    Text,
    Verdict,
)

__all__ = [
    "MAX_SEGMENTS", "AgentRequest", "Analysis", "Anchor", "Claim", "Cue", "Display", "Draft", "Moment", "MomentTrace",
    "Recap", "RecapRequest", "Segment", "SentenceCheck", "Signal", "SignalsRequest", "Text", "Verdict",
    "dump", "parse_request", "segment_key",
]

MAX_SEGMENTS = 12

AgentRequest = Annotated[SignalsRequest | RecapRequest, Field(discriminator="kind")]
_request = TypeAdapter(AgentRequest)


def parse_request(data: object) -> SignalsRequest | RecapRequest:
    """Validate the data part of an A2A message (raises pydantic.ValidationError)."""
    return _request.validate_python(data)


def segment_key(s: Segment) -> str:
    """`mode.lang.club`, `neutral` when there is no club: the cache key of a segment's variants (spec §5.5)."""
    return f"{s.mode}.{s.lang}.{s.club or 'neutral'}"


def dump(model: BaseModel) -> dict:
    """A contract as JSON-ready data with its wire names (the cue's `schema` field is `schema_` in Python)."""
    return model.model_dump(mode="json", by_alias=True)
```

Create `services/agents/touchline_agents/config.py`:

```python
"""One config for the agent service (spec §5.3 "behind one config file"): model provider, models per tier, timeouts.

Values come from the environment, then from the repo's git-ignored `.env.local` (never committed, never logged).
"""

import os
from collections.abc import Mapping
from dataclasses import dataclass, field
from pathlib import Path
from typing import Literal

REPO = Path(__file__).resolve().parents[3]
ENV_FILE = REPO / ".env.local"

Provider = Literal["stub", "openai"]
Tier = Literal["small", "large"]
Effort = Literal["low", "medium", "high"]

# Both tiers default to the same model; set TOUCHLINE_MODEL_SMALL / TOUCHLINE_MODEL_LARGE to split them.
DEFAULT_MODEL = "gpt-6.1-sol"
# gpt-6.1-sol rejects "none" and "minimal"; "low" is its fastest (about 5 s for a short structured answer, 2026-10-07).
DEFAULT_EFFORT: Effort = "low"

# Seconds each agent may take before its deterministic fallback is used (spec §6). The whole moment must fit the
# gateway's 4 s budget when live; recorded runs (cached replay) can raise these with TOUCHLINE_TIMEOUT_SCALE.
TIMEOUTS_S: Mapping[str, float] = {
    "detector": 1.5,
    "analyst": 6.0,
    "narrator": 3.0,
    "factchecker": 2.0,
    "personalizer": 3.0,
    "recap": 20.0,
    "judge": 20.0,
}


class SettingsError(Exception):
    """The configuration cannot work (e.g. the OpenAI provider without a key)."""


@dataclass(frozen=True)
class Settings:
    provider: Provider
    small_model: str
    large_model: str
    timeout_scale: float
    mcp_allowed_hosts: frozenset[str]
    checkpoint_dir: Path | None
    reasoning_effort: Effort = DEFAULT_EFFORT
    # Kept out of repr so the key never reaches a log line or a test report.
    openai_api_key: str | None = field(default=None, repr=False)

    def model(self, tier: Tier) -> str:
        return self.small_model if tier == "small" else self.large_model

    def timeout(self, agent: str) -> float:
        return TIMEOUTS_S[agent] * self.timeout_scale

    @property
    def model_label(self) -> str:
        """What produced the text, recorded with every trace: `stub`, or the provider and models."""
        if self.provider == "stub":
            return "stub"
        return f"openai:{self.small_model}" if self.small_model == self.large_model else f"openai:{self.small_model}+{self.large_model}"


def read_env_file(path: Path) -> dict[str, str]:
    """KEY=VALUE lines (blank lines, comments and an optional `export ` prefix allowed; quotes stripped)."""
    if not path.is_file():
        return {}
    out: dict[str, str] = {}
    for line in path.read_text().splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.removeprefix("export ").split("=", 1)
        out[key.strip()] = value.strip().strip("'\"")
    return out


def load_settings(env: Mapping[str, str] | None = None, env_file: Path | None = ENV_FILE) -> Settings:
    """Settings from `env` (default: os.environ), falling back to `env_file` for anything unset."""
    merged = {**(read_env_file(env_file) if env_file else {}), **(os.environ if env is None else env)}
    provider = merged.get("TOUCHLINE_LLM", "stub")
    if provider not in ("stub", "openai"):
        raise SettingsError(f'TOUCHLINE_LLM must be "stub" or "openai", not "{provider}"')
    key = merged.get("OPENAI_API_KEY") or None
    if provider == "openai" and not key:
        raise SettingsError("TOUCHLINE_LLM=openai needs OPENAI_API_KEY (in the environment or in the repo's .env.local)")
    try:
        scale = float(merged.get("TOUCHLINE_TIMEOUT_SCALE", "1"))
    except ValueError:
        raise SettingsError("TOUCHLINE_TIMEOUT_SCALE must be a number") from None
    if not scale > 0:
        raise SettingsError("TOUCHLINE_TIMEOUT_SCALE must be positive")
    effort = merged.get("TOUCHLINE_REASONING", DEFAULT_EFFORT)
    if effort not in ("low", "medium", "high"):
        raise SettingsError(f'TOUCHLINE_REASONING must be low, medium or high, not "{effort}"')
    hosts = merged.get("TOUCHLINE_MCP_HOSTS", "127.0.0.1,localhost,::1")
    cp = merged.get("TOUCHLINE_CHECKPOINTS")
    return Settings(
        provider=provider,
        small_model=merged.get("TOUCHLINE_MODEL_SMALL", DEFAULT_MODEL),
        large_model=merged.get("TOUCHLINE_MODEL_LARGE", DEFAULT_MODEL),
        timeout_scale=scale,
        mcp_allowed_hosts=frozenset(h.strip() for h in hosts.split(",") if h.strip()),
        checkpoint_dir=Path(cp) if cp else None,
        reasoning_effort=effort,
        openai_api_key=key,
    )
```

Create `services/agents/touchline_agents/llm.py`:

```python
"""Model access behind one interface (spec §11): the OpenAI client, or a deterministic stub for tests and CI.

Every agent sends one user message: `TASK: <task>` and its input as JSON. The stub answers each task with a
registered responder (the agent's own deterministic logic), so a stubbed run exercises the whole Agent Framework
path (prompt, structured output, tool calls over MCP) and is reproducible.
"""

import asyncio
import json
import logging
import re
import time
from collections.abc import Callable, Mapping, Sequence
from dataclasses import dataclass
from typing import Any, Literal

from agent_framework import (
    Agent,
    BaseChatClient,
    ChatMiddlewareLayer,
    ChatResponse,
    ChatResponseUpdate,
    Content,
    FunctionInvocationLayer,
    Message,
)
from agent_framework.observability import ChatTelemetryLayer
from pydantic import BaseModel

from .config import Settings, Tier

log = logging.getLogger("touchline.agents")

_ENVELOPE = re.compile(r"\ATASK: (?P<task>[a-z_]+)\nINPUT:\n(?P<input>.*)\Z", re.S)


def envelope(task: str, payload: Mapping[str, Any]) -> str:
    """The single user message every agent sends."""
    return f"TASK: {task}\nINPUT:\n{json.dumps(payload, ensure_ascii=False, sort_keys=True)}"


def parse_envelope(text: str) -> tuple[str, dict]:
    m = _ENVELOPE.match(text)
    if not m:
        raise ValueError("not a Touchline task message")
    return m["task"], json.loads(m["input"])


@dataclass(frozen=True)
class ToolCalls:
    """A stub responder's request to call tools before it answers: [(tool name, arguments), ...]."""

    calls: Sequence[tuple[str, Mapping[str, Any]]]


# task -> responder(input, tool results so far) -> the answer as JSON-ready data, or ToolCalls.
Responder = Callable[[dict, list[str]], "dict | ToolCalls"]
STUB_RESPONDERS: dict[str, Responder] = {}


def stub_responder(task: str) -> Callable[[Responder], Responder]:
    """Register how the stub model answers `task` (each agent module registers its own)."""

    def register(fn: Responder) -> Responder:
        STUB_RESPONDERS[task] = fn
        return fn

    return register


StubBehaviour = Literal["ok", "error", "garbage", "slow"]


class StubChatClient(FunctionInvocationLayer, ChatMiddlewareLayer, ChatTelemetryLayer, BaseChatClient):
    """A deterministic chat client. `ok` answers with the registered responder; `error` raises, `garbage` returns text
    that is not the requested JSON and `slow` never answers in time: the three ways a real model fails."""

    OTEL_PROVIDER_NAME = "touchline-stub"

    def __init__(self, behaviour: StubBehaviour = "ok", *, slow_s: float = 60.0, **kwargs: Any) -> None:
        super().__init__(**kwargs)
        self.behaviour = behaviour
        self.slow_s = slow_s
        self.calls: list[str] = []

    def _answer(self, messages: Sequence[Message]) -> Message:
        text = next((m.text for m in messages if m.role == "user"), "")
        task, payload = parse_envelope(text)
        self.calls.append(task)
        if self.behaviour == "error":
            raise RuntimeError("stub model error")
        if self.behaviour == "garbage":
            return Message("assistant", [Content.from_text("Sorry, I can't help with that.")])
        results = [str(c.result) for m in messages for c in m.contents if c.type == "function_result"]
        out = STUB_RESPONDERS[task](payload, results)
        if isinstance(out, ToolCalls):
            calls = [Content.from_function_call(call_id=f"stub-{i}", name=n, arguments=dict(a)) for i, (n, a) in enumerate(out.calls)]
            return Message("assistant", calls)
        return Message("assistant", [Content.from_text(json.dumps(out, ensure_ascii=False))])

    def _inner_get_response(self, *, messages, stream, options, **kwargs):
        async def respond() -> Message:
            if self.behaviour == "slow":
                await asyncio.sleep(self.slow_s)
            return self._answer(messages)

        if stream:

            async def gen():
                msg = await respond()
                yield ChatResponseUpdate(role="assistant", contents=msg.contents)

            return self._build_response_stream(gen(), response_format=options.get("response_format"))

        async def resp() -> ChatResponse:
            return ChatResponse(messages=[await respond()], response_id="stub")

        return resp()


def make_client(settings: Settings, tier: Tier) -> BaseChatClient:
    """The chat client for a model tier."""
    if settings.provider == "stub":
        return StubChatClient()
    from agent_framework.openai import OpenAIChatClient

    return OpenAIChatClient(model=settings.model(tier), api_key=settings.openai_api_key)


def agent_options(settings: Settings) -> dict[str, Any]:
    """Default options for every agent's model calls (the stub ignores them)."""
    return {} if settings.provider == "stub" else {"reasoning": {"effort": settings.reasoning_effort}}


@dataclass(frozen=True)
class Outcome[T]:
    value: T
    fallback: bool
    # Why the fallback was used (exception type or "invalid"); None when the model answered.
    reason: str | None
    ms: float


async def run_structured[T: BaseModel](
    agent: Agent,
    task: str,
    payload: Mapping[str, Any],
    output: type[T],
    *,
    timeout_s: float,
    fallback: Callable[[], T],
    accept: Callable[[T], bool] = lambda _: True,
) -> Outcome[T]:
    """Ask `agent` for `output`; on a timeout, a model error, unparseable output or output `accept` rejects, use
    `fallback()` instead (spec §6: every agent has a deterministic fallback, so the match never goes silent)."""
    t0 = time.perf_counter()
    reason: str | None = None
    try:
        r = await asyncio.wait_for(agent.run(envelope(task, payload), options={"response_format": output}), timeout_s)
        value = r.value
        if isinstance(value, output) and accept(value):
            return Outcome(value, False, None, (time.perf_counter() - t0) * 1000)
        reason = "invalid"
    except TimeoutError:
        reason = "timeout"
    except Exception as e:  # any model or parsing failure means: use the fallback
        reason = type(e).__name__
        log.warning("%s: model failed (%s), using the fallback", task, reason)
    return Outcome(fallback(), True, reason, (time.perf_counter() - t0) * 1000)
```

- [ ] **Step 6: Run the tests**

Run: `uv run --project services/agents pytest -q services/agents`
Expected: 35 passed, 1 deselected (the live test is deselected)

Optional, with the key in `.env.local` (one or two real `gpt-6.1-sol` calls; skipped by the default run):

Run: `uv run --project services/agents pytest -q -m live services/agents/tests/test_llm.py`
Expected: 1 passed in about 5 s: `gpt-6.1-sol` returns the structured answer

- [ ] **Step 7: Commit**

```bash
git add services/agents
git commit -m "feat(agents): agent service scaffold — generated Pydantic contracts, config (OpenAI gpt-6.1-sol or stub), stub chat client, structured runs with fallbacks

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```



### Task 3: MCP stats client

The agents read the match only through the MCP stats server (spec §5.3). `StatsClient` wraps Agent Framework's `MCPStreamableHTTPTool`:
- Code calls the tools directly with typed helpers. A tool's refusal becomes `StatsError`.
- Models see only the fast read-only tools (`MODEL_TOOLS`, added in Task 6). The re-simulation tools take seconds and stay off the live path.
- The MCP URL arrives inside A2A requests, so only `http(s)` on an allowed host is accepted. By default that is loopback; anything else, such as a cloud metadata address, is refused before connecting.

`serve_run` starts `pnpm mcp-stats --run <dir> --http 0` for tests and the evaluation harness. The tests' session fixture simulates one scripted match (`costly_error`, seed 2) and serves it once per session.

**Files:**
- Create: `services/agents/touchline_agents/stats.py`, `services/agents/tests/conftest.py`
- Modify: `services/agents/pyproject.toml` (every test in one event loop)
- Test: `services/agents/tests/test_stats.py`

**Interfaces:**
- Consumes: `pnpm mcp-stats` (Plan 3a: `--http 0` prints `touchline-stats MCP on http://127.0.0.1:<port>/mcp` on stderr), `REPO`.
- Produces: `StatsError`, `check_url(url, allowed_hosts)`, `StatsClient(url, allowed_hosts)` (async context manager; `.tool`, `.call(name, **args)`, `.match_info(at_frame)`, `.roster()`, `.metric(...)`, `.verify(...)`, `.events(from, to, types, limit, **kw)`, `.decision(event_id, at_frame)`, `.signals(...)`), `names(info)`, `serve_run(run_dir)`; test fixtures `run_dir`, `manifest`, `stats_url`, `stats` and `MATCH_ID = "agents-test"`.

- [ ] **Step 1: Write the failing tests**

Create `services/agents/tests/conftest.py`:

```python
"""Shared fixtures: one simulated match (scenario `costly_error`, seed 2) and its MCP stats server, once per session."""

import json
import subprocess
from pathlib import Path

import pytest

from touchline_agents.config import REPO
from touchline_agents.stats import StatsClient, serve_run

MATCH_ID = "agents-test"


@pytest.fixture(scope="session")
def run_dir(tmp_path_factory) -> Path:
    out = tmp_path_factory.mktemp("runs") / MATCH_ID
    subprocess.run(
        ["pnpm", "-s", "sim", "--scenario", "costly_error", "--seed", "2", "--match-id", MATCH_ID, "--out", str(out)],
        cwd=REPO, check=True, capture_output=True,
    )
    return out


@pytest.fixture(scope="session")
def manifest(run_dir) -> dict:
    return json.loads((run_dir / "manifest.json").read_text())


@pytest.fixture(scope="session")
async def stats_url(run_dir):
    async with serve_run(run_dir) as url:
        yield url


@pytest.fixture
async def stats(stats_url):
    async with StatsClient(stats_url) as client:
        yield client
```

Create `services/agents/tests/test_stats.py`:

```python
import pytest

from touchline_agents.stats import StatsClient, StatsError, check_url, names

LOCAL = frozenset({"127.0.0.1", "localhost"})


def test_only_allowed_hosts():
    assert check_url("http://127.0.0.1:7801/mcp", LOCAL) == "http://127.0.0.1:7801/mcp"
    for bad in ["http://169.254.169.254/latest", "file:///etc/passwd", "http://evil.example/mcp", "not a url"]:
        with pytest.raises(StatsError):
            check_url(bad, LOCAL)


async def test_reads_the_match(stats, manifest):
    info = await stats.match_info()
    assert info["match_id"] == manifest["match_id"]
    who = names(info)
    assert who[info["home"]["id"]] == info["home"]["name"] and len(who) > 22


async def test_metric_and_claim_check_agree(stats):
    info = await stats.roster()
    team = info["home"]["id"]
    m = await stats.metric("team.press", team, at_frame=30000)
    assert m["as_of_frame"] == 30000 and m["ref"].startswith("team.press@")
    assert (await stats.verify("team.press", team, 30000, m["value"]))["verified"]
    assert not (await stats.verify("team.press", team, 30000, m["value"] + 0.2))["verified"]


async def test_nothing_after_the_frame(stats):
    events = await stats.events(0, 5000, types=["pass"], limit=500)
    assert events and all(e["frame_id"] <= 5000 for e in events)
    assert all(s["frame_id"] <= 5000 for s in await stats.signals(to_frame=5000))


async def test_tool_errors_become_stats_errors(stats):
    with pytest.raises(StatsError, match="unknown subject"):
        await stats.metric("team.press", "nobody", at_frame=100)
    with pytest.raises(StatsError):
        await stats.decision("no-such-event")


async def test_decision_records_rank_options(stats):
    p = next(e for e in await stats.events(0, 20000, types=["pass"], limit=500) if e["player_id"])
    d = await stats.decision(p["id"])
    assert d["event_id"] == p["id"] and d["options"] and d["chosen_rank"] is not None


def test_disallowed_host_refused_before_connecting():
    with pytest.raises(StatsError, match="not allowed"):
        StatsClient("http://10.0.0.8:7801/mcp", LOCAL)
```

- [ ] **Step 2: Run them to make sure they fail**

Run: `uv run --project services/agents pytest -q services/agents/tests/test_stats.py`
Expected: the conftest fails to load: `ModuleNotFoundError: No module named 'touchline_agents.stats'`

- [ ] **Step 3: Write the client**

Apply this change to `services/agents/pyproject.toml` (from the repository root):

```bash
git apply <<'PATCH'
diff --git a/services/agents/pyproject.toml b/services/agents/pyproject.toml
index 24a68c4..2e76246 100644
--- a/services/agents/pyproject.toml
+++ b/services/agents/pyproject.toml
@@ -29,5 +29,6 @@ dev = ["pytest==9.1.1", "pytest-asyncio==1.4.0", "datamodel-code-generator==0.83
 [tool.pytest.ini_options]
 asyncio_mode = "auto"
 asyncio_default_fixture_loop_scope = "session"
+asyncio_default_test_loop_scope = "session"
 markers = ["live: calls the real model API (needs OPENAI_API_KEY; run with -m live)"]
 addopts = "-m 'not live'"
PATCH
```

Create `services/agents/touchline_agents/stats.py`:

```python
"""The agents' only view of the match: the MCP stats server (packages/mcp-stats, spec §5.3 "no agent computes a statistic").

`StatsClient` wraps Agent Framework's MCP tool so code can call the tools directly (evidence packs, the Fact-Checker's
code checks) and models can call them as tools (the Analyst).
"""

import asyncio
import json
import os
import re
import signal
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Any
from urllib.parse import urlparse

from agent_framework import MCPStreamableHTTPTool
from agent_framework.exceptions import ToolExecutionException

from .config import REPO


class StatsError(Exception):
    """A stats tool refused the request (unknown id, no such event, ...) or the server is unusable."""


def check_url(url: str, allowed_hosts: frozenset[str]) -> str:
    """The MCP URL arrives in A2A requests: accept http(s) on an allowed host only, so a request cannot point the
    agent service at an arbitrary server."""
    u = urlparse(url)
    if u.scheme not in ("http", "https") or u.hostname is None:
        raise StatsError(f"MCP URL must be http(s)://host[:port]/path, got {url!r}")
    if u.hostname not in allowed_hosts:
        raise StatsError(f"MCP host {u.hostname!r} is not allowed (TOUCHLINE_MCP_HOSTS: {', '.join(sorted(allowed_hosts))})")
    return url


class StatsClient:
    """One match's stats tools. Use as an async context manager."""

    def __init__(self, url: str, allowed_hosts: frozenset[str] = frozenset({"127.0.0.1", "localhost", "::1"})) -> None:
        self.url = check_url(url, allowed_hosts)
        self.tool = MCPStreamableHTTPTool(name="stats", url=self.url, load_prompts=False)
        self._info: dict | None = None

    async def __aenter__(self) -> "StatsClient":
        await self.tool.connect()
        return self

    async def __aexit__(self, *exc: object) -> None:
        await self.tool.close()

    async def call(self, name: str, **args: Any) -> dict:
        """Call a tool and parse its JSON answer; a tool error becomes StatsError."""
        try:
            out = await self.tool.call_tool(name, **{k: v for k, v in args.items() if v is not None})
        except ToolExecutionException as e:
            raise StatsError(str(e)) from None
        text = "".join(c.text or "" for c in out if c.type == "text")
        try:
            return json.loads(text)
        except json.JSONDecodeError:
            raise StatsError(f"{name}: not JSON: {text[:200]}") from None

    async def match_info(self, at_frame: int | None = None) -> dict:
        return await self.call("match_info", at_frame=at_frame)

    async def roster(self) -> dict:
        """Teams and players (cached: they do not change during a match)."""
        if self._info is None:
            self._info = await self.match_info()
        return self._info

    async def metric(self, metric_id: str, subject: str, at_frame: int, window_s: float | None = None) -> dict:
        return await self.call("get_metric", metric_id=metric_id, subject=subject, at_frame=at_frame, window_s=window_s)

    async def verify(self, metric_id: str, subject: str, at_frame: int, value: float, window_s: float | None = None) -> dict:
        return await self.call("verify_claim", metric_id=metric_id, subject=subject, at_frame=at_frame, value=value, window_s=window_s)

    async def events(self, from_frame: int, to_frame: int, types: list[str] | None = None, limit: int = 100, **kw: Any) -> list[dict]:
        return (await self.call("get_events", from_frame=from_frame, to_frame=to_frame, types=types, limit=limit, **kw))["events"]

    async def decision(self, event_id: str, at_frame: int | None = None) -> dict:
        return await self.call("get_decision", event_id=event_id, at_frame=at_frame)

    async def signals(self, from_frame: int | None = None, to_frame: int | None = None, limit: int = 500, **kw: Any) -> list[dict]:
        return (await self.call("get_signals", from_frame=from_frame, to_frame=to_frame, limit=limit, **kw))["signals"]


def names(info: dict) -> dict[str, str]:
    """Team and player ids to display names, from match_info."""
    out: dict[str, str] = {}
    for side in ("home", "away"):
        team = info[side]
        out[team["id"]] = team["name"]
        for p in team["players"]:
            out[p["id"]] = p["name"]
    return out


_LISTENING = re.compile(r"touchline-stats MCP on (http://\S+/mcp)")


@asynccontextmanager
async def serve_run(run_dir: Path, startup_s: float = 60.0) -> AsyncIterator[str]:
    """Start `pnpm mcp-stats --run <run_dir> --http 0` and yield its URL; stop it on exit. For tests and the
    evaluation harness (the TypeScript gateway starts its own)."""
    proc = await asyncio.create_subprocess_exec(
        "pnpm", "-s", "mcp-stats", "--run", str(Path(run_dir).resolve()), "--http", "0",
        cwd=REPO, stdout=asyncio.subprocess.DEVNULL, stderr=asyncio.subprocess.PIPE, start_new_session=True,
    )
    assert proc.stderr is not None
    try:
        lines: list[str] = []

        async def wait_url() -> str:
            while line := (await proc.stderr.readline()).decode():
                lines.append(line)
                if m := _LISTENING.search(line):
                    return m[1]
            raise StatsError(f"mcp-stats exited before listening: {''.join(lines)[-500:]}")

        url = await asyncio.wait_for(wait_url(), startup_s)
        # Keep draining stderr so the server never blocks on a full pipe.
        drain = asyncio.create_task(proc.stderr.read())
        yield url
        drain.cancel()
    finally:
        if proc.returncode is None:
            os.killpg(proc.pid, signal.SIGTERM)
            await proc.wait()
```

- [ ] **Step 4: Run the tests**

Run: `uv run --project services/agents pytest -q services/agents/tests/test_stats.py`
Expected: 7 passed in about 10 s (one simulated match and its MCP server per session); no `mcp-stats` process is left running afterwards (`pgrep -f "cli.ts --run"` prints nothing)

- [ ] **Step 5: Commit**

```bash
git add services/agents
git commit -m "feat(agents): MCP stats client — typed calls over Streamable HTTP, allowed hosts only, test server per session

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```



### Task 4: Moment Detector

The Moment Detector (spec §5.3) turns a batch of new signals into moments. Code owns the rules that must hold whatever the model says:
- Goals and red cards are always promoted.
- A signal inside its cooldown (per type and team) never is.
- Signals of the same play (the same team, within 10 s, of equal or lower importance) merge into one moment.
- At most two moments come out of a batch.

The model only chooses among candidates with salience 0.25 or more. The fallback, and the stub, promote by salience (0.5 or more). With nothing to rank, the model is not called at all.

**Files:**
- Create: `services/agents/touchline_agents/detector.py`, `services/agents/tests/__init__.py` (empty), `services/agents/tests/factories.py`
- Test: `services/agents/tests/test_detector.py`

**Interfaces:**
- Consumes: `Signal`, `Moment` (Task 2), `run_structured`, `stub_responder`, `agent_options`.
- Produces: `COOLDOWN_S`, `PRIORITY`, `PROMOTE_SALIENCE = 0.5`, `CANDIDATE_SALIENCE = 0.25`, `MAX_PER_BATCH = 2`, `MERGE_S = 10`, `Selection`, `is_must(s)`, `priority(s)`, `DetectorState(fps)` (`.last`, `.moments`, `.cooling(s)`), `candidates(signals, state)`, `rule_selection(cands)`, `enforce(chosen, cands)`, `build_moments(ids, signals, state, source)`, `Detection`, `MomentDetector(client, settings).detect(signals, state)`; the moment id is `mo-<lead signal id>`; test factories `signal(...)`, `moment(...)`.

- [ ] **Step 1: Write the failing tests**

Create `services/agents/tests/factories.py`:

```python
"""Hand-built contract values for unit tests."""

from touchline_agents.contracts import Moment, Signal


def signal(type_: str, frame: int, *, team: str | None = "home-fc", player: str | None = None, salience: float = 0.6, span: int = 0, **data: float) -> Signal:
    return Signal(
        id=f"m-{type_}-{frame}-{team}", match_id="m", type=type_, frame_id=frame, frame_from=frame - span, frame_to=frame,
        period="first_half" if frame < 30000 else "second_half", match_clock=f"{frame // 600:02d}:{frame % 600 // 10:02d}.00",
        team_id=team, player_id=player, metric=None, value=None, salience=salience, evidence=[], data=data,
    )


def moment(type_: str = "goal", frame: int = 3000, team: str | None = "home-fc", player: str | None = None, span: int = 50) -> Moment:
    return Moment(
        moment_id=f"mo-{type_}-{frame}", match_id="m", type=type_, signal_ids=[f"m-{type_}-{frame}"], frame_id=frame,
        frame_from=frame - span, frame_to=frame, period="first_half" if frame < 30000 else "second_half",
        match_clock=f"{frame // 600:02d}:{frame % 600 // 10:02d}.00", team_id=team, player_id=player, salience=0.9,
        priority=1, source="rules",
    )
```

Create the empty `services/agents/tests/__init__.py`.

Create `services/agents/tests/test_detector.py`:

```python
from touchline_agents.config import load_settings
from touchline_agents.detector import (
    MAX_PER_BATCH, DetectorState, MomentDetector, build_moments, candidates, enforce, rule_selection,
)
from touchline_agents.llm import StubChatClient

from .factories import signal

SETTINGS = load_settings({}, env_file=None)


def state() -> DetectorState:
    return DetectorState(fps=10)


def test_goals_and_red_cards_always_promoted_even_past_the_cap():
    sigs = [signal("goal", 100, salience=1), signal("goal", 400, team="away-fc", salience=1), signal("card", 500, salience=0.9, red=1),
            signal("pressure_shift", 600, salience=0.85)]
    ids = rule_selection(candidates(sigs, state()))
    assert ids[:3] == ["m-goal-100-home-fc", "m-goal-400-away-fc", "m-card-500-home-fc"] and len(ids) == 3


def test_yellow_cards_and_low_salience_wait_for_the_rules_threshold():
    sigs = [signal("card", 100, salience=0.5, red=0), signal("speed_alert", 200, salience=0.28), signal("distance_milestone", 300, salience=0.15)]
    c = candidates(sigs, state())
    assert [s.type for s in c] == ["card", "speed_alert"]  # 0.15 is below even the model's floor
    assert rule_selection(c) == ["m-card-100-home-fc"]


def test_cooldown_holds_back_the_same_type_for_the_same_team():
    st = state()
    build_moments(["m-pressure_shift-3000-home-fc"], [signal("pressure_shift", 3000)], st, "rules")
    later = [signal("pressure_shift", 4000), signal("pressure_shift", 4000, team="away-fc"), signal("pressure_shift", 6100)]
    assert [s.id for s in candidates(later, st)] == ["m-pressure_shift-4000-away-fc", "m-pressure_shift-6100-home-fc"]


def test_signals_of_the_same_play_merge_into_one_moment():
    st = state()
    sigs = [signal("goal", 1000, salience=1, span=30), signal("big_chance", 1000, salience=0.7), signal("speed_alert", 980, salience=0.4),
            signal("big_chance", 1000, team="away-fc", salience=0.7)]
    sigs[3] = sigs[3].model_copy(update={"id": "m-big_chance-1000-away"})
    [m] = build_moments(["m-goal-1000-home-fc"], sigs, st, "rules")
    assert m.type == "goal" and m.priority == 1 and set(m.signal_ids) == {"m-goal-1000-home-fc", "m-big_chance-1000-home-fc", "m-speed_alert-980-home-fc"}
    assert (m.frame_from, m.frame_to) == (970, 1000)
    assert st.moments == [m] and st.last[("big_chance", "home-fc")] == 1000


def test_model_choices_are_held_to_the_rules():
    c = candidates([signal("goal", 10, salience=1), signal("momentum_swing", 20, salience=0.4), signal("speed_alert", 30, salience=0.3)], state())
    assert enforce(["made-up", "m-speed_alert-30-home-fc", "m-momentum_swing-20-home-fc"], c) == ["m-goal-10-home-fc", "m-speed_alert-30-home-fc"]
    assert len(enforce([s.id for s in c], c)) == MAX_PER_BATCH


async def test_detects_through_the_model():
    d = MomentDetector(StubChatClient(), SETTINGS)
    out = await d.detect([signal("momentum_swing", 3500, salience=0.8), signal("speed_alert", 3600, salience=0.3)], st := state())
    assert not out.fallback and [m.type for m in out.moments] == ["momentum_swing"] and out.moments[0].source == "model"
    assert st.moments == out.moments


async def test_falls_back_to_the_rules_when_the_model_fails():
    d = MomentDetector(StubChatClient("error"), SETTINGS)
    out = await d.detect([signal("goal", 100, salience=1)], state())
    assert out.fallback and out.reason == "RuntimeError" and out.moments[0].source == "rules"


async def test_nothing_to_rank_skips_the_model():
    client = StubChatClient()
    out = await MomentDetector(client, SETTINGS).detect([signal("distance_milestone", 100, salience=0.15)], state())
    assert out.moments == [] and client.calls == []
```

- [ ] **Step 2: Run them to make sure they fail**

Run: `uv run --project services/agents pytest -q services/agents/tests/test_detector.py`
Expected: a collection error: `ModuleNotFoundError: No module named 'touchline_agents.detector'`

- [ ] **Step 3: Write the detector**

Create `services/agents/touchline_agents/detector.py`:

```python
"""Moment Detector (spec §5.3): ranks new signals and promotes the ones worth a cue, with cooldowns.

Code owns the rules that must hold whatever the model says: goals and red cards are always promoted, a signal in its
cooldown never is, signals of the same play merge into one moment, and at most MAX_PER_BATCH moments come out of one
batch. The model only chooses among the remaining candidates; without it, salience decides (the fallback).
"""

from dataclasses import dataclass, field

from agent_framework import Agent, BaseChatClient
from pydantic import BaseModel, ConfigDict

from .config import Settings
from .contracts import Moment, Signal
from .llm import agent_options, run_structured, stub_responder

# Seconds before a signal of the same type for the same team can be promoted again (0: never held back).
COOLDOWN_S: dict[str, float] = {
    "goal": 0, "card": 0, "big_chance": 30, "pressure_shift": 300, "momentum_swing": 300, "chaos_spike": 300,
    "substitution_impact": 300, "difficult_pass_completed": 120, "speed_alert": 300, "player_milestone": 300,
    "distance_milestone": 600,
}
PRIORITY: dict[str, int] = {
    "goal": 1, "big_chance": 2, "pressure_shift": 2, "momentum_swing": 2, "chaos_spike": 2, "substitution_impact": 2,
    "card": 3, "difficult_pass_completed": 3, "speed_alert": 3, "player_milestone": 3, "distance_milestone": 3,
}
PROMOTE_SALIENCE = 0.5  # the rules promote at or above this
CANDIDATE_SALIENCE = 0.25  # the model may promote at or above this
MAX_PER_BATCH = 2
MERGE_S = 10.0  # signals of the same team this close to a promoted one belong to its play

INSTRUCTIONS = """You are the Moment Detector for a live football broadcast overlay.
INPUT lists candidate signals from the stats engine (id, type, team, player, clock, salience 0..1, value, data), the
moments already shown recently, and `max`, the most you may promote. Promote only what a viewer would want a caption
for now: decisive or unusual events, clear shifts in pressure or momentum. Prefer variety over repeating what was just
shown. Ids in `must` are always promoted; list them too. Answer with the ids to promote, most important first."""


class Selection(BaseModel):
    model_config = ConfigDict(extra="forbid")
    promote: list[str]


def is_must(s: Signal) -> bool:
    return s.type == "goal" or (s.type == "card" and s.data.get("red", 0) == 1)


def priority(s: Signal) -> int:
    return 1 if is_must(s) else PRIORITY[s.type]


@dataclass
class DetectorState:
    """Per match: when each (type, team) was last promoted, and the moments so far."""

    fps: float
    last: dict[tuple[str, str | None], int] = field(default_factory=dict)
    moments: list[Moment] = field(default_factory=list)

    def cooling(self, s: Signal) -> bool:
        last = self.last.get((s.type, s.team_id))
        return last is not None and s.frame_id - last < COOLDOWN_S[s.type] * self.fps


def candidates(signals: list[Signal], state: DetectorState) -> list[Signal]:
    """Signals that may be promoted, most important first."""
    ok = [s for s in signals if is_must(s) or (s.salience >= CANDIDATE_SALIENCE and not state.cooling(s))]
    return sorted(ok, key=lambda s: (priority(s), -s.salience, s.frame_id))


def rule_selection(cands: list[Signal]) -> list[str]:
    """The fallback: every must, then the most salient above PROMOTE_SALIENCE, at most MAX_PER_BATCH in all."""
    must = [s.id for s in cands if is_must(s)]
    rest = [s.id for s in cands if not is_must(s) and s.salience >= PROMOTE_SALIENCE]
    return must + rest[: max(0, MAX_PER_BATCH - len(must))]


def enforce(chosen: list[str], cands: list[Signal]) -> list[str]:
    """What the model chose, made to obey the rules: known candidates only, musts always, the cap otherwise."""
    known = {s.id for s in cands}
    must = [s.id for s in cands if is_must(s)]
    picked = [i for i in dict.fromkeys(chosen) if i in known and i not in must]
    return must + picked[: max(0, MAX_PER_BATCH - len(must))]


def build_moments(ids: list[str], signals: list[Signal], state: DetectorState, source: str) -> list[Moment]:
    """Turn promoted signal ids into moments (merging the batch's signals of the same play) and update the state."""
    by_id = {s.id: s for s in signals}
    used: set[str] = set()
    out: list[Moment] = []
    gap = MERGE_S * state.fps
    for lead in sorted((by_id[i] for i in ids), key=lambda s: (priority(s), -s.salience)):
        if lead.id in used:
            continue
        play = [lead] + [
            s for s in signals
            if s.id not in used and s.id != lead.id and s.team_id == lead.team_id
            and s.frame_from <= lead.frame_to + gap and lead.frame_from <= s.frame_to + gap
            and priority(s) >= priority(lead)
        ]
        used.update(s.id for s in play)
        for s in play:
            state.last[(s.type, s.team_id)] = s.frame_id
        m = Moment(
            moment_id=f"mo-{lead.id}", match_id=lead.match_id, type=lead.type, signal_ids=[s.id for s in play],
            frame_id=lead.frame_id, frame_from=min(s.frame_from for s in play), frame_to=max(s.frame_to for s in play),
            period=lead.period, match_clock=lead.match_clock, team_id=lead.team_id, player_id=lead.player_id,
            salience=lead.salience, priority=priority(lead), source=source,
        )
        out.append(m)
    state.moments.extend(out)
    return out


def detector_input(cands: list[Signal], state: DetectorState) -> dict:
    return {
        "max": MAX_PER_BATCH,
        "must": [s.id for s in cands if is_must(s)],
        "candidates": [
            {"id": s.id, "type": s.type, "team": s.team_id, "player": s.player_id, "clock": s.match_clock,
             "salience": round(s.salience, 3), "value": s.value, "data": s.data}
            for s in cands
        ],
        "recent": [{"type": m.type, "team": m.team_id, "clock": m.match_clock} for m in state.moments[-5:]],
    }


@stub_responder("detect")
def _stub(payload: dict, _results: list[str]) -> dict:
    ids = payload["must"] + [c["id"] for c in payload["candidates"] if c["id"] not in payload["must"] and c["salience"] >= PROMOTE_SALIENCE]
    return {"promote": ids[: max(payload["max"], len(payload["must"]))]}


@dataclass(frozen=True)
class Detection:
    moments: list[Moment]
    fallback: bool
    reason: str | None
    ms: float


class MomentDetector:
    def __init__(self, client: BaseChatClient, settings: Settings) -> None:
        self.settings = settings
        self.agent = Agent(client=client, name="moment_detector", instructions=INSTRUCTIONS, default_options=agent_options(settings))

    async def detect(self, signals: list[Signal], state: DetectorState) -> Detection:
        cands = candidates(signals, state)
        if not cands:
            return Detection([], False, None, 0.0)
        out = await run_structured(
            self.agent, "detect", detector_input(cands, state), Selection,
            timeout_s=self.settings.timeout("detector"),
            fallback=lambda: Selection(promote=rule_selection(cands)),
        )
        ids = enforce(out.value.promote, cands) if not out.fallback else out.value.promote
        moments = build_moments(ids, signals, state, "rules" if out.fallback else "model")
        return Detection(moments, out.fallback, out.reason, out.ms)
```

- [ ] **Step 4: Run the tests**

Run: `uv run --project services/agents pytest -q services/agents/tests/test_detector.py`
Expected: 8 passed

- [ ] **Step 5: Commit**

```bash
git add services/agents
git commit -m "feat(agents): Moment Detector — model picks among candidates, code keeps goals and red cards, cooldowns, merging and the cap; salience rules as fallback

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```



### Task 5: Stats engine: costly_error signal and observable event qualifiers

Two gaps blocked spec §5.3.1's headline example, "a mis-hit under pressure versus a good interception":
- **No qualifiers.** `get_events` returned no qualitative facts, so no agent could tell a mis-hit from a clean pass. Events now carry `qualifiers`, an explicit allow-list of what a broadcaster could see: how a kick was struck (`execution`), the first touch, pressure, card colour, and so on. The simulator's ground truth (`scripted`) and decision-model internals stay out.
- **No signal.** An error that led to a shot raised no signal, so it could never become a moment. The new signal type `costly_error` fixes this. The spec calls its list "initial", so a new type fits.
  - **When it fires:** a visible error (a mis-hit pass or clearance, or a heavy, miscontrolled or missed first touch) gives the ball away, and the opponents shoot within 15 s before the erring team wins it back.
  - **Losing the ball:** a bad touch counts only when the opponents have the ball within 5 s. A loose touch the same team recovers does not count, even when the event is flagged `lost_possession`.
  - **Ground truth:** this is the manifest's definition of critical errors, computed live. On 12 checked matches the signals equal the manifest's critical errors exactly.

The JSON Schema and the Pydantic models are regenerated for the new signal type. The detector gives it cooldown 0 and priority 2. The stats golden file gains its two `costly_error` signals.

**Files:**
- Modify: `packages/stats/src/engine.ts`, `packages/stats/src/query.ts`, `packages/schema/src/stats.ts`, `packages/mcp-stats/src/server.ts` (get_events description), `packages/stats/test/replay.test.ts`, `services/agents/touchline_agents/detector.py`, `services/agents/tests/test_detector.py`
- Create: `packages/stats/test/errors.test.ts`, `packages/stats/test/qualifiers.test.ts`
- Regenerate: `packages/stats/test/golden/late-comeback-4245.json`, `packages/schema/json/agent-contracts.schema.json`, `services/agents/touchline_agents/contracts_gen.py`

**Interfaces:**
- Consumes: the stats engine's event handling (`onEvent`, `raise`, `emittedAt`), Plan 2c's critical-error rule (`packages/sim/src/truths.ts`).
- Produces: `COSTLY_ERROR_S = 15`; signal type `costly_error` (`team_id`/`player_id` of the error, `metric` `shot.xg` with the shot's xG, `frame_from` the error, `frame_to` the shot, `evidence` `[error id, shot id]`, `data` `{shot.xg?, goal, under_pressure}`, salience 0.95 for a goal, else 0.7 + 0.2 × xG up to 0.9); `QUALIFIERS` and `EventView.qualifiers`.

- [ ] **Step 1: Write the failing tests**

Create `packages/stats/test/errors.test.ts`:

```ts
import { describe, expect, it } from "vitest"
import type { DomainEvent } from "@touchline/schema"
import { COSTLY_ERROR_S, StatsEngine } from "../src/engine.js"
import { event, frame, INFO, models } from "./helpers.js"

/** Feed frames 0..last and the events at their ticks; return the costly_error signals. */
const run = (events: DomainEvent[], last: number) => {
  const eng = new StatsEngine(INFO, models())
  for (let t = 0; t <= last; t++) {
    eng.ingest({ kind: "frame", frame: frame(t) })
    for (const e of events.filter((x) => (x.frame_id_end ?? x.frame_id) === t)) eng.ingest({ kind: "event", event: e })
  }
  eng.finish()
  return eng.signals.filter((s) => s.type === "costly_error")
}
const mishit = (tick: number, attrs: DomainEvent["attrs"] = {}) =>
  event("pass", tick, { team_id: "home-fc", player_id: "h2", x: -30, y: 5, x_end: -20, y_end: 5, frame_id_end: tick + 5, outcome: "intercepted", attrs: { execution: "mishit", under_pressure: true, ...attrs } })
const shot = (tick: number, outcome = "saved") => event("shot", tick, { team_id: "away-fc", player_id: "a3", x: -40, y: 2, outcome })
const regain = (tick: number, team = "home-fc") => event("possession_change", tick, { team_id: team })

describe("costly errors", () => {
  it("are raised when a visible error gives the ball away and the opponents shoot within 15 s", () => {
    const pass = mishit(10)
    const s = shot(60, "goal")
    const [sig] = run([pass, regain(15, "away-fc"), s], 70)
    expect(sig).toMatchObject({ team_id: "home-fc", player_id: "h2", metric: "shot.xg", frame_from: 10, frame_to: 60, evidence: [pass.id, s.id] })
    expect(sig!.data).toMatchObject({ goal: 1, under_pressure: 1 })
    expect(sig!.salience).toBeGreaterThan(0.9)
  })

  it("count a heavy touch that lost the ball, and only once per error", () => {
    const touch = event("reception", 20, { team_id: "home-fc", player_id: "h3", x: -20, y: 0, attrs: { first_touch: "heavy", under_pressure: false } })
    const [sig, ...more] = run([touch, regain(30, "away-fc"), shot(80), shot(100)], 110)
    expect(sig).toMatchObject({ player_id: "h3", frame_from: 20, data: { goal: 0, under_pressure: 0 } })
    expect(more).toEqual([])
  })

  it("are not raised when the team won the ball back first, the shot came too late, or the error kept the ball", () => {
    expect(run([mishit(10), regain(15, "away-fc"), regain(40), shot(60)], 70)).toEqual([])
    expect(run([mishit(10), shot(10 + COSTLY_ERROR_S * 10 + 6)], 10 + COSTLY_ERROR_S * 10 + 10)).toEqual([])
    expect(run([mishit(10, {}), shot(60)].map((e) => (e.type === "pass" ? { ...e, outcome: "successful" } : e)), 70)).toEqual([])
    const kept = event("reception", 20, { team_id: "home-fc", player_id: "h3", attrs: { first_touch: "heavy" } })
    expect(run([kept, shot(80)], 90)).toEqual([])
    // A loose touch the same team recovers is not lost, whatever the touch was flagged: the opponents never had it.
    const loose = event("reception", 20, { team_id: "home-fc", player_id: "h3", attrs: { first_touch: "miscontrol", lost_possession: true } })
    expect(run([loose, regain(90, "away-fc"), shot(100)], 110)).toEqual([])
  })
})
```

Create `packages/stats/test/qualifiers.test.ts`:

```ts
import { describe, expect, it } from "vitest"
import { StatsEngine } from "../src/engine.js"
import { QUALIFIERS, StatsQuery } from "../src/query.js"
import { event, frame, INFO, models } from "./helpers.js"

describe("event qualifiers", () => {
  it("carry what a broadcaster could see and never the script's ground truth", () => {
    const eng = new StatsEngine(INFO, models())
    eng.ingest({ kind: "frame", frame: frame(0) })
    const pass = event("pass", 0, {
      team_id: "home-fc", player_id: "h2", x: -10, y: 5, x_end: 0, y_end: 5, frame_id_end: 1, outcome: "intercepted",
      attrs: { execution: "mishit", under_pressure: true, scripted: true, fallback: false, best_receiver_id: "h3", intended_receiver_id: "h3", kind: "short" }
    })
    eng.ingest({ kind: "event", event: pass })
    eng.ingest({ kind: "frame", frame: frame(1) })
    const [view] = new StatsQuery(eng).eventsBetween(null, 1, { types: ["pass"] })
    expect(view!.qualifiers).toEqual({ execution: "mishit", under_pressure: true, intended_receiver_id: "h3", kind: "short" })
    expect(QUALIFIERS).not.toContain("scripted")
  })
})
```

Apply this change to `packages/stats/test/replay.test.ts`, `services/agents/tests/test_detector.py` (from the repository root):

```bash
git apply <<'PATCH'
diff --git a/packages/stats/test/replay.test.ts b/packages/stats/test/replay.test.ts
index ea29597..b35ac6f 100644
--- a/packages/stats/test/replay.test.ts
+++ b/packages/stats/test/replay.test.ts
@@ -72,6 +72,13 @@ describe("replay and streams", () => {
     }
   })
 
+  it("raise a costly_error for exactly the manifest's errors leading to a shot or goal", () => {
+    const truth = (JSON.parse(readFileSync(join(dir, "manifest.json"), "utf8")) as { truths: { critical_errors: Array<{ mistake_id: string; shot_id: string }> } }).truths.critical_errors
+    const raised = liveSignals.filter((s) => s.type === "costly_error").map((s) => s.evidence.join(" ")).sort()
+    expect(raised.length).toBeGreaterThan(0)
+    expect(raised).toEqual(truth.map((c) => `${c.mistake_id} ${c.shot_id}`).sort())
+  })
+
   it("match the committed golden summary (UPDATE_STATS_GOLDEN=1 rewrites it after an intended change)", () => {
     const r = (v: number | null) => (v === null ? null : Math.round(v * 1e6) / 1e6)
     const summary = {
diff --git a/services/agents/tests/test_detector.py b/services/agents/tests/test_detector.py
index 6744e36..b3334b1 100644
--- a/services/agents/tests/test_detector.py
+++ b/services/agents/tests/test_detector.py
@@ -20,6 +20,14 @@ def test_goals_and_red_cards_always_promoted_even_past_the_cap():
     assert ids[:3] == ["m-goal-100-home-fc", "m-goal-400-away-fc", "m-card-500-home-fc"] and len(ids) == 3
 
 
+def test_every_signal_type_has_a_cooldown_and_a_priority():
+    from touchline_agents.contracts_gen import Signal as Generated
+    from touchline_agents.detector import COOLDOWN_S, PRIORITY
+
+    types = set(Generated.model_fields["type"].annotation.__args__)
+    assert types == set(COOLDOWN_S) == set(PRIORITY) and "costly_error" in types
+
+
 def test_yellow_cards_and_low_salience_wait_for_the_rules_threshold():
     sigs = [signal("card", 100, salience=0.5, red=0), signal("speed_alert", 200, salience=0.28), signal("distance_milestone", 300, salience=0.15)]
     c = candidates(sigs, state())
PATCH
```

- [ ] **Step 2: Run them to make sure they fail**

Run: `pnpm --filter @touchline/stats test errors qualifiers replay`
Expected: 4 failed: `expected undefined to match object { team_id: 'home-fc', … }` and `{ player_id: 'h3', … }` (no costly_error signal), `expected undefined to deeply equal { execution: 'mishit', … }` (no qualifiers), `expected 0 to be greater than 0` (no signal for the manifest's critical errors)

Run: `uv run --project services/agents pytest -q services/agents/tests/test_detector.py`
Expected: 1 failed: `test_every_signal_type_has_a_cooldown_and_a_priority` (the generated signal type has no `costly_error` yet)

- [ ] **Step 3: Raise the signal and expose the qualifiers**

Apply this change to `packages/schema/src/stats.ts`, `packages/stats/src/engine.ts`, `packages/stats/src/query.ts`, `packages/mcp-stats/src/server.ts` (from the repository root):

```bash
git apply <<'PATCH'
diff --git a/packages/mcp-stats/src/server.ts b/packages/mcp-stats/src/server.ts
index 7d68275..420ecc2 100644
--- a/packages/mcp-stats/src/server.ts
+++ b/packages/mcp-stats/src/server.ts
@@ -123,7 +123,7 @@ export const createStatsServer = (q: StatsQuery, advisor: Advisor | null = null)
     "get_events",
     {
       title: "Get events",
-      description: "Match events between two frames (passes, shots, tackles, ...) with the values the stats engine derived (pass.dist, pass.xp, shot.xg, shot.speed). Use their ids as evidence.",
+      description: "Match events between two frames (passes, shots, tackles, ...) with the values the stats engine derived (pass.dist, pass.xp, shot.xg, shot.speed) and what could be seen of them (qualifiers: execution such as mishit, first_touch such as heavy, under_pressure, card colour, ...). Use their ids as evidence.",
       inputSchema: {
         from_frame: fromFrame,
         to_frame: toFrame,
diff --git a/packages/schema/src/stats.ts b/packages/schema/src/stats.ts
index 7df5ed7..1e9f053 100644
--- a/packages/schema/src/stats.ts
+++ b/packages/schema/src/stats.ts
@@ -9,7 +9,7 @@ export type MetricId = typeof MetricId.Type
 
 export const SignalType = Schema.Literals([
   "goal", "big_chance", "pressure_shift", "momentum_swing", "chaos_spike", "speed_alert", "distance_milestone",
-  "difficult_pass_completed", "player_milestone", "card", "substitution_impact"
+  "difficult_pass_completed", "player_milestone", "card", "substitution_impact", "costly_error"
 ])
 export type SignalType = typeof SignalType.Type
 
diff --git a/packages/stats/src/engine.ts b/packages/stats/src/engine.ts
index 129c86b..b889579 100644
--- a/packages/stats/src/engine.ts
+++ b/packages/stats/src/engine.ts
@@ -26,6 +26,13 @@ const FRAME_MEMORY_S = 30
 export const DIFFICULT_PASS_XP = 0.55
 /** A shot at least this likely to score (xG) is a big chance. */
 export const BIG_CHANCE_XG = 0.3
+/**
+ * A visible error (a mis-hit pass or clearance, a bad first touch) that gave the ball away is costly when the
+ * opponents shoot within this many seconds, before the erring team wins it back (spec §5.1.10, as in the manifest's
+ * critical errors). A bad touch counts as giving the ball away when the opponents have it within 5 s.
+ */
+export const COSTLY_ERROR_S = 15
+const BAD_TOUCHES: ReadonlySet<string> = new Set(["heavy", "miscontrol", "missed"])
 /** Counts at which a player milestone is raised. */
 /** Opponent passes behind this line (attacking x, i.e. in their own 60 % of the pitch) and defensive actions beyond it count for PPDA. */
 export const PPDA_LINE_X = -PITCH_HALF_L + 0.6 * 2 * PITCH_HALF_L
@@ -110,6 +117,8 @@ export class StatsEngine {
   private pendingDynamics: TrackFrame | null = null
   /** Substitutions awaiting their impact check; a team's changes at the same moment are judged together. */
   private readonly pendingSubs: Array<{ readonly team: TeamInfo; readonly tick: number; readonly events: DomainEvent[] }> = []
+  /** Visible errors still within COSTLY_ERROR_S; `lost` once they have given the ball away. */
+  private pendingErrors: Array<{ readonly e: DomainEvent; lost: boolean }> = []
 
   /** The home team's share of pitch control, sampled every 10 s (see pitchControl). */
   private readonly pcSamples = new Series()
@@ -257,6 +266,37 @@ export class StatsEngine {
         }
         break
     }
+    if (e.team_id !== null) this.trackErrors(e)
+  }
+
+  /** Follow visible errors until they lead to an opponent shot (raising costly_error), are won back, or expire. */
+  private trackErrors(e: DomainEvent): void {
+    const horizon = this.ticks(COSTLY_ERROR_S)
+    this.pendingErrors = this.pendingErrors.filter((p) => e.frame_id - p.e.frame_id <= horizon)
+    const a = e.attrs
+    if ((e.type === "pass" || e.type === "clearance") && a.execution === "mishit" && e.outcome !== "successful") {
+      this.pendingErrors.push({ e, lost: true })
+    } else if (e.type === "reception" && typeof a.first_touch === "string" && BAD_TOUCHES.has(a.first_touch)) {
+      // Lost only once the opponents have the ball (a loose touch the same team recovers is not).
+      this.pendingErrors.push({ e, lost: false })
+    } else if (e.type === "possession_change") {
+      // The erring team has it back: its errors lead nowhere. The other side has it: a bad touch within 5 s lost it.
+      this.pendingErrors = this.pendingErrors.filter((p) => p.e.team_id !== e.team_id)
+      for (const p of this.pendingErrors) if (e.frame_id - p.e.frame_id <= this.ticks(5)) p.lost = true
+    } else if (e.type === "shot") {
+      const costly = this.pendingErrors.filter((p) => p.lost && p.e.team_id !== e.team_id)
+      this.pendingErrors = this.pendingErrors.filter((p) => !costly.includes(p))
+      const xg = this.derived.get(e.id)?.["shot.xg"] ?? null
+      const v = xg === null ? null : Math.round(xg * 1000) / 1000
+      const goal = e.outcome === "goal"
+      for (const { e: m } of costly) {
+        this.raise("costly_error", e, {
+          team_id: m.team_id, player_id: m.player_id, metric: v === null ? null : "shot.xg", value: v, frame_from: m.frame_id, frame_to: emittedAt(e),
+          salience: goal ? 0.95 : Math.min(0.9, 0.7 + 0.2 * (xg ?? 0)), evidence: [m.id, e.id],
+          data: { ...(v === null ? {} : { "shot.xg": v }), goal: goal ? 1 : 0, under_pressure: m.attrs.under_pressure === true ? 1 : 0 }
+        })
+      }
+    }
   }
 
   private onPass(e: DomainEvent, tick: number, team: TeamInfo): void {
diff --git a/packages/stats/src/query.ts b/packages/stats/src/query.ts
index 896a21f..e0d446f 100644
--- a/packages/stats/src/query.ts
+++ b/packages/stats/src/query.ts
@@ -35,8 +35,20 @@ export interface EventView {
   readonly y_end: number | null
   /** Values the stats engine derived (pass.dist, pass.xp, shot.xg, shot.speed). */
   readonly values: Readonly<Record<string, number>>
+  /** What could be seen of the event (QUALIFIERS): how a pass was struck, a first touch, pressure, a card's colour. */
+  readonly qualifiers: Readonly<Record<string, string | boolean>>
 }
 
+/**
+ * Event attributes an observer could report, so agents can name a cause ("a mis-hit under pressure"). An allow-list:
+ * the simulator's ground truth (`scripted`) and decision-model internals (`best_receiver_id`: see get_decision) stay out.
+ */
+export const QUALIFIERS: ReadonlyArray<string> = [
+  "execution", "first_touch", "under_pressure", "lost_possession", "kind", "height", "body_part", "technique", "restart",
+  "colour", "on_target", "handling", "own_goal", "scorer_id", "receiver_id", "intended_receiver_id", "victim_id",
+  "winner_id", "loser_id", "target_id", "blocked", "ball", "reason", "side", "from", "method"
+]
+
 export interface DecisionView {
   readonly event_id: string
   readonly type: string
@@ -206,5 +218,9 @@ const view = (e: DomainEvent, values: Readonly<Record<string, number>>): EventVi
   y: e.y,
   x_end: e.x_end,
   y_end: e.y_end,
-  values
+  values,
+  qualifiers: Object.fromEntries(QUALIFIERS.flatMap((k) => {
+    const v = e.attrs[k]
+    return typeof v === "string" || typeof v === "boolean" ? [[k, v] as const] : []
+  }))
 })
PATCH
```

- [ ] **Step 4: Run the stats tests and refresh the golden summary**

Run: `pnpm --filter @touchline/stats test errors qualifiers`
Expected: 4 passed

Run: `UPDATE_STATS_GOLDEN=1 pnpm --filter @touchline/stats test replay`
Expected: 7 passed; `git diff --stat packages/stats/test/golden` shows 8 insertions, the two new `costly_error` signals (`golden-costly_error-21249-p-iro-02`, `golden-costly_error-55327-p-evu-01`) and nothing else

- [ ] **Step 5: Check against the manifests of real runs**

Each run's `costly_error` signals should match its manifest's `critical_errors` exactly:

```bash
for pair in costly_error:1 costly_error:2 even_contest:6 high_press_vs_low_block:6 late_comeback:6 red_card_collapse:3 keeper_heroics:4; do
  sc=${pair%%:*}; s=${pair##*:}
  pnpm -s sim --scenario $sc --seed $s --match-id check-ce >/dev/null 2>&1
  pnpm -s stats --run out/check-ce --signals out/check-ce/signals.jsonl >/dev/null 2>&1
  python3 -c "
import json
m = json.load(open('out/check-ce/manifest.json'))
truth = sorted((c['mistake_id'], c['shot_id']) for c in m['truths']['critical_errors'])
sig = sorted(tuple(x['evidence']) for x in map(json.loads, open('out/check-ce/signals.jsonl')) if x['type'] == 'costly_error')
print('$sc $s', len(truth), 'same' if truth == sig else 'DIFFERENT')"
done
```

Expected: `same` on every line (counts 1, 1, 2, 6, 4, 2, 0).

- [ ] **Step 6: Regenerate the contracts and teach the detector the new type**

Run: `pnpm --filter @touchline/schema json && uv run --project services/agents python services/agents/scripts/gen_contracts.py`
Expected: both files rewritten: `costly_error` added to the signal type enum

Apply this change to `services/agents/touchline_agents/detector.py` (from the repository root):

```bash
git apply <<'PATCH'
diff --git a/services/agents/touchline_agents/detector.py b/services/agents/touchline_agents/detector.py
index 44abf64..7d35900 100644
--- a/services/agents/touchline_agents/detector.py
+++ b/services/agents/touchline_agents/detector.py
@@ -18,11 +18,11 @@ from .llm import agent_options, run_structured, stub_responder
 COOLDOWN_S: dict[str, float] = {
     "goal": 0, "card": 0, "big_chance": 30, "pressure_shift": 300, "momentum_swing": 300, "chaos_spike": 300,
     "substitution_impact": 300, "difficult_pass_completed": 120, "speed_alert": 300, "player_milestone": 300,
-    "distance_milestone": 600,
+    "distance_milestone": 600, "costly_error": 0,
 }
 PRIORITY: dict[str, int] = {
     "goal": 1, "big_chance": 2, "pressure_shift": 2, "momentum_swing": 2, "chaos_spike": 2, "substitution_impact": 2,
-    "card": 3, "difficult_pass_completed": 3, "speed_alert": 3, "player_milestone": 3, "distance_milestone": 3,
+    "costly_error": 2, "card": 3, "difficult_pass_completed": 3, "speed_alert": 3, "player_milestone": 3, "distance_milestone": 3,
 }
 PROMOTE_SALIENCE = 0.5  # the rules promote at or above this
 CANDIDATE_SALIENCE = 0.25  # the model may promote at or above this
PATCH
```

Run: `uv run --project services/agents pytest -q services/agents/tests/test_detector.py`
Expected: 9 passed

- [ ] **Step 7: Run the affected suites**

Run: `pnpm turbo run typecheck test --filter=@touchline/stats --filter=@touchline/schema --filter=@touchline/mcp-stats --concurrency=2 && uv run --project services/agents pytest -q services/agents`
Expected: `Tasks: 6 successful`; 51 passed, 1 deselected

- [ ] **Step 8: Commit**

```bash
git add packages/stats packages/schema packages/mcp-stats services/agents
git commit -m "feat(stats): costly_error signal (an error that gave the ball away and led to a shot, as the manifest's critical errors) and observable event qualifiers in get_events

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```



### Task 6: Tactical Analyst

The Analyst (spec §5.3) explains why a moment happened.

**The evidence pack.** Code first gathers it over MCP, as of the moment's last frame:
- The metrics each moment type is explained with (`METRICS_FOR`).
- The play's events, from 15 s before the moment, with their qualifiers, and the ids of visible errors.
- The decision records of passes that gave the ball away, the score, and the names of the teams and players involved.

**The model** explains from the pack and may call the read-only stats tools for more. Its explanation may hold no digits: numbers belong in claims. Claims cite a metric (for a subject at a frame, or an event's own value), an event, the score, or a better option.

**The fallback**, which is also the stub's answer, is a template per moment type built from the pack:
- **A goal or big chance:** it names a visible error by the opponents that led to the shot, as "mis-hit clearance under pressure" or "heavy touch". It cites the error event and the shot's xG, and adds the better option when the decision record ranks another pass first.
- **A costly error:** the same treatment for the error itself.

A shared `numbers.py` writes values as viewers read them: shares as percentages, xG with two decimals, a Spanish decimal comma, Hindi with Western digits. The Fact-Checker reads them back with the same module. A live test shows `gpt-6.1-sol` naming the scripted cause.

**Files:**
- Create: `services/agents/touchline_agents/numbers.py`, `services/agents/touchline_agents/analyst.py`
- Modify: `services/agents/touchline_agents/stats.py` (the tools a model may call)
- Test: `services/agents/tests/test_numbers.py`, `services/agents/tests/test_analyst.py`

**Interfaces:**
- Consumes: `StatsClient`, `names` (Task 3), `Moment`, `Signal`, `Analysis`, `Claim`, `build_moments`, `DetectorState` (Task 4), the `costly_error` signal and `qualifiers` (Task 5).
- Produces:
  - `numbers.py`: `UNITS`, `format_metric(metric_id, value, lang)`, `write(value, decimals, lang)`, `read(token, lang)`, `numbers_in(text)`, `matches(quote, value, lang)`.
  - `stats.py`: `MODEL_TOOLS`.
  - `analyst.py`: `METRICS_FOR`, `LOOKBACK_S = 15`, `TOUCHES`, `evidence(stats, moment, signals) -> pack` (keys `moment`, `signals`, `score`, `names`, `metrics`, `events`, `errors`, `decisions`, `at_frame`), `template_analysis(pack)`, `acceptable(analysis, moment_id)`, `AnalystResult`, `Analyst(client, settings).analyze(stats, moment, signals)`.

- [ ] **Step 1: Write the failing tests**

Create `services/agents/tests/test_numbers.py`:

```python
import pytest

from touchline_agents.numbers import format_metric, matches, numbers_in, read


@pytest.mark.parametrize(("metric", "value", "lang", "text"), [
    ("team.press", 0.2653, "en", "27%"),
    ("shot.xg", 0.2431, "en", "0.24"),
    ("shot.xg", 0.2431, "es", "0,24"),
    ("plyr.vmax", 30.84, "hi", "30.8"),
    ("plyr.dist", 10001.4, "en", "10,001"),
    ("plyr.dist", 10001.4, "es", "10.001"),
    ("ppda", 7.25, "en", "7.2"),
])
def test_formats_by_unit_and_language(metric, value, lang, text):
    assert format_metric(metric, value, lang) == text
    assert matches(text, value * (1 if not text.endswith("%") else 1), lang)


def test_reads_tokens_back():
    assert read("10,001") == (10001.0, 0, False)
    assert read("0,24", "es") == (0.24, 2, False)
    assert read("10.001", "es") == (10001.0, 0, False)
    assert read("67th") == (67.0, 0, False)
    assert read("27 %", "es") == (27.0, 0, True)


def test_finds_numbers_and_scores():
    assert numbers_in("Ironmoor lead 2-1 after 67 minutes, with 27% of the ball.") == ["2-1", "67", "27%"]
    assert numbers_in("No numbers here, p-iro-09 is an id") == []
    assert numbers_in("Ganan 2–0 con un 0,24 de xG") == ["2–0", "0,24"]


def test_rounding_must_be_faithful():
    assert matches("0.27", 0.2653) and not matches("0.30", 0.2653)
    assert matches("27%", 0.2653) and not matches("30%", 0.2653)
    assert not matches("27% and 30%", 0.2653)
```

Create `services/agents/tests/test_analyst.py`:

```python
import json

import pytest

from touchline_agents.analyst import Analyst, acceptable, evidence, template_analysis
from touchline_agents.config import load_settings
from touchline_agents.contracts import Analysis, Signal
from touchline_agents.detector import DetectorState, build_moments
from touchline_agents.llm import StubChatClient

SETTINGS = load_settings({}, env_file=None)


@pytest.fixture
async def signals(stats) -> list[Signal]:
    return [Signal.model_validate(s) for s in await stats.signals(limit=500)]


def moment_for(signals: list[Signal], type_: str):
    lead = next(s for s in signals if s.type == type_)
    return build_moments([lead.id], signals, DetectorState(fps=10), "rules")[0]


async def test_explains_the_scripted_error_from_what_could_be_seen(stats, signals, manifest):
    [truth] = manifest["truths"]["critical_errors"]
    m = moment_for(signals, "costly_error")
    pack = await evidence(stats, m, signals)
    assert truth["mistake_id"] in pack["errors"]
    assert "scripted" not in json.dumps(pack)  # the simulator's ground truth never reaches an agent
    a = template_analysis(pack)
    assert a.cause == "mis-hit clearance under pressure"
    assert any(c.kind == "event" and c.event_id == truth["mistake_id"] for c in a.claims)
    shot = next(c for c in a.claims if c.metric_id == "shot.xg")
    assert shot.event_id == truth["shot_id"] and shot.quote == f"{shot.value:.2f}"


async def test_every_signal_type_gets_an_explanation(stats, signals):
    for type_ in sorted({s.type for s in signals}):
        a = template_analysis(await evidence(stats, moment_for(signals, type_), signals))
        assert a.cause and not any(ch.isdigit() for ch in a.explanation), type_
        for c in a.claims:
            assert c.kind != "metric" or (c.value is not None and (c.subject or c.event_id)), (type_, c)


async def test_a_goal_claims_the_score_and_the_chance(stats, signals):
    a = template_analysis(await evidence(stats, moment_for(signals, "goal"), signals))
    kinds = [c.kind for c in a.claims]
    assert "score" in kinds and any(c.metric_id == "shot.xg" for c in a.claims)


async def test_the_model_can_query_the_stats_tools(stats, signals):
    client = StubChatClient()
    m = moment_for(signals, "pressure_shift")
    out = await Analyst(client, SETTINGS).analyze(stats, m, signals)
    assert not out.fallback and client.calls == ["analyze", "analyze"]  # a tool call, then the answer
    assert out.analysis.moment_id == m.moment_id and any(c.metric_id == "team.press" for c in out.analysis.claims)


async def test_falls_back_to_the_template_when_the_model_fails(stats, signals):
    m = moment_for(signals, "goal")
    out = await Analyst(StubChatClient("garbage"), SETTINGS).analyze(stats, m, signals)
    assert out.fallback and out.analysis == template_analysis(out.pack)


def test_rejects_numbers_in_the_explanation_and_the_wrong_moment():
    a = Analysis(moment_id="mo-1", cause="press", explanation="They pressed 12 times.", claims=[])
    assert not acceptable(a, "mo-1")
    assert not acceptable(a.model_copy(update={"explanation": "They pressed."}), "mo-2")
    assert acceptable(a.model_copy(update={"explanation": "They pressed."}), "mo-1")


@pytest.mark.live
async def test_openai_explains_the_scripted_error(stats, signals, manifest):
    live = load_settings({"TOUCHLINE_LLM": "openai", "TOUCHLINE_TIMEOUT_SCALE": "10"})
    from touchline_agents.llm import make_client

    m = moment_for(signals, "costly_error")
    out = await Analyst(make_client(live, "large"), live).analyze(stats, m, signals)
    assert not out.fallback, out.reason
    print(out.ms, out.analysis.model_dump_json(indent=1))
    assert "mis-hit" in out.analysis.cause.lower() or "mishit" in out.analysis.cause.lower()
    assert any(c.event_id == manifest["truths"]["critical_errors"][0]["mistake_id"] for c in out.analysis.claims)
```

- [ ] **Step 2: Run them to make sure they fail**

Run: `uv run --project services/agents pytest -q services/agents/tests/test_numbers.py services/agents/tests/test_analyst.py`
Expected: two collection errors: `No module named 'touchline_agents.numbers'` and `No module named 'touchline_agents.analyst'`

- [ ] **Step 3: Write the number formats and the Analyst**

Create `services/agents/touchline_agents/numbers.py`:

```python
"""How numbers are written in cue text, and how the Fact-Checker reads them back.

A claim's `quote` is a number exactly as written. Shares are written as percentages ("27%"), xG and xPass with two
decimals ("0.24"), speeds with one ("30.8"), distances as whole metres ("10,001"). Spanish swaps the separators
("0,24", "10.001"); Hindi text uses the English style with Western digits.
"""

import re

# Units from the stats catalog (list_metrics) for the metric ids.
UNITS: dict[str, str] = {
    "pass.dist": "m", "pass.acc": "share", "pass.xp": "probability", "ball.speed": "km/h", "shot.speed": "km/h",
    "plyr.vmax": "km/h", "plyr.dist": "m", "shot.xg": "xG", "team.mom": "share", "team.press": "share",
    "ppda": "passes per action", "tilt": "share", "game.chaos": "index", "team.poss": "share", "act.xt": "xT",
    "pitch.ctrl": "share",
}
PERCENT_UNITS = {"share", "probability"}
DECIMALS: dict[str, int] = {"m": 0, "km/h": 1, "xG": 2, "xT": 2, "index": 2, "passes per action": 1}

# A number as written: digits with separators, an optional percent sign or ordinal suffix; not part of an id such
# as "p-iro-09". Scores are matched separately.
NUMBER = re.compile(r"(?<![\w.,-])\d+(?:[.,]\d+)*(?:\s?%|st|nd|rd|th|º|ª|'|′)?")
SCORE = re.compile(r"(?<![\w.,-])(\d+)\s?[-–]\s?(\d+)(?![\w.,])")


def _group(digits: str, sep: str) -> str:
    out = []
    while len(digits) > 3:
        out.insert(0, digits[-3:])
        digits = digits[:-3]
    return sep.join([digits, *out])


def write(value: float, decimals: int, lang: str) -> str:
    """`value` with `decimals` decimals, grouped, in the language's style."""
    text = f"{abs(value):.{decimals}f}"
    whole, _, frac = text.partition(".")
    thousands, point = (".", ",") if lang == "es" else (",", ".")
    out = _group(whole, thousands) + (point + frac if frac else "")
    return ("-" if value < 0 else "") + out


def format_metric(metric_id: str, value: float, lang: str = "en") -> str:
    """How a metric's value is quoted in text: shares as whole percentages, others by unit."""
    unit = UNITS[metric_id]
    if unit in PERCENT_UNITS:
        return f"{write(value * 100, 0, lang)}%"
    return write(value, DECIMALS.get(unit, 2), lang)


def read(token: str, lang: str = "en") -> tuple[float, int, bool]:
    """(value, decimals shown, is a percentage) for a number token as NUMBER matches it."""
    t = token.strip()
    pct = t.endswith("%")
    t = re.sub(r"\s?%$|st$|nd$|rd$|th$|º$|ª$|'$|′$", "", t)
    thousands, point = (".", ",") if lang == "es" else (",", ".")
    # A lone separator followed by exactly three digits is a thousands separator ("10,001"), otherwise a decimal point.
    if point not in t and t.count(thousands) == 1 and len(t.split(thousands)[1]) != 3:
        thousands, point = point, thousands
    whole, _, frac = t.replace(thousands, "").partition(point)
    return float(f"{whole}.{frac}" if frac else whole), len(frac), pct


def numbers_in(text: str) -> list[str]:
    """Every number token in a sentence, scores (e.g. "2-1") first as single tokens."""
    scores = [m.group(0) for m in SCORE.finditer(text)]
    rest = SCORE.sub(" ", text)
    return scores + [m.group(0) for m in NUMBER.finditer(rest)]


def matches(quote: str, value: float, lang: str = "en") -> bool:
    """Whether `quote` is a faithful rounding of `value`: within half a unit of the last decimal shown (percentages
    against value x 100)."""
    tokens = NUMBER.findall(quote)
    if len(tokens) != 1:
        return False
    shown, decimals, pct = read(tokens[0], lang)
    target = value * 100 if pct else value
    return abs(shown - target) <= 0.5 * 10 ** (-decimals) + 1e-9
```

Apply this change to `services/agents/touchline_agents/stats.py` (from the repository root):

```bash
git apply <<'PATCH'
diff --git a/services/agents/touchline_agents/stats.py b/services/agents/touchline_agents/stats.py
index 75c4031..bede77e 100644
--- a/services/agents/touchline_agents/stats.py
+++ b/services/agents/touchline_agents/stats.py
@@ -21,6 +21,11 @@ from agent_framework.exceptions import ToolExecutionException
 from .config import REPO
 
 
+# Tools a model may call (fast, read-only). Re-simulation tools take seconds and stay off the live path; code can
+# still call any tool directly (the Fact-Checker's verify_claim).
+MODEL_TOOLS = ["match_info", "list_metrics", "get_metric", "get_series", "rank_players", "get_signals", "get_events", "get_decision"]
+
+
 class StatsError(Exception):
     """A stats tool refused the request (unknown id, no such event, ...) or the server is unusable."""
 
@@ -41,7 +46,7 @@ class StatsClient:
 
     def __init__(self, url: str, allowed_hosts: frozenset[str] = frozenset({"127.0.0.1", "localhost", "::1"})) -> None:
         self.url = check_url(url, allowed_hosts)
-        self.tool = MCPStreamableHTTPTool(name="stats", url=self.url, load_prompts=False)
+        self.tool = MCPStreamableHTTPTool(name="stats", url=self.url, load_prompts=False, allowed_tools=MODEL_TOOLS)
         self._info: dict | None = None
 
     async def __aenter__(self) -> "StatsClient":
PATCH
```

Create `services/agents/touchline_agents/analyst.py`:

```python
"""Tactical Analyst (spec §5.3): explains why a moment happened, as a cause and claims with evidence.

Code first gathers an evidence pack over MCP (metrics the moment type calls for, the play's events with what could be
seen of them, decision records of passes that gave the ball away). The model explains from the pack and may query
the stats tools for more; the fallback is a template explanation per moment type built from the same pack. Either
way every number is a value the stats server returned, never one the agent computed.
"""

from dataclasses import dataclass

from agent_framework import Agent, BaseChatClient

from .config import Settings
from .contracts import Analysis, Claim, Moment, Signal
from .llm import ToolCalls, agent_options, run_structured, stub_responder
from .numbers import format_metric
from .stats import StatsClient, StatsError, names

# The metrics each moment type is explained with: (metric id, subject kind) — subject from the moment.
METRICS_FOR: dict[str, list[tuple[str, str]]] = {
    "goal": [("team.mom", "team")],
    "big_chance": [("team.mom", "team")],
    "pressure_shift": [("team.press", "team"), ("ppda", "team"), ("tilt", "team")],
    "momentum_swing": [("team.mom", "team"), ("tilt", "team")],
    "chaos_spike": [("game.chaos", "match")],
    "card": [("team.mom", "team")],
    "substitution_impact": [("team.mom", "team")],
    "speed_alert": [("plyr.vmax", "player")],
    "distance_milestone": [("plyr.dist", "player")],
    "player_milestone": [],
    "difficult_pass_completed": [("pass.xp", "player")],
    "costly_error": [],
}
LOOKBACK_S = 15  # the play before a moment: where errors leading to a shot are looked for (spec §5.1.10)
TOUCHES = {"heavy": "heavy touch", "miscontrol": "miscontrol", "missed": "missed touch"}

INSTRUCTIONS = """You are the Tactical Analyst for a live football broadcast.
INPUT is a moment (what the stats engine flagged) and an evidence pack: metric values with refs, the play's events
with qualifiers (execution such as mishit, first_touch such as heavy, under_pressure), decision records, the score and
names. Explain WHY it happened in football terms: control versus chaos, a pressure shift, an error under pressure
versus a good interception, a better option that was missed.
Rules:
- `cause` is one short phrase naming the cause (e.g. "mis-hit pass under pressure", "sustained high press").
- `explanation` is one or two plain sentences with NO digits.
- Every number goes in `claims`, copied from the evidence or from a stats tool you called: kind "metric" with
  metric_id, value and either subject (a team/player id or "match") with at_frame, or event_id for an event's own
  value; kind "event" for an event you rely on; kind "score" with quote "home-away"; kind "better_option" with
  event_id and receiver_id only when a decision record ranks another pass first (chosen_rank > 1).
- `quote` is the number as a viewer would read it (shares as percentages such as "27%"); `sentence` is 0.
- Never invent ids or values. You may call the stats tools for anything the pack lacks."""


def _claim(kind: str, at_frame: int, **kw) -> Claim:
    base = dict(kind=kind, sentence=0, quote="", metric_id=None, subject=None, value=None, at_frame=at_frame, window_s=None, event_id=None, receiver_id=None)
    return Claim(**(base | kw))


async def evidence(stats: StatsClient, moment: Moment, signals: list[Signal]) -> dict:
    """The facts an explanation of `moment` may use, all from the stats server as of the moment's last frame."""
    info = await stats.roster()
    at = moment.frame_to
    fps = info["fps"]
    who = names(info)
    subjects = {"team": moment.team_id, "player": moment.player_id, "match": "match"}
    lead = next((s for s in signals if s.id == moment.signal_ids[0]), None)
    wanted = list(METRICS_FOR[moment.type])
    if moment.type == "player_milestone" and lead and lead.metric:
        wanted.append((lead.metric, "player"))
    metrics = []
    for metric_id, kind in wanted:
        subject = subjects[kind]
        if subject is None:
            continue
        try:
            m = await stats.metric(metric_id, subject, at)
        except StatsError:
            continue
        if m["value"] is not None:
            metrics.append({"metric_id": metric_id, "subject": subject, "value": m["value"], "ref": m["ref"], "at_frame": at})
    events = await stats.events(max(0, moment.frame_from - LOOKBACK_S * fps), at, limit=60)
    events = [e for e in events if e["type"] not in ("off_ball_run", "pressure")] if len(events) > 40 else events
    errors = [e["id"] for e in events if e["qualifiers"].get("execution") == "mishit" or e["qualifiers"].get("first_touch") in TOUCHES]
    decisions = []
    for e in events:
        if e["type"] in ("pass", "clearance") and (e["id"] in errors or e["outcome"] not in ("successful", None)) and len(decisions) < 3:
            try:
                d = await stats.decision(e["id"], at)
            except StatsError:
                continue
            decisions.append({k: d[k] for k in ("event_id", "player_id", "chosen_rank", "best_receiver_id", "chosen_receiver_id")})
    score = (await stats.match_info(at))["score"]
    involved = {e.get("player_id") for e in events} | {moment.team_id, moment.player_id, info["home"]["id"], info["away"]["id"]}
    return {
        "moment": moment.model_dump(mode="json"),
        "signals": [s.model_dump(mode="json", include={"id", "type", "team_id", "player_id", "metric", "value", "data", "evidence"}) for s in signals if s.id in moment.signal_ids],
        "score": {"home": score["home"], "away": score["away"], "home_team": info["home"]["id"], "away_team": info["away"]["id"]},
        "names": {k: v for k, v in who.items() if k in involved},
        "metrics": metrics,
        "events": [{k: e[k] for k in ("id", "type", "match_clock", "frame_id", "team_id", "player_id", "outcome", "values", "qualifiers")} for e in events],
        "errors": errors,
        "decisions": decisions,
        "at_frame": at,
    }


def _metric_claim(m: dict) -> Claim:
    return _claim("metric", m["at_frame"], quote=format_metric(m["metric_id"], m["value"]), metric_id=m["metric_id"], subject=m["subject"], value=m["value"])


def _error_phrase(e: dict) -> str:
    """"mis-hit clearance under pressure", "heavy touch", ...: what could be seen of an error."""
    q = e["qualifiers"]
    what = f"mis-hit {e['type']}" if q.get("execution") == "mishit" else TOUCHES[q["first_touch"]]
    return f"{what} under pressure" if q.get("under_pressure") else what


def _error_claims(error: dict, pack: dict) -> list[Claim]:
    """The error itself, and the better option when its decision record ranks another pass first."""
    at = pack["at_frame"]
    out = [_claim("event", at, event_id=error["id"], subject=error["player_id"])]
    d = next((d for d in pack["decisions"] if d["event_id"] == error["id"]), None)
    if d and d["chosen_rank"] not in (None, 1) and d["best_receiver_id"]:
        out.append(_claim("better_option", at, event_id=error["id"], receiver_id=d["best_receiver_id"]))
    return out


def _shot_claim(shot: dict | None, at: int) -> list[Claim]:
    if not shot or "shot.xg" not in shot["values"]:
        return []
    xg = shot["values"]["shot.xg"]
    return [_claim("metric", at, quote=format_metric("shot.xg", xg), metric_id="shot.xg", value=xg, event_id=shot["id"])]


def template_analysis(pack: dict) -> Analysis:
    """The fallback: a cause and claims per moment type, from the evidence pack alone."""
    m = pack["moment"]
    at = pack["at_frame"]
    name = pack["names"]
    team = name.get(m["team_id"] or "", "The match")
    claims = [_metric_claim(x) for x in pack["metrics"]]
    by_id = {e["id"]: e for e in pack["events"]}
    t = m["type"]
    if t in ("goal", "big_chance"):
        shot = next((e for e in reversed(pack["events"]) if e["type"] == "shot" and e["team_id"] == m["team_id"]), None)
        error = next((by_id[i] for i in reversed(pack["errors"]) if by_id[i]["team_id"] not in (m["team_id"], None)
                      and (shot is None or by_id[i]["frame_id"] <= shot["frame_id"])), None)
        claims = _shot_claim(shot, at) + claims
        if t == "goal":
            s = pack["score"]
            claims.append(_claim("score", at, quote=f"{s['home']}-{s['away']}"))
        if error:
            cause = _error_phrase(error)
            explanation = f"{name.get(error['team_id'], 'The opponents')} gave the ball away with a {cause} by {name.get(error['player_id'] or '', 'a defender')}, and {team} made them pay."
            claims += _error_claims(error, pack)
        else:
            xg = shot["values"].get("shot.xg") if shot else None
            cause = "clear chance created" if t == "big_chance" else "clear chance converted" if xg is not None and xg >= 0.3 else "low-probability chance"
            explanation = f"{team} worked the ball into a shooting position from open play."
        return Analysis(moment_id=m["moment_id"], cause=cause, explanation=explanation, claims=claims)
    if t == "costly_error":
        lead = pack["signals"][0]
        error, shot = by_id.get(lead["evidence"][0]), by_id.get(lead["evidence"][-1])
        if error:
            cause = _error_phrase(error)
            explanation = f"{name.get(error['player_id'] or '', 'A player')} gave the ball away with a {cause}, and {name.get(shot['team_id'], 'the opponents') if shot else 'the opponents'} got a shot away."
            claims = _shot_claim(shot, at) + _error_claims(error, pack)
            return Analysis(moment_id=m["moment_id"], cause=cause, explanation=explanation, claims=claims)
    lead = pack["signals"][0] if pack["signals"] else {"data": {}}
    rising = lead["data"].get("after", 0) >= lead["data"].get("before", 0)
    cause, explanation = {
        "pressure_shift": ("sustained high press" if rising else "press dropping off",
                           f"{team} pushed up and pressed higher, forcing the ball back." if rising else f"{team} stopped pressing and sat deeper."),
        "momentum_swing": ("momentum swing", f"{team} took control of the game and moved the play into the opponents' half."),
        "chaos_spike": ("end-to-end spell", "Possession is changing hands quickly and neither side can keep the ball."),
        "card": ("red card" if lead["data"].get("red") else "booking", f"A card for {name.get(m['player_id'] or '', 'a player')} of {team}."),
        "substitution_impact": ("substitution changed the game", f"{team}'s changes shifted the balance of play."),
        "speed_alert": ("top-speed sprint", f"{name.get(m['player_id'] or '', 'A player')} hit top speed on the run."),
        "distance_milestone": ("work rate", f"{name.get(m['player_id'] or '', 'A player')} keeps covering ground."),
        "player_milestone": ("milestone", f"A milestone for {name.get(m['player_id'] or '', 'a player')}."),
        "difficult_pass_completed": ("difficult pass completed", f"{name.get(m['player_id'] or '', 'A player')} found a pass that rarely comes off."),
        "costly_error": ("error leading to a shot", f"{team} gave the ball away and the opponents got a shot away."),
    }[t]
    if t in ("card", "difficult_pass_completed", "player_milestone"):
        for sid in lead.get("evidence", []):
            if sid in by_id:
                claims.append(_claim("event", at, event_id=sid, subject=m["player_id"]))
                ev = by_id[sid]
                if t == "difficult_pass_completed" and "pass.xp" in ev["values"]:
                    claims = [c for c in claims if c.metric_id != "pass.xp"]
                    claims.insert(0, _claim("metric", at, quote=format_metric("pass.xp", ev["values"]["pass.xp"]), metric_id="pass.xp", value=ev["values"]["pass.xp"], event_id=sid))
    return Analysis(moment_id=m["moment_id"], cause=cause, explanation=explanation, claims=claims)


@stub_responder("analyze")
def _stub(payload: dict, results: list[str]) -> dict | ToolCalls:
    # First ask the stats server for something (the stub exercises the model's tool path), then answer like the template.
    if not results and payload["metrics"]:
        m = payload["metrics"][0]
        return ToolCalls([("get_metric", {"metric_id": m["metric_id"], "subject": m["subject"], "at_frame": m["at_frame"]})])
    return template_analysis(payload).model_dump(mode="json")


def acceptable(a: Analysis, moment_id: str) -> bool:
    """Reject output about another moment, or with digits in the explanation (numbers belong in claims)."""
    return a.moment_id == moment_id and not any(ch.isdigit() for ch in a.explanation)


@dataclass(frozen=True)
class AnalystResult:
    analysis: Analysis
    pack: dict
    fallback: bool
    reason: str | None
    ms: float


class Analyst:
    def __init__(self, client: BaseChatClient, settings: Settings) -> None:
        self.client = client
        self.settings = settings

    async def analyze(self, stats: StatsClient, moment: Moment, signals: list[Signal]) -> AnalystResult:
        pack = await evidence(stats, moment, signals)
        agent = Agent(client=self.client, name="tactical_analyst", instructions=INSTRUCTIONS, tools=[stats.tool], default_options=agent_options(self.settings))
        out = await run_structured(
            agent, "analyze", pack, Analysis, timeout_s=self.settings.timeout("analyst"),
            fallback=lambda: template_analysis(pack), accept=lambda a: acceptable(a, moment.moment_id),
        )
        return AnalystResult(out.value, pack, out.fallback, out.reason, out.ms)
```

- [ ] **Step 4: Run the tests**

Run: `uv run --project services/agents pytest -q services/agents/tests/test_numbers.py services/agents/tests/test_analyst.py`
Expected: 16 passed, 1 deselected (the stub makes one MCP tool call through Agent Framework before answering)

Optional, with the key in `.env.local` (one or two real `gpt-6.1-sol` calls; skipped by the default run):

Run: `uv run --project services/agents pytest -q -m live services/agents/tests/test_analyst.py`
Expected: 1 passed: the cause names a mis-hit clearance (under pressure) and a claim cites the scripted error's event; about 9 s

- [ ] **Step 5: Commit**

```bash
git add services/agents
git commit -m "feat(agents): Tactical Analyst — evidence pack over MCP, model explains with stats tools, template explanation per moment type as fallback; number formatting shared with the Fact-Checker

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```



### Task 7: Narrator

The Narrator (spec §5.3) writes the English draft:
- **Shape:** sentence 0 is a headline of at most 8 words, then one or two body sentences, using names and never ids.
- **Numbers:** it may state only numbers from the Analyst's claims. Each one goes in `claims`, with the sentence it is in and its `quote` exactly as written, so the Fact-Checker can tell declared numbers from undeclared ones.
- **Retry:** the Fact-Checker's `feedback` on the previous draft is passed in, and the Narrator fixes exactly what it says.
- **Rejected output:** a draft in another language, with more than four sentences, a long headline, or a claim whose quote is not in its sentence.
- **Fallback** (also the stub's answer), spec §5.3's "headline-only template": a headline per moment type, the Analyst's explanation (which has no digits), and at most two templated sentences that state claims.

**Files:**
- Create: `services/agents/touchline_agents/narrator.py`
- Modify: `services/agents/tests/factories.py` (claims, analyses, names)
- Test: `services/agents/tests/test_narrator.py`

**Interfaces:**
- Consumes: `Analysis`, `Draft`, `Moment`, `run_structured`.
- Produces: `MAX_HEADLINE_WORDS = 8`, `template_draft(payload)` (payload `{moment, analysis, names}`), `acceptable(draft, moment_id)`, `NarratorResult`, `Narrator(client, settings).narrate(moment, analysis, names, feedback=None)`; test factories `claim(...)`, `analysis(...)`, `NAMES`.

- [ ] **Step 1: Write the failing tests**

Apply this change to `services/agents/tests/factories.py` (from the repository root):

```bash
git apply <<'PATCH'
diff --git a/services/agents/tests/factories.py b/services/agents/tests/factories.py
index 867dfbf..e3e958b 100644
--- a/services/agents/tests/factories.py
+++ b/services/agents/tests/factories.py
@@ -1,6 +1,6 @@
 """Hand-built contract values for unit tests."""
 
-from touchline_agents.contracts import Moment, Signal
+from touchline_agents.contracts import Analysis, Claim, Moment, Signal
 
 
 def signal(type_: str, frame: int, *, team: str | None = "home-fc", player: str | None = None, salience: float = 0.6, span: int = 0, **data: float) -> Signal:
@@ -18,3 +18,22 @@ def moment(type_: str = "goal", frame: int = 3000, team: str | None = "home-fc",
         match_clock=f"{frame // 600:02d}:{frame % 600 // 10:02d}.00", team_id=team, player_id=player, salience=0.9,
         priority=1, source="rules",
     )
+
+
+def claim(kind: str = "metric", **kw) -> Claim:
+    base = dict(kind=kind, sentence=0, quote="", metric_id=None, subject=None, value=None, at_frame=3000, window_s=None, event_id=None, receiver_id=None)
+    return Claim(**(base | kw))
+
+
+def analysis(moment_id: str = "mo-goal-3000", cause: str = "low-probability chance", claims: list[Claim] | None = None) -> Analysis:
+    return Analysis(
+        moment_id=moment_id, cause=cause, explanation="Home FC worked the ball into a shooting position from open play.",
+        claims=claims if claims is not None else [
+            claim(quote="0.12", metric_id="shot.xg", value=0.1234, event_id="m-e10"),
+            claim("score", quote="1-0"),
+            claim(quote="58%", metric_id="team.mom", subject="home-fc", value=0.58),
+        ],
+    )
+
+
+NAMES = {"home-fc": "Home FC", "away-fc": "Away Town", "h9": "Ada Striker", "a4": "Bo Keeper"}
PATCH
```

Create `services/agents/tests/test_narrator.py`:

```python
import pytest

from touchline_agents.config import load_settings
from touchline_agents.llm import STUB_RESPONDERS, StubChatClient
from touchline_agents.narrator import Narrator, acceptable, template_draft

from .factories import NAMES, analysis, claim, moment

SETTINGS = load_settings({}, env_file=None)


def payload(m=None, a=None):
    m = m or moment()
    return {"moment": m.model_dump(mode="json"), "analysis": (a or analysis(m.moment_id)).model_dump(mode="json"), "names": NAMES}


def test_template_states_each_number_in_its_own_sentence():
    d = template_draft(payload())
    assert d.sentences[0] == "Goal for Home FC!" and d.lang == "en"
    assert d.sentences[1] == "Home FC worked the ball into a shooting position from open play."
    assert d.sentences[2:] == ["Expected goals for the chance: 0.12.", "The score is now 1-0."]
    assert [(c.sentence, c.quote) for c in d.claims] == [(2, "0.12"), (3, "1-0")]
    assert acceptable(d, d.moment_id)


@pytest.mark.parametrize(("type_", "head"), [
    ("costly_error", "Costly error by Ada Striker"), ("momentum_swing", "Momentum swings to Home FC"), ("chaos_spike", "End-to-end football"),
])
def test_headlines_name_the_team_or_player(type_, head):
    m = moment(type_, player="h9")
    assert template_draft(payload(m, analysis(m.moment_id, claims=[]))).sentences[0] == head


def test_rejects_drafts_that_misquote_or_overrun():
    d = template_draft(payload())
    assert not acceptable(d.model_copy(update={"lang": "es"}), d.moment_id)
    assert not acceptable(d.model_copy(update={"sentences": ["A headline that goes on and on and on for far too many words"] + d.sentences[1:]}), d.moment_id)
    wrong = d.model_copy(update={"claims": [claim(sentence=1, quote="0.12", metric_id="shot.xg", value=0.12)]})
    assert not acceptable(wrong, d.moment_id)  # sentence 1 does not say 0.12
    assert not acceptable(d.model_copy(update={"claims": [claim(sentence=9, quote="")]}), d.moment_id)


async def test_narrates_through_the_model_and_passes_feedback():
    seen = []
    original = STUB_RESPONDERS["narrate"]
    STUB_RESPONDERS["narrate"] = lambda p, r: (seen.append(p), original(p, r))[1]
    try:
        m = moment()
        out = await Narrator(StubChatClient(), SETTINGS).narrate(m, analysis(m.moment_id), NAMES, feedback=["sentence 2: 0.15 is not 0.12"])
    finally:
        STUB_RESPONDERS["narrate"] = original
    assert not out.fallback and out.draft == template_draft(payload(m))
    assert seen[0]["feedback"] == ["sentence 2: 0.15 is not 0.12"]


async def test_falls_back_to_the_template():
    m = moment()
    out = await Narrator(StubChatClient("slow", slow_s=5), load_settings({"TOUCHLINE_TIMEOUT_SCALE": "0.05"}, env_file=None)).narrate(m, analysis(m.moment_id), NAMES)
    assert out.fallback and out.reason == "timeout" and out.draft == template_draft(payload(m))


@pytest.mark.live
async def test_openai_narrates_with_declared_numbers():
    from touchline_agents.llm import make_client

    live = load_settings({"TOUCHLINE_LLM": "openai", "TOUCHLINE_TIMEOUT_SCALE": "10"})
    m = moment()
    out = await Narrator(make_client(live, "small"), live).narrate(m, analysis(m.moment_id), NAMES)
    print(out.ms, out.draft.model_dump_json(indent=1))
    assert not out.fallback, out.reason
```

- [ ] **Step 2: Run them to make sure they fail**

Run: `uv run --project services/agents pytest -q services/agents/tests/test_narrator.py`
Expected: a collection error: `No module named 'touchline_agents.narrator'`

- [ ] **Step 3: Write the Narrator**

Create `services/agents/touchline_agents/narrator.py`:

```python
"""Narrator (spec §5.3): turns the Analyst's claims into a headline and a short body, in English.

The draft lists every number it states as a claim pointing at its sentence, quoted exactly as written, so the
Fact-Checker can check each one. The fallback is a headline template per moment type, the Analyst's explanation
(which has no numbers) and at most two templated sentences that state claims.
"""

from dataclasses import dataclass

from agent_framework import Agent, BaseChatClient

from .config import Settings
from .contracts import Analysis, Draft, Moment
from .llm import agent_options, run_structured, stub_responder

INSTRUCTIONS = """You are the Narrator for a live football broadcast overlay, writing in English.
INPUT has the moment, the Analyst's cause, explanation and claims, the names of teams and players, and possibly
`feedback` from the Fact-Checker on your previous draft (fix exactly what it says).
Write `sentences`: sentence 0 is a headline of at most 8 words; then one or two short body sentences.
Use names, never ids. State only numbers that appear in the Analyst's claims, and for every number you write add
that claim to `claims` with `sentence` set to the sentence it is in and `quote` set to the number exactly as you
wrote it (e.g. "27%", "0.24", "2-1"). Keep the claim's other fields as the Analyst gave them. No other digits:
write the minute in words or leave it out. `lang` is "en"; `moment_id` comes from INPUT."""

MAX_HEADLINE_WORDS = 8
LABELS: dict[str, str] = {
    "shot.xg": "Expected goals for the chance", "team.press": "Pressure index", "ppda": "Opponent passes per defensive action",
    "tilt": "Field tilt", "team.mom": "Momentum share", "game.chaos": "Control-versus-chaos index", "plyr.vmax": "Top speed in km/h",
    "plyr.dist": "Metres covered", "pass.xp": "Completion probability of the pass", "pass.acc": "Pass accuracy",
    "team.poss": "Possession", "act.xt": "Expected threat added", "pitch.ctrl": "Pitch control", "pass.dist": "Average pass length in metres",
    "shot.speed": "Shot speed in km/h", "ball.speed": "Ball speed in km/h",
}


def headline(moment: dict, analysis: Analysis, names: dict[str, str]) -> str:
    team = names.get(moment["team_id"] or "", "")
    player = names.get(moment["player_id"] or "", team or "One player")
    t = moment["type"]
    if t == "pressure_shift":
        return f"{team} turn up the pressure" if analysis.cause != "press dropping off" else f"{team} ease off the press"
    if t == "card":
        return f"Red card for {player}" if analysis.cause == "red card" else f"Booking for {player}"
    return {
        "goal": f"Goal for {team}!", "costly_error": f"Costly error by {player}", "big_chance": f"Big chance for {team}",
        "momentum_swing": f"Momentum swings to {team}", "chaos_spike": "End-to-end football", "speed_alert": f"{player} at full speed",
        "distance_milestone": f"{player} keeps running", "player_milestone": f"Milestone for {player}",
        "difficult_pass_completed": f"Superb pass from {player}", "substitution_impact": f"{team}'s changes make an impact",
    }[t]


def template_draft(payload: dict) -> Draft:
    """The fallback: headline, the explanation, and up to two templated claim sentences."""
    analysis = Analysis.model_validate(payload["analysis"])
    sentences = [headline(payload["moment"], analysis, payload["names"]), analysis.explanation]
    claims = []
    for c in analysis.claims:
        if len(sentences) == 4:
            break
        if c.kind == "metric" and c.metric_id in LABELS and c.quote:
            sentences.append(f"{LABELS[c.metric_id]}: {c.quote}.")
        elif c.kind == "score" and c.quote:
            sentences.append(f"The score is now {c.quote}.")
        else:
            continue
        claims.append(c.model_copy(update={"sentence": len(sentences) - 1}))
    return Draft(moment_id=analysis.moment_id, lang="en", sentences=sentences, claims=claims)


@stub_responder("narrate")
def _stub(payload: dict, _results: list[str]) -> dict:
    return template_draft(payload).model_dump(mode="json")


def acceptable(d: Draft, moment_id: str) -> bool:
    """English, about this moment, a short headline, and every claim pointing at a sentence that quotes it."""
    return (
        d.moment_id == moment_id and d.lang == "en" and len(d.sentences) <= 4
        and len(d.sentences[0].split()) <= MAX_HEADLINE_WORDS + 2
        and all(c.sentence < len(d.sentences) and (not c.quote or c.quote in d.sentences[c.sentence]) for c in d.claims)
    )


@dataclass(frozen=True)
class NarratorResult:
    draft: Draft
    fallback: bool
    reason: str | None
    ms: float


class Narrator:
    def __init__(self, client: BaseChatClient, settings: Settings) -> None:
        self.settings = settings
        self.agent = Agent(client=client, name="narrator", instructions=INSTRUCTIONS, default_options=agent_options(settings))

    async def narrate(self, moment: Moment, analysis: Analysis, names: dict[str, str], feedback: list[str] | None = None) -> NarratorResult:
        payload = {
            "moment": moment.model_dump(mode="json"),
            "analysis": analysis.model_dump(mode="json"),
            "names": names,
            **({"feedback": feedback} if feedback else {}),
        }
        out = await run_structured(
            self.agent, "narrate", payload, Draft, timeout_s=self.settings.timeout("narrator"),
            fallback=lambda: template_draft(payload), accept=lambda d: acceptable(d, moment.moment_id),
        )
        return NarratorResult(out.value, out.fallback, out.reason, out.ms)
```

- [ ] **Step 4: Run the tests**

Run: `uv run --project services/agents pytest -q services/agents/tests/test_narrator.py`
Expected: 7 passed, 1 deselected

Optional, with the key in `.env.local` (one or two real `gpt-6.1-sol` calls; skipped by the default run):

Run: `uv run --project services/agents pytest -q -m live services/agents/tests/test_narrator.py`
Expected: 1 passed: a headline and two sentences, the score and the xG each declared with the quote as written; about 5 s

- [ ] **Step 5: Commit**

```bash
git add services/agents
git commit -m "feat(agents): Narrator — English headline and body with every number declared as a claim; headline template as fallback

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```



### Task 8: Fact-Checker

The Fact-Checker is the differentiator of spec §5.3. Code does the checking.

**Each claim, by kind:**
- **metric:** `verify_claim` for a subject at a frame, or the event's own value from `get_events` (looked up by id, a new `ids` filter). Tolerance is the engine's 2 %, at least 0.006. The quote must be a faithful rounding of the value: "0.50" is not 0.27, and "30%" is not 0.2653.
- **score:** the score at the frame, either way round.
- **minute:** the moment's minute.
- **event:** the event exists by the frame, and the player matches.
- **better_option:** the decision record ranks the named receiver first, and the pass played was not already rank 1.
- **Any kind:** a claim about a frame after the moment fails.

**Each sentence** also fails when:
- a number in it is undeclared;
- it names a rostered player who was not involved (by full name, or by a surname no involved player shares);
- it has a superlative ("fastest", "most", "record") with no metric claim behind it. Everyday words such as "best" are left alone.

**The model** is used only to extract claims for numbers the Narrator failed to declare; those claims are then checked like any other.

**Outcome.** The verdict is `pass`, `retry` (first attempt, with reasons for the Narrator) or `drop`. `published()` drops unverified sentences, renumbers the claims and replaces a failed headline with the template headline.

The tests seed ten kinds of hallucination into a true draft about the test match, and each must be caught (spec §7).

**Files:**
- Create: `services/agents/touchline_agents/factchecker.py`
- Modify: `packages/stats/src/query.ts`, `packages/mcp-stats/src/server.ts` (`ids` filter on `get_events`), `packages/mcp-stats/test/server.test.ts`
- Test: `services/agents/tests/test_factchecker.py`

**Interfaces:**
- Consumes: `StatsClient` (Task 3), `numbers_in`, `matches` (Task 6), `Claim`, `Draft`, `Verdict`, `SentenceCheck`; test-side `evidence`, `template_analysis` (Task 6), `template_draft` (Task 7).
- Produces: `tolerance(actual)`, `SUPERLATIVES`, `Extracted`, `Check` (`verdict`, `extracted`, `draft` with the extracted claims, `fallback`, `ms`), `FactChecker(client, settings).check_claim(stats, claim, lang, latest, clock)` and `.check(stats, draft, *, latest, clock, involved, attempt, extract=True)`, `feedback(verdict)`, `published(draft, verdict, headline)`; `_other_names(roster, involved)` (made public as `other_names` in Task 11); MCP `get_events` accepts `ids` (at most 100; unknown ids skipped).

- [ ] **Step 1: Write the failing tests**

Create `services/agents/tests/test_factchecker.py`:

```python
"""The Fact-Checker on drafts about the test match: a true draft passes, seeded hallucinations are caught (spec §7)."""

import pytest

from touchline_agents.analyst import evidence, template_analysis
from touchline_agents.config import load_settings
from touchline_agents.contracts import Draft, Signal
from touchline_agents.detector import DetectorState, build_moments
from touchline_agents.factchecker import FactChecker, feedback, published
from touchline_agents.llm import STUB_RESPONDERS, StubChatClient
from touchline_agents.narrator import template_draft

from .factories import claim

SETTINGS = load_settings({}, env_file=None)


@pytest.fixture
async def case(stats):
    signals = [Signal.model_validate(s) for s in await stats.signals(limit=500)]
    lead = next(s for s in signals if s.type == "goal")
    m = build_moments([lead.id], signals, DetectorState(fps=10), "rules")[0]
    pack = await evidence(stats, m, signals)
    a = template_analysis(pack)
    d = template_draft({"moment": m.model_dump(mode="json"), "analysis": a.model_dump(mode="json"), "names": pack["names"]})
    return m, pack, d


async def check(stats, case, draft: Draft, attempt: int = 0, client=None):
    m, pack, _ = case
    fc = FactChecker(client or StubChatClient(), SETTINGS)
    return await fc.check(stats, draft, latest=m.frame_to, clock=m.match_clock, involved=set(pack["names"]), attempt=attempt)


def with_sentence(d: Draft, text: str, *claims) -> Draft:
    i = len(d.sentences)
    return d.model_copy(update={"sentences": [*d.sentences, text], "claims": [*d.claims, *(c.model_copy(update={"sentence": i}) for c in claims)]})


def failing(result) -> dict[int, list[str]]:
    return {s.index: s.reasons for s in result.verdict.sentences if not s.verified}


async def test_a_true_draft_passes(stats, case):
    _, _, d = case
    r = await check(stats, case, d)
    assert r.verdict.status == "pass", failing(r)
    assert r.verdict.claims_checked == r.verdict.claims_verified == len(d.claims) >= 2


async def test_seeded_hallucinations_are_caught(stats, case):
    m, pack, d = case
    xg = next(c for c in d.claims if c.metric_id == "shot.xg")
    team = m.team_id
    at = m.frame_to
    press = (await stats.metric("team.press", team, at))["value"]
    passes = [e for e in pack["events"] if e["type"] == "pass"]
    decided = [(e, await stats.decision(e["id"], at)) for e in passes[:12]]
    best_pass = next(e for e, dec in decided if dec["chosen_rank"] == 1)
    worse_pass, worse = next((e, dec) for e, dec in decided if dec["chosen_rank"] not in (None, 1))
    wrong_receiver = next(o["receiver_id"] for o in worse["options"] if o["receiver_id"] != worse["best_receiver_id"])
    roster = await stats.roster()
    outsider = next(p for side in ("home", "away") for p in roster[side]["players"] if p["id"] not in pack["names"])
    lies = {
        "wrong value": with_sentence(d, f"That chance was worth {xg.value + 0.2:.2f}.", xg.model_copy(update={"quote": f"{xg.value + 0.2:.2f}", "value": xg.value + 0.2})),
        "rounding": with_sentence(d, "That chance was worth 0.50.", xg.model_copy(update={"quote": "0.50"})),
        "undeclared": with_sentence(d, "They have had 9 shots."),
        "score": with_sentence(d, "It is 7-0 now.", claim("score", quote="7-0", at_frame=at)),
        "future": with_sentence(d, f"Pressure index {press:.2f}.", claim(quote=f"{press:.2f}", metric_id="team.press", subject=team, value=press, at_frame=at + 600)),
        "no event": with_sentence(d, "A clever pass started it.", claim("event", event_id="agents-test-e999999", at_frame=at)),
        "wrong option": with_sentence(d, "A better pass was on.", claim("better_option", event_id=worse_pass["id"], receiver_id=wrong_receiver, at_frame=at)),
        "best already": with_sentence(d, "A better pass was on.", claim("better_option", event_id=best_pass["id"], receiver_id="p-x", at_frame=at)),
        "outsider": with_sentence(d, f"{outsider['name']} was watching."),
        "superlative": with_sentence(d, "The fastest move of the match."),
    }
    for name, draft in lies.items():
        r = await check(stats, case, draft)
        bad = failing(r)
        assert list(bad) == [len(draft.sentences) - 1], (name, bad)
        assert r.verdict.status == "retry", name


async def test_retry_then_drop(stats, case):
    _, _, d = case
    lie = with_sentence(d, "They have had 9 shots.")
    first = await check(stats, case, lie, attempt=0)
    assert first.verdict.status == "retry" and feedback(first.verdict) == [f'sentence {len(d.sentences)}: "9" is not declared as a claim']
    second = await check(stats, case, lie, attempt=1)
    assert second.verdict.status == "drop"
    assert published(second.draft, second.verdict, "Goal!").sentences == d.sentences


def test_a_failed_headline_is_replaced_and_claims_renumbered():
    d = Draft(moment_id="mo", lang="en", sentences=["Home win 9-0", "Body one.", "xG 0.12."], claims=[claim(sentence=2, quote="0.12", metric_id="shot.xg", value=0.12, event_id="e")])
    from touchline_agents.contracts import SentenceCheck, Verdict

    v = Verdict(moment_id="mo", status="drop", sentences=[SentenceCheck(index=0, verified=False, reasons=["x"]), SentenceCheck(index=1, verified=True, reasons=[]),
                SentenceCheck(index=2, verified=True, reasons=[])], claims_checked=1, claims_verified=1, undeclared=1)
    p = published(d, v, "Goal for Home")
    assert p.sentences == ["Goal for Home", "Body one.", "xG 0.12."] and p.claims[0].sentence == 2


async def test_the_model_extracts_undeclared_numbers(stats, case):
    _, _, d = case
    xg = next(c for c in d.claims if c.metric_id == "shot.xg")
    bare = with_sentence(d, f"The chance was worth {xg.quote} expected goals.")
    original = STUB_RESPONDERS["extract"]
    STUB_RESPONDERS["extract"] = lambda p, r: {"claims": [xg.model_copy(update={"sentence": p["index"]}).model_dump(mode="json")]}
    try:
        r = await check(stats, case, bare)
    finally:
        STUB_RESPONDERS["extract"] = original
    assert r.verdict.status == "pass", failing(r)
    assert len(r.extracted) == 1 and r.draft.claims[-1].sentence == len(bare.sentences) - 1
```

Apply this change to `packages/mcp-stats/test/server.test.ts` (from the repository root):

```bash
git apply <<'PATCH'
diff --git a/packages/mcp-stats/test/server.test.ts b/packages/mcp-stats/test/server.test.ts
index fe66e83..51fb432 100644
--- a/packages/mcp-stats/test/server.test.ts
+++ b/packages/mcp-stats/test/server.test.ts
@@ -148,6 +148,14 @@ describe("MCP stats server", () => {
     expect(tight.verified).toBe(false)
   })
 
+  it("look events up by id, never past the frame asked about", async () => {
+    const all = (await data("get_events", { from_frame: 0, to_frame: 20_000, types: ["pass"], limit: 500 })).events as Array<{ id: string; frame_id: number }>
+    const [a, b] = [all[3]!, all[all.length - 1]!]
+    const found = await data("get_events", { ids: [b.id, a.id, "no-such-event"] })
+    expect(found.events.map((e: { id: string }) => e.id)).toEqual([a.id, b.id])
+    expect((await data("get_events", { ids: [b.id], to_frame: a.frame_id })).events).toEqual([])
+  })
+
   it("refuse unknown team and player ids and event types in filters instead of answering with nothing", async () => {
     expect((await call("get_events", { team_id: "nobody-fc" })).content[0]!.text).toMatch(/unknown team "nobody-fc"/)
     expect((await call("get_events", { player_id: "p-nobody" })).content[0]!.text).toMatch(/unknown player "p-nobody"/)
PATCH
```

- [ ] **Step 2: Run them to make sure they fail**

Run: `uv run --project services/agents pytest -q services/agents/tests/test_factchecker.py`
Expected: a collection error: `No module named 'touchline_agents.factchecker'`

Run: `pnpm --filter @touchline/mcp-stats test server`
Expected: 1 failed, 17 passed: `look events up by id` gets the latest hundred passes instead of the two asked for (`ids` is not a filter yet)

- [ ] **Step 3: Look events up by id**

Apply this change to `packages/stats/src/query.ts`, `packages/mcp-stats/src/server.ts` (from the repository root):

```bash
git apply <<'PATCH'
diff --git a/packages/mcp-stats/src/server.ts b/packages/mcp-stats/src/server.ts
index 420ecc2..e10f52b 100644
--- a/packages/mcp-stats/src/server.ts
+++ b/packages/mcp-stats/src/server.ts
@@ -130,13 +130,14 @@ export const createStatsServer = (q: StatsQuery, advisor: Advisor | null = null)
         types: z.array(eventType).optional().describe("only these event types, e.g. [\"shot\", \"goal\"]"),
         team_id: z.string().optional(),
         player_id: z.string().optional(),
+        ids: z.array(z.string()).max(100).optional().describe("only these event ids (unknown ids are skipped)"),
         limit: z.number().int().min(1).max(500).optional().describe("at most this many, the latest kept (default 100)")
       },
       annotations: readOnly
     },
-    async ({ from_frame, to_frame, types, team_id, player_id, limit }) =>
+    async ({ from_frame, to_frame, types, team_id, player_id, ids, limit }) =>
       answer(() => {
-        const all = q.eventsBetween(from_frame ?? null, to_frame, { ...(types ? { types } : {}), ...(team_id ? { teamId: team_id } : {}), ...(player_id ? { playerId: player_id } : {}) })
+        const all = q.eventsBetween(from_frame ?? null, to_frame, { ...(types ? { types } : {}), ...(team_id ? { teamId: team_id } : {}), ...(player_id ? { playerId: player_id } : {}), ...(ids ? { ids } : {}) })
         return { as_of_frame: q.asOf(to_frame), total: all.length, events: all.slice(-(limit ?? 100)) }
       })
   )
diff --git a/packages/stats/src/query.ts b/packages/stats/src/query.ts
index e0d446f..7adb31a 100644
--- a/packages/stats/src/query.ts
+++ b/packages/stats/src/query.ts
@@ -159,7 +159,7 @@ export class StatsQuery {
   }
 
   /** Events known by `to` (emitted at or before it) whose own tick is at or after `from`. */
-  eventsBetween(from: number | null, to?: number | null, f: { readonly types?: ReadonlyArray<string>; readonly teamId?: string; readonly playerId?: string } = {}): EventView[] {
+  eventsBetween(from: number | null, to?: number | null, f: { readonly types?: ReadonlyArray<string>; readonly teamId?: string; readonly playerId?: string; readonly ids?: ReadonlyArray<string> } = {}): EventView[] {
     this.checkFilter(f.teamId, f.playerId)
     const t = this.asOf(to)
     const out: EventView[] = []
@@ -168,6 +168,7 @@ export class StatsQuery {
       const e = events[i]!
       if (eventTicks[i]! > t || (from !== null && e.frame_id < from)) continue
       if ((f.types && !f.types.includes(e.type)) || (f.teamId && e.team_id !== f.teamId) || (f.playerId && e.player_id !== f.playerId)) continue
+      if (f.ids && !f.ids.includes(e.id)) continue
       out.push(view(e, this.engine.derived.get(e.id) ?? {}))
     }
     return out
PATCH
```

Run: `pnpm --filter @touchline/mcp-stats test server`
Expected: 18 passed

- [ ] **Step 4: Write the Fact-Checker**

Create `services/agents/touchline_agents/factchecker.py`:

```python
"""Fact-Checker (spec §5.3): checks every number, name and comparison in a draft against the stats server.

Code does the checking. Each claim is checked by kind (metric values with verify_claim or the event's own value,
the score, the minute, events, better options against the decision record) and its quote must be a faithful
rounding of the checked value. A sentence passes when all its claims pass, every number in it is declared, it names
only players involved in the play, and any superlative in it rests on a claim. The model is used only to extract
claims for numbers the Narrator failed to declare. A failing draft gets one retry with the reasons, then its
unverified sentences are dropped.
"""

import re
import time
from dataclasses import dataclass

from agent_framework import Agent, BaseChatClient
from pydantic import BaseModel, ConfigDict

from .config import Settings
from .contracts import Claim, Draft, SentenceCheck, Verdict
from .llm import agent_options, run_structured, stub_responder
from .numbers import matches, numbers_in
from .stats import StatsClient, StatsError


def tolerance(actual: float) -> float:
    """The engine's own rule for verify_claim: 2 % of the actual value, at least 0.006."""
    return max(0.006, 0.02 * abs(actual))


# Comparisons that need a number behind them ("the fastest sprint of the match"). Everyday words such as "best"
# ("his best chance") are left alone.
SUPERLATIVES = re.compile(r"\b(highest|lowest|fastest|slowest|fewest|most|least|record|first time|más alt[oa]|más rápid[oa]|récord)\b|सबसे", re.I)
EXTRACT_INSTRUCTIONS = """You extract numeric claims from one sentence of football commentary.
INPUT gives the sentence, the numbers in it that no claim declares, the moment and its frame. For each such number,
return a claim (kind metric with metric_id and subject or event_id, kind score, or kind minute) whose `quote` is the
number exactly as written and whose `sentence` is INPUT's sentence index. If a number cannot be tied to a stats
metric, leave it out: an unexplained number is dropped."""


class Extracted(BaseModel):
    model_config = ConfigDict(extra="forbid")
    claims: list[Claim]


@stub_responder("extract")
def _stub(_payload: dict, _results: list[str]) -> dict:
    return {"claims": []}


@dataclass(frozen=True)
class Check:
    verdict: Verdict
    # Claims the model extracted for undeclared numbers (they were checked like the others).
    extracted: list[Claim]
    # The draft with the extracted claims added: what `published` drops sentences from.
    draft: Draft
    fallback: bool
    ms: float


class FactChecker:
    def __init__(self, client: BaseChatClient, settings: Settings) -> None:
        self.settings = settings
        self.agent = Agent(client=client, name="fact_checker", instructions=EXTRACT_INSTRUCTIONS, default_options=agent_options(settings))

    async def check_claim(self, stats: StatsClient, c: Claim, lang: str, latest: int, clock: str) -> str | None:
        """None when the claim holds, else the reason it does not."""
        if c.at_frame > latest:
            return f"claims frame {c.at_frame}, after the moment (frame {latest})"
        try:
            if c.kind == "metric":
                if c.metric_id is None or c.value is None:
                    return "a metric claim needs metric_id and value"
                if c.event_id is not None:
                    found = await stats.call("get_events", ids=[c.event_id], to_frame=c.at_frame)
                    if not found["events"]:
                        return f"no event {c.event_id} by frame {c.at_frame}"
                    actual = found["events"][0]["values"].get(c.metric_id)
                    if actual is None or abs(actual - c.value) > tolerance(actual):
                        return f"{c.metric_id} of {c.event_id} is {actual}, not {c.value}"
                elif c.subject is not None:
                    v = await stats.verify(c.metric_id, c.subject, c.at_frame, c.value, c.window_s)
                    if not v["verified"]:
                        return f"{c.metric_id} for {c.subject} is {v['actual']}, not {c.value}"
                else:
                    return "a metric claim needs a subject or an event"
                if c.quote and not matches(c.quote, c.value, lang):
                    return f'"{c.quote}" does not round {c.value}'
            elif c.kind == "score":
                s = (await stats.match_info(c.at_frame))["score"]
                said = [int(x) for x in re.findall(r"\d+", c.quote)]
                if sorted(said) != sorted([s["home"], s["away"]]) or len(said) != 2:
                    return f"the score at frame {c.at_frame} is {s['home']}-{s['away']}, not {c.quote}"
            elif c.kind == "minute":
                minute = int(clock.split(":")[0])
                if c.value is None or not (minute <= c.value <= minute + 1):
                    return f"the moment is in minute {minute + 1}, not {c.value}"
            elif c.kind == "event":
                found = await stats.call("get_events", ids=[c.event_id], to_frame=c.at_frame) if c.event_id else {"events": []}
                if not found["events"]:
                    return f"no event {c.event_id} by frame {c.at_frame}"
                if c.subject and c.subject.startswith("p-") and found["events"][0]["player_id"] != c.subject:
                    return f"event {c.event_id} was by {found['events'][0]['player_id']}, not {c.subject}"
            elif c.kind == "better_option":
                if not c.event_id or not c.receiver_id:
                    return "a better option needs event_id and receiver_id"
                d = await stats.decision(c.event_id, c.at_frame)
                if d["chosen_rank"] in (None, 1):
                    return f"the pass at {c.event_id} was already the best option"
                if d["best_receiver_id"] != c.receiver_id:
                    return f"the best option at {c.event_id} was {d['best_receiver_id']}, not {c.receiver_id}"
        except StatsError as e:
            return str(e)
        return None

    async def check(
        self, stats: StatsClient, draft: Draft, *, latest: int, clock: str, involved: set[str], attempt: int,
        extract: bool = True,
    ) -> Check:
        """Check a draft. `involved` are the ids of the teams and players the text may name; `attempt` 0 may get a
        retry, a later attempt drops what fails. `extract=False` skips the model (variants are checked by code only)."""
        t0 = time.perf_counter()
        roster = await stats.roster()
        others = _other_names(roster, involved)
        claims = list(draft.claims)
        extracted: list[Claim] = []
        fallback = False
        if extract:
            for i, sentence in enumerate(draft.sentences):
                missing = _undeclared(sentence, [c for c in claims if c.sentence == i])
                if not missing:
                    continue
                out = await run_structured(
                    self.agent, "extract",
                    {"sentence": sentence, "index": i, "undeclared": missing, "frame": latest, "clock": clock, "lang": draft.lang},
                    Extracted, timeout_s=self.settings.timeout("factchecker"), fallback=lambda: Extracted(claims=[]),
                )
                fallback |= out.fallback
                new = [c.model_copy(update={"sentence": i}) for c in out.value.claims if c.quote in sentence]
                extracted += new
                claims += new
        reasons: dict[int, list[str]] = {i: [] for i in range(len(draft.sentences))}
        verified = 0
        for c in claims:
            if c.sentence >= len(draft.sentences):
                continue
            if c.quote and c.quote not in draft.sentences[c.sentence]:
                reasons[c.sentence].append(f'"{c.quote}" is not in the sentence')
                continue
            why = await self.check_claim(stats, c, draft.lang, latest, clock)
            if why:
                reasons[c.sentence].append(why)
            else:
                verified += 1
        undeclared = 0
        for i, sentence in enumerate(draft.sentences):
            mine = [c for c in claims if c.sentence == i]
            for token in _undeclared(sentence, mine):
                undeclared += 1
                reasons[i].append(f'"{token}" is not declared as a claim')
            for name in others:
                if re.search(rf"\b{re.escape(name)}\b", sentence):
                    reasons[i].append(f"names {name}, who was not involved")
            if SUPERLATIVES.search(sentence) and not any(c.kind in ("metric", "better_option") for c in mine):
                reasons[i].append(f'"{SUPERLATIVES.search(sentence)[0]}" needs a metric claim')
        checks = [SentenceCheck(index=i, verified=not r, reasons=r) for i, r in reasons.items()]
        ok = all(c.verified for c in checks)
        status = "pass" if ok else ("retry" if attempt == 0 else "drop")
        v = Verdict(
            moment_id=draft.moment_id, status=status, sentences=checks, claims_checked=len([c for c in claims if c.sentence < len(draft.sentences)]),
            claims_verified=verified, undeclared=undeclared,
        )
        return Check(v, extracted, draft.model_copy(update={"claims": claims}), fallback, (time.perf_counter() - t0) * 1000)


def _undeclared(sentence: str, claims: list[Claim]) -> list[str]:
    return [t for t in numbers_in(sentence) if not any(t in c.quote for c in claims if c.quote)]


def _other_names(roster: dict, involved: set[str]) -> list[str]:
    """Full names and surnames of rostered players who are not involved (surnames shared with an involved player are
    left out: the text may mean the involved one)."""
    players = [p for side in ("home", "away") for p in roster[side]["players"]]
    allowed = {p["name"].split()[-1] for p in players if p["id"] in involved}
    out = []
    for p in players:
        if p["id"] in involved:
            continue
        out.append(p["name"])
        if p["name"].split()[-1] not in allowed:
            out.append(p["name"].split()[-1])
    return sorted(set(out), key=len, reverse=True)


def feedback(v: Verdict) -> list[str]:
    """The reasons, per sentence, for the Narrator's retry."""
    return [f"sentence {s.index}: {r}" for s in v.sentences for r in s.reasons]


def published(draft: Draft, v: Verdict, headline: str) -> Draft:
    """The draft with its unverified sentences dropped (the headline replaced by `headline`, which states no number,
    when it fails) and the remaining claims renumbered."""
    keep = [s.index for s in v.sentences if s.verified]
    sentences = [draft.sentences[i] for i in keep]
    claims = [c.model_copy(update={"sentence": keep.index(c.sentence)}) for c in draft.claims if c.sentence in keep]
    if 0 not in keep:
        sentences = [headline] + sentences
        claims = [c.model_copy(update={"sentence": c.sentence + 1}) for c in claims]
    return draft.model_copy(update={"sentences": sentences, "claims": claims})
```

- [ ] **Step 5: Run the tests**

Run: `uv run --project services/agents pytest -q services/agents/tests/test_factchecker.py`
Expected: 5 passed: the true draft passes with every claim verified; each of the ten lies (`wrong value`, `rounding`, `undeclared`, `score`, `future`, `no event`, `wrong option`, `best already`, `outsider`, `superlative`) fails exactly its own sentence

Run: `pnpm turbo run typecheck test --filter=@touchline/stats --filter=@touchline/mcp-stats --concurrency=2`
Expected: `Tasks: 4 successful`

- [ ] **Step 6: Commit**

```bash
git add packages/stats packages/mcp-stats services/agents
git commit -m "feat(agents): Fact-Checker — code checks every claim (metric values, event values, score, minute, events, better options), undeclared numbers, uninvolved names and unbacked superlatives; model only extracts undeclared claims; get_events looks events up by id

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```



### Task 9: Personalizer

The Personalizer (spec §5.5) reshapes a verified draft into one cue per segment (mode, language, club).

**The model** writes natively in the segment's language. It may state only numbers from the verified claims, each pointed at by index with its quote as written.

**Code checks every variant**, and a failing one becomes the template variant:
- Casual text carries at most one number, analyst text at most four; the length is capped.
- Each quote is a faithful rounding in the language's style.
- No stray numbers.
- Hindi is in Devanagari.
- No uninvolved players are named.

**Template variants:** a headline per moment type in English, Spanish and Hindi, written natively; club framing for casual viewers ("Bad news for Away Town."); the claims as labelled numbers. The tables live in a shared `templates.py`, which the Narrator now uses too.

**The cue** follows spec §5.4:
- The id is `<moment id>-<segment key>`, so variants cache by `(moment_id, segment_key)`.
- Casual cues go to the lower third, analyst cues to the side panel.
- `ttl_ms` is 12 s for priority 1, else 8 s.
- `data` holds the stated values, and the evidence lists the cited events and metrics, then the signals' evidence.

All segments run at once (`fan_out`).

**Files:**
- Create: `services/agents/touchline_agents/personalizer.py`, `services/agents/touchline_agents/templates.py`
- Modify: `services/agents/touchline_agents/narrator.py` (shared headlines and labels), `services/agents/tests/test_llm.py` (two unused imports)
- Test: `services/agents/tests/test_personalizer.py`

**Interfaces:**
- Consumes: `Draft`, `Claim`, `Cue`, `Segment`, `segment_key`, `format_metric`, `matches`, `numbers_in`, `Moment`.
- Produces:
  - `templates.py`: `NEGATIVE`, `HEADLINES`, `LABELS`, `FRAMING`, `headline_key(moment, cause)`, `headline(moment, cause, names, lang)`.
  - `personalizer.py`: `UsedNumber`, `Variant` (`headline`, `body`, `numbers`), `MAX_NUMBERS`, `MAX_CHARS`, `template_variant(payload)`, `check_variant(variant, payload, others) -> problems`, `make_cue(...)`, `Personalized` (`cue`, `fallback`, `reasons`, `ms`), `Personalizer(client, settings).personalize(...)` and `.fan_out(...)`.
  - Task 10 changes the moment argument to a `Story`.

- [ ] **Step 1: Write the failing tests**

Create `services/agents/tests/test_personalizer.py`:

```python
import itertools

import pytest

from touchline_agents.config import load_settings
from touchline_agents.contracts import Draft, Segment
from touchline_agents.detector import PRIORITY
from touchline_agents.llm import STUB_RESPONDERS, StubChatClient
from touchline_agents.personalizer import Personalizer, Variant, check_variant, make_cue, template_variant

from .factories import NAMES, claim, moment

SETTINGS = load_settings({}, env_file=None)
CLAIMS = [claim(quote="0.12", metric_id="shot.xg", value=0.1234, event_id="m-e10"), claim("score", quote="1-0"), claim(quote="58%", metric_id="team.mom", subject="home-fc", value=0.58)]
DRAFT = Draft(moment_id="mo-goal-3000", lang="en", sentences=["Goal for Home FC!", "A tidy finish.", "Expected goals for the chance: 0.12.", "The score is now 1-0."],
              claims=[c.model_copy(update={"sentence": i + 2}) for i, c in enumerate(CLAIMS[:2])] + [CLAIMS[2].model_copy(update={"sentence": 1})])


def payload(seg: Segment, type_: str = "goal", cause: str = "low-probability chance"):
    m = moment(type_, player="h9")
    return {"segment": seg.model_dump(mode="json"), "moment": m.model_dump(mode="json"), "cause": cause, "names": NAMES, "draft": DRAFT.sentences,
            "claims": [c.model_dump(mode="json") for c in DRAFT.claims]}


SEGMENTS = [Segment(mode=m, lang=l, club=c) for m, l, c in itertools.product(["casual", "analyst"], ["en", "es", "hi"], [None, "home-fc", "away-fc"])]


@pytest.mark.parametrize("type_", sorted(PRIORITY))
def test_template_variants_always_pass_the_check(type_):
    for seg in SEGMENTS:
        p = payload(seg, type_)
        v = template_variant(p)
        assert check_variant(v, p, others=["Cy Outsider"]) == [], (type_, seg)


def test_casual_is_short_and_framed_analyst_is_deep():
    casual = template_variant(payload(Segment(mode="casual", lang="es", club="away-fc")))
    analyst = template_variant(payload(Segment(mode="analyst", lang="es", club=None)))
    assert casual.headline == "¡Gol de Home FC!" and casual.body.startswith("Malas noticias para Away Town.") and len(casual.numbers) == 1
    assert len(analyst.numbers) == 3 and "0,12" in analyst.body and "58%" in analyst.body
    hindi = template_variant(payload(Segment(mode="analyst", lang="hi", club=None)))
    assert hindi.headline == "Home FC का गोल!" and "स्कोर: 1-0।" in hindi.body


@pytest.mark.parametrize(("variant", "problem"), [
    (Variant(headline="Goal!", body="It was 0.12 and 58%.", numbers=[{"claim": 0, "quote": "0.12"}, {"claim": 2, "quote": "58%"}]), "2 numbers in a casual variant"),
    (Variant(headline="Goal!", body="Worth 0.30.", numbers=[{"claim": 0, "quote": "0.30"}]), "does not round claim 0"),
    (Variant(headline="Goal!", body="They had 9 shots.", numbers=[]), '"9" is not one of the verified claims'),
    (Variant(headline="Goal!", body="Now 2-0.", numbers=[{"claim": 1, "quote": "2-0"}]), "is not the score"),
    (Variant(headline="Goal!", body="Cy Outsider watched.", numbers=[]), "who was not involved"),
    (Variant(headline="Goal!", body="Worth 0.12.", numbers=[{"claim": 7, "quote": "0.12"}]), "no claim 7"),
])
def test_the_check_catches_bad_variants(variant, problem):
    p = payload(Segment(mode="casual", lang="en", club=None))
    assert any(problem in x for x in check_variant(variant, p, ["Cy Outsider"])), check_variant(variant, p, ["Cy Outsider"])


def test_hindi_must_be_devanagari():
    p = payload(Segment(mode="analyst", lang="hi", club=None))
    assert "Hindi text must be in Devanagari" in check_variant(Variant(headline="Goal for Home FC", body="Nice.", numbers=[]), p, [])


def test_cue_follows_the_contract():
    seg = Segment(mode="analyst", lang="en", club=None)
    m = moment("goal")
    v = template_variant(payload(seg))
    cue = make_cue(m, seg, v, DRAFT.claims, ["m-e10", "m-e11"])
    assert cue.cue_id == f"{m.moment_id}-analyst.en.neutral" and cue.schema_ == "touchline.cue/1"
    assert cue.display.slot == "side_panel" and cue.display.ttl_ms == 12000 and cue.verified
    assert cue.data == {"shot.xg": 0.1234, "score.home": 1, "score.away": 0, "team.mom": 0.58}
    assert cue.evidence[0] == "m-e10" and cue.anchor.clock == m.match_clock[:5]


async def test_fans_out_over_segments_through_the_model():
    m = moment("goal", player="h9")
    out = await Personalizer(StubChatClient(), SETTINGS).fan_out(m, DRAFT, "low-probability chance", NAMES, SEGMENTS[:6], [], [])
    assert [p.cue.segment for p in out] == SEGMENTS[:6] and not any(p.fallback for p in out)
    assert len({p.cue.cue_id for p in out}) == 6


async def test_a_variant_that_fails_the_check_becomes_the_template():
    original = STUB_RESPONDERS["personalize"]
    STUB_RESPONDERS["personalize"] = lambda p, r: {"headline": "Goal!", "body": "They had 9 shots and 0.12 xG.", "numbers": [{"claim": 0, "quote": "0.12"}]}
    try:
        seg = Segment(mode="casual", lang="en", club=None)
        out = await Personalizer(StubChatClient(), SETTINGS).personalize(moment("goal", player="h9"), DRAFT, "low-probability chance", NAMES, seg, [], [])
    finally:
        STUB_RESPONDERS["personalize"] = original
    assert out.fallback and any('"9"' in r for r in out.reasons)
    assert out.cue.text.headline == "Goal for Home FC!"


@pytest.mark.live
@pytest.mark.parametrize("seg", [Segment(mode="casual", lang="es", club="away-fc"), Segment(mode="analyst", lang="hi", club=None)])
async def test_openai_writes_native_variants_that_pass_the_check(seg):
    from touchline_agents.llm import make_client

    live = load_settings({"TOUCHLINE_LLM": "openai", "TOUCHLINE_TIMEOUT_SCALE": "10"})
    out = await Personalizer(make_client(live, "small"), live).personalize(moment("goal", player="h9"), DRAFT, "low-probability chance", NAMES, seg, ["Cy Outsider"], [])
    print(round(out.ms), out.cue.text.model_dump(), out.reasons)
    assert not out.fallback, out.reasons
```

- [ ] **Step 2: Run them to make sure they fail**

Run: `uv run --project services/agents pytest -q services/agents/tests/test_personalizer.py`
Expected: a collection error: `No module named 'touchline_agents.personalizer'`

- [ ] **Step 3: Write the phrase tables and the Personalizer**

Create `services/agents/touchline_agents/templates.py`:

```python
"""Phrase tables shared by the Narrator, the Personalizer and the Recap Producer: headlines per moment type, metric
labels and club framing, in English, Spanish and Hindi (written natively, not machine-translated)."""

NEGATIVE = {"costly_error", "card"}  # bad news for the moment's own team

HEADLINES: dict[str, dict[str, str]] = {
    "en": {"goal": "Goal for {team}!", "costly_error": "Costly error by {player}", "big_chance": "Big chance for {team}", "press_up": "{team} turn up the pressure",
           "press_down": "{team} ease off the press", "momentum_swing": "Momentum swings to {team}", "chaos_spike": "End-to-end football",
           "red": "Red card for {player}", "yellow": "Booking for {player}", "speed_alert": "{player} at full speed", "distance_milestone": "{player} keeps running",
           "player_milestone": "Milestone for {player}", "difficult_pass_completed": "Superb pass from {player}", "substitution_impact": "{team}'s changes make an impact"},
    "es": {"goal": "¡Gol de {team}!", "costly_error": "Error costoso de {player}", "big_chance": "Gran ocasión para {team}", "press_up": "{team} aprieta en la presión",
           "press_down": "{team} afloja la presión", "momentum_swing": "El impulso es de {team}", "chaos_spike": "Partido de ida y vuelta",
           "red": "Roja para {player}", "yellow": "Amarilla para {player}", "speed_alert": "{player}, a toda velocidad", "distance_milestone": "{player} no para de correr",
           "player_milestone": "Hito para {player}", "difficult_pass_completed": "Pase magnífico de {player}", "substitution_impact": "Los cambios de {team} surten efecto"},
    "hi": {"goal": "{team} का गोल!", "costly_error": "{player} की महंगी गलती", "big_chance": "{team} के लिए बड़ा मौका", "press_up": "{team} ने दबाव बढ़ाया",
           "press_down": "{team} ने दबाव घटाया", "momentum_swing": "लय {team} के पक्ष में", "chaos_spike": "आमने-सामने का खेल",
           "red": "{player} को लाल कार्ड", "yellow": "{player} को पीला कार्ड", "speed_alert": "{player} पूरी रफ़्तार में", "distance_milestone": "{player} लगातार दौड़ रहे हैं",
           "player_milestone": "{player} की उपलब्धि", "difficult_pass_completed": "{player} का शानदार पास", "substitution_impact": "{team} के बदलावों का असर"},
}
LABELS: dict[str, dict[str, str]] = {
    "en": {"shot.xg": "Expected goals for the chance", "team.press": "Pressure index", "ppda": "Opponent passes per defensive action", "tilt": "Field tilt",
           "team.mom": "Momentum share", "game.chaos": "Control-versus-chaos index", "plyr.vmax": "Top speed in km/h", "plyr.dist": "Metres covered",
           "pass.xp": "Completion probability of the pass", "pass.acc": "Pass accuracy", "team.poss": "Possession", "act.xt": "Expected threat added",
           "pitch.ctrl": "Pitch control", "pass.dist": "Average pass length in metres", "shot.speed": "Shot speed in km/h", "ball.speed": "Ball speed in km/h", "score": "Score"},
    "es": {"shot.xg": "Goles esperados de la ocasión", "team.press": "Índice de presión", "ppda": "Pases rivales por acción defensiva", "tilt": "Inclinación del campo",
           "team.mom": "Cuota de impulso", "game.chaos": "Índice de control frente a caos", "plyr.vmax": "Velocidad máxima en km/h", "plyr.dist": "Metros recorridos",
           "pass.xp": "Probabilidad de completar el pase", "pass.acc": "Precisión de pase", "team.poss": "Posesión", "act.xt": "Amenaza esperada añadida",
           "pitch.ctrl": "Control del campo", "pass.dist": "Longitud media de pase en metros", "shot.speed": "Velocidad del disparo en km/h", "ball.speed": "Velocidad del balón en km/h", "score": "Marcador"},
    "hi": {"shot.xg": "मौके का अपेक्षित गोल (xG)", "team.press": "दबाव सूचकांक", "ppda": "प्रति रक्षात्मक कार्रवाई विरोधी पास", "tilt": "मैदान का झुकाव",
           "team.mom": "लय में हिस्सेदारी", "game.chaos": "नियंत्रण बनाम अराजकता सूचकांक", "plyr.vmax": "शीर्ष गति (किमी/घंटा)", "plyr.dist": "तय की गई दूरी (मीटर)",
           "pass.xp": "पास पूरा होने की संभावना", "pass.acc": "पास सटीकता", "team.poss": "कब्ज़ा", "act.xt": "जोड़ा गया अपेक्षित ख़तरा",
           "pitch.ctrl": "मैदान पर नियंत्रण", "pass.dist": "औसत पास लंबाई (मीटर)", "shot.speed": "शॉट की गति (किमी/घंटा)", "ball.speed": "गेंद की गति (किमी/घंटा)", "score": "स्कोर"},
}
FRAMING: dict[str, tuple[str, str]] = {
    "en": ("Good news for {club}.", "Bad news for {club}."),
    "es": ("Buenas noticias para {club}.", "Malas noticias para {club}."),
    "hi": ("{club} के लिए अच्छी खबर।", "{club} के लिए बुरी खबर।"),
}


def headline_key(moment: dict, cause: str) -> str:
    t = moment["type"]
    if t == "pressure_shift":
        return "press_down" if cause == "press dropping off" else "press_up"
    if t == "card":
        return "red" if cause == "red card" else "yellow"
    return t


def headline(moment: dict, cause: str, names: dict[str, str], lang: str = "en") -> str:
    """The template headline for a moment, naming its team or player."""
    team = names.get(moment["team_id"] or "", "")
    player = names.get(moment["player_id"] or "", team)
    return HEADLINES[lang][headline_key(moment, cause)].format(team=team, player=player)
```

Create `services/agents/touchline_agents/personalizer.py`:

```python
"""Personalizer (spec §5.3, §5.5): reshapes a verified draft for one segment (mode, language, club) into a cue.

The model writes natively in the segment's language and may only state numbers from the verified claims, each
pointed at by index. Code checks every variant: its numbers must be faithful re-quotes of verified claims, casual
text carries at most one number, Hindi text is in Devanagari, names are only those of players involved. A variant
that fails, or a model that fails, gives the template variant for that language instead.
"""

import asyncio
import re
from dataclasses import dataclass

from agent_framework import Agent, BaseChatClient
from pydantic import BaseModel, ConfigDict

from .config import Settings
from .contracts import Claim, Cue, Draft, Moment, Segment, segment_key
from .llm import agent_options, run_structured, stub_responder
from .numbers import format_metric, matches, numbers_in
from .templates import FRAMING, LABELS, NEGATIVE, headline

INSTRUCTIONS = """You are the Personalizer for a live football broadcast overlay.
INPUT has a verified English draft (sentences and numbered claims), the moment, names and one viewer segment:
mode (casual or analyst), lang (en, es or hi) and club (the team the viewer supports, or null).
Write a `headline` (at most 8 words) and a `body` NATIVELY in the segment's language (Spanish: natural Spanish;
Hindi: Devanagari script, Western digits), not a word-for-word translation.
- casual: short (one sentence), emotional, framed for the viewer's club; at most ONE number.
- analyst: numbers first, precise, up to three numbers, comparisons only if a claim supports them.
State only numbers from INPUT's claims. For each number you write, add {"claim": <index>, "quote": <the number
exactly as you wrote it>} to `numbers`; write numbers in the language's style (Spanish decimal comma: 0,24).
Use names, never ids, and no players other than those in `names`."""

DEVANAGARI = re.compile(r"[\u0900-\u097F]")
MAX_NUMBERS = {"casual": 1, "analyst": 4}
MAX_CHARS = {"casual": 160, "analyst": 320}
class UsedNumber(BaseModel):
    model_config = ConfigDict(extra="forbid")
    claim: int
    quote: str


class Variant(BaseModel):
    model_config = ConfigDict(extra="forbid")
    headline: str
    body: str
    numbers: list[UsedNumber]


def _quote(c: Claim, lang: str) -> str | None:
    if c.kind == "metric" and c.metric_id and c.value is not None:
        return format_metric(c.metric_id, c.value, lang)
    if c.kind == "score":
        return c.quote
    return None


def template_variant(payload: dict) -> Variant:
    """The fallback: the template headline in the segment's language, club framing for casual viewers, and the
    claims as labelled numbers (one for casual, up to three for analyst)."""
    seg, m, names = payload["segment"], payload["moment"], payload["names"]
    lang = seg["lang"]
    head = headline(m, payload["cause"], names, lang)
    parts: list[str] = []
    if seg["mode"] == "casual" and seg["club"] and seg["club"] in names and m["team_id"]:
        good = (seg["club"] == m["team_id"]) != (m["type"] in NEGATIVE)
        parts.append(FRAMING[lang][0 if good else 1].format(club=names[seg["club"]]))
    used: list[UsedNumber] = []
    for i, raw in enumerate(payload["claims"]):
        c = Claim.model_validate(raw)
        q = _quote(c, lang)
        if q is None or len(used) == (1 if seg["mode"] == "casual" else 3):
            continue
        label = LABELS[lang]["score" if c.kind == "score" else c.metric_id]
        parts.append(f"{label}: {q}" + ("।" if lang == "hi" else "."))
        used.append(UsedNumber(claim=i, quote=q))
    return Variant(headline=head, body=" ".join(parts), numbers=used)


@stub_responder("personalize")
def _stub(payload: dict, _results: list[str]) -> dict:
    return template_variant(payload).model_dump(mode="json")


def check_variant(v: Variant, payload: dict, others: list[str]) -> list[str]:
    """Why a variant cannot be published (empty when it can)."""
    seg = payload["segment"]
    lang, mode = seg["lang"], seg["mode"]
    claims = [Claim.model_validate(c) for c in payload["claims"]]
    text = f"{v.headline} {v.body}"
    problems = []
    tokens = numbers_in(text)
    if len(tokens) > MAX_NUMBERS[mode]:
        problems.append(f"{len(tokens)} numbers in a {mode} variant (at most {MAX_NUMBERS[mode]})")
    if len(v.body) > MAX_CHARS[mode]:
        problems.append(f"body longer than {MAX_CHARS[mode]} characters")
    for u in v.numbers:
        if not 0 <= u.claim < len(claims):
            problems.append(f"no claim {u.claim}")
            continue
        c = claims[u.claim]
        if u.quote not in text:
            problems.append(f'"{u.quote}" is not in the text')
        elif c.kind == "metric" and (c.value is None or not matches(u.quote, c.value, lang)):
            problems.append(f'"{u.quote}" does not round claim {u.claim}')
        elif c.kind == "score" and sorted(re.findall(r"\d+", u.quote)) != sorted(re.findall(r"\d+", c.quote)):
            problems.append(f'"{u.quote}" is not the score {c.quote}')
        elif c.kind not in ("metric", "score"):
            problems.append(f"claim {u.claim} has no number to quote")
    for t in tokens:
        if not any(t in u.quote for u in v.numbers):
            problems.append(f'"{t}" is not one of the verified claims')
    if lang == "hi" and not DEVANAGARI.search(text):
        problems.append("Hindi text must be in Devanagari")
    for name in others:
        if re.search(rf"\b{re.escape(name)}\b", text):
            problems.append(f"names {name}, who was not involved")
    return problems


def make_cue(moment: Moment, segment: Segment, v: Variant, claims: list[Claim], evidence: list[str]) -> Cue:
    used = [claims[u.claim] for u in v.numbers if 0 <= u.claim < len(claims)]
    data: dict[str, float] = {}
    for c in used:
        if c.kind == "metric" and c.metric_id and c.value is not None:
            data[c.metric_id] = c.value
        elif c.kind == "score":
            home, away = (int(x) for x in re.findall(r"\d+", c.quote)[:2])
            data |= {"score.home": home, "score.away": away}
    refs = [ref for c in used for ref in ([c.event_id] if c.event_id else [f"{c.metric_id}@{c.subject}:{c.at_frame}"] if c.metric_id else [])]
    return Cue.model_validate({
        "cue_id": f"{moment.moment_id}-{segment_key(segment)}",
        "schema": "touchline.cue/1",
        "match_id": moment.match_id,
        "moment_id": moment.moment_id,
        "anchor": {"frame_from": moment.frame_from, "frame_to": moment.frame_to, "clock": moment.match_clock[:5]},
        "display": {"slot": "lower_third" if segment.mode == "casual" else "side_panel", "priority": moment.priority,
                    "ttl_ms": 12000 if moment.priority == 1 else 8000, "template": moment.type},
        "segment": segment.model_dump(mode="json"),
        "text": {"headline": v.headline, "body": v.body},
        "data": data,
        "evidence": list(dict.fromkeys(refs + evidence)),
        "verified": True,
    })


@dataclass(frozen=True)
class Personalized:
    cue: Cue
    fallback: bool
    # Why the model's variant was not used (a model failure or the check's reasons).
    reasons: list[str]
    ms: float


class Personalizer:
    def __init__(self, client: BaseChatClient, settings: Settings) -> None:
        self.settings = settings
        self.agent = Agent(client=client, name="personalizer", instructions=INSTRUCTIONS, default_options=agent_options(settings))

    async def personalize(
        self, moment: Moment, draft: Draft, cause: str, names: dict[str, str], segment: Segment, others: list[str], evidence: list[str],
    ) -> Personalized:
        payload = {
            "segment": segment.model_dump(mode="json"),
            "moment": moment.model_dump(mode="json", include={"moment_id", "type", "team_id", "player_id", "match_clock"}),
            "cause": cause,
            "names": names,
            "draft": draft.sentences,
            "claims": [c.model_dump(mode="json") for c in draft.claims if _quote(c, "en") is not None],
        }
        claims = [Claim.model_validate(c) for c in payload["claims"]]
        out = await run_structured(self.agent, "personalize", payload, Variant, timeout_s=self.settings.timeout("personalizer"), fallback=lambda: template_variant(payload))
        variant, reasons = out.value, [out.reason] if out.fallback and out.reason else []
        if not out.fallback and (problems := check_variant(variant, payload, others)):
            variant, reasons = template_variant(payload), problems
        return Personalized(make_cue(moment, segment, variant, claims, evidence), bool(reasons), reasons, out.ms)

    async def fan_out(self, moment: Moment, draft: Draft, cause: str, names: dict[str, str], segments: list[Segment], others: list[str], evidence: list[str]) -> list[Personalized]:
        """Every segment at once (generation scales with segments, not viewers)."""
        return list(await asyncio.gather(*(self.personalize(moment, draft, cause, names, s, others, evidence) for s in segments)))
```

Apply this change to `services/agents/touchline_agents/narrator.py`, `services/agents/tests/test_llm.py` (from the repository root):

```bash
git apply <<'PATCH'
diff --git a/services/agents/tests/test_llm.py b/services/agents/tests/test_llm.py
index dcfdffb..cd6dee6 100644
--- a/services/agents/tests/test_llm.py
+++ b/services/agents/tests/test_llm.py
@@ -1,6 +1,3 @@
-import asyncio
-import json
-
 import pytest
 from agent_framework import Agent, tool
 from pydantic import BaseModel
diff --git a/services/agents/touchline_agents/narrator.py b/services/agents/touchline_agents/narrator.py
index 0348bae..e182f2f 100644
--- a/services/agents/touchline_agents/narrator.py
+++ b/services/agents/touchline_agents/narrator.py
@@ -12,6 +12,7 @@ from agent_framework import Agent, BaseChatClient
 from .config import Settings
 from .contracts import Analysis, Draft, Moment
 from .llm import agent_options, run_structured, stub_responder
+from .templates import LABELS, headline
 
 INSTRUCTIONS = """You are the Narrator for a live football broadcast overlay, writing in English.
 INPUT has the moment, the Analyst's cause, explanation and claims, the names of teams and players, and possibly
@@ -23,41 +24,18 @@ wrote it (e.g. "27%", "0.24", "2-1"). Keep the claim's other fields as the Analy
 write the minute in words or leave it out. `lang` is "en"; `moment_id` comes from INPUT."""
 
 MAX_HEADLINE_WORDS = 8
-LABELS: dict[str, str] = {
-    "shot.xg": "Expected goals for the chance", "team.press": "Pressure index", "ppda": "Opponent passes per defensive action",
-    "tilt": "Field tilt", "team.mom": "Momentum share", "game.chaos": "Control-versus-chaos index", "plyr.vmax": "Top speed in km/h",
-    "plyr.dist": "Metres covered", "pass.xp": "Completion probability of the pass", "pass.acc": "Pass accuracy",
-    "team.poss": "Possession", "act.xt": "Expected threat added", "pitch.ctrl": "Pitch control", "pass.dist": "Average pass length in metres",
-    "shot.speed": "Shot speed in km/h", "ball.speed": "Ball speed in km/h",
-}
-
-
-def headline(moment: dict, analysis: Analysis, names: dict[str, str]) -> str:
-    team = names.get(moment["team_id"] or "", "")
-    player = names.get(moment["player_id"] or "", team or "One player")
-    t = moment["type"]
-    if t == "pressure_shift":
-        return f"{team} turn up the pressure" if analysis.cause != "press dropping off" else f"{team} ease off the press"
-    if t == "card":
-        return f"Red card for {player}" if analysis.cause == "red card" else f"Booking for {player}"
-    return {
-        "goal": f"Goal for {team}!", "costly_error": f"Costly error by {player}", "big_chance": f"Big chance for {team}",
-        "momentum_swing": f"Momentum swings to {team}", "chaos_spike": "End-to-end football", "speed_alert": f"{player} at full speed",
-        "distance_milestone": f"{player} keeps running", "player_milestone": f"Milestone for {player}",
-        "difficult_pass_completed": f"Superb pass from {player}", "substitution_impact": f"{team}'s changes make an impact",
-    }[t]
 
 
 def template_draft(payload: dict) -> Draft:
     """The fallback: headline, the explanation, and up to two templated claim sentences."""
     analysis = Analysis.model_validate(payload["analysis"])
-    sentences = [headline(payload["moment"], analysis, payload["names"]), analysis.explanation]
+    sentences = [headline(payload["moment"], analysis.cause, payload["names"]), analysis.explanation]
     claims = []
     for c in analysis.claims:
         if len(sentences) == 4:
             break
-        if c.kind == "metric" and c.metric_id in LABELS and c.quote:
-            sentences.append(f"{LABELS[c.metric_id]}: {c.quote}.")
+        if c.kind == "metric" and c.metric_id in LABELS["en"] and c.quote:
+            sentences.append(f"{LABELS['en'][c.metric_id]}: {c.quote}.")
         elif c.kind == "score" and c.quote:
             sentences.append(f"The score is now {c.quote}.")
         else:
PATCH
```

- [ ] **Step 4: Run the tests**

Run: `uv run --project services/agents pytest -q services/agents/tests/test_personalizer.py services/agents/tests/test_narrator.py`
Expected: 30 passed, 3 deselected (template variants pass the check for every moment type, language, mode and club framing)

Optional, with the key in `.env.local` (one or two real `gpt-6.1-sol` calls; skipped by the default run):

Run: `uv run --project services/agents pytest -q -m live services/agents/tests/test_personalizer.py`
Expected: 2 passed: a casual Spanish variant framed for an Away Town fan and an analyst Hindi variant, both through the check; about 5 s each

- [ ] **Step 5: Commit**

```bash
git add services/agents
git commit -m "feat(agents): Personalizer — native EN/ES/HI variants per segment from verified claims only, code-checked (casual one number, Devanagari, names), template variants as fallback; cue contract; shared phrase tables

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```



### Task 10: Recap Producer

The Recap Producer (spec §5.3) writes half-time and full-time recaps from a pack gathered over MCP:
- **The pack:** the score; possession, xG, pass accuracy and field tilt for both teams; the top three players by expected threat added and by xG; the moments told so far, as of the whistle.
- **The model** writes a headline and two to four sentences, with every number declared. It picks up to three turning points from the moment ids and, at full time, a player of the match from the top players.
- **The fallback** is a stats-only recap: the score, possession and xG pairs, the player of the match by expected threat added, and turning points by priority and salience.
- **Checks:** the Fact-Checker checks a recap like any draft (a live recap passed first time).

The Personalizer is generalised from moments to a `Story`, so a recap becomes recap cards. Its template headlines carry no numbers, which keeps casual cards to one.

**Files:**
- Create: `services/agents/touchline_agents/recap.py`
- Modify: `services/agents/touchline_agents/personalizer.py` (`Story`), `services/agents/touchline_agents/templates.py` (recap headlines), `services/agents/tests/test_personalizer.py`
- Test: `services/agents/tests/test_recap.py`

**Interfaces:**
- Consumes: `StatsClient`, `FactChecker` (test), `Personalizer`, `Draft`, `Recap`, `Claim`, `format_metric`.
- Produces:
  - `personalizer.py`: `Story` (`id`, `match_id`, `template`, `team_id`, `player_id`, `frame_from`, `frame_to`, `clock`, `priority`, `headlines`, `slots`, `Story.of_moment(moment, cause, names)`), `LANGS`; `personalize(story, draft, names, segment, others, evidence)` and `fan_out(story, draft, names, segments, others, evidence)`.
  - `templates.py`: `RECAP_HEADLINES`.
  - `recap.py`: `TEAM_METRICS`, `MAX_TURNING_POINTS = 3`, `RecapOutput`, `Told(moment, cause, headline)`, `recap_pack(stats, kind, at_frame, told)`, `template_recap(pack)`, `acceptable(output, pack)`, `recap_story(recap, pack)`, `Produced` (`.draft(recap_id)`), `RecapProducer(client, settings).produce(stats, kind, at_frame, told, feedback=None, pack=None)`.

- [ ] **Step 1: Write the failing tests**

Create `services/agents/tests/test_recap.py`:

```python
import pytest

from touchline_agents.config import load_settings
from touchline_agents.contracts import Recap, Segment, Signal
from touchline_agents.detector import DetectorState, build_moments, candidates, rule_selection
from touchline_agents.factchecker import FactChecker
from touchline_agents.llm import StubChatClient
from touchline_agents.personalizer import Personalizer
from touchline_agents.recap import RecapProducer, Told, acceptable, recap_pack, recap_story, template_recap

SETTINGS = load_settings({}, env_file=None)


@pytest.fixture
async def whistle(stats):
    """(frame of the half-time whistle, frame of the full-time whistle, moments told by then)."""
    ends = [e["frame_id"] for e in await stats.events(0, 10**7, types=["period_end"])]
    signals = [Signal.model_validate(s) for s in await stats.signals(limit=500)]
    st = DetectorState(fps=10)
    told = [Told(m, "cause", "headline") for m in build_moments(rule_selection(candidates(signals, st)), signals, st, "rules")]
    return ends[0], ends[-1], told


async def test_stats_only_recap_passes_the_fact_checker(stats, whistle):
    ht, ft, told = whistle
    for kind, at in (("half_time", ht), ("full_time", ft)):
        pack = await recap_pack(stats, kind, at, told)
        r = template_recap(pack)
        assert acceptable(r, pack)
        assert r.sentences[0].startswith("Half-time" if kind == "half_time" else "Full-time")
        assert all(tp in {m["id"] for m in pack["moments"]} for tp in r.turning_points) and len(r.turning_points) <= 3
        assert (r.player_of_match is None) == (kind == "half_time")
        from touchline_agents.contracts import Draft

        check = await FactChecker(StubChatClient(), SETTINGS).check(
            stats, Draft(moment_id=f"r-{kind}", lang="en", sentences=r.sentences, claims=r.claims), latest=at, clock=pack["clock"], involved=set(pack["names"]), attempt=0)
        assert check.verdict.status == "pass", [s.reasons for s in check.verdict.sentences]


async def test_half_time_turning_points_come_from_the_first_half(stats, whistle):
    ht, _, told = whistle
    pack = await recap_pack(stats, "half_time", ht, told)
    frames = {t.moment.moment_id: t.moment.frame_id for t in told}
    assert all(frames[m["id"]] <= ht for m in pack["moments"])


async def test_produces_through_the_model_and_falls_back(stats, whistle):
    _, ft, told = whistle
    ok = await RecapProducer(StubChatClient(), SETTINGS).produce(stats, "full_time", ft, told)
    assert not ok.fallback and ok.output == template_recap(ok.pack)
    bad = await RecapProducer(StubChatClient("error"), SETTINGS).produce(stats, "full_time", ft, told, pack=ok.pack)
    assert bad.fallback and bad.output == ok.output


async def test_recap_cards_in_every_language(stats, whistle):
    _, ft, told = whistle
    produced = await RecapProducer(StubChatClient(), SETTINGS).produce(stats, "full_time", ft, told)
    out = produced.output
    recap = Recap(recap_id="agents-test-recap-full_time", match_id="agents-test", kind="full_time", at_frame=ft, sentences=out.sentences, claims=out.claims,
                  turning_points=out.turning_points, player_of_match=out.player_of_match, verified=True)
    story = recap_story(recap, produced.pack)
    segs = [Segment(mode=m, lang=l, club=None) for m in ("casual", "analyst") for l in ("en", "es", "hi")]
    cards = await Personalizer(StubChatClient(), SETTINGS).fan_out(story, produced.draft(recap.recap_id), produced.pack["names"], segs, [], [])
    assert all(c.cue.display.slot == "recap_card" and c.cue.moment_id == recap.recap_id and not c.fallback for c in cards)
    assert cards[2].cue.text.headline.startswith("फ़ुल-टाइम")
    assert cards[0].cue.data.keys() == {"score.home", "score.away"}  # casual: the score, nothing else


@pytest.mark.live
async def test_openai_recap_is_grounded(stats, whistle):
    from touchline_agents.llm import make_client

    _, ft, told = whistle
    live = load_settings({"TOUCHLINE_LLM": "openai", "TOUCHLINE_TIMEOUT_SCALE": "5"})
    out = await RecapProducer(make_client(live, "large"), live).produce(stats, "full_time", ft, told)
    assert not out.fallback, out.reason
    check = await FactChecker(make_client(live, "small"), live).check(stats, out.draft("r"), latest=ft, clock=out.pack["clock"], involved=set(out.pack["names"]), attempt=0)
    print(round(out.ms), out.output.sentences, check.verdict.status, [s.reasons for s in check.verdict.sentences if s.reasons])
    assert check.verdict.claims_verified == check.verdict.claims_checked
```

Apply this change to `services/agents/tests/test_personalizer.py` (from the repository root):

```bash
git apply <<'PATCH'
diff --git a/services/agents/tests/test_personalizer.py b/services/agents/tests/test_personalizer.py
index a0b5f93..957e981 100644
--- a/services/agents/tests/test_personalizer.py
+++ b/services/agents/tests/test_personalizer.py
@@ -6,7 +6,7 @@ from touchline_agents.config import load_settings
 from touchline_agents.contracts import Draft, Segment
 from touchline_agents.detector import PRIORITY
 from touchline_agents.llm import STUB_RESPONDERS, StubChatClient
-from touchline_agents.personalizer import Personalizer, Variant, check_variant, make_cue, template_variant
+from touchline_agents.personalizer import Personalizer, Story, Variant, check_variant, make_cue, template_variant
 
 from .factories import NAMES, claim, moment
 
@@ -16,10 +16,14 @@ DRAFT = Draft(moment_id="mo-goal-3000", lang="en", sentences=["Goal for Home FC!
               claims=[c.model_copy(update={"sentence": i + 2}) for i, c in enumerate(CLAIMS[:2])] + [CLAIMS[2].model_copy(update={"sentence": 1})])
 
 
+def story(type_: str = "goal", cause: str = "low-probability chance") -> Story:
+    return Story.of_moment(moment(type_, player="h9"), cause, NAMES)
+
+
 def payload(seg: Segment, type_: str = "goal", cause: str = "low-probability chance"):
-    m = moment(type_, player="h9")
-    return {"segment": seg.model_dump(mode="json"), "moment": m.model_dump(mode="json"), "cause": cause, "names": NAMES, "draft": DRAFT.sentences,
-            "claims": [c.model_dump(mode="json") for c in DRAFT.claims]}
+    s = story(type_, cause)
+    return {"segment": seg.model_dump(mode="json"), "story": {"template": s.template, "team_id": s.team_id, "player_id": s.player_id, "clock": s.clock},
+            "headline": s.headlines[seg.lang], "names": NAMES, "draft": DRAFT.sentences, "claims": [c.model_dump(mode="json") for c in DRAFT.claims]}
 
 
 SEGMENTS = [Segment(mode=m, lang=l, club=c) for m, l, c in itertools.product(["casual", "analyst"], ["en", "es", "hi"], [None, "home-fc", "away-fc"])]
@@ -64,7 +68,7 @@ def test_cue_follows_the_contract():
     seg = Segment(mode="analyst", lang="en", club=None)
     m = moment("goal")
     v = template_variant(payload(seg))
-    cue = make_cue(m, seg, v, DRAFT.claims, ["m-e10", "m-e11"])
+    cue = make_cue(Story.of_moment(m, "low-probability chance", NAMES), seg, v, DRAFT.claims, ["m-e10", "m-e11"])
     assert cue.cue_id == f"{m.moment_id}-analyst.en.neutral" and cue.schema_ == "touchline.cue/1"
     assert cue.display.slot == "side_panel" and cue.display.ttl_ms == 12000 and cue.verified
     assert cue.data == {"shot.xg": 0.1234, "score.home": 1, "score.away": 0, "team.mom": 0.58}
@@ -72,8 +76,7 @@ def test_cue_follows_the_contract():
 
 
 async def test_fans_out_over_segments_through_the_model():
-    m = moment("goal", player="h9")
-    out = await Personalizer(StubChatClient(), SETTINGS).fan_out(m, DRAFT, "low-probability chance", NAMES, SEGMENTS[:6], [], [])
+    out = await Personalizer(StubChatClient(), SETTINGS).fan_out(story(), DRAFT, NAMES, SEGMENTS[:6], [], [])
     assert [p.cue.segment for p in out] == SEGMENTS[:6] and not any(p.fallback for p in out)
     assert len({p.cue.cue_id for p in out}) == 6
 
@@ -83,7 +86,7 @@ async def test_a_variant_that_fails_the_check_becomes_the_template():
     STUB_RESPONDERS["personalize"] = lambda p, r: {"headline": "Goal!", "body": "They had 9 shots and 0.12 xG.", "numbers": [{"claim": 0, "quote": "0.12"}]}
     try:
         seg = Segment(mode="casual", lang="en", club=None)
-        out = await Personalizer(StubChatClient(), SETTINGS).personalize(moment("goal", player="h9"), DRAFT, "low-probability chance", NAMES, seg, [], [])
+        out = await Personalizer(StubChatClient(), SETTINGS).personalize(story(), DRAFT, NAMES, seg, [], [])
     finally:
         STUB_RESPONDERS["personalize"] = original
     assert out.fallback and any('"9"' in r for r in out.reasons)
@@ -96,6 +99,6 @@ async def test_openai_writes_native_variants_that_pass_the_check(seg):
     from touchline_agents.llm import make_client
 
     live = load_settings({"TOUCHLINE_LLM": "openai", "TOUCHLINE_TIMEOUT_SCALE": "10"})
-    out = await Personalizer(make_client(live, "small"), live).personalize(moment("goal", player="h9"), DRAFT, "low-probability chance", NAMES, seg, ["Cy Outsider"], [])
+    out = await Personalizer(make_client(live, "small"), live).personalize(story(), DRAFT, NAMES, seg, ["Cy Outsider"], [])
     print(round(out.ms), out.cue.text.model_dump(), out.reasons)
     assert not out.fallback, out.reasons
PATCH
```

- [ ] **Step 2: Run them to make sure they fail**

Run: `uv run --project services/agents pytest -q services/agents/tests/test_recap.py services/agents/tests/test_personalizer.py`
Expected: two collection errors: `No module named 'touchline_agents.recap'` and `cannot import name 'Story' from 'touchline_agents.personalizer'`

- [ ] **Step 3: Generalise the Personalizer and write the Recap Producer**

Apply this change to `services/agents/touchline_agents/personalizer.py`, `services/agents/touchline_agents/templates.py` (from the repository root):

```bash
git apply <<'PATCH'
diff --git a/services/agents/touchline_agents/personalizer.py b/services/agents/touchline_agents/personalizer.py
index cbfdbfc..4bc9d10 100644
--- a/services/agents/touchline_agents/personalizer.py
+++ b/services/agents/touchline_agents/personalizer.py
@@ -1,5 +1,7 @@
 """Personalizer (spec §5.3, §5.5): reshapes a verified draft for one segment (mode, language, club) into a cue.
 
+It works on a Story: a moment, or a half-time or full-time recap (whose cues are recap cards).
+
 The model writes natively in the segment's language and may only state numbers from the verified claims, each
 pointed at by index. Code checks every variant: its numbers must be faithful re-quotes of verified claims, casual
 text carries at most one number, Hindi text is in Devanagari, names are only those of players involved. A variant
@@ -19,8 +21,11 @@ from .llm import agent_options, run_structured, stub_responder
 from .numbers import format_metric, matches, numbers_in
 from .templates import FRAMING, LABELS, NEGATIVE, headline
 
+LANGS = ("en", "es", "hi")
+
 INSTRUCTIONS = """You are the Personalizer for a live football broadcast overlay.
-INPUT has a verified English draft (sentences and numbered claims), the moment, names and one viewer segment:
+INPUT has a verified English draft (sentences and numbered claims), the story (a moment or a recap), a template
+`headline` in the segment's language, names and one viewer segment:
 mode (casual or analyst), lang (en, es or hi) and club (the team the viewer supports, or null).
 Write a `headline` (at most 8 words) and a `body` NATIVELY in the segment's language (Spanish: natural Spanish;
 Hindi: Devanagari script, Western digits), not a word-for-word translation.
@@ -33,6 +38,30 @@ Use names, never ids, and no players other than those in `names`."""
 DEVANAGARI = re.compile(r"[\u0900-\u097F]")
 MAX_NUMBERS = {"casual": 1, "analyst": 4}
 MAX_CHARS = {"casual": 160, "analyst": 320}
+@dataclass(frozen=True)
+class Story:
+    """What a cue is about: its id (the cue's moment_id), anchor, template and template headline per language."""
+
+    id: str
+    match_id: str
+    template: str
+    team_id: str | None
+    player_id: str | None
+    frame_from: int
+    frame_to: int
+    clock: str
+    priority: int
+    headlines: dict[str, str]
+    # Casual and analyst slots: moments go to the lower third and the side panel, recaps to recap cards.
+    slots: tuple[str, str] = ("lower_third", "side_panel")
+
+    @staticmethod
+    def of_moment(m: Moment, cause: str, names: dict[str, str]) -> "Story":
+        d = m.model_dump(mode="json")
+        return Story(m.moment_id, m.match_id, m.type, m.team_id, m.player_id, m.frame_from, m.frame_to, m.match_clock[:5], m.priority,
+                     {lang: headline(d, cause, names, lang) for lang in LANGS})
+
+
 class UsedNumber(BaseModel):
     model_config = ConfigDict(extra="forbid")
     claim: int
@@ -57,12 +86,12 @@ def _quote(c: Claim, lang: str) -> str | None:
 def template_variant(payload: dict) -> Variant:
     """The fallback: the template headline in the segment's language, club framing for casual viewers, and the
     claims as labelled numbers (one for casual, up to three for analyst)."""
-    seg, m, names = payload["segment"], payload["moment"], payload["names"]
+    seg, m, names = payload["segment"], payload["story"], payload["names"]
     lang = seg["lang"]
-    head = headline(m, payload["cause"], names, lang)
+    head = payload["headline"]
     parts: list[str] = []
     if seg["mode"] == "casual" and seg["club"] and seg["club"] in names and m["team_id"]:
-        good = (seg["club"] == m["team_id"]) != (m["type"] in NEGATIVE)
+        good = (seg["club"] == m["team_id"]) != (m["template"] in NEGATIVE)
         parts.append(FRAMING[lang][0 if good else 1].format(club=names[seg["club"]]))
     used: list[UsedNumber] = []
     for i, raw in enumerate(payload["claims"]):
@@ -117,7 +146,7 @@ def check_variant(v: Variant, payload: dict, others: list[str]) -> list[str]:
     return problems
 
 
-def make_cue(moment: Moment, segment: Segment, v: Variant, claims: list[Claim], evidence: list[str]) -> Cue:
+def make_cue(story: Story, segment: Segment, v: Variant, claims: list[Claim], evidence: list[str]) -> Cue:
     used = [claims[u.claim] for u in v.numbers if 0 <= u.claim < len(claims)]
     data: dict[str, float] = {}
     for c in used:
@@ -128,13 +157,13 @@ def make_cue(moment: Moment, segment: Segment, v: Variant, claims: list[Claim],
             data |= {"score.home": home, "score.away": away}
     refs = [ref for c in used for ref in ([c.event_id] if c.event_id else [f"{c.metric_id}@{c.subject}:{c.at_frame}"] if c.metric_id else [])]
     return Cue.model_validate({
-        "cue_id": f"{moment.moment_id}-{segment_key(segment)}",
+        "cue_id": f"{story.id}-{segment_key(segment)}",
         "schema": "touchline.cue/1",
-        "match_id": moment.match_id,
-        "moment_id": moment.moment_id,
-        "anchor": {"frame_from": moment.frame_from, "frame_to": moment.frame_to, "clock": moment.match_clock[:5]},
-        "display": {"slot": "lower_third" if segment.mode == "casual" else "side_panel", "priority": moment.priority,
-                    "ttl_ms": 12000 if moment.priority == 1 else 8000, "template": moment.type},
+        "match_id": story.match_id,
+        "moment_id": story.id,
+        "anchor": {"frame_from": story.frame_from, "frame_to": story.frame_to, "clock": story.clock},
+        "display": {"slot": story.slots[0] if segment.mode == "casual" else story.slots[1], "priority": story.priority,
+                    "ttl_ms": 12000 if story.priority == 1 else 8000, "template": story.template},
         "segment": segment.model_dump(mode="json"),
         "text": {"headline": v.headline, "body": v.body},
         "data": data,
@@ -157,13 +186,11 @@ class Personalizer:
         self.settings = settings
         self.agent = Agent(client=client, name="personalizer", instructions=INSTRUCTIONS, default_options=agent_options(settings))
 
-    async def personalize(
-        self, moment: Moment, draft: Draft, cause: str, names: dict[str, str], segment: Segment, others: list[str], evidence: list[str],
-    ) -> Personalized:
+    async def personalize(self, story: Story, draft: Draft, names: dict[str, str], segment: Segment, others: list[str], evidence: list[str]) -> Personalized:
         payload = {
             "segment": segment.model_dump(mode="json"),
-            "moment": moment.model_dump(mode="json", include={"moment_id", "type", "team_id", "player_id", "match_clock"}),
-            "cause": cause,
+            "story": {"template": story.template, "team_id": story.team_id, "player_id": story.player_id, "clock": story.clock},
+            "headline": story.headlines[segment.lang],
             "names": names,
             "draft": draft.sentences,
             "claims": [c.model_dump(mode="json") for c in draft.claims if _quote(c, "en") is not None],
@@ -173,8 +200,8 @@ class Personalizer:
         variant, reasons = out.value, [out.reason] if out.fallback and out.reason else []
         if not out.fallback and (problems := check_variant(variant, payload, others)):
             variant, reasons = template_variant(payload), problems
-        return Personalized(make_cue(moment, segment, variant, claims, evidence), bool(reasons), reasons, out.ms)
+        return Personalized(make_cue(story, segment, variant, claims, evidence), bool(reasons), reasons, out.ms)
 
-    async def fan_out(self, moment: Moment, draft: Draft, cause: str, names: dict[str, str], segments: list[Segment], others: list[str], evidence: list[str]) -> list[Personalized]:
+    async def fan_out(self, story: Story, draft: Draft, names: dict[str, str], segments: list[Segment], others: list[str], evidence: list[str]) -> list[Personalized]:
         """Every segment at once (generation scales with segments, not viewers)."""
-        return list(await asyncio.gather(*(self.personalize(moment, draft, cause, names, s, others, evidence) for s in segments)))
+        return list(await asyncio.gather(*(self.personalize(story, draft, names, s, others, evidence) for s in segments)))
diff --git a/services/agents/touchline_agents/templates.py b/services/agents/touchline_agents/templates.py
index c1b7bc9..6dcb77c 100644
--- a/services/agents/touchline_agents/templates.py
+++ b/services/agents/touchline_agents/templates.py
@@ -52,3 +52,10 @@ def headline(moment: dict, cause: str, names: dict[str, str], lang: str = "en")
     team = names.get(moment["team_id"] or "", "")
     player = names.get(moment["player_id"] or "", team)
     return HEADLINES[lang][headline_key(moment, cause)].format(team=team, player=player)
+
+
+RECAP_HEADLINES: dict[str, dict[str, str]] = {
+    "en": {"half_time": "Half-time: {home} v {away}", "full_time": "Full-time: {home} v {away}", "potm": "Player of the match: {player}."},
+    "es": {"half_time": "Descanso: {home} - {away}", "full_time": "Final: {home} - {away}", "potm": "Jugador del partido: {player}."},
+    "hi": {"half_time": "हाफ़-टाइम: {home} बनाम {away}", "full_time": "फ़ुल-टाइम: {home} बनाम {away}", "potm": "प्लेयर ऑफ़ द मैच: {player}।"},
+}
PATCH
```

Create `services/agents/touchline_agents/recap.py`:

```python
"""Recap Producer (spec §5.3): half-time and full-time recaps with turning points and a player of the match.

Code gathers the facts over MCP (score, possession, expected goals, pass accuracy, the top players by expected
threat added and by xG, the moments published so far); the model writes the recap from them. The fallback is a
stats-only recap. The Fact-Checker checks a recap like any draft, and the Personalizer turns it into recap cards.
"""

from dataclasses import dataclass

from agent_framework import Agent, BaseChatClient
from pydantic import BaseModel, ConfigDict

from .config import Settings
from .contracts import Claim, Draft, Moment, Recap
from .llm import agent_options, run_structured, stub_responder
from .numbers import format_metric
from .personalizer import LANGS, Story
from .stats import StatsClient, StatsError, names
from .templates import RECAP_HEADLINES

TEAM_METRICS = ["team.poss", "shot.xg", "pass.acc", "tilt"]  # all over the match so far by default
MAX_TURNING_POINTS = 3

INSTRUCTIONS = """You are the Recap Producer for a football broadcast, writing in English.
INPUT has the recap kind (half_time or full_time), the score, team metrics with their values, the top players by
expected threat added (act.xt) and by xG, and the moments published so far (id, clock, type, cause, headline).
Write `sentences`: sentence 0 a headline of at most 10 words, then two to four sentences on how the match has gone
and why. Every number you write must be a value from INPUT, declared in `claims` with `sentence` and `quote` (shares
as percentages such as "54%", the score as "home-away"; kind "metric" with metric_id, subject and value, or kind
"score"). Pick up to three `turning_points` from the moment ids, most decisive first. For full_time name a
`player_of_match` (a player id from the top players); for half_time leave it null."""


class RecapOutput(BaseModel):
    model_config = ConfigDict(extra="forbid")
    sentences: list[str]
    claims: list[Claim]
    turning_points: list[str]
    player_of_match: str | None


@dataclass(frozen=True)
class Told:
    """A published moment, as the recap sees it."""

    moment: Moment
    cause: str
    headline: str


def _claim(at: int, **kw) -> Claim:
    base = dict(kind="metric", sentence=0, quote="", metric_id=None, subject=None, value=None, at_frame=at, window_s=None, event_id=None, receiver_id=None)
    return Claim(**(base | kw))


async def recap_pack(stats: StatsClient, kind: str, at_frame: int, told: list[Told]) -> dict:
    info = await stats.match_info(at_frame)
    roster = await stats.roster()
    home, away = roster["home"]["id"], roster["away"]["id"]
    metrics = []
    for metric_id in TEAM_METRICS:
        for team in (home, away):
            try:
                m = await stats.metric(metric_id, team, at_frame)
            except StatsError:
                continue
            if m["value"] is not None:
                metrics.append({"metric_id": metric_id, "subject": team, "value": m["value"], "at_frame": at_frame})
    top = {}
    for metric_id in ("act.xt", "shot.xg"):
        ranked = await stats.call("rank_players", metric_id=metric_id, at_frame=at_frame, top=3)
        top[metric_id] = [{"player_id": p["player_id"], "value": p["value"]} for p in ranked["players"] if p.get("value") is not None]
    who = names(roster)
    involved = {home, away} | {p["player_id"] for ps in top.values() for p in ps} | {t.moment.player_id for t in told if t.moment.player_id}
    return {
        "kind": kind,
        "at_frame": at_frame,
        "clock": (info.get("latest") or {}).get("match_clock", ""),
        "score": {"home": info["score"]["home"], "away": info["score"]["away"], "home_team": home, "away_team": away},
        "metrics": metrics,
        "top_players": top,
        "moments": [{"id": t.moment.moment_id, "clock": t.moment.match_clock[:5], "type": t.moment.type, "priority": t.moment.priority,
                     "salience": round(t.moment.salience, 3), "cause": t.cause, "headline": t.headline} for t in told if t.moment.frame_id <= at_frame],
        "names": {k: v for k, v in who.items() if k in involved},
    }


def template_recap(pack: dict) -> RecapOutput:
    """The fallback: a stats-only recap (score, possession, expected goals, the player of the match)."""
    at, s, name = pack["at_frame"], pack["score"], pack["names"]
    home, away = name[s["home_team"]], name[s["away_team"]]
    score = f"{s['home']}-{s['away']}"
    lead = "lead" if s["home"] != s["away"] else "are level"
    sentences = [f"{'Half-time' if pack['kind'] == 'half_time' else 'Full-time'}: {home} {score} {away}"]
    claims = [_claim(at, kind="score", quote=score)]
    leader = home if s["home"] > s["away"] else away
    sentences.append(f"{leader} {lead} after a match decided by its key moments." if lead == "lead" else f"{home} and {away} {lead}.")
    by = {(m["metric_id"], m["subject"]): m for m in pack["metrics"]}
    for metric_id, label in (("team.poss", "Possession"), ("shot.xg", "Expected goals")):
        pair = [by.get((metric_id, s["home_team"])), by.get((metric_id, s["away_team"]))]
        if None in pair:
            continue
        quotes = [format_metric(metric_id, m["value"]) for m in pair]
        sentences.append(f"{label}: {home} {quotes[0]}, {away} {quotes[1]}.")
        claims += [_claim(at, sentence=len(sentences) - 1, quote=q, metric_id=metric_id, subject=m["subject"], value=m["value"]) for q, m in zip(quotes, pair)]
    potm = None
    if pack["kind"] == "full_time" and pack["top_players"]["act.xt"]:
        potm = pack["top_players"]["act.xt"][0]["player_id"]
        sentences.append(f"Player of the match: {name.get(potm, potm)}.")
    ranked = sorted(pack["moments"], key=lambda m: (m["priority"], -m["salience"]))
    return RecapOutput(sentences=sentences, claims=claims, turning_points=[m["id"] for m in ranked[:MAX_TURNING_POINTS]], player_of_match=potm)


@stub_responder("recap")
def _stub(payload: dict, _results: list[str]) -> dict:
    return template_recap(payload).model_dump(mode="json")


def acceptable(r: RecapOutput, pack: dict) -> bool:
    ids = {m["id"] for m in pack["moments"]}
    tops = {p["player_id"] for ps in pack["top_players"].values() for p in ps}
    return (
        1 <= len(r.sentences) <= 6 and len(r.turning_points) <= MAX_TURNING_POINTS and set(r.turning_points) <= ids
        and (r.player_of_match is None if pack["kind"] == "half_time" else r.player_of_match in tops)
        and all(c.sentence < len(r.sentences) for c in r.claims)
    )


def recap_story(recap: Recap, pack: dict) -> Story:
    """The recap as a Story for the Personalizer: recap cards anchored at the whistle, headlines without numbers."""
    s, name = pack["score"], pack["names"]
    home, away = name[s["home_team"]], name[s["away_team"]]
    return Story(recap.recap_id, recap.match_id, "recap", None, recap.player_of_match, recap.at_frame, recap.at_frame, pack["clock"][:5], 1,
                 {lang: RECAP_HEADLINES[lang][recap.kind].format(home=home, away=away) for lang in LANGS}, ("recap_card", "recap_card"))


@dataclass(frozen=True)
class Produced:
    output: RecapOutput
    pack: dict
    fallback: bool
    reason: str | None
    ms: float

    def draft(self, recap_id: str) -> Draft:
        return Draft(moment_id=recap_id, lang="en", sentences=self.output.sentences, claims=self.output.claims)


class RecapProducer:
    def __init__(self, client: BaseChatClient, settings: Settings) -> None:
        self.settings = settings
        self.agent = Agent(client=client, name="recap_producer", instructions=INSTRUCTIONS, default_options=agent_options(settings))

    async def produce(self, stats: StatsClient, kind: str, at_frame: int, told: list[Told], feedback: list[str] | None = None, pack: dict | None = None) -> Produced:
        pack = pack or await recap_pack(stats, kind, at_frame, told)
        payload = pack | ({"feedback": feedback} if feedback else {})
        out = await run_structured(
            self.agent, "recap", payload, RecapOutput, timeout_s=self.settings.timeout("recap"),
            fallback=lambda: template_recap(pack), accept=lambda r: acceptable(r, pack),
        )
        return Produced(out.value, pack, out.fallback, out.reason, out.ms)
```

- [ ] **Step 4: Run the tests**

Run: `uv run --project services/agents pytest -q services/agents/tests/test_recap.py services/agents/tests/test_personalizer.py`
Expected: 27 passed, 3 deselected

Optional, with the key in `.env.local` (one or two real `gpt-6.1-sol` calls; skipped by the default run):

Run: `uv run --project services/agents pytest -q -m live services/agents/tests/test_recap.py`
Expected: 1 passed: a four-sentence full-time recap whose every claim the Fact-Checker verifies; about 13 s

- [ ] **Step 5: Commit**

```bash
git add services/agents
git commit -m "feat(agents): Recap Producer — half-time and full-time recaps with turning points and player of the match, stats-only fallback; Personalizer generalized to stories so recaps become recap cards

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```



### Task 11: Agent Framework workflow

The agents become one Agent Framework graph (spec §5.3's flow):
- `moment_detector` → `tactical_analyst` → `narrator` → `fact_checker`.
- A multi-selection edge group routes a retry back to the narrator (at most once) and a verified draft to both personalizers. Each personalizer handles its mode's segments.
- A fan-in delivers both personalizers' outputs to the `publisher`. It groups them by moment and yields a `MomentResult`: the cues, plus a `MomentTrace` with verdicts, fallbacks, timings and the model label. It also records the moment for recaps.

**Runs.** One run takes a batch of signals, and results stream out as each moment is published.

**Checkpoints.** They go to `TOUCHLINE_CHECKPOINTS/<match>` when set. Every message type and contract model is on the allow-list; Agent Framework silently skips checkpoints holding unlisted types.

**Sessions and recaps.** `MatchSession` holds a match's agents (small tier for the live agents, large tier for the Analyst and recaps), its stats connection, detector memory and moments told. It refuses a stats server that serves another match. Recaps run as a short sequence on the same agents: produce, check (one retry), personalize into recap cards.

**Live runs found two fixes:**
- The Fact-Checker looks events up as of the moment, not as of the claim's frame. A shot struck at frame 19337 is only stamped when it resolves at 19344, and the model had cited it "as of" the strike.
- The detector's instructions now name errors that led to a shot, which the model had passed over.

**Files:**
- Create: `services/agents/touchline_agents/session.py`, `services/agents/touchline_agents/workflow.py`
- Modify: `services/agents/touchline_agents/factchecker.py` (event lookups as of the moment; `other_names` public), `services/agents/touchline_agents/detector.py` (instructions), `services/agents/tests/test_factchecker.py`
- Test: `services/agents/tests/test_workflow.py`

**Interfaces:**
- Consumes: every agent (Tasks 4, 6–10), `StatsClient`, `make_client`, `FileCheckpointStorage`, `WorkflowBuilder`, `Executor`, `handler`, `WorkflowContext`.
- Produces:
  - `session.py`: `Agents.make(settings)`, `MatchSession.open(match_id, mcp_url, segments, settings, agents=None)` (`.stats`, `.agents`, `.segments`, `.fps`, `.detector`, `.told`, `.close()`).
  - `workflow.py`: messages `Batch`, `Job`, `Narration`, `Drafted`, `Verified`, `Variants`, `MomentResult(trace, cues)`; `CHECKPOINT_TYPES`; `route(message, targets)`; `build(session) -> Workflow` (name `touchline-moments`); `run_moments(workflow, signals)` (async iterator of `MomentResult`); `RecapResult(recap, cues, verdicts, fallbacks)`; `run_recap(session, kind, at_frame)`.
  - `factchecker.py`: `other_names(roster, involved)`.

- [ ] **Step 1: Write the failing tests**

Create `services/agents/tests/test_workflow.py`:

```python
import logging

import pytest

from touchline_agents.config import load_settings
from touchline_agents.contracts import Segment, Signal
from touchline_agents.llm import STUB_RESPONDERS, StubChatClient
from touchline_agents.narrator import template_draft
from touchline_agents.numbers import numbers_in
from touchline_agents.session import Agents, MatchSession
from touchline_agents.workflow import build, run_moments, run_recap

from .conftest import MATCH_ID

SEGMENTS = [Segment(mode="casual", lang="en", club=None), Segment(mode="casual", lang="es", club="northwick"), Segment(mode="analyst", lang="hi", club=None)]


@pytest.fixture
async def signals(stats) -> list[Signal]:
    return [Signal.model_validate(s) for s in await stats.signals(limit=500)]


@pytest.fixture
async def session(stats_url, tmp_path):
    settings = load_settings({"TOUCHLINE_CHECKPOINTS": str(tmp_path / "cp")}, env_file=None)
    s = await MatchSession.open(MATCH_ID, stats_url, SEGMENTS, settings)
    yield s
    await s.close()


async def run(session, signals):
    return [r async for r in run_moments(build(session), signals)]


def with_lie(draft: dict) -> dict:
    """The draft with its explanation (sentence 1) replaced by an undeclared number."""
    return {**draft, "sentences": [draft["sentences"][0], "They have had 9 shots.", *draft["sentences"][2:]]}


async def test_a_batch_comes_out_as_verified_cues_for_every_segment(session, signals):
    batch = [s for s in signals if s.frame_id <= 20000]
    results = await run(session, batch)
    assert results and {r.trace.moment.type for r in results} >= {"goal"}
    for r in results:
        assert [c.segment for c in r.cues] == sorted(SEGMENTS, key=lambda s: s.mode)  # casual first, then analyst
        assert all(c.verified and c.moment_id == r.trace.moment.moment_id for c in r.cues)
        assert r.trace.verdicts[-1].status == "pass" and r.trace.fallbacks == [] and r.trace.model == "stub"
        assert {"detector", "analyst", "narrator", "factchecker", "personalizer_casual", "personalizer_analyst"} <= set(r.trace.timings_ms)
        casual = [c for c in r.cues if c.segment.mode == "casual"]
        assert all(len(numbers_in(f"{c.text.headline} {c.text.body}")) <= 1 for c in casual)
    assert [t.moment.moment_id for t in session.told] == [r.trace.moment.moment_id for r in results]


async def test_a_wrong_draft_is_retried_once_then_published(session, signals):
    calls = []
    original = STUB_RESPONDERS["narrate"]

    def narrate(p, r):
        calls.append(p.get("feedback"))
        d = original(p, r)
        return d if p.get("feedback") else with_lie(d)

    STUB_RESPONDERS["narrate"] = narrate
    try:
        [r] = await run(session, [next(s for s in signals if s.type == "goal")])
    finally:
        STUB_RESPONDERS["narrate"] = original
    assert [v.status for v in r.trace.verdicts] == ["retry", "pass"]
    assert calls[1] and '"9" is not declared' in calls[1][0]
    assert "narrator_retry" in r.trace.timings_ms


async def test_a_draft_still_wrong_after_the_retry_loses_the_bad_sentence(session, signals):
    original = STUB_RESPONDERS["narrate"]
    STUB_RESPONDERS["narrate"] = lambda p, r: with_lie(original(p, r))
    try:
        [r] = await run(session, [next(s for s in signals if s.type == "goal")])
    finally:
        STUB_RESPONDERS["narrate"] = original
    assert [v.status for v in r.trace.verdicts] == ["retry", "drop"]
    assert not any("9 shots" in (c.text.body + c.text.headline) for c in r.cues)
    assert r.trace.draft.sentences[1] == "They have had 9 shots."  # the trace keeps what was dropped


async def test_every_agent_failing_still_publishes_template_cues(stats_url, signals):
    settings = load_settings({}, env_file=None)
    broken = StubChatClient("error")
    agents = Agents.make(settings)
    for a in (agents.detector, agents.narrator, agents.factchecker, agents.personalizer, agents.recap):
        a.agent.client = broken
    agents.analyst.client = broken
    s = await MatchSession.open(MATCH_ID, stats_url, SEGMENTS, settings, agents)
    try:
        [r] = await run(s, [next(x for x in signals if x.type == "goal")])
    finally:
        await s.close()
    assert set(r.trace.fallbacks) == {"moment_detector", "tactical_analyst", "narrator", "personalizer"}
    assert len(r.cues) == len(SEGMENTS) and all(c.verified for c in r.cues)


async def test_checkpoints_are_written_and_load(session, signals, caplog):
    from agent_framework import FileCheckpointStorage

    from touchline_agents.workflow import CHECKPOINT_TYPES

    caplog.set_level(logging.WARNING)
    await run(session, [next(s for s in signals if s.type == "goal")])
    storage = FileCheckpointStorage(str(session.settings.checkpoint_dir / MATCH_ID), allowed_checkpoint_types=CHECKPOINT_TYPES)
    cps = await storage.list_checkpoints(workflow_name="touchline-moments")
    assert len(cps) >= 5
    for cp in cps:
        await storage.load(cp.checkpoint_id)
    assert "blocked" not in caplog.text.lower()


async def test_the_session_refuses_another_match(stats_url):
    with pytest.raises(ValueError, match="serves agents-test"):
        await MatchSession.open("some-other-match", stats_url, SEGMENTS, load_settings({}, env_file=None))


async def test_recaps_tell_the_moments_so_far(session, signals, stats):
    await run(session, [s for s in signals if s.frame_id <= 30000])
    ht = (await stats.events(0, 10**7, types=["period_end"]))[0]["frame_id"]
    r = await run_recap(session, "half_time", ht)
    assert r.recap.verified and r.recap.recap_id == f"{MATCH_ID}-recap-half_time"
    assert set(r.recap.turning_points) <= {t.moment.moment_id for t in session.told}
    assert [c.display.slot for c in r.cues] == ["recap_card"] * len(SEGMENTS)
    assert [v.status for v in r.verdicts] == ["pass"]


def test_template_draft_is_used_by_the_stub():
    assert STUB_RESPONDERS["narrate"].__module__ == template_draft.__module__


@pytest.mark.live
async def test_openai_runs_a_goal_through_the_graph(stats_url, signals):
    live = load_settings({"TOUCHLINE_LLM": "openai", "TOUCHLINE_TIMEOUT_SCALE": "6"})
    s = await MatchSession.open(MATCH_ID, stats_url, SEGMENTS, live)
    try:
        [r] = await run(s, [next(x for x in signals if x.type == "goal")])
    finally:
        await s.close()
    print({k: round(v) for k, v in r.trace.timings_ms.items()}, r.trace.fallbacks, [v.status for v in r.trace.verdicts])
    print(r.trace.analysis.cause, "|", r.trace.draft.sentences)
    print([c.model_dump(include={"kind", "quote", "metric_id", "value", "event_id"}) for c in r.trace.analysis.claims])
    print([(s.index, s.reasons) for v in r.trace.verdicts for s in v.sentences if s.reasons])
    for c in r.cues:
        print(c.segment.mode, c.segment.lang, "|", c.text.headline, "|", c.text.body)
    assert all(c.verified for c in r.cues) and r.trace.model == "openai:gpt-6.1-sol"
```

Apply this change to `services/agents/tests/test_factchecker.py` (from the repository root):

```bash
git apply <<'PATCH'
diff --git a/services/agents/tests/test_factchecker.py b/services/agents/tests/test_factchecker.py
index 806f1ea..9446040 100644
--- a/services/agents/tests/test_factchecker.py
+++ b/services/agents/tests/test_factchecker.py
@@ -112,3 +112,13 @@ async def test_the_model_extracts_undeclared_numbers(stats, case):
         STUB_RESPONDERS["extract"] = original
     assert r.verdict.status == "pass", failing(r)
     assert len(r.extracted) == 1 and r.draft.claims[-1].sentence == len(bare.sentences) - 1
+
+
+async def test_an_event_claim_stamped_at_the_strike_is_found_as_of_the_moment(stats, case):
+    # A shot is stamped when it resolves (the goal frame), after the frame it was struck at; a claim about it made
+    # "as of" the strike is still about an event inside the moment.
+    m, _, d = case
+    xg = next(c for c in d.claims if c.metric_id == "shot.xg")
+    early = d.model_copy(update={"claims": [c.model_copy(update={"at_frame": m.frame_from}) if c is xg else c for c in d.claims]})
+    r = await check(stats, case, early)
+    assert r.verdict.status == "pass", failing(r)
PATCH
```

- [ ] **Step 2: Run them to make sure they fail**

Run: `uv run --project services/agents pytest -q services/agents/tests/test_workflow.py services/agents/tests/test_factchecker.py`
Expected: a collection error: `No module named 'touchline_agents.session'`

- [ ] **Step 3: Fix the event lookups and the detector's instructions**

Apply this change to `services/agents/touchline_agents/factchecker.py`, `services/agents/touchline_agents/detector.py` (from the repository root):

```bash
git apply <<'PATCH'
diff --git a/services/agents/touchline_agents/detector.py b/services/agents/touchline_agents/detector.py
index 7d35900..ecd123f 100644
--- a/services/agents/touchline_agents/detector.py
+++ b/services/agents/touchline_agents/detector.py
@@ -32,8 +32,8 @@ MERGE_S = 10.0  # signals of the same team this close to a promoted one belong t
 INSTRUCTIONS = """You are the Moment Detector for a live football broadcast overlay.
 INPUT lists candidate signals from the stats engine (id, type, team, player, clock, salience 0..1, value, data), the
 moments already shown recently, and `max`, the most you may promote. Promote only what a viewer would want a caption
-for now: decisive or unusual events, clear shifts in pressure or momentum. Prefer variety over repeating what was just
-shown. Ids in `must` are always promoted; list them too. Answer with the ids to promote, most important first."""
+for now: decisive or unusual events (an error that led to a shot, a big chance), clear shifts in pressure or momentum.
+Prefer variety over repeating what was just shown. Ids in `must` are always promoted; list them too. Answer with the ids to promote, most important first."""
 
 
 class Selection(BaseModel):
diff --git a/services/agents/touchline_agents/factchecker.py b/services/agents/touchline_agents/factchecker.py
index f2f7adc..3523e84 100644
--- a/services/agents/touchline_agents/factchecker.py
+++ b/services/agents/touchline_agents/factchecker.py
@@ -72,9 +72,10 @@ class FactChecker:
                 if c.metric_id is None or c.value is None:
                     return "a metric claim needs metric_id and value"
                 if c.event_id is not None:
-                    found = await stats.call("get_events", ids=[c.event_id], to_frame=c.at_frame)
+                    # Events are looked up as of the moment: one struck before `at_frame` may be stamped when it resolves.
+                    found = await stats.call("get_events", ids=[c.event_id], to_frame=latest)
                     if not found["events"]:
-                        return f"no event {c.event_id} by frame {c.at_frame}"
+                        return f"no event {c.event_id} by frame {latest}"
                     actual = found["events"][0]["values"].get(c.metric_id)
                     if actual is None or abs(actual - c.value) > tolerance(actual):
                         return f"{c.metric_id} of {c.event_id} is {actual}, not {c.value}"
@@ -96,15 +97,15 @@ class FactChecker:
                 if c.value is None or not (minute <= c.value <= minute + 1):
                     return f"the moment is in minute {minute + 1}, not {c.value}"
             elif c.kind == "event":
-                found = await stats.call("get_events", ids=[c.event_id], to_frame=c.at_frame) if c.event_id else {"events": []}
+                found = await stats.call("get_events", ids=[c.event_id], to_frame=latest) if c.event_id else {"events": []}
                 if not found["events"]:
-                    return f"no event {c.event_id} by frame {c.at_frame}"
+                    return f"no event {c.event_id} by frame {latest}"
                 if c.subject and c.subject.startswith("p-") and found["events"][0]["player_id"] != c.subject:
                     return f"event {c.event_id} was by {found['events'][0]['player_id']}, not {c.subject}"
             elif c.kind == "better_option":
                 if not c.event_id or not c.receiver_id:
                     return "a better option needs event_id and receiver_id"
-                d = await stats.decision(c.event_id, c.at_frame)
+                d = await stats.decision(c.event_id, latest)
                 if d["chosen_rank"] in (None, 1):
                     return f"the pass at {c.event_id} was already the best option"
                 if d["best_receiver_id"] != c.receiver_id:
@@ -121,7 +122,7 @@ class FactChecker:
         retry, a later attempt drops what fails. `extract=False` skips the model (variants are checked by code only)."""
         t0 = time.perf_counter()
         roster = await stats.roster()
-        others = _other_names(roster, involved)
+        others = other_names(roster, involved)
         claims = list(draft.claims)
         extracted: list[Claim] = []
         fallback = False
@@ -177,7 +178,7 @@ def _undeclared(sentence: str, claims: list[Claim]) -> list[str]:
     return [t for t in numbers_in(sentence) if not any(t in c.quote for c in claims if c.quote)]
 
 
-def _other_names(roster: dict, involved: set[str]) -> list[str]:
+def other_names(roster: dict, involved: set[str]) -> list[str]:
     """Full names and surnames of rostered players who are not involved (surnames shared with an involved player are
     left out: the text may mean the involved one)."""
     players = [p for side in ("home", "away") for p in roster[side]["players"]]
PATCH
```

- [ ] **Step 4: Write the session and the workflow**

Create `services/agents/touchline_agents/session.py`:

```python
"""One match's agents and state: the six agents, the stats connection, the detector's memory, the moments told."""

from dataclasses import dataclass, field

from .analyst import Analyst
from .config import Settings
from .contracts import Segment
from .detector import DetectorState, MomentDetector
from .factchecker import FactChecker
from .llm import make_client
from .narrator import Narrator
from .personalizer import Personalizer
from .recap import RecapProducer, Told
from .stats import StatsClient


@dataclass
class Agents:
    detector: MomentDetector
    analyst: Analyst
    narrator: Narrator
    factchecker: FactChecker
    personalizer: Personalizer
    recap: RecapProducer

    @staticmethod
    def make(settings: Settings) -> "Agents":
        """Small-tier models for the live agents, the large tier for the Analyst and recaps (spec §5.3)."""
        small, large = make_client(settings, "small"), make_client(settings, "large")
        return Agents(
            MomentDetector(small, settings), Analyst(large, settings), Narrator(small, settings),
            FactChecker(small, settings), Personalizer(small, settings), RecapProducer(large, settings),
        )


@dataclass
class MatchSession:
    match_id: str
    settings: Settings
    stats: StatsClient
    agents: Agents
    segments: list[Segment]
    fps: float
    detector: DetectorState
    told: list[Told] = field(default_factory=list)

    @staticmethod
    async def open(match_id: str, mcp_url: str, segments: list[Segment], settings: Settings, agents: Agents | None = None) -> "MatchSession":
        """Connect to the match's stats server (only on an allowed host) and set up its agents."""
        stats = StatsClient(mcp_url, settings.mcp_allowed_hosts)
        await stats.__aenter__()
        info = await stats.roster()
        if info["match_id"] != match_id:
            await stats.__aexit__(None, None, None)
            raise ValueError(f"the stats server at {mcp_url} serves {info['match_id']}, not {match_id}")
        fps = info["fps"]
        return MatchSession(match_id, settings, stats, agents or Agents.make(settings), list(segments), fps, DetectorState(fps=fps))

    async def close(self) -> None:
        await self.stats.__aexit__(None, None, None)
```

Create `services/agents/touchline_agents/workflow.py`:

```python
"""The agent workflow (spec §5.3) as a Microsoft Agent Framework graph:

    moment_detector -> tactical_analyst -> narrator -> fact_checker --(retry, at most once)--> narrator
                                                                  \\--> personalizer_casual  --\\
                                                                   \\-> personalizer_analyst --> publisher

One run takes a batch of new signals; every promoted moment flows through the graph and comes out of the publisher
as a MomentResult (its verified cues and its trace). Checkpoints go to `TOUCHLINE_CHECKPOINTS/<match>` when set.
Recaps are a short sequence on the same agents (`run_recap`).
"""

import time
from collections.abc import AsyncIterator
from dataclasses import dataclass, field

from agent_framework import Executor, FileCheckpointStorage, Workflow, WorkflowBuilder, WorkflowContext, handler
from pydantic import BaseModel
from typing_extensions import Never

from . import contracts_gen
from .contracts import Analysis, Cue, Draft, Moment, MomentTrace, Recap, Signal, Verdict
from .factchecker import feedback, other_names, published
from .personalizer import Story
from .recap import Told, recap_story
from .session import MatchSession
from .templates import headline


@dataclass
class Batch:
    signals: list[Signal]


@dataclass
class Job:
    moment: Moment
    signals: list[Signal]
    timings: dict[str, float] = field(default_factory=dict)
    fallbacks: list[str] = field(default_factory=list)


@dataclass
class Narration:
    job: Job
    analysis: Analysis
    pack: dict
    attempt: int = 0
    feedback: list[str] = field(default_factory=list)
    verdicts: list[Verdict] = field(default_factory=list)


@dataclass
class Drafted:
    narration: Narration
    draft: Draft


@dataclass
class Verified:
    narration: Narration
    draft: Draft  # the last draft narrated (with any extracted claims)
    published: Draft  # what survives the Fact-Checker


@dataclass
class Variants:
    verified: Verified
    mode: str
    cues: list[Cue]
    fallback: bool
    ms: float


@dataclass
class MomentResult:
    trace: MomentTrace
    cues: list[Cue]


MESSAGES = [Batch, Job, Narration, Drafted, Verified, Variants, MomentResult]
# Every type a checkpoint may hold must be allowed by name, or the checkpoint is skipped (Agent Framework allow-list).
CHECKPOINT_TYPES = [f"{t.__module__}:{t.__qualname__}" for t in MESSAGES] + [
    f"{t.__module__}:{t.__qualname__}" for t in vars(contracts_gen).values() if isinstance(t, type) and issubclass(t, BaseModel) and t is not BaseModel
]


def _ms(t0: float) -> float:
    return (time.perf_counter() - t0) * 1000


class Detect(Executor):
    def __init__(self, s: MatchSession) -> None:
        super().__init__(id="moment_detector")
        self.s = s

    @handler
    async def run(self, batch: Batch, ctx: WorkflowContext[Job]) -> None:
        out = await self.s.agents.detector.detect(batch.signals, self.s.detector)
        for m in out.moments:
            await ctx.send_message(Job(m, batch.signals, {"detector": out.ms}, ["moment_detector"] if out.fallback else []))


class Analyze(Executor):
    def __init__(self, s: MatchSession) -> None:
        super().__init__(id="tactical_analyst")
        self.s = s

    @handler
    async def run(self, job: Job, ctx: WorkflowContext[Narration]) -> None:
        out = await self.s.agents.analyst.analyze(self.s.stats, job.moment, job.signals)
        job.timings["analyst"] = out.ms
        if out.fallback:
            job.fallbacks.append("tactical_analyst")
        await ctx.send_message(Narration(job, out.analysis, out.pack))


class Narrate(Executor):
    def __init__(self, s: MatchSession) -> None:
        super().__init__(id="narrator")
        self.s = s

    @handler
    async def run(self, n: Narration, ctx: WorkflowContext[Drafted]) -> None:
        out = await self.s.agents.narrator.narrate(n.job.moment, n.analysis, n.pack["names"], n.feedback or None)
        n.job.timings[f"narrator{'_retry' if n.attempt else ''}"] = out.ms
        if out.fallback:
            n.job.fallbacks.append("narrator")
        await ctx.send_message(Drafted(n, out.draft))


class FactCheck(Executor):
    def __init__(self, s: MatchSession) -> None:
        super().__init__(id="fact_checker")
        self.s = s

    @handler
    async def run(self, d: Drafted, ctx: WorkflowContext[Narration | Verified]) -> None:
        n, m = d.narration, d.narration.job.moment
        out = await self.s.agents.factchecker.check(
            self.s.stats, d.draft, latest=m.frame_to, clock=m.match_clock, involved=set(n.pack["names"]), attempt=n.attempt,
        )
        n.job.timings[f"factchecker{'_retry' if n.attempt else ''}"] = out.ms
        verdicts = [*n.verdicts, out.verdict]
        if out.verdict.status == "retry":
            await ctx.send_message(Narration(n.job, n.analysis, n.pack, n.attempt + 1, feedback(out.verdict), verdicts))
            return
        head = headline(m.model_dump(mode="json"), n.analysis.cause, n.pack["names"])
        n = Narration(n.job, n.analysis, n.pack, n.attempt, n.feedback, verdicts)
        await ctx.send_message(Verified(n, out.draft, published(out.draft, out.verdict, head)))


def route(message: object, targets: list[str]) -> list[str]:
    """The fact-checker's edges: a retry goes back to the narrator, a verified draft to both personalizers."""
    if isinstance(message, Narration):
        return ["narrator"]
    return [t for t in targets if t.startswith("personalizer_")]


class Personalize(Executor):
    def __init__(self, s: MatchSession, mode: str) -> None:
        super().__init__(id=f"personalizer_{mode}")
        self.s, self.mode = s, mode

    @handler
    async def run(self, v: Verified, ctx: WorkflowContext[Variants]) -> None:
        t0 = time.perf_counter()
        n = v.narration
        segments = [s for s in self.s.segments if s.mode == self.mode]
        names = n.pack["names"]
        others = other_names(await self.s.stats.roster(), set(names))
        story = Story.of_moment(n.job.moment, n.analysis.cause, names)
        evidence = list(dict.fromkeys(e for s in n.job.signals if s.id in n.job.moment.signal_ids for e in s.evidence))
        out = await self.s.agents.personalizer.fan_out(story, v.published, names, segments, others, evidence) if segments else []
        await ctx.send_message(Variants(v, self.mode, [p.cue for p in out], any(p.fallback for p in out), _ms(t0)))


class Publish(Executor):
    """Fan-in: once both personalizers have answered for a moment, emit its cues and trace."""

    def __init__(self, s: MatchSession) -> None:
        super().__init__(id="publisher")
        self.s = s
        self.pending: dict[str, list[Variants]] = {}

    @handler
    async def run(self, parts: list[Variants], ctx: WorkflowContext[Never, MomentResult]) -> None:
        for p in parts:
            got = self.pending.setdefault(p.verified.narration.job.moment.moment_id, [])
            got.append(p)
            if len(got) < 2:
                continue
            del self.pending[p.verified.narration.job.moment.moment_id]
            n = p.verified.narration
            job = n.job
            for g in got:
                job.timings[f"personalizer_{g.mode}"] = g.ms
                if g.fallback and "personalizer" not in job.fallbacks:
                    job.fallbacks.append("personalizer")
            cues = [c for g in sorted(got, key=lambda g: g.mode) for c in g.cues]
            trace = MomentTrace(
                moment=job.moment, analysis=n.analysis, draft=p.verified.draft, verdicts=n.verdicts, fallbacks=job.fallbacks,
                cue_ids=[c.cue_id for c in cues], timings_ms=job.timings, model=self.s.settings.model_label,
            )
            self.s.told.append(Told(job.moment, n.analysis.cause, p.verified.published.sentences[0]))
            await ctx.yield_output(MomentResult(trace, cues))


def build(session: MatchSession) -> Workflow:
    detect, analyze, narrate, check = Detect(session), Analyze(session), Narrate(session), FactCheck(session)
    casual, analyst, publish = Personalize(session, "casual"), Personalize(session, "analyst"), Publish(session)
    storage = None
    if session.settings.checkpoint_dir is not None:
        storage = FileCheckpointStorage(str(session.settings.checkpoint_dir / session.match_id), allowed_checkpoint_types=CHECKPOINT_TYPES)
    return (
        WorkflowBuilder(name="touchline-moments", start_executor=detect, checkpoint_storage=storage, output_from=[publish])
        .add_edge(detect, analyze)
        .add_edge(analyze, narrate)
        .add_edge(narrate, check)
        .add_multi_selection_edge_group(check, [narrate, casual, analyst], route)
        .add_fan_in_edges([casual, analyst], publish)
        .build()
    )


async def run_moments(workflow: Workflow, signals: list[Signal]) -> AsyncIterator[MomentResult]:
    """Run one batch, yielding each moment's result as soon as it is published."""
    async for event in workflow.run(Batch(signals), stream=True):
        if event.type == "output" and isinstance(event.data, MomentResult):
            yield event.data


@dataclass
class RecapResult:
    recap: Recap
    cues: list[Cue]
    verdicts: list[Verdict]
    fallbacks: list[str]


async def run_recap(s: MatchSession, kind: str, at_frame: int) -> RecapResult:
    """Recap Producer -> Fact-Checker (one retry) -> Personalizer fan-out to recap cards."""
    a = s.agents
    recap_id = f"{s.match_id}-recap-{kind}"
    made = await a.recap.produce(s.stats, kind, at_frame, s.told)
    fallbacks = ["recap_producer"] if made.fallback else []
    involved = set(made.pack["names"])
    check = await a.factchecker.check(s.stats, made.draft(recap_id), latest=at_frame, clock=made.pack["clock"], involved=involved, attempt=0)
    verdicts = [check.verdict]
    if check.verdict.status == "retry":
        made = await a.recap.produce(s.stats, kind, at_frame, s.told, feedback=feedback(check.verdict), pack=made.pack)
        check = await a.factchecker.check(s.stats, made.draft(recap_id), latest=at_frame, clock=made.pack["clock"], involved=involved, attempt=1)
        verdicts.append(check.verdict)
    story_head = made.output.sentences[0] if check.verdict.sentences[0].verified else f"{'Half-time' if kind == 'half_time' else 'Full-time'}"
    final = published(check.draft, check.verdict, story_head)
    recap = Recap(recap_id=recap_id, match_id=s.match_id, kind=kind, at_frame=at_frame, sentences=final.sentences, claims=final.claims,
                  turning_points=made.output.turning_points, player_of_match=made.output.player_of_match, verified=True)
    others = other_names(await s.stats.roster(), involved)
    cards = await a.personalizer.fan_out(recap_story(recap, made.pack), final, made.pack["names"], s.segments, others, [])
    if any(c.fallback for c in cards):
        fallbacks.append("personalizer")
    return RecapResult(recap, [c.cue for c in cards], verdicts, fallbacks)
```

- [ ] **Step 5: Run the tests**

Run: `uv run --project services/agents pytest -q services/agents/tests/test_workflow.py services/agents/tests/test_factchecker.py`
Expected: 14 passed, 1 deselected: verified cues for every segment, a retry then a pass, a retry then a drop that removes the bad sentence, template cues when every agent fails, checkpoints written and loadable with no "blocked" warning, half-time recap cards

Optional, with the key in `.env.local` (one or two real `gpt-6.1-sol` calls; skipped by the default run):

Run: `uv run --project services/agents pytest -q -m live services/agents/tests/test_workflow.py -s`
Expected: 1 passed: a goal through the whole graph, `fact_check` pass on the first draft, every cue verified, the Hindi analyst cue quoting the verified xG; timings about detector 3 s, analyst 9 s, narrator 5 s, personalizers 5–7 s

- [ ] **Step 6: Commit**

```bash
git add services/agents
git commit -m "feat(agents): Agent Framework workflow — detector, analyst, narrator, fact-checker with one retry edge, personalizer fan-out by mode, publisher fan-in; checkpoints with an allow-list; recaps on the same agents

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```



### Task 12: A2A server

The agent service speaks A2A v1.0 (spec §4.1: "submit a moment task, stream back cue artifacts"):
- **Requests.** Each message carries one `AgentRequest` as a JSON data part.
- **A signals request** runs the moment workflow and streams one artifact per verified cue (`cue`) and one per moment (`trace`).
- **A recap request** streams the recap (`recap`) and its recap cards (`cue`).
- **The agent card** advertises `supportedInterfaces` (JSON-RPC, protocol 1.0) and two skills.

**Sessions.** They are per match, and one match's requests run one at a time, in order. A new MCP URL for a match reopens its session.

**Failures** fail the task with a reason, and the service keeps serving:
- a message without exactly one data part;
- a body that breaks the contract (including more than 12 segments);
- an MCP host that is not allowed;
- an error inside the workflow.

Cues now come out in the order the segments were asked for. Uvicorn serves the app, and the console script is `touchline-agents`.

**Files:**
- Create: `services/agents/touchline_agents/server.py`
- Modify: `services/agents/touchline_agents/workflow.py` (cue order), `services/agents/tests/test_workflow.py`
- Test: `services/agents/tests/test_server.py`

**Interfaces:**
- Consumes: `MatchSession`, `build`, `run_moments`, `run_recap` (Task 11), `parse_request`, `dump`, `StatsError`; a2a-sdk `AgentExecutor`, `TaskUpdater`, `DefaultRequestHandler`, `InMemoryTaskStore`, `create_agent_card_routes`, `create_jsonrpc_routes`, `get_data_parts`, `new_data_part`.
- Produces: `agent_card(url)`, `Sessions(settings, agents=None)` (`.get(req)`, `.close()`), `TouchlineExecutor`, `create_app(url, settings=None, agents=None) -> Starlette`, `main()` (`touchline-agents --host 127.0.0.1 --port 8100`); artifact names `cue`, `trace`, `recap` with `application/json` data parts; artifact ids `<cue id>`, `<moment id>-trace`, `<recap id>`.

- [ ] **Step 1: Write the failing tests**

Create `services/agents/tests/test_server.py`:

```python
import asyncio
import socket
import uuid

import httpx
import pytest
import uvicorn
from a2a.client import A2ACardResolver, ClientConfig, ClientFactory
from a2a.helpers import get_data_parts, new_data_part, new_text_part
from a2a.types import Message, Role, SendMessageRequest, TaskState

from touchline_agents.config import load_settings
from touchline_agents.contracts import Cue, MomentTrace, Recap

from .conftest import MATCH_ID

SEGMENTS = [{"mode": "casual", "lang": "en", "club": None}, {"mode": "analyst", "lang": "es", "club": None}]


@pytest.fixture(scope="module")
async def server():
    from touchline_agents.server import create_app

    with socket.socket() as sock:
        sock.bind(("127.0.0.1", 0))
        port = sock.getsockname()[1]
    url = f"http://127.0.0.1:{port}/"
    srv = uvicorn.Server(uvicorn.Config(create_app(url, load_settings({}, env_file=None)), host="127.0.0.1", port=port, log_level="warning"))
    task = asyncio.create_task(srv.serve())
    while not srv.started:
        await asyncio.sleep(0.05)
    yield url
    srv.should_exit = True
    await task


async def send(url: str, parts) -> tuple[TaskState, dict[str, list[dict]], str]:
    """Send one message, stream the task; return its final state, artifacts by name and the last status text."""
    async with httpx.AsyncClient(timeout=120) as http:
        card = await A2ACardResolver(http, url).get_agent_card()
        client = ClientFactory(ClientConfig(httpx_client=http, streaming=True)).create(card)
        msg = Message(role=Role.ROLE_USER, parts=parts, message_id=str(uuid.uuid4()))
        state, arts, text = None, {}, ""
        async for item in client.send_message(SendMessageRequest(message=msg)):
            kind = item.WhichOneof("payload")
            if kind == "status_update":
                state = item.status_update.status.state
                text = " ".join(p.text for p in item.status_update.status.message.parts if p.text)
            elif kind == "task":
                state = item.task.status.state
            elif kind == "artifact_update":
                a = item.artifact_update.artifact
                arts.setdefault(a.name, []).extend(get_data_parts(a.parts))
        return state, arts, text


async def test_serves_its_agent_card(server):
    async with httpx.AsyncClient() as http:
        card = (await http.get(f"{server}.well-known/agent-card.json")).json()
    assert card["name"] == "touchline-agents" and card["capabilities"]["streaming"]
    assert card["supportedInterfaces"][0] == {"url": server, "protocolBinding": "JSONRPC", "protocolVersion": "1.0"}
    assert {s["id"] for s in card["skills"]} == {"moments", "recap"}


async def test_signals_stream_back_as_cues_and_traces(server, stats_url, stats):
    signals = [s for s in await stats.signals(limit=500) if s["type"] == "goal"][:1]
    req = {"kind": "signals", "match_id": MATCH_ID, "mcp_url": stats_url, "segments": SEGMENTS, "now_frame": signals[0]["frame_id"], "signals": signals}
    state, arts, _ = await send(server, [new_data_part(req, "application/json")])
    assert state == TaskState.TASK_STATE_COMPLETED
    cues = [Cue.model_validate(c) for c in arts["cue"]]
    [trace] = [MomentTrace.model_validate(t) for t in arts["trace"]]
    assert [c.segment.lang for c in cues] == ["en", "es"] and all(c.verified for c in cues)
    assert trace.cue_ids == [c.cue_id for c in cues]


async def test_recaps_stream_back_with_their_cards(server, stats_url, stats):
    ht = (await stats.events(0, 10**7, types=["period_end"]))[0]["frame_id"]
    req = {"kind": "recap", "match_id": MATCH_ID, "mcp_url": stats_url, "segments": SEGMENTS, "recap": "half_time", "at_frame": ht}
    state, arts, _ = await send(server, [new_data_part(req, "application/json")])
    assert state == TaskState.TASK_STATE_COMPLETED
    assert Recap.model_validate(arts["recap"][0]).kind == "half_time"
    assert [Cue.model_validate(c).display.slot for c in arts["cue"]] == ["recap_card", "recap_card"]


@pytest.mark.parametrize(("parts", "why"), [
    ([new_text_part("hello")], "expected one JSON data part"),
    ([new_data_part({"kind": "chat", "match_id": MATCH_ID})], "bad request"),
    ([new_data_part({"kind": "recap", "match_id": MATCH_ID, "mcp_url": "http://169.254.169.254/latest", "segments": SEGMENTS, "recap": "half_time", "at_frame": 1})], "not allowed"),
    ([new_data_part({"kind": "recap", "match_id": MATCH_ID, "mcp_url": "http://127.0.0.1:1/mcp", "segments": SEGMENTS * 7, "recap": "half_time", "at_frame": 1})], "at most 12"),
])
async def test_bad_requests_fail_with_a_reason(server, parts, why):
    state, arts, text = await send(server, parts)
    assert state == TaskState.TASK_STATE_FAILED and arts == {}
    assert why in text, text
```

Apply this change to `services/agents/tests/test_workflow.py` (from the repository root):

```bash
git apply <<'PATCH'
diff --git a/services/agents/tests/test_workflow.py b/services/agents/tests/test_workflow.py
index 208b8eb..bbfa642 100644
--- a/services/agents/tests/test_workflow.py
+++ b/services/agents/tests/test_workflow.py
@@ -42,7 +42,7 @@ async def test_a_batch_comes_out_as_verified_cues_for_every_segment(session, sig
     results = await run(session, batch)
     assert results and {r.trace.moment.type for r in results} >= {"goal"}
     for r in results:
-        assert [c.segment for c in r.cues] == sorted(SEGMENTS, key=lambda s: s.mode)  # casual first, then analyst
+        assert [c.segment for c in r.cues] == SEGMENTS  # in the order the segments were asked for
         assert all(c.verified and c.moment_id == r.trace.moment.moment_id for c in r.cues)
         assert r.trace.verdicts[-1].status == "pass" and r.trace.fallbacks == [] and r.trace.model == "stub"
         assert {"detector", "analyst", "narrator", "factchecker", "personalizer_casual", "personalizer_analyst"} <= set(r.trace.timings_ms)
PATCH
```

- [ ] **Step 2: Run them to make sure they fail**

Run: `uv run --project services/agents pytest -q services/agents/tests/test_server.py services/agents/tests/test_workflow.py`
Expected: 7 errors (`No module named 'touchline_agents.server'`) and 1 failed: `test_a_batch_comes_out_as_verified_cues_for_every_segment` (the analyst cue comes first, not in the order asked for)

- [ ] **Step 3: Write the server and keep the requested segment order**

Create `services/agents/touchline_agents/server.py`:

```python
"""The agent service over A2A v1.0 (spec §4.1: "API -> agents: submit a moment task, stream back cue artifacts").

Each message carries one AgentRequest as a JSON data part. A signals request runs the moment workflow and streams
an artifact per verified cue ("cue") and per moment ("trace"); a recap request streams the recap ("recap") and its
recap cards ("cue"). Sessions are per match; requests for one match run one at a time, in order.
"""

import argparse
import asyncio
import logging
from contextlib import asynccontextmanager

import uvicorn
from a2a.helpers import get_data_parts, new_data_part, new_task_from_user_message, new_text_message
from a2a.server.agent_execution import AgentExecutor, RequestContext
from a2a.server.events import EventQueue
from a2a.server.request_handlers import DefaultRequestHandler
from a2a.server.routes import create_agent_card_routes, create_jsonrpc_routes
from a2a.server.tasks import InMemoryTaskStore, TaskUpdater
from a2a.types import AgentCapabilities, AgentCard, AgentInterface, AgentSkill
from pydantic import ValidationError
from starlette.applications import Starlette

from .config import Settings, load_settings
from .contracts import RecapRequest, SignalsRequest, dump, parse_request
from .session import Agents, MatchSession
from .stats import StatsError
from .workflow import build, run_moments, run_recap

log = logging.getLogger("touchline.agents")
JSON = "application/json"


def agent_card(url: str) -> AgentCard:
    return AgentCard(
        name="touchline-agents",
        description="Touchline's six-agent commentary workflow: moments, explanations, fact-checked cues per viewer segment, recaps.",
        version="0.1.0",
        default_input_modes=[JSON],
        default_output_modes=[JSON],
        capabilities=AgentCapabilities(streaming=True),
        supported_interfaces=[AgentInterface(url=url, protocol_binding="JSONRPC", protocol_version="1.0")],
        skills=[
            AgentSkill(id="moments", name="Moments to cues", description="New stats signals in; verified, personalized cues and moment traces out.",
                       tags=["football", "commentary"], examples=['{"kind": "signals", ...}']),
            AgentSkill(id="recap", name="Recap", description="A fact-checked half-time or full-time recap and its recap cards.",
                       tags=["football", "recap"], examples=['{"kind": "recap", "recap": "half_time", ...}']),
        ],
    )


class Sessions:
    """Match sessions by match id, each with its workflow and a lock so its requests run in order."""

    def __init__(self, settings: Settings, agents: Agents | None = None) -> None:
        self.settings = settings
        self.agents = agents
        self._open: dict[str, tuple[MatchSession, object, asyncio.Lock]] = {}
        self._guard = asyncio.Lock()

    async def get(self, req: SignalsRequest | RecapRequest) -> tuple[MatchSession, object, asyncio.Lock]:
        async with self._guard:
            entry = self._open.get(req.match_id)
            if entry is None or entry[0].stats.url != req.mcp_url:
                if entry is not None:
                    await entry[0].close()
                s = await MatchSession.open(req.match_id, req.mcp_url, list(req.segments), self.settings, self.agents)
                entry = (s, build(s), asyncio.Lock())
                self._open[req.match_id] = entry
            entry[0].segments = list(req.segments)
            return entry

    async def close(self) -> None:
        for s, _, _ in self._open.values():
            await s.close()
        self._open.clear()


class TouchlineExecutor(AgentExecutor):
    def __init__(self, sessions: Sessions) -> None:
        self.sessions = sessions

    async def execute(self, context: RequestContext, event_queue: EventQueue) -> None:
        task = context.current_task or new_task_from_user_message(context.message)
        if context.current_task is None:
            await event_queue.enqueue_event(task)
        up = TaskUpdater(event_queue, task.id, task.context_id)
        data = get_data_parts(context.message.parts) if context.message else []
        try:
            if len(data) != 1:
                raise ValueError(f"expected one JSON data part, got {len(data)}")
            req = parse_request(data[0])
            session, workflow, lock = await self.sessions.get(req)
        except (ValueError, ValidationError, StatsError) as e:
            await up.failed(new_text_message(f"bad request: {e}", context_id=task.context_id, task_id=task.id))
            return
        await up.start_work(new_text_message(f"{req.kind} for {req.match_id}", context_id=task.context_id, task_id=task.id))
        try:
            async with lock:
                if isinstance(req, SignalsRequest):
                    async for result in run_moments(workflow, list(req.signals)):
                        for cue in result.cues:
                            await up.add_artifact([new_data_part(dump(cue), JSON)], artifact_id=cue.cue_id, name="cue", last_chunk=True)
                        trace = result.trace
                        await up.add_artifact([new_data_part(dump(trace), JSON)], artifact_id=f"{trace.moment.moment_id}-trace", name="trace", last_chunk=True)
                else:
                    r = await run_recap(session, req.recap, req.at_frame)
                    await up.add_artifact([new_data_part(dump(r.recap), JSON)], artifact_id=r.recap.recap_id, name="recap", last_chunk=True)
                    for cue in r.cues:
                        await up.add_artifact([new_data_part(dump(cue), JSON)], artifact_id=cue.cue_id, name="cue", last_chunk=True)
        except Exception as e:  # the task fails with the reason; the service keeps serving
            log.exception("%s for %s failed", req.kind, req.match_id)
            await up.failed(new_text_message(f"{req.kind} failed: {type(e).__name__}: {e}", context_id=task.context_id, task_id=task.id))
            return
        await up.complete()

    async def cancel(self, context: RequestContext, event_queue: EventQueue) -> None:
        await TaskUpdater(event_queue, context.task_id, context.context_id).cancel()


def create_app(url: str, settings: Settings | None = None, agents: Agents | None = None) -> Starlette:
    """The A2A app: the agent card at /.well-known/agent-card.json and JSON-RPC at /."""
    sessions = Sessions(settings or load_settings(), agents)
    card = agent_card(url)
    handler = DefaultRequestHandler(agent_executor=TouchlineExecutor(sessions), task_store=InMemoryTaskStore(), agent_card=card)

    @asynccontextmanager
    async def lifespan(_app):
        yield
        await sessions.close()

    return Starlette(routes=[*create_agent_card_routes(card), *create_jsonrpc_routes(handler, "/")], lifespan=lifespan)


def main() -> None:
    p = argparse.ArgumentParser(description="touchline-agents: the agent workflow over A2A")
    p.add_argument("--host", default="127.0.0.1")
    p.add_argument("--port", type=int, default=8100)
    a = p.parse_args()
    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(name)s: %(message)s")
    settings = load_settings()
    log.info("touchline-agents A2A on http://%s:%d/ (models: %s)", a.host, a.port, settings.model_label)
    uvicorn.run(create_app(f"http://{a.host}:{a.port}/", settings), host=a.host, port=a.port, log_level="warning")


if __name__ == "__main__":
    main()
```

Apply this change to `services/agents/touchline_agents/workflow.py` (from the repository root):

```bash
git apply <<'PATCH'
diff --git a/services/agents/touchline_agents/workflow.py b/services/agents/touchline_agents/workflow.py
index 7872308..5470fdc 100644
--- a/services/agents/touchline_agents/workflow.py
+++ b/services/agents/touchline_agents/workflow.py
@@ -18,7 +18,7 @@ from pydantic import BaseModel
 from typing_extensions import Never
 
 from . import contracts_gen
-from .contracts import Analysis, Cue, Draft, Moment, MomentTrace, Recap, Signal, Verdict
+from .contracts import Analysis, Cue, Draft, Moment, MomentTrace, Recap, Signal, Verdict, segment_key
 from .factchecker import feedback, other_names, published
 from .personalizer import Story
 from .recap import Told, recap_story
@@ -196,7 +196,8 @@ class Publish(Executor):
                 job.timings[f"personalizer_{g.mode}"] = g.ms
                 if g.fallback and "personalizer" not in job.fallbacks:
                     job.fallbacks.append("personalizer")
-            cues = [c for g in sorted(got, key=lambda g: g.mode) for c in g.cues]
+            order = {segment_key(seg): i for i, seg in enumerate(self.s.segments)}
+            cues = sorted((c for g in got for c in g.cues), key=lambda c: order.get(segment_key(c.segment), len(order)))
             trace = MomentTrace(
                 moment=job.moment, analysis=n.analysis, draft=p.verified.draft, verdicts=n.verdicts, fallbacks=job.fallbacks,
                 cue_ids=[c.cue_id for c in cues], timings_ms=job.timings, model=self.s.settings.model_label,
PATCH
```

- [ ] **Step 4: Run the tests**

Run: `uv run --project services/agents pytest -q services/agents/tests/test_server.py services/agents/tests/test_workflow.py`
Expected: 15 passed, 1 deselected

Run: `uv run --project services/agents touchline-agents --help`
Expected: the usage line `touchline-agents [-h] [--host HOST] [--port PORT]`

Run: `uv run --project services/agents pytest -q services/agents`
Expected: 122 passed, 7 deselected

- [ ] **Step 5: Commit**

```bash
git add services/agents
git commit -m "feat(agents): A2A v1.0 server — agent card, one data-part request per message, cue/trace/recap artifacts streamed, per-match sessions run in order, bad requests fail with a reason

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```



### Task 13: Agent gateway (Effect, A2A client)

`packages/agent-gateway` is the TypeScript side of spec §5.7's agent gateway:
- **Replay:** it replays a run folder through the stats engine for its signals and finds the two whistles.
- **Timeline:** signals go in batches, one per 15 s of game time that raised any. A recap request goes at each whistle, after the batches before it.
- **Transport:** every request goes over A2A with `@a2a-js/sdk` 1.3.0 (`ClientFactory.createFromUrl` with the full agent-card URL).
- **Policies,** as Effect:
  - A time budget per request (`--budget-ms`; 0, no limit, for recorded runs).
  - One retry when the service is unreachable; a failed task or a timeout is not retried.
  - A circuit breaker: after 3 failures in a row, skip the next 4 requests.
- **Validation** (spec §6):
  - Every artifact is decoded against the contracts.
  - Unverified cues are dropped, and so are cues that arrive after their ttl when a budget is set.
  - The gateway never fails; each request's outcome is logged.
- **Cache:** results go to `<run>/agents/`: `cues.jsonl`, `traces.jsonl`, `recaps.jsonl`, `requests.jsonl` and `summary.json` (counts, fallbacks, fact-check outcomes, latency percentiles). `readCueCache` reads the cues back validated, for cached replay.
- **CLI:** `pnpm agents --run <dir>`. It starts its own MCP stats server unless `--mcp-url` is given.

**Tests:** unit tests use fake senders. An end-to-end test runs the real stack on one simulated match: the Python agent service on the stub, the MCP server and the gateway. It asserts every request inside the 4 s live budget and zero unverified cues (spec §7).

**Files:**
- Create: `packages/agent-gateway/package.json`, `packages/agent-gateway/tsconfig.json`, `packages/agent-gateway/vitest.config.ts`, `packages/agent-gateway/src/{a2a,gateway,replay,mcp,cache,segments,cli,index}.ts`
- Modify: `package.json` (root script `agents`), `turbo.json` (the agents' Python files are test inputs)
- Test: `packages/agent-gateway/test/fakes.ts`, `packages/agent-gateway/test/gateway.test.ts`, `packages/agent-gateway/test/cache.test.ts`, `packages/agent-gateway/test/e2e.test.ts`
- Regenerate: `pnpm-lock.yaml`

**Interfaces:**
- Consumes: `decodeCue`, `decodeMomentTrace`, `decodeRecap`, `AgentRequest`, `Segment`, `MAX_SEGMENTS` (Task 1); `readRun`, `StatsEngine`, `signalStream`, `modelsFromJson`, `xtGridFromJson` (`@touchline/stats`); `cliOptions`, `CliError`, `exitOnUserError`, `integer`, `positiveInteger` (`@touchline/sim`); the agent service (Task 12).
- Produces:
  - `a2a.ts`: `Artifact`, `TaskFailed`, `Sender`, `a2aSender(agentsUrl)`.
  - `gateway.ts`: `AgentUnavailable`, `AgentFailed`, `InvalidArtifact`, `GatewayOptions`, `DEFAULT_OPTIONS`, `MatchPlan`, `Outcome`, `RequestLog`, `GatewayResult`, `timeline(plan, opts)`, `exchange(send, req, budgetMs)`, `runGateway(send, plan, opts)`.
  - `replay.ts`: `root`, `replaySignals(dir)`.
  - `mcp.ts`: `startMcpStats(dir)`.
  - `cache.ts`: `AGENTS_DIR`, `CacheError`, `summarize(result)`, `writeCache(runDir, result)`, `readCueCache(runDir)`.
  - `segments.ts`: `parseSegments(text)`, `SegmentError`.
  - CLI: `pnpm agents --run <dir> [--agents URL] [--segments …] [--batch 15] [--budget-ms 0] [--mcp-url URL]`.

- [ ] **Step 1: Create the package**

Create `packages/agent-gateway/package.json`:

```json
{
  "name": "@touchline/agent-gateway",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "exports": {
    ".": "./src/index.ts"
  },
  "scripts": {
    "test": "vitest run",
    "typecheck": "tsc --noEmit -p .",
    "agents": "tsx src/cli.ts"
  },
  "dependencies": {
    "@a2a-js/sdk": "1.3.0",
    "@touchline/schema": "workspace:*",
    "@touchline/sim": "workspace:*",
    "@touchline/stats": "workspace:*",
    "effect": "4.0.0"
  },
  "devDependencies": {
    "@touchline/league": "workspace:*",
    "@touchline/sim-core": "workspace:*"
  }
}
```

Create `packages/agent-gateway/tsconfig.json`:

```json
{ "extends": "../../tsconfig.base.json", "include": ["src", "test", "scripts"] }
```

Create `packages/agent-gateway/vitest.config.ts`:

```ts
import { defineConfig } from "vitest/config"

export default defineConfig({ test: { testTimeout: 120_000 } })
```

Run: `pnpm install`
Expected: `@a2a-js/sdk` 1.3.0 added (released 2026-09-29, so pnpm's minimum release age allows it)

- [ ] **Step 2: Write the failing tests**

Create `packages/agent-gateway/test/fakes.ts`:

```ts
import { readFileSync } from "node:fs"
import { join } from "node:path"
import type { AgentRequest, Cue, Signal } from "@touchline/schema"
import type { Artifact, Sender } from "../src/a2a.js"
import type { MatchPlan } from "../src/gateway.js"
import { root } from "../src/replay.js"

const fixture = (name: string) => (JSON.parse(readFileSync(join(root, "packages/schema/fixtures/agents/valid", name), "utf8")) as { value: unknown }).value

export const CUE = fixture("cue.json") as Cue
export const TRACE = fixture("trace.json")
export const RECAP = fixture("recap.json")

export const signal = (frame: number, type: Signal["type"] = "pressure_shift"): Signal => ({
  id: `m-${type}-${frame}`, match_id: "m", type, frame_id: frame, frame_from: frame - 10, frame_to: frame, period: "first_half", match_clock: "10:00.00",
  team_id: "home-fc", player_id: null, metric: null, value: null, salience: 0.7, evidence: [], data: {}
})

export const plan = (frames: number[], whistles = { half_time: 27000, full_time: 57000 }): MatchPlan => ({
  matchId: "m", mcpUrl: "http://127.0.0.1:1/mcp", fps: 10, signals: frames.map((f) => signal(f)), whistles
})

/** A sender that answers each request with `answer(req, n)` (n counts calls), waiting `delayMs` before each artifact. */
export const fake = (answer: (req: AgentRequest, n: number) => Artifact[] | Error, delayMs = 0): Sender & { calls: AgentRequest[] } => {
  const calls: AgentRequest[] = []
  const send = async function* (req: AgentRequest) {
    calls.push(req)
    const out = answer(req, calls.length)
    if (out instanceof Error) throw out
    for (const a of out) {
      if (delayMs) await new Promise((r) => setTimeout(r, delayMs))
      yield a
    }
  }
  return Object.assign(send, { calls })
}
```

Create `packages/agent-gateway/test/gateway.test.ts`:

```ts
import { Effect } from "effect"
import { describe, expect, it } from "vitest"
import { TaskFailed } from "../src/a2a.js"
import { DEFAULT_OPTIONS, runGateway, timeline } from "../src/gateway.js"
import { parseSegments, SegmentError } from "../src/segments.js"
import { CUE, fake, plan, RECAP, TRACE } from "./fakes.js"

const run = (send: Parameters<typeof runGateway>[0], p = plan([100]), opts = {}) => Effect.runPromise(runGateway(send, p, { ...DEFAULT_OPTIONS, ...opts }))
const ok = () => [{ name: "cue", data: CUE }, { name: "trace", data: TRACE }]

describe("timeline", () => {
  it("batches signals by game time and puts each recap after the batches before its whistle", () => {
    const reqs = timeline(plan([100, 120, 400, 27100, 56000]), { ...DEFAULT_OPTIONS, batchS: 15 })
    expect(reqs.map((r) => (r.kind === "signals" ? `s${r.now_frame}:${r.signals.length}` : `${r.recap}@${r.at_frame}`))).toEqual([
      "s120:2", "s400:1", "half_time@27000", "s27100:1", "s56000:1", "full_time@57000"
    ])
    expect(reqs.every((r) => r.match_id === "m" && r.segments.length === 2)).toBe(true)
  })
})

describe("gateway", () => {
  it("collects validated cues, traces and recaps", async () => {
    const r = await run(fake((req) => (req.kind === "signals" ? ok() : [{ name: "recap", data: RECAP }])))
    expect(r.cues).toHaveLength(1)
    expect(r.traces).toHaveLength(1)
    expect(r.recaps).toHaveLength(2)
    expect(r.requests.map((q) => q.outcome)).toEqual(["ok", "ok", "ok"])
  })

  it("drops unverified cues and, under a budget, cues that arrive after their ttl", async () => {
    const late = { ...CUE, display: { ...CUE.display, ttl_ms: 1 } }
    const r = await run(fake(() => [{ name: "cue", data: { ...CUE, verified: false } }, { name: "cue", data: late }], 20), plan([100]), { budgetMs: 2000 })
    expect(r.cues).toEqual([])
    expect(r.requests[0]).toMatchObject({ outcome: "ok", unverified: 1, late: 1 })
  })

  it("rejects artifacts that break the contract", async () => {
    const r = await run(fake(() => [{ name: "cue", data: { ...CUE, schema: "touchline.cue/0" } }]))
    expect(r.requests[0]).toMatchObject({ outcome: "invalid" })
    expect(r.cues).toEqual([])
  })

  it("times out a request over budget", async () => {
    const r = await run(fake(() => ok(), 300), plan([100]), { budgetMs: 50 })
    expect(r.requests[0]!.outcome).toBe("timeout")
  })

  it("retries an unreachable service once, but not a failed task", async () => {
    const flaky = fake((_req, n) => (n === 1 ? new Error("fetch failed") : ok()))
    expect((await run(flaky, plan([100]), { breaker: { failures: 9, cooldown: 0 } })).requests[0]!.outcome).toBe("ok")
    const failing = fake(() => new TaskFailed("bad request: no"))
    const r = await run(failing, plan([100]))
    expect(r.requests[0]).toMatchObject({ outcome: "failed", reason: "bad request: no" })
    expect(failing.calls.filter((c) => c.kind === "signals")).toHaveLength(1)
  })

  it("opens the circuit after repeated failures and skips the next requests", async () => {
    const down = fake(() => new TaskFailed("down"))
    const r = await run(down, plan([100, 400, 700, 1000, 1300, 1600]), { breaker: { failures: 3, cooldown: 2 } })
    expect(r.requests.map((q) => q.outcome)).toEqual(["failed", "failed", "failed", "skipped", "skipped", "failed", "failed", "failed"])
  })
})

describe("segments", () => {
  it("parse mode.lang.club and refuse anything else", () => {
    expect(parseSegments("casual.es.ironmoor, analyst.hi.neutral")).toEqual([{ mode: "casual", lang: "es", club: "ironmoor" }, { mode: "analyst", lang: "hi", club: null }])
    for (const bad of ["", "casual.fr.neutral", "casual.en", "fan.en.neutral", Array(13).fill("casual.en.neutral").join(",")]) expect(() => parseSegments(bad)).toThrow(SegmentError)
  })
})
```

Create `packages/agent-gateway/test/cache.test.ts`:

```ts
import { appendFileSync, mkdtempSync, readFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { describe, expect, it } from "vitest"
import { CacheError, readCueCache, summarize, writeCache } from "../src/cache.js"
import type { GatewayResult } from "../src/gateway.js"
import { CUE, TRACE } from "./fakes.js"
import { decodeMomentTrace } from "@touchline/schema"

const result: GatewayResult = {
  cues: [CUE, { ...CUE, cue_id: "m042-c0312" }],
  traces: [decodeMomentTrace(TRACE)],
  recaps: [],
  requests: [{ kind: "signals", frame: 100, outcome: "ok", ms: 812, cues: 2, late: 0, unverified: 0 }, { kind: "signals", frame: 400, outcome: "timeout", ms: 4000, cues: 0, late: 0, unverified: 0 }]
}

describe("cue cache", () => {
  it("writes the agents' output and reads the cues back validated", () => {
    const run = mkdtempSync(join(tmpdir(), "gw-cache-"))
    const dir = writeCache(run, result)
    expect(readCueCache(run).map((c) => c.cue_id)).toEqual(["m042-c0311", "m042-c0312"])
    expect(JSON.parse(readFileSync(join(dir, "summary.json"), "utf8"))).toMatchObject({
      moments: 1, cues: 2, models: ["stub"], requests: { ok: 1, timeout: 1 }, fact_check: { pass: 1 }, latency_ms: { p50: 812 }
    })
  })

  it("names the line that is not a cue, and says how to make a missing cache", () => {
    const run = mkdtempSync(join(tmpdir(), "gw-cache-"))
    expect(() => readCueCache(run)).toThrow(/pnpm agents --run/)
    const dir = writeCache(run, result)
    appendFileSync(join(dir, "cues.jsonl"), JSON.stringify({ ...CUE, display: { ...CUE.display, ttl_ms: -5 } }) + "\n")
    expect(() => readCueCache(run)).toThrow(CacheError)
    expect(() => readCueCache(run)).toThrow(/cues.jsonl:3/)
  })

  it("summarizes latency over successful requests only", () => {
    expect(summarize(result).latency_ms).toEqual({ p50: 812, p95: 812, max: 812 })
  })
})
```

Create `packages/agent-gateway/test/e2e.test.ts`:

```ts
/**
 * The full stack on one simulated match (spec §7 "end to end"): the Python agent service on the stub model, the MCP
 * stats server and the gateway; every request answered within the live budget and no unverified cue.
 */
import { spawn, spawnSync, type ChildProcess } from "node:child_process"
import { mkdtempSync } from "node:fs"
import { createServer } from "node:net"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { Effect } from "effect"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { a2aSender } from "../src/a2a.js"
import { readCueCache, writeCache } from "../src/cache.js"
import { DEFAULT_OPTIONS, runGateway, type GatewayResult } from "../src/gateway.js"
import { startMcpStats, type McpServer } from "../src/mcp.js"
import { replaySignals, root } from "../src/replay.js"

const freePort = () => new Promise<number>((ok) => {
  const s = createServer().listen(0, "127.0.0.1", () => {
    const port = (s.address() as { port: number }).port
    s.close(() => ok(port))
  })
})

const segments = [{ mode: "casual" as const, lang: "es" as const, club: "northwick" }, { mode: "analyst" as const, lang: "hi" as const, club: null }]
let agents: ChildProcess
let mcp: McpServer
let run: string
let result: GatewayResult

beforeAll(async () => {
  run = join(mkdtempSync(join(tmpdir(), "gw-e2e-")), "e2e-err-2")
  spawnSync("pnpm", ["-s", "sim", "--scenario", "costly_error", "--seed", "2", "--match-id", "e2e-err-2", "--out", run], { cwd: root, stdio: "ignore" })
  const port = await freePort()
  agents = spawn("uv", ["run", "--project", "services/agents", "touchline-agents", "--port", String(port)], { cwd: root, env: { ...process.env, TOUCHLINE_LLM: "stub" }, detached: true, stdio: "ignore" })
  const url = `http://127.0.0.1:${port}/`
  for (let i = 0; i < 300; i++) {
    if (await fetch(`${url}.well-known/agent-card.json`).then((r) => r.ok, () => false)) break
    await new Promise((r) => setTimeout(r, 200))
  }
  mcp = await startMcpStats(run)
  const match = await Effect.runPromise(replaySignals(run))
  result = await Effect.runPromise(runGateway(a2aSender(url), { ...match, mcpUrl: mcp.url }, { ...DEFAULT_OPTIONS, segments, budgetMs: 4000 }))
  writeCache(run, result)
}, 240_000)

afterAll(() => {
  mcp?.stop()
  if (agents?.pid) process.kill(-agents.pid, "SIGTERM")
})

describe("gateway and agent service", () => {
  it("answer every request within the live budget", () => {
    expect(result.requests.length).toBeGreaterThan(20)
    expect(result.requests.filter((r) => r.outcome !== "ok")).toEqual([])
    expect(Math.max(...result.requests.map((r) => r.ms))).toBeLessThan(4000)
  })

  it("publish only verified cues, one per segment per moment, anchored to the moment", () => {
    expect(result.requests.reduce((n, r) => n + r.unverified + r.late, 0)).toBe(0)
    for (const t of result.traces) {
      const cues = result.cues.filter((c) => c.moment_id === t.moment.moment_id)
      expect(cues.map((c) => c.segment)).toEqual(segments)
      for (const c of cues) expect([c.anchor.frame_from, c.anchor.frame_to]).toEqual([t.moment.frame_from, t.moment.frame_to])
    }
  })

  it("explain the scripted error and recap both halves", () => {
    expect(result.traces.some((t) => t.moment.type === "costly_error" && t.analysis.cause === "mis-hit clearance under pressure")).toBe(true)
    expect(result.recaps.map((r) => r.kind)).toEqual(["half_time", "full_time"])
    expect(result.cues.filter((c) => c.display.slot === "recap_card")).toHaveLength(4)
  })

  it("leave a cue cache that replays without the agents", () => {
    expect(readCueCache(run)).toEqual(result.cues)
  })
})
```

- [ ] **Step 3: Run them to make sure they fail**

Run: `pnpm --filter @touchline/agent-gateway test`
Expected: 3 files fail to load: `Cannot find module '../src/a2a.js'` (and `../src/cache.js`)

- [ ] **Step 4: Write the A2A sender and the gateway**

Create `packages/agent-gateway/src/a2a.ts`:

```ts
import { randomUUID } from "node:crypto"
import { Role, TaskState } from "@a2a-js/sdk"
import { ClientFactory, type Client } from "@a2a-js/sdk/client"
import type { AgentRequest } from "@touchline/schema"

/** An artifact the agent service streamed back: its name ("cue", "trace", "recap") and its JSON data. */
export interface Artifact {
  readonly name: string
  readonly data: unknown
}

/** The agent service ran the request and failed it (a bad request, or an error inside the workflow). */
export class TaskFailed extends Error {}

/**
 * Sends one request and streams back its artifacts; throws TaskFailed when the task fails, and any other error when
 * the service cannot be reached. Gateway tests use fakes; `a2aSender` is the real one.
 */
export type Sender = (req: AgentRequest, signal: AbortSignal) => AsyncIterable<Artifact>

type Payload = { readonly $case: string; readonly value: any }

/** An A2A v1.0 client of the agent service at `agentsUrl` (the agent card is read from its well-known path). */
export const a2aSender = (agentsUrl: string): Sender => {
  let client: Promise<Client> | undefined
  const connect = () => (client ??= new ClientFactory().createFromUrl(new URL(".well-known/agent-card.json", agentsUrl).href, "").catch((e) => {
    client = undefined
    throw e
  }))
  return async function* (req, signal) {
    const c = await connect()
    const message = {
      messageId: randomUUID(), contextId: "", taskId: "", role: Role.ROLE_USER,
      parts: [{ content: { $case: "data", value: req }, metadata: undefined, filename: "", mediaType: "application/json" }],
      metadata: undefined, extensions: [], referenceTaskIds: []
    }
    const stream = c.sendMessageStream({ tenant: "", message, configuration: undefined, metadata: undefined } as never, { signal } as never)
    for await (const ev of stream) {
      const p = ev.payload as Payload | undefined
      if (!p) continue
      if (p.$case === "artifactUpdate") {
        const a = p.value.artifact
        for (const part of a?.parts ?? []) if (part.content?.$case === "data") yield { name: a.name, data: part.content.value }
      } else if ((p.$case === "statusUpdate" || p.$case === "task") && p.value.status?.state === TaskState.TASK_STATE_FAILED) {
        const text = (p.value.status.message?.parts ?? []).map((x: { content?: Payload }) => (x.content?.$case === "text" ? x.content.value : "")).join(" ")
        throw new TaskFailed(text || "the agent task failed")
      }
    }
  }
}
```

Create `packages/agent-gateway/src/gateway.ts`:

```ts
/**
 * The agent gateway (spec §5.7, §6): sends a match's signals to the agent service in batches and its recaps at the
 * whistles, with a time budget, one retry when the service is unreachable, a circuit breaker, and schema validation
 * of everything that comes back. Late cues (received after their ttl) and unverified cues are dropped.
 */
import { Data, Effect } from "effect"
import { decodeCue, decodeMomentTrace, decodeRecap, type AgentRequest, type Cue, type MomentTrace, type Recap, type Segment, type Signal } from "@touchline/schema"
import { TaskFailed, type Sender } from "./a2a.js"

export class AgentUnavailable extends Data.TaggedError("AgentUnavailable")<{ readonly reason: string }> {}
export class AgentFailed extends Data.TaggedError("AgentFailed")<{ readonly reason: string }> {}
export class InvalidArtifact extends Data.TaggedError("InvalidArtifact")<{ readonly name: string; readonly reason: string }> {}

export interface GatewayOptions {
  readonly segments: ReadonlyArray<Segment>
  /** Seconds of game time per signals batch. */
  readonly batchS: number
  /** Milliseconds a request may take (0: no limit, for recorded runs). */
  readonly budgetMs: number
  /** After `failures` failed requests in a row, skip the next `cooldown` requests. */
  readonly breaker: { readonly failures: number; readonly cooldown: number }
}

export const DEFAULT_OPTIONS: GatewayOptions = {
  segments: [{ mode: "casual", lang: "en", club: null }, { mode: "analyst", lang: "en", club: null }],
  batchS: 15,
  budgetMs: 0,
  breaker: { failures: 3, cooldown: 4 }
}

/** What one match needs: its stats server and its signals, oldest first, and the frames of the two whistles. */
export interface MatchPlan {
  readonly matchId: string
  readonly mcpUrl: string
  readonly fps: number
  readonly signals: ReadonlyArray<Signal>
  readonly whistles: { readonly half_time: number; readonly full_time: number }
}

export type Outcome = "ok" | "failed" | "timeout" | "unavailable" | "invalid" | "skipped"

export interface RequestLog {
  readonly kind: AgentRequest["kind"]
  readonly frame: number
  readonly outcome: Outcome
  readonly ms: number
  readonly cues: number
  readonly late: number
  readonly unverified: number
  readonly reason?: string
}

export interface GatewayResult {
  readonly cues: ReadonlyArray<Cue>
  readonly traces: ReadonlyArray<MomentTrace>
  readonly recaps: ReadonlyArray<Recap>
  readonly requests: ReadonlyArray<RequestLog>
}

/** The requests for a match in order: a signals batch per `batchS` seconds that raised any, and a recap at each whistle. */
export const timeline = (plan: MatchPlan, opts: GatewayOptions): AgentRequest[] => {
  const base = { match_id: plan.matchId, mcp_url: plan.mcpUrl, segments: [...opts.segments] }
  const width = Math.max(1, Math.round(opts.batchS * plan.fps))
  const groups = new Map<number, Signal[]>()
  for (const s of [...plan.signals].sort((a, b) => a.frame_id - b.frame_id)) {
    const k = Math.floor(s.frame_id / width)
    groups.set(k, [...(groups.get(k) ?? []), s])
  }
  const out: Array<{ frame: number; order: number; req: AgentRequest }> = [...groups.values()].map((g) => {
    const frame = g[g.length - 1]!.frame_id
    return { frame, order: 0, req: { kind: "signals" as const, ...base, now_frame: frame, signals: g } }
  })
  for (const recap of ["half_time", "full_time"] as const) {
    const frame = plan.whistles[recap]
    out.push({ frame, order: 1, req: { kind: "recap" as const, ...base, recap, at_frame: frame } })
  }
  return out.sort((a, b) => a.frame - b.frame || a.order - b.order).map((x) => x.req)
}

const frameOf = (req: AgentRequest) => (req.kind === "signals" ? req.now_frame : req.at_frame)

interface Received {
  readonly cues: Cue[]
  readonly traces: MomentTrace[]
  readonly recaps: Recap[]
  late: number
  unverified: number
}

const decode = <A>(name: string, f: (u: unknown) => A, data: unknown): A => {
  try {
    return f(data)
  } catch (e) {
    throw new InvalidArtifact({ name, reason: e instanceof Error ? e.message.split("\n")[0]! : String(e) })
  }
}

/** One request: stream its artifacts, validate each, drop late and unverified cues. */
export const exchange = (send: Sender, req: AgentRequest, budgetMs: number) => {
  const run = Effect.tryPromise({
    try: async (signal) => {
      const t0 = performance.now()
      const got: Received = { cues: [], traces: [], recaps: [], late: 0, unverified: 0 }
      for await (const a of send(req, signal)) {
        if (a.name === "cue") {
          const cue = decode("cue", decodeCue, a.data)
          if (!cue.verified) got.unverified++
          else if (budgetMs > 0 && performance.now() - t0 > cue.display.ttl_ms) got.late++
          else got.cues.push(cue)
        } else if (a.name === "trace") got.traces.push(decode("trace", decodeMomentTrace, a.data))
        else if (a.name === "recap") got.recaps.push(decode("recap", decodeRecap, a.data))
        else throw new InvalidArtifact({ name: a.name, reason: "unknown artifact name" })
      }
      return { ...got, ms: performance.now() - t0 }
    },
    catch: (e) =>
      e instanceof InvalidArtifact ? e : e instanceof TaskFailed ? new AgentFailed({ reason: e.message }) : new AgentUnavailable({ reason: e instanceof Error ? e.message : String(e) })
  })
  return (budgetMs > 0 ? run.pipe(Effect.timeout(`${budgetMs} millis`)) : run).pipe(
    // Only an unreachable service is worth one more try; a failed task or a timeout would fail again or be too late.
    Effect.retry({ times: 1, while: (e) => e._tag === "AgentUnavailable" })
  )
}

/** Run a match's timeline through the agent service. Never fails: every request's outcome is in `requests`. */
export const runGateway = (send: Sender, plan: MatchPlan, opts: GatewayOptions = DEFAULT_OPTIONS) =>
  Effect.gen(function* () {
    const cues: Cue[] = []
    const traces: MomentTrace[] = []
    const recaps: Recap[] = []
    const requests: RequestLog[] = []
    let failures = 0
    let skip = 0
    for (const req of timeline(plan, opts)) {
      const base = { kind: req.kind, frame: frameOf(req) }
      if (skip > 0) {
        skip--
        requests.push({ ...base, outcome: "skipped", ms: 0, cues: 0, late: 0, unverified: 0 })
        continue
      }
      const t0 = performance.now()
      const r = yield* Effect.result(exchange(send, req, opts.budgetMs))
      if (r._tag === "Success") {
        failures = 0
        cues.push(...r.success.cues)
        traces.push(...r.success.traces)
        recaps.push(...r.success.recaps)
        requests.push({ ...base, outcome: "ok", ms: r.success.ms, cues: r.success.cues.length, late: r.success.late, unverified: r.success.unverified })
        continue
      }
      const e = r.failure
      const outcome: Outcome = e._tag === "TimeoutError" ? "timeout" : e._tag === "AgentFailed" ? "failed" : e._tag === "InvalidArtifact" ? "invalid" : "unavailable"
      requests.push({ ...base, outcome, ms: performance.now() - t0, cues: 0, late: 0, unverified: 0, reason: "reason" in e ? e.reason : e.message })
      if (++failures >= opts.breaker.failures) {
        failures = 0
        skip = opts.breaker.cooldown
      }
    }
    return { cues, traces, recaps, requests } satisfies GatewayResult
  })
```

- [ ] **Step 5: Write the replay, the MCP launcher, the cache and the CLI**

Create `packages/agent-gateway/src/replay.ts`:

```ts
import { existsSync, readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { Effect, Stream } from "effect"
import { modelsFromJson, readRun, signalStream, StatsEngine, xtGridFromJson, type ReplayError, type Roster } from "@touchline/stats"
import type { MatchPlan } from "./gateway.js"

export const root = join(dirname(fileURLToPath(import.meta.url)), "../../..")

/** Replay a run folder through the stats engine: its signals in the order they were raised, and the two whistles. */
export const replaySignals = (dir: string): Effect.Effect<Omit<MatchPlan, "mcpUrl">, ReplayError> =>
  Effect.gen(function* () {
    const params = (f: string) => JSON.parse(readFileSync(join(root, "data/params", f), "utf8"))
    const leaguePath = join(root, "data/league/league.json")
    const roster = existsSync(leaguePath) ? (JSON.parse(readFileSync(leaguePath, "utf8")) as Roster) : undefined
    const run = yield* readRun(dir, roster)
    const engine = new StatsEngine(run.info, modelsFromJson(params("stats-models.json")), xtGridFromJson(params("xt-grid.json")))
    const signals = yield* Stream.runCollect(signalStream(engine, run.inputs))
    const ends = engine.events.filter((e) => e.type === "period_end").map((e) => e.frame_id)
    const last = engine.eventTicks[engine.eventTicks.length - 1] ?? 0
    return {
      matchId: run.info.matchId,
      fps: Math.round(1 / run.info.dt),
      signals: [...signals],
      whistles: { half_time: ends[0] ?? last, full_time: ends[1] ?? last }
    }
  })
```

Create `packages/agent-gateway/src/mcp.ts`:

```ts
import { spawn } from "node:child_process"
import { resolve } from "node:path"
import { root } from "./replay.js"

export interface McpServer {
  readonly url: string
  readonly stop: () => void
}

/** Start `pnpm mcp-stats --run <dir> --http 0` and resolve with its URL once it listens. */
export const startMcpStats = (dir: string, timeoutMs = 60_000): Promise<McpServer> =>
  new Promise((ok, fail) => {
    const proc = spawn("pnpm", ["-s", "mcp-stats", "--run", resolve(dir), "--http", "0"], { cwd: root, detached: true, stdio: ["ignore", "ignore", "pipe"] })
    const stop = () => {
      if (proc.exitCode === null && proc.pid) process.kill(-proc.pid, "SIGTERM")
    }
    let err = ""
    const timer = setTimeout(() => {
      stop()
      fail(new Error(`mcp-stats did not start in ${timeoutMs} ms: ${err.slice(-500)}`))
    }, timeoutMs)
    proc.stderr.on("data", (b: Buffer) => {
      err += b.toString()
      const m = /touchline-stats MCP on (http:\/\/\S+\/mcp)/.exec(err)
      if (m) {
        clearTimeout(timer)
        ok({ url: m[1]!, stop })
      }
    })
    proc.on("exit", (code) => {
      clearTimeout(timer)
      fail(new Error(`mcp-stats exited (${code}): ${err.slice(-500)}`))
    })
  })
```

Create `packages/agent-gateway/src/cache.ts`:

```ts
/**
 * The cue cache (spec §6 "cached replay mode"): a run's agent output in `<run>/agents/`, so a recorded match replays
 * its cues without calling a model. Every line is validated against the contracts when written and when read.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { decodeCue, type Cue } from "@touchline/schema"
import type { GatewayResult, RequestLog } from "./gateway.js"

export const AGENTS_DIR = "agents"

export class CacheError extends Error {}

const pct = (xs: number[], p: number) => {
  if (xs.length === 0) return 0
  const s = [...xs].sort((a, b) => a - b)
  return Math.round(s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))]!)
}

/** Counts for the ops view and the README: what the agents did, how often they fell back, how long requests took. */
export const summarize = (r: GatewayResult) => {
  const count = <T extends string>(xs: T[]) => Object.fromEntries([...new Set(xs)].sort().map((x) => [x, xs.filter((y) => y === x).length]))
  const ok = r.requests.filter((q: RequestLog) => q.outcome === "ok")
  return {
    moments: r.traces.length,
    cues: r.cues.length,
    recaps: r.recaps.length,
    models: [...new Set(r.traces.map((t) => t.model))],
    requests: count(r.requests.map((q) => q.outcome)),
    late_cues: r.requests.reduce((n, q) => n + q.late, 0),
    unverified_cues: r.requests.reduce((n, q) => n + q.unverified, 0),
    fact_check: count(r.traces.map((t) => t.verdicts.map((v) => v.status).join("+"))),
    fallbacks: count(r.traces.flatMap((t) => [...t.fallbacks])),
    latency_ms: { p50: pct(ok.map((q) => q.ms), 50), p95: pct(ok.map((q) => q.ms), 95), max: pct(ok.map((q) => q.ms), 100) }
  }
}

const jsonl = (xs: ReadonlyArray<unknown>) => xs.map((x) => JSON.stringify(x)).join("\n") + (xs.length ? "\n" : "")

/** Write cues.jsonl, traces.jsonl, recaps.jsonl, requests.jsonl and summary.json under `<run>/agents/`. */
export const writeCache = (runDir: string, r: GatewayResult): string => {
  const dir = join(runDir, AGENTS_DIR)
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, "cues.jsonl"), jsonl(r.cues))
  writeFileSync(join(dir, "traces.jsonl"), jsonl(r.traces))
  writeFileSync(join(dir, "recaps.jsonl"), jsonl(r.recaps))
  writeFileSync(join(dir, "requests.jsonl"), jsonl(r.requests))
  writeFileSync(join(dir, "summary.json"), JSON.stringify(summarize(r), null, 2) + "\n")
  return dir
}

/** A run's cached cues, validated (CacheError names the line that is not a cue). */
export const readCueCache = (runDir: string): Cue[] => {
  const path = join(runDir, AGENTS_DIR, "cues.jsonl")
  if (!existsSync(path)) throw new CacheError(`no cue cache at ${path} (run pnpm agents --run ${runDir})`)
  return readFileSync(path, "utf8").split("\n").flatMap((line, i) => {
    if (line.trim() === "") return []
    try {
      return [decodeCue(JSON.parse(line))]
    } catch (e) {
      throw new CacheError(`${path}:${i + 1}: ${e instanceof Error ? e.message.split("\n")[0] : String(e)}`)
    }
  })
}
```

Create `packages/agent-gateway/src/segments.ts`:

```ts
import { MAX_SEGMENTS, type Segment } from "@touchline/schema"

export class SegmentError extends Error {}

/** Parse "casual.en.neutral,analyst.es.ironmoor" (mode.lang.club, `neutral` for no club) into segments. */
export const parseSegments = (text: string): Segment[] => {
  const keys = text.split(",").map((s) => s.trim()).filter((s) => s !== "")
  if (keys.length === 0) throw new SegmentError("--segments needs at least one segment (mode.lang.club)")
  if (keys.length > MAX_SEGMENTS) throw new SegmentError(`--segments: at most ${MAX_SEGMENTS} segments, got ${keys.length}`)
  return keys.map((k) => {
    const [mode, lang, club, ...rest] = k.split(".")
    if (rest.length || (mode !== "casual" && mode !== "analyst") || (lang !== "en" && lang !== "es" && lang !== "hi") || !club)
      throw new SegmentError(`--segments: "${k}" is not mode.lang.club (mode casual or analyst, lang en, es or hi, club an id or neutral)`)
    return { mode, lang, club: club === "neutral" ? null : club }
  })
}
```

Create `packages/agent-gateway/src/cli.ts`:

```ts
import { resolve } from "node:path"
import { Effect } from "effect"
import { CliError, cliOptions, exitOnUserError, integer, positiveInteger } from "@touchline/sim"
import { ReplayError } from "@touchline/stats"
import { a2aSender } from "./a2a.js"
import { summarize, writeCache } from "./cache.js"
import { DEFAULT_OPTIONS, runGateway } from "./gateway.js"
import { startMcpStats } from "./mcp.js"
import { replaySignals } from "./replay.js"
import { parseSegments, SegmentError } from "./segments.js"

// pnpm runs package scripts from the package folder; INIT_CWD is where the user typed the command.
const here = (p: string) => resolve(process.env.INIT_CWD ?? process.cwd(), p)

const o = cliOptions("touchline-agents: run a match's signals through the agent service and cache the verified cues", {
  run: { default: "", help: "run folder written by pnpm sim" },
  agents: { default: "http://127.0.0.1:8100/", help: "the agent service (A2A), started with: uv run --project services/agents touchline-agents" },
  segments: { default: "casual.en.neutral,analyst.en.neutral", help: "viewer segments, mode.lang.club, comma-separated (at most 12)" },
  batch: { default: String(DEFAULT_OPTIONS.batchS), check: positiveInteger, help: "seconds of game time per signals batch" },
  "budget-ms": { default: "0", check: integer(0, 600_000), help: "time limit per request in ms (4000 for live pacing; 0: none, for recorded runs)" },
  "mcp-url": { default: "", help: "the match's MCP stats server (default: start one for the run)" }
})
const segments = exitOnUserError(() => {
  if (o.run === "") throw new CliError("--run is required (a folder written by pnpm sim, e.g. out/m-1)")
  return parseSegments(o.segments)
}, [SegmentError])

const main = async () => {
  const dir = here(o.run)
  const match = await Effect.runPromise(replaySignals(dir))
  const mcp = o["mcp-url"] ? { url: o["mcp-url"], stop: () => {} } : await startMcpStats(dir)
  try {
    console.error(`${match.matchId}: ${match.signals.length} signals, stats on ${mcp.url}, agents on ${o.agents}`)
    const result = await Effect.runPromise(
      runGateway(a2aSender(o.agents), { ...match, mcpUrl: mcp.url }, { ...DEFAULT_OPTIONS, segments, batchS: Number(o.batch), budgetMs: Number(o["budget-ms"]) })
    )
    const out = writeCache(dir, result)
    console.log(JSON.stringify(summarize(result), null, 2))
    console.error(`wrote ${out}`)
    if (!result.requests.some((r) => r.outcome === "ok")) process.exitCode = 1
  } finally {
    mcp.stop()
  }
}

main().catch((e) => {
  if (e instanceof ReplayError) {
    console.error(e.message)
    process.exit(2)
  }
  throw e
})
```

Create `packages/agent-gateway/src/index.ts`:

```ts
export * from "./a2a.js"
export * from "./cache.js"
export * from "./gateway.js"
export * from "./mcp.js"
export * from "./replay.js"
export * from "./segments.js"
```

Apply this change to `package.json`, `turbo.json` (from the repository root):

```bash
git apply <<'PATCH'
diff --git a/package.json b/package.json
index 5fe5bb9..15e3690 100644
--- a/package.json
+++ b/package.json
@@ -12,7 +12,8 @@
     "calibrate": "pnpm --filter @touchline/calibrate run calibrate",
     "realism": "pnpm --filter @touchline/calibrate run realism",
     "stats": "pnpm --filter @touchline/stats run stats",
-    "mcp-stats": "pnpm --filter @touchline/mcp-stats run serve"
+    "mcp-stats": "pnpm --filter @touchline/mcp-stats run serve",
+    "agents": "pnpm --filter @touchline/agent-gateway run agents"
   },
   "devDependencies": {
     "@types/node": "22.20.5",
diff --git a/turbo.json b/turbo.json
index 2708a49..81eb7ce 100644
--- a/turbo.json
+++ b/turbo.json
@@ -11,7 +11,10 @@
         "$TURBO_ROOT$/data/league/*.json",
         "$TURBO_ROOT$/python/analytics/touchline_analytics/*.py",
         "$TURBO_ROOT$/python/analytics/pyproject.toml",
-        "$TURBO_ROOT$/python/analytics/uv.lock"
+        "$TURBO_ROOT$/python/analytics/uv.lock",
+        "$TURBO_ROOT$/services/agents/touchline_agents/*.py",
+        "$TURBO_ROOT$/services/agents/pyproject.toml",
+        "$TURBO_ROOT$/services/agents/uv.lock"
       ]
     }
   }
PATCH
```

- [ ] **Step 6: Run the tests**

Run: `pnpm turbo run typecheck test --filter=@touchline/agent-gateway`
Expected: `Tasks: 2 successful`; 15 tests: 8 unit, 3 cache, 4 end-to-end (about a minute: the simulated match, the agent service and the MCP server start once)

- [ ] **Step 7: Try it**

Start the agent service on the stub, then run the gateway on a match:

```bash
uv run --project services/agents touchline-agents --port 8100 &
pnpm sim --scenario costly_error --seed 2 --match-id gw-try
pnpm agents --run out/gw-try --segments casual.en.neutral,analyst.hi.larkspur
```

Expected: a summary like `"moments": 24, "cues": 52, "recaps": 2, "requests": {"ok": 58}, "unverified_cues": 0, "fact_check": {"pass": 24}`, and `wrote …/out/gw-try/agents`. Stop the service afterwards.

- [ ] **Step 8: Commit**

```bash
git add package.json pnpm-lock.yaml turbo.json packages/agent-gateway
git commit -m "feat(agent-gateway): Effect gateway over A2A — signal batches and recaps at the whistles, live budget, one retry, circuit breaker, contract validation, late and unverified cues dropped, cue cache for cached replay; end-to-end test with the Python agent service

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```



### Task 14: Ground-truth evaluation harness

`services/agents/evals` computes spec §5.3.1's scores from a run's manifest truths, its decision records and its cached agent output.

**What a truth is.** The achieved script entries, plus the errors that led to a shot. A truth is reported by a moment of the right type, for the right side, within its window plus 2 minutes. When several moments report it, the best-ranked way of reporting it is paired first, then the earliest moment.

**The scores:**
- **Recall:** truths reported.
- **Precision:** moments that report a truth or are significant on their own (salience 0.5 or more, or priority 1).
- **Explanation accuracy:** the Analyst names the cause. An error's kind matters, and so does whether it came under pressure. It is judged by the LLM judge with `--judge`, else by a keyword rubric.
- **Evidence correctness:** expected metric ids at frames inside the window, or the error's own event.
- **Grounding:** claims verified on the first draft, and published cues verified.
- **Decision feedback:** a better option named must be rank 1, and the agents stay silent when the error's pass was rank 1.
- **Persona separation:** casual has at most one number, and analyst carries more numbers or words in the same language.

The evaluators are callables over keyword columns returning dicts, the custom-evaluator shape of `azure-ai-evaluation`'s `evaluate()`. Plan 6 can log the same objects to Foundry.

**The CLI:**
- `touchline-eval score <runs>` scores runs that already have agent output.
- `touchline-eval suite --suite ci|nightly` simulates the six scenarios (one seed each in CI, five nightly), runs them through the gateway and scores them.

**The CI suite found real faults**, each fixed with a test that failed first:
- The pack fetched the last 60 events of a busy play and lost the error the moment rested on, so the cited events are now always fetched.
- A moment that absorbed an older signal took it as its lead.
- A saved big chance did not credit the goalkeeper.
- Costly errors did not cite the metrics the simulator expects (`pass.acc`, `game.chaos`).
- Casual and analyst template cues were identical when a moment had one number; analyst variants now add a sentence of context.
- The harness credited a harmless defensive error to an unrelated opponent goal.

**Three Review Focus items** get their tests here: finished matches release their sessions after the full-time recap; Spanish or Hindi variants that copy the English draft are refused; a batch that promotes nothing completes without artifacts. The README gains an Agents section, with the stub CI scores and the live `gpt-6.1-sol` scores.

**Files:**
- Create: `services/agents/evals/{__init__,rows,rubric,evaluators,judge,report,cli}.py`, `docs/evals/agent-eval-ci.md`, `docs/evals/agent-eval-live-2026-10-07.md`
- Modify: `services/agents/pyproject.toml` (`touchline-eval`, the `evals` package), `services/agents/tests/conftest.py` (the A2A service fixture moves here), `services/agents/touchline_agents/{analyst,personalizer,recap,server,templates,workflow}.py`, `README.md`
- Test: `services/agents/tests/test_evals.py`, `services/agents/tests/test_analyst.py`, `services/agents/tests/test_personalizer.py`, `services/agents/tests/test_server.py`

**Interfaces:**
- Consumes: run folders with `manifest.json` (truths), `domain.jsonl` (decision records) and `agents/` (Task 13's cache); `MomentTrace`, `Cue`, `numbers_in`; `load_settings`, `make_client`, `run_structured`.
- Produces:
  - `evals.rows`: `load_run(run_dir) -> row`, `RunError`.
  - `evals.rubric`: `REPORTED_BY`, `CAUSE_WORDS`, `MISTAKE_WORDS`, `keyword_judge(truth, cause, explanation)`.
  - `evals.evaluators`: `GRACE_S = 120`, `BAND = 0.5`, `truths_of`, `rank`, `matches`, `truth_key`, `MomentRecall`, `MomentPrecision`, `ExplanationAccuracy`, `EvidenceCorrectness`, `Grounding`, `DecisionFeedback`, `PersonaSeparation`, `EVALUATORS`, `score(row, judgments=None)`.
  - `evals.judge`: `Judgment`, `describe(truth)`, `judge_row(row, settings)`.
  - `evals.report`: `METRICS`, `aggregate(scores)`, `markdown(scores, models, judge)`.
  - `evals.cli`: `SUITES`, `SEGMENTS`, `main()`.
  - Agents: `Story.contexts`, `templates.CONTEXT`, `Sessions.open_matches()`, `Sessions.finish(req)`; the test fixture `agents_url`.

- [ ] **Step 1: Write the failing tests**

Apply this change to `services/agents/tests/conftest.py`, `services/agents/tests/test_server.py`, `services/agents/tests/test_analyst.py`, `services/agents/tests/test_personalizer.py` (from the repository root):

```bash
git apply <<'PATCH'
diff --git a/services/agents/tests/conftest.py b/services/agents/tests/conftest.py
index b4fd281..b0f06c0 100644
--- a/services/agents/tests/conftest.py
+++ b/services/agents/tests/conftest.py
@@ -1,12 +1,16 @@
-"""Shared fixtures: one simulated match (scenario `costly_error`, seed 2) and its MCP stats server, once per session."""
+"""Shared fixtures, once per session: one simulated match (scenario `costly_error`, seed 2), its MCP stats server,
+and the agent service over A2A."""
 
+import asyncio
 import json
+import socket
 import subprocess
 from pathlib import Path
 
 import pytest
+import uvicorn
 
-from touchline_agents.config import REPO
+from touchline_agents.config import REPO, load_settings
 from touchline_agents.stats import StatsClient, serve_run
 
 MATCH_ID = "agents-test"
@@ -37,3 +41,21 @@ async def stats_url(run_dir):
 async def stats(stats_url):
     async with StatsClient(stats_url) as client:
         yield client
+
+
+@pytest.fixture(scope="session")
+async def agents_url():
+    """The agent service over A2A (stub model), served in this process on a free port."""
+    from touchline_agents.server import create_app
+
+    with socket.socket() as sock:
+        sock.bind(("127.0.0.1", 0))
+        port = sock.getsockname()[1]
+    url = f"http://127.0.0.1:{port}/"
+    srv = uvicorn.Server(uvicorn.Config(create_app(url, load_settings({}, env_file=None)), host="127.0.0.1", port=port, log_level="warning"))
+    task = asyncio.create_task(srv.serve())
+    while not srv.started:
+        await asyncio.sleep(0.05)
+    yield url
+    srv.should_exit = True
+    await task
diff --git a/services/agents/tests/test_analyst.py b/services/agents/tests/test_analyst.py
index ca3a30b..4dc006f 100644
--- a/services/agents/tests/test_analyst.py
+++ b/services/agents/tests/test_analyst.py
@@ -32,6 +32,8 @@ async def test_explains_the_scripted_error_from_what_could_be_seen(stats, signal
     assert any(c.kind == "event" and c.event_id == truth["mistake_id"] for c in a.claims)
     shot = next(c for c in a.claims if c.metric_id == "shot.xg")
     assert shot.event_id == truth["shot_id"] and shot.quote == f"{shot.value:.2f}"
+    # The metrics the simulator expects an explanation of a defensive error to cite (its manifest's expected_metrics).
+    assert {c.metric_id for c in a.claims} >= {"pass.acc", "game.chaos"}
 
 
 async def test_every_signal_type_gets_an_explanation(stats, signals):
@@ -80,3 +82,35 @@ async def test_openai_explains_the_scripted_error(stats, signals, manifest):
     print(out.ms, out.analysis.model_dump_json(indent=1))
     assert "mis-hit" in out.analysis.cause.lower() or "mishit" in out.analysis.cause.lower()
     assert any(c.event_id == manifest["truths"]["critical_errors"][0]["mistake_id"] for c in out.analysis.claims)
+
+
+async def test_the_events_a_moment_rests_on_are_in_the_pack_however_busy_the_play(stats, signals):
+    m = moment_for(signals, "costly_error")
+    busy = m.model_copy(update={"frame_to": m.frame_to + 3000})  # five minutes later: far more than 60 events
+    lead = next(s for s in signals if s.id == m.signal_ids[0])
+    pack = await evidence(stats, busy, signals)
+    assert set(lead.evidence) <= {e["id"] for e in pack["events"]}
+    assert template_analysis(pack).cause == "mis-hit clearance under pressure"
+
+
+def test_a_saved_big_chance_credits_the_keeper():
+    pack = {
+        "moment": {"moment_id": "mo-1", "type": "big_chance", "team_id": "home-fc", "player_id": "h9"}, "at_frame": 500, "metrics": [], "errors": [],
+        "decisions": [], "signals": [], "names": {"home-fc": "Home FC", "away-fc": "Away Town", "h9": "Ada Striker"},
+        "score": {"home": 0, "away": 0, "home_team": "home-fc", "away_team": "away-fc"},
+        "events": [{"id": "e1", "type": "shot", "frame_id": 490, "team_id": "home-fc", "player_id": "h9", "outcome": "saved", "values": {"shot.xg": 0.41}, "qualifiers": {}},
+                   {"id": "e2", "type": "keeper_save", "frame_id": 495, "team_id": "away-fc", "player_id": "a1", "outcome": None, "values": {}, "qualifiers": {}}],
+    }
+    a = template_analysis(pack)
+    assert a.cause == "big chance saved by the goalkeeper" and "goalkeeper" in a.explanation
+
+
+async def test_the_lead_signal_comes_first_even_when_an_absorbed_one_is_older(stats, signals):
+    lead = next(s for s in signals if s.type == "costly_error")
+    older = lead.model_copy(update={"id": "absorbed-press", "type": "pressure_shift", "frame_id": lead.frame_id - 50, "frame_from": lead.frame_id - 3000,
+                                    "frame_to": lead.frame_from, "salience": 0.6, "evidence": [f"team.press@{lead.frame_id - 3000}-{lead.frame_id - 50}"]})
+    [m] = build_moments([lead.id], [older, *signals], DetectorState(fps=10), "rules")
+    assert m.signal_ids == [lead.id, "absorbed-press"]
+    pack = await evidence(stats, m, [older, *signals])
+    assert pack["signals"][0]["id"] == lead.id
+    assert template_analysis(pack).cause == "mis-hit clearance under pressure"
diff --git a/services/agents/tests/test_personalizer.py b/services/agents/tests/test_personalizer.py
index 957e981..aba743c 100644
--- a/services/agents/tests/test_personalizer.py
+++ b/services/agents/tests/test_personalizer.py
@@ -23,7 +23,7 @@ def story(type_: str = "goal", cause: str = "low-probability chance") -> Story:
 def payload(seg: Segment, type_: str = "goal", cause: str = "low-probability chance"):
     s = story(type_, cause)
     return {"segment": seg.model_dump(mode="json"), "story": {"template": s.template, "team_id": s.team_id, "player_id": s.player_id, "clock": s.clock},
-            "headline": s.headlines[seg.lang], "names": NAMES, "draft": DRAFT.sentences, "claims": [c.model_dump(mode="json") for c in DRAFT.claims]}
+            "headline": s.headlines[seg.lang], "context": s.contexts[seg.lang], "names": NAMES, "draft": DRAFT.sentences, "claims": [c.model_dump(mode="json") for c in DRAFT.claims]}
 
 
 SEGMENTS = [Segment(mode=m, lang=l, club=c) for m, l, c in itertools.product(["casual", "analyst"], ["en", "es", "hi"], [None, "home-fc", "away-fc"])]
@@ -59,6 +59,14 @@ def test_the_check_catches_bad_variants(variant, problem):
     assert any(problem in x for x in check_variant(variant, p, ["Cy Outsider"])), check_variant(variant, p, ["Cy Outsider"])
 
 
+@pytest.mark.parametrize("lang", ["en", "es", "hi"])
+def test_analyst_variants_go_deeper_than_casual_even_with_one_number(lang):
+    one = [DRAFT.claims[2].model_dump(mode="json")]
+    casual = template_variant({**payload(Segment(mode="casual", lang=lang, club=None), "card", "booking"), "claims": one})
+    analyst = template_variant({**payload(Segment(mode="analyst", lang=lang, club=None), "card", "booking"), "claims": one})
+    assert len(analyst.body.split()) > len(casual.body.split())
+
+
 def test_hindi_must_be_devanagari():
     p = payload(Segment(mode="analyst", lang="hi", club=None))
     assert "Hindi text must be in Devanagari" in check_variant(Variant(headline="Goal for Home FC", body="Nice.", numbers=[]), p, [])
@@ -102,3 +110,10 @@ async def test_openai_writes_native_variants_that_pass_the_check(seg):
     out = await Personalizer(make_client(live, "small"), live).personalize(story(), DRAFT, NAMES, seg, ["Cy Outsider"], [])
     print(round(out.ms), out.cue.text.model_dump(), out.reasons)
     assert not out.fallback, out.reasons
+
+
+@pytest.mark.parametrize("lang", ["es", "hi"])
+def test_a_variant_that_copies_the_english_draft_is_not_spanish_or_hindi(lang):
+    p = payload(Segment(mode="analyst", lang=lang, club=None))
+    copied = Variant(headline="गोल" if lang == "hi" else "Gol", body="A tidy finish. Expected goals for the chance: 0.12.", numbers=[{"claim": 0, "quote": "0.12"}])
+    assert any("copies the English draft" in x for x in check_variant(copied, p, []))
diff --git a/services/agents/tests/test_server.py b/services/agents/tests/test_server.py
index 8d39325..af1b2a4 100644
--- a/services/agents/tests/test_server.py
+++ b/services/agents/tests/test_server.py
@@ -1,10 +1,7 @@
-import asyncio
-import socket
 import uuid
 
 import httpx
 import pytest
-import uvicorn
 from a2a.client import A2ACardResolver, ClientConfig, ClientFactory
 from a2a.helpers import get_data_parts, new_data_part, new_text_part
 from a2a.types import Message, Role, SendMessageRequest, TaskState
@@ -17,21 +14,9 @@ from .conftest import MATCH_ID
 SEGMENTS = [{"mode": "casual", "lang": "en", "club": None}, {"mode": "analyst", "lang": "es", "club": None}]
 
 
-@pytest.fixture(scope="module")
-async def server():
-    from touchline_agents.server import create_app
-
-    with socket.socket() as sock:
-        sock.bind(("127.0.0.1", 0))
-        port = sock.getsockname()[1]
-    url = f"http://127.0.0.1:{port}/"
-    srv = uvicorn.Server(uvicorn.Config(create_app(url, load_settings({}, env_file=None)), host="127.0.0.1", port=port, log_level="warning"))
-    task = asyncio.create_task(srv.serve())
-    while not srv.started:
-        await asyncio.sleep(0.05)
-    yield url
-    srv.should_exit = True
-    await task
+@pytest.fixture
+def server(agents_url):
+    return agents_url
 
 
 async def send(url: str, parts) -> tuple[TaskState, dict[str, list[dict]], str]:
@@ -92,3 +77,23 @@ async def test_bad_requests_fail_with_a_reason(server, parts, why):
     state, arts, text = await send(server, parts)
     assert state == TaskState.TASK_STATE_FAILED and arts == {}
     assert why in text, text
+
+
+async def test_a_batch_that_promotes_nothing_completes_without_artifacts(server, stats_url, stats):
+    quiet = [s for s in await stats.signals(limit=500) if s["type"] == "distance_milestone"][:1]
+    req = {"kind": "signals", "match_id": MATCH_ID, "mcp_url": stats_url, "segments": SEGMENTS, "now_frame": quiet[0]["frame_id"], "signals": quiet}
+    state, arts, _ = await send(server, [new_data_part(req, "application/json")])
+    assert state == TaskState.TASK_STATE_COMPLETED and arts == {}
+
+
+async def test_the_full_time_recap_closes_the_match(stats_url, stats):
+    from touchline_agents.contracts import parse_request
+    from touchline_agents.server import Sessions
+
+    sessions = Sessions(load_settings({}, env_file=None))
+    ft = (await stats.events(0, 10**7, types=["period_end"]))[-1]["frame_id"]
+    req = parse_request({"kind": "recap", "match_id": MATCH_ID, "mcp_url": stats_url, "segments": SEGMENTS, "recap": "full_time", "at_frame": ft})
+    await sessions.get(req)
+    assert sessions.open_matches() == [MATCH_ID]
+    await sessions.finish(req)
+    assert sessions.open_matches() == []
PATCH
```

Create `services/agents/tests/test_evals.py`:

```python
import asyncio
import json

import pytest

from evals.evaluators import (
    DecisionFeedback, EvidenceCorrectness, ExplanationAccuracy, Grounding, MomentPrecision, MomentRecall, PersonaSeparation, score,
)
from evals.report import aggregate, markdown
from evals.rows import RunError, load_run
from evals.rubric import keyword_judge
from touchline_agents.config import REPO

from .factories import analysis, claim, moment


def trace(type_="goal", frame=3000, team="home-fc", cause="clinical finish", explanation="A clean finish from a chance.", claims=(), verdict=None, salience=0.9):
    m = moment(type_, frame, team).model_copy(update={"salience": salience, "priority": 1 if type_ == "goal" else 2})
    a = analysis(m.moment_id, cause, list(claims)).model_copy(update={"explanation": explanation})
    v = verdict or {"moment_id": m.moment_id, "status": "pass", "sentences": [], "claims_checked": 2, "claims_verified": 2, "undeclared": 0}
    return {"moment": m.model_dump(mode="json"), "analysis": a.model_dump(mode="json"), "draft": {"moment_id": m.moment_id, "lang": "en", "sentences": ["x"], "claims": []},
            "verdicts": [v], "fallbacks": [], "cue_ids": [], "timings_ms": {}, "model": "stub"}


def row(traces, script=(), critical=(), mistakes=None, decisions=None, cues=()):
    return {"match_id": "m", "scenario": "x", "fps": 10, "home": "home-fc", "away": "away-fc", "script": list(script), "critical_errors": list(critical),
            "mistakes": mistakes or {}, "decisions": decisions or {}, "traces": list(traces), "cues": list(cues)}


GOAL = {"effect": "goal", "team_id": "home-fc", "frames": [0, 5000], "expected_metrics": ["shot.xg", "team.mom"], "achieved": True}
ERROR = {"kind": "error_leading_to_shot", "mistake_id": "m-e7", "shot_id": "m-e9", "team_id": "away-fc", "frame_id": 4000}
MISTAKE = {"m-e7": {"event_id": "m-e7", "frame_id": 3990, "kind": "mishit", "cause": "pressure"}}


def test_recall_needs_the_right_type_team_and_window():
    assert MomentRecall()(**row([trace()], [GOAL])) == {"moment_recall": 1.0, "moment_recall_n": 1}
    for miss in (trace(team="away-fc"), trace("big_chance"), trace(frame=5000 + 1201)):
        assert MomentRecall()(**row([miss], [GOAL]))["moment_recall"] == 0.0
    assert MomentRecall()(**row([trace(frame=5000 + 1200)], [GOAL]))["moment_recall"] == 1.0  # two minutes' grace


def test_precision_counts_truths_and_significant_signals():
    r = row([trace(), trace("speed_alert", 9000, salience=0.3), trace("pressure_shift", 9100, salience=0.6)], [GOAL])
    assert MomentPrecision()(**r) == {"moment_precision": round(2 / 3, 4), "moment_precision_n": 3}


def test_an_error_under_pressure_is_not_a_technical_error():
    t = {"kind": "critical_error", "mistake_kind": "mishit", "mistake_cause": "pressure"}
    assert keyword_judge(t, "mis-hit clearance under pressure", "")
    assert not keyword_judge(t, "mis-hit clearance", "A poor technical strike.")
    assert not keyword_judge(t, "good interception", "They read the pass.")
    assert keyword_judge({**t, "mistake_cause": "technique"}, "mis-hit pass", "He scuffed it with nobody near him.")
    err = trace("costly_error", 4000, "away-fc", cause="mis-hit clearance under pressure", claims=[claim("event", event_id="m-e7")])
    r = row([err], critical=[ERROR], mistakes=MISTAKE)
    assert ExplanationAccuracy()(**r)["explanation_accuracy"] == 1.0
    assert ExplanationAccuracy()(**r, judgments={"m-e7": False})["explanation_accuracy"] == 0.0  # the LLM judge overrides the rubric
    assert EvidenceCorrectness()(**r)["evidence_correctness"] == 1.0


def test_evidence_must_cite_an_expected_metric_inside_the_window():
    good = trace(claims=[claim(quote="0.12", metric_id="shot.xg", value=0.12, event_id="e", at_frame=3000)])
    late = trace(claims=[claim(quote="0.12", metric_id="shot.xg", value=0.12, event_id="e", at_frame=9000)])
    wrong = trace(claims=[claim(quote="60%", metric_id="tilt", subject="home-fc", value=0.6, at_frame=3000)])
    assert [EvidenceCorrectness()(**row([t], [GOAL]))["evidence_correctness"] for t in (good, late, wrong)] == [1.0, 0.0, 0.0]


def test_grounding_first_draft_and_published():
    v = {"moment_id": "x", "status": "retry", "sentences": [], "claims_checked": 4, "claims_verified": 3, "undeclared": 1}
    cue = {"verified": True, "moment_id": "x", "segment": {"mode": "casual", "lang": "en", "club": None}, "text": {"headline": "a", "body": "b"}}
    g = Grounding()(**row([trace(verdict=v), trace()], cues=[cue]))
    assert g == {"grounding_first_draft": round(5 / 6, 4), "grounding_published": 1.0, "drafts_passing_first_time": 0.5, "grounding_n": 6}


def test_decision_feedback_names_the_best_pass_or_stays_silent():
    decisions = {"m-e7": {"chosen_rank": 3, "best_receiver_id": "p-2"}, "m-e8": {"chosen_rank": 1, "best_receiver_id": "p-5"}}
    right = trace(claims=[claim("better_option", event_id="m-e7", receiver_id="p-2")])
    wrong = trace(claims=[claim("better_option", event_id="m-e7", receiver_id="p-4")])
    best_already = trace(claims=[claim("better_option", event_id="m-e8", receiver_id="p-5")])
    scores = [DecisionFeedback()(**row([t], decisions=decisions))["decision_feedback"] for t in (right, wrong, best_already)]
    assert scores == [1.0, 0.0, 0.0]
    silent = trace("costly_error", 4000, "away-fc", cause="mis-hit")
    assert DecisionFeedback()(**row([silent], critical=[{**ERROR, "mistake_id": "m-e8"}], mistakes={"m-e8": {**MISTAKE["m-e7"], "event_id": "m-e8"}}, decisions=decisions))["decision_feedback"] == 1.0


def test_persona_separation_compares_one_language():
    def cue(mode, body, lang="en"):
        return {"moment_id": "mo", "verified": True, "segment": {"mode": mode, "lang": lang, "club": None}, "text": {"headline": "Goal", "body": body}}

    deep = [cue("casual", "What a goal!"), cue("analyst", "A 0.12 chance, now 1-0, 58% momentum.")]
    flat = [cue("casual", "A 0.12 chance, now 1-0."), cue("analyst", "A 0.12 chance.")]
    assert PersonaSeparation()(**row([], cues=deep))["persona_separation"] == 1.0
    assert PersonaSeparation()(**row([], cues=flat))["persona_separation"] == 0.0
    assert PersonaSeparation()(**row([], cues=[cue("casual", "x", "es"), cue("analyst", "y z w", "hi")]))["persona_separation_n"] == 0


def test_report_weights_runs_by_their_cases():
    a = {"match_id": "a", "moments": 3, "cues": 6, "moment_recall": 1.0, "moment_recall_n": 3}
    b = {"match_id": "b", "moments": 1, "cues": 2, "moment_recall": 0.0, "moment_recall_n": 1}
    assert aggregate([a, b])["moment_recall"] == 0.75
    md = markdown([a, b], ["stub"], "keyword rubric")
    assert "| **All (2 runs)** | 4 | **75 %** |" in md and "Models: stub" in md


def test_a_run_without_agent_output_says_how_to_make_it(run_dir):
    with pytest.raises(RunError, match="pnpm agents --run"):
        load_run(run_dir)


async def test_scores_a_match_run_through_the_gateway(run_dir, stats_url, agents_url, manifest):
    """The whole path: the TypeScript gateway sends the match to the agent service, the harness scores its output."""
    proc = await asyncio.create_subprocess_exec(
        "pnpm", "-s", "agents", "--run", str(run_dir), "--agents", agents_url, "--mcp-url", stats_url,
        "--segments", "casual.en.neutral,analyst.en.neutral,casual.es.northwick,analyst.hi.neutral",
        cwd=REPO, stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE,
    )
    out, err = await proc.communicate()
    assert proc.returncode == 0, err.decode()[-800:]
    summary = json.loads(out)
    assert summary["requests"] == {"ok": summary["requests"]["ok"]} and summary["unverified_cues"] == 0
    s = score(load_run(run_dir))
    assert s["moment_recall"] == 1.0 and s["moment_recall_n"] == len(manifest["truths"]["script"]) + len(manifest["truths"]["critical_errors"])
    assert s["explanation_accuracy"] == 1.0 and s["evidence_correctness"] == 1.0
    assert s["grounding_first_draft"] == 1.0 and s["grounding_published"] == 1.0
    assert s["persona_separation"] == 1.0 and s["moment_precision"] >= 0.8


def test_a_truth_pairs_with_the_moment_that_reports_it_best():
    # A defensive error is best reported by the erring team's costly_error, not by an opponent goal in the window.
    truth = {"effect": "defensive_error", "team_id": "home-fc", "frames": [0, 9000], "expected_metrics": ["pass.acc", "game.chaos"], "achieved": True}
    goal = trace("goal", 2000, "away-fc", cause="low-probability chance", explanation="Away worked it into a shooting position.")
    error = trace("costly_error", 4000, "home-fc", cause="mis-hit pass under pressure", explanation="Home gave it away.")
    assert ExplanationAccuracy()(**row([goal, error], [truth]))["explanation_accuracy"] == 1.0


def test_a_harmless_defensive_error_is_not_credited_to_an_unrelated_goal():
    truth = {"effect": "defensive_error", "team_id": "home-fc", "frames": [0, 9000], "expected_metrics": ["pass.acc", "game.chaos"], "achieved": True}
    assert MomentRecall()(**row([trace("goal", 2000, "away-fc")], [truth]))["moment_recall"] == 0.0
```

- [ ] **Step 2: Run them to make sure they fail**

Run: `uv run --project services/agents pytest -q services/agents/tests/test_evals.py services/agents/tests/test_analyst.py services/agents/tests/test_personalizer.py services/agents/tests/test_server.py`
Expected: a collection error: `No module named 'evals'`. Without `test_evals.py` (`pytest -q services/agents/tests/test_analyst.py services/agents/tests/test_personalizer.py services/agents/tests/test_server.py`): 31 failed, 15 passed. The failures are the four new analyst tests (the busy play loses the error, the absorbed signal leads, no goalkeeper credit, no `pass.acc`/`game.chaos`); every personalizer test (the payload reads `Story.contexts`, which does not exist yet); and `the full-time recap closes the match` (`Sessions` has no `open_matches`)

- [ ] **Step 3: Write the harness**

Create `services/agents/evals/__init__.py`:

```python
"""Ground-truth evaluation harness (spec §5.3.1): scores the agents' output on scripted matches against the truths
the simulator recorded in each run's manifest."""
```

Create `services/agents/evals/rows.py`:

```python
"""One evaluation row per run: the manifest's truths, the decision records, and the agents' cached output."""

import json
from pathlib import Path

from touchline_agents.contracts import Cue, MomentTrace


class RunError(Exception):
    """A run folder that cannot be evaluated (missing manifest or agent output)."""


def _jsonl(path: Path) -> list[dict]:
    if not path.is_file():
        raise RunError(f"missing {path} (run: pnpm agents --run {path.parent.parent})")
    return [json.loads(line) for line in path.read_text().splitlines() if line.strip()]


def load_run(run_dir: Path) -> dict:
    """The row for a run: everything the evaluators read, as plain JSON (so rows can go to a .jsonl for Foundry)."""
    run_dir = Path(run_dir)
    manifest_path = run_dir / "manifest.json"
    if not manifest_path.is_file():
        raise RunError(f"missing {manifest_path}")
    manifest = json.loads(manifest_path.read_text())
    truths = manifest["truths"]
    decisions = {}
    for e in _jsonl(run_dir / "domain.jsonl") if (run_dir / "domain.jsonl").is_file() else []:
        a = e["attrs"]
        if "chosen_rank" in a:
            decisions[e["id"]] = {"chosen_rank": a.get("chosen_rank"), "best_receiver_id": a.get("best_receiver_id")}
    agents = run_dir / "agents"
    traces = [MomentTrace.model_validate(t).model_dump(mode="json") for t in _jsonl(agents / "traces.jsonl")]
    cues = [Cue.model_validate(c).model_dump(mode="json", by_alias=True) for c in _jsonl(agents / "cues.jsonl")]
    return {
        "match_id": manifest["match_id"],
        "scenario": manifest.get("scenario"),
        "fps": manifest["fps"],
        "home": manifest["home"],
        "away": manifest["away"],
        "script": [t for t in truths["script"] if t["achieved"]],
        "critical_errors": truths["critical_errors"],
        "mistakes": {m["event_id"]: m for m in truths["mistakes"]},
        "decisions": decisions,
        "traces": traces,
        "cues": cues,
    }
```

Create `services/agents/evals/rubric.py`:

```python
"""What counts as matching a truth, and the keyword rubric for causes (the LLM judge's fallback)."""

import re

# For each injected effect: the moment types that report it, and whether they belong to the truth's team ("same")
# or its opponent ("other").
REPORTED_BY: dict[str, list[tuple[str, str]]] = {
    "goal": [("goal", "same")],
    "red_card": [("card", "same")],
    "press_surge": [("pressure_shift", "same")],
    "momentum_swing": [("momentum_swing", "same")],
    "keeper_heroics": [("big_chance", "other")],
    "keeper_howler": [("goal", "other"), ("costly_error", "same")],
    # An error that led to nothing raises no signal and is not a moment; an opponent goal is not evidence of it.
    "defensive_error": [("costly_error", "same")],
}
CAUSE_WORDS: dict[str, list[str]] = {
    "goal": ["finish", "chance", "shot", "scor", "goal", "error", "mis"],
    "red_card": ["red", "sent off", "dismiss"],
    "press_surge": ["press"],
    "momentum_swing": ["momentum", "control", "territor", "pressure"],
    "keeper_heroics": ["save", "keeper", "goalkeeper", "stop"],
    "keeper_howler": ["keeper", "goalkeeper", "error", "mistake", "fumble", "spill"],
    "defensive_error": ["error", "mis-hit", "mishit", "mistake", "heavy touch", "miscontrol", "gave the ball away", "lost the ball"],
}
MISTAKE_WORDS: dict[str, list[str]] = {
    "mishit": ["mis-hit", "mishit", "miscue", "shank", "slice"],
    "heavy_touch": ["heavy touch", "heavy first touch", "loose touch", "heavy"],
    "miscontrol": ["miscontrol", "poor touch", "control"],
    "missed_touch": ["missed", "let the ball"],
}
PRESSURE = re.compile(r"\bunder (?:heavy |immediate |intense )?pressure\b|\bpressed\b|\bclosed down\b", re.I)


def keyword_judge(truth: dict, cause: str, explanation: str) -> bool:
    """Whether the stated cause names the truth: the effect's words, or for an error its kind and whether it came
    under pressure (a mis-hit under pressure is not the same cause as a mis-hit from poor technique)."""
    text = f"{cause} {explanation}".lower()
    if truth["kind"] == "critical_error":
        kind_ok = any(w in text for w in MISTAKE_WORDS[truth["mistake_kind"]])
        pressured = bool(PRESSURE.search(text))
        return kind_ok and (pressured if truth["mistake_cause"] == "pressure" else not pressured)
    return any(w in text for w in CAUSE_WORDS[truth["effect"]])
```

Create `services/agents/evals/evaluators.py`:

```python
"""The scores of spec §5.3.1, one callable each. Each takes a run's row as keyword columns and returns a dict, the
shape azure-ai-evaluation's `evaluate()` accepts for custom evaluators, so the same objects can log to Foundry."""

from touchline_agents.numbers import numbers_in

from .rubric import REPORTED_BY, keyword_judge

GRACE_S = 120  # a moment may come up to 2 minutes after the truth's window (spec §5.3.1)
BAND = 0.5  # a moment whose signal is this salient is significant on its own (the detector's promote threshold)


def truths_of(script: list[dict], critical_errors: list[dict], mistakes: dict, **_) -> list[dict]:
    """Every truth to be found: the achieved script entries and the errors that led to a shot or goal."""
    out = [{"kind": "script", **t} for t in script]
    for c in critical_errors:
        m = mistakes.get(c["mistake_id"], {})
        out.append({
            "kind": "critical_error", "effect": "defensive_error", "team_id": c["team_id"], "frames": [m.get("frame_id", c["frame_id"]), c["frame_id"]],
            "mistake_id": c["mistake_id"], "shot_id": c["shot_id"], "mistake_kind": m.get("kind", "mishit"), "mistake_cause": m.get("cause", "technique"),
            "expected_metrics": [],
        })
    return out


def rank(truth: dict, trace: dict, fps: float, home: str, away: str) -> int | None:
    """How well a published moment reports a truth: the index of the first way of reporting it that the moment
    matches (0 is best), or None when it does not report it (wrong type, team or time)."""
    m = trace["moment"]
    lo, hi = truth["frames"][0], truth["frames"][1] + GRACE_S * fps
    if not lo <= m["frame_id"] <= hi:
        return None
    if truth["kind"] == "critical_error":
        return 0 if m["type"] == "costly_error" and m["team_id"] == truth["team_id"] else None
    other = away if truth["team_id"] == home else home
    for i, (t, who) in enumerate(REPORTED_BY[truth["effect"]]):
        if m["type"] == t and m["team_id"] == (truth["team_id"] if who == "same" else other):
            return i
    return None


def matches(truth: dict, trace: dict, fps: float, home: str, away: str) -> bool:
    return rank(truth, trace, fps, home, away) is not None


def _found(row: dict) -> list[tuple[dict, dict | None]]:
    """Each truth with the published moment that reports it best, the earliest of those (or None)."""
    out = []
    for t in truths_of(**row):
        ranked = [(r, tr["moment"]["frame_id"], i) for i, tr in enumerate(row["traces"]) if (r := rank(t, tr, row["fps"], row["home"], row["away"])) is not None]
        out.append((t, row["traces"][min(ranked)[2]] if ranked else None))
    return out


def _share(hits: list[bool]) -> float | None:
    return round(sum(hits) / len(hits), 4) if hits else None


class MomentRecall:
    def __call__(self, **row) -> dict:
        hits = [tr is not None for _, tr in _found(row)]
        return {"moment_recall": _share(hits), "moment_recall_n": len(hits)}


class MomentPrecision:
    def __call__(self, **row) -> dict:
        truths = truths_of(**row)
        hits = [
            any(matches(t, tr, row["fps"], row["home"], row["away"]) for t in truths) or tr["moment"]["salience"] >= BAND or tr["moment"]["priority"] == 1
            for tr in row["traces"]
        ]
        return {"moment_precision": _share(hits), "moment_precision_n": len(hits)}


class ExplanationAccuracy:
    """Whether the Analyst names the truth's cause. `judgments` (truth key -> bool) come from the LLM judge when it
    ran; otherwise the keyword rubric decides."""

    def __call__(self, *, judgments: dict | None = None, **row) -> dict:
        hits = []
        for t, tr in _found(row):
            if tr is None:
                continue
            key = truth_key(t)
            a = tr["analysis"]
            hits.append(judgments[key] if judgments and key in judgments else keyword_judge(t, a["cause"], a["explanation"]))
        return {"explanation_accuracy": _share(hits), "explanation_accuracy_n": len(hits)}


def truth_key(t: dict) -> str:
    return t["mistake_id"] if t["kind"] == "critical_error" else f"{t['effect']}:{t['team_id']}:{t['frames'][0]}"


class EvidenceCorrectness:
    """Cited metric ids overlap the truth's expected metrics, at frames inside its window (for an error: the error's
    own event is cited)."""

    def __call__(self, **row) -> dict:
        hits = []
        for t, tr in _found(row):
            if tr is None:
                continue
            claims = tr["analysis"]["claims"] + tr["draft"]["claims"]
            if t["kind"] == "critical_error":
                hits.append(any(c["event_id"] == t["mistake_id"] for c in claims))
                continue
            lo, hi = t["frames"][0], t["frames"][1] + GRACE_S * row["fps"]
            hits.append(any(c["metric_id"] in t["expected_metrics"] and lo <= c["at_frame"] <= hi for c in claims))
        return {"evidence_correctness": _share(hits), "evidence_correctness_n": len(hits)}


class Grounding:
    """Numeric claims verified by the Fact-Checker on the first draft, and in what was published (target 100 %)."""

    def __call__(self, **row) -> dict:
        first = [tr["verdicts"][0] for tr in row["traces"] if tr["verdicts"]]
        checked = sum(v["claims_checked"] for v in first)
        verified = sum(v["claims_verified"] for v in first)
        published = [c["verified"] for c in row["cues"]]
        return {
            "grounding_first_draft": round(verified / checked, 4) if checked else None,
            "grounding_published": _share(published),
            "drafts_passing_first_time": _share([v["status"] == "pass" for v in first]),
            "grounding_n": checked,
        }


class DecisionFeedback:
    """A better option named must be the decision record's first-ranked pass (and only when the pass played was not
    it); for an error whose pass was already the best option, the agents must stay silent."""

    def __call__(self, **row) -> dict:
        hits = []
        for tr in row["traces"]:
            for c in tr["analysis"]["claims"] + tr["draft"]["claims"]:
                if c["kind"] == "better_option":
                    d = row["decisions"].get(c["event_id"])
                    hits.append(bool(d) and d["chosen_rank"] not in (None, 1) and d["best_receiver_id"] == c["receiver_id"])
        for t, tr in _found(row):
            d = row["decisions"].get(t.get("mistake_id", ""))
            if tr is not None and d and d["chosen_rank"] == 1:
                hits.append(not any(c["kind"] == "better_option" for c in tr["analysis"]["claims"] + tr["draft"]["claims"]))
        return {"decision_feedback": _share(hits), "decision_feedback_n": len(hits)}


class PersonaSeparation:
    """Casual and analyst variants of a moment in one language differ in depth: casual has at most one number, and
    analyst has more numbers or more words."""

    def __call__(self, **row) -> dict:
        hits = []
        by_moment: dict[tuple[str, str], dict[str, dict]] = {}
        for c in row["cues"]:
            by_moment.setdefault((c["moment_id"], c["segment"]["lang"]), {})[c["segment"]["mode"]] = c
        for pair in by_moment.values():
            if {"casual", "analyst"} <= set(pair):
                text = {m: f"{c['text']['headline']} {c['text']['body']}" for m, c in pair.items()}
                n = {m: len(numbers_in(t)) for m, t in text.items()}
                hits.append(n["casual"] <= 1 and (n["analyst"] > n["casual"] or len(text["analyst"].split()) > len(text["casual"].split())))
        return {"persona_separation": _share(hits), "persona_separation_n": len(hits)}


EVALUATORS = {
    "recall": MomentRecall(), "precision": MomentPrecision(), "explanation": ExplanationAccuracy(), "evidence": EvidenceCorrectness(),
    "grounding": Grounding(), "decisions": DecisionFeedback(), "persona": PersonaSeparation(),
}


def score(row: dict, judgments: dict | None = None) -> dict:
    out = {"match_id": row["match_id"], "scenario": row["scenario"], "moments": len(row["traces"]), "cues": len(row["cues"])}
    for name, ev in EVALUATORS.items():
        out |= ev(**row, **({"judgments": judgments} if name == "explanation" and judgments else {}))
    return out
```

Create `services/agents/evals/judge.py`:

```python
"""The LLM judge for explanation accuracy (spec §5.3.1: "judged against the truth label by a rubric"). Without a
model, or when it fails, the keyword rubric decides; hand spot-checks read the reasons in the report."""

from agent_framework import Agent
from pydantic import BaseModel, ConfigDict

from touchline_agents.config import Settings
from touchline_agents.llm import agent_options, make_client, run_structured, stub_responder

from .evaluators import _found, truth_key
from .rubric import keyword_judge

INSTRUCTIONS = """You grade a football analyst. INPUT has what really happened (the truth, from the simulator's
script) and the analyst's stated cause and explanation. Answer `correct` true only if the analyst names that cause:
the same kind of event, by the right side, and for an error the same kind of error with the same circumstance
(under pressure versus a plain technical error are different causes). Give a one-sentence reason."""

EFFECTS = {
    "goal": "a goal scored by {team}",
    "red_card": "a red card for a {team} player",
    "press_surge": "{team} pressing much higher and harder",
    "momentum_swing": "momentum swinging to {team}",
    "keeper_heroics": "the {team} goalkeeper making a string of saves",
    "keeper_howler": "a goalkeeping error by {team}",
    "defensive_error": "a defensive error by {team}",
}
KINDS = {"mishit": "a mis-hit kick", "heavy_touch": "a heavy first touch", "miscontrol": "a miscontrolled ball", "missed_touch": "a missed touch"}


class Judgment(BaseModel):
    model_config = ConfigDict(extra="forbid")
    correct: bool
    reason: str


def describe(t: dict) -> str:
    if t["kind"] == "critical_error":
        how = "under pressure" if t["mistake_cause"] == "pressure" else "not under pressure (poor technique)"
        return f"{KINDS[t['mistake_kind']]} by {t['team_id']}, {how}, that gave the ball away and led to an opponent shot"
    return EFFECTS[t["effect"]].format(team=t["team_id"])


@stub_responder("judge")
def _stub(payload: dict, _results: list[str]) -> dict:
    ok = keyword_judge(payload["truth_data"], payload["cause"], payload["explanation"])
    return {"correct": ok, "reason": "keyword rubric"}


async def judge_row(row: dict, settings: Settings) -> tuple[dict[str, bool], dict[str, str]]:
    """Judgments (truth key -> correct) and reasons for every truth a moment reported."""
    agent = Agent(client=make_client(settings, "large"), name="judge", instructions=INSTRUCTIONS, default_options=agent_options(settings))
    verdicts, reasons = {}, {}
    for t, tr in _found(row):
        if tr is None:
            continue
        a = tr["analysis"]
        payload = {"truth": describe(t), "truth_data": t, "cause": a["cause"], "explanation": a["explanation"]}
        out = await run_structured(
            agent, "judge", payload, Judgment, timeout_s=settings.timeout("judge"),
            fallback=lambda t=t, a=a: Judgment(correct=keyword_judge(t, a["cause"], a["explanation"]), reason="keyword rubric (judge unavailable)"),
        )
        verdicts[truth_key(t)] = out.value.correct
        reasons[truth_key(t)] = out.value.reason
    return verdicts, reasons
```

Create `services/agents/evals/report.py`:

```python
"""Scores over many runs, and the markdown report the README quotes."""

METRICS = [
    ("moment_recall", "Moment recall"), ("moment_precision", "Moment precision"), ("explanation_accuracy", "Explanation accuracy"),
    ("evidence_correctness", "Evidence correctness"), ("grounding_first_draft", "Grounding (first draft)"),
    ("grounding_published", "Grounding (published)"), ("decision_feedback", "Decision feedback"), ("persona_separation", "Persona separation"),
]
N = {"grounding_first_draft": "grounding_n", "grounding_published": "cues"}


def aggregate(scores: list[dict]) -> dict:
    """Each score over all runs, weighted by how many cases each run had."""
    out = {}
    for key, _ in METRICS:
        nkey = N.get(key, f"{key}_n")
        pairs = [(s[key], s.get(nkey, 0)) for s in scores if s.get(key) is not None and s.get(nkey, 0)]
        total = sum(n for _, n in pairs)
        out[key] = round(sum(v * n for v, n in pairs) / total, 4) if total else None
        out[nkey] = total
    out["moments"] = sum(s["moments"] for s in scores)
    out["cues"] = sum(s["cues"] for s in scores)
    return out


def _cell(v: float | None) -> str:
    return "–" if v is None else f"{100 * v:.0f} %"


def markdown(scores: list[dict], models: list[str], judge: str) -> str:
    total = aggregate(scores)
    head = "| Run | Moments | " + " | ".join(name for _, name in METRICS) + " |"
    sep = "|---" * (len(METRICS) + 2) + "|"
    rows = [f"| {s['match_id']} | {s['moments']} | " + " | ".join(_cell(s.get(k)) for k, _ in METRICS) + " |" for s in scores]
    rows.append(f"| **All ({len(scores)} runs)** | {total['moments']} | " + " | ".join(f"**{_cell(total[k])}**" for k, _ in METRICS) + " |")
    return "\n".join([
        "# Agent evaluation against scripted ground truth", "",
        f"Models: {', '.join(models) or 'none'}. Explanation accuracy judged by: {judge}.", "",
        "Definitions: spec §5.3.1. Recall counts achieved script truths and errors that led to a shot; a moment counts within its truth's window plus 2 minutes.", "",
        head, sep, *rows, "",
    ])
```

Create `services/agents/evals/cli.py`:

```python
"""touchline-eval: score runs against their truths, or run a fixed suite of scripted matches first.

    uv run --project services/agents touchline-eval score out/eval/* --out out/eval/report.md
    uv run --project services/agents touchline-eval suite --suite ci --out out/eval --agents http://127.0.0.1:8100/
"""

import argparse
import asyncio
import json
import subprocess
import sys
from pathlib import Path

from touchline_agents.config import REPO, load_settings

from .evaluators import score
from .judge import judge_row
from .report import aggregate, markdown
from .rows import RunError, load_run

SCENARIOS = ["late_comeback", "red_card_collapse", "keeper_heroics", "costly_error", "high_press_vs_low_block", "even_contest"]
SUITES = {"ci": [(s, 1) for s in SCENARIOS], "nightly": [(s, seed) for s in SCENARIOS for seed in range(1, 6)]}
SEGMENTS = "casual.en.neutral,analyst.en.neutral,casual.es.neutral,analyst.hi.neutral"


def score_runs(runs: list[Path], judge: bool) -> tuple[list[dict], list[str], str]:
    settings = load_settings()
    scores, models = [], set()
    for run in runs:
        row = load_run(run)
        models |= {t["model"] for t in row["traces"]}
        judgments = asyncio.run(judge_row(row, settings))[0] if judge else None
        scores.append(score(row, judgments))
    return scores, sorted(models), (f"LLM judge ({settings.model_label})" if judge else "keyword rubric")


def run_suite(suite: str, out: Path, agents: str, segments: str) -> list[Path]:
    runs = []
    for scenario, seed in SUITES[suite]:
        run = (out / f"eval-{scenario}-{seed}").resolve()
        subprocess.run(["pnpm", "-s", "sim", "--scenario", scenario, "--seed", str(seed), "--match-id", run.name, "--out", str(run)], cwd=REPO, check=True, capture_output=True)
        subprocess.run(["pnpm", "-s", "agents", "--run", str(run), "--agents", agents, "--segments", segments], cwd=REPO, check=True, capture_output=True)
        print(f"ran {run.name}", file=sys.stderr)
        runs.append(run)
    return runs


def main() -> None:
    p = argparse.ArgumentParser(prog="touchline-eval", description="Score the agents against scripted ground truth (spec §5.3.1)")
    sub = p.add_subparsers(dest="cmd", required=True)
    s = sub.add_parser("score", help="score run folders that have agent output (pnpm agents --run ...)")
    s.add_argument("runs", nargs="+", type=Path)
    u = sub.add_parser("suite", help="simulate a fixed suite of scripted matches, run the agents on them, score them")
    u.add_argument("--suite", choices=sorted(SUITES), default="ci")
    u.add_argument("--agents", default="http://127.0.0.1:8100/")
    u.add_argument("--segments", default=SEGMENTS)
    for x in (s, u):
        x.add_argument("--out", type=Path, help="markdown report (score) or suite folder (suite); default: print")
        x.add_argument("--json", type=Path, help="also write the scores as JSON")
        x.add_argument("--judge", action="store_true", help="judge explanations with the model (TOUCHLINE_LLM=openai) instead of the keyword rubric")
    a = p.parse_args()
    try:
        if a.cmd == "suite":
            out = a.out or REPO / "out/eval"
            runs = run_suite(a.suite, out, a.agents, a.segments)
            report_path = out / "report.md"
        else:
            runs, report_path = a.runs, a.out
        scores, models, judge = score_runs(runs, a.judge)
    except (RunError, subprocess.CalledProcessError) as e:
        print(e if isinstance(e, RunError) else f"{' '.join(e.cmd[:4])} failed: {e.stderr.decode()[-400:]}", file=sys.stderr)
        sys.exit(2)
    text = markdown(scores, models, judge)
    if report_path:
        report_path.parent.mkdir(parents=True, exist_ok=True)
        report_path.write_text(text)
        print(f"wrote {report_path}", file=sys.stderr)
    print(text)
    if a.json:
        a.json.write_text(json.dumps({"runs": scores, "all": aggregate(scores), "models": models, "judge": judge}, indent=2) + "\n")
```

Apply this change to `services/agents/pyproject.toml` (from the repository root):

```bash
git apply <<'PATCH'
diff --git a/services/agents/pyproject.toml b/services/agents/pyproject.toml
index 2e76246..66bf661 100644
--- a/services/agents/pyproject.toml
+++ b/services/agents/pyproject.toml
@@ -15,13 +15,14 @@ dependencies = [
 
 [project.scripts]
 touchline-agents = "touchline_agents.server:main"
+touchline-eval = "evals.cli:main"
 
 [build-system]
 requires = ["hatchling"]
 build-backend = "hatchling.build"
 
 [tool.hatch.build.targets.wheel]
-packages = ["touchline_agents"]
+packages = ["touchline_agents", "evals"]
 
 [dependency-groups]
 dev = ["pytest==9.1.1", "pytest-asyncio==1.4.0", "datamodel-code-generator==0.83.0"]
PATCH
```

Run: `uv sync --project services/agents && uv run --project services/agents touchline-eval --help`
Expected: usage with the two commands `score` and `suite`

- [ ] **Step 4: Fix what the harness found**

Apply this change to `services/agents/touchline_agents/analyst.py`, `services/agents/touchline_agents/templates.py`, `services/agents/touchline_agents/personalizer.py`, `services/agents/touchline_agents/recap.py`, `services/agents/touchline_agents/workflow.py`, `services/agents/touchline_agents/server.py` (from the repository root):

```bash
git apply <<'PATCH'
diff --git a/services/agents/touchline_agents/analyst.py b/services/agents/touchline_agents/analyst.py
index 6ccdf19..5e0cdcb 100644
--- a/services/agents/touchline_agents/analyst.py
+++ b/services/agents/touchline_agents/analyst.py
@@ -29,7 +29,7 @@ METRICS_FOR: dict[str, list[tuple[str, str]]] = {
     "distance_milestone": [("plyr.dist", "player")],
     "player_milestone": [],
     "difficult_pass_completed": [("pass.xp", "player")],
-    "costly_error": [],
+    "costly_error": [("pass.acc", "team"), ("game.chaos", "match")],
 }
 LOOKBACK_S = 15  # the play before a moment: where errors leading to a shot are looked for (spec §5.1.10)
 TOUCHES = {"heavy": "heavy touch", "miscontrol": "miscontrol", "missed": "missed touch"}
@@ -79,6 +79,11 @@ async def evidence(stats: StatsClient, moment: Moment, signals: list[Signal]) ->
             metrics.append({"metric_id": metric_id, "subject": subject, "value": m["value"], "ref": m["ref"], "at_frame": at})
     events = await stats.events(max(0, moment.frame_from - LOOKBACK_S * fps), at, limit=60)
     events = [e for e in events if e["type"] not in ("off_ball_run", "pressure")] if len(events) > 40 else events
+    # The events the moment's signals rest on are always in the pack, however busy the play around them.
+    cited = [i for s in signals if s.id in moment.signal_ids for i in s.evidence if "@" not in i]
+    have = {e["id"] for e in events}
+    if missing := [i for i in dict.fromkeys(cited) if i not in have]:
+        events = sorted(events + (await stats.call("get_events", ids=missing, to_frame=at))["events"], key=lambda e: e["frame_id"])
     errors = [e["id"] for e in events if e["qualifiers"].get("execution") == "mishit" or e["qualifiers"].get("first_touch") in TOUCHES]
     decisions = []
     for e in events:
@@ -92,7 +97,9 @@ async def evidence(stats: StatsClient, moment: Moment, signals: list[Signal]) ->
     involved = {e.get("player_id") for e in events} | {moment.team_id, moment.player_id, info["home"]["id"], info["away"]["id"]}
     return {
         "moment": moment.model_dump(mode="json"),
-        "signals": [s.model_dump(mode="json", include={"id", "type", "team_id", "player_id", "metric", "value", "data", "evidence"}) for s in signals if s.id in moment.signal_ids],
+        # The lead signal first, then those it absorbed (the moment's own order).
+        "signals": [s.model_dump(mode="json", include={"id", "type", "team_id", "player_id", "metric", "value", "data", "evidence"})
+                    for i in moment.signal_ids for s in signals if s.id == i],
         "score": {"home": score["home"], "away": score["away"], "home_team": info["home"]["id"], "away_team": info["away"]["id"]},
         "names": {k: v for k, v in who.items() if k in involved},
         "metrics": metrics,
@@ -152,6 +159,9 @@ def template_analysis(pack: dict) -> Analysis:
             cause = _error_phrase(error)
             explanation = f"{name.get(error['team_id'], 'The opponents')} gave the ball away with a {cause} by {name.get(error['player_id'] or '', 'a defender')}, and {team} made them pay."
             claims += _error_claims(error, pack)
+        elif t == "big_chance" and shot and shot["outcome"] == "saved":
+            cause = "big chance saved by the goalkeeper"
+            explanation = f"{team} created a clear chance, but the goalkeeper saved it."
         else:
             xg = shot["values"].get("shot.xg") if shot else None
             cause = "clear chance created" if t == "big_chance" else "clear chance converted" if xg is not None and xg >= 0.3 else "low-probability chance"
@@ -163,7 +173,7 @@ def template_analysis(pack: dict) -> Analysis:
         if error:
             cause = _error_phrase(error)
             explanation = f"{name.get(error['player_id'] or '', 'A player')} gave the ball away with a {cause}, and {name.get(shot['team_id'], 'the opponents') if shot else 'the opponents'} got a shot away."
-            claims = _shot_claim(shot, at) + _error_claims(error, pack)
+            claims = _shot_claim(shot, at) + claims + _error_claims(error, pack)
             return Analysis(moment_id=m["moment_id"], cause=cause, explanation=explanation, claims=claims)
     lead = pack["signals"][0] if pack["signals"] else {"data": {}}
     rising = lead["data"].get("after", 0) >= lead["data"].get("before", 0)
diff --git a/services/agents/touchline_agents/personalizer.py b/services/agents/touchline_agents/personalizer.py
index 4bc9d10..92ec960 100644
--- a/services/agents/touchline_agents/personalizer.py
+++ b/services/agents/touchline_agents/personalizer.py
@@ -19,7 +19,7 @@ from .config import Settings
 from .contracts import Claim, Cue, Draft, Moment, Segment, segment_key
 from .llm import agent_options, run_structured, stub_responder
 from .numbers import format_metric, matches, numbers_in
-from .templates import FRAMING, LABELS, NEGATIVE, headline
+from .templates import CONTEXT, FRAMING, LABELS, NEGATIVE, headline, headline_key
 
 LANGS = ("en", "es", "hi")
 
@@ -52,14 +52,20 @@ class Story:
     clock: str
     priority: int
     headlines: dict[str, str]
+    # A sentence of context per language for analyst variants (no digits).
+    contexts: dict[str, str]
     # Casual and analyst slots: moments go to the lower third and the side panel, recaps to recap cards.
     slots: tuple[str, str] = ("lower_third", "side_panel")
 
     @staticmethod
-    def of_moment(m: Moment, cause: str, names: dict[str, str]) -> "Story":
+    def of_moment(m: Moment, cause: str, names: dict[str, str], explanation: str = "") -> "Story":
         d = m.model_dump(mode="json")
+        key = headline_key(d, cause)
+        contexts = {lang: CONTEXT[lang][key] for lang in LANGS}
+        if explanation and not any(ch.isdigit() for ch in explanation):
+            contexts["en"] = explanation
         return Story(m.moment_id, m.match_id, m.type, m.team_id, m.player_id, m.frame_from, m.frame_to, m.match_clock[:5], m.priority,
-                     {lang: headline(d, cause, names, lang) for lang in LANGS})
+                     {lang: headline(d, cause, names, lang) for lang in LANGS}, contexts)
 
 
 class UsedNumber(BaseModel):
@@ -84,8 +90,8 @@ def _quote(c: Claim, lang: str) -> str | None:
 
 
 def template_variant(payload: dict) -> Variant:
-    """The fallback: the template headline in the segment's language, club framing for casual viewers, and the
-    claims as labelled numbers (one for casual, up to three for analyst)."""
+    """The fallback: the template headline in the segment's language, club framing for casual viewers, the claims as
+    labelled numbers (one for casual, up to three for analyst), and a sentence of context for analysts."""
     seg, m, names = payload["segment"], payload["story"], payload["names"]
     lang = seg["lang"]
     head = payload["headline"]
@@ -102,6 +108,8 @@ def template_variant(payload: dict) -> Variant:
         label = LABELS[lang]["score" if c.kind == "score" else c.metric_id]
         parts.append(f"{label}: {q}" + ("।" if lang == "hi" else "."))
         used.append(UsedNumber(claim=i, quote=q))
+    if seg["mode"] == "analyst":
+        parts.append(payload["context"])
     return Variant(headline=head, body=" ".join(parts), numbers=used)
 
 
@@ -140,6 +148,8 @@ def check_variant(v: Variant, payload: dict, others: list[str]) -> list[str]:
             problems.append(f'"{t}" is not one of the verified claims')
     if lang == "hi" and not DEVANAGARI.search(text):
         problems.append("Hindi text must be in Devanagari")
+    if lang != "en" and any(len(s) >= 12 and s in text for s in payload["draft"]):
+        problems.append(f"copies the English draft instead of writing in {lang}")
     for name in others:
         if re.search(rf"\b{re.escape(name)}\b", text):
             problems.append(f"names {name}, who was not involved")
@@ -191,6 +201,7 @@ class Personalizer:
             "segment": segment.model_dump(mode="json"),
             "story": {"template": story.template, "team_id": story.team_id, "player_id": story.player_id, "clock": story.clock},
             "headline": story.headlines[segment.lang],
+            "context": story.contexts[segment.lang],
             "names": names,
             "draft": draft.sentences,
             "claims": [c.model_dump(mode="json") for c in draft.claims if _quote(c, "en") is not None],
diff --git a/services/agents/touchline_agents/recap.py b/services/agents/touchline_agents/recap.py
index 1ca4b66..1384f89 100644
--- a/services/agents/touchline_agents/recap.py
+++ b/services/agents/touchline_agents/recap.py
@@ -16,7 +16,7 @@ from .llm import agent_options, run_structured, stub_responder
 from .numbers import format_metric
 from .personalizer import LANGS, Story
 from .stats import StatsClient, StatsError, names
-from .templates import RECAP_HEADLINES
+from .templates import CONTEXT, RECAP_HEADLINES
 
 TEAM_METRICS = ["team.poss", "shot.xg", "pass.acc", "tilt"]  # all over the match so far by default
 MAX_TURNING_POINTS = 3
@@ -131,7 +131,8 @@ def recap_story(recap: Recap, pack: dict) -> Story:
     s, name = pack["score"], pack["names"]
     home, away = name[s["home_team"]], name[s["away_team"]]
     return Story(recap.recap_id, recap.match_id, "recap", None, recap.player_of_match, recap.at_frame, recap.at_frame, pack["clock"][:5], 1,
-                 {lang: RECAP_HEADLINES[lang][recap.kind].format(home=home, away=away) for lang in LANGS}, ("recap_card", "recap_card"))
+                 {lang: RECAP_HEADLINES[lang][recap.kind].format(home=home, away=away) for lang in LANGS},
+                 {lang: CONTEXT[lang]["recap"] for lang in LANGS}, ("recap_card", "recap_card"))
 
 
 @dataclass(frozen=True)
diff --git a/services/agents/touchline_agents/server.py b/services/agents/touchline_agents/server.py
index c931d44..28f167c 100644
--- a/services/agents/touchline_agents/server.py
+++ b/services/agents/touchline_agents/server.py
@@ -70,6 +70,18 @@ class Sessions:
             entry[0].segments = list(req.segments)
             return entry
 
+    def open_matches(self) -> list[str]:
+        return sorted(self._open)
+
+    async def finish(self, req: RecapRequest) -> None:
+        """After the full-time recap the match is over: close its stats connection and forget its session."""
+        if req.recap != "full_time":
+            return
+        async with self._guard:
+            entry = self._open.pop(req.match_id, None)
+            if entry is not None:
+                await entry[0].close()
+
     async def close(self) -> None:
         for s, _, _ in self._open.values():
             await s.close()
@@ -108,6 +120,8 @@ class TouchlineExecutor(AgentExecutor):
                     await up.add_artifact([new_data_part(dump(r.recap), JSON)], artifact_id=r.recap.recap_id, name="recap", last_chunk=True)
                     for cue in r.cues:
                         await up.add_artifact([new_data_part(dump(cue), JSON)], artifact_id=cue.cue_id, name="cue", last_chunk=True)
+            if isinstance(req, RecapRequest):
+                await self.sessions.finish(req)
         except Exception as e:  # the task fails with the reason; the service keeps serving
             log.exception("%s for %s failed", req.kind, req.match_id)
             await up.failed(new_text_message(f"{req.kind} failed: {type(e).__name__}: {e}", context_id=task.context_id, task_id=task.id))
diff --git a/services/agents/touchline_agents/templates.py b/services/agents/touchline_agents/templates.py
index 6dcb77c..d5be3f7 100644
--- a/services/agents/touchline_agents/templates.py
+++ b/services/agents/touchline_agents/templates.py
@@ -38,6 +38,30 @@ FRAMING: dict[str, tuple[str, str]] = {
 }
 
 
+# One sentence of context per headline key for analyst variants (no digits, no names); English variants use the
+# Analyst's own explanation when it has one.
+CONTEXT: dict[str, dict[str, str]] = {
+    "en": {"goal": "A goal that changes the scoreline.", "costly_error": "An error gave the ball away and the opponents got a shot.",
+           "big_chance": "A clear chance inside the box.", "press_up": "The team push up and press high.", "press_down": "The team stop pressing and drop deeper.",
+           "momentum_swing": "Control of the game has changed sides.", "chaos_spike": "Possession keeps changing hands.", "red": "The team are down to ten.",
+           "yellow": "A caution that limits the player.", "speed_alert": "A sprint at full speed.", "distance_milestone": "A huge physical effort.",
+           "player_milestone": "A standout number for the player.", "difficult_pass_completed": "A low-probability pass that came off.",
+           "substitution_impact": "The changes shifted the balance of play.", "recap": "The match so far, in verified numbers."},
+    "es": {"goal": "Un gol que cambia el marcador.", "costly_error": "Un error regaló la posesión y terminó en disparo rival.",
+           "big_chance": "Una ocasión clara dentro del área.", "press_up": "El equipo adelanta líneas y presiona arriba.", "press_down": "El equipo deja de presionar y se repliega.",
+           "momentum_swing": "El dominio del partido cambia de lado.", "chaos_spike": "La posesión cambia de manos sin parar.", "red": "El equipo se queda con diez.",
+           "yellow": "Una amonestación que condiciona al jugador.", "speed_alert": "Un esprint a máxima velocidad.", "distance_milestone": "Un despliegue físico enorme.",
+           "player_milestone": "Una cifra destacada para el jugador.", "difficult_pass_completed": "Un pase de baja probabilidad que salió bien.",
+           "substitution_impact": "Los cambios alteran el equilibrio del partido.", "recap": "El partido hasta ahora, con datos verificados."},
+    "hi": {"goal": "यह गोल स्कोर बदल देता है।", "costly_error": "एक गलती से गेंद गई और विरोधी को शॉट का मौका मिला।",
+           "big_chance": "बॉक्स के अंदर एक बड़ा मौका।", "press_up": "टीम आगे बढ़कर ऊपर दबाव बना रही है।", "press_down": "टीम पीछे हटकर दबाव कम कर रही है।",
+           "momentum_swing": "खेल का पलड़ा दूसरी ओर झुक गया है।", "chaos_spike": "गेंद लगातार एक टीम से दूसरी टीम में जा रही है।", "red": "टीम अब दस खिलाड़ियों के साथ है।",
+           "yellow": "खिलाड़ी को चेतावनी मिली है।", "speed_alert": "पूरी रफ़्तार से एक स्प्रिंट।", "distance_milestone": "ज़बरदस्त शारीरिक मेहनत।",
+           "player_milestone": "खिलाड़ी के लिए एक खास आंकड़ा।", "difficult_pass_completed": "कम संभावना वाला पास जो सफल रहा।",
+           "substitution_impact": "बदलावों ने खेल का संतुलन बदल दिया।", "recap": "अब तक का मैच, सत्यापित आंकड़ों के साथ।"},
+}
+
+
 def headline_key(moment: dict, cause: str) -> str:
     t = moment["type"]
     if t == "pressure_shift":
diff --git a/services/agents/touchline_agents/workflow.py b/services/agents/touchline_agents/workflow.py
index 5470fdc..128d9b5 100644
--- a/services/agents/touchline_agents/workflow.py
+++ b/services/agents/touchline_agents/workflow.py
@@ -168,7 +168,7 @@ class Personalize(Executor):
         segments = [s for s in self.s.segments if s.mode == self.mode]
         names = n.pack["names"]
         others = other_names(await self.s.stats.roster(), set(names))
-        story = Story.of_moment(n.job.moment, n.analysis.cause, names)
+        story = Story.of_moment(n.job.moment, n.analysis.cause, names, n.analysis.explanation)
         evidence = list(dict.fromkeys(e for s in n.job.signals if s.id in n.job.moment.signal_ids for e in s.evidence))
         out = await self.s.agents.personalizer.fan_out(story, v.published, names, segments, others, evidence) if segments else []
         await ctx.send_message(Variants(v, self.mode, [p.cue for p in out], any(p.fallback for p in out), _ms(t0)))
PATCH
```

- [ ] **Step 5: Run the tests**

Run: `uv run --project services/agents pytest -q services/agents`
Expected: 144 passed, 7 deselected

Run: `pnpm turbo run typecheck test --force`
Expected: every task successful (the gateway's end-to-end test runs the agent service from this commit)

- [ ] **Step 6: Run the CI suite (stub model)**

In one shell start the agent service on the stub; in another run the suite:

```bash
uv run --project services/agents touchline-agents --port 8100
uv run --project services/agents touchline-eval suite --suite ci --out out/eval-ci --json out/eval-ci/scores.json
```

Expected (about 80 s, deterministic):

| Run | Moments | Moment recall | Moment precision | Explanation accuracy | Evidence correctness | Grounding (first draft) | Grounding (published) | Decision feedback | Persona separation |
|---|---|---|---|---|---|---|---|---|---|
| eval-late_comeback-1 | 37 | 100 % | 100 % | 100 % | 100 % | 100 % | 100 % | – | 100 % |
| eval-red_card_collapse-1 | 28 | 100 % | 100 % | 100 % | 100 % | 100 % | 100 % | – | 100 % |
| eval-keeper_heroics-1 | 32 | 100 % | 100 % | 80 % | 100 % | 100 % | 100 % | 100 % | 100 % |
| eval-costly_error-1 | 27 | 67 % | 100 % | 100 % | 100 % | 100 % | 100 % | – | 100 % |
| eval-high_press_vs_low_block-1 | 33 | 100 % | 100 % | 80 % | 80 % | 100 % | 100 % | 100 % | 100 % |
| eval-even_contest-1 | 37 | 100 % | 100 % | 100 % | 100 % | 100 % | 100 % | – | 100 % |
| **All (6 runs)** | 194 | **94 %** | **100 %** | **88 %** | **94 %** | **100 %** | **100 %** | **100 %** | **100 %** |

The remaining misses are honest:
- A defensive error that led to nothing is not a moment.
- A merged moment explains only its lead error.
- A big chance the keeper did not save cannot credit him.

Copy the report: `mkdir -p docs/evals && cp out/eval-ci/report.md docs/evals/agent-eval-ci.md`.

- [ ] **Step 7: Run one match on the real model and judge it**

This needs the key in `.env.local`. It makes about 200 model calls, takes about 14 minutes, and the LLM judge adds a few calls. Stop the stub service, then:

```bash
TOUCHLINE_LLM=openai TOUCHLINE_TIMEOUT_SCALE=6 uv run --project services/agents touchline-agents --port 8100 &
mkdir -p out/eval-live && cp -r out/eval-ci/eval-costly_error-1 out/eval-live/ && rm -rf out/eval-live/eval-costly_error-1/agents
pnpm agents --run out/eval-live/eval-costly_error-1 --segments casual.en.neutral,analyst.en.neutral,casual.es.neutral,analyst.hi.neutral
TOUCHLINE_LLM=openai uv run --project services/agents touchline-eval score out/eval-live/eval-costly_error-1 --judge --out docs/evals/agent-eval-live-2026-10-07.md
```

Expected (model output varies from run to run; these are the prototype's):

| Run | Moments | Moment recall | Moment precision | Explanation accuracy | Evidence correctness | Grounding (first draft) | Grounding (published) | Decision feedback | Persona separation |
|---|---|---|---|---|---|---|---|---|---|
| eval-costly_error-1 | 23 | 67 % | 100 % | 100 % | 100 % | 100 % | 100 % | 83 % | 100 % |
| **All (1 runs)** | 23 | **67 %** | **100 %** | **100 %** | **100 %** | **100 %** | **100 %** | **83 %** | **100 %** |

In the prototype's live run:
- **Volume:** 68 requests, all answered; 23 moments; 100 cues in four segments.
- **Fact-checking:** every first draft passed the Fact-Checker, with 9 of 9 numeric claims verified. The real model states fewer numbers than the templates.
- **Robustness:** no agent fell back; no late or unverified cues.
- **Latency:** request p50 3.5 s, p95 33 s.
- **Judge variance:** the LLM judge gave explanation accuracy 50 % once and 100 % twice on the same two explanations, and the keyword rubric agrees with 100 %. Report the judge's majority over three runs.
- **Recall** is 67 % for the same reason as on the stub: the scripted defensive error led to nothing.
- **Decision feedback** is 83 %: one better option the Analyst named was not the decision record's first choice.

- [ ] **Step 8: Document it**

Apply this change to `README.md` (from the repository root):

````bash
git apply <<'PATCH'
diff --git a/README.md b/README.md
index f677c3a..74baef2 100644
--- a/README.md
+++ b/README.md
@@ -66,17 +66,37 @@ pnpm -s mcp-stats --run out/m-7 --http 8787     # Streamable HTTP at http://127.
 
 An MCP client can launch it directly, for example: `{"command": "npx", "args": ["tsx", "packages/mcp-stats/src/cli.ts", "--run", "out/m-7"]}`.
 
+## Agents
+
+Six Microsoft Agent Framework agents in one workflow graph (`services/agents`, Python 3.12, spec §5.3): the Moment Detector promotes signals to moments, the Tactical Analyst explains them from MCP evidence, the Narrator writes the English draft with every number declared, the Fact-Checker checks every number, name and comparison against the stats server (one retry, then unverified sentences are dropped), the Personalizer writes each viewer segment's cue natively in English, Spanish or Hindi from verified claims only, and the Recap Producer writes half-time and full-time recaps. Every agent has a deterministic fallback. The service speaks A2A v1.0; `packages/agent-gateway` (Effect) sends it a match's signals and keeps the verified cues.
+
+Models: OpenAI `gpt-6.1-sol` for both tiers (set in `services/agents/touchline_agents/config.py`; override with `TOUCHLINE_MODEL_SMALL` / `TOUCHLINE_MODEL_LARGE`). Put the key in the repo's git-ignored `.env.local` as `OPENAI_API_KEY=...`; tests and CI use a deterministic stub and never call a model.
+
+```bash
+uv run --project services/agents touchline-agents                     # the agent service on http://127.0.0.1:8100/ (stub model)
+TOUCHLINE_LLM=openai TOUCHLINE_TIMEOUT_SCALE=6 uv run --project services/agents touchline-agents   # real models, recorded-run timeouts
+pnpm agents --run out/m-7 --segments casual.en.neutral,analyst.es.ironmoor   # cues, traces and recaps cached in out/m-7/agents/
+uv run --project services/agents touchline-eval suite --suite ci            # score the agents on six scripted matches (spec §5.3.1)
+uv run --project services/agents pytest -m live                             # the few tests that call the real model
+```
+
+A real model takes about 5 s per call, so a moment takes about 30 s end to end: real-model runs are recorded runs (the cached cues replay against the match; spec §6), and a live run with `--budget-ms 4000` falls back to templates wherever a model is late.
+
+Known limits: the Fact-Checker rejects rostered players who were not in the play, but not a name that is outside the roster altogether; Hindi is checked for Devanagari and Spanish only for not copying the English draft, so fluency needs a human spot-check; checkpoints are written after every step but a restarted service starts each match afresh.
+
 ## Packages
 
 | Package | What it does |
 |---|---|
 | `packages/sim-core` | The match engine: one pure, deterministic `step(state)` per 0.1 s tick; pitch control; what-if forks |
 | `packages/league` | Fictional league generator: 8 clubs, kits, styles, 160 players |
-| `packages/schema` | Effect Schema for the live domain stream (events and frames) and for signals and metric ids |
+| `packages/schema` | Effect Schema for the domain stream, signals, metric ids and the agent contracts (exported as JSON Schema for the Python side) |
 | `packages/sim` | Effect streams, CDF v0.3.2 writers, run manifest, CLI |
 | `packages/stats` | Stats engine: metrics and signals on the domain stream, replay of run folders, `pnpm stats` |
 | `packages/advisor` | What-if sessions rebuilt from run folders, better-option explainer, positioning advisor |
 | `packages/mcp-stats` | MCP server exposing the stats tools to agents (stdio or Streamable HTTP) |
+| `packages/agent-gateway` | A2A client of the agent service: signal batches, recaps, time budget, retry, circuit breaker, cue cache |
+| `services/agents` | The six agents, their workflow, the A2A server and the ground-truth evaluation harness (`evals/`) |
 | `packages/calibrate` | Match statistics (identical to the Python definitions), tuning knobs, tuner, realism gate |
 | `python/analytics` | CDF validation, IDSSE download, real-match targets, realism report, stats-model fitting |
 
@@ -86,4 +106,6 @@ The engine runs a full match in about 2 s and its output passes the CDF validato
 
 The realism gate (`packages/calibrate/test/realism-gate.test.ts`) runs 16 more held-out matches (seeds 3000–3015). It fails if any statistic moves more than 3.5 standard errors from the committed baseline, or drifts away from the real targets. After an intended engine change, re-run calibration, the realism report and the baseline refresh, and commit all three.
 
+The agents are scored against the scripted ground truth in each run's manifest (`docs/evals/`): with the stub model, six scripted matches give moment recall 94 %, precision 100 %, explanation accuracy 88 %, evidence correctness 94 %, grounding 100 % and persona separation 100 % (`touchline-eval suite --suite ci`). On one scripted match with `gpt-6.1-sol` (23 moments, 100 cues in four segments, 14 minutes, about 200 model calls), every first draft passed the Fact-Checker with all its claims verified, no agent fell back, explanation accuracy was 100 % by the LLM judge (one of three judge runs gave 50 %: the judge varies), decision feedback 83 % and persona separation 100 %; recall was 67 % because the scripted defensive error led to nothing (`docs/evals/agent-eval-live-2026-10-07.md`).
+
 See `ATTRIBUTION.md` for credits and `docs/superpowers/` for the spec and plans.
PATCH
````

- [ ] **Step 9: Commit**

```bash
git add services/agents docs/evals README.md
git commit -m "feat(agents): ground-truth evaluation harness (recall, precision, explanation accuracy with LLM judge or keyword rubric, evidence, grounding, decision feedback, persona separation) with a CI suite; fixes it found; finished matches release their sessions

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```



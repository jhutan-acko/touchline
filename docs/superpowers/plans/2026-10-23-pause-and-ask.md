# Pause and Ask Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A viewer freezes their own picture, asks the match a question in EN/ES/HI, watches a visible agent team answer with fact-checked evidence and a spoiler-free re-simulated "Show me". Smart overlays pinned to players sit on the stream and open Ask with one tap.

**Architecture:** The API orchestrates an Ask in this order:
1. Frame summary, built in the what-if worker.
2. Question agent, a new A2A skill `ask` with kind `ask_intent`.
3. What-if at any frame, in the worker. This is the only re-simulation.
4. Answer team, `ask_answer`: analyst, then rule-based fact-check, then personaliser. Stage artifacts stream back as the work proceeds.

Every step is relayed to the browser as an `AskUpdate` stream. Overlays switch from wall-clock to frame anchoring, and `pitch_marker` cues are rendered in the 3D scene.

**Tech Stack:** TS + Effect 4 (schema, RPC), vitest, React + R3F (apps/web), Python MAF agents (services/agents, pytest, uv), A2A, MCP stats server.

**Spec:** `docs/superpowers/specs/2026-10-22-pause-and-ask-design.md` (approved 2026-10-23).

**Base branch:** cut `pause-and-ask` from `realism-v2-p6` (3b2c86f). P6 moved API fixture seeds and what-if windows, so branching from main would conflict. Rebase onto main once P6 merges.

## Global Constraints

- The engine is frozen. Make no edits under `packages/sim-core/src`, `packages/calibrate`, or `data/params`. Use `forkState`, `applyIntervention`, `playAheadFrames`, `whatIf` and `outcomeOf` from sim-core, and advisor `Session.stateAt`, as they are.
- The gate is never widened and tests are never loosened. Existing tests stay green unchanged, except the tests rewritten in Task 6 for frame anchoring.
- No spoilers. Nothing shown or stated may come from after the paused frame `F`:
  - real clip frames must satisfy `frame ≤ F`;
  - agent claims must satisfy `at_frame ≤ F`;
  - the frame summary's `recent` holds only events with frame `≤ F`.
- The re-simulation is single-source. Only `computeAskClip` (Task 2) runs seeds. The analyst receives its numbers and never calls MCP `what_if` or `explain_pass` in Ask.
- Verdict rule: `clearlyBetter(diff, seeds, 1)` from `packages/advisor/src/verdict.ts`, unchanged, with the alternative compared against the `none` arm over the same seeds.
  - `played_pass_was_best` when the reverse holds: the played action's lead over the alternative is itself `clearlyBetter`.
  - `not_verified` otherwise, including fewer than `MIN_VERDICT_SEEDS` applied seeds.
  - The UI words them as "the alternative was better" / "what he did was as good or better" / "too close to call".
- Ask constants: `ASK_SEEDS = 20`, `ASK_HORIZON_S = 10`, clip lead-in `CLIP_BEFORE_S = 2` (reuse advisor's), worker timeout `WHATIF_TIMEOUT_MS` (10 000).
- Models:
  - question agent and Ask personaliser use tier `"fast"` (env `TOUCHLINE_MODEL_FAST`, default `"gpt-5.4-mini"`);
  - analyst uses `"large"`;
  - fact-check is rule-based, with no LLM extraction.
- New timeouts in `TIMEOUTS_S`: `question: 4`, `ask_analyst: 8`, `ask_personalizer: 4` (all scaled by `TOUCHLINE_TIMEOUT_SCALE` like the others).
- Every stage is deterministic under `TOUCHLINE_LLM=stub`. Tests use the stub; real-model checks are `-m live` only.
- Languages: EN, ES, HI. Every new UI string goes in `apps/web/src/i18n.ts` for all three, and every API-generated chip text in `apps/api/src/suggest.ts` for all three.
- Pitch-marker cue convention, shared by the Python writer (Task 5) and the web reader (Task 6):
  - `display.slot = "pitch_marker"`;
  - `display.template ∈ {"pressure_ring","pass_arc","ghost"}`;
  - player references are `data` keys with value 1: `at:<player_id>` (ring or ghost anchor), `from:<player_id>` and `to:<player_id>` (arc ends);
  - numbers go in `data`: `count` (pressers), `x`, `y` (ghost point, pitch metres, the same frame as `PitchFrame`).
- The live pipeline is untouched. Ask runs on its own path and never shares the live 250 ms / 4 s budget, the live companion's mcp server, or `exchange()`.
- CPU rule: implementers run only their own test files, single-threaded (`--no-file-parallelism`). The controller runs the full suite once per merge with `pnpm exec turbo run test --concurrency=1 -- --no-file-parallelism`.
- Never commit `data/raw`. Never print or commit `.env.local`. Commit trailer: `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

1. **A paused frame ahead of what the server has played,** or an old frame after a long pause. Ask must answer for `F ≤` the session's playback frame and fail with `bad_frame` beyond it. Clips and claims never pass `F`. Tests are in Task 2 (clip cut at `F`) and Task 8 (`bad_frame`).
2. **Agent service down, or timing out mid-answer.** The stream ends with a `failed` update (`offline` / `timeout`), the panel says the analysts are offline, and the live cue pipeline is unaffected. Tests are in Task 8 (failing Sender) and Task 7 (panel copy).
3. **A dead-ball frame (no ball holder), or a question naming an opponent, an unknown player, or a receiver on the other team.** These give an `unsupported` intent with a reason in the viewer's language. Holder-based chips are skipped. Tests are in Task 2 (`suggestChips` with no holder) and Task 3 (validation).
4. **Double-tapping a chip, or asking again before the first answer arrives.** The newer ask supersedes: the client stops the old stream, and the session's Ask mcp server starts once. Tests are in Task 8 (one mcp start for two asks) and Task 7 (old stream stopped).
5. **New cues arriving while frozen, or resuming with the panel open.** Overlays stay as they were at the frozen frame. Resume closes the panel and jumps to live. Tests are in Task 6 (frozen overlays) and Task 7 (resume closes the panel).

## Waves

- **W1:** Task 1, contracts. It is small; every other task depends on it.
- **W2, in parallel:** Task 2 (API what-if and summary), Task 3 (question agent), Task 4 (answer team), Task 5 (markers), Task 6 (web freeze and anchoring).
- **W3, in parallel:** Task 7 (web Ask panel), Task 8 (API Ask orchestration).
- **W4:** Task 9, the demo cache, end to end, and the live smoke test.

---

### Task 1: Ask contracts

**Files:**
- Modify: `packages/schema/src/agents.ts`. Add the types below, add the two requests to the `AgentRequest` union (`:193`), add artifacts to `ARTIFACTS` (`:199`) and to `AgentContracts` (`:202`), and add `"what_if"` to `ClaimKind` (`:63`).
- Modify: `packages/rpc/src/contracts.ts`. Add the RPC types and the three RPCs to `TouchlineRpcs` (`:249`).
- Regenerate: `packages/schema/json/agent-contracts.schema.json` and `services/agents/touchline_agents/contracts_gen.py` (`pnpm --filter @touchline/schema json`, then `uv run --project services/agents python services/agents/scripts/gen_contracts.py`). Re-export the new models in `contracts.py`.
- Create: fixtures `packages/schema/fixtures/agents/valid/ask-intent-request.json`, `ask-answer-request.json`, `ask-intent.json`, `ask-stage.json`, `ask-reply.json`, and `invalid/ask-intent-bad-kind.json`.
- Test: `packages/schema/test/*` (the existing fixture-driven test), `packages/rpc/test/contracts.test.ts`, `services/agents/tests/test_contracts.py`.

**Interfaces:**

Produces, in `@touchline/schema`:

```ts
export const AskStageName = Schema.Literals(["question", "analyst", "whatif", "factcheck", "personalise"])
export const AskVerdict = Schema.Literals(["played_pass_was_best", "better_option_found", "not_verified"])
export const AskInterventionSpec = Schema.Union([
  Schema.Struct({ kind: Schema.Literal("pass_to"), player_id: Id, receiver_id: Id }),
  Schema.Struct({ kind: Schema.Literal("move_player"), player_id: Id, to: Schema.Struct({ x: Schema.Finite, y: Schema.Finite }) })
])
export const AskIntent = Schema.Struct({
  kind: Schema.Literals(["explain", "what_if", "unsupported"]),
  subject_id: Schema.NullOr(Id),
  /** A past pass (in summary.recent) the what-if replays from; null forks at the paused frame. */
  fork_event_id: Schema.NullOr(Id),
  intervention: Schema.NullOr(AskInterventionSpec),   // non-null iff kind = what_if
  reason: Schema.NullOr(Schema.String)                // non-null iff kind = unsupported; in the viewer's language
})
export const FrameSummary = Schema.Struct({
  match_id: Id, frame: NonNegInt, clock: Schema.String,
  ball_holder: Schema.NullOr(Id), side_in_possession: Schema.NullOr(Schema.Literals(["home", "away"])),
  players: Schema.Array(Schema.Struct({ id: Id, name: Schema.String, side: Schema.Literals(["home", "away"]), role: Schema.String, x: Schema.Finite, y: Schema.Finite })),
  /** The holder's options, best first (sim-core passOptions), at most 5. */
  pass_options: Schema.Array(Schema.Struct({ receiver_id: Id, xpass: Schema.Finite, value: Schema.Finite })),
  /** Opponents within 5 m of the ball holder. */
  pressers: Schema.Array(Id),
  /** Events in the 10 s up to and including `frame`, newest first. */
  recent: Schema.Array(Schema.Struct({ event_id: Id, frame: NonNegInt, type: Schema.String, player_id: Schema.NullOr(Id), receiver_id: Schema.NullOr(Id) }))
})
export const AskArms = Schema.Struct({ played: NonNegInt, alt: NonNegInt })
export const AskWhatIf = Schema.Struct({
  intervention: AskInterventionSpec, fork_frame: NonNegInt, verdict: AskVerdict, seeds: NonNegInt,
  shots: AskArms, goals: AskArms, gain: Schema.Struct({ mean: Schema.Finite, se: Schema.Finite })
})
export const AskIntentRequest = Schema.Struct({ kind: Schema.Literal("ask_intent"), question: Schema.String, lang: Lang, summary: FrameSummary })
export const AskAnswerRequest = Schema.Struct({
  kind: Schema.Literal("ask_answer"), match_id: Id, mcp_url: Schema.String, at_frame: NonNegInt,
  question: Schema.String, segment: Segment, intent: AskIntent, summary: FrameSummary, what_if: Schema.NullOr(AskWhatIf)
})
export const AskStage = Schema.Struct({ stage: AskStageName, status: Schema.String })
export const EvidenceChip = Schema.Struct({ label: Schema.String, value: Schema.String, source: Schema.Literals(["stats", "what_if", "event"]) })
export const AskReply = Schema.Struct({
  headline: Schema.String, body: Schema.String,
  chips: Schema.Array(EvidenceChip).check(Schema.isMaxLength(4)),
  verified: Schema.Boolean, model: Schema.NullOr(Schema.String)
})
```

The artifact names are `"ask_intent"` (an `AskIntent`), `"ask_stage"` (an `AskStage`) and `"ask_reply"` (an `AskReply`).

Produces, in `@touchline/rpc`:

```ts
export const QuestionChip = Schema.Struct({ chip_id: Id, text: Schema.String, intent: AskIntent })
export const AskClip = Schema.Struct({
  clip_id: Id, fork_frame: Count, paused_frame: Count, fps: Schema.Int, intervention: AskInterventionSpec, verdict: PassVerdict,
  /** Frames fork − CLIP_BEFORE_S … paused_frame (never later). */
  real: Schema.Array(PitchFrame),
  /** Frames fork − CLIP_BEFORE_S … fork + horizon of the typical seed; null when the intervention could not be applied. */
  variant: Schema.NullOr(Schema.Array(PitchFrame)),
  seeds: Count, horizon_s: Schema.Finite, typical_seed: Schema.NullOr(Count),
  shots: Schema.NullOr(AskArms), goals: Schema.NullOr(AskArms), gain: Schema.NullOr(Schema.Struct({ mean: Schema.Finite, se: Schema.Finite }))
})
export const AskAnswer = Schema.Struct({ ...AskReply.fields, ask_id: Id, frame: Count, clip_id: Schema.NullOr(Id), verdict: Schema.NullOr(PassVerdict), cached: Schema.Boolean })
export const AskUpdate = Schema.Union([
  Schema.Struct({ kind: Schema.Literal("stage"), stage: AskStage }),
  Schema.Struct({ kind: Schema.Literal("answer"), answer: AskAnswer }),
  Schema.Struct({ kind: Schema.Literal("failed"), reason: Schema.Literals(["offline", "timeout", "bad_frame"]), message: Schema.String })
])
export class AskNotAvailable extends Schema.TaggedError<AskNotAvailable>()("AskNotAvailable", { reason: Schema.String }) {}
// In TouchlineRpcs:
Rpc.make("SuggestQuestions", { payload: { session_id: Schema.String, frame: Count, lang: Lang }, success: Schema.Array(QuestionChip), error: Schema.Union([SessionNotFound, AskNotAvailable]) }),
Rpc.make("Ask", { payload: { session_id: Schema.String, frame: Count, question: Schema.String, chip_id: Schema.NullOr(Schema.String), segment: Segment }, success: AskUpdate, error: SessionNotFound, stream: true }),
Rpc.make("GetAskClip", { payload: { session_id: Schema.String, clip_id: Schema.String }, success: AskClip, error: Schema.Union([SessionNotFound, AskNotAvailable]) })
```

- [ ] **Step 1: Write the fixtures and failing tests.**
  - Add the valid and invalid fixtures above, each a `{contract, value}` pair. The `ask-answer-request` uses a `what_if` with verdict `better_option_found`.
  - In `contracts.test.ts`, add `it("decodes every AskUpdate kind")`. It round-trips one `stage`, one `answer` (with `clip_id` null and `cached` false) and one `failed` (`bad_frame`).
- [ ] **Step 2: Run the tests and see them fail.** Run `pnpm --filter @touchline/schema test` and `pnpm --filter @touchline/rpc test`. Expected: FAIL (unknown contract or export).
- [ ] **Step 3: Add the schema types, the RPC types and the RPCs as above. Regenerate the JSON schema and the Python contracts.**
- [ ] **Step 4: Run the tests and see them pass.**
  - `pnpm --filter @touchline/schema test`, `pnpm --filter @touchline/rpc test`, `pnpm --filter @touchline/schema typecheck`, `pnpm --filter @touchline/rpc typecheck`
  - `uv run --project services/agents pytest services/agents/tests/test_contracts.py`

  Expected: PASS. The drift test confirms the generated Python matches.
- [ ] **Step 5: Stub the three RPCs in `apps/api/src/server.ts` with `AskNotAvailable({reason:"not implemented"})` (or an empty stream for `Ask`) so `apps/api` typechecks. Task 8 replaces them.**
- [ ] **Step 6: Commit** with `feat(contracts): Ask, SuggestQuestions, GetAskClip; ask_intent/ask_answer agent contracts`.

---

### Task 2: Frame summary, chips and the what-if at any frame (API)

**Files:**
- Create: `apps/api/src/askframe.ts`, `apps/api/src/askclip.ts`, `apps/api/src/suggest.ts`
- Modify: `apps/api/src/whatif.ts`. Extend `WorkerJob` (`:149`) with the two new job kinds and add `summaryInWorker` and `askClipInWorker` beside `computeInWorker` (`:152`).
- Modify: `apps/api/src/whatif-worker.ts`. Add the `summary` and `ask_clip` cases.
- Test: `apps/api/test/askclip.test.ts`, `apps/api/test/suggest.test.ts`. Use `makeLibrary()` from `test/fixture.ts`.

**Interfaces:**
- Consumes:
  - advisor `Session.fromRun`, `Session.stateAt(tick)`, `Session.event(id)`;
  - the `rebuild(dir)` pattern in `whatif.ts:41`;
  - sim-core `passOptions`, `forkState`, `applyIntervention`, `playAheadFrames`, `outcomeOf`, `whatIf`;
  - advisor `clearlyBetter`, `MIN_VERDICT_SEEDS`, `xtEndValue`, `typicalIndex`, `CLIP_BEFORE_S`;
  - `toPitchFrame` (`whatif.ts:31`);
  - Task 1 types.
- Produces:
  - `frameSummary(session: AdvisorSession, matchId: string, frame: number): FrameSummary` in `askframe.ts`;
  - `computeAskClip(dir: string, req: { forkFrame: number; pausedFrame: number; intervention: AskInterventionSpec }): AskClip` in `askclip.ts`. `clip_id = "${forkFrame}-${pausedFrame}-${hash of intervention}"`, so it is deterministic;
  - `askWhatIfOf(clip: AskClip): AskWhatIf | null`, which projects a clip to the agent input and returns null when `variant` is null;
  - `forkFrameOf(summary: FrameSummary, intent: AskIntent): number`. It returns the frame of `intent.fork_event_id` when that event is in `summary.recent`, else `summary.frame`;
  - `suggestChips(summary: FrameSummary, lang: Lang): QuestionChip[]` in `suggest.ts`;
  - `summaryInWorker(dir, frame, timeoutMs): Promise<FrameSummary>` and `askClipInWorker(dir, req, timeoutMs): Promise<AskClip>` in `whatif.ts`.

`suggestChips` rules: deterministic, at most 4, in this order, each skipped when its condition fails. `chip_id = "${frame}:${slug}"`.

| slug | condition | intent |
|---|---|---|
| `why_not_pass` | the newest `pass` in `recent` by the possessing side has a better option (re-scored at that pass's frame, a different receiver with higher `value`) | `what_if` / `pass_to` best receiver, `fork_event_id` = that pass |
| `what_if_pass` | `ball_holder` non-null and `pass_options.length ≥ 1` | `what_if` / `pass_to` `pass_options[0]`, fork at the paused frame |
| `pressers` | `pressers.length ≥ 2` | `explain`, `subject_id` = holder |
| `plan` | always | `explain`, `subject_id` null |

The EN texts are "Why didn't {passer} pass to {receiver}?", "What if {holder} passed to {receiver}?", "Who's pressing {holder}?" and "What are {team} trying to do here?". The builder writes the ES and HI equivalents in the same file.

- [ ] **Step 1: Write failing tests.**
  - `askclip.test.ts`:
    - `it("never shows real frames after the paused frame")`: pick the first `pass` event `p` in the fixture with `p.frame + 100` before the end, and set `forkFrame = p.frame`, `pausedFrame = p.frame + 50`. Expect `clip.real.at(-1)!.frame ≤ pausedFrame` and `clip.real[0]!.frame === forkFrame − CLIP_BEFORE_S*fps`.
    - `it("runs ASK_SEEDS seeds and gives a verdict by the shared rule")`: `pass_to` the second option at `forkFrame`. Expect `clip.seeds === 20`, `clip.verdict` among the three literals, and that `clip.verdict === "better_option_found"` implies `clip.gain!.mean ≥ MIN_GAIN`.
    - `it("is deterministic")`: run twice and `toEqual`.
    - `it("returns variant null for an intervention that cannot apply")`: `pass_to` with a receiver on the other side. Expect `variant` null and `verdict` `not_verified`.
    - `it("summarises only what has happened by the frame")`: `frameSummary` at frame F has every `recent[i].frame ≤ F`, ≤ 5 `pass_options`, and `pressers` all opponents of the holder.
  - `suggest.test.ts`:
    - `it("offers no holder chips at a dead ball")`: `ball_holder` null gives only `plan` (and `why_not_pass` if applicable).
    - `it("is stable and in the viewer's language")`: the same input gives the same chips; the `hi` texts differ from the `en` ones and contain the player names.
    - `it("caps at four")`.
- [ ] **Step 2: Run the tests and see them fail.** Run `cd apps/api && npx vitest run test/askclip.test.ts test/suggest.test.ts --no-file-parallelism`. Expected: FAIL (modules missing).
- [ ] **Step 3: Implement `askframe.ts`, `askclip.ts`, `suggest.ts` and the two worker job kinds.**
  - Use the same frame↔tick mapping `whatif.ts` and the advisor use.
  - Run the `none` and alternative arms through `whatIf(..., {seeds: ASK_SEEDS, horizonS: ASK_HORIZON_S, endValue: xtEndValue(xt), baseline})`, as `explainPass` does.
  - Choose the typical seed with `typicalIndex`.
- [ ] **Step 4: Run the tests and see them pass.** Use the same command, then `pnpm --filter @touchline/api typecheck`. Expected: PASS.
- [ ] **Step 5: Commit** with `feat(api): frame summary, suggested questions and spoiler-free what-if at any frame`.

---

### Task 3: Question agent and the `ask` skill (intent)

**Files:**
- Create: `services/agents/touchline_agents/question.py`
- Modify: `services/agents/touchline_agents/config.py`. Add `"fast"` to `Tier`, `TOUCHLINE_MODEL_FAST` (default `"gpt-5.4-mini"`) and the three timeouts.
- Modify: `services/agents/touchline_agents/llm.py`. `make_client(settings, "fast")` must work.
- Modify: `services/agents/touchline_agents/server.py`. Add the AgentCard skill `AgentSkill(id="ask", name="Ask the match", description="A viewer's question about a paused frame: intent, then a fact-checked, personalised answer with re-simulated evidence.")`, and dispatch `AskIntentRequest`, which emits one `"ask_intent"` artifact.
- Test: `services/agents/tests/test_question.py`, plus a case in `tests/test_server.py`.

**Interfaces:**
- Consumes: Task 1 `AskIntentRequest`, `AskIntent`, `FrameSummary`; `run_structured`, `stub_responder`, `make_client`.
- Produces:
  - `class QuestionAgent(client, settings)` with `async parse(req: AskIntentRequest) -> AskIntent`, which never raises;
  - `rule_intent(req: AskIntentRequest) -> AskIntent`, the deterministic fallback. It is also the stub responder, `@stub_responder("ask_intent")`;
  - `validate_intent(intent: AskIntent, summary: FrameSummary, lang) -> AskIntent`. It turns an invalid intent into `unsupported` with a reason in `lang`. An intent is invalid when:
    - an id is not in `summary.players`;
    - `pass_to` names a receiver on the other side from the player, or names the player themselves;
    - `fork_event_id` is not in `summary.recent`;
    - a what-if asks for a shot, dribble or run (no such intervention exists).

  `rule_intent` keywords: what-if markers `what if` / `qué pasa si` / `y si` / `अगर`; "why not pass" markers `why didn't` / `por qué no` / `क्यों नहीं`; plus player names or surnames found in the text. With no player named, `subject_id` = `ball_holder`.

- [ ] **Step 1: Write failing tests.**
  - `test_rule_intent_what_if_pass_en`: "What if Okafor passed to Diallo?" (with both names in the summary) gives `what_if`, `pass_to`, `player_id` = Okafor's id, `receiver_id` = Diallo's.
  - `test_rule_intent_hindi`: "अगर Okafor ने Diallo को पास दिया होता?" gives the same intent.
  - `test_unknown_player_is_unsupported`: "What if Smith passed to Diallo?" gives `unsupported` with a non-empty `reason`.
  - `test_receiver_on_other_side_is_unsupported`.
  - `test_shot_what_if_is_unsupported_with_reason_in_lang`: "¿Y si hubiera tirado?" with lang `es` gives `unsupported` and a Spanish `reason`.
  - `test_parse_falls_back_on_garbage`: `QuestionAgent(StubChatClient("garbage"), s).parse(req) == rule_intent(req)`.
  - `test_fast_tier_model`: `Settings.model("fast") == "gpt-5.4-mini"` by default.
  - In `test_server.py`, `test_ask_intent_artifact`: sending an `ask_intent` request returns one `ask_intent` artifact that decodes as `AskIntent`.
- [ ] **Step 2: Run the tests and see them fail.** Run `uv run --project services/agents pytest services/agents/tests/test_question.py services/agents/tests/test_server.py -p no:xdist`. Expected: FAIL.
- [ ] **Step 3: Implement `question.py`, the config and llm `"fast"` tier, and the server dispatch.** The LLM output is validated by `validate_intent` before it is returned.
- [ ] **Step 4: Run the tests and see them pass.** Expected: PASS.
- [ ] **Step 5: Commit** with `feat(agents): question agent and ask skill (intent), fast model tier`.

---

### Task 4: Answer team (analyst, fact-check, personalise) with stage artifacts

**Files:**
- Create: `services/agents/touchline_agents/ask_answer.py`
- Modify: `services/agents/touchline_agents/factchecker.py`. Add `check_whatif_claim`.
- Modify: `services/agents/touchline_agents/server.py`. Dispatch `AskAnswerRequest`: open a stats client on `req.mcp_url` the way `MatchSession.open` does, stream an `"ask_stage"` artifact for each stage, then one `"ask_reply"`. If Task 3 has not merged yet, add only this branch. The merge conflict is trivial.
- Test: `services/agents/tests/test_ask_answer.py`, plus a case in `tests/test_server.py`.

**Interfaces:**
- Consumes:
  - Task 1 `AskAnswerRequest`, `AskReply`, `AskStage`, `AskWhatIf`, `ClaimKind "what_if"`;
  - analyst `capped_tools(stats, latest)`;
  - `FactChecker.check_claim(stats, c, lang, latest, clock)`;
  - `Personalizer` templates and checks;
  - `make_client(settings, "large" | "fast")`.
- Produces:
  - `class AskTeam(large_client, fast_client, settings)` with `async answer(req: AskAnswerRequest, stats, emit: Callable[[AskStage], Awaitable[None]]) -> AskReply`, which never raises;
  - `check_whatif_claim(c: Claim, w: AskWhatIf | None) -> bool` in `factchecker.py`.

  For a what-if claim, `c.kind == "what_if"`, and `c.metric_id` is null. The quantity is named in `c.subject`, one of `shots_played`, `shots_alt`, `goals_played`, `goals_alt`, `seeds`, `gain`. The claim is true when `c.value` equals that number. Counts must be exact; `gain` must be within 0.005. With `w` None the claim is false.
- Behaviour, in order:
  1. Emit `analyst`. If `intent.kind == "unsupported"`, skip to step 4 with headline = `intent.reason`, an empty body, no chips, and `verified=True`.
  2. The analyst drafts a headline, body and claims using `capped_tools(stats, latest=req.at_frame)`, with the advisor tools (`what_if`, `explain_pass`, `suggest_position`) removed. Its input carries `req.what_if` numbers verbatim.
  3. Emit `factcheck`. Check every claim: stats claims with `check_claim(..., latest=req.at_frame, ...)`, what-if claims with `check_whatif_claim`. On any failure, retry the draft once, giving it the failing claims. After the retry, drop sentences carrying failed claims. `verified` = every remaining claim passed and at least one claim remains, or the intent is `unsupported`.
  4. Emit `personalise`. The fast client rewrites for `segment.mode`: casual means headline plus ≤ 1 sentence; analyst means headline plus ≤ 3 sentences. It writes in `segment.lang` and keeps every checked number unchanged, which is verified with the personaliser's existing variant checks; on failure it falls back to a template. Chips are built from the passed claims: at most 4, with `source` `what_if` / `stats` / `event`.
  5. If `what_if.verdict == "not_verified"`, the headline must not say the alternative was better. The template phrase is "Too close to call", in all three languages.
- Stage `status` strings are short, in `segment.lang`, e.g. "Checking 3 numbers…". The `whatif` and `question` stages are emitted by the API, not here.

- [ ] **Step 1: Write failing tests** (stub client, the `stats` fixture from `conftest.py`, factories).
  - `test_stages_in_order`: the emitted stages are `["analyst","factcheck","personalise"]`.
  - `test_whatif_claim_exact`: `check_whatif_claim` passes for `shots_alt` equal to `w.shots.alt`, fails for one more, and fails for `w=None`.
  - `test_wrong_number_is_dropped_and_unverified`: a stub draft whose only claim is wrong gives a reply that does not contain that number, with `verified is False`.
  - `test_never_cites_after_paused_frame`: a stub draft claiming a metric `at_frame = at_frame + 25` is dropped.
  - `test_not_verified_is_too_close_to_call`: in `es`, the headline contains the Spanish "too close to call" phrase.
  - `test_unsupported_passes_reason_through`: there are no chips, `verified is True`, and the headline equals the reason.
  - `test_casual_is_short`: casual has a body of ≤ 1 sentence; analyst has ≤ 3.
  - In `test_server.py`, `test_ask_answer_streams_stages_then_reply`: the artifact names are, in order, `ask_stage` ×3 then `ask_reply`.
- [ ] **Step 2: Run the tests and see them fail.** Run `uv run --project services/agents pytest services/agents/tests/test_ask_answer.py services/agents/tests/test_server.py -p no:xdist`. Expected: FAIL.
- [ ] **Step 3: Implement `ask_answer.py`, `check_whatif_claim` and the server dispatch.** Add stub responders `@stub_responder("ask_analyst")` and `@stub_responder("ask_personalise")`. The analyst stub cites the what-if numbers and one stats metric at `at_frame`, so tests have a deterministic draft.
- [ ] **Step 4: Run the tests and see them pass.** Also run `uv run --project services/agents pytest services/agents/tests/test_factchecker.py` to confirm the existing fact-checker tests still pass. Expected: PASS.
- [ ] **Step 5: Commit** with `feat(agents): ask answer team — analyst on re-sim evidence, rule fact-check incl. what-if claims, fast personaliser, stage artifacts`.

---

### Task 5: Pitch-marker cues from the agents

**Files:**
- Create: `services/agents/touchline_agents/markers.py`
- Modify: `services/agents/touchline_agents/personalizer.py`. In `make_cue` (`:178-192`) or its caller in `workflow.py:171`, append the marker cue when `marker_cue` returns one.
- Test: `services/agents/tests/test_markers.py`

**Interfaces:**
- Consumes: `Story`, `Cue`, the moment's claims and signals; the marker convention in Global Constraints.
- Produces:
  - `marker_cue(story: Story, segment: Segment, base: Cue) -> Cue | None`. The returned cue copies `base.anchor`, `moment_id` and `segment`, sets `cue_id = base.cue_id + ":m"`, `slot = "pitch_marker"` and `text = None`, and keeps `verified = base.verified`.
  - Template rules, first match wins:
    1. A passed `better_option` claim gives `"ghost"` with `at:<receiver_id>`, and the receiver's position at `anchor.frame_to` as `x`/`y` when the story has it.
    2. A passed claim or signal on a pressure metric (metric id containing `press`) gives `"pressure_ring"` with `at:<ball holder or subject>` and `count`.
    3. A pass event in the story with a receiver gives `"pass_arc"` with `from:<passer>` and `to:<receiver>`.
    4. Otherwise None.
  - Density: casual segments get a marker only when `base.display.priority == 1`; analyst segments get one for every priority. `ttl_ms` = the base's.

- [ ] **Step 1: Write failing tests.**
  - `test_better_option_gives_ghost_at_receiver`
  - `test_pressure_gives_ring_with_count`
  - `test_casual_only_priority_one`
  - `test_marker_never_unverified_when_base_unverified_is_dropped`: an unverified base gives a marker with `verified False` (the API's `pickCues` already filters unverified cues).
  - `test_markers_flow_from_workflow`: the existing workflow fixture run emits ≥ 1 `pitch_marker` cue for the analyst segment.
- [ ] **Step 2: Run the tests and see them fail.** Run `uv run --project services/agents pytest services/agents/tests/test_markers.py`.
- [ ] **Step 3: Implement `markers.py` and append its cue.** Check that the API `pickCues` (`apps/api/src/cues.ts:17`) passes `pitch_marker` cues through for the segment. If it filters by slot, add `pitch_marker` there and cover it with a case in `apps/api/test/` (cues test).
- [ ] **Step 4: Run the tests and see them pass.** Also run `test_personalizer.py` and `test_workflow.py`. Expected: PASS.
- [ ] **Step 5: Commit** with `feat(agents): pitch-marker cues (ghost, pressure ring, pass arc) by mode`.

---

### Task 6: Per-viewer freeze, frame-anchored overlays and the 3D pitch markers (web)

**Files:**
- Modify: `apps/web/src/pane.ts`. Replace wall-clock `until` (`:17`, `:50`, `:57-58`) with frame anchoring, and keep a ring buffer of the last 30 s of frames.
- Modify: `apps/web/src/usePane.ts`, `apps/web/src/Overlays.tsx` (drop `useNow` for visibility), `apps/web/src/Watch.tsx` (local freeze; pause button and space key), `apps/web/src/Live3D.tsx` (accept `frozen`; markers layer).
- Create: `apps/web/src/markers.ts`, `apps/web/src/view3d/PitchMarkers.tsx`
- Test: `apps/web/test/overlays.test.tsx` (rewrite the expiry cases), `apps/web/test/watch.test.tsx`, `apps/web/test/markers.test.ts`

**Interfaces:**
- Consumes: the `Cue` schema and the marker convention; `World.positionOf(id)` (`view3d/world.ts:287`).
- Produces:
  - In `pane.ts`:
    - `OnScreen = { cue: Cue; untilFrame: number }`, where `untilFrame = max(cue.anchor.frame_to, arrivalFrame) + round(cue.display.ttl_ms * fps / 1000)` and `arrivalFrame` is the latest frame when the cue arrived;
    - `reduce(s: PaneState, t: Tick, fps: number): PaneState`;
    - `inSlot(s: PaneState, slot: Slot, frame: number): Cue[]`, visible when `cue.anchor.frame_from ≤ frame ≤ untilFrame`;
    - `frameAt(s: PaneState, frame: number): PitchFrame | null`, from the ring buffer.
  - `parseMarker(cue: Cue): Marker | null` in `markers.ts`, where `Marker = { template: "pressure_ring" | "pass_arc" | "ghost"; at?: string; from?: string; to?: string; count?: number; point?: { x: number; y: number } }`.
  - `<PitchMarkers cues={Cue[]} world={World} onTap={(m: Marker, cue: Cue) => void} />`.
  - Watch freeze state: `frozen: number | null` (the frame). While frozen:
    - Live3D renders `frameAt(frozen)` at animation speed 0;
    - Overlays and markers use `frozen` as the frame;
    - incoming ticks still reduce into the state.
  - Resume sets `frozen = null`, which jumps to the latest frame.
  - Watch exposes `onFreeze(frame)` and `onResume()` callbacks for Task 7 to hang the panel on.
  - The server `Control` pause stays available in Studio and is no longer used by the Watch pause button.

- [ ] **Step 1: Write failing tests.**
  - `overlays.test.tsx`:
    - `it("shows a cue between its anchor and anchor+ttl in frames, whatever the wall clock")`;
    - `it("keeps overlays as they were while frozen even as new cues arrive")`: a cue arriving after the freeze, anchored after `frozen`, is not shown.
  - `watch.test.tsx`:
    - `it("pause freezes only this viewer")`: clicking pause makes no `control` call on the fake client, and the frame shown stays at F while ticks continue;
    - `it("space toggles freeze")`;
    - `it("resume jumps to live")`.
  - `markers.test.ts`:
    - `parseMarker` reads `at:`/`from:`/`to:` keys, `count` and `x`/`y`;
    - it returns null for a non-`pitch_marker` cue or an unknown template.
- [ ] **Step 2: Run the tests and see them fail.** Run `cd apps/web && npx vitest run test/overlays.test.tsx test/watch.test.tsx test/markers.test.ts --no-file-parallelism`.
- [ ] **Step 3: Implement.**
  - `PitchMarkers` draws a ring of radius 1.5 m with a count label (`pressure_ring`), a raised arc between two players (`pass_arc`), or a dashed circle at a point or player (`ghost`).
  - Markers are positioned each frame from `world.positionOf`, in the existing scene's material style.
  - A tap calls `onTap`.
- [ ] **Step 4: Run the tests and see them pass.** Also run `test/live3d.test.tsx`, then `pnpm --filter @touchline/web typecheck`. Expected: PASS.
- [ ] **Step 5: Commit** with `feat(web): per-viewer freeze, frame-anchored overlays, 3D pitch markers`.

---

### Task 7: Ask panel and the spoiler-free Show me (web)

**Files:**
- Create: `apps/web/src/AskPanel.tsx`, `apps/web/src/AskSplit.tsx`
- Modify: `apps/web/src/client.ts` (three methods), `apps/web/test/fake-client.ts` (fake them), `apps/web/src/Watch.tsx` (mount the panel on freeze; marker tap opens it pre-filled; Show me mounts `AskSplit` the way `WhatIfSplit` is mounted at `:173`), `apps/web/src/i18n.ts` (new keys in all three languages)
- Test: `apps/web/test/askpanel.test.tsx`, `apps/web/test/asksplit.test.tsx`, plus cases in `watch.test.tsx`

**Interfaces:**
- Consumes:
  - Task 1 RPC types;
  - Task 6 `onFreeze`, `onResume`, `frozen`, `<PitchMarkers onTap>` and `Marker`;
  - Stage3D split mode (as used by `WhatIfSplit.tsx`).
- Produces:
  - In `client.ts`:
    - `suggest(sessionId: string, frame: number, lang: Lang): Promise<QuestionChip[]>`;
    - `ask(sessionId: string, req: { frame: number; question: string; chip_id: string | null; segment: Segment }, onUpdate: (u: AskUpdate) => void, onEnd: () => void): () => void`. It uses `follow` like `watch`;
    - `askClip(sessionId: string, clipId: string): Promise<AskClip>`.
  - `<AskPanel client sessionId frame segment prefill?: string onShowMe={(clipId: string) => void} onClose />`:
    - it shows chips, a text box, and a five-row stage list (question, whatif, analyst, factcheck, personalise), each pending, then working, then done. The what-if row is hidden when no `whatif` stage arrives;
    - then the answer card: headline, body, ≤ 4 evidence chips, a "Fact-checked ✓" mark only when `verified`, and a verdict line from `verdict`;
    - Show me appears only when `clip_id` is set;
    - a new ask stops the previous stream;
    - `failed` shows the localised offline, timeout or bad-frame copy.
  - `markerQuestion(m: Marker, names: Record<string, string>, lang: Lang): string` maps templates to prefill text: ghost gives "What if {name} got the ball here?", ring gives "Who's pressing {name}?", arc gives "Was passing to {name} the best option?".
  - `<AskSplit client sessionId clipId match lang onClose />`. The real side ends at `paused_frame` and then holds with a "You paused here" label. The alternative plays the full variant. It shows the seeds and the shots, goals and gain arms.

- [ ] **Step 1: Write failing tests** (fake client).
  - `askpanel.test.tsx`:
    - `it("lists suggested chips and asks with chip_id")`;
    - `it("ticks stages as updates arrive")`;
    - `it("shows Fact-checked only when verified")`;
    - `it("labels not_verified as too close to call")`;
    - `it("hides Show me without a clip")`;
    - `it("stops the previous ask when a new one starts")`: the first stop function is called;
    - `it("shows the offline copy on failed:offline in hi")`.
  - `asksplit.test.tsx`:
    - `it("never renders a real frame after paused_frame")`: the last real frame rendered has `frame ≤ paused_frame` even when the fake clip's `real` is longer;
    - `it("shows the counts")`.
  - `watch.test.tsx`:
    - `it("freeze opens Ask for the frozen frame")`;
    - `it("resume closes Ask")`;
    - `it("tapping a marker opens Ask pre-filled")`.
- [ ] **Step 2: Run the tests and see them fail.** Run `cd apps/web && npx vitest run test/askpanel.test.tsx test/asksplit.test.tsx test/watch.test.tsx --no-file-parallelism`.
- [ ] **Step 3: Implement the panel, the split, the client methods, the Watch wiring and the i18n keys.** The panel matches mockup D: a translucent card over the paused picture, on the right in 3D.
- [ ] **Step 4: Run the tests and see them pass.** Also run `pnpm --filter @touchline/web typecheck`. Expected: PASS.
- [ ] **Step 5: Commit** with `feat(web): Ask panel, stage display, answer card and spoiler-free Show me`.

---

### Task 8: Ask orchestration in the API

**Files:**
- Create: `apps/api/src/ask.ts`, `packages/agent-gateway/src/ask.ts` (export it from `src/index.ts`)
- Modify: `apps/api/src/server.ts` (replace the Task 1 stubs with handlers), `apps/api/src/session.ts` (release the Ask mcp server when the session closes), `apps/api/src/library.ts` (load `ask-cache.json` into `LibraryMatch.askCache`)
- Test: `apps/api/test/ask.test.ts`, `packages/agent-gateway/test/ask.test.ts`

**Interfaces:**
- Consumes:
  - Task 1 types;
  - Task 2 `summaryInWorker`, `askClipInWorker`, `askWhatIfOf`, `forkFrameOf`, `suggestChips`;
  - `Sender`, `a2aSender`, `startMcpStats`, and the errors in `gateway.ts:10-12`;
  - the session's `playback` ref for the current frame.
- Produces:
  - In `packages/agent-gateway/src/ask.ts`:
    - `askIntent(send: Sender, req: AskIntentRequest, timeoutMs: number): Effect<AskIntent, AgentUnavailable | AgentFailed | InvalidArtifact | TimeoutError>`;
    - `askAnswer(send: Sender, req: AskAnswerRequest, timeoutMs: number): Stream<{ kind: "stage"; stage: AskStage } | { kind: "reply"; reply: AskReply }, AgentUnavailable | AgentFailed | InvalidArtifact | TimeoutError>`. It decodes the `ask_stage` and `ask_reply` artifacts.
  - In `apps/api/src/ask.ts`:
    - `makeAsk(o: AskOptions)` returns `{ suggest(s: Session, frame: number, lang: Lang): Effect<QuestionChip[], AskNotAvailable>; ask(s: Session, req: AskPayload): Stream<AskUpdate>; clip(s: Session, clipId: string): Effect<AskClip, AskNotAvailable> }`;
    - `AskPayload` = the `Ask` RPC payload without `session_id`. `AskOptions = { send: Sender; mcp?: (dir: string) => Promise<McpServer>; summary?: typeof summaryInWorker; askClip?: typeof askClipInWorker; timeoutMs?: number }`;
    - `ASK_INTENT_TIMEOUT_MS = 5_000`, `ASK_ANSWER_TIMEOUT_MS = 15_000`, `ASK_REPLAY_MS = 350`.
  - `server.ts` builds `makeAsk({ send: a2aSender(agentsUrl) })` when an agents URL is configured. Without one, `Ask` emits `failed: offline`.
- `ask` flow:
  1. If `req.frame >` the session's playback frame, emit `failed bad_frame` and end.
  2. If `match.askCache` has `"${frame}:${chip_id}"`, replay its stages at `ASK_REPLAY_MS` intervals, then its answer with `cached: true`, and end.
  3. Get the summary (worker, memoised per `(match, frame)`).
  4. Emit `question`. If a chip is given, take its intent from `suggestChips(summary, lang)`. Otherwise call `askIntent`.
  5. If the intent is `what_if`, emit `whatif` with status naming the alternative, then call `askClipInWorker` with `forkFrameOf(summary, intent)` and `pausedFrame = req.frame`. Store the clip per session under `clip_id`.
  6. Get the session's Ask mcp server lazily, started once per session and memoised, and stopped when the session closes.
  7. Relay the `askAnswer` stages, then emit the `answer` with `ask_id`, `clip_id` and `verdict`.
  8. Map errors: `AgentUnavailable` becomes `failed offline`; `TimeoutError` and the worker timeout become `failed timeout`.

  `clip` returns the stored clip or `AskNotAvailable`.

- [ ] **Step 1: Write failing tests** (a fake `Sender` that yields the scripted artifacts; fake `mcp`, `summary` and `askClip`; `makeLibrary()` for a real session where needed).
  - `ask.test.ts`:
    - `it("streams question, whatif, the agent stages, then the answer")`: the kinds and stage names are in order, and `answer.clip_id` is set for a what-if chip;
    - `it("fails bad_frame beyond the playback frame")`;
    - `it("fails offline when the sender throws AgentUnavailable")`;
    - `it("fails timeout when the answer exceeds its timeout")` (TestClock);
    - `it("starts the Ask mcp server once for two asks and stops it on close")`;
    - `it("replays a cached answer with cached true and no agent calls")`;
    - `it("does not call askIntent for a chip")`;
    - `it("serves the stored clip by id")`.
  - Gateway `ask.test.ts`:
    - `it("decodes stage and reply artifacts in order")`;
    - `it("rejects a malformed reply as InvalidArtifact")`.
- [ ] **Step 2: Run the tests and see them fail.** Run `cd apps/api && npx vitest run test/ask.test.ts --no-file-parallelism` and `cd packages/agent-gateway && npx vitest run test/ask.test.ts`.
- [ ] **Step 3: Implement the gateway functions, `makeAsk`, the server handlers, the session release and the cache loading.**
- [ ] **Step 4: Run the tests and see them pass.** Also run `test/server.test.ts`, `test/live.test.ts` and `test/session.test.ts` (to confirm the live path is unchanged), then typecheck api and agent-gateway. Expected: PASS.
- [ ] **Step 5: Commit** with `feat(api): Ask orchestration — summary, intent, single-source what-if, agent answer stream, lazy mcp, cache replay`.

---

### Task 9: Demo cache, end-to-end and the live smoke test

**Files:**
- Create: `apps/api/src/ask-cache-cli.ts`, plus a script `"ask-cache": "tsx src/ask-cache-cli.ts"` in `apps/api/package.json`
- Create: `apps/api/test/ask-e2e.test.ts`, `services/agents/tests/test_ask_live.py` (marked `live`)
- Create: `docs/demo/ask-moments.md`

**Interfaces:**
- Consumes: Task 8 `makeAsk` and Task 2 `suggestChips`; the stub agent service as started in `services/agents/tests/conftest.py` (`agents_url`), or `touchline-agents --port`.
- Produces:
  - The CLI `pnpm --filter @touchline/api ask-cache --library <dir> --match <id> --frames <f1,f2,…> --agents <url>`. For each frame and each suggested chip it runs `makeAsk().ask` and writes `<match dir>/ask-cache.json`:

    ```json
    { "version": 1, "entries": { "<frame>:<chip_id>": { "stages": [AskStage...], "answer": AskAnswer, "clip": AskClip | null } } }
    ```

    It never overwrites an entry that ended in `failed`; it reports it instead.
  - `docs/demo/ask-moments.md` lists 3–5 candidate moments (match id, frame, clock, why it's good for the video, suggested chip), proposed from the library. The user picks the final set on 2026-10-25.

- [ ] **Step 1: Write the end-to-end test (stub LLM).** `ask-e2e.test.ts` starts the API on `makeLibrary()` with the stub agent service and asks a `what_if_pass` chip at a frame with a ball holder. Assert:
  - the stages arrive in order;
  - the answer has `verified` as a boolean, `clip_id` set and `cached: false`;
  - `GetAskClip` returns a clip with `real.at(-1).frame ≤ frame`;
  - a second run of the CLI-written cache replays with `cached: true`.
- [ ] **Step 2: Run the test and see it fail, then implement the CLI until it passes.** Run `cd apps/api && npx vitest run test/ask-e2e.test.ts --no-file-parallelism`.
- [ ] **Step 3: Write the live smoke test.** `test_ask_live.py` (`-m live`) runs one EN typed question, one HI typed question and one unsupported question against the real models.
  - Assert each completes, the HI answer is in Devanagari, and the unsupported one has no chips.
  - Record the wall time per question in the test output; the target is ≤ 10 s each.
  - It also confirms that `gpt-5.4-mini` is reachable with the configured key. If it is not, the implementer reports this and does not change the default. The controller decides.
- [ ] **Step 4: The controller runs the live smoke test once** with `TOUCHLINE_LLM=openai uv run --project services/agents pytest services/agents/tests/test_ask_live.py -m live`. The times are recorded in the ledger.
- [ ] **Step 5: Propose the demo moments.** After the library rebuild (post-P6), scan one match for frames where the `why_not_pass` chip exists and the clip verdict is `better_option_found`, and write `docs/demo/ask-moments.md`. Do not build the cache until the user picks.
- [ ] **Step 6: Commit** with `feat: Ask demo cache CLI, end-to-end test, live smoke, candidate demo moments`.

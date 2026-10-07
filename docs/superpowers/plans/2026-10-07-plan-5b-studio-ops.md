# Touchline Plan 5b — Studio Console, Graphics Output and Ops View Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The rest of spec §5.6 on top of Plan 5a. A producer works a queue of the agents' moments in a studio console (approve, hold, send to graphics), a presenter reads talking points built from verified facts, a broadcast graphics page airs only what the producer sent, and an ops view shows what the agents did and how fast the system was against the spec's latency budgets.

**Architecture:**
- **One bus per session (Plan 5a), more kinds of beat.** Besides the timeline, a session's bus now carries studio queue changes (`queue`) and cues sent to air (`air`).
- **Studio queue (`apps/api/src/studio.ts`).** A recorder subscribes to every session's bus before play starts. Each moment (or recap) that reaches the bus joins the queue, pending, with all its segment variants. Its facts come from the "Why?" evidence as of the moment's frame: the cause and each checked metric claim. Approve, hold and send change its status for everyone. Send also publishes the cues to air.
- **Three more streams, one shape.** `Watch`, the studio console (`StudioWatch`) and the graphics output (`WatchGraphics`) all follow the session's bus through one `follow()`. Each counts as a watcher, so the idle stop and live segments work for them too.
- **Talking points need no model.** They are the analyst variant's text in the producer's language, one sentence per point, followed by the checked facts. Every number in them was verified when the cue was made.
- **Ops report (`apps/api/src/ops.ts`).** Built as of the session's frame:
  - Fact-Checker verdicts, fallbacks, time per agent, requests by outcome, late and unverified cues.
  - Latency against the spec's budgets (§2):
    - Goal to scoreboard on the bus: under 250 ms. A goal now reaches the scoreboard at once instead of at the next whole second.
    - Live: signal played to cue on the bus, under 4 s. Measured per batch.
    - A recorded session reports the request times measured when its cache was made.
- **Web pages in the URL hash.** `#/studio/<session>?seg=…`, `#/graphics/<session>?seg=…&match=…` (transparent, for a vision mixer or OBS) and `#/ops/<session>?lang=…`. Each session in the fan app links to all three.

**Tech Stack:** as Plan 5a (effect 4.0.1, `effect/rpc`, React 19.3.0, Vite 8.3.3, Tailwind CSS 4.3.3, Vitest 5.0.3 with jsdom 30.1.2 and Testing Library). No new dependencies.

**Spec:** `docs/superpowers/specs/2026-10-03-touchline-design.md`:
- §2: success criteria (latency budgets).
- §4: cue bus.
- §5.3: Fact-Checker counts on the ops view.
- §5.4: cue contract and slots.
- §5.6: studio console, ops view.
- §5.7: `studio.approve` / `studio.hold`.
- §7: tests.

Roadmap: `docs/superpowers/plans/2026-10-03-touchline-roadmap.md` (Plan 5b). Builds on Plan 5a (merged to `main`).

**How code is given:** new files in full. Changes to existing files are exact patches, applied from the repository root with the `git apply <<'PATCH' … PATCH` block shown, each produced from the verified prototype task by task.

**Verification status:** every task was built and run in full before this plan was written: one commit per task, each commit's type checks and tests green. The code blocks reproduce the prototype file for file, checked by replaying the plan on a fresh clone of `main`. Every RED step's expected failure is the output of running that task's tests against the previous task's commit.

At the end:
- **Tests:** 24 of 24 Turborepo tasks green (`@touchline/rpc` 8 tests, `apps/api` 49, `apps/web` 40, `@touchline/agent-gateway` 17) and 158 agent tests. No `touchline-*` folder is left in the temp folder.
- **The stack, run for real:**
  - The stub agent service, then `pnpm library` for two scenarios: 27 moments and 348 cues, and 33 moments and 420 cues.
  - Then `pnpm dev`, used in Chrome with the fan app, the studio console, the graphics output and the ops view in separate tabs.
- **What the browser check showed:**
  - The queue filled as moments were reached, with 12 variants each in the raw feed.
  - Approving a moment gave the presenter its analyst sentences and checked facts.
  - Sending another put it, and nothing else, under the scoreboard of the transparent graphics page.
  - The ops view counted the moments, verdicts, per-agent times and requests so far, and refreshed every 2 s.
  - It found one layout fault, in the ops view's per-agent table, fixed in Task 10.

## Global Constraints

- **All earlier constraints hold:**
  - Synthetic data only, pinned versions, no GPL or AGPL code.
  - The OpenAI key stays in the git-ignored `.env.local`, on the agent service. It never reaches the API or the browser.
  - Tests never call a model.
  - Tests delete what they write.
  - UI strings exist in English, Spanish and Hindi (Hindi in Devanagari).
- **No answer sees the future.**
  - The studio's facts are the evidence as of the moment's frame.
  - The ops report counts only what the session has reached: recorded traces and requests up to its frame, or what its live agents did.
- **The producer gates the broadcast, not the fans.** The graphics output shows the scoreboard and only the cues sent to air. The fan app keeps showing every verified cue for its own segment.
- **Talking points are verified text.** They are the analyst cue's sentences and the checked facts, never new model output.
- **Decisions are shared.** Every studio console of a session sees every decision (the bus carries them). A console that opens late gets the queue so far.
- **Latency budgets (spec §2, p95):**
  - Stats overlay under 250 ms from the event.
  - AI insight under 4 s from the signal.
  - The ops view says "within budget", "over budget" or "no measurements yet". It never hides a miss.

## Review Focus

1. **Two producers, one moment.** One holds a moment while the other approves it. Every console must end up showing the same, latest status, and the presenter's points must follow it. *Task 3, `studio.test.ts` ("approves, holds and sends to graphics, and tells everyone on the bus"). Task 8, `studio.test.tsx` ("gives the presenter talking points for approved and on-air moments only": another producer holds it).*
2. **A producer who opens the console mid-match** must see the queue so far, not only moments from now on. *Task 4, `studio.test.ts` ("give a producer who joins late the queue so far, in their language").*
3. **A producer segment the agents wrote no variant for** (Spanish casual in the fixture) must still get a cue to air, never another club's framing, and the analyst text in their language where it exists. *Task 3, `studio.test.ts` ("show each producer the variant for their segment and the analyst text in their language").*
4. **The ops view on a recorded match** must not count moments, verdicts or requests the session has not reached, although the cache holds the whole match. *Task 6, `ops.test.ts` ("counts a recorded session's agent work as of its frame, never ahead of it").*
5. **The graphics output** must never show a pitch, a button, or an agent cue the producer did not send. *Task 4, `studio.test.ts` ("put on the graphics output the scoreboard and only the cues the producer sent"). Task 9, `graphics.test.tsx`.*

---

### Task 1: Studio and ops contracts

The shapes the studio console and the ops view share between the API and the web app.
- **`QueueItem`:** a moment as one producer's segment sees it.
  - Status: pending, approved, held or on air.
  - The variant that would air (null when there is none).
  - The talking points and the number of variants.
- **`StudioTick`:** the producer's stream (`queue` | `cue` (raw feed) | `playback`).
- **`StudioAction`:** approve, hold, send.
- **`Percentiles`, `Budget` and `OpsReport`:** the ops numbers, each latency with its budget and an `ok` that is null with no measurements.
- **`NotQueued`:** the error for an action on a moment the queue does not hold.

The RPCs that carry them are added with their handlers (Tasks 4 and 6), so the API keeps type-checking after every task.

**Files:**
- Modify: `packages/rpc/src/contracts.ts`
- Test: `packages/rpc/test/studio.test.ts`

**Interfaces:**
- Consumes: `Cue` (`@touchline/schema`), `Playback` (Plan 5a).
- Produces (from `@touchline/rpc`):
  - `QueueStatus` (`"pending" | "approved" | "held" | "on_air"`), `QueueItem` (`moment_id`, `frame`, `clock`, `status`, `cue: Cue | null`, `points: string[]`, `variants`).
  - `StudioTick` (`{kind: "queue", item}` | `{kind: "cue", cue}` | `{kind: "playback", playback}`), `StudioAction` (`"approve" | "hold" | "send"`).
  - `Percentiles` (`n`, `p50`, `p95`, `max`, nullable), `Budget` (+ `budget_ms`, `ok: boolean | null`).
  - `OpsReport` (`session_id`, `live`, `frame`, `models`, `moments`, `cues`, `fact_check {pass, retry, drop}`, `fallbacks`, `agents [{agent, …Percentiles}]`, `requests`, `late_cues`, `unverified_cues`, `latency {stats: Budget, insight: Budget & {source: "live" | "recorded"}}`).
  - `NotQueued` (`moment_id`), `decodeStudioTick`.

- [ ] **Step 1: Write the failing tests**

Create `packages/rpc/test/studio.test.ts`:

```ts
import { readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { Schema } from "effect"
import { describe, expect, it } from "vitest"
import { decodeStudioTick, NotQueued, OpsReport, StudioAction } from "../src/contracts.js"

const root = join(dirname(fileURLToPath(import.meta.url)), "../../..")
const cue = (JSON.parse(readFileSync(join(root, "packages/schema/fixtures/agents/valid/cue.json"), "utf8")) as { value: unknown }).value
const item = { moment_id: "mo-1", frame: 1200, clock: "02:00", status: "pending", cue, points: ["High press forces the turnover."], variants: 12 }

describe("studio contracts", () => {
  it("carry queue items, raw cues and playback on the producer's stream", () => {
    expect(decodeStudioTick({ kind: "queue", item }).kind).toBe("queue")
    expect(decodeStudioTick({ kind: "queue", item: { ...item, cue: null } }).kind).toBe("queue") // no variant for the segment
    expect(decodeStudioTick({ kind: "cue", cue }).kind).toBe("cue")
    expect(decodeStudioTick({ kind: "playback", playback: { state: "paused", frame: 3, speed: 4, live: true } }).kind).toBe("playback")
    expect(() => decodeStudioTick({ kind: "queue", item: { ...item, status: "aired" } })).toThrow()
  })

  it("take only approve, hold and send as producer actions", () => {
    const decode = Schema.decodeUnknownSync(StudioAction)
    for (const action of ["approve", "hold", "send"]) expect(decode(action)).toBe(action)
    expect(() => decode("delete")).toThrow()
    expect(new NotQueued({ moment_id: "m" })._tag).toBe("NotQueued")
  })

  it("report the ops numbers against the latency budgets", () => {
    const p = { n: 3, p50: 2, p95: 5, max: 6 }
    const report = {
      session_id: "s", live: false, frame: 6000, models: ["stub"], moments: 4, cues: 48,
      fact_check: { pass: 4, retry: 1, drop: 0 }, fallbacks: { narrator: 1 }, agents: [{ agent: "analyst", ...p }],
      requests: { ok: 9 }, late_cues: 0, unverified_cues: 0,
      latency: { stats: { ...p, budget_ms: 250, ok: true }, insight: { n: 0, p50: null, p95: null, max: null, budget_ms: 4000, ok: null, source: "recorded" } }
    }
    expect(Schema.decodeUnknownSync(OpsReport)(report)).toEqual(report)
  })
})
```

- [ ] **Step 2: Run them to make sure they fail**

Run: `pnpm --filter @touchline/rpc test`
Expected: 3 tests fail: `decodeStudioTick is not a function` and `Cannot read properties of undefined (reading 'ast')` (the schemas do not exist yet)

- [ ] **Step 3: Write the contracts**

Apply this change to `packages/rpc/src/contracts.ts` (from the repository root):

```bash
git apply <<'PATCH'
diff --git a/packages/rpc/src/contracts.ts b/packages/rpc/src/contracts.ts
index 1cd6b3d..f3df1e4 100644
--- a/packages/rpc/src/contracts.ts
+++ b/packages/rpc/src/contracts.ts
@@ -129,6 +129,75 @@ export class MatchNotFound extends Schema.TaggedError<MatchNotFound>()("MatchNot
 export class SessionNotFound extends Schema.TaggedError<SessionNotFound>()("SessionNotFound", { session_id: Schema.String }) {}
 export class EvidenceNotFound extends Schema.TaggedError<EvidenceNotFound>()("EvidenceNotFound", { cue_id: Schema.String }) {}
 
+/** Where a moment stands in the producer's queue: approved puts it in the presenter's talking points, on air sends it to graphics. */
+export const QueueStatus = Schema.Literals(["pending", "approved", "held", "on_air"])
+export type QueueStatus = typeof QueueStatus.Type
+
+/** A moment in the studio queue (spec §5.6 studio console), as one producer's segment sees it. */
+export const QueueItem = Schema.Struct({
+  moment_id: Id,
+  /** The frame the moment ends on, and its clock. */
+  frame: Count,
+  clock: Schema.String,
+  status: QueueStatus,
+  /** The variant that airs for the producer's segment (null when the agents wrote none for it). */
+  cue: Schema.NullOr(Cue),
+  /** Presenter talking points: the analyst text in the segment's language, then each checked fact. */
+  points: Schema.Array(Schema.String),
+  /** How many segment variants the agents wrote. */
+  variants: Count
+})
+export type QueueItem = typeof QueueItem.Type
+
+/** What the studio console receives: the queue (each change to an item), every agent cue as it arrives, and playback. */
+export const StudioTick = Schema.Union([
+  Schema.Struct({ kind: Schema.Literal("queue"), item: QueueItem }),
+  Schema.Struct({ kind: Schema.Literal("cue"), cue: Cue }),
+  Schema.Struct({ kind: Schema.Literal("playback"), playback: Playback })
+])
+export type StudioTick = typeof StudioTick.Type
+
+export const StudioAction = Schema.Literals(["approve", "hold", "send"])
+export type StudioAction = typeof StudioAction.Type
+
+/** Percentiles of a set of measurements in milliseconds (null when there are none). */
+export const Percentiles = Schema.Struct({ n: Count, p50: Schema.NullOr(Schema.Finite), p95: Schema.NullOr(Schema.Finite), max: Schema.NullOr(Schema.Finite) })
+export type Percentiles = typeof Percentiles.Type
+
+/** Measurements against a latency budget (spec §2: p95 under the budget); `ok` is null with no measurements. */
+export const Budget = Schema.Struct({ ...Percentiles.fields, budget_ms: Schema.Finite, ok: Schema.NullOr(Schema.Boolean) })
+export type Budget = typeof Budget.Type
+
+/** The ops view (spec §5.6): what the agents did for a session so far, and how fast the hot path and the agents were. */
+export const OpsReport = Schema.Struct({
+  session_id: Id,
+  live: Schema.Boolean,
+  /** Everything below is as of this frame. */
+  frame: Count,
+  models: Schema.Array(Schema.String),
+  moments: Count,
+  cues: Count,
+  /** Fact-Checker verdicts (a retried draft counts once as retry, then as pass or drop). */
+  fact_check: Schema.Struct({ pass: Count, retry: Count, drop: Count }),
+  /** Agents that used their deterministic fallback, by agent. */
+  fallbacks: Schema.Record(Schema.String, Count),
+  /** Time each agent took per moment. */
+  agents: Schema.Array(Schema.Struct({ agent: Schema.String, ...Percentiles.fields })),
+  /** Requests to the agent service by outcome. */
+  requests: Schema.Record(Schema.String, Count),
+  late_cues: Count,
+  unverified_cues: Count,
+  latency: Schema.Struct({
+    /** Event to scoreboard on the bus (budget 250 ms). */
+    stats: Budget,
+    /** Live: signal played to cue on the bus; recorded: request time when the cache was made (budget 4 s). */
+    insight: Schema.Struct({ ...Budget.fields, source: Schema.Literals(["live", "recorded"]) })
+  })
+})
+export type OpsReport = typeof OpsReport.Type
+
+export class NotQueued extends Schema.TaggedError<NotQueued>()("NotQueued", { moment_id: Schema.String }) {}
+
 export const MIN_SPEED = 0.25
 export const MAX_SPEED = 64
 const Speed = Schema.Finite.check(Schema.isGreaterThanOrEqualTo(MIN_SPEED), Schema.isLessThanOrEqualTo(MAX_SPEED))
@@ -160,3 +229,4 @@ export class TouchlineRpcs extends RpcGroup.make(
 ) {}
 
 export const decodeTick = Schema.decodeUnknownSync(Tick)
+export const decodeStudioTick = Schema.decodeUnknownSync(StudioTick)
PATCH
```

- [ ] **Step 4: Run the tests**

Run: `pnpm --filter @touchline/rpc test && pnpm --filter @touchline/rpc typecheck`
Expected: 8 passed, no type errors

- [ ] **Step 5: Commit**

```bash
git add packages/rpc
git commit -m "feat(rpc): studio and ops contracts — queue items, the producer's stream, actions, latency budgets and the ops report

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Goals reach the scoreboard at once, and their latency is measured

Spec §2 asks for the stats overlay within 250 ms of the event. In Plan 5a the scoreboard came once a second of match time, so a goal could wait up to a second (at ×1).
- **Playback:** `beats` now emits a scoreboard right after a goal event, at the frame being played.
- **Measurement:** each session measures, for every goal, the wall-clock time from playing the goal's frame to the new score on the bus, in `metrics.stats`. The ops view (Task 6) reports it.

**Files:**
- Modify: `apps/api/src/playback.ts`, `apps/api/src/session.ts`
- Test: `apps/api/test/playback.test.ts`, `apps/api/test/session.test.ts`

**Interfaces:**
- Consumes: `beats`, `Board`, `Session` (Plan 5a).
- Produces: `Metrics` (`stats: number[]`, in milliseconds) and `Session.metrics`. A board beat at a goal's frame.

- [ ] **Step 1: Write the failing tests**

Apply this change to `apps/api/test/playback.test.ts`, `apps/api/test/session.test.ts` (from the repository root):

```bash
git apply <<'PATCH'
diff --git a/apps/api/test/playback.test.ts b/apps/api/test/playback.test.ts
index a34d36d..8a14baf 100644
--- a/apps/api/test/playback.test.ts
+++ b/apps/api/test/playback.test.ts
@@ -36,6 +36,13 @@ describe("timeline", () => {
     }
   })
 
+  it("puts a goal on the scoreboard at once, not at the next whole second", () => {
+    const boards = all.flatMap((b) => (b.kind === "board" ? [b.board] : []))
+    const changes = boards.filter((b, i) => i > 0 && b.score.home + b.score.away > boards[i - 1]!.score.home + boards[i - 1]!.score.away)
+    expect(changes.length).toBe(match.info.score.home + match.info.score.away)
+    for (const [i, goal] of lib.goals.entries()) expect(Math.abs(changes[i]!.frame - goal.frame_id)).toBeLessThanOrEqual(1)
+  })
+
   it("passes on the stats engine's signals (goals among them) for live agents", () => {
     const signals = all.flatMap((b) => (b.kind === "signals" ? b.signals : []))
     expect(signals.filter((s) => s.type === "goal")).toHaveLength(match.info.score.home + match.info.score.away)
diff --git a/apps/api/test/session.test.ts b/apps/api/test/session.test.ts
index 35a81d7..0ec7d03 100644
--- a/apps/api/test/session.test.ts
+++ b/apps/api/test/session.test.ts
@@ -141,6 +141,21 @@ describe("sessions", () => {
       })
     ), 120_000)
 
+  it("measure how long each goal takes to reach the scoreboard", () =>
+    run(
+      Effect.gen(function* () {
+        const sessions = yield* makeSessions(library())
+        const goal = lib.goals[0]!
+        const s = yield* sessions.start(match, { speed: 64, fromMinute: Math.floor(goal.frame_id / 600), live: false })
+        const scored = (t: Tick) => t.kind === "cue" && t.cue.display.template === "scoreboard" && (t.cue.data["score.home"] ?? 0) + (t.cue.data["score.away"] ?? 0) > 0
+        const w = yield* sessions.watch(s.id, home).pipe(Stream.takeUntil(scored), Stream.runDrain, Effect.forkChild)
+        yield* settle(w)
+        expect(s.metrics.stats.length).toBe(1)
+        expect(s.metrics.stats[0]!).toBeGreaterThanOrEqual(0)
+        expect(s.metrics.stats[0]!).toBeLessThan(250) // the spec's stats-overlay budget
+      })
+    ), 120_000)
+
   it("start the second half from minute 45 and on", () => {
     const ht = startFrame(match, 45)
     expect(startFrame(match, 50) - ht).toBe(3000)
PATCH
```

- [ ] **Step 2: Run them to make sure they fail**

Run: `pnpm --filter @touchline/api exec vitest run test/playback.test.ts test/session.test.ts`
Expected: 2 tests fail: `expected 6 to be less than or equal to 1` (the scoreboard waits for the next whole second) and `Cannot read properties of undefined (reading 'stats')`

- [ ] **Step 3: Put goals on the scoreboard at once and measure them**

Apply this change to `apps/api/src/playback.ts`, `apps/api/src/session.ts` (from the repository root):

```bash
git apply <<'PATCH'
diff --git a/apps/api/src/playback.ts b/apps/api/src/playback.ts
index 762eb56..08730c2 100644
--- a/apps/api/src/playback.ts
+++ b/apps/api/src/playback.ts
@@ -62,7 +62,11 @@ export const beats = (m: LibraryMatch, fromFrame = 0): Stream.Stream<Beat, Repla
       const { home, away } = run.info
       const score = { home: 0, away: 0 }
       let next = 0
-      let last = 0
+      let last = -1
+      const board = (tick: number, clock: string): Beat => {
+        const mom = engine.value("team.mom", home.id, { at: tick })
+        return { kind: "board", board: { frame: tick, clock, score: { ...score }, momentum: mom === null ? null : { home: r3(mom), away: r3(1 - mom) } } }
+      }
       const due = (frame: number): Beat[] => {
         const out: Beat[] = []
         while (next < groups.length && groups[next]!.frame <= frame) {
@@ -75,9 +79,15 @@ export const beats = (m: LibraryMatch, fromFrame = 0): Stream.Stream<Beat, Repla
         const signals = engine.ingest(input)
         if (input.kind === "event") {
           // Events raise most signals (goals, cards, big chances), frames the rest (pressure, momentum, sprints).
-          if (input.event.type === "goal") input.event.team_id === home.id ? score.home++ : score.away++
+          const out: Beat[] = []
+          if (input.event.type === "goal") {
+            input.event.team_id === home.id ? score.home++ : score.away++
+            // The hot path (spec §2: under 250 ms from the event): a goal reaches the scoreboard at once.
+            if (last >= fromFrame) out.push(board(last, engine.clockAt(last)))
+          }
           const at = signals[0]?.frame_id ?? 0
-          return signals.length && at >= fromFrame ? [{ kind: "signals", frame: at, signals }] : []
+          if (signals.length && at >= fromFrame) out.push({ kind: "signals", frame: at, signals })
+          return out
         }
         const f = input.frame
         last = f.tick
@@ -86,10 +96,7 @@ export const beats = (m: LibraryMatch, fromFrame = 0): Stream.Stream<Beat, Repla
           const clock = engine.clockAt(f.tick)
           out.push({ kind: "frame", frame: toFrame(f, clock) })
           if (signals.length) out.push({ kind: "signals", frame: f.tick, signals })
-          if (f.tick % every === 0) {
-            const mom = engine.value("team.mom", home.id, { at: f.tick })
-            out.push({ kind: "board", board: { frame: f.tick, clock, score: { ...score }, momentum: mom === null ? null : { home: r3(mom), away: r3(1 - mom) } } })
-          }
+          if (f.tick % every === 0) out.push(board(f.tick, clock))
         }
         return [...out, ...due(f.tick)]
       }
@@ -99,8 +106,9 @@ export const beats = (m: LibraryMatch, fromFrame = 0): Stream.Stream<Beat, Repla
         Stream.concat(
           Stream.suspend(() => {
             const signals = engine.finish()
-            const tail: Beat[] = signals.length && last >= fromFrame ? [{ kind: "signals", frame: last, signals }] : []
-            return Stream.fromIterable([...tail, ...due(Number.MAX_SAFE_INTEGER), { kind: "end", frame: last } as Beat])
+            const end = Math.max(0, last)
+            const tail: Beat[] = signals.length && end >= fromFrame ? [{ kind: "signals", frame: end, signals }] : []
+            return Stream.fromIterable([...tail, ...due(Number.MAX_SAFE_INTEGER), { kind: "end", frame: end } as Beat])
           })
         )
       )
diff --git a/apps/api/src/session.ts b/apps/api/src/session.ts
index 0dd4c64..3305d5f 100644
--- a/apps/api/src/session.ts
+++ b/apps/api/src/session.ts
@@ -26,6 +26,12 @@ export const frameStep = (speed: number, fps: number): number => Math.max(1, Mat
 /** What a session's bus carries: the timeline, then `closed` once nothing more will come (live agents included). */
 export type BusBeat = Beat | { readonly kind: "closed" }
 
+/** What a session measures for the ops view (wall-clock milliseconds). */
+export interface Metrics {
+  /** Each goal: the frame it was scored in played, to the new score on the bus (the stats-overlay latency). */
+  readonly stats: number[]
+}
+
 /** What a live session's agents have written so far: its cues, the traces behind them and its recaps. */
 export interface LiveStore {
   readonly cues: Cue[]
@@ -71,6 +77,7 @@ export interface Session {
   readonly closed: Ref.Ref<boolean>
   /** What the live agents wrote (empty for a recorded session). */
   readonly agents: LiveStore
+  readonly metrics: Metrics
   readonly watchers: Ref.Ref<number>
   /** The segments watched so far (live agents write cues for these). */
   readonly segments: Ref.Ref<ReadonlyMap<string, Segment>>
@@ -116,15 +123,23 @@ export const makeSessions = (library: ReadonlyMap<string, LibraryMatch>, options
         const segments = yield* Ref.make<ReadonlyMap<string, Segment>>(new Map())
         const closed = yield* Ref.make(false)
         const ended = yield* Deferred.make<void>()
-        const s: Session = { id, match, live: o.live, control, bus, playback, closed, agents: { cues: [], traces: [], recaps: [] }, watchers, segments }
+        const s: Session = { id, match, live: o.live, control, bus, playback, closed, agents: { cues: [], traces: [], recaps: [] }, metrics: { stats: [] }, watchers, segments }
         const end = (frame: number) =>
           Ref.update(playback, (p): Playback => ({ ...p, state: "ended", frame })).pipe(Effect.andThen(PubSub.publish(bus, { kind: "end", frame })))
         // A live session shows the agents' cues as they are written, never the cache's.
         const timeline = beats(o.live ? { ...match, cues: [] } : match, from)
+        let playedAt = 0 // when the latest frame was played
+        let goals = -1 // goals on the latest scoreboard (-1: none yet)
         const play = paced(timeline, control, fps).pipe(
           Stream.runForEach((b) =>
             Effect.gen(function* () {
+              if (b.kind === "board") {
+                const now = b.board.score.home + b.board.score.away
+                if (goals >= 0 && now > goals) s.metrics.stats.push(performance.now() - playedAt)
+                goals = now
+              }
               if (b.kind === "frame") {
+                playedAt = performance.now()
                 yield* Ref.update(playback, (p) => ({ ...p, frame: b.frame.frame }))
                 // Watchers get at most about FRAMES_PER_S frames a second, however fast the session plays.
                 if (b.frame.frame % frameStep((yield* SubscriptionRef.get(control)).speed, fps) !== 0) return
PATCH
```

- [ ] **Step 4: Run the tests**

Run: `pnpm --filter @touchline/api test && pnpm --filter @touchline/api typecheck`
Expected: 38 passed, no type errors

- [ ] **Step 5: Commit**

```bash
git add apps/api
git commit -m "feat(api): goals reach the scoreboard at once, and each session measures event-to-scoreboard latency

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Studio queue

The heart of the studio console (spec §5.6), in `apps/api/src/studio.ts`.
- **Recording:** `record` runs for every session's life. It subscribes before play starts, so no moment is missed. Each `cues` beat of a moment or recap becomes a queue entry, pending, with all its segment variants. A moment that arrives in parts (live agents) is merged.
- **Facts:** the entry's facts come from the evidence as of the moment's frame (`Cause: …`, then each checked metric claim with its subject). Live sessions answer from what their own agents wrote.
- **Actions:** `act` approves, holds or sends, and publishes the change on the bus. Sending also publishes the cues as an `air` beat. An unknown moment fails with `NotQueued`.
- **Producer view:** `queueItem` builds one producer's view of an entry. It picks the cue to air with the fan app's fallbacks (never another club's framing). The talking points are the analyst variant's text in the producer's language, one sentence each, then the facts.

**Files:**
- Create: `apps/api/src/studio.ts`
- Modify: `apps/api/src/session.ts` (`QueueEntry`, the `queue` and `air` beats, `Session.queue`, the `studio` recorder option)
- Test: `apps/api/test/studio.test.ts`

**Interfaces:**
- Consumes: `makeEvidence` and its `View` (Plan 5a), `pickCues`, `Session`, `BusBeat`, `QueueItem`, `StudioAction`, `NotQueued` (Task 1).
- Produces:
  - In `session.ts`: `QueueEntry` (`moment_id`, `frame`, `clock`, `status`, `cues`, `facts`), the `BusBeat` kinds `queue` (`entry`) and `air` (`frame`, `cues`), `Session.queue: Ref<ReadonlyMap<string, QueueEntry>>`, `Recorder`, and `makeSessions(library, { companion?, studio? })`.
  - In `studio.ts`: `talkingPoints(text, facts)`, `queueItem(entry, segment)`, and `makeStudio(ev)` returning `{ record, act }`. `act(s, momentId, action)` returns `{ moment_id, status }`.

- [ ] **Step 1: Write the failing tests**

Create `apps/api/test/studio.test.ts`:

```ts
import { Effect, Exit, Fiber, Ref, Stream } from "effect"
import { TestClock } from "effect/testing"
import { beforeAll, describe, expect, it } from "vitest"
import { makeEvidence } from "../src/evidence.js"
import { readMatch, type LibraryMatch } from "../src/library.js"
import { makeSessions, type QueueEntry } from "../src/session.js"
import { makeStudio, queueItem, talkingPoints } from "../src/studio.js"
import { league, makeLibrary, MATCH_ID, type TestLibrary } from "./fixture.js"

let lib: TestLibrary
let match: LibraryMatch
beforeAll(async () => {
  lib = await makeLibrary()
  match = readMatch(lib.run, league)
}, 120_000)

const run = <A, E>(e: Effect.Effect<A, E, import("effect").Scope.Scope>) => Effect.runPromise(e.pipe(Effect.scoped, Effect.provide(TestClock.layer())))

/** Advance the clock (with real I/O in between) until `done` holds. */
const until = (done: () => Effect.Effect<boolean>, maxSeconds = 300) =>
  Effect.gen(function* () {
    for (let t = 0; t < maxSeconds * 1000 && !(yield* done()); t += 50) {
      yield* Effect.promise(() => new Promise((r) => setTimeout(r, 1)))
      yield* TestClock.adjust("50 millis")
    }
  })

const casual = { mode: "casual", lang: "en", club: null } as const
const spanish = { mode: "casual", lang: "es", club: null } as const

/** A session from just before the first goal, with the studio recording its queue; resolves once the goal is queued with its facts. */
const queued = Effect.gen(function* () {
  const studio = makeStudio(makeEvidence(new Map([[MATCH_ID, match]])))
  const sessions = yield* makeSessions(new Map([[MATCH_ID, match]]), { studio: studio.record })
  const goal = lib.goals[0]!
  const s = yield* sessions.start(match, { speed: 64, fromMinute: Math.floor(goal.frame_id / 600), live: false })
  const w = yield* sessions.watch(s.id, casual).pipe(Stream.runDrain, Effect.forkChild) // someone watches, so the session plays on
  const id = `mo-${goal.id}`
  yield* until(() => Effect.map(Ref.get(s.queue), (q) => (q.get(id)?.facts.length ?? 0) > 0))
  return { studio, sessions, s, w, id, goal }
})

describe("studio queue", () => {
  it("queues each moment as it reaches the bus, pending, with its checked facts", () =>
    run(
      Effect.gen(function* () {
        const { s, id, goal } = yield* queued
        const entry = (yield* Ref.get(s.queue)).get(id)!
        expect([entry.status, entry.frame, entry.cues.length]).toEqual(["pending", goal.frame_id, 3])
        expect(entry.facts).toContain("Cause: clear chance converted")
        expect(entry.facts.some((f) => f.startsWith("Momentum") && f.endsWith(": 60%"))).toBe(true)
      })
    ), 180_000)

  it("approves, holds and sends to graphics, and tells everyone on the bus", () =>
    run(
      Effect.gen(function* () {
        const { studio, s, id } = yield* queued
        const seen = yield* Stream.fromPubSub(s.bus).pipe(Stream.filter((b) => b.kind === "queue" || b.kind === "air"), Stream.take(4), Stream.runCollect, Effect.forkChild)
        yield* Effect.yieldNow
        expect(yield* studio.act(s, id, "approve")).toEqual({ moment_id: id, status: "approved" })
        expect(yield* studio.act(s, id, "hold")).toEqual({ moment_id: id, status: "held" })
        expect(yield* studio.act(s, id, "send")).toEqual({ moment_id: id, status: "on_air" })
        const beats = [...(yield* Fiber.join(seen))]
        expect(beats.map((b) => (b.kind === "queue" ? b.entry.status : b.kind))).toEqual(["approved", "held", "on_air", "air"])
        const air = beats[3]!
        expect(air.kind === "air" && air.cues.map((c) => c.moment_id)).toEqual([id, id, id])
        const lost = yield* Effect.exit(studio.act(s, "nope", "send"))
        expect(Exit.isFailure(lost) && JSON.stringify(lost.cause)).toContain("NotQueued")
      })
    ), 180_000)
})

describe("queue items", () => {
  const entry = (): QueueEntry => ({
    moment_id: "mo-1", frame: 100, clock: "01:00", status: "approved", cues: lib.cues.filter((c) => c.moment_id === `mo-${lib.goals[0]!.id}`), facts: ["Cause: clear chance converted"]
  })

  it("show each producer the variant for their segment and the analyst text in their language", () => {
    const es = queueItem(entry(), spanish)
    expect(es.cue?.segment).toEqual(casual) // no casual Spanish variant: English neutral is the fallback
    expect(es.points[0]).toBe("Goal (analyst es)") // the analyst headline in Spanish
    expect(es.points.at(-1)).toBe("Cause: clear chance converted")
    expect(es.variants).toBe(3)
    expect(queueItem(entry(), casual).points).toEqual(["Cause: clear chance converted"]) // no English analyst text was written
  })

  it("split analyst text into one talking point per sentence", () => {
    expect(talkingPoints({ headline: "Press wins it.", body: "Two passes. Then a shot!" }, ["Cause: x"])).toEqual(["Press wins it.", "Two passes.", "Then a shot!", "Cause: x"])
  })
})
```

- [ ] **Step 2: Run them to make sure they fail**

Run: `pnpm --filter @touchline/api exec vitest run test/studio.test.ts`
Expected: the file fails to load: `Cannot find module '../src/studio.js'`

- [ ] **Step 3: Record the queue and act on it**

Create `apps/api/src/studio.ts`:

```ts
/**
 * The studio console (spec §5.6): every moment that reaches a session's bus joins its queue, pending. A producer
 * approves it (it joins the presenter's talking points), holds it, or sends it to graphics (it airs on the broadcast
 * output). Talking points are the analyst text in the producer's language plus the facts its claims were checked
 * against: no model writes them, so every number in them is already verified.
 */
import { Effect, PubSub, Ref } from "effect"
import { NotQueued, type QueueItem, type QueueStatus, type StudioAction } from "@touchline/rpc"
import type { Segment } from "@touchline/schema"
import { pickCues } from "./cues.js"
import type { makeEvidence } from "./evidence.js"
import type { BusBeat, QueueEntry, Session } from "./session.js"

/** The analyst text as talking points (one per sentence), then the checked facts. */
export const talkingPoints = (text: { readonly headline: string; readonly body: string } | null, facts: ReadonlyArray<string>): string[] => [
  ...(text ? [text.headline, ...text.body.split(/(?<=[.!?।])\s+/).filter((x) => x.trim())] : []),
  ...facts
]

/** A queue entry as one producer's segment sees it: the variant that would air, and the talking points in its language. */
export const queueItem = (e: QueueEntry, segment: Segment): QueueItem => {
  const analyst = pickCues(e.cues, { ...segment, mode: "analyst" })[0]
  return {
    moment_id: e.moment_id,
    frame: e.frame,
    clock: e.clock,
    status: e.status,
    cue: pickCues(e.cues, segment)[0] ?? null,
    points: talkingPoints(analyst?.text ?? null, e.facts),
    variants: e.cues.length
  }
}

const next = (status: QueueStatus, action: StudioAction): QueueStatus => (action === "approve" ? "approved" : action === "hold" ? "held" : "on_air")

export const makeStudio = (ev: ReturnType<typeof makeEvidence>) => {
  /** The facts behind a moment, as the session saw them when it reached the moment (none if it has no evidence). */
  const facts = (s: Session, e: QueueEntry) =>
    ev.evidence(s.match.info.match_id, e.cues[0]!.cue_id, { frame: e.frame, live: s.live ? s.agents : null }).pipe(
      Effect.map((x) => [
        ...(x.cause ? [`Cause: ${x.cause}`] : []),
        ...x.claims.filter((c) => c.kind === "metric").map((c) => `${c.label}${c.subject_name ? ` (${c.subject_name})` : ""}: ${c.quote || c.value}`)
      ]),
      Effect.orElseSucceed((): string[] => [])
    )

  const put = (s: Session, e: QueueEntry) =>
    Ref.update(s.queue, (q) => new Map([...q, [e.moment_id, e]])).pipe(Effect.andThen(PubSub.publish(s.bus, { kind: "queue", entry: e })))

  /** Queue every moment that reaches the bus (a moment that arrives in parts is merged), then add its facts. */
  const record = (s: Session, sub: PubSub.Subscription<BusBeat>) =>
    Effect.gen(function* () {
      while (true) {
        const b = yield* PubSub.take(sub)
        if (b.kind !== "cues" || b.cues.length === 0 || b.cues[0]!.moment_id === null) continue
        const first = b.cues[0]!
        const id = first.moment_id!
        const had = (yield* Ref.get(s.queue)).get(id)
        const entry: QueueEntry = had
          ? { ...had, cues: [...had.cues, ...b.cues] }
          : { moment_id: id, frame: first.anchor.frame_to, clock: first.anchor.clock, status: "pending", cues: b.cues, facts: [] }
        yield* put(s, entry)
        if (!had) {
          yield* Effect.forkChild(
            Effect.gen(function* () {
              const found = yield* facts(s, entry)
              const now = (yield* Ref.get(s.queue)).get(id)!
              yield* put(s, { ...now, facts: found })
            })
          )
        }
      }
    })

  /** A producer's decision on a queued moment; sending puts its cues on air for every graphics output. */
  const act = (s: Session, momentId: string, action: StudioAction) =>
    Effect.gen(function* () {
      const e = (yield* Ref.get(s.queue)).get(momentId)
      if (!e) return yield* new NotQueued({ moment_id: momentId })
      const status = next(e.status, action)
      yield* put(s, { ...e, status })
      if (action === "send") yield* PubSub.publish(s.bus, { kind: "air", frame: (yield* Ref.get(s.playback)).frame, cues: e.cues })
      return { moment_id: momentId, status }
    })

  return { record, act } as const
}
```

Apply this change to `apps/api/src/session.ts` (from the repository root):

```bash
git apply <<'PATCH'
diff --git a/apps/api/src/session.ts b/apps/api/src/session.ts
index 3305d5f..9918a56 100644
--- a/apps/api/src/session.ts
+++ b/apps/api/src/session.ts
@@ -7,7 +7,7 @@ import { randomUUID } from "node:crypto"
 import { readFileSync } from "node:fs"
 import { join } from "node:path"
 import { Cause, Deferred, Effect, Fiber, PubSub, Ref, Stream, SubscriptionRef } from "effect"
-import { SessionNotFound, type Playback, type Tick } from "@touchline/rpc"
+import { SessionNotFound, type Playback, type QueueStatus, type Tick } from "@touchline/rpc"
 import { segmentKey, type Cue, type MomentTrace, type Recap, type Segment } from "@touchline/schema"
 import { pickCues } from "./cues.js"
 import type { LibraryMatch } from "./library.js"
@@ -23,8 +23,26 @@ export const FRAMES_PER_S = 25
 /** Which frames a session at `speed` sends: every `frameStep`th. */
 export const frameStep = (speed: number, fps: number): number => Math.max(1, Math.floor((speed * fps) / FRAMES_PER_S))
 
-/** What a session's bus carries: the timeline, then `closed` once nothing more will come (live agents included). */
-export type BusBeat = Beat | { readonly kind: "closed" }
+/** A moment (or recap) in the session's studio queue: all its segment variants, and the facts its claims were checked against. */
+export interface QueueEntry {
+  readonly moment_id: string
+  readonly frame: number
+  readonly clock: string
+  readonly status: QueueStatus
+  readonly cues: ReadonlyArray<Cue>
+  /** Talking points from the evidence ("Cause: …", "Pressure index (Larkspur City): 0.71"), in English. */
+  readonly facts: ReadonlyArray<string>
+}
+
+/**
+ * What a session's bus carries: the timeline; studio queue changes and cues sent to air; then `closed` once nothing
+ * more will come (live agents included).
+ */
+export type BusBeat =
+  | Beat
+  | { readonly kind: "queue"; readonly entry: QueueEntry }
+  | { readonly kind: "air"; readonly frame: number; readonly cues: ReadonlyArray<Cue> }
+  | { readonly kind: "closed" }
 
 /** What a session measures for the ops view (wall-clock milliseconds). */
 export interface Metrics {
@@ -78,6 +96,8 @@ export interface Session {
   /** What the live agents wrote (empty for a recorded session). */
   readonly agents: LiveStore
   readonly metrics: Metrics
+  /** The studio queue, by moment. */
+  readonly queue: Ref.Ref<ReadonlyMap<string, QueueEntry>>
   readonly watchers: Ref.Ref<number>
   /** The segments watched so far (live agents write cues for these). */
   readonly segments: Ref.Ref<ReadonlyMap<string, Segment>>
@@ -92,8 +112,11 @@ export interface StartOptions {
 /** Runs alongside a live session's playback (Task 7: live agents); receives the session. */
 export type Companion = (s: Session) => Effect.Effect<void>
 
+/** Runs for every session's life, reading its bus from before play starts (the studio queue). */
+export type Recorder = (s: Session, sub: PubSub.Subscription<BusBeat>) => Effect.Effect<void>
+
 /** The sessions of one API process. Their fibers live in `scope`. */
-export const makeSessions = (library: ReadonlyMap<string, LibraryMatch>, options: { readonly companion?: Companion } = {}) =>
+export const makeSessions = (library: ReadonlyMap<string, LibraryMatch>, options: { readonly companion?: Companion; readonly studio?: Recorder } = {}) =>
   Effect.gen(function* () {
     const scope = yield* Effect.scope
     const sessions = new Map<string, Session>()
@@ -122,8 +145,9 @@ export const makeSessions = (library: ReadonlyMap<string, LibraryMatch>, options
         const watchers = yield* Ref.make(0)
         const segments = yield* Ref.make<ReadonlyMap<string, Segment>>(new Map())
         const closed = yield* Ref.make(false)
+        const queue = yield* Ref.make<ReadonlyMap<string, QueueEntry>>(new Map())
         const ended = yield* Deferred.make<void>()
-        const s: Session = { id, match, live: o.live, control, bus, playback, closed, agents: { cues: [], traces: [], recaps: [] }, metrics: { stats: [] }, watchers, segments }
+        const s: Session = { id, match, live: o.live, control, bus, playback, closed, agents: { cues: [], traces: [], recaps: [] }, metrics: { stats: [] }, queue, watchers, segments }
         const end = (frame: number) =>
           Ref.update(playback, (p): Playback => ({ ...p, state: "ended", frame })).pipe(Effect.andThen(PubSub.publish(bus, { kind: "end", frame })))
         // A live session shows the agents' cues as they are written, never the cache's.
@@ -159,7 +183,13 @@ export const makeSessions = (library: ReadonlyMap<string, LibraryMatch>, options
               Effect.raceFirst(Deferred.await(ended).pipe(Effect.andThen(Effect.sleep(`${LIVE_GRACE_S} seconds`))))
             )
           : Effect.void
-        const main = Effect.all([play, agents], { concurrency: "unbounded", discard: true }).pipe(
+        // The studio subscribes before play starts, so it sees every moment; it stops when the session closes.
+        const studio = Effect.gen(function* () {
+          const sub = yield* PubSub.subscribe(bus)
+          if (options.studio) yield* Effect.forkScoped(options.studio(s, sub))
+          yield* Effect.all([play, agents], { concurrency: "unbounded", discard: true })
+        }).pipe(Effect.scoped)
+        const main = studio.pipe(
           Effect.andThen(Ref.set(closed, true)),
           Effect.andThen(PubSub.publish(bus, { kind: "closed" })),
           Effect.andThen(Effect.sleep("60 seconds")), // let late requests (evidence, recap) see the ended session
@@ -189,6 +219,8 @@ export const makeSessions = (library: ReadonlyMap<string, LibraryMatch>, options
         case "cues":
           return pickCues(b.cues, segment).map((cue) => ({ kind: "cue" as const, cue }))
         case "signals":
+        case "queue":
+        case "air":
         case "closed":
           return []
         case "end":
PATCH
```

- [ ] **Step 4: Run the tests**

Run: `pnpm --filter @touchline/api test && pnpm --filter @touchline/api typecheck`
Expected: 42 passed, no type errors

- [ ] **Step 5: Commit**

```bash
git add apps/api
git commit -m "feat(api): studio queue — every moment queued as it reaches the bus, approve/hold/send to graphics, talking points from the analyst text and the checked facts

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Studio console and graphics output streams

Two more streams of a session's bus, with their RPCs.
- **`follow(id, segment, open, map)`:** the shape `Watch` already had, generalised. It subscribes before checking whether the session has closed, sends what `open` returns, then maps every beat until the session closes. It counts as a watcher.
- **`StudioWatch`:** playback and the queue so far (oldest first) for the producer's segment, then every queue change, every agent cue as it arrives (the raw feed) and the end.
- **`WatchGraphics`:** the scoreboard, the cues sent to air (picked for the segment) and the end. No frames: the graphics go over the broadcast picture.
- **`StudioAct`:** the producer's decision.
- **A test hardened along the way:** Plan 5a's pause test now waits until playback has started before it counts frames. On a loaded machine the run's files could take longer to read than the test's first second.

**Files:**
- Modify: `packages/rpc/src/contracts.ts` (the three RPCs), `apps/api/src/session.ts` (`follow`, `graphics`), `apps/api/src/studio.ts` (`watch`), `apps/api/src/server.ts`
- Test: `packages/rpc/test/contracts.test.ts`, `apps/api/test/studio.test.ts`, `apps/api/test/server.test.ts`, `apps/api/test/session.test.ts`

**Interfaces:**
- Consumes: `makeStudio` (Task 3), `StudioTick`, `QueueStatus`, `StudioAction`, `NotQueued` (Task 1).
- Produces:
  - RPCs `StudioWatch {session_id, segment}` (stream of `StudioTick`), `StudioAct {session_id, moment_id, action}` (→ `{moment_id, status}`, errors `SessionNotFound | NotQueued`), `WatchGraphics {session_id, segment}` (stream of `Tick`).
  - `Sessions.follow`, `Sessions.graphics(id, segment)`, `makeStudio(ev).watch(sessions, id, segment)`.

- [ ] **Step 1: Write the failing tests**

Apply this change to `apps/api/test/server.test.ts`, `apps/api/test/session.test.ts`, `apps/api/test/studio.test.ts`, `packages/rpc/test/contracts.test.ts` (from the repository root):

```bash
git apply <<'PATCH'
diff --git a/apps/api/test/server.test.ts b/apps/api/test/server.test.ts
index 7d9d405..211f847 100644
--- a/apps/api/test/server.test.ts
+++ b/apps/api/test/server.test.ts
@@ -80,6 +80,20 @@ describe("API over WebSocket", () => {
     expect(recap.cards).toHaveLength(goal.period === "first_half" ? 0 : 1)
   }, 120_000)
 
+  it("serves the studio console and refuses actions on moments not queued", async () => {
+    const goal = lib.goals[0]!
+    const { first, lost } = await client((c) =>
+      Effect.gen(function* () {
+        const s = yield* c.StartSession({ match_id: MATCH_ID, speed: 4, from_minute: Math.floor(goal.frame_id / 600), live: false })
+        const first = yield* c.StudioWatch({ session_id: s.session_id, segment: { mode: "casual", lang: "en", club: null } }).pipe(Stream.take(1), Stream.runCollect)
+        const lost = yield* Effect.exit(c.StudioAct({ session_id: s.session_id, moment_id: "nope", action: "send" }))
+        return { first: [...first], lost }
+      })
+    )
+    expect(first[0]!.kind).toBe("playback")
+    expect(Exit.isFailure(lost) && JSON.stringify(lost.cause)).toContain("NotQueued")
+  }, 120_000)
+
   it("refuses to watch an unknown session", async () => {
     const lost = await client((c) => Effect.exit(Stream.runDrain(c.Watch({ session_id: "nope", segment: { mode: "casual", lang: "en", club: null } }))))
     expect(Exit.isFailure(lost) && JSON.stringify(lost.cause)).toContain("SessionNotFound")
diff --git a/apps/api/test/session.test.ts b/apps/api/test/session.test.ts
index 0ec7d03..5255425 100644
--- a/apps/api/test/session.test.ts
+++ b/apps/api/test/session.test.ts
@@ -71,6 +71,11 @@ describe("sessions", () => {
         const sessions = yield* makeSessions(library())
         const s = yield* sessions.start(match, { speed: 1, fromMinute: 0, live: false })
         const w = yield* sessions.watch(s.id, home).pipe(Stream.runDrain, Effect.forkChild)
+        // Let playback start first (it reads the run's files before its first frame), however slow the machine.
+        for (let t = 0; t < 300_000 && (yield* Ref.get(s.playback)).frame === 0; t += 50) {
+          yield* Effect.promise(() => new Promise((r) => setImmediate(r)))
+          yield* TestClock.adjust("50 millis")
+        }
         yield* advance(10)
         const p = yield* sessions.control(s.id, "pause", null)
         expect(p.state).toBe("paused")
diff --git a/apps/api/test/studio.test.ts b/apps/api/test/studio.test.ts
index 922e283..7f1e9b6 100644
--- a/apps/api/test/studio.test.ts
+++ b/apps/api/test/studio.test.ts
@@ -71,6 +71,35 @@ describe("studio queue", () => {
     ), 180_000)
 })
 
+describe("studio and graphics streams", () => {
+  it("give a producer who joins late the queue so far, in their language", () =>
+    run(
+      Effect.gen(function* () {
+        const { studio, sessions, s, id } = yield* queued
+        const ticks = [...(yield* studio.watch(sessions, s.id, spanish).pipe(Stream.take(2), Stream.runCollect))]
+        expect(ticks[0]!.kind).toBe("playback")
+        const first = ticks[1]!
+        expect(first.kind === "queue" && [first.item.moment_id, first.item.status, first.item.points[0]]).toEqual([id, "pending", "Goal (analyst es)"])
+      })
+    ), 180_000)
+
+  it("put on the graphics output the scoreboard and only the cues the producer sent", () =>
+    run(
+      Effect.gen(function* () {
+        const { studio, sessions, s, id } = yield* queued
+        const out = yield* sessions.graphics(s.id, casual).pipe(Stream.takeUntil((t) => t.kind === "cue" && t.cue.moment_id !== null), Stream.runCollect, Effect.forkChild)
+        yield* until(() => Effect.succeed(false), 2) // a few seconds of play: scoreboards only
+        yield* studio.act(s, id, "send")
+        yield* until(() => Effect.sync(() => out.pollUnsafe() !== undefined), 30)
+        const ticks = [...(yield* Fiber.join(out))]
+        expect(ticks.some((t) => t.kind === "frame")).toBe(false) // graphics go over the broadcast picture: no pitch
+        expect(ticks.filter((t) => t.kind === "cue" && t.cue.moment_id === null).length).toBeGreaterThan(0) // scoreboards
+        const aired = ticks.at(-1)!
+        expect(aired.kind === "cue" && [aired.cue.moment_id, aired.cue.segment]).toEqual([id, casual])
+      })
+    ), 180_000)
+})
+
 describe("queue items", () => {
   const entry = (): QueueEntry => ({
     moment_id: "mo-1", frame: 100, clock: "01:00", status: "approved", cues: lib.cues.filter((c) => c.moment_id === `mo-${lib.goals[0]!.id}`), facts: ["Cause: clear chance converted"]
diff --git a/packages/rpc/test/contracts.test.ts b/packages/rpc/test/contracts.test.ts
index 87bb779..f513bc9 100644
--- a/packages/rpc/test/contracts.test.ts
+++ b/packages/rpc/test/contracts.test.ts
@@ -26,7 +26,7 @@ describe("API contracts", () => {
   })
 
   it("offer the endpoints of spec §5.7", () => {
-    expect([...TouchlineRpcs.requests.keys()].sort()).toEqual(["Control", "GetEvidence", "GetMatch", "GetRecap", "ListMatches", "StartSession", "Watch"])
+    expect([...TouchlineRpcs.requests.keys()].sort()).toEqual(["Control", "GetEvidence", "GetMatch", "GetRecap", "ListMatches", "StartSession", "StudioAct", "StudioWatch", "Watch", "WatchGraphics"])
   })
 
   it("refuse playback speeds out of range", () => {
PATCH
```

- [ ] **Step 2: Run them to make sure they fail**

Run: `pnpm --filter @touchline/rpc test`
Expected: 1 test fails: the endpoint list lacks `StudioAct`, `StudioWatch` and `WatchGraphics`

Run: `pnpm --filter @touchline/api exec vitest run test/studio.test.ts test/server.test.ts`
Expected: 3 tests fail: `c.StudioWatch is not a function`, `studio.watch is not a function`, `sessions.graphics is not a function`

- [ ] **Step 3: Follow the bus for the studio and the graphics**

Apply this change to `apps/api/src/server.ts`, `apps/api/src/session.ts`, `apps/api/src/studio.ts`, `packages/rpc/src/contracts.ts` (from the repository root):

```bash
git apply <<'PATCH'
diff --git a/apps/api/src/server.ts b/apps/api/src/server.ts
index 5f14d76..b46b900 100644
--- a/apps/api/src/server.ts
+++ b/apps/api/src/server.ts
@@ -11,6 +11,7 @@ import { MatchNotFound, TouchlineRpcs, type MatchSummary } from "@touchline/rpc"
 import { makeEvidence } from "./evidence.js"
 import type { LibraryMatch } from "./library.js"
 import { makeSessions, type Companion } from "./session.js"
+import { makeStudio } from "./studio.js"
 
 export const RPC_PATH = "/rpc"
 
@@ -26,8 +27,9 @@ const summary = ({ players: _, ...s }: LibraryMatch["info"]): MatchSummary => s
 export const handlersLayer = (o: ApiOptions) =>
   Layer.unwrap(
     Effect.gen(function* () {
-      const sessions = yield* makeSessions(o.library, o.companion ? { companion: o.companion } : {})
       const ev = makeEvidence(o.library)
+      const studio = makeStudio(ev)
+      const sessions = yield* makeSessions(o.library, { ...(o.companion ? { companion: o.companion } : {}), studio: studio.record })
       const match = (id: string) => Effect.fromNullishOr(o.library.get(id)).pipe(Effect.mapError(() => new MatchNotFound({ match_id: id })))
       /** A session and what it has reached: answers never go past its frame. */
       const view = (id: string) =>
@@ -43,7 +45,10 @@ export const handlersLayer = (o: ApiOptions) =>
         Watch: ({ session_id, segment }) => sessions.watch(session_id, segment),
         Control: ({ session_id, action, speed }) => sessions.control(session_id, action, speed),
         GetEvidence: ({ session_id, cue_id }) => view(session_id).pipe(Effect.flatMap(({ s, v }) => ev.evidence(s.match.info.match_id, cue_id, v))),
-        GetRecap: ({ session_id, kind, segment }) => view(session_id).pipe(Effect.flatMap(({ s, v }) => ev.recap(s.match.info.match_id, kind, segment, v)))
+        GetRecap: ({ session_id, kind, segment }) => view(session_id).pipe(Effect.flatMap(({ s, v }) => ev.recap(s.match.info.match_id, kind, segment, v))),
+        StudioWatch: ({ session_id, segment }) => studio.watch(sessions, session_id, segment),
+        StudioAct: ({ session_id, moment_id, action }) => sessions.get(session_id).pipe(Effect.flatMap((s) => studio.act(s, moment_id, action))),
+        WatchGraphics: ({ session_id, segment }) => sessions.graphics(session_id, segment)
       })
     })
   )
diff --git a/apps/api/src/session.ts b/apps/api/src/session.ts
index 9918a56..2bca2d5 100644
--- a/apps/api/src/session.ts
+++ b/apps/api/src/session.ts
@@ -228,25 +228,53 @@ export const makeSessions = (library: ReadonlyMap<string, LibraryMatch>, options
       }
     }
 
-    /** The session's ticks for one segment, from now until the session closes; the session stops when nobody watches. */
-    const watch = (id: string, segment: Segment) =>
+    /**
+     * What a session's bus brings one viewer, mapped by `map`, after `open` (what to send first, given playback now),
+     * until the session closes. A viewer counts as a watcher (the session stops when nobody watches) and its segment
+     * gets live cues.
+     */
+    const follow = <A>(
+      id: string,
+      segment: Segment,
+      open: (s: Session, now: Playback) => Effect.Effect<ReadonlyArray<A>>,
+      map: (s: Session) => (b: BusBeat) => ReadonlyArray<A>
+    ) =>
       Stream.unwrap(
         Effect.gen(function* () {
           const s = yield* get(id)
           // Subscribe before looking at `closed`, so the closing beat cannot slip between the two.
           const sub = yield* PubSub.subscribe(s.bus)
-          const now = yield* Ref.get(s.playback)
-          if (yield* Ref.get(s.closed)) return Stream.make({ kind: "playback", playback: now } as Tick)
+          const first = yield* open(s, yield* Ref.get(s.playback))
+          if (yield* Ref.get(s.closed)) return Stream.fromIterable(first)
           yield* Ref.update(s.watchers, (n) => n + 1)
           yield* Ref.update(s.segments, (m) => new Map([...m, [segmentKey(segment), segment]]))
           const leave = Ref.updateAndGet(s.watchers, (n) => n - 1).pipe(Effect.flatMap((n) => (n > 0 ? Effect.void : stopIfIdle(s))), Effect.asVoid)
-          return Stream.make({ kind: "playback", playback: now } as Tick).pipe(
-            Stream.concat(Stream.fromSubscription(sub).pipe(Stream.takeUntil((b) => b.kind === "closed"), Stream.map(toTicks(s, segment)), Stream.flattenIterable)),
+          return Stream.fromIterable(first).pipe(
+            Stream.concat(Stream.fromSubscription(sub).pipe(Stream.takeUntil((b) => b.kind === "closed"), Stream.map(map(s)), Stream.flattenIterable)),
             Stream.ensuring(leave)
           )
         })
       )
 
+    const playbackNow = (_: Session, now: Playback) => Effect.succeed([{ kind: "playback", playback: now } as Tick])
+
+    /** The session's ticks for one segment, from now until the session closes. */
+    const watch = (id: string, segment: Segment) => follow(id, segment, playbackNow, (s) => toTicks(s, segment))
+
+    /** The broadcast graphics output: the scoreboard and the cues the producer sent to air (picked for the segment), no pitch. */
+    const graphics = (id: string, segment: Segment) =>
+      follow(id, segment, playbackNow, (s) => (b): Tick[] => {
+        switch (b.kind) {
+          case "board":
+          case "end":
+            return toTicks(s, segment)(b)
+          case "air":
+            return pickCues(b.cues, segment).map((cue) => ({ kind: "cue" as const, cue }))
+          default:
+            return []
+        }
+      })
+
     const control = (id: string, action: "play" | "pause" | "speed", speed: number | null) =>
       Effect.gen(function* () {
         const s = yield* get(id)
@@ -255,7 +283,7 @@ export const makeSessions = (library: ReadonlyMap<string, LibraryMatch>, options
         return yield* Ref.updateAndGet(s.playback, (p): Playback => (p.state === "ended" ? p : { ...p, state: c.paused ? "paused" : "playing", speed: c.speed }))
       })
 
-    return { library, start, get, watch, control, stop, count: () => sessions.size } as const
+    return { library, start, get, follow, watch, graphics, control, stop, count: () => sessions.size } as const
   })
 
 export type Sessions = Effect.Success<ReturnType<typeof makeSessions>>
diff --git a/apps/api/src/studio.ts b/apps/api/src/studio.ts
index 788e633..e13f82d 100644
--- a/apps/api/src/studio.ts
+++ b/apps/api/src/studio.ts
@@ -5,11 +5,11 @@
  * against: no model writes them, so every number in them is already verified.
  */
 import { Effect, PubSub, Ref } from "effect"
-import { NotQueued, type QueueItem, type QueueStatus, type StudioAction } from "@touchline/rpc"
+import { NotQueued, type QueueItem, type QueueStatus, type StudioAction, type StudioTick } from "@touchline/rpc"
 import type { Segment } from "@touchline/schema"
 import { pickCues } from "./cues.js"
 import type { makeEvidence } from "./evidence.js"
-import type { BusBeat, QueueEntry, Session } from "./session.js"
+import type { BusBeat, QueueEntry, Session, Sessions } from "./session.js"
 
 /** The analyst text as talking points (one per sentence), then the checked facts. */
 export const talkingPoints = (text: { readonly headline: string; readonly body: string } | null, facts: ReadonlyArray<string>): string[] => [
@@ -83,5 +83,29 @@ export const makeStudio = (ev: ReturnType<typeof makeEvidence>) => {
       return { moment_id: momentId, status }
     })
 
-  return { record, act } as const
+  /** The studio console's stream: playback and the queue so far, then each queue change, every agent cue as it arrives (raw feed) and the end. */
+  const watch = (sessions: Sessions, id: string, segment: Segment) =>
+    sessions.follow(
+      id,
+      segment,
+      (s, now) =>
+        Effect.map(Ref.get(s.queue), (q): StudioTick[] => [
+          { kind: "playback", playback: now },
+          ...[...q.values()].sort((a, b) => a.frame - b.frame).map((e) => ({ kind: "queue" as const, item: queueItem(e, segment) }))
+        ]),
+      (s) => (b): StudioTick[] => {
+        switch (b.kind) {
+          case "queue":
+            return [{ kind: "queue", item: queueItem(b.entry, segment) }]
+          case "cues":
+            return b.cues.map((cue) => ({ kind: "cue" as const, cue }))
+          case "end":
+            return [{ kind: "playback", playback: { state: "ended", frame: b.frame, speed: 0, live: s.live } }]
+          default:
+            return []
+        }
+      }
+    )
+
+  return { record, act, watch } as const
 }
diff --git a/packages/rpc/src/contracts.ts b/packages/rpc/src/contracts.ts
index f3df1e4..5f3ac42 100644
--- a/packages/rpc/src/contracts.ts
+++ b/packages/rpc/src/contracts.ts
@@ -225,7 +225,17 @@ export class TouchlineRpcs extends RpcGroup.make(
     payload: { session_id: Schema.String, kind: Schema.Literals(["half_time", "full_time"]), segment: Segment },
     success: RecapView,
     error: Schema.Union([SessionNotFound, MatchNotFound])
-  })
+  }),
+  /** The studio console's stream for one producer segment: the queue so far, then every change, raw cues and playback. */
+  Rpc.make("StudioWatch", { payload: { session_id: Schema.String, segment: Segment }, success: StudioTick, error: SessionNotFound, stream: true }),
+  /** A producer's decision on a queued moment; every studio console of the session sees the change. */
+  Rpc.make("StudioAct", {
+    payload: { session_id: Schema.String, moment_id: Schema.String, action: StudioAction },
+    success: Schema.Struct({ moment_id: Id, status: QueueStatus }),
+    error: Schema.Union([SessionNotFound, NotQueued])
+  }),
+  /** The broadcast graphics output for a segment: the scoreboard and the cues the producer sent, nothing else. */
+  Rpc.make("WatchGraphics", { payload: { session_id: Schema.String, segment: Segment }, success: Tick, error: SessionNotFound, stream: true })
 ) {}
 
 export const decodeTick = Schema.decodeUnknownSync(Tick)
PATCH
```

- [ ] **Step 4: Run the tests**

Run: `pnpm --filter @touchline/rpc test && pnpm --filter @touchline/api test && pnpm --filter @touchline/api typecheck`
Expected: 8 passed; 45 passed, no type errors

- [ ] **Step 5: Commit**

```bash
git add apps/api packages/rpc
git commit -m "feat(api): studio console and graphics output streams (StudioWatch, StudioAct, WatchGraphics) on one follow() shared with Watch

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Live agent metrics

The ops view needs, for live sessions:
- **Every request to the agent service:** outcome, time, cues, late and unverified.
- **Signal to cue:** the time from playing a batch's earliest signal to its cues on the bus. That is the spec's "AI insight from signal" measure. It includes the wait for the batch to fill, which is part of what a viewer waits.

The gateway exports `outcomeOf`, its existing mapping from a failure to an outcome, so live sessions log the same outcomes as `pnpm agents`. Merged batches keep their earliest signal's time.

**Files:**
- Modify: `packages/agent-gateway/src/gateway.ts`, `apps/api/src/live.ts`, `apps/api/src/session.ts` (`Metrics.insight`, `Metrics.requests`)
- Test: `packages/agent-gateway/test/gateway.test.ts`, `apps/api/test/live.test.ts`

**Interfaces:**
- Consumes: `exchange`, `RequestLog` (`@touchline/agent-gateway`), `Session.metrics` (Task 2).
- Produces:
  - `outcomeOf(e) -> Outcome` (`@touchline/agent-gateway`).
  - `Metrics.insight: number[]`, `Metrics.requests: RequestLog[]`.
  - Signal jobs carry `since` (wall-clock ms).

- [ ] **Step 1: Write the failing tests**

Apply this change to `apps/api/test/live.test.ts`, `packages/agent-gateway/test/gateway.test.ts` (from the repository root):

```bash
git apply <<'PATCH'
diff --git a/apps/api/test/live.test.ts b/apps/api/test/live.test.ts
index bf0a792..c7e48da 100644
--- a/apps/api/test/live.test.ts
+++ b/apps/api/test/live.test.ts
@@ -91,6 +91,10 @@ describe("live agents", () => {
         const ev = makeEvidence(new Map([[MATCH_ID, match]]))
         const why = yield* ev.evidence(MATCH_ID, last.kind === "cue" ? last.cue.cue_id : "", { frame: goal.frame_id, live: s.agents })
         expect([why.cause, why.model]).toEqual(["written live", "live-model"]) // the live trace, not the cache's
+        expect(s.metrics.requests.length).toBeGreaterThan(0)
+        expect(s.metrics.requests.every((r) => r.outcome === "ok" && r.ms >= 0)).toBe(true)
+        expect(s.metrics.insight.length).toBeGreaterThan(0) // signal played → cue on the bus
+        expect(s.metrics.insight.every((ms) => ms >= 0)).toBe(true)
       })
     ), 120_000)
 
@@ -155,13 +159,13 @@ describe("batches", () => {
   it("merge while a request is under way; recaps keep their place", () => {
     const sig = (f: number) => ({ id: `s${f}`, frame_id: f }) as never
     const jobs = coalesce([
-      { kind: "signals", signals: [sig(1)], frame: 10 },
-      { kind: "signals", signals: [sig(2)], frame: 20 },
+      { kind: "signals", signals: [sig(1)], frame: 10, since: 1000 },
+      { kind: "signals", signals: [sig(2)], frame: 20, since: 2000 },
       { kind: "recap", recap: "half_time", frame: 25 },
-      { kind: "signals", signals: [sig(3)], frame: 30 },
+      { kind: "signals", signals: [sig(3)], frame: 30, since: 3000 },
       { kind: "stop" }
     ])
     expect(jobs.map((j) => j.kind)).toEqual(["signals", "recap", "signals", "stop"])
-    expect(jobs[0]).toMatchObject({ frame: 20, signals: [{ id: "s1" }, { id: "s2" }] })
+    expect(jobs[0]).toMatchObject({ frame: 20, signals: [{ id: "s1" }, { id: "s2" }], since: 1000 }) // latency counts from the earliest signal
   })
 })
diff --git a/packages/agent-gateway/test/gateway.test.ts b/packages/agent-gateway/test/gateway.test.ts
index dc46872..e3482cc 100644
--- a/packages/agent-gateway/test/gateway.test.ts
+++ b/packages/agent-gateway/test/gateway.test.ts
@@ -1,7 +1,7 @@
 import { Effect } from "effect"
 import { describe, expect, it } from "vitest"
 import { TaskFailed, type Sender } from "../src/a2a.js"
-import { DEFAULT_OPTIONS, runGateway, timeline } from "../src/gateway.js"
+import { AgentFailed, AgentUnavailable, DEFAULT_OPTIONS, InvalidArtifact, outcomeOf, runGateway, timeline } from "../src/gateway.js"
 import { parseSegments, SegmentError } from "../src/segments.js"
 import { CUE, fake, plan, RECAP, TRACE } from "./fakes.js"
 
@@ -75,6 +75,15 @@ describe("gateway", () => {
   })
 })
 
+describe("outcomes", () => {
+  it("name each way a request can fail", () => {
+    expect(outcomeOf(new AgentFailed({ reason: "x" }))).toBe("failed")
+    expect(outcomeOf(new AgentUnavailable({ reason: "x" }))).toBe("unavailable")
+    expect(outcomeOf(new InvalidArtifact({ name: "cue", reason: "x" }))).toBe("invalid")
+    expect(outcomeOf({ _tag: "TimeoutError" } as never)).toBe("timeout")
+  })
+})
+
 describe("segments", () => {
   it("parse mode.lang.club and refuse anything else", () => {
     expect(parseSegments("casual.es.ironmoor, analyst.hi.neutral")).toEqual([{ mode: "casual", lang: "es", club: "ironmoor" }, { mode: "analyst", lang: "hi", club: null }])
PATCH
```

- [ ] **Step 2: Run them to make sure they fail**

Run: `pnpm --filter @touchline/agent-gateway exec vitest run test/gateway.test.ts`
Expected: 1 test fails: `outcomeOf is not a function`

Run: `pnpm --filter @touchline/api exec vitest run test/live.test.ts`
Expected: 2 tests fail: `Cannot read properties of undefined (reading 'length')` (no request log yet) and the merged batch has no `since`

- [ ] **Step 3: Log requests and measure signal to cue**

Apply this change to `apps/api/src/live.ts`, `apps/api/src/session.ts`, `packages/agent-gateway/src/gateway.ts` (from the repository root):

```bash
git apply <<'PATCH'
diff --git a/apps/api/src/live.ts b/apps/api/src/live.ts
index a57a579..03aa9e8 100644
--- a/apps/api/src/live.ts
+++ b/apps/api/src/live.ts
@@ -5,7 +5,7 @@
  * is merged into the next, so slow models fall behind by at most one batch, never more.
  */
 import { Effect, PubSub, Queue, Ref } from "effect"
-import { a2aSender, exchange, received, startMcpStats, type McpServer, type Sender } from "@touchline/agent-gateway"
+import { a2aSender, exchange, outcomeOf, received, startMcpStats, type McpServer, type Sender } from "@touchline/agent-gateway"
 import type { AgentRequest, Cue, Segment, Signal } from "@touchline/schema"
 import type { Beat } from "./playback.js"
 import type { Companion, Session } from "./session.js"
@@ -23,7 +23,8 @@ export interface LiveOptions {
 const DEFAULT_SEGMENT: Segment = { mode: "casual", lang: "en", club: null }
 
 type Job =
-  | { readonly kind: "signals"; readonly signals: Signal[]; readonly frame: number }
+  /** `since`: when the batch's earliest signal was played (wall clock, ms), for the insight latency. */
+  | { readonly kind: "signals"; readonly signals: Signal[]; readonly frame: number; readonly since: number }
   | { readonly kind: "recap"; readonly recap: "half_time" | "full_time"; readonly frame: number }
   | { readonly kind: "stop" }
 
@@ -33,7 +34,7 @@ export const coalesce = (jobs: ReadonlyArray<Job>): Job[] => {
   const out: Job[] = []
   for (const j of jobs) {
     const prev = out.at(-1)
-    if (j.kind === "signals" && prev?.kind === "signals") out[out.length - 1] = { kind: "signals", signals: [...prev.signals, ...j.signals], frame: j.frame }
+    if (j.kind === "signals" && prev?.kind === "signals") out[out.length - 1] = { kind: "signals", signals: [...prev.signals, ...j.signals], frame: j.frame, since: Math.min(prev.since, j.since) }
     else out.push(j)
   }
   return out
@@ -63,13 +64,19 @@ export const liveAgents = (o: LiveOptions): Companion => (s: Session) =>
           const base = { match_id: s.match.info.match_id, mcp_url: mcp.url, segments: yield* segments }
           const req: AgentRequest = job.kind === "signals" ? { kind: "signals", ...base, now_frame: job.frame, signals: job.signals } : { kind: "recap", ...base, recap: job.recap, at_frame: job.frame }
           const got = received()
-          yield* Effect.exit(exchange(send, req, o.budgetMs, got)) // a failed or late request still publishes what arrived in time
+          const t0 = performance.now()
+          const r = yield* Effect.result(exchange(send, req, o.budgetMs, got)) // a failed or late request still publishes what arrived in time
+          s.metrics.requests.push({
+            kind: req.kind, frame: job.frame, outcome: r._tag === "Success" ? "ok" : outcomeOf(r.failure), ms: performance.now() - t0,
+            cues: got.cues.length, late: got.late, unverified: got.unverified
+          })
           // Kept for "Why?" and the recap panel: a live session answers from what its agents wrote.
           s.agents.cues.push(...got.cues)
           s.agents.traces.push(...got.traces)
           s.agents.recaps.push(...got.recaps)
           const now = (yield* Ref.get(s.playback)).frame
           yield* publish(now, got.cues)
+          if (job.kind === "signals" && got.cues.length) s.metrics.insight.push(performance.now() - job.since)
         }
       }
     })
@@ -77,6 +84,7 @@ export const liveAgents = (o: LiveOptions): Companion => (s: Session) =>
     // Feeder: cut the signals into batches as play passes each batch's end; recaps at the whistles.
     const feed = Effect.gen(function* () {
       let pending: Signal[] = []
+      let since = 0 // when the first pending signal was played
       let end = -1
       let half = false
       let first = true
@@ -85,6 +93,7 @@ export const liveAgents = (o: LiveOptions): Companion => (s: Session) =>
         const b = yield* PubSub.take(sub)
         if (b.kind === "signals") {
           if (end < 0) end = Math.floor(b.frame / width) * width + width
+          if (!pending.length) since = performance.now()
           pending = [...pending, ...b.signals]
         } else if (b.kind === "frame") {
           // A session that starts in the second half has no first half to recap.
@@ -92,19 +101,19 @@ export const liveAgents = (o: LiveOptions): Companion => (s: Session) =>
           first = false
           if (!half && b.frame.period === "second_half") {
             half = true
-            if (pending.length) yield* Queue.offer(jobs, { kind: "signals", signals: pending, frame: last })
+            if (pending.length) yield* Queue.offer(jobs, { kind: "signals", signals: pending, frame: last, since })
             pending = []
             end = -1
             yield* Queue.offer(jobs, { kind: "recap", recap: "half_time", frame: last })
           }
           last = b.frame.frame
           if (end >= 0 && last >= end && pending.length) {
-            yield* Queue.offer(jobs, { kind: "signals", signals: pending, frame: last })
+            yield* Queue.offer(jobs, { kind: "signals", signals: pending, frame: last, since })
             pending = []
             end = -1
           }
         } else if (b.kind === "end") {
-          if (pending.length) yield* Queue.offer(jobs, { kind: "signals", signals: pending, frame: b.frame })
+          if (pending.length) yield* Queue.offer(jobs, { kind: "signals", signals: pending, frame: b.frame, since })
           yield* Queue.offer(jobs, { kind: "recap", recap: "full_time", frame: b.frame })
           yield* Queue.offer(jobs, { kind: "stop" })
           return
diff --git a/apps/api/src/session.ts b/apps/api/src/session.ts
index 2bca2d5..c3f38f3 100644
--- a/apps/api/src/session.ts
+++ b/apps/api/src/session.ts
@@ -8,6 +8,7 @@ import { readFileSync } from "node:fs"
 import { join } from "node:path"
 import { Cause, Deferred, Effect, Fiber, PubSub, Ref, Stream, SubscriptionRef } from "effect"
 import { SessionNotFound, type Playback, type QueueStatus, type Tick } from "@touchline/rpc"
+import type { RequestLog } from "@touchline/agent-gateway"
 import { segmentKey, type Cue, type MomentTrace, type Recap, type Segment } from "@touchline/schema"
 import { pickCues } from "./cues.js"
 import type { LibraryMatch } from "./library.js"
@@ -48,6 +49,10 @@ export type BusBeat =
 export interface Metrics {
   /** Each goal: the frame it was scored in played, to the new score on the bus (the stats-overlay latency). */
   readonly stats: number[]
+  /** Live: each batch that brought cues, from its earliest signal played to its cues on the bus (the insight latency). */
+  readonly insight: number[]
+  /** Live: every request to the agent service. */
+  readonly requests: RequestLog[]
 }
 
 /** What a live session's agents have written so far: its cues, the traces behind them and its recaps. */
@@ -147,7 +152,7 @@ export const makeSessions = (library: ReadonlyMap<string, LibraryMatch>, options
         const closed = yield* Ref.make(false)
         const queue = yield* Ref.make<ReadonlyMap<string, QueueEntry>>(new Map())
         const ended = yield* Deferred.make<void>()
-        const s: Session = { id, match, live: o.live, control, bus, playback, closed, agents: { cues: [], traces: [], recaps: [] }, metrics: { stats: [] }, queue, watchers, segments }
+        const s: Session = { id, match, live: o.live, control, bus, playback, closed, agents: { cues: [], traces: [], recaps: [] }, metrics: { stats: [], insight: [], requests: [] }, queue, watchers, segments }
         const end = (frame: number) =>
           Ref.update(playback, (p): Playback => ({ ...p, state: "ended", frame })).pipe(Effect.andThen(PubSub.publish(bus, { kind: "end", frame })))
         // A live session shows the agents' cues as they are written, never the cache's.
diff --git a/packages/agent-gateway/src/gateway.ts b/packages/agent-gateway/src/gateway.ts
index c602d20..64584bc 100644
--- a/packages/agent-gateway/src/gateway.ts
+++ b/packages/agent-gateway/src/gateway.ts
@@ -124,6 +124,10 @@ export const exchange = (send: Sender, req: AgentRequest, budgetMs: number, got:
   )
 }
 
+/** How a request failed, for the request log. */
+export const outcomeOf = (e: { readonly _tag: string }): Outcome =>
+  e._tag === "TimeoutError" ? "timeout" : e._tag === "AgentFailed" ? "failed" : e._tag === "InvalidArtifact" ? "invalid" : "unavailable"
+
 /** Run a match's timeline through the agent service. Never fails: every request's outcome is in `requests`. */
 export const runGateway = (send: Sender, plan: MatchPlan, opts: GatewayOptions = DEFAULT_OPTIONS) =>
   Effect.gen(function* () {
@@ -152,7 +156,7 @@ export const runGateway = (send: Sender, plan: MatchPlan, opts: GatewayOptions =
         continue
       }
       const e = r.failure
-      const outcome: Outcome = e._tag === "TimeoutError" ? "timeout" : e._tag === "AgentFailed" ? "failed" : e._tag === "InvalidArtifact" ? "invalid" : "unavailable"
+      const outcome = outcomeOf(e)
       // A late request still publishes what it delivered in time (each cue was validated as it arrived).
       const kept = outcome === "timeout" ? got : received()
       cues.push(...kept.cues)
PATCH
```

- [ ] **Step 4: Run the tests**

Run: `pnpm --filter @touchline/agent-gateway test && pnpm --filter @touchline/api test && pnpm --filter @touchline/api typecheck`
Expected: 17 passed; 45 passed, no type errors

- [ ] **Step 5: Commit**

```bash
git add apps/api packages/agent-gateway
git commit -m "feat(api): live sessions log every agent request and the signal-to-cue latency of each batch

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Ops report

`apps/api/src/ops.ts` builds the ops view's numbers for a session, as of its frame.
- **Recorded session:** the match's cache (traces and requests, read once per match), counted only up to the frame.
- **Live session:** what its agents wrote and what it measured.
- **Fact-Checker:** a retried draft counts once as retry, then as pass or drop.
- **Percentiles:** nearest-rank, to 0.1 ms. A budget is met when the p95 is within it, and unknown (`null`) with no measurements.
- **`GetOps`:** answers for the session's current frame.

**Files:**
- Create: `apps/api/src/ops.ts`
- Modify: `packages/rpc/src/contracts.ts` (`GetOps`), `apps/api/src/server.ts`
- Test: `apps/api/test/ops.test.ts`, `apps/api/test/server.test.ts`, `packages/rpc/test/contracts.test.ts`

**Interfaces:**
- Consumes: `Session` (`agents`, `metrics`, `match`), `OpsReport`, `Budget`, `Percentiles` (Task 1), `RequestLog`, `decodeMomentTrace`.
- Produces: `STATS_BUDGET_MS = 250`, `INSIGHT_BUDGET_MS = 4000`, `percentiles(xs)`, `budget(xs, ms)`, `makeOps()` returning `{ report(s, frame): OpsReport }`. RPC `GetOps {session_id}` → `OpsReport`.

- [ ] **Step 1: Write the failing tests**

Create `apps/api/test/ops.test.ts`:

```ts
import { Effect } from "effect"
import { TestClock } from "effect/testing"
import { beforeAll, describe, expect, it } from "vitest"
import { readMatch, type LibraryMatch } from "../src/library.js"
import { budget, makeOps, percentiles } from "../src/ops.js"
import { makeSessions } from "../src/session.js"
import { league, makeLibrary, MATCH_ID, type TestLibrary } from "./fixture.js"

let lib: TestLibrary
let match: LibraryMatch
beforeAll(async () => {
  lib = await makeLibrary()
  match = readMatch(lib.run, league)
}, 120_000)

const run = <A, E>(e: Effect.Effect<A, E, import("effect").Scope.Scope>) => Effect.runPromise(e.pipe(Effect.scoped, Effect.provide(TestClock.layer())))
const session = (live: boolean) =>
  Effect.gen(function* () {
    const sessions = yield* makeSessions(new Map([[MATCH_ID, match]]))
    const s = yield* sessions.start(match, { speed: 1, fromMinute: 0, live: false })
    return { ...s, live }
  })

describe("percentiles", () => {
  it("are nearest-rank, and empty without measurements", () => {
    expect(percentiles([])).toEqual({ n: 0, p50: null, p95: null, max: null })
    expect(percentiles(Array.from({ length: 100 }, (_, i) => 100 - i))).toEqual({ n: 100, p50: 50, p95: 95, max: 100 })
    expect(budget([100, 300], 250)).toMatchObject({ p95: 300, budget_ms: 250, ok: false })
    expect(budget([], 250).ok).toBeNull()
  })
})

describe("ops report", () => {
  it("counts a recorded session's agent work as of its frame, never ahead of it", () =>
    run(
      Effect.gen(function* () {
        const ops = makeOps()
        const s = yield* session(false)
        const [g1, g2] = [lib.goals[0]!, lib.goals[1]!]
        const before = ops.report(s, g1.frame_id - 1)
        expect([before.moments, before.cues, before.fact_check.pass + before.fact_check.retry + before.fact_check.drop]).toEqual([0, 0, 0])
        const after = ops.report(s, g2.frame_id)
        expect(after.moments).toBe(2)
        expect(after.cues).toBe(6) // two goals × three segments (the half-time card is not a moment's)
        expect(after.fact_check.pass).toBe(2)
        expect(after.models).toEqual([lib.traces[0]!.model])
        expect(after.agents.map((a) => a.agent)).toEqual(Object.keys(lib.traces[0]!.timings_ms).sort())
        expect(after.requests).toEqual({ ok: 1 }) // the fixture's one request, at frame 100
        expect(after.latency.insight).toMatchObject({ source: "recorded", n: 1, p95: 1, budget_ms: 4000, ok: true })
        expect(after.latency.stats).toMatchObject({ n: 0, budget_ms: 250, ok: null })
      })
    ), 120_000)

  it("reports a live session from what its agents did and what it measured", () =>
    run(
      Effect.gen(function* () {
        const ops = makeOps()
        const s = yield* session(true)
        const trace = { ...lib.traces[0]!, verdicts: [{ ...lib.traces[0]!.verdicts[0]!, status: "retry" as const }, { ...lib.traces[0]!.verdicts[0]!, status: "drop" as const }], fallbacks: ["narrator"], model: "openai:gpt-6.1-sol" }
        s.agents.traces.push(trace)
        s.agents.cues.push(...lib.cues.filter((c) => c.moment_id === trace.moment.moment_id))
        s.metrics.stats.push(3, 5)
        s.metrics.insight.push(3000, 5000)
        s.metrics.requests.push({ kind: "signals", frame: 10, outcome: "ok", ms: 2900, cues: 3, late: 0, unverified: 0 }, { kind: "signals", frame: 20, outcome: "timeout", ms: 4000, cues: 0, late: 1, unverified: 0 })
        const r = ops.report(s, match.info.frames)
        expect([r.live, r.moments, r.cues, r.models]).toEqual([true, 1, 3, ["openai:gpt-6.1-sol"]])
        expect(r.fact_check).toEqual({ pass: 0, retry: 1, drop: 1 })
        expect(r.fallbacks).toEqual({ narrator: 1 })
        expect(r.requests).toEqual({ ok: 1, timeout: 1 })
        expect(r.late_cues).toBe(1)
        expect(r.latency.stats).toMatchObject({ n: 2, p95: 5, ok: true })
        expect(r.latency.insight).toMatchObject({ source: "live", n: 2, p95: 5000, ok: false }) // over the 4 s budget
      })
    ), 120_000)
})
```

Apply this change to `apps/api/test/server.test.ts`, `packages/rpc/test/contracts.test.ts` (from the repository root):

```bash
git apply <<'PATCH'
diff --git a/apps/api/test/server.test.ts b/apps/api/test/server.test.ts
index 211f847..6929757 100644
--- a/apps/api/test/server.test.ts
+++ b/apps/api/test/server.test.ts
@@ -94,6 +94,16 @@ describe("API over WebSocket", () => {
     expect(Exit.isFailure(lost) && JSON.stringify(lost.cause)).toContain("NotQueued")
   }, 120_000)
 
+  it("reports a session's ops numbers", async () => {
+    const report = await client((c) =>
+      Effect.gen(function* () {
+        const s = yield* c.StartSession({ match_id: MATCH_ID, speed: 4, from_minute: 0, live: false })
+        return yield* c.GetOps({ session_id: s.session_id })
+      })
+    )
+    expect([report.live, report.latency.stats.budget_ms, report.latency.insight.budget_ms]).toEqual([false, 250, 4000])
+  }, 120_000)
+
   it("refuses to watch an unknown session", async () => {
     const lost = await client((c) => Effect.exit(Stream.runDrain(c.Watch({ session_id: "nope", segment: { mode: "casual", lang: "en", club: null } }))))
     expect(Exit.isFailure(lost) && JSON.stringify(lost.cause)).toContain("SessionNotFound")
diff --git a/packages/rpc/test/contracts.test.ts b/packages/rpc/test/contracts.test.ts
index f513bc9..1645928 100644
--- a/packages/rpc/test/contracts.test.ts
+++ b/packages/rpc/test/contracts.test.ts
@@ -26,7 +26,7 @@ describe("API contracts", () => {
   })
 
   it("offer the endpoints of spec §5.7", () => {
-    expect([...TouchlineRpcs.requests.keys()].sort()).toEqual(["Control", "GetEvidence", "GetMatch", "GetRecap", "ListMatches", "StartSession", "StudioAct", "StudioWatch", "Watch", "WatchGraphics"])
+    expect([...TouchlineRpcs.requests.keys()].sort()).toEqual(["Control", "GetEvidence", "GetMatch", "GetOps", "GetRecap", "ListMatches", "StartSession", "StudioAct", "StudioWatch", "Watch", "WatchGraphics"])
   })
 
   it("refuse playback speeds out of range", () => {
PATCH
```

- [ ] **Step 2: Run them to make sure they fail**

Run: `pnpm --filter @touchline/rpc test`
Expected: 1 test fails: the endpoint list lacks `GetOps`

Run: `pnpm --filter @touchline/api exec vitest run test/ops.test.ts test/server.test.ts`
Expected: `ops.test.ts` fails to load (`Cannot find module '../src/ops.js'`) and the server test fails: `yield* (intermediate value) is not iterable` (no `GetOps` on the client)

- [ ] **Step 3: Build the report**

Create `apps/api/src/ops.ts`:

```ts
/**
 * The ops view (spec §5.6): what the agents did for a session (moments, cues, Fact-Checker verdicts, fallbacks, time
 * per agent, requests by outcome) and how fast the hot path and the agents were against the spec's budgets (§2:
 * stats overlay under 250 ms from the event, AI insight under 4 s from the signal, p95). As of the session's frame:
 * a recorded session counts its cache only up to where play has reached; a live one counts what its agents did.
 */
import { existsSync, readFileSync } from "node:fs"
import { join } from "node:path"
import type { RequestLog } from "@touchline/agent-gateway"
import type { Budget, OpsReport, Percentiles } from "@touchline/rpc"
import { decodeMomentTrace, type Cue, type MomentTrace } from "@touchline/schema"
import type { LibraryMatch } from "./library.js"
import type { Session } from "./session.js"

export const STATS_BUDGET_MS = 250
export const INSIGHT_BUDGET_MS = 4000

const r1 = (v: number) => Math.round(v * 10) / 10

/** Nearest-rank percentiles, rounded to 0.1 ms. */
export const percentiles = (xs: ReadonlyArray<number>): Percentiles => {
  if (xs.length === 0) return { n: 0, p50: null, p95: null, max: null }
  const s = [...xs].sort((a, b) => a - b)
  const at = (p: number) => r1(s[Math.max(0, Math.ceil((p / 100) * s.length) - 1)]!)
  return { n: s.length, p50: at(50), p95: at(95), max: r1(s.at(-1)!) }
}

/** Percentiles against a budget: within it when the p95 is (null with no measurements). */
export const budget = (xs: ReadonlyArray<number>, budgetMs: number): Budget => {
  const p = percentiles(xs)
  return { ...p, budget_ms: budgetMs, ok: p.p95 === null ? null : p.p95 <= budgetMs }
}

const count = (xs: ReadonlyArray<string>): Record<string, number> => Object.fromEntries([...new Set(xs)].sort().map((x) => [x, xs.filter((y) => y === x).length]))

interface Recorded {
  readonly traces: ReadonlyArray<MomentTrace>
  readonly requests: ReadonlyArray<RequestLog>
}

const lines = (path: string): unknown[] => (existsSync(path) ? readFileSync(path, "utf8").split("\n").filter((l) => l.trim()).map((l) => JSON.parse(l)) : [])

export const makeOps = () => {
  const cache = new Map<string, Recorded>()
  /** A match's recorded traces and requests (read once). */
  const recorded = (m: LibraryMatch): Recorded => {
    let r = cache.get(m.info.match_id)
    if (!r) {
      r = { traces: lines(join(m.dir, "agents", "traces.jsonl")).map((l) => decodeMomentTrace(l)), requests: lines(join(m.dir, "agents", "requests.jsonl")) as RequestLog[] }
      cache.set(m.info.match_id, r)
    }
    return r
  }

  /** The session's ops numbers as of `frame`. */
  const report = (s: Session, frame: number): OpsReport => {
    const src = s.live ? { traces: s.agents.traces, requests: s.metrics.requests, cues: s.agents.cues } : { ...recorded(s.match), cues: s.match.cues }
    const traces = src.traces.filter((t) => t.moment.frame_to <= frame)
    const requests = src.requests.filter((q) => q.frame <= frame)
    const moments = new Set(traces.map((t) => t.moment.moment_id))
    const cues = src.cues.filter((c: Cue) => c.moment_id !== null && moments.has(c.moment_id) && c.anchor.frame_to <= frame)
    const verdicts = traces.flatMap((t) => t.verdicts.map((v) => v.status))
    const timings = new Map<string, number[]>()
    for (const t of traces) for (const [agent, ms] of Object.entries(t.timings_ms)) timings.set(agent, [...(timings.get(agent) ?? []), ms])
    const insight = s.live
      ? { ...budget(s.metrics.insight, INSIGHT_BUDGET_MS), source: "live" as const }
      : { ...budget(requests.filter((q) => q.outcome === "ok").map((q) => q.ms), INSIGHT_BUDGET_MS), source: "recorded" as const }
    return {
      session_id: s.id,
      live: s.live,
      frame,
      models: [...new Set(traces.map((t) => t.model))],
      moments: moments.size,
      cues: cues.length,
      fact_check: { pass: verdicts.filter((v) => v === "pass").length, retry: verdicts.filter((v) => v === "retry").length, drop: verdicts.filter((v) => v === "drop").length },
      fallbacks: count(traces.flatMap((t) => [...t.fallbacks])),
      agents: [...timings.keys()].sort().map((agent) => ({ agent, ...percentiles(timings.get(agent)!) })),
      requests: count(requests.map((q) => q.outcome)),
      late_cues: requests.reduce((n, q) => n + q.late, 0),
      unverified_cues: requests.reduce((n, q) => n + q.unverified, 0),
      latency: { stats: budget(s.metrics.stats, STATS_BUDGET_MS), insight }
    }
  }

  return { report } as const
}
```

Apply this change to `apps/api/src/server.ts`, `packages/rpc/src/contracts.ts` (from the repository root):

```bash
git apply <<'PATCH'
diff --git a/apps/api/src/server.ts b/apps/api/src/server.ts
index b46b900..33d9507 100644
--- a/apps/api/src/server.ts
+++ b/apps/api/src/server.ts
@@ -10,6 +10,7 @@ import { RpcSerialization, RpcServer } from "effect/rpc"
 import { MatchNotFound, TouchlineRpcs, type MatchSummary } from "@touchline/rpc"
 import { makeEvidence } from "./evidence.js"
 import type { LibraryMatch } from "./library.js"
+import { makeOps } from "./ops.js"
 import { makeSessions, type Companion } from "./session.js"
 import { makeStudio } from "./studio.js"
 
@@ -29,6 +30,7 @@ export const handlersLayer = (o: ApiOptions) =>
     Effect.gen(function* () {
       const ev = makeEvidence(o.library)
       const studio = makeStudio(ev)
+      const ops = makeOps()
       const sessions = yield* makeSessions(o.library, { ...(o.companion ? { companion: o.companion } : {}), studio: studio.record })
       const match = (id: string) => Effect.fromNullishOr(o.library.get(id)).pipe(Effect.mapError(() => new MatchNotFound({ match_id: id })))
       /** A session and what it has reached: answers never go past its frame. */
@@ -48,7 +50,8 @@ export const handlersLayer = (o: ApiOptions) =>
         GetRecap: ({ session_id, kind, segment }) => view(session_id).pipe(Effect.flatMap(({ s, v }) => ev.recap(s.match.info.match_id, kind, segment, v))),
         StudioWatch: ({ session_id, segment }) => studio.watch(sessions, session_id, segment),
         StudioAct: ({ session_id, moment_id, action }) => sessions.get(session_id).pipe(Effect.flatMap((s) => studio.act(s, moment_id, action))),
-        WatchGraphics: ({ session_id, segment }) => sessions.graphics(session_id, segment)
+        WatchGraphics: ({ session_id, segment }) => sessions.graphics(session_id, segment),
+        GetOps: ({ session_id }) => sessions.get(session_id).pipe(Effect.flatMap((s) => Effect.map(Ref.get(s.playback), (p) => ops.report(s, p.frame))))
       })
     })
   )
diff --git a/packages/rpc/src/contracts.ts b/packages/rpc/src/contracts.ts
index 5f3ac42..7e252b6 100644
--- a/packages/rpc/src/contracts.ts
+++ b/packages/rpc/src/contracts.ts
@@ -235,7 +235,9 @@ export class TouchlineRpcs extends RpcGroup.make(
     error: Schema.Union([SessionNotFound, NotQueued])
   }),
   /** The broadcast graphics output for a segment: the scoreboard and the cues the producer sent, nothing else. */
-  Rpc.make("WatchGraphics", { payload: { session_id: Schema.String, segment: Segment }, success: Tick, error: SessionNotFound, stream: true })
+  Rpc.make("WatchGraphics", { payload: { session_id: Schema.String, segment: Segment }, success: Tick, error: SessionNotFound, stream: true }),
+  /** The session's ops numbers (spec §5.6 ops view), as of its frame. */
+  Rpc.make("GetOps", { payload: { session_id: Schema.String }, success: OpsReport, error: SessionNotFound })
 ) {}
 
 export const decodeTick = Schema.decodeUnknownSync(Tick)
PATCH
```

- [ ] **Step 4: Run the tests**

Run: `pnpm --filter @touchline/rpc test && pnpm --filter @touchline/api test && pnpm --filter @touchline/api typecheck`
Expected: 8 passed; 49 passed, no type errors

- [ ] **Step 5: Commit**

```bash
git add apps/api packages/rpc
git commit -m "feat(api): ops report (GetOps) — moments, cues, fact-check pass/retry/drop, fallbacks, time per agent, requests, and latency percentiles against the 250 ms and 4 s budgets, as of the session's frame

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Web: pages in the URL hash, and the client calls

The fan app becomes one of four pages, each in its own tab or window: `#/` (fan app), `#/studio/<session>?seg=…`, `#/graphics/<session>?seg=…` and `#/ops/<session>`.
- **`route.ts`:** parses and writes the hash. A segment is written `mode.lang.club` (`neutral` for none). Anything it does not know is the fan app, and a bad segment is casual English.
- **`Root`:** picks the page and follows hash changes. The studio, graphics and ops pages join it in Tasks 8 to 10.
- **The client:** gains `studio`, `act`, `graphics` and `ops`, on the same stream helper as `watch`. The fake client gains the same, so components can be tested without a server.

**Files:**
- Create: `apps/web/src/route.ts`, `apps/web/src/Root.tsx`
- Modify: `apps/web/src/client.ts`, `apps/web/src/main.tsx`
- Test: `apps/web/test/route.test.ts`, `apps/web/test/root.test.tsx`, `apps/web/test/client.test.ts`, `apps/web/test/fake-client.ts`

**Interfaces:**
- Consumes: the RPCs of Tasks 4 and 6.
- Produces:
  - `Route` (`fan` | `studio` | `graphics` with `session` and `segment` | `ops` with `session`), `parseRoute(hash)`, `routeHash(route)`, `segmentParam(segment)`.
  - `Root`.
  - `TouchlineClient.studio(sessionId, segment, onTick, onEnd?) -> stop`, `.act(sessionId, momentId, action)`, `.graphics(sessionId, segment, onTick, onEnd?) -> stop`, `.ops(sessionId)`.
  - The fake client's `pushStudio`, `pushGraphics`, `studios`, `outputs` and `ops` option.

- [ ] **Step 1: Write the failing tests**

Create `apps/web/test/root.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it } from "vitest"
import { Root } from "../src/Root.js"
import { fakeClient } from "./fake-client.js"

afterEach(() => {
  window.location.hash = ""
})

describe("root", () => {
  it("shows the fan app at the start, and for a page it does not know", async () => {
    for (const hash of ["", "#/nope"]) {
      window.location.hash = hash
      const { unmount } = render(<Root client={fakeClient()} />)
      expect(await screen.findByRole("heading", { name: "Matches" })).toBeTruthy()
      unmount()
    }
  })
})
```

Create `apps/web/test/route.test.ts`:

```ts
import { describe, expect, it } from "vitest"
import { parseRoute, routeHash } from "../src/route.js"

describe("routes", () => {
  it("read the studio, graphics and ops pages of a session from the hash", () => {
    expect(parseRoute("#/studio/s1?seg=analyst.es.neutral")).toEqual({ page: "studio", session: "s1", segment: { mode: "analyst", lang: "es", club: null } })
    expect(parseRoute("#/graphics/s1?seg=casual.hi.northwick")).toEqual({ page: "graphics", session: "s1", segment: { mode: "casual", lang: "hi", club: "northwick" } })
    expect(parseRoute("#/ops/s1")).toEqual({ page: "ops", session: "s1" })
  })

  it("fall back to the fan app, and to casual English, on anything else", () => {
    for (const h of ["", "#/", "#/nope", "#/studio", "#/ops/"]) expect(parseRoute(h)).toEqual({ page: "fan" })
    expect(parseRoute("#/studio/s1?seg=loud.xx")).toEqual({ page: "studio", session: "s1", segment: { mode: "casual", lang: "en", club: null } })
  })

  it("write what they read", () => {
    for (const r of [{ page: "fan" }, { page: "ops", session: "s 1" }, { page: "studio", session: "s1", segment: { mode: "analyst", lang: "hi", club: "larkspur" } }] as const) {
      expect(parseRoute(routeHash(r))).toEqual(r)
    }
  })
})
```

Apply this change to `apps/web/test/client.test.ts`, `apps/web/test/fake-client.ts` (from the repository root):

```bash
git apply <<'PATCH'
diff --git a/apps/web/test/client.test.ts b/apps/web/test/client.test.ts
index 7a6242e..4d487f3 100644
--- a/apps/web/test/client.test.ts
+++ b/apps/web/test/client.test.ts
@@ -3,7 +3,7 @@ import { createServer } from "node:net"
 import { Effect, Layer } from "effect"
 import { afterAll, beforeAll, describe, expect, it } from "vitest"
 import { readMatch, serverLayer } from "@touchline/api"
-import type { Tick } from "@touchline/rpc"
+import type { StudioTick, Tick } from "@touchline/rpc"
 import { connect, type TouchlineClient } from "../src/client.js"
 import { league, makeLibrary, MATCH_ID, type TestLibrary } from "../../api/test/fixture.js"
 
@@ -52,6 +52,22 @@ describe("browser client", () => {
     expect(ev.events[0]!.id).toBe(goal.id)
   })
 
+  it("follows a session's studio console, graphics output and ops numbers", async () => {
+    const { session_id } = await client.startSession(MATCH_ID, { speed: 4, fromMinute: 0, live: false })
+    const first = <T,>(follow: (on: (t: T) => void) => () => void) =>
+      new Promise<T>((done) => {
+        const stop = follow((t) => {
+          stop()
+          done(t)
+        })
+      })
+    const segment = { mode: "casual", lang: "en", club: null } as const
+    expect((await first<StudioTick>((on) => client.studio(session_id, segment, on))).kind).toBe("playback")
+    expect((await first<Tick>((on) => client.graphics(session_id, segment, on))).kind).toBe("playback")
+    expect((await client.ops(session_id)).session_id).toBe(session_id)
+    await expect(client.act(session_id, "nope", "send")).rejects.toThrow()
+  })
+
   it("rejects calls for unknown matches", async () => {
     await expect(client.startSession("nope", { speed: 4, fromMinute: 0, live: false })).rejects.toThrow()
   })
diff --git a/apps/web/test/fake-client.ts b/apps/web/test/fake-client.ts
index 62d8ba9..99029db 100644
--- a/apps/web/test/fake-client.ts
+++ b/apps/web/test/fake-client.ts
@@ -1,5 +1,5 @@
 /** A TouchlineClient for component tests: canned answers, and ticks the test pushes to every watcher. */
-import type { Evidence, MatchInfo, MatchSummary, Playback, RecapView, Tick } from "@touchline/rpc"
+import type { Evidence, MatchInfo, MatchSummary, OpsReport, Playback, RecapView, StudioTick, Tick } from "@touchline/rpc"
 import type { Segment } from "@touchline/schema"
 import type { TouchlineClient } from "../src/client.js"
 
@@ -25,10 +25,20 @@ export interface FakeClient extends TouchlineClient {
   fail(error: string | null): void
   /** How many times watch was called. */
   watchCount(): number
+  readonly studios: Array<{ segment: Segment; onTick: (t: StudioTick) => void }>
+  pushStudio(t: StudioTick): void
+  readonly outputs: Array<{ segment: Segment; onTick: (t: Tick) => void }>
+  pushGraphics(t: Tick): void
 }
 
-export const fakeClient = (o: { matches?: ReadonlyArray<MatchSummary>; evidence?: Evidence; recap?: RecapView } = {}): FakeClient => {
+export const fakeClient = (o: { matches?: ReadonlyArray<MatchSummary>; evidence?: Evidence; recap?: RecapView; ops?: OpsReport } = {}): FakeClient => {
   const watchers: FakeClient["watchers"] = []
+  const studios: FakeClient["studios"] = []
+  const outputs: FakeClient["outputs"] = []
+  const follow = <W,>(list: W[], w: W) => {
+    list.push(w)
+    return () => void list.splice(list.indexOf(w), 1)
+  }
   const calls: string[] = []
   let playback: Playback = { state: "playing", frame: 0, speed: 4, live: false }
   let watched = 0
@@ -38,6 +48,21 @@ export const fakeClient = (o: { matches?: ReadonlyArray<MatchSummary>; evidence?
     push: (t) => watchers.forEach((w) => w.onTick(t)),
     fail: (error) => watchers.splice(0).forEach((w) => w.onEnd?.(error)),
     watchCount: () => watched,
+    studios,
+    pushStudio: (t) => studios.forEach((w) => w.onTick(t)),
+    outputs,
+    pushGraphics: (t) => outputs.forEach((w) => w.onTick(t)),
+    studio: (_id, segment, onTick) => follow(studios, { segment, onTick }),
+    act: async (_id, momentId, action) => {
+      calls.push(`act ${momentId} ${action}`)
+      return { moment_id: momentId, status: action === "approve" ? "approved" : action === "hold" ? "held" : "on_air" }
+    },
+    graphics: (_id, segment, onTick) => follow(outputs, { segment, onTick }),
+    ops: async (sessionId) => {
+      calls.push(`ops ${sessionId}`)
+      if (!o.ops) throw new Error("no ops")
+      return o.ops
+    },
     listMatches: async () => o.matches ?? [MATCH],
     startSession: async (id, s) => {
       calls.push(`start ${id} x${s.speed} live=${s.live}`)
PATCH
```

- [ ] **Step 2: Run them to make sure they fail**

Run: `pnpm --filter @touchline/web exec vitest run test/route.test.ts test/root.test.tsx test/client.test.ts`
Expected: `route.test.ts` and `root.test.tsx` fail to load (`Failed to resolve import "../src/route.js"`, `"../src/Root.js"`) and the client test fails: `client.studio is not a function`

- [ ] **Step 3: Route the pages and extend the client**

Create `apps/web/src/Root.tsx`:

```tsx
import { useEffect, useState } from "react"
import { App } from "./App.js"
import type { TouchlineClient } from "./client.js"
import { parseRoute, type Route } from "./route.js"

/** The page the URL hash names (see route.ts), following hash changes. */
export const Root = ({ client }: { client: TouchlineClient }) => {
  const [route, setRoute] = useState<Route>(() => parseRoute(window.location.hash))
  useEffect(() => {
    const on = () => setRoute(parseRoute(window.location.hash))
    window.addEventListener("hashchange", on)
    return () => window.removeEventListener("hashchange", on)
  }, [])
  switch (route.page) {
    default:
      return <App client={client} />
  }
}
```

Create `apps/web/src/route.ts`:

```ts
/**
 * The app's pages, in the URL hash so each opens in its own tab or window: the fan app (`#/`), and for a session the
 * studio console (`#/studio/<session>?seg=…`), the broadcast graphics output (`#/graphics/<session>?seg=…`, for a
 * vision mixer or OBS) and the ops view (`#/ops/<session>`). `seg` is a segment key: mode.lang.club, `neutral` for none.
 */
import type { Segment } from "@touchline/schema"

export type Route =
  | { readonly page: "fan" }
  | { readonly page: "studio" | "graphics"; readonly session: string; readonly segment: Segment }
  | { readonly page: "ops"; readonly session: string }

const DEFAULT_SEGMENT: Segment = { mode: "casual", lang: "en", club: null }

const parseSegment = (key: string | null): Segment => {
  const [mode, lang, ...club] = (key ?? "").split(".")
  if ((mode !== "casual" && mode !== "analyst") || (lang !== "en" && lang !== "es" && lang !== "hi")) return DEFAULT_SEGMENT
  const c = club.join(".")
  return { mode, lang, club: c && c !== "neutral" ? c : null }
}

export const segmentParam = (s: Segment): string => `${s.mode}.${s.lang}.${s.club ?? "neutral"}`

export const parseRoute = (hash: string): Route => {
  const [path = "", query = ""] = hash.replace(/^#/, "").split("?")
  const [, page, session] = path.split("/")
  if (!session) return { page: "fan" }
  const id = decodeURIComponent(session)
  if (page === "ops") return { page, session: id }
  if (page === "studio" || page === "graphics") return { page, session: id, segment: parseSegment(new URLSearchParams(query).get("seg")) }
  return { page: "fan" }
}

export const routeHash = (r: Route): string => {
  if (r.page === "fan") return "#/"
  const base = `#/${r.page}/${encodeURIComponent(r.session)}`
  return r.page === "ops" ? base : `${base}?seg=${segmentParam(r.segment)}`
}
```

Apply this change to `apps/web/src/client.ts`, `apps/web/src/main.tsx` (from the repository root):

```bash
git apply <<'PATCH'
diff --git a/apps/web/src/client.ts b/apps/web/src/client.ts
index d40d143..13c6a50 100644
--- a/apps/web/src/client.ts
+++ b/apps/web/src/client.ts
@@ -5,7 +5,7 @@
 import { BrowserSocket } from "@effect/platform-browser"
 import { Effect, Exit, Layer, ManagedRuntime, Scope, Stream } from "effect"
 import { RpcClient, RpcSerialization } from "effect/rpc"
-import { TouchlineRpcs, type Evidence, type MatchInfo, type MatchSummary, type Playback, type RecapView, type Tick } from "@touchline/rpc"
+import { TouchlineRpcs, type Evidence, type MatchInfo, type MatchSummary, type OpsReport, type Playback, type QueueStatus, type RecapView, type StudioAction, type StudioTick, type Tick } from "@touchline/rpc"
 import type { Segment } from "@touchline/schema"
 
 export interface StartOptions {
@@ -24,6 +24,14 @@ export interface TouchlineClient {
   evidence(sessionId: string, cueId: string): Promise<Evidence>
   /** A recap, once the session has reached its whistle (empty before). */
   recap(sessionId: string, kind: "half_time" | "full_time", segment: Segment): Promise<RecapView>
+  /** The studio console's stream for a producer segment; returns a function that stops it. */
+  studio(sessionId: string, segment: Segment, onTick: (t: StudioTick) => void, onEnd?: (error: string | null) => void): () => void
+  /** A producer's decision on a queued moment. */
+  act(sessionId: string, momentId: string, action: StudioAction): Promise<{ readonly moment_id: string; readonly status: QueueStatus }>
+  /** The broadcast graphics output for a segment: scoreboard and the cues sent to air. */
+  graphics(sessionId: string, segment: Segment, onTick: (t: Tick) => void, onEnd?: (error: string | null) => void): () => void
+  /** The session's ops numbers, as of its frame. */
+  ops(sessionId: string): Promise<OpsReport>
   close(): Promise<void>
 }
 
@@ -37,20 +45,24 @@ export const connect = async (url: string): Promise<TouchlineClient> => {
   const scope = await runtime.runPromise(Scope.make())
   const client = await runtime.runPromise(RpcClient.make(TouchlineRpcs).pipe(Scope.provide(scope)))
   const call = <A>(e: Effect.Effect<A, unknown>) => runtime.runPromise(e)
+  /** Run a stream, calling `onTick` for each element and `onEnd` once it stops (null: it ended normally). */
+  const follow = <A>(stream: Stream.Stream<A, unknown>, onTick: (a: A) => void, onEnd?: (error: string | null) => void) => {
+    const fiber = runtime.runFork(
+      Stream.runForEach(stream, (a) => Effect.sync(() => onTick(a))).pipe(Effect.matchCause({ onSuccess: () => onEnd?.(null), onFailure: (c) => onEnd?.(String(c)) }))
+    )
+    return () => fiber.interruptUnsafe()
+  }
   return {
     listMatches: () => call(client.ListMatches()),
     startSession: (match_id, o) => call(client.StartSession({ match_id, speed: o.speed, from_minute: o.fromMinute, live: o.live })),
-    watch: (session_id, segment, onTick, onEnd) => {
-      const fiber = runtime.runFork(
-        Stream.runForEach(client.Watch({ session_id, segment }), (t) => Effect.sync(() => onTick(t))).pipe(
-          Effect.matchCause({ onSuccess: () => onEnd?.(null), onFailure: (c) => onEnd?.(String(c)) })
-        )
-      )
-      return () => fiber.interruptUnsafe()
-    },
+    watch: (session_id, segment, onTick, onEnd) => follow(client.Watch({ session_id, segment }), onTick, onEnd),
     control: (session_id, action, speed) => call(client.Control({ session_id, action, speed: speed ?? null })),
     evidence: (session_id, cue_id) => call(client.GetEvidence({ session_id, cue_id })),
     recap: (session_id, kind, segment) => call(client.GetRecap({ session_id, kind, segment })),
+    studio: (session_id, segment, onTick, onEnd) => follow(client.StudioWatch({ session_id, segment }), onTick, onEnd),
+    act: (session_id, moment_id, action) => call(client.StudioAct({ session_id, moment_id, action })),
+    graphics: (session_id, segment, onTick, onEnd) => follow(client.WatchGraphics({ session_id, segment }), onTick, onEnd),
+    ops: (session_id) => call(client.GetOps({ session_id })),
     close: async () => {
       await runtime.runPromise(Scope.close(scope, Exit.void))
       await runtime.dispose()
diff --git a/apps/web/src/main.tsx b/apps/web/src/main.tsx
index 5dfdebb..0e5bdfa 100644
--- a/apps/web/src/main.tsx
+++ b/apps/web/src/main.tsx
@@ -1,11 +1,11 @@
 import { StrictMode } from "react"
 import { createRoot } from "react-dom/client"
-import { App } from "./App.js"
+import { Root } from "./Root.js"
 import { connect, defaultUrl } from "./client.js"
 import "./index.css"
 
 const root = createRoot(document.getElementById("root")!)
 connect(defaultUrl()).then(
-  (client) => root.render(<StrictMode><App client={client} /></StrictMode>),
+  (client) => root.render(<StrictMode><Root client={client} /></StrictMode>),
   (e) => root.render(<p className="p-8 text-red-300">Cannot reach the API at {defaultUrl()}: {String(e)}. Start it with pnpm api.</p>)
 )
PATCH
```

- [ ] **Step 4: Run the tests**

Run: `pnpm --filter @touchline/web test && pnpm --filter @touchline/web typecheck`
Expected: 30 passed, no type errors

- [ ] **Step 5: Commit**

```bash
git add apps/web
git commit -m "feat(web): pages in the URL hash (fan, studio, graphics, ops) and client calls for the studio console, graphics output and ops view

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: Web: studio console

The studio console page (spec §5.6).
- **Queue:** newest first. Each moment shows its clock, headline, status and Approve, Hold and Send to graphics buttons. A decision shows at once, and the stream confirms it for every console.
- **Talking points:** for approved and on-air moments only.
- **Raw cue feed:** every agent cue with its segment, slot and verified mark, the last 100.

Each session in the fan app links to it for the viewer's own segment. Its words are in English, Spanish and Hindi.

**Files:**
- Create: `apps/web/src/Studio.tsx`
- Modify: `apps/web/src/i18n.ts`, `apps/web/src/Root.tsx`, `apps/web/src/Watch.tsx`
- Test: `apps/web/test/studio.test.tsx`

**Interfaces:**
- Consumes: `TouchlineClient.studio`/`.act` (Task 7), `QueueItem`, `StudioAction` (Task 1), `routeHash` (Task 7).
- Produces: `Studio({ client, session, segment })`, `RAW_FEED_SIZE = 100`, and the strings `studio`, `queue`, `emptyQueue`, `approve`, `hold`, `send`, `pending`, `approved`, `held`, `onAir`, `talkingPoints`, `noPoints`, `rawFeed`.

- [ ] **Step 1: Write the failing tests**

Create `apps/web/test/studio.test.tsx`:

```tsx
import { act, render, screen, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { describe, expect, it } from "vitest"
import type { QueueItem } from "@touchline/rpc"
import type { Cue } from "@touchline/schema"
import { App } from "../src/App.js"
import { Studio } from "../src/Studio.js"
import { fakeClient } from "./fake-client.js"

const segment = { mode: "casual", lang: "en", club: null } as const
const cue = (id: string, headline: string): Cue => ({
  cue_id: `${id}-casual.en.neutral`, schema: "touchline.cue/1", match_id: "m", moment_id: id,
  anchor: { frame_from: 100, frame_to: 120, clock: "12:00" }, display: { slot: "lower_third", priority: 1, ttl_ms: 12000, template: "goal" },
  segment, text: { headline, body: "A finish." }, data: {}, evidence: [], verified: true
})
const item = (id: string, headline: string, status: QueueItem["status"] = "pending"): QueueItem => ({
  moment_id: id, frame: 120, clock: "12:00", status, cue: cue(id, headline), points: [`${headline} — point`, "Cause: clear chance converted"], variants: 12
})

const row = (headline: string) => within(screen.getByRole("list", { name: "Queue" })).getByText(headline).closest("li") as HTMLElement

describe("studio console", () => {
  it("lists queued moments as they arrive and sends the producer's decisions", async () => {
    const client = fakeClient()
    render(<Studio client={client} session="s1" segment={segment} />)
    expect(screen.getByText("No moments yet.")).toBeTruthy()
    act(() => client.pushStudio({ kind: "queue", item: item("mo-1", "Wylford scores") }))
    act(() => client.pushStudio({ kind: "queue", item: item("mo-2", "Pressure builds") }))
    const items = within(screen.getByRole("list", { name: "Queue" })).getAllByRole("listitem")
    expect(items.map((li) => li.querySelector("h3")?.textContent)).toEqual(["Pressure builds", "Wylford scores"]) // newest first
    expect(within(row("Wylford scores")).getByText("Pending")).toBeTruthy()
    await userEvent.click(within(row("Wylford scores")).getByRole("button", { name: "Send to graphics" }))
    expect(client.calls).toContain("act mo-1 send")
    expect(within(row("Wylford scores")).getByText("On air")).toBeTruthy()
    await userEvent.click(within(row("Pressure builds")).getByRole("button", { name: "Hold" }))
    expect(within(row("Pressure builds")).getByText("Held")).toBeTruthy()
  })

  it("gives the presenter talking points for approved and on-air moments only", async () => {
    const client = fakeClient()
    render(<Studio client={client} session="s1" segment={segment} />)
    act(() => client.pushStudio({ kind: "queue", item: item("mo-1", "Wylford scores") }))
    const points = screen.getByRole("region", { name: "Talking points" })
    expect(within(points).getByText("Approve a moment to add its talking points.")).toBeTruthy()
    await userEvent.click(within(row("Wylford scores")).getByRole("button", { name: "Approve" }))
    expect(within(points).getByText("Wylford scores — point")).toBeTruthy()
    expect(within(points).getByText("Cause: clear chance converted")).toBeTruthy()
    act(() => client.pushStudio({ kind: "queue", item: item("mo-1", "Wylford scores", "held") })) // another producer held it
    expect(within(points).queryByText("Cause: clear chance converted")).toBeNull()
  })

  it("shows every agent cue in the raw feed, with its segment and slot", () => {
    const client = fakeClient()
    render(<Studio client={client} session="s1" segment={segment} />)
    act(() => client.pushStudio({ kind: "cue", cue: cue("mo-1", "Wylford scores") }))
    const feed = screen.getByRole("list", { name: "Raw cue feed" })
    expect(within(feed).getByText(/casual\.en\.neutral · lower_third/)).toBeTruthy()
  })

  it("opens from a session in the fan app, for the viewer's segment", async () => {
    const client = fakeClient()
    render(<App client={client} />)
    await userEvent.click(await screen.findByRole("button", { name: "Watch" }))
    expect(screen.getByRole("link", { name: "Studio console" }).getAttribute("href")).toBe("#/studio/s1?seg=casual.en.neutral")
  })
})
```

- [ ] **Step 2: Run them to make sure they fail**

Run: `pnpm --filter @touchline/web exec vitest run test/studio.test.tsx`
Expected: the file fails to load: `Failed to resolve import "../src/Studio.js"`

- [ ] **Step 3: Write the studio console**

Create `apps/web/src/Studio.tsx`:

```tsx
import { useEffect, useState } from "react"
import type { Playback, QueueItem, QueueStatus, StudioAction } from "@touchline/rpc"
import type { Cue, Segment } from "@touchline/schema"
import type { TouchlineClient } from "./client.js"
import { t, type Key } from "./i18n.js"

const STATUS: Record<QueueStatus, { key: Key; style: string }> = {
  pending: { key: "pending", style: "bg-slate-700" },
  approved: { key: "approved", style: "bg-sky-700" },
  held: { key: "held", style: "bg-amber-700" },
  on_air: { key: "onAir", style: "bg-red-600" }
}
const AFTER: Record<StudioAction, QueueStatus> = { approve: "approved", hold: "held", send: "on_air" }
export const RAW_FEED_SIZE = 100

/**
 * The studio console (spec §5.6): the producer's queue of moments (approve, hold, send to graphics), the presenter's
 * talking points for approved and on-air moments, and the raw feed of every agent cue. Decisions are shared: every
 * console on the session sees them.
 */
export const Studio = ({ client, session, segment }: { client: TouchlineClient; session: string; segment: Segment }) => {
  const lang = segment.lang
  const [queue, setQueue] = useState<ReadonlyMap<string, QueueItem>>(new Map())
  const [feed, setFeed] = useState<ReadonlyArray<Cue>>([])
  const [playback, setPlayback] = useState<Playback | null>(null)
  const upsert = (item: QueueItem) => setQueue((q) => new Map([...q, [item.moment_id, item]]))
  useEffect(
    () =>
      client.studio(session, segment, (tick) => {
        if (tick.kind === "queue") upsert(tick.item)
        else if (tick.kind === "cue") setFeed((f) => [tick.cue, ...f].slice(0, RAW_FEED_SIZE))
        else setPlayback(tick.playback)
      }),
    [client, session, segment.mode, segment.lang, segment.club]
  )
  const decide = (item: QueueItem, action: StudioAction) => {
    upsert({ ...item, status: AFTER[action] }) // shown at once; the stream confirms it for everyone
    client.act(session, item.moment_id, action).then(
      (r) => setQueue((q) => new Map([...q, [r.moment_id, { ...q.get(r.moment_id)!, status: r.status }]])),
      () => upsert(item)
    )
  }
  const items = [...queue.values()].sort((a, b) => b.frame - a.frame || b.moment_id.localeCompare(a.moment_id))
  const briefed = items.filter((i) => i.status === "approved" || i.status === "on_air")
  return (
    <main className="mx-auto grid max-w-7xl gap-4 p-6 font-sans lg:grid-cols-3">
      <header className="flex items-center gap-3 lg:col-span-3">
        <h1 className="text-2xl font-bold">{t(lang, "studio")}</h1>
        <span className="rounded bg-slate-800 px-2 py-0.5 text-sm">{`${segment.mode}.${segment.lang}.${segment.club ?? "neutral"}`}</span>
        {playback && <span className="text-sm text-slate-400">{playback.state} · ×{playback.speed}</span>}
      </header>
      <section className="flex flex-col gap-2">
        <h2 className="font-semibold">{t(lang, "queue")}</h2>
        {items.length === 0 && <p className="text-slate-400">{t(lang, "emptyQueue")}</p>}
        <ol aria-label={t(lang, "queue")} className="flex flex-col gap-2">
          {items.map((i) => (
            <li key={i.moment_id} className="rounded-lg bg-slate-900 p-3 ring-1 ring-slate-800">
              <div className="flex items-center gap-2">
                <span className="tabular-nums text-slate-400">{i.clock}</span>
                <h3 lang={i.cue?.segment.lang} className="flex-1 truncate font-semibold">{i.cue?.text?.headline ?? i.moment_id}</h3>
                <span className={`rounded px-2 py-0.5 text-xs text-white ${STATUS[i.status].style}`}>{t(lang, STATUS[i.status].key)}</span>
              </div>
              <div className="mt-2 flex gap-2 text-sm">
                <button type="button" className="rounded bg-sky-800 px-2 py-0.5" onClick={() => decide(i, "approve")}>{t(lang, "approve")}</button>
                <button type="button" className="rounded bg-amber-800 px-2 py-0.5" onClick={() => decide(i, "hold")}>{t(lang, "hold")}</button>
                <button type="button" className="rounded bg-red-700 px-2 py-0.5" onClick={() => decide(i, "send")}>{t(lang, "send")}</button>
              </div>
            </li>
          ))}
        </ol>
      </section>
      <section aria-label={t(lang, "talkingPoints")} className="flex flex-col gap-2">
        <h2 className="font-semibold">{t(lang, "talkingPoints")}</h2>
        {briefed.length === 0 && <p className="text-slate-400">{t(lang, "noPoints")}</p>}
        {briefed.map((i) => (
          <article key={i.moment_id} className="rounded-lg bg-slate-900 p-3 ring-1 ring-sky-800">
            <h3 className="font-semibold"><span className="tabular-nums text-slate-400">{i.clock}</span> {i.cue?.text?.headline ?? i.moment_id}</h3>
            <ul className="mt-1 list-disc pl-5 text-sm">{i.points.map((p, n) => <li key={n}>{p}</li>)}</ul>
          </article>
        ))}
      </section>
      <section className="flex flex-col gap-2">
        <h2 className="font-semibold">{t(lang, "rawFeed")}</h2>
        <ol aria-label={t(lang, "rawFeed")} className="flex max-h-[70vh] flex-col gap-1 overflow-y-auto font-mono text-xs">
          {feed.map((c) => (
            <li key={c.cue_id} lang={c.segment.lang} className="rounded bg-slate-900 px-2 py-1">
              {c.anchor.clock} · {`${c.segment.mode}.${c.segment.lang}.${c.segment.club ?? "neutral"}`} · {c.display.slot} · {c.verified ? "✓" : "✗"} · {c.text?.headline}
            </li>
          ))}
        </ol>
      </section>
    </main>
  )
}
```

Apply this change to `apps/web/src/Root.tsx`, `apps/web/src/Watch.tsx`, `apps/web/src/i18n.ts` (from the repository root):

```bash
git apply <<'PATCH'
diff --git a/apps/web/src/Root.tsx b/apps/web/src/Root.tsx
index 5187590..ae3fcc3 100644
--- a/apps/web/src/Root.tsx
+++ b/apps/web/src/Root.tsx
@@ -2,6 +2,7 @@ import { useEffect, useState } from "react"
 import { App } from "./App.js"
 import type { TouchlineClient } from "./client.js"
 import { parseRoute, type Route } from "./route.js"
+import { Studio } from "./Studio.js"
 
 /** The page the URL hash names (see route.ts), following hash changes. */
 export const Root = ({ client }: { client: TouchlineClient }) => {
@@ -12,6 +13,8 @@ export const Root = ({ client }: { client: TouchlineClient }) => {
     return () => window.removeEventListener("hashchange", on)
   }, [])
   switch (route.page) {
+    case "studio":
+      return <Studio client={client} session={route.session} segment={route.segment} />
     default:
       return <App client={client} />
   }
diff --git a/apps/web/src/Watch.tsx b/apps/web/src/Watch.tsx
index 3e47668..ef6b1d8 100644
--- a/apps/web/src/Watch.tsx
+++ b/apps/web/src/Watch.tsx
@@ -10,6 +10,7 @@ import { RecapPanel } from "./RecapPanel.js"
 import { WhyDrawer } from "./WhyDrawer.js"
 import { segmentOf, type Profile } from "./profile.js"
 import { TopBar } from "./TopBar.js"
+import { routeHash } from "./route.js"
 import { usePane } from "./usePane.js"
 
 export const SPEEDS = [1, 2, 4, 8, 16, 32]
@@ -76,6 +77,7 @@ export const Watch = ({ client, sessionId, match, profile, onProfile, onBack }:
           {playback.state === "paused" ? t(lang, "play") : t(lang, "pause")}
         </button>
         <button type="button" className="rounded bg-slate-800 px-3 py-1" onClick={toggleSplit}>{second ? t(lang, "single") : t(lang, "split")}</button>
+        <a className="rounded bg-slate-800 px-3 py-1" target="_blank" rel="noreferrer" href={routeHash({ page: "studio", session: sessionId, segment: segmentOf(profile) })}>{t(lang, "studio")}</a>
         <label className="text-sm">
           {t(lang, "speed")}{" "}
           <select aria-label={t(lang, "speed")} className="rounded bg-slate-800 px-2 py-1" value={playback.speed} onChange={(e) => control("speed", Number(e.target.value))}>
diff --git a/apps/web/src/i18n.ts b/apps/web/src/i18n.ts
index ec9de33..1c7e696 100644
--- a/apps/web/src/i18n.ts
+++ b/apps/web/src/i18n.ts
@@ -41,7 +41,20 @@ const en = {
   lost: "Connection lost — trying again…",
   gone: "This session has ended.",
   notYet: "Not yet: the recap comes at the whistle.",
-  startFailed: "Could not start the match. Try again."
+  startFailed: "Could not start the match. Try again.",
+  studio: "Studio console",
+  queue: "Queue",
+  emptyQueue: "No moments yet.",
+  approve: "Approve",
+  hold: "Hold",
+  send: "Send to graphics",
+  pending: "Pending",
+  approved: "Approved",
+  held: "Held",
+  onAir: "On air",
+  talkingPoints: "Talking points",
+  noPoints: "Approve a moment to add its talking points.",
+  rawFeed: "Raw cue feed"
 } as const
 
 export type Key = keyof typeof en
@@ -88,7 +101,20 @@ export const STRINGS: Record<Lang, Record<Key, string>> = {
     lost: "Conexión perdida; reintentando…",
     gone: "Esta sesión ha terminado.",
     notYet: "Todavía no: el resumen llega con el silbato.",
-    startFailed: "No se pudo iniciar el partido. Inténtalo de nuevo."
+    startFailed: "No se pudo iniciar el partido. Inténtalo de nuevo.",
+    studio: "Consola de estudio",
+    queue: "Cola",
+    emptyQueue: "Aún no hay momentos.",
+    approve: "Aprobar",
+    hold: "Retener",
+    send: "Enviar a gráficos",
+    pending: "Pendiente",
+    approved: "Aprobado",
+    held: "Retenido",
+    onAir: "En antena",
+    talkingPoints: "Puntos para el presentador",
+    noPoints: "Aprueba un momento para añadir sus puntos.",
+    rawFeed: "Flujo de cues sin filtrar"
   },
   hi: {
     title: "Touchline",
@@ -130,7 +156,20 @@ export const STRINGS: Record<Lang, Record<Key, string>> = {
     lost: "कनेक्शन टूट गया — फिर से कोशिश हो रही है…",
     gone: "यह सत्र समाप्त हो गया है।",
     notYet: "अभी नहीं: सारांश सीटी बजने पर आएगा।",
-    startFailed: "मैच शुरू नहीं हो सका। फिर से कोशिश करें।"
+    startFailed: "मैच शुरू नहीं हो सका। फिर से कोशिश करें।",
+    studio: "स्टूडियो कंसोल",
+    queue: "कतार",
+    emptyQueue: "अभी कोई पल नहीं।",
+    approve: "मंज़ूर करें",
+    hold: "रोकें",
+    send: "ग्राफ़िक्स पर भेजें",
+    pending: "बाकी",
+    approved: "मंज़ूर",
+    held: "रोका गया",
+    onAir: "ऑन एयर",
+    talkingPoints: "प्रस्तुतकर्ता के बिंदु",
+    noPoints: "बिंदु जोड़ने के लिए कोई पल मंज़ूर करें।",
+    rawFeed: "सभी क्यू की फ़ीड"
   }
 }
 
PATCH
```

- [ ] **Step 4: Run the tests**

Run: `pnpm --filter @touchline/web test && pnpm --filter @touchline/web typecheck`
Expected: 34 passed, no type errors

- [ ] **Step 5: Commit**

```bash
git add apps/web
git commit -m "feat(web): studio console — the producer's queue (approve, hold, send to graphics), presenter talking points and the raw cue feed, opened from a session

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 9: Web: broadcast graphics output

The page a vision mixer or OBS keys over the match picture.
- **What it shows:** a transparent background, the scoreboard, and the cues the producer sent, in their slots. No pitch and no buttons.
- **Its own stream:** it reuses the fan app's pane state with `usePane(…, "graphics")`, so cues still leave on their ttl and a lost connection is retried.
- **The teams:** the scoreboard needs them, so the graphics route carries the match id. A graphics link without a match is the fan app.

**Files:**
- Create: `apps/web/src/Graphics.tsx`
- Modify: `apps/web/src/route.ts`, `apps/web/src/usePane.ts`, `apps/web/src/TopBar.tsx`, `apps/web/src/Root.tsx`, `apps/web/src/Watch.tsx`, `apps/web/src/i18n.ts`
- Test: `apps/web/test/graphics.test.tsx`, `apps/web/test/route.test.ts`

**Interfaces:**
- Consumes: `TouchlineClient.graphics` (Task 7), `Overlays`, `TopBar`, `usePane` (Plan 5a).
- Produces:
  - `Graphics({ client, session, segment, match })`.
  - `usePane(client, sessionId, segment, source = "watch" | "graphics")`.
  - `TopBar` taking `Pick<MatchSummary, "home" | "away">`.
  - The graphics `Route` gains `match`.
  - The string `graphicsOut`.

- [ ] **Step 1: Write the failing tests**

Create `apps/web/test/graphics.test.tsx`:

```tsx
import { act, render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { describe, expect, it } from "vitest"
import type { Cue } from "@touchline/schema"
import { App } from "../src/App.js"
import { Graphics } from "../src/Graphics.js"
import { fakeClient, INFO } from "./fake-client.js"

const segment = { mode: "casual", lang: "en", club: null } as const
const board: Cue = {
  cue_id: "m-board-120", schema: "touchline.cue/1", match_id: "m", moment_id: null, anchor: { frame_from: 120, frame_to: 120, clock: "12:00" },
  display: { slot: "top_bar", priority: 3, ttl_ms: 2000, template: "scoreboard" }, segment, text: null, data: { "score.home": 1, "score.away": 0 }, evidence: [], verified: true
}
const goal: Cue = {
  ...board, cue_id: "mo-1-casual.en.neutral", moment_id: "mo-1", display: { slot: "lower_third", priority: 1, ttl_ms: 12000, template: "goal" },
  text: { headline: "Wylford scores", body: "A crisp finish." }, data: {}
}

describe("graphics output", () => {
  it("shows the scoreboard and the cues sent to air over a transparent page, with no pitch and no buttons", () => {
    const client = fakeClient()
    render(<Graphics client={client} session="s1" segment={segment} match={INFO} />)
    expect(document.body.style.background).toBe("transparent")
    act(() => client.pushGraphics({ kind: "cue", cue: board }))
    act(() => client.pushGraphics({ kind: "cue", cue: goal }))
    expect(screen.getByTestId("score").textContent).toBe("1–0")
    expect(screen.getByText("Wylford scores")).toBeTruthy()
    expect(document.querySelector("canvas")).toBeNull()
    expect(screen.queryByRole("button")).toBeNull()
  })

  it("opens from a session in the fan app, for the viewer's segment", async () => {
    const client = fakeClient()
    render(<App client={client} />)
    await userEvent.click(await screen.findByRole("button", { name: "Watch" }))
    expect(screen.getByRole("link", { name: "Graphics output" }).getAttribute("href")).toBe("#/graphics/s1?seg=casual.en.neutral&match=lib-costly_error-1")
  })
})
```

Apply this change to `apps/web/test/route.test.ts` (from the repository root):

```bash
git apply <<'PATCH'
diff --git a/apps/web/test/route.test.ts b/apps/web/test/route.test.ts
index ba24acf..1a54b58 100644
--- a/apps/web/test/route.test.ts
+++ b/apps/web/test/route.test.ts
@@ -4,7 +4,8 @@ import { parseRoute, routeHash } from "../src/route.js"
 describe("routes", () => {
   it("read the studio, graphics and ops pages of a session from the hash", () => {
     expect(parseRoute("#/studio/s1?seg=analyst.es.neutral")).toEqual({ page: "studio", session: "s1", segment: { mode: "analyst", lang: "es", club: null } })
-    expect(parseRoute("#/graphics/s1?seg=casual.hi.northwick")).toEqual({ page: "graphics", session: "s1", segment: { mode: "casual", lang: "hi", club: "northwick" } })
+    expect(parseRoute("#/graphics/s1?seg=casual.hi.northwick&match=m1")).toEqual({ page: "graphics", session: "s1", segment: { mode: "casual", lang: "hi", club: "northwick" }, match: "m1" })
+    expect(parseRoute("#/graphics/s1?seg=casual.hi.northwick")).toEqual({ page: "fan" }) // graphics need the match (for the teams)
     expect(parseRoute("#/ops/s1")).toEqual({ page: "ops", session: "s1" })
   })
 
@@ -14,7 +15,10 @@ describe("routes", () => {
   })
 
   it("write what they read", () => {
-    for (const r of [{ page: "fan" }, { page: "ops", session: "s 1" }, { page: "studio", session: "s1", segment: { mode: "analyst", lang: "hi", club: "larkspur" } }] as const) {
+    for (const r of [
+      { page: "fan" }, { page: "ops", session: "s 1" }, { page: "studio", session: "s1", segment: { mode: "analyst", lang: "hi", club: "larkspur" } },
+      { page: "graphics", session: "s1", segment: { mode: "casual", lang: "en", club: null }, match: "lib-x" }
+    ] as const) {
       expect(parseRoute(routeHash(r))).toEqual(r)
     }
   })
PATCH
```

- [ ] **Step 2: Run them to make sure they fail**

Run: `pnpm --filter @touchline/web exec vitest run test/graphics.test.tsx test/route.test.ts`
Expected: `graphics.test.tsx` fails to load (`Failed to resolve import "../src/Graphics.js"`) and 2 route tests fail (the graphics route has no `match`)

- [ ] **Step 3: Write the graphics output**

Create `apps/web/src/Graphics.tsx`:

```tsx
import { useEffect } from "react"
import type { MatchSummary } from "@touchline/rpc"
import type { Segment } from "@touchline/schema"
import type { TouchlineClient } from "./client.js"
import { Overlays, useNow } from "./Overlays.js"
import { TopBar } from "./TopBar.js"
import { usePane } from "./usePane.js"

/**
 * The broadcast graphics output (spec §5.6 "send to graphics"): a transparent page for a vision mixer or OBS to key
 * over the match picture. It shows the scoreboard and only the cues the producer sent to air, with no pitch and no
 * buttons.
 */
export const Graphics = ({ client, session, segment, match }: { client: TouchlineClient; session: string; segment: Segment; match: Pick<MatchSummary, "home" | "away"> }) => {
  const pane = usePane(client, session, segment, "graphics")
  const now = useNow()
  useEffect(() => {
    const was = document.body.style.background
    document.body.style.background = "transparent"
    return () => {
      document.body.style.background = was
    }
  }, [])
  return (
    <main className="relative h-screen w-screen font-sans text-white">
      <div className="absolute left-6 top-6 w-[32rem]">
        <TopBar match={match} board={pane.board} lang={segment.lang} />
      </div>
      <div className="absolute inset-x-6 bottom-6 top-24">
        <Overlays state={pane} now={now} lang={segment.lang} />
      </div>
    </main>
  )
}
```

Apply this change to `apps/web/src/Root.tsx`, `apps/web/src/TopBar.tsx`, `apps/web/src/Watch.tsx`, `apps/web/src/i18n.ts`, `apps/web/src/route.ts`, `apps/web/src/usePane.ts` (from the repository root):

```bash
git apply <<'PATCH'
diff --git a/apps/web/src/Root.tsx b/apps/web/src/Root.tsx
index ae3fcc3..4d0ae38 100644
--- a/apps/web/src/Root.tsx
+++ b/apps/web/src/Root.tsx
@@ -1,9 +1,20 @@
 import { useEffect, useState } from "react"
+import type { MatchSummary } from "@touchline/rpc"
 import { App } from "./App.js"
 import type { TouchlineClient } from "./client.js"
+import { Graphics } from "./Graphics.js"
 import { parseRoute, type Route } from "./route.js"
 import { Studio } from "./Studio.js"
 
+/** The graphics output once the match (its teams) is known. */
+const GraphicsPage = ({ client, route }: { client: TouchlineClient; route: Extract<Route, { page: "graphics" }> }) => {
+  const [match, setMatch] = useState<MatchSummary | null>(null)
+  useEffect(() => {
+    client.listMatches().then((ms) => setMatch(ms.find((m) => m.match_id === route.match) ?? null), () => setMatch(null))
+  }, [client, route.match])
+  return match && <Graphics client={client} session={route.session} segment={route.segment} match={match} />
+}
+
 /** The page the URL hash names (see route.ts), following hash changes. */
 export const Root = ({ client }: { client: TouchlineClient }) => {
   const [route, setRoute] = useState<Route>(() => parseRoute(window.location.hash))
@@ -13,6 +24,8 @@ export const Root = ({ client }: { client: TouchlineClient }) => {
     return () => window.removeEventListener("hashchange", on)
   }, [])
   switch (route.page) {
+    case "graphics":
+      return <GraphicsPage client={client} route={route} />
     case "studio":
       return <Studio client={client} session={route.session} segment={route.segment} />
     default:
diff --git a/apps/web/src/TopBar.tsx b/apps/web/src/TopBar.tsx
index 4a74b30..994c8d2 100644
--- a/apps/web/src/TopBar.tsx
+++ b/apps/web/src/TopBar.tsx
@@ -1,9 +1,9 @@
-import type { MatchInfo } from "@touchline/rpc"
+import type { MatchSummary } from "@touchline/rpc"
 import { t, type Lang } from "./i18n.js"
 import type { Board } from "./pane.js"
 
 /** Score, clock and momentum (the top bar slot of spec §5.4, from the hot path's scoreboard cues). */
-export const TopBar = ({ match, board, lang }: { match: MatchInfo; board: Board | null; lang: Lang }) => (
+export const TopBar = ({ match, board, lang }: { match: Pick<MatchSummary, "home" | "away">; board: Board | null; lang: Lang }) => (
   <div className="flex items-center justify-between rounded-lg bg-slate-900 px-4 py-2 ring-1 ring-slate-800" data-testid="top-bar">
     <span className="font-semibold">{match.home.short}</span>
     <span className="text-xl font-bold tabular-nums" data-testid="score">{board ? `${board.score.home}–${board.score.away}` : "0–0"}</span>
diff --git a/apps/web/src/Watch.tsx b/apps/web/src/Watch.tsx
index ef6b1d8..42b9b4e 100644
--- a/apps/web/src/Watch.tsx
+++ b/apps/web/src/Watch.tsx
@@ -78,6 +78,7 @@ export const Watch = ({ client, sessionId, match, profile, onProfile, onBack }:
         </button>
         <button type="button" className="rounded bg-slate-800 px-3 py-1" onClick={toggleSplit}>{second ? t(lang, "single") : t(lang, "split")}</button>
         <a className="rounded bg-slate-800 px-3 py-1" target="_blank" rel="noreferrer" href={routeHash({ page: "studio", session: sessionId, segment: segmentOf(profile) })}>{t(lang, "studio")}</a>
+        <a className="rounded bg-slate-800 px-3 py-1" target="_blank" rel="noreferrer" href={routeHash({ page: "graphics", session: sessionId, segment: segmentOf(profile), match: match.match_id })}>{t(lang, "graphicsOut")}</a>
         <label className="text-sm">
           {t(lang, "speed")}{" "}
           <select aria-label={t(lang, "speed")} className="rounded bg-slate-800 px-2 py-1" value={playback.speed} onChange={(e) => control("speed", Number(e.target.value))}>
diff --git a/apps/web/src/i18n.ts b/apps/web/src/i18n.ts
index 1c7e696..b0ef4c3 100644
--- a/apps/web/src/i18n.ts
+++ b/apps/web/src/i18n.ts
@@ -54,7 +54,8 @@ const en = {
   onAir: "On air",
   talkingPoints: "Talking points",
   noPoints: "Approve a moment to add its talking points.",
-  rawFeed: "Raw cue feed"
+  rawFeed: "Raw cue feed",
+  graphicsOut: "Graphics output"
 } as const
 
 export type Key = keyof typeof en
@@ -114,7 +115,8 @@ export const STRINGS: Record<Lang, Record<Key, string>> = {
     onAir: "En antena",
     talkingPoints: "Puntos para el presentador",
     noPoints: "Aprueba un momento para añadir sus puntos.",
-    rawFeed: "Flujo de cues sin filtrar"
+    rawFeed: "Flujo de cues sin filtrar",
+    graphicsOut: "Salida de gráficos"
   },
   hi: {
     title: "Touchline",
@@ -169,7 +171,8 @@ export const STRINGS: Record<Lang, Record<Key, string>> = {
     onAir: "ऑन एयर",
     talkingPoints: "प्रस्तुतकर्ता के बिंदु",
     noPoints: "बिंदु जोड़ने के लिए कोई पल मंज़ूर करें।",
-    rawFeed: "सभी क्यू की फ़ीड"
+    rawFeed: "सभी क्यू की फ़ीड",
+    graphicsOut: "ग्राफ़िक्स आउटपुट"
   }
 }
 
diff --git a/apps/web/src/route.ts b/apps/web/src/route.ts
index 56cf92b..da91c36 100644
--- a/apps/web/src/route.ts
+++ b/apps/web/src/route.ts
@@ -1,13 +1,15 @@
 /**
  * The app's pages, in the URL hash so each opens in its own tab or window: the fan app (`#/`), and for a session the
- * studio console (`#/studio/<session>?seg=…`), the broadcast graphics output (`#/graphics/<session>?seg=…`, for a
- * vision mixer or OBS) and the ops view (`#/ops/<session>`). `seg` is a segment key: mode.lang.club, `neutral` for none.
+ * studio console (`#/studio/<session>?seg=…`), the broadcast graphics output (`#/graphics/<session>?seg=…&match=…`,
+ * for a vision mixer or OBS; the match names the teams) and the ops view (`#/ops/<session>`). `seg` is a segment key:
+ * mode.lang.club, `neutral` for none.
  */
 import type { Segment } from "@touchline/schema"
 
 export type Route =
   | { readonly page: "fan" }
-  | { readonly page: "studio" | "graphics"; readonly session: string; readonly segment: Segment }
+  | { readonly page: "studio"; readonly session: string; readonly segment: Segment }
+  | { readonly page: "graphics"; readonly session: string; readonly segment: Segment; readonly match: string }
   | { readonly page: "ops"; readonly session: string }
 
 const DEFAULT_SEGMENT: Segment = { mode: "casual", lang: "en", club: null }
@@ -27,12 +29,17 @@ export const parseRoute = (hash: string): Route => {
   if (!session) return { page: "fan" }
   const id = decodeURIComponent(session)
   if (page === "ops") return { page, session: id }
-  if (page === "studio" || page === "graphics") return { page, session: id, segment: parseSegment(new URLSearchParams(query).get("seg")) }
+  const q = new URLSearchParams(query)
+  if (page === "studio") return { page, session: id, segment: parseSegment(q.get("seg")) }
+  const match = q.get("match")
+  if (page === "graphics" && match) return { page, session: id, segment: parseSegment(q.get("seg")), match }
   return { page: "fan" }
 }
 
 export const routeHash = (r: Route): string => {
   if (r.page === "fan") return "#/"
   const base = `#/${r.page}/${encodeURIComponent(r.session)}`
-  return r.page === "ops" ? base : `${base}?seg=${segmentParam(r.segment)}`
+  if (r.page === "ops") return base
+  const seg = `${base}?seg=${segmentParam(r.segment)}`
+  return r.page === "graphics" ? `${seg}&match=${encodeURIComponent(r.match)}` : seg
 }
diff --git a/apps/web/src/usePane.ts b/apps/web/src/usePane.ts
index 9e90739..824fb35 100644
--- a/apps/web/src/usePane.ts
+++ b/apps/web/src/usePane.ts
@@ -10,8 +10,11 @@ export type Connection = "ok" | "retrying" | "gone"
 /** Watch attempts after a lost connection (1 s, 2 s, 4 s, 8 s, 16 s apart) before the pane gives up. */
 export const RETRIES = 5
 
-/** A pane's state for one segment of a session, updated by every tick; a broken watch is retried with backoff. */
-export const usePane = (client: TouchlineClient, sessionId: string, segment: Segment): PaneState & { readonly connection: Connection } => {
+/**
+ * A pane's state for one segment of a session, updated by every tick; a broken watch is retried with backoff.
+ * `source` picks the stream: the fan view (`watch`) or the broadcast graphics output (`graphics`).
+ */
+export const usePane = (client: TouchlineClient, sessionId: string, segment: Segment, source: "watch" | "graphics" = "watch"): PaneState & { readonly connection: Connection } => {
   const [state, dispatch] = useReducer((s: PaneState, t: Tick) => reduce(s, t, Date.now()), EMPTY)
   const [connection, setConnection] = useState<Connection>("ok")
   const key = `${segment.mode}.${segment.lang}.${segment.club ?? ""}`
@@ -21,7 +24,7 @@ export const usePane = (client: TouchlineClient, sessionId: string, segment: Seg
     let timer: ReturnType<typeof setTimeout> | undefined
     let stop = () => {}
     const start = () => {
-      stop = client.watch(
+      stop = client[source](
         sessionId,
         segment,
         (t) => {
@@ -43,6 +46,6 @@ export const usePane = (client: TouchlineClient, sessionId: string, segment: Seg
       clearTimeout(timer)
       stop()
     }
-  }, [client, sessionId, key])
+  }, [client, sessionId, key, source])
   return { ...state, connection }
 }
PATCH
```

- [ ] **Step 4: Run the tests**

Run: `pnpm --filter @touchline/web test && pnpm --filter @touchline/web typecheck`
Expected: 36 passed, no type errors

- [ ] **Step 5: Commit**

```bash
git add apps/web
git commit -m "feat(web): broadcast graphics output — a transparent page with the scoreboard and only the cues the producer sent to air

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 10: Web: ops view

The ops view page (spec §5.6), refreshed every 2 s.
- **Latency:** the two latencies against their budgets: within budget, over budget, or no measurements yet. The p95 against the budget, then n, p50 and max. Recorded request times are labelled as such.
- **Fact-Checker:** pass, retry and drop counts.
- **The rest:** time per agent, requests by outcome, late and unverified cues, fallbacks, and the models.
- **Ended sessions:** a session that is gone says so.

It is stat tiles and tables, not charts. The ops route carries the viewer's language.

**Files:**
- Create: `apps/web/src/Ops.tsx`
- Modify: `apps/web/src/route.ts`, `apps/web/src/i18n.ts`, `apps/web/src/Root.tsx`, `apps/web/src/Watch.tsx`
- Test: `apps/web/test/ops.test.tsx`, `apps/web/test/route.test.ts`

**Interfaces:**
- Consumes: `TouchlineClient.ops` (Task 7), `OpsReport`, `Budget` (Task 1).
- Produces: `Ops({ client, session, lang })`, `OPS_POLL_MS = 2000`, the ops `Route` gains `lang`, and the strings `opsView`, `statsLatency`, `insightLatency`, `recordedRequests`, `withinBudget`, `overBudget`, `noData`, `factCheck`, `fcPass`, `fcRetry`, `fcDrop`, `agentTimes`, `agent`, `requests`, `fallbacks`, `lateCues`, `unverifiedCues`, `moments`, `cues`, `none`.

- [ ] **Step 1: Write the failing tests**

Create `apps/web/test/ops.test.tsx`:

```tsx
import { render, screen, waitFor, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { describe, expect, it } from "vitest"
import type { OpsReport } from "@touchline/rpc"
import { App } from "../src/App.js"
import { Ops } from "../src/Ops.js"
import { fakeClient } from "./fake-client.js"

const report = (over: Partial<OpsReport> = {}): OpsReport => ({
  session_id: "s1", live: true, frame: 30000, models: ["openai:gpt-6.1-sol"], moments: 9, cues: 108,
  fact_check: { pass: 8, retry: 2, drop: 1 }, fallbacks: { narrator: 1 },
  agents: [{ agent: "analyst", n: 9, p50: 4800, p95: 6100, max: 6300 }, { agent: "narrator", n: 9, p50: 2100, p95: 2900, max: 3000 }],
  requests: { ok: 14, timeout: 2 }, late_cues: 3, unverified_cues: 0,
  latency: {
    stats: { n: 3, p50: 0.4, p95: 1.2, max: 1.2, budget_ms: 250, ok: true },
    insight: { n: 9, p50: 3100, p95: 5200, max: 5600, budget_ms: 4000, ok: false, source: "live" }
  },
  ...over
})

const tile = (name: string) => screen.getByRole("region", { name })

describe("ops view", () => {
  it("shows latency against the spec's budgets, fact-check verdicts, time per agent and requests", async () => {
    render(<Ops client={fakeClient({ ops: report() })} session="s1" lang="en" />)
    const stats = await screen.findByRole("region", { name: "Stats overlay: event to screen" })
    expect(within(stats).getByText("Within budget")).toBeTruthy()
    expect(within(stats).getByText("p95 1.2 ms / 250 ms")).toBeTruthy()
    const insight = tile("AI insight: signal to cue")
    expect(within(insight).getByText("Over budget")).toBeTruthy()
    expect(within(insight).getByText("p95 5200 ms / 4000 ms")).toBeTruthy()
    const fc = tile("Fact-check verdicts")
    expect([within(fc).getByTestId("pass").textContent, within(fc).getByTestId("retry").textContent, within(fc).getByTestId("drop").textContent]).toEqual(["8", "2", "1"])
    const rows = within(tile("Time per agent")).getAllByRole("row").slice(1).map((r) => [...r.querySelectorAll("td")].map((c) => c.textContent))
    expect(rows).toEqual([["analyst", "9", "4800", "6100"], ["narrator", "9", "2100", "2900"]])
    expect(within(tile("Agent requests")).getByText("timeout: 2")).toBeTruthy()
    expect(within(tile("Fallbacks")).getByText("narrator: 1")).toBeTruthy()
    expect(screen.getByText("openai:gpt-6.1-sol")).toBeTruthy()
  })

  it("says when there are no measurements yet, and labels recorded request times as such", async () => {
    const quiet = report({ live: false, latency: { stats: { n: 0, p50: null, p95: null, max: null, budget_ms: 250, ok: null }, insight: { n: 0, p50: null, p95: null, max: null, budget_ms: 4000, ok: null, source: "recorded" } } })
    render(<Ops client={fakeClient({ ops: quiet })} session="s1" lang="en" />)
    expect(await within(await screen.findByRole("region", { name: "Stats overlay: event to screen" })).findByText("No measurements yet")).toBeTruthy()
    expect(within(tile("AI insight: signal to cue")).getByText("recorded request time")).toBeTruthy()
  })

  it("refreshes every two seconds, and says when the session is gone", async () => {
    const client = fakeClient({ ops: report() })
    render(<Ops client={client} session="s1" lang="en" />)
    await waitFor(() => expect(client.calls.filter((c) => c === "ops s1").length).toBeGreaterThanOrEqual(2), { timeout: 3500 })
    render(<Ops client={fakeClient()} session="gone" lang="en" />)
    expect(await screen.findByText("This session has ended.")).toBeTruthy()
  })

  it("opens from a session in the fan app, in the viewer's language", async () => {
    const client = fakeClient()
    render(<App client={client} />)
    await userEvent.click(await screen.findByRole("button", { name: "Watch" }))
    expect(screen.getByRole("link", { name: "Ops view" }).getAttribute("href")).toBe("#/ops/s1?lang=en")
  })
})
```

Apply this change to `apps/web/test/route.test.ts` (from the repository root):

```bash
git apply <<'PATCH'
diff --git a/apps/web/test/route.test.ts b/apps/web/test/route.test.ts
index 1a54b58..f38262c 100644
--- a/apps/web/test/route.test.ts
+++ b/apps/web/test/route.test.ts
@@ -6,7 +6,8 @@ describe("routes", () => {
     expect(parseRoute("#/studio/s1?seg=analyst.es.neutral")).toEqual({ page: "studio", session: "s1", segment: { mode: "analyst", lang: "es", club: null } })
     expect(parseRoute("#/graphics/s1?seg=casual.hi.northwick&match=m1")).toEqual({ page: "graphics", session: "s1", segment: { mode: "casual", lang: "hi", club: "northwick" }, match: "m1" })
     expect(parseRoute("#/graphics/s1?seg=casual.hi.northwick")).toEqual({ page: "fan" }) // graphics need the match (for the teams)
-    expect(parseRoute("#/ops/s1")).toEqual({ page: "ops", session: "s1" })
+    expect(parseRoute("#/ops/s1?lang=hi")).toEqual({ page: "ops", session: "s1", lang: "hi" })
+    expect(parseRoute("#/ops/s1")).toEqual({ page: "ops", session: "s1", lang: "en" })
   })
 
   it("fall back to the fan app, and to casual English, on anything else", () => {
@@ -16,7 +17,7 @@ describe("routes", () => {
 
   it("write what they read", () => {
     for (const r of [
-      { page: "fan" }, { page: "ops", session: "s 1" }, { page: "studio", session: "s1", segment: { mode: "analyst", lang: "hi", club: "larkspur" } },
+      { page: "fan" }, { page: "ops", session: "s 1", lang: "es" }, { page: "studio", session: "s1", segment: { mode: "analyst", lang: "hi", club: "larkspur" } },
       { page: "graphics", session: "s1", segment: { mode: "casual", lang: "en", club: null }, match: "lib-x" }
     ] as const) {
       expect(parseRoute(routeHash(r))).toEqual(r)
PATCH
```

- [ ] **Step 2: Run them to make sure they fail**

Run: `pnpm --filter @touchline/web exec vitest run test/ops.test.tsx test/route.test.ts`
Expected: `ops.test.tsx` fails to load (`Failed to resolve import "../src/Ops.js"`) and 2 route tests fail (the ops route has no `lang`)

- [ ] **Step 3: Write the ops view**

Create `apps/web/src/Ops.tsx`:

```tsx
import { useEffect, useState } from "react"
import type { Budget, OpsReport } from "@touchline/rpc"
import type { TouchlineClient } from "./client.js"
import { t, type Lang } from "./i18n.js"

/** How often the ops view asks for fresh numbers. */
export const OPS_POLL_MS = 2000

const Tile = ({ name, children }: { name: string; children: React.ReactNode }) => (
  <section aria-label={name} className="rounded-lg bg-slate-900 p-4 ring-1 ring-slate-800">
    <h2 className="mb-2 font-semibold">{name}</h2>
    {children}
  </section>
)

/** A latency against its budget (spec §2): the p95, and whether it is within the budget. */
const Latency = ({ name, b, note, lang }: { name: string; b: Budget; note?: string; lang: Lang }) => (
  <Tile name={name}>
    {b.ok === null ? (
      <p className="text-slate-400">{t(lang, "noData")}</p>
    ) : (
      <>
        <p className={`inline-block rounded px-2 py-0.5 text-sm font-semibold ${b.ok ? "bg-emerald-700" : "bg-red-700"}`}>{t(lang, b.ok ? "withinBudget" : "overBudget")}</p>
        <p className="mt-2 text-2xl font-bold tabular-nums">{`p95 ${b.p95} ms / ${b.budget_ms} ms`}</p>
        <p className="text-sm tabular-nums text-slate-400">{`n ${b.n} · p50 ${b.p50} ms · max ${b.max} ms`}</p>
      </>
    )}
    {note && <p className="mt-1 text-xs text-slate-400">{note}</p>}
  </Tile>
)

const Counts = ({ counts, lang }: { counts: Readonly<Record<string, number>>; lang: Lang }) => {
  const entries = Object.entries(counts)
  return entries.length === 0 ? <p className="text-slate-400">{t(lang, "none")}</p> : <ul className="text-sm">{entries.map(([k, n]) => <li key={k} className="tabular-nums">{`${k}: ${n}`}</li>)}</ul>
}

/**
 * The ops view (spec §5.6): for one session, as of its frame, the latency of the hot path and the agents against the
 * spec's budgets, the Fact-Checker's verdicts, time per agent, requests, fallbacks and late or unverified cues.
 */
export const Ops = ({ client, session, lang }: { client: TouchlineClient; session: string; lang: Lang }) => {
  const [report, setReport] = useState<OpsReport | null | "gone">(null)
  useEffect(() => {
    let alive = true
    const load = () => client.ops(session).then((r) => alive && setReport(r), () => alive && setReport("gone"))
    load()
    const id = setInterval(load, OPS_POLL_MS)
    return () => {
      alive = false
      clearInterval(id)
    }
  }, [client, session])
  if (report === "gone") return <main className="p-6"><p role="status">{t(lang, "gone")}</p></main>
  if (report === null) return <main className="p-6"><p>{t(lang, "loading")}</p></main>
  const r = report
  return (
    <main className="mx-auto grid max-w-6xl gap-4 p-6 font-sans md:grid-cols-2 lg:grid-cols-3">
      <header className="flex flex-wrap items-center gap-3 md:col-span-2 lg:col-span-3">
        <h1 className="text-2xl font-bold">{t(lang, "opsView")}</h1>
        <span className="rounded bg-slate-800 px-2 py-0.5 text-sm">{t(lang, r.live ? "live" : "recorded")}</span>
        {r.models.map((m) => <span key={m} className="rounded bg-slate-800 px-2 py-0.5 font-mono text-xs">{m}</span>)}
        <span className="text-sm tabular-nums text-slate-400">{`${t(lang, "moments")} ${r.moments} · ${t(lang, "cues")} ${r.cues}`}</span>
      </header>
      <Latency name={t(lang, "statsLatency")} b={r.latency.stats} lang={lang} />
      <Latency name={t(lang, "insightLatency")} b={r.latency.insight} lang={lang} {...(r.latency.insight.source === "recorded" ? { note: t(lang, "recordedRequests") } : {})} />
      <Tile name={t(lang, "factCheck")}>
        <dl className="grid grid-cols-3 gap-2 text-center">
          {(["pass", "retry", "drop"] as const).map((k) => (
            <div key={k}>
              <dt className="text-sm text-slate-400">{t(lang, k === "pass" ? "fcPass" : k === "retry" ? "fcRetry" : "fcDrop")}</dt>
              <dd className="text-2xl font-bold tabular-nums" data-testid={k}>{r.fact_check[k]}</dd>
            </div>
          ))}
        </dl>
      </Tile>
      <Tile name={t(lang, "agentTimes")}>
        <table className="w-full text-sm tabular-nums">
          <thead><tr className="text-slate-400"><th className="text-left">{t(lang, "agent")}</th><th className="pl-3 text-right">n</th><th className="pl-3 text-right">p50 ms</th><th className="pl-3 text-right">p95 ms</th></tr></thead>
          <tbody>
            {r.agents.map((a) => (
              <tr key={a.agent}><td>{a.agent}</td><td className="pl-3 text-right">{a.n}</td><td className="pl-3 text-right">{a.p50}</td><td className="pl-3 text-right">{a.p95}</td></tr>
            ))}
          </tbody>
        </table>
      </Tile>
      <Tile name={t(lang, "requests")}>
        <Counts counts={r.requests} lang={lang} />
        <p className="mt-2 text-sm tabular-nums">{`${t(lang, "lateCues")}: ${r.late_cues} · ${t(lang, "unverifiedCues")}: ${r.unverified_cues}`}</p>
      </Tile>
      <Tile name={t(lang, "fallbacks")}>
        <Counts counts={r.fallbacks} lang={lang} />
      </Tile>
    </main>
  )
}
```

Apply this change to `apps/web/src/Root.tsx`, `apps/web/src/Watch.tsx`, `apps/web/src/i18n.ts`, `apps/web/src/route.ts` (from the repository root):

```bash
git apply <<'PATCH'
diff --git a/apps/web/src/Root.tsx b/apps/web/src/Root.tsx
index 4d0ae38..3c5a612 100644
--- a/apps/web/src/Root.tsx
+++ b/apps/web/src/Root.tsx
@@ -3,6 +3,7 @@ import type { MatchSummary } from "@touchline/rpc"
 import { App } from "./App.js"
 import type { TouchlineClient } from "./client.js"
 import { Graphics } from "./Graphics.js"
+import { Ops } from "./Ops.js"
 import { parseRoute, type Route } from "./route.js"
 import { Studio } from "./Studio.js"
 
@@ -26,6 +27,8 @@ export const Root = ({ client }: { client: TouchlineClient }) => {
   switch (route.page) {
     case "graphics":
       return <GraphicsPage client={client} route={route} />
+    case "ops":
+      return <Ops client={client} session={route.session} lang={route.lang} />
     case "studio":
       return <Studio client={client} session={route.session} segment={route.segment} />
     default:
diff --git a/apps/web/src/Watch.tsx b/apps/web/src/Watch.tsx
index 42b9b4e..4746a53 100644
--- a/apps/web/src/Watch.tsx
+++ b/apps/web/src/Watch.tsx
@@ -79,6 +79,7 @@ export const Watch = ({ client, sessionId, match, profile, onProfile, onBack }:
         <button type="button" className="rounded bg-slate-800 px-3 py-1" onClick={toggleSplit}>{second ? t(lang, "single") : t(lang, "split")}</button>
         <a className="rounded bg-slate-800 px-3 py-1" target="_blank" rel="noreferrer" href={routeHash({ page: "studio", session: sessionId, segment: segmentOf(profile) })}>{t(lang, "studio")}</a>
         <a className="rounded bg-slate-800 px-3 py-1" target="_blank" rel="noreferrer" href={routeHash({ page: "graphics", session: sessionId, segment: segmentOf(profile), match: match.match_id })}>{t(lang, "graphicsOut")}</a>
+        <a className="rounded bg-slate-800 px-3 py-1" target="_blank" rel="noreferrer" href={routeHash({ page: "ops", session: sessionId, lang })}>{t(lang, "opsView")}</a>
         <label className="text-sm">
           {t(lang, "speed")}{" "}
           <select aria-label={t(lang, "speed")} className="rounded bg-slate-800 px-2 py-1" value={playback.speed} onChange={(e) => control("speed", Number(e.target.value))}>
diff --git a/apps/web/src/i18n.ts b/apps/web/src/i18n.ts
index b0ef4c3..4ed32c5 100644
--- a/apps/web/src/i18n.ts
+++ b/apps/web/src/i18n.ts
@@ -55,7 +55,27 @@ const en = {
   talkingPoints: "Talking points",
   noPoints: "Approve a moment to add its talking points.",
   rawFeed: "Raw cue feed",
-  graphicsOut: "Graphics output"
+  graphicsOut: "Graphics output",
+  opsView: "Ops view",
+  statsLatency: "Stats overlay: event to screen",
+  insightLatency: "AI insight: signal to cue",
+  recordedRequests: "recorded request time",
+  withinBudget: "Within budget",
+  overBudget: "Over budget",
+  noData: "No measurements yet",
+  factCheck: "Fact-check verdicts",
+  fcPass: "Pass",
+  fcRetry: "Retry",
+  fcDrop: "Drop",
+  agentTimes: "Time per agent",
+  agent: "Agent",
+  requests: "Agent requests",
+  fallbacks: "Fallbacks",
+  lateCues: "Late cues",
+  unverifiedCues: "Unverified cues",
+  moments: "Moments",
+  cues: "Cues",
+  none: "None"
 } as const
 
 export type Key = keyof typeof en
@@ -116,7 +136,27 @@ export const STRINGS: Record<Lang, Record<Key, string>> = {
     talkingPoints: "Puntos para el presentador",
     noPoints: "Aprueba un momento para añadir sus puntos.",
     rawFeed: "Flujo de cues sin filtrar",
-    graphicsOut: "Salida de gráficos"
+    graphicsOut: "Salida de gráficos",
+    opsView: "Vista de operaciones",
+    statsLatency: "Estadísticas: del evento a la pantalla",
+    insightLatency: "Análisis IA: de la señal al cue",
+    recordedRequests: "tiempo de petición grabado",
+    withinBudget: "Dentro del límite",
+    overBudget: "Por encima del límite",
+    noData: "Aún sin mediciones",
+    factCheck: "Veredictos de verificación",
+    fcPass: "Superado",
+    fcRetry: "Reintento",
+    fcDrop: "Descartado",
+    agentTimes: "Tiempo por agente",
+    agent: "Agente",
+    requests: "Peticiones a los agentes",
+    fallbacks: "Respaldos",
+    lateCues: "Cues tardíos",
+    unverifiedCues: "Cues sin verificar",
+    moments: "Momentos",
+    cues: "Cues",
+    none: "Ninguno"
   },
   hi: {
     title: "Touchline",
@@ -172,7 +212,27 @@ export const STRINGS: Record<Lang, Record<Key, string>> = {
     talkingPoints: "प्रस्तुतकर्ता के बिंदु",
     noPoints: "बिंदु जोड़ने के लिए कोई पल मंज़ूर करें।",
     rawFeed: "सभी क्यू की फ़ीड",
-    graphicsOut: "ग्राफ़िक्स आउटपुट"
+    graphicsOut: "ग्राफ़िक्स आउटपुट",
+    opsView: "ऑप्स व्यू",
+    statsLatency: "आंकड़े: घटना से स्क्रीन तक",
+    insightLatency: "एआई विश्लेषण: संकेत से क्यू तक",
+    recordedRequests: "रिकॉर्ड किया गया अनुरोध समय",
+    withinBudget: "सीमा के भीतर",
+    overBudget: "सीमा से ऊपर",
+    noData: "अभी कोई माप नहीं",
+    factCheck: "तथ्य-जाँच के फ़ैसले",
+    fcPass: "पास",
+    fcRetry: "दोबारा",
+    fcDrop: "हटाया गया",
+    agentTimes: "प्रति एजेंट समय",
+    agent: "एजेंट",
+    requests: "एजेंट अनुरोध",
+    fallbacks: "फ़ॉलबैक",
+    lateCues: "देर से आए क्यू",
+    unverifiedCues: "असत्यापित क्यू",
+    moments: "पल",
+    cues: "क्यू",
+    none: "कोई नहीं"
   }
 }
 
diff --git a/apps/web/src/route.ts b/apps/web/src/route.ts
index da91c36..b9b4bea 100644
--- a/apps/web/src/route.ts
+++ b/apps/web/src/route.ts
@@ -1,16 +1,17 @@
 /**
  * The app's pages, in the URL hash so each opens in its own tab or window: the fan app (`#/`), and for a session the
  * studio console (`#/studio/<session>?seg=…`), the broadcast graphics output (`#/graphics/<session>?seg=…&match=…`,
- * for a vision mixer or OBS; the match names the teams) and the ops view (`#/ops/<session>`). `seg` is a segment key:
+ * for a vision mixer or OBS; the match names the teams) and the ops view (`#/ops/<session>?lang=…`). `seg` is a segment key:
  * mode.lang.club, `neutral` for none.
  */
 import type { Segment } from "@touchline/schema"
+import type { Lang } from "./i18n.js"
 
 export type Route =
   | { readonly page: "fan" }
   | { readonly page: "studio"; readonly session: string; readonly segment: Segment }
   | { readonly page: "graphics"; readonly session: string; readonly segment: Segment; readonly match: string }
-  | { readonly page: "ops"; readonly session: string }
+  | { readonly page: "ops"; readonly session: string; readonly lang: Lang }
 
 const DEFAULT_SEGMENT: Segment = { mode: "casual", lang: "en", club: null }
 
@@ -28,8 +29,9 @@ export const parseRoute = (hash: string): Route => {
   const [, page, session] = path.split("/")
   if (!session) return { page: "fan" }
   const id = decodeURIComponent(session)
-  if (page === "ops") return { page, session: id }
   const q = new URLSearchParams(query)
+  const lang = q.get("lang")
+  if (page === "ops") return { page, session: id, lang: lang === "es" || lang === "hi" ? lang : "en" }
   if (page === "studio") return { page, session: id, segment: parseSegment(q.get("seg")) }
   const match = q.get("match")
   if (page === "graphics" && match) return { page, session: id, segment: parseSegment(q.get("seg")), match }
@@ -39,7 +41,7 @@ export const parseRoute = (hash: string): Route => {
 export const routeHash = (r: Route): string => {
   if (r.page === "fan") return "#/"
   const base = `#/${r.page}/${encodeURIComponent(r.session)}`
-  if (r.page === "ops") return base
+  if (r.page === "ops") return `${base}?lang=${r.lang}`
   const seg = `${base}?seg=${segmentParam(r.segment)}`
   return r.page === "graphics" ? `${seg}&match=${encodeURIComponent(r.match)}` : seg
 }
PATCH
```

- [ ] **Step 4: Run the tests**

Run: `pnpm --filter @touchline/web test && pnpm --filter @touchline/web typecheck`
Expected: 40 passed, no type errors

- [ ] **Step 5: Commit**

```bash
git add apps/web
git commit -m "feat(web): ops view — latency against the 250 ms and 4 s budgets, fact-check verdicts, time per agent, requests and fallbacks, refreshed every 2 s

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 11: README, and the whole stack tried

Document the three pages, run everything, and use the stack the way a producer would.

**Files:**
- Modify: `README.md`

**Interfaces:**
- Consumes: everything above.
- Produces: nothing new.

- [ ] **Step 1: Document the pages**

Apply this change to `README.md` (from the repository root):

```bash
git apply <<'PATCH'
diff --git a/README.md b/README.md
index ce8d441..0968722 100644
--- a/README.md
+++ b/README.md
@@ -102,6 +102,13 @@ pnpm dev                                               # API on :8787 and the fa
 
 `pnpm library --no-agents true` builds a stats-only library without the agent service. The API alone: `pnpm api [--library DIR] [--port 8787]`. Live sessions need the agent service running; with a real model, set `TOUCHLINE_REQUEST_BUDGET_S` on the service below the API's `--budget-ms` (see Agents).
 
+### Studio console, graphics output and ops view
+
+Each session in the fan app links to three more pages, each in its own tab:
+- **Studio console** (`#/studio/<session>?seg=…`): every moment the agents explain joins a producer's queue. **Approve** adds it to the presenter's talking points (the analyst text in the producer's language, then the facts its claims were checked against: no model writes them). **Hold** keeps it off air. **Send to graphics** airs it. Every console on the session sees each decision. A raw feed lists every agent cue as it arrives.
+- **Graphics output** (`#/graphics/<session>?seg=…&match=…`): a transparent page for a vision mixer or OBS, with the scoreboard and only the cues the producer sent.
+- **Ops view** (`#/ops/<session>`): Fact-Checker pass/retry/drop counts, fallbacks, time per agent, requests by outcome, and latency against the spec's budgets: goal to scoreboard under 250 ms, and, live, signal to cue under 4 s (p95). A recorded session reports the request times measured when its cache was made.
+
 ## Packages
 
 | Package | What it does |
@@ -114,8 +121,8 @@ pnpm dev                                               # API on :8787 and the fa
 | `packages/advisor` | What-if sessions rebuilt from run folders, better-option explainer, positioning advisor |
 | `packages/mcp-stats` | MCP server exposing the stats tools to agents (stdio or Streamable HTTP) |
 | `packages/rpc` | The API's RPC contracts (Effect RPC group), shared by the API and the fan app |
-| `apps/api` | Match library, playback sessions on the cue bus, live agents, evidence and recaps over RPC; `pnpm api`, `pnpm library` |
-| `apps/web` | The fan app (React, Vite, Tailwind): pitch, overlays, profiles, "Why?" drawer, recaps, split screen |
+| `apps/api` | Match library, playback sessions on the cue bus, live agents, evidence and recaps, studio queue, graphics output and ops report over RPC; `pnpm api`, `pnpm library` |
+| `apps/web` | The fan app (React, Vite, Tailwind): pitch, overlays, profiles, "Why?" drawer, recaps, split screen; the studio console, graphics output and ops view |
 | `packages/agent-gateway` | A2A client of the agent service: signal batches, recaps, time budget, retry, circuit breaker, cue cache |
 | `services/agents` | The six agents, their workflow, the A2A server and the ground-truth evaluation harness (`evals/`) |
 | `packages/calibrate` | Match statistics (identical to the Python definitions), tuning knobs, tuner, realism gate |
PATCH
```

- [ ] **Step 2: Run the whole suite**

Run: `pnpm turbo run typecheck test --force --concurrency=2`
Expected: `Tasks: 24 successful`

Run: `uv run --project services/agents pytest -q services/agents`
Expected: 158 passed, 7 deselected (the Python side is unchanged)

- [ ] **Step 3: Try it**

Start the agent service on the stub model, build a two-match library and run the stack:

```bash
TOUCHLINE_LLM=stub uv run --project services/agents touchline-agents --port 8100 &
TOUCHLINE_LLM=stub pnpm library --scenarios costly_error,high_press_vs_low_block
pnpm dev
```

Expected:
- `pnpm library` prints `27 moments, 348 cues (stub)` and `33 moments, 420 cues (stub)`.
- At http://localhost:5173, watching Corrin Forge v Northwick shows **Studio console**, **Graphics output** and **Ops view** links.
- The studio console (open it in a second tab):
  - "Big chance for Corrin Forge" arrives at 03:27, pending, with its 12 variants (EN, ES, HI; neutral and the club) in the raw feed.
  - Approving it puts its talking points under the presenter's column: the analyst sentences, then `Cause: clear chance created`, `Expected goals: 0.79` and the momentum share.
- The graphics output, in a third tab:
  - It shows only the scoreboard.
  - After **Send to graphics** on "Northwick Mariners turn up the pressure", it shows that cue in the lower third ("Pressure index: 71%").
- The ops view shows:
  - "Recorded cues", the model `stub`, and the moments and cues so far.
  - Fact-check pass counts, the per-agent times, and requests `ok`.
  - Request time p95 within the 4 s budget, labelled as recorded.
  - Stats latency "No measurements yet" until the first goal.

Stop the servers afterwards.

- [ ] **Step 4: Commit**

```bash
git add README.md
git commit -m "docs: studio console, graphics output and ops view in the README

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

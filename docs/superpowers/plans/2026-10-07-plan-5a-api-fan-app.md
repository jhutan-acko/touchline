# Touchline Plan 5a — API, Cue Bus and Fan App Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The API and the fan app of spec §5.6–§5.7. Viewers pick a simulated match, watch it on a 2D pitch with the agents' fact-checked cues for their own profile in English, Spanish or Hindi, ask "Why?" about any cue, read the recaps, and compare two profiles side by side.

**Architecture:**
- **`packages/rpc`:** the API's contracts as an Effect RPC group.
- **`apps/api` (Effect, Node):**
  - Serves a library of run folders.
  - A session replays one match at a speed: frames from tracking, a scoreboard each second from the stats engine (the hot path) and agent cues at the frames they end on.
  - Every watcher gets the same match time and the cues for its own segment, with neutral and English fallbacks.
  - A live toggle sends the stats engine's signals to the agent service as the match plays.
  - Evidence ("Why?") and recaps come from the run's agent traces and stats.
  - All of it runs over one WebSocket at `/rpc`.
- **`pnpm library`:** fills the library by simulating the six scenarios and caching their agent cues for twelve segments.
- **`apps/web` (React, Vite, Tailwind):** the fan app, talking to the API through a small promise-based client.

**Tech Stack:** as Plans 4a and earlier (TypeScript 5.9.3, vitest 5.0.3, pnpm 11.27, Turborepo 2.11.6). Plus:
- **effect** 4.0.1 (bumped from 4.0.0 repo-wide; `@effect/platform-node` needs it), with `@effect/platform-node` 4.0.1 and `@effect/platform-browser` 4.0.1. RPC and HTTP come from `effect/rpc` and `effect/http`.
- **Front end:** React 19.3.0, Vite 8.3.3, `@vitejs/plugin-react` 6.1.2, Tailwind CSS 4.3.3 with `@tailwindcss/vite` 4.3.3.
- **Tests:** Testing Library (`@testing-library/react` 16.3.3, `@testing-library/dom` 10.4.2, `@testing-library/user-event` 14.6.7) and jsdom 30.1.2.

All are more than a day old, so pnpm's minimum release age allows them.

**Spec:** `docs/superpowers/specs/2026-10-03-touchline-design.md`:
- §4: hot path, agent path, cue bus.
- §5.4: cue contract and slots.
- §5.5: profiles to segments, at most 12.
- §5.6: fan app. Its studio console and ops view are Plan 5b.
- §5.7: API (`listMatches`, `startMatch`, `subscribeCues`, `getRecap`, `getEvidence`).
- §6: cached replay and the live toggle.
- §7: tests.

Roadmap: `docs/superpowers/plans/2026-10-03-touchline-roadmap.md` (Plan 5, split into 5a, this plan, and 5b). Builds on Plan 4a (merged to `main`).

**How code is given:** new files in full. Changes to existing files are exact patches, applied from the repository root with the `git apply <<'PATCH' … PATCH` block shown, each produced from the verified prototype task by task.

**Verification status:** every task was built and run in full before this plan was written: one commit per task, each commit's type checks and tests green. The code blocks reproduce the prototype file for file, checked by replaying the plan on a fresh clone of `main`. Every RED step's expected failure is the output of running that task's tests against the previous task's commit.

At the end:
- **Tests:** 24 of 24 Turborepo tasks green (`@touchline/rpc` 5 tests, `apps/api` 28, `apps/web` 22) and 158 agent tests.
- **The stack, run for real:**
  - The stub agent service, then `pnpm library` for two scenarios: 27 moments and 348 cues, and 33 moments and 420 cues, about 30 s.
  - Then `pnpm dev`, looked at in Chrome.
- **What the browser check showed:**
  - The match list in kit colours.
  - A session from minute 30 at ×4, with the pitch moving, the score, the clock and the momentum bar.
  - Split screen, casual English beside analyst Spanish in the same match time.
  - The "Why?" drawer on "Larkspur City turn up the pressure": cause "sustained high press", the pressure index, PPDA and field tilt checked, three five-minute sparklines, "Written by stub".
  - One fix came from the check: match cards wrapped the score next to long club names (Task 13).
- **Disk:** during prototyping the disk filled twice with tests' simulated matches (about 80 MB each). Task 14 gives every test run its own temp folder and deletes it; a full run now leaves nothing behind.

## Global Constraints

- All earlier constraints hold:
  - Synthetic data only.
  - Pinned versions.
  - No GPL or AGPL code.
  - The OpenAI key stays in the git-ignored `.env.local`, on the agent service: it never reaches the API or the browser.
- **No answer sees the future.**
  - A cached cue appears at the frame its moment ends on; a live cue appears when the agents send it.
  - The scoreboard and the "Why?" history come from the stats engine as of the frame. A session started mid-match still counts everything before its start.
- **Every cue shown is a contract cue.** Cached cues are decoded when the library is read; live cues are decoded by the gateway as they arrive. Stats cues from the hot path use the same contract, verified and without text (spec §5.4).
- **Profiles collapse to segments** (spec §5.5).
  - A viewer gets the cached variant for their segment.
  - Without one, they get the same mode and language without club framing, then English. Never another club's framing.
  - `pnpm library` caches twelve segments per match: both modes, three languages, neutral and the home club.
- **One session, one match time:** play, pause and speed apply to everyone watching it. A session nobody watches stops after 30 s.
- **Tests never call a model.** Live tests use a fake agent service, or the real one on the stub model.
- **Tests delete what they write:** each package's test run gets its own temp folder, removed afterwards (Task 14). A simulated match is about 80 MB.
- **UI strings exist in English, Spanish and Hindi** (Hindi in Devanagari). Cue text is shown as the agents wrote it, with its `lang` attribute.

## Review Focus

1. **A viewer who leaves.** Closing the tab mid-match must not leave a match replaying on the server forever. *Task 4, `session.test.ts` ("stop a session nobody watches").*
2. **A profile the cache has no variant for** (an away fan, a language not generated). The viewer should still see cues, but never one framed for the other club. *Task 2, `library.test.ts` ("prefers the exact segment, then neutral, then English, never another club's framing").*
3. **Starting at minute 60.** The scoreboard must show the score so far, not 0–0. *Task 3, `playback.test.ts` ("starts mid-match with the numbers of the whole match so far").*
4. **Live agents slower than play** (a real model at about 30 s a moment). Requests must not queue up minutes behind the match, and cached cues must not mix with live ones. *Task 7, `live.test.ts` ("merge while a request is under way"; "no cached cues in a live session").*
5. **A paused match.** Cues must still leave the screen when their time is up; nothing else changes the view. *Task 11, `overlays.test.tsx` ("take a cue off the screen when its ttl runs out"), with `useNow` refreshing every 250 ms.*

---

### Task 1: API contracts as an Effect RPC group (and effect 4.0.1)

Spec §5.7's endpoints become one Effect RPC group in a new package `@touchline/rpc`, shared by the API and the fan app:

| RPC | Spec §5.7 | What it does |
|---|---|---|
| `ListMatches` | `listMatches` | The match library |
| `GetMatch` | | One match, with its players |
| `StartSession` | `startMatch` | Play a match at a speed from a minute, recorded or live |
| `Watch` | `subscribeCues` | A stream of frames, cues and playback state for one segment |
| `Control` | | Play, pause or change speed |
| `GetEvidence` | `getEvidence` | What is behind a cue |
| `GetRecap` | `getRecap` | A match's recap and its cards |

- **Shared types:** `MatchSummary`, `MatchInfo`, `PitchFrame`, `Playback`, `Tick`, `Evidence`, `RecapView`.
- **Errors:** tagged `MatchNotFound`, `SessionNotFound` and `EvidenceNotFound`.
- **Speeds:** from 0.25 to 64.
- **Effect version:** the Node HTTP server (`@effect/platform-node` 4.0.1) needs effect ^4.0.1, so every package moves from 4.0.0 to 4.0.1, a patch release published 2026-10-05; `@effect/vitest` follows.

**Files:**
- Create: `packages/rpc/package.json`, `packages/rpc/tsconfig.json`, `packages/rpc/src/contracts.ts`, `packages/rpc/src/index.ts`
- Modify: `effect` 4.0.0 → 4.0.1 in `packages/{advisor,agent-gateway,calibrate,mcp-stats,schema,sim,stats}/package.json` (and `@effect/vitest` in `packages/sim`)
- Test: `packages/rpc/test/contracts.test.ts`
- Regenerate: `pnpm-lock.yaml`

**Interfaces:**
- Consumes: `Cue`, `Moment`, `Recap`, `Segment`, `MetricId`, `ClaimKind` (`@touchline/schema`, Plan 4a).
- Produces (from `@touchline/rpc`):
  - Schemas: `Kit`, `TeamBrief`, `Score`, `MatchSummary` (`match_id`, `scenario`, `seed`, `home`, `away`, `score`, `fps`, `frames`, `segments`, `model`), `Player`, `MatchInfo` (+ `players`), `Spot`, `PitchFrame` (`frame`, `period`, `clock`, `ball`, `home`, `away`), `Playback` (`state`, `frame`, `speed`, `live`).
  - More schemas: `Tick` (`{kind: "frame", frame}` | `{kind: "cue", cue}` | `{kind: "playback", playback}`), `EvidenceClaim`, `Series`, `EvidenceEvent`, `Evidence`, `RecapView`.
  - Errors: `MatchNotFound`, `SessionNotFound`, `EvidenceNotFound`.
  - Also: `MIN_SPEED = 0.25`, `MAX_SPEED = 64`, `TouchlineRpcs` (the group), `decodeTick`.

- [ ] **Step 1: Bump effect**

Apply this change to `packages/advisor/package.json`, `packages/agent-gateway/package.json`, `packages/calibrate/package.json`, `packages/mcp-stats/package.json`, `packages/schema/package.json`, `packages/sim/package.json`, `packages/stats/package.json` (from the repository root):

```bash
git apply <<'PATCH'
diff --git a/packages/advisor/package.json b/packages/advisor/package.json
index 96bec71..f9f58b2 100644
--- a/packages/advisor/package.json
+++ b/packages/advisor/package.json
@@ -11,5 +11,5 @@
     "@touchline/sim-core": "workspace:*",
     "@touchline/stats": "workspace:*"
   },
-  "devDependencies": { "@touchline/league": "workspace:*", "effect": "4.0.0" }
+  "devDependencies": { "@touchline/league": "workspace:*", "effect": "4.0.1" }
 }
diff --git a/packages/agent-gateway/package.json b/packages/agent-gateway/package.json
index e476b5e..6baf365 100644
--- a/packages/agent-gateway/package.json
+++ b/packages/agent-gateway/package.json
@@ -16,7 +16,7 @@
     "@touchline/schema": "workspace:*",
     "@touchline/sim": "workspace:*",
     "@touchline/stats": "workspace:*",
-    "effect": "4.0.0"
+    "effect": "4.0.1"
   },
   "devDependencies": {
     "@touchline/league": "workspace:*",
diff --git a/packages/calibrate/package.json b/packages/calibrate/package.json
index d72bc88..a0770c8 100644
--- a/packages/calibrate/package.json
+++ b/packages/calibrate/package.json
@@ -5,6 +5,6 @@
   "type": "module",
   "exports": { ".": "./src/index.ts" },
   "scripts": { "test": "vitest run", "typecheck": "tsc --noEmit -p .", "calibrate": "tsx src/cli.ts", "realism": "tsx src/realism.ts" },
-  "dependencies": { "@touchline/league": "workspace:*", "@touchline/sim": "workspace:*", "@touchline/sim-core": "workspace:*", "effect": "4.0.0" },
+  "dependencies": { "@touchline/league": "workspace:*", "@touchline/sim": "workspace:*", "@touchline/sim-core": "workspace:*", "effect": "4.0.1" },
   "devDependencies": {}
 }
diff --git a/packages/mcp-stats/package.json b/packages/mcp-stats/package.json
index c4cd8b8..875bdbb 100644
--- a/packages/mcp-stats/package.json
+++ b/packages/mcp-stats/package.json
@@ -18,7 +18,7 @@
     "@touchline/sim": "workspace:*",
     "@touchline/sim-core": "workspace:*",
     "@touchline/stats": "workspace:*",
-    "effect": "4.0.0",
+    "effect": "4.0.1",
     "zod": "4.6.5"
   },
   "devDependencies": {
diff --git a/packages/schema/package.json b/packages/schema/package.json
index 2511c4a..a5eef79 100644
--- a/packages/schema/package.json
+++ b/packages/schema/package.json
@@ -5,6 +5,6 @@
   "type": "module",
   "exports": { ".": "./src/index.ts" },
   "scripts": { "test": "vitest run", "typecheck": "tsc --noEmit -p .", "json": "tsx scripts/json.ts" },
-  "dependencies": { "effect": "4.0.0" },
+  "dependencies": { "effect": "4.0.1" },
   "devDependencies": { "@touchline/sim-core": "workspace:*" }
 }
diff --git a/packages/sim/package.json b/packages/sim/package.json
index 3adfde2..c1f234d 100644
--- a/packages/sim/package.json
+++ b/packages/sim/package.json
@@ -5,6 +5,6 @@
   "type": "module",
   "exports": { ".": "./src/index.ts" },
   "scripts": { "test": "vitest run", "typecheck": "tsc --noEmit -p .", "sim": "tsx src/cli.ts" },
-  "dependencies": { "@touchline/league": "workspace:*", "@touchline/sim-core": "workspace:*", "effect": "4.0.0" },
-  "devDependencies": { "@effect/vitest": "4.0.0" }
+  "dependencies": { "@touchline/league": "workspace:*", "@touchline/sim-core": "workspace:*", "effect": "4.0.1" },
+  "devDependencies": { "@effect/vitest": "4.0.1" }
 }
diff --git a/packages/stats/package.json b/packages/stats/package.json
index 0b45c1b..b8de3dd 100644
--- a/packages/stats/package.json
+++ b/packages/stats/package.json
@@ -15,7 +15,7 @@
     "@touchline/schema": "workspace:*",
     "@touchline/sim": "workspace:*",
     "@touchline/sim-core": "workspace:*",
-    "effect": "4.0.0"
+    "effect": "4.0.1"
   },
   "devDependencies": {
     "@touchline/league": "workspace:*"
PATCH
```

Run: `pnpm install && pnpm turbo run typecheck --concurrency=4`
Expected: the lockfile moves to effect 4.0.1; every package typechecks

- [ ] **Step 2: Write the failing test**

Create `packages/rpc/package.json`:

```json
{
  "name": "@touchline/rpc",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "exports": { ".": "./src/index.ts" },
  "scripts": { "test": "vitest run", "typecheck": "tsc --noEmit -p ." },
  "dependencies": { "@touchline/schema": "workspace:*", "effect": "4.0.1" }
}
```

Create `packages/rpc/tsconfig.json`:

```json
{ "extends": "../../tsconfig.base.json", "include": ["src", "test"] }
```

Create `packages/rpc/test/contracts.test.ts`:

```ts
import { readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { Schema } from "effect"
import { describe, expect, it } from "vitest"
import { decodeTick, MatchNotFound, MatchSummary, TouchlineRpcs } from "../src/contracts.js"

const root = join(dirname(fileURLToPath(import.meta.url)), "../../..")
const cue = (JSON.parse(readFileSync(join(root, "packages/schema/fixtures/agents/valid/cue.json"), "utf8")) as { value: unknown }).value
const team = (id: string, side: "home" | "away") => ({ id, name: id, short: id.slice(0, 3).toUpperCase(), side, kit: { primary: "#112233", secondary: "#ffffff" } })
const frame = { frame: 120, period: "first_half", clock: "00:12.00", ball: { x: 0, y: 0, z: 0 }, home: [{ id: "p-a-01", x: -40, y: 0 }], away: [{ id: "p-b-01", x: 40, y: 0 }] }

describe("API contracts", () => {
  it("carry frames, cues and playback state on one stream", () => {
    expect(decodeTick({ kind: "frame", frame }).kind).toBe("frame")
    expect(decodeTick({ kind: "cue", cue }).kind).toBe("cue")
    expect(decodeTick({ kind: "playback", playback: { state: "paused", frame: 120, speed: 4, live: false } }).kind).toBe("playback")
    expect(() => decodeTick({ kind: "chat", text: "hi" })).toThrow()
    expect(() => decodeTick({ kind: "cue", cue: { ...(cue as object), schema: "touchline.cue/0" } })).toThrow()
  })

  it("describe a match in the library", () => {
    const m = { match_id: "eval-costly_error-1", scenario: "costly_error", seed: 1, home: team("northwick", "home"), away: team("larkspur", "away"), score: { home: 1, away: 2 }, fps: 10, frames: 58007, segments: ["casual.en.neutral"], model: "stub" }
    expect(Schema.decodeUnknownSync(MatchSummary)(m)).toEqual(m)
    expect(() => Schema.decodeUnknownSync(MatchSummary)({ ...m, score: { home: -1, away: 0 } })).toThrow()
  })

  it("offer the endpoints of spec §5.7", () => {
    expect([...TouchlineRpcs.requests.keys()].sort()).toEqual(["Control", "GetEvidence", "GetMatch", "GetRecap", "ListMatches", "StartSession", "Watch"])
  })

  it("refuse playback speeds out of range", () => {
    const start = TouchlineRpcs.requests.get("StartSession")!
    const decode = Schema.decodeUnknownSync(start.payloadSchema as unknown as Schema.Decoder<unknown>)
    expect(() => decode({ match_id: "m", speed: 4, from_minute: 0, live: false })).not.toThrow()
    for (const speed of [0, 100]) expect(() => decode({ match_id: "m", speed, from_minute: 0, live: false })).toThrow()
  })

  it("name their errors", () => {
    expect(new MatchNotFound({ match_id: "x" })._tag).toBe("MatchNotFound")
  })
})
```

Run: `pnpm install`
Expected: the new workspace package is linked

- [ ] **Step 3: Run it to make sure it fails**

Run: `pnpm --filter @touchline/rpc test`
Expected: the file fails to load: `Cannot find module '../src/contracts.js'`

- [ ] **Step 4: Write the contracts**

Create `packages/rpc/src/contracts.ts`:

```ts
/**
 * The API's RPC contracts (spec §5.7), shared by the server (apps/api) and its clients (apps/web): match library,
 * playback sessions on the cue bus, evidence for the "Why?" drawer and recaps.
 */
import { Schema } from "effect"
import { Rpc, RpcGroup } from "effect/rpc"
import { ClaimKind, Cue, MetricId, Moment, Recap, Segment } from "@touchline/schema"

const Id = Schema.String.check(Schema.isMinLength(1))
const Count = Schema.Int.check(Schema.isGreaterThanOrEqualTo(0))

export const Kit = Schema.Struct({ primary: Schema.String, secondary: Schema.String })

export const TeamBrief = Schema.Struct({
  id: Id,
  name: Schema.String,
  short: Schema.String,
  side: Schema.Literals(["home", "away"]),
  kit: Kit
})
export type TeamBrief = typeof TeamBrief.Type

export const Score = Schema.Struct({ home: Count, away: Count })

/** A match in the library: a simulated run folder, with its agents' cue cache when it has one. */
export const MatchSummary = Schema.Struct({
  match_id: Id,
  scenario: Schema.NullOr(Schema.String),
  seed: Schema.Int,
  home: TeamBrief,
  away: TeamBrief,
  /** The final score. */
  score: Score,
  fps: Schema.Int,
  /** The last frame (global tick) of the match. */
  frames: Count,
  /** Segment keys the cue cache has variants for (empty: no agent cues; the match plays with stats only). */
  segments: Schema.Array(Schema.String),
  /** What produced the cached cues ("stub", "openai:gpt-6.1-sol"), or null. */
  model: Schema.NullOr(Schema.String)
})
export type MatchSummary = typeof MatchSummary.Type

export const Player = Schema.Struct({ id: Id, team_id: Id, name: Schema.String, jersey: Schema.Int, role: Schema.String })
export type Player = typeof Player.Type

export const MatchInfo = Schema.Struct({ ...MatchSummary.fields, players: Schema.Array(Player) })
export type MatchInfo = typeof MatchInfo.Type

export const Spot = Schema.Struct({ id: Id, x: Schema.Finite, y: Schema.Finite })

/** Positions at one frame, in metres from the centre spot (x towards the away goal for the home side). */
export const PitchFrame = Schema.Struct({
  frame: Count,
  period: Schema.Literals(["first_half", "second_half"]),
  clock: Schema.String,
  ball: Schema.Struct({ x: Schema.Finite, y: Schema.Finite, z: Schema.Finite }),
  home: Schema.Array(Spot),
  away: Schema.Array(Spot)
})
export type PitchFrame = typeof PitchFrame.Type

export const Playback = Schema.Struct({
  state: Schema.Literals(["playing", "paused", "ended"]),
  frame: Count,
  speed: Schema.Finite,
  live: Schema.Boolean
})
export type Playback = typeof Playback.Type

/** What a watcher receives, in match order: frames, cues for its segment (stats cues and agent cues) and playback state. */
export const Tick = Schema.Union([
  Schema.Struct({ kind: Schema.Literal("frame"), frame: PitchFrame }),
  Schema.Struct({ kind: Schema.Literal("cue"), cue: Cue }),
  Schema.Struct({ kind: Schema.Literal("playback"), playback: Playback })
])
export type Tick = typeof Tick.Type

export const EvidenceClaim = Schema.Struct({
  kind: ClaimKind,
  quote: Schema.String,
  /** What the number is, for people ("Pressure index"). */
  label: Schema.String,
  metric_id: Schema.NullOr(MetricId),
  subject: Schema.NullOr(Schema.String),
  subject_name: Schema.NullOr(Schema.String),
  value: Schema.NullOr(Schema.Finite),
  at_frame: Count,
  event_id: Schema.NullOr(Schema.String)
})
export type EvidenceClaim = typeof EvidenceClaim.Type

export const Series = Schema.Struct({
  metric_id: MetricId,
  subject: Schema.String,
  label: Schema.String,
  points: Schema.Array(Schema.Struct({ frame: Count, value: Schema.NullOr(Schema.Finite) }))
})
export type Series = typeof Series.Type

export const EvidenceEvent = Schema.Struct({
  id: Id,
  type: Schema.String,
  clock: Schema.String,
  team_id: Schema.NullOr(Schema.String),
  player: Schema.NullOr(Schema.String),
  outcome: Schema.NullOr(Schema.String),
  qualifiers: Schema.Record(Schema.String, Schema.Union([Schema.String, Schema.Boolean]))
})
export type EvidenceEvent = typeof EvidenceEvent.Type

/** Behind a cue (spec §5.6 "Why?" drawer): the moment, the cause, each checked claim, metric history and the events. */
export const Evidence = Schema.Struct({
  cue_id: Id,
  moment: Schema.NullOr(Moment),
  cause: Schema.NullOr(Schema.String),
  explanation: Schema.NullOr(Schema.String),
  claims: Schema.Array(EvidenceClaim),
  series: Schema.Array(Series),
  events: Schema.Array(EvidenceEvent),
  model: Schema.NullOr(Schema.String)
})
export type Evidence = typeof Evidence.Type

export const RecapView = Schema.Struct({ recap: Schema.NullOr(Recap), cards: Schema.Array(Cue) })
export type RecapView = typeof RecapView.Type

export class MatchNotFound extends Schema.TaggedError<MatchNotFound>()("MatchNotFound", { match_id: Schema.String }) {}
export class SessionNotFound extends Schema.TaggedError<SessionNotFound>()("SessionNotFound", { session_id: Schema.String }) {}
export class EvidenceNotFound extends Schema.TaggedError<EvidenceNotFound>()("EvidenceNotFound", { cue_id: Schema.String }) {}

export const MIN_SPEED = 0.25
export const MAX_SPEED = 64
const Speed = Schema.Finite.check(Schema.isGreaterThanOrEqualTo(MIN_SPEED), Schema.isLessThanOrEqualTo(MAX_SPEED))

export class TouchlineRpcs extends RpcGroup.make(
  Rpc.make("ListMatches", { success: Schema.Array(MatchSummary) }),
  Rpc.make("GetMatch", { payload: { match_id: Schema.String }, success: MatchInfo, error: MatchNotFound }),
  /** Start playing a match on the cue bus (spec §5.7 startMatch); every watcher of the session sees the same match time. */
  Rpc.make("StartSession", {
    payload: { match_id: Schema.String, speed: Speed, from_minute: Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 130 })), live: Schema.Boolean },
    success: Schema.Struct({ session_id: Id, match: MatchInfo }),
    error: MatchNotFound
  }),
  /** The session's frames and the cues for one segment (spec §5.7 subscribeCues). */
  Rpc.make("Watch", { payload: { session_id: Schema.String, segment: Segment }, success: Tick, error: SessionNotFound, stream: true }),
  Rpc.make("Control", {
    payload: { session_id: Schema.String, action: Schema.Literals(["play", "pause", "speed"]), speed: Schema.NullOr(Speed) },
    success: Playback,
    error: SessionNotFound
  }),
  Rpc.make("GetEvidence", { payload: { match_id: Schema.String, cue_id: Schema.String }, success: Evidence, error: Schema.Union([MatchNotFound, EvidenceNotFound]) }),
  Rpc.make("GetRecap", {
    payload: { match_id: Schema.String, kind: Schema.Literals(["half_time", "full_time"]), segment: Segment },
    success: RecapView,
    error: MatchNotFound
  })
) {}

export const decodeTick = Schema.decodeUnknownSync(Tick)
```

Create `packages/rpc/src/index.ts`:

```ts
export * from "./contracts.js"
```

- [ ] **Step 5: Run the tests**

Run: `pnpm --filter @touchline/rpc test && pnpm --filter @touchline/rpc typecheck`
Expected: 5 passed, no type errors

Run: `pnpm turbo run typecheck test --force --concurrency=2`
Expected: `Tasks: 20 successful` (nothing else changes with effect 4.0.1)

- [ ] **Step 6: Commit**

```bash
git add packages pnpm-lock.yaml
git commit -m "feat(rpc): API contracts (library, sessions on the cue bus, watch stream, evidence, recaps) as an Effect RPC group; effect 4.0.1

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```



### Task 2: API package: match library and per-segment cue selection

`apps/api` starts with the library: a folder of run folders written by `pnpm sim`, with the agents' cue cache when `pnpm agents` has run on them.
- **`readMatch`** builds a `MatchInfo` from the manifest, the league file (names, short names, the side's kit, squads) and the cue cache. That covers the segments it has variants for and the model that wrote them.
- **`scanLibrary`** lists the run folders under a directory and skips anything that is not a run.
- **`pickCues`** chooses, per moment, the best cached variant for a segment: exact, then the same mode and language without club framing, then English for the club, then English neutral. Never another club's framing; a moment with no acceptable variant shows nothing.
- **The test fixture** simulates one scripted match (costly_error, seed 2) into a temp folder and writes a small hand-made cue cache: two goals in three segments, plus a neutral half-time card. It deletes its folders when the test file is done.

**Files:**
- Create: `apps/api/package.json`, `apps/api/tsconfig.json`, `apps/api/vitest.config.ts`, `apps/api/src/library.ts`, `apps/api/src/cues.ts`, `apps/api/src/index.ts`, `apps/api/test/fixture.ts`
- Modify: `pnpm-workspace.yaml` (`apps/*`)
- Test: `apps/api/test/library.test.ts`
- Regenerate: `pnpm-lock.yaml`

**Interfaces:**
- Consumes: `readCueCache`, `writeCache` (`@touchline/agent-gateway`), `segmentKey`, `Cue`, `Segment` (`@touchline/schema`), `MatchInfo`, `MatchSummary` (Task 1), `writeMatch`, `SCENARIOS` (`@touchline/sim`), the league file.
- Produces:
  - `library.ts`: `LibraryError`, `LibraryMatch` (`dir`, `info`, `cues`), `readMatch(dir, league)`, `scanLibrary(root, league) -> Map<match_id, LibraryMatch>`.
  - `cues.ts`: `preference(segment) -> keys`, `pickCues(cues, segment) -> Cue[]` (one per moment or recap, in anchor order).
  - Test fixture: `root`, `league`, `MATCH_ID = "lib-err-2"`, `TestLibrary` (`dir`, `run`, `goals`, `cues`, `traces`), `makeLibrary()`.

- [ ] **Step 1: Create the package**

Apply this change to `pnpm-workspace.yaml` (from the repository root):

```bash
git apply <<'PATCH'
diff --git a/pnpm-workspace.yaml b/pnpm-workspace.yaml
index 7e24990..0ac75c1 100644
--- a/pnpm-workspace.yaml
+++ b/pnpm-workspace.yaml
@@ -1,4 +1,5 @@
 packages:
   - "packages/*"
+  - "apps/*"
 allowBuilds:
   esbuild: true
PATCH
```

Create `apps/api/package.json`:

```json
{
  "name": "@touchline/api",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "exports": { ".": "./src/index.ts" },
  "scripts": {
    "test": "vitest run",
    "typecheck": "tsc --noEmit -p .",
    "serve": "tsx src/main.ts"
  },
  "dependencies": {
    "@effect/platform-node": "4.0.1",
    "@touchline/agent-gateway": "workspace:*",
    "@touchline/rpc": "workspace:*",
    "@touchline/schema": "workspace:*",
    "@touchline/sim": "workspace:*",
    "@touchline/stats": "workspace:*",
    "effect": "4.0.1"
  },
  "devDependencies": {
    "@touchline/league": "workspace:*",
    "@touchline/sim-core": "workspace:*"
  }
}
```

Create `apps/api/tsconfig.json`:

```json
{ "extends": "../../tsconfig.base.json", "include": ["src", "test"] }
```

Create `apps/api/vitest.config.ts`:

```ts
import { defineConfig } from "vitest/config"

export default defineConfig({ test: { testTimeout: 120_000 } })
```

Run: `pnpm install`
Expected: `@touchline/api` and `@effect/platform-node` 4.0.1 installed

- [ ] **Step 2: Write the failing tests**

Create `apps/api/test/fixture.ts`:

```ts
/** A match library for tests: one simulated match (costly_error, seed 2) with a small hand-made cue cache. */
import { mkdtempSync, readFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { Effect } from "effect"
import { writeCache } from "@touchline/agent-gateway"
import type { League } from "@touchline/league"
import { decodeCue, decodeMomentTrace, decodeRecap, type Cue, type DomainEvent, type MomentTrace, type Recap } from "@touchline/schema"
import { SCENARIOS, writeMatch } from "@touchline/sim"
import { DEFAULT_PARAMS } from "@touchline/sim-core"
import { afterAll } from "vitest"

export const root = join(dirname(fileURLToPath(import.meta.url)), "../../..")
export const league = JSON.parse(readFileSync(join(root, "data/league/league.json"), "utf8")) as League
export const MATCH_ID = "lib-err-2"
const fixture = (f: string) => (JSON.parse(readFileSync(join(root, "packages/schema/fixtures/agents/valid", f), "utf8")) as { value: unknown }).value

// Each library is a simulated match (about 80 MB): delete them when the test file is done.
const made: string[] = []
afterAll(() => {
  for (const dir of made.splice(0)) rmSync(dir, { recursive: true, force: true })
})

export interface TestLibrary {
  readonly dir: string
  readonly run: string
  readonly goals: ReadonlyArray<DomainEvent>
  readonly cues: ReadonlyArray<Cue>
  readonly traces: ReadonlyArray<MomentTrace>
}

/** Simulate the match into a fresh library folder and write its cue cache: two goal moments in three segments, and a half-time recap. */
export const makeLibrary = async (): Promise<TestLibrary> => {
  const dir = mkdtempSync(join(tmpdir(), "touchline-lib-"))
  made.push(dir)
  const run = join(dir, MATCH_ID)
  const sc = SCENARIOS.costly_error!
  const club = (id: string) => league.clubs.find((c) => c.id === id)!
  await Effect.runPromise(writeMatch({ matchId: MATCH_ID, seed: 2, kickoffTime: "2026-10-18T14:00:00.000Z", home: club(sc.home), away: club(sc.away), params: DEFAULT_PARAMS, dt: 0.1, script: sc.script }, run))
  const events = readFileSync(join(run, "domain.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l) as DomainEvent)
  const goals = events.filter((e) => e.type === "goal").slice(0, 2)
  const base = fixture("cue.json") as Cue
  const trace0 = fixture("trace.json") as MomentTrace
  const segments = [{ mode: "casual", lang: "en", club: null }, { mode: "analyst", lang: "es", club: null }, { mode: "casual", lang: "en", club: sc.home }] as const
  const cues: Cue[] = []
  const traces: MomentTrace[] = []
  for (const g of goals) {
    const momentId = `mo-${g.id}`
    for (const s of segments) {
      cues.push(decodeCue({
        ...base, cue_id: `${momentId}-${s.mode}.${s.lang}.${s.club ?? "neutral"}`, match_id: MATCH_ID, moment_id: momentId,
        anchor: { frame_from: g.frame_id - 50, frame_to: g.frame_id, clock: g.match_clock.slice(0, 5) },
        display: { slot: s.mode === "casual" ? "lower_third" : "side_panel", priority: 1, ttl_ms: 12000, template: "goal" },
        segment: s, text: { headline: `Goal (${s.mode} ${s.lang}${s.club ? " " + s.club : ""})`, body: "A finish." },
        evidence: [g.id], data: { "team.mom": 0.6 }
      }))
    }
    traces.push(decodeMomentTrace({
      ...trace0,
      moment: { ...trace0.moment, moment_id: momentId, match_id: MATCH_ID, type: "goal", signal_ids: [`${g.id}-signal`], frame_id: g.frame_id, frame_from: g.frame_id - 50, frame_to: g.frame_id, period: g.period, match_clock: g.match_clock, team_id: g.team_id, player_id: g.player_id, priority: 1 },
      analysis: { moment_id: momentId, cause: "clear chance converted", explanation: "A finish from close range.", claims: [
        { kind: "metric", sentence: 0, quote: "60%", metric_id: "team.mom", subject: g.team_id, value: 0.6, at_frame: g.frame_id, window_s: null, event_id: null, receiver_id: null },
        { kind: "event", sentence: 0, quote: "", metric_id: null, subject: g.player_id, value: null, at_frame: g.frame_id, window_s: null, event_id: g.id, receiver_id: null }
      ] },
      draft: { ...trace0.draft, moment_id: momentId },
      verdicts: [{ ...trace0.verdicts[0]!, moment_id: momentId }],
      cue_ids: cues.filter((c) => c.moment_id === momentId).map((c) => c.cue_id)
    }))
  }
  const half = events.find((e) => e.type === "period_end")!
  const recapId = `${MATCH_ID}-recap-half_time`
  const recap = decodeRecap({ ...(fixture("recap.json") as Recap), recap_id: recapId, match_id: MATCH_ID, at_frame: half.frame_id, turning_points: [traces[0]!.moment.moment_id], player_of_match: null })
  cues.push(decodeCue({ ...base, cue_id: `${recapId}-casual.en.neutral`, match_id: MATCH_ID, moment_id: recapId, anchor: { frame_from: half.frame_id, frame_to: half.frame_id, clock: "45:00" },
    display: { slot: "recap_card", priority: 1, ttl_ms: 12000, template: "recap" }, segment: segments[0], text: { headline: "Half-time", body: "Score: 0-1." }, evidence: [] }))
  writeCache(run, { cues, traces, recaps: [recap], requests: [{ kind: "signals", frame: 100, outcome: "ok", ms: 1, cues: cues.length, late: 0, unverified: 0 }] })
  return { dir, run, goals, cues, traces }
}
```

Create `apps/api/test/library.test.ts`:

```ts
import { mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { beforeAll, describe, expect, it } from "vitest"
import { pickCues, preference } from "../src/cues.js"
import { readMatch, scanLibrary } from "../src/library.js"
import { league, makeLibrary, MATCH_ID, type TestLibrary } from "./fixture.js"

let lib: TestLibrary
beforeAll(async () => {
  lib = await makeLibrary()
}, 120_000)

describe("library", () => {
  it("lists run folders with teams, kits, score and the segments the cue cache covers", () => {
    mkdirSync(join(lib.dir, "not-a-run"))
    writeFileSync(join(lib.dir, "notes.txt"), "x")
    const matches = scanLibrary(lib.dir, league)
    expect([...matches.keys()]).toEqual([MATCH_ID])
    const m = matches.get(MATCH_ID)!.info
    expect(m.home).toMatchObject({ id: "northwick", side: "home" })
    expect(m.home.kit.primary).toMatch(/^#[0-9a-f]{6}$/)
    expect(m.score.home + m.score.away).toBeGreaterThan(0)
    expect(m.segments).toEqual(["analyst.es.neutral", "casual.en.neutral", "casual.en.northwick"])
    expect(m.model).toBe("stub")
    expect(m.players.length).toBeGreaterThanOrEqual(40)
  })

  it("plays a match without a cue cache with stats only", () => {
    const bare = join(lib.dir, "..", "bare-copy")
    mkdirSync(bare, { recursive: true })
    for (const f of ["manifest.json", "tracking.jsonl"]) writeFileSync(join(bare, f), readFileSync(join(lib.run, f)))
    const m = readMatch(bare, league)
    expect(m.cues).toEqual([])
    expect(m.info.segments).toEqual([])
    expect(m.info.model).toBeNull()
  })
})

describe("cue selection", () => {
  it("prefers the exact segment, then neutral, then English, never another club's framing", () => {
    expect(preference({ mode: "casual", lang: "hi", club: "larkspur" })).toEqual(["casual.hi.larkspur", "casual.hi.neutral", "casual.en.larkspur", "casual.en.neutral"])
    const home = pickCues(lib.cues, { mode: "casual", lang: "en", club: "northwick" })
    // The two goals in the home fan's framing, the half-time card between them neutral (the only variant it has).
    expect(home.map((c) => [c.display.template, c.segment.club])).toEqual([["goal", "northwick"], ["recap", null], ["goal", "northwick"]])
    const away = pickCues(lib.cues, { mode: "casual", lang: "en", club: "larkspur" })
    expect(away.every((c) => c.segment.club === null)).toBe(true)
    const hindi = pickCues(lib.cues, { mode: "analyst", lang: "hi", club: null })
    expect(hindi).toEqual([]) // no analyst variant in Hindi or English: nothing rather than the wrong mode
    expect(pickCues(lib.cues, { mode: "analyst", lang: "es", club: null }).map((c) => c.segment.lang)).toEqual(["es", "es"])
  })

  it("orders cues by the frame they end on", () => {
    const frames = pickCues(lib.cues, { mode: "casual", lang: "en", club: null }).map((c) => c.anchor.frame_to)
    expect(frames).toEqual([...frames].sort((a, b) => a - b))
  })
})
```

- [ ] **Step 3: Run them to make sure they fail**

Run: `pnpm --filter @touchline/api test library`
Expected: the file fails to load: `Cannot find module '../src/cues.js'`

- [ ] **Step 4: Write the library and the cue selection**

Create `apps/api/src/library.ts`:

```ts
/**
 * The match library: run folders written by `pnpm sim` (and `pnpm agents`), one per match, under one directory.
 * A match plays from its tracking and events; its agent cues come from the run's cue cache (spec §6 cached replay).
 */
import { existsSync, readdirSync, readFileSync } from "node:fs"
import { join } from "node:path"
import type { League } from "@touchline/league"
import { readCueCache } from "@touchline/agent-gateway"
import type { MatchInfo, MatchSummary, Player, TeamBrief } from "@touchline/rpc"
import { segmentKey, type Cue } from "@touchline/schema"

export class LibraryError extends Error {}

export interface LibraryMatch {
  readonly dir: string
  readonly info: MatchInfo
  /** The agents' cached cues (empty without a cache). */
  readonly cues: ReadonlyArray<Cue>
}

interface Manifest {
  readonly match_id: string
  readonly seed: number
  readonly home: string
  readonly away: string
  readonly scenario: string | null
  readonly fps: number
  readonly stats: { readonly frames: number; readonly score: string }
}

const json = <A>(path: string): A => JSON.parse(readFileSync(path, "utf8")) as A

const team = (league: League, id: string, side: "home" | "away"): { brief: TeamBrief; players: Player[] } => {
  const club = league.clubs.find((c) => c.id === id)
  if (!club) throw new LibraryError(`club ${id} is not in the league file`)
  const c = club as unknown as { name: string; short: string; kits: Record<"home" | "away", { primary: string; secondary: string }>; squad: ReadonlyArray<{ id: string; name: string; jersey: number; role: string }> }
  return {
    brief: { id, name: c.name, short: c.short, side, kit: c.kits[side] },
    players: c.squad.map((p) => ({ id: p.id, team_id: id, name: p.name, jersey: p.jersey, role: p.role }))
  }
}

/** Read one run folder (manifest, league names and kits, cue cache). */
export const readMatch = (dir: string, league: League): LibraryMatch => {
  if (!existsSync(join(dir, "manifest.json")) || !existsSync(join(dir, "tracking.jsonl"))) throw new LibraryError(`${dir} is not a run folder (no manifest.json or tracking.jsonl)`)
  const m = json<Manifest>(join(dir, "manifest.json"))
  const [home, away] = [team(league, m.home, "home"), team(league, m.away, "away")]
  const [h, a] = m.stats.score.split("-").map(Number)
  const cues = existsSync(join(dir, "agents", "cues.jsonl")) ? readCueCache(dir) : []
  const summaryPath = join(dir, "agents", "summary.json")
  const model = existsSync(summaryPath) ? (json<{ models: string[] }>(summaryPath).models[0] ?? null) : null
  const summary: MatchSummary = {
    match_id: m.match_id, scenario: m.scenario, seed: m.seed, home: home.brief, away: away.brief, score: { home: h ?? 0, away: a ?? 0 },
    fps: m.fps, frames: m.stats.frames, segments: [...new Set(cues.map((c) => segmentKey(c.segment)))].sort(), model
  }
  return { dir, info: { ...summary, players: [...home.players, ...away.players] }, cues }
}

/** Every run folder directly under `root`, by match id (folders that are not runs are skipped). */
export const scanLibrary = (root: string, league: League): Map<string, LibraryMatch> => {
  const out = new Map<string, LibraryMatch>()
  if (!existsSync(root)) return out
  for (const name of readdirSync(root, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name).sort()) {
    try {
      const m = readMatch(join(root, name), league)
      out.set(m.info.match_id, m)
    } catch (e) {
      if (!(e instanceof LibraryError)) throw e
    }
  }
  return out
}
```

Create `apps/api/src/cues.ts`:

```ts
import { segmentKey, type Cue, type Segment } from "@touchline/schema"

/**
 * Which cached variant a segment is shown when the cache has none for it exactly: the same mode and language
 * without club framing, then English in the same mode (for its club, then neutral). Never another club's framing.
 */
export const preference = (s: Segment): string[] => [
  ...new Set([
    segmentKey(s),
    segmentKey({ ...s, club: null }),
    segmentKey({ ...s, lang: "en" }),
    segmentKey({ ...s, lang: "en", club: null })
  ])
]

/** One cue per moment or recap for `segment` (the best variant the cache has), in anchor order. */
export const pickCues = (cues: ReadonlyArray<Cue>, segment: Segment): Cue[] => {
  const order = preference(segment)
  const best = new Map<string, { cue: Cue; rank: number }>()
  for (const cue of cues) {
    if (cue.moment_id === null) continue
    const rank = order.indexOf(segmentKey(cue.segment))
    if (rank < 0) continue
    const seen = best.get(cue.moment_id)
    if (!seen || rank < seen.rank) best.set(cue.moment_id, { cue, rank })
  }
  return [...best.values()].map((b) => b.cue).sort((a, b) => a.anchor.frame_to - b.anchor.frame_to || a.cue_id.localeCompare(b.cue_id))
}
```

Create `apps/api/src/index.ts`:

```ts
export * from "./cues.js"
export * from "./library.js"
```

- [ ] **Step 5: Run the tests**

Run: `pnpm --filter @touchline/api test library && pnpm --filter @touchline/api typecheck`
Expected: 4 passed (about 10 s: one simulated match), no type errors

- [ ] **Step 6: Commit**

```bash
git add apps/api pnpm-workspace.yaml pnpm-lock.yaml
git commit -m "feat(api): match library (run folders, kits, score, cue-cache segments) and per-segment cue selection with neutral and English fallbacks

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```



### Task 3: Match timeline and pacing

A match becomes a timeline: the hot path of spec §4, with no model calls.

**`beats(match, fromFrame)`** replays the run through the stats engine and emits, in match order:
- every frame (positions rounded to millimetres);
- a scoreboard each second of match time (score from goal events, each team's momentum share from the engine);
- the signals the engine raises, from events (goals, cards, chances) and from frames (pressure, momentum, sprints), for live agents;
- the cached cues of each moment together, right after the frame the moment ends on;
- an end marker.

Starting mid-match still feeds everything before `fromFrame` through the engine, so the numbers are right from the first frame shown.

**`paced(timeline, control, fps)`** plays it in match time. Each frame waits `1/fps` seconds divided by the speed, and nothing moves while paused; both come from a `SubscriptionRef`, so a change applies at once.

**Files:**
- Create: `apps/api/src/playback.ts`
- Modify: `apps/api/src/index.ts`
- Test: `apps/api/test/playback.test.ts`

**Interfaces:**
- Consumes: `LibraryMatch` (Task 2), `readRun`, `StatsEngine` (`ingest`, `finish`, `clockAt`, `value`), `modelsFromJson`, `xtGridFromJson` (`@touchline/stats`), `PitchFrame` (Task 1).
- Produces: `root`, `Board` (`frame`, `clock`, `score`, `momentum`), `Beat` (`frame` | `board` | `cues` (`frame`, `cues`) | `signals` (`frame`, `signals`) | `end`), `cueGroups(cues)`, `beats(match, fromFrame = 0)`, `Control` (`paused`, `speed`), `paced(timeline, control, fps)`.

- [ ] **Step 1: Write the failing tests**

Create `apps/api/test/playback.test.ts`:

```ts
import { Effect, Fiber, Stream, SubscriptionRef } from "effect"
import { TestClock } from "effect/testing"
import { beforeAll, describe, expect, it } from "vitest"
import { readMatch, type LibraryMatch } from "../src/library.js"
import { beats, paced, type Beat, type Control } from "../src/playback.js"
import { league, makeLibrary, type TestLibrary } from "./fixture.js"

let lib: TestLibrary
let match: LibraryMatch
let all: Beat[]
beforeAll(async () => {
  lib = await makeLibrary()
  match = readMatch(lib.run, league)
  all = [...(await Effect.runPromise(Stream.runCollect(beats(match))))]
}, 180_000)

const frames = (bs: Beat[]) => bs.filter((b) => b.kind === "frame")

describe("timeline", () => {
  it("has every frame, a scoreboard each second ending on the final score, and an end", () => {
    expect(frames(all)).toHaveLength(match.info.frames)
    const boards = all.flatMap((b) => (b.kind === "board" ? [b.board] : []))
    expect(boards.length).toBeGreaterThan(5000)
    expect(boards[boards.length - 1]!.score).toEqual(match.info.score)
    expect(boards.at(-1)!.momentum!.home + boards.at(-1)!.momentum!.away).toBeCloseTo(1, 6)
    expect(all.at(-1)!.kind).toBe("end")
  })

  it("brings each cached moment's variants together right after the frame it ends on", () => {
    const groups = all.flatMap((b, i) => (b.kind === "cues" ? [{ b, prev: all[i - 1]! }] : []))
    expect(groups.map((g) => g.b.kind === "cues" && g.b.cues.length)).toEqual([3, 1, 3]) // goal, half-time card, goal
    for (const { b, prev } of groups) {
      if (b.kind !== "cues") continue
      expect(prev.kind === "frame" || prev.kind === "board" || prev.kind === "signals").toBe(true)
      expect(b.cues.every((c) => c.anchor.frame_to === b.frame)).toBe(true)
    }
  })

  it("passes on the stats engine's signals (goals among them) for live agents", () => {
    const signals = all.flatMap((b) => (b.kind === "signals" ? b.signals : []))
    expect(signals.filter((s) => s.type === "goal")).toHaveLength(match.info.score.home + match.info.score.away)
  })

  it("starts mid-match with the numbers of the whole match so far", async () => {
    const goal = lib.goals[0]!
    const from = goal.frame_id + 600
    const later = [...(await Effect.runPromise(Stream.runCollect(beats(match, from).pipe(Stream.take(40)))))]
    const first = frames(later)[0]!
    expect(first.kind === "frame" && first.frame.frame).toBe(from)
    const board = later.find((b) => b.kind === "board")!
    expect(board.kind === "board" && board.board.score.home + board.board.score.away).toBeGreaterThanOrEqual(1)
  }, 60_000)
})

describe("pacing", () => {
  const ten: Beat[] = Array.from({ length: 10 }, (_, i) => ({ kind: "frame", frame: { frame: i, period: "first_half", clock: "00:00.00", ball: { x: 0, y: 0, z: 0 }, home: [], away: [] } }))

  it("plays ten frames at 10 fps and double speed in half a second, and waits while paused", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const control = yield* SubscriptionRef.make<Control>({ paused: false, speed: 2 })
        const fiber = yield* Stream.runCollect(paced(Stream.fromIterable(ten), control, 10)).pipe(Effect.forkChild)
        yield* TestClock.adjust("499 millis")
        expect(fiber.pollUnsafe()).toBeUndefined()
        yield* TestClock.adjust("1 millis")
        expect([...(yield* Fiber.join(fiber))]).toHaveLength(10)

        yield* SubscriptionRef.set(control, { paused: true, speed: 2 })
        const held = yield* Stream.runCollect(paced(Stream.fromIterable(ten), control, 10)).pipe(Effect.forkChild)
        yield* TestClock.adjust("10 seconds")
        expect(held.pollUnsafe()).toBeUndefined()
        yield* SubscriptionRef.set(control, { paused: false, speed: 10 })
        yield* TestClock.adjust("100 millis")
        expect([...(yield* Fiber.join(held))]).toHaveLength(10)
      }).pipe(Effect.provide(TestClock.layer()))
    ))
})
```

- [ ] **Step 2: Run them to make sure they fail**

Run: `pnpm --filter @touchline/api test playback`
Expected: the file fails to load: `Cannot find module '../src/playback.js'`

- [ ] **Step 3: Write the timeline and the pacing**

Create `apps/api/src/playback.ts`:

```ts
/**
 * A match as a timeline (the hot path of spec §4): its frames from tracking, a scoreboard each second from the stats
 * engine (score, momentum), the signals the engine raises (for live agents), and the cached agent cues at the frame
 * each one ends on. `paced` plays it at a speed, pausable.
 */
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { Duration, Effect, Stream, SubscriptionRef } from "effect"
import type { PitchFrame } from "@touchline/rpc"
import type { Cue, Signal } from "@touchline/schema"
import { modelsFromJson, readRun, StatsEngine, xtGridFromJson, type ReplayError, type Roster, type StatsInput, type TrackFrame } from "@touchline/stats"
import type { LibraryMatch } from "./library.js"

export const root = join(import.meta.dirname, "../../..")

export interface Board {
  readonly frame: number
  readonly clock: string
  readonly score: { readonly home: number; readonly away: number }
  /** Each team's momentum share (null until there is play to measure). */
  readonly momentum: { readonly home: number; readonly away: number } | null
}

export type Beat =
  | { readonly kind: "frame"; readonly frame: PitchFrame }
  | { readonly kind: "board"; readonly board: Board }
  /** The variants of one moment or recap, all segments: each watcher picks its own. */
  | { readonly kind: "cues"; readonly frame: number; readonly cues: ReadonlyArray<Cue> }
  | { readonly kind: "signals"; readonly frame: number; readonly signals: ReadonlyArray<Signal> }
  | { readonly kind: "end"; readonly frame: number }

const params = (f: string) => JSON.parse(readFileSync(join(root, "data/params", f), "utf8"))
let roster: Roster | undefined
const league = (): Roster => (roster ??= JSON.parse(readFileSync(join(root, "data/league/league.json"), "utf8")) as Roster)

const r3 = (v: number) => Math.round(v * 1000) / 1000

const toFrame = (f: TrackFrame, clock: string): PitchFrame => ({
  frame: f.tick,
  period: f.period,
  clock,
  ball: { x: r3(f.ball.x), y: r3(f.ball.y), z: r3(f.ball.z) },
  home: f.home.map((p) => ({ id: p.id, x: r3(p.x), y: r3(p.y) })),
  away: f.away.map((p) => ({ id: p.id, x: r3(p.x), y: r3(p.y) }))
})

/** Cached cues grouped by moment (or recap), in the order of the frame they end on. */
export const cueGroups = (cues: ReadonlyArray<Cue>): Array<{ frame: number; cues: Cue[] }> => {
  const by = new Map<string, Cue[]>()
  for (const c of cues) if (c.moment_id !== null) by.set(c.moment_id, [...(by.get(c.moment_id) ?? []), c])
  return [...by.values()].map((cs) => ({ frame: cs[0]!.anchor.frame_to, cues: cs })).sort((a, b) => a.frame - b.frame)
}

/** The match's timeline from `fromFrame` (earlier play still feeds the stats engine, so numbers are right), unpaced. */
export const beats = (m: LibraryMatch, fromFrame = 0): Stream.Stream<Beat, ReplayError> =>
  Stream.unwrap(
    Effect.gen(function* () {
      const run = yield* readRun(m.dir, league())
      const engine = new StatsEngine(run.info, modelsFromJson(params("stats-models.json")), xtGridFromJson(params("xt-grid.json")))
      const groups = cueGroups(m.cues)
      const every = Math.max(1, Math.round(1 / run.info.dt)) // a scoreboard each second of match time
      const { home, away } = run.info
      const score = { home: 0, away: 0 }
      let next = 0
      let last = 0
      const due = (frame: number): Beat[] => {
        const out: Beat[] = []
        while (next < groups.length && groups[next]!.frame <= frame) {
          const g = groups[next++]!
          if (g.frame >= fromFrame) out.push({ kind: "cues", frame: g.frame, cues: g.cues })
        }
        return out
      }
      const step = (input: StatsInput): Beat[] => {
        const signals = engine.ingest(input)
        if (input.kind === "event") {
          // Events raise most signals (goals, cards, big chances), frames the rest (pressure, momentum, sprints).
          if (input.event.type === "goal") input.event.team_id === home.id ? score.home++ : score.away++
          const at = signals[0]?.frame_id ?? 0
          return signals.length && at >= fromFrame ? [{ kind: "signals", frame: at, signals }] : []
        }
        const f = input.frame
        last = f.tick
        const out: Beat[] = []
        if (f.tick >= fromFrame) {
          const clock = engine.clockAt(f.tick)
          out.push({ kind: "frame", frame: toFrame(f, clock) })
          if (signals.length) out.push({ kind: "signals", frame: f.tick, signals })
          if (f.tick % every === 0) {
            const mom = engine.value("team.mom", home.id, { at: f.tick })
            out.push({ kind: "board", board: { frame: f.tick, clock, score: { ...score }, momentum: mom === null ? null : { home: r3(mom), away: r3(1 - mom) } } })
          }
        }
        return [...out, ...due(f.tick)]
      }
      return run.inputs.pipe(
        Stream.map(step),
        Stream.flattenIterable,
        Stream.concat(
          Stream.suspend(() => {
            const signals = engine.finish()
            const tail: Beat[] = signals.length && last >= fromFrame ? [{ kind: "signals", frame: last, signals }] : []
            return Stream.fromIterable([...tail, ...due(Number.MAX_SAFE_INTEGER), { kind: "end", frame: last } as Beat])
          })
        )
      )
    })
  )

export interface Control {
  readonly paused: boolean
  /** Match seconds per wall-clock second. */
  readonly speed: number
}

/** Play the timeline in match time: each frame waits 1/fps of a second divided by the speed, and not at all while paused. */
export const paced = <E>(timeline: Stream.Stream<Beat, E>, control: SubscriptionRef.SubscriptionRef<Control>, fps: number): Stream.Stream<Beat, E> =>
  timeline.pipe(
    Stream.tap((beat) =>
      beat.kind !== "frame"
        ? Effect.void
        : Effect.gen(function* () {
            let c = yield* SubscriptionRef.get(control)
            if (c.paused) {
              yield* SubscriptionRef.changes(control).pipe(Stream.filter((x) => !x.paused), Stream.runHead)
              c = yield* SubscriptionRef.get(control)
            }
            yield* Effect.sleep(Duration.millis(1000 / fps / c.speed))
          })
    )
  )
```

Apply this change to `apps/api/src/index.ts` (from the repository root):

```bash
git apply <<'PATCH'
diff --git a/apps/api/src/index.ts b/apps/api/src/index.ts
index da967cd..a2da5cf 100644
--- a/apps/api/src/index.ts
+++ b/apps/api/src/index.ts
@@ -1,2 +1,3 @@
 export * from "./cues.js"
 export * from "./library.js"
+export * from "./playback.js"
PATCH
```

- [ ] **Step 4: Run the tests**

Run: `pnpm --filter @touchline/api test playback`
Expected: 5 passed: every frame, a scoreboard each second ending on the final score, the three cached groups after their frames, a goal signal per goal, a mid-match start with the score so far, and pacing under `TestClock` (ten frames at ×2 in 500 ms; nothing while paused)

- [ ] **Step 5: Commit**

```bash
git add apps/api
git commit -m "feat(api): match timeline (frames, scoreboard from the stats engine, signals, cached cues at their anchor frame) and pausable pacing

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```



### Task 4: Sessions on the cue bus

A session (spec §5.7 `startMatch`) plays one match at a speed and publishes its timeline on a `PubSub`: the cue bus of spec §4. **`watch(session, segment)`** (spec §5.7 `subscribeCues`) turns it into ticks for one viewer:
- the current playback state first;
- every frame;
- the scoreboard as a stats cue in the viewer's segment (top bar, verified, no text, spec §5.4);
- for each moment, the cached variant `pickCues` chooses for the segment;
- the end.

**Same match time.** All watchers of a session see the same match time, so a split screen shows two segments of one moment together.

**Controls and start.** `control` plays, pauses or changes the speed for everyone. `startFrame` turns a start minute into a frame; minutes from 45 count in the second half, as in scenario scripts.

**Lifetime.** A session ends 60 s after its match ends, and stops 30 s after its last watcher leaves.

**Testing.** The tests drive the session under `TestClock`, advancing in small steps with real I/O in between: the playback fiber reads the run's files before its first sleep.

**Files:**
- Create: `apps/api/src/session.ts`
- Modify: `apps/api/src/index.ts`
- Test: `apps/api/test/session.test.ts`

**Interfaces:**
- Consumes: `beats`, `paced`, `Beat`, `Board`, `Control` (Task 3), `pickCues` (Task 2), `SessionNotFound`, `Tick`, `Playback` (Task 1).
- Produces:
  - `IDLE_STOP_S = 30`, `boardCue(matchId, board, segment)`, `startFrame(match, minute)`.
  - `Session` (`id`, `match`, `live`, `control`, `bus`, `playback`, `watchers`), `StartOptions` (`speed`, `fromMinute`, `live`), `Companion = (s: Session) => Effect<void>`.
  - `makeSessions(library, {companion?})` (scoped) → `{ library, start(match, options), get(id), watch(id, segment) -> Stream<Tick, SessionNotFound>, control(id, action, speed), stop(id), count() }`; the type `Sessions`.

- [ ] **Step 1: Write the failing tests**

Create `apps/api/test/session.test.ts`:

```ts
import { Effect, Exit, Fiber, Ref, Stream } from "effect"
import { TestClock } from "effect/testing"
import { beforeAll, describe, expect, it } from "vitest"
import type { Tick } from "@touchline/rpc"
import { readMatch, type LibraryMatch } from "../src/library.js"
import { IDLE_STOP_S, makeSessions, startFrame } from "../src/session.js"
import { league, makeLibrary, MATCH_ID, type TestLibrary } from "./fixture.js"

let lib: TestLibrary
let match: LibraryMatch
beforeAll(async () => {
  lib = await makeLibrary()
  match = readMatch(lib.run, league)
}, 120_000)

/**
 * Advance the test clock in small steps, letting real I/O (reading the run's files) happen in between: playback
 * fibers reach their sleeps only after their reads, so one big jump would leave them waiting forever.
 */
const advance = (seconds: number, stepMs = 50) =>
  Effect.gen(function* () {
    for (let t = 0; t < seconds * 1000; t += stepMs) {
      yield* Effect.promise(() => new Promise((r) => setImmediate(r)))
      yield* TestClock.adjust(`${stepMs} millis`)
    }
  })

/** Advance the clock (with real I/O in between) until the fiber is done, then join it; however slow the machine. */
const settle = <A, E>(f: Fiber.Fiber<A, E>, maxSeconds = 300) =>
  Effect.gen(function* () {
    for (let t = 0; t < maxSeconds * 1000 && !f.pollUnsafe(); t += 50) {
      yield* Effect.promise(() => new Promise((r) => setImmediate(r)))
      yield* TestClock.adjust("50 millis")
    }
    return yield* Fiber.join(f)
  })

const run = <A, E>(e: Effect.Effect<A, E, import("effect").Scope.Scope>) => Effect.runPromise(e.pipe(Effect.scoped, Effect.provide(TestClock.layer())))
const library = () => new Map([[MATCH_ID, match]])
const home = { mode: "casual", lang: "en", club: "northwick" } as const
const spanish = { mode: "analyst", lang: "es", club: null } as const

describe("sessions", () => {
  it("show two segments the same match time, each with its own variant of a moment", () =>
    run(
      Effect.gen(function* () {
        const sessions = yield* makeSessions(library())
        const goal = lib.goals[0]!
        const minute = Math.floor(goal.frame_id / 600) // a minute before the goal at the latest
        const s = yield* sessions.start(match, { speed: 64, fromMinute: minute, live: false })
        const take = (seg: typeof home | typeof spanish) => sessions.watch(s.id, seg).pipe(Stream.takeUntil((t) => t.kind === "cue" && t.cue.moment_id !== null), Stream.runCollect, Effect.forkChild)
        const a = yield* take(home)
        const b = yield* take(spanish)
        const ta: Tick[] = [...(yield* settle(a))]
        const tb: Tick[] = [...(yield* settle(b))]
        expect(ta[0]).toMatchObject({ kind: "playback", playback: { state: "playing", speed: 64, live: false } })
        const frameIds = (ts: Tick[]) => ts.flatMap((t) => (t.kind === "frame" ? [t.frame.frame] : []))
        expect(frameIds(ta)).toEqual(frameIds(tb))
        expect(frameIds(ta)[0]).toBe(startFrame(match, minute))
        const last = (ts: Tick[]) => ts.at(-1)!
        expect(last(ta)).toMatchObject({ kind: "cue", cue: { moment_id: `mo-${goal.id}`, segment: home } })
        expect(last(tb)).toMatchObject({ kind: "cue", cue: { moment_id: `mo-${goal.id}`, segment: spanish } })
        const board = ta.find((t) => t.kind === "cue" && t.cue.display.slot === "top_bar")!
        expect(board).toMatchObject({ kind: "cue", cue: { verified: true, text: null, segment: home } })
      })
    ), 120_000)

  it("pause and play the session for everyone", () =>
    run(
      Effect.gen(function* () {
        const sessions = yield* makeSessions(library())
        const s = yield* sessions.start(match, { speed: 1, fromMinute: 0, live: false })
        const w = yield* sessions.watch(s.id, home).pipe(Stream.runDrain, Effect.forkChild)
        yield* advance(10)
        const p = yield* sessions.control(s.id, "pause", null)
        expect(p.state).toBe("paused")
        yield* advance(1) // the frame already under way still lands; then nothing moves
        const at = (yield* Ref.get(s.playback)).frame
        expect(at).toBeGreaterThanOrEqual(90)
        yield* advance(60, 1000)
        expect((yield* Ref.get(s.playback)).frame).toBe(at)
        const q = yield* sessions.control(s.id, "speed", 8)
        expect(q).toMatchObject({ state: "paused", speed: 8 })
        yield* sessions.control(s.id, "play", null)
        yield* advance(1)
        expect((yield* Ref.get(s.playback)).frame).toBeGreaterThanOrEqual(at + 70)
        yield* Fiber.interrupt(w)
      })
    ), 120_000)

  it("stop a session nobody watches, and refuse unknown sessions", () =>
    run(
      Effect.gen(function* () {
        const sessions = yield* makeSessions(library())
        const s = yield* sessions.start(match, { speed: 1, fromMinute: 0, live: false })
        const w = yield* sessions.watch(s.id, home).pipe(Stream.take(3), Stream.runDrain, Effect.forkChild)
        yield* settle(w)
        expect(sessions.count()).toBe(1)
        yield* advance(IDLE_STOP_S + 1, 500)
        expect(sessions.count()).toBe(0)
        const lost = yield* Effect.exit(sessions.control(s.id, "pause", null))
        expect(Exit.isFailure(lost) && JSON.stringify(lost.cause)).toContain("SessionNotFound")
      })
    ), 120_000)

  it("start the second half from minute 45 and on", () => {
    const ht = startFrame(match, 45)
    expect(startFrame(match, 50) - ht).toBe(3000)
    expect(ht).toBeGreaterThan(startFrame(match, 44))
  })
})
```

- [ ] **Step 2: Run them to make sure they fail**

Run: `pnpm --filter @touchline/api test session`
Expected: the file fails to load: `Cannot find module '../src/session.js'`

- [ ] **Step 3: Write the sessions**

Create `apps/api/src/session.ts`:

```ts
/**
 * Sessions on the cue bus (spec §4 "cue bus", §5.7 startMatch / subscribeCues): a session plays one match at a speed
 * and publishes its timeline; every watcher gets the frames, a scoreboard cue and the agent cues for its own segment,
 * all in the same match time (so a split screen shows two segments of one moment together).
 */
import { randomUUID } from "node:crypto"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { Effect, Fiber, PubSub, Ref, Scope, Stream, SubscriptionRef } from "effect"
import { SessionNotFound, type Playback, type Tick } from "@touchline/rpc"
import type { Cue, Segment } from "@touchline/schema"
import { pickCues } from "./cues.js"
import type { LibraryMatch } from "./library.js"
import { beats, paced, type Beat, type Board, type Control } from "./playback.js"

/** A session nobody watches stops after this long. */
export const IDLE_STOP_S = 30

/** The cue the scoreboard sends each second (spec §5.4: stats cues share the contract, verified, without text). */
export const boardCue = (matchId: string, b: Board, segment: Segment): Cue => ({
  cue_id: `${matchId}-board-${b.frame}`,
  schema: "touchline.cue/1",
  match_id: matchId,
  moment_id: null,
  anchor: { frame_from: b.frame, frame_to: b.frame, clock: b.clock.slice(0, 5) },
  display: { slot: "top_bar", priority: 3, ttl_ms: 2000, template: "scoreboard" },
  segment,
  text: null,
  data: { "score.home": b.score.home, "score.away": b.score.away, ...(b.momentum ? { "team.mom.home": b.momentum.home, "team.mom.away": b.momentum.away } : {}) },
  evidence: [],
  verified: true
})

/** The frame a match starts from at a minute (minutes from 45 count in the second half, as in scenario scripts). */
export const startFrame = (m: LibraryMatch, minute: number): number => {
  const perMinute = 60 * m.info.fps
  if (minute < 45) return Math.round(minute * perMinute)
  for (const line of readFileSync(join(m.dir, "domain.jsonl"), "utf8").split("\n")) {
    if (!line.includes('"period_start"')) continue
    const e = JSON.parse(line) as { frame_id: number; attrs: { period?: string }; period: string }
    if (e.period === "second_half") return Math.min(m.info.frames, e.frame_id + Math.round((minute - 45) * perMinute))
  }
  return m.info.frames
}

export interface Session {
  readonly id: string
  readonly match: LibraryMatch
  readonly live: boolean
  readonly control: SubscriptionRef.SubscriptionRef<Control>
  readonly bus: PubSub.PubSub<Beat>
  readonly playback: Ref.Ref<Playback>
  readonly watchers: Ref.Ref<number>
}

export interface StartOptions {
  readonly speed: number
  readonly fromMinute: number
  readonly live: boolean
}

/** Runs alongside a live session's playback (Task 7: live agents); receives the session. */
export type Companion = (s: Session) => Effect.Effect<void>

/** The sessions of one API process. Their fibers live in `scope`. */
export const makeSessions = (library: ReadonlyMap<string, LibraryMatch>, options: { readonly companion?: Companion } = {}) =>
  Effect.gen(function* () {
    const scope = yield* Effect.scope
    const sessions = new Map<string, Session>()
    const fibers = new Map<string, Fiber.Fiber<unknown, unknown>>()

    const stop = (id: string) =>
      Effect.gen(function* () {
        const f = fibers.get(id)
        sessions.delete(id)
        fibers.delete(id)
        if (f) yield* Fiber.interrupt(f)
      })

    const start = (match: LibraryMatch, o: StartOptions) =>
      Effect.gen(function* () {
        const id = randomUUID()
        const from = startFrame(match, o.fromMinute)
        const control = yield* SubscriptionRef.make<Control>({ paused: false, speed: o.speed })
        const bus = yield* PubSub.unbounded<Beat>()
        const playback = yield* Ref.make<Playback>({ state: "playing", frame: from, speed: o.speed, live: o.live })
        const watchers = yield* Ref.make(0)
        const s: Session = { id, match, live: o.live, control, bus, playback, watchers }
        const play = paced(beats(match, from), control, match.info.fps).pipe(
          Stream.runForEach((b) =>
            Effect.gen(function* () {
              if (b.kind === "frame") yield* Ref.update(playback, (p) => ({ ...p, frame: b.frame.frame }))
              if (b.kind === "end") yield* Ref.update(playback, (p): Playback => ({ ...p, state: "ended", frame: b.frame }))
              yield* PubSub.publish(bus, b)
            })
          ),
          Effect.catch((e) => Effect.logError(`session ${id}: ${String(e)}`)),
          Effect.andThen(Effect.sleep("60 seconds")), // let late requests (evidence, recap) see the ended session
          Effect.ensuring(Effect.sync(() => sessions.delete(id)))
        )
        sessions.set(id, s)
        fibers.set(id, yield* Effect.forkIn(Effect.all([play, ...(o.live && options.companion ? [options.companion(s)] : [])], { concurrency: "unbounded", discard: true }), scope))
        return s
      })

    const get = (id: string) => Effect.fromNullishOr(sessions.get(id)).pipe(Effect.mapError(() => new SessionNotFound({ session_id: id })))

    const toTicks = (s: Session, segment: Segment) => (b: Beat): Tick[] => {
      switch (b.kind) {
        case "frame":
          return [{ kind: "frame", frame: b.frame }]
        case "board":
          return [{ kind: "cue", cue: boardCue(s.match.info.match_id, b.board, segment) }]
        case "cues":
          return pickCues(b.cues, segment).map((cue) => ({ kind: "cue" as const, cue }))
        case "signals":
          return []
        case "end":
          return [{ kind: "playback", playback: { state: "ended", frame: b.frame, speed: 0, live: s.live } }]
      }
    }

    /** The session's ticks for one segment, from now until the match ends; the session stops when nobody watches. */
    const watch = (id: string, segment: Segment) =>
      Stream.unwrap(
        Effect.gen(function* () {
          const s = yield* get(id)
          const now = yield* Ref.get(s.playback)
          yield* Ref.update(s.watchers, (n) => n + 1)
          const leave = Ref.updateAndGet(s.watchers, (n) => n - 1).pipe(
            Effect.flatMap((n) =>
              n > 0 ? Effect.void : Effect.forkIn(Effect.sleep(`${IDLE_STOP_S} seconds`).pipe(Effect.andThen(Ref.get(s.watchers)), Effect.flatMap((m) => (m === 0 ? stop(id) : Effect.void))), scope)
            ),
            Effect.asVoid
          )
          return Stream.make({ kind: "playback", playback: now } as Tick).pipe(
            Stream.concat(Stream.fromPubSub(s.bus).pipe(Stream.takeUntil((b) => b.kind === "end"), Stream.map(toTicks(s, segment)), Stream.flattenIterable)),
            Stream.ensuring(leave)
          )
        })
      )

    const control = (id: string, action: "play" | "pause" | "speed", speed: number | null) =>
      Effect.gen(function* () {
        const s = yield* get(id)
        yield* SubscriptionRef.update(s.control, (c) => ({ paused: action === "pause" ? true : action === "play" ? false : c.paused, speed: speed ?? c.speed }))
        const c = yield* SubscriptionRef.get(s.control)
        return yield* Ref.updateAndGet(s.playback, (p): Playback => (p.state === "ended" ? p : { ...p, state: c.paused ? "paused" : "playing", speed: c.speed }))
      })

    return { library, start, get, watch, control, stop, count: () => sessions.size } as const
  })

export type Sessions = Effect.Success<ReturnType<typeof makeSessions>>
```

Apply this change to `apps/api/src/index.ts` (from the repository root):

```bash
git apply <<'PATCH'
diff --git a/apps/api/src/index.ts b/apps/api/src/index.ts
index a2da5cf..16e7e99 100644
--- a/apps/api/src/index.ts
+++ b/apps/api/src/index.ts
@@ -1,3 +1,4 @@
 export * from "./cues.js"
 export * from "./library.js"
 export * from "./playback.js"
+export * from "./session.js"
PATCH
```

- [ ] **Step 4: Run the tests**

Run: `pnpm --filter @touchline/api test session && pnpm --filter @touchline/api typecheck`
Expected: 4 passed (two segments in the same match time with their own variants; pause, play, speed; the idle stop and an unknown session; second-half minutes), no type errors

- [ ] **Step 5: Commit**

```bash
git add apps/api
git commit -m "feat(api): sessions on the cue bus — one paced match per session, every watcher its own segment's cues in the same match time, scoreboard stats cues, pause/play/speed, idle sessions stop

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```



### Task 5: Evidence and recaps

The "Why?" drawer (spec §5.6) needs what is behind a cue. **`evidence(match, cue)`** returns:
- the moment, the Analyst's cause and explanation;
- each claim (Analyst's and Narrator's, deduplicated) with what it is (the metric's catalogue name, e.g. "Momentum") and who it is about;
- every metric claim's last five minutes, in 15-second steps, from the match's stats, replayed once per match with `loadRun`;
- the events the claims and the cue cite, with player names and qualifiers.

Edge cases:
- **A recap card** is explained by the recap's own claims.
- **A claim the stats cannot chart** (a subject not in the match) is listed but gets no history.
- **Scoreboard cues and unknown cues** have no evidence (`EvidenceNotFound`).

**`recap(match, kind, segment)`** gives the recap and its card for the segment, with the same fallbacks as moments.

**Files:**
- Create: `apps/api/src/evidence.ts`
- Modify: `apps/api/package.json` (`@touchline/mcp-stats`), `apps/api/src/index.ts`, `apps/api/test/fixture.ts` (the traces' drafts make no claims)
- Test: `apps/api/test/evidence.test.ts`

**Interfaces:**
- Consumes: `loadRun` (`@touchline/mcp-stats`), `METRICS`, `StatsError`, `StatsQuery.series`, `StatsQuery.eventsBetween` (`@touchline/stats`), `decodeMomentTrace`, `decodeRecap`, `pickCues`, `Evidence`, `RecapView`, `MatchNotFound`, `EvidenceNotFound`.
- Produces: `SERIES_S = 300`, `SERIES_STEP_S = 15`, `makeEvidence(library)` → `{ evidence(matchId, cueId) -> Effect<Evidence, MatchNotFound | EvidenceNotFound>, recap(matchId, kind, segment) -> Effect<RecapView, MatchNotFound> }`.

- [ ] **Step 1: Write the failing tests**

Create `apps/api/test/evidence.test.ts`:

```ts
import { Effect, Exit } from "effect"
import { beforeAll, describe, expect, it } from "vitest"
import { makeEvidence, SERIES_S, SERIES_STEP_S } from "../src/evidence.js"
import { readMatch } from "../src/library.js"
import { league, makeLibrary, MATCH_ID, type TestLibrary } from "./fixture.js"

let lib: TestLibrary
let ev: ReturnType<typeof makeEvidence>
beforeAll(async () => {
  lib = await makeLibrary()
  ev = makeEvidence(new Map([[MATCH_ID, readMatch(lib.run, league)]]))
}, 120_000)

describe("evidence", () => {
  it("explains a cue with its moment, named claims, the metric's last five minutes and the events", async () => {
    const goal = lib.goals[0]!
    const e = await Effect.runPromise(ev.evidence(MATCH_ID, `mo-${goal.id}-casual.en.neutral`))
    expect(e.moment?.moment_id).toBe(`mo-${goal.id}`)
    expect(e.cause).toBe("clear chance converted")
    const mom = e.claims.find((c) => c.metric_id === "team.mom")!
    expect(mom).toMatchObject({ label: "Momentum", quote: "60%", subject: goal.team_id })
    expect(mom.subject_name).toMatch(/\w/)
    const [s] = e.series
    expect(s).toMatchObject({ metric_id: "team.mom", subject: goal.team_id })
    expect(s!.points).toHaveLength(SERIES_S / SERIES_STEP_S + 1)
    expect(s!.points.at(-1)!.frame).toBe(goal.frame_id)
    expect(e.events.map((x) => x.id)).toEqual([goal.id])
    expect(e.events[0]!.player).toMatch(/\w+ \w+/)
    expect(e.model).toBe("stub")
  }, 60_000)

  it("explains a recap card from the recap's own claims", async () => {
    const e = await Effect.runPromise(ev.evidence(MATCH_ID, `${MATCH_ID}-recap-half_time-casual.en.neutral`))
    expect(e.moment).toBeNull()
    expect(e.claims.map((c) => c.kind)).toEqual(["score"])
  })

  it("has none for scoreboard cues, unknown cues or matches", async () => {
    for (const [m, c, tag] of [[MATCH_ID, `${MATCH_ID}-board-600`, "EvidenceNotFound"], [MATCH_ID, "nope", "EvidenceNotFound"], ["nope", "x", "MatchNotFound"]] as const) {
      const exit = await Effect.runPromise(Effect.exit(ev.evidence(m, c)))
      expect(Exit.isFailure(exit) && JSON.stringify(exit.cause)).toContain(tag)
    }
  })
})

it("skips a claim the stats cannot chart instead of failing", async () => {
  // A claim about a team that is not in the match (it would have failed its check) gets no series.
  const { writeFileSync, readFileSync } = await import("node:fs")
  const path = `${lib.run}/agents/traces.jsonl`
  const lines = readFileSync(path, "utf8").trim().split("\n").map((l) => JSON.parse(l))
  lines[0].analysis.claims.push({ ...lines[0].analysis.claims[0], subject: "nobody-fc" })
  writeFileSync(path, lines.map((l) => JSON.stringify(l)).join("\n") + "\n")
  const e = await Effect.runPromise(ev.evidence(MATCH_ID, `mo-${lib.goals[0]!.id}-casual.en.neutral`))
  expect(e.series.map((s) => s.subject)).toEqual([lib.goals[0]!.team_id])
  expect(e.claims.some((c) => c.subject === "nobody-fc")).toBe(true)
})

describe("recaps", () => {
  it("give the recap and its card for a segment, and nothing for a recap not made", async () => {
    const half = await Effect.runPromise(ev.recap(MATCH_ID, "half_time", { mode: "casual", lang: "es", club: null }))
    expect(half.recap?.kind).toBe("half_time")
    expect(half.cards.map((c) => c.segment.lang)).toEqual(["en"]) // the only variant made; English is the fallback
    expect(await Effect.runPromise(ev.recap(MATCH_ID, "full_time", { mode: "casual", lang: "en", club: null }))).toEqual({ recap: null, cards: [] })
  })
})
```

Apply this change to `apps/api/test/fixture.ts` (from the repository root):

```bash
git apply <<'PATCH'
diff --git a/apps/api/test/fixture.ts b/apps/api/test/fixture.ts
index 5178a0b..757a838 100644
--- a/apps/api/test/fixture.ts
+++ b/apps/api/test/fixture.ts
@@ -63,7 +63,7 @@ export const makeLibrary = async (): Promise<TestLibrary> => {
         { kind: "metric", sentence: 0, quote: "60%", metric_id: "team.mom", subject: g.team_id, value: 0.6, at_frame: g.frame_id, window_s: null, event_id: null, receiver_id: null },
         { kind: "event", sentence: 0, quote: "", metric_id: null, subject: g.player_id, value: null, at_frame: g.frame_id, window_s: null, event_id: g.id, receiver_id: null }
       ] },
-      draft: { ...trace0.draft, moment_id: momentId },
+      draft: { moment_id: momentId, lang: "en", sentences: ["Goal!", "A finish from close range."], claims: [] },
       verdicts: [{ ...trace0.verdicts[0]!, moment_id: momentId }],
       cue_ids: cues.filter((c) => c.moment_id === momentId).map((c) => c.cue_id)
     }))
PATCH
```

- [ ] **Step 2: Run them to make sure they fail**

Run: `pnpm --filter @touchline/api test evidence`
Expected: the file fails to load: `Cannot find module '../src/evidence.js'`

- [ ] **Step 3: Write the evidence and recaps**

Apply this change to `apps/api/package.json` (from the repository root):

```bash
git apply <<'PATCH'
diff --git a/apps/api/package.json b/apps/api/package.json
index 605585d..9b4e3bb 100644
--- a/apps/api/package.json
+++ b/apps/api/package.json
@@ -3,7 +3,9 @@
   "version": "0.1.0",
   "private": true,
   "type": "module",
-  "exports": { ".": "./src/index.ts" },
+  "exports": {
+    ".": "./src/index.ts"
+  },
   "scripts": {
     "test": "vitest run",
     "typecheck": "tsc --noEmit -p .",
@@ -12,6 +14,7 @@
   "dependencies": {
     "@effect/platform-node": "4.0.1",
     "@touchline/agent-gateway": "workspace:*",
+    "@touchline/mcp-stats": "workspace:*",
     "@touchline/rpc": "workspace:*",
     "@touchline/schema": "workspace:*",
     "@touchline/sim": "workspace:*",
PATCH
```

Run: `pnpm install`
Expected: `@touchline/mcp-stats` linked

Create `apps/api/src/evidence.ts`:

```ts
/**
 * What is behind a cue (spec §5.6 "Why?" drawer) and a match's recaps, from the run's agent traces and recaps and its
 * stats replayed once per match: each checked claim with what it is, the metric's last five minutes, and the events.
 */
import { existsSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { Effect } from "effect"
import { loadRun } from "@touchline/mcp-stats"
import { EvidenceNotFound, MatchNotFound, type Evidence, type EvidenceClaim, type RecapView, type Series } from "@touchline/rpc"
import { decodeMomentTrace, decodeRecap, type Claim, type MomentTrace, type Recap, type Segment } from "@touchline/schema"
import { METRICS, modelsFromJson, StatsError, xtGridFromJson, type Roster, type StatsQuery } from "@touchline/stats"
import { pickCues } from "./cues.js"
import type { LibraryMatch } from "./library.js"
import { root } from "./playback.js"

export const SERIES_S = 300 // the metric's last five minutes
export const SERIES_STEP_S = 15

const jsonl = <A>(path: string, decode: (u: unknown) => A): A[] =>
  existsSync(path) ? readFileSync(path, "utf8").split("\n").filter((l) => l.trim()).map((l) => decode(JSON.parse(l))) : []

const label = (c: Claim): string => {
  if (c.kind === "metric" && c.metric_id) return METRICS.find((m) => m.id === c.metric_id)?.name ?? c.metric_id
  return { score: "Score", minute: "Minute", event: "Event", better_option: "Better option", metric: "Metric" }[c.kind]
}

export const makeEvidence = (library: ReadonlyMap<string, LibraryMatch>) => {
  const queries = new Map<string, Promise<StatsQuery>>()
  const params = (f: string) => JSON.parse(readFileSync(join(root, "data/params", f), "utf8"))
  const roster = JSON.parse(readFileSync(join(root, "data/league/league.json"), "utf8")) as Roster

  const match = (id: string) => Effect.fromNullishOr(library.get(id)).pipe(Effect.mapError(() => new MatchNotFound({ match_id: id })))

  /** The match's stats as of its last frame (built once, on first use: a few seconds). */
  const query = (m: LibraryMatch) =>
    Effect.promise(() => {
      let q = queries.get(m.info.match_id)
      if (!q) {
        q = Effect.runPromise(loadRun(m.dir, modelsFromJson(params("stats-models.json")), { roster, xt: xtGridFromJson(params("xt-grid.json")) }))
        queries.set(m.info.match_id, q)
      }
      return q
    })

  const names = (m: LibraryMatch) => new Map<string, string>([[m.info.home.id, m.info.home.name], [m.info.away.id, m.info.away.name], ...m.info.players.map((p) => [p.id, p.name] as const)])

  const evidence = (matchId: string, cueId: string) =>
    Effect.gen(function* () {
      const m = yield* match(matchId)
      const cue = m.cues.find((c) => c.cue_id === cueId)
      if (!cue || !cue.moment_id) return yield* new EvidenceNotFound({ cue_id: cueId })
      const traces = jsonl<MomentTrace>(join(m.dir, "agents", "traces.jsonl"), decodeMomentTrace)
      const recaps = jsonl<Recap>(join(m.dir, "agents", "recaps.jsonl"), decodeRecap)
      const trace = traces.find((t) => t.moment.moment_id === cue.moment_id) ?? null
      const recap = recaps.find((r) => r.recap_id === cue.moment_id) ?? null
      if (!trace && !recap) return yield* new EvidenceNotFound({ cue_id: cueId })
      const raw = trace ? [...trace.analysis.claims, ...trace.draft.claims] : recap!.claims
      const seen = new Set<string>()
      const claims = raw.filter((c) => {
        const k = JSON.stringify([c.kind, c.metric_id, c.subject, c.event_id, c.receiver_id, c.value])
        return !seen.has(k) && (seen.add(k), true)
      })
      const who = names(m)
      const q = yield* query(m)
      const at = trace ? trace.moment.frame_to : recap!.at_frame
      const series: Series[] = []
      for (const c of claims) {
        if (c.kind !== "metric" || !c.metric_id || !c.subject || series.some((s) => s.metric_id === c.metric_id && s.subject === c.subject)) continue
        let points: Array<{ frame: number; value: number | null }>
        try {
          points = q.series(c.metric_id, c.subject, Math.max(0, at - SERIES_S * m.info.fps), at, SERIES_STEP_S).map((p) => ({ frame: p.frame, value: p.value }))
        } catch (e) {
          if (e instanceof StatsError) continue // a claim the stats cannot chart (it failed its check, or names no subject)
          throw e
        }
        if (points.length > 1) series.push({ metric_id: c.metric_id, subject: c.subject, label: `${label(c)} — ${who.get(c.subject) ?? c.subject}`, points })
      }
      const ids = [...new Set([...claims.flatMap((c) => (c.event_id ? [c.event_id] : [])), ...cue.evidence.filter((e) => !e.includes("@"))])]
      const events = q.eventsBetween(null, at, { ids }).map((e) => ({
        id: e.id, type: e.type, clock: e.match_clock, team_id: e.team_id, player: e.player_id ? (who.get(e.player_id) ?? e.player_id) : null, outcome: e.outcome, qualifiers: { ...e.qualifiers }
      }))
      const out: Evidence = {
        cue_id: cueId,
        moment: trace?.moment ?? null,
        cause: trace?.analysis.cause ?? null,
        explanation: trace?.analysis.explanation ?? null,
        claims: claims.map((c): EvidenceClaim => ({
          kind: c.kind, quote: c.quote, label: label(c), metric_id: c.metric_id, subject: c.subject, subject_name: c.subject ? (who.get(c.subject) ?? null) : null,
          value: c.value, at_frame: c.at_frame, event_id: c.event_id
        })),
        series,
        events,
        model: trace?.model ?? m.info.model
      }
      return out
    })

  const recap = (matchId: string, kind: "half_time" | "full_time", segment: Segment) =>
    Effect.gen(function* () {
      const m = yield* match(matchId)
      const r = jsonl<Recap>(join(m.dir, "agents", "recaps.jsonl"), decodeRecap).find((x) => x.kind === kind) ?? null
      const view: RecapView = { recap: r, cards: r ? pickCues(m.cues.filter((c) => c.moment_id === r.recap_id), segment) : [] }
      return view
    })

  return { evidence, recap } as const
}
```

Apply this change to `apps/api/src/index.ts` (from the repository root):

```bash
git apply <<'PATCH'
diff --git a/apps/api/src/index.ts b/apps/api/src/index.ts
index 16e7e99..b8fafb6 100644
--- a/apps/api/src/index.ts
+++ b/apps/api/src/index.ts
@@ -2,3 +2,4 @@ export * from "./cues.js"
 export * from "./library.js"
 export * from "./playback.js"
 export * from "./session.js"
+export * from "./evidence.js"
PATCH
```

- [ ] **Step 4: Run the tests**

Run: `pnpm --filter @touchline/api test evidence`
Expected: 5 passed: a goal's cue with its named claims, a 21-point history ending on the goal's frame and the goal event; a recap card from its claims; none for scoreboard or unknown cues; a claim the stats cannot chart skipped; the half-time card in English for a Spanish casual viewer

- [ ] **Step 5: Commit**

```bash
git add apps/api pnpm-lock.yaml
git commit -m "feat(api): evidence behind a cue (moment, cause, named claims, five-minute metric history, events) and recaps with their cards per segment

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```



### Task 6: RPC server over WebSocket

The handlers implement `TouchlineRpcs` over the library, the sessions and the evidence. `ListMatches` sends summaries without the player lists.
- **Transport:** they are served at `/rpc` over WebSocket, so one connection carries every call and stream, with JSON serialization.
- **Health:** `GET /health` answers `{ok, matches}`, for container probes in Plan 6.
- **Command:** `pnpm api --library DIR --port 8787` scans the library and serves it.
- **Test:** an end-to-end run with the Effect RPC client over a real socket. It lists the library, refuses an unknown match, plays a session to a goal, gets its evidence and recap, pauses it, and refuses an unknown session.

**Files:**
- Create: `apps/api/src/server.ts`, `apps/api/src/main.ts`
- Modify: `apps/api/src/index.ts`, `package.json` (root script `api`)
- Test: `apps/api/test/server.test.ts`

**Interfaces:**
- Consumes: `makeSessions` (Task 4), `makeEvidence` (Task 5), `scanLibrary` (Task 2), `TouchlineRpcs` (Task 1), `NodeHttpServer`, `NodeRuntime`, `NodeSocket` (`@effect/platform-node`), `RpcServer.layerHttp`, `RpcClient`, `RpcSerialization.layerJson`, `HttpRouter`.
- Produces: `RPC_PATH = "/rpc"`, `ApiOptions` (`library`, `companion?`), `handlersLayer(o)`, `routesLayer(o)`, `serverLayer(o & {port, host?})`; command `pnpm api [--library DIR] [--port 8787] [--host 127.0.0.1]`.

- [ ] **Step 1: Write the failing test**

Create `apps/api/test/server.test.ts`:

```ts
import { createServer } from "node:net"
import { NodeSocket } from "@effect/platform-node"
import { Effect, Exit, Layer, Stream } from "effect"
import { RpcClient, RpcSerialization } from "effect/rpc"
import type { RpcClientError } from "effect/rpc/RpcClientError"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { TouchlineRpcs, type Tick } from "@touchline/rpc"
import { readMatch } from "../src/library.js"
import { RPC_PATH, serverLayer } from "../src/server.js"
import { league, makeLibrary, MATCH_ID, type TestLibrary } from "./fixture.js"

const freePort = () => new Promise<number>((ok) => {
  const s = createServer().listen(0, "127.0.0.1", () => {
    const port = (s.address() as { port: number }).port
    s.close(() => ok(port))
  })
})

let lib: TestLibrary
let port: number
let stop: () => Promise<void>
beforeAll(async () => {
  lib = await makeLibrary()
  port = await freePort()
  const fiber = Effect.runFork(Layer.launch(serverLayer({ library: new Map([[MATCH_ID, readMatch(lib.run, league)]]), port })))
  stop = async () => {
    fiber.interruptUnsafe()
  }
  for (let i = 0; i < 100 && !(await fetch(`http://127.0.0.1:${port}/health`).then((r) => r.ok, () => false)); i++) await new Promise((r) => setTimeout(r, 50))
}, 120_000)
afterAll(() => stop?.())

const client = <A, E>(f: (c: RpcClient.FromGroup<typeof TouchlineRpcs, RpcClientError>) => Effect.Effect<A, E>) =>
  Effect.runPromise(
    Effect.gen(function* () {
      const c = yield* RpcClient.make(TouchlineRpcs)
      return yield* f(c)
    }).pipe(
      Effect.scoped,
      Effect.provide(RpcClient.layerProtocolSocket().pipe(Layer.provide(NodeSocket.layerWebSocket(`ws://127.0.0.1:${port}${RPC_PATH}`)), Layer.provide(RpcSerialization.layerJson)))
    )
  )

describe("API over WebSocket", () => {
  it("answers health checks", async () => {
    expect(await (await fetch(`http://127.0.0.1:${port}/health`)).json()).toEqual({ ok: true, matches: 1 })
  })

  it("lists the library and refuses unknown matches", async () => {
    const list = await client((c) => c.ListMatches())
    expect(list.map((m) => m.match_id)).toEqual([MATCH_ID])
    expect("players" in list[0]!).toBe(false)
    const lost = await client((c) => Effect.exit(c.GetMatch({ match_id: "nope" })))
    expect(Exit.isFailure(lost) && JSON.stringify(lost.cause)).toContain("MatchNotFound")
  })

  it("plays a session to a moment, then explains its cue and pauses it", async () => {
    const goal = lib.goals[0]!
    const ticks = await client((c) =>
      Effect.gen(function* () {
        const s = yield* c.StartSession({ match_id: MATCH_ID, speed: 64, from_minute: Math.floor(goal.frame_id / 600), live: false })
        expect(s.match.players.length).toBeGreaterThan(30)
        const got = yield* c.Watch({ session_id: s.session_id, segment: { mode: "casual", lang: "en", club: "northwick" } }).pipe(
          Stream.takeUntil((t: Tick) => t.kind === "cue" && t.cue.moment_id !== null),
          Stream.runCollect
        )
        const p = yield* c.Control({ session_id: s.session_id, action: "pause", speed: null })
        expect(p.state).toBe("paused")
        return [...got]
      })
    )
    expect(ticks[0]!.kind).toBe("playback")
    expect(ticks.filter((t) => t.kind === "frame").length).toBeGreaterThan(100)
    const last = ticks.at(-1)!
    expect(last.kind === "cue" && last.cue.cue_id).toBe(`mo-${goal.id}-casual.en.northwick`)
    const ev = await client((c) => c.GetEvidence({ match_id: MATCH_ID, cue_id: `mo-${goal.id}-casual.en.northwick` }))
    expect(ev.cause).toBe("clear chance converted")
    const recap = await client((c) => c.GetRecap({ match_id: MATCH_ID, kind: "half_time", segment: { mode: "casual", lang: "en", club: null } }))
    expect(recap.cards).toHaveLength(1)
  }, 120_000)

  it("refuses to watch an unknown session", async () => {
    const lost = await client((c) => Effect.exit(Stream.runDrain(c.Watch({ session_id: "nope", segment: { mode: "casual", lang: "en", club: null } }))))
    expect(Exit.isFailure(lost) && JSON.stringify(lost.cause)).toContain("SessionNotFound")
  })
})
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `pnpm --filter @touchline/api test server`
Expected: the file fails to load: `Cannot find module '../src/server.js'`

- [ ] **Step 3: Write the server and the command**

Create `apps/api/src/server.ts`:

```ts
/**
 * The API (spec §5.7): the RPC group over WebSocket at /rpc (one connection carries every call and stream), plus
 * GET /health. Handlers read the match library, run sessions on the cue bus and answer evidence and recaps.
 */
import { createServer } from "node:http"
import { NodeHttpServer } from "@effect/platform-node"
import { Effect, Layer } from "effect"
import { HttpRouter, HttpServerResponse } from "effect/http"
import { RpcSerialization, RpcServer } from "effect/rpc"
import { MatchNotFound, TouchlineRpcs, type MatchSummary } from "@touchline/rpc"
import { makeEvidence } from "./evidence.js"
import type { LibraryMatch } from "./library.js"
import { makeSessions, type Companion } from "./session.js"

export const RPC_PATH = "/rpc"

export interface ApiOptions {
  readonly library: ReadonlyMap<string, LibraryMatch>
  /** Runs alongside live sessions (the live agents, Task 7). */
  readonly companion?: Companion
}

const summary = ({ players: _, ...s }: LibraryMatch["info"]): MatchSummary => s

/** The RPC handlers over a library. */
export const handlersLayer = (o: ApiOptions) =>
  Layer.unwrap(
    Effect.gen(function* () {
      const sessions = yield* makeSessions(o.library, o.companion ? { companion: o.companion } : {})
      const ev = makeEvidence(o.library)
      const match = (id: string) => Effect.fromNullishOr(o.library.get(id)).pipe(Effect.mapError(() => new MatchNotFound({ match_id: id })))
      return TouchlineRpcs.toLayer({
        ListMatches: () => Effect.succeed([...o.library.values()].map((m) => summary(m.info))),
        GetMatch: ({ match_id }) => match(match_id).pipe(Effect.map((m) => m.info)),
        StartSession: ({ match_id, speed, from_minute, live }) =>
          match(match_id).pipe(
            Effect.flatMap((m) => sessions.start(m, { speed, fromMinute: from_minute, live })),
            Effect.map((s) => ({ session_id: s.id, match: s.match.info }))
          ),
        Watch: ({ session_id, segment }) => sessions.watch(session_id, segment),
        Control: ({ session_id, action, speed }) => sessions.control(session_id, action, speed),
        GetEvidence: ({ match_id, cue_id }) => ev.evidence(match_id, cue_id),
        GetRecap: ({ match_id, kind, segment }) => ev.recap(match_id, kind, segment)
      })
    })
  )

/** The routes: RPC over WebSocket and a health check (for container probes, Plan 6). */
export const routesLayer = (o: ApiOptions) =>
  Layer.mergeAll(
    RpcServer.layerHttp({ group: TouchlineRpcs, path: RPC_PATH, protocol: "websocket" }).pipe(Layer.provide(handlersLayer(o)), Layer.provide(RpcSerialization.layerJson)),
    HttpRouter.add("GET", "/health", HttpServerResponse.json({ ok: true, matches: o.library.size }))
  )

/** The API served on a port (0: any free port). */
export const serverLayer = (o: ApiOptions & { readonly port: number; readonly host?: string }) =>
  HttpRouter.serve(routesLayer(o)).pipe(Layer.provide(NodeHttpServer.layer(createServer, { port: o.port, host: o.host ?? "127.0.0.1" })))
```

Create `apps/api/src/main.ts`:

```ts
import { readFileSync } from "node:fs"
import { join, resolve } from "node:path"
import { NodeRuntime } from "@effect/platform-node"
import { Effect, Layer } from "effect"
import type { League } from "@touchline/league"
import { cliOptions, integer } from "@touchline/sim"
import { scanLibrary } from "./library.js"
import { root } from "./playback.js"
import { serverLayer } from "./server.js"

// pnpm runs package scripts from the package folder; INIT_CWD is where the user typed the command.
const here = (p: string) => resolve(process.env.INIT_CWD ?? process.cwd(), p)

const o = cliOptions("touchline-api: the match library, playback sessions and agent cues over RPC (WebSocket at /rpc)", {
  library: { default: join(root, "out/library"), help: "folder of run folders (pnpm library fills it)" },
  port: { default: "8787", check: integer(0, 65535), help: "port to listen on" },
  host: { default: "127.0.0.1", help: "address to listen on" }
})

const league = JSON.parse(readFileSync(join(root, "data/league/league.json"), "utf8")) as League
const library = scanLibrary(here(o.library), league)
console.error(`touchline-api: ${library.size} matches in ${here(o.library)}`)
Layer.launch(serverLayer({ library, port: Number(o.port), host: o.host })).pipe(NodeRuntime.runMain)
```

Apply this change to `apps/api/src/index.ts`, `package.json` (from the repository root):

```bash
git apply <<'PATCH'
diff --git a/apps/api/src/index.ts b/apps/api/src/index.ts
index b8fafb6..c73c76e 100644
--- a/apps/api/src/index.ts
+++ b/apps/api/src/index.ts
@@ -3,3 +3,4 @@ export * from "./library.js"
 export * from "./playback.js"
 export * from "./session.js"
 export * from "./evidence.js"
+export * from "./server.js"
diff --git a/package.json b/package.json
index 15e3690..57ab27a 100644
--- a/package.json
+++ b/package.json
@@ -13,7 +13,8 @@
     "realism": "pnpm --filter @touchline/calibrate run realism",
     "stats": "pnpm --filter @touchline/stats run stats",
     "mcp-stats": "pnpm --filter @touchline/mcp-stats run serve",
-    "agents": "pnpm --filter @touchline/agent-gateway run agents"
+    "agents": "pnpm --filter @touchline/agent-gateway run agents",
+    "api": "pnpm --filter @touchline/api run serve"
   },
   "devDependencies": {
     "@types/node": "22.20.5",
PATCH
```

- [ ] **Step 4: Run the tests**

Run: `pnpm --filter @touchline/api test && pnpm --filter @touchline/api typecheck`
Expected: 22 passed, no type errors

Run: `pnpm -s api --port 8791 & sleep 6; curl -s http://127.0.0.1:8791/health; kill %1`
Expected: `{"ok":true,"matches":0}` (an empty library until Task 8 fills it)

- [ ] **Step 5: Commit**

```bash
git add apps/api package.json
git commit -m "feat(api): RPC server over WebSocket (/rpc) with health check and pnpm api

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```



### Task 7: Live toggle: agents as the match plays

A live session (spec §6, the "live" toggle) plays without the cue cache and runs the agents alongside the match:
- **Signals:** as play passes the end of each 15-second batch of match time, its signals go to the agent service. It writes cues for the segments being watched (or casual English neutral when nobody has watched yet).
- **Recaps:** a half-time recap request when the second half starts, a full-time one at the end.
- **Cues:** each request runs through the gateway's `exchange` (contract validation, the `--budget-ms` limit, late and unverified cues dropped), and the cues arrive on the bus as they are written.
- **Merging:** batches that pile up while a request is under way merge into one request, so a slow model falls behind by one request, not by a queue.
- **Stats server:** each session starts its own MCP stats server for the agents and stops it at the end.
- **Command:** `pnpm api` takes `--agents URL` and `--budget-ms` (default 4000).

Sessions now record the segments they are watched in.

**Files:**
- Create: `apps/api/src/live.ts`
- Modify: `apps/api/src/session.ts` (watched segments; live sessions without cached cues), `apps/api/src/main.ts`, `apps/api/src/index.ts`
- Test: `apps/api/test/live.test.ts`

**Interfaces:**
- Consumes: `exchange`, `received`, `a2aSender`, `startMcpStats`, `Sender`, `McpServer` (`@touchline/agent-gateway`), `Session`, `Companion` (Task 4), `Beat` (Task 3).
- Produces: `LiveOptions` (`agentsUrl`, `budgetMs`, `batchS?`, `send?`, `mcp?`), `coalesce(jobs)`, `liveAgents(options) -> Companion`; `Session.segments`; `pnpm api --agents URL --budget-ms N`.

- [ ] **Step 1: Write the failing tests**

Create `apps/api/test/live.test.ts`:

```ts
import { Effect, Fiber, Stream } from "effect"
import { TestClock } from "effect/testing"
import { beforeAll, describe, expect, it } from "vitest"
import type { Artifact, Sender } from "@touchline/agent-gateway"
import type { Tick } from "@touchline/rpc"
import type { AgentRequest, Cue } from "@touchline/schema"
import { readMatch, type LibraryMatch } from "../src/library.js"
import { coalesce, liveAgents } from "../src/live.js"
import { makeSessions } from "../src/session.js"
import { league, makeLibrary, MATCH_ID, type TestLibrary } from "./fixture.js"

let lib: TestLibrary
let match: LibraryMatch
beforeAll(async () => {
  lib = await makeLibrary()
  match = readMatch(lib.run, league)
}, 120_000)

const advance = (seconds: number, stepMs = 50) =>
  Effect.gen(function* () {
    for (let t = 0; t < seconds * 1000; t += stepMs) {
      yield* Effect.promise(() => new Promise((r) => setImmediate(r)))
      yield* TestClock.adjust(`${stepMs} millis`)
    }
  })

/** A fake agent service: a cue per requested segment for every batch with a goal in it. */
const fakeAgents = () => {
  const requests: AgentRequest[] = []
  const base = lib.cues[0]!
  const send: Sender = async function* (req) {
    requests.push(req)
    if (req.kind !== "signals") return
    for (const g of req.signals.filter((s) => s.type === "goal")) {
      for (const seg of req.segments) {
        const cue: Cue = { ...base, cue_id: `live-${g.id}-${seg.mode}.${seg.lang}.${seg.club ?? "neutral"}`, moment_id: `live-${g.id}`, segment: seg, anchor: { frame_from: g.frame_from, frame_to: g.frame_to, clock: g.match_clock.slice(0, 5) } }
        yield { name: "cue", data: cue } satisfies Artifact
      }
    }
  }
  return { send, requests }
}

const run = <A, E>(e: Effect.Effect<A, E, import("effect").Scope.Scope>) => Effect.runPromise(e.pipe(Effect.scoped, Effect.provide(TestClock.layer())))
const fakeMcp = async () => ({ url: "http://127.0.0.1:1/mcp", stop: () => {} })
const home = { mode: "casual", lang: "en", club: "northwick" } as const

describe("live agents", () => {
  it("send the match's signals as play reaches them and show the cues that come back, for the watched segment", () =>
    run(
      Effect.gen(function* () {
        const agents = fakeAgents()
        const sessions = yield* makeSessions(new Map([[MATCH_ID, match]]), { companion: liveAgents({ agentsUrl: "", budgetMs: 0, send: agents.send, mcp: fakeMcp }) })
        const goal = lib.goals[0]!
        const s = yield* sessions.start(match, { speed: 64, fromMinute: Math.floor(goal.frame_id / 600), live: true })
        const w = yield* sessions.watch(s.id, home).pipe(Stream.takeUntil((t: Tick) => t.kind === "cue" && t.cue.moment_id !== null), Stream.runCollect, Effect.forkChild)
        yield* advance(120)
        const ticks = [...(yield* Fiber.join(w))]
        const last = ticks.at(-1)!
        expect(last.kind === "cue" && last.cue.moment_id).toMatch(/^live-.*-goal-/)
        expect(last.kind === "cue" && [last.cue.anchor.frame_to, last.cue.segment]).toEqual([goal.frame_id, home])
        expect(ticks.some((t) => t.kind === "cue" && t.cue.cue_id.startsWith(`mo-`))).toBe(false) // no cached cues in a live session
        const signals = agents.requests.filter((r) => r.kind === "signals")
        expect(signals[0]!.segments).toEqual([home])
        expect(signals.every((r) => r.kind === "signals" && r.signals.every((x) => x.frame_id <= r.now_frame))).toBe(true)
      })
    ), 120_000)

  it("ask for the half-time recap when the second half starts", () =>
    run(
      Effect.gen(function* () {
        const agents = fakeAgents()
        const sessions = yield* makeSessions(new Map([[MATCH_ID, match]]), { companion: liveAgents({ agentsUrl: "", budgetMs: 0, send: agents.send, mcp: fakeMcp }) })
        const s = yield* sessions.start(match, { speed: 64, fromMinute: 44, live: true })
        const w = yield* sessions.watch(s.id, home).pipe(Stream.takeUntil((t: Tick) => t.kind === "frame" && t.frame.period === "second_half" && t.frame.frame % 600 === 300), Stream.runDrain, Effect.forkChild)
        yield* advance(60)
        yield* Fiber.join(w)
        yield* advance(1)
        expect(agents.requests.filter((r) => r.kind === "recap").map((r) => r.kind === "recap" && r.recap)).toEqual(["half_time"])
      })
    ), 120_000)
})

describe("batches", () => {
  it("merge while a request is under way; recaps keep their place", () => {
    const sig = (f: number) => ({ id: `s${f}`, frame_id: f }) as never
    const jobs = coalesce([
      { kind: "signals", signals: [sig(1)], frame: 10 },
      { kind: "signals", signals: [sig(2)], frame: 20 },
      { kind: "recap", recap: "half_time", frame: 25 },
      { kind: "signals", signals: [sig(3)], frame: 30 },
      { kind: "stop" }
    ])
    expect(jobs.map((j) => j.kind)).toEqual(["signals", "recap", "signals", "stop"])
    expect(jobs[0]).toMatchObject({ frame: 20, signals: [{ id: "s1" }, { id: "s2" }] })
  })
})
```

- [ ] **Step 2: Run them to make sure they fail**

Run: `pnpm --filter @touchline/api test live`
Expected: the file fails to load: `Cannot find module '../src/live.js'`

- [ ] **Step 3: Record watched segments, and keep cached cues out of live sessions**

Apply this change to `apps/api/src/session.ts` (from the repository root):

```bash
git apply <<'PATCH'
diff --git a/apps/api/src/session.ts b/apps/api/src/session.ts
index 2cac3ca..2afdfce 100644
--- a/apps/api/src/session.ts
+++ b/apps/api/src/session.ts
@@ -8,7 +8,7 @@ import { readFileSync } from "node:fs"
 import { join } from "node:path"
 import { Effect, Fiber, PubSub, Ref, Scope, Stream, SubscriptionRef } from "effect"
 import { SessionNotFound, type Playback, type Tick } from "@touchline/rpc"
-import type { Cue, Segment } from "@touchline/schema"
+import { segmentKey, type Cue, type Segment } from "@touchline/schema"
 import { pickCues } from "./cues.js"
 import type { LibraryMatch } from "./library.js"
 import { beats, paced, type Beat, type Board, type Control } from "./playback.js"
@@ -51,6 +51,8 @@ export interface Session {
   readonly bus: PubSub.PubSub<Beat>
   readonly playback: Ref.Ref<Playback>
   readonly watchers: Ref.Ref<number>
+  /** The segments watched so far (live agents write cues for these). */
+  readonly segments: Ref.Ref<ReadonlyMap<string, Segment>>
 }
 
 export interface StartOptions {
@@ -85,8 +87,11 @@ export const makeSessions = (library: ReadonlyMap<string, LibraryMatch>, options
         const bus = yield* PubSub.unbounded<Beat>()
         const playback = yield* Ref.make<Playback>({ state: "playing", frame: from, speed: o.speed, live: o.live })
         const watchers = yield* Ref.make(0)
-        const s: Session = { id, match, live: o.live, control, bus, playback, watchers }
-        const play = paced(beats(match, from), control, match.info.fps).pipe(
+        const segments = yield* Ref.make<ReadonlyMap<string, Segment>>(new Map())
+        const s: Session = { id, match, live: o.live, control, bus, playback, watchers, segments }
+        // A live session shows the agents' cues as they are written, never the cache's.
+        const timeline = beats(o.live ? { ...match, cues: [] } : match, from)
+        const play = paced(timeline, control, match.info.fps).pipe(
           Stream.runForEach((b) =>
             Effect.gen(function* () {
               if (b.kind === "frame") yield* Ref.update(playback, (p) => ({ ...p, frame: b.frame.frame }))
@@ -127,6 +132,7 @@ export const makeSessions = (library: ReadonlyMap<string, LibraryMatch>, options
           const s = yield* get(id)
           const now = yield* Ref.get(s.playback)
           yield* Ref.update(s.watchers, (n) => n + 1)
+          yield* Ref.update(s.segments, (m) => new Map([...m, [segmentKey(segment), segment]]))
           const leave = Ref.updateAndGet(s.watchers, (n) => n - 1).pipe(
             Effect.flatMap((n) =>
               n > 0 ? Effect.void : Effect.forkIn(Effect.sleep(`${IDLE_STOP_S} seconds`).pipe(Effect.andThen(Ref.get(s.watchers)), Effect.flatMap((m) => (m === 0 ? stop(id) : Effect.void))), scope)
PATCH
```

- [ ] **Step 4: Write the live agents**

Create `apps/api/src/live.ts`:

```ts
/**
 * Live agents for a session (the live toggle, spec §6): as the match plays, the stats engine's signals go to the agent
 * service in batches of `batchS` seconds of match time, for the segments being watched, and recaps are asked for at
 * the whistles; the cues come back onto the session's bus as they arrive. A batch that would queue behind a slow one
 * is merged into the next, so slow models fall behind by at most one batch, never more.
 */
import { Effect, PubSub, Queue, Ref } from "effect"
import { a2aSender, exchange, received, startMcpStats, type McpServer, type Sender } from "@touchline/agent-gateway"
import type { AgentRequest, Cue, Segment, Signal } from "@touchline/schema"
import type { Beat } from "./playback.js"
import type { Companion, Session } from "./session.js"

export interface LiveOptions {
  readonly agentsUrl: string
  /** Wall-clock milliseconds a request may take (0: no limit). */
  readonly budgetMs: number
  readonly batchS?: number
  /** For tests: the A2A sender and the MCP stats server launcher. */
  readonly send?: Sender
  readonly mcp?: (dir: string) => Promise<McpServer>
}

const DEFAULT_SEGMENT: Segment = { mode: "casual", lang: "en", club: null }

type Job =
  | { readonly kind: "signals"; readonly signals: Signal[]; readonly frame: number }
  | { readonly kind: "recap"; readonly recap: "half_time" | "full_time"; readonly frame: number }
  | { readonly kind: "stop" }

/** Merge waiting signal batches into one (a recap stays its own request, after the signals before it). */
export const coalesce = (jobs: ReadonlyArray<Job>): Job[] => {
  // Signals batches next to each other become one; a recap or the stop keeps its place.
  const out: Job[] = []
  for (const j of jobs) {
    const prev = out.at(-1)
    if (j.kind === "signals" && prev?.kind === "signals") out[out.length - 1] = { kind: "signals", signals: [...prev.signals, ...j.signals], frame: j.frame }
    else out.push(j)
  }
  return out
}

export const liveAgents = (o: LiveOptions): Companion => (s: Session) =>
  Effect.gen(function* () {
    const send = o.send ?? a2aSender(o.agentsUrl)
    const mcp = yield* Effect.acquireRelease(Effect.promise(() => (o.mcp ?? startMcpStats)(s.match.dir)), (m) => Effect.sync(() => m.stop()))
    const width = Math.round((o.batchS ?? 15) * s.match.info.fps)
    const jobs = yield* Queue.unbounded<Job>()
    const sub = yield* PubSub.subscribe(s.bus)

    const segments = Effect.map(Ref.get(s.segments), (m) => (m.size ? [...m.values()].slice(0, 12) : [DEFAULT_SEGMENT]))
    const publish = (frame: number, cues: ReadonlyArray<Cue>) => {
      const by = new Map<string, Cue[]>()
      for (const c of cues) if (c.moment_id) by.set(c.moment_id, [...(by.get(c.moment_id) ?? []), c])
      return Effect.forEach([...by.values()], (group) => PubSub.publish(s.bus, { kind: "cues", frame, cues: group } as Beat), { discard: true })
    }

    // Worker: one request at a time; whatever piled up meanwhile is merged. Stops after the full-time recap.
    const worker = Effect.gen(function* () {
      while (true) {
        for (const job of coalesce(yield* Queue.takeAll(jobs))) {
          if (job.kind === "stop") return
          const base = { match_id: s.match.info.match_id, mcp_url: mcp.url, segments: yield* segments }
          const req: AgentRequest = job.kind === "signals" ? { kind: "signals", ...base, now_frame: job.frame, signals: job.signals } : { kind: "recap", ...base, recap: job.recap, at_frame: job.frame }
          const got = received()
          yield* Effect.exit(exchange(send, req, o.budgetMs, got)) // a failed or late request still publishes what arrived in time
          const now = (yield* Ref.get(s.playback)).frame
          yield* publish(now, got.cues)
        }
      }
    })

    // Feeder: cut the signals into batches as play passes each batch's end; recaps at the whistles.
    const feed = Effect.gen(function* () {
      let pending: Signal[] = []
      let end = -1
      let half = false
      let last = 0
      while (true) {
        const b = yield* PubSub.take(sub)
        if (b.kind === "signals") {
          if (end < 0) end = Math.floor(b.frame / width) * width + width
          pending = [...pending, ...b.signals]
        } else if (b.kind === "frame") {
          if (!half && b.frame.period === "second_half") {
            half = true
            if (pending.length) yield* Queue.offer(jobs, { kind: "signals", signals: pending, frame: last })
            pending = []
            end = -1
            yield* Queue.offer(jobs, { kind: "recap", recap: "half_time", frame: last })
          }
          last = b.frame.frame
          if (end >= 0 && last >= end && pending.length) {
            yield* Queue.offer(jobs, { kind: "signals", signals: pending, frame: last })
            pending = []
            end = -1
          }
        } else if (b.kind === "end") {
          if (pending.length) yield* Queue.offer(jobs, { kind: "signals", signals: pending, frame: b.frame })
          yield* Queue.offer(jobs, { kind: "recap", recap: "full_time", frame: b.frame })
          yield* Queue.offer(jobs, { kind: "stop" })
          return
        }
      }
    })

    yield* Effect.all([worker, feed], { concurrency: "unbounded", discard: true })
  }).pipe(Effect.scoped)
```

Apply this change to `apps/api/src/main.ts`, `apps/api/src/index.ts` (from the repository root):

```bash
git apply <<'PATCH'
diff --git a/apps/api/src/index.ts b/apps/api/src/index.ts
index c73c76e..93221a7 100644
--- a/apps/api/src/index.ts
+++ b/apps/api/src/index.ts
@@ -4,3 +4,4 @@ export * from "./playback.js"
 export * from "./session.js"
 export * from "./evidence.js"
 export * from "./server.js"
+export * from "./live.js"
diff --git a/apps/api/src/main.ts b/apps/api/src/main.ts
index 503d888..81d9bbf 100644
--- a/apps/api/src/main.ts
+++ b/apps/api/src/main.ts
@@ -5,6 +5,7 @@ import { Effect, Layer } from "effect"
 import type { League } from "@touchline/league"
 import { cliOptions, integer } from "@touchline/sim"
 import { scanLibrary } from "./library.js"
+import { liveAgents } from "./live.js"
 import { root } from "./playback.js"
 import { serverLayer } from "./server.js"
 
@@ -14,10 +15,13 @@ const here = (p: string) => resolve(process.env.INIT_CWD ?? process.cwd(), p)
 const o = cliOptions("touchline-api: the match library, playback sessions and agent cues over RPC (WebSocket at /rpc)", {
   library: { default: join(root, "out/library"), help: "folder of run folders (pnpm library fills it)" },
   port: { default: "8787", check: integer(0, 65535), help: "port to listen on" },
-  host: { default: "127.0.0.1", help: "address to listen on" }
+  host: { default: "127.0.0.1", help: "address to listen on" },
+  agents: { default: "http://127.0.0.1:8100/", help: "the agent service for live sessions (uv run --project services/agents touchline-agents)" },
+  "budget-ms": { default: "4000", check: integer(0, 600_000), help: "time a live agent request may take (0: no limit)" }
 })
 
 const league = JSON.parse(readFileSync(join(root, "data/league/league.json"), "utf8")) as League
 const library = scanLibrary(here(o.library), league)
 console.error(`touchline-api: ${library.size} matches in ${here(o.library)}`)
-Layer.launch(serverLayer({ library, port: Number(o.port), host: o.host })).pipe(NodeRuntime.runMain)
+const companion = liveAgents({ agentsUrl: o.agents, budgetMs: Number(o["budget-ms"]) })
+Layer.launch(serverLayer({ library, port: Number(o.port), host: o.host, companion })).pipe(NodeRuntime.runMain)
PATCH
```

- [ ] **Step 5: Run the tests**

Run: `pnpm --filter @touchline/api test live && pnpm --filter @touchline/api test`
Expected: 3 passed (a live goal cue for the watched segment and no cached cues; the half-time recap requested as the second half starts; batches merged); then all 25 passed

- [ ] **Step 6: Commit**

```bash
git add apps/api
git commit -m "feat(api): live toggle — signals to the agent service in match-time batches for the watched segments, recaps at the whistles, cues onto the bus as they arrive, slow batches merged

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```



### Task 8: pnpm library

**`pnpm library`** fills the library. For each built-in scenario (default: all six, seed 1) it does two things:
1. **Simulate:** run `pnpm sim` into `out/library/lib-<scenario>-<seed>`.
2. **Annotate** (when an agent service answers): run the gateway (`replaySignals`, `startMcpStats`, `runGateway`, `writeCache`) for twelve segments. Those are both modes, the three languages, neutral and the home club: the spec's cap, the library's whole variety.

With no agent service it fails with the command that starts one. **`--no-agents true`** only simulates; those matches play with stats cues alone.

The tests cover the segments, a stats-only build and the missing-service error. A full build runs one scenario through the Python agent service on the stub model, about 30 s. The tests delete the folders they build.

**Files:**
- Create: `apps/api/src/build-library.ts`, `apps/api/src/library-cli.ts`
- Modify: `apps/api/package.json` (script `library`), `apps/api/src/index.ts`, `package.json` (root script `library`)
- Test: `apps/api/test/build-library.test.ts`

**Interfaces:**
- Consumes: `a2aSender`, `DEFAULT_OPTIONS`, `replaySignals`, `runGateway`, `startMcpStats`, `summarize`, `writeCache` (`@touchline/agent-gateway`), `SCENARIOS`, `cliOptions` (`@touchline/sim`), the agent service (Plan 4a).
- Produces: `BuildError`, `librarySegments(homeClub) -> Segment[12]`, `BuildOptions` (`out`, `scenarios`, `seed`, `agentsUrl | null`, `log?`), `buildLibrary(options) -> run folders`; command `pnpm library [--out DIR] [--scenarios a,b] [--seed 1] [--agents URL] [--no-agents true]`.

- [ ] **Step 1: Write the failing tests**

Create `apps/api/test/build-library.test.ts`:

```ts
import { spawn, type ChildProcess } from "node:child_process"
import { mkdtempSync, rmSync } from "node:fs"
import { createServer } from "node:net"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterAll, describe, expect, it } from "vitest"
import { segmentKey } from "@touchline/schema"
import { BuildError, buildLibrary, librarySegments } from "../src/build-library.js"
import { scanLibrary } from "../src/library.js"
import { league, root } from "./fixture.js"

const freePort = () => new Promise<number>((ok) => {
  const s = createServer().listen(0, "127.0.0.1", () => {
    const port = (s.address() as { port: number }).port
    s.close(() => ok(port))
  })
})

let agents: ChildProcess | undefined
const dirs: string[] = []
const tmp = () => {
  const d = mkdtempSync(join(tmpdir(), "lib-"))
  dirs.push(d)
  return d
}
afterAll(() => {
  if (agents?.pid) process.kill(-agents.pid, "SIGTERM")
  for (const d of dirs) rmSync(d, { recursive: true, force: true }) // simulated matches, about 80 MB each
})

describe("library builder", () => {
  it("covers twelve segments: both modes, three languages, neutral and the home club", () => {
    const s = librarySegments("northwick")
    expect(s).toHaveLength(12)
    expect(new Set(s.map(segmentKey)).size).toBe(12)
    expect(s.filter((x) => x.club === "northwick")).toHaveLength(6)
  })

  it("simulates without agents, and says how to start the agent service when it is missing", async () => {
    const out = tmp()
    await buildLibrary({ out, scenarios: ["even_contest"], seed: 3, agentsUrl: null })
    const lib = scanLibrary(out, league)
    expect([...lib.keys()]).toEqual(["lib-even_contest-3"])
    expect(lib.get("lib-even_contest-3")!.info.segments).toEqual([])
    await expect(buildLibrary({ out, scenarios: ["even_contest"], seed: 3, agentsUrl: "http://127.0.0.1:9/" })).rejects.toThrow(BuildError)
    await expect(buildLibrary({ out, scenarios: ["even_contest"], seed: 3, agentsUrl: "http://127.0.0.1:9/" })).rejects.toThrow(/touchline-agents/)
  }, 120_000)

  it("caches the agents' cues for every segment through the agent service (stub model)", async () => {
    const port = await freePort()
    agents = spawn("uv", ["run", "--project", "services/agents", "touchline-agents", "--port", String(port)], { cwd: root, env: { ...process.env, TOUCHLINE_LLM: "stub" }, detached: true, stdio: "ignore" })
    const url = `http://127.0.0.1:${port}/`
    for (let i = 0; i < 300 && !(await fetch(`${url}.well-known/agent-card.json`).then((r) => r.ok, () => false)); i++) await new Promise((r) => setTimeout(r, 200))
    const out = tmp()
    await buildLibrary({ out, scenarios: ["costly_error"], seed: 2, agentsUrl: url })
    const m = scanLibrary(out, league).get("lib-costly_error-2")!
    expect(m.info.segments).toHaveLength(12)
    expect(m.info.model).toBe("stub")
    expect(m.cues.length).toBeGreaterThan(100)
  }, 300_000)
})
```

- [ ] **Step 2: Run them to make sure they fail**

Run: `pnpm --filter @touchline/api test build-library`
Expected: the file fails to load: `Cannot find module '../src/build-library.js'`

- [ ] **Step 3: Write the builder and the command**

Create `apps/api/src/build-library.ts`:

```ts
/**
 * Fill the match library: simulate the built-in scenarios and run each through the agent service (pnpm agents'
 * gateway), so every match plays with its cached cues (spec §6 cached replay). Deterministic for a stub model.
 */
import { spawnSync } from "node:child_process"
import { join } from "node:path"
import { Effect } from "effect"
import { a2aSender, DEFAULT_OPTIONS, replaySignals, runGateway, startMcpStats, summarize, writeCache } from "@touchline/agent-gateway"
import type { Segment } from "@touchline/schema"
import { SCENARIOS } from "@touchline/sim"
import { root } from "./playback.js"

export class BuildError extends Error {}

/** Twelve segments (the spec's cap): casual and analyst, in English, Spanish and Hindi, neutral and for the home club. */
export const librarySegments = (homeClub: string): Segment[] =>
  (["casual", "analyst"] as const).flatMap((mode) => (["en", "es", "hi"] as const).flatMap((lang) => [null, homeClub].map((club) => ({ mode, lang, club }))))

export interface BuildOptions {
  readonly out: string
  readonly scenarios: ReadonlyArray<string>
  readonly seed: number
  /** The agent service, or null to simulate only (matches play with stats cues and no agent cues). */
  readonly agentsUrl: string | null
  readonly log?: (line: string) => void
}

/** Simulate and (with an agent service) annotate each scenario; returns the run folders written. */
export const buildLibrary = async (o: BuildOptions): Promise<string[]> => {
  const log = o.log ?? (() => {})
  if (o.agentsUrl && !(await fetch(new URL(".well-known/agent-card.json", o.agentsUrl)).then((r) => r.ok, () => false)))
    throw new BuildError(`no agent service at ${o.agentsUrl} (start it with: uv run --project services/agents touchline-agents), or pass --no-agents`)
  const dirs: string[] = []
  for (const scenario of o.scenarios) {
    const sc = SCENARIOS[scenario]
    if (!sc) throw new BuildError(`unknown scenario ${scenario} (${Object.keys(SCENARIOS).join(", ")})`)
    const id = `lib-${scenario}-${o.seed}`
    const dir = join(o.out, id)
    const sim = spawnSync("pnpm", ["-s", "sim", "--scenario", scenario, "--seed", String(o.seed), "--match-id", id, "--out", dir], { cwd: root, encoding: "utf8" })
    if (sim.status !== 0) throw new BuildError(`pnpm sim failed for ${scenario}: ${sim.stderr.slice(-400)}`)
    log(`simulated ${id}`)
    if (o.agentsUrl) {
      const plan = await Effect.runPromise(replaySignals(dir))
      const mcp = await startMcpStats(dir)
      try {
        const result = await Effect.runPromise(runGateway(a2aSender(o.agentsUrl), { ...plan, mcpUrl: mcp.url }, { ...DEFAULT_OPTIONS, segments: librarySegments(sc.home) }))
        writeCache(dir, result)
        const s = summarize(result)
        log(`  ${s.moments} moments, ${s.cues} cues (${s.models.join(", ") || "no model"})`)
      } finally {
        mcp.stop()
      }
    }
    dirs.push(dir)
  }
  return dirs
}
```

Create `apps/api/src/library-cli.ts`:

```ts
import { join, resolve } from "node:path"
import { CliError, cliOptions, exitOnUserError, integer, SCENARIOS } from "@touchline/sim"
import { BuildError, buildLibrary } from "./build-library.js"
import { root } from "./playback.js"

const here = (p: string) => resolve(process.env.INIT_CWD ?? process.cwd(), p)
const o = cliOptions("touchline-library: simulate the built-in scenarios and cache their agent cues for the API", {
  out: { default: join(root, "out/library"), help: "library folder" },
  scenarios: { default: Object.keys(SCENARIOS).join(","), help: "comma-separated scenario names" },
  seed: { default: "1", check: integer(0, 4294967295), help: "seed for every scenario" },
  agents: { default: "http://127.0.0.1:8100/", help: "the agent service (A2A)" },
  "no-agents": { default: "false", help: "\"true\": simulate only (matches play with stats and no agent cues)" }
})
const scenarios = exitOnUserError(() => {
  const s = o.scenarios.split(",").map((x) => x.trim()).filter(Boolean)
  if (!s.length) throw new CliError("--scenarios needs at least one scenario")
  return s
})
buildLibrary({ out: here(o.out), scenarios, seed: Number(o.seed), agentsUrl: o["no-agents"] === "true" ? null : o.agents, log: (l) => console.error(l) })
  .then((dirs) => console.log(`${dirs.length} matches in ${here(o.out)}`))
  .catch((e) => {
    if (e instanceof BuildError) {
      console.error(e.message)
      process.exit(2)
    }
    throw e
  })
```

Apply this change to `apps/api/package.json`, `apps/api/src/index.ts`, `package.json` (from the repository root):

```bash
git apply <<'PATCH'
diff --git a/apps/api/package.json b/apps/api/package.json
index 9b4e3bb..d6bde33 100644
--- a/apps/api/package.json
+++ b/apps/api/package.json
@@ -9,7 +9,8 @@
   "scripts": {
     "test": "vitest run",
     "typecheck": "tsc --noEmit -p .",
-    "serve": "tsx src/main.ts"
+    "serve": "tsx src/main.ts",
+    "library": "tsx src/library-cli.ts"
   },
   "dependencies": {
     "@effect/platform-node": "4.0.1",
diff --git a/apps/api/src/index.ts b/apps/api/src/index.ts
index 93221a7..9e00196 100644
--- a/apps/api/src/index.ts
+++ b/apps/api/src/index.ts
@@ -5,3 +5,4 @@ export * from "./session.js"
 export * from "./evidence.js"
 export * from "./server.js"
 export * from "./live.js"
+export * from "./build-library.js"
diff --git a/package.json b/package.json
index 57ab27a..01b3fa6 100644
--- a/package.json
+++ b/package.json
@@ -14,7 +14,8 @@
     "stats": "pnpm --filter @touchline/stats run stats",
     "mcp-stats": "pnpm --filter @touchline/mcp-stats run serve",
     "agents": "pnpm --filter @touchline/agent-gateway run agents",
-    "api": "pnpm --filter @touchline/api run serve"
+    "api": "pnpm --filter @touchline/api run serve",
+    "library": "pnpm --filter @touchline/api run library"
   },
   "devDependencies": {
     "@types/node": "22.20.5",
PATCH
```

- [ ] **Step 4: Run the tests**

Run: `pnpm --filter @touchline/api test build-library`
Expected: 3 passed (twelve segments; a stats-only match and the missing-service message; a full build with 12 segments, model `stub` and over 100 cues)

- [ ] **Step 5: Commit**

```bash
git add apps/api package.json
git commit -m "feat(api): pnpm library — simulate the built-in scenarios and cache their agent cues for twelve segments

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```



### Task 9: Fan app scaffold: strings, profiles, pane state, RPC client

`apps/web` is a Vite 8 app with React 19 and Tailwind 4. The dev server forwards `/rpc`, WebSocket included, to the API on :8787, so the app talks to its own origin.
- **Strings:** the app's own words (`i18n.ts`) in English, Spanish and Hindi. A test checks every key exists in each language, and Hindi is in Devanagari.
- **Profiles** (spec §5.5): mode, language and the clubs a viewer supports collapse to a segment (`segmentOf`), and there are ready-made presets.
- **Pane state** (`pane.ts`): a pure reducer over ticks.
  - It keeps the latest frame and the playback state.
  - It keeps the scoreboard (from top-bar stats cues).
  - It shows each cue in its slot until its ttl runs out in wall-clock time, a newer cue replacing the one in its slot.
  - It keeps a feed of the last 50 agent cues.
- **Client** (`client.ts`): the app's view of the API, as promises and callbacks, implemented with the Effect RPC client over the browser's WebSocket. It is tested against the real API server in Node (whose WebSocket is the browser's).
- **First screen:** the library as cards in the clubs' kit colours, and a language switch. Components are tested with a fake client in jsdom; Testing Library cleans up after each test.

`dist/` is git-ignored.

**Files:**
- Create: `apps/web/package.json`, `apps/web/tsconfig.json`, `apps/web/vite.config.ts`, `apps/web/index.html`, `apps/web/src/{index.css,main.tsx,App.tsx,MatchList.tsx,i18n.ts,profile.ts,pane.ts,client.ts}`, `apps/web/test/{setup.ts,fake-client.ts}`
- Modify: `.gitignore`, `package.json` (root script `web`)
- Test: `apps/web/test/basics.test.ts`, `apps/web/test/client.test.ts`, `apps/web/test/app.test.tsx`
- Regenerate: `pnpm-lock.yaml`

**Interfaces:**
- Consumes: `TouchlineRpcs`, `MatchSummary`, `MatchInfo`, `Tick`, `Playback`, `Evidence`, `RecapView` (Task 1); `serverLayer`, `readMatch` (Tasks 2 and 6, in the client test); the API test fixture (`apps/api/test/fixture.ts`).
- Produces:
  - `i18n.ts`: `Lang`, `Key`, `STRINGS`, `t(lang, key)`, `LANG_NAMES`.
  - `profile.ts`: `Profile` (`mode`, `lang`, `clubs`), `segmentOf`, `PRESETS`, `presetProfile(id, home, away)`.
  - `pane.ts`: `Board`, `OnScreen`, `PaneState`, `EMPTY`, `FEED_SIZE = 50`, `reduce(state, tick, now)`, `inSlot(state, slot, now)`.
  - `client.ts`: `TouchlineClient` (`listMatches`, `startSession`, `watch -> stop()`, `control`, `evidence`, `recap`, `close`), `StartOptions`, `defaultUrl()`, `connect(url)`.
  - Components: `App`, `MatchList`.
  - Test helpers: `fakeClient({matches?, evidence?, recap?})` with `watchers`, `calls`, `push(tick)`; `MATCH`, `INFO`, `team`.

- [ ] **Step 1: Create the app**

Create `apps/web/package.json`:

```json
{
  "name": "@touchline/web",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "vite build",
    "test": "vitest run",
    "typecheck": "tsc --noEmit -p ."
  },
  "dependencies": {
    "@effect/platform-browser": "4.0.1",
    "@touchline/rpc": "workspace:*",
    "@touchline/schema": "workspace:*",
    "effect": "4.0.1",
    "react": "19.3.0",
    "react-dom": "19.3.0"
  },
  "devDependencies": {
    "@tailwindcss/vite": "4.3.3",
    "@testing-library/dom": "10.4.2",
    "@testing-library/react": "16.3.3",
    "@testing-library/user-event": "14.6.7",
    "@touchline/api": "workspace:*",
    "@types/react": "19.3.0",
    "@types/react-dom": "19.3.0",
    "@vitejs/plugin-react": "6.1.2",
    "jsdom": "30.1.2",
    "tailwindcss": "4.3.3",
    "vite": "8.3.3"
  }
}
```

Create `apps/web/tsconfig.json`:

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": { "jsx": "react-jsx", "lib": ["ES2022", "DOM", "DOM.Iterable"], "types": ["node", "vite/client"] },
  "include": ["src", "test", "vite.config.ts"]
}
```

Create `apps/web/vite.config.ts`:

```ts
import tailwindcss from "@tailwindcss/vite"
import react from "@vitejs/plugin-react"
import { defineConfig } from "vitest/config"

// The API (pnpm api) serves RPC over WebSocket at /rpc; the dev server forwards it, so the app talks to its own origin.
export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: { port: 5173, proxy: { "/rpc": { target: "ws://127.0.0.1:8787", ws: true } } },
  test: { environment: "jsdom", setupFiles: ["test/setup.ts"], testTimeout: 120_000 }
})
```

Create `apps/web/index.html`:

```text
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Touchline</title>
  </head>
  <body class="bg-slate-950 text-slate-100">
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

Create `apps/web/src/index.css`:

```text
@import "tailwindcss";

@theme {
  --color-pitch: #1f6b3a;
  --color-pitch-line: #e8f5ec;
  --font-sans: "Inter", "Noto Sans", "Noto Sans Devanagari", system-ui, sans-serif;
}
```

Apply this change to `.gitignore`, `package.json` (from the repository root):

```bash
git apply <<'PATCH'
diff --git a/.gitignore b/.gitignore
index 9fd43dd..1e456e0 100644
--- a/.gitignore
+++ b/.gitignore
@@ -12,3 +12,6 @@ __pycache__/
 .env
 .env.*
 !.env.example
+
+# Build output
+dist/
diff --git a/package.json b/package.json
index 01b3fa6..1c8528b 100644
--- a/package.json
+++ b/package.json
@@ -15,7 +15,8 @@
     "mcp-stats": "pnpm --filter @touchline/mcp-stats run serve",
     "agents": "pnpm --filter @touchline/agent-gateway run agents",
     "api": "pnpm --filter @touchline/api run serve",
-    "library": "pnpm --filter @touchline/api run library"
+    "library": "pnpm --filter @touchline/api run library",
+    "web": "pnpm --filter @touchline/web run dev"
   },
   "devDependencies": {
     "@types/node": "22.20.5",
PATCH
```

Run: `pnpm install`
Expected: React, Vite, Tailwind and the test libraries installed

- [ ] **Step 2: Write the failing tests**

Create `apps/web/test/setup.ts`:

```ts
import { cleanup } from "@testing-library/react"
import { afterEach } from "vitest"

// Unmount what each test rendered (Testing Library cleans up by itself only with vitest globals).
afterEach(cleanup)
```

Create `apps/web/test/fake-client.ts`:

```ts
/** A TouchlineClient for component tests: canned answers, and ticks the test pushes to every watcher. */
import type { Evidence, MatchInfo, MatchSummary, Playback, RecapView, Tick } from "@touchline/rpc"
import type { Segment } from "@touchline/schema"
import type { TouchlineClient } from "../src/client.js"

export const team = (id: string, side: "home" | "away", name: string, color: string) => ({ id, name, short: id.slice(0, 3).toUpperCase(), side, kit: { primary: color, secondary: "#ffffff" } })

export const MATCH: MatchSummary = {
  match_id: "lib-costly_error-1", scenario: "costly_error", seed: 1, home: team("northwick", "home", "Northwick Mariners", "#1d4ed8"), away: team("larkspur", "away", "Larkspur City", "#dc2626"),
  score: { home: 1, away: 2 }, fps: 10, frames: 58000, segments: ["casual.en.neutral"], model: "stub"
}
export const INFO: MatchInfo = {
  ...MATCH,
  players: [
    { id: "p-nor-01", team_id: "northwick", name: "Datan Drenussen", jersey: 1, role: "GK" },
    { id: "p-lar-09", team_id: "larkspur", name: "Feseo Wylford", jersey: 9, role: "ST" }
  ]
}

export interface FakeClient extends TouchlineClient {
  readonly watchers: Array<{ segment: Segment; onTick: (t: Tick) => void }>
  readonly calls: string[]
  push(t: Tick): void
}

export const fakeClient = (o: { matches?: ReadonlyArray<MatchSummary>; evidence?: Evidence; recap?: RecapView } = {}): FakeClient => {
  const watchers: FakeClient["watchers"] = []
  const calls: string[] = []
  let playback: Playback = { state: "playing", frame: 0, speed: 4, live: false }
  return {
    watchers,
    calls,
    push: (t) => watchers.forEach((w) => w.onTick(t)),
    listMatches: async () => o.matches ?? [MATCH],
    startSession: async (id, s) => {
      calls.push(`start ${id} x${s.speed} live=${s.live}`)
      playback = { ...playback, speed: s.speed, live: s.live }
      return { session_id: "s1", match: INFO }
    },
    watch: (_id, segment, onTick) => {
      const w = { segment, onTick }
      watchers.push(w)
      return () => watchers.splice(watchers.indexOf(w), 1)
    },
    control: async (_id, action, speed) => {
      calls.push(`control ${action}${speed ? ` ${speed}` : ""}`)
      playback = { ...playback, state: action === "pause" ? "paused" : action === "play" ? "playing" : playback.state, speed: speed ?? playback.speed }
      return playback
    },
    evidence: async (_m, cueId) => {
      calls.push(`evidence ${cueId}`)
      if (!o.evidence) throw new Error("no evidence")
      return o.evidence
    },
    recap: async () => o.recap ?? { recap: null, cards: [] },
    close: async () => {}
  }
}
```

Create `apps/web/test/basics.test.ts`:

```ts
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"
import type { Tick } from "@touchline/rpc"
import type { Cue } from "@touchline/schema"
import { STRINGS, t, type Key } from "../src/i18n.js"
import { EMPTY, FEED_SIZE, inSlot, reduce } from "../src/pane.js"
import { presetProfile, PRESETS, segmentOf } from "../src/profile.js"

const cue = (JSON.parse(readFileSync(join(import.meta.dirname, "../../../packages/schema/fixtures/agents/valid/cue.json"), "utf8")) as { value: Cue }).value

describe("strings", () => {
  it("exist in every language, Hindi in Devanagari", () => {
    const keys = Object.keys(STRINGS.en) as Key[]
    for (const lang of ["es", "hi"] as const) {
      expect(Object.keys(STRINGS[lang]).sort()).toEqual([...keys].sort())
      for (const k of keys) expect(t(lang, k).trim(), `${lang}.${k}`).not.toBe("")
    }
    for (const k of keys.filter((k) => !["title"].includes(k))) expect(t("hi", k), k).toMatch(/[ऀ-ॿ]/)
  })
})

describe("profiles", () => {
  it("collapse to a segment, the first club framing the text", () => {
    expect(segmentOf({ mode: "analyst", lang: "hi", clubs: [] })).toEqual({ mode: "analyst", lang: "hi", club: null })
    expect(segmentOf({ mode: "casual", lang: "es", clubs: ["larkspur", "northwick"] })).toEqual({ mode: "casual", lang: "es", club: "larkspur" })
    expect(presetProfile("home-fan-en", "northwick", "larkspur").clubs).toEqual(["northwick"])
    expect(new Set(PRESETS.map((p) => p.id)).size).toBe(PRESETS.length)
  })
})

describe("pane", () => {
  const board: Cue = { ...cue, cue_id: "b1", moment_id: null, text: null, display: { ...cue.display, slot: "top_bar", ttl_ms: 2000 }, data: { "score.home": 2, "score.away": 1, "team.mom.home": 0.6, "team.mom.away": 0.4 } }
  const tick = (c: Cue): Tick => ({ kind: "cue", cue: c })

  it("keeps the latest frame, playback state and scoreboard", () => {
    let s = reduce(EMPTY, { kind: "playback", playback: { state: "playing", frame: 0, speed: 4, live: false } }, 0)
    s = reduce(s, { kind: "frame", frame: { frame: 7, period: "first_half", clock: "00:00.70", ball: { x: 0, y: 0, z: 0 }, home: [], away: [] } }, 0)
    s = reduce(s, tick(board), 0)
    expect(s.frame?.frame).toBe(7)
    expect(s.playback?.speed).toBe(4)
    expect(s.board).toEqual({ score: { home: 2, away: 1 }, clock: board.anchor.clock, momentum: { home: 0.6, away: 0.4 } })
    expect(s.feed).toEqual([]) // the scoreboard is not an agent cue
  })

  it("shows a cue in its slot until its ttl runs out, a newer one in the slot replacing it", () => {
    let s = reduce(EMPTY, tick(cue), 1000)
    expect(inSlot(s, "lower_third", 1000 + cue.display.ttl_ms - 1)?.cue_id).toBe(cue.cue_id)
    expect(inSlot(s, "lower_third", 1000 + cue.display.ttl_ms)).toBeNull()
    s = reduce(s, tick({ ...cue, cue_id: "next" }), 2000)
    expect(inSlot(s, "lower_third", 2001)?.cue_id).toBe("next")
    expect(s.feed.map((c) => c.cue_id)).toEqual(["next", cue.cue_id])
  })

  it("keeps a bounded feed", () => {
    let s = EMPTY
    for (let i = 0; i < FEED_SIZE + 10; i++) s = reduce(s, tick({ ...cue, cue_id: `c${i}` }), i)
    expect(s.feed).toHaveLength(FEED_SIZE)
    expect(s.feed[0]!.cue_id).toBe(`c${FEED_SIZE + 9}`)
  })
})
```

Create `apps/web/test/client.test.ts`:

```ts
// @vitest-environment node
import { createServer } from "node:net"
import { Effect, Layer } from "effect"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { readMatch, serverLayer } from "@touchline/api"
import type { Tick } from "@touchline/rpc"
import { connect, type TouchlineClient } from "../src/client.js"
import { league, makeLibrary, MATCH_ID, type TestLibrary } from "../../api/test/fixture.js"

const freePort = () => new Promise<number>((ok) => {
  const s = createServer().listen(0, "127.0.0.1", () => {
    const port = (s.address() as { port: number }).port
    s.close(() => ok(port))
  })
})

let lib: TestLibrary
let client: TouchlineClient
let stop: () => void
beforeAll(async () => {
  lib = await makeLibrary()
  const port = await freePort()
  const fiber = Effect.runFork(Layer.launch(serverLayer({ library: new Map([[MATCH_ID, readMatch(lib.run, league)]]), port })))
  stop = () => fiber.interruptUnsafe()
  for (let i = 0; i < 100 && !(await fetch(`http://127.0.0.1:${port}/health`).then((r) => r.ok, () => false)); i++) await new Promise((r) => setTimeout(r, 50))
  client = await connect(`ws://127.0.0.1:${port}/rpc`)
}, 120_000)
afterAll(async () => {
  await client?.close()
  stop?.()
})

describe("browser client", () => {
  it("lists matches, plays a session to a moment and explains it", async () => {
    expect((await client.listMatches()).map((m) => m.match_id)).toEqual([MATCH_ID])
    const goal = lib.goals[0]!
    const { session_id } = await client.startSession(MATCH_ID, { speed: 64, fromMinute: Math.floor(goal.frame_id / 600), live: false })
    const ticks: Tick[] = []
    await new Promise<void>((done) => {
      const stopWatching = client.watch(session_id, { mode: "analyst", lang: "es", club: null }, (t) => {
        ticks.push(t)
        if (t.kind === "cue" && t.cue.moment_id) {
          stopWatching()
          done()
        }
      })
    })
    const last = ticks.at(-1)!
    expect(last.kind === "cue" && last.cue.segment).toEqual({ mode: "analyst", lang: "es", club: null })
    expect((await client.control(session_id, "pause")).state).toBe("paused")
    const ev = await client.evidence(MATCH_ID, last.kind === "cue" ? last.cue.cue_id : "")
    expect(ev.events[0]!.id).toBe(goal.id)
  })

  it("rejects calls for unknown matches", async () => {
    await expect(client.startSession("nope", { speed: 4, fromMinute: 0, live: false })).rejects.toThrow()
  })
})
```

Create `apps/web/test/app.test.tsx`:

```text
import { render, screen, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { describe, expect, it } from "vitest"
import { App } from "../src/App.js"
import { fakeClient } from "./fake-client.js"

describe("app shell", () => {
  it("lists the library's matches and switches the interface language", async () => {
    render(<App client={fakeClient()} />)
    const card = await screen.findByRole("listitem")
    expect(within(card).getByText("Northwick Mariners")).toBeTruthy()
    expect(within(card).getByText("1–2")).toBeTruthy()
    await userEvent.selectOptions(screen.getByLabelText("Language"), "hi")
    expect(screen.getByText("मैच")).toBeTruthy()
    expect(within(card).getByRole("button", { name: "देखें" })).toBeTruthy()
  })

  it("says how to fill an empty library", async () => {
    render(<App client={fakeClient({ matches: [] })} />)
    expect(await screen.findByText(/pnpm library/)).toBeTruthy()
  })
})
```

- [ ] **Step 3: Run them to make sure they fail**

Run: `pnpm --filter @touchline/web test`
Expected: 3 files fail to load: `Cannot find module '../src/client.js'`, `Failed to resolve import "../src/pane.js"` (and the app test's imports)

- [ ] **Step 4: Write the strings, profiles, pane state and client**

Create `apps/web/src/i18n.ts`:

```ts
/** The app's own words in English, Spanish and Hindi (the cues come already written in each language by the agents). */
export type Lang = "en" | "es" | "hi"

const en = {
  title: "Touchline",
  tagline: "Live match intelligence, checked against the data",
  matches: "Matches",
  noMatches: "No matches yet. Run pnpm library to build some.",
  watch: "Watch",
  play: "Play",
  pause: "Pause",
  speed: "Speed",
  live: "Live agents",
  recorded: "Recorded cues",
  profile: "Profile",
  casual: "Casual",
  analyst: "Analyst",
  language: "Language",
  club: "Club",
  neutral: "Neutral",
  split: "Split screen",
  single: "Single view",
  why: "Why?",
  close: "Close",
  cause: "Cause",
  claims: "Checked facts",
  history: "Last five minutes",
  events: "Events",
  verified: "Verified against the match data",
  model: "Written by",
  recap: "Recap",
  halfTime: "Half-time",
  fullTime: "Full-time",
  ended: "Full-time",
  paused: "Paused",
  loading: "Loading…",
  momentum: "Momentum",
  back: "Back to matches",
  fromMinute: "From minute",
  stats: "Stats only"
} as const

export type Key = keyof typeof en

export const STRINGS: Record<Lang, Record<Key, string>> = {
  en,
  es: {
    title: "Touchline",
    tagline: "Inteligencia del partido en directo, contrastada con los datos",
    matches: "Partidos",
    noMatches: "Aún no hay partidos. Ejecuta pnpm library para crearlos.",
    watch: "Ver",
    play: "Reanudar",
    pause: "Pausa",
    speed: "Velocidad",
    live: "Agentes en directo",
    recorded: "Comentarios grabados",
    profile: "Perfil",
    casual: "Aficionado",
    analyst: "Analista",
    language: "Idioma",
    club: "Club",
    neutral: "Neutral",
    split: "Pantalla dividida",
    single: "Vista única",
    why: "¿Por qué?",
    close: "Cerrar",
    cause: "Causa",
    claims: "Datos comprobados",
    history: "Últimos cinco minutos",
    events: "Jugadas",
    verified: "Comprobado con los datos del partido",
    model: "Redactado por",
    recap: "Resumen",
    halfTime: "Descanso",
    fullTime: "Final",
    ended: "Final del partido",
    paused: "En pausa",
    loading: "Cargando…",
    momentum: "Impulso",
    back: "Volver a los partidos",
    fromMinute: "Desde el minuto",
    stats: "Solo estadísticas"
  },
  hi: {
    title: "Touchline",
    tagline: "मैच की लाइव जानकारी, आंकड़ों से जांची हुई",
    matches: "मैच",
    noMatches: "अभी कोई मैच नहीं है। बनाने के लिए pnpm library चलाएं।",
    watch: "देखें",
    play: "चलाएं",
    pause: "रोकें",
    speed: "गति",
    live: "लाइव एजेंट",
    recorded: "रिकॉर्ड की गई टिप्पणियां",
    profile: "प्रोफ़ाइल",
    casual: "आम दर्शक",
    analyst: "विश्लेषक",
    language: "भाषा",
    club: "क्लब",
    neutral: "तटस्थ",
    split: "दो स्क्रीन",
    single: "एक स्क्रीन",
    why: "क्यों?",
    close: "बंद करें",
    cause: "कारण",
    claims: "जांचे गए तथ्य",
    history: "पिछले पांच मिनट",
    events: "घटनाएं",
    verified: "मैच के आंकड़ों से जांचा गया",
    model: "लेखक",
    recap: "सारांश",
    halfTime: "हाफ़-टाइम",
    fullTime: "फ़ुल-टाइम",
    ended: "फ़ुल-टाइम",
    paused: "रुका हुआ",
    loading: "लोड हो रहा है…",
    momentum: "लय",
    back: "मैचों पर वापस",
    fromMinute: "मिनट से",
    stats: "सिर्फ़ आंकड़े"
  }
}

export const t = (lang: Lang, key: Key): string => STRINGS[lang][key]

export const LANG_NAMES: Record<Lang, string> = { en: "English", es: "Español", hi: "हिन्दी" }
```

Create `apps/web/src/profile.ts`:

```ts
import type { Segment } from "@touchline/schema"
import type { Lang } from "./i18n.js"

/** A viewer's profile (spec §5.5). Profiles collapse to segments, so cues are written per segment, not per viewer. */
export interface Profile {
  readonly mode: "casual" | "analyst"
  readonly lang: Lang
  /** Clubs the viewer supports, most supported first (the first frames the casual text). */
  readonly clubs: ReadonlyArray<string>
}

export const segmentOf = (p: Profile): Segment => ({ mode: p.mode, lang: p.lang, club: p.clubs[0] ?? null })

/** Ready-made profiles for the switcher; `club: "home"` / `"away"` stand for the match's two clubs. */
export const PRESETS: ReadonlyArray<{ readonly id: string; readonly mode: Profile["mode"]; readonly lang: Lang; readonly club: "home" | "away" | null }> = [
  { id: "casual-en", mode: "casual", lang: "en", club: null },
  { id: "home-fan-en", mode: "casual", lang: "en", club: "home" },
  { id: "analyst-en", mode: "analyst", lang: "en", club: null },
  { id: "casual-es", mode: "casual", lang: "es", club: null },
  { id: "analyst-es", mode: "analyst", lang: "es", club: null },
  { id: "casual-hi", mode: "casual", lang: "hi", club: null },
  { id: "analyst-hi", mode: "analyst", lang: "hi", club: null }
]

export const presetProfile = (id: string, home: string, away: string): Profile => {
  const p = PRESETS.find((x) => x.id === id) ?? PRESETS[0]!
  return { mode: p.mode, lang: p.lang, clubs: p.club === "home" ? [home] : p.club === "away" ? [away] : [] }
}
```

Create `apps/web/src/pane.ts`:

```ts
/**
 * What one view (pane) of a session shows, from the ticks it receives: the latest frame, the scoreboard, the cues on
 * screen by slot (each until its ttl runs out, in wall-clock time) and every agent cue so far (for "Why?").
 */
import type { PitchFrame, Playback, Tick } from "@touchline/rpc"
import type { Cue } from "@touchline/schema"

export interface Board {
  readonly score: { readonly home: number; readonly away: number }
  readonly clock: string
  readonly momentum: { readonly home: number; readonly away: number } | null
}

export interface OnScreen {
  readonly cue: Cue
  /** Wall-clock milliseconds when it leaves the screen. */
  readonly until: number
}

export interface PaneState {
  readonly frame: PitchFrame | null
  readonly playback: Playback | null
  readonly board: Board | null
  readonly onScreen: ReadonlyArray<OnScreen>
  /** Every agent cue received, newest first. */
  readonly feed: ReadonlyArray<Cue>
}

export const EMPTY: PaneState = { frame: null, playback: null, board: null, onScreen: [], feed: [] }

/** At most this many agent cues stay in the feed. */
export const FEED_SIZE = 50

const boardOf = (cue: Cue): Board => {
  const d = cue.data
  const mom = d["team.mom.home"] !== undefined && d["team.mom.away"] !== undefined ? { home: d["team.mom.home"]!, away: d["team.mom.away"]! } : null
  return { score: { home: d["score.home"] ?? 0, away: d["score.away"] ?? 0 }, clock: cue.anchor.clock, momentum: mom }
}

export const reduce = (s: PaneState, tick: Tick, now: number): PaneState => {
  switch (tick.kind) {
    case "frame":
      return { ...s, frame: tick.frame }
    case "playback":
      return { ...s, playback: tick.playback }
    case "cue": {
      const cue = tick.cue
      if (cue.display.slot === "top_bar") return { ...s, board: boardOf(cue) }
      // A newer cue in the same slot replaces the one showing there; higher priority (1) first among the rest.
      const onScreen = [...s.onScreen.filter((o) => o.until > now && o.cue.display.slot !== cue.display.slot), { cue, until: now + cue.display.ttl_ms }]
      return { ...s, onScreen, feed: [cue, ...s.feed.filter((c) => c.cue_id !== cue.cue_id)].slice(0, FEED_SIZE) }
    }
  }
}

/** The cue showing in a slot now, if any. */
export const inSlot = (s: PaneState, slot: Cue["display"]["slot"], now: number): Cue | null =>
  s.onScreen.find((o) => o.cue.display.slot === slot && o.until > now)?.cue ?? null
```

Create `apps/web/src/client.ts`:

```ts
/**
 * The app's view of the API: plain promises and callbacks, so components and their tests never touch Effect.
 * `connect` implements it with the Effect RPC client over one WebSocket (the browser's own).
 */
import { BrowserSocket } from "@effect/platform-browser"
import { Effect, Exit, Layer, ManagedRuntime, Scope, Stream } from "effect"
import { RpcClient, RpcSerialization } from "effect/rpc"
import { TouchlineRpcs, type Evidence, type MatchInfo, type MatchSummary, type Playback, type RecapView, type Tick } from "@touchline/rpc"
import type { Segment } from "@touchline/schema"

export interface StartOptions {
  readonly speed: number
  readonly fromMinute: number
  readonly live: boolean
}

export interface TouchlineClient {
  listMatches(): Promise<ReadonlyArray<MatchSummary>>
  startSession(matchId: string, o: StartOptions): Promise<{ readonly session_id: string; readonly match: MatchInfo }>
  /** Calls `onTick` for each tick of the session for `segment`; returns a function that stops watching. */
  watch(sessionId: string, segment: Segment, onTick: (t: Tick) => void, onEnd?: (error: string | null) => void): () => void
  control(sessionId: string, action: "play" | "pause" | "speed", speed?: number): Promise<Playback>
  evidence(matchId: string, cueId: string): Promise<Evidence>
  recap(matchId: string, kind: "half_time" | "full_time", segment: Segment): Promise<RecapView>
  close(): Promise<void>
}

/** The RPC URL for the page's own origin (the dev server forwards /rpc to the API). */
export const defaultUrl = (loc: Location = window.location): string => `${loc.protocol === "https:" ? "wss" : "ws"}://${loc.host}/rpc`

export const connect = async (url: string): Promise<TouchlineClient> => {
  const runtime = ManagedRuntime.make(
    RpcClient.layerProtocolSocket({ retryTransientErrors: true }).pipe(Layer.provide(BrowserSocket.layerWebSocket(url)), Layer.provide(RpcSerialization.layerJson))
  )
  const scope = await runtime.runPromise(Scope.make())
  const client = await runtime.runPromise(RpcClient.make(TouchlineRpcs).pipe(Scope.provide(scope)))
  const call = <A>(e: Effect.Effect<A, unknown>) => runtime.runPromise(e)
  return {
    listMatches: () => call(client.ListMatches()),
    startSession: (match_id, o) => call(client.StartSession({ match_id, speed: o.speed, from_minute: o.fromMinute, live: o.live })),
    watch: (session_id, segment, onTick, onEnd) => {
      const fiber = runtime.runFork(
        Stream.runForEach(client.Watch({ session_id, segment }), (t) => Effect.sync(() => onTick(t))).pipe(
          Effect.matchCause({ onSuccess: () => onEnd?.(null), onFailure: (c) => onEnd?.(String(c)) })
        )
      )
      return () => fiber.interruptUnsafe()
    },
    control: (session_id, action, speed) => call(client.Control({ session_id, action, speed: speed ?? null })),
    evidence: (match_id, cue_id) => call(client.GetEvidence({ match_id, cue_id })),
    recap: (match_id, kind, segment) => call(client.GetRecap({ match_id, kind, segment })),
    close: async () => {
      await runtime.runPromise(Scope.close(scope, Exit.void))
      await runtime.dispose()
    }
  }
}
```

- [ ] **Step 5: Write the first screen**

Create `apps/web/src/MatchList.tsx`:

```text
import type { MatchSummary } from "@touchline/rpc"
import { t, type Lang } from "./i18n.js"

/** The library: one card per match, with its teams in their kit colours and whether it has agent cues. */
export const MatchList = ({ matches, lang, onWatch }: { matches: ReadonlyArray<MatchSummary>; lang: Lang; onWatch: (m: MatchSummary) => void }) => {
  if (!matches.length) return <p className="text-slate-400">{t(lang, "noMatches")}</p>
  return (
    <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {matches.map((m) => (
        <li key={m.match_id} className="rounded-xl bg-slate-900 p-4 ring-1 ring-slate-800">
          <div className="flex items-center justify-between gap-2 text-lg font-semibold">
            <span className="flex items-center gap-2"><span className="inline-block h-3 w-3 rounded-full" style={{ background: m.home.kit.primary }} />{m.home.name}</span>
            <span className="tabular-nums">{m.score.home}–{m.score.away}</span>
            <span className="flex items-center gap-2">{m.away.name}<span className="inline-block h-3 w-3 rounded-full" style={{ background: m.away.kit.primary }} /></span>
          </div>
          <div className="mt-2 flex items-center justify-between text-sm text-slate-400">
            <span>{m.scenario ?? "—"} · {m.model ?? t(lang, "stats")}</span>
            <button type="button" className="rounded-lg bg-emerald-600 px-3 py-1 font-medium text-white hover:bg-emerald-500" onClick={() => onWatch(m)}>{t(lang, "watch")}</button>
          </div>
        </li>
      ))}
    </ul>
  )
}
```

Create `apps/web/src/App.tsx`:

```text
import { useEffect, useState } from "react"
import type { MatchSummary } from "@touchline/rpc"
import type { TouchlineClient } from "./client.js"
import { LANG_NAMES, t, type Lang } from "./i18n.js"
import { MatchList } from "./MatchList.js"

/** The fan app: pick a match from the library, then watch it (Task 10 on). */
export const App = ({ client }: { client: TouchlineClient }) => {
  const [lang, setLang] = useState<Lang>("en")
  const [matches, setMatches] = useState<ReadonlyArray<MatchSummary> | null>(null)
  useEffect(() => {
    client.listMatches().then(setMatches, () => setMatches([]))
  }, [client])
  return (
    <main className="mx-auto max-w-6xl p-6 font-sans">
      <header className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">{t(lang, "title")}</h1>
          <p className="text-slate-400">{t(lang, "tagline")}</p>
        </div>
        <label className="text-sm">
          <span className="sr-only">{t(lang, "language")}</span>
          <select aria-label={t(lang, "language")} className="rounded bg-slate-800 px-2 py-1" value={lang} onChange={(e) => setLang(e.target.value as Lang)}>
            {(Object.keys(LANG_NAMES) as Lang[]).map((l) => <option key={l} value={l}>{LANG_NAMES[l]}</option>)}
          </select>
        </label>
      </header>
      <h2 className="mb-3 text-lg font-semibold">{t(lang, "matches")}</h2>
      {matches === null ? <p>{t(lang, "loading")}</p> : <MatchList matches={matches} lang={lang} onWatch={() => {}} />}
    </main>
  )
}
```

Create `apps/web/src/main.tsx`:

```text
import { StrictMode } from "react"
import { createRoot } from "react-dom/client"
import { App } from "./App.js"
import { connect, defaultUrl } from "./client.js"
import "./index.css"

const root = createRoot(document.getElementById("root")!)
connect(defaultUrl()).then(
  (client) => root.render(<StrictMode><App client={client} /></StrictMode>),
  (e) => root.render(<p className="p-8 text-red-300">Cannot reach the API at {defaultUrl()}: {String(e)}. Start it with pnpm api.</p>)
)
```

- [ ] **Step 6: Run the tests and build**

Run: `pnpm --filter @touchline/web test && pnpm --filter @touchline/web typecheck && pnpm --filter @touchline/web build && rm -rf apps/web/dist`
Expected: 9 passed, no type errors, a production build of about 370 kB of JavaScript

- [ ] **Step 7: Commit**

```bash
git add apps/web .gitignore package.json pnpm-lock.yaml
git commit -m "feat(web): fan app scaffold — Vite, React, Tailwind; EN/ES/HI strings, profiles to segments, pane state, browser RPC client tested against the API

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```



### Task 10: Watching a match: pitch, scoreboard, controls

The watch screen (spec §5.6 "2D pitch on canvas, replaying the simulated match"):
- **Drawing** (`draw.ts`): a pure function that draws the pitch markings (105 × 68 m), every player in their kit colour and the ball, bigger when it is in the air. Tests check it with a context that records the calls; jsdom has no canvas, so `test/setup.ts` stubs `getContext`.
- **Components:** `Pitch` draws each frame on a canvas. `TopBar` shows the score, clock and momentum from the scoreboard cues. `usePane` watches the session for the segment and reduces the ticks.
- **Watch screen:** shared controls (play, pause, speed ×1–×32, back to the list).
- **Starting:** the match list gains the live-agents and start-minute options, and Watch starts a session at ×4.

The drawing module is `draw.ts`, not `pitch.ts`: on case-insensitive disks it would clash with `Pitch.tsx` when imported as `./Pitch.js`.

**Files:**
- Create: `apps/web/src/draw.ts`, `apps/web/src/Pitch.tsx`, `apps/web/src/TopBar.tsx`, `apps/web/src/usePane.ts`, `apps/web/src/Watch.tsx`
- Modify: `apps/web/src/App.tsx`, `apps/web/test/setup.ts`
- Test: `apps/web/test/draw.test.ts`, `apps/web/test/watch.test.tsx`

**Interfaces:**
- Consumes: `TouchlineClient`, `reduce`, `EMPTY`, `PaneState`, `Board`, `t` (Task 9), `PitchFrame`, `MatchInfo`, `Playback` (Task 1).
- Produces:
  - `draw.ts`: `LENGTH`, `WIDTH`, `Size`, `Kits`, `toPx(size, x, y)`, `drawMarkings(ctx, size)`, `drawFrame(ctx, size, frame, kits)`.
  - Components and hooks: `Pitch({frame, kits, label})`, `TopBar({match, board, lang})`, `usePane(client, sessionId, segment)`, `SPEEDS`, `Pane`, `Watch`. Task 11 changes the props of `Pane` and `Watch` to a profile.

- [ ] **Step 1: Write the failing tests**

Create `apps/web/test/draw.test.ts`:

```ts
import { describe, expect, it } from "vitest"
import type { PitchFrame } from "@touchline/rpc"
import { drawFrame, toPx } from "../src/draw.js"

/** A 2D context that records what is drawn, in which colour. */
const recorder = () => {
  const dots: Array<{ x: number; y: number; r: number; colour: string }> = []
  const ctx = {
    fillStyle: "" as unknown, strokeStyle: "" as unknown, lineWidth: 1,
    fillRect: () => {}, strokeRect: () => {}, beginPath: () => {}, moveTo: () => {}, lineTo: () => {}, stroke: () => {},
    arc(x: number, y: number, r: number) { last = { x, y, r } },
    fill() { if (last) dots.push({ ...last, colour: String(ctx.fillStyle) }); last = null }
  }
  let last: { x: number; y: number; r: number } | null = null
  return { ctx: ctx as unknown as Parameters<typeof drawFrame>[0], dots }
}

const frame = (ballZ = 0): PitchFrame => ({
  frame: 1, period: "first_half", clock: "00:00.10", ball: { x: 0, y: 0, z: ballZ },
  home: Array.from({ length: 11 }, (_, i) => ({ id: `h${i}`, x: -40 + i * 3, y: i - 5 })),
  away: Array.from({ length: 11 }, (_, i) => ({ id: `a${i}`, x: 40 - i * 3, y: 5 - i }))
})

describe("pitch drawing", () => {
  it("maps the pitch's corners and centre to the canvas", () => {
    const size = { w: 1050, h: 680 }
    expect(toPx(size, -52.5, 34)).toEqual([0, 0])
    expect(toPx(size, 52.5, -34)).toEqual([1050, 680])
    expect(toPx(size, 0, 0)).toEqual([525, 340])
  })

  it("draws every player in their kit colour, then the ball, bigger in the air", () => {
    const { ctx, dots } = recorder()
    drawFrame(ctx, { w: 1050, h: 680 }, frame(), { home: "#1d4ed8", away: "#dc2626" })
    expect(dots.filter((d) => d.colour === "#1d4ed8")).toHaveLength(11)
    expect(dots.filter((d) => d.colour === "#dc2626")).toHaveLength(11)
    const ball = dots.at(-1)!
    expect([ball.colour, ball.x, ball.y]).toEqual(["#ffffff", 525, 340])
    const high = recorder()
    drawFrame(high.ctx, { w: 1050, h: 680 }, frame(3), { home: "#1d4ed8", away: "#dc2626" })
    expect(high.dots.at(-1)!.r).toBeGreaterThan(ball.r)
  })

  it("draws only the markings before the first frame", () => {
    const { ctx, dots } = recorder()
    drawFrame(ctx, { w: 1050, h: 680 }, null, { home: "#000", away: "#fff" })
    expect(dots).toEqual([])
  })
})
```

Create `apps/web/test/watch.test.tsx`:

```text
import { act, render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { describe, expect, it } from "vitest"
import type { Cue } from "@touchline/schema"
import { App } from "../src/App.js"
import { fakeClient } from "./fake-client.js"

const board = (home: number, away: number, clock: string): Cue => ({
  cue_id: `b-${clock}`, schema: "touchline.cue/1", match_id: "m", moment_id: null, anchor: { frame_from: 0, frame_to: 0, clock },
  display: { slot: "top_bar", priority: 3, ttl_ms: 2000, template: "scoreboard" }, segment: { mode: "casual", lang: "en", club: null },
  text: null, data: { "score.home": home, "score.away": away, "team.mom.home": 0.62, "team.mom.away": 0.38 }, evidence: [], verified: true
})

describe("watching a match", () => {
  it("starts a session with the chosen options and shows the scoreboard as it plays", async () => {
    const client = fakeClient()
    render(<App client={client} />)
    await userEvent.click(await screen.findByLabelText("Live agents"))
    await userEvent.clear(screen.getByLabelText("From minute"))
    await userEvent.type(screen.getByLabelText("From minute"), "60")
    await userEvent.click(screen.getByRole("button", { name: "Watch" }))
    expect(client.calls).toEqual(["start lib-costly_error-1 x4 live=true"])
    await screen.findByRole("img", { name: "Northwick Mariners – Larkspur City" })
    expect(client.watchers.map((w) => w.segment)).toEqual([{ mode: "casual", lang: "en", club: null }])
    act(() => client.push({ kind: "cue", cue: board(1, 0, "61:30") }))
    expect(screen.getByTestId("score").textContent).toBe("1–0")
    expect(screen.getByTestId("clock").textContent).toBe("61:30")
    expect(screen.getByTitle("Momentum").textContent).toBe("62%")
  })

  it("pauses, resumes and changes speed for the session, and goes back to the list", async () => {
    const client = fakeClient()
    render(<App client={client} />)
    await userEvent.click(await screen.findByRole("button", { name: "Watch" }))
    await userEvent.click(await screen.findByRole("button", { name: "Pause" }))
    await userEvent.click(await screen.findByRole("button", { name: "Play" }))
    await userEvent.selectOptions(screen.getByLabelText("Speed"), "16")
    expect(client.calls.slice(1)).toEqual(["control pause", "control play", "control speed 16"])
    act(() => client.push({ kind: "playback", playback: { state: "ended", frame: 58000, speed: 16, live: false } }))
    expect(screen.getByText("Full-time")).toBeTruthy()
    await userEvent.click(screen.getByRole("button", { name: /Back to matches/ }))
    expect(client.watchers).toEqual([])
    expect(await screen.findByRole("listitem")).toBeTruthy()
  })
})
```

Apply this change to `apps/web/test/setup.ts` (from the repository root):

```bash
git apply <<'PATCH'
diff --git a/apps/web/test/setup.ts b/apps/web/test/setup.ts
index e65f8de..3d96e79 100644
--- a/apps/web/test/setup.ts
+++ b/apps/web/test/setup.ts
@@ -3,3 +3,6 @@ import { afterEach } from "vitest"
 
 // Unmount what each test rendered (Testing Library cleans up by itself only with vitest globals).
 afterEach(cleanup)
+
+// jsdom has no canvas: components get no 2D context (drawing is tested with a recording context, test/draw.test.ts).
+if (typeof HTMLCanvasElement !== "undefined") HTMLCanvasElement.prototype.getContext = (() => null) as never
PATCH
```

- [ ] **Step 2: Run them to make sure they fail**

Run: `pnpm --filter @touchline/web test draw watch`
Expected: `draw.test.ts` fails to load (no `../src/draw.js`), and both watch tests fail: Watch does not start a session yet, so there is no pitch and no controls to find

- [ ] **Step 3: Write the pitch and the watch screen**

Create `apps/web/src/draw.ts`:

```ts
/**
 * Drawing the 2D pitch (spec §5.6) on a canvas: 105 × 68 m, x along the length (home attacks +x in the first half),
 * y across. Pure: everything goes through the 2D context it is given, so tests can record the calls.
 */
import type { PitchFrame } from "@touchline/rpc"

export const LENGTH = 105
export const WIDTH = 68

export interface Size {
  readonly w: number
  readonly h: number
}

export interface Kits {
  readonly home: string
  readonly away: string
}

/** Pitch metres to canvas pixels (y up on the pitch is up on the screen). */
export const toPx = (size: Size, x: number, y: number): [number, number] => [((x + LENGTH / 2) / LENGTH) * size.w, ((WIDTH / 2 - y) / WIDTH) * size.h]

type Ctx = Pick<CanvasRenderingContext2D, "fillRect" | "strokeRect" | "beginPath" | "arc" | "moveTo" | "lineTo" | "stroke" | "fill"> & {
  fillStyle: CanvasRenderingContext2D["fillStyle"]
  strokeStyle: CanvasRenderingContext2D["strokeStyle"]
  lineWidth: number
}

const PITCH = "#1f6b3a"
const LINE = "#e8f5ec"
const BALL = "#ffffff"

const box = (ctx: Ctx, size: Size, x0: number, x1: number, halfW: number) => {
  const [a, b] = toPx(size, x0, halfW)
  const [c, d] = toPx(size, x1, -halfW)
  ctx.strokeRect(Math.min(a, c), b, Math.abs(c - a), d - b)
}

/** The markings: touchlines, halfway line, centre circle, penalty and goal areas. */
export const drawMarkings = (ctx: Ctx, size: Size) => {
  ctx.fillStyle = PITCH
  ctx.fillRect(0, 0, size.w, size.h)
  ctx.strokeStyle = LINE
  ctx.lineWidth = Math.max(1, size.w / 500)
  ctx.strokeRect(0, 0, size.w, size.h)
  const [mx] = toPx(size, 0, 0)
  ctx.beginPath()
  ctx.moveTo(mx, 0)
  ctx.lineTo(mx, size.h)
  ctx.stroke()
  ctx.beginPath()
  ctx.arc(mx, size.h / 2, (9.15 / LENGTH) * size.w, 0, Math.PI * 2)
  ctx.stroke()
  for (const s of [-1, 1]) {
    box(ctx, size, s * (LENGTH / 2), s * (LENGTH / 2 - 16.5), 20.16)
    box(ctx, size, s * (LENGTH / 2), s * (LENGTH / 2 - 5.5), 9.16)
  }
}

/** The pitch with the frame's players in their kit colours and the ball (bigger when it is in the air). */
export const drawFrame = (ctx: Ctx, size: Size, frame: PitchFrame | null, kits: Kits) => {
  drawMarkings(ctx, size)
  if (!frame) return
  const r = (0.9 / LENGTH) * size.w
  for (const [side, colour] of [["home", kits.home], ["away", kits.away]] as const) {
    ctx.fillStyle = colour
    for (const p of frame[side]) {
      const [x, y] = toPx(size, p.x, p.y)
      ctx.beginPath()
      ctx.arc(x, y, r, 0, Math.PI * 2)
      ctx.fill()
    }
  }
  const [bx, by] = toPx(size, frame.ball.x, frame.ball.y)
  ctx.fillStyle = BALL
  ctx.beginPath()
  ctx.arc(bx, by, r * (0.5 + Math.min(1, frame.ball.z / 3) * 0.5), 0, Math.PI * 2)
  ctx.fill()
}
```

Create `apps/web/src/Pitch.tsx`:

```text
import { useEffect, useRef } from "react"
import type { PitchFrame } from "@touchline/rpc"
import { drawFrame, type Kits } from "./draw.js"

const W = 1050
const H = 680

/** The match on a canvas, redrawn on every frame. */
export const Pitch = ({ frame, kits, label }: { frame: PitchFrame | null; kits: Kits; label: string }) => {
  const ref = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    const ctx = ref.current?.getContext("2d")
    if (ctx) drawFrame(ctx, { w: W, h: H }, frame, kits)
  }, [frame, kits])
  return <canvas ref={ref} width={W} height={H} role="img" aria-label={label} className="aspect-[105/68] w-full rounded-lg" />
}
```

Create `apps/web/src/TopBar.tsx`:

```text
import type { MatchInfo } from "@touchline/rpc"
import { t, type Lang } from "./i18n.js"
import type { Board } from "./pane.js"

/** Score, clock and momentum (the top bar slot of spec §5.4, from the hot path's scoreboard cues). */
export const TopBar = ({ match, board, lang }: { match: MatchInfo; board: Board | null; lang: Lang }) => (
  <div className="flex items-center justify-between rounded-lg bg-slate-900 px-4 py-2 ring-1 ring-slate-800" data-testid="top-bar">
    <span className="font-semibold">{match.home.short}</span>
    <span className="text-xl font-bold tabular-nums" data-testid="score">{board ? `${board.score.home}–${board.score.away}` : "0–0"}</span>
    <span className="font-semibold">{match.away.short}</span>
    <span className="tabular-nums text-slate-300" data-testid="clock">{board?.clock ?? "00:00"}</span>
    {board?.momentum && (
      <span className="flex w-40 items-center gap-2 text-xs text-slate-400" title={t(lang, "momentum")}>
        <span className="h-2 flex-1 overflow-hidden rounded bg-slate-700">
          <span className="block h-full" style={{ width: `${Math.round(board.momentum.home * 100)}%`, background: match.home.kit.primary }} />
        </span>
        {Math.round(board.momentum.home * 100)}%
      </span>
    )}
  </div>
)
```

Create `apps/web/src/usePane.ts`:

```ts
import { useEffect, useReducer } from "react"
import type { Tick } from "@touchline/rpc"
import type { Segment } from "@touchline/schema"
import type { TouchlineClient } from "./client.js"
import { EMPTY, reduce, type PaneState } from "./pane.js"

/** A pane's state for one segment of a session, updated by every tick. */
export const usePane = (client: TouchlineClient, sessionId: string, segment: Segment): PaneState => {
  const [state, dispatch] = useReducer((s: PaneState, t: Tick) => reduce(s, t, Date.now()), EMPTY)
  const key = `${segment.mode}.${segment.lang}.${segment.club ?? ""}`
  useEffect(() => client.watch(sessionId, segment, dispatch), [client, sessionId, key])
  return state
}
```

Create `apps/web/src/Watch.tsx`:

```text
import { useState } from "react"
import type { MatchInfo, Playback } from "@touchline/rpc"
import type { Segment } from "@touchline/schema"
import type { TouchlineClient } from "./client.js"
import { t, type Lang } from "./i18n.js"
import { Pitch } from "./Pitch.js"
import { TopBar } from "./TopBar.js"
import { usePane } from "./usePane.js"

export const SPEEDS = [1, 2, 4, 8, 16, 32]

/** One segment's view of a session: scoreboard and pitch. */
export const Pane = ({ client, sessionId, match, segment, lang }: { client: TouchlineClient; sessionId: string; match: MatchInfo; segment: Segment; lang: Lang }) => {
  const pane = usePane(client, sessionId, segment)
  return (
    <section className="flex flex-col gap-2">
      <TopBar match={match} board={pane.board} lang={lang} />
      <Pitch frame={pane.frame} kits={{ home: match.home.kit.primary, away: match.away.kit.primary }} label={`${match.home.name} – ${match.away.name}`} />
      {pane.playback?.state === "ended" && <p className="text-center font-semibold">{t(lang, "ended")}</p>}
    </section>
  )
}

/** Watching a session: the pane and the playback controls (shared by everyone watching it). */
export const Watch = ({ client, sessionId, match, segment, lang, onBack }: { client: TouchlineClient; sessionId: string; match: MatchInfo; segment: Segment; lang: Lang; onBack: () => void }) => {
  const [playback, setPlayback] = useState<Pick<Playback, "state" | "speed">>({ state: "playing", speed: 4 })
  const control = (action: "play" | "pause" | "speed", speed?: number) => client.control(sessionId, action, speed).then(setPlayback)
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" className="rounded bg-slate-800 px-3 py-1" onClick={onBack}>← {t(lang, "back")}</button>
        <button type="button" className="rounded bg-emerald-600 px-3 py-1 text-white" onClick={() => control(playback.state === "paused" ? "play" : "pause")}>
          {playback.state === "paused" ? t(lang, "play") : t(lang, "pause")}
        </button>
        <label className="text-sm">
          {t(lang, "speed")}{" "}
          <select aria-label={t(lang, "speed")} className="rounded bg-slate-800 px-2 py-1" value={playback.speed} onChange={(e) => control("speed", Number(e.target.value))}>
            {SPEEDS.map((s) => <option key={s} value={s}>×{s}</option>)}
          </select>
        </label>
      </div>
      <Pane client={client} sessionId={sessionId} match={match} segment={segment} lang={lang} />
    </div>
  )
}
```

Apply this change to `apps/web/src/App.tsx` (from the repository root):

```bash
git apply <<'PATCH'
diff --git a/apps/web/src/App.tsx b/apps/web/src/App.tsx
index f916192..492ff6e 100644
--- a/apps/web/src/App.tsx
+++ b/apps/web/src/App.tsx
@@ -1,13 +1,19 @@
 import { useEffect, useState } from "react"
-import type { MatchSummary } from "@touchline/rpc"
+import type { MatchInfo, MatchSummary } from "@touchline/rpc"
 import type { TouchlineClient } from "./client.js"
 import { LANG_NAMES, t, type Lang } from "./i18n.js"
 import { MatchList } from "./MatchList.js"
+import { Watch } from "./Watch.js"
 
-/** The fan app: pick a match from the library, then watch it (Task 10 on). */
+/** The fan app: pick a match from the library, then watch it. */
 export const App = ({ client }: { client: TouchlineClient }) => {
   const [lang, setLang] = useState<Lang>("en")
   const [matches, setMatches] = useState<ReadonlyArray<MatchSummary> | null>(null)
+  const [live, setLive] = useState(false)
+  const [fromMinute, setFromMinute] = useState(0)
+  const [session, setSession] = useState<{ id: string; match: MatchInfo } | null>(null)
+  const watch = (m: MatchSummary) =>
+    client.startSession(m.match_id, { speed: 4, fromMinute, live }).then((s) => setSession({ id: s.session_id, match: s.match }))
   useEffect(() => {
     client.listMatches().then(setMatches, () => setMatches([]))
   }, [client])
@@ -25,8 +31,24 @@ export const App = ({ client }: { client: TouchlineClient }) => {
           </select>
         </label>
       </header>
-      <h2 className="mb-3 text-lg font-semibold">{t(lang, "matches")}</h2>
-      {matches === null ? <p>{t(lang, "loading")}</p> : <MatchList matches={matches} lang={lang} onWatch={() => {}} />}
+      {session ? (
+        <Watch client={client} sessionId={session.id} match={session.match} segment={{ mode: "casual", lang, club: null }} lang={lang} onBack={() => setSession(null)} />
+      ) : (
+        <>
+          <div className="mb-3 flex flex-wrap items-center gap-4">
+            <h2 className="text-lg font-semibold">{t(lang, "matches")}</h2>
+            <label className="text-sm">
+              <input type="checkbox" className="mr-1" checked={live} onChange={(e) => setLive(e.target.checked)} />
+              {t(lang, "live")}
+            </label>
+            <label className="text-sm">
+              {t(lang, "fromMinute")}{" "}
+              <input type="number" min={0} max={90} aria-label={t(lang, "fromMinute")} className="w-16 rounded bg-slate-800 px-2 py-1" value={fromMinute} onChange={(e) => setFromMinute(Number(e.target.value))} />
+            </label>
+          </div>
+          {matches === null ? <p>{t(lang, "loading")}</p> : <MatchList matches={matches} lang={lang} onWatch={watch} />}
+        </>
+      )}
     </main>
   )
 }
PATCH
```

- [ ] **Step 4: Run the tests**

Run: `pnpm --filter @touchline/web test && pnpm --filter @touchline/web typecheck`
Expected: 14 passed, no type errors

- [ ] **Step 5: Commit**

```bash
git add apps/web
git commit -m "feat(web): watch a session — 2D pitch on canvas in kit colours, scoreboard top bar with momentum, play/pause/speed, live and start-minute options

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```



### Task 11: Overlays and profiles

Cues go on the pitch in their slots (spec §5.4):
- **Lower third:** casual cues, priority 1 highlighted.
- **Side panel:** analyst cues, with their numbers, the evidence count and a "Why?" button.
- **Recap card:** recaps.

Each cue shows a verified badge and carries its `lang` attribute (for fonts and screen readers). It shows until its ttl runs out; `useNow` refreshes every 250 ms, so cues leave even while the match is paused.

The profile switcher and builder (spec §5.6) offer ready-made profiles plus mode, language and club. Changing the profile re-watches the session for the new segment. The profile's language is also the interface language, set from the header before a match.

**Files:**
- Create: `apps/web/src/Overlays.tsx`, `apps/web/src/ProfileBar.tsx`
- Modify: `apps/web/src/Watch.tsx`, `apps/web/src/App.tsx`
- Test: `apps/web/test/overlays.test.tsx`

**Interfaces:**
- Consumes: `inSlot`, `PaneState`, `Profile`, `segmentOf`, `PRESETS`, `presetProfile`, `LANG_NAMES` (Task 9), `Pane`, `Watch` (Task 10).
- Produces: `useNow(everyMs = 250)`, `Overlays({state, now, lang, onWhy?})` (elements `[data-slot=lower_third|side_panel|recap_card]`), `ProfileBar({match, profile, onChange, label?})`; `Pane` and `Watch` take `profile` and `onProfile` (and `onWhy?`) instead of `segment` and `lang`.

- [ ] **Step 1: Write the failing tests**

Create `apps/web/test/overlays.test.tsx`:

```text
import { act, render, screen, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { describe, expect, it, vi } from "vitest"
import type { Cue } from "@touchline/schema"
import { App } from "../src/App.js"
import { Overlays } from "../src/Overlays.js"
import { EMPTY, reduce } from "../src/pane.js"
import { fakeClient } from "./fake-client.js"

const cue = (over: Partial<Cue> & { slot: Cue["display"]["slot"]; seg: Cue["segment"] }): Cue => ({
  cue_id: `c-${over.slot}-${over.seg.mode}.${over.seg.lang}`, schema: "touchline.cue/1", match_id: "m", moment_id: "mo-1",
  anchor: { frame_from: 100, frame_to: 120, clock: "12:00" }, display: { slot: over.slot, priority: 1, ttl_ms: 8000, template: "goal" },
  segment: over.seg, text: over.text ?? { headline: "Goal for Larkspur City!", body: "A clinical finish." },
  data: over.data ?? { "shot.xg": 0.068 }, evidence: ["m-e10", "shot.xg@m-e10"], verified: true
})

describe("overlays", () => {
  it("put casual cues in the lower third, analyst cues in the side panel, recaps on a card, each in its language", async () => {
    const onWhy = vi.fn()
    let s = reduce(EMPTY, { kind: "cue", cue: cue({ slot: "lower_third", seg: { mode: "casual", lang: "hi", club: null }, text: { headline: "लार्कस्पर सिटी का गोल!", body: "शानदार फिनिश।" } }) }, 0)
    s = reduce(s, { kind: "cue", cue: cue({ slot: "side_panel", seg: { mode: "analyst", lang: "en", club: null } }) }, 0)
    s = reduce(s, { kind: "cue", cue: cue({ slot: "recap_card", seg: { mode: "casual", lang: "en", club: null }, text: { headline: "Half-time: Northwick v Larkspur", body: "Score: 0-1." } }) }, 0)
    const { container } = render(<Overlays state={s} now={1000} lang="en" onWhy={onWhy} />)
    const lower = container.querySelector('[data-slot="lower_third"]')!
    expect(lower.getAttribute("lang")).toBe("hi")
    expect(lower.textContent).toContain("लार्कस्पर सिटी का गोल!")
    const side = container.querySelector('[data-slot="side_panel"]') as HTMLElement
    expect(within(side).getByText("shot.xg")).toBeTruthy()
    expect(within(side).getByText("0.068")).toBeTruthy()
    await userEvent.click(within(side).getByRole("button", { name: "Why?" }))
    expect(onWhy).toHaveBeenCalledWith(expect.objectContaining({ cue_id: "c-side_panel-analyst.en" }))
    expect(container.querySelector('[data-slot="recap_card"]')!.textContent).toContain("Half-time")
    expect(screen.getAllByTitle("Verified against the match data")).toHaveLength(3)
  })

  it("take a cue off the screen when its ttl runs out", () => {
    const s = reduce(EMPTY, { kind: "cue", cue: cue({ slot: "lower_third", seg: { mode: "casual", lang: "en", club: null } }) }, 0)
    const { container, rerender } = render(<Overlays state={s} now={7999} lang="en" />)
    expect(container.querySelector('[data-slot="lower_third"]')).not.toBeNull()
    rerender(<Overlays state={s} now={8000} lang="en" />)
    expect(container.querySelector('[data-slot="lower_third"]')).toBeNull()
  })
})

describe("profiles while watching", () => {
  it("re-watch the session for the new segment and switch the interface language", async () => {
    const client = fakeClient()
    render(<App client={client} />)
    await userEvent.click(await screen.findByRole("button", { name: "Watch" }))
    await userEvent.selectOptions(await screen.findByLabelText("Profile"), "analyst-es")
    expect(client.watchers.map((w) => w.segment)).toEqual([{ mode: "analyst", lang: "es", club: null }])
    expect(screen.getByRole("button", { name: "Pausa" })).toBeTruthy()
    await userEvent.selectOptions(screen.getByLabelText("Club"), "northwick")
    expect(client.watchers.map((w) => w.segment)).toEqual([{ mode: "analyst", lang: "es", club: "northwick" }])
    act(() => client.push({ kind: "cue", cue: cue({ slot: "side_panel", seg: { mode: "analyst", lang: "es", club: "northwick" }, text: { headline: "Golpe para Northwick", body: "Un remate certero." } }) }))
    expect(screen.getByText("Golpe para Northwick")).toBeTruthy()
  })
})
```

- [ ] **Step 2: Run them to make sure they fail**

Run: `pnpm --filter @touchline/web test overlays`
Expected: the file fails to load: `Failed to resolve import "../src/Overlays.js"`

- [ ] **Step 3: Write the overlays and the profile bar**

Create `apps/web/src/Overlays.tsx`:

```text
import { useEffect, useState } from "react"
import type { Cue } from "@touchline/schema"
import { t, type Lang } from "./i18n.js"
import { inSlot, type PaneState } from "./pane.js"

/** Wall-clock time, refreshed often enough for cues to leave the screen when their ttl runs out (even when paused). */
export const useNow = (everyMs = 250): number => {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), everyMs)
    return () => clearInterval(id)
  }, [everyMs])
  return now
}

const Verified = ({ lang }: { lang: Lang }) => <span className="ml-2 rounded bg-emerald-700/60 px-1.5 text-xs font-medium" title={t(lang, "verified")}>✓</span>

const numbers = (cue: Cue) => Object.entries(cue.data).filter(([k]) => !k.startsWith("score."))

/** The cues on screen for this pane, over the pitch (spec §5.4 slots). */
export const Overlays = ({ state, now, lang, onWhy }: { state: PaneState; now: number; lang: Lang; onWhy?: (cue: Cue) => void }) => {
  const lower = inSlot(state, "lower_third", now)
  const side = inSlot(state, "side_panel", now)
  const recap = inSlot(state, "recap_card", now)
  const why = (cue: Cue) =>
    onWhy && (
      <button type="button" className="ml-auto rounded bg-slate-700 px-2 py-0.5 text-xs hover:bg-slate-600" onClick={() => onWhy(cue)}>
        {t(lang, "why")}
      </button>
    )
  return (
    <div className="pointer-events-none absolute inset-0 flex flex-col justify-end p-3">
      {recap?.text && (
        <article data-slot="recap_card" lang={recap.segment.lang} className="pointer-events-auto mx-auto mb-auto mt-6 max-w-md rounded-xl bg-slate-900/95 p-4 ring-1 ring-amber-400/60">
          <h3 className="flex items-center font-bold text-amber-300">{recap.text.headline}<Verified lang={lang} />{why(recap)}</h3>
          <p className="mt-1 text-sm">{recap.text.body}</p>
        </article>
      )}
      {side?.text && (
        <aside data-slot="side_panel" lang={side.segment.lang} className="pointer-events-auto absolute right-3 top-3 w-72 rounded-xl bg-slate-900/95 p-3 ring-1 ring-sky-400/50">
          <h3 className="flex items-center font-semibold">{side.text.headline}<Verified lang={lang} />{why(side)}</h3>
          <p className="mt-1 text-sm text-slate-200">{side.text.body}</p>
          {numbers(side).length > 0 && (
            <dl className="mt-2 grid grid-cols-2 gap-1 text-xs">
              {numbers(side).map(([k, v]) => (
                <div key={k} className="contents"><dt className="text-slate-400">{k}</dt><dd className="text-right tabular-nums">{Math.round(v * 1000) / 1000}</dd></div>
              ))}
            </dl>
          )}
          <p className="mt-2 text-xs text-slate-400">{side.evidence.length} · {t(lang, "events")}</p>
        </aside>
      )}
      {lower?.text && (
        <article data-slot="lower_third" lang={lower.segment.lang} className={`pointer-events-auto rounded-xl p-3 ring-1 ${lower.display.priority === 1 ? "bg-emerald-800/95 ring-emerald-300" : "bg-slate-900/95 ring-slate-600"}`}>
          <h3 className="flex items-center text-lg font-bold">{lower.text.headline}<Verified lang={lang} />{why(lower)}</h3>
          <p className="text-sm">{lower.text.body}</p>
        </article>
      )}
    </div>
  )
}
```

Create `apps/web/src/ProfileBar.tsx`:

```text
import type { MatchInfo } from "@touchline/rpc"
import { LANG_NAMES, t, type Lang } from "./i18n.js"
import { presetProfile, PRESETS, type Profile } from "./profile.js"

const presetLabel = (id: string, match: MatchInfo, lang: Lang) => {
  const p = PRESETS.find((x) => x.id === id)!
  const club = p.club === "home" ? ` · ${match.home.name}` : p.club === "away" ? ` · ${match.away.name}` : ""
  return `${t(lang, p.mode)} · ${LANG_NAMES[p.lang]}${club}`
}

/** Pick a profile: a ready-made one, or build your own from mode, language and club (spec §5.6 profile switcher). */
export const ProfileBar = ({ match, profile, onChange, label }: { match: MatchInfo; profile: Profile; onChange: (p: Profile) => void; label?: string }) => {
  const lang = profile.lang
  const club = profile.clubs[0] ?? ""
  return (
    <fieldset className="flex flex-wrap items-center gap-2 text-sm">
      <legend className="sr-only">{label ?? t(lang, "profile")}</legend>
      <select aria-label={`${label ?? t(lang, "profile")}`} className="rounded bg-slate-800 px-2 py-1" value="" onChange={(e) => e.target.value && onChange(presetProfile(e.target.value, match.home.id, match.away.id))}>
        <option value="">{t(lang, "profile")}…</option>
        {PRESETS.map((p) => <option key={p.id} value={p.id}>{presetLabel(p.id, match, lang)}</option>)}
      </select>
      <select aria-label={`${label ?? ""} mode`.trim()} className="rounded bg-slate-800 px-2 py-1" value={profile.mode} onChange={(e) => onChange({ ...profile, mode: e.target.value as Profile["mode"] })}>
        <option value="casual">{t(lang, "casual")}</option>
        <option value="analyst">{t(lang, "analyst")}</option>
      </select>
      <select aria-label={`${label ?? ""} ${t(lang, "language")}`.trim()} className="rounded bg-slate-800 px-2 py-1" value={profile.lang} onChange={(e) => onChange({ ...profile, lang: e.target.value as Lang })}>
        {(Object.keys(LANG_NAMES) as Lang[]).map((l) => <option key={l} value={l}>{LANG_NAMES[l]}</option>)}
      </select>
      <select aria-label={`${label ?? ""} ${t(lang, "club")}`.trim()} className="rounded bg-slate-800 px-2 py-1" value={club} onChange={(e) => onChange({ ...profile, clubs: e.target.value ? [e.target.value] : [] })}>
        <option value="">{t(lang, "neutral")}</option>
        <option value={match.home.id}>{match.home.name}</option>
        <option value={match.away.id}>{match.away.name}</option>
      </select>
    </fieldset>
  )
}
```

Apply this change to `apps/web/src/Watch.tsx`, `apps/web/src/App.tsx` (from the repository root):

```bash
git apply <<'PATCH'
diff --git a/apps/web/src/App.tsx b/apps/web/src/App.tsx
index 492ff6e..850a998 100644
--- a/apps/web/src/App.tsx
+++ b/apps/web/src/App.tsx
@@ -3,11 +3,14 @@ import type { MatchInfo, MatchSummary } from "@touchline/rpc"
 import type { TouchlineClient } from "./client.js"
 import { LANG_NAMES, t, type Lang } from "./i18n.js"
 import { MatchList } from "./MatchList.js"
+import type { Profile } from "./profile.js"
 import { Watch } from "./Watch.js"
 
 /** The fan app: pick a match from the library, then watch it. */
 export const App = ({ client }: { client: TouchlineClient }) => {
-  const [lang, setLang] = useState<Lang>("en")
+  const [profile, setProfile] = useState<Profile>({ mode: "casual", lang: "en", clubs: [] })
+  const lang = profile.lang
+  const setLang = (l: Lang) => setProfile({ ...profile, lang: l })
   const [matches, setMatches] = useState<ReadonlyArray<MatchSummary> | null>(null)
   const [live, setLive] = useState(false)
   const [fromMinute, setFromMinute] = useState(0)
@@ -32,7 +35,7 @@ export const App = ({ client }: { client: TouchlineClient }) => {
         </label>
       </header>
       {session ? (
-        <Watch client={client} sessionId={session.id} match={session.match} segment={{ mode: "casual", lang, club: null }} lang={lang} onBack={() => setSession(null)} />
+        <Watch client={client} sessionId={session.id} match={session.match} profile={profile} onProfile={setProfile} onBack={() => setSession(null)} />
       ) : (
         <>
           <div className="mb-3 flex flex-wrap items-center gap-4">
diff --git a/apps/web/src/Watch.tsx b/apps/web/src/Watch.tsx
index 1ca02e4..99a3344 100644
--- a/apps/web/src/Watch.tsx
+++ b/apps/web/src/Watch.tsx
@@ -1,28 +1,53 @@
 import { useState } from "react"
 import type { MatchInfo, Playback } from "@touchline/rpc"
-import type { Segment } from "@touchline/schema"
+import type { Cue } from "@touchline/schema"
 import type { TouchlineClient } from "./client.js"
 import { t, type Lang } from "./i18n.js"
+import { Overlays, useNow } from "./Overlays.js"
 import { Pitch } from "./Pitch.js"
+import { ProfileBar } from "./ProfileBar.js"
+import { segmentOf, type Profile } from "./profile.js"
 import { TopBar } from "./TopBar.js"
 import { usePane } from "./usePane.js"
 
 export const SPEEDS = [1, 2, 4, 8, 16, 32]
 
-/** One segment's view of a session: scoreboard and pitch. */
-export const Pane = ({ client, sessionId, match, segment, lang }: { client: TouchlineClient; sessionId: string; match: MatchInfo; segment: Segment; lang: Lang }) => {
-  const pane = usePane(client, sessionId, segment)
+/** One profile's view of a session: its profile bar, scoreboard, pitch and the cues for its segment over the pitch. */
+export const Pane = ({ client, sessionId, match, profile, onProfile, onWhy, label }: {
+  client: TouchlineClient
+  sessionId: string
+  match: MatchInfo
+  profile: Profile
+  onProfile: (p: Profile) => void
+  onWhy?: (cue: Cue) => void
+  label?: string
+}) => {
+  const lang = profile.lang
+  const pane = usePane(client, sessionId, segmentOf(profile))
+  const now = useNow()
   return (
-    <section className="flex flex-col gap-2">
+    <section className="flex flex-col gap-2" aria-label={label}>
+      <ProfileBar match={match} profile={profile} onChange={onProfile} {...(label ? { label } : {})} />
       <TopBar match={match} board={pane.board} lang={lang} />
-      <Pitch frame={pane.frame} kits={{ home: match.home.kit.primary, away: match.away.kit.primary }} label={`${match.home.name} – ${match.away.name}`} />
+      <div className="relative">
+        <Pitch frame={pane.frame} kits={{ home: match.home.kit.primary, away: match.away.kit.primary }} label={`${match.home.name} – ${match.away.name}`} />
+        <Overlays state={pane} now={now} lang={lang} {...(onWhy ? { onWhy } : {})} />
+      </div>
       {pane.playback?.state === "ended" && <p className="text-center font-semibold">{t(lang, "ended")}</p>}
     </section>
   )
 }
 
 /** Watching a session: the pane and the playback controls (shared by everyone watching it). */
-export const Watch = ({ client, sessionId, match, segment, lang, onBack }: { client: TouchlineClient; sessionId: string; match: MatchInfo; segment: Segment; lang: Lang; onBack: () => void }) => {
+export const Watch = ({ client, sessionId, match, profile, onProfile, onBack }: {
+  client: TouchlineClient
+  sessionId: string
+  match: MatchInfo
+  profile: Profile
+  onProfile: (p: Profile) => void
+  onBack: () => void
+}) => {
+  const lang: Lang = profile.lang
   const [playback, setPlayback] = useState<Pick<Playback, "state" | "speed">>({ state: "playing", speed: 4 })
   const control = (action: "play" | "pause" | "speed", speed?: number) => client.control(sessionId, action, speed).then(setPlayback)
   return (
@@ -39,7 +64,7 @@ export const Watch = ({ client, sessionId, match, segment, lang, onBack }: { cli
           </select>
         </label>
       </div>
-      <Pane client={client} sessionId={sessionId} match={match} segment={segment} lang={lang} />
+      <Pane client={client} sessionId={sessionId} match={match} profile={profile} onProfile={onProfile} />
     </div>
   )
 }
PATCH
```

- [ ] **Step 4: Run the tests**

Run: `pnpm --filter @touchline/web test && pnpm --filter @touchline/web typecheck`
Expected: 17 passed, no type errors

- [ ] **Step 5: Commit**

```bash
git add apps/web
git commit -m "feat(web): overlays by slot (lower third, analyst side panel, recap card) with verified badges, and a profile switcher and builder that re-watches the session for the new segment

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```



### Task 12: The "Why?" drawer and recaps

**"Why?"** (spec §5.6) opens a drawer from any cue on screen or from the feed of recent cues under the pitch. It shows:
- the cue's text;
- the cause and explanation;
- each checked fact with its subject and value;
- a sparkline of each metric's last five minutes, breaking at gaps;
- the linked events with their qualifiers;
- which model wrote it.

When there is no evidence, it says so. **The recap panel** fetches the half-time or full-time recap and its card for the viewer's segment.

Two earlier tests now scope their queries, because the feed and the recap panel repeat some of the text they looked for.

**Files:**
- Create: `apps/web/src/Sparkline.tsx`, `apps/web/src/WhyDrawer.tsx`, `apps/web/src/RecapPanel.tsx`
- Modify: `apps/web/src/Watch.tsx` (feed, drawer, recap panel), `apps/web/test/overlays.test.tsx`, `apps/web/test/watch.test.tsx`
- Test: `apps/web/test/why.test.tsx`

**Interfaces:**
- Consumes: `TouchlineClient.evidence`, `.recap` (Task 9), `Evidence`, `Series`, `RecapView` (Task 1), `Pane`, `Watch` (Task 11).
- Produces: `linePath(points, w, h)`, `Sparkline({series})`, `WhyDrawer({client, matchId, cue, lang, onClose})` (role `dialog`, named by the localized "Why?"), `RecapPanel({client, matchId, segment, lang})`; the feed (`list` named `feed`).

- [ ] **Step 1: Write the failing tests**

Create `apps/web/test/why.test.tsx`:

```text
import { act, render, screen, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { describe, expect, it } from "vitest"
import type { Evidence } from "@touchline/rpc"
import type { Cue, Recap } from "@touchline/schema"
import { App } from "../src/App.js"
import { linePath } from "../src/Sparkline.js"
import { fakeClient } from "./fake-client.js"

const goal: Cue = {
  cue_id: "mo-g1-casual.en.neutral", schema: "touchline.cue/1", match_id: "lib-costly_error-1", moment_id: "mo-g1",
  anchor: { frame_from: 19280, frame_to: 19344, clock: "32:14" }, display: { slot: "lower_third", priority: 1, ttl_ms: 12000, template: "goal" },
  segment: { mode: "casual", lang: "en", club: null }, text: { headline: "Wylford finishes in style!", body: "A crisp left-footed finish." },
  data: { "shot.xg": 0.068 }, evidence: ["e1442"], verified: true
}
const evidence: Evidence = {
  cue_id: goal.cue_id, moment: null, cause: "unpressured combination and clean finishing", explanation: "Carreda and Wylford exchanged short passes without pressure.",
  claims: [{ kind: "metric", quote: "6.8%", label: "Expected goals", metric_id: "shot.xg", subject: null, subject_name: null, value: 0.0678, at_frame: 19344, event_id: "e1442" }],
  series: [{ metric_id: "team.mom", subject: "larkspur", label: "Momentum — Larkspur City", points: [{ frame: 16344, value: 0.4 }, { frame: 17844, value: null }, { frame: 19344, value: 0.62 }] }],
  events: [{ id: "e1442", type: "shot", clock: "32:13.70", team_id: "larkspur", player: "Feseo Wylford", outcome: "goal", qualifiers: { body_part: "left_foot" } }],
  model: "openai:gpt-6.1-sol"
}

describe("sparkline", () => {
  it("draws through the values, breaking at gaps, scaled to their range", () => {
    expect(linePath([{ frame: 0, value: 0 }, { frame: 1, value: 1 }], 100, 10)).toBe("M0,10 L100,0")
    expect(linePath([{ frame: 0, value: 0.4 }, { frame: 1, value: null }, { frame: 2, value: 0.62 }], 100, 10)).toBe("M0,10 M100,0")
    expect(linePath([{ frame: 0, value: null }], 100, 10)).toBe("")
  })
})

describe("Why? drawer", () => {
  it("opens from a cue on screen with the cause, checked facts, history and events, then closes", async () => {
    const client = fakeClient({ evidence })
    render(<App client={client} />)
    await userEvent.click(await screen.findByRole("button", { name: "Watch" }))
    act(() => client.push({ kind: "cue", cue: goal }))
    const lower = document.querySelector('[data-slot="lower_third"]') as HTMLElement
    await userEvent.click(within(lower).getByRole("button", { name: "Why?" }))
    const drawer = await screen.findByRole("dialog", { name: "Why?" })
    expect(await within(drawer).findByText("unpressured combination and clean finishing")).toBeTruthy()
    expect(within(drawer).getByText("Expected goals")).toBeTruthy()
    expect(within(drawer).getByText("6.8% ✓")).toBeTruthy()
    expect(within(drawer).getByRole("img", { name: "Momentum — Larkspur City" })).toBeTruthy()
    expect(within(drawer).getByText(/shot · Feseo Wylford · goal/)).toBeTruthy()
    expect(within(drawer).getByText(/openai:gpt-6.1-sol/)).toBeTruthy()
    expect(client.calls).toContain(`evidence ${goal.cue_id}`)
    await userEvent.click(within(drawer).getByRole("button", { name: "Close" }))
    expect(screen.queryByRole("dialog")).toBeNull()
  })

  it("also opens from the feed after the cue has left the screen, and says when there is nothing behind it", async () => {
    const client = fakeClient()
    render(<App client={client} />)
    await userEvent.click(await screen.findByRole("button", { name: "Watch" }))
    act(() => client.push({ kind: "cue", cue: { ...goal, display: { ...goal.display, ttl_ms: 1 } } }))
    const feed = await screen.findByRole("list", { name: "feed" })
    await userEvent.click(within(feed).getByRole("button", { name: "Why?" }))
    const drawer = await screen.findByRole("dialog")
    expect(await within(drawer).findByText("—")).toBeTruthy()
  })
})

describe("recaps", () => {
  it("show the half-time recap and its card for the viewer's segment", async () => {
    const recap: Recap = { recap_id: "r-ht", match_id: "m", kind: "half_time", at_frame: 27000, sentences: ["Half-time: Northwick Mariners 0-1 Larkspur City", "Possession: Northwick Mariners 46%, Larkspur City 54%."], claims: [], turning_points: [], player_of_match: null, verified: true }
    const client = fakeClient({ recap: { recap, cards: [{ ...goal, cue_id: "r-ht-card", moment_id: "r-ht", display: { ...goal.display, slot: "recap_card" }, text: { headline: "Half-time: Northwick v Larkspur", body: "Score: 0-1." } }] } })
    render(<App client={client} />)
    await userEvent.click(await screen.findByRole("button", { name: "Watch" }))
    await userEvent.click(screen.getByRole("button", { name: "Half-time" }))
    expect(await screen.findByText("Half-time: Northwick v Larkspur — Score: 0-1.")).toBeTruthy()
    expect(screen.getByText("Possession: Northwick Mariners 46%, Larkspur City 54%.")).toBeTruthy()
  })
})
```

Apply this change to `apps/web/test/overlays.test.tsx`, `apps/web/test/watch.test.tsx` (from the repository root):

```bash
git apply <<'PATCH'
diff --git a/apps/web/test/overlays.test.tsx b/apps/web/test/overlays.test.tsx
index 4062994..7b3b500 100644
--- a/apps/web/test/overlays.test.tsx
+++ b/apps/web/test/overlays.test.tsx
@@ -53,6 +53,6 @@ describe("profiles while watching", () => {
     await userEvent.selectOptions(screen.getByLabelText("Club"), "northwick")
     expect(client.watchers.map((w) => w.segment)).toEqual([{ mode: "analyst", lang: "es", club: "northwick" }])
     act(() => client.push({ kind: "cue", cue: cue({ slot: "side_panel", seg: { mode: "analyst", lang: "es", club: "northwick" }, text: { headline: "Golpe para Northwick", body: "Un remate certero." } }) }))
-    expect(screen.getByText("Golpe para Northwick")).toBeTruthy()
+    expect(document.querySelector('[data-slot="side_panel"]')!.textContent).toContain("Golpe para Northwick")
   })
 })
diff --git a/apps/web/test/watch.test.tsx b/apps/web/test/watch.test.tsx
index ff69763..9dd0748 100644
--- a/apps/web/test/watch.test.tsx
+++ b/apps/web/test/watch.test.tsx
@@ -37,7 +37,7 @@ describe("watching a match", () => {
     await userEvent.selectOptions(screen.getByLabelText("Speed"), "16")
     expect(client.calls.slice(1)).toEqual(["control pause", "control play", "control speed 16"])
     act(() => client.push({ kind: "playback", playback: { state: "ended", frame: 58000, speed: 16, live: false } }))
-    expect(screen.getByText("Full-time")).toBeTruthy()
+    expect(screen.getByText("Full-time", { selector: "p" })).toBeTruthy()
     await userEvent.click(screen.getByRole("button", { name: /Back to matches/ }))
     expect(client.watchers).toEqual([])
     expect(await screen.findByRole("listitem")).toBeTruthy()
PATCH
```

- [ ] **Step 2: Run them to make sure they fail**

Run: `pnpm --filter @touchline/web test why`
Expected: the file fails to load: `Failed to resolve import "../src/Sparkline.js"`

- [ ] **Step 3: Write the drawer, the sparkline and the recap panel**

Create `apps/web/src/Sparkline.tsx`:

```text
import type { Series } from "@touchline/rpc"

/** An SVG path through the points (gaps where a value is null), scaled to the box with the values' own range. */
export const linePath = (points: Series["points"], w: number, h: number): string => {
  const vals = points.flatMap((p) => (p.value === null ? [] : [p.value]))
  if (points.length < 2 || !vals.length) return ""
  const [lo, hi] = [Math.min(...vals), Math.max(...vals)]
  const span = hi - lo || 1
  const x = (i: number) => Math.round((i / (points.length - 1)) * w * 10) / 10
  const y = (v: number) => Math.round((h - ((v - lo) / span) * h) * 10) / 10
  let d = ""
  let pen = false
  points.forEach((p, i) => {
    if (p.value === null) {
      pen = false
      return
    }
    d += `${pen ? "L" : "M"}${x(i)},${y(p.value)} `
    pen = true
  })
  return d.trim()
}

export const Sparkline = ({ series }: { series: Series }) => {
  const last = [...series.points].reverse().find((p) => p.value !== null)?.value
  return (
    <figure className="flex items-center gap-3">
      <svg width={160} height={36} viewBox="0 0 160 36" role="img" aria-label={series.label} className="shrink-0 rounded bg-slate-800">
        <path d={linePath(series.points, 160, 36)} fill="none" stroke="#38bdf8" strokeWidth={2} />
      </svg>
      <figcaption className="text-xs text-slate-300">{series.label}{last != null && <span className="ml-1 tabular-nums text-slate-100">{Math.round(last * 1000) / 1000}</span>}</figcaption>
    </figure>
  )
}
```

Create `apps/web/src/WhyDrawer.tsx`:

```text
import { useEffect, useState } from "react"
import type { Evidence } from "@touchline/rpc"
import type { Cue } from "@touchline/schema"
import type { TouchlineClient } from "./client.js"
import { t, type Lang } from "./i18n.js"
import { Sparkline } from "./Sparkline.js"

/** Behind a cue (spec §5.6 "Why?" drawer): the cause, each checked fact, the metric's history and the events. */
export const WhyDrawer = ({ client, matchId, cue, lang, onClose }: { client: TouchlineClient; matchId: string; cue: Cue; lang: Lang; onClose: () => void }) => {
  const [ev, setEv] = useState<Evidence | null | "none">(null)
  useEffect(() => {
    let live = true
    client.evidence(matchId, cue.cue_id).then((e) => live && setEv(e), () => live && setEv("none"))
    return () => {
      live = false
    }
  }, [client, matchId, cue.cue_id])
  return (
    <aside role="dialog" aria-label={t(lang, "why")} className="fixed inset-y-0 right-0 z-10 w-full max-w-md overflow-y-auto bg-slate-900 p-5 shadow-2xl ring-1 ring-slate-700">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-lg font-bold">{t(lang, "why")}</h2>
        <button type="button" className="rounded bg-slate-800 px-3 py-1" onClick={onClose}>{t(lang, "close")}</button>
      </div>
      {cue.text && (
        <div lang={cue.segment.lang} className="mb-4 rounded-lg bg-slate-800 p-3">
          <p className="font-semibold">{cue.text.headline}</p>
          <p className="text-sm text-slate-300">{cue.text.body}</p>
        </div>
      )}
      {ev === null && <p>{t(lang, "loading")}</p>}
      {ev === "none" && <p className="text-slate-400">—</p>}
      {ev !== null && ev !== "none" && (
        <div className="flex flex-col gap-4 text-sm">
          {ev.cause && (
            <section>
              <h3 className="font-semibold text-slate-400">{t(lang, "cause")}</h3>
              <p className="font-medium">{ev.cause}</p>
              {ev.explanation && <p className="text-slate-300">{ev.explanation}</p>}
            </section>
          )}
          <section>
            <h3 className="font-semibold text-slate-400">{t(lang, "claims")}</h3>
            <ul className="mt-1 flex flex-col gap-1">
              {ev.claims.map((c, i) => (
                <li key={i} className="flex justify-between gap-2 rounded bg-slate-800 px-2 py-1">
                  <span>{c.label}{c.subject_name ? ` — ${c.subject_name}` : ""}</span>
                  <span className="tabular-nums">{c.quote || (c.value !== null ? String(Math.round(c.value * 1000) / 1000) : c.event_id ?? "")} ✓</span>
                </li>
              ))}
            </ul>
          </section>
          {ev.series.length > 0 && (
            <section>
              <h3 className="font-semibold text-slate-400">{t(lang, "history")}</h3>
              <div className="mt-1 flex flex-col gap-2">{ev.series.map((s) => <Sparkline key={`${s.metric_id}-${s.subject}`} series={s} />)}</div>
            </section>
          )}
          {ev.events.length > 0 && (
            <section>
              <h3 className="font-semibold text-slate-400">{t(lang, "events")}</h3>
              <ul className="mt-1 flex flex-col gap-1">
                {ev.events.map((e) => (
                  <li key={e.id} className="rounded bg-slate-800 px-2 py-1">
                    <span className="tabular-nums text-slate-400">{e.clock.slice(0, 5)}</span> {e.type} · {e.player ?? "—"}{e.outcome ? ` · ${e.outcome}` : ""}
                    {Object.entries(e.qualifiers).map(([k, v]) => <span key={k} className="ml-1 rounded bg-slate-700 px-1 text-xs">{k}: {String(v)}</span>)}
                  </li>
                ))}
              </ul>
            </section>
          )}
          <p className="text-xs text-slate-500">{t(lang, "verified")}{ev.model ? ` · ${t(lang, "model")} ${ev.model}` : ""}</p>
        </div>
      )}
    </aside>
  )
}
```

Create `apps/web/src/RecapPanel.tsx`:

```text
import { useState } from "react"
import type { RecapView } from "@touchline/rpc"
import type { Segment } from "@touchline/schema"
import type { TouchlineClient } from "./client.js"
import { t, type Lang } from "./i18n.js"

/** The half-time and full-time recaps (Recap Producer), for the viewer's segment. */
export const RecapPanel = ({ client, matchId, segment, lang }: { client: TouchlineClient; matchId: string; segment: Segment; lang: Lang }) => {
  const [view, setView] = useState<{ kind: "half_time" | "full_time"; recap: RecapView } | null>(null)
  const open = (kind: "half_time" | "full_time") => client.recap(matchId, kind, segment).then((recap) => setView({ kind, recap }))
  return (
    <section className="rounded-lg bg-slate-900 p-3 ring-1 ring-slate-800">
      <div className="flex items-center gap-2">
        <h3 className="font-semibold">{t(lang, "recap")}</h3>
        <button type="button" className="rounded bg-slate-800 px-2 py-0.5 text-sm" onClick={() => open("half_time")}>{t(lang, "halfTime")}</button>
        <button type="button" className="rounded bg-slate-800 px-2 py-0.5 text-sm" onClick={() => open("full_time")}>{t(lang, "fullTime")}</button>
      </div>
      {view && (
        <div className="mt-2 text-sm">
          {view.recap.cards[0]?.text && (
            <p lang={view.recap.cards[0].segment.lang} className="font-semibold">{view.recap.cards[0].text.headline} — {view.recap.cards[0].text.body}</p>
          )}
          {view.recap.recap ? <ul className="mt-1 list-disc pl-5 text-slate-300">{view.recap.recap.sentences.map((s, i) => <li key={i}>{s}</li>)}</ul> : <p className="text-slate-400">—</p>}
        </div>
      )}
    </section>
  )
}
```

Apply this change to `apps/web/src/Watch.tsx` (from the repository root):

```bash
git apply <<'PATCH'
diff --git a/apps/web/src/Watch.tsx b/apps/web/src/Watch.tsx
index 99a3344..70b18d4 100644
--- a/apps/web/src/Watch.tsx
+++ b/apps/web/src/Watch.tsx
@@ -6,6 +6,8 @@ import { t, type Lang } from "./i18n.js"
 import { Overlays, useNow } from "./Overlays.js"
 import { Pitch } from "./Pitch.js"
 import { ProfileBar } from "./ProfileBar.js"
+import { RecapPanel } from "./RecapPanel.js"
+import { WhyDrawer } from "./WhyDrawer.js"
 import { segmentOf, type Profile } from "./profile.js"
 import { TopBar } from "./TopBar.js"
 import { usePane } from "./usePane.js"
@@ -34,6 +36,17 @@ export const Pane = ({ client, sessionId, match, profile, onProfile, onWhy, labe
         <Overlays state={pane} now={now} lang={lang} {...(onWhy ? { onWhy } : {})} />
       </div>
       {pane.playback?.state === "ended" && <p className="text-center font-semibold">{t(lang, "ended")}</p>}
+      {pane.feed.length > 0 && (
+        <ol aria-label="feed" className="flex max-h-40 flex-col gap-1 overflow-y-auto text-sm">
+          {pane.feed.map((c) => (
+            <li key={c.cue_id} lang={c.segment.lang} className="flex items-center gap-2 rounded bg-slate-900 px-2 py-1">
+              <span className="tabular-nums text-slate-400">{c.anchor.clock}</span>
+              <span className="truncate">{c.text?.headline}</span>
+              {onWhy && <button type="button" className="ml-auto rounded bg-slate-800 px-2 text-xs" onClick={() => onWhy(c)}>{t(lang, "why")}</button>}
+            </li>
+          ))}
+        </ol>
+      )}
     </section>
   )
 }
@@ -48,6 +61,7 @@ export const Watch = ({ client, sessionId, match, profile, onProfile, onBack }:
   onBack: () => void
 }) => {
   const lang: Lang = profile.lang
+  const [why, setWhy] = useState<Cue | null>(null)
   const [playback, setPlayback] = useState<Pick<Playback, "state" | "speed">>({ state: "playing", speed: 4 })
   const control = (action: "play" | "pause" | "speed", speed?: number) => client.control(sessionId, action, speed).then(setPlayback)
   return (
@@ -64,7 +78,9 @@ export const Watch = ({ client, sessionId, match, profile, onProfile, onBack }:
           </select>
         </label>
       </div>
-      <Pane client={client} sessionId={sessionId} match={match} profile={profile} onProfile={onProfile} />
+      <Pane client={client} sessionId={sessionId} match={match} profile={profile} onProfile={onProfile} onWhy={setWhy} />
+      <RecapPanel client={client} matchId={match.match_id} segment={segmentOf(profile)} lang={lang} />
+      {why && <WhyDrawer client={client} matchId={match.match_id} cue={why} lang={lang} onClose={() => setWhy(null)} />}
     </div>
   )
 }
PATCH
```

- [ ] **Step 4: Run the tests**

Run: `pnpm --filter @touchline/web test && pnpm --filter @touchline/web typecheck`
Expected: 21 passed, no type errors

- [ ] **Step 5: Commit**

```bash
git add apps/web
git commit -m "feat(web): Why? drawer (cause, checked facts, five-minute sparklines, events, model) from cues on screen or the feed, and half-time/full-time recaps

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```



### Task 13: Split screen, pnpm dev, README

- **Split screen** (spec §5.6): two profiles side by side on the same session.
  - The second pane defaults to the other mode, in Spanish (Hindi if the first is Spanish), and has its own profile bar.
  - Both share the match time and the controls.
- **`pnpm dev`** runs the API and the fan app together, as persistent Turborepo tasks.
- **Match cards** keep the score on one line next to long club names; this was seen in the browser check.
- **README:** a "Fan app and API" section.

**Files:**
- Modify: `apps/web/src/Watch.tsx`, `apps/web/src/MatchList.tsx`, `apps/api/package.json` (script `dev`), `turbo.json` (task `dev`), `package.json` (root script `dev`), `README.md`
- Test: `apps/web/test/split.test.tsx`

**Interfaces:**
- Consumes: `Pane`, `Watch`, `ProfileBar` (Tasks 10–12).
- Produces: the split-screen toggle ("Split screen" / "Single view"; panes are regions named A and B); `pnpm dev`.

- [ ] **Step 1: Write the failing test**

Create `apps/web/test/split.test.tsx`:

```text
import { act, render, screen, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { describe, expect, it } from "vitest"
import type { Cue, Segment } from "@touchline/schema"
import { App } from "../src/App.js"
import { fakeClient } from "./fake-client.js"

const variant = (segment: Segment, headline: string): Cue => ({
  cue_id: `mo-1-${segment.mode}.${segment.lang}`, schema: "touchline.cue/1", match_id: "m", moment_id: "mo-1",
  anchor: { frame_from: 100, frame_to: 120, clock: "12:00" }, display: { slot: segment.mode === "casual" ? "lower_third" : "side_panel", priority: 1, ttl_ms: 8000, template: "goal" },
  segment, text: { headline, body: "…" }, data: {}, evidence: [], verified: true
})

describe("split screen", () => {
  it("shows two profiles of the same session side by side, each with its own cues, and goes back to one", async () => {
    const client = fakeClient()
    render(<App client={client} />)
    await userEvent.click(await screen.findByRole("button", { name: "Watch" }))
    await userEvent.click(screen.getByRole("button", { name: "Split screen" }))
    const casual = { mode: "casual", lang: "en", club: null } as const
    const analyst = { mode: "analyst", lang: "es", club: null } as const
    expect(client.watchers.map((w) => w.segment)).toEqual([casual, analyst])
    // The session delivers each watcher its own segment's variant of the same moment.
    act(() => {
      client.watchers[0]!.onTick({ kind: "cue", cue: variant(casual, "Goal for Larkspur City!") })
      client.watchers[1]!.onTick({ kind: "cue", cue: variant(analyst, "Remate de 0,07 xG") })
    })
    const [a, b] = [screen.getByRole("region", { name: "A" }), screen.getByRole("region", { name: "B" })]
    expect(a.querySelector('[data-slot="lower_third"]')!.textContent).toContain("Goal for Larkspur City!")
    expect(b.querySelector('[data-slot="side_panel"]')!.textContent).toContain("Remate de 0,07 xG")
    expect(within(a).queryAllByText("Remate de 0,07 xG")).toEqual([])
    await userEvent.selectOptions(within(b).getByLabelText("B Idioma"), "hi")
    expect(client.watchers.map((w) => w.segment)).toEqual([casual, { ...analyst, lang: "hi" }])
    await userEvent.click(screen.getByRole("button", { name: "Single view" }))
    expect(client.watchers.map((w) => w.segment)).toEqual([casual])
  })
})
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `pnpm --filter @touchline/web test split`
Expected: 1 failed: Testing Library cannot find the "Split screen" button

- [ ] **Step 3: Add split screen and keep scores on one line**

Apply this change to `apps/web/src/Watch.tsx`, `apps/web/src/MatchList.tsx` (from the repository root):

```bash
git apply <<'PATCH'
diff --git a/apps/web/src/MatchList.tsx b/apps/web/src/MatchList.tsx
index 34ed1fe..4094dff 100644
--- a/apps/web/src/MatchList.tsx
+++ b/apps/web/src/MatchList.tsx
@@ -10,7 +10,7 @@ export const MatchList = ({ matches, lang, onWatch }: { matches: ReadonlyArray<M
         <li key={m.match_id} className="rounded-xl bg-slate-900 p-4 ring-1 ring-slate-800">
           <div className="flex items-center justify-between gap-2 text-lg font-semibold">
             <span className="flex items-center gap-2"><span className="inline-block h-3 w-3 rounded-full" style={{ background: m.home.kit.primary }} />{m.home.name}</span>
-            <span className="tabular-nums">{m.score.home}–{m.score.away}</span>
+            <span className="shrink-0 whitespace-nowrap tabular-nums">{m.score.home}–{m.score.away}</span>
             <span className="flex items-center gap-2">{m.away.name}<span className="inline-block h-3 w-3 rounded-full" style={{ background: m.away.kit.primary }} /></span>
           </div>
           <div className="mt-2 flex items-center justify-between text-sm text-slate-400">
diff --git a/apps/web/src/Watch.tsx b/apps/web/src/Watch.tsx
index 70b18d4..481cf01 100644
--- a/apps/web/src/Watch.tsx
+++ b/apps/web/src/Watch.tsx
@@ -62,6 +62,9 @@ export const Watch = ({ client, sessionId, match, profile, onProfile, onBack }:
 }) => {
   const lang: Lang = profile.lang
   const [why, setWhy] = useState<Cue | null>(null)
+  // Demo mode (spec §5.6): a second profile on the same session, side by side; by default the other mode, in Spanish.
+  const [second, setSecond] = useState<Profile | null>(null)
+  const toggleSplit = () => setSecond(second ? null : { mode: profile.mode === "casual" ? "analyst" : "casual", lang: profile.lang === "es" ? "hi" : "es", clubs: [] })
   const [playback, setPlayback] = useState<Pick<Playback, "state" | "speed">>({ state: "playing", speed: 4 })
   const control = (action: "play" | "pause" | "speed", speed?: number) => client.control(sessionId, action, speed).then(setPlayback)
   return (
@@ -71,6 +74,7 @@ export const Watch = ({ client, sessionId, match, profile, onProfile, onBack }:
         <button type="button" className="rounded bg-emerald-600 px-3 py-1 text-white" onClick={() => control(playback.state === "paused" ? "play" : "pause")}>
           {playback.state === "paused" ? t(lang, "play") : t(lang, "pause")}
         </button>
+        <button type="button" className="rounded bg-slate-800 px-3 py-1" onClick={toggleSplit}>{second ? t(lang, "single") : t(lang, "split")}</button>
         <label className="text-sm">
           {t(lang, "speed")}{" "}
           <select aria-label={t(lang, "speed")} className="rounded bg-slate-800 px-2 py-1" value={playback.speed} onChange={(e) => control("speed", Number(e.target.value))}>
@@ -78,7 +82,10 @@ export const Watch = ({ client, sessionId, match, profile, onProfile, onBack }:
           </select>
         </label>
       </div>
-      <Pane client={client} sessionId={sessionId} match={match} profile={profile} onProfile={onProfile} onWhy={setWhy} />
+      <div className={second ? "grid gap-4 lg:grid-cols-2" : ""}>
+        <Pane client={client} sessionId={sessionId} match={match} profile={profile} onProfile={onProfile} onWhy={setWhy} label={second ? "A" : undefined} />
+        {second && <Pane client={client} sessionId={sessionId} match={match} profile={second} onProfile={setSecond} onWhy={setWhy} label="B" />}
+      </div>
       <RecapPanel client={client} matchId={match.match_id} segment={segmentOf(profile)} lang={lang} />
       {why && <WhyDrawer client={client} matchId={match.match_id} cue={why} lang={lang} onClose={() => setWhy(null)} />}
     </div>
PATCH
```

Run: `pnpm --filter @touchline/web test`
Expected: 22 passed

- [ ] **Step 4: Add pnpm dev and the README section**

Apply this change to `apps/api/package.json`, `turbo.json`, `package.json`, `README.md` (from the repository root):

````bash
git apply <<'PATCH'
diff --git a/README.md b/README.md
index b700e52..ce8d441 100644
--- a/README.md
+++ b/README.md
@@ -84,6 +84,24 @@ A real model takes about 5 s per call, so a moment takes about 30 s end to end:
 
 Known limits: the checks reject rostered players who were not in the play (in any letter case), but not a name outside the roster altogether, nor a rostered name transliterated into Devanagari; numbers written as words ("two goals") are not checked, so the agents are told never to write them; Hindi must be mostly Devanagari and Spanish must not read as English, but fluency needs a human spot-check; checkpoints are written after every step but a restarted service starts each match afresh.
 
+## Fan app and API
+
+`apps/api` (Effect RPC over WebSocket at `/rpc`) plays matches from a library of run folders. A session plays one match at a speed on the cue bus. Every viewer gets the frames, a scoreboard each second from the stats engine and the agents' cues for their own segment (spec §5.5), in the same match time. Cues come from the run's cue cache (recorded, no model calls), or, with **Live agents** ticked, from the agent service as the match plays. `apps/web` (React, Vite, Tailwind) is the fan app:
+- the 2D pitch in the clubs' kit colours;
+- the overlays: lower third for casual viewers, side panel for analysts, recap cards;
+- a profile switcher and builder (mode, language, club);
+- the "Why?" drawer: cause, checked facts, five-minute history, events;
+- half-time and full-time recaps;
+- a split-screen demo mode, with two profiles on one match.
+
+```bash
+uv run --project services/agents touchline-agents &   # the agent service (stub model unless TOUCHLINE_LLM=openai)
+pnpm library                                           # simulate the six scenarios and cache their cues for twelve segments (out/library)
+pnpm dev                                               # API on :8787 and the fan app on http://localhost:5173
+```
+
+`pnpm library --no-agents true` builds a stats-only library without the agent service. The API alone: `pnpm api [--library DIR] [--port 8787]`. Live sessions need the agent service running; with a real model, set `TOUCHLINE_REQUEST_BUDGET_S` on the service below the API's `--budget-ms` (see Agents).
+
 ## Packages
 
 | Package | What it does |
@@ -95,6 +113,9 @@ Known limits: the checks reject rostered players who were not in the play (in an
 | `packages/stats` | Stats engine: metrics and signals on the domain stream, replay of run folders, `pnpm stats` |
 | `packages/advisor` | What-if sessions rebuilt from run folders, better-option explainer, positioning advisor |
 | `packages/mcp-stats` | MCP server exposing the stats tools to agents (stdio or Streamable HTTP) |
+| `packages/rpc` | The API's RPC contracts (Effect RPC group), shared by the API and the fan app |
+| `apps/api` | Match library, playback sessions on the cue bus, live agents, evidence and recaps over RPC; `pnpm api`, `pnpm library` |
+| `apps/web` | The fan app (React, Vite, Tailwind): pitch, overlays, profiles, "Why?" drawer, recaps, split screen |
 | `packages/agent-gateway` | A2A client of the agent service: signal batches, recaps, time budget, retry, circuit breaker, cue cache |
 | `services/agents` | The six agents, their workflow, the A2A server and the ground-truth evaluation harness (`evals/`) |
 | `packages/calibrate` | Match statistics (identical to the Python definitions), tuning knobs, tuner, realism gate |
diff --git a/apps/api/package.json b/apps/api/package.json
index d6bde33..b4a4fa0 100644
--- a/apps/api/package.json
+++ b/apps/api/package.json
@@ -10,6 +10,7 @@
     "test": "vitest run",
     "typecheck": "tsc --noEmit -p .",
     "serve": "tsx src/main.ts",
+    "dev": "tsx src/main.ts",
     "library": "tsx src/library-cli.ts"
   },
   "dependencies": {
diff --git a/package.json b/package.json
index 1c8528b..0c4160e 100644
--- a/package.json
+++ b/package.json
@@ -6,6 +6,7 @@
   "engines": { "node": ">=22" },
   "scripts": {
     "test": "turbo run test",
+    "dev": "turbo run dev --filter=@touchline/api --filter=@touchline/web",
     "typecheck": "turbo run typecheck",
     "sim": "pnpm --filter @touchline/sim run sim",
     "league": "pnpm --filter @touchline/league run generate",
diff --git a/turbo.json b/turbo.json
index 81eb7ce..df07def 100644
--- a/turbo.json
+++ b/turbo.json
@@ -3,6 +3,7 @@
   "agentGuidance": false,
   "tasks": {
     "typecheck": {},
+    "dev": { "cache": false, "persistent": true },
     "test": {
       "outputs": [],
       "inputs": [
PATCH
````

- [ ] **Step 5: Try it**

Start the agent service on the stub, build a two-match library and run the stack:

```bash
uv run --project services/agents touchline-agents --port 8100 &
pnpm library --scenarios costly_error,high_press_vs_low_block
pnpm dev
```

Expected:
- `pnpm library` prints `27 moments, 348 cues (stub)` and `33 moments, 420 cues (stub)`.
- `curl http://127.0.0.1:8787/health` gives `{"ok":true,"matches":2}`.
- In the browser, http://localhost:5173 lists both matches. Watching Northwick v Larkspur from minute 30 shows the pitch moving, the score, the clock and the momentum bar.
- Split screen shows casual English and analyst Spanish side by side.
- "Why?" on "Larkspur City turn up the pressure" shows the cause "sustained high press", three checked facts (pressure index, PPDA, field tilt) and three sparklines.

Stop the servers afterwards.

- [ ] **Step 6: Commit**

```bash
git add apps package.json turbo.json README.md
git commit -m "feat(web): split-screen demo mode (two profiles on one session), pnpm dev for API and fan app, README

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```



### Task 14: Test runs clean up their temp folders

Many tests across the repository simulate a whole match into the system temp folder, about 80 MB each, and never delete it. One full run left about 3 GB behind; during this plan's prototyping the disk filled twice.
- **The fix:** a shared vitest global setup (`vitest.tmp.ts`, at the root) gives each package's test run a fresh folder under the system temp folder. It points `TMPDIR`, `TMP` and `TEMP` at that folder (the test workers inherit them) and deletes it when the run ends.
- **Where:** every package's vitest config uses it; `packages/rpc` gets a config for it.
- **The test:** the run's temp folder is the fresh one.

**Files:**
- Create: `vitest.tmp.ts`, `packages/rpc/vitest.config.ts`
- Modify: `vitest.config.ts` of `packages/{advisor,agent-gateway,calibrate,league,mcp-stats,schema,sim-core,sim,stats}` and `apps/api`, and `apps/web/vite.config.ts` (`globalSetup`)
- Test: `packages/schema/test/tmp.test.ts`

**Interfaces:**
- Consumes: nothing new.
- Produces: `vitest.tmp.ts` (default export `setup() -> teardown`), used as `globalSetup: ["../../vitest.tmp.ts"]` by every package.

- [ ] **Step 1: Write the failing test**

Create `packages/schema/test/tmp.test.ts`:

```ts
import { existsSync } from "node:fs"
import { tmpdir } from "node:os"
import { basename } from "node:path"
import { describe, expect, it } from "vitest"

describe("test temp folder", () => {
  it("is a fresh folder for this run (vitest.tmp.ts deletes it afterwards)", () => {
    expect(basename(tmpdir())).toMatch(/^touchline-test-/)
    expect(existsSync(tmpdir())).toBe(true)
  })
})
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `pnpm --filter @touchline/schema test tmp`
Expected: 1 failed: `expected 'T' to match /^touchline-test-/` (the run uses the system temp folder itself)

- [ ] **Step 3: Give every test run its own temp folder**

Create `vitest.tmp.ts`:

```ts
/**
 * Global setup for every package's tests: a fresh temp folder for the run, deleted when the run ends. Many tests
 * simulate a whole match into os.tmpdir() (about 80 MB each); without this they pile up on disk run after run.
 */
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

export default function setup(): () => void {
  const dir = mkdtempSync(join(tmpdir(), "touchline-test-"))
  // os.tmpdir() reads these on every call; the test workers start after this and inherit them.
  for (const k of ["TMPDIR", "TMP", "TEMP"]) process.env[k] = dir
  return () => rmSync(dir, { recursive: true, force: true })
}
```

Create `packages/rpc/vitest.config.ts`:

```ts
import { defineConfig } from "vitest/config"

export default defineConfig({ test: { globalSetup: ["../../vitest.tmp.ts"], testTimeout: 120_000 } })
```

Apply this change to `packages/advisor/vitest.config.ts`, `packages/agent-gateway/vitest.config.ts`, `packages/calibrate/vitest.config.ts`, `packages/league/vitest.config.ts`, `packages/mcp-stats/vitest.config.ts`, `packages/schema/vitest.config.ts`, `packages/sim-core/vitest.config.ts`, `packages/sim/vitest.config.ts`, `packages/stats/vitest.config.ts`, `apps/api/vitest.config.ts`, `apps/web/vite.config.ts` (from the repository root):

```bash
git apply <<'PATCH'
diff --git a/apps/api/vitest.config.ts b/apps/api/vitest.config.ts
index 54a91bf..c37d986 100644
--- a/apps/api/vitest.config.ts
+++ b/apps/api/vitest.config.ts
@@ -1,3 +1,3 @@
 import { defineConfig } from "vitest/config"
 
-export default defineConfig({ test: { testTimeout: 120_000 } })
+export default defineConfig({ test: { globalSetup: ["../../vitest.tmp.ts"], testTimeout: 120_000 } })
diff --git a/apps/web/vite.config.ts b/apps/web/vite.config.ts
index 369a6cc..dc5209b 100644
--- a/apps/web/vite.config.ts
+++ b/apps/web/vite.config.ts
@@ -6,5 +6,5 @@ import { defineConfig } from "vitest/config"
 export default defineConfig({
   plugins: [react(), tailwindcss()],
   server: { port: 5173, proxy: { "/rpc": { target: "ws://127.0.0.1:8787", ws: true } } },
-  test: { environment: "jsdom", setupFiles: ["test/setup.ts"], testTimeout: 120_000 }
+  test: { environment: "jsdom", globalSetup: ["../../vitest.tmp.ts"], setupFiles: ["test/setup.ts"], testTimeout: 120_000 }
 })
diff --git a/packages/advisor/vitest.config.ts b/packages/advisor/vitest.config.ts
index 54a91bf..c37d986 100644
--- a/packages/advisor/vitest.config.ts
+++ b/packages/advisor/vitest.config.ts
@@ -1,3 +1,3 @@
 import { defineConfig } from "vitest/config"
 
-export default defineConfig({ test: { testTimeout: 120_000 } })
+export default defineConfig({ test: { globalSetup: ["../../vitest.tmp.ts"], testTimeout: 120_000 } })
diff --git a/packages/agent-gateway/vitest.config.ts b/packages/agent-gateway/vitest.config.ts
index 54a91bf..c37d986 100644
--- a/packages/agent-gateway/vitest.config.ts
+++ b/packages/agent-gateway/vitest.config.ts
@@ -1,3 +1,3 @@
 import { defineConfig } from "vitest/config"
 
-export default defineConfig({ test: { testTimeout: 120_000 } })
+export default defineConfig({ test: { globalSetup: ["../../vitest.tmp.ts"], testTimeout: 120_000 } })
diff --git a/packages/calibrate/vitest.config.ts b/packages/calibrate/vitest.config.ts
index 54a91bf..c37d986 100644
--- a/packages/calibrate/vitest.config.ts
+++ b/packages/calibrate/vitest.config.ts
@@ -1,3 +1,3 @@
 import { defineConfig } from "vitest/config"
 
-export default defineConfig({ test: { testTimeout: 120_000 } })
+export default defineConfig({ test: { globalSetup: ["../../vitest.tmp.ts"], testTimeout: 120_000 } })
diff --git a/packages/league/vitest.config.ts b/packages/league/vitest.config.ts
index 54a91bf..c37d986 100644
--- a/packages/league/vitest.config.ts
+++ b/packages/league/vitest.config.ts
@@ -1,3 +1,3 @@
 import { defineConfig } from "vitest/config"
 
-export default defineConfig({ test: { testTimeout: 120_000 } })
+export default defineConfig({ test: { globalSetup: ["../../vitest.tmp.ts"], testTimeout: 120_000 } })
diff --git a/packages/mcp-stats/vitest.config.ts b/packages/mcp-stats/vitest.config.ts
index 54a91bf..c37d986 100644
--- a/packages/mcp-stats/vitest.config.ts
+++ b/packages/mcp-stats/vitest.config.ts
@@ -1,3 +1,3 @@
 import { defineConfig } from "vitest/config"
 
-export default defineConfig({ test: { testTimeout: 120_000 } })
+export default defineConfig({ test: { globalSetup: ["../../vitest.tmp.ts"], testTimeout: 120_000 } })
diff --git a/packages/schema/vitest.config.ts b/packages/schema/vitest.config.ts
index 54a91bf..c37d986 100644
--- a/packages/schema/vitest.config.ts
+++ b/packages/schema/vitest.config.ts
@@ -1,3 +1,3 @@
 import { defineConfig } from "vitest/config"
 
-export default defineConfig({ test: { testTimeout: 120_000 } })
+export default defineConfig({ test: { globalSetup: ["../../vitest.tmp.ts"], testTimeout: 120_000 } })
diff --git a/packages/sim-core/vitest.config.ts b/packages/sim-core/vitest.config.ts
index 54a91bf..c37d986 100644
--- a/packages/sim-core/vitest.config.ts
+++ b/packages/sim-core/vitest.config.ts
@@ -1,3 +1,3 @@
 import { defineConfig } from "vitest/config"
 
-export default defineConfig({ test: { testTimeout: 120_000 } })
+export default defineConfig({ test: { globalSetup: ["../../vitest.tmp.ts"], testTimeout: 120_000 } })
diff --git a/packages/sim/vitest.config.ts b/packages/sim/vitest.config.ts
index 54a91bf..c37d986 100644
--- a/packages/sim/vitest.config.ts
+++ b/packages/sim/vitest.config.ts
@@ -1,3 +1,3 @@
 import { defineConfig } from "vitest/config"
 
-export default defineConfig({ test: { testTimeout: 120_000 } })
+export default defineConfig({ test: { globalSetup: ["../../vitest.tmp.ts"], testTimeout: 120_000 } })
diff --git a/packages/stats/vitest.config.ts b/packages/stats/vitest.config.ts
index 54a91bf..c37d986 100644
--- a/packages/stats/vitest.config.ts
+++ b/packages/stats/vitest.config.ts
@@ -1,3 +1,3 @@
 import { defineConfig } from "vitest/config"
 
-export default defineConfig({ test: { testTimeout: 120_000 } })
+export default defineConfig({ test: { globalSetup: ["../../vitest.tmp.ts"], testTimeout: 120_000 } })
PATCH
```

- [ ] **Step 4: Run the whole suite and check nothing is left behind**

Run: `pnpm --filter @touchline/schema test`
Expected: 11 passed

Run: `df -h . | tail -1; pnpm turbo run typecheck test --force --concurrency=2; ls -d "$TMPDIR"/touchline-* 2>/dev/null | wc -l; df -h . | tail -1`
Expected: `Tasks: 24 successful`; no `touchline-*` folder left in the temp folder; free space the same before and after

Run: `uv run --project services/agents pytest -q services/agents`
Expected: 158 passed, 7 deselected

- [ ] **Step 5: Commit**

```bash
git add vitest.tmp.ts packages apps
git commit -m "test: every package's test run gets a fresh temp folder, deleted afterwards (simulated matches no longer pile up on disk)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```



# 3D Viewer, Player Cameras and What-if Split (Plan 7) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a fan watch any match in 3D from any player's point of view, with several synced camera angles on one screen, and, when re-simulation proves a better pass existed, watch the pass as it went beside the better pass played out, with the verified numbers underneath.

**Architecture:** The engine gains `playAheadFrames` (sim-core) and the advisor `passClip` (the real frames around a pass, and the better pass in its typical re-simulation). The API serves clips through a new `GetWhatIf` RPC: from a per-match cache that `pnpm library` fills by scanning every attacking pass across worker threads, or computed on request in a worker thread. Each verified better pass becomes a verified "better pass" cue in every language. The web app adds a 2D/3D toggle to the Watch page. The 3D view is one React Three Fiber canvas drawing plain three.js scenes in several scissored viewports, each with its own post-processing chain, driven by pure, unit-tested modules for motion, kicks, cameras and layout. The what-if split puts two scenes side by side on one clock.

**Tech Stack:** TypeScript (pnpm/turbo monorepo, Effect 4, vitest, jsdom, Testing Library), React 19, three 0.186.1, @react-three/fiber 9.8.1, @types/three 0.186.0; CC0 assets (Quaternius Universal Animation Library body, Poly Haven `stadium_01` HDRI).

**Spec:** `docs/superpowers/specs/2026-10-09-3d-viewer-whatif-design.md`. Its §10 lists the rulings made while building the prototype, and this plan follows them where they differ from §§3–8. The most important one, a user decision: the split's better passes come from a library scan, not from agent claims.

## Global Constraints

- Run every command from the `touchline/` repository root. Branch `plan-7-viewer`, worktree `touchline-worktrees/plan-7-viewer`. Prototypes and scratch files stay out of `/tmp`.
- Version pins: `three` 0.186.1, `@react-three/fiber` 9.8.1, `@types/three` 0.186.0 (all older than pnpm's release-age window). No drei, no other new dependency. `@touchline/advisor` and `@touchline/sim-core` become dependencies of `@touchline/api`.
- Every number the viewer sees about a what-if comes from `advisor.explainPass` / `passClip` (20 paired seeds, 10 s horizon), never from a model. A split opens only for verdict `better_option_found`; other verdicts are said honestly.
- Answers never go past the session's frame: `GetWhatIf` refuses a pass the session has not reached and cuts both plays at its frame.
- The engine stays as it is: `playAheadFrames` is added next to `playAhead` in `packages/sim-core/src/whatif.ts` (the only file shared with Plan 6b) and nothing else in sim-core changes, so the realism gate and pinned fixtures are untouched.
- The 2D canvas, studio console and graphics output keep working unchanged; without WebGL the Watch page stays on 2D.
- Pure maths lives in `apps/web/src/view3d/*.ts` with no three.js import (motion, kick, cameras, layout, clipclock). three.js code lives in `world.ts`, `render.ts`, `assets.ts`, `Stage3D.tsx`.
- Pitch metres to world: `(x, y, z) -> (x, z, -y)`. Players are 1.83 m (the model's own scale, `1`).
- All UI text is in English, Spanish and Hindi (`apps/web/src/i18n.ts`; every Hindi string contains Devanagari).
- CC0 assets only, credited in `ATTRIBUTION.md`; no real clubs, players, brands or logos.
- Commit messages end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

1. **The followed player is substituted or sent off while followed:** the view must not crash or follow nobody; the broadcast camera takes over with a notice (test in Task 8).
2. **A viewer asks for a what-if past the session's frame, or two viewers ask for the same uncached pass at once:** the first is refused ("not reached yet") and frames after the session's frame are never sent; the second computes once for both (tests in Task 3).
3. **Frames arriving late, repeated, out of order or after a seek back, or stopping (pause):** motion stays smooth, a seek starts afresh, a stall holds the last frame standing (tests in Task 5).
4. **Phone width:** one view only, split halves stacked, never a 2×2 grid (test in Task 6).
5. **No WebGL, or a stored "3D" choice on a browser without it:** the page stays on the 2D pitch with the 3D button disabled and saying why (test in Task 8).

## How this plan was verified

Every task was built first in a prototype worktree (`touchline-worktrees/proto-7`, branch `proto-7`, one commit per task). The code and test blocks below are those commits, unchanged.

- **Red:** for each task, its test files alone on the parent commit fail as each Step 2 says (13 of 13 commands failed as expected).
- **Green:** at each commit, the suites of the packages it touches pass with their typecheck. The API suite runs with `--no-file-parallelism`: 62 tests at Tasks 3, 4 and 7, and 65 at Task 9.
- **One test fails at the base commit too:** sim-core's `keeper heroics and howlers …` in `scenario.test.ts` times out after 120 s on a loaded machine, before and after Task 1. Task 1 does not touch it.
- **Browser:** checked in Chrome on an M4 Pro, pixel ratio 2. Covered: the live 3D view, all four cameras, the 2×2 grid (103 fps), main + map, and click and keys.
- **Not yet seen in the browser:** the split's drawing. The Chrome window went to the background before it could be checked, and a background tab runs no animation frames. Its logic is covered by the component and clock tests; Task 11 Step 4 checks it on screen.
- **The scan:** with stub agents, `pnpm library --scenarios costly_error,even_contest --seed 2` found 8 and 6 verified better passes.

---

### Task 1: Play ahead with frames (sim-core)

`playAhead` returns the events and the final state of a re-simulation, but no frames to show. `playAheadFrames` plays exactly the same way and also keeps the frame of every tick (the step to full time has none). It is the only change to the engine package.

**Files:**
- Modify: `packages/sim-core/src/whatif.ts` (add `playAheadFrames` after `playAhead`)
- Test: `packages/sim-core/test/whatif.test.ts`

**Interfaces:**
- Produces: `playAheadFrames(s: MatchState, ticks: number): { events: DomainEvent[]; state: MatchState; frames: Frame[] }` (frames have ticks `s.tick + 1 …`, positions rounded to the centimetre as in `Frame`).

- [ ] **Step 1: Write the failing tests**

Apply this change to `packages/sim-core/test/whatif.test.ts` (from the repository root):

```bash
git apply <<'PATCH'
diff --git a/packages/sim-core/test/whatif.test.ts b/packages/sim-core/test/whatif.test.ts
index e6e75a7..5305e01 100644
--- a/packages/sim-core/test/whatif.test.ts
+++ b/packages/sim-core/test/whatif.test.ts
@@ -1,5 +1,5 @@
 import { describe, expect, it } from "vitest"
-import { applyIntervention, forkState, initMatch, isFinished, passOptions, playAhead, runScript, statesAt, step, whatIf, WhatIfError, type DomainEvent, type MatchState, type Script } from "../src/index.js"
+import { applyIntervention, forkState, initMatch, isFinished, passOptions, playAhead, playAheadFrames, runScript, statesAt, step, whatIf, WhatIfError, type DomainEvent, type MatchState, type Script } from "../src/index.js"
 import { makeConfig } from "../src/testing.js"
 
 const cfg = makeConfig(41)
@@ -63,6 +63,30 @@ describe("states and forks", () => {
   })
 })
 
+describe("play ahead with frames", () => {
+  it("plays exactly like playAhead and keeps one frame per tick, the same for the same fork", () => {
+    const s = onBall(12_000)
+    const plain = playAhead(forkState(s, 3), 50)
+    const shown = playAheadFrames(forkState(s, 3), 50)
+    expect(shown.events).toEqual(plain.events)
+    expect(shown.state).toEqual(plain.state)
+    expect(shown.frames.map((f) => f.tick)).toEqual(Array.from({ length: 50 }, (_, i) => s.tick + 1 + i))
+    const last = shown.frames.at(-1)!
+    for (const p of shown.state.players.filter((q) => !q.sentOff)) {
+      const f = [...last.home, ...last.away].find((x) => x.id === p.id)!
+      expect(f.x).toBeCloseTo(p.pos.x, 2)
+      expect(f.y).toBeCloseTo(p.pos.y, 2)
+    }
+    expect(playAheadFrames(forkState(s, 3), 50).frames).toEqual(shown.frames)
+  })
+
+  it("stops at full time", () => {
+    const out = playAheadFrames(match.states.get(Math.max(...match.states.keys()) - 5)!, 100)
+    expect(isFinished(out.state)).toBe(true)
+    expect(out.frames.length).toBeLessThanOrEqual(5)
+  })
+})
+
 describe("interventions", () => {
   it("make the player on the ball play the pass chosen for them at the next tick", () => {
     const s = onBall(12_000)
PATCH
```

- [ ] **Step 2: Run them to make sure they fail**

Run: `pnpm --filter @touchline/sim-core test whatif`
Expected: the two new tests fail with `TypeError: playAheadFrames is not a function`

- [ ] **Step 3: Write the implementation**

Apply this change to `packages/sim-core/src/whatif.ts` (from the repository root):

```bash
git apply <<'PATCH'
diff --git a/packages/sim-core/src/whatif.ts b/packages/sim-core/src/whatif.ts
index 44e5f31..3a2b401 100644
--- a/packages/sim-core/src/whatif.ts
+++ b/packages/sim-core/src/whatif.ts
@@ -8,7 +8,7 @@ import { attackX, clampToPitch, dist, type Side, type Vec2 } from "./geometry.js
 import { substream } from "./rng.js"
 import { runScript } from "./runner.js"
 import { initMatch, isFinished, step } from "./step.js"
-import { CONCERNS, type DomainEvent, type MatchConfig, type MatchState, type TeamStyle } from "./types.js"
+import { CONCERNS, type DomainEvent, type Frame, type MatchConfig, type MatchState, type TeamStyle } from "./types.js"
 
 export type Intervention =
   | { readonly kind: "none" }
@@ -109,6 +109,21 @@ export const playAhead = (s: MatchState, ticks: number): { readonly events: Doma
   return { events, state: t }
 }
 
+/** Play a state forward like playAhead, also keeping the frame of every tick played (to show the play). */
+export const playAheadFrames = (s: MatchState, ticks: number): { readonly events: DomainEvent[]; readonly state: MatchState; readonly frames: Frame[] } => {
+  const events: DomainEvent[] = []
+  const frames: Frame[] = []
+  let t = s
+  const end = s.tick + ticks
+  while (!isFinished(t) && t.tick < end) {
+    const r = step(t)
+    t = r.state
+    events.push(...r.events)
+    if (r.frame) frames.push(r.frame) // the step to full time has none
+  }
+  return { events, state: t, frames }
+}
+
 /** What one play-ahead produced, from one team's point of view. */
 export interface Outcome {
   readonly goal_diff: number
PATCH
```

- [ ] **Step 4: Run the tests**

Run: `pnpm --filter @touchline/sim-core test whatif`
Expected: `15 passed`

Run: `pnpm --filter @touchline/sim-core typecheck`
Expected: no errors

- [ ] **Step 5: Commit**

```bash
git add packages/sim-core
git commit -m "feat(sim-core): playAheadFrames — play a state forward like playAhead and keep each tick's frame, to show a re-simulated play

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: The clip of a pass (advisor)

`passClip` turns an explained pass (`explainPass`'s answer) into two plays to watch over the same ticks: the match as it went, from 2 s before the pass to 8 s after, and the better pass played out. The better play is one of the verdict's paired re-simulations, the seed whose outcome is closest to the mean (never a lucky one). The frames match the real play up to the pass. It also counts, over all seeds, how often each pass led to a shot and to a goal. Without a better option it returns the real play only.

**Files:**
- Create: `packages/advisor/src/clip.ts`
- Modify: `packages/advisor/src/index.ts` (export it)
- Test: `packages/advisor/test/advisor.test.ts`

**Interfaces:**
- Consumes: `playAheadFrames` (Task 1); `explainPass`, `PassExplanation`, `Session`, `xtEndValue` (existing).
- Produces: `CLIP_BEFORE_S = 2`, `CLIP_AFTER_S = 8`; `typicalIndex(xs: number[]): number`; `PassClip { event_id, verdict, passer_id, played_to, better_to | null, real: Frame[], variant: Frame[] | null, pass_index, seeds, horizon_s, typical_seed | null, shots: {played, better} | null, goals: {played, better} | null, gain: Estimate | null }`; `passClip(session: Session, ex: PassExplanation, xt: XtGrid): PassClip`.

- [ ] **Step 1: Write the failing tests**

Apply this change to `packages/advisor/test/advisor.test.ts` (from the repository root):

```bash
git apply <<'PATCH'
diff --git a/packages/advisor/test/advisor.test.ts b/packages/advisor/test/advisor.test.ts
index 12eee96..3cc608f 100644
--- a/packages/advisor/test/advisor.test.ts
+++ b/packages/advisor/test/advisor.test.ts
@@ -8,7 +8,7 @@ import type { League } from "@touchline/league"
 import { SCENARIOS, writeMatch } from "@touchline/sim"
 import { DEFAULT_PARAMS, type MatchState } from "@touchline/sim-core"
 import { xtGridFromJson } from "@touchline/stats"
-import { AdvisorError, clearlyBetter, explainPass, Session, SESSION_CACHE_STATES, suggestPosition } from "../src/index.js"
+import { AdvisorError, CLIP_AFTER_S, CLIP_BEFORE_S, clearlyBetter, explainPass, passClip, Session, SESSION_CACHE_STATES, suggestPosition, typicalIndex, type PassExplanation } from "../src/index.js"
 
 const root = join(dirname(fileURLToPath(import.meta.url)), "../../..")
 const league = JSON.parse(readFileSync(join(root, "data/league/league.json"), "utf8")) as League
@@ -151,3 +151,49 @@ describe("positioning advisor", () => {
     expect(() => suggestPosition(session, carrier, t, xt)).toThrow(/nobody has the ball/)
   })
 })
+
+describe("pass clip", () => {
+  const pass = () => session.events.filter((e) => e.type === "pass" && Array.isArray(e.attrs.options) && (e.attrs.options as unknown[]).length >= 3 && e.frame_id > 600)[3]!
+  /** The pass explained, with its best simulated alternative taken as the better option (whatever the verdict). */
+  const asBetter = (x: PassExplanation): PassExplanation => {
+    const alt = x.options.filter((o) => o.simulated).sort((a, b) => b.simulated!.mean - a.simulated!.mean)[0]!
+    return { ...x, verdict: "better_option_found", better: alt }
+  }
+
+  it("shows the match as it went around the pass, then the better pass in its typical seed from the same frames", () => {
+    const x = asBetter(explainPass(session, pass().id, xt, { seeds: 10, horizonS: 10 }))
+    const c = passClip(session, x, xt)
+    const before = CLIP_BEFORE_S / 0.1
+    const after = CLIP_AFTER_S / 0.1
+    expect(c.real.map((f) => f.tick)).toEqual(Array.from({ length: before + after }, (_, i) => x.frame_id - before + i))
+    expect(c.pass_index).toBe(before)
+    expect(c.real[c.pass_index]!.tick).toBe(x.frame_id)
+    for (const t of [c.real[0]!, c.real.at(-1)!]) {
+      const s = session.stateAt(t.tick)
+      const p = s.players.find((q) => q.id === t.home[0]!.id)!
+      expect(t.home[0]!.x).toBeCloseTo(p.pos.x, 2)
+    }
+    expect(c.variant!.map((f) => f.tick)).toEqual(c.real.map((f) => f.tick))
+    expect(c.variant!.slice(0, c.pass_index)).toEqual(c.real.slice(0, c.pass_index))
+    expect(c.variant!.slice(c.pass_index)).not.toEqual(c.real.slice(c.pass_index))
+    expect(c).toMatchObject({ verdict: "better_option_found", passer_id: x.player_id, played_to: x.options.find((o) => o.chosen)!.receiver_id, better_to: x.better!.receiver_id, seeds: 10, gain: x.better!.simulated })
+    expect(c.typical_seed).toBeGreaterThanOrEqual(0)
+    expect(c.typical_seed).toBeLessThan(10)
+    for (const n of [c.shots!.played, c.shots!.better, c.goals!.played, c.goals!.better]) expect(n).toBeGreaterThanOrEqual(0)
+    expect(c.goals!.better).toBeLessThanOrEqual(c.shots!.better)
+    expect(passClip(session, x, xt)).toEqual(c)
+  }, 60_000)
+
+  it("shows only the match as it went when no better option was found", () => {
+    const x = explainPass(session, pass().id, xt, { seeds: 0 })
+    const c = passClip(session, x, xt)
+    expect(c).toMatchObject({ verdict: "not_verified", better_to: null, variant: null, typical_seed: null, shots: null, goals: null, gain: null })
+    expect(c.real.length).toBe((CLIP_BEFORE_S + CLIP_AFTER_S) / 0.1)
+  })
+
+  it("picks the seed closest to the mean, never an outlier", () => {
+    expect(typicalIndex([0, 0.1, 0.9, 0.2])).toBe(3) // mean 0.3
+    expect(typicalIndex([1, 1])).toBe(0)
+    expect(() => typicalIndex([])).toThrow(AdvisorError)
+  })
+})
PATCH
```

- [ ] **Step 2: Run them to make sure they fail**

Run: `pnpm --filter @touchline/advisor test`
Expected: the three new tests fail: `passClip` and `typicalIndex` are not exported yet (`is not a function`)

- [ ] **Step 3: Write the implementation**

Create `packages/advisor/src/clip.ts`:

```ts
import { applyIntervention, forkState, outcomeOf, playAheadFrames, type Estimate, type Frame, type Intervention } from "@touchline/sim-core"
import type { XtGrid } from "@touchline/stats"
import type { PassExplanation } from "./explain.js"
import { AdvisorError, type Session } from "./session.js"
import { xtEndValue } from "./value.js"

/** Seconds of play a clip shows before the pass, and after it. */
export const CLIP_BEFORE_S = 2
export const CLIP_AFTER_S = 8

/**
 * A pass and its better option as plays to watch (the what-if split): the match as it went, and the better pass
 * played out in one typical re-simulation. Counts and gain come from the same paired seeds as the verdict.
 */
export interface PassClip {
  readonly event_id: string
  readonly verdict: PassExplanation["verdict"]
  readonly passer_id: string
  readonly played_to: string
  readonly better_to: string | null
  /** The match as it went, one frame per tick: CLIP_BEFORE_S before the pass to CLIP_AFTER_S after (less at full time). */
  readonly real: ReadonlyArray<Frame>
  /** The same ticks with the better pass played (the same frames up to `pass_index`); null without a better option. */
  readonly variant: ReadonlyArray<Frame> | null
  /** The index of the pass's tick in the frames: the first one where the plays can differ. */
  readonly pass_index: number
  readonly seeds: number
  readonly horizon_s: number
  /** The seed shown: the one whose outcome is closest to the better option's mean (never a lucky one). */
  readonly typical_seed: number | null
  /** In how many seeds the team had a shot, and scored, after the pass played and after the better one. */
  readonly shots: { readonly played: number; readonly better: number } | null
  readonly goals: { readonly played: number; readonly better: number } | null
  /** The better option minus the pass played (xG created plus the threat left at the end), from the verdict. */
  readonly gain: Estimate | null
}

/** The index of the value closest to the mean (the first, on a tie). */
export const typicalIndex = (xs: ReadonlyArray<number>): number => {
  if (xs.length === 0) throw new AdvisorError("no outcomes to choose from")
  const mean = xs.reduce((a, v) => a + v, 0) / xs.length
  let best = 0
  xs.forEach((v, i) => {
    if (Math.abs(v - mean) < Math.abs(xs[best]! - mean)) best = i
  })
  return best
}

/** The clip for an explained pass (explainPass's answer for it, with the same seeds and horizon). */
export const passClip = (session: Session, ex: PassExplanation, xt: XtGrid): PassClip => {
  const dt = session.cfg.dt
  const before = Math.round(CLIP_BEFORE_S / dt)
  const after = Math.round(CLIP_AFTER_S / dt)
  const fork = ex.frame_id - 1
  const start = Math.max(-1, fork - before)
  const real = playAheadFrames(session.stateAt(start), fork - start + after).frames
  const played = ex.options.find((o) => o.chosen)
  if (!played) throw new AdvisorError(`the pass played in "${ex.event_id}" is not among its options`)
  const base = { event_id: ex.event_id, verdict: ex.verdict, passer_id: ex.player_id, played_to: played.receiver_id, real, pass_index: fork - start, seeds: ex.seeds, horizon_s: ex.horizon_s }
  const better = ex.verdict === "better_option_found" ? ex.better : null
  if (!better) return { ...base, better_to: null, variant: null, typical_seed: null, shots: null, goals: null, gain: null }
  const state = session.stateAt(fork)
  const side = state.players.find((p) => p.id === ex.player_id)!.side
  const ticks = Math.max(after, Math.round(ex.horizon_s / dt))
  const arm = (iv: Intervention) =>
    Array.from({ length: ex.seeds }, (_, k) => {
      const r = playAheadFrames(applyIntervention(forkState(state, k), iv), ticks)
      return { outcome: outcomeOf(r.events, r.state, side, xtEndValue(xt)), frames: r.frames }
    })
  const pass = (receiverId: string, passKind: string): Intervention => ({ kind: "pass_to", playerId: ex.player_id, receiverId, passKind })
  const playedRuns = arm(pass(played.receiver_id, played.kind))
  const betterRuns = arm(pass(better.receiver_id, better.kind))
  const typical = typicalIndex(betterRuns.map((r) => r.outcome.total))
  const count = (runs: typeof playedRuns, f: (o: (typeof runs)[number]["outcome"]) => boolean) => runs.filter((r) => f(r.outcome)).length
  return {
    ...base,
    better_to: better.receiver_id,
    variant: [...real.slice(0, base.pass_index), ...betterRuns[typical]!.frames].slice(0, real.length),
    typical_seed: typical,
    shots: { played: count(playedRuns, (o) => o.shots_for > 0), better: count(betterRuns, (o) => o.shots_for > 0) },
    goals: { played: count(playedRuns, (o) => o.goal_diff > 0), better: count(betterRuns, (o) => o.goal_diff > 0) },
    gain: better.simulated
  }
}
```

Apply this change to `packages/advisor/src/index.ts` (from the repository root):

```bash
git apply <<'PATCH'
diff --git a/packages/advisor/src/index.ts b/packages/advisor/src/index.ts
index 1af5c10..63c1199 100644
--- a/packages/advisor/src/index.ts
+++ b/packages/advisor/src/index.ts
@@ -1,3 +1,4 @@
+export * from "./clip.js"
 export * from "./explain.js"
 export * from "./position.js"
 export * from "./session.js"
PATCH
```

- [ ] **Step 4: Run the tests**

Run: `pnpm --filter @touchline/advisor test`
Expected: `16 passed`

Run: `pnpm --filter @touchline/advisor typecheck`
Expected: no errors

- [ ] **Step 5: Commit**

```bash
git add packages/advisor
git commit -m "feat(advisor): passClip — the match as it went around a pass and the better pass in its typical re-simulation (seed closest to the mean), with shot and goal counts over the verdict's seeds

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: GetWhatIf: clips on request, never past the session's frame (rpc, api)

The contract gains `WhatIfClip` (frames in the API's `PitchFrame` shape), `WhatIfNotAvailable`, the `GetWhatIf` RPC, and `Evidence.what_if`: the pass a cue's `better_option` claim names, with the verdict once known. The API's what-if module rebuilds a run folder's match (`Session.fromRun`), explains the pass and cuts its clip. A worker thread does this on request (`--import tsx`, a 10 s limit), so sessions keep playing meanwhile. Results are kept, and two viewers asking at once share one computation. Answers refuse passes the session has not reached and cut both plays at its frame. Positions are rounded to the millimetre and never `-0` (JSON would turn it into `0`).

**Files:**
- Modify: `packages/rpc/src/contracts.ts`, `packages/rpc/test/contracts.test.ts`
- Create: `apps/api/src/whatif.ts`, `apps/api/src/whatif-worker.ts`
- Modify: `apps/api/src/evidence.ts` (`what_if`), `apps/api/src/server.ts` (`GetWhatIf`, `ApiOptions.whatIf`), `apps/api/package.json` (dependencies `@touchline/advisor`, `@touchline/sim-core`)
- Test: `apps/api/test/whatif.test.ts`, `apps/api/test/server.test.ts`; `apps/web/test/why.test.tsx` (its `Evidence` fixture gains `what_if: null`)

**Interfaces:**
- Consumes: `passClip` (Task 2); `explainPass`, `Session.fromRun` (existing).
- Produces (rpc): `PassVerdict`, `WhatIfRef { event_id, verdict | null }`, `Evidence.what_if: WhatIfRef | null`, `WhatIfClip { event_id, verdict, passer_id, played_to, better_to, fps, pass_index, real: PitchFrame[], variant: PitchFrame[] | null, seeds, horizon_s, typical_seed, shots, goals, gain: {mean, se} | null }`, `WhatIfNotAvailable { event_id, reason }`, RPC `GetWhatIf { session_id, event_id } -> WhatIfClip`.
- Produces (api, `whatif.ts`): `WHATIF_FILE = "whatif.jsonl"` (in the run's `agents/`), `WHATIF_SEEDS = 20`, `WHATIF_HORIZON_S = 10`, `WHATIF_TIMEOUT_MS = 10_000`; `computeClip(dir, eventId): WhatIfClip`; `betterOptionEvents(traces): string[]`; `readWhatIfs(dir): Map<string, WhatIfClip>`; `writeWhatIfs(dir, eventIds, log?)`; `computeInWorker(dir, eventId, timeoutMs): Promise<WhatIfClip>`; `makeWhatIf(library, { compute?, timeoutMs? }) -> { clip(matchId, eventId, frame), verdict(m, eventId), match }`; `ApiOptions.whatIf?: WhatIfOptions`. `makeEvidence(library, verdictOf?)`. (Task 9 reshapes `writeWhatIfs`, `makeWhatIf` and `makeEvidence`.)

- [ ] **Step 1: Write the failing tests**

Create `apps/api/test/whatif.test.ts`:

```ts
import { mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { Effect, Exit, Schema } from "effect"
import { beforeAll, describe, expect, it } from "vitest"
import { WhatIfClip } from "@touchline/rpc"
import { decodeMomentTrace, type DomainEvent, type MomentTrace } from "@touchline/schema"
import { makeEvidence } from "../src/evidence.js"
import { readMatch, type LibraryMatch } from "../src/library.js"
import { betterOptionEvents, computeClip, computeInWorker, makeWhatIf, readWhatIfs, WHATIF_FILE, WHATIF_SEEDS, writeWhatIfs } from "../src/whatif.js"
import { league, makeLibrary, MATCH_ID, type TestLibrary } from "./fixture.js"

let lib: TestLibrary
let m: LibraryMatch
let pass: DomainEvent
let computed: WhatIfClip
beforeAll(async () => {
  lib = await makeLibrary()
  m = readMatch(lib.run, league)
  const events = readFileSync(join(lib.run, "domain.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l) as DomainEvent)
  pass = events.filter((e) => e.type === "pass" && Array.isArray(e.attrs.options) && (e.attrs.options as unknown[]).length >= 3 && e.frame_id > 600)[3]!
  computed = computeClip(lib.run, pass.id)
}, 120_000)

/** A clip that only the cache could have produced. */
const cachedClip = (): WhatIfClip => ({ ...computed, verdict: "better_option_found", better_to: computed.played_to, variant: computed.real, typical_seed: 7, shots: { played: 1, better: 6 }, goals: { played: 0, better: 2 }, gain: { mean: 0.2, se: 0.05 } })
const never = async (): Promise<WhatIfClip> => {
  throw new Error("computed instead of cached")
}
const failure = async <A, E>(e: Effect.Effect<A, E>) => {
  const exit = await Effect.runPromise(Effect.exit(e))
  return Exit.isFailure(exit) ? JSON.stringify(exit.cause) : "succeeded"
}

describe("what-if clips", () => {
  it("rebuild the match and cut the pass as it went, two seconds before to eight after, in the API's frame shape", () => {
    expect(Schema.decodeUnknownSync(WhatIfClip)(computed)).toEqual(computed)
    expect(computed).toMatchObject({ event_id: pass.id, passer_id: pass.player_id, fps: 10, pass_index: 20, seeds: WHATIF_SEEDS })
    expect(computed.real.map((f) => f.frame)).toEqual(Array.from({ length: 100 }, (_, i) => pass.frame_id - 20 + i))
    expect(computed.real[20]!.clock).toMatch(/^\d\d:\d\d\.\d\d$/)
    expect(computed.real[20]!.home[0]).toEqual({ id: computed.real[20]!.home[0]!.id, x: expect.any(Number), y: expect.any(Number) })
    if (computed.verdict !== "better_option_found") expect(computed.variant).toBeNull()
  })

  it("compute the same clip in a worker thread, and give up after the time limit", async () => {
    expect(await computeInWorker(lib.run, pass.id, 60_000)).toEqual(computed)
    await expect(computeInWorker(lib.run, pass.id, 1)).rejects.toThrow(/timed out/)
  }, 120_000)

  it("are cached per run and read back; a pass that cannot be re-simulated is skipped", () => {
    const logs: string[] = []
    const written = writeWhatIfs(lib.run, [pass.id, "nope"], (l) => logs.push(l))
    expect(written).toEqual([computed])
    expect(logs.join("\n")).toMatch(/no what-if for nope/)
    expect(readWhatIfs(lib.run)).toEqual(new Map([[pass.id, computed]]))
  }, 60_000)

  it("name the passes the agents called mistakes, once each", () => {
    const t = lib.traces[0]!
    const claim = { kind: "better_option" as const, sentence: 0, quote: "", metric_id: null, subject: null, value: null, at_frame: pass.frame_id, window_s: null, event_id: pass.id, receiver_id: "p-x" }
    const traces: MomentTrace[] = [t, decodeMomentTrace({ ...t, analysis: { ...t.analysis, claims: [claim] }, draft: { ...t.draft, claims: [claim] } })]
    expect(betterOptionEvents(traces)).toEqual([pass.id])
  })
})

describe("the what-if service", () => {
  const withCache = (clips: WhatIfClip[]) => {
    mkdirSync(join(lib.run, "agents"), { recursive: true })
    writeFileSync(join(lib.run, "agents", WHATIF_FILE), clips.map((c) => JSON.stringify(c) + "\n").join(""))
    return readMatch(lib.run, league)
  }

  it("answers a library match from its cache, cut at the session's frame", async () => {
    const lm = withCache([cachedClip()])
    const w = makeWhatIf(new Map([[MATCH_ID, lm]]), { compute: never })
    const full = await Effect.runPromise(w.clip(MATCH_ID, pass.id, 10_000_000))
    expect(full).toEqual(cachedClip())
    expect(w.verdict(lm, pass.id)).toBe("better_option_found")
    const early = await Effect.runPromise(w.clip(MATCH_ID, pass.id, pass.frame_id + 3))
    expect(early.real.map((f) => f.frame).at(-1)).toBe(pass.frame_id + 3)
    expect(early.variant).toHaveLength(early.real.length)
  })

  it("refuses passes the session has not reached, events that are not passes and unknown matches", async () => {
    const w = makeWhatIf(new Map([[MATCH_ID, withCache([cachedClip()])]]), { compute: never })
    expect(await failure(w.clip(MATCH_ID, pass.id, pass.frame_id - 1))).toMatch(/WhatIfNotAvailable.*not reached yet/)
    const goal = lib.goals[0]!
    expect(await failure(w.clip(MATCH_ID, goal.id, 10_000_000))).toMatch(/not a pass of this match/)
    expect(await failure(w.clip(MATCH_ID, "nope", 10_000_000))).toMatch(/not a pass of this match/)
    expect(await failure(w.clip("nope", pass.id, 10_000_000))).toMatch(/MatchNotFound/)
  })

  it("computes what is not cached once for everyone asking, keeps it, and reports a failure as unavailable", async () => {
    const lm = withCache([])
    let calls = 0
    const w = makeWhatIf(new Map([[MATCH_ID, lm]]), { compute: async () => (calls++, computed) })
    const [a, b] = await Promise.all([Effect.runPromise(w.clip(MATCH_ID, pass.id, 10_000_000)), Effect.runPromise(w.clip(MATCH_ID, pass.id, 10_000_000))])
    expect(a).toEqual(computed)
    expect(b).toEqual(computed)
    expect(calls).toBe(1)
    expect(w.verdict(lm, pass.id)).toBe(computed.verdict)
    const broken = makeWhatIf(new Map([[MATCH_ID, lm]]), { compute: async () => Promise.reject(new Error("timed out after 10 s")) })
    expect(await failure(broken.clip(MATCH_ID, pass.id, 10_000_000))).toMatch(/WhatIfNotAvailable.*timed out after 10 s/)
  })

  it("tells the Why? drawer which pass a cue's better-option claim names, with the verdict once known", async () => {
    const lm = withCache([cachedClip()])
    const w = makeWhatIf(new Map([[MATCH_ID, lm]]), { compute: never })
    const goal = lib.goals[0]!
    const path = join(lib.run, "agents", "traces.jsonl")
    const original = readFileSync(path, "utf8")
    const ev = makeEvidence(new Map([[MATCH_ID, lm]]), w.verdict)
    const cue = `mo-${goal.id}-casual.en.neutral`
    expect((await Effect.runPromise(ev.evidence(MATCH_ID, cue))).what_if).toBeNull()
    const traces = original.trim().split("\n").map((l) => JSON.parse(l) as MomentTrace)
    const claim = { kind: "better_option", sentence: 0, quote: "", metric_id: null, subject: null, value: null, at_frame: pass.frame_id, window_s: null, event_id: pass.id, receiver_id: "p-x" }
    traces[0] = { ...traces[0]!, analysis: { ...traces[0]!.analysis, claims: [...traces[0]!.analysis.claims, claim as never] } }
    writeFileSync(path, traces.map((t) => JSON.stringify(t) + "\n").join(""))
    try {
      const fresh = makeEvidence(new Map([[MATCH_ID, lm]]), w.verdict)
      expect((await Effect.runPromise(fresh.evidence(MATCH_ID, cue))).what_if).toEqual({ event_id: pass.id, verdict: "better_option_found" })
      const unknown = makeEvidence(new Map([[MATCH_ID, lm]]))
      expect((await Effect.runPromise(unknown.evidence(MATCH_ID, cue))).what_if).toEqual({ event_id: pass.id, verdict: null })
    } finally {
      writeFileSync(path, original)
    }
  }, 60_000)
})
```

Apply this change to `apps/api/test/server.test.ts`, `apps/web/test/why.test.tsx`, `packages/rpc/test/contracts.test.ts` (from the repository root):

```bash
git apply <<'PATCH'
diff --git a/apps/api/test/server.test.ts b/apps/api/test/server.test.ts
index 6929757..09f8cf3 100644
--- a/apps/api/test/server.test.ts
+++ b/apps/api/test/server.test.ts
@@ -22,7 +22,8 @@ let stop: () => Promise<void>
 beforeAll(async () => {
   lib = await makeLibrary()
   port = await freePort()
-  const fiber = Effect.runFork(Layer.launch(serverLayer({ library: new Map([[MATCH_ID, readMatch(lib.run, league)]]), port })))
+  // What-ifs computed on request get longer than the live limit here: a busy test machine is slower.
+  const fiber = Effect.runFork(Layer.launch(serverLayer({ library: new Map([[MATCH_ID, readMatch(lib.run, league)]]), port, whatIf: { timeoutMs: 120_000 } })))
   stop = async () => {
     fiber.interruptUnsafe()
   }
@@ -108,4 +109,24 @@ describe("API over WebSocket", () => {
     const lost = await client((c) => Effect.exit(Stream.runDrain(c.Watch({ session_id: "nope", segment: { mode: "casual", lang: "en", club: null } }))))
     expect(Exit.isFailure(lost) && JSON.stringify(lost.cause)).toContain("SessionNotFound")
   })
+
+  it("cuts a what-if clip of a pass the session has passed, computed on request, and refuses one it has not reached", async () => {
+    const { readFileSync } = await import("node:fs")
+    const passes = readFileSync(`${lib.run}/domain.jsonl`, "utf8").trim().split("\n").map((l) => JSON.parse(l) as { id: string; type: string; frame_id: number; attrs: { options?: unknown[] } })
+      .filter((e) => e.type === "pass" && (e.attrs.options ?? []).length >= 3 && e.frame_id > 6000)
+    const minute = Math.ceil(passes[0]!.frame_id / 600) + 1
+    const later = passes.find((e) => e.frame_id > (minute + 2) * 600)!
+    const { clip, early } = await client((c) =>
+      Effect.gen(function* () {
+        const s = yield* c.StartSession({ match_id: MATCH_ID, speed: 1, from_minute: minute, live: false })
+        yield* c.Control({ session_id: s.session_id, action: "pause", speed: null })
+        const clip = yield* c.GetWhatIf({ session_id: s.session_id, event_id: passes[0]!.id })
+        const early = yield* Effect.exit(c.GetWhatIf({ session_id: s.session_id, event_id: later.id }))
+        return { clip, early }
+      })
+    )
+    expect(clip.event_id).toBe(passes[0]!.id)
+    expect(clip.real.length).toBeGreaterThan(clip.pass_index)
+    expect(Exit.isFailure(early) && JSON.stringify(early.cause)).toMatch(/WhatIfNotAvailable.*not reached yet/)
+  }, 120_000)
 })
diff --git a/apps/web/test/why.test.tsx b/apps/web/test/why.test.tsx
index 60aaa1b..bedc064 100644
--- a/apps/web/test/why.test.tsx
+++ b/apps/web/test/why.test.tsx
@@ -18,7 +18,8 @@ const evidence: Evidence = {
   claims: [{ kind: "metric", quote: "6.8%", label: "Expected goals", metric_id: "shot.xg", subject: null, subject_name: null, value: 0.0678, at_frame: 19344, event_id: "e1442" }],
   series: [{ metric_id: "team.mom", subject: "larkspur", label: "Momentum — Larkspur City", points: [{ frame: 16344, value: 0.4 }, { frame: 17844, value: null }, { frame: 19344, value: 0.62 }] }],
   events: [{ id: "e1442", type: "shot", clock: "32:13.70", team_id: "larkspur", player: "Feseo Wylford", outcome: "goal", qualifiers: { body_part: "left_foot" } }],
-  model: "openai:gpt-6.1-sol"
+  model: "openai:gpt-6.1-sol",
+  what_if: null
 }
 
 describe("sparkline", () => {
diff --git a/packages/rpc/test/contracts.test.ts b/packages/rpc/test/contracts.test.ts
index 1645928..ddd9221 100644
--- a/packages/rpc/test/contracts.test.ts
+++ b/packages/rpc/test/contracts.test.ts
@@ -3,7 +3,7 @@ import { dirname, join } from "node:path"
 import { fileURLToPath } from "node:url"
 import { Schema } from "effect"
 import { describe, expect, it } from "vitest"
-import { decodeTick, MatchNotFound, MatchSummary, TouchlineRpcs } from "../src/contracts.js"
+import { decodeTick, MatchNotFound, MatchSummary, TouchlineRpcs, WhatIfClip, WhatIfNotAvailable } from "../src/contracts.js"
 
 const root = join(dirname(fileURLToPath(import.meta.url)), "../../..")
 const cue = (JSON.parse(readFileSync(join(root, "packages/schema/fixtures/agents/valid/cue.json"), "utf8")) as { value: unknown }).value
@@ -26,7 +26,7 @@ describe("API contracts", () => {
   })
 
   it("offer the endpoints of spec §5.7", () => {
-    expect([...TouchlineRpcs.requests.keys()].sort()).toEqual(["Control", "GetEvidence", "GetMatch", "GetOps", "GetRecap", "ListMatches", "StartSession", "StudioAct", "StudioWatch", "Watch", "WatchGraphics"])
+    expect([...TouchlineRpcs.requests.keys()].sort()).toEqual(["Control", "GetEvidence", "GetMatch", "GetOps", "GetRecap", "GetWhatIf", "ListMatches", "StartSession", "StudioAct", "StudioWatch", "Watch", "WatchGraphics"])
   })
 
   it("refuse playback speeds out of range", () => {
@@ -38,5 +38,17 @@ describe("API contracts", () => {
 
   it("name their errors", () => {
     expect(new MatchNotFound({ match_id: "x" })._tag).toBe("MatchNotFound")
+    expect(new WhatIfNotAvailable({ event_id: "e1", reason: "not yet" })._tag).toBe("WhatIfNotAvailable")
+  })
+
+  it("carry a what-if clip: the frames as played, and the better pass only with its verdict", () => {
+    const clip = {
+      event_id: "m-e42", verdict: "better_option_found", passer_id: "p-a-01", played_to: "p-a-07", better_to: "p-a-09", fps: 10, pass_index: 1, real: [frame, frame], variant: [frame, frame],
+      seeds: 20, horizon_s: 10, typical_seed: 8, shots: { played: 0, better: 7 }, goals: { played: 0, better: 1 }, gain: { mean: 0.12, se: 0.03 }
+    }
+    expect(Schema.decodeUnknownSync(WhatIfClip)(clip)).toEqual(clip)
+    const none = { ...clip, verdict: "played_pass_was_best", better_to: null, variant: null, typical_seed: null, shots: null, goals: null, gain: null }
+    expect(Schema.decodeUnknownSync(WhatIfClip)(none)).toEqual(none)
+    expect(() => Schema.decodeUnknownSync(WhatIfClip)({ ...clip, verdict: "maybe" })).toThrow()
   })
 })
PATCH
```

- [ ] **Step 2: Run them to make sure they fail**

Run: `pnpm --filter @touchline/rpc test`
Expected: `offer the endpoints of spec §5.7` fails (no `GetWhatIf`) and the suite cannot import `WhatIfClip`

Run: `pnpm --filter @touchline/api test whatif server`
Expected: `test/whatif.test.ts` fails to load (`../src/whatif.js` does not exist); the new server test fails (`GetWhatIf` is not a known RPC)

- [ ] **Step 3: Write the implementation**

Create `apps/api/src/whatif-worker.ts`:

```ts
/** Computes one what-if clip off the main thread (whatif.ts computeInWorker). */
import { parentPort, workerData } from "node:worker_threads"
import { computeClip } from "./whatif.js"

const { dir, eventId } = workerData as { dir: string; eventId: string }
try {
  parentPort!.postMessage({ clip: computeClip(dir, eventId) })
} catch (e) {
  parentPort!.postMessage({ error: e instanceof Error ? e.message : String(e) })
}
```

Create `apps/api/src/whatif.ts`:

```ts
/**
 * The what-if split (Plan 7): a pass a cue calls a mistake, as the match went and with the better pass played out
 * (advisor passClip). Library matches answer from the clips `pnpm library` cached next to their cue cache; anything
 * else is computed on request in a worker thread (a match rebuild plus the verdict's re-simulations: a few seconds),
 * within a time limit, and kept for the next viewer. Answers never go past the session's frame.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { Worker } from "node:worker_threads"
import { Effect, Schema } from "effect"
import { explainPass, passClip, Session } from "@touchline/advisor"
import { MatchNotFound, WhatIfClip, WhatIfNotAvailable, type PassVerdict, type PitchFrame } from "@touchline/rpc"
import { decodeDomainEvent, type DomainEvent, type MomentTrace } from "@touchline/schema"
import { DEFAULT_PARAMS, matchClock, paramsFromJson, type Frame, type TeamSetup } from "@touchline/sim-core"
import { xtGridFromJson } from "@touchline/stats"
import type { LibraryMatch } from "./library.js"
import { root } from "./playback.js"

/** The cached clips of a run, one JSON line each, in its agents/ folder. */
export const WHATIF_FILE = "whatif.jsonl"
/** Paired seeds and seconds re-simulated per option: as the explain_pass tool. */
export const WHATIF_SEEDS = 20
export const WHATIF_HORIZON_S = 10
/** A clip computed on request must arrive within this long. */
export const WHATIF_TIMEOUT_MS = 10_000

/** Rounded to the millimetre (and never -0, which JSON would not keep). */
const r3 = (v: number) => Math.round(v * 1000) / 1000 || 0

const toPitchFrame = (f: Frame, dt: number): PitchFrame => ({
  frame: f.tick,
  period: f.period,
  clock: matchClock(f.period, f.frame_id, dt),
  ball: { x: r3(f.ball.x), y: r3(f.ball.y), z: r3(f.ball.z) },
  home: f.home.map((p) => ({ id: p.id, x: r3(p.x), y: r3(p.y) })),
  away: f.away.map((p) => ({ id: p.id, x: r3(p.x), y: r3(p.y) }))
})

/** Rebuild a run folder's match, explain the pass and cut its clip (CPU only: a few seconds; throws AdvisorError). */
export const computeClip = (dir: string, eventId: string): WhatIfClip => {
  const json = (p: string) => JSON.parse(readFileSync(join(root, p), "utf8"))
  const league = json("data/league/league.json") as { clubs: ReadonlyArray<TeamSetup> }
  const session = Session.fromRun(dir, league, [paramsFromJson(json("data/params/touchline-params.json")), DEFAULT_PARAMS])
  const xt = xtGridFromJson(json("data/params/xt-grid.json"))
  const c = passClip(session, explainPass(session, eventId, xt, { seeds: WHATIF_SEEDS, horizonS: WHATIF_HORIZON_S }), xt)
  const dt = session.cfg.dt
  return {
    event_id: c.event_id, verdict: c.verdict, passer_id: c.passer_id, played_to: c.played_to, better_to: c.better_to, fps: Math.round(1 / dt), pass_index: c.pass_index,
    real: c.real.map((f) => toPitchFrame(f, dt)), variant: c.variant ? c.variant.map((f) => toPitchFrame(f, dt)) : null,
    seeds: c.seeds, horizon_s: c.horizon_s, typical_seed: c.typical_seed, shots: c.shots, goals: c.goals, gain: c.gain ? { mean: c.gain.mean, se: c.gain.se } : null
  }
}

/** The passes the agents' traces say had a better option (claims of kind better_option), first seen first. */
export const betterOptionEvents = (traces: ReadonlyArray<MomentTrace>): string[] => [
  ...new Set(traces.flatMap((t) => [...t.analysis.claims, ...t.draft.claims]).flatMap((c) => (c.kind === "better_option" && c.event_id ? [c.event_id] : [])))
]

const decodeClip = Schema.decodeUnknownSync(WhatIfClip)

/** A run's cached clips by event id (none without the file). */
export const readWhatIfs = (dir: string): Map<string, WhatIfClip> => {
  const path = join(dir, "agents", WHATIF_FILE)
  if (!existsSync(path)) return new Map()
  const clips = readFileSync(path, "utf8").split("\n").filter((l) => l.trim()).map((l) => decodeClip(JSON.parse(l)))
  return new Map(clips.map((c) => [c.event_id, c]))
}

/** Compute and cache the clip of every pass the run's traces name (passes that cannot be re-simulated are skipped). */
export const writeWhatIfs = (dir: string, eventIds: ReadonlyArray<string>, log: (line: string) => void = () => {}): WhatIfClip[] => {
  const clips: WhatIfClip[] = []
  for (const id of eventIds) {
    try {
      clips.push(computeClip(dir, id))
    } catch (e) {
      log(`  no what-if for ${id}: ${e instanceof Error ? e.message : String(e)}`)
    }
  }
  writeFileSync(join(dir, "agents", WHATIF_FILE), clips.map((c) => JSON.stringify(c) + "\n").join(""))
  log(`  ${clips.length} what-if clips (${clips.filter((c) => c.verdict === "better_option_found").length} with a better option)`)
  return clips
}

/** computeClip in a worker thread, so sessions keep playing while it runs. */
export const computeInWorker = (dir: string, eventId: string, timeoutMs: number): Promise<WhatIfClip> =>
  new Promise((resolve, reject) => {
    const worker = new Worker(new URL("./whatif-worker.ts", import.meta.url), { workerData: { dir, eventId }, execArgv: ["--import", "tsx"] })
    const timer = setTimeout(() => {
      void worker.terminate()
      reject(new Error(`timed out after ${timeoutMs / 1000} s`))
    }, timeoutMs)
    worker.once("message", (m: { clip?: WhatIfClip; error?: string }) => {
      clearTimeout(timer)
      void worker.terminate()
      m.clip ? resolve(m.clip) : reject(new Error(m.error ?? "no answer"))
    })
    worker.once("error", (e) => {
      clearTimeout(timer)
      reject(e)
    })
  })

export interface WhatIfOptions {
  /** How a clip is computed on request (default: computeInWorker within `timeoutMs`). */
  readonly compute?: (dir: string, eventId: string) => Promise<WhatIfClip>
  /** The time limit for a clip computed on request (default WHATIF_TIMEOUT_MS). */
  readonly timeoutMs?: number
}

export const makeWhatIf = (library: ReadonlyMap<string, LibraryMatch>, o: WhatIfOptions = {}) => {
  const compute = o.compute ?? ((dir: string, id: string) => computeInWorker(dir, id, o.timeoutMs ?? WHATIF_TIMEOUT_MS))
  const cached = new Map<string, Map<string, WhatIfClip>>()
  const pending = new Map<string, Promise<WhatIfClip>>()
  const events = new Map<string, ReadonlyArray<DomainEvent>>()
  const clipsOf = (m: LibraryMatch) => {
    let c = cached.get(m.info.match_id)
    if (!c) cached.set(m.info.match_id, (c = readWhatIfs(m.dir)))
    return c
  }
  const eventsOf = (m: LibraryMatch) => {
    let e = events.get(m.info.match_id)
    if (!e) {
      e = readFileSync(join(m.dir, "domain.jsonl"), "utf8").split("\n").filter((l) => l.trim()).map((l) => decodeDomainEvent(JSON.parse(l)))
      events.set(m.info.match_id, e)
    }
    return e
  }
  const match = (id: string) => Effect.fromNullishOr(library.get(id)).pipe(Effect.mapError(() => new MatchNotFound({ match_id: id })))

  /** What re-simulation has said about a pass so far (null: not computed yet). */
  const verdict = (m: LibraryMatch, eventId: string): PassVerdict | null => clipsOf(m).get(eventId)?.verdict ?? null

  /** The clip of a pass as of `frame` (frames after it are cut from both plays). */
  const clip = (matchId: string, eventId: string, frame: number) =>
    Effect.gen(function* () {
      const m = yield* match(matchId)
      const unavailable = (reason: string) => new WhatIfNotAvailable({ event_id: eventId, reason })
      const e = eventsOf(m).find((x) => x.id === eventId)
      if (!e || e.type !== "pass") return yield* unavailable("not a pass of this match")
      if (e.frame_id > frame) return yield* unavailable("not reached yet")
      const clips = clipsOf(m)
      let c = clips.get(eventId)
      if (!c) {
        const key = `${matchId}/${eventId}`
        let p = pending.get(key)
        if (!p) {
          p = compute(m.dir, eventId).finally(() => pending.delete(key))
          pending.set(key, p)
        }
        const got = yield* Effect.tryPromise({ try: () => p!, catch: (err) => unavailable(err instanceof Error ? err.message : String(err)) })
        clips.set(eventId, got)
        c = got
      }
      const n = c.real.filter((f) => f.frame <= frame).length
      return { ...c, real: c.real.slice(0, n), variant: c.variant ? c.variant.slice(0, n) : null }
    })

  return { clip, verdict, match } as const
}
```

Apply this change to `apps/api/package.json`, `apps/api/src/evidence.ts`, `apps/api/src/server.ts`, `packages/rpc/src/contracts.ts` (from the repository root):

```bash
git apply <<'PATCH'
diff --git a/apps/api/package.json b/apps/api/package.json
index b4a4fa0..363c6ad 100644
--- a/apps/api/package.json
+++ b/apps/api/package.json
@@ -15,16 +15,17 @@
   },
   "dependencies": {
     "@effect/platform-node": "4.0.1",
+    "@touchline/advisor": "workspace:*",
     "@touchline/agent-gateway": "workspace:*",
     "@touchline/mcp-stats": "workspace:*",
     "@touchline/rpc": "workspace:*",
     "@touchline/schema": "workspace:*",
     "@touchline/sim": "workspace:*",
+    "@touchline/sim-core": "workspace:*",
     "@touchline/stats": "workspace:*",
     "effect": "4.0.1"
   },
   "devDependencies": {
-    "@touchline/league": "workspace:*",
-    "@touchline/sim-core": "workspace:*"
+    "@touchline/league": "workspace:*"
   }
 }
diff --git a/apps/api/src/evidence.ts b/apps/api/src/evidence.ts
index 4d0011d..ee8dd8f 100644
--- a/apps/api/src/evidence.ts
+++ b/apps/api/src/evidence.ts
@@ -6,7 +6,7 @@ import { existsSync, readFileSync } from "node:fs"
 import { join } from "node:path"
 import { Effect } from "effect"
 import { loadRun } from "@touchline/mcp-stats"
-import { EvidenceNotFound, MatchNotFound, type Evidence, type EvidenceClaim, type RecapView, type Series } from "@touchline/rpc"
+import { EvidenceNotFound, MatchNotFound, type Evidence, type EvidenceClaim, type PassVerdict, type RecapView, type Series } from "@touchline/rpc"
 import { decodeMomentTrace, decodeRecap, type Claim, type MomentTrace, type Recap, type Segment } from "@touchline/schema"
 import { METRICS, modelsFromJson, StatsError, xtGridFromJson, type Roster, type StatsQuery } from "@touchline/stats"
 import { pickCues } from "./cues.js"
@@ -34,7 +34,10 @@ const label = (c: Claim): string => {
   return { score: "Score", minute: "Minute", event: "Event", better_option: "Better option", metric: "Metric" }[c.kind]
 }
 
-export const makeEvidence = (library: ReadonlyMap<string, LibraryMatch>) => {
+/** What re-simulation has said about a pass so far (null: not checked yet); the what-if module answers it. */
+export type VerdictOf = (m: LibraryMatch, eventId: string) => PassVerdict | null
+
+export const makeEvidence = (library: ReadonlyMap<string, LibraryMatch>, verdictOf: VerdictOf = () => null) => {
   const queries = new Map<string, Promise<StatsQuery>>()
   const params = (f: string) => JSON.parse(readFileSync(join(root, "data/params", f), "utf8"))
   const roster = JSON.parse(readFileSync(join(root, "data/league/league.json"), "utf8")) as Roster
@@ -75,6 +78,7 @@ export const makeEvidence = (library: ReadonlyMap<string, LibraryMatch>) => {
         const k = JSON.stringify([c.kind, c.metric_id, c.subject, c.event_id, c.receiver_id, c.value])
         return !seen.has(k) && (seen.add(k), true)
       })
+      const better = raw.find((c) => c.kind === "better_option" && c.event_id)?.event_id ?? null
       const who = names(m)
       const q = yield* query(m)
       const at = trace ? trace.moment.frame_to : recap!.at_frame
@@ -105,7 +109,8 @@ export const makeEvidence = (library: ReadonlyMap<string, LibraryMatch>) => {
         })),
         series,
         events,
-        model: trace?.model ?? (view?.live ? null : m.info.model)
+        model: trace?.model ?? (view?.live ? null : m.info.model),
+        what_if: better ? { event_id: better, verdict: verdictOf(m, better) } : null
       }
       return out
     })
diff --git a/apps/api/src/server.ts b/apps/api/src/server.ts
index 33d9507..d011303 100644
--- a/apps/api/src/server.ts
+++ b/apps/api/src/server.ts
@@ -13,6 +13,7 @@ import type { LibraryMatch } from "./library.js"
 import { makeOps } from "./ops.js"
 import { makeSessions, type Companion } from "./session.js"
 import { makeStudio } from "./studio.js"
+import { makeWhatIf, type WhatIfOptions } from "./whatif.js"
 
 export const RPC_PATH = "/rpc"
 
@@ -20,6 +21,8 @@ export interface ApiOptions {
   readonly library: ReadonlyMap<string, LibraryMatch>
   /** Runs alongside live sessions (the live agents, Task 7). */
   readonly companion?: Companion
+  /** How what-if clips are computed on request (tests). */
+  readonly whatIf?: WhatIfOptions
 }
 
 const summary = ({ players: _, ...s }: LibraryMatch["info"]): MatchSummary => s
@@ -28,7 +31,8 @@ const summary = ({ players: _, ...s }: LibraryMatch["info"]): MatchSummary => s
 export const handlersLayer = (o: ApiOptions) =>
   Layer.unwrap(
     Effect.gen(function* () {
-      const ev = makeEvidence(o.library)
+      const whatIf = makeWhatIf(o.library, o.whatIf)
+      const ev = makeEvidence(o.library, whatIf.verdict)
       const studio = makeStudio(ev)
       const ops = makeOps()
       const sessions = yield* makeSessions(o.library, { ...(o.companion ? { companion: o.companion } : {}), studio: studio.record })
@@ -47,6 +51,7 @@ export const handlersLayer = (o: ApiOptions) =>
         Watch: ({ session_id, segment }) => sessions.watch(session_id, segment),
         Control: ({ session_id, action, speed }) => sessions.control(session_id, action, speed),
         GetEvidence: ({ session_id, cue_id }) => view(session_id).pipe(Effect.flatMap(({ s, v }) => ev.evidence(s.match.info.match_id, cue_id, v))),
+        GetWhatIf: ({ session_id, event_id }) => view(session_id).pipe(Effect.flatMap(({ s, v }) => whatIf.clip(s.match.info.match_id, event_id, v.frame))),
         GetRecap: ({ session_id, kind, segment }) => view(session_id).pipe(Effect.flatMap(({ s, v }) => ev.recap(s.match.info.match_id, kind, segment, v))),
         StudioWatch: ({ session_id, segment }) => studio.watch(sessions, session_id, segment),
         StudioAct: ({ session_id, moment_id, action }) => sessions.get(session_id).pipe(Effect.flatMap((s) => studio.act(s, moment_id, action))),
diff --git a/packages/rpc/src/contracts.ts b/packages/rpc/src/contracts.ts
index 2b29a5d..9b58f3b 100644
--- a/packages/rpc/src/contracts.ts
+++ b/packages/rpc/src/contracts.ts
@@ -109,6 +109,13 @@ export const EvidenceEvent = Schema.Struct({
 })
 export type EvidenceEvent = typeof EvidenceEvent.Type
 
+export const PassVerdict = Schema.Literals(["played_pass_was_best", "better_option_found", "not_verified"])
+export type PassVerdict = typeof PassVerdict.Type
+
+/** A pass the cue says had a better option: the what-if split can show it; `verdict` once re-simulation has checked it (null: not yet). */
+export const WhatIfRef = Schema.Struct({ event_id: Id, verdict: Schema.NullOr(PassVerdict) })
+export type WhatIfRef = typeof WhatIfRef.Type
+
 /** Behind a cue (spec §5.6 "Why?" drawer): the moment, the cause, each checked claim, metric history and the events. */
 export const Evidence = Schema.Struct({
   cue_id: Id,
@@ -118,16 +125,48 @@ export const Evidence = Schema.Struct({
   claims: Schema.Array(EvidenceClaim),
   series: Schema.Array(Series),
   events: Schema.Array(EvidenceEvent),
-  model: Schema.NullOr(Schema.String)
+  model: Schema.NullOr(Schema.String),
+  /** The pass a "better option" claim names, if any (the "Show me" button). */
+  what_if: Schema.NullOr(WhatIfRef)
 })
 export type Evidence = typeof Evidence.Type
 
+const Arms = Schema.Struct({ played: Count, better: Count })
+
+/**
+ * A pass as the match went and with the better option played (the what-if split): frames over the same ticks, the
+ * same up to `pass_index`; the variant is the typical one of `seeds` re-simulations, and the counts are over all of them.
+ */
+export const WhatIfClip = Schema.Struct({
+  event_id: Id,
+  verdict: PassVerdict,
+  passer_id: Id,
+  played_to: Id,
+  better_to: Schema.NullOr(Id),
+  fps: Schema.Int,
+  pass_index: Count,
+  real: Schema.Array(PitchFrame),
+  /** Null unless the verdict is better_option_found. */
+  variant: Schema.NullOr(Schema.Array(PitchFrame)),
+  seeds: Count,
+  horizon_s: Schema.Finite,
+  typical_seed: Schema.NullOr(Count),
+  /** Seeds in which the team had a shot, and scored, after each pass. */
+  shots: Schema.NullOr(Arms),
+  goals: Schema.NullOr(Arms),
+  /** The better option minus the pass played: xG created plus the threat left at the end (mean and standard error over the seeds). */
+  gain: Schema.NullOr(Schema.Struct({ mean: Schema.Finite, se: Schema.Finite }))
+})
+export type WhatIfClip = typeof WhatIfClip.Type
+
 export const RecapView = Schema.Struct({ recap: Schema.NullOr(Recap), cards: Schema.Array(Cue) })
 export type RecapView = typeof RecapView.Type
 
 export class MatchNotFound extends Schema.TaggedError<MatchNotFound>()("MatchNotFound", { match_id: Schema.String }) {}
 export class SessionNotFound extends Schema.TaggedError<SessionNotFound>()("SessionNotFound", { session_id: Schema.String }) {}
 export class EvidenceNotFound extends Schema.TaggedError<EvidenceNotFound>()("EvidenceNotFound", { cue_id: Schema.String }) {}
+/** No what-if for this event: not a pass of the match, not reached yet, not re-simulatable, or it took too long. */
+export class WhatIfNotAvailable extends Schema.TaggedError<WhatIfNotAvailable>()("WhatIfNotAvailable", { event_id: Schema.String, reason: Schema.String }) {}
 
 /** Where a moment stands in the producer's queue: approved puts it in the presenter's talking points, on air sends it to graphics. */
 export const QueueStatus = Schema.Literals(["pending", "approved", "held", "on_air"])
@@ -223,6 +262,8 @@ export class TouchlineRpcs extends RpcGroup.make(
   }),
   /** What is behind a cue the session has shown (never past its frame; a live session's from its own agents). */
   Rpc.make("GetEvidence", { payload: { session_id: Schema.String, cue_id: Schema.String }, success: Evidence, error: Schema.Union([SessionNotFound, MatchNotFound, EvidenceNotFound]) }),
+  /** A pass as it went and with its better option played (never past the session's frame). */
+  Rpc.make("GetWhatIf", { payload: { session_id: Schema.String, event_id: Schema.String }, success: WhatIfClip, error: Schema.Union([SessionNotFound, MatchNotFound, WhatIfNotAvailable]) }),
   /** A recap once the session has reached its whistle (empty before). */
   Rpc.make("GetRecap", {
     payload: { session_id: Schema.String, kind: Schema.Literals(["half_time", "full_time"]), segment: Segment },
PATCH
```

- [ ] **Step 4: Install the new workspace dependencies**

Run: `pnpm install`
Expected: `Done`, with `pnpm-lock.yaml` updated for `@touchline/api`

- [ ] **Step 5: Run the tests**

Run: `pnpm --filter @touchline/rpc test`
Expected: `9 passed`

Run: `pnpm --filter @touchline/api test whatif server`
Expected: `15 passed` (8 + 7; about 40 s: each match is simulated)

Run: `pnpm --filter @touchline/web test why`
Expected: `4 passed`

Run: `pnpm --filter @touchline/rpc typecheck && pnpm --filter @touchline/api typecheck && pnpm --filter @touchline/web typecheck`
Expected: no errors

- [ ] **Step 6: Commit**

```bash
git add apps/api apps/web packages/rpc pnpm-lock.yaml
git commit -m "feat(api): GetWhatIf — a pass as it went and with its better option played, from the library's cached clips or computed on request in a worker thread (10 s limit), never past the session's frame; the Why? evidence names the pass a better-option claim points at

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: pnpm library caches the agents' what-ifs (api)

`pnpm library` writes the clip of every pass the agents' traces name as having a better option, next to the cue cache, so a library match answers "Show me" at once. (Task 9 adds the scan of every attacking pass, which is where the split's better passes really come from: agent claims are rarely verified better.)

**Files:**
- Modify: `apps/api/src/build-library.ts`
- Test: `apps/api/test/build-library.test.ts` (needs `uv`: it starts the stub agent service)

**Interfaces:**
- Consumes: `betterOptionEvents`, `writeWhatIfs`, `readWhatIfs` (Task 3).

- [ ] **Step 1: Write the failing tests**

Apply this change to `apps/api/test/build-library.test.ts` (from the repository root):

```bash
git apply <<'PATCH'
diff --git a/apps/api/test/build-library.test.ts b/apps/api/test/build-library.test.ts
index a17fb0f..05d1739 100644
--- a/apps/api/test/build-library.test.ts
+++ b/apps/api/test/build-library.test.ts
@@ -1,12 +1,13 @@
 import { spawn, type ChildProcess } from "node:child_process"
-import { mkdtempSync, rmSync } from "node:fs"
+import { mkdtempSync, readFileSync, rmSync } from "node:fs"
 import { createServer } from "node:net"
 import { tmpdir } from "node:os"
 import { join } from "node:path"
 import { afterAll, describe, expect, it } from "vitest"
-import { segmentKey } from "@touchline/schema"
+import { decodeMomentTrace, segmentKey } from "@touchline/schema"
 import { BuildError, buildLibrary, librarySegments } from "../src/build-library.js"
 import { scanLibrary } from "../src/library.js"
+import { betterOptionEvents, readWhatIfs } from "../src/whatif.js"
 import { league, root } from "./fixture.js"
 
 const freePort = () => new Promise<number>((ok) => {
@@ -57,5 +58,9 @@ describe("library builder", () => {
     expect(m.info.segments).toHaveLength(12)
     expect(m.info.model).toBe("stub")
     expect(m.cues.length).toBeGreaterThan(100)
+    // Every pass the agents said had a better option has its what-if clip cached (the scenario has at least one).
+    const named = betterOptionEvents(readFileSync(join(m.dir, "agents", "traces.jsonl"), "utf8").trim().split("\n").map((l) => decodeMomentTrace(JSON.parse(l))))
+    expect(named.length).toBeGreaterThan(0)
+    expect([...readWhatIfs(m.dir).keys()].sort()).toEqual([...named].sort())
   }, 300_000)
 })
PATCH
```

- [ ] **Step 2: Run them to make sure they fail**

Run: `pnpm --filter @touchline/api test build-library`
Expected: `caches the agents' cues …` fails: no clip is cached for the passes the traces name

- [ ] **Step 3: Write the implementation**

Apply this change to `apps/api/src/build-library.ts` (from the repository root):

```bash
git apply <<'PATCH'
diff --git a/apps/api/src/build-library.ts b/apps/api/src/build-library.ts
index a57eaf7..b033a0f 100644
--- a/apps/api/src/build-library.ts
+++ b/apps/api/src/build-library.ts
@@ -1,6 +1,7 @@
 /**
  * Fill the match library: simulate the built-in scenarios and run each through the agent service (pnpm agents'
- * gateway), so every match plays with its cached cues (spec §6 cached replay). Deterministic for a stub model.
+ * gateway), so every match plays with its cached cues (spec §6 cached replay), and cache the what-if clip of every
+ * pass the agents called a mistake. Deterministic for a stub model.
  */
 import { spawnSync } from "node:child_process"
 import { join } from "node:path"
@@ -9,6 +10,7 @@ import { a2aSender, DEFAULT_OPTIONS, replaySignals, runGateway, startMcpStats, s
 import type { Segment } from "@touchline/schema"
 import { SCENARIOS } from "@touchline/sim"
 import { root } from "./playback.js"
+import { betterOptionEvents, writeWhatIfs } from "./whatif.js"
 
 export class BuildError extends Error {}
 
@@ -47,6 +49,8 @@ export const buildLibrary = async (o: BuildOptions): Promise<string[]> => {
         writeCache(dir, result)
         const s = summarize(result)
         log(`  ${s.moments} moments, ${s.cues} cues (${s.models.join(", ") || "no model"})`)
+        // The what-if split answers library matches at once: every pass the agents called a mistake, re-simulated now.
+        writeWhatIfs(dir, betterOptionEvents(result.traces), log)
       } finally {
         mcp.stop()
       }
PATCH
```

- [ ] **Step 4: Run the tests**

Run: `pnpm --filter @touchline/api test build-library`
Expected: `3 passed` (about 2 min)

- [ ] **Step 5: Commit**

```bash
git add apps/api
git commit -m "feat(api): pnpm library caches the what-if clip of every pass the agents called a mistake, so library matches answer the split at once

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: 3D motion maths: interpolation, facing, gait and our kick (web)

The pure maths of the 3D view, with no three.js and so tested without a GPU. It covers:

- Pitch-to-world coordinates.
- Positions between two frames, with velocity worked out from the move between them. Frames carry no velocity (spec §10 ruling 2).
- `LiveBuffer`, which plays the session's frames a little behind the newest one: 80 ms, or 1.5 gaps between arriving frames when they come further apart, at most 400 ms. It holds the last frame when the stream stalls and starts afresh on a seek back.
- Facing: where the player runs, or toward the ball when standing.
- The gait clip by speed, played at a rate matched to the speed so feet do not slide.
- Our own kick: keyframes about each bone's local x over 0.7 s with the strike at 0.45 s, sign −1 on this rig. A kick is found wherever the ball speeds up by more than 4 m/s to over 6 m/s within 2 m of a player, counted once per touch. The kicker squares up to where the ball goes.

This task also adds three.js and React Three Fiber to the web app.

**Files:**
- Modify: `apps/web/package.json` (dependencies `three` 0.186.1, `@react-three/fiber` 9.8.1; dev dependency `@types/three` 0.186.0)
- Create: `apps/web/src/view3d/motion.ts`, `apps/web/src/view3d/kick.ts`
- Test: `apps/web/test/motion.test.ts`

**Interfaces:**
- Produces (`motion.ts`): `Vec3`; `toWorld(x, y, z = 0): Vec3`; `PlayerSample { x, y, vx, vy }`; `Sample { frame, ball: {x, y, z}, players: Map<string, PlayerSample> }`; `between(a, b, u, fps): Sample`; `sampleClip(frames, f, fps): Sample | null`; `MIN_DELAY_MS = 80`, `DELAY_GAPS = 1.5`, `MAX_DELAY_MS = 400`; `class LiveBuffer(fps, keep = 64) { push(frame, at); frames; delay; sample(now) }`; `FACE_BALL_BELOW = 0.6`; `yawOf(dx, dy)`; `wantedYaw(p, ball): number | null`; `turnToward(yaw, want, dt, rate)`; `GAITS` (clips `Idle_Loop`, `Walk_Loop`, `Jog_Fwd_Loop`, `Sprint_Loop` from 0, 0.5, 2.2, 5 m/s); `Gait`; `gaitOf(speed)`; `gaitRate(clip, speed)`; `blendGaits(w, target, dt)`.
- Produces (`kick.ts`): `KICK_S = 0.7`, `KICK_STRIKE = 0.45`, `KICK_SIGN = -1`, `KickPart`, `KICK_KEYS`, `keyAt(keys, t)`, `kickPose(t): Record<KickPart, number>`, `Kick { player_id, start, yaw }`, `KICK_JUMP = 4`, `KICK_SPEED = 6`, `KICK_REACH = 2`, `findKicks(frames, fps): Kick[]`, `kickAt(kicks, playerId, frame, fps): { kick, t } | null`.

- [ ] **Step 1: Write the failing tests**

Create `apps/web/test/motion.test.ts`:

```ts
import { describe, expect, it } from "vitest"
import type { PitchFrame } from "@touchline/rpc"
import { findKicks, KICK_S, KICK_STRIKE, kickAt, kickPose, keyAt, KICK_KEYS } from "../src/view3d/kick.js"
import { between, blendGaits, gaitOf, gaitRate, LiveBuffer, MAX_DELAY_MS, MIN_DELAY_MS, sampleClip, toWorld, turnToward, wantedYaw, yawOf } from "../src/view3d/motion.js"

/** A frame with one player each side and the ball. */
const frame = (n: number, a: [number, number], b: [number, number], ball: [number, number, number] = [0, 0, 0]): PitchFrame => ({
  frame: n, period: "first_half", clock: "00:00.00", ball: { x: ball[0], y: ball[1], z: ball[2] }, home: [{ id: "h", x: a[0], y: a[1] }], away: [{ id: "a", x: b[0], y: b[1] }]
})

describe("pitch to world", () => {
  it("keeps metres: x along, height up, pitch y toward the viewer's -z", () => {
    expect(toWorld(10, 5, 2)).toEqual([10, 2, -5])
    expect(toWorld(-52.5, 0)).toEqual([-52.5, 0, -0])
  })
})

describe("interpolation", () => {
  it("places players and the ball between two frames, with velocity from the move between them", () => {
    const s = between(frame(10, [0, 0], [5, 5], [0, 0, 0]), frame(12, [1, 0], [5, 3], [2, 0, 1]), 0.25, 10)
    expect(s.frame).toBe(10.5)
    expect(s.ball).toEqual({ x: 0.5, y: 0, z: 0.25 })
    expect(s.players.get("h")).toEqual({ x: 0.25, y: 0, vx: 5, vy: 0 }) // 1 m in 0.2 s
    expect(s.players.get("a")).toEqual({ x: 5, y: 4.5, vx: 0, vy: -10 })
  })

  it("holds a player who left the pitch where they were", () => {
    const b = { ...frame(11, [1, 0], [0, 0]), away: [] }
    expect(between(frame(10, [0, 0], [3, 3]), b, 0.5, 10).players.get("a")).toEqual({ x: 3, y: 3, vx: 0, vy: 0 })
  })

  it("samples a clip at a fractional index and holds at its ends", () => {
    const clip = [frame(0, [0, 0], [0, 0]), frame(1, [1, 0], [0, 0]), frame(2, [3, 0], [0, 0])]
    expect(sampleClip(clip, 1.5, 10)!.players.get("h")!.x).toBe(2)
    expect(sampleClip(clip, -4, 10)!.players.get("h")!.x).toBe(0)
    expect(sampleClip(clip, 9, 10)!.players.get("h")!.x).toBe(3)
    expect(sampleClip([], 0, 10)).toBeNull()
  })
})

describe("live frames", () => {
  it("play a little behind the newest frame, between the two around that time", () => {
    const b = new LiveBuffer(10)
    expect(b.sample(0)).toBeNull()
    for (let i = 0; i < 10; i++) b.push(frame(i, [i, 0], [0, 0]), i * 40) // every 40 ms
    expect(b.delay).toBe(MIN_DELAY_MS)
    const s = b.sample(360 + 20)! // 80 ms behind 380 ms: 300 ms, between frames 7 and 8 at a half
    expect(s.frame).toBeCloseTo(7.5)
    expect(s.players.get("h")!.x).toBeCloseTo(7.5)
  })

  it("wait longer when frames come further apart, within a limit", () => {
    const slow = new LiveBuffer(10)
    for (let i = 0; i < 10; i++) slow.push(frame(i, [0, 0], [0, 0]), i * 100)
    expect(slow.delay).toBe(150)
    const stalled = new LiveBuffer(10)
    for (let i = 0; i < 10; i++) stalled.push(frame(i, [0, 0], [0, 0]), i * 2000)
    expect(stalled.delay).toBe(MAX_DELAY_MS)
  })

  it("hold the newest frame, standing, when no newer one comes; ignore repeats; start afresh on a seek back", () => {
    const b = new LiveBuffer(10)
    b.push(frame(5, [0, 0], [0, 0]), 0)
    b.push(frame(6, [1, 0], [0, 0]), 40)
    b.push(frame(6, [9, 9], [0, 0]), 50)
    expect(b.frames.map((f) => f.frame)).toEqual([5, 6])
    expect(b.sample(10_000)!.players.get("h")).toEqual({ x: 1, y: 0, vx: 0, vy: 0 })
    b.push(frame(2, [0, 0], [0, 0]), 60)
    expect(b.frames.map((f) => f.frame)).toEqual([2])
  })

  it("keep a bounded number of frames", () => {
    const b = new LiveBuffer(10, 4)
    for (let i = 0; i < 10; i++) b.push(frame(i, [0, 0], [0, 0]), i * 40)
    expect(b.frames.map((f) => f.frame)).toEqual([6, 7, 8, 9])
  })
})

describe("facing and gait", () => {
  it("faces where a player runs, or the ball when standing", () => {
    expect(yawOf(0, -1)).toBe(0)
    expect(wantedYaw({ x: 0, y: 0, vx: 3, vy: 0 }, { x: -10, y: 0 })).toBeCloseTo(Math.PI / 2)
    expect(wantedYaw({ x: 0, y: 0, vx: 0.1, vy: 0 }, { x: -10, y: 0 })).toBeCloseTo(-Math.PI / 2)
    expect(wantedYaw({ x: 0, y: 0, vx: 0, vy: 0 }, { x: 0, y: 0 })).toBeNull()
  })

  it("turns the short way round, eased, never past the target", () => {
    expect(turnToward(3, -3, 0.1, 5)).toBeGreaterThan(3) // across ±π, not back through 0
    expect(turnToward(0, 1, 10, 5)).toBe(1)
    expect(turnToward(0, 1, 0.1, 5)).toBeCloseTo(0.5)
  })

  it("picks the clip by speed and plays it at the speed run, within natural limits", () => {
    expect([0, 0.6, 3, 8].map(gaitOf)).toEqual(["Idle_Loop", "Walk_Loop", "Jog_Fwd_Loop", "Sprint_Loop"])
    expect(gaitRate("Sprint_Loop", 7)).toBe(1)
    expect(gaitRate("Jog_Fwd_Loop", 10)).toBe(1.5)
    expect(gaitRate("Walk_Loop", 0.5)).toBe(0.6)
    expect(gaitRate("Idle_Loop", 0)).toBe(1)
  })

  it("blends clip weights toward the target, summing to one", () => {
    let w = { Idle_Loop: 1, Walk_Loop: 0, Jog_Fwd_Loop: 0, Sprint_Loop: 0 }
    w = blendGaits(w, "Sprint_Loop", 0.1)
    expect(w.Sprint_Loop).toBeCloseTo(0.6)
    expect(Object.values(w).reduce((a, v) => a + v, 0)).toBeCloseTo(1)
    expect(blendGaits(w, "Sprint_Loop", 1).Sprint_Loop).toBe(1)
  })
})

describe("kicks", () => {
  /** The ball rolls slowly to the home player, who plays it away fast along +x. */
  const pass = (step = 1): PitchFrame[] =>
    Array.from({ length: 12 }, (_, i) => i * step).map((n) => {
      const after = n > 5
      const bx = after ? 0.3 + (n - 5) * 1.5 : -1.2 + n * 0.3
      return frame(n, [0, 0.5], [20, 0], [bx, 0, 0])
    })

  it("are found where the ball speeds up beside a player, squared up to where it goes", () => {
    const [k, ...rest] = findKicks(pass(), 10)
    expect(rest).toHaveLength(0)
    expect(k!.player_id).toBe("h")
    expect(k!.start).toBeCloseTo(5 - KICK_STRIKE * KICK_S * 10)
    expect(k!.yaw).toBeCloseTo(Math.PI / 2)
    expect(kickAt([k!], "h", 5, 10)!.t).toBeCloseTo(KICK_STRIKE)
    expect(kickAt([k!], "a", 5, 10)).toBeNull()
    expect(kickAt([k!], "h", 5 + KICK_S * 10, 10)).toBeNull()
  })

  it("are found the same when frames skip, and not when nobody is near the ball", () => {
    expect(findKicks(pass(2), 10).map((k) => k.player_id)).toEqual(["h"])
    const alone = pass().map((f) => ({ ...f, home: [{ id: "h", x: 0, y: 9 }] }))
    expect(findKicks(alone, 10)).toEqual([])
  })

  it("wind up, strike and follow through, and leave the body as it was at either end", () => {
    expect(keyAt(KICK_KEYS.thigh, 0.3)).toBeCloseTo((-35 * Math.PI) / 180)
    expect(keyAt(KICK_KEYS.thigh, 0.65)).toBeCloseTo((75 * Math.PI) / 180)
    for (const t of [0, 1, -0.1, 1.2]) for (const v of Object.values(kickPose(t))) expect(v).toBeCloseTo(0)
    expect(kickPose(0.65).thigh).toBeCloseTo((-75 * Math.PI) / 180) // the rig's sign
  })
})
```

- [ ] **Step 2: Run them to make sure they fail**

Run: `pnpm --filter @touchline/web test motion`
Expected: `test/motion.test.ts` fails to load: `../src/view3d/kick.js` does not exist

- [ ] **Step 3: Write the implementation**

Create `apps/web/src/view3d/kick.ts`:

```ts
/**
 * Our own kick (Touchline, CC0; no CC0 kick exists for the player rig): bone rotations keyed over KICK_S seconds and
 * laid over the running animation, found wherever the ball suddenly speeds up beside a player. Pure.
 */
import type { PitchFrame } from "@touchline/rpc"
import { yawOf } from "./motion.js"

/** Seconds a kick takes, and the share of it at which the foot strikes the ball. */
export const KICK_S = 0.7
export const KICK_STRIKE = 0.45
/** The rig's bones turn the other way about their local x. */
export const KICK_SIGN = -1

export type KickPart = "thigh" | "shin" | "foot" | "support" | "spine"

/** Degrees about each bone's local x at points of the kick (0 to 1): wind up, strike at KICK_STRIKE, follow through. */
export const KICK_KEYS: Readonly<Record<KickPart, ReadonlyArray<readonly [number, number]>>> = {
  thigh: [[0, 0], [0.3, -35], [0.45, 40], [0.65, 75], [1, 0]],
  shin: [[0, 0], [0.3, 95], [0.45, 15], [0.65, 10], [1, 0]],
  foot: [[0, 0], [0.3, 25], [0.45, -20], [0.65, -10], [1, 0]],
  support: [[0, 0], [0.4, 18], [0.6, 22], [1, 0]],
  spine: [[0, 0], [0.4, -6], [0.6, -10], [1, 0]]
}

/** The angle (radians) of keys at t, eased between keys; 0 outside the kick. */
export const keyAt = (keys: ReadonlyArray<readonly [number, number]>, t: number): number => {
  if (t < 0 || t > 1) return 0
  for (let i = 1; i < keys.length; i++) {
    if (t <= keys[i]![0]) {
      const [t0, a] = keys[i - 1]!
      const [t1, b] = keys[i]!
      const u = (t - t0) / (t1 - t0)
      const e = u * u * (3 - 2 * u)
      return ((a + (b - a) * e) * Math.PI) / 180
    }
  }
  return 0
}

/** Each bone's rotation (radians about its local x, signed for the rig) at t of a kick. */
export const kickPose = (t: number): Record<KickPart, number> =>
  Object.fromEntries((Object.keys(KICK_KEYS) as KickPart[]).map((k) => [k, KICK_SIGN * keyAt(KICK_KEYS[k], t)])) as Record<KickPart, number>

export interface Kick {
  readonly player_id: string
  /** The match frame the kick starts on (fractional), so the strike lands on the ball's change of speed. */
  readonly start: number
  /** The yaw the kicker squares up to: the ball's way after the kick. */
  readonly yaw: number
}

/** A kick: the ball's speed jumps by more than this (m/s) ... */
export const KICK_JUMP = 4
/** ... to more than this, ... */
export const KICK_SPEED = 6
/** ... with a player within this distance (m). */
export const KICK_REACH = 2

/** Every kick in a run of frames (frames may skip: speeds use the frame numbers), one per touch. */
export const findKicks = (frames: ReadonlyArray<PitchFrame>, fps: number): Kick[] => {
  const speed = (i: number) => {
    const a = frames[i]!
    const b = frames[i + 1]!
    return Math.hypot(b.ball.x - a.ball.x, b.ball.y - a.ball.y) / ((b.frame - a.frame) / fps)
  }
  const out: Kick[] = []
  for (let i = 1; i < frames.length - 1; i++) {
    const s = speed(i)
    if (!(s - speed(i - 1) > KICK_JUMP && s > KICK_SPEED)) continue
    const f = frames[i]!
    const near = [...f.home, ...f.away].reduce((m, p) => (Math.hypot(p.x - f.ball.x, p.y - f.ball.y) < Math.hypot(m.x - f.ball.x, m.y - f.ball.y) ? p : m))
    if (Math.hypot(near.x - f.ball.x, near.y - f.ball.y) >= KICK_REACH) continue
    // One kick per touch: the ball can still be speeding up a frame later (frames skip at high speeds).
    const prev = out.at(-1)
    if (prev && prev.player_id === near.id && f.frame - prev.start < KICK_S * fps) continue
    const next = frames[i + 1]!
    out.push({ player_id: near.id, start: f.frame - KICK_STRIKE * KICK_S * fps, yaw: yawOf(next.ball.x - f.ball.x, next.ball.y - f.ball.y) })
  }
  return out
}

/** The kick a player is in at a frame, and how far through it (0 to 1). */
export const kickAt = (kicks: ReadonlyArray<Kick>, playerId: string, frame: number, fps: number): { readonly kick: Kick; readonly t: number } | null => {
  for (const k of kicks) {
    const t = (frame - k.start) / (KICK_S * fps)
    if (k.player_id === playerId && t >= 0 && t < 1) return { kick: k, t }
  }
  return null
}
```

Create `apps/web/src/view3d/motion.ts`:

```ts
/**
 * Motion for the 3D view (Plan 7), pure: pitch metres to the 3D world, frames interpolated in time, and each player's
 * speed, facing and gait. No three.js here, so it is tested without a GPU.
 */
import type { PitchFrame } from "@touchline/rpc"

export type Vec3 = readonly [number, number, number]

/** Pitch metres (x along, y across, z up) to the world (x along, y up, z = -y): metres throughout. */
export const toWorld = (x: number, y: number, z = 0): Vec3 => [x, z, -y]

export interface PlayerSample {
  readonly x: number
  readonly y: number
  /** Velocity in m/s on the pitch, from the move between the two frames around the sample. */
  readonly vx: number
  readonly vy: number
}

export interface Sample {
  /** Match time in frames (fractional between two frames). */
  readonly frame: number
  readonly ball: { readonly x: number; readonly y: number; readonly z: number }
  readonly players: ReadonlyMap<string, PlayerSample>
}

const lerp = (a: number, b: number, u: number) => a + (b - a) * u

/** Positions part-way (u from 0 to 1) from frame a to frame b; velocities from the move between them. */
export const between = (a: PitchFrame, b: PitchFrame, u: number, fps: number): Sample => {
  const secs = (b.frame - a.frame) / fps
  const next = new Map([...b.home, ...b.away].map((p) => [p.id, p]))
  const players = new Map<string, PlayerSample>()
  for (const p of [...a.home, ...a.away]) {
    const q = next.get(p.id) ?? p // a player who left the pitch stays where they were
    players.set(p.id, { x: lerp(p.x, q.x, u), y: lerp(p.y, q.y, u), vx: secs > 0 ? (q.x - p.x) / secs : 0, vy: secs > 0 ? (q.y - p.y) / secs : 0 })
  }
  return { frame: lerp(a.frame, b.frame, u), ball: { x: lerp(a.ball.x, b.ball.x, u), y: lerp(a.ball.y, b.ball.y, u), z: lerp(a.ball.z, b.ball.z, u) }, players }
}

/** A clip at a fractional index into its frames (held at either end). */
export const sampleClip = (frames: ReadonlyArray<PitchFrame>, f: number, fps: number): Sample | null => {
  if (frames.length === 0) return null
  if (frames.length === 1) return between(frames[0]!, frames[0]!, 0, fps)
  const i = Math.max(0, Math.min(frames.length - 2, Math.floor(f)))
  return between(frames[i]!, frames[i + 1]!, Math.max(0, Math.min(1, f - i)), fps)
}

/** The render delay behind the newest frame: at least this, ... */
export const MIN_DELAY_MS = 80
/** ... or this many gaps between arriving frames when they come further apart, up to MAX_DELAY_MS. */
export const DELAY_GAPS = 1.5
export const MAX_DELAY_MS = 400

/**
 * Frames as a session sends them, played a little behind the newest so motion is smooth between them (they arrive
 * every 40 ms or more, with network jitter). A frame earlier than the newest (a seek back) starts afresh.
 */
export class LiveBuffer {
  private readonly arrivals: Array<{ frame: PitchFrame; at: number }> = []

  constructor(
    readonly fps: number,
    readonly keep = 64
  ) {}

  push(frame: PitchFrame, at: number): void {
    const last = this.arrivals.at(-1)
    if (last && frame.frame === last.frame.frame) return
    if (last && frame.frame < last.frame.frame) this.arrivals.length = 0
    this.arrivals.push({ frame, at })
    if (this.arrivals.length > this.keep) this.arrivals.shift()
  }

  /** The frames held, oldest first (kicks are found in them). */
  get frames(): ReadonlyArray<PitchFrame> {
    return this.arrivals.map((a) => a.frame)
  }

  get delay(): number {
    const gaps = this.arrivals.slice(-9).flatMap((a, i, xs) => (i > 0 ? [a.at - xs[i - 1]!.at] : [])).sort((a, b) => a - b)
    const median = gaps.length ? gaps[Math.floor(gaps.length / 2)]! : 0
    return Math.min(MAX_DELAY_MS, Math.max(MIN_DELAY_MS, median * DELAY_GAPS))
  }

  /** The match as it should look at wall-clock time `now` (ms): between the two frames around now minus the delay. */
  sample(now: number): Sample | null {
    const xs = this.arrivals
    if (xs.length === 0) return null
    const t = now - this.delay
    if (t <= xs[0]!.at) return between(xs[0]!.frame, xs[0]!.frame, 0, this.fps)
    for (let i = 1; i < xs.length; i++) {
      const a = xs[i - 1]!
      const b = xs[i]!
      if (t <= b.at) return between(a.frame, b.frame, (t - a.at) / (b.at - a.at), this.fps)
    }
    // Behind on frames (paused, or the stream stalled): hold the newest, standing.
    const last = xs.at(-1)!.frame
    return between(last, last, 0, this.fps)
  }
}

/** Below this speed (m/s) a player faces the ball instead of the way they move. */
export const FACE_BALL_BELOW = 0.6

/** The yaw that faces along a pitch direction (0 faces the world's +z, which is pitch -y). */
export const yawOf = (dx: number, dy: number): number => Math.atan2(dx, -dy)

/** The yaw a player wants: where they run, or toward the ball when (nearly) standing still. */
export const wantedYaw = (p: PlayerSample, ball: { readonly x: number; readonly y: number }): number | null => {
  const moving = Math.hypot(p.vx, p.vy) > FACE_BALL_BELOW
  const dx = moving ? p.vx : ball.x - p.x
  const dy = moving ? p.vy : ball.y - p.y
  return dx * dx + dy * dy > 1e-4 ? yawOf(dx, dy) : null
}

/** Turn from `yaw` toward `want` by the shortest way, at `rate` per second (eased, never past it). */
export const turnToward = (yaw: number, want: number, dt: number, rate: number): number => {
  const d = Math.atan2(Math.sin(want - yaw), Math.cos(want - yaw))
  return yaw + d * Math.min(1, dt * rate)
}

/** The animation clips, from the speed (m/s) each takes over and the speed it is animated at. */
export const GAITS = [
  { clip: "Idle_Loop", from: 0, natural: 1 },
  { clip: "Walk_Loop", from: 0.5, natural: 1.4 },
  { clip: "Jog_Fwd_Loop", from: 2.2, natural: 3.6 },
  { clip: "Sprint_Loop", from: 5, natural: 7 }
] as const
export type Gait = (typeof GAITS)[number]["clip"]

/** The clip for a speed. */
export const gaitOf = (speed: number): Gait => [...GAITS].reverse().find((g) => speed >= g.from)!.clip

/** How fast a clip plays for a speed, so feet do not slide (idle at its own pace; capped to look natural). */
export const gaitRate = (clip: Gait, speed: number): number => {
  if (clip === "Idle_Loop") return 1
  const g = GAITS.find((x) => x.clip === clip)!
  return Math.min(1.5, Math.max(0.6, speed / g.natural))
}

/** Clip weights eased toward the target clip (all weights sum to one). */
export const blendGaits = (w: Readonly<Record<Gait, number>>, target: Gait, dt: number): Record<Gait, number> => {
  const k = Math.min(1, dt * 6)
  const out = Object.fromEntries(GAITS.map((g) => [g.clip, w[g.clip] + ((g.clip === target ? 1 : 0) - w[g.clip]) * k])) as Record<Gait, number>
  const sum = GAITS.reduce((a, g) => a + out[g.clip], 0)
  for (const g of GAITS) out[g.clip] /= sum
  return out
}
```

Apply this change to `apps/web/package.json` (from the repository root):

```bash
git apply <<'PATCH'
diff --git a/apps/web/package.json b/apps/web/package.json
index 40f4d02..b12c813 100644
--- a/apps/web/package.json
+++ b/apps/web/package.json
@@ -11,11 +11,13 @@
   },
   "dependencies": {
     "@effect/platform-browser": "4.0.1",
+    "@react-three/fiber": "9.8.1",
     "@touchline/rpc": "workspace:*",
     "@touchline/schema": "workspace:*",
     "effect": "4.0.1",
     "react": "19.3.0",
-    "react-dom": "19.3.0"
+    "react-dom": "19.3.0",
+    "three": "0.186.1"
   },
   "devDependencies": {
     "@tailwindcss/vite": "4.3.3",
@@ -25,6 +27,7 @@
     "@touchline/api": "workspace:*",
     "@types/react": "19.3.0",
     "@types/react-dom": "19.3.0",
+    "@types/three": "0.186.0",
     "@vitejs/plugin-react": "6.1.2",
     "jsdom": "30.1.2",
     "tailwindcss": "4.3.3",
PATCH
```

- [ ] **Step 4: Install three.js and React Three Fiber**

Run: `pnpm install`
Expected: `Done`; `pnpm-lock.yaml` now has `three@0.186.1`, `@react-three/fiber@9.8.1`, `@types/three@0.186.0`

- [ ] **Step 5: Run the tests**

Run: `pnpm --filter @touchline/web test motion`
Expected: `15 passed`

Run: `pnpm --filter @touchline/web typecheck`
Expected: no errors

- [ ] **Step 6: Commit**

```bash
git add apps/web pnpm-lock.yaml
git commit -m "feat(web): 3D motion maths — pitch to world, frames interpolated a little behind the stream, facing, gait by speed, and our own kick found where the ball speeds up beside a player

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Cameras and layouts (web)

The four cameras as pure functions of the followed player, the ball and the camera's previous pose. Follow sits 7 m back and 3.2 m up, pulling back as the ball gets further away, and is spring-damped. First-person is at a 1.72 m eye height with a 75° field of view, turns at most 90°/s, and has a subtle head-bob. Broadcast is high in the main stand, panning with the ball. Tactical is an orthographic top-down view of the whole pitch. The layouts are main + map, a 2×2 grid, single, and the what-if split. Below 768 px there is one view, and split halves stack. The module also finds the viewport and player under a click.

**Files:**
- Create: `apps/web/src/view3d/cameras.ts`, `apps/web/src/view3d/layout.ts`
- Test: `apps/web/test/cameras.test.ts`

**Interfaces:**
- Consumes: `toWorld`, `PlayerSample`, `Vec3` (Task 5).
- Produces (`cameras.ts`): `CameraKind = "follow" | "fp" | "broadcast" | "tactical"`, `CAMERAS`; `Rig { kind, pos, look, dir }`; `Shot` (`perspective` with `fov`, or `ortho` with `halfW`, `halfH`); `FOLLOW_FOV = 55`, `FP_FOV = 75`, `BROADCAST_FOV = 26`, `EYE_M = 1.72`, `FP_MAX_TURN = π/2`; `steer(dir, want, dt, rate, maxTurn)`; `Scene { player | null, ball }`; `poseCamera(kind, prev, scene, dt, aspect, time = 0): { shot, rig }` (follow and fp throw without a player).
- Produces (`layout.ts`): `Layout = "pip" | "grid" | "single"`, `LAYOUTS`, `NARROW_PX = 768`; `Viewport { key, x, y, w, h, world: "real" | "variant", camera, inset }`; `viewports({ mode: "multi" | "split", layout, camera, w, h }): Viewport[]`; `viewportAt(vps, x, y)`; `nearestOnScreen(points, x, y, maxPx = 50)`.

- [ ] **Step 1: Write the failing tests**

Create `apps/web/test/cameras.test.ts`:

```ts
import { describe, expect, it } from "vitest"
import { BROADCAST_FOV, EYE_M, FP_MAX_TURN, poseCamera, steer, type Scene } from "../src/view3d/cameras.js"
import { nearestOnScreen, NARROW_PX, viewportAt, viewports } from "../src/view3d/layout.js"

const runner = (x: number, y: number, vx = 0, vy = 0) => ({ x, y, vx, vy })
const scene = (player: Scene["player"], ball: [number, number, number] = [0, 0, 0]): Scene => ({ player, ball: { x: ball[0], y: ball[1], z: ball[2] } })
const dist = (a: readonly number[], b: readonly number[]) => Math.hypot(a[0]! - b[0]!, a[1]! - b[1]!, a[2]! - b[2]!)

describe("follow camera", () => {
  it("sits behind and above the player, looking ahead of them toward the ball", () => {
    const { shot } = poseCamera("follow", null, scene(runner(0, 0, 0, 0), [10, 0, 0]), 0.016, 16 / 9)
    if (shot.kind !== "perspective") throw new Error("perspective")
    expect(shot.pos[0]).toBeLessThan(-7) // behind: the ball is ahead along +x
    expect(shot.pos[1]).toBeGreaterThan(3)
    expect(shot.look[0]).toBeGreaterThan(0)
  })

  it("pulls back when the ball is far, so both stay in frame", () => {
    const near = poseCamera("follow", null, scene(runner(0, 0), [5, 0, 0]), 0.016, 1).shot
    const far = poseCamera("follow", null, scene(runner(0, 0), [40, 0, 0]), 0.016, 1).shot
    expect(dist(far.pos, [0, 0, 0])).toBeGreaterThan(dist(near.pos, [0, 0, 0]) + 5)
  })

  it("moves smoothly from its last pose instead of jumping", () => {
    const a = poseCamera("follow", null, scene(runner(0, 0), [10, 0, 0]), 0.016, 1)
    const b = poseCamera("follow", a.rig, scene(runner(20, 0), [30, 0, 0]), 0.016, 1)
    const settled = poseCamera("follow", null, scene(runner(20, 0), [30, 0, 0]), 0.016, 1)
    expect(dist(b.shot.pos, a.shot.pos)).toBeLessThan(dist(settled.shot.pos, a.shot.pos) / 5)
  })
})

describe("first-person camera", () => {
  it("is at eye height and looks the way the player looks, never turning faster than the cap", () => {
    const a = poseCamera("fp", null, scene(runner(0, 0, 4, 0), [10, 0, 0]), 0.016, 1)
    expect(a.shot.pos[1]).toBeCloseTo(EYE_M, 1)
    expect(a.rig.dir[0]).toBeCloseTo(1) // running at the ball along +x
    // The ball jumps behind them: one frame turns at most FP_MAX_TURN × dt.
    const b = poseCamera("fp", a.rig, scene(runner(0, 0), [-10, 0, 0]), 0.1, 1)
    const turned = Math.acos(Math.max(-1, Math.min(1, b.rig.dir[0] * a.rig.dir[0] + b.rig.dir[2] * a.rig.dir[2])))
    expect(turned).toBeLessThanOrEqual(FP_MAX_TURN * 0.1 + 1e-9)
    expect(turned).toBeGreaterThan(0)
  })

  it("needs a player", () => {
    expect(() => poseCamera("fp", null, scene(null), 0.016, 1)).toThrow(/needs a player/)
  })
})

describe("broadcast and tactical cameras", () => {
  it("broadcast: high in the main stand, panning with the ball, damped", () => {
    const a = poseCamera("broadcast", null, scene(null, [30, 0, 0]), 0.016, 1)
    expect(a.shot).toMatchObject({ kind: "perspective", fov: BROADCAST_FOV })
    expect(a.shot.pos[1]).toBeGreaterThan(20)
    expect(a.shot.pos[0]).toBeGreaterThan(10)
    const b = poseCamera("broadcast", a.rig, scene(null, [-30, 0, 0]), 0.016, 1)
    expect(b.shot.pos[0]).toBeGreaterThan(10) // still mostly where it was
  })

  it("tactical: top-down over the whole pitch, whatever the shape", () => {
    for (const aspect of [16 / 9, 0.6, 3]) {
      const { shot } = poseCamera("tactical", null, scene(null), 0.016, aspect)
      if (shot.kind !== "ortho") throw new Error("ortho")
      expect(shot.halfW).toBeGreaterThanOrEqual(52.5)
      expect(shot.halfH).toBeGreaterThanOrEqual(34)
      expect(shot.halfW / shot.halfH).toBeCloseTo(aspect)
    }
  })

  it("steering eases and caps the turn", () => {
    const d = steer([1, 0, 0], [0, 0, 1], 0.1, 100, 1)
    expect(Math.atan2(d[0], d[2])).toBeCloseTo(Math.PI / 2 - 0.1)
  })
})

describe("layout", () => {
  it("main + map: the camera fills the canvas with the tactical map inset in a corner", () => {
    const [main, map] = viewports({ mode: "multi", layout: "pip", camera: "follow", w: 1200, h: 700 })
    expect(main).toMatchObject({ x: 0, y: 0, w: 1200, h: 700, camera: "follow", world: "real", inset: false })
    expect(map).toMatchObject({ camera: "tactical", inset: true })
    expect(map!.x + map!.w).toBeLessThan(1200)
    expect(map!.w / map!.h).toBeCloseTo(105 / 68)
    expect(viewports({ mode: "multi", layout: "pip", camera: "tactical", w: 1200, h: 700 })).toHaveLength(1)
  })

  it("grid: all four cameras in quarters; narrow screens get one view", () => {
    const g = viewports({ mode: "multi", layout: "grid", camera: "follow", w: 1000, h: 600 })
    expect(g.map((v) => v.camera)).toEqual(["follow", "fp", "broadcast", "tactical"])
    expect(g.map((v) => [v.x, v.y])).toEqual([[0, 0], [500, 0], [0, 300], [500, 300]])
    for (const layout of ["grid", "pip"] as const) expect(viewports({ mode: "multi", layout, camera: "fp", w: NARROW_PX - 1, h: 600 }).map((v) => v.camera)).toEqual(["fp"])
  })

  it("split: real and variant side by side, stacked when narrow, both with the chosen camera", () => {
    const wide = viewports({ mode: "split", layout: "grid", camera: "broadcast", w: 1000, h: 500 })
    expect(wide.map((v) => [v.world, v.camera, v.x, v.w])).toEqual([["real", "broadcast", 0, 500], ["variant", "broadcast", 500, 500]])
    const tall = viewports({ mode: "split", layout: "pip", camera: "follow", w: 400, h: 800 })
    expect(tall.map((v) => [v.world, v.y, v.h])).toEqual([["real", 0, 400], ["variant", 400, 400]])
  })

  it("finds the viewport under a click (the inset on top) and the nearest player within reach", () => {
    const vps = viewports({ mode: "multi", layout: "pip", camera: "follow", w: 1200, h: 700 })
    expect(viewportAt(vps, 1150, 650)!.key).toBe("map")
    expect(viewportAt(vps, 10, 10)!.key).toBe("main-follow")
    expect(viewportAt(vps, 5000, 10)).toBeNull()
    const pts = [{ id: "a", sx: 100, sy: 100 }, { id: "b", sx: 130, sy: 100 }]
    expect(nearestOnScreen(pts, 125, 100)).toBe("b")
    expect(nearestOnScreen(pts, 400, 400)).toBeNull()
  })
})
```

- [ ] **Step 2: Run them to make sure they fail**

Run: `pnpm --filter @touchline/web test cameras`
Expected: `test/cameras.test.ts` fails to load: `../src/view3d/cameras.js` does not exist

- [ ] **Step 3: Write the implementation**

Create `apps/web/src/view3d/cameras.ts`:

```ts
/**
 * The four cameras of the 3D view (Plan 7), pure: each frame a camera's pose from the followed player, the ball and
 * its own previous pose (so it moves smoothly). World coordinates, metres (motion.ts toWorld).
 */
import { toWorld, type PlayerSample, type Vec3 } from "./motion.js"

export type CameraKind = "follow" | "fp" | "broadcast" | "tactical"
export const CAMERAS: ReadonlyArray<CameraKind> = ["follow", "fp", "broadcast", "tactical"]

/** A camera's state between frames: where it is, what it looks at, and the way it faces (horizontal, unit). */
export interface Rig {
  readonly kind: CameraKind
  readonly pos: Vec3
  readonly look: Vec3
  readonly dir: Vec3
}

export type Shot =
  | { readonly kind: "perspective"; readonly pos: Vec3; readonly look: Vec3; readonly fov: number }
  /** Top-down: half the width and height seen, in metres. */
  | { readonly kind: "ortho"; readonly pos: Vec3; readonly look: Vec3; readonly halfW: number; readonly halfH: number }

export const FOLLOW_FOV = 55
export const FP_FOV = 75
export const BROADCAST_FOV = 26
/** First-person eye height (m). */
export const EYE_M = 1.72
/** The fastest the first-person view turns (rad/s), so it never whips round. */
export const FP_MAX_TURN = Math.PI / 2

const add = (a: Vec3, b: Vec3, k = 1): Vec3 => [a[0] + b[0] * k, a[1] + b[1] * k, a[2] + b[2] * k]
const lerp3 = (a: Vec3, b: Vec3, u: number): Vec3 => [a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u, a[2] + (b[2] - a[2]) * u]
const flat = (v: Vec3): Vec3 => {
  const n = Math.hypot(v[0], v[2])
  return n > 1e-6 ? [v[0] / n, 0, v[2] / n] : [0, 0, 0]
}
const withY = (v: Vec3, y: number): Vec3 => [v[0], y, v[2]]
const angle = (v: Vec3) => Math.atan2(v[0], v[2])
const fromAngle = (a: number): Vec3 => [Math.sin(a), 0, Math.cos(a)]

/** Turn a direction toward another, eased at `rate` per second and never faster than `maxTurn` rad/s. */
export const steer = (dir: Vec3, want: Vec3, dt: number, rate: number, maxTurn = Infinity): Vec3 => {
  const d = Math.atan2(Math.sin(angle(want) - angle(dir)), Math.cos(angle(want) - angle(dir)))
  const step = Math.sign(d) * Math.min(Math.abs(d) * Math.min(1, dt * rate), maxTurn * dt)
  return fromAngle(angle(dir) + step)
}

export interface Scene {
  /** The followed player (null for cameras that follow nobody, or when they have left the pitch). */
  readonly player: PlayerSample | null
  readonly ball: { readonly x: number; readonly y: number; readonly z: number }
}

/**
 * The camera's shot this frame and its new state. `aspect` is the viewport's width over height; `time` (s) only moves
 * the first-person head-bob. Follow and first-person need a player.
 */
export const poseCamera = (kind: CameraKind, prev: Rig | null, s: Scene, dt: number, aspect: number, time = 0): { readonly shot: Shot; readonly rig: Rig } => {
  const ball = toWorld(s.ball.x, s.ball.y, s.ball.z)
  const rig0 = prev && prev.kind === kind ? prev : null
  if (kind === "tactical") {
    const halfW = Math.max(38 * aspect, 56)
    const pos: Vec3 = [0, 120, 0]
    return { shot: { kind: "ortho", pos, look: [0, 0, 0], halfW, halfH: halfW / aspect }, rig: { kind, pos, look: [0, 0, 0], dir: [0, 0, -1] } }
  }
  const k = Math.min(1, dt * 3)
  if (kind === "broadcast") {
    const pos: Vec3 = [ball[0] * 0.55, 24, 58]
    const look: Vec3 = [ball[0], 0, Math.min(10, ball[2] * 0.6)]
    const rig = rig0 ? { kind, pos: lerp3(rig0.pos, pos, k), look: lerp3(rig0.look, look, k), dir: rig0.dir } : { kind, pos, look, dir: [0, 0, -1] as Vec3 }
    return { shot: { kind: "perspective", pos: rig.pos, look: rig.look, fov: BROADCAST_FOV }, rig }
  }
  const p = s.player
  if (!p) throw new Error(`the ${kind} camera needs a player`)
  const at = toWorld(p.x, p.y)
  const toBall = flat([ball[0] - at[0], 0, ball[2] - at[2]])
  const dBall = Math.hypot(ball[0] - at[0], ball[2] - at[2])
  const travel = flat(toWorld(p.vx, p.vy))
  // Players watch the ball: face half the way they run and half toward the ball (all the ball when standing).
  const want = Math.hypot(p.vx, p.vy) > 1 ? flat(add(travel, toBall)) : toBall
  const start = rig0?.dir ?? (Math.hypot(want[0], want[2]) > 0 ? want : ([1, 0, 0] as Vec3))
  const dir = Math.hypot(want[0], want[2]) > 0 ? (kind === "fp" ? steer(start, want, dt, 2.5, FP_MAX_TURN) : steer(start, want, dt, 1.5)) : start
  if (kind === "fp") {
    const speed = Math.hypot(p.vx, p.vy)
    const bob = Math.sin(time * speed * 2.2) * Math.min(0.04, speed * 0.008)
    const pos = withY(add(at, dir, 0.25), EYE_M + bob)
    const look = withY(add(pos, dir, 10), 1.2)
    return { shot: { kind: "perspective", pos, look, fov: FP_FOV }, rig: { kind, pos, look, dir } }
  }
  // Follow: behind and above, pulling back (and up) as the ball gets further away so both stay in frame.
  const back = 7 + Math.min(10, dBall * 0.25)
  const pos = withY(add(at, dir, -back), 3.2 + Math.min(5, dBall * 0.12))
  const ahead = add(at, dir, 5)
  const look = withY(lerp3(ahead, ball, Math.min(0.5, dBall / 60)), 1)
  const rig = rig0 ? { kind, pos: lerp3(rig0.pos, pos, k), look: lerp3(rig0.look, look, k), dir } : { kind, pos, look, dir }
  return { shot: { kind: "perspective", pos: rig.pos, look: rig.look, fov: FOLLOW_FOV }, rig }
}
```

Create `apps/web/src/view3d/layout.ts`:

```ts
/**
 * Where each camera goes on the one 3D canvas (Plan 7), pure: main + map, a 2×2 grid, a single view, or the what-if
 * split. Pixels from the canvas's top left. Narrow screens get one view (split halves stack).
 */
import { CAMERAS, type CameraKind } from "./cameras.js"

export type Layout = "pip" | "grid" | "single"
export const LAYOUTS: ReadonlyArray<Layout> = ["pip", "grid", "single"]
/** Below this canvas width only one view fits (and split halves stack). */
export const NARROW_PX = 768

export interface Viewport {
  readonly key: string
  readonly x: number
  readonly y: number
  readonly w: number
  readonly h: number
  /** Which play it shows: the match as it went, or the what-if variant. */
  readonly world: "real" | "variant"
  readonly camera: CameraKind
  /** The mini-map in a corner (drawn last, on top). */
  readonly inset: boolean
}

export interface LayoutOptions {
  readonly mode: "multi" | "split"
  readonly layout: Layout
  readonly camera: CameraKind
  readonly w: number
  readonly h: number
}

const vp = (key: string, x: number, y: number, w: number, h: number, world: Viewport["world"], camera: CameraKind, inset = false): Viewport => ({ key, x, y, w, h, world, camera, inset })

export const viewports = (o: LayoutOptions): Viewport[] => {
  const { w, h } = o
  const narrow = w < NARROW_PX
  if (o.mode === "split") {
    return narrow
      ? [vp("real", 0, 0, w, h / 2, "real", o.camera), vp("variant", 0, h / 2, w, h / 2, "variant", o.camera)]
      : [vp("real", 0, 0, w / 2, h, "real", o.camera), vp("variant", w / 2, 0, w / 2, h, "variant", o.camera)]
  }
  if (o.layout === "grid" && !narrow) return CAMERAS.map((c, i) => vp(`grid-${c}`, (i % 2) * (w / 2), Math.floor(i / 2) * (h / 2), w / 2, h / 2, "real", c))
  const main = vp(`main-${o.camera}`, 0, 0, w, h, "real", o.camera)
  if (o.layout === "single" || narrow || o.camera === "tactical") return [main]
  const mw = Math.max(170, w * 0.26)
  const mh = (mw * 68) / 105
  return [main, vp("map", w - mw - 12, h - mh - 12, mw, mh, "real", "tactical", true)]
}

/** The viewport under a point (the inset first: it is on top). */
export const viewportAt = (vps: ReadonlyArray<Viewport>, x: number, y: number): Viewport | null =>
  [...vps].reverse().find((v) => x >= v.x && x <= v.x + v.w && y >= v.y && y <= v.y + v.h) ?? null

/** The id of the point nearest a click on screen, within `maxPx`. */
export const nearestOnScreen = (points: ReadonlyArray<{ readonly id: string; readonly sx: number; readonly sy: number }>, x: number, y: number, maxPx = 50): string | null => {
  let best: string | null = null
  let bd = maxPx
  for (const p of points) {
    const d = Math.hypot(p.sx - x, p.sy - y)
    if (d < bd) {
      bd = d
      best = p.id
    }
  }
  return best
}
```

- [ ] **Step 4: Run the tests**

Run: `pnpm --filter @touchline/web test cameras`
Expected: `12 passed`

Run: `pnpm --filter @touchline/web typecheck`
Expected: no errors

- [ ] **Step 5: Commit**

```bash
git add apps/web
git commit -m "feat(web): 3D cameras and layouts — follow, first-person (turn rate capped), broadcast and tactical poses; main + map, 2×2 grid, single and the what-if split, one view on narrow screens

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: The 3D world: stadium, players, ball (web, rpc, api)

One three.js scene of a match: the pitch, goals, low-poly stands and the stadium light.

- **Pitch:** the same markings as the 2D view, drawn on mown stripes. `drawMarkings` gains a stripe count, which is 0 for the 2D pitch.
- **Light:** image-based lighting from the CC0 HDRI, which also shows blurred as the backdrop. One shadow-casting sun.
- **Bodies:** one per player, cloned from the CC0 rigged body. Kit colour goes on `M_Main`, keepers wear their own colours, numbers float above, and a disc under each player is drawn only in the tactical map (layer 1).
- **Animation:** gait clips are blended by speed. Our kick is laid on the preferred leg: last frame's kick is undone before the mixer runs, so it never builds up.
- **Ball:** shown with its shadow, at its real height.

The match info gains each player's preferred foot. The body and the HDRI are committed in `apps/web/public/3d/`.

**Files:**
- Create: `apps/web/src/view3d/world.ts`
- Create: `apps/web/public/3d/player.glb`, `apps/web/public/3d/stadium_01_1k.hdr` (binary; see the asset step)
- Modify: `apps/web/src/draw.ts` (`STRIPES`, `drawMarkings(ctx, size, stripes = 0)`), `packages/rpc/src/contracts.ts` (`Player.foot`), `apps/api/src/library.ts` (`foot` from the league's `preferredFoot`), `ATTRIBUTION.md`
- Test: `apps/web/test/world.test.ts`, `apps/web/test/draw.test.ts`, `apps/web/test/fake-client.ts` (players gain `foot`), `apps/api/test/library.test.ts`

**Interfaces:**
- Consumes: `motion.ts`, `kick.ts` (Task 5); `drawMarkings`, `LENGTH`, `WIDTH` (existing).
- Produces: `Player.foot: "left" | "right"`; `Assets { body: { scene, animations }, env: Texture | null, sky: Texture | null }`; `KEEPER_KITS`; `MAP_LAYER = 1`; `pitchTexture()`; `class World(assets, match) { scene; ball; update(sample, kicks, fps, dt); positionOf(id); onPitch; dress({ followed, hidden, tags }); passLine(from, to, colour?); bonesOf(id); dispose() }`.

- [ ] **Step 1: Write the failing tests**

Create `apps/web/test/world.test.ts`:

```ts
import * as THREE from "three"
import { describe, expect, it } from "vitest"
import type { PitchFrame } from "@touchline/rpc"
import { findKicks, KICK_S } from "../src/view3d/kick.js"
import { sampleClip } from "../src/view3d/motion.js"
import { KEEPER_KITS, MAP_LAYER, World, type Assets } from "../src/view3d/world.js"
import { INFO } from "./fake-client.js"

/** A stand-in for the rigged body: the named materials and the kick's bones (three.js drops the dots), no animation tracks. */
const assets = (): Assets => {
  const root = new THREE.Group()
  for (const name of ["M_Main", "M_Joints"]) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(0.4, 1.8, 0.3), new THREE.MeshStandardMaterial({ name }))
    root.add(m)
  }
  for (const name of ["DEF-thighL", "DEF-shinL", "DEF-footL", "DEF-thighR", "DEF-shinR", "DEF-footR", "DEF-spine001"]) {
    const b = new THREE.Bone()
    b.name = name
    root.add(b)
  }
  const animations = ["Idle_Loop", "Walk_Loop", "Jog_Fwd_Loop", "Sprint_Loop"].map((n) => new THREE.AnimationClip(n, 1, []))
  return { body: { scene: root, animations }, env: null, sky: null }
}

const keeper = INFO.players[0]! // home keeper, right foot
const striker = INFO.players[1]! // away striker, left foot
const frame = (n: number, k: [number, number], s: [number, number], ball: [number, number, number]): PitchFrame => ({
  frame: n, period: "first_half", clock: "00:00.00", ball: { x: ball[0], y: ball[1], z: ball[2] }, home: [{ id: keeper.id, x: k[0], y: k[1] }], away: [{ id: striker.id, x: s[0], y: s[1] }]
})
const colour = (w: World, id: string, material: string) => {
  let c = ""
  w.scene.traverse((o) => {
    if (o instanceof THREE.Mesh && (o.material as THREE.MeshStandardMaterial).name === material && o.parent?.parent?.position.equals(w.positionOf(id) ?? new THREE.Vector3(1e9, 0, 0))) c = `#${(o.material as THREE.MeshStandardMaterial).color.getHexString()}`
  })
  return c
}

describe("3D world", () => {
  it("puts a body per player on the pitch in kit colours (keepers in their own), and the ball at its height", () => {
    const w = new World(assets(), INFO)
    const f = frame(0, [-50, 0], [10, -5], [3, 4, 2])
    w.update(sampleClip([f], 0, 10)!, [], 10, 0)
    expect(w.onPitch.sort()).toEqual([keeper.id, striker.id].sort())
    expect(w.positionOf(striker.id)!.toArray()).toEqual([10, 0, 5])
    expect(colour(w, keeper.id, "M_Main")).toBe(KEEPER_KITS.home)
    expect(colour(w, striker.id, "M_Main")).toBe(INFO.away.kit.primary)
    expect(w.ball.position.x).toBe(3)
    expect(w.ball.position.z).toBe(-4)
    expect(w.ball.position.y).toBeGreaterThan(2)
  })

  it("draws the chalkboard discs only for the tactical map", () => {
    const w = new World(assets(), INFO)
    w.update(sampleClip([frame(0, [0, 0], [5, 0], [0, 0, 0])], 0, 10)!, [], 10, 0)
    const discs: THREE.Object3D[] = []
    w.scene.traverse((o) => o.layers.mask === 1 << MAP_LAYER && discs.push(o))
    expect(discs).toHaveLength(2)
  })

  it("turns a runner toward where they run, and hides players who left the pitch", () => {
    const w = new World(assets(), INFO)
    const clip = [frame(0, [0, 0], [0, 10], [20, 20, 0]), frame(1, [0.5, 0], [0, 10], [20, 20, 0])]
    for (let i = 0; i < 60; i++) w.update(sampleClip(clip, 0.5, 10)!, [], 10, 1 / 60)
    const body = w.positionOf(keeper.id)!
    expect(body).not.toBeNull()
    let yaw = 0
    w.scene.traverse((o) => o.position === body && (yaw = o.rotation.y))
    expect(yaw).toBeCloseTo(Math.PI / 2, 1) // running along +x
    w.update(sampleClip([{ ...clip[1]!, away: [] }], 0, 10)!, [], 10, 1 / 60)
    expect(w.positionOf(striker.id)).toBeNull()
    expect(w.onPitch).toEqual([keeper.id])
  })

  it("lays the kick on the preferred leg and takes it off again, never building up across frames", () => {
    const w = new World(assets(), INFO)
    // The striker (left foot) plays the ball away fast along +x.
    const clip = Array.from({ length: 16 }, (_, n) => frame(n, [-50, 0], [0, 0.5], [n > 8 ? 0.3 + (n - 8) * 1.5 : -2.4 + n * 0.3, 0, 0]))
    const kicks = findKicks(clip, 10)
    expect(kicks.map((k) => k.player_id)).toEqual([striker.id])
    w.update(sampleClip(clip, 0, 10)!, kicks, 10, 0)
    const left = w.bonesOf(striker.id)
    expect(left.thigh!.name).toBe("DEF-thighL")
    const strike = kicks[0]!.start + 0.65 * KICK_S * 10
    w.update(sampleClip(clip, strike, 10)!, kicks, 10, 0.016)
    const mid = left.thigh!.quaternion.clone()
    expect(mid.angleTo(new THREE.Quaternion())).toBeGreaterThan(1)
    w.update(sampleClip(clip, strike, 10)!, kicks, 10, 0.016)
    expect(left.thigh!.quaternion.angleTo(mid)).toBeCloseTo(0) // the same pose again, not twice the kick
    w.update(sampleClip(clip, 15, 10)!, kicks, 10, 0.016)
    expect(left.thigh!.quaternion.angleTo(new THREE.Quaternion())).toBeCloseTo(0)
    expect(left.support!.name).toBe("DEF-thighR")
  })

  it("marks the followed player, hides the first-person body, draws a pass line, and frees its own objects only", () => {
    const shared = assets()
    const a = new World(shared, INFO)
    const b = new World(shared, INFO)
    for (const w of [a, b]) w.update(sampleClip([frame(0, [0, 0], [5, 0], [0, 0, 0])], 0, 10)!, [], 10, 0)
    a.dress({ followed: striker.id, hidden: keeper.id, tags: false })
    a.passLine(keeper.id, striker.id, "#5fd38d")
    let line: THREE.Line | undefined
    a.scene.traverse((o) => o instanceof THREE.Line && (o.material as THREE.LineDashedMaterial).dashSize && (line = o))
    expect(line!.visible).toBe(true)
    a.passLine(keeper.id, "nobody")
    expect(line!.visible).toBe(false)
    let disposed = 0
    ;(shared.body.scene.children[0] as THREE.Mesh).geometry.addEventListener("dispose", () => disposed++)
    a.dispose()
    expect(disposed).toBe(0)
  })
})
```

Apply this change to `apps/api/test/library.test.ts`, `apps/web/test/draw.test.ts`, `apps/web/test/fake-client.ts` (from the repository root):

```bash
git apply <<'PATCH'
diff --git a/apps/api/test/library.test.ts b/apps/api/test/library.test.ts
index 973515e..511b09a 100644
--- a/apps/api/test/library.test.ts
+++ b/apps/api/test/library.test.ts
@@ -23,6 +23,7 @@ describe("library", () => {
     expect(m.segments).toEqual(["analyst.es.neutral", "casual.en.neutral", "casual.en.northwick"])
     expect(m.model).toBe("stub")
     expect(m.players.length).toBeGreaterThanOrEqual(40)
+    expect(new Set(m.players.map((p) => p.foot))).toEqual(new Set(["left", "right"])) // the 3D view kicks with it
   })
 
   it("plays a match without a cue cache with stats only", () => {
diff --git a/apps/web/test/draw.test.ts b/apps/web/test/draw.test.ts
index 7cfd2f0..e093242 100644
--- a/apps/web/test/draw.test.ts
+++ b/apps/web/test/draw.test.ts
@@ -1,6 +1,6 @@
 import { describe, expect, it } from "vitest"
 import type { PitchFrame } from "@touchline/rpc"
-import { drawFrame, toPx } from "../src/draw.js"
+import { drawFrame, drawMarkings, STRIPES, toPx } from "../src/draw.js"
 
 /** A 2D context that records what is drawn, in which colour. */
 const recorder = () => {
@@ -22,6 +22,16 @@ const frame = (ballZ = 0): PitchFrame => ({
 })
 
 describe("pitch drawing", () => {
+  it("mows stripes under the markings for the 3D grass, and none for the 2D pitch", () => {
+    const fills: string[] = []
+    const ctx = { fillStyle: "", strokeStyle: "", lineWidth: 1, strokeRect: () => {}, beginPath: () => {}, moveTo: () => {}, lineTo: () => {}, stroke: () => {}, arc: () => {}, fill: () => {}, fillRect() { fills.push(String(ctx.fillStyle)) } }
+    drawMarkings(ctx as never, { w: 1800, h: 1000 }, 18)
+    expect(fills.slice(1)).toEqual(Array.from({ length: 18 }, (_, i) => STRIPES[i % 2]))
+    fills.length = 0
+    drawMarkings(ctx as never, { w: 1800, h: 1000 })
+    expect(fills).toHaveLength(1)
+  })
+
   it("maps the pitch's corners and centre to the canvas", () => {
     const size = { w: 1050, h: 680 }
     expect(toPx(size, -52.5, 34)).toEqual([0, 0])
diff --git a/apps/web/test/fake-client.ts b/apps/web/test/fake-client.ts
index 6695745..8387316 100644
--- a/apps/web/test/fake-client.ts
+++ b/apps/web/test/fake-client.ts
@@ -12,8 +12,8 @@ export const MATCH: MatchSummary = {
 export const INFO: MatchInfo = {
   ...MATCH,
   players: [
-    { id: "p-nor-01", team_id: "northwick", name: "Datan Drenussen", jersey: 1, role: "GK" },
-    { id: "p-lar-09", team_id: "larkspur", name: "Feseo Wylford", jersey: 9, role: "ST" }
+    { id: "p-nor-01", team_id: "northwick", name: "Datan Drenussen", jersey: 1, role: "GK", foot: "right" },
+    { id: "p-lar-09", team_id: "larkspur", name: "Feseo Wylford", jersey: 9, role: "ST", foot: "left" }
   ]
 }
 
PATCH
```

- [ ] **Step 2: Run them to make sure they fail**

Run: `pnpm --filter @touchline/web test world draw`
Expected: `test/world.test.ts` fails to load (`../src/view3d/world.js` does not exist); the stripes test fails

Run: `pnpm --filter @touchline/api test library`
Expected: the foot assertion fails: players have no `foot`

- [ ] **Step 3: Write the implementation**

Create `apps/web/src/view3d/world.ts`:

```ts
/**
 * One 3D scene of a match (Plan 7): pitch, goals, stands and stadium light, a body per player in kit colours (gait
 * blended by speed, our kick laid on top) and the ball with its shadow. The what-if split builds two, one per play.
 * Built once, then posed every frame from a motion Sample; the cameras and the renderer live elsewhere.
 */
import * as THREE from "three"
import { clone as cloneRig } from "three/addons/utils/SkeletonUtils.js"
import type { MatchInfo } from "@touchline/rpc"
import { drawMarkings, LENGTH, WIDTH } from "../draw.js"
import { kickAt, kickPose, type Kick, type KickPart } from "./kick.js"
import { blendGaits, GAITS, gaitOf, gaitRate, turnToward, wantedYaw, type Gait, type Sample } from "./motion.js"

/** What every scene shares: the rigged body (CC0 Quaternius mannequin) and the stadium light (CC0 Poly Haven HDRI). */
export interface Assets {
  readonly body: { readonly scene: THREE.Object3D; readonly animations: ReadonlyArray<THREE.AnimationClip> }
  /** Pre-filtered for lighting (PMREM), and the backdrop; null without them (tests). */
  readonly env: THREE.Texture | null
  readonly sky: THREE.Texture | null
}

/** Keepers wear their own colours. */
export const KEEPER_KITS = { home: "#f2c14e", away: "#ff8fab" } as const
/** The layer only the tactical camera sees: a flat disc under each player, like a chalkboard. */
export const MAP_LAYER = 1
const BALL_R = 0.11

/** The pitch's surface: mown stripes and the same markings as the 2D view (draw.ts). */
export const pitchTexture = (): THREE.Texture => {
  const c = document.createElement("canvas")
  c.width = 2100
  c.height = 1360
  const ctx = c.getContext("2d")
  if (ctx) drawMarkings(ctx, { w: c.width, h: c.height }, 18)
  const t = new THREE.CanvasTexture(c)
  t.colorSpace = THREE.SRGBColorSpace
  t.anisotropy = 8
  return t
}

const labelTexture = (text: string, colour: string): THREE.Texture => {
  const c = document.createElement("canvas")
  c.width = 128
  c.height = 64
  const g = c.getContext("2d")
  if (g) {
    g.fillStyle = "rgba(13,20,18,.8)"
    g.beginPath()
    g.roundRect(4, 4, 120, 56, 14)
    g.fill()
    g.fillStyle = colour
    g.font = "700 40px system-ui, sans-serif"
    g.textAlign = "center"
    g.textBaseline = "middle"
    g.fillText(text, 64, 35)
  }
  const t = new THREE.CanvasTexture(c)
  t.colorSpace = THREE.SRGBColorSpace
  return t
}

/** A bone by its glTF name (three.js drops the dots from node names: "DEF-thigh.L" is "DEF-thighL"). */
const bone = (root: THREE.Object3D, name: string) => root.getObjectByName(name) ?? root.getObjectByName(name.replace(/\./g, ""))

interface Body {
  readonly id: string
  readonly holder: THREE.Group
  readonly model: THREE.Object3D
  readonly tag: THREE.Sprite
  readonly ring: THREE.Mesh
  readonly mixer: THREE.AnimationMixer
  readonly actions: Partial<Record<Gait, THREE.AnimationAction>>
  readonly bones: Partial<Record<KickPart, THREE.Object3D>>
  weights: Record<Gait, number>
  yaw: number
  /** The bones' poses before the kick was laid on them, to undo it before the mixer runs again. */
  saved: Partial<Record<KickPart, THREE.Quaternion>> | null
}

const X = new THREE.Vector3(1, 0, 0)

export class World {
  readonly scene = new THREE.Scene()
  readonly ball: THREE.Mesh
  private readonly shadow: THREE.Mesh
  private readonly line: THREE.Line
  private readonly bodies = new Map<string, Body>()
  private readonly kitOf: (id: string) => { kit: string; joints: string; jersey: string; foot: "left" | "right" }

  constructor(
    private readonly assets: Assets,
    match: MatchInfo
  ) {
    const s = this.scene
    if (assets.env) {
      s.environment = assets.env
      s.environmentIntensity = 0.45
    }
    if (assets.sky) {
      s.background = assets.sky
      s.backgroundBlurriness = 0.25
      s.backgroundIntensity = 0.35
    } else s.background = new THREE.Color("#0d1412")
    s.add(new THREE.HemisphereLight("#cfe3ff", "#24452d", 0.25))
    const sun = new THREE.DirectionalLight("#fff6e5", 2)
    sun.position.set(-30, 60, 25)
    sun.castShadow = true
    Object.assign(sun.shadow.camera, { left: -65, right: 65, top: 45, bottom: -45, near: 1, far: 160 })
    sun.shadow.mapSize.set(2048, 2048)
    sun.shadow.bias = -0.0005
    s.add(sun)
    const flatOn = (m: THREE.Mesh, y: number) => {
      m.rotation.x = -Math.PI / 2
      m.position.y = y
      m.receiveShadow = true
      s.add(m)
      return m
    }
    flatOn(new THREE.Mesh(new THREE.PlaneGeometry(LENGTH + 20, WIDTH + 20), new THREE.MeshStandardMaterial({ color: "#245f33", roughness: 1 })), -0.01)
    flatOn(new THREE.Mesh(new THREE.PlaneGeometry(LENGTH, WIDTH), new THREE.MeshStandardMaterial({ map: pitchTexture(), roughness: 0.95 })), 0)
    this.goals()
    this.stands()
    const home = match.home.id
    const byId = new Map(match.players.map((p) => [p.id, p]))
    this.kitOf = (id) => {
      const p = byId.get(id)
      const side = p?.team_id === home ? "home" : "away"
      const kit = p?.role === "GK" ? KEEPER_KITS[side] : side === "home" ? match.home.kit.primary : match.away.kit.primary
      return { kit, joints: side === "home" ? "#f2f2f2" : "#1d2420", jersey: p ? String(p.jersey) : "", foot: p?.foot ?? "right" }
    }
    this.ball = new THREE.Mesh(new THREE.IcosahedronGeometry(BALL_R, 2), new THREE.MeshStandardMaterial({ color: "#ffffff", roughness: 0.4, flatShading: true }))
    this.ball.castShadow = true
    s.add(this.ball)
    this.shadow = new THREE.Mesh(new THREE.CircleGeometry(0.22, 24), new THREE.MeshBasicMaterial({ color: "#000000", transparent: true, opacity: 0.45, depthWrite: false }))
    this.shadow.rotation.x = -Math.PI / 2
    this.shadow.position.y = 0.012
    s.add(this.shadow)
    this.line = new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]), new THREE.LineDashedMaterial({ color: "#f2c14e", dashSize: 0.8, gapSize: 0.5, depthTest: false }))
    this.line.renderOrder = 9
    this.line.visible = false
    s.add(this.line)
  }

  private goals() {
    const post = new THREE.MeshStandardMaterial({ color: "#ffffff" })
    const net = new THREE.LineBasicMaterial({ color: "#dfe7e3", transparent: true, opacity: 0.35 })
    for (const side of [-1, 1]) {
      const g = new THREE.Group()
      g.position.set((side * LENGTH) / 2, 0, 0)
      for (const z of [-3.66, 3.66]) {
        const m = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 2.44), post)
        m.position.set(0, 1.22, z)
        m.castShadow = true
        g.add(m)
      }
      const bar = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 7.32), post)
      bar.rotation.x = Math.PI / 2
      bar.position.set(0, 2.44, 0)
      g.add(bar)
      const box = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(2, 2.44, 7.32, 1, 4, 10)), net)
      box.position.set(side, 1.22, 0)
      g.add(box)
      this.scene.add(g)
    }
  }

  /** Low-poly stands round the pitch: no boards, no logos. */
  private stands() {
    const a = new THREE.MeshStandardMaterial({ color: "#1c2a36", roughness: 1 })
    const b = new THREE.MeshStandardMaterial({ color: "#2b3d4f", roughness: 1 })
    const stand = (w: number, x: number, z: number, ry: number) => {
      const g = new THREE.Group()
      for (let i = 0; i < 6; i++) {
        const h = 1.2 + i * 1.6
        const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, 2.2), i % 2 ? a : b)
        m.position.set(0, h / 2, i * 2.2)
        g.add(m)
      }
      g.position.set(x, 0, z)
      g.rotation.y = ry
      this.scene.add(g)
    }
    stand(130, 0, 42, 0)
    stand(130, 0, -42, Math.PI)
    stand(90, 60, 0, Math.PI / 2)
    stand(90, -60, 0, -Math.PI / 2)
  }

  private body(id: string): Body {
    const had = this.bodies.get(id)
    if (had) return had
    const k = this.kitOf(id)
    const model = cloneRig(this.assets.body.scene as THREE.Object3D)
    model.traverse((o) => {
      if (!(o instanceof THREE.Mesh)) return
      o.castShadow = true
      o.frustumCulled = false
      const m = (o.material as THREE.MeshStandardMaterial).clone()
      if (m.name === "M_Main") m.color.set(k.kit)
      if (m.name === "M_Joints") m.color.set(k.joints)
      o.material = m
    })
    const holder = new THREE.Group()
    holder.add(model)
    const tag = new THREE.Sprite(new THREE.SpriteMaterial({ map: labelTexture(k.jersey, k.kit), depthTest: false, sizeAttenuation: false }))
    tag.scale.set(0.05, 0.025, 1)
    tag.position.y = 2.2
    tag.renderOrder = 10
    holder.add(tag)
    const disc = new THREE.Mesh(new THREE.CircleGeometry(1.1, 20), new THREE.MeshBasicMaterial({ color: k.kit }))
    disc.rotation.x = -Math.PI / 2
    disc.position.y = 0.05
    disc.layers.set(MAP_LAYER)
    holder.add(disc)
    const ring = new THREE.Mesh(new THREE.RingGeometry(0.55, 0.75, 32), new THREE.MeshBasicMaterial({ color: "#f2c14e", transparent: true, opacity: 0.9, depthWrite: false }))
    ring.rotation.x = -Math.PI / 2
    ring.position.y = 0.03
    ring.visible = false
    holder.add(ring)
    this.scene.add(holder)
    const mixer = new THREE.AnimationMixer(model)
    const actions: Body["actions"] = {}
    for (const g of GAITS) {
      const clip = this.assets.body.animations.find((a) => a.name === g.clip)
      if (!clip) continue
      const a = mixer.clipAction(clip)
      a.play()
      a.setEffectiveWeight(g.clip === "Idle_Loop" ? 1 : 0)
      actions[g.clip] = a
    }
    mixer.setTime((id.length * 0.37) % 2) // players out of step with each other, the same every time
    const [kick, other] = k.foot === "left" ? ["L", "R"] : ["R", "L"]
    const bones: Body["bones"] = {}
    const want: Record<KickPart, string> = { thigh: `DEF-thigh.${kick}`, shin: `DEF-shin.${kick}`, foot: `DEF-foot.${kick}`, support: `DEF-thigh.${other}`, spine: "DEF-spine.001" }
    for (const part of Object.keys(want) as KickPart[]) {
      const b = bone(model, want[part])
      if (b) bones[part] = b
    }
    const b: Body = { id, holder, model, tag, ring, mixer, actions, bones, weights: { Idle_Loop: 1, Walk_Loop: 0, Jog_Fwd_Loop: 0, Sprint_Loop: 0 }, yaw: 0, saved: null }
    this.bodies.set(id, b)
    return b
  }

  /** Pose the scene at a sample: `dt` is the animation time step (0 while paused), `fps` the match's frame rate. */
  update(s: Sample, kicks: ReadonlyArray<Kick>, fps: number, dt: number): void {
    this.ball.position.set(s.ball.x, s.ball.z + BALL_R, -s.ball.y)
    this.ball.rotation.x += dt * 8
    this.shadow.position.set(s.ball.x, 0.012, -s.ball.y)
    this.shadow.scale.setScalar(1 + s.ball.z * 0.25)
    ;(this.shadow.material as THREE.MeshBasicMaterial).opacity = Math.max(0.12, 0.45 - s.ball.z * 0.06)
    for (const b of this.bodies.values()) b.holder.visible = s.players.has(b.id)
    for (const [id, p] of s.players) {
      const b = this.body(id)
      b.holder.position.set(p.x, 0, -p.y)
      const k = kickAt(kicks, id, s.frame, fps)
      // Square up to the pass while kicking, else face the way they run (or the ball).
      const want = k ? k.kick.yaw : wantedYaw(p, s.ball)
      if (want !== null) b.yaw = turnToward(b.yaw, want, dt || 1 / 60, k ? 14 : 8)
      b.holder.rotation.y = b.yaw
      const speed = Math.hypot(p.vx, p.vy)
      b.weights = blendGaits(b.weights, k ? "Idle_Loop" : gaitOf(speed), dt)
      for (const g of GAITS) {
        const a = b.actions[g.clip]
        if (!a) continue
        a.setEffectiveWeight(b.weights[g.clip])
        a.timeScale = gaitRate(g.clip, speed)
      }
      // Undo last frame's kick, let the mixer pose the body, then lay this frame's kick on top.
      if (b.saved) {
        for (const part of Object.keys(b.saved) as KickPart[]) b.bones[part]!.quaternion.copy(b.saved[part]!)
        b.saved = null
      }
      b.mixer.update(dt)
      if (k) {
        const pose = kickPose(k.t)
        b.saved = {}
        for (const part of Object.keys(pose) as KickPart[]) {
          const bn = b.bones[part]
          if (!bn) continue
          b.saved[part] = bn.quaternion.clone()
          bn.quaternion.multiply(new THREE.Quaternion().setFromAxisAngle(X, pose[part]))
        }
      }
    }
  }

  /** Where a player stands (world), or null when not on the pitch. */
  positionOf(id: string): THREE.Vector3 | null {
    const b = this.bodies.get(id)
    return b && b.holder.visible ? b.holder.position : null
  }

  /** The ids of the players on the pitch. */
  get onPitch(): string[] {
    return [...this.bodies.values()].filter((b) => b.holder.visible).map((b) => b.id)
  }

  /** Mark the followed player (a ring at their feet), hide one body (the first-person view's own), show or hide the numbers. */
  dress(o: { readonly followed: string | null; readonly hidden: string | null; readonly tags: boolean }): void {
    for (const b of this.bodies.values()) {
      b.ring.visible = b.id === o.followed && b.id !== o.hidden
      b.model.visible = b.id !== o.hidden
      b.tag.visible = o.tags && b.id !== o.hidden
    }
  }

  /** A dashed pass line on the grass between two players, or none. */
  passLine(from: string | null, to: string | null, colour = "#f2c14e"): void {
    const a = from ? this.positionOf(from) : null
    const b = to ? this.positionOf(to) : null
    this.line.visible = a !== null && b !== null
    if (!a || !b) return
    ;(this.line.material as THREE.LineDashedMaterial).color.set(colour)
    this.line.geometry.setFromPoints([a.clone().setY(0.1), b.clone().setY(0.1)])
    this.line.computeLineDistances()
  }

  /** The kick overlay's bones of a player (tests). */
  bonesOf(id: string): Partial<Record<KickPart, THREE.Object3D>> {
    return this.bodies.get(id)?.bones ?? {}
  }

  /** Free this scene's GPU objects (the bodies' geometry belongs to the shared assets and stays). */
  dispose(): void {
    const shared = new Set<THREE.BufferGeometry>()
    for (const b of this.bodies.values()) b.model.traverse((o) => o instanceof THREE.Mesh && shared.add(o.geometry))
    this.scene.traverse((o) => {
      if (!(o instanceof THREE.Mesh || o instanceof THREE.Line || o instanceof THREE.Sprite)) return
      if (!shared.has(o.geometry)) o.geometry.dispose()
      for (const m of Array.isArray(o.material) ? o.material : [o.material]) {
        ;(m as THREE.MeshStandardMaterial).map?.dispose()
        m.dispose()
      }
    })
  }
}
```

Apply this change to `ATTRIBUTION.md`, `apps/api/src/library.ts`, `apps/web/src/draw.ts`, `packages/rpc/src/contracts.ts` (from the repository root):

```bash
git apply <<'PATCH'
diff --git a/ATTRIBUTION.md b/ATTRIBUTION.md
index a334ac0..5f77b4e 100644
--- a/ATTRIBUTION.md
+++ b/ATTRIBUTION.md
@@ -20,3 +20,10 @@ Touchline's simulator is original code. These projects and papers shaped its des
 | IDSSE / Sportec Open DFL dataset — © Deutsche Fussball Liga (DFL); Bassek et al., *Scientific Data* (2025), https://doi.org/10.1038/s41597-025-04505-y | CC-BY 4.0 | Downloaded locally into git-ignored `data/raw/`; only aggregate match statistics (`data/params/targets-idsse.json`), fitted model coefficients (`data/params/stats-models.json`) and the expected-threat grid (`data/params/xt-grid.json`) are committed. These are the targets the engine is tuned to and validated against (`docs/realism/realism-report.md`). |
 
 The default xG prior (`packages/sim-core/src/params.ts`) is fitted to an approximate public reference xG curve by distance and angle, not to any dataset.
+
+## 3D viewer assets
+
+| Asset | Licence | How it is used |
+|---|---|---|
+| Player body and its idle, walk, jog and sprint clips: [Universal Animation Library](https://quaternius.com/packs/universalanimationlibrary.html) (Standard), by Quaternius | CC0 1.0 | `apps/web/public/3d/player.glb`: the pack's `Godot/AnimationLibrary_Godot_Standard.glb` trimmed with [glTF Transform](https://gltf-transform.dev) to the four clips (`Idle_Loop`, `Walk_Loop`, `Jog_Fwd_Loop`, `Sprint_Loop`). Recoloured to kits in the browser. The kick is our own (`apps/web/src/view3d/kick.ts`, CC0). |
+| Stadium light and backdrop: [Stadium 01](https://polyhaven.com/a/stadium_01) HDRI (1k), Poly Haven | CC0 1.0 | `apps/web/public/3d/stadium_01_1k.hdr`, unchanged. |
diff --git a/apps/api/src/library.ts b/apps/api/src/library.ts
index 4061ec4..f7f6233 100644
--- a/apps/api/src/library.ts
+++ b/apps/api/src/library.ts
@@ -33,10 +33,10 @@ const json = <A>(path: string): A => JSON.parse(readFileSync(path, "utf8")) as A
 const team = (league: League, id: string, side: "home" | "away"): { brief: TeamBrief; players: Player[] } => {
   const club = league.clubs.find((c) => c.id === id)
   if (!club) throw new LibraryError(`club ${id} is not in the league file`)
-  const c = club as unknown as { name: string; short: string; kits: Record<"home" | "away", { primary: string; secondary: string }>; squad: ReadonlyArray<{ id: string; name: string; jersey: number; role: string }> }
+  const c = club as unknown as { name: string; short: string; kits: Record<"home" | "away", { primary: string; secondary: string }>; squad: ReadonlyArray<{ id: string; name: string; jersey: number; role: string; preferredFoot: "left" | "right" }> }
   return {
     brief: { id, name: c.name, short: c.short, side, kit: c.kits[side] },
-    players: c.squad.map((p) => ({ id: p.id, team_id: id, name: p.name, jersey: p.jersey, role: p.role }))
+    players: c.squad.map((p) => ({ id: p.id, team_id: id, name: p.name, jersey: p.jersey, role: p.role, foot: p.preferredFoot }))
   }
 }
 
diff --git a/apps/web/src/draw.ts b/apps/web/src/draw.ts
index a10c24a..ebaffad 100644
--- a/apps/web/src/draw.ts
+++ b/apps/web/src/draw.ts
@@ -36,10 +36,17 @@ const box = (ctx: Ctx, size: Size, x0: number, x1: number, halfW: number) => {
   ctx.strokeRect(Math.min(a, c), b, Math.abs(c - a), d - b)
 }
 
-/** The markings: touchlines, halfway line, centre circle, penalty and goal areas. */
-export const drawMarkings = (ctx: Ctx, size: Size) => {
+/** Mown stripes across the pitch, alternating shades (the 3D grass). */
+export const STRIPES = ["#2a723c", "#2f7d43"] as const
+
+/** The markings: touchlines, halfway line, centre circle, penalty and goal areas; on mown stripes if asked (3D). */
+export const drawMarkings = (ctx: Ctx, size: Size, stripes = 0) => {
   ctx.fillStyle = PITCH
   ctx.fillRect(0, 0, size.w, size.h)
+  for (let i = 0; i < stripes; i++) {
+    ctx.fillStyle = STRIPES[i % 2]!
+    ctx.fillRect((i * size.w) / stripes, 0, size.w / stripes + 1, size.h)
+  }
   ctx.strokeStyle = LINE
   ctx.lineWidth = Math.max(1, size.w / 500)
   ctx.strokeRect(0, 0, size.w, size.h)
diff --git a/packages/rpc/src/contracts.ts b/packages/rpc/src/contracts.ts
index 9b58f3b..51e780a 100644
--- a/packages/rpc/src/contracts.ts
+++ b/packages/rpc/src/contracts.ts
@@ -41,7 +41,8 @@ export const MatchSummary = Schema.Struct({
 })
 export type MatchSummary = typeof MatchSummary.Type
 
-export const Player = Schema.Struct({ id: Id, team_id: Id, name: Schema.String, jersey: Schema.Int, role: Schema.String })
+/** A squad member; `foot` is the preferred foot (the 3D view kicks with it). */
+export const Player = Schema.Struct({ id: Id, team_id: Id, name: Schema.String, jersey: Schema.Int, role: Schema.String, foot: Schema.Literals(["left", "right"]) })
 export type Player = typeof Player.Type
 
 export const MatchInfo = Schema.Struct({ ...MatchSummary.fields, players: Schema.Array(Player) })
PATCH
```

- [ ] **Step 4: Add the CC0 assets**

These two binary files cannot be written from this plan.

- **If the prototype is on this machine,** copy them:

```bash
mkdir -p apps/web/public/3d
cp ../touchline-worktrees/proto-viewer/dl/human.glb apps/web/public/3d/player.glb
cp ../touchline-worktrees/proto-viewer/dl/stadium_01.hdr apps/web/public/3d/stadium_01_1k.hdr
shasum -a 256 apps/web/public/3d/*
```

  Expected: `2dc688cc…9da5  apps/web/public/3d/player.glb` and `90b8f5e5…e0864  apps/web/public/3d/stadium_01_1k.hdr`.

- **Otherwise, download and trim them:**
  1. Download the Universal Animation Library (Standard) from https://quaternius.com/packs/universalanimationlibrary.html.
  2. Trim `Godot/AnimationLibrary_Godot_Standard.glb` to the clips `Idle_Loop`, `Walk_Loop`, `Jog_Fwd_Loop` and `Sprint_Loop`. Use `@gltf-transform/core` and `@gltf-transform/functions` 4.1.1 in a scratch folder: dispose the other animations' channels and samplers, then run `prune()` and `dedup()`. The result is about 950 KB.
  3. Download https://dl.polyhaven.org/file/ph-assets/HDRIs/hdr/1k/stadium_01_1k.hdr.

- [ ] **Step 5: Run the tests**

Run: `pnpm --filter @touchline/web test world draw`
Expected: `9 passed` (5 + 4)

Run: `pnpm --filter @touchline/api test library`
Expected: `4 passed`

Run: `pnpm --filter @touchline/rpc typecheck && pnpm --filter @touchline/api typecheck && pnpm --filter @touchline/web typecheck`
Expected: no errors

- [ ] **Step 6: Commit**

```bash
git add ATTRIBUTION.md apps/api apps/web packages/rpc
git commit -m "feat(web): the 3D world — pitch with the 2D markings on mown stripes, goals, stands and stadium light, a CC0 body per player in kit colours with gait by speed and the kick on the preferred foot (now in the match info), and the ball with its shadow

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: The 3D view on the Watch page (web)

The 3D view itself.

**`render.ts`.** It draws several cameras on one WebGL canvas. Each viewport has its own camera and its own effects chain: an MSAA half-float target, GTAO ambient occlusion (not in the tactical map), light bloom, and ACES tone mapping in an `OutputPass` with exposure 0.85. Each viewport is scissored to its rectangle. The module also answers which player is under a click.

**`assets.ts`.** It loads the body once and pre-filters the HDRI with `PMREMGenerator`.

**`Stage3D.tsx`.** React Three Fiber hosts the canvas, its size, its pixel ratio (at most 2) and the frame loop. A `useFrame` at priority 1 draws every viewport itself. Each viewport has a caption, and the stage shows a message if the assets cannot load.

**`Live3D.tsx`.** It plays the session's frames through `LiveBuffer` with these controls:
- **Follow:** starts on the player nearest the ball (spec §10 ruling 6). Change it by clicking a player, from the select, or with `[` and `]`.
- **Camera:** buttons, or keys 1–4.
- **Layout:** buttons.
- **Leaving the pitch:** when the followed player is substituted or sent off, the broadcast camera takes over with a notice.

**The Watch page.** It gets a 2D/3D toggle, remembered in `localStorage` (`touchline.view`). Without WebGL the toggle is disabled and the page stays on 2D. Cue overlays stay on top of the 3D view, and demo mode shows both profiles in 3D.

**In jsdom.** There is no WebGL, so the tests replace `Stage3D` with a stand-in and check what it was asked to draw. The drawing itself is checked in the browser (Task 11).

**Files:**
- Create: `apps/web/src/view3d/render.ts`, `apps/web/src/view3d/assets.ts`, `apps/web/src/view3d/webgl.ts`, `apps/web/src/view3d/Stage3D.tsx`, `apps/web/src/Live3D.tsx`
- Modify: `apps/web/src/Watch.tsx` (toggle, `Pane.view`), `apps/web/src/i18n.ts` (18 keys in three languages)
- Test: `apps/web/test/live3d.test.tsx`

**Interfaces:**
- Consumes: Tasks 5–7.
- Produces: `setUpRenderer(gl)`; `class MultiView(gl) { render(vps, Frame3D); pick(x, y, worlds); dispose() }`; `BODY_URL = "/3d/player.glb"`, `SKY_URL = "/3d/stadium_01_1k.hdr"`, `loadAssets(gl): Promise<Assets>`; `hasWebGL(): boolean`; `Play { sample(now), kicks(), rate() }`, `Plays { real, variant? }`, `PassLine`, `Stage3DProps { match, plays, mode, layout, camera, followed, onPick?, lines?, label(v), loading, failed }`, `Stage3D`; `CAMERA_KEY`, `nearestBall(frame)`, `Choice`, `Live3D({ match, frame, lang, children })`; `VIEW_KEY = "touchline.view"`; `Pane` prop `view?: "2d" | "3d"`.

- [ ] **Step 1: Write the failing tests**

Create `apps/web/test/live3d.test.tsx`:

```tsx
import { act, render, screen, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { beforeEach, describe, expect, it, vi } from "vitest"
import type { PitchFrame } from "@touchline/rpc"
import type { Cue } from "@touchline/schema"
import { App } from "../src/App.js"
import type { Stage3DProps } from "../src/view3d/Stage3D.js"
import { hasWebGL } from "../src/view3d/webgl.js"
import { VIEW_KEY } from "../src/Watch.js"
import { fakeClient } from "./fake-client.js"

// jsdom has no WebGL: the stage is a stand-in that shows what it was asked to draw (the drawing is checked in the browser).
vi.mock("../src/view3d/webgl.js", () => ({ hasWebGL: vi.fn(() => true) }))
vi.mock("../src/view3d/Stage3D.js", () => ({
  Stage3D: (p: Stage3DProps) => (
    <div data-testid="stage" data-camera={p.camera} data-layout={p.layout} data-mode={p.mode} data-followed={p.followed ?? ""}>
      <button type="button" onClick={() => p.onPick?.("p-lar-09")}>pick the striker</button>
      <span data-testid="caption">{p.label({ key: "main", x: 0, y: 0, w: 100, h: 100, world: "real", camera: p.camera, inset: false })}</span>
    </div>
  )
}))

const frame = (n: number, ball: [number, number], away = true): PitchFrame => ({
  frame: n, period: "first_half", clock: "10:00.00", ball: { x: ball[0], y: ball[1], z: 0 },
  home: [{ id: "p-nor-01", x: -50, y: 0 }], away: away ? [{ id: "p-lar-09", x: 10, y: 0 }] : []
})
const goal: Cue = {
  cue_id: "mo-g1-casual.en.neutral", schema: "touchline.cue/1", match_id: "lib-costly_error-1", moment_id: "mo-g1",
  anchor: { frame_from: 0, frame_to: 0, clock: "32:14" }, display: { slot: "lower_third", priority: 1, ttl_ms: 12000, template: "goal" },
  segment: { mode: "casual", lang: "en", club: null }, text: { headline: "Wylford finishes in style!", body: "A crisp finish." }, data: {}, evidence: [], verified: true
}

const watch3d = async () => {
  const client = fakeClient()
  render(<App client={client} />)
  await userEvent.click(await screen.findByRole("button", { name: "Watch" }))
  await userEvent.click(screen.getByRole("button", { name: "3D" }))
  return client
}
const stage = () => screen.getByTestId("stage").dataset

beforeEach(() => {
  localStorage.clear()
  vi.mocked(hasWebGL).mockReturnValue(true)
})

describe("the 3D view", () => {
  it("replaces the 2D pitch, keeps the cue overlays on top, and is remembered for the next visit", async () => {
    const client = await watch3d()
    expect(screen.queryByRole("img", { name: /Northwick/ })).toBeNull()
    expect(stage().mode).toBe("multi")
    act(() => client.push({ kind: "cue", cue: goal }))
    expect(document.querySelector('[data-slot="lower_third"]')!.textContent).toMatch(/Wylford finishes in style!/)
    expect(localStorage.getItem(VIEW_KEY)).toBe("3d")
    await userEvent.click(screen.getByRole("button", { name: /Back to matches/ }))
    await userEvent.click(await screen.findByRole("button", { name: "Watch" }))
    expect(screen.getByTestId("stage")).toBeTruthy()
    await userEvent.click(screen.getByRole("button", { name: "2D" }))
    expect(screen.getByRole("img", { name: /Northwick/ })).toBeTruthy()
  })

  it("stays on the 2D pitch without WebGL, and says why", async () => {
    vi.mocked(hasWebGL).mockReturnValue(false)
    localStorage.setItem(VIEW_KEY, "3d")
    render(<App client={fakeClient()} />)
    await userEvent.click(await screen.findByRole("button", { name: "Watch" }))
    const button = screen.getByRole("button", { name: "3D" }) as HTMLButtonElement
    expect(button.disabled).toBe(true)
    expect(button.title).toMatch(/WebGL/)
    expect(screen.getByRole("img", { name: /Northwick/ })).toBeTruthy()
  })

  it("follows the player nearest the ball at first, then whoever is clicked, chosen or stepped to", async () => {
    const client = await watch3d()
    act(() => client.push({ kind: "frame", frame: frame(1, [9, 0]) }))
    expect(stage().followed).toBe("p-lar-09")
    expect(screen.getByTestId("caption").textContent).toBe("Follow · #9 Feseo Wylford")
    await userEvent.keyboard("]")
    expect(stage().followed).toBe("p-nor-01")
    await userEvent.selectOptions(screen.getByLabelText("Following"), "p-lar-09")
    expect(stage().followed).toBe("p-lar-09")
    await userEvent.keyboard("[[") // a literal "["
    await userEvent.click(screen.getByRole("button", { name: "pick the striker" }))
    expect(stage().followed).toBe("p-lar-09")
  })

  it("switches camera and layout by buttons and keys 1–4", async () => {
    await watch3d()
    const cams = screen.getByRole("group", { name: "Camera" })
    await userEvent.click(within(cams).getByRole("button", { name: "Broadcast" }))
    expect(stage().camera).toBe("broadcast")
    expect(within(cams).getByRole("button", { name: "Broadcast" }).getAttribute("aria-pressed")).toBe("true")
    await userEvent.keyboard("2")
    expect(stage().camera).toBe("fp")
    await userEvent.keyboard("4")
    expect(stage().camera).toBe("tactical")
    await userEvent.click(within(screen.getByRole("group", { name: "Layout" })).getByRole("button", { name: "Grid 2×2" }))
    expect(stage().layout).toBe("grid")
  })

  it("hands over to the broadcast camera when the followed player leaves the pitch, and says so", async () => {
    const client = await watch3d()
    act(() => client.push({ kind: "frame", frame: frame(1, [9, 0]) }))
    act(() => client.push({ kind: "frame", frame: frame(2, [9, 0], false) }))
    expect(stage().camera).toBe("broadcast")
    expect(screen.getByRole("status").textContent).toMatch(/#9 Feseo Wylford left the pitch/)
  })

  it("shows both demo profiles in 3D", async () => {
    await watch3d()
    await userEvent.click(screen.getByRole("button", { name: "Split screen" }))
    expect(screen.getAllByTestId("stage")).toHaveLength(2)
  })
})
```

- [ ] **Step 2: Run them to make sure they fail**

Run: `pnpm --filter @touchline/web test live3d`
Expected: `test/live3d.test.tsx` fails to load: `../src/view3d/webgl.js` does not exist

- [ ] **Step 3: Write the implementation**

Create `apps/web/src/Live3D.tsx`:

```tsx
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react"
import type { MatchInfo, PitchFrame } from "@touchline/rpc"
import { t, type Key, type Lang } from "./i18n.js"
import { CAMERAS, type CameraKind } from "./view3d/cameras.js"
import { findKicks, type Kick } from "./view3d/kick.js"
import { LAYOUTS, type Layout, type Viewport } from "./view3d/layout.js"
import { LiveBuffer } from "./view3d/motion.js"
import { Stage3D, type Play } from "./view3d/Stage3D.js"

export const CAMERA_KEY: Record<CameraKind, Key> = { follow: "camFollow", fp: "camFp", broadcast: "camBroadcast", tactical: "camTactical" }
const LAYOUT_KEY: Record<Layout, Key> = { pip: "layoutPip", grid: "layoutGrid", single: "layoutSingle" }

/** The players on the pitch in a frame, home first. */
const onPitch = (f: PitchFrame | null): string[] => (f ? [...f.home, ...f.away].map((p) => p.id) : [])

/** Who to follow when the 3D view opens: the player nearest the ball. */
export const nearestBall = (f: PitchFrame): string | null =>
  [...f.home, ...f.away].reduce<{ id: string | null; d: number }>((m, p) => {
    const d = Math.hypot(p.x - f.ball.x, p.y - f.ball.y)
    return d < m.d ? { id: p.id, d } : m
  }, { id: null, d: Infinity }).id

/** A row of toggle buttons, one pressed. */
export const Choice = <A extends string>({ label, options, value, onChange, name }: { label: string; options: ReadonlyArray<A>; value: A; onChange: (a: A) => void; name: (a: A) => string }) => (
  <div role="group" aria-label={label} className="flex gap-0.5 rounded bg-slate-800 p-0.5">
    {options.map((o) => (
      <button key={o} type="button" aria-pressed={o === value} className={`rounded px-2 py-1 text-sm ${o === value ? "bg-amber-400 text-slate-950" : "hover:bg-slate-700"}`} onClick={() => onChange(o)}>
        {name(o)}
      </button>
    ))}
  </div>
)

/**
 * The live match in 3D (Plan 7): the session's frames played a little behind on the 3D stage, with the camera, the
 * layout and the player followed chosen here (click a player, keys 1–4 and [ ]). `children` (the cue overlays) go on top.
 */
export const Live3D = ({ match, frame, lang, children }: { match: MatchInfo; frame: PitchFrame | null; lang: Lang; children?: ReactNode }) => {
  const [camera, setCamera] = useState<CameraKind>("follow")
  const [layout, setLayout] = useState<Layout>("pip")
  const [followed, setFollowed] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const buffer = useMemo(() => new LiveBuffer(match.fps), [match])
  const kicks = useRef<{ upTo: number; list: ReadonlyArray<Kick> }>({ upTo: -1, list: [] })
  const names = useMemo(() => new Map(match.players.map((p) => [p.id, p])), [match])
  const who = (id: string) => {
    const p = names.get(id)
    return p ? `#${p.jersey} ${p.name}` : id
  }
  useEffect(() => {
    if (!frame) return
    buffer.push(frame, performance.now())
    if (followed === null) setFollowed(nearestBall(frame))
    else if ((camera === "follow" || camera === "fp") && !onPitch(frame).includes(followed)) {
      // Substituted or sent off: the broadcast camera takes over, and the viewer is told why.
      setNotice(`${who(followed)} ${t(lang, "leftPitch")}`)
      setCamera("broadcast")
    }
  }, [frame])
  const ids = onPitch(frame)
  const step = (d: number) => {
    if (!ids.length) return
    const i = followed ? ids.indexOf(followed) : -1
    setFollowed(ids[(i + d + ids.length) % ids.length]!)
    setNotice(null)
  }
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement) return
      if (e.key >= "1" && e.key <= "4") setCamera(CAMERAS[Number(e.key) - 1]!)
      if (e.key === "[") step(-1)
      if (e.key === "]") step(1)
    }
    window.addEventListener("keydown", key)
    return () => window.removeEventListener("keydown", key)
  })
  const play: Play = useMemo(
    () => ({
      sample: (now) => buffer.sample(now),
      kicks: () => {
        const frames = buffer.frames
        const last = frames.at(-1)?.frame ?? -1
        if (last !== kicks.current.upTo) kicks.current = { upTo: last, list: findKicks(frames, match.fps) }
        return kicks.current.list
      },
      rate: () => 1
    }),
    [buffer, match.fps]
  )
  const label = (v: Viewport) => (v.inset ? t(lang, "map") : t(lang, CAMERA_KEY[v.camera]) + ((v.camera === "follow" || v.camera === "fp") && followed ? ` · ${who(followed)}` : ""))
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <Choice label={t(lang, "camera")} options={CAMERAS} value={camera} onChange={(c) => (setCamera(c), setNotice(null))} name={(c) => t(lang, CAMERA_KEY[c])} />
        <Choice label={t(lang, "layout")} options={LAYOUTS} value={layout} onChange={setLayout} name={(l) => t(lang, LAYOUT_KEY[l])} />
        <label className="text-sm">
          {t(lang, "following")}{" "}
          <select aria-label={t(lang, "following")} className="rounded bg-slate-800 px-2 py-1" value={followed ?? ""} onChange={(e) => (setFollowed(e.target.value), setNotice(null))}>
            {ids.map((id) => <option key={id} value={id}>{who(id)}</option>)}
          </select>
        </label>
      </div>
      {notice && <p role="status" className="rounded bg-amber-900/60 px-3 py-1 text-sm">{notice}</p>}
      <div className="relative aspect-[16/9] w-full">
        <Stage3D match={match} plays={{ real: play }} mode="multi" layout={layout} camera={camera} followed={followed} onPick={(id) => (setFollowed(id), setNotice(null))} label={label} loading={t(lang, "loading3d")} failed={t(lang, "failed3d")} />
        {children}
      </div>
      <p className="text-xs text-slate-400">{t(lang, "keysHint")}</p>
    </div>
  )
}
```

Create `apps/web/src/view3d/Stage3D.tsx`:

```tsx
import { Canvas, useFrame, useThree } from "@react-three/fiber"
import { useEffect, useRef, useState, type MouseEvent } from "react"
import type { MatchInfo } from "@touchline/rpc"
import { loadAssets } from "./assets.js"
import type { CameraKind } from "./cameras.js"
import type { Kick } from "./kick.js"
import { viewports, type Layout, type Viewport } from "./layout.js"
import type { Sample } from "./motion.js"
import { MultiView, setUpRenderer } from "./render.js"
import { World, type Assets } from "./world.js"

/** One play the stage shows: the match as it streams, or a what-if clip. */
export interface Play {
  /** The play at wall-clock time `now` (ms). */
  sample(now: number): Sample | null
  /** Its kicks (found in its frames). */
  kicks(): ReadonlyArray<Kick>
  /** How fast the bodies animate: 0 while paused, else the playback speed. */
  rate(): number
}

export type Plays = { readonly real: Play; readonly variant?: Play }
export type PassLine = { readonly from: string; readonly to: string; readonly colour: string } | null

export interface Stage3DProps {
  readonly match: MatchInfo
  readonly plays: Plays
  readonly mode: "multi" | "split"
  readonly layout: Layout
  readonly camera: CameraKind
  readonly followed: string | null
  /** A player clicked in any view. */
  readonly onPick?: (id: string) => void
  /** Dashed pass lines, per play (the what-if divergence). */
  readonly lines?: Readonly<Partial<Record<Viewport["world"], PassLine>>>
  /** Each viewport's caption. */
  readonly label: (v: Viewport) => string
  readonly loading: string
  /** Shown instead when the players or the stadium light cannot be loaded. */
  readonly failed: string
}

type Live = { multi: MultiView; assets: Assets; worlds: Partial<Record<Viewport["world"], World>> }

/** Inside the canvas: builds the worlds once the assets load, then poses and draws them every animation frame. */
const Scene = ({ props, vps, onReady, onFail, pickRef }: { props: Stage3DProps; vps: ReadonlyArray<Viewport>; onReady: () => void; onFail: () => void; pickRef: { current: ((x: number, y: number) => string | null) | null } }) => {
  const gl = useThree((s) => s.gl)
  const live = useRef<Live | null>(null)
  const latest = useRef({ props, vps })
  latest.current = { props, vps }
  useEffect(() => {
    setUpRenderer(gl)
    let alive = true
    const multi = new MultiView(gl)
    loadAssets(gl).then((assets) => {
      if (!alive) return
      live.current = { multi, assets, worlds: {} }
      pickRef.current = (x, y) => multi.pick(x, y, live.current?.worlds ?? {})
      onReady()
    }, () => alive && onFail())
    return () => {
      alive = false
      multi.dispose()
      for (const w of Object.values(live.current?.worlds ?? {})) w?.dispose()
      live.current = null
      pickRef.current = null
    }
  }, [gl, props.match])
  // Priority 1: we draw every viewport ourselves (R3F's own render is off).
  useFrame((state, dt) => {
    const l = live.current
    if (!l) return
    const { props: p, vps: views } = latest.current
    const now = performance.now()
    const samples: Partial<Record<Viewport["world"], Sample | null>> = {}
    for (const key of ["real", "variant"] as const) {
      const play = p.plays[key]
      if (!play) continue
      const world = (l.worlds[key] ??= new World(l.assets, p.match))
      const s = play.sample(now)
      samples[key] = s
      if (!s) continue
      world.update(s, play.kicks(), p.match.fps, Math.min(0.05, dt) * play.rate())
      const line = p.lines?.[key] ?? null
      world.passLine(line?.from ?? null, line?.to ?? null, line?.colour)
    }
    l.multi.render(views, { worlds: l.worlds, samples, followed: p.followed, dt: Math.min(0.05, dt), time: state.clock.elapsedTime })
  }, 1)
  return null
}

/**
 * The 3D view (Plan 7): one WebGL canvas holding every camera of the layout, each viewport with its caption.
 * React Three Fiber hosts the canvas, its size and pixel ratio, and the frame loop.
 */
export const Stage3D = (props: Stage3DProps) => {
  const box = useRef<HTMLDivElement>(null)
  const [size, setSize] = useState({ w: 0, h: 0 })
  const [state, setState] = useState<"loading" | "ready" | "failed">("loading")
  const pick = useRef<((x: number, y: number) => string | null) | null>(null)
  useEffect(() => {
    const el = box.current
    if (!el || typeof ResizeObserver === "undefined") return
    const ro = new ResizeObserver(() => setSize({ w: el.clientWidth, h: el.clientHeight }))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  const vps = size.w > 0 ? viewports({ mode: props.mode, layout: props.layout, camera: props.camera, w: size.w, h: size.h }) : []
  const click = (e: MouseEvent<HTMLDivElement>) => {
    const r = e.currentTarget.getBoundingClientRect()
    const id = pick.current?.(e.clientX - r.left, e.clientY - r.top)
    if (id) props.onPick?.(id)
  }
  return (
    <div ref={box} className="relative h-full w-full overflow-hidden rounded-lg bg-black" onClick={click}>
      <Canvas dpr={[1, 2]} gl={{ antialias: false, powerPreference: "high-performance" }} shadows frameloop="always">
        <Scene props={props} vps={vps} onReady={() => setState("ready")} onFail={() => setState("failed")} pickRef={pick} />
      </Canvas>
      {vps.map((v) => (
        <div key={v.key} className="pointer-events-none absolute border border-white/20" style={{ left: v.x, top: v.y, width: v.w, height: v.h }}>
          <span className={`absolute left-2 top-2 whitespace-nowrap rounded bg-slate-950/80 px-2 py-0.5 font-semibold uppercase tracking-wide ${v.inset ? "text-xs" : "text-sm"}`}>{props.label(v)}</span>
        </div>
      ))}
      {state !== "ready" && <p role="status" className="absolute inset-0 grid place-items-center px-4 text-center text-slate-400">{state === "failed" ? props.failed : props.loading}</p>}
    </div>
  )
}
```

Create `apps/web/src/view3d/assets.ts`:

```ts
/** Loading the 3D view's assets (public/3d, CC0; see ATTRIBUTION.md): the rigged body once, the stadium light per renderer. */
import * as THREE from "three"
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js"
import { HDRLoader } from "three/addons/loaders/HDRLoader.js"
import type { Assets } from "./world.js"

export const BODY_URL = "/3d/player.glb"
export const SKY_URL = "/3d/stadium_01_1k.hdr"

let body: Promise<Assets["body"]> | null = null
let sky: Promise<THREE.DataTexture> | null = null

/** The body and the stadium light, the light pre-filtered for this renderer's materials. */
export const loadAssets = async (gl: THREE.WebGLRenderer): Promise<Assets> => {
  body ??= new GLTFLoader().loadAsync(BODY_URL).then((g) => ({ scene: g.scene, animations: g.animations }))
  sky ??= new HDRLoader().loadAsync(SKY_URL).then((t) => {
    t.mapping = THREE.EquirectangularReflectionMapping
    return t
  })
  const [b, s] = await Promise.all([body, sky])
  const pmrem = new THREE.PMREMGenerator(gl)
  const env = pmrem.fromEquirectangular(s).texture
  pmrem.dispose()
  return { body: b, env, sky: s }
}
```

Create `apps/web/src/view3d/render.ts`:

```ts
/**
 * Drawing several cameras on one WebGL canvas (Plan 7): each viewport gets its own camera and its own post-processing
 * chain (MSAA, ambient occlusion, a little bloom, ACES tone mapping), scissored to its rectangle. Also answers which
 * player is under a click.
 */
import * as THREE from "three"
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js"
import { GTAOPass } from "three/addons/postprocessing/GTAOPass.js"
import { OutputPass } from "three/addons/postprocessing/OutputPass.js"
import { RenderPass } from "three/addons/postprocessing/RenderPass.js"
import { UnrealBloomPass } from "three/addons/postprocessing/UnrealBloomPass.js"
import { poseCamera, type Rig, type Shot } from "./cameras.js"
import { nearestOnScreen, viewportAt, type Viewport } from "./layout.js"
import type { Sample } from "./motion.js"
import { MAP_LAYER, type World } from "./world.js"

/** Set once on the renderer: ACES (applied by each chain's output pass), exposure tuned for the stadium light. */
export const setUpRenderer = (gl: THREE.WebGLRenderer): void => {
  gl.toneMapping = THREE.ACESFilmicToneMapping
  gl.toneMappingExposure = 0.85
  gl.outputColorSpace = THREE.SRGBColorSpace
  gl.shadowMap.enabled = true
  gl.shadowMap.type = THREE.PCFShadowMap // r186 removed the soft variant
  gl.setScissorTest(true)
}

interface View {
  camera: THREE.PerspectiveCamera | THREE.OrthographicCamera
  rig: Rig | null
  composer: EffectComposer | null
  scene: THREE.Scene | null
  w: number
  h: number
}

export interface Frame3D {
  readonly worlds: Readonly<Partial<Record<Viewport["world"], World>>>
  readonly samples: Readonly<Partial<Record<Viewport["world"], Sample | null>>>
  readonly followed: string | null
  /** Seconds since the last frame (cameras ease by it), and the clock for the first-person head-bob. */
  readonly dt: number
  readonly time: number
}

export class MultiView {
  private readonly views = new Map<string, View>()
  private last: ReadonlyArray<Viewport> = []

  constructor(private readonly gl: THREE.WebGLRenderer) {}

  private view(v: Viewport): View {
    let x = this.views.get(v.key)
    const ortho = v.camera === "tactical"
    if (!x || (x.camera instanceof THREE.OrthographicCamera) !== ortho) {
      x?.composer?.dispose()
      const camera = ortho ? new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 300) : new THREE.PerspectiveCamera(50, 1, 0.05, 400)
      if (ortho) camera.layers.enable(MAP_LAYER)
      x = { camera, rig: null, composer: null, scene: null, w: 0, h: 0 }
      this.views.set(v.key, x)
    }
    return x
  }

  private aim(view: View, shot: Shot, aspect: number) {
    const c = view.camera
    if (shot.kind === "ortho" && c instanceof THREE.OrthographicCamera) {
      Object.assign(c, { left: -shot.halfW, right: shot.halfW, top: shot.halfH, bottom: -shot.halfH })
      c.up.set(0, 0, -1)
    } else if (shot.kind === "perspective" && c instanceof THREE.PerspectiveCamera) {
      c.fov = shot.fov
      c.aspect = aspect
      c.up.set(0, 1, 0)
    }
    c.position.set(...shot.pos)
    c.lookAt(...shot.look)
    c.updateProjectionMatrix()
  }

  private chain(view: View, scene: THREE.Scene, v: Viewport): EffectComposer {
    const w = Math.max(1, Math.round(v.w))
    const h = Math.max(1, Math.round(v.h))
    if (!view.composer || view.scene !== scene) {
      view.composer?.dispose()
      const target = new THREE.WebGLRenderTarget(w, h, { type: THREE.HalfFloatType, samples: 4 })
      const c = new EffectComposer(this.gl, target)
      c.addPass(new RenderPass(scene, view.camera))
      if (v.camera !== "tactical") {
        const ao = new GTAOPass(scene, view.camera, w, h)
        ao.updateGtaoMaterial({ radius: 0.6, distanceExponent: 1.5, thickness: 1.5, scale: 1 })
        ao.blendIntensity = 0.85
        c.addPass(ao)
      }
      c.addPass(new UnrealBloomPass(new THREE.Vector2(w, h), 0.22, 0.35, 0.92))
      c.addPass(new OutputPass())
      Object.assign(view, { composer: c, scene, w: 0, h: 0 })
    }
    if (view.w !== w || view.h !== h) {
      view.composer!.setPixelRatio(this.gl.getPixelRatio())
      view.composer!.setSize(w, h)
      Object.assign(view, { w, h })
    }
    return view.composer!
  }

  /** Draw every viewport (CSS pixels from the canvas's top left). */
  render(vps: ReadonlyArray<Viewport>, f: Frame3D): void {
    const height = this.gl.domElement.clientHeight
    for (const v of vps) {
      const world = f.worlds[v.world]
      const sample = f.samples[v.world]
      if (!world || !sample) continue
      const view = this.view(v)
      const player = f.followed ? (sample.players.get(f.followed) ?? null) : null
      const camera = (v.camera === "follow" || v.camera === "fp") && !player ? "broadcast" : v.camera
      const { shot, rig } = poseCamera(camera, view.rig, { player, ball: sample.ball }, f.dt, v.w / v.h, f.time)
      view.rig = rig
      this.aim(view, shot, v.w / v.h)
      world.dress({ followed: f.followed, hidden: camera === "fp" ? f.followed : null, tags: camera !== "tactical" })
      this.gl.setViewport(v.x, height - v.y - v.h, v.w, v.h)
      this.gl.setScissor(v.x, height - v.y - v.h, v.w, v.h)
      this.chain(view, world.scene, v).render(f.dt)
    }
    for (const w of Object.values(f.worlds)) w?.dress({ followed: f.followed, hidden: null, tags: true })
    // Views no longer on screen give back their GPU memory.
    for (const [key, view] of this.views) {
      if (vps.some((v) => v.key === key)) continue
      view.composer?.dispose()
      this.views.delete(key)
    }
    this.last = vps
  }

  /** The player under a click (CSS pixels from the canvas's top left), in the viewport clicked. */
  pick(x: number, y: number, worlds: Frame3D["worlds"]): string | null {
    const v = viewportAt(this.last, x, y)
    const view = v && this.views.get(v.key)
    const world = v && worlds[v.world]
    if (!v || !view || !world) return null
    const points = world.onPitch.flatMap((id) => {
      const p = world.positionOf(id)!.clone().setY(1).project(view.camera)
      return p.z > 1 ? [] : [{ id, sx: v.x + ((p.x + 1) / 2) * v.w, sy: v.y + ((1 - p.y) / 2) * v.h }]
    })
    return nearestOnScreen(points, x, y)
  }

  dispose(): void {
    for (const v of this.views.values()) v.composer?.dispose()
    this.views.clear()
  }
}
```

Create `apps/web/src/view3d/webgl.ts`:

```ts
/** Whether this browser can draw the 3D view (WebGL 2); without it the Watch page stays on the 2D pitch. */
export const hasWebGL = (): boolean => {
  try {
    return typeof document !== "undefined" && document.createElement("canvas").getContext("webgl2") !== null
  } catch {
    return false
  }
}
```

Apply this change to `apps/web/src/Watch.tsx`, `apps/web/src/i18n.ts` (from the repository root):

```bash
git apply <<'PATCH'
diff --git a/apps/web/src/Watch.tsx b/apps/web/src/Watch.tsx
index 4746a53..c8d321c 100644
--- a/apps/web/src/Watch.tsx
+++ b/apps/web/src/Watch.tsx
@@ -3,6 +3,7 @@ import type { MatchInfo, Playback } from "@touchline/rpc"
 import type { Cue } from "@touchline/schema"
 import type { TouchlineClient } from "./client.js"
 import { t, type Lang } from "./i18n.js"
+import { Live3D } from "./Live3D.js"
 import { Overlays, useNow } from "./Overlays.js"
 import { Pitch } from "./Pitch.js"
 import { ProfileBar } from "./ProfileBar.js"
@@ -12,11 +13,29 @@ import { segmentOf, type Profile } from "./profile.js"
 import { TopBar } from "./TopBar.js"
 import { routeHash } from "./route.js"
 import { usePane } from "./usePane.js"
+import { hasWebGL } from "./view3d/webgl.js"
 
 export const SPEEDS = [1, 2, 4, 8, 16, 32]
 
+/** The viewer's 2D or 3D choice, remembered in this browser (spec Plan 7: per viewer). */
+export const VIEW_KEY = "touchline.view"
+const savedView = (): "2d" | "3d" => {
+  try {
+    return localStorage.getItem(VIEW_KEY) === "3d" && hasWebGL() ? "3d" : "2d"
+  } catch {
+    return "2d"
+  }
+}
+const saveView = (v: "2d" | "3d") => {
+  try {
+    localStorage.setItem(VIEW_KEY, v)
+  } catch {
+    // private window or blocked storage: the choice lasts this visit only
+  }
+}
+
 /** One profile's view of a session: its profile bar, scoreboard, pitch and the cues for its segment over the pitch. */
-export const Pane = ({ client, sessionId, match, profile, onProfile, onWhy, label }: {
+export const Pane = ({ client, sessionId, match, profile, onProfile, onWhy, label, view = "2d" }: {
   client: TouchlineClient
   sessionId: string
   match: MatchInfo
@@ -24,6 +43,7 @@ export const Pane = ({ client, sessionId, match, profile, onProfile, onWhy, labe
   onProfile: (p: Profile) => void
   onWhy?: (cue: Cue) => void
   label?: string
+  view?: "2d" | "3d"
 }) => {
   const lang = profile.lang
   const pane = usePane(client, sessionId, segmentOf(profile))
@@ -32,10 +52,16 @@ export const Pane = ({ client, sessionId, match, profile, onProfile, onWhy, labe
     <section className="flex flex-col gap-2" aria-label={label}>
       <ProfileBar match={match} profile={profile} onChange={onProfile} {...(label ? { label } : {})} />
       <TopBar match={match} board={pane.board} lang={lang} />
-      <div className="relative">
-        <Pitch frame={pane.frame} kits={{ home: match.home.kit.primary, away: match.away.kit.primary }} label={`${match.home.name} – ${match.away.name}`} />
-        <Overlays state={pane} now={now} lang={lang} {...(onWhy ? { onWhy } : {})} />
-      </div>
+      {view === "3d" ? (
+        <Live3D match={match} frame={pane.frame} lang={lang}>
+          <Overlays state={pane} now={now} lang={lang} {...(onWhy ? { onWhy } : {})} />
+        </Live3D>
+      ) : (
+        <div className="relative">
+          <Pitch frame={pane.frame} kits={{ home: match.home.kit.primary, away: match.away.kit.primary }} label={`${match.home.name} – ${match.away.name}`} />
+          <Overlays state={pane} now={now} lang={lang} {...(onWhy ? { onWhy } : {})} />
+        </div>
+      )}
       {pane.connection !== "ok" && <p role="status" className="rounded bg-amber-900/60 px-3 py-1 text-center text-sm">{t(lang, pane.connection === "gone" ? "gone" : "lost")}</p>}
       {pane.playback?.state === "ended" && <p className="text-center font-semibold">{t(lang, "ended")}</p>}
       {pane.feed.length > 0 && (
@@ -67,6 +93,13 @@ export const Watch = ({ client, sessionId, match, profile, onProfile, onBack }:
   // Demo mode (spec §5.6): a second profile on the same session, side by side; by default the other mode, in Spanish.
   const [second, setSecond] = useState<Profile | null>(null)
   const toggleSplit = () => setSecond(second ? null : { mode: profile.mode === "casual" ? "analyst" : "casual", lang: profile.lang === "es" ? "hi" : "es", clubs: [] })
+  const [view, setView] = useState<"2d" | "3d">(savedView)
+  const webgl = hasWebGL()
+  const toggleView = () => {
+    const v = view === "3d" ? "2d" : "3d"
+    setView(v)
+    saveView(v)
+  }
   const [playback, setPlayback] = useState<Pick<Playback, "state" | "speed">>({ state: "playing", speed: 4 })
   const control = (action: "play" | "pause" | "speed", speed?: number) => client.control(sessionId, action, speed).then(setPlayback, () => {}) // a lost session shows on the pane
   return (
@@ -77,6 +110,9 @@ export const Watch = ({ client, sessionId, match, profile, onProfile, onBack }:
           {playback.state === "paused" ? t(lang, "play") : t(lang, "pause")}
         </button>
         <button type="button" className="rounded bg-slate-800 px-3 py-1" onClick={toggleSplit}>{second ? t(lang, "single") : t(lang, "split")}</button>
+        <button type="button" className="rounded bg-slate-800 px-3 py-1 disabled:opacity-50" onClick={toggleView} disabled={!webgl} title={webgl ? undefined : t(lang, "noWebgl")}>
+          {view === "3d" ? t(lang, "view2d") : t(lang, "view3d")}
+        </button>
         <a className="rounded bg-slate-800 px-3 py-1" target="_blank" rel="noreferrer" href={routeHash({ page: "studio", session: sessionId, segment: segmentOf(profile) })}>{t(lang, "studio")}</a>
         <a className="rounded bg-slate-800 px-3 py-1" target="_blank" rel="noreferrer" href={routeHash({ page: "graphics", session: sessionId, segment: segmentOf(profile), match: match.match_id })}>{t(lang, "graphicsOut")}</a>
         <a className="rounded bg-slate-800 px-3 py-1" target="_blank" rel="noreferrer" href={routeHash({ page: "ops", session: sessionId, lang })}>{t(lang, "opsView")}</a>
@@ -88,8 +124,8 @@ export const Watch = ({ client, sessionId, match, profile, onProfile, onBack }:
         </label>
       </div>
       <div className={second ? "grid gap-4 lg:grid-cols-2" : ""}>
-        <Pane client={client} sessionId={sessionId} match={match} profile={profile} onProfile={onProfile} onWhy={setWhy} label={second ? "A" : undefined} />
-        {second && <Pane client={client} sessionId={sessionId} match={match} profile={second} onProfile={setSecond} onWhy={setWhy} label="B" />}
+        <Pane client={client} sessionId={sessionId} match={match} profile={profile} onProfile={onProfile} onWhy={setWhy} label={second ? "A" : undefined} view={view} />
+        {second && <Pane client={client} sessionId={sessionId} match={match} profile={second} onProfile={setSecond} onWhy={setWhy} label="B" view={view} />}
       </div>
       <RecapPanel client={client} sessionId={sessionId} segment={segmentOf(profile)} lang={lang} />
       {why && <WhyDrawer client={client} sessionId={sessionId} cue={why} lang={lang} onClose={() => setWhy(null)} />}
diff --git a/apps/web/src/i18n.ts b/apps/web/src/i18n.ts
index 6a517f9..1ebdc81 100644
--- a/apps/web/src/i18n.ts
+++ b/apps/web/src/i18n.ts
@@ -76,7 +76,25 @@ const en = {
   moments: "Moments",
   cues: "Cues",
   none: "None",
-  missed: "missed (failed or timed out)"
+  missed: "missed (failed or timed out)",
+  view3d: "3D",
+  view2d: "2D",
+  noWebgl: "3D needs WebGL, which this browser does not have",
+  camera: "Camera",
+  layout: "Layout",
+  camFollow: "Follow",
+  camFp: "First-person",
+  camBroadcast: "Broadcast",
+  camTactical: "Tactical",
+  layoutPip: "Main + map",
+  layoutGrid: "Grid 2×2",
+  layoutSingle: "Single",
+  following: "Following",
+  map: "Map",
+  leftPitch: "left the pitch: switched to the broadcast camera",
+  loading3d: "Loading players…",
+  failed3d: "Could not load the 3D players. Switch to 2D to keep watching.",
+  keysHint: "Click a player to follow them · keys 1–4 switch camera · [ ] step through players"
 } as const
 
 export type Key = keyof typeof en
@@ -158,7 +176,25 @@ export const STRINGS: Record<Lang, Record<Key, string>> = {
     moments: "Momentos",
     cues: "Cues",
     none: "Ninguno",
-    missed: "perdidos (fallaron o expiraron)"
+    missed: "perdidos (fallaron o expiraron)",
+    view3d: "3D",
+    view2d: "2D",
+    noWebgl: "El 3D necesita WebGL, que este navegador no tiene",
+    camera: "Cámara",
+    layout: "Diseño",
+    camFollow: "Seguir",
+    camFp: "Primera persona",
+    camBroadcast: "Televisión",
+    camTactical: "Táctica",
+    layoutPip: "Principal + mapa",
+    layoutGrid: "Cuadrícula 2×2",
+    layoutSingle: "Única",
+    following: "Siguiendo a",
+    map: "Mapa",
+    leftPitch: "salió del campo: cámara de televisión",
+    loading3d: "Cargando jugadores…",
+    failed3d: "No se pudieron cargar los jugadores 3D. Cambia a 2D para seguir viendo.",
+    keysHint: "Haz clic en un jugador para seguirlo · teclas 1–4 cambian la cámara · [ ] recorren los jugadores"
   },
   hi: {
     title: "Touchline",
@@ -235,7 +271,25 @@ export const STRINGS: Record<Lang, Record<Key, string>> = {
     moments: "पल",
     cues: "क्यू",
     none: "कोई नहीं",
-    missed: "छूटे (विफल या समय समाप्त)"
+    missed: "छूटे (विफल या समय समाप्त)",
+    view3d: "3D दृश्य",
+    view2d: "2D दृश्य",
+    noWebgl: "3D के लिए WebGL चाहिए, जो इस ब्राउज़र में नहीं है",
+    camera: "कैमरा",
+    layout: "लेआउट",
+    camFollow: "पीछा",
+    camFp: "खिलाड़ी की नज़र",
+    camBroadcast: "प्रसारण",
+    camTactical: "रणनीति",
+    layoutPip: "मुख्य + नक्शा",
+    layoutGrid: "ग्रिड 2×2",
+    layoutSingle: "एक",
+    following: "किसका पीछा",
+    map: "नक्शा",
+    leftPitch: "मैदान से बाहर: प्रसारण कैमरा चालू",
+    loading3d: "खिलाड़ी लोड हो रहे हैं…",
+    failed3d: "3D खिलाड़ी लोड नहीं हुए। देखते रहने के लिए 2D चुनें।",
+    keysHint: "किसी खिलाड़ी पर क्लिक करें · 1–4 कैमरा बदलें · [ ] खिलाड़ी बदलें"
   }
 }
 
PATCH
```

- [ ] **Step 4: Run the tests**

Run: `pnpm --filter @touchline/web test live3d`
Expected: `6 passed`

Run: `pnpm --filter @touchline/web test`
Expected: `81 passed`

Run: `pnpm --filter @touchline/web typecheck`
Expected: no errors

- [ ] **Step 5: Commit**

```bash
git add apps/web
git commit -m "feat(web): the 3D view on the Watch page — a 2D/3D toggle remembered per viewer (2D without WebGL), one canvas with every camera of the layout and its own effects per view, the player nearest the ball followed first, click, keys 1–4 and [ ] to change, and the broadcast camera when the followed player leaves

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 9: Better passes from a library scan (advisor, api)

This task follows spec §10 ruling 1, a user decision. In six costly-error matches, re-simulation verified none of the 5 passes the agents flagged as better (0 of 5). Scanning every pass finds them: about 8 of 500 attacking passes per match.

**The scan.** `pnpm library` now scans each match's passes that have at least 3 options on record and were played more than 5 m into the opponents' half. The work is split across worker threads (all cores but two), and each thread:
- rebuilds the match once;
- loads every state it needs in one replay (`Session.prefetch`);
- explains each pass and cuts a clip of every verified better one.

On an M4 Pro a match takes about a minute.

**Better-pass cues.** Each verified better pass becomes a verified cue in each mode and language (`better-<event id>`). It shows once the clip's 8 seconds have played, and its words and numbers come from the re-simulation only. Its Why? evidence gives the shot and goal counts and the gain, plus `what_if` with the verdict. Library matches load the cached clips (`LibraryMatch.clips`). Agent claims keep their clips, so "Show me" on them says the verdict honestly.

**Files:**
- Create: `apps/api/src/betterpass.ts`
- Modify: `packages/advisor/src/session.ts` (`prefetch`), `apps/api/src/whatif.ts` (scan; `writeWhatIfs(dir, claimed, scanned, log)`; `makeWhatIf` starts from `LibraryMatch.clips` and gains `known`), `apps/api/src/whatif-worker.ts` (jobs), `apps/api/src/library.ts` (`clips`, better-pass cues), `apps/api/src/evidence.ts` (better-pass evidence; `makeEvidence(library, whatIf)`), `apps/api/src/server.ts`, `apps/api/src/build-library.ts` (scan; `BuildOptions.workers`)
- Test: `packages/advisor/test/advisor.test.ts`, `apps/api/test/whatif.test.ts`, `apps/api/test/build-library.test.ts`

**Interfaces:**
- Consumes: Tasks 2–4.
- Produces (advisor): `Session.prefetch(ticks: Iterable<number>): void`.
- Produces (api): `SCAN_MIN_OPTIONS = 3`, `SCAN_MIN_X = 5`, `SCAN_WORKERS`; `scanCandidates(dir): string[]`; `scanChunk(dir, eventIds): { clips, examined }`; `scanPasses(dir, { workers?, eventIds? }): Promise<{ clips, examined }>`; `WorkerJob`; `writeWhatIfs(dir, claimed, scanned, log?)`; `makeWhatIf(...)` returns `{ clip, verdict, known, match }`; `LibraryMatch.clips: ReadonlyMap<string, WhatIfClip>`; `BETTER_PREFIX = "better-"`, `betterMomentId(eventId)`, `betterEventId(momentId)`, `TEXT` (en/es/hi), `wordsOf(info, clip)`, `betterPassCues(info, clips): Cue[]` (template `better_pass`, slot `lower_third`, priority 2, ttl 10 s); `WhatIfKnown { verdict, known }`, `makeEvidence(library, whatIf?)`.

- [ ] **Step 1: Write the failing tests**

Apply this change to `apps/api/test/build-library.test.ts`, `apps/api/test/whatif.test.ts`, `packages/advisor/test/advisor.test.ts` (from the repository root):

```bash
git apply <<'PATCH'
diff --git a/apps/api/test/build-library.test.ts b/apps/api/test/build-library.test.ts
index 05d1739..b3919cd 100644
--- a/apps/api/test/build-library.test.ts
+++ b/apps/api/test/build-library.test.ts
@@ -7,6 +7,7 @@ import { afterAll, describe, expect, it } from "vitest"
 import { decodeMomentTrace, segmentKey } from "@touchline/schema"
 import { BuildError, buildLibrary, librarySegments } from "../src/build-library.js"
 import { scanLibrary } from "../src/library.js"
+import { betterMomentId } from "../src/betterpass.js"
 import { betterOptionEvents, readWhatIfs } from "../src/whatif.js"
 import { league, root } from "./fixture.js"
 
@@ -58,9 +59,14 @@ describe("library builder", () => {
     expect(m.info.segments).toHaveLength(12)
     expect(m.info.model).toBe("stub")
     expect(m.cues.length).toBeGreaterThan(100)
-    // Every pass the agents said had a better option has its what-if clip cached (the scenario has at least one).
+    // Every pass the agents said had a better option has its what-if clip cached (the scenario has at least one), and so
+    // has every verified better pass the scan found, each with a cue of its own.
     const named = betterOptionEvents(readFileSync(join(m.dir, "agents", "traces.jsonl"), "utf8").trim().split("\n").map((l) => decodeMomentTrace(JSON.parse(l))))
     expect(named.length).toBeGreaterThan(0)
-    expect([...readWhatIfs(m.dir).keys()].sort()).toEqual([...named].sort())
-  }, 300_000)
+    const clips = readWhatIfs(m.dir)
+    for (const id of named) expect(clips.has(id)).toBe(true)
+    const found = [...clips.values()].filter((c) => c.verdict === "better_option_found")
+    expect(found.length).toBeGreaterThan(0)
+    for (const c of found) expect(m.cues.filter((q) => q.moment_id === betterMomentId(c.event_id))).toHaveLength(6)
+  }, 600_000)
 })
diff --git a/apps/api/test/whatif.test.ts b/apps/api/test/whatif.test.ts
index 2c2d5d7..deb3a81 100644
--- a/apps/api/test/whatif.test.ts
+++ b/apps/api/test/whatif.test.ts
@@ -6,7 +6,8 @@ import { WhatIfClip } from "@touchline/rpc"
 import { decodeMomentTrace, type DomainEvent, type MomentTrace } from "@touchline/schema"
 import { makeEvidence } from "../src/evidence.js"
 import { readMatch, type LibraryMatch } from "../src/library.js"
-import { betterOptionEvents, computeClip, computeInWorker, makeWhatIf, readWhatIfs, WHATIF_FILE, WHATIF_SEEDS, writeWhatIfs } from "../src/whatif.js"
+import { betterMomentId } from "../src/betterpass.js"
+import { betterOptionEvents, computeClip, computeInWorker, makeWhatIf, readWhatIfs, scanCandidates, scanChunk, scanPasses, SCAN_MIN_OPTIONS, WHATIF_FILE, WHATIF_SEEDS, writeWhatIfs } from "../src/whatif.js"
 import { league, makeLibrary, MATCH_ID, type TestLibrary } from "./fixture.js"
 
 let lib: TestLibrary
@@ -48,7 +49,7 @@ describe("what-if clips", () => {
 
   it("are cached per run and read back; a pass that cannot be re-simulated is skipped", () => {
     const logs: string[] = []
-    const written = writeWhatIfs(lib.run, [pass.id, "nope"], (l) => logs.push(l))
+    const written = writeWhatIfs(lib.run, [pass.id, "nope"], [], (l) => logs.push(l))
     expect(written).toEqual([computed])
     expect(logs.join("\n")).toMatch(/no what-if for nope/)
     expect(readWhatIfs(lib.run)).toEqual(new Map([[pass.id, computed]]))
@@ -108,7 +109,7 @@ describe("the what-if service", () => {
     const goal = lib.goals[0]!
     const path = join(lib.run, "agents", "traces.jsonl")
     const original = readFileSync(path, "utf8")
-    const ev = makeEvidence(new Map([[MATCH_ID, lm]]), w.verdict)
+    const ev = makeEvidence(new Map([[MATCH_ID, lm]]), w)
     const cue = `mo-${goal.id}-casual.en.neutral`
     expect((await Effect.runPromise(ev.evidence(MATCH_ID, cue))).what_if).toBeNull()
     const traces = original.trim().split("\n").map((l) => JSON.parse(l) as MomentTrace)
@@ -116,12 +117,64 @@ describe("the what-if service", () => {
     traces[0] = { ...traces[0]!, analysis: { ...traces[0]!.analysis, claims: [...traces[0]!.analysis.claims, claim as never] } }
     writeFileSync(path, traces.map((t) => JSON.stringify(t) + "\n").join(""))
     try {
-      const fresh = makeEvidence(new Map([[MATCH_ID, lm]]), w.verdict)
+      const fresh = makeEvidence(new Map([[MATCH_ID, lm]]), w)
       expect((await Effect.runPromise(fresh.evidence(MATCH_ID, cue))).what_if).toEqual({ event_id: pass.id, verdict: "better_option_found" })
-      const unknown = makeEvidence(new Map([[MATCH_ID, lm]]))
+      const unknown = makeEvidence(new Map([[MATCH_ID, lm]]), { verdict: () => null, known: () => null })
       expect((await Effect.runPromise(unknown.evidence(MATCH_ID, cue))).what_if).toEqual({ event_id: pass.id, verdict: null })
     } finally {
       writeFileSync(path, original)
     }
   }, 60_000)
 })
+
+describe("the better-pass scan", () => {
+  it("looks at the passes with options on record, explains those played in the opponents' half, and keeps the verified better ones", async () => {
+    const all = scanCandidates(lib.run)
+    const events = readFileSync(join(lib.run, "domain.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l) as DomainEvent)
+    for (const id of all) expect((events.find((e) => e.id === id)!.attrs.options as unknown[]).length).toBeGreaterThanOrEqual(SCAN_MIN_OPTIONS)
+    const some = all.slice(200, 212)
+    const one = scanChunk(lib.run, some)
+    expect(one.examined).toBeGreaterThan(0)
+    expect(one.examined).toBeLessThanOrEqual(some.length)
+    for (const c of one.clips) {
+      expect(c.verdict).toBe("better_option_found")
+      expect(c).toEqual(computeClip(lib.run, c.event_id))
+    }
+    // Spread over threads, the same answer.
+    expect(await scanPasses(lib.run, { workers: 3, eventIds: some })).toEqual({ clips: one.clips, examined: one.examined })
+  }, 300_000)
+})
+
+describe("better-pass moments", () => {
+  const better = (): WhatIfClip => ({ ...cachedClip(), shots: { played: 1, better: 6 } })
+  const lmWith = (clips: WhatIfClip[]) => {
+    mkdirSync(join(lib.run, "agents"), { recursive: true })
+    writeFileSync(join(lib.run, "agents", WHATIF_FILE), clips.map((c) => JSON.stringify(c) + "\n").join(""))
+    return readMatch(lib.run, league)
+  }
+
+  it("become a verified cue per mode and language, shown once the clip's real play has run", () => {
+    const lm = lmWith([better(), { ...computed, event_id: "other", verdict: "played_pass_was_best" }])
+    const cues = lm.cues.filter((c) => c.moment_id === betterMomentId(pass.id))
+    expect(cues.map((c) => `${c.segment.mode}.${c.segment.lang}`).sort()).toEqual(["analyst.en", "analyst.es", "analyst.hi", "casual.en", "casual.es", "casual.hi"])
+    const en = cues.find((c) => c.segment.mode === "casual" && c.segment.lang === "en")!
+    expect(en).toMatchObject({ verified: true, evidence: [pass.id], display: { slot: "lower_third", template: "better_pass" }, anchor: { frame_from: pass.frame_id, frame_to: computed.real.at(-1)!.frame } })
+    expect(en.text!.headline).toBe("A better pass was on")
+    expect(en.text!.body).toMatch(/led to a shot in 6 of 20 re-runs, against 1 of 20\./)
+    expect(en.text!.body).toMatch(/^#\d+ \w+/)
+    expect(lm.cues.some((c) => c.moment_id === betterMomentId("other"))).toBe(false) // only verified better passes
+    const noShots = lmWith([{ ...better(), shots: { played: 2, better: 2 } }]).cues.find((c) => c.cue_id.endsWith("casual.en.neutral") && c.moment_id === betterMomentId(pass.id))!
+    expect(noShots.text!.body).toMatch(/verified better over 20 re-runs \(expected goals and threat \+0\.20\)/)
+  })
+
+  it("explain themselves with the re-simulation's numbers and offer the split", async () => {
+    const lm = lmWith([better()])
+    const ev = makeEvidence(new Map([[MATCH_ID, lm]]))
+    const e = await Effect.runPromise(ev.evidence(MATCH_ID, `${betterMomentId(pass.id)}-casual.es.neutral`))
+    expect(e.cause).toBe("A better pass was on")
+    expect(e.claims.map((c) => c.quote)).toEqual(["1 of 20 vs 6 of 20", "0 of 20 vs 2 of 20", "+0.20 ± 0.05"])
+    expect(e.events.map((x) => x.id)).toEqual([pass.id])
+    expect(e.what_if).toEqual({ event_id: pass.id, verdict: "better_option_found" })
+    expect(e.model).toBeNull()
+  }, 60_000)
+})
diff --git a/packages/advisor/test/advisor.test.ts b/packages/advisor/test/advisor.test.ts
index 3cc608f..c6d2cf8 100644
--- a/packages/advisor/test/advisor.test.ts
+++ b/packages/advisor/test/advisor.test.ts
@@ -48,6 +48,16 @@ describe("session", () => {
     expect(session.stateAt(5_000).eventSeq).toBe(lastSeq(5_000))
   })
 
+  it("fetches the states at many ticks in one run, the same as asking for each", () => {
+    const ticks = [7_001, 7_513, 22_222]
+    const fresh = Session.fromRun(dir, league, [DEFAULT_PARAMS])
+    fresh.prefetch(ticks)
+    for (const t of ticks) {
+      expect(fresh.stateAt(t)).toEqual(session.stateAt(t))
+      expect(fresh.stateAt(t)).toBe(fresh.stateAt(t))
+    }
+  })
+
   it("refuses parameters of another version, a missing folder, and a folder that does not match its manifest", () => {
     expect(() => Session.fromRun(dir, league, [{ ...DEFAULT_PARAMS, provenance: { ...DEFAULT_PARAMS.provenance, version: "other" } }])).toThrow(/the run used parameters "prior-1"; available: other/)
     expect(() => Session.fromRun(join(dir, "nope"), league, [DEFAULT_PARAMS])).toThrow(AdvisorError)
PATCH
```

- [ ] **Step 2: Run them to make sure they fail**

Run: `pnpm --filter @touchline/advisor test`
Expected: the new test fails: `fresh.prefetch is not a function`

Run: `pnpm --filter @touchline/api test whatif`
Expected: the suite fails to load: `../src/betterpass.js` does not exist

- [ ] **Step 3: Write the implementation**

Create `apps/api/src/betterpass.ts`:

```ts
/**
 * Better-pass moments (Plan 7): every verified better pass the library scan found becomes its own cue, in each
 * language, with the numbers from the re-simulation only (no model writes them, so they are verified by design).
 * Its "Why?" evidence is the verdict, and its "Show me" opens the what-if split.
 */
import type { MatchInfo, WhatIfClip } from "@touchline/rpc"
import type { Cue, Segment } from "@touchline/schema"

/** Better-pass moments are named after their pass: `better-<event id>`. */
export const BETTER_PREFIX = "better-"
export const betterMomentId = (eventId: string): string => `${BETTER_PREFIX}${eventId}`
export const betterEventId = (momentId: string | null): string | null => (momentId?.startsWith(BETTER_PREFIX) ? momentId.slice(BETTER_PREFIX.length) : null)

type Lang = Segment["lang"]
const LANGS: ReadonlyArray<Lang> = ["en", "es", "hi"]

interface Words {
  readonly passer: string
  readonly played: string
  readonly better: string
  readonly n: number
  readonly shots: { readonly played: number; readonly better: number }
  readonly gain: string
}

/** The cue's words: shots when the better pass led to more of them, else the value it added. */
export const TEXT: Readonly<Record<Lang, (w: Words) => { readonly headline: string; readonly body: string }>> = {
  en: (w) => ({
    headline: "A better pass was on",
    body:
      w.shots.better > w.shots.played
        ? `${w.passer} played it to ${w.played}; a pass to ${w.better} led to a shot in ${w.shots.better} of ${w.n} re-runs, against ${w.shots.played} of ${w.n}.`
        : `${w.passer} played it to ${w.played}; a pass to ${w.better} was verified better over ${w.n} re-runs (expected goals and threat ${w.gain}).`
  }),
  es: (w) => ({
    headline: "Había un pase mejor",
    body:
      w.shots.better > w.shots.played
        ? `${w.passer} se la dio a ${w.played}; un pase a ${w.better} acabó en tiro en ${w.shots.better} de ${w.n} repeticiones, frente a ${w.shots.played} de ${w.n}.`
        : `${w.passer} se la dio a ${w.played}; un pase a ${w.better} resultó mejor en ${w.n} repeticiones (goles esperados y amenaza ${w.gain}).`
  }),
  hi: (w) => ({
    headline: "एक बेहतर पास मौजूद था",
    body:
      w.shots.better > w.shots.played
        ? `${w.passer} ने गेंद ${w.played} को दी; ${w.better} को पास ${w.n} में से ${w.shots.better} दोबारा-खेलों में शॉट तक पहुँचा, जबकि खेला गया पास ${w.n} में से ${w.shots.played} में।`
        : `${w.passer} ने गेंद ${w.played} को दी; ${w.better} को पास ${w.n} दोबारा-खेलों में बेहतर साबित हुआ (अपेक्षित गोल और ख़तरा ${w.gain})।`
  })
}

const signed = (v: number) => `${v >= 0 ? "+" : "−"}${Math.abs(v).toFixed(2)}`

/** The words of a clip, players named "#9 Name". */
export const wordsOf = (info: MatchInfo, c: WhatIfClip): Words => {
  const who = (id: string | null) => {
    const p = info.players.find((x) => x.id === id)
    return p ? `#${p.jersey} ${p.name}` : (id ?? "")
  }
  return { passer: who(c.passer_id), played: who(c.played_to), better: who(c.better_to), n: c.seeds, shots: c.shots ?? { played: 0, better: 0 }, gain: signed(c.gain?.mean ?? 0) }
}

/** A cue per mode and language for every clip with a verified better option, shown once the clip's real play has run. */
export const betterPassCues = (info: MatchInfo, clips: Iterable<WhatIfClip>): Cue[] =>
  [...clips]
    .filter((c) => c.verdict === "better_option_found" && c.real.length > c.pass_index)
    .flatMap((c) => {
      const pass = c.real[c.pass_index]!
      const words = wordsOf(info, c)
      return (["casual", "analyst"] as const).flatMap((mode) =>
        LANGS.map((lang): Cue => ({
          cue_id: `${betterMomentId(c.event_id)}-${mode}.${lang}.neutral`,
          schema: "touchline.cue/1",
          match_id: info.match_id,
          moment_id: betterMomentId(c.event_id),
          anchor: { frame_from: pass.frame, frame_to: c.real.at(-1)!.frame, clock: pass.clock.slice(0, 5) },
          display: { slot: "lower_third", priority: 2, ttl_ms: 10_000, template: "better_pass" },
          segment: { mode, lang, club: null },
          text: TEXT[lang](words),
          data: { "whatif.seeds": c.seeds, "whatif.shots_played": c.shots?.played ?? 0, "whatif.shots_better": c.shots?.better ?? 0, "whatif.gain": c.gain?.mean ?? 0 },
          evidence: [c.event_id],
          verified: true
        }))
      )
    })
```

Apply this change to `apps/api/src/build-library.ts`, `apps/api/src/evidence.ts`, `apps/api/src/library.ts`, `apps/api/src/server.ts`, `apps/api/src/whatif-worker.ts`, `apps/api/src/whatif.ts`, `packages/advisor/src/session.ts` (from the repository root):

```bash
git apply <<'PATCH'
diff --git a/apps/api/src/build-library.ts b/apps/api/src/build-library.ts
index b033a0f..e224f1c 100644
--- a/apps/api/src/build-library.ts
+++ b/apps/api/src/build-library.ts
@@ -10,7 +10,7 @@ import { a2aSender, DEFAULT_OPTIONS, replaySignals, runGateway, startMcpStats, s
 import type { Segment } from "@touchline/schema"
 import { SCENARIOS } from "@touchline/sim"
 import { root } from "./playback.js"
-import { betterOptionEvents, writeWhatIfs } from "./whatif.js"
+import { betterOptionEvents, scanPasses, writeWhatIfs } from "./whatif.js"
 
 export class BuildError extends Error {}
 
@@ -25,6 +25,8 @@ export interface BuildOptions {
   /** The agent service, or null to simulate only (matches play with stats cues and no agent cues). */
   readonly agentsUrl: string | null
   readonly log?: (line: string) => void
+  /** Threads for the better-pass scan (default: all cores but two). */
+  readonly workers?: number
 }
 
 /** Simulate and (with an agent service) annotate each scenario; returns the run folders written. */
@@ -49,8 +51,11 @@ export const buildLibrary = async (o: BuildOptions): Promise<string[]> => {
         writeCache(dir, result)
         const s = summarize(result)
         log(`  ${s.moments} moments, ${s.cues} cues (${s.models.join(", ") || "no model"})`)
-        // The what-if split answers library matches at once: every pass the agents called a mistake, re-simulated now.
-        writeWhatIfs(dir, betterOptionEvents(result.traces), log)
+        // The what-if split answers library matches at once: every pass played in the opponents' half re-simulated now
+        // (the verified better ones become cues of their own), and every pass the agents called a mistake.
+        const scan = await scanPasses(dir, o.workers ? { workers: o.workers } : {})
+        log(`  scanned ${scan.examined} attacking passes`)
+        writeWhatIfs(dir, betterOptionEvents(result.traces), scan.clips, log)
       } finally {
         mcp.stop()
       }
diff --git a/apps/api/src/evidence.ts b/apps/api/src/evidence.ts
index ee8dd8f..29dcb6f 100644
--- a/apps/api/src/evidence.ts
+++ b/apps/api/src/evidence.ts
@@ -6,9 +6,10 @@ import { existsSync, readFileSync } from "node:fs"
 import { join } from "node:path"
 import { Effect } from "effect"
 import { loadRun } from "@touchline/mcp-stats"
-import { EvidenceNotFound, MatchNotFound, type Evidence, type EvidenceClaim, type PassVerdict, type RecapView, type Series } from "@touchline/rpc"
+import { EvidenceNotFound, MatchNotFound, type Evidence, type EvidenceClaim, type PassVerdict, type RecapView, type Series, type WhatIfClip } from "@touchline/rpc"
 import { decodeMomentTrace, decodeRecap, type Claim, type MomentTrace, type Recap, type Segment } from "@touchline/schema"
 import { METRICS, modelsFromJson, StatsError, xtGridFromJson, type Roster, type StatsQuery } from "@touchline/stats"
+import { betterEventId, TEXT, wordsOf } from "./betterpass.js"
 import { pickCues } from "./cues.js"
 import type { LibraryMatch } from "./library.js"
 import { root } from "./playback.js"
@@ -34,10 +35,17 @@ const label = (c: Claim): string => {
   return { score: "Score", minute: "Minute", event: "Event", better_option: "Better option", metric: "Metric" }[c.kind]
 }
 
-/** What re-simulation has said about a pass so far (null: not checked yet); the what-if module answers it. */
-export type VerdictOf = (m: LibraryMatch, eventId: string) => PassVerdict | null
+/** What re-simulation has said about passes so far; the what-if module answers it. */
+export interface WhatIfKnown {
+  /** The verdict on a pass (null: not checked yet). */
+  readonly verdict: (m: LibraryMatch, eventId: string) => PassVerdict | null
+  /** The clip of a pass, when there is one. */
+  readonly known: (m: LibraryMatch, eventId: string) => WhatIfClip | null
+}
+
+const NONE: WhatIfKnown = { verdict: () => null, known: (m, id) => m.clips.get(id) ?? null }
 
-export const makeEvidence = (library: ReadonlyMap<string, LibraryMatch>, verdictOf: VerdictOf = () => null) => {
+export const makeEvidence = (library: ReadonlyMap<string, LibraryMatch>, whatIf: WhatIfKnown = NONE) => {
   const queries = new Map<string, Promise<StatsQuery>>()
   const params = (f: string) => JSON.parse(readFileSync(join(root, "data/params", f), "utf8"))
   const roster = JSON.parse(readFileSync(join(root, "data/league/league.json"), "utf8")) as Roster
@@ -63,12 +71,47 @@ export const makeEvidence = (library: ReadonlyMap<string, LibraryMatch>, verdict
       ? view.live
       : { cues: m.cues, traces: jsonl<MomentTrace>(join(m.dir, "agents", "traces.jsonl"), decodeMomentTrace), recaps: jsonl<Recap>(join(m.dir, "agents", "recaps.jsonl"), decodeRecap) }
 
+  /** Behind a better-pass cue: the verdict and its numbers, from the re-simulation alone (in English, like the drawer's labels). */
+  const betterPass = (m: LibraryMatch, cueId: string, passId: string) =>
+    Effect.gen(function* () {
+      const clip = whatIf.known(m, passId)
+      if (!clip || clip.verdict !== "better_option_found") return yield* new EvidenceNotFound({ cue_id: cueId })
+      const q = yield* query(m)
+      const who = names(m)
+      const pass = clip.real[clip.pass_index]!
+      const words = wordsOf(m.info, clip)
+      const n = clip.seeds
+      const claim = (label: string, quote: string, value: number | null): EvidenceClaim => ({
+        kind: "better_option", quote, label, metric_id: null, subject: clip.better_to, subject_name: clip.better_to ? (who.get(clip.better_to) ?? null) : null, value, at_frame: pass.frame, event_id: passId
+      })
+      const out: Evidence = {
+        cue_id: cueId,
+        moment: null,
+        cause: TEXT.en(words).headline,
+        explanation: TEXT.en(words).body,
+        claims: [
+          claim("Shots after the pass played, then the better one", `${clip.shots?.played ?? 0} of ${n} vs ${clip.shots?.better ?? 0} of ${n}`, null),
+          claim("Goals after the pass played, then the better one", `${clip.goals?.played ?? 0} of ${n} vs ${clip.goals?.better ?? 0} of ${n}`, null),
+          claim("Gain: expected goals and threat (mean ± s.e.)", `${words.gain} ± ${(clip.gain?.se ?? 0).toFixed(2)}`, clip.gain?.mean ?? null)
+        ],
+        series: [],
+        events: q.eventsBetween(null, clip.real.at(-1)!.frame, { ids: [passId] }).map((e) => ({
+          id: e.id, type: e.type, clock: e.match_clock, team_id: e.team_id, player: e.player_id ? (who.get(e.player_id) ?? e.player_id) : null, outcome: e.outcome, qualifiers: { ...e.qualifiers }
+        })),
+        model: null,
+        what_if: { event_id: passId, verdict: clip.verdict }
+      }
+      return out
+    })
+
   const evidence = (matchId: string, cueId: string, view?: View) =>
     Effect.gen(function* () {
       const m = yield* match(matchId)
       const { cues, traces, recaps } = source(m, view)
       const cue = cues.find((c) => c.cue_id === cueId)
       if (!cue || !cue.moment_id || (view && cue.anchor.frame_to > view.frame)) return yield* new EvidenceNotFound({ cue_id: cueId })
+      const passId = betterEventId(cue.moment_id)
+      if (passId) return yield* betterPass(m, cue.cue_id, passId)
       const trace = traces.find((t) => t.moment.moment_id === cue.moment_id) ?? null
       const recap = recaps.find((r) => r.recap_id === cue.moment_id) ?? null
       if (!trace && !recap) return yield* new EvidenceNotFound({ cue_id: cueId })
@@ -110,7 +153,7 @@ export const makeEvidence = (library: ReadonlyMap<string, LibraryMatch>, verdict
         series,
         events,
         model: trace?.model ?? (view?.live ? null : m.info.model),
-        what_if: better ? { event_id: better, verdict: verdictOf(m, better) } : null
+        what_if: better ? { event_id: better, verdict: whatIf.verdict(m, better) } : null
       }
       return out
     })
diff --git a/apps/api/src/library.ts b/apps/api/src/library.ts
index f7f6233..a7dc47e 100644
--- a/apps/api/src/library.ts
+++ b/apps/api/src/library.ts
@@ -6,16 +6,20 @@ import { existsSync, readdirSync, readFileSync } from "node:fs"
 import { join } from "node:path"
 import type { League } from "@touchline/league"
 import { readCueCache } from "@touchline/agent-gateway"
-import type { MatchInfo, MatchSummary, Player, TeamBrief } from "@touchline/rpc"
+import type { MatchInfo, MatchSummary, Player, TeamBrief, WhatIfClip } from "@touchline/rpc"
 import { segmentKey, type Cue } from "@touchline/schema"
+import { betterPassCues } from "./betterpass.js"
+import { readWhatIfs } from "./whatif.js"
 
 export class LibraryError extends Error {}
 
 export interface LibraryMatch {
   readonly dir: string
   readonly info: MatchInfo
-  /** The agents' cached cues (empty without a cache). */
+  /** The agents' cached cues (empty without a cache), and a cue for each verified better pass the scan found. */
   readonly cues: ReadonlyArray<Cue>
+  /** The cached what-if clips by pass (`pnpm library`). */
+  readonly clips: ReadonlyMap<string, WhatIfClip>
 }
 
 interface Manifest {
@@ -53,7 +57,9 @@ export const readMatch = (dir: string, league: League): LibraryMatch => {
     match_id: m.match_id, scenario: m.scenario, seed: m.seed, home: home.brief, away: away.brief, score: { home: h ?? 0, away: a ?? 0 },
     fps: m.fps, frames: m.stats.frames, segments: [...new Set(cues.map((c) => segmentKey(c.segment)))].sort(), model
   }
-  return { dir, info: { ...summary, players: [...home.players, ...away.players] }, cues }
+  const info = { ...summary, players: [...home.players, ...away.players] }
+  const clips = readWhatIfs(dir)
+  return { dir, info, cues: [...cues, ...betterPassCues(info, clips.values())], clips }
 }
 
 /** Every run folder directly under `root`, by match id (folders that are not runs are skipped). */
diff --git a/apps/api/src/server.ts b/apps/api/src/server.ts
index d011303..afb0f24 100644
--- a/apps/api/src/server.ts
+++ b/apps/api/src/server.ts
@@ -32,7 +32,7 @@ export const handlersLayer = (o: ApiOptions) =>
   Layer.unwrap(
     Effect.gen(function* () {
       const whatIf = makeWhatIf(o.library, o.whatIf)
-      const ev = makeEvidence(o.library, whatIf.verdict)
+      const ev = makeEvidence(o.library, whatIf)
       const studio = makeStudio(ev)
       const ops = makeOps()
       const sessions = yield* makeSessions(o.library, { ...(o.companion ? { companion: o.companion } : {}), studio: studio.record })
diff --git a/apps/api/src/whatif-worker.ts b/apps/api/src/whatif-worker.ts
index 4d82c5d..8937406 100644
--- a/apps/api/src/whatif-worker.ts
+++ b/apps/api/src/whatif-worker.ts
@@ -1,10 +1,10 @@
-/** Computes one what-if clip off the main thread (whatif.ts computeInWorker). */
+/** Runs one what-if job off the main thread (whatif.ts): a clip on request, or a share of a library scan. */
 import { parentPort, workerData } from "node:worker_threads"
-import { computeClip } from "./whatif.js"
+import { computeClip, scanChunk, type WorkerJob } from "./whatif.js"
 
-const { dir, eventId } = workerData as { dir: string; eventId: string }
+const job = workerData as WorkerJob
 try {
-  parentPort!.postMessage({ clip: computeClip(dir, eventId) })
+  parentPort!.postMessage({ ok: job.kind === "clip" ? computeClip(job.dir, job.eventId) : scanChunk(job.dir, job.eventIds) })
 } catch (e) {
   parentPort!.postMessage({ error: e instanceof Error ? e.message : String(e) })
 }
diff --git a/apps/api/src/whatif.ts b/apps/api/src/whatif.ts
index 4682763..eaedc9c 100644
--- a/apps/api/src/whatif.ts
+++ b/apps/api/src/whatif.ts
@@ -5,14 +5,15 @@
  * within a time limit, and kept for the next viewer. Answers never go past the session's frame.
  */
 import { existsSync, readFileSync, writeFileSync } from "node:fs"
+import { availableParallelism } from "node:os"
 import { join } from "node:path"
 import { Worker } from "node:worker_threads"
 import { Effect, Schema } from "effect"
-import { explainPass, passClip, Session } from "@touchline/advisor"
+import { explainPass, passClip, Session, type PassClip } from "@touchline/advisor"
 import { MatchNotFound, WhatIfClip, WhatIfNotAvailable, type PassVerdict, type PitchFrame } from "@touchline/rpc"
 import { decodeDomainEvent, type DomainEvent, type MomentTrace } from "@touchline/schema"
-import { DEFAULT_PARAMS, matchClock, paramsFromJson, type Frame, type TeamSetup } from "@touchline/sim-core"
-import { xtGridFromJson } from "@touchline/stats"
+import { attackX, DEFAULT_PARAMS, matchClock, paramsFromJson, type Frame, type TeamSetup } from "@touchline/sim-core"
+import { xtGridFromJson, type XtGrid } from "@touchline/stats"
 import type { LibraryMatch } from "./library.js"
 import { root } from "./playback.js"
 
@@ -36,13 +37,16 @@ const toPitchFrame = (f: Frame, dt: number): PitchFrame => ({
   away: f.away.map((p) => ({ id: p.id, x: r3(p.x), y: r3(p.y) }))
 })
 
-/** Rebuild a run folder's match, explain the pass and cut its clip (CPU only: a few seconds; throws AdvisorError). */
-export const computeClip = (dir: string, eventId: string): WhatIfClip => {
+/** A run folder's match rebuilt for re-simulation, with the expected-threat grid. */
+const rebuild = (dir: string) => {
   const json = (p: string) => JSON.parse(readFileSync(join(root, p), "utf8"))
   const league = json("data/league/league.json") as { clubs: ReadonlyArray<TeamSetup> }
   const session = Session.fromRun(dir, league, [paramsFromJson(json("data/params/touchline-params.json")), DEFAULT_PARAMS])
-  const xt = xtGridFromJson(json("data/params/xt-grid.json"))
-  const c = passClip(session, explainPass(session, eventId, xt, { seeds: WHATIF_SEEDS, horizonS: WHATIF_HORIZON_S }), xt)
+  return { session, xt: xtGridFromJson(json("data/params/xt-grid.json")) }
+}
+
+/** The clip of an explained pass, in the API's frame shape. */
+const toClip = (session: Session, c: PassClip): WhatIfClip => {
   const dt = session.cfg.dt
   return {
     event_id: c.event_id, verdict: c.verdict, passer_id: c.passer_id, played_to: c.played_to, better_to: c.better_to, fps: Math.round(1 / dt), pass_index: c.pass_index,
@@ -51,6 +55,45 @@ export const computeClip = (dir: string, eventId: string): WhatIfClip => {
   }
 }
 
+const explained = (session: Session, xt: XtGrid, eventId: string) => explainPass(session, eventId, xt, { seeds: WHATIF_SEEDS, horizonS: WHATIF_HORIZON_S })
+
+/** Rebuild a run folder's match, explain the pass and cut its clip (CPU only: a few seconds; throws AdvisorError). */
+export const computeClip = (dir: string, eventId: string): WhatIfClip => {
+  const { session, xt } = rebuild(dir)
+  return toClip(session, passClip(session, explained(session, xt, eventId), xt))
+}
+
+/** The scan looks at passes with at least this many options on record, ... */
+export const SCAN_MIN_OPTIONS = 3
+/** ... played from at least this far (m) into the opponents' half. */
+export const SCAN_MIN_X = 5
+
+/** The passes of a run worth scanning for a better option (by option count; the scan checks where each was played). */
+export const scanCandidates = (dir: string): string[] =>
+  readFileSync(join(dir, "domain.jsonl"), "utf8").split("\n").filter((l) => l.trim()).map((l) => decodeDomainEvent(JSON.parse(l)))
+    .filter((e) => e.type === "pass" && e.player_id !== null && ((e.attrs.options as unknown[] | undefined) ?? []).length >= SCAN_MIN_OPTIONS)
+    .map((e) => e.id)
+
+/**
+ * Explain each of the passes (those played in the opponents' half) and cut a clip of every one with a verified better
+ * option: one match rebuild and one replay for all their states. CPU only; for a worker thread.
+ */
+export const scanChunk = (dir: string, eventIds: ReadonlyArray<string>): { readonly clips: WhatIfClip[]; readonly examined: number } => {
+  const { session, xt } = rebuild(dir)
+  const events = eventIds.map((id) => session.event(id))
+  session.prefetch(events.map((e) => e.frame_id - 1))
+  const attacking = events.filter((e) => {
+    const p = session.stateAt(e.frame_id - 1).players.find((q) => q.id === e.player_id)
+    return p !== undefined && attackX(p.side, p.pos.x) > SCAN_MIN_X
+  })
+  const clips: WhatIfClip[] = []
+  for (const e of attacking) {
+    const x = explained(session, xt, e.id)
+    if (x.verdict === "better_option_found") clips.push(toClip(session, passClip(session, x, xt)))
+  }
+  return { clips, examined: attacking.length }
+}
+
 /** The passes the agents' traces say had a better option (claims of kind better_option), first seen first. */
 export const betterOptionEvents = (traces: ReadonlyArray<MomentTrace>): string[] => [
   ...new Set(traces.flatMap((t) => [...t.analysis.claims, ...t.draft.claims]).flatMap((c) => (c.kind === "better_option" && c.event_id ? [c.event_id] : [])))
@@ -66,33 +109,18 @@ export const readWhatIfs = (dir: string): Map<string, WhatIfClip> => {
   return new Map(clips.map((c) => [c.event_id, c]))
 }
 
-/** Compute and cache the clip of every pass the run's traces name (passes that cannot be re-simulated are skipped). */
-export const writeWhatIfs = (dir: string, eventIds: ReadonlyArray<string>, log: (line: string) => void = () => {}): WhatIfClip[] => {
-  const clips: WhatIfClip[] = []
-  for (const id of eventIds) {
-    try {
-      clips.push(computeClip(dir, id))
-    } catch (e) {
-      log(`  no what-if for ${id}: ${e instanceof Error ? e.message : String(e)}`)
-    }
-  }
-  writeFileSync(join(dir, "agents", WHATIF_FILE), clips.map((c) => JSON.stringify(c) + "\n").join(""))
-  log(`  ${clips.length} what-if clips (${clips.filter((c) => c.verdict === "better_option_found").length} with a better option)`)
-  return clips
-}
-
-/** computeClip in a worker thread, so sessions keep playing while it runs. */
-export const computeInWorker = (dir: string, eventId: string, timeoutMs: number): Promise<WhatIfClip> =>
+/** One job in a worker thread: its answer, or its error as a rejection; terminated after `timeoutMs`. */
+const inWorker = <A>(job: WorkerJob, timeoutMs: number): Promise<A> =>
   new Promise((resolve, reject) => {
-    const worker = new Worker(new URL("./whatif-worker.ts", import.meta.url), { workerData: { dir, eventId }, execArgv: ["--import", "tsx"] })
+    const worker = new Worker(new URL("./whatif-worker.ts", import.meta.url), { workerData: job, execArgv: ["--import", "tsx"] })
     const timer = setTimeout(() => {
       void worker.terminate()
       reject(new Error(`timed out after ${timeoutMs / 1000} s`))
     }, timeoutMs)
-    worker.once("message", (m: { clip?: WhatIfClip; error?: string }) => {
+    worker.once("message", (m: { ok?: A; error?: string }) => {
       clearTimeout(timer)
       void worker.terminate()
-      m.clip ? resolve(m.clip) : reject(new Error(m.error ?? "no answer"))
+      m.error === undefined ? resolve(m.ok as A) : reject(new Error(m.error))
     })
     worker.once("error", (e) => {
       clearTimeout(timer)
@@ -100,6 +128,43 @@ export const computeInWorker = (dir: string, eventId: string, timeoutMs: number)
     })
   })
 
+export type WorkerJob = { readonly kind: "clip"; readonly dir: string; readonly eventId: string } | { readonly kind: "scan"; readonly dir: string; readonly eventIds: ReadonlyArray<string> }
+
+/** computeClip in a worker thread, so sessions keep playing while it runs. */
+export const computeInWorker = (dir: string, eventId: string, timeoutMs: number): Promise<WhatIfClip> => inWorker({ kind: "clip", dir, eventId }, timeoutMs)
+
+/** Threads the scan uses by default: all cores but two. */
+export const SCAN_WORKERS = Math.max(1, availableParallelism() - 2)
+
+/** Scan a run's passes for verified better options across worker threads (the work split evenly); clips in match order. */
+export const scanPasses = async (dir: string, o: { readonly workers?: number; readonly eventIds?: ReadonlyArray<string> } = {}): Promise<{ readonly clips: WhatIfClip[]; readonly examined: number }> => {
+  const ids = o.eventIds ?? scanCandidates(dir)
+  const n = Math.max(1, Math.min(o.workers ?? SCAN_WORKERS, ids.length))
+  const chunks = Array.from({ length: n }, (_, i) => ids.filter((_, j) => j % n === i)).filter((c) => c.length > 0)
+  const parts = await Promise.all(chunks.map((eventIds) => inWorker<{ clips: WhatIfClip[]; examined: number }>({ kind: "scan", dir, eventIds }, 60 * 60_000)))
+  return { clips: parts.flatMap((p) => p.clips).sort((a, b) => a.real[a.pass_index]!.frame - b.real[b.pass_index]!.frame), examined: parts.reduce((a, p) => a + p.examined, 0) }
+}
+
+/**
+ * Cache a run's what-if clips: the scan's (verified better passes) and the clip of every pass the agents' traces
+ * name (whatever its verdict, so a "Show me" on it can say so). Passes that cannot be re-simulated are skipped.
+ */
+export const writeWhatIfs = (dir: string, claimed: ReadonlyArray<string>, scanned: ReadonlyArray<WhatIfClip>, log: (line: string) => void = () => {}): WhatIfClip[] => {
+  const clips = new Map(scanned.map((c) => [c.event_id, c]))
+  for (const id of claimed) {
+    if (clips.has(id)) continue
+    try {
+      clips.set(id, computeClip(dir, id))
+    } catch (e) {
+      log(`  no what-if for ${id}: ${e instanceof Error ? e.message : String(e)}`)
+    }
+  }
+  const all = [...clips.values()]
+  writeFileSync(join(dir, "agents", WHATIF_FILE), all.map((c) => JSON.stringify(c) + "\n").join(""))
+  log(`  ${all.length} what-if clips (${all.filter((c) => c.verdict === "better_option_found").length} with a better option)`)
+  return all
+}
+
 export interface WhatIfOptions {
   /** How a clip is computed on request (default: computeInWorker within `timeoutMs`). */
   readonly compute?: (dir: string, eventId: string) => Promise<WhatIfClip>
@@ -114,7 +179,7 @@ export const makeWhatIf = (library: ReadonlyMap<string, LibraryMatch>, o: WhatIf
   const events = new Map<string, ReadonlyArray<DomainEvent>>()
   const clipsOf = (m: LibraryMatch) => {
     let c = cached.get(m.info.match_id)
-    if (!c) cached.set(m.info.match_id, (c = readWhatIfs(m.dir)))
+    if (!c) cached.set(m.info.match_id, (c = new Map(m.clips)))
     return c
   }
   const eventsOf = (m: LibraryMatch) => {
@@ -155,5 +220,8 @@ export const makeWhatIf = (library: ReadonlyMap<string, LibraryMatch>, o: WhatIf
       return { ...c, real: c.real.slice(0, n), variant: c.variant ? c.variant.slice(0, n) : null }
     })
 
-  return { clip, verdict, match } as const
+  /** The clip of a pass if it is cached or was computed (never computes). */
+  const known = (m: LibraryMatch, eventId: string): WhatIfClip | null => clipsOf(m).get(eventId) ?? null
+
+  return { clip, verdict, known, match } as const
 }
diff --git a/packages/advisor/src/session.ts b/packages/advisor/src/session.ts
index 068f624..ad63c13 100644
--- a/packages/advisor/src/session.ts
+++ b/packages/advisor/src/session.ts
@@ -20,6 +20,8 @@ export const SESSION_CACHE_STATES = 256
 export class Session {
   private readonly cache = new Map<number, MatchState>()
   private readonly checkpoints = new Map<number, MatchState>()
+  /** States fetched ahead in one pass (prefetch), kept until the session goes. */
+  private readonly pinned = new Map<number, MatchState>()
 
   constructor(
     readonly cfg: MatchConfig,
@@ -29,7 +31,7 @@ export class Session {
 
   /** The state after the step of `tick` (tick -1: before kick-off). */
   stateAt(tick: number): MatchState {
-    const hit = this.cache.get(tick) ?? this.checkpoints.get(tick)
+    const hit = this.pinned.get(tick) ?? this.cache.get(tick) ?? this.checkpoints.get(tick)
     if (hit) return hit
     if (!Number.isInteger(tick) || tick < -1) throw new AdvisorError(`no state at tick ${tick}`)
     let s: MatchState
@@ -52,6 +54,15 @@ export class Session {
     return s
   }
 
+  /**
+   * Compute the states at many ticks in one run of the match (a scripted match is replayed once, not once per tick)
+   * and keep them all: for scanning many events. About 25 kB per state.
+   */
+  prefetch(ticks: Iterable<number>): void {
+    const want = [...new Set(ticks)].filter((t) => !this.pinned.has(t))
+    if (want.length) for (const [t, s] of statesAt(this.cfg, want)) this.pinned.set(t, s)
+  }
+
   /** States kept for reuse (asked for and checkpoints). */
   get cachedStates(): number {
     return this.cache.size + this.checkpoints.size
PATCH
```

- [ ] **Step 4: Run the tests**

Run: `pnpm --filter @touchline/advisor test`
Expected: `17 passed`

Run: `pnpm --filter @touchline/api test whatif`
Expected: `11 passed` (about 2 min)

Run: `pnpm --filter @touchline/api test`
Expected: all pass (`65 passed`; `build-library` needs `uv`)

Run: `pnpm --filter @touchline/advisor typecheck && pnpm --filter @touchline/api typecheck`
Expected: no errors

- [ ] **Step 5: Commit**

```bash
git add apps/api packages/advisor
git commit -m "feat(api): better-pass moments — pnpm library scans every pass played in the opponents' half across worker threads, and each verified better option becomes a verified cue in every language whose Why? gives the re-simulation's numbers and offers the split

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 10: The what-if split (web)

**The drawer.** A better pass's Why? drawer offers **Show me** when the verdict is `better_option_found` or not known yet. It says honestly when the pass played was best or could not be verified.

**The split.** "Show me" opens the split (`WhatIfSplit`): the pass as it went on the left and the better pass played out on the right, on one clock and one camera, following the passer.
- **Divergence:** for a second after the pass the clock runs at half speed, a ring flashes, and the two pass lines show on the grass (red for the pass played, green for the better one).
- **Evidence strip:** shots `better / 20 vs played / 20`, goals, the gain ± its standard error, and which re-run is shown.
- **Loop:** the clip loops from 1.8 s before the pass.
- **Back to live:** returns to the live view. The live panes kept receiving the match while hidden, because only this viewer left.
- **Waiting and failure:** a computation that takes over 300 ms says "Re-simulating 20 futures…", and a failure says so.

**Auto-show.** A checkbox on the Watch page opens the split by itself on each better-pass cue (the demo video).

**Files:**
- Create: `apps/web/src/view3d/clipclock.ts`, `apps/web/src/WhatIfSplit.tsx`
- Modify: `apps/web/src/client.ts` (`whatIf`), `apps/web/src/WhyDrawer.tsx` (`onShowMe`), `apps/web/src/Watch.tsx` (split, auto-show, `Pane.onBetterPass`), `apps/web/src/i18n.ts` (14 keys in three languages)
- Test: `apps/web/test/clipclock.test.ts`, `apps/web/test/whatif.test.tsx`, `apps/web/test/fake-client.ts` (`whatIf`)

**Interfaces:**
- Consumes: `GetWhatIf`, `WhatIfClip`, `Evidence.what_if` (Task 3); better-pass cues (Task 9); `Stage3D`, `Choice`, `CAMERA_KEY` (Task 8).
- Produces: `TouchlineClient.whatIf(sessionId, eventId): Promise<WhatIfClip>`; `SLOW = 0.5`, `SLOW_S = 1`, `LEAD_S = 1.8`, `ClipTiming`, `loopStart`, `isSlow`, `advance(c, f, dt, speed)`; `WhatIfSplit({ client, sessionId, eventId, match, lang, onClose })`; `WhyDrawer` prop `onShowMe?(eventId)`; `Pane` prop `onBetterPass?(eventId)`.

- [ ] **Step 1: Write the failing tests**

Create `apps/web/test/clipclock.test.ts`:

```ts
import { describe, expect, it } from "vitest"
import { advance, isSlow, LEAD_S, loopStart, SLOW } from "../src/view3d/clipclock.js"

const clip = { fps: 10, passIndex: 20, length: 100 }

describe("the what-if clock", () => {
  it("plays at the chosen speed, in slow motion for a second after the pass", () => {
    expect(advance(clip, 5, 0.1, 1)).toBeCloseTo(6)
    expect(advance(clip, 5, 0.1, 2)).toBeCloseTo(7)
    expect(isSlow(clip, 19.9)).toBe(false)
    expect(isSlow(clip, 20)).toBe(true)
    expect(advance(clip, 20, 0.1, 1)).toBeCloseTo(20 + SLOW)
    expect(isSlow(clip, 30)).toBe(false)
  })

  it("loops back to just before the pass at the end", () => {
    expect(loopStart(clip)).toBe(20 - LEAD_S * 10)
    expect(advance(clip, 98.95, 0.1, 1)).toBe(loopStart(clip))
    expect(loopStart({ fps: 10, passIndex: 5, length: 50 })).toBe(0)
  })
})
```

Create `apps/web/test/whatif.test.tsx`:

```tsx
import { act, render, screen, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { describe, expect, it, vi } from "vitest"
import type { Evidence, PitchFrame, WhatIfClip } from "@touchline/rpc"
import type { Cue } from "@touchline/schema"
import { App } from "../src/App.js"
import type { Stage3DProps } from "../src/view3d/Stage3D.js"
import { fakeClient } from "./fake-client.js"

// jsdom has no WebGL: the stage is a stand-in showing what it was asked to draw.
vi.mock("../src/view3d/webgl.js", () => ({ hasWebGL: () => true }))
vi.mock("../src/view3d/Stage3D.js", () => ({
  Stage3D: (p: Stage3DProps) => (
    <div data-testid="stage" data-mode={p.mode} data-camera={p.camera} data-followed={p.followed ?? ""}>
      {p.mode === "split" && ["real", "variant"].map((world) => <span key={world}>{p.label({ key: world, x: 0, y: 0, w: 1, h: 1, world: world as "real", camera: p.camera, inset: false })}</span>)}
    </div>
  )
}))

const frame = (n: number): PitchFrame => ({ frame: n, period: "first_half", clock: "16:30.00", ball: { x: 0, y: 0, z: 0 }, home: [{ id: "p-nor-01", x: 0, y: 0 }], away: [{ id: "p-lar-09", x: 5, y: 0 }] })
const clip: WhatIfClip = {
  event_id: "e679", verdict: "better_option_found", passer_id: "p-nor-01", played_to: "p-lar-09", better_to: "p-nor-01", fps: 10, pass_index: 20,
  real: Array.from({ length: 100 }, (_, i) => frame(9880 + i)), variant: Array.from({ length: 100 }, (_, i) => frame(9880 + i)),
  seeds: 20, horizon_s: 10, typical_seed: 8, shots: { played: 1, better: 6 }, goals: { played: 0, better: 2 }, gain: { mean: 0.2, se: 0.05 }
}
const better: Cue = {
  cue_id: "better-e679-casual.en.neutral", schema: "touchline.cue/1", match_id: "lib-costly_error-1", moment_id: "better-e679",
  anchor: { frame_from: 9900, frame_to: 9979, clock: "16:30" }, display: { slot: "lower_third", priority: 2, ttl_ms: 10000, template: "better_pass" },
  segment: { mode: "casual", lang: "en", club: null }, text: { headline: "A better pass was on", body: "#1 Datan Drenussen played it to #9 Feseo Wylford; …" },
  data: { "whatif.seeds": 20 }, evidence: ["e679"], verified: true
}
const evidence = (verdict: WhatIfClip["verdict"] | null): Evidence => ({
  cue_id: better.cue_id, moment: null, cause: "A better pass was on", explanation: null, claims: [], series: [], events: [], model: null, what_if: { event_id: "e679", verdict }
})

const open = async (o: Parameters<typeof fakeClient>[0]) => {
  const client = fakeClient(o)
  render(<App client={client} />)
  await userEvent.click(await screen.findByRole("button", { name: "Watch" }))
  act(() => client.push({ kind: "cue", cue: better }))
  await userEvent.click(within(document.querySelector('[data-slot="lower_third"]') as HTMLElement).getByRole("button", { name: "Why?" }))
  return client
}

describe("the what-if split", () => {
  it("opens from a better pass's Why? drawer: both plays on one camera, the passer followed, the verified numbers, then back to live", async () => {
    const client = await open({ evidence: evidence("better_option_found"), whatIf: async () => clip })
    await userEvent.click(await screen.findByRole("button", { name: "Show me" }))
    expect(screen.queryByRole("dialog")).toBeNull()
    const split = await screen.findByRole("region", { name: "What if" })
    const stage = within(split).getByTestId("stage")
    expect(stage.dataset).toMatchObject({ mode: "split", camera: "follow", followed: "p-nor-01" })
    expect(within(split).getByText("What happened · pass to #9 Feseo Wylford")).toBeTruthy()
    expect(within(split).getByText("What if · pass to #1 Datan Drenussen")).toBeTruthy()
    const strip = within(split).getByTestId("evidence-strip")
    expect(strip.textContent).toMatch(/6 \/ 20 vs 1 \/ 20/)
    expect(strip.textContent).toMatch(/Goals: 2 vs 0/)
    expect(strip.textContent).toMatch(/\+0\.20 ± 0\.05/)
    expect(strip.textContent).toMatch(/re-run #8/)
    await userEvent.click(within(split).getByRole("button", { name: "Broadcast" }))
    expect(within(split).getByTestId("stage").dataset.camera).toBe("broadcast")
    expect(client.calls).toContain("whatIf e679")
    // The live match kept coming while the split was open.
    expect(client.watchers).toHaveLength(1)
    await userEvent.click(within(split).getByRole("button", { name: "Back to live" }))
    expect(screen.queryByRole("region", { name: "What if" })).toBeNull()
    expect(screen.getByRole("img", { name: /Northwick/ })).toBeTruthy()
  })

  it("offers it while the verdict is not known yet, and says honestly when re-simulation finds no better pass", async () => {
    await open({ evidence: evidence(null), whatIf: async () => ({ ...clip, verdict: "played_pass_was_best", better_to: null, variant: null }) })
    await userEvent.click(await screen.findByRole("button", { name: "Show me" }))
    expect(await screen.findByText("Re-simulation says the pass played was the best option")).toBeTruthy()
    expect(screen.queryByTestId("evidence-strip")).toBeNull()
  })

  it("is not offered when the verdict already says the pass played was best", async () => {
    await open({ evidence: evidence("played_pass_was_best") })
    const drawer = await screen.findByRole("dialog")
    expect(await within(drawer).findByText("Re-simulation says the pass played was the best option")).toBeTruthy()
    expect(within(drawer).queryByRole("button", { name: "Show me" })).toBeNull()
  })

  it("says it is re-simulating when the answer takes a while, and when it fails", async () => {
    let fail: (e: Error) => void = () => {}
    await open({ evidence: evidence(null), whatIf: () => new Promise((_, reject) => (fail = reject)) })
    await userEvent.click(await screen.findByRole("button", { name: "Show me" }))
    expect(await screen.findByText("Re-simulating 20 futures…", {}, { timeout: 2000 })).toBeTruthy()
    act(() => fail(new Error("WhatIfNotAvailable: timed out")))
    expect(await screen.findByText("Couldn't re-simulate this moment")).toBeTruthy()
  })

  it("opens by itself on a better pass when auto-show is on (the demo)", async () => {
    const client = fakeClient({ whatIf: async () => clip })
    render(<App client={client} />)
    await userEvent.click(await screen.findByRole("button", { name: "Watch" }))
    act(() => client.push({ kind: "cue", cue: { ...better, cue_id: "x", moment_id: "better-x" } }))
    expect(screen.queryByRole("region", { name: "What if" })).toBeNull()
    await userEvent.click(screen.getByLabelText("Auto-show better passes"))
    act(() => client.push({ kind: "cue", cue: better }))
    expect(await screen.findByRole("region", { name: "What if" })).toBeTruthy()
  })
})
```

Apply this change to `apps/web/test/fake-client.ts` (from the repository root):

```bash
git apply <<'PATCH'
diff --git a/apps/web/test/fake-client.ts b/apps/web/test/fake-client.ts
index 8387316..d843192 100644
--- a/apps/web/test/fake-client.ts
+++ b/apps/web/test/fake-client.ts
@@ -1,5 +1,5 @@
 /** A TouchlineClient for component tests: canned answers, and ticks the test pushes to every watcher. */
-import type { Evidence, MatchInfo, MatchSummary, OpsReport, Playback, RecapView, StudioTick, Tick } from "@touchline/rpc"
+import type { Evidence, MatchInfo, MatchSummary, OpsReport, Playback, RecapView, StudioTick, Tick, WhatIfClip } from "@touchline/rpc"
 import type { Segment } from "@touchline/schema"
 import type { TouchlineClient } from "../src/client.js"
 
@@ -35,7 +35,7 @@ export interface FakeClient extends TouchlineClient {
   pushGraphics(t: Tick): void
 }
 
-export const fakeClient = (o: { matches?: ReadonlyArray<MatchSummary>; evidence?: Evidence; recap?: RecapView; ops?: OpsReport } = {}): FakeClient => {
+export const fakeClient = (o: { matches?: ReadonlyArray<MatchSummary>; evidence?: Evidence; recap?: RecapView; ops?: OpsReport; whatIf?: () => Promise<WhatIfClip> } = {}): FakeClient => {
   const watchers: FakeClient["watchers"] = []
   const studios: FakeClient["studios"] = []
   const outputs: FakeClient["outputs"] = []
@@ -95,6 +95,11 @@ export const fakeClient = (o: { matches?: ReadonlyArray<MatchSummary>; evidence?
       if (!o.evidence) throw new Error("no evidence")
       return o.evidence
     },
+    whatIf: async (_s, eventId) => {
+      calls.push(`whatIf ${eventId}`)
+      if (!o.whatIf) throw new Error("no what-if")
+      return o.whatIf()
+    },
     recap: async (sessionId, kind) => {
       calls.push(`recap ${sessionId} ${kind}`)
       return o.recap ?? { recap: null, cards: [] }
PATCH
```

- [ ] **Step 2: Run them to make sure they fail**

Run: `pnpm --filter @touchline/web test whatif clipclock`
Expected: `test/clipclock.test.ts` fails to load (`../src/view3d/clipclock.js` does not exist); the five split tests fail (no Show me button, no auto-show checkbox)

- [ ] **Step 3: Write the implementation**

Create `apps/web/src/WhatIfSplit.tsx`:

```tsx
import { useEffect, useMemo, useRef, useState } from "react"
import type { MatchInfo, WhatIfClip } from "@touchline/rpc"
import type { TouchlineClient } from "./client.js"
import { t, type Lang } from "./i18n.js"
import { CAMERA_KEY, Choice } from "./Live3D.js"
import { CAMERAS, type CameraKind } from "./view3d/cameras.js"
import { advance, isSlow, loopStart } from "./view3d/clipclock.js"
import { findKicks } from "./view3d/kick.js"
import type { Viewport } from "./view3d/layout.js"
import { sampleClip } from "./view3d/motion.js"
import { Stage3D, type Play } from "./view3d/Stage3D.js"

/** How long the pass lines stay on the grass after the pass (seconds of the clip). */
const LINE_S = 1.5
/** The flash when the plays split. */
const FLASH_S = 0.6

type State = { readonly kind: "loading"; readonly slow: boolean } | { readonly kind: "failed" | "best" | "unverified" } | { readonly kind: "ready"; readonly clip: WhatIfClip }

/**
 * The what-if split (Plan 7): the pass as it went on the left, the better pass played out on the right (its typical
 * re-simulation), one clock and one camera for both, and the verified numbers underneath. Only this viewer leaves
 * the live match; "Back to live" returns to it.
 */
export const WhatIfSplit = ({ client, sessionId, eventId, match, lang, onClose }: { client: TouchlineClient; sessionId: string; eventId: string; match: MatchInfo; lang: Lang; onClose: () => void }) => {
  const [state, setState] = useState<State>({ kind: "loading", slow: false })
  const [camera, setCamera] = useState<CameraKind>("follow")
  const [playing, setPlaying] = useState(true)
  const [shown, setShown] = useState(0)
  const f = useRef(0)
  useEffect(() => {
    let live = true
    // A cached clip comes at once; say what is happening only when it is being computed.
    const slow = setTimeout(() => live && setState((s) => (s.kind === "loading" ? { kind: "loading", slow: true } : s)), 300)
    client.whatIf(sessionId, eventId).then(
      (clip) => {
        if (!live) return
        if (clip.verdict === "better_option_found" && clip.variant) {
          f.current = loopStart({ fps: clip.fps, passIndex: clip.pass_index, length: clip.real.length })
          setState({ kind: "ready", clip })
        } else setState({ kind: clip.verdict === "played_pass_was_best" ? "best" : "unverified" })
      },
      () => live && setState({ kind: "failed" })
    )
    return () => {
      live = false
      clearTimeout(slow)
    }
  }, [client, sessionId, eventId])
  const clip = state.kind === "ready" ? state.clip : null
  const timing = clip ? { fps: clip.fps, passIndex: clip.pass_index, length: clip.real.length } : null
  // The clock: advanced every animation frame, shown to React a few times a second.
  useEffect(() => {
    if (!timing || !playing) return
    let last = performance.now()
    let id = 0
    const tick = (now: number) => {
      f.current = advance(timing, f.current, Math.min(0.05, (now - last) / 1000), 1)
      last = now
      setShown(Math.round(f.current * 4) / 4)
      id = requestAnimationFrame(tick)
    }
    id = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(id)
  }, [clip, playing])
  const plays = useMemo(() => {
    if (!clip || !clip.variant) return null
    const play = (frames: WhatIfClip["real"]): Play => {
      const kicks = findKicks(frames, clip.fps)
      return { sample: () => sampleClip(frames, f.current, clip.fps), kicks: () => kicks, rate: () => (playing ? (isSlow(timing!, f.current) ? 0.5 : 1) : 0) }
    }
    return { real: play(clip.real), variant: play(clip.variant) }
  }, [clip, playing])
  const who = (id: string | null) => {
    const p = match.players.find((x) => x.id === id)
    return p ? `#${p.jersey} ${p.name}` : ""
  }
  const back = <button type="button" className="rounded bg-emerald-600 px-3 py-1 text-white" onClick={onClose}>{t(lang, "backToLive")}</button>
  if (!clip || !plays || !timing) {
    const message = state.kind === "loading" ? (state.slow ? t(lang, "resimulating") : "") : t(lang, state.kind === "failed" ? "whatIfFailed" : state.kind === "best" ? "bestPlayed" : "notVerified")
    return (
      <section aria-label={t(lang, "whatIf")} className="flex flex-col items-start gap-3 rounded-lg bg-slate-900 p-4">
        <p role="status">{message}</p>
        {back}
      </section>
    )
  }
  const sinceS = (shown - clip.pass_index) / clip.fps
  const lines = sinceS >= -0.1 && sinceS < LINE_S
  const label = (v: Viewport) => (v.world === "real" ? `${t(lang, "whatHappened")} · ${t(lang, "passTo")} ${who(clip.played_to)}` : `${t(lang, "whatIf")} · ${t(lang, "passTo")} ${who(clip.better_to)}`)
  const n = clip.seeds
  return (
    <section aria-label={t(lang, "whatIf")} className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        {back}
        <button type="button" className="rounded bg-slate-800 px-3 py-1" onClick={() => setPlaying(!playing)}>{playing ? t(lang, "pause") : t(lang, "play")}</button>
        <Choice label={t(lang, "camera")} options={CAMERAS} value={camera} onChange={setCamera} name={(c) => t(lang, CAMERA_KEY[c])} />
        <input type="range" aria-label={t(lang, "whatIf")} className="min-w-40 flex-1 accent-amber-400" min={0} max={clip.real.length - 1} step={0.1} value={shown}
          onChange={(e) => { f.current = Number(e.target.value); setShown(f.current) }} />
        <span className="tabular-nums text-sm text-slate-400">{sinceS >= 0 ? "+" : "−"}{Math.abs(sinceS).toFixed(1)} s</span>
      </div>
      <div className="relative aspect-[16/9] w-full">
        <Stage3D match={match} plays={plays} mode="split" layout="single" camera={camera} followed={clip.passer_id} label={label} loading={t(lang, "loading3d")} failed={t(lang, "failed3d")}
          lines={lines ? { real: { from: clip.passer_id, to: clip.played_to, colour: "#f07167" }, variant: { from: clip.passer_id, to: clip.better_to!, colour: "#5fd38d" } } : {}} />
        <div data-testid="flash" className={`pointer-events-none absolute inset-0 rounded-lg ring-4 ring-amber-400 transition-opacity duration-300 ${sinceS >= 0 && sinceS < FLASH_S ? "opacity-100" : "opacity-0"}`} />
      </div>
      <div className="flex flex-wrap items-baseline gap-x-6 gap-y-1 rounded-lg bg-slate-900 px-4 py-2" data-testid="evidence-strip">
        <span className="text-xl font-bold tabular-nums"><span className="text-emerald-400">{clip.shots!.better} / {n}</span> vs <span className="text-rose-400">{clip.shots!.played} / {n}</span></span>
        <span className="text-sm">{t(lang, "shotsWithin")} {clip.horizon_s} s</span>
        <span className="text-sm tabular-nums">{t(lang, "goals")}: {clip.goals!.better} vs {clip.goals!.played}</span>
        <span className="text-sm tabular-nums">{t(lang, "gain")}: {clip.gain!.mean >= 0 ? "+" : "−"}{Math.abs(clip.gain!.mean).toFixed(2)} ± {clip.gain!.se.toFixed(2)}</span>
        <span className="text-xs text-slate-400">{t(lang, "typical").replace("{k}", String(clip.typical_seed))} · {t(lang, "verified")}</span>
      </div>
    </section>
  )
}
```

Create `apps/web/src/view3d/clipclock.ts`:

```ts
/**
 * The what-if split's clock (Plan 7), pure: where in the clip (a fractional frame index) playback is after `dt`
 * seconds, in slow motion for a moment after the pass, looping back to just before the pass at the end.
 */

/** Slow motion right after the pass: this fast, ... */
export const SLOW = 0.5
/** ... for this many seconds of the clip. */
export const SLOW_S = 1
/** A loop starts this many seconds before the pass. */
export const LEAD_S = 1.8

export interface ClipTiming {
  readonly fps: number
  readonly passIndex: number
  /** Frames in the clip. */
  readonly length: number
}

/** Where the clip starts (and loops back to): a little before the pass. */
export const loopStart = (c: ClipTiming): number => Math.max(0, c.passIndex - LEAD_S * c.fps)

/** Whether index `f` is in the slow-motion stretch after the pass. */
export const isSlow = (c: ClipTiming, f: number): boolean => f >= c.passIndex && f < c.passIndex + SLOW_S * c.fps

/** The index after `dt` seconds at `speed`. */
export const advance = (c: ClipTiming, f: number, dt: number, speed: number): number => {
  const next = f + dt * c.fps * speed * (isSlow(c, f) ? SLOW : 1)
  return next >= c.length - 1 ? loopStart(c) : next
}
```

Apply this change to `apps/web/src/Watch.tsx`, `apps/web/src/WhyDrawer.tsx`, `apps/web/src/client.ts`, `apps/web/src/i18n.ts` (from the repository root):

```bash
git apply <<'PATCH'
diff --git a/apps/web/src/Watch.tsx b/apps/web/src/Watch.tsx
index c8d321c..0dbf165 100644
--- a/apps/web/src/Watch.tsx
+++ b/apps/web/src/Watch.tsx
@@ -1,4 +1,4 @@
-import { useState } from "react"
+import { useEffect, useState } from "react"
 import type { MatchInfo, Playback } from "@touchline/rpc"
 import type { Cue } from "@touchline/schema"
 import type { TouchlineClient } from "./client.js"
@@ -8,6 +8,7 @@ import { Overlays, useNow } from "./Overlays.js"
 import { Pitch } from "./Pitch.js"
 import { ProfileBar } from "./ProfileBar.js"
 import { RecapPanel } from "./RecapPanel.js"
+import { WhatIfSplit } from "./WhatIfSplit.js"
 import { WhyDrawer } from "./WhyDrawer.js"
 import { segmentOf, type Profile } from "./profile.js"
 import { TopBar } from "./TopBar.js"
@@ -35,7 +36,7 @@ const saveView = (v: "2d" | "3d") => {
 }
 
 /** One profile's view of a session: its profile bar, scoreboard, pitch and the cues for its segment over the pitch. */
-export const Pane = ({ client, sessionId, match, profile, onProfile, onWhy, label, view = "2d" }: {
+export const Pane = ({ client, sessionId, match, profile, onProfile, onWhy, label, view = "2d", onBetterPass }: {
   client: TouchlineClient
   sessionId: string
   match: MatchInfo
@@ -44,10 +45,16 @@ export const Pane = ({ client, sessionId, match, profile, onProfile, onWhy, labe
   onWhy?: (cue: Cue) => void
   label?: string
   view?: "2d" | "3d"
+  /** Called with the pass when a better-pass cue arrives (the demo's auto-show). */
+  onBetterPass?: (eventId: string) => void
 }) => {
   const lang = profile.lang
   const pane = usePane(client, sessionId, segmentOf(profile))
   const now = useNow()
+  const newest = pane.feed[0]
+  useEffect(() => {
+    if (newest?.display.template === "better_pass" && newest.evidence[0]) onBetterPass?.(newest.evidence[0])
+  }, [newest?.cue_id])
   return (
     <section className="flex flex-col gap-2" aria-label={label}>
       <ProfileBar match={match} profile={profile} onChange={onProfile} {...(label ? { label } : {})} />
@@ -90,6 +97,9 @@ export const Watch = ({ client, sessionId, match, profile, onProfile, onBack }:
 }) => {
   const lang: Lang = profile.lang
   const [why, setWhy] = useState<Cue | null>(null)
+  // The what-if split on a pass: only this viewer leaves the live match (the panes keep receiving it, hidden).
+  const [whatIf, setWhatIf] = useState<string | null>(null)
+  const [autoWhatIf, setAutoWhatIf] = useState(false)
   // Demo mode (spec §5.6): a second profile on the same session, side by side; by default the other mode, in Spanish.
   const [second, setSecond] = useState<Profile | null>(null)
   const toggleSplit = () => setSecond(second ? null : { mode: profile.mode === "casual" ? "analyst" : "casual", lang: profile.lang === "es" ? "hi" : "es", clubs: [] })
@@ -116,6 +126,10 @@ export const Watch = ({ client, sessionId, match, profile, onProfile, onBack }:
         <a className="rounded bg-slate-800 px-3 py-1" target="_blank" rel="noreferrer" href={routeHash({ page: "studio", session: sessionId, segment: segmentOf(profile) })}>{t(lang, "studio")}</a>
         <a className="rounded bg-slate-800 px-3 py-1" target="_blank" rel="noreferrer" href={routeHash({ page: "graphics", session: sessionId, segment: segmentOf(profile), match: match.match_id })}>{t(lang, "graphicsOut")}</a>
         <a className="rounded bg-slate-800 px-3 py-1" target="_blank" rel="noreferrer" href={routeHash({ page: "ops", session: sessionId, lang })}>{t(lang, "opsView")}</a>
+        <label className="text-sm">
+          <input type="checkbox" className="mr-1" checked={autoWhatIf} onChange={(e) => setAutoWhatIf(e.target.checked)} />
+          {t(lang, "autoWhatIf")}
+        </label>
         <label className="text-sm">
           {t(lang, "speed")}{" "}
           <select aria-label={t(lang, "speed")} className="rounded bg-slate-800 px-2 py-1" value={playback.speed} onChange={(e) => control("speed", Number(e.target.value))}>
@@ -123,12 +137,13 @@ export const Watch = ({ client, sessionId, match, profile, onProfile, onBack }:
           </select>
         </label>
       </div>
-      <div className={second ? "grid gap-4 lg:grid-cols-2" : ""}>
-        <Pane client={client} sessionId={sessionId} match={match} profile={profile} onProfile={onProfile} onWhy={setWhy} label={second ? "A" : undefined} view={view} />
+      {whatIf && <WhatIfSplit client={client} sessionId={sessionId} eventId={whatIf} match={match} lang={lang} onClose={() => setWhatIf(null)} />}
+      <div className={`${second ? "grid gap-4 lg:grid-cols-2" : ""} ${whatIf ? "hidden" : ""}`}>
+        <Pane client={client} sessionId={sessionId} match={match} profile={profile} onProfile={onProfile} onWhy={setWhy} label={second ? "A" : undefined} view={view} onBetterPass={(id) => autoWhatIf && !whatIf && setWhatIf(id)} />
         {second && <Pane client={client} sessionId={sessionId} match={match} profile={second} onProfile={setSecond} onWhy={setWhy} label="B" view={view} />}
       </div>
       <RecapPanel client={client} sessionId={sessionId} segment={segmentOf(profile)} lang={lang} />
-      {why && <WhyDrawer client={client} sessionId={sessionId} cue={why} lang={lang} onClose={() => setWhy(null)} />}
+      {why && <WhyDrawer client={client} sessionId={sessionId} cue={why} lang={lang} onClose={() => setWhy(null)} onShowMe={(id) => (setWhy(null), setWhatIf(id))} />}
     </div>
   )
 }
diff --git a/apps/web/src/WhyDrawer.tsx b/apps/web/src/WhyDrawer.tsx
index 9327019..3bf0f9a 100644
--- a/apps/web/src/WhyDrawer.tsx
+++ b/apps/web/src/WhyDrawer.tsx
@@ -6,7 +6,15 @@ import { t, type Lang } from "./i18n.js"
 import { Sparkline } from "./Sparkline.js"
 
 /** Behind a cue (spec §5.6 "Why?" drawer): the cause, each checked fact, the metric's history and the events. */
-export const WhyDrawer = ({ client, sessionId, cue, lang, onClose }: { client: TouchlineClient; sessionId: string; cue: Cue; lang: Lang; onClose: () => void }) => {
+export const WhyDrawer = ({ client, sessionId, cue, lang, onClose, onShowMe }: {
+  client: TouchlineClient
+  sessionId: string
+  cue: Cue
+  lang: Lang
+  onClose: () => void
+  /** Open the what-if split on a pass (offered when re-simulation found, or may find, a better option). */
+  onShowMe?: (eventId: string) => void
+}) => {
   const [ev, setEv] = useState<Evidence | null | "none">(null)
   useEffect(() => {
     let live = true
@@ -38,6 +46,11 @@ export const WhyDrawer = ({ client, sessionId, cue, lang, onClose }: { client: T
               {ev.explanation && <p className="text-slate-300">{ev.explanation}</p>}
             </section>
           )}
+          {ev.what_if && onShowMe && (ev.what_if.verdict === null || ev.what_if.verdict === "better_option_found") && (
+            <button type="button" className="self-start rounded bg-amber-400 px-3 py-1 font-semibold text-slate-950" onClick={() => onShowMe(ev.what_if!.event_id)}>{t(lang, "showMe")}</button>
+          )}
+          {ev.what_if?.verdict === "played_pass_was_best" && <p className="text-slate-300">{t(lang, "bestPlayed")}</p>}
+          {ev.what_if?.verdict === "not_verified" && <p className="text-slate-300">{t(lang, "notVerified")}</p>}
           <section>
             <h3 className="font-semibold text-slate-400">{t(lang, "claims")}</h3>
             <ul className="mt-1 flex flex-col gap-1">
diff --git a/apps/web/src/client.ts b/apps/web/src/client.ts
index 13c6a50..935b5da 100644
--- a/apps/web/src/client.ts
+++ b/apps/web/src/client.ts
@@ -5,7 +5,7 @@
 import { BrowserSocket } from "@effect/platform-browser"
 import { Effect, Exit, Layer, ManagedRuntime, Scope, Stream } from "effect"
 import { RpcClient, RpcSerialization } from "effect/rpc"
-import { TouchlineRpcs, type Evidence, type MatchInfo, type MatchSummary, type OpsReport, type Playback, type QueueStatus, type RecapView, type StudioAction, type StudioTick, type Tick } from "@touchline/rpc"
+import { TouchlineRpcs, type Evidence, type MatchInfo, type MatchSummary, type OpsReport, type Playback, type QueueStatus, type RecapView, type StudioAction, type StudioTick, type Tick, type WhatIfClip } from "@touchline/rpc"
 import type { Segment } from "@touchline/schema"
 
 export interface StartOptions {
@@ -22,6 +22,8 @@ export interface TouchlineClient {
   control(sessionId: string, action: "play" | "pause" | "speed", speed?: number): Promise<Playback>
   /** What is behind a cue the session has shown. */
   evidence(sessionId: string, cueId: string): Promise<Evidence>
+  /** A pass as it went and with its better option played (the what-if split). */
+  whatIf(sessionId: string, eventId: string): Promise<WhatIfClip>
   /** A recap, once the session has reached its whistle (empty before). */
   recap(sessionId: string, kind: "half_time" | "full_time", segment: Segment): Promise<RecapView>
   /** The studio console's stream for a producer segment; returns a function that stops it. */
@@ -58,6 +60,7 @@ export const connect = async (url: string): Promise<TouchlineClient> => {
     watch: (session_id, segment, onTick, onEnd) => follow(client.Watch({ session_id, segment }), onTick, onEnd),
     control: (session_id, action, speed) => call(client.Control({ session_id, action, speed: speed ?? null })),
     evidence: (session_id, cue_id) => call(client.GetEvidence({ session_id, cue_id })),
+    whatIf: (session_id, event_id) => call(client.GetWhatIf({ session_id, event_id })),
     recap: (session_id, kind, segment) => call(client.GetRecap({ session_id, kind, segment })),
     studio: (session_id, segment, onTick, onEnd) => follow(client.StudioWatch({ session_id, segment }), onTick, onEnd),
     act: (session_id, moment_id, action) => call(client.StudioAct({ session_id, moment_id, action })),
diff --git a/apps/web/src/i18n.ts b/apps/web/src/i18n.ts
index 1ebdc81..0395b2d 100644
--- a/apps/web/src/i18n.ts
+++ b/apps/web/src/i18n.ts
@@ -94,6 +94,20 @@ const en = {
   leftPitch: "left the pitch: switched to the broadcast camera",
   loading3d: "Loading players…",
   failed3d: "Could not load the 3D players. Switch to 2D to keep watching.",
+  showMe: "Show me",
+  whatHappened: "What happened",
+  whatIf: "What if",
+  passTo: "pass to",
+  backToLive: "Back to live",
+  resimulating: "Re-simulating 20 futures…",
+  whatIfFailed: "Couldn't re-simulate this moment",
+  bestPlayed: "Re-simulation says the pass played was the best option",
+  notVerified: "Re-simulation could not verify a better option",
+  shotsWithin: "re-runs ended in a shot within",
+  goals: "Goals",
+  gain: "Expected goals and threat gained",
+  typical: "Right: re-run #{k}, the one closest to the average outcome",
+  autoWhatIf: "Auto-show better passes",
   keysHint: "Click a player to follow them · keys 1–4 switch camera · [ ] step through players"
 } as const
 
@@ -194,6 +208,20 @@ export const STRINGS: Record<Lang, Record<Key, string>> = {
     leftPitch: "salió del campo: cámara de televisión",
     loading3d: "Cargando jugadores…",
     failed3d: "No se pudieron cargar los jugadores 3D. Cambia a 2D para seguir viendo.",
+    showMe: "Muéstramelo",
+    whatHappened: "Lo que pasó",
+    whatIf: "Y si",
+    passTo: "pase a",
+    backToLive: "Volver al directo",
+    resimulating: "Resimulando 20 futuros…",
+    whatIfFailed: "No se pudo resimular este momento",
+    bestPlayed: "La resimulación dice que el pase jugado era la mejor opción",
+    notVerified: "La resimulación no pudo verificar una opción mejor",
+    shotsWithin: "repeticiones acabaron en tiro en",
+    goals: "Goles",
+    gain: "Goles esperados y amenaza ganados",
+    typical: "Derecha: repetición #{k}, la más cercana al resultado medio",
+    autoWhatIf: "Mostrar pases mejores solos",
     keysHint: "Haz clic en un jugador para seguirlo · teclas 1–4 cambian la cámara · [ ] recorren los jugadores"
   },
   hi: {
@@ -289,6 +317,20 @@ export const STRINGS: Record<Lang, Record<Key, string>> = {
     leftPitch: "मैदान से बाहर: प्रसारण कैमरा चालू",
     loading3d: "खिलाड़ी लोड हो रहे हैं…",
     failed3d: "3D खिलाड़ी लोड नहीं हुए। देखते रहने के लिए 2D चुनें।",
+    showMe: "दिखाइए",
+    whatHappened: "क्या हुआ",
+    whatIf: "अगर",
+    passTo: "पास",
+    backToLive: "लाइव पर लौटें",
+    resimulating: "20 भविष्य फिर से चलाए जा रहे हैं…",
+    whatIfFailed: "यह पल फिर से नहीं चल सका",
+    bestPlayed: "दोबारा-खेल के अनुसार खेला गया पास ही सबसे अच्छा था",
+    notVerified: "दोबारा-खेल बेहतर विकल्प की पुष्टि नहीं कर सका",
+    shotsWithin: "दोबारा-खेल शॉट पर ख़त्म हुए, इतने सेकंड में:",
+    goals: "गोल",
+    gain: "अपेक्षित गोल और ख़तरे में बढ़त",
+    typical: "दाएँ: दोबारा-खेल #{k}, जो औसत नतीजे के सबसे क़रीब है",
+    autoWhatIf: "बेहतर पास अपने-आप दिखाएँ",
     keysHint: "किसी खिलाड़ी पर क्लिक करें · 1–4 कैमरा बदलें · [ ] खिलाड़ी बदलें"
   }
 }
PATCH
```

- [ ] **Step 4: Run the tests**

Run: `pnpm --filter @touchline/web test whatif clipclock`
Expected: `7 passed`

Run: `pnpm --filter @touchline/web test`
Expected: `88 passed`

Run: `pnpm --filter @touchline/web typecheck`
Expected: no errors

- [ ] **Step 5: Commit**

```bash
git add apps/web
git commit -m "feat(web): the what-if split — Show me in a better pass's Why? drawer, the play as it went beside the better pass played out on one clock and camera, slow motion and pass lines where they part, the verified numbers beneath, Back to live, and auto-show for the demo

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 11: Rulings, verification and the browser check (docs)

Record in the spec how the prototype changed the design (its §10), point the roadmap row at this plan, run every suite the plan touched, and check the 3D view and the split in a real browser.

**Files:**
- Modify: `docs/superpowers/specs/2026-10-09-3d-viewer-whatif-design.md` (§10 rulings), `docs/superpowers/plans/2026-10-03-touchline-roadmap.md` (Plan 7 row)

**Interfaces:**
- None.

- [ ] **Step 1: Record the prototype's rulings in the spec, and the plan in the roadmap**

Apply this change to `docs/superpowers/specs/2026-10-09-3d-viewer-whatif-design.md`, `docs/superpowers/plans/2026-10-03-touchline-roadmap.md` (from the repository root):

```bash
git apply <<'PATCH'
diff --git a/docs/superpowers/plans/2026-10-03-touchline-roadmap.md b/docs/superpowers/plans/2026-10-03-touchline-roadmap.md
index 232dc1d..a2e65d3 100644
--- a/docs/superpowers/plans/2026-10-03-touchline-roadmap.md
+++ b/docs/superpowers/plans/2026-10-03-touchline-roadmap.md
@@ -15,7 +15,7 @@
 | 5a | **API, cue bus and fan app** — `2026-10-07-plan-5a-api-fan-app.md` | Oct 7–12 | Effect RPC API over WebSocket (`packages/rpc`, `apps/api`): match library of run folders, sessions on the cue bus (one match time per session, every viewer its own segment with neutral and English fallbacks), hot-path scoreboard from the stats engine, live toggle running the agents as the match plays, evidence and recaps, `pnpm library` (six scenarios × twelve segments) and `pnpm dev`; fan app (`apps/web`, React, Vite, Tailwind): 2D pitch, overlays by slot, profile switcher and builder, "Why?" drawer with sparklines, recaps, split-screen demo mode, EN/ES/HI; test runs clean up their temp folders | Merged (Oct 7) |
 | 5b | **Studio console, graphics output and ops view** — `2026-10-07-plan-5b-studio-ops.md` | Oct 7–12 | Studio queue on the cue bus (every moment queued; approve, hold, send to graphics; shared by every console), presenter talking points from the analyst text and the checked facts (no model), raw cue feed; a transparent broadcast graphics page showing only what the producer sent; ops view (fact-check pass/retry/drop, fallbacks, time per agent, requests, latency p50/p95 against the 250 ms and 4 s budgets, as of the session's frame); goals reach the scoreboard at once | Merged (Oct 7) |
 | 6 | Azure, demo and submission | Oct 19–27 | azd + Bicep, Foundry hosted agents, Container Apps, Cosmos DB, tracing, evaluations in Foundry, demo replays, video, submission | |
-| 7 | 3D viewer, player cameras and what-if split — spec `2026-10-09-3d-viewer-whatif-design.md` | Oct 9–18 | Three.js + React Three Fiber view of the match (CC0 animated players, own kick overlay, stadium lighting); follow, first-person, broadcast and tactical cameras on one canvas (main + map, 2×2 grid); `GetWhatIf` and `playAheadFrames`; real vs re-simulated better pass side by side with verified evidence | |
+| 7 | 3D viewer, player cameras and what-if split — spec `2026-10-09-3d-viewer-whatif-design.md` | Oct 9–18 | Three.js + React Three Fiber view of the match (CC0 animated players, own kick overlay, stadium lighting); follow, first-person, broadcast and tactical cameras on one canvas (main + map, 2×2 grid); `GetWhatIf` and `playAheadFrames`; better passes found by scanning each library match, as verified cues; real vs re-simulated better pass side by side with verified evidence — plan `2026-10-09-plan-7-3d-viewer-whatif.md` | |
 
 Notes:
 - Wyscout's figshare host is blocked on the current network (corporate proxy); Plan 2 starts with IDSSE (Hugging Face, reachable) and adds Wyscout when downloaded from another network.
diff --git a/docs/superpowers/specs/2026-10-09-3d-viewer-whatif-design.md b/docs/superpowers/specs/2026-10-09-3d-viewer-whatif-design.md
index 23b310b..001f143 100644
--- a/docs/superpowers/specs/2026-10-09-3d-viewer-whatif-design.md
+++ b/docs/superpowers/specs/2026-10-09-3d-viewer-whatif-design.md
@@ -1,6 +1,6 @@
 # 3D viewer, player cameras and what-if split — design
 
-Agreed 2026-10-09 in brainstorming (sections 1–5 approved one by one). The engine was picked after a bake-off between Three.js and Babylon.js. Extends §5.6 of `2026-10-03-touchline-design.md`. Plan 7, branch `plan-7-viewer`.
+Agreed 2026-10-09 in brainstorming (sections 1–5 approved one by one). The engine was picked after a bake-off between Three.js and Babylon.js; the prototype's rulings are in §10. Extends §5.6 of `2026-10-03-touchline-design.md`. Plan 7, branch `plan-7-viewer`.
 
 ## 1. Goal
 
@@ -170,7 +170,22 @@ Vitest + jsdom, as in the rest of `apps/web`.
 
 CUDA or server GPUs; a free "any moment" what-if sandbox; stadium crowds; multi-match views; facial or kit detail beyond colours and numbers.
 
-## 10. Follow-ups to other docs
+## 10. Rulings from the prototype (2026-10-09)
+
+Building the prototype changed these points. The implementation plan follows the rulings, not the sections above.
+
+1. **Where the split comes from (user decision).** Agents' `better_option` claims were checked by re-simulation in six costly-error matches: 0 of 5 came out `better_option_found` (3 "played pass was best", 2 not verifiable). Scanning every pass instead finds them: 8 of 498 attacking passes in one match. So `pnpm library` scans each match's passes (at least 3 options on record, played more than 5 m into the opponents' half) across worker threads, and every verified better pass becomes its own verified **better-pass cue** in each mode and language, with "Show me" in its Why? drawer. Agent claims keep their clip and get the honest verdict. Live sessions compute on request only (no live scan).
+2. **No new frame fields.** Tracking stores each player's speed as a single number and no intent, so `Spot` is unchanged. The client works out velocity, facing and gait from consecutive positions.
+3. **Preferred foot** is added to `MatchInfo.players` (`foot`), so the kick uses the right leg.
+4. **No 3D pitch markers.** Nothing produces `pitch_marker` cues today (no agent, no stats path), so there is nothing to pin.
+5. **No drei.** React Three Fiber hosts the canvas, its size and pixel ratio, and the frame loop. The scenes are plain three.js, two per canvas in the split, each viewport with its own effects chain (drei `<View>` cannot post-process per view).
+6. **Following** starts with the player nearest the ball (profiles have no player focus setting).
+7. **Clips stop at the session's frame.** Both plays are cut there, so nothing after it is shown. Better-pass cues appear only once their 8 seconds have played.
+8. **Demo auto-show** is a checkbox on the Watch page that opens the split on each better-pass cue (no ranking of the "clearest").
+9. **Kicks** count once per touch, because a kick seen across skipped frames would otherwise count twice. r186 has no soft shadow map, so `PCFShadowMap` is used.
+10. **Assets** are committed in `apps/web/public/3d/`. How the body was trimmed is recorded in `ATTRIBUTION.md` instead of a script, which would need the 14 MB source pack and a new dev dependency.
+
+## 11. Follow-ups to other docs
 
 - `2026-10-03-touchline-design.md` §5.6: a pointer to this design.
 - Roadmap: a Plan 7 row.
PATCH
```

- [ ] **Step 2: Run every suite this plan touched**

Run: `pnpm turbo run test --filter=@touchline/sim-core --filter=@touchline/advisor --filter=@touchline/rpc --filter=@touchline/api --filter=@touchline/web -- --no-file-parallelism && pnpm turbo run typecheck --filter=@touchline/sim-core --filter=@touchline/advisor --filter=@touchline/rpc --filter=@touchline/api --filter=@touchline/web` (typecheck separately: `tsc` rejects vitest's flag)
Expected: all tasks successful (the API's `build-library` test needs `uv`; the full repository suite runs with `pnpm test -- --no-file-parallelism`, see the toolchain notes)

- [ ] **Step 3: Build a demo library**

Start the stub agent service in another terminal: `TOUCHLINE_LLM=stub uv run --project services/agents touchline-agents --port 8100`

Run: `pnpm library --scenarios costly_error,even_contest --seed 2`
Expected: each match logs `scanned … attacking passes` and `… what-if clips (N with a better option)` with N > 0. The prototype found 8 for `lib-costly_error-2` and 6 for `lib-even_contest-2`.

- [ ] **Step 4: Check it in the browser**

Run `pnpm api` and `pnpm --filter @touchline/web dev`, open http://localhost:5173 in Chrome, **with the window in front**. A background tab runs no animation frames or resize observers, so the canvas never mounts and stays on "Loading players…". Check each item:

1. **Turn on 3D** on a match. Expected:
   - Players move in kit colours with their numbers.
   - Bodies walk, jog and sprint with the ball, and kick it on passes and shots.
   - The follow camera tracks the player nearest the ball, with the map in the corner.
2. **Switch the camera to First-person, Broadcast and Tactical** (buttons and keys 1–4). Then pick a player by clicking one, from the select, and with `[` `]`.
3. **Switch the layout to Grid 2×2.** All four cameras stay in sync. Measure the frame rate in the console:

   ```js
   await new Promise(r => { let n = 0, t = performance.now(); const f = () => (n++, performance.now() - t < 2000 ? requestAnimationFrame(f) : r(n / 2)); requestAnimationFrame(f) })
   ```

   Expected: at least 60 on an M4 Pro at pixel ratio 2. The prototype measured 103 in the grid.
4. **Open a better pass.** Turn on "Auto-show better passes" with the match starting at minute 16 of `lib-costly_error-2` (better pass at 16:30). Or open a better-pass cue's Why? drawer and press Show me. Expected:
   - Left and right share the clock until the pass.
   - At the pass: slow motion, the flash and the two pass lines.
   - The evidence strip shows the numbers.
   - The camera choice applies to both halves.
   - Back to live returns to the live view.
5. **Narrow the window below 768 px.** Expected: one view only, and the split halves stack.
6. **Turn on Split screen (demo mode)** in 3D. Expected: two panes, each with its own canvas.

- [ ] **Step 5: Commit**

```bash
git add docs/superpowers/plans/2026-10-03-touchline-roadmap.md docs/superpowers/specs/2026-10-09-3d-viewer-whatif-design.md
git commit -m "docs: Plan 7 spec rulings from the prototype (better passes from a library scan, no new frame fields, preferred foot, no pitch markers, no drei) and the roadmap row

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

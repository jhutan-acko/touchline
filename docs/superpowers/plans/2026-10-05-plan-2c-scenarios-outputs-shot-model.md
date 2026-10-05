# Touchline Plan 2c — Scenarios, Outputs and Shot Model Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the simulator a test bench for the agents: scenario scripts that inject tactical causes reliably (nudge, retry, force), ground truth in the run manifest, a SPADL view and optional realism noise; fix the shot model (separate block, aim and save steps) and recalibrate; keep real players' names out of the league; close the Plan 2b review's deferred findings.

**Architecture:** Scenario effects live in the pure engine (`script.ts`: per-team modifiers inside script windows; forced outcomes marked `scripted`); a pure runner (`runner.ts`) plays each window from an immutable checkpoint, retries with fresh sub-seeds and forces as a last resort. The `sim` package turns a run into files: CDF (optionally noisy), the exact domain stream, `spadl.csv`, and a manifest with truths. Calibration gains two statistics (blocked share, save rate) and a save-strength knob. A Python tool builds a hashed real-player blocklist from Wikidata.

**Tech Stack:** as Plans 2a-2b (TypeScript 5.9.3, Effect 4.0.0, vitest 5.0.3, pnpm 11.27, Turborepo 2.11.6; Python via uv with kloppy 3.19.0, pytest 9.1.1). No new dependencies.

**Spec:** `docs/superpowers/specs/2026-10-03-touchline-design.md` §5.1.1 (scriptable: ≥ 90 % without forcing), §5.1.6 (blocklist), §5.1.7 (scenario scripts), §5.1.9 (SPADL view, run manifest, realism noise), §5.1.10 (SPADL mapping), §5.1.12 (ground truth in the manifest), §5.3.1 (tactical truths). Roadmap: `docs/superpowers/plans/2026-10-03-touchline-roadmap.md`. Builds on Plan 2b (merged to `main`).

**How code is given:** new files in full; changes to existing files as exact patches applied from the repository root with the `git apply <<'PATCH' … PATCH` block shown, each produced from the verified prototype task by task.

**Verification status:** every task was built and run in full before this plan was written, one commit per task, with the whole suite green at every commit (the realism gate included); the code blocks reproduce the prototype file for file (checked by replaying the plan on a fresh clone of `main`). Results: the six built-in scenarios reach their targets without forcing in 19-20 of 20 seeds each; final calibration loss 5.19 on the tuning seeds; 16 held-out matches give 15 of 19 statistics within 1 SD and 4 within 2 SD, none off; the blocklist holds 22,671 name hashes and no generated name is on it.

## Global Constraints

- All earlier constraints hold: CDF v0.3.2 strict validity, determinism per `(seed, teams, params version, fps, script)`, no Effect inside `sim-core`, pinned versions, no StatsBomb, raw real data never in git, one metric definition shared by Python and TypeScript.
- **Scripts never leak into CDF.** `scripted: true` is a domain attribute; CDF events never carry it. Without a script the engine's output is byte-for-byte unchanged.
- **Ground truth stays exact.** Realism noise touches only the exported CDF events; the domain stream, tracking, SPADL view and manifest are exact.
- **Scenario targets are minimums** (at least N goals in a window); a forced outcome is the last resort, recorded in the manifest.
- **No real names in the repository:** the blocklist stores hashes only (Wikidata is CC0; the names themselves are never committed).
- **The realism gate stays green at every commit;** intended changes refresh its baseline in the same commit, and Task 10 recalibrates.

## Review Focus

1. **A retried or forced window leaking into the accepted match** — a discarded attempt's events, a forced outcome left pending after its window, goal progress not reset. *Task 6, `runner.test.ts` (every frame once, in order; forced events only from the last play) and the runner clearing `forced` after each window.*
2. **A script changing a plain match** — any extra random draw when no script is active shifts every later event. *Task 5, `scenario.test.ts` ("change nothing before the first window opens") and the byte-for-byte check in Tasks 5-6.*
3. **Scenario targets that depend on possession or calibration** — pressing counts, goal rates. *Task 6 uses pressures per 100 opponent passes and rate-scaled goal nudges; Task 10 keeps the scenario tests on that measure.*
4. **Noise breaking CDF validity** — jittered events outside the period, a receiver time before its pass. *Task 9 clamps to the period and moves the end frame with the event; the noisy match is validated.*
5. **Python and TypeScript name hashing drifting apart** — a real name slipping through. *Task 11, `test_blocklist.py` checks accented names against the TypeScript hashes, and the league test checks the committed league against the committed list.*

---

### Task 1: Engine minors deferred from Plan 2b

Five engine findings from the Plan 2b review. Scoring in first-half added time used the 45-60 bin of the minute profile; it now stays in the first half's last bin. The one-minute hard stop could drop a ball in the air; it now waits for the flight (a flight lasts at most `MAX_FLIGHT_S`). A blocked cross jumped from wherever the cross's own flight had taken it to the blocker; it now travels straight to the blocker. A deflection behind kept only its end point wide of the posts, so from close range its path could cross between them; the end point is now chosen on the line first. Every team always made all five substitutions; windows are now used with probabilities 1, 0.8 and 0.5 (about four changes, as in the Bundesliga). Also `reception.lost_possession` is now `true` on an uncontrolled touch (it was `null`).

**Files:**
- Modify: `packages/sim-core/src/gamestate.ts`, `packages/sim-core/src/step.ts`, `packages/sim-core/src/deflect.ts`, `packages/sim-core/src/params.ts`
- Test: `packages/sim-core/test/minors.test.ts`

**Interfaces:**
- Consumes: Plan 2b's engine.
- Produces: `scoringFactor(minute, ownPlayers, opponentPlayers, p, period?)`; `params.substitutions.windowChance: [number, number, number]`; `behindPoint` returns a point whose straight path crosses the goal line at least `goalHalfWidth + 1.5` m from the centre; blocked crosses have `Flight.path` to the blocker.

- [ ] **Step 1: Write the failing tests**

Create `packages/sim-core/test/minors.test.ts`:

```ts
import { readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "vitest"
import { behindPoint, DEFAULT_PARAMS as P, initMatch, isFinished, paramsFromJson, PITCH, Rng, scoringFactor, seedRng, step, type DomainEvent, type Frame, type MatchConfig } from "../src/index.js"
import { makeConfig } from "../src/testing.js"

const root = join(dirname(fileURLToPath(import.meta.url)), "../../..")
const calibrated = paramsFromJson(JSON.parse(readFileSync(join(root, "data/params/touchline-params.json"), "utf8")))

const play = (cfg: MatchConfig) => {
  let s = initMatch(cfg)
  const frames: Frame[] = [], events: DomainEvent[] = []
  while (!isFinished(s)) { const r = step(s); s = r.state; if (r.frame) frames.push(r.frame); events.push(...r.events) }
  return { frames, events }
}

describe("scoring in first-half added time", () => {
  it("uses the 30-45 bin, not the 45-60 bin", () => {
    expect(scoringFactor(46.5, 11, 11, P, "first_half")).toBe(scoringFactor(40, 11, 11, P, "first_half"))
    expect(scoringFactor(46.5, 11, 11, P, "second_half")).toBe(scoringFactor(50, 11, 11, P, "second_half"))
  })
})

describe("the hard stop at the end of a half", () => {
  it("still lets a ball in the air land before the whistle", () => {
    let s = initMatch(makeConfig(4))
    while (!(s.possession.kind === "in_flight" && s.possession.flight.resolveTick > s.tick + 5)) s = step(s).state
    const flight = s.possession.kind === "in_flight" ? s.possession.flight : null
    // The half was due a minute ago, so the hard stop applies now.
    s = { ...s, periodTicks: s.periodTick - Math.round(60 / s.config.dt) }
    const events: DomainEvent[] = []
    while (!events.some((e) => e.type === "period_end")) {
      const r = step(s)
      s = r.state
      events.push(...r.events)
    }
    const main = events.find((e) => e.frame_id === flight!.releaseTick && ["pass", "shot", "clearance"].includes(e.type))
    expect(main, "the flight's event").toBeDefined()
  })
})

describe("blocked crosses and deflections", () => {
  const runs = [1, 2, 3].map((seed) => play(makeConfig(seed, { params: calibrated })))
  it("the ball travels to the blocker: no jump in the frame before the block", () => {
    let n = 0
    for (const r of runs) {
      const byTick = new Map(r.frames.map((f) => [f.tick, f]))
      for (const e of r.events.filter((x) => x.type === "block" && x.attrs.blocked === "cross")) {
        const before = byTick.get(e.frame_id - 1)
        if (!before) continue
        n++
        expect(Math.hypot(before.ball.x - e.x!, before.ball.y - e.y!), e.id).toBeLessThan(2.5)
      }
    }
    expect(n).toBeGreaterThanOrEqual(2)
  })
  it("a deflection behind never crosses the goal line between the posts", () => {
    const r = new Rng(seedRng(9))
    for (let x = 36; x <= 52; x += 1) {
      for (let y = -20; y <= 20; y += 1) {
        const to = behindPoint("away", { x, y }, r)
        const f = (PITCH.halfL - x) / (to.x - x)
        const yAtLine = y + f * (to.y - y)
        expect(Math.abs(yAtLine), `from (${x}, ${y})`).toBeGreaterThan(PITCH.goalHalfWidth + 1)
      }
    }
  })
})

describe("substitutions and receptions", () => {
  const runs = [1, 2, 3, 4, 5, 6].map((seed) => ({ cfg: makeConfig(seed), ...play(makeConfig(seed)) }))
  it("teams make about four substitutions on average, not always five", () => {
    const counts = runs.flatMap((r) => [r.cfg.home.id, r.cfg.away.id].map((t) => r.events.filter((e) => e.type === "substitution" && e.team_id === t).length))
    const mean = counts.reduce((a, b) => a + b, 0) / counts.length
    expect(mean).toBeGreaterThan(3.3)
    expect(mean).toBeLessThan(4.8)
    expect(counts.some((c) => c < 5)).toBe(true)
  })
  it("a reception records whether the ball was lost on the first touch", () => {
    for (const r of runs) for (const e of r.events.filter((x) => x.type === "reception")) expect(e.attrs.lost_possession, e.id).toBe(e.attrs.first_touch !== "controlled")
  })
})
```

- [ ] **Step 2: Run them to make sure they fail**

Run: `pnpm --filter @touchline/sim-core test minors`
Expected: 6 failed: `expected 0.95 to be 1.05` (bin); `the flight's event: expected undefined to be defined`; `expected 3.25… to be less than 2.5` (jump before a block); `from (42, 0): expected 4.27… to be greater than 4.66` (deflection path); `expected 5 to be less than 4.8` (substitutions); `expected null to be true` (lost possession)

- [ ] **Step 3: Implement**

Apply this change to `packages/sim-core/src/gamestate.ts`, `packages/sim-core/src/step.ts`, `packages/sim-core/src/deflect.ts`, `packages/sim-core/src/params.ts` (from the repository root):

```bash
git apply <<'PATCH'
diff --git a/packages/sim-core/src/deflect.ts b/packages/sim-core/src/deflect.ts
index 4f03ea1..a8dfadc 100644
--- a/packages/sim-core/src/deflect.ts
+++ b/packages/sim-core/src/deflect.ts
@@ -9,14 +9,19 @@ export const inOwnBox = (side: Side, at: Vec2): boolean =>
   attackX(side, at.x) < -(PITCH.halfL - PITCH.boxDepth) && Math.abs(at.y) < PITCH.boxHalfWidth
 
 /**
- * Where a deflection behind `defSide`'s own goal line ends up: 2.5 m beyond the line and wide of the posts,
- * roughly straight back from `at` (it gives a corner). The ball travels there directly (see DEFLECT_SPEED).
+ * Where a deflection behind `defSide`'s own goal line ends up: 2.5 m beyond the line, on a straight path from `at`
+ * that crosses the line wide of the posts (it gives a corner), roughly straight back. The ball travels there directly (see DEFLECT_SPEED).
  */
 export const behindPoint = (defSide: Side, at: Vec2, rng: Rng): Vec3 => {
+  const back = -dirOf(defSide)
   const sy = at.y === 0 ? (rng.chance(0.5) ? 1 : -1) : Math.sign(at.y)
   const wide = PITCH.goalHalfWidth + 1.5
-  const ty = Math.abs(at.y) > wide + 3 ? at.y + rng.range(-4, 4) : sy * (wide + rng.range(0, 8))
-  return { x: -dirOf(defSide) * (PITCH.halfL + 2.5), y: Math.abs(ty) < wide ? sy * wide : Math.max(-PITCH.halfW + 1, Math.min(PITCH.halfW - 1, ty)), z: rng.range(0.3, 2.5) }
+  // Where the ball crosses the goal line: straight back from a wide position, else 1.5-9.5 m outside the post.
+  const cross = Math.abs(at.y) > wide + 3 ? at.y + rng.range(-4, 4) : sy * (wide + rng.range(0, 8))
+  const cy = Math.abs(cross) < wide ? sy * wide : Math.max(-PITCH.halfW + 1, Math.min(PITCH.halfW - 1, cross))
+  const line = { x: back * PITCH.halfL, y: cy }
+  const d = Math.hypot(line.x - at.x, line.y - at.y) || 1
+  return { x: line.x + ((line.x - at.x) / d) * 2.5, y: line.y + ((line.y - at.y) / d) * 2.5, z: rng.range(0.3, 2.5) }
 }
 
 /** Speed of a deflection (m/s). */
diff --git a/packages/sim-core/src/gamestate.ts b/packages/sim-core/src/gamestate.ts
index c49434c..f47d5a0 100644
--- a/packages/sim-core/src/gamestate.ts
+++ b/packages/sim-core/src/gamestate.ts
@@ -1,13 +1,16 @@
 import type { Params } from "./params.js"
+import type { Period } from "./types.js"
 
 /**
  * How likely a shot is to score relative to its xG, from the game state (spec §5.1.4): the minute profile
  * (15-minute bins, the last one including added time) times the red-card factor when the teams are uneven.
  * Penalties are not scaled.
  */
-export const scoringFactor = (minute: number, ownPlayers: number, opponentPlayers: number, p: Params): number => {
+export const scoringFactor = (minute: number, ownPlayers: number, opponentPlayers: number, p: Params, period?: Period): number => {
   const g = p.gameState
-  const bin = Math.max(0, Math.min(g.minuteProfile.length - 1, Math.floor(minute / 15)))
+  const raw = Math.max(0, Math.min(g.minuteProfile.length - 1, Math.floor(minute / 15)))
+  // First-half added time (minute 45+) stays in the first half's last bin.
+  const bin = period === "first_half" ? Math.min(raw, Math.floor(g.minuteProfile.length / 2) - 1) : raw
   const red = ownPlayers < opponentPlayers ? g.redCardOwn : ownPlayers > opponentPlayers ? g.redCardOpponent : 1
   return g.minuteProfile[bin]! * red
 }
diff --git a/packages/sim-core/src/params.ts b/packages/sim-core/src/params.ts
index 444cc27..034dae7 100644
--- a/packages/sim-core/src/params.ts
+++ b/packages/sim-core/src/params.ts
@@ -171,7 +171,14 @@ export interface Params {
    * red-card factors for the team down to fewer players and for its opponent.
    */
   readonly gameState: { readonly minuteProfile: readonly [number, number, number, number, number, number]; readonly redCardOwn: number; readonly redCardOpponent: number }
-  readonly substitutions: { readonly windowMinutes: readonly [number, number, number]; readonly windowSdMin: number; readonly perWindow: readonly [number, number, number]; readonly halfTimeChance: number }
+  readonly substitutions: {
+    readonly windowMinutes: readonly [number, number, number]
+    readonly windowSdMin: number
+    readonly perWindow: readonly [number, number, number]
+    /** Chance that each planned window is used. */
+    readonly windowChance: readonly [number, number, number]
+    readonly halfTimeChance: number
+  }
   readonly classifier: ClassifierThresholds
 }
 
@@ -269,7 +276,8 @@ export const DEFAULT_PARAMS: Params = {
   groundDuel: { bSkill: 3, bReach: 2, contestM: 0.6 },
   // Hand-set prior with more goals late (refit from Wyscout goal minutes when that data is available); red-card factors from the spec.
   gameState: { minuteProfile: [0.85, 0.95, 1.05, 0.95, 1.05, 1.15], redCardOwn: 0.67, redCardOpponent: 1.2 },
-  substitutions: { windowMinutes: [62, 72, 81], windowSdMin: 5, perWindow: [2, 2, 1], halfTimeChance: 0.2 },
+  // About four changes per team on average (Bundesliga teams make roughly 4-4.5 of their 5).
+  substitutions: { windowMinutes: [62, 72, 81], windowSdMin: 5, perWindow: [2, 2, 1], windowChance: [1, 0.8, 0.5], halfTimeChance: 0.2 },
   classifier: {
     longPassM: 32,
     switchLateralM: 25,
diff --git a/packages/sim-core/src/step.ts b/packages/sim-core/src/step.ts
index 6f274a9..3b1da4e 100644
--- a/packages/sim-core/src/step.ts
+++ b/packages/sim-core/src/step.ts
@@ -23,7 +23,7 @@ import {
 } from "./geometry.js"
 import { accelFor, arrive, arriveBy, drainEnergy, interceptPoint, separation, vmaxFor } from "./kinematics.js"
 import type { Action } from "./params.js"
-import { goalLineCrossing, keeperLetsRun, resolveFlight } from "./resolve.js"
+import { goalLineCrossing, keeperLetsRun, MAX_FLIGHT_S, resolveFlight } from "./resolve.js"
 import { hazard, Rng, substream } from "./rng.js"
 import { anchorFor, kickoffAnchor } from "./shape.js"
 import { parryBall, planShot } from "./shot.js"
@@ -95,7 +95,11 @@ const planSubs = (cfg: MatchConfig, side: Side, rng: Rng): SubsState => {
   const bench = teamOf(cfg, side).bench ?? []
   const plan = bench.length === 0
     ? []
-    : s.windowMinutes.map((m, i) => ({ minute: Math.max(46, m + rng.normal() * s.windowSdMin), players: s.perWindow[i]! })).sort((a, b) => a.minute - b.minute)
+    : s.windowMinutes
+        .map((m, i) => ({ minute: Math.max(46, m + rng.normal() * s.windowSdMin), players: s.perWindow[i]!, used: rng.chance(s.windowChance[i]!) }))
+        .filter((x) => x.used)
+        .map(({ minute, players }) => ({ minute, players }))
+        .sort((a, b) => a.minute - b.minute)
   return { plan, made: 0, windows: 0, used: [] }
 }
 
@@ -603,7 +607,8 @@ const releaseKick = (w: Work, owner: PlayerState, d: Decision, restart: RestartK
       outcome,
       pending: finalMain,
       extra,
-      path: null,
+      // A blocked cross travels straight to the blocker; every other kick follows the ball physics.
+      path: blocked ? { from: start.pos, to: { x: blocker!.pos.x, y: blocker!.pos.y, z: 0.5 } } : null,
       restartAfter,
       looseBall: looseAfter,
       deflectTo
@@ -620,7 +625,7 @@ const releaseShot = (w: Work, owner: PlayerState, d: Decision, restart: RestartK
   const isPenalty = restart === "penalty"
   const xg = isPenalty ? 0.76 : (d.xg ?? 0.02)
   // The recorded xG is the model's; the chance of scoring also follows the game state (minute, red cards).
-  const scoring = isPenalty ? 1 : scoringFactor(w.minute(), w.active(side).length, opps.length, w.p)
+  const scoring = isPenalty ? 1 : scoringFactor(w.minute(), w.active(side).length, opps.length, w.p, w.period)
   const weakFoot = !isPenalty && w.rng.execution.chance(0.2)
   const plan = planShot(owner, side, opps, xg, d.pressure, isPenalty, w.p, w.dt, w.rng.execution, weakFoot, scoring)
   const tickAt = w.tick + plan.ticks
@@ -774,7 +779,7 @@ const resolveFlightNow = (w: Work, f: Flight): void => {
     const pressure = pressureFrom(opp ? dist(opp.pos, r.pos) : 50)
     const speed = Math.hypot(w.ball.vel.x, w.ball.vel.y, w.ball.vel.z)
     touch = drawFirstTouch(firstTouchError({ speed, height: w.ball.pos.z, pressure, skill: (r.attrs.dribbling + r.attrs.composure) / 2 }, w.p), w.rng.execution, w.p)
-    w.emit({ ...e, attrs: { ...e.attrs, first_touch: touch, under_pressure: pressure > 0.3, lost_possession: touch === "controlled" ? false : null } })
+    w.emit({ ...e, attrs: { ...e.attrs, first_touch: touch, under_pressure: pressure > 0.3, lost_possession: touch !== "controlled" } })
   }
   const goal = f.extra.find((e) => e.type === "goal")
   if (goal) w.score[goal.team_id === w.teamId("home") ? "home" : "away"] += 1
@@ -1054,7 +1059,9 @@ export const step = (s: MatchState): StepResult => {
   // The half ends when it is due, except while a set piece is being set up or the ball is in the air
   // (a flight lasts at most MAX_FLIGHT_S); the hard stop one minute later always applies.
   if (w.periodTick >= w.periodTicks && w.phase.kind !== "restart" && w.possession.kind !== "in_flight") return endPeriod(w)
-  if (w.periodTick >= w.periodTicks + Math.round(60 / w.dt)) return endPeriod(w)
+  // The hard stop a minute later still lets a ball in the air land (a flight lasts at most MAX_FLIGHT_S).
+  const hardStop = w.periodTicks + Math.round(60 / w.dt)
+  if (w.periodTick >= hardStop && (w.possession.kind !== "in_flight" || w.periodTick >= hardStop + Math.round(MAX_FLIGHT_S / w.dt))) return endPeriod(w)
   if (w.phase.kind === "restart") handleRestart(w)
   if (w.phase.kind === "open_play") ownedTick(w)
   moveAll(w)
PATCH
```

- [ ] **Step 4: Run the tests**

Run: `pnpm --filter @touchline/sim-core test minors`
Expected: 6 passed

Run: `pnpm turbo run typecheck test --force`
Expected: `Tasks: 10 successful`; the realism gate passes with a small drift (about `"maxDrift":0.67`)

- [ ] **Step 5: Commit**

```bash
git add packages/sim-core
git commit -m "fix(sim-core): added-time scoring bin, hard stop waits for flights, blocked-cross path, deflections wide of the posts, about four substitutions, lost_possession

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```



### Task 2: Parameter ranges and tuner input errors

Parameter files were type-checked but not range-checked: a `letRunShare` of 5 or a negative `windowSdMin` loaded. Now every probability or share must lie in 0..1, every other number must be non-negative, and only model coefficients (logits, xG, xPass, save model, take-on, first-touch and ground-duel coefficients, `tackleBase`) may take any sign. The tuner also reports a missing or malformed `--targets` or `--from` file in one line with exit status 2 instead of a stack trace.

**Files:**
- Modify: `packages/sim-core/src/params.ts` (`paramsFromJson`), `packages/calibrate/src/cli.ts`
- Test: `packages/sim-core/test/params.test.ts`, `packages/calibrate/test/cli.test.ts` (one new case each block)

**Interfaces:**
- Consumes: Plan 2a's loader and Plan 2b's CLI helpers (`CliError`, `exitOnUserError`).
- Produces: `paramsFromJson` throws `ParamsError` ("params field <path> must be between 0 and 1" / "must not be negative"); the tuner prints `Cannot read targets file …` / `Cannot read start file …`.

- [ ] **Step 1: Write the failing tests**

Apply this change to `packages/sim-core/test/params.test.ts` (from the repository root):

```bash
git apply <<'PATCH'
diff --git a/packages/sim-core/test/params.test.ts b/packages/sim-core/test/params.test.ts
index b27b454..7b87f5d 100644
--- a/packages/sim-core/test/params.test.ts
+++ b/packages/sim-core/test/params.test.ts
@@ -1,3 +1,6 @@
+import { readFileSync } from "node:fs"
+import { dirname, join } from "node:path"
+import { fileURLToPath } from "node:url"
 import { describe, expect, it } from "vitest"
 import { ACTIONS, assertProvenance, DEFAULT_PARAMS, ParamsError, paramsFromJson } from "../src/params.js"
 import { ACTION_ZONES } from "../src/geometry.js"
@@ -57,3 +60,21 @@ describe("params from JSON: review fixes", () => {
     expect(String(p.kinematics)).toBe("[object Object]")
   })
 })
+
+describe("params from JSON: value ranges", () => {
+  const prov = { dataset: "open data", licence: "CC-BY-4.0", attribution: "Some League; Someone et al.", fitted_at: "2026-10-06", version: "v1" }
+  it("accepts the defaults and the committed calibrated parameters", () => {
+    expect(() => paramsFromJson({ provenance: prov })).not.toThrow()
+    const root = join(dirname(fileURLToPath(import.meta.url)), "../../..")
+    expect(() => paramsFromJson(JSON.parse(readFileSync(join(root, "data/params/touchline-params.json"), "utf8")))).not.toThrow()
+  })
+  it("refuses probabilities outside 0..1", () => {
+    for (const bad of [{ keeper: { letRunShare: 5 } }, { defending: { foulPerTackle: -0.1 } }, { substitutions: { windowChance: [1, 1.2, 0.5] } }, { kinematics: { reachMargin: 1.5 } }])
+      expect(() => paramsFromJson({ provenance: prov, ...bad }), JSON.stringify(bad)).toThrow(/must be between 0 and 1/)
+  })
+  it("refuses negative values where only magnitudes make sense, but allows signed model coefficients", () => {
+    for (const bad of [{ substitutions: { windowSdMin: -1 } }, { kinematics: { vmaxBase: -9 } }, { timing: { restartDelayS: { corner: -5 } } }])
+      expect(() => paramsFromJson({ provenance: prov, ...bad }), JSON.stringify(bad)).toThrow(/must not be negative/)
+    expect(() => paramsFromJson({ provenance: prov, shot: { xg: { b0: -2 } }, firstTouch: { bSkill: -4 }, defending: { tackleBase: -0.5 } })).not.toThrow()
+  })
+})
PATCH
```

Apply this change to `packages/calibrate/test/cli.test.ts` (from the repository root):

```bash
git apply <<'PATCH'
diff --git a/packages/calibrate/test/cli.test.ts b/packages/calibrate/test/cli.test.ts
index 3b4ab86..34cb6b8 100644
--- a/packages/calibrate/test/cli.test.ts
+++ b/packages/calibrate/test/cli.test.ts
@@ -32,4 +32,13 @@ describe("calibration command lines", () => {
     const realism = run("src/realism.ts", ["--help"]).stdout
     expect(realism).toMatch(/--out\s.*\(default: [^)]*out\/realism-report\.md\)/)
   })
+  it("the tuner reports a missing targets or start file in one line", () => {
+    const out = join(mkdtempSync(join(tmpdir(), "touchline-cli-")), "params.json")
+    for (const args of [["--targets", "no-such-targets.json"], ["--from", "no-such-start.json"]]) {
+      const r = run("src/cli.ts", [...args, "--out", out])
+      expect(r.status, args.join(" ")).toBe(2)
+      expect(r.stderr.trim()).toMatch(/^Cannot read (targets|start) file no-such-/)
+      expect(r.stderr).not.toMatch(/at .*\.ts:\d+/)
+    }
+  })
 })
PATCH
```

- [ ] **Step 2: Run them to make sure they fail**

Run: `pnpm --filter @touchline/sim-core test params && pnpm --filter @touchline/calibrate test cli`
Expected: 2 failed in params (`refuses probabilities outside 0..1`, `refuses negative values…`); 1 failed in cli (`the tuner reports a missing targets or start file in one line`)

- [ ] **Step 3: Implement**

Apply this change to `packages/sim-core/src/params.ts`, `packages/calibrate/src/cli.ts` (from the repository root):

```bash
git apply <<'PATCH'
diff --git a/packages/calibrate/src/cli.ts b/packages/calibrate/src/cli.ts
index a2aaf19..18ecbfe 100644
--- a/packages/calibrate/src/cli.ts
+++ b/packages/calibrate/src/cli.ts
@@ -2,7 +2,7 @@ import { readFileSync, writeFileSync } from "node:fs"
 import { dirname, join, resolve } from "node:path"
 import { fileURLToPath } from "node:url"
 import type { League } from "@touchline/league"
-import { cliOptions, positiveInteger } from "@touchline/sim"
+import { CliError, cliOptions, exitOnUserError, positiveInteger } from "@touchline/sim"
 import { DEFAULT_PARAMS } from "@touchline/sim-core"
 import type { Targets } from "./evaluate.js"
 import { applyKnobs, KNOBS } from "./knobs.js"
@@ -20,14 +20,22 @@ const o = cliOptions("calibrate: tune engine knobs to real-match targets (method
   // --from <file>: continue from that file's calibration knobs instead of the defaults.
   from: { default: "", help: "start from the calibration.knobs of this file" }
 })
-const targetsPath = here(o.targets)
 const outPath = here(o.out)
 const matches = Number(o.matches)
 const rounds = Number(o.rounds)
-const start = o.from ? (JSON.parse(readFileSync(here(o.from), "utf8")) as { calibration?: { knobs?: Record<string, number> } }).calibration?.knobs ?? {} : {}
+/** Read a JSON input file; a missing or malformed file is a one-line error (exit 2). */
+const readJson = (what: string, path: string): unknown =>
+  exitOnUserError(() => {
+    try {
+      return JSON.parse(readFileSync(here(path), "utf8"))
+    } catch (e) {
+      throw new CliError(`Cannot read ${what} file ${path}: ${e instanceof Error ? e.message : String(e)}`)
+    }
+  })
+const start = o.from ? (readJson("start", o.from) as { calibration?: { knobs?: Record<string, number> } }).calibration?.knobs ?? {} : {}
 
 const league = JSON.parse(readFileSync(join(root, "data/league/league.json"), "utf8")) as League
-const targets = JSON.parse(readFileSync(targetsPath, "utf8")) as Targets
+const targets = readJson("targets", o.targets) as Targets
 const t0 = Date.now()
 const res = tune(league, DEFAULT_PARAMS, targets, {
   matches,
diff --git a/packages/sim-core/src/params.ts b/packages/sim-core/src/params.ts
index 034dae7..713fa36 100644
--- a/packages/sim-core/src/params.ts
+++ b/packages/sim-core/src/params.ts
@@ -331,8 +331,32 @@ const mergeInto = (base: unknown, over: unknown, path: string): unknown => {
  * Parameters from a JSON file: the provenance gate first, then a deep merge onto DEFAULT_PARAMS
  * (fields the file omits keep their defaults; keys the engine does not know are ignored).
  */
+/** Model coefficients and logits, which may take any sign. */
+const SIGNED = [/^actions\.logits\./, /^pass\.xpass\./, /^shot\.xg\./, /^takeOn\./, /^firstTouch\.b/, /^groundDuel\.b/, /^defending\.tackleBase$/]
+/** Probabilities and shares, which must lie in 0..1. */
+const PROBABILITIES = new Set([
+  "kinematics.reachMargin", "ball.bounce", "execution.mishitBase", "movement.shapeSpeedShare",
+  "shot.onTargetRate", "shot.blockPerDefender", "shot.blockPressure", "shot.blockBehind",
+  "defending.foulPerTackle", "defending.yellowPerFoul", "defending.redPerFoul", "defending.tackleLooseShare", "defending.interceptLooseShare",
+  "defending.crossBlock", "defending.crossBlockBehind", "defending.headClearShare", "defending.headBehind", "defending.clearToTouch", "defending.clearSliceBehind",
+  "keeper.letRunShare", "keeper.comeShare", "keeper.catchBase", "keeper.catchHandling", "keeper.fumbleShare",
+  "firstTouch.missedShare", "firstTouch.miscontrolShare", "substitutions.windowChance", "substitutions.halfTimeChance"
+])
+
+/** Check every number: probabilities in 0..1, coefficients any sign, everything else not negative. */
+const checkRanges = (v: unknown, path: string): void => {
+  if (Array.isArray(v)) return v.forEach((x) => checkRanges(x, path))
+  if (isObject(v)) return Object.entries(v).forEach(([k, x]) => checkRanges(x, path ? `${path}.${k}` : k))
+  if (typeof v !== "number" || SIGNED.some((r) => r.test(path))) return
+  if (PROBABILITIES.has(path) && (v < 0 || v > 1)) throw new ParamsError(`params field ${path} must be between 0 and 1 (got ${v})`)
+  if (v < 0) throw new ParamsError(`params field ${path} must not be negative (got ${v})`)
+}
+
 export const paramsFromJson = (json: unknown): Params => {
   if (!isObject(json)) throw new ParamsError("params file must be a JSON object")
   assertProvenance(json as { provenance?: Partial<Provenance> })
-  return mergeInto(DEFAULT_PARAMS, json, "params") as Params
+  const merged = mergeInto(DEFAULT_PARAMS, json, "params") as Params
+  const { provenance: _, ...values } = merged
+  checkRanges(values, "")
+  return merged
 }
PATCH
```

- [ ] **Step 4: Run the tests**

Run: `pnpm --filter @touchline/sim-core test params && pnpm --filter @touchline/calibrate test cli`
Expected: 12 passed; 4 passed

Run: `pnpm turbo run typecheck test --force`
Expected: `Tasks: 10 successful`

- [ ] **Step 5: Commit**

```bash
git add packages/sim-core packages/calibrate
git commit -m "fix: range-check parameter files; one-line errors for the tuner's input files

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```



### Task 3: Blocked share and save rate as calibration statistics

The tuner could not see why shots on target were low: blocked shots and the keeper's save rate were not measured. Both join the shared statistic definitions (Python and TypeScript, kept identical by the parity test) and the real-match targets: in the 7 IDSSE matches 22.7 % of shots are blocked and keepers save 66.9 % of shots on target (per-match means). The gate baseline gains the two statistics.

**Files:**
- Modify: `python/analytics/touchline_analytics/metrics.py`, `python/analytics/touchline_analytics/targets.py`, `python/analytics/touchline_analytics/report.py`, `packages/calibrate/src/metrics.ts`, `packages/calibrate/src/evaluate.ts` (weights)
- Regenerate: `data/params/targets-idsse.json`, `data/params/realism-baseline.json`
- Test: `python/analytics/tests/test_metrics.py` (one new case); the existing parity test

**Interfaces:**
- Consumes: the shared metric records (Plan 2a) and IDSSE raw files in `data/raw/idsse`.
- Produces: statistic keys `blocked_share` and `save_rate` (in `SCALAR_KEYS`, `WEIGHTS` 0.7 each, report labels); shot records carry `blocked`.

- [ ] **Step 1: Write the failing test**

Apply this change to `python/analytics/tests/test_metrics.py` (from the repository root):

```bash
git apply <<'PATCH'
diff --git a/python/analytics/tests/test_metrics.py b/python/analytics/tests/test_metrics.py
index 2e2b367..436049b 100644
--- a/python/analytics/tests/test_metrics.py
+++ b/python/analytics/tests/test_metrics.py
@@ -57,3 +57,14 @@ def test_touchline_events_reads_details_from_attrs(tmp_path):
     ev = touchline_events(f)
     assert ev[0]["set_piece"] == "corner" and ev[0]["length"] == 20.0
     assert ev[1]["set_piece"] == "penalty" and ev[1]["on_target"]
+
+
+def test_shot_outcome_shares():
+    def s(goal=False, on=False, blocked=False):
+        return {"type": "shot", "set_piece": None, "complete": False, "length": None, "goal": goal, "on_target": on or goal, "blocked": blocked}
+
+    m = event_metrics([s(goal=True), s(on=True), s(on=True), s(on=True), s(blocked=True), s(), s(), s()])
+    assert math.isclose(m["blocked_share"], 1 / 8)
+    assert math.isclose(m["save_rate"], 3 / 4)
+    empty = event_metrics([])
+    assert empty["blocked_share"] == 0.0 and empty["save_rate"] == 0.0
PATCH
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `uv run --project python/analytics --group dev pytest python/analytics/tests -q`
Expected: 1 failed: `test_shot_outcome_shares` (KeyError: 'blocked_share')

- [ ] **Step 3: Implement on both sides**

Apply this change to `python/analytics/touchline_analytics/metrics.py`, `python/analytics/touchline_analytics/targets.py`, `python/analytics/touchline_analytics/report.py` (from the repository root):

```bash
git apply <<'PATCH'
diff --git a/python/analytics/touchline_analytics/metrics.py b/python/analytics/touchline_analytics/metrics.py
index eae3758..5547f4e 100644
--- a/python/analytics/touchline_analytics/metrics.py
+++ b/python/analytics/touchline_analytics/metrics.py
@@ -2,7 +2,7 @@
 
 Both sources are first converted to the same plain records, then measured by the same functions:
 - events: dicts {type: pass|shot|foul|card, set_piece: None|corner|throw_in|goal_kick|free_kick|kick_off|penalty,
-  complete: bool, length: float|None, goal: bool, on_target: bool}
+  complete: bool, length: float|None, goal: bool, on_target: bool, blocked: bool (shots; optional, default False)}
 - frames: iterables of (period, t_seconds, ball_in_play, {player_id: (x, y)})
 
 The TypeScript port (packages/calibrate/src/metrics.ts) must produce identical numbers; a parity
@@ -47,6 +47,7 @@ def event_metrics(events: list[dict]) -> dict:
     complete = [e for e in passes if e["complete"]]
     lengths = [e["length"] for e in complete if e["length"] is not None]
     shots = [e for e in events if e["type"] == "shot"]
+    on_target = sum(1 for e in shots if e["on_target"])
     sp = lambda k: sum(1 for e in passes if e["set_piece"] == k)  # noqa: E731
     return {
         "passes": len(passes),
@@ -54,7 +55,9 @@ def event_metrics(events: list[dict]) -> dict:
         "long_share": sum(1 for v in lengths if v >= LONG_PASS_M) / len(lengths) if lengths else 0.0,
         "pass_len_median": _median(lengths),
         "shots": len(shots),
-        "on_target_share": sum(1 for e in shots if e["on_target"]) / len(shots) if shots else 0.0,
+        "on_target_share": on_target / len(shots) if shots else 0.0,
+        "blocked_share": sum(1 for e in shots if e.get("blocked", False)) / len(shots) if shots else 0.0,
+        "save_rate": sum(1 for e in shots if e["on_target"] and not e["goal"]) / on_target if on_target else 0.0,
         "goals": sum(1 for e in shots if e["goal"]),
         "penalties": sum(1 for e in shots if e["set_piece"] == "penalty"),
         "corners": sp("corner"),
@@ -142,7 +145,7 @@ def touchline_events(domain_jsonl: Path) -> list[dict]:
                 out.append({"type": "pass", "set_piece": _SET_PIECE.get(a.get("restart") or "", None), "complete": ok, "length": length, "goal": False, "on_target": False})
             elif t == "shot":
                 sp = "penalty" if a.get("technique") == "penalty" else None
-                out.append({"type": "shot", "set_piece": sp, "complete": False, "length": None, "goal": e["outcome"] == "goal", "on_target": e["outcome"] in ("goal", "saved")})
+                out.append({"type": "shot", "set_piece": sp, "complete": False, "length": None, "goal": e["outcome"] == "goal", "on_target": e["outcome"] in ("goal", "saved"), "blocked": e["outcome"] == "blocked"})
             elif t in ("foul", "card"):
                 out.append({"type": t, "set_piece": None, "complete": False, "length": None, "goal": False, "on_target": False})
     return out
diff --git a/python/analytics/touchline_analytics/report.py b/python/analytics/touchline_analytics/report.py
index 03577d7..ceaa0fd 100644
--- a/python/analytics/touchline_analytics/report.py
+++ b/python/analytics/touchline_analytics/report.py
@@ -21,6 +21,8 @@ LABELS = {
     "pass_len_median": ("Median completed pass length (m)", "{:.1f}"),
     "shots": ("Shots per match", "{:.1f}"),
     "on_target_share": ("Shots on target, share", "{:.1%}"),
+    "blocked_share": ("Shots blocked, share", "{:.1%}"),
+    "save_rate": ("Saves, share of shots on target", "{:.1%}"),
     "goals": ("Goals per match", "{:.2f}"),
     "penalties": ("Penalties per match", "{:.2f}"),
     "corners": ("Corners", "{:.1f}"),
diff --git a/python/analytics/touchline_analytics/targets.py b/python/analytics/touchline_analytics/targets.py
index 69c8183..e9e7770 100644
--- a/python/analytics/touchline_analytics/targets.py
+++ b/python/analytics/touchline_analytics/targets.py
@@ -20,7 +20,7 @@ from .idsse import MATCHES, PROVENANCE, filenames
 from .metrics import PASS_LEN_EDGES, SPEED_EDGES, event_metrics, tracking_metrics
 
 _SET_PIECE = {"THROW_IN": "throw_in", "CORNER_KICK": "corner", "GOAL_KICK": "goal_kick", "FREE_KICK": "free_kick", "KICK_OFF": "kick_off", "PENALTY": "penalty"}
-EVENT_KEYS = ["passes", "completion", "long_share", "pass_len_median", "shots", "on_target_share", "goals", "penalties", "corners", "throw_ins", "goal_kicks", "free_kicks", "fouls", "cards"]
+EVENT_KEYS = ["passes", "completion", "long_share", "pass_len_median", "shots", "on_target_share", "blocked_share", "save_rate", "goals", "penalties", "corners", "throw_ins", "goal_kicks", "free_kicks", "fouls", "cards"]
 TRACKING_KEYS = ["in_play_share", "distance_km_median", "peak_speed_kmh_median"]
 
 
@@ -45,7 +45,7 @@ def idsse_events(root: Path, match_id: str) -> list[dict]:
             for q in e.qualifiers or []:
                 if type(q).__name__ == "SetPieceQualifier":
                     sp = _SET_PIECE.get(q.value.name)
-            out.append({"type": "shot", "set_piece": sp, "complete": False, "length": None, "goal": r == "GOAL", "on_target": r in ("GOAL", "SAVED")})
+            out.append({"type": "shot", "set_piece": sp, "complete": False, "length": None, "goal": r == "GOAL", "on_target": r in ("GOAL", "SAVED"), "blocked": r == "BLOCKED"})
         elif name == "FOUL_COMMITTED":
             out.append({"type": "foul", "set_piece": None, "complete": False, "length": None, "goal": False, "on_target": False})
         elif name == "CARD":
PATCH
```

Apply this change to `packages/calibrate/src/metrics.ts`, `packages/calibrate/src/evaluate.ts` (from the repository root):

```bash
git apply <<'PATCH'
diff --git a/packages/calibrate/src/evaluate.ts b/packages/calibrate/src/evaluate.ts
index 68ecdb5..1897908 100644
--- a/packages/calibrate/src/evaluate.ts
+++ b/packages/calibrate/src/evaluate.ts
@@ -58,7 +58,7 @@ export const meanMetrics = (ms: ReadonlyArray<MatchMetrics>): Record<ScalarKey,
 
 /** Relative weights: noisy, low-count statistics count less. */
 export const WEIGHTS: Readonly<Record<ScalarKey, number>> = {
-  passes: 1, completion: 1, long_share: 1, pass_len_median: 1, shots: 1, on_target_share: 0.7, goals: 1, penalties: 0.5, corners: 0.7,
+  passes: 1, completion: 1, long_share: 1, pass_len_median: 1, shots: 1, on_target_share: 0.7, blocked_share: 0.7, save_rate: 0.7, goals: 1, penalties: 0.5, corners: 0.7,
   throw_ins: 1, goal_kicks: 0.7, free_kicks: 0.7, fouls: 1, cards: 0.5, in_play_share: 1, distance_km_median: 0.7, peak_speed_kmh_median: 0.7
 }
 
diff --git a/packages/calibrate/src/metrics.ts b/packages/calibrate/src/metrics.ts
index 9100678..c4bd379 100644
--- a/packages/calibrate/src/metrics.ts
+++ b/packages/calibrate/src/metrics.ts
@@ -17,6 +17,8 @@ export interface MatchMetrics {
   readonly pass_len_median: number
   readonly shots: number
   readonly on_target_share: number
+  readonly blocked_share: number
+  readonly save_rate: number
   readonly goals: number
   readonly penalties: number
   readonly corners: number
@@ -33,7 +35,7 @@ export interface MatchMetrics {
 }
 
 export const SCALAR_KEYS = [
-  "passes", "completion", "long_share", "pass_len_median", "shots", "on_target_share", "goals", "penalties", "corners", "throw_ins",
+  "passes", "completion", "long_share", "pass_len_median", "shots", "on_target_share", "blocked_share", "save_rate", "goals", "penalties", "corners", "throw_ins",
   "goal_kicks", "free_kicks", "fouls", "cards", "in_play_share", "distance_km_median", "peak_speed_kmh_median"
 ] as const
 export type ScalarKey = (typeof SCALAR_KEYS)[number]
@@ -64,6 +66,7 @@ export const eventMetrics = (events: ReadonlyArray<DomainEvent>) => {
   const complete = passes.filter((e) => e.outcome === "successful")
   const lengths = complete.filter((e) => e.x_end !== null).map((e) => Math.hypot(e.x_end! - e.x!, e.y_end! - e.y!))
   const shots = events.filter((e) => e.type === "shot")
+  const onTarget = shots.filter((e) => e.outcome === "goal" || e.outcome === "saved").length
   const sp = (k: string) => passes.filter((e) => SET_PIECE[String(e.attrs.restart ?? "")] === k).length
   return {
     passes: passes.length,
@@ -71,7 +74,9 @@ export const eventMetrics = (events: ReadonlyArray<DomainEvent>) => {
     long_share: lengths.length ? lengths.filter((v) => v >= LONG_PASS_M).length / lengths.length : 0,
     pass_len_median: median(lengths),
     shots: shots.length,
-    on_target_share: shots.length ? shots.filter((e) => e.outcome === "goal" || e.outcome === "saved").length / shots.length : 0,
+    on_target_share: shots.length ? onTarget / shots.length : 0,
+    blocked_share: shots.length ? shots.filter((e) => e.outcome === "blocked").length / shots.length : 0,
+    save_rate: onTarget ? shots.filter((e) => e.outcome === "saved").length / onTarget : 0,
     goals: shots.filter((e) => e.outcome === "goal").length,
     penalties: shots.filter((e) => e.attrs.technique === "penalty").length,
     corners: sp("corner"),
PATCH
```

- [ ] **Step 4: Run the tests, including parity**

Run: `uv run --project python/analytics --group dev pytest python/analytics/tests -q && pnpm --filter @touchline/calibrate test parity tune`
Expected: 11 passed; 9 passed (parity checks every statistic, the new ones included)

- [ ] **Step 5: Rebuild the targets and the gate baseline**

Run: `uv run --project python/analytics python -m touchline_analytics.targets`
Expected: `data/params/targets-idsse.json` gains `blocked_share` (mean 0.2267, SD 0.061) and `save_rate` (mean 0.6693, SD 0.1682); every other statistic is unchanged

Run: `UPDATE_REALISM_BASELINE=1 pnpm --filter @touchline/calibrate test realism-gate`
Expected: 1 passed; the baseline shows save rate about 0.49 (the shot model's problem, fixed in Task 4)

Run: `pnpm turbo run typecheck test --force`
Expected: `Tasks: 10 successful`

- [ ] **Step 6: Commit**

```bash
git add python/analytics packages/calibrate data/params/targets-idsse.json data/params/realism-baseline.json
git commit -m "feat(calibrate): blocked share and save rate as calibration statistics

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```



### Task 4: Shot model with separate block, aim and save steps

Until now an on-target shot scored with probability xG divided by the chance of being on target, so goals per shot matched xG however few shots reached the target and keepers saved almost nothing (save rate about 49 % against 67 % real). The save is now its own step: `saveChance` gives the probability that the keeper saves an on-target shot from where it is placed (towards the posts and near the bar or ground is harder), the distance and the keeper's reflexes. Goals come out of block, aim and save; the recalibration (Task 10) fits the save intercept. Penalties keep their fixed conversion. The blocked-cross test from Task 1 now forces blocks (`crossBlock: 1` within 8 m) so it always has blocks to check.

**Files:**
- Modify: `packages/sim-core/src/shot.ts`, `packages/sim-core/src/params.ts`
- Test: `packages/sim-core/test/resolve-shot.test.ts` (the old "goals per shot track xG" test is replaced), `packages/sim-core/test/minors.test.ts`

**Interfaces:**
- Consumes: Plan 2b's `planShot`.
- Produces: `interface ShotOnTarget {y, z, distance}`; `saveChance(s, keeper, p, logitShift = 0)`; `params.shot.save {b0, bWide, bEdge, bDistance, bReflexes}` (signed coefficients).

- [ ] **Step 1: Write the failing tests**

Apply this change to `packages/sim-core/test/resolve-shot.test.ts`, `packages/sim-core/test/minors.test.ts` (from the repository root):

```bash
git apply <<'PATCH'
diff --git a/packages/sim-core/test/minors.test.ts b/packages/sim-core/test/minors.test.ts
index 8081761..1700116 100644
--- a/packages/sim-core/test/minors.test.ts
+++ b/packages/sim-core/test/minors.test.ts
@@ -41,7 +41,9 @@ describe("the hard stop at the end of a half", () => {
 })
 
 describe("blocked crosses and deflections", () => {
-  const runs = [1, 2, 3].map((seed) => play(makeConfig(seed, { params: calibrated })))
+  // Every cross within 8 m of a defender is blocked, so each match has plenty of blocks to check.
+  const blocky = { ...calibrated, defending: { ...calibrated.defending, crossBlock: 1, crossBlockM: 8 } }
+  const runs = [1, 2, 3].map((seed) => play(makeConfig(seed, { params: blocky })))
   it("the ball travels to the blocker: no jump in the frame before the block", () => {
     let n = 0
     for (const r of runs) {
@@ -53,7 +55,7 @@ describe("blocked crosses and deflections", () => {
         expect(Math.hypot(before.ball.x - e.x!, before.ball.y - e.y!), e.id).toBeLessThan(2.5)
       }
     }
-    expect(n).toBeGreaterThanOrEqual(2)
+    expect(n).toBeGreaterThan(10)
   })
   it("a deflection behind never crosses the goal line between the posts", () => {
     const r = new Rng(seedRng(9))
diff --git a/packages/sim-core/test/resolve-shot.test.ts b/packages/sim-core/test/resolve-shot.test.ts
index 2d00461..0b2e375 100644
--- a/packages/sim-core/test/resolve-shot.test.ts
+++ b/packages/sim-core/test/resolve-shot.test.ts
@@ -5,7 +5,7 @@ import { DEFAULT_PARAMS as P } from "../src/params.js"
 import * as KIN from "../src/kinematics.js"
 import { goalLineCrossing, resolveFlight } from "../src/resolve.js"
 import { Rng, seedRng } from "../src/rng.js"
-import { parryBall, planShot } from "../src/shot.js"
+import { parryBall, planShot, saveChance } from "../src/shot.js"
 import type { PlayerState } from "../src/types.js"
 import { kickoffPlayersFor, makeConfig } from "../src/testing.js"
 
@@ -33,16 +33,28 @@ describe("resolveFlight", () => {
 })
 
 describe("planShot", () => {
-  it("goals per shot track xG on average (keeper only, no blockers)", () => {
+  it("keepers save corners and well-struck shots less often, close-range shots less often, and good keepers more", () => {
+    const keeper = at(base.find((p) => p.side === "away" && p.role === "GK")!, 51, 0)
+    const shot = { y: 0, z: 1.2, distance: 16 }
+    expect(saveChance({ ...shot, y: 3.4 }, keeper, P)).toBeLessThan(saveChance(shot, keeper, P))
+    expect(saveChance({ ...shot, z: 0.1 }, keeper, P)).toBeLessThan(saveChance(shot, keeper, P))
+    expect(saveChance({ ...shot, distance: 6 }, keeper, P)).toBeLessThan(saveChance(shot, keeper, P))
+    const great = { ...keeper, attrs: { ...keeper.attrs, reflexes: 0.95 } }, poor = { ...keeper, attrs: { ...keeper.attrs, reflexes: 0.3 } }
+    expect(saveChance(shot, great, P)).toBeGreaterThan(saveChance(shot, poor, P))
+  })
+  it("keepers save roughly two in three shots on target from the edge of the box", () => {
     const shooter = at(base[9]!, 36, 4)
     const keeper = at(base.find((p) => p.side === "away" && p.role === "GK")!, 51, 0)
     const xg = xgOf(P, "home", shooter.pos, false, 0)
     const r = new Rng(seedRng(3))
-    let goals = 0
-    const n = 6000
-    for (let i = 0; i < n; i++) if (planShot(shooter, "home", [keeper], xg, 0, false, P, 0.1, r).outcome === "goal") goals++
-    expect(goals / n).toBeGreaterThan(xg * 0.75)
-    expect(goals / n).toBeLessThan(xg * 1.25)
+    let on = 0, goals = 0
+    for (let i = 0; i < 6000; i++) {
+      const s = planShot(shooter, "home", [keeper], xg, 0, false, P, 0.1, r)
+      if (s.onTarget) on++
+      if (s.outcome === "goal") goals++
+    }
+    expect(1 - goals / on).toBeGreaterThan(0.55)
+    expect(1 - goals / on).toBeLessThan(0.8)
   })
   it("penalties score about three times in four", () => {
     const shooter = at(base[9]!, 41.5, 0)
PATCH
```

- [ ] **Step 2: Run them to make sure they fail**

Run: `pnpm --filter @touchline/sim-core test resolve-shot`
Expected: 2 failed: `TypeError: saveChance is not a function`; `expected 0.816… to be less than 0.8` (today's save rate from the edge of the box)

- [ ] **Step 3: Implement**

Apply this change to `packages/sim-core/src/shot.ts`, `packages/sim-core/src/params.ts` (from the repository root):

```bash
git apply <<'PATCH'
diff --git a/packages/sim-core/src/params.ts b/packages/sim-core/src/params.ts
index 713fa36..4c40e58 100644
--- a/packages/sim-core/src/params.ts
+++ b/packages/sim-core/src/params.ts
@@ -102,6 +102,8 @@ export interface Params {
     readonly blockPressure: number
     /** Share of blocked shots deflected behind the goal line (corners). */
     readonly blockBehind: number
+    /** Save model for shots on target (see saveChance): intercept and the effects of placement, distance and reflexes. */
+    readonly save: { readonly b0: number; readonly bWide: number; readonly bEdge: number; readonly bDistance: number; readonly bReflexes: number }
   }
   readonly defending: {
     readonly pressRatePerS: number
@@ -241,7 +243,9 @@ export const DEFAULT_PARAMS: Params = {
     blockPerDefender: 0.23,
     blockWidthM: 3.5,
     blockPressure: 0.2,
-    blockBehind: 0.5
+    blockBehind: 0.5,
+    // A prior shaped like public post-shot xG findings (corners and close range beat keepers); the intercept is tuned to the IDSSE save rate.
+    save: { b0: 1.3, bWide: -1.6, bEdge: -0.7, bDistance: 0.6, bReflexes: 2.0 }
   },
   defending: {
     pressRatePerS: 0.6,
@@ -332,7 +336,7 @@ const mergeInto = (base: unknown, over: unknown, path: string): unknown => {
  * (fields the file omits keep their defaults; keys the engine does not know are ignored).
  */
 /** Model coefficients and logits, which may take any sign. */
-const SIGNED = [/^actions\.logits\./, /^pass\.xpass\./, /^shot\.xg\./, /^takeOn\./, /^firstTouch\.b/, /^groundDuel\.b/, /^defending\.tackleBase$/]
+const SIGNED = [/^actions\.logits\./, /^pass\.xpass\./, /^shot\.xg\./, /^shot\.save\./, /^takeOn\./, /^firstTouch\.b/, /^groundDuel\.b/, /^defending\.tackleBase$/]
 /** Probabilities and shares, which must lie in 0..1. */
 const PROBABILITIES = new Set([
   "kinematics.reachMargin", "ball.bounce", "execution.mishitBase", "movement.shapeSpeedShare",
diff --git a/packages/sim-core/src/shot.ts b/packages/sim-core/src/shot.ts
index 60584af..11be7a4 100644
--- a/packages/sim-core/src/shot.ts
+++ b/packages/sim-core/src/shot.ts
@@ -52,7 +52,29 @@ export const parryBall = (side: Side, saveAt: Vec3, handling: Handling, rng: Rng
   return { pos: saveAt, vel: { x: -d * rng.range(3, 7), y: rng.range(-5, 5), z: 0.5 } }
 }
 
-/** Resolve a shot at release: blocks, execution error, on-target check, keeper. */
+/** Where an on-target shot crosses the goal line (m from the centre, m above the ground) and how far it was struck from. */
+export interface ShotOnTarget {
+  readonly y: number
+  readonly z: number
+  readonly distance: number
+}
+
+/**
+ * Chance that the keeper saves an on-target shot: lower towards the posts (`bWide`) and near the bar or the
+ * ground (`bEdge`), lower from close range (`bDistance` per 10 m beyond 16 m), higher for quick reflexes.
+ */
+export const saveChance = (s: ShotOnTarget, keeper: PlayerState, p: Params): number => {
+  const c = p.shot.save
+  const wide = Math.min(1, Math.abs(s.y) / PITCH.goalHalfWidth)
+  const edge = Math.min(1, Math.abs(s.z / PITCH.goalHeight - 0.5) * 2)
+  return 1 / (1 + Math.exp(-(c.b0 + c.bWide * wide + c.bEdge * edge + (c.bDistance * (s.distance - 16)) / 10 + c.bReflexes * (keeper.attrs.reflexes - 0.6))))
+}
+
+/**
+ * Resolve a shot at release in three steps: a block by a defender, then the aim (execution error decides
+ * whether it is on target), then the keeper's save (saveChance). `xg` is the decision model's value; it is
+ * recorded on the event and does not set the outcome.
+ */
 export const planShot = (
   shooter: PlayerState,
   side: Side,
@@ -116,10 +138,12 @@ export const planShot = (
   const onTarget = Math.abs(y) < PITCH.goalHalfWidth && z < PITCH.goalHeight
   const keeper = opponents.find((o) => o.role === "GK" && !o.sentOff) ?? null
   if (!onTarget) return { outcome: "wide", ticks: travel(d), from, to, execution, onTarget, blockerId: null, keeperId: null, handling: null }
-  // Scale by the expected on-target probability for this aim and noise, so goals per shot track xG.
+  // Penalties keep their fixed conversion (scaled by how likely this aim was to be on target); every other
+  // shot on target beats the keeper unless saved, by placement, distance and the keeper's reflexes (see saveChance).
   // Heights below 0 are clamped to the ground, so the vertical window is (-inf, crossbar).
-  const pOnTarget = Math.max(0.05, normalBetween(-PITCH.goalHalfWidth, PITCH.goalHalfWidth, aimY, sdY) * normalBetween(-50, PITCH.goalHeight, aimZ, sdZ))
-  const pGoalClean = Math.min(0.95, Math.max(0.03, Math.min(0.95, (isPenalty ? 0.76 : xg) / pOnTarget)) * scoring)
+  const pGoalClean = isPenalty
+    ? Math.min(0.95, 0.76 / Math.max(0.05, normalBetween(-PITCH.goalHalfWidth, PITCH.goalHalfWidth, aimY, sdY) * normalBetween(-50, PITCH.goalHeight, aimZ, sdZ)))
+    : Math.min(0.95, (keeper ? 1 - saveChance({ y, z, distance: d }, keeper, p) : 1) * scoring)
   const pGoal = mis ? pGoalClean * 0.3 : pGoalClean
   if (rng.chance(pGoal) || keeper === null)
     return { outcome: "goal", ticks: travel(d), from, to, execution, onTarget, blockerId: null, keeperId: null, handling: null }
PATCH
```

- [ ] **Step 4: Run the tests**

Run: `pnpm --filter @touchline/sim-core test resolve-shot minors`
Expected: 18 passed

Run: `pnpm turbo run typecheck test --force`
Expected: `Tasks: 10 successful`; the gate passes (about `"loss":7.02,"maxDrift":1.18`)

Run: `pnpm realism --matches 8`
Expected: in `out/realism-report.md`, shots on target rise to about 27 % (from 20 %)

- [ ] **Step 5: Commit**

```bash
git add packages/sim-core
git commit -m "feat(sim-core): shot model with separate block, aim and save steps

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```



### Task 5: Scenario effects in the engine: nudges and forced outcomes

A scenario script (spec §5.1.7) is a list of `{window, team, effect, count?}` entries. Inside an entry's window the engine nudges the scripted team's per-second intensities: `goal` raises its shot logit and conversion, `momentum_swing` its attacking logits and pressing, `press_surge` its pressing and tackling (and during a surge the two nearest defenders press, from up to 25 m), `red_card` its fouls and reds, `keeper_heroics` and `keeper_howler` shift its keeper's save logit (a howler also fumbles), `defensive_error` multiplies its defenders' mis-hits in their own half. The scenario runner (Task 6) can also force an entry's outcome on the next qualifying action: the next shot scores, the next foul is a red, the next shot on target is saved or let in, the next defender's pass in their own half is a mis-hit. Forced events carry `scripted: true` (a domain attribute; CDF never shows it). Without a script the engine is byte-for-byte unchanged.

**Files:**
- Create: `packages/sim-core/src/script.ts`
- Modify: `packages/sim-core/src/step.ts`, `packages/sim-core/src/shot.ts` (`ShotMods` replaces the trailing `scoring` argument), `packages/sim-core/src/execute.ts`, `packages/sim-core/src/types.ts`, `packages/sim-core/src/params.ts`, `packages/sim-core/src/index.ts`
- Test: `packages/sim-core/test/scenario.test.ts`

**Interfaces:**
- Consumes: Task 4's `planShot` and `saveChance`.
- Produces: `EFFECTS`, `type ScenarioEffect`, `interface ScriptEntry {window, team, effect, count?}`, `interface Script {name, entries}`, `interface Mods`, `NO_MODS`, `modsFor(script, side, minute, p)`; `MatchConfig.script?`; `MatchState.forced: ScriptEntry[]`; `interface ShotMods {scoring?, saveLogit?, fumble?, force?}`; `planShot(…, weakFoot, mods: ShotMods = {})`; `ShotPlan.forced?`; `KickIntent.mishitScale?`, `forceMishit?`; `params.script {…}`.

- [ ] **Step 1: Write the failing tests**

Create `packages/sim-core/test/scenario.test.ts`:

```ts
import { readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "vitest"
import { initMatch, isFinished, modsFor, paramsFromJson, step, type DomainEvent, type MatchConfig, type MatchState, type Script, type ScenarioEffect } from "../src/index.js"
import { makeConfig } from "../src/testing.js"

const root = join(dirname(fileURLToPath(import.meta.url)), "../../..")
const params = paramsFromJson(JSON.parse(readFileSync(join(root, "data/params/touchline-params.json"), "utf8")))
const cfgFor = (seed: number, script?: Script): MatchConfig => makeConfig(seed, { params, ...(script ? { script } : {}) })
const one = (effect: ScenarioEffect, window: readonly [number, number] = [0, 95], team: "home" | "away" = "home"): Script => ({ name: effect, entries: [{ window, team, effect }] })

const play = (cfg: MatchConfig, from?: MatchState) => {
  let s = from ?? initMatch(cfg)
  const events: DomainEvent[] = []
  while (!isFinished(s)) { const r = step(s); s = r.state; events.push(...r.events) }
  return events
}
const minuteOf = (e: DomainEvent) => Number(e.match_clock.slice(0, 2)) + Number(e.match_clock.slice(3)) / 60
const SEEDS = [1, 2, 3, 4, 5, 6]
const sum = (f: (seed: number) => number) => SEEDS.reduce((a, s) => a + f(s), 0)
const HOME = makeConfig(1).home.id

describe("scenario modifiers", () => {
  it("are neutral outside a window and for the other team", () => {
    const s = one("press_surge", [60, 70])
    const neutral = modsFor(undefined, "home", 65, params)
    expect(modsFor(s, "home", 30, params)).toEqual(neutral)
    expect(modsFor(s, "away", 65, params)).toEqual(neutral)
    expect(modsFor(s, "home", 65, params).press).toBeGreaterThan(1)
  })
  it("change nothing before the first window opens", () => {
    const plain = play(cfgFor(3)).filter((e) => minuteOf(e) < 60)
    const scripted = play(cfgFor(3, one("goal", [60, 90]))).filter((e) => minuteOf(e) < 60)
    expect(JSON.stringify(scripted)).toBe(JSON.stringify(plain))
  })
})

describe("nudges raise the scripted outcome's rate", () => {
  const count = (script: Script | undefined, f: (e: DomainEvent) => boolean) => sum((seed) => play(cfgFor(seed, script)).filter(f).length)
  it("press surge: the team presses far more", () => {
    const f = (e: DomainEvent) => e.type === "pressure" && e.team_id === HOME
    expect(count(one("press_surge"), f)).toBeGreaterThan(1.4 * count(undefined, f))
  })
  it("goal: the team scores more", () => {
    const f = (e: DomainEvent) => e.type === "goal" && e.team_id === HOME
    expect(count(one("goal"), f)).toBeGreaterThan(count(undefined, f) + 4)
  })
  it("momentum swing: the team shoots more", () => {
    const f = (e: DomainEvent) => e.type === "shot" && e.team_id === HOME
    expect(count(one("momentum_swing"), f)).toBeGreaterThan(1.2 * count(undefined, f))
  })
  it("red card: the team usually has a player sent off in the window", () => {
    const reds = SEEDS.filter((seed) => play(cfgFor(seed, one("red_card", [10, 90]))).some((e) => e.type === "card" && e.attrs.colour !== "yellow" && e.team_id === HOME)).length
    expect(reds).toBeGreaterThanOrEqual(4)
  })
  it("keeper heroics and howlers move the team keeper's save rate up and down", () => {
    const rate = (script?: Script) => {
      let on = 0, saved = 0
      for (const seed of SEEDS) for (const e of play(cfgFor(seed, script)).filter((x) => x.type === "shot" && x.team_id !== HOME)) {
        if (e.outcome === "goal" || e.outcome === "saved") on++
        if (e.outcome === "saved") saved++
      }
      return saved / on
    }
    const base = rate()
    expect(rate(one("keeper_heroics"))).toBeGreaterThan(base + 0.1)
    expect(rate(one("keeper_howler"))).toBeLessThan(base - 0.1)
  })
  it("defensive error: the team's defenders mis-hit far more passes in their own half", () => {
    const cfg = cfgFor(1)
    const defenders = new Set([...cfg.home.starters, ...(cfg.home.bench ?? [])].filter((p) => ["CB", "FB", "DM"].includes(p.role)).map((p) => p.id))
    const f = (e: DomainEvent) => e.type === "pass" && e.attrs.execution === "mishit" && defenders.has(e.player_id!) && e.x! < 0
    expect(count(one("defensive_error"), f)).toBeGreaterThan(3 * Math.max(1, count(undefined, f)))
  })
})

describe("forcing an outcome", () => {
  const forcedFrom = (effect: ScenarioEffect, team: "home" | "away" = "home") => {
    const cfg = cfgFor(2)
    let s = initMatch(cfg)
    for (let i = 0; i < 3000; i++) s = step(s).state
    return play(cfg, { ...s, forced: [{ window: [0, 95], team, effect }] })
  }
  it("goal: the team's next shot scores and is marked scripted", () => {
    const shot = forcedFrom("goal").find((e) => e.type === "shot" && e.team_id === HOME)!
    expect(shot.outcome).toBe("goal")
    expect(shot.attrs.scripted).toBe(true)
  })
  it("red card: the team's next foul is a red card, marked scripted", () => {
    const ev = forcedFrom("red_card")
    const foul = ev.find((e) => e.type === "foul" && e.team_id === HOME)!
    const card = ev.find((e) => e.type === "card" && e.frame_id === foul.frame_id && e.player_id === foul.player_id)!
    expect(card.attrs.colour).toBe("red")
    expect(card.attrs.scripted).toBe(true)
  })
  it("keeper heroics: the next shot on target against the team is saved, marked scripted", () => {
    // The away keeper is the hero here: the home side shoots more often in this match.
    const shot = forcedFrom("keeper_heroics", "away").find((e) => e.type === "shot" && e.team_id === HOME && (e.outcome === "goal" || e.outcome === "saved"))!
    expect(shot.outcome).toBe("saved")
    expect(shot.attrs.scripted).toBe(true)
  })
  it("defensive error: the next pass by a team defender in their own half is a mis-hit, marked scripted", () => {
    const pass = forcedFrom("defensive_error").find((e) => e.type === "pass" && e.attrs.scripted === true)!
    expect(pass.team_id).toBe(HOME)
    expect(pass.attrs.execution).toBe("mishit")
    expect(pass.x!).toBeLessThan(0)
  })
  it("is used once: later shots are not scripted", () => {
    const ev = forcedFrom("goal")
    expect(ev.filter((e) => e.attrs.scripted === true)).toHaveLength(1)
  })
})
```

- [ ] **Step 2: Run them to make sure they fail**

Run: `pnpm --filter @touchline/sim-core test scenario`
Expected: failures starting with `TypeError: modsFor is not a function`

- [ ] **Step 3: Write the modifiers**

Create `packages/sim-core/src/script.ts`:

```ts
import type { Side } from "./geometry.js"
import type { Params } from "./params.js"

/** What a scenario script can make happen (spec §5.1.7). */
export const EFFECTS = ["goal", "red_card", "press_surge", "keeper_heroics", "momentum_swing", "keeper_howler", "defensive_error"] as const
export type ScenarioEffect = (typeof EFFECTS)[number]

/**
 * One scripted effect for `team` between two match minutes. The team is the one the effect is about:
 * it scores (`goal`), has a player sent off (`red_card`), presses (`press_surge`), attacks (`momentum_swing`),
 * or its keeper or defenders shine or err (`keeper_heroics`, `keeper_howler`, `defensive_error`).
 * `count` is how many times it should happen in the window (goals; default 1).
 */
export interface ScriptEntry {
  readonly window: readonly [number, number]
  readonly team: Side
  readonly effect: ScenarioEffect
  readonly count?: number
}

export interface Script {
  readonly name: string
  readonly entries: ReadonlyArray<ScriptEntry>
}

/** Per-team multipliers and logit shifts at one moment of a match, from the script entries active then. */
export interface Mods {
  /** Added to the team's shot, cross and through-ball logits. */
  readonly shotLogit: number
  readonly attackLogit: number
  /** Multiplies the chance that the team's shots score. */
  readonly scoring: number
  /** Multiply the team's pressing and tackling rates. */
  readonly press: number
  readonly tackle: number
  /** Multiply the chance that the team's tackles are fouls, and that its fouls are red cards. */
  readonly foul: number
  readonly red: number
  /** Added to the team keeper's save logit; added to its share of fumbled saves. */
  readonly saveLogit: number
  readonly fumble: number
  /** Multiplies the mis-hit chance of the team's defenders (CB, FB, DM) in their own half. */
  readonly mishit: number
}

export const NO_MODS: Mods = { shotLogit: 0, attackLogit: 0, scoring: 1, press: 1, tackle: 1, foul: 1, red: 1, saveLogit: 0, fumble: 0, mishit: 1 }

/** The modifiers for `side` at `minute`: neutral without a script, outside every window, or for the other team. */
export const modsFor = (script: Script | undefined, side: Side, minute: number, p: Params): Mods => {
  if (!script) return NO_MODS
  const s = p.script
  let m = NO_MODS
  for (const e of script.entries) {
    if (e.team !== side || minute < e.window[0] || minute >= e.window[1]) continue
    switch (e.effect) {
      case "goal":
        m = { ...m, shotLogit: m.shotLogit + s.goalShotLogit, scoring: m.scoring * s.goalScoring }
        break
      case "momentum_swing":
        m = { ...m, shotLogit: m.shotLogit + s.momentumLogit, attackLogit: m.attackLogit + s.momentumLogit, press: m.press * s.momentumPress }
        break
      case "press_surge":
        m = { ...m, press: m.press * s.pressSurge, tackle: m.tackle * s.pressTackle }
        break
      case "red_card":
        m = { ...m, foul: m.foul * s.redFoul, red: m.red * s.redCard }
        break
      case "keeper_heroics":
        m = { ...m, saveLogit: m.saveLogit + s.heroicsSave }
        break
      case "keeper_howler":
        m = { ...m, saveLogit: m.saveLogit - s.howlerSave, fumble: m.fumble + s.howlerFumble }
        break
      case "defensive_error":
        m = { ...m, mishit: m.mishit * s.errorMishit }
        break
    }
  }
  return m
}
```

- [ ] **Step 4: Wire them into the engine**

Apply this change to `packages/sim-core/src/params.ts`, `packages/sim-core/src/types.ts`, `packages/sim-core/src/shot.ts`, `packages/sim-core/src/execute.ts`, `packages/sim-core/src/step.ts`, `packages/sim-core/src/index.ts` (from the repository root):

```bash
git apply <<'PATCH'
diff --git a/packages/sim-core/src/execute.ts b/packages/sim-core/src/execute.ts
index ceb1ce1..82beb36 100644
--- a/packages/sim-core/src/execute.ts
+++ b/packages/sim-core/src/execute.ts
@@ -18,6 +18,9 @@ export interface KickIntent {
   readonly weakFoot: boolean
   /** 0 fresh .. 1 exhausted (1 - energy); widens the error by execution.executionK. */
   readonly fatigue?: number
+  /** Multiplies the mis-hit chance (scenario scripts); `forceMishit` makes this kick a mis-hit. */
+  readonly mishitScale?: number
+  readonly forceMishit?: boolean
 }
 
 export interface Executed {
@@ -46,7 +49,7 @@ export const executeKick = (k: KickIntent, p: Params, rng: Rng): Executed => {
   const pMishit = Math.min(0.35, e.mishitBase + e.mishitK * Math.pow(k.pressure, 1.6) * (1.2 - k.composure) * (k.weakFoot ? 1.6 : 1))
   const g1 = rng.normal()
   const g2 = rng.normal()
-  const mishit = rng.chance(pMishit)
+  const mishit = rng.chance(Math.min(1, pMishit * (k.mishitScale ?? 1))) || k.forceMishit === true
   const g3 = rng.normal()
   const u = rng.uniform()
   let ang: number
diff --git a/packages/sim-core/src/index.ts b/packages/sim-core/src/index.ts
index 98193a3..9f4aef7 100644
--- a/packages/sim-core/src/index.ts
+++ b/packages/sim-core/src/index.ts
@@ -15,3 +15,4 @@ export * from "./types.js"
 export * from "./touch.js"
 export * from "./deflect.js"
 export * from "./gamestate.js"
+export * from "./script.js"
diff --git a/packages/sim-core/src/params.ts b/packages/sim-core/src/params.ts
index 4c40e58..2dd861d 100644
--- a/packages/sim-core/src/params.ts
+++ b/packages/sim-core/src/params.ts
@@ -173,6 +173,25 @@ export interface Params {
    * red-card factors for the team down to fewer players and for its opponent.
    */
   readonly gameState: { readonly minuteProfile: readonly [number, number, number, number, number, number]; readonly redCardOwn: number; readonly redCardOpponent: number }
+  /**
+   * Scenario-script nudges (see script.ts): logit shifts and multipliers applied to the scripted team inside an
+   * entry's window — goal: shot logit and scoring; momentum: attacking logits and pressing; press surge: pressing
+   * and tackling; red card: fouls and reds; keeper heroics or howler: save logit and fumbles; defensive error: mis-hits.
+   */
+  readonly script: {
+    readonly goalShotLogit: number
+    readonly goalScoring: number
+    readonly momentumLogit: number
+    readonly momentumPress: number
+    readonly pressSurge: number
+    readonly pressTackle: number
+    readonly redFoul: number
+    readonly redCard: number
+    readonly heroicsSave: number
+    readonly howlerSave: number
+    readonly howlerFumble: number
+    readonly errorMishit: number
+  }
   readonly substitutions: {
     readonly windowMinutes: readonly [number, number, number]
     readonly windowSdMin: number
@@ -280,6 +299,7 @@ export const DEFAULT_PARAMS: Params = {
   groundDuel: { bSkill: 3, bReach: 2, contestM: 0.6 },
   // Hand-set prior with more goals late (refit from Wyscout goal minutes when that data is available); red-card factors from the spec.
   gameState: { minuteProfile: [0.85, 0.95, 1.05, 0.95, 1.05, 1.15], redCardOwn: 0.67, redCardOpponent: 1.2 },
+  script: { goalShotLogit: 1.0, goalScoring: 1.6, momentumLogit: 1.0, momentumPress: 1.3, pressSurge: 4, pressTackle: 2, redFoul: 1.5, redCard: 40, heroicsSave: 1.5, howlerSave: 1.5, howlerFumble: 0.3, errorMishit: 8 },
   // About four changes per team on average (Bundesliga teams make roughly 4-4.5 of their 5).
   substitutions: { windowMinutes: [62, 72, 81], windowSdMin: 5, perWindow: [2, 2, 1], windowChance: [1, 0.8, 0.5], halfTimeChance: 0.2 },
   classifier: {
diff --git a/packages/sim-core/src/shot.ts b/packages/sim-core/src/shot.ts
index 11be7a4..90fe094 100644
--- a/packages/sim-core/src/shot.ts
+++ b/packages/sim-core/src/shot.ts
@@ -17,6 +17,20 @@ export interface ShotPlan {
   readonly blockerId: string | null
   readonly keeperId: string | null
   readonly handling: Handling | null
+  /** True when a scenario script forced this outcome. */
+  readonly forced?: boolean
+}
+
+/**
+ * Adjustments from the game state and scenario scripts: a multiplier on the chance of scoring, a shift of the
+ * keeper's save logit, an extra share of fumbled saves, and a forced outcome ("goal": this shot scores;
+ * "save" / "keeper_error": if this shot is on target, the keeper saves it / lets it in).
+ */
+export interface ShotMods {
+  readonly scoring?: number
+  readonly saveLogit?: number
+  readonly fumble?: number
+  readonly force?: "goal" | "save" | "keeper_error"
 }
 
 const segmentDistance = (a: Vec2, b: Vec2, q: Vec2): { d: number; t: number } => {
@@ -63,11 +77,11 @@ export interface ShotOnTarget {
  * Chance that the keeper saves an on-target shot: lower towards the posts (`bWide`) and near the bar or the
  * ground (`bEdge`), lower from close range (`bDistance` per 10 m beyond 16 m), higher for quick reflexes.
  */
-export const saveChance = (s: ShotOnTarget, keeper: PlayerState, p: Params): number => {
+export const saveChance = (s: ShotOnTarget, keeper: PlayerState, p: Params, logitShift = 0): number => {
   const c = p.shot.save
   const wide = Math.min(1, Math.abs(s.y) / PITCH.goalHalfWidth)
   const edge = Math.min(1, Math.abs(s.z / PITCH.goalHeight - 0.5) * 2)
-  return 1 / (1 + Math.exp(-(c.b0 + c.bWide * wide + c.bEdge * edge + (c.bDistance * (s.distance - 16)) / 10 + c.bReflexes * (keeper.attrs.reflexes - 0.6))))
+  return 1 / (1 + Math.exp(-(logitShift + c.b0 + c.bWide * wide + c.bEdge * edge + (c.bDistance * (s.distance - 16)) / 10 + c.bReflexes * (keeper.attrs.reflexes - 0.6))))
 }
 
 /**
@@ -87,9 +101,9 @@ export const planShot = (
   rng: Rng,
   /** Shooting with the weaker foot widens the aiming error by execution.weakFootK. */
   weakFoot = false,
-  /** Game-state multiplier on the chance of scoring (see scoringFactor); 1 leaves goals per shot tracking xG. */
-  scoring = 1
+  mods: ShotMods = {}
 ): ShotPlan => {
+  const scoring = mods.scoring ?? 1
   const goal = goalOf(side)
   const from: Vec3 = { x: shooter.pos.x, y: shooter.pos.y, z: 0.2 }
   const d = dist(shooter.pos, goal)
@@ -116,6 +130,12 @@ export const planShot = (
       z = 0
     }
   }
+  if (mods.force === "goal") {
+    // Scripted: a clean strike inside the frame that beats the keeper.
+    const fy = Math.max(-(PITCH.goalHalfWidth - 0.4), Math.min(PITCH.goalHalfWidth - 0.4, y))
+    const goalTo: Vec3 = { x: goal.x, y: fy, z: Math.min(z, PITCH.goalHeight - 0.4) }
+    return { outcome: "goal", ticks: Math.max(1, Math.ceil(d / p.shot.speed / dt)), from, to: goalTo, execution: "clean", onTarget: true, blockerId: null, keeperId: null, handling: null, forced: true }
+  }
   const to: Vec3 = { x: goal.x, y, z }
   const speed = execution === "scuffed" ? p.shot.speed * 0.5 : p.shot.speed
   const travel = (m: number) => Math.max(1, Math.ceil(m / speed / dt))
@@ -138,18 +158,23 @@ export const planShot = (
   const onTarget = Math.abs(y) < PITCH.goalHalfWidth && z < PITCH.goalHeight
   const keeper = opponents.find((o) => o.role === "GK" && !o.sentOff) ?? null
   if (!onTarget) return { outcome: "wide", ticks: travel(d), from, to, execution, onTarget, blockerId: null, keeperId: null, handling: null }
+  const saveAt: Vec3 = { x: goal.x - dirOf(side) * 0.8, y: Math.max(-3.5, Math.min(3.5, y)), z }
+  if (keeper && mods.force === "save")
+    return { outcome: "saved", ticks: travel(d), from, to: saveAt, execution, onTarget, blockerId: null, keeperId: keeper.id, handling: "clean", forced: true }
+  if (keeper && mods.force === "keeper_error")
+    return { outcome: "goal", ticks: travel(d), from, to, execution, onTarget, blockerId: null, keeperId: null, handling: null, forced: true }
   // Penalties keep their fixed conversion (scaled by how likely this aim was to be on target); every other
   // shot on target beats the keeper unless saved, by placement, distance and the keeper's reflexes (see saveChance).
   // Heights below 0 are clamped to the ground, so the vertical window is (-inf, crossbar).
   const pGoalClean = isPenalty
     ? Math.min(0.95, 0.76 / Math.max(0.05, normalBetween(-PITCH.goalHalfWidth, PITCH.goalHalfWidth, aimY, sdY) * normalBetween(-50, PITCH.goalHeight, aimZ, sdZ)))
-    : Math.min(0.95, (keeper ? 1 - saveChance({ y, z, distance: d }, keeper, p) : 1) * scoring)
+    : Math.min(0.95, (keeper ? 1 - saveChance({ y, z, distance: d }, keeper, p, mods.saveLogit ?? 0) : 1) * scoring)
   const pGoal = mis ? pGoalClean * 0.3 : pGoalClean
   if (rng.chance(pGoal) || keeper === null)
     return { outcome: "goal", ticks: travel(d), from, to, execution, onTarget, blockerId: null, keeperId: null, handling: null }
   const h = rng.uniform()
   const k = keeper.attrs.handling
-  const handling: Handling = h < 0.35 + 0.35 * k ? "clean" : h < 0.85 ? "parried_safe" : h < 0.97 ? "parried_dangerous" : "fumble"
-  const saveAt: Vec3 = { x: goal.x - dirOf(side) * 0.8, y: Math.max(-3.5, Math.min(3.5, y)), z }
+  const natural: Handling = h < 0.35 + 0.35 * k ? "clean" : h < 0.85 ? "parried_safe" : h < 0.97 ? "parried_dangerous" : "fumble"
+  const handling: Handling = (mods.fumble ?? 0) > 0 && rng.chance(mods.fumble!) ? "fumble" : natural
   return { outcome: "saved", ticks: travel(d), from, to: saveAt, execution, onTarget, blockerId: null, keeperId: keeper.id, handling }
 }
diff --git a/packages/sim-core/src/step.ts b/packages/sim-core/src/step.ts
index 3b1da4e..a05994a 100644
--- a/packages/sim-core/src/step.ts
+++ b/packages/sim-core/src/step.ts
@@ -26,7 +26,8 @@ import type { Action } from "./params.js"
 import { goalLineCrossing, keeperLetsRun, MAX_FLIGHT_S, resolveFlight } from "./resolve.js"
 import { hazard, Rng, substream } from "./rng.js"
 import { anchorFor, kickoffAnchor } from "./shape.js"
-import { parryBall, planShot } from "./shot.js"
+import { modsFor, type Mods, type ScenarioEffect, type ScriptEntry } from "./script.js"
+import { parryBall, planShot, type ShotMods } from "./shot.js"
 import { ballAfterTouch, drawFirstTouch, firstTouchError, type FirstTouch } from "./touch.js"
 import {
   CONCERNS,
@@ -132,6 +133,7 @@ export const initMatch = (cfg: MatchConfig): MatchState => {
     pressedBy: [],
     carry: null,
     subs,
+    forced: [],
     rng,
     eventSeq: 0
   }
@@ -157,6 +159,7 @@ class Work {
   pressedBy: string[]
   carry: MatchState["carry"]
   subs: Record<Side, SubsState>
+  forced: ScriptEntry[]
   rng: Record<Concern, Rng>
   seq: number
   events: DomainEvent[] = []
@@ -178,6 +181,7 @@ class Work {
     this.pressedBy = [...s.pressedBy]
     this.carry = s.carry
     this.subs = { ...s.subs }
+    this.forced = [...s.forced]
     this.rng = {} as Record<Concern, Rng>
     for (const c of CONCERNS) this.rng[c] = new Rng(s.rng[c])
     this.seq = s.eventSeq
@@ -234,6 +238,21 @@ class Work {
       attrs
     }
   }
+  /** Scenario-script modifiers for `side` now. */
+  mods(side: Side): Mods {
+    return modsFor(this.cfg.script, side, this.minute(), this.p)
+  }
+  /** Whether an outcome of `effect` is forced for `side`'s next qualifying action. */
+  hasForced(side: Side, effect: ScenarioEffect): boolean {
+    return this.forced.some((f) => f.team === side && f.effect === effect)
+  }
+  /** Use up one forced `effect` for `side`; true if there was one. */
+  takeForced(side: Side, effect: ScenarioEffect): boolean {
+    const i = this.forced.findIndex((f) => f.team === side && f.effect === effect)
+    if (i < 0) return false
+    this.forced.splice(i, 1)
+    return true
+  }
   decisionDelayTicks(): number {
     const t = this.p.timing
     return Math.max(1, Math.round(this.rng.decision.range(t.decisionMinS, t.decisionMaxS) / this.dt))
@@ -257,6 +276,7 @@ class Work {
       pressedBy: this.pressedBy,
       carry: this.carry,
       subs: this.subs,
+      forced: this.forced,
       rng: out,
       eventSeq: this.seq
     }
@@ -377,10 +397,11 @@ const foulAndCards = (w: Work, offender: PlayerState, victim: PlayerState): void
   w.emit(w.pending("foul", offender, offender.pos, { kind: "tackle", victim_id: victim.id }))
   const ref = w.rng.referee
   let card: "yellow" | "second_yellow" | "red" | null = null
-  if (ref.chance(w.p.defending.redPerFoul)) card = "red"
+  const forcedRed = w.takeForced(offender.side, "red_card")
+  if (forcedRed || ref.chance(Math.min(1, w.p.defending.redPerFoul * w.mods(offender.side).red))) card = "red"
   else if (ref.chance(w.p.defending.yellowPerFoul)) card = offender.yellow >= 1 ? "second_yellow" : "yellow"
   if (card) {
-    w.emit(w.pending("card", offender, offender.pos, { colour: card }))
+    w.emit(w.pending("card", offender, offender.pos, forcedRed ? { colour: card, scripted: true } : { colour: card }))
     w.setPlayer({ ...w.player(offender.id), yellow: offender.yellow + 1, sentOff: card !== "yellow" })
   }
   const inBox = attackX(victim.side, victim.pos.x) > PITCH.halfL - PITCH.boxDepth && Math.abs(victim.pos.y) < PITCH.boxHalfWidth
@@ -416,7 +437,7 @@ const duels = (w: Work, owner: PlayerState): boolean => {
   const def = nearestOpponent(owner.pos, opps)
   if (!def || dist(def.pos, owner.pos) > w.p.defending.tackleRadiusM) return false
   const style = teamOf(w.cfg, def.side).style
-  const rate = w.p.defending.tackleRatePerS * (0.5 + style.pressIntensity) * (1 + w.p.defending.boxIntensity * danger(def.side, owner.pos))
+  const rate = w.p.defending.tackleRatePerS * (0.5 + style.pressIntensity) * (1 + w.p.defending.boxIntensity * danger(def.side, owner.pos)) * w.mods(def.side).tackle
   if (!w.rng.duel.chance(hazard(rate, w.dt))) return false
   const pWin = 1 / (1 + Math.exp(-(w.p.defending.tackleBase + 3 * (def.attrs.tackling - owner.attrs.dribbling))))
   if (w.rng.duel.chance(pWin)) {
@@ -428,7 +449,7 @@ const duels = (w: Work, owner: PlayerState): boolean => {
     return true
   }
   const victimInBox = attackX(owner.side, owner.pos.x) > PITCH.halfL - PITCH.boxDepth && Math.abs(owner.pos.y) < PITCH.boxHalfWidth
-  if (w.rng.referee.chance(w.p.defending.foulPerTackle * (victimInBox ? w.p.defending.boxFoulFactor : 1))) {
+  if (w.rng.referee.chance(Math.min(1, w.p.defending.foulPerTackle * (victimInBox ? w.p.defending.boxFoulFactor : 1) * w.mods(def.side).foul)) || w.hasForced(def.side, "red_card")) {
     finishCarry(w, owner)
     w.emit(w.pending("tackle", def, def.pos, { outcome: "foul", opponent_id: owner.id }))
     foulAndCards(w, def, owner)
@@ -483,8 +504,14 @@ const releaseKick = (w: Work, owner: PlayerState, d: Decision, restart: RestartK
       : d.candidate!.target
   const height = isClear ? "high" : d.candidate!.height
   const weakFoot = w.rng.execution.chance(0.2)
+  // Scenario scripts: a defensive error raises (or forces) mis-hits by the team's defenders in their own half.
+  const errorProne = (owner.role === "CB" || owner.role === "FB" || owner.role === "DM") && attackX(side, owner.pos.x) < 0
+  const forceMishit = errorProne && !restart && w.takeForced(side, "defensive_error")
   const exe = executeKick(
-    { from: owner.pos, to: target, height, technique: technique(d.action, owner), composure: owner.attrs.composure, pressure: d.pressure, weakFoot, fatigue: 1 - owner.energy },
+    {
+      from: owner.pos, to: target, height, technique: technique(d.action, owner), composure: owner.attrs.composure, pressure: d.pressure, weakFoot,
+      fatigue: 1 - owner.energy, mishitScale: errorProne ? w.mods(side).mishit : 1, forceMishit
+    },
     p,
     w.rng.execution
   )
@@ -525,6 +552,7 @@ const releaseKick = (w: Work, owner: PlayerState, d: Decision, restart: RestartK
     intended_end_x: round2(target.x),
     intended_end_y: round2(target.y),
     execution: sliced ? "sliced" : exe.execution,
+    ...(forceMishit ? { scripted: true } : {}),
     error_m: round2(exe.errorM),
     decision_quality: d.decisionQuality === null ? null : round2(d.decisionQuality),
     ...decisionAttrs(d),
@@ -627,7 +655,20 @@ const releaseShot = (w: Work, owner: PlayerState, d: Decision, restart: RestartK
   // The recorded xG is the model's; the chance of scoring also follows the game state (minute, red cards).
   const scoring = isPenalty ? 1 : scoringFactor(w.minute(), w.active(side).length, opps.length, w.p, w.period)
   const weakFoot = !isPenalty && w.rng.execution.chance(0.2)
-  const plan = planShot(owner, side, opps, xg, d.pressure, isPenalty, w.p, w.dt, w.rng.execution, weakFoot, scoring)
+  // Scenario scripts: this team's scoring nudge; the defending keeper's save shift and fumbles; forced outcomes.
+  const own = w.mods(side), def = w.mods(other(side))
+  const force: ShotMods["force"] = w.takeForced(side, "goal")
+    ? "goal"
+    : w.hasForced(other(side), "keeper_heroics")
+      ? "save"
+      : w.hasForced(other(side), "keeper_howler")
+        ? "keeper_error"
+        : undefined
+  const mods: ShotMods = { scoring: scoring * (isPenalty ? 1 : own.scoring), saveLogit: def.saveLogit, fumble: def.fumble, ...(force ? { force } : {}) }
+  const plan = planShot(owner, side, opps, xg, d.pressure, isPenalty, w.p, w.dt, w.rng.execution, weakFoot, mods)
+  // A forced save or keeper error is used up only by a shot that reached the target.
+  if (plan.forced && force === "save") w.takeForced(other(side), "keeper_heroics")
+  if (plan.forced && force === "keeper_error") w.takeForced(other(side), "keeper_howler")
   const tickAt = w.tick + plan.ticks
   const at = (pe: PendingEvent): PendingEvent => ({ ...pe, frame_id: tickAt })
   const end = { x: plan.to.x, y: plan.to.y }
@@ -638,6 +679,7 @@ const releaseShot = (w: Work, owner: PlayerState, d: Decision, restart: RestartK
     execution: plan.execution,
     on_target: plan.onTarget,
     xg: Math.round(xg * 1000) / 1000,
+    ...(plan.forced ? { scripted: true } : {}),
     shot_speed_kmh: round2(w.p.shot.speed * 3.6 * (plan.execution === "scuffed" ? 0.5 : 1))
   }, end)
   const extra: PendingEvent[] = []
@@ -687,7 +729,12 @@ const releaseShot = (w: Work, owner: PlayerState, d: Decision, restart: RestartK
   w.lastTouch = { playerId: owner.id, side }
 }
 
-const scriptBias = (_w: Work, _side: Side): Partial<Record<Action, number>> => ({})
+/** Scenario-script logit shifts for the team on the ball (see script.ts). */
+const scriptBias = (w: Work, side: Side): Partial<Record<Action, number>> => {
+  const m = w.mods(side)
+  if (m.shotLogit === 0 && m.attackLogit === 0) return {}
+  return { shot: m.shotLogit, cross: m.attackLogit, through_ball: m.attackLogit, lofted_through: m.attackLogit, cutback: m.attackLogit }
+}
 
 const ownerDecision = (w: Work, owner: PlayerState): void => {
   const poss = w.possession
@@ -940,10 +987,13 @@ const moveTarget = (w: Work, pl: PlayerState, ballFlat: Vec2, possSide: Side | n
     if (pl.intent.kind === "press" && w.tick < pl.intentUntil && pl.intent.targetId === owner.id)
       return { target: interceptPoint(pl.pos, vmax, owner.pos, owner.vel), speedCap: vmax }
     const defenders = w.active(pl.side).filter((x) => x.role !== "GK").sort((a, b) => dist(a.pos, owner.pos) - dist(b.pos, owner.pos))
-    if (defenders[0]?.id === pl.id && dist(pl.pos, owner.pos) < 18) {
+    // The nearest defender presses; in a scripted press surge the two nearest do, from further away.
+    const surge = w.mods(pl.side).press > 1
+    const presser = surge ? defenders.slice(0, 2).some((x) => x.id === pl.id) : defenders[0]?.id === pl.id
+    if (presser && dist(pl.pos, owner.pos) < (surge ? 25 : 18)) {
       const style = team.style
       const urgency = 1 + w.p.defending.boxIntensity * danger(pl.side, owner.pos)
-      if (w.rng.movement.chance(hazard(w.p.defending.pressRatePerS * (0.4 + 1.2 * style.pressIntensity) * urgency, w.dt))) {
+      if (w.rng.movement.chance(hazard(w.p.defending.pressRatePerS * (0.4 + 1.2 * style.pressIntensity) * urgency * w.mods(pl.side).press, w.dt))) {
         w.setPlayer({ ...pl, intent: { kind: "press", targetId: owner.id }, intentUntil: w.tick + Math.round(w.rng.movement.range(2, 4) / w.dt) })
         return { target: interceptPoint(pl.pos, vmax, owner.pos, owner.vel), speedCap: vmax }
       }
diff --git a/packages/sim-core/src/types.ts b/packages/sim-core/src/types.ts
index c0650dc..e6773e1 100644
--- a/packages/sim-core/src/types.ts
+++ b/packages/sim-core/src/types.ts
@@ -1,6 +1,7 @@
 import type { Side, Vec2, Vec3 } from "./geometry.js"
 import type { Params } from "./params.js"
 import type { RngState } from "./rng.js"
+import type { Script, ScriptEntry } from "./script.js"
 
 export type Role = "GK" | "CB" | "FB" | "DM" | "CM" | "AM" | "W" | "ST"
 export type FormationName = "4-3-3" | "4-4-2" | "4-2-3-1" | "3-5-2"
@@ -70,6 +71,8 @@ export interface MatchConfig {
   readonly params: Params
   /** Seconds per tick; 0.1 for 10 Hz, 0.04 for 25 Hz render runs. */
   readonly dt: number
+  /** Scenario script whose nudges apply inside their windows (none when absent). */
+  readonly script?: Script
 }
 
 export type Intent =
@@ -307,6 +310,8 @@ export interface MatchState {
     readonly decision: Readonly<Record<string, AttrValue>>
   } | null
   readonly subs: Readonly<Record<Side, SubsState>>
+  /** Script entries whose outcome is forced on the team's next qualifying action (set by the scenario runner). */
+  readonly forced: ReadonlyArray<ScriptEntry>
   readonly rng: Readonly<Record<Concern, RngState>>
   readonly eventSeq: number
 }
PATCH
```

- [ ] **Step 5: Run the tests**

Run: `pnpm --filter @touchline/sim-core test scenario`
Expected: 13 passed

Run: `pnpm turbo run typecheck test --force`
Expected: `Tasks: 10 successful`; without a script, `pnpm sim --seed 1 --home ironmoor --away saltmarsh` writes the same `domain.jsonl` as before this task

- [ ] **Step 6: Commit**

```bash
git add packages/sim-core
git commit -m "feat(sim-core): scenario effects — nudges inside script windows and forced outcomes

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```



### Task 6: Scenario runner and six built-in scenarios

`runScript` plays a match under its script (spec §5.1.7) in three steps per window: nudge (Task 5), retry (if the window missed its target, re-play it from the checkpoint taken at its start, with fresh random sub-streams, up to `retries` times, default 5), and force as a last resort (one more play with the outcomes forced). States are immutable, so a checkpoint is just a reference; the whole thing is pure and deterministic. Entries sharing a window are one block; overlapping windows are refused (`ScriptError`). Targets: goals ≥ `count`; a red card; pressures per 100 opponent passes ≥ `script.pressTarget` (65; pressing per opponent pass does not depend on possession); at least 3 shots and twice the opponent's; 2 keeper saves; a keeper fumble or forced error; a defender's mis-hit in their own half. Goal nudges scale with the rate a window asks for and stop once its count is reached (the engine counts goals per entry), and they sharpen the team's finishing; a forced goal makes the team push forward and look for the shot. The six built-in scenarios reach their target without forcing in at least 9 of 10 seeds each (measured 19-20 of 20).

**Files:**
- Create: `packages/sim-core/src/runner.ts`, `packages/sim/src/scenarios.ts`
- Modify: `packages/sim-core/src/script.ts`, `packages/sim-core/src/step.ts`, `packages/sim-core/src/shot.ts`, `packages/sim-core/src/types.ts`, `packages/sim-core/src/params.ts`, `packages/sim-core/src/index.ts`, `packages/sim/src/index.ts`
- Test: `packages/sim-core/test/runner.test.ts`, `packages/sim/test/scenarios.test.ts`, `packages/sim-core/test/scenario.test.ts`

**Interfaces:**
- Consumes: Task 5's modifiers and forced outcomes.
- Produces: `class ScriptError`; `interface WindowResult {entries, achieved, attempts, forced, fromFrame, toFrame}`; `interface ScriptedRun {steps, windows}`; `runScript(cfg, {retries?})`; `entryAchieved(entry, events, cfg)`; `countGoal(script, goals, side, minute)`; `modsFor(…, goals?)`; `Mods.aim`; `ShotMods.aim?`; `MatchState.scriptGoals`; `params.script.{goalRatePerMin, goalScoringMax, goalAimMin, pressTarget, forcedShotLogit}`; `interface Scenario {script, description, home, away}`; `SCENARIOS` (even_contest, late_comeback, red_card_collapse, keeper_heroics, costly_error, high_press_vs_low_block).

- [ ] **Step 1: Write the failing tests**

Create `packages/sim-core/test/runner.test.ts`:

```ts
import { createHash } from "node:crypto"
import { readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "vitest"
import { initMatch, isFinished, paramsFromJson, runScript, ScriptError, step, type MatchConfig, type Script } from "../src/index.js"
import { makeConfig } from "../src/testing.js"

const root = join(dirname(fileURLToPath(import.meta.url)), "../../..")
const params = paramsFromJson(JSON.parse(readFileSync(join(root, "data/params/touchline-params.json"), "utf8")))
const hash = (x: unknown) => createHash("sha256").update(JSON.stringify(x)).digest("hex")
const plain = (cfg: MatchConfig) => {
  let s = initMatch(cfg)
  const out = []
  while (!isFinished(s)) { const r = step(s); s = r.state; out.push(r) }
  return out
}

describe("scenario runner", () => {
  it("without a script plays exactly the plain match", () => {
    const cfg = makeConfig(5, { params })
    expect(hash(runScript(cfg).steps.map((r) => [r.frame, r.events]))).toBe(hash(plain(cfg).map((r) => [r.frame, r.events])))
  })
  it("is deterministic", () => {
    const script: Script = { name: "t", entries: [{ window: [20, 40], team: "home", effect: "goal" }] }
    const cfg = makeConfig(6, { params, script })
    expect(hash(runScript(cfg).steps.map((r) => r.events))).toBe(hash(runScript(cfg).steps.map((r) => r.events)))
  })
  it("plays every frame exactly once, in order, from kickoff to full time", () => {
    const script: Script = { name: "t", entries: [{ window: [20, 40], team: "home", effect: "goal", count: 2 }] }
    const run = runScript(makeConfig(7, { params, script }))
    const ticks = run.steps.filter((r) => r.frame).map((r) => r.frame!.tick)
    expect(ticks.every((t, i) => i === 0 || t === ticks[i - 1]! + 1)).toBe(true)
    expect(run.steps.at(-1)!.events.at(-1)!.type).toBe("match_end")
  })
  it("retries a window that missed its target, then forces it; forced events are marked scripted", () => {
    // Five goals in fifteen minutes almost never happens on its own.
    const script: Script = { name: "t", entries: [{ window: [30, 45], team: "home", effect: "goal", count: 5 }] }
    const run = runScript(makeConfig(8, { params, script }), { retries: 2 })
    const w = run.windows[0]!
    expect(w.attempts).toBe(4)
    expect(w.forced).toBe(true)
    const scripted = run.steps.flatMap((r) => r.events).filter((e) => e.attrs.scripted === true)
    expect(scripted.length).toBeGreaterThan(0)
    expect(scripted.every((e) => e.type === "shot" && e.outcome === "goal")).toBe(true)
  })
  it("records what happened in each window", () => {
    const script: Script = { name: "t", entries: [{ window: [50, 60], team: "away", effect: "red_card" }] }
    const run = runScript(makeConfig(9, { params, script }))
    const w = run.windows[0]!
    expect(w.entries).toEqual(script.entries)
    expect(w.fromFrame).toBeLessThan(w.toFrame)
    expect(typeof w.achieved).toBe("boolean")
    const reds = run.steps.flatMap((r) => r.events).filter((e) => e.type === "card" && e.attrs.colour !== "yellow" && e.team_id === "away-fc")
    expect(w.achieved).toBe(reds.some((e) => e.frame_id >= w.fromFrame && e.frame_id <= w.toFrame))
  })
  it("refuses overlapping windows", () => {
    const script: Script = { name: "t", entries: [{ window: [20, 40], team: "home", effect: "goal" }, { window: [30, 50], team: "away", effect: "goal" }] }
    expect(() => runScript(makeConfig(1, { params, script }))).toThrow(ScriptError)
  })
})
```

Create `packages/sim/test/scenarios.test.ts`:

```ts
import { readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "vitest"
import type { League } from "@touchline/league"
import { paramsFromJson, runScript } from "@touchline/sim-core"
import { SCENARIOS } from "../src/scenarios.js"

const root = join(dirname(fileURLToPath(import.meta.url)), "../../..")
const league = JSON.parse(readFileSync(join(root, "data/league/league.json"), "utf8")) as League
const params = paramsFromJson(JSON.parse(readFileSync(join(root, "data/params/touchline-params.json"), "utf8")))
const club = (id: string) => league.clubs.find((c) => c.id === id)!

describe("built-in scenarios", () => {
  it("use clubs of the league and windows in match order", () => {
    for (const [name, sc] of Object.entries(SCENARIOS)) {
      expect(sc.script.name).toBe(name)
      expect(club(sc.home), name).toBeDefined()
      expect(club(sc.away), name).toBeDefined()
      for (const e of sc.script.entries) expect(e.window[0], name).toBeLessThan(e.window[1])
    }
  })
  // Spec §5.1.1: scripts achieve their target in at least 90 % of seeds without forcing an outcome.
  for (const [name, sc] of Object.entries(SCENARIOS)) {
    if (sc.script.entries.length === 0) continue
    it(`${name} reaches its target without forcing in at least 9 of 10 seeds`, () => {
      let unforced = 0
      for (let seed = 1; seed <= 10; seed++) {
        const run = runScript({ matchId: name, seed, kickoffTime: "2026-10-18T14:00:00.000Z", home: club(sc.home), away: club(sc.away), params, dt: 0.1, script: sc.script })
        if (run.windows.every((w) => w.achieved && !w.forced)) unforced++
      }
      expect(unforced).toBeGreaterThanOrEqual(9)
    })
  }
})
```

Apply this change to `packages/sim-core/test/scenario.test.ts` (from the repository root):

```bash
git apply <<'PATCH'
diff --git a/packages/sim-core/test/scenario.test.ts b/packages/sim-core/test/scenario.test.ts
index b58992d..46916be 100644
--- a/packages/sim-core/test/scenario.test.ts
+++ b/packages/sim-core/test/scenario.test.ts
@@ -29,6 +29,11 @@ describe("scenario modifiers", () => {
     expect(modsFor(s, "away", 65, params)).toEqual(neutral)
     expect(modsFor(s, "home", 65, params).press).toBeGreaterThan(1)
   })
+  it("a goal entry stops nudging once its count is reached", () => {
+    const s: Script = { name: "g", entries: [{ window: [0, 95], team: "home", effect: "goal", count: 2 }] }
+    expect(modsFor(s, "home", 30, params, [1]).shotLogit).toBeGreaterThan(0)
+    expect(modsFor(s, "home", 30, params, [2])).toEqual(modsFor(undefined, "home", 30, params))
+  })
   it("change nothing before the first window opens", () => {
     const plain = play(cfgFor(3)).filter((e) => minuteOf(e) < 60)
     const scripted = play(cfgFor(3, one("goal", [60, 90]))).filter((e) => minuteOf(e) < 60)
@@ -44,7 +49,8 @@ describe("nudges raise the scripted outcome's rate", () => {
   })
   it("goal: the team scores more", () => {
     const f = (e: DomainEvent) => e.type === "goal" && e.team_id === HOME
-    expect(count(one("goal"), f)).toBeGreaterThan(count(undefined, f) + 4)
+    const three: Script = { name: "goal", entries: [{ window: [0, 95], team: "home", effect: "goal", count: 3 }] }
+    expect(count(three, f)).toBeGreaterThan(count(undefined, f) + 4)
   })
   it("momentum swing: the team shoots more", () => {
     const f = (e: DomainEvent) => e.type === "shot" && e.team_id === HOME
PATCH
```

- [ ] **Step 2: Run them to make sure they fail**

Run: `pnpm --filter @touchline/sim-core test runner`
Expected: failures with `TypeError: runScript is not a function`

Run: `pnpm --filter @touchline/sim test scenarios`
Expected: fails: `Cannot find module '../src/scenarios.js'`

- [ ] **Step 3: Write the runner and the scenarios**

Create `packages/sim-core/src/runner.ts`:

```ts
import type { Side } from "./geometry.js"
import { substream } from "./rng.js"
import type { ScriptEntry } from "./script.js"
import { initMatch, isFinished, step } from "./step.js"
import { CONCERNS, type DomainEvent, type MatchConfig, type MatchState, type Role, type StepResult } from "./types.js"

/** A script the runner cannot play (overlapping windows). */
export class ScriptError extends Error {}

/** What happened in one scripted window (entries sharing the same window are played as one block). */
export interface WindowResult {
  readonly entries: ReadonlyArray<ScriptEntry>
  /** Whether every entry's target was met. */
  readonly achieved: boolean
  /** Plays of the window: 1 when the first try met the target; retries + 2 when it had to be forced. */
  readonly attempts: number
  /** Whether the last play forced the outcome (the forced events carry `scripted: true`). */
  readonly forced: boolean
  /** Global ticks of the window's first and last frame. */
  readonly fromFrame: number
  readonly toFrame: number
}

export interface ScriptedRun {
  /** Every step of the accepted match, kickoff to full time, as from step(). */
  readonly steps: ReadonlyArray<StepResult>
  readonly windows: ReadonlyArray<WindowResult>
}

export interface RunOptions {
  /** Re-plays of a window with fresh random sub-streams before forcing (default 5). */
  readonly retries?: number
}

const minuteOf = (s: MatchState): number => (s.period === "first_half" ? 0 : 45) + (Math.max(0, s.periodTick) * s.config.dt) / 60

/** Fresh random sub-streams for every concern, distinct per window and attempt (so a retry plays differently). */
const reseed = (s: MatchState, windowIndex: number, attempt: number): MatchState => {
  const rng = {} as Record<(typeof CONCERNS)[number], MatchState["rng"][(typeof CONCERNS)[number]]>
  for (const c of CONCERNS) rng[c] = substream(s.config.seed, `${c}:retry`, windowIndex * 64 + attempt)
  return { ...s, rng }
}

const rolesOf = (cfg: MatchConfig): Map<string, Role> =>
  new Map([cfg.home, cfg.away].flatMap((t) => [...t.starters, ...(t.bench ?? [])].map((p) => [p.id, p.role] as const)))

/** Whether one entry's target was met by the events of its window. */
export const entryAchieved = (entry: ScriptEntry, events: ReadonlyArray<DomainEvent>, cfg: MatchConfig): boolean => {
  const teamOf = (side: Side) => (side === "home" ? cfg.home.id : cfg.away.id)
  const team = teamOf(entry.team)
  const opp = teamOf(entry.team === "home" ? "away" : "home")
  const n = (f: (e: DomainEvent) => boolean) => events.filter(f).length
  switch (entry.effect) {
    case "goal":
      return n((e) => e.type === "goal" && e.team_id === team) >= (entry.count ?? 1)
    case "red_card":
      return n((e) => e.type === "card" && e.attrs.colour !== "yellow" && e.team_id === team) >= 1
    case "press_surge": {
      // Pressures per 100 opponent passes, so the measure does not depend on who has the ball more.
      const own = n((e) => e.type === "pressure" && e.team_id === team)
      return own >= 5 && (100 * own) / Math.max(1, n((e) => e.type === "pass" && e.team_id === opp)) >= cfg.params.script.pressTarget
    }
    case "momentum_swing": {
      const own = n((e) => e.type === "shot" && e.team_id === team)
      return own >= 3 && own >= 2 * n((e) => e.type === "shot" && e.team_id === opp)
    }
    case "keeper_heroics":
      return n((e) => e.type === "keeper_save" && e.team_id === team) >= 2
    case "keeper_howler":
      return (
        n((e) => e.type === "keeper_save" && e.team_id === team && (e.attrs.handling === "fumble" || e.attrs.handling === "parried_dangerous")) >= 1 ||
        n((e) => e.type === "shot" && e.team_id === opp && e.attrs.scripted === true) >= 1
      )
    case "defensive_error": {
      const roles = rolesOf(cfg)
      const attack = entry.team === "home" ? 1 : -1
      return n((e) => e.type === "pass" && e.team_id === team && e.attrs.execution === "mishit" && ["CB", "FB", "DM"].includes(roles.get(e.player_id ?? "") ?? "") && (e.x ?? 0) * attack < 0) >= 1
    }
  }
}

/** Entries grouped by identical window, in window order; overlapping windows are refused. */
const groups = (entries: ReadonlyArray<ScriptEntry>): ScriptEntry[][] => {
  const byWindow = new Map<string, ScriptEntry[]>()
  for (const e of entries) {
    const k = `${e.window[0]}-${e.window[1]}`
    byWindow.set(k, [...(byWindow.get(k) ?? []), e])
  }
  const out = [...byWindow.values()].sort((a, b) => a[0]!.window[0] - b[0]!.window[0])
  for (let i = 1; i < out.length; i++)
    if (out[i]![0]!.window[0] < out[i - 1]![0]!.window[1]) throw new ScriptError(`script windows overlap: ${JSON.stringify(out[i - 1]![0]!.window)} and ${JSON.stringify(out[i]![0]!.window)}`)
  return out
}

/** Forced outcomes for a block: one per goal wanted, one per other forceable effect (pressing and momentum cannot be forced). */
const forcesFor = (block: ReadonlyArray<ScriptEntry>): ScriptEntry[] =>
  block.flatMap((e) => (e.effect === "press_surge" || e.effect === "momentum_swing" ? [] : Array.from({ length: e.effect === "goal" ? (e.count ?? 1) : 1 }, () => e)))

/**
 * Play a match under its scenario script (spec §5.1.7): nudge (the engine applies the script's modifiers inside
 * each window), retry (re-play a window that missed its target from a checkpoint, with fresh sub-seeds, up to
 * `retries` times), and force as a last resort (re-play once more with the outcomes forced on the next qualifying
 * actions). Pure and deterministic: the same config always gives the same match.
 */
export const runScript = (cfg: MatchConfig, opts: RunOptions = {}): ScriptedRun => {
  const retries = opts.retries ?? 5
  const blocks = groups(cfg.script?.entries ?? [])
  const steps: StepResult[] = []
  const windows: WindowResult[] = []
  let s = initMatch(cfg)
  const advance = (until: (st: MatchState) => boolean) => {
    while (!isFinished(s) && !until(s)) {
      const r = step(s)
      s = r.state
      steps.push(r)
    }
  }
  blocks.forEach((block, bi) => {
    const [start, end] = block[0]!.window
    advance((st) => minuteOf(st) >= start)
    if (isFinished(s)) return
    const checkpoint = s
    for (let attempt = 0; attempt <= retries + 1; attempt++) {
      const forcing = attempt === retries + 1
      let t = attempt === 0 ? checkpoint : reseed(checkpoint, bi, attempt)
      if (forcing) t = { ...t, forced: forcesFor(block) }
      const buffer: StepResult[] = []
      while (!isFinished(t) && minuteOf(t) < end) {
        const r = step(t)
        t = r.state
        buffer.push(r)
      }
      const events = buffer.flatMap((r) => r.events)
      const achieved = block.every((e) => entryAchieved(e, events, cfg))
      if (achieved || forcing) {
        steps.push(...buffer)
        s = { ...t, forced: [] }
        const frames = buffer.filter((r) => r.frame)
        windows.push({ entries: block, achieved, attempts: attempt + 1, forced: forcing, fromFrame: frames[0]?.frame!.tick ?? checkpoint.tick, toFrame: frames.at(-1)?.frame!.tick ?? checkpoint.tick })
        return
      }
    }
  })
  advance(() => false)
  return { steps, windows }
}
```

Create `packages/sim/src/scenarios.ts`:

```ts
import type { Script } from "@touchline/sim-core"

/** A built-in scenario: its script, a description, and the fixture it is designed for. */
export interface Scenario {
  readonly script: Script
  readonly description: string
  readonly home: string
  readonly away: string
}

/** The built-in scenarios (spec §5.1.7). Windows are match minutes; the second half's window runs to 95 to include added time. */
export const SCENARIOS: Readonly<Record<string, Scenario>> = {
  even_contest: {
    description: "No script: a plain match between two balanced sides",
    home: "kestrel-bay",
    away: "eastvale",
    script: { name: "even_contest", entries: [] }
  },
  late_comeback: {
    description: "The away side lead 2-0 by 70', then the home side score three times",
    home: "eastvale",
    away: "ironmoor",
    script: {
      name: "late_comeback",
      entries: [
        { window: [0, 70], team: "away", effect: "goal", count: 2 },
        { window: [70, 95], team: "home", effect: "goal", count: 3 }
      ]
    }
  },
  red_card_collapse: {
    description: "A home player is sent off between 50' and 60'; the away side then score twice",
    home: "harrowmere",
    away: "corrin-forge",
    script: {
      name: "red_card_collapse",
      entries: [
        { window: [50, 60], team: "home", effect: "red_card" },
        { window: [60, 95], team: "away", effect: "goal", count: 2 }
      ]
    }
  },
  keeper_heroics: {
    description: "The home keeper makes a string of saves between 55' and 85'",
    home: "saltmarsh",
    away: "ironmoor",
    script: { name: "keeper_heroics", entries: [{ window: [55, 85], team: "home", effect: "keeper_heroics" }] }
  },
  costly_error: {
    description: "A home defender mis-hits a pass under pressure between 60' and 75', and the away side score",
    home: "northwick",
    away: "larkspur",
    script: {
      name: "costly_error",
      entries: [
        { window: [60, 75], team: "home", effect: "defensive_error" },
        { window: [60, 75], team: "away", effect: "goal" }
      ]
    }
  },
  high_press_vs_low_block: {
    description: "A high-pressing side surges against a low block for the whole match",
    home: "corrin-forge",
    away: "northwick",
    script: { name: "high_press_vs_low_block", entries: [{ window: [0, 95], team: "home", effect: "press_surge" }] }
  }
}
```

- [ ] **Step 4: Goal progress, scaled goal nudges and sharper finishing**

Apply this change to `packages/sim-core/src/script.ts`, `packages/sim-core/src/step.ts`, `packages/sim-core/src/shot.ts`, `packages/sim-core/src/types.ts`, `packages/sim-core/src/params.ts`, `packages/sim-core/src/index.ts`, `packages/sim/src/index.ts` (from the repository root):

```bash
git apply <<'PATCH'
diff --git a/packages/sim-core/src/index.ts b/packages/sim-core/src/index.ts
index 9f4aef7..b364096 100644
--- a/packages/sim-core/src/index.ts
+++ b/packages/sim-core/src/index.ts
@@ -16,3 +16,4 @@ export * from "./touch.js"
 export * from "./deflect.js"
 export * from "./gamestate.js"
 export * from "./script.js"
+export * from "./runner.js"
diff --git a/packages/sim-core/src/params.ts b/packages/sim-core/src/params.ts
index 2dd861d..2cd0dec 100644
--- a/packages/sim-core/src/params.ts
+++ b/packages/sim-core/src/params.ts
@@ -181,6 +181,13 @@ export interface Params {
   readonly script: {
     readonly goalShotLogit: number
     readonly goalScoring: number
+    /** A team's normal goals per minute, and the cap on the scoring multiplier, for scaling goal nudges. */
+    readonly goalRatePerMin: number
+    readonly goalScoringMax: number
+    /** Lowest multiplier a goal nudge applies to the team's shooting error. */
+    readonly goalAimMin: number
+    /** A press surge counts as achieved at this many pressures per 100 opponent passes in its window. */
+    readonly pressTarget: number
     readonly momentumLogit: number
     readonly momentumPress: number
     readonly pressSurge: number
@@ -191,6 +198,8 @@ export interface Params {
     readonly howlerSave: number
     readonly howlerFumble: number
     readonly errorMishit: number
+    /** Added to the shot logit (half of it to attacking passes) while a forced goal is pending, so the forced outcome gets its qualifying action. */
+    readonly forcedShotLogit: number
   }
   readonly substitutions: {
     readonly windowMinutes: readonly [number, number, number]
@@ -299,7 +308,10 @@ export const DEFAULT_PARAMS: Params = {
   groundDuel: { bSkill: 3, bReach: 2, contestM: 0.6 },
   // Hand-set prior with more goals late (refit from Wyscout goal minutes when that data is available); red-card factors from the spec.
   gameState: { minuteProfile: [0.85, 0.95, 1.05, 0.95, 1.05, 1.15], redCardOwn: 0.67, redCardOpponent: 1.2 },
-  script: { goalShotLogit: 1.0, goalScoring: 1.6, momentumLogit: 1.0, momentumPress: 1.3, pressSurge: 4, pressTackle: 2, redFoul: 1.5, redCard: 40, heroicsSave: 1.5, howlerSave: 1.5, howlerFumble: 0.3, errorMishit: 8 },
+  script: {
+    goalShotLogit: 1.0, goalScoring: 2.0, goalRatePerMin: 0.016, goalScoringMax: 6, goalAimMin: 0.6, pressTarget: 65,
+    momentumLogit: 1.0, momentumPress: 1.3, pressSurge: 4, pressTackle: 2, redFoul: 2, redCard: 125, heroicsSave: 1.5, howlerSave: 1.5, howlerFumble: 0.3, errorMishit: 8, forcedShotLogit: 3
+  },
   // About four changes per team on average (Bundesliga teams make roughly 4-4.5 of their 5).
   substitutions: { windowMinutes: [62, 72, 81], windowSdMin: 5, perWindow: [2, 2, 1], windowChance: [1, 0.8, 0.5], halfTimeChance: 0.2 },
   classifier: {
diff --git a/packages/sim-core/src/script.ts b/packages/sim-core/src/script.ts
index 4b8bc4c..e1740c0 100644
--- a/packages/sim-core/src/script.ts
+++ b/packages/sim-core/src/script.ts
@@ -41,21 +41,38 @@ export interface Mods {
   readonly fumble: number
   /** Multiplies the mis-hit chance of the team's defenders (CB, FB, DM) in their own half. */
   readonly mishit: number
+  /** Multiplies the team's shooting error (below 1: sharper finishing). */
+  readonly aim: number
 }
 
-export const NO_MODS: Mods = { shotLogit: 0, attackLogit: 0, scoring: 1, press: 1, tackle: 1, foul: 1, red: 1, saveLogit: 0, fumble: 0, mishit: 1 }
+export const NO_MODS: Mods = { shotLogit: 0, attackLogit: 0, scoring: 1, press: 1, tackle: 1, foul: 1, red: 1, saveLogit: 0, fumble: 0, mishit: 1, aim: 1 }
 
-/** The modifiers for `side` at `minute`: neutral without a script, outside every window, or for the other team. */
-export const modsFor = (script: Script | undefined, side: Side, minute: number, p: Params): Mods => {
+/**
+ * The modifiers for `side` at `minute`: neutral without a script, outside every window, or for the other team.
+ * `goals[i]` counts the goals scored so far in entry i's window; a goal entry stops nudging once its count is reached.
+ */
+export const modsFor = (script: Script | undefined, side: Side, minute: number, p: Params, goals: ReadonlyArray<number> = []): Mods => {
   if (!script) return NO_MODS
   const s = p.script
   let m = NO_MODS
-  for (const e of script.entries) {
-    if (e.team !== side || minute < e.window[0] || minute >= e.window[1]) continue
+  script.entries.forEach((e, i) => {
+    if (e.team !== side || minute < e.window[0] || minute >= e.window[1]) return
     switch (e.effect) {
-      case "goal":
-        m = { ...m, shotLogit: m.shotLogit + s.goalShotLogit, scoring: m.scoring * s.goalScoring }
+      case "goal": {
+        if ((goals[i] ?? 0) >= (e.count ?? 1)) return
+        // The nudge grows with the scoring rate the window asks for (r = 1 for about a normal rate); a team
+        // chasing goals also plays forward more (half the shot shift on crosses and through balls).
+        const r = Math.max(1, (e.count ?? 1) / Math.max(1, e.window[1] - e.window[0]) / s.goalRatePerMin)
+        const shift = s.goalShotLogit * Math.log2(1 + r)
+        m = {
+          ...m,
+          shotLogit: m.shotLogit + shift,
+          attackLogit: m.attackLogit + shift / 2,
+          scoring: m.scoring * Math.min(s.goalScoringMax, s.goalScoring * Math.pow(r, 0.75)),
+          aim: m.aim * Math.max(s.goalAimMin, 1 / Math.sqrt(r))
+        }
         break
+      }
       case "momentum_swing":
         m = { ...m, shotLogit: m.shotLogit + s.momentumLogit, attackLogit: m.attackLogit + s.momentumLogit, press: m.press * s.momentumPress }
         break
@@ -75,6 +92,10 @@ export const modsFor = (script: Script | undefined, side: Side, minute: number,
         m = { ...m, mishit: m.mishit * s.errorMishit }
         break
     }
-  }
+  })
   return m
 }
+
+/** Count a goal for `side` at `minute` against every goal entry for that side whose window contains it. */
+export const countGoal = (script: Script | undefined, goals: ReadonlyArray<number>, side: Side, minute: number): number[] =>
+  (script?.entries ?? []).map((e, i) => (goals[i] ?? 0) + (e.effect === "goal" && e.team === side && minute >= e.window[0] && minute < e.window[1] ? 1 : 0))
diff --git a/packages/sim-core/src/shot.ts b/packages/sim-core/src/shot.ts
index 90fe094..c3612bf 100644
--- a/packages/sim-core/src/shot.ts
+++ b/packages/sim-core/src/shot.ts
@@ -31,6 +31,8 @@ export interface ShotMods {
   readonly saveLogit?: number
   readonly fumble?: number
   readonly force?: "goal" | "save" | "keeper_error"
+  /** Multiplies the shooting error (scenario goal nudges sharpen finishing). */
+  readonly aim?: number
 }
 
 const segmentDistance = (a: Vec2, b: Vec2, q: Vec2): { d: number; t: number } => {
@@ -110,8 +112,9 @@ export const planShot = (
   const skill = (1.35 - 0.7 * shooter.attrs.finishing) * (weakFoot ? p.execution.weakFootK : 1)
   const aimY = rng.range(-2.9, 2.9)
   const aimZ = rng.range(0.3, 1.8)
-  const sdY = (isPenalty ? 1.0 : 1.6 + 0.12 * d) * (1 + 0.8 * pressure) * skill * p.shot.aimNoise
-  const sdZ = (0.6 + 0.05 * d) * (1 + 0.5 * pressure) * skill * p.shot.aimNoise
+  const aim = p.shot.aimNoise * (mods.aim ?? 1)
+  const sdY = (isPenalty ? 1.0 : 1.6 + 0.12 * d) * (1 + 0.8 * pressure) * skill * aim
+  const sdZ = (0.6 + 0.05 * d) * (1 + 0.5 * pressure) * skill * aim
   const pMis = Math.min(0.4, p.execution.mishitBase * 2 + p.execution.mishitK * Math.pow(pressure, 1.6) * (1.2 - shooter.attrs.composure))
   const mis = rng.chance(pMis)
   const misKind = rng.uniform()
diff --git a/packages/sim-core/src/step.ts b/packages/sim-core/src/step.ts
index a05994a..79f1376 100644
--- a/packages/sim-core/src/step.ts
+++ b/packages/sim-core/src/step.ts
@@ -26,7 +26,7 @@ import type { Action } from "./params.js"
 import { goalLineCrossing, keeperLetsRun, MAX_FLIGHT_S, resolveFlight } from "./resolve.js"
 import { hazard, Rng, substream } from "./rng.js"
 import { anchorFor, kickoffAnchor } from "./shape.js"
-import { modsFor, type Mods, type ScenarioEffect, type ScriptEntry } from "./script.js"
+import { countGoal, modsFor, type Mods, type ScenarioEffect, type ScriptEntry } from "./script.js"
 import { parryBall, planShot, type ShotMods } from "./shot.js"
 import { ballAfterTouch, drawFirstTouch, firstTouchError, type FirstTouch } from "./touch.js"
 import {
@@ -134,6 +134,7 @@ export const initMatch = (cfg: MatchConfig): MatchState => {
     carry: null,
     subs,
     forced: [],
+    scriptGoals: (cfg.script?.entries ?? []).map(() => 0),
     rng,
     eventSeq: 0
   }
@@ -160,6 +161,7 @@ class Work {
   carry: MatchState["carry"]
   subs: Record<Side, SubsState>
   forced: ScriptEntry[]
+  scriptGoals: number[]
   rng: Record<Concern, Rng>
   seq: number
   events: DomainEvent[] = []
@@ -182,6 +184,7 @@ class Work {
     this.carry = s.carry
     this.subs = { ...s.subs }
     this.forced = [...s.forced]
+    this.scriptGoals = [...s.scriptGoals]
     this.rng = {} as Record<Concern, Rng>
     for (const c of CONCERNS) this.rng[c] = new Rng(s.rng[c])
     this.seq = s.eventSeq
@@ -240,7 +243,12 @@ class Work {
   }
   /** Scenario-script modifiers for `side` now. */
   mods(side: Side): Mods {
-    return modsFor(this.cfg.script, side, this.minute(), this.p)
+    return modsFor(this.cfg.script, side, this.minute(), this.p, this.scriptGoals)
+  }
+  /** A goal for `side`: the score, and the script's goal progress. */
+  addGoal(side: Side): void {
+    this.score[side] += 1
+    if (this.cfg.script) this.scriptGoals = countGoal(this.cfg.script, this.scriptGoals, side, this.minute())
   }
   /** Whether an outcome of `effect` is forced for `side`'s next qualifying action. */
   hasForced(side: Side, effect: ScenarioEffect): boolean {
@@ -277,6 +285,7 @@ class Work {
       carry: this.carry,
       subs: this.subs,
       forced: this.forced,
+      scriptGoals: this.scriptGoals,
       rng: out,
       eventSeq: this.seq
     }
@@ -664,7 +673,7 @@ const releaseShot = (w: Work, owner: PlayerState, d: Decision, restart: RestartK
       : w.hasForced(other(side), "keeper_howler")
         ? "keeper_error"
         : undefined
-  const mods: ShotMods = { scoring: scoring * (isPenalty ? 1 : own.scoring), saveLogit: def.saveLogit, fumble: def.fumble, ...(force ? { force } : {}) }
+  const mods: ShotMods = { scoring: scoring * (isPenalty ? 1 : own.scoring), saveLogit: def.saveLogit, fumble: def.fumble, aim: isPenalty ? 1 : own.aim, ...(force ? { force } : {}) }
   const plan = planShot(owner, side, opps, xg, d.pressure, isPenalty, w.p, w.dt, w.rng.execution, weakFoot, mods)
   // A forced save or keeper error is used up only by a shot that reached the target.
   if (plan.forced && force === "save") w.takeForced(other(side), "keeper_heroics")
@@ -732,8 +741,12 @@ const releaseShot = (w: Work, owner: PlayerState, d: Decision, restart: RestartK
 /** Scenario-script logit shifts for the team on the ball (see script.ts). */
 const scriptBias = (w: Work, side: Side): Partial<Record<Action, number>> => {
   const m = w.mods(side)
-  if (m.shotLogit === 0 && m.attackLogit === 0) return {}
-  return { shot: m.shotLogit, cross: m.attackLogit, through_ball: m.attackLogit, lofted_through: m.attackLogit, cutback: m.attackLogit }
+  // While a goal is forced, the team pushes forward and looks for the shot that will carry it.
+  const forcing = w.hasForced(side, "goal") ? w.p.script.forcedShotLogit : 0
+  const shot = m.shotLogit + forcing
+  const attack = m.attackLogit + forcing / 2
+  if (shot === 0 && attack === 0) return {}
+  return { shot, cross: attack, through_ball: attack, lofted_through: attack, cutback: attack }
 }
 
 const ownerDecision = (w: Work, owner: PlayerState): void => {
@@ -829,7 +842,7 @@ const resolveFlightNow = (w: Work, f: Flight): void => {
     w.emit({ ...e, attrs: { ...e.attrs, first_touch: touch, under_pressure: pressure > 0.3, lost_possession: touch !== "controlled" } })
   }
   const goal = f.extra.find((e) => e.type === "goal")
-  if (goal) w.score[goal.team_id === w.teamId("home") ? "home" : "away"] += 1
+  if (goal) w.addGoal(goal.team_id === w.teamId("home") ? "home" : "away")
   if (f.restartAfter) {
     startRestart(w, f.restartAfter)
     return
@@ -915,7 +928,7 @@ const ballTick = (w: Work): void => {
     const own = toucher !== null && toucher.side !== scoringSide
     const at = { x: cross.x, y: cross.y }
     w.emit({ ...w.pending("goal", toucher, at, { scorer_id: toucher?.id ?? null, own_goal: own, from: "loose_ball" }), team_id: w.teamId(scoringSide) })
-    w.score[scoringSide] += 1
+    w.addGoal(scoringSide)
     startRestart(w, { restart: "kickoff", side: other(scoringSide), at: { x: 0, y: 0 } })
     return
   }
diff --git a/packages/sim-core/src/types.ts b/packages/sim-core/src/types.ts
index e6773e1..c8462b8 100644
--- a/packages/sim-core/src/types.ts
+++ b/packages/sim-core/src/types.ts
@@ -312,6 +312,8 @@ export interface MatchState {
   readonly subs: Readonly<Record<Side, SubsState>>
   /** Script entries whose outcome is forced on the team's next qualifying action (set by the scenario runner). */
   readonly forced: ReadonlyArray<ScriptEntry>
+  /** Goals scored so far inside each script entry's window (index-aligned with config.script.entries). */
+  readonly scriptGoals: ReadonlyArray<number>
   readonly rng: Readonly<Record<Concern, RngState>>
   readonly eventSeq: number
 }
diff --git a/packages/sim/src/index.ts b/packages/sim/src/index.ts
index 3b42fd0..829b527 100644
--- a/packages/sim/src/index.ts
+++ b/packages/sim/src/index.ts
@@ -2,3 +2,4 @@ export * from "./cdf.js"
 export * from "./run.js"
 export * from "./writer.js"
 export * from "./args.js"
+export * from "./scenarios.js"
PATCH
```

- [ ] **Step 5: Run the tests**

Run: `pnpm --filter @touchline/sim-core test runner scenario && pnpm --filter @touchline/sim test scenarios`
Expected: 6 + 14 passed; 6 passed (each scenario: at least 9 of seeds 1-10 without forcing; this takes a few minutes)

Run: `pnpm turbo run typecheck test --force`
Expected: `Tasks: 10 successful`; plain matches are byte-for-byte unchanged

- [ ] **Step 6: Commit**

```bash
git add packages/sim-core packages/sim
git commit -m "feat: scenario runner (nudge, retry from checkpoint, force) and six built-in scenarios

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```



### Task 7: Ground truth in the run manifest; --scenario

The evaluation harness (spec §5.3.1) scores the agents against what really happened, so the manifest now records it: a truth per scripted entry (effect, team, minutes, frames, count, achieved, attempts, forced, and the metric ids an explanation should cite, from spec §5.2), every scripted event, every mistake (mis-hit kicks and bad first touches) with its frame, player and cause (`script`, `pressure` or `technique`), the critical errors (a mistake followed by an opponent shot within 15 s before the team wins the ball back: error leading to a shot or to a goal), and per-team tactical numbers (pressures per 100 opponent passes, pass share, shots). A scripted match is resolved first (its windows may be re-played) and then streamed, so live playback never shows a discarded attempt. `pnpm sim --scenario <name>` plays a built-in scenario with its fixture unless `--home`/`--away` are given.

**Files:**
- Create: `packages/sim/src/truths.ts`
- Modify: `packages/sim/src/writer.ts`, `packages/sim/src/run.ts`, `packages/sim/src/cli.ts`, `packages/sim/src/scenarios.ts` (descriptions say "at least"), `packages/sim/src/index.ts`
- Test: `packages/sim/test/truths.test.ts`, `packages/sim/test/writer.test.ts`, `packages/sim/test/args.test.ts`

**Interfaces:**
- Consumes: Task 6's `runScript`, `WindowResult`, `SCENARIOS`.
- Produces: `EXPECTED_METRICS`, `scriptTruths(windows, cfg)`, `mistakes(events)`, `criticalErrors(events, cfg)`, `tacticalTruths(events, cfg)` and their types; `hasScript(cfg)`; `matchSteps` streams a resolved scripted match; `RunManifest.scenario` (replaces `script`) and `RunManifest.truths {script, scripted_events, mistakes, critical_errors, tactical}`; `writeMatch(cfg, dir)` (no third argument); CLI `--scenario`.

- [ ] **Step 1: Write the failing tests**

Create `packages/sim/test/truths.test.ts`:

```ts
import { describe, expect, it } from "vitest"
import type { DomainEvent, WindowResult } from "@touchline/sim-core"
import { makeConfig } from "@touchline/sim-core/testing"
import { criticalErrors, mistakes, scriptTruths, tacticalTruths } from "../src/truths.js"

const cfg = makeConfig(1)
const H = cfg.home.id, A = cfg.away.id
let seq = 0
const ev = (type: DomainEvent["type"], frame: number, team: string, attrs: Record<string, unknown> = {}, extra: Partial<DomainEvent> = {}): DomainEvent => ({
  id: `m-e${++seq}`, match_id: "m", type, frame_id: frame, period_frame_id: frame, period: "first_half", match_clock: "10:00.00",
  team_id: team, player_id: team === H ? `${H}-04` : `${A}-09`, x: -20, y: 0, x_end: null, y_end: null, frame_id_end: null,
  outcome: null, source: "sim", confidence: 1, attrs: attrs as DomainEvent["attrs"], ...extra
})

describe("mistakes", () => {
  it("lists every mis-hit and bad first touch with its frame, player and cause", () => {
    const list = mistakes([
      ev("pass", 100, H, { execution: "mishit", under_pressure: true }),
      ev("pass", 200, H, { execution: "mishit", under_pressure: false, scripted: true }),
      ev("clearance", 300, A, { execution: "mishit", under_pressure: false }),
      ev("reception", 400, A, { first_touch: "heavy", under_pressure: true }),
      ev("pass", 500, H, { execution: "clean" }),
      ev("reception", 600, H, { first_touch: "controlled" })
    ])
    expect(list.map((m) => [m.frame_id, m.kind, m.cause])).toEqual([
      [100, "mishit", "pressure"],
      [200, "mishit", "script"],
      [300, "mishit", "technique"],
      [400, "heavy_touch", "pressure"]
    ])
    expect(list[0]!.player_id).toBe(`${H}-04`)
  })
})

describe("critical errors", () => {
  const mistake = ev("pass", 1000, H, { execution: "mishit", under_pressure: true })
  it("a mistake followed by an opponent shot within 15 s is an error leading to a shot; a goal makes it one leading to a goal", () => {
    const shot = ev("shot", 1100, A, {}, { outcome: "saved" })
    expect(criticalErrors([mistake, shot], cfg).map((c) => c.kind)).toEqual(["error_leading_to_shot"])
    const goal = ev("shot", 1100, A, {}, { outcome: "goal" })
    const e = criticalErrors([mistake, goal], cfg)
    expect(e.map((c) => c.kind)).toEqual(["error_leading_to_goal"])
    expect(e[0]).toMatchObject({ mistake_id: mistake.id, shot_id: goal.id, team_id: H })
  })
  it("not when the team wins the ball back first, or the shot comes more than 15 s later", () => {
    const regain = ev("possession_change", 1050, H)
    expect(criticalErrors([mistake, regain, ev("shot", 1100, A, {}, { outcome: "goal" })], cfg)).toEqual([])
    expect(criticalErrors([mistake, ev("shot", 1000 + 151, A, {}, { outcome: "goal" })], cfg)).toEqual([])
  })
})

describe("tactical truths", () => {
  it("counts pressures per 100 opponent passes, pass share and shots per team", () => {
    const list = [
      ...Array.from({ length: 10 }, (_, i) => ev("pass", i, H)),
      ...Array.from({ length: 30 }, (_, i) => ev("pass", 100 + i, A)),
      ...Array.from({ length: 6 }, (_, i) => ev("pressure", 200 + i, H)),
      ev("pressure", 300, A),
      ev("shot", 400, H, {}, { outcome: "wide" })
    ]
    const t = tacticalTruths(list, cfg)
    expect(t[H]).toEqual({ pressures_per_100_opponent_passes: 20, pass_share: 0.25, shots: 1 })
    expect(t[A]).toEqual({ pressures_per_100_opponent_passes: 10, pass_share: 0.75, shots: 0 })
  })
})

describe("script truths", () => {
  it("describe each window: what was injected, by which team, when, whether it happened, and which metrics should move", () => {
    const w: WindowResult = { entries: [{ window: [60, 75], team: "home", effect: "press_surge" }], achieved: true, attempts: 2, forced: false, fromFrame: 36000, toFrame: 45000 }
    expect(scriptTruths([w], cfg)).toEqual([
      { effect: "press_surge", team_id: H, minutes: [60, 75], frames: [36000, 45000], count: 1, achieved: true, attempts: 2, forced: false, expected_metrics: ["team.press", "ppda", "tilt"] }
    ])
  })
})
```

Apply this change to `packages/sim/test/writer.test.ts`, `packages/sim/test/args.test.ts` (from the repository root):

```bash
git apply <<'PATCH'
diff --git a/packages/sim/test/args.test.ts b/packages/sim/test/args.test.ts
index a7bb09c..bbc44c8 100644
--- a/packages/sim/test/args.test.ts
+++ b/packages/sim/test/args.test.ts
@@ -1,5 +1,5 @@
 import { execFileSync, spawnSync } from "node:child_process"
-import { mkdtempSync } from "node:fs"
+import { mkdtempSync, readFileSync } from "node:fs"
 import { tmpdir } from "node:os"
 import { dirname, join } from "node:path"
 import { fileURLToPath } from "node:url"
@@ -62,6 +62,16 @@ describe("sim CLI", () => {
     expect(r.status).toBe(2)
     expect(r.stderr.trim()).toMatch(/^--match-id must be a plain name/)
   })
+  it("plays a built-in scenario with its own fixture, and refuses unknown ones", () => {
+    const bad = spawnSync(tsx, ["src/cli.ts", "--scenario", "nope"], { cwd: pkg, encoding: "utf8" })
+    expect(bad.status).toBe(2)
+    expect(bad.stderr.trim()).toMatch(/^--scenario must be one of/)
+    const out = mkdtempSync(join(tmpdir(), "touchline-scenario-"))
+    const ok = spawnSync(tsx, ["src/cli.ts", "--scenario", "costly_error", "--seed", "3", "--out", out], { cwd: pkg, encoding: "utf8" })
+    expect(ok.status, ok.stderr).toBe(0)
+    const m = JSON.parse(readFileSync(join(out, "manifest.json"), "utf8"))
+    expect(m).toMatchObject({ scenario: "costly_error", home: "northwick", away: "larkspur" })
+  })
   it("prints the options on --help", () => {
     const out = execFileSync(tsx, ["src/cli.ts", "--help"], { cwd: pkg, encoding: "utf8" })
     expect(out).toMatch(/--seed/)
diff --git a/packages/sim/test/writer.test.ts b/packages/sim/test/writer.test.ts
index 78064bb..8c69c10 100644
--- a/packages/sim/test/writer.test.ts
+++ b/packages/sim/test/writer.test.ts
@@ -32,3 +32,32 @@ describe("match files", () => {
     for (const e of duels) expect(e.outcome).toBe((e.attrs as Record<string, unknown>).outcome)
   })
 })
+
+const scripted = mkdtempSync(join(tmpdir(), "touchline-scripted-"))
+const script = { name: "test_goal", entries: [{ window: [10, 30] as const, team: "home" as const, effect: "goal" as const }] }
+const m = await Effect.runPromise(writeMatch(makeConfig(5, { script }), scripted))
+
+describe("run manifest ground truth", () => {
+  it("records the scenario and a truth per scripted entry", () => {
+    expect(m.scenario).toBe("test_goal")
+    expect(m.truths.script).toHaveLength(1)
+    expect(m.truths.script[0]).toMatchObject({ effect: "goal", minutes: [10, 30], expected_metrics: ["shot.xg", "team.mom"] })
+    expect(typeof m.truths.script[0]!.achieved).toBe("boolean")
+  })
+  it("lists every scripted event, mistake and critical error, and per-team tactical numbers", () => {
+    const events = readFileSync(join(scripted, "domain.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l) as { id: string; type: string; attrs: Record<string, unknown> })
+    expect(m.truths.scripted_events.map((e) => e.id)).toEqual(events.filter((e) => e.attrs.scripted === true).map((e) => e.id))
+    const bad = events.filter((e) => ((e.type === "pass" || e.type === "clearance") && e.attrs.execution === "mishit") || (e.type === "reception" && e.attrs.first_touch !== "controlled"))
+    expect(m.truths.mistakes).toHaveLength(bad.length)
+    expect(Array.isArray(m.truths.critical_errors)).toBe(true)
+    expect(Object.keys(m.truths.tactical).sort()).toEqual(["away-fc", "home-fc"])
+  })
+  it("keeps the scripted flag out of CDF", () => {
+    expect(readFileSync(join(scripted, "event.jsonl"), "utf8")).not.toMatch(/scripted/)
+  })
+  it("a match without a script has no scenario and no script truths", () => {
+    const plain = JSON.parse(readFileSync(join(dir, "manifest.json"), "utf8"))
+    expect(plain.scenario).toBeNull()
+    expect(plain.truths.script).toEqual([])
+  })
+})
PATCH
```

- [ ] **Step 2: Run them to make sure they fail**

Run: `pnpm --filter @touchline/sim test truths writer args`
Expected: `Cannot find module '../src/truths.js'`; writer: 3 failed (`expected undefined to be 'test_goal'` …); args: 1 failed (`--scenario`)

- [ ] **Step 3: Write the truths**

Create `packages/sim/src/truths.ts`:

```ts
/**
 * Ground truth for the run manifest (spec §5.1.12 "ground truth in the manifest", §5.3.1 tactical truths):
 * what the script injected, every mistake with its cause, the errors that led to a shot or goal, and per-team
 * tactical numbers. The evaluation harness scores the agents' explanations against these.
 */
import type { DomainEvent, MatchConfig, ScenarioEffect, WindowResult } from "@touchline/sim-core"

/** Metric ids (spec §5.2) an agent should cite when explaining each kind of injected cause. */
export const EXPECTED_METRICS: Readonly<Record<ScenarioEffect, ReadonlyArray<string>>> = {
  goal: ["shot.xg", "team.mom"],
  red_card: ["team.mom", "game.chaos"],
  press_surge: ["team.press", "ppda", "tilt"],
  keeper_heroics: ["shot.xg"],
  momentum_swing: ["team.mom", "tilt"],
  keeper_howler: ["shot.xg", "game.chaos"],
  defensive_error: ["pass.acc", "game.chaos"]
}

export interface ScriptTruth {
  readonly effect: ScenarioEffect
  readonly team_id: string
  readonly minutes: readonly [number, number]
  readonly frames: readonly [number, number]
  readonly count: number
  readonly achieved: boolean
  readonly attempts: number
  readonly forced: boolean
  readonly expected_metrics: ReadonlyArray<string>
}

export const scriptTruths = (windows: ReadonlyArray<WindowResult>, cfg: MatchConfig): ScriptTruth[] =>
  windows.flatMap((w) =>
    w.entries.map((e) => ({
      effect: e.effect,
      team_id: e.team === "home" ? cfg.home.id : cfg.away.id,
      minutes: e.window,
      frames: [w.fromFrame, w.toFrame] as const,
      count: e.count ?? 1,
      achieved: w.achieved,
      attempts: w.attempts,
      forced: w.forced,
      expected_metrics: EXPECTED_METRICS[e.effect]
    }))
  )

export interface Mistake {
  readonly event_id: string
  readonly frame_id: number
  readonly team_id: string | null
  readonly player_id: string | null
  readonly kind: "mishit" | "heavy_touch" | "miscontrol" | "missed_touch"
  /** Why it happened: forced by the scenario script, under pressure, or plain technique. */
  readonly cause: "script" | "pressure" | "technique"
}

const TOUCH: Readonly<Record<string, Mistake["kind"]>> = { heavy: "heavy_touch", miscontrol: "miscontrol", missed: "missed_touch" }

/** Every mis-hit kick (passes and clearances) and every bad first touch, in event order. */
export const mistakes = (events: ReadonlyArray<DomainEvent>): Mistake[] =>
  events.flatMap((e) => {
    const kind =
      (e.type === "pass" || e.type === "clearance") && e.attrs.execution === "mishit"
        ? ("mishit" as const)
        : e.type === "reception" && typeof e.attrs.first_touch === "string"
          ? TOUCH[e.attrs.first_touch]
          : undefined
    if (!kind) return []
    const cause = e.attrs.scripted === true ? "script" : e.attrs.under_pressure === true ? "pressure" : "technique"
    return [{ event_id: e.id, frame_id: e.frame_id, team_id: e.team_id, player_id: e.player_id, kind, cause } as const]
  })

export interface CriticalError {
  readonly kind: "error_leading_to_shot" | "error_leading_to_goal"
  readonly mistake_id: string
  readonly shot_id: string
  readonly team_id: string | null
  readonly frame_id: number
}

/**
 * A mistake is critical when the opponent shoots within 15 s and before the mistake's team wins the ball back
 * (spec §5.1.10: error leading to a shot or goal); a goal from that shot makes it an error leading to a goal.
 */
export const criticalErrors = (events: ReadonlyArray<DomainEvent>, cfg: MatchConfig): CriticalError[] => {
  const ordered = [...events].sort((a, b) => a.frame_id - b.frame_id)
  const horizon = Math.round(15 / cfg.dt)
  const ids = new Set(mistakes(ordered).map((m) => m.event_id))
  const out: CriticalError[] = []
  ordered.forEach((m, i) => {
    if (!ids.has(m.id)) return
    for (const e of ordered.slice(i + 1)) {
      if (e.frame_id - m.frame_id > horizon) break
      if (e.type === "possession_change" && e.team_id === m.team_id) break
      if (e.type === "shot" && e.team_id !== m.team_id) {
        out.push({ kind: e.outcome === "goal" ? "error_leading_to_goal" : "error_leading_to_shot", mistake_id: m.id, shot_id: e.id, team_id: m.team_id, frame_id: m.frame_id })
        break
      }
    }
  })
  return out
}

export interface TeamTruth {
  /** Pressing intensity, independent of who had the ball: pressures per 100 opponent passes. */
  readonly pressures_per_100_opponent_passes: number
  readonly pass_share: number
  readonly shots: number
}

const r2 = (v: number) => Math.round(v * 100) / 100

export const tacticalTruths = (events: ReadonlyArray<DomainEvent>, cfg: MatchConfig): Record<string, TeamTruth> => {
  const n = (type: DomainEvent["type"], team: string) => events.filter((e) => e.type === type && e.team_id === team).length
  const passes = n("pass", cfg.home.id) + n("pass", cfg.away.id)
  const truth = (team: string, opp: string): TeamTruth => ({
    pressures_per_100_opponent_passes: r2((100 * n("pressure", team)) / Math.max(1, n("pass", opp))),
    pass_share: r2(n("pass", team) / Math.max(1, passes)),
    shots: n("shot", team)
  })
  return { [cfg.home.id]: truth(cfg.home.id, cfg.away.id), [cfg.away.id]: truth(cfg.away.id, cfg.home.id) }
}
```

- [ ] **Step 4: Record them in the manifest and add --scenario**

Apply this change to `packages/sim/src/run.ts`, `packages/sim/src/writer.ts`, `packages/sim/src/cli.ts`, `packages/sim/src/scenarios.ts`, `packages/sim/src/index.ts` (from the repository root):

```bash
git apply <<'PATCH'
diff --git a/packages/sim/src/cli.ts b/packages/sim/src/cli.ts
index 75efbf0..e92eba3 100644
--- a/packages/sim/src/cli.ts
+++ b/packages/sim/src/cli.ts
@@ -5,6 +5,7 @@ import { Effect } from "effect"
 import type { League } from "@touchline/league"
 import { DEFAULT_PARAMS, ParamsError, paramsFromJson, type Params } from "@touchline/sim-core"
 import { CliError, cliOptions, exitOnUserError, integer, isoTime, oneOf, safeName } from "./args.js"
+import { SCENARIOS } from "./scenarios.js"
 import { writeMatch } from "./writer.js"
 
 const root = join(dirname(fileURLToPath(import.meta.url)), "../../..")
@@ -16,8 +17,9 @@ const defaultParams = join(root, "data/params/touchline-params.json")
 
 const o = cliOptions("touchline-sim: simulate one match and write CDF, domain events and a run manifest", {
   seed: { default: "1", check: integer(0, 4294967295), help: "match seed" },
-  home: { default: "ironmoor", check: oneOf(clubIds), help: "home club id" },
-  away: { default: "kestrel-bay", check: oneOf(clubIds), help: "away club id" },
+  scenario: { default: "", check: oneOf(Object.keys(SCENARIOS)), help: `built-in scenario script (${Object.keys(SCENARIOS).join(", ")})` },
+  home: { default: "", check: oneOf(clubIds), help: "home club id (default: the scenario's, else ironmoor)" },
+  away: { default: "", check: oneOf(clubIds), help: "away club id (default: the scenario's, else kestrel-bay)" },
   fps: { default: "10", check: oneOf(["10", "25"]), help: "tracking frames per second" },
   kickoff: { default: "2026-10-18T14:00:00.000Z", check: isoTime, help: "kickoff time, ISO 8601 UTC" },
   "match-id": { default: "", check: safeName, help: "match id (default m-<seed>); also the output folder name" },
@@ -34,12 +36,15 @@ const params: Params = exitOnUserError(() => {
     throw new CliError(`Cannot use params file ${o.params}: ${e instanceof ParamsError ? e.message : String(e)}`)
   }
 })
+const scenario = o.scenario ? SCENARIOS[o.scenario]! : null
+const home = o.home || scenario?.home || "ironmoor"
+const away = o.away || scenario?.away || "kestrel-bay"
 exitOnUserError(() => {
-  if (o.home === o.away) throw new CliError("--home and --away must be different clubs")
+  if (home === away) throw new CliError("--home and --away must be different clubs")
 })
 const seed = Number(o.seed)
 const matchId = o["match-id"] || `m-${seed}`
 const club = (id: string) => league.clubs.find((c) => c.id === id)!
-const cfg = { matchId, seed, kickoffTime: o.kickoff, home: club(o.home), away: club(o.away), params, dt: 1 / Number(o.fps) }
+const cfg = { matchId, seed, kickoffTime: o.kickoff, home: club(home), away: club(away), params, dt: 1 / Number(o.fps), ...(scenario ? { script: scenario.script } : {}) }
 const out = here(o.out || join(root, "out", matchId))
 Effect.runPromise(writeMatch(cfg, out)).then((m) => console.log(`${out}: ${JSON.stringify(m.stats)}`))
diff --git a/packages/sim/src/index.ts b/packages/sim/src/index.ts
index 829b527..4861984 100644
--- a/packages/sim/src/index.ts
+++ b/packages/sim/src/index.ts
@@ -3,3 +3,4 @@ export * from "./run.js"
 export * from "./writer.js"
 export * from "./args.js"
 export * from "./scenarios.js"
+export * from "./truths.js"
diff --git a/packages/sim/src/run.ts b/packages/sim/src/run.ts
index b2f68ea..2733be3 100644
--- a/packages/sim/src/run.ts
+++ b/packages/sim/src/run.ts
@@ -1,12 +1,20 @@
 import { Effect, Schedule, Stream } from "effect"
-import { initMatch, isFinished, step, type MatchConfig, type StepResult } from "@touchline/sim-core"
+import { initMatch, isFinished, runScript, step, type MatchConfig, type StepResult } from "@touchline/sim-core"
 
-/** Every step of a match as a stream; the final full-time step is included. */
+/** True when the config carries a script with at least one entry. */
+export const hasScript = (cfg: MatchConfig): boolean => (cfg.script?.entries.length ?? 0) > 0
+
+/**
+ * Every step of a match as a stream; the final full-time step is included. A scripted match is resolved first
+ * (its windows may be re-played, spec §5.1.7) and then streamed, so live playback never shows a discarded attempt.
+ */
 export const matchSteps = (cfg: MatchConfig): Stream.Stream<StepResult> =>
-  Stream.iterate<StepResult>({ state: initMatch(cfg), frame: null, events: [] }, (r) => step(r.state)).pipe(
-    Stream.drop(1),
-    Stream.takeUntil((r) => isFinished(r.state))
-  )
+  hasScript(cfg)
+    ? Stream.fromIterable(runScript(cfg).steps)
+    : Stream.iterate<StepResult>({ state: initMatch(cfg), frame: null, events: [] }, (r) => step(r.state)).pipe(
+        Stream.drop(1),
+        Stream.takeUntil((r) => isFinished(r.state))
+      )
 
 /** Paced for live playback: one step every (dt / speed) seconds of wall-clock time. */
 export const pacedSteps = (cfg: MatchConfig, speed: number): Stream.Stream<StepResult> =>
diff --git a/packages/sim/src/scenarios.ts b/packages/sim/src/scenarios.ts
index 036c485..34e156c 100644
--- a/packages/sim/src/scenarios.ts
+++ b/packages/sim/src/scenarios.ts
@@ -17,7 +17,7 @@ export const SCENARIOS: Readonly<Record<string, Scenario>> = {
     script: { name: "even_contest", entries: [] }
   },
   late_comeback: {
-    description: "The away side lead 2-0 by 70', then the home side score three times",
+    description: "The away side score at least twice by 70', then the home side score at least three times",
     home: "eastvale",
     away: "ironmoor",
     script: {
@@ -29,7 +29,7 @@ export const SCENARIOS: Readonly<Record<string, Scenario>> = {
     }
   },
   red_card_collapse: {
-    description: "A home player is sent off between 50' and 60'; the away side then score twice",
+    description: "A home player is sent off between 50' and 60'; the away side then score at least twice",
     home: "harrowmere",
     away: "corrin-forge",
     script: {
diff --git a/packages/sim/src/writer.ts b/packages/sim/src/writer.ts
index 22c3174..90411df 100644
--- a/packages/sim/src/writer.ts
+++ b/packages/sim/src/writer.ts
@@ -2,21 +2,31 @@ import { createHash } from "node:crypto"
 import { closeSync, mkdirSync, openSync, readFileSync, writeFileSync, writeSync } from "node:fs"
 import { join } from "node:path"
 import { Effect, Stream } from "effect"
-import type { DomainEvent, Frame, MatchConfig } from "@touchline/sim-core"
+import { runScript, type DomainEvent, type Frame, type MatchConfig, type WindowResult } from "@touchline/sim-core"
 import { cdfEventLine, cdfMeta, cdfTrackingLine, periodsFromFrames } from "./cdf.js"
-import { matchSteps } from "./run.js"
+import { hasScript, matchSteps } from "./run.js"
+import { criticalErrors, mistakes, scriptTruths, tacticalTruths, type CriticalError, type Mistake, type ScriptTruth, type TeamTruth } from "./truths.js"
 
 export interface RunManifest {
   readonly match_id: string
   readonly seed: number
   readonly home: string
   readonly away: string
-  readonly script: string | null
+  /** The scenario script's name, or null for a plain match. */
+  readonly scenario: string | null
   readonly fps: number
   readonly params_version: string
   readonly engine: { readonly name: string; readonly version: string }
   readonly outputs: Readonly<Record<string, string>>
   readonly stats: { readonly frames: number; readonly events: number; readonly cdf_events: number; readonly score: string }
+  /** Ground truth for the evaluation harness (spec §5.1.12, §5.3.1); kept out of CDF. */
+  readonly truths: {
+    readonly script: ReadonlyArray<ScriptTruth>
+    readonly scripted_events: ReadonlyArray<{ readonly id: string; readonly type: string; readonly frame_id: number; readonly team_id: string | null; readonly player_id: string | null }>
+    readonly mistakes: ReadonlyArray<Mistake>
+    readonly critical_errors: ReadonlyArray<CriticalError>
+    readonly tactical: Readonly<Record<string, TeamTruth>>
+  }
 }
 
 const sha256 = (path: string) => "sha256:" + createHash("sha256").update(readFileSync(path)).digest("hex")
@@ -25,8 +35,11 @@ const sha256 = (path: string) => "sha256:" + createHash("sha256").update(readFil
  * Run one match and write meta.json, event.jsonl, tracking.jsonl, domain.jsonl and manifest.json to `dir`.
  * Tracking is streamed to disk; events are kept in memory (a few thousand) to resolve CDF receiver times.
  */
-export const writeMatch = (cfg: MatchConfig, dir: string, script: string | null = null) =>
+export const writeMatch = (cfg: MatchConfig, dir: string) =>
   Effect.gen(function* () {
+    // A scripted match is resolved first so its window results are known; a plain match streams step by step.
+    const run = hasScript(cfg) ? runScript(cfg) : null
+    const windows: ReadonlyArray<WindowResult> = run?.windows ?? []
     mkdirSync(dir, { recursive: true })
     const trackingFd = openSync(join(dir, "tracking.jsonl"), "w")
     const periods: Frame[] = []
@@ -35,7 +48,7 @@ export const writeMatch = (cfg: MatchConfig, dir: string, script: string | null
     const events: DomainEvent[] = []
     let frames = 0
     let last: Frame | null = null
-    yield* Stream.runForEach(matchSteps(cfg), (r) =>
+    yield* Stream.runForEach(run ? Stream.fromIterable(run.steps) : matchSteps(cfg), (r) =>
       Effect.sync(() => {
         events.push(...r.events)
         const f = r.frame
@@ -70,12 +83,19 @@ export const writeMatch = (cfg: MatchConfig, dir: string, script: string | null
       seed: cfg.seed,
       home: cfg.home.id,
       away: cfg.away.id,
-      script,
+      scenario: cfg.script?.name ?? null,
       fps: Math.round(1 / cfg.dt),
       params_version: cfg.params.provenance.version,
       engine: { name: "touchline-sim", version: "0.1.0" },
       outputs: Object.fromEntries(["meta.json", "event.jsonl", "tracking.jsonl", "domain.jsonl"].map((f) => [f, sha256(join(dir, f))])),
-      stats: { frames, events: events.length, cdf_events: cdfLines.length, score }
+      stats: { frames, events: events.length, cdf_events: cdfLines.length, score },
+      truths: {
+        script: scriptTruths(windows, cfg),
+        scripted_events: ordered.filter((e) => e.attrs.scripted === true).map((e) => ({ id: e.id, type: e.type, frame_id: e.frame_id, team_id: e.team_id, player_id: e.player_id })),
+        mistakes: mistakes(ordered),
+        critical_errors: criticalErrors(ordered, cfg),
+        tactical: tacticalTruths(ordered, cfg)
+      }
     }
     writeFileSync(join(dir, "manifest.json"), JSON.stringify(manifest, null, 1))
     return manifest
PATCH
```

- [ ] **Step 5: Run the tests and a scenario**

Run: `pnpm --filter @touchline/sim test truths writer args`
Expected: 5 passed; 7 passed; 10 passed

Run: `pnpm sim --scenario late_comeback --seed 2 && uv run --project python/analytics python -m touchline_analytics.validate_cdf out/m-2`
Expected: the manifest names `late_comeback`, Eastvale v Ironmoor, two truths both achieved, about 30 mistakes and a couple of critical errors; CDF valid

Run: `pnpm turbo run typecheck test --force`
Expected: `Tasks: 10 successful`

- [ ] **Step 6: Commit**

```bash
git add packages/sim
git commit -m "feat(sim): ground truth in the run manifest; --scenario

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```



### Task 8: SPADL view

Spec §5.1.9-10: a SPADL view next to CDF. Every on-ball event becomes one action with SPADL's columns, type, result and body-part names and ids (the lists, whose positions are the ids, follow socceraction, MIT), in SPADL coordinates (0..105 x 0..68) with every action oriented so the acting team attacks left to right (home x + 52.5, y + 34; away flipped). Passes map by kind and restart (cross, throw-in, corner and free kick crossed or short, goal kick), shots by technique, carries become dribbles, bad first touches become `bad_touch`, a booked foul carries the card as its result. Written as `spadl.csv` in every match folder and hashed in the manifest.

**Files:**
- Create: `packages/sim/src/spadl.ts`
- Modify: `packages/sim/src/writer.ts`, `packages/sim/src/index.ts`
- Test: `packages/sim/test/spadl.test.ts`

**Interfaces:**
- Consumes: domain events (Plan 2b, frame-ordered).
- Produces: `SPADL_ACTIONTYPES`, `SPADL_RESULTS`, `SPADL_BODYPARTS`, `interface SpadlAction`, `spadlActions(events, cfg)`, `spadlCsv(events, cfg)`; `spadl.csv` in match folders.

- [ ] **Step 1: Write the failing tests**

Create `packages/sim/test/spadl.test.ts`:

```ts
import { mkdtempSync, readFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { Effect } from "effect"
import { describe, expect, it } from "vitest"
import type { DomainEvent } from "@touchline/sim-core"
import { makeConfig } from "@touchline/sim-core/testing"
import { SPADL_ACTIONTYPES, SPADL_BODYPARTS, SPADL_RESULTS, spadlActions, spadlCsv } from "../src/spadl.js"
import { writeMatch } from "../src/writer.js"

const cfg = makeConfig(1)
const H = cfg.home.id, A = cfg.away.id
let seq = 0
const ev = (type: DomainEvent["type"], team: string, attrs: Record<string, unknown> = {}, extra: Partial<DomainEvent> = {}): DomainEvent => ({
  id: `m-e${++seq}`, match_id: "m", type, frame_id: 100 + seq, period_frame_id: 100 + seq, period: "first_half", match_clock: "00:10.00",
  team_id: team, player_id: `${team}-07`, x: 0, y: 0, x_end: 10, y_end: 5, frame_id_end: null, outcome: null, source: "sim", confidence: 1,
  attrs: attrs as DomainEvent["attrs"], ...extra
})
const one = (e: DomainEvent) => spadlActions([e], cfg)[0]!

describe("SPADL view", () => {
  it("uses SPADL's coordinates (0..105 x 0..68) with every action going left to right: the away team is flipped", () => {
    const home = one(ev("pass", H, { kind: "short" }, { outcome: "successful" }))
    expect([home.start_x, home.start_y, home.end_x, home.end_y]).toEqual([52.5, 34, 62.5, 39])
    const away = one(ev("pass", A, { kind: "short" }, { outcome: "successful" }))
    expect([away.start_x, away.start_y, away.end_x, away.end_y]).toEqual([52.5, 34, 42.5, 29])
  })
  it("maps passes by kind and restart, and their results", () => {
    const t = (attrs: Record<string, unknown>, outcome = "successful") => one(ev("pass", H, attrs, { outcome }))
    expect(t({ kind: "cross" }).type_name).toBe("cross")
    expect(t({ kind: "set_piece", restart: "throw_in" }).type_name).toBe("throw_in")
    expect(t({ kind: "set_piece", restart: "corner", height: "high" }).type_name).toBe("corner_crossed")
    expect(t({ kind: "set_piece", restart: "corner", height: "ground" }).type_name).toBe("corner_short")
    expect(t({ kind: "set_piece", restart: "free_kick", height: "high" }).type_name).toBe("freekick_crossed")
    expect(t({ kind: "set_piece", restart: "goal_kick" }).type_name).toBe("goalkick")
    expect(t({ kind: "long" }, "intercepted").result_name).toBe("fail")
    expect(t({ kind: "through" }, "offside").result_name).toBe("offside")
  })
  it("maps shots, carries, duels, keeper actions, clearances and bad touches", () => {
    expect(one(ev("shot", H, { technique: "penalty" }, { outcome: "goal" }))).toMatchObject({ type_name: "shot_penalty", result_name: "success" })
    expect(one(ev("shot", H, { technique: "free_kick" }, { outcome: "saved" }))).toMatchObject({ type_name: "shot_freekick", result_name: "fail" })
    expect(one(ev("carry", H))).toMatchObject({ type_name: "dribble", result_name: "success" })
    expect(one(ev("take_on", H, { outcome: "lost" }, { outcome: "lost" }))).toMatchObject({ type_name: "take_on", result_name: "fail" })
    expect(one(ev("keeper_claim", H, { handling: "fumble" }))).toMatchObject({ type_name: "keeper_claim", result_name: "fail" })
    expect(one(ev("keeper_punch", H))).toMatchObject({ type_name: "keeper_punch", result_name: "success" })
    expect(one(ev("clearance", H, { technique: "head", body_part: "head" }))).toMatchObject({ type_name: "clearance", bodypart_name: "head" })
    expect(one(ev("reception", H, { first_touch: "heavy" }))).toMatchObject({ type_name: "bad_touch", result_name: "fail" })
    expect(spadlActions([ev("reception", H, { first_touch: "controlled" }), ev("pressure", A)], cfg)).toEqual([])
  })
  it("gives a booked foul the card as its result", () => {
    const foul = ev("foul", A)
    const card = { ...ev("card", A, { colour: "second_yellow" }), frame_id: foul.frame_id, player_id: foul.player_id }
    expect(spadlActions([foul, card], cfg)[0]).toMatchObject({ type_name: "foul", result_name: "red_card" })
  })
  it("uses the preferred-foot body parts", () => {
    expect(one(ev("pass", H, { kind: "short", body_part: "left_foot" }, { outcome: "successful" })).bodypart_name).toBe("foot_left")
    expect(one(ev("pass", H, { kind: "set_piece", restart: "throw_in", body_part: "hands" }, { outcome: "successful" })).bodypart_name).toBe("other")
  })
})

describe("spadl.csv in a match folder", () => {
  it("has SPADL's columns, valid ids and coordinates, in time order per period", async () => {
    const dir = mkdtempSync(join(tmpdir(), "touchline-spadl-"))
    const m = await Effect.runPromise(writeMatch(makeConfig(2), dir))
    expect(Object.keys(m.outputs)).toContain("spadl.csv")
    const [header, ...rows] = readFileSync(join(dir, "spadl.csv"), "utf8").trim().split("\n")
    expect(header).toBe("game_id,original_event_id,action_id,period_id,time_seconds,team_id,player_id,start_x,start_y,end_x,end_y,type_id,type_name,result_id,result_name,bodypart_id,bodypart_name")
    expect(rows.length).toBeGreaterThan(800)
    let last = { period: 1, t: 0 }
    rows.forEach((line, i) => {
      const c = line.split(",")
      expect(Number(c[2])).toBe(i)
      const [sx, sy, ex, ey] = [7, 8, 9, 10].map((k) => Number(c[k]))
      for (const v of [sx, ex]) expect(v).toBeGreaterThanOrEqual(0), expect(v).toBeLessThanOrEqual(105)
      for (const v of [sy, ey]) expect(v).toBeGreaterThanOrEqual(0), expect(v).toBeLessThanOrEqual(68)
      expect(SPADL_ACTIONTYPES[Number(c[11])]).toBe(c[12])
      expect(SPADL_RESULTS[Number(c[13])]).toBe(c[14])
      expect(SPADL_BODYPARTS[Number(c[15])]).toBe(c[16])
      const period = Number(c[3]), t = Number(c[4])
      if (period === last.period) expect(t).toBeGreaterThanOrEqual(last.t)
      last = { period, t }
    })
    expect(spadlCsv([], cfg).trim()).toBe(header)
  })
})
```

- [ ] **Step 2: Run them to make sure they fail**

Run: `pnpm --filter @touchline/sim test spadl`
Expected: `Cannot find module '../src/spadl.js'`

- [ ] **Step 3: Implement**

Create `packages/sim/src/spadl.ts`:

```ts
/**
 * SPADL view of a match (spec §5.1.9, §5.1.10): one action per on-ball event, in SPADL's coordinates
 * (0..105 x 0..68, origin at a corner) with every action oriented so the acting team attacks left to right.
 * The type, result and body-part lists (and their ids, which are list positions) follow SPADL as defined by
 * socceraction (MIT, ML-KULeuven), so the output loads into its tools unchanged.
 */
import { round2, type DomainEvent, type MatchConfig } from "@touchline/sim-core"

export const SPADL_ACTIONTYPES = [
  "pass", "cross", "throw_in", "freekick_crossed", "freekick_short", "corner_crossed", "corner_short", "take_on", "foul", "tackle",
  "interception", "shot", "shot_penalty", "shot_freekick", "keeper_save", "keeper_claim", "keeper_punch", "keeper_pick_up", "clearance",
  "bad_touch", "non_action", "dribble", "goalkick"
] as const
export const SPADL_RESULTS = ["fail", "success", "offside", "owngoal", "yellow_card", "red_card"] as const
export const SPADL_BODYPARTS = ["foot", "head", "other", "head/other", "foot_left", "foot_right"] as const

type ActionType = (typeof SPADL_ACTIONTYPES)[number]
type Result = (typeof SPADL_RESULTS)[number]
type Bodypart = (typeof SPADL_BODYPARTS)[number]

export interface SpadlAction {
  readonly game_id: string
  readonly original_event_id: string
  readonly action_id: number
  readonly period_id: 1 | 2
  readonly time_seconds: number
  readonly team_id: string
  readonly player_id: string
  readonly start_x: number
  readonly start_y: number
  readonly end_x: number
  readonly end_y: number
  readonly type_id: number
  readonly type_name: ActionType
  readonly result_id: number
  readonly result_name: Result
  readonly bodypart_id: number
  readonly bodypart_name: Bodypart
}

const passType = (e: DomainEvent): ActionType => {
  const high = e.attrs.height !== "ground"
  switch (e.attrs.restart) {
    case "throw_in":
      return "throw_in"
    case "corner":
      return high ? "corner_crossed" : "corner_short"
    case "free_kick":
      return high ? "freekick_crossed" : "freekick_short"
    case "goal_kick":
      return "goalkick"
    default:
      return e.attrs.kind === "cross" ? "cross" : "pass"
  }
}

/** SPADL type and result of a domain event, or null when the event is not an on-ball action. */
const typeAndResult = (e: DomainEvent, cardOf: (e: DomainEvent) => Result | null): [ActionType, Result] | null => {
  switch (e.type) {
    case "pass":
      return [passType(e), e.outcome === "successful" ? "success" : e.outcome === "offside" ? "offside" : "fail"]
    case "shot":
      return [e.attrs.technique === "penalty" ? "shot_penalty" : e.attrs.technique === "free_kick" ? "shot_freekick" : "shot", e.outcome === "goal" ? "success" : "fail"]
    case "carry":
      return ["dribble", "success"]
    case "take_on":
      return ["take_on", e.outcome === "won" ? "success" : "fail"]
    case "tackle":
      return ["tackle", e.outcome === "won" ? "success" : "fail"]
    case "foul":
      return ["foul", cardOf(e) ?? "fail"]
    case "interception":
      return ["interception", "success"]
    case "clearance":
      return ["clearance", "success"]
    case "keeper_save":
      return ["keeper_save", "success"]
    case "keeper_claim":
      return ["keeper_claim", e.attrs.handling === "fumble" ? "fail" : "success"]
    case "keeper_punch":
      return ["keeper_punch", "success"]
    case "reception":
      return e.attrs.first_touch !== undefined && e.attrs.first_touch !== "controlled" ? ["bad_touch", "fail"] : null
    default:
      return null
  }
}

const bodypart = (e: DomainEvent): Bodypart =>
  e.attrs.body_part === "left_foot" ? "foot_left" : e.attrs.body_part === "right_foot" ? "foot_right" : e.attrs.body_part === "head" ? "head" : e.attrs.body_part === "hands" ? "other" : "foot"

const clamp = (v: number, hi: number) => round2(Math.max(0, Math.min(hi, v)))

/** SPADL actions for a match's domain events, in frame order. */
export const spadlActions = (events: ReadonlyArray<DomainEvent>, cfg: MatchConfig): SpadlAction[] => {
  const ordered = [...events].sort((a, b) => a.frame_id - b.frame_id)
  const cards = ordered.filter((e) => e.type === "card")
  const cardOf = (foul: DomainEvent): Result | null => {
    const c = cards.find((k) => k.frame_id === foul.frame_id && k.player_id === foul.player_id)
    return c ? (c.attrs.colour === "yellow" ? "yellow_card" : "red_card") : null
  }
  const out: SpadlAction[] = []
  for (const e of ordered) {
    const tr = typeAndResult(e, cardOf)
    if (!tr || e.team_id === null || e.player_id === null || e.x === null || e.y === null) continue
    // Home attacks +x for the whole match; flipping the away team makes every action go left to right.
    const flip = e.team_id === cfg.away.id
    const sx = (x: number) => clamp(flip ? 52.5 - x : x + 52.5, 105)
    const sy = (y: number) => clamp(flip ? 34 - y : y + 34, 68)
    const bp = bodypart(e)
    out.push({
      game_id: e.match_id,
      original_event_id: e.id,
      action_id: out.length,
      period_id: e.period === "first_half" ? 1 : 2,
      time_seconds: round2(e.period_frame_id * cfg.dt),
      team_id: e.team_id,
      player_id: e.player_id,
      start_x: sx(e.x),
      start_y: sy(e.y),
      end_x: sx(e.x_end ?? e.x),
      end_y: sy(e.y_end ?? e.y),
      type_id: SPADL_ACTIONTYPES.indexOf(tr[0]),
      type_name: tr[0],
      result_id: SPADL_RESULTS.indexOf(tr[1]),
      result_name: tr[1],
      bodypart_id: SPADL_BODYPARTS.indexOf(bp),
      bodypart_name: bp
    })
  }
  return out
}

const COLUMNS = [
  "game_id", "original_event_id", "action_id", "period_id", "time_seconds", "team_id", "player_id", "start_x", "start_y", "end_x", "end_y",
  "type_id", "type_name", "result_id", "result_name", "bodypart_id", "bodypart_name"
] as const

/** The actions as CSV with SPADL's column names. */
export const spadlCsv = (events: ReadonlyArray<DomainEvent>, cfg: MatchConfig): string =>
  [COLUMNS.join(","), ...spadlActions(events, cfg).map((a) => COLUMNS.map((c) => String(a[c])).join(","))].join("\n") + "\n"
```

Apply this change to `packages/sim/src/writer.ts`, `packages/sim/src/index.ts` (from the repository root):

```bash
git apply <<'PATCH'
diff --git a/packages/sim/src/index.ts b/packages/sim/src/index.ts
index 4861984..332c018 100644
--- a/packages/sim/src/index.ts
+++ b/packages/sim/src/index.ts
@@ -4,3 +4,4 @@ export * from "./writer.js"
 export * from "./args.js"
 export * from "./scenarios.js"
 export * from "./truths.js"
+export * from "./spadl.js"
diff --git a/packages/sim/src/writer.ts b/packages/sim/src/writer.ts
index 90411df..332f8d7 100644
--- a/packages/sim/src/writer.ts
+++ b/packages/sim/src/writer.ts
@@ -5,6 +5,7 @@ import { Effect, Stream } from "effect"
 import { runScript, type DomainEvent, type Frame, type MatchConfig, type WindowResult } from "@touchline/sim-core"
 import { cdfEventLine, cdfMeta, cdfTrackingLine, periodsFromFrames } from "./cdf.js"
 import { hasScript, matchSteps } from "./run.js"
+import { spadlCsv } from "./spadl.js"
 import { criticalErrors, mistakes, scriptTruths, tacticalTruths, type CriticalError, type Mistake, type ScriptTruth, type TeamTruth } from "./truths.js"
 
 export interface RunManifest {
@@ -75,6 +76,7 @@ export const writeMatch = (cfg: MatchConfig, dir: string) =>
     const cdfLines = ordered.map((e) => cdfEventLine(cfg, e, clock, (p) => periodStart.get(p) ?? 0, recv.get(e.id) ?? null)).filter((x): x is string => x !== null)
     writeFileSync(join(dir, "event.jsonl"), cdfLines.join("\n") + "\n")
     writeFileSync(join(dir, "domain.jsonl"), ordered.map((e) => JSON.stringify(e)).join("\n") + "\n")
+    writeFileSync(join(dir, "spadl.csv"), spadlCsv(ordered, cfg))
     writeFileSync(join(dir, "meta.json"), JSON.stringify(cdfMeta(cfg, periodsFromFrames(periods)), null, 1))
     const goals = events.filter((e) => e.type === "goal")
     const score = `${goals.filter((g) => g.team_id === cfg.home.id).length}-${goals.filter((g) => g.team_id === cfg.away.id).length}`
@@ -87,7 +89,7 @@ export const writeMatch = (cfg: MatchConfig, dir: string) =>
       fps: Math.round(1 / cfg.dt),
       params_version: cfg.params.provenance.version,
       engine: { name: "touchline-sim", version: "0.1.0" },
-      outputs: Object.fromEntries(["meta.json", "event.jsonl", "tracking.jsonl", "domain.jsonl"].map((f) => [f, sha256(join(dir, f))])),
+      outputs: Object.fromEntries(["meta.json", "event.jsonl", "tracking.jsonl", "domain.jsonl", "spadl.csv"].map((f) => [f, sha256(join(dir, f))])),
       stats: { frames, events: events.length, cdf_events: cdfLines.length, score },
       truths: {
         script: scriptTruths(windows, cfg),
PATCH
```

- [ ] **Step 4: Run the tests**

Run: `pnpm --filter @touchline/sim test spadl`
Expected: 6 passed

Run: `pnpm turbo run typecheck test --force`
Expected: `Tasks: 10 successful`

- [ ] **Step 5: Commit**

```bash
git add packages/sim
git commit -m "feat(sim): SPADL view (spadl.csv)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```



### Task 9: Optional realism noise on CDF events

Spec §5.1.9: `--noise on` makes the exported CDF events look like unsynced real data: event times jittered by N(-0.37 s, 1.82 s) (frame ids, match clock and the pass's end frame move together, kept inside the period) and locations by 1 m (a prior), seeded by the match seed; events are marked `is_synced: false` and the manifest records the noise. The domain stream, tracking and SPADL view stay exact: they are the ground truth. Off by default.

**Files:**
- Create: `packages/sim/src/noise.ts`
- Modify: `packages/sim/src/writer.ts`, `packages/sim/src/cdf.ts` (`cdfEventLine(…, synced = true)`), `packages/sim/src/cli.ts`, `packages/sim/src/index.ts`
- Test: `packages/sim/test/noise.test.ts`

**Interfaces:**
- Consumes: `writeMatch`, `cdfEventLine`, `periodsFromFrames`.
- Produces: `REALISM_NOISE {timeMeanS, timeSdS, locationSdM}`, `addRealismNoise(events, cfg, lastFrame?)`; `writeMatch(cfg, dir, {noise?})`; `RunManifest.realism_noise`; CLI `--noise on|off`.

- [ ] **Step 1: Write the failing tests**

Create `packages/sim/test/noise.test.ts`:

```ts
import { mkdtempSync, readFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { Effect } from "effect"
import { describe, expect, it } from "vitest"
import { initMatch, isFinished, step, type DomainEvent } from "@touchline/sim-core"
import { makeConfig } from "@touchline/sim-core/testing"
import { addRealismNoise, REALISM_NOISE } from "../src/noise.js"
import { writeMatch } from "../src/writer.js"

const cfg = makeConfig(4)
let s = initMatch(cfg)
const events: DomainEvent[] = []
while (!isFinished(s)) { const r = step(s); s = r.state; events.push(...r.events) }

describe("realism noise", () => {
  const noisy = addRealismNoise(events, cfg)
  const moved = events.map((e, i) => ({ e, n: noisy[i]! })).filter(({ e }) => e.x !== null && e.type !== "period_start" && e.type !== "period_end")
  it("jitters event times by about N(-0.37 s, 1.82 s)", () => {
    const d = moved.map(({ e, n }) => (n.period_frame_id - e.period_frame_id) * cfg.dt)
    const mean = d.reduce((a, b) => a + b, 0) / d.length
    const sd = Math.sqrt(d.reduce((a, b) => a + (b - mean) ** 2, 0) / d.length)
    expect(mean).toBeGreaterThan(REALISM_NOISE.timeMeanS - 0.15)
    expect(mean).toBeLessThan(REALISM_NOISE.timeMeanS + 0.15)
    expect(sd).toBeGreaterThan(REALISM_NOISE.timeSdS - 0.2)
    expect(sd).toBeLessThan(REALISM_NOISE.timeSdS + 0.2)
  })
  it("moves locations by about the stated spread and keeps them on the pitch", () => {
    const dx = moved.map(({ e, n }) => n.x! - e.x!)
    const sd = Math.sqrt(dx.reduce((a, b) => a + b * b, 0) / dx.length)
    expect(sd).toBeGreaterThan(REALISM_NOISE.locationSdM * 0.8)
    expect(sd).toBeLessThan(REALISM_NOISE.locationSdM * 1.2)
    for (const { n } of moved) {
      expect(Math.abs(n.x!)).toBeLessThanOrEqual(52.5)
      expect(Math.abs(n.y!)).toBeLessThanOrEqual(34)
      expect(n.period_frame_id).toBeGreaterThanOrEqual(0)
    }
  })
  it("is deterministic for a seed, and leaves everything else unchanged", () => {
    expect(addRealismNoise(events, cfg)).toEqual(noisy)
    // Only times (frame ids, the end frame that moves with them, the clock) and coordinates change.
    const mask = { frame_id: 0, period_frame_id: 0, frame_id_end: 0, match_clock: "", x: 0, y: 0, x_end: 0, y_end: 0 }
    noisy.forEach((n, i) => expect({ ...n, ...mask }).toEqual({ ...events[i]!, ...mask }))
  })
})

describe("writing a match with noise", () => {
  it("adds noise to the CDF events only, marks them unsynced, and records it in the manifest", async () => {
    const plain = mkdtempSync(join(tmpdir(), "touchline-plain-")), noisy = mkdtempSync(join(tmpdir(), "touchline-noisy-"))
    await Effect.runPromise(writeMatch(cfg, plain))
    const m = await Effect.runPromise(writeMatch(cfg, noisy, { noise: true }))
    const read = (d: string, f: string) => readFileSync(join(d, f), "utf8")
    expect(read(noisy, "domain.jsonl")).toBe(read(plain, "domain.jsonl"))
    expect(read(noisy, "tracking.jsonl")).toBe(read(plain, "tracking.jsonl"))
    expect(read(noisy, "event.jsonl")).not.toBe(read(plain, "event.jsonl"))
    expect(read(noisy, "event.jsonl")).toMatch(/"is_synced":false/)
    expect(m.realism_noise).toEqual(REALISM_NOISE)
    expect(JSON.parse(read(plain, "manifest.json")).realism_noise).toBeNull()
  })
})
```

- [ ] **Step 2: Run them to make sure they fail**

Run: `pnpm --filter @touchline/sim test noise`
Expected: `Cannot find module '../src/noise.js'`

- [ ] **Step 3: Implement**

Create `packages/sim/src/noise.ts`:

```ts
/**
 * Optional realism noise for exported events (spec §5.1.9): event-time jitter N(-0.37 s, 1.82 s), as measured
 * between real event feeds and tracking, and location noise, so the CDF events look like unsynced real data.
 * Off by default; the domain stream and SPADL view stay exact (they are the ground truth).
 */
import { matchClock, Rng, substream, type DomainEvent, type MatchConfig } from "@touchline/sim-core"

/** Location spread is a prior (about a metre of human tagging error), not fitted. */
export const REALISM_NOISE = { timeMeanS: -0.37, timeSdS: 1.82, locationSdM: 1.0 } as const

const clamp = (v: number, h: number) => Math.max(-h, Math.min(h, v))

/**
 * Noisy copies of `events`: located events get a jittered time (frame ids and match clock follow, kept inside
 * the period: at least frame 0, at most `lastFrame(period)` when given) and jittered coordinates kept on the
 * pitch. Events without a location (match and period markers) are unchanged. Seeded by the match seed.
 */
export const addRealismNoise = (events: ReadonlyArray<DomainEvent>, cfg: MatchConfig, lastFrame?: (period: DomainEvent["period"]) => number): DomainEvent[] => {
  const rng = new Rng(substream(cfg.seed, "realism_noise"))
  const n = REALISM_NOISE
  return events.map((e) => {
    if (e.x === null || e.y === null) return e
    const shift = Math.round((n.timeMeanS + rng.normal() * n.timeSdS) / cfg.dt)
    const last = lastFrame?.(e.period) ?? Infinity
    const pf = Math.min(last, Math.max(0, e.period_frame_id + shift))
    const delta = pf - e.period_frame_id
    const periodStart = e.frame_id - e.period_frame_id
    const jx = rng.normal() * n.locationSdM
    const jy = rng.normal() * n.locationSdM
    return {
      ...e,
      frame_id: e.frame_id + delta,
      period_frame_id: pf,
      // A pass's end moves with it, so the receiver still comes after the pass.
      frame_id_end: e.frame_id_end === null ? null : Math.min(periodStart + last, e.frame_id_end + delta),
      match_clock: matchClock(e.period, pf, cfg.dt),
      x: clamp(e.x + jx, 52.5),
      y: clamp(e.y + jy, 34),
      x_end: e.x_end === null ? null : clamp(e.x_end + jx, 52.5),
      y_end: e.y_end === null ? null : clamp(e.y_end + jy, 34)
    }
  })
}
```

Apply this change to `packages/sim/src/cdf.ts`, `packages/sim/src/writer.ts`, `packages/sim/src/cli.ts`, `packages/sim/src/index.ts` (from the repository root):

```bash
git apply <<'PATCH'
diff --git a/packages/sim/src/cdf.ts b/packages/sim/src/cdf.ts
index 166322a..b800c19 100644
--- a/packages/sim/src/cdf.ts
+++ b/packages/sim/src/cdf.ts
@@ -144,7 +144,15 @@ const BODY = new Set(["left_foot", "right_foot", "feet", "head", "hands", "upper
 /** Timestamp (ms) of a global tick, using the period table built from frames. */
 export type TickClock = (tick: number) => string
 
-export const cdfEventLine = (cfg: MatchConfig, e: DomainEvent, clock: TickClock, periodStartTick: (period: string) => number, receiverTick: number | null): string | null => {
+export const cdfEventLine = (
+  cfg: MatchConfig,
+  e: DomainEvent,
+  clock: TickClock,
+  periodStartTick: (period: string) => number,
+  receiverTick: number | null,
+  /** False when the events carry realism noise (see noise.ts). */
+  synced = true
+): string | null => {
   const t = cdfTypeOf(e)
   if (!t) return null
   const isRef = t.type === "referee"
@@ -182,5 +190,5 @@ export const cdfEventLine = (cfg: MatchConfig, e: DomainEvent, clock: TickClock,
   if (Object.keys(metrics).length) event.metrics = metrics
   const tracking: Record<string, number> = { frame_id: e.frame_id - start }
   if (e.frame_id_end !== null) tracking.frame_id_end = e.frame_id_end - start
-  return JSON.stringify({ match: { id: e.match_id }, meta: { is_synced: true }, event, tracking })
+  return JSON.stringify({ match: { id: e.match_id }, meta: { is_synced: synced }, event, tracking })
 }
diff --git a/packages/sim/src/cli.ts b/packages/sim/src/cli.ts
index e92eba3..5918337 100644
--- a/packages/sim/src/cli.ts
+++ b/packages/sim/src/cli.ts
@@ -22,6 +22,7 @@ const o = cliOptions("touchline-sim: simulate one match and write CDF, domain ev
   away: { default: "", check: oneOf(clubIds), help: "away club id (default: the scenario's, else kestrel-bay)" },
   fps: { default: "10", check: oneOf(["10", "25"]), help: "tracking frames per second" },
   kickoff: { default: "2026-10-18T14:00:00.000Z", check: isoTime, help: "kickoff time, ISO 8601 UTC" },
+  noise: { default: "off", check: oneOf(["off", "on"]), help: "realism noise on the CDF events (time jitter and location noise)" },
   "match-id": { default: "", check: safeName, help: "match id (default m-<seed>); also the output folder name" },
   // Calibrated parameters (Plan 2a) load by default; "default" uses the hand-set priors.
   params: { default: existsSync(defaultParams) ? defaultParams : "default", help: "parameter file, or \"default\" for hand-set priors" },
@@ -47,4 +48,4 @@ const matchId = o["match-id"] || `m-${seed}`
 const club = (id: string) => league.clubs.find((c) => c.id === id)!
 const cfg = { matchId, seed, kickoffTime: o.kickoff, home: club(home), away: club(away), params, dt: 1 / Number(o.fps), ...(scenario ? { script: scenario.script } : {}) }
 const out = here(o.out || join(root, "out", matchId))
-Effect.runPromise(writeMatch(cfg, out)).then((m) => console.log(`${out}: ${JSON.stringify(m.stats)}`))
+Effect.runPromise(writeMatch(cfg, out, { noise: o.noise === "on" })).then((m) => console.log(`${out}: ${JSON.stringify(m.stats)}`))
diff --git a/packages/sim/src/index.ts b/packages/sim/src/index.ts
index 332c018..d3e78cf 100644
--- a/packages/sim/src/index.ts
+++ b/packages/sim/src/index.ts
@@ -5,3 +5,4 @@ export * from "./args.js"
 export * from "./scenarios.js"
 export * from "./truths.js"
 export * from "./spadl.js"
+export * from "./noise.js"
diff --git a/packages/sim/src/writer.ts b/packages/sim/src/writer.ts
index 332f8d7..0139b68 100644
--- a/packages/sim/src/writer.ts
+++ b/packages/sim/src/writer.ts
@@ -5,6 +5,7 @@ import { Effect, Stream } from "effect"
 import { runScript, type DomainEvent, type Frame, type MatchConfig, type WindowResult } from "@touchline/sim-core"
 import { cdfEventLine, cdfMeta, cdfTrackingLine, periodsFromFrames } from "./cdf.js"
 import { hasScript, matchSteps } from "./run.js"
+import { addRealismNoise, REALISM_NOISE } from "./noise.js"
 import { spadlCsv } from "./spadl.js"
 import { criticalErrors, mistakes, scriptTruths, tacticalTruths, type CriticalError, type Mistake, type ScriptTruth, type TeamTruth } from "./truths.js"
 
@@ -20,6 +21,8 @@ export interface RunManifest {
   readonly engine: { readonly name: string; readonly version: string }
   readonly outputs: Readonly<Record<string, string>>
   readonly stats: { readonly frames: number; readonly events: number; readonly cdf_events: number; readonly score: string }
+  /** The noise added to the CDF events (see noise.ts), or null when they are exact. */
+  readonly realism_noise: typeof REALISM_NOISE | null
   /** Ground truth for the evaluation harness (spec §5.1.12, §5.3.1); kept out of CDF. */
   readonly truths: {
     readonly script: ReadonlyArray<ScriptTruth>
@@ -36,7 +39,12 @@ const sha256 = (path: string) => "sha256:" + createHash("sha256").update(readFil
  * Run one match and write meta.json, event.jsonl, tracking.jsonl, domain.jsonl and manifest.json to `dir`.
  * Tracking is streamed to disk; events are kept in memory (a few thousand) to resolve CDF receiver times.
  */
-export const writeMatch = (cfg: MatchConfig, dir: string) =>
+export interface WriteOptions {
+  /** Add realism noise to the CDF events (default off). */
+  readonly noise?: boolean
+}
+
+export const writeMatch = (cfg: MatchConfig, dir: string, opts: WriteOptions = {}) =>
   Effect.gen(function* () {
     // A scripted match is resolved first so its window results are known; a plain match streams step by step.
     const run = hasScript(cfg) ? runScript(cfg) : null
@@ -72,8 +80,13 @@ export const writeMatch = (cfg: MatchConfig, dir: string) =>
     // Flights are emitted when they resolve and carries when they end; files list events in frame order
     // (stable, so events of the same frame keep their emission order).
     const ordered = [...events].sort((a, b) => a.frame_id - b.frame_id)
-    const recv = new Map(events.filter((e) => e.type === "pass" && e.frame_id_end !== null).map((e) => [e.id, e.frame_id_end!]))
-    const cdfLines = ordered.map((e) => cdfEventLine(cfg, e, clock, (p) => periodStart.get(p) ?? 0, recv.get(e.id) ?? null)).filter((x): x is string => x !== null)
+    // CDF events are exact, or carry realism noise when asked (the domain stream and SPADL view stay exact).
+    const periodEnd = new Map(periodsFromFrames(periods).map((p) => [p.period, p.frameIdEnd]))
+    const exported = opts.noise ? addRealismNoise(ordered, cfg, (p) => periodEnd.get(p) ?? 0).sort((a, b) => a.frame_id - b.frame_id) : ordered
+    const recv = new Map(exported.filter((e) => e.type === "pass" && e.frame_id_end !== null).map((e) => [e.id, e.frame_id_end!]))
+    const cdfLines = exported
+      .map((e) => cdfEventLine(cfg, e, clock, (p) => periodStart.get(p) ?? 0, recv.get(e.id) ?? null, !opts.noise))
+      .filter((x): x is string => x !== null)
     writeFileSync(join(dir, "event.jsonl"), cdfLines.join("\n") + "\n")
     writeFileSync(join(dir, "domain.jsonl"), ordered.map((e) => JSON.stringify(e)).join("\n") + "\n")
     writeFileSync(join(dir, "spadl.csv"), spadlCsv(ordered, cfg))
@@ -91,6 +104,7 @@ export const writeMatch = (cfg: MatchConfig, dir: string) =>
       engine: { name: "touchline-sim", version: "0.1.0" },
       outputs: Object.fromEntries(["meta.json", "event.jsonl", "tracking.jsonl", "domain.jsonl", "spadl.csv"].map((f) => [f, sha256(join(dir, f))])),
       stats: { frames, events: events.length, cdf_events: cdfLines.length, score },
+      realism_noise: opts.noise ? REALISM_NOISE : null,
       truths: {
         script: scriptTruths(windows, cfg),
         scripted_events: ordered.filter((e) => e.attrs.scripted === true).map((e) => ({ id: e.id, type: e.type, frame_id: e.frame_id, team_id: e.team_id, player_id: e.player_id })),
PATCH
```

- [ ] **Step 4: Run the tests and validate a noisy match**

Run: `pnpm --filter @touchline/sim test noise`
Expected: 4 passed

Run: `pnpm sim --seed 3 --noise on --match-id m-3-noisy && uv run --project python/analytics python -m touchline_analytics.validate_cdf out/m-3-noisy`
Expected: `meta: ok`, `event: ok`, `tracking: ok`

Run: `pnpm turbo run typecheck test --force`
Expected: `Tasks: 10 successful`

- [ ] **Step 5: Commit**

```bash
git add packages/sim
git commit -m "feat(sim): optional realism noise on CDF events (--noise on)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```



### Task 10: Recalibrate with the new shot model and statistics

A `save_b0` knob (the save model's intercept) joins the tuner, which now also sees blocked share and save rate. The tuner runs in three one-round chunks from the Plan 2b knobs. The press-surge test (Task 5) now compares pressures per 100 opponent passes, the measure the runner uses, because raw pressure counts move with every calibration.

**Files:**
- Modify: `packages/calibrate/src/knobs.ts`, `data/params/calibration-start.json` (full new contents), `README.md`, `packages/sim-core/test/scenario.test.ts`
- Regenerate: `data/params/touchline-params.json`, `docs/realism/realism-report.md`, `data/params/realism-baseline.json`

**Interfaces:**
- Consumes: Tasks 3-4 (statistics, save model).
- Produces: knob `save_b0` (init 1.3, -1..3.5, step 0.25); calibrated parameters; realism report over 19 statistics.

- [ ] **Step 1: Add the knob and the start values**

Apply this change to `packages/calibrate/src/knobs.ts` (from the repository root):

```bash
git apply <<'PATCH'
diff --git a/packages/calibrate/src/knobs.ts b/packages/calibrate/src/knobs.ts
index 097cd4c..d37c5f6 100644
--- a/packages/calibrate/src/knobs.ts
+++ b/packages/calibrate/src/knobs.ts
@@ -68,6 +68,8 @@ export const KNOBS: ReadonlyArray<Knob> = [
       defending: { ...p.defending, crossBlockBehind: share(p.defending.crossBlockBehind * v), headBehind: share(p.defending.headBehind * v), clearSliceBehind: share(p.defending.clearSliceBehind * v) },
       shot: { ...p.shot, blockBehind: share(p.shot.blockBehind * v) }
     }) },
+  { name: "save_b0", what: "keeper save model intercept (save rate, shots on target, goals)", init: DEFAULT_PARAMS.shot.save.b0, min: -1, max: 3.5, step: 0.25,
+    apply: (p, v) => ({ ...p, shot: { ...p.shot, save: { ...p.shot.save, b0: v } } }) },
   { name: "clear_to_touch", what: "share of wide clearances kicked into touch (throw-ins)", init: DEFAULT_PARAMS.defending.clearToTouch, min: 0, max: 0.7, step: 0.1,
     apply: (p, v) => ({ ...p, defending: { ...p.defending, clearToTouch: v } }) }
 ]
PATCH
```

Replace `data/params/calibration-start.json` — full new contents:

```json
{
 "_comment": "Starting knob values for the Plan 2c recalibration (`pnpm calibrate --from data/params/calibration-start.json --matches 12 --rounds 1 --out out/calib-1.json`, then two more chunks): the Plan 2b calibration plus the save_b0 knob at its default. Tuning from here is deterministic and reproduces the knobs, loss and statistics in data/params/touchline-params.json (its fitted_at and version carry the date of the run).",
 "calibration": {
  "knobs": {
   "decision_scale": 0.75,
   "long_bias": 1.25,
   "cross_bias": 0.375,
   "shot_bias": 0,
   "aim_noise": 1.55,
   "xg_b0": -1,
   "exec_scale": 1.15,
   "reach_margin": 0.725,
   "tackle_rate": 0.8,
   "foul_per_tackle": 0.345,
   "yellow_per_foul": 0.15,
   "box_intensity": 2,
   "box_carry": -0.75,
   "loose_share": 0.3,
   "restart_scale": 1.25,
   "shape_width": 1.35,
   "shape_depth": 1.2,
   "shape_speed": 0.9,
   "deflect_behind": 1,
   "clear_to_touch": 0.2,
   "save_b0": 1.3
  }
 }
}
```

Run: `pnpm --filter @touchline/calibrate test tune`
Expected: 8 passed (every knob, `save_b0` included, changes the parameters when moved)

- [ ] **Step 2: Make the press-surge test independent of possession**

Apply this change to `packages/sim-core/test/scenario.test.ts` (from the repository root):

```bash
git apply <<'PATCH'
diff --git a/packages/sim-core/test/scenario.test.ts b/packages/sim-core/test/scenario.test.ts
index 46916be..32a0966 100644
--- a/packages/sim-core/test/scenario.test.ts
+++ b/packages/sim-core/test/scenario.test.ts
@@ -43,9 +43,13 @@ describe("scenario modifiers", () => {
 
 describe("nudges raise the scripted outcome's rate", () => {
   const count = (script: Script | undefined, f: (e: DomainEvent) => boolean) => sum((seed) => play(cfgFor(seed, script)).filter(f).length)
-  it("press surge: the team presses far more", () => {
-    const f = (e: DomainEvent) => e.type === "pressure" && e.team_id === HOME
-    expect(count(one("press_surge"), f)).toBeGreaterThan(1.4 * count(undefined, f))
+  it("press surge: the team presses far more per opponent pass", () => {
+    // Pressures per 100 opponent passes, the measure the scenario runner uses (it does not depend on possession).
+    const rate = (script?: Script) => {
+      const ev = SEEDS.flatMap((seed) => play(cfgFor(seed, script)))
+      return ev.filter((e) => e.type === "pressure" && e.team_id === HOME).length / ev.filter((e) => e.type === "pass" && e.team_id !== HOME).length
+    }
+    expect(rate(one("press_surge"))).toBeGreaterThan(1.3 * rate())
   })
   it("goal: the team scores more", () => {
     const f = (e: DomainEvent) => e.type === "goal" && e.team_id === HOME
PATCH
```

- [ ] **Step 3: Recalibrate in three chunks**

```bash
pnpm calibrate --from data/params/calibration-start.json --matches 12 --rounds 1 --out out/calib-1.json
pnpm calibrate --from out/calib-1.json --matches 12 --rounds 1 --out out/calib-2.json
pnpm calibrate --from out/calib-2.json --matches 12 --rounds 1 --out data/params/touchline-params.json
```

About 45 minutes each; keep the machine awake (`caffeinate -i` on macOS).

Expected: chunk 1 ends `loss 6.97 after 49 evaluations`, chunk 2 `loss 6.43 after 44 evaluations`, chunk 3 `loss 5.19 after 43 evaluations`. The search is deterministic, so the knobs should match: decision_scale 0.75, long_bias 1.25, cross_bias -0.125, shot_bias 0, aim_noise 1.55, xg_b0 -1, exec_scale 1.15, reach_margin 0.725, tackle_rate 0.8, foul_per_tackle 0.405, yellow_per_foul 0.2, box_intensity 1, box_carry -0.75, loose_share 0.3, restart_scale 1.25, shape_width 1.35, shape_depth 1.2, shape_speed 0.9, deflect_behind 1, save_b0 1.3, clear_to_touch 0.1. On the tuning seeds: shots on target 27.3 % (real 35.4 %), blocked 20.9 % (22.7 %), saves 68.8 % (66.9 %), goals 2.33 (2.71), corners 7.3 (8.1), goal kicks 16.5 (17.0).

- [ ] **Step 4: Regenerate the realism report and the gate baseline**

Run: `pnpm realism --matches 16 --out docs/realism/realism-report.md`
Expected: `Summary: 15 within 1 SD, 4 within 2 SD, 0 off.` and `More than 30 % from the real mean: Penalties per match (+104 %).`

Run: `UPDATE_REALISM_BASELINE=1 pnpm --filter @touchline/calibrate test realism-gate`
Expected: 1 passed

Run: `pnpm turbo run typecheck test --force --continue && uv run --project python/analytics --group dev pytest python/analytics/tests -q`
Expected: `Tasks: 10 successful` (the gate logs about `"loss":6.49`; all six scenarios still reach their targets); 11 passed

- [ ] **Step 5: Update the README**

Apply this change to `README.md` (from the repository root):

```bash
git apply <<'PATCH'
diff --git a/README.md b/README.md
index be312c9..27b2e7d 100644
--- a/README.md
+++ b/README.md
@@ -45,7 +45,7 @@ Options for `pnpm sim`: `--seed` (0–4294967295), `--home` / `--away` (club ids
 
 ## Status
 
-The engine runs a full match in about 2 s and its output passes the CDF validator in strict mode. Matches include substitutions, fatigue, first-touch errors, ground duels, keeper claims and punches, blocked crosses and shots, and deflections behind. With the calibrated parameters, 16 held-out simulated matches land within 1 SD of real matches on 13 of 17 statistics and within 2 SD on 3 (see `docs/realism/realism-report.md`); corners (8.4 vs 8.1), goal kicks (18.0 vs 17.0) and goals (2.4 vs 2.7) are close. Known gaps: shots on target are low (20 % vs 35 % of shots; the shot model needs separate block, aim and save steps), cards are low (about 3 vs 5) and penalties high (0.75 vs 0.43).
+The engine runs a full match in about 2 s and its output passes the CDF validator in strict mode. Matches include substitutions, fatigue, first-touch errors, ground duels, keeper claims and punches, blocked crosses and shots, deflections behind, and a shot model with separate block, aim and save steps. Scenario scripts (`pnpm sim --scenario late_comeback`) inject tactical causes and record ground truth in the run manifest; `spadl.csv` gives a SPADL view and `--noise on` imitates unsynced real event data. With the calibrated parameters, 16 held-out simulated matches land within 1 SD of real matches on 15 of 19 statistics and within 2 SD on the other 4 (see `docs/realism/realism-report.md`). Known gaps: penalties run high (0.9 vs 0.4 per match), shots on target low (26 % vs 35 %: goal kicks come mostly from wide shots, while about half of real ones follow attacking balls over the byline) and pass completion low (73 % vs 78 %).
 
 The realism gate (`packages/calibrate/test/realism-gate.test.ts`) runs 16 more held-out matches (seeds 3000–3015). It fails if any statistic moves more than 3.5 standard errors from the committed baseline, or drifts away from the real targets. After an intended engine change, re-run calibration, the realism report and the baseline refresh, and commit all three.
 
PATCH
```

- [ ] **Step 6: Commit**

```bash
git add packages/calibrate/src/knobs.ts packages/sim-core/test/scenario.test.ts data/params docs/realism/realism-report.md README.md
git commit -m "feat(calibrate): save-strength knob; recalibration with blocked share and save rate

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```



### Task 11: Real-player name blocklist

Spec §5.1.6: the fictional league must not use a real player's name. A Python tool asks Wikidata (CC0) for the English names of footballers who played for clubs in the Premier League and the Championship (this is a Premier League product; more leagues can be added later and each run fetches only leagues not saved yet) and stores only hashes: the first 16 hex digits of SHA-256 of the normalised name (NFKD, accents U+0300-U+036F removed, lower case, a-z only), exactly as the league generator's `nameHash`. The public endpoint limits each query to 60 s, so it asks per club, keeps per-club progress and per-league results (an interrupted run resumes), and retries truncated or dropped responses. The league generator already reads the list; the committed league is checked against it.

**Files:**
- Create: `python/analytics/touchline_analytics/blocklist.py`, `python/analytics/tests/test_blocklist.py`
- Modify: `packages/league/test/league.test.ts`
- Create (generated): `data/blocklist/real-player-name-hashes.txt`, `data/blocklist/real-player-name-hashes.meta.json`, `data/blocklist/leagues/*.txt`; regenerate `data/league/league.json`

**Interfaces:**
- Consumes: `generateLeague(seed, blocked)` and `nameHash` (packages/league).
- Produces: Python `normalise_name`, `name_hash`, `LEAGUES`, `clubs_query`, `players_query`, `club_ids`, `hashes_from_sparql`, `fetch`, `build(out)`; CLI `python -m touchline_analytics.blocklist`.

- [ ] **Step 1: Write the failing tests**

Create `python/analytics/tests/test_blocklist.py`:

```python
from touchline_analytics.blocklist import LEAGUES, club_ids, clubs_query, hashes_from_sparql, name_hash, normalise_name, players_query


def test_hashes_match_the_league_generator():
    # Reference values from packages/league (nameHash / normaliseName in TypeScript).
    assert normalise_name("Thomas Müller") == "thomasmuller"
    assert name_hash("Thomas Müller") == "2b26ea3743238a83"
    assert name_hash("Kylian Mbappé") == "1ebf48ca8571b5e0"
    assert name_hash("Martin Ødegaard") == "7a052cd791b54af5"
    assert name_hash("Son Heung-min") == "e070d11e25151584"
    assert name_hash("N'Golo Kanté") == "2171085eadaef891"


def test_hashes_from_a_sparql_result_are_unique_and_skip_empty_names():
    result = {"results": {"bindings": [
        {"label": {"type": "literal", "value": "Thomas Müller", "xml:lang": "en"}},
        {"label": {"type": "literal", "value": "Thomas Muller", "xml:lang": "en"}},
        {"label": {"type": "literal", "value": "123", "xml:lang": "en"}},
    ]}}
    assert hashes_from_sparql(result) == {"2b26ea3743238a83"}


def test_queries_ask_for_a_league_s_clubs_then_each_club_s_footballers():
    assert "wd:Q9448" in clubs_query(LEAGUES["Premier League"]) and "P118" in clubs_query("Q9448")
    q = players_query("Q18656")
    assert "wd:Q18656" in q and "wd:Q937857" in q and "P54" in q
    result = {"results": {"bindings": [{"club": {"type": "uri", "value": "http://www.wikidata.org/entity/Q18656"}}, {"club": {"type": "uri", "value": "http://www.wikidata.org/entity/Q9617"}}]}}
    assert club_ids(result) == ["Q18656", "Q9617"]


def test_build_saves_each_league_and_resumes_without_fetching_it_again(tmp_path, monkeypatch):
    from touchline_analytics import blocklist

    calls = []

    def fake_fetch(query):
        calls.append(query)
        if "P118" in query:
            return {"results": {"bindings": [{"club": {"value": "http://www.wikidata.org/entity/Q1"}}]}}
        return {"results": {"bindings": [{"label": {"value": "Thomas Müller"}}]}}

    monkeypatch.setattr(blocklist, "fetch", fake_fetch)
    monkeypatch.setattr(blocklist, "LEAGUES", {"A": "Q10", "B": "Q20"})
    monkeypatch.setattr(blocklist.time, "sleep", lambda s: None)
    out = tmp_path / "hashes.txt"
    (tmp_path / "leagues").mkdir()
    (tmp_path / "leagues" / "A.txt").write_text("2171085eadaef891\n")  # league A already fetched
    meta = blocklist.build(out)
    assert all("Q10" not in q for q in calls)  # A was not fetched again
    assert (tmp_path / "leagues" / "B.txt").read_text() == "2b26ea3743238a83\n"
    assert out.read_text() == "2171085eadaef891\n2b26ea3743238a83\n"
    assert meta["names_per_league"] == {"A": 1, "B": 1}


def test_an_interrupted_league_resumes_at_its_next_club(tmp_path, monkeypatch):
    from touchline_analytics import blocklist

    fetched = []

    def fake_fetch(query):
        if "P118" in query:
            return {"results": {"bindings": [{"club": {"value": f"http://www.wikidata.org/entity/Q{i}"}} for i in (1, 2)]}}
        fetched.append(query)
        return {"results": {"bindings": [{"label": {"value": "Kylian Mbappé"}}]}}

    monkeypatch.setattr(blocklist, "fetch", fake_fetch)
    monkeypatch.setattr(blocklist, "LEAGUES", {"A": "Q10"})
    monkeypatch.setattr(blocklist.time, "sleep", lambda s: None)
    (tmp_path / "leagues").mkdir()
    (tmp_path / "leagues" / "A.partial").write_text("Q1\t2b26ea3743238a83\n")  # club Q1 done before the interruption
    blocklist.build(tmp_path / "hashes.txt")
    assert len(fetched) == 1 and "wd:Q2" in fetched[0]
    assert (tmp_path / "leagues" / "A.txt").read_text() == "1ebf48ca8571b5e0\n2b26ea3743238a83\n"
    assert not (tmp_path / "leagues" / "A.partial").exists()
```

Apply this change to `packages/league/test/league.test.ts` (from the repository root):

```bash
git apply <<'PATCH'
diff --git a/packages/league/test/league.test.ts b/packages/league/test/league.test.ts
index 9e01a5a..6e7fe4e 100644
--- a/packages/league/test/league.test.ts
+++ b/packages/league/test/league.test.ts
@@ -1,5 +1,8 @@
+import { existsSync, readFileSync } from "node:fs"
+import { dirname, join } from "node:path"
+import { fileURLToPath } from "node:url"
 import { describe, expect, it } from "vitest"
-import { contrast, generateLeague, nameHash } from "../src/league.js"
+import { contrast, generateLeague, nameHash, type League } from "../src/league.js"
 
 describe("league", () => {
   const L = generateLeague(2026, new Set())
@@ -28,4 +31,13 @@ describe("league", () => {
     const names = L.clubs.flatMap((c) => c.squad.map((p) => p.name))
     expect(new Set(names).size).toBe(names.length)
   })
+  it("the committed league uses no name on the committed real-player blocklist", () => {
+    const root = join(dirname(fileURLToPath(import.meta.url)), "../../..")
+    const file = join(root, "data/blocklist/real-player-name-hashes.txt")
+    expect(existsSync(file)).toBe(true)
+    const blocked = new Set(readFileSync(file, "utf8").split("\n").filter(Boolean))
+    expect(blocked.size).toBeGreaterThan(10_000)
+    const league = JSON.parse(readFileSync(join(root, "data/league/league.json"), "utf8")) as League
+    for (const c of league.clubs) for (const p of c.squad) expect(blocked.has(nameHash(p.name)), p.name).toBe(false)
+  })
 })
PATCH
```

- [ ] **Step 2: Run them to make sure they fail**

Run: `uv run --project python/analytics --group dev pytest python/analytics/tests -q`
Expected: errors: `No module named 'touchline_analytics.blocklist'`

Run: `pnpm --filter @touchline/league test`
Expected: 1 failed: `the committed league uses no name on the committed real-player blocklist` (no list yet)

- [ ] **Step 3: Write the tool**

Create `python/analytics/touchline_analytics/blocklist.py`:

```python
"""Real-player name blocklist for the fictional league (spec §5.1.6).

Names of footballers who played for clubs in major leagues come from Wikidata (CC0) and are stored only as
hashes in data/blocklist/real-player-name-hashes.txt; the league generator (packages/league) never uses a
generated name whose hash is on the list. Normalisation and hashing match `normaliseName` / `nameHash` there.

Usage: uv run --project python/analytics python -m touchline_analytics.blocklist
"""

from __future__ import annotations

import datetime as dt
import hashlib
import http.client
import json
import re
import time
import unicodedata
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

ENDPOINT = "https://query.wikidata.org/sparql"
USER_AGENT = "touchline-hackathon/0.1 (synthetic football data; real-player name blocklist)"
FOOTBALLER = "Q937857"  # occupation: association football player
# Wikidata ids of the leagues whose clubs' players are blocked (checked 2026-10-05). The English leagues come
# first: this is a Premier League product. More can be added later (each run fetches only leagues not saved yet),
# e.g. "Bundesliga": "Q82595", "La Liga": "Q324867", "Serie A": "Q15804", "Ligue 1": "Q13394", "Primeira Liga": "Q182994".
LEAGUES: dict[str, str] = {
    "Premier League": "Q9448",
    "EFL Championship": "Q19510",
}


def normalise_name(name: str) -> str:
    """NFKD, drop combining accents (U+0300-U+036F), lower case, letters a-z only: as normaliseName in TypeScript."""
    decomposed = unicodedata.normalize("NFKD", name)
    stripped = "".join(c for c in decomposed if not 0x300 <= ord(c) <= 0x36F)
    return re.sub(r"[^a-z]", "", stripped.lower())


def name_hash(name: str) -> str:
    return hashlib.sha256(normalise_name(name).encode()).hexdigest()[:16]


def clubs_query(league_id: str) -> str:
    """Clubs that have played in the league (one query per league is small)."""
    return f"SELECT DISTINCT ?club WHERE {{ ?club wdt:P118 wd:{league_id} . }}"


def players_query(club_id: str) -> str:
    """English labels of footballers who played for the club (one club per query keeps under the 60 s limit)."""
    return (
        "SELECT DISTINCT ?label WHERE { "
        f"?p wdt:P54 wd:{club_id} ; wdt:P106 wd:{FOOTBALLER} . "
        '?p rdfs:label ?label . FILTER(LANG(?label) = "en") }'
    )


def club_ids(result: dict) -> list[str]:
    return sorted({b["club"]["value"].rsplit("/", 1)[-1] for b in result["results"]["bindings"]})


def hashes_from_sparql(result: dict) -> set[str]:
    out = set()
    for b in result["results"]["bindings"]:
        label = b["label"]["value"]
        if normalise_name(label):
            out.add(name_hash(label))
    return out


def fetch(query: str, attempts: int = 5) -> dict:
    """Run a SPARQL query. A response cut off by the endpoint's time limit (invalid JSON), a dropped connection
    a truncated body or a 429/5xx answer is retried after 10, 20, 40, 80 s."""
    url = ENDPOINT + "?" + urllib.parse.urlencode({"query": query, "format": "json"})
    req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT, "Accept": "application/sparql-results+json"})
    for i in range(attempts):
        try:
            with urllib.request.urlopen(req, timeout=120) as resp:
                return json.load(resp)
        except urllib.error.HTTPError as e:
            if e.code != 429 and e.code < 500 or i == attempts - 1:
                raise
        except (json.JSONDecodeError, urllib.error.URLError, http.client.HTTPException, ConnectionError, TimeoutError):
            if i == attempts - 1:
                raise
        time.sleep(10 * 2**i)
    raise AssertionError("unreachable")


def build(out: Path) -> dict:
    """Fetch every league not fetched yet (each saved as soon as it is done, in a `leagues/` folder next to
    `out`, so an interrupted run resumes where it stopped), then write the combined, sorted hash list."""
    per_league = out.parent / "leagues"
    per_league.mkdir(parents=True, exist_ok=True)
    counts = {}
    hashes: set[str] = set()
    for name, qid in LEAGUES.items():
        path = per_league / f"{name}.txt"
        if not path.exists():
            # Progress is kept per club ("club<TAB>hash" lines), so an interrupted league resumes at its next club.
            partial = per_league / f"{name}.partial"
            done: dict[str, set[str]] = {}
            if partial.exists():
                for line in partial.read_text().split("\n"):
                    if line:
                        club, _, h = line.partition("\t")
                        done.setdefault(club, set()).update([h] if h else [])
            with partial.open("a") as fh:
                for club in club_ids(fetch(clubs_query(qid))):
                    if club in done:
                        continue
                    found = hashes_from_sparql(fetch(players_query(club)))
                    fh.write("".join(f"{club}\t{h}\n" for h in sorted(found)) or f"{club}\t\n")
                    fh.flush()
                    done[club] = found
                    time.sleep(0.5)  # be polite to the public endpoint
            league = set().union(*done.values()) if done else set()
            path.write_text("".join(f"{h}\n" for h in sorted(league)))
            partial.unlink()
            print(f"{name}: {len(league)} names", flush=True)
        league_hashes = {line for line in path.read_text().split("\n") if line}
        counts[name] = len(league_hashes)
        hashes |= league_hashes
    out.write_text("".join(f"{h}\n" for h in sorted(hashes)))
    meta = {
        "source": "Wikidata (CC0 1.0): English labels of association football players (P106 Q937857) who played for (P54) a club in each league (P118)",
        "leagues": LEAGUES,
        "names_per_league": counts,
        "hashes": len(hashes),
        "hash": "sha256 of the normalised name (NFKD, accents removed, lower case, a-z only), first 16 hex digits",
        "fetched_at": dt.date.today().isoformat(),
    }
    out.with_suffix(".meta.json").write_text(json.dumps(meta, indent=1) + "\n")
    return meta


if __name__ == "__main__":
    print(json.dumps(build(Path("data/blocklist/real-player-name-hashes.txt")), indent=1))
```

- [ ] **Step 4: Run the Python tests**

Run: `uv run --project python/analytics --group dev pytest python/analytics/tests -q`
Expected: 16 passed (the hashes match the TypeScript ones for accented names)

- [ ] **Step 5: Fetch the names (one-off, network; about two hours on the public endpoint)**

Behind a TLS-inspecting proxy Python may reject the endpoint's certificate; export the system's trusted certificates and point Python at them (do not commit the file):

```bash
security find-certificate -a -p /Library/Keychains/System.keychain /System/Library/Keychains/SystemRootCertificates.keychain > /tmp/certs.pem   # macOS
SSL_CERT_FILE=/tmp/certs.pem uv run --project python/analytics python -m touchline_analytics.blocklist
```

Re-run the same command if it stops: finished leagues and clubs are kept.
Expected: one line per league (`Premier League: 13948 names`, `EFL Championship: 15194 names`); `data/blocklist/real-player-name-hashes.txt` holds 22671 hashes

- [ ] **Step 6: Regenerate the league against the list**

Run: `pnpm league && pnpm --filter @touchline/league test`
Expected: `wrote 8 clubs, 160 players (blocklist: 22671 hashes)`; `git diff data/league/league.json` is empty (no generated name is on the list); 7 passed

- [ ] **Step 7: Run everything**

Run: `pnpm turbo run typecheck test --force && uv run --project python/analytics --group dev pytest python/analytics/tests -q`
Expected: `Tasks: 10 successful`; 16 passed

- [ ] **Step 8: Commit**

```bash
git add python/analytics packages/league/test/league.test.ts data/blocklist data/league/league.json
git commit -m "feat: real-player name blocklist from Wikidata (hashes only)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```



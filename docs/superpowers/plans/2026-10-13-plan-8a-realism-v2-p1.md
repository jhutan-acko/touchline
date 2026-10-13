# Realism v2, P1: correctness and cheap wins — implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Teams switch ends at half-time, the keeper's two kinds of possession are told apart (no phantom chances from his distribution), cards are realistic, and the realism report measures the restated C3 (shot-share spread) on 64 matches. The phase ends with the gate green on recalibrated parameters.

**Architecture:**
- **T6, half-time.** The attacking direction becomes a function of side **and** period (`dirOf(side, period)`). The compiler finds every caller, and each gets the period from the engine's `Work.period`, an event's or frame's `period`, or a `MatchState`'s `period`.
- **G1/G2 and T1.** These are new behaviours behind params that default to the old behaviour, with two new named RNG streams. With the defaults the engine is bit-identical, which the gate drift check proves.
- **T5.** A Python report section and a `realism:deep` command.
- **Last task.** Switches the behaviours on, recalibrates, re-baselines and re-pins.

**Tech stack:** TypeScript (Effect monorepo, vitest), Python 3 (uv, pytest), pnpm 11.

**Spec:** `docs/superpowers/specs/2026-10-13-sim-realism-v2-design.md` (section P1 and "Evaluation changes"). The evidence behind the numbers is in `touchline-worktrees/analysis-positioning/` (`tackles-report.md`, `gk-report.md`, `dominance-report.md`), which is outside the repo.

## Setup (before Task 1)

```bash
cd /Users/jhutan.debnath/Documents/GitHub/microsoft-hackathon/touchline
git worktree add ../touchline-worktrees/realism-v2-p1 -b realism-v2-p1
cd ../touchline-worktrees/realism-v2-p1 && pnpm install
```

Every path below is relative to that worktree.

## Global Constraints

- The engine stays deterministic for a seed. New random behaviour draws only from its own named stream (`keeper`, `caution`), so existing streams keep their sequences.
- Each new behaviour ships with a default that reproduces the old engine. Only Task 6 changes those defaults.
- Only aggregate real-data statistics are committed. Never commit `data/raw/`.
- Do not modify `decide.ts`, `execute.ts`, `resolve.ts` or `shot.ts` beyond threading the period argument; their logic belongs to later phases.
- Run the whole TS suite with `pnpm test -- --no-file-parallelism`. In parallel, full-match tests time out.
- Realism gate: loss < `GATE_LOSS` 30 (`packages/calibrate/test/realism-gate.test.ts`). Never widen it, and never drop a statistic.
- Every commit message ends with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- **Period convention.** Wherever a function needs the attacking direction, it takes `period: Period` **immediately after its `side` argument** (or as a `period` field on an input object that has a `side` or `owner`).

## Review Focus

1. **Goals in stoppage time and own goals.** A goal in second-half stoppage time, or an own goal in the second half, is credited to the side attacking that end. The full-match test in Task 1 checks every goal, own goals included.
2. **A keeper picking up a loose ball.** If his own teammate touched it last, he has it at his feet: he can be tackled, and there is no long hold (the back-pass law). If an opponent touched it last, he has it in his hands. Covered by the unit test of `keeperInHands` in Task 3.
3. **The ball carrier sent off by a caution.** A booked carrier who gets a second, non-foul caution while on the ball leaves the ball loose, and the match finishes normally. Covered by the high-caution-rate test in Task 4.
4. **Stored match folders from the old convention.** Folders under `out/` written before T6 would fail the what-if rebuild ("does not match the match rebuilt"). Task 6 regenerates the library, and the reviewer checks that the API's library folders were rebuilt.
5. **Second-half exports.** SPADL rotates second-half events back into socceraction's stored frame, and CDF meta swaps `play_direction` and the left and right teams. Covered by the new second-half cases in Task 2.

---

### Task 1: Attacking direction depends on the period (sim-core)

**Files:**
- Modify: `packages/sim-core/src/geometry.ts`, `types.ts` (re-export `Period`), `classify.ts`, `deflect.ts`, `decide.ts`, `offball.ts`, `resolve.ts`, `shape.ts`, `shot.ts`, `step.ts`, `runner.ts`, `whatif.ts`
- Test: `packages/sim-core/test/halftime.test.ts` (new); update `geometry-classify.test.ts`, `shape.test.ts`, `offball.test.ts`, `letrun.test.ts`, `wide.test.ts`, `scenario.test.ts`, `backpass.test.ts`, `carrier.test.ts`, and any other test the compiler flags

**Interfaces:**
- Produces (in `geometry.ts`):
  - `type Period = "first_half" | "second_half"`
  - `dirOf(side: Side, period: Period): 1 | -1`
  - `attackX(side: Side, x: number, period: Period): number`
  - `goalOf(side: Side, period: Period): Vec2`
  - `sideAttacking(x: number, period: Period): Side`: the side attacking the end with sign `x`
  - `actionZone(side, period, p)`
  - `goalAngle(side, period, p)`
- Produces (input objects and functions):
  - `DecisionInput.period: Period`
  - `PassGeometry.period: Period`
  - `inOwnBox(side, period, at)`
  - `anchorFor(formation, slot, side, period, ball, style, inPossession, spread?)`
  - `kickoffAnchor(formation, slot, side, period, style)`
  - every other direction-using function: `period` right after `side`
- `attackX` keeps `x` second and adds `period` third, because downstream packages call it as `attackX(side, x, period)`.

- [ ] **Step 1: Write the failing test** (`packages/sim-core/test/halftime.test.ts`)

```ts
import { describe, expect, it } from "vitest"
import { attackX, dirOf, goalOf, sideAttacking, type Side } from "../src/geometry.js"
import { initMatch, isFinished, step } from "../src/step.js"
import { makeConfig } from "../src/testing.js"
import type { DomainEvent, Frame, MatchConfig } from "../src/types.js"

const play = (cfg: MatchConfig) => {
  let s = initMatch(cfg)
  const events: DomainEvent[] = []
  const frames: Frame[] = []
  while (!isFinished(s)) {
    const r = step(s)
    s = r.state
    events.push(...r.events)
    if (r.frame) frames.push(r.frame)
  }
  return { s, events, frames }
}
const sideOf = (cfg: MatchConfig, teamId: string | null): Side => (teamId === cfg.home.id ? "home" : "away")

describe("teams switch ends at half-time", () => {
  it("home attacks +x in the first half and -x in the second; away the reverse", () => {
    expect(dirOf("home", "first_half")).toBe(1)
    expect(dirOf("home", "second_half")).toBe(-1)
    expect(dirOf("away", "first_half")).toBe(-1)
    expect(dirOf("away", "second_half")).toBe(1)
    expect(attackX("home", 30, "second_half")).toBe(-30)
    expect(goalOf("away", "second_half")).toEqual({ x: 52.5, y: 0 })
    expect(sideAttacking(50, "first_half")).toBe("home")
    expect(sideAttacking(50, "second_half")).toBe("away")
  })

  it("credits every goal, own goals included, to the side attacking that end, in both halves", () => {
    let secondHalfGoals = 0
    for (const seed of [7, 8, 9]) {
      const cfg = makeConfig(seed)
      const { s, events } = play(cfg)
      const goals = events.filter((e) => e.type === "goal")
      for (const g of goals) expect(sideOf(cfg, g.team_id)).toBe(sideAttacking(g.x!, g.period))
      secondHalfGoals += goals.filter((g) => g.period === "second_half").length
      expect(goals.filter((g) => sideOf(cfg, g.team_id) === "home").length).toBe(s.score.home)
    }
    expect(secondHalfGoals).toBeGreaterThan(0)
  }, 300_000)

  it("kicks off the second half with each team in the other half, and shoots at the other goal", () => {
    const cfg = makeConfig(7)
    const { events, frames } = play(cfg)
    const first2 = frames.find((f) => f.period === "second_half")!
    const meanX = (ps: Frame["home"]) => ps.reduce((a, p) => a + p.x, 0) / ps.length
    expect(meanX(first2.home)).toBeGreaterThan(0)
    expect(meanX(first2.away)).toBeLessThan(0)
    const homeShots2 = events.filter((e) => e.type === "shot" && e.period === "second_half" && sideOf(cfg, e.team_id) === "home")
    expect(homeShots2.length).toBeGreaterThan(0)
    expect(homeShots2.filter((e) => e.x! < 0).length / homeShots2.length).toBeGreaterThan(0.9)
  }, 120_000)
})
```

`MatchState.score` is `{ home, away }`. Check `types.ts`; if the field is named differently, use that name.

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter @touchline/sim-core exec vitest run test/halftime.test.ts`
Expected: FAIL. TypeScript or vitest reports that `sideAttacking` doesn't exist, or `dirOf` ignores the period.

- [ ] **Step 3: Change the helpers** (`packages/sim-core/src/geometry.ts`)

Replace the `dirOf` line and the `attackX`/`goalOf` definitions:

```ts
/** First or second half. Teams switch ends at half-time. */
export type Period = "first_half" | "second_half"
/** +1 if the side attacks +x in this period: home in the first half, away in the second. */
export const dirOf = (side: Side, period: Period): 1 | -1 => ((side === "home") === (period === "first_half") ? 1 : -1)
/** The side attacking the end whose x has the sign of `x` (x > 0: the +x end). */
export const sideAttacking = (x: number, period: Period): Side => (dirOf("home", period) === (x > 0 ? 1 : -1) ? "home" : "away")
```

```ts
export const attackX = (side: Side, x: number, period: Period): number => x * dirOf(side, period)
export const goalOf = (side: Side, period: Period): Vec2 => ({ x: PITCH.halfL * dirOf(side, period), y: 0 })
```

Give `actionZone` and `goalAngle` a `period` argument after `side`, and pass it to their `attackX`/`goalOf` calls. Change the file's header comment to: `/** Pitch geometry in CDF coordinates: metres, origin at the centre spot; home attacks +x in the first half, -x in the second. */`

In `types.ts`, replace `export type Period = "first_half" | "second_half"` with `export type { Period } from "./geometry.js"`.

- [ ] **Step 4: Thread the period through the engine** (compiler-driven)

Run: `pnpm --filter @touchline/sim-core exec tsc --noEmit -p .`

Fix every error with the period convention (Global Constraints). Where the period comes from:

| Location | Period source |
|---|---|
| `step.ts` | `w.period` |
| `runner.ts` | the event's `e.period` |
| `whatif.ts:163` | `end.period` |
| `decide.ts` | `input.period`: add `readonly period: Period` to `DecisionInput`, and set `period: w.period` in the `input` object in `step.ts` `ownerDecision` |
| `classify.ts` | `g.period`: add `readonly period: Period` to `PassGeometry`, and pass it from `buildCandidates` (`period: input.period`) and from any `classifyPass` call in `step.ts` |
| `offball.ts`, `shape.ts`, `shot.ts`, `deflect.ts`, `resolve.ts` | a `period: Period` parameter right after the side argument; callers pass `w.period` |

Three places don't call a helper and must be changed by hand:

- `step.ts` `restartFromOut`: add `period: Period` as a third parameter, and replace the line `const defending: Side = end > 0 ? "away" : "home"` with:
  ```ts
  // The side defending the end the ball went out at: the one not attacking it this period.
  const defending: Side = other(sideAttacking(end, period))
  ```
  Callers pass `w.period`.
- `step.ts` goal from a flight (about line 662): replace `const scoringSide: Side = res.ball.pos.x > 0 ? "home" : "away"` with `const scoringSide: Side = sideAttacking(res.ball.pos.x, w.period)`.
- `step.ts` loose-ball goal (about line 981): replace `const scoringSide: Side = cross.x > 0 ? "home" : "away"` with `const scoringSide: Side = sideAttacking(cross.x, w.period)`.
- `runner.ts` `defensive_error` (about line 88): replace `const attack = entry.team === "home" ? 1 : -1` and the `(e.x ?? 0) * attack < 0` test with `attackX(entry.team, e.x ?? 0, e.period) < 0`.

At half-time (`endPeriod`, about line 1212) the kickoff positions use the new period. The second-half reset runs after `w.period` is set to `"second_half"`; check that line, and if `w.period` is assigned after the `map`, move the assignment before it. Call `kickoffAnchor(team.formation, pl.slot, pl.side, "second_half", team.style)`. In `initMatch` (about line 83), pass `"first_half"`.

Repeat the `tsc` run until it reports no errors.

- [ ] **Step 5: Update the existing sim-core tests**

Run: `pnpm --filter @touchline/sim-core exec tsc --noEmit -p test 2>/dev/null || pnpm --filter @touchline/sim-core typecheck`

Update the tests the compiler flags:

- **Unit tests on hand-built states** (`geometry-classify.test.ts`, `shape.test.ts`, `offball.test.ts`, `letrun.test.ts`, `backpass.test.ts`, `carrier.test.ts` and any other): pass `"first_half"`, or add `period: "first_half"` to `DecisionInput` literals. Their expectations stay the same.
- **Full-match tests that read event coordinates:**
  - `wide.test.ts:28`: change the helper to `inOwnBox = (side: Side, x: number, y: number, period: Period) => attackX(side, x, period) < -(PITCH.halfL - PITCH.boxDepth) && Math.abs(y) < PITCH.boxHalfWidth` and pass `e.period` at lines 38 and 63.
  - `wide.test.ts:70`: `attackX(sideOf(r.cfg, e.team_id), e.x!, e.period) < -17.5`.
  - `scenario.test.ts:100`: replace `e.x! < 0` with `attackX("home", e.x!, e.period) < 0`.
  - `scenario.test.ts:134`: `expect(attackX("home", pass.x!, pass.period)).toBeLessThan(0)`.

- [ ] **Step 6: Run the sim-core suite and the gate drift check**

Run: `pnpm --filter @touchline/sim-core test -- --no-file-parallelism`
Expected: PASS, including `halftime.test.ts`.

Run: `pnpm --filter @touchline/calibrate exec vitest run test/realism-gate.test.ts --disableConsoleIntercept`
Expected: PASS. The first halves are bit-identical. The second halves are mirrored and statistically equivalent, so every drift |z| stays under `DRIFT_Z` 3.5 and the loss stays under 30.
- **If it fails:** a statistic drifted. That means a direction site was missed (look for a second-half statistic that's way off, e.g. goals or final-third passes), not that the gate is wrong. Find the site; don't refresh the baseline.

- [ ] **Step 7: Commit**

```bash
git add packages/sim-core
git commit -m "feat(sim-core): teams switch ends at half-time — dirOf/attackX/goalOf take the period; goals, restarts and kickoff shapes follow it

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Readers of match data follow the period

**Files:**
- Modify:
  - `packages/stats/src/engine.ts:325,337,345,349` and the `addThreat` callers at about 254 and 329
  - `packages/stats/src/derive.ts:21,29`
  - `packages/advisor/src/value.ts:5,17,30`
  - `apps/api/src/whatif.ts:85-87`
  - `packages/sim/src/spadl.ts:1-8,107-109`
  - `packages/sim/src/cdf.ts:44,49-50`
  - `packages/rpc/src/contracts.ts:55`
  - `docs/superpowers/specs/2026-10-03-touchline-design.md:199`
- Test: `packages/sim/test/spadl.test.ts`, `packages/sim/test/cdf.test.ts` (or the existing CDF meta test; find it with `grep -rln cdfMeta packages/sim/test`)
- Regenerate: `packages/stats/test/golden/late-comeback-4245.json`, `packages/manager/test/golden/situation-m-11-minute_60.json`

**Interfaces:**
- Consumes: `dirOf(side, period)`, `attackX(side, x, period)` from Task 1 (exported by `@touchline/sim-core`).
- Produces: `addThreat(team, tick, period, x, y, xEnd, yEnd)` in `stats/src/engine.ts` (private).

- [ ] **Step 1: Write the failing export tests**

In `packages/sim/test/spadl.test.ts`, add inside `describe("SPADL view", ...)`, next to the existing first-half case and reusing its `one`/`ev` helpers:

```ts
  it("rotates second-half events back into the stored frame (home still left to right)", () => {
    const home = one({ ...ev("pass", H, { kind: "short" }, { outcome: "successful" }), period: "second_half", x: 0, y: 0, x_end: 10, y_end: 5 })
    expect([home.start_x, home.start_y, home.end_x, home.end_y]).toEqual([52.5, 34, 42.5, 29])
  })
```

If `ev` sets `x/y/x_end/y_end` differently from the first case (0, 0, 10, 5), keep the override above; it makes the input explicit.

In the CDF meta test, add a case asserting that the second period has `play_direction: "right_left"`, `left_team_id: <away id>` and `right_team_id: <home id>`, and the first period `"left_right"`, home and away.

Run: `pnpm --filter @touchline/sim exec vitest run test/spadl.test.ts`
Expected: FAIL (it gets `[52.5, 34, 62.5, 39]`).

- [ ] **Step 2: Fix the exports**

`spadl.ts`: replace the comment and the two lambdas at 107-109:

```ts
    // socceraction's stored frame has home attacking left to right all match; second-half events are rotated back.
    const m = e.period === "second_half" ? -1 : 1
    const sx = (x: number) => clamp(m * x + 52.5, 105)
    const sy = (y: number) => clamp(m * y + 34, 68)
```

In the header comment (lines 1-8), change "the home team attacks left to right" to "the home team attacks left to right in both halves (second-half events are rotated back, since the teams switch ends)".

`cdf.ts` `periods.map((p) => ({ ... }))`:

```ts
    periods: periods.map((p) => {
      const second = p.period === "second_half"
      return {
        period: p.period,
        play_direction: second ? "right_left" : "left_right",
        start_time: iso(p.startMs),
        end_time: iso(p.endMs),
        frame_id_start: 0,
        frame_id_end: p.frameIdEnd,
        left_team_id: second ? cfg.away.id : cfg.home.id,
        right_team_id: second ? cfg.home.id : cfg.away.id
      }
    }),
```

Run: `pnpm --filter @touchline/sim test -- --no-file-parallelism`
Expected: PASS

- [ ] **Step 3: Fix the stats engine, derive, advisor and API**

`stats/src/engine.ts`:
- At 325: `const ax = attackX(team.side, e.x!, e.period)`.
- At 337: `const attack = dirOf(team.side, e.period)`; add `dirOf` to the `@touchline/sim-core` import.
- At 345: `attackX(team.side, e.x, e.period)`.
- `addThreat` gains `period: Period` after `tick`, using `const attack = dirOf(team.side, period)`; both callers pass `e.period`.

`stats/src/derive.ts`: replace both `side === "home" ? 1 : -1` with `dirOf(side, e.period)`.

`advisor/src/value.ts`:
- Delete `attackOf`.
- Use `dirOf(side, s.period)` and `dirOf(other(side), s.period)` in `passValue`, and `dirOf(owner.side, s.period)` in `xtEndValue`.
- Import `dirOf` and `other` from `@touchline/sim-core`.

`apps/api/src/whatif.ts` `scanChunk`:

```ts
  const attacking = events.filter((e) => {
    const st = session.stateAt(e.frame_id - 1)
    const p = st.players.find((q) => q.id === e.player_id)
    return p !== undefined && attackX(p.side, p.pos.x, st.period) > SCAN_MIN_X
  })
```

Wording:
- `rpc/src/contracts.ts:55`: append "in the first half; reversed in the second".
- `docs/superpowers/specs/2026-10-03-touchline-design.md:199`: replace "the home team attacks +x for the whole match" with "the home team attacks +x in the first half and -x in the second (teams switch ends)".

Run: `pnpm typecheck`
Expected: PASS across the workspace. Fix any remaining `attackX`/`dirOf`/`goalOf` callers the compiler reports, using the same rules.

- [ ] **Step 4: Regenerate the goldens and run the affected suites**

Run:

```bash
UPDATE_STATS_GOLDEN=1 pnpm --filter @touchline/stats exec vitest run test/replay.test.ts
UPDATE_GOLDEN=1 pnpm --filter @touchline/manager exec vitest run test/situation.test.ts
pnpm --filter @touchline/stats --filter @touchline/advisor --filter @touchline/manager --filter @touchline/api --filter @touchline/sim test -- --no-file-parallelism
```

Expected: PASS. `packages/stats/test/models.test.ts` (parity with Python `run_features`, already period-aware) must pass without changes. Open `git diff` on the two golden files and check that the changes are plausible: the same match, second-half xG and PPDA at similar magnitudes.

- [ ] **Step 5: Commit**

```bash
git add packages apps docs/superpowers/specs/2026-10-03-touchline-design.md
git commit -m "feat: stats, advisor, what-if scan, SPADL and CDF follow the period's attacking direction; goldens regenerated

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: The keeper's two kinds of possession (G1/G2, off by default)

**Files:**
- Create: `packages/sim-core/src/keeper.ts`
- Modify:
  - `packages/sim-core/src/types.ts` (the `Possession` owned variant; `CONCERNS`)
  - `packages/sim-core/src/params.ts` (the `keeper` block)
  - `packages/sim-core/src/step.ts` (`changePossession`, flight winner about 940, `ownerDecision` about 809, `ownedTick` about 875, press branch about 1081)
  - `packages/sim-core/src/index.ts` (export `keeper.ts`)
- Test: `packages/sim-core/test/keeper.test.ts` (new)

**Interfaces:**
- Produces:
  - `keeperInHands(rule: number, keeper: PlayerState, period: Period, lastTouchSide: Side | null): boolean`
  - `Possession` owned variant gains `readonly inHands?: boolean; readonly holdTicks?: number`
  - Params `keeper.handsRule: number` (0 = old rule, 1 = new)
  - Params `keeper.handsHoldS: readonly [number, number]`
  - Params `keeper.feetPressFactor: number`
  - `CONCERNS` gains `"keeper"` and `"caution"` (the latter is used in Task 4)

- [ ] **Step 1: Write the failing tests** (`packages/sim-core/test/keeper.test.ts`)

```ts
import { describe, expect, it } from "vitest"
import { dist } from "../src/geometry.js"
import { keeperInHands } from "../src/keeper.js"
import { DEFAULT_PARAMS as P, type Params } from "../src/params.js"
import { initMatch, isFinished, step } from "../src/step.js"
import { kickoffPlayersFor, makeConfig } from "../src/testing.js"
import type { MatchState, PlayerState } from "../src/types.js"

const keeperAt = (x: number, y: number): PlayerState => {
  const gk = kickoffPlayersFor(makeConfig(1)).find((p) => p.side === "home" && p.role === "GK")!
  return { ...gk, pos: { x, y } }
}
const on: Params = { ...P, keeper: { ...P.keeper, handsRule: 1 } }

describe("keeper in hands or at feet", () => {
  it("has it in his hands in his own box unless his own side touched it last (the back-pass law)", () => {
    const inBox = keeperAt(-48, 0)
    expect(keeperInHands(1, inBox, "first_half", "away")).toBe(true)
    expect(keeperInHands(1, inBox, "first_half", null)).toBe(true)
    expect(keeperInHands(1, inBox, "first_half", "home")).toBe(false)
    expect(keeperInHands(1, keeperAt(-30, 0), "first_half", "away")).toBe(false)
    // Second half: home defends the +x end.
    expect(keeperInHands(1, keeperAt(48, 0), "second_half", "away")).toBe(true)
    expect(keeperInHands(0, inBox, "first_half", "away")).toBe(false)
  })

  it("with the rule on: nobody presses a keeper holding the ball, he holds it at least 5 s, and plays it quickly from his feet", () => {
    const hands: number[] = []
    const feet: number[] = []
    for (const seed of [7, 8]) {
      let s: MatchState = initMatch(makeConfig(seed, { params: on }))
      let open: { id: string; since: number; inHands: boolean } | null = null
      while (!isFinished(s)) {
        const prev = s
        s = step(s).state
        const poss = s.possession
        const gk = poss.kind === "owned" ? s.players.find((p) => p.id === poss.playerId && p.role === "GK") : undefined
        if (gk && poss.kind === "owned" && poss.restart === null) {
          if (poss.inHands) for (const o of s.players) if (o.side !== gk.side) expect(o.intent.kind === "press" && o.intent.targetId === gk.id).toBe(false)
          if (!open || open.id !== gk.id || open.since !== poss.since) open = { id: gk.id, since: poss.since, inHands: poss.inHands === true }
        } else if (open && prev.possession.kind === "owned" && prev.possession.playerId === open.id && s.possession.kind === "in_flight" && s.possession.flight.fromId === open.id) {
          // The keeper released it in open play.
          ;(open.inHands ? hands : feet).push((s.tick - open.since) * s.config.dt)
          open = null
        } else open = null
      }
    }
    expect(hands.length).toBeGreaterThan(0)
    expect(feet.length).toBeGreaterThan(0)
    for (const t of hands) expect(t).toBeGreaterThanOrEqual(5 - 1e-9)
    const median = [...feet].sort((a, b) => a - b)[Math.floor(feet.length / 2)]!
    expect(median).toBeLessThanOrEqual(2.5)
  }, 300_000)

  it("with the rule on: few keeper releases at his feet have an opponent within 5 m", () => {
    let releases = 0
    let pressed = 0
    let s: MatchState = initMatch(makeConfig(9, { params: on }))
    while (!isFinished(s)) {
      const prev = s
      s = step(s).state
      if (prev.possession.kind !== "owned" || prev.possession.restart !== null || prev.possession.inHands) continue
      const gk = prev.players.find((p) => p.id === (prev.possession as { playerId: string }).playerId && p.role === "GK")
      if (!gk || s.possession.kind !== "in_flight") continue
      releases++
      if (prev.players.some((o) => o.side !== gk.side && !o.sentOff && dist(o.pos, gk.pos) < 5)) pressed++
    }
    expect(releases).toBeGreaterThan(5)
    expect(pressed / releases).toBeLessThan(0.3)
  }, 120_000)
})
```

Run: `pnpm --filter @touchline/sim-core exec vitest run test/keeper.test.ts`
Expected: FAIL (`../src/keeper.js` doesn't exist).

- [ ] **Step 2: Add the params, the possession fields and the streams**

`params.ts`, in the `keeper` interface:

```ts
    /** 1: a keeper has the ball in his hands (held saves, claims, balls an opponent touched last, in his own box) or at his feet (back passes, his side's loose balls); 0: the old rule (every keeper possession is held for timing.keeperHoldS, and he cannot be tackled in his box). */
    readonly handsRule: number
    /** How long a keeper holds the ball in his hands, drawn uniformly (s). */
    readonly handsHoldS: readonly [number, number]
    /** Multiplier on the press rate against a keeper with the ball at his feet. */
    readonly feetPressFactor: number
```

In `DEFAULT_PARAMS.keeper`, append `handsRule: 0, handsHoldS: [5, 12], feetPressFactor: 1`.

`types.ts`:
- The owned variant becomes:
  ```ts
  | { readonly kind: "owned"; readonly playerId: string; readonly since: number; readonly restart: RestartKind | null; readonly inHands?: boolean; readonly holdTicks?: number }
  ```
- `CONCERNS` becomes `["decision", "execution", "duel", "referee", "movement", "restart", "script", "bench", "keeper", "caution"] as const`.

- [ ] **Step 3: Create `packages/sim-core/src/keeper.ts`** and export it from `index.ts` (`export * from "./keeper.js"`)

```ts
import { inOwnBox } from "./deflect.js"
import type { Period, Side } from "./geometry.js"
import type { PlayerState } from "./types.js"

/**
 * Whether a keeper who has just won the ball has it in his hands: in his own box, unless his own side touched it last
 * (a back pass or his side's loose ball must be played with the feet). Always false under the old rule (rule 0).
 */
export const keeperInHands = (rule: number, keeper: PlayerState, period: Period, lastTouchSide: Side | null): boolean =>
  rule > 0 && keeper.role === "GK" && inOwnBox(keeper.side, period, keeper.pos) && lastTouchSide !== keeper.side
```

- [ ] **Step 4: Use it in `step.ts`**

Add a helper next to `changePossession`:

```ts
/** Possession for a player who has just won the ball; a keeper with it in his hands also gets his hold time. */
const ownedBy = (w: Work, pl: PlayerState, lastTouchSide: Side | null): Possession => {
  const base = { kind: "owned" as const, playerId: pl.id, since: w.tick, restart: null }
  if (!keeperInHands(w.p.keeper.handsRule, pl, w.period, lastTouchSide)) return base
  const [lo, hi] = w.p.keeper.handsHoldS
  return { ...base, inHands: true, holdTicks: Math.round(w.rng.keeper.range(lo, hi) / w.dt) }
}
```

Use it in two places:
- `changePossession`: replace `w.possession = { kind: "owned", playerId: to.id, since: w.tick, restart: null }` with `w.possession = ownedBy(w, to, prevSide)`.
- The flight-winner branch (about line 940): replace `w.possession = { kind: "owned", playerId: winner.id, since: w.tick, restart: null }` with `w.possession = ownedBy(w, winner, f.side)`.

`ownerDecision`: replace the keeper-hold line with:

```ts
  if (owner.role === "GK" && !restart) {
    const rule = w.p.keeper.handsRule > 0
    const holdTicks = rule ? (poss.inHands ? (poss.holdTicks ?? 0) : 0) : Math.round(w.p.timing.keeperHoldS / w.dt)
    if (w.tick - poss.since < holdTicks) return
  }
```

`ownedTick`: replace the `inHands` line with:

```ts
  // In his hands he can be pressed, not challenged. Under the old rule that is any keeper possession in his own box.
  const inHands = w.p.keeper.handsRule > 0 ? w.possession.inHands === true : owner.role === "GK" && inOwnBox(owner.side, w.period, owner.pos)
```

The press branch in `moveTarget` (about line 1076, `if (pos.kind === "owned" && possSide !== pl.side) {`): directly after `const owner = w.player(pos.playerId)`, insert:

```ts
    // Nobody presses a keeper with the ball in his hands; at his feet he is pressed less (feetPressFactor).
    const keeperHolding = w.p.keeper.handsRule > 0 && owner.role === "GK" && pos.inHands === true
    if (keeperHolding) return shape()
    const keeperFactor = w.p.keeper.handsRule > 0 && owner.role === "GK" ? w.p.keeper.feetPressFactor : 1
```

Then multiply the press hazard rate by `keeperFactor`:
`hazard(w.p.defending.pressRatePerS * (0.4 + 1.2 * style.pressIntensity) * urgency * w.mods(pl.side).press * keeperFactor, w.dt)`

`return shape()` drops any press intent's effect while the keeper holds it in his hands: the earlier `pl.intent.kind === "press"` line sits below this guard, so move the guard **above** it. If `shape` isn't defined before this point, use the same expression it's defined with at about line 1029.

With `handsRule: 0`, `ownedBy` returns the old object and draws nothing, `keeperFactor` is 1, and the hold and tackle rules are unchanged, so the engine is bit-identical.

- [ ] **Step 5: Run the tests and the drift check**

Run: `pnpm --filter @touchline/sim-core test -- --no-file-parallelism`
Expected: PASS, including `keeper.test.ts`.
- **If the "few releases pressed" test fails** with the default `feetPressFactor` of 1: set `on` in the test file to `{ ...P.keeper, handsRule: 1, feetPressFactor: 0.25 }`, and record that value for Task 6.

Run: `pnpm --filter @touchline/calibrate exec vitest run test/realism-gate.test.ts --disableConsoleIntercept`
Expected: PASS with no drift. The defaults keep the old rule.

- [ ] **Step 6: Commit**

```bash
git add packages/sim-core
git commit -m "feat(sim-core): keeper in hands or at feet (switch, off by default) — hold only in hands, tackled and pressed less at feet, no pressing in hands; keeper and caution RNG streams

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Cards: non-foul cautions, and care once booked (T1, identity by default)

**Files:**
- Modify: `packages/sim-core/src/params.ts` (the `defending` block), `packages/sim-core/src/step.ts` (`foulAndCards` about 456, duel foul about 512, `step` about 1244)
- Test: `packages/sim-core/test/cards.test.ts` (new)

**Interfaces:**
- Consumes: `CONCERNS` with `"caution"` (Task 3).
- Produces:
  - Params `defending.cautionPerMatch` (default 0)
  - Params `defending.bookedFoulFactor` (default 1)
  - Params `defending.bookedYellowFactor` (default 1)
  - Card events from cautions carry `attrs.reason: "conduct"`

- [ ] **Step 1: Write the failing tests** (`packages/sim-core/test/cards.test.ts`)

```ts
import { describe, expect, it } from "vitest"
import { DEFAULT_PARAMS as P, type Params } from "../src/params.js"
import { initMatch, isFinished, step } from "../src/step.js"
import { makeConfig } from "../src/testing.js"
import type { DomainEvent } from "../src/types.js"

const run = (params: Params, seed = 7) => {
  let s = initMatch(makeConfig(seed, { params }))
  const events: DomainEvent[] = []
  while (!isFinished(s)) {
    const r = step(s)
    s = r.state
    events.push(...r.events)
  }
  return { s, events }
}

describe("cards", () => {
  it("books players for conduct at about cautionPerMatch, sends off on a second caution, and the match still finishes", () => {
    const { s, events } = run({ ...P, defending: { ...P.defending, cautionPerMatch: 10 } })
    const conduct = events.filter((e) => e.type === "card" && e.attrs.reason === "conduct")
    expect(conduct.length).toBeGreaterThanOrEqual(3)
    expect(conduct.length).toBeLessThanOrEqual(20)
    expect(s.phase.kind).toBe("full_time")
    for (const c of events.filter((e) => e.type === "card" && e.attrs.colour === "second_yellow")) {
      const p = s.players.find((x) => x.id === c.player_id)!
      expect(p.sentOff).toBe(true)
      // A player sent off takes no further part.
      expect(events.some((e) => e.player_id === p.id && e.frame_id > c.frame_id && e.type !== "card")).toBe(false)
    }
  }, 120_000)

  it("a booked player is never booked again for a foul when bookedYellowFactor is 0", () => {
    const { events } = run({ ...P, defending: { ...P.defending, yellowPerFoul: 1, redPerFoul: 0, bookedYellowFactor: 0 } })
    const cards = events.filter((e) => e.type === "card")
    expect(cards.length).toBeGreaterThan(0)
    expect(cards.filter((e) => e.attrs.colour === "second_yellow")).toEqual([])
  }, 120_000)

  it("booked players commit no fouls when bookedFoulFactor is 0", () => {
    const { events } = run({ ...P, defending: { ...P.defending, yellowPerFoul: 1, redPerFoul: 0, bookedFoulFactor: 0 } })
    const bookedAt = new Map<string, number>()
    for (const e of events) {
      if (e.type === "card" && e.player_id && !bookedAt.has(e.player_id)) bookedAt.set(e.player_id, e.frame_id)
      if (e.type === "foul" && e.player_id && bookedAt.has(e.player_id)) expect(e.frame_id).toBeLessThanOrEqual(bookedAt.get(e.player_id)!)
    }
    expect(bookedAt.size).toBeGreaterThan(0)
  }, 120_000)
})
```

Run: `pnpm --filter @touchline/sim-core exec vitest run test/cards.test.ts`
Expected: FAIL. TypeScript reports the unknown params fields, or no `conduct` cards are found.

- [ ] **Step 2: Add the params** (`params.ts`)

In the `defending` interface:

```ts
    /** Cautions for conduct (dissent, time-wasting) per 90 minutes, at random times (0 = none). */
    readonly cautionPerMatch: number
    /** Foul chance of an already booked defender, as a multiple of the normal one. */
    readonly bookedFoulFactor: number
    /** Booking chance for a foul by an already booked player, as a multiple of yellowPerFoul. */
    readonly bookedYellowFactor: number
```

In `DEFAULT_PARAMS.defending`, add `cautionPerMatch: 0, bookedFoulFactor: 1, bookedYellowFactor: 1,`.

- [ ] **Step 3: Implement in `step.ts`**

Extract the booking from `foulAndCards` into a helper, and use it:

```ts
/** Book a player (yellow, or second yellow and off) and emit the card. */
const book = (w: Work, pl: PlayerState, card: "yellow" | "second_yellow" | "red", attrs: Record<string, AttrValue>): void => {
  w.emit(w.pending("card", pl, pl.pos, { colour: card, ...attrs }))
  w.setPlayer({ ...w.player(pl.id), yellow: pl.yellow + 1, sentOff: card !== "yellow" })
}
```

In `foulAndCards`, change the yellow line to:

```ts
  else if (ref.chance(w.p.defending.yellowPerFoul * (offender.yellow >= 1 ? w.p.defending.bookedYellowFactor : 1))) card = offender.yellow >= 1 ? "second_yellow" : "yellow"
```

and the `if (card) { ... }` block to `if (card) book(w, offender, card, forcedRed ? { scripted: true } : {})`. This emits the same event attributes as before: `{ colour, scripted }` or `{ colour }`. Keep the key order `colour` first, so the events serialise identically.

In `duels`, multiply the foul probability by the booked factor:

```ts
  const booked = def.yellow >= 1 ? w.p.defending.bookedFoulFactor : 1
  if (w.rng.referee.chance(Math.min(1, w.p.defending.foulPerTackle * (victimInBox ? w.p.defending.boxFoulFactor : 1) * w.mods(def.side).foul * booked)) || w.hasForced(def.side, "red_card")) {
```

Add the caution step, and call it in `step` just before `moveAll(w)`:

```ts
/** Cautions for conduct: a Poisson stream over the match, falling on a random player on the pitch. */
const cautions = (w: Work): void => {
  const rate = w.p.defending.cautionPerMatch / 5400
  if (rate <= 0 || !w.rng.caution.chance(hazard(rate, w.dt))) return
  const pool = [...w.active("home"), ...w.active("away")]
  if (pool.length === 0) return
  const pl = pool[Math.min(pool.length - 1, Math.floor(w.rng.caution.uniform() * pool.length))]!
  book(w, pl, pl.yellow >= 1 ? "second_yellow" : "yellow", { reason: "conduct" })
}
```

If the booked player is the ball owner and is sent off, `ownedTick` already makes the ball loose on the next tick. With `cautionPerMatch` 0, nothing is drawn, so the engine is bit-identical.

- [ ] **Step 4: Run the tests and the drift check**

Run: `pnpm --filter @touchline/sim-core test -- --no-file-parallelism`
Expected: PASS

Run: `pnpm --filter @touchline/calibrate exec vitest run test/realism-gate.test.ts --disableConsoleIntercept`
Expected: PASS with no drift.

- [ ] **Step 5: Commit**

```bash
git add packages/sim-core
git commit -m "feat(sim-core): conduct cautions and booked players' care (identity by default)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Realism report: match balance and discipline (C3), and `pnpm realism:deep`

**Files:**
- Modify: `python/analytics/touchline_analytics/report.py`, `package.json` (root scripts), `packages/calibrate/package.json`
- Test: `python/analytics/tests/test_report.py`

**Interfaces:**
- Produces:
  - `balance(run_dir: Path) -> dict` with keys `home_shot_share`, `sent_off`, `penalties`
  - `balance_section(rows: list[dict]) -> list[str]`
  - the root script `pnpm realism:deep`

- [ ] **Step 1: Write the failing tests** (append to `python/analytics/tests/test_report.py`)

```python
def _run_dir(tmp_path, name, home_shots, away_shots, cards=(), pens=0):
    import json

    d = tmp_path / name
    d.mkdir()
    (d / "meta.json").write_text(json.dumps({"teams": {"home": {"id": "H"}, "away": {"id": "A"}}}))
    rows = [{"type": "shot", "team_id": "H", "attrs": {"technique": "penalty" if i < pens else "normal"}} for i in range(home_shots)]
    rows += [{"type": "shot", "team_id": "A", "attrs": {}} for _ in range(away_shots)]
    rows += [{"type": "card", "team_id": "H", "attrs": {"colour": c}} for c in cards]
    (d / "domain.jsonl").write_text("\n".join(json.dumps(r) for r in rows) + "\n")
    return d


def test_balance_reads_shot_share_sendings_off_and_penalties(tmp_path):
    from touchline_analytics.report import balance

    b = balance(_run_dir(tmp_path, "m", 12, 4, cards=("yellow", "second_yellow", "red"), pens=1))
    assert b == {"home_shot_share": 0.75, "sent_off": 2, "penalties": 1}
    assert balance(_run_dir(tmp_path, "z", 0, 0))["home_shot_share"] == 0.5


def test_balance_section_judges_c3_on_the_shot_share_spread():
    from touchline_analytics.report import balance_section

    rows = [{"home_shot_share": s, "sent_off": 0, "penalties": 0} for s in [0.4, 0.5, 0.6] * 22]
    text = "\n".join(balance_section(rows))
    assert "| Team shot share, SD over matches (C3) | 0.090 | 0.082 | ≤ 0.18 | MET |" in text
    assert "66 matches" in text
    few = "\n".join(balance_section(rows[:10]))
    assert "fewer than 64 matches" in few
```

Run: `uv run --project python/analytics pytest python/analytics/tests/test_report.py -q`
Expected: FAIL (`cannot import name 'balance'`)

- [ ] **Step 2: Implement** (`report.py`, after `carriers_section`)

```python
# Real references (IDSSE, 7 matches; aggregates from the 2026-10-13 realism analysis): the SD over matches of the
# home team's share of the match's shots, players sent off and penalties per match.
REAL_BALANCE = {"shot_share_sd": 0.090, "sent_off": 0.29, "penalties": 0.43}
C3_MAX_SHOT_SHARE_SD = 0.18
DEEP_MATCHES = 64


def balance(run_dir: Path) -> dict:
    """Home share of the match's shots (0.5 with no shots), players sent off, and penalties, from domain.jsonl."""
    home = json.loads((run_dir / "meta.json").read_text())["teams"]["home"]["id"]
    shots = {"home": 0, "away": 0}
    sent_off = penalties = 0
    with (run_dir / "domain.jsonl").open() as fh:
        for line in fh:
            e = json.loads(line)
            if e["type"] == "shot":
                shots["home" if e["team_id"] == home else "away"] += 1
                penalties += e["attrs"].get("technique") == "penalty"
            elif e["type"] == "card" and e["attrs"].get("colour") in ("second_yellow", "red"):
                sent_off += 1
    total = shots["home"] + shots["away"]
    return {"home_shot_share": shots["home"] / total if total else 0.5, "sent_off": sent_off, "penalties": penalties}


def balance_section(rows: list[dict]) -> list[str]:
    """C3 (shot-share spread) and discipline, judged on at least DEEP_MATCHES matches."""
    n = len(rows)
    share = [r["home_shot_share"] for r in rows]
    m = sum(share) / n
    sd = math.sqrt(sum((s - m) ** 2 for s in share) / (n - 1)) if n > 1 else 0.0
    per = lambda k: sum(r[k] for r in rows) / n  # noqa: E731
    lines = ["## Match balance and discipline", "",
             f"From {n} matches." + ("" if n >= DEEP_MATCHES else f" These are rare or noisy measures: judge them on {DEEP_MATCHES} or more (`pnpm realism:deep`); this report has fewer than 64 matches."),
             "", "| Measure | Real | Simulated | Target | Status |", "|---|---|---|---|---|",
             f"| Team shot share, SD over matches (C3) | {REAL_BALANCE['shot_share_sd']:.3f} | {sd:.3f} | ≤ {C3_MAX_SHOT_SHARE_SD:.2f} | {'MET' if sd <= C3_MAX_SHOT_SHARE_SD else 'NOT MET'} |",
             f"| Players sent off per match | {REAL_BALANCE['sent_off']:.2f} | {per('sent_off'):.2f} | about 0.2–0.3 | — |",
             f"| Penalties per match | {REAL_BALANCE['penalties']:.2f} | {per('penalties'):.2f} | — | — |", ""]
    return lines
```

In `build`, before `return "\n".join(lines)`, add:

```python
    lines += balance_section([balance(d) for d in run_dirs])
```

Run: `uv run --project python/analytics pytest python/analytics/tests -q`
Expected: PASS

- [ ] **Step 3: Add the command**

Root `package.json` `scripts`, after `"realism"`:

```json
    "realism:deep": "pnpm --filter @touchline/calibrate run realism --matches 64 --out out/realism-deep.md",
```

The `--out` path resolves from `INIT_CWD` (the repo root). Check that `cliOptions` accepts `--matches 64` as written, as `pnpm realism --matches 16` does in Plan 6a; if it needs `--matches=64`, use that form.

Run: `pnpm realism --matches 2 --out out/realism-smoke.md && grep -A6 "Match balance" out/realism-smoke.md`
Expected: the section prints with "fewer than 64 matches".

- [ ] **Step 4: Commit**

```bash
git add python/analytics package.json
git commit -m "feat(report): match balance and discipline — C3 as team shot-share spread, sendings-off, penalties; pnpm realism:deep (64 matches)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Switch on, recalibrate, re-baseline, re-pin, and record the results

**Files:**
- Modify: `packages/sim-core/src/params.ts` (defaults), `packages/calibrate/src/knobs.ts`
- Regenerate:
  - `data/params/touchline-params.json`
  - `data/params/realism-baseline.json`
  - `docs/realism/realism-report.md`
  - the stats and manager goldens (as in Task 2, Step 4)
  - the seed pins in `services/agents/tests/conftest.py` and `packages/agent-gateway/test/e2e.test.ts`
- Modify: `docs/superpowers/specs/2026-10-13-sim-realism-v2-design.md` (add `## Results: P1 (date)`)

- [ ] **Step 1: Switch the behaviours on** (`DEFAULT_PARAMS`)

- `keeper`: `handsRule: 1, handsHoldS: [5, 12], feetPressFactor: <0.25 or the value recorded in Task 3 Step 5; 1 if the test passed with it>`
- `defending`: `cautionPerMatch: 1.7, bookedFoulFactor: 0.5, bookedYellowFactor: 0.6`

Do the same in `data/params/touchline-params.json` if it already contains `keeper` or `defending` keys that override them. It overrides only the keys it lists, so new keys take these defaults.

Run: `pnpm --filter @touchline/sim-core test -- --no-file-parallelism`
Expected: PASS. If a sim-core test asserts an exact statistic that the new behaviour moves, check that the new value is football-plausible before updating the expectation, and say so in the commit message.

- [ ] **Step 2: Recalibrate** (about an hour; run it in the background)

The `yellow_per_foul` knob (`knobs.ts`) keeps its range of 0.05–0.5. Change its `init` to 0.15.

Run: `pnpm calibrate --from data/params/touchline-params.json --out data/params/touchline-params.json --matches 12 --rounds 1`
Expected: it ends with `wrote …: loss <n>`. Record the loss and the new `yellowPerFoul`, which should be about 0.15–0.2 now that conduct cautions supply the rest of the cards.

- [ ] **Step 3: Re-baseline and run the gate**

Run: `UPDATE_REALISM_BASELINE=1 pnpm --filter @touchline/calibrate exec vitest run test/realism-gate.test.ts --disableConsoleIntercept`
Then: `pnpm --filter @touchline/calibrate exec vitest run test/realism-gate.test.ts --disableConsoleIntercept`
Expected: PASS, with loss < 30.

**If the loss is ≥ 30, stop.** Report the loss and the statistics with the largest |z| to the user. Don't widen the gate.

- [ ] **Step 4: Deep report and the committed report**

Run: `pnpm realism:deep` (64 matches; tens of minutes)
Run: `pnpm realism --out docs/realism/realism-report.md --matches 16`

From `out/realism-deep.md`, record:
- the shot-share SD (C3: ≤ 0.18; it may still be NOT MET until P2 fixes territory, so report it honestly);
- players sent off per match (target about 0.2–0.3; it was 0.89);
- penalties per match (real 0.43).

From the 16-match report, record C1, C2 and C4 as in Plan 6a Task 8 Step 5.

- [ ] **Step 5: Keeper distribution check**

Run this one-off from the worktree root (it isn't committed). It counts open-play shots within 20 s after the conceding team's keeper distribution:

```bash
pnpm --filter @touchline/calibrate exec tsx -e '
import { readFileSync, readdirSync } from "node:fs"
let shots = 0, after = 0
for (const d of readdirSync("../../out/realism").map((x) => `../../out/realism/${x}`)) {
  const ev = readFileSync(`${d}/domain.jsonl`, "utf8").trim().split("\n").map((l) => JSON.parse(l))
  const dist = ev.filter((e) => e.type === "keeper_distribution")
  for (const s of ev.filter((e) => e.type === "shot")) {
    shots++
    if (dist.some((k) => k.team_id !== s.team_id && s.frame_id - k.frame_id >= 0 && s.frame_id - k.frame_id <= 200)) after++
  }
}
console.log({ shots, after, share: after / shots })'
```

Expected: `share` is well under the old 0.25, toward 0.10 (real 0.076). Record it. Frames are at dt 0.1, so 20 s is 200 frames. If a `keeper_distribution` event's `team_id` is null, match on `player_id`'s team via `meta.json` instead.

- [ ] **Step 6: Re-pin the seed-pinned fixtures, the goldens and the library**

Run:

```bash
uv run --project services/agents python services/agents/scripts/find_test_seed.py 1 1400
uv run --project services/agents python services/agents/scripts/find_test_seed.py --general 1 100
```

Update `ERROR_SEED`/`SEED` in `services/agents/tests/conftest.py` and the seed in `packages/agent-gateway/test/e2e.test.ts`, as commit 0f1fa83 did. Regenerate the stats and manager goldens with the Task 2 Step 4 commands, and check the diffs for plausibility.

Run: `pnpm library` to rebuild the match library under `out/library`. The old folders were written before the teams switched ends, and the what-if rebuild rejects them.

- [ ] **Step 7: Run everything**

Run: `pnpm test -- --no-file-parallelism && pnpm typecheck && uv run --project python/analytics pytest python/analytics/tests && uv run --project services/agents pytest services/agents/tests`
Expected: PASS

- [ ] **Step 8: Record the results and commit**

Add `## Results: P1 (YYYY-MM-DD)` to the v2 spec:
- gate loss;
- C1, C2 and C4 lines;
- C3 shot-share SD on 64 matches;
- sendings-off and penalties per match;
- the keeper-distribution shot share;
- the new `yellowPerFoul` and `feetPressFactor`.

Mark each item MET or NOT MET.

```bash
git add packages data docs services
git commit -m "feat: realism v2 P1 on — teams switch ends, keeper in hands/at feet, conduct cautions; recalibrated, re-baselined, fixtures re-pinned

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

Then merge locally into main (`git -C ../../touchline merge --no-ff realism-v2-p1`) only after the user has seen the results.

# Manager Agents and A/B Evaluation (Plan 4b) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A manager agent per team that decides at key moments of a match — proposing style changes and substitutions, having the engine test each against "no change" by re-simulation, and choosing with a reason grounded in those numbers — logged for exact replay, shown in the fan app, and measured against no manager and a rule-based manager in an honest A/B evaluation.

**Architecture:** The engine (`packages/sim-core`) gains manager orders (style changes at once, substitutions queued for the next tick) and stops automatic substitutions for a managed team. A new package, `packages/manager`, steps the match, detects key moments, builds the `Situation` the model sees (closed Effect Schema contract in `packages/schema`, exported to Pydantic), and asks each team's manager: the rule-based manager in TypeScript, or the agent manager, which calls a new `manage` skill on the Python A2A service twice (propose, choose) with the engine's worker-thread re-simulations in between. Every decision goes to `decisions.jsonl`; replaying the log reproduces the match bit for bit. `pnpm managers:ab` plays each fixture three times (no manager, rules, agent) and reports paired bootstrap intervals. The API serves decisions as cues and over `GetDecisions`, the fan app shows a decision card and strip, and the advisor re-simulates managed matches by applying their logged orders.

**Tech Stack:** TypeScript (pnpm/turbo monorepo, Effect 4, vitest, React + Testing Library), Python 3.12 (uv, Microsoft Agent Framework, a2a-sdk, Pydantic, pytest), OpenAI behind the agent service's one config (a deterministic stub in tests and CI).

**Spec:** `docs/superpowers/specs/2026-10-10-manager-agents-design.md`, including §9 "Revision (prototype rulings)". Rulings made while building the prototype are listed under "Rulings" below and in §9; each is also stated in the task it affects.

## Global Constraints

- Matches stay deterministic for a seed. A match without managers is exactly the match it was before this plan: the realism gate, the baseline and every pinned fixture are untouched (Task 1 tests this).
- The model sees only the `Situation` (and, to choose, the what-if summary): the match from its own team's side up to the pause tick. Never the seed, random state, scenario script, forced outcomes, truths, the added time the engine drew, anything after the pause, real tracking data, personal data or secrets (spec §4; Task 3 tests it).
- All names are synthetic (the league file). No StatsBomb data, no GPL or AGPL code.
- The OpenAI key lives in the repo's git-ignored `.env.local`, read only by the Python service; TypeScript never reads it. Tests and CI use the stub model and make no network calls beyond localhost.
- No invented prices: cost is computed only from `TOUCHLINE_PRICE_USD_PER_MTOK`; otherwise reports give tokens and say the price is unset.
- The A/B run with a real model (`pnpm managers:ab --llm openai`) and managed matches built with a real model spend OpenAI credit: run them only with the user's go-ahead. Nothing in this plan's tasks runs them.
- Managed matches have no scenario script (a script forcing outcomes would distort decisions and the A/B).
- A/B seeds start at 5000, clear of calibration (1000+), the realism report (2000+) and the gate (3000+).
- Run every command from the `touchline/` repository root. Commit messages end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Rulings (prototype, 2026-10-10; spec §9)

1. **Minute moments are absorbed after a recent decision.** A minute-60 or minute-75 moment due within 5 minutes of a decision is absorbed by it; half time and goals always call for one. The prototype decided at 59.6' and again at 60.0'.
2. **A style order is one setting:** `{kind: "style", setting, value}`. A fixed shape any model can return as structured output; several settings are several orders.
3. **Situation fields are named for what they count:** `ball_regains` (tackles won, interceptions, recoveries), per-player `shots`, `passes_completed`, `tackles_won`; ranges on each style setting; `limits.half_time_break`. Minutes played are on the match clock and possession is each team's share of the time either had the ball (the reviewed example first showed 63 minutes played at minute 60 and possession summing to 95.7 %). Minutes left use the expected added time, never the drawn one.
4. **Both managers decide from the same paused state**, and their orders apply afterwards; otherwise the second would see the first one's change at once.
5. **The rule-based manager makes no substitutions before half time, and when chasing replaces only midfielders and forwards with attackers.** A substitute takes the outgoing player's slot and role (formation is fixed); the prototype once brought an attacker on at centre-back at 32'.
6. **The Python stub proposes a fixed menu** (press higher, sit deeper, fresh legs) and chooses the best tested gain; the rule-based manager is TypeScript.
7. **A reason may quote** the what-if numbers (rounded), the seeds and horizon, the score and the minute.
8. **Commands live in `packages/manager`** (`pnpm manage`, `pnpm managers:ab`), not `pnpm sim --manage`: the managed loop needs the stats engine and the gateway, which `packages/sim` must not depend on.
9. **Decision cues are English** (casual and analyst): their body is the manager's own reason; other languages fall back to them.
10. **Managed matches re-simulate from their logs:** `statesAt` and the advisor's `Session` apply logged orders at their ticks, so the better-pass scan and the what-if split work on them (found when `pnpm library --managed` first ran).

## Review Focus

1. **A substitution ordered for a player who is sent off before the next tick, or a limit reached in between:** the queued change is cancelled, never made or counted (Task 1 `orderedSubs`; its check runs at the tick).
2. **Two key moments at one stoppage, and back-to-back stoppages:** one decision with every reason; a minute moment just after a decision is absorbed (Task 3 tests).
3. **The model invents a player id, a setting or a number:** an unknown setting fails the contract (fallback), an unknown player is dropped by the engine with its reason, an unknown number in the reason gets one retry then the fallback (Tasks 6 and 7 test each).
4. **The agent service is down or slow for a whole match:** every decision falls back to the previous plan, the circuit breaker stops calling for a while, and the match still finishes and replays (Task 7 tests).
5. **A managed match served to the fan app:** decisions never appear before the session reaches them, and the what-if split on one of its passes rebuilds the match with its orders (Tasks 10 and 11 test).

## How this plan was verified

The plan was built as a prototype first (`touchline-worktrees/proto-4b`), one commit per task on the spec revision
(`f413dbe`), and generated from those commits: every code block below is a file or patch from them.

- **Tests fail first.** For Tasks 1–11, each task's tests were put on its parent commit and run: every RED command fails
  as stated. Task 12 is documentation only.
- **Every commit passes** its GREEN commands and a forced typecheck of the whole repository (`pnpm turbo run typecheck
  --force`, 13 packages from Task 3 on).
- **The whole repository passes at Task 12:** `pnpm turbo run test --continue --concurrency=4 -- --maxWorkers=3`,
  13 of 13 packages (6 min 16 s); agents (Python) 175 passed; analytics (Python) 105 passed.
- **In the browser.** A library with a managed match (`pnpm library --managed northwick:larkspur:5004`, the manager
  agent for both teams on the stub model: 12 decisions, built in about 2 minutes) was watched in the fan app: the
  managers in the match list, both teams' cards at 60', the strip reopening half time. The check found three faults
  (one card for a two-team moment, overlapping markers, "48'" for first-half added time), fixed in Task 10 with tests.
- **Replay.** On a fresh clone at `f413dbe`, applying this document's code blocks task by task reproduces every
  prototype commit's tree exactly. The generated files (`pnpm-lock.yaml`, the contracts' JSON Schema and Pydantic
  models, the reviewed Situation example) come from commands in the steps; the replay took them from the prototype.

---

### Task 1: Manager orders in the engine

A manager changes two things: the team's style settings (press, line height, compactness, tempo, long-ball bias, cross bias, risk) and its players (substitutions). Style changes take effect at once, as the `tactic` what-if already does. Substitutions are queued in the state and made at the start of the next tick through the engine's own substitution code, counting against the laws' limits (5 changes, 3 windows during play; half time uses none). A team with a manager makes no automatic substitutions, and with any manager the second-half kickoff waits one tick, so the half-time break is a state the managers decide in. A match without managers is untouched.

**Files:**
- Create: `packages/sim-core/src/orders.ts` (orders, limits, checks, `applyOrders`)
- Modify: `packages/sim-core/src/types.ts` (`MatchConfig.managed`, `MatchState.subOrders`)
- Modify: `packages/sim-core/src/step.ts` (queued substitutions, no automatic ones for a managed team, half-time pause)
- Modify: `packages/sim-core/src/whatif.ts` (`STYLE_RANGES` moves to orders.ts; the `orders` intervention)
- Modify: `packages/sim-core/src/index.ts`
- Test: `packages/sim-core/test/orders.test.ts`

**Interfaces:**
- Produces (`@touchline/sim-core`):
  - `type StyleKey = keyof Omit<TeamStyle, "archetype">`; `STYLE_RANGES: Record<StyleKey, [min, max]>`; `MAX_SUBS = 5`; `MAX_SUB_WINDOWS = 3`
  - `type ManagerOrder = { kind: "style"; setting: StyleKey; value: number } | { kind: "sub"; off: string; on: string }`; `interface SubOrder { off; on }`; `class OrderError extends Error`
  - `isHalfTimeBreak(s): boolean`, `subsLeft(s, side)`, `windowsLeft(s, side)`, `availableBench(s, side): PlayerSetup[]`
  - `orderProblem(s, side, order, accepted?): string | null`; `checkOrders(s, side, orders): { valid: ManagerOrder[]; dropped: { order; reason }[] }`
  - `applyOrders(s, side, orders): MatchState` (throws `OrderError`)
  - `MatchConfig.managed?: ReadonlyArray<Side>`; `MatchState.subOrders?: Partial<Record<Side, SubOrder[]>>`
  - `Intervention` gains `{ kind: "orders"; side; orders }`
- Consumes: nothing new.

- [ ] **Step 1: Write the failing tests**

Create `packages/sim-core/test/orders.test.ts`:

```ts
import { describe, expect, it } from "vitest"
import {
  applyOrders,
  checkOrders,
  initMatch,
  isFinished,
  isHalfTimeBreak,
  OrderError,
  step,
  subsLeft,
  whatIf,
  WhatIfError,
  windowsLeft,
  type DomainEvent,
  type MatchConfig,
  type MatchState
} from "../src/index.js"
import { makeConfig } from "../src/testing.js"

const minute = (s: MatchState) => (s.period === "first_half" ? 0 : 45) + (Math.max(0, s.periodTick) * s.config.dt) / 60

/** Play from kickoff until `stop` holds (or full time); the events on the way. */
const playUntil = (cfg: MatchConfig, stop: (s: MatchState) => boolean, from: MatchState = initMatch(cfg)) => {
  let s = from
  const events: DomainEvent[] = []
  while (!isFinished(s)) {
    const r = step(s)
    s = r.state
    events.push(...r.events)
    if (stop(s)) break
  }
  return { s, events }
}
const playOut = (cfg: MatchConfig, from: MatchState) => playUntil(cfg, () => false, from)

const managed = makeConfig(4, { managed: ["home"] })
/** A stoppage in the second half of a match whose home team has a manager. */
const stoppage = playUntil(managed, (s) => s.period === "second_half" && s.periodTick > 100 && s.phase.kind === "restart").s
const halfTime = playUntil(managed, (s) => s.period === "second_half").s
const onPitch = (s: MatchState, role: string) => s.players.find((p) => p.side === "home" && p.role === role && !p.sentOff)!
const bench = (role: string) => managed.home.bench!.find((b) => b.role === role)!

describe("manager orders are checked against the live state", () => {
  it("accept a style change inside its ranges and a substitution of a player on the pitch by a bench player", () => {
    const orders = [{ kind: "style" as const, setting: "pressIntensity" as const, value: 0.9 }, { kind: "style" as const, setting: "lineHeight" as const, value: -0.2 }, { kind: "sub" as const, off: onPitch(stoppage, "ST").id, on: bench("ST").id }]
    expect(checkOrders(stoppage, "home", orders)).toEqual({ valid: orders, dropped: [] })
  })
  it("drop, with the reason, out-of-range or unknown style settings and impossible substitutions", () => {
    const st = onPitch(stoppage, "ST").id
    const cases: Array<[unknown, RegExp]> = [
      [{ kind: "style", setting: "pressIntensity", value: 1.5 }, /pressIntensity must be between 0 and 1/],
      [{ kind: "style", setting: "formation", value: 1 }, /unknown style setting "formation"/],
      [{ kind: "style", setting: "toString", value: 1 }, /unknown style setting "toString"/],
      [{ kind: "sub", off: "nobody", on: bench("ST").id }, /nobody is not on the pitch/],
      [{ kind: "sub", off: st, on: "nobody" }, /nobody is not an available bench player/],
      [{ kind: "sub", off: st, on: bench("GK").id }, /only a goalkeeper can replace a goalkeeper/],
      [{ kind: "sub", off: stoppage.players.find((p) => p.side === "away")!.id, on: bench("ST").id }, /not on the pitch for this team/]
    ]
    for (const [order, reason] of cases) {
      const r = checkOrders(stoppage, "home", [order as never])
      expect(r.valid).toEqual([])
      expect(r.dropped[0]!.reason).toMatch(reason)
    }
  })
  it("do not let one player come off twice or one bench player come on twice in the same decision", () => {
    const st = onPitch(stoppage, "ST").id, cm = onPitch(stoppage, "CM").id
    const r = checkOrders(stoppage, "home", [{ kind: "sub", off: st, on: bench("ST").id }, { kind: "sub", off: st, on: bench("CM").id }, { kind: "sub", off: cm, on: bench("ST").id }])
    expect(r.valid).toHaveLength(1)
    expect(r.dropped.map((d) => d.reason)).toEqual([`${st} is already coming off`, `${bench("ST").id} is not an available bench player`])
  })
  it("keep to five substitutions and three windows during play", () => {
    const outfield = stoppage.players.filter((p) => p.side === "home" && p.role !== "GK")
    const fresh = managed.home.bench!.filter((b) => b.role !== "GK")
    const six = outfield.slice(0, 6).map((p, i) => ({ kind: "sub" as const, off: p.id, on: fresh[i]!.id }))
    expect(checkOrders(stoppage, "home", six).dropped.map((d) => d.reason)).toEqual(["no substitutions left (5 allowed)"])
    const spent = { ...stoppage, subs: { ...stoppage.subs, home: { ...stoppage.subs.home, windows: 3 } } }
    expect(windowsLeft(spent, "home")).toBe(0)
    expect(checkOrders(spent, "home", six.slice(0, 1)).dropped[0]!.reason).toBe("no substitution windows left (3 allowed)")
  })
  it("allow substitutions only at a stoppage", () => {
    const open = playUntil(managed, (s) => s.phase.kind === "open_play" && s.tick > 100).s
    expect(checkOrders(open, "home", [{ kind: "sub", off: onPitch(open, "ST").id, on: bench("ST").id }]).dropped[0]!.reason).toBe("substitutions are made only at a stoppage")
  })
})

describe("applied orders", () => {
  it("change the team's style at once and queue substitutions, which count against what is left", () => {
    const st = onPitch(stoppage, "ST").id
    const s = applyOrders(stoppage, "home", [{ kind: "style", setting: "tempo", value: 0.95 }, { kind: "sub", off: st, on: bench("ST").id }])
    expect(s.config.home.style.tempo).toBe(0.95)
    expect(s.config.away).toBe(stoppage.config.away)
    expect(s.subOrders?.home).toEqual([{ off: st, on: bench("ST").id }])
    expect(subsLeft(s, "home")).toBe(subsLeft(stoppage, "home") - 1)
    expect(() => applyOrders(stoppage, "home", [{ kind: "style", setting: "tempo", value: 2 }])).toThrow(OrderError)
    expect(() => applyOrders(stoppage, "home", [{ kind: "style", setting: "tempo", value: 0.2 }, { kind: "style", setting: "tempo", value: 0.3 }])).toThrow("tempo is already being changed")
  })
  it("make the queued substitution at the next tick: the bench player takes the slot, fresh, and one window is used", () => {
    const off = onPitch(stoppage, "ST")
    const on = bench("ST").id
    const r = step(applyOrders(stoppage, "home", [{ kind: "sub", off: off.id, on }]))
    const sub = r.events.find((e) => e.type === "substitution")!
    expect(sub.attrs).toMatchObject({ player_off: off.id, player_on: on, reason: "manager", half_time: false })
    const came = r.state.players.find((p) => p.id === on)!
    expect([came.slot, came.role]).toEqual([off.slot, off.role])
    expect(came.energy).toBeGreaterThan(0.999) // fresh, less one tick of running
    expect(r.state.players.some((p) => p.id === off.id)).toBe(false)
    expect(r.state.subs.home.windows).toBe(stoppage.subs.home.windows + 1)
    expect(r.state.subOrders).toBeUndefined()
  })
  it("at half time pause at the second-half kickoff before play, and make changes there without using a window", () => {
    expect(isHalfTimeBreak(halfTime)).toBe(true)
    const off = onPitch(halfTime, "CM")
    const r = step(applyOrders(halfTime, "home", [{ kind: "sub", off: off.id, on: bench("CM").id }]))
    expect(r.events.find((e) => e.type === "substitution")!.attrs.half_time).toBe(true)
    expect(r.state.subs.home.windows).toBe(0)
  })
})

describe("a managed team", () => {
  const plain = makeConfig(4)
  it("makes no automatic substitutions, while the other team still does", () => {
    const events = playOut(managed, initMatch(managed)).events.filter((e) => e.type === "substitution")
    expect(events.filter((e) => e.team_id === managed.home.id)).toEqual([])
    expect(events.filter((e) => e.team_id === managed.away.id).length).toBeGreaterThan(0)
  })
  it("leaves an unmanaged match exactly as before", () => {
    const a = playOut(plain, initMatch(plain)), b = playOut({ ...plain, managed: [] }, initMatch({ ...plain, managed: [] }))
    expect(b.events).toEqual(a.events)
    expect(b.s.score).toEqual(a.s.score)
  })
  it("plays identically to the unmanaged match until half time", () => {
    const a = playUntil(plain, (s) => minute(s) >= 44).events
    const b = playUntil(managed, (s) => minute(s) >= 44).events
    expect(b).toEqual(a)
  })
})

describe("the orders intervention", () => {
  it("tests a manager's option from a stoppage with the paired what-if", () => {
    const r = whatIf(stoppage, { kind: "orders", side: "home", orders: [{ kind: "sub", off: onPitch(stoppage, "ST").id, on: bench("ST").id }] }, { seeds: 3, horizonS: 30, side: "home" })
    expect([r.seeds, r.side]).toEqual([3, "home"])
    expect(() => whatIf(stoppage, { kind: "orders", side: "home", orders: [{ kind: "style", setting: "tempo", value: -1 }] }, { seeds: 1, horizonS: 10 })).toThrow(WhatIfError)
  })
})
```

- [ ] **Step 2: Run them to make sure they fail**

Run: `pnpm --filter @touchline/sim-core test orders`
Expected: FAIL: `applyOrders`, `checkOrders` … are not exported (every test in `test/orders.test.ts` fails)

- [ ] **Step 3: Write the implementation**

Create `packages/sim-core/src/orders.ts`:

```ts
/**
 * Manager orders (Plan 4b): what a team's manager may change at a stoppage — its style settings and substitutions.
 * Orders are checked against the live state first. A style change takes effect at once; a substitution is queued and
 * made at the start of the next tick by the engine's substitution code, counting against the laws' limits.
 */
import type { Side } from "./geometry.js"
import type { MatchState, PlayerSetup, TeamStyle } from "./types.js"

/** Laws of the game: five substitutions, made in at most three stoppages during play (half time does not count). */
export const MAX_SUBS = 5
export const MAX_SUB_WINDOWS = 3

export type StyleKey = keyof Omit<TeamStyle, "archetype">

/** The range each style setting may take. */
export const STYLE_RANGES: Readonly<Record<StyleKey, readonly [number, number]>> = {
  pressIntensity: [0, 1],
  lineHeight: [-1, 1],
  compactness: [0, 1],
  tempo: [0, 1],
  longBallBias: [-1, 1],
  crossBias: [-1, 1],
  riskTolerance: [0, 1]
}

export interface SubOrder {
  readonly off: string
  readonly on: string
}

export type ManagerOrder =
  /** One style setting to a new value (one setting per order keeps the order a fixed shape for the model). */
  | { readonly kind: "style"; readonly setting: StyleKey; readonly value: number }
  | ({ readonly kind: "sub" } & SubOrder)

/** An order that cannot be applied to the state. */
export class OrderError extends Error {}

/** True at the second-half kickoff, before play: substitutions made now are half-time changes (no window used). */
export const isHalfTimeBreak = (s: MatchState): boolean => s.period === "second_half" && s.periodTick === 0 && s.phase.kind === "restart"

const queued = (s: MatchState, side: Side): ReadonlyArray<SubOrder> => s.subOrders?.[side] ?? []

/** Substitutions the team may still make (queued ones count). */
export const subsLeft = (s: MatchState, side: Side): number => MAX_SUBS - s.subs[side].made - queued(s, side).length

/** Stoppages during play in which the team may still substitute. */
export const windowsLeft = (s: MatchState, side: Side): number => MAX_SUB_WINDOWS - s.subs[side].windows

/** The team's bench players who have not come on yet. */
export const availableBench = (s: MatchState, side: Side): ReadonlyArray<PlayerSetup> => {
  const used = new Set([...s.subs[side].used, ...queued(s, side).map((q) => q.on)])
  return (s.config[side].bench ?? []).filter((b) => !used.has(b.id))
}

/** Why `order` cannot be applied for `side` now, after the orders already accepted; null when it can. */
export const orderProblem = (s: MatchState, side: Side, order: ManagerOrder, accepted: ReadonlyArray<ManagerOrder> = []): string | null => {
  if (order.kind === "style") {
    const range = Object.hasOwn(STYLE_RANGES, order.setting) ? STYLE_RANGES[order.setting] : undefined
    if (!range) return `unknown style setting "${order.setting}"`
    if (typeof order.value !== "number" || !(order.value >= range[0] && order.value <= range[1])) return `${order.setting} must be between ${range[0]} and ${range[1]}`
    if (accepted.some((o) => o.kind === "style" && o.setting === order.setting)) return `${order.setting} is already being changed`
    return null
  }
  if (s.phase.kind !== "restart") return "substitutions are made only at a stoppage"
  const subs = accepted.filter((o): o is Extract<ManagerOrder, { kind: "sub" }> => o.kind === "sub")
  if (subs.length + 1 > subsLeft(s, side)) return `no substitutions left (${MAX_SUBS} allowed)`
  if (!isHalfTimeBreak(s) && windowsLeft(s, side) <= 0 && queued(s, side).length === 0) return `no substitution windows left (${MAX_SUB_WINDOWS} allowed)`
  const off = s.players.find((p) => p.id === order.off)
  if (!off || off.side !== side || off.sentOff) return `${order.off} is not on the pitch for this team`
  if (subs.some((o) => o.off === order.off) || queued(s, side).some((q) => q.off === order.off)) return `${order.off} is already coming off`
  const on = availableBench(s, side).find((b) => b.id === order.on)
  if (!on || subs.some((o) => o.on === order.on)) return `${order.on} is not an available bench player`
  if ((on.role === "GK") !== (off.role === "GK")) return "only a goalkeeper can replace a goalkeeper"
  return null
}

/** The orders that can be applied, in order, and the ones dropped with the reason. */
export const checkOrders = (s: MatchState, side: Side, orders: ReadonlyArray<ManagerOrder>) => {
  const valid: ManagerOrder[] = []
  const dropped: Array<{ readonly order: ManagerOrder; readonly reason: string }> = []
  for (const order of orders) {
    const reason = orderProblem(s, side, order, valid)
    if (reason === null) valid.push(order)
    else dropped.push({ order, reason })
  }
  return { valid, dropped }
}

/** Apply orders for `side`: style changes at once, substitutions queued for the next tick. Throws OrderError. */
export const applyOrders = (s: MatchState, side: Side, orders: ReadonlyArray<ManagerOrder>): MatchState => {
  const { dropped } = checkOrders(s, side, orders)
  if (dropped.length > 0) throw new OrderError(dropped[0]!.reason)
  let style: Partial<TeamStyle> = {}
  const subs: SubOrder[] = [...queued(s, side)]
  for (const o of orders) {
    if (o.kind === "style") style = { ...style, [o.setting]: o.value }
    else subs.push({ off: o.off, on: o.on })
  }
  const team = s.config[side]
  const config = Object.keys(style).length > 0 ? { ...s.config, [side]: { ...team, style: { ...team.style, ...style } } } : s.config
  return subs.length > 0 ? { ...s, config, subOrders: { ...s.subOrders, [side]: subs } } : { ...s, config }
}
```

Apply this change to `packages/sim-core/src/index.ts`, `packages/sim-core/src/step.ts`, `packages/sim-core/src/types.ts`, `packages/sim-core/src/whatif.ts` (from the repository root):

```bash
git apply <<'PATCH'
diff --git a/packages/sim-core/src/index.ts b/packages/sim-core/src/index.ts
index d6ef493..8633a15 100644
--- a/packages/sim-core/src/index.ts
+++ b/packages/sim-core/src/index.ts
@@ -20,3 +20,4 @@ export * from "./runner.js"
 export * from "./pitchcontrol.js"
 export * from "./whatif.js"
 export * from "./offball.js"
+export * from "./orders.js"
diff --git a/packages/sim-core/src/step.ts b/packages/sim-core/src/step.ts
index 3709d42..5328719 100644
--- a/packages/sim-core/src/step.ts
+++ b/packages/sim-core/src/step.ts
@@ -26,6 +26,7 @@ import { approach, approachBy, drainEnergy, interceptPoint, motionFor, separatio
 import type { Action } from "./params.js"
 import { goalLineCrossing, keeperLetsRun, MAX_FLIGHT_S, resolveFlight } from "./resolve.js"
 import { hazard, Rng, substream } from "./rng.js"
+import { MAX_SUBS, MAX_SUB_WINDOWS, type SubOrder } from "./orders.js"
 import { anchorFor, kickoffAnchor } from "./shape.js"
 import { countGoal, inWindow, modsFor, outstandingForces, type Mods, type ScenarioEffect, type ScriptEntry } from "./script.js"
 import { parryBall, planShot, type ShotMods } from "./shot.js"
@@ -55,12 +56,12 @@ import {
 
 const HALF_TIME_MS = 15 * 60 * 1000
 const OUTCOME_IN_ATTRS: ReadonlySet<string> = new Set(["take_on", "tackle"])
-/** Laws of the game: five substitutions, made in at most three stoppages during play (half time does not count). */
-const MAX_SUBS = 5
-const MAX_SUB_WINDOWS = 3
 
 const teamOf = (cfg: MatchConfig, side: Side): TeamSetup => (side === "home" ? cfg.home : cfg.away)
 
+/** A team whose manager decides its substitutions (no automatic ones). */
+const isManaged = (cfg: MatchConfig, side: Side): boolean => cfg.managed?.includes(side) ?? false
+
 const samplePeriodTicks = (cfg: MatchConfig, rng: Rng): number => {
   const [lo, hi] = cfg.params.timing.addedTimeMinS
   return Math.round((45 * 60 + rng.range(lo, hi)) / cfg.dt)
@@ -165,6 +166,9 @@ class Work {
   forced: ScriptEntry[]
   scriptGoals: number[]
   override: PassOverride | null
+  subOrders: Partial<Record<Side, ReadonlyArray<SubOrder>>>
+  /** The step after the half-time break's pause (the state was the second-half kickoff, before play). */
+  readonly halfTimeBreak: boolean
   rng: Record<Concern, Rng>
   seq: number
   events: DomainEvent[] = []
@@ -193,6 +197,8 @@ class Work {
     this.scriptGoals = [...s.scriptGoals]
     // A what-if override lives for its tick only: if the player has no decision to make then, it lapses.
     this.override = s.override && this.tick <= s.override.untilTick ? s.override : null
+    this.subOrders = { ...s.subOrders }
+    this.halfTimeBreak = s.period === "second_half" && s.periodTick === 0
     this.rng = {} as Record<Concern, Rng>
     for (const c of CONCERNS) this.rng[c] = new Rng(s.rng[c])
     this.seq = s.eventSeq
@@ -300,7 +306,8 @@ class Work {
       scriptGoals: this.scriptGoals,
       rng: out,
       eventSeq: this.seq,
-      ...(this.override ? { override: this.override } : {})
+      ...(this.override ? { override: this.override } : {}),
+      ...(Object.values(this.subOrders).some((q) => q.length > 0) ? { subOrders: this.subOrders } : {})
     }
   }
 }
@@ -335,6 +342,19 @@ const LINE: Readonly<Record<Role, string>> = { GK: "gk", CB: "def", FB: "def", D
 const pickIncoming = (bench: ReadonlyArray<PlayerSetup>, off: PlayerState): PlayerSetup | null =>
   bench.find((b) => b.role === off.role) ?? bench.find((b) => LINE[b.role] === LINE[off.role]) ?? bench[0] ?? null
 
+/**
+ * `on` takes `off`'s formation slot and role, fresh, entering at the halfway line during play or where `off` stood at
+ * half time.
+ */
+const bringOn = (w: Work, off: PlayerState, on: PlayerSetup, halfTime: boolean): void => {
+  const entry = halfTime ? off.pos : { x: 0, y: -PITCH.halfW }
+  w.setPlayerAt(off.id, {
+    id: on.id, side: off.side, role: off.role, slot: off.slot, jersey: on.jersey, attrs: on.attrs, foot: on.preferredFoot ?? "right",
+    pos: entry, vel: { x: 0, y: 0 }, intent: { kind: "shape" }, intentUntil: 0, energy: 1, yellow: 0, sentOff: false
+  })
+  if (w.lastTouch?.playerId === off.id) w.lastTouch = { playerId: on.id, side: off.side }
+}
+
 /**
  * Replace up to `n` tired (or booked) outfield players. The player coming on takes the same formation slot and role,
  * fresh, entering at `entry` (the halfway line during play, the kickoff position at half time).
@@ -357,12 +377,7 @@ const makeSubs = (w: Work, side: Side, n: number, halfTime: boolean): number =>
     if (!on) break
     bench = bench.filter((b) => b.id !== on.id)
     used.push(on.id)
-    const entry = halfTime ? off.pos : { x: 0, y: -PITCH.halfW }
-    w.setPlayerAt(off.id, {
-      id: on.id, side, role: off.role, slot: off.slot, jersey: on.jersey, attrs: on.attrs, foot: on.preferredFoot ?? "right",
-      pos: entry, vel: { x: 0, y: 0 }, intent: { kind: "shape" }, intentUntil: 0, energy: 1, yellow: 0, sentOff: false
-    })
-    if (w.lastTouch?.playerId === off.id) w.lastTouch = { playerId: on.id, side }
+    bringOn(w, off, on, halfTime)
     const reason = off.yellow > 0 && 1 - off.energy < 0.5 ? "booked" : "fatigue"
     w.emit(w.pending("substitution", off, off.pos, { player_off: off.id, player_on: on.id, reason, half_time: halfTime }))
     made++
@@ -373,6 +388,7 @@ const makeSubs = (w: Work, side: Side, n: number, halfTime: boolean): number =>
 
 /** At a stoppage in the second half, make every planned change that is due, as one window. */
 const subWindow = (w: Work, side: Side): void => {
+  if (isManaged(w.cfg, side)) return
   const st = w.subs[side]
   if (st.windows >= MAX_SUB_WINDOWS || st.made >= MAX_SUBS) return
   const due = st.plan.filter((x) => x.minute <= w.minute())
@@ -382,6 +398,28 @@ const subWindow = (w: Work, side: Side): void => {
   if (made > 0) w.subs[side] = { ...w.subs[side], windows: w.subs[side].windows + 1 }
 }
 
+/** Make the substitutions the team's manager ordered (orders.ts): one window during play, none at half time. */
+const orderedSubs = (w: Work, side: Side): void => {
+  const orders = w.subOrders[side] ?? []
+  if (orders.length === 0) return
+  w.subOrders = { ...w.subOrders, [side]: [] }
+  const st = w.subs[side]
+  const bench = teamOf(w.cfg, side).bench ?? []
+  const used = [...st.used]
+  let made = 0
+  for (const o of orders) {
+    const off = w.players.find((p) => p.id === o.off && p.side === side && !p.sentOff)
+    const on = bench.find((b) => b.id === o.on)
+    // Checked when ordered; a player sent off since, or the limit reached, cancels the change.
+    if (!off || !on || used.includes(on.id) || st.made + made >= MAX_SUBS) continue
+    used.push(on.id)
+    bringOn(w, off, on, w.halfTimeBreak)
+    w.emit(w.pending("substitution", off, off.pos, { player_off: off.id, player_on: on.id, reason: "manager", half_time: w.halfTimeBreak }))
+    made++
+  }
+  w.subs[side] = { ...st, made: st.made + made, used, windows: st.windows + (made > 0 && !w.halfTimeBreak ? 1 : 0) }
+}
+
 const takerFor = (w: Work, r: { restart: RestartKind; side: Side; at: Vec2 }): PlayerState => {
   const team = w.active(r.side)
   if (r.restart === "goal_kick") return team.find((x) => x.role === "GK") ?? team[0]!
@@ -1164,8 +1202,10 @@ const endPeriod = (w: Work): StepResult => {
   w.possession = { kind: "dead" }
   w.ball = { pos: { x: 0, y: 0, z: 0 }, vel: { x: 0, y: 0, z: 0 } }
   w.emit(w.pending("period_start", null, null, { period: "second_half" }))
-  for (const side of ["home", "away"] as const) if ((teamOf(w.cfg, side).bench ?? []).length > 0 && w.rng.bench.chance(w.p.substitutions.halfTimeChance)) makeSubs(w, side, 1, true)
-  handleRestart(w)
+  for (const side of ["home", "away"] as const)
+    if ((teamOf(w.cfg, side).bench ?? []).length > 0 && w.rng.bench.chance(w.p.substitutions.halfTimeChance) && !isManaged(w.cfg, side)) makeSubs(w, side, 1, true)
+  // With a manager the kickoff waits one tick: the state at the break is when they decide (Plan 4b).
+  if (!w.cfg.managed?.length) handleRestart(w)
   return { state: w.toState(), frame: frameOf(w), events: w.events }
 }
 
@@ -1184,7 +1224,10 @@ export const step = (s: MatchState): StepResult => {
   // The hard stop a minute later still lets a ball in the air land (a flight lasts at most MAX_FLIGHT_S).
   const hardStop = w.periodTicks + Math.round(60 / w.dt)
   if (w.periodTick >= hardStop && (w.possession.kind !== "in_flight" || w.periodTick >= hardStop + Math.round(MAX_FLIGHT_S / w.dt))) return endPeriod(w)
-  if (w.phase.kind === "restart") handleRestart(w)
+  if (w.phase.kind === "restart") {
+    for (const side of ["home", "away"] as const) orderedSubs(w, side)
+    handleRestart(w)
+  }
   if (w.phase.kind === "open_play") ownedTick(w)
   moveAll(w)
   ballTick(w)
diff --git a/packages/sim-core/src/types.ts b/packages/sim-core/src/types.ts
index 7f15419..b15c842 100644
--- a/packages/sim-core/src/types.ts
+++ b/packages/sim-core/src/types.ts
@@ -73,6 +73,8 @@ export interface MatchConfig {
   readonly dt: number
   /** Scenario script whose nudges apply inside their windows (none when absent). */
   readonly script?: Script
+  /** Teams whose manager decides their substitutions (orders.ts); they make no automatic ones. */
+  readonly managed?: ReadonlyArray<Side>
 }
 
 export type Intent =
@@ -330,6 +332,8 @@ export interface MatchState {
   readonly eventSeq: number
   /** A pass to force at the player's next decision (what-if forks only; absent in played matches). */
   readonly override?: PassOverride
+  /** Substitutions a manager ordered, made at the start of the next tick (orders.ts). */
+  readonly subOrders?: Readonly<Partial<Record<Side, ReadonlyArray<{ readonly off: string; readonly on: string }>>>>
 }
 
 export interface StepResult {
diff --git a/packages/sim-core/src/whatif.ts b/packages/sim-core/src/whatif.ts
index 3a2b401..faac28a 100644
--- a/packages/sim-core/src/whatif.ts
+++ b/packages/sim-core/src/whatif.ts
@@ -5,6 +5,7 @@
  */
 import { buildCandidates, nearestOpponent } from "./decide.js"
 import { attackX, clampToPitch, dist, type Side, type Vec2 } from "./geometry.js"
+import { applyOrders, OrderError, STYLE_RANGES, type ManagerOrder } from "./orders.js"
 import { substream } from "./rng.js"
 import { runScript } from "./runner.js"
 import { initMatch, isFinished, step } from "./step.js"
@@ -18,20 +19,12 @@ export type Intervention =
   | { readonly kind: "move_player"; readonly playerId: string; readonly to: Vec2 }
   /** The team plays with these style settings from now on. */
   | { readonly kind: "tactic"; readonly side: Side; readonly style: Partial<TeamStyle> }
+  /** A manager's orders for the team (style changes and substitutions; orders.ts). */
+  | { readonly kind: "orders"; readonly side: Side; readonly orders: ReadonlyArray<ManagerOrder> }
 
 /** An intervention that cannot be applied to the state (wrong player, unknown id, style out of range). */
 export class WhatIfError extends Error {}
 
-const STYLE_RANGES: Readonly<Record<keyof Omit<TeamStyle, "archetype">, readonly [number, number]>> = {
-  pressIntensity: [0, 1],
-  lineHeight: [-1, 1],
-  compactness: [0, 1],
-  tempo: [0, 1],
-  longBallBias: [-1, 1],
-  crossBias: [-1, 1],
-  riskTolerance: [0, 1]
-}
-
 /**
  * The k-th fork of a state: fresh random sub-streams for every concern, distinct from the match's and from scenario
  * retries. Outcomes the scenario runner was forcing are dropped: a fork must not know what the match went on to do.
@@ -93,6 +86,12 @@ export const applyIntervention = (s: MatchState, iv: Intervention): MatchState =
       const team = s.config[iv.side]
       return { ...s, config: { ...s.config, [iv.side]: { ...team, style: { ...team.style, ...iv.style } } } }
     }
+    case "orders":
+      try {
+        return applyOrders(s, iv.side, iv.orders)
+      } catch (e) {
+        throw e instanceof OrderError ? new WhatIfError(e.message) : e
+      }
   }
 }
 
PATCH
```

- [ ] **Step 4: Run the tests**

Run: `pnpm --filter @touchline/sim-core test orders`
Expected: `Tests  12 passed (12)`

Run: `pnpm --filter @touchline/sim-core test`
Expected: every test passes (`Tests  214 passed (214)`; under heavy machine load the existing keeper-heroics scenario test can hit its 120 s limit — rerun it alone)

Run: `pnpm turbo run typecheck --force`
Expected: `Tasks:    12 successful, 12 total`

- [ ] **Step 5: Commit**

```bash
git add packages/sim-core
git commit -m "feat(sim-core): manager orders — style changes and queued substitutions checked against the live state, no automatic substitutions for a managed team, a half-time pause before the second-half kickoff, and an orders what-if intervention

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Manager agent contracts

Everything that crosses between the engine and the Python manager agent is defined once in Effect Schema and exported to JSON Schema, from which the agents' Pydantic models are generated: the `Situation` (the whole of what the model sees, spec §4), orders, the proposal and choice, the what-if summary, the `manage` request and the `manager` reply, and the decision log line. The agent request union gains `manage`; the gateway's commentary timeline keeps to signals and recaps (`MatchRequest`).

**Files:**
- Create: `packages/schema/src/manager.ts`
- Modify: `packages/schema/src/agents.ts` (`AgentRequest` gains `ManageRequest`; `MatchRequest`; `ARTIFACTS.manager`; `AgentContracts.manager_reply`), `packages/schema/src/index.ts`
- Regenerate: `packages/schema/json/agent-contracts.schema.json`, `services/agents/touchline_agents/contracts_gen.py`
- Modify: `services/agents/touchline_agents/contracts.py` (the request union)
- Modify: `packages/agent-gateway/src/gateway.ts` (timeline typed `MatchRequest`), `packages/agent-gateway/test/fakes.ts`
- Test: fixtures under `packages/schema/fixtures/agents/{valid,invalid}/`, `packages/schema/test/agents.test.ts`, `services/agents/tests/test_contracts.py`

**Interfaces:**
- Produces (`@touchline/schema`): `StyleKey`, `ManagerOrder`, `MomentReason`, `Situation` (+ `TeamView`, `PlayerView`, `BenchView`, `RecentView`, `StyleSetting`, `TeamStats`), `Estimate`, `OptionResult`, `WhatIfSummary`, `ManagerOption`, `Proposal`, `Choice`, `ManageRequest`, `ManagerReply`, `DecisionOption`, `Decision`; `decodeSituation`, `decodeManagerReply`, `decodeDecision`; `type MatchRequest = SignalsRequest | RecapRequest`
- Produces (Python `touchline_agents.contracts`): `ManageRequest`, `ManagerReply`; `parse_request` returns `SignalsRequest | RecapRequest | ManageRequest`
- Consumes: Task 1's order shape (the contract's `ManagerOrder` matches sim-core's).

- [ ] **Step 1: Write the failing tests**

Create `packages/schema/fixtures/agents/invalid/manager-reply-four-options.json`:

```json
{
 "contract": "manager_reply",
 "value": {
  "task": "propose",
  "proposal": {
   "options": [
    {
     "label": "Fresh striker, press higher",
     "orders": [
      {
       "kind": "sub",
       "off": "iro-09",
       "on": "iro-19"
      },
      {
       "kind": "style",
       "setting": "pressIntensity",
       "value": 1
      }
     ],
     "rationale": "Marsh is tiring and we need a goal."
    },
    {
     "label": "Fresh striker, press higher",
     "orders": [
      {
       "kind": "sub",
       "off": "iro-09",
       "on": "iro-19"
      },
      {
       "kind": "style",
       "setting": "pressIntensity",
       "value": 1
      }
     ],
     "rationale": "Marsh is tiring and we need a goal."
    },
    {
     "label": "Fresh striker, press higher",
     "orders": [
      {
       "kind": "sub",
       "off": "iro-09",
       "on": "iro-19"
      },
      {
       "kind": "style",
       "setting": "pressIntensity",
       "value": 1
      }
     ],
     "rationale": "Marsh is tiring and we need a goal."
    },
    {
     "label": "Fresh striker, press higher",
     "orders": [
      {
       "kind": "sub",
       "off": "iro-09",
       "on": "iro-19"
      },
      {
       "kind": "style",
       "setting": "pressIntensity",
       "value": 1
      }
     ],
     "rationale": "Marsh is tiring and we need a goal."
    }
   ]
  },
  "choice": null,
  "fallback": false,
  "reason": null,
  "ms": 4812.5,
  "tokens_in": 2104,
  "tokens_out": 188,
  "cost_usd": 0.0071,
  "model": "openai:gpt-6.1-sol"
 }
}
```

Create `packages/schema/fixtures/agents/invalid/manager-reply-unknown-setting.json`:

```json
{
 "contract": "manager_reply",
 "value": {
  "task": "propose",
  "proposal": {
   "options": [
    {
     "label": "Fresh striker, press higher",
     "orders": [
      {
       "kind": "style",
       "setting": "formation",
       "value": 1
      }
     ],
     "rationale": "Marsh is tiring and we need a goal."
    }
   ]
  },
  "choice": null,
  "fallback": false,
  "reason": null,
  "ms": 4812.5,
  "tokens_in": 2104,
  "tokens_out": 188,
  "cost_usd": 0.0071,
  "model": "openai:gpt-6.1-sol"
 }
}
```

Create `packages/schema/fixtures/agents/invalid/request-manage-unknown-reason.json`:

```json
{
 "contract": "request",
 "value": {
  "kind": "manage",
  "task": "propose",
  "match_id": "m-5001",
  "situation": {
   "match_id": "m-5001",
   "team_id": "ironmoor",
   "moment": {
    "reasons": [
     "minute_80"
    ],
    "minute": 61.2,
    "minutes_left": 32.3,
    "added_time_expected_min": 3.5,
    "score": {
     "for": 0,
     "against": 1
    },
    "score_state": "losing by 1"
   },
   "team": {
    "name": "Ironmoor Athletic",
    "archetype": "high_press",
    "formation": "4-3-3",
    "style": [
     {
      "setting": "pressIntensity",
      "value": 0.9,
      "min": 0,
      "max": 1,
      "meaning": "0 never press .. 1 press the ball carrier at every chance"
     },
     {
      "setting": "lineHeight",
      "value": 0.8,
      "min": -1,
      "max": 1,
      "meaning": "-1 deep defensive line .. 1 high line"
     },
     {
      "setting": "compactness",
      "value": 0.6,
      "min": 0,
      "max": 1,
      "meaning": "0 spread wide .. 1 narrow, compact block"
     },
     {
      "setting": "tempo",
      "value": 0.8,
      "min": 0,
      "max": 1,
      "meaning": "0 patient build-up .. 1 quick, forward passing"
     },
     {
      "setting": "longBallBias",
      "value": -0.2,
      "min": -1,
      "max": 1,
      "meaning": "-1 short passes only .. 1 long balls often"
     },
     {
      "setting": "crossBias",
      "value": 0,
      "min": -1,
      "max": 1,
      "meaning": "-1 avoid crosses .. 1 cross often"
     },
     {
      "setting": "riskTolerance",
      "value": 0.6,
      "min": 0,
      "max": 1,
      "meaning": "0 safe passes and few shots .. 1 risky passes and shots"
     }
    ],
    "stats": {
     "xg": 0.84,
     "shots": 7,
     "possession_pct": 54.2,
     "pass_completion_pct": 81.5,
     "ppda": 8.1,
     "yellow_cards": 1,
     "red_cards": 0
    }
   },
   "opponent": {
    "name": "Kestrel Bay FC",
    "archetype": "possession",
    "formation": "4-3-3",
    "style": [
     {
      "setting": "pressIntensity",
      "value": 0.9,
      "min": 0,
      "max": 1,
      "meaning": "0 never press .. 1 press the ball carrier at every chance"
     },
     {
      "setting": "lineHeight",
      "value": 0.8,
      "min": -1,
      "max": 1,
      "meaning": "-1 deep defensive line .. 1 high line"
     },
     {
      "setting": "compactness",
      "value": 0.6,
      "min": 0,
      "max": 1,
      "meaning": "0 spread wide .. 1 narrow, compact block"
     },
     {
      "setting": "tempo",
      "value": 0.8,
      "min": 0,
      "max": 1,
      "meaning": "0 patient build-up .. 1 quick, forward passing"
     },
     {
      "setting": "longBallBias",
      "value": -0.2,
      "min": -1,
      "max": 1,
      "meaning": "-1 short passes only .. 1 long balls often"
     },
     {
      "setting": "crossBias",
      "value": 0,
      "min": -1,
      "max": 1,
      "meaning": "-1 avoid crosses .. 1 cross often"
     },
     {
      "setting": "riskTolerance",
      "value": 0.6,
      "min": 0,
      "max": 1,
      "meaning": "0 safe passes and few shots .. 1 risky passes and shots"
     }
    ],
    "stats": {
     "xg": 0.84,
     "shots": 7,
     "possession_pct": 54.2,
     "pass_completion_pct": 81.5,
     "ppda": 8.1,
     "yellow_cards": 1,
     "red_cards": 0
    }
   },
   "players": {
    "on_pitch": [
     {
      "id": "iro-09",
      "name": "Theo Marsh",
      "number": 9,
      "role": "ST",
      "energy_pct": 58.0,
      "minutes_played": 61.2,
      "yellow_card": false,
      "shots": 3,
      "xg": 0.41,
      "passes_completed": 11,
      "tackles_won": 0
     }
    ],
    "bench": [
     {
      "id": "iro-19",
      "name": "Rafe Dunmore",
      "number": 19,
      "role": "ST",
      "available": true
     }
    ]
   },
   "limits": {
    "subs_left": 5,
    "windows_left": 3,
    "half_time_break": false
   },
   "recent": {
    "window_min": 10,
    "team": {
     "xg": 0.12,
     "shots": 2,
     "ball_regains": 3
    },
    "opponent": {
     "xg": 0.3,
     "shots": 3,
     "ball_regains": 1
    }
   }
  },
  "whatif": null
 }
}
```

Create `packages/schema/fixtures/agents/valid/manager-reply.json`:

```json
{
 "contract": "manager_reply",
 "value": {
  "task": "propose",
  "proposal": {
   "options": [
    {
     "label": "Fresh striker, press higher",
     "orders": [
      {
       "kind": "sub",
       "off": "iro-09",
       "on": "iro-19"
      },
      {
       "kind": "style",
       "setting": "pressIntensity",
       "value": 1
      }
     ],
     "rationale": "Marsh is tiring and we need a goal."
    }
   ]
  },
  "choice": null,
  "fallback": false,
  "reason": null,
  "ms": 4812.5,
  "tokens_in": 2104,
  "tokens_out": 188,
  "cost_usd": 0.0071,
  "model": "openai:gpt-6.1-sol"
 }
}
```

Create `packages/schema/fixtures/agents/valid/request-manage-choose.json`:

```json
{
 "contract": "request",
 "value": {
  "kind": "manage",
  "task": "choose",
  "match_id": "m-5001",
  "situation": {
   "match_id": "m-5001",
   "team_id": "ironmoor",
   "moment": {
    "reasons": [
     "minute_60"
    ],
    "minute": 61.2,
    "minutes_left": 32.3,
    "added_time_expected_min": 3.5,
    "score": {
     "for": 0,
     "against": 1
    },
    "score_state": "losing by 1"
   },
   "team": {
    "name": "Ironmoor Athletic",
    "archetype": "high_press",
    "formation": "4-3-3",
    "style": [
     {
      "setting": "pressIntensity",
      "value": 0.9,
      "min": 0,
      "max": 1,
      "meaning": "0 never press .. 1 press the ball carrier at every chance"
     },
     {
      "setting": "lineHeight",
      "value": 0.8,
      "min": -1,
      "max": 1,
      "meaning": "-1 deep defensive line .. 1 high line"
     },
     {
      "setting": "compactness",
      "value": 0.6,
      "min": 0,
      "max": 1,
      "meaning": "0 spread wide .. 1 narrow, compact block"
     },
     {
      "setting": "tempo",
      "value": 0.8,
      "min": 0,
      "max": 1,
      "meaning": "0 patient build-up .. 1 quick, forward passing"
     },
     {
      "setting": "longBallBias",
      "value": -0.2,
      "min": -1,
      "max": 1,
      "meaning": "-1 short passes only .. 1 long balls often"
     },
     {
      "setting": "crossBias",
      "value": 0,
      "min": -1,
      "max": 1,
      "meaning": "-1 avoid crosses .. 1 cross often"
     },
     {
      "setting": "riskTolerance",
      "value": 0.6,
      "min": 0,
      "max": 1,
      "meaning": "0 safe passes and few shots .. 1 risky passes and shots"
     }
    ],
    "stats": {
     "xg": 0.84,
     "shots": 7,
     "possession_pct": 54.2,
     "pass_completion_pct": 81.5,
     "ppda": 8.1,
     "yellow_cards": 1,
     "red_cards": 0
    }
   },
   "opponent": {
    "name": "Kestrel Bay FC",
    "archetype": "possession",
    "formation": "4-3-3",
    "style": [
     {
      "setting": "pressIntensity",
      "value": 0.9,
      "min": 0,
      "max": 1,
      "meaning": "0 never press .. 1 press the ball carrier at every chance"
     },
     {
      "setting": "lineHeight",
      "value": 0.8,
      "min": -1,
      "max": 1,
      "meaning": "-1 deep defensive line .. 1 high line"
     },
     {
      "setting": "compactness",
      "value": 0.6,
      "min": 0,
      "max": 1,
      "meaning": "0 spread wide .. 1 narrow, compact block"
     },
     {
      "setting": "tempo",
      "value": 0.8,
      "min": 0,
      "max": 1,
      "meaning": "0 patient build-up .. 1 quick, forward passing"
     },
     {
      "setting": "longBallBias",
      "value": -0.2,
      "min": -1,
      "max": 1,
      "meaning": "-1 short passes only .. 1 long balls often"
     },
     {
      "setting": "crossBias",
      "value": 0,
      "min": -1,
      "max": 1,
      "meaning": "-1 avoid crosses .. 1 cross often"
     },
     {
      "setting": "riskTolerance",
      "value": 0.6,
      "min": 0,
      "max": 1,
      "meaning": "0 safe passes and few shots .. 1 risky passes and shots"
     }
    ],
    "stats": {
     "xg": 0.84,
     "shots": 7,
     "possession_pct": 54.2,
     "pass_completion_pct": 81.5,
     "ppda": 8.1,
     "yellow_cards": 1,
     "red_cards": 0
    }
   },
   "players": {
    "on_pitch": [
     {
      "id": "iro-09",
      "name": "Theo Marsh",
      "number": 9,
      "role": "ST",
      "energy_pct": 58.0,
      "minutes_played": 61.2,
      "yellow_card": false,
      "shots": 3,
      "xg": 0.41,
      "passes_completed": 11,
      "tackles_won": 0
     }
    ],
    "bench": [
     {
      "id": "iro-19",
      "name": "Rafe Dunmore",
      "number": 19,
      "role": "ST",
      "available": true
     }
    ]
   },
   "limits": {
    "subs_left": 5,
    "windows_left": 3,
    "half_time_break": false
   },
   "recent": {
    "window_min": 10,
    "team": {
     "xg": 0.12,
     "shots": 2,
     "ball_regains": 3
    },
    "opponent": {
     "xg": 0.3,
     "shots": 3,
     "ball_regains": 1
    }
   }
  },
  "whatif": {
   "seeds": 20,
   "horizon_min": 10,
   "explanation": "Each option was played from this moment 20 times over the next 10 minutes; numbers are the difference from no change, plus or minus one standard error.",
   "options": [
    {
     "index": 0,
     "label": "No change",
     "orders": [],
     "xg_diff_vs_no_change": {
      "mean": 0,
      "se": 0
     },
     "goal_diff_vs_no_change": {
      "mean": 0,
      "se": 0
     },
     "untested": false
    },
    {
     "index": 1,
     "label": "Fresh striker, press higher",
     "orders": [
      {
       "kind": "sub",
       "off": "iro-09",
       "on": "iro-19"
      },
      {
       "kind": "style",
       "setting": "pressIntensity",
       "value": 1
      }
     ],
     "xg_diff_vs_no_change": {
      "mean": 0.06,
      "se": 0.03
     },
     "goal_diff_vs_no_change": {
      "mean": 0.05,
      "se": 0.05
     },
     "untested": false
    }
   ]
  }
 }
}
```

Create `packages/schema/fixtures/agents/valid/request-manage-propose.json`:

```json
{
 "contract": "request",
 "value": {
  "kind": "manage",
  "task": "propose",
  "match_id": "m-5001",
  "situation": {
   "match_id": "m-5001",
   "team_id": "ironmoor",
   "moment": {
    "reasons": [
     "minute_60"
    ],
    "minute": 61.2,
    "minutes_left": 32.3,
    "added_time_expected_min": 3.5,
    "score": {
     "for": 0,
     "against": 1
    },
    "score_state": "losing by 1"
   },
   "team": {
    "name": "Ironmoor Athletic",
    "archetype": "high_press",
    "formation": "4-3-3",
    "style": [
     {
      "setting": "pressIntensity",
      "value": 0.9,
      "min": 0,
      "max": 1,
      "meaning": "0 never press .. 1 press the ball carrier at every chance"
     },
     {
      "setting": "lineHeight",
      "value": 0.8,
      "min": -1,
      "max": 1,
      "meaning": "-1 deep defensive line .. 1 high line"
     },
     {
      "setting": "compactness",
      "value": 0.6,
      "min": 0,
      "max": 1,
      "meaning": "0 spread wide .. 1 narrow, compact block"
     },
     {
      "setting": "tempo",
      "value": 0.8,
      "min": 0,
      "max": 1,
      "meaning": "0 patient build-up .. 1 quick, forward passing"
     },
     {
      "setting": "longBallBias",
      "value": -0.2,
      "min": -1,
      "max": 1,
      "meaning": "-1 short passes only .. 1 long balls often"
     },
     {
      "setting": "crossBias",
      "value": 0,
      "min": -1,
      "max": 1,
      "meaning": "-1 avoid crosses .. 1 cross often"
     },
     {
      "setting": "riskTolerance",
      "value": 0.6,
      "min": 0,
      "max": 1,
      "meaning": "0 safe passes and few shots .. 1 risky passes and shots"
     }
    ],
    "stats": {
     "xg": 0.84,
     "shots": 7,
     "possession_pct": 54.2,
     "pass_completion_pct": 81.5,
     "ppda": 8.1,
     "yellow_cards": 1,
     "red_cards": 0
    }
   },
   "opponent": {
    "name": "Kestrel Bay FC",
    "archetype": "possession",
    "formation": "4-3-3",
    "style": [
     {
      "setting": "pressIntensity",
      "value": 0.9,
      "min": 0,
      "max": 1,
      "meaning": "0 never press .. 1 press the ball carrier at every chance"
     },
     {
      "setting": "lineHeight",
      "value": 0.8,
      "min": -1,
      "max": 1,
      "meaning": "-1 deep defensive line .. 1 high line"
     },
     {
      "setting": "compactness",
      "value": 0.6,
      "min": 0,
      "max": 1,
      "meaning": "0 spread wide .. 1 narrow, compact block"
     },
     {
      "setting": "tempo",
      "value": 0.8,
      "min": 0,
      "max": 1,
      "meaning": "0 patient build-up .. 1 quick, forward passing"
     },
     {
      "setting": "longBallBias",
      "value": -0.2,
      "min": -1,
      "max": 1,
      "meaning": "-1 short passes only .. 1 long balls often"
     },
     {
      "setting": "crossBias",
      "value": 0,
      "min": -1,
      "max": 1,
      "meaning": "-1 avoid crosses .. 1 cross often"
     },
     {
      "setting": "riskTolerance",
      "value": 0.6,
      "min": 0,
      "max": 1,
      "meaning": "0 safe passes and few shots .. 1 risky passes and shots"
     }
    ],
    "stats": {
     "xg": 0.84,
     "shots": 7,
     "possession_pct": 54.2,
     "pass_completion_pct": 81.5,
     "ppda": 8.1,
     "yellow_cards": 1,
     "red_cards": 0
    }
   },
   "players": {
    "on_pitch": [
     {
      "id": "iro-09",
      "name": "Theo Marsh",
      "number": 9,
      "role": "ST",
      "energy_pct": 58.0,
      "minutes_played": 61.2,
      "yellow_card": false,
      "shots": 3,
      "xg": 0.41,
      "passes_completed": 11,
      "tackles_won": 0
     }
    ],
    "bench": [
     {
      "id": "iro-19",
      "name": "Rafe Dunmore",
      "number": 19,
      "role": "ST",
      "available": true
     }
    ]
   },
   "limits": {
    "subs_left": 5,
    "windows_left": 3,
    "half_time_break": false
   },
   "recent": {
    "window_min": 10,
    "team": {
     "xg": 0.12,
     "shots": 2,
     "ball_regains": 3
    },
    "opponent": {
     "xg": 0.3,
     "shots": 3,
     "ball_regains": 1
    }
   }
  },
  "whatif": null
 }
}
```

Apply this change to `packages/agent-gateway/test/fakes.ts`, `packages/schema/test/agents.test.ts`, `services/agents/tests/test_contracts.py` (from the repository root):

```bash
git apply <<'PATCH'
diff --git a/packages/agent-gateway/test/fakes.ts b/packages/agent-gateway/test/fakes.ts
index 0f42423..71a6ced 100644
--- a/packages/agent-gateway/test/fakes.ts
+++ b/packages/agent-gateway/test/fakes.ts
@@ -1,6 +1,6 @@
 import { readFileSync } from "node:fs"
 import { join } from "node:path"
-import type { AgentRequest, Cue, Signal } from "@touchline/schema"
+import type { AgentRequest, Cue, MatchRequest, Signal } from "@touchline/schema"
 import type { Artifact, Sender } from "../src/a2a.js"
 import type { MatchPlan } from "../src/gateway.js"
 import { root } from "../src/replay.js"
@@ -21,11 +21,11 @@ export const plan = (frames: number[], whistles = { half_time: 27000, full_time:
 })
 
 /** A sender that answers each request with `answer(req, n)` (n counts calls), waiting `delayMs` before each artifact. */
-export const fake = (answer: (req: AgentRequest, n: number) => Artifact[] | Error, delayMs = 0): Sender & { calls: AgentRequest[] } => {
-  const calls: AgentRequest[] = []
+export const fake = (answer: (req: MatchRequest, n: number) => Artifact[] | Error, delayMs = 0): Sender & { calls: MatchRequest[] } => {
+  const calls: MatchRequest[] = []
   const send = async function* (req: AgentRequest) {
-    calls.push(req)
-    const out = answer(req, calls.length)
+    calls.push(req as MatchRequest)
+    const out = answer(req as MatchRequest, calls.length)
     if (out instanceof Error) throw out
     for (const a of out) {
       if (delayMs) await new Promise((r) => setTimeout(r, delayMs))
diff --git a/packages/schema/test/agents.test.ts b/packages/schema/test/agents.test.ts
index 75f55f3..65d54d0 100644
--- a/packages/schema/test/agents.test.ts
+++ b/packages/schema/test/agents.test.ts
@@ -29,9 +29,9 @@ describe("agent contracts", () => {
     expect(cue.schema).toBe("touchline.cue/1")
     expect(cue.anchor).toEqual({ frame_from: 39880, frame_to: 40213, clock: "67:02" })
   })
-  it("tells signals and recap requests apart by kind", () => {
+  it("tells signals, recap and manage requests apart by kind", () => {
     const kinds = fixtures("valid").filter((f) => f.contract === "request").map((f) => decodeAgentRequest(f.value).kind)
-    expect(kinds.sort()).toEqual(["recap", "signals"])
+    expect(kinds.sort()).toEqual(["manage", "manage", "recap", "signals"])
   })
   it("keys segments by mode, language and club", () => {
     expect(segmentKey({ mode: "analyst", lang: "hi", club: null })).toBe("analyst.hi.neutral")
@@ -43,7 +43,7 @@ describe("agent contracts", () => {
 describe("JSON Schema export", () => {
   it("names every contract under $defs", () => {
     const defs = Object.keys(contractsJsonSchema().$defs as object)
-    for (const name of ["Signal", "Moment", "Claim", "Analysis", "Draft", "Verdict", "Cue", "Recap", "MomentTrace", "SignalsRequest", "RecapRequest", "Segment"]) expect(defs).toContain(name)
+    for (const name of ["Signal", "Moment", "Claim", "Analysis", "Draft", "Verdict", "Cue", "Recap", "MomentTrace", "SignalsRequest", "RecapRequest", "Segment", "ManageRequest", "ManagerReply", "Situation", "ManagerOrder"]) expect(defs).toContain(name)
   })
   it("matches the committed file (run `pnpm --filter @touchline/schema json` after changing a contract)", () => {
     expect(readFileSync(join(root, CONTRACTS_SCHEMA_PATH), "utf8")).toBe(contractsJsonText())
diff --git a/services/agents/tests/test_contracts.py b/services/agents/tests/test_contracts.py
index 1294c95..662eec4 100644
--- a/services/agents/tests/test_contracts.py
+++ b/services/agents/tests/test_contracts.py
@@ -32,7 +32,7 @@ def test_invalid_fixture_rejected(name, fixture):
 
 def test_requests_parse_by_kind():
     kinds = sorted(c.parse_request(f["value"]).kind for _, f in load("valid") if f["contract"] == "request")
-    assert kinds == ["recap", "signals"]
+    assert kinds == ["manage", "manage", "recap", "signals"]
 
 
 def test_segment_key_matches_typescript():
PATCH
```

- [ ] **Step 2: Run them to make sure they fail**

Run: `pnpm --filter @touchline/schema test`
Expected: FAIL (3 tests): the export has no `ManageRequest`, the new fixtures name a `manager_reply` contract that does not exist, and the request kinds lack `manage`

Run: `uv run --project services/agents pytest -q services/agents/tests/test_contracts.py`
Expected: `6 failed, 19 passed`: the manage fixtures do not parse (`test_requests_parse_by_kind` and the new fixture round trips)

- [ ] **Step 3: Write the implementation**

Create `packages/schema/src/manager.ts`:

```ts
/**
 * Manager agent contracts (Plan 4b): what the engine sends the manager agent at a key moment (`Situation`, and the
 * what-if results of its options), what the agent answers (`Proposal`, `Choice`), and the decision log line.
 * `Situation` is the whole of what the model sees about the match: every field is listed here and nothing else is sent.
 */
import { Schema } from "effect"

const NonNegInt = Schema.Int.check(Schema.isGreaterThanOrEqualTo(0))
const Id = Schema.String.check(Schema.isMinLength(1))

export const StyleKey = Schema.Literals(["pressIntensity", "lineHeight", "compactness", "tempo", "longBallBias", "crossBias", "riskTolerance"])
export type StyleKey = typeof StyleKey.Type

/** One change a manager orders: a style setting to a new value, or a substitution (player ids). */
export const ManagerOrder = Schema.Union([
  Schema.Struct({ kind: Schema.Literal("style"), setting: StyleKey, value: Schema.Finite }),
  Schema.Struct({ kind: Schema.Literal("sub"), off: Id, on: Id })
]).annotate({ identifier: "ManagerOrder" })
export type ManagerOrder = typeof ManagerOrder.Type

export const MomentReason = Schema.Literals(["half_time", "after_goal", "minute_60", "minute_75"])
export type MomentReason = typeof MomentReason.Type

const Role = Schema.Literals(["GK", "CB", "FB", "DM", "CM", "AM", "W", "ST"])

/** A style setting: its value now, its allowed range and what it does. */
export const StyleSetting = Schema.Struct({ setting: StyleKey, value: Schema.Finite, min: Schema.Finite, max: Schema.Finite, meaning: Schema.String }).annotate({
  identifier: "StyleSetting"
})

/** A team's match so far, up to the pause. */
export const TeamStats = Schema.Struct({
  xg: Schema.Finite,
  shots: NonNegInt,
  possession_pct: Schema.Finite,
  pass_completion_pct: Schema.NullOr(Schema.Finite),
  /** Opponent passes per defensive action in the opponent's 60 % of the pitch (lower: more pressing); null before any. */
  ppda: Schema.NullOr(Schema.Finite),
  yellow_cards: NonNegInt,
  red_cards: NonNegInt
}).annotate({ identifier: "TeamStats" })

export const TeamView = Schema.Struct({
  name: Id,
  archetype: Schema.Literals(["high_press", "possession", "direct", "low_block"]),
  formation: Schema.String,
  style: Schema.Array(StyleSetting),
  stats: TeamStats
}).annotate({ identifier: "TeamView" })

/** A player on the pitch, as their manager sees them. */
export const PlayerView = Schema.Struct({
  id: Id,
  name: Schema.String,
  number: NonNegInt,
  role: Role,
  energy_pct: Schema.Finite,
  minutes_played: Schema.Finite,
  yellow_card: Schema.Boolean,
  shots: NonNegInt,
  xg: Schema.Finite,
  passes_completed: NonNegInt,
  tackles_won: NonNegInt
}).annotate({ identifier: "PlayerView" })

export const BenchView = Schema.Struct({ id: Id, name: Schema.String, number: NonNegInt, role: Role, available: Schema.Boolean }).annotate({ identifier: "BenchView" })

/** One side's last minutes of play; ball_regains counts tackles won, interceptions and recoveries. */
export const RecentView = Schema.Struct({ xg: Schema.Finite, shots: NonNegInt, ball_regains: NonNegInt }).annotate({ identifier: "RecentView" })

/** What the manager agent knows at a key moment: the match from its own team's side, up to the pause tick only. */
export const Situation = Schema.Struct({
  match_id: Id,
  team_id: Id,
  moment: Schema.Struct({
    reasons: Schema.Array(MomentReason).check(Schema.isMinLength(1)),
    minute: Schema.Finite,
    minutes_left: Schema.Finite,
    added_time_expected_min: Schema.Finite,
    score: Schema.Struct({ for: NonNegInt, against: NonNegInt }),
    /** "level", "winning by 2", "losing by 1". */
    score_state: Schema.String
  }),
  team: TeamView,
  opponent: TeamView,
  players: Schema.Struct({ on_pitch: Schema.Array(PlayerView), bench: Schema.Array(BenchView) }),
  limits: Schema.Struct({ subs_left: NonNegInt, windows_left: NonNegInt, half_time_break: Schema.Boolean }),
  recent: Schema.Struct({ window_min: Schema.Finite, team: RecentView, opponent: RecentView })
}).annotate({ identifier: "Situation" })
export type Situation = typeof Situation.Type

export const Estimate = Schema.Struct({ mean: Schema.Finite, se: Schema.Finite }).annotate({ identifier: "Estimate" })

/** One option as re-simulated: option 0 is always "no change", the baseline of the others. */
export const OptionResult = Schema.Struct({
  index: NonNegInt,
  label: Schema.String,
  orders: Schema.Array(ManagerOrder),
  /** Paired difference against "no change" over the same seeds; null when the option could not be tested. */
  xg_diff_vs_no_change: Schema.NullOr(Estimate),
  goal_diff_vs_no_change: Schema.NullOr(Estimate),
  untested: Schema.Boolean
}).annotate({ identifier: "OptionResult" })

export const WhatIfSummary = Schema.Struct({
  seeds: NonNegInt,
  horizon_min: Schema.Finite,
  explanation: Schema.String,
  options: Schema.Array(OptionResult).check(Schema.isMinLength(1))
}).annotate({ identifier: "WhatIfSummary" })
export type WhatIfSummary = typeof WhatIfSummary.Type

export const ManagerOption = Schema.Struct({
  label: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(60)),
  orders: Schema.Array(ManagerOrder).check(Schema.isMinLength(1)),
  rationale: Schema.String
}).annotate({ identifier: "ManagerOption" })
export type ManagerOption = typeof ManagerOption.Type

/** The agent's candidate changes ("no change" is never proposed: the engine always adds it). */
export const Proposal = Schema.Struct({ options: Schema.Array(ManagerOption).check(Schema.isMinLength(1), Schema.isMaxLength(3)) }).annotate({ identifier: "Proposal" })
export type Proposal = typeof Proposal.Type

/** The agent's pick: an index into the what-if options (0 = no change) and why. */
export const Choice = Schema.Struct({ pick: NonNegInt, reason: Schema.String }).annotate({ identifier: "Choice" })
export type Choice = typeof Choice.Type

/** A request to the manager agent: propose options, or choose among the tested ones. */
export const ManageRequest = Schema.Struct({
  kind: Schema.Literal("manage"),
  task: Schema.Literals(["propose", "choose"]),
  match_id: Id,
  situation: Situation,
  whatif: Schema.NullOr(WhatIfSummary)
}).annotate({ identifier: "ManageRequest" })
export type ManageRequest = typeof ManageRequest.Type

/** The manager agent's answer (artifact "manager"); `fallback` true means the model failed and nothing was decided. */
export const ManagerReply = Schema.Struct({
  task: Schema.Literals(["propose", "choose"]),
  proposal: Schema.NullOr(Proposal),
  choice: Schema.NullOr(Choice),
  fallback: Schema.Boolean,
  reason: Schema.NullOr(Schema.String),
  ms: Schema.Finite,
  tokens_in: NonNegInt,
  tokens_out: NonNegInt,
  cost_usd: Schema.Finite,
  model: Schema.String
}).annotate({ identifier: "ManagerReply" })
export type ManagerReply = typeof ManagerReply.Type

export const DecisionOption = Schema.Struct({
  index: NonNegInt,
  label: Schema.String,
  source: Schema.Literals(["no_change", "agent", "rules"]),
  orders: Schema.Array(ManagerOrder),
  rationale: Schema.NullOr(Schema.String),
  xg_diff_vs_no_change: Schema.NullOr(Estimate),
  goal_diff_vs_no_change: Schema.NullOr(Estimate),
  untested: Schema.Boolean,
  /** Orders the engine refused for this option, with the reason. */
  dropped: Schema.Array(Schema.Struct({ order: ManagerOrder, reason: Schema.String }))
}).annotate({ identifier: "DecisionOption" })

/** One line of a managed run's decisions.jsonl: everything needed to replay the decision and to show it. */
export const Decision = Schema.Struct({
  match_id: Id,
  tick: NonNegInt,
  minute: Schema.Finite,
  side: Schema.Literals(["home", "away"]),
  team_id: Id,
  manager: Schema.Literals(["rules", "agent"]),
  reasons: Schema.Array(MomentReason),
  /** sha256 of the exact Situation JSON sent to the model (or that the rules read). */
  situation_hash: Schema.String,
  options: Schema.Array(DecisionOption),
  pick: NonNegInt,
  reason: Schema.String,
  orders_applied: Schema.Array(ManagerOrder),
  fallback: Schema.NullOr(Schema.Literals(["propose", "choose", "service"])),
  timings_ms: Schema.Struct({ propose: Schema.Finite, whatif: Schema.Finite, choose: Schema.Finite }),
  tokens: Schema.Struct({ in: NonNegInt, out: NonNegInt }),
  cost_usd: Schema.Finite,
  model: Schema.String
}).annotate({ identifier: "Decision" })
export type Decision = typeof Decision.Type

export const decodeSituation = Schema.decodeUnknownSync(Situation)
export const decodeManagerReply = Schema.decodeUnknownSync(ManagerReply)
export const decodeDecision = Schema.decodeUnknownSync(Decision)
```

Apply this change to `packages/agent-gateway/src/gateway.ts`, `packages/schema/src/agents.ts`, `packages/schema/src/index.ts`, `services/agents/touchline_agents/contracts.py` (from the repository root):

```bash
git apply <<'PATCH'
diff --git a/packages/agent-gateway/src/gateway.ts b/packages/agent-gateway/src/gateway.ts
index 64584bc..66b51bd 100644
--- a/packages/agent-gateway/src/gateway.ts
+++ b/packages/agent-gateway/src/gateway.ts
@@ -4,7 +4,7 @@
  * of everything that comes back. Late cues (received after their ttl) and unverified cues are dropped.
  */
 import { Data, Effect } from "effect"
-import { decodeCue, decodeMomentTrace, decodeRecap, type AgentRequest, type Cue, type MomentTrace, type Recap, type Segment, type Signal } from "@touchline/schema"
+import { decodeCue, decodeMomentTrace, decodeRecap, type Cue, type MatchRequest, type MomentTrace, type Recap, type Segment, type Signal } from "@touchline/schema"
 import { TaskFailed, type Sender } from "./a2a.js"
 
 export class AgentUnavailable extends Data.TaggedError("AgentUnavailable")<{ readonly reason: string }> {}
@@ -40,7 +40,7 @@ export interface MatchPlan {
 export type Outcome = "ok" | "failed" | "timeout" | "unavailable" | "invalid" | "skipped"
 
 export interface RequestLog {
-  readonly kind: AgentRequest["kind"]
+  readonly kind: MatchRequest["kind"]
   readonly frame: number
   readonly outcome: Outcome
   readonly ms: number
@@ -58,7 +58,7 @@ export interface GatewayResult {
 }
 
 /** The requests for a match in order: a signals batch per `batchS` seconds that raised any, and a recap at each whistle. */
-export const timeline = (plan: MatchPlan, opts: GatewayOptions): AgentRequest[] => {
+export const timeline = (plan: MatchPlan, opts: GatewayOptions): MatchRequest[] => {
   const base = { match_id: plan.matchId, mcp_url: plan.mcpUrl, segments: [...opts.segments] }
   const width = Math.max(1, Math.round(opts.batchS * plan.fps))
   const groups = new Map<number, Signal[]>()
@@ -66,7 +66,7 @@ export const timeline = (plan: MatchPlan, opts: GatewayOptions): AgentRequest[]
     const k = Math.floor(s.frame_id / width)
     groups.set(k, [...(groups.get(k) ?? []), s])
   }
-  const out: Array<{ frame: number; order: number; req: AgentRequest }> = [...groups.values()].map((g) => {
+  const out: Array<{ frame: number; order: number; req: MatchRequest }> = [...groups.values()].map((g) => {
     const frame = g[g.length - 1]!.frame_id
     return { frame, order: 0, req: { kind: "signals" as const, ...base, now_frame: frame, signals: g } }
   })
@@ -77,7 +77,7 @@ export const timeline = (plan: MatchPlan, opts: GatewayOptions): AgentRequest[]
   return out.sort((a, b) => a.frame - b.frame || a.order - b.order).map((x) => x.req)
 }
 
-const frameOf = (req: AgentRequest) => (req.kind === "signals" ? req.now_frame : req.at_frame)
+const frameOf = (req: MatchRequest) => (req.kind === "signals" ? req.now_frame : req.at_frame)
 
 /** What a request has received so far; the caller keeps it, so cues that arrived before a timeout are not lost. */
 export interface Received {
@@ -99,7 +99,7 @@ const decode = <A>(name: string, f: (u: unknown) => A, data: unknown): A => {
 }
 
 /** One request: stream its artifacts into `got`, validating each and dropping late and unverified cues. */
-export const exchange = (send: Sender, req: AgentRequest, budgetMs: number, got: Received = received()) => {
+export const exchange = (send: Sender, req: MatchRequest, budgetMs: number, got: Received = received()) => {
   const run = Effect.tryPromise({
     try: async (signal) => {
       const t0 = performance.now()
diff --git a/packages/schema/src/agents.ts b/packages/schema/src/agents.ts
index ba8244d..d9f7773 100644
--- a/packages/schema/src/agents.ts
+++ b/packages/schema/src/agents.ts
@@ -4,6 +4,7 @@
  * are generated, and every A2A message and artifact is validated against them on both sides.
  */
 import { Schema } from "effect"
+import { ManageRequest, ManagerReply } from "./manager.js"
 import { MetricId, Signal, SignalType } from "./stats.js"
 
 const NonNegInt = Schema.Int.check(Schema.isGreaterThanOrEqualTo(0))
@@ -189,11 +190,13 @@ export const RecapRequest = Schema.Struct({
 }).annotate({ identifier: "RecapRequest" })
 
 /** The data part of every A2A message the gateway sends. */
-export const AgentRequest = Schema.Union([SignalsRequest, RecapRequest]).annotate({ identifier: "AgentRequest" })
+export const AgentRequest = Schema.Union([SignalsRequest, RecapRequest, ManageRequest]).annotate({ identifier: "AgentRequest" })
 export type AgentRequest = typeof AgentRequest.Type
+/** The requests of a match's commentary timeline (the gateway's batches and recaps). */
+export type MatchRequest = typeof SignalsRequest.Type | typeof RecapRequest.Type
 
 /** A2A artifact names and the contract each one carries. */
-export const ARTIFACTS = { cue: Cue, trace: MomentTrace, recap: Recap } as const
+export const ARTIFACTS = { cue: Cue, trace: MomentTrace, recap: Recap, manager: ManagerReply } as const
 
 /** All contracts in one document (the JSON Schema export's root). */
 export const AgentContracts = Schema.Struct({
@@ -206,7 +209,8 @@ export const AgentContracts = Schema.Struct({
   cue: Cue,
   recap: Recap,
   trace: MomentTrace,
-  request: AgentRequest
+  request: AgentRequest,
+  manager_reply: ManagerReply
 }).annotate({ identifier: "AgentContracts" })
 
 export const decodeCue = Schema.decodeUnknownSync(Cue)
diff --git a/packages/schema/src/index.ts b/packages/schema/src/index.ts
index ca204f8..0a7470c 100644
--- a/packages/schema/src/index.ts
+++ b/packages/schema/src/index.ts
@@ -1,4 +1,5 @@
 export * from "./agents.js"
+export * from "./manager.js"
 export * from "./domain.js"
 export * from "./json.js"
 export * from "./stats.js"
diff --git a/services/agents/touchline_agents/contracts.py b/services/agents/touchline_agents/contracts.py
index af5ff4a..564884c 100644
--- a/services/agents/touchline_agents/contracts.py
+++ b/services/agents/touchline_agents/contracts.py
@@ -11,6 +11,8 @@ from .contracts_gen import (
     Cue,
     Display,
     Draft,
+    ManagerReply,
+    ManageRequest,
     Moment,
     MomentTrace,
     Recap,
@@ -24,18 +26,19 @@ from .contracts_gen import (
 )
 
 __all__ = [
-    "MAX_SEGMENTS", "AgentRequest", "Analysis", "Anchor", "Claim", "Cue", "Display", "Draft", "Moment", "MomentTrace",
+    "MAX_SEGMENTS", "AgentRequest", "Analysis", "Anchor", "Claim", "Cue", "Display", "Draft", "ManageRequest", "ManagerReply",
+    "Moment", "MomentTrace",
     "Recap", "RecapRequest", "Segment", "SentenceCheck", "Signal", "SignalsRequest", "Text", "Verdict",
     "dump", "parse_request", "segment_key",
 ]
 
 MAX_SEGMENTS = 12
 
-AgentRequest = Annotated[SignalsRequest | RecapRequest, Field(discriminator="kind")]
+AgentRequest = Annotated[SignalsRequest | RecapRequest | ManageRequest, Field(discriminator="kind")]
 _request = TypeAdapter(AgentRequest)
 
 
-def parse_request(data: object) -> SignalsRequest | RecapRequest:
+def parse_request(data: object) -> SignalsRequest | RecapRequest | ManageRequest:
     """Validate the data part of an A2A message (raises pydantic.ValidationError)."""
     return _request.validate_python(data)
 
PATCH
```

- [ ] **Step 4: Regenerate the JSON Schema and the Pydantic models**

Run: `pnpm --filter @touchline/schema json && (cd services/agents && uv run python scripts/gen_contracts.py)`
Expected: `wrote packages/schema/json/agent-contracts.schema.json` and `wrote touchline_agents/contracts_gen.py`; `contracts_gen.py` gains `Situation`, `ManagerOrder1` (style) and `ManagerOrder2` (sub), `ManageRequest`, `Proposal`, `Choice`, `ManagerReply`, and `Score.for_` (alias `for`).

- [ ] **Step 5: Run the tests**

Run: `pnpm --filter @touchline/schema test`
Expected: `Tests  11 passed (11)`

Run: `uv run --project services/agents pytest -q services/agents/tests`
Expected: `164 passed, 7 deselected`

Run: `pnpm turbo run typecheck --force`
Expected: `Tasks:    12 successful, 12 total`

- [ ] **Step 6: Commit**

```bash
git add packages/agent-gateway packages/schema services/agents
git commit -m "feat(schema): manager agent contracts — Situation (everything the model sees), orders, proposal, choice, what-if summary, the manage request and reply, and the decision log line; exported to JSON Schema and Pydantic

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Key moments and the Situation

A new package, `packages/manager`, holds everything about managed matches. This task adds when managers decide (key moments: the second-half kickoff, the kickoff after a goal, the first restart at or after minutes 60 and 75, merged at one stoppage and absorbed within 5 minutes of a decision — Ruling 1) and what they are told: `situationAt` builds the `Situation` from the paused state and the match so far (its events and the stats engine fed step by step). The payload is the schema-checked value (extra fields cannot get through), hashed for the decision log, within 2,500 tokens, and a reviewed example is committed (Ruling 3 fixed what the first review found).

**Files:**
- Create: `packages/manager/package.json`, `packages/manager/tsconfig.json`, `packages/manager/vitest.config.ts`
- Create: `packages/manager/src/moments.ts`, `packages/manager/src/situation.ts`, `packages/manager/src/index.ts`
- Test: `packages/manager/test/helpers.ts`, `packages/manager/test/moments.test.ts`, `packages/manager/test/situation.test.ts`, `packages/manager/test/golden/situation-m-11-minute_60.json` (written by the test, then reviewed)
- Modify: `pnpm-lock.yaml` (by `pnpm install`)

**Interfaces:**
- Produces (`@touchline/manager`):
  - `interface MomentMemory { goalPending; done: MomentReason[]; lastMinute: number | null }`; `NO_MOMENTS`; `ABSORB_MIN = 5`
  - `minuteOf(s): number`; `keyMoment(s, events, memory): { reasons: MomentReason[]; memory }`
  - `class MatchWatch(cfg, models, xt) { events; engine; add(stepOutput) }`
  - `situationAt(s, side, reasons, watch): Situation`; `situationJson(sit): string`; `situationHash(sit): string`; `payloadTokens(sit)`; `MAX_SITUATION_TOKENS = 2500`; `STYLE_MEANINGS`; `RECENT_MIN = 10`
- Consumes: Task 1 (`isHalfTimeBreak`, `subsLeft`, `windowsLeft`, `availableBench`, `STYLE_RANGES`), Task 2 (`Situation`, `decodeSituation`, `MomentReason`), `@touchline/stats` (`StatsEngine`, `infoFromConfig`).

- [ ] **Step 1: Create the package**

Create `packages/manager/package.json`:

```json
{
  "name": "@touchline/manager",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "exports": { ".": "./src/index.ts" },
  "scripts": { "test": "vitest run", "typecheck": "tsc --noEmit -p ." },
  "dependencies": {
    "@touchline/schema": "workspace:*",
    "@touchline/sim-core": "workspace:*",
    "@touchline/stats": "workspace:*",
    "effect": "4.0.1"
  },
  "devDependencies": { "@touchline/league": "workspace:*" }
}
```

Create `packages/manager/tsconfig.json`:

```json
{ "extends": "../../tsconfig.base.json", "include": ["src", "test", "scripts"] }
```

Create `packages/manager/vitest.config.ts`:

```ts
import { defineConfig } from "vitest/config"

export default defineConfig({ test: { globalSetup: ["../../vitest.tmp.ts"], testTimeout: 120_000 } })
```

Run: `pnpm install`
Expected: the workspace links `@touchline/manager`; `pnpm-lock.yaml` gains its importer

- [ ] **Step 2: Write the failing tests**

Create `packages/manager/test/helpers.ts`:

```ts
import { readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import type { League } from "@touchline/league"
import { initMatch, isFinished, paramsFromJson, step, type DomainEvent, type MatchConfig, type MatchState } from "@touchline/sim-core"
import { modelsFromJson, xtGridFromJson } from "@touchline/stats"
import { keyMoment, NO_MOMENTS } from "../src/moments.js"
import { MatchWatch } from "../src/situation.js"
import type { MomentReason } from "@touchline/schema"

export const root = join(dirname(fileURLToPath(import.meta.url)), "../../..")
const json = (p: string) => JSON.parse(readFileSync(join(root, p), "utf8"))
export const league = json("data/league/league.json") as League
export const params = paramsFromJson(json("data/params/touchline-params.json"))
export const models = modelsFromJson(json("data/params/stats-models.json"))
export const xt = xtGridFromJson(json("data/params/xt-grid.json"))
export const club = (id: string) => league.clubs.find((c) => c.id === id)!

/** A league match (calibrated params) whose listed sides have a manager. */
export const leagueConfig = (seed: number, managed: MatchConfig["managed"] = ["home", "away"], home = "ironmoor", away = "kestrel-bay"): MatchConfig => ({
  matchId: `m-${seed}`, seed, kickoffTime: "2026-10-18T14:00:00.000Z", home: club(home), away: club(away), params, dt: 0.1, managed
})

export interface Moment {
  readonly state: MatchState
  readonly reasons: MomentReason[]
}

/** Play a match with no decisions made, recording every key moment; stop early once `stop` holds for a moment. */
export const playMoments = (cfg: MatchConfig, stop: (m: Moment) => boolean = () => false) => {
  let s = initMatch(cfg)
  let memory = NO_MOMENTS
  const watch = new MatchWatch(cfg, models, xt)
  const moments: Moment[] = []
  const events: DomainEvent[] = []
  while (!isFinished(s)) {
    const r = step(s)
    s = r.state
    watch.add(r)
    events.push(...r.events)
    const k = keyMoment(s, r.events, memory)
    memory = k.memory
    if (k.reasons.length > 0) {
      const m = { state: s, reasons: k.reasons }
      moments.push(m)
      if (stop(m)) break
    }
  }
  return { state: s, moments, events, watch }
}
```

Create `packages/manager/test/moments.test.ts`:

```ts
import { initMatch, isFinished, step } from "@touchline/sim-core"
import { describe, expect, it } from "vitest"
import { keyMoment, minuteOf, NO_MOMENTS } from "../src/moments.js"
import { leagueConfig, playMoments } from "./helpers.js"

const run = playMoments(leagueConfig(11))
const withReason = (r: string) => run.moments.filter((m) => m.reasons.includes(r as never))

describe("key moments", () => {
  it("are all stoppages, so the ball is dead while the manager decides", () => {
    expect(run.moments.length).toBeGreaterThanOrEqual(3)
    for (const m of run.moments) {
      expect(m.state.phase.kind).toBe("restart")
      expect(m.state.possession.kind).toBe("dead")
    }
  })
  it("include half time once, at the second-half kickoff before play", () => {
    const ht = withReason("half_time")
    expect(ht).toHaveLength(1)
    expect([ht[0]!.state.period, ht[0]!.state.periodTick]).toEqual(["second_half", 0])
  })
  it("include minute 60 and minute 75 once each, at the first restart from that minute", () => {
    for (const [reason, at] of [["minute_60", 60], ["minute_75", 75]] as const) {
      const ms = withReason(reason)
      expect(ms).toHaveLength(1)
      // An independent scan of the same match: the first state at a restart from that minute on.
      let s = initMatch(leagueConfig(11))
      while (!isFinished(s) && !(s.phase.kind === "restart" && minuteOf(s) >= at)) s = step(s).state
      expect(ms[0]!.state.tick).toBe(s.tick)
    }
  })
  it("include the kickoff after every goal", () => {
    const goals = run.events.filter((e) => e.type === "goal").length
    expect(withReason("after_goal")).toHaveLength(goals)
    for (const m of withReason("after_goal")) expect(m.state.phase.kind === "restart" && m.state.phase.restart).toBe("kickoff")
  })
  it("absorb a minute moment due within 5 minutes of a decision, but merge it into a decision made at the same stoppage", () => {
    const at60 = withReason("minute_60")[0]!.state
    const minute = minuteOf(at60)
    const recent = keyMoment(at60, [], { goalPending: false, done: ["half_time"], lastMinute: minute - 1 })
    expect(recent.reasons).toEqual([])
    expect(recent.memory.done).toContain("minute_60")
    expect(keyMoment(at60, [], { goalPending: false, done: ["half_time"], lastMinute: minute - 6 }).reasons).toEqual(["minute_60"])
    const kickoff = { ...at60, phase: { ...at60.phase, restart: "kickoff" } } as typeof at60
    expect(keyMoment(kickoff, [], { goalPending: true, done: ["half_time"], lastMinute: minute - 1 }).reasons).toEqual(["after_goal", "minute_60"])
  })
  it("are never raised in open play", () => {
    const open = { ...run.state, phase: { kind: "open_play" as const } }
    expect(keyMoment(open, [{ type: "goal" } as never], NO_MOMENTS).reasons).toEqual([])
  })
})
```

Create `packages/manager/test/situation.test.ts`:

```ts
import { readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { Schema } from "effect"
import { initMatch, step, type MatchState } from "@touchline/sim-core"
import { Situation } from "@touchline/schema"
import { describe, expect, it } from "vitest"
import { MAX_SITUATION_TOKENS, MatchWatch, payloadTokens, situationAt, situationHash, situationJson } from "../src/situation.js"
import { leagueConfig, models, playMoments, xt } from "./helpers.js"

const cfg = leagueConfig(11)
const run = playMoments(cfg, (m) => m.reasons.includes("minute_60"))
const at60 = run.moments.find((m) => m.reasons.includes("minute_60"))!
const sit = situationAt(at60.state, "home", at60.reasons, run.watch)

/** Every key path of a JSON value (array items under "[]"). */
const paths = (v: unknown, at = ""): string[] =>
  Array.isArray(v) ? v.flatMap((x) => paths(x, `${at}[]`)) : v !== null && typeof v === "object" ? Object.entries(v).flatMap(([k, x]) => [`${at}.${k}`, ...paths(x, `${at}.${k}`)]) : []

describe("the situation sent to the manager agent", () => {
  it("has exactly the documented fields: the payload is the schema-checked value, and extra fields never get through", () => {
    expect(() => Schema.decodeUnknownSync(Situation)(sit, { onExcessProperty: "error" })).not.toThrow()
    expect(JSON.parse(situationJson(sit))).toEqual(sit)
    const leaky = { ...sit, seed: 11, team: { ...sit.team, rng: [1, 2] } }
    expect(paths(JSON.parse(situationJson(leaky as never)))).toEqual(paths(sit))
  })
  it("never carries the seed, random state, script, forced outcomes, truths or the drawn added time", () => {
    const text = situationJson(sit)
    for (const word of ["seed", "rng", "script", "forced", "truth", "periodTicks", "scripted"]) expect(text).not.toContain(word)
    expect(text).not.toContain(String(at60.state.periodTicks))
  })
  it("depends only on the match up to the pause: hidden state does not change it", () => {
    const hidden: MatchState = {
      ...at60.state,
      periodTicks: at60.state.periodTicks + 900,
      rng: initMatch(leagueConfig(999)).rng,
      forced: [{ window: [60, 70], team: "home", effect: "goal", count: 1 }],
      config: { ...at60.state.config, seed: 999, script: { name: "x", entries: [] } }
    }
    expect(situationAt(hidden, "home", at60.reasons, run.watch)).toEqual(sit)
  })
  it("is the same when rebuilt from a replay stopped at the pause tick", () => {
    let s = initMatch(cfg)
    const watch = new MatchWatch(cfg, models, xt)
    while (s.tick < at60.state.tick) {
      const r = step(s)
      s = r.state
      watch.add(r)
    }
    expect(situationAt(s, "home", at60.reasons, watch)).toEqual(sit)
    expect(situationHash(situationAt(s, "home", at60.reasons, watch))).toBe(situationHash(sit))
  })
  it("fits the token budget", () => {
    expect(payloadTokens(sit)).toBeLessThanOrEqual(MAX_SITUATION_TOKENS)
  })
  it("describes the team's own side: eleven players, the bench, five substitutions left, the score from its side", () => {
    expect(sit.team.name).toBe(cfg.home.name)
    expect(sit.opponent.name).toBe(cfg.away.name)
    expect(sit.players.on_pitch).toHaveLength(11)
    expect(sit.players.bench.map((b) => b.id)).toEqual(cfg.home.bench!.map((b) => b.id))
    expect(sit.players.on_pitch.every((p) => p.name !== p.id && p.energy_pct > 0 && p.energy_pct < 100)).toBe(true)
    expect(sit.limits).toEqual({ subs_left: 5, windows_left: 3, half_time_break: false })
    expect(sit.moment.score).toEqual({ for: at60.state.score.home, against: at60.state.score.away })
    expect(sit.moment.minute).toBeGreaterThanOrEqual(60)
    expect(sit.players.on_pitch.every((p) => p.minutes_played === sit.moment.minute)).toBe(true)
    expect(sit.team.stats.possession_pct + sit.opponent.stats.possession_pct).toBeCloseTo(100, 0)
    const away = situationAt(at60.state, "away", at60.reasons, run.watch)
    expect(away.moment.score).toEqual({ for: sit.moment.score.against, against: sit.moment.score.for })
    expect(away.team).toEqual(sit.opponent)
  })
  it("adds up: a team's xG is its players' xG, and its shots are its players' shots", () => {
    const xg = sit.players.on_pitch.reduce((a, p) => a + p.xg, 0)
    // Players substituted off took their shots with them; this match had none before minute 60.
    expect(Math.abs(xg - sit.team.stats.xg)).toBeLessThan(0.05)
    expect(sit.players.on_pitch.reduce((a, p) => a + p.shots, 0)).toBe(sit.team.stats.shots)
  })
  it("matches the reviewed example (UPDATE_GOLDEN=1 rewrites it after a deliberate change)", () => {
    const file = join(import.meta.dirname, "golden/situation-m-11-minute_60.json")
    const text = JSON.stringify(sit, null, 1) + "\n"
    if (process.env.UPDATE_GOLDEN === "1") writeFileSync(file, text)
    expect(text).toBe(readFileSync(file, "utf8"))
  })
})
```

- [ ] **Step 3: Run them to make sure they fail**

Run: `pnpm --filter @touchline/manager test`
Expected: FAIL: `../src/moments.js` and `../src/situation.js` do not exist

- [ ] **Step 4: Write the implementation**

Create `packages/manager/src/index.ts`:

```ts
export * from "./moments.js"
export * from "./situation.js"
```

Create `packages/manager/src/moments.ts`:

```ts
/**
 * Key moments (spec §2.2): when a team's manager decides. Each is a stoppage, so the ball is dead and the state is
 * frozen while the manager thinks: the second-half kickoff (half time), the kickoff after a goal, and the first
 * restart at or after minutes 60 and 75. Moments that fall on the same stoppage are one decision with every reason, and
 * a minute moment that comes due within ABSORB_MIN of a decision is absorbed by it (no manager rethinks seconds after
 * deciding); half time and goals always call for a decision.
 */
import { isHalfTimeBreak, type DomainEvent, type MatchState } from "@touchline/sim-core"
import type { MomentReason } from "@touchline/schema"

/** Minutes after a decision in which a minute-60 or minute-75 moment is absorbed by it. */
export const ABSORB_MIN = 5

/** What the detector remembers between steps. */
export interface MomentMemory {
  /** A goal was scored and its kickoff has not been reached yet. */
  readonly goalPending: boolean
  readonly done: ReadonlyArray<MomentReason>
  /** The match minute of the last key moment, or null before the first. */
  readonly lastMinute: number | null
}

export const NO_MOMENTS: MomentMemory = { goalPending: false, done: [], lastMinute: null }

/** The match minute of a state (45 + minutes into the second half). */
export const minuteOf = (s: MatchState): number => (s.period === "first_half" ? 0 : 45) + (Math.max(0, s.periodTick) * s.config.dt) / 60

/**
 * The reasons the state just reached (after one step that emitted `events`) is a key moment; empty when it is not.
 * Pure: the same state, events and memory give the same answer.
 */
export const keyMoment = (s: MatchState, events: ReadonlyArray<DomainEvent>, memory: MomentMemory): { readonly reasons: MomentReason[]; readonly memory: MomentMemory } => {
  let goalPending = memory.goalPending || events.some((e) => e.type === "goal")
  const done = [...memory.done]
  const reasons: MomentReason[] = []
  if (s.phase.kind !== "restart") return { reasons, memory: { ...memory, goalPending } }
  if (isHalfTimeBreak(s) && !done.includes("half_time")) reasons.push("half_time")
  if (goalPending && s.phase.restart === "kickoff") {
    reasons.push("after_goal")
    goalPending = false
  }
  const minute = minuteOf(s)
  for (const [reason, at] of [["minute_60", 60], ["minute_75", 75]] as const) {
    if (done.includes(reason)) continue
    // Due now: decide, unless a decision a few minutes ago already covered it.
    if (minute >= at && (memory.lastMinute === null || minute - memory.lastMinute >= ABSORB_MIN || reasons.length > 0)) reasons.push(reason)
    else if (minute >= at) done.push(reason)
  }
  for (const r of reasons) if (r !== "after_goal") done.push(r)
  return { reasons, memory: { goalPending, done, lastMinute: reasons.length > 0 ? minute : memory.lastMinute } }
}
```

Create `packages/manager/src/situation.ts`:

```ts
/**
 * What the manager agent sees (spec §4): `situationAt` builds the Situation from the paused state and from what the
 * match produced up to that tick (its events, fed to the stats engine), from the managed team's side. Nothing else
 * reaches the model: no seed, random state, script, forced outcome or truth, nothing after the pause, and not the
 * added time the engine has already drawn (only the expected added time).
 */
import { createHash } from "node:crypto"
import { availableBench, isHalfTimeBreak, STYLE_RANGES, subsLeft, windowsLeft, type DomainEvent, type MatchConfig, type MatchState, type Side, type StepOutput, type StyleKey } from "@touchline/sim-core"
import { decodeSituation, type MomentReason, type Situation } from "@touchline/schema"
import { infoFromConfig, type StatsEngine, type StatsModels, StatsEngine as Engine, type XtGrid } from "@touchline/stats"
import { minuteOf } from "./moments.js"

/** What each style setting does, as the model reads it. */
export const STYLE_MEANINGS: Readonly<Record<StyleKey, string>> = {
  pressIntensity: "0 never press .. 1 press the ball carrier at every chance",
  lineHeight: "-1 deep defensive line .. 1 high line",
  compactness: "0 spread wide .. 1 narrow, compact block",
  tempo: "0 patient build-up .. 1 quick, forward passing",
  longBallBias: "-1 short passes only .. 1 long balls often",
  crossBias: "-1 avoid crosses .. 1 cross often",
  riskTolerance: "0 safe passes and few shots .. 1 risky passes and shots"
}

/** Minutes of play the recent view covers. */
export const RECENT_MIN = 10

/** The match as it has been played so far: its events and the stats engine fed with every step. */
export class MatchWatch {
  readonly events: DomainEvent[] = []
  readonly engine: StatsEngine

  constructor(cfg: MatchConfig, models: StatsModels, xt: XtGrid | null) {
    this.engine = new Engine(infoFromConfig(cfg), models, xt)
  }

  /** One step's output: its events, then its frame (the order the live stats stream uses). */
  add(r: StepOutput): void {
    for (const event of r.events) {
      this.events.push(event)
      this.engine.ingest({ kind: "event", event })
    }
    if (r.frame) this.engine.ingest({ kind: "frame", frame: r.frame })
  }
}

const round = (x: number, digits: number) => Math.round(x * 10 ** digits) / 10 ** digits
const other = (side: Side): Side => (side === "home" ? "away" : "home")

const scoreState = (diff: number) => (diff === 0 ? "level" : diff > 0 ? `winning by ${diff}` : `losing by ${-diff}`)

/** The pre-match name of a player (league squads carry names; test teams do not). */
const nameOf = (cfg: MatchConfig, id: string): string => {
  const all = [...cfg.home.starters, ...(cfg.home.bench ?? []), ...cfg.away.starters, ...(cfg.away.bench ?? [])] as ReadonlyArray<{ readonly id: string; readonly name?: string }>
  return all.find((p) => p.id === id)?.name ?? id
}

/** The managed team's view of the match at the pause, for a decision made for `reasons`. */
export const situationAt = (s: MatchState, side: Side, reasons: ReadonlyArray<MomentReason>, watch: MatchWatch): Situation => {
  const cfg = s.config
  const team = cfg[side]
  const opp = cfg[other(side)]
  const eng = watch.engine
  const events = watch.events.filter((e) => e.frame_id <= s.tick)
  const ofTeam = (id: string) => events.filter((e) => e.team_id === id)
  const value = (metric: string, subject: string, windowS: number | null = null) => eng.value(metric as never, subject, { windowS })
  const count = (es: ReadonlyArray<DomainEvent>, type: string, pred: (e: DomainEvent) => boolean = () => true) => es.filter((e) => e.type === type && pred(e)).length
  const regains = (es: ReadonlyArray<DomainEvent>) =>
    count(es, "tackle", (e) => e.attrs.outcome === "won") + count(es, "interception") + count(es, "ball_recovery")

  // Possession as a share of the time either team had the ball (the engine also counts contested time), so the two add to 100.
  const poss = (id: string) => value("team.poss", id) ?? 0
  const possTotal = poss(team.id) + poss(opp.id)
  const teamView = (t: MatchConfig["home"]) => {
    const es = ofTeam(t.id)
    const pct = (x: number | null) => (x === null ? null : round(x * 100, 1))
    return {
      name: t.name,
      archetype: t.style.archetype,
      formation: t.formation,
      style: (Object.keys(STYLE_RANGES) as StyleKey[]).map((k) => ({
        setting: k,
        value: round(t.style[k], 2),
        min: STYLE_RANGES[k][0],
        max: STYLE_RANGES[k][1],
        meaning: STYLE_MEANINGS[k]
      })),
      stats: {
        xg: round(value("shot.xg", t.id) ?? 0, 2),
        shots: count(es, "shot"),
        possession_pct: possTotal > 0 ? round((100 * poss(t.id)) / possTotal, 1) : 50,
        pass_completion_pct: pct(value("pass.acc", t.id)),
        ppda: (() => {
          const v = value("ppda", t.id)
          return v === null || !Number.isFinite(v) ? null : round(v, 1)
        })(),
        yellow_cards: count(es, "card", (e) => e.attrs.colour === "yellow"),
        red_cards: count(es, "card", (e) => e.attrs.colour === "red")
      }
    }
  }

  const minute = minuteOf(s)
  const addedMin = (cfg.params.timing.addedTimeMinS[0] + cfg.params.timing.addedTimeMinS[1]) / 2 / 60
  const inPeriod = minute - (s.period === "first_half" ? 0 : 45)
  const minutesLeft = Math.max(0, 45 + addedMin - inPeriod) + (s.period === "first_half" ? 45 + addedMin : 0)
  // Minutes on the match clock: a starter has played `minute`, a substitute the minutes since coming on.
  const secondHalfStart = s.period === "second_half" ? s.tick - s.periodTick : Infinity
  const clockAt = (tick: number) => (tick >= secondHalfStart ? 45 + ((tick - secondHalfStart) * cfg.dt) / 60 : (tick * cfg.dt) / 60)
  const entered = new Map(events.filter((e) => e.type === "substitution").map((e) => [e.attrs.player_on as string, clockAt(e.frame_id)]))
  const mine = s.players.filter((p) => p.side === side && !p.sentOff)
  const recentFrom = s.tick - Math.round((RECENT_MIN * 60) / cfg.dt)
  const recent = (id: string) => {
    const es = ofTeam(id).filter((e) => e.frame_id > recentFrom)
    return { xg: round(value("shot.xg", id, RECENT_MIN * 60) ?? 0, 2), shots: count(es, "shot"), ball_regains: regains(es) }
  }
  const benchLeft = new Set(availableBench(s, side).map((b) => b.id))
  const by = (id: string) => events.filter((e) => e.player_id === id)

  return {
    match_id: cfg.matchId,
    team_id: team.id,
    moment: {
      reasons: [...reasons],
      minute: round(minute, 1),
      minutes_left: round(minutesLeft, 1),
      added_time_expected_min: round(addedMin, 1),
      score: { for: s.score[side], against: s.score[other(side)] },
      score_state: scoreState(s.score[side] - s.score[other(side)])
    },
    team: teamView(team),
    opponent: teamView(opp),
    players: {
      on_pitch: mine.map((p) => ({
        id: p.id,
        name: nameOf(cfg, p.id),
        number: p.jersey,
        role: p.role,
        energy_pct: Math.round(p.energy * 100),
        minutes_played: round(minute - (entered.get(p.id) ?? 0), 1),
        yellow_card: p.yellow > 0,
        shots: count(by(p.id), "shot"),
        xg: round(value("shot.xg", p.id) ?? 0, 2),
        passes_completed: count(by(p.id), "pass", (e) => e.outcome === "successful"),
        tackles_won: count(by(p.id), "tackle", (e) => e.attrs.outcome === "won")
      })),
      bench: (team.bench ?? []).map((b) => ({ id: b.id, name: nameOf(cfg, b.id), number: b.jersey, role: b.role, available: benchLeft.has(b.id) }))
    },
    limits: { subs_left: subsLeft(s, side), windows_left: windowsLeft(s, side), half_time_break: isHalfTimeBreak(s) },
    recent: { window_min: RECENT_MIN, team: recent(team.id), opponent: recent(opp.id) }
  }
}

/** The exact JSON sent to the model (and hashed into the decision log). */
export const situationJson = (sit: Situation): string => JSON.stringify(decodeSituation(sit))

/** sha256 of the exact payload: the decision log records it, so what was sent can be checked against what was logged. */
export const situationHash = (sit: Situation): string => createHash("sha256").update(situationJson(sit)).digest("hex")

/** A rough token count of the payload (characters / 4). */
export const payloadTokens = (sit: Situation): number => Math.ceil(situationJson(sit).length / 4)

/** The most tokens a Situation may take. */
export const MAX_SITUATION_TOKENS = 2500
```

- [ ] **Step 5: Write the reviewed example, and review it**

Run: `UPDATE_GOLDEN=1 pnpm --filter @touchline/manager test situation`
Expected: `Tests  8 passed (8)` and `packages/manager/test/golden/situation-m-11-minute_60.json` written.

Read the file as the model will: minute 60, `minutes_left` 33 (45 + 3 expected added minutes, never the drawn time), every starter's `minutes_played` equal to the minute, the two `possession_pct` values summing to 100, eleven players with synthetic names and energy below 100, nine bench players, five substitutions and three windows left, and no seed, script or random state anywhere. Commit it only if it reads right.

- [ ] **Step 6: Run the tests**

Run: `pnpm --filter @touchline/manager test`
Expected: `Tests  14 passed (14)`

Run: `pnpm turbo run typecheck --force`
Expected: `Tasks:    13 successful, 13 total`

- [ ] **Step 7: Commit**

```bash
git add packages/manager pnpm-lock.yaml
git commit -m "feat(manager): key moments (half time, after a goal, minutes 60 and 75) and the Situation the manager agent sees — built from the paused state and the match so far only, schema-checked, hashed, within its token budget, with a reviewed example

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Managed matches, the rule-based manager and replay

`managedSteps` plays a match: at each key moment every managed team's manager decides from the same paused state (Ruling 4), then the orders apply and play goes on. A manager is an interface (`decide(input) → Effect<Decision>`, never failing). The rule-based manager is the A/B baseline: chase when losing, protect a lead from minute 60, fresh legs otherwise; no substitutions before half time, attackers only for midfielders and forwards (Ruling 5). Every decision is a `Decision` log line; `replayManager` answers each moment with the logged decision after checking the situation hash, so a replay is bit-identical and refuses a log that does not fit.

**Files:**
- Create: `packages/manager/src/decision.ts`, `packages/manager/src/rules.ts`, `packages/manager/src/run.ts`, `packages/manager/src/replay.ts`
- Modify: `packages/manager/src/index.ts`
- Test: `packages/manager/test/run.test.ts`

**Interfaces:**
- Produces:
  - `interface DecideInput { state; side; reasons; situation; situationHash }`; `interface Manager { kind: "rules" | "agent" | "replay"; decide(input): Effect<Decision> }`
  - `type DecisionOption = Decision["options"][number]`; `NO_CHANGE: DecisionOption`; `checkedOption(input, index, option, source)`; `decisionBase(input)`
  - `rulesOption(sit): { label; orders; rationale } | null`; `rulesManager: Manager`; `TIRED_PCT = 60`, `CHASE_TIRED_PCT = 75`, `SUBS_PER_DECISION = 2`
  - `type Managers = Partial<Record<Side, Manager>>`; `managedConfig(cfg, managers)`; `managedSteps(cfg, managers, { models, xt, onDecision? }): Stream<StepResult>`; `runManaged(cfg, managers, { models, xt }): Effect<{ events; decisions; state }>`
  - `replayManager(decisions): Manager`; `class ReplayMismatch extends Error`
- Consumes: Task 1 (`applyOrders`, `checkOrders`), Task 3 (`keyMoment`, `MatchWatch`, `situationAt`, `situationHash`).

- [ ] **Step 1: Write the failing tests**

Create `packages/manager/test/run.test.ts`:

```ts
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { Effect } from "effect"
import { initMatch, isFinished, step, type DomainEvent } from "@touchline/sim-core"
import { decodeDecision, type Situation } from "@touchline/schema"
import { describe, expect, it } from "vitest"
import type { DecideInput, Manager } from "../src/decision.js"
import { replayManager, ReplayMismatch } from "../src/replay.js"
import { rulesManager, rulesOption } from "../src/rules.js"
import { runManaged } from "../src/run.js"
import { leagueConfig, models, xt } from "./helpers.js"

const golden = JSON.parse(readFileSync(join(import.meta.dirname, "golden/situation-m-11-minute_60.json"), "utf8")) as Situation
/** The reviewed situation with some fields changed. */
const sit = (over: { score?: [number, number]; minute?: number; energy?: number; windows?: number; halfTime?: boolean }): Situation => ({
  ...golden,
  moment: { ...golden.moment, minute: over.minute ?? golden.moment.minute, score: over.score ? { for: over.score[0], against: over.score[1] } : golden.moment.score },
  players: { ...golden.players, on_pitch: golden.players.on_pitch.map((p) => (over.energy === undefined ? p : { ...p, energy_pct: p.role === "GK" ? 95 : over.energy })) },
  limits: { ...golden.limits, windows_left: over.windows ?? golden.limits.windows_left, half_time_break: over.halfTime ?? false }
})
const style = (s: Situation, k: string) => s.team.style.find((x) => x.setting === k)!.value

describe("the rule-based manager", () => {
  it("chases a game it is losing: more press, quicker play, fresh attackers for its most tired players", () => {
    const s = sit({ score: [0, 1], energy: 70 })
    const opt = rulesOption(s)!
    expect(opt.label).toBe("Chase the game")
    expect(opt.orders.filter((o) => o.kind === "style")).toEqual([
      { kind: "style", setting: "pressIntensity", value: Math.min(1, style(s, "pressIntensity") + 0.2) },
      { kind: "style", setting: "tempo", value: Math.min(1, style(s, "tempo") + 0.2) }
    ])
    const subs = opt.orders.filter((o) => o.kind === "sub") as Array<{ off: string; on: string }>
    expect(subs).toHaveLength(2)
    for (const o of subs) {
      expect(["ST", "W", "AM"]).toContain(s.players.bench.find((b) => b.id === o.on)!.role)
      // The substitute plays the outgoing player's role: never an attacker at the back.
      expect(["GK", "CB", "FB"]).not.toContain(s.players.on_pitch.find((p) => p.id === o.off)!.role)
    }
  })
  it("protects a lead late on: a deeper line, a tighter block, tired players replaced role for role", () => {
    const s = sit({ score: [2, 0], minute: 70, energy: 55 })
    const opt = rulesOption(s)!
    expect(opt.label).toBe("Protect the lead")
    expect(opt.orders.slice(0, 2)).toEqual([
      { kind: "style", setting: "lineHeight", value: Math.round((style(s, "lineHeight") - 0.3) * 100) / 100 },
      { kind: "style", setting: "compactness", value: Math.min(1, Math.round((style(s, "compactness") + 0.2) * 100) / 100) }
    ])
    for (const o of opt.orders.filter((x) => x.kind === "sub") as Array<{ off: string; on: string }>) {
      const off = s.players.on_pitch.find((p) => p.id === o.off)!, on = s.players.bench.find((b) => b.id === o.on)!
      expect(on.role === off.role || ["CB", "FB"].includes(on.role) === ["CB", "FB"].includes(off.role)).toBe(true)
    }
  })
  it("otherwise only replaces players below 60 % energy, and changes nothing when nobody is tired", () => {
    expect(rulesOption(sit({ score: [1, 1], energy: 80 }))).toBeNull()
    expect(rulesOption(sit({ score: [1, 1], energy: 50 }))!.orders.every((o) => o.kind === "sub")).toBe(true)
  })
  it("makes no substitutions before half time", () => {
    expect(rulesOption(sit({ score: [1, 1], energy: 50, minute: 30 }))).toBeNull()
    expect(rulesOption(sit({ score: [0, 1], energy: 50, minute: 30 }))!.orders.every((o) => o.kind === "style")).toBe(true)
  })
  it("makes no substitutions without a window left, except at half time", () => {
    expect(rulesOption(sit({ score: [1, 1], energy: 50, windows: 0 }))).toBeNull()
    expect(rulesOption(sit({ score: [1, 1], energy: 50, windows: 0, halfTime: true }))).not.toBeNull()
  })
})

const cfg = leagueConfig(11)
const seen: DecideInput[] = []
/** The rules manager, keeping every input it was given. */
const spy: Manager = { kind: "rules", decide: (input) => (seen.push(input), rulesManager.decide(input)) }
const managed = Effect.runSync(runManaged(cfg, { home: spy, away: rulesManager }, { models, xt }))

describe("a managed match", () => {
  it("logs a decision for each team at each key moment, each a valid decision line", () => {
    expect(managed.decisions.length).toBeGreaterThanOrEqual(6)
    for (const side of ["home", "away"] as const) {
      const reasons = managed.decisions.filter((d) => d.side === side).flatMap((d) => d.reasons)
      for (const r of ["half_time", "minute_60", "minute_75"]) expect(reasons).toContain(r)
    }
    for (const d of managed.decisions) expect(decodeDecision(d)).toEqual(d)
  })
  it("makes exactly the substitutions its managers ordered, within the laws' limits", () => {
    const subs = managed.events.filter((e) => e.type === "substitution")
    expect(subs.every((e) => e.attrs.reason === "manager")).toBe(true)
    const ordered = managed.decisions.flatMap((d) => d.orders_applied.filter((o) => o.kind === "sub"))
    expect(subs.map((e) => [e.player_id, e.attrs.player_on])).toEqual(ordered.map((o) => [(o as { off: string }).off, (o as { on: string }).on]))
    for (const team of [cfg.home.id, cfg.away.id]) expect(subs.filter((e) => e.team_id === team).length).toBeLessThanOrEqual(5)
  })
  it("shows a substitute's minutes since coming on, and later decisions see the changes already made", () => {
    const sub = managed.decisions.find((d) => d.side === "home" && d.orders_applied.some((o) => o.kind === "sub"))!
    const on = (sub.orders_applied.find((o) => o.kind === "sub") as { on: string }).on
    const later = seen.find((i) => i.state.tick > sub.tick)!
    const p = later.situation.players.on_pitch.find((x) => x.id === on)!
    expect(p.minutes_played).toBeCloseTo(later.situation.moment.minute - sub.minute, 0)
    expect(later.situation.players.bench.find((b) => b.id === on)!.available).toBe(false)
    expect(later.situation.limits.subs_left).toBe(5 - managed.decisions.filter((d) => d.side === "home" && d.tick <= sub.tick).flatMap((d) => d.orders_applied).filter((o) => o.kind === "sub").length)
  })
  it("replays bit-identically from its decision log, without any manager", () => {
    const replay = Effect.runSync(runManaged(cfg, { home: replayManager(managed.decisions), away: replayManager(managed.decisions) }, { models, xt }))
    expect(replay.events).toEqual(managed.events)
    expect(replay.decisions).toEqual(managed.decisions)
  })
  it("refuses to replay a log that does not fit the match", () => {
    const other = Effect.runSync(runManaged(leagueConfig(12), { home: rulesManager, away: rulesManager }, { models, xt }))
    expect(() => Effect.runSync(runManaged(cfg, { home: replayManager(other.decisions), away: replayManager(other.decisions) }, { models, xt }))).toThrow(ReplayMismatch)
  })
  it("with no manager is exactly the plain match", () => {
    const none = Effect.runSync(runManaged(cfg, {}, { models, xt }))
    let s = initMatch({ ...cfg, managed: undefined })
    const events: DomainEvent[] = []
    while (!isFinished(s)) {
      const r = step(s)
      s = r.state
      events.push(...r.events)
    }
    expect(none.events).toEqual(events)
    expect(none.decisions).toEqual([])
  })
})
```

- [ ] **Step 2: Run them to make sure they fail**

Run: `pnpm --filter @touchline/manager test run.test`
Expected: FAIL: `../src/replay.js`, `../src/rules.js`, `../src/run.js` do not exist

- [ ] **Step 3: Write the implementation**

Create `packages/manager/src/decision.ts`:

```ts
/**
 * What every manager shares: the input to a decision, the decision log line it returns, and the engine's check of a
 * proposed option against the live state (invalid orders are dropped with the reason, never applied).
 */
import { checkOrders, type MatchState, type Side } from "@touchline/sim-core"
import type { Decision, ManagerOrder, MomentReason, Situation } from "@touchline/schema"
import type { Effect } from "effect"
import { minuteOf } from "./moments.js"

/** Everything a manager is given at a key moment. */
export interface DecideInput {
  readonly state: MatchState
  readonly side: Side
  readonly reasons: ReadonlyArray<MomentReason>
  readonly situation: Situation
  /** sha256 of the exact Situation JSON (situationHash). */
  readonly situationHash: string
}

/** A team's manager: decides at each key moment and never fails (a failure is a logged fallback). */
export interface Manager {
  readonly kind: "rules" | "agent" | "replay"
  readonly decide: (input: DecideInput) => Effect.Effect<Decision>
}

export type DecisionOption = Decision["options"][number]

export const NO_CHANGE: DecisionOption = {
  index: 0, label: "No change", source: "no_change", orders: [], rationale: null,
  xg_diff_vs_no_change: { mean: 0, se: 0 }, goal_diff_vs_no_change: { mean: 0, se: 0 }, untested: false, dropped: []
}

/** An option as the engine will apply it: the orders the live state accepts, and the ones it drops (with why). */
export const checkedOption = (
  input: DecideInput,
  index: number,
  option: { readonly label: string; readonly orders: ReadonlyArray<ManagerOrder>; readonly rationale: string | null },
  source: "agent" | "rules"
): DecisionOption => {
  const { valid, dropped } = checkOrders(input.state, input.side, option.orders)
  return {
    index, label: option.label, source, orders: valid, rationale: option.rationale,
    xg_diff_vs_no_change: null, goal_diff_vs_no_change: null, untested: false, dropped: dropped.map((d) => ({ order: d.order, reason: d.reason }))
  }
}

/** The fields of a decision line that come from the moment itself. */
export const decisionBase = (input: DecideInput) => ({
  match_id: input.state.config.matchId,
  tick: input.state.tick,
  minute: Math.round(minuteOf(input.state) * 10) / 10,
  side: input.side,
  team_id: input.state.config[input.side].id,
  reasons: [...input.reasons],
  situation_hash: input.situationHash
})
```

Create `packages/manager/src/replay.ts`:

```ts
/**
 * Replaying a managed match from its decision log (spec §2.4): the logged orders are applied at their ticks, so the
 * match is bit-identical to the original and makes no model calls. Every replayed moment must see exactly the
 * situation the original decision saw (same hash); anything else means the engine or the log changed.
 */
import { Effect } from "effect"
import type { Decision } from "@touchline/schema"
import type { DecideInput, Manager } from "./decision.js"

/** The decision log does not fit the match being replayed. */
export class ReplayMismatch extends Error {}

/** A manager that answers each key moment with the logged decision for that tick and team. */
export const replayManager = (decisions: ReadonlyArray<Decision>): Manager => ({
  kind: "replay",
  decide: (input: DecideInput) =>
    Effect.sync(() => {
      const d = decisions.find((x) => x.tick === input.state.tick && x.side === input.side)
      if (!d) throw new ReplayMismatch(`no logged decision for ${input.side} at tick ${input.state.tick}`)
      if (d.situation_hash !== input.situationHash) throw new ReplayMismatch(`the situation at tick ${d.tick} (${d.side}) differs from the logged one`)
      return d
    })
})
```

Create `packages/manager/src/rules.ts`:

```ts
/**
 * The rule-based manager (spec §2.3): the A/B baseline a sensible human would write. It reads the same Situation as
 * the agent and decides without re-simulation:
 *   losing                → press more and play quicker; fresh attackers for the most tired midfielders and forwards;
 *   winning from minute 60 → drop the line and tighten the block; tired players replaced role for role;
 *   otherwise             → players below 60 % energy replaced role for role.
 * No substitutions before half time. A substitute takes the slot and role of the player going off (the formation is
 * fixed), so an attacker only ever replaces a midfielder or a forward.
 */
import { Effect } from "effect"
import type { ManagerOrder, Situation, StyleKey } from "@touchline/schema"
import { checkedOption, decisionBase, NO_CHANGE, type DecideInput, type Manager } from "./decision.js"

/** Energy (%) below which a player is replaced. */
export const TIRED_PCT = 60
/** When chasing, energy (%) below which a player makes way for an attacker. */
export const CHASE_TIRED_PCT = 75
/** Substitutions per decision. */
export const SUBS_PER_DECISION = 2

const LINE: Readonly<Record<string, string>> = { GK: "gk", CB: "def", FB: "def", DM: "mid", CM: "mid", AM: "mid", W: "att", ST: "att" }
const ATTACKERS = ["ST", "W", "AM"]
const OUTFIELD = ["CB", "FB", "DM", "CM", "AM", "W", "ST"]
const MIDFIELD_AND_ATTACK = ["DM", "CM", "AM", "W", "ST"]

const styleValue = (sit: Situation, k: StyleKey) => sit.team.style.find((s) => s.setting === k)!.value
const clamp = (sit: Situation, k: StyleKey, v: number) => {
  const s = sit.team.style.find((x) => x.setting === k)!
  return Math.round(Math.min(s.max, Math.max(s.min, v)) * 100) / 100
}
const nudge = (sit: Situation, k: StyleKey, by: number): ManagerOrder[] => {
  const v = clamp(sit, k, styleValue(sit, k) + by)
  return v === styleValue(sit, k) ? [] : [{ kind: "style", setting: k, value: v }]
}

/** Up to SUBS_PER_DECISION substitutions: the most tired of `roles` under `below` %, each for a bench player `pick` chooses. */
const subs = (sit: Situation, below: number, roles: ReadonlyArray<string>, pick: (role: string, bench: Situation["players"]["bench"]) => Situation["players"]["bench"][number] | undefined): ManagerOrder[] => {
  const canSub = sit.limits.subs_left > 0 && (sit.limits.half_time_break || (sit.moment.minute >= 45 && sit.limits.windows_left > 0))
  if (!canSub) return []
  let bench = sit.players.bench.filter((b) => b.available && b.role !== "GK")
  const out: ManagerOrder[] = []
  const tired = sit.players.on_pitch.filter((p) => roles.includes(p.role) && p.energy_pct < below).sort((a, b) => a.energy_pct - b.energy_pct || a.id.localeCompare(b.id))
  for (const p of tired) {
    if (out.length >= Math.min(SUBS_PER_DECISION, sit.limits.subs_left)) break
    const on = pick(p.role, bench)
    if (!on) continue
    bench = bench.filter((b) => b.id !== on.id)
    out.push({ kind: "sub", off: p.id, on: on.id })
  }
  return out
}

const roleForRole = (role: string, bench: Situation["players"]["bench"]) => bench.find((b) => b.role === role) ?? bench.find((b) => LINE[b.role] === LINE[role])
const attacker = (_role: string, bench: Situation["players"]["bench"]) => ATTACKERS.map((r) => bench.find((b) => b.role === r)).find((b) => b !== undefined)

/** The rules' option for this situation, or null when they would change nothing. */
export const rulesOption = (sit: Situation): { readonly label: string; readonly orders: ManagerOrder[]; readonly rationale: string } | null => {
  const diff = sit.moment.score.for - sit.moment.score.against
  if (diff < 0) {
    const orders = [...nudge(sit, "pressIntensity", 0.2), ...nudge(sit, "tempo", 0.2), ...subs(sit, CHASE_TIRED_PCT, MIDFIELD_AND_ATTACK, attacker)]
    return orders.length === 0 ? null : { label: "Chase the game", orders, rationale: "Behind: press higher, play quicker, fresh attackers for tired legs." }
  }
  if (diff > 0 && sit.moment.minute >= 60) {
    const orders = [...nudge(sit, "lineHeight", -0.3), ...nudge(sit, "compactness", 0.2), ...subs(sit, TIRED_PCT, OUTFIELD, roleForRole)]
    return orders.length === 0 ? null : { label: "Protect the lead", orders, rationale: "Ahead late on: deeper line, tighter block, tired players replaced." }
  }
  const orders = subs(sit, TIRED_PCT, OUTFIELD, roleForRole)
  return orders.length === 0 ? null : { label: "Fresh legs", orders, rationale: "Tired players replaced role for role." }
}

/** The rule-based manager: one option or none, applied without testing. */
export const rulesManager: Manager = {
  kind: "rules",
  decide: (input: DecideInput) =>
    Effect.sync(() => {
      const opt = rulesOption(input.situation)
      const options = opt ? [NO_CHANGE, checkedOption(input, 1, opt, "rules")] : [NO_CHANGE]
      const pick = options.length > 1 && options[1]!.orders.length > 0 ? 1 : 0
      return {
        ...decisionBase(input),
        manager: "rules" as const,
        options,
        pick,
        reason: pick === 0 ? "No rule applies." : options[1]!.rationale!,
        orders_applied: options[pick]!.orders,
        fallback: null,
        timings_ms: { propose: 0, whatif: 0, choose: 0 },
        tokens: { in: 0, out: 0 },
        cost_usd: 0,
        model: "rules"
      }
    })
}
```

Create `packages/manager/src/run.ts`:

```ts
/**
 * A managed match (spec §2.3): the engine steps the match; at each key moment every managed team's manager decides
 * from the same paused state, then their orders are applied and play goes on. Play does not advance while a decision
 * is pending. Every decision is reported (onDecision) as its decisions.jsonl line.
 */
import { Effect, Stream } from "effect"
import { applyOrders, initMatch, isFinished, step, type DomainEvent, type MatchConfig, type MatchState, type Side, type StepResult } from "@touchline/sim-core"
import type { Decision } from "@touchline/schema"
import type { StatsModels, XtGrid } from "@touchline/stats"
import type { Manager } from "./decision.js"
import { keyMoment, NO_MOMENTS, type MomentMemory } from "./moments.js"
import { MatchWatch, situationAt, situationHash } from "./situation.js"

export type Managers = Partial<Record<Side, Manager>>

export interface ManagedOptions {
  readonly models: StatsModels
  readonly xt: XtGrid | null
  readonly onDecision?: (d: Decision) => void
}

const SIDES = ["home", "away"] as const

/** The config with `managed` set to the teams that have a manager (no automatic substitutions for them). */
export const managedConfig = (cfg: MatchConfig, managers: Managers): MatchConfig => ({ ...cfg, managed: SIDES.filter((s) => managers[s] !== undefined) })

/** Every step of a managed match, decisions included, as a stream (the final full-time step is included). */
export const managedSteps = (config: MatchConfig, managers: Managers, opts: ManagedOptions): Stream.Stream<StepResult> => {
  const cfg = managedConfig(config, managers)
  const sides = SIDES.filter((s) => managers[s] !== undefined)
  return Stream.suspend(() => {
    const watch = new MatchWatch(cfg, opts.models, opts.xt)
    return Stream.unfold({ state: initMatch(cfg), memory: NO_MOMENTS as MomentMemory }, ({ state, memory }) =>
      Effect.gen(function* () {
        if (isFinished(state)) return undefined
        const r = step(state)
        watch.add(r)
        const k = keyMoment(r.state, r.events, memory)
        let next: MatchState = r.state
        if (k.reasons.length > 0 && sides.length > 0) {
          // Both managers decide from the same paused state; their orders apply afterwards.
          const decisions = yield* Effect.forEach(sides, (side) => {
            const situation = situationAt(r.state, side, k.reasons, watch)
            return managers[side]!.decide({ state: r.state, side, reasons: k.reasons, situation, situationHash: situationHash(situation) })
          })
          for (const d of decisions) {
            next = applyOrders(next, d.side, d.orders_applied)
            opts.onDecision?.(d)
          }
        }
        return [r, { state: next, memory: k.memory }] as const
      })
    )
  })
}

export interface ManagedRun {
  readonly events: ReadonlyArray<DomainEvent>
  readonly decisions: ReadonlyArray<Decision>
  readonly state: MatchState
}

/** Play a managed match to full time, keeping its events and decisions (not its frames). */
export const runManaged = (cfg: MatchConfig, managers: Managers, opts: Omit<ManagedOptions, "onDecision">): Effect.Effect<ManagedRun> =>
  Effect.gen(function* () {
    const decisions: Decision[] = []
    const events: DomainEvent[] = []
    let state = initMatch(managedConfig(cfg, managers))
    yield* Stream.runForEach(managedSteps(cfg, managers, { ...opts, onDecision: (d) => decisions.push(d) }), (r) =>
      Effect.sync(() => {
        events.push(...r.events)
        state = r.state
      })
    )
    return { events, decisions, state }
  })
```

Apply this change to `packages/manager/src/index.ts` (from the repository root):

```bash
git apply <<'PATCH'
diff --git a/packages/manager/src/index.ts b/packages/manager/src/index.ts
index 9e20f54..4022088 100644
--- a/packages/manager/src/index.ts
+++ b/packages/manager/src/index.ts
@@ -1,2 +1,6 @@
+export * from "./decision.js"
 export * from "./moments.js"
+export * from "./replay.js"
+export * from "./rules.js"
+export * from "./run.js"
 export * from "./situation.js"
PATCH
```

- [ ] **Step 4: Run the tests**

Run: `pnpm --filter @touchline/manager test`
Expected: `Tests  25 passed (25)`

Run: `pnpm turbo run typecheck --force`
Expected: `Tasks:    13 successful, 13 total`

- [ ] **Step 5: Commit**

```bash
git add packages/manager
git commit -m "feat(manager): managed matches — both managers decide from the same paused state at each key moment, orders applied after; the rule-based manager (chase, protect, fresh legs; no first-half subs; attackers only for midfielders and forwards); decision log lines; exact replay from the log with a situation-hash check

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Testing options by re-simulation

The agent's options are tested before it chooses: from the paused state, each option and "no change" play the next 10 minutes on the same 20 forks, one worker thread per arm, and each option's value is its paired difference from "no change" in the team's xG difference (goal difference alongside). An arm whose worker fails or runs late is `untested` (all options, if "no change" itself failed). `whatIfSummary` is what the agent is shown: numbers rounded to three decimals and one sentence saying what they mean. About 6 s per decision on the developer machine.

**Files:**
- Create: `packages/manager/src/whatif.ts`, `packages/manager/src/whatif-worker.ts`
- Modify: `packages/manager/src/index.ts`
- Test: `packages/manager/test/whatif.test.ts`

**Interfaces:**
- Produces: `WHATIF_SEEDS = 20`, `WHATIF_HORIZON_S = 600`, `WHATIF_TIMEOUT_MS = 60_000`; `interface ArmJob { state; side; orders; seeds; horizonS }`; `armOutcomes(job): { xg; goals }[]`; `interface TestOptions { seeds?; horizonS?; timeoutMs?; runner?: "worker" | "inline" }`; `testOptions(state, side, options, opts?): Effect<DecisionOption[]>`; `whatIfSummary(options, opts?): WhatIfSummary`
- Consumes: Task 1 (`applyOrders`, the engine's `forkState`, `playAhead`, `outcomeOf`), Task 4 (`DecisionOption`, `NO_CHANGE`).

- [ ] **Step 1: Write the failing tests**

Create `packages/manager/test/whatif.test.ts`:

```ts
import { Effect, Schema } from "effect"
import { WhatIfSummary } from "@touchline/schema"
import { describe, expect, it } from "vitest"
import { NO_CHANGE, type DecisionOption } from "../src/decision.js"
import { testOptions, whatIfSummary } from "../src/whatif.js"
import { leagueConfig, playMoments } from "./helpers.js"

const m = playMoments(leagueConfig(11), (x) => x.reasons.includes("minute_60")).moments.at(-1)!
const st = m.state.players.find((p) => p.side === "home" && p.role === "ST")!
const option = (index: number, label: string, orders: DecisionOption["orders"]): DecisionOption => ({ ...NO_CHANGE, index, label, source: "agent", orders, rationale: "r", xg_diff_vs_no_change: null, goal_diff_vs_no_change: null })
const options = [
  NO_CHANGE,
  option(1, "Press", [{ kind: "style", setting: "pressIntensity", value: 1 }, { kind: "style", setting: "tempo", value: 1 }]),
  option(2, "Fresh striker", [{ kind: "sub", off: st.id, on: m.state.config.home.bench!.find((b) => b.role === "ST")!.id }]),
  option(3, "Nothing after all", [])
]
const small = { seeds: 3, horizonS: 60 }

describe("testing a manager's options", () => {
  const inline = Effect.runSync(testOptions(m.state, "home", options, { ...small, runner: "inline" }))
  it("pairs every option with no change on the same forks: an option that changes nothing differs by exactly 0", () => {
    expect(inline[0]).toEqual(NO_CHANGE)
    expect(inline[3]!.xg_diff_vs_no_change).toEqual({ mean: 0, se: 0 })
    expect(inline[3]!.goal_diff_vs_no_change).toEqual({ mean: 0, se: 0 })
    expect(inline[1]!.untested).toBe(false)
    expect(Number.isFinite(inline[1]!.xg_diff_vs_no_change!.mean)).toBe(true)
  })
  it("gives the same numbers in worker threads as inline", async () => {
    expect(await Effect.runPromise(testOptions(m.state, "home", options, small))).toEqual(inline)
  })
  it("marks an option untested when its worker does not answer in time, and every option when no change could not be played", async () => {
    const timedOut = await Effect.runPromise(testOptions(m.state, "home", options, { ...small, timeoutMs: 1 }))
    expect(timedOut.slice(1).every((o) => o.untested && o.xg_diff_vs_no_change === null)).toBe(true)
  })
  it("summarises the results for the agent, rounded to 3 decimals, with what the numbers mean", () => {
    const s = whatIfSummary(inline, small)
    expect(Schema.decodeUnknownSync(WhatIfSummary)(s)).toEqual(s)
    expect(s.options.map((o) => o.index)).toEqual([0, 1, 2, 3])
    for (const o of s.options) for (const v of [o.xg_diff_vs_no_change!.mean, o.xg_diff_vs_no_change!.se]) expect(Math.round(v * 1000) / 1000).toBe(v)
    expect(s.explanation).toContain("3 times over the next 1 minutes")
  })
})
```

- [ ] **Step 2: Run them to make sure they fail**

Run: `pnpm --filter @touchline/manager test whatif`
Expected: FAIL: `../src/whatif.js` does not exist

- [ ] **Step 3: Write the implementation**

Create `packages/manager/src/whatif-worker.ts`:

```ts
/** Plays one arm of a manager's option test off the main thread (whatif.ts). */
import { parentPort, workerData } from "node:worker_threads"
import { armOutcomes, type ArmJob } from "./whatif.js"

try {
  parentPort!.postMessage({ ok: armOutcomes(workerData as ArmJob) })
} catch (e) {
  parentPort!.postMessage({ error: e instanceof Error ? e.message : String(e) })
}
```

Create `packages/manager/src/whatif.ts`:

```ts
/**
 * Testing a manager's options by re-simulation (spec §2.3): from the paused state, each option and "no change" play the
 * next HORIZON on the same SEEDS forks (each in its own worker thread), and an option's value is its paired difference
 * from "no change" in the team's xG difference (goal difference alongside). An option whose worker fails or runs out
 * of time is marked untested; so is every option when "no change" itself could not be played.
 */
import { availableParallelism } from "node:os"
import { Worker } from "node:worker_threads"
import { Effect } from "effect"
import { applyOrders, forkState, outcomeOf, playAhead, type MatchState, type Side } from "@touchline/sim-core"
import type { ManagerOrder, WhatIfSummary } from "@touchline/schema"
import type { DecisionOption } from "./decision.js"

export const WHATIF_SEEDS = 20
export const WHATIF_HORIZON_S = 600
/** A worker that has not answered by then marks its option untested. */
export const WHATIF_TIMEOUT_MS = 60_000

export interface ArmJob {
  readonly state: MatchState
  readonly side: Side
  readonly orders: ReadonlyArray<ManagerOrder>
  readonly seeds: number
  readonly horizonS: number
}

/** One arm's outcome on each fork: the team's xG difference and goal difference over the horizon. CPU only. */
export const armOutcomes = (job: ArmJob): Array<{ readonly xg: number; readonly goals: number }> => {
  const ticks = Math.round(job.horizonS / job.state.config.dt)
  return Array.from({ length: job.seeds }, (_, k) => {
    const fork = forkState(job.state, k)
    const r = playAhead(job.orders.length > 0 ? applyOrders(fork, job.side, job.orders) : fork, ticks)
    const o = outcomeOf(r.events, r.state, job.side)
    return { xg: o.xg_diff, goals: o.goal_diff }
  })
}

const runArm = (job: ArmJob, timeoutMs: number): Promise<ReturnType<typeof armOutcomes>> =>
  new Promise((resolve, reject) => {
    const worker = new Worker(new URL("./whatif-worker.ts", import.meta.url), { workerData: job, execArgv: ["--import", "tsx"] })
    const timer = setTimeout(() => {
      void worker.terminate()
      reject(new Error(`timed out after ${timeoutMs / 1000} s`))
    }, timeoutMs)
    worker.once("message", (m: { ok?: ReturnType<typeof armOutcomes>; error?: string }) => {
      clearTimeout(timer)
      void worker.terminate()
      if (m.ok) resolve(m.ok)
      else reject(new Error(m.error ?? "worker failed"))
    })
    worker.once("error", (e) => {
      clearTimeout(timer)
      reject(e)
    })
  })

const estimate = (xs: ReadonlyArray<number>) => {
  const n = xs.length
  const mean = xs.reduce((a, b) => a + b, 0) / n
  const sd = n > 1 ? Math.sqrt(xs.reduce((a, v) => a + (v - mean) ** 2, 0) / (n - 1)) : 0
  return { mean, se: n > 0 ? sd / Math.sqrt(n) : 0 }
}

export interface TestOptions {
  readonly seeds?: number
  readonly horizonS?: number
  readonly timeoutMs?: number
  /** "inline" plays every arm on this thread (tests); "worker" (default) one worker thread per arm. */
  readonly runner?: "worker" | "inline"
}

/** Re-simulate the options (option 0 is "no change") and fill in their paired differences from "no change". */
export const testOptions = (state: MatchState, side: Side, options: ReadonlyArray<DecisionOption>, opts: TestOptions = {}): Effect.Effect<DecisionOption[]> => {
  const job = (orders: ReadonlyArray<ManagerOrder>): ArmJob => ({ state, side, orders, seeds: opts.seeds ?? WHATIF_SEEDS, horizonS: opts.horizonS ?? WHATIF_HORIZON_S })
  const play = (orders: ReadonlyArray<ManagerOrder>) =>
    opts.runner === "inline"
      ? Effect.try(() => armOutcomes(job(orders)))
      : Effect.tryPromise(() => runArm(job(orders), opts.timeoutMs ?? WHATIF_TIMEOUT_MS))
  return Effect.gen(function* () {
    const arms = yield* Effect.forEach(options, (o) => Effect.option(play(o.orders)), { concurrency: Math.max(1, availableParallelism() - 1) })
    const base = arms[0]!
    return options.map((o, i) => {
      if (i === 0) return o
      const arm = arms[i]!
      if (base._tag === "None" || arm._tag === "None") return { ...o, xg_diff_vs_no_change: null, goal_diff_vs_no_change: null, untested: true }
      const b = base.value
      return {
        ...o,
        xg_diff_vs_no_change: estimate(arm.value.map((x, k) => x.xg - b[k]!.xg)),
        goal_diff_vs_no_change: estimate(arm.value.map((x, k) => x.goals - b[k]!.goals)),
        untested: false
      }
    })
  })
}

const r3 = (x: number) => Math.round(x * 1000) / 1000 || 0

/** What the agent is shown of the tested options (numbers rounded to 3 decimals: what the reason may quote). */
export const whatIfSummary = (options: ReadonlyArray<DecisionOption>, opts: Pick<TestOptions, "seeds" | "horizonS"> = {}): WhatIfSummary => {
  const seeds = opts.seeds ?? WHATIF_SEEDS
  const minutes = (opts.horizonS ?? WHATIF_HORIZON_S) / 60
  const est = (e: DecisionOption["xg_diff_vs_no_change"]) => (e === null ? null : { mean: r3(e.mean), se: r3(e.se) })
  return {
    seeds,
    horizon_min: minutes,
    explanation: `Each option was played from this moment ${seeds} times over the next ${minutes} minutes, on the same ${seeds} random futures as no change. Numbers are the average difference from no change in your xG minus the opponent's xG (and in goals), with one standard error; untested options could not be played.`,
    options: options.map((o) => ({ index: o.index, label: o.label, orders: o.orders, xg_diff_vs_no_change: est(o.xg_diff_vs_no_change), goal_diff_vs_no_change: est(o.goal_diff_vs_no_change), untested: o.untested }))
  }
}
```

Apply this change to `packages/manager/src/index.ts` (from the repository root):

```bash
git apply <<'PATCH'
diff --git a/packages/manager/src/index.ts b/packages/manager/src/index.ts
index 4022088..96b72ee 100644
--- a/packages/manager/src/index.ts
+++ b/packages/manager/src/index.ts
@@ -4,3 +4,4 @@ export * from "./replay.js"
 export * from "./rules.js"
 export * from "./run.js"
 export * from "./situation.js"
+export * from "./whatif.js"
PATCH
```

- [ ] **Step 4: Run the tests**

Run: `pnpm --filter @touchline/manager test`
Expected: `Tests  29 passed (29)`

Run: `pnpm turbo run typecheck --force`
Expected: `Tasks:    13 successful, 13 total`

- [ ] **Step 5: Commit**

```bash
git add packages/manager
git commit -m "feat(manager): test a manager's options by re-simulation — each option and no change on the same 20 forks over the next 10 minutes, one worker thread per arm, paired xG and goal differences, untested on a failed or late worker; the summary the agent is shown

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: The manager agent (Python)

The Python service gains the manager agent: `propose` reads the Situation and suggests up to three options; `choose` reads the what-if summary and picks one with a reason of at most 30 words. Code checks what must hold whatever the model says: one to three options, short labels and rationales, a tested pick, and every number in the reason found in the what-if results, the score or the minute (Ruling 7) — one retry told the problem, then the fallback. The model answers plain output models without length limits (code checks them), so any model can produce them. `run_structured` now reports token counts; cost needs a configured price. The A2A server answers `manage` requests with one `manager` artifact and needs no match session. The stub proposes a fixed menu and chooses the best tested gain (Ruling 6).

**Files:**
- Create: `services/agents/touchline_agents/manager.py`
- Modify: `services/agents/touchline_agents/config.py` (manager timeout 30 s; `price_usd_per_mtok`, `cost_usd`)
- Modify: `services/agents/touchline_agents/llm.py` (`Outcome.tokens_in`, `tokens_out`)
- Modify: `services/agents/touchline_agents/server.py` (the `manage` skill)
- Test: `services/agents/tests/test_manager.py`, `services/agents/tests/test_server.py`

**Interfaces:**
- Produces (Python): `class Manager(client, settings)` with `async handle(req: ManageRequest) -> ManagerReply` (never raises); `acceptable_proposal`, `allowed_numbers`, `unknown_numbers(reason, situation, whatif)`, `choice_problem(choice, situation, whatif)`; stub responders for tasks `propose` and `choose`; `Settings.price_usd_per_mtok`, `Settings.cost_usd(tokens_in, tokens_out)` (env `TOUCHLINE_PRICE_USD_PER_MTOK="in,out"`); `create_app(url, settings?, agents?, manager?)`; `TouchlineExecutor(sessions, manager=None)`
- Over A2A: a `ManageRequest` data part → artifact `manager` carrying a `ManagerReply`.
- Consumes: Task 2 (generated `Situation`, `WhatIfSummary`, `Proposal`, `Choice`, `ManagerReply`, `ManagerOrder1/2`).

- [ ] **Step 1: Write the failing tests**

Create `services/agents/tests/test_manager.py`:

```python
import json
from pathlib import Path

import pytest

from touchline_agents.config import SettingsError, load_settings
from touchline_agents.contracts import ManageRequest, parse_request
from touchline_agents.llm import STUB_RESPONDERS, StubChatClient
from touchline_agents.manager import ChooseOut, Manager, ProposeOut, acceptable_proposal, choice_problem, unknown_numbers

SETTINGS = load_settings({}, env_file=None)
FIXTURES = Path(__file__).resolve().parents[3] / "packages/schema/fixtures/agents/valid"


def request(name: str) -> ManageRequest:
    req = parse_request(json.loads((FIXTURES / name).read_text())["value"])
    assert isinstance(req, ManageRequest)
    return req


PROPOSE, CHOOSE = request("request-manage-propose.json"), request("request-manage-choose.json")


def manager(behaviour="ok", settings=SETTINGS, **kw) -> Manager:
    return Manager(StubChatClient(behaviour, **kw), settings)


async def test_proposes_up_to_three_options_from_the_situation():
    r = await manager().handle(PROPOSE)
    assert r.task == "propose" and not r.fallback and r.choice is None
    labels = [o.label for o in r.proposal.options]
    assert labels == ["Press higher", "Sit deeper", "Fresh legs"]
    # Fresh legs: the most tired outfield player, replaced by an available bench player of the same role.
    assert r.proposal.options[2].orders[0].model_dump() == {"kind": "sub", "off": "iro-09", "on": "iro-19"}
    assert (r.tokens_in, r.tokens_out, r.cost_usd, r.model) == (0, 0, 0.0, "stub")


async def test_chooses_the_best_tested_option_and_quotes_only_its_numbers():
    r = await manager().handle(CHOOSE)
    assert not r.fallback and r.proposal is None
    assert r.choice.pick == 1
    assert "0.06" in r.choice.reason
    assert unknown_numbers(r.choice.reason, CHOOSE.situation, CHOOSE.whatif) == []


@pytest.mark.parametrize(("behaviour", "reason"), [("error", "RuntimeError"), ("garbage", "ValidationError"), ("slow", "timeout")])
async def test_a_failed_model_is_a_fallback_reply_never_an_error(behaviour, reason):
    settings = load_settings({"TOUCHLINE_TIMEOUT_SCALE": "0.01"}, env_file=None)
    for req in (PROPOSE, CHOOSE):
        r = await manager(behaviour, settings, slow_s=5).handle(req)
        assert r.fallback and r.reason == reason
        assert r.proposal is None and r.choice is None


def test_a_proposal_is_one_to_three_options_with_orders_a_short_label_and_a_short_rationale():
    ok = {"label": "Press", "orders": [{"kind": "style", "setting": "tempo", "value": 0.9}], "rationale": "Quicker."}
    assert acceptable_proposal(ProposeOut.model_validate({"options": [ok]}))
    for bad in ([ok] * 4, [], [{**ok, "orders": []}], [{**ok, "label": "x" * 61}], [{**ok, "rationale": "word " * 26}]):
        assert not acceptable_proposal(ProposeOut.model_validate({"options": bad}))


def test_a_reason_may_quote_only_the_what_if_numbers_the_score_and_the_minute():
    sit, wi = CHOOSE.situation, CHOOSE.whatif
    assert unknown_numbers("Gains 0.06 xG (± 0.03) over 20 runs, at 61.2 minutes and 0-1 down.", sit, wi) == []
    assert unknown_numbers("Rounded: 0.1 xG.", sit, wi) == []
    assert unknown_numbers("It gains 0.31 xG and we lead 2-1.", sit, wi) == ["2-1", "0.31"]


def test_a_choice_must_be_a_tested_option_with_a_short_grounded_reason():
    sit, wi = CHOOSE.situation, CHOOSE.whatif
    untested = wi.model_copy(update={"options": [wi.options[0], wi.options[1].model_copy(update={"untested": True})]})
    assert choice_problem(ChooseOut(pick=1, reason="Best."), sit, wi) is None
    assert choice_problem(ChooseOut(pick=7, reason="Best."), sit, wi) == "pick 7 is not one of the options"
    assert "not tested" in choice_problem(ChooseOut(pick=1, reason="Best."), sit, untested)
    assert "at most 30" in choice_problem(ChooseOut(pick=0, reason="word " * 31), sit, wi)
    assert "0.5" in choice_problem(ChooseOut(pick=1, reason="It gains 0.5 xG."), sit, wi)


async def test_a_reason_with_an_unknown_number_gets_one_retry_with_the_problem_then_the_fallback(monkeypatch):
    asked: list[dict] = []

    def once_wrong(payload, _results):
        asked.append(payload)
        return {"pick": 1, "reason": "Gains 0.06 xG." if "feedback" in payload else "Gains 0.31 xG."}

    monkeypatch.setitem(STUB_RESPONDERS, "choose", once_wrong)
    r = await manager().handle(CHOOSE)
    assert not r.fallback and r.choice.reason == "Gains 0.06 xG."
    assert len(asked) == 2 and "0.31" in asked[1]["feedback"]

    monkeypatch.setitem(STUB_RESPONDERS, "choose", lambda p, _r: {"pick": 1, "reason": "Gains 0.31 xG."})
    r = await manager().handle(CHOOSE)
    assert r.fallback and r.reason == "invalid" and r.choice is None


def test_cost_comes_from_a_configured_price_only():
    assert SETTINGS.cost_usd(1_000_000, 1_000_000) == 0.0
    priced = load_settings({"TOUCHLINE_PRICE_USD_PER_MTOK": "2,8"}, env_file=None)
    assert priced.cost_usd(500_000, 100_000) == pytest.approx(1.8)
    for bad in ("2", "a,b", "-1,2"):
        with pytest.raises(SettingsError):
            load_settings({"TOUCHLINE_PRICE_USD_PER_MTOK": bad}, env_file=None)
```

Apply this change to `services/agents/tests/test_server.py` (from the repository root):

```bash
git apply <<'PATCH'
diff --git a/services/agents/tests/test_server.py b/services/agents/tests/test_server.py
index af1b2a4..b884fda 100644
--- a/services/agents/tests/test_server.py
+++ b/services/agents/tests/test_server.py
@@ -44,7 +44,7 @@ async def test_serves_its_agent_card(server):
         card = (await http.get(f"{server}.well-known/agent-card.json")).json()
     assert card["name"] == "touchline-agents" and card["capabilities"]["streaming"]
     assert card["supportedInterfaces"][0] == {"url": server, "protocolBinding": "JSONRPC", "protocolVersion": "1.0"}
-    assert {s["id"] for s in card["skills"]} == {"moments", "recap"}
+    assert {s["id"] for s in card["skills"]} == {"moments", "recap", "manage"}
 
 
 async def test_signals_stream_back_as_cues_and_traces(server, stats_url, stats):
@@ -97,3 +97,17 @@ async def test_the_full_time_recap_closes_the_match(stats_url, stats):
     assert sessions.open_matches() == [MATCH_ID]
     await sessions.finish(req)
     assert sessions.open_matches() == []
+
+
+async def test_a_manage_request_needs_no_match_session_and_answers_with_a_manager_artifact(server):
+    from pathlib import Path
+    import json
+
+    from touchline_agents.contracts import ManagerReply
+
+    fixture = Path(__file__).resolve().parents[3] / "packages/schema/fixtures/agents/valid/request-manage-propose.json"
+    req = json.loads(fixture.read_text())["value"]
+    state, arts, _ = await send(server, [new_data_part(req, "application/json")])
+    assert state == TaskState.TASK_STATE_COMPLETED
+    [reply] = [ManagerReply.model_validate(a) for a in arts["manager"]]
+    assert reply.task == "propose" and not reply.fallback and len(reply.proposal.options) >= 2
PATCH
```

- [ ] **Step 2: Run them to make sure they fail**

Run: `uv run --project services/agents pytest -q services/agents/tests/test_manager.py services/agents/tests/test_server.py`
Expected: FAIL: `touchline_agents.manager` does not exist, and the agent card has no `manage` skill

- [ ] **Step 3: Write the implementation**

Create `services/agents/touchline_agents/manager.py`:

```python
"""Manager agent (Plan 4b, spec §3): a team's manager at a key moment, in two steps.

`propose` reads the Situation (the match from the team's side, up to the pause) and suggests up to three changes;
the engine then re-simulates each against "no change", and `choose` picks one with those numbers in front of it and
says why. Code owns what must hold whatever the model says: at most three options, short labels and reasons, a pick
that is a tested option, and a reason whose every number comes from the what-if results, the score or the minute
(one retry with feedback, then the fallback). The engine re-checks every order against the live state.

A fallback means nothing was decided here: the engine stands in the rule-based option for a failed `propose` and keeps
the previous plan for a failed `choose`.
"""

import re
from dataclasses import dataclass
from typing import Literal

from agent_framework import Agent, BaseChatClient
from pydantic import BaseModel, ConfigDict

from .config import Settings
from .contracts_gen import Choice, ManagerOption, ManagerOrder1, ManagerOrder2, Proposal, Situation, WhatIfSummary
from .contracts import ManageRequest, ManagerReply
from .llm import agent_options, run_structured, stub_responder
from .numbers import NUMBER, SCORE, matches, numbers_in

MAX_OPTIONS = 3
MAX_LABEL_CHARS = 60
MAX_RATIONALE_WORDS = 25
MAX_REASON_WORDS = 30

PROPOSE = """You are the manager of a football team, deciding at a stoppage. INPUT.situation is the match from your
team's side up to now: the moment (why you are deciding, minute, minutes left, score), both teams (archetype,
formation, style settings with their allowed range and meaning, stats so far), your players on the pitch (energy_pct
100 = fresh, minutes played, booked or not, shots, xG, passes completed, tackles won) and your bench (available or
already used), your limits (substitutions and stoppage windows left; half-time changes use no window) and the last
10 minutes per side.
Propose 2 or 3 different changes worth testing. Each option has a short `label` (at most 60 characters), `orders` and a
one-sentence `rationale` (at most 25 words). An order is either {"kind": "style", "setting": <a style setting>,
"value": <within its range>} or {"kind": "sub", "off": <id of a player on the pitch>, "on": <id of an available bench
player>}. A substitute takes the position and role of the player going off; the formation does not change. Respect
the limits. Play to your team's identity (its archetype) unless the score demands otherwise. Do not propose "no
change": it is always tested."""

CHOOSE = """You are the manager of a football team, deciding at a stoppage. INPUT.situation is the match from your
team's side; INPUT.whatif is how each option did when the engine played it from this moment many times over the next
minutes, as the average difference from no change (option 0) in your xG minus the opponent's xG and in goals, each
with one standard error. Pick one option by its `index` (0 keeps everything as it is; never pick an untested option)
and give a `reason` of at most 30 words. Weigh the size of a difference against its standard error: a gain smaller
than its error is not a clear gain. Any number in the reason must be one from INPUT.whatif, the score or the minute,
written as given or rounded."""


class ProposedOption(BaseModel):
    """What the model writes for an option (no length limits here: code checks them, so any model can answer)."""

    model_config = ConfigDict(extra="forbid")
    label: str
    orders: list[ManagerOrder1 | ManagerOrder2]
    rationale: str


class ProposeOut(BaseModel):
    model_config = ConfigDict(extra="forbid")
    options: list[ProposedOption]


class ChooseOut(BaseModel):
    model_config = ConfigDict(extra="forbid")
    pick: int
    reason: str


def _words(text: str) -> int:
    return len(text.split())


def acceptable_proposal(p: ProposeOut) -> bool:
    """One to three options, each with orders, a short label and a short rationale."""
    return 1 <= len(p.options) <= MAX_OPTIONS and all(
        o.orders and 0 < len(o.label) <= MAX_LABEL_CHARS and _words(o.rationale) <= MAX_RATIONALE_WORDS for o in p.options
    )


def allowed_numbers(situation: Situation, whatif: WhatIfSummary) -> list[float]:
    """The numbers a reason may quote: every what-if figure, the seeds and horizon, the score and the minute."""
    out: list[float] = [float(whatif.seeds), float(whatif.horizon_min), situation.moment.minute]
    out += [float(situation.moment.score.for_), float(situation.moment.score.against)]
    for o in whatif.options:
        out.append(float(o.index))
        for e in (o.xg_diff_vs_no_change, o.goal_diff_vs_no_change):
            if e is not None:
                out += [e.mean, abs(e.mean), e.se]
    return out


def unknown_numbers(reason: str, situation: Situation, whatif: WhatIfSummary) -> list[str]:
    """Numbers in the reason that are not in the what-if results, the score or the minute."""
    allowed = allowed_numbers(situation, whatif)
    score = {f"{situation.moment.score.for_}-{situation.moment.score.against}", f"{situation.moment.score.against}-{situation.moment.score.for_}"}
    bad = []
    for token in numbers_in(reason):
        if SCORE.fullmatch(token):
            if re.sub(r"\s|–", lambda m: "-" if m.group(0) == "–" else "", token) not in score:
                bad.append(token)
        elif NUMBER.fullmatch(token) and not any(matches(token, v) for v in allowed):
            bad.append(token)
    return bad


def choice_problem(c: ChooseOut, situation: Situation, whatif: WhatIfSummary) -> str | None:
    """Why the choice cannot stand, or None."""
    by_index = {o.index: o for o in whatif.options}
    if c.pick not in by_index:
        return f"pick {c.pick} is not one of the options"
    if by_index[c.pick].untested:
        return f"option {c.pick} was not tested; pick a tested option or 0"
    if _words(c.reason) > MAX_REASON_WORDS:
        return f"the reason has {_words(c.reason)} words; at most {MAX_REASON_WORDS}"
    if bad := unknown_numbers(c.reason, situation, whatif):
        return f"the reason quotes {', '.join(bad)}, which is not in the what-if results, the score or the minute"
    return None


# ---------------------------------------------------------------- the stub model (tests and CI)

STYLE = {"pressIntensity", "lineHeight", "compactness", "tempo", "longBallBias", "crossBias", "riskTolerance"}


def _setting(sit: dict, key: str) -> dict:
    return next(s for s in sit["team"]["style"] if s["setting"] == key)


def _nudge(sit: dict, key: str, by: float) -> dict:
    s = _setting(sit, key)
    return {"kind": "style", "setting": key, "value": round(min(s["max"], max(s["min"], s["value"] + by)), 2)}


@stub_responder("propose")
def _stub_propose(payload: dict, _results: list[str]) -> dict:
    """Deterministic: press higher, sit deeper and (when a change is allowed) fresh legs for the most tired player."""
    sit = payload["situation"]
    options = [
        {"label": "Press higher", "orders": [_nudge(sit, "pressIntensity", 0.2), _nudge(sit, "tempo", 0.2)], "rationale": "Win the ball back sooner."},
        {"label": "Sit deeper", "orders": [_nudge(sit, "lineHeight", -0.3), _nudge(sit, "compactness", 0.2)], "rationale": "Protect the space behind."},
    ]
    limits = sit["limits"]
    if limits["subs_left"] > 0 and (limits["windows_left"] > 0 or limits["half_time_break"]):
        tired = sorted((p for p in sit["players"]["on_pitch"] if p["role"] != "GK"), key=lambda p: (p["energy_pct"], p["id"]))
        bench = [b for b in sit["players"]["bench"] if b["available"] and b["role"] != "GK"]
        for p in tired:
            on = next((b for b in bench if b["role"] == p["role"]), None)
            if on:
                options.append({"label": "Fresh legs", "orders": [{"kind": "sub", "off": p["id"], "on": on["id"]}], "rationale": f"{p['name']} is tiring."})
                break
    return {"options": options}


@stub_responder("choose")
def _stub_choose(payload: dict, _results: list[str]) -> dict:
    """Deterministic: the tested option with the best xG gain above zero, else no change."""
    tested = [o for o in payload["whatif"]["options"] if o["index"] > 0 and not o["untested"] and o["xg_diff_vs_no_change"]]
    best = max(tested, key=lambda o: (o["xg_diff_vs_no_change"]["mean"], -o["index"]), default=None)
    if best is None or best["xg_diff_vs_no_change"]["mean"] <= 0:
        return {"pick": 0, "reason": "No option did better than keeping things as they are."}
    return {"pick": best["index"], "reason": f"{best['label']} added {best['xg_diff_vs_no_change']['mean']} xG over no change."}


# ---------------------------------------------------------------- the agent

@dataclass(frozen=True)
class _Call:
    value: BaseModel | None
    fallback: bool
    reason: str | None
    ms: float
    tokens_in: int
    tokens_out: int


class Manager:
    def __init__(self, client: BaseChatClient, settings: Settings) -> None:
        self.settings = settings
        self.proposer = Agent(client=client, name="manager", instructions=PROPOSE, default_options=agent_options(settings))
        self.chooser = Agent(client=client, name="manager", instructions=CHOOSE, default_options=agent_options(settings))

    async def _ask(self, task: Literal["propose", "choose"], payload: dict, output: type[BaseModel], accept) -> _Call:
        out = await run_structured(
            self.proposer if task == "propose" else self.chooser, task, payload, output,
            timeout_s=self.settings.timeout("manager"), fallback=lambda: None, accept=accept,  # type: ignore[arg-type, return-value]
        )
        return _Call(out.value, out.fallback, out.reason, out.ms, out.tokens_in, out.tokens_out)

    async def handle(self, req: ManageRequest) -> ManagerReply:
        """Answer one manage request; never raises (a failed model call is a fallback reply)."""
        sit = req.situation.model_dump(mode="json", by_alias=True)
        calls: list[_Call] = []
        proposal: Proposal | None = None
        choice: Choice | None = None
        if req.task == "propose":
            c = await self._ask("propose", {"situation": sit}, ProposeOut, acceptable_proposal)
            calls.append(c)
            if not c.fallback:
                proposal = Proposal(options=[ManagerOption.model_validate(o.model_dump()) for o in c.value.options])  # type: ignore[union-attr]
        else:
            if req.whatif is None:
                raise ValueError("a choose request needs the what-if results")
            wi = req.whatif.model_dump(mode="json", by_alias=True)
            problem: list[str] = []

            def accept(x: ChooseOut) -> bool:
                p = choice_problem(x, req.situation, req.whatif)
                problem[:] = [p] if p else []
                return p is None

            c = await self._ask("choose", {"situation": sit, "whatif": wi}, ChooseOut, accept)
            calls.append(c)
            if c.fallback and c.reason == "invalid" and problem:
                # One retry, told exactly what was wrong.
                c = await self._ask("choose", {"situation": sit, "whatif": wi, "feedback": problem[0]}, ChooseOut, accept)
                calls.append(c)
            if not c.fallback:
                choice = Choice(pick=c.value.pick, reason=c.value.reason)  # type: ignore[union-attr]
        last = calls[-1]
        tokens_in, tokens_out = sum(x.tokens_in for x in calls), sum(x.tokens_out for x in calls)
        return ManagerReply(
            task=req.task, proposal=proposal, choice=choice, fallback=last.fallback, reason=last.reason,
            ms=sum(x.ms for x in calls), tokens_in=tokens_in, tokens_out=tokens_out,
            cost_usd=self.settings.cost_usd(tokens_in, tokens_out), model=self.settings.model_label,
        )
```

Apply this change to `services/agents/touchline_agents/config.py`, `services/agents/touchline_agents/llm.py`, `services/agents/touchline_agents/server.py` (from the repository root):

```bash
git apply <<'PATCH'
diff --git a/services/agents/touchline_agents/config.py b/services/agents/touchline_agents/config.py
index 7874100..3e4823e 100644
--- a/services/agents/touchline_agents/config.py
+++ b/services/agents/touchline_agents/config.py
@@ -31,6 +31,8 @@ TIMEOUTS_S: Mapping[str, float] = {
     "personalizer": 3.0,
     "recap": 20.0,
     "judge": 20.0,
+    # The manager decides ahead of time (Plan 4b), so a slow model only slows match generation.
+    "manager": 30.0,
 }
 
 
@@ -51,6 +53,15 @@ class Settings:
     request_budget_s: float | None = None
     # Kept out of repr so the key never reaches a log line or a test report.
     openai_api_key: str | None = field(default=None, repr=False)
+    # US dollars per million (input, output) tokens, from TOUCHLINE_PRICE_USD_PER_MTOK="in,out"; None: cost not known.
+    price_usd_per_mtok: tuple[float, float] | None = None
+
+    def cost_usd(self, tokens_in: int, tokens_out: int) -> float:
+        """What a call cost, or 0 when no price is configured (the A/B report then says the price is unset)."""
+        if self.price_usd_per_mtok is None:
+            return 0.0
+        p_in, p_out = self.price_usd_per_mtok
+        return (tokens_in * p_in + tokens_out * p_out) / 1_000_000
 
     def model(self, tier: Tier) -> str:
         return self.small_model if tier == "small" else self.large_model
@@ -103,6 +114,13 @@ def load_settings(env: Mapping[str, str] | None = None, env_file: Path | None =
         budget_s = float(budget) if budget else None
     except ValueError:
         raise SettingsError("TOUCHLINE_REQUEST_BUDGET_S must be a number of seconds") from None
+    price = merged.get("TOUCHLINE_PRICE_USD_PER_MTOK")
+    try:
+        price_pair = tuple(float(x) for x in price.split(",")) if price else None
+    except ValueError:
+        raise SettingsError('TOUCHLINE_PRICE_USD_PER_MTOK must be "input,output" dollars per million tokens') from None
+    if price_pair is not None and (len(price_pair) != 2 or min(price_pair) < 0):
+        raise SettingsError('TOUCHLINE_PRICE_USD_PER_MTOK must be "input,output" dollars per million tokens')
     hosts = merged.get("TOUCHLINE_MCP_HOSTS", "127.0.0.1,localhost,::1")
     cp = merged.get("TOUCHLINE_CHECKPOINTS")
     return Settings(
@@ -115,4 +133,5 @@ def load_settings(env: Mapping[str, str] | None = None, env_file: Path | None =
         reasoning_effort=effort,
         request_budget_s=budget_s,
         openai_api_key=key,
+        price_usd_per_mtok=price_pair,
     )
diff --git a/services/agents/touchline_agents/llm.py b/services/agents/touchline_agents/llm.py
index c083ecd..2a028af 100644
--- a/services/agents/touchline_agents/llm.py
+++ b/services/agents/touchline_agents/llm.py
@@ -156,6 +156,9 @@ class Outcome[T]:
     # Why the fallback was used (exception type or "invalid"); None when the model answered.
     reason: str | None
     ms: float
+    # Tokens the model call used (0 for the stub, a fallback without a call, or a provider that reports none).
+    tokens_in: int = 0
+    tokens_out: int = 0
 
 
 async def run_structured[T: BaseModel](
@@ -172,19 +175,22 @@ async def run_structured[T: BaseModel](
     `fallback()` instead (spec §6: every agent has a deterministic fallback, so the match never goes silent)."""
     t0 = time.perf_counter()
     reason: str | None = None
+    tokens = (0, 0)
     if (end := _DEADLINE.get()) is not None:
         timeout_s = min(timeout_s, end - time.monotonic())
         if timeout_s <= 0.05:
             return Outcome(fallback(), True, "deadline", 0.0)
     try:
         r = await asyncio.wait_for(agent.run(envelope(task, payload), options={"response_format": output}), timeout_s)
+        usage = getattr(r, "usage_details", None) or {}
+        tokens = (int(usage.get("input_token_count") or 0), int(usage.get("output_token_count") or 0))
         value = r.value
         if isinstance(value, output) and accept(value):
-            return Outcome(value, False, None, (time.perf_counter() - t0) * 1000)
+            return Outcome(value, False, None, (time.perf_counter() - t0) * 1000, *tokens)
         reason = "invalid"
     except TimeoutError:
         reason = "timeout"
     except Exception as e:  # any model or parsing failure means: use the fallback
         reason = type(e).__name__
         log.warning("%s: model failed (%s), using the fallback", task, reason)
-    return Outcome(fallback(), True, reason, (time.perf_counter() - t0) * 1000)
+    return Outcome(fallback(), True, reason, (time.perf_counter() - t0) * 1000, *tokens)
diff --git a/services/agents/touchline_agents/server.py b/services/agents/touchline_agents/server.py
index fa4c618..812fa47 100644
--- a/services/agents/touchline_agents/server.py
+++ b/services/agents/touchline_agents/server.py
@@ -2,7 +2,8 @@
 
 Each message carries one AgentRequest as a JSON data part. A signals request runs the moment workflow and streams
 an artifact per verified cue ("cue") and per moment ("trace"); a recap request streams the recap ("recap") and its
-recap cards ("cue"). Sessions are per match; requests for one match run one at a time, in order.
+recap cards ("cue"). Sessions are per match; requests for one match run one at a time, in order. A manage request
+(Plan 4b) needs no match session: the manager agent answers it with one "manager" artifact.
 """
 
 import argparse
@@ -23,8 +24,9 @@ from pydantic import ValidationError
 from starlette.applications import Starlette
 
 from .config import Settings, load_settings
-from .contracts import RecapRequest, SignalsRequest, dump, parse_request
-from .llm import deadline
+from .contracts import ManageRequest, RecapRequest, SignalsRequest, dump, parse_request
+from .llm import deadline, make_client
+from .manager import Manager
 from .session import Agents, MatchSession
 from .stats import StatsError
 from .workflow import build, run_moments, run_recap
@@ -47,6 +49,8 @@ def agent_card(url: str) -> AgentCard:
                        tags=["football", "commentary"], examples=['{"kind": "signals", ...}']),
             AgentSkill(id="recap", name="Recap", description="A fact-checked half-time or full-time recap and its recap cards.",
                        tags=["football", "recap"], examples=['{"kind": "recap", "recap": "half_time", ...}']),
+            AgentSkill(id="manage", name="Manager", description="A team's manager at a key moment: propose changes, or choose among re-simulated ones.",
+                       tags=["football", "tactics"], examples=['{"kind": "manage", "task": "propose", ...}']),
         ],
     )
 
@@ -108,8 +112,9 @@ class Sessions:
 
 
 class TouchlineExecutor(AgentExecutor):
-    def __init__(self, sessions: Sessions) -> None:
+    def __init__(self, sessions: Sessions, manager: Manager | None = None) -> None:
         self.sessions = sessions
+        self.manager = manager or Manager(make_client(sessions.settings, "large"), sessions.settings)
 
     async def execute(self, context: RequestContext, event_queue: EventQueue) -> None:
         task = context.current_task or new_task_from_user_message(context.message)
@@ -121,6 +126,9 @@ class TouchlineExecutor(AgentExecutor):
             if len(data) != 1:
                 raise ValueError(f"expected one JSON data part, got {len(data)}")
             req = parse_request(data[0])
+            if isinstance(req, ManageRequest):
+                await self._manage(req, up, task)
+                return
             session, workflow, lock = await self.sessions.get(req)
         except (ValueError, ValidationError, StatsError) as e:
             await up.failed(new_text_message(f"bad request: {e}", context_id=task.context_id, task_id=task.id))
@@ -150,15 +158,23 @@ class TouchlineExecutor(AgentExecutor):
                 await self.sessions.finish(req)
         await up.complete()
 
+    async def _manage(self, req: ManageRequest, up: TaskUpdater, task) -> None:
+        """One manager answer as the "manager" artifact (a failed model call is a fallback reply, not a failed task)."""
+        await up.start_work(new_text_message(f"manage {req.task} for {req.match_id}", context_id=task.context_id, task_id=task.id))
+        reply = await self.manager.handle(req)
+        await up.add_artifact([new_data_part(dump(reply), JSON)], artifact_id=f"{req.match_id}-{req.situation.team_id}-{req.task}", name="manager", last_chunk=True)
+        await up.complete()
+
     async def cancel(self, context: RequestContext, event_queue: EventQueue) -> None:
         await TaskUpdater(event_queue, context.task_id, context.context_id).cancel()
 
 
-def create_app(url: str, settings: Settings | None = None, agents: Agents | None = None) -> Starlette:
+def create_app(url: str, settings: Settings | None = None, agents: Agents | None = None, manager: Manager | None = None) -> Starlette:
     """The A2A app: the agent card at /.well-known/agent-card.json and JSON-RPC at /."""
-    sessions = Sessions(settings or load_settings(), agents)
+    settings = settings or load_settings()
+    sessions = Sessions(settings, agents)
     card = agent_card(url)
-    handler = DefaultRequestHandler(agent_executor=TouchlineExecutor(sessions), task_store=InMemoryTaskStore(), agent_card=card)
+    handler = DefaultRequestHandler(agent_executor=TouchlineExecutor(sessions, manager), task_store=InMemoryTaskStore(), agent_card=card)
 
     @asynccontextmanager
     async def lifespan(_app):
PATCH
```

- [ ] **Step 4: Run the tests**

Run: `uv run --project services/agents pytest -q services/agents/tests`
Expected: `175 passed, 7 deselected`

- [ ] **Step 5: Commit**

```bash
git add services/agents
git commit -m "feat(agents): the manager agent — propose up to three changes from the Situation, choose among the re-simulated ones with a short reason whose numbers must come from the what-if results (one retry with the problem, then the fallback); token counts and an optional configured price; a manage skill over A2A that needs no match session

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: The agent manager

The TypeScript side of the agent: `agentManager(send)` asks the service to propose, checks each option's orders against the live state (dropping refused ones with the reason), tests the options, and asks it to choose. Failures never stop the match: a failed proposal is replaced by the rule-based option (testing and choosing go on), a failed choice keeps the previous plan, and an unreachable service keeps the previous plan and, after repeated failures, pauses calls for a few decisions. The gateway's `manage` call adds the time limit, one retry when the service cannot be reached, and the contract check. An end-to-end test runs a decision through the real Python service on the stub model.

**Files:**
- Create: `packages/agent-gateway/src/manage.ts`; modify `packages/agent-gateway/src/index.ts`
- Create: `packages/manager/src/agent.ts`; modify `packages/manager/src/index.ts`, `packages/manager/package.json` (depends on `@touchline/agent-gateway`)
- Test: `packages/agent-gateway/test/manage.test.ts`, `packages/manager/test/agent.test.ts`, `packages/manager/test/e2e.test.ts`
- Modify: `pnpm-lock.yaml` (by `pnpm install`)

**Interfaces:**
- Produces: `manage(send, req: ManageRequest, timeoutMs): Effect<ManagerReply, AgentUnavailable | AgentFailed | InvalidArtifact | TimeoutError>` (`@touchline/agent-gateway`); `interface AgentManagerOptions { callTimeoutMs?; whatif?: TestOptions; breaker?: { failures; cooldown } }`; `agentManager(send: Sender, config?): Manager` (`@touchline/manager`; defaults 45 s per call, breaker 3 failures → skip 4)
- Consumes: Task 2 (`ManageRequest`, `ManagerReply`, `decodeManagerReply`), Task 4 (`checkedOption`, `decisionBase`, `NO_CHANGE`, `rulesOption`), Task 5 (`testOptions`, `whatIfSummary`), Task 6 (the `manage` skill).

- [ ] **Step 1: Add the dependency**

Apply this change to `packages/manager/package.json` (from the repository root):

```bash
git apply <<'PATCH'
diff --git a/packages/manager/package.json b/packages/manager/package.json
index 92e1487..96d7010 100644
--- a/packages/manager/package.json
+++ b/packages/manager/package.json
@@ -6,6 +6,7 @@
   "exports": { ".": "./src/index.ts" },
   "scripts": { "test": "vitest run", "typecheck": "tsc --noEmit -p ." },
   "dependencies": {
+    "@touchline/agent-gateway": "workspace:*",
     "@touchline/schema": "workspace:*",
     "@touchline/sim-core": "workspace:*",
     "@touchline/stats": "workspace:*",
PATCH
```

Run: `pnpm install`
Expected: `@touchline/manager` links `@touchline/agent-gateway`

- [ ] **Step 2: Write the failing tests**

Create `packages/agent-gateway/test/manage.test.ts`:

```ts
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { Effect, Exit } from "effect"
import type { AgentRequest, ManageRequest } from "@touchline/schema"
import { describe, expect, it } from "vitest"
import type { Artifact, Sender } from "../src/a2a.js"
import { manage } from "../src/manage.js"
import { root } from "../src/replay.js"

const fixture = (name: string) => (JSON.parse(readFileSync(join(root, "packages/schema/fixtures/agents/valid", name), "utf8")) as { value: unknown }).value
const REQ = fixture("request-manage-propose.json") as ManageRequest
const REPLY = fixture("manager-reply.json")

/** A sender answering manage requests with `answer(n)` (n counts calls). */
const sender = (answer: (n: number) => Artifact[] | Error, delayMs = 0): Sender & { calls: AgentRequest[] } => {
  const calls: AgentRequest[] = []
  return Object.assign(async function* (req: AgentRequest) {
    calls.push(req)
    if (delayMs) await new Promise((r) => setTimeout(r, delayMs))
    const out = answer(calls.length)
    if (out instanceof Error) throw out
    yield* out
  }, { calls })
}
const failure = (exit: Exit.Exit<unknown, { _tag: string }>) => (Exit.isFailure(exit) ? JSON.stringify(exit.cause) : "")

describe("a manage request", () => {
  it("returns the decoded manager reply", async () => {
    const reply = await Effect.runPromise(manage(sender(() => [{ name: "manager", data: REPLY }]), REQ, 1000))
    expect(reply.proposal!.options[0]!.label).toBe("Fresh striker, press higher")
  })
  it("is tried once more when the service cannot be reached, and not when it answers wrongly", async () => {
    const flaky = sender((n) => (n === 1 ? new Error("ECONNREFUSED") : [{ name: "manager", data: REPLY }]))
    await Effect.runPromise(manage(flaky, REQ, 1000))
    expect(flaky.calls).toHaveLength(2)
    const wrong = sender(() => [{ name: "cue", data: {} }])
    expect(failure(await Effect.runPromiseExit(manage(wrong, REQ, 1000)))).toContain("InvalidArtifact")
    expect(wrong.calls).toHaveLength(1)
  })
  it("fails on a reply that breaks the contract, answers another task or never comes", async () => {
    const bad = { ...(REPLY as object), proposal: { options: [] } }
    expect(failure(await Effect.runPromiseExit(manage(sender(() => [{ name: "manager", data: bad }]), REQ, 1000)))).toContain("InvalidArtifact")
    const other = { ...(REPLY as object), task: "choose", proposal: null, choice: { pick: 0, reason: "x" } }
    expect(failure(await Effect.runPromiseExit(manage(sender(() => [{ name: "manager", data: other }]), REQ, 1000)))).toContain("answered choose")
    expect(failure(await Effect.runPromiseExit(manage(sender(() => []), REQ, 1000)))).toContain("no manager artifact")
    expect(failure(await Effect.runPromiseExit(manage(sender(() => [{ name: "manager", data: REPLY }], 300), REQ, 50)))).toContain("TimeoutError")
  })
})
```

Create `packages/manager/test/agent.test.ts`:

```ts
import { Effect } from "effect"
import type { Artifact, Sender } from "@touchline/agent-gateway"
import { decodeDecision, type AgentRequest, type ManageRequest, type ManagerReply } from "@touchline/schema"
import { describe, expect, it } from "vitest"
import { agentManager } from "../src/agent.js"
import type { DecideInput } from "../src/decision.js"
import { replayManager } from "../src/replay.js"
import { runManaged } from "../src/run.js"
import { situationAt, situationHash } from "../src/situation.js"
import { leagueConfig, models, playMoments, xt } from "./helpers.js"

const whatif = { seeds: 2, horizonS: 30, runner: "inline" as const }
const run = playMoments(leagueConfig(11), (m) => m.reasons.includes("minute_60"))
const m = run.moments.at(-1)!
const situation = situationAt(m.state, "home", m.reasons, run.watch)
const input: DecideInput = { state: m.state, side: "home", reasons: m.reasons, situation, situationHash: situationHash(situation) }
const striker = situation.players.on_pitch.find((p) => p.role === "ST")!
const freshStriker = situation.players.bench.find((b) => b.role === "ST")!

const reply = (over: Partial<ManagerReply> & Pick<ManagerReply, "task">): ManagerReply => ({
  proposal: null, choice: null, fallback: false, reason: null, ms: 5, tokens_in: 100, tokens_out: 10, cost_usd: 0.001, model: "openai:test", ...over
})
const PROPOSAL = reply({
  task: "propose",
  proposal: { options: [
    { label: "Press higher", orders: [{ kind: "style", setting: "pressIntensity", value: 1 }], rationale: "Win it back sooner." },
    { label: "Fresh striker", orders: [{ kind: "sub", off: striker.id, on: freshStriker.id }], rationale: "Tired legs up front." }
  ] }
})
/** The tested option with the best xG gain, as the stub model chooses. */
const best = (req: ManageRequest) => {
  const tested = req.whatif!.options.filter((o) => o.index > 0 && !o.untested)
  return tested.sort((a, b) => b.xg_diff_vs_no_change!.mean - a.xg_diff_vs_no_change!.mean)[0]!
}

/** A fake manager service: `propose` and `choose` answers (or errors), and every request it got. */
const service = (answers: { propose?: (r: ManageRequest) => ManagerReply | Error; choose?: (r: ManageRequest) => ManagerReply | Error } = {}): Sender & { calls: ManageRequest[] } => {
  const calls: ManageRequest[] = []
  return Object.assign(async function* (req: AgentRequest): AsyncGenerator<Artifact> {
    const r = req as ManageRequest
    calls.push(r)
    const answer = r.task === "propose" ? (answers.propose ?? (() => PROPOSAL))(r) : (answers.choose ?? ((q) => reply({ task: "choose", choice: { pick: best(q).index, reason: `${best(q).label} did best.` } })))(r)
    if (answer instanceof Error) throw answer
    yield { name: "manager", data: answer }
  }, { calls })
}
const decide = (send: Sender) => Effect.runPromise(agentManager(send, { whatif }).decide(input))

describe("the agent manager", () => {
  it("proposes, tests every option against no change, and applies the agent's choice", async () => {
    const send = service()
    const d = await decide(send)
    expect(send.calls.map((c) => c.task)).toEqual(["propose", "choose"])
    expect(send.calls[0]!.situation).toEqual(situation)
    expect(d.options.map((o) => [o.index, o.label, o.source])).toEqual([[0, "No change", "no_change"], [1, "Press higher", "agent"], [2, "Fresh striker", "agent"]])
    expect(d.options.slice(1).every((o) => o.xg_diff_vs_no_change !== null && !o.untested)).toBe(true)
    // The agent was shown exactly the tested numbers, rounded.
    expect(send.calls[1]!.whatif!.options.map((o) => o.index)).toEqual([0, 1, 2])
    expect(d.pick).toBe(best(send.calls[1]!).index)
    expect(d.orders_applied).toEqual(d.options[d.pick]!.orders)
    expect([d.fallback, d.tokens, d.cost_usd, d.model, d.manager]).toEqual([null, { in: 200, out: 20 }, 0.002, "openai:test", "agent"])
    expect(decodeDecision(d)).toEqual(d)
  })
  it("stands the rule-based option in when the agent cannot propose, and still lets it choose", async () => {
    const lostSituation = { ...situation, moment: { ...situation.moment, score: { for: 0, against: 2 }, score_state: "losing by 2" } }
    const send = service({ propose: () => reply({ task: "propose", fallback: true, reason: "timeout" }) })
    const d = await Effect.runPromise(agentManager(send, { whatif }).decide({ ...input, situation: lostSituation }))
    expect(d.fallback).toBe("propose")
    expect(d.options.map((o) => o.source)).toEqual(["no_change", "rules"])
    expect(send.calls.map((c) => c.task)).toEqual(["propose", "choose"])
  })
  it("drops orders the live state refuses, with the reason, and treats a proposal with none left as failed", async () => {
    const bad = reply({ task: "propose", proposal: { options: [{ label: "Ghost", orders: [{ kind: "sub", off: "nobody", on: freshStriker.id }], rationale: "?" }] } })
    const d = await decide(service({ propose: () => bad }))
    expect(d.fallback).toBe("propose")
    expect(d.options.every((o) => o.source !== "agent")).toBe(true)
    const kept = await Effect.runPromise(agentManager(service({ propose: () => reply({ task: "propose", proposal: { options: [...PROPOSAL.proposal!.options, bad.proposal!.options[0]!] } }) }), { whatif }).decide(input))
    expect(kept.options[3]!.dropped).toEqual([{ order: { kind: "sub", off: "nobody", on: freshStriker.id }, reason: "nobody is not on the pitch for this team" }])
  })
  it("keeps the previous plan when the agent cannot choose, or picks an option that was not tested", async () => {
    for (const choose of [() => reply({ task: "choose", fallback: true, reason: "invalid" }), () => reply({ task: "choose", choice: { pick: 9, reason: "?" } })]) {
      const d = await decide(service({ choose }))
      expect([d.pick, d.fallback, d.orders_applied]).toEqual([0, "choose", []])
      expect(d.options).toHaveLength(3)
    }
  })
  it("keeps the previous plan when the service cannot be reached, and stops asking for a while after repeated failures", async () => {
    const down = service({ propose: () => new Error("ECONNREFUSED") })
    const mgr = agentManager(down, { whatif, breaker: { failures: 2, cooldown: 2 } })
    const ds = []
    for (let i = 0; i < 5; i++) ds.push(await Effect.runPromise(mgr.decide(input)))
    expect(ds.map((d) => [d.pick, d.fallback])).toEqual(Array(5).fill([0, "service"]))
    // Two failures (each tried twice by the gateway), two skipped decisions, then the service is asked again.
    expect(down.calls).toHaveLength(6)
  })
})

describe("a match managed by the agent", () => {
  it("logs its decisions and replays bit-identically without calling the agent", async () => {
    const cfg = leagueConfig(11)
    const send = service()
    const managed = await Effect.runPromise(runManaged(cfg, { home: agentManager(send, { whatif }) }, { models, xt }))
    expect(managed.decisions.length).toBeGreaterThanOrEqual(3)
    expect(managed.decisions.every((d) => d.side === "home" && d.manager === "agent")).toBe(true)
    const calls = send.calls.length
    const replay = await Effect.runPromise(runManaged(cfg, { home: replayManager(managed.decisions) }, { models, xt }))
    expect(replay.events).toEqual(managed.events)
    expect(send.calls).toHaveLength(calls)
  })
})
```

Create `packages/manager/test/e2e.test.ts`:

```ts
/**
 * The manager over the real wire: the Python agent service on the stub model, a Situation built by the engine, and a
 * decision through propose, re-simulation and choose (the Pydantic models forbid unknown fields, so this also proves
 * the two sides agree on every field).
 */
import { spawn, type ChildProcess } from "node:child_process"
import { createServer } from "node:net"
import { Effect } from "effect"
import { a2aSender } from "@touchline/agent-gateway"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { agentManager } from "../src/agent.js"
import { situationAt, situationHash } from "../src/situation.js"
import { leagueConfig, playMoments, root } from "./helpers.js"

const freePort = () => new Promise<number>((ok) => {
  const s = createServer().listen(0, "127.0.0.1", () => {
    const port = (s.address() as { port: number }).port
    s.close(() => ok(port))
  })
})

let agents: ChildProcess
let url: string

beforeAll(async () => {
  const port = await freePort()
  agents = spawn("uv", ["run", "--project", "services/agents", "touchline-agents", "--port", String(port)], { cwd: root, env: { ...process.env, TOUCHLINE_LLM: "stub" }, detached: true, stdio: "ignore" })
  url = `http://127.0.0.1:${port}/`
  for (let i = 0; i < 300; i++) {
    if (await fetch(`${url}.well-known/agent-card.json`).then((r) => r.ok, () => false)) break
    await new Promise((r) => setTimeout(r, 200))
  }
}, 120_000)

afterAll(() => {
  if (agents?.pid) process.kill(-agents.pid, "SIGTERM")
})

describe("the manager agent service", () => {
  it("takes a situation built by the engine, proposes, and chooses among the tested options", async () => {
    const run = playMoments(leagueConfig(11), (m) => m.reasons.includes("minute_60"))
    const m = run.moments.at(-1)!
    for (const side of ["home", "away"] as const) {
      const situation = situationAt(m.state, side, m.reasons, run.watch)
      const d = await Effect.runPromise(agentManager(a2aSender(url), { whatif: { seeds: 2, horizonS: 30 } }).decide({ state: m.state, side, reasons: m.reasons, situation, situationHash: situationHash(situation) }))
      expect(d.fallback).toBeNull()
      expect(d.model).toBe("stub")
      expect(d.options.length).toBeGreaterThanOrEqual(3)
      expect(d.options.filter((o) => o.source === "agent").every((o) => o.dropped.length === 0)).toBe(true)
    }
  })
})
```

- [ ] **Step 3: Run them to make sure they fail**

Run: `pnpm --filter @touchline/agent-gateway test manage`
Expected: FAIL: `../src/manage.js` does not exist

Run: `pnpm --filter @touchline/manager test agent e2e`
Expected: FAIL: `../src/agent.js` does not exist

- [ ] **Step 4: Write the implementation**

Create `packages/agent-gateway/src/manage.ts`:

```ts
/**
 * Manage requests (Plan 4b): one manager agent call over A2A, with a time limit, one retry when the service cannot be
 * reached, and the reply checked against its contract. A reply that is a fallback is still a reply: the caller decides.
 */
import { Effect } from "effect"
import { decodeManagerReply, type ManageRequest, type ManagerReply } from "@touchline/schema"
import { TaskFailed, type Sender } from "./a2a.js"
import { AgentFailed, AgentUnavailable, InvalidArtifact } from "./gateway.js"

/** Ask the manager agent; fails with AgentUnavailable, AgentFailed, InvalidArtifact or a TimeoutError. */
export const manage = (send: Sender, req: ManageRequest, timeoutMs: number) =>
  Effect.tryPromise({
    try: async (signal): Promise<ManagerReply> => {
      let reply: ManagerReply | undefined
      for await (const a of send(req, signal)) {
        if (a.name !== "manager") throw new InvalidArtifact({ name: a.name, reason: "a manage request answers with a manager artifact" })
        try {
          reply = decodeManagerReply(a.data)
        } catch (e) {
          throw new InvalidArtifact({ name: "manager", reason: e instanceof Error ? e.message.split("\n")[0]! : String(e) })
        }
      }
      if (!reply) throw new InvalidArtifact({ name: "manager", reason: "no manager artifact" })
      if (reply.task !== req.task) throw new InvalidArtifact({ name: "manager", reason: `asked to ${req.task}, answered ${reply.task}` })
      return reply
    },
    catch: (e) =>
      e instanceof InvalidArtifact ? e : e instanceof TaskFailed ? new AgentFailed({ reason: e.message }) : new AgentUnavailable({ reason: e instanceof Error ? e.message : String(e) })
  }).pipe(Effect.timeout(`${timeoutMs} millis`), Effect.retry({ times: 1, while: (e) => e._tag === "AgentUnavailable" }))
```

Create `packages/manager/src/agent.ts`:

```ts
/**
 * The agent manager (spec §2.3, §3): at a key moment it asks the Python manager agent to propose changes, has the
 * engine test each against "no change", and asks the agent to choose. Failures never stop the match:
 *   propose fails (a fallback reply, nothing valid) → the rule-based option stands in, then testing and choosing go on;
 *   choose fails                                   → the previous plan stays (no change);
 *   the service cannot be reached, or the circuit is open after repeated failures → the previous plan stays.
 */
import { Effect } from "effect"
import { manage, type Sender } from "@touchline/agent-gateway"
import type { Decision, ManageRequest, ManagerReply } from "@touchline/schema"
import { checkedOption, decisionBase, NO_CHANGE, type DecideInput, type DecisionOption, type Manager } from "./decision.js"
import { rulesOption } from "./rules.js"
import { testOptions, whatIfSummary, type TestOptions } from "./whatif.js"

export interface AgentManagerOptions {
  /** Milliseconds one manage call may take (the agent's own model timeout is 30 s). */
  readonly callTimeoutMs?: number
  readonly whatif?: TestOptions
  /** After `failures` decisions in a row that could not reach the service, skip it for the next `cooldown` decisions. */
  readonly breaker?: { readonly failures: number; readonly cooldown: number }
}

const DEFAULTS = { callTimeoutMs: 45_000, breaker: { failures: 3, cooldown: 4 } }

/** A call's outcome: the reply, or why the service could not give one. */
type Called = { readonly reply: ManagerReply; readonly ms: number } | { readonly unavailable: string; readonly ms: number }

export const agentManager = (send: Sender, config: AgentManagerOptions = {}): Manager => {
  const callTimeoutMs = config.callTimeoutMs ?? DEFAULTS.callTimeoutMs
  const breaker = config.breaker ?? DEFAULTS.breaker
  let failures = 0
  let skip = 0

  const call = (req: ManageRequest): Effect.Effect<Called> =>
    Effect.gen(function* () {
      const t0 = performance.now()
      const exit = yield* Effect.exit(manage(send, req, callTimeoutMs))
      const ms = performance.now() - t0
      if (exit._tag === "Success") return { reply: exit.value, ms }
      return { unavailable: String(exit.cause), ms }
    })

  return {
    kind: "agent",
    decide: (input: DecideInput) =>
      Effect.gen(function* () {
        const base = decisionBase(input)
        const timings = { propose: 0, whatif: 0, choose: 0 }
        let tokensIn = 0, tokensOut = 0, cost = 0, model = "unavailable"
        const account = (r: ManagerReply) => {
          tokensIn += r.tokens_in
          tokensOut += r.tokens_out
          cost += r.cost_usd
          model = r.model
        }
        const done = (options: DecisionOption[], pick: number, reason: string, fallback: Decision["fallback"]): Decision => ({
          ...base, manager: "agent", options, pick, reason, orders_applied: options[pick]!.orders, fallback,
          timings_ms: { propose: Math.round(timings.propose), whatif: Math.round(timings.whatif), choose: Math.round(timings.choose) },
          tokens: { in: tokensIn, out: tokensOut }, cost_usd: cost, model
        })
        const request = (task: ManageRequest["task"], whatif: ManageRequest["whatif"]): ManageRequest => ({ kind: "manage", task, match_id: base.match_id, situation: input.situation, whatif })
        const unreachable = (reason: string) => {
          failures += 1
          if (failures >= breaker.failures) skip = breaker.cooldown
          return done([NO_CHANGE], 0, `The manager agent could not be reached (${reason.slice(0, 120)}); the previous plan stays.`, "service")
        }

        if (skip > 0) {
          skip -= 1
          if (skip === 0) failures = 0
          return done([NO_CHANGE], 0, "The manager agent is paused after repeated failures; the previous plan stays.", "service")
        }

        // 1. Propose.
        const proposed = yield* call(request("propose", null))
        timings.propose = proposed.ms
        if ("unavailable" in proposed) return unreachable(proposed.unavailable)
        failures = 0
        account(proposed.reply)
        let fallback: Decision["fallback"] = null
        let options: DecisionOption[] = (proposed.reply.proposal?.options ?? []).map((o, i) => checkedOption(input, i + 1, o, "agent"))
        if (proposed.reply.fallback || options.every((o) => o.orders.length === 0)) {
          fallback = "propose"
          const rules = rulesOption(input.situation)
          options = rules ? [checkedOption(input, 1, rules, "rules")] : []
        }
        const all = [NO_CHANGE, ...options]
        if (options.length === 0) return done(all, 0, "No option to test; the previous plan stays.", fallback)

        // 2. Test every option against no change.
        const t0 = performance.now()
        const tested = yield* testOptions(input.state, input.side, all, config.whatif)
        timings.whatif = performance.now() - t0

        // 3. Choose.
        const chosen = yield* call(request("choose", whatIfSummary(tested, config.whatif)))
        timings.choose = chosen.ms
        if ("unavailable" in chosen) return { ...unreachable(chosen.unavailable), options: tested }
        account(chosen.reply)
        const c = chosen.reply.choice
        const pick = c && tested[c.pick] && !tested[c.pick]!.untested ? c.pick : null
        if (chosen.reply.fallback || pick === null) return done(tested, 0, "The manager agent could not choose; the previous plan stays.", "choose")
        return done(tested, pick, c!.reason, fallback)
      })
  }
}
```

Apply this change to `packages/agent-gateway/src/index.ts`, `packages/manager/src/index.ts` (from the repository root):

```bash
git apply <<'PATCH'
diff --git a/packages/agent-gateway/src/index.ts b/packages/agent-gateway/src/index.ts
index 0af90a2..d3fe7e9 100644
--- a/packages/agent-gateway/src/index.ts
+++ b/packages/agent-gateway/src/index.ts
@@ -4,3 +4,4 @@ export * from "./gateway.js"
 export * from "./mcp.js"
 export * from "./replay.js"
 export * from "./segments.js"
+export * from "./manage.js"
diff --git a/packages/manager/src/index.ts b/packages/manager/src/index.ts
index 96b72ee..82099c4 100644
--- a/packages/manager/src/index.ts
+++ b/packages/manager/src/index.ts
@@ -5,3 +5,4 @@ export * from "./rules.js"
 export * from "./run.js"
 export * from "./situation.js"
 export * from "./whatif.js"
+export * from "./agent.js"
PATCH
```

- [ ] **Step 5: Run the tests**

Run: `pnpm --filter @touchline/agent-gateway test`
Expected: `Tests  20 passed (20)`

Run: `pnpm --filter @touchline/manager test`
Expected: `Tests  36 passed (36)` (the end-to-end test starts the Python service with `uv`)

Run: `pnpm turbo run typecheck --force`
Expected: `Tasks:    13 successful, 13 total`

- [ ] **Step 6: Commit**

```bash
git add packages/agent-gateway packages/manager pnpm-lock.yaml
git commit -m "feat(manager): the agent manager — propose over A2A, test the options, choose; the rule-based option stands in for a failed proposal, a failed choice or an unreachable service keeps the previous plan, a circuit breaker pauses the service after repeated failures; the gateway's manage call (time limit, one retry, contract check); end to end against the Python service

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: pnpm manage: managed matches as run folders

A managed match is written like any match (CDF, domain events, SPADL, manifest) plus `decisions.jsonl`, one canonical line per decision, hashed in the manifest with the managers. `--replay <decisions.jsonl>` plays the same match from its log without any model. The sim writer takes a managed match's steps and refuses a scenario script. The CLI lives in `packages/manager` (Ruling 8).

**Files:**
- Modify: `packages/sim/src/writer.ts` (`WriteOptions.managed`, `RunManifest.managers`, `decisions.jsonl`)
- Create: `packages/manager/src/write.ts`, `packages/manager/src/cli.ts`; modify `packages/manager/src/index.ts`, `packages/manager/package.json` (script `manage`, dependency `@touchline/sim`)
- Modify: `package.json` (root script `manage`), `pnpm-lock.yaml` (by `pnpm install`)
- Test: `packages/manager/test/write.test.ts`

**Interfaces:**
- Produces: `RunManifest.managers?: { home: string | null; away: string | null; decisions: number }`; `WriteOptions.managed?: { steps; managers; decisions: () => unknown[] }` (`@touchline/sim`); `DECISIONS_FILE = "decisions.jsonl"`, `writeManaged(cfg, managers, dir, { models, xt }): Effect<RunManifest>`, `readDecisions(file): Decision[]` (`@touchline/manager`); CLI `pnpm manage --seed --home --away --home-manager none|rules|agent --away-manager … --replay FILE --agents-url URL --whatif-seeds N --whatif-horizon S --fps --kickoff --match-id --params --out`
- Consumes: Task 4 (`managedConfig`, `managedSteps`, `replayManager`, `rulesManager`), Task 7 (`agentManager`).

- [ ] **Step 1: Add the dependency and the scripts**

Apply this change to `package.json`, `packages/manager/package.json` (from the repository root):

```bash
git apply <<'PATCH'
diff --git a/package.json b/package.json
index 5bca701..20fe949 100644
--- a/package.json
+++ b/package.json
@@ -9,6 +9,7 @@
     "dev": "turbo run dev --filter=@touchline/api --filter=@touchline/web",
     "typecheck": "turbo run typecheck",
     "sim": "pnpm --filter @touchline/sim run sim",
+    "manage": "pnpm --filter @touchline/manager run manage",
     "league": "pnpm --filter @touchline/league run generate",
     "calibrate": "pnpm --filter @touchline/calibrate run calibrate",
     "realism": "pnpm --filter @touchline/calibrate run realism",
diff --git a/packages/manager/package.json b/packages/manager/package.json
index 96d7010..4264ab3 100644
--- a/packages/manager/package.json
+++ b/packages/manager/package.json
@@ -4,10 +4,11 @@
   "private": true,
   "type": "module",
   "exports": { ".": "./src/index.ts" },
-  "scripts": { "test": "vitest run", "typecheck": "tsc --noEmit -p ." },
+  "scripts": { "test": "vitest run", "typecheck": "tsc --noEmit -p .", "manage": "tsx src/cli.ts" },
   "dependencies": {
     "@touchline/agent-gateway": "workspace:*",
     "@touchline/schema": "workspace:*",
+    "@touchline/sim": "workspace:*",
     "@touchline/sim-core": "workspace:*",
     "@touchline/stats": "workspace:*",
     "effect": "4.0.1"
PATCH
```

Run: `pnpm install`
Expected: `@touchline/manager` links `@touchline/sim`

- [ ] **Step 2: Write the failing tests**

Create `packages/manager/test/write.test.ts`:

```ts
import { spawnSync } from "node:child_process"
import { existsSync, mkdtempSync, readFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { Effect } from "effect"
import type { RunManifest } from "@touchline/sim"
import { describe, expect, it } from "vitest"
import { replayManager } from "../src/replay.js"
import { rulesManager } from "../src/rules.js"
import { DECISIONS_FILE, readDecisions, writeManaged } from "../src/write.js"
import { leagueConfig, models, root, xt } from "./helpers.js"

const cfg = { ...leagueConfig(11), managed: undefined }
const dir = mkdtempSync(join(tmpdir(), "managed-"))
const manifest = Effect.runSync(writeManaged(cfg, { home: rulesManager, away: rulesManager }, join(dir, "a"), { models, xt }))
const manifestOf = (d: string) => JSON.parse(readFileSync(join(d, "manifest.json"), "utf8")) as RunManifest

describe("a managed match's run folder", () => {
  it("holds the usual files plus decisions.jsonl, all hashed, and names its managers", () => {
    for (const f of ["meta.json", "event.jsonl", "tracking.jsonl", "domain.jsonl", "spadl.csv", DECISIONS_FILE, "manifest.json"]) expect(existsSync(join(dir, "a", f)), f).toBe(true)
    const decisions = readDecisions(join(dir, "a", DECISIONS_FILE))
    expect(manifest.managers).toEqual({ home: "rules", away: "rules", decisions: decisions.length })
    expect(manifest.outputs[DECISIONS_FILE]).toMatch(/^sha256:[0-9a-f]{64}$/)
    expect(manifestOf(join(dir, "a"))).toEqual(manifest)
  })
  it("has no scenario script: a script forcing outcomes would distort the decisions", () => {
    const scripted = { ...cfg, script: { name: "x", entries: [{ window: [0, 10] as [number, number], team: "home" as const, effect: "goal" as const, count: 1 }] } }
    expect(() => Effect.runSync(writeManaged(scripted, { home: rulesManager }, join(dir, "scripted"), { models, xt }))).toThrow("a managed match has no scenario script")
  })
  it("replays from its decision log into identical files", () => {
    const replay = replayManager(readDecisions(join(dir, "a", DECISIONS_FILE)))
    const again = Effect.runSync(writeManaged(cfg, { home: replay, away: replay }, join(dir, "b"), { models, xt }))
    expect(again.outputs).toEqual(manifest.outputs)
    expect(again.managers).toEqual({ ...manifest.managers, home: "replay", away: "replay" })
  })
})

describe("pnpm manage", () => {
  const manage = (...args: string[]) => spawnSync("pnpm", ["-s", "manage", ...args], { cwd: root, encoding: "utf8" })
  it("writes a match with a rules manager for one team and none for the other, then replays it", () => {
    const out = join(dir, "cli")
    const r = manage("--seed", "11", "--home-manager", "rules", "--away-manager", "none", "--out", out)
    expect(r.status, r.stderr).toBe(0)
    expect(manifestOf(out).managers!.away).toBeNull()
    const again = join(dir, "cli-replay")
    expect(manage("--seed", "11", "--replay", join(out, DECISIONS_FILE), "--out", again).status).toBe(0)
    expect(manifestOf(again).outputs["domain.jsonl"]).toBe(manifestOf(out).outputs["domain.jsonl"])
  })
  it("refuses a bad command line with a one-line message", () => {
    const same = manage("--home", "ironmoor", "--away", "ironmoor")
    // pnpm echoes the commands it runs on stderr first; the message is the last line.
    expect([same.status, same.stderr.trim().split("\n").at(-1)]).toEqual([2, "--home and --away must be different clubs"])
    const missing = manage("--replay", join(dir, "nope.jsonl"))
    expect(missing.status).toBe(2)
    expect(missing.stderr).toContain("no decision log at")
  })
})
```

- [ ] **Step 3: Run them to make sure they fail**

Run: `pnpm --filter @touchline/manager test write`
Expected: FAIL: `../src/write.js` does not exist

- [ ] **Step 4: Write the implementation**

Create `packages/manager/src/cli.ts`:

```ts
/**
 * touchline-manage: simulate one match with managers (Plan 4b) and write its run folder with decisions.jsonl.
 *   pnpm manage --seed 5001 --home ironmoor --away saltmarsh --home-manager agent --away-manager rules
 *   pnpm manage --replay out/m-5001/decisions.jsonl --seed 5001 --home ironmoor --away saltmarsh   (no model calls)
 * The agent manager needs the agent service (pnpm agents serve, or touchline-agents) at --agents-url.
 */
import { existsSync, readFileSync } from "node:fs"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { Effect } from "effect"
import { a2aSender } from "@touchline/agent-gateway"
import type { League } from "@touchline/league"
import { CliError, cliOptions, exitOnUserError, integer, isoTime, oneOf, positiveInteger, safeName } from "@touchline/sim"
import { DEFAULT_PARAMS, paramsFromJson } from "@touchline/sim-core"
import { modelsFromJson, xtGridFromJson } from "@touchline/stats"
import { agentManager } from "./agent.js"
import type { Manager } from "./decision.js"
import { replayManager } from "./replay.js"
import { rulesManager } from "./rules.js"
import { readDecisions, writeManaged } from "./write.js"

const root = join(dirname(fileURLToPath(import.meta.url)), "../../..")
const here = (p: string) => resolve(process.env.INIT_CWD ?? process.cwd(), p)
const json = (p: string) => JSON.parse(readFileSync(join(root, p), "utf8"))
const league = json("data/league/league.json") as League
const clubIds = league.clubs.map((c) => c.id)
const defaultParams = join(root, "data/params/touchline-params.json")
const MANAGERS = ["none", "rules", "agent"]

const o = cliOptions("touchline-manage: simulate one match with managers and write its run folder, decisions.jsonl included", {
  seed: { default: "1", check: integer(0, 4294967295), help: "match seed" },
  home: { default: "ironmoor", check: oneOf(clubIds), help: "home club id" },
  away: { default: "kestrel-bay", check: oneOf(clubIds), help: "away club id" },
  "home-manager": { default: "rules", check: oneOf(MANAGERS), help: "the home team's manager (none, rules, agent)" },
  "away-manager": { default: "rules", check: oneOf(MANAGERS), help: "the away team's manager (none, rules, agent)" },
  replay: { default: "", help: "a decisions.jsonl to replay instead of deciding (same seed and clubs; no model calls)" },
  "agents-url": { default: "http://127.0.0.1:8100/", help: "the agent service (A2A) for agent managers" },
  "whatif-seeds": { default: "20", check: positiveInteger, help: "forks per option when an agent's options are tested" },
  "whatif-horizon": { default: "600", check: positiveInteger, help: "seconds each fork plays" },
  fps: { default: "10", check: oneOf(["10", "25"]), help: "tracking frames per second" },
  kickoff: { default: "2026-10-18T14:00:00.000Z", check: isoTime, help: "kickoff time, ISO 8601 UTC" },
  "match-id": { default: "", check: safeName, help: "match id (default m-<seed>); also the output folder name" },
  params: { default: existsSync(defaultParams) ? defaultParams : "default", help: "parameter file, or \"default\" for hand-set priors" },
  out: { default: "", help: "output folder (default out/<match-id>)" }
})

const params = o.params === "default" ? DEFAULT_PARAMS : paramsFromJson(JSON.parse(readFileSync(here(o.params), "utf8")))
const seed = Number(o.seed)
const matchId = o["match-id"] || `m-${seed}`
const club = (id: string) => league.clubs.find((c) => c.id === id)!
exitOnUserError(() => {
  if (o.home === o.away) throw new CliError("--home and --away must be different clubs")
})
const cfg = { matchId, seed, kickoffTime: o.kickoff, home: club(o.home), away: club(o.away), params, dt: 1 / Number(o.fps) }

const managers: Partial<Record<"home" | "away", Manager>> = exitOnUserError(() => {
  if (o.replay) {
    if (!existsSync(here(o.replay))) throw new CliError(`no decision log at ${o.replay}`)
    const logged = readDecisions(here(o.replay))
    const replay = replayManager(logged)
    return Object.fromEntries((["home", "away"] as const).filter((s) => logged.some((d) => d.side === s)).map((s) => [s, replay]))
  }
  const send = a2aSender(o["agents-url"])
  const whatif = { seeds: Number(o["whatif-seeds"]), horizonS: Number(o["whatif-horizon"]) }
  const make = (kind: string): Manager | undefined => (kind === "rules" ? rulesManager : kind === "agent" ? agentManager(send, { whatif }) : undefined)
  return Object.fromEntries((["home", "away"] as const).flatMap((s) => {
    const m = make(o[`${s}-manager`])
    return m ? [[s, m]] : []
  }))
})

const out = here(o.out || join(root, "out", matchId))
const stats = { models: modelsFromJson(json("data/params/stats-models.json")), xt: xtGridFromJson(json("data/params/xt-grid.json")) }
Effect.runPromise(writeManaged(cfg, managers, out, stats)).then((m) => console.log(`${out}: ${JSON.stringify({ ...m.stats, managers: m.managers })}`))
```

Create `packages/manager/src/write.ts`:

```ts
/**
 * Writing a managed match (spec §2.4): the run folder of a plain match (CDF, domain events, manifest) plus
 * decisions.jsonl, one line per decision, and the managers in the manifest; reading a decision log back for replay.
 */
import { readFileSync } from "node:fs"
import { Effect } from "effect"
import type { MatchConfig } from "@touchline/sim-core"
import { writeMatch } from "@touchline/sim"
import { decodeDecision, type Decision } from "@touchline/schema"
import type { StatsModels, XtGrid } from "@touchline/stats"
import { managedConfig, managedSteps, type Managers } from "./run.js"

export const DECISIONS_FILE = "decisions.jsonl"

/** Simulate a managed match into `dir`; the manifest it wrote. */
export const writeManaged = (cfg: MatchConfig, managers: Managers, dir: string, stats: { readonly models: StatsModels; readonly xt: XtGrid | null }) =>
  Effect.suspend(() => {
    const decisions: Decision[] = []
    const steps = managedSteps(cfg, managers, { ...stats, onDecision: (d) => decisions.push(d) })
    return writeMatch(managedConfig(cfg, managers), dir, {
      // Each line in the contract's canonical form (and checked), so a replay writes the same bytes.
      managed: { steps, managers: { home: managers.home?.kind ?? null, away: managers.away?.kind ?? null }, decisions: () => decisions.map((d) => decodeDecision(d)) }
    })
  })

/** A run folder's decision log, each line checked against the Decision contract. */
export const readDecisions = (file: string): Decision[] =>
  readFileSync(file, "utf8").split("\n").filter((l) => l.trim()).map((l) => decodeDecision(JSON.parse(l)))
```

Apply this change to `packages/manager/src/index.ts`, `packages/sim/src/writer.ts` (from the repository root):

```bash
git apply <<'PATCH'
diff --git a/packages/manager/src/index.ts b/packages/manager/src/index.ts
index 82099c4..698b6dc 100644
--- a/packages/manager/src/index.ts
+++ b/packages/manager/src/index.ts
@@ -6,3 +6,4 @@ export * from "./run.js"
 export * from "./situation.js"
 export * from "./whatif.js"
 export * from "./agent.js"
+export * from "./write.js"
diff --git a/packages/sim/src/writer.ts b/packages/sim/src/writer.ts
index 1d10ad1..31c0ebd 100644
--- a/packages/sim/src/writer.ts
+++ b/packages/sim/src/writer.ts
@@ -2,7 +2,7 @@ import { createHash } from "node:crypto"
 import { closeSync, mkdirSync, openSync, readFileSync, writeFileSync, writeSync } from "node:fs"
 import { join } from "node:path"
 import { Effect, Stream } from "effect"
-import { runScript, type DomainEvent, type Frame, type MatchConfig, type WindowResult } from "@touchline/sim-core"
+import { runScript, type DomainEvent, type Frame, type MatchConfig, type StepOutput, type WindowResult } from "@touchline/sim-core"
 import { cdfEventLine, cdfMeta, cdfTrackingLine, periodsFromFrames } from "./cdf.js"
 import { hasScript, matchSteps } from "./run.js"
 import { addRealismNoise, REALISM_NOISE } from "./noise.js"
@@ -23,6 +23,8 @@ export interface RunManifest {
   readonly stats: { readonly frames: number; readonly events: number; readonly cdf_events: number; readonly score: string }
   /** The noise added to the CDF events (see noise.ts), or null when they are exact. */
   readonly realism_noise: typeof REALISM_NOISE | null
+  /** A managed match (Plan 4b): each team's manager and how many decisions decisions.jsonl holds. */
+  readonly managers?: { readonly home: string | null; readonly away: string | null; readonly decisions: number }
   /**
    * Ground truth for the evaluation harness (spec §5.1.12, §5.3.1); kept out of CDF. Its frame ids (`frames`,
    * `frame_id`) are global ticks, as in domain.jsonl and the stats engine; CDF frame ids restart at 0 each period.
@@ -45,11 +47,21 @@ const sha256 = (path: string) => "sha256:" + createHash("sha256").update(readFil
 export interface WriteOptions {
   /** Add realism noise to the CDF events (default off). */
   readonly noise?: boolean
+  /**
+   * A managed match (Plan 4b): its steps (decisions included), each team's manager, and its decision log lines, read
+   * once the steps have run; they are written to decisions.jsonl. Managed matches have no scenario script.
+   */
+  readonly managed?: {
+    readonly steps: Stream.Stream<StepOutput>
+    readonly managers: { readonly home: string | null; readonly away: string | null }
+    readonly decisions: () => ReadonlyArray<unknown>
+  }
 }
 
 export const writeMatch = (cfg: MatchConfig, dir: string, opts: WriteOptions = {}) =>
   Effect.gen(function* () {
     // A scripted match is resolved first so its window results are known; a plain match streams step by step.
+    if (opts.managed && hasScript(cfg)) return yield* Effect.die(new Error("a managed match has no scenario script"))
     const run = hasScript(cfg) ? runScript(cfg) : null
     const windows: ReadonlyArray<WindowResult> = run?.windows ?? []
     mkdirSync(dir, { recursive: true })
@@ -60,7 +72,7 @@ export const writeMatch = (cfg: MatchConfig, dir: string, opts: WriteOptions = {
     const events: DomainEvent[] = []
     let frames = 0
     let last: Frame | null = null
-    yield* Stream.runForEach(run ? Stream.fromIterable(run.steps) : matchSteps(cfg), (r) =>
+    yield* Stream.runForEach(run ? Stream.fromIterable(run.steps) : (opts.managed?.steps ?? matchSteps(cfg)), (r) =>
       Effect.sync(() => {
         events.push(...r.events)
         const f = r.frame
@@ -94,6 +106,8 @@ export const writeMatch = (cfg: MatchConfig, dir: string, opts: WriteOptions = {
     writeFileSync(join(dir, "domain.jsonl"), ordered.map((e) => JSON.stringify(e)).join("\n") + "\n")
     writeFileSync(join(dir, "spadl.csv"), spadlCsv(ordered, cfg))
     writeFileSync(join(dir, "meta.json"), JSON.stringify(cdfMeta(cfg, periodsFromFrames(periods)), null, 1))
+    const decisions = opts.managed?.decisions() ?? null
+    if (decisions) writeFileSync(join(dir, "decisions.jsonl"), decisions.map((d) => JSON.stringify(d) + "\n").join(""))
     const goals = events.filter((e) => e.type === "goal")
     const score = `${goals.filter((g) => g.team_id === cfg.home.id).length}-${goals.filter((g) => g.team_id === cfg.away.id).length}`
     const manifest: RunManifest = {
@@ -105,9 +119,10 @@ export const writeMatch = (cfg: MatchConfig, dir: string, opts: WriteOptions = {
       fps: Math.round(1 / cfg.dt),
       params_version: cfg.params.provenance.version,
       engine: { name: "touchline-sim", version: "0.1.0" },
-      outputs: Object.fromEntries(["meta.json", "event.jsonl", "tracking.jsonl", "domain.jsonl", "spadl.csv"].map((f) => [f, sha256(join(dir, f))])),
+      outputs: Object.fromEntries([...["meta.json", "event.jsonl", "tracking.jsonl", "domain.jsonl", "spadl.csv"], ...(decisions ? ["decisions.jsonl"] : [])].map((f) => [f, sha256(join(dir, f))])),
       stats: { frames, events: events.length, cdf_events: cdfLines.length, score },
       realism_noise: opts.noise ? REALISM_NOISE : null,
+      ...(opts.managed && decisions ? { managers: { ...opts.managed.managers, decisions: decisions.length } } : {}),
       truths: {
         script: scriptTruths(windows, cfg),
         scripted_events: ordered.filter((e) => e.attrs.scripted === true).map((e) => ({ id: e.id, type: e.type, frame_id: e.frame_id, team_id: e.team_id, player_id: e.player_id })),
PATCH
```

- [ ] **Step 5: Run the tests**

Run: `pnpm --filter @touchline/manager test`
Expected: `Tests  41 passed (41)`

Run: `pnpm --filter @touchline/sim test`
Expected: `Tests  50 passed (50)`

Run: `pnpm turbo run typecheck --force`
Expected: `Tasks:    13 successful, 13 total`

- [ ] **Step 6: Commit**

```bash
git add package.json packages/manager packages/sim pnpm-lock.yaml
git commit -m "feat(manager): pnpm manage — a managed match written as a run folder with decisions.jsonl (canonical, hashed in the manifest with the managers), or replayed from a decision log without model calls; the sim writer takes a managed match's steps

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 9: pnpm managers:ab: the A/B evaluation

The A/B evaluation of spec §5: fixtures from seed 5000 rotate the managed club through every club and its opponent through the others, home and away in turn; each is played with no manager, the rule-based manager and the agent manager for the managed team (the opponent never has one), each match in its own worker thread. The report gives the managed team's xG difference per match (primary), goal difference and points as paired bootstrap intervals for agent − none, agent − rules and rules − none, win rates with Wilson intervals, and the agent's fallbacks, refused orders, best-option picks, latency, tokens and cost; its headline says "better", "no detectable difference" or "worse" as the interval does. Every decision is kept for inspection. A match without managers skips the stats engine. The CI suite runs four seeds on the stub.

**Files:**
- Create: `packages/manager/src/ab/stats.ts`, `match.ts`, `report.ts`, `setup.ts`, `worker.ts`, `run.ts`, `cli.ts`
- Modify: `packages/manager/src/run.ts` (no stats engine without managers), `packages/manager/src/index.ts`, `packages/manager/package.json` (script `ab`), `package.json` (root script `managers:ab`)
- Test: `packages/manager/test/ab-stats.test.ts`, `packages/manager/test/ab.test.ts`

**Interfaces:**
- Produces: `BOOTSTRAP_RESAMPLES`, `BOOTSTRAP_SEED`, `interface Interval { mean; lo; hi; n }`, `percentile`, `pairedBootstrap(diffs)`, `wilson(k, n)`, `verdict(interval)`; `ARMS`, `type Arm`, `AB_FIRST_SEED = 5000`, `interface Fixture`, `fixtures(first, count, clubs)`, `interface MatchResult`, `resultOf(events, team)`, `playArm(cfg, fixture, arm, agent, stats)`; `interface AbMeta`, `decisionStats`, `summarize(results, meta)`, `headline(summary)`, `markdown(summary)`; `loadSetup()`; `runAb(opts)`, `startAgents(llm)`; CLI `pnpm managers:ab --seeds --first --arms --llm stub|openai|external --agents-url --whatif-seeds --whatif-horizon --concurrency --out --runs` (writes `manager-ab.md`, `manager-ab.json`, and `decisions.jsonl` under `--runs`)
- Consumes: Tasks 4, 5, 7.

- [ ] **Step 1: Add the scripts**

Apply this change to `package.json`, `packages/manager/package.json` (from the repository root):

```bash
git apply <<'PATCH'
diff --git a/package.json b/package.json
index 20fe949..06773c8 100644
--- a/package.json
+++ b/package.json
@@ -10,6 +10,7 @@
     "typecheck": "turbo run typecheck",
     "sim": "pnpm --filter @touchline/sim run sim",
     "manage": "pnpm --filter @touchline/manager run manage",
+    "managers:ab": "pnpm --filter @touchline/manager run ab",
     "league": "pnpm --filter @touchline/league run generate",
     "calibrate": "pnpm --filter @touchline/calibrate run calibrate",
     "realism": "pnpm --filter @touchline/calibrate run realism",
diff --git a/packages/manager/package.json b/packages/manager/package.json
index 4264ab3..16bc49e 100644
--- a/packages/manager/package.json
+++ b/packages/manager/package.json
@@ -4,7 +4,7 @@
   "private": true,
   "type": "module",
   "exports": { ".": "./src/index.ts" },
-  "scripts": { "test": "vitest run", "typecheck": "tsc --noEmit -p .", "manage": "tsx src/cli.ts" },
+  "scripts": { "test": "vitest run", "typecheck": "tsc --noEmit -p .", "manage": "tsx src/cli.ts", "ab": "tsx src/ab/cli.ts" },
   "dependencies": {
     "@touchline/agent-gateway": "workspace:*",
     "@touchline/schema": "workspace:*",
PATCH
```

- [ ] **Step 2: Write the failing tests**

Create `packages/manager/test/ab-stats.test.ts`:

```ts
import { describe, expect, it } from "vitest"
import { pairedBootstrap, percentile, verdict, wilson } from "../src/ab/stats.js"

describe("A/B statistics", () => {
  it("bootstrap a paired mean: the interval holds the mean, narrows with more pairs, and is the same every time", () => {
    const diffs = Array.from({ length: 40 }, (_, i) => ((i * 37) % 11) / 10 - 0.3)
    const i = pairedBootstrap(diffs)
    expect(i.lo).toBeLessThan(i.mean)
    expect(i.hi).toBeGreaterThan(i.mean)
    expect(pairedBootstrap(diffs)).toEqual(i)
    const wide = pairedBootstrap(diffs.slice(0, 10))
    expect(wide.hi - wide.lo).toBeGreaterThan(i.hi - i.lo)
    const same = pairedBootstrap([0.2, 0.2, 0.2])
    for (const v of [same.mean, same.lo, same.hi]) expect(v).toBeCloseTo(0.2, 12)
  })
  it("give Wilson intervals for a share (textbook value: 8 of 10 is 0.49 to 0.94)", () => {
    const w = wilson(8, 10)
    expect([w.mean, Math.round(w.lo * 100) / 100, Math.round(w.hi * 100) / 100]).toEqual([0.8, 0.49, 0.94])
    expect(wilson(0, 10).lo).toBeCloseTo(0, 10)
  })
  it("read a verdict from whether the interval excludes zero", () => {
    expect(verdict({ mean: 0.1, lo: 0.02, hi: 0.2, n: 9 })).toBe("better")
    expect(verdict({ mean: -0.1, lo: -0.2, hi: -0.01, n: 9 })).toBe("worse")
    expect(verdict({ mean: 0.1, lo: -0.02, hi: 0.2, n: 9 })).toBe("no detectable difference")
  })
  it("take percentiles by interpolation", () => {
    expect(percentile([1, 2, 3, 4], 0.5)).toBe(2.5)
    expect(percentile([5], 0.95)).toBe(5)
  })
})
```

Create `packages/manager/test/ab.test.ts`:

```ts
import { spawnSync } from "node:child_process"
import { mkdtempSync, readFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { Effect } from "effect"
import type { DomainEvent } from "@touchline/sim-core"
import { describe, expect, it } from "vitest"
import { fixtures, playArm, resultOf, type MatchResult } from "../src/ab/match.js"
import { headline, markdown, summarize, type AbSummary } from "../src/ab/report.js"
import { rulesManager } from "../src/rules.js"
import { runManaged } from "../src/run.js"
import { loadSetup } from "../src/ab/setup.js"
import { root } from "./helpers.js"

const setup = loadSetup()

describe("A/B fixtures", () => {
  const list = fixtures(5000, 16, setup.clubs)
  const managed = list.map((f) => (f.managedSide === "home" ? f.home : f.away))
  it("give every club the manager equally often, at home and away in turn, against a different club", () => {
    for (const c of setup.clubs) expect(managed.filter((m) => m === c)).toHaveLength(2)
    expect(list.map((f) => f.managedSide)).toEqual(list.map((_, i) => (i % 2 === 0 ? "home" : "away")))
    expect(list.every((f) => f.home !== f.away)).toBe(true)
    expect(list.map((f) => f.seed)).toEqual(Array.from({ length: 16 }, (_, i) => 5000 + i))
  })
  it("vary the opponent from one cycle of clubs to the next", () => {
    const opp = (i: number) => (list[i]!.managedSide === "home" ? list[i]!.away : list[i]!.home)
    expect(opp(0)).not.toBe(opp(8))
  })
})

describe("an A/B match", () => {
  it("scores the managed team: xG and goal difference, and points", () => {
    const ev = (type: string, team: string, xg?: number) => ({ type, team_id: team, attrs: xg === undefined ? {} : { xg } }) as unknown as DomainEvent
    const events = [ev("shot", "a", 0.4), ev("shot", "b", 0.1), ev("goal", "a"), ev("shot", "a", 0.2)]
    const a = resultOf(events, "a")
    expect({ ...a, xg_diff: Math.round(a.xg_diff * 1e9) / 1e9 }).toEqual({ score: { for: 1, against: 0 }, xg_diff: 0.5, goal_diff: 1, points: 3 })
    expect(resultOf(events, "b").points).toBe(0)
  })
  it("is the same match in every arm until the managed team's first decision", () => {
    const f = fixtures(5000, 1, setup.clubs)[0]!
    const cfg = setup.config(f)
    const none = Effect.runSync(runManaged(cfg, {}, setup.stats))
    const rules = Effect.runSync(runManaged(cfg, { [f.managedSide]: rulesManager }, setup.stats))
    const first = rules.decisions[0]!.tick
    const before = (es: ReadonlyArray<DomainEvent>) => es.filter((e) => e.frame_id <= first)
    expect(before(rules.events).length).toBeGreaterThan(100)
    expect(before(rules.events)).toEqual(before(none.events))
    const played = Effect.runSync(playArm(cfg, f, "rules", () => { throw new Error("no agent") }, setup.stats))
    expect(played.decisions).toEqual(rules.decisions)
  })
})

const row = (seed: number, arm: MatchResult["arm"], xg: number, goals: number): MatchResult => ({
  seed, arm, home: "a", away: "b", managed_side: "home", managed_team: "a", opponent: "b", score: { for: Math.max(0, goals), against: Math.max(0, -goals) },
  xg_diff: xg, goal_diff: goals, points: goals > 0 ? 3 : goals === 0 ? 1 : 0, decisions: []
})
const meta = { generated: "2026-10-10", first_seed: 5000, seeds: 30, arms: ["none", "rules", "agent"] as const, model: "stub", whatif: { seeds: 20, horizon_s: 600 } }

describe("the A/B report", () => {
  const seeds = Array.from({ length: 30 }, (_, i) => 5000 + i)
  const make = (agentGain: number) =>
    summarize(seeds.flatMap((s, i) => [row(s, "none", 0, 0), row(s, "rules", 0.05 * ((i % 3) - 1), 0), row(s, "agent", agentGain + 0.05 * ((i % 3) - 1), i % 4 === 0 ? 1 : 0)]), { ...meta, arms: [...meta.arms] })
  it("says the agent does better only when the interval is above zero, and says so plainly when it is not", () => {
    expect(headline(make(0.2))).toMatch(/^The agent manager does better than the rule-based manager: 0\.200 xG difference per match/)
    expect(headline(make(0))).toMatch(/shows no detectable difference from the rule-based manager/)
    expect(headline(make(-0.2))).toMatch(/does worse than/)
  })
  it("compares every pair of arms on xG difference, goal difference and points", () => {
    const s: AbSummary = make(0.2)
    expect(s.comparisons.map((c) => `${c.a}-${c.b}`)).toEqual(["agent-none", "agent-rules", "rules-none"])
    expect(s.comparisons[0]!.xg_diff.n).toBe(30)
    expect(s.arms.agent!.win_rate.mean).toBeCloseTo(8 / 30, 10)
    const md = markdown(s)
    for (const h of ["# Manager agents: A/B evaluation", "## Paired differences", "## Per arm", "| agent manager − rule-based manager |"]) expect(md).toContain(h)
  })
})

describe("pnpm managers:ab (the CI suite: 4 seeds on the stub model)", () => {
  it("plays every arm, reports, and keeps every decision", () => {
    const dir = mkdtempSync(join(tmpdir(), "ab-"))
    const r = spawnSync("pnpm", ["-s", "managers:ab", "--seeds", "4", "--llm", "stub", "--whatif-seeds", "2", "--whatif-horizon", "60", "--out", dir, "--runs", join(dir, "runs")], { cwd: root, encoding: "utf8" })
    expect(r.status, r.stderr).toBe(0)
    const json = JSON.parse(readFileSync(join(dir, "manager-ab.json"), "utf8")) as AbSummary & { results: unknown[] }
    expect(json.results).toHaveLength(12)
    expect(Object.keys(json.arms)).toEqual(["none", "rules", "agent"])
    const agent = json.arms.agent as unknown as { decisions: { decisions: number; fallback_rate: Record<string, number> } }
    expect(agent.decisions.decisions).toBeGreaterThan(0)
    expect(agent.decisions.fallback_rate).toEqual({ propose: 0, choose: 0, service: 0 })
    expect(json.meta.model).toBe("stub")
    const md = readFileSync(join(dir, "manager-ab.md"), "utf8")
    expect(md).toContain("## The agent manager's decisions")
    expect(md).toContain("not known (no price configured")
    const decisions = readFileSync(join(dir, "runs/decisions.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l) as { arm: string })
    expect(decisions.length).toBe(agent.decisions.decisions + (json.arms.rules as unknown as { decisions: { decisions: number } }).decisions.decisions)
  }, 600_000)
})
```

- [ ] **Step 3: Run them to make sure they fail**

Run: `pnpm --filter @touchline/manager test ab`
Expected: FAIL: `../src/ab/stats.js`, `../src/ab/match.js` … do not exist

- [ ] **Step 4: Write the implementation**

Create `packages/manager/src/ab/cli.ts`:

```ts
/**
 * touchline-managers-ab: the A/B evaluation of the manager agents (spec §5).
 *   pnpm managers:ab --seeds 120 --llm openai        the full run (spends model credit)
 *   pnpm managers:ab --seeds 4 --llm stub --out out/ab-ci   the pipeline on the stub model
 * Writes <out>/manager-ab.md and manager-ab.json (summary and per-match results) and, under out/manager-ab/, every
 * decision made (decisions.jsonl) so any match can be inspected or replayed.
 */
import { mkdirSync, writeFileSync } from "node:fs"
import { join, resolve } from "node:path"
import { Effect } from "effect"
import { cliOptions, exitOnUserError, CliError, integer, oneOf, positiveInteger } from "@touchline/sim"
import { AB_FIRST_SEED, ARMS, type Arm } from "./match.js"
import { markdown, summarize } from "./report.js"
import { runAb, startAgents } from "./run.js"
import { root } from "./setup.js"

const here = (p: string) => resolve(process.env.INIT_CWD ?? process.cwd(), p)
const o = cliOptions("touchline-managers-ab: A/B evaluation of the manager agents against no manager and the rule-based manager", {
  seeds: { default: "120", check: positiveInteger, help: "how many seeds (fixtures)" },
  first: { default: String(AB_FIRST_SEED), check: integer(0, 4294967295), help: "the first seed" },
  arms: { default: ARMS.join(","), help: "arms to run, comma-separated (none, rules, agent)" },
  llm: { default: "stub", check: oneOf(["stub", "openai", "external"]), help: "start the agent service on the stub or OpenAI, or use --agents-url" },
  "agents-url": { default: "http://127.0.0.1:8100/", help: "the agent service when --llm external" },
  "whatif-seeds": { default: "20", check: positiveInteger, help: "forks per tested option" },
  "whatif-horizon": { default: "600", check: positiveInteger, help: "seconds each fork plays" },
  concurrency: { default: "0", check: integer(0, 256), help: "matches at once (0: one per core but one)" },
  out: { default: join(root, "docs/evals"), help: "folder for manager-ab.md and manager-ab.json" },
  runs: { default: join(root, "out/manager-ab"), help: "folder for every decision made (decisions.jsonl)" }
})
const arms = exitOnUserError(() => {
  const list = o.arms.split(",").map((a) => a.trim())
  for (const a of list) if (!(ARMS as ReadonlyArray<string>).includes(a)) throw new CliError(`--arms: unknown arm "${a}" (none, rules, agent)`)
  return ARMS.filter((a) => list.includes(a)) as Arm[]
})

const main = async () => {
  const agents = arms.includes("agent") && o.llm !== "external" ? await startAgents(o.llm as "stub" | "openai") : null
  try {
    const whatif = { seeds: Number(o["whatif-seeds"]), horizonS: Number(o["whatif-horizon"]) }
    const results = await Effect.runPromise(runAb({
      first: Number(o.first), seeds: Number(o.seeds), arms, agentsUrl: agents?.url ?? o["agents-url"], whatif,
      ...(Number(o.concurrency) > 0 ? { concurrency: Number(o.concurrency) } : {}),
      onResult: (r, done, total) => console.log(`${done}/${total} seed ${r.seed} ${r.arm}: ${r.managed_team} ${r.score.for}-${r.score.against} ${r.opponent}, xG diff ${r.xg_diff.toFixed(2)}`)
    }))
    const model = results.flatMap((r) => r.decisions).find((d) => d.manager === "agent")?.model ?? "none"
    const summary = summarize(results, { generated: new Date().toISOString().slice(0, 10), first_seed: Number(o.first), seeds: Number(o.seeds), arms, model, whatif: { seeds: whatif.seeds, horizon_s: whatif.horizonS } })
    const out = here(o.out), runs = here(o.runs)
    mkdirSync(out, { recursive: true })
    mkdirSync(runs, { recursive: true })
    const rows = results.map(({ decisions, ...r }) => ({ ...r, decisions: decisions.length }))
    writeFileSync(join(out, "manager-ab.md"), markdown(summary))
    writeFileSync(join(out, "manager-ab.json"), JSON.stringify({ ...summary, results: rows }, null, 1) + "\n")
    writeFileSync(join(runs, "decisions.jsonl"), results.flatMap((r) => r.decisions.map((d) => JSON.stringify({ seed: r.seed, arm: r.arm, ...d }))).join("\n") + "\n")
    console.log(`wrote ${join(out, "manager-ab.md")}`)
  } finally {
    agents?.stop()
  }
}
main().catch((e) => {
  console.error(e instanceof Error ? e.message : String(e))
  process.exit(1)
})
```

Create `packages/manager/src/ab/match.ts`:

```ts
/**
 * One A/B match (spec §5): a fixture played with the managed team's manager of one arm — none, rules or agent — and
 * the opponent unmanaged. The three arms of a seed are the same match until the first key moment.
 */
import { Effect } from "effect"
import type { DomainEvent, MatchConfig, Side } from "@touchline/sim-core"
import type { Decision } from "@touchline/schema"
import type { StatsModels, XtGrid } from "@touchline/stats"
import type { Manager } from "../decision.js"
import { rulesManager } from "../rules.js"
import { runManaged } from "../run.js"

export const ARMS = ["none", "rules", "agent"] as const
export type Arm = (typeof ARMS)[number]

/** The first A/B seed: clear of calibration (1000+), the realism report (2000+) and the gate (3000+). */
export const AB_FIRST_SEED = 5000

export interface Fixture {
  readonly seed: number
  readonly home: string
  readonly away: string
  readonly managedSide: Side
}

/**
 * `count` fixtures from seed `first`: the managed club cycles through every club, its opponent through the others
 * (shifting each cycle), and the managed team is at home on even seeds and away on odd ones.
 */
export const fixtures = (first: number, count: number, clubs: ReadonlyArray<string>): Fixture[] =>
  Array.from({ length: count }, (_, i) => {
    const n = clubs.length
    const managed = clubs[i % n]!
    const opponent = clubs[(i + 1 + (Math.floor(i / n) % (n - 1))) % n]!
    const managedSide: Side = i % 2 === 0 ? "home" : "away"
    return { seed: first + i, home: managedSide === "home" ? managed : opponent, away: managedSide === "home" ? opponent : managed, managedSide }
  })

export interface MatchResult {
  readonly seed: number
  readonly arm: Arm
  readonly home: string
  readonly away: string
  readonly managed_side: Side
  readonly managed_team: string
  readonly opponent: string
  readonly score: { readonly for: number; readonly against: number }
  /** The managed team's xG minus the opponent's over the match (the engine's shot xG). */
  readonly xg_diff: number
  readonly goal_diff: number
  readonly points: number
  readonly decisions: ReadonlyArray<Decision>
}

/** The managed team's result from a match's events. */
export const resultOf = (events: ReadonlyArray<DomainEvent>, team: string) => {
  const xg = (own: boolean) => events.filter((e) => e.type === "shot" && (e.team_id === team) === own).reduce((a, e) => a + (typeof e.attrs.xg === "number" ? e.attrs.xg : 0), 0)
  const goals = (own: boolean) => events.filter((e) => e.type === "goal" && (e.team_id === team) === own).length
  const f = goals(true), a = goals(false)
  return { score: { for: f, against: a }, xg_diff: xg(true) - xg(false), goal_diff: f - a, points: f > a ? 3 : f === a ? 1 : 0 }
}

/** Play `fixture` with the managed team's `arm` manager (`agent` builds the agent manager). */
export const playArm = (cfg: MatchConfig, fixture: Fixture, arm: Arm, agent: () => Manager, stats: { readonly models: StatsModels; readonly xt: XtGrid | null }): Effect.Effect<MatchResult> =>
  Effect.gen(function* () {
    const manager = arm === "none" ? undefined : arm === "rules" ? rulesManager : agent()
    const run = yield* runManaged(cfg, manager ? { [fixture.managedSide]: manager } : {}, stats)
    const team = cfg[fixture.managedSide].id
    const opponent = cfg[fixture.managedSide === "home" ? "away" : "home"].id
    return { seed: fixture.seed, arm, home: fixture.home, away: fixture.away, managed_side: fixture.managedSide, managed_team: team, opponent, ...resultOf(run.events, team), decisions: run.decisions }
  })
```

Create `packages/manager/src/ab/report.ts`:

```ts
/**
 * The A/B report (spec §5): the managed team's xG difference per match (primary, declared before the run), goal
 * difference and points as paired differences between arms with bootstrap intervals, win rates with Wilson
 * intervals, and what the agent cost and how it behaved. The headline follows the interval, whatever it says.
 */
import type { Decision } from "@touchline/schema"
import type { Arm, MatchResult } from "./match.js"
import { pairedBootstrap, percentile, verdict, wilson, type Interval } from "./stats.js"

export interface AbMeta {
  readonly generated: string
  readonly first_seed: number
  readonly seeds: number
  readonly arms: ReadonlyArray<Arm>
  readonly model: string
  readonly whatif: { readonly seeds: number; readonly horizon_s: number }
}

const COMPARISONS: ReadonlyArray<readonly [Arm, Arm]> = [["agent", "none"], ["agent", "rules"], ["rules", "none"]]
const METRICS = ["xg_diff", "goal_diff", "points"] as const

const bySeed = (results: ReadonlyArray<MatchResult>, arm: Arm) => new Map(results.filter((r) => r.arm === arm).map((r) => [r.seed, r]))

/** Paired differences `a − b` of a metric over the seeds both arms played. */
const paired = (results: ReadonlyArray<MatchResult>, a: Arm, b: Arm, metric: (typeof METRICS)[number]) => {
  const A = bySeed(results, a), B = bySeed(results, b)
  return [...A.keys()].filter((s) => B.has(s)).sort((x, y) => x - y).map((s) => A.get(s)![metric] - B.get(s)![metric])
}

const share = (k: number, n: number) => (n === 0 ? null : k / n)

/** How a set of decisions behaved (one arm's). */
export const decisionStats = (decisions: ReadonlyArray<Decision>, matches: number) => {
  const n = decisions.length
  const called = (k: "propose" | "choose") => decisions.map((d) => d.timings_ms[k]).filter((ms) => ms > 0)
  const total = decisions.map((d) => d.timings_ms.propose + d.timings_ms.whatif + d.timings_ms.choose)
  const agentOptions = decisions.flatMap((d) => d.options.filter((o) => o.source === "agent"))
  const tested = decisions.filter((d) => d.options.some((o) => o.index > 0 && o.xg_diff_vs_no_change !== null))
  const bestPick = tested.filter((d) => {
    const best = d.options.filter((o) => o.xg_diff_vs_no_change !== null && !o.untested).reduce((a, o) => (o.xg_diff_vs_no_change!.mean > a.xg_diff_vs_no_change!.mean ? o : a))
    return d.pick === best.index
  })
  const sum = (f: (d: Decision) => number) => decisions.reduce((a, d) => a + f(d), 0)
  return {
    decisions: n,
    per_match: share(n, matches),
    no_change_rate: share(decisions.filter((d) => d.pick === 0).length, n),
    fallback_rate: {
      propose: share(decisions.filter((d) => d.fallback === "propose").length, n),
      choose: share(decisions.filter((d) => d.fallback === "choose").length, n),
      service: share(decisions.filter((d) => d.fallback === "service").length, n)
    },
    dropped_option_rate: share(agentOptions.filter((o) => o.dropped.length > 0).length, agentOptions.length),
    best_pick_rate: share(bestPick.length, tested.length),
    latency_ms: {
      propose: { p50: percentile(called("propose"), 0.5), p95: percentile(called("propose"), 0.95) },
      choose: { p50: percentile(called("choose"), 0.5), p95: percentile(called("choose"), 0.95) },
      decision: { p50: percentile(total, 0.5), p95: percentile(total, 0.95) }
    },
    tokens_per_match: { in: share(sum((d) => d.tokens.in), matches), out: share(sum((d) => d.tokens.out), matches) },
    cost_usd_per_match: share(sum((d) => d.cost_usd), matches)
  }
}

export const summarize = (results: ReadonlyArray<MatchResult>, meta: AbMeta) => {
  const arms = meta.arms.filter((a) => results.some((r) => r.arm === a))
  const perArm = Object.fromEntries(arms.map((arm) => {
    const rs = results.filter((r) => r.arm === arm)
    const avg = (m: (typeof METRICS)[number]) => rs.reduce((a, r) => a + r[m], 0) / rs.length
    return [arm, {
      matches: rs.length,
      xg_diff: avg("xg_diff"), goal_diff: avg("goal_diff"), points: avg("points"),
      win_rate: wilson(rs.filter((r) => r.points === 3).length, rs.length),
      draws: rs.filter((r) => r.points === 1).length, losses: rs.filter((r) => r.points === 0).length,
      ...(arm === "none" ? {} : { decisions: decisionStats(rs.flatMap((r) => r.decisions), rs.length) })
    }]
  }))
  const comparisons = COMPARISONS.filter(([a, b]) => arms.includes(a) && arms.includes(b)).map(([a, b]) => {
    const m = Object.fromEntries(METRICS.map((k) => [k, pairedBootstrap(paired(results, a, b, k))])) as Record<(typeof METRICS)[number], Interval>
    return { a, b, ...m, verdict: verdict(m.xg_diff) }
  })
  return { meta, primary_metric: "xg_diff" as const, arms: perArm, comparisons }
}

export type AbSummary = ReturnType<typeof summarize>

const f2 = (x: number | null) => (x === null || Number.isNaN(x) ? "–" : x.toFixed(2))
const f3 = (x: number) => (Number.isNaN(x) ? "–" : x.toFixed(3))
const pct = (x: number | null) => (x === null || Number.isNaN(x) ? "–" : `${(100 * x).toFixed(0)} %`)
const ci = (i: Interval, f = f3) => `${f(i.mean)} [${f(i.lo)}, ${f(i.hi)}]`
const ms = (x: number) => (Number.isNaN(x) ? "–" : `${(x / 1000).toFixed(1)} s`)
const NAMES: Record<Arm, string> = { none: "no manager", rules: "rule-based manager", agent: "agent manager" }

/** The headline: the agent against the rules if both ran, else the first comparison; in the interval's words. */
export const headline = (s: AbSummary): string => {
  const c = s.comparisons.find((x) => x.a === "agent" && x.b === "rules") ?? s.comparisons[0]
  if (!c) return "No comparison: fewer than two arms ran."
  const words = c.verdict === "better" ? "does better than" : c.verdict === "worse" ? "does worse than" : "shows no detectable difference from"
  return `The ${NAMES[c.a]} ${words} the ${NAMES[c.b]}: ${f3(c.xg_diff.mean)} xG difference per match (95 % interval ${f3(c.xg_diff.lo)} to ${f3(c.xg_diff.hi)}, ${c.xg_diff.n} paired matches).`
}

export const markdown = (s: AbSummary): string => {
  const m = s.meta
  const out = [
    "# Manager agents: A/B evaluation",
    "",
    `Generated ${m.generated} by \`pnpm managers:ab\`. Seeds ${m.first_seed}–${m.first_seed + m.seeds - 1} (${m.seeds}); arms: ${m.arms.join(", ")}; agent model: ${m.model}; options tested on ${m.whatif.seeds} forks over ${m.whatif.horizon_s / 60} minutes.`,
    "",
    "Each seed is one fixture played once per arm. Only the managed team's manager changes between arms; the opponent never has one, and the arms are the same match until the first key moment. The primary metric, declared before the run, is the managed team's xG difference per match (the engine's shot xG). Intervals are 95 %: paired bootstrap (10,000 resamples) for differences, Wilson for win rates.",
    "",
    `**${headline(s)}**`,
    "",
    "## Paired differences",
    "",
    "| Comparison | xG difference | Goal difference | Points | Verdict (xG) |",
    "|---|---|---|---|---|",
    ...s.comparisons.map((c) => `| ${NAMES[c.a]} − ${NAMES[c.b]} | ${ci(c.xg_diff)} | ${ci(c.goal_diff)} | ${ci(c.points)} | ${c.verdict} |`),
    "",
    "## Per arm",
    "",
    "| Arm | Matches | xG difference | Goal difference | Points per match | Win rate | Draws | Losses |",
    "|---|---|---|---|---|---|---|---|",
    ...Object.entries(s.arms).map(([arm, a]) => `| ${NAMES[arm as Arm]} | ${a.matches} | ${f3(a.xg_diff)} | ${f3(a.goal_diff)} | ${f2(a.points)} | ${ci(a.win_rate, (x) => pct(x))} | ${a.draws} | ${a.losses} |`)
  ]
  for (const arm of ["agent", "rules"] as const) {
    const d = (s.arms[arm] as { decisions?: ReturnType<typeof decisionStats> } | undefined)?.decisions
    if (!d) continue
    out.push("", `## The ${NAMES[arm]}'s decisions`, "")
    out.push(`- ${d.decisions} decisions (${f2(d.per_match)} per match); "no change" picked ${pct(d.no_change_rate)}.`)
    if (arm === "agent") {
      const priced = d.cost_usd_per_match !== null && d.cost_usd_per_match > 0
      out.push(
        `- Fallbacks: propose ${pct(d.fallback_rate.propose)}, choose ${pct(d.fallback_rate.choose)}, service ${pct(d.fallback_rate.service)} of decisions.`,
        `- Options with orders the engine refused: ${pct(d.dropped_option_rate)}. Picked the option with the best what-if xG: ${pct(d.best_pick_rate)}.`,
        `- Latency: propose p50 ${ms(d.latency_ms.propose.p50)} / p95 ${ms(d.latency_ms.propose.p95)}; choose p50 ${ms(d.latency_ms.choose.p50)} / p95 ${ms(d.latency_ms.choose.p95)}; whole decision p50 ${ms(d.latency_ms.decision.p50)} / p95 ${ms(d.latency_ms.decision.p95)}.`,
        `- Tokens per match: ${f2(d.tokens_per_match.in)} in, ${f2(d.tokens_per_match.out)} out. Cost per match: ${priced ? `$${d.cost_usd_per_match!.toFixed(4)}` : "not known (no price configured: TOUCHLINE_PRICE_USD_PER_MTOK)"}.`
      )
    }
  }
  return out.join("\n") + "\n"
}
```

Create `packages/manager/src/ab/run.ts`:

```ts
/**
 * Running the A/B evaluation (spec §5): every fixture once per arm, each match in its own worker thread, and the agent
 * service started for the run (stub or OpenAI; the model key stays with the Python service) or reached at a URL.
 */
import { spawn, type ChildProcess } from "node:child_process"
import { availableParallelism } from "node:os"
import { createServer } from "node:net"
import { Worker } from "node:worker_threads"
import { Effect } from "effect"
import { fixtures, type Arm, type MatchResult } from "./match.js"
import { loadSetup, root } from "./setup.js"
import type { AbJob } from "./worker.js"

export interface AbOptions {
  readonly first: number
  readonly seeds: number
  readonly arms: ReadonlyArray<Arm>
  readonly agentsUrl: string
  readonly whatif: { readonly seeds: number; readonly horizonS: number }
  readonly concurrency?: number
  readonly onResult?: (r: MatchResult, done: number, total: number) => void
}

const playInWorker = (job: AbJob) =>
  Effect.tryPromise(
    () =>
      new Promise<MatchResult>((resolve, reject) => {
        const w = new Worker(new URL("./worker.ts", import.meta.url), { workerData: job, execArgv: ["--import", "tsx"] })
        w.once("message", (m: { ok?: MatchResult; error?: string }) => {
          void w.terminate()
          if (m.ok) resolve(m.ok)
          else reject(new Error(m.error ?? "worker failed"))
        })
        w.once("error", reject)
      })
  )

/** Every fixture once per arm; fails only if a match cannot be played at all (managers never fail a match). */
export const runAb = (opts: AbOptions) =>
  Effect.gen(function* () {
    const list = fixtures(opts.first, opts.seeds, loadSetup().clubs)
    const jobs: AbJob[] = list.flatMap((fixture) => opts.arms.map((arm) => ({ fixture, arm, agentsUrl: opts.agentsUrl, whatif: opts.whatif })))
    let done = 0
    return yield* Effect.forEach(jobs, (job) => playInWorker(job).pipe(Effect.tap((r) => Effect.sync(() => opts.onResult?.(r, ++done, jobs.length)))), {
      concurrency: opts.concurrency ?? Math.max(1, availableParallelism() - 1)
    })
  })

const freePort = () =>
  new Promise<number>((ok) => {
    const s = createServer().listen(0, "127.0.0.1", () => {
      const port = (s.address() as { port: number }).port
      s.close(() => ok(port))
    })
  })

/** Start the agent service on `llm` ("stub" or "openai") for the run; its URL and a stop function. */
export const startAgents = async (llm: "stub" | "openai"): Promise<{ readonly url: string; readonly stop: () => void }> => {
  const port = await freePort()
  const child: ChildProcess = spawn("uv", ["run", "--project", "services/agents", "touchline-agents", "--port", String(port)], {
    cwd: root, env: { ...process.env, TOUCHLINE_LLM: llm }, detached: true, stdio: "ignore"
  })
  const url = `http://127.0.0.1:${port}/`
  for (let i = 0; i < 300; i++) {
    if (await fetch(`${url}.well-known/agent-card.json`).then((r) => r.ok, () => false)) return { url, stop: () => child.pid && process.kill(-child.pid, "SIGTERM") }
    await new Promise((r) => setTimeout(r, 200))
  }
  if (child.pid) process.kill(-child.pid, "SIGTERM")
  throw new Error("the agent service did not start (is uv installed, and for openai is OPENAI_API_KEY set in .env.local?)")
}
```

Create `packages/manager/src/ab/setup.ts`:

```ts
/** What every A/B match needs, loaded from the repo: the league, the calibrated params and the stats models. */
import { readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import type { League } from "@touchline/league"
import { paramsFromJson, type MatchConfig } from "@touchline/sim-core"
import { modelsFromJson, xtGridFromJson } from "@touchline/stats"
import type { Fixture } from "./match.js"

export const root = join(dirname(fileURLToPath(import.meta.url)), "../../../..")
const json = (p: string) => JSON.parse(readFileSync(join(root, p), "utf8"))

export const loadSetup = () => {
  const league = json("data/league/league.json") as League
  const params = paramsFromJson(json("data/params/touchline-params.json"))
  const stats = { models: modelsFromJson(json("data/params/stats-models.json")), xt: xtGridFromJson(json("data/params/xt-grid.json")) }
  const config = (f: Fixture): MatchConfig => ({
    matchId: `ab-${f.seed}`, seed: f.seed, kickoffTime: "2026-10-18T14:00:00.000Z",
    home: league.clubs.find((c) => c.id === f.home)!, away: league.clubs.find((c) => c.id === f.away)!, params, dt: 0.1
  })
  return { league, clubs: league.clubs.map((c) => c.id), stats, config }
}
```

Create `packages/manager/src/ab/stats.ts`:

```ts
/**
 * The A/B statistics (spec §5): a seeded paired bootstrap for differences between arms, Wilson intervals for win
 * rates, and percentiles for latency. Deterministic: the same numbers and seed give the same intervals.
 */
import { Rng, seedRng } from "@touchline/sim-core"

export const BOOTSTRAP_RESAMPLES = 10_000
export const BOOTSTRAP_SEED = 4242

export interface Interval {
  readonly mean: number
  readonly lo: number
  readonly hi: number
  readonly n: number
}

const mean = (xs: ReadonlyArray<number>) => xs.reduce((a, b) => a + b, 0) / xs.length

/** The value below which a share `p` of the sorted numbers lie (linear interpolation). */
export const percentile = (xs: ReadonlyArray<number>, p: number): number => {
  if (xs.length === 0) return NaN
  const s = [...xs].sort((a, b) => a - b)
  const at = p * (s.length - 1)
  const lo = Math.floor(at), hi = Math.ceil(at)
  return s[lo]! + (s[hi]! - s[lo]!) * (at - lo)
}

/** Mean of paired differences with a 95 % percentile bootstrap interval (resampling the pairs). */
export const pairedBootstrap = (diffs: ReadonlyArray<number>, resamples = BOOTSTRAP_RESAMPLES, seed = BOOTSTRAP_SEED): Interval => {
  const n = diffs.length
  if (n === 0) return { mean: NaN, lo: NaN, hi: NaN, n: 0 }
  const rng = new Rng(seedRng(seed))
  const means: number[] = []
  for (let b = 0; b < resamples; b++) {
    let sum = 0
    for (let i = 0; i < n; i++) sum += diffs[Math.floor(rng.uniform() * n)]!
    means.push(sum / n)
  }
  return { mean: mean(diffs), lo: percentile(means, 0.025), hi: percentile(means, 0.975), n }
}

/** A share with its 95 % Wilson interval. */
export const wilson = (successes: number, n: number, z = 1.96): Interval => {
  if (n === 0) return { mean: NaN, lo: NaN, hi: NaN, n: 0 }
  const p = successes / n
  const d = 1 + (z * z) / n
  const centre = (p + (z * z) / (2 * n)) / d
  const half = (z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n))) / d
  return { mean: p, lo: centre - half, hi: centre + half, n }
}

/** "better", "worse" or "no detectable difference": whether the interval excludes zero, and on which side. */
export const verdict = (i: Interval): "better" | "worse" | "no detectable difference" => (i.lo > 0 ? "better" : i.hi < 0 ? "worse" : "no detectable difference")
```

Create `packages/manager/src/ab/worker.ts`:

```ts
/** Plays one A/B match off the main thread (ab/cli.ts). */
import { parentPort, workerData } from "node:worker_threads"
import { Effect } from "effect"
import { a2aSender } from "@touchline/agent-gateway"
import { agentManager } from "../agent.js"
import { playArm, type Arm, type Fixture } from "./match.js"
import { loadSetup } from "./setup.js"

export interface AbJob {
  readonly fixture: Fixture
  readonly arm: Arm
  readonly agentsUrl: string
  readonly whatif: { readonly seeds: number; readonly horizonS: number }
}

const job = workerData as AbJob
const setup = loadSetup()
Effect.runPromise(playArm(setup.config(job.fixture), job.fixture, job.arm, () => agentManager(a2aSender(job.agentsUrl), { whatif: job.whatif }), setup.stats)).then(
  (ok) => parentPort!.postMessage({ ok }),
  (e) => parentPort!.postMessage({ error: e instanceof Error ? e.message : String(e) })
)
```

Apply this change to `packages/manager/src/index.ts`, `packages/manager/src/run.ts` (from the repository root):

```bash
git apply <<'PATCH'
diff --git a/packages/manager/src/index.ts b/packages/manager/src/index.ts
index 698b6dc..c12ba65 100644
--- a/packages/manager/src/index.ts
+++ b/packages/manager/src/index.ts
@@ -7,3 +7,6 @@ export * from "./situation.js"
 export * from "./whatif.js"
 export * from "./agent.js"
 export * from "./write.js"
+export * from "./ab/match.js"
+export * from "./ab/report.js"
+export * from "./ab/stats.js"
diff --git a/packages/manager/src/run.ts b/packages/manager/src/run.ts
index 606ee4c..9b97679 100644
--- a/packages/manager/src/run.ts
+++ b/packages/manager/src/run.ts
@@ -29,15 +29,16 @@ export const managedSteps = (config: MatchConfig, managers: Managers, opts: Mana
   const cfg = managedConfig(config, managers)
   const sides = SIDES.filter((s) => managers[s] !== undefined)
   return Stream.suspend(() => {
-    const watch = new MatchWatch(cfg, opts.models, opts.xt)
+    // The stats engine is only needed to show managers the match; a match with none skips it.
+    const watch = sides.length > 0 ? new MatchWatch(cfg, opts.models, opts.xt) : null
     return Stream.unfold({ state: initMatch(cfg), memory: NO_MOMENTS as MomentMemory }, ({ state, memory }) =>
       Effect.gen(function* () {
         if (isFinished(state)) return undefined
         const r = step(state)
-        watch.add(r)
+        watch?.add(r)
         const k = keyMoment(r.state, r.events, memory)
         let next: MatchState = r.state
-        if (k.reasons.length > 0 && sides.length > 0) {
+        if (k.reasons.length > 0 && watch) {
           // Both managers decide from the same paused state; their orders apply afterwards.
           const decisions = yield* Effect.forEach(sides, (side) => {
             const situation = situationAt(r.state, side, k.reasons, watch)
PATCH
```

- [ ] **Step 5: Run the tests**

Run: `pnpm --filter @touchline/manager test`
Expected: `Tests  52 passed (52)` (the CI suite plays 12 matches on the stub model, about 40 s)

Run: `pnpm turbo run typecheck --force`
Expected: `Tasks:    13 successful, 13 total`

- [ ] **Step 6: Commit**

```bash
git add package.json packages/manager
git commit -m "feat(manager): pnpm managers:ab — the A/B evaluation: rotating fixtures from seed 5000, each played with no manager, the rule-based manager and the agent manager for one team; paired bootstrap and Wilson intervals; a report whose headline follows the interval, with the agent's fallbacks, refused orders, latency, tokens and cost; every decision kept for inspection

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 10: Manager decisions in the fan app

The API reads a managed match's `decisions.jsonl`: each decision becomes a cue at its tick (template `manager_decision`, English, Ruling 9; headline from the pick, body the manager's reason; no model writes it), the match summary names the managers, and `GetDecisions` returns the decisions the session has reached, never later ones. The fan app opens the cards of a moment when its cue arrives — both teams' side by side when both decided then (every option with its re-simulated gain over no change, the pick, the reason, a fallback note; they close after 12 s) — keeps a strip with one marker per moment that reopens them (minutes as a fan reads them: "45+3'", "90+2'"; markers too close together drop to a second row), opens the cards from the feed's "Why?", and names a managed match's managers in the match list. (A browser check of a stub-managed match found the two-team moment, the overlapping markers and the stoppage-time minutes; the tests pin each.)

**Files:**
- Modify: `packages/rpc/src/contracts.ts` (`MatchSummary.managers`, RPC `GetDecisions`, `decisionKey`); test `packages/rpc/test/contracts.test.ts`
- Create: `apps/api/src/decisions.ts`; modify `apps/api/src/library.ts`, `apps/api/src/server.ts`; test `apps/api/test/decisions.test.ts`
- Create: `apps/web/src/Decisions.tsx`; modify `apps/web/src/Watch.tsx`, `apps/web/src/client.ts`, `apps/web/src/MatchList.tsx`, `apps/web/src/i18n.ts`; tests `apps/web/test/decisions.test.tsx`, `apps/web/test/fake-client.ts`

**Interfaces:**
- Produces: `MatchSummary.managers: { home: string | null; away: string | null } | null`; RPC `GetDecisions({ session_id }) → Decision[]`; `decisionKey(d) = "decision-<tick>-<side>"` (`@touchline/rpc`); `DECISIONS_FILE`, `readDecisionLog(dir)`, `decisionCues(info, decisions)` (`apps/api`); `LibraryMatch.decisions`; `TouchlineClient.decisions(sessionId)`; `DecisionStrip({ match, decisions, open: tick | null, onOpen(tick), lang })`, `DecisionCard({ match, decision, all, onClose, lang })`, `minuteLabel(decision, all)`, `DECISION_CARD_MS = 12_000` (`apps/web`); i18n keys `decisions`, `picked`, `untested`, `xgVsNoChange`, `rHalfTime`, `rAfterGoal`, `rMinute60`, `rMinute75`, `fallbackNote`, `managed`, `srcAgent`, `srcRules`, `srcNoChange` in English, Spanish and Hindi
- Consumes: Task 2 (`Decision`, `decodeDecision`), Task 8 (the run folder's `decisions.jsonl` and `manifest.managers`).

- [ ] **Step 1: Write the failing tests**

Create `apps/api/test/decisions.test.ts`:

```ts
import { cpSync, readFileSync, writeFileSync } from "node:fs"
import { createServer } from "node:net"
import { join } from "node:path"
import { NodeSocket } from "@effect/platform-node"
import { Effect, Layer } from "effect"
import { RpcClient, RpcSerialization } from "effect/rpc"
import type { RpcClientError } from "effect/rpc/RpcClientError"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { TouchlineRpcs } from "@touchline/rpc"
import type { Decision } from "@touchline/schema"
import { pickCues } from "../src/cues.js"
import { readMatch, type LibraryMatch } from "../src/library.js"
import { RPC_PATH, serverLayer } from "../src/server.js"
import { league, makeLibrary, MATCH_ID } from "./fixture.js"

const estimate = (mean: number, se: number) => ({ mean, se })
const decision = (tick: number, side: "home" | "away", pick: number): Decision => ({
  match_id: MATCH_ID, tick, minute: side === "home" ? 60 : 75, side, team_id: side === "home" ? "northwick" : "larkspur", manager: side === "home" ? "agent" : "rules",
  reasons: [side === "home" ? "minute_60" : "minute_75"], situation_hash: "h",
  options: [
    { index: 0, label: "No change", source: "no_change", orders: [], rationale: null, xg_diff_vs_no_change: estimate(0, 0), goal_diff_vs_no_change: estimate(0, 0), untested: false, dropped: [] },
    { index: 1, label: "Press higher", source: "agent", orders: [{ kind: "style", setting: "pressIntensity", value: 1 }], rationale: "Win it back.", xg_diff_vs_no_change: estimate(0.12, 0.05), goal_diff_vs_no_change: estimate(0.05, 0.04), untested: false, dropped: [] }
  ],
  pick, reason: pick === 1 ? "Press higher added 0.12 xG over no change." : "No rule applies.", orders_applied: pick === 1 ? [{ kind: "style", setting: "pressIntensity", value: 1 }] : [],
  fallback: null, timings_ms: { propose: 0, whatif: 0, choose: 0 }, tokens: { in: 0, out: 0 }, cost_usd: 0, model: "stub"
})
const DECISIONS = [decision(36000, "home", 1), decision(45000, "away", 0)]

let match: LibraryMatch
let port: number
let stop: () => void
beforeAll(async () => {
  const lib = await makeLibrary()
  // The library's match, made a managed one: its decision log and its managers in the manifest.
  const dir = join(lib.dir, "..", "managed")
  cpSync(lib.run, dir, { recursive: true })
  const manifest = JSON.parse(readFileSync(join(dir, "manifest.json"), "utf8"))
  writeFileSync(join(dir, "manifest.json"), JSON.stringify({ ...manifest, managers: { home: "agent", away: "rules", decisions: 2 } }))
  writeFileSync(join(dir, "decisions.jsonl"), DECISIONS.map((d) => JSON.stringify(d) + "\n").join(""))
  match = readMatch(dir, league)
  port = await new Promise<number>((ok) => {
    const s = createServer().listen(0, "127.0.0.1", () => {
      const p = (s.address() as { port: number }).port
      s.close(() => ok(p))
    })
  })
  const fiber = Effect.runFork(Layer.launch(serverLayer({ library: new Map([[MATCH_ID, match]]), port })))
  stop = () => fiber.interruptUnsafe()
  for (let i = 0; i < 100 && !(await fetch(`http://127.0.0.1:${port}/health`).then((r) => r.ok, () => false)); i++) await new Promise((r) => setTimeout(r, 50))
}, 120_000)
afterAll(() => stop?.())

const client = <A, E>(f: (c: RpcClient.FromGroup<typeof TouchlineRpcs, RpcClientError>) => Effect.Effect<A, E>) =>
  Effect.runPromise(
    Effect.gen(function* () {
      return yield* f(yield* RpcClient.make(TouchlineRpcs))
    }).pipe(
      Effect.scoped,
      Effect.provide(RpcClient.layerProtocolSocket().pipe(Layer.provide(NodeSocket.layerWebSocket(`ws://127.0.0.1:${port}${RPC_PATH}`)), Layer.provide(RpcSerialization.layerJson)))
    )
  )

describe("a managed match in the library", () => {
  it("names its managers and keeps its decisions", () => {
    expect(match.info.managers).toEqual({ home: "agent", away: "rules" })
    expect(match.decisions).toEqual(DECISIONS)
  })
  it("shows each decision as a cue at its moment: the pick and the manager's reason, in English", () => {
    const cues = pickCues(match.cues, { mode: "casual", lang: "es", club: null }).filter((c) => c.display.template === "manager_decision")
    expect(cues.map((c) => [c.anchor.frame_to, c.segment.lang, c.text?.headline, c.text?.body, c.evidence])).toEqual([
      [36000, "en", "Northwick Mariners: Press higher", "Press higher added 0.12 xG over no change.", ["decision-36000-home"]],
      [45000, "en", "Larkspur City keep their plan", "No rule applies.", ["decision-45000-away"]]
    ])
    expect(cues[0]!.data).toEqual({ "decision.options": 1, "decision.xg_gain": 0.12 })
  })
})

describe("GetDecisions", () => {
  it("answers with the decisions the session has reached, never later ones", async () => {
    const at = (minute: number) =>
      client((c) =>
        Effect.gen(function* () {
          const s = yield* c.StartSession({ match_id: MATCH_ID, speed: 1, from_minute: minute, live: false })
          yield* c.Control({ session_id: s.session_id, action: "pause", speed: null })
          return (yield* c.GetDecisions({ session_id: s.session_id })).map((d) => d.tick)
        })
      )
    expect(await at(0)).toEqual([])
    expect(await at(70)).toEqual([36000])
    expect(await at(85)).toEqual([36000, 45000])
  }, 120_000)
})
```

Create `apps/web/test/decisions.test.tsx`:

```tsx
import { act, render, screen, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, describe, expect, it, vi } from "vitest"
import type { Cue, Decision } from "@touchline/schema"
import { App } from "../src/App.js"
import { MatchList } from "../src/MatchList.js"
import { minuteLabel } from "../src/Decisions.js"
import { DECISION_CARD_MS } from "../src/Watch.js"
import { fakeClient, MATCH } from "./fake-client.js"

const estimate = (mean: number, se: number) => ({ mean, se })
const DECISION: Decision = {
  match_id: "lib-costly_error-1", tick: 36000, minute: 60, side: "home", team_id: "northwick", manager: "agent", reasons: ["minute_60"], situation_hash: "h",
  options: [
    { index: 0, label: "No change", source: "no_change", orders: [], rationale: null, xg_diff_vs_no_change: estimate(0, 0), goal_diff_vs_no_change: estimate(0, 0), untested: false, dropped: [] },
    { index: 1, label: "Press higher", source: "agent", orders: [{ kind: "style", setting: "pressIntensity", value: 1 }], rationale: "Win it back.", xg_diff_vs_no_change: estimate(0.12, 0.05), goal_diff_vs_no_change: estimate(0.05, 0.04), untested: false, dropped: [] },
    { index: 2, label: "Fresh legs", source: "agent", orders: [{ kind: "sub", off: "p-nor-09", on: "p-nor-19" }], rationale: "Tired.", xg_diff_vs_no_change: null, goal_diff_vs_no_change: null, untested: true, dropped: [] }
  ],
  pick: 1, reason: "Press higher added 0.12 xG over no change.", orders_applied: [{ kind: "style", setting: "pressIntensity", value: 1 }], fallback: null,
  timings_ms: { propose: 4000, whatif: 6000, choose: 3000 }, tokens: { in: 2000, out: 200 }, cost_usd: 0, model: "openai:gpt-6.1-sol"
}
const cue = (d: Decision): Cue => ({
  cue_id: `decision-${d.tick}-${d.side}-casual.en.neutral`, schema: "touchline.cue/1", match_id: d.match_id, moment_id: `decision-${d.tick}-${d.side}`,
  anchor: { frame_from: d.tick, frame_to: d.tick, clock: "60:00" }, display: { slot: "lower_third", priority: 2, ttl_ms: 12000, template: "manager_decision" },
  segment: { mode: "casual", lang: "en", club: null }, text: { headline: "Northwick Mariners: Press higher", body: d.reason }, data: {}, evidence: [`decision-${d.tick}-${d.side}`], verified: true
})

const watching = async (decisions: ReadonlyArray<Decision> = [DECISION]) => {
  const client = fakeClient({ decisions })
  const user = userEvent.setup(vi.isFakeTimers() ? { advanceTimers: vi.advanceTimersByTime } : {})
  render(<App client={client} />)
  await user.click(await screen.findByRole("button", { name: "Watch" }))
  await screen.findByRole("img", { name: "Northwick Mariners – Larkspur City" })
  return { client, user }
}

afterEach(() => vi.useRealTimers())

describe("a manager's decision", () => {
  it("opens its card when its cue arrives: every option with its re-simulated gain, the pick and the reason", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    const { client } = await watching()
    act(() => client.push({ kind: "cue", cue: cue(DECISION) }))
    const card = await screen.findByRole("dialog", { name: "Northwick Mariners · 60'" })
    expect(client.calls).toContain("decisions s1")
    const rows = within(card).getAllByRole("listitem")
    expect(rows.map((r) => r.textContent)).toEqual([
      "No change (no change)+0.00 ± 0.00",
      "Press higher (agent)Picked+0.12 ± 0.05",
      "Fresh legs (agent)not tested"
    ])
    expect(rows[1]!.getAttribute("aria-current")).toBe("true")
    expect(within(card).getByText("Press higher added 0.12 xG over no change.")).toBeTruthy()
    expect(within(card).getByText("60 minutes")).toBeTruthy()
    act(() => void vi.advanceTimersByTime(DECISION_CARD_MS))
    expect(screen.queryByRole("dialog")).toBeNull()
  })
  it("stays on the strip, which reopens the card until it is closed", async () => {
    const { client, user } = await watching()
    act(() => client.push({ kind: "cue", cue: cue(DECISION) }))
    await screen.findByRole("dialog")
    await user.click(screen.getByRole("button", { name: "Close" }))
    expect(screen.queryByRole("dialog")).toBeNull()
    await user.click(within(screen.getByRole("navigation", { name: "Manager decisions" })).getByRole("button", { name: "60' NOR" }))
    expect(screen.getByRole("dialog", { name: "Northwick Mariners · 60'" })).toBeTruthy()
  })
  it("opens its card from the feed's Why? instead of the evidence drawer", async () => {
    const { client, user } = await watching()
    act(() => client.push({ kind: "cue", cue: cue(DECISION) }))
    await user.click(await screen.findByRole("button", { name: "Close" }))
    await user.click(within(screen.getByRole("list", { name: "feed" })).getByRole("button", { name: "Why?" }))
    expect(await screen.findByRole("dialog", { name: "Northwick Mariners · 60'" })).toBeTruthy()
    expect(client.calls.some((c) => c.startsWith("evidence"))).toBe(false)
  })
  it("says when the manager agent could not decide", async () => {
    const fell = { ...DECISION, pick: 0, fallback: "choose" as const, reason: "The manager agent could not choose; the previous plan stays." }
    const { client } = await watching([fell])
    act(() => client.push({ kind: "cue", cue: cue(fell) }))
    expect(await screen.findByText("The manager agent could not decide here; this is its fallback.")).toBeTruthy()
  })
})

describe("a moment when both managers decided", () => {
  it("has one marker naming both teams, and opens both cards", async () => {
    const away: Decision = { ...DECISION, side: "away", team_id: "larkspur", pick: 0, reason: "No option did better than keeping things as they are." }
    const { client, user } = await watching([DECISION, away])
    act(() => client.push({ kind: "cue", cue: cue(DECISION) }))
    act(() => client.push({ kind: "cue", cue: cue(away) }))
    expect(await screen.findByRole("dialog", { name: "Larkspur City · 60'" })).toBeTruthy()
    expect(screen.getByRole("dialog", { name: "Northwick Mariners · 60'" })).toBeTruthy()
    await user.click(screen.getAllByRole("button", { name: "Close" })[0]!)
    expect(screen.queryAllByRole("dialog")).toEqual([])
    await user.click(within(screen.getByRole("navigation", { name: "Manager decisions" })).getByRole("button", { name: "60' NOR·LAR" }))
    expect(screen.getAllByRole("dialog")).toHaveLength(2)
  })
})

describe("a decision's minute", () => {
  it("reads added time as a fan does: 45+3' before half time, 90+2' after", () => {
    const at = (tick: number, minute: number, reasons: Decision["reasons"] = ["after_goal"]) => ({ ...DECISION, tick, minute, reasons })
    const all = [at(29000, 45, ["half_time"])]
    expect(minuteLabel(at(28500, 47.6), all)).toBe("45+3'")
    expect(minuteLabel(at(29000, 45, ["half_time"]), all)).toBe("45'")
    expect(minuteLabel(at(31000, 48.2), all)).toBe("48'")
    expect(minuteLabel(at(57000, 91.4), all)).toBe("90+2'")
    expect(minuteLabel(at(1000, 1.2), [])).toBe("1'")
  })
})

describe("the match list", () => {
  it("names a managed match's managers", () => {
    render(<MatchList matches={[{ ...MATCH, managers: { home: "agent", away: "rules" } }]} lang="en" onWatch={() => {}} />)
    expect(screen.getByText(/Managers: agent v rules/)).toBeTruthy()
  })
})
```

Apply this change to `apps/web/test/fake-client.ts`, `packages/rpc/test/contracts.test.ts` (from the repository root):

```bash
git apply <<'PATCH'
diff --git a/apps/web/test/fake-client.ts b/apps/web/test/fake-client.ts
index d843192..2413536 100644
--- a/apps/web/test/fake-client.ts
+++ b/apps/web/test/fake-client.ts
@@ -1,13 +1,13 @@
 /** A TouchlineClient for component tests: canned answers, and ticks the test pushes to every watcher. */
 import type { Evidence, MatchInfo, MatchSummary, OpsReport, Playback, RecapView, StudioTick, Tick, WhatIfClip } from "@touchline/rpc"
-import type { Segment } from "@touchline/schema"
+import type { Decision, Segment } from "@touchline/schema"
 import type { TouchlineClient } from "../src/client.js"
 
 export const team = (id: string, side: "home" | "away", name: string, color: string) => ({ id, name, short: id.slice(0, 3).toUpperCase(), side, kit: { primary: color, secondary: "#ffffff" } })
 
 export const MATCH: MatchSummary = {
   match_id: "lib-costly_error-1", scenario: "costly_error", seed: 1, home: team("northwick", "home", "Northwick Mariners", "#1d4ed8"), away: team("larkspur", "away", "Larkspur City", "#dc2626"),
-  score: { home: 1, away: 2 }, fps: 10, frames: 58000, segments: ["casual.en.neutral"], model: "stub"
+  score: { home: 1, away: 2 }, fps: 10, frames: 58000, segments: ["casual.en.neutral"], model: "stub", managers: null
 }
 export const INFO: MatchInfo = {
   ...MATCH,
@@ -35,7 +35,7 @@ export interface FakeClient extends TouchlineClient {
   pushGraphics(t: Tick): void
 }
 
-export const fakeClient = (o: { matches?: ReadonlyArray<MatchSummary>; evidence?: Evidence; recap?: RecapView; ops?: OpsReport; whatIf?: () => Promise<WhatIfClip> } = {}): FakeClient => {
+export const fakeClient = (o: { matches?: ReadonlyArray<MatchSummary>; evidence?: Evidence; recap?: RecapView; ops?: OpsReport; whatIf?: () => Promise<WhatIfClip>; decisions?: ReadonlyArray<Decision> } = {}): FakeClient => {
   const watchers: FakeClient["watchers"] = []
   const studios: FakeClient["studios"] = []
   const outputs: FakeClient["outputs"] = []
@@ -100,6 +100,10 @@ export const fakeClient = (o: { matches?: ReadonlyArray<MatchSummary>; evidence?
       if (!o.whatIf) throw new Error("no what-if")
       return o.whatIf()
     },
+    decisions: async (sessionId) => {
+      calls.push(`decisions ${sessionId}`)
+      return o.decisions ?? []
+    },
     recap: async (sessionId, kind) => {
       calls.push(`recap ${sessionId} ${kind}`)
       return o.recap ?? { recap: null, cards: [] }
diff --git a/packages/rpc/test/contracts.test.ts b/packages/rpc/test/contracts.test.ts
index ddd9221..05aaa19 100644
--- a/packages/rpc/test/contracts.test.ts
+++ b/packages/rpc/test/contracts.test.ts
@@ -20,13 +20,13 @@ describe("API contracts", () => {
   })
 
   it("describe a match in the library", () => {
-    const m = { match_id: "eval-costly_error-1", scenario: "costly_error", seed: 1, home: team("northwick", "home"), away: team("larkspur", "away"), score: { home: 1, away: 2 }, fps: 10, frames: 58007, segments: ["casual.en.neutral"], model: "stub" }
+    const m = { match_id: "eval-costly_error-1", scenario: "costly_error", seed: 1, home: team("northwick", "home"), away: team("larkspur", "away"), score: { home: 1, away: 2 }, fps: 10, frames: 58007, segments: ["casual.en.neutral"], model: "stub", managers: null }
     expect(Schema.decodeUnknownSync(MatchSummary)(m)).toEqual(m)
     expect(() => Schema.decodeUnknownSync(MatchSummary)({ ...m, score: { home: -1, away: 0 } })).toThrow()
   })
 
   it("offer the endpoints of spec §5.7", () => {
-    expect([...TouchlineRpcs.requests.keys()].sort()).toEqual(["Control", "GetEvidence", "GetMatch", "GetOps", "GetRecap", "GetWhatIf", "ListMatches", "StartSession", "StudioAct", "StudioWatch", "Watch", "WatchGraphics"])
+    expect([...TouchlineRpcs.requests.keys()].sort()).toEqual(["Control", "GetDecisions", "GetEvidence", "GetMatch", "GetOps", "GetRecap", "GetWhatIf", "ListMatches", "StartSession", "StudioAct", "StudioWatch", "Watch", "WatchGraphics"])
   })
 
   it("refuse playback speeds out of range", () => {
PATCH
```

- [ ] **Step 2: Run them to make sure they fail**

Run: `pnpm --filter @touchline/rpc test`
Expected: FAIL: no `GetDecisions` endpoint, and the summary fixture's `managers` is unknown

Run: `pnpm --filter @touchline/api test decisions`
Expected: FAIL: the library match has no `managers`, `decisions` or decision cues, and the server has no `GetDecisions`

Run: `pnpm --filter @touchline/web test decisions`
Expected: FAIL: `../src/Decisions.js` does not exist

- [ ] **Step 3: Write the implementation**

Create `apps/api/src/decisions.ts`:

```ts
/**
 * Manager decisions (Plan 4b): a managed match's decisions.jsonl. Each decision is shown as a cue at its key moment
 * (its headline and the manager's reason, in English: the reason is the manager's own words, numbers checked against
 * the what-if results) and served to the viewer's decision strip, never past the session's frame. No model writes
 * these cues; the commentary feed carries them like any other.
 */
import { existsSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { decisionKey, type MatchInfo } from "@touchline/rpc"
import { decodeDecision, type Cue, type Decision } from "@touchline/schema"

export const DECISIONS_FILE = "decisions.jsonl"

/** A run folder's decisions (none for a match without managers), each checked against the contract. */
export const readDecisionLog = (dir: string): Decision[] => {
  const file = join(dir, DECISIONS_FILE)
  if (!existsSync(file)) return []
  return readFileSync(file, "utf8").split("\n").filter((l) => l.trim()).map((l) => decodeDecision(JSON.parse(l)))
}

const clock = (minute: number) => {
  const s = Math.round(minute * 60)
  return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`
}

/** The cue of each decision, casual and analyst (English; other languages fall back to it). */
export const decisionCues = (info: MatchInfo, decisions: ReadonlyArray<Decision>): Cue[] =>
  decisions.flatMap((d) => {
    const team = info.home.id === d.team_id ? info.home : info.away
    const picked = d.options[d.pick]!
    const text = { headline: d.pick === 0 ? `${team.name} keep their plan` : `${team.name}: ${picked.label}`, body: d.reason }
    const gain = picked.xg_diff_vs_no_change
    return (["casual", "analyst"] as const).map((mode): Cue => ({
      cue_id: `${decisionKey(d)}-${mode}.en.neutral`,
      schema: "touchline.cue/1",
      match_id: info.match_id,
      moment_id: decisionKey(d),
      anchor: { frame_from: d.tick, frame_to: d.tick, clock: clock(d.minute) },
      display: { slot: "lower_third", priority: 2, ttl_ms: 12_000, template: "manager_decision" },
      segment: { mode, lang: "en", club: null },
      text,
      data: { "decision.options": d.options.length - 1, ...(d.pick > 0 && gain ? { "decision.xg_gain": gain.mean } : {}) },
      evidence: [decisionKey(d)],
      verified: true
    }))
  })
```

Create `apps/web/src/Decisions.tsx`:

```tsx
import type { MatchInfo } from "@touchline/rpc"
import { decisionKey } from "@touchline/rpc"
import type { Decision } from "@touchline/schema"
import { t, type Key, type Lang } from "./i18n.js"

const REASONS: Readonly<Record<Decision["reasons"][number], Key>> = { half_time: "rHalfTime", after_goal: "rAfterGoal", minute_60: "rMinute60", minute_75: "rMinute75" }
const SOURCES: Readonly<Record<Decision["options"][number]["source"], Key>> = { agent: "srcAgent", rules: "srcRules", no_change: "srcNoChange" }

const teamOf = (match: MatchInfo, d: Decision) => (match.home.id === d.team_id ? match.home : match.away)
const signed = (v: number) => `${v >= 0 ? "+" : "−"}${Math.abs(v).toFixed(2)}`

/**
 * A decision's minute as a fan reads it: added time as "45+3'" or "90+2'". The first half ends at the half-time
 * decision's tick (every managed match has one; without it, only the 90+ form is used).
 */
export const minuteLabel = (d: Decision, all: ReadonlyArray<Decision>): string => {
  const m = Math.floor(d.minute)
  const halfTime = all.find((x) => x.reasons.includes("half_time"))?.tick
  if (halfTime !== undefined && d.tick < halfTime && m >= 45) return `45+${m - 44}'`
  if ((halfTime === undefined || d.tick >= halfTime) && m >= 90) return `90+${m - 89}'`
  return `${m}'`
}

/** Markers closer than this (% of the strip) would overlap. */
const MARKER_GAP_PCT = 4

/** One marker per moment the session has reached (every team that decided then), along the match; a marker opens its cards. */
export const DecisionStrip = ({ match, decisions, open, onOpen, lang }: { match: MatchInfo; decisions: ReadonlyArray<Decision>; open: number | null; onOpen: (tick: number) => void; lang: Lang }) => {
  const ticks = [...new Set(decisions.map((d) => d.tick))].sort((a, b) => a - b)
  const left = (tick: number) => Math.min(98, Math.max(2, (100 * tick) / Math.max(1, match.frames)))
  // A marker too close to the one before it (the end of a half and the next kickoff) drops to a second row.
  const rows: number[] = []
  ticks.forEach((tick, i) => rows.push(i > 0 && left(tick) - left(ticks[i - 1]!) < MARKER_GAP_PCT ? 1 - rows[i - 1]! : 0))
  return (
    <nav aria-label={t(lang, "decisions")} className="relative rounded bg-slate-900" style={{ height: rows.includes(1) ? 52 : 28 }}>
      {ticks.map((tick, i) => {
        const ds = decisions.filter((d) => d.tick === tick)
        const teams = ds.map((d) => teamOf(match, d))
        return (
          <button
            key={tick}
            type="button"
            aria-pressed={open === tick}
            aria-label={`${minuteLabel(ds[0]!, decisions)} ${teams.map((x) => x.short).join("·")}`}
            title={`${teams.map((x) => x.name).join(" · ")} · ${minuteLabel(ds[0]!, decisions)}`}
            className="absolute h-5 -translate-x-1/2 rounded px-1 text-xs text-white"
            style={{ left: `${left(tick)}%`, top: rows[i] ? 28 : 4, background: teams.length > 1 ? "#475569" : teams[0]!.kit.primary }}
            onClick={() => onOpen(tick)}
          >
            {minuteLabel(ds[0]!, decisions)}
          </button>
        )
      })}
    </nav>
  )
}

/** A decision: why it was taken, every option with its re-simulated gain over no change, the pick and the reason. */
export const DecisionCard = ({ match, decision: d, all, onClose, lang }: { match: MatchInfo; decision: Decision; all: ReadonlyArray<Decision>; onClose: () => void; lang: Lang }) => {
  const scale = Math.max(0.05, ...d.options.map((o) => (o.xg_diff_vs_no_change ? Math.abs(o.xg_diff_vs_no_change.mean) + o.xg_diff_vs_no_change.se : 0)))
  return (
    <section role="dialog" aria-label={`${teamOf(match, d).name} · ${minuteLabel(d, all)}`} className="flex flex-col gap-2 rounded border border-slate-700 bg-slate-900 p-3 text-sm">
      <header className="flex items-center gap-2">
        <h3 className="font-semibold">{teamOf(match, d).name} · {minuteLabel(d, all)}</h3>
        <span className="text-slate-400">{d.reasons.map((r) => t(lang, REASONS[r])).join(" · ")}</span>
        <button type="button" className="ml-auto rounded bg-slate-800 px-2" onClick={onClose}>{t(lang, "close")}</button>
      </header>
      <p className="text-xs text-slate-400">{t(lang, "xgVsNoChange")}</p>
      <ol className="flex flex-col gap-1">
        {d.options.map((o) => {
          const e = o.xg_diff_vs_no_change
          const picked = o.index === d.pick
          return (
            <li key={o.index} aria-current={picked ? "true" : undefined} className={`grid grid-cols-[1fr_8rem_6rem] items-center gap-2 rounded px-2 py-1 ${picked ? "bg-emerald-900/60" : ""}`}>
              <span>
                {o.label} <span className="text-xs text-slate-400">({t(lang, SOURCES[o.source])})</span>
                {picked && <strong className="ml-2 text-emerald-300">{t(lang, "picked")}</strong>}
              </span>
              <span className="relative h-2 rounded bg-slate-800">
                {e && <span className={`absolute top-0 h-2 rounded ${e.mean >= 0 ? "left-1/2 bg-emerald-500" : "right-1/2 bg-rose-500"}`} style={{ width: `${(50 * Math.abs(e.mean)) / scale}%` }} />}
              </span>
              <span className="tabular-nums text-right">{o.untested ? t(lang, "untested") : e ? `${signed(e.mean)} ± ${e.se.toFixed(2)}` : "–"}</span>
            </li>
          )
        })}
      </ol>
      <p lang="en">{d.reason}</p>
      {d.fallback && <p className="text-xs text-amber-300">{t(lang, "fallbackNote")}</p>}
      <p className="text-xs text-slate-500">{d.model}</p>
    </section>
  )
}
```

Apply this change to `apps/api/src/library.ts`, `apps/api/src/server.ts`, `apps/web/src/MatchList.tsx`, `apps/web/src/Watch.tsx`, `apps/web/src/client.ts`, `apps/web/src/i18n.ts`, `packages/rpc/src/contracts.ts` (from the repository root):

```bash
git apply <<'PATCH'
diff --git a/apps/api/src/library.ts b/apps/api/src/library.ts
index a7dc47e..8f18e53 100644
--- a/apps/api/src/library.ts
+++ b/apps/api/src/library.ts
@@ -7,8 +7,9 @@ import { join } from "node:path"
 import type { League } from "@touchline/league"
 import { readCueCache } from "@touchline/agent-gateway"
 import type { MatchInfo, MatchSummary, Player, TeamBrief, WhatIfClip } from "@touchline/rpc"
-import { segmentKey, type Cue } from "@touchline/schema"
+import { segmentKey, type Cue, type Decision } from "@touchline/schema"
 import { betterPassCues } from "./betterpass.js"
+import { decisionCues, readDecisionLog } from "./decisions.js"
 import { readWhatIfs } from "./whatif.js"
 
 export class LibraryError extends Error {}
@@ -20,6 +21,8 @@ export interface LibraryMatch {
   readonly cues: ReadonlyArray<Cue>
   /** The cached what-if clips by pass (`pnpm library`). */
   readonly clips: ReadonlyMap<string, WhatIfClip>
+  /** A managed match's decisions (`pnpm manage`), in order; empty for a match without managers. */
+  readonly decisions: ReadonlyArray<Decision>
 }
 
 interface Manifest {
@@ -30,6 +33,7 @@ interface Manifest {
   readonly scenario: string | null
   readonly fps: number
   readonly stats: { readonly frames: number; readonly score: string }
+  readonly managers?: { readonly home: string | null; readonly away: string | null }
 }
 
 const json = <A>(path: string): A => JSON.parse(readFileSync(path, "utf8")) as A
@@ -55,11 +59,13 @@ export const readMatch = (dir: string, league: League): LibraryMatch => {
   const model = existsSync(summaryPath) ? (json<{ models: string[] }>(summaryPath).models[0] ?? null) : null
   const summary: MatchSummary = {
     match_id: m.match_id, scenario: m.scenario, seed: m.seed, home: home.brief, away: away.brief, score: { home: h ?? 0, away: a ?? 0 },
-    fps: m.fps, frames: m.stats.frames, segments: [...new Set(cues.map((c) => segmentKey(c.segment)))].sort(), model
+    fps: m.fps, frames: m.stats.frames, segments: [...new Set(cues.map((c) => segmentKey(c.segment)))].sort(), model,
+    managers: m.managers ? { home: m.managers.home, away: m.managers.away } : null
   }
   const info = { ...summary, players: [...home.players, ...away.players] }
   const clips = readWhatIfs(dir)
-  return { dir, info, cues: [...cues, ...betterPassCues(info, clips.values())], clips }
+  const decisions = readDecisionLog(dir)
+  return { dir, info, cues: [...cues, ...betterPassCues(info, clips.values()), ...decisionCues(info, decisions)], clips, decisions }
 }
 
 /** Every run folder directly under `root`, by match id (folders that are not runs are skipped). */
diff --git a/apps/api/src/server.ts b/apps/api/src/server.ts
index afb0f24..55aca16 100644
--- a/apps/api/src/server.ts
+++ b/apps/api/src/server.ts
@@ -56,7 +56,8 @@ export const handlersLayer = (o: ApiOptions) =>
         StudioWatch: ({ session_id, segment }) => studio.watch(sessions, session_id, segment),
         StudioAct: ({ session_id, moment_id, action }) => sessions.get(session_id).pipe(Effect.flatMap((s) => studio.act(s, moment_id, action))),
         WatchGraphics: ({ session_id, segment }) => sessions.graphics(session_id, segment),
-        GetOps: ({ session_id }) => sessions.get(session_id).pipe(Effect.flatMap((s) => Effect.map(Ref.get(s.playback), (p) => ops.report(s, p.frame))))
+        GetOps: ({ session_id }) => sessions.get(session_id).pipe(Effect.flatMap((s) => Effect.map(Ref.get(s.playback), (p) => ops.report(s, p.frame)))),
+        GetDecisions: ({ session_id }) => view(session_id).pipe(Effect.map(({ s, v }) => s.match.decisions.filter((d) => d.tick <= v.frame)))
       })
     })
   )
diff --git a/apps/web/src/MatchList.tsx b/apps/web/src/MatchList.tsx
index 4094dff..fab6dfb 100644
--- a/apps/web/src/MatchList.tsx
+++ b/apps/web/src/MatchList.tsx
@@ -1,7 +1,7 @@
 import type { MatchSummary } from "@touchline/rpc"
 import { t, type Lang } from "./i18n.js"
 
-/** The library: one card per match, with its teams in their kit colours and whether it has agent cues. */
+/** The library: one card per match, with its teams in their kit colours, whether it has agent cues, and its managers. */
 export const MatchList = ({ matches, lang, onWatch }: { matches: ReadonlyArray<MatchSummary>; lang: Lang; onWatch: (m: MatchSummary) => void }) => {
   if (!matches.length) return <p className="text-slate-400">{t(lang, "noMatches")}</p>
   return (
@@ -14,7 +14,7 @@ export const MatchList = ({ matches, lang, onWatch }: { matches: ReadonlyArray<M
             <span className="flex items-center gap-2">{m.away.name}<span className="inline-block h-3 w-3 rounded-full" style={{ background: m.away.kit.primary }} /></span>
           </div>
           <div className="mt-2 flex items-center justify-between text-sm text-slate-400">
-            <span>{m.scenario ?? "—"} · {m.model ?? t(lang, "stats")}</span>
+            <span>{m.managers ? `${t(lang, "managed")}: ${m.managers.home ?? "—"} v ${m.managers.away ?? "—"}` : (m.scenario ?? "—")} · {m.model ?? t(lang, "stats")}</span>
             <button type="button" className="rounded-lg bg-emerald-600 px-3 py-1 font-medium text-white hover:bg-emerald-500" onClick={() => onWatch(m)}>{t(lang, "watch")}</button>
           </div>
         </li>
diff --git a/apps/web/src/Watch.tsx b/apps/web/src/Watch.tsx
index 9cc6902..e5a94c6 100644
--- a/apps/web/src/Watch.tsx
+++ b/apps/web/src/Watch.tsx
@@ -1,6 +1,6 @@
 import { useEffect, useState } from "react"
-import type { MatchInfo, Playback } from "@touchline/rpc"
-import type { Cue } from "@touchline/schema"
+import { decisionKey, type MatchInfo, type Playback } from "@touchline/rpc"
+import type { Cue, Decision } from "@touchline/schema"
 import type { TouchlineClient } from "./client.js"
 import { t, type Lang } from "./i18n.js"
 import { Live3D } from "./Live3D.js"
@@ -14,10 +14,14 @@ import { segmentOf, type Profile } from "./profile.js"
 import { TopBar } from "./TopBar.js"
 import { routeHash } from "./route.js"
 import { usePane } from "./usePane.js"
+import { DecisionCard, DecisionStrip } from "./Decisions.js"
 import { hasWebGL } from "./view3d/webgl.js"
 
 export const SPEEDS = [1, 2, 4, 8, 16, 32]
 
+/** How long a decision card stays open on its own when its cue arrives. */
+export const DECISION_CARD_MS = 12_000
+
 /** The viewer's 2D or 3D choice, remembered in this browser (spec Plan 7: per viewer). */
 export const VIEW_KEY = "touchline.view"
 const savedView = (): "2d" | "3d" => {
@@ -36,7 +40,7 @@ const saveView = (v: "2d" | "3d") => {
 }
 
 /** One profile's view of a session: its profile bar, scoreboard, pitch and the cues for its segment over the pitch. */
-export const Pane = ({ client, sessionId, match, profile, onProfile, onWhy, label, view = "2d", onBetterPass }: {
+export const Pane = ({ client, sessionId, match, profile, onProfile, onWhy, label, view = "2d", onBetterPass, onDecision }: {
   client: TouchlineClient
   sessionId: string
   match: MatchInfo
@@ -47,6 +51,8 @@ export const Pane = ({ client, sessionId, match, profile, onProfile, onWhy, labe
   view?: "2d" | "3d"
   /** Called with the pass when a better-pass cue arrives (the demo's auto-show). */
   onBetterPass?: (eventId: string) => void
+  /** Called with the decision's key when a manager's decision cue arrives. */
+  onDecision?: (key: string) => void
 }) => {
   const lang = profile.lang
   const pane = usePane(client, sessionId, segmentOf(profile))
@@ -54,6 +60,7 @@ export const Pane = ({ client, sessionId, match, profile, onProfile, onWhy, labe
   const newest = pane.feed[0]
   useEffect(() => {
     if (newest?.display.template === "better_pass" && newest.evidence[0]) onBetterPass?.(newest.evidence[0])
+    if (newest?.display.template === "manager_decision" && newest.evidence[0]) onDecision?.(newest.evidence[0])
   }, [newest?.cue_id])
   return (
     <section className="flex flex-col gap-2" aria-label={label}>
@@ -110,6 +117,22 @@ export const Watch = ({ client, sessionId, match, profile, onProfile, onBack }:
     setView(v)
     saveView(v)
   }
+  // Manager decisions (Plan 4b): the strip of decisions reached so far, and the cards of one moment open (on a cue, or
+  // from the strip): both teams' when both decided then.
+  const [decisions, setDecisions] = useState<ReadonlyArray<Decision>>([])
+  const [decision, setDecision] = useState<{ tick: number; auto: boolean } | null>(null)
+  const showDecision = (key: string, auto: boolean) =>
+    client.decisions(sessionId).then((ds) => {
+      setDecisions(ds)
+      const d = ds.find((x) => decisionKey(x) === key)
+      if (d) setDecision({ tick: d.tick, auto })
+    }, () => {}) // a lost session shows on the pane
+  useEffect(() => {
+    if (!decision?.auto) return
+    const timer = setTimeout(() => setDecision(null), DECISION_CARD_MS)
+    return () => clearTimeout(timer)
+  }, [decision])
+  const onWhyCue = (c: Cue) => (c.display.template === "manager_decision" && c.evidence[0] ? void showDecision(c.evidence[0], false) : setWhy(c))
   const [playback, setPlayback] = useState<Pick<Playback, "state" | "speed">>({ state: "playing", speed: 4 })
   const control = (action: "play" | "pause" | "speed", speed?: number) => client.control(sessionId, action, speed).then(setPlayback, () => {}) // a lost session shows on the pane
   return (
@@ -137,10 +160,16 @@ export const Watch = ({ client, sessionId, match, profile, onProfile, onBack }:
           </select>
         </label>
       </div>
+      {(match.managers || decisions.length > 0) && <DecisionStrip match={match} decisions={decisions} open={decision?.tick ?? null} onOpen={(tick) => setDecision({ tick, auto: false })} lang={lang} />}
+      {decision && (
+        <div className="grid gap-2 lg:grid-cols-2">
+          {decisions.filter((d) => d.tick === decision.tick).map((d) => <DecisionCard key={decisionKey(d)} match={match} decision={d} all={decisions} onClose={() => setDecision(null)} lang={lang} />)}
+        </div>
+      )}
       {whatIf && <WhatIfSplit client={client} sessionId={sessionId} eventId={whatIf} match={match} lang={lang} onClose={() => setWhatIf(null)} />}
       <div className={`${second ? "grid gap-4 lg:grid-cols-2" : ""} ${whatIf ? "hidden" : ""}`}>
-        <Pane client={client} sessionId={sessionId} match={match} profile={profile} onProfile={onProfile} onWhy={setWhy} label={second ? "A" : undefined} view={view} onBetterPass={(id) => autoWhatIf && !whatIf && setWhatIf(id)} />
-        {second && <Pane client={client} sessionId={sessionId} match={match} profile={second} onProfile={setSecond} onWhy={setWhy} label="B" view={view} />}
+        <Pane client={client} sessionId={sessionId} match={match} profile={profile} onProfile={onProfile} onWhy={onWhyCue} label={second ? "A" : undefined} view={view} onBetterPass={(id) => autoWhatIf && !whatIf && setWhatIf(id)} onDecision={(key) => void showDecision(key, true)} />
+        {second && <Pane client={client} sessionId={sessionId} match={match} profile={second} onProfile={setSecond} onWhy={onWhyCue} label="B" view={view} />}
       </div>
       <RecapPanel client={client} sessionId={sessionId} segment={segmentOf(profile)} lang={lang} />
       {why && <WhyDrawer client={client} sessionId={sessionId} cue={why} lang={lang} onClose={() => setWhy(null)} onShowMe={(id) => (setWhy(null), setWhatIf(id))} />}
diff --git a/apps/web/src/client.ts b/apps/web/src/client.ts
index 935b5da..6d593a3 100644
--- a/apps/web/src/client.ts
+++ b/apps/web/src/client.ts
@@ -6,7 +6,7 @@ import { BrowserSocket } from "@effect/platform-browser"
 import { Effect, Exit, Layer, ManagedRuntime, Scope, Stream } from "effect"
 import { RpcClient, RpcSerialization } from "effect/rpc"
 import { TouchlineRpcs, type Evidence, type MatchInfo, type MatchSummary, type OpsReport, type Playback, type QueueStatus, type RecapView, type StudioAction, type StudioTick, type Tick, type WhatIfClip } from "@touchline/rpc"
-import type { Segment } from "@touchline/schema"
+import type { Decision, Segment } from "@touchline/schema"
 
 export interface StartOptions {
   readonly speed: number
@@ -34,6 +34,8 @@ export interface TouchlineClient {
   graphics(sessionId: string, segment: Segment, onTick: (t: Tick) => void, onEnd?: (error: string | null) => void): () => void
   /** The session's ops numbers, as of its frame. */
   ops(sessionId: string): Promise<OpsReport>
+  /** A managed match's manager decisions the session has reached. */
+  decisions(sessionId: string): Promise<ReadonlyArray<Decision>>
   close(): Promise<void>
 }
 
@@ -66,6 +68,7 @@ export const connect = async (url: string): Promise<TouchlineClient> => {
     act: (session_id, moment_id, action) => call(client.StudioAct({ session_id, moment_id, action })),
     graphics: (session_id, segment, onTick, onEnd) => follow(client.WatchGraphics({ session_id, segment }), onTick, onEnd),
     ops: (session_id) => call(client.GetOps({ session_id })),
+    decisions: (session_id) => call(client.GetDecisions({ session_id })),
     close: async () => {
       await runtime.runPromise(Scope.close(scope, Exit.void))
       await runtime.dispose()
diff --git a/apps/web/src/i18n.ts b/apps/web/src/i18n.ts
index 0395b2d..9932650 100644
--- a/apps/web/src/i18n.ts
+++ b/apps/web/src/i18n.ts
@@ -108,6 +108,19 @@ const en = {
   gain: "Expected goals and threat gained",
   typical: "Right: re-run #{k}, the one closest to the average outcome",
   autoWhatIf: "Auto-show better passes",
+  decisions: "Manager decisions",
+  picked: "Picked",
+  untested: "not tested",
+  xgVsNoChange: "xG vs no change over the next minutes",
+  rHalfTime: "Half time",
+  rAfterGoal: "After the goal",
+  rMinute60: "60 minutes",
+  rMinute75: "75 minutes",
+  fallbackNote: "The manager agent could not decide here; this is its fallback.",
+  managed: "Managers",
+  srcAgent: "agent",
+  srcRules: "rules",
+  srcNoChange: "no change",
   keysHint: "Click a player to follow them · keys 1–4 switch camera · [ ] step through players"
 } as const
 
@@ -222,6 +235,19 @@ export const STRINGS: Record<Lang, Record<Key, string>> = {
     gain: "Goles esperados y amenaza ganados",
     typical: "Derecha: repetición #{k}, la más cercana al resultado medio",
     autoWhatIf: "Mostrar pases mejores solos",
+    decisions: "Decisiones del entrenador",
+    picked: "Elegida",
+    untested: "sin probar",
+    xgVsNoChange: "xG frente a no cambiar en los próximos minutos",
+    rHalfTime: "Descanso",
+    rAfterGoal: "Tras el gol",
+    rMinute60: "Minuto 60",
+    rMinute75: "Minuto 75",
+    fallbackNote: "El agente entrenador no pudo decidir aquí; esta es su opción de respaldo.",
+    managed: "Entrenadores",
+    srcAgent: "agente",
+    srcRules: "reglas",
+    srcNoChange: "sin cambios",
     keysHint: "Haz clic en un jugador para seguirlo · teclas 1–4 cambian la cámara · [ ] recorren los jugadores"
   },
   hi: {
@@ -331,6 +357,19 @@ export const STRINGS: Record<Lang, Record<Key, string>> = {
     gain: "अपेक्षित गोल और ख़तरे में बढ़त",
     typical: "दाएँ: दोबारा-खेल #{k}, जो औसत नतीजे के सबसे क़रीब है",
     autoWhatIf: "बेहतर पास अपने-आप दिखाएँ",
+    decisions: "मैनेजर के फ़ैसले",
+    picked: "चुना गया",
+    untested: "परखा नहीं गया",
+    xgVsNoChange: "अगले मिनटों में बिना बदलाव की तुलना में xG",
+    rHalfTime: "हाफ़ टाइम",
+    rAfterGoal: "गोल के बाद",
+    rMinute60: "60 मिनट",
+    rMinute75: "75 मिनट",
+    fallbackNote: "मैनेजर एजेंट यहाँ फ़ैसला नहीं कर सका; यह उसका बैकअप विकल्प है।",
+    managed: "मैनेजर",
+    srcAgent: "एजेंट",
+    srcRules: "नियम",
+    srcNoChange: "कोई बदलाव नहीं",
     keysHint: "किसी खिलाड़ी पर क्लिक करें · 1–4 कैमरा बदलें · [ ] खिलाड़ी बदलें"
   }
 }
diff --git a/packages/rpc/src/contracts.ts b/packages/rpc/src/contracts.ts
index 51e780a..f013100 100644
--- a/packages/rpc/src/contracts.ts
+++ b/packages/rpc/src/contracts.ts
@@ -4,7 +4,7 @@
  */
 import { Schema } from "effect"
 import { Rpc, RpcGroup } from "effect/rpc"
-import { ClaimKind, Cue, MetricId, Moment, Recap, Segment } from "@touchline/schema"
+import { ClaimKind, Cue, Decision, MetricId, Moment, Recap, Segment } from "@touchline/schema"
 
 const Id = Schema.String.check(Schema.isMinLength(1))
 const Count = Schema.Int.check(Schema.isGreaterThanOrEqualTo(0))
@@ -37,7 +37,9 @@ export const MatchSummary = Schema.Struct({
   /** Segment keys the cue cache has variants for (empty: no agent cues; the match plays with stats only). */
   segments: Schema.Array(Schema.String),
   /** What produced the cached cues ("stub", "openai:gpt-6.1-sol"), or null. */
-  model: Schema.NullOr(Schema.String)
+  model: Schema.NullOr(Schema.String),
+  /** A managed match's managers ("agent", "rules", "replay"; null: none for that team), or null for a plain match. */
+  managers: Schema.NullOr(Schema.Struct({ home: Schema.NullOr(Schema.String), away: Schema.NullOr(Schema.String) }))
 })
 export type MatchSummary = typeof MatchSummary.Type
 
@@ -282,8 +284,13 @@ export class TouchlineRpcs extends RpcGroup.make(
   /** The broadcast graphics output for a segment: the scoreboard and the cues the producer sent, nothing else. */
   Rpc.make("WatchGraphics", { payload: { session_id: Schema.String, segment: Segment }, success: Tick, error: SessionNotFound, stream: true }),
   /** The session's ops numbers (spec §5.6 ops view), as of its frame. */
-  Rpc.make("GetOps", { payload: { session_id: Schema.String }, success: OpsReport, error: SessionNotFound })
+  Rpc.make("GetOps", { payload: { session_id: Schema.String }, success: OpsReport, error: SessionNotFound }),
+  /** A managed match's manager decisions the session has reached (empty for a match without managers). */
+  Rpc.make("GetDecisions", { payload: { session_id: Schema.String }, success: Schema.Array(Decision), error: SessionNotFound })
 ) {}
 
+/** A manager decision's cue and evidence key: `decision-<tick>-<side>` (the strip opens its card by it). */
+export const decisionKey = (d: Pick<Decision, "tick" | "side">): string => `decision-${d.tick}-${d.side}`
+
 export const decodeTick = Schema.decodeUnknownSync(Tick)
 export const decodeStudioTick = Schema.decodeUnknownSync(StudioTick)
PATCH
```

- [ ] **Step 4: Run the tests**

Run: `pnpm --filter @touchline/rpc test`
Expected: `Tests  9 passed (9)`

Run: `pnpm --filter @touchline/api test`
Expected: `Tests  71 passed (71)`

Run: `pnpm --filter @touchline/web test`
Expected: `Tests  100 passed (100)`

Run: `pnpm turbo run typecheck --force`
Expected: `Tasks:    13 successful, 13 total`

- [ ] **Step 5: Commit**

```bash
git add apps/api apps/web packages/rpc
git commit -m "feat(web): manager decisions in the viewer — each decision a cue at its moment (the pick and the manager's reason, no model writing), a decision card with every option's re-simulated gain over no change, a strip of the decisions reached that reopens them, managers in the match list; GetDecisions never past the session's frame

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 11: Managed matches re-simulate and join the library

The better-pass scan, the what-if split and `explain_pass` rebuild a match from its run folder; a managed match differs from the rebuilt plain match from its first decision on (found when the library first built one: "events differ by tick 29022"). `statesAt` takes the logged orders and applies each after the step of its tick, as the managed match did; the advisor's `Session` reads `manifest.managers` and `decisions.jsonl` and uses them in every rebuild, so the run's events check out (Ruling 10). `pnpm library --managed home:away:seed,…` builds managed matches (the manager agent for both teams) through `pnpm manage` and annotates them like any match.

**Files:**
- Modify: `packages/sim-core/src/whatif.ts` (`LoggedOrders`, `withLoggedOrders`, `statesAt(cfg, ticks, logged?)`); test `packages/sim-core/test/orders.test.ts`
- Modify: `packages/advisor/src/session.ts` (`Session.logged`, managed rebuild); test `packages/advisor/test/managed.test.ts`
- Modify: `apps/api/src/build-library.ts` (`ManagedFixture`, `parseManaged`, `BuildOptions.managed`, `BuildOptions.whatif`), `apps/api/src/library-cli.ts` (`--managed`); test `apps/api/test/build-library.test.ts`

**Interfaces:**
- Produces: `type LoggedOrders = ReadonlyArray<{ tick; side; orders: ManagerOrder[] }>`, `withLoggedOrders(s, logged)`, `statesAt(cfg, ticks, logged = [])` (`@touchline/sim-core`); `new Session(cfg, events?, logged?)`, `Session.logged` (`@touchline/advisor`); `interface ManagedFixture { home; away; seed }`, `parseManaged(text)`, `BuildOptions.managed?`, `BuildOptions.whatif?` (`apps/api`); CLI `pnpm library --managed "home:away:seed,…"`
- Consumes: Task 1 (`applyOrders`), Task 2 (`decodeDecision`), Task 8 (`pnpm manage`, `manifest.managers`), Task 10 (the library reads decisions).

- [ ] **Step 1: Write the failing tests**

Create `packages/advisor/test/managed.test.ts`:

```ts
import { spawnSync } from "node:child_process"
import { mkdtempSync, readFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import type { League } from "@touchline/league"
import { decodeDecision, decodeDomainEvent } from "@touchline/schema"
import { paramsFromJson } from "@touchline/sim-core"
import { AdvisorError, Session } from "../src/index.js"

const root = join(dirname(fileURLToPath(import.meta.url)), "../../..")
const json = (p: string) => JSON.parse(readFileSync(join(root, p), "utf8"))
const league = json("data/league/league.json") as League
const params = paramsFromJson(json("data/params/touchline-params.json"))
const lines = (file: string) => readFileSync(file, "utf8").trim().split("\n").map((l) => JSON.parse(l))

let dir: string
beforeAll(() => {
  dir = join(mkdtempSync(join(tmpdir(), "advisor-managed-")), "m")
  const r = spawnSync("pnpm", ["-s", "manage", "--seed", "11", "--home-manager", "rules", "--away-manager", "rules", "--out", dir], { cwd: root, encoding: "utf8" })
  if (r.status !== 0) throw new Error(r.stderr)
}, 300_000)
afterAll(() => rmSync(dirname(dir), { recursive: true, force: true }))

describe("a managed match's run folder", () => {
  it("is rebuilt with its managers' orders: every state matches the match as it was played", () => {
    const session = Session.fromRun(dir, league, [params])
    expect(session.cfg.managed).toEqual(["home", "away"])
    const decisions = lines(join(dir, "decisions.jsonl")).map((l) => decodeDecision(l))
    expect(session.logged.length).toBe(decisions.length)
    const events = lines(join(dir, "domain.jsonl")).map((l) => decodeDomainEvent(l))
    // After the last decision, the rebuilt match has emitted exactly the run's events.
    const after = decisions.at(-1)!.tick + 600
    const last = events.filter((e) => Math.max(e.frame_id, e.frame_id_end ?? e.frame_id) <= after).reduce((m, e) => Math.max(m, Number(e.id.split("-e").at(-1))), 0)
    expect(session.stateAt(after).eventSeq).toBe(last)
    // A substitution a manager ordered is on the pitch in the rebuilt state.
    const sub = decisions.flatMap((d) => d.orders_applied).find((o) => o.kind === "sub") as { on: string } | undefined
    expect(sub && session.stateAt(after).players.some((p) => p.id === sub.on)).toBe(true)
  })
  it("cannot be rebuilt without its decision log", () => {
    rmSync(join(dir, "decisions.jsonl"))
    expect(() => Session.fromRun(dir, league, [params])).toThrow(AdvisorError)
  })
})
```

Apply this change to `apps/api/test/build-library.test.ts`, `packages/sim-core/test/orders.test.ts` (from the repository root):

```bash
git apply <<'PATCH'
diff --git a/apps/api/test/build-library.test.ts b/apps/api/test/build-library.test.ts
index b3919cd..16b9259 100644
--- a/apps/api/test/build-library.test.ts
+++ b/apps/api/test/build-library.test.ts
@@ -5,7 +5,7 @@ import { tmpdir } from "node:os"
 import { join } from "node:path"
 import { afterAll, describe, expect, it } from "vitest"
 import { decodeMomentTrace, segmentKey } from "@touchline/schema"
-import { BuildError, buildLibrary, librarySegments } from "../src/build-library.js"
+import { BuildError, buildLibrary, librarySegments, parseManaged } from "../src/build-library.js"
 import { scanLibrary } from "../src/library.js"
 import { betterMomentId } from "../src/betterpass.js"
 import { betterOptionEvents, readWhatIfs } from "../src/whatif.js"
@@ -19,6 +19,8 @@ const freePort = () => new Promise<number>((ok) => {
 })
 
 let agents: ChildProcess | undefined
+let started = ""
+const agentsUrl = () => started
 const dirs: string[] = []
 const tmp = () => {
   const d = mkdtempSync(join(tmpdir(), "lib-"))
@@ -52,6 +54,7 @@ describe("library builder", () => {
     const port = await freePort()
     agents = spawn("uv", ["run", "--project", "services/agents", "touchline-agents", "--port", String(port)], { cwd: root, env: { ...process.env, TOUCHLINE_LLM: "stub" }, detached: true, stdio: "ignore" })
     const url = `http://127.0.0.1:${port}/`
+    started = url
     for (let i = 0; i < 300 && !(await fetch(`${url}.well-known/agent-card.json`).then((r) => r.ok, () => false)); i++) await new Promise((r) => setTimeout(r, 200))
     const out = tmp()
     await buildLibrary({ out, scenarios: ["costly_error"], seed: 2, agentsUrl: url })
@@ -69,4 +72,23 @@ describe("library builder", () => {
     expect(found.length).toBeGreaterThan(0)
     for (const c of found) expect(m.cues.filter((q) => q.moment_id === betterMomentId(c.event_id))).toHaveLength(6)
   }, 600_000)
+
+  it("reads managed matches as home:away:seed and builds them only with the agent service", async () => {
+    expect(parseManaged("ironmoor:saltmarsh:5001, northwick:larkspur:7")).toEqual([{ home: "ironmoor", away: "saltmarsh", seed: 5001 }, { home: "northwick", away: "larkspur", seed: 7 }])
+    expect(parseManaged("")).toEqual([])
+    expect(() => parseManaged("ironmoor:saltmarsh")).toThrow(/is not home:away:seed/)
+    await expect(buildLibrary({ out: tmp(), scenarios: [], seed: 1, managed: parseManaged("ironmoor:saltmarsh:1"), agentsUrl: null })).rejects.toThrow("managed matches need the agent service")
+  })
+
+  it("adds a managed match: the manager agent for both teams, its decisions shown as cues, annotated like any match (stub model)", async () => {
+    const url = (await fetch(`${agentsUrl()}.well-known/agent-card.json`).then((r) => r.ok, () => false)) ? agentsUrl() : null
+    expect(url).not.toBeNull() // started by the test above
+    const out = tmp()
+    await buildLibrary({ out, scenarios: [], seed: 1, managed: [{ home: "northwick", away: "larkspur", seed: 3 }], agentsUrl: url, whatif: { seeds: 2, horizonS: 60 } })
+    const m = scanLibrary(out, league).get("lib-managed-northwick-larkspur-3")!
+    expect(m.info.managers).toEqual({ home: "agent", away: "agent" })
+    expect(m.info.segments).toHaveLength(12)
+    expect(m.decisions.length).toBeGreaterThanOrEqual(6)
+    expect(m.cues.filter((c) => c.display.template === "manager_decision")).toHaveLength(2 * m.decisions.length)
+  }, 600_000)
 })
diff --git a/packages/sim-core/test/orders.test.ts b/packages/sim-core/test/orders.test.ts
index 0527e83..b5e285e 100644
--- a/packages/sim-core/test/orders.test.ts
+++ b/packages/sim-core/test/orders.test.ts
@@ -6,6 +6,7 @@ import {
   isFinished,
   isHalfTimeBreak,
   OrderError,
+  statesAt,
   step,
   subsLeft,
   whatIf,
@@ -142,3 +143,14 @@ describe("the orders intervention", () => {
     expect(() => whatIf(stoppage, { kind: "orders", side: "home", orders: [{ kind: "style", setting: "tempo", value: -1 }] }, { seeds: 1, horizonS: 10 })).toThrow(WhatIfError)
   })
 })
+
+describe("a managed match rebuilt from its logged orders", () => {
+  it("reaches the same states as the match that applied them", () => {
+    const off = onPitch(stoppage, "ST").id, on = bench("ST").id
+    const logged = [{ tick: stoppage.tick, side: "home" as const, orders: [{ kind: "sub" as const, off, on }, { kind: "style" as const, setting: "tempo" as const, value: 0.9 }] }]
+    const played = playUntil(managed, (s) => s.tick >= stoppage.tick + 300, applyOrders(stoppage, "home", logged[0]!.orders)).s
+    const rebuilt = statesAt(managed, [stoppage.tick + 300], logged).get(stoppage.tick + 300)!
+    expect(rebuilt).toEqual(played)
+    expect(rebuilt.players.some((p) => p.id === on)).toBe(true)
+  })
+})
PATCH
```

- [ ] **Step 2: Run them to make sure they fail**

Run: `pnpm --filter @touchline/sim-core test orders`
Expected: FAIL: `statesAt` ignores the logged orders (the rebuilt state differs)

Run: `pnpm --filter @touchline/advisor test managed`
Expected: FAIL: `Session.fromRun` rebuilds the managed match without its orders (`does not match the match rebuilt from its manifest`)

Run: `pnpm --filter @touchline/api test build-library`
Expected: FAIL: `parseManaged` is undefined and `--managed` matches are not built (the managed match is missing from the library)

- [ ] **Step 3: Write the implementation**

Apply this change to `apps/api/src/build-library.ts`, `apps/api/src/library-cli.ts`, `packages/advisor/src/session.ts`, `packages/sim-core/src/whatif.ts` (from the repository root):

```bash
git apply <<'PATCH'
diff --git a/apps/api/src/build-library.ts b/apps/api/src/build-library.ts
index e224f1c..cd3b5c3 100644
--- a/apps/api/src/build-library.ts
+++ b/apps/api/src/build-library.ts
@@ -1,7 +1,8 @@
 /**
- * Fill the match library: simulate the built-in scenarios and run each through the agent service (pnpm agents'
- * gateway), so every match plays with its cached cues (spec §6 cached replay), and cache the what-if clip of every
- * pass the agents called a mistake. Deterministic for a stub model.
+ * Fill the match library: simulate the built-in scenarios, and any managed matches (Plan 4b: the manager agent for
+ * both teams, through pnpm manage), and run each through the agent service (pnpm agents' gateway), so every match
+ * plays with its cached cues (spec §6 cached replay), and cache the what-if clip of every pass the agents called a
+ * mistake. Deterministic for a stub model.
  */
 import { spawnSync } from "node:child_process"
 import { join } from "node:path"
@@ -18,9 +19,28 @@ export class BuildError extends Error {}
 export const librarySegments = (homeClub: string): Segment[] =>
   (["casual", "analyst"] as const).flatMap((mode) => (["en", "es", "hi"] as const).flatMap((lang) => [null, homeClub].map((club) => ({ mode, lang, club }))))
 
+/** A managed match for the library: two clubs and a seed, both teams managed by the manager agent. */
+export interface ManagedFixture {
+  readonly home: string
+  readonly away: string
+  readonly seed: number
+}
+
+/** "home:away:seed,…" (e.g. "ironmoor:saltmarsh:5001"). */
+export const parseManaged = (text: string): ManagedFixture[] =>
+  text.split(",").map((x) => x.trim()).filter(Boolean).map((x) => {
+    const [home, away, seed] = x.split(":")
+    if (!home || !away || !seed || !/^\d+$/.test(seed)) throw new BuildError(`--managed: "${x}" is not home:away:seed`)
+    return { home, away, seed: Number(seed) }
+  })
+
 export interface BuildOptions {
   readonly out: string
   readonly scenarios: ReadonlyArray<string>
+  /** Managed matches to add (they need the agent service). */
+  readonly managed?: ReadonlyArray<ManagedFixture>
+  /** How a managed match's agents test their options (default: pnpm manage's 20 forks over 600 s). */
+  readonly whatif?: { readonly seeds: number; readonly horizonS: number }
   readonly seed: number
   /** The agent service, or null to simulate only (matches play with stats cues and no agent cues). */
   readonly agentsUrl: string | null
@@ -34,20 +54,32 @@ export const buildLibrary = async (o: BuildOptions): Promise<string[]> => {
   const log = o.log ?? (() => {})
   if (o.agentsUrl && !(await fetch(new URL(".well-known/agent-card.json", o.agentsUrl)).then((r) => r.ok, () => false)))
     throw new BuildError(`no agent service at ${o.agentsUrl} (start it with: uv run --project services/agents touchline-agents), or pass --no-agents`)
+  if ((o.managed ?? []).length > 0 && !o.agentsUrl) throw new BuildError("managed matches need the agent service (drop --no-agents)")
+  for (const scenario of o.scenarios) if (!SCENARIOS[scenario]) throw new BuildError(`unknown scenario ${scenario} (${Object.keys(SCENARIOS).join(", ")})`)
+  // Each match: its id, the club its segments are framed for, and the command that writes its run folder.
+  const jobs = [
+    ...o.scenarios.map((scenario) => {
+      const id = `lib-${scenario}-${o.seed}`
+      return { id, club: SCENARIOS[scenario]!.home, cmd: ["sim", "--scenario", scenario, "--seed", String(o.seed), "--match-id", id] }
+    }),
+    ...(o.managed ?? []).map((f) => {
+      const id = `lib-managed-${f.home}-${f.away}-${f.seed}`
+      return { id, club: f.home, cmd: ["manage", "--seed", String(f.seed), "--home", f.home, "--away", f.away, "--home-manager", "agent", "--away-manager", "agent", "--agents-url", o.agentsUrl!, "--match-id", id,
+        ...(o.whatif ? ["--whatif-seeds", String(o.whatif.seeds), "--whatif-horizon", String(o.whatif.horizonS)] : [])] }
+    })
+  ]
   const dirs: string[] = []
-  for (const scenario of o.scenarios) {
-    const sc = SCENARIOS[scenario]
-    if (!sc) throw new BuildError(`unknown scenario ${scenario} (${Object.keys(SCENARIOS).join(", ")})`)
-    const id = `lib-${scenario}-${o.seed}`
+  for (const job of jobs) {
+    const { id } = job
     const dir = join(o.out, id)
-    const sim = spawnSync("pnpm", ["-s", "sim", "--scenario", scenario, "--seed", String(o.seed), "--match-id", id, "--out", dir], { cwd: root, encoding: "utf8" })
-    if (sim.status !== 0) throw new BuildError(`pnpm sim failed for ${scenario}: ${sim.stderr.slice(-400)}`)
+    const sim = spawnSync("pnpm", ["-s", ...job.cmd, "--out", dir], { cwd: root, encoding: "utf8" })
+    if (sim.status !== 0) throw new BuildError(`pnpm ${job.cmd[0]} failed for ${id}: ${sim.stderr.slice(-400)}`)
     log(`simulated ${id}`)
     if (o.agentsUrl) {
       const plan = await Effect.runPromise(replaySignals(dir))
       const mcp = await startMcpStats(dir)
       try {
-        const result = await Effect.runPromise(runGateway(a2aSender(o.agentsUrl), { ...plan, mcpUrl: mcp.url }, { ...DEFAULT_OPTIONS, segments: librarySegments(sc.home) }))
+        const result = await Effect.runPromise(runGateway(a2aSender(o.agentsUrl), { ...plan, mcpUrl: mcp.url }, { ...DEFAULT_OPTIONS, segments: librarySegments(job.club) }))
         writeCache(dir, result)
         const s = summarize(result)
         log(`  ${s.moments} moments, ${s.cues} cues (${s.models.join(", ") || "no model"})`)
diff --git a/apps/api/src/library-cli.ts b/apps/api/src/library-cli.ts
index baadd7d..db7bb7d 100644
--- a/apps/api/src/library-cli.ts
+++ b/apps/api/src/library-cli.ts
@@ -1,6 +1,6 @@
 import { join, resolve } from "node:path"
 import { CliError, cliOptions, exitOnUserError, integer, SCENARIOS } from "@touchline/sim"
-import { BuildError, buildLibrary } from "./build-library.js"
+import { BuildError, buildLibrary, parseManaged } from "./build-library.js"
 import { root } from "./playback.js"
 
 const here = (p: string) => resolve(process.env.INIT_CWD ?? process.cwd(), p)
@@ -8,6 +8,7 @@ const o = cliOptions("touchline-library: simulate the built-in scenarios and cac
   out: { default: join(root, "out/library"), help: "library folder" },
   scenarios: { default: Object.keys(SCENARIOS).join(","), help: "comma-separated scenario names" },
   seed: { default: "1", check: integer(0, 4294967295), help: "seed for every scenario" },
+  managed: { default: "", help: "managed matches to add, \"home:away:seed,…\" (the manager agent for both teams; needs the agent service)" },
   agents: { default: "http://127.0.0.1:8100/", help: "the agent service (A2A)" },
   "no-agents": { default: "false", help: "\"true\": simulate only (matches play with stats and no agent cues)" }
 })
@@ -16,7 +17,8 @@ const scenarios = exitOnUserError(() => {
   if (!s.length) throw new CliError("--scenarios needs at least one scenario")
   return s
 })
-buildLibrary({ out: here(o.out), scenarios, seed: Number(o.seed), agentsUrl: o["no-agents"] === "true" ? null : o.agents, log: (l) => console.error(l) })
+const managed = exitOnUserError(() => parseManaged(o.managed), [BuildError])
+buildLibrary({ out: here(o.out), scenarios, seed: Number(o.seed), managed, agentsUrl: o["no-agents"] === "true" ? null : o.agents, log: (l) => console.error(l) })
   .then((dirs) => console.log(`${dirs.length} matches in ${here(o.out)}`))
   .catch((e) => {
     if (e instanceof BuildError) {
diff --git a/packages/advisor/src/session.ts b/packages/advisor/src/session.ts
index ad63c13..f058231 100644
--- a/packages/advisor/src/session.ts
+++ b/packages/advisor/src/session.ts
@@ -1,8 +1,8 @@
 import { existsSync, readFileSync } from "node:fs"
 import { join } from "node:path"
-import { decodeDomainEvent, type DomainEvent } from "@touchline/schema"
+import { decodeDecision, decodeDomainEvent, type DomainEvent } from "@touchline/schema"
 import { SCENARIOS } from "@touchline/sim"
-import { initMatch, isFinished, statesAt, step, type MatchConfig, type MatchState, type Params, type TeamSetup } from "@touchline/sim-core"
+import { initMatch, isFinished, statesAt, step, withLoggedOrders, type LoggedOrders, type MatchConfig, type MatchState, type Params, type Side, type TeamSetup } from "@touchline/sim-core"
 
 /** A run folder the advisor cannot re-simulate (missing files, unknown clubs, parameters it does not have). */
 export class AdvisorError extends Error {}
@@ -15,7 +15,7 @@ export const SESSION_CACHE_STATES = 256
 /**
  * A match that can be re-simulated: its config, rebuilt from a run folder, and the match state at any tick
  * (computed on demand, kept for reuse). Scripted matches are replayed through the scenario runner, so their
- * states are those of the accepted match.
+ * states are those of the accepted match; managed matches apply their logged orders at their ticks (Plan 4b).
  */
 export class Session {
   private readonly cache = new Map<number, MatchState>()
@@ -26,7 +26,9 @@ export class Session {
   constructor(
     readonly cfg: MatchConfig,
     /** The run's domain events, when the session was built from a run folder. */
-    readonly events: ReadonlyArray<DomainEvent> = []
+    readonly events: ReadonlyArray<DomainEvent> = [],
+    /** A managed match's orders, from its decision log. */
+    readonly logged: LoggedOrders = []
   ) {}
 
   /** The state after the step of `tick` (tick -1: before kick-off). */
@@ -45,7 +47,7 @@ export class Session {
       s = from >= 0 ? (this.cache.get(from) ?? this.checkpoints.get(from))! : initMatch(this.cfg)
       while (s.tick < tick) {
         if (isFinished(s)) throw new AdvisorError(`the match is over before tick ${tick}`)
-        s = step(s).state
+        s = withLoggedOrders(step(s).state, this.logged)
         if (s.tick % CHECKPOINT_TICKS === 0) this.checkpoints.set(s.tick, s)
       }
     }
@@ -60,7 +62,7 @@ export class Session {
    */
   prefetch(ticks: Iterable<number>): void {
     const want = [...new Set(ticks)].filter((t) => !this.pinned.has(t))
-    if (want.length) for (const [t, s] of statesAt(this.cfg, want)) this.pinned.set(t, s)
+    if (want.length) for (const [t, s] of statesAt(this.cfg, want, this.logged)) this.pinned.set(t, s)
   }
 
   /** States kept for reuse (asked for and checkpoints). */
@@ -76,8 +78,8 @@ export class Session {
 
   /**
    * Rebuild a run folder's match: clubs from the league, the scenario's script, the kick-off from meta.json and
-   * the parameters whose version the manifest names (one of `params`). The rebuilt match is checked against the
-   * run's own events before it is used.
+   * the parameters whose version the manifest names (one of `params`), and for a managed match its managed teams and
+   * decision log. The rebuilt match is checked against the run's own events before it is used.
    */
   static fromRun(dir: string, league: { readonly clubs: ReadonlyArray<TeamSetup> }, params: ReadonlyArray<Params>): Session {
     const read = (f: string) => {
@@ -85,7 +87,10 @@ export class Session {
       if (!existsSync(p)) throw new AdvisorError(`missing ${p}`)
       return readFileSync(p, "utf8")
     }
-    const manifest = JSON.parse(read("manifest.json")) as { match_id: string; seed: number; home: string; away: string; scenario: string | null; fps: number; params_version: string }
+    const manifest = JSON.parse(read("manifest.json")) as {
+      match_id: string; seed: number; home: string; away: string; scenario: string | null; fps: number; params_version: string
+      managers?: { home: string | null; away: string | null }
+    }
     const meta = JSON.parse(read("meta.json")) as { match: { kickoff_time: string } }
     const club = (id: string) => {
       const c = league.clubs.find((x) => x.id === id)
@@ -104,13 +109,17 @@ export class Session {
       away: club(manifest.away),
       params: p,
       dt: 1 / manifest.fps,
-      ...(scenario ? { script: scenario.script } : {})
+      ...(scenario ? { script: scenario.script } : {}),
+      ...(manifest.managers ? { managed: (["home", "away"] as const).filter((s) => manifest.managers![s] !== null) } : {})
     }
+    const logged: LoggedOrders = manifest.managers
+      ? read("decisions.jsonl").split("\n").filter((l) => l.trim() !== "").map((l) => decodeDecision(JSON.parse(l))).map((d) => ({ tick: d.tick, side: d.side as Side, orders: d.orders_applied }))
+      : []
     const events = read("domain.jsonl")
       .split("\n")
       .filter((l) => l.trim() !== "")
       .map((l) => decodeDomainEvent(JSON.parse(l)))
-    const session = new Session(cfg, events)
+    const session = new Session(cfg, events, logged)
     // The rebuilt match must emit the run's events: compare the event count after the first minute, at half the
     // match and just before the end (a script that starts late, or a wrong scenario, shows up in the later probes).
     const emitted = (e: DomainEvent) => Math.max(e.frame_id, e.frame_id_end ?? e.frame_id)
diff --git a/packages/sim-core/src/whatif.ts b/packages/sim-core/src/whatif.ts
index faac28a..e8533d1 100644
--- a/packages/sim-core/src/whatif.ts
+++ b/packages/sim-core/src/whatif.ts
@@ -233,8 +233,8 @@ export const whatIf = (s: MatchState, variant: Intervention, opts: WhatIfOptions
   return { side, at_tick: s.tick, horizon_s: horizonS, seeds, baseline: per(runs.baseline), variant: per(runs.variant), difference, forced_applied: forcedApplied }
 }
 
-/** The match states (after the step of each tick) at the given ticks, for a plain or scripted match. */
-export const statesAt = (cfg: MatchConfig, ticks: Iterable<number>): Map<number, MatchState> => {
+/** The match states (after the step of each tick) at the given ticks, for a plain, scripted or managed match (with its logged orders). */
+export const statesAt = (cfg: MatchConfig, ticks: Iterable<number>, logged: LoggedOrders = []): Map<number, MatchState> => {
   const want = new Set(ticks)
   if ((cfg.script?.entries.length ?? 0) > 0) return new Map(runScript(cfg, { statesAt: want }).states)
   const out = new Map<number, MatchState>()
@@ -242,8 +242,18 @@ export const statesAt = (cfg: MatchConfig, ticks: Iterable<number>): Map<number,
   let s = initMatch(cfg)
   if (want.has(s.tick)) out.set(s.tick, s)
   while (!isFinished(s) && s.tick < last) {
-    s = step(s).state
+    s = withLoggedOrders(step(s).state, logged)
     if (want.has(s.tick)) out.set(s.tick, s)
   }
   return out
 }
+
+/** A managed match's orders as its decision log recorded them: applied after the step of `tick` (Plan 4b). */
+export type LoggedOrders = ReadonlyArray<{ readonly tick: number; readonly side: Side; readonly orders: ReadonlyArray<ManagerOrder> }>
+
+/** The state with the logged orders of its tick applied, as the managed match applied them. */
+export const withLoggedOrders = (s: MatchState, logged: LoggedOrders): MatchState => {
+  let out = s
+  for (const l of logged) if (l.tick === s.tick) out = applyOrders(out, l.side, l.orders)
+  return out
+}
PATCH
```

- [ ] **Step 4: Run the tests**

Run: `pnpm --filter @touchline/sim-core test orders`
Expected: `Tests  13 passed (13)`

Run: `pnpm --filter @touchline/advisor test`
Expected: `Tests  19 passed (19)`

Run: `pnpm --filter @touchline/api test build-library`
Expected: `Tests  5 passed (5)` (builds a scenario match and a managed match on the stub model, a few minutes)

Run: `pnpm turbo run typecheck --force`
Expected: `Tasks:    13 successful, 13 total`

- [ ] **Step 5: Commit**

```bash
git add apps/api packages/advisor packages/sim-core
git commit -m "feat: managed matches re-simulate and join the library — statesAt and the advisor's Session apply a managed match's logged orders at their ticks (so the better-pass scan, the what-if split and explain_pass work on it), and pnpm library --managed home:away:seed builds the manager agent's matches through pnpm manage and annotates them like any match

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 12: Docs: manager agents in the README and the roadmap

The README gains a "Manager agents" section (what the agent sees and does, the commands, fallbacks, cost) and a package row; the roadmap's 4b row is rewritten for the trimmed plan (corner optimiser dropped) and marked written.

**Files:**
- Modify: `README.md`, `docs/superpowers/plans/2026-10-03-touchline-roadmap.md`

**Interfaces:**
- Produces: documentation only.
- Consumes: the commands of Tasks 8, 9 and 11.

- [ ] **Step 1: Update the README and the roadmap row**

Apply this change to `README.md`, `docs/superpowers/plans/2026-10-03-touchline-roadmap.md` (from the repository root):

````bash
git apply <<'PATCH'
diff --git a/README.md b/README.md
index 0968722..4cdb642 100644
--- a/README.md
+++ b/README.md
@@ -109,6 +109,20 @@ Each session in the fan app links to three more pages, each in its own tab:
 - **Graphics output** (`#/graphics/<session>?seg=…&match=…`): a transparent page for a vision mixer or OBS, with the scoreboard and only the cues the producer sent.
 - **Ops view** (`#/ops/<session>`): Fact-Checker pass/retry/drop counts, fallbacks, time per agent, requests by outcome, and latency against the spec's budgets: goal to scoreboard under 250 ms, and, live, signal to cue under 4 s (p95). A recorded session reports the request times measured when its cache was made.
 
+## Manager agents
+
+A team's manager agent decides at key moments: half time, the restart after a goal, and the first stoppage after 60' and 75' (a minute moment within 5 minutes of a decision is absorbed by it). The engine pauses the match there and sends the agent a `Situation`: the match from its own team's side up to that tick, and nothing else (no seed, script or future; see `packages/schema/src/manager.ts`). The agent proposes up to three changes (style settings and substitutions). The engine tests each against "no change" on 20 forked futures over the next 10 minutes. The agent then chooses, giving a reason whose numbers must come from those results. Every decision goes to `decisions.jsonl`, so a managed match replays exactly without the model.
+
+```bash
+uv run --project services/agents touchline-agents --port 8100     # the agent service (TOUCHLINE_LLM=stub|openai)
+pnpm manage --seed 5001 --home ironmoor --away saltmarsh --home-manager agent --away-manager rules   # out/m-5001 with decisions.jsonl
+pnpm manage --seed 5001 --home ironmoor --away saltmarsh --replay out/m-5001/decisions.jsonl       # the same match, no model calls
+pnpm library --managed ironmoor:saltmarsh:5001,northwick:larkspur:5004   # managed matches in the fan app's library (agent v agent)
+pnpm managers:ab --seeds 120 --llm openai                       # A/B: no manager, rule-based, agent (docs/evals/manager-ab.md)
+```
+
+`pnpm managers:ab --llm stub` runs the pipeline without a model. With `--llm openai` the A/B run starts the agent service on OpenAI; the key stays in `.env.local` and only the Python service reads it. Cost per match is reported only when `TOUCHLINE_PRICE_USD_PER_MTOK="input,output"` gives the model's price; otherwise the report gives tokens. If the agent cannot propose, the rule-based option stands in. If it cannot choose, or the service cannot be reached, the previous plan stays. Each fallback is counted in the report. In the fan app a managed match shows each decision as a cue, a card with every option's tested gain, and a strip of decisions to reopen them.
+
 ## Packages
 
 | Package | What it does |
@@ -125,6 +139,7 @@ Each session in the fan app links to three more pages, each in its own tab:
 | `apps/web` | The fan app (React, Vite, Tailwind): pitch, overlays, profiles, "Why?" drawer, recaps, split screen; the studio console, graphics output and ops view |
 | `packages/agent-gateway` | A2A client of the agent service: signal batches, recaps, time budget, retry, circuit breaker, cue cache |
 | `services/agents` | The six agents, their workflow, the A2A server and the ground-truth evaluation harness (`evals/`) |
+| `packages/manager` | Manager agents: key moments, the Situation sent to the model, rule-based and agent managers, option testing by re-simulation, decision log and replay; `pnpm manage`, `pnpm managers:ab` |
 | `packages/calibrate` | Match statistics (identical to the Python definitions), tuning knobs, tuner, realism gate |
 | `python/analytics` | CDF validation, IDSSE download, real-match targets, realism report, stats-model fitting |
 
diff --git a/docs/superpowers/plans/2026-10-03-touchline-roadmap.md b/docs/superpowers/plans/2026-10-03-touchline-roadmap.md
index 364ac15..32d863f 100644
--- a/docs/superpowers/plans/2026-10-03-touchline-roadmap.md
+++ b/docs/superpowers/plans/2026-10-03-touchline-roadmap.md
@@ -11,7 +11,7 @@
 | 3a | **Stats engine and MCP stats server** — `2026-10-06-plan-3a-stats-engine-mcp.md` | Oct 6–8 | xPass and xG fitted on IDSSE tracking (coefficients only, Python/TypeScript parity); incremental, deterministic metrics and signals (§5.2) on the domain stream, every value as of every tick (no answer sees the future; live and replay agree); replay of run folders and `pnpm stats`; MCP server with nine read-only tools (stdio and Streamable HTTP) for the Plan 4 agents; Plan 2c deferred minors || Merged (`f8f377d`) |
 | 3b | **What-if simulation, advisors and pitch control** — `2026-10-06-plan-3b-whatif-advisors-pitch-control.md` | Oct 12–14 | **match snapshot and what-if re-simulation** (fork the state at a tick, override an intent, decision or tactic, simulate ahead over several seeds, compare outcomes); **"better option" explainer** (scores each pass's recorded alternatives with pitch control × xT and verifies the best one by re-simulation, 2–4 days); **positioning advisor** (searches reachable spots near a player for the best attacking or defensive position and shows it as a "ghost", 4–6 days); **pitch-control-aware passing in the engine** (passers weigh interception risk, to close pass completion 72 % vs 78 % real; shares the pitch-control code) with recalibration; independent re-scoring of pass options from tracking (MIT-licensed references in `research/repos`); `act.xt` and `pitch.ctrl` metrics on the MCP server || Merged (`7186e59`) |
 | 4a | **Agents, Fact-Checker, A2A and evaluation** — `2026-10-07-plan-4a-agents-factcheck-a2a-evals.md` | Oct 7–12 | The six agents of §5.3 as one Agent Framework workflow (detector, analyst, narrator, fact-checker with one retry, personalizer fan-out to EN/ES/HI segments, publisher; checkpointed; recaps), OpenAI `gpt-6.1-sol` behind one config with a deterministic stub for tests and CI and a fallback per agent; contracts in Effect Schema exported to JSON Schema and generated Pydantic; `costly_error` signal and observable event qualifiers; A2A v1.0 server and Effect gateway (batches, recaps, budget, retry, circuit breaker, cue cache for cached replay); ground-truth evaluation harness (§5.3.1) with a CI suite and an LLM judge; final-review fixes (request deadline, whole-token number checks, capped Analyst tools) | Merged (`6bbd2ad`) |
-| 4b | Manager agents, A/B evaluation and corner optimiser | Oct 12–18 | **Manager agents** (one per team) choosing intents at stoppages — formation, press, line height, substitutions — from a validated menu, testing options with what-if re-simulation, with clock paused, typed outputs, fallback to the previous plan and every decision logged by tick for exact replay; **A/B evaluation** of manager agents against the scripted baseline over 100+ paired seeds (goal difference and win rate with confidence intervals, cost, latency, fallback and "do nothing" rates); stretch: **corner-setup optimiser** in the style of TacticAI using search over re-simulated corners (≈ 3 days) | |
+| 4b | **Manager agents and A/B evaluation** — spec `2026-10-10-manager-agents-design.md`, plan `2026-10-10-plan-4b-manager-agents.md` | Oct 10–18 | A manager agent per team decides at key moments (half time, after a goal, 60', 75'): it reads a `Situation` (the match from its side up to the pause, nothing else), proposes style changes and substitutions, the engine tests each against "no change" on 20 forks over 10 minutes, and it chooses with a reason whose numbers come from those results; fallbacks to the rule-based option or the previous plan; every decision in `decisions.jsonl` for exact replay; `pnpm manage`; A/B of no manager, rule-based and agent over 120 paired seeds (`pnpm managers:ab`, xG difference primary, bootstrap and Wilson intervals, cost, latency, fallbacks); decision cards and strip in the fan app; managed matches in the library (`pnpm library --managed`). Corner optimiser dropped | Written |
 | 5a | **API, cue bus and fan app** — `2026-10-07-plan-5a-api-fan-app.md` | Oct 7–12 | Effect RPC API over WebSocket (`packages/rpc`, `apps/api`): match library of run folders, sessions on the cue bus (one match time per session, every viewer its own segment with neutral and English fallbacks), hot-path scoreboard from the stats engine, live toggle running the agents as the match plays, evidence and recaps, `pnpm library` (six scenarios × twelve segments) and `pnpm dev`; fan app (`apps/web`, React, Vite, Tailwind): 2D pitch, overlays by slot, profile switcher and builder, "Why?" drawer with sparklines, recaps, split-screen demo mode, EN/ES/HI; test runs clean up their temp folders | Merged (Oct 7) |
 | 5b | **Studio console, graphics output and ops view** — `2026-10-07-plan-5b-studio-ops.md` | Oct 7–12 | Studio queue on the cue bus (every moment queued; approve, hold, send to graphics; shared by every console), presenter talking points from the analyst text and the checked facts (no model), raw cue feed; a transparent broadcast graphics page showing only what the producer sent; ops view (fact-check pass/retry/drop, fallbacks, time per agent, requests, latency p50/p95 against the 250 ms and 4 s budgets, as of the session's frame); goals reach the scoreboard at once | Merged (Oct 7) |
 | 6b | **Physics fitted on real tracking** — `2026-10-09-plan-6b-physics-fit.md` | Oct 9–20 | Fit-and-validate harness on IDSSE tracking (`pnpm physics:fit`, `data/params/physics.json` with intervals, reject counts, inter-match envelope and held-out checks); the engine's ball (drag, Brody/Cross bounce, skid then roll) and player movement (acceleration–speed law, braking and lateral caps, per-player A0/S0) on the fitted constants; who reaches a moving ball keeps the tuned rule (measured: the fitted 0.2 s reaction hurts realism); realism loss 24.8 (30.0 before), 19 of 19 within 2 SD; player movement and work-rate-by-period checks reported as known gaps; `docs/physics-calibration.md` | Merged (`20ec39b`) |
PATCH
````

- [ ] **Step 2: Run the whole repository**

Run: `pnpm turbo run test --continue --concurrency=4 -- --maxWorkers=3`
Expected: `Tasks:    13 successful, 13 total` (about 6 minutes; do not run other heavy work alongside: the slow scenario and session tests time out under load)

Run: `uv run --project services/agents pytest -q services/agents/tests`
Expected: `175 passed, 7 deselected`

Run: `uv run --locked --project python/analytics pytest -q python/analytics/tests`
Expected: `105 passed`

- [ ] **Step 3: Commit**

```bash
git add README.md docs/superpowers/plans/2026-10-03-touchline-roadmap.md
git commit -m "docs: manager agents in the README (commands, what the model sees, fallbacks, cost) and the Plan 4b roadmap row

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

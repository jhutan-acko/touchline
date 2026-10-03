# Touchline Plan 1 — Simulator Engine Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A deterministic, seeded 11v11 match simulator in TypeScript that emits CDF v0.3.2 files (validated in CI), a live domain stream and a run manifest, plus the fictional league it plays.

**Architecture:** A pure, synchronous `step(state)` in `packages/sim-core` advances the match one 0.1 s tick (one 10 Hz frame): a statistical decision layer chooses actions, an execution model adds realistic error, kicks and shots are resolved at release by time-to-intercept, and players move with capped steering. Effect 4 lives only at the edges (`packages/sim`): streams, pacing, writers and tests. Parameters are hand-set priors behind a provenance gate; Plan 2 fits them on open data.

**Tech Stack:** pnpm 11 workspaces, Turborepo 2.11.6, TypeScript 5.9.3, Vitest 5.0.3, Effect 4.0.0 (+ @effect/vitest 4.0.0), tsx, Node 22; Python ≥ 3.11 with uv and common-data-format-validator 0.1.1.

**Spec:** `docs/superpowers/specs/2026-10-03-touchline-design.md` (§5.1 simulator, §5.1.10 taxonomy, §5.1.12 execution and errors). Roadmap: `docs/superpowers/plans/2026-10-03-touchline-roadmap.md`.

**Verification status:** every file in this plan was built and run before the plan was written: 69 tests passed, `tsc` was clean, a full match ran in about 1.5 s, two runs with the same seed produced byte-identical output, and the CLI's output passed the CDF validator in `extreme` mode.

## Global Constraints

- Coordinates: metres, origin at the centre spot, x ∈ [−52.5, 52.5], y ∈ [−34, 34]; **the home team attacks +x for the whole match** (CDF convention), internally and in output.
- Default tick 0.1 s (10 Hz); `--fps 25` (0.04 s) must work. **Every probability is per action or per second (use `hazard()`), never per tick.**
- Determinism: same `(seed, teams, params, dt)` → byte-identical `event.jsonl`, `tracking.jsonl`, `domain.jsonl`. No `Math.random`, no `Date.now()` inside the engine; all randomness comes from `MatchState.rng`; no module-level mutable state.
- The step function is pure and synchronous; **no Effect inside `packages/sim-core`.**
- CDF v0.3.2 exactly: no keys outside the schema; referee events carry `official_id` and no `player_id`/`team_id`; `frame_id` restarts at 0 each period; `meta.tracking.fps` equals the run's fps.
- Licences: no GPL/AGPL code; no StatsBomb-derived parameters (`assertProvenance` enforces it); every params file carries provenance.
- Fictional identities only: no real clubs, players, crests or kits. Club ids: `ironmoor, kestrel-bay, harrowmere, saltmarsh, eastvale, corrin-forge, larkspur, northwick`.
- Pinned versions (pnpm 11 rejects packages published less than 24 hours ago — if an install fails with `ERR_PNPM_MINIMUM_RELEASE_AGE_VIOLATION`, pin the previous release): turbo 2.11.6, typescript 5.9.3 (not 7.x), vitest 5.0.3, effect 4.0.0, @effect/vitest 4.0.0, tsx 4.23.15, @types/node 22.20.5, common-data-format-validator 0.1.1.
- pnpm 11 needs `allowBuilds: { esbuild: true }` in `pnpm-workspace.yaml`.
- Imports between TS files use `.js` extensions (resolved to `.ts` by Bundler resolution); packages export TypeScript source directly (no build step).
- Uncalibrated is expected: tests check structure, physics and determinism, with only loose sanity bands on statistics. Do not tune parameters in this plan.

## Review Focus

Inputs or conditions the spec implies that are most likely to hurt a user, each pinned by a test in the owning task:

1. **A team reduced to ten or fewer by red cards** — the match must still finish and sent-off players must disappear from frames. *Task 8, `edge.test.ts` "finishes cleanly when players are sent off".*
2. **25 fps render runs (`--fps 25`)** — must stay deterministic and play statistically the same football as 10 fps (pass counts within ±30 %). *Task 8, `edge.test.ts` "runs at 25 Hz".*
3. **A loose ball (parry, block, deflection) rolling into the net** — must count as a goal (flagged as an own goal when the defending side touched it last), and the score must always equal the goal events. *Task 8, `edge.test.ts` "every goal event is matched by the final score".*
4. **Extreme seeds 0 and 4294967295** — must produce a full match. *Task 8, `edge.test.ts` "handles extreme seeds".*
5. **Bad CLI input or a disallowed parameter file** — unknown club, out-of-range seed, unsupported fps, or a params file whose licence is not allowed (or is StatsBomb-derived) must fail with a clear message, not a stack trace or silent misuse. *Task 12 Step 8 (CLI), Task 3 `params.test.ts` (licence gate).*

## Known baseline (what "uncalibrated" looks like)

With `DEFAULT_PARAMS` the engine produced, over seeds 1–3: ~1,300–1,450 passes at 83–86 % completion, 24–41 shots, 3–9 goals (match xG 4.8–7.4, with goals tracking xG), 1–3 corners, 6–10 throw-ins, ball in play 74–80 %. Real targets (spec §5.1.8): ~800–1,000 passes, 18–32 shots, 2.3–3.4 goals, 7–13 corners, ball in play 55–60 %. Plan 2 closes the gap by fitting parameters; it should not need structural engine changes.

**Deferred to Plan 2 (spec items not in this plan):** scenario scripts (the `scriptBias` hook exists in `decide`), calibration and the realism report, substitutions, first-touch errors, keeper claims and punches on crosses, ground-duel events, SPADL view, realism-noise flag, real-player name blocklist. Derived tags (key pass, progressive, line-breaking…) belong to the stats engine in Plan 3. Crest SVG rendering belongs to the front end in Plan 5 (the league stores crest shape and symbol).

---

## File map

```
touchline/
├─ package.json, pnpm-workspace.yaml, turbo.json, tsconfig.base.json, .gitignore, .nvmrc   (Task 1)
├─ .github/workflows/ci.yml                         (Tasks 1, 9, 12)
├─ packages/sim-core/                               (Tasks 1–8)
│  ├─ src/rng.ts            PRNG, sub-streams, hazard
│  ├─ src/geometry.ts       pitch, vectors, zones
│  ├─ src/params.ts         Params contract, priors, provenance gate
│  ├─ src/classify.ts       geometric pass-kind classifier
│  ├─ src/types.ts          state, events, frames
│  ├─ src/ball.ts           ball physics, launch solving
│  ├─ src/kinematics.ts     steering, intercepts
│  ├─ src/shape.ts          formations and anchors
│  ├─ src/testing.ts        shared test helpers (export "./testing")
│  ├─ src/execute.ts        intended → actual kick
│  ├─ src/decide.ts         action and pass choice
│  ├─ src/events.ts         event builder, match clock
│  ├─ src/resolve.ts        time-to-intercept flight resolution
│  ├─ src/shot.ts           shot resolution
│  ├─ src/step.ts           initMatch / step / isFinished
│  ├─ src/index.ts          public API
│  └─ scripts/run-match.ts  one-match stats
├─ packages/league/          fictional league (Task 9) → data/league/league.json
├─ packages/schema/          Effect Schema for the domain stream (Task 10)
├─ packages/sim/             CDF export, Effect streams, writer, CLI (Tasks 11–12)
├─ python/analytics/         CDF validation via uv (Task 12)
└─ ATTRIBUTION.md, README.md (Task 13)
```

---

### Task 1: Monorepo scaffold and CI

Create the pnpm + Turborepo workspace with the first package (`@touchline/sim-core`) and a CI job, proven by a smoke test. Work in the existing `touchline/` repo (it already holds `docs/`).

**Files:**
- Create: `package.json`, `pnpm-workspace.yaml`, `turbo.json`, `tsconfig.base.json`, `.gitignore`, `.nvmrc`
- Create: `packages/sim-core/package.json`, `packages/sim-core/tsconfig.json`, `packages/sim-core/vitest.config.ts`, `packages/sim-core/src/index.ts` (placeholder)
- Create: `.github/workflows/ci.yml`
- Test: `packages/sim-core/test/smoke.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: root scripts `pnpm test`, `pnpm typecheck`, `pnpm sim`, `pnpm league` (the last two start working in Tasks 9 and 12); package `@touchline/sim-core` with exports `.` → `src/index.ts` and `./testing` → `src/testing.ts`.

- [ ] **Step 1: Write the workspace files**

`package.json`

```json
{
  "name": "touchline",
  "private": true,
  "type": "module",
  "packageManager": "pnpm@11.27.0",
  "engines": { "node": ">=22" },
  "scripts": {
    "test": "turbo run test",
    "typecheck": "turbo run typecheck",
    "sim": "pnpm --filter @touchline/sim run sim",
    "league": "pnpm --filter @touchline/league run generate"
  },
  "devDependencies": {
    "@types/node": "22.20.5",
    "tsx": "4.23.15",
    "turbo": "2.11.6",
    "typescript": "5.9.3",
    "vitest": "5.0.3"
  }
}
```

`pnpm-workspace.yaml` — `allowBuilds` is required: pnpm 11 blocks esbuild's install script otherwise

```yaml
packages:
  - "packages/*"
allowBuilds:
  esbuild: true
```

`turbo.json` — `agentGuidance: false` stops turbo writing an AGENTS.md when it detects an AI agent

```json
{
  "$schema": "https://turborepo.com/schema.json",
  "agentGuidance": false,
  "tasks": {
    "typecheck": {},
    "test": { "outputs": [] }
  }
}
```

`tsconfig.base.json`

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "skipLibCheck": true,
    "noEmit": true,
    "types": ["node"]
  }
}
```

`.gitignore`

```text
node_modules/
.turbo/
out/
data/raw/
.venv/
__pycache__/
*.pyc
```

`.nvmrc`

```text
22
```


- [ ] **Step 2: Write the sim-core package files and a smoke test**

`packages/sim-core/package.json`

```json
{
  "name": "@touchline/sim-core",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "exports": { ".": "./src/index.ts", "./testing": "./src/testing.ts" },
  "scripts": { "test": "vitest run", "typecheck": "tsc --noEmit -p .", "match": "tsx scripts/run-match.ts" },
  "dependencies": {  },
  "devDependencies": {  }
}
```

`packages/sim-core/tsconfig.json`

```json
{ "extends": "../../tsconfig.base.json", "include": ["src", "test", "scripts"] }
```

`packages/sim-core/vitest.config.ts`

```ts
import { defineConfig } from "vitest/config"

export default defineConfig({ test: { testTimeout: 120_000 } })
```

`packages/sim-core/src/index.ts` — placeholder, replaced in Task 8

```ts
export {}
```

`packages/sim-core/test/smoke.test.ts`

```ts
import { describe, expect, it } from "vitest"

describe("workspace", () => {
  it("runs tests", () => {
    expect(1 + 1).toBe(2)
  })
})
```

- [ ] **Step 3: Install and run the smoke test**

```bash
corepack enable
pnpm install
```

Run: `pnpm test`
Expected: `Tasks: 1 successful`, `Tests 1 passed`. If install fails with `ERR_PNPM_MINIMUM_RELEASE_AGE_VIOLATION`, a pinned version is less than a day old: pin the previous release (see Global Constraints).

- [ ] **Step 4: Write the CI workflow**

`.github/workflows/ci.yml` — final version arrives in Task 12

```yaml
name: ci
on:
  push:
  pull_request:
jobs:
  typescript:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: pnpm
      - run: pnpm install --frozen-lockfile
      - run: pnpm typecheck
      - run: pnpm test
```

- [ ] **Step 5: Commit**

```bash
git add package.json pnpm-workspace.yaml pnpm-lock.yaml turbo.json tsconfig.base.json .gitignore .nvmrc packages/sim-core .github
git commit -m "chore: scaffold pnpm/turbo monorepo with sim-core package and CI

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```



### Task 2: Deterministic, splittable PRNG

Every random draw in the engine comes from here. sfc32 with a murmur3-finaliser seeder, immutable state (it lives inside `MatchState`), a small mutable `Rng` cursor for use within one step, and independent sub-streams per concern. Pinned test vectors guard replay.

**Files:**
- Create: `packages/sim-core/src/rng.ts`
- Test: `packages/sim-core/test/rng.test.ts`
- Delete: `packages/sim-core/test/smoke.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `interface RngState {a,b,c,d}`; `seedRng(seed: number): RngState`; `substream(seed: number, concern: string, n?: number): RngState`; `nextU32(s): readonly [number, RngState]`; `class Rng { state; u32(); uniform(); range(lo,hi); chance(p); normal(); weighted(weights): number }`; `hazard(ratePerSecond: number, dtSeconds: number): number`.

- [ ] **Step 1: Write the failing test**

`packages/sim-core/test/rng.test.ts`

```ts
import { describe, expect, it } from "vitest"
import { hazard, nextU32, Rng, seedRng, substream } from "../src/rng.js"

describe("rng", () => {
  it("is deterministic for a seed", () => {
    const a = new Rng(seedRng(42)), b = new Rng(seedRng(42))
    const xs = Array.from({ length: 5 }, () => a.u32()), ys = Array.from({ length: 5 }, () => b.u32())
    expect(xs).toEqual(ys)
  })
  it("matches pinned test vectors", () => {
    const r = new Rng(seedRng(1))
    expect(Array.from({ length: 3 }, () => r.u32())).toEqual(VECTORS_SEED_1)
  })
  it("gives independent substreams per concern", () => {
    const a = new Rng(substream(7, "decision")).u32(), b = new Rng(substream(7, "execution")).u32()
    expect(a).not.toEqual(b)
  })
  it("never mutates state passed in", () => {
    const s = seedRng(3)
    nextU32(s)
    expect(nextU32(s)[0]).toEqual(nextU32(s)[0])
  })
  it("uniform has mean ~0.5 and normal has sd ~1", () => {
    const r = new Rng(seedRng(9))
    let su = 0, sn = 0, sn2 = 0
    const n = 50000
    for (let i = 0; i < n; i++) { su += r.uniform(); const z = r.normal(); sn += z; sn2 += z * z }
    expect(su / n).toBeCloseTo(0.5, 2)
    expect(Math.sqrt(sn2 / n - (sn / n) ** 2)).toBeCloseTo(1, 1)
  })
  it("weighted respects zero weights", () => {
    const r = new Rng(seedRng(5))
    for (let i = 0; i < 200; i++) expect(r.weighted([0, 1, 0])).toBe(1)
    expect(r.weighted([0, 0])).toBe(-1)
  })
  it("hazard is tick-length independent over one second", () => {
    const perTick = (dt: number) => 1 - (1 - hazard(0.7, dt)) ** Math.round(1 / dt)
    expect(perTick(0.1)).toBeCloseTo(perTick(0.04), 10)
  })
})
const VECTORS_SEED_1 = [798213712, 3639092730, 3492534296]
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `pnpm --filter @touchline/sim-core test rng`
Expected: FAIL — `Cannot find module '../src/rng.js'`

- [ ] **Step 3: Implement the PRNG**

`packages/sim-core/src/rng.ts`

```ts
/**
 * Deterministic, splittable PRNG for the simulator.
 *
 * sfc32 generator with a murmur3-finaliser seeder. State is a plain immutable
 * record so it can live inside MatchState; `Rng` is a small mutable cursor used
 * inside one step and written back afterwards.
 */
export interface RngState {
  readonly a: number
  readonly b: number
  readonly c: number
  readonly d: number
}

const fmix32 = (input: number): number => {
  let h = input >>> 0
  h ^= h >>> 16
  h = Math.imul(h, 0x85ebca6b)
  h ^= h >>> 13
  h = Math.imul(h, 0xc2b2ae35)
  h ^= h >>> 16
  return h >>> 0
}

const hashString = (s: string): number => {
  let h = 0x811c9dc5
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return h >>> 0
}

export const nextU32 = (s: RngState): readonly [number, RngState] => {
  let { a, b, c, d } = s
  let t = (a + b) >>> 0
  a = (b ^ (b >>> 9)) >>> 0
  b = (c + (c << 3)) >>> 0
  c = ((c << 21) | (c >>> 11)) >>> 0
  d = (d + 1) >>> 0
  t = (t + d) >>> 0
  c = (c + t) >>> 0
  return [t, { a, b, c, d }]
}

export const seedRng = (seed: number): RngState => {
  let s = seed >>> 0
  const next = () => {
    s = (s + 0x9e3779b9) >>> 0
    return fmix32(s)
  }
  let state: RngState = { a: next(), b: next(), c: next(), d: 1 }
  for (let i = 0; i < 12; i++) state = nextU32(state)[1]
  return state
}

/** Independent stream for one concern ("decision", "execution", ...). */
export const substream = (seed: number, concern: string, n = 0): RngState =>
  seedRng(fmix32((seed >>> 0) ^ hashString(concern) ^ Math.imul(n + 1, 0x27d4eb2d)))

export class Rng {
  #s: RngState
  constructor(state: RngState) {
    this.#s = state
  }
  get state(): RngState {
    return this.#s
  }
  u32(): number {
    const [v, next] = nextU32(this.#s)
    this.#s = next
    return v
  }
  /** Uniform in [0, 1). */
  uniform(): number {
    return this.u32() / 4294967296
  }
  range(lo: number, hi: number): number {
    return lo + (hi - lo) * this.uniform()
  }
  chance(p: number): boolean {
    return this.uniform() < p
  }
  /** Standard normal via Box-Muller (one value per call, no caching, so draws stay countable). */
  normal(): number {
    const u = Math.max(this.uniform(), 1e-12)
    const v = this.uniform()
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v)
  }
  /** Index drawn proportionally to non-negative weights; -1 if all weights are zero. */
  weighted(weights: ReadonlyArray<number>): number {
    let total = 0
    for (const w of weights) total += Math.max(0, w)
    if (total <= 0) return -1
    let r = this.uniform() * total
    for (let i = 0; i < weights.length; i++) {
      r -= Math.max(0, weights[i]!)
      if (r < 0) return i
    }
    return weights.length - 1
  }
}

/** Convert a per-second hazard rate into a per-tick probability (tick-length independent). */
export const hazard = (ratePerSecond: number, dtSeconds: number): number =>
  1 - Math.exp(-Math.max(0, ratePerSecond) * dtSeconds)
```

- [ ] **Step 4: Run the tests**

Run: `pnpm --filter @touchline/sim-core test rng`
Expected: 7 passed. The pinned vector test proves sfc32 is implemented exactly; if it fails, compare the step order with the code above (t uses the *incremented* d).

- [ ] **Step 5: Remove the smoke test and commit**

```bash
git rm packages/sim-core/test/smoke.test.ts
```

```bash
git add packages/sim-core/src/rng.ts packages/sim-core/test/rng.test.ts
git commit -m "feat(sim-core): deterministic splittable PRNG with pinned vectors

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```



### Task 3: Geometry, parameters, pass classifier and core types

Pitch geometry in CDF coordinates (metres, origin at the centre spot, home attacks +x), the `Params` contract with hand-set priors and a provenance/licence gate, the geometric pass classifier from spec §5.1.10, and the core type definitions every later module uses.

**Files:**
- Create: `packages/sim-core/src/geometry.ts`, `packages/sim-core/src/params.ts`, `packages/sim-core/src/classify.ts`, `packages/sim-core/src/types.ts`
- Test: `packages/sim-core/test/geometry-classify.test.ts`, `packages/sim-core/test/params.test.ts`

**Interfaces:**
- Consumes: `RngState` (Task 2).
- Produces (geometry): `PITCH`, `type Side`, `other`, `dirOf`, `Vec2`, `Vec3`, `v2/add/sub/scale/len/dist/dot/norm/clamp/clampToPitch/inPitch`, `attackX(side, x)`, `goalOf(side)`, `zoneIndex(p)`, `ACTION_ZONES`, `type ActionZone`, `actionZone(side, p)`, `goalAngle(side, p)`.
- Produces (params): `ACTIONS` (13 actions), `type Action`, `ALLOWED_LICENCES`, `interface Provenance`, `interface ClassifierThresholds`, `interface Params`, `DEFAULT_PARAMS`, `class ParamsError`, `assertProvenance(p)`.
- Produces (classify): `PASS_KINDS`, `type PassKind`, `type PassHeight`, `interface PassGeometry`, `classifyPass(g, thresholds): PassKind`.
- Produces (types): `Role`, `FormationName`, `Period`, `PlayerAttrs`, `TeamStyle`, `PlayerSetup`, `TeamSetup`, `MatchConfig`, `Intent`, `PlayerState`, `BallState`, `ActionKind`, `Flight`, `FlightOutcome`, `Possession`, `RestartKind`, `Phase`, `EventType`, `AttrValue`, `DomainEvent`, `PendingEvent`, `FramePlayer`, `Frame`, `CONCERNS`, `Concern`, `MatchState`, `StepResult`.

- [ ] **Step 1: Write the failing tests**

`packages/sim-core/test/geometry-classify.test.ts`

```ts
import { describe, expect, it } from "vitest"
import { classifyPass } from "../src/classify.js"
import { actionZone, attackX, goalAngle, zoneIndex } from "../src/geometry.js"
import { DEFAULT_PARAMS } from "../src/params.js"

const T = DEFAULT_PARAMS.classifier
const C = (from: [number, number], to: [number, number], height: "ground" | "high" = "ground", lastDef = 30, side: "home" | "away" = "home") =>
  classifyPass({ side, from: { x: from[0], y: from[1] }, to: { x: to[0], y: to[1] }, height, lastDefenderAttackX: lastDef }, T)

describe("geometry", () => {
  it("indexes the 16x12 grid from the bottom-left corner", () => {
    expect(zoneIndex({ x: -52.5, y: -34 })).toBe(0)
    expect(zoneIndex({ x: 52.5, y: 34 })).toBe(16 * 12 - 1)
  })
  it("mirrors attack direction for the away side", () => {
    expect(attackX("home", 30)).toBe(30)
    expect(attackX("away", 30)).toBe(-30)
    expect(actionZone("away", { x: -45, y: 0 })).toBe("box")
  })
  it("goal angle shrinks with distance", () => {
    expect(goalAngle("home", { x: 41.5, y: 0 })).toBeGreaterThan(goalAngle("home", { x: 22.5, y: 0 }))
  })
})

describe("classifyPass", () => {
  it("short and long by length", () => {
    expect(C([0, 0], [15, 5])).toBe("short")
    expect(C([-30, 0], [5, 3])).toBe("long")
  })
  it("through ball beyond the last defender, lofted when high", () => {
    expect(C([10, 0], [36, 2], "ground", 30)).toBe("through")
    expect(C([10, 0], [36, 2], "high", 30)).toBe("lofted_through")
  })
  it("switch crosses the centreline laterally", () => {
    expect(C([0, -20], [8, 12])).toBe("switch")
  })
  it("cross from wide into the box", () => {
    expect(C([40, -28], [47, 2], "high", 50)).toBe("cross")
  })
  it("cutback from the byline back to the spot area", () => {
    expect(C([49, -12], [43, -2], "ground", 52)).toBe("cutback")
  })
  it("back pass", () => {
    expect(C([0, 0], [-12, 2])).toBe("back")
  })
  it("is symmetric for the away side", () => {
    expect(C([-10, 0], [-36, 2], "ground", 30, "away")).toBe("through")
  })
})
```

`packages/sim-core/test/params.test.ts`

```ts
import { describe, expect, it } from "vitest"
import { ACTIONS, assertProvenance, DEFAULT_PARAMS, ParamsError } from "../src/params.js"
import { ACTION_ZONES } from "../src/geometry.js"

describe("params", () => {
  it("default priors carry provenance and pass the licence check", () => {
    expect(() => assertProvenance(DEFAULT_PARAMS)).not.toThrow()
  })
  it("rejects files with no provenance, a disallowed licence, or StatsBomb data", () => {
    expect(() => assertProvenance({})).toThrow(ParamsError)
    expect(() => assertProvenance({ provenance: { ...DEFAULT_PARAMS.provenance, licence: "proprietary" } })).toThrow(/not allowed/)
    expect(() => assertProvenance({ provenance: { ...DEFAULT_PARAMS.provenance, dataset: "StatsBomb open data", licence: "CC-BY-4.0" } })).toThrow(/StatsBomb/)
  })
  it("has a logit for every action in every zone", () => {
    for (const z of ACTION_ZONES) for (const a of ACTIONS) expect(Number.isFinite(DEFAULT_PARAMS.actions.logits[z][a])).toBe(true)
  })
})
```

- [ ] **Step 2: Run them to make sure they fail**

Run: `pnpm --filter @touchline/sim-core test geometry params`
Expected: FAIL — modules not found

- [ ] **Step 3: Implement geometry**

`packages/sim-core/src/geometry.ts`

```ts
/** Pitch geometry in CDF coordinates: metres, origin at the centre spot, home attacks +x. */
export const PITCH = {
  length: 105,
  width: 68,
  halfL: 52.5,
  halfW: 34,
  goalHalfWidth: 3.66,
  goalHeight: 2.44,
  boxDepth: 16.5,
  boxHalfWidth: 20.16,
  sixDepth: 5.5,
  penaltySpot: 41.5,
  centreCircle: 9.15
} as const

export type Side = "home" | "away"
export const other = (side: Side): Side => (side === "home" ? "away" : "home")
/** +1 if the side attacks +x (home), -1 otherwise. */
export const dirOf = (side: Side): 1 | -1 => (side === "home" ? 1 : -1)

export interface Vec2 {
  readonly x: number
  readonly y: number
}
export interface Vec3 {
  readonly x: number
  readonly y: number
  readonly z: number
}

export const v2 = (x: number, y: number): Vec2 => ({ x, y })
export const add = (a: Vec2, b: Vec2): Vec2 => ({ x: a.x + b.x, y: a.y + b.y })
export const sub = (a: Vec2, b: Vec2): Vec2 => ({ x: a.x - b.x, y: a.y - b.y })
export const scale = (a: Vec2, k: number): Vec2 => ({ x: a.x * k, y: a.y * k })
export const len = (a: Vec2): number => Math.hypot(a.x, a.y)
export const dist = (a: Vec2, b: Vec2): number => Math.hypot(a.x - b.x, a.y - b.y)
export const dot = (a: Vec2, b: Vec2): number => a.x * b.x + a.y * b.y
export const norm = (a: Vec2): Vec2 => {
  const l = len(a)
  return l < 1e-9 ? { x: 0, y: 0 } : { x: a.x / l, y: a.y / l }
}
export const clamp = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, v))
export const clampToPitch = (p: Vec2, margin = 0.5): Vec2 => ({
  x: clamp(p.x, -PITCH.halfL + margin, PITCH.halfL - margin),
  y: clamp(p.y, -PITCH.halfW + margin, PITCH.halfW - margin)
})
export const inPitch = (p: Vec2): boolean => Math.abs(p.x) <= PITCH.halfL && Math.abs(p.y) <= PITCH.halfW

/** x as seen by the attacking side: larger is closer to the goal it attacks. */
export const attackX = (side: Side, x: number): number => x * dirOf(side)
/** Centre of the goal `side` attacks. */
export const goalOf = (side: Side): Vec2 => ({ x: PITCH.halfL * dirOf(side), y: 0 })

/** 16 x 12 grid index (row-major, row 0 at y = -34), used by fitted tables. */
export const zoneIndex = (p: Vec2, cols = 16, rows = 12): number => {
  const col = clamp(Math.floor(((p.x + PITCH.halfL) / PITCH.length) * cols), 0, cols - 1)
  const row = clamp(Math.floor(((p.y + PITCH.halfW) / PITCH.width) * rows), 0, rows - 1)
  return row * cols + col
}

export const ACTION_ZONES = ["def_wide", "def_central", "mid_wide", "mid_central", "att_wide", "att_central", "box"] as const
export type ActionZone = (typeof ACTION_ZONES)[number]

/** Coarse zone used for action logits, from the attacking side's point of view. */
export const actionZone = (side: Side, p: Vec2): ActionZone => {
  const ax = attackX(side, p.x)
  const wide = Math.abs(p.y) > PITCH.boxHalfWidth
  if (ax > PITCH.halfL - PITCH.boxDepth && !wide) return "box"
  if (ax < -17.5) return wide ? "def_wide" : "def_central"
  if (ax < 17.5) return wide ? "mid_wide" : "mid_central"
  return wide ? "att_wide" : "att_central"
}

/** Angle (radians) subtended by the goal mouth from p, for the goal `side` attacks. */
export const goalAngle = (side: Side, p: Vec2): number => {
  const g = goalOf(side)
  const a1 = Math.atan2(PITCH.goalHalfWidth - p.y, g.x - p.x)
  const a2 = Math.atan2(-PITCH.goalHalfWidth - p.y, g.x - p.x)
  return Math.abs(a1 - a2) > Math.PI ? 2 * Math.PI - Math.abs(a1 - a2) : Math.abs(a1 - a2)
}
```

- [ ] **Step 4: Implement params (priors are guesses; Plan 2 replaces them with fitted values)**

`packages/sim-core/src/params.ts`

```ts
import type { ActionZone } from "./geometry.js"

export const ACTIONS = [
  "short_pass",
  "long_pass",
  "through_ball",
  "lofted_through",
  "switch",
  "cross",
  "cutback",
  "back_pass",
  "carry",
  "take_on",
  "shot",
  "clear",
  "hold"
] as const
export type Action = (typeof ACTIONS)[number]

export const ALLOWED_LICENCES = ["CC-BY-4.0", "MIT", "hand-set-prior"] as const

export interface Provenance {
  readonly dataset: string
  readonly licence: string
  readonly attribution: string
  readonly fitted_at: string
  readonly version: string
}

export interface ClassifierThresholds {
  readonly longPassM: number
  readonly switchLateralM: number
  readonly backPassM: number
  readonly carryMinM: number
  readonly crossOriginAbsY: number
  readonly finalThirdAttackX: number
  readonly cutbackOriginAttackX: number
  readonly cutbackTargetAttackXMin: number
  readonly cutbackTargetAttackXMax: number
  readonly cutbackTargetAbsY: number
}

export interface Params {
  readonly provenance: Provenance
  readonly kinematics: {
    readonly vmaxBase: number
    readonly accelMax: number
    readonly reactionS: number
    readonly reachM: number
    readonly controlHeightM: number
    readonly headerHeightM: number
  }
  readonly ball: {
    readonly drag: number
    readonly rollDecel: number
    readonly bounce: number
    readonly gravity: number
    readonly substeps: number
  }
  readonly timing: {
    readonly decisionMinS: number
    readonly decisionMaxS: number
    readonly keeperHoldS: number
    readonly restartDelayS: Readonly<Record<"kickoff" | "throw_in" | "corner" | "goal_kick" | "free_kick" | "penalty", number>>
    readonly addedTimeMinS: readonly [number, number]
  }
  readonly actions: {
    readonly logits: Readonly<Record<ActionZone, Readonly<Record<Action, number>>>>
    readonly styleWeight: number
    readonly pressureWeight: number
  }
  readonly pass: {
    readonly xpass: { readonly b0: number; readonly bDist: number; readonly bLane: number; readonly bPressure: number; readonly bHigh: number }
    readonly arriveSpeed: number
    readonly highLaunchDeg: number
    readonly throughLeadM: number
    readonly choiceTemperature: number
  }
  readonly execution: {
    readonly dirSigma: number
    readonly distSigma: number
    readonly pressureK: number
    readonly weakFootK: number
    readonly mishitBase: number
    readonly mishitK: number
  }
  readonly shot: {
    readonly xg: { readonly b0: number; readonly bDist: number; readonly bAngle: number; readonly bHeader: number; readonly bDefenders: number }
    readonly maxDistanceM: number
    readonly speed: number
    readonly onTargetRate: number
    readonly blockPerDefender: number
  }
  readonly defending: {
    readonly pressRatePerS: number
    readonly pressRadiusM: number
    readonly tackleRatePerS: number
    readonly tackleRadiusM: number
    readonly tackleBase: number
    readonly foulPerTackle: number
    readonly yellowPerFoul: number
    readonly redPerFoul: number
    /** Share of won tackles / ground interceptions that knock the ball loose instead of winning it cleanly. */
    readonly tackleLooseShare: number
    readonly interceptLooseShare: number
  }
  readonly takeOn: { readonly b0: number; readonly bSkill: number; readonly bPressure: number }
  readonly carry: { readonly speed: number; readonly durationS: readonly [number, number] }
  readonly runs: { readonly runInBehindRatePerS: number }
  readonly classifier: ClassifierThresholds
}

const row = (o: Partial<Record<Action, number>>): Record<Action, number> => {
  const out = {} as Record<Action, number>
  for (const a of ACTIONS) out[a] = o[a] ?? -4
  return out
}

/**
 * Hand-set priors so the engine runs before the offline fit (Plan 2) replaces them.
 * Values are order-of-magnitude guesses, not fitted.
 */
export const DEFAULT_PARAMS: Params = {
  provenance: {
    dataset: "none (hand-set priors)",
    licence: "hand-set-prior",
    attribution: "Touchline authors",
    fitted_at: "2026-10-03",
    version: "prior-0"
  },
  kinematics: { vmaxBase: 9.2, accelMax: 4.5, reactionS: 0.7, reachM: 1.0, controlHeightM: 1.0, headerHeightM: 2.4 },
  ball: { drag: 0.013, rollDecel: 1.2, bounce: 0.55, gravity: 9.81, substeps: 4 },
  timing: {
    decisionMinS: 0.9,
    decisionMaxS: 2.2,
    keeperHoldS: 4,
    restartDelayS: { kickoff: 45, throw_in: 18, corner: 37, goal_kick: 30, free_kick: 25, penalty: 60 },
    addedTimeMinS: [60, 300]
  },
  actions: {
    logits: {
      def_wide: row({ short_pass: 1.6, long_pass: 0.4, switch: -0.6, back_pass: -0.1, carry: 0.5, take_on: -1.2, clear: -0.4, hold: -0.6 }),
      def_central: row({ short_pass: 1.8, long_pass: 0.5, switch: -0.4, back_pass: -0.2, carry: 0.4, take_on: -1.5, clear: -0.2, hold: -0.6 }),
      mid_wide: row({ short_pass: 1.7, long_pass: 0.0, through_ball: -0.6, lofted_through: -1.0, switch: -0.5, cross: -1.2, back_pass: -0.3, carry: 0.7, take_on: -0.4, hold: -0.6 }),
      mid_central: row({ short_pass: 1.9, long_pass: -0.1, through_ball: -0.3, lofted_through: -0.9, switch: -0.4, back_pass: -0.2, carry: 0.6, take_on: -0.6, shot: -3.0, hold: -0.6 }),
      att_wide: row({ short_pass: 1.3, long_pass: -1.0, through_ball: -0.4, lofted_through: -1.0, cross: 0.6, cutback: -0.2, back_pass: -0.2, carry: 0.6, take_on: 0.0, shot: -2.0, hold: -0.4 }),
      att_central: row({ short_pass: 1.4, long_pass: -1.2, through_ball: 0.1, lofted_through: -0.6, back_pass: -0.3, carry: 0.6, take_on: -0.2, shot: -1.2, hold: -0.5 }),
      box: row({ short_pass: 0.6, through_ball: -0.4, cutback: 0.4, back_pass: -0.7, carry: 0.2, take_on: 0.1, shot: 0.3, clear: -2.0, hold: -0.8 })
    },
    styleWeight: 1.0,
    pressureWeight: 1.0
  },
  pass: {
    xpass: { b0: 3.24, bDist: -0.08, bLane: -1.0, bPressure: -0.8, bHigh: -0.4 },
    arriveSpeed: 7,
    highLaunchDeg: 30,
    throughLeadM: 8,
    choiceTemperature: 0.35
  },
  execution: { dirSigma: 0.035, distSigma: 0.07, pressureK: 1.6, weakFootK: 1.45, mishitBase: 0.006, mishitK: 0.11 },
  shot: {
    xg: { b0: -3.38, bDist: -0.0443, bAngle: 5.06, bHeader: -1.0, bDefenders: -0.3 },
    maxDistanceM: 32,
    speed: 26,
    onTargetRate: 0.38,
    blockPerDefender: 0.15
  },
  defending: {
    pressRatePerS: 0.6,
    pressRadiusM: 3,
    tackleRatePerS: 0.35,
    tackleRadiusM: 1.6,
    tackleBase: 0.0,
    foulPerTackle: 0.18,
    yellowPerFoul: 0.15,
    redPerFoul: 0.004,
    tackleLooseShare: 0.4,
    interceptLooseShare: 0.3
  },
  takeOn: { b0: -0.2, bSkill: 3.0, bPressure: -0.8 },
  carry: { speed: 5.5, durationS: [0.8, 2.0] },
  runs: { runInBehindRatePerS: 0.12 },
  classifier: {
    longPassM: 32,
    switchLateralM: 25,
    backPassM: 5,
    carryMinM: 3,
    crossOriginAbsY: 20.16,
    finalThirdAttackX: 17.5,
    cutbackOriginAttackX: 41,
    cutbackTargetAttackXMin: 41.5,
    cutbackTargetAttackXMax: 47,
    cutbackTargetAbsY: 11
  }
}

export class ParamsError extends Error {}

/** Reject parameter files whose provenance licence is not on the allowed list. */
export const assertProvenance = (p: { provenance?: Partial<Provenance> }): void => {
  const pv = p.provenance
  if (!pv || !pv.dataset || !pv.licence || !pv.version) throw new ParamsError("params file is missing provenance")
  if (!(ALLOWED_LICENCES as ReadonlyArray<string>).includes(pv.licence))
    throw new ParamsError(`licence "${pv.licence}" is not allowed (allowed: ${ALLOWED_LICENCES.join(", ")})`)
  if (/statsbomb/i.test(pv.dataset)) throw new ParamsError("StatsBomb-derived parameters are not allowed")
}
```

- [ ] **Step 5: Implement the pass classifier**

`packages/sim-core/src/classify.ts`

```ts
import { attackX, PITCH, type Side, type Vec2 } from "./geometry.js"
import type { ClassifierThresholds } from "./params.js"

export const PASS_KINDS = ["short", "long", "through", "lofted_through", "switch", "cross", "cutback", "back"] as const
export type PassKind = (typeof PASS_KINDS)[number] | "set_piece"
export type PassHeight = "ground" | "low" | "high"

export interface PassGeometry {
  readonly side: Side
  readonly from: Vec2
  readonly to: Vec2
  readonly height: PassHeight
  /** Attack-normalised x of the last outfield defender (deepest opponent excluding the keeper). */
  readonly lastDefenderAttackX: number
}

/**
 * Classify a pass from geometry at release. The same rules run in Python on real data
 * (python/analytics/touchline_analytics/classify.py) against fixtures/pass-kinds.json.
 */
export const classifyPass = (g: PassGeometry, t: ClassifierThresholds): PassKind => {
  const fx = attackX(g.side, g.from.x)
  const tx = attackX(g.side, g.to.x)
  const dx = tx - fx
  const dy = g.to.y - g.from.y
  const length = Math.hypot(dx, dy)
  const targetInBox = tx > PITCH.halfL - PITCH.boxDepth && Math.abs(g.to.y) < PITCH.boxHalfWidth

  if (fx > t.finalThirdAttackX && Math.abs(g.from.y) > t.crossOriginAbsY && targetInBox) return "cross"
  if (
    fx > t.cutbackOriginAttackX &&
    dx < 0 &&
    tx >= t.cutbackTargetAttackXMin &&
    tx <= t.cutbackTargetAttackXMax &&
    Math.abs(g.to.y) < t.cutbackTargetAbsY
  )
    return "cutback"
  if (dx < -t.backPassM) return "back"
  if (tx > g.lastDefenderAttackX && fx < g.lastDefenderAttackX) return g.height === "high" ? "lofted_through" : "through"
  if (Math.abs(dy) >= t.switchLateralM && Math.sign(g.from.y) !== Math.sign(g.to.y)) return "switch"
  if (length >= t.longPassM) return "long"
  return "short"
}
```

- [ ] **Step 6: Implement the core types**

`packages/sim-core/src/types.ts`

```ts
import type { Side, Vec2, Vec3 } from "./geometry.js"
import type { Params } from "./params.js"
import type { RngState } from "./rng.js"

export type Role = "GK" | "CB" | "FB" | "DM" | "CM" | "AM" | "W" | "ST"
export type FormationName = "4-3-3" | "4-4-2" | "4-2-3-1" | "3-5-2"
export type Period = "first_half" | "second_half"

/** All attributes are 0..1. */
export interface PlayerAttrs {
  readonly pace: number
  readonly acceleration: number
  readonly shortPassing: number
  readonly longPassing: number
  readonly vision: number
  readonly crossing: number
  readonly dribbling: number
  readonly finishing: number
  readonly heading: number
  readonly tackling: number
  readonly composure: number
  readonly stamina: number
  readonly handling: number
  readonly reflexes: number
}

export interface TeamStyle {
  readonly archetype: "high_press" | "possession" | "direct" | "low_block"
  /** 0..1, drives press trigger rate (target PPDA). */
  readonly pressIntensity: number
  /** -1 (deep) .. 1 (high). */
  readonly lineHeight: number
  /** 0..1, higher = narrower block. */
  readonly compactness: number
  readonly tempo: number
  /** -1..1 bias on long passes. */
  readonly longBallBias: number
  readonly crossBias: number
  readonly riskTolerance: number
}

export interface PlayerSetup {
  readonly id: string
  readonly role: Role
  readonly jersey: number
  readonly attrs: PlayerAttrs
}

export interface TeamSetup {
  readonly id: string
  readonly name: string
  readonly formation: FormationName
  readonly style: TeamStyle
  /** Exactly 11 starters in formation slot order; slot 0 is the goalkeeper. */
  readonly starters: ReadonlyArray<PlayerSetup>
}

export interface MatchConfig {
  readonly matchId: string
  readonly seed: number
  readonly kickoffTime: string
  readonly home: TeamSetup
  readonly away: TeamSetup
  readonly params: Params
  /** Seconds per tick; 0.1 for 10 Hz, 0.04 for 25 Hz render runs. */
  readonly dt: number
}

export type Intent =
  | { readonly kind: "shape" }
  | { readonly kind: "press"; readonly targetId: string }
  | { readonly kind: "run_in_behind"; readonly target: Vec2 }
  | { readonly kind: "chase"; readonly target: Vec2 }
  | { readonly kind: "carry"; readonly dir: Vec2; readonly speed: number }
  | { readonly kind: "hold" }

export interface PlayerState {
  readonly id: string
  readonly side: Side
  readonly role: Role
  readonly slot: number
  readonly jersey: number
  readonly attrs: PlayerAttrs
  readonly pos: Vec2
  readonly vel: Vec2
  readonly intent: Intent
  /** Global tick at which the current intent expires. */
  readonly intentUntil: number
  /** 1 = fresh, 0 = exhausted. */
  readonly energy: number
  readonly yellow: number
  readonly sentOff: boolean
}

export interface BallState {
  readonly pos: Vec3
  readonly vel: Vec3
}

export type ActionKind = "pass" | "shot" | "clearance"

/** A ball in flight whose outcome was resolved at release (see resolve.ts and shot.ts). */
export interface Flight {
  readonly kind: ActionKind
  readonly fromId: string
  readonly side: Side
  readonly releaseTick: number
  readonly resolveTick: number
  /** Player who gains the ball at resolveTick, or null when it goes out / stops loose. */
  readonly winnerId: string | null
  readonly outcome: FlightOutcome
  /** Main event (pass / shot / clearance), emitted at resolution with frame_id = releaseTick. */
  readonly pending: PendingEvent
  /** Events emitted right after the main one (reception, interception, goal, keeper_save, ...). */
  readonly extra: ReadonlyArray<PendingEvent>
  /** Straight-line path for shots; null means the ball follows stepBall physics. */
  readonly path: { readonly from: Vec3; readonly to: Vec3 } | null
  /** Restart that follows the resolution (ball out, offside, goal), if any. */
  readonly restartAfter: { readonly restart: RestartKind; readonly side: Side; readonly at: Vec2 } | null
  /** Ball state to set after resolution when the ball stays live but loose (parry, block). */
  readonly looseBall: BallState | null
}

export type FlightOutcome =
  | "successful"
  | "intercepted"
  | "out_of_play"
  | "offside"
  | "loose"
  | "goal"
  | "saved"
  | "blocked"
  | "wide"

export type Possession =
  | { readonly kind: "owned"; readonly playerId: string; readonly since: number; readonly restart: RestartKind | null }
  | { readonly kind: "in_flight"; readonly flight: Flight }
  | { readonly kind: "loose" }
  | { readonly kind: "dead" }

export type RestartKind = "kickoff" | "throw_in" | "corner" | "goal_kick" | "free_kick" | "penalty"

export type Phase =
  | { readonly kind: "open_play" }
  | {
      readonly kind: "restart"
      readonly restart: RestartKind
      readonly side: Side
      readonly at: Vec2
      readonly resumeTick: number
    }
  | { readonly kind: "full_time" }

export type EventType =
  | "match_start"
  | "period_start"
  | "period_end"
  | "match_end"
  | "pass"
  | "reception"
  | "carry"
  | "take_on"
  | "shot"
  | "goal"
  | "keeper_save"
  | "keeper_distribution"
  | "aerial_duel"
  | "pressure"
  | "tackle"
  | "interception"
  | "block"
  | "clearance"
  | "ball_recovery"
  | "possession_change"
  | "ball_out"
  | "foul"
  | "card"
  | "offside"
  | "set_piece"

export type AttrValue = string | number | boolean | null | ReadonlyArray<string>

export interface DomainEvent {
  readonly id: string
  readonly match_id: string
  readonly type: EventType
  /** Global tick (counts across periods). */
  readonly frame_id: number
  /** CDF frame id (restarts at 0 each period). */
  readonly period_frame_id: number
  readonly period: Period
  readonly match_clock: string
  readonly team_id: string | null
  readonly player_id: string | null
  readonly x: number | null
  readonly y: number | null
  readonly x_end: number | null
  readonly y_end: number | null
  readonly frame_id_end: number | null
  readonly outcome: string | null
  readonly source: "sim"
  readonly confidence: 1
  readonly attrs: Readonly<Record<string, AttrValue>>
}

/** Event under construction, emitted later (flights) or immediately. */
export interface PendingEvent {
  readonly type: EventType
  readonly frame_id: number
  readonly team_id: string | null
  readonly player_id: string | null
  readonly x: number | null
  readonly y: number | null
  readonly x_end: number | null
  readonly y_end: number | null
  readonly attrs: Readonly<Record<string, AttrValue>>
}

export interface FramePlayer {
  readonly id: string
  readonly x: number
  readonly y: number
}

export interface Frame {
  /** Global tick. */
  readonly tick: number
  /** CDF frame id (restarts at 0 each period). */
  readonly frame_id: number
  readonly period: Period
  readonly timestamp: string
  readonly home: ReadonlyArray<FramePlayer>
  readonly away: ReadonlyArray<FramePlayer>
  readonly ball: Vec3
  readonly ball_in_play: boolean
  readonly possession_side: Side | null
}

export const CONCERNS = ["decision", "execution", "duel", "referee", "movement", "restart", "script"] as const
export type Concern = (typeof CONCERNS)[number]

export interface MatchState {
  readonly config: MatchConfig
  readonly tick: number
  readonly period: Period
  readonly periodTick: number
  readonly periodTicks: number
  readonly periodStartMs: number
  readonly phase: Phase
  readonly ball: BallState
  readonly possession: Possession
  readonly players: ReadonlyArray<PlayerState>
  readonly score: { readonly home: number; readonly away: number }
  readonly lastTouch: { readonly playerId: string; readonly side: Side } | null
  readonly pressedBy: ReadonlyArray<string>
  /** Carry in progress (start point and tick), to emit a carry event when it ends. */
  readonly carry: { readonly playerId: string; readonly at: Vec2; readonly tick: number } | null
  readonly rng: Readonly<Record<Concern, RngState>>
  readonly eventSeq: number
}

export interface StepResult {
  readonly state: MatchState
  readonly frame: Frame | null
  readonly events: ReadonlyArray<DomainEvent>
}
```

- [ ] **Step 7: Run the tests and typecheck**

Run: `pnpm --filter @touchline/sim-core test geometry params && pnpm --filter @touchline/sim-core typecheck`
Expected: 13 passed (10 geometry/classifier + 3 params), no type errors

- [ ] **Step 8: Commit**

```bash
git add packages/sim-core/src packages/sim-core/test
git commit -m "feat(sim-core): geometry, params with provenance gate, pass classifier, core types

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```



### Task 4: Ball physics and player kinematics

3D ball with gravity, quadratic drag, bounce and rolling friction (sub-stepped); launch velocities, where lofted balls are solved by bisection so they first land on target; Reynolds arrive/separation with speed and acceleration caps; constant-bearing interception.

**Files:**
- Create: `packages/sim-core/src/ball.ts`, `packages/sim-core/src/kinematics.ts`
- Test: `packages/sim-core/test/physics.test.ts`

**Interfaces:**
- Consumes: geometry, `Params`, `PlayerAttrs`, `BallState` (Task 3).
- Produces (ball): `stepBall(ball, dt, p.ball): BallState`; `groundLaunchSpeed(distance, arriveSpeed, p.ball)`; `carryDistance(speed, deg, p.ball)`; `launchVelocity(from, to, height, params): Vec3`.
- Produces (kinematics): `vmaxFor(attrs, energy, params)`; `accelFor(attrs, params)`; `arrive(pos, vel, target, vmax, amax, dt, slowRadius?) → {pos, vel}`; `separation(pos, others, radius?)`; `interceptPoint(chaser, speed, target, targetVel): Vec2`.

- [ ] **Step 1: Write the failing test**

`packages/sim-core/test/physics.test.ts`

```ts
import { describe, expect, it } from "vitest"
import { carryDistance, launchVelocity, stepBall } from "../src/ball.js"
import { arrive, interceptPoint } from "../src/kinematics.js"
import { DEFAULT_PARAMS as P } from "../src/params.js"
import type { BallState } from "../src/types.js"

const roll = (b: BallState, s: number): BallState => { let x = b; for (let i = 0; i < s / 0.1; i++) x = stepBall(x, 0.1, P.ball); return x }

describe("ball", () => {
  it("a ground pass slows and stops", () => {
    const end = roll({ pos: { x: 0, y: 0, z: 0 }, vel: { x: 12, y: 0, z: 0 } }, 20)
    expect(Math.hypot(end.vel.x, end.vel.y)).toBe(0)
    expect(end.pos.x).toBeGreaterThan(20)
    expect(end.pos.x).toBeLessThan(45)
  })
  it("a lofted ball first lands at its target (within 1 m)", () => {
    for (const d of [25, 40, 55]) {
      const v = launchVelocity({ x: 0, y: 0 }, { x: d, y: 0 }, "high", P)
      const s = Math.hypot(v.x, v.z)
      expect(Math.abs(carryDistance(s, P.pass.highLaunchDeg, P.ball) - d)).toBeLessThan(1)
    }
  })
  it("bounces lose height", () => {
    let b: BallState = { pos: { x: 0, y: 0, z: 5 }, vel: { x: 0, y: 0, z: 0 } }
    let peak = 0, landed = false
    for (let i = 0; i < 60; i++) { b = stepBall(b, 0.1, P.ball); if (b.pos.z === 0) landed = true; if (landed) peak = Math.max(peak, b.pos.z) }
    expect(peak).toBeLessThan(5 * P.ball.bounce)
  })
})

describe("kinematics", () => {
  it("arrive respects speed and acceleration caps and does not overshoot", () => {
    let s = { pos: { x: 0, y: 0 }, vel: { x: 0, y: 0 } }
    let maxV = 0
    for (let i = 0; i < 100; i++) {
      const prev = s.vel
      s = arrive(s.pos, s.vel, { x: 20, y: 0 }, 8, 4, 0.1)
      maxV = Math.max(maxV, Math.hypot(s.vel.x, s.vel.y))
      expect(Math.hypot(s.vel.x - prev.x, s.vel.y - prev.y)).toBeLessThanOrEqual(0.4 + 1e-9)
    }
    expect(maxV).toBeLessThanOrEqual(8)
    expect(Math.abs(s.pos.x - 20)).toBeLessThan(0.5)
  })
  it("constant-bearing intercept leads a moving target", () => {
    const p = interceptPoint({ x: 0, y: -10 }, 8, { x: 0, y: 0 }, { x: 5, y: 0 })
    expect(p.x).toBeGreaterThan(0)
    const t = Math.hypot(p.x, p.y + 10) / 8
    expect(p.x).toBeCloseTo(5 * t, 5)
  })
})
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `pnpm --filter @touchline/sim-core test physics`
Expected: FAIL — modules not found

- [ ] **Step 3: Implement ball physics**

`packages/sim-core/src/ball.ts`

```ts
import type { Vec2, Vec3 } from "./geometry.js"
import type { Params } from "./params.js"
import type { BallState } from "./types.js"

type BallParams = Params["ball"]

/** Advance the ball by dt seconds: gravity, quadratic drag, bounce and rolling friction. */
export const stepBall = (ball: BallState, dt: number, p: BallParams): BallState => {
  let { x, y, z } = ball.pos
  let { x: vx, y: vy, z: vz } = ball.vel
  const h = dt / p.substeps
  for (let i = 0; i < p.substeps; i++) {
    const airborne = z > 1e-6 || vz > 1e-6
    if (airborne) {
      const speed = Math.hypot(vx, vy, vz)
      const k = p.drag * speed * h
      vx -= k * vx
      vy -= k * vy
      vz -= k * vz + p.gravity * h
      x += vx * h
      y += vy * h
      z += vz * h
      if (z <= 0) {
        z = 0
        vz = -vz * p.bounce
        vx *= 0.85
        vy *= 0.85
        if (vz < 0.6) vz = 0
      }
    } else {
      z = 0
      vz = 0
      const speed = Math.hypot(vx, vy)
      if (speed > 0) {
        const next = Math.max(0, speed - (p.rollDecel + p.drag * speed * speed) * h)
        const f = next / speed
        vx *= f
        vy *= f
        x += vx * h
        y += vy * h
      }
    }
  }
  return { pos: { x, y, z }, vel: { x: vx, y: vy, z: vz } }
}

/** Ground pass speed that arrives at `arriveSpeed` after `distance` metres of rolling (drag ignored). */
export const groundLaunchSpeed = (distance: number, arriveSpeed: number, p: BallParams): number =>
  Math.sqrt(arriveSpeed * arriveSpeed + 2 * (p.rollDecel + 1.2) * Math.max(0, distance))

/** Horizontal distance at which a ball launched at `speed` and `deg` first touches the ground. */
export const carryDistance = (speed: number, deg: number, p: BallParams): number => {
  const th = (deg * Math.PI) / 180
  let b: BallState = { pos: { x: 0, y: 0, z: 0 }, vel: { x: speed * Math.cos(th), y: 0, z: speed * Math.sin(th) } }
  for (let k = 0; k < 400; k++) {
    const next = stepBall(b, 0.02, { ...p, substeps: 1 })
    if (next.pos.z <= 0 && k > 0) return next.pos.x
    b = next
  }
  return b.pos.x
}

/** Launch velocity for a ball from `from` towards `to`. Lofted balls are solved so they first land on `to`. */
export const launchVelocity = (
  from: Vec2,
  to: Vec2,
  height: "ground" | "low" | "high",
  p: Params
): Vec3 => {
  const dx = to.x - from.x
  const dy = to.y - from.y
  const d = Math.max(0.5, Math.hypot(dx, dy))
  const ux = dx / d
  const uy = dy / d
  if (height === "ground") {
    const s = groundLaunchSpeed(d, p.pass.arriveSpeed, p.ball)
    return { x: ux * s, y: uy * s, z: 0 }
  }
  const deg = height === "high" ? p.pass.highLaunchDeg : 12
  let lo = 2
  let hi = 45
  for (let i = 0; i < 14; i++) {
    const mid = (lo + hi) / 2
    if (carryDistance(mid, deg, p.ball) < d) lo = mid
    else hi = mid
  }
  const s = (lo + hi) / 2
  const th = (deg * Math.PI) / 180
  return { x: ux * s * Math.cos(th), y: uy * s * Math.cos(th), z: s * Math.sin(th) }
}
```

- [ ] **Step 4: Implement kinematics**

`packages/sim-core/src/kinematics.ts`

```ts
import { add, len, norm, scale, sub, type Vec2 } from "./geometry.js"
import type { Params } from "./params.js"
import type { PlayerAttrs } from "./types.js"

export const vmaxFor = (a: PlayerAttrs, energy: number, p: Params): number =>
  p.kinematics.vmaxBase * (0.86 + 0.14 * a.pace) * (0.9 + 0.1 * energy)

export const accelFor = (a: PlayerAttrs, p: Params): number => p.kinematics.accelMax * (0.8 + 0.2 * a.acceleration)

/** Reynolds "arrive": head for target, slow inside slowRadius, respect speed and acceleration caps. */
export const arrive = (
  pos: Vec2,
  vel: Vec2,
  target: Vec2,
  vmax: number,
  amax: number,
  dt: number,
  slowRadius = 4
): { pos: Vec2; vel: Vec2 } => {
  const to = sub(target, pos)
  const d = len(to)
  const desiredSpeed = d < 0.05 ? 0 : Math.min(vmax, (vmax * d) / slowRadius)
  const desired = scale(norm(to), desiredSpeed)
  let dv = sub(desired, vel)
  const maxDv = amax * dt
  if (len(dv) > maxDv) dv = scale(norm(dv), maxDv)
  let nv = add(vel, dv)
  if (len(nv) > vmax) nv = scale(norm(nv), vmax)
  return { pos: add(pos, scale(nv, dt)), vel: nv }
}

/** Repulsion from teammates closer than radius, so players don't stack. */
export const separation = (pos: Vec2, others: ReadonlyArray<Vec2>, radius = 1.5): Vec2 => {
  let push: Vec2 = { x: 0, y: 0 }
  for (const o of others) {
    const away = sub(pos, o)
    const d = len(away)
    if (d > 1e-6 && d < radius) push = add(push, scale(norm(away), (radius - d) / radius))
  }
  return push
}

/**
 * Constant-bearing intercept: the point where a chaser at `speed` meets a target moving at
 * constant velocity. Falls back to the target's current position when no solution exists.
 */
export const interceptPoint = (chaser: Vec2, speed: number, target: Vec2, targetVel: Vec2): Vec2 => {
  const r = sub(target, chaser)
  const a = targetVel.x * targetVel.x + targetVel.y * targetVel.y - speed * speed
  const b = 2 * (r.x * targetVel.x + r.y * targetVel.y)
  const c = r.x * r.x + r.y * r.y
  let t: number
  if (Math.abs(a) < 1e-9) t = b !== 0 ? -c / b : -1
  else {
    const disc = b * b - 4 * a * c
    if (disc < 0) return target
    const s = Math.sqrt(disc)
    const t1 = (-b - s) / (2 * a)
    const t2 = (-b + s) / (2 * a)
    t = Math.min(...[t1, t2].filter((x) => x > 0), Infinity)
  }
  if (!Number.isFinite(t) || t <= 0) return target
  return add(target, scale(targetVel, t))
}
```

- [ ] **Step 5: Run the tests**

Run: `pnpm --filter @touchline/sim-core test physics`
Expected: 5 passed

- [ ] **Step 6: Commit**

```bash
git add packages/sim-core/src/ball.ts packages/sim-core/src/kinematics.ts packages/sim-core/test/physics.test.ts
git commit -m "feat(sim-core): 3D ball physics and steering kinematics

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```



### Task 5: Team shape and shared test helpers

Formation anchors (4-3-3, 4-4-2, 4-2-3-1, 3-5-2) that slide with the ball and respond to style (line height, compactness), mirrored for the away side. Also the shared test helpers (`@touchline/sim-core/testing`) every later test uses; they deliberately do not depend on the step function.

**Files:**
- Create: `packages/sim-core/src/shape.ts`, `packages/sim-core/src/testing.ts`
- Test: `packages/sim-core/test/shape.test.ts`

**Interfaces:**
- Consumes: geometry and types (Task 3), `Rng`/`seedRng` (Task 2), `DEFAULT_PARAMS` (Task 3).
- Produces (shape): `interface Slot {role, x, y}`; `FORMATIONS: Record<FormationName, Slot[]>` (slot 0 is the keeper); `anchorFor(formation, slot, side, ball, style, inPossession): Vec2`; `kickoffAnchor(formation, slot, side, style): Vec2`.
- Produces (testing): `STYLES` (four archetypes); `makeTeam(id, formation, style, seed): TeamSetup`; `makeConfig(seed, overrides?): MatchConfig` (match id `m-test`, home 4-3-3 possession vs away 4-4-2 direct, dt 0.1); `kickoffPlayersFor(cfg): PlayerState[]`.

- [ ] **Step 1: Write the failing test**

`packages/sim-core/test/shape.test.ts`

```ts
import { describe, expect, it } from "vitest"
import { PITCH } from "../src/geometry.js"
import { anchorFor, FORMATIONS, kickoffAnchor } from "../src/shape.js"
import { STYLES } from "../src/testing.js"

describe("team shape", () => {
  it("every formation has 11 slots with the keeper first", () => {
    for (const f of Object.values(FORMATIONS)) {
      expect(f).toHaveLength(11)
      expect(f[0]!.role).toBe("GK")
    }
  })
  it("anchors stay inside the pitch for any ball position", () => {
    for (const bx of [-50, 0, 50]) for (const by of [-30, 0, 30]) for (let slot = 0; slot < 11; slot++) {
      const a = anchorFor("4-3-3", slot, "home", { x: bx, y: by }, STYLES.high_press, true)
      expect(Math.abs(a.x)).toBeLessThanOrEqual(PITCH.halfL)
      expect(Math.abs(a.y)).toBeLessThanOrEqual(PITCH.halfW)
    }
  })
  it("the away side mirrors the home side", () => {
    const h = anchorFor("4-4-2", 5, "home", { x: 10, y: 5 }, STYLES.direct, false)
    const a = anchorFor("4-4-2", 5, "away", { x: -10, y: -5 }, STYLES.direct, false)
    expect(a.x).toBeCloseTo(-h.x, 9)
    expect(a.y).toBeCloseTo(-h.y, 9)
  })
  it("a high-press back line sits higher than a low block's", () => {
    const line = (style: keyof typeof STYLES) => anchorFor("4-4-2", 2, "home", { x: 0, y: 0 }, STYLES[style], false).x
    expect(line("high_press")).toBeGreaterThan(line("low_block") + 10)
  })
  it("kickoff anchors are in the team's own half", () => {
    for (let slot = 0; slot < 11; slot++) {
      expect(kickoffAnchor("4-3-3", slot, "home", STYLES.high_press).x).toBeLessThan(0)
      expect(kickoffAnchor("4-3-3", slot, "away", STYLES.high_press).x).toBeGreaterThan(0)
    }
  })
})
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `pnpm --filter @touchline/sim-core test shape`
Expected: FAIL — modules not found

- [ ] **Step 3: Implement team shape**

`packages/sim-core/src/shape.ts`

```ts
import { clamp, dirOf, PITCH, type Side, type Vec2 } from "./geometry.js"
import type { FormationName, Role, TeamStyle } from "./types.js"

export interface Slot {
  readonly role: Role
  /** Base anchor for a team attacking +x with the ball on the centre spot. */
  readonly x: number
  readonly y: number
}

export const FORMATIONS: Readonly<Record<FormationName, ReadonlyArray<Slot>>> = {
  "4-3-3": [
    { role: "GK", x: -48, y: 0 },
    { role: "FB", x: -28, y: 24 },
    { role: "CB", x: -32, y: 8 },
    { role: "CB", x: -32, y: -8 },
    { role: "FB", x: -28, y: -24 },
    { role: "CM", x: -12, y: 13 },
    { role: "DM", x: -18, y: 0 },
    { role: "CM", x: -12, y: -13 },
    { role: "W", x: 4, y: 24 },
    { role: "ST", x: 6, y: 0 },
    { role: "W", x: 4, y: -24 }
  ],
  "4-4-2": [
    { role: "GK", x: -48, y: 0 },
    { role: "FB", x: -29, y: 23 },
    { role: "CB", x: -32, y: 7 },
    { role: "CB", x: -32, y: -7 },
    { role: "FB", x: -29, y: -23 },
    { role: "W", x: -12, y: 24 },
    { role: "CM", x: -15, y: 7 },
    { role: "CM", x: -15, y: -7 },
    { role: "W", x: -12, y: -24 },
    { role: "ST", x: 2, y: 5 },
    { role: "ST", x: 2, y: -5 }
  ],
  "4-2-3-1": [
    { role: "GK", x: -48, y: 0 },
    { role: "FB", x: -28, y: 24 },
    { role: "CB", x: -32, y: 8 },
    { role: "CB", x: -32, y: -8 },
    { role: "FB", x: -28, y: -24 },
    { role: "DM", x: -19, y: 7 },
    { role: "DM", x: -19, y: -7 },
    { role: "W", x: -4, y: 22 },
    { role: "AM", x: -4, y: 0 },
    { role: "W", x: -4, y: -22 },
    { role: "ST", x: 6, y: 0 }
  ],
  "3-5-2": [
    { role: "GK", x: -48, y: 0 },
    { role: "CB", x: -32, y: 12 },
    { role: "CB", x: -34, y: 0 },
    { role: "CB", x: -32, y: -12 },
    { role: "FB", x: -16, y: 27 },
    { role: "CM", x: -15, y: 9 },
    { role: "DM", x: -19, y: 0 },
    { role: "CM", x: -15, y: -9 },
    { role: "FB", x: -16, y: -27 },
    { role: "ST", x: 3, y: 5 },
    { role: "ST", x: 3, y: -5 }
  ]
}

/**
 * Anchor for a slot given the ball position. Computed in "attacking +x" space, then mirrored
 * for the away side. Line height and compactness come from the team style.
 */
export const anchorFor = (
  formation: FormationName,
  slot: number,
  side: Side,
  ball: Vec2,
  style: TeamStyle,
  inPossession: boolean
): Vec2 => {
  const s = FORMATIONS[formation][slot]!
  const d = dirOf(side)
  const bx = ball.x * d
  const by = ball.y * d
  if (s.role === "GK") {
    const gx = -PITCH.halfL + 3 + Math.max(0, bx + PITCH.halfL) * 0.06
    return { x: gx * d, y: clamp(by * 0.12, -4, 4) * d }
  }
  const slide = 0.5
  const line = style.lineHeight * 8 + (inPossession ? 7 : -2)
  const compact = 1 - 0.35 * style.compactness
  const x = clamp(s.x + slide * bx + line, -PITCH.halfL + 4, PITCH.halfL - 3)
  const y = clamp(s.y * compact + 0.35 * by, -PITCH.halfW + 1.5, PITCH.halfW - 1.5)
  return { x: x * d, y: y * d }
}

/** Kickoff anchors: like shape anchors but clamped to the team's own half. */
export const kickoffAnchor = (formation: FormationName, slot: number, side: Side, style: TeamStyle): Vec2 => {
  const a = anchorFor(formation, slot, side, { x: 0, y: 0 }, style, false)
  const d = dirOf(side)
  const ax = Math.min(a.x * d, -1.5)
  return { x: ax * d, y: a.y }
}
```

- [ ] **Step 4: Implement the test helpers**

`packages/sim-core/src/testing.ts`

```ts
/**
 * Test helpers shared by every package's tests (exported as "@touchline/sim-core/testing").
 * Deliberately independent of step.ts so early tasks can use it.
 */
import { DEFAULT_PARAMS } from "./params.js"
import { Rng, seedRng } from "./rng.js"
import { FORMATIONS, kickoffAnchor } from "./shape.js"
import type { FormationName, MatchConfig, PlayerAttrs, PlayerState, TeamSetup, TeamStyle } from "./types.js"

export const STYLES: Readonly<Record<TeamStyle["archetype"], TeamStyle>> = {
  high_press: { archetype: "high_press", pressIntensity: 0.9, lineHeight: 0.8, compactness: 0.6, tempo: 0.8, longBallBias: -0.2, crossBias: 0.0, riskTolerance: 0.6 },
  possession: { archetype: "possession", pressIntensity: 0.6, lineHeight: 0.5, compactness: 0.5, tempo: 0.4, longBallBias: -0.6, crossBias: -0.3, riskTolerance: 0.4 },
  direct: { archetype: "direct", pressIntensity: 0.4, lineHeight: 0.0, compactness: 0.5, tempo: 0.8, longBallBias: 0.7, crossBias: 0.5, riskTolerance: 0.6 },
  low_block: { archetype: "low_block", pressIntensity: 0.15, lineHeight: -0.8, compactness: 0.9, tempo: 0.3, longBallBias: 0.3, crossBias: 0.2, riskTolerance: 0.3 }
}

export const makeTeam = (id: string, formation: FormationName, style: TeamStyle, seed: number): TeamSetup => {
  const rng = new Rng(seedRng(seed))
  const attr = (): number => Math.round(rng.range(0.45, 0.85) * 100) / 100
  const attrs = (): PlayerAttrs => ({
    pace: attr(), acceleration: attr(), shortPassing: attr(), longPassing: attr(), vision: attr(), crossing: attr(),
    dribbling: attr(), finishing: attr(), heading: attr(), tackling: attr(), composure: attr(), stamina: attr(), handling: attr(), reflexes: attr()
  })
  return {
    id,
    name: id,
    formation,
    style,
    starters: FORMATIONS[formation].map((slot, i) => ({ id: `${id}-${String(i + 1).padStart(2, "0")}`, role: slot.role, jersey: i + 1, attrs: attrs() }))
  }
}

export const makeConfig = (seed: number, overrides: Partial<MatchConfig> = {}): MatchConfig => ({
  matchId: "m-test",
  seed,
  kickoffTime: "2026-10-18T14:00:00.000Z",
  home: makeTeam("home-fc", "4-3-3", STYLES.possession, 11),
  away: makeTeam("away-fc", "4-4-2", STYLES.direct, 22),
  params: DEFAULT_PARAMS,
  dt: 0.1,
  ...overrides
})

/** Both teams standing in their kickoff shape (home slots 0-10, then away slots 0-10). */
export const kickoffPlayersFor = (cfg: MatchConfig): PlayerState[] =>
  (["home", "away"] as const).flatMap((side) => {
    const team = side === "home" ? cfg.home : cfg.away
    return team.starters.map((pl, slot) => ({
      id: pl.id, side, role: pl.role, slot, jersey: pl.jersey, attrs: pl.attrs,
      pos: kickoffAnchor(team.formation, slot, side, team.style), vel: { x: 0, y: 0 },
      intent: { kind: "shape" as const }, intentUntil: 0, energy: 1, yellow: 0, sentOff: false
    }))
  })
```

- [ ] **Step 5: Run the tests**

Run: `pnpm --filter @touchline/sim-core test shape`
Expected: 5 passed

- [ ] **Step 6: Commit**

```bash
git add packages/sim-core/src/shape.ts packages/sim-core/src/testing.ts packages/sim-core/test/shape.test.ts
git commit -m "feat(sim-core): formation anchors and shared test helpers

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```



### Task 6: Execution model and decision layer

Spec §5.1.4 and §5.1.12. `executeKick` turns an *intended* kick into the actual one (Gaussian error growing with pressure, weak foot and low technique, plus a heavy-tail mis-hit). `decide` scores the 13 actions with a softmax over zone logits, style, pressure, game state and script bias, builds pass candidates classified by geometry, picks one by value, and reports decision quality.

**Files:**
- Create: `packages/sim-core/src/execute.ts`, `packages/sim-core/src/decide.ts`
- Test: `packages/sim-core/test/execute-decide.test.ts`

**Interfaces:**
- Consumes: `launchVelocity` (Task 4), `classifyPass` and geometry (Task 3), `Rng` (Task 2), test helpers (Task 5).
- Produces (execute): `type Execution = clean|inaccurate|overhit|underhit|mishit`; `interface KickIntent`; `interface Executed {to, vel, execution, errorM}`; `pressureFrom(nearestOpponentM)`; `executeKick(kick, params, rng): Executed`.
- Produces (decide): `KIND_TO_ACTION`; `interface Candidate {action, kind, receiverId, target, height, xpass, value, lane}`; `interface DecisionInput {owner, teammates, opponents, style, scoreDiff, minute, restart, scriptBias}`; `interface Decision {action, candidate, decisionQuality, xg, pressure}`; `threat(side, pos)`; `lastDefenderAttackX(side, opponents)`; `defendersInLane(from, to, opponents, width?)`; `xpassOf(params, distance, lane, pressure, height)`; `xgOf(params, side, pos, header, defendersInCone)`; `nearestOpponent(pos, opponents)`; `buildCandidates(input, params, pressure)`; `decide(input, params, rng): Decision`.

- [ ] **Step 1: Write the failing test**

`packages/sim-core/test/execute-decide.test.ts`

```ts
import { describe, expect, it } from "vitest"
import { DEFAULT_PARAMS as P } from "../src/params.js"
import { decide } from "../src/decide.js"
import { executeKick } from "../src/execute.js"
import { Rng, seedRng } from "../src/rng.js"
import type { PlayerState } from "../src/types.js"
import { kickoffPlayersFor, makeConfig, STYLES } from "../src/testing.js"

const kick = (pressure: number, composure: number, n = 2000) => {
  const r = new Rng(seedRng(4))
  const out = { mishit: 0, clean: 0, err: 0 }
  for (let i = 0; i < n; i++) {
    const e = executeKick({ from: { x: 0, y: 0 }, to: { x: 25, y: 5 }, height: "ground", technique: 0.6, composure, pressure, weakFoot: false }, P, r)
    if (e.execution === "mishit") out.mishit++
    if (e.execution === "clean") out.clean++
    out.err += e.errorM / n
  }
  return out
}

describe("execution", () => {
  it("error and mis-hits grow with pressure and low composure", () => {
    const calm = kick(0, 0.8), hot = kick(1, 0.2)
    expect(hot.err).toBeGreaterThan(calm.err * 2)
    expect(hot.mishit).toBeGreaterThan(calm.mishit * 5)
    expect(calm.clean / 2000).toBeGreaterThan(0.6)
  })
})

describe("decide", () => {
  const players = kickoffPlayersFor(makeConfig(1))
  const home = players.filter((p) => p.side === "home"), away = players.filter((p) => p.side === "away")
  const owner = (pos: { x: number; y: number }): PlayerState => ({ ...home[9]!, pos })
  const share = (o: PlayerState, styleKey: keyof typeof STYLES, action: string, n = 400) => {
    const r = new Rng(seedRng(8))
    let k = 0
    for (let i = 0; i < n; i++) {
      const d = decide({ owner: o, teammates: home, opponents: away, style: STYLES[styleKey], scoreDiff: 0, minute: 30, restart: null, scriptBias: {} }, P, r)
      if (d.action === action) k++
    }
    return k / n
  }
  it("shoots more often from the edge of the box than from midfield", () => {
    expect(share(owner({ x: 38, y: 0 }), "possession", "shot")).toBeGreaterThan(share(owner({ x: 5, y: 0 }), "possession", "shot"))
  })
  it("direct teams play more long balls than possession teams", () => {
    const o = { ...home[2]!, pos: { x: -30, y: 5 } }
    expect(share(o, "direct", "long_pass")).toBeGreaterThan(share(o, "possession", "long_pass"))
  })
  it("a penalty restart always shoots", () => {
    const r = new Rng(seedRng(1))
    const d = decide({ owner: owner({ x: 41.5, y: 0 }), teammates: home, opponents: away, style: STYLES.direct, scoreDiff: 0, minute: 10, restart: "penalty", scriptBias: {} }, P, r)
    expect(d.action).toBe("shot")
  })
  it("reports decision quality between 0 and 1 for passes", () => {
    const r = new Rng(seedRng(2))
    for (let i = 0; i < 50; i++) {
      const d = decide({ owner: owner({ x: 0, y: 0 }), teammates: home, opponents: away, style: STYLES.possession, scoreDiff: 0, minute: 10, restart: null, scriptBias: {} }, P, r)
      if (d.candidate) { expect(d.decisionQuality).toBeGreaterThanOrEqual(0); expect(d.decisionQuality).toBeLessThanOrEqual(1) }
    }
  })
})
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `pnpm --filter @touchline/sim-core test execute-decide`
Expected: FAIL — modules not found

- [ ] **Step 3: Implement the execution model**

`packages/sim-core/src/execute.ts`

```ts
import { launchVelocity } from "./ball.js"
import { dist, type Vec2, type Vec3 } from "./geometry.js"
import type { PassHeight } from "./classify.js"
import type { Params } from "./params.js"
import type { Rng } from "./rng.js"

export type Execution = "clean" | "inaccurate" | "overhit" | "underhit" | "mishit"

export interface KickIntent {
  readonly from: Vec2
  readonly to: Vec2
  readonly height: PassHeight
  /** 0..1 skill for this kind of kick (shortPassing, longPassing, crossing...). */
  readonly technique: number
  readonly composure: number
  /** 0..1 from nearest-opponent distance. */
  readonly pressure: number
  readonly weakFoot: boolean
}

export interface Executed {
  readonly to: Vec2
  readonly vel: Vec3
  readonly execution: Execution
  readonly errorM: number
}

/** Pressure 1 when an opponent is within 1 m, 0 beyond 5 m. */
export const pressureFrom = (nearestOpponentM: number): number => Math.max(0, Math.min(1, 1 - (nearestOpponentM - 1) / 4))

/**
 * Turn an intended kick into the actual one: Gaussian direction and distance error that grows
 * with pressure, weak foot and low technique, plus a heavy-tail "mis-hit" mixture.
 */
export const executeKick = (k: KickIntent, p: Params, rng: Rng): Executed => {
  const e = p.execution
  const dx = k.to.x - k.from.x
  const dy = k.to.y - k.from.y
  const intendedLen = Math.max(0.5, Math.hypot(dx, dy))
  const ang0 = Math.atan2(dy, dx)
  const skill = 1.35 - 0.7 * k.technique
  const foot = k.weakFoot ? e.weakFootK : 1
  const pressureScale = 1 + e.pressureK * k.pressure
  const pMishit = Math.min(0.35, e.mishitBase + e.mishitK * Math.pow(k.pressure, 1.6) * (1.2 - k.composure) * (k.weakFoot ? 1.6 : 1))
  const g1 = rng.normal()
  const g2 = rng.normal()
  const mishit = rng.chance(pMishit)
  const g3 = rng.normal()
  const u = rng.uniform()
  let ang: number
  let actualLen: number
  if (mishit) {
    ang = ang0 + g3 * 0.45
    actualLen = intendedLen * (0.35 + 1.3 * u)
  } else {
    ang = ang0 + g1 * e.dirSigma * pressureScale * skill * foot
    actualLen = intendedLen * (1 + g2 * e.distSigma * pressureScale * skill * foot)
  }
  const to = { x: k.from.x + Math.cos(ang) * actualLen, y: k.from.y + Math.sin(ang) * actualLen }
  const errorM = dist(to, k.to)
  let execution: Execution
  if (mishit) execution = "mishit"
  else if (errorM < 2) execution = "clean"
  else if (Math.abs(actualLen - intendedLen) > 0.6 * errorM) execution = actualLen > intendedLen ? "overhit" : "underhit"
  else execution = "inaccurate"
  return { to, vel: launchVelocity(k.from, to, k.height, p), execution, errorM }
}
```

- [ ] **Step 4: Implement the decision layer**

`packages/sim-core/src/decide.ts`

```ts
import { classifyPass, type PassHeight, type PassKind } from "./classify.js"
import { actionZone, attackX, dirOf, dist, goalAngle, goalOf, PITCH, type Side, type Vec2 } from "./geometry.js"
import { ACTIONS, type Action, type Params } from "./params.js"
import type { Rng } from "./rng.js"
import type { PlayerState, RestartKind, TeamStyle } from "./types.js"

export const KIND_TO_ACTION: Readonly<Record<Exclude<PassKind, "set_piece">, Action>> = {
  short: "short_pass",
  long: "long_pass",
  through: "through_ball",
  lofted_through: "lofted_through",
  switch: "switch",
  cross: "cross",
  cutback: "cutback",
  back: "back_pass"
}

export interface Candidate {
  readonly action: Action
  readonly kind: PassKind
  readonly receiverId: string
  readonly target: Vec2
  readonly height: PassHeight
  readonly xpass: number
  readonly value: number
  readonly lane: number
}

export interface DecisionInput {
  readonly owner: PlayerState
  readonly teammates: ReadonlyArray<PlayerState>
  readonly opponents: ReadonlyArray<PlayerState>
  readonly style: TeamStyle
  /** Own score minus opponent score. */
  readonly scoreDiff: number
  readonly minute: number
  readonly restart: RestartKind | null
  /** Additive logit bias from scenario scripts. */
  readonly scriptBias: Partial<Record<Action, number>>
}

export interface Decision {
  readonly action: Action
  readonly candidate: Candidate | null
  /** Chosen option value / best option value (null when no pass was chosen). */
  readonly decisionQuality: number | null
  readonly xg: number | null
  readonly pressure: number
}

const sigmoid = (z: number): number => 1 / (1 + Math.exp(-z))

/** Simple threat surface: 1 at the goal mouth, decaying with distance. Replaced by fitted xT in Plan 2. */
export const threat = (side: Side, pos: Vec2): number => Math.exp(-dist(pos, goalOf(side)) / 20)

export const lastDefenderAttackX = (side: Side, opponents: ReadonlyArray<PlayerState>): number => {
  let best = -PITCH.halfL
  for (const o of opponents) if (o.role !== "GK" && !o.sentOff) best = Math.max(best, attackX(side, o.pos.x))
  return best
}

const segmentDistance = (a: Vec2, b: Vec2, q: Vec2): { d: number; t: number } => {
  const vx = b.x - a.x
  const vy = b.y - a.y
  const l2 = vx * vx + vy * vy
  const t = l2 < 1e-9 ? 0 : Math.max(0, Math.min(1, ((q.x - a.x) * vx + (q.y - a.y) * vy) / l2))
  return { d: Math.hypot(a.x + t * vx - q.x, a.y + t * vy - q.y), t }
}

export const defendersInLane = (from: Vec2, to: Vec2, opponents: ReadonlyArray<PlayerState>, width = 2): number => {
  let n = 0
  for (const o of opponents) {
    if (o.sentOff) continue
    const { d, t } = segmentDistance(from, to, o.pos)
    if (d < width && t > 0.05 && t < 0.95) n++
  }
  return n
}

export const xpassOf = (p: Params, distance: number, lane: number, pressure: number, height: PassHeight): number => {
  const c = p.pass.xpass
  return sigmoid(c.b0 + c.bDist * distance + c.bLane * lane + c.bPressure * pressure + c.bHigh * (height === "ground" ? 0 : 1))
}

export const xgOf = (p: Params, side: Side, pos: Vec2, header: boolean, defendersInCone: number): number => {
  const c = p.shot.xg
  const d = dist(pos, goalOf(side))
  return sigmoid(c.b0 + c.bDist * d + c.bAngle * goalAngle(side, pos) + (header ? c.bHeader : 0) + c.bDefenders * defendersInCone)
}

export const nearestOpponent = (pos: Vec2, opponents: ReadonlyArray<PlayerState>): PlayerState | null => {
  let best: PlayerState | null = null
  let bd = Infinity
  for (const o of opponents) {
    if (o.sentOff) continue
    const d = dist(pos, o.pos)
    if (d < bd) {
      bd = d
      best = o
    }
  }
  return best
}

export const buildCandidates = (input: DecisionInput, p: Params, pressure: number): Candidate[] => {
  const { owner, teammates, opponents } = input
  const side = owner.side
  const d = dirOf(side)
  const lastDef = lastDefenderAttackX(side, opponents)
  const out: Candidate[] = []
  const ownerThreat = threat(side, owner.pos)
  const push = (receiver: PlayerState, target: Vec2, height: PassHeight) => {
    const kind = classifyPass({ side, from: owner.pos, to: target, height, lastDefenderAttackX: lastDef }, p.classifier)
    if (kind === "set_piece") return
    const distance = dist(owner.pos, target)
    const lane = defendersInLane(owner.pos, target, opponents)
    const xp = xpassOf(p, distance, lane, pressure, height)
    const value = xp * (0.3 + threat(side, target)) - (1 - xp) * 0.3 * (1 - ownerThreat)
    out.push({ action: KIND_TO_ACTION[kind], kind, receiverId: receiver.id, target, height, xpass: xp, value, lane })
  }
  for (const tm of teammates) {
    if (tm.id === owner.id || tm.sentOff) continue
    const lead = { x: tm.pos.x + tm.vel.x * 0.5, y: tm.pos.y + tm.vel.y * 0.5 }
    const distance = dist(owner.pos, lead)
    if (distance < 4 || distance > 65) continue
    const inBox = attackX(side, lead.x) > PITCH.halfL - PITCH.boxDepth && Math.abs(lead.y) < PITCH.boxHalfWidth
    const wideOwner = Math.abs(owner.pos.y) > PITCH.boxHalfWidth
    push(tm, lead, wideOwner && inBox ? "high" : distance < 30 ? "ground" : "high")
    const ahead = attackX(side, tm.pos.x) > lastDef - 4 || tm.intent.kind === "run_in_behind"
    if (ahead && tm.role !== "GK") {
      const target = { x: tm.pos.x + d * p.pass.throughLeadM, y: tm.pos.y }
      if (Math.abs(target.x) < PITCH.halfL - 2) push(tm, target, dist(owner.pos, target) < 30 ? "ground" : "high")
    }
  }
  return out
}

const softmaxPick = (logits: ReadonlyArray<number>, rng: Rng): number => {
  const m = Math.max(...logits)
  return rng.weighted(logits.map((l) => (Number.isFinite(l) ? Math.exp(l - m) : 0)))
}

const RESTART_ACTIONS: Readonly<Record<RestartKind, ReadonlyArray<Action>>> = {
  kickoff: ["short_pass", "back_pass"],
  throw_in: ["short_pass", "back_pass", "through_ball"],
  corner: ["cross", "short_pass"],
  goal_kick: ["short_pass", "long_pass", "switch"],
  free_kick: ["short_pass", "long_pass", "cross", "switch", "back_pass", "shot"],
  penalty: ["shot"]
}

/** Choose an action (and a pass option) for the player on the ball. */
export const decide = (input: DecisionInput, p: Params, rng: Rng): Decision => {
  const { owner, style } = input
  const side = owner.side
  const opp = nearestOpponent(owner.pos, input.opponents)
  const oppDist = opp ? dist(owner.pos, opp.pos) : 50
  const pressure = Math.max(0, Math.min(1, 1 - (oppDist - 1) / 4))
  const zone = actionZone(side, owner.pos)
  const candidates = buildCandidates(input, p, pressure)
  const goalDist = dist(owner.pos, goalOf(side))
  const cone = input.opponents.filter((o) => {
    const g = goalOf(side)
    const { d, t } = segmentDistance(owner.pos, g, o.pos)
    return d < 1.5 && t > 0 && t < 1 && o.role !== "GK"
  }).length
  const xg = goalDist <= p.shot.maxDistanceM ? xgOf(p, side, owner.pos, false, cone) : 0
  const ax = attackX(side, owner.pos.x)
  const allowed = input.restart ? new Set(RESTART_ACTIONS[input.restart]) : null

  const available = (a: Action): boolean => {
    if (allowed && !allowed.has(a)) return false
    switch (a) {
      case "shot":
        return input.restart === "penalty" || (goalDist <= p.shot.maxDistanceM && ax > 15)
      case "carry":
      case "hold":
        return input.restart === null
      case "take_on":
        return input.restart === null && opp !== null && oppDist < 4
      case "clear":
        return input.restart === null && ax < -10
      default:
        return candidates.some((c) => c.action === a)
    }
  }

  const base = p.actions.logits[zone]
  const sw = p.actions.styleWeight
  const pw = p.actions.pressureWeight
  const lateTrailing = input.minute > 75 && input.scoreDiff < 0
  const lateLeading = input.minute > 75 && input.scoreDiff > 0
  const logits = ACTIONS.map((a) => {
    if (!available(a)) return -Infinity
    let l = base[a]
    if (a === "long_pass" || a === "lofted_through" || a === "switch") l += sw * 0.8 * style.longBallBias
    if (a === "short_pass") l -= sw * 0.3 * style.longBallBias
    if (a === "cross") l += sw * 0.8 * style.crossBias
    if (a === "through_ball") l += sw * (style.riskTolerance - 0.5)
    if (a === "hold") l += sw * (0.4 * (1 - style.tempo) - 0.2)
    if (a === "clear") l += pw * 1.5 * pressure
    if (a === "long_pass") l += pw * 0.6 * pressure
    if (a === "hold") l -= pw * 1.0 * pressure
    if (a === "carry") l -= pw * 0.6 * pressure
    if (a === "take_on") l += pw * 0.3 * pressure
    if (a === "short_pass") l -= pw * 0.2 * pressure
    if (a === "shot") l += 3 * (xg - 0.1) + 0.3 * style.riskTolerance
    if (lateTrailing && (a === "shot" || a === "cross" || a === "long_pass")) l += 0.4
    if (lateLeading && (a === "hold" || a === "back_pass")) l += 0.4
    l += input.scriptBias[a] ?? 0
    return l
  })
  let idx = softmaxPick(logits, rng)
  if (idx < 0) idx = ACTIONS.indexOf(allowed ? [...allowed][0]! : "hold")
  const action = ACTIONS[idx]!

  const NON_PASS: ReadonlyArray<Action> = ["shot", "carry", "hold", "take_on", "clear"]
  let passOptions = candidates.filter((c) => c.action === action)
  if (NON_PASS.includes(action)) return { action, candidate: null, decisionQuality: null, xg: action === "shot" ? xg : null, pressure }
  if (passOptions.length === 0) {
    // Forced restart with no option of the allowed kinds: play the best available pass, or clear it.
    if (candidates.length === 0) return { action: "clear", candidate: null, decisionQuality: null, xg: null, pressure }
    const bestAny = candidates.reduce((a, b) => (b.value > a.value ? b : a))
    passOptions = [bestAny]
  }
  const temp = p.pass.choiceTemperature * (1.4 - owner.attrs.vision)
  const pick = softmaxPick(passOptions.map((c) => c.value / Math.max(0.05, temp)), rng)
  const chosen = passOptions[Math.max(0, pick)]!
  const best = Math.max(...candidates.map((c) => c.value))
  const quality = best > 0 ? Math.max(0, Math.min(1, chosen.value / best)) : 1
  return { action: chosen.action, candidate: chosen, decisionQuality: quality, xg: null, pressure }
}
```

- [ ] **Step 5: Run the tests**

Run: `pnpm --filter @touchline/sim-core test execute-decide`
Expected: 5 passed

- [ ] **Step 6: Commit**

```bash
git add packages/sim-core/src/execute.ts packages/sim-core/src/decide.ts packages/sim-core/test/execute-decide.test.ts
git commit -m "feat(sim-core): execution error model and action decision layer

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```



### Task 7: Event building, flight resolution and shots

Domain-event construction with the CDF match clock; time-to-intercept resolution of a kicked ball (who reaches it first, aerial duels, out of play) using the same physics the engine runs; and shot resolution (blocks, execution error, on-target, keeper handling) calibrated so goals per shot track xG.

**Files:**
- Create: `packages/sim-core/src/events.ts`, `packages/sim-core/src/resolve.ts`, `packages/sim-core/src/shot.ts`
- Test: `packages/sim-core/test/events.test.ts`, `packages/sim-core/test/resolve-shot.test.ts`

**Interfaces:**
- Consumes: `stepBall`, `launchVelocity` (Task 4), `vmaxFor` (Task 4), `xgOf` (Task 6), types (Task 3).
- Produces (events): `matchClock(period, periodTick, dt)`; `interface EventContext {matchId, period, periodStartTick, dt}`; `buildEvent(ctx, seq, pending, extra?): DomainEvent`; `round2(v)`.
- Produces (resolve): `interface Resolution {ticks, winnerId, result: reached|out|stopped, ball, aerial}`; `resolveFlight(start, fromId, intendedId, players, params, dt, rng, maxTicks?)`.
- Produces (shot): `ShotExecution`, `ShotOutcome`, `Handling`, `interface ShotPlan`; `normalBetween(lo, hi, mean, sd)`; `planShot(shooter, side, opponents, xg, pressure, isPenalty, params, dt, rng): ShotPlan`.

- [ ] **Step 1: Write the failing tests**

`packages/sim-core/test/events.test.ts`

```ts
import { describe, expect, it } from "vitest"
import { buildEvent, matchClock } from "../src/events.js"

describe("events", () => {
  it("formats the CDF match clock, with the second half starting at 45:00", () => {
    expect(matchClock("first_half", 0, 0.1)).toBe("00:00.00")
    expect(matchClock("first_half", 6024, 0.1)).toBe("10:02.40")
    expect(matchClock("second_half", 13224, 0.1)).toBe("67:02.40")
  })
  it("builds ids, period frame ids and rounded coordinates", () => {
    const e = buildEvent({ matchId: "m1", period: "second_half", periodStartTick: 27900, dt: 0.1 }, 7, {
      type: "pass", frame_id: 41124, team_id: "t", player_id: "p", x: 8.7123, y: -11.6, x_end: 36, y_end: -3.9, attrs: {}
    })
    expect(e.id).toBe("m1-e7")
    expect(e.period_frame_id).toBe(13224)
    expect(e.x).toBe(8.71)
    expect(e.match_clock).toBe("67:02.40")
  })
})
```

`packages/sim-core/test/resolve-shot.test.ts`

```ts
import { describe, expect, it } from "vitest"
import { launchVelocity } from "../src/ball.js"
import { xgOf } from "../src/decide.js"
import { DEFAULT_PARAMS as P } from "../src/params.js"
import { resolveFlight } from "../src/resolve.js"
import { Rng, seedRng } from "../src/rng.js"
import { planShot } from "../src/shot.js"
import type { PlayerState } from "../src/types.js"
import { kickoffPlayersFor, makeConfig } from "../src/testing.js"

const base = kickoffPlayersFor(makeConfig(1))
const at = (p: PlayerState, x: number, y: number): PlayerState => ({ ...p, pos: { x, y }, vel: { x: 0, y: 0 } })

describe("resolveFlight", () => {
  it("an unopposed pass reaches its intended receiver", () => {
    const passer = at(base[2]!, 0, 0), receiver = at(base[5]!, 15, 0)
    const ball = { pos: { x: 0, y: 0, z: 0 }, vel: launchVelocity(passer.pos, receiver.pos, "ground", P) }
    const r = resolveFlight(ball, passer.id, receiver.id, [passer, receiver], P, 0.1, new Rng(seedRng(1)))
    expect(r.result).toBe("reached")
    expect(r.winnerId).toBe(receiver.id)
  })
  it("a defender standing in the lane intercepts", () => {
    const passer = at(base[2]!, 0, 0), receiver = at(base[5]!, 20, 0), def = at(base[13]!, 8, 0.3)
    const ball = { pos: { x: 0, y: 0, z: 0 }, vel: launchVelocity(passer.pos, receiver.pos, "ground", P) }
    expect(resolveFlight(ball, passer.id, receiver.id, [passer, receiver, def], P, 0.1, new Rng(seedRng(1))).winnerId).toBe(def.id)
  })
  it("a ball hit out of the pitch with nobody near goes out", () => {
    const passer = at(base[2]!, 0, 30)
    const ball = { pos: { x: 0, y: 30, z: 0 }, vel: { x: 0, y: 15, z: 0 } }
    expect(resolveFlight(ball, passer.id, null, [passer], P, 0.1, new Rng(seedRng(1))).result).toBe("out")
  })
})

describe("planShot", () => {
  it("goals per shot track xG on average (keeper only, no blockers)", () => {
    const shooter = at(base[9]!, 36, 4)
    const keeper = at(base.find((p) => p.side === "away" && p.role === "GK")!, 51, 0)
    const xg = xgOf(P, "home", shooter.pos, false, 0)
    const r = new Rng(seedRng(3))
    let goals = 0
    const n = 6000
    for (let i = 0; i < n; i++) if (planShot(shooter, "home", [keeper], xg, 0, false, P, 0.1, r).outcome === "goal") goals++
    expect(goals / n).toBeGreaterThan(xg * 0.75)
    expect(goals / n).toBeLessThan(xg * 1.25)
  })
  it("penalties score about three times in four", () => {
    const shooter = at(base[9]!, 41.5, 0)
    const keeper = at(base.find((p) => p.side === "away" && p.role === "GK")!, 52, 0)
    const r = new Rng(seedRng(4))
    let goals = 0
    for (let i = 0; i < 4000; i++) if (planShot(shooter, "home", [keeper], 0.76, 0, true, P, 0.1, r).outcome === "goal") goals++
    expect(goals / 4000).toBeGreaterThan(0.65)
    expect(goals / 4000).toBeLessThan(0.85)
  })
})
```

- [ ] **Step 2: Run them to make sure they fail**

Run: `pnpm --filter @touchline/sim-core test events resolve-shot`
Expected: FAIL — modules not found

- [ ] **Step 3: Implement events**

`packages/sim-core/src/events.ts`

```ts
import type { DomainEvent, PendingEvent, Period } from "./types.js"

/** CDF match clock "MM:SS.mm"; the second half starts at 45:00.00. */
export const matchClock = (period: Period, periodTick: number, dt: number): string => {
  const total = (period === "first_half" ? 0 : 45 * 60) + periodTick * dt
  const mm = Math.floor(total / 60)
  const ss = total - mm * 60
  const ssText = (Math.round(ss * 100) / 100).toFixed(2).padStart(5, "0")
  return `${String(mm).padStart(2, "0")}:${ssText}`
}

export interface EventContext {
  readonly matchId: string
  readonly period: Period
  /** Global tick of the period's first frame, to convert global ticks to CDF frame ids. */
  readonly periodStartTick: number
  readonly dt: number
}

export const buildEvent = (
  ctx: EventContext,
  seq: number,
  pending: PendingEvent,
  extra: { readonly frame_id_end?: number | null; readonly outcome?: string | null } = {}
): DomainEvent => {
  const periodFrame = pending.frame_id - ctx.periodStartTick
  return {
    id: `${ctx.matchId}-e${seq}`,
    match_id: ctx.matchId,
    type: pending.type,
    frame_id: pending.frame_id,
    period_frame_id: periodFrame,
    period: ctx.period,
    match_clock: matchClock(ctx.period, periodFrame, ctx.dt),
    team_id: pending.team_id,
    player_id: pending.player_id,
    x: pending.x === null ? null : round2(pending.x),
    y: pending.y === null ? null : round2(pending.y),
    x_end: pending.x_end === null ? null : round2(pending.x_end),
    y_end: pending.y_end === null ? null : round2(pending.y_end),
    frame_id_end: extra.frame_id_end ?? null,
    outcome: extra.outcome ?? null,
    source: "sim",
    confidence: 1,
    attrs: pending.attrs
  }
}

export const round2 = (v: number): number => Math.round(v * 100) / 100
```

- [ ] **Step 4: Implement flight resolution**

`packages/sim-core/src/resolve.ts`

```ts
import { stepBall } from "./ball.js"
import { dist, inPitch, type Side } from "./geometry.js"
import { vmaxFor } from "./kinematics.js"
import type { Params } from "./params.js"
import type { Rng } from "./rng.js"
import type { BallState, PlayerState } from "./types.js"

export interface Resolution {
  /** Ticks after release at which the flight resolves (>= 1). */
  readonly ticks: number
  readonly winnerId: string | null
  readonly result: "reached" | "out" | "stopped"
  /** Ball state at resolution (what stepBall will have produced by then). */
  readonly ball: BallState
  readonly aerial: { readonly winnerId: string; readonly loserId: string } | null
}

const sigmoid = (z: number): number => 1 / (1 + Math.exp(-z))

/**
 * Predict a kicked ball tick by tick with the same physics the engine uses, and find the
 * first player who can reach it (time-to-intercept), or the tick it leaves the pitch.
 * The intended receiver anticipates (no reaction delay); everyone else reacts after reactionS.
 */
export const resolveFlight = (
  start: BallState,
  fromId: string,
  intendedId: string | null,
  players: ReadonlyArray<PlayerState>,
  p: Params,
  dt: number,
  rng: Rng,
  maxTicks = 80
): Resolution => {
  let b = start
  for (let k = 1; k <= maxTicks; k++) {
    b = stepBall(b, dt, p.ball)
    const flat = { x: b.pos.x, y: b.pos.y }
    if (!inPitch(flat)) return { ticks: k, winnerId: null, result: "out", ball: b, aerial: null }
    if (b.pos.z > p.kinematics.headerHeightM) continue
    const t = k * dt
    const qualifiers: Array<{ pl: PlayerState; slack: number }> = []
    for (const pl of players) {
      if (pl.sentOff) continue
      if (pl.id === fromId && t < 0.6) continue
      const reaction = pl.id === intendedId ? 0 : p.kinematics.reactionS
      const reach = p.kinematics.reachM + vmaxFor(pl.attrs, pl.energy, p) * Math.max(0, t - reaction)
      const d = dist(pl.pos, flat)
      if (d <= reach) qualifiers.push({ pl, slack: reach - d })
    }
    if (qualifiers.length === 0) continue
    const aerialBall = b.pos.z > p.kinematics.controlHeightM
    const sides = new Set<Side>(qualifiers.map((q) => q.pl.side))
    if (aerialBall && sides.size === 2) {
      const best = (s: Side) => qualifiers.filter((q) => q.pl.side === s).sort((x, y) => y.slack - x.slack)[0]!.pl
      const h = best("home")
      const a = best("away")
      const homeWins = rng.chance(sigmoid(3 * (h.attrs.heading - a.attrs.heading)))
      const w = homeWins ? h : a
      const l = homeWins ? a : h
      return { ticks: k, winnerId: w.id, result: "reached", ball: b, aerial: { winnerId: w.id, loserId: l.id } }
    }
    const intended = qualifiers.find((q) => q.pl.id === intendedId)
    if (intended && sides.size === 1) return { ticks: k, winnerId: intended.pl.id, result: "reached", ball: b, aerial: null }
    const winner = qualifiers.sort((x, y) => y.slack - x.slack)[0]!.pl
    return { ticks: k, winnerId: winner.id, result: "reached", ball: b, aerial: null }
  }
  return { ticks: maxTicks, winnerId: null, result: "stopped", ball: b, aerial: null }
}
```

- [ ] **Step 5: Implement shots**

`packages/sim-core/src/shot.ts`

```ts
import { dist, dirOf, goalOf, PITCH, type Side, type Vec2, type Vec3 } from "./geometry.js"
import type { Params } from "./params.js"
import type { Rng } from "./rng.js"
import type { PlayerState } from "./types.js"

export type ShotExecution = "clean" | "scuffed" | "sliced" | "skied"
export type ShotOutcome = "goal" | "saved" | "blocked" | "wide"
export type Handling = "clean" | "parried_safe" | "parried_dangerous" | "fumble"

export interface ShotPlan {
  readonly outcome: ShotOutcome
  readonly ticks: number
  readonly from: Vec3
  readonly to: Vec3
  readonly execution: ShotExecution
  readonly onTarget: boolean
  readonly blockerId: string | null
  readonly keeperId: string | null
  readonly handling: Handling | null
}

const segmentDistance = (a: Vec2, b: Vec2, q: Vec2): { d: number; t: number } => {
  const vx = b.x - a.x
  const vy = b.y - a.y
  const l2 = vx * vx + vy * vy
  const t = l2 < 1e-9 ? 0 : Math.max(0, Math.min(1, ((q.x - a.x) * vx + (q.y - a.y) * vy) / l2))
  return { d: Math.hypot(a.x + t * vx - q.x, a.y + t * vy - q.y), t }
}

const erf = (x: number): number => {
  // Abramowitz-Stegun 7.1.26, |error| < 1.5e-7
  const t = 1 / (1 + 0.3275911 * Math.abs(x))
  const y = 1 - ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x)
  return x >= 0 ? y : -y
}
/** P(lo < N(mean, sd) < hi). */
export const normalBetween = (lo: number, hi: number, mean: number, sd: number): number =>
  0.5 * (erf((hi - mean) / (sd * Math.SQRT2)) - erf((lo - mean) / (sd * Math.SQRT2)))

/** Resolve a shot at release: blocks, execution error, on-target check, keeper. */
export const planShot = (
  shooter: PlayerState,
  side: Side,
  opponents: ReadonlyArray<PlayerState>,
  xg: number,
  pressure: number,
  isPenalty: boolean,
  p: Params,
  dt: number,
  rng: Rng
): ShotPlan => {
  const goal = goalOf(side)
  const from: Vec3 = { x: shooter.pos.x, y: shooter.pos.y, z: 0.2 }
  const d = dist(shooter.pos, goal)
  const skill = 1.35 - 0.7 * shooter.attrs.finishing
  const aimY = rng.range(-2.9, 2.9)
  const aimZ = rng.range(0.3, 1.8)
  const sdY = (isPenalty ? 1.0 : 1.6 + 0.12 * d) * (1 + 0.8 * pressure) * skill
  const sdZ = (0.6 + 0.05 * d) * (1 + 0.5 * pressure) * skill
  const pMis = Math.min(0.4, p.execution.mishitBase * 2 + p.execution.mishitK * Math.pow(pressure, 1.6) * (1.2 - shooter.attrs.composure))
  const mis = rng.chance(pMis)
  const misKind = rng.uniform()
  let y = aimY + rng.normal() * sdY
  let z = Math.max(0, aimZ + rng.normal() * sdZ)
  let execution: ShotExecution = "clean"
  if (mis) {
    if (misKind < 0.4) {
      execution = "skied"
      z = rng.range(3, 9)
    } else if (misKind < 0.75) {
      execution = "sliced"
      y = aimY + Math.sign(rng.normal()) * rng.range(4, 12)
    } else {
      execution = "scuffed"
      z = 0
    }
  }
  const to: Vec3 = { x: goal.x, y, z }
  const speed = execution === "scuffed" ? p.shot.speed * 0.5 : p.shot.speed
  const travel = (m: number) => Math.max(1, Math.ceil(m / speed / dt))

  if (!isPenalty) {
    for (const o of opponents) {
      if (o.sentOff || o.role === "GK") continue
      const { d: off, t } = segmentDistance(shooter.pos, goal, o.pos)
      if (off < 1.2 && t > 0.02 && t < 0.95 && rng.chance(p.shot.blockPerDefender)) {
        const at: Vec3 = { x: o.pos.x, y: o.pos.y, z: 0.5 }
        return { outcome: "blocked", ticks: travel(dist(shooter.pos, o.pos)), from, to: at, execution, onTarget: false, blockerId: o.id, keeperId: null, handling: null }
      }
    }
  }
  const onTarget = Math.abs(y) < PITCH.goalHalfWidth && z < PITCH.goalHeight
  const keeper = opponents.find((o) => o.role === "GK" && !o.sentOff) ?? null
  if (!onTarget) return { outcome: "wide", ticks: travel(d), from, to, execution, onTarget, blockerId: null, keeperId: null, handling: null }
  // Scale by the expected on-target probability for this aim and noise, so goals per shot track xG.
  // Heights below 0 are clamped to the ground, so the vertical window is (-inf, crossbar).
  const pOnTarget = Math.max(0.05, normalBetween(-PITCH.goalHalfWidth, PITCH.goalHalfWidth, aimY, sdY) * normalBetween(-50, PITCH.goalHeight, aimZ, sdZ))
  const pGoalClean = Math.max(0.03, Math.min(0.95, (isPenalty ? 0.76 : xg) / pOnTarget))
  const pGoal = mis ? pGoalClean * 0.3 : pGoalClean
  if (rng.chance(pGoal) || keeper === null)
    return { outcome: "goal", ticks: travel(d), from, to, execution, onTarget, blockerId: null, keeperId: null, handling: null }
  const h = rng.uniform()
  const k = keeper.attrs.handling
  const handling: Handling = h < 0.35 + 0.35 * k ? "clean" : h < 0.85 ? "parried_safe" : h < 0.97 ? "parried_dangerous" : "fumble"
  const saveAt: Vec3 = { x: goal.x - dirOf(side) * 0.8, y: Math.max(-3.5, Math.min(3.5, y)), z }
  return { outcome: "saved", ticks: travel(d), from, to: saveAt, execution, onTarget, blockerId: null, keeperId: keeper.id, handling }
}
```

- [ ] **Step 6: Run the tests**

Run: `pnpm --filter @touchline/sim-core test events resolve-shot`
Expected: 7 passed. The xG test runs 6,000 shots; goals/xG must land within ±25 %.

- [ ] **Step 7: Commit**

```bash
git add packages/sim-core/src/events.ts packages/sim-core/src/resolve.ts packages/sim-core/src/shot.ts packages/sim-core/test/events.test.ts packages/sim-core/test/resolve-shot.test.ts
git commit -m "feat(sim-core): event builder, time-to-intercept flight resolution, shot model

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```



### Task 8: The step function: a full match

Assemble the engine (spec §5.1.3): `initMatch` and a pure `step` per tick covering restarts, possession, duels and pressure, carries, take-ons, kicks and shots resolved at release (events emitted on resolution), loose balls (including loose-ball goals and own goals), movement for all 22 players, periods with added time, and 10 Hz frames. Also the public index and a match-runner script.

**Files:**
- Create: `packages/sim-core/src/step.ts`, `packages/sim-core/scripts/run-match.ts`
- Modify: `packages/sim-core/src/index.ts` (replace the placeholder)
- Test: `packages/sim-core/test/match.test.ts`, `packages/sim-core/test/edge.test.ts`

**Interfaces:**
- Consumes: everything from Tasks 2–7.
- Produces: `initMatch(cfg): MatchState` (tick −1; the first step emits frame 0 plus `match_start` and `period_start`); `step(state): StepResult` (pure; `frame` is null only after full time); `isFinished(state)`; package index re-exporting all modules except `testing`.

- [ ] **Step 1: Write the failing tests**

`packages/sim-core/test/match.test.ts`

```ts
import { describe, expect, it } from "vitest"
import { createHash } from "node:crypto"
import { initMatch, isFinished, step, type DomainEvent, type Frame, type MatchConfig } from "../src/index.js"
import { makeConfig } from "../src/testing.js"

const play = (cfg: MatchConfig) => {
  let s = initMatch(cfg)
  const frames: Frame[] = []
  const events: DomainEvent[] = []
  while (!isFinished(s)) { const r = step(s); s = r.state; if (r.frame) frames.push(r.frame); events.push(...r.events) }
  return { s, frames, events }
}
const hash = (x: unknown) => createHash("sha256").update(JSON.stringify(x)).digest("hex")

describe("full match", () => {
  const a = play(makeConfig(1))
  it("is deterministic for a seed and differs across seeds", () => {
    const b = play(makeConfig(1))
    expect(hash(b.events)).toBe(hash(a.events))
    expect(hash(b.frames)).toBe(hash(a.frames))
    expect(hash(play(makeConfig(2)).events)).not.toBe(hash(a.events))
  })
  it("has two periods with frame ids restarting at 0 and ~90+ minutes of frames", () => {
    const first = a.frames.filter((f) => f.period === "first_half"), second = a.frames.filter((f) => f.period === "second_half")
    expect(first[0]!.frame_id).toBe(0)
    expect(second[0]!.frame_id).toBe(0)
    expect(a.frames.length).toBeGreaterThan(90 * 60 * 10)
    expect(a.frames.length).toBeLessThan(102 * 60 * 10)
  })
  it("starts and ends with the match lifecycle events", () => {
    expect(a.events[0]!.type).toBe("match_start")
    expect(a.events.at(-1)!.type).toBe("match_end")
  })
  it("keeps every player on the pitch (2 m margin) and at or under 10 m/s", () => {
    for (let i = 1; i < a.frames.length; i++) {
      const f = a.frames[i]!, prev = a.frames[i - 1]!
      if (f.period !== prev.period) continue
      const before = new Map([...prev.home, ...prev.away].map((x) => [x.id, x]))
      for (const p of [...f.home, ...f.away]) {
        if (Math.abs(p.x) > 54.5 || Math.abs(p.y) > 36) throw new Error(`${p.id} off the pitch at tick ${f.tick}`)
        const q = before.get(p.id)
        if (q && Math.hypot(p.x - q.x, p.y - q.y) / 0.1 > 10.05) throw new Error(`${p.id} too fast at tick ${f.tick}`)
      }
    }
  })
  it("puts the ball within 1 m of the passer at every pass release", () => {
    const byTick = new Map(a.frames.map((f) => [f.tick, f]))
    for (const e of a.events.filter((x) => x.type === "pass")) {
      const f = byTick.get(e.frame_id)!
      expect(Math.hypot(f.ball.x - e.x!, f.ball.y - e.y!)).toBeLessThan(1)
    }
  })
  it("stamps every event with a frame that exists, in order", () => {
    const ticks = new Set(a.frames.map((f) => f.tick))
    for (const e of a.events) if (e.type !== "match_end" && e.type !== "period_end") expect(ticks.has(e.frame_id)).toBe(true)
  })
  it("produces football in a sane (uncalibrated) range", () => {
    const n = (t: string) => a.events.filter((e) => e.type === t).length
    expect(n("pass")).toBeGreaterThan(400)
    expect(n("pass")).toBeLessThan(2500)
    expect(n("shot")).toBeGreaterThan(5)
    expect(n("goal")).toBeLessThan(15)
  })
  it("score in state equals goal events", () => {
    const g = a.events.filter((e) => e.type === "goal")
    expect(a.s.score.home + a.s.score.away).toBe(g.length)
  })
})
```

`packages/sim-core/test/edge.test.ts`

```ts
import { describe, expect, it } from "vitest"
import { DEFAULT_PARAMS, initMatch, isFinished, step, type DomainEvent, type Frame, type MatchConfig } from "../src/index.js"
import { makeConfig } from "../src/testing.js"

const play = (cfg: MatchConfig) => {
  let s = initMatch(cfg)
  const frames: Frame[] = [], events: DomainEvent[] = []
  while (!isFinished(s)) { const r = step(s); s = r.state; if (r.frame) frames.push(r.frame); events.push(...r.events) }
  return { s, frames, events }
}

describe("edge cases", () => {
  it("finishes cleanly when players are sent off, and sent-off players leave the frames", () => {
    const params = { ...DEFAULT_PARAMS, defending: { ...DEFAULT_PARAMS.defending, foulPerTackle: 0.6, redPerFoul: 0.25 } }
    const m = play(makeConfig(6, { params }))
    const reds = m.events.filter((e) => e.type === "card" && e.attrs.colour !== "yellow")
    expect(reds.length).toBeGreaterThan(0)
    const last = m.frames.at(-1)!
    for (const r of reds) expect([...last.home, ...last.away].some((p) => p.id === r.player_id)).toBe(false)
    expect(m.events.at(-1)!.type).toBe("match_end")
  })
  it("runs at 25 Hz (render runs) deterministically with comparable football", () => {
    const a = play(makeConfig(2, { dt: 0.04 }))
    const b = play(makeConfig(2, { dt: 0.04 }))
    expect(JSON.stringify(a.events)).toBe(JSON.stringify(b.events))
    const ten = play(makeConfig(2))
    expect(a.frames.length / ten.frames.length).toBeGreaterThan(2.3)
    expect(a.frames.length / ten.frames.length).toBeLessThan(2.7)
    const passes = (m: { events: DomainEvent[] }) => m.events.filter((e) => e.type === "pass").length
    expect(passes(a) / passes(ten)).toBeGreaterThan(0.7)
    expect(passes(a) / passes(ten)).toBeLessThan(1.3)
  })
  it("handles extreme seeds", () => {
    for (const seed of [0, 4294967295]) expect(play(makeConfig(seed)).events.at(-1)!.type).toBe("match_end")
  })
  it("every goal event is matched by the final score", () => {
    for (const seed of [11, 12, 13]) {
      const m = play(makeConfig(seed))
      const goals = m.events.filter((e) => e.type === "goal")
      expect(m.s.score.home + m.s.score.away).toBe(goals.length)
    }
  })
})
```

- [ ] **Step 2: Run them to make sure they fail**

Run: `pnpm --filter @touchline/sim-core test match edge`
Expected: FAIL — `../src/index.js` exports nothing / step not found

- [ ] **Step 3: Implement the step function**

`packages/sim-core/src/step.ts`

```ts
import { stepBall } from "./ball.js"
import { decide, lastDefenderAttackX, nearestOpponent, type Decision } from "./decide.js"
import { buildEvent, round2 } from "./events.js"
import { executeKick } from "./execute.js"
import {
  add,
  attackX,
  clampToPitch,
  dirOf,
  dist,
  inPitch,
  len,
  norm,
  other,
  PITCH,
  scale,
  sub,
  type Side,
  type Vec2,
  type Vec3
} from "./geometry.js"
import { accelFor, arrive, interceptPoint, separation, vmaxFor } from "./kinematics.js"
import type { Action } from "./params.js"
import { resolveFlight } from "./resolve.js"
import { hazard, Rng, substream } from "./rng.js"
import { anchorFor, kickoffAnchor } from "./shape.js"
import { planShot } from "./shot.js"
import {
  CONCERNS,
  type AttrValue,
  type BallState,
  type Concern,
  type DomainEvent,
  type Flight,
  type Frame,
  type MatchConfig,
  type MatchState,
  type PendingEvent,
  type Phase,
  type PlayerState,
  type Possession,
  type RestartKind,
  type StepResult,
  type TeamSetup
} from "./types.js"

const HALF_TIME_MS = 15 * 60 * 1000

const teamOf = (cfg: MatchConfig, side: Side): TeamSetup => (side === "home" ? cfg.home : cfg.away)

const samplePeriodTicks = (cfg: MatchConfig, rng: Rng): number => {
  const [lo, hi] = cfg.params.timing.addedTimeMinS
  return Math.round((45 * 60 + rng.range(lo, hi)) / cfg.dt)
}

const kickoffPlayers = (cfg: MatchConfig, existing?: ReadonlyArray<PlayerState>): PlayerState[] => {
  const out: PlayerState[] = []
  for (const side of ["home", "away"] as const) {
    const team = teamOf(cfg, side)
    team.starters.forEach((pl, slot) => {
      const prev = existing?.find((e) => e.id === pl.id)
      out.push({
        id: pl.id,
        side,
        role: pl.role,
        slot,
        jersey: pl.jersey,
        attrs: pl.attrs,
        pos: kickoffAnchor(team.formation, slot, side, team.style),
        vel: { x: 0, y: 0 },
        intent: { kind: "shape" },
        intentUntil: 0,
        energy: prev?.energy ?? 1,
        yellow: prev?.yellow ?? 0,
        sentOff: prev?.sentOff ?? false
      })
    })
  }
  return out
}

/** Initial state: tick -1, so the first step emits frame 0 of the first half. */
export const initMatch = (cfg: MatchConfig): MatchState => {
  const rng = {} as Record<Concern, ReturnType<typeof substream>>
  for (const c of CONCERNS) rng[c] = substream(cfg.seed, c)
  const timing = new Rng(rng.restart)
  const periodTicks = samplePeriodTicks(cfg, timing)
  rng.restart = timing.state
  return {
    config: cfg,
    tick: -1,
    period: "first_half",
    periodTick: -1,
    periodTicks,
    periodStartMs: Date.parse(cfg.kickoffTime),
    phase: { kind: "restart", restart: "kickoff", side: "home", at: { x: 0, y: 0 }, resumeTick: 0 },
    ball: { pos: { x: 0, y: 0, z: 0 }, vel: { x: 0, y: 0, z: 0 } },
    possession: { kind: "dead" },
    players: kickoffPlayers(cfg),
    score: { home: 0, away: 0 },
    lastTouch: null,
    pressedBy: [],
    carry: null,
    rng,
    eventSeq: 0
  }
}

export const isFinished = (s: MatchState): boolean => s.phase.kind === "full_time"

/** Mutable working copy for one step. Nothing outside step() sees it. */
class Work {
  readonly cfg: MatchConfig
  tick: number
  period: MatchState["period"]
  periodTick: number
  periodTicks: number
  periodStartMs: number
  periodStartTick: number
  phase: Phase
  ball: BallState
  possession: Possession
  players: PlayerState[]
  score: { home: number; away: number }
  lastTouch: MatchState["lastTouch"]
  pressedBy: string[]
  carry: MatchState["carry"]
  rng: Record<Concern, Rng>
  seq: number
  events: DomainEvent[] = []

  constructor(s: MatchState) {
    this.cfg = s.config
    this.tick = s.tick + 1
    this.period = s.period
    this.periodTick = s.periodTick + 1
    this.periodTicks = s.periodTicks
    this.periodStartMs = s.periodStartMs
    this.periodStartTick = s.tick - s.periodTick
    this.phase = s.phase
    this.ball = s.ball
    this.possession = s.possession
    this.players = [...s.players]
    this.score = { ...s.score }
    this.lastTouch = s.lastTouch
    this.pressedBy = [...s.pressedBy]
    this.carry = s.carry
    this.rng = {} as Record<Concern, Rng>
    for (const c of CONCERNS) this.rng[c] = new Rng(s.rng[c])
    this.seq = s.eventSeq
  }

  get p() {
    return this.cfg.params
  }
  get dt() {
    return this.cfg.dt
  }
  player(id: string): PlayerState {
    const pl = this.players.find((x) => x.id === id)
    if (!pl) throw new Error(`unknown player ${id}`)
    return pl
  }
  setPlayer(next: PlayerState): void {
    const i = this.players.findIndex((x) => x.id === next.id)
    this.players[i] = next
  }
  active(side?: Side): PlayerState[] {
    return this.players.filter((x) => !x.sentOff && (side === undefined || x.side === side))
  }
  teamId(side: Side): string {
    return teamOf(this.cfg, side).id
  }
  minute(): number {
    return (this.period === "first_half" ? 0 : 45) + (this.periodTick * this.dt) / 60
  }
  emit(pe: PendingEvent, extra: { frame_id_end?: number | null; outcome?: string | null } = {}): void {
    this.seq += 1
    this.events.push(
      buildEvent({ matchId: this.cfg.matchId, period: this.period, periodStartTick: this.periodStartTick, dt: this.dt }, this.seq, pe, extra)
    )
  }
  pending(type: PendingEvent["type"], pl: PlayerState | null, at: Vec2 | null, attrs: Record<string, AttrValue> = {}, end: Vec2 | null = null, side?: Side): PendingEvent {
    const s = pl?.side ?? side ?? null
    return {
      type,
      frame_id: this.tick,
      team_id: s ? this.teamId(s) : null,
      player_id: pl?.id ?? null,
      x: at?.x ?? null,
      y: at?.y ?? null,
      x_end: end?.x ?? null,
      y_end: end?.y ?? null,
      attrs
    }
  }
  decisionDelayTicks(): number {
    const t = this.p.timing
    return Math.max(1, Math.round(this.rng.decision.range(t.decisionMinS, t.decisionMaxS) / this.dt))
  }
  toState(): MatchState {
    const out = {} as Record<Concern, MatchState["rng"][Concern]>
    for (const c of CONCERNS) out[c] = this.rng[c].state
    return {
      config: this.cfg,
      tick: this.tick,
      period: this.period,
      periodTick: this.periodTick,
      periodTicks: this.periodTicks,
      periodStartMs: this.periodStartMs,
      phase: this.phase,
      ball: this.ball,
      possession: this.possession,
      players: this.players,
      score: this.score,
      lastTouch: this.lastTouch,
      pressedBy: this.pressedBy,
      carry: this.carry,
      rng: out,
      eventSeq: this.seq
    }
  }
}

// ---------------------------------------------------------------- restarts

const restartFromOut = (lastSide: Side | null, at: Vec3): { restart: RestartKind; side: Side; at: Vec2 } => {
  const last = lastSide ?? "home"
  if (Math.abs(at.y) > PITCH.halfW && Math.abs(at.x) <= PITCH.halfL) {
    return { restart: "throw_in", side: other(last), at: { x: Math.max(-PITCH.halfL + 1, Math.min(PITCH.halfL - 1, at.x)), y: Math.sign(at.y) * PITCH.halfW } }
  }
  const end = Math.sign(at.x) || 1
  const defending: Side = end > 0 ? "away" : "home"
  if (last === defending) return { restart: "corner", side: other(defending), at: { x: end * PITCH.halfL, y: (Math.sign(at.y) || 1) * PITCH.halfW } }
  return { restart: "goal_kick", side: defending, at: { x: end * (PITCH.halfL - PITCH.sixDepth), y: 0 } }
}

const startRestart = (w: Work, r: { restart: RestartKind; side: Side; at: Vec2 }): void => {
  const delay = w.p.timing.restartDelayS[r.restart] * w.rng.restart.range(0.7, 1.3)
  w.phase = { kind: "restart", restart: r.restart, side: r.side, at: r.at, resumeTick: w.tick + Math.round(delay / w.dt) }
  w.possession = { kind: "dead" }
  w.ball = { pos: { x: r.at.x, y: r.at.y, z: 0 }, vel: { x: 0, y: 0, z: 0 } }
  w.pressedBy = []
}

const takerFor = (w: Work, r: { restart: RestartKind; side: Side; at: Vec2 }): PlayerState => {
  const team = w.active(r.side)
  if (r.restart === "goal_kick") return team.find((x) => x.role === "GK") ?? team[0]!
  if (r.restart === "kickoff") return team.find((x) => x.role === "ST") ?? team[team.length - 1]!
  return team.filter((x) => x.role !== "GK").sort((a, b) => dist(a.pos, r.at) - dist(b.pos, r.at))[0]!
}

const handleRestart = (w: Work): void => {
  const ph = w.phase
  if (ph.kind !== "restart") return
  if (w.tick < ph.resumeTick) return
  const taker = takerFor(w, ph)
  // The taker walks to the ball (see moveTarget); the restart waits until they are there.
  if (dist(taker.pos, ph.at) > 1.0) return
  w.setPlayer({ ...taker, vel: { x: 0, y: 0 }, intentUntil: w.tick, intent: { kind: "hold" } })
  w.emit(w.pending("set_piece", taker, ph.at, { kind: ph.restart }))
  w.possession = { kind: "owned", playerId: taker.id, since: w.tick, restart: ph.restart }
  w.lastTouch = { playerId: taker.id, side: taker.side }
  w.phase = { kind: "open_play" }
}

// ---------------------------------------------------------------- on-ball

const changePossession = (w: Work, to: PlayerState, reasonEvent: PendingEvent | null): void => {
  const prevSide = w.lastTouch?.side ?? null
  if (reasonEvent) w.emit(reasonEvent)
  if (prevSide !== null && prevSide !== to.side) w.emit(w.pending("possession_change", to, to.pos, { reason: reasonEvent?.type ?? "recovery" }))
  w.possession = { kind: "owned", playerId: to.id, since: w.tick, restart: null }
  w.lastTouch = { playerId: to.id, side: to.side }
  w.pressedBy = []
  w.setPlayer({ ...w.player(to.id), intent: { kind: "hold" }, intentUntil: w.tick + w.decisionDelayTicks() })
}

const foulAndCards = (w: Work, offender: PlayerState, victim: PlayerState): void => {
  w.emit(w.pending("foul", offender, offender.pos, { kind: "tackle", victim_id: victim.id }))
  const ref = w.rng.referee
  let card: "yellow" | "second_yellow" | "red" | null = null
  if (ref.chance(w.p.defending.redPerFoul)) card = "red"
  else if (ref.chance(w.p.defending.yellowPerFoul)) card = offender.yellow >= 1 ? "second_yellow" : "yellow"
  if (card) {
    w.emit(w.pending("card", offender, offender.pos, { colour: card }))
    w.setPlayer({ ...w.player(offender.id), yellow: offender.yellow + 1, sentOff: card !== "yellow" })
  }
  const inBox = attackX(victim.side, victim.pos.x) > PITCH.halfL - PITCH.boxDepth && Math.abs(victim.pos.y) < PITCH.boxHalfWidth
  startRestart(
    w,
    inBox
      ? { restart: "penalty", side: victim.side, at: { x: dirOf(victim.side) * PITCH.penaltySpot, y: 0 } }
      : { restart: "free_kick", side: victim.side, at: clampToPitch(victim.pos, 1) }
  )
}

/** The ball squirts away from a contact point; last touch belongs to `toucher`. */
const knockLoose = (w: Work, toucher: PlayerState, at: Vec2): void => {
  const ang = w.rng.duel.range(0, 2 * Math.PI)
  const speed = w.rng.duel.range(4, 11)
  w.ball = { pos: { x: at.x, y: at.y, z: 0 }, vel: { x: Math.cos(ang) * speed, y: Math.sin(ang) * speed, z: w.rng.duel.range(0, 2) } }
  w.possession = { kind: "loose" }
  w.lastTouch = { playerId: toucher.id, side: toucher.side }
  w.pressedBy = []
}

const duels = (w: Work, owner: PlayerState): boolean => {
  const opps = w.active(other(owner.side))
  for (const o of opps) {
    if (dist(o.pos, owner.pos) <= w.p.defending.pressRadiusM && !w.pressedBy.includes(o.id)) {
      w.pressedBy.push(o.id)
      w.emit(w.pending("pressure", o, o.pos, { target_id: owner.id }))
    }
  }
  const def = nearestOpponent(owner.pos, opps)
  if (!def || dist(def.pos, owner.pos) > w.p.defending.tackleRadiusM) return false
  const style = teamOf(w.cfg, def.side).style
  const rate = w.p.defending.tackleRatePerS * (0.5 + style.pressIntensity)
  if (!w.rng.duel.chance(hazard(rate, w.dt))) return false
  const pWin = 1 / (1 + Math.exp(-(w.p.defending.tackleBase + 3 * (def.attrs.tackling - owner.attrs.dribbling))))
  if (w.rng.duel.chance(pWin)) {
    finishCarry(w, owner)
    if (w.rng.duel.chance(w.p.defending.tackleLooseShare)) {
      w.emit(w.pending("tackle", def, def.pos, { outcome: "won", opponent_id: owner.id, ball: "loose" }))
      knockLoose(w, def, owner.pos)
    } else changePossession(w, def, w.pending("tackle", def, def.pos, { outcome: "won", opponent_id: owner.id, ball: "won" }))
    return true
  }
  if (w.rng.referee.chance(w.p.defending.foulPerTackle)) {
    finishCarry(w, owner)
    w.emit(w.pending("tackle", def, def.pos, { outcome: "foul", opponent_id: owner.id }))
    foulAndCards(w, def, owner)
    return true
  }
  w.emit(w.pending("tackle", def, def.pos, { outcome: "lost", opponent_id: owner.id }))
  return false
}

/** Emit a carry event if the owner just finished carrying the ball at least carryMinM. */
const finishCarry = (w: Work, owner: PlayerState): void => {
  const start = w.carry
  w.carry = null
  if (!start || start.playerId !== owner.id) return
  const d = dist(start.at, owner.pos)
  if (d < w.p.classifier.carryMinM) return
  const progressive = attackX(owner.side, owner.pos.x) - attackX(owner.side, start.at.x) >= 10
  w.emit({ ...w.pending("carry", owner, start.at, { distance_m: round2(d), progressive }, owner.pos), frame_id: start.tick }, { frame_id_end: w.tick })
}

const technique = (a: Action, pl: PlayerState): number =>
  a === "cross" ? pl.attrs.crossing : a === "long_pass" || a === "switch" || a === "lofted_through" || a === "clear" ? pl.attrs.longPassing : pl.attrs.shortPassing

const releaseKick = (w: Work, owner: PlayerState, d: Decision, restart: RestartKind | null): void => {
  const p = w.p
  const side = owner.side
  const opps = w.active(other(side))
  const isClear = d.action === "clear"
  const target: Vec2 = isClear
    ? { x: owner.pos.x + dirOf(side) * w.rng.decision.range(30, 60), y: owner.pos.y + w.rng.decision.range(-35, 35) }
    : d.candidate!.target
  const height = isClear ? "high" : d.candidate!.height
  const weakFoot = w.rng.execution.chance(0.2)
  const exe = executeKick(
    { from: owner.pos, to: target, height, technique: technique(d.action, owner), composure: owner.attrs.composure, pressure: d.pressure, weakFoot },
    p,
    w.rng.execution
  )
  const start: BallState = { pos: { x: owner.pos.x, y: owner.pos.y, z: 0 }, vel: exe.vel }
  const intended = d.candidate?.receiverId ?? null
  const res = resolveFlight(start, owner.id, intended, w.active(), p, w.dt, w.rng.duel)
  const lastDef = lastDefenderAttackX(side, opps)
  const winner = res.winnerId ? w.player(res.winnerId) : null
  const offside =
    !restart || restart === "free_kick"
      ? winner !== null &&
        winner.side === side &&
        winner.id !== owner.id &&
        attackX(side, winner.pos.x) > Math.max(lastDef, attackX(side, owner.pos.x), 0) + 0.5
      : false
  const kind = restart && restart !== "kickoff" ? "set_piece" : isClear ? null : d.candidate!.kind
  const attrs: Record<string, AttrValue> = {
    kind,
    restart,
    height,
    technique: restart === "throw_in" ? "throw" : "foot",
    body_part: weakFoot ? "left_foot" : "right_foot",
    intended_receiver_id: intended,
    intended_end_x: round2(target.x),
    intended_end_y: round2(target.y),
    execution: exe.execution,
    error_m: round2(exe.errorM),
    decision_quality: d.decisionQuality === null ? null : round2(d.decisionQuality),
    under_pressure: d.pressure > 0.3,
    defenders_in_lane: d.candidate?.lane ?? 0,
    ball_speed_kmh: round2(len({ x: exe.vel.x, y: exe.vel.y }) * 3.6),
    xpass: d.candidate ? round2(d.candidate.xpass) : null
  }
  const endAt = { x: res.ball.pos.x, y: res.ball.pos.y }
  const main = w.pending(isClear ? "clearance" : "pass", owner, owner.pos, attrs, endAt)
  const extra: PendingEvent[] = []
  let outcome: Flight["outcome"]
  let restartAfter: Flight["restartAfter"] = null
  let looseAfter: BallState | null = null
  const tickAt = w.tick + res.ticks
  const at = (pe: PendingEvent): PendingEvent => ({ ...pe, frame_id: tickAt })
  if (res.result === "out") {
    outcome = "out_of_play"
    extra.push(at(w.pending("ball_out", null, endAt, { side: Math.abs(res.ball.pos.y) > PITCH.halfW ? "touchline" : "byline", last_touch_team: w.teamId(side) })))
    restartAfter = restartFromOut(side, res.ball.pos)
  } else if (!winner) outcome = "loose"
  else if (offside) {
    outcome = "offside"
    extra.push(at(w.pending("offside", winner, winner.pos)))
    restartAfter = { restart: "free_kick", side: other(side), at: clampToPitch(winner.pos, 1) }
  } else if (winner.side === side) {
    outcome = "successful"
    extra.push(at(w.pending("reception", winner, endAt, { first_touch: "controlled", under_pressure: false })))
  } else {
    outcome = "intercepted"
    const deflect = !res.aerial && w.rng.duel.chance(w.p.defending.interceptLooseShare)
    extra.push(at(w.pending(res.aerial ? "aerial_duel" : "interception", winner, endAt, res.aerial ? { winner_id: res.aerial.winnerId, loser_id: res.aerial.loserId } : { ball: deflect ? "deflected" : "won" })))
    if (deflect) {
      const ang = w.rng.duel.range(0, 2 * Math.PI)
      const sp = w.rng.duel.range(4, 10)
      looseAfter = { pos: { x: endAt.x, y: endAt.y, z: 0 }, vel: { x: Math.cos(ang) * sp, y: Math.sin(ang) * sp, z: w.rng.duel.range(0, 1.5) } }
    }
  }
  const finalMain: PendingEvent = { ...main, attrs: { ...main.attrs, receiver_id: outcome === "successful" && winner ? winner.id : null } }
  if (res.aerial && outcome === "successful") extra.unshift(at(w.pending("aerial_duel", winner, endAt, { winner_id: res.aerial.winnerId, loser_id: res.aerial.loserId })))
  w.ball = start
  w.possession = {
    kind: "in_flight",
    flight: {
      kind: isClear ? "clearance" : "pass",
      fromId: owner.id,
      side,
      releaseTick: w.tick,
      resolveTick: tickAt,
      winnerId: offside || looseAfter ? null : (winner?.id ?? null),
      outcome,
      pending: finalMain,
      extra,
      path: null,
      restartAfter,
      looseBall: looseAfter
    }
  }
  w.lastTouch = { playerId: owner.id, side }
  if (winner && !offside) w.setPlayer({ ...w.player(winner.id), intent: { kind: "chase", target: endAt }, intentUntil: tickAt })
}

const releaseShot = (w: Work, owner: PlayerState, d: Decision, restart: RestartKind | null): void => {
  const side = owner.side
  const opps = w.active(other(side))
  const isPenalty = restart === "penalty"
  const xg = isPenalty ? 0.76 : (d.xg ?? 0.02)
  const plan = planShot(owner, side, opps, xg, d.pressure, isPenalty, w.p, w.dt, w.rng.execution)
  const tickAt = w.tick + plan.ticks
  const at = (pe: PendingEvent): PendingEvent => ({ ...pe, frame_id: tickAt })
  const end = { x: plan.to.x, y: plan.to.y }
  const main = w.pending("shot", owner, owner.pos, {
    technique: isPenalty ? "penalty" : restart === "free_kick" ? "free_kick" : "normal",
    body_part: "right_foot",
    execution: plan.execution,
    on_target: plan.onTarget,
    xg: Math.round(xg * 1000) / 1000,
    shot_speed_kmh: round2(w.p.shot.speed * 3.6 * (plan.execution === "scuffed" ? 0.5 : 1))
  }, end)
  const extra: PendingEvent[] = []
  let restartAfter: Flight["restartAfter"] = null
  let looseBall: BallState | null = null
  let winnerId: string | null = null
  if (plan.outcome === "goal") {
    extra.push(at(w.pending("goal", owner, end, { scorer_id: owner.id, own_goal: false })))
    restartAfter = { restart: "kickoff", side: other(side), at: { x: 0, y: 0 } }
  } else if (plan.outcome === "wide") {
    extra.push(at(w.pending("ball_out", null, end, { side: "byline", last_touch_team: w.teamId(side) })))
    const defending = other(side)
    restartAfter = { restart: "goal_kick", side: defending, at: { x: dirOf(side) * (PITCH.halfL - PITCH.sixDepth), y: 0 } }
  } else if (plan.outcome === "blocked") {
    const blocker = w.player(plan.blockerId!)
    extra.push(at(w.pending("block", blocker, blocker.pos, { blocked: "shot" })))
    looseBall = { pos: plan.to, vel: { x: -dirOf(side) * w.rng.duel.range(2, 8), y: w.rng.duel.range(-6, 6), z: w.rng.duel.range(0, 3) } }
  } else {
    const keeper = w.player(plan.keeperId!)
    extra.push(at(w.pending("keeper_save", keeper, end, { technique: plan.handling === "clean" ? "catch" : "parry", handling: plan.handling })))
    if (plan.handling === "clean") winnerId = keeper.id
    else {
      const out = plan.handling === "parried_safe"
      looseBall = {
        pos: plan.to,
        vel: out ? { x: dirOf(side) * 3, y: Math.sign(plan.to.y || 1) * 12, z: 2 } : { x: -dirOf(side) * w.rng.duel.range(3, 7), y: w.rng.duel.range(-5, 5), z: 0.5 }
      }
    }
  }
  w.ball = { pos: plan.from, vel: { x: 0, y: 0, z: 0 } }
  w.possession = {
    kind: "in_flight",
    flight: {
      kind: "shot",
      fromId: owner.id,
      side,
      releaseTick: w.tick,
      resolveTick: tickAt,
      winnerId,
      outcome: plan.outcome,
      pending: main,
      extra,
      path: { from: plan.from, to: plan.to },
      restartAfter,
      looseBall
    }
  }
  w.lastTouch = { playerId: owner.id, side }
}

const scriptBias = (_w: Work, _side: Side): Partial<Record<Action, number>> => ({})

const ownerDecision = (w: Work, owner: PlayerState): void => {
  const poss = w.possession
  if (poss.kind !== "owned") return
  const restart = poss.restart
  if (owner.role === "GK" && !restart && w.tick - poss.since < Math.round(w.p.timing.keeperHoldS / w.dt)) return
  w.possession = { ...poss, restart: null }
  finishCarry(w, owner)
  const side = owner.side
  const team = teamOf(w.cfg, side)
  const decision = decide(
    {
      owner,
      teammates: w.active(side),
      opponents: w.active(other(side)),
      style: team.style,
      scoreDiff: w.score[side] - w.score[other(side)],
      minute: w.minute(),
      restart,
      scriptBias: scriptBias(w, side)
    },
    w.p,
    w.rng.decision
  )
  const until = (s: number) => w.tick + Math.max(1, Math.round(s / w.dt))
  switch (decision.action) {
    case "hold":
      w.setPlayer({ ...owner, intent: { kind: "hold" }, intentUntil: until(w.rng.decision.range(0.6, 1.4)) })
      return
    case "carry": {
      const goalDir = norm(sub({ x: dirOf(side) * PITCH.halfL, y: 0 }, owner.pos))
      const dir = norm(add(goalDir, { x: 0, y: w.rng.decision.range(-0.6, 0.6) }))
      w.carry = { playerId: owner.id, at: owner.pos, tick: w.tick }
      w.setPlayer({ ...owner, intent: { kind: "carry", dir, speed: w.p.carry.speed }, intentUntil: until(w.rng.decision.range(...w.p.carry.durationS)) })
      return
    }
    case "take_on": {
      const def = nearestOpponent(owner.pos, w.active(other(side)))!
      const pWin = 1 / (1 + Math.exp(-(w.p.takeOn.b0 + w.p.takeOn.bSkill * (owner.attrs.dribbling - def.attrs.tackling) + w.p.takeOn.bPressure * decision.pressure)))
      const won = w.rng.duel.chance(pWin)
      w.emit(w.pending("take_on", owner, owner.pos, { outcome: won ? "won" : "lost", defender_id: def.id }))
      if (won) {
        const dir = norm(sub({ x: dirOf(side) * PITCH.halfL, y: 0 }, owner.pos))
        w.carry = { playerId: owner.id, at: owner.pos, tick: w.tick }
        w.setPlayer({ ...owner, intent: { kind: "carry", dir, speed: w.p.carry.speed * 1.2 }, intentUntil: until(1.2) })
        w.setPlayer({ ...w.player(def.id), vel: { x: 0, y: 0 }, intent: { kind: "hold" }, intentUntil: until(1.0) })
      } else changePossession(w, def, w.pending("tackle", def, def.pos, { outcome: "won", opponent_id: owner.id }))
      return
    }
    case "shot":
      releaseShot(w, owner, decision, restart)
      return
    default:
      if (owner.role === "GK" && !restart) w.emit(w.pending("keeper_distribution", owner, owner.pos, { method: decision.action === "short_pass" ? "throw" : "kick" }))
      releaseKick(w, owner, decision, restart)
  }
}

const ownedTick = (w: Work): void => {
  if (w.possession.kind !== "owned") return
  const owner = w.player(w.possession.playerId)
  if (owner.sentOff) {
    w.possession = { kind: "loose" }
    return
  }
  if (w.possession.restart === null && duels(w, owner)) return
  if (w.tick >= owner.intentUntil) ownerDecision(w, w.player(owner.id))
}

// ---------------------------------------------------------------- flights and loose ball

const resolveFlightNow = (w: Work, f: Flight): void => {
  w.emit(f.pending, { frame_id_end: f.resolveTick, outcome: f.outcome })
  for (const e of f.extra) w.emit(e)
  if (f.outcome === "goal") w.score[f.side] += 1
  if (f.restartAfter) {
    startRestart(w, f.restartAfter)
    return
  }
  if (f.looseBall) {
    const toucher = f.extra[0]?.player_id
    if (toucher) w.lastTouch = { playerId: toucher, side: w.player(toucher).side }
    w.ball = f.looseBall
    w.possession = { kind: "loose" }
    return
  }
  if (f.winnerId) {
    const winner = w.player(f.winnerId)
    w.possession = { kind: "owned", playerId: winner.id, since: w.tick, restart: null }
    if (w.lastTouch?.side !== winner.side) w.emit(w.pending("possession_change", winner, winner.pos, { reason: f.outcome }))
    w.lastTouch = { playerId: winner.id, side: winner.side }
    w.pressedBy = []
    w.setPlayer({ ...winner, intent: { kind: "hold" }, intentUntil: w.tick + w.decisionDelayTicks() })
    return
  }
  w.possession = { kind: "loose" }
}

const ballTick = (w: Work): void => {
  const pos = w.possession
  if (pos.kind === "owned") {
    const owner = w.player(pos.playerId)
    const facing = len(owner.vel) > 0.2 ? norm(owner.vel) : { x: dirOf(owner.side), y: 0 }
    const at = add(owner.pos, scale(facing, 0.35))
    w.ball = { pos: { x: at.x, y: at.y, z: 0 }, vel: { x: owner.vel.x, y: owner.vel.y, z: 0 } }
    return
  }
  if (pos.kind === "dead") return
  if (pos.kind === "in_flight") {
    const f = pos.flight
    if (w.tick === f.releaseTick) return
    if (f.path) {
      const t = Math.min(1, (w.tick - f.releaseTick) / Math.max(1, f.resolveTick - f.releaseTick))
      const lerp = (a: number, b: number) => a + (b - a) * t
      const prev = w.ball.pos
      const next: Vec3 = { x: lerp(f.path.from.x, f.path.to.x), y: lerp(f.path.from.y, f.path.to.y), z: lerp(f.path.from.z, f.path.to.z) }
      w.ball = { pos: next, vel: { x: (next.x - prev.x) / w.dt, y: (next.y - prev.y) / w.dt, z: (next.z - prev.z) / w.dt } }
    } else w.ball = stepBall(w.ball, w.dt, w.p.ball)
    if (w.tick >= f.resolveTick) resolveFlightNow(w, f)
    return
  }
  // loose
  w.ball = stepBall(w.ball, w.dt, w.p.ball)
  const flat = { x: w.ball.pos.x, y: w.ball.pos.y }
  if (!inPitch(flat)) {
    if (Math.abs(flat.x) > PITCH.halfL && Math.abs(flat.y) < PITCH.goalHalfWidth && w.ball.pos.z < PITCH.goalHeight) {
      // A loose ball over the line between the posts is a goal (an own goal if the defending side touched it last).
      const scoringSide: Side = flat.x > 0 ? "home" : "away"
      const toucher = w.lastTouch ? w.player(w.lastTouch.playerId) : null
      const own = toucher !== null && toucher.side !== scoringSide
      w.emit(w.pending("goal", toucher, flat, { scorer_id: toucher?.id ?? null, own_goal: own }, null, scoringSide))
      w.score[scoringSide] += 1
      startRestart(w, { restart: "kickoff", side: other(scoringSide), at: { x: 0, y: 0 } })
      return
    }
    w.emit(w.pending("ball_out", null, flat, { side: Math.abs(flat.y) > PITCH.halfW ? "touchline" : "byline", last_touch_team: w.lastTouch ? w.teamId(w.lastTouch.side) : null }))
    startRestart(w, restartFromOut(w.lastTouch?.side ?? null, w.ball.pos))
    return
  }
  if (w.ball.pos.z > w.p.kinematics.controlHeightM) return
  const near = w.active().filter((pl) => dist(pl.pos, flat) <= w.p.kinematics.reachM).sort((a, b) => dist(a.pos, flat) - dist(b.pos, flat))
  const first = near[0]
  if (first) changePossession(w, first, w.pending("ball_recovery", first, flat, { kind: "loose_ball" }))
}

// ---------------------------------------------------------------- movement

const moveTarget = (w: Work, pl: PlayerState, ballFlat: Vec2, possSide: Side | null): { target: Vec2; speedCap: number } => {
  const team = teamOf(w.cfg, pl.side)
  const vmax = vmaxFor(pl.attrs, pl.energy, w.p)
  const shape = () => ({ target: anchorFor(team.formation, pl.slot, pl.side, ballFlat, team.style, possSide === pl.side), speedCap: vmax * 0.7 })
  const ph = w.phase
  if (ph.kind === "restart") {
    if (takerFor(w, ph).id === pl.id) return { target: ph.at, speedCap: vmax * 0.8 }
    const a = anchorFor(team.formation, pl.slot, pl.side, ph.at, team.style, ph.side === pl.side)
    if (ph.restart === "kickoff") return { target: kickoffAnchor(team.formation, pl.slot, pl.side, team.style), speedCap: vmax * 0.6 }
    if (pl.side !== ph.side && dist(a, ph.at) < 9.15 && pl.role !== "GK") {
      const away = add(ph.at, scale(norm(sub(a, ph.at)), 9.5))
      return { target: clampToPitch(away), speedCap: vmax * 0.6 }
    }
    return { target: a, speedCap: vmax * 0.6 }
  }
  const pos = w.possession
  if (pos.kind === "owned" && pos.playerId === pl.id) {
    if (pl.intent.kind === "carry" && w.tick < pl.intentUntil) return { target: clampToPitch(add(pl.pos, scale(pl.intent.dir, 5)), 1), speedCap: pl.intent.speed }
    return { target: pl.pos, speedCap: 1 }
  }
  if (pos.kind === "in_flight" && pos.flight.winnerId === pl.id && pl.intent.kind === "chase") return { target: pl.intent.target, speedCap: vmax }
  if (pos.kind === "loose") {
    const chasers = w.active(pl.side).sort((a, b) => dist(a.pos, ballFlat) - dist(b.pos, ballFlat)).slice(0, 2)
    if (chasers.some((c) => c.id === pl.id) && pl.role !== "GK")
      return { target: interceptPoint(pl.pos, vmax, ballFlat, { x: w.ball.vel.x, y: w.ball.vel.y }), speedCap: vmax }
  }
  if (pl.role === "GK") return shape()
  if (pos.kind === "owned" && possSide !== pl.side) {
    const owner = w.player(pos.playerId)
    if (pl.intent.kind === "press" && w.tick < pl.intentUntil && pl.intent.targetId === owner.id)
      return { target: interceptPoint(pl.pos, vmax, owner.pos, owner.vel), speedCap: vmax }
    const defenders = w.active(pl.side).filter((x) => x.role !== "GK").sort((a, b) => dist(a.pos, owner.pos) - dist(b.pos, owner.pos))
    if (defenders[0]?.id === pl.id && dist(pl.pos, owner.pos) < 18) {
      const style = team.style
      if (w.rng.movement.chance(hazard(w.p.defending.pressRatePerS * (0.4 + 1.2 * style.pressIntensity), w.dt))) {
        w.setPlayer({ ...pl, intent: { kind: "press", targetId: owner.id }, intentUntil: w.tick + Math.round(w.rng.movement.range(2, 4) / w.dt) })
        return { target: interceptPoint(pl.pos, vmax, owner.pos, owner.vel), speedCap: vmax }
      }
    }
  }
  if (pos.kind === "owned" && possSide === pl.side && (pl.role === "ST" || pl.role === "W" || pl.role === "AM")) {
    if (pl.intent.kind === "run_in_behind" && w.tick < pl.intentUntil) return { target: pl.intent.target, speedCap: vmax }
    const owner = w.player(pos.playerId)
    if (attackX(pl.side, owner.pos.x) > -20 && w.rng.movement.chance(hazard(w.p.runs.runInBehindRatePerS, w.dt))) {
      const lastDef = lastDefenderAttackX(pl.side, w.active(other(pl.side)))
      const target = clampToPitch({ x: dirOf(pl.side) * Math.min(lastDef + 6, PITCH.halfL - 6), y: pl.pos.y * 0.8 }, 2)
      w.setPlayer({ ...pl, intent: { kind: "run_in_behind", target }, intentUntil: w.tick + Math.round(w.rng.movement.range(2, 3) / w.dt) })
      return { target, speedCap: vmax }
    }
  }
  return shape()
}

const moveAll = (w: Work): void => {
  const ballFlat = { x: w.ball.pos.x, y: w.ball.pos.y }
  const possSide =
    w.possession.kind === "owned" ? w.player(w.possession.playerId).side : w.possession.kind === "in_flight" ? w.possession.flight.side : null
  for (const id of w.players.map((x) => x.id)) {
    const pl = w.player(id)
    if (pl.sentOff) continue
    const { target, speedCap } = moveTarget(w, pl, ballFlat, possSide)
    const cur = w.player(id)
    const vmax = Math.min(speedCap, vmaxFor(cur.attrs, cur.energy, w.p))
    const mates = w.active(cur.side).filter((x) => x.id !== cur.id).map((x) => x.pos)
    const sep = separation(cur.pos, mates)
    const next = arrive(cur.pos, cur.vel, add(target, scale(sep, 2)), Math.max(0.5, vmax), accelFor(cur.attrs, w.p), w.dt)
    const speed = len(next.vel)
    const energy = Math.max(0, cur.energy - w.dt * (0.00004 + 0.000012 * speed * speed))
    w.setPlayer({ ...cur, pos: clampToPitch(next.pos, -2), vel: next.vel, energy })
  }
}

// ---------------------------------------------------------------- periods and frames

const frameOf = (w: Work): Frame => {
  const fp = (side: Side) => w.active(side).map((pl) => ({ id: pl.id, x: round2(pl.pos.x), y: round2(pl.pos.y) }))
  const possSide =
    w.possession.kind === "owned" ? w.player(w.possession.playerId).side : w.possession.kind === "in_flight" ? w.possession.flight.side : null
  return {
    tick: w.tick,
    frame_id: w.periodTick,
    period: w.period,
    timestamp: new Date(w.periodStartMs + Math.round(w.periodTick * w.dt * 1000)).toISOString(),
    home: fp("home"),
    away: fp("away"),
    ball: { x: round2(w.ball.pos.x), y: round2(w.ball.pos.y), z: round2(w.ball.pos.z) },
    ball_in_play: w.phase.kind === "open_play",
    possession_side: possSide
  }
}

const endPeriod = (w: Work): StepResult => {
  w.tick -= 1
  w.periodTick -= 1
  w.emit(w.pending("period_end", null, null, { period: w.period }))
  if (w.period === "second_half") {
    w.emit(w.pending("match_end", null, null, { home: w.score.home, away: w.score.away }))
    w.phase = { kind: "full_time" }
    return { state: w.toState(), frame: null, events: w.events }
  }
  const firstHalfMs = w.periodTicks * w.dt * 1000
  w.tick += 1
  w.period = "second_half"
  w.periodTick = 0
  w.periodStartTick = w.tick
  w.periodStartMs += firstHalfMs + HALF_TIME_MS
  w.periodTicks = samplePeriodTicks(w.cfg, w.rng.restart)
  w.players = kickoffPlayers(w.cfg, w.players)
  w.phase = { kind: "restart", restart: "kickoff", side: "away", at: { x: 0, y: 0 }, resumeTick: w.tick }
  w.possession = { kind: "dead" }
  w.ball = { pos: { x: 0, y: 0, z: 0 }, vel: { x: 0, y: 0, z: 0 } }
  w.emit(w.pending("period_start", null, null, { period: "second_half" }))
  handleRestart(w)
  return { state: w.toState(), frame: frameOf(w), events: w.events }
}

/** Advance the match by one tick. Pure: the input state is never mutated. */
export const step = (s: MatchState): StepResult => {
  if (s.phase.kind === "full_time") return { state: s, frame: null, events: [] }
  const w = new Work(s)
  if (s.tick === -1) {
    w.periodStartTick = 0
    w.emit(w.pending("match_start", null, null, { home: w.cfg.home.id, away: w.cfg.away.id }))
    w.emit(w.pending("period_start", null, null, { period: "first_half" }))
  }
  if (w.periodTick >= w.periodTicks && w.phase.kind !== "restart") return endPeriod(w)
  if (w.periodTick >= w.periodTicks + Math.round(60 / w.dt)) return endPeriod(w)
  if (w.phase.kind === "restart") handleRestart(w)
  if (w.phase.kind === "open_play") ownedTick(w)
  moveAll(w)
  ballTick(w)
  return { state: w.toState(), frame: frameOf(w), events: w.events }
}
```

- [ ] **Step 4: Replace the index**

`packages/sim-core/src/index.ts`

```ts
export * from "./ball.js"
export * from "./classify.js"
export * from "./decide.js"
export * from "./events.js"
export * from "./execute.js"
export * from "./geometry.js"
export * from "./kinematics.js"
export * from "./params.js"
export * from "./resolve.js"
export * from "./rng.js"
export * from "./shape.js"
export * from "./shot.js"
export * from "./step.js"
export * from "./types.js"
```

- [ ] **Step 5: Add the match-runner script**

`packages/sim-core/scripts/run-match.ts`

```ts
import { initMatch, isFinished, step, type DomainEvent } from "../src/index.js"
import { makeConfig } from "../src/testing.js"
const seed = Number(process.argv[2] ?? 1)
const t0 = Date.now()
let s = initMatch(makeConfig(seed))
const events: DomainEvent[] = []
let frames = 0, inPlay = 0
while (!isFinished(s)) { const r = step(s); s = r.state; events.push(...r.events); if (r.frame) { frames++; if (r.frame.ball_in_play) inPlay++ } }
const by = (t: string) => events.filter(e => e.type === t)
const passes = by("pass"); const ok = passes.filter(e => e.outcome === "successful")
const kinds: Record<string, number> = {}; for (const p of passes) { const k = String(p.attrs.kind); kinds[k] = (kinds[k] ?? 0) + 1 }
const exe: Record<string, number> = {}; for (const p of passes) { const k = String(p.attrs.execution); exe[k] = (exe[k] ?? 0) + 1 }
console.log(JSON.stringify({ seed, ms: Date.now() - t0, frames, inPlayPct: +(inPlay / frames * 100).toFixed(1), events: events.length, score: s.score,
  passes: passes.length, completion: +(ok.length / passes.length * 100).toFixed(1), shots: by("shot").length, goals: by("goal").length,
  corners: by("set_piece").filter(e => e.attrs.kind === "corner").length, throwIns: by("set_piece").filter(e => e.attrs.kind === "throw_in").length,
  fouls: by("foul").length, cards: by("card").length, offsides: by("offside").length, tackles: by("tackle").length, takeOns: by("take_on").length,
  carries: by("carry").length, pressures: by("pressure").length, saves: by("keeper_save").length, kinds, exe }))
```

- [ ] **Step 6: Run the whole sim-core suite and typecheck**

Run: `pnpm --filter @touchline/sim-core test && pnpm --filter @touchline/sim-core typecheck`
Expected: 54 passed (about 60–90 s: several full matches run), no type errors

- [ ] **Step 7: Look at a match**

Run: `pnpm --filter @touchline/sim-core match 1`
Expected: one JSON line, `ms` under ~3000, `frames` ~55,000–60,000, passes ~1,300–1,500, completion ~83–87 %. These numbers are uncalibrated by design; Plan 2 tunes them.

- [ ] **Step 8: Commit**

```bash
git add packages/sim-core
git commit -m "feat(sim-core): full-match step function with restarts, duels, flights and movement

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```



### Task 9: Fictional league package

Eight invented clubs covering the four style archetypes, with readable contrasting kits, crests, formations and 20-player squads with role-shaped attributes and seeded fictional names. Names are checked against a blocklist of hashed real-player names (the blocklist file is optional now; Plan 2 builds it from the calibration datasets so no real names are ever committed). The generated league is committed and CI checks it is reproducible.

**Files:**
- Create: `packages/league/package.json`, `packages/league/tsconfig.json`, `packages/league/vitest.config.ts`, `packages/league/src/league.ts`, `packages/league/src/index.ts`, `packages/league/scripts/generate-league.ts`
- Create (generated): `data/league/league.json`
- Modify: `.github/workflows/ci.yml`
- Test: `packages/league/test/league.test.ts`

**Interfaces:**
- Consumes: `FORMATIONS`, `Rng`, `seedRng`, types from `@touchline/sim-core`.
- Produces: `interface Kit`, `interface Club extends TeamSetup {short, kits, crest, squad}`, `interface League {version, seed, clubs}`; `ARCHETYPES`; `contrast(hexA, hexB)`; `normaliseName(name)`; `nameHash(name)` (sha256 prefix of the normalised name); `generateLeague(seed, blockedHashes): League`. Club ids: `ironmoor, kestrel-bay, harrowmere, saltmarsh, eastvale, corrin-forge, larkspur, northwick`.

- [ ] **Step 1: Write the package files**

`packages/league/package.json`

```json
{
  "name": "@touchline/league",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "exports": { ".": "./src/index.ts" },
  "scripts": { "test": "vitest run", "typecheck": "tsc --noEmit -p .", "generate": "tsx scripts/generate-league.ts" },
  "dependencies": { "@touchline/sim-core": "workspace:*" },
  "devDependencies": {  }
}
```

`packages/league/tsconfig.json`

```json
{ "extends": "../../tsconfig.base.json", "include": ["src", "test", "scripts"] }
```

`packages/league/vitest.config.ts`

```ts
import { defineConfig } from "vitest/config"

export default defineConfig({ test: { testTimeout: 120_000 } })
```

- [ ] **Step 2: Write the failing test**

`packages/league/test/league.test.ts`

```ts
import { describe, expect, it } from "vitest"
import { contrast, generateLeague, nameHash } from "../src/league.js"

describe("league", () => {
  const L = generateLeague(2026, new Set())
  it("is deterministic", () => expect(JSON.stringify(generateLeague(2026, new Set()))).toBe(JSON.stringify(L)))
  it("has 8 clubs covering all four archetypes", () => {
    expect(L.clubs).toHaveLength(8)
    expect(new Set(L.clubs.map((c) => c.style.archetype)).size).toBe(4)
  })
  it("gives each club 20 players with unique shirt numbers and 11 starters led by a keeper", () => {
    for (const c of L.clubs) {
      expect(c.squad).toHaveLength(20)
      expect(new Set(c.squad.map((p) => p.jersey)).size).toBe(20)
      expect(c.starters).toHaveLength(11)
      expect(c.starters[0]!.role).toBe("GK")
    }
  })
  it("uses readable kits (contrast >= 3 between primary and secondary)", () => {
    for (const c of L.clubs) expect(contrast(c.kits.home.primary, c.kits.home.secondary)).toBeGreaterThanOrEqual(3)
  })
  it("never uses a blocked name", () => {
    const victim = L.clubs[0]!.squad[0]!.name
    const L2 = generateLeague(2026, new Set([nameHash(victim)]))
    expect(L2.clubs.flatMap((c) => c.squad.map((p) => p.name))).not.toContain(victim)
  })
  it("player names are unique across the league", () => {
    const names = L.clubs.flatMap((c) => c.squad.map((p) => p.name))
    expect(new Set(names).size).toBe(names.length)
  })
})
```

- [ ] **Step 3: Run it to make sure it fails**

Run: `pnpm install && pnpm --filter @touchline/league test`
Expected: FAIL — `../src/league.js` not found

- [ ] **Step 4: Implement the generator**

`packages/league/src/league.ts`

```ts
import { createHash } from "node:crypto"
import { FORMATIONS, Rng, seedRng, type FormationName, type PlayerAttrs, type PlayerSetup, type Role, type TeamSetup, type TeamStyle } from "@touchline/sim-core"

export interface Kit { readonly primary: string; readonly secondary: string }
export interface Club extends TeamSetup {
  readonly short: string
  readonly kits: { readonly home: Kit; readonly away: Kit }
  readonly crest: { readonly shape: "shield" | "circle" | "diamond"; readonly symbol: string }
  readonly squad: ReadonlyArray<PlayerSetup & { readonly name: string; readonly preferredFoot: "left" | "right" }>
}
export interface League { readonly version: string; readonly seed: number; readonly clubs: ReadonlyArray<Club> }

export const ARCHETYPES: Readonly<Record<TeamStyle["archetype"], TeamStyle>> = {
  high_press: { archetype: "high_press", pressIntensity: 0.9, lineHeight: 0.8, compactness: 0.6, tempo: 0.8, longBallBias: -0.2, crossBias: 0, riskTolerance: 0.6 },
  possession: { archetype: "possession", pressIntensity: 0.6, lineHeight: 0.5, compactness: 0.5, tempo: 0.4, longBallBias: -0.6, crossBias: -0.3, riskTolerance: 0.4 },
  direct: { archetype: "direct", pressIntensity: 0.4, lineHeight: 0, compactness: 0.5, tempo: 0.8, longBallBias: 0.7, crossBias: 0.5, riskTolerance: 0.6 },
  low_block: { archetype: "low_block", pressIntensity: 0.15, lineHeight: -0.8, compactness: 0.9, tempo: 0.3, longBallBias: 0.3, crossBias: 0.2, riskTolerance: 0.3 }
}

/** Fixed club identities; names were checked by hand for real-club clashes and are re-checked by the blocklist. */
const CLUB_SEEDS: ReadonlyArray<{ id: string; name: string; short: string; archetype: TeamStyle["archetype"]; formation: FormationName }> = [
  { id: "ironmoor", name: "Ironmoor Athletic", short: "IRO", archetype: "high_press", formation: "4-3-3" },
  { id: "kestrel-bay", name: "Kestrel Bay FC", short: "KES", archetype: "possession", formation: "4-3-3" },
  { id: "harrowmere", name: "Harrowmere Town", short: "HAR", archetype: "direct", formation: "4-4-2" },
  { id: "saltmarsh", name: "Saltmarsh Rovers", short: "SAL", archetype: "low_block", formation: "4-4-2" },
  { id: "eastvale", name: "Eastvale United", short: "EVU", archetype: "possession", formation: "4-2-3-1" },
  { id: "corrin-forge", name: "Corrin Forge", short: "COR", archetype: "high_press", formation: "4-2-3-1" },
  { id: "larkspur", name: "Larkspur City", short: "LAR", archetype: "direct", formation: "3-5-2" },
  { id: "northwick", name: "Northwick Mariners", short: "NOR", archetype: "low_block", formation: "3-5-2" }
]

const FIRST = ["Ka", "Lo", "Me", "Ri", "Da", "Fe", "Ilo", "Ta", "Vo", "Ne", "Sa", "Ju", "Ory", "Bel", "Cai", "Edo", "Mar", "Tor"]
const FIRST_END = ["ren", "vo", "lin", "dan", "mir", "seo", "tan", "ric", "nel", "bo", "ris", "lem"]
const LAST_A = ["Vor", "Hal", "Brek", "Sund", "Okar", "Mell", "Tav", "Quin", "Dren", "Ash", "Lum", "Carr", "Fen", "Wyl", "Ost"]
const LAST_B = ["ane", "ström", "isse", "oway", "ardt", "elli", "ovic", "ham", "ussen", "eda", "ford", "inho", "aro", "berg"]

const hex = (r: Rng) => "#" + Array.from({ length: 3 }, () => Math.floor(r.range(20, 235)).toString(16).padStart(2, "0")).join("")
const luminance = (h: string): number => {
  const c = [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4))
  return 0.2126 * c[0]! + 0.7152 * c[1]! + 0.0722 * c[2]!
}
export const contrast = (a: string, b: string): number => {
  const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p) as [number, number]
  return (x + 0.05) / (y + 0.05)
}
const colourDistance = (a: string, b: string): number => {
  const ca = [1, 3, 5].map((i) => parseInt(a.slice(i, i + 2), 16)), cb = [1, 3, 5].map((i) => parseInt(b.slice(i, i + 2), 16))
  return Math.hypot(ca[0]! - cb[0]!, ca[1]! - cb[1]!, ca[2]! - cb[2]!)
}

export const normaliseName = (n: string): string => n.normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z]/g, "")
export const nameHash = (n: string): string => createHash("sha256").update(normaliseName(n)).digest("hex").slice(0, 16)

const ROLE_BIAS: Readonly<Record<Role, Partial<Record<keyof PlayerAttrs, number>>>> = {
  GK: { handling: 0.25, reflexes: 0.25, longPassing: 0.05, pace: -0.15, finishing: -0.3, dribbling: -0.2 },
  CB: { tackling: 0.2, heading: 0.2, pace: -0.05, finishing: -0.2, dribbling: -0.1 },
  FB: { pace: 0.12, crossing: 0.12, stamina: 0.1, tackling: 0.08 },
  DM: { tackling: 0.15, shortPassing: 0.1, vision: 0.05, stamina: 0.08 },
  CM: { shortPassing: 0.15, vision: 0.12, stamina: 0.1 },
  AM: { vision: 0.18, dribbling: 0.12, shortPassing: 0.1, finishing: 0.05 },
  W: { pace: 0.18, dribbling: 0.15, crossing: 0.12 },
  ST: { finishing: 0.22, heading: 0.1, composure: 0.1, pace: 0.05 }
}
const KEYS: ReadonlyArray<keyof PlayerAttrs> = ["pace", "acceleration", "shortPassing", "longPassing", "vision", "crossing", "dribbling", "finishing", "heading", "tackling", "composure", "stamina", "handling", "reflexes"]

const attrsFor = (role: Role, quality: number, r: Rng): PlayerAttrs => {
  const out = {} as Record<keyof PlayerAttrs, number>
  for (const k of KEYS) out[k] = Math.round(Math.max(0.15, Math.min(0.97, quality + (ROLE_BIAS[role][k] ?? 0) + r.normal() * 0.07)) * 100) / 100
  return out
}

const BENCH_ROLES: ReadonlyArray<Role> = ["GK", "CB", "FB", "DM", "CM", "AM", "W", "ST", "CM"]

/** Generate the fictional league deterministically. `blocked` holds name hashes of real players to avoid. */
export const generateLeague = (seed: number, blocked: ReadonlySet<string>): League => {
  const r = new Rng(seedRng(seed))
  const used = new Set<string>()
  const name = (): string => {
    for (;;) {
      const n = `${FIRST[Math.floor(r.uniform() * FIRST.length)]}${FIRST_END[Math.floor(r.uniform() * FIRST_END.length)]} ${LAST_A[Math.floor(r.uniform() * LAST_A.length)]}${LAST_B[Math.floor(r.uniform() * LAST_B.length)]}`
      const h = nameHash(n)
      if (!blocked.has(h) && !used.has(h)) { used.add(h); return n }
    }
  }
  const primaries: string[] = []
  const clubs = CLUB_SEEDS.map((c, ci) => {
    let primary = hex(r)
    while (primaries.some((p) => colourDistance(p, primary) < 90)) primary = hex(r)
    primaries.push(primary)
    let secondary = hex(r)
    while (contrast(primary, secondary) < 3) secondary = hex(r)
    let awayPrimary = hex(r)
    while (colourDistance(awayPrimary, primary) < 140 || contrast(awayPrimary, secondary) < 2) awayPrimary = hex(r)
    const quality = 0.55 + 0.04 * ((ci * 5) % 7) / 6
    const roles = [...FORMATIONS[c.formation].map((s) => s.role), ...BENCH_ROLES]
    const squad = roles.map((role, i) => ({
      id: `p-${c.short.toLowerCase()}-${String(i + 1).padStart(2, "0")}`,
      role,
      jersey: i + 1,
      attrs: attrsFor(role, quality, r),
      name: name(),
      preferredFoot: (r.chance(0.22) ? "left" : "right") as "left" | "right"
    }))
    return {
      id: c.id,
      name: c.name,
      short: c.short,
      formation: c.formation,
      style: ARCHETYPES[c.archetype],
      starters: squad.slice(0, 11),
      squad,
      kits: { home: { primary, secondary }, away: { primary: awayPrimary, secondary } },
      crest: { shape: (["shield", "circle", "diamond"] as const)[ci % 3]!, symbol: ["anvil", "kestrel", "gate", "wave", "sun", "hammer", "flower", "anchor"][ci]! }
    } satisfies Club
  })
  return { version: "1.0.0", seed, clubs }
}
```

`packages/league/src/index.ts`

```ts
export * from "./league.js"
```

`packages/league/scripts/generate-league.ts`

```ts
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { generateLeague } from "../src/league.js"

const root = join(dirname(fileURLToPath(import.meta.url)), "../../..")
const blockFile = join(root, "data/blocklist/real-player-name-hashes.txt")
const blocked = new Set(existsSync(blockFile) ? readFileSync(blockFile, "utf8").split("\n").map((l) => l.trim()).filter(Boolean) : [])
const league = generateLeague(2026, blocked)
mkdirSync(join(root, "data/league"), { recursive: true })
writeFileSync(join(root, "data/league/league.json"), JSON.stringify(league, null, 1) + "\n")
console.log(`wrote ${league.clubs.length} clubs, ${league.clubs.reduce((n, c) => n + c.squad.length, 0)} players (blocklist: ${blocked.size} hashes)`)
```

- [ ] **Step 5: Run the tests and generate the league**

Run: `pnpm --filter @touchline/league test && pnpm league`
Expected: 6 passed; `wrote 8 clubs, 160 players (blocklist: 0 hashes)`

- [ ] **Step 6: Make CI check the league is reproducible**

`.github/workflows/ci.yml` — replaces the Task 1 version

```yaml
name: ci
on:
  push:
  pull_request:
jobs:
  typescript:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: pnpm
      - run: pnpm install --frozen-lockfile
      - run: pnpm league
      - run: git diff --exit-code data/league/league.json
      - run: pnpm typecheck
      - run: pnpm test
```

- [ ] **Step 7: Commit**

```bash
git add packages/league data/league/league.json .github/workflows/ci.yml pnpm-lock.yaml
git commit -m "feat(league): deterministic fictional league with kits, styles and squads

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```



### Task 10: Domain stream schema

The Effect Schema for the live domain stream (events and frames) that the stats engine and agents will consume in later plans. A full simulated match must decode.

**Files:**
- Create: `packages/schema/package.json`, `packages/schema/tsconfig.json`, `packages/schema/vitest.config.ts`, `packages/schema/src/domain.ts`, `packages/schema/src/index.ts`
- Test: `packages/schema/test/schema.test.ts`

**Interfaces:**
- Consumes: `effect@4.0.0` (`Schema.Struct`, `Schema.Literals`, `Schema.Union`, `Schema.NullOr`, `Schema.Finite`, `Schema.Int`, `Schema.Record`, `Schema.decodeUnknownSync`); `@touchline/sim-core` and its `testing` helpers (dev only).
- Produces: schemas `EventType`, `Period`, `AttrValue`, `DomainEvent`, `Frame`; types `DomainEvent`, `Frame`; `decodeDomainEvent(u)`, `decodeFrame(u)` (throw on invalid input).

- [ ] **Step 1: Write the package files**

`packages/schema/package.json`

```json
{
  "name": "@touchline/schema",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "exports": { ".": "./src/index.ts" },
  "scripts": { "test": "vitest run", "typecheck": "tsc --noEmit -p ." },
  "dependencies": { "effect": "4.0.0" },
  "devDependencies": { "@touchline/sim-core": "workspace:*" }
}
```

`packages/schema/tsconfig.json`

```json
{ "extends": "../../tsconfig.base.json", "include": ["src", "test", "scripts"] }
```

`packages/schema/vitest.config.ts`

```ts
import { defineConfig } from "vitest/config"

export default defineConfig({ test: { testTimeout: 120_000 } })
```

- [ ] **Step 2: Write the failing test**

`packages/schema/test/schema.test.ts`

```ts
import { describe, expect, it } from "vitest"
import { initMatch, isFinished, step, type DomainEvent as SimEvent, type Frame as SimFrame } from "@touchline/sim-core"
import { decodeDomainEvent, decodeFrame } from "../src/domain.js"
import { makeConfig } from "@touchline/sim-core/testing"

describe("domain schema", () => {
  it("decodes every event and a sample of frames from a full match", () => {
    let s = initMatch(makeConfig(5))
    const ev: SimEvent[] = []
    const fr: SimFrame[] = []
    while (!isFinished(s)) { const r = step(s); s = r.state; ev.push(...r.events); if (r.frame && r.frame.tick % 100 === 0) fr.push(r.frame) }
    for (const e of ev) expect(() => decodeDomainEvent(e)).not.toThrow()
    for (const f of fr) expect(() => decodeFrame(f)).not.toThrow()
  })
  it("rejects an unknown event type", () => {
    expect(() => decodeDomainEvent({ type: "dance" })).toThrow()
  })
})
```

- [ ] **Step 3: Run it to make sure it fails**

Run: `pnpm install && pnpm --filter @touchline/schema test`
Expected: FAIL — `../src/domain.js` not found

- [ ] **Step 4: Implement the schema**

`packages/schema/src/domain.ts`

```ts
import { Schema } from "effect"

export const EventType = Schema.Literals([
  "match_start", "period_start", "period_end", "match_end", "pass", "reception", "carry", "take_on", "shot", "goal",
  "keeper_save", "keeper_distribution", "aerial_duel", "pressure", "tackle", "interception", "block", "clearance",
  "ball_recovery", "possession_change", "ball_out", "foul", "card", "offside", "set_piece"
])
export const Period = Schema.Literals(["first_half", "second_half"])
export const AttrValue = Schema.Union([Schema.String, Schema.Number, Schema.Boolean, Schema.Null, Schema.Array(Schema.String)])

export const DomainEvent = Schema.Struct({
  id: Schema.String,
  match_id: Schema.String,
  type: EventType,
  frame_id: Schema.Int,
  period_frame_id: Schema.Int,
  period: Period,
  match_clock: Schema.String,
  team_id: Schema.NullOr(Schema.String),
  player_id: Schema.NullOr(Schema.String),
  x: Schema.NullOr(Schema.Finite),
  y: Schema.NullOr(Schema.Finite),
  x_end: Schema.NullOr(Schema.Finite),
  y_end: Schema.NullOr(Schema.Finite),
  frame_id_end: Schema.NullOr(Schema.Int),
  outcome: Schema.NullOr(Schema.String),
  source: Schema.Literals(["sim", "replay", "vision"]),
  confidence: Schema.Finite,
  attrs: Schema.Record(Schema.String, AttrValue)
})
export type DomainEvent = typeof DomainEvent.Type

const FramePlayer = Schema.Struct({ id: Schema.String, x: Schema.Finite, y: Schema.Finite })
export const Frame = Schema.Struct({
  tick: Schema.Int,
  frame_id: Schema.Int,
  period: Period,
  timestamp: Schema.String,
  home: Schema.Array(FramePlayer),
  away: Schema.Array(FramePlayer),
  ball: Schema.Struct({ x: Schema.Finite, y: Schema.Finite, z: Schema.Finite }),
  ball_in_play: Schema.Boolean,
  possession_side: Schema.NullOr(Schema.Literals(["home", "away"]))
})
export type Frame = typeof Frame.Type

export const decodeDomainEvent = Schema.decodeUnknownSync(DomainEvent)
export const decodeFrame = Schema.decodeUnknownSync(Frame)
```

`packages/schema/src/index.ts`

```ts
export * from "./domain.js"
```

- [ ] **Step 5: Run the tests**

Run: `pnpm --filter @touchline/schema test && pnpm --filter @touchline/schema typecheck`
Expected: 2 passed, no type errors

- [ ] **Step 6: Commit**

```bash
git add packages/schema pnpm-lock.yaml
git commit -m "feat(schema): Effect Schema for domain events and frames

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```



### Task 11: CDF v0.3.2 export

Pure functions that turn engine output into CDF: `meta.json`, one `tracking.jsonl` line per frame, and `event.jsonl` lines. Domain events map to the nearest CDF type; reception and possession_change are not exported; referee events (foul, card, offside) carry `official_id` and **no** player or team id, as the v0.3.2 schema requires. Frame ids in events are period-relative.

**Files:**
- Create: `packages/sim/package.json`, `packages/sim/tsconfig.json`, `packages/sim/vitest.config.ts`, `packages/sim/src/cdf.ts`, `packages/sim/src/index.ts` (cdf only for now)
- Test: `packages/sim/test/cdf.test.ts`

**Interfaces:**
- Consumes: `DomainEvent`, `Frame`, `MatchConfig`, `TeamSetup` from `@touchline/sim-core`.
- Produces: `CDF_VERSION = "0.3.2"`, `REFEREE_ID`, `ENGINE`; `interface PeriodInfo`; `periodsFromFrames(frames)`; `cdfMeta(cfg, periods, extra?)`; `cdfTrackingLine(matchId, cfg, frame): string`; `cdfTypeOf(event)` (null = not exported); `type TickClock = (tick) => ISO string`; `cdfEventLine(cfg, event, clock, periodStartTick, receiverTick): string | null`.

- [ ] **Step 1: Write the package files**

`packages/sim/package.json`

```json
{
  "name": "@touchline/sim",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "exports": { ".": "./src/index.ts" },
  "scripts": { "test": "vitest run", "typecheck": "tsc --noEmit -p .", "sim": "tsx src/cli.ts" },
  "dependencies": { "@touchline/league": "workspace:*", "@touchline/sim-core": "workspace:*", "effect": "4.0.0" },
  "devDependencies": { "@effect/vitest": "4.0.0" }
}
```

`packages/sim/tsconfig.json`

```json
{ "extends": "../../tsconfig.base.json", "include": ["src", "test", "scripts"] }
```

`packages/sim/vitest.config.ts`

```ts
import { defineConfig } from "vitest/config"

export default defineConfig({ test: { testTimeout: 120_000 } })
```

- [ ] **Step 2: Write the failing test**

`packages/sim/test/cdf.test.ts`

```ts
import { describe, expect, it } from "vitest"
import { initMatch, isFinished, step, type DomainEvent, type Frame } from "@touchline/sim-core"
import { makeConfig } from "@touchline/sim-core/testing"
import { cdfEventLine, cdfMeta, cdfTrackingLine, cdfTypeOf, periodsFromFrames, REFEREE_ID } from "../src/cdf.js"

const cfg = makeConfig(8)
let s = initMatch(cfg)
const frames: Frame[] = []
const events: DomainEvent[] = []
while (!isFinished(s)) {
  const r = step(s)
  s = r.state
  if (r.frame) frames.push(r.frame)
  events.push(...r.events)
}
const clock = (t: number) => frames.find((f) => f.tick === t)?.timestamp ?? frames.at(-1)!.timestamp
const start = (p: string) => frames.find((f) => f.period === p && f.frame_id === 0)!.tick

describe("CDF export", () => {
  it("meta declares 10 fps, CDF 0.3.2, two periods starting at frame 0", () => {
    const m = cdfMeta(cfg, periodsFromFrames(frames))
    expect(m.meta.tracking.fps).toBe(10)
    expect(m.meta.cdf.version).toBe("0.3.2")
    expect(m.match.periods.map((p) => p.frame_id_start)).toEqual([0, 0])
  })
  it("tracking lines carry only schema keys", () => {
    const line = JSON.parse(cdfTrackingLine(cfg.matchId, cfg, frames[100]!))
    expect(Object.keys(line).sort()).toEqual(["ball", "frame_id", "match", "period", "teams", "timestamp"])
    expect(line.teams.home.players.length).toBe(11)
  })
  it("referee events use official_id and no player or team", () => {
    const foul = events.find((e) => e.type === "foul")!
    const line = JSON.parse(cdfEventLine(cfg, foul, clock, start, null)!)
    expect(line.event.type).toBe("referee")
    expect(line.event.official_id).toBe(REFEREE_ID)
    expect(line.event.player_id).toBeUndefined()
  })
  it("does not export reception or possession_change, and maps passes and shots", () => {
    expect(cdfTypeOf(events.find((e) => e.type === "reception")!)).toBeNull()
    expect(cdfTypeOf(events.find((e) => e.type === "pass")!)!.type).toBe("pass")
    expect(cdfTypeOf(events.find((e) => e.type === "shot")!)!.type).toBe("shot")
  })
  it("event tracking frame ids are period-relative", () => {
    const pass = events.find((e) => e.type === "pass" && e.period === "second_half")!
    const line = JSON.parse(cdfEventLine(cfg, pass, clock, start, pass.frame_id_end)!)
    expect(line.tracking.frame_id).toBe(pass.frame_id - start("second_half"))
  })
})
```

- [ ] **Step 3: Run it to make sure it fails**

Run: `pnpm install && pnpm --filter @touchline/sim test cdf`
Expected: FAIL — `../src/cdf.js` not found

- [ ] **Step 4: Implement the CDF export**

`packages/sim/src/cdf.ts`

```ts
import type { DomainEvent, Frame, MatchConfig, MatchState, TeamSetup } from "@touchline/sim-core"

export const CDF_VERSION = "0.3.2"
export const REFEREE_ID = "ref-main"
export const ENGINE = { name: "touchline-sim", version: "0.1.0" } as const

const iso = (ms: number): string => new Date(ms).toISOString()

export interface PeriodInfo {
  readonly period: "first_half" | "second_half"
  readonly startMs: number
  readonly endMs: number
  readonly frameIdEnd: number
}

/** Collect period boundaries from the frame stream (first and last frame of each period). */
export const periodsFromFrames = (frames: Iterable<Frame>): PeriodInfo[] => {
  const map = new Map<string, { start: string; end: string; last: number }>()
  for (const f of frames) {
    const m = map.get(f.period)
    if (!m) map.set(f.period, { start: f.timestamp, end: f.timestamp, last: f.frame_id })
    else { m.end = f.timestamp; m.last = f.frame_id }
  }
  return [...map.entries()].map(([period, m]) => ({ period: period as PeriodInfo["period"], startMs: Date.parse(m.start), endMs: Date.parse(m.end), frameIdEnd: m.last }))
}

const team = (t: TeamSetup) => ({
  id: t.id,
  name: t.name,
  players: t.starters.map((p) => ({ id: p.id, team_id: t.id, jersey_number: p.jersey, is_starter: true }))
})

export const cdfMeta = (cfg: MatchConfig, periods: ReadonlyArray<PeriodInfo>, extra: { competitionId?: string; seasonId?: string; venueId?: string } = {}) => ({
  competition: { id: extra.competitionId ?? "touchline-league", name: "Touchline League (synthetic)", format: "league_20", type: "mens" },
  season: { id: extra.seasonId ?? "tl-2026", name: "2026" },
  match: {
    id: cfg.matchId,
    kickoff_time: cfg.kickoffTime,
    periods: periods.map((p) => ({
      period: p.period,
      play_direction: "left_right",
      start_time: iso(p.startMs),
      end_time: iso(p.endMs),
      frame_id_start: 0,
      frame_id_end: p.frameIdEnd,
      left_team_id: cfg.home.id,
      right_team_id: cfg.away.id
    })),
    whistles: periods.flatMap((p) => [
      { type: p.period, sub_type: "start", time: iso(p.startMs) },
      { type: p.period, sub_type: "end", time: iso(p.endMs) }
    ])
  },
  teams: { home: team(cfg.home), away: team(cfg.away) },
  venue: { id: extra.venueId ?? "touchline-park", name: "Touchline Park (synthetic)", pitch_length: 105, pitch_width: 68 },
  officials: [{ id: REFEREE_ID, type: "main_referee" }],
  meta: {
    video: null,
    event: { collection_timing: "post_match", name: ENGINE.name, version: ENGINE.version },
    tracking: { version: ENGINE.version, name: ENGINE.name, fps: Math.round(1 / cfg.dt), collection_timing: "post_match" },
    landmarks: null,
    ball: null,
    meta: { version: ENGINE.version, name: ENGINE.name },
    cdf: { version: CDF_VERSION }
  }
})

export const cdfTrackingLine = (matchId: string, cfg: MatchConfig, f: Frame): string =>
  JSON.stringify({
    frame_id: f.frame_id,
    timestamp: f.timestamp,
    period: f.period,
    match: { id: matchId },
    teams: { home: { id: cfg.home.id, players: f.home }, away: { id: cfg.away.id, players: f.away } },
    ball: { x: f.ball.x, y: f.ball.y, z: f.ball.z, status: f.ball_in_play, ...(f.possession_side ? { poss_team_id: f.possession_side === "home" ? cfg.home.id : cfg.away.id } : {}) }
  })

type CdfType = { type: string; sub_type: string | null; outcome_type: string; is_successful: boolean } | null

const RESTART_SUBTYPE: Record<string, string> = { throw_in: "throw_in", corner: "corner_kick", goal_kick: "goal_kick", free_kick: "free_kick", kickoff: "kick_off", penalty: "penalty_kick" }

/** Map a domain event to a CDF type, or null when the event is not exported (reception, possession_change, ...). */
export const cdfTypeOf = (e: DomainEvent): CdfType => {
  const a = e.attrs
  switch (e.type) {
    case "pass": {
      const restart = typeof a.restart === "string" ? RESTART_SUBTYPE[a.restart] ?? null : null
      const outcome = e.outcome === "successful" ? "successful" : e.outcome === "out_of_play" ? "out_of_play" : "intercepted"
      return { type: "pass", sub_type: restart === "penalty_kick" ? null : restart, outcome_type: outcome, is_successful: e.outcome === "successful" }
    }
    case "shot": {
      const sub = a.technique === "penalty" ? "penalty_kick" : a.technique === "free_kick" ? "free_kick" : null
      const outcome = e.outcome === "goal" ? "successful" : String(e.outcome)
      return { type: "shot", sub_type: sub, outcome_type: outcome, is_successful: e.outcome === "goal" }
    }
    case "clearance":
      return { type: "defending", sub_type: "clearance", outcome_type: "clearance", is_successful: true }
    case "interception":
      return { type: "defending", sub_type: "interception", outcome_type: "interception", is_successful: true }
    case "pressure":
      return { type: "defending", sub_type: "pressing", outcome_type: "pressure", is_successful: true }
    case "block":
      return { type: "defending", sub_type: "block", outcome_type: "block", is_successful: true }
    case "keeper_save":
      return { type: "goalkeeping", sub_type: a.technique === "catch" ? "claim" : "save", outcome_type: "save", is_successful: true }
    case "tackle":
      return { type: "misc", sub_type: "tackle", outcome_type: a.outcome === "won" ? "successful" : "unsuccessful", is_successful: a.outcome === "won" }
    case "carry":
    case "take_on":
    case "aerial_duel":
    case "ball_recovery":
      return { type: "misc", sub_type: "other_ball_action", outcome_type: a.outcome === "lost" ? "unsuccessful" : "successful", is_successful: a.outcome !== "lost" }
    case "foul":
      return { type: "referee", sub_type: "foul", outcome_type: "start", is_successful: true }
    case "card":
      return { type: "referee", sub_type: "caution", outcome_type: a.colour === "yellow" ? "yellow_card" : a.colour === "red" ? "red_card" : "second_yellow_card", is_successful: true }
    case "offside":
      return { type: "referee", sub_type: "offside", outcome_type: "offside", is_successful: true }
    default:
      return null
  }
}

const BODY = new Set(["left_foot", "right_foot", "feet", "head", "hands", "upper_body", "lower_body", "body", "other"])

/** Timestamp (ms) of a global tick, using the period table built from frames. */
export type TickClock = (tick: number) => string

export const cdfEventLine = (cfg: MatchConfig, e: DomainEvent, clock: TickClock, periodStartTick: (period: string) => number, receiverTick: number | null): string | null => {
  const t = cdfTypeOf(e)
  if (!t) return null
  const isRef = t.type === "referee"
  const body = typeof e.attrs.body_part === "string" && BODY.has(e.attrs.body_part) ? e.attrs.body_part : null
  const passOrShot = t.type === "pass" || t.type === "shot"
  const receiver = e.type === "pass" && e.outcome === "successful" ? (e.attrs.receiver_id as string | undefined) ?? null : null
  const start = periodStartTick(e.period)
  const event: Record<string, unknown> = {
    id: e.id,
    time: clock(e.frame_id),
    period: e.period,
    type: t.type,
    sub_type: t.sub_type,
    is_successful: t.is_successful,
    outcome_type: t.outcome_type,
    receiver_id: receiver,
    receiver_time: receiver && receiverTick !== null ? clock(receiverTick) : null,
    receiver_team_id: receiver ? e.team_id : null,
    x: e.x ?? 0,
    y: e.y ?? 0,
    x_end: e.x_end ?? (passOrShot ? e.x ?? 0 : null),
    y_end: e.y_end ?? (passOrShot ? e.y ?? 0 : null),
    body_part: body ?? (passOrShot ? "other" : null),
    related_event_ids: null,
    match_clock: e.match_clock
  }
  if (isRef) event.official_id = REFEREE_ID
  else {
    event.player_id = e.player_id
    event.team_id = e.team_id
  }
  const metrics: Record<string, number> = {}
  if (typeof e.attrs.xg === "number") metrics.xg = e.attrs.xg
  if (typeof e.attrs.xpass === "number") metrics.xpass = e.attrs.xpass
  if (Object.keys(metrics).length) event.metrics = metrics
  const tracking: Record<string, number> = { frame_id: e.frame_id - start }
  if (e.frame_id_end !== null) tracking.frame_id_end = e.frame_id_end - start
  return JSON.stringify({ match: { id: e.match_id }, meta: { is_synced: true }, event, tracking })
}
```

`packages/sim/src/index.ts` — temporary, completed in Task 12

```ts
export * from "./cdf.js"
```

- [ ] **Step 5: Run the tests**

Run: `pnpm --filter @touchline/sim test cdf`
Expected: 5 passed

- [ ] **Step 6: Commit**

```bash
git add packages/sim pnpm-lock.yaml
git commit -m "feat(sim): CDF v0.3.2 meta, tracking and event export

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```



### Task 12: Effect streams, file writer, CLI and CDF validation in CI

Wrap the pure engine in Effect: an unpaced stream for batch runs and a paced stream (`Schedule.spaced(dt / speed)`) for live playback, proven identical with `TestClock`. A writer streams tracking to disk and writes `meta.json`, `event.jsonl`, `domain.jsonl` and a `manifest.json` with SHA-256 hashes. A CLI drives it. A small uv project validates output with the official CDF validator, and CI runs it on every push.

**Files:**
- Create: `packages/sim/src/run.ts`, `packages/sim/src/writer.ts`, `packages/sim/src/cli.ts`
- Modify: `packages/sim/src/index.ts`, `.github/workflows/ci.yml`
- Create: `python/analytics/pyproject.toml`, `python/analytics/touchline_analytics/__init__.py` (empty), `python/analytics/touchline_analytics/validate_cdf.py`
- Test: `packages/sim/test/stream.test.ts`

**Interfaces:**
- Consumes: `initMatch`, `step`, `isFinished`, `DEFAULT_PARAMS` (sim-core); `League` (league); CDF functions (Task 11); `effect` `Stream`, `Schedule`, `Effect`, `Fiber`; `effect/testing` `TestClock`; `@effect/vitest` `it.effect`.
- Produces: `matchSteps(cfg): Stream<StepResult>` (ends with the full-time step); `pacedSteps(cfg, speed)`; `collect(stream)`; `interface RunManifest`; `writeMatch(cfg, dir, script?): Effect<RunManifest>`; CLI `pnpm sim --seed --home --away --fps --match-id --kickoff --out`; Python `touchline_analytics.validate_cdf <dir>` (exit 0 when all three files are valid).

- [ ] **Step 1: Write the failing test**

`packages/sim/test/stream.test.ts`

```ts
import { describe, expect, it } from "@effect/vitest"
import { createHash } from "node:crypto"
import { Effect, Fiber, Stream } from "effect"
import { TestClock } from "effect/testing"
import { collect, matchSteps, pacedSteps } from "../src/run.js"
import { makeConfig } from "@touchline/sim-core/testing"

const hash = (x: unknown) => createHash("sha256").update(JSON.stringify(x)).digest("hex")

describe("match stream", () => {
  it.effect("paced and unpaced runs produce identical output", () =>
    Effect.gen(function* () {
      const cfg = makeConfig(3)
      const unpaced = yield* collect(matchSteps(cfg).pipe(Stream.take(1200)))
      const fiber = yield* Effect.forkChild(collect(pacedSteps(cfg, 4).pipe(Stream.take(1200))))
      yield* TestClock.adjust("40 seconds")
      const paced = yield* Fiber.join(fiber)
      expect(paced.length).toBe(1200)
      expect(hash(paced.map((r) => [r.frame, r.events]))).toBe(hash(unpaced.map((r) => [r.frame, r.events])))
    }))
  it.effect("ends at full time", () =>
    Effect.gen(function* () {
      const all = yield* collect(matchSteps(makeConfig(4)))
      expect(all.at(-1)!.events.at(-1)!.type).toBe("match_end")
      expect(all.at(-1)!.frame).toBeNull()
    }))
})
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `pnpm --filter @touchline/sim test stream`
Expected: FAIL — `../src/run.js` not found

- [ ] **Step 3: Implement the streams**

`packages/sim/src/run.ts`

```ts
import { Effect, Schedule, Stream } from "effect"
import { initMatch, isFinished, step, type MatchConfig, type StepResult } from "@touchline/sim-core"

/** Every step of a match as a stream; the final full-time step is included. */
export const matchSteps = (cfg: MatchConfig): Stream.Stream<StepResult> =>
  Stream.iterate<StepResult>({ state: initMatch(cfg), frame: null, events: [] }, (r) => step(r.state)).pipe(
    Stream.drop(1),
    Stream.takeUntil((r) => isFinished(r.state))
  )

/** Paced for live playback: one step every (dt / speed) seconds of wall-clock time. */
export const pacedSteps = (cfg: MatchConfig, speed: number): Stream.Stream<StepResult> =>
  matchSteps(cfg).pipe(Stream.schedule(Schedule.spaced(`${Math.round((cfg.dt * 1000) / speed)} millis`)))

export const collect = <A>(s: Stream.Stream<A>) => Stream.runCollect(s).pipe(Effect.map((c) => Array.from(c)))
```

- [ ] **Step 4: Implement the writer and CLI**

`packages/sim/src/writer.ts`

```ts
import { createHash } from "node:crypto"
import { closeSync, mkdirSync, openSync, readFileSync, writeFileSync, writeSync } from "node:fs"
import { join } from "node:path"
import { Effect, Stream } from "effect"
import type { DomainEvent, Frame, MatchConfig } from "@touchline/sim-core"
import { cdfEventLine, cdfMeta, cdfTrackingLine, periodsFromFrames } from "./cdf.js"
import { matchSteps } from "./run.js"

export interface RunManifest {
  readonly match_id: string
  readonly seed: number
  readonly home: string
  readonly away: string
  readonly script: string | null
  readonly fps: number
  readonly params_version: string
  readonly engine: { readonly name: string; readonly version: string }
  readonly outputs: Readonly<Record<string, string>>
  readonly stats: { readonly frames: number; readonly events: number; readonly cdf_events: number; readonly score: string }
}

const sha256 = (path: string) => "sha256:" + createHash("sha256").update(readFileSync(path)).digest("hex")

/**
 * Run one match and write meta.json, event.jsonl, tracking.jsonl, domain.jsonl and manifest.json to `dir`.
 * Tracking is streamed to disk; events are kept in memory (a few thousand) to resolve CDF receiver times.
 */
export const writeMatch = (cfg: MatchConfig, dir: string, script: string | null = null) =>
  Effect.gen(function* () {
    mkdirSync(dir, { recursive: true })
    const trackingFd = openSync(join(dir, "tracking.jsonl"), "w")
    const periods: Frame[] = []
    const tickTime = new Map<number, string>()
    const periodStart = new Map<string, number>()
    const events: DomainEvent[] = []
    let frames = 0
    let last: Frame | null = null
    yield* Stream.runForEach(matchSteps(cfg), (r) =>
      Effect.sync(() => {
        events.push(...r.events)
        const f = r.frame
        if (!f) return
        frames++
        tickTime.set(f.tick, f.timestamp)
        if (f.frame_id === 0) {
          periodStart.set(f.period, f.tick)
          periods.push(f)
        }
        if (last && last.period !== f.period) periods.push(last)
        last = f
        writeSync(trackingFd, cdfTrackingLine(cfg.matchId, cfg, f) + "\n")
      })
    )
    closeSync(trackingFd)
    if (last) periods.push(last)
    const lastFrame = last as Frame | null
    const clock = (t: number) => tickTime.get(t) ?? lastFrame!.timestamp
    const recv = new Map(events.filter((e) => e.type === "pass" && e.frame_id_end !== null).map((e) => [e.id, e.frame_id_end!]))
    const cdfLines = events.map((e) => cdfEventLine(cfg, e, clock, (p) => periodStart.get(p) ?? 0, recv.get(e.id) ?? null)).filter((x): x is string => x !== null)
    writeFileSync(join(dir, "event.jsonl"), cdfLines.join("\n") + "\n")
    writeFileSync(join(dir, "domain.jsonl"), events.map((e) => JSON.stringify({ ...e, ...e.attrs, attrs: undefined })).join("\n") + "\n")
    writeFileSync(join(dir, "meta.json"), JSON.stringify(cdfMeta(cfg, periodsFromFrames(periods)), null, 1))
    const goals = events.filter((e) => e.type === "goal")
    const score = `${goals.filter((g) => g.team_id === cfg.home.id).length}-${goals.filter((g) => g.team_id === cfg.away.id).length}`
    const manifest: RunManifest = {
      match_id: cfg.matchId,
      seed: cfg.seed,
      home: cfg.home.id,
      away: cfg.away.id,
      script,
      fps: Math.round(1 / cfg.dt),
      params_version: cfg.params.provenance.version,
      engine: { name: "touchline-sim", version: "0.1.0" },
      outputs: Object.fromEntries(["meta.json", "event.jsonl", "tracking.jsonl", "domain.jsonl"].map((f) => [f, sha256(join(dir, f))])),
      stats: { frames, events: events.length, cdf_events: cdfLines.length, score }
    }
    writeFileSync(join(dir, "manifest.json"), JSON.stringify(manifest, null, 1))
    return manifest
  })
```

`packages/sim/src/cli.ts`

```ts
import { readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { Effect } from "effect"
import type { League } from "@touchline/league"
import { DEFAULT_PARAMS } from "@touchline/sim-core"
import { writeMatch } from "./writer.js"

const root = join(dirname(fileURLToPath(import.meta.url)), "../../..")
const arg = (k: string, d: string): string => {
  const i = process.argv.indexOf(`--${k}`)
  return i > 0 && process.argv[i + 1] ? process.argv[i + 1]! : d
}
const league = JSON.parse(readFileSync(join(root, "data/league/league.json"), "utf8")) as League
const club = (id: string) => {
  const c = league.clubs.find((x) => x.id === id)
  if (!c) {
    console.error(`Unknown club "${id}". Known clubs: ${league.clubs.map((x) => x.id).join(", ")}`)
    process.exit(2)
  }
  return c
}
const seed = Number(arg("seed", "1"))
const fps = Number(arg("fps", "10"))
if (!Number.isInteger(seed) || seed < 0 || seed > 4294967295) {
  console.error("--seed must be an integer between 0 and 4294967295")
  process.exit(2)
}
if (fps !== 10 && fps !== 25) {
  console.error("--fps must be 10 or 25")
  process.exit(2)
}
const cfg = {
  matchId: arg("match-id", `m-${seed}`),
  seed,
  kickoffTime: arg("kickoff", "2026-10-18T14:00:00.000Z"),
  home: club(arg("home", "ironmoor")),
  away: club(arg("away", "kestrel-bay")),
  params: DEFAULT_PARAMS,
  dt: 1 / fps
}
const out = arg("out", join(root, "out", cfg.matchId))
Effect.runPromise(writeMatch(cfg, out)).then((m) => console.log(`${out}: ${JSON.stringify(m.stats)}`))
```

`packages/sim/src/index.ts` — final version

```ts
export * from "./cdf.js"
export * from "./run.js"
export * from "./writer.js"
```

- [ ] **Step 5: Run the tests**

Run: `pnpm --filter @touchline/sim test && pnpm --filter @touchline/sim typecheck`
Expected: 7 passed (5 CDF + 2 stream), no type errors

- [ ] **Step 6: Write the Python validator**

`python/analytics/pyproject.toml`

```toml
[project]
name = "touchline-analytics"
version = "0.1.0"
description = "Offline analytics for Touchline: CDF validation now; calibration fits in Plan 2."
requires-python = ">=3.11"
dependencies = ["common-data-format-validator==0.1.1"]

[build-system]
requires = ["hatchling"]
build-backend = "hatchling.build"

[tool.hatch.build.targets.wheel]
packages = ["touchline_analytics"]
```

`python/analytics/touchline_analytics/__init__.py` — empty file.

`python/analytics/touchline_analytics/validate_cdf.py`

```python
"""Validate a simulator output folder (meta.json, event.jsonl, tracking.jsonl) against CDF in strict "extreme" mode.

Usage: uv run --project python/analytics python -m touchline_analytics.validate_cdf out/m-1
Exits non-zero on the first invalid file.
"""

import sys
from pathlib import Path

import cdf


def count_lines(path: Path) -> int:
    with path.open("rb") as fh:
        return sum(1 for _ in fh)


def main(folder: str) -> int:
    root = Path(folder)
    checks = [
        ("meta", cdf.MetaSchemaValidator(), root / "meta.json", None),
        ("event", cdf.EventSchemaValidator(), root / "event.jsonl", count_lines(root / "event.jsonl")),
        ("tracking", cdf.TrackingSchemaValidator(), root / "tracking.jsonl", count_lines(root / "tracking.jsonl")),
    ]
    for name, validator, path, n in checks:
        try:
            if n is None:
                validator.validate_schema(sample=str(path), mode="extreme")
            else:
                validator.validate_schema(sample=str(path), mode="extreme", limit=n)
        except Exception as exc:  # the validator raises on the first invalid record
            print(f"{name}: INVALID ({path}): {exc}")
            return 1
        print(f"{name}: ok")
    return 0


if __name__ == "__main__":
    if len(sys.argv) != 2:
        print(__doc__)
        sys.exit(2)
    sys.exit(main(sys.argv[1]))
```

- [ ] **Step 7: Run a match through the CLI, twice, and validate it**

```bash
pnpm sim --seed 1 --home ironmoor --away saltmarsh
pnpm sim --seed 1 --home ironmoor --away saltmarsh --out out/m-1-again
diff <(jq .outputs out/m-1/manifest.json) <(jq .outputs out/m-1-again/manifest.json) && echo identical
uv run --project python/analytics python -m touchline_analytics.validate_cdf out/m-1
```

Expected: the CLI prints the stats line (about 56,000 frames); `identical`; then `meta: ok`, `event: ok`, `tracking: ok` (validation takes about 35 s).

- [ ] **Step 8: Check bad input gives clear errors**

```bash
pnpm sim --home nowhere; echo "exit $?"
pnpm sim --seed -3; echo "exit $?"
pnpm sim --fps 30; echo "exit $?"
```

Expected: `Unknown club "nowhere". Known clubs: ironmoor, …` with exit 2; `--seed must be an integer between 0 and 4294967295` with exit 2; `--fps must be 10 or 25` with exit 2. No stack traces.

- [ ] **Step 9: Add CDF validation to CI**

`.github/workflows/ci.yml` — final version

```yaml
name: ci
on:
  push:
  pull_request:
jobs:
  typescript:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: pnpm
      - run: pnpm install --frozen-lockfile
      - run: pnpm league
      - run: git diff --exit-code data/league/league.json
      - run: pnpm typecheck
      - run: pnpm test
  cdf:
    runs-on: ubuntu-latest
    needs: typescript
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: pnpm
      - run: pnpm install --frozen-lockfile
      - run: pnpm sim --seed 1 --home ironmoor --away saltmarsh
      - uses: astral-sh/setup-uv@v6
      - run: uv run --project python/analytics python -m touchline_analytics.validate_cdf out/m-1
```

- [ ] **Step 10: Commit**

```bash
git add packages/sim python/analytics .github/workflows/ci.yml pnpm-lock.yaml
git commit -m "feat(sim): Effect match streams, CDF file writer with manifest, CLI, CI validation

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```



### Task 13: Attribution and README

Credit the projects that shaped the design and document how to run everything, including the known uncalibrated baseline that Plan 2 starts from.

**Files:**
- Create: `ATTRIBUTION.md`, `README.md`

**Interfaces:**
- Consumes: nothing.
- Produces: documentation only.

- [ ] **Step 1: Write the attribution file**

`ATTRIBUTION.md`

```markdown
# Attribution

Touchline's simulator is original code. These projects and papers shaped its design; no code was copied from them.

| Source | Licence | What we took |
|---|---|---|
| [tbleckert/football-simulator](https://github.com/tbleckert/football-simulator) | MIT | Ideas: typed event taxonomy, restart phase machine, intents with durations, injectable RNG |
| [ZOXEXIVO/open-football](https://github.com/ZOXEXIVO/open-football) | Apache-2.0 | Ideas: constant-bearing interception, 3D ball physics, per-match plausibility bands |
| Spearman (2018) pitch control, via [LaurieOnTracking](https://github.com/Friends-of-Tracking-Data-FoTD/LaurieOnTracking) | MIT | 0.7 s reaction time in time-to-intercept |
| Reynolds, *Steering Behaviors for Autonomous Characters* (GDC 1999) | — | Arrive, pursue and separation steering |
| Anzer et al., *Common Data Format (CDF)*, arXiv:2505.15820 | — | Output format (v0.3.2) |
| [unravelsports/common-data-format-validator](https://github.com/unravelsports/common-data-format-validator) | MIT | CDF validation in CI |
| [Effect](https://effect.website) | MIT | Streams, schemas and test clock |

Calibration datasets (added in Plan 2) are credited here when their fitted parameters are committed.
```

- [ ] **Step 2: Write the README**

`README.md`

````markdown
# Touchline

A multi-agent football match-intelligence engine on Azure, built for the Microsoft *Inside the Game* hackathon. All data is synthetic: clubs, players and matches are fictional and generated by our own simulator.

## Quick start

```bash
corepack enable
pnpm install
pnpm league                                   # regenerate data/league/league.json (deterministic)
pnpm test                                     # all TypeScript tests
pnpm sim --seed 1 --home ironmoor --away saltmarsh   # writes out/m-1/{meta.json,event.jsonl,tracking.jsonl,domain.jsonl,manifest.json}
uv run --project python/analytics python -m touchline_analytics.validate_cdf out/m-1
```

Options for `pnpm sim`: `--seed` (0–4294967295), `--home` / `--away` (club ids in `data/league/league.json`), `--fps` (10, or 25 for video render runs), `--match-id`, `--kickoff` (ISO time), `--out`.

## Packages

| Package | What it does |
|---|---|
| `packages/sim-core` | The match engine: one pure, deterministic `step(state)` per 0.1 s tick |
| `packages/league` | Fictional league generator: 8 clubs, kits, styles, 160 players |
| `packages/schema` | Effect Schema for the live domain stream (events and frames) |
| `packages/sim` | Effect streams, CDF v0.3.2 writers, run manifest, CLI |
| `python/analytics` | Offline tooling: CDF validation (calibration fits arrive in Plan 2) |

## Status

The engine runs a full match in about 1.5 s and its output passes the CDF validator in strict mode. Its parameters are hand-set priors, not yet calibrated, so match statistics are off (for example ~1,400 passes and ~6 goals per match). Plan 2 fits them on open data.

See `ATTRIBUTION.md` for credits and `docs/superpowers/` for the spec and plans.
````

- [ ] **Step 3: Run everything once more**

Run: `pnpm typecheck && pnpm test`
Expected: `Tasks: 4 successful` for both; 69 tests in total (sim-core 54, league 6, schema 2, sim 7)

- [ ] **Step 4: Commit**

```bash
git add ATTRIBUTION.md README.md
git commit -m "docs: attribution and README for the simulator

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```



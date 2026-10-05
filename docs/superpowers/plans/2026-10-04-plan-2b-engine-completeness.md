# Touchline Plan 2b — Engine Completeness Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Complete the match engine's football and close the open review findings: substitutions and stamina, first-touch errors, ground duels, keeper claims and punches, wide play that produces corners and throw-ins at real rates, game-state scoring; strict command lines, frame-ordered files, data checksums; then recalibrate and re-prove realism.

**Architecture:** All engine work stays inside the pure `step()` of `packages/sim-core` (new pure helpers in `touch.ts`, `deflect.ts`, `gamestate.ts`; new behaviour behind parameters with provenance). Tasks 1–2 and 8 harden tooling and export; Tasks 3–7 add engine behaviour, each with its own tests and a full-suite run in which the realism gate guards statistics; Task 9 adds three tuning knobs, recalibrates against IDSSE and regenerates the realism report and gate baseline.

**Tech Stack:** as Plans 1 and 2a (TypeScript 5.9.3, Effect 4.0.0, vitest 5.0.3, pnpm 11.27, Turborepo 2.11.6; Python via uv with kloppy 3.19.0, pytest 9.1.1). No new dependencies.

**Spec:** `docs/superpowers/specs/2026-10-03-touchline-design.md` §5.1.3 (state: stamina, subs), §5.1.4 (game state: minute profile, red cards), §5.1.8 (calibration), §5.1.10 (taxonomy: `ground_duel`, `keeper_claim`, `keeper_punch`, `substitution`, `reception.first_touch`), §5.1.11 (CLI), §5.1.12 (mistakes: heavy touch, keeper handling, sliced clearance). Roadmap: `docs/superpowers/plans/2026-10-03-touchline-roadmap.md`. Builds on Plan 2a (merged to `main` at `fbc3b07`). Scenario scripts, the SPADL view, the realism-noise flag and the real-player name blocklist move to **Plan 2c**.

**How code is given:** new files in full; changes to existing files as exact patches, applied from the repository root with the `git apply <<'PATCH' … PATCH` block shown. Every patch was produced from the verified prototype, task by task, so each applies cleanly on top of the previous task.

**Verification status:** every task was built and run in full before this plan was finalised, one commit per task, with the whole suite green at every commit (the realism gate included); the code blocks reproduce the prototype file for file (checked by replaying the plan on a fresh clone). Final calibration: loss 6.36 on the tuning seeds; 16 held-out matches give 13 statistics within 1 SD, 3 within 2 SD and 1 off (shots on target, a recorded known gap).

## Global Constraints

- All Plan 1 and Plan 2a constraints hold: CDF v0.3.2 strict validity, determinism per `(seed, teams, params version, fps)`, no Effect inside `sim-core`, pinned versions, raw real data never in git, no StatsBomb, one metric definition shared by Python and TypeScript.
- **New behaviour is parameterised.** Every rate, share and distance added here lives in `Params` with a comment saying what it does; the calibrated file only overrides what the tuner moves.
- **Files are frame-ordered; the live stream is emission-ordered.** `event.jsonl` and `domain.jsonl` are sorted by frame (stable). The live stream still emits a flight's events when it resolves (outcomes are never revealed before they happen); consumers order by `frame_id`.
- **Substitutions follow the laws of the game:** at most 5 per team, at most 3 windows during play (half time is not a window), never for a sent-off player, never a keeper for an outfield player.
- **The realism gate stays green at every commit.** An intended change that moves statistics refreshes `data/params/realism-baseline.json` in the same commit (Task 6), and Task 9 recalibrates.
- **Priors are labelled.** The goal-minute profile is a hand-set prior until Wyscout data is reachable; the IDSSE checksums are pinned to the Hugging Face ids of 2026-10-04.

## Review Focus

1. **A substituted-off or sent-off player referenced later** (last touch, pressers, an open carry, a restart taker) — a crash with "unknown player" or a ghost in the frames. *Task 4, `subs.test.ts` (frames after each change, six full matches) and the substitution code moving `lastTouch` to the player coming on.*
2. **Deflections producing goals or own goals** — random deflection directions near goal rolled into the net. *Task 6, `wide.test.ts` (own goals stay rare; corners after deflections go to the attacking side).*
3. **A consumer assuming the live stream is in frame order** — flights are emitted when they resolve. *Task 2 sorts the files and tests the order; the constraint above states the live contract for Plans 3–5.*
4. **A command line that accepts nonsense or overwrites committed data** — the old tuner wrote a junk parameter file for `--matches abc`. *Task 1, `cli.test.ts` (exit 2, and the scratch output file never appears).*
5. **A statistic far from reality hidden by a wide real SD** — corners at a quarter of the real rate showed as "within 2 SD". *Task 8 adds the relative-error column and the "more than 30 %" list; Task 9's report shows it.*

---

### Task 1: Strict command lines for the sim, tuner and realism report

One small option parser (Node's `util.parseArgs` in strict mode) for all three CLIs. Unknown options, options without a value, stray arguments and malformed values (a kickoff that is not an ISO time, a seed out of range, `--matches 0`) stop with a one-line message and exit status 2, never a stack trace and never a silent default. `--help` lists the options. The tuner also refuses to score zero matches: before this, `--matches abc` simulated nothing, reported a perfect loss of 0 and wrote a junk parameter file. Plan 1 minors: malformed `--kickoff`, `--seed` without a value, unknown flags. Plan 2a minors: tuner match count, realism `--params` path and error.

**Files:**
- Create: `packages/sim/src/args.ts`
- Modify: `packages/sim/src/cli.ts` (rewritten on the parser), `packages/sim/src/index.ts`, `packages/calibrate/src/cli.ts`, `packages/calibrate/src/realism.ts`, `packages/calibrate/src/evaluate.ts` (`loss`)
- Test: `packages/sim/test/args.test.ts`, `packages/calibrate/test/cli.test.ts`, `packages/calibrate/test/tune.test.ts` (one new case)

**Interfaces:**
- Consumes: Plan 2a's `paramsFromJson`, `ParamsError`, `loss`, `writeMatch`.
- Produces (`@touchline/sim`): `class CliError`, `type Check`, `interface OptionSpec {default, help, check?}`, checks `integer(lo, hi)`, `positiveInteger`, `oneOf(values)`, `isoTime` (normalises to `…:00.000Z`), `usage(spec)`, `parseCli(argv, spec)`, `cliOptions(title, spec, argv?)` (handles `--help`, exits 2 on CliError), `exitOnUserError(f, userErrors?)`.
- Changes: `loss(sim, targets)` throws when no statistic could be measured. CLI options: sim `--seed --home --away --fps --kickoff --match-id --params --out` (`--params default` = hand-set priors); calibrate `--targets --out --matches --rounds --from`; realism `--matches --params`.

- [ ] **Step 1: Write the failing tests**

Create `packages/sim/test/args.test.ts`:

```ts
import { execFileSync, spawnSync } from "node:child_process"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "vitest"
import { CliError, integer, isoTime, oneOf, parseCli, positiveInteger } from "../src/args.js"

const spec = {
  seed: { default: "1", check: integer(0, 4294967295), help: "match seed" },
  kickoff: { default: "2026-10-18T14:00:00.000Z", check: isoTime, help: "kickoff time (UTC, ISO 8601)" },
  fps: { default: "10", check: oneOf(["10", "25"]), help: "frames per second" },
  matches: { default: "8", check: positiveInteger, help: "matches per evaluation" },
  out: { default: "out", help: "output folder" }
}

describe("command-line options", () => {
  it("fills defaults and normalises values", () => {
    expect(parseCli([], spec)).toEqual({ seed: "1", kickoff: "2026-10-18T14:00:00.000Z", fps: "10", matches: "8", out: "out" })
    expect(parseCli(["--seed", "7", "--kickoff", "2026-10-19T15:30:00Z"], spec)).toMatchObject({ seed: "7", kickoff: "2026-10-19T15:30:00.000Z" })
  })
  it("rejects unknown options, naming them", () => {
    expect(() => parseCli(["--speed", "4"], spec)).toThrow(CliError)
    expect(() => parseCli(["--speed", "4"], spec)).toThrow(/--speed/)
  })
  it("rejects an option given without a value", () => {
    expect(() => parseCli(["--seed"], spec)).toThrow(/--seed/)
    expect(() => parseCli(["--seed", "--out", "x"], spec)).toThrow(/--seed/)
  })
  it("rejects malformed values with a message, not a stack trace", () => {
    expect(() => parseCli(["--kickoff", "tomorrow"], spec)).toThrow(/--kickoff must be an ISO 8601 UTC time/)
    expect(() => parseCli(["--kickoff", "2026-13-45T99:00:00Z"], spec)).toThrow(/--kickoff/)
    expect(() => parseCli(["--seed=-1"], spec)).toThrow(/--seed must be an integer between 0 and 4294967295/)
    expect(() => parseCli(["--seed", "-1"], spec)).toThrow(/--seed/)
    expect(() => parseCli(["--seed", "1.5"], spec)).toThrow(/--seed/)
    expect(() => parseCli(["--fps", "30"], spec)).toThrow(/--fps must be one of 10, 25/)
    expect(() => parseCli(["--matches", "0"], spec)).toThrow(/--matches must be a positive integer/)
    expect(() => parseCli(["--matches", "abc"], spec)).toThrow(/--matches/)
  })
  it("rejects stray positional arguments", () => {
    expect(() => parseCli(["ironmoor"], spec)).toThrow(/ironmoor/)
  })
})

describe("sim CLI", () => {
  const pkg = join(dirname(fileURLToPath(import.meta.url)), "..")
  const tsx = join(pkg, "../../node_modules/.bin/tsx")
  it("exits 2 with a one-line message on a bad option", () => {
    const r = spawnSync(tsx, ["src/cli.ts", "--kickoff", "nonsense"], { cwd: pkg, encoding: "utf8" })
    expect(r.status).toBe(2)
    expect(r.stderr.trim()).toMatch(/^--kickoff must be an ISO 8601 UTC time/)
    expect(r.stderr).not.toMatch(/at .*\.ts:\d+/)
  })
  it("prints the options on --help", () => {
    const out = execFileSync(tsx, ["src/cli.ts", "--help"], { cwd: pkg, encoding: "utf8" })
    expect(out).toMatch(/--seed/)
    expect(out).toMatch(/--params/)
  })
})
```

Create `packages/calibrate/test/cli.test.ts` — `--out` points at a scratch file, so even the old CLI cannot overwrite the committed parameters while this test fails:

```ts
import { spawnSync } from "node:child_process"
import { existsSync, mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "vitest"

const pkg = join(dirname(fileURLToPath(import.meta.url)), "..")
const tsx = join(pkg, "../../node_modules/.bin/tsx")
const run = (script: string, args: string[]) => spawnSync(tsx, [script, ...args], { cwd: pkg, encoding: "utf8" })

describe("calibration command lines", () => {
  it("the tuner rejects a match count that is not a positive integer", () => {
    // --out points at a scratch file so a regression can never overwrite the committed parameters.
    const out = join(mkdtempSync(join(tmpdir(), "touchline-cli-")), "params.json")
    for (const m of ["0", "abc"]) {
      const r = run("src/cli.ts", ["--matches", m, "--out", out])
      expect(r.status, m).toBe(2)
      expect(r.stderr.trim()).toBe("--matches must be a positive integer")
      expect(existsSync(out)).toBe(false)
    }
  })
  it("the realism report rejects a params file it cannot use, without a stack trace", () => {
    const r = run("src/realism.ts", ["--params", "no-such-file.json"])
    expect(r.status).toBe(2)
    expect(r.stderr).toMatch(/^Cannot use params file no-such-file\.json/)
    expect(r.stderr).not.toMatch(/at .*\.ts:\d+/)
  })
})
```

Apply this change to `packages/calibrate/test/tune.test.ts` (from the repository root):

```bash
git apply <<'PATCH'
diff --git a/packages/calibrate/test/tune.test.ts b/packages/calibrate/test/tune.test.ts
index 9617a1a..c0d27a0 100644
--- a/packages/calibrate/test/tune.test.ts
+++ b/packages/calibrate/test/tune.test.ts
@@ -30,6 +30,9 @@ describe("loss", () => {
   it("is zero when every statistic hits its target", () => {
     expect(loss(Object.fromEntries(SCALAR_KEYS.map((k) => [k, 10])) as never, targets)).toBe(0)
   })
+  it("refuses to score when no statistic could be measured (e.g. zero matches)", () => {
+    expect(() => loss(Object.fromEntries(SCALAR_KEYS.map((k) => [k, Number.NaN])) as never, targets)).toThrow(/no statistic/)
+  })
   it("floors the scale at 5 % of the mean", () => {
     expect(scaleOf({ mean: 100, sd: 0, n: 1 })).toBe(5)
   })
PATCH
```

- [ ] **Step 2: Run them to make sure they fail**

Run: `pnpm --filter @touchline/sim test args`
Expected: FAIL — `Cannot find module '../src/args.js'`

Run: `pnpm --filter @touchline/calibrate test tune cli`
Expected: 3 failed: `refuses to score when no statistic could be measured`, `the tuner rejects a match count…` (exit status is not 2), `the realism report rejects a params file…`

- [ ] **Step 3: Write the option parser**

Create `packages/sim/src/args.ts`:

```ts
import { parseArgs } from "node:util"

/** A bad command line: the CLI prints the message (no stack trace) and exits with status 2. */
export class CliError extends Error {}

/** Returns an error message for a bad value, or the normalised value. */
export type Check = (name: string, value: string) => { readonly error: string } | { readonly value: string }

export interface OptionSpec {
  readonly default: string
  readonly help: string
  readonly check?: Check
}

export const integer =
  (lo: number, hi: number): Check =>
  (name, v) =>
    /^-?\d+$/.test(v) && Number(v) >= lo && Number(v) <= hi ? { value: v } : { error: `--${name} must be an integer between ${lo} and ${hi}` }

export const positiveInteger: Check = (name, v) => (/^\d+$/.test(v) && Number(v) > 0 ? { value: v } : { error: `--${name} must be a positive integer` })

export const oneOf =
  (allowed: ReadonlyArray<string>): Check =>
  (name, v) =>
    allowed.includes(v) ? { value: v } : { error: `--${name} must be one of ${allowed.join(", ")}` }

/** ISO 8601 UTC date-time ("2026-10-18T14:00:00Z"); normalised to milliseconds ("…:00.000Z"). */
export const isoTime: Check = (name, v) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(\.\d{1,3})?Z$/.exec(v)
  const t = m ? Date.parse(v) : NaN
  // Date.parse rolls invalid fields over (Feb 30 -> Mar 2); the round trip catches that.
  if (!m || !Number.isFinite(t) || new Date(t).toISOString().slice(0, 19) !== v.slice(0, 19))
    return { error: `--${name} must be an ISO 8601 UTC time such as 2026-10-18T14:00:00Z (got "${v}")` }
  return { value: new Date(t).toISOString() }
}

export const usage = (spec: Readonly<Record<string, OptionSpec>>): string =>
  Object.entries(spec)
    .map(([k, o]) => `  --${k.padEnd(10)} ${o.help} (default: ${o.default === "" ? "none" : o.default})`)
    .join("\n")

/** Strict parsing: unknown options, missing values, stray arguments and bad values all throw CliError. */
export const parseCli = <S extends Readonly<Record<string, OptionSpec>>>(argv: ReadonlyArray<string>, spec: S): { [K in keyof S]: string } => {
  let parsed: ReturnType<typeof parseArgs>
  try {
    parsed = parseArgs({
      args: [...argv],
      options: Object.fromEntries(Object.keys(spec).map((k) => [k, { type: "string" as const }])),
      strict: true,
      allowPositionals: false
    })
  } catch (e) {
    throw new CliError(e instanceof Error ? e.message : String(e))
  }
  const out: Record<string, string> = {}
  for (const [k, o] of Object.entries(spec)) {
    const raw = parsed.values[k]
    const v = typeof raw === "string" ? raw : o.default
    if (typeof raw === "string" && raw.startsWith("--")) throw new CliError(`--${k} needs a value`)
    const r = o.check && v !== "" ? o.check(k, v) : { value: v }
    if ("error" in r) throw new CliError(r.error)
    out[k] = r.value
  }
  return out as { [K in keyof S]: string }
}

/**
 * Parse argv for a CLI: prints usage on --help, and turns CliError (and any error class in `userErrors`)
 * into a one-line message with exit status 2.
 */
export const cliOptions = <S extends Readonly<Record<string, OptionSpec>>>(title: string, spec: S, argv: ReadonlyArray<string> = process.argv.slice(2)): { [K in keyof S]: string } => {
  if (argv.includes("--help")) {
    console.log(`${title}\n\nOptions:\n${usage(spec)}`)
    process.exit(0)
  }
  return exitOnUserError(() => parseCli(argv, spec))
}

/** Run `f`; a CliError (or an error of one of `userErrors`) prints its message and exits 2. */
export const exitOnUserError = <A>(f: () => A, userErrors: ReadonlyArray<new (...a: never[]) => Error> = []): A => {
  try {
    return f()
  } catch (e) {
    if (e instanceof CliError || userErrors.some((c) => e instanceof c)) {
      console.error((e as Error).message)
      process.exit(2)
    }
    throw e
  }
}
```

Apply this change to `packages/sim/src/index.ts` (from the repository root):

```bash
git apply <<'PATCH'
diff --git a/packages/sim/src/index.ts b/packages/sim/src/index.ts
index 64872f0..3b42fd0 100644
--- a/packages/sim/src/index.ts
+++ b/packages/sim/src/index.ts
@@ -1,3 +1,4 @@
 export * from "./cdf.js"
 export * from "./run.js"
 export * from "./writer.js"
+export * from "./args.js"
PATCH
```

- [ ] **Step 4: Rebuild the sim CLI on it**

Replace `packages/sim/src/cli.ts` — full new contents (replaces the hand-rolled `arg()` helper):

```ts
import { existsSync, readFileSync } from "node:fs"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { Effect } from "effect"
import type { League } from "@touchline/league"
import { DEFAULT_PARAMS, ParamsError, paramsFromJson, type Params } from "@touchline/sim-core"
import { CliError, cliOptions, exitOnUserError, integer, isoTime, oneOf } from "./args.js"
import { writeMatch } from "./writer.js"

const root = join(dirname(fileURLToPath(import.meta.url)), "../../..")
// pnpm runs package scripts from the package folder; INIT_CWD is where the user typed the command.
const here = (p: string) => resolve(process.env.INIT_CWD ?? process.cwd(), p)
const league = JSON.parse(readFileSync(join(root, "data/league/league.json"), "utf8")) as League
const clubIds = league.clubs.map((c) => c.id)
const defaultParams = join(root, "data/params/touchline-params.json")

const o = cliOptions("touchline-sim: simulate one match and write CDF, domain events and a run manifest", {
  seed: { default: "1", check: integer(0, 4294967295), help: "match seed" },
  home: { default: "ironmoor", check: oneOf(clubIds), help: "home club id" },
  away: { default: "kestrel-bay", check: oneOf(clubIds), help: "away club id" },
  fps: { default: "10", check: oneOf(["10", "25"]), help: "tracking frames per second" },
  kickoff: { default: "2026-10-18T14:00:00.000Z", check: isoTime, help: "kickoff time, ISO 8601 UTC" },
  "match-id": { default: "", help: "match id (default m-<seed>)" },
  // Calibrated parameters (Plan 2a) load by default; "default" uses the hand-set priors.
  params: { default: existsSync(defaultParams) ? defaultParams : "default", help: "parameter file, or \"default\" for hand-set priors" },
  out: { default: "", help: "output folder (default out/<match-id>)" }
})

const params: Params = exitOnUserError(() => {
  if (o.params === "default") return DEFAULT_PARAMS
  try {
    return paramsFromJson(JSON.parse(readFileSync(here(o.params), "utf8")))
  } catch (e) {
    throw new CliError(`Cannot use params file ${o.params}: ${e instanceof ParamsError ? e.message : String(e)}`)
  }
})
exitOnUserError(() => {
  if (o.home === o.away) throw new CliError("--home and --away must be different clubs")
})
const seed = Number(o.seed)
const matchId = o["match-id"] || `m-${seed}`
const club = (id: string) => league.clubs.find((c) => c.id === id)!
const cfg = { matchId, seed, kickoffTime: o.kickoff, home: club(o.home), away: club(o.away), params, dt: 1 / Number(o.fps) }
const out = here(o.out || join(root, "out", matchId))
Effect.runPromise(writeMatch(cfg, out)).then((m) => console.log(`${out}: ${JSON.stringify(m.stats)}`))
```

- [ ] **Step 5: Guard the loss and move the tuner and realism CLIs onto the parser**

Apply this change to `packages/calibrate/src/evaluate.ts` (from the repository root):

```bash
git apply <<'PATCH'
diff --git a/packages/calibrate/src/evaluate.ts b/packages/calibrate/src/evaluate.ts
index c782190..68ecdb5 100644
--- a/packages/calibrate/src/evaluate.ts
+++ b/packages/calibrate/src/evaluate.ts
@@ -65,10 +65,17 @@ export const WEIGHTS: Readonly<Record<ScalarKey, number>> = {
 /** Scale for a z-score: the real between-match SD, but never below 5 % of the mean (tracking targets come from one match). */
 export const scaleOf = (t: Target): number => Math.max(t.sd, 0.05 * Math.abs(t.mean), 1e-6)
 
-export const loss = (sim: Readonly<Record<ScalarKey, number>>, targets: Targets): number =>
-  SCALAR_KEYS.reduce((acc, k) => {
+/** Weighted sum of squared z-scores over the statistics that have a target and a finite simulated value. */
+export const loss = (sim: Readonly<Record<ScalarKey, number>>, targets: Targets): number => {
+  let acc = 0
+  let used = 0
+  for (const k of SCALAR_KEYS) {
     const t = targets.metrics[k]
-    if (!t || !Number.isFinite(sim[k])) return acc
+    if (!t || !Number.isFinite(sim[k])) continue
     const z = (sim[k] - t.mean) / scaleOf(t)
-    return acc + WEIGHTS[k] * z * z
-  }, 0)
+    acc += WEIGHTS[k] * z * z
+    used++
+  }
+  if (used === 0) throw new Error("loss: no statistic could be measured (no matches simulated, or no targets)")
+  return acc
+}
PATCH
```

Apply this change to `packages/calibrate/src/cli.ts`, `packages/calibrate/src/realism.ts` (from the repository root):

```bash
git apply <<'PATCH'
diff --git a/packages/calibrate/src/cli.ts b/packages/calibrate/src/cli.ts
index 252dd55..4869c10 100644
--- a/packages/calibrate/src/cli.ts
+++ b/packages/calibrate/src/cli.ts
@@ -2,6 +2,7 @@ import { readFileSync, writeFileSync } from "node:fs"
 import { dirname, join, resolve } from "node:path"
 import { fileURLToPath } from "node:url"
 import type { League } from "@touchline/league"
+import { cliOptions, positiveInteger } from "@touchline/sim"
 import { DEFAULT_PARAMS } from "@touchline/sim-core"
 import type { Targets } from "./evaluate.js"
 import { applyKnobs, KNOBS } from "./knobs.js"
@@ -9,18 +10,20 @@ import { SCALAR_KEYS } from "./metrics.js"
 import { tune } from "./tune.js"
 
 const root = join(dirname(fileURLToPath(import.meta.url)), "../../..")
-const arg = (k: string, d: string): string => {
-  const i = process.argv.indexOf(`--${k}`)
-  return i > 0 && process.argv[i + 1] ? process.argv[i + 1]! : d
-}
 const here = (p: string) => resolve(process.env.INIT_CWD ?? process.cwd(), p)
-const targetsPath = here(arg("targets", join(root, "data/params/targets-idsse.json")))
-const outPath = here(arg("out", join(root, "data/params/touchline-params.json")))
-const matches = Number(arg("matches", "8"))
-const rounds = Number(arg("rounds", "3"))
-// --from <params.json>: continue from that file's calibration knobs instead of the defaults.
-const fromPath = arg("from", "")
-const start = fromPath ? (JSON.parse(readFileSync(here(fromPath), "utf8")) as { calibration?: { knobs?: Record<string, number> } }).calibration?.knobs ?? {} : {}
+const o = cliOptions("calibrate: tune engine knobs to real-match targets (method of simulated moments)", {
+  targets: { default: join(root, "data/params/targets-idsse.json"), help: "real-match targets file" },
+  out: { default: join(root, "data/params/touchline-params.json"), help: "where to write the tuned parameters" },
+  matches: { default: "8", check: positiveInteger, help: "simulated matches per evaluation" },
+  rounds: { default: "3", check: positiveInteger, help: "coordinate-search rounds" },
+  // --from <file>: continue from that file's calibration knobs instead of the defaults.
+  from: { default: "", help: "start from the calibration.knobs of this file" }
+})
+const targetsPath = here(o.targets)
+const outPath = here(o.out)
+const matches = Number(o.matches)
+const rounds = Number(o.rounds)
+const start = o.from ? (JSON.parse(readFileSync(here(o.from), "utf8")) as { calibration?: { knobs?: Record<string, number> } }).calibration?.knobs ?? {} : {}
 
 const league = JSON.parse(readFileSync(join(root, "data/league/league.json"), "utf8")) as League
 const targets = JSON.parse(readFileSync(targetsPath, "utf8")) as Targets
diff --git a/packages/calibrate/src/realism.ts b/packages/calibrate/src/realism.ts
index 3d94655..a46f662 100644
--- a/packages/calibrate/src/realism.ts
+++ b/packages/calibrate/src/realism.ts
@@ -1,21 +1,28 @@
 import { execFileSync } from "node:child_process"
 import { readFileSync, rmSync } from "node:fs"
-import { dirname, join } from "node:path"
+import { dirname, join, resolve } from "node:path"
 import { fileURLToPath } from "node:url"
 import { Effect } from "effect"
 import type { League } from "@touchline/league"
-import { writeMatch } from "@touchline/sim"
-import { DEFAULT_PARAMS, paramsFromJson } from "@touchline/sim-core"
+import { CliError, cliOptions, exitOnUserError, positiveInteger, writeMatch } from "@touchline/sim"
+import { DEFAULT_PARAMS, ParamsError, paramsFromJson, type Params } from "@touchline/sim-core"
 import { FIXTURES } from "./evaluate.js"
 
 const root = join(dirname(fileURLToPath(import.meta.url)), "../../..")
-const arg = (k: string, d: string): string => {
-  const i = process.argv.indexOf(`--${k}`)
-  return i > 0 && process.argv[i + 1] ? process.argv[i + 1]! : d
-}
-const matches = Number(arg("matches", "10"))
-const paramsFile = arg("params", join(root, "data/params/touchline-params.json"))
-const params = paramsFile === "default" ? DEFAULT_PARAMS : paramsFromJson(JSON.parse(readFileSync(paramsFile, "utf8")))
+const here = (p: string) => resolve(process.env.INIT_CWD ?? process.cwd(), p)
+const o = cliOptions("realism: simulate held-out matches and write docs/realism/realism-report.md", {
+  matches: { default: "10", check: positiveInteger, help: "held-out matches to simulate (seeds 2000+)" },
+  params: { default: join(root, "data/params/touchline-params.json"), help: "parameter file, or \"default\" for hand-set priors" }
+})
+const matches = Number(o.matches)
+const params: Params = exitOnUserError(() => {
+  if (o.params === "default") return DEFAULT_PARAMS
+  try {
+    return paramsFromJson(JSON.parse(readFileSync(here(o.params), "utf8")))
+  } catch (e) {
+    throw new CliError(`Cannot use params file ${o.params}: ${e instanceof ParamsError ? e.message : String(e)}`)
+  }
+})
 const league = JSON.parse(readFileSync(join(root, "data/league/league.json"), "utf8")) as League
 const outRoot = join(root, "out/realism")
 rmSync(outRoot, { recursive: true, force: true })
PATCH
```

- [ ] **Step 6: Run the tests and typecheck**

Run: `pnpm --filter @touchline/sim test args && pnpm --filter @touchline/calibrate test tune cli && pnpm --filter @touchline/sim --filter @touchline/calibrate typecheck`
Expected: 7 passed; 10 passed (tune 8, cli 2); no type errors

- [ ] **Step 7: Check by hand**

```bash
pnpm sim --seed            # Option '--seed <value>' argument missing   (exit 2)
pnpm sim --away nowhere   # --away must be one of ironmoor, kestrel-bay, …   (exit 2)
pnpm sim --help           # the option list
pnpm sim --seed 1 --home ironmoor --away saltmarsh   # unchanged: score 2-0
```

- [ ] **Step 8: Commit**

```bash
git add packages/sim packages/calibrate
git commit -m "feat(cli): strict option parsing for sim, calibrate and realism; tuner refuses empty evaluations

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```



### Task 2: Match files in frame order, details under attrs, CDF checked at 25 fps

Flights are emitted when they resolve and carries when they end, so the event list is not in frame order and `event.jsonl` was not chronological. The writer now sorts both files by frame (stably, so same-frame events keep their order); the live stream keeps emission order, and every event carries its frame. `domain.jsonl` used to spread `attrs` over the top level, so a detail called `outcome` overwrote the event's outcome; events are now written exactly as the domain schema defines them, and take-ons and tackles carry their result as the event outcome too. The Python statistics read details from `attrs` (the parity test catches it if they don't). CI validates a 25 fps run as well. Plan 1 minors: event order, flattened attrs, 10 fps-only validation.

**Files:**
- Modify: `packages/sim/src/writer.ts`, `packages/sim-core/src/step.ts` (`Work.emit`), `python/analytics/touchline_analytics/metrics.py` (`touchline_events`), `.github/workflows/ci.yml`
- Test: `packages/sim/test/writer.test.ts`, `python/analytics/tests/test_metrics.py` (one new case)

**Interfaces:**
- Consumes: `writeMatch`, `Work.emit`, Python `touchline_events`.
- Produces: `event.jsonl` and `domain.jsonl` in frame order; `domain.jsonl` lines have exactly the `DomainEvent` keys (details under `attrs`); `take_on` and `tackle` events have `outcome` = `attrs.outcome`.

- [ ] **Step 1: Write the failing tests**

Create `packages/sim/test/writer.test.ts`:

```ts
import { mkdtempSync, readFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { Effect } from "effect"
import { describe, expect, it } from "vitest"
import { makeConfig } from "@touchline/sim-core/testing"
import { writeMatch } from "../src/writer.js"

const dir = mkdtempSync(join(tmpdir(), "touchline-writer-"))
await Effect.runPromise(writeMatch(makeConfig(5), dir))
const lines = (f: string) => readFileSync(join(dir, f), "utf8").trim().split("\n").map((l) => JSON.parse(l) as Record<string, unknown>)
const cdf = lines("event.jsonl") as Array<{ event: { time: string; period: string }; tracking: { frame_id: number } }>
const domain = lines("domain.jsonl")

const DOMAIN_KEYS = ["attrs", "confidence", "frame_id", "frame_id_end", "id", "match_clock", "match_id", "outcome", "period", "period_frame_id", "player_id", "source", "team_id", "type", "x", "x_end", "y", "y_end"]

describe("match files", () => {
  it("CDF events are in time order", () => {
    for (let i = 1; i < cdf.length; i++) {
      const a = cdf[i - 1]!, b = cdf[i]!
      expect(Date.parse(b.event.time), `event ${i}`).toBeGreaterThanOrEqual(Date.parse(a.event.time))
      if (a.event.period === b.event.period) expect(b.tracking.frame_id, `event ${i}`).toBeGreaterThanOrEqual(a.tracking.frame_id)
    }
  })
  it("domain events are in frame order and keep their details under attrs", () => {
    for (let i = 1; i < domain.length; i++) expect(domain[i]!.frame_id as number, `line ${i}`).toBeGreaterThanOrEqual(domain[i - 1]!.frame_id as number)
    for (const e of domain) expect(Object.keys(e).sort()).toEqual(DOMAIN_KEYS)
  })
  it("take-ons and tackles carry their result as the event outcome", () => {
    const duels = domain.filter((e) => e.type === "take_on" || e.type === "tackle")
    expect(duels.length).toBeGreaterThan(10)
    for (const e of duels) expect(e.outcome).toBe((e.attrs as Record<string, unknown>).outcome)
  })
})
```

Apply this change to `python/analytics/tests/test_metrics.py` (from the repository root):

```bash
git apply <<'PATCH'
diff --git a/python/analytics/tests/test_metrics.py b/python/analytics/tests/test_metrics.py
index 47bbe13..2e2b367 100644
--- a/python/analytics/tests/test_metrics.py
+++ b/python/analytics/tests/test_metrics.py
@@ -40,3 +40,20 @@ def test_tracking_metrics_distance_speed_and_in_play():
     assert math.isclose(m["in_play_share"], 0.5)
     assert abs(m["distance_km_median"] - 0.2995) < 0.002  # ~5 m/s * 59.9 s
     assert abs(m["peak_speed_kmh_median"] - 18.0) < 0.1
+
+
+def test_touchline_events_reads_details_from_attrs(tmp_path):
+    import json
+
+    from touchline_analytics.metrics import touchline_events
+
+    base = {"x": 0.0, "y": 0.0, "x_end": 20.0, "y_end": 0.0}
+    lines = [
+        {"type": "pass", "outcome": "successful", "attrs": {"restart": "corner"}, **base},
+        {"type": "shot", "outcome": "saved", "attrs": {"technique": "penalty"}, **base},
+    ]
+    f = tmp_path / "domain.jsonl"
+    f.write_text("\n".join(json.dumps(x) for x in lines) + "\n")
+    ev = touchline_events(f)
+    assert ev[0]["set_piece"] == "corner" and ev[0]["length"] == 20.0
+    assert ev[1]["set_piece"] == "penalty" and ev[1]["on_target"]
PATCH
```

- [ ] **Step 2: Run them to make sure they fail**

Run: `pnpm --filter @touchline/sim test writer`
Expected: 3 failed, e.g. `event 36: expected 1792332087100 to be greater than or equal to 1792332087800`

Run: `uv run --project python/analytics --group dev pytest python/analytics/tests -q`
Expected: 1 failed: `test_touchline_events_reads_details_from_attrs`

- [ ] **Step 3: Implement**

Apply this change to `packages/sim-core/src/step.ts`, `packages/sim/src/writer.ts` (from the repository root):

```bash
git apply <<'PATCH'
diff --git a/packages/sim-core/src/step.ts b/packages/sim-core/src/step.ts
index a89b65c..bf74a77 100644
--- a/packages/sim-core/src/step.ts
+++ b/packages/sim-core/src/step.ts
@@ -45,6 +45,7 @@ import {
 } from "./types.js"
 
 const HALF_TIME_MS = 15 * 60 * 1000
+const OUTCOME_IN_ATTRS: ReadonlySet<string> = new Set(["take_on", "tackle"])
 
 const teamOf = (cfg: MatchConfig, side: Side): TeamSetup => (side === "home" ? cfg.home : cfg.away)
 
@@ -179,8 +180,10 @@ class Work {
   }
   emit(pe: PendingEvent, extra: { frame_id_end?: number | null; outcome?: string | null } = {}): void {
     this.seq += 1
+    // Duels state their result in attrs.outcome; it is also the event's outcome.
+    const outcome = extra.outcome !== undefined ? extra.outcome : OUTCOME_IN_ATTRS.has(pe.type) && typeof pe.attrs.outcome === "string" ? pe.attrs.outcome : null
     this.events.push(
-      buildEvent({ matchId: this.cfg.matchId, period: this.period, periodStartTick: this.periodStartTick, dt: this.dt }, this.seq, pe, extra)
+      buildEvent({ matchId: this.cfg.matchId, period: this.period, periodStartTick: this.periodStartTick, dt: this.dt }, this.seq, pe, { ...extra, outcome })
     )
   }
   pending(type: PendingEvent["type"], pl: PlayerState | null, at: Vec2 | null, attrs: Record<string, AttrValue> = {}, end: Vec2 | null = null, side?: Side): PendingEvent {
diff --git a/packages/sim/src/writer.ts b/packages/sim/src/writer.ts
index 42446a3..22c3174 100644
--- a/packages/sim/src/writer.ts
+++ b/packages/sim/src/writer.ts
@@ -55,10 +55,13 @@ export const writeMatch = (cfg: MatchConfig, dir: string, script: string | null
     if (last) periods.push(last)
     const lastFrame = last as Frame | null
     const clock = (t: number) => tickTime.get(t) ?? lastFrame!.timestamp
+    // Flights are emitted when they resolve and carries when they end; files list events in frame order
+    // (stable, so events of the same frame keep their emission order).
+    const ordered = [...events].sort((a, b) => a.frame_id - b.frame_id)
     const recv = new Map(events.filter((e) => e.type === "pass" && e.frame_id_end !== null).map((e) => [e.id, e.frame_id_end!]))
-    const cdfLines = events.map((e) => cdfEventLine(cfg, e, clock, (p) => periodStart.get(p) ?? 0, recv.get(e.id) ?? null)).filter((x): x is string => x !== null)
+    const cdfLines = ordered.map((e) => cdfEventLine(cfg, e, clock, (p) => periodStart.get(p) ?? 0, recv.get(e.id) ?? null)).filter((x): x is string => x !== null)
     writeFileSync(join(dir, "event.jsonl"), cdfLines.join("\n") + "\n")
-    writeFileSync(join(dir, "domain.jsonl"), events.map((e) => JSON.stringify({ ...e, ...e.attrs, attrs: undefined })).join("\n") + "\n")
+    writeFileSync(join(dir, "domain.jsonl"), ordered.map((e) => JSON.stringify(e)).join("\n") + "\n")
     writeFileSync(join(dir, "meta.json"), JSON.stringify(cdfMeta(cfg, periodsFromFrames(periods)), null, 1))
     const goals = events.filter((e) => e.type === "goal")
     const score = `${goals.filter((g) => g.team_id === cfg.home.id).length}-${goals.filter((g) => g.team_id === cfg.away.id).length}`
PATCH
```

Apply this change to `python/analytics/touchline_analytics/metrics.py` (from the repository root):

```bash
git apply <<'PATCH'
diff --git a/python/analytics/touchline_analytics/metrics.py b/python/analytics/touchline_analytics/metrics.py
index 282e731..eae3758 100644
--- a/python/analytics/touchline_analytics/metrics.py
+++ b/python/analytics/touchline_analytics/metrics.py
@@ -135,12 +135,13 @@ def touchline_events(domain_jsonl: Path) -> list[dict]:
         for line in fh:
             e = json.loads(line)
             t = e["type"]
+            a = e["attrs"]
             if t == "pass":
                 ok = e["outcome"] == "successful"
                 length = math.hypot(e["x_end"] - e["x"], e["y_end"] - e["y"]) if ok and e["x_end"] is not None else None
-                out.append({"type": "pass", "set_piece": _SET_PIECE.get(e.get("restart") or "", None), "complete": ok, "length": length, "goal": False, "on_target": False})
+                out.append({"type": "pass", "set_piece": _SET_PIECE.get(a.get("restart") or "", None), "complete": ok, "length": length, "goal": False, "on_target": False})
             elif t == "shot":
-                sp = "penalty" if e.get("technique") == "penalty" else None
+                sp = "penalty" if a.get("technique") == "penalty" else None
                 out.append({"type": "shot", "set_piece": sp, "complete": False, "length": None, "goal": e["outcome"] == "goal", "on_target": e["outcome"] in ("goal", "saved")})
             elif t in ("foul", "card"):
                 out.append({"type": t, "set_piece": None, "complete": False, "length": None, "goal": False, "on_target": False})
PATCH
```

- [ ] **Step 4: Run the tests, including the TypeScript–Python parity test**

Run: `pnpm --filter @touchline/sim test writer && uv run --project python/analytics --group dev pytest python/analytics/tests -q && pnpm --filter @touchline/calibrate test parity`
Expected: 3 passed; 5 passed; 1 passed (parity fails with `corners: expected 4 to be close to 0` if only the TypeScript side is changed)

- [ ] **Step 5: Validate CDF at 25 fps too**

Apply this change to `.github/workflows/ci.yml` (from the repository root):

```bash
git apply <<'PATCH'
diff --git a/.github/workflows/ci.yml b/.github/workflows/ci.yml
index dcb2dd1..74cde2f 100644
--- a/.github/workflows/ci.yml
+++ b/.github/workflows/ci.yml
@@ -38,3 +38,5 @@ jobs:
       - run: pnpm sim --seed 1 --home ironmoor --away saltmarsh
       - uses: astral-sh/setup-uv@v6
       - run: uv run --project python/analytics python -m touchline_analytics.validate_cdf out/m-1
+      - run: pnpm sim --seed 2 --home eastvale --away larkspur --fps 25 --match-id m-2-25fps
+      - run: uv run --project python/analytics python -m touchline_analytics.validate_cdf out/m-2-25fps
PATCH
```

Run: `pnpm sim --seed 2 --home eastvale --away larkspur --fps 25 --match-id m-2-25fps && uv run --project python/analytics python -m touchline_analytics.validate_cdf out/m-2-25fps`
Expected: `meta: ok`, `event: ok`, `tracking: ok`

- [ ] **Step 6: Run everything**

Run: `pnpm turbo run typecheck test --force`
Expected: `Tasks: 10 successful`; `pnpm sim --seed 1 --home ironmoor --away saltmarsh` still scores 2-0 (no random draws changed)

- [ ] **Step 7: Commit**

```bash
git add packages/sim packages/sim-core/src/step.ts python/analytics .github/workflows/ci.yml
git commit -m "fix(export): frame-ordered event files, nested attrs, duel outcomes; CI validates 25 fps

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```



### Task 3: Half-time edges, keeper distributions, decision-record gaps, preferred foot

The rest of Plan 1's engine minors. A ball in the air when the half is due now lands before the whistle (it used to vanish with its pass event); a carry under way at the whistle is closed and emitted; a keeper's distribution is always followed by the keeper's pass (a clearance is not a distribution); the chosen pass is always among the recorded options (appended when it ranks below the top five) and a forced fallback pass is marked `fallback: true`; the carry after a won take-on carries the take-on's decision record; passes and shots use the player's preferred foot (the other foot on weak-foot kicks, `hands` on throw-ins), and weak-foot shots are less accurate. The tautological score test from Plan 1 goes (a per-team goal test covers it).

**Files:**
- Modify: `packages/sim-core/src/types.ts`, `packages/sim-core/src/testing.ts`, `packages/sim-core/src/shot.ts`, `packages/sim-core/src/decide.ts`, `packages/sim-core/src/step.ts`
- Test: `packages/sim-core/test/record.test.ts` (new), `packages/sim-core/test/edge.test.ts` (one test removed)

**Interfaces:**
- Consumes: Task 2's engine.
- Produces: `type Foot = "left" | "right"`; `PlayerSetup.preferredFoot?: Foot`; `PlayerState.foot: Foot`; `Decision.fallback: boolean` (and attr `fallback` on records); `planShot(…, rng, weakFoot = false)`; the half ends only when no ball is in flight (the one-minute hard stop still applies).

- [ ] **Step 1: Write the failing tests**

Create `packages/sim-core/test/record.test.ts`:

```ts
import { describe, expect, it } from "vitest"
import { initMatch, isFinished, KIND_TO_ACTION, step, type DomainEvent, type MatchConfig, type MatchState, type OptionRecord } from "../src/index.js"
import { makeConfig } from "../src/testing.js"

const play = (cfg: MatchConfig) => {
  let s = initMatch(cfg)
  const events: DomainEvent[] = []
  let secondHalfStart: MatchState | null = null
  while (!isFinished(s)) {
    const r = step(s)
    s = r.state
    events.push(...r.events)
    if (!secondHalfStart && s.period === "second_half") secondHalfStart = s
  }
  return { s, events, secondHalfStart: secondHalfStart! }
}
const matches = [1, 2, 3].map((seed) => play(makeConfig(seed)))
const all = matches.flatMap((m) => m.events)

describe("period boundaries", () => {
  it("a ball in the air when the half is due to end is resolved before the whistle", () => {
    let s = initMatch(makeConfig(4))
    while (!(s.possession.kind === "in_flight" && s.possession.flight.resolveTick > s.tick + 5)) s = step(s).state
    const flight = s.possession.kind === "in_flight" ? s.possession.flight : null
    // Make the half due now, with the ball still travelling.
    s = { ...s, periodTicks: s.periodTick + 1 }
    const events: DomainEvent[] = []
    while (!events.some((e) => e.type === "period_end")) {
      const r = step(s)
      s = r.state
      events.push(...r.events)
    }
    const main = events.find((e) => e.frame_id === flight!.releaseTick && (e.type === "pass" || e.type === "shot" || e.type === "clearance"))
    expect(main, "the flight's event").toBeDefined()
    expect(events.indexOf(main!)).toBeLessThan(events.findIndex((e) => e.type === "period_end"))
  })
  it("a carry under way when the half ends is closed at the whistle, not left open", () => {
    let s = initMatch(makeConfig(4))
    while (!(s.carry !== null && s.tick - s.carry.tick > 10)) s = step(s).state
    const carrier = s.carry!.playerId
    s = { ...s, periodTicks: s.periodTick + 1 }
    const events: DomainEvent[] = []
    while (s.period === "first_half") {
      const r = step(s)
      s = r.state
      events.push(...r.events)
    }
    expect(s.carry).toBeNull()
    const carry = events.find((e) => e.type === "carry" && e.player_id === carrier)
    expect(carry, "the carry event").toBeDefined()
    expect(carry!.period).toBe("first_half")
    for (const m of matches) expect(m.secondHalfStart.carry).toBeNull()
  })
})

describe("on-ball records", () => {
  it("every keeper distribution is followed by a pass from the keeper in the same frame", () => {
    for (const m of matches) {
      m.events.forEach((e, i) => {
        if (e.type !== "keeper_distribution") return
        const next = m.events.slice(i + 1).find((x) => x.player_id === e.player_id && (x.type === "pass" || x.type === "clearance" || x.type === "shot"))
        expect(next?.type, `distribution ${e.id}`).toBe("pass")
        expect(next!.frame_id).toBe(e.frame_id)
      })
    }
  })
  it("the chosen pass is always among the recorded options, and its action has a probability or is marked as a fallback", () => {
    const passes = all.filter((e) => e.type === "pass" && e.attrs.chosen_rank !== null && e.attrs.chosen_rank !== undefined)
    expect(passes.length).toBeGreaterThan(500)
    for (const e of passes) {
      const opts = e.attrs.options as ReadonlyArray<OptionRecord>
      expect(opts.some((o) => o.receiver_id === e.attrs.intended_receiver_id && o.value === e.attrs.chosen_value), e.id).toBe(true)
      const action = e.attrs.kind === "set_piece" ? null : KIND_TO_ACTION[e.attrs.kind as keyof typeof KIND_TO_ACTION]
      const probs = e.attrs.action_probs as Record<string, number>
      if (action) expect(action in probs || e.attrs.fallback === true, e.id).toBe(true)
    }
  })
  it("every carry carries a decision record, including carries after a won take-on", () => {
    const carries = all.filter((e) => e.type === "carry")
    expect(carries.length).toBeGreaterThan(50)
    for (const e of carries) expect(typeof e.attrs.action_probs, e.id).toBe("object")
  })
  it("passes and shots use the player's preferred foot, and the other foot for weak-foot kicks", () => {
    const cfg = makeConfig(5)
    const lefty = { ...cfg, home: { ...cfg.home, starters: cfg.home.starters.map((p) => ({ ...p, preferredFoot: "left" as const })) } }
    const m = play(lefty)
    const kicks = m.events.filter((e) => (e.type === "pass" || e.type === "shot") && e.team_id === cfg.home.id && e.attrs.technique !== "throw")
    const left = kicks.filter((e) => e.attrs.body_part === "left_foot").length
    expect(left / kicks.length).toBeGreaterThan(0.7)
    expect(left / kicks.length).toBeLessThan(0.95)
  })
})
```

Apply this change to `packages/sim-core/test/edge.test.ts` — removes the tautological score test (from the repository root):

```bash
git apply <<'PATCH'
diff --git a/packages/sim-core/test/edge.test.ts b/packages/sim-core/test/edge.test.ts
index bf9419f..4a2cfba 100644
--- a/packages/sim-core/test/edge.test.ts
+++ b/packages/sim-core/test/edge.test.ts
@@ -63,11 +63,4 @@ describe("edge cases", () => {
     const cfg = makeConfig(1)
     expect(() => initMatch({ ...cfg, away: { ...cfg.home } })).toThrow(/duplicate player id/)
   })
-  it("every goal event is matched by the final score", () => {
-    for (const seed of [11, 12, 13]) {
-      const m = play(makeConfig(seed))
-      const goals = m.events.filter((e) => e.type === "goal")
-      expect(m.s.score.home + m.s.score.away).toBe(goals.length)
-    }
-  })
 })
PATCH
```

- [ ] **Step 2: Run them to make sure they fail**

Run: `pnpm --filter @touchline/sim-core test record`
Expected: 6 failed: `the flight's event: expected undefined to be defined`; `expected { playerId: …} to be null`; `distribution …: expected 'clearance' to be 'pass'`; `expected false to be true` (chosen option); `expected 'undefined' to be 'object'` (carry record); `expected 0.195… to be greater than 0.7` (foot)

- [ ] **Step 3: Implement**

Apply this change to `packages/sim-core/src/types.ts`, `packages/sim-core/src/testing.ts`, `packages/sim-core/src/shot.ts`, `packages/sim-core/src/decide.ts`, `packages/sim-core/src/step.ts` (from the repository root):

```bash
git apply <<'PATCH'
diff --git a/packages/sim-core/src/decide.ts b/packages/sim-core/src/decide.ts
index 265aa7f..0af8344 100644
--- a/packages/sim-core/src/decide.ts
+++ b/packages/sim-core/src/decide.ts
@@ -52,6 +52,8 @@ export interface Decision {
   readonly options: ReadonlyArray<OptionRecord>
   /** 1 when the chosen pass was the best available option, 2 for the second best, ...; null when no pass was chosen. */
   readonly chosenRank: number | null
+  /** True when no option of the chosen action existed (a forced restart) and the best pass of any kind was played. */
+  readonly fallback: boolean
 }
 
 export const OPTIONS_RECORDED = 5
@@ -238,7 +240,7 @@ export const decide = (input: DecisionInput, p: Params, rng: Rng): Decision => {
     if (Number.isFinite(logits[i]!)) actionProbs[a] = r3(Math.exp(logits[i]! - lmax) / z)
   })
   const options = [...candidates].sort((a, b) => b.value - a.value).slice(0, OPTIONS_RECORDED).map(toOption)
-  const record = { actionProbs, options, chosenRank: null as number | null }
+  const record = { actionProbs, options, chosenRank: null as number | null, fallback: false }
 
   let idx = softmaxPick(logits, rng)
   if (idx < 0) idx = ACTIONS.indexOf(allowed ? [...allowed][0]! : "hold")
@@ -247,11 +249,13 @@ export const decide = (input: DecisionInput, p: Params, rng: Rng): Decision => {
   const NON_PASS: ReadonlyArray<Action> = ["shot", "carry", "hold", "take_on", "clear"]
   let passOptions = candidates.filter((c) => c.action === action)
   if (NON_PASS.includes(action)) return { action, candidate: null, decisionQuality: null, xg: action === "shot" ? xg : null, pressure, ...record }
+  let fallback = false
   if (passOptions.length === 0) {
     // Forced restart with no option of the allowed kinds: play the best available pass, or clear it.
-    if (candidates.length === 0) return { action: "clear", candidate: null, decisionQuality: null, xg: null, pressure, ...record }
+    if (candidates.length === 0) return { action: "clear", candidate: null, decisionQuality: null, xg: null, pressure, ...record, fallback: true }
     const bestAny = candidates.reduce((a, b) => (b.value > a.value ? b : a))
     passOptions = [bestAny]
+    fallback = true
   }
   const temp = p.pass.choiceTemperature * (1.4 - owner.attrs.vision)
   const pick = softmaxPick(passOptions.map((c) => c.value / Math.max(0.05, temp)), rng)
@@ -259,5 +263,9 @@ export const decide = (input: DecisionInput, p: Params, rng: Rng): Decision => {
   const best = Math.max(...candidates.map((c) => c.value))
   const quality = best > 0 ? Math.max(0, Math.min(1, chosen.value / best)) : 1
   const chosenRank = 1 + candidates.filter((c) => c.value > chosen.value).length
-  return { action: chosen.action, candidate: chosen, decisionQuality: quality, xg: null, pressure, ...record, chosenRank }
+  // The chosen option is always recorded, even when it ranks below the top OPTIONS_RECORDED.
+  const chosenOption = toOption(chosen)
+  const same = (o: OptionRecord) => o.receiver_id === chosenOption.receiver_id && o.target_x === chosenOption.target_x && o.target_y === chosenOption.target_y
+  const recorded = options.some(same) ? options : [...options, chosenOption]
+  return { action: chosen.action, candidate: chosen, decisionQuality: quality, xg: null, pressure, ...record, options: recorded, chosenRank, fallback }
 }
diff --git a/packages/sim-core/src/shot.ts b/packages/sim-core/src/shot.ts
index 1daf5c4..3090441 100644
--- a/packages/sim-core/src/shot.ts
+++ b/packages/sim-core/src/shot.ts
@@ -62,12 +62,14 @@ export const planShot = (
   isPenalty: boolean,
   p: Params,
   dt: number,
-  rng: Rng
+  rng: Rng,
+  /** Shooting with the weaker foot widens the aiming error by execution.weakFootK. */
+  weakFoot = false
 ): ShotPlan => {
   const goal = goalOf(side)
   const from: Vec3 = { x: shooter.pos.x, y: shooter.pos.y, z: 0.2 }
   const d = dist(shooter.pos, goal)
-  const skill = 1.35 - 0.7 * shooter.attrs.finishing
+  const skill = (1.35 - 0.7 * shooter.attrs.finishing) * (weakFoot ? p.execution.weakFootK : 1)
   const aimY = rng.range(-2.9, 2.9)
   const aimZ = rng.range(0.3, 1.8)
   const sdY = (isPenalty ? 1.0 : 1.6 + 0.12 * d) * (1 + 0.8 * pressure) * skill * p.shot.aimNoise
diff --git a/packages/sim-core/src/step.ts b/packages/sim-core/src/step.ts
index bf74a77..35e21a7 100644
--- a/packages/sim-core/src/step.ts
+++ b/packages/sim-core/src/step.ts
@@ -67,6 +67,7 @@ const kickoffPlayers = (cfg: MatchConfig, existing?: ReadonlyArray<PlayerState>)
         slot,
         jersey: pl.jersey,
         attrs: pl.attrs,
+        foot: pl.preferredFoot ?? "right",
         pos: kickoffAnchor(team.formation, slot, side, team.style),
         vel: { x: 0, y: 0 },
         intent: { kind: "shape" },
@@ -365,9 +366,13 @@ const decisionAttrs = (d: Decision): Record<string, AttrValue> => ({
   best_receiver_id: d.options[0]?.receiver_id ?? null,
   best_value: d.options[0]?.value ?? null,
   chosen_value: d.candidate ? Math.round(d.candidate.value * 1000) / 1000 : null,
-  chosen_rank: d.chosenRank
+  chosen_rank: d.chosenRank,
+  fallback: d.fallback
 })
 
+const otherFoot = (f: PlayerState["foot"]): PlayerState["foot"] => (f === "left" ? "right" : "left")
+const footPart = (pl: PlayerState, weakFoot: boolean): string => `${weakFoot ? otherFoot(pl.foot) : pl.foot}_foot`
+
 const technique = (a: Action, pl: PlayerState): number =>
   a === "cross" ? pl.attrs.crossing : a === "long_pass" || a === "switch" || a === "lofted_through" || a === "clear" ? pl.attrs.longPassing : pl.attrs.shortPassing
 
@@ -404,7 +409,7 @@ const releaseKick = (w: Work, owner: PlayerState, d: Decision, restart: RestartK
     restart,
     height,
     technique: restart === "throw_in" ? "throw" : "foot",
-    body_part: weakFoot ? "left_foot" : "right_foot",
+    body_part: restart === "throw_in" ? "hands" : footPart(owner, weakFoot),
     intended_receiver_id: intended,
     intended_end_x: round2(target.x),
     intended_end_y: round2(target.y),
@@ -482,14 +487,15 @@ const releaseShot = (w: Work, owner: PlayerState, d: Decision, restart: RestartK
   const opps = w.active(other(side))
   const isPenalty = restart === "penalty"
   const xg = isPenalty ? 0.76 : (d.xg ?? 0.02)
-  const plan = planShot(owner, side, opps, xg, d.pressure, isPenalty, w.p, w.dt, w.rng.execution)
+  const weakFoot = !isPenalty && w.rng.execution.chance(0.2)
+  const plan = planShot(owner, side, opps, xg, d.pressure, isPenalty, w.p, w.dt, w.rng.execution, weakFoot)
   const tickAt = w.tick + plan.ticks
   const at = (pe: PendingEvent): PendingEvent => ({ ...pe, frame_id: tickAt })
   const end = { x: plan.to.x, y: plan.to.y }
   const main = w.pending("shot", owner, owner.pos, {
     ...decisionAttrs(d),
     technique: isPenalty ? "penalty" : restart === "free_kick" ? "free_kick" : "normal",
-    body_part: "right_foot",
+    body_part: footPart(owner, weakFoot),
     execution: plan.execution,
     on_target: plan.onTarget,
     xg: Math.round(xg * 1000) / 1000,
@@ -583,7 +589,8 @@ const ownerDecision = (w: Work, owner: PlayerState): void => {
       w.emit(w.pending("take_on", owner, owner.pos, { ...decisionAttrs(decision), outcome: won ? "won" : "lost", defender_id: def.id }))
       if (won) {
         const dir = norm(sub({ x: dirOf(side) * PITCH.halfL, y: 0 }, owner.pos))
-        w.carry = { playerId: owner.id, at: owner.pos, tick: w.tick, decision: {} }
+        // The carry that follows a won take-on carries the take-on's decision record.
+        w.carry = { playerId: owner.id, at: owner.pos, tick: w.tick, decision: decisionAttrs(decision) }
         w.setPlayer({ ...owner, intent: { kind: "carry", dir, speed: w.p.carry.speed * 1.2 }, intentUntil: until(1.2) })
         w.setPlayer({ ...w.player(def.id), vel: { x: 0, y: 0 }, intent: { kind: "hold" }, intentUntil: until(1.0) })
       } else changePossession(w, def, w.pending("tackle", def, def.pos, { outcome: "won", opponent_id: owner.id }))
@@ -593,7 +600,9 @@ const ownerDecision = (w: Work, owner: PlayerState): void => {
       releaseShot(w, owner, decision, restart)
       return
     default:
-      if (owner.role === "GK" && !restart) w.emit(w.pending("keeper_distribution", owner, owner.pos, { method: decision.action === "short_pass" ? "throw" : "kick" }))
+      // A keeper's distribution is always followed by the keeper's pass (a clearance is not a distribution).
+      if (owner.role === "GK" && !restart && decision.action !== "clear")
+        w.emit(w.pending("keeper_distribution", owner, owner.pos, { method: decision.action === "short_pass" ? "throw" : "kick" }))
       releaseKick(w, owner, decision, restart)
   }
 }
@@ -810,6 +819,9 @@ const frameOf = (w: Work): Frame => {
 const endPeriod = (w: Work): StepResult => {
   w.tick -= 1
   w.periodTick -= 1
+  // A carry under way ends at the whistle.
+  if (w.possession.kind === "owned") finishCarry(w, w.player(w.possession.playerId))
+  w.carry = null
   w.emit(w.pending("period_end", null, null, { period: w.period }))
   if (w.period === "second_half") {
     w.emit(w.pending("match_end", null, null, { home: w.score.home, away: w.score.away }))
@@ -841,7 +853,9 @@ export const step = (s: MatchState): StepResult => {
     w.emit(w.pending("match_start", null, null, { home: w.cfg.home.id, away: w.cfg.away.id }))
     w.emit(w.pending("period_start", null, null, { period: "first_half" }))
   }
-  if (w.periodTick >= w.periodTicks && w.phase.kind !== "restart") return endPeriod(w)
+  // The half ends when it is due, except while a set piece is being set up or the ball is in the air
+  // (a flight lasts at most MAX_FLIGHT_S); the hard stop one minute later always applies.
+  if (w.periodTick >= w.periodTicks && w.phase.kind !== "restart" && w.possession.kind !== "in_flight") return endPeriod(w)
   if (w.periodTick >= w.periodTicks + Math.round(60 / w.dt)) return endPeriod(w)
   if (w.phase.kind === "restart") handleRestart(w)
   if (w.phase.kind === "open_play") ownedTick(w)
diff --git a/packages/sim-core/src/testing.ts b/packages/sim-core/src/testing.ts
index ee416f0..439fb8e 100644
--- a/packages/sim-core/src/testing.ts
+++ b/packages/sim-core/src/testing.ts
@@ -46,7 +46,7 @@ export const kickoffPlayersFor = (cfg: MatchConfig): PlayerState[] =>
   (["home", "away"] as const).flatMap((side) => {
     const team = side === "home" ? cfg.home : cfg.away
     return team.starters.map((pl, slot) => ({
-      id: pl.id, side, role: pl.role, slot, jersey: pl.jersey, attrs: pl.attrs,
+      id: pl.id, side, role: pl.role, slot, jersey: pl.jersey, attrs: pl.attrs, foot: pl.preferredFoot ?? "right",
       pos: kickoffAnchor(team.formation, slot, side, team.style), vel: { x: 0, y: 0 },
       intent: { kind: "shape" as const }, intentUntil: 0, energy: 1, yellow: 0, sentOff: false
     }))
diff --git a/packages/sim-core/src/types.ts b/packages/sim-core/src/types.ts
index 3371050..d95cf99 100644
--- a/packages/sim-core/src/types.ts
+++ b/packages/sim-core/src/types.ts
@@ -39,11 +39,15 @@ export interface TeamStyle {
   readonly riskTolerance: number
 }
 
+export type Foot = "left" | "right"
+
 export interface PlayerSetup {
   readonly id: string
   readonly role: Role
   readonly jersey: number
   readonly attrs: PlayerAttrs
+  /** Stronger foot; right when not given. */
+  readonly preferredFoot?: Foot
 }
 
 export interface TeamSetup {
@@ -81,6 +85,7 @@ export interface PlayerState {
   readonly slot: number
   readonly jersey: number
   readonly attrs: PlayerAttrs
+  readonly foot: Foot
   readonly pos: Vec2
   readonly vel: Vec2
   readonly intent: Intent
PATCH
```

- [ ] **Step 4: Run the tests**

Run: `pnpm --filter @touchline/sim-core test record && pnpm --filter @touchline/sim-core typecheck`
Expected: 6 passed, no type errors

- [ ] **Step 5: Run everything**

Run: `pnpm turbo run typecheck test --force`
Expected: `Tasks: 10 successful`. The realism gate passes: the weak-foot draw on shots changes the random sequence, so it logs a small drift (about `"loss":11.0,"maxDrift":2.8`, under the 3.5 limit)

Run: `pnpm sim --seed 1 --home ironmoor --away saltmarsh && uv run --project python/analytics python -m touchline_analytics.validate_cdf out/m-1`
Expected: `meta: ok`, `event: ok`, `tracking: ok` (throw-ins now export `body_part: hands`)

- [ ] **Step 6: Commit**

```bash
git add packages/sim-core
git commit -m "fix(sim-core): flights and carries at half time, keeper distributions, decision-record gaps, preferred foot

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```



### Task 4: Stamina and substitutions

Energy now drains faster for low-stamina players, recovers a little at half time, and widens kick errors as players tire (until now the stamina attribute was unused). Each club gets its bench (the nine squad players after the starters). Substitutions follow the laws of the game: at most five per team, made in at most three stoppages during play (half-time changes do not count as a window). The policy: planned windows around 62', 72' and 81' (SD 5 min) with 2, 2 and 1 changes, a 20 % chance of a half-time change; the most tired (or booked) outfield players come off, replaced from the bench by role, then by line. The substitute takes the formation slot, enters fresh at the halfway line, and never replaces a sent-off player or a keeper. Substitutions are domain events (`player_off` as the player, `player_on`, `reason`, `half_time`) and CDF `referee/substitution` events (no player ids, as the referee rule requires); CDF meta lists the bench with `is_starter: false`.

**Files:**
- Modify: `packages/sim-core/src/params.ts`, `packages/sim-core/src/kinematics.ts`, `packages/sim-core/src/execute.ts`, `packages/sim-core/src/types.ts`, `packages/sim-core/src/step.ts`, `packages/sim-core/src/testing.ts`, `packages/sim/src/cdf.ts`, `packages/schema/src/domain.ts`, `packages/league/src/league.ts`
- Regenerate: `data/league/league.json` (adds `bench`; names unchanged)
- Test: `packages/sim-core/test/subs.test.ts` (new), `packages/sim/test/cdf.test.ts` (one new case)

**Interfaces:**
- Consumes: Task 3's engine; the league's squads.
- Produces: `TeamSetup.bench?: ReadonlyArray<PlayerSetup>`; `params.fatigue {drainBase, drainSpeed2, staminaSlope, halfTimeRecovery, executionK}`; `params.substitutions {windowMinutes, windowSdMin, perWindow, halfTimeChance}`; `drainEnergy(energy, speed, stamina, dt, p)`; `KickIntent.fatigue?`; `interface SubsState {plan, made, windows, used}`; `MatchState.subs`; random concern `bench`; event type `substitution`; test teams from `makeTeam` have a nine-player bench.

- [ ] **Step 1: Write the failing tests**

Create `packages/sim-core/test/subs.test.ts`:

```ts
import { describe, expect, it } from "vitest"
import { DEFAULT_PARAMS, drainEnergy, initMatch, isFinished, step, type DomainEvent, type Frame, type MatchConfig } from "../src/index.js"
import { makeConfig } from "../src/testing.js"

const play = (cfg: MatchConfig) => {
  let s = initMatch(cfg)
  const frames: Frame[] = [], events: DomainEvent[] = []
  while (!isFinished(s)) { const r = step(s); s = r.state; if (r.frame) frames.push(r.frame); events.push(...r.events) }
  return { s, frames, events }
}
const runs = [1, 2, 3, 4, 5, 6].map((seed) => ({ cfg: makeConfig(seed), ...play(makeConfig(seed)) }))

describe("stamina", () => {
  it("drains faster when running fast and for players with less stamina", () => {
    const p = DEFAULT_PARAMS
    const walk = 1 - drainEnergy(1, 1.5, 0.5, 0.1, p), sprint = 1 - drainEnergy(1, 8, 0.5, 0.1, p)
    expect(sprint).toBeGreaterThan(5 * walk)
    expect(1 - drainEnergy(1, 6, 0.9, 0.1, p)).toBeLessThan(1 - drainEnergy(1, 6, 0.3, 0.1, p))
    expect(drainEnergy(0.0001, 9, 0, 10, p)).toBe(0)
  })
})

describe("substitutions", () => {
  it("each team makes at most 5, in at most 3 windows during play (half time does not count), and usually makes some", () => {
    let total = 0
    for (const r of runs) {
      for (const team of [r.cfg.home.id, r.cfg.away.id]) {
        const subs = r.events.filter((e) => e.type === "substitution" && e.team_id === team)
        total += subs.length
        expect(subs.length).toBeLessThanOrEqual(5)
        const windows = new Set(subs.filter((e) => e.attrs.half_time !== true).map((e) => e.frame_id))
        expect(windows.size).toBeLessThanOrEqual(3)
      }
    }
    expect(total / (runs.length * 2)).toBeGreaterThan(2.5)
  })
  it("happen only when the ball is dead, in the second half or at half time", () => {
    for (const r of runs) {
      const byTick = new Map(r.frames.map((f) => [f.tick, f]))
      for (const e of r.events.filter((x) => x.type === "substitution")) {
        expect(e.period, e.id).toBe("second_half")
        expect(byTick.get(e.frame_id)?.ball_in_play, e.id).toBe(false)
      }
    }
  })
  it("the player coming on takes part from then on and the player going off never appears again", () => {
    for (const r of runs) {
      for (const e of r.events.filter((x) => x.type === "substitution")) {
        const on = e.attrs.player_on as string, off = e.player_id!
        const after = r.frames.filter((f) => f.tick > e.frame_id)
        expect(after.some((f) => [...f.home, ...f.away].some((p) => p.id === off)), `${off} after going off`).toBe(false)
        expect(after.every((f) => [...f.home, ...f.away].some((p) => p.id === on)) || r.events.some((c) => c.type === "card" && c.player_id === on), `${on} on the pitch`).toBe(true)
        expect([...r.cfg.home.bench!, ...r.cfg.away.bench!].some((b) => b.id === on)).toBe(true)
      }
      for (const f of r.frames.filter((_, i) => i % 100 === 0)) {
        const ids = [...f.home, ...f.away].map((p) => p.id)
        expect(new Set(ids).size).toBe(ids.length)
      }
    }
  })
  it("never brings on a keeper for an outfield player, never replaces a sent-off player, and uses each bench player once", () => {
    const params = { ...DEFAULT_PARAMS, defending: { ...DEFAULT_PARAMS.defending, foulPerTackle: 0.6, redPerFoul: 0.25 } }
    const r = play(makeConfig(6, { params }))
    const cfg = makeConfig(6)
    const bench = new Map([...cfg.home.bench!, ...cfg.away.bench!].map((b) => [b.id, b]))
    const reds = new Set(r.events.filter((e) => e.type === "card" && e.attrs.colour !== "yellow").map((e) => e.player_id))
    const subs = r.events.filter((e) => e.type === "substitution")
    for (const e of subs) {
      expect(bench.get(e.attrs.player_on as string)!.role).not.toBe("GK")
      expect(reds.has(e.player_id)).toBe(false)
    }
    expect(new Set(subs.map((e) => e.attrs.player_on)).size).toBe(subs.length)
  })
  it("a team without a bench plays on with its starters", () => {
    const cfg = makeConfig(7)
    const r = play({ ...cfg, home: { ...cfg.home, bench: [] }, away: { ...cfg.away, bench: undefined } })
    expect(r.events.filter((e) => e.type === "substitution")).toHaveLength(0)
    expect(r.events.at(-1)!.type).toBe("match_end")
  })
})
```

Apply this change to `packages/sim/test/cdf.test.ts` (from the repository root):

```bash
git apply <<'PATCH'
diff --git a/packages/sim/test/cdf.test.ts b/packages/sim/test/cdf.test.ts
index d7864f0..34b6796 100644
--- a/packages/sim/test/cdf.test.ts
+++ b/packages/sim/test/cdf.test.ts
@@ -51,6 +51,16 @@ describe("CDF export", () => {
     const fromShot = { ...own, attrs: { scorer_id: base.player_id, own_goal: false } }
     expect(cdfTypeOf(fromShot)).toBeNull()
   })
+  it("meta lists substitutes as non-starters, and substitutions export as referee events", () => {
+    const m = cdfMeta(cfg, periodsFromFrames(frames))
+    const home = m.teams.home.players
+    expect(home.filter((p) => p.is_starter)).toHaveLength(11)
+    expect(home.filter((p) => !p.is_starter).map((p) => p.id)).toEqual(cfg.home.bench!.map((p) => p.id))
+    const sub = events.find((e) => e.type === "substitution")!
+    const line = JSON.parse(cdfEventLine(cfg, sub, clock, start, null)!)
+    expect(line.event).toMatchObject({ type: "referee", sub_type: "substitution", official_id: REFEREE_ID })
+    expect(line.event.player_id).toBeUndefined()
+  })
   it("event tracking frame ids are period-relative", () => {
     const pass = events.find((e) => e.type === "pass" && e.period === "second_half")!
     const line = JSON.parse(cdfEventLine(cfg, pass, clock, start, pass.frame_id_end)!)
PATCH
```

- [ ] **Step 2: Run them to make sure they fail**

Run: `pnpm --filter @touchline/sim-core test subs`
Expected: failures including `TypeError: drainEnergy is not a function` and `expected 0 to be greater than 2.5`

- [ ] **Step 3: Implement the engine side**

Apply this change to `packages/sim-core/src/params.ts`, `packages/sim-core/src/kinematics.ts`, `packages/sim-core/src/execute.ts`, `packages/sim-core/src/types.ts`, `packages/sim-core/src/step.ts`, `packages/sim-core/src/testing.ts` (from the repository root):

```bash
git apply <<'PATCH'
diff --git a/packages/sim-core/src/execute.ts b/packages/sim-core/src/execute.ts
index 339d59d..ceb1ce1 100644
--- a/packages/sim-core/src/execute.ts
+++ b/packages/sim-core/src/execute.ts
@@ -16,6 +16,8 @@ export interface KickIntent {
   /** 0..1 from nearest-opponent distance. */
   readonly pressure: number
   readonly weakFoot: boolean
+  /** 0 fresh .. 1 exhausted (1 - energy); widens the error by execution.executionK. */
+  readonly fatigue?: number
 }
 
 export interface Executed {
@@ -38,7 +40,7 @@ export const executeKick = (k: KickIntent, p: Params, rng: Rng): Executed => {
   const dy = k.to.y - k.from.y
   const intendedLen = Math.max(0.5, Math.hypot(dx, dy))
   const ang0 = Math.atan2(dy, dx)
-  const skill = 1.35 - 0.7 * k.technique
+  const skill = (1.35 - 0.7 * k.technique) * (1 + p.fatigue.executionK * (k.fatigue ?? 0))
   const foot = k.weakFoot ? e.weakFootK : 1
   const pressureScale = 1 + e.pressureK * k.pressure
   const pMishit = Math.min(0.35, e.mishitBase + e.mishitK * Math.pow(k.pressure, 1.6) * (1.2 - k.composure) * (k.weakFoot ? 1.6 : 1))
diff --git a/packages/sim-core/src/kinematics.ts b/packages/sim-core/src/kinematics.ts
index e1ef999..77f92bd 100644
--- a/packages/sim-core/src/kinematics.ts
+++ b/packages/sim-core/src/kinematics.ts
@@ -5,6 +5,12 @@ import type { PlayerAttrs } from "./types.js"
 export const vmaxFor = (a: PlayerAttrs, energy: number, p: Params): number =>
   p.kinematics.vmaxBase * (0.86 + 0.14 * a.pace) * (0.9 + 0.1 * energy)
 
+/** Energy after `dt` seconds at `speed` m/s for a player with the given stamina attribute (never below 0). */
+export const drainEnergy = (energy: number, speed: number, stamina: number, dt: number, p: Params): number => {
+  const f = p.fatigue
+  return Math.max(0, energy - dt * (f.drainBase + f.drainSpeed2 * speed * speed) * (1 + f.staminaSlope * (0.5 - stamina)))
+}
+
 export const accelFor = (a: PlayerAttrs, p: Params): number => p.kinematics.accelMax * (0.8 + 0.2 * a.acceleration)
 
 /**
diff --git a/packages/sim-core/src/params.ts b/packages/sim-core/src/params.ts
index 4ea1a0a..2428c92 100644
--- a/packages/sim-core/src/params.ts
+++ b/packages/sim-core/src/params.ts
@@ -121,6 +121,13 @@ export interface Params {
   readonly movement: { readonly shapeSpeedShare: number }
   /** Team shape spread: width (fully in possession, partly without) and depth between lines. */
   readonly shape: { readonly width: number; readonly depth: number }
+  /**
+   * Energy (1 fresh .. 0 exhausted) drains per second by (drainBase + drainSpeed2 x speed^2) x (1 + staminaSlope x (0.5 - stamina));
+   * players recover halfTimeRecovery at the break; tiredness widens execution error by up to executionK.
+   */
+  readonly fatigue: { readonly drainBase: number; readonly drainSpeed2: number; readonly staminaSlope: number; readonly halfTimeRecovery: number; readonly executionK: number }
+  /** Substitution policy: planned windows (match minute, mean and SD), players per window, chance of a half-time change. */
+  readonly substitutions: { readonly windowMinutes: readonly [number, number, number]; readonly windowSdMin: number; readonly perWindow: readonly [number, number, number]; readonly halfTimeChance: number }
   readonly classifier: ClassifierThresholds
 }
 
@@ -201,6 +208,8 @@ export const DEFAULT_PARAMS: Params = {
   runs: { runInBehindRatePerS: 0.12 },
   movement: { shapeSpeedShare: 0.7 },
   shape: { width: 1, depth: 1 },
+  fatigue: { drainBase: 0.00004, drainSpeed2: 0.000012, staminaSlope: 0.8, halfTimeRecovery: 0.1, executionK: 0.25 },
+  substitutions: { windowMinutes: [62, 72, 81], windowSdMin: 5, perWindow: [2, 2, 1], halfTimeChance: 0.2 },
   classifier: {
     longPassM: 32,
     switchLateralM: 25,
diff --git a/packages/sim-core/src/step.ts b/packages/sim-core/src/step.ts
index 35e21a7..68b3f8d 100644
--- a/packages/sim-core/src/step.ts
+++ b/packages/sim-core/src/step.ts
@@ -19,7 +19,7 @@ import {
   type Vec2,
   type Vec3
 } from "./geometry.js"
-import { accelFor, arrive, arriveBy, interceptPoint, separation, vmaxFor } from "./kinematics.js"
+import { accelFor, arrive, arriveBy, drainEnergy, interceptPoint, separation, vmaxFor } from "./kinematics.js"
 import type { Action } from "./params.js"
 import { goalLineCrossing, resolveFlight } from "./resolve.js"
 import { hazard, Rng, substream } from "./rng.js"
@@ -40,12 +40,18 @@ import {
   type PlayerState,
   type Possession,
   type RestartKind,
+  type PlayerSetup,
+  type Role,
   type StepResult,
+  type SubsState,
   type TeamSetup
 } from "./types.js"
 
 const HALF_TIME_MS = 15 * 60 * 1000
 const OUTCOME_IN_ATTRS: ReadonlySet<string> = new Set(["take_on", "tackle"])
+/** Laws of the game: five substitutions, made in at most three stoppages during play (half time does not count). */
+const MAX_SUBS = 5
+const MAX_SUB_WINDOWS = 3
 
 const teamOf = (cfg: MatchConfig, side: Side): TeamSetup => (side === "home" ? cfg.home : cfg.away)
 
@@ -54,12 +60,11 @@ const samplePeriodTicks = (cfg: MatchConfig, rng: Rng): number => {
   return Math.round((45 * 60 + rng.range(lo, hi)) / cfg.dt)
 }
 
-const kickoffPlayers = (cfg: MatchConfig, existing?: ReadonlyArray<PlayerState>): PlayerState[] => {
+const kickoffPlayers = (cfg: MatchConfig): PlayerState[] => {
   const out: PlayerState[] = []
   for (const side of ["home", "away"] as const) {
     const team = teamOf(cfg, side)
     team.starters.forEach((pl, slot) => {
-      const prev = existing?.find((e) => e.id === pl.id)
       out.push({
         id: pl.id,
         side,
@@ -72,15 +77,25 @@ const kickoffPlayers = (cfg: MatchConfig, existing?: ReadonlyArray<PlayerState>)
         vel: { x: 0, y: 0 },
         intent: { kind: "shape" },
         intentUntil: 0,
-        energy: prev?.energy ?? 1,
-        yellow: prev?.yellow ?? 0,
-        sentOff: prev?.sentOff ?? false
+        energy: 1,
+        yellow: 0,
+        sentOff: false
       })
     })
   }
   return out
 }
 
+/** Planned substitution windows for one team (none without a bench). */
+const planSubs = (cfg: MatchConfig, side: Side, rng: Rng): SubsState => {
+  const s = cfg.params.substitutions
+  const bench = teamOf(cfg, side).bench ?? []
+  const plan = bench.length === 0
+    ? []
+    : s.windowMinutes.map((m, i) => ({ minute: Math.max(46, m + rng.normal() * s.windowSdMin), players: s.perWindow[i]! })).sort((a, b) => a.minute - b.minute)
+  return { plan, made: 0, windows: 0, used: [] }
+}
+
 /** Initial state: tick -1, so the first step emits frame 0 of the first half. */
 export const initMatch = (cfg: MatchConfig): MatchState => {
   const ids = [...cfg.home.starters, ...cfg.away.starters].map((p) => p.id)
@@ -91,6 +106,9 @@ export const initMatch = (cfg: MatchConfig): MatchState => {
   const timing = new Rng(rng.restart)
   const periodTicks = samplePeriodTicks(cfg, timing)
   rng.restart = timing.state
+  const benchRng = new Rng(rng.bench)
+  const subs = { home: planSubs(cfg, "home", benchRng), away: planSubs(cfg, "away", benchRng) }
+  rng.bench = benchRng.state
   return {
     config: cfg,
     tick: -1,
@@ -106,6 +124,7 @@ export const initMatch = (cfg: MatchConfig): MatchState => {
     lastTouch: null,
     pressedBy: [],
     carry: null,
+    subs,
     rng,
     eventSeq: 0
   }
@@ -130,6 +149,7 @@ class Work {
   lastTouch: MatchState["lastTouch"]
   pressedBy: string[]
   carry: MatchState["carry"]
+  subs: Record<Side, SubsState>
   rng: Record<Concern, Rng>
   seq: number
   events: DomainEvent[] = []
@@ -150,6 +170,7 @@ class Work {
     this.lastTouch = s.lastTouch
     this.pressedBy = [...s.pressedBy]
     this.carry = s.carry
+    this.subs = { ...s.subs }
     this.rng = {} as Record<Concern, Rng>
     for (const c of CONCERNS) this.rng[c] = new Rng(s.rng[c])
     this.seq = s.eventSeq
@@ -170,6 +191,11 @@ class Work {
     const i = this.players.findIndex((x) => x.id === next.id)
     this.players[i] = next
   }
+  /** Put `next` in the place of player `id` (a substitution). */
+  setPlayerAt(id: string, next: PlayerState): void {
+    const i = this.players.findIndex((x) => x.id === id)
+    this.players[i] = next
+  }
   active(side?: Side): PlayerState[] {
     return this.players.filter((x) => !x.sentOff && (side === undefined || x.side === side))
   }
@@ -223,6 +249,7 @@ class Work {
       lastTouch: this.lastTouch,
       pressedBy: this.pressedBy,
       carry: this.carry,
+      subs: this.subs,
       rng: out,
       eventSeq: this.seq
     }
@@ -248,6 +275,62 @@ const startRestart = (w: Work, r: { restart: RestartKind; side: Side; at: Vec2 }
   w.possession = { kind: "dead" }
   w.ball = { pos: { x: r.at.x, y: r.at.y, z: 0 }, vel: { x: 0, y: 0, z: 0 } }
   w.pressedBy = []
+  if (w.period === "second_half") for (const side of ["home", "away"] as const) subWindow(w, side)
+}
+
+// ---------------------------------------------------------------- substitutions
+
+const LINE: Readonly<Record<Role, string>> = { GK: "gk", CB: "def", FB: "def", DM: "mid", CM: "mid", AM: "mid", W: "att", ST: "att" }
+
+/** Bench player to bring on for `off`: same role, else same line, else any outfield player. */
+const pickIncoming = (bench: ReadonlyArray<PlayerSetup>, off: PlayerState): PlayerSetup | null =>
+  bench.find((b) => b.role === off.role) ?? bench.find((b) => LINE[b.role] === LINE[off.role]) ?? bench[0] ?? null
+
+/**
+ * Replace up to `n` tired (or booked) outfield players. The player coming on takes the same formation slot and role,
+ * fresh, entering at `entry` (the halfway line during play, the kickoff position at half time).
+ */
+const makeSubs = (w: Work, side: Side, n: number, halfTime: boolean): number => {
+  const st = w.subs[side]
+  const team = teamOf(w.cfg, side)
+  let bench = (team.bench ?? []).filter((b) => b.role !== "GK" && !st.used.includes(b.id))
+  const rng = w.rng.bench
+  const outgoing = w
+    .active(side)
+    .filter((pl) => pl.role !== "GK" && !st.used.includes(pl.id))
+    .map((pl) => ({ pl, score: 1 - pl.energy + 0.25 * pl.yellow + 0.05 * rng.uniform() }))
+    .sort((a, b) => b.score - a.score)
+  let made = 0
+  const used = [...st.used]
+  for (const { pl: off } of outgoing) {
+    if (made >= n || st.made + made >= MAX_SUBS) break
+    const on = pickIncoming(bench, off)
+    if (!on) break
+    bench = bench.filter((b) => b.id !== on.id)
+    used.push(on.id)
+    const entry = halfTime ? off.pos : { x: 0, y: -PITCH.halfW }
+    w.setPlayerAt(off.id, {
+      id: on.id, side, role: off.role, slot: off.slot, jersey: on.jersey, attrs: on.attrs, foot: on.preferredFoot ?? "right",
+      pos: entry, vel: { x: 0, y: 0 }, intent: { kind: "shape" }, intentUntil: 0, energy: 1, yellow: 0, sentOff: false
+    })
+    if (w.lastTouch?.playerId === off.id) w.lastTouch = { playerId: on.id, side }
+    const reason = off.yellow > 0 && 1 - off.energy < 0.5 ? "booked" : "fatigue"
+    w.emit(w.pending("substitution", off, off.pos, { player_off: off.id, player_on: on.id, reason, half_time: halfTime }))
+    made++
+  }
+  w.subs[side] = { ...st, made: st.made + made, used }
+  return made
+}
+
+/** At a stoppage in the second half, make every planned change that is due, as one window. */
+const subWindow = (w: Work, side: Side): void => {
+  const st = w.subs[side]
+  if (st.windows >= MAX_SUB_WINDOWS || st.made >= MAX_SUBS) return
+  const due = st.plan.filter((x) => x.minute <= w.minute())
+  if (due.length === 0) return
+  w.subs[side] = { ...st, plan: st.plan.slice(due.length) }
+  const made = makeSubs(w, side, due.reduce((a, x) => a + x.players, 0), false)
+  if (made > 0) w.subs[side] = { ...w.subs[side], windows: w.subs[side].windows + 1 }
 }
 
 const takerFor = (w: Work, r: { restart: RestartKind; side: Side; at: Vec2 }): PlayerState => {
@@ -387,7 +470,7 @@ const releaseKick = (w: Work, owner: PlayerState, d: Decision, restart: RestartK
   const height = isClear ? "high" : d.candidate!.height
   const weakFoot = w.rng.execution.chance(0.2)
   const exe = executeKick(
-    { from: owner.pos, to: target, height, technique: technique(d.action, owner), composure: owner.attrs.composure, pressure: d.pressure, weakFoot },
+    { from: owner.pos, to: target, height, technique: technique(d.action, owner), composure: owner.attrs.composure, pressure: d.pressure, weakFoot, fatigue: 1 - owner.energy },
     p,
     w.rng.execution
   )
@@ -783,7 +866,7 @@ const moveAll = (w: Work): void => {
         ? arriveBy(cur.pos, cur.vel, target, Math.max(0.5, vmax), accelFor(cur.attrs, w.p), w.dt, timeLeft)
         : arrive(cur.pos, cur.vel, add(target, scale(sep, 2)), Math.max(0.5, vmax), accelFor(cur.attrs, w.p), w.dt)
     const speed = len(next.vel)
-    const energy = Math.max(0, cur.energy - w.dt * (0.00004 + 0.000012 * speed * speed))
+    const energy = drainEnergy(cur.energy, speed, cur.attrs.stamina, w.dt, w.p)
     w.setPlayer({ ...cur, pos: clampToPitch(next.pos, -2), vel: next.vel, energy })
   }
 }
@@ -835,11 +918,16 @@ const endPeriod = (w: Work): StepResult => {
   w.periodStartTick = w.tick
   w.periodStartMs += firstHalfMs + HALF_TIME_MS
   w.periodTicks = samplePeriodTicks(w.cfg, w.rng.restart)
-  w.players = kickoffPlayers(w.cfg, w.players)
+  // Same players (substitutes included) back in kickoff shape, a little recovered.
+  w.players = w.players.map((pl) => {
+    const team = teamOf(w.cfg, pl.side)
+    return { ...pl, pos: kickoffAnchor(team.formation, pl.slot, pl.side, team.style), vel: { x: 0, y: 0 }, intent: { kind: "shape" }, intentUntil: 0, energy: Math.min(1, pl.energy + w.p.fatigue.halfTimeRecovery) }
+  })
   w.phase = { kind: "restart", restart: "kickoff", side: "away", at: { x: 0, y: 0 }, resumeTick: w.tick }
   w.possession = { kind: "dead" }
   w.ball = { pos: { x: 0, y: 0, z: 0 }, vel: { x: 0, y: 0, z: 0 } }
   w.emit(w.pending("period_start", null, null, { period: "second_half" }))
+  for (const side of ["home", "away"] as const) if ((teamOf(w.cfg, side).bench ?? []).length > 0 && w.rng.bench.chance(w.p.substitutions.halfTimeChance)) makeSubs(w, side, 1, true)
   handleRestart(w)
   return { state: w.toState(), frame: frameOf(w), events: w.events }
 }
diff --git a/packages/sim-core/src/testing.ts b/packages/sim-core/src/testing.ts
index 439fb8e..60a65bc 100644
--- a/packages/sim-core/src/testing.ts
+++ b/packages/sim-core/src/testing.ts
@@ -21,12 +21,14 @@ export const makeTeam = (id: string, formation: FormationName, style: TeamStyle,
     pace: attr(), acceleration: attr(), shortPassing: attr(), longPassing: attr(), vision: attr(), crossing: attr(),
     dribbling: attr(), finishing: attr(), heading: attr(), tackling: attr(), composure: attr(), stamina: attr(), handling: attr(), reflexes: attr()
   })
+  const benchRoles = ["GK", "CB", "FB", "DM", "CM", "AM", "W", "ST", "CM"] as const
   return {
     id,
     name: id,
     formation,
     style,
-    starters: FORMATIONS[formation].map((slot, i) => ({ id: `${id}-${String(i + 1).padStart(2, "0")}`, role: slot.role, jersey: i + 1, attrs: attrs() }))
+    starters: FORMATIONS[formation].map((slot, i) => ({ id: `${id}-${String(i + 1).padStart(2, "0")}`, role: slot.role, jersey: i + 1, attrs: attrs() })),
+    bench: benchRoles.map((role, i) => ({ id: `${id}-${String(i + 12).padStart(2, "0")}`, role, jersey: i + 12, attrs: attrs() }))
   }
 }
 
diff --git a/packages/sim-core/src/types.ts b/packages/sim-core/src/types.ts
index d95cf99..3bba37c 100644
--- a/packages/sim-core/src/types.ts
+++ b/packages/sim-core/src/types.ts
@@ -57,6 +57,8 @@ export interface TeamSetup {
   readonly style: TeamStyle
   /** Exactly 11 starters in formation slot order; slot 0 is the goalkeeper. */
   readonly starters: ReadonlyArray<PlayerSetup>
+  /** Substitutes available to come on (none when absent). */
+  readonly bench?: ReadonlyArray<PlayerSetup>
 }
 
 export interface MatchConfig {
@@ -183,6 +185,7 @@ export type EventType =
   | "offside"
   | "set_piece"
   | "off_ball_run"
+  | "substitution"
 
 /** One alternative the player could have chosen, recorded at the moment of decision. */
 export interface OptionRecord {
@@ -264,9 +267,17 @@ export interface Frame {
   readonly possession_side: Side | null
 }
 
-export const CONCERNS = ["decision", "execution", "duel", "referee", "movement", "restart", "script"] as const
+export const CONCERNS = ["decision", "execution", "duel", "referee", "movement", "restart", "script", "bench"] as const
 export type Concern = (typeof CONCERNS)[number]
 
+/** One team's substitutions: planned windows (match minutes) still to come, changes made, windows used, bench players used. */
+export interface SubsState {
+  readonly plan: ReadonlyArray<{ readonly minute: number; readonly players: number }>
+  readonly made: number
+  readonly windows: number
+  readonly used: ReadonlyArray<string>
+}
+
 export interface MatchState {
   readonly config: MatchConfig
   readonly tick: number
@@ -289,6 +300,7 @@ export interface MatchState {
     /** Decision record copied onto the carry event when it ends. */
     readonly decision: Readonly<Record<string, AttrValue>>
   } | null
+  readonly subs: Readonly<Record<Side, SubsState>>
   readonly rng: Readonly<Record<Concern, RngState>>
   readonly eventSeq: number
 }
PATCH
```

- [ ] **Step 4: Export, schema and league**

Apply this change to `packages/sim/src/cdf.ts`, `packages/schema/src/domain.ts`, `packages/league/src/league.ts` (from the repository root):

```bash
git apply <<'PATCH'
diff --git a/packages/league/src/league.ts b/packages/league/src/league.ts
index 6db7575..e981271 100644
--- a/packages/league/src/league.ts
+++ b/packages/league/src/league.ts
@@ -108,6 +108,7 @@ export const generateLeague = (seed: number, blocked: ReadonlySet<string>): Leag
       formation: c.formation,
       style: ARCHETYPES[c.archetype],
       starters: squad.slice(0, 11),
+      bench: squad.slice(11),
       squad,
       kits: { home: { primary, secondary }, away: { primary: awayPrimary, secondary } },
       crest: { shape: (["shield", "circle", "diamond"] as const)[ci % 3]!, symbol: ["anvil", "kestrel", "gate", "wave", "sun", "hammer", "flower", "anchor"][ci]! }
diff --git a/packages/schema/src/domain.ts b/packages/schema/src/domain.ts
index 48337e5..11595af 100644
--- a/packages/schema/src/domain.ts
+++ b/packages/schema/src/domain.ts
@@ -3,7 +3,7 @@ import { Schema } from "effect"
 export const EventType = Schema.Literals([
   "match_start", "period_start", "period_end", "match_end", "pass", "reception", "carry", "take_on", "shot", "goal",
   "keeper_save", "keeper_distribution", "aerial_duel", "pressure", "tackle", "interception", "block", "clearance",
-  "ball_recovery", "possession_change", "ball_out", "foul", "card", "offside", "set_piece", "off_ball_run"
+  "ball_recovery", "possession_change", "ball_out", "foul", "card", "offside", "set_piece", "off_ball_run", "substitution"
 ])
 export const Period = Schema.Literals(["first_half", "second_half"])
 export const OptionRecord = Schema.Struct({
diff --git a/packages/sim/src/cdf.ts b/packages/sim/src/cdf.ts
index 1f8eb9e..bd9b0ec 100644
--- a/packages/sim/src/cdf.ts
+++ b/packages/sim/src/cdf.ts
@@ -27,7 +27,10 @@ export const periodsFromFrames = (frames: Iterable<Frame>): PeriodInfo[] => {
 const team = (t: TeamSetup) => ({
   id: t.id,
   name: t.name,
-  players: t.starters.map((p) => ({ id: p.id, team_id: t.id, jersey_number: p.jersey, is_starter: true }))
+  players: [
+    ...t.starters.map((p) => ({ id: p.id, team_id: t.id, jersey_number: p.jersey, is_starter: true })),
+    ...(t.bench ?? []).map((p) => ({ id: p.id, team_id: t.id, jersey_number: p.jersey, is_starter: false }))
+  ]
 })
 
 export const cdfMeta = (cfg: MatchConfig, periods: ReadonlyArray<PeriodInfo>, extra: { competitionId?: string; seasonId?: string; venueId?: string } = {}) => ({
@@ -123,6 +126,9 @@ export const cdfTypeOf = (e: DomainEvent): CdfType => {
       return { type: "referee", sub_type: "caution", outcome_type: a.colour === "yellow" ? "yellow_card" : a.colour === "red" ? "red_card" : "second_yellow_card", is_successful: true }
     case "offside":
       return { type: "referee", sub_type: "offside", outcome_type: "offside", is_successful: true }
+    case "substitution":
+      // Who came on and off stays in the domain stream: CDF referee events carry no player ids.
+      return { type: "referee", sub_type: "substitution", outcome_type: "start", is_successful: true }
     default:
       return null
   }
PATCH
```

Run: `pnpm league`
Expected: `wrote 8 clubs, 160 players`; `git diff data/league/league.json` shows only the new `bench` arrays

- [ ] **Step 5: Run the tests**

Run: `pnpm --filter @touchline/sim-core test subs && pnpm --filter @touchline/sim test cdf && pnpm --filter @touchline/schema test`
Expected: 6 passed; 7 passed; 2 passed

- [ ] **Step 6: Run everything and look at a match**

Run: `pnpm turbo run typecheck test --force`
Expected: `Tasks: 10 successful`; the realism gate passes (about `"loss":7.3`)

Run: `pnpm sim --seed 1 --home ironmoor --away saltmarsh && uv run --project python/analytics python -m touchline_analytics.validate_cdf out/m-1`
Expected: CDF valid; `grep substitution out/m-1/domain.jsonl` lists about ten changes between 59' and 88', at most five per club

- [ ] **Step 7: Commit**

```bash
git add packages data/league/league.json
git commit -m "feat(sim-core): stamina-driven fatigue and substitutions

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```



### Task 5: First-touch errors and ground duels

A reception's first touch is now decided at contact from the ball's speed and height, the pressure on the receiver and their dribbling and composure: P(error) = sigmoid(b0 + bSpeed·(speed − 12)/10 + bHigh·height share + bPressure·pressure + bSkill·(skill − 0.6)), b0 = −3.9, which gives 2–3 % bad touches (12–20 per match). A heavy touch runs on 4–7 m/s, a miscontrol bounces off at an angle, a missed ball carries on; the ball is loose and the receiver cannot play it for 0.4 s. A loose ball two opponents can both reach is decided by a ground duel (tackling and dribbling, and who is closer); the winner recovers it. Receptions now record real `under_pressure` and `lost_possession` (false when controlled, null when not yet known).

**Files:**
- Create: `packages/sim-core/src/touch.ts`
- Modify: `packages/sim-core/src/index.ts`, `packages/sim-core/src/params.ts`, `packages/sim-core/src/types.ts`, `packages/sim-core/src/step.ts`, `packages/sim/src/cdf.ts`, `packages/schema/src/domain.ts`
- Test: `packages/sim-core/test/touch.test.ts` (new), `packages/sim-core/test/record.test.ts` (footedness test also makes the bench left-footed: substitutes now come on)

**Interfaces:**
- Consumes: Task 4's engine; `pressureFrom` (execute.ts).
- Produces: `type FirstTouch = "controlled" | "heavy" | "miscontrol" | "missed"`; `interface TouchInput {speed, height, pressure, skill}`; `firstTouchError(t, p)`; `drawFirstTouch(pError, rng, p)`; `ballAfterTouch(kind, at, vel, rng)`; `params.firstTouch`, `params.groundDuel {bSkill, bReach, contestM}`; `Possession` loose gains `noTouchId?`, `noTouchUntil?`; event type `ground_duel` (`kind: loose_ball`, `winner_id`, `loser_id`), CDF `misc/other_ball_action`.

- [ ] **Step 1: Write the failing tests**

Create `packages/sim-core/test/touch.test.ts`:

```ts
import { describe, expect, it } from "vitest"
import { DEFAULT_PARAMS, firstTouchError, initMatch, isFinished, step, type DomainEvent, type Frame, type MatchConfig } from "../src/index.js"
import { makeConfig } from "../src/testing.js"

const play = (cfg: MatchConfig) => {
  let s = initMatch(cfg)
  const frames: Frame[] = [], events: DomainEvent[] = []
  while (!isFinished(s)) { const r = step(s); s = r.state; if (r.frame) frames.push(r.frame); events.push(...r.events) }
  return { frames, events }
}
const runs = [1, 2, 3, 4].map((seed) => play(makeConfig(seed)))
const receptions = runs.flatMap((r) => r.events.filter((e) => e.type === "reception"))

describe("first touch", () => {
  const base = { speed: 12, height: 0, pressure: 0, skill: 0.6 }
  const p = (o: Partial<typeof base>) => firstTouchError({ ...base, ...o }, DEFAULT_PARAMS)
  it("is harder for fast, high balls, under pressure, and for less skilful players", () => {
    expect(p({ speed: 22 })).toBeGreaterThan(p({}))
    expect(p({ height: 1.6 })).toBeGreaterThan(p({}))
    expect(p({ pressure: 1 })).toBeGreaterThan(p({}))
    expect(p({ skill: 0.3 })).toBeGreaterThan(p({ skill: 0.9 }))
    expect(p({})).toBeLessThan(0.05)
  })
  it("most receptions are controlled; a few are heavy, miscontrolled or missed", () => {
    const kinds = new Set(receptions.map((e) => e.attrs.first_touch))
    expect([...kinds].every((k) => ["controlled", "heavy", "miscontrol", "missed"].includes(k as string))).toBe(true)
    const bad = receptions.filter((e) => e.attrs.first_touch !== "controlled").length / receptions.length
    expect(bad).toBeGreaterThan(0.01)
    expect(bad).toBeLessThan(0.08)
  })
  it("a bad touch leaves the ball loose; a controlled one keeps it with the receiver", () => {
    for (const r of runs) {
      const byTick = new Map(r.frames.map((f) => [f.tick, f]))
      for (const e of r.events.filter((x) => x.type === "reception")) {
        const f = byTick.get(e.frame_id)!
        if (e.attrs.first_touch === "controlled") expect(f.possession_side, e.id).not.toBeNull()
        else expect(f.possession_side, e.id).toBeNull()
      }
    }
  })
})

describe("ground duels", () => {
  it("contested loose balls are decided by a ground duel between the two teams, and the winner recovers the ball", () => {
    let n = 0
    for (const r of runs) {
      r.events.forEach((e, i) => {
        if (e.type !== "ground_duel") return
        n++
        expect(e.attrs.kind).toBe("loose_ball")
        const winner = e.attrs.winner_id as string, loser = e.attrs.loser_id as string
        expect(winner.slice(0, 4)).not.toBe(loser.slice(0, 4))
        expect(e.player_id).toBe(winner)
        const next = r.events[i + 1]!
        expect(next.type).toBe("ball_recovery")
        expect(next.player_id).toBe(winner)
      })
    }
    expect(n).toBeGreaterThan(20)
  })
})
```

Apply this change to `packages/sim-core/test/record.test.ts` (from the repository root):

```bash
git apply <<'PATCH'
diff --git a/packages/sim-core/test/record.test.ts b/packages/sim-core/test/record.test.ts
index 9f2e16b..0615ade 100644
--- a/packages/sim-core/test/record.test.ts
+++ b/packages/sim-core/test/record.test.ts
@@ -82,11 +82,12 @@ describe("on-ball records", () => {
   })
   it("passes and shots use the player's preferred foot, and the other foot for weak-foot kicks", () => {
     const cfg = makeConfig(5)
-    const lefty = { ...cfg, home: { ...cfg.home, starters: cfg.home.starters.map((p) => ({ ...p, preferredFoot: "left" as const })) } }
+    const left = (ps: MatchConfig["home"]["starters"]) => ps.map((p) => ({ ...p, preferredFoot: "left" as const }))
+    const lefty = { ...cfg, home: { ...cfg.home, starters: left(cfg.home.starters), bench: left(cfg.home.bench ?? []) } }
     const m = play(lefty)
     const kicks = m.events.filter((e) => (e.type === "pass" || e.type === "shot") && e.team_id === cfg.home.id && e.attrs.technique !== "throw")
-    const left = kicks.filter((e) => e.attrs.body_part === "left_foot").length
-    expect(left / kicks.length).toBeGreaterThan(0.7)
-    expect(left / kicks.length).toBeLessThan(0.95)
+    const share = kicks.filter((e) => e.attrs.body_part === "left_foot").length / kicks.length
+    expect(share).toBeGreaterThan(0.7)
+    expect(share).toBeLessThan(0.95)
   })
 })
PATCH
```

- [ ] **Step 2: Run them to make sure they fail**

Run: `pnpm --filter @touchline/sim-core test touch`
Expected: 3 failed (`TypeError: firstTouchError is not a function`, no bad touches, no ground duels); `a bad touch leaves the ball loose…` passes vacuously because every touch is still controlled

- [ ] **Step 3: Implement**

Create `packages/sim-core/src/touch.ts`:

```ts
import { add, norm, scale, type Vec2, type Vec3 } from "./geometry.js"
import type { Params } from "./params.js"
import type { Rng } from "./rng.js"
import type { BallState } from "./types.js"

export type FirstTouch = "controlled" | "heavy" | "miscontrol" | "missed"

export interface TouchInput {
  /** Ball speed at contact (m/s). */
  readonly speed: number
  /** Ball height at contact (m). */
  readonly height: number
  /** 0..1 from the nearest opponent's distance (see pressureFrom). */
  readonly pressure: number
  /** 0..1 receiving skill (dribbling and composure). */
  readonly skill: number
}

const sigmoid = (z: number): number => 1 / (1 + Math.exp(-z))

/** Probability that a reception is not controlled: rises with ball speed, height and pressure, falls with skill. */
export const firstTouchError = (t: TouchInput, p: Params): number => {
  const c = p.firstTouch
  const high = Math.max(0, Math.min(1, (t.height - 0.5) / 1.5))
  return sigmoid(c.b0 + (c.bSpeed * (t.speed - 12)) / 10 + c.bHigh * high + c.bPressure * t.pressure + c.bSkill * (t.skill - 0.6))
}

/** Draw the first touch: an error with probability `pError`, split into heavy, miscontrol and missed. */
export const drawFirstTouch = (pError: number, rng: Rng, p: Params): FirstTouch => {
  if (!rng.chance(pError)) return "controlled"
  const u = rng.uniform()
  return u < p.firstTouch.missedShare ? "missed" : u < p.firstTouch.missedShare + p.firstTouch.miscontrolShare ? "miscontrol" : "heavy"
}

/**
 * The loose ball after a bad touch at `at`: a heavy touch runs on 4-7 m/s in the ball's direction, a miscontrol
 * bounces off at an angle, a missed ball carries on at 60 % of its speed.
 */
export const ballAfterTouch = (kind: Exclude<FirstTouch, "controlled">, at: Vec2, vel: Vec3, rng: Rng): BallState => {
  const dir = norm({ x: vel.x, y: vel.y })
  if (kind === "missed") return { pos: { ...add(at, scale(dir, 0.6)), z: 0.2 }, vel: { x: vel.x * 0.6, y: vel.y * 0.6, z: Math.max(0, vel.z * 0.6) } }
  const turn = kind === "heavy" ? rng.range(-0.3, 0.3) : rng.range(-1.8, 1.8)
  const c = Math.cos(turn), s = Math.sin(turn)
  const d = { x: dir.x * c - dir.y * s, y: dir.x * s + dir.y * c }
  const speed = kind === "heavy" ? rng.range(4, 7) : rng.range(3, 8)
  return { pos: { ...add(at, scale(d, 0.6)), z: 0 }, vel: { x: d.x * speed, y: d.y * speed, z: kind === "heavy" ? 0 : rng.range(0, 1) } }
}
```

Apply this change to `packages/sim-core/src/index.ts`, `packages/sim-core/src/params.ts`, `packages/sim-core/src/types.ts`, `packages/sim-core/src/step.ts`, `packages/sim/src/cdf.ts`, `packages/schema/src/domain.ts` (from the repository root):

```bash
git apply <<'PATCH'
diff --git a/packages/schema/src/domain.ts b/packages/schema/src/domain.ts
index 11595af..2d53c27 100644
--- a/packages/schema/src/domain.ts
+++ b/packages/schema/src/domain.ts
@@ -3,7 +3,7 @@ import { Schema } from "effect"
 export const EventType = Schema.Literals([
   "match_start", "period_start", "period_end", "match_end", "pass", "reception", "carry", "take_on", "shot", "goal",
   "keeper_save", "keeper_distribution", "aerial_duel", "pressure", "tackle", "interception", "block", "clearance",
-  "ball_recovery", "possession_change", "ball_out", "foul", "card", "offside", "set_piece", "off_ball_run", "substitution"
+  "ball_recovery", "possession_change", "ball_out", "foul", "card", "offside", "set_piece", "off_ball_run", "substitution", "ground_duel"
 ])
 export const Period = Schema.Literals(["first_half", "second_half"])
 export const OptionRecord = Schema.Struct({
diff --git a/packages/sim-core/src/index.ts b/packages/sim-core/src/index.ts
index acd5074..fcaf928 100644
--- a/packages/sim-core/src/index.ts
+++ b/packages/sim-core/src/index.ts
@@ -12,3 +12,4 @@ export * from "./shape.js"
 export * from "./shot.js"
 export * from "./step.js"
 export * from "./types.js"
+export * from "./touch.js"
diff --git a/packages/sim-core/src/params.ts b/packages/sim-core/src/params.ts
index 2428c92..cc5cef3 100644
--- a/packages/sim-core/src/params.ts
+++ b/packages/sim-core/src/params.ts
@@ -127,6 +127,13 @@ export interface Params {
    */
   readonly fatigue: { readonly drainBase: number; readonly drainSpeed2: number; readonly staminaSlope: number; readonly halfTimeRecovery: number; readonly executionK: number }
   /** Substitution policy: planned windows (match minute, mean and SD), players per window, chance of a half-time change. */
+  /**
+   * First touch on a reception: P(error) = sigmoid(b0 + bSpeed x (speed - 12) / 10 + bHigh x height share + bPressure x pressure + bSkill x (skill - 0.6));
+   * errors split into missed, miscontrol and (the rest) heavy.
+   */
+  readonly firstTouch: { readonly b0: number; readonly bSpeed: number; readonly bHigh: number; readonly bPressure: number; readonly bSkill: number; readonly missedShare: number; readonly miscontrolShare: number }
+  /** Loose balls two opponents can both reach are decided by a ground duel: logit = bSkill x skill difference + bReach x reach advantage (m). */
+  readonly groundDuel: { readonly bSkill: number; readonly bReach: number; readonly contestM: number }
   readonly substitutions: { readonly windowMinutes: readonly [number, number, number]; readonly windowSdMin: number; readonly perWindow: readonly [number, number, number]; readonly halfTimeChance: number }
   readonly classifier: ClassifierThresholds
 }
@@ -209,6 +216,8 @@ export const DEFAULT_PARAMS: Params = {
   movement: { shapeSpeedShare: 0.7 },
   shape: { width: 1, depth: 1 },
   fatigue: { drainBase: 0.00004, drainSpeed2: 0.000012, staminaSlope: 0.8, halfTimeRecovery: 0.1, executionK: 0.25 },
+  firstTouch: { b0: -3.9, bSpeed: 1.0, bHigh: 1.2, bPressure: 1.5, bSkill: -3.5, missedShare: 0.15, miscontrolShare: 0.35 },
+  groundDuel: { bSkill: 3, bReach: 2, contestM: 0.6 },
   substitutions: { windowMinutes: [62, 72, 81], windowSdMin: 5, perWindow: [2, 2, 1], halfTimeChance: 0.2 },
   classifier: {
     longPassM: 32,
diff --git a/packages/sim-core/src/step.ts b/packages/sim-core/src/step.ts
index 68b3f8d..174e4aa 100644
--- a/packages/sim-core/src/step.ts
+++ b/packages/sim-core/src/step.ts
@@ -1,7 +1,7 @@
 import { stepBall } from "./ball.js"
 import { decide, lastDefenderAttackX, nearestOpponent, type Decision } from "./decide.js"
 import { buildEvent, round2 } from "./events.js"
-import { executeKick } from "./execute.js"
+import { executeKick, pressureFrom } from "./execute.js"
 import {
   add,
   attackX,
@@ -25,6 +25,7 @@ import { goalLineCrossing, resolveFlight } from "./resolve.js"
 import { hazard, Rng, substream } from "./rng.js"
 import { anchorFor, kickoffAnchor } from "./shape.js"
 import { parryBall, planShot } from "./shot.js"
+import { ballAfterTouch, drawFirstTouch, firstTouchError, type FirstTouch } from "./touch.js"
 import {
   CONCERNS,
   type AttrValue,
@@ -705,7 +706,20 @@ const ownedTick = (w: Work): void => {
 
 const resolveFlightNow = (w: Work, f: Flight): void => {
   w.emit(f.pending, { frame_id_end: f.resolveTick, outcome: f.outcome })
-  for (const e of f.extra) w.emit(e)
+  // The receiver's first touch is decided now, at contact, from the ball as it arrives and the pressure on them.
+  let touch: FirstTouch | null = null
+  for (const e of f.extra) {
+    if (e.type !== "reception" || !f.winnerId) {
+      w.emit(e)
+      continue
+    }
+    const r = w.player(f.winnerId)
+    const opp = nearestOpponent(r.pos, w.active(other(r.side)))
+    const pressure = pressureFrom(opp ? dist(opp.pos, r.pos) : 50)
+    const speed = Math.hypot(w.ball.vel.x, w.ball.vel.y, w.ball.vel.z)
+    touch = drawFirstTouch(firstTouchError({ speed, height: w.ball.pos.z, pressure, skill: (r.attrs.dribbling + r.attrs.composure) / 2 }, w.p), w.rng.execution, w.p)
+    w.emit({ ...e, attrs: { ...e.attrs, first_touch: touch, under_pressure: pressure > 0.3, lost_possession: touch === "controlled" ? false : null } })
+  }
   const goal = f.extra.find((e) => e.type === "goal")
   if (goal) w.score[goal.team_id === w.teamId("home") ? "home" : "away"] += 1
   if (f.restartAfter) {
@@ -719,6 +733,14 @@ const resolveFlightNow = (w: Work, f: Flight): void => {
     w.possession = { kind: "loose" }
     return
   }
+  if (f.winnerId && touch !== null && touch !== "controlled") {
+    const r = w.player(f.winnerId)
+    w.ball = ballAfterTouch(touch, r.pos, w.ball.vel, w.rng.execution)
+    w.possession = { kind: "loose", noTouchId: r.id, noTouchUntil: w.tick + Math.round(0.4 / w.dt) }
+    w.lastTouch = { playerId: r.id, side: r.side }
+    w.pressedBy = []
+    return
+  }
   if (f.winnerId) {
     const winner = w.player(f.winnerId)
     w.possession = { kind: "owned", playerId: winner.id, since: w.tick, restart: null }
@@ -777,9 +799,23 @@ const ballTick = (w: Work): void => {
     return
   }
   if (w.ball.pos.z > w.p.kinematics.controlHeightM) return
-  const near = w.active().filter((pl) => dist(pl.pos, flat) <= w.p.kinematics.reachM).sort((a, b) => dist(a.pos, flat) - dist(b.pos, flat))
-  const first = near[0]
-  if (first) changePossession(w, first, w.pending("ball_recovery", first, flat, { kind: "loose_ball" }))
+  const blocked = pos.noTouchId !== undefined && w.tick < (pos.noTouchUntil ?? 0) ? pos.noTouchId : null
+  const reach = w.p.kinematics.reachM
+  const eligible = w.active().filter((pl) => pl.id !== blocked).sort((a, b) => dist(a.pos, flat) - dist(b.pos, flat))
+  const first = eligible[0]
+  if (!first || dist(first.pos, flat) > reach) return
+  // An opponent who can also get there contests it: a ground duel decides who comes away with the ball.
+  const rival = eligible.find((pl) => pl.side !== first.side && dist(pl.pos, flat) <= reach + w.p.groundDuel.contestM)
+  let winner = first
+  if (rival) {
+    const g = w.p.groundDuel
+    const skill = (pl: PlayerState) => (pl.attrs.tackling + pl.attrs.dribbling) / 2
+    const pFirst = 1 / (1 + Math.exp(-(g.bSkill * (skill(first) - skill(rival)) + g.bReach * (dist(rival.pos, flat) - dist(first.pos, flat)))))
+    winner = w.rng.duel.chance(pFirst) ? first : rival
+    const loser = winner === first ? rival : first
+    w.emit(w.pending("ground_duel", winner, flat, { kind: "loose_ball", winner_id: winner.id, loser_id: loser.id }))
+  }
+  changePossession(w, winner, w.pending("ball_recovery", winner, flat, { kind: "loose_ball" }))
 }
 
 // ---------------------------------------------------------------- movement
diff --git a/packages/sim-core/src/types.ts b/packages/sim-core/src/types.ts
index 3bba37c..7fd4c79 100644
--- a/packages/sim-core/src/types.ts
+++ b/packages/sim-core/src/types.ts
@@ -142,7 +142,8 @@ export type FlightOutcome =
 export type Possession =
   | { readonly kind: "owned"; readonly playerId: string; readonly since: number; readonly restart: RestartKind | null }
   | { readonly kind: "in_flight"; readonly flight: Flight }
-  | { readonly kind: "loose" }
+  /** A loose ball; after a bad first touch the toucher cannot play it again until `noTouchUntil` (global tick). */
+  | { readonly kind: "loose"; readonly noTouchId?: string; readonly noTouchUntil?: number }
   | { readonly kind: "dead" }
 
 export type RestartKind = "kickoff" | "throw_in" | "corner" | "goal_kick" | "free_kick" | "penalty"
@@ -186,6 +187,7 @@ export type EventType =
   | "set_piece"
   | "off_ball_run"
   | "substitution"
+  | "ground_duel"
 
 /** One alternative the player could have chosen, recorded at the moment of decision. */
 export interface OptionRecord {
diff --git a/packages/sim/src/cdf.ts b/packages/sim/src/cdf.ts
index bd9b0ec..d006c4d 100644
--- a/packages/sim/src/cdf.ts
+++ b/packages/sim/src/cdf.ts
@@ -118,6 +118,7 @@ export const cdfTypeOf = (e: DomainEvent): CdfType => {
     case "carry":
     case "take_on":
     case "aerial_duel":
+    case "ground_duel":
     case "ball_recovery":
       return { type: "misc", sub_type: "other_ball_action", outcome_type: a.outcome === "lost" ? "unsuccessful" : "successful", is_successful: a.outcome !== "lost" }
     case "foul":
PATCH
```

- [ ] **Step 4: Run the tests**

Run: `pnpm --filter @touchline/sim-core test touch record`
Expected: 10 passed

- [ ] **Step 5: Run everything**

Run: `pnpm turbo run typecheck test --force`
Expected: `Tasks: 10 successful`; the realism gate passes (about `"loss":8.1`)

Run: `pnpm sim --seed 1 --home ironmoor --away saltmarsh && uv run --project python/analytics python -m touchline_analytics.validate_cdf out/m-1`
Expected: CDF valid; about 3 % of receptions in `domain.jsonl` have a `first_touch` other than `controlled`, and about 30 `ground_duel` events

- [ ] **Step 6: Commit**

```bash
git add packages
git commit -m "feat(sim-core): first-touch errors and loose-ball ground duels

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```



### Task 6: Wide play: blocks, keeper claims, headed and sliced clearances, deflections behind

Corners came almost only from parried saves (about 2 per match against 8 in real matches): nothing ever went behind off a defender. The defending side now acts on wide play: a defender within 4 m of a crosser blocks the cross (60 % of blocks deflect behind); keepers come for high balls dropping within 13 m of their line and 11 m of them (catch, punch or fumble, by handling); defenders head high balls away from their own third (35 % of those within 20 m of their line glance behind); blocked shots (now likelier: defenders near the line and the one closing the shooter down) deflect behind half the time; a clearance from inside the box is sometimes sliced behind; wide clearances are often kicked into touch. A deflection behind is a short straight flight to a point 2.5 m beyond the line and wide of the posts (nobody can intercept it, so it really gives a corner); other deflections head away from the deflector's goal (random ones produced own goals). The deflector cannot play the ball again for 0.4 s. A keeper holding the ball in their box can be pressed, not tackled, and keepers no longer try to dribble past attackers.

**Files:**
- Create: `packages/sim-core/src/deflect.ts`
- Modify: `packages/sim-core/src/index.ts`, `packages/sim-core/src/params.ts`, `packages/sim-core/src/types.ts`, `packages/sim-core/src/shot.ts`, `packages/sim-core/src/decide.ts`, `packages/sim-core/src/step.ts`, `packages/sim/src/cdf.ts`, `packages/schema/src/domain.ts`
- Regenerate: `data/params/realism-baseline.json`
- Test: `packages/sim-core/test/wide.test.ts` (new; uses the committed calibrated parameters, because the hand-set priors cross very little), `packages/sim/test/cdf.test.ts` (one new case)

**Interfaces:**
- Consumes: Task 5's engine (`noTouchId`), `resolveFlight`, `vmaxFor`.
- Produces: `inOwnBox(side, at)`, `behindPoint(defSide, at, rng)`, `DEFLECT_SPEED` (14 m/s), `clearAway(defSide, at, rng, strength?)`, `type KeeperAction`, `keeperCanCome(keeper, at, t, p)`, `keeperAction(keeper, p, rng)`, `deflectLoose(side, at, rng, speed?, up?)`, `crossBlocker(crosser, opponents, p)`; params `shot.{blockWidthM, blockPressure, blockBehind}`, `defending.{crossBlock, crossBlockM, crossBlockBehind, headClearShare, headBehind, clearToTouch, clearSliceBehind}`, `keeper.{claimRangeM, claimDepthM, comeShare, catchBase, catchHandling, fumbleShare}`; `Flight.deflectTo`; `ActionKind` gains `deflection`; event types `keeper_claim` (`from`, `handling`) and `keeper_punch` (`from`), CDF `goalkeeping/claim` and `goalkeeping/punch`; headed clearances carry `technique: head`, `body_part: head`; sliced clearances `execution: sliced`; `planShot` blocks by distance from the shot line plus a pressure block.

- [ ] **Step 1: Write the failing tests**

Create `packages/sim-core/test/wide.test.ts`:

```ts
import { readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "vitest"
import { attackX, initMatch, isFinished, paramsFromJson, PITCH, step, type DomainEvent, type MatchConfig } from "../src/index.js"
import { makeConfig } from "../src/testing.js"

// Wide play needs the calibrated style mix (the hand-set priors cross very little).
const root = join(dirname(fileURLToPath(import.meta.url)), "../../..")
const params = paramsFromJson(JSON.parse(readFileSync(join(root, "data/params/touchline-params.json"), "utf8")))

const play = (cfg: MatchConfig) => {
  let s = initMatch(cfg)
  const events: DomainEvent[] = []
  while (!isFinished(s)) { const r = step(s); s = r.state; events.push(...r.events) }
  return events
}
const runs = [1, 2, 3, 4, 5, 6].map((seed) => ({ cfg: makeConfig(seed, { params }), events: play(makeConfig(seed, { params })) }))
const sideOf = (cfg: MatchConfig, teamId: string | null) => (teamId === cfg.home.id ? "home" : "away")
/** True when (x, y) is inside the penalty area that `side` defends. */
const inOwnBox = (side: "home" | "away", x: number, y: number) => attackX(side, x) < -(PITCH.halfL - PITCH.boxDepth) && Math.abs(y) < PITCH.boxHalfWidth

describe("high balls into the box", () => {
  it("keepers claim or punch some of them, in their own box, from crosses and set pieces", () => {
    let claims = 0, punches = 0
    for (const r of runs) {
      for (const e of r.events.filter((x) => x.type === "keeper_claim" || x.type === "keeper_punch")) {
        const gk = [r.cfg.home, r.cfg.away].flatMap((t) => [...t.starters, ...(t.bench ?? [])]).find((p) => p.id === e.player_id)!
        expect(gk.role).toBe("GK")
        expect(inOwnBox(sideOf(r.cfg, e.team_id), e.x!, e.y!), e.id).toBe(true)
        expect(["cross", "corner", "free_kick"]).toContain(e.attrs.from)
        if (e.type === "keeper_claim") claims++
        else punches++
      }
    }
    expect(claims).toBeGreaterThan(5)
    expect(punches).toBeGreaterThan(2)
  })
  it("a claim gives the keeper the ball; a punch leaves it loose", () => {
    for (const r of runs) {
      r.events.forEach((e, i) => {
        if (e.type !== "keeper_claim" && e.type !== "keeper_punch") return
        const next = r.events.slice(i + 1).find((x) => ["pass", "clearance", "ball_recovery", "keeper_distribution", "ball_out", "ground_duel", "goal", "period_end"].includes(x.type))
        if (e.type === "keeper_claim" && e.attrs.handling === "clean" && next && next.type !== "period_end") expect(next.player_id === e.player_id || next.type === "ball_out", e.id).toBe(true)
        if (e.type === "keeper_punch" && next?.type === "ball_recovery") expect(next.frame_id).toBeGreaterThan(e.frame_id)
      })
    }
  })
  it("nobody tackles a keeper holding the ball in their own box", () => {
    for (const r of runs) {
      const keepers = new Set([r.cfg.home.starters[0]!.id, r.cfg.away.starters[0]!.id, ...[r.cfg.home, r.cfg.away].flatMap((t) => (t.bench ?? []).filter((b) => b.role === "GK").map((b) => b.id))])
      for (const e of r.events.filter((x) => x.type === "tackle" && keepers.has(x.attrs.opponent_id as string))) {
        const keeperSide = sideOf(r.cfg, e.team_id) === "home" ? "away" : "home"
        expect(inOwnBox(keeperSide, e.x!, e.y!), `${e.id} tackles keeper ${e.attrs.opponent_id} in the box`).toBe(false)
      }
    }
  })
  it("defenders head high balls away from their own third", () => {
    const heads = runs.flatMap((r) => r.events.filter((e) => e.type === "clearance" && e.attrs.technique === "head").map((e) => ({ r, e })))
    expect(heads.length).toBeGreaterThan(10)
    for (const { r, e } of heads) expect(attackX(sideOf(r.cfg, e.team_id), e.x!), e.id).toBeLessThan(-17.5)
  })
  it("some crosses are blocked", () => {
    const blocks = runs.flatMap((r) => r.events.filter((e) => e.type === "block" && e.attrs.blocked === "cross"))
    expect(blocks.length).toBeGreaterThan(5)
  })
})

describe("deflections", () => {
  it("send some balls straight behind for corners (blocks, headers, sliced clearances)", () => {
    let fromDeflection = 0
    for (const r of runs) {
      r.events.forEach((e, i) => {
        if (e.type !== "set_piece" || e.attrs.kind !== "corner") return
        const before = r.events.slice(0, i).reverse().find((x) => ["block", "clearance", "keeper_save", "keeper_punch", "pass", "shot", "interception"].includes(x.type))
        if (before && (before.type === "block" || before.type === "clearance")) fromDeflection++
      })
    }
    expect(fromDeflection).toBeGreaterThan(3)
  })
  it("a ball deflected behind travels straight out and the restart is a corner to the attacking side", () => {
    for (const r of runs) {
      r.events.forEach((e, i) => {
        if (e.type !== "ball_out" || e.attrs.side !== "byline") return
        const next = r.events.slice(i + 1).find((x) => x.type === "set_piece")
        if (next?.attrs.kind === "corner") expect(next.team_id, e.id).not.toBe(e.attrs.last_touch_team)
      })
    }
  })
  it("deflected shots rarely end in own goals", () => {
    const own = runs.reduce((n, r) => n + r.events.filter((e) => e.type === "goal" && e.attrs.own_goal === true).length, 0)
    expect(own / runs.length).toBeLessThan(0.3)
  })
})
```

Apply this change to `packages/sim/test/cdf.test.ts` (from the repository root):

```bash
git apply <<'PATCH'
diff --git a/packages/sim/test/cdf.test.ts b/packages/sim/test/cdf.test.ts
index 34b6796..fcd26e9 100644
--- a/packages/sim/test/cdf.test.ts
+++ b/packages/sim/test/cdf.test.ts
@@ -61,6 +61,14 @@ describe("CDF export", () => {
     expect(line.event).toMatchObject({ type: "referee", sub_type: "substitution", official_id: REFEREE_ID })
     expect(line.event.player_id).toBeUndefined()
   })
+  it("maps keeper claims and punches to goalkeeping events, and headed clearances keep the head as body part", () => {
+    const base = events.find((e) => e.type === "pass")!
+    expect(cdfTypeOf({ ...base, type: "keeper_claim", attrs: { from: "cross", handling: "clean" } })).toEqual({ type: "goalkeeping", sub_type: "claim", outcome_type: "claim", is_successful: true })
+    expect(cdfTypeOf({ ...base, type: "keeper_claim", attrs: { from: "cross", handling: "fumble" } })!.is_successful).toBe(false)
+    expect(cdfTypeOf({ ...base, type: "keeper_punch", attrs: { from: "corner" } })).toEqual({ type: "goalkeeping", sub_type: "punch", outcome_type: "punch", is_successful: true })
+    const header = { ...base, type: "clearance" as const, attrs: { technique: "head", body_part: "head" } }
+    expect(JSON.parse(cdfEventLine(cfg, header, clock, start, null)!).event.body_part).toBe("head")
+  })
   it("event tracking frame ids are period-relative", () => {
     const pass = events.find((e) => e.type === "pass" && e.period === "second_half")!
     const line = JSON.parse(cdfEventLine(cfg, pass, clock, start, pass.frame_id_end)!)
PATCH
```

- [ ] **Step 2: Run them to make sure they fail**

Run: `pnpm --filter @touchline/sim-core test wide`
Expected: failures: no keeper claims or punches, no headed clearances, no blocked crosses, no corners from deflections, and `… tackles keeper … in the box`

- [ ] **Step 3: Write the deflection helpers**

Create `packages/sim-core/src/deflect.ts`:

```ts
import { attackX, dirOf, dist, PITCH, type Side, type Vec2, type Vec3 } from "./geometry.js"
import { vmaxFor } from "./kinematics.js"
import type { Params } from "./params.js"
import type { Rng } from "./rng.js"
import type { BallState, PlayerState } from "./types.js"

/** True when `at` is inside the penalty area that `side` defends. */
export const inOwnBox = (side: Side, at: Vec2): boolean =>
  attackX(side, at.x) < -(PITCH.halfL - PITCH.boxDepth) && Math.abs(at.y) < PITCH.boxHalfWidth

/**
 * Where a deflection behind `defSide`'s own goal line ends up: 2.5 m beyond the line and wide of the posts,
 * roughly straight back from `at` (it gives a corner). The ball travels there directly (see DEFLECT_SPEED).
 */
export const behindPoint = (defSide: Side, at: Vec2, rng: Rng): Vec3 => {
  const sy = at.y === 0 ? (rng.chance(0.5) ? 1 : -1) : Math.sign(at.y)
  const wide = PITCH.goalHalfWidth + 1.5
  const ty = Math.abs(at.y) > wide + 3 ? at.y + rng.range(-4, 4) : sy * (wide + rng.range(0, 8))
  return { x: -dirOf(defSide) * (PITCH.halfL + 2.5), y: Math.abs(ty) < wide ? sy * wide : Math.max(-PITCH.halfW + 1, Math.min(PITCH.halfW - 1, ty)), z: rng.range(0.3, 2.5) }
}

/** Speed of a deflection (m/s). */
export const DEFLECT_SPEED = 14

/** A ball knocked loose by `toucher`'s side at `at`: any direction except back towards that side's own goal. */
export const deflectLoose = (toucherSide: Side, at: Vec2, rng: Rng, speed: readonly [number, number] = [4, 10], up: readonly [number, number] = [0, 1.5]): BallState => {
  const away = dirOf(toucherSide) > 0 ? 0 : Math.PI
  const ang = away + rng.range(-1.9, 1.9)
  const sp = rng.range(speed[0], speed[1])
  return { pos: { x: at.x, y: at.y, z: 0.2 }, vel: { x: Math.cos(ang) * sp, y: Math.sin(ang) * sp, z: rng.range(up[0], up[1]) } }
}

/** A header or punch away from `defSide`'s goal: high and long, towards the opponent's half. */
export const clearAway = (defSide: Side, at: Vec3, rng: Rng, strength = 1): BallState => ({
  pos: { x: at.x, y: at.y, z: Math.max(0.5, at.z) },
  vel: { x: dirOf(defSide) * rng.range(8, 15) * strength, y: rng.range(-9, 9) * strength, z: rng.range(4, 9) * strength }
})

export type KeeperAction = "claim" | "punch" | "fumble"

/**
 * Whether `keeper` can come for a high ball meeting the contact point `at` in `t` seconds: inside their box,
 * within claimDepthM of the goal line, and close enough to get there.
 */
export const keeperCanCome = (keeper: PlayerState, at: Vec3, t: number, p: Params): boolean => {
  const k = p.keeper
  if (!inOwnBox(keeper.side, at)) return false
  if (PITCH.halfL + attackX(keeper.side, at.x) > k.claimDepthM) return false
  const reach = Math.min(k.claimRangeM, p.kinematics.reachM + 0.8 * vmaxFor(keeper.attrs, keeper.energy, p) * t)
  return dist(keeper.pos, at) <= reach
}

/** Catch, punch or fumble: safe hands catch more often. */
export const keeperAction = (keeper: PlayerState, p: Params, rng: Rng): KeeperAction => {
  const k = p.keeper
  if (rng.chance(k.catchBase + k.catchHandling * keeper.attrs.handling)) return "claim"
  return rng.chance(k.fumbleShare) ? "fumble" : "punch"
}

/**
 * The nearest outfield opponent close enough to the crosser to block the cross (within crossBlockM; a defender
 * closing down from the side or from behind can still get a leg to it), if any.
 */
export const crossBlocker = (crosser: PlayerState, opponents: ReadonlyArray<PlayerState>, p: Params): PlayerState | null => {
  let best: PlayerState | null = null
  let bd = Infinity
  for (const o of opponents) {
    if (o.sentOff || o.role === "GK") continue
    const d = dist(o.pos, crosser.pos)
    if (d <= p.defending.crossBlockM && d < bd) {
      best = o
      bd = d
    }
  }
  return best
}
```

- [ ] **Step 4: Wire them into the engine**

Apply this change to `packages/sim-core/src/index.ts`, `packages/sim-core/src/params.ts`, `packages/sim-core/src/types.ts`, `packages/sim-core/src/shot.ts`, `packages/sim-core/src/decide.ts`, `packages/sim-core/src/step.ts` (from the repository root):

```bash
git apply <<'PATCH'
diff --git a/packages/sim-core/src/decide.ts b/packages/sim-core/src/decide.ts
index 0af8344..e9636c1 100644
--- a/packages/sim-core/src/decide.ts
+++ b/packages/sim-core/src/decide.ts
@@ -199,7 +199,8 @@ export const decide = (input: DecisionInput, p: Params, rng: Rng): Decision => {
       case "hold":
         return input.restart === null
       case "take_on":
-        return input.restart === null && opp !== null && oppDist < 4
+        // Keepers do not try to dribble past attackers.
+        return input.restart === null && opp !== null && oppDist < 4 && owner.role !== "GK"
       case "clear":
         return input.restart === null && ax < -10
       default:
diff --git a/packages/sim-core/src/index.ts b/packages/sim-core/src/index.ts
index fcaf928..23db50b 100644
--- a/packages/sim-core/src/index.ts
+++ b/packages/sim-core/src/index.ts
@@ -13,3 +13,4 @@ export * from "./shot.js"
 export * from "./step.js"
 export * from "./types.js"
 export * from "./touch.js"
+export * from "./deflect.js"
diff --git a/packages/sim-core/src/params.ts b/packages/sim-core/src/params.ts
index cc5cef3..3ea0318 100644
--- a/packages/sim-core/src/params.ts
+++ b/packages/sim-core/src/params.ts
@@ -93,7 +93,15 @@ export interface Params {
     readonly onTargetRate: number
     /** Multiplier on shot aiming error (calibration knob for on-target share). */
     readonly aimNoise: number
+    /**
+     * Each outfield defender within blockWidthM of the shot's line blocks it with probability blockPerDefender x (1 - distance / blockWidthM);
+     * the defender closing the shooter down blocks with probability blockPressure x pressure.
+     */
     readonly blockPerDefender: number
+    readonly blockWidthM: number
+    readonly blockPressure: number
+    /** Share of blocked shots deflected behind the goal line (corners). */
+    readonly blockBehind: number
   }
   readonly defending: {
     readonly pressRatePerS: number
@@ -113,6 +121,26 @@ export interface Params {
     readonly boxFoulFactor: number
     /** Keeper comes off the line to close down a ball carrier within this distance of goal (m). */
     readonly keeperRushM: number
+    /** Chance that a defender within crossBlockM of the crosser blocks the cross; share of blocks deflected behind. */
+    readonly crossBlock: number
+    readonly crossBlockM: number
+    readonly crossBlockBehind: number
+    /** Share of high balls won by defenders in their own third that are headed away (else controlled); share of those within 20 m of their goal line glanced behind. */
+    readonly headClearShare: number
+    readonly headBehind: number
+    /** Share of clearances from wide positions kicked into touch on purpose. */
+    readonly clearToTouch: number
+    /** Share of clearances from inside a team's own box that are sliced behind for a corner (a defensive slip). */
+    readonly clearSliceBehind: number
+  }
+  /** Keepers coming for high balls: reach (m) and depth from the goal line (m), how often they come, catch vs punch vs fumble. */
+  readonly keeper: {
+    readonly claimRangeM: number
+    readonly claimDepthM: number
+    readonly comeShare: number
+    readonly catchBase: number
+    readonly catchHandling: number
+    readonly fumbleShare: number
   }
   readonly takeOn: { readonly b0: number; readonly bSkill: number; readonly bPressure: number }
   readonly carry: { readonly speed: number; readonly durationS: readonly [number, number] }
@@ -193,7 +221,10 @@ export const DEFAULT_PARAMS: Params = {
     speed: 26,
     onTargetRate: 0.38,
     aimNoise: 1.0,
-    blockPerDefender: 0.15
+    blockPerDefender: 0.35,
+    blockWidthM: 3.5,
+    blockPressure: 0.3,
+    blockBehind: 0.5
   },
   defending: {
     pressRatePerS: 0.6,
@@ -208,8 +239,16 @@ export const DEFAULT_PARAMS: Params = {
     interceptLooseShare: 0.3,
     boxIntensity: 0,
     boxFoulFactor: 0.2,
-    keeperRushM: 12
+    keeperRushM: 12,
+    crossBlock: 0.6,
+    crossBlockM: 4.0,
+    crossBlockBehind: 0.6,
+    headClearShare: 0.85,
+    headBehind: 0.35,
+    clearToTouch: 0.2,
+    clearSliceBehind: 0.2
   },
+  keeper: { claimRangeM: 11, claimDepthM: 13, comeShare: 0.85, catchBase: 0.4, catchHandling: 0.35, fumbleShare: 0.06 },
   takeOn: { b0: -0.2, bSkill: 3.0, bPressure: -0.8 },
   carry: { speed: 5.5, durationS: [0.8, 2.0] },
   runs: { runInBehindRatePerS: 0.12 },
diff --git a/packages/sim-core/src/shot.ts b/packages/sim-core/src/shot.ts
index 3090441..a15ce0f 100644
--- a/packages/sim-core/src/shot.ts
+++ b/packages/sim-core/src/shot.ts
@@ -97,14 +97,19 @@ export const planShot = (
   const travel = (m: number) => Math.max(1, Math.ceil(m / speed / dt))
 
   if (!isPenalty) {
-    for (const o of opponents) {
-      if (o.sentOff || o.role === "GK") continue
-      const { d: off, t } = segmentDistance(shooter.pos, goal, o.pos)
-      if (off < 1.2 && t > 0.02 && t < 0.95 && rng.chance(p.shot.blockPerDefender)) {
-        const at: Vec3 = { x: o.pos.x, y: o.pos.y, z: 0.5 }
-        return { outcome: "blocked", ticks: travel(dist(shooter.pos, o.pos)), from, to: at, execution, onTarget: false, blockerId: o.id, keeperId: null, handling: null }
-      }
-    }
+    const blocked = (o: PlayerState): ShotPlan => ({
+      outcome: "blocked", ticks: travel(dist(shooter.pos, o.pos)), from, to: { x: o.pos.x, y: o.pos.y, z: 0.5 }, execution, onTarget: false, blockerId: o.id, keeperId: null, handling: null
+    })
+    // Defenders near the shot's line get in the way, the closer the likelier, nearest the shooter first...
+    const inLane = opponents
+      .filter((o) => !o.sentOff && o.role !== "GK")
+      .map((o) => ({ o, ...segmentDistance(shooter.pos, goal, o.pos) }))
+      .filter((x) => x.d < p.shot.blockWidthM && x.t > 0.02 && x.t < 0.95)
+      .sort((a, b) => a.t - b.t)
+    for (const x of inLane) if (rng.chance(p.shot.blockPerDefender * (1 - x.d / p.shot.blockWidthM))) return blocked(x.o)
+    // ...and the defender closing the shooter down can throw a body in the way.
+    const closer = opponents.filter((o) => !o.sentOff && o.role !== "GK").sort((a, b) => dist(a.pos, shooter.pos) - dist(b.pos, shooter.pos))[0]
+    if (closer && rng.chance(p.shot.blockPressure * pressure)) return blocked(closer)
   }
   const onTarget = Math.abs(y) < PITCH.goalHalfWidth && z < PITCH.goalHeight
   const keeper = opponents.find((o) => o.role === "GK" && !o.sentOff) ?? null
diff --git a/packages/sim-core/src/step.ts b/packages/sim-core/src/step.ts
index 174e4aa..7932cfc 100644
--- a/packages/sim-core/src/step.ts
+++ b/packages/sim-core/src/step.ts
@@ -1,6 +1,7 @@
 import { stepBall } from "./ball.js"
 import { decide, lastDefenderAttackX, nearestOpponent, type Decision } from "./decide.js"
 import { buildEvent, round2 } from "./events.js"
+import { behindPoint, clearAway, crossBlocker, DEFLECT_SPEED, deflectLoose, inOwnBox, keeperAction, keeperCanCome } from "./deflect.js"
 import { executeKick, pressureFrom } from "./execute.js"
 import {
   add,
@@ -465,9 +466,16 @@ const releaseKick = (w: Work, owner: PlayerState, d: Decision, restart: RestartK
   const side = owner.side
   const opps = w.active(other(side))
   const isClear = d.action === "clear"
-  const target: Vec2 = isClear
-    ? { x: owner.pos.x + dirOf(side) * w.rng.decision.range(30, 60), y: owner.pos.y + w.rng.decision.range(-35, 35) }
-    : d.candidate!.target
+  // A clearance from inside the box is sometimes sliced behind; from a wide position it is often kicked into touch on purpose.
+  const sliced = isClear && inOwnBox(side, owner.pos) && w.rng.execution.chance(p.defending.clearSliceBehind)
+  const toTouch = !sliced && isClear && Math.abs(owner.pos.y) > 8 && w.rng.decision.chance(p.defending.clearToTouch)
+  const target: Vec2 = sliced
+    ? (({ x, y }) => ({ x, y }))(behindPoint(side, owner.pos, w.rng.execution))
+    : toTouch
+    ? { x: owner.pos.x + dirOf(side) * w.rng.decision.range(10, 35), y: Math.sign(owner.pos.y) * (PITCH.halfW + w.rng.decision.range(2, 8)) }
+    : isClear
+      ? { x: owner.pos.x + dirOf(side) * w.rng.decision.range(30, 60), y: owner.pos.y + w.rng.decision.range(-35, 35) }
+      : d.candidate!.target
   const height = isClear ? "high" : d.candidate!.height
   const weakFoot = w.rng.execution.chance(0.2)
   const exe = executeKick(
@@ -487,6 +495,19 @@ const releaseKick = (w: Work, owner: PlayerState, d: Decision, restart: RestartK
         winner.id !== owner.id &&
         attackX(side, winner.pos.x) > Math.max(lastDef, attackX(side, owner.pos.x), 0) + 0.5
       : false
+  // What the defending side does about it: block the cross at the source, the keeper comes for a high ball,
+  // or a defender heads it away. Each is drawn only when it is possible.
+  const defSide = other(side)
+  const keeper = opps.find((o) => o.role === "GK") ?? null
+  const blocker = d.candidate?.kind === "cross" && restart === null ? crossBlocker(owner, opps, p) : null
+  const blocked = blocker !== null && w.rng.duel.chance(p.defending.crossBlock)
+  const contact = res.ball.pos
+  const keeperComes =
+    !blocked && height !== "ground" && keeper !== null && (res.result === "reached" || res.result === "stopped") && winner?.id !== keeper.id &&
+    keeperCanCome(keeper, contact, res.ticks * w.dt, p) && w.rng.duel.chance(p.keeper.comeShare)
+  const headsAway =
+    !blocked && !keeperComes && res.result === "reached" && winner !== null && winner.side === defSide && winner.role !== "GK" &&
+    contact.z > p.kinematics.controlHeightM && attackX(defSide, contact.x) < -17.5 && w.rng.duel.chance(p.defending.headClearShare)
   const kind = restart && restart !== "kickoff" ? "set_piece" : isClear ? null : d.candidate!.kind
   const attrs: Record<string, AttrValue> = {
     kind,
@@ -497,7 +518,7 @@ const releaseKick = (w: Work, owner: PlayerState, d: Decision, restart: RestartK
     intended_receiver_id: intended,
     intended_end_x: round2(target.x),
     intended_end_y: round2(target.y),
-    execution: exe.execution,
+    execution: sliced ? "sliced" : exe.execution,
     error_m: round2(exe.errorM),
     decision_quality: d.decisionQuality === null ? null : round2(d.decisionQuality),
     ...decisionAttrs(d),
@@ -506,15 +527,42 @@ const releaseKick = (w: Work, owner: PlayerState, d: Decision, restart: RestartK
     ball_speed_kmh: round2(len({ x: exe.vel.x, y: exe.vel.y }) * 3.6),
     xpass: d.candidate ? round2(d.candidate.xpass) : null
   }
-  const endAt = { x: res.ball.pos.x, y: res.ball.pos.y }
+  const endAt = blocked ? blocker!.pos : { x: res.ball.pos.x, y: res.ball.pos.y }
   const main = w.pending(isClear ? "clearance" : "pass", owner, owner.pos, attrs, endAt)
   const extra: PendingEvent[] = []
   let outcome: Flight["outcome"]
   let restartAfter: Flight["restartAfter"] = null
   let looseAfter: BallState | null = null
-  const tickAt = w.tick + res.ticks
+  const tickAt = blocked ? w.tick + Math.max(1, Math.round(dist(owner.pos, blocker!.pos) / 15 / w.dt)) : w.tick + res.ticks
   const at = (pe: PendingEvent): PendingEvent => ({ ...pe, frame_id: tickAt })
-  if (res.result === "goal") {
+  let keeperClaims = false
+  let deflectTo: Vec3 | null = null
+  if (blocked) {
+    outcome = "blocked"
+    extra.push(at(w.pending("block", blocker, blocker!.pos, { blocked: "cross" })))
+    if (w.rng.duel.chance(p.defending.crossBlockBehind)) deflectTo = behindPoint(defSide, blocker!.pos, w.rng.duel)
+    else looseAfter = deflectLoose(defSide, blocker!.pos, w.rng.duel, [3, 8], [0.5, 3])
+  } else if (keeperComes) {
+    outcome = "intercepted"
+    const act = keeperAction(keeper!, p, w.rng.duel)
+    const from = restart === "corner" ? "corner" : restart === "free_kick" ? "free_kick" : "cross"
+    const point = { x: contact.x, y: contact.y }
+    if (act === "punch") {
+      extra.push(at(w.pending("keeper_punch", keeper, point, { from })))
+      looseAfter = clearAway(defSide, contact, w.rng.duel, 0.8)
+    } else {
+      extra.push(at(w.pending("keeper_claim", keeper, point, { from, handling: act === "claim" ? "clean" : "fumble" })))
+      if (act === "fumble") looseAfter = { pos: contact, vel: { x: w.rng.duel.range(-3, 3), y: w.rng.duel.range(-3, 3), z: 0.3 } }
+      else keeperClaims = true
+    }
+  } else if (headsAway) {
+    outcome = "intercepted"
+    if (res.aerial) extra.push(at(w.pending("aerial_duel", winner, endAt, { winner_id: res.aerial.winnerId, loser_id: res.aerial.loserId })))
+    extra.push(at(w.pending("clearance", winner, endAt, { technique: "head", body_part: "head" })))
+    const nearOwnLine = attackX(defSide, contact.x) < -(PITCH.halfL - 20)
+    if (nearOwnLine && w.rng.duel.chance(p.defending.headBehind)) deflectTo = behindPoint(defSide, contact, w.rng.duel)
+    else looseAfter = clearAway(defSide, contact, w.rng.duel)
+  } else if (res.result === "goal") {
     // Into the net from a pass or clearance: a goal for whoever attacks that end (an own goal if it is not the passer's side).
     const scoringSide: Side = res.ball.pos.x > 0 ? "home" : "away"
     outcome = "goal"
@@ -536,11 +584,7 @@ const releaseKick = (w: Work, owner: PlayerState, d: Decision, restart: RestartK
     outcome = "intercepted"
     const deflect = !res.aerial && w.rng.duel.chance(w.p.defending.interceptLooseShare)
     extra.push(at(w.pending(res.aerial ? "aerial_duel" : "interception", winner, endAt, res.aerial ? { winner_id: res.aerial.winnerId, loser_id: res.aerial.loserId } : { ball: deflect ? "deflected" : "won" })))
-    if (deflect) {
-      const ang = w.rng.duel.range(0, 2 * Math.PI)
-      const sp = w.rng.duel.range(4, 10)
-      looseAfter = { pos: { x: endAt.x, y: endAt.y, z: 0 }, vel: { x: Math.cos(ang) * sp, y: Math.sin(ang) * sp, z: w.rng.duel.range(0, 1.5) } }
-    }
+    if (deflect) looseAfter = deflectLoose(winner.side, endAt, w.rng.duel)
   }
   const finalMain: PendingEvent = { ...main, attrs: { ...main.attrs, receiver_id: outcome === "successful" && winner ? winner.id : null } }
   if (res.aerial && outcome === "successful") extra.unshift(at(w.pending("aerial_duel", winner, endAt, { winner_id: res.aerial.winnerId, loser_id: res.aerial.loserId })))
@@ -553,17 +597,19 @@ const releaseKick = (w: Work, owner: PlayerState, d: Decision, restart: RestartK
       side,
       releaseTick: w.tick,
       resolveTick: tickAt,
-      winnerId: offside || looseAfter ? null : (winner?.id ?? null),
+      winnerId: keeperClaims ? keeper!.id : offside || looseAfter || deflectTo ? null : (winner?.id ?? null),
       outcome,
       pending: finalMain,
       extra,
       path: null,
       restartAfter,
-      looseBall: looseAfter
+      looseBall: looseAfter,
+      deflectTo
     }
   }
   w.lastTouch = { playerId: owner.id, side }
-  if (winner && !offside) w.setPlayer({ ...w.player(winner.id), intent: { kind: "chase", target: endAt }, intentUntil: tickAt })
+  const chaser = keeperComes ? keeper : blocked ? null : winner
+  if (chaser && !offside) w.setPlayer({ ...w.player(chaser.id), intent: { kind: "chase", target: endAt }, intentUntil: tickAt })
 }
 
 const releaseShot = (w: Work, owner: PlayerState, d: Decision, restart: RestartKind | null): void => {
@@ -588,6 +634,7 @@ const releaseShot = (w: Work, owner: PlayerState, d: Decision, restart: RestartK
   const extra: PendingEvent[] = []
   let restartAfter: Flight["restartAfter"] = null
   let looseBall: BallState | null = null
+  let deflectTo: Vec3 | null = null
   let winnerId: string | null = null
   if (plan.outcome === "goal") {
     extra.push(at(w.pending("goal", owner, end, { scorer_id: owner.id, own_goal: false })))
@@ -599,7 +646,8 @@ const releaseShot = (w: Work, owner: PlayerState, d: Decision, restart: RestartK
   } else if (plan.outcome === "blocked") {
     const blocker = w.player(plan.blockerId!)
     extra.push(at(w.pending("block", blocker, blocker.pos, { blocked: "shot" })))
-    looseBall = { pos: plan.to, vel: { x: -dirOf(side) * w.rng.duel.range(2, 8), y: w.rng.duel.range(-6, 6), z: w.rng.duel.range(0, 3) } }
+    if (w.rng.duel.chance(w.p.shot.blockBehind)) deflectTo = behindPoint(other(side), { x: plan.to.x, y: plan.to.y }, w.rng.duel)
+    else looseBall = { pos: plan.to, vel: { x: -dirOf(side) * w.rng.duel.range(2, 8), y: w.rng.duel.range(-6, 6), z: w.rng.duel.range(0, 3) } }
   } else {
     const keeper = w.player(plan.keeperId!)
     extra.push(at(w.pending("keeper_save", keeper, end, { technique: plan.handling === "clean" ? "catch" : "parry", handling: plan.handling })))
@@ -623,7 +671,8 @@ const releaseShot = (w: Work, owner: PlayerState, d: Decision, restart: RestartK
       extra,
       path: { from: plan.from, to: plan.to },
       restartAfter,
-      looseBall
+      looseBall,
+      deflectTo
     }
   }
   w.lastTouch = { playerId: owner.id, side }
@@ -698,14 +747,17 @@ const ownedTick = (w: Work): void => {
     w.possession = { kind: "loose" }
     return
   }
-  if (w.possession.restart === null && duels(w, owner)) return
+  // A keeper with the ball in their own box has it in their hands: they can be pressed, not challenged.
+  const inHands = owner.role === "GK" && inOwnBox(owner.side, owner.pos)
+  if (w.possession.restart === null && !inHands && duels(w, owner)) return
   if (w.tick >= owner.intentUntil) ownerDecision(w, w.player(owner.id))
 }
 
 // ---------------------------------------------------------------- flights and loose ball
 
 const resolveFlightNow = (w: Work, f: Flight): void => {
-  w.emit(f.pending, { frame_id_end: f.resolveTick, outcome: f.outcome })
+  // A deflection's "main event" is the ball going out; it has no outcome or end frame of its own.
+  w.emit(f.pending, f.kind === "deflection" ? {} : { frame_id_end: f.resolveTick, outcome: f.outcome })
   // The receiver's first touch is decided now, at contact, from the ball as it arrives and the pressure on them.
   let touch: FirstTouch | null = null
   for (const e of f.extra) {
@@ -726,11 +778,29 @@ const resolveFlightNow = (w: Work, f: Flight): void => {
     startRestart(w, f.restartAfter)
     return
   }
+  if (f.deflectTo) {
+    // Deflected straight out over the goal line: a short direct flight, then the restart (a corner).
+    const toucher = w.player(f.extra[0]!.player_id!)
+    const from = w.ball.pos
+    const ticks = Math.max(1, Math.ceil(Math.hypot(f.deflectTo.x - from.x, f.deflectTo.y - from.y) / DEFLECT_SPEED / w.dt))
+    const out = { x: f.deflectTo.x, y: f.deflectTo.y }
+    w.lastTouch = { playerId: toucher.id, side: toucher.side }
+    w.possession = {
+      kind: "in_flight",
+      flight: {
+        kind: "deflection", fromId: toucher.id, side: toucher.side, releaseTick: w.tick, resolveTick: w.tick + ticks, winnerId: null, outcome: "out_of_play",
+        pending: { ...w.pending("ball_out", null, out, { side: "byline", last_touch_team: w.teamId(toucher.side) }), frame_id: w.tick + ticks },
+        extra: [], path: { from, to: f.deflectTo }, restartAfter: restartFromOut(toucher.side, f.deflectTo), looseBall: null, deflectTo: null
+      }
+    }
+    return
+  }
   if (f.looseBall) {
+    // Whoever deflected it (block, header, punch, parry) cannot play it again straight away.
     const toucher = f.extra[0]?.player_id
     if (toucher) w.lastTouch = { playerId: toucher, side: w.player(toucher).side }
     w.ball = f.looseBall
-    w.possession = { kind: "loose" }
+    w.possession = toucher ? { kind: "loose", noTouchId: toucher, noTouchUntil: w.tick + Math.round(0.4 / w.dt) } : { kind: "loose" }
     return
   }
   if (f.winnerId && touch !== null && touch !== "controlled") {
diff --git a/packages/sim-core/src/types.ts b/packages/sim-core/src/types.ts
index 7fd4c79..c0650dc 100644
--- a/packages/sim-core/src/types.ts
+++ b/packages/sim-core/src/types.ts
@@ -104,7 +104,7 @@ export interface BallState {
   readonly vel: Vec3
 }
 
-export type ActionKind = "pass" | "shot" | "clearance"
+export type ActionKind = "pass" | "shot" | "clearance" | "deflection"
 
 /** A ball in flight whose outcome was resolved at release (see resolve.ts and shot.ts). */
 export interface Flight {
@@ -126,6 +126,8 @@ export interface Flight {
   readonly restartAfter: { readonly restart: RestartKind; readonly side: Side; readonly at: Vec2 } | null
   /** Ball state to set after resolution when the ball stays live but loose (parry, block). */
   readonly looseBall: BallState | null
+  /** After resolution the ball is deflected straight out over the goal line to this point (a corner). */
+  readonly deflectTo: Vec3 | null
 }
 
 export type FlightOutcome =
@@ -172,6 +174,8 @@ export type EventType =
   | "goal"
   | "keeper_save"
   | "keeper_distribution"
+  | "keeper_claim"
+  | "keeper_punch"
   | "aerial_duel"
   | "pressure"
   | "tackle"
PATCH
```

- [ ] **Step 5: Export the keeper events**

Apply this change to `packages/sim/src/cdf.ts`, `packages/schema/src/domain.ts` (from the repository root):

```bash
git apply <<'PATCH'
diff --git a/packages/schema/src/domain.ts b/packages/schema/src/domain.ts
index 2d53c27..5b6e79b 100644
--- a/packages/schema/src/domain.ts
+++ b/packages/schema/src/domain.ts
@@ -2,7 +2,7 @@ import { Schema } from "effect"
 
 export const EventType = Schema.Literals([
   "match_start", "period_start", "period_end", "match_end", "pass", "reception", "carry", "take_on", "shot", "goal",
-  "keeper_save", "keeper_distribution", "aerial_duel", "pressure", "tackle", "interception", "block", "clearance",
+  "keeper_save", "keeper_distribution", "keeper_claim", "keeper_punch", "aerial_duel", "pressure", "tackle", "interception", "block", "clearance",
   "ball_recovery", "possession_change", "ball_out", "foul", "card", "offside", "set_piece", "off_ball_run", "substitution", "ground_duel"
 ])
 export const Period = Schema.Literals(["first_half", "second_half"])
diff --git a/packages/sim/src/cdf.ts b/packages/sim/src/cdf.ts
index d006c4d..166322a 100644
--- a/packages/sim/src/cdf.ts
+++ b/packages/sim/src/cdf.ts
@@ -111,6 +111,10 @@ export const cdfTypeOf = (e: DomainEvent): CdfType => {
       return { type: "defending", sub_type: "pressing", outcome_type: "pressure", is_successful: true }
     case "block":
       return { type: "defending", sub_type: "block", outcome_type: "block", is_successful: true }
+    case "keeper_claim":
+      return { type: "goalkeeping", sub_type: "claim", outcome_type: "claim", is_successful: a.handling !== "fumble" }
+    case "keeper_punch":
+      return { type: "goalkeeping", sub_type: "punch", outcome_type: "punch", is_successful: true }
     case "keeper_save":
       return { type: "goalkeeping", sub_type: a.technique === "catch" ? "claim" : "save", outcome_type: "save", is_successful: true }
     case "tackle":
PATCH
```

- [ ] **Step 6: Run the tests**

Run: `pnpm --filter @touchline/sim-core test wide && pnpm --filter @touchline/sim test cdf && pnpm --filter @touchline/schema test`
Expected: 8 passed; 8 passed; 2 passed

- [ ] **Step 7: Run everything: the realism gate flags the intended change**

Run: `pnpm turbo run typecheck test --force`
Expected: one failure, in the realism gate: `corners drifted from the baseline: expected 9.57… to be less than 3.5` — corners moved towards the real value. The real-target part of the gate still holds (`"loss":9.55`)

- [ ] **Step 8: Refresh the realism baseline**

The gate's drift check exists to catch unintended changes; this one is intended, and Task 9 recalibrates. Record the new baseline:

Run: `UPDATE_REALISM_BASELINE=1 pnpm --filter @touchline/calibrate test realism-gate`
Expected: 1 passed. In `data/params/realism-baseline.json` corners go from about 1.6 to 6.1, goals from 3.4 to 2.3, throw-ins from 36.8 to 38.1

Run: `pnpm turbo run typecheck test --force && pnpm sim --seed 1 --home ironmoor --away saltmarsh && uv run --project python/analytics python -m touchline_analytics.validate_cdf out/m-1`
Expected: `Tasks: 10 successful`; CDF valid

- [ ] **Step 9: Commit**

```bash
git add packages data/params/realism-baseline.json
git commit -m "feat(sim-core): wide play — cross blocks, keeper claims and punches, headed and sliced clearances, deflections behind, clearances to touch

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```



### Task 7: Game state on scoring: minute profile and red cards

Spec §5.1.4: scoring intensity follows a minute profile (more goals late) and a red card changes the scoring rate (×0.67 for the team down to fewer players, ×1.2 for the opponent). Both multiply the chance that a shot scores, applied after the conversion floor so a factor of 0 really means no goals; recorded xG stays the model's value, and penalties are not scaled. The profile is a hand-set prior (15-minute bins 0.85, 0.95, 1.05, 0.95, 1.05, 1.15; mean 1; the last bin includes added time): 7 IDSSE matches hold too few goals to fit it, so it is refit from Wyscout goal minutes when that data is reachable.

**Files:**
- Create: `packages/sim-core/src/gamestate.ts`
- Modify: `packages/sim-core/src/index.ts`, `packages/sim-core/src/params.ts`, `packages/sim-core/src/shot.ts`, `packages/sim-core/src/step.ts`
- Test: `packages/sim-core/test/gamestate.test.ts`

**Interfaces:**
- Consumes: `planShot`, `Work.minute()`, `Work.active()`.
- Produces: `scoringFactor(minute, ownPlayers, opponentPlayers, p)`; `params.gameState {minuteProfile: [6 numbers], redCardOwn, redCardOpponent}`; `planShot(…, weakFoot = false, scoring = 1)`.

- [ ] **Step 1: Write the failing test**

Create `packages/sim-core/test/gamestate.test.ts`:

```ts
import { describe, expect, it } from "vitest"
import { DEFAULT_PARAMS, initMatch, isFinished, scoringFactor, step, type DomainEvent, type MatchConfig } from "../src/index.js"
import { makeConfig } from "../src/testing.js"

const P = DEFAULT_PARAMS

describe("scoring factor", () => {
  it("follows the minute profile: later goals are likelier", () => {
    expect(scoringFactor(85, 11, 11, P)).toBeGreaterThan(scoringFactor(10, 11, 11, P))
    expect(scoringFactor(95, 11, 11, P)).toBe(scoringFactor(85, 11, 11, P))
  })
  it("averages to 1 over a match at full strength", () => {
    const minutes = Array.from({ length: 90 }, (_, i) => i + 0.5)
    expect(minutes.reduce((s, m) => s + scoringFactor(m, 11, 11, P), 0) / 90).toBeCloseTo(1, 2)
  })
  it("scales by x0.67 for a team down to ten and x1.2 for its opponent", () => {
    const base = scoringFactor(50, 11, 11, P)
    expect(scoringFactor(50, 10, 11, P) / base).toBeCloseTo(0.67, 6)
    expect(scoringFactor(50, 11, 10, P) / base).toBeCloseTo(1.2, 6)
    expect(scoringFactor(50, 10, 10, P)).toBeCloseTo(base, 6)
  })
})

describe("in a match", () => {
  const play = (cfg: MatchConfig) => {
    let s = initMatch(cfg)
    const events: DomainEvent[] = []
    while (!isFinished(s)) { const r = step(s); s = r.state; events.push(...r.events) }
    return events
  }
  it("shots only score when the profile allows it", () => {
    const params = { ...P, gameState: { ...P.gameState, minuteProfile: [0, 0, 0, 0, 0, 6] as const } }
    for (const seed of [1, 2, 3, 4]) {
      const ev = play(makeConfig(seed, { params }))
      for (const e of ev.filter((x) => x.type === "shot" && x.outcome === "goal" && x.attrs.technique !== "penalty")) {
        const minute = Number(e.match_clock.slice(0, 2))
        expect(minute, e.id).toBeGreaterThanOrEqual(75)
      }
    }
  })
})
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `pnpm --filter @touchline/sim-core test gamestate`
Expected: 4 failed (`scoringFactor is not a function`; in the match test a goal before 75' with a zero profile)

- [ ] **Step 3: Implement**

Create `packages/sim-core/src/gamestate.ts`:

```ts
import type { Params } from "./params.js"

/**
 * How likely a shot is to score relative to its xG, from the game state (spec §5.1.4): the minute profile
 * (15-minute bins, the last one including added time) times the red-card factor when the teams are uneven.
 * Penalties are not scaled.
 */
export const scoringFactor = (minute: number, ownPlayers: number, opponentPlayers: number, p: Params): number => {
  const g = p.gameState
  const bin = Math.max(0, Math.min(g.minuteProfile.length - 1, Math.floor(minute / 15)))
  const red = ownPlayers < opponentPlayers ? g.redCardOwn : ownPlayers > opponentPlayers ? g.redCardOpponent : 1
  return g.minuteProfile[bin]! * red
}
```

Apply this change to `packages/sim-core/src/index.ts`, `packages/sim-core/src/params.ts`, `packages/sim-core/src/shot.ts`, `packages/sim-core/src/step.ts` (from the repository root):

```bash
git apply <<'PATCH'
diff --git a/packages/sim-core/src/index.ts b/packages/sim-core/src/index.ts
index 23db50b..98193a3 100644
--- a/packages/sim-core/src/index.ts
+++ b/packages/sim-core/src/index.ts
@@ -14,3 +14,4 @@ export * from "./step.js"
 export * from "./types.js"
 export * from "./touch.js"
 export * from "./deflect.js"
+export * from "./gamestate.js"
diff --git a/packages/sim-core/src/params.ts b/packages/sim-core/src/params.ts
index 3ea0318..3e748c0 100644
--- a/packages/sim-core/src/params.ts
+++ b/packages/sim-core/src/params.ts
@@ -162,6 +162,11 @@ export interface Params {
   readonly firstTouch: { readonly b0: number; readonly bSpeed: number; readonly bHigh: number; readonly bPressure: number; readonly bSkill: number; readonly missedShare: number; readonly miscontrolShare: number }
   /** Loose balls two opponents can both reach are decided by a ground duel: logit = bSkill x skill difference + bReach x reach advantage (m). */
   readonly groundDuel: { readonly bSkill: number; readonly bReach: number; readonly contestM: number }
+  /**
+   * Game state on scoring: a multiplier per 15-minute bin (mean 1; the last bin includes added time), and the
+   * red-card factors for the team down to fewer players and for its opponent.
+   */
+  readonly gameState: { readonly minuteProfile: readonly [number, number, number, number, number, number]; readonly redCardOwn: number; readonly redCardOpponent: number }
   readonly substitutions: { readonly windowMinutes: readonly [number, number, number]; readonly windowSdMin: number; readonly perWindow: readonly [number, number, number]; readonly halfTimeChance: number }
   readonly classifier: ClassifierThresholds
 }
@@ -257,6 +262,8 @@ export const DEFAULT_PARAMS: Params = {
   fatigue: { drainBase: 0.00004, drainSpeed2: 0.000012, staminaSlope: 0.8, halfTimeRecovery: 0.1, executionK: 0.25 },
   firstTouch: { b0: -3.9, bSpeed: 1.0, bHigh: 1.2, bPressure: 1.5, bSkill: -3.5, missedShare: 0.15, miscontrolShare: 0.35 },
   groundDuel: { bSkill: 3, bReach: 2, contestM: 0.6 },
+  // Hand-set prior with more goals late (refit from Wyscout goal minutes when that data is available); red-card factors from the spec.
+  gameState: { minuteProfile: [0.85, 0.95, 1.05, 0.95, 1.05, 1.15], redCardOwn: 0.67, redCardOpponent: 1.2 },
   substitutions: { windowMinutes: [62, 72, 81], windowSdMin: 5, perWindow: [2, 2, 1], halfTimeChance: 0.2 },
   classifier: {
     longPassM: 32,
diff --git a/packages/sim-core/src/shot.ts b/packages/sim-core/src/shot.ts
index a15ce0f..60584af 100644
--- a/packages/sim-core/src/shot.ts
+++ b/packages/sim-core/src/shot.ts
@@ -64,7 +64,9 @@ export const planShot = (
   dt: number,
   rng: Rng,
   /** Shooting with the weaker foot widens the aiming error by execution.weakFootK. */
-  weakFoot = false
+  weakFoot = false,
+  /** Game-state multiplier on the chance of scoring (see scoringFactor); 1 leaves goals per shot tracking xG. */
+  scoring = 1
 ): ShotPlan => {
   const goal = goalOf(side)
   const from: Vec3 = { x: shooter.pos.x, y: shooter.pos.y, z: 0.2 }
@@ -117,7 +119,7 @@ export const planShot = (
   // Scale by the expected on-target probability for this aim and noise, so goals per shot track xG.
   // Heights below 0 are clamped to the ground, so the vertical window is (-inf, crossbar).
   const pOnTarget = Math.max(0.05, normalBetween(-PITCH.goalHalfWidth, PITCH.goalHalfWidth, aimY, sdY) * normalBetween(-50, PITCH.goalHeight, aimZ, sdZ))
-  const pGoalClean = Math.max(0.03, Math.min(0.95, (isPenalty ? 0.76 : xg) / pOnTarget))
+  const pGoalClean = Math.min(0.95, Math.max(0.03, Math.min(0.95, (isPenalty ? 0.76 : xg) / pOnTarget)) * scoring)
   const pGoal = mis ? pGoalClean * 0.3 : pGoalClean
   if (rng.chance(pGoal) || keeper === null)
     return { outcome: "goal", ticks: travel(d), from, to, execution, onTarget, blockerId: null, keeperId: null, handling: null }
diff --git a/packages/sim-core/src/step.ts b/packages/sim-core/src/step.ts
index 7932cfc..2f3552f 100644
--- a/packages/sim-core/src/step.ts
+++ b/packages/sim-core/src/step.ts
@@ -3,6 +3,7 @@ import { decide, lastDefenderAttackX, nearestOpponent, type Decision } from "./d
 import { buildEvent, round2 } from "./events.js"
 import { behindPoint, clearAway, crossBlocker, DEFLECT_SPEED, deflectLoose, inOwnBox, keeperAction, keeperCanCome } from "./deflect.js"
 import { executeKick, pressureFrom } from "./execute.js"
+import { scoringFactor } from "./gamestate.js"
 import {
   add,
   attackX,
@@ -617,8 +618,10 @@ const releaseShot = (w: Work, owner: PlayerState, d: Decision, restart: RestartK
   const opps = w.active(other(side))
   const isPenalty = restart === "penalty"
   const xg = isPenalty ? 0.76 : (d.xg ?? 0.02)
+  // The recorded xG is the model's; the chance of scoring also follows the game state (minute, red cards).
+  const scoring = isPenalty ? 1 : scoringFactor(w.minute(), w.active(side).length, opps.length, w.p)
   const weakFoot = !isPenalty && w.rng.execution.chance(0.2)
-  const plan = planShot(owner, side, opps, xg, d.pressure, isPenalty, w.p, w.dt, w.rng.execution, weakFoot)
+  const plan = planShot(owner, side, opps, xg, d.pressure, isPenalty, w.p, w.dt, w.rng.execution, weakFoot, scoring)
   const tickAt = w.tick + plan.ticks
   const at = (pe: PendingEvent): PendingEvent => ({ ...pe, frame_id: tickAt })
   const end = { x: plan.to.x, y: plan.to.y }
PATCH
```

- [ ] **Step 4: Run the tests**

Run: `pnpm --filter @touchline/sim-core test gamestate`
Expected: 4 passed

Run: `pnpm turbo run typecheck test --force`
Expected: `Tasks: 10 successful`; the realism gate passes (small drift, about `"maxDrift":0.7`)

- [ ] **Step 5: Commit**

```bash
git add packages/sim-core
git commit -m "feat(sim-core): game-state scoring — minute profile and red-card factors

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```



### Task 8: Data integrity and tooling: checksums, relative errors, locked CI, data-aware cache

The remaining Plan 2a minors. IDSSE downloads are checked against SHA-256 values cross-checked on 2026-10-04 against the Hugging Face repository's own ids (git blob ids, and the LFS sha256 of the tracking file): a missing, truncated or corrupt file is fetched again; a download that does not match raises and leaves nothing behind. The realism report adds an 'Off by' column and lists every statistic more than 30 % from the real mean (corners at a quarter of the real rate showed as 'within 2 SD'). CI runs `uv` with `--locked`; the TypeScript test cache key includes the data files and the Python sources the tests read (Turborepo does not apply `.gitignore` to listed inputs, so the globs name source files only). The start file's comment no longer claims a byte-identical result.

**Files:**
- Modify: `python/analytics/touchline_analytics/idsse.py`, `python/analytics/touchline_analytics/report.py`, `.github/workflows/ci.yml`, `packages/calibrate/test/parity.test.ts`, `turbo.json`, `.gitignore`, `data/params/calibration-start.json` (comment)
- Test: `python/analytics/tests/test_idsse.py` (new), `python/analytics/tests/test_report.py` (one new case)

**Interfaces:**
- Consumes: Plan 2a's downloader and report.
- Produces: `idsse.SHA256` (15 files), `download()` verifies and replaces; `report.statistics_section(sim_mean, sim_sd, targets) -> (lines, counts)`; `uv run --locked` in CI and the parity test.

- [ ] **Step 1: Write the failing tests**

Create `python/analytics/tests/test_idsse.py`:

```python
import hashlib
import io

import pytest

from touchline_analytics import idsse


def _serve(monkeypatch, payload: bytes):
    monkeypatch.setattr(idsse.urllib.request, "urlopen", lambda url, timeout=0: io.BytesIO(payload))


def _one_file(monkeypatch, name: str, payload: bytes):
    monkeypatch.setattr(idsse, "filenames", lambda match_id: {"meta": name})
    monkeypatch.setitem(idsse.SHA256, name, hashlib.sha256(payload).hexdigest())


def test_download_replaces_a_corrupt_file(tmp_path, monkeypatch):
    _one_file(monkeypatch, "m.xml", b"good")
    (tmp_path / "m.xml").write_bytes(b"truncated")
    _serve(monkeypatch, b"good")
    idsse.download("J03WMX", tmp_path)
    assert (tmp_path / "m.xml").read_bytes() == b"good"


def test_download_keeps_a_verified_file_without_fetching(tmp_path, monkeypatch):
    _one_file(monkeypatch, "m.xml", b"good")
    (tmp_path / "m.xml").write_bytes(b"good")
    monkeypatch.setattr(idsse.urllib.request, "urlopen", lambda *a, **k: pytest.fail("should not fetch"))
    idsse.download("J03WMX", tmp_path)


def test_download_rejects_a_payload_that_does_not_match_its_checksum(tmp_path, monkeypatch):
    _one_file(monkeypatch, "m.xml", b"good")
    _serve(monkeypatch, b"tampered")
    with pytest.raises(ValueError, match="checksum"):
        idsse.download("J03WMX", tmp_path)
    assert not (tmp_path / "m.xml").exists()
    assert not (tmp_path / "m.part").exists()


def test_every_default_file_has_a_checksum():
    for match_id in idsse.MATCHES:
        for kind, name in idsse.filenames(match_id).items():
            if kind != "tracking" or match_id == "J03WPY":
                assert name in idsse.SHA256, name
```

Apply this change to `python/analytics/tests/test_report.py` (from the repository root):

```bash
git apply <<'PATCH'
diff --git a/python/analytics/tests/test_report.py b/python/analytics/tests/test_report.py
index 10d3bab..22873c0 100644
--- a/python/analytics/tests/test_report.py
+++ b/python/analytics/tests/test_report.py
@@ -9,3 +9,15 @@ def test_distribution_distances():
     assert wasserstein_binned([1, 0], [0, 1], edges) == 1
     assert js_divergence([0.5, 0.5], [0.5, 0.5]) == 0
     assert math.isclose(js_divergence([1, 0], [0, 1]), 1.0)
+
+
+def test_statistics_table_shows_relative_error_and_lists_large_misses():
+    from touchline_analytics.report import statistics_section
+
+    targets = {"metrics": {"corners": {"mean": 8.0, "sd": 3.0, "n": 7}, "goals": {"mean": 2.7, "sd": 1.5, "n": 7}}}
+    lines, counts = statistics_section({"corners": 2.0, "goals": 2.8}, {"corners": 1.0, "goals": 1.2}, targets)
+    text = "\n".join(lines)
+    assert "| Corners | 8.0 ± 3.0 | 2.0 ± 1.0 | -2.00 | -75 % | within 2 SD |" in text
+    assert "+4 %" in text
+    assert "More than 30 % from the real mean: Corners (-75 %)." in text
+    assert counts == {"within 1 SD": 1, "within 2 SD": 1, "off": 0}
PATCH
```

- [ ] **Step 2: Run them to make sure they fail**

Run: `uv run --project python/analytics --group dev pytest python/analytics/tests -q`
Expected: 5 failed (the four downloader tests, `AttributeError: … SHA256`; and `cannot import name 'statistics_section'`)

- [ ] **Step 3: Implement**

Apply this change to `python/analytics/touchline_analytics/idsse.py`, `python/analytics/touchline_analytics/report.py` (from the repository root):

```bash
git apply <<'PATCH'
diff --git a/python/analytics/touchline_analytics/idsse.py b/python/analytics/touchline_analytics/idsse.py
index 59c79db..de97f12 100644
--- a/python/analytics/touchline_analytics/idsse.py
+++ b/python/analytics/touchline_analytics/idsse.py
@@ -6,6 +6,7 @@ statistics derived from them are committed (with provenance).
 
 from __future__ import annotations
 
+import hashlib
 import urllib.request
 from pathlib import Path
 
@@ -25,6 +26,26 @@ PROVENANCE = {
     "attribution": "Deutsche Fussball Liga (DFL); Bassek et al., Scientific Data (2025), doi:10.1038/s41597-025-04505-y",
 }
 
+# SHA-256 of each file, cross-checked against the Hugging Face repository's own ids (git blob ids,
+# and the LFS sha256 for the tracking file) on 2026-10-04.
+SHA256: dict[str, str] = {
+    "DFL_02_01_matchinformation_DFL-COM-000001_DFL-MAT-J03WMX.xml": "a884728647a564cf8b20e5223a1d04a5da6f6725e1e506c8651505327c197ba9",
+    "DFL_02_01_matchinformation_DFL-COM-000001_DFL-MAT-J03WN1.xml": "5490286436c86e6f80a538d2b1b379d0efd016e0defcaf594bc59d9ef5079f4c",
+    "DFL_02_01_matchinformation_DFL-COM-000002_DFL-MAT-J03WOH.xml": "f23b3ee13b988b1ff9a0bce438c416dac47e71355bbc7ee1dab21aaf3e33c18c",
+    "DFL_02_01_matchinformation_DFL-COM-000002_DFL-MAT-J03WOY.xml": "4c497fac683eee8292901c18ca02c0be1d9609d0b9d4bd8aa092c61f9e0b19e9",
+    "DFL_02_01_matchinformation_DFL-COM-000002_DFL-MAT-J03WPY.xml": "566dd5e4c86e124ab90fcdba51100881f0436e22afa71832945a451a2d95a420",
+    "DFL_02_01_matchinformation_DFL-COM-000002_DFL-MAT-J03WQQ.xml": "e976aa0c5dba862cfa898ea57ec226efce9d1bc04b23b8d775908db86aa6fa41",
+    "DFL_02_01_matchinformation_DFL-COM-000002_DFL-MAT-J03WR9.xml": "429b584e89df3e3e8b81f4bd0d004b38bd0b4298bb390b8fb43efccb60963e01",
+    "DFL_03_02_events_raw_DFL-COM-000001_DFL-MAT-J03WMX.xml": "6f9741ea62e9dee35b604942e1dad2ac0a4dc3fce14ef2f3858aa12b74dafe00",
+    "DFL_03_02_events_raw_DFL-COM-000001_DFL-MAT-J03WN1.xml": "d7fa1d4445e3215eb79ec62fabefa4779b4974e496195c2fdc25624c375a9b9b",
+    "DFL_03_02_events_raw_DFL-COM-000002_DFL-MAT-J03WOH.xml": "abc27e3268e6126fb3e6e90bff5cca8d4586a5e0cefe9bd59bf32871e89d8544",
+    "DFL_03_02_events_raw_DFL-COM-000002_DFL-MAT-J03WOY.xml": "dbb014df1b80d5c99b7fb806a278432c445a5fdd99f59d379d601f20eaf7e142",
+    "DFL_03_02_events_raw_DFL-COM-000002_DFL-MAT-J03WPY.xml": "e440a3adf9a38d3e4ce4289343a59a3b5f76018a78e97c765114f7817591fb3c",
+    "DFL_03_02_events_raw_DFL-COM-000002_DFL-MAT-J03WQQ.xml": "b79ccc1ee3de5ba662546a9a21304784642d00a791ccc1175550eaa463ea0074",
+    "DFL_03_02_events_raw_DFL-COM-000002_DFL-MAT-J03WR9.xml": "31735a2d7b9008c44cae9b6ac43ab38ddeaa435d0416265ec0ebfebf53b3c982",
+    "DFL_04_03_positions_raw_observed_DFL-COM-000002_DFL-MAT-J03WPY.xml": "845202c29ad93d696653436da426a7cdaefb848298e07b7343de6529581671e1",
+}
+
 
 def filenames(match_id: str) -> dict[str, str]:
     comp = MATCHES[match_id]
@@ -35,20 +56,44 @@ def filenames(match_id: str) -> dict[str, str]:
     }
 
 
+def _sha256(path: Path) -> str:
+    h = hashlib.sha256()
+    with path.open("rb") as fh:
+        while chunk := fh.read(1 << 20):
+            h.update(chunk)
+    return h.hexdigest()
+
+
+def _verified(path: Path) -> bool:
+    """True when the file exists and matches its recorded checksum (any non-empty file if none is recorded)."""
+    if not path.exists() or path.stat().st_size == 0:
+        return False
+    expected = SHA256.get(path.name)
+    return expected is None or _sha256(path) == expected
+
+
 def download(match_id: str, root: Path, tracking: bool = False) -> dict[str, Path]:
-    """Download one match's files (skipping files already present). Tracking files are ~370 MB each."""
+    """
+    Download one match's files into `root`. Files already present and matching their checksum are kept;
+    missing, truncated or corrupt files are fetched again. A download that does not match its checksum
+    raises ValueError and leaves nothing behind. Tracking files are ~370 MB each.
+    """
     root.mkdir(parents=True, exist_ok=True)
     out: dict[str, Path] = {}
     for kind, name in filenames(match_id).items():
         if kind == "tracking" and not tracking:
             continue
         path = root / name
-        if not path.exists() or path.stat().st_size == 0:
+        if not _verified(path):
             tmp = path.with_suffix(".part")
             with urllib.request.urlopen(BASE_URL + name, timeout=600) as resp, tmp.open("wb") as fh:
                 while chunk := resp.read(1 << 20):
                     fh.write(chunk)
-            tmp.rename(path)
+            expected = SHA256.get(name)
+            if expected is not None and _sha256(tmp) != expected:
+                tmp.unlink()
+                raise ValueError(f"{name}: checksum mismatch (download corrupted or the file changed upstream)")
+            tmp.replace(path)
         out[kind] = path
     return out
 
diff --git a/python/analytics/touchline_analytics/report.py b/python/analytics/touchline_analytics/report.py
index f3fc1e2..03577d7 100644
--- a/python/analytics/touchline_analytics/report.py
+++ b/python/analytics/touchline_analytics/report.py
@@ -60,6 +60,32 @@ def status(z: float) -> str:
     return "within 1 SD" if abs(z) <= 1 else "within 2 SD" if abs(z) <= 2 else "off"
 
 
+def statistics_section(sim_mean: dict, sim_sd: dict, targets: dict) -> tuple[list[str], dict]:
+    """The match-statistics table: z against the real between-match SD, and the relative error, which shows
+    large misses on statistics whose real spread is wide (a z within 2 SD can still be far from the mean)."""
+    lines = [
+        "| Statistic | Real (mean ± SD) | Synthetic (mean ± SD) | z | Off by | Verdict |",
+        "|---|---|---|---|---|---|",
+    ]
+    counts = {"within 1 SD": 0, "within 2 SD": 0, "off": 0}
+    far = []
+    for k, (label, fmt) in LABELS.items():
+        t = targets["metrics"].get(k)
+        if not t or k not in sim_mean:
+            continue
+        z = (sim_mean[k] - t["mean"]) / scale_of(t)
+        rel = (sim_mean[k] - t["mean"]) / t["mean"] * 100 if t["mean"] else 0.0
+        v = status(z)
+        counts[v] += 1
+        if abs(rel) > 30:
+            far.append(f"{label} ({rel:+.0f} %)")
+        lines.append(f"| {label} | {fmt.format(t['mean'])} ± {fmt.format(t['sd'])} | {fmt.format(sim_mean[k])} ± {fmt.format(sim_sd[k])} | {z:+.2f} | {rel:+.0f} % | {v} |")
+    lines += ["", f"Summary: {counts['within 1 SD']} within 1 SD, {counts['within 2 SD']} within 2 SD, {counts['off']} off. "
+              "z uses the real between-match SD, floored at 5 % of the mean (tracking targets come from one match)."]
+    lines += ["", f"More than 30 % from the real mean: {', '.join(far)}." if far else "Every statistic is within 30 % of the real mean."]
+    return lines, counts
+
+
 def build(run_dirs: list[Path], targets: dict, params_note: str) -> str:
     runs = [touchline_metrics(d) for d in run_dirs]
     n = len(runs)
@@ -75,20 +101,9 @@ def build(run_dirs: list[Path], targets: dict, params_note: str) -> str:
         "",
         "## Match statistics",
         "",
-        "| Statistic | Real (mean ± SD) | Synthetic (mean ± SD) | z | Verdict |",
-        "|---|---|---|---|---|",
     ]
-    counts = {"within 1 SD": 0, "within 2 SD": 0, "off": 0}
-    for k, (label, fmt) in LABELS.items():
-        t = targets["metrics"].get(k)
-        if not t:
-            continue
-        z = (mean(k) - t["mean"]) / scale_of(t)
-        v = status(z)
-        counts[v] += 1
-        lines.append(f"| {label} | {fmt.format(t['mean'])} ± {fmt.format(t['sd'])} | {fmt.format(mean(k))} ± {fmt.format(sd(k))} | {z:+.2f} | {v} |")
-    lines += ["", f"Summary: {counts['within 1 SD']} within 1 SD, {counts['within 2 SD']} within 2 SD, {counts['off']} off. "
-              "z uses the real between-match SD, floored at 5 % of the mean (tracking targets come from one match).", ""]
+    table, _ = statistics_section({k: mean(k) for k in LABELS}, {k: sd(k) for k in LABELS}, targets)
+    lines += table + [""]
     lines += ["## Distributions", "", "| Distribution | Wasserstein-1 | Jensen–Shannon (bits) |", "|---|---|---|"]
     for key, label, edges, unit in (("pass_len", "Completed pass length", PASS_LEN_EDGES, "m"), ("speed", "Player speed", SPEED_EDGES, "m/s")):
         real = targets["distributions"][key]["share"]
PATCH
```

- [ ] **Step 4: Run the tests and check the real files**

Run: `uv run --project python/analytics --group dev pytest python/analytics/tests -q`
Expected: 10 passed

Run: `uv run --project python/analytics python -m touchline_analytics.idsse`
Expected: seven lines in well under a second: every file already present verifies, nothing is fetched

- [ ] **Step 5: Lock CI, widen the test cache key, fix the comment**

Apply this change to `.github/workflows/ci.yml`, `packages/calibrate/test/parity.test.ts`, `turbo.json`, `.gitignore`, `data/params/calibration-start.json` (from the repository root):

```bash
git apply <<'PATCH'
diff --git a/.github/workflows/ci.yml b/.github/workflows/ci.yml
index 74cde2f..83607b1 100644
--- a/.github/workflows/ci.yml
+++ b/.github/workflows/ci.yml
@@ -23,7 +23,7 @@ jobs:
     steps:
       - uses: actions/checkout@v4
       - uses: astral-sh/setup-uv@v6
-      - run: uv run --project python/analytics --group dev pytest python/analytics/tests -q
+      - run: uv run --locked --project python/analytics --group dev pytest python/analytics/tests -q
   cdf:
     runs-on: ubuntu-latest
     needs: typescript
@@ -37,6 +37,6 @@ jobs:
       - run: pnpm install --frozen-lockfile
       - run: pnpm sim --seed 1 --home ironmoor --away saltmarsh
       - uses: astral-sh/setup-uv@v6
-      - run: uv run --project python/analytics python -m touchline_analytics.validate_cdf out/m-1
+      - run: uv run --locked --project python/analytics python -m touchline_analytics.validate_cdf out/m-1
       - run: pnpm sim --seed 2 --home eastvale --away larkspur --fps 25 --match-id m-2-25fps
-      - run: uv run --project python/analytics python -m touchline_analytics.validate_cdf out/m-2-25fps
+      - run: uv run --locked --project python/analytics python -m touchline_analytics.validate_cdf out/m-2-25fps
diff --git a/.gitignore b/.gitignore
index a764648..1f48b67 100644
--- a/.gitignore
+++ b/.gitignore
@@ -6,3 +6,4 @@ data/raw/
 __pycache__/
 *.pyc
 .superpowers/
+.pytest_cache/
diff --git a/data/params/calibration-start.json b/data/params/calibration-start.json
index 6d721d9..47773c5 100644
--- a/data/params/calibration-start.json
+++ b/data/params/calibration-start.json
@@ -1,5 +1,5 @@
 {
- "_comment": "Starting knob values for `pnpm calibrate --from data/params/calibration-start.json`. They come from two earlier exploratory tuning rounds (Plan 2a, 2026-10-04); tuning from here is deterministic and reproduces data/params/touchline-params.json.",
+ "_comment": "Starting knob values for `pnpm calibrate --from data/params/calibration-start.json`. They come from two earlier exploratory tuning rounds (Plan 2a, 2026-10-04); tuning from here is deterministic and reproduces the knobs, loss and statistics in data/params/touchline-params.json (its fitted_at and version carry the date of the run).",
  "calibration": {
   "knobs": {
    "decision_scale": 1,
diff --git a/packages/calibrate/test/parity.test.ts b/packages/calibrate/test/parity.test.ts
index 4802edd..377a71f 100644
--- a/packages/calibrate/test/parity.test.ts
+++ b/packages/calibrate/test/parity.test.ts
@@ -22,7 +22,7 @@ describe("metric parity", () => {
     const dir = mkdtempSync(join(tmpdir(), "touchline-parity-"))
     await Effect.runPromise(writeMatch(cfg, dir))
     const py = JSON.parse(
-      execFileSync("uv", ["run", "--project", join(root, "python/analytics"), "python", "-m", "touchline_analytics.metrics", dir], { encoding: "utf8", maxBuffer: 1 << 26 })
+      execFileSync("uv", ["run", "--locked", "--project", join(root, "python/analytics"), "python", "-m", "touchline_analytics.metrics", dir], { encoding: "utf8", maxBuffer: 1 << 26 })
     ) as Record<string, number | number[]>
     const { events, frames } = runMatch(cfg)
     const ts = matchMetrics(events, frames, cfg.dt)
diff --git a/turbo.json b/turbo.json
index e6b8111..2708a49 100644
--- a/turbo.json
+++ b/turbo.json
@@ -3,6 +3,16 @@
   "agentGuidance": false,
   "tasks": {
     "typecheck": {},
-    "test": { "outputs": [] }
+    "test": {
+      "outputs": [],
+      "inputs": [
+        "$TURBO_DEFAULT$",
+        "$TURBO_ROOT$/data/params/*.json",
+        "$TURBO_ROOT$/data/league/*.json",
+        "$TURBO_ROOT$/python/analytics/touchline_analytics/*.py",
+        "$TURBO_ROOT$/python/analytics/pyproject.toml",
+        "$TURBO_ROOT$/python/analytics/uv.lock"
+      ]
+    }
   }
 }
PATCH
```

Run: `pnpm turbo run test --filter @touchline/calibrate --dry=json`
Expected: the `@touchline/calibrate#test` inputs include `data/params/*.json`, `data/league/league.json`, `python/analytics/touchline_analytics/*.py`, `pyproject.toml` and `uv.lock`, and no `.pyc` or `.pytest_cache` files

- [ ] **Step 6: Run everything**

Run: `pnpm turbo run typecheck test --force && uv run --locked --project python/analytics --group dev pytest python/analytics/tests -q`
Expected: `Tasks: 10 successful`; 10 passed

- [ ] **Step 7: Commit**

```bash
git add python/analytics .github/workflows/ci.yml packages/calibrate/test/parity.test.ts turbo.json .gitignore data/params/calibration-start.json
git commit -m "chore: IDSSE checksums, relative errors in the realism report, locked uv in CI, data-aware test cache

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```



### Task 9: Keepers let balls run out; shot blocking from data; recalibrate and re-prove realism

Two engine corrections found while recalibrating, then the recalibration itself. (1) The IDSSE matches give a measured blocked-shot share (39 of 171 shots, 22.8 %); the blocking defaults are set to reproduce it and blocking is no longer a tuning knob, because no tuned statistic can see it (too many blocks had pushed shots on target down to about 25 %). (2) Keepers collected every ball played in behind; a real keeper lets a ball that is running out over their own goal line go for a goal kick. The check re-predicts the flight without the keeper on a copy of the duel stream, so it consumes no random draws of its own. Then two new knobs (`deflect_behind`, `clear_to_touch`) join the tuner, which runs in one-round chunks from the Plan 2a knobs, and the realism report, gate baseline and README are regenerated.

**Files:**
- Modify: `packages/sim-core/src/resolve.ts` (`keeperLetsRun`), `packages/sim-core/src/step.ts`, `packages/sim-core/src/params.ts`, `packages/calibrate/src/knobs.ts`, `data/params/calibration-start.json` (full new contents), `README.md`
- Regenerate: `data/params/touchline-params.json`, `docs/realism/realism-report.md`, `data/params/realism-baseline.json`
- Test: `packages/sim-core/test/letrun.test.ts` (new, deterministic: a constructed ball rolling past the keeper), `packages/sim-core/test/wide.test.ts` (own-goal limit stated for six matches)

**Interfaces:**
- Consumes: Tasks 1–8; `resolveFlight`; the tuner (`tune`, `--from`, `--out`, `--matches`, `--rounds`).
- Produces: `keeperLetsRun(start, fromId, intendedId, players, res, p, dt, rng): Resolution` (resolve.ts); `params.keeper.letRunShare` (0.85); shot blocking defaults `blockPerDefender` 0.23, `blockPressure` 0.2; knobs `deflect_behind` (scales the four behind-the-line shares, each kept at most 1) and `clear_to_touch`; calibrated `data/params/touchline-params.json` with provenance and calibration record.

- [ ] **Step 1: Write the failing tests**

Create `packages/sim-core/test/letrun.test.ts`:

```ts
import { describe, expect, it } from "vitest"
import { launchVelocity } from "../src/ball.js"
import { DEFAULT_PARAMS as P } from "../src/params.js"
import { keeperLetsRun, resolveFlight } from "../src/resolve.js"
import { Rng, seedRng } from "../src/rng.js"
import { kickoffPlayersFor, makeConfig } from "../src/testing.js"
import type { PlayerState } from "../src/types.js"

const base = kickoffPlayersFor(makeConfig(1))
const at = (p: PlayerState, x: number, y: number): PlayerState => ({ ...p, pos: { x, y }, vel: { x: 0, y: 0 } })

describe("keeper lets the ball run out", () => {
  // A home attacker plays the ball towards the away goal line; only the away keeper is near it.
  const passer = at(base[9]!, 30, 6)
  const keeper = at(base.find((p) => p.side === "away" && p.role === "GK")!, 49, 5)
  const players = [passer, keeper]
  const ball = { pos: { x: 30, y: 6, z: 0 }, vel: launchVelocity(passer.pos, { x: 50, y: 7 }, "ground", P) }
  const res = resolveFlight(ball, passer.id, null, players, P, 0.1, new Rng(seedRng(1)))

  it("the keeper could collect it", () => {
    expect(res.winnerId).toBe(keeper.id)
  })
  it("lets it go for a goal kick when it would cross their own goal line", () => {
    const p = { ...P, keeper: { ...P.keeper, letRunShare: 1 } }
    const r = keeperLetsRun(ball, passer.id, null, players, res, p, 0.1, new Rng(seedRng(2)))
    expect(r.result).toBe("out")
    expect(r.ball.pos.x).toBeGreaterThan(52.5)
  })
  it("collects it when letRunShare is 0, and never lets a ball go that would stay in play", () => {
    const keep = { ...P, keeper: { ...P.keeper, letRunShare: 0 } }
    expect(keeperLetsRun(ball, passer.id, null, players, res, keep, 0.1, new Rng(seedRng(2)))).toBe(res)
    const short = { pos: { x: 30, y: 6, z: 0 }, vel: launchVelocity(passer.pos, { x: 44, y: 6 }, "ground", { ...P, pass: { ...P.pass, arriveSpeed: 1 } }) }
    const near = at(keeper, 44, 6)
    const r0 = resolveFlight(short, passer.id, null, [passer, near], P, 0.1, new Rng(seedRng(1)))
    const always = { ...P, keeper: { ...P.keeper, letRunShare: 1 } }
    expect(keeperLetsRun(short, passer.id, null, [passer, near], r0, always, 0.1, new Rng(seedRng(2)))).toBe(r0)
  })
  it("only the defending keeper does it: a team's own keeper still collects its own back pass", () => {
    const ownKeeper = at(base.find((p) => p.side === "home" && p.role === "GK")!, -49, 5)
    const back = { pos: { x: -30, y: 6, z: 0 }, vel: launchVelocity({ x: -30, y: 6 }, { x: -50, y: 7 }, "ground", P) }
    const from = at(base[2]!, -30, 6)
    const r0 = resolveFlight(back, from.id, null, [from, ownKeeper], P, 0.1, new Rng(seedRng(1)))
    const always = { ...P, keeper: { ...P.keeper, letRunShare: 1 } }
    expect(keeperLetsRun(back, from.id, null, [from, ownKeeper], r0, always, 0.1, new Rng(seedRng(2)))).toBe(r0)
  })
})
```

Apply this change to `packages/sim-core/test/wide.test.ts` (from the repository root):

```bash
git apply <<'PATCH'
diff --git a/packages/sim-core/test/wide.test.ts b/packages/sim-core/test/wide.test.ts
index b444530..159578d 100644
--- a/packages/sim-core/test/wide.test.ts
+++ b/packages/sim-core/test/wide.test.ts
@@ -89,6 +89,7 @@ describe("deflections", () => {
   })
   it("deflected shots rarely end in own goals", () => {
     const own = runs.reduce((n, r) => n + r.events.filter((e) => e.type === "goal" && e.attrs.own_goal === true).length, 0)
-    expect(own / runs.length).toBeLessThan(0.3)
+    // Real matches see roughly one own goal every seven or eight matches; allow sampling noise over six.
+    expect(own).toBeLessThanOrEqual(3)
   })
 })
PATCH
```

- [ ] **Step 2: Run them to make sure they fail**

Run: `pnpm --filter @touchline/sim-core test letrun`
Expected: 4 failed: `TypeError: keeperLetsRun is not a function`. (A match-level comparison with the behaviour on and off was tried first and rejected: one changed moment reshapes the rest of the match, so its counts flip with any recalibration.)

- [ ] **Step 3: Implement the keeper behaviour and the measured blocking defaults**

Apply this change to `packages/sim-core/src/resolve.ts`, `packages/sim-core/src/step.ts`, `packages/sim-core/src/params.ts` (from the repository root):

```bash
git apply <<'PATCH'
diff --git a/packages/sim-core/src/params.ts b/packages/sim-core/src/params.ts
index 3e748c0..444cc27 100644
--- a/packages/sim-core/src/params.ts
+++ b/packages/sim-core/src/params.ts
@@ -133,8 +133,12 @@ export interface Params {
     /** Share of clearances from inside a team's own box that are sliced behind for a corner (a defensive slip). */
     readonly clearSliceBehind: number
   }
-  /** Keepers coming for high balls: reach (m) and depth from the goal line (m), how often they come, catch vs punch vs fumble. */
+  /**
+   * Keepers coming for high balls: reach (m) and depth from the goal line (m), how often they come, catch vs punch vs fumble;
+   * and the share of balls running out over their own goal line they let go for a goal kick instead of collecting.
+   */
   readonly keeper: {
+    readonly letRunShare: number
     readonly claimRangeM: number
     readonly claimDepthM: number
     readonly comeShare: number
@@ -226,9 +230,10 @@ export const DEFAULT_PARAMS: Params = {
     speed: 26,
     onTargetRate: 0.38,
     aimNoise: 1.0,
-    blockPerDefender: 0.35,
+    // Set so that about 23 % of shots are blocked, as in the IDSSE matches (39 of 171 shots).
+    blockPerDefender: 0.23,
     blockWidthM: 3.5,
-    blockPressure: 0.3,
+    blockPressure: 0.2,
     blockBehind: 0.5
   },
   defending: {
@@ -253,7 +258,7 @@ export const DEFAULT_PARAMS: Params = {
     clearToTouch: 0.2,
     clearSliceBehind: 0.2
   },
-  keeper: { claimRangeM: 11, claimDepthM: 13, comeShare: 0.85, catchBase: 0.4, catchHandling: 0.35, fumbleShare: 0.06 },
+  keeper: { letRunShare: 0.85, claimRangeM: 11, claimDepthM: 13, comeShare: 0.85, catchBase: 0.4, catchHandling: 0.35, fumbleShare: 0.06 },
   takeOn: { b0: -0.2, bSkill: 3.0, bPressure: -0.8 },
   carry: { speed: 5.5, durationS: [0.8, 2.0] },
   runs: { runInBehindRatePerS: 0.12 },
diff --git a/packages/sim-core/src/resolve.ts b/packages/sim-core/src/resolve.ts
index 82042da..d3d6d51 100644
--- a/packages/sim-core/src/resolve.ts
+++ b/packages/sim-core/src/resolve.ts
@@ -1,8 +1,8 @@
 import { stepBall } from "./ball.js"
-import { inPitch, PITCH, type Side, type Vec2 } from "./geometry.js"
+import { dirOf, inPitch, PITCH, type Side, type Vec2 } from "./geometry.js"
 import { accelFor, reachIn, vmaxFor } from "./kinematics.js"
 import type { Params } from "./params.js"
-import type { Rng } from "./rng.js"
+import { Rng } from "./rng.js"
 import type { BallState, PlayerState } from "./types.js"
 
 export interface Resolution {
@@ -111,3 +111,26 @@ export const resolveFlight = (
   }
   return { ticks: maxTicks, winnerId: null, result: "stopped", ball: b, aerial: null }
 }
+
+/**
+ * A defending keeper does not collect a ball that would run out over their own goal line without them: with
+ * probability keeper.letRunShare they let it go for a goal kick, and the resolution becomes the ball going out.
+ * The "without the keeper" prediction runs on a copy of `rng`; only the let-it-go decision draws from `rng`.
+ */
+export const keeperLetsRun = (
+  start: BallState,
+  fromId: string,
+  intendedId: string | null,
+  players: ReadonlyArray<PlayerState>,
+  res: Resolution,
+  p: Params,
+  dt: number,
+  rng: Rng
+): Resolution => {
+  const keeper = players.find((x) => x.id === res.winnerId && x.role === "GK")
+  const passer = players.find((x) => x.id === fromId)
+  if (!keeper || !passer || keeper.side === passer.side) return res
+  const without = resolveFlight(start, fromId, intendedId, players.filter((x) => x.id !== keeper.id), p, dt, new Rng(rng.state))
+  const overOwnLine = without.result === "out" && Math.abs(without.ball.pos.y) <= PITCH.halfW && Math.sign(without.ball.pos.x) === -dirOf(keeper.side)
+  return overOwnLine && rng.chance(p.keeper.letRunShare) ? without : res
+}
diff --git a/packages/sim-core/src/step.ts b/packages/sim-core/src/step.ts
index 2f3552f..6f274a9 100644
--- a/packages/sim-core/src/step.ts
+++ b/packages/sim-core/src/step.ts
@@ -23,7 +23,7 @@ import {
 } from "./geometry.js"
 import { accelFor, arrive, arriveBy, drainEnergy, interceptPoint, separation, vmaxFor } from "./kinematics.js"
 import type { Action } from "./params.js"
-import { goalLineCrossing, resolveFlight } from "./resolve.js"
+import { goalLineCrossing, keeperLetsRun, resolveFlight } from "./resolve.js"
 import { hazard, Rng, substream } from "./rng.js"
 import { anchorFor, kickoffAnchor } from "./shape.js"
 import { parryBall, planShot } from "./shot.js"
@@ -486,7 +486,8 @@ const releaseKick = (w: Work, owner: PlayerState, d: Decision, restart: RestartK
   )
   const start: BallState = { pos: { x: owner.pos.x, y: owner.pos.y, z: 0 }, vel: exe.vel }
   const intended = d.candidate?.receiverId ?? null
-  const res = resolveFlight(start, owner.id, intended, w.active(), p, w.dt, w.rng.duel)
+  // A keeper lets a ball that is running out over their own goal line go for a goal kick (see keeperLetsRun).
+  const res = keeperLetsRun(start, owner.id, intended, w.active(), resolveFlight(start, owner.id, intended, w.active(), p, w.dt, w.rng.duel), p, w.dt, w.rng.duel)
   const lastDef = lastDefenderAttackX(side, opps)
   const winner = res.winnerId ? w.player(res.winnerId) : null
   const offside =
PATCH
```

- [ ] **Step 4: Run the tests**

Run: `pnpm --filter @touchline/sim-core test letrun wide`
Expected: 12 passed

- [ ] **Step 5: Add the knobs and the start values**

Apply this change to `packages/calibrate/src/knobs.ts` (from the repository root):

```bash
git apply <<'PATCH'
diff --git a/packages/calibrate/src/knobs.ts b/packages/calibrate/src/knobs.ts
index c2feb37..097cd4c 100644
--- a/packages/calibrate/src/knobs.ts
+++ b/packages/calibrate/src/knobs.ts
@@ -14,6 +14,9 @@ export interface Knob {
   readonly apply: (p: Params, v: number) => Params
 }
 
+/** A probability scaled by a knob, kept at most 1. */
+const share = (x: number): number => Math.min(1, x)
+
 const shiftLogits = (p: Params, actions: ReadonlyArray<Action>, v: number): Params => {
   const logits = { ...p.actions.logits }
   for (const z of ACTION_ZONES) {
@@ -58,7 +61,15 @@ export const KNOBS: ReadonlyArray<Knob> = [
   { name: "shape_depth", what: "distance between lines (pass length, long passes)", init: 1, min: 0.8, max: 1.6, step: 0.1,
     apply: (p, v) => ({ ...p, shape: { ...p.shape, depth: v } }) },
   { name: "shape_speed", what: "share of top speed used when moving into shape (speeds, distance)", init: 0.7, min: 0.5, max: 1, step: 0.05,
-    apply: (p, v) => ({ ...p, movement: { ...p.movement, shapeSpeedShare: v } }) }
+    apply: (p, v) => ({ ...p, movement: { ...p.movement, shapeSpeedShare: v } }) },
+  { name: "deflect_behind", what: "scale on the shares of blocks, headers and sliced clearances that go behind (corners)", init: 1, min: 0.3, max: 2, step: 0.25,
+    apply: (p, v) => ({
+      ...p,
+      defending: { ...p.defending, crossBlockBehind: share(p.defending.crossBlockBehind * v), headBehind: share(p.defending.headBehind * v), clearSliceBehind: share(p.defending.clearSliceBehind * v) },
+      shot: { ...p.shot, blockBehind: share(p.shot.blockBehind * v) }
+    }) },
+  { name: "clear_to_touch", what: "share of wide clearances kicked into touch (throw-ins)", init: DEFAULT_PARAMS.defending.clearToTouch, min: 0, max: 0.7, step: 0.1,
+    apply: (p, v) => ({ ...p, defending: { ...p.defending, clearToTouch: v } }) }
 ]
 
 export type KnobValues = Readonly<Record<string, number>>
PATCH
```

Replace `data/params/calibration-start.json` — full new contents:

```json
{
 "_comment": "Starting knob values for `pnpm calibrate --from data/params/calibration-start.json --matches 12`: the Plan 2a calibration (2026-10-04) plus the Plan 2b knobs (deflect_behind, clear_to_touch) at their defaults. Tuning from here is deterministic and reproduces the knobs, loss and statistics in data/params/touchline-params.json (its fitted_at and version carry the date of the run).",
 "calibration": {
  "knobs": {
   "decision_scale": 1,
   "long_bias": 1.25,
   "cross_bias": 0.375,
   "shot_bias": 0,
   "aim_noise": 1.55,
   "xg_b0": -1,
   "exec_scale": 1.45,
   "reach_margin": 0.725,
   "tackle_rate": 0.8,
   "foul_per_tackle": 0.345,
   "yellow_per_foul": 0.2,
   "box_intensity": 2,
   "box_carry": -0.75,
   "loose_share": 0.3,
   "restart_scale": 1.25,
   "shape_width": 1.35,
   "shape_depth": 1.2,
   "shape_speed": 0.9,
   "deflect_behind": 1,
   "clear_to_touch": 0.2
  }
 }
}
```

Run: `pnpm --filter @touchline/calibrate test tune`
Expected: 8 passed (every knob, the two new ones included, changes the parameters when moved)

- [ ] **Step 6: Recalibrate in three one-round chunks**

```bash
pnpm calibrate --from data/params/calibration-start.json --matches 12 --rounds 1 --out out/calib-1.json
pnpm calibrate --from out/calib-1.json --matches 12 --rounds 1 --out out/calib-2.json
pnpm calibrate --from out/calib-2.json --matches 12 --rounds 1      # writes data/params/touchline-params.json
```

Each chunk is one coordinate-search round (about 45 minutes; 12 matches per evaluation) and continues from the previous chunk's knobs, so a stopped run loses at most one round. Keep the machine awake (for example `caffeinate -i` on macOS): a sleeping laptop stretched one earlier run past two hours.

Expected: chunk 1 ends `loss 6.36 after 44 evaluations`; chunks 2 and 3 find no further improvement (`loss 6.36 after 41 evaluations` each), so the search has converged. The last chunk ends `wrote …/data/params/touchline-params.json: loss 6.36 after 41 evaluations`. The search is deterministic, so the knobs should match: decision_scale 0.75, long_bias 1.25, cross_bias 0.375, shot_bias 0, aim_noise 1.55, xg_b0 -1, exec_scale 1.15, reach_margin 0.725, tackle_rate 0.8, foul_per_tackle 0.345, yellow_per_foul 0.15, box_intensity 2, box_carry -0.75, loose_share 0.3, restart_scale 1.25, shape_width 1.35, shape_depth 1.2, shape_speed 0.9, deflect_behind 1, clear_to_touch 0.2

- [ ] **Step 7: Regenerate the realism report**

Run: `pnpm realism --matches 16`
Expected: `Summary: 13 within 1 SD, 3 within 2 SD, 1 off.`; the report lists `More than 30 % from the real mean: Shots on target, share (-42 %), Penalties per match (+75 %), Cards (-42 %).` Corners 8.4 (real 8.1), goal kicks 18.0 (17.0), goals 2.44 (2.71), pass completion 72.5 % (78.1 %). The one statistic marked off is shots on target (20.4 % vs 35.4 %): a known gap, recorded in the README; it needs a shot model with separate block, aim and save steps

- [ ] **Step 8: Refresh the gate baseline and run everything**

Run: `UPDATE_REALISM_BASELINE=1 pnpm --filter @touchline/calibrate test realism-gate`
Expected: 1 passed (the real-target half of the gate must pass: every |z| < 3, loss < 30)

Run: `pnpm turbo run typecheck test --force && uv run --locked --project python/analytics --group dev pytest python/analytics/tests -q`
Expected: `Tasks: 10 successful`; the gate logs about `"loss":7.1`; 10 passed

Run: `pnpm sim --seed 1 --home ironmoor --away saltmarsh && uv run --project python/analytics python -m touchline_analytics.validate_cdf out/m-1`
Expected: `meta: ok`, `event: ok`, `tracking: ok`

- [ ] **Step 9: Update the README**

Apply this change to `README.md` (from the repository root):

````bash
git apply <<'PATCH'
diff --git a/README.md b/README.md
index ce5bbb3..c01f516 100644
--- a/README.md
+++ b/README.md
@@ -20,7 +20,10 @@ The engine is tuned so that simulated matches reproduce real-match statistics me
 ```bash
 uv run --project python/analytics python -m touchline_analytics.idsse      # download into git-ignored data/raw/idsse
 uv run --project python/analytics python -m touchline_analytics.targets    # data/params/targets-idsse.json (aggregates only)
-pnpm calibrate --from data/params/calibration-start.json                   # ~1 h; writes data/params/touchline-params.json
+# tune in one-round chunks (~45 min each, 12 matches per evaluation); the last one writes data/params/touchline-params.json
+pnpm calibrate --from data/params/calibration-start.json --matches 12 --rounds 1 --out out/calib-1.json
+pnpm calibrate --from out/calib-1.json --matches 12 --rounds 1 --out out/calib-2.json
+pnpm calibrate --from out/calib-2.json --matches 12 --rounds 1
 pnpm realism --matches 16                                                  # held-out matches -> docs/realism/realism-report.md
 UPDATE_REALISM_BASELINE=1 pnpm --filter @touchline/calibrate test realism-gate  # refresh data/params/realism-baseline.json
 ```
@@ -42,7 +45,7 @@ Options for `pnpm sim`: `--seed` (0–4294967295), `--home` / `--away` (club ids
 
 ## Status
 
-The engine runs a full match in about 1.5 s and its output passes the CDF validator in strict mode. With the calibrated parameters, 16 held-out simulated matches land within 1 SD of real matches on 13 of 17 statistics and within 2 SD on the rest (see `docs/realism/realism-report.md`). Known gaps: corners (about 2 vs 8 per match) and throw-ins (about 32 vs 44) are low, and goals run slightly high on new seeds.
+The engine runs a full match in about 2 s and its output passes the CDF validator in strict mode. Matches include substitutions, fatigue, first-touch errors, ground duels, keeper claims and punches, blocked crosses and shots, and deflections behind. With the calibrated parameters, 16 held-out simulated matches land within 1 SD of real matches on 13 of 17 statistics and within 2 SD on 3 (see `docs/realism/realism-report.md`); corners (8.4 vs 8.1), goal kicks (18.0 vs 17.0) and goals (2.4 vs 2.7) are close. Known gaps: shots on target are low (20 % vs 35 % of shots; the shot model needs separate block, aim and save steps), cards are low (about 3 vs 5) and penalties high (0.75 vs 0.43).
 
 The realism gate (`packages/calibrate/test/realism-gate.test.ts`) runs 16 more held-out matches (seeds 3000–3015). It fails if any statistic moves more than 3.5 standard errors from the committed baseline, or drifts away from the real targets. After an intended engine change, re-run calibration, the realism report and the baseline refresh, and commit all three.
 
PATCH
````

- [ ] **Step 10: Commit**

```bash
git add packages/sim-core packages/calibrate/src/knobs.ts data/params/calibration-start.json data/params/touchline-params.json data/params/realism-baseline.json docs/realism/realism-report.md README.md
git commit -m "feat(calibrate): keepers let balls run out, shot blocking from IDSSE, recalibrated engine and realism report

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```



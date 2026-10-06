# Touchline Plan 3b — What-If, Advisors and Pitch Control Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the engine and the agents a way to ask "what if?": pitch control and expected threat as metrics; passers that weigh pitch control (closing the pass-completion gap) with a recalibration; re-simulation from any moment with a forced pass, a moved player or a changed tactic; a better-option explainer and a positioning advisor built on it; and MCP tools for all of them.

**Architecture:** An expected-threat (xT) grid is fitted on IDSSE in Python and read in TypeScript. Spearman pitch control is ported to `sim-core` from LaurieOnTracking (MIT), so the engine (passers blend it into their estimate and lean towards kinds of pass with a safe option) and the stats engine (`pitch.ctrl`, `act.xt`) share one implementation. `sim-core` gains what-if re-simulation: the state at any tick (plain or scripted matches), forks with fresh random sub-streams, interventions, and paired comparisons over seeds. A new `packages/advisor` rebuilds a run folder into a re-simulation session and builds the explainer (options scored on paper by pitch control × xT, then played out) and the positioning advisor on it; `packages/mcp-stats` exposes them.

**Tech Stack:** as Plans 2a-3a (TypeScript 5.9.3, Effect 4.0.0, vitest 5.0.3, pnpm 11.27, Turborepo 2.11.6, `@modelcontextprotocol/sdk` 1.32.0, `zod` 4.6.5; Python via uv with kloppy 3.19.0, pytest 9.1.1). No new dependencies.

**Spec:** `docs/superpowers/specs/2026-10-03-touchline-design.md` §5.2 (`act.xt`: 12 × 8 grid fitted offline; `pitch.ctrl`: Spearman model), §5.1.8 (calibration and the realism gate), §5.3 (agents read the match only through MCP tools), §5.3.1 (decision feedback: "does it name the option the decision record ranks first"). Roadmap: `docs/superpowers/plans/2026-10-03-touchline-roadmap.md` (Plan 3b row). Builds on Plan 3a (merged to `main`).

**How code is given:** new files in full; changes to existing files as exact patches applied from the repository root with the `git apply <<'PATCH' … PATCH` block shown, each produced from the verified prototype task by task.

**Verification status:** every task was built and run in full before this plan was written, one commit per task, each commit's tests and type checks green and the whole suite (realism gate included) green at the end; the code blocks reproduce the prototype file for file (checked by replaying the plan on a fresh clone of `main`). Results:
- **xT grid:** fitted on 171 shots and 6,062 passes; it runs from 0.002 deep in a team's own half to 0.38 in front of goal.
- **Pitch control:** matches LaurieOnTracking's Python on six scenarios to 9 decimals; a 21 × 14 map costs about 1.6 ms.
- **Passing:** pitch control predicts which simulated passes arrive, but the gap was mostly clean passes intercepted in flight. The weights plus a faster pass (arriving at 9 m/s) and a recalibration bring completion to 75 % on held-out matches (real 78 %, within 1 SD; it was 73 %).
- **Realism:** 16 of 19 statistics within 1 SD, 3 within 2 SD, none off (was 15 / 4 / 0). Penalties are no longer a gap (0.5 against 0.4 per match). Shots on target remain low (29 % against 35 %).
- **What-if:** a forced-pass comparison over 20 seeds and 20 s takes well under 5 s; identical arms differ by exactly zero.
- **Explainer:** about 0.5 s per pass. On one match the pass played was the best in play 21 times in 30, a clearly better option was found 5 times, and 4 passes could not be checked. The option best on paper was the one that played out better only once in five, which is why the verdict comes from re-simulation.
- **Recalibration time:** three one-round chunks of about 25 minutes each. A first run of three chunks without the arrival-speed knob reached loss 5.04 but left completion at 74 %; that run's knobs are this run's start file, plus the new knob.

## Global Constraints

- All earlier constraints hold: determinism per `(seed, teams, params version, fps, script)`, no Effect inside `sim-core`, pinned versions, no StatsBomb, raw real data never in git (only the xT grid leaves it), one definition shared by Python and TypeScript, no answer sees the future.
- **Ported code carries its licence:** `pitchcontrol.ts` includes LaurieOnTracking's MIT notice verbatim, and `ATTRIBUTION.md` names it (and socceraction's xT method).
- **New engine behaviour is off by default:** `pass.pitchControlWeight` and `pass.safetyWeight` default to 0, so the hand-set priors and every test that uses them are unchanged; only the recalibration (Task 5) turns them on.
- **Re-simulation never changes the match:** what-if works on copies of immutable states with their own random sub-streams; a played match is byte-for-byte the same with or without what-if code.
- **Estimates are labelled as estimates:** what-if answers carry means and standard errors over paired seeds, and the explainer reports a better option only when it is clearly better in play (mean above twice its standard error).
- **The realism gate stays green at every commit;** Task 5 refreshes its baseline in the same commit as the recalibration.

## Review Focus

1. **A what-if that sees the future.** Re-simulating from frame t must use only the state at t; the MCP tools must refuse frames later than what has been ingested (a server started with `--minute 60` must not re-simulate minute 70). *Task 8, `server.test.ts` ("refusing frames past the latest"); Task 7 rebuilds states by playing from kick-off, never from later data.*
2. **A run folder the advisor cannot rebuild faithfully.** Runs made with other parameters, a tampered manifest or a scripted match must be refused or rebuilt exactly, never silently re-simulated from a different match. *Task 7, `advisor.test.ts` (version refused, mismatch detected by comparing event counts, scripted runs rebuilt through the scenario runner).*
3. **Noise passed off as insight.** Over short horizons most plays produce no shot, so a single comparison is noise; a "better option" must be backed by paired seeds and a clear margin. *Task 6 pairs seeds (identical arms differ by exactly zero); Task 7 reports a better option only above twice its standard error.*
4. **Long MCP sessions.** An agent asking about thousands of frames must not exhaust memory. *Task 7, `advisor.test.ts` ("keeps a bounded number of states").*
5. **25 fps runs.** Horizons and sampling counted in ticks must scale with `dt`. *Task 6, `whatif.test.ts` ("plays the same number of seconds at 25 frames per second"); Task 3 samples pitch control every 10 s by ticks of `dt`.*

---

### Task 1: Expected-threat grid fitted on IDSSE

Spec §5.2's `act.xt` needs an expected-threat grid: 12 × 8 cells, seen by the team in possession attacking +x. A cell's value is the chance of shooting from it times the chance such a shot scores, plus the chance of moving the ball on times the value of where moves from it end up, solved by value iteration (Singh 2019, the method of socceraction's MIT-licensed `xthreat` module; our own implementation). IDSSE has no carries, so moves are passes (a failed pass moves the ball nowhere of value). Seven matches hold only 16 non-penalty goals, too few to estimate scoring per cell, so a shot's chance of scoring is the Plan 3a xG model at the cell centre. Each team's attacking direction comes from where it lines up at the period's kick-off (the same rule as the xG/xPass fit). Only the grid is committed. TypeScript reads it with the same cell indexing (shared test vectors in both languages).

**Files:**
- Create: `python/analytics/touchline_analytics/xt.py`, `python/analytics/tests/test_xt.py`, `packages/stats/src/xt.ts`, `packages/stats/test/xt.test.ts`
- Modify: `packages/stats/src/index.ts`, `README.md`, `ATTRIBUTION.md`
- Create (generated): `data/params/xt-grid.json`

**Interfaces:**
- Consumes: Plan 3a's `stats_models` (`_attack_dirs`, `predict`, `shot_features`) and `data/params/stats-models.json`; IDSSE files in `data/raw/idsse` (all seven tracking files, downloaded in Plan 3a).
- Produces: Python `COLS = 12`, `ROWS = 8`, `cell(x, y, attack)`, `cell_centre(i)`, `goal_probs(xg)`, `fit_grid(shots, moves, goal)`, `idsse_actions`, `build`; `data/params/xt-grid.json` (`version`, `cols`, `rows`, `values`, row-major, row 0 at y = -34 for a team attacking +x); TypeScript `interface XtGrid {version, cols, rows, values}`, `class XtError`, `xtGridFromJson(raw)`, `xtCell(grid, x, y, attack)`, `xtAt(grid, x, y, attack)`.

- [ ] **Step 1: Write the failing tests**

Create `python/analytics/tests/test_xt.py`:

```python
import math

from touchline_analytics.xt import COLS, ROWS, cell, cell_centre, fit_grid, goal_probs


def test_cells_are_seen_by_the_team_in_possession():
    # Home attacks +x: the right corner of the attacked goal line is the last column.
    assert cell(52.0, 0.5, 1) == 4 * COLS + 11
    # Away attacks -x: the same spot is deep in its own half, rotated half a turn.
    assert cell(52.0, 0.5, -1) == 3 * COLS + 0
    # Points on the touchlines and goal lines stay on the grid.
    assert cell(52.5, 34.0, 1) == ROWS * COLS - 1
    assert cell(-52.5, -34.0, 1) == 0


def test_cell_centres_round_trip():
    for i in range(COLS * ROWS):
        x, y = cell_centre(i)
        assert cell(x, y, 1) == i


def test_scoring_chance_is_highest_in_front_of_goal():
    xg = {"features": ["distance_10m", "angle_rad", "header", "cone_defenders"], "intercept": -1.0, "coefficients": {"distance_10m": -1.0, "angle_rad": 1.2, "header": -1.4, "cone_defenders": -0.2}}
    g = goal_probs(xg)
    front = cell(48.0, 0.5, 1)
    assert g[front] == max(g)
    assert g[cell(-48.0, 0.5, 1)] < 0.01


def test_value_iteration_passes_threat_back_along_moves():
    n = COLS * ROWS
    goal = [0.0] * n
    a, b, c = 0, 1, 2
    goal[c] = 0.5
    # Cell c: every action is a shot. Cell b: always a pass to c. Cell a: half its passes reach b, half fail.
    shots = [c] * 10
    moves = [(b, c)] * 10 + [(a, b)] * 5 + [(a, None)] * 5
    xt = fit_grid(shots, moves, goal)
    assert math.isclose(xt[c], 0.5)
    assert math.isclose(xt[b], 0.5)
    assert math.isclose(xt[a], 0.25)
    assert xt[3] == 0.0
```

Create `packages/stats/test/xt.test.ts`:

```ts
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"
import { xtAt, xtCell, xtGridFromJson, XtError } from "../src/xt.js"
import { root } from "./helpers.js"

const raw = () => JSON.parse(readFileSync(join(root, "data/params/xt-grid.json"), "utf8"))

describe("expected threat", () => {
  it("index cells as the Python fit does, seen by the team in possession", () => {
    // The same vectors as python/analytics/tests/test_xt.py.
    const g = { cols: 12, rows: 8 }
    expect(xtCell(g, 52.0, 0.5, 1)).toBe(4 * 12 + 11)
    expect(xtCell(g, 52.0, 0.5, -1)).toBe(3 * 12 + 0)
    expect(xtCell(g, 52.5, 34, 1)).toBe(8 * 12 - 1)
    expect(xtCell(g, -52.5, -34, 1)).toBe(0)
  })

  it("load the committed grid: threat highest in front of the attacked goal, mirrored for the away side", () => {
    const g = xtGridFromJson(raw())
    const front = xtAt(g, 48, 1, 1)
    expect(front).toBe(Math.max(...g.values))
    expect(front).toBeGreaterThan(0.25)
    expect(xtAt(g, -48, -1, -1)).toBe(front)
    expect(xtAt(g, -48, 1, 1)).toBeLessThan(0.02)
  })

  it("refuse a malformed grid", () => {
    expect(() => xtGridFromJson({ ...raw(), values: [0.1] })).toThrow(XtError)
    expect(() => xtGridFromJson({ ...raw(), cols: 0 })).toThrow(/cols and rows/)
  })
})
```

- [ ] **Step 2: Run them to make sure they fail**

Run: `uv run --project python/analytics --group dev pytest python/analytics/tests -q`
Expected: a collection error: `ModuleNotFoundError: No module named 'touchline_analytics.xt'`

Run: `pnpm --filter @touchline/stats test xt`
Expected: the file fails to load: `Cannot find module '../src/xt.js'`

- [ ] **Step 3: Write the fit and the reader**

Create `python/analytics/touchline_analytics/xt.py`:

```python
"""Fit the expected-threat (xT) grid on real IDSSE matches (spec §5.2, `act.xt`).

Usage:
  uv run --project python/analytics python -m touchline_analytics.xt      # write data/params/xt-grid.json

Expected threat (Singh, 2019; the method of socceraction's MIT-licensed xthreat module): the pitch is cut into
12 x 8 cells, seen by the team in possession attacking +x. A cell's value is the chance of shooting from it times
the chance a shot from there scores, plus the chance of moving the ball on times the value of where moves from it
end up, solved by iteration. IDSSE has no carries, so moves are passes (a failed pass moves the ball nowhere of
value). Goals are too few (16 non-penalty goals in seven matches) to estimate scoring per cell, so a shot's chance
of scoring is the fitted xG model (data/params/stats-models.json) at the cell centre. Only the grid is written.
"""

from __future__ import annotations

import datetime as dt
import json
from pathlib import Path

from .idsse import MATCHES, PROVENANCE, filenames
from .stats_models import _attack_dirs, predict, shot_features

COLS = 12
ROWS = 8
LENGTH = 105.0
WIDTH = 68.0


def cell(x: float, y: float, attack: int) -> int:
    """Cell index (row-major, row 0 at the right touchline as the team attacks +x) of a point, seen by a team attacking `attack`."""
    xn, yn = attack * x, attack * y
    col = min(COLS - 1, max(0, int((xn + LENGTH / 2) / LENGTH * COLS)))
    row = min(ROWS - 1, max(0, int((yn + WIDTH / 2) / WIDTH * ROWS)))
    return row * COLS + col


def cell_centre(i: int) -> tuple[float, float]:
    """Centre of cell i, for a team attacking +x."""
    row, col = divmod(i, COLS)
    return (-LENGTH / 2 + (col + 0.5) * LENGTH / COLS, -WIDTH / 2 + (row + 0.5) * WIDTH / ROWS)


def goal_probs(xg: dict) -> list[float]:
    """Chance that a shot from each cell centre scores, from the fitted xG model (a foot shot, no defenders in the way)."""
    coefs = [xg["coefficients"][f] for f in xg["features"]]
    return [predict(xg["intercept"], coefs, shot_features(cell_centre(i), 1, False, [])) for i in range(COLS * ROWS)]


def fit_grid(shots: list[int], moves: list[tuple[int, int | None]], goal: list[float], tol: float = 1e-6, max_iter: int = 500) -> list[float]:
    """Solve xT(z) = s(z) g(z) + m(z) sum_z' T(z, z') xT(z') by iteration (z' = None: a failed move)."""
    n = COLS * ROWS
    n_shots = [0] * n
    n_moves = [0] * n
    trans: list[dict[int, int]] = [dict() for _ in range(n)]
    for z in shots:
        n_shots[z] += 1
    for z, end in moves:
        n_moves[z] += 1
        if end is not None:
            trans[z][end] = trans[z].get(end, 0) + 1
    total = [n_shots[z] + n_moves[z] for z in range(n)]
    s = [n_shots[z] / total[z] if total[z] else 0.0 for z in range(n)]
    m = [n_moves[z] / total[z] if total[z] else 0.0 for z in range(n)]
    xt = [0.0] * n
    for _ in range(max_iter):
        new = [s[z] * goal[z] + (m[z] * sum(c / n_moves[z] * xt[e] for e, c in trans[z].items()) if n_moves[z] else 0.0) for z in range(n)]
        diff = max(abs(a - b) for a, b in zip(new, xt))
        xt = new
        if diff < tol:
            break
    return xt


def idsse_actions(root: Path, match_id: str) -> tuple[list[int], list[tuple[int, int | None]]]:
    """Shot cells and pass moves (start cell, end cell or None when the pass failed) of one IDSSE match."""
    from kloppy import sportec

    f = filenames(match_id)
    ev = sportec.load_event(event_data=str(root / f["event"]), meta_data=str(root / f["meta"]), coordinates="secondspectrum")
    tr = sportec.load_tracking(raw_data=str(root / f["tracking"]), meta_data=str(root / f["meta"]), coordinates="secondspectrum", sample_rate=1 / 25)
    first: dict[int, dict[str, list[tuple[float, float]]]] = {}
    for fr in tr.frames:
        if fr.period.id in first:
            continue
        teams: dict[str, list[tuple[float, float]]] = {}
        for pl, c in fr.players_data.items():
            if c.coordinates is not None and c.coordinates.x is not None:
                teams.setdefault(pl.team.team_id, []).append((c.coordinates.x, c.coordinates.y))
        first[fr.period.id] = teams
    attack = _attack_dirs(first)
    shots: list[int] = []
    moves: list[tuple[int, int | None]] = []
    for e in ev.events:
        if e.event_type.name not in ("SHOT", "PASS") or e.team is None or e.coordinates is None or e.coordinates.x is None or e.period.id not in first:
            continue
        a = attack[(e.period.id, e.team.team_id)]
        z = cell(e.coordinates.x, e.coordinates.y, a)
        if e.event_type.name == "SHOT":
            shots.append(z)
        elif e.event_type.name == "PASS":
            ok = e.result is not None and e.result.name == "COMPLETE"
            rc = getattr(e, "receiver_coordinates", None)
            end = cell(rc.x, rc.y, a) if ok and rc is not None and rc.x is not None else None
            moves.append((z, end))
    return shots, moves


def build(root: Path, models: Path) -> dict:
    shots: list[int] = []
    moves: list[tuple[int, int | None]] = []
    for mid in MATCHES:
        s, m = idsse_actions(root, mid)
        print(f"{mid}: {len(s)} shots, {len(m)} passes", flush=True)
        shots += s
        moves += m
    grid = fit_grid(shots, moves, goal_probs(json.loads(models.read_text())["xg"]))
    return {
        "_provenance": {
            **PROVENANCE,
            "matches": list(MATCHES),
            "fitted_at": dt.date.today().isoformat(),
            "method": "expected threat (Singh 2019) by value iteration over passes and shots; scoring chance from the fitted xG model at each cell centre",
            "note": "The grid only; no real event rows.",
        },
        "version": "xt-1",
        "cols": COLS,
        "rows": ROWS,
        "orientation": "attacking +x; row 0 at y = -34; cell (row, col) covers x in [-52.5 + col*105/12, ...), y in [-34 + row*68/8, ...)",
        "shots": len(shots),
        "passes": len(moves),
        "values": [round(v, 6) for v in grid],
    }


if __name__ == "__main__":
    result = build(Path("data/raw/idsse"), Path("data/params/stats-models.json"))
    out = Path("data/params/xt-grid.json")
    out.write_text(json.dumps(result, indent=1) + "\n")
    v = result["values"]
    print(f"wrote {out}: {result['shots']} shots, {result['passes']} passes; xT from {min(v):.4f} to {max(v):.4f}")
```

Create `packages/stats/src/xt.ts`:

```ts
/**
 * Expected threat (xT, spec §5.2 `act.xt`): a 12 x 8 grid fitted on IDSSE in Python
 * (python/analytics/touchline_analytics/xt.py, data/params/xt-grid.json). Cells are seen by the team in
 * possession attacking +x; the cell indexing is the same in both languages (shared test vectors).
 */
import { PITCH } from "@touchline/sim-core"

export interface XtGrid {
  readonly version: string
  readonly cols: number
  readonly rows: number
  /** Row-major, row 0 at y = -34 for a team attacking +x. */
  readonly values: ReadonlyArray<number>
}

export class XtError extends Error {}

export const xtGridFromJson = (raw: unknown): XtGrid => {
  const j = raw as { version?: unknown; cols?: unknown; rows?: unknown; values?: unknown }
  if (typeof j?.version !== "string") throw new XtError("version must be a string")
  if (!Number.isInteger(j.cols) || !Number.isInteger(j.rows) || (j.cols as number) < 1 || (j.rows as number) < 1) throw new XtError("cols and rows must be positive integers")
  const n = (j.cols as number) * (j.rows as number)
  if (!Array.isArray(j.values) || j.values.length !== n || !j.values.every((v) => typeof v === "number" && v >= 0 && v <= 1))
    throw new XtError(`values must be ${n} numbers between 0 and 1`)
  return { version: j.version, cols: j.cols as number, rows: j.rows as number, values: j.values as number[] }
}

/** The cell of a point seen by a team attacking +x (`attack` = 1) or -x (`attack` = -1). */
export const xtCell = (g: Pick<XtGrid, "cols" | "rows">, x: number, y: number, attack: 1 | -1): number => {
  const xn = attack * x
  const yn = attack * y
  const col = Math.min(g.cols - 1, Math.max(0, Math.floor(((xn + PITCH.halfL) / PITCH.length) * g.cols)))
  const row = Math.min(g.rows - 1, Math.max(0, Math.floor(((yn + PITCH.halfW) / PITCH.width) * g.rows)))
  return row * g.cols + col
}

/** Expected threat of having the ball at a point, for a team attacking `attack`. */
export const xtAt = (g: XtGrid, x: number, y: number, attack: 1 | -1): number => g.values[xtCell(g, x, y, attack)]!
```

Apply this change to `packages/stats/src/index.ts` (from the repository root):

```bash
git apply <<'PATCH'
diff --git a/packages/stats/src/index.ts b/packages/stats/src/index.ts
index 2516739..62f6bf4 100644
--- a/packages/stats/src/index.ts
+++ b/packages/stats/src/index.ts
@@ -9,3 +9,4 @@ export * from "./store.js"
 export * from "./stream.js"
 export * from "./summary.js"
 export * from "./query.js"
+export * from "./xt.js"
PATCH
```

- [ ] **Step 4: Run the Python tests**

Run: `uv run --project python/analytics --group dev pytest python/analytics/tests -q`
Expected: 31 passed

- [ ] **Step 5: Fit the grid (about 1 minute)**

Behind a TLS-inspecting proxy Python may reject Hugging Face's certificate; export the system's trusted certificates and point Python at them (do not commit the file):

```bash
security find-certificate -a -p /Library/Keychains/System.keychain /System/Library/Keychains/SystemRootCertificates.keychain > /tmp/certs.pem   # macOS
export SSL_CERT_FILE=/tmp/certs.pem
```

Run: `uv run --project python/analytics python -m touchline_analytics.xt`
Expected: one line per match (`J03WMX: … shots, … passes`), then `wrote data/params/xt-grid.json: 171 shots, 6062 passes; xT from 0.0022 to 0.3808`. The fit is deterministic; the file must match this one except for `fitted_at`:

```json
{
 "_provenance": {
  "dataset": "IDSSE / Sportec Open DFL dataset (2022/23 Bundesliga and 2. Bundesliga)",
  "licence": "CC-BY-4.0",
  "attribution": "Deutsche Fussball Liga (DFL); Bassek et al., Scientific Data (2025), doi:10.1038/s41597-025-04505-y",
  "matches": [
   "J03WMX",
   "J03WN1",
   "J03WOH",
   "J03WOY",
   "J03WPY",
   "J03WQQ",
   "J03WR9"
  ],
  "fitted_at": "2026-10-06",
  "method": "expected threat (Singh 2019) by value iteration over passes and shots; scoring chance from the fitted xG model at each cell centre",
  "note": "The grid only; no real event rows."
 },
 "version": "xt-1",
 "cols": 12,
 "rows": 8,
 "orientation": "attacking +x; row 0 at y = -34; cell (row, col) covers x in [-52.5 + col*105/12, ...), y in [-34 + row*68/8, ...)",
 "shots": 171,
 "passes": 6062,
 "values": [
  0.002899,
  0.004185,
  0.005027,
  0.005615,
  0.005973,
  0.006849,
  0.008707,
  0.012551,
  0.014514,
  0.021859,
  0.039392,
  0.040372,
  0.003744,
  0.005293,
  0.005769,
  0.01003,
  0.006547,
  0.008603,
  0.011153,
  0.011056,
  0.018868,
  0.024974,
  0.054197,
  0.067196,
  0.004936,
  0.006111,
  0.006363,
  0.006689,
  0.007116,
  0.007687,
  0.010734,
  0.014087,
  0.028792,
  0.037161,
  0.042048,
  0.063332,
  0.008335,
  0.010581,
  0.006412,
  0.006864,
  0.0063,
  0.00702,
  0.00747,
  0.011177,
  0.017677,
  0.039405,
  0.127216,
  0.335337,
  0.00663,
  0.005449,
  0.006566,
  0.006809,
  0.006143,
  0.008164,
  0.012723,
  0.013589,
  0.017956,
  0.03796,
  0.137857,
  0.380845,
  0.004339,
  0.004745,
  0.006919,
  0.006003,
  0.006467,
  0.006987,
  0.009522,
  0.01249,
  0.015892,
  0.020711,
  0.064689,
  0.059857,
  0.004531,
  0.004972,
  0.006767,
  0.006538,
  0.005505,
  0.008783,
  0.008649,
  0.009166,
  0.015325,
  0.022606,
  0.024353,
  0.028312,
  0.002169,
  0.00458,
  0.004984,
  0.009653,
  0.005947,
  0.008513,
  0.007184,
  0.008062,
  0.01133,
  0.014268,
  0.030882,
  0.026027
 ]
}
```

- [ ] **Step 6: Run the TypeScript tests**

Run: `pnpm --filter @touchline/stats test xt`
Expected: 3 passed (threat is highest in front of the attacked goal and mirrored for the away side)

- [ ] **Step 7: Document it**

Apply this change to `README.md`, `ATTRIBUTION.md` (from the repository root):

````bash
git apply <<'PATCH'
diff --git a/ATTRIBUTION.md b/ATTRIBUTION.md
index d37c89a..1d68ca8 100644
--- a/ATTRIBUTION.md
+++ b/ATTRIBUTION.md
@@ -7,6 +7,7 @@ Touchline's simulator is original code. These projects and papers shaped its des
 | [tbleckert/football-simulator](https://github.com/tbleckert/football-simulator) | MIT | Ideas: typed event taxonomy, restart phase machine, intents with durations, injectable RNG |
 | [ZOXEXIVO/open-football](https://github.com/ZOXEXIVO/open-football) | Apache-2.0 | Ideas: constant-bearing interception, 3D ball physics, per-match plausibility bands |
 | Spearman (2018) pitch control, via [LaurieOnTracking](https://github.com/Friends-of-Tracking-Data-FoTD/LaurieOnTracking) | MIT | 0.7 s reaction time in time-to-intercept |
+| Singh (2019) expected threat, via [socceraction](https://github.com/ML-KULeuven/socceraction)'s `xthreat` module | MIT | The method: value iteration over moves and shots on a grid (our implementation, `touchline_analytics/xt.py`) |
 | Reynolds, *Steering Behaviors for Autonomous Characters* (GDC 1999) | — | Arrive, pursue and separation steering |
 | Anzer et al., *Common Data Format (CDF)*, arXiv:2505.15820 | — | Output format (v0.3.2) |
 | [unravelsports/common-data-format-validator](https://github.com/unravelsports/common-data-format-validator) | MIT | CDF validation in CI |
@@ -16,6 +17,6 @@ Touchline's simulator is original code. These projects and papers shaped its des
 
 | Dataset | Licence | How it is used |
 |---|---|---|
-| IDSSE / Sportec Open DFL dataset — © Deutsche Fussball Liga (DFL); Bassek et al., *Scientific Data* (2025), https://doi.org/10.1038/s41597-025-04505-y | CC-BY 4.0 | Downloaded locally into git-ignored `data/raw/`; only aggregate match statistics (`data/params/targets-idsse.json`) and fitted model coefficients (`data/params/stats-models.json`) are committed. These are the targets the engine is tuned to and validated against (`docs/realism/realism-report.md`). |
+| IDSSE / Sportec Open DFL dataset — © Deutsche Fussball Liga (DFL); Bassek et al., *Scientific Data* (2025), https://doi.org/10.1038/s41597-025-04505-y | CC-BY 4.0 | Downloaded locally into git-ignored `data/raw/`; only aggregate match statistics (`data/params/targets-idsse.json`), fitted model coefficients (`data/params/stats-models.json`) and the expected-threat grid (`data/params/xt-grid.json`) are committed. These are the targets the engine is tuned to and validated against (`docs/realism/realism-report.md`). |
 
 The default xG prior (`packages/sim-core/src/params.ts`) is fitted to an approximate public reference xG curve by distance and angle, not to any dataset.
diff --git a/README.md b/README.md
index 5674139..7183b9a 100644
--- a/README.md
+++ b/README.md
@@ -30,11 +30,12 @@ UPDATE_REALISM_BASELINE=1 pnpm --filter @touchline/calibrate test realism-gate
 
 ## Stats models
 
-The stats engine's pass-difficulty (xPass) and expected-goals (xG) models are logistic regressions fitted on the seven IDSSE matches, with features taken from event locations and the tracking frame at that moment (all seven tracking files, ~370 MB each):
+The stats engine's pass-difficulty (xPass) and expected-goals (xG) models are logistic regressions, and its expected-threat (xT) grid is solved by value iteration over passes and shots, fitted on the seven IDSSE matches, with features taken from event locations and the tracking frame at that moment (all seven tracking files, ~370 MB each):
 
 ```bash
 uv run --project python/analytics python -m touchline_analytics.idsse --tracking J03WMX J03WN1 J03WOH J03WOY J03WPY J03WQQ J03WR9
 uv run --project python/analytics python -m touchline_analytics.stats_models   # data/params/stats-models.json (coefficients only)
+uv run --project python/analytics python -m touchline_analytics.xt             # data/params/xt-grid.json (12 x 8 expected-threat grid)
 ```
 
 `pnpm sim` loads `data/params/touchline-params.json` by default (`--params <file>` to override). Every parameter file must carry provenance with an allowed licence; StatsBomb-derived parameters are refused.
PATCH
````

- [ ] **Step 8: Commit**

```bash
git add python/analytics packages/stats data/params/xt-grid.json README.md ATTRIBUTION.md
git commit -m "feat: expected-threat grid fitted on IDSSE and read in TypeScript

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```



### Task 2: Spearman pitch control in sim-core

Pitch control (Spearman 2018) is the probability that each team wins the ball if it is played to a point: each player's time to intercept (keep running at the current velocity for the 0.7 s reaction time, then run at 5 m/s), a sigmoid uncertainty on arrival, and control rates integrated over time until both teams' control sums to 99 %. It is ported from LaurieOnTracking's `calculate_pitch_control_at_target` (MIT; the file carries the licence text verbatim) with its default parameters, and checked against values computed with the original Python on six scenarios. It lives in `sim-core` because the engine will use it (Task 4) as well as the stats engine (Task 3). A 21 × 14 map costs about 1.6 ms.

**Files:**
- Create: `packages/sim-core/src/pitchcontrol.ts`, `packages/sim-core/test/pitchcontrol.test.ts`
- Modify: `packages/sim-core/src/index.ts`, `ATTRIBUTION.md`

**Interfaces:**
- Consumes: `PITCH`, `Vec2` (geometry).
- Produces: `interface PcPlayer {x, y, vx, vy, gk}`, `interface PitchControlParams`, `PC_DEFAULTS`, `interface PitchControl {att, def}`, `pitchControlAt(target, attackers, defenders, ballStart | null, params?)`, `interface PitchControlGrid {cols, rows, att}`, `pitchControlGrid(attackers, defenders, ball, cols = 21, rows = 14, params?)`.

- [ ] **Step 1: Write the failing test**

Create `packages/sim-core/test/pitchcontrol.test.ts`:

```ts
import { describe, expect, it } from "vitest"
import { pitchControlAt, pitchControlGrid, type PcPlayer } from "../src/pitchcontrol.js"

/**
 * Reference values from LaurieOnTracking's calculate_pitch_control_at_target (MIT) with its default parameters,
 * computed once with `uv run --with numpy` on these scenarios.
 */
const CASES: ReadonlyArray<{ name: string; att: PcPlayer[]; def: PcPlayer[]; ball: { x: number; y: number } | null; target: { x: number; y: number }; expected: [number, number] }> = [
  {
    name: "contested ball between a still attacker and a still defender",
    att: [{ x: 10, y: 0, vx: 0, vy: 0, gk: false }],
    def: [{ x: 20, y: 5, vx: 0, vy: 0, gk: false }],
    ball: { x: 0, y: 0 },
    target: { x: 15, y: 0 },
    expected: [0.7528798450015429, 0.2394632351223214]
  },
  {
    name: "an attacker running onto the ball",
    att: [{ x: 10, y: 0, vx: 4, vy: 0, gk: false }, { x: 0, y: 10, vx: 0, vy: 0, gk: false }],
    def: [{ x: 18, y: 3, vx: -1, vy: 0, gk: false }, { x: 25, y: -6, vx: 0, vy: 0, gk: false }],
    ball: { x: 0, y: 0 },
    target: { x: 18, y: 0 },
    expected: [0.26917548662125446, 0.7213442924400689]
  },
  {
    name: "a ball near the defending keeper",
    att: [{ x: 40, y: 5, vx: 3, vy: 0, gk: false }],
    def: [{ x: 51, y: 0, vx: 0, vy: 0, gk: true }, { x: 42, y: -8, vx: 0, vy: 0, gk: false }],
    ball: { x: 30, y: 10 },
    target: { x: 48, y: 2 },
    expected: [0.05226384284978913, 0.9408226769948753]
  },
  {
    name: "a target only the attackers can reach",
    att: [{ x: 5, y: 0, vx: 0, vy: 0, gk: false }],
    def: [{ x: 40, y: 30, vx: 0, vy: 0, gk: false }],
    ball: { x: 0, y: 0 },
    target: { x: 6, y: 1 },
    expected: [1.0, 0.0]
  },
  {
    name: "a target only the defenders can reach",
    att: [{ x: -40, y: -30, vx: 0, vy: 0, gk: false }],
    def: [{ x: 5, y: 0, vx: 0, vy: 0, gk: false }],
    ball: { x: 0, y: 0 },
    target: { x: 6, y: 1 },
    expected: [0.0, 1.0]
  },
  {
    name: "the ball already at the target",
    att: [{ x: 2, y: 0, vx: 0, vy: 2, gk: false }],
    def: [{ x: -1, y: 1, vx: 1, vy: 0, gk: false }, { x: 3, y: 3, vx: 0, vy: 0, gk: false }],
    ball: null,
    target: { x: 1, y: 1 },
    expected: [0.4500938762134725, 0.5427533565212024]
  }
]

describe("pitch control", () => {
  for (const c of CASES)
    it(`matches the reference: ${c.name}`, () => {
      const pc = pitchControlAt(c.target, c.att, c.def, c.ball)
      expect(pc.att).toBeCloseTo(c.expected[0], 9)
      expect(pc.def).toBeCloseTo(c.expected[1], 9)
    })

  it("gives the whole ball to the only team on the pitch", () => {
    expect(pitchControlAt({ x: 0, y: 0 }, [{ x: 1, y: 1, vx: 0, vy: 0, gk: false }], [], null)).toEqual({ att: 1, def: 0 })
    expect(pitchControlAt({ x: 0, y: 0 }, [], [{ x: 1, y: 1, vx: 0, vy: 0, gk: false }], null)).toEqual({ att: 0, def: 1 })
  })

  it("maps a grid: each team controls the area around it", () => {
    const g = pitchControlGrid([{ x: -30, y: 0, vx: 0, vy: 0, gk: false }], [{ x: 30, y: 0, vx: 0, vy: 0, gk: false }], null, 21, 14)
    expect(g.att).toHaveLength(21 * 14)
    const at = (x: number, y: number) => g.att[Math.floor(((y + 34) / 68) * 14) * 21 + Math.floor(((x + 52.5) / 105) * 21)]!
    expect(at(-30, 0)).toBeGreaterThan(0.95)
    expect(at(30, 0)).toBeLessThan(0.05)
    expect(at(0, 0)).toBeGreaterThan(0.3)
    expect(at(0, 0)).toBeLessThan(0.7)
  })
})
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `pnpm --filter @touchline/sim-core test pitchcontrol`
Expected: the file fails to load: `Cannot find module '../src/pitchcontrol.js'`

- [ ] **Step 3: Port the model**

Create `packages/sim-core/src/pitchcontrol.ts`:

```ts
/**
 * Pitch control (Spearman, "Beyond Expected Goals", 2018): the probability that each team gains the ball if it
 * is played to a point. A port of `calculate_pitch_control_at_target` from LaurieOnTracking's
 * Metrica_PitchControl.py (MIT, Friends of Tracking; see ATTRIBUTION.md), with its default parameters.
 * Shared by the engine (passers weigh it, see decide.ts) and the stats engine (`pitch.ctrl`).
 *
 * Ported from LaurieOnTracking (https://github.com/Friends-of-Tracking-Data-FoTD/LaurieOnTracking), whose licence follows:
 *
 * MIT License
 *
 * Copyright (c) 2021 Friends-of-Tracking-Data-FoTD
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in all
 * copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
 * SOFTWARE.
 */
import { PITCH, type Vec2 } from "./geometry.js"

export interface PcPlayer {
  readonly x: number
  readonly y: number
  /** Velocity (m/s); 0 when unknown. */
  readonly vx: number
  readonly vy: number
  /** Keepers control the ball faster (they can catch it). */
  readonly gk: boolean
}

export interface PitchControlParams {
  /** Top speed (m/s). */
  readonly vmax: number
  /** Seconds a player keeps moving at their current velocity before changing course. */
  readonly reactionS: number
  /** Uncertainty (s) in a player's arrival time. */
  readonly ttiSigma: number
  /** Ball-control rates (1/s) for attackers, defenders and keepers. */
  readonly lambdaAtt: number
  readonly lambdaDef: number
  readonly lambdaGk: number
  /** Assumed average ball speed (m/s) for the time of flight. */
  readonly ballSpeed: number
  readonly intDt: number
  readonly maxIntS: number
  readonly convergeTol: number
}

export const PC_DEFAULTS: PitchControlParams = { vmax: 5, reactionS: 0.7, ttiSigma: 0.45, lambdaAtt: 4.3, lambdaDef: 4.3, lambdaGk: 12.9, ballSpeed: 15, intDt: 0.04, maxIntS: 10, convergeTol: 0.01 }

/** A team arriving this long after the other cannot take control (3 x log 10 control time scales). */
const timeToControl = (p: PitchControlParams, lambda: number) => 3 * Math.log(10) * ((Math.sqrt(3) * p.ttiSigma) / Math.PI + 1 / lambda)

const timeToIntercept = (pl: PcPlayer, target: Vec2, p: PitchControlParams): number => {
  const rx = pl.x + pl.vx * p.reactionS
  const ry = pl.y + pl.vy * p.reactionS
  return p.reactionS + Math.hypot(target.x - rx, target.y - ry) / p.vmax
}

export interface PitchControl {
  /** Probability the attacking team (the one playing the ball) gains it at the target. */
  readonly att: number
  readonly def: number
}

/**
 * Pitch control at `target` for a ball played from `ballStart` (null: the ball is already there). The integration
 * stops once both teams' control sums to 1 - convergeTol, as in the reference.
 */
export const pitchControlAt = (target: Vec2, attackers: ReadonlyArray<PcPlayer>, defenders: ReadonlyArray<PcPlayer>, ballStart: Vec2 | null, p: PitchControlParams = PC_DEFAULTS): PitchControl => {
  if (attackers.length === 0 || defenders.length === 0) return attackers.length ? { att: 1, def: 0 } : { att: 0, def: 1 }
  const travel = ballStart === null ? 0 : Math.hypot(target.x - ballStart.x, target.y - ballStart.y) / p.ballSpeed
  const att = attackers.map((pl) => ({ tti: timeToIntercept(pl, target, p), lambda: p.lambdaAtt, ppcf: 0 }))
  const def = defenders.map((pl) => ({ tti: timeToIntercept(pl, target, p), lambda: pl.gk ? p.lambdaGk : p.lambdaDef, ppcf: 0 }))
  const tauAtt = Math.min(...att.map((a) => a.tti))
  const tauDef = Math.min(...def.map((d) => d.tti))
  const ttcAtt = timeToControl(p, p.lambdaAtt)
  const ttcDef = timeToControl(p, p.lambdaDef)
  if (tauAtt - Math.max(travel, tauDef) >= ttcDef) return { att: 0, def: 1 }
  if (tauDef - Math.max(travel, tauAtt) >= ttcAtt) return { att: 1, def: 0 }
  const a = att.filter((x) => x.tti - tauAtt < ttcAtt)
  const d = def.filter((x) => x.tti - tauDef < ttcDef)
  const k = (Math.PI / Math.sqrt(3)) / p.ttiSigma
  const steps = Math.floor((p.maxIntS + p.intDt) / p.intDt - 1e-9) + 1
  let prevAtt = 0
  let prevDef = 0
  let i = 1
  for (; i < steps && 1 - (prevAtt + prevDef) > p.convergeTol; i++) {
    const t = travel - p.intDt + i * p.intDt
    let sumAtt = 0
    let sumDef = 0
    for (const x of a) {
      x.ppcf += (1 - prevAtt - prevDef) * (1 / (1 + Math.exp(-k * (t - x.tti)))) * x.lambda * p.intDt
      sumAtt += x.ppcf
    }
    for (const x of d) {
      x.ppcf += (1 - prevAtt - prevDef) * (1 / (1 + Math.exp(-k * (t - x.tti)))) * x.lambda * p.intDt
      sumDef += x.ppcf
    }
    prevAtt = sumAtt
    prevDef = sumDef
  }
  return { att: prevAtt, def: prevDef }
}

export interface PitchControlGrid {
  readonly cols: number
  readonly rows: number
  /** Attacking control per cell, row-major, row 0 at y = -34, column 0 at x = -52.5. */
  readonly att: ReadonlyArray<number>
}

/** Pitch control for the attacking team at every cell centre of a cols x rows grid, for a ball played from `ball`. */
export const pitchControlGrid = (attackers: ReadonlyArray<PcPlayer>, defenders: ReadonlyArray<PcPlayer>, ball: Vec2 | null, cols = 21, rows = 14, p: PitchControlParams = PC_DEFAULTS): PitchControlGrid => {
  const att: number[] = []
  for (let r = 0; r < rows; r++)
    for (let c = 0; c < cols; c++) {
      const target = { x: -PITCH.halfL + ((c + 0.5) * PITCH.length) / cols, y: -PITCH.halfW + ((r + 0.5) * PITCH.width) / rows }
      att.push(pitchControlAt(target, attackers, defenders, ball, p).att)
    }
  return { cols, rows, att }
}
```

Apply this change to `packages/sim-core/src/index.ts` (from the repository root):

```bash
git apply <<'PATCH'
diff --git a/packages/sim-core/src/index.ts b/packages/sim-core/src/index.ts
index b364096..0776879 100644
--- a/packages/sim-core/src/index.ts
+++ b/packages/sim-core/src/index.ts
@@ -17,3 +17,4 @@ export * from "./deflect.js"
 export * from "./gamestate.js"
 export * from "./script.js"
 export * from "./runner.js"
+export * from "./pitchcontrol.js"
PATCH
```

- [ ] **Step 4: Run the test**

Run: `pnpm --filter @touchline/sim-core test pitchcontrol`
Expected: 8 passed (every scenario matches the reference to 9 decimals)

- [ ] **Step 5: Credit the source**

Apply this change to `ATTRIBUTION.md` (from the repository root):

```bash
git apply <<'PATCH'
diff --git a/ATTRIBUTION.md b/ATTRIBUTION.md
index 1d68ca8..a334ac0 100644
--- a/ATTRIBUTION.md
+++ b/ATTRIBUTION.md
@@ -1,12 +1,12 @@
 # Attribution
 
-Touchline's simulator is original code. These projects and papers shaped its design; no code was copied from them.
+Touchline's simulator is original code. These projects and papers shaped its design; no code was copied from them, except the pitch-control model, which is ported from LaurieOnTracking (MIT, below).
 
 | Source | Licence | What we took |
 |---|---|---|
 | [tbleckert/football-simulator](https://github.com/tbleckert/football-simulator) | MIT | Ideas: typed event taxonomy, restart phase machine, intents with durations, injectable RNG |
 | [ZOXEXIVO/open-football](https://github.com/ZOXEXIVO/open-football) | Apache-2.0 | Ideas: constant-bearing interception, 3D ball physics, per-match plausibility bands |
-| Spearman (2018) pitch control, via [LaurieOnTracking](https://github.com/Friends-of-Tracking-Data-FoTD/LaurieOnTracking) | MIT | 0.7 s reaction time in time-to-intercept |
+| Spearman (2018) pitch control, via [LaurieOnTracking](https://github.com/Friends-of-Tracking-Data-FoTD/LaurieOnTracking) (© 2021 Friends-of-Tracking-Data-FoTD) | MIT | `calculate_pitch_control_at_target` ported to TypeScript with its default parameters (`packages/sim-core/src/pitchcontrol.ts`, checked against values from the original); the 0.7 s reaction time in time-to-intercept |
 | Singh (2019) expected threat, via [socceraction](https://github.com/ML-KULeuven/socceraction)'s `xthreat` module | MIT | The method: value iteration over moves and shots on a grid (our implementation, `touchline_analytics/xt.py`) |
 | Reynolds, *Steering Behaviors for Autonomous Characters* (GDC 1999) | — | Arrive, pursue and separation steering |
 | Anzer et al., *Common Data Format (CDF)*, arXiv:2505.15820 | — | Output format (v0.3.2) |
PATCH
```

- [ ] **Step 6: Commit**

```bash
git add packages/sim-core ATTRIBUTION.md
git commit -m "feat(sim-core): Spearman pitch control ported from LaurieOnTracking (MIT), checked against the reference

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```



### Task 3: `act.xt` and `pitch.ctrl` in the stats engine

Two more metrics of spec §5.2. Expected threat added (`act.xt`): every completed pass and every carry adds xT at its end minus xT at its start, for the player and the team (windowable; the value is also kept on the event for the MCP tools). Pitch control (`pitch.ctrl`): every 10 s, with the team checks, the engine maps pitch control over a 21 × 14 grid from the frame (velocities from the last 0.5 s of positions, keepers from the roster), as if the ball were at each cell; a team's value is its share of the pitch, over a window the mean of the samples. The maps are kept (one per 10 s, about 300 numbers each) for an MCP tool in Task 8. The xT grid is an optional third argument of `StatsEngine`; `pnpm stats` and the MCP server load it. The golden match gains the four new values (its signals are unchanged).

**Files:**
- Create: `packages/stats/test/value.test.ts`
- Modify: `packages/schema/src/stats.ts` (two metric ids), `packages/stats/src/catalog.ts`, `packages/stats/src/engine.ts`, `packages/stats/src/summary.ts`, `packages/stats/src/cli.ts`, `packages/stats/test/helpers.ts`, `packages/stats/test/replay.test.ts`, `packages/mcp-stats/src/load.ts`, `packages/mcp-stats/src/cli.ts`, `README.md`
- Regenerate: `packages/stats/test/golden/late-comeback-4245.json`

**Interfaces:**
- Consumes: Task 1's `XtGrid`, `xtAt`; Task 2's `pitchControlGrid`, `PcPlayer`.
- Produces: `MetricId` gains `act.xt` and `pitch.ctrl`; `new StatsEngine(info, models, xt: XtGrid | null = null)`; `engine.pitchControl(at): {tick, cols, rows, home: number[]} | null` (home's control per cell; away's is 1 minus it); `derived[eventId]["act.xt"]`; `LoadOptions.xt`; test helper `xtGrid()`.

- [ ] **Step 1: Write the failing tests**

Create `packages/stats/test/value.test.ts`:

```ts
import { describe, expect, it } from "vitest"
import { StatsEngine } from "../src/engine.js"
import { xtAt } from "../src/xt.js"
import { event, frame, INFO, models, xtGrid } from "./helpers.js"

const M = models()
const XT = xtGrid()
const home = { team_id: "home-fc", player_id: "h2" }
const away = { team_id: "away-fc", player_id: "a3" }

describe("expected threat and pitch control", () => {
  it("credit completed passes and carries with the expected threat they add, for the player and the team", () => {
    const eng = new StatsEngine(INFO, M, XT)
    const pass = event("pass", 1, { ...home, x: 0, y: 0, x_end: 40, y_end: 0, frame_id_end: 1, outcome: "successful" })
    const lost = event("pass", 2, { ...home, x: 10, y: 0, x_end: 45, y_end: 0, frame_id_end: 2, outcome: "intercepted" })
    const carry = event("carry", 3, { ...away, x: 0, y: 0, x_end: -20, y_end: 5, frame_id_end: 3 })
    for (const e of [pass, lost, carry]) eng.ingest({ kind: "event", event: e })
    const gain = xtAt(XT, 40, 0, 1) - xtAt(XT, 0, 0, 1)
    expect(gain).toBeGreaterThan(0)
    expect(eng.value("act.xt", "h2")).toBeCloseTo(gain, 12)
    expect(eng.value("act.xt", "home-fc")).toBeCloseTo(gain, 12)
    expect(eng.value("act.xt", "away-fc")).toBeCloseTo(xtAt(XT, -20, 5, -1) - xtAt(XT, 0, 0, -1), 12)
    expect(eng.derived.get(pass.id)!["act.xt"]).toBeCloseTo(gain, 12)
    expect(eng.derived.get(lost.id)!["act.xt"]).toBeUndefined()
    expect(new StatsEngine(INFO, M).value("act.xt", "home-fc")).toBeNull()
  })

  it("measure each team's share of pitch control every 10 s and keep the maps", () => {
    const eng = new StatsEngine(INFO, M, XT)
    // Home spread over the pitch; away huddled in one corner.
    const spread = { h1: { x: -45, y: 0 }, h2: { x: 0, y: 20 }, h3: { x: 0, y: -20 }, a1: { x: 50, y: 30 }, a2: { x: 48, y: 32 }, a3: { x: 46, y: 30 } }
    for (let t = 0; t <= 101; t++) eng.ingest({ kind: "frame", frame: frame(t, spread) })
    expect(eng.value("pitch.ctrl", "home-fc", { at: 50 })).not.toBeNull()
    const homeShare = eng.value("pitch.ctrl", "home-fc")!
    expect(homeShare).toBeGreaterThan(0.75)
    expect(homeShare + eng.value("pitch.ctrl", "away-fc")!).toBeCloseTo(1, 12)
    expect(eng.value("pitch.ctrl", "home-fc", { windowS: 60 })).toBeCloseTo((eng.value("pitch.ctrl", "home-fc", { at: 0 })! + homeShare) / 2, 12)
    const map = eng.pitchControl(100)!
    expect(map).toMatchObject({ tick: 100, cols: 21, rows: 14 })
    expect(map.home).toHaveLength(294)
    expect(eng.pitchControl(99)!.tick).toBe(0)
    expect(new StatsEngine(INFO, M).pitchControl(5)).toBeNull()
  })
})
```

Apply this change to `packages/stats/test/helpers.ts`, `packages/stats/test/replay.test.ts` (from the repository root):

```bash
git apply <<'PATCH'
diff --git a/packages/stats/test/helpers.ts b/packages/stats/test/helpers.ts
index 2c71848..968a07d 100644
--- a/packages/stats/test/helpers.ts
+++ b/packages/stats/test/helpers.ts
@@ -4,9 +4,11 @@ import { fileURLToPath } from "node:url"
 import type { DomainEvent } from "@touchline/schema"
 import type { MatchInfo, TrackFrame, TrackPlayer } from "../src/input.js"
 import { modelsFromJson, type StatsModels } from "../src/models.js"
+import { xtGridFromJson, type XtGrid } from "../src/xt.js"
 
 export const root = join(dirname(fileURLToPath(import.meta.url)), "../../..")
 export const models = (): StatsModels => modelsFromJson(JSON.parse(readFileSync(join(root, "data/params/stats-models.json"), "utf8")))
+export const xtGrid = (): XtGrid => xtGridFromJson(JSON.parse(readFileSync(join(root, "data/params/xt-grid.json"), "utf8")))
 
 /** Two teams of three: a keeper and two outfielders each. */
 export const INFO: MatchInfo = {
diff --git a/packages/stats/test/replay.test.ts b/packages/stats/test/replay.test.ts
index 65e0016..ea29597 100644
--- a/packages/stats/test/replay.test.ts
+++ b/packages/stats/test/replay.test.ts
@@ -13,9 +13,10 @@ import { StatsEngine } from "../src/engine.js"
 import { emittedAt, infoFromConfig, type StatsInput } from "../src/input.js"
 import { readRun, ReplayError } from "../src/replay.js"
 import { signalStream, stepInputs } from "../src/stream.js"
-import { models, root } from "./helpers.js"
+import { models, root, xtGrid } from "./helpers.js"
 
 const M = models()
+const XT = xtGrid()
 const league = JSON.parse(readFileSync(join(root, "data/league/league.json"), "utf8")) as League
 const club = (id: string) => league.clubs.find((c) => c.id === id)!
 const collect = <A, E>(s: Stream.Stream<A, E>) => Effect.runPromise(Stream.runCollect(s)).then((c) => Array.from(c))
@@ -43,10 +44,10 @@ describe("replay and streams", () => {
 
   beforeAll(async () => {
     await Effect.runPromise(writeMatch(cfg, dir))
-    live = new StatsEngine(infoFromConfig(cfg), M)
+    live = new StatsEngine(infoFromConfig(cfg), M, XT)
     liveSignals = await collect(signalStream(live, stepInputs(matchSteps(cfg))))
     const run = await Effect.runPromise(readRun(dir, league))
-    replay = new StatsEngine(run.info, M)
+    replay = new StatsEngine(run.info, M, XT)
     inputs = await collect(run.inputs)
     replaySignals = await collect(signalStream(replay, Stream.fromIterable(inputs)))
   }, 120_000)
@@ -63,7 +64,7 @@ describe("replay and streams", () => {
 
   it("answer a query about tick t the same before and after seeing what came later", () => {
     for (const t of [12_345, 40_000]) {
-      const partial = new StatsEngine(replay.info, M)
+      const partial = new StatsEngine(replay.info, M, XT)
       for (const i of inputs) if ((i.kind === "frame" ? i.frame.tick : emittedAt(i.event)) <= t) partial.ingest(i)
       partial.finish()
       expect(snapshot(partial, t)).toEqual(snapshot(replay, t))
PATCH
```

- [ ] **Step 2: Run them to make sure they fail**

Run: `pnpm --filter @touchline/stats test value`
Expected: 2 failed: `unknown metric "act.xt"` and `unknown metric "pitch.ctrl"`

- [ ] **Step 3: Implement**

Apply this change to `packages/schema/src/stats.ts`, `packages/stats/src/catalog.ts`, `packages/stats/src/engine.ts`, `packages/stats/src/summary.ts`, `packages/stats/src/cli.ts` (from the repository root):

```bash
git apply <<'PATCH'
diff --git a/packages/schema/src/stats.ts b/packages/schema/src/stats.ts
index 6237b2c..027ef69 100644
--- a/packages/schema/src/stats.ts
+++ b/packages/schema/src/stats.ts
@@ -3,7 +3,7 @@ import { Schema } from "effect"
 /** Stable metric ids (spec §5.2); agents cite them in every numeric claim. */
 export const MetricId = Schema.Literals([
   "pass.dist", "pass.acc", "pass.xp", "ball.speed", "shot.speed", "plyr.vmax", "plyr.dist", "shot.xg",
-  "team.mom", "team.press", "ppda", "tilt", "game.chaos", "team.poss"
+  "team.mom", "team.press", "ppda", "tilt", "game.chaos", "team.poss", "act.xt", "pitch.ctrl"
 ])
 export type MetricId = typeof MetricId.Type
 
diff --git a/packages/stats/src/catalog.ts b/packages/stats/src/catalog.ts
index 83c6c17..650ec09 100644
--- a/packages/stats/src/catalog.ts
+++ b/packages/stats/src/catalog.ts
@@ -30,6 +30,8 @@ export const METRICS: ReadonlyArray<MetricDef> = [
   { id: "ppda", name: "PPDA", unit: "passes per action", subjects: ["team"], windowed: true, defaultWindowS: null, description: "Opponent passes in their own 60 % of the pitch per defensive action there (tackles, interceptions, fouls)." },
   { id: "tilt", name: "Field tilt", unit: "share", subjects: ["team"], windowed: true, defaultWindowS: null, description: "The team's share of passes made in the attacking third." },
   { id: "game.chaos", name: "Control vs chaos", unit: "index 0..1", subjects: ["match"], windowed: false, defaultWindowS: null, description: "Last 5 minutes: turnover rate, short possession chains and momentum volatility, each scaled to 0..1 and averaged." },
+  { id: "act.xt", name: "Expected threat added", unit: "xT", subjects: ["player", "team"], windowed: true, defaultWindowS: null, description: "Sum over completed passes and carries of expected threat at the end minus at the start (12 x 8 grid fitted on IDSSE by value iteration)." },
+  { id: "pitch.ctrl", name: "Pitch control", unit: "share", subjects: ["team"], windowed: true, defaultWindowS: null, description: "The team's share of the pitch it would win the ball on (Spearman pitch control over a 21 x 14 grid, sampled every 10 s); over a window, the mean of the samples." },
   { id: "team.poss", name: "Possession", unit: "share", subjects: ["team"], windowed: true, defaultWindowS: null, description: "Share of in-play time the team had the ball, from tracking." }
 ]
 
diff --git a/packages/stats/src/cli.ts b/packages/stats/src/cli.ts
index 031fd66..ce4ce75 100644
--- a/packages/stats/src/cli.ts
+++ b/packages/stats/src/cli.ts
@@ -5,6 +5,7 @@ import { Effect, Stream } from "effect"
 import { CliError, cliOptions, exitOnUserError } from "@touchline/sim"
 import { StatsEngine } from "./engine.js"
 import { modelsFromJson } from "./models.js"
+import { xtGridFromJson } from "./xt.js"
 import { readRun, ReplayError, type Roster } from "./replay.js"
 import { signalStream } from "./stream.js"
 import { summary } from "./summary.js"
@@ -21,12 +22,13 @@ exitOnUserError(() => {
   if (o.run === "") throw new CliError("--run is required (a folder written by pnpm sim, e.g. out/m-1)")
 })
 const models = modelsFromJson(JSON.parse(readFileSync(join(root, "data/params/stats-models.json"), "utf8")))
+const xt = xtGridFromJson(JSON.parse(readFileSync(join(root, "data/params/xt-grid.json"), "utf8")))
 const leaguePath = join(root, "data/league/league.json")
 const roster = existsSync(leaguePath) ? (JSON.parse(readFileSync(leaguePath, "utf8")) as Roster) : undefined
 
 const program = Effect.gen(function* () {
   const run = yield* readRun(here(o.run), roster)
-  const engine = new StatsEngine(run.info, models)
+  const engine = new StatsEngine(run.info, models, xt)
   const signals = Array.from(yield* Stream.runCollect(signalStream(engine, run.inputs)))
   if (o.signals) writeFileSync(here(o.signals), signals.map((s) => JSON.stringify(s)).join("\n") + "\n")
   console.log(summary(engine))
diff --git a/packages/stats/src/engine.ts b/packages/stats/src/engine.ts
index c953f12..129c86b 100644
--- a/packages/stats/src/engine.ts
+++ b/packages/stats/src/engine.ts
@@ -1,5 +1,5 @@
 import type { DomainEvent, MetricId, Signal, SignalType } from "@touchline/schema"
-import { attackX, matchClock, PITCH } from "@touchline/sim-core"
+import { attackX, matchClock, PITCH, pitchControlGrid, type PcPlayer } from "@touchline/sim-core"
 
 const PITCH_HALF_L = PITCH.halfL
 import { metricDef, type SubjectKind } from "./catalog.js"
@@ -7,6 +7,7 @@ import { passValues, shotXg } from "./derive.js"
 import { emittedAt, type MatchInfo, type StatsInput, type TeamInfo, type TrackFrame } from "./input.js"
 import type { StatsModels } from "./models.js"
 import { Momentum, threatAt } from "./momentum.js"
+import { xtAt, type XtGrid } from "./xt.js"
 import { Counters, maxBetween, Series } from "./store.js"
 
 /** A query the engine cannot answer (unknown subject, metric not defined for it) or input out of order. */
@@ -110,9 +111,16 @@ export class StatsEngine {
   /** Substitutions awaiting their impact check; a team's changes at the same moment are judged together. */
   private readonly pendingSubs: Array<{ readonly team: TeamInfo; readonly tick: number; readonly events: DomainEvent[] }> = []
 
+  /** The home team's share of pitch control, sampled every 10 s (see pitchControl). */
+  private readonly pcSamples = new Series()
+  private readonly pcGrids: Array<{ readonly tick: number; readonly home: ReadonlyArray<number> }> = []
+  private readonly gkIds: ReadonlySet<string>
+
   constructor(
     readonly info: MatchInfo,
-    readonly models: StatsModels
+    readonly models: StatsModels,
+    /** The expected-threat grid; without it `act.xt` has no value. */
+    readonly xt: XtGrid | null = null
   ) {
     for (const t of [info.home, info.away]) {
       this.teamById.set(t.id, t)
@@ -121,6 +129,7 @@ export class StatsEngine {
     this.speedWindow = Math.max(1, Math.round(0.5 / info.dt))
     this.ballWindow = Math.max(1, Math.round(0.2 / info.dt))
     this.momentum = new Momentum(info.dt)
+    this.gkIds = new Set([...info.home.players, ...info.away.players].filter((p) => p.role === "GK").map((p) => p.id))
   }
 
   opponentOf(team: TeamInfo): TeamInfo {
@@ -232,7 +241,10 @@ export class StatsEngine {
         if (team) this.counters.add("pressures", team.id, tick, 1)
         break
       case "carry":
-        if (team && e.x !== null && e.y !== null && e.x_end !== null && e.y_end !== null) this.addThreat(team, tick, e.x, e.y, e.x_end, e.y_end)
+        if (team && e.x !== null && e.y !== null && e.x_end !== null && e.y_end !== null) {
+          this.addThreat(team, tick, e.x, e.y, e.x_end, e.y_end)
+          this.addXt(e, tick, team)
+        }
         break
       case "possession_change":
         this.counters.add("turnovers", "match", tick, 1)
@@ -273,7 +285,19 @@ export class StatsEngine {
     const ax = attackX(team.side, e.x!)
     if (ax < PPDA_LINE_X) this.counters.add("ppda_passes", this.opponentOf(team).id, tick, 1)
     if (ax > FINAL_THIRD_X) this.counters.add("final_third", team.id, tick, 1)
-    if (ok) this.addThreat(team, tick, e.x!, e.y!, e.x_end!, e.y_end!)
+    if (ok) {
+      this.addThreat(team, tick, e.x!, e.y!, e.x_end!, e.y_end!)
+      this.addXt(e, tick, team)
+    }
+  }
+
+  /** Expected threat added by a completed pass or a carry: xT at its end minus xT at its start. */
+  private addXt(e: DomainEvent, tick: number, team: TeamInfo): void {
+    if (!this.xt || e.x === null || e.y === null || e.x_end === null || e.y_end === null) return
+    const attack = team.side === "home" ? 1 : -1
+    const gain = xtAt(this.xt, e.x_end, e.y_end, attack) - xtAt(this.xt, e.x, e.y, attack)
+    this.derived.set(e.id, { ...(this.derived.get(e.id) ?? {}), "act.xt": gain })
+    for (const subject of [e.player_id, team.id]) if (subject !== null) this.counters.add("xt", subject, tick, gain)
   }
 
   /** A tackle, interception or foul in the opponent's own 60 % of the pitch counts for PPDA. */
@@ -405,6 +429,7 @@ export class StatsEngine {
     const w = this.ticks(DYNAMICS_WINDOW_S)
     const home = this.momentum.share(this.info.home.id, this.info.away.id, t)
     if (home !== null) this.momSamples.push(t, home)
+    this.samplePitchControl(f)
     const r3 = (v: number) => Math.round(v * 1000) / 1000
 
     for (const team of [this.info.home, this.info.away]) {
@@ -471,6 +496,38 @@ export class StatsEngine {
     }
   }
 
+  /** Pitch control of the home team over the whole pitch (a 21 x 14 grid), with velocities from the last 0.5 s. */
+  private samplePitchControl(f: TrackFrame): void {
+    const players = (list: TrackFrame["home"]): PcPlayer[] =>
+      list.map((p) => {
+        const hist = this.recent.get(p.id) ?? []
+        const a = hist[0]
+        const span = a ? (f.tick - a.tick) * this.info.dt : 0
+        return { x: p.x, y: p.y, vx: a && span > 0 ? (p.x - a.x) / span : 0, vy: a && span > 0 ? (p.y - a.y) / span : 0, gk: this.gkIds.has(p.id) }
+      })
+    const grid = pitchControlGrid(players(f.home), players(f.away), null)
+    this.pcGrids.push({ tick: f.tick, home: grid.att })
+    this.pcSamples.push(f.tick, grid.att.reduce((a, b) => a + b, 0) / grid.att.length)
+  }
+
+  /**
+   * The latest pitch-control map at or before `at` (sampled every 10 s): the home team's control in each cell of a
+   * 21 x 14 grid (row-major, row 0 at y = -34, column 0 at x = -52.5); the away team's is 1 minus it.
+   */
+  pitchControl(at: number): { readonly tick: number; readonly cols: number; readonly rows: number; readonly home: ReadonlyArray<number> } | null {
+    let lo = 0
+    let hi = this.pcGrids.length - 1
+    let best = -1
+    while (lo <= hi) {
+      const mid = (lo + hi) >> 1
+      if (this.pcGrids[mid]!.tick <= at) {
+        best = mid
+        lo = mid + 1
+      } else hi = mid - 1
+    }
+    return best < 0 ? null : { ...this.pcGrids[best]!, cols: 21, rows: 14 }
+  }
+
   /**
    * Control vs chaos over the 5 minutes to `at`: turnovers per minute, passes per possession (fewer is more
    * chaotic) and the spread of the momentum share, each scaled to 0..1 and averaged. Null in the first minute.
@@ -617,6 +674,24 @@ export class StatsEngine {
       }
       case "game.chaos":
         return this.chaosAt(at)
+      case "act.xt":
+        return this.xt ? this.counters.between("xt", subject, from, at) : null
+      case "pitch.ctrl": {
+        // The latest sample, or over a window the mean of the samples.
+        const home = subject === this.info.home.id
+        const s = this.pcSamples
+        if (from === null) {
+          const i = s.indexAt(at)
+          return i < 0 ? null : home ? s.values[i]! : 1 - s.values[i]!
+        }
+        let sum = 0
+        let n = 0
+        for (let i = s.indexAt(at); i >= 0 && s.ticks[i]! > from; i--) {
+          sum += home ? s.values[i]! : 1 - s.values[i]!
+          n++
+        }
+        return n ? sum / n : null
+      }
       case "team.poss":
         return ratio(this.counters.between("poss", subject, from, at), this.counters.between("inplay", "match", from, at))
       default:
diff --git a/packages/stats/src/summary.ts b/packages/stats/src/summary.ts
index 8955536..3d81ceb 100644
--- a/packages/stats/src/summary.ts
+++ b/packages/stats/src/summary.ts
@@ -2,7 +2,7 @@ import type { MetricId } from "@touchline/schema"
 import { metricDef } from "./catalog.js"
 import type { StatsEngine } from "./engine.js"
 
-const TEAM_METRICS: ReadonlyArray<MetricId> = ["team.poss", "pass.acc", "pass.xp", "pass.dist", "shot.xg", "shot.speed", "team.press", "ppda", "tilt", "team.mom", "plyr.dist"]
+const TEAM_METRICS: ReadonlyArray<MetricId> = ["team.poss", "pass.acc", "pass.xp", "pass.dist", "shot.xg", "shot.speed", "team.press", "ppda", "tilt", "team.mom", "act.xt", "pitch.ctrl", "plyr.dist"]
 
 const fmt = (v: number | null, unit: string) => (v === null ? "-" : unit === "share" ? `${(v * 100).toFixed(1)} %` : unit === "m" && v > 1000 ? `${(v / 1000).toFixed(1)} km` : v.toFixed(2))
 
PATCH
```

Apply this change to `packages/mcp-stats/src/load.ts`, `packages/mcp-stats/src/cli.ts` (from the repository root):

```bash
git apply <<'PATCH'
diff --git a/packages/mcp-stats/src/cli.ts b/packages/mcp-stats/src/cli.ts
index 1bd7ba6..3b2eecf 100644
--- a/packages/mcp-stats/src/cli.ts
+++ b/packages/mcp-stats/src/cli.ts
@@ -6,7 +6,7 @@ import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js"
 import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js"
 import { Effect } from "effect"
 import { CliError, cliOptions, exitOnUserError, integer } from "@touchline/sim"
-import { modelsFromJson, ReplayError, type Roster, type StatsQuery } from "@touchline/stats"
+import { modelsFromJson, ReplayError, xtGridFromJson, type Roster, type StatsQuery } from "@touchline/stats"
 import { loadRun } from "./load.js"
 import { createStatsServer } from "./server.js"
 
@@ -24,6 +24,7 @@ exitOnUserError(() => {
   if (o.run === "") throw new CliError("--run is required (a folder written by pnpm sim, e.g. out/m-1)")
 })
 const models = modelsFromJson(JSON.parse(readFileSync(join(root, "data/params/stats-models.json"), "utf8")))
+const xt = xtGridFromJson(JSON.parse(readFileSync(join(root, "data/params/xt-grid.json"), "utf8")))
 const leaguePath = join(root, "data/league/league.json")
 const roster = existsSync(leaguePath) ? (JSON.parse(readFileSync(leaguePath, "utf8")) as Roster) : undefined
 
@@ -49,7 +50,7 @@ const serveHttp = (q: StatsQuery, port: number) => {
   })
 }
 
-Effect.runPromise(loadRun(here(o.run), models, { ...(o.minute ? { minute: Number(o.minute) } : {}), ...(roster ? { roster } : {}) }))
+Effect.runPromise(loadRun(here(o.run), models, { xt, ...(o.minute ? { minute: Number(o.minute) } : {}), ...(roster ? { roster } : {}) }))
   .then(async (q) => {
     if (o.http !== "") serveHttp(q, Number(o.http))
     else {
diff --git a/packages/mcp-stats/src/load.ts b/packages/mcp-stats/src/load.ts
index 9675293..f399ddd 100644
--- a/packages/mcp-stats/src/load.ts
+++ b/packages/mcp-stats/src/load.ts
@@ -1,5 +1,5 @@
 import { Effect, Stream } from "effect"
-import { emittedAt, readRun, StatsEngine, StatsQuery, type ReplayError, type Roster, type StatsInput, type StatsModels } from "@touchline/stats"
+import { emittedAt, readRun, StatsEngine, StatsQuery, type ReplayError, type Roster, type StatsInput, type StatsModels, type XtGrid } from "@touchline/stats"
 
 export interface LoadOptions {
   /**
@@ -8,13 +8,15 @@ export interface LoadOptions {
    */
   readonly minute?: number
   readonly roster?: Roster
+  /** The expected-threat grid (without it `act.xt` has no value). */
+  readonly xt?: XtGrid
 }
 
 /** Replay a run folder into a stats engine (up to a minute, if given) and wrap it for queries. */
 export const loadRun = (dir: string, models: StatsModels, opts: LoadOptions = {}): Effect.Effect<StatsQuery, ReplayError> =>
   Effect.gen(function* () {
     const run = yield* readRun(dir, opts.roster)
-    const engine = new StatsEngine(run.info, models)
+    const engine = new StatsEngine(run.info, models, opts.xt ?? null)
     const minute = opts.minute
     const ticksPerMin = 60 / run.info.dt
     // The last tick to take: known for the first half up front, for the second once its first frame arrives.
PATCH
```

- [ ] **Step 4: Refresh the golden match and run the tests**

Run: `UPDATE_STATS_GOLDEN=1 pnpm --filter @touchline/stats test replay && pnpm --filter @touchline/stats test && pnpm --filter @touchline/mcp-stats test && pnpm --filter @touchline/schema test`
Expected: 6 passed; 47 passed; 14 passed; 3 passed. The golden file gains `act.xt|…` and `pitch.ctrl|…` for both teams and nothing else

Run: `pnpm sim --seed 7 && pnpm stats --run out/m-7`
Expected: the table gains `Expected threat added (act.xt)` (1.75 / 1.21) and `Pitch control (pitch.ctrl)` (the last sample)

- [ ] **Step 5: Document it**

Apply this change to `README.md` (from the repository root):

````bash
git apply <<'PATCH'
diff --git a/README.md b/README.md
index 7183b9a..b5f24fb 100644
--- a/README.md
+++ b/README.md
@@ -44,7 +44,7 @@ Options for `pnpm sim`: `--seed` (0–4294967295), `--home` / `--away` (club ids
 
 ## Stats engine
 
-`packages/stats` turns the domain stream into the metrics of spec §5.2 (pass distance, accuracy and xPass, shot xG and speed, top speed and distance, possession, pressure index, PPDA, field tilt, momentum, control vs chaos) and raises signals when thresholds are crossed (goals, big chances, pressure shifts, momentum swings, chaos spikes, speed and distance alerts, difficult passes, milestones, cards, substitution impact). It is incremental and deterministic: every value is kept as of every tick, so a question about minute 60 gets the same answer during the match and afterwards, and a live run and a replay of its files agree exactly.
+`packages/stats` turns the domain stream into the metrics of spec §5.2 (pass distance, accuracy and xPass, shot xG and speed, top speed and distance, possession, pressure index, PPDA, field tilt, momentum, control vs chaos, expected threat added, pitch control) and raises signals when thresholds are crossed (goals, big chances, pressure shifts, momentum swings, chaos spikes, speed and distance alerts, difficult passes, milestones, cards, substitution impact). It is incremental and deterministic: every value is kept as of every tick, so a question about minute 60 gets the same answer during the match and afterwards, and a live run and a replay of its files agree exactly.
 
 ```bash
 pnpm sim --seed 7                      # writes out/m-7
PATCH
````

- [ ] **Step 6: Commit**

```bash
git add packages/schema packages/stats packages/mcp-stats README.md
git commit -m "feat(stats): expected threat added (act.xt) and pitch control share (pitch.ctrl) with 10-second maps

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```



### Task 4: Pitch-control-aware passing

The simulator completes 73-75 % of passes against 78 % in the IDSSE matches. Measured on simulated passes, pitch control at the target does predict completion (passes it rates under 0.2 arrive a third of the time, over 0.8 four times in five), but weighing it only when choosing between targets barely helps (weight 0.8: 75.5 % to 75.8 %): failed passes come from the kind of pass chosen as much as from the target. So passers get two settings, both off by default: `pass.pitchControlWeight` blends pitch control at the target (from the passer's position, teammates as receivers) into each option's estimate, and `pass.safetyWeight` shifts each kind of pass's logit by how safe its best option is (relative to `SAFETY_PIVOT = 0.75`). With 0.5 and 3 completion reaches about 79 % on the current calibration, at the cost of fewer long passes, which the recalibration (Task 5) rebalances. Both become tuner knobs. With the defaults the engine is unchanged (the realism gate shows no drift).

**Files:**
- Modify: `packages/sim-core/src/decide.ts`, `packages/sim-core/src/params.ts`, `packages/calibrate/src/knobs.ts`
- Test: `packages/sim-core/test/passing.test.ts`

**Interfaces:**
- Consumes: Task 2's `pitchControlAt`, `PcPlayer`.
- Produces: `params.pass.pitchControlWeight` and `params.pass.safetyWeight` (default 0; the weight is a share, range-checked 0..1); `SAFETY_PIVOT`; knobs `pass_pc_weight` (0..0.8, step 0.2) and `pass_safety` (0..6, step 1).

- [ ] **Step 1: Write the failing tests**

Create `packages/sim-core/test/passing.test.ts`:

```ts
import { describe, expect, it } from "vitest"
import { buildCandidates, decide, DEFAULT_PARAMS, initMatch, isFinished, Rng, seedRng, step, type DomainEvent, type Params, type PlayerState } from "../src/index.js"
import { kickoffPlayersFor, makeConfig, STYLES } from "../src/testing.js"

const withPass = (p: Params, pass: Partial<Params["pass"]>): Params => ({ ...p, pass: { ...p.pass, ...pass } })

/** The home centre-back on the ball at (-20, 0), two midfielders 15 m ahead, one with a defender closing in on him. */
const scene = () => {
  const players = kickoffPlayersFor(makeConfig(1))
  const at = (p: PlayerState, x: number, y: number, vx = 0, vy = 0): PlayerState => ({ ...p, pos: { x, y }, vel: { x: vx, y: vy } })
  const home = players.filter((p) => p.side === "home")
  const away = players.filter((p) => p.side === "away").map((p, i) => at(p, 40 + i, i % 2 ? 25 : -25))
  const owner = at(home[2]!, -20, 0)
  const marked = at(home[6]!, -5, 10)
  const free = at(home[7]!, -5, -10)
  // An away midfielder 4 m beyond the marked player, running towards where the ball would go.
  away[5] = at(away[5]!, -2, 13, -3, -2)
  const teammates = home.map((p) => (p.id === owner.id ? owner : p.id === marked.id ? marked : p.id === free.id ? free : at(p, -45 + p.slot, 30)))
  return { owner, marked, free, teammates, opponents: away }
}

describe("pitch-control-aware passing", () => {
  it("rates a pass to a receiver the defenders would reach first lower once passers weigh pitch control", () => {
    const { owner, marked, free, teammates, opponents } = scene()
    const xp = (p: Params, id: string) => buildCandidates({ owner, teammates, opponents, style: STYLES.possession, scoreDiff: 0, minute: 30, restart: null, scriptBias: {} }, p, 0).find((c) => c.receiverId === id && c.kind === "short")!.xpass
    const lanes = DEFAULT_PARAMS
    expect(xp(lanes, marked.id)).toBeCloseTo(xp(lanes, free.id), 2)
    const aware = withPass(DEFAULT_PARAMS, { pitchControlWeight: 0.6 })
    expect(xp(aware, marked.id)).toBeLessThan(xp(aware, free.id) - 0.1)
  })

  it("makes the kinds of pass with a safe option likelier when passers weigh safety", () => {
    const { owner, teammates, opponents } = scene()
    const probs = (p: Params) => decide({ owner, teammates, opponents, style: STYLES.possession, scoreDiff: 0, minute: 30, restart: null, scriptBias: {} }, p, new Rng(seedRng(1))).actionProbs
    const plain = probs(DEFAULT_PARAMS)
    const safe = probs(withPass(DEFAULT_PARAMS, { safetyWeight: 4 }))
    expect(safe.short_pass!).toBeGreaterThan(plain.short_pass!)
    expect(safe.long_pass ?? 0).toBeLessThanOrEqual(plain.long_pass ?? 0)
  })

  it("raises pass completion over whole matches", () => {
    const completion = (p: Params) => {
      let ok = 0
      let n = 0
      for (const seed of [31, 32, 33, 34]) {
        let s = initMatch(makeConfig(seed, { params: p }))
        while (!isFinished(s)) {
          const r = step(s)
          s = r.state
          for (const e of r.events as DomainEvent[]) if (e.type === "pass") (n++, e.outcome === "successful" && ok++)
        }
      }
      return ok / n
    }
    // On the hand-set priors (passes struck to arrive at 7 m/s, often intercepted), so recalibration does not move it.
    const before = completion(DEFAULT_PARAMS)
    const after = completion(withPass(DEFAULT_PARAMS, { pitchControlWeight: 0.5, safetyWeight: 3 }))
    expect(after - before).toBeGreaterThan(0.02)
  })
})
```

- [ ] **Step 2: Run them to make sure they fail**

Run: `pnpm --filter @touchline/sim-core test passing`
Expected: 3 failed: `expected 0.857… to be less than 0.757…` (the marked receiver rated like the free one), `expected 0.662 to be greater than 0.662` (no safety bonus), `expected 0 to be greater than 0.02` (no change in completion)

- [ ] **Step 3: Implement**

Apply this change to `packages/sim-core/src/params.ts`, `packages/sim-core/src/decide.ts` (from the repository root):

```bash
git apply <<'PATCH'
diff --git a/packages/sim-core/src/decide.ts b/packages/sim-core/src/decide.ts
index e9636c1..4713b90 100644
--- a/packages/sim-core/src/decide.ts
+++ b/packages/sim-core/src/decide.ts
@@ -1,6 +1,7 @@
 import { classifyPass, type PassHeight, type PassKind } from "./classify.js"
 import { actionZone, attackX, dirOf, dist, goalAngle, goalOf, PITCH, type Side, type Vec2 } from "./geometry.js"
 import { ACTIONS, type Action, type Params } from "./params.js"
+import { pitchControlAt, type PcPlayer } from "./pitchcontrol.js"
 import type { Rng } from "./rng.js"
 import type { OptionRecord, PlayerState, RestartKind, TeamStyle } from "./types.js"
 
@@ -57,6 +58,8 @@ export interface Decision {
 }
 
 export const OPTIONS_RECORDED = 5
+/** A pass type whose safest option is expected to arrive more (less) often than this gains (loses) logit, by pass.safetyWeight. */
+export const SAFETY_PIVOT = 0.75
 
 const r3 = (v: number): number => Math.round(v * 1000) / 1000
 
@@ -131,12 +134,17 @@ export const buildCandidates = (input: DecisionInput, p: Params, pressure: numbe
   const lastDef = lastDefenderAttackX(side, opponents)
   const out: Candidate[] = []
   const ownerThreat = threat(side, owner.pos)
+  // With a pitch-control weight, a passer blends the lane-based xPass with who would win a ball played there.
+  const w = p.pass.pitchControlWeight
+  const toPc = (pl: PlayerState): PcPlayer => ({ x: pl.pos.x, y: pl.pos.y, vx: pl.vel.x, vy: pl.vel.y, gk: pl.role === "GK" })
+  const pc = w > 0 ? { att: teammates.filter((t) => t.id !== owner.id && !t.sentOff).map(toPc), def: opponents.filter((o) => !o.sentOff).map(toPc) } : null
   const push = (receiver: PlayerState, target: Vec2, height: PassHeight) => {
     const kind = classifyPass({ side, from: owner.pos, to: target, height, lastDefenderAttackX: lastDef }, p.classifier)
     if (kind === "set_piece") return
     const distance = dist(owner.pos, target)
     const lane = defendersInLane(owner.pos, target, opponents)
-    const xp = xpassOf(p, distance, lane, pressure, height)
+    const lanes = xpassOf(p, distance, lane, pressure, height)
+    const xp = pc ? (1 - w) * lanes + w * pitchControlAt(target, pc.att, pc.def, owner.pos).att : lanes
     const value = xp * (0.3 + threat(side, target)) - (1 - xp) * 0.3 * (1 - ownerThreat)
     out.push({ action: KIND_TO_ACTION[kind], kind, receiverId: receiver.id, target, height, xpass: xp, value, lane })
   }
@@ -162,6 +170,8 @@ const softmaxPick = (logits: ReadonlyArray<number>, rng: Rng): number => {
   return rng.weighted(logits.map((l) => (Number.isFinite(l) ? Math.exp(l - m) : 0)))
 }
 
+const NON_PASS: ReadonlyArray<Action> = ["shot", "carry", "hold", "take_on", "clear"]
+
 const RESTART_ACTIONS: Readonly<Record<RestartKind, ReadonlyArray<Action>>> = {
   kickoff: ["short_pass", "back_pass"],
   throw_in: ["short_pass", "back_pass", "through_ball"],
@@ -231,6 +241,12 @@ export const decide = (input: DecisionInput, p: Params, rng: Rng): Decision => {
     if (lateTrailing && (a === "shot" || a === "cross" || a === "long_pass")) l += 0.4
     if (lateLeading && (a === "hold" || a === "back_pass")) l += 0.4
     l += input.scriptBias[a] ?? 0
+    // Passers lean towards the kinds of pass that have a safe option now (and away from those that have none).
+    if (p.pass.safetyWeight > 0 && !NON_PASS.includes(a)) {
+      let best = -Infinity
+      for (const c of candidates) if (c.action === a && c.xpass > best) best = c.xpass
+      if (Number.isFinite(best)) l += p.pass.safetyWeight * (best - SAFETY_PIVOT)
+    }
     return l
   })
   const finite = logits.filter((l) => Number.isFinite(l))
@@ -247,7 +263,6 @@ export const decide = (input: DecisionInput, p: Params, rng: Rng): Decision => {
   if (idx < 0) idx = ACTIONS.indexOf(allowed ? [...allowed][0]! : "hold")
   const action = ACTIONS[idx]!
 
-  const NON_PASS: ReadonlyArray<Action> = ["shot", "carry", "hold", "take_on", "clear"]
   let passOptions = candidates.filter((c) => c.action === action)
   if (NON_PASS.includes(action)) return { action, candidate: null, decisionQuality: null, xg: action === "shot" ? xg : null, pressure, ...record }
   let fallback = false
diff --git a/packages/sim-core/src/params.ts b/packages/sim-core/src/params.ts
index 9068d82..acaad1c 100644
--- a/packages/sim-core/src/params.ts
+++ b/packages/sim-core/src/params.ts
@@ -77,6 +77,16 @@ export interface Params {
     readonly highLaunchDeg: number
     readonly throughLeadM: number
     readonly choiceTemperature: number
+    /**
+     * How much a passer trusts pitch control at the target over the lane-based xPass when weighing options
+     * (0: xPass only; 1: pitch control only). Pitch control sees who can reach the ball first, including runs.
+     */
+    readonly pitchControlWeight: number
+    /**
+     * Logit bonus per unit of the best option's arrival chance (above SAFETY_PIVOT) for each kind of pass: passers
+     * choose the kind of pass by how safe its best option is, not only by habit and pressure.
+     */
+    readonly safetyWeight: number
   }
   readonly execution: {
     readonly dirSigma: number
@@ -257,7 +267,9 @@ export const DEFAULT_PARAMS: Params = {
     arriveSpeed: 7,
     highLaunchDeg: 30,
     throughLeadM: 8,
-    choiceTemperature: 0.35
+    choiceTemperature: 0.35,
+    pitchControlWeight: 0,
+    safetyWeight: 0
   },
   execution: { dirSigma: 0.035, distSigma: 0.07, pressureK: 1.6, weakFootK: 1.45, mishitBase: 0.006, mishitK: 0.11 },
   shot: {
@@ -377,7 +389,7 @@ const PROBABILITIES = new Set([
   "defending.crossBlock", "defending.crossBlockBehind", "defending.headClearShare", "defending.headBehind", "defending.clearToTouch", "defending.clearSliceBehind",
   "keeper.letRunShare", "keeper.comeShare", "keeper.catchBase", "keeper.catchHandling", "keeper.fumbleShare",
   "firstTouch.missedShare", "firstTouch.miscontrolShare", "substitutions.windowChance", "substitutions.halfTimeChance",
-  "fatigue.halfTimeRecovery", "script.howlerFumble"
+  "fatigue.halfTimeRecovery", "script.howlerFumble", "pass.pitchControlWeight"
 ])
 
 /** Check every number: probabilities in 0..1, coefficients any sign, everything else not negative. */
PATCH
```

Apply this change to `packages/calibrate/src/knobs.ts` (from the repository root):

```bash
git apply <<'PATCH'
diff --git a/packages/calibrate/src/knobs.ts b/packages/calibrate/src/knobs.ts
index d37c5f6..6bc0613 100644
--- a/packages/calibrate/src/knobs.ts
+++ b/packages/calibrate/src/knobs.ts
@@ -70,6 +70,10 @@ export const KNOBS: ReadonlyArray<Knob> = [
     }) },
   { name: "save_b0", what: "keeper save model intercept (save rate, shots on target, goals)", init: DEFAULT_PARAMS.shot.save.b0, min: -1, max: 3.5, step: 0.25,
     apply: (p, v) => ({ ...p, shot: { ...p.shot, save: { ...p.shot.save, b0: v } } }) },
+  { name: "pass_pc_weight", what: "weight of pitch control in a passer's estimate of a pass arriving (pass completion)", init: DEFAULT_PARAMS.pass.pitchControlWeight, min: 0, max: 0.8, step: 0.2,
+    apply: (p, v) => ({ ...p, pass: { ...p.pass, pitchControlWeight: v } }) },
+  { name: "pass_safety", what: "how much the safest option of each kind of pass sways the choice of pass (completion, long-pass share)", init: DEFAULT_PARAMS.pass.safetyWeight, min: 0, max: 6, step: 1,
+    apply: (p, v) => ({ ...p, pass: { ...p.pass, safetyWeight: v } }) },
   { name: "clear_to_touch", what: "share of wide clearances kicked into touch (throw-ins)", init: DEFAULT_PARAMS.defending.clearToTouch, min: 0, max: 0.7, step: 0.1,
     apply: (p, v) => ({ ...p, defending: { ...p.defending, clearToTouch: v } }) }
 ]
PATCH
```

- [ ] **Step 4: Run the tests**

Run: `pnpm --filter @touchline/sim-core test passing && pnpm --filter @touchline/calibrate test tune`
Expected: 3 passed (completion over four matches rises by more than 2 points); the knob test sees both new knobs move the parameters

Run: `pnpm turbo run typecheck test --force --filter=@touchline/sim-core --filter=@touchline/calibrate`
Expected: `Tasks: 4 successful`; the realism gate logs `"maxDrift":0` (nothing changes with the defaults)

- [ ] **Step 5: Commit**

```bash
git add packages/sim-core packages/calibrate
git commit -m "feat(sim-core): pitch-control-aware passing — passers blend pitch control into xPass and lean towards kinds of pass with a safe option (off until recalibrated)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```



### Task 5: Recalibrate with pitch-control passing

The tuner gets the two Task 4 knobs and a third: `pass_arrive`, the speed (m/s) ground passes are struck to arrive at. Measured on simulated short passes that pitch control rates above 0.9, more than a quarter still failed, mostly clean passes intercepted in flight: at 7 m/s balls are slow enough for defenders to reach. A first tuning run (three chunks from the Plan 2c knobs with `pass_pc_weight` 0.4 and `pass_safety` 2) reached loss 5.04 but kept completion at 74 %, trading it for the long-pass share; its knobs plus `pass_arrive` = 9 are this run's start file. Two scenario settings follow the new calibration, and the tests that measure them get their old margins back: the push to shoot while a save or goal is forced (`script.forcedShotLogit` 3 → 5, so forced keeper heroics always get their two shots) and the press-surge target (`script.pressTarget` 65 → 55 pressures per 100 opponent passes: the same fixture now presses about 36 per 100 without a script, against 46 before, and about 65 in a surge). The keeper scenario test compares save rates over 12 seeds instead of 6 (few shots reach a well-calibrated target). Neither setting touches plain matches, so the tuning and the realism gate are unaffected. Separately, the tuner and the realism report now make their output folder before any work: in a fresh clone `out/` does not exist, and a chunk used to fail after 25 minutes when writing its result.

**Files:**
- Modify: `packages/calibrate/src/knobs.ts`, `packages/calibrate/src/cli.ts`, `packages/calibrate/src/realism.ts`, `packages/sim-core/src/params.ts` (two script defaults), `README.md`
- Replace: `data/params/calibration-start.json` (full new contents)
- Test: `packages/calibrate/test/cli.test.ts`, `packages/sim-core/test/scenario.test.ts`
- Regenerate: `data/params/touchline-params.json`, `docs/realism/realism-report.md`, `data/params/realism-baseline.json`

**Interfaces:**
- Consumes: Task 4's `pass.pitchControlWeight`, `pass.safetyWeight` and knobs.
- Produces: knob `pass_arrive` (5..12 m/s, step 1); calibrated parameters `calib-<date>` with `pass.pitchControlWeight` 0.4, `pass.safetyWeight` 2, `pass.arriveSpeed` 9; `script.forcedShotLogit` 5 and `script.pressTarget` 55 (defaults and calibrated file); the tuner and `pnpm realism` print `Cannot write to …` (exit 2) when they cannot make their output folder.

- [ ] **Step 1: Write the failing test**

Apply this change to `packages/calibrate/test/cli.test.ts` (from the repository root):

```bash
git apply <<'PATCH'
diff --git a/packages/calibrate/test/cli.test.ts b/packages/calibrate/test/cli.test.ts
index 34cb6b8..bc7b17f 100644
--- a/packages/calibrate/test/cli.test.ts
+++ b/packages/calibrate/test/cli.test.ts
@@ -1,5 +1,5 @@
 import { spawnSync } from "node:child_process"
-import { existsSync, mkdtempSync } from "node:fs"
+import { existsSync, mkdtempSync, writeFileSync } from "node:fs"
 import { tmpdir } from "node:os"
 import { dirname, join } from "node:path"
 import { fileURLToPath } from "node:url"
@@ -32,6 +32,19 @@ describe("calibration command lines", () => {
     const realism = run("src/realism.ts", ["--help"]).stdout
     expect(realism).toMatch(/--out\s.*\(default: [^)]*out\/realism-report\.md\)/)
   })
+  it("the tuner and the realism report make their output folder before any work, and refuse one they cannot make", () => {
+    const base = mkdtempSync(join(tmpdir(), "touchline-cli-"))
+    // The run stops at the missing start file, but the folder for its result already exists.
+    const r = run("src/cli.ts", ["--from", "no-such-start.json", "--out", join(base, "new/sub/params.json")])
+    expect(r.status).toBe(2)
+    expect(existsSync(join(base, "new/sub"))).toBe(true)
+    writeFileSync(join(base, "file"), "")
+    for (const [script, out] of [["src/cli.ts", "file/params.json"], ["src/realism.ts", "file/report.md"]] as const) {
+      const bad = run(script, ["--out", join(base, out)])
+      expect(bad.status, script).toBe(2)
+      expect(bad.stderr.trim()).toMatch(/^Cannot write to /)
+    }
+  })
   it("the tuner reports a missing targets or start file in one line", () => {
     const out = join(mkdtempSync(join(tmpdir(), "touchline-cli-")), "params.json")
     for (const args of [["--targets", "no-such-targets.json"], ["--from", "no-such-start.json"]]) {
PATCH
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `pnpm --filter @touchline/calibrate test cli`
Expected: 1 failed: `expected false to be true` (no output folder was made)

- [ ] **Step 3: Make the output folder first, and add the knob**

Apply this change to `packages/calibrate/src/cli.ts`, `packages/calibrate/src/realism.ts`, `packages/calibrate/src/knobs.ts` (from the repository root):

```bash
git apply <<'PATCH'
diff --git a/packages/calibrate/src/cli.ts b/packages/calibrate/src/cli.ts
index 18ecbfe..ff19122 100644
--- a/packages/calibrate/src/cli.ts
+++ b/packages/calibrate/src/cli.ts
@@ -1,4 +1,4 @@
-import { readFileSync, writeFileSync } from "node:fs"
+import { mkdirSync, readFileSync, writeFileSync } from "node:fs"
 import { dirname, join, resolve } from "node:path"
 import { fileURLToPath } from "node:url"
 import type { League } from "@touchline/league"
@@ -21,6 +21,14 @@ const o = cliOptions("calibrate: tune engine knobs to real-match targets (method
   from: { default: "", help: "start from the calibration.knobs of this file" }
 })
 const outPath = here(o.out)
+// Make the output folder now: a tuning chunk runs for most of an hour and must not fail when it writes its result.
+exitOnUserError(() => {
+  try {
+    mkdirSync(dirname(outPath), { recursive: true })
+  } catch (e) {
+    throw new CliError(`Cannot write to ${o.out}: ${e instanceof Error ? e.message : String(e)}`)
+  }
+})
 const matches = Number(o.matches)
 const rounds = Number(o.rounds)
 /** Read a JSON input file; a missing or malformed file is a one-line error (exit 2). */
diff --git a/packages/calibrate/src/knobs.ts b/packages/calibrate/src/knobs.ts
index 6bc0613..650abb0 100644
--- a/packages/calibrate/src/knobs.ts
+++ b/packages/calibrate/src/knobs.ts
@@ -74,6 +74,8 @@ export const KNOBS: ReadonlyArray<Knob> = [
     apply: (p, v) => ({ ...p, pass: { ...p.pass, pitchControlWeight: v } }) },
   { name: "pass_safety", what: "how much the safest option of each kind of pass sways the choice of pass (completion, long-pass share)", init: DEFAULT_PARAMS.pass.safetyWeight, min: 0, max: 6, step: 1,
     apply: (p, v) => ({ ...p, pass: { ...p.pass, safetyWeight: v } }) },
+  { name: "pass_arrive", what: "ground passes are struck to arrive at this speed (m/s): faster passes are intercepted less but run out more", init: DEFAULT_PARAMS.pass.arriveSpeed, min: 5, max: 12, step: 1,
+    apply: (p, v) => ({ ...p, pass: { ...p.pass, arriveSpeed: v } }) },
   { name: "clear_to_touch", what: "share of wide clearances kicked into touch (throw-ins)", init: DEFAULT_PARAMS.defending.clearToTouch, min: 0, max: 0.7, step: 0.1,
     apply: (p, v) => ({ ...p, defending: { ...p.defending, clearToTouch: v } }) }
 ]
diff --git a/packages/calibrate/src/realism.ts b/packages/calibrate/src/realism.ts
index 6e567c3..513b06e 100644
--- a/packages/calibrate/src/realism.ts
+++ b/packages/calibrate/src/realism.ts
@@ -1,5 +1,5 @@
 import { execFileSync } from "node:child_process"
-import { readFileSync, rmSync } from "node:fs"
+import { mkdirSync, readFileSync, rmSync } from "node:fs"
 import { dirname, join, resolve } from "node:path"
 import { fileURLToPath } from "node:url"
 import { Effect } from "effect"
@@ -16,6 +16,14 @@ const o = cliOptions("realism: simulate held-out matches and write a realism rep
   matches: { default: "10", check: positiveInteger, help: "held-out matches to simulate (seeds 2000+)" },
   params: { default: join(root, "data/params/touchline-params.json"), help: "parameter file, or \"default\" for hand-set priors" }
 })
+// Make the report's folder now, before the matches are simulated.
+exitOnUserError(() => {
+  try {
+    mkdirSync(dirname(here(o.out)), { recursive: true })
+  } catch (e) {
+    throw new CliError(`Cannot write to ${o.out}: ${e instanceof Error ? e.message : String(e)}`)
+  }
+})
 const matches = Number(o.matches)
 const params: Params = exitOnUserError(() => {
   if (o.params === "default") return DEFAULT_PARAMS
PATCH
```

Run: `pnpm --filter @touchline/calibrate test cli tune`
Expected: 5 passed; the knob test sees `pass_arrive` move the parameters

- [ ] **Step 4: Set the start knobs**

Replace `data/params/calibration-start.json`:

```json
{
 "_comment": "Starting knob values for the Plan 3b recalibration (`pnpm calibrate --from data/params/calibration-start.json --matches 12 --rounds 1 --out out/calib-1.json`, then two more chunks): a first Plan 3b tuning run from the Plan 2c calibration with the pitch-control knobs (pass_pc_weight 0.4, pass_safety 2; loss 5.04, completion still 74 %), plus the pass_arrive knob at 9 m/s, which lets passes beat interceptions. Tuning from here is deterministic and reproduces the knobs, loss and statistics in data/params/touchline-params.json (its fitted_at and version carry the date of the run).",
 "calibration": {
  "knobs": {
   "decision_scale": 0.75,
   "long_bias": 1.75,
   "cross_bias": 0.375,
   "shot_bias": 0,
   "aim_noise": 1.35,
   "xg_b0": -0.75,
   "exec_scale": 1.15,
   "reach_margin": 0.725,
   "tackle_rate": 0.8,
   "foul_per_tackle": 0.405,
   "yellow_per_foul": 0.25,
   "box_intensity": 1,
   "box_carry": -0.75,
   "loose_share": 0.3,
   "restart_scale": 1.25,
   "shape_width": 1.35,
   "shape_depth": 1.2,
   "shape_speed": 0.9,
   "deflect_behind": 1,
   "save_b0": 1.8,
   "pass_pc_weight": 0.4,
   "pass_safety": 2,
   "clear_to_touch": 0.1,
   "pass_arrive": 9
  }
 }
}
```

- [ ] **Step 5: Recalibrate in three chunks**

```bash
pnpm calibrate --from data/params/calibration-start.json --matches 12 --rounds 1 --out out/calib-1.json
pnpm calibrate --from out/calib-1.json --matches 12 --rounds 1 --out out/calib-2.json
pnpm calibrate --from out/calib-2.json --matches 12 --rounds 1 --out data/params/touchline-params.json
```

About 25 minutes each; keep the machine awake (`caffeinate -i` on macOS).

Expected: each chunk ends with `loss 5.15 after 49 evaluations` (the first after 50). The search is deterministic, so the knobs should match: decision_scale 0.75, long_bias 1.75, cross_bias 0.375, shot_bias 0, aim_noise 1.35, xg_b0 -0.5, exec_scale 0.85, reach_margin 0.725, tackle_rate 0.8, foul_per_tackle 0.405, yellow_per_foul 0.3, box_intensity 1, box_carry -0.75, loose_share 0.3, restart_scale 1.25, shape_width 1.35, shape_depth 1.2, shape_speed 0.9, deflect_behind 1, save_b0 1.8, pass_pc_weight 0.4, pass_safety 2, pass_arrive 9, clear_to_touch 0.1. On the tuning seeds: completion 75.8 % (real 78.1 %), long-pass share 14.3 % (14.3 %), penalties 0.50 (0.43), shots on target 28.0 % (35.4 %), goals 2.58 (2.71).

- [ ] **Step 6: Retune the two scenario settings and the keeper test**

Apply this change to `packages/sim-core/src/params.ts`, `packages/sim-core/test/scenario.test.ts` (from the repository root):

```bash
git apply <<'PATCH'
diff --git a/packages/sim-core/src/params.ts b/packages/sim-core/src/params.ts
index acaad1c..b20a2d5 100644
--- a/packages/sim-core/src/params.ts
+++ b/packages/sim-core/src/params.ts
@@ -321,8 +321,8 @@ export const DEFAULT_PARAMS: Params = {
   // Hand-set prior with more goals late (refit from Wyscout goal minutes when that data is available); red-card factors from the spec.
   gameState: { minuteProfile: [0.85, 0.95, 1.05, 0.95, 1.05, 1.15], redCardOwn: 0.67, redCardOpponent: 1.2 },
   script: {
-    goalShotLogit: 1.0, goalScoring: 2.0, goalRatePerMin: 0.016, goalScoringMax: 6, goalAimMin: 0.6, pressTarget: 65,
-    momentumLogit: 1.0, momentumPress: 1.3, pressSurge: 4, pressTackle: 2, redFoul: 2, redCard: 125, heroicsSave: 1.5, howlerSave: 1.5, howlerFumble: 0.3, errorMishit: 8, forcedShotLogit: 3
+    goalShotLogit: 1.0, goalScoring: 2.0, goalRatePerMin: 0.016, goalScoringMax: 6, goalAimMin: 0.6, pressTarget: 55,
+    momentumLogit: 1.0, momentumPress: 1.3, pressSurge: 4, pressTackle: 2, redFoul: 2, redCard: 125, heroicsSave: 1.5, howlerSave: 1.5, howlerFumble: 0.3, errorMishit: 8, forcedShotLogit: 5
   },
   // About four changes per team on average (Bundesliga teams make roughly 4-4.5 of their 5).
   substitutions: { windowMinutes: [62, 72, 81], windowSdMin: 5, perWindow: [2, 2, 1], windowChance: [1, 0.8, 0.5], halfTimeChance: 0.2 },
diff --git a/packages/sim-core/test/scenario.test.ts b/packages/sim-core/test/scenario.test.ts
index 7da3b90..6f0223c 100644
--- a/packages/sim-core/test/scenario.test.ts
+++ b/packages/sim-core/test/scenario.test.ts
@@ -79,9 +79,10 @@ describe("nudges raise the scripted outcome's rate", () => {
     expect(reds).toBeGreaterThanOrEqual(4)
   })
   it("keeper heroics and howlers move the team keeper's save rate up and down", () => {
+    // Twelve seeds: with a well-calibrated keeper few shots reach the target, so six give too few to compare.
     const rate = (script?: Script) => {
       let on = 0, saved = 0
-      for (const seed of SEEDS) for (const e of play(cfgFor(seed, script)).filter((x) => x.type === "shot" && x.team_id !== HOME)) {
+      for (const seed of [...SEEDS, 7, 8, 9, 10, 11, 12]) for (const e of play(cfgFor(seed, script)).filter((x) => x.type === "shot" && x.team_id !== HOME)) {
         if (e.outcome === "goal" || e.outcome === "saved") on++
         if (e.outcome === "saved") saved++
       }
PATCH
```

In `data/params/touchline-params.json` set the same two values under `script` (`"pressTarget": 55`, `"forcedShotLogit": 5`); re-running the tuner now writes them itself.

Run: `pnpm --filter @touchline/sim-core test runner scenario && pnpm --filter @touchline/sim test scenarios`
Expected: all pass: forced windows meet their targets, the six built-in scenarios reach their targets without forcing in at least 9 of 10 seeds (a few minutes; run it alone, the scenario tests can time out on a loaded machine)

- [ ] **Step 7: Regenerate the realism report and the gate baseline**

Run: `pnpm realism --matches 16 --out docs/realism/realism-report.md`
Expected: `Summary: 16 within 1 SD, 3 within 2 SD, 0 off.`; pass completion 75.3 % (78.1 %), penalties 0.50 (0.43), shots on target 28.7 % (35.4 %); no statistic more than 30 % from the real mean

Run: `UPDATE_REALISM_BASELINE=1 pnpm --filter @touchline/calibrate test realism-gate`
Expected: 1 passed

Run: `pnpm turbo run typecheck test --force --concurrency=2 && uv run --project python/analytics --group dev pytest python/analytics/tests -q`
Expected: `Tasks: 14 successful` (the gate logs about `"loss":5.54,"maxDrift":0`); 31 passed

- [ ] **Step 8: Update the README**

Apply this change to `README.md` (from the repository root):

```bash
git apply <<'PATCH'
diff --git a/README.md b/README.md
index b5f24fb..c2c4f00 100644
--- a/README.md
+++ b/README.md
@@ -79,7 +79,7 @@ An MCP client can launch it directly, for example: `{"command": "npx", "args": [
 
 ## Status
 
-The engine runs a full match in about 2 s and its output passes the CDF validator in strict mode. Matches include substitutions, fatigue, first-touch errors, ground duels, keeper claims and punches, blocked crosses and shots, deflections behind, and a shot model with separate block, aim and save steps. Scenario scripts (`pnpm sim --scenario late_comeback`) inject tactical causes and record ground truth in the run manifest; `spadl.csv` gives a SPADL view and `--noise on` imitates unsynced real event data. With the calibrated parameters, 16 held-out simulated matches land within 1 SD of real matches on 15 of 19 statistics and within 2 SD on the other 4 (see `docs/realism/realism-report.md`). Known gaps: penalties run high (0.9 vs 0.4 per match), shots on target low (26 % vs 35 %: goal kicks come mostly from wide shots, while about half of real ones follow attacking balls over the byline) and pass completion low (73 % vs 78 %).
+The engine runs a full match in about 2 s and its output passes the CDF validator in strict mode. Matches include substitutions, fatigue, first-touch errors, ground duels, keeper claims and punches, blocked crosses and shots, deflections behind, and a shot model with separate block, aim and save steps. Scenario scripts (`pnpm sim --scenario late_comeback`) inject tactical causes and record ground truth in the run manifest; `spadl.csv` gives a SPADL view and `--noise on` imitates unsynced real event data. With the calibrated parameters, 16 held-out simulated matches land within 1 SD of real matches on 16 of 19 statistics and within 2 SD on the other 3 (see `docs/realism/realism-report.md`). Passers weigh pitch control and the safety of each kind of pass, and ground passes are struck to arrive at 9 m/s, which brought pass completion to 75 % (real 78 %, within 1 SD) and penalties to 0.5 per match (real 0.4). Known gap: shots on target low (29 % vs 35 %: goal kicks come mostly from wide shots, while about half of real ones follow attacking balls over the byline).
 
 The realism gate (`packages/calibrate/test/realism-gate.test.ts`) runs 16 more held-out matches (seeds 3000–3015). It fails if any statistic moves more than 3.5 standard errors from the committed baseline, or drifts away from the real targets. After an intended engine change, re-run calibration, the realism report and the baseline refresh, and commit all three.
 
PATCH
```

- [ ] **Step 9: Commit**

```bash
git add packages/calibrate packages/sim-core data/params docs/realism/realism-report.md README.md
git commit -m "feat(calibrate): recalibration with pitch-control passing and pass arrival speed; output folders made before tuning

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```



### Task 6: What-if re-simulation

What-if is pure `sim-core`, like the engine. `statesAt(cfg, ticks)` gives the match state at any tick (after that tick's step): a plain match by stepping, a scripted one through the scenario runner, which can now keep the accepted match's states (`statesAt` option), so stepping on from them reproduces the match exactly. `forkState(s, k)` gives the k-th fork fresh random sub-streams (`<concern>:whatif`, distinct from the match's and from scenario retries). Interventions: `pass_to` (the player on the ball plays this pass at the next tick; the engine applies an optional `override` on the state and keeps the decision record, with the forced pass ranked among the options), `move_player` (a player stands somewhere else for a second, then plays on), `tactic` (a team's style settings change, range-checked); `none`. `whatIf` plays both arms from each fork for the horizon and reports, for one team, means and standard errors of the goal and xG difference, shots, possession and ball progress at the end, a caller-supplied end-state value and the total of xG difference and end value, plus the paired differences; identical arms differ by exactly zero. Played matches are unaffected (the state has no `override` unless what-if sets one).

**Files:**
- Create: `packages/sim-core/src/whatif.ts`, `packages/sim-core/test/whatif.test.ts`
- Modify: `packages/sim-core/src/types.ts` (`PassOverride`, `MatchState.override?`), `packages/sim-core/src/step.ts`, `packages/sim-core/src/decide.ts` (`overridePass`), `packages/sim-core/src/runner.ts` (`statesAt`), `packages/sim-core/src/index.ts`

**Interfaces:**
- Consumes: the engine's `step`, `initMatch`, `runScript`, `buildCandidates`, `substream`.
- Produces: `interface PassOverride {playerId, receiverId, kind?}`; `overridePass(decision, input, override, params)`; `RunOptions.statesAt`, `ScriptedRun.states`; `type Intervention` (`none` | `pass_to {playerId, receiverId, passKind?}` | `move_player {playerId, to}` | `tactic {side, style}`), `class WhatIfError`, `forkState(s, k)`, `passOptions(s)`, `applyIntervention(s, iv)`, `playAhead(s, ticks)`, `interface Outcome`, `OUTCOME_KEYS`, `type EndValue = (s, side) => number`, `outcomeOf(events, end, side, endValue?)`, `interface Estimate {mean, se}`, `interface WhatIfOptions {side?, seeds?, horizonS?, baseline?, endValue?}`, `interface WhatIfResult`, `whatIf(s, variant, opts?)`, `statesAt(cfg, ticks)`.

- [ ] **Step 1: Write the failing tests**

Create `packages/sim-core/test/whatif.test.ts`:

```ts
import { describe, expect, it } from "vitest"
import { applyIntervention, forkState, initMatch, isFinished, passOptions, playAhead, runScript, statesAt, step, whatIf, WhatIfError, type DomainEvent, type MatchState, type Script } from "../src/index.js"
import { makeConfig } from "../src/testing.js"

const cfg = makeConfig(41)
/** The whole match: its events after each tick, and the states at a few ticks. */
const play = () => {
  let s = initMatch(cfg)
  const events: Array<{ tick: number; e: DomainEvent }> = []
  const states = new Map<number, MatchState>()
  while (!isFinished(s)) {
    const r = step(s)
    s = r.state
    states.set(s.tick, s)
    for (const e of r.events) events.push({ tick: s.tick, e })
  }
  return { events, states }
}
const match = play()
/** The first state from `from` on where a player is on the ball with at least two pass options. */
const onBall = (from: number): MatchState => {
  for (let t = from; ; t++) {
    const s = match.states.get(t)!
    if (s.possession.kind === "owned" && passOptions(s).length >= 2) return s
  }
}

describe("states and forks", () => {
  it("give the match's state at a tick, from which the rest of the match plays out the same", () => {
    const at = statesAt(cfg, [3000, 30_000])
    expect([...at.keys()]).toEqual([3000, 30_000])
    expect(at.get(30_000)).toEqual(match.states.get(30_000))
    const rest = playAhead(at.get(30_000)!, 1_000_000).events
    expect(rest).toEqual(match.events.filter((x) => x.tick > 30_000).map((x) => x.e))
  })

  it("give a scripted match's accepted states, inside and after a retried window", () => {
    const script: Script = { name: "t", entries: [{ window: [10, 25], team: "home", effect: "goal", count: 6 }] }
    const scfg = makeConfig(42, { script })
    const run = runScript(scfg, { retries: 1, statesAt: new Set([9000, 20_000]) })
    expect(run.windows[0]!.attempts).toBeGreaterThan(1)
    const ticksOf = (from: number) => run.steps.flatMap((r) => r.events).filter((e) => Math.max(e.frame_id, e.frame_id_end ?? e.frame_id) > from)
    for (const t of [9000, 20_000]) expect(playAhead(run.states.get(t)!, 1_000_000).events).toEqual(ticksOf(t))
    expect(statesAt(scfg, [20_000]).get(20_000)).toBeDefined()
  })

  it("fork with fresh random streams: forks differ from each other but each is reproducible", () => {
    const s = match.states.get(20_000)!
    const a = playAhead(forkState(s, 0), 300).events
    expect(playAhead(forkState(s, 0), 300).events).toEqual(a)
    expect(playAhead(forkState(s, 1), 300).events).not.toEqual(a)
  })
})

describe("interventions", () => {
  it("make the player on the ball play the pass chosen for them at the next tick", () => {
    const s = onBall(12_000)
    const owner = (s.possession as { playerId: string }).playerId
    const target = passOptions(s).at(-1)!
    const after = applyIntervention(forkState(s, 0), { kind: "pass_to", playerId: owner, receiverId: target.receiverId })
    // A pass event is emitted when the ball arrives; its frame id is the tick it was played.
    const pass = playAhead(after, 100).events.find((e) => e.type === "pass" && e.player_id === owner)!
    expect(pass.attrs.intended_receiver_id).toBe(target.receiverId)
    expect(pass.frame_id).toBe(s.tick + 1)
  })

  it("refuse a pass the player cannot make", () => {
    const s = onBall(12_000)
    const owner = (s.possession as { playerId: string }).playerId
    const mate = s.players.find((p) => p.side === s.players.find((x) => x.id === owner)!.side && p.id !== owner)!
    const opponent = s.players.find((p) => p.side !== mate.side)!
    expect(() => applyIntervention(s, { kind: "pass_to", playerId: mate.id, receiverId: owner })).toThrow(/not on the ball/)
    expect(() => applyIntervention(s, { kind: "pass_to", playerId: owner, receiverId: opponent.id })).toThrow(/not a teammate/)
    expect(() => applyIntervention(s, { kind: "pass_to", playerId: owner, receiverId: "nobody" })).toThrow(WhatIfError)
  })

  it("move a player, but not the one on the ball, and change a team's style within its ranges", () => {
    const s = onBall(12_000)
    const owner = (s.possession as { playerId: string }).playerId
    const other = s.players.find((p) => p.id !== owner && !p.sentOff)!
    const moved = applyIntervention(s, { kind: "move_player", playerId: other.id, to: { x: 10, y: 99 } })
    expect(moved.players.find((p) => p.id === other.id)!.pos).toEqual({ x: 10, y: 33.5 })
    expect(() => applyIntervention(s, { kind: "move_player", playerId: owner, to: { x: 0, y: 0 } })).toThrow(/on the ball/)
    const pressing = applyIntervention(s, { kind: "tactic", side: "away", style: { pressIntensity: 1, lineHeight: 0.9 } })
    expect(pressing.config.away.style).toMatchObject({ pressIntensity: 1, lineHeight: 0.9, tempo: cfg.away.style.tempo })
    expect(() => applyIntervention(s, { kind: "tactic", side: "away", style: { pressIntensity: 2 } })).toThrow(/between 0 and 1/)
    expect(() => applyIntervention(s, { kind: "tactic", side: "away", style: { bravery: 1 } as never })).toThrow(/unknown style setting/)
  })
})

describe("what if", () => {
  it("pairs the arms seed by seed: changing nothing makes no difference at all", () => {
    const r = whatIf(onBall(20_000), { kind: "none" }, { seeds: 6, horizonS: 15 })
    for (const d of Object.values(r.difference)) expect(d).toEqual({ mean: 0, se: 0 })
    expect(r.baseline.ball_progress.se).toBeGreaterThan(0)
  })

  it("measures what a forced pass changes, deterministically and quickly", () => {
    const s = onBall(20_000)
    const owner = (s.possession as { playerId: string }).playerId
    const best = passOptions(s)[0]!
    const worst = passOptions(s).at(-1)!
    const opts = { seeds: 20, horizonS: 20, baseline: { kind: "pass_to" as const, playerId: owner, receiverId: best.receiverId } }
    const t0 = performance.now()
    const r = whatIf(s, { kind: "pass_to", playerId: owner, receiverId: worst.receiverId }, opts)
    expect(performance.now() - t0).toBeLessThan(5000)
    expect(whatIf(s, { kind: "pass_to", playerId: owner, receiverId: worst.receiverId }, opts)).toEqual(r)
    expect(r).toMatchObject({ seeds: 20, horizon_s: 20, at_tick: s.tick })
    expect(Number.isFinite(r.difference.xg_diff.mean)).toBe(true)
  })

  it("plays the same number of seconds at 25 frames per second", () => {
    let s = initMatch(makeConfig(43, { dt: 0.04 }))
    while (s.tick < 5000 || s.possession.kind !== "owned") s = step(s).state
    const ahead = playAhead(forkState(s, 0), Math.round(4 / 0.04))
    expect(ahead.state.tick).toBe(s.tick + 100)
    const r = whatIf(s, { kind: "none" }, { seeds: 3, horizonS: 4 })
    expect(r).toMatchObject({ horizon_s: 4, at_tick: s.tick })
    expect(r.difference.total).toEqual({ mean: 0, se: 0 })
  })

  it("refuses silly options and finished matches", () => {
    const s = onBall(20_000)
    expect(() => whatIf(s, { kind: "none" }, { seeds: 0 })).toThrow(/seeds/)
    expect(() => whatIf(s, { kind: "none" }, { horizonS: 1000 })).toThrow(/horizonS/)
    const end = [...match.states.values()].at(-1)!
    expect(() => whatIf(end, { kind: "none" })).toThrow(/over/)
  })
})
```

- [ ] **Step 2: Run them to make sure they fail**

Run: `pnpm --filter @touchline/sim-core test whatif`
Expected: 10 failed: `TypeError: passOptions is not a function`, `forkState is not a function`, …

- [ ] **Step 3: Let a state carry a forced pass**

Apply this change to `packages/sim-core/src/types.ts`, `packages/sim-core/src/decide.ts`, `packages/sim-core/src/step.ts` (from the repository root):

```bash
git apply <<'PATCH'
diff --git a/packages/sim-core/src/decide.ts b/packages/sim-core/src/decide.ts
index 4713b90..4992153 100644
--- a/packages/sim-core/src/decide.ts
+++ b/packages/sim-core/src/decide.ts
@@ -285,3 +285,28 @@ export const decide = (input: DecisionInput, p: Params, rng: Rng): Decision => {
   const recorded = options.some(same) ? options : [...options, chosenOption]
   return { action: chosen.action, candidate: chosen, decisionQuality: quality, xg: null, pressure, ...record, options: recorded, chosenRank, fallback }
 }
+
+/**
+ * A decision whose pass is replaced by a what-if override: the best-valued pass to `receiverId` (of `kind` if
+ * given). The record keeps the probabilities and options the player weighed, with the forced pass ranked among
+ * them. Returned unchanged when no such pass is available (the receiver too close, too far or sent off).
+ */
+export const overridePass = (d: Decision, input: DecisionInput, o: { readonly receiverId: string; readonly kind?: string }, p: Params): Decision => {
+  const candidates = buildCandidates(input, p, d.pressure)
+  const matching = candidates.filter((c) => c.receiverId === o.receiverId && (o.kind === undefined || c.kind === o.kind))
+  if (matching.length === 0) return d
+  const chosen = matching.reduce((a, b) => (b.value > a.value ? b : a))
+  const best = Math.max(...candidates.map((c) => c.value))
+  const option = toOption(chosen)
+  const same = (r: OptionRecord) => r.receiver_id === option.receiver_id && r.target_x === option.target_x && r.target_y === option.target_y
+  return {
+    ...d,
+    action: chosen.action,
+    candidate: chosen,
+    decisionQuality: best > 0 ? Math.max(0, Math.min(1, chosen.value / best)) : 1,
+    xg: null,
+    chosenRank: 1 + candidates.filter((c) => c.value > chosen.value).length,
+    options: d.options.some(same) ? d.options : [...d.options, option],
+    fallback: false
+  }
+}
diff --git a/packages/sim-core/src/step.ts b/packages/sim-core/src/step.ts
index b069027..3325bf5 100644
--- a/packages/sim-core/src/step.ts
+++ b/packages/sim-core/src/step.ts
@@ -1,5 +1,5 @@
 import { stepBall } from "./ball.js"
-import { decide, lastDefenderAttackX, nearestOpponent, type Decision } from "./decide.js"
+import { decide, lastDefenderAttackX, nearestOpponent, overridePass, type Decision } from "./decide.js"
 import { buildEvent, round2 } from "./events.js"
 import { behindPoint, clearAway, crossBlocker, DEFLECT_SPEED, deflectLoose, inOwnBox, keeperAction, keeperCanCome } from "./deflect.js"
 import { executeKick, pressureFrom } from "./execute.js"
@@ -39,6 +39,7 @@ import {
   type Frame,
   type MatchConfig,
   type MatchState,
+  type PassOverride,
   type PendingEvent,
   type Phase,
   type PlayerState,
@@ -162,6 +163,7 @@ class Work {
   subs: Record<Side, SubsState>
   forced: ScriptEntry[]
   scriptGoals: number[]
+  override: PassOverride | null
   rng: Record<Concern, Rng>
   seq: number
   events: DomainEvent[] = []
@@ -185,6 +187,7 @@ class Work {
     this.subs = { ...s.subs }
     this.forced = [...s.forced]
     this.scriptGoals = [...s.scriptGoals]
+    this.override = s.override ?? null
     this.rng = {} as Record<Concern, Rng>
     for (const c of CONCERNS) this.rng[c] = new Rng(s.rng[c])
     this.seq = s.eventSeq
@@ -291,7 +294,8 @@ class Work {
       forced: this.forced,
       scriptGoals: this.scriptGoals,
       rng: out,
-      eventSeq: this.seq
+      eventSeq: this.seq,
+      ...(this.override ? { override: this.override } : {})
     }
   }
 }
@@ -763,20 +767,21 @@ const ownerDecision = (w: Work, owner: PlayerState): void => {
   finishCarry(w, owner)
   const side = owner.side
   const team = teamOf(w.cfg, side)
-  const decision = decide(
-    {
-      owner,
-      teammates: w.active(side),
-      opponents: w.active(other(side)),
-      style: team.style,
-      scoreDiff: w.score[side] - w.score[other(side)],
-      minute: w.minute(),
-      restart,
-      scriptBias: scriptBias(w, side)
-    },
-    w.p,
-    w.rng.decision
-  )
+  const input = {
+    owner,
+    teammates: w.active(side),
+    opponents: w.active(other(side)),
+    style: team.style,
+    scoreDiff: w.score[side] - w.score[other(side)],
+    minute: w.minute(),
+    restart,
+    scriptBias: scriptBias(w, side)
+  }
+  let decision = decide(input, w.p, w.rng.decision)
+  if (w.override?.playerId === owner.id) {
+    decision = overridePass(decision, input, w.override, w.p)
+    w.override = null
+  }
   const until = (s: number) => w.tick + Math.max(1, Math.round(s / w.dt))
   switch (decision.action) {
     case "hold":
diff --git a/packages/sim-core/src/types.ts b/packages/sim-core/src/types.ts
index c8462b8..35bfc60 100644
--- a/packages/sim-core/src/types.ts
+++ b/packages/sim-core/src/types.ts
@@ -287,6 +287,14 @@ export interface SubsState {
   readonly used: ReadonlyArray<string>
 }
 
+/** A what-if instruction: at their next decision, this player plays the pass to `receiverId` (see whatif.ts). */
+export interface PassOverride {
+  readonly playerId: string
+  readonly receiverId: string
+  /** The kind of pass (short, through, ...); the best-valued kind to that receiver when absent. */
+  readonly kind?: string
+}
+
 export interface MatchState {
   readonly config: MatchConfig
   readonly tick: number
@@ -316,6 +324,8 @@ export interface MatchState {
   readonly scriptGoals: ReadonlyArray<number>
   readonly rng: Readonly<Record<Concern, RngState>>
   readonly eventSeq: number
+  /** A pass to force at the player's next decision (what-if forks only; absent in played matches). */
+  readonly override?: PassOverride
 }
 
 export interface StepResult {
PATCH
```

- [ ] **Step 4: Keep states in the scenario runner**

Apply this change to `packages/sim-core/src/runner.ts` (from the repository root):

```bash
git apply <<'PATCH'
diff --git a/packages/sim-core/src/runner.ts b/packages/sim-core/src/runner.ts
index f7a5445..f4b1f68 100644
--- a/packages/sim-core/src/runner.ts
+++ b/packages/sim-core/src/runner.ts
@@ -30,11 +30,15 @@ export interface ScriptedRun {
   /** Every step of the accepted match, kickoff to full time: frame and events only. */
   readonly steps: ReadonlyArray<StepOutput>
   readonly windows: ReadonlyArray<WindowResult>
+  /** The accepted match's states at the ticks asked for in `statesAt` (what-if forks start from them). */
+  readonly states: ReadonlyMap<number, MatchState>
 }
 
 export interface RunOptions {
   /** Re-plays of a window with fresh random sub-streams before forcing (default 5; at most MAX_RETRIES). */
   readonly retries?: number
+  /** Keep the accepted match's state at these ticks (after each tick's step). */
+  readonly statesAt?: ReadonlySet<number>
 }
 
 /** Each window's retries draw sub-seeds window * 64 + attempt, so more than 62 would reuse the next window's. */
@@ -145,12 +149,16 @@ export const runScript = (cfg: MatchConfig, opts: RunOptions = {}): ScriptedRun
   const blocks = groups(cfg.script?.entries ?? [])
   const steps: StepOutput[] = []
   const windows: WindowResult[] = []
+  const states = new Map<number, MatchState>()
+  const keep = opts.statesAt ?? new Set<number>()
   let s = initMatch(cfg)
+  if (keep.has(s.tick)) states.set(s.tick, s)
   const advance = (until: (st: MatchState) => boolean) => {
     while (!isFinished(s) && !until(s)) {
       const r = step(s)
       s = r.state
       steps.push({ frame: r.frame, events: r.events })
+      if (keep.has(s.tick)) states.set(s.tick, s)
     }
   }
   blocks.forEach((block, bi) => {
@@ -164,15 +172,18 @@ export const runScript = (cfg: MatchConfig, opts: RunOptions = {}): ScriptedRun
       let t = attempt === 0 ? checkpoint : reseed(checkpoint, bi, attempt)
       if (forcing) t = { ...t, forced: forcesFor(block) }
       const buffer: StepOutput[] = []
+      const kept = new Map<number, MatchState>()
       while (!isFinished(t) && minuteOf(t) < end) {
         const r = step(t)
         t = r.state
         buffer.push({ frame: r.frame, events: r.events })
+        if (keep.has(t.tick)) kept.set(t.tick, t)
       }
       const events = buffer.flatMap((r) => r.events)
       const achieved = block.every((e) => entryAchieved(e, events, cfg))
       if (achieved || forcing) {
         steps.push(...buffer)
+        for (const [k, v] of kept) states.set(k, k === t.tick ? { ...v, forced: [] } : v)
         s = { ...t, forced: [] }
         const frames = buffer.filter((r) => r.frame)
         const results = block.map((e) => ({ achieved: entryAchieved(e, events, cfg), forced: forcing && entryForced(e, events, cfg) }))
@@ -182,5 +193,5 @@ export const runScript = (cfg: MatchConfig, opts: RunOptions = {}): ScriptedRun
     }
   })
   advance(() => false)
-  return { steps, windows }
+  return { steps, windows, states }
 }
PATCH
```

- [ ] **Step 5: Write what-if**

Create `packages/sim-core/src/whatif.ts`:

```ts
/**
 * What-if re-simulation: take the match state at a tick, change one thing (force a pass, move a player, change a
 * team's style), play the next seconds over several random seeds, and compare with the same seeds left alone.
 * Pure and deterministic, like the engine: the same state, intervention and options give the same answer.
 */
import { buildCandidates, nearestOpponent } from "./decide.js"
import { attackX, clampToPitch, dist, type Side, type Vec2 } from "./geometry.js"
import { substream } from "./rng.js"
import { runScript } from "./runner.js"
import { initMatch, isFinished, step } from "./step.js"
import { CONCERNS, type DomainEvent, type MatchConfig, type MatchState, type TeamStyle } from "./types.js"

export type Intervention =
  | { readonly kind: "none" }
  /** The player on the ball plays this pass at their next decision (the next tick). */
  | { readonly kind: "pass_to"; readonly playerId: string; readonly receiverId: string; readonly passKind?: string }
  /** The player stands at `to` instead (standing still for a second, then playing on). */
  | { readonly kind: "move_player"; readonly playerId: string; readonly to: Vec2 }
  /** The team plays with these style settings from now on. */
  | { readonly kind: "tactic"; readonly side: Side; readonly style: Partial<TeamStyle> }

/** An intervention that cannot be applied to the state (wrong player, unknown id, style out of range). */
export class WhatIfError extends Error {}

const STYLE_RANGES: Readonly<Record<keyof Omit<TeamStyle, "archetype">, readonly [number, number]>> = {
  pressIntensity: [0, 1],
  lineHeight: [-1, 1],
  compactness: [0, 1],
  tempo: [0, 1],
  longBallBias: [-1, 1],
  crossBias: [-1, 1],
  riskTolerance: [0, 1]
}

/** The k-th fork of a state: fresh random sub-streams for every concern, distinct from the match's and from scenario retries. */
export const forkState = (s: MatchState, k: number): MatchState => {
  const rng = {} as Record<(typeof CONCERNS)[number], MatchState["rng"][(typeof CONCERNS)[number]]>
  for (const c of CONCERNS) rng[c] = substream(s.config.seed, `${c}:whatif`, k)
  return { ...s, rng }
}

/** The pass options open to the player on the ball now (receiver, kind, value), best first. */
export const passOptions = (s: MatchState) => {
  if (s.possession.kind !== "owned") return []
  const owner = s.players.find((p) => p.id === (s.possession as { playerId: string }).playerId)!
  const team = owner.side === "home" ? s.config.home : s.config.away
  const opponents = s.players.filter((p) => p.side !== owner.side && !p.sentOff)
  const near = nearestOpponent(owner.pos, opponents)
  const pressure = near ? Math.max(0, Math.min(1, 1 - (dist(owner.pos, near.pos) - 1) / 4)) : 0
  return buildCandidates(
    { owner, teammates: s.players.filter((p) => p.side === owner.side && !p.sentOff), opponents, style: team.style, scoreDiff: 0, minute: 0, restart: null, scriptBias: {} },
    s.config.params,
    pressure
  ).sort((a, b) => b.value - a.value)
}

export const applyIntervention = (s: MatchState, iv: Intervention): MatchState => {
  const find = (id: string) => {
    const p = s.players.find((x) => x.id === id)
    if (!p || p.sentOff) throw new WhatIfError(`no player "${id}" on the pitch at tick ${s.tick}`)
    return p
  }
  switch (iv.kind) {
    case "none":
      return s
    case "pass_to": {
      const owner = find(iv.playerId)
      if (s.possession.kind !== "owned" || s.possession.playerId !== owner.id) throw new WhatIfError(`${owner.id} is not on the ball at tick ${s.tick}`)
      const receiver = find(iv.receiverId)
      if (receiver.side !== owner.side || receiver.id === owner.id) throw new WhatIfError(`${receiver.id} is not a teammate of ${owner.id}`)
      if (!passOptions(s).some((c) => c.receiverId === receiver.id && (iv.passKind === undefined || c.kind === iv.passKind)))
        throw new WhatIfError(`no ${iv.passKind ?? ""} pass from ${owner.id} to ${receiver.id} is open at tick ${s.tick}`.replace("  ", " "))
      // The player decides at the next tick, and plays the forced pass.
      const players = s.players.map((p) => (p.id === owner.id ? { ...p, intentUntil: s.tick + 1 } : p))
      return { ...s, players, override: { playerId: owner.id, receiverId: receiver.id, ...(iv.passKind ? { kind: iv.passKind } : {}) } }
    }
    case "move_player": {
      const pl = find(iv.playerId)
      if (s.possession.kind === "owned" && s.possession.playerId === pl.id) throw new WhatIfError(`${pl.id} is on the ball; move another player`)
      const to = clampToPitch(iv.to)
      const players = s.players.map((p) => (p.id === pl.id ? { ...p, pos: to, vel: { x: 0, y: 0 }, intent: { kind: "hold" as const }, intentUntil: s.tick + Math.round(1 / s.config.dt) } : p))
      return { ...s, players }
    }
    case "tactic": {
      for (const [k, v] of Object.entries(iv.style)) {
        const range = STYLE_RANGES[k as keyof typeof STYLE_RANGES]
        if (!range) throw new WhatIfError(`unknown style setting "${k}"`)
        if (typeof v !== "number" || !(v >= range[0] && v <= range[1])) throw new WhatIfError(`style.${k} must be between ${range[0]} and ${range[1]}`)
      }
      const team = s.config[iv.side]
      return { ...s, config: { ...s.config, [iv.side]: { ...team, style: { ...team.style, ...iv.style } } } }
    }
  }
}

/** Play a state forward `ticks` ticks (or to full time). */
export const playAhead = (s: MatchState, ticks: number): { readonly events: DomainEvent[]; readonly state: MatchState } => {
  const events: DomainEvent[] = []
  let t = s
  const end = s.tick + ticks
  while (!isFinished(t) && t.tick < end) {
    const r = step(t)
    t = r.state
    events.push(...r.events)
  }
  return { events, state: t }
}

/** What one play-ahead produced, from one team's point of view. */
export interface Outcome {
  readonly goal_diff: number
  readonly xg_diff: number
  readonly shots_for: number
  readonly shots_against: number
  /** 1 if the team has the ball at the end, 0 if the opponents do, 0.5 when nobody does. */
  readonly possession_end: number
  /** How far up the pitch (the team's attacking x, metres) the ball is at the end. */
  readonly ball_progress: number
  /** The caller's value of the end state for the team (WhatIfOptions.endValue; 0 without one). */
  readonly end_value: number
  /** xg_diff + end_value: what the play produced plus what it leaves the team with. */
  readonly total: number
}

export const OUTCOME_KEYS = ["goal_diff", "xg_diff", "shots_for", "shots_against", "possession_end", "ball_progress", "end_value", "total"] as const

/** A value of a state for a team, e.g. the expected threat of where the ball is, signed by who has it. */
export type EndValue = (s: MatchState, side: Side) => number

export const outcomeOf = (events: ReadonlyArray<DomainEvent>, end: MatchState, side: Side, endValue?: EndValue): Outcome => {
  const team = end.config[side].id
  const xg = (e: DomainEvent) => (typeof e.attrs.xg === "number" ? e.attrs.xg : 0)
  const shots = events.filter((e) => e.type === "shot")
  const own = shots.filter((e) => e.team_id === team)
  const opp = shots.filter((e) => e.team_id !== team)
  const goals = events.filter((e) => e.type === "goal")
  const owner = end.possession.kind === "owned" ? end.players.find((p) => p.id === (end.possession as { playerId: string }).playerId) : undefined
  const xgDiff = own.reduce((a, e) => a + xg(e), 0) - opp.reduce((a, e) => a + xg(e), 0)
  const value = endValue ? endValue(end, side) : 0
  return {
    goal_diff: goals.filter((e) => e.team_id === team).length - goals.filter((e) => e.team_id !== team).length,
    xg_diff: xgDiff,
    shots_for: own.length,
    shots_against: opp.length,
    possession_end: owner ? (owner.side === side ? 1 : 0) : 0.5,
    ball_progress: attackX(side, end.ball.pos.x),
    end_value: value,
    total: xgDiff + value
  }
}

export interface Estimate {
  readonly mean: number
  /** Standard error of the mean. */
  readonly se: number
}

export interface WhatIfOptions {
  /** The team whose outcome is measured (default: the team on the ball, else the home side). */
  readonly side?: Side
  /** Paired random seeds (default 20, at most 200). */
  readonly seeds?: number
  /** Seconds played ahead (default 20, at most 600). */
  readonly horizonS?: number
  /** What the variant is compared with (default: nothing changed). */
  readonly baseline?: Intervention
  /** Values each play's end state (default: none, so end_value is 0). */
  readonly endValue?: EndValue
}

export interface WhatIfResult {
  readonly side: Side
  readonly at_tick: number
  readonly horizon_s: number
  readonly seeds: number
  readonly baseline: Readonly<Record<(typeof OUTCOME_KEYS)[number], Estimate>>
  readonly variant: Readonly<Record<(typeof OUTCOME_KEYS)[number], Estimate>>
  /** Variant minus baseline, seed by seed (paired). */
  readonly difference: Readonly<Record<(typeof OUTCOME_KEYS)[number], Estimate>>
}

const estimate = (xs: ReadonlyArray<number>): Estimate => {
  const n = xs.length
  const mean = xs.reduce((a, b) => a + b, 0) / n
  const sd = n > 1 ? Math.sqrt(xs.reduce((a, v) => a + (v - mean) ** 2, 0) / (n - 1)) : 0
  return { mean, se: n > 0 ? sd / Math.sqrt(n) : 0 }
}

/**
 * Compare an intervention with a baseline from the same state: each of `seeds` forks plays `horizonS` seconds
 * twice, once per arm, with the same random sub-streams, and the outcomes are averaged and differenced.
 */
export const whatIf = (s: MatchState, variant: Intervention, opts: WhatIfOptions = {}): WhatIfResult => {
  const seeds = opts.seeds ?? 20
  const horizonS = opts.horizonS ?? 20
  if (!Number.isInteger(seeds) || seeds < 1 || seeds > 200) throw new WhatIfError("seeds must be an integer from 1 to 200")
  if (!(horizonS > 0 && horizonS <= 600)) throw new WhatIfError("horizonS must be between 0 and 600 seconds")
  if (isFinished(s)) throw new WhatIfError("the match is over")
  const owner = s.possession.kind === "owned" ? s.players.find((p) => p.id === (s.possession as { playerId: string }).playerId) : undefined
  const side = opts.side ?? owner?.side ?? "home"
  const ticks = Math.round(horizonS / s.config.dt)
  const runs = { baseline: [] as Outcome[], variant: [] as Outcome[] }
  for (let k = 0; k < seeds; k++)
    for (const [arm, iv] of [["baseline", opts.baseline ?? { kind: "none" }], ["variant", variant]] as const) {
      const r = playAhead(applyIntervention(forkState(s, k), iv), ticks)
      runs[arm].push(outcomeOf(r.events, r.state, side, opts.endValue))
    }
  const per = (xs: Outcome[]) => Object.fromEntries(OUTCOME_KEYS.map((key) => [key, estimate(xs.map((o) => o[key]))])) as WhatIfResult["baseline"]
  const difference = Object.fromEntries(OUTCOME_KEYS.map((key) => [key, estimate(runs.variant.map((o, i) => o[key] - runs.baseline[i]![key]))])) as WhatIfResult["difference"]
  return { side, at_tick: s.tick, horizon_s: horizonS, seeds, baseline: per(runs.baseline), variant: per(runs.variant), difference }
}

/** The match states (after the step of each tick) at the given ticks, for a plain or scripted match. */
export const statesAt = (cfg: MatchConfig, ticks: Iterable<number>): Map<number, MatchState> => {
  const want = new Set(ticks)
  if ((cfg.script?.entries.length ?? 0) > 0) return new Map(runScript(cfg, { statesAt: want }).states)
  const out = new Map<number, MatchState>()
  const last = Math.max(-1, ...want)
  let s = initMatch(cfg)
  if (want.has(s.tick)) out.set(s.tick, s)
  while (!isFinished(s) && s.tick < last) {
    s = step(s).state
    if (want.has(s.tick)) out.set(s.tick, s)
  }
  return out
}
```

Apply this change to `packages/sim-core/src/index.ts` (from the repository root):

```bash
git apply <<'PATCH'
diff --git a/packages/sim-core/src/index.ts b/packages/sim-core/src/index.ts
index 0776879..0c8054a 100644
--- a/packages/sim-core/src/index.ts
+++ b/packages/sim-core/src/index.ts
@@ -18,3 +18,4 @@ export * from "./gamestate.js"
 export * from "./script.js"
 export * from "./runner.js"
 export * from "./pitchcontrol.js"
+export * from "./whatif.js"
PATCH
```

- [ ] **Step 6: Run the tests**

Run: `pnpm --filter @touchline/sim-core test whatif`
Expected: 10 passed (a forced-pass comparison over 20 seeds and 20 s takes well under 5 s)

Run: `pnpm turbo run typecheck test --force --filter=@touchline/sim-core --filter=@touchline/sim --filter=@touchline/stats`
Expected: `Tasks: 6 successful` (played matches, the stats golden match and the realism gate unchanged)

- [ ] **Step 7: Commit**

```bash
git add packages/sim-core
git commit -m "feat(sim-core): what-if re-simulation — states at any tick, forks with fresh seeds, forced passes, moved players and changed tactics, paired comparisons

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```



### Task 7: Better-option explainer and positioning advisor

`packages/advisor` puts what-if to work on a played match. `Session.fromRun` rebuilds a run folder's match from its manifest (seed, clubs from the league file, scenario, fps, kick-off) with the parameters whose version the manifest names, refuses any other, and checks the rebuild against the run's own events (the event count after the first minute); states are computed on demand, with checkpoints every 3,000 ticks and at most 256 asked-for states kept. The explainer takes a pass event and scores every option on its decision record on paper (pitch control at the target × expected threat, minus the opponents' expected threat there if lost) and in play: each option is re-simulated against the pass played from the state just before it, over paired seeds (default 20) and 10 s, valued by the xG it creates plus the expected threat it leaves the team with (`xtEndValue`). Measured on a match, the option that looks best on paper is rarely the one that plays out better, so the verdict comes from play: a better option only when it is clearly better (mean above twice its standard error), else the pass played was the best; `not_verified` when the pass played is not on the record or nothing could be re-simulated. About 0.5 s per pass. The positioning advisor tries every spot within 12 m (2 m apart) for a player: in attack the value of a pass from the ball carrier to them there, in defence the ball carrier's best pass option with them there (lower is better); optionally the move is re-simulated over paired seeds.

**Files:**
- Create: `packages/advisor/package.json`, `packages/advisor/tsconfig.json`, `packages/advisor/vitest.config.ts`, `packages/advisor/src/session.ts`, `packages/advisor/src/value.ts`, `packages/advisor/src/explain.ts`, `packages/advisor/src/position.ts`, `packages/advisor/src/index.ts`
- Test: `packages/advisor/test/advisor.test.ts`

**Interfaces:**
- Consumes: Task 6's `whatIf`, `statesAt`, `WhatIfError`, `EndValue`; Task 2's `pitchControlAt`; Task 1's `xtAt`; `SCENARIOS` (`@touchline/sim`); `decodeDomainEvent` (`@touchline/schema`).
- Produces: `class AdvisorError`, `SESSION_CACHE_STATES = 256`, `class Session(cfg, events)` with `stateAt(tick)`, `event(id)`, `cachedStates`, `Session.fromRun(dir, league, params[])`; `toPc(player)`, `passValue(s, side, passerId, from, target, xt, players?) → {pc, value}`, `xtEndValue(xt): EndValue`; `interface ScoredOption`, `interface PassExplanation {event_id, player_id, frame_id, options, chosen_rank, best_on_paper, better, verdict, seeds, horizon_s, note}`, `explainPass(session, eventId, xt, {seeds?, horizonS?})`; `interface PositionAdvice {player_id, tick, mode, from, to, value_now, value_best, gain, verification}`, `suggestPosition(session, playerId, tick, xt, {radiusM?, stepM?, seeds?, horizonS?})`.

- [ ] **Step 1: Create the package and write the failing tests**

Create `packages/advisor/package.json`:

```json
{
  "name": "@touchline/advisor",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "exports": { ".": "./src/index.ts" },
  "scripts": { "test": "vitest run", "typecheck": "tsc --noEmit -p ." },
  "dependencies": {
    "@touchline/schema": "workspace:*",
    "@touchline/sim": "workspace:*",
    "@touchline/sim-core": "workspace:*",
    "@touchline/stats": "workspace:*"
  },
  "devDependencies": { "@touchline/league": "workspace:*", "effect": "4.0.0" }
}
```

Create `packages/advisor/tsconfig.json`:

```json
{ "extends": "../../tsconfig.base.json", "include": ["src", "test", "scripts"] }
```

Create `packages/advisor/vitest.config.ts`:

```ts
import { defineConfig } from "vitest/config"

export default defineConfig({ test: { testTimeout: 120_000 } })
```

Run: `pnpm install`
Expected: the new workspace package is linked

Create `packages/advisor/test/advisor.test.ts`:

```ts
import { cpSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { Effect } from "effect"
import { beforeAll, describe, expect, it } from "vitest"
import type { League } from "@touchline/league"
import { SCENARIOS, writeMatch } from "@touchline/sim"
import { DEFAULT_PARAMS, type MatchState } from "@touchline/sim-core"
import { xtGridFromJson } from "@touchline/stats"
import { AdvisorError, explainPass, Session, SESSION_CACHE_STATES, suggestPosition } from "../src/index.js"

const root = join(dirname(fileURLToPath(import.meta.url)), "../../..")
const league = JSON.parse(readFileSync(join(root, "data/league/league.json"), "utf8")) as League
const xt = xtGridFromJson(JSON.parse(readFileSync(join(root, "data/params/xt-grid.json"), "utf8")))
const dir = mkdtempSync(join(tmpdir(), "touchline-advisor-"))
const cfg = { matchId: "adv", seed: 4247, kickoffTime: "2026-10-18T14:00:00.000Z", home: league.clubs[2]!, away: league.clubs[6]!, params: DEFAULT_PARAMS, dt: 0.1 }
let session: Session

beforeAll(async () => {
  await Effect.runPromise(writeMatch(cfg, dir))
  session = Session.fromRun(dir, league, [DEFAULT_PARAMS])
}, 120_000)

/** Events emitted up to a tick: the last id's number must equal the state's event count. */
const lastSeq = (tick: number) => Math.max(...session.events.filter((e) => Math.max(e.frame_id, e.frame_id_end ?? e.frame_id) <= tick).map((e) => Number(e.id.split("-e").at(-1))))
/** The first tick from `from` on where a player of `side` is on the ball. */
const owned = (from: number, sameSide: boolean): { s: MatchState; carrier: string; other: string } => {
  for (let t = from; ; t += 10) {
    const s = session.stateAt(t)
    if (s.possession.kind !== "owned") continue
    const carrier = s.players.find((p) => p.id === (s.possession as { playerId: string }).playerId)!
    const other = s.players.find((p) => !p.sentOff && p.role !== "GK" && p.id !== carrier.id && (p.side === carrier.side) === sameSide)!
    return { s, carrier: carrier.id, other: other.id }
  }
}

describe("session", () => {
  it("rebuilds a run folder's match and gives its state at any tick", () => {
    for (const t of [5_000, 31_234, 12_000]) expect(session.stateAt(t).eventSeq).toBe(lastSeq(t))
    expect(session.stateAt(31_234)).toBe(session.stateAt(31_234))
  })

  it("keeps a bounded number of states however many frames are asked about", () => {
    for (let t = 40_000; t < 40_000 + 3 * SESSION_CACHE_STATES; t += 3) session.stateAt(t)
    // At most the recent states asked for, plus one checkpoint per 3,000 ticks of the match.
    expect(session.cachedStates).toBeLessThanOrEqual(SESSION_CACHE_STATES + 20)
    expect(session.stateAt(5_000).eventSeq).toBe(lastSeq(5_000))
  })

  it("refuses parameters of another version, a missing folder, and a folder that does not match its manifest", () => {
    expect(() => Session.fromRun(dir, league, [{ ...DEFAULT_PARAMS, provenance: { ...DEFAULT_PARAMS.provenance, version: "other" } }])).toThrow(/the run used parameters "prior-0"; available: other/)
    expect(() => Session.fromRun(join(dir, "nope"), league, [DEFAULT_PARAMS])).toThrow(AdvisorError)
    const bad = mkdtempSync(join(tmpdir(), "touchline-advisor-bad-"))
    cpSync(dir, bad, { recursive: true })
    const m = JSON.parse(readFileSync(join(bad, "manifest.json"), "utf8"))
    writeFileSync(join(bad, "manifest.json"), JSON.stringify({ ...m, seed: m.seed + 1 }))
    expect(() => Session.fromRun(bad, league, [DEFAULT_PARAMS])).toThrow(/does not match/)
  })

  it("rebuilds a scripted match through the scenario runner", async () => {
    const sc = SCENARIOS.late_comeback!
    const sdir = mkdtempSync(join(tmpdir(), "touchline-advisor-script-"))
    await Effect.runPromise(writeMatch({ ...cfg, matchId: "adv-s", home: league.clubs.find((c) => c.id === sc.home)!, away: league.clubs.find((c) => c.id === sc.away)!, script: sc.script }, sdir))
    const scripted = Session.fromRun(sdir, league, [DEFAULT_PARAMS])
    const t = 50_000
    const seq = Math.max(...scripted.events.filter((e) => Math.max(e.frame_id, e.frame_id_end ?? e.frame_id) <= t).map((e) => Number(e.id.split("-e").at(-1))))
    expect(scripted.stateAt(t).eventSeq).toBe(seq)
  }, 120_000)
})

describe("better option explainer", () => {
  const passes = () => session.events.filter((e) => e.type === "pass" && Array.isArray(e.attrs.options) && (e.attrs.options as unknown[]).length >= 3 && e.frame_id > 600)

  it("ranks every recorded option on paper by pitch control and threat, the pass played among them", () => {
    const x = explainPass(session, passes()[0]!.id, xt, { seeds: 0 })
    expect(x.options.filter((o) => o.chosen)).toHaveLength(1)
    for (let i = 1; i < x.options.length; i++) expect(x.options[i - 1]!.value).toBeGreaterThanOrEqual(x.options[i]!.value)
    for (const o of x.options) expect(o.pitch_control).toBeGreaterThanOrEqual(0)
    expect(x.best_on_paper).toEqual(x.options[0])
    expect(x).toMatchObject({ verdict: "not_verified", note: "re-simulation skipped", better: null })
  })

  it("plays every alternative out against the pass played and reports a better one only when it is clearly better", () => {
    const x = explainPass(session, passes()[3]!.id, xt, { seeds: 12, horizonS: 10 })
    expect(x.verdict).not.toBe("not_verified")
    for (const o of x.options) if (o.chosen) expect(o.simulated).toBeNull()
    const simulated = x.options.filter((o) => o.simulated)
    expect(simulated.length).toBeGreaterThan(0)
    const clearly = simulated.filter((o) => o.simulated!.mean > 2 * o.simulated!.se && o.simulated!.mean > 0)
    expect(x.verdict).toBe(clearly.length ? "better_option_found" : "played_pass_was_best")
    if (x.better) expect(x.better.simulated!.mean).toBe(Math.max(...clearly.map((o) => o.simulated!.mean)))
    expect(explainPass(session, passes()[3]!.id, xt, { seeds: 12, horizonS: 10 })).toEqual(x)
  })

  it("refuses an event that is not a pass", () => {
    const reception = session.events.find((e) => e.type === "reception")!
    expect(() => explainPass(session, reception.id, xt)).toThrow(/not a pass/)
    expect(() => explainPass(session, "nope", xt)).toThrow(/no event/)
  })
})

describe("positioning advisor", () => {
  it("finds a better spot to receive in attack, within reach", () => {
    const { s, other } = owned(15_000, true)
    const a = suggestPosition(session, other, s.tick, xt)
    expect(a.mode).toBe("attack")
    expect(a.value_best).toBeGreaterThanOrEqual(a.value_now)
    expect(Math.hypot(a.to.x - a.from.x, a.to.y - a.from.y)).toBeLessThanOrEqual(12 + 1e-9)
  })

  it("finds a spot that takes away the carrier's best option in defence, and checks it by re-simulation", () => {
    const { s, other } = owned(25_000, false)
    const a = suggestPosition(session, other, s.tick, xt, { seeds: 6, horizonS: 10 })
    expect(a.mode).toBe("defend")
    expect(a.value_best).toBeLessThanOrEqual(a.value_now)
    if (a.gain > 0) expect(a.verification!.seeds).toBe(6)
  })

  it("refuses the player on the ball and moments when nobody has it", () => {
    const { s, carrier } = owned(15_000, true)
    expect(() => suggestPosition(session, carrier, s.tick, xt)).toThrow(/on the ball/)
    let t = 15_000
    while (session.stateAt(t).possession.kind === "owned") t++
    expect(() => suggestPosition(session, carrier, t, xt)).toThrow(/nobody has the ball/)
  })
})
```

- [ ] **Step 2: Run them to make sure they fail**

Run: `pnpm --filter @touchline/advisor test`
Expected: the file fails to load: `Cannot find module '../src/index.js'`

- [ ] **Step 3: Write the session and the pass value**

Create `packages/advisor/src/session.ts`:

```ts
import { existsSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { decodeDomainEvent, type DomainEvent } from "@touchline/schema"
import { SCENARIOS } from "@touchline/sim"
import { initMatch, isFinished, statesAt, step, type MatchConfig, type MatchState, type Params, type TeamSetup } from "@touchline/sim-core"

/** A run folder the advisor cannot re-simulate (missing files, unknown clubs, parameters it does not have). */
export class AdvisorError extends Error {}

/** Plain matches keep a state every this many ticks, so any tick is reached by stepping from the one before. */
const CHECKPOINT_TICKS = 3000
/** States asked for are kept for reuse, the oldest dropped beyond this many (about 25 kB each). */
export const SESSION_CACHE_STATES = 256

/**
 * A match that can be re-simulated: its config, rebuilt from a run folder, and the match state at any tick
 * (computed on demand, kept for reuse). Scripted matches are replayed through the scenario runner, so their
 * states are those of the accepted match.
 */
export class Session {
  private readonly cache = new Map<number, MatchState>()
  private readonly checkpoints = new Map<number, MatchState>()

  constructor(
    readonly cfg: MatchConfig,
    /** The run's domain events, when the session was built from a run folder. */
    readonly events: ReadonlyArray<DomainEvent> = []
  ) {}

  /** The state after the step of `tick` (tick -1: before kick-off). */
  stateAt(tick: number): MatchState {
    const hit = this.cache.get(tick) ?? this.checkpoints.get(tick)
    if (hit) return hit
    if (!Number.isInteger(tick) || tick < -1) throw new AdvisorError(`no state at tick ${tick}`)
    let s: MatchState
    if ((this.cfg.script?.entries.length ?? 0) > 0) {
      const got = statesAt(this.cfg, [tick]).get(tick)
      if (!got) throw new AdvisorError(`the match is over before tick ${tick}`)
      s = got
    } else {
      let from = -1
      for (const m of [this.cache, this.checkpoints]) for (const k of m.keys()) if (k <= tick && k > from) from = k
      s = from >= 0 ? (this.cache.get(from) ?? this.checkpoints.get(from))! : initMatch(this.cfg)
      while (s.tick < tick) {
        if (isFinished(s)) throw new AdvisorError(`the match is over before tick ${tick}`)
        s = step(s).state
        if (s.tick % CHECKPOINT_TICKS === 0) this.checkpoints.set(s.tick, s)
      }
    }
    this.cache.set(tick, s)
    if (this.cache.size > SESSION_CACHE_STATES) this.cache.delete(this.cache.keys().next().value!)
    return s
  }

  /** States kept for reuse (asked for and checkpoints). */
  get cachedStates(): number {
    return this.cache.size + this.checkpoints.size
  }

  event(id: string): DomainEvent {
    const e = this.events.find((x) => x.id === id)
    if (!e) throw new AdvisorError(`no event "${id}" in this match`)
    return e
  }

  /**
   * Rebuild a run folder's match: clubs from the league, the scenario's script, the kick-off from meta.json and
   * the parameters whose version the manifest names (one of `params`). The rebuilt match is checked against the
   * run's own events before it is used.
   */
  static fromRun(dir: string, league: { readonly clubs: ReadonlyArray<TeamSetup> }, params: ReadonlyArray<Params>): Session {
    const read = (f: string) => {
      const p = join(dir, f)
      if (!existsSync(p)) throw new AdvisorError(`missing ${p}`)
      return readFileSync(p, "utf8")
    }
    const manifest = JSON.parse(read("manifest.json")) as { match_id: string; seed: number; home: string; away: string; scenario: string | null; fps: number; params_version: string }
    const meta = JSON.parse(read("meta.json")) as { match: { kickoff_time: string } }
    const club = (id: string) => {
      const c = league.clubs.find((x) => x.id === id)
      if (!c) throw new AdvisorError(`club "${id}" is not in the league file`)
      return c
    }
    const p = params.find((x) => x.provenance.version === manifest.params_version)
    if (!p) throw new AdvisorError(`the run used parameters "${manifest.params_version}"; available: ${params.map((x) => x.provenance.version).join(", ")}`)
    const scenario = manifest.scenario ? SCENARIOS[manifest.scenario] : null
    if (manifest.scenario && !scenario) throw new AdvisorError(`unknown scenario "${manifest.scenario}"`)
    const cfg: MatchConfig = {
      matchId: manifest.match_id,
      seed: manifest.seed,
      kickoffTime: meta.match.kickoff_time,
      home: club(manifest.home),
      away: club(manifest.away),
      params: p,
      dt: 1 / manifest.fps,
      ...(scenario ? { script: scenario.script } : {})
    }
    const events = read("domain.jsonl")
      .split("\n")
      .filter((l) => l.trim() !== "")
      .map((l) => decodeDomainEvent(JSON.parse(l)))
    const session = new Session(cfg, events)
    // The rebuilt match must emit the run's events: the first minute's last event id must match.
    const probe = 600
    const s = session.stateAt(probe)
    const last = events.filter((e) => Math.max(e.frame_id, e.frame_id_end ?? e.frame_id) <= probe).reduce((m, e) => Math.max(m, Number(e.id.split("-e").at(-1))), 0)
    if (s.eventSeq !== last) throw new AdvisorError(`${dir} does not match the match rebuilt from its manifest (events differ by minute 1)`)
    return session
  }
}
```

Create `packages/advisor/src/value.ts`:

```ts
import { pitchControlAt, type EndValue, type MatchState, type PcPlayer, type PlayerState, type Side, type Vec2 } from "@touchline/sim-core"
import { xtAt, type XtGrid } from "@touchline/stats"

export const toPc = (p: PlayerState): PcPlayer => ({ x: p.pos.x, y: p.pos.y, vx: p.vel.x, vy: p.vel.y, gk: p.role === "GK" })
const attackOf = (side: Side): 1 | -1 => (side === "home" ? 1 : -1)

/**
 * The value of playing the ball from `from` to `target` for `side`: the chance of keeping it there (pitch control)
 * times the threat of having it there, minus the chance of losing it times the threat the opponents then have
 * (both xT). `passer` is left out of the receivers.
 */
export const passValue = (s: MatchState, side: Side, passerId: string | null, from: Vec2, target: Vec2, xt: XtGrid, players = s.players): { pc: number; value: number } => {
  const active = players.filter((p) => !p.sentOff)
  const att = active.filter((p) => p.side === side && p.id !== passerId).map(toPc)
  const def = active.filter((p) => p.side !== side).map(toPc)
  const pc = pitchControlAt(target, att, def, from).att
  const value = pc * xtAt(xt, target.x, target.y, attackOf(side)) - (1 - pc) * xtAt(xt, target.x, target.y, attackOf(side === "home" ? "away" : "home"))
  return { pc, value }
}

/**
 * The expected threat a state leaves a team with: xT of where the ball is if the team has it, minus the opponents'
 * xT there if they do, 0 while the ball is loose or in the air.
 */
export const xtEndValue =
  (xt: XtGrid): EndValue =>
  (s, side) => {
    if (s.possession.kind !== "owned") return 0
    const owner = s.players.find((p) => p.id === (s.possession as { playerId: string }).playerId)!
    const v = xtAt(xt, s.ball.pos.x, s.ball.pos.y, attackOf(owner.side))
    return owner.side === side ? v : -v
  }
```

- [ ] **Step 4: Write the explainer and the advisor**

Create `packages/advisor/src/explain.ts`:

```ts
import { whatIf, WhatIfError, type Estimate, type OptionRecord } from "@touchline/sim-core"
import type { XtGrid } from "@touchline/stats"
import { AdvisorError, type Session } from "./session.js"
import { passValue, xtEndValue } from "./value.js"

export interface ScoredOption {
  readonly receiver_id: string
  readonly kind: string
  readonly target_x: number
  readonly target_y: number
  /** The engine's own estimate at the decision. */
  readonly xpass: number
  /** Pitch control for the passing team at the target, at the moment of the pass. */
  readonly pitch_control: number
  /** On paper: pitch control x xT kept, minus the opponents' xT if lost. */
  readonly value: number
  readonly chosen: boolean
  /**
   * Played out: this option minus the pass played, over paired re-simulations (xG created plus the xT left at the
   * end); null for the pass played, when re-simulation was skipped, or when the option could not be forced.
   */
  readonly simulated: Estimate | null
}

export interface PassExplanation {
  readonly event_id: string
  readonly player_id: string
  readonly frame_id: number
  /** Every option the player weighed, best on paper first. */
  readonly options: ReadonlyArray<ScoredOption>
  /** Rank of the pass played on paper (1 = best). */
  readonly chosen_rank: number
  readonly best_on_paper: ScoredOption
  /** The option that played out clearly better than the pass played (mean above twice its standard error), if any. */
  readonly better: ScoredOption | null
  readonly verdict: "played_pass_was_best" | "better_option_found" | "not_verified"
  readonly seeds: number
  readonly horizon_s: number
  /** Why the verdict is not_verified, when it is. */
  readonly note: string | null
}

export interface ExplainOptions {
  /** Paired seeds per option for the re-simulation (default 20; 0 skips it). */
  readonly seeds?: number
  /** Seconds re-simulated (default 10). */
  readonly horizonS?: number
}

/**
 * Was there a better pass? Every option the player weighed (the decision record on the pass event) is scored on
 * paper (pitch control x expected threat at the moment of the pass) and then played out: each is re-simulated
 * against the pass played from the same state over paired seeds, valued by the xG it creates plus the expected
 * threat it leaves the team with. A better option is reported only when it is clearly better in play.
 */
export const explainPass = (session: Session, eventId: string, xt: XtGrid, opts: ExplainOptions = {}): PassExplanation => {
  const e = session.event(eventId)
  if (e.type !== "pass" || e.player_id === null || e.team_id === null) throw new AdvisorError(`"${eventId}" is not a pass`)
  const recorded = (e.attrs.options ?? []) as ReadonlyArray<OptionRecord>
  if (recorded.length < 2) throw new AdvisorError(`"${eventId}" has no alternatives on record`)
  const seeds = opts.seeds ?? 20
  const horizonS = opts.horizonS ?? 10
  const state = session.stateAt(e.frame_id - 1)
  const owner = state.players.find((p) => p.id === e.player_id)!
  // The pass played is the option to the intended receiver nearest the intended end point.
  const intendedX = Number(e.attrs.intended_end_x)
  let chosenIdx = -1
  recorded.forEach((o, i) => {
    if (o.receiver_id === e.attrs.intended_receiver_id && (chosenIdx < 0 || Math.abs(o.target_x - intendedX) < Math.abs(recorded[chosenIdx]!.target_x - intendedX))) chosenIdx = i
  })
  const paper = recorded.map((o, i) => {
    const v = passValue(state, owner.side, owner.id, owner.pos, { x: o.target_x, y: o.target_y }, xt)
    return { receiver_id: o.receiver_id, kind: o.kind, target_x: o.target_x, target_y: o.target_y, xpass: o.xpass, pitch_control: v.pc, value: v.value, chosen: i === chosenIdx }
  })
  const played = paper.find((o) => o.chosen)
  let note: string | null = played ? null : "the pass played is not among the recorded options"
  if (played && seeds === 0) note = "re-simulation skipped"
  const simulate = (o: (typeof paper)[number]): Estimate | null => {
    if (!played || seeds === 0 || o.chosen) return null
    try {
      return whatIf(state, { kind: "pass_to", playerId: owner.id, receiverId: o.receiver_id, passKind: o.kind }, {
        side: owner.side,
        seeds,
        horizonS,
        endValue: xtEndValue(xt),
        baseline: { kind: "pass_to", playerId: owner.id, receiverId: played.receiver_id, passKind: played.kind }
      }).difference.total
    } catch (err) {
      if (err instanceof WhatIfError) return null
      throw err
    }
  }
  const options: ScoredOption[] = paper.map((o) => ({ ...o, simulated: simulate(o) })).sort((a, b) => b.value - a.value)
  const clearly = options.filter((o) => o.simulated && o.simulated.mean > 0 && o.simulated.mean > 2 * o.simulated.se).sort((a, b) => b.simulated!.mean - a.simulated!.mean)
  const better = clearly[0] ?? null
  const verified = played !== undefined && seeds > 0 && options.some((o) => o.simulated !== null)
  if (played && seeds > 0 && !verified) note = "no alternative could be re-simulated"
  return {
    event_id: e.id,
    player_id: e.player_id,
    frame_id: e.frame_id,
    options,
    chosen_rank: 1 + options.findIndex((o) => o.chosen),
    best_on_paper: options[0]!,
    better,
    verdict: !verified ? "not_verified" : better ? "better_option_found" : "played_pass_was_best",
    seeds,
    horizon_s: horizonS,
    note
  }
}
```

Create `packages/advisor/src/position.ts`:

```ts
import { clampToPitch, whatIf, type Estimate, type PlayerState, type Vec2 } from "@touchline/sim-core"
import type { XtGrid } from "@touchline/stats"
import { AdvisorError, type Session } from "./session.js"
import { passValue, xtEndValue } from "./value.js"

export interface PositionAdvice {
  readonly player_id: string
  readonly tick: number
  /** attack: the player's team has the ball (be a better target); defend: the opponents have it (take away their best option). */
  readonly mode: "attack" | "defend"
  readonly from: Vec2
  readonly to: Vec2
  /** attack: value of a pass to the player there; defend: the opponents' best pass value with the player there (lower is better). */
  readonly value_now: number
  readonly value_best: number
  /** How much better the suggested spot is (always 0 or more). */
  readonly gain: number
  readonly verification: { readonly seeds: number; readonly horizon_s: number; readonly xg_diff: Estimate; readonly end_value: Estimate; readonly total: Estimate; readonly possession_end: Estimate } | null
}

export interface PositionOptions {
  /** How far the player may move (default 12 m). */
  readonly radiusM?: number
  /** Spacing of the spots tried (default 2 m). */
  readonly stepM?: number
  /** Paired seeds to check the move by re-simulation (default 0: no check). */
  readonly seeds?: number
  readonly horizonS?: number
}

/**
 * The best spot within reach for a player at a tick (the "ghost"): in attack, where a pass from the player on the
 * ball would be worth most (pitch control x xT, minus the threat if lost); in defence, where the ball carrier's
 * best pass option is worth least. Optionally checked by re-simulating the move over paired seeds.
 */
export const suggestPosition = (session: Session, playerId: string, tick: number, xt: XtGrid, opts: PositionOptions = {}): PositionAdvice => {
  const s = session.stateAt(tick)
  const me = s.players.find((p) => p.id === playerId)
  if (!me || me.sentOff) throw new AdvisorError(`no player "${playerId}" on the pitch at tick ${tick}`)
  if (s.possession.kind !== "owned") throw new AdvisorError(`nobody has the ball at tick ${tick}`)
  const carrier = s.players.find((p) => p.id === (s.possession as { playerId: string }).playerId)!
  if (carrier.id === me.id) throw new AdvisorError(`${playerId} is on the ball; ask about another player`)
  const mode = carrier.side === me.side ? "attack" : "defend"
  const radius = opts.radiusM ?? 12
  const stepM = opts.stepM ?? 2
  const at = (spot: Vec2): PlayerState[] => s.players.map((p) => (p.id === me.id ? { ...p, pos: spot, vel: { x: 0, y: 0 } } : p))
  // Attack: a pass to the player at the spot. Defence: the carrier's best pass to any teammate, with the player there.
  const score = (spot: Vec2): number => {
    const players = at(spot)
    if (mode === "attack") return passValue(s, me.side, carrier.id, carrier.pos, spot, xt, players).value
    let best = -Infinity
    for (const t of players) if (t.side === carrier.side && t.id !== carrier.id && !t.sentOff) best = Math.max(best, passValue(s, carrier.side, carrier.id, carrier.pos, t.pos, xt, players).value)
    return best
  }
  const better = (a: number, b: number) => (mode === "attack" ? a > b : a < b)
  const valueNow = score(me.pos)
  let bestSpot = me.pos
  let bestValue = valueNow
  for (let dx = -radius; dx <= radius; dx += stepM)
    for (let dy = -radius; dy <= radius; dy += stepM) {
      if (Math.hypot(dx, dy) > radius) continue
      const spot = clampToPitch({ x: me.pos.x + dx, y: me.pos.y + dy })
      const v = score(spot)
      if (better(v, bestValue)) {
        bestValue = v
        bestSpot = spot
      }
    }
  const seeds = opts.seeds ?? 0
  const r = seeds > 0 && bestSpot !== me.pos ? whatIf(s, { kind: "move_player", playerId: me.id, to: bestSpot }, { side: me.side, seeds, horizonS: opts.horizonS ?? 10, endValue: xtEndValue(xt) }) : null
  return {
    player_id: me.id,
    tick,
    mode,
    from: me.pos,
    to: bestSpot,
    value_now: valueNow,
    value_best: bestValue,
    gain: Math.abs(bestValue - valueNow),
    verification: r ? { seeds, horizon_s: r.horizon_s, xg_diff: r.difference.xg_diff, end_value: r.difference.end_value, total: r.difference.total, possession_end: r.difference.possession_end } : null
  }
}
```

Create `packages/advisor/src/index.ts`:

```ts
export * from "./explain.js"
export * from "./position.js"
export * from "./session.js"
export * from "./value.js"
```

- [ ] **Step 5: Run the tests**

Run: `pnpm --filter @touchline/advisor test && pnpm --filter @touchline/advisor typecheck`
Expected: 10 passed (about 30 s: two run folders are written and a scripted match is replayed); no type errors

- [ ] **Step 6: Commit**

```bash
git add packages/advisor pnpm-lock.yaml
git commit -m "feat(advisor): better-option explainer (options on paper and played out by re-simulation) and positioning advisor; sessions rebuilt from run folders

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```



### Task 8: MCP tools: pitch control, what-if, explain a pass, suggest a position

Four more MCP tools. `pitch_control` (from the stats engine's 10-second maps) needs nothing else; the other three need the match rebuilt: the CLI builds a `Session` from the run folder with the committed and the default parameters, and when the run cannot be rebuilt (other parameters, a mismatch) it serves the other tools and says why on stderr, and these three answer with a readable error. `what_if` takes an intervention (a discriminated union: `none`, `pass_to`, `move_player`, `tactic` with the style settings of a team) and optionally a baseline, a team, seeds (≤ 100) and a horizon (≤ 60 s), and uses the xT end value; `explain_pass` (seeds ≤ 40 per option) and `suggest_position` (seeds ≤ 100) wrap the advisor. Frames later than the latest ingested are refused (a server started with `--minute 60` cannot re-simulate later moments), and an explained event must be one the agent could know about. Numbers are rounded to 4 decimals; the server's instructions say these answers are estimates, not facts about the match.

**Files:**
- Create: `packages/mcp-stats/src/advise.ts`
- Modify: `packages/mcp-stats/src/server.ts`, `packages/mcp-stats/src/cli.ts`, `packages/mcp-stats/src/index.ts`, `packages/mcp-stats/package.json` (`@touchline/advisor`, `@touchline/sim-core`), `README.md`
- Test: `packages/mcp-stats/test/server.test.ts`

**Interfaces:**
- Consumes: Task 3's `engine.pitchControl`; Task 6's `whatIf`, `WhatIfError`, `Intervention`; Task 7's `Session`, `explainPass`, `suggestPosition`, `xtEndValue`, `AdvisorError`.
- Produces: `interface Advisor {session, xt}`, `registerAdvisorTools(server, query, advisor | null)`; `createStatsServer(query, advisor = null)`; tools `pitch_control {team_id, at_frame?}`, `what_if {at_frame, intervention, baseline?, team_id?, seeds?, horizon_s?}`, `explain_pass {event_id, seeds?}`, `suggest_position {player_id, at_frame?, seeds?}`.

- [ ] **Step 1: Write the failing tests**

Apply this change to `packages/mcp-stats/test/server.test.ts` (from the repository root):

```bash
git apply <<'PATCH'
diff --git a/packages/mcp-stats/test/server.test.ts b/packages/mcp-stats/test/server.test.ts
index e53a8dd..fe66e83 100644
--- a/packages/mcp-stats/test/server.test.ts
+++ b/packages/mcp-stats/test/server.test.ts
@@ -12,12 +12,14 @@ import { afterAll, beforeAll, describe, expect, it } from "vitest"
 import type { League } from "@touchline/league"
 import { writeMatch } from "@touchline/sim"
 import { DEFAULT_PARAMS } from "@touchline/sim-core"
-import { modelsFromJson, StatsEngine, StatsQuery } from "@touchline/stats"
+import { Session } from "@touchline/advisor"
+import { modelsFromJson, StatsEngine, StatsQuery, xtGridFromJson } from "@touchline/stats"
 import { loadRun } from "../src/load.js"
 import { createStatsServer } from "../src/server.js"
 
 const root = join(dirname(fileURLToPath(import.meta.url)), "../../..")
 const pkg = join(root, "packages/mcp-stats")
+const xt = xtGridFromJson(JSON.parse(readFileSync(join(root, "data/params/xt-grid.json"), "utf8")))
 const models = modelsFromJson(JSON.parse(readFileSync(join(root, "data/params/stats-models.json"), "utf8")))
 const league = JSON.parse(readFileSync(join(root, "data/league/league.json"), "utf8")) as League
 const dir = mkdtempSync(join(tmpdir(), "touchline-mcp-"))
@@ -26,6 +28,8 @@ const cfg = { matchId: "mcp", seed: 4246, kickoffTime: "2026-10-18T14:00:00.000Z
 type ToolResult = { content: Array<{ type: string; text: string }>; isError?: boolean }
 let q: StatsQuery
 let client: Client
+/** A client of a server that can re-simulate (the run rebuilt into a session). */
+let advised: Client
 const call = async (name: string, args: Record<string, unknown> = {}) => (await client.callTool({ name, arguments: args })) as ToolResult
 const data = async (name: string, args: Record<string, unknown> = {}) => {
   const r = await call(name, args)
@@ -35,18 +39,24 @@ const data = async (name: string, args: Record<string, unknown> = {}) => {
 
 beforeAll(async () => {
   await Effect.runPromise(writeMatch(cfg, dir))
-  q = await Effect.runPromise(loadRun(dir, models, { roster: league }))
+  q = await Effect.runPromise(loadRun(dir, models, { roster: league, xt }))
   const [a, b] = InMemoryTransport.createLinkedPair()
   await createStatsServer(q).connect(a)
   client = new Client({ name: "test", version: "0" })
   await client.connect(b)
+  const [c, d] = InMemoryTransport.createLinkedPair()
+  await createStatsServer(q, { session: Session.fromRun(dir, league, [DEFAULT_PARAMS]), xt }).connect(c)
+  advised = new Client({ name: "advised", version: "0" })
+  await advised.connect(d)
 }, 120_000)
 afterAll(() => client?.close())
 
 describe("MCP stats server", () => {
-  it("offer the nine read-only tools", async () => {
+  it("offer the thirteen read-only tools", async () => {
     const { tools } = await client.listTools()
-    expect(tools.map((t) => t.name).sort()).toEqual(["get_decision", "get_events", "get_metric", "get_series", "get_signals", "list_metrics", "match_info", "rank_players", "verify_claim"])
+    expect(tools.map((t) => t.name).sort()).toEqual([
+      "explain_pass", "get_decision", "get_events", "get_metric", "get_series", "get_signals", "list_metrics", "match_info", "pitch_control", "rank_players", "suggest_position", "verify_claim", "what_if"
+    ])
     for (const t of tools) expect(t.annotations?.readOnlyHint, t.name).toBe(true)
   })
 
@@ -146,6 +156,43 @@ describe("MCP stats server", () => {
     expect((await call("get_events", { types: ["shoot"] })).isError).toBe(true)
   })
 
+  it("map pitch control for either team, the two maps adding up to the whole pitch", async () => {
+    const home = await data("pitch_control", { team_id: cfg.home.id, at_frame: 30_005 })
+    const away = await data("pitch_control", { team_id: cfg.away.id, at_frame: 30_005 })
+    expect(home).toMatchObject({ as_of_frame: 30_005, sample_frame: 30_000, cols: 21, rows: 14 })
+    expect(home.control).toHaveLength(294)
+    expect(home.share + away.share).toBeCloseTo(1, 3)
+    expect((await call("pitch_control", { team_id: "nobody-fc" })).isError).toBe(true)
+  })
+
+  it("re-simulate what-ifs from a frame, refusing frames past the latest and servers that cannot", async () => {
+    const at = q.engine.events.find((e) => e.type === "pass" && e.frame_id > 20_000)!.frame_id - 1
+    const call2 = async (name: string, args: Record<string, unknown>) => (await advised.callTool({ name, arguments: args })) as ToolResult
+    const same = JSON.parse((await call2("what_if", { at_frame: at, intervention: { kind: "none" }, seeds: 4, horizon_s: 5 })).content[0]!.text)
+    expect(same.difference.total).toEqual({ mean: 0, se: 0 })
+    const press = JSON.parse((await call2("what_if", { at_frame: at, intervention: { kind: "tactic", team_id: cfg.away.id, style: { pressIntensity: 1 } }, team_id: cfg.home.id, seeds: 4, horizon_s: 5 })).content[0]!.text)
+    expect(press).toMatchObject({ team_id: cfg.home.id, seeds: 4, horizon_s: 5, at_tick: at })
+    expect((await call2("what_if", { at_frame: q.engine.now + 10, intervention: { kind: "none" } })).content[0]!.text).toMatch(/later than the latest frame/)
+    expect((await call("what_if", { at_frame: at, intervention: { kind: "none" } })).content[0]!.text).toMatch(/not available/)
+  })
+
+  it("explain a pass and suggest a position through the re-simulation tools", async () => {
+    const pass = q.engine.events.find((e) => e.type === "pass" && e.frame_id > 20_000 && (e.attrs.options as unknown[]).length >= 3)!
+    const x = JSON.parse(((await advised.callTool({ name: "explain_pass", arguments: { event_id: pass.id, seeds: 4 } })) as ToolResult).content[0]!.text)
+    expect(x.event_id).toBe(pass.id)
+    expect(["played_pass_was_best", "better_option_found", "not_verified"]).toContain(x.verdict)
+    const mate = cfg.home.starters[5]!.id
+    let t = 20_000
+    while (true) {
+      const r = (await advised.callTool({ name: "suggest_position", arguments: { player_id: mate, at_frame: t } })) as ToolResult
+      if (!r.isError) {
+        expect(["attack", "defend"]).toContain(JSON.parse(r.content[0]!.text).mode)
+        break
+      }
+      t += 50
+    }
+  })
+
   it("load a match as it stood at a given minute", async () => {
     const at30 = await Effect.runPromise(loadRun(dir, models, { minute: 30 }))
     expect(at30.engine.now).toBe(18_000)
PATCH
```

- [ ] **Step 2: Run them to make sure they fail**

Run: `pnpm --filter @touchline/mcp-stats test`
Expected: the file fails to load: `Cannot find package '@touchline/advisor'`

- [ ] **Step 3: Add the tools**

Create `packages/mcp-stats/src/advise.ts`:

```ts
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { z } from "zod"
import { AdvisorError, explainPass, suggestPosition, xtEndValue, type Session } from "@touchline/advisor"
import { whatIf, WhatIfError, type Intervention, type Side } from "@touchline/sim-core"
import { StatsError, type StatsQuery, type XtGrid } from "@touchline/stats"

/** What the what-if tools need: the match rebuilt for re-simulation, and the expected-threat grid. */
export interface Advisor {
  readonly session: Session
  readonly xt: XtGrid
}

const ok = (v: unknown) => ({ content: [{ type: "text" as const, text: JSON.stringify(v) }] })
const fail = (message: string) => ({ content: [{ type: "text" as const, text: message }], isError: true })
const answer = (f: () => unknown) => {
  try {
    return ok(f())
  } catch (e) {
    if (e instanceof StatsError || e instanceof AdvisorError || e instanceof WhatIfError) return fail(e.message)
    throw e
  }
}
/** Round every number in a result to 4 decimals (results are for reading, not for further sums). */
const tidy = (v: unknown): unknown =>
  typeof v === "number" ? Math.round(v * 1e4) / 1e4 : Array.isArray(v) ? v.map(tidy) : v && typeof v === "object" ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, tidy(x)])) : v

const readOnly = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false } as const
const frame = z.number().int().min(0)
const styleSetting = z.number().min(-1).max(1).optional()
const intervention = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("none") }),
  z.object({ kind: z.literal("pass_to"), player_id: z.string().describe("the player on the ball"), receiver_id: z.string(), pass_kind: z.string().optional().describe("short, long, through, switch, cross, cutback, back, lofted_through") }),
  z.object({ kind: z.literal("move_player"), player_id: z.string(), x: z.number().min(-52.5).max(52.5), y: z.number().min(-34).max(34) }),
  z.object({
    kind: z.literal("tactic"),
    team_id: z.string(),
    style: z.object({ pressIntensity: styleSetting, lineHeight: styleSetting, compactness: styleSetting, tempo: styleSetting, longBallBias: styleSetting, crossBias: styleSetting, riskTolerance: styleSetting }).describe("press intensity, compactness, tempo, risk tolerance: 0..1; line height, long-ball and cross bias: -1..1")
  })
])

/** The what-if, explainer, advisor and pitch-control tools, added to a stats server. */
export const registerAdvisorTools = (server: McpServer, q: StatsQuery, a: Advisor | null): void => {
  const sideOf = (teamId: string): Side => {
    const t = q.engine.team(teamId)
    if (!t) throw new StatsError(`unknown team "${teamId}"; match_info lists the teams`)
    return t.side
  }
  const teamIdOf = (side: Side) => (side === "home" ? q.engine.info.home.id : q.engine.info.away.id)
  /** A frame no later than the latest ingested (what-if never looks past what the agent could know). */
  const known = (f: number | undefined) => {
    const t = q.asOf(f)
    if (f !== undefined && f > t) throw new StatsError(`frame ${f} is later than the latest frame (${t})`)
    return t
  }
  const needAdvisor = () => {
    if (!a) throw new StatsError("re-simulation is not available for this match (its run folder could not be rebuilt; see the server log)")
    return a
  }
  const toIntervention = (iv: z.infer<typeof intervention>): Intervention => {
    switch (iv.kind) {
      case "none":
        return iv
      case "pass_to":
        return { kind: "pass_to", playerId: iv.player_id, receiverId: iv.receiver_id, ...(iv.pass_kind ? { passKind: iv.pass_kind } : {}) }
      case "move_player":
        return { kind: "move_player", playerId: iv.player_id, to: { x: iv.x, y: iv.y } }
      case "tactic":
        return { kind: "tactic", side: sideOf(iv.team_id), style: Object.fromEntries(Object.entries(iv.style).filter(([, v]) => v !== undefined)) }
    }
  }

  server.registerTool(
    "pitch_control",
    {
      title: "Pitch control map",
      description: "Which team would win the ball where: a 21 x 14 grid (row-major, row 0 at y = -34, column 0 at x = -52.5) of the team's control (0..1), from the latest 10-second sample at or before the frame, and the team's share of the pitch.",
      inputSchema: { team_id: z.string(), at_frame: frame.optional() },
      annotations: readOnly
    },
    async ({ team_id, at_frame }) =>
      answer(() => {
        const side = sideOf(team_id)
        const t = q.asOf(at_frame)
        const map = q.engine.pitchControl(t)
        if (!map) throw new StatsError(`no pitch-control sample yet at frame ${t}`)
        const control = map.home.map((v) => (side === "home" ? v : 1 - v))
        return tidy({ team_id, as_of_frame: t, sample_frame: map.tick, cols: map.cols, rows: map.rows, share: control.reduce((x, y) => x + y, 0) / control.length, control })
      })
  )

  server.registerTool(
    "what_if",
    {
      title: "What if",
      description: "Re-simulate from a frame with one change (force a pass, move a player, change a team's style) against a baseline (default: no change), over paired random seeds, and report the mean and standard error of each outcome for the team and the difference: goal and xG difference, shots, possession and ball progress at the end, the expected threat left at the end, and their total.",
      inputSchema: {
        at_frame: frame,
        intervention,
        baseline: intervention.optional(),
        team_id: z.string().optional().describe("whose outcome to measure (default: the team on the ball)"),
        seeds: z.number().int().min(1).max(100).optional().describe("paired seeds (default 20)"),
        horizon_s: z.number().positive().max(60).optional().describe("seconds played ahead (default 15)")
      },
      annotations: readOnly
    },
    async ({ at_frame, intervention: iv, baseline, team_id, seeds, horizon_s }) =>
      answer(() => {
        const { session, xt } = needAdvisor()
        const t = known(at_frame)
        const r = whatIf(session.stateAt(t), toIntervention(iv), {
          ...(team_id ? { side: sideOf(team_id) } : {}),
          seeds: seeds ?? 20,
          horizonS: horizon_s ?? 15,
          endValue: xtEndValue(xt),
          ...(baseline ? { baseline: toIntervention(baseline) } : {})
        })
        const { side, ...rest } = r
        return tidy({ team_id: teamIdOf(side), ...rest })
      })
  )

  server.registerTool(
    "explain_pass",
    {
      title: "Explain a pass",
      description: "Was there a better pass? Every option the player weighed, scored on paper (pitch control x expected threat) and played out by re-simulation against the pass played; a better option is reported only when it is clearly better in play (mean above twice its standard error).",
      inputSchema: { event_id: z.string(), seeds: z.number().int().min(0).max(40).optional().describe("paired seeds per option (default 20; 0: on paper only)") },
      annotations: readOnly
    },
    async ({ event_id, seeds }) =>
      answer(() => {
        const { session, xt } = needAdvisor()
        // Only events the agent could know about by the latest frame.
        q.decision(event_id)
        return tidy(explainPass(session, event_id, xt, { seeds: seeds ?? 20 }))
      })
  )

  server.registerTool(
    "suggest_position",
    {
      title: "Suggest a position",
      description: "The best spot within 12 m for a player at a frame (a 'ghost'): in attack where a pass to them would be worth most, in defence where the ball carrier's best option is worth least; optionally checked by re-simulating the move.",
      inputSchema: { player_id: z.string(), at_frame: frame.optional(), seeds: z.number().int().min(0).max(100).optional().describe("paired seeds to check the move (default 0: no check)") },
      annotations: readOnly
    },
    async ({ player_id, at_frame, seeds }) =>
      answer(() => {
        const { session, xt } = needAdvisor()
        return tidy(suggestPosition(session, player_id, known(at_frame), xt, { seeds: seeds ?? 0 }))
      })
  )
}
```

Apply this change to `packages/mcp-stats/src/server.ts`, `packages/mcp-stats/src/index.ts`, `packages/mcp-stats/package.json` (from the repository root):

```bash
git apply <<'PATCH'
diff --git a/packages/mcp-stats/package.json b/packages/mcp-stats/package.json
index b7d896e..c4cd8b8 100644
--- a/packages/mcp-stats/package.json
+++ b/packages/mcp-stats/package.json
@@ -3,15 +3,25 @@
   "version": "0.1.0",
   "private": true,
   "type": "module",
-  "exports": { ".": "./src/index.ts" },
-  "scripts": { "test": "vitest run", "typecheck": "tsc --noEmit -p .", "serve": "tsx src/cli.ts" },
+  "exports": {
+    ".": "./src/index.ts"
+  },
+  "scripts": {
+    "test": "vitest run",
+    "typecheck": "tsc --noEmit -p .",
+    "serve": "tsx src/cli.ts"
+  },
   "dependencies": {
     "@modelcontextprotocol/sdk": "1.32.0",
+    "@touchline/advisor": "workspace:*",
     "@touchline/schema": "workspace:*",
     "@touchline/sim": "workspace:*",
+    "@touchline/sim-core": "workspace:*",
     "@touchline/stats": "workspace:*",
     "effect": "4.0.0",
     "zod": "4.6.5"
   },
-  "devDependencies": { "@touchline/league": "workspace:*", "@touchline/sim-core": "workspace:*" }
+  "devDependencies": {
+    "@touchline/league": "workspace:*"
+  }
 }
diff --git a/packages/mcp-stats/src/index.ts b/packages/mcp-stats/src/index.ts
index 9cfafa6..26c0a00 100644
--- a/packages/mcp-stats/src/index.ts
+++ b/packages/mcp-stats/src/index.ts
@@ -1,2 +1,3 @@
+export * from "./advise.js"
 export * from "./load.js"
 export * from "./server.js"
diff --git a/packages/mcp-stats/src/server.ts b/packages/mcp-stats/src/server.ts
index 80547f1..7d68275 100644
--- a/packages/mcp-stats/src/server.ts
+++ b/packages/mcp-stats/src/server.ts
@@ -2,6 +2,7 @@ import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
 import { z } from "zod"
 import { EventType, SignalType } from "@touchline/schema"
 import { METRICS, StatsError, type StatsQuery } from "@touchline/stats"
+import { registerAdvisorTools, type Advisor } from "./advise.js"
 
 export const SERVER_NAME = "touchline-stats"
 export const SERVER_VERSION = "0.1.0"
@@ -10,7 +11,8 @@ const instructions = (fps: number) => [
   "Read-only statistics for one football match from the Touchline stats engine.",
   "Every number you state must come from these tools: cite the metric id and the `ref` (metric@from-to) or event ids they return.",
   `Frames are global ticks (${fps} per second in this match; match_info gives dt and fps); every answer says which frame it is as of (\`as_of_frame\`) and never includes anything later.`,
-  "Subjects are \"match\", a team id or a player id (match_info lists them). list_metrics says which subjects and windows each metric supports."
+  "Subjects are \"match\", a team id or a player id (match_info lists them). list_metrics says which subjects and windows each metric supports.",
+  "what_if, explain_pass and suggest_position re-simulate from the state at a frame; their numbers are estimates with standard errors, never facts about the match."
 ].join(" ")
 const eventType = z.enum([...EventType.literals] as [string, ...string[]])
 
@@ -38,8 +40,8 @@ const answer = (f: () => unknown) => {
 
 const readOnly = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false } as const
 
-/** An MCP server exposing the stats tools (spec §5.3) over one match's StatsQuery. */
-export const createStatsServer = (q: StatsQuery): McpServer => {
+/** An MCP server exposing the stats tools (spec §5.3) over one match's StatsQuery; the re-simulation tools need `advisor`. */
+export const createStatsServer = (q: StatsQuery, advisor: Advisor | null = null): McpServer => {
   const server = new McpServer({ name: SERVER_NAME, version: SERVER_VERSION }, { instructions: instructions(Math.round(1 / q.engine.info.dt)) })
 
   server.registerTool(
@@ -161,5 +163,6 @@ export const createStatsServer = (q: StatsQuery): McpServer => {
     async ({ metric_id, subject, at_frame, value, window_s, tolerance }) => answer(() => q.verifyClaim(metric_id, subject, at_frame, value, window_s, tolerance))
   )
 
+  registerAdvisorTools(server, q, advisor)
   return server
 }
PATCH
```

Run: `pnpm install`
Expected: `@touchline/mcp-stats` now depends on `@touchline/advisor`

- [ ] **Step 4: Rebuild the match in the CLI**

Apply this change to `packages/mcp-stats/src/cli.ts` (from the repository root):

```bash
git apply <<'PATCH'
diff --git a/packages/mcp-stats/src/cli.ts b/packages/mcp-stats/src/cli.ts
index 3b2eecf..3c4b182 100644
--- a/packages/mcp-stats/src/cli.ts
+++ b/packages/mcp-stats/src/cli.ts
@@ -5,9 +5,12 @@ import { fileURLToPath } from "node:url"
 import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js"
 import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js"
 import { Effect } from "effect"
+import { AdvisorError, Session } from "@touchline/advisor"
+import { DEFAULT_PARAMS, paramsFromJson, type TeamSetup } from "@touchline/sim-core"
 import { CliError, cliOptions, exitOnUserError, integer } from "@touchline/sim"
 import { modelsFromJson, ReplayError, xtGridFromJson, type Roster, type StatsQuery } from "@touchline/stats"
 import { loadRun } from "./load.js"
+import type { Advisor } from "./advise.js"
 import { createStatsServer } from "./server.js"
 
 const root = join(dirname(fileURLToPath(import.meta.url)), "../../..")
@@ -29,13 +32,13 @@ const leaguePath = join(root, "data/league/league.json")
 const roster = existsSync(leaguePath) ? (JSON.parse(readFileSync(leaguePath, "utf8")) as Roster) : undefined
 
 /** Stateless Streamable HTTP: a fresh server and transport per request, all reading the same loaded match. */
-const serveHttp = (q: StatsQuery, port: number) => {
+const serveHttp = (q: StatsQuery, advisor: Advisor | null, port: number) => {
   const http = createServer(async (req: IncomingMessage, res: ServerResponse) => {
     if (req.url !== "/mcp" || req.method !== "POST") {
       res.writeHead(req.url === "/mcp" ? 405 : 404).end()
       return
     }
-    const server = createStatsServer(q)
+    const server = createStatsServer(q, advisor)
     const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true })
     res.on("close", () => {
       void transport.close()
@@ -50,11 +53,25 @@ const serveHttp = (q: StatsQuery, port: number) => {
   })
 }
 
+/** The match rebuilt for the re-simulation tools, or null (with the reason on stderr) when the run cannot be rebuilt. */
+const rebuild = (dir: string): Advisor | null => {
+  if (!roster) return null
+  try {
+    const committed = paramsFromJson(JSON.parse(readFileSync(join(root, "data/params/touchline-params.json"), "utf8")))
+    return { session: Session.fromRun(dir, roster as unknown as { clubs: ReadonlyArray<TeamSetup> }, [committed, DEFAULT_PARAMS]), xt }
+  } catch (e) {
+    if (!(e instanceof AdvisorError)) throw e
+    console.error(`re-simulation tools disabled: ${e.message}`)
+    return null
+  }
+}
+
 Effect.runPromise(loadRun(here(o.run), models, { xt, ...(o.minute ? { minute: Number(o.minute) } : {}), ...(roster ? { roster } : {}) }))
   .then(async (q) => {
-    if (o.http !== "") serveHttp(q, Number(o.http))
+    const advisor = rebuild(here(o.run))
+    if (o.http !== "") serveHttp(q, advisor, Number(o.http))
     else {
-      await createStatsServer(q).connect(new StdioServerTransport())
+      await createStatsServer(q, advisor).connect(new StdioServerTransport())
       console.error(`touchline-stats MCP on stdio: ${q.engine.info.matchId} as of frame ${q.engine.now}`)
     }
   })
PATCH
```

- [ ] **Step 5: Run the tests**

Run: `pnpm --filter @touchline/mcp-stats test`
Expected: 17 passed

Run: `pnpm turbo run typecheck test --force`
Expected: `Tasks: 16 successful`

- [ ] **Step 6: Document it**

Apply this change to `README.md` (from the repository root):

````bash
git apply <<'PATCH'
diff --git a/README.md b/README.md
index c2c4f00..f677c3a 100644
--- a/README.md
+++ b/README.md
@@ -56,6 +56,8 @@ pnpm stats --run out/m-7 --signals out/m-7/signals.jsonl
 
 Agents read the match only through MCP tools (spec §5.3): `match_info`, `list_metrics`, `get_metric`, `get_series`, `rank_players`, `get_signals`, `get_events`, `get_decision` and `verify_claim`. All are read-only, every answer says which frame it is as of, and nothing later than that is ever returned.
 
+Four more tools look at the match through the engine itself: `pitch_control` (who would win the ball where), `what_if` (re-simulate from a frame with a forced pass, a moved player or a changed team style, against a baseline, over paired seeds), `explain_pass` (every option the passer weighed, on paper by pitch control × expected threat and played out by re-simulation; a better option is reported only when it is clearly better in play) and `suggest_position` (the best spot within 12 m for a player, in attack or defence). The server rebuilds the run from its manifest for these; a run made with parameters it does not have keeps the other tools and says why on stderr.
+
 ```bash
 pnpm -s mcp-stats --run out/m-7                 # stdio (stdout carries the protocol; logs go to stderr)
 pnpm -s mcp-stats --run out/m-7 --minute 60     # the match as it stood at 60'
@@ -68,11 +70,12 @@ An MCP client can launch it directly, for example: `{"command": "npx", "args": [
 
 | Package | What it does |
 |---|---|
-| `packages/sim-core` | The match engine: one pure, deterministic `step(state)` per 0.1 s tick |
+| `packages/sim-core` | The match engine: one pure, deterministic `step(state)` per 0.1 s tick; pitch control; what-if forks |
 | `packages/league` | Fictional league generator: 8 clubs, kits, styles, 160 players |
 | `packages/schema` | Effect Schema for the live domain stream (events and frames) and for signals and metric ids |
 | `packages/sim` | Effect streams, CDF v0.3.2 writers, run manifest, CLI |
 | `packages/stats` | Stats engine: metrics and signals on the domain stream, replay of run folders, `pnpm stats` |
+| `packages/advisor` | What-if sessions rebuilt from run folders, better-option explainer, positioning advisor |
 | `packages/mcp-stats` | MCP server exposing the stats tools to agents (stdio or Streamable HTTP) |
 | `packages/calibrate` | Match statistics (identical to the Python definitions), tuning knobs, tuner, realism gate |
 | `python/analytics` | CDF validation, IDSSE download, real-match targets, realism report, stats-model fitting |
PATCH
````

- [ ] **Step 7: Commit**

```bash
git add packages/mcp-stats pnpm-lock.yaml README.md
git commit -m "feat(mcp-stats): pitch_control, what_if, explain_pass and suggest_position tools

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```



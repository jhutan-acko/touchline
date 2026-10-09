# Simulation Realism (Spatial Metrics + Off-Ball Behaviour) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Measure team shape and space against real tracking (all seven IDSSE matches), then add support play, marking, and on-ball shielding/steering to the engine, so the simulation matches real football in space as well as in event counts.

**Architecture:** Seven spatial metrics are defined once in Python (`metrics.py`) and ported line for line to TypeScript (`packages/calibrate/src/metrics.ts`), with the existing parity test guarding the port. They flow into the targets file, the realism report and the realism gate. The new behaviours live in a new pure module `packages/sim-core/src/offball.ts`, wired into `moveTarget`/`moveAll` in `step.ts` behind parameters that default to *off*. The realism baseline therefore stays bit-identical until Task 8 switches the behaviours on, recalibrates and re-baselines in one step.

**Tech Stack:** TypeScript (pnpm/turbo monorepo, vitest), Python 3.11 (uv, pytest, kloppy), IDSSE / Sportec Open DFL data.

**Spec:** `docs/superpowers/specs/2026-10-07-sim-realism-contract.md` (criteria C1–C5).

## Global Constraints

- One metric definition for real and synthetic data: Python `metrics.py` is the reference, and `packages/calibrate/src/metrics.ts` is a line-for-line port checked by `packages/calibrate/test/parity.test.ts` to 9 decimal places.
- Commit only aggregate statistics from real data (IDSSE, CC-BY-4.0); never commit raw rows. `data/raw/idsse/` stays git-ignored.
- The engine is deterministic for a seed. New code in `sim-core` must not draw random numbers.
- Every new behaviour parameter defaults to *off* until Task 8: `support.count: 0`, `marking.weight: 0`, `carry.avoidM: 0`, `carry.shieldM: 0`.
- Spatial targets come from all seven IDSSE tracking matches (`--spatial` default: every match in `MATCHES`). The existing tracking targets stay on J03WPY (`--tracking` default `J03WPY`) and must not change.
- Pitch coordinates are centred metres, 105 × 68 (`PITCH.halfL = 52.5`, `PITCH.halfW = 34`).
- Commit messages end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Run every command from the `touchline/` repository root.

## Review Focus

1. **Real tracking frames with no ball position, or with a team down to fewer than 3 players (red cards):** skip the frame, don't crash or produce NaN. Test in Task 1.
2. **Teams changing ends at half-time in real data (the simulation never switches ends):** each period's attack direction is taken from that period's first frame, so line height and depth are correct in both halves. Test in Task 1.
3. **A supporter's spot near a corner flag:** must stay on the pitch. Test in Task 5.
4. **A carrier shielding next to the touchline:** must not be pushed off the pitch. Test in Task 7.
5. **The support spot changing smoothly as the carrier moves (no jitter between angles):** a small move of the carrier gives a small move of the spot. Test in Task 5.

---

### Task 1: Spatial metrics in Python

**Files:**
- Modify: `python/analytics/touchline_analytics/metrics.py` (add constants and `spatial_metrics` after `tracking_metrics`)
- Test: `python/analytics/tests/test_metrics.py`

**Interfaces:**
- Produces: `SPATIAL_KEYS: list[str]`, `SPATIAL_SAMPLE_S = 1.0`, `SUPPORT_RADIUS_M = 15.0`, and `spatial_metrics(frames, half_length: float = 52.5) -> dict[str, float]`. Each frame is a tuple `(period: str, t: float, live: bool, poss: "home"|"away"|None, ball: (x, y)|None, teams: {"home": [(x, y)], "away": [(x, y)]})`.

Metric definitions. Each is computed on frames that are live, have a team in possession, have a ball position and have at least 3 players on each side, sampled at most once per whole second of each period:

| Key | Definition | Aggregate |
|---|---|---|
| `width_poss_m` | max y − min y of the team in possession | median |
| `width_def_m` | max y − min y of the defending team | median |
| `length_def_m` | defending team's most advanced player minus its second-deepest player (the deepest is the keeper), along its attack direction | median |
| `line_height_def_m` | the defending team's second-deepest player's distance from its own goal line | median |
| `ball_pressure_m` | distance from the ball to the nearest defender | median |
| `support_15m` | players in possession within 15 m of the ball, minus 1 (the carrier), floored at 0 | mean |
| `free_space_m` | median over in-possession players, excluding the one nearest the ball, of the distance to their nearest opponent | median |

A team's attack direction in each period is +1 if its mean x in that period's first frame is negative, else −1.

- [ ] **Step 1: Write the failing tests** (append to `python/analytics/tests/test_metrics.py`)

```python
from touchline_analytics.metrics import spatial_metrics

HOME = [(-45.0, 0.0), (-5.0, -15.0), (0.0, 0.0), (5.0, 10.0)]
AWAY = [(45.0, 0.0), (10.0, -10.0), (4.0, 0.0), (20.0, 12.0)]


def sframe(t, ball=(0.0, 0.0), live=True, poss="home", period="first_half", home=HOME, away=AWAY):
    return (period, t, live, poss, ball, {"home": list(home), "away": list(away)})


def test_spatial_metrics_measure_shape_pressure_support_and_space():
    # Only the first frame counts: the next is in the same second, then dead ball, then no possession.
    m = spatial_metrics([sframe(0.0), sframe(0.5, ball=(40.0, 0.0)), sframe(1.0, live=False), sframe(1.2, poss=None)])
    assert m["width_poss_m"] == 25.0
    assert m["width_def_m"] == 22.0
    assert m["length_def_m"] == 16.0
    assert m["line_height_def_m"] == 32.5
    assert m["ball_pressure_m"] == 4.0
    assert m["support_15m"] == 1.0
    assert math.isclose(m["free_space_m"], math.hypot(15, 5))


def test_spatial_metrics_follow_each_period_attack_direction_and_skip_unusable_frames():
    flipped_home = [(-x, y) for x, y in HOME]
    flipped_away = [(-x, y) for x, y in AWAY]
    m = spatial_metrics([
        sframe(0.0, period="second_half", home=flipped_home, away=flipped_away, poss="away", ball=(-4.0, 0.0)),
        sframe(1.0, ball=None),        # no ball position
        sframe(2.0, home=HOME[:2]),    # a team with fewer than 3 players
    ])
    # In the second half home defends the +x goal: its deepest outfielder is at x = 5 -> u = -5.
    assert m["line_height_def_m"] == 47.5
    assert m["length_def_m"] == 10.0
    assert m["ball_pressure_m"] == 4.0


def test_spatial_metrics_with_no_usable_frames_are_nan():
    m = spatial_metrics([])
    assert all(math.isnan(m[k]) for k in m)
```

- [ ] **Step 2: Run the tests and check they fail**

Run: `uv run --project python/analytics pytest python/analytics/tests/test_metrics.py -k spatial -v`
Expected: FAIL with `ImportError: cannot import name 'spatial_metrics'`

- [ ] **Step 3: Implement** (in `metrics.py`, after `tracking_metrics`)

```python
SPATIAL_SAMPLE_S = 1.0
SUPPORT_RADIUS_M = 15.0
SPATIAL_KEYS = ["width_poss_m", "width_def_m", "length_def_m", "line_height_def_m", "ball_pressure_m", "support_15m", "free_space_m"]


def spatial_metrics(frames: Iterable[tuple], half_length: float = 52.5) -> dict:
    """Team shape and space, once a second, on live frames with a team in possession.

    frames: (period, t_seconds, ball_in_play, poss "home"|"away"|None, ball (x, y)|None, {"home": [(x, y)], "away": [(x, y)]}).
    Each team's attack direction per period comes from its mean x in that period's first frame (teams change ends).
    """
    dirs: dict[str, dict[str, int]] = {}
    last_sec: dict[str, int] = {}
    w_poss: list[float] = []
    w_def: list[float] = []
    length: list[float] = []
    line: list[float] = []
    press: list[float] = []
    support: list[float] = []
    space: list[float] = []
    for period, t, live, poss, ball, teams in frames:
        if period not in dirs and teams["home"] and teams["away"]:
            dirs[period] = {s: 1 if sum(p[0] for p in teams[s]) / len(teams[s]) < 0 else -1 for s in ("home", "away")}
        if not live or poss not in ("home", "away") or ball is None or period not in dirs:
            continue
        sec = math.floor(t / SPATIAL_SAMPLE_S + 1e-6)
        if last_sec.get(period) == sec:
            continue
        last_sec[period] = sec
        def_side = "away" if poss == "home" else "home"
        att, dfn = teams[poss], teams[def_side]
        if len(att) < 3 or len(dfn) < 3:
            continue
        w_poss.append(max(p[1] for p in att) - min(p[1] for p in att))
        w_def.append(max(p[1] for p in dfn) - min(p[1] for p in dfn))
        u = sorted(dirs[period][def_side] * p[0] for p in dfn)
        length.append(u[-1] - u[1])
        line.append(u[1] + half_length)
        bx, by = ball
        press.append(min(math.hypot(p[0] - bx, p[1] - by) for p in dfn))
        support.append(max(0, sum(1 for p in att if math.hypot(p[0] - bx, p[1] - by) <= SUPPORT_RADIUS_M) - 1))
        carrier = min(range(len(att)), key=lambda i: math.hypot(att[i][0] - bx, att[i][1] - by))
        space.append(_median([min(math.hypot(p[0] - q[0], p[1] - q[1]) for q in dfn) for i, p in enumerate(att) if i != carrier]))
    return {
        "width_poss_m": _median(w_poss),
        "width_def_m": _median(w_def),
        "length_def_m": _median(length),
        "line_height_def_m": _median(line),
        "ball_pressure_m": _median(press),
        "support_15m": sum(support) / len(support) if support else float("nan"),
        "free_space_m": _median(space),
    }
```

- [ ] **Step 4: Run the tests and check they pass**

Run: `uv run --project python/analytics pytest python/analytics/tests/test_metrics.py -v`
Expected: all PASS (the new spatial tests and the existing ones)

- [ ] **Step 5: Commit**

```bash
git add python/analytics/touchline_analytics/metrics.py python/analytics/tests/test_metrics.py
git commit -m "feat(analytics): spatial metrics for team shape, pressure, support and space

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Spatial targets from all seven matches, the synthetic adapter, and report labels

**Files:**
- Modify: `python/analytics/touchline_analytics/metrics.py` (add `touchline_spatial_frames`; extend `touchline_metrics`)
- Modify: `python/analytics/touchline_analytics/targets.py` (add `idsse_spatial`; `build(root, tracking, spatial)`; `--tracking` and `--spatial` options)
- Modify: `python/analytics/touchline_analytics/report.py` (`LABELS`)
- Test: `python/analytics/tests/test_metrics.py`, `python/analytics/tests/test_report.py`
- Regenerate: `data/params/targets-idsse.json`

**Interfaces:**
- Consumes: `spatial_metrics`, `SPATIAL_KEYS` (Task 1).
- Produces: `touchline_spatial_frames(run_dir: Path, fps: float)` (a generator of Task 1 frame tuples). `touchline_metrics(run_dir)` now also returns the 7 spatial keys, which Task 3's parity test relies on. `targets-idsse.json` gains `metrics.<spatial key>` entries `{mean, sd, n: 7}`.

- [ ] **Step 1: Write the failing tests**

Append to `python/analytics/tests/test_metrics.py`:

```python
def test_touchline_spatial_frames_reads_possession_ball_and_teams(tmp_path):
    import json

    from touchline_analytics.metrics import touchline_spatial_frames

    (tmp_path / "meta.json").write_text(json.dumps({"teams": {"home": {"id": "h"}, "away": {"id": "a"}}}))
    line = {
        "frame_id": 30, "period": "second_half",
        "teams": {"home": {"players": [{"id": "h1", "x": 1.0, "y": 2.0}]}, "away": {"players": [{"id": "a1", "x": -1.0, "y": -2.0}]}},
        "ball": {"x": 3.0, "y": 4.0, "z": 0.0, "status": True, "poss_team_id": "a"},
    }
    (tmp_path / "tracking.jsonl").write_text(json.dumps(line) + "\n")
    [(period, t, live, poss, ball, teams)] = list(touchline_spatial_frames(tmp_path, 10.0))
    assert (period, t, live, poss, ball) == ("second_half", 10_003.0, True, "away", (3.0, 4.0))
    assert teams == {"home": [(1.0, 2.0)], "away": [(-1.0, -2.0)]}
```

Append to `python/analytics/tests/test_report.py`:

```python
def test_report_labels_every_spatial_metric():
    from touchline_analytics.metrics import SPATIAL_KEYS
    from touchline_analytics.report import LABELS

    assert all(k in LABELS for k in SPATIAL_KEYS)
```

- [ ] **Step 2: Run the tests and check they fail**

Run: `uv run --project python/analytics pytest python/analytics/tests/test_metrics.py python/analytics/tests/test_report.py -v`
Expected: FAIL with `ImportError: cannot import name 'touchline_spatial_frames'`, and an assertion failure on the labels test

- [ ] **Step 3: Implement the synthetic adapter** (in `metrics.py`, before `touchline_metrics`)

```python
def touchline_spatial_frames(run_dir: Path, fps: float):
    """Touchline tracking.jsonl as spatial_metrics frames; possession from ball.poss_team_id."""
    home_id = json.loads((run_dir / "meta.json").read_text())["teams"]["home"]["id"]
    offset = {"first_half": 0.0, "second_half": 10_000.0}
    with (run_dir / "tracking.jsonl").open() as fh:
        for line in fh:
            f = json.loads(line)
            pid = f["ball"].get("poss_team_id")
            poss = None if pid is None else ("home" if pid == home_id else "away")
            teams = {s: [(p["x"], p["y"]) for p in f["teams"][s]["players"]] for s in ("home", "away")}
            yield f["period"], offset[f["period"]] + f["frame_id"] / fps, bool(f["ball"].get("status")), poss, (f["ball"]["x"], f["ball"]["y"]), teams
```

In `touchline_metrics`, after `m.update(tracking_metrics(frames()))`, add:

```python
    m.update(spatial_metrics(touchline_spatial_frames(run_dir, fps)))
```

- [ ] **Step 4: Add the report labels** (append to `LABELS` in `report.py`, after `peak_speed_kmh_median`)

```python
    "width_poss_m": ("Team width in possession (m)", "{:.1f}"),
    "width_def_m": ("Team width out of possession (m)", "{:.1f}"),
    "length_def_m": ("Defending team length, keeper excluded (m)", "{:.1f}"),
    "line_height_def_m": ("Defensive line height from own goal (m)", "{:.1f}"),
    "ball_pressure_m": ("Nearest defender to the ball (m)", "{:.1f}"),
    "support_15m": ("Teammates within 15 m of the ball", "{:.2f}"),
    "free_space_m": ("Off-ball attacker to nearest defender (m)", "{:.1f}"),
```

- [ ] **Step 5: Add real spatial targets** (in `targets.py`)

Change the imports and keys:

```python
from .metrics import PASS_LEN_EDGES, SPATIAL_KEYS, SPEED_EDGES, event_metrics, spatial_metrics, tracking_metrics
```

Add after `idsse_frames`:

```python
def idsse_spatial(root: Path, match_id: str) -> dict:
    """Spatial metrics of one real match (tracking at 5 Hz; spatial_metrics samples once a second)."""
    f = filenames(match_id)
    ds = sportec.load_tracking(raw_data=str(root / f["tracking"]), meta_data=str(root / f["meta"]), coordinates="secondspectrum", sample_rate=1 / 5)
    side = {t.team_id: ("home" if t.ground.name == "HOME" else "away") for t in ds.metadata.teams}
    half = (getattr(ds.metadata.pitch_dimensions, "pitch_length", None) or 105.0) / 2
    offset = {1: 0.0, 2: 10_000.0}

    def frames():
        for fr in ds.frames:
            teams: dict[str, list[tuple[float, float]]] = {"home": [], "away": []}
            for p, c in fr.players_data.items():
                if c.coordinates is not None and c.coordinates.x is not None:
                    teams[side[p.team.team_id]].append((c.coordinates.x, c.coordinates.y))
            bc = fr.ball_coordinates
            ball = (bc.x, bc.y) if bc is not None and bc.x is not None else None
            poss = side.get(fr.ball_owning_team.team_id) if fr.ball_owning_team is not None else None
            live = fr.ball_state is not None and fr.ball_state.name == "ALIVE"
            yield ("first_half" if fr.period.id == 1 else "second_half"), offset.get(fr.period.id, 20_000.0) + fr.timestamp.total_seconds(), live, poss, ball, teams

    return spatial_metrics(frames(), half_length=half)
```

Replace `build` so tracking targets and spatial targets each use their named matches:

```python
def build(root: Path, tracking: list[str], spatial: list[str]) -> dict:
    per_match = [event_metrics(idsse_events(root, mid)) for mid in MATCHES]
    tracked = [mid for mid in tracking if (root / filenames(mid)["tracking"]).exists()]
    spatial_ids = [mid for mid in spatial if (root / filenames(mid)["tracking"]).exists()]
    if len(spatial_ids) != len(spatial):
        raise SystemExit(f"missing tracking files for spatial targets: {sorted(set(spatial) - set(spatial_ids))} (download with touchline_analytics.idsse --tracking ...)")
    per_track = [tracking_metrics(idsse_frames(root, mid)) for mid in tracked]
    per_spatial = [idsse_spatial(root, mid) for mid in spatial_ids]
    metrics = {k: _agg([m[k] for m in per_match]) for k in EVENT_KEYS}
    metrics.update({k: _agg([m[k] for m in per_track]) for k in TRACKING_KEYS})
    metrics.update({k: _agg([m[k] for m in per_spatial]) for k in SPATIAL_KEYS})
```

Keep the rest of `build` as it is, except the provenance `scope` string, which becomes:

```python
            "scope": f"events: {len(per_match)} matches; tracking: {len(tracked)} match(es) ({', '.join(tracked)}); spatial: {len(spatial_ids)} matches",
```

Change the `__main__` block to:

```python
    ap.add_argument("--tracking", nargs="*", default=["J03WPY"], help="match ids whose tracking gives the in-play, distance and speed targets")
    ap.add_argument("--spatial", nargs="*", default=list(MATCHES), help="match ids whose tracking gives the spatial targets")
    a = ap.parse_args()
    t = build(Path(a.root), a.tracking, a.spatial)
```

- [ ] **Step 6: Run the tests and check they pass**

Run: `uv run --project python/analytics pytest python/analytics/tests -v`
Expected: all PASS

- [ ] **Step 7: Regenerate the targets and check that only the spatial keys are new**

Run: `uv run --project python/analytics python -m touchline_analytics.targets` (long: it parses eight ~370 MB tracking XML files, J03WPY twice; run it in the background)
Then: `git diff data/params/targets-idsse.json`
Expected:
- The 7 spatial keys are added under `metrics`, each with `"n": 7` and a positive `"sd"`.
- `provenance.fitted_at` and `version` change to today, and `scope` reads `tracking: 1 match(es) (J03WPY); spatial: 7 matches`.
- Every existing metric and both distributions are unchanged. If any existing value changed, stop: the `--tracking` default is not taking effect.
- Sanity-check the magnitudes: width in possession roughly 35–50 m, line height roughly 25–45 m, ball pressure roughly 2–6 m. A value far outside these means a coordinate or sign problem, so stop and investigate.

- [ ] **Step 8: Commit**

```bash
git add python/analytics data/params/targets-idsse.json
git commit -m "feat(analytics): spatial targets from all seven IDSSE tracking matches and report labels

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: TypeScript port of the spatial metrics, with parity

**Files:**
- Modify: `packages/calibrate/src/metrics.ts`
- Create: `packages/calibrate/test/spatial.test.ts`
- Modify: `packages/calibrate/test/parity.test.ts`

**Interfaces:**
- Consumes: Task 2's Python `touchline_metrics` output, which now includes the spatial keys.
- Produces: `SPATIAL_KEYS` (readonly tuple, same order as Python), `type SpatialKey`, `spatialMetrics(frames: ReadonlyArray<Frame>, dt: number, halfLength?: number): Record<SpatialKey, number>`. `MatchMetrics` now extends `Record<SpatialKey, number>`, and `matchMetrics` includes the spatial values.

- [ ] **Step 1: Write the failing test** (`packages/calibrate/test/spatial.test.ts`)

```ts
import { describe, expect, it } from "vitest"
import type { Frame, FramePlayer, Side } from "@touchline/sim-core"
import { spatialMetrics } from "../src/metrics.js"

type Pt = readonly [number, number]
const HOME: Pt[] = [[-45, 0], [-5, -15], [0, 0], [5, 10]]
const AWAY: Pt[] = [[45, 0], [10, -10], [4, 0], [20, 12]]
const player = (side: string, i: number, [x, y]: Pt): FramePlayer => ({ id: `${side}-${i}`, x, y, vel: 0, intent: "shape" })
const frame = (frameId: number, o: { ball?: Pt; live?: boolean; poss?: Side | null } = {}): Frame => ({
  tick: frameId,
  frame_id: frameId,
  period: "first_half",
  timestamp: "",
  home: HOME.map((p, i) => player("h", i, p)),
  away: AWAY.map((p, i) => player("a", i, p)),
  ball: { x: (o.ball ?? [0, 0])[0], y: (o.ball ?? [0, 0])[1], z: 0 },
  ball_in_play: o.live ?? true,
  possession_side: o.poss === undefined ? "home" : o.poss
})

describe("spatial metrics", () => {
  it("measure shape, pressure, support and space once a second (same fixture as the Python test)", () => {
    const m = spatialMetrics([frame(0), frame(5, { ball: [40, 0] }), frame(10, { live: false }), frame(12, { poss: null })], 0.1)
    expect(m.width_poss_m).toBe(25)
    expect(m.width_def_m).toBe(22)
    expect(m.length_def_m).toBe(16)
    expect(m.line_height_def_m).toBe(32.5)
    expect(m.ball_pressure_m).toBe(4)
    expect(m.support_15m).toBe(1)
    expect(m.free_space_m).toBeCloseTo(Math.hypot(15, 5), 12)
  })
  it("are NaN without usable frames", () => {
    const m = spatialMetrics([], 0.1)
    expect(Object.values(m).every(Number.isNaN)).toBe(true)
  })
})
```

- [ ] **Step 2: Run the test and check it fails**

Run: `pnpm --filter @touchline/calibrate exec vitest run test/spatial.test.ts`
Expected: FAIL with `spatialMetrics is not a function` (or a missing-export error)

- [ ] **Step 3: Implement** (in `metrics.ts`)

Change the import to `import type { DomainEvent, Frame, Side } from "@touchline/sim-core"`.

Add after `SCALAR_KEYS`:

```ts
/** Team shape and space (port of spatial_metrics in metrics.py; same order). */
export const SPATIAL_KEYS = ["width_poss_m", "width_def_m", "length_def_m", "line_height_def_m", "ball_pressure_m", "support_15m", "free_space_m"] as const
export type SpatialKey = (typeof SPATIAL_KEYS)[number]
export const SPATIAL_SAMPLE_S = 1
export const SUPPORT_RADIUS_M = 15
```

Change `export interface MatchMetrics {` to `export interface MatchMetrics extends Record<SpatialKey, number> {`.

Add before `matchMetrics`:

```ts
type Pt = readonly [number, number]

/**
 * Team shape and space, once a second, on live frames with a team in possession. Each team's attack
 * direction per period comes from its mean x in that period's first frame.
 */
export const spatialMetrics = (frames: ReadonlyArray<Frame>, dt: number, halfLength = 52.5): Record<SpatialKey, number> => {
  const offset: Record<string, number> = { first_half: 0, second_half: 10_000 }
  const dirs = new Map<string, Record<Side, number>>()
  const lastSec = new Map<string, number>()
  const wPoss: number[] = [], wDef: number[] = [], length: number[] = [], line: number[] = [], press: number[] = [], support: number[] = [], space: number[] = []
  const meanX = (pts: ReadonlyArray<Pt>) => pts.reduce((s, p) => s + p[0], 0) / pts.length
  const spreadY = (pts: ReadonlyArray<Pt>) => Math.max(...pts.map((p) => p[1])) - Math.min(...pts.map((p) => p[1]))
  const d = (p: Pt, q: Pt) => Math.hypot(p[0] - q[0], p[1] - q[1])
  for (const f of frames) {
    const teams: Record<Side, Pt[]> = { home: f.home.map((p) => [p.x, p.y] as const), away: f.away.map((p) => [p.x, p.y] as const) }
    if (!dirs.has(f.period) && teams.home.length && teams.away.length)
      dirs.set(f.period, { home: meanX(teams.home) < 0 ? 1 : -1, away: meanX(teams.away) < 0 ? 1 : -1 })
    const poss = f.possession_side
    const dir = dirs.get(f.period)
    if (!f.ball_in_play || poss === null || !dir) continue
    const sec = Math.floor((offset[f.period]! + f.frame_id * dt) / SPATIAL_SAMPLE_S + 1e-6)
    if (lastSec.get(f.period) === sec) continue
    lastSec.set(f.period, sec)
    const defSide: Side = poss === "home" ? "away" : "home"
    const att = teams[poss], def = teams[defSide]
    if (att.length < 3 || def.length < 3) continue
    wPoss.push(spreadY(att))
    wDef.push(spreadY(def))
    const u = def.map((p) => dir[defSide] * p[0]).sort((a, b) => a - b)
    length.push(u[u.length - 1]! - u[1]!)
    line.push(u[1]! + halfLength)
    const ball: Pt = [f.ball.x, f.ball.y]
    press.push(Math.min(...def.map((p) => d(p, ball))))
    support.push(Math.max(0, att.filter((p) => d(p, ball) <= SUPPORT_RADIUS_M).length - 1))
    let carrier = 0
    for (let i = 1; i < att.length; i++) if (d(att[i]!, ball) < d(att[carrier]!, ball)) carrier = i
    space.push(median(att.filter((_, i) => i !== carrier).map((p) => Math.min(...def.map((q) => d(p, q))))))
  }
  return {
    width_poss_m: median(wPoss),
    width_def_m: median(wDef),
    length_def_m: median(length),
    line_height_def_m: median(line),
    ball_pressure_m: median(press),
    support_15m: support.length ? support.reduce((a, b) => a + b, 0) / support.length : NaN,
    free_space_m: median(space)
  }
}
```

Change `matchMetrics` to:

```ts
export const matchMetrics = (events: ReadonlyArray<DomainEvent>, frames: ReadonlyArray<Frame>, dt: number): MatchMetrics => ({
  ...eventMetrics(events),
  ...trackingMetrics(frames, dt),
  ...spatialMetrics(frames, dt)
})
```

- [ ] **Step 4: Extend the parity test** (`packages/calibrate/test/parity.test.ts`)

Change the import to `import { matchMetrics, SCALAR_KEYS, SPATIAL_KEYS } from "../src/metrics.js"`. After the `SCALAR_KEYS` loop add:

```ts
    for (const k of SPATIAL_KEYS) expect(ts[k], k).toBeCloseTo(py[k] as number, 9)
```

- [ ] **Step 5: Run the tests and check they pass**

Run: `pnpm --filter @touchline/calibrate exec vitest run test/spatial.test.ts test/parity.test.ts`
Expected: PASS. Parity needs `uv`; if it reports skipped, install uv. Don't accept a skip.

Run: `pnpm --filter @touchline/calibrate typecheck`
Expected: no errors

- [ ] **Step 6: Commit**

```bash
git add packages/calibrate/src/metrics.ts packages/calibrate/test/spatial.test.ts packages/calibrate/test/parity.test.ts
git commit -m "feat(calibrate): TypeScript port of the spatial metrics with parity

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Spatial metrics in the realism gate's drift check, and a "before" report

**Files:**
- Modify: `packages/calibrate/src/gate.ts`
- Modify: `packages/calibrate/test/gate.test.ts`
- Modify: `packages/calibrate/test/realism-gate.test.ts`
- Regenerate: `data/params/realism-baseline.json`, `docs/realism/realism-report.md`

**Interfaces:**
- Consumes: `SPATIAL_KEYS`, `MatchMetrics` (Task 3).
- Produces: `GATE_KEYS` (`[...SCALAR_KEYS, ...SPATIAL_KEYS]`), `type GateKey`. `summarize` and `driftZ` cover `GATE_KEYS`, and `Baseline.mean`/`sd` are `Record<GateKey, number>`.

- [ ] **Step 1: Update the gate unit test to use `GATE_KEYS`** (`packages/calibrate/test/gate.test.ts`)

Replace the imports and every `SCALAR_KEYS` with `GATE_KEYS`:

```ts
import { DRIFT_Z, driftZ, GATE_KEYS, summarize, type Baseline } from "../src/gate.js"
import type { MatchMetrics } from "../src/metrics.js"
```

Add a test inside `describe("drift check", ...)`:

```ts
  it("covers the spatial statistics", () => {
    const b = base(4, 1.6)
    expect(Math.abs(driftZ({ ...b.mean, width_poss_m: 8 }, b, 16).width_poss_m)).toBeGreaterThan(DRIFT_Z)
  })
```

- [ ] **Step 2: Run it and check it fails**

Run: `pnpm --filter @touchline/calibrate exec vitest run test/gate.test.ts`
Expected: FAIL with `GATE_KEYS` not exported

- [ ] **Step 3: Implement** (`gate.ts`)

```ts
import { SCALAR_KEYS, SPATIAL_KEYS, type MatchMetrics } from "./metrics.js"

/** Every statistic the gate tracks: match statistics, then team shape and space. */
export const GATE_KEYS = [...SCALAR_KEYS, ...SPATIAL_KEYS] as const
export type GateKey = (typeof GATE_KEYS)[number]
type Stats = Record<GateKey, number>
```

Replace `SCALAR_KEYS` with `GATE_KEYS` in `summarize` and `driftZ`, and remove the `ScalarKey` import.

- [ ] **Step 4: Check drift on every gate statistic** (`realism-gate.test.ts`)

Import `GATE_KEYS` from `../src/gate.js`. Change the drift line to:

```ts
    for (const k of GATE_KEYS) expect(Math.abs(drift[k]), `${k} drifted from the baseline`).toBeLessThan(DRIFT_Z)
```

Leave the comparison against real targets on `SCALAR_KEYS` for now. Task 8 enforces the spatial targets once the behaviours exist.

- [ ] **Step 5: Refresh the baseline and check the existing values are unchanged**

Run: `UPDATE_REALISM_BASELINE=1 pnpm --filter @touchline/calibrate exec vitest run test/realism-gate.test.ts`
Then: `git diff data/params/realism-baseline.json`
Expected: insertions only (the 7 spatial keys under `mean` and `sd`). Every existing number is byte-identical, because the engine has not changed.

- [ ] **Step 6: Run the calibrate tests**

Run: `pnpm --filter @touchline/calibrate test && pnpm --filter @touchline/calibrate typecheck`
Expected: PASS

- [ ] **Step 7: Write the "before" realism report**

Run: `pnpm realism --out docs/realism/realism-report.md --matches 16`
Expected: the report's table now lists the 7 spatial rows. Note which ones are "off" in the commit message; they are the targets for Tasks 5–8.

- [ ] **Step 8: Commit**

```bash
git add packages/calibrate data/params/realism-baseline.json docs/realism/realism-report.md
git commit -m "feat(calibrate): spatial statistics in the realism gate and report (baseline before behaviour changes)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Support play for the team in possession (default off)

**Files:**
- Create: `packages/sim-core/src/offball.ts`
- Modify: `packages/sim-core/src/params.ts` (`Params` interface, `DEFAULT_PARAMS`, `PROBABILITIES`)
- Modify: `packages/sim-core/src/step.ts` (`moveTarget`, `moveAll`, imports)
- Modify: `packages/sim-core/src/index.ts`
- Create: `packages/sim-core/test/offball.test.ts`

**Interfaces:**
- Produces: `supportSpot(carrier: Vec2, anchor: Vec2, side: Side, opponents: ReadonlyArray<PlayerState>, distM: number): Vec2`, and `Params.support: { count: number; distM: number; speedShare: number }` with defaults `{ count: 0, distM: 12, speedShare: 0.8 }`. It also changes `moveTarget(w, pl, ballFlat, possSide, marks)` (an internal signature; `marks` is used by Task 6 and is passed as `null` here).

Behaviour: when a team has the ball, its `support.count` outfield players nearest the carrier (not the keeper, not anyone running in behind) move towards a support spot `distM` from the carrier, at `speedShare` of top speed. The spot is a softmax-weighted average of 8 directions around the carrier. Each direction scores:

space to the nearest opponent (capped at 10 m) − 4 × defenders in the passing lane − 0.15 × distance from the player's shape anchor + 0.1 × forward gain

The weighted average makes the spot move smoothly rather than jump between directions.

- [ ] **Step 1: Write the failing tests** (`packages/sim-core/test/offball.test.ts`)

```ts
import { describe, expect, it } from "vitest"
import { DEFAULT_PARAMS, dist, initMatch, isFinished, PITCH, step, supportSpot, type DomainEvent, type Frame, type MatchConfig, type Params, type PlayerState } from "../src/index.js"
import { kickoffPlayersFor, makeConfig } from "../src/testing.js"

const play = (cfg: MatchConfig) => {
  let s = initMatch(cfg)
  const frames: Frame[] = [], events: DomainEvent[] = []
  while (!isFinished(s)) { const r = step(s); s = r.state; if (r.frame) frames.push(r.frame); events.push(...r.events) }
  return { frames, events }
}
const opp = (x: number, y: number): PlayerState => ({ ...kickoffPlayersFor(makeConfig(1))[11]!, id: `o-${x}-${y}`, pos: { x, y } })
const withParams = (over: (p: Params) => Params) => makeConfig(5, { params: over(DEFAULT_PARAMS) })

describe("support play", () => {
  it("offers the open side, away from a cluster of opponents", () => {
    const s = supportSpot({ x: 0, y: 0 }, { x: 0, y: 0 }, "home", [opp(8, 8), opp(9, 6), opp(6, 9)], 12)
    expect(s.y).toBeLessThan(0)
    expect(dist(s, { x: 0, y: 0 })).toBeGreaterThan(3)
    expect(dist(s, { x: 0, y: 0 })).toBeLessThanOrEqual(12.0001)
  })
  it("moves smoothly when the carrier moves a little", () => {
    const opps = [opp(8, 8), opp(9, 6), opp(-6, -9)]
    const a = supportSpot({ x: 0, y: 0 }, { x: -5, y: 0 }, "home", opps, 12)
    const b = supportSpot({ x: 0.1, y: 0 }, { x: -5, y: 0 }, "home", opps, 12)
    expect(dist(a, b)).toBeLessThan(1)
  })
  it("stays on the pitch near a corner flag", () => {
    const s = supportSpot({ x: PITCH.halfL - 1, y: PITCH.halfW - 1 }, { x: 40, y: 25 }, "home", [], 12)
    expect(Math.abs(s.x)).toBeLessThanOrEqual(PITCH.halfL - 1)
    expect(Math.abs(s.y)).toBeLessThanOrEqual(PITCH.halfW - 1)
  })
  it("brings teammates closer to the ball when switched on", () => {
    const near = (frames: Frame[]) => {
      let n = 0, c = 0
      for (const f of frames) {
        if (!f.ball_in_play || !f.possession_side) continue
        n += f[f.possession_side].filter((p) => Math.hypot(p.x - f.ball.x, p.y - f.ball.y) <= 15).length
        c++
      }
      return n / c
    }
    const off = near(play(withParams((p) => p)).frames)
    const on = near(play(withParams((p) => ({ ...p, support: { ...p.support, count: 2 } }))).frames)
    expect(on).toBeGreaterThan(off + 0.1)
  })
})
```

- [ ] **Step 2: Run the tests and check they fail**

Run: `pnpm --filter @touchline/sim-core exec vitest run test/offball.test.ts`
Expected: FAIL with `supportSpot` not exported

- [ ] **Step 3: Add the parameters** (`params.ts`)

In the `Params` interface, after `readonly runs: ...`:

```ts
  /** Support play: the `count` outfielders nearest the carrier offer an angle `distM` away, at `speedShare` of top speed (count 0 = off). */
  readonly support: { readonly count: number; readonly distM: number; readonly speedShare: number }
```

In `DEFAULT_PARAMS`, after `runs: { runInBehindRatePerS: 0.12 },`:

```ts
  support: { count: 0, distM: 12, speedShare: 0.8 },
```

Add `"support.speedShare"` to the `PROBABILITIES` set.

- [ ] **Step 4: Create `offball.ts`**

```ts
import { defendersInLane } from "./decide.js"
import { clampToPitch, dirOf, dist, type Side, type Vec2 } from "./geometry.js"
import type { PlayerState } from "./types.js"

/** Directions a supporter can offer around the carrier: every 45 degrees. */
const ANGLES = Array.from({ length: 8 }, (_, i) => (i * Math.PI) / 4)
const SPACE_CAP_M = 10
const LANE_PENALTY = 4
const ANCHOR_PULL = 0.15
const FORWARD_BONUS = 0.1
const SOFTMAX_T = 0.5

/**
 * Where a supporter offers an angle: a softmax-weighted average of 8 spots `distM` around the carrier, each scored
 * by space from opponents, an open passing lane, closeness to the player's shape anchor and forward gain. The
 * average (rather than the best spot) moves smoothly as players move, so supporters do not flicker between angles.
 */
export const supportSpot = (carrier: Vec2, anchor: Vec2, side: Side, opponents: ReadonlyArray<PlayerState>, distM: number): Vec2 => {
  const d = dirOf(side)
  const spots = ANGLES.map((a) => clampToPitch({ x: carrier.x + Math.cos(a) * distM, y: carrier.y + Math.sin(a) * distM }, 1))
  const scores = spots.map((s) => {
    let space = SPACE_CAP_M
    for (const o of opponents) if (!o.sentOff) space = Math.min(space, dist(s, o.pos))
    return space - LANE_PENALTY * defendersInLane(carrier, s, opponents) - ANCHOR_PULL * dist(s, anchor) + FORWARD_BONUS * d * (s.x - carrier.x)
  })
  const m = Math.max(...scores)
  const w = scores.map((v) => Math.exp((v - m) / SOFTMAX_T))
  const z = w.reduce((a, b) => a + b, 0)
  return spots.reduce((acc, s, i) => ({ x: acc.x + (s.x * w[i]!) / z, y: acc.y + (s.y * w[i]!) / z }), { x: 0, y: 0 })
}
```

Add `export * from "./offball.js"` to `index.ts`.

- [ ] **Step 5: Wire it into movement** (`step.ts`)

Add the import: `import { supportSpot } from "./offball.js"`.

Change the `moveTarget` signature to:

```ts
const moveTarget = (
  w: Work,
  pl: PlayerState,
  ballFlat: Vec2,
  possSide: Side | null,
  marks: ReadonlyMap<string, Vec2> | null
): { target: Vec2; speedCap: number; timeLeft?: number } => {
```

At the end of `moveTarget`, replace the final `return shape()` with:

```ts
  if (pos.kind === "owned" && possSide === pl.side && w.p.support.count > 0) {
    const owner = w.player(pos.playerId)
    const supporters = w
      .active(pl.side)
      .filter((x) => x.id !== owner.id && x.role !== "GK" && !(x.intent.kind === "run_in_behind" && w.tick < x.intentUntil))
      .sort((a, b) => dist(a.pos, owner.pos) - dist(b.pos, owner.pos))
      .slice(0, w.p.support.count)
    if (supporters.some((x) => x.id === pl.id))
      return { target: supportSpot(owner.pos, shape().target, pl.side, w.active(other(pl.side)), w.p.support.distM), speedCap: vmax * w.p.support.speedShare }
  }
  return shape()
```

In `moveAll`, change the call to `moveTarget(w, pl, ballFlat, possSide, null)`. Task 6 replaces `null`.

- [ ] **Step 6: Run the sim-core tests**

Run: `pnpm --filter @touchline/sim-core test && pnpm --filter @touchline/sim-core typecheck`
Expected: PASS, including the 4 new tests

- [ ] **Step 7: Check the default-off engine is unchanged**

Run: `pnpm --filter @touchline/calibrate exec vitest run test/realism-gate.test.ts`
Expected: PASS with `maxDrift: 0` in the console line

- [ ] **Step 8: Commit**

```bash
git add packages/sim-core
git commit -m "feat(sim-core): support play for the team in possession (off by default)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Marking for the defending team (default off)

**Files:**
- Modify: `packages/sim-core/src/offball.ts`
- Modify: `packages/sim-core/src/params.ts`
- Modify: `packages/sim-core/src/step.ts` (`marksFor`, `moveTarget`, `moveAll`)
- Test: `packages/sim-core/test/offball.test.ts`

**Interfaces:**
- Consumes: the `moveTarget(..., marks)` parameter (Task 5).
- Produces: `assignMarks(defenders: ReadonlyArray<{ readonly id: string; readonly anchor: Vec2 }>, attackers: ReadonlyArray<PlayerState>, radiusM: number): Map<string, PlayerState>`, `markTarget(anchor: Vec2, attacker: Vec2, defSide: Side, goalSideM: number, weight: number): Vec2`, and `Params.marking: { weight: number; radiusM: number; goalSideM: number }` with defaults `{ weight: 0, radiusM: 10, goalSideM: 1.5 }`.

Behaviour: when the other team has the ball (or the ball is in flight from them), every outfield defender who is not pressing is paired greedily with the nearest unmarked attacker within `radiusM` of the defender's shape anchor. The carrier and the keeper are excluded; the presser handles the carrier. The marker moves to a point `weight` of the way from the anchor to a spot `goalSideM` goal-side of the attacker. Weight 0 means pure shape and 1 means tight man-marking.

- [ ] **Step 1: Write the failing tests** (append to `offball.test.ts`; add `assignMarks, markTarget` to the import from `../src/index.js`)

```ts
describe("marking", () => {
  it("pairs the closest defender and attacker first, one to one, within the radius", () => {
    const marks = assignMarks(
      [{ id: "d1", anchor: { x: 0, y: 0 } }, { id: "d2", anchor: { x: 3, y: 0 } }],
      [opp(1, 0), opp(9, 0), opp(30, 0)],
      10
    )
    expect(marks.get("d1")?.id).toBe("o-1-0")
    expect(marks.get("d2")?.id).toBe("o-9-0")
    expect([...marks.values()].some((a) => a.id === "o-30-0")).toBe(false)
  })
  it("stands goal-side of the attacker, blended from the shape anchor by weight", () => {
    const anchor = { x: -20, y: 0 }
    expect(markTarget(anchor, { x: -10, y: 0 }, "home", 1.5, 1)).toEqual({ x: -11.5, y: 0 })
    expect(markTarget(anchor, { x: -10, y: 0 }, "home", 1.5, 0.5)).toEqual({ x: -15.75, y: 0 })
    expect(markTarget(anchor, { x: -10, y: 0 }, "home", 1.5, 0)).toEqual(anchor)
  })
  it("leaves attackers less free space when switched on", () => {
    const freeSpace = (frames: Frame[]) => {
      const per: number[] = []
      for (const f of frames) {
        if (!f.ball_in_play || !f.possession_side) continue
        const att = f[f.possession_side].filter((p) => p.intent !== "on_ball")
        const def = f[f.possession_side === "home" ? "away" : "home"]
        for (const a of att) per.push(Math.min(...def.map((d) => Math.hypot(a.x - d.x, a.y - d.y))))
      }
      return per.reduce((s, v) => s + v, 0) / per.length
    }
    const off = freeSpace(play(withParams((p) => p)).frames)
    const on = freeSpace(play(withParams((p) => ({ ...p, marking: { ...p.marking, weight: 0.6 } }))).frames)
    expect(on).toBeLessThan(off - 0.3)
  })
})
```

- [ ] **Step 2: Run the tests and check they fail**

Run: `pnpm --filter @touchline/sim-core exec vitest run test/offball.test.ts`
Expected: FAIL with `assignMarks` not exported

- [ ] **Step 3: Add the parameters** (`params.ts`)

After the `support` field in the `Params` interface:

```ts
  /** Marking: defenders pair with the nearest attacker within radiusM of their anchor and move `weight` of the way to goalSideM goal-side of them (weight 0 = off). */
  readonly marking: { readonly weight: number; readonly radiusM: number; readonly goalSideM: number }
```

In `DEFAULT_PARAMS`, after `support`:

```ts
  marking: { weight: 0, radiusM: 10, goalSideM: 1.5 },
```

Add `"marking.weight"` to `PROBABILITIES`.

- [ ] **Step 4: Implement** (`offball.ts`)

Replace the geometry import with:

```ts
import { add, clampToPitch, dirOf, dist, norm, PITCH, scale, sub, type Side, type Vec2 } from "./geometry.js"
```

Append:

```ts
/** Greedy one-to-one marking: the closest (defender anchor, attacker) pairs within radiusM are taken first; ties by id. */
export const assignMarks = (
  defenders: ReadonlyArray<{ readonly id: string; readonly anchor: Vec2 }>,
  attackers: ReadonlyArray<PlayerState>,
  radiusM: number
): Map<string, PlayerState> => {
  const pairs: Array<{ d: string; a: PlayerState; r: number }> = []
  for (const d of defenders)
    for (const a of attackers) {
      const r = dist(d.anchor, a.pos)
      if (r <= radiusM) pairs.push({ d: d.id, a, r })
    }
  const cmp = (x: string, y: string) => (x < y ? -1 : x > y ? 1 : 0)
  pairs.sort((x, y) => x.r - y.r || cmp(x.d, y.d) || cmp(x.a.id, y.a.id))
  const out = new Map<string, PlayerState>()
  const taken = new Set<string>()
  for (const p of pairs)
    if (!out.has(p.d) && !taken.has(p.a.id)) {
      out.set(p.d, p.a)
      taken.add(p.a.id)
    }
  return out
}

/** Where a marker stands: `weight` of the way from the shape anchor to a spot goalSideM goal-side of the attacker. */
export const markTarget = (anchor: Vec2, attacker: Vec2, defSide: Side, goalSideM: number, weight: number): Vec2 => {
  const ownGoal = { x: -dirOf(defSide) * PITCH.halfL, y: 0 }
  const spot = add(attacker, scale(norm(sub(ownGoal, attacker)), goalSideM))
  return add(anchor, scale(sub(spot, anchor), weight))
}
```

- [ ] **Step 5: Wire it in** (`step.ts`)

Extend the import: `import { assignMarks, markTarget, supportSpot } from "./offball.js"`.

Add before `moveAll`:

```ts
/** This tick's marking targets for `defSide`: outfield defenders who are not pressing, paired with attackers other than the carrier. */
const marksFor = (w: Work, defSide: Side, ballFlat: Vec2): Map<string, Vec2> => {
  const team = teamOf(w.cfg, defSide)
  const ownerId = w.possession.kind === "owned" ? w.possession.playerId : null
  const defenders = w
    .active(defSide)
    .filter((x) => x.role !== "GK" && !(x.intent.kind === "press" && w.tick < x.intentUntil))
    .map((x) => ({ id: x.id, anchor: anchorFor(team.formation, x.slot, defSide, ballFlat, team.style, false, w.p.shape) }))
  const anchors = new Map(defenders.map((d) => [d.id, d.anchor]))
  const attackers = w.active(other(defSide)).filter((x) => x.role !== "GK" && x.id !== ownerId)
  const out = new Map<string, Vec2>()
  for (const [id, a] of assignMarks(defenders, attackers, w.p.marking.radiusM))
    out.set(id, markTarget(anchors.get(id)!, a.pos, defSide, w.p.marking.goalSideM, w.p.marking.weight))
  return out
}
```

In `moveAll`, after `possSide` is computed:

```ts
  const marks = possSide !== null && w.p.marking.weight > 0 ? marksFor(w, other(possSide), ballFlat) : null
```

Then change the call to `moveTarget(w, pl, ballFlat, possSide, marks)`.

In `moveTarget`, just before the `if (pos.kind === "owned" && possSide === pl.side && (pl.role === "ST" || ...` run-in-behind block, insert:

```ts
  const mark = possSide !== null && possSide !== pl.side ? marks?.get(pl.id) : undefined
  if (mark) return { target: mark, speedCap: vmax * w.p.movement.shapeSpeedShare }
```

- [ ] **Step 6: Run the sim-core tests**

Run: `pnpm --filter @touchline/sim-core test && pnpm --filter @touchline/sim-core typecheck`
Expected: PASS

- [ ] **Step 7: Check the default-off engine is unchanged**

Run: `pnpm --filter @touchline/calibrate exec vitest run test/realism-gate.test.ts`
Expected: PASS with `maxDrift: 0`

- [ ] **Step 8: Commit**

```bash
git add packages/sim-core
git commit -m "feat(sim-core): goal-side marking for the defending team (off by default)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Carrier shields under pressure and steers carries around defenders (default off)

**Files:**
- Modify: `packages/sim-core/src/offball.ts`
- Modify: `packages/sim-core/src/params.ts` (`carry`)
- Modify: `packages/sim-core/src/step.ts` (the owner branch of `moveTarget`)
- Test: `packages/sim-core/test/offball.test.ts`

**Interfaces:**
- Produces: `steerCarry(dir: Vec2, pos: Vec2, opponents: ReadonlyArray<PlayerState>, avoidM: number): Vec2` (a unit vector) and `shieldTarget(pos: Vec2, opponents: ReadonlyArray<PlayerState>, shieldM: number): Vec2 | null`. `Params.carry` gains `avoidM` (default 0), `shieldM` (default 0) and `shieldSpeed` (default 1.5).

Behaviour:
- **Steering:** during a carry, opponents ahead of the carrier (positive dot product with the heading) within `avoidM` push the heading sideways, away from them, scaled by `(avoidM − d) / avoidM`. The heading is recomputed each tick from the carry's original direction, so the carrier returns to it once past the defender.
- **Shielding:** a carrier who is holding the ball (not a keeper) with an opponent within `shieldM` moves 2 m directly away from that opponent at `shieldSpeed`, instead of standing still.

- [ ] **Step 1: Write the failing tests** (append to `offball.test.ts`; add `shieldTarget, steerCarry` to the import)

```ts
describe("on the ball", () => {
  it("bends a carry away from an opponent ahead, and ignores opponents behind", () => {
    const d = steerCarry({ x: 1, y: 0 }, { x: 0, y: 0 }, [opp(3, 1)], 6)
    expect(d.y).toBeLessThan(0)
    expect(Math.hypot(d.x, d.y)).toBeCloseTo(1, 9)
    expect(steerCarry({ x: 1, y: 0 }, { x: 0, y: 0 }, [opp(-3, 0)], 6)).toEqual({ x: 1, y: 0 })
    expect(steerCarry({ x: 1, y: 0 }, { x: 0, y: 0 }, [opp(3, 1)], 0)).toEqual({ x: 1, y: 0 })
  })
  it("shields away from a close opponent, never off the pitch, and not when switched off", () => {
    expect(shieldTarget({ x: 0, y: 0 }, [opp(1, 0)], 3)).toEqual({ x: -2, y: 0 })
    expect(shieldTarget({ x: 0, y: 0 }, [opp(5, 0)], 3)).toBeNull()
    expect(shieldTarget({ x: 0, y: 0 }, [opp(1, 0)], 0)).toBeNull()
    const edge = shieldTarget({ x: 0, y: PITCH.halfW - 0.5 }, [opp(0, PITCH.halfW - 1.5)], 3)!
    expect(edge.y).toBeLessThanOrEqual(PITCH.halfW - 1)
  })
  it("keeps a pressed carrier moving when switched on", () => {
    const moving = (frames: Frame[]) => {
      let n = 0
      for (const f of frames) {
        const all = [...f.home, ...f.away]
        const c = all.find((p) => p.intent === "on_ball")
        if (!c) continue
        const opps = (f.home.includes(c) ? f.away : f.home)
        if (Math.min(...opps.map((o) => Math.hypot(o.x - c.x, o.y - c.y))) <= 3 && c.vel > 0.5) n++
      }
      return n
    }
    const off = moving(play(withParams((p) => p)).frames)
    const on = moving(play(withParams((p) => ({ ...p, carry: { ...p.carry, shieldM: 3, avoidM: 6 } }))).frames)
    expect(on).toBeGreaterThan(off)
  })
})
```

- [ ] **Step 2: Run the tests and check they fail**

Run: `pnpm --filter @touchline/sim-core exec vitest run test/offball.test.ts`
Expected: FAIL with `steerCarry` not exported

- [ ] **Step 3: Add the parameters** (`params.ts`)

Replace the `carry` line in the `Params` interface with:

```ts
  /**
   * Carries: speed and duration; opponents ahead within avoidM bend the heading away (0 = off); a holding carrier with an
   * opponent within shieldM moves away from them at shieldSpeed instead of standing still (0 = off).
   */
  readonly carry: { readonly speed: number; readonly durationS: readonly [number, number]; readonly avoidM: number; readonly shieldM: number; readonly shieldSpeed: number }
```

In `DEFAULT_PARAMS`:

```ts
  carry: { speed: 5.5, durationS: [0.8, 2.0], avoidM: 0, shieldM: 0, shieldSpeed: 1.5 },
```

- [ ] **Step 4: Implement** (append to `offball.ts`; add `len` to the geometry import)

```ts
/** A carry heading bent sideways, away from opponents ahead within avoidM (closer pushes harder); unit length. */
export const steerCarry = (dir: Vec2, pos: Vec2, opponents: ReadonlyArray<PlayerState>, avoidM: number): Vec2 => {
  if (avoidM <= 0) return dir
  let push: Vec2 = { x: 0, y: 0 }
  for (const o of opponents) {
    if (o.sentOff) continue
    const rel = sub(o.pos, pos)
    const d = len(rel)
    if (d < 1e-6 || d > avoidM || rel.x * dir.x + rel.y * dir.y <= 0) continue
    // Sidestep perpendicular to the heading, to the side away from the opponent.
    const away = dir.x * rel.y - dir.y * rel.x > 0 ? -1 : 1
    push = add(push, scale({ x: -dir.y * away, y: dir.x * away }, (avoidM - d) / avoidM))
  }
  return push.x === 0 && push.y === 0 ? dir : norm(add(dir, push))
}

/** Where a holding carrier goes when the nearest opponent is within shieldM: 2 m straight away from them, on the pitch. */
export const shieldTarget = (pos: Vec2, opponents: ReadonlyArray<PlayerState>, shieldM: number): Vec2 | null => {
  if (shieldM <= 0) return null
  let near: PlayerState | null = null
  let nd = Infinity
  for (const o of opponents) {
    if (o.sentOff) continue
    const d = dist(pos, o.pos)
    if (d < nd) {
      nd = d
      near = o
    }
  }
  if (!near || nd > shieldM) return null
  return clampToPitch(add(pos, scale(norm(sub(pos, near.pos)), 2)), 1)
}
```

- [ ] **Step 5: Wire it in** (`step.ts`)

Extend the import: `import { assignMarks, markTarget, shieldTarget, steerCarry, supportSpot } from "./offball.js"`.

Replace the owner branch in `moveTarget`:

```ts
  if (pos.kind === "owned" && pos.playerId === pl.id) {
    const opps = w.active(other(pl.side))
    if (pl.intent.kind === "carry" && w.tick < pl.intentUntil) {
      const dir = steerCarry(pl.intent.dir, pl.pos, opps, w.p.carry.avoidM)
      return { target: clampToPitch(add(pl.pos, scale(dir, 5)), 1), speedCap: pl.intent.speed }
    }
    const shield = pl.role === "GK" ? null : shieldTarget(pl.pos, opps, w.p.carry.shieldM)
    if (shield) return { target: shield, speedCap: w.p.carry.shieldSpeed }
    return { target: pl.pos, speedCap: 1 }
  }
```

- [ ] **Step 6: Run the sim-core tests**

Run: `pnpm --filter @touchline/sim-core test && pnpm --filter @touchline/sim-core typecheck`
Expected: PASS

- [ ] **Step 7: Check the default-off engine is unchanged**

Run: `pnpm --filter @touchline/calibrate exec vitest run test/realism-gate.test.ts`
Expected: PASS with `maxDrift: 0`. `steerCarry` returns `dir` itself when off, so carries are bit-identical.

- [ ] **Step 8: Commit**

```bash
git add packages/sim-core
git commit -m "feat(sim-core): carriers shield under pressure and steer carries around defenders (off by default)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: Switch the behaviours on, recalibrate, enforce the spatial targets, and review in the replay

**Files:**
- Modify: `packages/sim-core/src/params.ts` (`DEFAULT_PARAMS` values; `shape.defLineM`, `shape.defDepth`)
- Modify: `packages/sim-core/src/shape.ts` (`anchorFor` out-of-possession offsets)
- Test: `packages/sim-core/test/shape.test.ts`
- Modify: `packages/calibrate/src/knobs.ts`, `packages/calibrate/src/evaluate.ts`, `packages/calibrate/src/tune.ts`, `packages/calibrate/src/cli.ts`
- Modify: `packages/calibrate/test/realism-gate.test.ts`
- Regenerate: `data/params/touchline-params.json`, `data/params/realism-baseline.json`, `docs/realism/realism-report.md`
- Modify: `docs/superpowers/specs/2026-10-07-sim-realism-contract.md` (add a Results section)

**Interfaces:**
- Consumes: everything above.
- Produces: `Params.shape: { width; depth; defLineM; defDepth }` (defaults 0 and 1) and an `anchorFor` spread argument with optional `defLineM`/`defDepth`; `WEIGHTS: Record<GateKey, number>`. `loss` and `meanMetrics` cover `GATE_KEYS`, `tune` returns `Record<GateKey, number>` detail, and there are new knobs `marking_weight` and `support_dist`.

> **Controller ruling (2026-10-07, from the Task 4 "before" report):** the defensive line sits at 18.3 m from goal against 35.1 m in real matches (z −9.6), and the defending team is 45.3 m long against 32.2 m (z +8.2). The formation anchors cause this, not any Task 5–7 behaviour, and no knob moves it. Step 0 adds two shape parameters for the team without the ball so the tuner can reach C4. Their defaults keep the engine bit-identical.

- [ ] **Step 0a: Write the failing test** (append inside `describe("team shape", ...)` in `packages/sim-core/test/shape.test.ts`)

```ts
  it("moves a team's shape without the ball by defLineM and defDepth, and leaves it alone with the ball", () => {
    const style = STYLES.possession
    const ball = { x: 0, y: 0 }
    const spread = (defLineM: number, defDepth: number) => ({ width: 1, depth: 1, defLineM, defDepth })
    // Centre back (slot 2): 10 m further upfield without the ball, mirrored for the away side.
    expect(anchorFor("4-3-3", 2, "home", ball, style, false, spread(10, 1)).x - anchorFor("4-3-3", 2, "home", ball, style, false).x).toBeCloseTo(10, 9)
    expect(anchorFor("4-3-3", 2, "away", ball, style, false, spread(10, 1)).x - anchorFor("4-3-3", 2, "away", ball, style, false).x).toBeCloseTo(-10, 9)
    // Striker (slot 9, x = 6): distance from the team centre (x = -18) halves without the ball: 24 m -> 12 m.
    expect(anchorFor("4-3-3", 9, "home", ball, style, false, spread(0, 0.5)).x - anchorFor("4-3-3", 9, "home", ball, style, false).x).toBeCloseTo(-12, 9)
    // With the ball nothing changes.
    expect(anchorFor("4-3-3", 2, "home", ball, style, true, spread(10, 0.5))).toEqual(anchorFor("4-3-3", 2, "home", ball, style, true))
  })
```

Run: `pnpm --filter @touchline/sim-core exec vitest run test/shape.test.ts`
Expected: FAIL (the offsets are ignored, so the differences are 0)

- [ ] **Step 0b: Implement** (`shape.ts` `anchorFor`)

Change the `spread` parameter type and default:

```ts
  spread: { readonly width: number; readonly depth: number; readonly defLineM?: number; readonly defDepth?: number } = { width: 1, depth: 1 }
```

Replace the `sx` and `x` lines with:

```ts
  // Without the ball, defDepth squeezes the lines further and defLineM pushes the whole shape upfield (both identity by default).
  const depth = spread.depth * (inPossession ? 1 : (spread.defDepth ?? 1))
  const sx = -18 + (s.x + 18) * depth
  const x = clamp(sx + slide * bx + line + (inPossession ? 0 : (spread.defLineM ?? 0)), -PITCH.halfL + 4, PITCH.halfL - 3)
```

In `params.ts`, change the `shape` field in the `Params` interface to:

```ts
  /** Team shape spread: width (fully in possession, partly without), depth between lines, and without the ball a line push upfield (m) and extra depth squeeze. */
  readonly shape: { readonly width: number; readonly depth: number; readonly defLineM: number; readonly defDepth: number }
```

and the default to `shape: { width: 1, depth: 1, defLineM: 0, defDepth: 1 },`.

Add to `KNOBS` in `packages/calibrate/src/knobs.ts`:

```ts
  { name: "def_line", what: "metres a team without the ball pushes its shape upfield (defensive line height)", init: 0, min: 0, max: 20, step: 2.5,
    apply: (p, v) => ({ ...p, shape: { ...p.shape, defLineM: v } }) },
  { name: "def_depth", what: "extra squeeze between the lines without the ball (defending team length)", init: 1, min: 0.5, max: 1.2, step: 0.1,
    apply: (p, v) => ({ ...p, shape: { ...p.shape, defDepth: v } }) },
```

Run: `pnpm --filter @touchline/sim-core test && pnpm typecheck`
Expected: PASS

Run: `pnpm --filter @touchline/calibrate exec vitest run test/realism-gate.test.ts --disableConsoleIntercept`
Expected: PASS with `maxDrift: 0`. The defaults are the identity, so the engine is unchanged at this point.

- [ ] **Step 1: Switch the behaviours on by default** (`params.ts` `DEFAULT_PARAMS`)

```ts
  support: { count: 2, distM: 12, speedShare: 0.8 },
  marking: { weight: 0.5, radiusM: 10, goalSideM: 1.5 },
  carry: { speed: 5.5, durationS: [0.8, 2.0], avoidM: 6, shieldM: 3, shieldSpeed: 1.5 },
```

Run: `pnpm --filter @touchline/sim-core test`
Expected: PASS. If a sim-core test asserts an exact statistic that the new behaviour moves, check that the new value is football-plausible before updating the expectation, and say so in the commit message.

- [ ] **Step 2: Include the spatial statistics in the tuner's loss**

In `evaluate.ts`, import `GATE_KEYS, type GateKey` from `./gate.js`. Change `meanMetrics`, `WEIGHTS` and `loss` to use `GATE_KEYS`/`GateKey` instead of `SCALAR_KEYS`/`ScalarKey`, and add to `WEIGHTS`:

```ts
  width_poss_m: 0.5, width_def_m: 0.5, length_def_m: 0.5, line_height_def_m: 0.5, ball_pressure_m: 0.5, support_15m: 0.5, free_space_m: 0.5
```

In `tune.ts`, replace `ScalarKey` with `GateKey` (imported from `./gate.js`). In `cli.ts`, replace `SCALAR_KEYS` with `GATE_KEYS` in the `simulated` and `real` objects.

Add to `KNOBS` in `knobs.ts`:

```ts
  { name: "marking_weight", what: "how tightly defenders mark (free space, fouls, turnovers)", init: 0.5, min: 0, max: 1, step: 0.25,
    apply: (p, v) => ({ ...p, marking: { ...p.marking, weight: v } }) },
  { name: "support_dist", what: "distance supporters offer from the carrier (support, pass length)", init: 12, min: 8, max: 18, step: 2,
    apply: (p, v) => ({ ...p, support: { ...p.support, distM: v } }) },
```

Run: `pnpm --filter @touchline/calibrate typecheck && pnpm --filter @touchline/calibrate exec vitest run test/tune.test.ts test/gate.test.ts test/spatial.test.ts`
Expected: PASS

- [ ] **Step 3: Recalibrate** (about an hour; run in the background)

Run: `pnpm calibrate --from data/params/touchline-params.json --out data/params/touchline-params.json --matches 12 --rounds 1`
Expected: it ends with `wrote …: loss <n>`. Record the loss. The previous run had 5.154 over 19 statistics; the new loss also covers 7 spatial statistics.

- [ ] **Step 4: Enforce the spatial targets in the gate** (`realism-gate.test.ts`)

Change the real-target loop and the `z` map from `SCALAR_KEYS` to `GATE_KEYS`:

```ts
    const z = Object.fromEntries(GATE_KEYS.map((k) => [k, (now.mean[k] - targets.metrics[k]!.mean) / scaleOf(targets.metrics[k]!)]))
    ...
    for (const k of GATE_KEYS) expect(Math.abs(z[k]!), `${k} vs real`).toBeLessThan(GATE_Z)
```

Refresh the baseline and run the gate:

Run: `UPDATE_REALISM_BASELINE=1 pnpm --filter @touchline/calibrate exec vitest run test/realism-gate.test.ts`
Expected: PASS. Every statistic, spatial ones included, has |z| < 3 (criteria C1 and C4).

If a spatial statistic fails, **stop**. Report the statistic, its value and the real value to the user. Do not widen `GATE_Z` and do not drop the statistic.

- [ ] **Step 5: Write the realism report and check C1–C4**

Run: `pnpm realism --out docs/realism/realism-report.md --matches 16`

Read the table and record each result in a new `## Results (2026-MM-DD)` section of the spec:
- **C1:** count of the original 19 within 1 SD (needs ≥ 16) and within 2 SD (needs all 19).
- **C2:** z for free kicks, fouls, goals and shots on target (needs \|z\| ≤ 1).
- **C3:** shots-per-match SD (needs ≤ 5).
- **C4:** z for each spatial statistic (needs \|z\| < 3).

Mark each MET or NOT MET, with the number. C2 and C3 are ASSUMED thresholds, so a NOT MET is reported, not hidden.

- [ ] **Step 6: Review in the replay (C5)**

Run: `pnpm library` to rebuild the match library with the new engine, then `pnpm dev`. Open a match in the web app and watch three 2-minute stretches of open play, checking for:
- **Support:** two teammates near the carrier offering angles, not standing in a passing lane.
- **Marking:** defenders goal-side of nearby attackers, with the shape still recognisable.
- **Shielding:** a pressed carrier turning or moving away rather than standing still, and carries curving around a defender.

Note anything that looks wrong, such as players orbiting, a collapsing shape, or jitter, in the Results section under C5.

- [ ] **Step 7: Run the whole test suite**

Run: `pnpm test && pnpm typecheck && uv run --project python/analytics pytest python/analytics/tests`
Expected: PASS

- [ ] **Step 8: Commit**

```bash
git add packages data docs
git commit -m "feat: switch on support, marking and shielding; recalibrate; enforce spatial realism targets

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

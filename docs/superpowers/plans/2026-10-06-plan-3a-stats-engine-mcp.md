# Touchline Plan 3a — Stats Engine and MCP Stats Server Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the domain stream into the spec's metrics and signals with an incremental, deterministic stats engine, and give agents read-only access to it through an MCP server; close the Plan 2c review's deferred findings.

**Architecture:** Pass-difficulty (xPass) and expected-goals (xG) models are fitted offline in Python on the seven IDSSE matches with tracking (only coefficients are committed) and ported line for line to TypeScript, with a parity test. `packages/stats` stamps every value with the tick at which it became known (step-function series and running totals), so a question about tick t never sees later data and a live run and a replay of its files agree exactly; signals are raised as thresholds are crossed, and team dynamics are checked every 10 s once a tick is complete. It replays run folders (`domain.jsonl` plus CDF tracking) and wraps the engine in Effect streams. `packages/mcp-stats` serves nine read-only tools over stdio or Streamable HTTP with the official MCP TypeScript SDK.

**Tech Stack:** as Plans 2a-2c (TypeScript 5.9.3, Effect 4.0.0, vitest 5.0.3, pnpm 11.27, Turborepo 2.11.6; Python via uv with kloppy 3.19.0, pytest 9.1.1), plus `@modelcontextprotocol/sdk` 1.32.0 and `zod` 4.6.5 in the MCP package. The Python fit needs no new dependency (Newton's method in plain Python).

**Spec:** `docs/superpowers/specs/2026-10-03-touchline-design.md` §4 (hot path; agents reach stats over MCP), §4.1 (protocol table), §5.2 (stats engine: metric ids, methods, signal types), §5.3 (agents read state only through the MCP stats tools; the Fact-Checker's code check), §5.3.1 (evidence refs and decision feedback), §7 (unit tests per metric, golden-file tests). Roadmap: `docs/superpowers/plans/2026-10-03-touchline-roadmap.md`. Builds on Plan 2c (merged to `main`).

**Scope:** the roadmap's Plan 3 holds two subsystems, so it is split as Plan 2 was. Plan 3a (this plan) is what the Plan 4 agents need first: the stats engine, its signals and the MCP server. Plan 3b follows: what-if re-simulation, the better-option explainer, the positioning advisor, pitch-control-aware passing with recalibration, and the `act.xt` and `pitch.ctrl` metrics.

**How code is given:** new files in full; changes to existing files as exact patches applied from the repository root with the `git apply <<'PATCH' … PATCH` block shown, each produced from the verified prototype task by task.

**Verification status:** every task was built and run in full before this plan was written, one commit per task, each commit's tests and type checks green, and the whole suite (realism gate included) green at the end; the code blocks reproduce the prototype file for file (checked by replaying the plan on a fresh clone of `main`). Results:
- **Models:** xPass is fitted on 6,061 IDSSE passes, with held-out log loss 0.473 against 0.523 for the base rate. xG is fitted on 168 shots, at 0.316 against 0.320.
- **Completion gap:** on simulated passes the real-data xPass averages about 0.82 while about 0.73 are completed. This shows the known completion gap from an independent measure.
- **Speed:** the engine costs well under 1 ms per tick, and `pnpm stats` replays a run folder in about 2.5 s.
- **Signal volume:** a match raises about 80-100 signals, a quarter of them low-salience speed alerts.
- **Scenario detection:**
  - A scripted press surge from 30' to 45' raises a pressure shift for the pressing team in at least 5 of 6 seeds.
  - A scripted momentum swing from 60' to 75' raises a momentum swing in at least 3 of 6 seeds. The scripted effect is mild.
- **Live versus replay:** a scripted match gives identical signals and metric values live and replayed from its files.

## Global Constraints

- All earlier constraints hold: determinism per `(seed, teams, params version, fps, script)`, no Effect inside `sim-core`, pinned versions, no StatsBomb, raw real data never in git, one definition shared by Python and TypeScript (now also for the model features, enforced by a parity test).
- **No answer sees the future.** Every value is stamped with the tick at which it became known (`emittedAt` for events, the frame's tick for tracking); every read looks only at or before its tick, and the MCP tools clamp to the latest ingested tick and say so (`as_of_frame`).
- **Agents never compute a statistic.** The MCP tools are read-only (`readOnlyHint`), and every metric answer carries a citable `ref` (`metric@from-to`); signals carry event ids and refs as evidence.
- **Only coefficients leave the real data:** `data/params/stats-models.json` holds coefficients and fit summaries, no event or tracking rows.
- **The MCP HTTP transport listens on 127.0.0.1 only** (public deployment is Plan 6); in stdio mode nothing but the protocol is written to stdout.
- **Signal ids depend on what a signal is about** (type, tick, subject), not on the order inputs arrive within a tick.
- **The realism gate stays green at every commit;** Task 8 changes scripted runs only.

## Review Focus

1. **A query that sees the future.** An agent asking about minute 60 must get the answer it would have got live at minute 60, never one coloured by later events or a pass whose outcome was not yet known. *Task 6, `replay.test.ts` ("answer a query about tick t the same before and after seeing what came later"), across every metric and subject; Task 3 stamps events with `emittedAt`.*
2. **Events arriving after their tick's frame.** The simulator emits a carry cut short by the whistle, and `period_end`/`match_end`, after the last frame of the period. Live and replayed runs must still agree. *Task 3, `kinematics.test.ts` (late events are accepted, earlier ones refused); Task 5, `team.test.ts` ("count an event that follows its tick's frame"); Task 6, live equals replay on a scripted match.*
3. **25 fps runs.** Render runs use `dt = 0.04`, and every window counted in ticks (speed over 0.5 s, the 10-second checks, 5-minute windows) must scale with `dt`. *Task 3, `kinematics.test.ts` ("measure the same speeds and distances at 25 frames per second").*
4. **Signal floods.** Thresholds tuned on a few matches could spam the Moment Detector. *Task 6, `replay.test.ts` caps the signals of a goal-heavy scripted match; Tasks 3-5 limit repeats (sprint alerts only for a faster sprint, five-minute cooldowns, simultaneous substitutions judged together).*
5. **Agents sending bad input.** Unknown ids, a metric a subject lacks, frames past the end, or huge series must produce readable tool errors or clamped answers, never a crash or a hang. *Task 7, `server.test.ts` (tool errors, clamping, the 500-point cap on series).*

---

### Task 1: xPass and xG models fitted on IDSSE

Spec §5.2 asks for a pass-difficulty model (distance, angle, defenders in lane, pressure) and an xG model (distance, angle, body part, defenders in the shot cone). Both are logistic regressions fitted here on the seven IDSSE matches, with features measured from the event's location and the tracking frame nearest to it (5 Hz): for a pass, its length and forward progress (each per 10 m), the opponents within 2 m of the pass line away from both ends (at most 3) and the pressure on the passer (1 with an opponent on the ball, 0 from 5 m); for a shot, the distance to the goal centre (per 10 m), the angle the goal mouth subtends, a header flag and the outfield opponents inside the triangle to the posts (the opponent nearest the goal centre is taken as the keeper). IDSSE gives no end point for incomplete passes, so a pass ends where the ball was next played (the next event's location); the simulator records the same point. Each team's attacking direction comes from where it lines up at the period's kick-off. Penalties are left out of the xG fit and keep a fixed 0.76. The fit is Newton's method with an L2 penalty on the coefficients: 1 for xPass (thousands of passes) and 0.1 for xG (168 shots, where a strong penalty flattens close-range chances). Each fit is scored by leaving one match out at a time against the base rate. Only coefficients and these scores are written. All seven tracking files are needed (about 370 MB each), so their checksums join `idsse.py`. A second entry point prints the features of every pass and shot in a synthetic run folder, for the parity test in Task 2.

**Files:**
- Create: `python/analytics/touchline_analytics/stats_models.py`, `python/analytics/tests/test_stats_models.py`
- Modify: `python/analytics/touchline_analytics/idsse.py` (checksums of all seven tracking files), `python/analytics/tests/test_idsse.py`, `README.md`, `ATTRIBUTION.md`
- Create (generated): `data/params/stats-models.json`

**Interfaces:**
- Consumes: `MATCHES`, `PROVENANCE`, `filenames` (`idsse.py`); kloppy's Sportec loaders.
- Produces: Python `segment_distance`, `lane_defenders`, `pressure`, `pass_features(start, end, attack, opponents)`, `goal_angle`, `cone_defenders`, `shot_features(at, attack, header, opponents)`, `sigmoid`, `predict`, `fit_logistic(xs, ys, l2)`, `log_loss`, `idsse_samples`, `build`, `run_features(run_dir)`; constants `XPASS_FEATURES = [length_10m, forward_10m, lane_defenders, pressure]`, `XG_FEATURES = [distance_10m, angle_rad, header, cone_defenders]`, `PENALTY_XG = 0.76`; `data/params/stats-models.json` with `version`, `xpass {features, intercept, coefficients, l2, n, positives, held_out_log_loss, base_rate_log_loss}`, `xg {… , penalty}`.

- [ ] **Step 1: Write the failing tests**

Create `python/analytics/tests/test_stats_models.py`:

```python
import math
import random

from touchline_analytics.stats_models import (
    cone_defenders,
    fit_logistic,
    goal_angle,
    lane_defenders,
    pass_features,
    predict,
    pressure,
    shot_features,
)


def test_lane_counts_opponents_near_the_line_but_not_at_its_ends():
    start, end = (0.0, 0.0), (20.0, 0.0)
    opponents = [(10.0, 1.5), (10.0, 2.5), (0.5, 0.0), (19.5, 0.5), (5.0, -1.0)]
    assert lane_defenders(start, end, opponents) == 2


def test_lane_count_is_capped_at_three():
    assert lane_defenders((0.0, 0.0), (40.0, 0.0), [(float(x), 0.0) for x in range(5, 40, 5)]) == 3


def test_pressure_falls_from_one_to_zero_over_five_metres():
    assert pressure((0.0, 0.0), [(0.0, 0.0)]) == 1.0
    assert math.isclose(pressure((0.0, 0.0), [(2.5, 0.0), (30.0, 0.0)]), 0.5)
    assert pressure((0.0, 0.0), [(6.0, 0.0)]) == 0.0
    assert pressure((0.0, 0.0), []) == 0.0


def test_pass_features_measure_forward_progress_in_the_attacking_direction():
    f_home = pass_features((0.0, 0.0), (-10.0, 0.0), 1, [])
    f_away = pass_features((0.0, 0.0), (-10.0, 0.0), -1, [])
    assert f_home == [1.0, -1.0, 0.0, 0.0]
    assert f_away == [1.0, 1.0, 0.0, 0.0]


def test_goal_angle_is_widest_on_the_goal_line_and_mirrors_by_direction():
    near = goal_angle((50.0, 0.0), 1)
    far = goal_angle((30.0, 0.0), 1)
    assert near > far
    assert math.isclose(goal_angle((30.0, 5.0), 1), goal_angle((-30.0, 5.0), -1))
    assert math.isclose(far, 2 * math.atan(3.66 / 22.5))


def test_cone_defenders_skip_the_keeper_and_players_outside_the_triangle():
    shooter = (36.0, 0.0)
    keeper = (51.5, 0.0)
    inside = (44.0, 0.5)
    outside = (44.0, 8.0)
    assert cone_defenders(shooter, 1, [keeper, inside, outside]) == 1
    assert cone_defenders(shooter, 1, []) == 0


def test_shot_features():
    f = shot_features((-41.5, 0.0), -1, True, [])
    assert math.isclose(f[0], 1.1)
    assert f[2] == 1.0 and f[3] == 0.0


def test_fit_logistic_recovers_known_coefficients():
    rng = random.Random(3)
    xs, ys = [], []
    for _ in range(4000):
        x = [rng.uniform(-2, 2), rng.uniform(-2, 2)]
        ys.append(1 if rng.random() < 1 / (1 + math.exp(-(0.5 + 1.5 * x[0] - 1.0 * x[1]))) else 0)
        xs.append(x)
    b0, bs = fit_logistic(xs, ys, 0.0)
    assert abs(b0 - 0.5) < 0.15 and abs(bs[0] - 1.5) < 0.15 and abs(bs[1] + 1.0) < 0.15
    assert 0 < predict(b0, bs, [0.0, 0.0]) < 1


def test_fit_logistic_l2_shrinks_coefficients():
    xs = [[0.0], [1.0], [2.0], [3.0]]
    ys = [0, 0, 1, 1]
    _, free = fit_logistic(xs, ys, 0.01)
    _, shrunk = fit_logistic(xs, ys, 10.0)
    assert abs(shrunk[0]) < abs(free[0])
```

Apply this change to `python/analytics/tests/test_idsse.py` (from the repository root):

```bash
git apply <<'PATCH'
diff --git a/python/analytics/tests/test_idsse.py b/python/analytics/tests/test_idsse.py
index 8ea6aeb..c27808b 100644
--- a/python/analytics/tests/test_idsse.py
+++ b/python/analytics/tests/test_idsse.py
@@ -39,8 +39,8 @@ def test_download_rejects_a_payload_that_does_not_match_its_checksum(tmp_path, m
     assert not (tmp_path / "m.part").exists()
 
 
-def test_every_default_file_has_a_checksum():
+def test_every_file_has_a_checksum():
+    # The stats models (stats_models.py) are fitted on every match's tracking.
     for match_id in idsse.MATCHES:
-        for kind, name in idsse.filenames(match_id).items():
-            if kind != "tracking" or match_id == "J03WPY":
-                assert name in idsse.SHA256, name
+        for name in idsse.filenames(match_id).values():
+            assert name in idsse.SHA256, name
PATCH
```

- [ ] **Step 2: Run them to make sure they fail**

Run: `uv run --project python/analytics --group dev pytest python/analytics/tests -q`
Expected: a collection error: `ModuleNotFoundError: No module named 'touchline_analytics.stats_models'`

Run: `uv run --project python/analytics --group dev pytest python/analytics/tests/test_idsse.py -q`
Expected: 1 failed: `test_every_file_has_a_checksum` (`DFL_04_03_positions_raw_observed_DFL-COM-000001_DFL-MAT-J03WMX.xml`)

- [ ] **Step 3: Write the fitting module and the checksums**

Create `python/analytics/touchline_analytics/stats_models.py`:

```python
"""Fit the stats engine's pass-difficulty (xPass) and expected-goals (xG) models on real IDSSE matches.

Usage:
  uv run --project python/analytics python -m touchline_analytics.idsse --tracking J03WMX J03WN1 J03WOH J03WOY J03WPY J03WQQ J03WR9
  uv run --project python/analytics python -m touchline_analytics.stats_models            # write data/params/stats-models.json
  uv run --project python/analytics python -m touchline_analytics.stats_models RUN_DIR    # features of a synthetic run (parity test)

Both models are logistic regressions on features measured from an event's location and the tracking frame at
that moment. The feature definitions here and in packages/stats/src/models.ts are the same; a parity test
runs both on one synthetic match. Only coefficients and fit summaries are written, no real event or tracking rows.
"""

from __future__ import annotations

import bisect
import datetime as dt
import json
import math
from pathlib import Path

from .idsse import MATCHES, PROVENANCE, filenames

LANE_WIDTH_M = 2.0
PRESS_RADIUS_M = 5.0
MAX_COUNT = 3
GOAL_HALF_WIDTH = 3.66
HALF_LENGTH = 52.5
XPASS_FEATURES = ["length_10m", "forward_10m", "lane_defenders", "pressure"]
XG_FEATURES = ["distance_10m", "angle_rad", "header", "cone_defenders"]
PENALTY_XG = 0.76
# L2 penalties: xPass has thousands of passes; xG has ~170 shots, where a strong penalty flattens close-range chances.
XPASS_L2 = 1.0
XG_L2 = 0.1

Point = tuple[float, float]


def segment_distance(a: Point, b: Point, q: Point) -> tuple[float, float]:
    """Distance from q to the segment a-b, and where along it (0..1) the nearest point lies."""
    vx, vy = b[0] - a[0], b[1] - a[1]
    l2 = vx * vx + vy * vy
    t = 0.0 if l2 < 1e-9 else max(0.0, min(1.0, ((q[0] - a[0]) * vx + (q[1] - a[1]) * vy) / l2))
    return math.hypot(a[0] + t * vx - q[0], a[1] + t * vy - q[1]), t


def lane_defenders(start: Point, end: Point, opponents: list[Point]) -> int:
    """Opponents within 2 m of the pass line, away from both ends (5 %-95 % of the way), at most 3."""
    n = 0
    for o in opponents:
        d, t = segment_distance(start, end, o)
        if d < LANE_WIDTH_M and 0.05 < t < 0.95:
            n += 1
    return min(n, MAX_COUNT)


def pressure(at: Point, opponents: list[Point]) -> float:
    """1 with an opponent on the ball, falling linearly to 0 at 5 m."""
    if not opponents:
        return 0.0
    near = min(math.hypot(o[0] - at[0], o[1] - at[1]) for o in opponents)
    return max(0.0, 1.0 - near / PRESS_RADIUS_M)


def pass_features(start: Point, end: Point, attack: int, opponents: list[Point]) -> list[float]:
    """length / 10 m, forward progress / 10 m (towards the goal attacked, `attack` = +1 for +x), lane defenders, pressure."""
    length = math.hypot(end[0] - start[0], end[1] - start[1])
    return [length / 10, attack * (end[0] - start[0]) / 10, float(lane_defenders(start, end, opponents)), pressure(start, opponents)]


def goal_angle(at: Point, attack: int) -> float:
    """Angle (radians) the goal mouth subtends from `at`."""
    gx = attack * HALF_LENGTH
    a1 = math.atan2(GOAL_HALF_WIDTH - at[1], gx - at[0])
    a2 = math.atan2(-GOAL_HALF_WIDTH - at[1], gx - at[0])
    d = abs(a1 - a2)
    return 2 * math.pi - d if d > math.pi else d


def _in_triangle(p: Point, a: Point, b: Point, c: Point) -> bool:
    def side(p1: Point, p2: Point, p3: Point) -> float:
        return (p1[0] - p3[0]) * (p2[1] - p3[1]) - (p2[0] - p3[0]) * (p1[1] - p3[1])

    d1, d2, d3 = side(p, a, b), side(p, b, c), side(p, c, a)
    return not ((d1 < 0 or d2 < 0 or d3 < 0) and (d1 > 0 or d2 > 0 or d3 > 0))


def cone_defenders(at: Point, attack: int, opponents: list[Point]) -> int:
    """Opponents inside the triangle from the shooter to both posts, the goalkeeper excepted (the opponent nearest the goal centre), at most 3."""
    gx = attack * HALF_LENGTH
    if not opponents:
        return 0
    keeper = min(range(len(opponents)), key=lambda i: math.hypot(opponents[i][0] - gx, opponents[i][1]))
    posts = ((gx, GOAL_HALF_WIDTH), (gx, -GOAL_HALF_WIDTH))
    n = sum(1 for i, o in enumerate(opponents) if i != keeper and _in_triangle(o, at, posts[0], posts[1]))
    return min(n, MAX_COUNT)


def shot_features(at: Point, attack: int, header: bool, opponents: list[Point]) -> list[float]:
    """distance to the goal centre / 10 m, goal-mouth angle, header (0/1), defenders in the shot cone."""
    d = math.hypot(attack * HALF_LENGTH - at[0], at[1])
    return [d / 10, goal_angle(at, attack), 1.0 if header else 0.0, float(cone_defenders(at, attack, opponents))]


def sigmoid(z: float) -> float:
    return 1 / (1 + math.exp(-z)) if z >= 0 else math.exp(z) / (1 + math.exp(z))


def predict(intercept: float, coefs: list[float], x: list[float]) -> float:
    return sigmoid(intercept + sum(c * v for c, v in zip(coefs, x)))


def _solve(a: list[list[float]], b: list[float]) -> list[float]:
    """Gaussian elimination with partial pivoting (small dense systems)."""
    n = len(b)
    m = [row[:] + [b[i]] for i, row in enumerate(a)]
    for col in range(n):
        piv = max(range(col, n), key=lambda r: abs(m[r][col]))
        m[col], m[piv] = m[piv], m[col]
        for r in range(n):
            if r != col and m[r][col] != 0:
                f = m[r][col] / m[col][col]
                m[r] = [vr - f * vc for vr, vc in zip(m[r], m[col])]
    return [m[i][n] / m[i][i] for i in range(n)]


def fit_logistic(xs: list[list[float]], ys: list[int], l2: float, iters: int = 50) -> tuple[float, list[float]]:
    """Logistic regression by Newton's method with an L2 penalty on the coefficients (not the intercept)."""
    k = len(xs[0]) + 1
    beta = [0.0] * k
    rows = [[1.0] + x for x in xs]
    for _ in range(iters):
        grad = [0.0] * k
        hess = [[0.0] * k for _ in range(k)]
        for r, y in zip(rows, ys):
            p = sigmoid(sum(b * v for b, v in zip(beta, r)))
            w = p * (1 - p)
            for i in range(k):
                grad[i] += (y - p) * r[i]
                for j in range(k):
                    hess[i][j] += w * r[i] * r[j]
        for i in range(1, k):
            grad[i] -= l2 * beta[i]
            hess[i][i] += l2
        step = _solve(hess, grad)
        beta = [b + s for b, s in zip(beta, step)]
        if max(abs(s) for s in step) < 1e-10:
            break
    return beta[0], beta[1:]


def log_loss(ps: list[float], ys: list[int]) -> float:
    eps = 1e-12
    return -sum(y * math.log(max(p, eps)) + (1 - y) * math.log(max(1 - p, eps)) for p, y in zip(ps, ys)) / len(ys)


def _summary(xs: list[list[float]], ys: list[int], groups: list[str], names: list[str], l2: float) -> dict:
    """Fit on everything; score by leaving one match out at a time against the base rate."""
    b0, bs = fit_logistic(xs, ys, l2)
    held, base, truth = [], [], []
    for g in sorted(set(groups)):
        tr = [i for i, gi in enumerate(groups) if gi != g]
        te = [i for i, gi in enumerate(groups) if gi == g]
        c0, cs = fit_logistic([xs[i] for i in tr], [ys[i] for i in tr], l2)
        rate = sum(ys[i] for i in tr) / len(tr)
        held += [predict(c0, cs, xs[i]) for i in te]
        base += [rate] * len(te)
        truth += [ys[i] for i in te]
    return {
        "intercept": round(b0, 6),
        "coefficients": {n: round(c, 6) for n, c in zip(names, bs)},
        "l2": l2,
        "n": len(ys),
        "positives": sum(ys),
        "held_out_log_loss": round(log_loss(held, truth), 4),
        "base_rate_log_loss": round(log_loss(base, truth), 4),
    }


def _attack_dirs(first_frames: dict[int, dict[str, list[Point]]]) -> dict[tuple[int, str], int]:
    """Each team attacks away from where it lines up at the period's kick-off."""
    out = {}
    for period, teams in first_frames.items():
        for team, pts in teams.items():
            mean_x = sum(p[0] for p in pts) / len(pts)
            out[(period, team)] = -1 if mean_x > 0 else 1
    return out


def idsse_samples(root: Path, match_id: str) -> tuple[list[tuple[list[float], int]], list[tuple[list[float], int]]]:
    """xPass and xG samples (features, outcome) from one IDSSE match; penalties are left out of the xG fit."""
    from kloppy import sportec

    f = filenames(match_id)
    ev = sportec.load_event(event_data=str(root / f["event"]), meta_data=str(root / f["meta"]), coordinates="secondspectrum")
    tr = sportec.load_tracking(raw_data=str(root / f["tracking"]), meta_data=str(root / f["meta"]), coordinates="secondspectrum", sample_rate=1 / 5)
    frames: dict[int, list] = {}
    for fr in tr.frames:
        frames.setdefault(fr.period.id, []).append(fr)
    times = {p: [fr.timestamp.total_seconds() for fr in fs] for p, fs in frames.items()}

    def teams_at(fr) -> dict[str, list[Point]]:
        out: dict[str, list[Point]] = {}
        for pl, c in fr.players_data.items():
            if c.coordinates is not None and c.coordinates.x is not None:
                out.setdefault(pl.team.team_id, []).append((c.coordinates.x, c.coordinates.y))
        return out

    attack = _attack_dirs({p: teams_at(fs[0]) for p, fs in frames.items()})

    def frame_at(period: int, t: float):
        ts = times[period]
        i = bisect.bisect_left(ts, t)
        if i > 0 and (i == len(ts) or t - ts[i - 1] <= ts[i] - t):
            i -= 1
        return frames[period][i]

    passes: list[tuple[list[float], int]] = []
    shots: list[tuple[list[float], int]] = []
    events = [e for e in ev.events if e.coordinates is not None and e.coordinates.x is not None]
    for k, e in enumerate(events):
        name = e.event_type.name
        if name not in ("PASS", "SHOT") or e.period.id not in frames:
            continue
        team = e.team.team_id
        teams = teams_at(frame_at(e.period.id, e.timestamp.total_seconds()))
        opp = [p for tid, pts in teams.items() if tid != team for p in pts]
        at = (e.coordinates.x, e.coordinates.y)
        a = attack[(e.period.id, team)]
        if name == "PASS":
            ok = e.result is not None and e.result.name == "COMPLETE"
            rc = getattr(e, "receiver_coordinates", None)
            if rc is not None and rc.x is not None:
                end = (rc.x, rc.y)
            else:
                # Where the ball was next played: the next event with a location in the same period.
                nxt = next((n for n in events[k + 1 :] if n.period.id == e.period.id), None)
                if nxt is None:
                    continue
                end = (nxt.coordinates.x, nxt.coordinates.y)
            passes.append((pass_features(at, end, a, opp), 1 if ok else 0))
        else:
            quals = [q.value.name for q in e.qualifiers or [] if type(q).__name__ in ("SetPieceQualifier", "BodyPartQualifier")]
            if "PENALTY" in quals:
                continue
            goal = e.result is not None and e.result.name == "GOAL"
            shots.append((shot_features(at, a, "HEAD" in quals, opp), 1 if goal else 0))
    return passes, shots


def build(root: Path) -> dict:
    px, py, pg, sx, sy, sg = [], [], [], [], [], []
    for mid in MATCHES:
        passes, shots = idsse_samples(root, mid)
        print(f"{mid}: {len(passes)} passes, {len(shots)} shots", flush=True)
        px += [x for x, _ in passes]
        py += [y for _, y in passes]
        pg += [mid] * len(passes)
        sx += [x for x, _ in shots]
        sy += [y for _, y in shots]
        sg += [mid] * len(shots)
    return {
        "_provenance": {
            **PROVENANCE,
            "matches": list(MATCHES),
            "fitted_at": dt.date.today().isoformat(),
            "method": "logistic regression (Newton, L2 penalty on coefficients); features from event locations and the nearest 5 Hz tracking frame",
            "note": "Coefficients and fit summaries only; no real event or tracking rows.",
        },
        "version": "stats-models-1",
        "xpass": {"features": XPASS_FEATURES, **_summary(px, py, pg, XPASS_FEATURES, XPASS_L2)},
        "xg": {"features": XG_FEATURES, "penalty": PENALTY_XG, **_summary(sx, sy, sg, XG_FEATURES, XG_L2)},
    }


def run_features(run_dir: Path) -> list[dict]:
    """Features of every pass and non-penalty shot in a synthetic run folder (domain.jsonl and CDF tracking.jsonl)."""
    meta = json.loads((run_dir / "meta.json").read_text())
    home_id = meta["teams"]["home"]["id"]
    wanted: dict[tuple[str, int], list[dict]] = {}
    with (run_dir / "domain.jsonl").open() as fh:
        for line in fh:
            e = json.loads(line)
            if e["type"] == "pass" and e["x_end"] is not None or e["type"] == "shot" and e["attrs"].get("technique") != "penalty":
                wanted.setdefault((e["period"], e["period_frame_id"]), []).append(e)
    first: dict[str, dict[str, list[Point]]] = {}
    out = []
    with (run_dir / "tracking.jsonl").open() as fh:
        for line in fh:
            f = json.loads(line)
            teams = {side: [(p["x"], p["y"]) for p in f["teams"][side]["players"]] for side in ("home", "away")}
            first.setdefault(f["period"], teams)
            for e in wanted.get((f["period"], f["frame_id"]), []):
                side = "home" if e["team_id"] == home_id else "away"
                fp = first[f["period"]][side]
                attack = -1 if sum(p[0] for p in fp) / len(fp) > 0 else 1
                opp = teams["away" if side == "home" else "home"]
                at = (e["x"], e["y"])
                if e["type"] == "pass":
                    x = pass_features(at, (e["x_end"], e["y_end"]), attack, opp)
                else:
                    x = shot_features(at, attack, e["attrs"].get("body_part") == "head", opp)
                out.append({"id": e["id"], "features": x})
    return out


if __name__ == "__main__":
    import sys

    if len(sys.argv) > 1:
        print(json.dumps(run_features(Path(sys.argv[1]))))
    else:
        result = build(Path("data/raw/idsse"))
        out = Path("data/params/stats-models.json")
        out.write_text(json.dumps(result, indent=1) + "\n")
        print(f"wrote {out}: xpass held-out log loss {result['xpass']['held_out_log_loss']} (base {result['xpass']['base_rate_log_loss']}), "
              f"xg {result['xg']['held_out_log_loss']} (base {result['xg']['base_rate_log_loss']})")
```

Apply this change to `python/analytics/touchline_analytics/idsse.py` (from the repository root):

```bash
git apply <<'PATCH'
diff --git a/python/analytics/touchline_analytics/idsse.py b/python/analytics/touchline_analytics/idsse.py
index de97f12..33f9ab6 100644
--- a/python/analytics/touchline_analytics/idsse.py
+++ b/python/analytics/touchline_analytics/idsse.py
@@ -43,7 +43,13 @@ SHA256: dict[str, str] = {
     "DFL_03_02_events_raw_DFL-COM-000002_DFL-MAT-J03WPY.xml": "e440a3adf9a38d3e4ce4289343a59a3b5f76018a78e97c765114f7817591fb3c",
     "DFL_03_02_events_raw_DFL-COM-000002_DFL-MAT-J03WQQ.xml": "b79ccc1ee3de5ba662546a9a21304784642d00a791ccc1175550eaa463ea0074",
     "DFL_03_02_events_raw_DFL-COM-000002_DFL-MAT-J03WR9.xml": "31735a2d7b9008c44cae9b6ac43ab38ddeaa435d0416265ec0ebfebf53b3c982",
+    "DFL_04_03_positions_raw_observed_DFL-COM-000001_DFL-MAT-J03WMX.xml": "d3dd92e509421a6466acb0a083c009035f1751bc5fd9ef42ffa8f20d01cf7d49",
+    "DFL_04_03_positions_raw_observed_DFL-COM-000001_DFL-MAT-J03WN1.xml": "56ef948961a18e150dba0b7b16869d0008ff66f3050a0c355d31fa5b8ec2fcec",
+    "DFL_04_03_positions_raw_observed_DFL-COM-000002_DFL-MAT-J03WOH.xml": "ec4dcf30200aad694dea263d5289485fcd0ca42badddaeb7c81f5cd5a4229d4f",
+    "DFL_04_03_positions_raw_observed_DFL-COM-000002_DFL-MAT-J03WOY.xml": "a228ef0e676d009cefff1580fcb721b53f598454eb120ec347e0a628a3a4646b",
     "DFL_04_03_positions_raw_observed_DFL-COM-000002_DFL-MAT-J03WPY.xml": "845202c29ad93d696653436da426a7cdaefb848298e07b7343de6529581671e1",
+    "DFL_04_03_positions_raw_observed_DFL-COM-000002_DFL-MAT-J03WQQ.xml": "cbefcb0bd7f39f3b94ee69a7bc97aac0f936425062c1cc1b144733df36804d6f",
+    "DFL_04_03_positions_raw_observed_DFL-COM-000002_DFL-MAT-J03WR9.xml": "70b63069189019066fb7e3d9db891122edfe787f3a43ba522ebe45ed89ea0269",
 }
 
 
PATCH
```

- [ ] **Step 4: Run the tests**

Run: `uv run --project python/analytics --group dev pytest python/analytics/tests -q`
Expected: 25 passed

- [ ] **Step 5: Download the tracking and fit (one-off; about 2.6 GB, then about 4 minutes)**

Behind a TLS-inspecting proxy Python may reject Hugging Face's certificate; export the system's trusted certificates and point Python at them (do not commit the file):

```bash
security find-certificate -a -p /Library/Keychains/System.keychain /System/Library/Keychains/SystemRootCertificates.keychain > /tmp/certs.pem   # macOS
export SSL_CERT_FILE=/tmp/certs.pem
```

```bash
uv run --project python/analytics python -m touchline_analytics.idsse --tracking J03WMX J03WN1 J03WOH J03WOY J03WPY J03WQQ J03WR9
uv run --project python/analytics python -m touchline_analytics.stats_models
```

Expected: one line per match (`J03WMX: 984 passes, 20 shots` … `J03WR9: 903 passes, 26 shots`), then `wrote data/params/stats-models.json: xpass held-out log loss 0.4733 (base 0.5234), xg 0.3156 (base 0.3196)`. Every download is checked against its checksum. The fit is deterministic, so the file must match this one except for `fitted_at`:

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
  "method": "logistic regression (Newton, L2 penalty on coefficients); features from event locations and the nearest 5 Hz tracking frame",
  "note": "Coefficients and fit summaries only; no real event or tracking rows."
 },
 "version": "stats-models-1",
 "xpass": {
  "features": [
   "length_10m",
   "forward_10m",
   "lane_defenders",
   "pressure"
  ],
  "intercept": 2.111722,
  "coefficients": {
   "length_10m": -0.075895,
   "forward_10m": -0.256056,
   "lane_defenders": -0.545615,
   "pressure": -0.842339
  },
  "l2": 1.0,
  "n": 6061,
  "positives": 4750,
  "held_out_log_loss": 0.4733,
  "base_rate_log_loss": 0.5234
 },
 "xg": {
  "features": [
   "distance_10m",
   "angle_rad",
   "header",
   "cone_defenders"
  ],
  "penalty": 0.76,
  "intercept": -0.946439,
  "coefficients": {
   "distance_10m": -1.030085,
   "angle_rad": 1.255561,
   "header": -1.449105,
   "cone_defenders": -0.161441
  },
  "l2": 0.1,
  "n": 168,
  "positives": 16,
  "held_out_log_loss": 0.3156,
  "base_rate_log_loss": 0.3196
 }
}
```

- [ ] **Step 6: Document it**

Apply this change to `README.md`, `ATTRIBUTION.md` (from the repository root):

````bash
git apply <<'PATCH'
diff --git a/ATTRIBUTION.md b/ATTRIBUTION.md
index eb451ac..d37c89a 100644
--- a/ATTRIBUTION.md
+++ b/ATTRIBUTION.md
@@ -16,6 +16,6 @@ Touchline's simulator is original code. These projects and papers shaped its des
 
 | Dataset | Licence | How it is used |
 |---|---|---|
-| IDSSE / Sportec Open DFL dataset — © Deutsche Fussball Liga (DFL); Bassek et al., *Scientific Data* (2025), https://doi.org/10.1038/s41597-025-04505-y | CC-BY 4.0 | Downloaded locally into git-ignored `data/raw/`; only aggregate match statistics (`data/params/targets-idsse.json`) are committed. These are the targets the engine is tuned to and validated against (`docs/realism/realism-report.md`). |
+| IDSSE / Sportec Open DFL dataset — © Deutsche Fussball Liga (DFL); Bassek et al., *Scientific Data* (2025), https://doi.org/10.1038/s41597-025-04505-y | CC-BY 4.0 | Downloaded locally into git-ignored `data/raw/`; only aggregate match statistics (`data/params/targets-idsse.json`) and fitted model coefficients (`data/params/stats-models.json`) are committed. These are the targets the engine is tuned to and validated against (`docs/realism/realism-report.md`). |
 
 The default xG prior (`packages/sim-core/src/params.ts`) is fitted to an approximate public reference xG curve by distance and angle, not to any dataset.
diff --git a/README.md b/README.md
index 27b2e7d..bda7783 100644
--- a/README.md
+++ b/README.md
@@ -28,6 +28,15 @@ pnpm realism --matches 16 --out docs/realism/realism-report.md            # held
 UPDATE_REALISM_BASELINE=1 pnpm --filter @touchline/calibrate test realism-gate  # refresh data/params/realism-baseline.json
 ```
 
+## Stats models
+
+The stats engine's pass-difficulty (xPass) and expected-goals (xG) models are logistic regressions fitted on the seven IDSSE matches, with features taken from event locations and the tracking frame at that moment (all seven tracking files, ~370 MB each):
+
+```bash
+uv run --project python/analytics python -m touchline_analytics.idsse --tracking J03WMX J03WN1 J03WOH J03WOY J03WPY J03WQQ J03WR9
+uv run --project python/analytics python -m touchline_analytics.stats_models   # data/params/stats-models.json (coefficients only)
+```
+
 `pnpm sim` loads `data/params/touchline-params.json` by default (`--params <file>` to override). Every parameter file must carry provenance with an allowed licence; StatsBomb-derived parameters are refused.
 
 Options for `pnpm sim`: `--seed` (0–4294967295), `--home` / `--away` (club ids in `data/league/league.json`), `--fps` (10, or 25 for video render runs), `--match-id`, `--kickoff` (ISO time), `--out`.
@@ -41,7 +50,7 @@ Options for `pnpm sim`: `--seed` (0–4294967295), `--home` / `--away` (club ids
 | `packages/schema` | Effect Schema for the live domain stream (events and frames) |
 | `packages/sim` | Effect streams, CDF v0.3.2 writers, run manifest, CLI |
 | `packages/calibrate` | Match statistics (identical to the Python definitions), tuning knobs, tuner, realism gate |
-| `python/analytics` | CDF validation, IDSSE download, real-match targets, realism report |
+| `python/analytics` | CDF validation, IDSSE download, real-match targets, realism report, stats-model fitting |
 
 ## Status
 
PATCH
````

- [ ] **Step 7: Commit**

```bash
git add python/analytics data/params/stats-models.json README.md ATTRIBUTION.md
git commit -m "feat(analytics): xPass and xG models fitted on IDSSE tracking (coefficients only)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```



### Task 2: Stats package: metric catalog, signal schema, models in TypeScript

The stats engine gets its package. The shared schema gains the stable metric ids of spec §5.2 (plus `team.poss`, possession share; `act.xt` and `pitch.ctrl` arrive with Plan 3b) and the `Signal` record agents and the cue bus will consume; a signal's `metric` and `value` are null when there is no number (a card). The catalog describes each metric: unit, the subjects it applies to (player, team, match), whether a query may restrict it to a window, and how it is computed. The model features are ported line for line from Task 1, and a parity test runs both languages on one synthetic match (it needs `uv`, and in CI must run).

**Files:**
- Create: `packages/schema/src/stats.ts`, `packages/stats/package.json`, `packages/stats/tsconfig.json`, `packages/stats/vitest.config.ts`, `packages/stats/src/catalog.ts`, `packages/stats/src/models.ts`, `packages/stats/src/index.ts`
- Modify: `packages/schema/src/index.ts`
- Test: `packages/stats/test/models.test.ts`, `packages/stats/test/catalog.test.ts`, `packages/schema/test/schema.test.ts` (one new case)

**Interfaces:**
- Consumes: Task 1's `data/params/stats-models.json` and `run_features` CLI; `writeMatch` (`@touchline/sim`).
- Produces: schema `MetricId` (14 literals), `SignalType` (11 literals), `Signal {id, match_id, type, frame_id, frame_from, frame_to, period, match_clock, team_id, player_id, metric: MetricId | null, value: number | null, salience, evidence: string[], data: Record<string, number>}`, `decodeSignal`; stats `type SubjectKind = "player" | "team" | "match"`, `interface MetricDef {id, name, unit, subjects, windowed, defaultWindowS, description}`, `METRICS`, `metricDef(id)`; `interface LogisticModel {intercept, coefficients}`, `interface StatsModels {version, xpass, xg: LogisticModel & {penalty}}`, `class ModelsError`, `modelsFromJson(raw)`, `laneDefenders`, `pressureAt`, `passFeatures(start, end, attack, opponents)`, `goalAngle`, `coneDefenders`, `shotFeatures(at, attack, header, opponents)`, `predict(model, x)`, `XPASS_FEATURES`, `XG_FEATURES`.

- [ ] **Step 1: Create the package and write the failing tests**

Create `packages/stats/package.json`:

```json
{
  "name": "@touchline/stats",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "exports": { ".": "./src/index.ts" },
  "scripts": { "test": "vitest run", "typecheck": "tsc --noEmit -p ." },
  "dependencies": { "@touchline/schema": "workspace:*", "@touchline/sim-core": "workspace:*", "effect": "4.0.0" },
  "devDependencies": { "@touchline/league": "workspace:*", "@touchline/sim": "workspace:*" }
}
```

Create `packages/stats/tsconfig.json`:

```json
{ "extends": "../../tsconfig.base.json", "include": ["src", "test", "scripts"] }
```

Create `packages/stats/vitest.config.ts`:

```ts
import { defineConfig } from "vitest/config"

export default defineConfig({ test: { testTimeout: 120_000 } })
```

Run: `pnpm install`
Expected: the new workspace package is linked (`pnpm-lock.yaml` gains `packages/stats`)

Create `packages/stats/test/models.test.ts`:

```ts
import { execFileSync, spawnSync } from "node:child_process"
import { mkdtempSync, readFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { Effect } from "effect"
import { describe, expect, it } from "vitest"
import type { League } from "@touchline/league"
import { writeMatch } from "@touchline/sim"
import { DEFAULT_PARAMS, initMatch, isFinished, step, type DomainEvent, type Frame } from "@touchline/sim-core"
import { coneDefenders, goalAngle, laneDefenders, modelsFromJson, ModelsError, passFeatures, predict, pressureAt, shotFeatures } from "../src/models.js"

const root = join(dirname(fileURLToPath(import.meta.url)), "../../..")
const committed = () => JSON.parse(readFileSync(join(root, "data/params/stats-models.json"), "utf8"))
const hasUv = spawnSync("uv", ["--version"]).status === 0

describe("stats models", () => {
  it("count lane defenders near the line but not at its ends, at most three", () => {
    const opp = [{ x: 10, y: 1.5 }, { x: 10, y: 2.5 }, { x: 0.5, y: 0 }, { x: 19.5, y: 0.5 }, { x: 5, y: -1 }]
    expect(laneDefenders({ x: 0, y: 0 }, { x: 20, y: 0 }, opp)).toBe(2)
    expect(laneDefenders({ x: 0, y: 0 }, { x: 40, y: 0 }, [5, 10, 15, 20, 25, 30, 35].map((x) => ({ x, y: 0 })))).toBe(3)
  })

  it("measure pressure from one on the ball to zero at five metres", () => {
    expect(pressureAt({ x: 0, y: 0 }, [{ x: 0, y: 0 }])).toBe(1)
    expect(pressureAt({ x: 0, y: 0 }, [{ x: 2.5, y: 0 }, { x: 30, y: 0 }])).toBeCloseTo(0.5, 12)
    expect(pressureAt({ x: 0, y: 0 }, [])).toBe(0)
  })

  it("measure forward progress in the attacking direction", () => {
    expect(passFeatures({ x: 0, y: 0 }, { x: -10, y: 0 }, 1, [])).toEqual([1, -1, 0, 0])
    expect(passFeatures({ x: 0, y: 0 }, { x: -10, y: 0 }, -1, [])).toEqual([1, 1, 0, 0])
  })

  it("measure the goal angle and the defenders in the shot cone, the keeper excepted", () => {
    expect(goalAngle({ x: 30, y: 0 }, 1)).toBeCloseTo(2 * Math.atan(3.66 / 22.5), 12)
    expect(goalAngle({ x: 30, y: 5 }, 1)).toBeCloseTo(goalAngle({ x: -30, y: 5 }, -1), 12)
    expect(coneDefenders({ x: 36, y: 0 }, 1, [{ x: 51.5, y: 0 }, { x: 44, y: 0.5 }, { x: 44, y: 8 }])).toBe(1)
    const f = shotFeatures({ x: -41.5, y: 0 }, -1, true, [])
    expect(f[0]).toBeCloseTo(1.1, 12)
    expect([f[2], f[3]]).toEqual([1, 0])
  })

  it("load the committed models, whose fits beat the base rate on held-out matches", () => {
    const raw = committed()
    const m = modelsFromJson(raw)
    expect(m.xpass.coefficients).toHaveLength(4)
    expect(raw.xpass.held_out_log_loss).toBeLessThan(raw.xpass.base_rate_log_loss)
    expect(raw.xg.held_out_log_loss).toBeLessThan(raw.xg.base_rate_log_loss)
    // Harder passes are less likely to arrive; closer, more central shots more likely to score.
    const easy = predict(m.xpass, passFeatures({ x: 0, y: 0 }, { x: 0, y: 10 }, 1, []))
    const hard = predict(m.xpass, passFeatures({ x: 0, y: 0 }, { x: 35, y: 0 }, 1, [{ x: 1, y: 1 }, { x: 15, y: 0.5 }, { x: 25, y: -0.5 }]))
    expect(easy).toBeGreaterThan(0.85)
    expect(hard).toBeLessThan(0.35)
    const close = predict(m.xg, shotFeatures({ x: 46.5, y: 0 }, 1, false, []))
    const far = predict(m.xg, shotFeatures({ x: 27.5, y: 0 }, 1, false, []))
    expect(close).toBeGreaterThan(0.35)
    expect(far).toBeLessThan(0.06)
  })

  it("refuse a models file with a missing or misnamed coefficient", () => {
    const raw = committed()
    expect(() => modelsFromJson({ ...raw, xpass: { ...raw.xpass, coefficients: { ...raw.xpass.coefficients, pressure: "x" } } })).toThrow(ModelsError)
    expect(() => modelsFromJson({ ...raw, xg: { ...raw.xg, features: ["distance_10m"] } })).toThrow(/xg.features/)
    expect(() => modelsFromJson({ ...raw, xg: { ...raw.xg, penalty: 2 } })).toThrow(/penalty/)
  })

  // In CI the test must run: a missing uv fails it rather than skipping it.
  it.skipIf(!hasUv && !process.env.CI)("compute the same features as the Python fit for every pass and shot of a synthetic match", async () => {
    const league = JSON.parse(readFileSync(join(root, "data/league/league.json"), "utf8")) as League
    const cfg = { matchId: "parity", seed: 4243, kickoffTime: "2026-10-18T14:00:00.000Z", home: league.clubs[1]!, away: league.clubs[2]!, params: DEFAULT_PARAMS, dt: 0.1 }
    const dir = mkdtempSync(join(tmpdir(), "touchline-models-"))
    await Effect.runPromise(writeMatch(cfg, dir))
    const py = JSON.parse(
      execFileSync("uv", ["run", "--locked", "--project", join(root, "python/analytics"), "python", "-m", "touchline_analytics.stats_models", dir], { encoding: "utf8", maxBuffer: 1 << 26 })
    ) as Array<{ id: string; features: number[] }>
    const frames = new Map<number, Frame>()
    const events: DomainEvent[] = []
    let s = initMatch(cfg)
    while (!isFinished(s)) {
      const r = step(s)
      s = r.state
      events.push(...r.events)
      if (r.frame) frames.set(r.frame.tick, r.frame)
    }
    const byId = new Map(events.map((e) => [e.id, e]))
    expect(py.length).toBeGreaterThan(500)
    for (const row of py) {
      const e = byId.get(row.id)!
      const f = frames.get(e.frame_id)!
      const home = e.team_id === cfg.home.id
      const opp = home ? f.away : f.home
      const ts =
        e.type === "pass"
          ? passFeatures({ x: e.x!, y: e.y! }, { x: e.x_end!, y: e.y_end! }, home ? 1 : -1, opp)
          : shotFeatures({ x: e.x!, y: e.y! }, home ? 1 : -1, e.attrs.body_part === "head", opp)
      ts.forEach((v, i) => expect(v, `${row.id}[${i}]`).toBeCloseTo(row.features[i]!, 9))
    }
  })
})
```

Create `packages/stats/test/catalog.test.ts`:

```ts
import { describe, expect, it } from "vitest"
import { MetricId } from "@touchline/schema"
import { METRICS, metricDef } from "../src/catalog.js"

describe("metric catalog", () => {
  it("describes every schema metric id exactly once", () => {
    expect(METRICS.map((m) => m.id).sort()).toEqual([...MetricId.literals].sort())
  })
  it("gives a default window only to windowed metrics", () => {
    for (const m of METRICS) if (m.defaultWindowS !== null) expect(m.windowed, m.id).toBe(true)
    expect(metricDef("team.press")?.defaultWindowS).toBe(300)
    expect(metricDef("nope")).toBeUndefined()
  })
})
```

Apply this change to `packages/schema/test/schema.test.ts` (from the repository root):

```bash
git apply <<'PATCH'
diff --git a/packages/schema/test/schema.test.ts b/packages/schema/test/schema.test.ts
index 1dc8af1..5b7c133 100644
--- a/packages/schema/test/schema.test.ts
+++ b/packages/schema/test/schema.test.ts
@@ -1,6 +1,7 @@
 import { describe, expect, it } from "vitest"
 import { initMatch, isFinished, step, type DomainEvent as SimEvent, type Frame as SimFrame } from "@touchline/sim-core"
 import { decodeDomainEvent, decodeFrame } from "../src/domain.js"
+import { decodeSignal } from "../src/stats.js"
 import { makeConfig } from "@touchline/sim-core/testing"
 
 describe("domain schema", () => {
@@ -15,4 +16,13 @@ describe("domain schema", () => {
   it("rejects an unknown event type", () => {
     expect(() => decodeDomainEvent({ type: "dance" })).toThrow()
   })
+  it("decodes a signal and rejects an unknown metric id", () => {
+    const signal = {
+      id: "m-1-s1", match_id: "m-1", type: "big_chance", frame_id: 120, frame_from: 110, frame_to: 120, period: "first_half", match_clock: "00:12.00",
+      team_id: "ironmoor", player_id: "p-iro-09", metric: "shot.xg", value: 0.41, salience: 0.7, evidence: ["m-1-e12"], data: { "shot.xg": 0.41 }
+    }
+    expect(decodeSignal(signal).value).toBe(0.41)
+    expect(() => decodeSignal({ ...signal, metric: "shot.vibes" })).toThrow()
+    expect(decodeSignal({ ...signal, type: "card", metric: null, value: null }).metric).toBeNull()
+  })
 })
PATCH
```

- [ ] **Step 2: Run them to make sure they fail**

Run: `pnpm --filter @touchline/stats test`
Expected: both test files fail to load: `Cannot find module '../src/catalog.js'` and `'../src/models.js'`

Run: `pnpm --filter @touchline/schema test`
Expected: the file fails to load: `Cannot find module '../src/stats.js'`

- [ ] **Step 3: Write the schema, the catalog and the models**

Create `packages/schema/src/stats.ts`:

```ts
import { Schema } from "effect"

/** Stable metric ids (spec §5.2); agents cite them in every numeric claim. */
export const MetricId = Schema.Literals([
  "pass.dist", "pass.acc", "pass.xp", "ball.speed", "shot.speed", "plyr.vmax", "plyr.dist", "shot.xg",
  "team.mom", "team.press", "ppda", "tilt", "game.chaos", "team.poss"
])
export type MetricId = typeof MetricId.Type

export const SignalType = Schema.Literals([
  "goal", "big_chance", "pressure_shift", "momentum_swing", "chaos_spike", "speed_alert", "distance_milestone",
  "difficult_pass_completed", "player_milestone", "card", "substitution_impact"
])
export type SignalType = typeof SignalType.Type

/** A threshold crossing raised by the stats engine; the Moment Detector ranks signals into moments. */
export const Signal = Schema.Struct({
  id: Schema.String,
  match_id: Schema.String,
  type: SignalType,
  /** Global tick at which the signal was raised. */
  frame_id: Schema.Int,
  /** Global ticks of the play the signal describes. */
  frame_from: Schema.Int,
  frame_to: Schema.Int,
  period: Schema.Literals(["first_half", "second_half"]),
  match_clock: Schema.String,
  team_id: Schema.NullOr(Schema.String),
  player_id: Schema.NullOr(Schema.String),
  /** The metric the signal is about and its value, when there is one (a card has none). */
  metric: Schema.NullOr(MetricId),
  value: Schema.NullOr(Schema.Finite),
  /** 0..1: how notable the signal is on its own (the fallback ranking when no model is available). */
  salience: Schema.Finite,
  /** Event ids and metric references (`metric@from-to`) that support the signal. */
  evidence: Schema.Array(Schema.String),
  data: Schema.Record(Schema.String, Schema.Finite)
})
export type Signal = typeof Signal.Type

export const decodeSignal = Schema.decodeUnknownSync(Signal)
```

Apply this change to `packages/schema/src/index.ts` (from the repository root):

```bash
git apply <<'PATCH'
diff --git a/packages/schema/src/index.ts b/packages/schema/src/index.ts
index 7189947..049a676 100644
--- a/packages/schema/src/index.ts
+++ b/packages/schema/src/index.ts
@@ -1 +1,2 @@
 export * from "./domain.js"
+export * from "./stats.js"
PATCH
```

Create `packages/stats/src/catalog.ts`:

```ts
import type { MetricId } from "@touchline/schema"

/** What a metric can be asked about: one player, one team, or the whole match. */
export type SubjectKind = "player" | "team" | "match"

export interface MetricDef {
  readonly id: MetricId
  readonly name: string
  readonly unit: string
  readonly subjects: ReadonlyArray<SubjectKind>
  /** Whether a query can restrict the metric to the last `window` seconds. */
  readonly windowed: boolean
  /** The window used when a query gives none (null: the match so far). */
  readonly defaultWindowS: number | null
  readonly description: string
}

/** The metric catalog (spec §5.2). Ids are stable; agents must cite them. */
export const METRICS: ReadonlyArray<MetricDef> = [
  { id: "pass.dist", name: "Pass distance", unit: "m", subjects: ["player", "team"], windowed: true, defaultWindowS: null, description: "Mean length of attempted passes (start to where the ball was next played)." },
  { id: "pass.acc", name: "Pass accuracy", unit: "share", subjects: ["player", "team"], windowed: true, defaultWindowS: null, description: "Share of attempted passes completed." },
  { id: "pass.xp", name: "Pass difficulty (xPass)", unit: "probability", subjects: ["player", "team"], windowed: true, defaultWindowS: null, description: "Mean modelled completion probability of attempted passes (logistic model fitted on IDSSE: length, forward progress, defenders in lane, pressure); lower means harder passes." },
  { id: "ball.speed", name: "Ball speed", unit: "km/h", subjects: ["match"], windowed: false, defaultWindowS: null, description: "Ball speed over the last 0.2 s, from tracking." },
  { id: "shot.speed", name: "Shot speed", unit: "km/h", subjects: ["player", "team"], windowed: true, defaultWindowS: null, description: "Mean peak ball speed in the 0.3 s after a shot, from tracking." },
  { id: "plyr.vmax", name: "Top speed", unit: "km/h", subjects: ["player"], windowed: true, defaultWindowS: null, description: "Highest speed over any 0.5 s, from tracking." },
  { id: "plyr.dist", name: "Distance covered", unit: "m", subjects: ["player", "team"], windowed: true, defaultWindowS: null, description: "Distance run, from tracking (a team's is the sum of its players')." },
  { id: "shot.xg", name: "Expected goals", unit: "xG", subjects: ["player", "team"], windowed: true, defaultWindowS: null, description: "Sum of shot xG (logistic model fitted on IDSSE: distance, angle, header, defenders in the shot cone; penalties 0.76)." },
  { id: "team.mom", name: "Momentum", unit: "share", subjects: ["team"], windowed: false, defaultWindowS: null, description: "The team's share of attacking threat, exponentially decayed (2-minute half-life): forward progress of completed passes and carries towards goal, plus shot xG." },
  { id: "team.press", name: "Pressure index", unit: "share", subjects: ["team"], windowed: true, defaultWindowS: 300, description: "Pressures by the team / (pressures + opponent passes)." },
  { id: "ppda", name: "PPDA", unit: "passes per action", subjects: ["team"], windowed: true, defaultWindowS: null, description: "Opponent passes in their own 60 % of the pitch per defensive action there (tackles, interceptions, fouls)." },
  { id: "tilt", name: "Field tilt", unit: "share", subjects: ["team"], windowed: true, defaultWindowS: null, description: "The team's share of passes made in the attacking third." },
  { id: "game.chaos", name: "Control vs chaos", unit: "index 0..1", subjects: ["match"], windowed: false, defaultWindowS: null, description: "Last 5 minutes: turnover rate, short possession chains and momentum volatility, each scaled to 0..1 and averaged." },
  { id: "team.poss", name: "Possession", unit: "share", subjects: ["team"], windowed: true, defaultWindowS: null, description: "Share of in-play time the team had the ball, from tracking." }
]

export const metricDef = (id: string): MetricDef | undefined => METRICS.find((m) => m.id === id)
```

Create `packages/stats/src/models.ts`:

```ts
/**
 * Pass-difficulty (xPass) and expected-goals (xG) models: a line-for-line port of the feature definitions in
 * python/analytics/touchline_analytics/stats_models.py, with coefficients fitted there on IDSSE
 * (data/params/stats-models.json). A parity test runs both on one synthetic match.
 */
import { PITCH, type Vec2 } from "@touchline/sim-core"

export const LANE_WIDTH_M = 2
export const PRESS_RADIUS_M = 5
const MAX_COUNT = 3
export const XPASS_FEATURES = ["length_10m", "forward_10m", "lane_defenders", "pressure"] as const
export const XG_FEATURES = ["distance_10m", "angle_rad", "header", "cone_defenders"] as const

export interface LogisticModel {
  readonly intercept: number
  readonly coefficients: ReadonlyArray<number>
}

export interface StatsModels {
  readonly version: string
  readonly xpass: LogisticModel
  readonly xg: LogisticModel & { readonly penalty: number }
}

export class ModelsError extends Error {}

const logistic = (raw: unknown, names: ReadonlyArray<string>, label: string): LogisticModel => {
  const m = raw as { intercept?: unknown; coefficients?: Record<string, unknown>; features?: unknown }
  if (typeof m?.intercept !== "number" || !Number.isFinite(m.intercept)) throw new ModelsError(`${label}.intercept must be a finite number`)
  if (JSON.stringify(m.features) !== JSON.stringify(names)) throw new ModelsError(`${label}.features must be ${JSON.stringify(names)}`)
  const coefficients = names.map((n) => {
    const v = m.coefficients?.[n]
    if (typeof v !== "number" || !Number.isFinite(v)) throw new ModelsError(`${label}.coefficients.${n} must be a finite number`)
    return v
  })
  return { intercept: m.intercept, coefficients }
}

/** Read data/params/stats-models.json; throws ModelsError naming the first bad field. */
export const modelsFromJson = (raw: unknown): StatsModels => {
  const j = raw as { version?: unknown; xpass?: unknown; xg?: { penalty?: unknown } }
  if (typeof j?.version !== "string") throw new ModelsError("version must be a string")
  const penalty = j.xg?.penalty
  if (typeof penalty !== "number" || !(penalty > 0 && penalty < 1)) throw new ModelsError("xg.penalty must be a number between 0 and 1")
  return { version: j.version, xpass: logistic(j.xpass, XPASS_FEATURES, "xpass"), xg: { ...logistic(j.xg, XG_FEATURES, "xg"), penalty } }
}

const segmentDistance = (a: Vec2, b: Vec2, q: Vec2): { d: number; t: number } => {
  const vx = b.x - a.x
  const vy = b.y - a.y
  const l2 = vx * vx + vy * vy
  const t = l2 < 1e-9 ? 0 : Math.max(0, Math.min(1, ((q.x - a.x) * vx + (q.y - a.y) * vy) / l2))
  return { d: Math.hypot(a.x + t * vx - q.x, a.y + t * vy - q.y), t }
}

/** Opponents within 2 m of the pass line, away from both ends (5 %-95 % of the way), at most 3. */
export const laneDefenders = (start: Vec2, end: Vec2, opponents: ReadonlyArray<Vec2>): number => {
  let n = 0
  for (const o of opponents) {
    const { d, t } = segmentDistance(start, end, o)
    if (d < LANE_WIDTH_M && t > 0.05 && t < 0.95) n++
  }
  return Math.min(n, MAX_COUNT)
}

/** 1 with an opponent on the ball, falling linearly to 0 at 5 m. */
export const pressureAt = (at: Vec2, opponents: ReadonlyArray<Vec2>): number => {
  if (opponents.length === 0) return 0
  let near = Infinity
  for (const o of opponents) near = Math.min(near, Math.hypot(o.x - at.x, o.y - at.y))
  return Math.max(0, 1 - near / PRESS_RADIUS_M)
}

/** length / 10 m, forward progress / 10 m (`attack` = +1 when attacking +x), lane defenders, pressure. */
export const passFeatures = (start: Vec2, end: Vec2, attack: 1 | -1, opponents: ReadonlyArray<Vec2>): number[] => [
  Math.hypot(end.x - start.x, end.y - start.y) / 10,
  (attack * (end.x - start.x)) / 10,
  laneDefenders(start, end, opponents),
  pressureAt(start, opponents)
]

/** Angle (radians) the goal mouth subtends from `at`. */
export const goalAngle = (at: Vec2, attack: 1 | -1): number => {
  const gx = attack * PITCH.halfL
  const a1 = Math.atan2(PITCH.goalHalfWidth - at.y, gx - at.x)
  const a2 = Math.atan2(-PITCH.goalHalfWidth - at.y, gx - at.x)
  const d = Math.abs(a1 - a2)
  return d > Math.PI ? 2 * Math.PI - d : d
}

const side = (p1: Vec2, p2: Vec2, p3: Vec2) => (p1.x - p3.x) * (p2.y - p3.y) - (p2.x - p3.x) * (p1.y - p3.y)
const inTriangle = (p: Vec2, a: Vec2, b: Vec2, c: Vec2): boolean => {
  const d1 = side(p, a, b)
  const d2 = side(p, b, c)
  const d3 = side(p, c, a)
  return !((d1 < 0 || d2 < 0 || d3 < 0) && (d1 > 0 || d2 > 0 || d3 > 0))
}

/** Opponents inside the triangle from the shooter to both posts, the goalkeeper (the opponent nearest the goal centre) excepted, at most 3. */
export const coneDefenders = (at: Vec2, attack: 1 | -1, opponents: ReadonlyArray<Vec2>): number => {
  if (opponents.length === 0) return 0
  const gx = attack * PITCH.halfL
  let keeper = 0
  opponents.forEach((o, i) => {
    if (Math.hypot(o.x - gx, o.y) < Math.hypot(opponents[keeper]!.x - gx, opponents[keeper]!.y)) keeper = i
  })
  const p1 = { x: gx, y: PITCH.goalHalfWidth }
  const p2 = { x: gx, y: -PITCH.goalHalfWidth }
  let n = 0
  opponents.forEach((o, i) => {
    if (i !== keeper && inTriangle(o, at, p1, p2)) n++
  })
  return Math.min(n, MAX_COUNT)
}

/** distance to the goal centre / 10 m, goal-mouth angle, header (0/1), defenders in the shot cone. */
export const shotFeatures = (at: Vec2, attack: 1 | -1, header: boolean, opponents: ReadonlyArray<Vec2>): number[] => [
  Math.hypot(attack * PITCH.halfL - at.x, at.y) / 10,
  goalAngle(at, attack),
  header ? 1 : 0,
  coneDefenders(at, attack, opponents)
]

const sigmoid = (z: number) => (z >= 0 ? 1 / (1 + Math.exp(-z)) : Math.exp(z) / (1 + Math.exp(z)))

export const predict = (m: LogisticModel, x: ReadonlyArray<number>): number => {
  let z = m.intercept
  m.coefficients.forEach((c, i) => (z += c * x[i]!))
  return sigmoid(z)
}
```

Create `packages/stats/src/index.ts`:

```ts
export * from "./catalog.js"
export * from "./models.js"
```

- [ ] **Step 4: Run the tests, including parity**

Run: `pnpm --filter @touchline/stats test && pnpm --filter @touchline/schema test`
Expected: 9 passed (parity: features identical to 9 decimals for every pass and shot of seed 4243, more than 500 rows); 3 passed

Run: `pnpm turbo run typecheck test --force`
Expected: `Tasks: 12 successful`

- [ ] **Step 5: Commit**

```bash
git add packages/schema packages/stats pnpm-lock.yaml
git commit -m "feat(stats): metric catalog, signal schema, xPass and xG models with Python parity

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```



### Task 3: Engine core: time-indexed store, kinematics, speed and distance signals

The engine takes the domain stream one input at a time: events and tracking frames, in tick order. An event's tick is `emittedAt`, the tick at which its outcome became known (`max(frame_id, frame_id_end)`): the simulator emits each event in the step of that tick, before the frame, except that a carry cut short by the whistle, `period_end` and `match_end` come just after the period's last frame. So an event may arrive after its own tick's frame, never after a later one; anything older is refused (`StatsError`). Every value is stamped with its tick: running totals (`Counters`; a windowed value is a difference of two totals) and step functions (`Series`), and every read takes a tick and looks only at or before it. From frames: distance per player and team (steps faster than 12 m/s are jumps, not running), speed over 0.5 s and top speed (exact over any window), ball speed over 0.2 s, possession share of in-play time. Signals: a speed alert at the peak of each sprint over 30 km/h, but only if it beats that player's last alert by 0.5 km/h (players top 30-32 km/h, so alerting every crossing would flood); distance milestones at 10 and 12 km. Signal ids are built from type, tick and subject, so they do not depend on arrival order within a tick.

**Files:**
- Create: `packages/stats/src/store.ts`, `packages/stats/src/input.ts`, `packages/stats/src/engine.ts`
- Modify: `packages/stats/src/index.ts`
- Test: `packages/stats/test/helpers.ts`, `packages/stats/test/kinematics.test.ts`

**Interfaces:**
- Consumes: Task 2's `metricDef`, `StatsModels`; sim-core `matchClock`.
- Produces: `class Series {push(tick, v), indexAt(tick), at(tick, otherwise?), last(otherwise?)}`, `class Counters {add(counter, subject, tick, delta), total(counter, subject, tick), between(counter, subject, from | null, to)}`, `maxBetween(series, from | null, to)`; `interface TrackPlayer {id, x, y}`, `interface TrackFrame {tick, frame_id, period, home, away, ball, ball_in_play, possession_side}`, `type StatsInput = {kind: "event", event} | {kind: "frame", frame}`, `emittedAt(e)`, `interface PlayerInfo {id, name, role, jersey}`, `interface TeamInfo {id, name, side, players}`, `interface MatchInfo {matchId, dt, home, away}`, `infoFromConfig(cfg)`; `class StatsError`, `SPRINT_KMH = 30`, `SPRINT_ALERT_STEP_KMH`, `DISTANCE_MILESTONES_M`, `interface QueryOptions {at?, windowS?}`, `class StatsEngine(info, models)` with `signals`, `events`, `eventTicks`, `now`, `frame`, `teamOf(id)`, `team(id)`, `ticks(seconds)`, `ingest(input): Signal[]`, `subjectKind(subject)`, `value(metric, subject, opts?)`; protected hooks `onEvent`, `onFrame`, `raise`, `windowFrom`, `compute`, `ballSpeedMax`, `counters`.

- [ ] **Step 1: Write the failing tests**

Create `packages/stats/test/helpers.ts`:

```ts
import { readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import type { DomainEvent } from "@touchline/schema"
import type { MatchInfo, TrackFrame, TrackPlayer } from "../src/input.js"
import { modelsFromJson, type StatsModels } from "../src/models.js"

export const root = join(dirname(fileURLToPath(import.meta.url)), "../../..")
export const models = (): StatsModels => modelsFromJson(JSON.parse(readFileSync(join(root, "data/params/stats-models.json"), "utf8")))

/** Two teams of three: a keeper and two outfielders each. */
export const INFO: MatchInfo = {
  matchId: "t",
  dt: 0.1,
  home: { id: "home-fc", name: "Home", side: "home", players: [{ id: "h1", name: "H One", role: "GK", jersey: 1 }, { id: "h2", name: "H Two", role: "CM", jersey: 8 }, { id: "h3", name: "H Three", role: "ST", jersey: 9 }] },
  away: { id: "away-fc", name: "Away", side: "away", players: [{ id: "a1", name: "A One", role: "GK", jersey: 1 }, { id: "a2", name: "A Two", role: "CB", jersey: 4 }, { id: "a3", name: "A Three", role: "ST", jersey: 9 }] }
}

const at = (x: number, y = 0) => ({ x, y })
/** Everyone standing still at their default spots, with the given overrides. */
export const frame = (tick: number, over: Partial<Record<string, { x: number; y: number }>> = {}, extra: Partial<TrackFrame> = {}): TrackFrame => {
  const spots: Record<string, { x: number; y: number }> = { h1: at(-50), h2: at(-10, 5), h3: at(5, -5), a1: at(50), a2: at(20, 3), a3: at(-5, 5) }
  const players = (ids: string[]): TrackPlayer[] => ids.map((id) => ({ id, ...(over[id] ?? spots[id]!) }))
  return {
    tick,
    frame_id: tick,
    period: "first_half",
    home: players(["h1", "h2", "h3"]),
    away: players(["a1", "a2", "a3"]),
    ball: { x: 0, y: 0, z: 0 },
    ball_in_play: true,
    possession_side: "home",
    ...extra
  }
}

let seq = 0
/** A domain event with defaults (first half, frame id = tick). */
export const event = (type: DomainEvent["type"], tick: number, fields: Partial<DomainEvent> = {}): DomainEvent => ({
  id: `t-e${++seq}`,
  match_id: "t",
  type,
  frame_id: tick,
  period_frame_id: tick,
  period: "first_half",
  match_clock: "00:00.00",
  team_id: null,
  player_id: null,
  x: null,
  y: null,
  x_end: null,
  y_end: null,
  frame_id_end: null,
  outcome: null,
  source: "sim",
  confidence: 1,
  attrs: {},
  ...fields
})
```

Create `packages/stats/test/kinematics.test.ts`:

```ts
import { describe, expect, it } from "vitest"
import { initMatch, isFinished, step } from "@touchline/sim-core"
import { makeConfig } from "@touchline/sim-core/testing"
import { StatsEngine, StatsError } from "../src/engine.js"
import { infoFromConfig } from "../src/input.js"
import { event, frame, INFO, models } from "./helpers.js"

/** Player h2 runs along x at `speeds[i]` m/s during second i (10 ticks per second). */
const run = (eng: StatsEngine, speeds: number[], startTick = 0) => {
  let x = -10
  let tick = startTick
  eng.ingest({ kind: "frame", frame: frame(tick, { h2: { x, y: 5 } }) })
  for (const v of speeds)
    for (let k = 0; k < 10; k++) {
      x += v / 10
      eng.ingest({ kind: "frame", frame: frame(++tick, { h2: { x, y: 5 } }) })
    }
  return tick
}

describe("kinematics", () => {
  it("measure distance and top speed from positions", () => {
    const eng = new StatsEngine(INFO, models())
    run(eng, Array(10).fill(8))
    expect(eng.value("plyr.dist", "h2")).toBeCloseTo(80, 9)
    expect(eng.value("plyr.dist", "home-fc")).toBeCloseTo(80, 9)
    expect(eng.value("plyr.dist", "h3")).toBe(0)
    expect(eng.value("plyr.vmax", "h2")).toBeCloseTo(28.8, 9)
    expect(eng.value("plyr.vmax", "h3")).toBe(0)
    expect(eng.signals).toEqual([])
  })

  it("restrict distance and top speed to a window", () => {
    const eng = new StatsEngine(INFO, models())
    run(eng, [...Array(5).fill(9), ...Array(5).fill(2)])
    expect(eng.value("plyr.dist", "h2", { windowS: 3 })).toBeCloseTo(6, 9)
    expect(eng.value("plyr.vmax", "h2", { windowS: 3 })).toBeCloseTo(7.2, 9)
    expect(eng.value("plyr.vmax", "h2")).toBeCloseTo(32.4, 9)
  })

  it("measure the same speeds and distances at 25 frames per second", () => {
    const eng = new StatsEngine({ ...INFO, dt: 0.04 }, models())
    let x = -10
    eng.ingest({ kind: "frame", frame: frame(0, { h2: { x, y: 5 } }) })
    // 5 s at 8 m/s, 5 s at 9.2 m/s, then standing still.
    for (let t = 1; t <= 300; t++) {
      if (t <= 250) x += (t <= 125 ? 8 : 9.2) * 0.04
      eng.ingest({ kind: "frame", frame: frame(t, { h2: { x, y: 5 } }) })
    }
    expect(eng.ticks(10)).toBe(250)
    expect(eng.value("plyr.dist", "h2")).toBeCloseTo(5 * 8 + 5 * 9.2, 9)
    expect(eng.value("plyr.dist", "h2", { at: 250, windowS: 2 })).toBeCloseTo(2 * 9.2, 9)
    expect(eng.value("plyr.vmax", "h2")).toBeCloseTo(9.2 * 3.6, 9)
    expect(eng.signals.filter((s) => s.type === "speed_alert").map((s) => s.value)).toEqual([33.1])
  })

  it("ignore jumps between frames (half-time resets, substitutions)", () => {
    const eng = new StatsEngine(INFO, models())
    eng.ingest({ kind: "frame", frame: frame(0, { h2: { x: 0, y: 0 } }) })
    eng.ingest({ kind: "frame", frame: frame(1, { h2: { x: 30, y: 0 } }) })
    eng.ingest({ kind: "frame", frame: frame(5, { h2: { x: 30.5, y: 0 } }) })
    expect(eng.value("plyr.dist", "h2")).toBe(0)
  })

  it("alert once per sprint over 30 km/h, at its peak, and again only for a faster one", () => {
    const eng = new StatsEngine(INFO, models())
    const end = run(eng, [6, 9, 9.2, 9, 5, 9, 9, 5, 9.5, 9.5, 4])
    const alerts = eng.signals.filter((s) => s.type === "speed_alert")
    expect(alerts.map((s) => s.value)).toEqual([33.1, 34.2])
    expect(alerts[0]).toMatchObject({ player_id: "h2", team_id: "home-fc", metric: "plyr.vmax", match_id: "t" })
    expect(alerts[0]!.frame_from).toBeLessThan(alerts[0]!.frame_to)
    expect(alerts[1]!.data.previous_best).toBe(33.1)
    expect(alerts[1]!.frame_id).toBeLessThanOrEqual(end)
  })

  it("raise distance milestones at 10 and 12 km", () => {
    const eng = new StatsEngine(INFO, models())
    // 7.5 m/s for 1,700 s covers 12.75 km.
    run(eng, Array(1700).fill(7.5))
    const m = eng.signals.filter((s) => s.type === "distance_milestone")
    expect(m.map((s) => [s.player_id, s.value])).toEqual([["h2", 10_000], ["h2", 12_000]])
  })

  it("measure possession over in-play time only", () => {
    const eng = new StatsEngine(INFO, models())
    for (let t = 0; t < 30; t++) eng.ingest({ kind: "frame", frame: frame(t, {}, { possession_side: t < 20 ? "home" : "away", ball_in_play: t % 10 !== 9 }) })
    expect(eng.value("team.poss", "home-fc")).toBeCloseTo(18 / 27, 9)
    expect(eng.value("team.poss", "away-fc")).toBeCloseTo(9 / 27, 9)
    expect(eng.value("team.poss", "away-fc", { at: 10 })).toBe(0)
  })

  it("refuse unknown subjects, metrics a subject does not have, and input out of order", () => {
    const eng = new StatsEngine(INFO, models())
    eng.ingest({ kind: "frame", frame: frame(5) })
    expect(() => eng.value("plyr.dist", "nobody")).toThrow(StatsError)
    expect(() => eng.value("plyr.vmax", "home-fc")).toThrow(/not defined for a team/)
    expect(() => eng.ingest({ kind: "frame", frame: frame(5) })).toThrow(/out of order/)
    expect(() => eng.ingest({ kind: "event", event: event("pressure", 4) })).toThrow(/out of order/)
    // An event of the frame's own tick may follow it (the simulator emits a carry cut short by the whistle that way).
    expect(() => eng.ingest({ kind: "event", event: event("pressure", 5) })).not.toThrow()
    expect(() => eng.ingest({ kind: "event", event: event("pressure", 6) })).not.toThrow()
    expect(() => eng.ingest({ kind: "frame", frame: frame(5) })).toThrow(/out of order/)
  })

  it("take a whole simulated match in emission order and give plausible totals", () => {
    const cfg = makeConfig(7)
    const eng = new StatsEngine(infoFromConfig(cfg), models())
    let s = initMatch(cfg)
    const t0 = performance.now()
    while (!isFinished(s)) {
      const r = step(s)
      s = r.state
      for (const e of r.events) eng.ingest({ kind: "event", event: e })
      if (r.frame) eng.ingest({ kind: "frame", frame: r.frame })
    }
    const perTickMs = (performance.now() - t0) / eng.now
    const dists = cfg.home.starters.slice(1).map((p) => eng.value("plyr.dist", p.id)!)
    const median = [...dists].sort((a, b) => a - b)[5]!
    expect(median).toBeGreaterThan(8_000)
    expect(median).toBeLessThan(13_000)
    expect(eng.value("team.poss", cfg.home.id)! + eng.value("team.poss", cfg.away.id)!).toBeGreaterThan(0.95)
    expect(eng.value("ball.speed", "match")).not.toBeNull()
    // The hot path's budget is 250 ms per event; the engine costs far less than a millisecond per tick.
    expect(perTickMs).toBeLessThan(1)
  })
})
```

- [ ] **Step 2: Run them to make sure they fail**

Run: `pnpm --filter @touchline/stats test kinematics`
Expected: the file fails to load: `Cannot find module '../src/engine.js'`

- [ ] **Step 3: Write the store, the inputs and the engine**

Create `packages/stats/src/store.ts`:

```ts
/**
 * Time-indexed storage. Every value is stamped with the tick at which it became known, and every read takes a
 * tick and looks only at or before it, so a query "as of tick t" gives the same answer whether the engine has
 * ingested up to t or the whole match.
 */

/** A step function of the tick: the last value pushed at or before a tick. */
export class Series {
  readonly ticks: number[] = []
  readonly values: number[] = []

  push(tick: number, value: number): void {
    const n = this.ticks.length
    if (n > 0 && this.ticks[n - 1] === tick) this.values[n - 1] = value
    else {
      this.ticks.push(tick)
      this.values.push(value)
    }
  }

  /** Index of the last entry at or before `tick`, or -1. */
  indexAt(tick: number): number {
    let lo = 0
    let hi = this.ticks.length - 1
    let best = -1
    while (lo <= hi) {
      const mid = (lo + hi) >> 1
      if (this.ticks[mid]! <= tick) {
        best = mid
        lo = mid + 1
      } else hi = mid - 1
    }
    return best
  }

  at(tick: number, otherwise = 0): number {
    const i = this.indexAt(tick)
    return i < 0 ? otherwise : this.values[i]!
  }

  last(otherwise = 0): number {
    return this.values.length ? this.values[this.values.length - 1]! : otherwise
  }
}

/** Running totals per (counter, subject); a windowed total is a difference of two running totals. */
export class Counters {
  private readonly series = new Map<string, Series>()

  private get(counter: string, subject: string): Series {
    const k = `${counter}|${subject}`
    let s = this.series.get(k)
    if (!s) this.series.set(k, (s = new Series()))
    return s
  }

  add(counter: string, subject: string, tick: number, delta: number): void {
    const s = this.get(counter, subject)
    s.push(tick, s.last() + delta)
  }

  /** Total up to and including `tick`. */
  total(counter: string, subject: string, tick: number): number {
    return this.series.get(`${counter}|${subject}`)?.at(tick) ?? 0
  }

  /** Total over the ticks (from, to]; `from` = null means since kickoff. */
  between(counter: string, subject: string, from: number | null, to: number): number {
    return this.total(counter, subject, to) - (from === null ? 0 : this.total(counter, subject, from))
  }
}

/** Maximum of a Series' values over the ticks (from, to]; null with no data there. */
export const maxBetween = (s: Series | undefined, from: number | null, to: number): number | null => {
  if (!s) return null
  let best: number | null = null
  for (let i = s.indexAt(to); i >= 0 && (from === null || s.ticks[i]! > from); i--) best = Math.max(best ?? -Infinity, s.values[i]!)
  return best
}
```

Create `packages/stats/src/input.ts`:

```ts
import type { DomainEvent } from "@touchline/schema"
import type { MatchConfig, Role } from "@touchline/sim-core"

/** A tracking frame as the stats engine needs it (the simulator's Frame fits; replays rebuild it from CDF). */
export interface TrackPlayer {
  readonly id: string
  readonly x: number
  readonly y: number
}
export interface TrackFrame {
  /** Global tick (counts across periods). */
  readonly tick: number
  /** Frame id within the period. */
  readonly frame_id: number
  readonly period: "first_half" | "second_half"
  readonly home: ReadonlyArray<TrackPlayer>
  readonly away: ReadonlyArray<TrackPlayer>
  readonly ball: { readonly x: number; readonly y: number; readonly z: number }
  readonly ball_in_play: boolean
  readonly possession_side: "home" | "away" | null
}

export type StatsInput = { readonly kind: "event"; readonly event: DomainEvent } | { readonly kind: "frame"; readonly frame: TrackFrame }

/**
 * The tick at which an event's outcome became known (the end of a pass's flight, of a carry). The simulator emits
 * each event in the step of that tick, before its frame, or just after the frame when the period ends (a carry cut
 * short by the whistle, period_end, match_end); the engine treats both orders alike.
 */
export const emittedAt = (e: Pick<DomainEvent, "frame_id" | "frame_id_end">): number => Math.max(e.frame_id, e.frame_id_end ?? e.frame_id)

export interface PlayerInfo {
  readonly id: string
  readonly name: string
  readonly role: Role
  readonly jersey: number
}
export interface TeamInfo {
  readonly id: string
  readonly name: string
  readonly side: "home" | "away"
  /** Starters, then substitutes. */
  readonly players: ReadonlyArray<PlayerInfo>
}
export interface MatchInfo {
  readonly matchId: string
  /** Seconds per tick. */
  readonly dt: number
  readonly home: TeamInfo
  readonly away: TeamInfo
}

type Named = { readonly id: string; readonly role: Role; readonly jersey: number; readonly name?: string }

export const infoFromConfig = (cfg: MatchConfig): MatchInfo => {
  const team = (side: "home" | "away"): TeamInfo => {
    const t = cfg[side]
    const players = [...t.starters, ...(t.bench ?? [])] as ReadonlyArray<Named>
    return { id: t.id, name: t.name, side, players: players.map((p) => ({ id: p.id, name: p.name ?? p.id, role: p.role, jersey: p.jersey })) }
  }
  return { matchId: cfg.matchId, dt: cfg.dt, home: team("home"), away: team("away") }
}
```

Create `packages/stats/src/engine.ts`:

```ts
import type { DomainEvent, MetricId, Signal, SignalType } from "@touchline/schema"
import { matchClock } from "@touchline/sim-core"
import { metricDef, type SubjectKind } from "./catalog.js"
import { emittedAt, type MatchInfo, type StatsInput, type TeamInfo, type TrackFrame } from "./input.js"
import type { StatsModels } from "./models.js"
import { Counters, maxBetween, Series } from "./store.js"

/** A query the engine cannot answer (unknown subject, metric not defined for it) or input out of order. */
export class StatsError extends Error {}

export const SPRINT_KMH = 30
/** A new speed alert for a player needs a sprint at least this much faster than their last alert. */
export const SPRINT_ALERT_STEP_KMH = 0.5
export const DISTANCE_MILESTONES_M = [10_000, 12_000] as const
/** Faster than this between frames is a jump (half-time reset, substitution), not running. */
const MAX_RUN_MS = 12
const MAX_BALL_KMH = 200

export interface QueryOptions {
  /** Global tick to answer at (default: the latest ingested). */
  readonly at?: number
  /** Restrict a windowed metric to the last `windowS` seconds (default: the metric's default window). */
  readonly windowS?: number | null
}

interface Sprint {
  readonly from: number
  peak: number
  to: number
}

interface Pos {
  readonly tick: number
  readonly period: string
  readonly x: number
  readonly y: number
  readonly z: number
}

/**
 * The stats engine (spec §5.2): incremental and deterministic. Feed it the domain stream with `ingest` in tick
 * order (an event's tick is `emittedAt`; events of a tick may come before or after its frame); it keeps every
 * metric as of every tick and returns the signals each input raises.
 */
export class StatsEngine {
  readonly signals: Signal[] = []
  readonly events: DomainEvent[] = []
  /** Emission tick of each stored event (index-aligned with `events`). */
  readonly eventTicks: number[] = []
  protected readonly counters = new Counters()
  private readonly speeds = new Map<string, Series>()
  private readonly vmax = new Map<string, Series>()
  private readonly ballSpeed = new Series()
  private readonly recent = new Map<string, Pos[]>()
  private ballRecent: Pos[] = []
  private readonly sprints = new Map<string, Sprint>()
  private readonly alertBest = new Map<string, number>()
  private readonly teamByPlayer = new Map<string, TeamInfo>()
  private readonly teamById = new Map<string, TeamInfo>()
  private readonly speedWindow: number
  private readonly ballWindow: number
  private lastFrameTick = -1
  private lastEventTick = -1
  private lastFrame: TrackFrame | null = null
  private readonly signalIds = new Set<string>()

  constructor(
    readonly info: MatchInfo,
    readonly models: StatsModels
  ) {
    for (const t of [info.home, info.away]) {
      this.teamById.set(t.id, t)
      for (const p of t.players) this.teamByPlayer.set(p.id, t)
    }
    this.speedWindow = Math.max(1, Math.round(0.5 / info.dt))
    this.ballWindow = Math.max(1, Math.round(0.2 / info.dt))
  }

  /** The latest tick ingested. */
  get now(): number {
    return Math.max(this.lastFrameTick, this.lastEventTick)
  }

  /** The frame of the latest tick ingested, if any. */
  get frame(): TrackFrame | null {
    return this.lastFrame
  }

  teamOf(playerId: string): TeamInfo | undefined {
    return this.teamByPlayer.get(playerId)
  }

  team(teamId: string): TeamInfo | undefined {
    return this.teamById.get(teamId)
  }

  ticks(seconds: number): number {
    return Math.round(seconds / this.info.dt)
  }

  ingest(input: StatsInput): ReadonlyArray<Signal> {
    const before = this.signals.length
    if (input.kind === "frame") {
      const f = input.frame
      if (f.tick <= this.lastFrameTick || f.tick < this.lastEventTick)
        throw new StatsError(`input out of order: frame ${f.tick} after frame ${this.lastFrameTick} and events of tick ${this.lastEventTick}`)
      this.lastFrameTick = f.tick
      this.lastFrame = f
      this.onFrame(f)
    } else {
      const e = input.event
      const tick = emittedAt(e)
      if (tick < this.lastFrameTick) throw new StatsError(`input out of order: event ${e.id} (tick ${tick}) after frame ${this.lastFrameTick}`)
      this.lastEventTick = Math.max(this.lastEventTick, tick)
      this.events.push(e)
      this.eventTicks.push(tick)
      this.onEvent(e, tick)
    }
    return this.signals.slice(before)
  }

  protected onEvent(_e: DomainEvent, _tick: number): void {}

  protected onFrame(f: TrackFrame): void {
    const dt = this.info.dt
    const present = new Set<string>()
    for (const side of ["home", "away"] as const) {
      const team = side === "home" ? this.info.home : this.info.away
      for (const p of side === "home" ? f.home : f.away) {
        present.add(p.id)
        let hist = this.recent.get(p.id) ?? []
        const prev = hist[hist.length - 1]
        const contiguous = prev !== undefined && prev.tick === f.tick - 1 && prev.period === f.period
        if (contiguous) {
          const d = Math.hypot(p.x - prev.x, p.y - prev.y)
          if (d / dt <= MAX_RUN_MS) {
            const total = this.counters.total("dist", p.id, f.tick) + d
            this.counters.add("dist", p.id, f.tick, d)
            this.counters.add("dist", team.id, f.tick, d)
            for (const m of DISTANCE_MILESTONES_M)
              if (total >= m && total - d < m)
                this.raise("distance_milestone", f, { team_id: team.id, player_id: p.id, metric: "plyr.dist", value: m, frame_from: f.tick, frame_to: f.tick, salience: m >= 12_000 ? 0.3 : 0.15, evidence: [`plyr.dist@0-${f.tick}`], data: { "plyr.dist": Math.round(total) } })
          }
        } else hist = []
        hist.push({ tick: f.tick, period: f.period, x: p.x, y: p.y, z: 0 })
        if (hist.length > this.speedWindow + 1) hist.shift()
        this.recent.set(p.id, hist)
        const kmh = hist.length === this.speedWindow + 1 ? (Math.hypot(p.x - hist[0]!.x, p.y - hist[0]!.y) / (this.speedWindow * dt)) * 3.6 : null
        if (kmh !== null && kmh <= MAX_RUN_MS * 3.6) this.onSpeed(p.id, team, f, kmh)
        else this.endSprint(p.id, team, f)
      }
    }
    for (const [id] of this.sprints) if (!present.has(id)) this.endSprint(id, this.teamByPlayer.get(id)!, f)

    const prevBall = this.ballRecent[this.ballRecent.length - 1]
    if (!prevBall || prevBall.tick !== f.tick - 1 || prevBall.period !== f.period) this.ballRecent = []
    this.ballRecent.push({ tick: f.tick, period: f.period, x: f.ball.x, y: f.ball.y, z: f.ball.z })
    if (this.ballRecent.length > this.ballWindow + 1) this.ballRecent.shift()
    if (this.ballRecent.length === this.ballWindow + 1) {
      const a = this.ballRecent[0]!
      const kmh = (Math.hypot(f.ball.x - a.x, f.ball.y - a.y, f.ball.z - a.z) / (this.ballWindow * dt)) * 3.6
      if (kmh <= MAX_BALL_KMH) this.ballSpeed.push(f.tick, kmh)
    }

    if (f.ball_in_play) {
      this.counters.add("inplay", "match", f.tick, 1)
      if (f.possession_side) this.counters.add("poss", (f.possession_side === "home" ? this.info.home : this.info.away).id, f.tick, 1)
    }
  }

  private onSpeed(id: string, team: TeamInfo, f: TrackFrame, kmh: number): void {
    let s = this.speeds.get(id)
    if (!s) this.speeds.set(id, (s = new Series()))
    s.push(f.tick, kmh)
    let m = this.vmax.get(id)
    if (!m) this.vmax.set(id, (m = new Series()))
    if (kmh > m.last(-1)) m.push(f.tick, kmh)
    const sprint = this.sprints.get(id)
    if (kmh > SPRINT_KMH) {
      if (sprint) {
        sprint.peak = Math.max(sprint.peak, kmh)
        sprint.to = f.tick
      } else this.sprints.set(id, { from: f.tick, peak: kmh, to: f.tick })
    } else this.endSprint(id, team, f)
  }

  /** A sprint over 30 km/h has ended: alert if it beats the player's last alert by 0.5 km/h. */
  private endSprint(id: string, team: TeamInfo, f: TrackFrame): void {
    const sprint = this.sprints.get(id)
    if (!sprint) return
    this.sprints.delete(id)
    const best = this.alertBest.get(id)
    if (best !== undefined && sprint.peak < best + SPRINT_ALERT_STEP_KMH) return
    this.alertBest.set(id, sprint.peak)
    const peak = Math.round(sprint.peak * 10) / 10
    this.raise("speed_alert", f, {
      team_id: team.id, player_id: id, metric: "plyr.vmax", value: peak, frame_from: sprint.from, frame_to: sprint.to,
      salience: Math.min(0.5, 0.2 + (sprint.peak - SPRINT_KMH) / 10), evidence: [`plyr.vmax@${sprint.from}-${sprint.to}`], data: { "plyr.vmax": peak, ...(best !== undefined ? { previous_best: Math.round(best * 10) / 10 } : {}) }
    })
  }

  /** Record a signal at the tick of `at` (a frame, or an event's own period and clock). */
  protected raise(
    type: SignalType,
    at: { readonly tick: number; readonly period: "first_half" | "second_half"; readonly frame_id: number } | DomainEvent,
    s: Pick<Signal, "team_id" | "player_id" | "metric" | "value" | "frame_from" | "frame_to" | "salience" | "evidence" | "data">
  ): void {
    const isEvent = "match_clock" in at
    const tick = isEvent ? emittedAt(at) : at.tick
    const clock = isEvent ? at.match_clock : matchClock(at.period, at.frame_id, this.info.dt)
    // Ids depend on what the signal is about, not on arrival order within a tick, so live and replayed runs agree.
    let id = `${this.info.matchId}-${type}-${tick}-${s.player_id ?? s.team_id ?? "match"}`
    for (let n = 2; this.signalIds.has(id); n++) id = `${this.info.matchId}-${type}-${tick}-${s.player_id ?? s.team_id ?? "match"}-${n}`
    this.signalIds.add(id)
    this.signals.push({ id, match_id: this.info.matchId, type, frame_id: tick, period: at.period, match_clock: clock, ...s })
  }

  subjectKind(subject: string): SubjectKind {
    if (subject === "match") return "match"
    if (this.teamById.has(subject)) return "team"
    if (this.teamByPlayer.has(subject)) return "player"
    throw new StatsError(`unknown subject "${subject}": expected "match", a team id or a player id`)
  }

  /** The window start for a query: null for the match so far. */
  protected windowFrom(id: MetricId, at: number, windowS: number | null | undefined): number | null {
    const def = metricDef(id)!
    const w = def.windowed ? (windowS === undefined ? def.defaultWindowS : windowS) : null
    return w === null ? null : at - this.ticks(w)
  }

  /**
   * A metric's value for a subject ("match", a team id or a player id) as of a tick, or null when there is no
   * data yet (no passes, no in-play time). Throws StatsError when the metric is not defined for the subject.
   */
  value(id: MetricId, subject: string, opts: QueryOptions = {}): number | null {
    const def = metricDef(id)
    if (!def) throw new StatsError(`unknown metric "${id}"`)
    const kind = this.subjectKind(subject)
    if (!def.subjects.includes(kind)) throw new StatsError(`${id} is not defined for a ${kind} (it is for: ${def.subjects.join(", ")})`)
    const at = Math.min(opts.at ?? this.now, this.now)
    const from = this.windowFrom(id, at, opts.windowS)
    return this.compute(id, subject, at, from)
  }

  protected compute(id: MetricId, subject: string, at: number, from: number | null): number | null {
    const ratio = (num: number, den: number) => (den > 0 ? num / den : null)
    switch (id) {
      case "plyr.dist":
        return this.counters.between("dist", subject, from, at)
      case "plyr.vmax": {
        if (from !== null) return maxBetween(this.speeds.get(subject), from, at)
        const v = this.vmax.get(subject)?.at(at, -1) ?? -1
        return v < 0 ? null : v
      }
      case "ball.speed": {
        const i = this.ballSpeed.indexAt(at)
        return i < 0 ? null : this.ballSpeed.values[i]!
      }
      case "team.poss":
        return ratio(this.counters.between("poss", subject, from, at), this.counters.between("inplay", "match", from, at))
      default:
        return null
    }
  }

  /** Ball speed (km/h) at each tick in (from, to], for event metrics such as shot speed. */
  protected ballSpeedMax(from: number, to: number): number | null {
    return maxBetween(this.ballSpeed, from, to)
  }
}
```

Apply this change to `packages/stats/src/index.ts` (from the repository root):

```bash
git apply <<'PATCH'
diff --git a/packages/stats/src/index.ts b/packages/stats/src/index.ts
index f1e1511..9e48a43 100644
--- a/packages/stats/src/index.ts
+++ b/packages/stats/src/index.ts
@@ -1,2 +1,5 @@
 export * from "./catalog.js"
+export * from "./engine.js"
+export * from "./input.js"
 export * from "./models.js"
+export * from "./store.js"
PATCH
```

- [ ] **Step 4: Run the tests**

Run: `pnpm --filter @touchline/stats test kinematics`
Expected: 9 passed (a whole simulated match costs well under 1 ms per tick)

Run: `pnpm --filter @touchline/stats test && pnpm --filter @touchline/stats typecheck`
Expected: 18 passed; no type errors

- [ ] **Step 5: Commit**

```bash
git add packages/stats
git commit -m "feat(stats): incremental engine core with time-indexed store; distance, top speed, ball speed, possession; speed and distance signals

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```



### Task 4: Pass and shot metrics; goal, big chance, difficult pass, card and milestone signals

Each pass gets its length and xPass from the frame at its release (the engine keeps the last 30 s of frames; without a frame the pass still counts, its difficulty unknown); each shot its xG (penalties 0.76) and its speed, the ball's peak in the 0.3 s after the strike. Per player and team: mean pass distance, completion, mean xPass, shot xG and mean shot speed, all windowable. Signals: a goal (with the scoring shot's xG and the score), a big chance (xG at least 0.3 that did not score), a difficult pass completed (xPass under 0.55: the real-data model is compressed, and this is about the hardest 1 % of completed passes), a card (red more salient) and player milestones (50, 75 and 100 completed passes; a brace and a hat-trick; 5 tackles won). The values derived for each event are kept for the MCP tools.

**Files:**
- Create: `packages/stats/src/derive.ts`
- Modify: `packages/stats/src/engine.ts`
- Test: `packages/stats/test/events.test.ts`

**Interfaces:**
- Consumes: Task 2's `passFeatures`, `shotFeatures`, `predict`; Task 3's engine hooks.
- Produces: `interface PassValues {"pass.dist", "pass.xp": number | null}`, `passValues(e, frame, side, models)`, `shotXg(e, frame, side, models)`; engine `derived: Map<eventId, Record<string, number>>`, `score {home, away}`, `DIFFICULT_PASS_XP = 0.55`, `BIG_CHANCE_XG = 0.3`, `PLAYER_MILESTONES`; metrics `pass.dist`, `pass.acc`, `pass.xp`, `shot.xg`, `shot.speed`.

- [ ] **Step 1: Write the failing tests**

Create `packages/stats/test/events.test.ts`:

```ts
import { describe, expect, it } from "vitest"
import { BIG_CHANCE_XG, DIFFICULT_PASS_XP, StatsEngine } from "../src/engine.js"
import { passFeatures, predict, shotFeatures } from "../src/models.js"
import { event, frame, INFO, models } from "./helpers.js"

const M = models()
const pass = (tick: number, end: number, ok: boolean, fields: object = {}) =>
  event("pass", tick, { team_id: "home-fc", player_id: "h2", x: -10, y: 5, x_end: -10 + (ok ? 10 : 20), y_end: 5, frame_id_end: end, outcome: ok ? "successful" : "intercepted", ...fields })

describe("pass and shot metrics", () => {
  it("measure pass distance, accuracy and difficulty for the passer and the team", () => {
    const eng = new StatsEngine(INFO, M)
    eng.ingest({ kind: "frame", frame: frame(0) })
    eng.ingest({ kind: "event", event: pass(0, 1, true) })
    eng.ingest({ kind: "frame", frame: frame(1) })
    eng.ingest({ kind: "event", event: pass(1, 2, false) })
    eng.ingest({ kind: "frame", frame: frame(2) })
    const f = frame(0)
    const xp1 = predict(M.xpass, passFeatures({ x: -10, y: 5 }, { x: 0, y: 5 }, 1, f.away))
    const xp2 = predict(M.xpass, passFeatures({ x: -10, y: 5 }, { x: 10, y: 5 }, 1, f.away))
    for (const subject of ["h2", "home-fc"]) {
      expect(eng.value("pass.acc", subject)).toBe(0.5)
      expect(eng.value("pass.dist", subject)).toBeCloseTo(15, 9)
      expect(eng.value("pass.xp", subject)).toBeCloseTo((xp1 + xp2) / 2, 12)
    }
    expect(eng.value("pass.acc", "h3")).toBeNull()
    expect(eng.value("pass.acc", "home-fc", { at: 0 })).toBeNull()
    expect(eng.value("pass.acc", "home-fc", { at: 1 })).toBe(1)
  })

  it("count a pass without a tracking frame but leave its difficulty unknown", () => {
    const eng = new StatsEngine(INFO, M)
    eng.ingest({ kind: "event", event: pass(3, 4, true) })
    expect(eng.value("pass.acc", "h2")).toBe(1)
    expect(eng.value("pass.xp", "h2")).toBeNull()
    expect(eng.derived.get(eng.events[0]!.id)).toEqual({ "pass.dist": 10 })
  })

  it("signal a completed pass that was unlikely to arrive, and not an easy one", () => {
    const eng = new StatsEngine(INFO, M)
    // A 35 m forward pass past two defenders in the lane, with an opponent tight on the passer.
    const crowded = frame(0, { a3: { x: -9.5, y: 5 }, a2: { x: 5, y: 5.5 }, a1: { x: 15, y: 4.5 } })
    eng.ingest({ kind: "frame", frame: crowded })
    const hard = event("pass", 1, { team_id: "home-fc", player_id: "h2", x: -10, y: 5, x_end: 25, y_end: 5, frame_id: 0, frame_id_end: 1, outcome: "successful" })
    eng.ingest({ kind: "event", event: hard })
    eng.ingest({ kind: "frame", frame: frame(1) })
    eng.ingest({ kind: "event", event: pass(1, 2, true) })
    const sig = eng.signals.filter((s) => s.type === "difficult_pass_completed")
    expect(sig).toHaveLength(1)
    expect(sig[0]).toMatchObject({ player_id: "h2", metric: "pass.xp", evidence: [hard.id], frame_from: 0, frame_to: 1 })
    expect(sig[0]!.value!).toBeLessThan(DIFFICULT_PASS_XP)
  })

  it("value shots by xG, take shot speed from the ball, and signal big chances that did not score", () => {
    const eng = new StatsEngine(INFO, M)
    // The ball leaves at 25 m/s (90 km/h) from (40, 0) towards goal.
    for (let t = 0; t <= 5; t++) eng.ingest({ kind: "frame", frame: frame(t, {}, { ball: { x: 40 + 2.5 * Math.max(0, t - 2), y: 0, z: 0.5 } }) })
    const close = event("shot", 2, { team_id: "home-fc", player_id: "h3", x: 46, y: 1, frame_id_end: 6, outcome: "saved", attrs: { body_part: "right_foot", technique: "normal" } })
    eng.ingest({ kind: "event", event: close })
    eng.ingest({ kind: "frame", frame: frame(6) })
    const xg = predict(M.xg, shotFeatures({ x: 46, y: 1 }, 1, false, frame(2).away))
    expect(xg).toBeGreaterThan(BIG_CHANCE_XG)
    expect(eng.value("shot.xg", "h3")).toBeCloseTo(xg, 12)
    expect(eng.value("shot.speed", "home-fc")).toBeCloseTo(90, 6)
    const big = eng.signals.filter((s) => s.type === "big_chance")
    expect(big).toHaveLength(1)
    expect(big[0]).toMatchObject({ player_id: "h3", metric: "shot.xg", evidence: [close.id] })
  })

  it("rate a penalty at the fixed value and raise a goal signal carrying the score and the shot's xG", () => {
    const eng = new StatsEngine(INFO, M)
    eng.ingest({ kind: "frame", frame: frame(0) })
    const pen = event("shot", 0, { team_id: "away-fc", player_id: "a3", x: -41.5, y: 0, frame_id_end: 4, outcome: "goal", attrs: { technique: "penalty", body_part: "right_foot" } })
    const goal = event("goal", 4, { team_id: "away-fc", player_id: "a3", attrs: { scorer_id: "a3", own_goal: false } })
    eng.ingest({ kind: "event", event: pen })
    eng.ingest({ kind: "event", event: goal })
    expect(eng.value("shot.xg", "away-fc")).toBe(M.xg.penalty)
    expect(eng.signals.map((s) => s.type)).toEqual(["goal"])
    expect(eng.signals[0]).toMatchObject({ team_id: "away-fc", metric: "shot.xg", value: M.xg.penalty, evidence: [pen.id, goal.id], salience: 1, data: { home: 0, away: 1, own_goal: 0 } })
    expect(eng.score).toEqual({ home: 0, away: 1 })
  })

  it("raise card signals, red ones more salient", () => {
    const eng = new StatsEngine(INFO, M)
    eng.ingest({ kind: "event", event: event("card", 1, { team_id: "home-fc", player_id: "h2", attrs: { colour: "yellow" } }) })
    eng.ingest({ kind: "event", event: event("card", 2, { team_id: "home-fc", player_id: "h2", attrs: { colour: "second_yellow" } }) })
    expect(eng.signals.map((s) => [s.type, s.salience, s.metric, s.data.red])).toEqual([["card", 0.5, null, 0], ["card", 0.9, null, 1]])
  })

  it("raise player milestones at 50 completed passes and at a brace", () => {
    const eng = new StatsEngine(INFO, M)
    for (let i = 0; i < 52; i++) eng.ingest({ kind: "event", event: pass(10 + 2 * i, 11 + 2 * i, true) })
    for (const t of [200, 300]) eng.ingest({ kind: "event", event: event("goal", t, { team_id: "home-fc", player_id: "h3", attrs: { scorer_id: "h3", own_goal: false } }) })
    const m = eng.signals.filter((s) => s.type === "player_milestone")
    expect(m.map((s) => [s.player_id, s.data])).toEqual([["h2", { passes_completed: 50 }], ["h3", { goals: 2 }]])
    expect(m[0]).toMatchObject({ metric: "pass.acc", value: 1 })
  })
})
```

- [ ] **Step 2: Run them to make sure they fail**

Run: `pnpm --filter @touchline/stats test events`
Expected: 7 failed: no pass or shot values yet (`expected null to be 0.76` for the penalty's xG) and no signals (`expected [] to deeply equal [ [ 'card', 0.5, null, +0 ], …(1) ]`)

- [ ] **Step 3: Implement**

Create `packages/stats/src/derive.ts`:

```ts
import type { DomainEvent } from "@touchline/schema"
import type { TrackFrame } from "./input.js"
import { passFeatures, predict, shotFeatures, type StatsModels } from "./models.js"

/** Opponents of `side` in a frame (none without a frame). */
const opponents = (f: TrackFrame | undefined, side: "home" | "away") => (f ? (side === "home" ? f.away : f.home) : [])

export interface PassValues {
  readonly "pass.dist": number
  /** Null without a tracking frame at the pass (the defenders in lane and the pressure are unknown). */
  readonly "pass.xp": number | null
}

/** Length and modelled completion probability of a pass, from its locations and the frame at its release. */
export const passValues = (e: DomainEvent, f: TrackFrame | undefined, side: "home" | "away", models: StatsModels): PassValues | null => {
  if (e.x === null || e.y === null || e.x_end === null || e.y_end === null) return null
  const start = { x: e.x, y: e.y }
  const end = { x: e.x_end, y: e.y_end }
  return {
    "pass.dist": Math.hypot(end.x - start.x, end.y - start.y),
    "pass.xp": f ? predict(models.xpass, passFeatures(start, end, side === "home" ? 1 : -1, opponents(f, side))) : null
  }
}

/** Expected goals of a shot (penalties at the fixed rate), from its location and the frame at the strike. */
export const shotXg = (e: DomainEvent, f: TrackFrame | undefined, side: "home" | "away", models: StatsModels): number | null => {
  if (e.attrs.technique === "penalty") return models.xg.penalty
  if (e.x === null || e.y === null) return null
  return predict(models.xg, shotFeatures({ x: e.x, y: e.y }, side === "home" ? 1 : -1, e.attrs.body_part === "head", opponents(f, side)))
}
```

Apply this change to `packages/stats/src/engine.ts` (from the repository root):

```bash
git apply <<'PATCH'
diff --git a/packages/stats/src/engine.ts b/packages/stats/src/engine.ts
index dbe529a..39eb503 100644
--- a/packages/stats/src/engine.ts
+++ b/packages/stats/src/engine.ts
@@ -1,6 +1,7 @@
 import type { DomainEvent, MetricId, Signal, SignalType } from "@touchline/schema"
 import { matchClock } from "@touchline/sim-core"
 import { metricDef, type SubjectKind } from "./catalog.js"
+import { passValues, shotXg } from "./derive.js"
 import { emittedAt, type MatchInfo, type StatsInput, type TeamInfo, type TrackFrame } from "./input.js"
 import type { StatsModels } from "./models.js"
 import { Counters, maxBetween, Series } from "./store.js"
@@ -15,6 +16,14 @@ export const DISTANCE_MILESTONES_M = [10_000, 12_000] as const
 /** Faster than this between frames is a jump (half-time reset, substitution), not running. */
 const MAX_RUN_MS = 12
 const MAX_BALL_KMH = 200
+/** Frames kept for looking up the frame at a pass's or shot's release (flights end within a few seconds). */
+const FRAME_MEMORY_S = 30
+/** A completed pass this unlikely (xPass) is a difficult pass (about the hardest 1 % of completed passes). */
+export const DIFFICULT_PASS_XP = 0.55
+/** A shot at least this likely to score (xG) is a big chance. */
+export const BIG_CHANCE_XG = 0.3
+/** Counts at which a player milestone is raised. */
+export const PLAYER_MILESTONES: Readonly<Record<string, ReadonlyArray<number>>> = { passes_completed: [50, 75, 100], goals: [2, 3], tackles_won: [5] }
 
 export interface QueryOptions {
   /** Global tick to answer at (default: the latest ingested). */
@@ -47,6 +56,9 @@ export class StatsEngine {
   readonly events: DomainEvent[] = []
   /** Emission tick of each stored event (index-aligned with `events`). */
   readonly eventTicks: number[] = []
+  /** Values the engine derived for each pass and shot (pass.dist, pass.xp, shot.xg, shot.speed), by event id. */
+  readonly derived = new Map<string, Readonly<Record<string, number>>>()
+  readonly score = { home: 0, away: 0 }
   protected readonly counters = new Counters()
   private readonly speeds = new Map<string, Series>()
   private readonly vmax = new Map<string, Series>()
@@ -63,6 +75,8 @@ export class StatsEngine {
   private lastEventTick = -1
   private lastFrame: TrackFrame | null = null
   private readonly signalIds = new Set<string>()
+  private readonly frames = new Map<number, TrackFrame>()
+  private readonly tallies = new Map<string, Map<string, number>>()
 
   constructor(
     readonly info: MatchInfo,
@@ -106,6 +120,8 @@ export class StatsEngine {
         throw new StatsError(`input out of order: frame ${f.tick} after frame ${this.lastFrameTick} and events of tick ${this.lastEventTick}`)
       this.lastFrameTick = f.tick
       this.lastFrame = f
+      this.frames.set(f.tick, f)
+      this.frames.delete(f.tick - this.ticks(FRAME_MEMORY_S))
       this.onFrame(f)
     } else {
       const e = input.event
@@ -119,7 +135,115 @@ export class StatsEngine {
     return this.signals.slice(before)
   }
 
-  protected onEvent(_e: DomainEvent, _tick: number): void {}
+  protected onEvent(e: DomainEvent, tick: number): void {
+    const team = e.team_id === null ? undefined : this.teamById.get(e.team_id)
+    switch (e.type) {
+      case "pass":
+        if (team) this.onPass(e, tick, team)
+        break
+      case "shot":
+        if (team) this.onShot(e, tick, team)
+        break
+      case "goal":
+        if (team) this.onGoal(e, team)
+        break
+      case "card": {
+        const red = e.attrs.colour !== "yellow"
+        this.raise("card", e, {
+          team_id: e.team_id, player_id: e.player_id, metric: null, value: null, frame_from: e.frame_id, frame_to: e.frame_id,
+          salience: red ? 0.9 : 0.5, evidence: [e.id], data: { red: red ? 1 : 0 }
+        })
+        break
+      }
+      case "tackle":
+        if (e.player_id && e.outcome === "won") this.tally(e, "tackles_won")
+        break
+    }
+  }
+
+  private onPass(e: DomainEvent, tick: number, team: TeamInfo): void {
+    const v = passValues(e, this.frames.get(e.frame_id), team.side, this.models)
+    if (!v) return
+    this.derived.set(e.id, v["pass.xp"] === null ? { "pass.dist": v["pass.dist"] } : { "pass.dist": v["pass.dist"], "pass.xp": v["pass.xp"] })
+    const ok = e.outcome === "successful"
+    for (const subject of [e.player_id, team.id]) {
+      if (subject === null) continue
+      this.counters.add("passes", subject, tick, 1)
+      this.counters.add("pass_len", subject, tick, v["pass.dist"])
+      if (ok) this.counters.add("passes_ok", subject, tick, 1)
+      if (v["pass.xp"] !== null) {
+        this.counters.add("xp_sum", subject, tick, v["pass.xp"])
+        this.counters.add("xp_n", subject, tick, 1)
+      }
+    }
+    if (ok && v["pass.xp"] !== null && v["pass.xp"] < DIFFICULT_PASS_XP) {
+      const xp = Math.round(v["pass.xp"] * 1000) / 1000
+      this.raise("difficult_pass_completed", e, {
+        team_id: team.id, player_id: e.player_id, metric: "pass.xp", value: xp, frame_from: e.frame_id, frame_to: tick,
+        salience: Math.min(0.6, 0.25 + (DIFFICULT_PASS_XP - v["pass.xp"])), evidence: [e.id], data: { "pass.xp": xp, "pass.dist": Math.round(v["pass.dist"] * 10) / 10 }
+      })
+    }
+    if (ok && e.player_id) this.tally(e, "passes_completed")
+  }
+
+  private onShot(e: DomainEvent, tick: number, team: TeamInfo): void {
+    const xg = shotXg(e, this.frames.get(e.frame_id), team.side, this.models)
+    if (xg === null) return
+    // Peak ball speed in the 0.3 s after the strike (frames up to the shot's resolution).
+    const speed = this.ballSpeedMax(e.frame_id, Math.min(e.frame_id + this.ticks(0.3), tick))
+    this.derived.set(e.id, speed === null ? { "shot.xg": xg } : { "shot.xg": xg, "shot.speed": speed })
+    for (const subject of [e.player_id, team.id]) {
+      if (subject === null) continue
+      this.counters.add("shots", subject, tick, 1)
+      this.counters.add("xg", subject, tick, xg)
+      if (speed !== null) {
+        this.counters.add("shot_speed", subject, tick, speed)
+        this.counters.add("shot_speed_n", subject, tick, 1)
+      }
+    }
+    if (xg >= BIG_CHANCE_XG && e.outcome !== "goal") {
+      const v = Math.round(xg * 1000) / 1000
+      this.raise("big_chance", e, {
+        team_id: team.id, player_id: e.player_id, metric: "shot.xg", value: v, frame_from: e.frame_id, frame_to: tick,
+        salience: Math.min(0.9, 0.4 + 0.6 * xg), evidence: [e.id], data: { "shot.xg": v }
+      })
+    }
+  }
+
+  private onGoal(e: DomainEvent, team: TeamInfo): void {
+    this.score[team.side]++
+    // The shot that scored is the last shot by this team with outcome "goal" (none for an own goal or a loose ball).
+    let shot: DomainEvent | undefined
+    for (let i = this.events.length - 2; i >= 0 && i >= this.events.length - 6; i--) {
+      const c = this.events[i]!
+      if (c.type === "shot" && c.outcome === "goal" && c.team_id === team.id) {
+        shot = c
+        break
+      }
+    }
+    const xg = shot ? (this.derived.get(shot.id)?.["shot.xg"] ?? null) : null
+    this.raise("goal", e, {
+      team_id: team.id, player_id: e.player_id, metric: xg === null ? null : "shot.xg", value: xg === null ? null : Math.round(xg * 1000) / 1000,
+      frame_from: shot?.frame_id ?? e.frame_id, frame_to: e.frame_id, salience: 1, evidence: shot ? [shot.id, e.id] : [e.id],
+      data: { home: this.score.home, away: this.score.away, own_goal: e.attrs.own_goal === true ? 1 : 0 }
+    })
+    if (e.attrs.own_goal !== true && e.player_id) this.tally(e, "goals")
+  }
+
+  /** Count a player's passes completed, goals and tackles won, raising a milestone at the listed counts. */
+  private tally(e: DomainEvent, what: keyof typeof PLAYER_MILESTONES): void {
+    const id = e.player_id!
+    let t = this.tallies.get(id)
+    if (!t) this.tallies.set(id, (t = new Map()))
+    const n = (t.get(what) ?? 0) + 1
+    t.set(what, n)
+    if (!PLAYER_MILESTONES[what]!.includes(n)) return
+    this.raise("player_milestone", e, {
+      team_id: e.team_id, player_id: id, metric: what === "passes_completed" ? "pass.acc" : null,
+      value: what === "passes_completed" ? this.value("pass.acc", id, { at: emittedAt(e) }) : null,
+      frame_from: e.frame_id, frame_to: e.frame_id, salience: what === "goals" ? 0.8 : 0.3, evidence: [e.id], data: { [what]: n }
+    })
+  }
 
   protected onFrame(f: TrackFrame): void {
     const dt = this.info.dt
@@ -257,6 +381,16 @@ export class StatsEngine {
         const i = this.ballSpeed.indexAt(at)
         return i < 0 ? null : this.ballSpeed.values[i]!
       }
+      case "pass.dist":
+        return ratio(this.counters.between("pass_len", subject, from, at), this.counters.between("passes", subject, from, at))
+      case "pass.acc":
+        return ratio(this.counters.between("passes_ok", subject, from, at), this.counters.between("passes", subject, from, at))
+      case "pass.xp":
+        return ratio(this.counters.between("xp_sum", subject, from, at), this.counters.between("xp_n", subject, from, at))
+      case "shot.xg":
+        return this.counters.between("xg", subject, from, at)
+      case "shot.speed":
+        return ratio(this.counters.between("shot_speed", subject, from, at), this.counters.between("shot_speed_n", subject, from, at))
       case "team.poss":
         return ratio(this.counters.between("poss", subject, from, at), this.counters.between("inplay", "match", from, at))
       default:
PATCH
```

- [ ] **Step 4: Run the tests**

Run: `pnpm --filter @touchline/stats test events`
Expected: 7 passed

Run: `pnpm --filter @touchline/stats test && pnpm --filter @touchline/stats typecheck`
Expected: 25 passed; no type errors

- [ ] **Step 5: Commit**

```bash
git add packages/stats
git commit -m "feat(stats): pass distance, accuracy and difficulty, shot xG and speed; goal, big chance, difficult pass, card and player milestone signals

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```



### Task 5: Team dynamics: pressure, PPDA, tilt, momentum, chaos and their signals

The team metrics of spec §5.2. Pressure index: the team's pressures over pressures plus opponent passes (by default over the last 5 minutes). PPDA: opponent passes in their own 60 % of the pitch per tackle, interception or foul there (a foul in a tackle counts once). On the simulator's events PPDA comes out at 2-5, not the 8-15 of real event data, because the simulator records every collected loose pass as an interception; the definition is the standard one. Field tilt: the team's share of passes from the attacking third. Momentum: each team's attacking threat, halving every 2 minutes, where completed passes and carries add their gain in `threatAt` (1 at the goal centre, falling with distance) and shots three times their xG; the share is the team's part of both; over a window, the mean of its 10-second samples. Control vs chaos: over the last 5 minutes, turnovers per minute, passes per possession and the spread of the momentum share, each scaled to 0..1 and averaged. Every 10 s, once every input of that tick is in (so an event that follows its frame still counts), the engine checks for a pressure shift (the index up 0.15 on the previous 5 minutes, with at least 10 pressures), a momentum swing (the 5-minute mean share up 0.2 to at least 0.55), a chaos spike (at least 0.7 and up 0.2) and a substitution's impact (the momentum share over 10 minutes before and after differs by 0.15; a team's substitutions at the same moment are judged together); each team's signal of a kind waits 5 minutes before repeating. `finish()` runs the last tick's checks. Scripted press surges and momentum swings raise their signals (measured on six seeds).

**Files:**
- Create: `packages/stats/src/momentum.ts`
- Modify: `packages/stats/src/engine.ts`, `packages/stats/src/catalog.ts` (`team.mom` becomes windowed)
- Test: `packages/stats/test/team.test.ts`

**Interfaces:**
- Consumes: Task 4's pass and shot handling; `runScript` (sim-core) for the scenario tests.
- Produces: `MOMENTUM_HALF_LIFE_S = 120`, `threatAt(x, y, attack)`, `class Momentum {add, level, share}`; engine `finish(): Signal[]`, `chaosAt(at)`, `opponentOf(team)`, constants `PPDA_LINE_X`, `FINAL_THIRD_X`, `DYNAMICS_EVERY_S = 10`, `DYNAMICS_WINDOW_S = 300`, `SIGNAL_COOLDOWN_S = 300`, `MOMENTUM_SHOT_WEIGHT = 3`, `PRESSURE_SHIFT`, `MOMENTUM_SWING`, `CHAOS_SPIKE`, `CHAOS_SCALE`, `SUB_IMPACT`; metrics `team.press`, `ppda`, `tilt`, `team.mom`, `game.chaos`.

- [ ] **Step 1: Write the failing tests**

Create `packages/stats/test/team.test.ts`:

```ts
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"
import type { DomainEvent } from "@touchline/schema"
import type { League } from "@touchline/league"
import { paramsFromJson, runScript, type MatchConfig, type Script } from "@touchline/sim-core"
import { CHAOS_SCALE, StatsEngine } from "../src/engine.js"
import { infoFromConfig } from "../src/input.js"
import { threatAt } from "../src/momentum.js"
import { event, frame, INFO, models, root } from "./helpers.js"

const M = models()
const home = { team_id: "home-fc", player_id: "h2" }
const away = { team_id: "away-fc", player_id: "a3" }
/** A completed pass from (x, y) to (xEnd, y). */
const pass = (tick: number, side: typeof home, x: number, xEnd: number, y = 0, ok = true): DomainEvent =>
  event("pass", tick, { ...side, x, y, x_end: xEnd, y_end: y, frame_id_end: tick, outcome: ok ? "successful" : "intercepted" })

/** Feed events in tick order, with a frame every 10 s (ticks 0, 100, 200, ...) up to `until`. */
const feed = (eng: StatsEngine, events: DomainEvent[], until: number) => {
  const sorted = [...events].sort((a, b) => a.frame_id - b.frame_id)
  let i = 0
  for (let t = 0; t <= until; t += 100) {
    while (i < sorted.length && sorted[i]!.frame_id <= t) eng.ingest({ kind: "event", event: sorted[i++]! })
    eng.ingest({ kind: "frame", frame: frame(t) })
  }
  eng.finish()
}

describe("team dynamics", () => {
  it("measure the pressure index over the last five minutes by default", () => {
    const eng = new StatsEngine(INFO, M)
    const ev = [
      ...[10, 20, 30, 40].map((t) => event("pressure", t, home)),
      ...[3500, 3600, 3700, 3800, 3900, 4000].map((t) => event("pressure", t, home)),
      ...[3550, 3650, 3750, 3850].map((t) => pass(t, away, 0, -5))
    ]
    feed(eng, ev, 4000)
    expect(eng.value("team.press", "home-fc")).toBeCloseTo(6 / 10, 12)
    expect(eng.value("team.press", "home-fc", { windowS: null })).toBeCloseTo(10 / 14, 12)
    // Away made no pressures and home no passes: no data.
    expect(eng.value("team.press", "away-fc")).toBeNull()
  })

  it("count PPDA passes in the opponent's own 60 % and defensive actions there, a foul in a tackle once", () => {
    const eng = new StatsEngine(INFO, M)
    // Away attacks -x, so its own 60 % is x > -10.5.
    const ev = [
      pass(10, away, 20, 15), pass(20, away, 0, -5), pass(30, away, -30, -35),
      event("tackle", 40, { ...home, x: 20, y: 0, outcome: "won" }),
      event("tackle", 50, { ...home, x: 20, y: 0, outcome: "foul" }),
      event("foul", 50, { ...home, x: 20, y: 0 }),
      event("interception", 60, { ...home, x: -30, y: 0 })
    ]
    feed(eng, ev, 100)
    expect(eng.value("ppda", "home-fc")).toBe(1)
    expect(eng.value("ppda", "away-fc")).toBeNull()
  })

  it("measure field tilt from passes in the attacking third", () => {
    const eng = new StatsEngine(INFO, M)
    feed(eng, [pass(10, home, 20, 30), pass(20, home, 30, 40), pass(30, home, 0, 10), pass(40, away, -20, -30)], 100)
    expect(eng.value("tilt", "home-fc")).toBeCloseTo(2 / 3, 12)
    expect(eng.value("tilt", "away-fc")).toBeCloseTo(1 / 3, 12)
  })

  it("weigh momentum by forward progress, halving every two minutes", () => {
    const eng = new StatsEngine(INFO, M)
    // Home gains threat at tick 0; away gains the same at tick 1200 (two minutes later).
    feed(eng, [pass(0, home, 0, 30), pass(1200, away, 0, -30)], 1200)
    const gain = threatAt(30, 0, 1) - threatAt(0, 0, 1)
    expect(gain).toBeGreaterThan(0)
    expect(eng.value("team.mom", "home-fc", { at: 600 })).toBe(1)
    // At 1200 the home contribution weighs one half, the away one fully.
    expect(eng.value("team.mom", "home-fc")).toBeCloseTo(0.5 / 1.5, 12)
    expect(eng.value("team.mom", "home-fc")! + eng.value("team.mom", "away-fc")!).toBeCloseTo(1, 12)
    expect(eng.value("team.mom", "home-fc", { at: -5 })).toBeNull()
  })

  it("scale chaos from turnovers, possession length and momentum spread", () => {
    const eng = new StatsEngine(INFO, M)
    // Five minutes: 15 turnovers and 30 passes, no momentum yet.
    const ev = [
      ...Array.from({ length: 15 }, (_, i) => event("possession_change", 100 + i * 150, home)),
      ...Array.from({ length: 30 }, (_, i) => pass(100 + i * 90, home, 0, 0, 0, false))
    ]
    feed(eng, ev, 3000)
    const expected = (Math.min(1, 15 / 5 / CHAOS_SCALE.turnoversPerMin) + (1 - Math.min(1, 30 / 15 / CHAOS_SCALE.passesPerPossession)) + 0) / 3
    expect(eng.chaosAt(3000)).toBeCloseTo(expected, 12)
    expect(eng.value("game.chaos", "match")).toBeCloseTo(expected, 12)
    expect(eng.chaosAt(500)).toBeNull()
  })

  it("signal a pressure shift once when a team's pressing jumps, then hold off for five minutes", () => {
    const eng = new StatsEngine(INFO, M)
    const ev = [
      ...Array.from({ length: 20 }, (_, i) => pass(i * 140, away, 0, -5)),
      ...Array.from({ length: 4 }, (_, i) => event("pressure", 500 + i * 600, home)),
      ...Array.from({ length: 30 }, (_, i) => event("pressure", 3000 + i * 100, home)),
      ...Array.from({ length: 10 }, (_, i) => pass(3000 + i * 300, away, 0, -5))
    ]
    feed(eng, ev, 6000)
    const shifts = eng.signals.filter((s) => s.type === "pressure_shift")
    expect(shifts).toHaveLength(1)
    expect(shifts[0]).toMatchObject({ team_id: "home-fc", metric: "team.press" })
    expect(shifts[0]!.data.after! - shifts[0]!.data.before!).toBeGreaterThanOrEqual(0.15)
    expect(shifts[0]!.value).toBeCloseTo(eng.value("team.press", "home-fc", { at: shifts[0]!.frame_id })!, 3)
  })

  it("signal a momentum swing when a team takes over, and the impact of a substitution", () => {
    const eng = new StatsEngine(INFO, M)
    const ev = [
      ...Array.from({ length: 30 }, (_, i) => pass(i * 200, away, 0, -25)),
      event("substitution", 6000, { ...home, attrs: { player_off: "h2", player_on: "h3", reason: "tactical", half_time: false } }),
      ...Array.from({ length: 30 }, (_, i) => pass(6000 + i * 200, home, 0, 25))
    ]
    feed(eng, ev, 12_100)
    const swing = eng.signals.find((s) => s.type === "momentum_swing" && s.team_id === "home-fc")!
    expect(swing).toBeDefined()
    expect(swing.frame_id).toBeGreaterThan(6000)
    expect(swing.value).toBeCloseTo(eng.value("team.mom", "home-fc", { at: swing.frame_id, windowS: 300 })!, 3)
    const impact = eng.signals.find((s) => s.type === "substitution_impact")!
    expect(impact).toMatchObject({ team_id: "home-fc", player_id: "h3", metric: "team.mom", frame_from: 6000, frame_to: 12_000 })
    expect(impact.value!).toBeGreaterThan(0.5)
  })

  it("judge a team's substitutions made at the same moment together", () => {
    const eng = new StatsEngine(INFO, M)
    const sub = (off: string, on: string) => event("substitution", 6000, { ...home, attrs: { player_off: off, player_on: on, reason: "tactical", half_time: false } })
    const ev = [...Array.from({ length: 30 }, (_, i) => pass(i * 200, away, 0, -25)), sub("h2", "h3"), sub("h1", "h3"), ...Array.from({ length: 30 }, (_, i) => pass(6000 + i * 200, home, 0, 25))]
    feed(eng, ev, 12_100)
    const impact = eng.signals.filter((s) => s.type === "substitution_impact")
    expect(impact).toHaveLength(1)
    expect(impact[0]!.data.substitutions).toBe(2)
    expect(impact[0]!.evidence).toHaveLength(3)
  })

  it("count an event that follows its tick's frame in that tick's checks", () => {
    const late = new StatsEngine(INFO, M)
    const early = new StatsEngine(INFO, M)
    for (const [eng, after] of [[late, true], [early, false]] as const) {
      for (let t = 0; t < 3000; t += 100) {
        eng.ingest({ kind: "event", event: pass(t, away, 0, -5) })
        eng.ingest({ kind: "frame", frame: frame(t) })
      }
      const burst = Array.from({ length: 30 }, () => event("pressure", 6000, home))
      for (let t = 3000; t < 6000; t += 100) eng.ingest({ kind: "frame", frame: frame(t) })
      if (!after) for (const e of burst) eng.ingest({ kind: "event", event: e })
      eng.ingest({ kind: "frame", frame: frame(6000) })
      if (after) for (const e of burst) eng.ingest({ kind: "event", event: e })
      eng.finish()
    }
    expect(late.signals.map((s) => s.id)).toEqual(early.signals.map((s) => s.id))
    expect(late.signals.some((s) => s.type === "pressure_shift" && s.frame_id === 6000)).toBe(true)
  })
})

describe("scripted scenarios raise the signals of their cause", () => {
  const league = JSON.parse(readFileSync(join(root, "data/league/league.json"), "utf8")) as League
  const params = paramsFromJson(JSON.parse(readFileSync(join(root, "data/params/touchline-params.json"), "utf8")))
  const club = (id: string) => league.clubs.find((c) => c.id === id)!
  /** Seeds (of 1-6) in which the signal fires for the scripted team within the window or the two minutes after it. */
  const detected = (homeId: string, awayId: string, script: Script, type: string) =>
    [1, 2, 3, 4, 5, 6].filter((seed) => {
      const cfg: MatchConfig = { matchId: "m", seed, kickoffTime: "2026-10-18T14:00:00.000Z", home: club(homeId), away: club(awayId), params, dt: 0.1, script }
      const run = runScript(cfg)
      const eng = new StatsEngine(infoFromConfig(cfg), M)
      for (const r of run.steps) {
        for (const e of r.events) eng.ingest({ kind: "event", event: e })
        if (r.frame) eng.ingest({ kind: "frame", frame: r.frame })
      }
      eng.finish()
      const w = run.windows[0]!
      const team = script.entries[0]!.team === "home" ? cfg.home.id : cfg.away.id
      return eng.signals.some((s) => s.type === type && s.team_id === team && s.frame_id >= w.fromFrame && s.frame_id <= w.toFrame + 1200)
    }).length

  it("a pressing surge from 30' to 45' raises a pressure shift in at least 5 of 6 seeds", () => {
    expect(detected("corrin-forge", "kestrel-bay", { name: "press", entries: [{ window: [30, 45], team: "home", effect: "press_surge" }] }, "pressure_shift")).toBeGreaterThanOrEqual(5)
  })

  it("a momentum swing from 60' to 75' raises a momentum swing in at least 3 of 6 seeds", () => {
    expect(detected("eastvale", "kestrel-bay", { name: "mom", entries: [{ window: [60, 75], team: "away", effect: "momentum_swing" }] }, "momentum_swing")).toBeGreaterThanOrEqual(3)
  })
})
```

- [ ] **Step 2: Run them to make sure they fail**

Run: `pnpm --filter @touchline/stats test team`
Expected: the file fails to load: `Cannot find module '../src/momentum.js'`

- [ ] **Step 3: Implement**

Create `packages/stats/src/momentum.ts`:

```ts
import { PITCH } from "@touchline/sim-core"

/** Momentum half-life (seconds). */
export const MOMENTUM_HALF_LIFE_S = 120
/** Contributions older than this are ignored (they weigh less than 1/1024). */
const MOMENTUM_HORIZON_S = 10 * MOMENTUM_HALF_LIFE_S

/** Attacking threat of a spot for a team attacking +x (`attack` = 1) or -x: 1 at the goal centre, falling with distance. */
export const threatAt = (x: number, y: number, attack: 1 | -1): number => Math.exp(-Math.hypot(attack * PITCH.halfL - x, y) / 20)

/**
 * Exponentially decayed attacking threat per team: what the engine adds (the gain in threatAt of completed passes
 * and carries, and weighted shot xG), each contribution halving in weight every two minutes.
 */
export class Momentum {
  private readonly contributions = new Map<string, Array<{ readonly tick: number; readonly value: number }>>()

  constructor(private readonly dt: number) {}

  add(team: string, tick: number, value: number): void {
    if (!(value > 0)) return
    let c = this.contributions.get(team)
    if (!c) this.contributions.set(team, (c = []))
    c.push({ tick, value })
  }

  /** Decayed threat of a team as of `at` (contributions stamped after `at` are not seen). */
  level(team: string, at: number): number {
    const c = this.contributions.get(team)
    if (!c) return 0
    const horizon = at - MOMENTUM_HORIZON_S / this.dt
    let sum = 0
    for (let i = c.length - 1; i >= 0; i--) {
      const x = c[i]!
      if (x.tick > at) continue
      if (x.tick < horizon) break
      sum += x.value * Math.pow(2, -((at - x.tick) * this.dt) / MOMENTUM_HALF_LIFE_S)
    }
    return sum
  }

  /** A team's share of both teams' decayed threat (null before either team has any). */
  share(team: string, opponent: string, at: number): number | null {
    const a = this.level(team, at)
    const b = this.level(opponent, at)
    return a + b > 1e-9 ? a / (a + b) : null
  }
}
```

Apply this change to `packages/stats/src/engine.ts`, `packages/stats/src/catalog.ts` (from the repository root):

```bash
git apply <<'PATCH'
diff --git a/packages/stats/src/catalog.ts b/packages/stats/src/catalog.ts
index b8ce9b6..83c6c17 100644
--- a/packages/stats/src/catalog.ts
+++ b/packages/stats/src/catalog.ts
@@ -25,7 +25,7 @@ export const METRICS: ReadonlyArray<MetricDef> = [
   { id: "plyr.vmax", name: "Top speed", unit: "km/h", subjects: ["player"], windowed: true, defaultWindowS: null, description: "Highest speed over any 0.5 s, from tracking." },
   { id: "plyr.dist", name: "Distance covered", unit: "m", subjects: ["player", "team"], windowed: true, defaultWindowS: null, description: "Distance run, from tracking (a team's is the sum of its players')." },
   { id: "shot.xg", name: "Expected goals", unit: "xG", subjects: ["player", "team"], windowed: true, defaultWindowS: null, description: "Sum of shot xG (logistic model fitted on IDSSE: distance, angle, header, defenders in the shot cone; penalties 0.76)." },
-  { id: "team.mom", name: "Momentum", unit: "share", subjects: ["team"], windowed: false, defaultWindowS: null, description: "The team's share of attacking threat, exponentially decayed (2-minute half-life): forward progress of completed passes and carries towards goal, plus shot xG." },
+  { id: "team.mom", name: "Momentum", unit: "share", subjects: ["team"], windowed: true, defaultWindowS: null, description: "The team's share of attacking threat, exponentially decayed (2-minute half-life): forward progress of completed passes and carries towards goal, plus three times shot xG. Over a window: the mean of its 10-second samples." },
   { id: "team.press", name: "Pressure index", unit: "share", subjects: ["team"], windowed: true, defaultWindowS: 300, description: "Pressures by the team / (pressures + opponent passes)." },
   { id: "ppda", name: "PPDA", unit: "passes per action", subjects: ["team"], windowed: true, defaultWindowS: null, description: "Opponent passes in their own 60 % of the pitch per defensive action there (tackles, interceptions, fouls)." },
   { id: "tilt", name: "Field tilt", unit: "share", subjects: ["team"], windowed: true, defaultWindowS: null, description: "The team's share of passes made in the attacking third." },
diff --git a/packages/stats/src/engine.ts b/packages/stats/src/engine.ts
index 39eb503..684b9ce 100644
--- a/packages/stats/src/engine.ts
+++ b/packages/stats/src/engine.ts
@@ -1,9 +1,12 @@
 import type { DomainEvent, MetricId, Signal, SignalType } from "@touchline/schema"
-import { matchClock } from "@touchline/sim-core"
+import { attackX, matchClock, PITCH } from "@touchline/sim-core"
+
+const PITCH_HALF_L = PITCH.halfL
 import { metricDef, type SubjectKind } from "./catalog.js"
 import { passValues, shotXg } from "./derive.js"
 import { emittedAt, type MatchInfo, type StatsInput, type TeamInfo, type TrackFrame } from "./input.js"
 import type { StatsModels } from "./models.js"
+import { Momentum, threatAt } from "./momentum.js"
 import { Counters, maxBetween, Series } from "./store.js"
 
 /** A query the engine cannot answer (unknown subject, metric not defined for it) or input out of order. */
@@ -23,6 +26,25 @@ export const DIFFICULT_PASS_XP = 0.55
 /** A shot at least this likely to score (xG) is a big chance. */
 export const BIG_CHANCE_XG = 0.3
 /** Counts at which a player milestone is raised. */
+/** Opponent passes behind this line (attacking x, i.e. in their own 60 % of the pitch) and defensive actions beyond it count for PPDA. */
+export const PPDA_LINE_X = -PITCH_HALF_L + 0.6 * 2 * PITCH_HALF_L
+/** Passes from beyond this line (attacking x) are in the final third. */
+export const FINAL_THIRD_X = PITCH_HALF_L / 3
+/** Team dynamics are evaluated every 10 s, over 5-minute windows. */
+export const DYNAMICS_EVERY_S = 10
+export const DYNAMICS_WINDOW_S = 300
+/** A team's signal of one kind is not repeated within this time. */
+export const SIGNAL_COOLDOWN_S = 300
+export const PRESSURE_SHIFT = { rise: 0.15, minPressures: 10 } as const
+/** A shot adds this many times its xG to its team's momentum (passes and carries add their gain in threat). */
+export const MOMENTUM_SHOT_WEIGHT = 3
+/** A momentum swing: the team's mean momentum share over 5 minutes rises this much over the previous 5, to at least `level`. */
+export const MOMENTUM_SWING = { level: 0.55, rise: 0.2 } as const
+export const CHAOS_SPIKE = { level: 0.7, rise: 0.2 } as const
+/** Scales of the chaos components (each component is capped at 1). */
+export const CHAOS_SCALE = { turnoversPerMin: 6, passesPerPossession: 9, momentumSd: 0.3 } as const
+/** Substitution impact compares the team's momentum share over 10 minutes before and after. */
+export const SUB_IMPACT = { windowS: 600, change: 0.15 } as const
 export const PLAYER_MILESTONES: Readonly<Record<string, ReadonlyArray<number>>> = { passes_completed: [50, 75, 100], goals: [2, 3], tackles_won: [5] }
 
 export interface QueryOptions {
@@ -77,6 +99,14 @@ export class StatsEngine {
   private readonly signalIds = new Set<string>()
   private readonly frames = new Map<number, TrackFrame>()
   private readonly tallies = new Map<string, Map<string, number>>()
+  private readonly momentum: Momentum
+  /** The home team's momentum share, sampled every 10 s (the away share is 1 minus it). */
+  private readonly momSamples = new Series()
+  private readonly lastSignal = new Map<string, number>()
+  /** A frame whose 10-second checks run once every input of its tick is in (see ingest). */
+  private pendingDynamics: TrackFrame | null = null
+  /** Substitutions awaiting their impact check; a team's changes at the same moment are judged together. */
+  private readonly pendingSubs: Array<{ readonly team: TeamInfo; readonly tick: number; readonly events: DomainEvent[] }> = []
 
   constructor(
     readonly info: MatchInfo,
@@ -88,6 +118,11 @@ export class StatsEngine {
     }
     this.speedWindow = Math.max(1, Math.round(0.5 / info.dt))
     this.ballWindow = Math.max(1, Math.round(0.2 / info.dt))
+    this.momentum = new Momentum(info.dt)
+  }
+
+  opponentOf(team: TeamInfo): TeamInfo {
+    return team.side === "home" ? this.info.away : this.info.home
   }
 
   /** The latest tick ingested. */
@@ -114,6 +149,9 @@ export class StatsEngine {
 
   ingest(input: StatsInput): ReadonlyArray<Signal> {
     const before = this.signals.length
+    // A tick's team-dynamics checks wait until the next tick starts, so events arriving after the frame count too.
+    const tick = input.kind === "frame" ? input.frame.tick : emittedAt(input.event)
+    if (this.pendingDynamics && tick > this.pendingDynamics.tick) this.flushDynamics()
     if (input.kind === "frame") {
       const f = input.frame
       if (f.tick <= this.lastFrameTick || f.tick < this.lastEventTick)
@@ -125,7 +163,6 @@ export class StatsEngine {
       this.onFrame(f)
     } else {
       const e = input.event
-      const tick = emittedAt(e)
       if (tick < this.lastFrameTick) throw new StatsError(`input out of order: event ${e.id} (tick ${tick}) after frame ${this.lastFrameTick}`)
       this.lastEventTick = Math.max(this.lastEventTick, tick)
       this.events.push(e)
@@ -135,6 +172,19 @@ export class StatsEngine {
     return this.signals.slice(before)
   }
 
+  /** Run the checks still pending for the last tick; call once the stream ends. */
+  finish(): ReadonlyArray<Signal> {
+    const before = this.signals.length
+    this.flushDynamics()
+    return this.signals.slice(before)
+  }
+
+  private flushDynamics(): void {
+    const f = this.pendingDynamics
+    this.pendingDynamics = null
+    if (f) this.dynamics(f)
+  }
+
   protected onEvent(e: DomainEvent, tick: number): void {
     const team = e.team_id === null ? undefined : this.teamById.get(e.team_id)
     switch (e.type) {
@@ -157,6 +207,28 @@ export class StatsEngine {
       }
       case "tackle":
         if (e.player_id && e.outcome === "won") this.tally(e, "tackles_won")
+        // A foul in a tackle is also a foul event; count it once.
+        if (team && e.outcome !== "foul") this.defensiveAction(e, tick, team)
+        break
+      case "interception":
+      case "foul":
+        if (team) this.defensiveAction(e, tick, team)
+        break
+      case "pressure":
+        if (team) this.counters.add("pressures", team.id, tick, 1)
+        break
+      case "carry":
+        if (team && e.x !== null && e.y !== null && e.x_end !== null && e.y_end !== null) this.addThreat(team, tick, e.x, e.y, e.x_end, e.y_end)
+        break
+      case "possession_change":
+        this.counters.add("turnovers", "match", tick, 1)
+        break
+      case "substitution":
+        if (team) {
+          const same = this.pendingSubs.find((p) => p.team === team && p.tick === tick)
+          if (same) same.events.push(e)
+          else this.pendingSubs.push({ team, tick, events: [e] })
+        }
         break
     }
   }
@@ -184,6 +256,20 @@ export class StatsEngine {
       })
     }
     if (ok && e.player_id) this.tally(e, "passes_completed")
+    const ax = attackX(team.side, e.x!)
+    if (ax < PPDA_LINE_X) this.counters.add("ppda_passes", this.opponentOf(team).id, tick, 1)
+    if (ax > FINAL_THIRD_X) this.counters.add("final_third", team.id, tick, 1)
+    if (ok) this.addThreat(team, tick, e.x!, e.y!, e.x_end!, e.y_end!)
+  }
+
+  /** A tackle, interception or foul in the opponent's own 60 % of the pitch counts for PPDA. */
+  private defensiveAction(e: DomainEvent, tick: number, team: TeamInfo): void {
+    if (e.x !== null && attackX(team.side, e.x) > -PPDA_LINE_X) this.counters.add("ppda_actions", team.id, tick, 1)
+  }
+
+  private addThreat(team: TeamInfo, tick: number, x: number, y: number, xEnd: number, yEnd: number): void {
+    const attack = team.side === "home" ? 1 : -1
+    this.momentum.add(team.id, tick, threatAt(xEnd, yEnd, attack) - threatAt(x, y, attack))
   }
 
   private onShot(e: DomainEvent, tick: number, team: TeamInfo): void {
@@ -192,6 +278,7 @@ export class StatsEngine {
     // Peak ball speed in the 0.3 s after the strike (frames up to the shot's resolution).
     const speed = this.ballSpeedMax(e.frame_id, Math.min(e.frame_id + this.ticks(0.3), tick))
     this.derived.set(e.id, speed === null ? { "shot.xg": xg } : { "shot.xg": xg, "shot.speed": speed })
+    this.momentum.add(team.id, tick, MOMENTUM_SHOT_WEIGHT * xg)
     for (const subject of [e.player_id, team.id]) {
       if (subject === null) continue
       this.counters.add("shots", subject, tick, 1)
@@ -290,6 +377,105 @@ export class StatsEngine {
       this.counters.add("inplay", "match", f.tick, 1)
       if (f.possession_side) this.counters.add("poss", (f.possession_side === "home" ? this.info.home : this.info.away).id, f.tick, 1)
     }
+    if (f.tick % this.ticks(DYNAMICS_EVERY_S) === 0) this.pendingDynamics = f
+  }
+
+  private cooledDown(key: string, tick: number): boolean {
+    const last = this.lastSignal.get(key)
+    return last === undefined || tick - last >= this.ticks(SIGNAL_COOLDOWN_S)
+  }
+
+  /** Every 10 s: sample momentum, then check for pressure shifts, momentum swings, chaos spikes and substitution impact. */
+  private dynamics(f: TrackFrame): void {
+    const t = f.tick
+    const w = this.ticks(DYNAMICS_WINDOW_S)
+    const home = this.momentum.share(this.info.home.id, this.info.away.id, t)
+    if (home !== null) this.momSamples.push(t, home)
+    const r3 = (v: number) => Math.round(v * 1000) / 1000
+
+    for (const team of [this.info.home, this.info.away]) {
+      if (t - w < 0) break
+      const now = this.compute("team.press", team.id, t, t - w)
+      const before = this.compute("team.press", team.id, t - w, t - 2 * w)
+      const pressures = this.counters.between("pressures", team.id, t - w, t)
+      if (now !== null && before !== null && pressures >= PRESSURE_SHIFT.minPressures && now - before >= PRESSURE_SHIFT.rise && this.cooledDown(`press|${team.id}`, t)) {
+        this.lastSignal.set(`press|${team.id}`, t)
+        this.raise("pressure_shift", f, {
+          team_id: team.id, player_id: null, metric: "team.press", value: r3(now), frame_from: t - w, frame_to: t,
+          salience: Math.min(0.9, 0.5 + (now - before)), evidence: [`team.press@${t - w}-${t}`], data: { before: r3(before), after: r3(now), pressures }
+        })
+      }
+    }
+
+    if (t - w >= 0)
+      for (const team of [this.info.home, this.info.away]) {
+        const now = this.compute("team.mom", team.id, t, t - w)
+        const before = this.compute("team.mom", team.id, t - w, t - 2 * w)
+        if (now !== null && before !== null && now >= MOMENTUM_SWING.level && now - before >= MOMENTUM_SWING.rise && this.cooledDown(`mom|${team.id}`, t)) {
+          this.lastSignal.set(`mom|${team.id}`, t)
+          this.raise("momentum_swing", f, {
+            team_id: team.id, player_id: null, metric: "team.mom", value: r3(now), frame_from: t - w, frame_to: t,
+            salience: Math.min(0.8, 0.4 + (now - before)), evidence: [`team.mom@${t - w}-${t}`], data: { before: r3(before), after: r3(now) }
+          })
+        }
+      }
+
+    if (t - w >= 0) {
+      const chaos = this.chaosAt(t)
+      const before = this.chaosAt(t - w)
+      if (chaos !== null && before !== null && chaos >= CHAOS_SPIKE.level && chaos - before >= CHAOS_SPIKE.rise && this.cooledDown("chaos", t)) {
+        this.lastSignal.set("chaos", t)
+        this.raise("chaos_spike", f, {
+          team_id: null, player_id: null, metric: "game.chaos", value: r3(chaos), frame_from: t - w, frame_to: t,
+          salience: 0.5, evidence: [`game.chaos@${t - w}-${t}`], data: { before: r3(before), after: r3(chaos) }
+        })
+      }
+    }
+
+    const sw = this.ticks(SUB_IMPACT.windowS)
+    for (let i = 0; i < this.pendingSubs.length; i++) {
+      const sub = this.pendingSubs[i]!
+      if (t < sub.tick + sw) continue
+      this.pendingSubs.splice(i--, 1)
+      const mean = (from: number, to: number) => {
+        let sum = 0
+        let n = 0
+        for (let j = this.momSamples.indexAt(to); j >= 0 && this.momSamples.ticks[j]! > from; j--) {
+          sum += sub.team.side === "home" ? this.momSamples.values[j]! : 1 - this.momSamples.values[j]!
+          n++
+        }
+        return n ? sum / n : null
+      }
+      const before = mean(sub.tick - sw, sub.tick)
+      const after = mean(sub.tick, sub.tick + sw)
+      if (before === null || after === null || Math.abs(after - before) < SUB_IMPACT.change) continue
+      const on = typeof sub.events[0]!.attrs.player_on === "string" ? sub.events[0]!.attrs.player_on : null
+      this.raise("substitution_impact", f, {
+        team_id: sub.team.id, player_id: on, metric: "team.mom", value: r3(after - before), frame_from: sub.tick, frame_to: t,
+        salience: Math.min(0.8, 0.4 + Math.abs(after - before)), evidence: [...sub.events.map((e) => e.id), `team.mom@${sub.tick - sw}-${sub.tick + sw}`], data: { before: r3(before), after: r3(after), substitutions: sub.events.length }
+      })
+    }
+  }
+
+  /**
+   * Control vs chaos over the 5 minutes to `at`: turnovers per minute, passes per possession (fewer is more
+   * chaotic) and the spread of the momentum share, each scaled to 0..1 and averaged. Null in the first minute.
+   */
+  chaosAt(at: number): number | null {
+    const w = this.ticks(DYNAMICS_WINDOW_S)
+    const from = Math.max(-1, at - w)
+    const minutes = ((at - from) * this.info.dt) / 60
+    if (minutes < 1) return null
+    const turnovers = this.counters.between("turnovers", "match", from, at)
+    const passes = this.counters.between("passes", this.info.home.id, from, at) + this.counters.between("passes", this.info.away.id, from, at)
+    const samples: number[] = []
+    for (let i = this.momSamples.indexAt(at); i >= 0 && this.momSamples.ticks[i]! > from; i--) samples.push(this.momSamples.values[i]!)
+    const mean = samples.reduce((a, b) => a + b, 0) / Math.max(1, samples.length)
+    const sd = samples.length > 1 ? Math.sqrt(samples.reduce((a, v) => a + (v - mean) ** 2, 0) / samples.length) : 0
+    const c1 = Math.min(1, turnovers / minutes / CHAOS_SCALE.turnoversPerMin)
+    const c2 = 1 - Math.min(1, passes / Math.max(1, turnovers) / CHAOS_SCALE.passesPerPossession)
+    const c3 = Math.min(1, sd / CHAOS_SCALE.momentumSd)
+    return (c1 + c2 + c3) / 3
   }
 
   private onSpeed(id: string, team: TeamInfo, f: TrackFrame, kmh: number): void {
@@ -391,6 +577,32 @@ export class StatsEngine {
         return this.counters.between("xg", subject, from, at)
       case "shot.speed":
         return ratio(this.counters.between("shot_speed", subject, from, at), this.counters.between("shot_speed_n", subject, from, at))
+      case "team.press": {
+        const opp = this.opponentOf(this.teamById.get(subject)!)
+        const p = this.counters.between("pressures", subject, from, at)
+        return ratio(p, p + this.counters.between("passes", opp.id, from, at))
+      }
+      case "ppda":
+        return ratio(this.counters.between("ppda_passes", subject, from, at), this.counters.between("ppda_actions", subject, from, at))
+      case "tilt": {
+        const opp = this.opponentOf(this.teamById.get(subject)!)
+        const own = this.counters.between("final_third", subject, from, at)
+        return ratio(own, own + this.counters.between("final_third", opp.id, from, at))
+      }
+      case "team.mom": {
+        const home = subject === this.info.home.id
+        if (from === null) return this.momentum.share(subject, this.opponentOf(this.teamById.get(subject)!).id, at)
+        // Over a window: the mean of the 10-second samples.
+        let sum = 0
+        let n = 0
+        for (let i = this.momSamples.indexAt(at); i >= 0 && this.momSamples.ticks[i]! > from; i--) {
+          sum += home ? this.momSamples.values[i]! : 1 - this.momSamples.values[i]!
+          n++
+        }
+        return n ? sum / n : null
+      }
+      case "game.chaos":
+        return this.chaosAt(at)
       case "team.poss":
         return ratio(this.counters.between("poss", subject, from, at), this.counters.between("inplay", "match", from, at))
       default:
PATCH
```

- [ ] **Step 4: Run the tests**

Run: `pnpm --filter @touchline/stats test team`
Expected: 11 passed (the two scenario tests replay six scripted matches each, about 30 s)

Run: `pnpm --filter @touchline/stats test && pnpm --filter @touchline/stats typecheck`
Expected: 36 passed; no type errors

- [ ] **Step 5: Commit**

```bash
git add packages/stats
git commit -m "feat(stats): pressure index, PPDA, field tilt, momentum and chaos; pressure shift, momentum swing, chaos spike and substitution impact signals

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```



### Task 6: Replay, Effect streams, `pnpm stats` and the golden match

`readRun` replays a run folder written by `pnpm sim`: it decodes `domain.jsonl` with the schema (a bad line is a `ReplayError` naming file and line), reads `tracking.jsonl` line by line and merges the two in emission order (global tick = the period's offset, taken from the events, plus the CDF frame id). Names and roles come from the league file when given (CDF meta has neither; a player's role is then null). `stepInputs` turns a live match's steps into inputs and `signalStream` runs the engine over any input stream, emitting signals as they are raised and the last tick's checks at the end. `pnpm stats --run <folder>` prints the score, the team metrics, the signal counts and the most salient signals (`--signals <file>` also writes them all as JSONL). The tests pin the engine's promises on a scripted match (late_comeback, seed 4245, default parameters): live and replayed runs give identical signals and metric values; a query about tick t gives the same answer before and after the engine has seen later input; a goal-heavy match raises a manageable number of signals; and a golden summary (team metrics at full time, every signal id and value) is committed, rewritten with `UPDATE_STATS_GOLDEN=1` after an intended change.

**Files:**
- Create: `packages/stats/src/replay.ts`, `packages/stats/src/stream.ts`, `packages/stats/src/summary.ts`, `packages/stats/src/cli.ts`, `packages/stats/test/golden/late-comeback-4245.json` (generated)
- Modify: `packages/stats/src/input.ts` (`PlayerInfo.role` may be null), `packages/stats/src/index.ts`, `packages/stats/package.json` (script and `@touchline/sim` dependency), `package.json` (`pnpm stats`), `README.md`
- Test: `packages/stats/test/replay.test.ts`

**Interfaces:**
- Consumes: Tasks 3-5's engine; `writeMatch`, `matchSteps`, `SCENARIOS`, `cliOptions` (`@touchline/sim`); `decodeDomainEvent` (`@touchline/schema`).
- Produces: `class ReplayError`, `interface Roster {clubs}`, `interface Replay {info, inputs: Stream<StatsInput, ReplayError>}`, `infoFromMeta(meta, roster?)`, `readRun(dir, roster?): Effect<Replay, ReplayError>`; `stepInputs(steps)`, `signalStream(engine, inputs)`; `summary(engine, top?)`; CLI `pnpm stats --run <dir> [--signals <file>]`.

- [ ] **Step 1: Write the failing tests**

Create `packages/stats/test/replay.test.ts`:

```ts
import { spawnSync } from "node:child_process"
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { Effect, Stream } from "effect"
import { beforeAll, describe, expect, it } from "vitest"
import type { MetricId, Signal } from "@touchline/schema"
import type { League } from "@touchline/league"
import { matchSteps, SCENARIOS, writeMatch } from "@touchline/sim"
import { DEFAULT_PARAMS, type MatchConfig } from "@touchline/sim-core"
import { METRICS } from "../src/catalog.js"
import { StatsEngine } from "../src/engine.js"
import { emittedAt, infoFromConfig, type StatsInput } from "../src/input.js"
import { readRun, ReplayError } from "../src/replay.js"
import { signalStream, stepInputs } from "../src/stream.js"
import { models, root } from "./helpers.js"

const M = models()
const league = JSON.parse(readFileSync(join(root, "data/league/league.json"), "utf8")) as League
const club = (id: string) => league.clubs.find((c) => c.id === id)!
const collect = <A, E>(s: Stream.Stream<A, E>) => Effect.runPromise(Stream.runCollect(s)).then((c) => Array.from(c))

/** Every metric for every subject it is defined for, at a tick. */
const snapshot = (eng: StatsEngine, at: number) => {
  const subjects = { match: ["match"], team: [eng.info.home.id, eng.info.away.id], player: [...eng.info.home.players, ...eng.info.away.players].map((p) => p.id) }
  const out: Record<string, number | null> = {}
  for (const m of METRICS) for (const kind of m.subjects) for (const s of subjects[kind]) out[`${m.id}|${s}`] = eng.value(m.id as MetricId, s, { at })
  return out
}

const byTick = (a: Signal, b: Signal) => a.frame_id - b.frame_id || a.id.localeCompare(b.id)

describe("replay and streams", () => {
  // A scripted match (its last window runs to full time, so carries and flights are cut short by the whistle).
  const sc = SCENARIOS.late_comeback!
  const cfg: MatchConfig = { matchId: "golden", seed: 4245, kickoffTime: "2026-10-18T14:00:00.000Z", home: club(sc.home), away: club(sc.away), params: DEFAULT_PARAMS, dt: 0.1, script: sc.script }
  const dir = mkdtempSync(join(tmpdir(), "touchline-stats-"))
  let live: StatsEngine
  let liveSignals: Signal[]
  let replay: StatsEngine
  let replaySignals: Signal[]
  let inputs: StatsInput[]

  beforeAll(async () => {
    await Effect.runPromise(writeMatch(cfg, dir))
    live = new StatsEngine(infoFromConfig(cfg), M)
    liveSignals = await collect(signalStream(live, stepInputs(matchSteps(cfg))))
    const run = await Effect.runPromise(readRun(dir, league))
    replay = new StatsEngine(run.info, M)
    inputs = await collect(run.inputs)
    replaySignals = await collect(signalStream(replay, Stream.fromIterable(inputs)))
  }, 120_000)

  it("give the same signals and metrics live and from the run folder", () => {
    expect(liveSignals.length).toBeGreaterThan(20)
    // Even an eleven-goal scripted match raises a manageable number of signals, none of one kind in bulk.
    expect(liveSignals.length).toBeLessThan(150)
    for (const type of new Set(liveSignals.map((s) => s.type))) expect(liveSignals.filter((s) => s.type === type).length, type).toBeLessThanOrEqual(40)
    expect([...replaySignals].sort(byTick)).toEqual([...liveSignals].sort(byTick))
    expect(replay.score).toEqual(live.score)
    for (const at of [1_000, 20_000, live.now]) expect(snapshot(replay, at)).toEqual(snapshot(live, at))
  })

  it("answer a query about tick t the same before and after seeing what came later", () => {
    for (const t of [12_345, 40_000]) {
      const partial = new StatsEngine(replay.info, M)
      for (const i of inputs) if ((i.kind === "frame" ? i.frame.tick : emittedAt(i.event)) <= t) partial.ingest(i)
      partial.finish()
      expect(snapshot(partial, t)).toEqual(snapshot(replay, t))
      expect([...partial.signals].sort(byTick)).toEqual(replay.signals.filter((s) => s.frame_id <= t).sort(byTick))
    }
  })

  it("match the committed golden summary (UPDATE_STATS_GOLDEN=1 rewrites it after an intended change)", () => {
    const r = (v: number | null) => (v === null ? null : Math.round(v * 1e6) / 1e6)
    const summary = {
      score: live.score,
      metrics: Object.fromEntries(Object.entries(snapshot(live, live.now)).filter(([k]) => !k.includes("|p-")).map(([k, v]) => [k, r(v)])),
      signals: [...liveSignals].sort(byTick).map((s) => [s.id, r(s.value)])
    }
    const path = join(root, "packages/stats/test/golden/late-comeback-4245.json")
    if (process.env.UPDATE_STATS_GOLDEN === "1") writeFileSync(path, JSON.stringify(summary, null, 1) + "\n")
    expect(summary).toEqual(JSON.parse(readFileSync(path, "utf8")))
  })

  it("name players from the league file, and fall back to ids without it", async () => {
    expect(replay.info.home.players[0]).toMatchObject({ name: (club(sc.home).starters[0] as { name?: string }).name, role: "GK" })
    const bare = await Effect.runPromise(readRun(dir))
    expect(bare.info.home.players[0]).toMatchObject({ name: bare.info.home.players[0]!.id, role: null })
  })

  it("print a summary from the command line, and refuse a missing --run with status 2", () => {
    const cli = (args: string[]) => spawnSync("npx", ["tsx", "src/cli.ts", ...args], { cwd: join(root, "packages/stats"), encoding: "utf8" })
    const ok = cli(["--run", dir])
    expect(ok.status).toBe(0)
    expect(ok.stdout).toContain(`${cfg.home.name} ${live.score.home}-${live.score.away} ${cfg.away.name}`)
    expect(ok.stdout).toMatch(/Signals: \d+ \(/)
    const bad = cli([])
    expect(bad.status).toBe(2)
    expect(bad.stderr).toContain("--run is required")
  })

  it("report a missing or malformed run folder as a ReplayError naming the file", async () => {
    const missing = await Effect.runPromise(Effect.flip(readRun(join(dir, "nope"))))
    expect(missing).toBeInstanceOf(ReplayError)
    expect(missing.message).toMatch(/meta\.json/)
    const bad = mkdtempSync(join(tmpdir(), "touchline-bad-"))
    writeFileSync(join(bad, "meta.json"), readFileSync(join(dir, "meta.json")))
    writeFileSync(join(bad, "domain.jsonl"), readFileSync(join(dir, "domain.jsonl"), "utf8").split("\n").slice(0, 3).join("\n") + '\n{"type":"dance"}\n')
    const err = await Effect.runPromise(Effect.flip(readRun(bad)))
    expect(err.message).toMatch(/domain\.jsonl:4/)
  })
})
```

- [ ] **Step 2: Run them to make sure they fail**

Run: `pnpm --filter @touchline/stats test replay`
Expected: the file fails to load: `Cannot find module '../src/replay.js'`

- [ ] **Step 3: Implement replay, streams, the summary and the CLI**

Create `packages/stats/src/replay.ts`:

```ts
import { createReadStream, existsSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { createInterface } from "node:readline"
import { Effect, Stream } from "effect"
import { decodeDomainEvent, type DomainEvent } from "@touchline/schema"
import type { Role } from "@touchline/sim-core"
import { emittedAt, type MatchInfo, type StatsInput, type TeamInfo, type TrackFrame } from "./input.js"

/** A run folder that cannot be replayed (missing or malformed file). */
export class ReplayError extends Error {}

/** Clubs whose players' names and roles fill in what CDF meta leaves out (data/league/league.json). */
export interface Roster {
  readonly clubs: ReadonlyArray<{
    readonly id: string
    readonly starters: ReadonlyArray<{ readonly id: string; readonly role: Role; readonly name?: string }>
    readonly bench?: ReadonlyArray<{ readonly id: string; readonly role: Role; readonly name?: string }>
  }>
}

export interface Replay {
  readonly info: MatchInfo
  /** Every event and frame, merged in emission order (events of a tick before its frame). */
  readonly inputs: Stream.Stream<StatsInput, ReplayError>
}

interface CdfMeta {
  readonly match: { readonly id: string }
  readonly teams: Record<"home" | "away", { readonly id: string; readonly name: string; readonly players: ReadonlyArray<{ readonly id: string; readonly jersey_number: number }> }>
  readonly meta: { readonly tracking: { readonly fps: number } }
}

interface CdfFrame {
  readonly frame_id: number
  readonly period: "first_half" | "second_half"
  readonly teams: Record<"home" | "away", { readonly players: ReadonlyArray<{ readonly id: string; readonly x: number; readonly y: number }> }>
  readonly ball: { readonly x: number; readonly y: number; readonly z: number; readonly status?: boolean; readonly poss_team_id?: string }
}

const readJson = (path: string): unknown => {
  if (!existsSync(path)) throw new ReplayError(`missing ${path}`)
  try {
    return JSON.parse(readFileSync(path, "utf8"))
  } catch (e) {
    throw new ReplayError(`${path}: ${e instanceof Error ? e.message : String(e)}`)
  }
}

const readEvents = (path: string): DomainEvent[] => {
  if (!existsSync(path)) throw new ReplayError(`missing ${path}`)
  return readFileSync(path, "utf8")
    .split("\n")
    .filter((l) => l.trim() !== "")
    .map((l, i) => {
      try {
        return decodeDomainEvent(JSON.parse(l))
      } catch (e) {
        throw new ReplayError(`${path}:${i + 1}: ${e instanceof Error ? e.message.split("\n")[0] : String(e)}`)
      }
    })
}

/** Match info from CDF meta, with names and roles from the roster when it has the clubs. */
export const infoFromMeta = (meta: CdfMeta, roster?: Roster): MatchInfo => {
  const team = (side: "home" | "away"): TeamInfo => {
    const t = meta.teams[side]
    const club = roster?.clubs.find((c) => c.id === t.id)
    const known = new Map([...(club?.starters ?? []), ...(club?.bench ?? [])].map((p) => [p.id, p]))
    return { id: t.id, name: t.name, side, players: t.players.map((p) => ({ id: p.id, name: known.get(p.id)?.name ?? p.id, role: known.get(p.id)?.role ?? null, jersey: p.jersey_number })) }
  }
  return { matchId: meta.match.id, dt: 1 / meta.meta.tracking.fps, home: team("home"), away: team("away") }
}

/**
 * Replay a run folder written by `pnpm sim` (meta.json, domain.jsonl, tracking.jsonl): the exact domain events and
 * the tracking frames, merged in the order the simulator emitted them. Tracking is read line by line.
 */
export const readRun = (dir: string, roster?: Roster): Effect.Effect<Replay, ReplayError> =>
  Effect.try({
    try: () => {
      const meta = readJson(join(dir, "meta.json")) as CdfMeta
      if (!meta?.teams?.home || !meta?.meta?.tracking?.fps) throw new ReplayError(`${join(dir, "meta.json")}: not CDF match meta`)
      const info = infoFromMeta(meta, roster)
      const events = readEvents(join(dir, "domain.jsonl"))
      // Global tick = the period's offset + the CDF frame id; every event carries both.
      const offset = new Map<string, number>()
      for (const e of events) if (!offset.has(e.period)) offset.set(e.period, e.frame_id - e.period_frame_id)
      const ordered = events.map((e, i) => ({ e, i, t: emittedAt(e) })).sort((a, b) => a.t - b.t || a.i - b.i)
      const trackingPath = join(dir, "tracking.jsonl")
      if (!existsSync(trackingPath)) throw new ReplayError(`missing ${trackingPath}`)
      const toFrame = (c: CdfFrame): TrackFrame => ({
        tick: (offset.get(c.period) ?? 0) + c.frame_id,
        frame_id: c.frame_id,
        period: c.period,
        home: c.teams.home.players,
        away: c.teams.away.players,
        ball: { x: c.ball.x, y: c.ball.y, z: c.ball.z },
        ball_in_play: c.ball.status === true,
        possession_side: c.ball.poss_team_id === info.home.id ? "home" : c.ball.poss_team_id === info.away.id ? "away" : null
      })
      async function* merged(): AsyncGenerator<StatsInput> {
        let i = 0
        let n = 0
        for await (const line of createInterface({ input: createReadStream(trackingPath), crlfDelay: Infinity })) {
          n++
          if (line.trim() === "") continue
          let f: TrackFrame
          try {
            f = toFrame(JSON.parse(line) as CdfFrame)
          } catch (e) {
            throw new ReplayError(`${trackingPath}:${n}: ${e instanceof Error ? e.message : String(e)}`)
          }
          while (i < ordered.length && ordered[i]!.t <= f.tick) yield { kind: "event", event: ordered[i++]!.e }
          yield { kind: "frame", frame: f }
        }
        while (i < ordered.length) yield { kind: "event", event: ordered[i++]!.e }
      }
      return { info, inputs: Stream.fromAsyncIterable(merged(), (e) => (e instanceof ReplayError ? e : new ReplayError(String(e)))) }
    },
    catch: (e) => (e instanceof ReplayError ? e : new ReplayError(String(e)))
  })
```

Create `packages/stats/src/stream.ts`:

```ts
import { Stream } from "effect"
import type { Signal } from "@touchline/schema"
import type { StepOutput } from "@touchline/sim-core"
import type { StatsEngine } from "./engine.js"
import type { StatsInput } from "./input.js"

/** A live match's steps as stats inputs: each step's events, then its frame. */
export const stepInputs = <E, R>(steps: Stream.Stream<StepOutput, E, R>): Stream.Stream<StatsInput, E, R> =>
  steps.pipe(
    Stream.map((r): StatsInput[] => [...r.events.map((event) => ({ kind: "event" as const, event })), ...(r.frame ? [{ kind: "frame" as const, frame: r.frame }] : [])]),
    Stream.flattenIterable
  )

/**
 * Feed a stream of inputs to the engine and emit the signals as they are raised (the hot path, spec §4); the
 * last tick's checks run when the input stream ends. The engine keeps every metric for queries.
 */
export const signalStream = <E, R>(engine: StatsEngine, inputs: Stream.Stream<StatsInput, E, R>): Stream.Stream<Signal, E, R> =>
  inputs.pipe(
    Stream.map((i) => engine.ingest(i)),
    Stream.flattenIterable,
    Stream.concat(Stream.suspend(() => Stream.fromIterable(engine.finish())))
  )
```

Create `packages/stats/src/summary.ts`:

```ts
import type { MetricId } from "@touchline/schema"
import { metricDef } from "./catalog.js"
import type { StatsEngine } from "./engine.js"

const TEAM_METRICS: ReadonlyArray<MetricId> = ["team.poss", "pass.acc", "pass.xp", "pass.dist", "shot.xg", "shot.speed", "team.press", "ppda", "tilt", "team.mom", "plyr.dist"]

const fmt = (v: number | null, unit: string) => (v === null ? "-" : unit === "share" ? `${(v * 100).toFixed(1)} %` : unit === "m" && v > 1000 ? `${(v / 1000).toFixed(1)} km` : v.toFixed(2))

/** A plain-text match summary: score, team metrics over the whole match, signal counts and the most salient signals. */
export const summary = (eng: StatsEngine, top = 12): string => {
  const { home, away } = eng.info
  const name = (id: string | null) => (id === null ? "" : ([...home.players, ...away.players].find((p) => p.id === id)?.name ?? eng.team(id)?.name ?? id))
  const lines = [`${home.name} ${eng.score.home}-${eng.score.away} ${away.name}`, ""]
  lines.push(`${"metric".padEnd(36)}${home.name.padStart(22)}${away.name.padStart(22)}`)
  for (const id of TEAM_METRICS) {
    const def = metricDef(id)!
    const v = (t: string) => fmt(eng.value(id, t, { windowS: null }), def.unit)
    lines.push(`${`${def.name} (${id})`.padEnd(36)}${v(home.id).padStart(22)}${v(away.id).padStart(22)}`)
  }
  const counts = new Map<string, number>()
  for (const s of eng.signals) counts.set(s.type, (counts.get(s.type) ?? 0) + 1)
  lines.push("", `Signals: ${eng.signals.length} (${[...counts].map(([k, n]) => `${k} ${n}`).join(", ")})`)
  const best = [...eng.signals].sort((a, b) => b.salience - a.salience || a.frame_id - b.frame_id).slice(0, top).sort((a, b) => a.frame_id - b.frame_id)
  for (const s of best)
    lines.push(`  ${s.match_clock}  ${s.type.padEnd(25)} ${(name(s.player_id) || name(s.team_id)).padEnd(24)} ${s.metric ?? ""}${s.value === null ? "" : ` = ${s.value}`}`)
  return lines.join("\n")
}
```

Create `packages/stats/src/cli.ts`:

```ts
import { existsSync, readFileSync, writeFileSync } from "node:fs"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { Effect, Stream } from "effect"
import { CliError, cliOptions, exitOnUserError } from "@touchline/sim"
import { StatsEngine } from "./engine.js"
import { modelsFromJson } from "./models.js"
import { readRun, ReplayError, type Roster } from "./replay.js"
import { signalStream } from "./stream.js"
import { summary } from "./summary.js"

const root = join(dirname(fileURLToPath(import.meta.url)), "../../..")
// pnpm runs package scripts from the package folder; INIT_CWD is where the user typed the command.
const here = (p: string) => resolve(process.env.INIT_CWD ?? process.cwd(), p)

const o = cliOptions("touchline-stats: replay a run folder through the stats engine and print metrics and signals", {
  run: { default: "", help: "run folder written by pnpm sim (meta.json, domain.jsonl, tracking.jsonl)" },
  signals: { default: "", help: "also write every signal to this JSONL file" }
})
exitOnUserError(() => {
  if (o.run === "") throw new CliError("--run is required (a folder written by pnpm sim, e.g. out/m-1)")
})
const models = modelsFromJson(JSON.parse(readFileSync(join(root, "data/params/stats-models.json"), "utf8")))
const leaguePath = join(root, "data/league/league.json")
const roster = existsSync(leaguePath) ? (JSON.parse(readFileSync(leaguePath, "utf8")) as Roster) : undefined

const program = Effect.gen(function* () {
  const run = yield* readRun(here(o.run), roster)
  const engine = new StatsEngine(run.info, models)
  const signals = Array.from(yield* Stream.runCollect(signalStream(engine, run.inputs)))
  if (o.signals) writeFileSync(here(o.signals), signals.map((s) => JSON.stringify(s)).join("\n") + "\n")
  console.log(summary(engine))
})
Effect.runPromise(program).catch((e) => {
  if (e instanceof ReplayError) {
    console.error(e.message)
    process.exit(2)
  }
  throw e
})
```

Apply this change to `packages/stats/src/input.ts`, `packages/stats/src/index.ts`, `packages/stats/package.json`, `package.json` (from the repository root):

```bash
git apply <<'PATCH'
diff --git a/package.json b/package.json
index a3dfb14..ff3d3bb 100644
--- a/package.json
+++ b/package.json
@@ -10,7 +10,8 @@
     "sim": "pnpm --filter @touchline/sim run sim",
     "league": "pnpm --filter @touchline/league run generate",
     "calibrate": "pnpm --filter @touchline/calibrate run calibrate",
-    "realism": "pnpm --filter @touchline/calibrate run realism"
+    "realism": "pnpm --filter @touchline/calibrate run realism",
+    "stats": "pnpm --filter @touchline/stats run stats"
   },
   "devDependencies": {
     "@types/node": "22.20.5",
diff --git a/packages/stats/package.json b/packages/stats/package.json
index 1440e2e..0b45c1b 100644
--- a/packages/stats/package.json
+++ b/packages/stats/package.json
@@ -3,8 +3,21 @@
   "version": "0.1.0",
   "private": true,
   "type": "module",
-  "exports": { ".": "./src/index.ts" },
-  "scripts": { "test": "vitest run", "typecheck": "tsc --noEmit -p ." },
-  "dependencies": { "@touchline/schema": "workspace:*", "@touchline/sim-core": "workspace:*", "effect": "4.0.0" },
-  "devDependencies": { "@touchline/league": "workspace:*", "@touchline/sim": "workspace:*" }
+  "exports": {
+    ".": "./src/index.ts"
+  },
+  "scripts": {
+    "test": "vitest run",
+    "typecheck": "tsc --noEmit -p .",
+    "stats": "tsx src/cli.ts"
+  },
+  "dependencies": {
+    "@touchline/schema": "workspace:*",
+    "@touchline/sim": "workspace:*",
+    "@touchline/sim-core": "workspace:*",
+    "effect": "4.0.0"
+  },
+  "devDependencies": {
+    "@touchline/league": "workspace:*"
+  }
 }
diff --git a/packages/stats/src/index.ts b/packages/stats/src/index.ts
index 9e48a43..3c46cac 100644
--- a/packages/stats/src/index.ts
+++ b/packages/stats/src/index.ts
@@ -1,5 +1,10 @@
 export * from "./catalog.js"
+export * from "./derive.js"
 export * from "./engine.js"
 export * from "./input.js"
 export * from "./models.js"
+export * from "./momentum.js"
+export * from "./replay.js"
 export * from "./store.js"
+export * from "./stream.js"
+export * from "./summary.js"
diff --git a/packages/stats/src/input.ts b/packages/stats/src/input.ts
index 1a8afb2..25ef9fd 100644
--- a/packages/stats/src/input.ts
+++ b/packages/stats/src/input.ts
@@ -32,7 +32,8 @@ export const emittedAt = (e: Pick<DomainEvent, "frame_id" | "frame_id_end">): nu
 export interface PlayerInfo {
   readonly id: string
   readonly name: string
-  readonly role: Role
+  /** Null when unknown (a replay read without the league file). */
+  readonly role: Role | null
   readonly jersey: number
 }
 export interface TeamInfo {
PATCH
```

Run: `pnpm install`
Expected: `@touchline/stats` now depends on `@touchline/sim`

- [ ] **Step 4: Write the golden summary and run the tests**

Run: `mkdir -p packages/stats/test/golden && UPDATE_STATS_GOLDEN=1 pnpm --filter @touchline/stats test replay && pnpm --filter @touchline/stats test replay`
Expected: 6 passed, twice; the golden file records a 7-4 match (default parameters, scripted goals) with 98 signals

Run: `pnpm sim --seed 7 && pnpm stats --run out/m-7`
Expected: `Ironmoor Athletic 0-2 Kestrel Bay FC`, eleven team metrics side by side (possession 43.8 % / 50.8 %, pass accuracy 62.9 % / 67.8 %, xG 0.98 / 1.26), `Signals: 80 (speed_alert 22, pressure_shift 11, momentum_swing 7, goal 2, …)` and the twelve most salient with their clocks, in under 3 s

Run: `pnpm turbo run typecheck test --force`
Expected: `Tasks: 12 successful`

- [ ] **Step 5: Document it**

Apply this change to `README.md` (from the repository root):

````bash
git apply <<'PATCH'
diff --git a/README.md b/README.md
index bda7783..566fa03 100644
--- a/README.md
+++ b/README.md
@@ -41,14 +41,25 @@ uv run --project python/analytics python -m touchline_analytics.stats_models   #
 
 Options for `pnpm sim`: `--seed` (0–4294967295), `--home` / `--away` (club ids in `data/league/league.json`), `--fps` (10, or 25 for video render runs), `--match-id`, `--kickoff` (ISO time), `--out`.
 
+## Stats engine
+
+`packages/stats` turns the domain stream into the metrics of spec §5.2 (pass distance, accuracy and xPass, shot xG and speed, top speed and distance, possession, pressure index, PPDA, field tilt, momentum, control vs chaos) and raises signals when thresholds are crossed (goals, big chances, pressure shifts, momentum swings, chaos spikes, speed and distance alerts, difficult passes, milestones, cards, substitution impact). It is incremental and deterministic: every value is kept as of every tick, so a question about minute 60 gets the same answer during the match and afterwards, and a live run and a replay of its files agree exactly.
+
+```bash
+pnpm sim --seed 7                      # writes out/m-7
+pnpm stats --run out/m-7               # replay it through the stats engine: team metrics, signal counts, top signals
+pnpm stats --run out/m-7 --signals out/m-7/signals.jsonl
+```
+
 ## Packages
 
 | Package | What it does |
 |---|---|
 | `packages/sim-core` | The match engine: one pure, deterministic `step(state)` per 0.1 s tick |
 | `packages/league` | Fictional league generator: 8 clubs, kits, styles, 160 players |
-| `packages/schema` | Effect Schema for the live domain stream (events and frames) |
+| `packages/schema` | Effect Schema for the live domain stream (events and frames) and for signals and metric ids |
 | `packages/sim` | Effect streams, CDF v0.3.2 writers, run manifest, CLI |
+| `packages/stats` | Stats engine: metrics and signals on the domain stream, replay of run folders, `pnpm stats` |
 | `packages/calibrate` | Match statistics (identical to the Python definitions), tuning knobs, tuner, realism gate |
 | `python/analytics` | CDF validation, IDSSE download, real-match targets, realism report, stats-model fitting |
 
PATCH
````

- [ ] **Step 6: Commit**

```bash
git add packages/stats package.json pnpm-lock.yaml README.md
git commit -m "feat(stats): replay of run folders, Effect stream wrapper, pnpm stats CLI; live and replayed runs agree, no query sees the future

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```



### Task 7: MCP stats server

Spec §5.3: agents read the match only through MCP tools, and no agent computes a statistic. `StatsQuery` (in `packages/stats`) answers the read-only questions as of a tick, clamped to what has been ingested: match info with the score at that tick, the catalog, a metric with the frame range it covers and a ref to cite (`metric@from-to`), a series (at most 500 points), players ranked by a metric, signals and events in a frame range (events carry the values the engine derived), the decision record behind an event (action probabilities, ranked options, the rank chosen: what spec §5.3.1's decision-feedback score needs), and a claim check for the Fact-Checker (verified within 2 % of the actual value, at least 0.006, so a share rounded to whole percent passes). `packages/mcp-stats` exposes them as nine tools with the official SDK, all marked read-only; a bad id comes back as a tool error the agent can read. `pnpm -s mcp-stats --run <folder>` serves one match over stdio (stdout carries only the protocol), `--minute 60` serves it as it stood at 60', and `--http <port>` serves stateless Streamable HTTP on 127.0.0.1 (`/mcp`).

**Files:**
- Create: `packages/stats/src/query.ts`, `packages/mcp-stats/package.json`, `packages/mcp-stats/tsconfig.json`, `packages/mcp-stats/vitest.config.ts`, `packages/mcp-stats/src/server.ts`, `packages/mcp-stats/src/load.ts`, `packages/mcp-stats/src/cli.ts`, `packages/mcp-stats/src/index.ts`
- Modify: `packages/stats/src/index.ts`, `package.json` (`pnpm mcp-stats`), `README.md`
- Test: `packages/mcp-stats/test/server.test.ts`

**Interfaces:**
- Consumes: Task 6's `readRun`, `Roster`; the engine's `value`, `events`, `eventTicks`, `derived`, `signals`.
- Produces: `interface MetricAnswer {metric_id, subject, value, unit, as_of_frame, from_frame, ref}`, `interface EventView`, `interface DecisionView`, `interface ClaimCheck {verified, claimed, actual, difference, tolerance, ref}`, `claimTolerance(actual)`, `class StatsQuery(engine)` with `asOf`, `players`, `matchInfo`, `metrics`, `metric`, `series`, `rankPlayers`, `signalsBetween`, `eventsBetween`, `decision`, `verifyClaim`; `createStatsServer(query): McpServer` with tools `match_info`, `list_metrics`, `get_metric`, `get_series`, `rank_players`, `get_signals`, `get_events`, `get_decision`, `verify_claim`; `loadRun(dir, models, {minute?, roster?}): Effect<StatsQuery, ReplayError>`; `SERVER_NAME`, `SERVER_VERSION`; CLI `pnpm -s mcp-stats --run <dir> [--minute N] [--http PORT]`.

- [ ] **Step 1: Create the package**

Create `packages/mcp-stats/package.json`:

```json
{
  "name": "@touchline/mcp-stats",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "exports": { ".": "./src/index.ts" },
  "scripts": { "test": "vitest run", "typecheck": "tsc --noEmit -p .", "serve": "tsx src/cli.ts" },
  "dependencies": {
    "@modelcontextprotocol/sdk": "1.32.0",
    "@touchline/schema": "workspace:*",
    "@touchline/sim": "workspace:*",
    "@touchline/stats": "workspace:*",
    "effect": "4.0.0",
    "zod": "4.6.5"
  },
  "devDependencies": { "@touchline/league": "workspace:*", "@touchline/sim-core": "workspace:*" }
}
```

Create `packages/mcp-stats/tsconfig.json`:

```json
{ "extends": "../../tsconfig.base.json", "include": ["src", "test", "scripts"] }
```

Create `packages/mcp-stats/vitest.config.ts`:

```ts
import { defineConfig } from "vitest/config"

export default defineConfig({ test: { testTimeout: 120_000 } })
```

Run: `pnpm install`
Expected: `@modelcontextprotocol/sdk` 1.32.0 and `zod` 4.6.5 are installed (both older than pnpm's one-day release-age limit)

- [ ] **Step 2: Write the failing tests**

Create `packages/mcp-stats/test/server.test.ts`:

```ts
import { spawn } from "node:child_process"
import { mkdtempSync, readFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js"
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js"
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js"
import { Effect } from "effect"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import type { League } from "@touchline/league"
import { writeMatch } from "@touchline/sim"
import { DEFAULT_PARAMS } from "@touchline/sim-core"
import { modelsFromJson, type StatsQuery } from "@touchline/stats"
import { loadRun } from "../src/load.js"
import { createStatsServer } from "../src/server.js"

const root = join(dirname(fileURLToPath(import.meta.url)), "../../..")
const pkg = join(root, "packages/mcp-stats")
const models = modelsFromJson(JSON.parse(readFileSync(join(root, "data/params/stats-models.json"), "utf8")))
const league = JSON.parse(readFileSync(join(root, "data/league/league.json"), "utf8")) as League
const dir = mkdtempSync(join(tmpdir(), "touchline-mcp-"))
const cfg = { matchId: "mcp", seed: 4246, kickoffTime: "2026-10-18T14:00:00.000Z", home: league.clubs[4]!, away: league.clubs[5]!, params: DEFAULT_PARAMS, dt: 0.1 }

type ToolResult = { content: Array<{ type: string; text: string }>; isError?: boolean }
let q: StatsQuery
let client: Client
const call = async (name: string, args: Record<string, unknown> = {}) => (await client.callTool({ name, arguments: args })) as ToolResult
const data = async (name: string, args: Record<string, unknown> = {}) => {
  const r = await call(name, args)
  expect(r.isError, r.content[0]?.text).toBeFalsy()
  return JSON.parse(r.content[0]!.text)
}

beforeAll(async () => {
  await Effect.runPromise(writeMatch(cfg, dir))
  q = await Effect.runPromise(loadRun(dir, models, { roster: league }))
  const [a, b] = InMemoryTransport.createLinkedPair()
  await createStatsServer(q).connect(a)
  client = new Client({ name: "test", version: "0" })
  await client.connect(b)
}, 120_000)
afterAll(() => client?.close())

describe("MCP stats server", () => {
  it("offer the nine read-only tools", async () => {
    const { tools } = await client.listTools()
    expect(tools.map((t) => t.name).sort()).toEqual(["get_decision", "get_events", "get_metric", "get_series", "get_signals", "list_metrics", "match_info", "rank_players", "verify_claim"])
    for (const t of tools) expect(t.annotations?.readOnlyHint, t.name).toBe(true)
  })

  it("answer a metric as the engine does, with a ref to cite, and never past the latest frame", async () => {
    const m = await data("get_metric", { metric_id: "team.press", subject: cfg.home.id, at_frame: 30_000 })
    expect(m.value).toBe(q.engine.value("team.press", cfg.home.id, { at: 30_000 }))
    expect(m).toMatchObject({ unit: "share", as_of_frame: 30_000, from_frame: 27_000, ref: "team.press@27000-30000" })
    const late = await data("get_metric", { metric_id: "shot.xg", subject: cfg.away.id, at_frame: 10_000_000 })
    expect(late.as_of_frame).toBe(q.engine.now)
  })

  it("return a readable tool error for an unknown subject or a metric the subject lacks", async () => {
    const r = await call("get_metric", { metric_id: "pass.acc", subject: "nobody" })
    expect(r.isError).toBe(true)
    expect(r.content[0]!.text).toMatch(/unknown subject "nobody"/)
    expect((await call("get_metric", { metric_id: "plyr.vmax", subject: cfg.home.id })).content[0]!.text).toMatch(/not defined for a team/)
    expect((await call("get_metric", { metric_id: "made.up", subject: "match" })).isError).toBe(true)
  })

  it("give teams with named players and the score as of a frame", async () => {
    const info = await data("match_info")
    expect(info.home.players[0]).toMatchObject({ id: cfg.home.starters[0]!.id, name: (cfg.home.starters[0] as { name?: string }).name, role: "GK" })
    expect(info.score).toEqual(q.engine.score)
    expect((await data("match_info", { at_frame: 0 })).score).toEqual({ home: 0, away: 0 })
  })

  it("list signals and events in a frame range, with derived values and totals", async () => {
    const sig = await data("get_signals", { types: ["goal", "card"], limit: 2 })
    expect(sig.total).toBe(q.engine.signals.filter((s) => s.type === "goal" || s.type === "card").length)
    expect(sig.signals.length).toBe(Math.min(2, sig.total))
    const ev = await data("get_events", { from_frame: 1000, to_frame: 4000, types: ["pass"], team_id: cfg.home.id })
    expect(ev.total).toBeGreaterThan(5)
    for (const e of ev.events) {
      expect(e.frame_id).toBeGreaterThanOrEqual(1000)
      expect(e.team_id).toBe(cfg.home.id)
      // A pass stopped at the passer's feet has length 0.
      expect(e.values["pass.dist"]).toBeGreaterThanOrEqual(0)
      expect(e.values["pass.xp"]).toBeGreaterThan(0)
    }
  })

  it("explain a pass decision, and refuse an event without one", async () => {
    const pass = q.engine.events.find((e) => e.type === "pass" && typeof e.attrs.chosen_rank === "number")!
    const d = await data("get_decision", { event_id: pass.id })
    expect(d).toMatchObject({ event_id: pass.id, chosen_rank: pass.attrs.chosen_rank, best_receiver_id: pass.attrs.best_receiver_id })
    expect(d.options.length).toBeGreaterThan(0)
    const reception = q.engine.events.find((e) => e.type === "reception")!
    expect((await call("get_decision", { event_id: reception.id })).content[0]!.text).toMatch(/no decision record/)
    expect((await call("get_decision", { event_id: "nope" })).isError).toBe(true)
  })

  it("verify a claimed value within tolerance and reject one that is off", async () => {
    const actual = q.engine.value("pass.acc", cfg.away.id, { at: 40_000 })!
    expect((await data("verify_claim", { metric_id: "pass.acc", subject: cfg.away.id, at_frame: 40_000, value: Math.round(actual * 100) / 100 })).verified).toBe(true)
    const off = await data("verify_claim", { metric_id: "pass.acc", subject: cfg.away.id, at_frame: 40_000, value: actual + 0.05 })
    expect(off).toMatchObject({ verified: false, actual })
  })

  it("rank players and give a series", async () => {
    const r = await data("rank_players", { metric_id: "plyr.dist", team_id: cfg.home.id, top: 3 })
    expect(r.players).toHaveLength(3)
    expect(r.players[0].value).toBeGreaterThanOrEqual(r.players[2].value)
    for (const p of r.players) expect(p.team_id).toBe(cfg.home.id)
    const s = await data("get_series", { metric_id: "team.mom", subject: cfg.home.id, from_frame: 0, to_frame: 6000, step_s: 60 })
    expect(s.map((p: { frame: number }) => p.frame)).toEqual(Array.from({ length: 11 }, (_, i) => i * 600))
    expect((await call("get_series", { metric_id: "team.mom", subject: cfg.home.id, step_s: 1 })).content[0]!.text).toMatch(/too many points/)
  })

  it("load a match as it stood at a given minute", async () => {
    const at30 = await Effect.runPromise(loadRun(dir, models, { minute: 30 }))
    expect(at30.engine.now).toBe(18_000)
    expect(at30.engine.eventTicks.every((t) => t <= 18_000)).toBe(true)
    const at60 = await Effect.runPromise(loadRun(dir, models, { minute: 60 }))
    expect(at60.engine.frame!.period).toBe("second_half")
    expect(at60.engine.frame!.frame_id).toBe(9_000)
  })

  it("serve over stdio from the command line", async () => {
    const c = new Client({ name: "stdio-test", version: "0" })
    await c.connect(new StdioClientTransport({ command: "npx", args: ["tsx", "src/cli.ts", "--run", dir, "--minute", "60"], cwd: pkg, stderr: "ignore" }))
    const r = (await c.callTool({ name: "get_metric", arguments: { metric_id: "team.poss", subject: cfg.home.id } })) as ToolResult
    expect(JSON.parse(r.content[0]!.text).as_of_frame).toBeGreaterThan(30_000)
    await c.close()
  }, 60_000)

  it("serve Streamable HTTP on 127.0.0.1 from the command line", async () => {
    const child = spawn("npx", ["tsx", "src/cli.ts", "--run", dir, "--http", "0"], { cwd: pkg })
    try {
      const url = await new Promise<string>((ok, bad) => {
        child.stderr.on("data", (b: Buffer) => {
          const m = /(http:\/\/127\.0\.0\.1:\d+\/mcp)/.exec(String(b))
          if (m) ok(m[1]!)
        })
        child.on("exit", (code) => bad(new Error(`exited ${code}`)))
      })
      const c = new Client({ name: "http-test", version: "0" })
      await c.connect(new StreamableHTTPClientTransport(new URL(url)))
      const info = JSON.parse(((await c.callTool({ name: "match_info", arguments: {} })) as ToolResult).content[0]!.text)
      expect(info.match_id).toBe("mcp")
      await c.close()
    } finally {
      child.kill()
    }
  }, 60_000)
})
```

- [ ] **Step 3: Run them to make sure they fail**

Run: `pnpm --filter @touchline/mcp-stats test`
Expected: the file fails to load: `Cannot find module '../src/load.js'`

- [ ] **Step 4: Write the query layer and the server**

Create `packages/stats/src/query.ts`:

```ts
import type { DomainEvent, MetricId, Signal } from "@touchline/schema"
import { metricDef, METRICS, type MetricDef } from "./catalog.js"
import { StatsError, type StatsEngine } from "./engine.js"
import type { PlayerInfo, TeamInfo } from "./input.js"

/**
 * Read-only questions about a match, as of a tick (spec §5.3: agents read state only through these, via MCP).
 * Every answer is clamped to what the engine has ingested, and says which tick it is about.
 */

export interface MetricAnswer {
  readonly metric_id: MetricId
  readonly subject: string
  readonly value: number | null
  readonly unit: string
  readonly as_of_frame: number
  /** The ticks the value covers: (from, to]; from is null for the match so far. */
  readonly from_frame: number | null
  /** How to cite it: `metric@from-to`. */
  readonly ref: string
}

export interface EventView {
  readonly id: string
  readonly type: string
  readonly frame_id: number
  readonly frame_id_end: number | null
  readonly match_clock: string
  readonly team_id: string | null
  readonly player_id: string | null
  readonly outcome: string | null
  readonly x: number | null
  readonly y: number | null
  readonly x_end: number | null
  readonly y_end: number | null
  /** Values the stats engine derived (pass.dist, pass.xp, shot.xg, shot.speed). */
  readonly values: Readonly<Record<string, number>>
}

export interface DecisionView {
  readonly event_id: string
  readonly type: string
  readonly player_id: string | null
  readonly frame_id: number
  /** The decision model's probability for each action. */
  readonly action_probs: Readonly<Record<string, number>>
  /** The options it weighed, best first (receiver, kind, target, xPass, value). */
  readonly options: ReadonlyArray<unknown>
  /** Rank of the chosen pass among the options (1 = best), or null for a non-pass action. */
  readonly chosen_rank: number | null
  readonly best_receiver_id: string | null
  readonly chosen_receiver_id: string | null
  readonly fallback: boolean
}

export interface ClaimCheck {
  readonly verified: boolean
  readonly claimed: number
  readonly actual: number | null
  readonly difference: number | null
  readonly tolerance: number
  readonly ref: string
}

/** Default tolerance for a claimed value: 2 % of the actual value, at least 0.006 (a share rounded to whole percent). */
export const claimTolerance = (actual: number): number => Math.max(0.006, 0.02 * Math.abs(actual))

export class StatsQuery {
  constructor(readonly engine: StatsEngine) {}

  /** A tick no later than what has been ingested (default: the latest). */
  asOf(at?: number | null): number {
    return at === undefined || at === null ? this.engine.now : Math.max(0, Math.min(at, this.engine.now))
  }

  players(): ReadonlyArray<PlayerInfo & { readonly team_id: string }> {
    return [this.engine.info.home, this.engine.info.away].flatMap((t) => t.players.map((p) => ({ ...p, team_id: t.id })))
  }

  matchInfo(at?: number | null) {
    const t = this.asOf(at)
    const goals = this.eventsBetween(null, t, { types: ["goal"] })
    const team = (x: TeamInfo) => ({ id: x.id, name: x.name, side: x.side, players: x.players })
    const { home, away } = this.engine.info
    const f = this.engine.frame
    return {
      match_id: this.engine.info.matchId,
      as_of_frame: t,
      home: team(home),
      away: team(away),
      score: { home: goals.filter((g) => g.team_id === home.id).length, away: goals.filter((g) => g.team_id === away.id).length },
      latest: f ? { frame: f.tick, period: f.period } : null
    }
  }

  metrics(): ReadonlyArray<MetricDef> {
    return METRICS
  }

  metric(id: string, subject: string, at?: number | null, windowS?: number | null): MetricAnswer {
    const def = metricDef(id)
    if (!def) throw new StatsError(`unknown metric "${id}"; list_metrics gives the ids`)
    const t = this.asOf(at)
    const window = def.windowed ? (windowS === undefined ? def.defaultWindowS : windowS) : null
    const from = window === null ? null : t - this.engine.ticks(window)
    const value = this.engine.value(def.id, subject, { at: t, windowS: window })
    return { metric_id: def.id, subject, value, unit: def.unit, as_of_frame: t, from_frame: from, ref: `${def.id}@${from === null ? 0 : Math.max(0, from)}-${t}` }
  }

  series(id: string, subject: string, fromFrame: number, toFrame: number, stepS = 60, windowS?: number | null): ReadonlyArray<{ readonly frame: number; readonly value: number | null }> {
    const to = this.asOf(toFrame)
    const step = Math.max(1, this.engine.ticks(stepS))
    if ((to - fromFrame) / step > 500) throw new StatsError("too many points: use a longer step_s (at most 500 points)")
    const out: Array<{ frame: number; value: number | null }> = []
    for (let t = Math.max(0, fromFrame); t <= to; t += step) out.push({ frame: t, value: this.metric(id, subject, t, windowS).value })
    return out
  }

  rankPlayers(id: string, opts: { readonly teamId?: string; readonly at?: number | null; readonly windowS?: number | null; readonly top?: number; readonly order?: "desc" | "asc" } = {}) {
    const def = metricDef(id)
    if (!def?.subjects.includes("player")) throw new StatsError(`${id} is not a player metric`)
    const rows = this.players()
      .filter((p) => !opts.teamId || p.team_id === opts.teamId)
      .map((p) => ({ player_id: p.id, name: p.name, team_id: p.team_id, value: this.metric(id, p.id, opts.at, opts.windowS).value }))
      .filter((r): r is typeof r & { value: number } => r.value !== null)
      .sort((a, b) => (opts.order === "asc" ? a.value - b.value : b.value - a.value) || a.player_id.localeCompare(b.player_id))
    return rows.slice(0, opts.top ?? 5)
  }

  signalsBetween(from: number | null, to?: number | null, f: { readonly types?: ReadonlyArray<string>; readonly teamId?: string; readonly minSalience?: number } = {}): Signal[] {
    const t = this.asOf(to)
    return this.engine.signals
      .filter((s) => s.frame_id <= t && (from === null || s.frame_id >= from))
      .filter((s) => (!f.types || f.types.includes(s.type)) && (!f.teamId || s.team_id === f.teamId) && s.salience >= (f.minSalience ?? 0))
      .sort((a, b) => a.frame_id - b.frame_id || a.id.localeCompare(b.id))
  }

  /** Events known by `to` (emitted at or before it) whose own tick is at or after `from`. */
  eventsBetween(from: number | null, to?: number | null, f: { readonly types?: ReadonlyArray<string>; readonly teamId?: string; readonly playerId?: string } = {}): EventView[] {
    const t = this.asOf(to)
    const out: EventView[] = []
    const { events, eventTicks } = this.engine
    for (let i = 0; i < events.length; i++) {
      const e = events[i]!
      if (eventTicks[i]! > t || (from !== null && e.frame_id < from)) continue
      if ((f.types && !f.types.includes(e.type)) || (f.teamId && e.team_id !== f.teamId) || (f.playerId && e.player_id !== f.playerId)) continue
      out.push(view(e, this.engine.derived.get(e.id) ?? {}))
    }
    return out
  }

  decision(eventId: string, at?: number | null): DecisionView {
    const t = this.asOf(at)
    const i = this.engine.events.findIndex((e) => e.id === eventId)
    if (i < 0 || this.engine.eventTicks[i]! > t) throw new StatsError(`no event "${eventId}" (as of frame ${t})`)
    const e = this.engine.events[i]!
    const a = e.attrs
    if (a.action_probs === undefined) throw new StatsError(`event "${eventId}" (${e.type}) has no decision record`)
    const str = (v: unknown) => (typeof v === "string" ? v : null)
    return {
      event_id: e.id,
      type: e.type,
      player_id: e.player_id,
      frame_id: e.frame_id,
      action_probs: (a.action_probs ?? {}) as Readonly<Record<string, number>>,
      options: (a.options ?? []) as ReadonlyArray<unknown>,
      chosen_rank: typeof a.chosen_rank === "number" ? a.chosen_rank : null,
      best_receiver_id: str(a.best_receiver_id),
      chosen_receiver_id: str(a.intended_receiver_id),
      fallback: a.fallback === true
    }
  }

  verifyClaim(id: string, subject: string, at: number, claimed: number, windowS?: number | null, tolerance?: number): ClaimCheck {
    const m = this.metric(id, subject, at, windowS)
    const tol = tolerance ?? (m.value === null ? 0 : claimTolerance(m.value))
    const diff = m.value === null ? null : Math.abs(claimed - m.value)
    return { verified: diff !== null && diff <= tol, claimed, actual: m.value, difference: diff, tolerance: tol, ref: m.ref }
  }
}

const view = (e: DomainEvent, values: Readonly<Record<string, number>>): EventView => ({
  id: e.id,
  type: e.type,
  frame_id: e.frame_id,
  frame_id_end: e.frame_id_end,
  match_clock: e.match_clock,
  team_id: e.team_id,
  player_id: e.player_id,
  outcome: e.outcome,
  x: e.x,
  y: e.y,
  x_end: e.x_end,
  y_end: e.y_end,
  values
})
```

Apply this change to `packages/stats/src/index.ts` (from the repository root):

```bash
git apply <<'PATCH'
diff --git a/packages/stats/src/index.ts b/packages/stats/src/index.ts
index 3c46cac..2516739 100644
--- a/packages/stats/src/index.ts
+++ b/packages/stats/src/index.ts
@@ -8,3 +8,4 @@ export * from "./replay.js"
 export * from "./store.js"
 export * from "./stream.js"
 export * from "./summary.js"
+export * from "./query.js"
PATCH
```

Create `packages/mcp-stats/src/server.ts`:

```ts
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { z } from "zod"
import { SignalType } from "@touchline/schema"
import { METRICS, StatsError, type StatsQuery } from "@touchline/stats"

export const SERVER_NAME = "touchline-stats"
export const SERVER_VERSION = "0.1.0"

const INSTRUCTIONS = [
  "Read-only statistics for one football match from the Touchline stats engine.",
  "Every number you state must come from these tools: cite the metric id and the `ref` (metric@from-to) or event ids they return.",
  "Frames are global ticks (10 per second); every answer says which frame it is as of (`as_of_frame`) and never includes anything later.",
  "Subjects are \"match\", a team id or a player id (match_info lists them). list_metrics says which subjects and windows each metric supports."
].join(" ")

const metricIds = METRICS.map((m) => m.id) as [string, ...string[]]
const signalType = z.enum([...SignalType.literals] as [string, ...string[]])
const metricId = z.enum(metricIds).describe("metric id, e.g. team.press (list_metrics gives them all)")
const subject = z.string().describe('"match", a team id or a player id')
const atFrame = z.number().int().min(0).optional().describe("answer as of this frame (default: the latest)")
const windowS = z.number().positive().max(7200).nullable().optional().describe("only the last N seconds (windowed metrics; null for the match so far; default: the metric's own)")
const fromFrame = z.number().int().min(0).optional().describe("first frame (default: kickoff)")
const toFrame = z.number().int().min(0).optional().describe("last frame (default: the latest)")

const ok = (v: unknown) => ({ content: [{ type: "text" as const, text: JSON.stringify(v) }] })
const fail = (message: string) => ({ content: [{ type: "text" as const, text: message }], isError: true })

/** Run a query; a StatsError (bad id, no such event) becomes a tool error the agent can read and correct. */
const answer = (f: () => unknown) => {
  try {
    return ok(f())
  } catch (e) {
    if (e instanceof StatsError) return fail(e.message)
    throw e
  }
}

const readOnly = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false } as const

/** An MCP server exposing the stats tools (spec §5.3) over one match's StatsQuery. */
export const createStatsServer = (q: StatsQuery): McpServer => {
  const server = new McpServer({ name: SERVER_NAME, version: SERVER_VERSION }, { instructions: INSTRUCTIONS })

  server.registerTool(
    "match_info",
    { title: "Match info", description: "Teams, players (id, name, role, jersey), the score and the latest frame.", inputSchema: { at_frame: atFrame }, annotations: readOnly },
    async ({ at_frame }) => answer(() => q.matchInfo(at_frame))
  )

  server.registerTool(
    "list_metrics",
    { title: "List metrics", description: "Every metric id with its name, unit, subjects, whether it takes a window, and how it is computed.", annotations: readOnly },
    async () => answer(() => q.metrics())
  )

  server.registerTool(
    "get_metric",
    {
      title: "Get a metric",
      description: "One metric's value for a subject as of a frame, with the frame range it covers and a ref to cite.",
      inputSchema: { metric_id: metricId, subject, at_frame: atFrame, window_s: windowS },
      annotations: readOnly
    },
    async ({ metric_id, subject, at_frame, window_s }) => answer(() => q.metric(metric_id, subject, at_frame, window_s))
  )

  server.registerTool(
    "get_series",
    {
      title: "Get a metric over time",
      description: "A metric's value for a subject every `step_s` seconds between two frames (at most 500 points).",
      inputSchema: { metric_id: metricId, subject, from_frame: fromFrame, to_frame: toFrame, step_s: z.number().positive().max(3600).optional().describe("seconds between points (default 60)"), window_s: windowS },
      annotations: readOnly
    },
    async ({ metric_id, subject, from_frame, to_frame, step_s, window_s }) => answer(() => q.series(metric_id, subject, from_frame ?? 0, to_frame ?? q.asOf(), step_s, window_s))
  )

  server.registerTool(
    "rank_players",
    {
      title: "Rank players",
      description: "Players ranked by a player metric (top N, highest first unless order is asc), optionally for one team.",
      inputSchema: {
        metric_id: metricId,
        team_id: z.string().optional().describe("only this team's players"),
        at_frame: atFrame,
        window_s: windowS,
        top: z.number().int().min(1).max(40).optional().describe("how many (default 5)"),
        order: z.enum(["desc", "asc"]).optional()
      },
      annotations: readOnly
    },
    async ({ metric_id, team_id, at_frame, window_s, top, order }) =>
      answer(() => ({ metric_id, as_of_frame: q.asOf(at_frame), players: q.rankPlayers(metric_id, { ...(team_id ? { teamId: team_id } : {}), at: at_frame ?? null, ...(window_s !== undefined ? { windowS: window_s } : {}), ...(top ? { top } : {}), ...(order ? { order } : {}) }) }))
  )

  server.registerTool(
    "get_signals",
    {
      title: "Get signals",
      description: "Signals the stats engine raised (goals, big chances, pressure shifts, momentum swings, ...), oldest first, with salience 0..1 and evidence.",
      inputSchema: {
        from_frame: fromFrame,
        to_frame: toFrame,
        types: z.array(signalType).optional().describe("only these signal types"),
        team_id: z.string().optional(),
        min_salience: z.number().min(0).max(1).optional(),
        limit: z.number().int().min(1).max(500).optional().describe("at most this many, the latest kept (default 50)")
      },
      annotations: readOnly
    },
    async ({ from_frame, to_frame, types, team_id, min_salience, limit }) =>
      answer(() => {
        const all = q.signalsBetween(from_frame ?? null, to_frame, { ...(types ? { types } : {}), ...(team_id ? { teamId: team_id } : {}), ...(min_salience !== undefined ? { minSalience: min_salience } : {}) })
        return { as_of_frame: q.asOf(to_frame), total: all.length, signals: all.slice(-(limit ?? 50)) }
      })
  )

  server.registerTool(
    "get_events",
    {
      title: "Get events",
      description: "Match events between two frames (passes, shots, tackles, ...) with the values the stats engine derived (pass.dist, pass.xp, shot.xg, shot.speed). Use their ids as evidence.",
      inputSchema: {
        from_frame: fromFrame,
        to_frame: toFrame,
        types: z.array(z.string()).optional().describe("only these event types, e.g. [\"shot\", \"goal\"]"),
        team_id: z.string().optional(),
        player_id: z.string().optional(),
        limit: z.number().int().min(1).max(500).optional().describe("at most this many, the latest kept (default 100)")
      },
      annotations: readOnly
    },
    async ({ from_frame, to_frame, types, team_id, player_id, limit }) =>
      answer(() => {
        const all = q.eventsBetween(from_frame ?? null, to_frame, { ...(types ? { types } : {}), ...(team_id ? { teamId: team_id } : {}), ...(player_id ? { playerId: player_id } : {}) })
        return { as_of_frame: q.asOf(to_frame), total: all.length, events: all.slice(-(limit ?? 100)) }
      })
  )

  server.registerTool(
    "get_decision",
    {
      title: "Get a decision record",
      description: "What the player could have done at an event (pass, carry, shot, take-on, clearance): each action's probability, the options ranked best first, and the rank of the one chosen.",
      inputSchema: { event_id: z.string(), at_frame: atFrame },
      annotations: readOnly
    },
    async ({ event_id, at_frame }) => answer(() => q.decision(event_id, at_frame))
  )

  server.registerTool(
    "verify_claim",
    {
      title: "Verify a claim",
      description: "Check a claimed metric value against the engine (the Fact-Checker's code check): verified when within the tolerance (default: 2 % of the actual value, at least 0.006).",
      inputSchema: { metric_id: metricId, subject, at_frame: z.number().int().min(0), value: z.number(), window_s: windowS, tolerance: z.number().min(0).optional() },
      annotations: readOnly
    },
    async ({ metric_id, subject, at_frame, value, window_s, tolerance }) => answer(() => q.verifyClaim(metric_id, subject, at_frame, value, window_s, tolerance))
  )

  return server
}
```

Create `packages/mcp-stats/src/load.ts`:

```ts
import { Effect, Stream } from "effect"
import { emittedAt, readRun, StatsEngine, StatsQuery, type ReplayError, type Roster, type StatsInput, type StatsModels } from "@touchline/stats"

export interface LoadOptions {
  /**
   * Stop at this match minute, as if the match were live then (minutes from 45 count in the second half, as in
   * scenario scripts). Default: the whole match.
   */
  readonly minute?: number
  readonly roster?: Roster
}

/** Replay a run folder into a stats engine (up to a minute, if given) and wrap it for queries. */
export const loadRun = (dir: string, models: StatsModels, opts: LoadOptions = {}): Effect.Effect<StatsQuery, ReplayError> =>
  Effect.gen(function* () {
    const run = yield* readRun(dir, opts.roster)
    const engine = new StatsEngine(run.info, models)
    const minute = opts.minute
    const ticksPerMin = 60 / run.info.dt
    // The last tick to take: known for the first half up front, for the second once its first frame arrives.
    let cut = minute === undefined ? Infinity : minute < 45 ? Math.round(minute * ticksPerMin) : Infinity
    const tickOf = (i: StatsInput) => (i.kind === "frame" ? i.frame.tick : emittedAt(i.event))
    yield* Stream.runForEach(
      run.inputs.pipe(
        Stream.takeWhile((i) => {
          if (minute !== undefined && minute >= 45 && i.kind === "frame" && i.frame.period === "second_half" && i.frame.frame_id === 0) cut = i.frame.tick + Math.round((minute - 45) * ticksPerMin)
          return tickOf(i) <= cut
        })
      ),
      (i) => Effect.sync(() => engine.ingest(i))
    )
    engine.finish()
    return new StatsQuery(engine)
  })
```

Create `packages/mcp-stats/src/cli.ts`:

```ts
import { existsSync, readFileSync } from "node:fs"
import { createServer, type IncomingMessage, type ServerResponse } from "node:http"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js"
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js"
import { Effect } from "effect"
import { CliError, cliOptions, exitOnUserError, integer } from "@touchline/sim"
import { modelsFromJson, ReplayError, type Roster, type StatsQuery } from "@touchline/stats"
import { loadRun } from "./load.js"
import { createStatsServer } from "./server.js"

const root = join(dirname(fileURLToPath(import.meta.url)), "../../..")
// pnpm runs package scripts from the package folder; INIT_CWD is where the user typed the command.
const here = (p: string) => resolve(process.env.INIT_CWD ?? process.cwd(), p)

// stdout carries the MCP protocol in stdio mode: everything else goes to stderr.
const o = cliOptions("touchline-mcp-stats: serve one match's stats to agents over MCP (stdio by default)", {
  run: { default: "", help: "run folder written by pnpm sim (meta.json, domain.jsonl, tracking.jsonl)" },
  minute: { default: "", check: integer(0, 130), help: "serve the match as it stood at this minute (45 and later: second half)" },
  http: { default: "", check: integer(0, 65535), help: "serve Streamable HTTP on this port at 127.0.0.1/mcp instead of stdio (0: any free port)" }
})
exitOnUserError(() => {
  if (o.run === "") throw new CliError("--run is required (a folder written by pnpm sim, e.g. out/m-1)")
})
const models = modelsFromJson(JSON.parse(readFileSync(join(root, "data/params/stats-models.json"), "utf8")))
const leaguePath = join(root, "data/league/league.json")
const roster = existsSync(leaguePath) ? (JSON.parse(readFileSync(leaguePath, "utf8")) as Roster) : undefined

/** Stateless Streamable HTTP: a fresh server and transport per request, all reading the same loaded match. */
const serveHttp = (q: StatsQuery, port: number) => {
  const http = createServer(async (req: IncomingMessage, res: ServerResponse) => {
    if (req.url !== "/mcp" || req.method !== "POST") {
      res.writeHead(req.url === "/mcp" ? 405 : 404).end()
      return
    }
    const server = createStatsServer(q)
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true })
    res.on("close", () => {
      void transport.close()
      void server.close()
    })
    await server.connect(transport)
    await transport.handleRequest(req, res)
  })
  http.listen(port, "127.0.0.1", () => {
    const addr = http.address()
    console.error(`touchline-stats MCP on http://127.0.0.1:${typeof addr === "object" && addr ? addr.port : port}/mcp`)
  })
}

Effect.runPromise(loadRun(here(o.run), models, { ...(o.minute ? { minute: Number(o.minute) } : {}), ...(roster ? { roster } : {}) }))
  .then(async (q) => {
    if (o.http !== "") serveHttp(q, Number(o.http))
    else {
      await createStatsServer(q).connect(new StdioServerTransport())
      console.error(`touchline-stats MCP on stdio: ${q.engine.info.matchId} as of frame ${q.engine.now}`)
    }
  })
  .catch((e) => {
    if (e instanceof ReplayError) {
      console.error(e.message)
      process.exit(2)
    }
    throw e
  })
```

Create `packages/mcp-stats/src/index.ts`:

```ts
export * from "./load.js"
export * from "./server.js"
```

Apply this change to `package.json` (from the repository root):

```bash
git apply <<'PATCH'
diff --git a/package.json b/package.json
index ff3d3bb..5fe5bb9 100644
--- a/package.json
+++ b/package.json
@@ -11,7 +11,8 @@
     "league": "pnpm --filter @touchline/league run generate",
     "calibrate": "pnpm --filter @touchline/calibrate run calibrate",
     "realism": "pnpm --filter @touchline/calibrate run realism",
-    "stats": "pnpm --filter @touchline/stats run stats"
+    "stats": "pnpm --filter @touchline/stats run stats",
+    "mcp-stats": "pnpm --filter @touchline/mcp-stats run serve"
   },
   "devDependencies": {
     "@types/node": "22.20.5",
PATCH
```

- [ ] **Step 5: Run the tests**

Run: `pnpm --filter @touchline/mcp-stats test`
Expected: 11 passed (the stdio and HTTP tests start the CLI)

Run: `pnpm turbo run typecheck test --force`
Expected: `Tasks: 14 successful`

- [ ] **Step 6: Document it**

Apply this change to `README.md` (from the repository root):

````bash
git apply <<'PATCH'
diff --git a/README.md b/README.md
index 566fa03..5674139 100644
--- a/README.md
+++ b/README.md
@@ -51,6 +51,18 @@ pnpm stats --run out/m-7               # replay it through the stats engine: tea
 pnpm stats --run out/m-7 --signals out/m-7/signals.jsonl
 ```
 
+## MCP stats server
+
+Agents read the match only through MCP tools (spec §5.3): `match_info`, `list_metrics`, `get_metric`, `get_series`, `rank_players`, `get_signals`, `get_events`, `get_decision` and `verify_claim`. All are read-only, every answer says which frame it is as of, and nothing later than that is ever returned.
+
+```bash
+pnpm -s mcp-stats --run out/m-7                 # stdio (stdout carries the protocol; logs go to stderr)
+pnpm -s mcp-stats --run out/m-7 --minute 60     # the match as it stood at 60'
+pnpm -s mcp-stats --run out/m-7 --http 8787     # Streamable HTTP at http://127.0.0.1:8787/mcp
+```
+
+An MCP client can launch it directly, for example: `{"command": "npx", "args": ["tsx", "packages/mcp-stats/src/cli.ts", "--run", "out/m-7"]}`.
+
 ## Packages
 
 | Package | What it does |
@@ -60,6 +72,7 @@ pnpm stats --run out/m-7 --signals out/m-7/signals.jsonl
 | `packages/schema` | Effect Schema for the live domain stream (events and frames) and for signals and metric ids |
 | `packages/sim` | Effect streams, CDF v0.3.2 writers, run manifest, CLI |
 | `packages/stats` | Stats engine: metrics and signals on the domain stream, replay of run folders, `pnpm stats` |
+| `packages/mcp-stats` | MCP server exposing the stats tools to agents (stdio or Streamable HTTP) |
 | `packages/calibrate` | Match statistics (identical to the Python definitions), tuning knobs, tuner, realism gate |
 | `python/analytics` | CDF validation, IDSSE download, real-match targets, realism report, stats-model fitting |
 
PATCH
````

- [ ] **Step 7: Commit**

```bash
git add packages/stats packages/mcp-stats package.json pnpm-lock.yaml README.md
git commit -m "feat(mcp-stats): MCP server with read-only stats tools for agents over stdio or Streamable HTTP; stats query layer

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```



### Task 8: Plan 2c review minors

The seven findings the Plan 2c review deferred. (1) The manifest reported `achieved`/`forced` per window, so in a shared window a met defensive-error target showed `forced: true` when only the goal was forced; each window now records a result per entry, and an entry counts as forced only if the accepted play holds a scripted event of its kind. (2) A forced play forced `count` goals even when natural goals already met the target; a natural goal now drops the forces no longer needed. (3) `momentum_swing` raises pressing by 1.3, which switched on the press surge's two-man pressing (the check was `press > 1`); the surge now has its own flag. (4) Retry sub-seeds are `window × 64 + attempt`, which collide from 63 retries; `runScript` now refuses more than 62. (5) `fatigue.halfTimeRecovery` and `script.howlerFumble` are shares and are now range-checked. (6) The blocklist fetcher's User-Agent had no contact (Wikimedia asks for one) and ignored `Retry-After` on HTTP 429; fetching now needs `--contact`, honours `Retry-After`, and records each league's fetch date beside it (the two committed leagues were fetched on 2026-10-05). (7) Manifest frame ids are global ticks, as in `domain.jsonl` and the stats engine; this is now documented on the manifest types. Plain matches are unchanged, so the realism gate does not move.

**Files:**
- Modify: `packages/sim-core/src/script.ts`, `packages/sim-core/src/step.ts`, `packages/sim-core/src/runner.ts`, `packages/sim-core/src/params.ts`, `packages/sim/src/truths.ts`, `packages/sim/src/writer.ts`, `python/analytics/touchline_analytics/blocklist.py`
- Create: `data/blocklist/leagues/Premier League.fetched`, `data/blocklist/leagues/EFL Championship.fetched`; regenerate `data/blocklist/real-player-name-hashes.meta.json`
- Test: `packages/sim-core/test/runner.test.ts`, `packages/sim-core/test/scenario.test.ts`, `packages/sim-core/test/params.test.ts`, `packages/sim/test/truths.test.ts`, `python/analytics/tests/test_blocklist.py`

**Interfaces:**
- Consumes: Plan 2c's runner, script modifiers, truths and blocklist.
- Produces: `Mods.surge: boolean`; `outstandingForces(script, forced, goals)`; `WindowResult.results: {achieved, forced}[]` (index-aligned with `entries`); `entryForced(entry, events, cfg)`; `MAX_RETRIES = 62`; `fetch(query, contact, attempts?)`; `build(out, contact?)`; meta `fetched_at: {league: date | null}`.

- [ ] **Step 1: Write the failing tests**

Apply this change to `packages/sim-core/test/runner.test.ts`, `packages/sim-core/test/scenario.test.ts`, `packages/sim-core/test/params.test.ts` (from the repository root):

```bash
git apply <<'PATCH'
diff --git a/packages/sim-core/test/params.test.ts b/packages/sim-core/test/params.test.ts
index 7b87f5d..4f9f249 100644
--- a/packages/sim-core/test/params.test.ts
+++ b/packages/sim-core/test/params.test.ts
@@ -69,7 +69,7 @@ describe("params from JSON: value ranges", () => {
     expect(() => paramsFromJson(JSON.parse(readFileSync(join(root, "data/params/touchline-params.json"), "utf8")))).not.toThrow()
   })
   it("refuses probabilities outside 0..1", () => {
-    for (const bad of [{ keeper: { letRunShare: 5 } }, { defending: { foulPerTackle: -0.1 } }, { substitutions: { windowChance: [1, 1.2, 0.5] } }, { kinematics: { reachMargin: 1.5 } }])
+    for (const bad of [{ keeper: { letRunShare: 5 } }, { defending: { foulPerTackle: -0.1 } }, { substitutions: { windowChance: [1, 1.2, 0.5] } }, { kinematics: { reachMargin: 1.5 } }, { fatigue: { halfTimeRecovery: 1.5 } }, { script: { howlerFumble: 2 } }])
       expect(() => paramsFromJson({ provenance: prov, ...bad }), JSON.stringify(bad)).toThrow(/must be between 0 and 1/)
   })
   it("refuses negative values where only magnitudes make sense, but allows signed model coefficients", () => {
diff --git a/packages/sim-core/test/runner.test.ts b/packages/sim-core/test/runner.test.ts
index b57018a..b37987a 100644
--- a/packages/sim-core/test/runner.test.ts
+++ b/packages/sim-core/test/runner.test.ts
@@ -3,7 +3,7 @@ import { readFileSync } from "node:fs"
 import { dirname, join } from "node:path"
 import { fileURLToPath } from "node:url"
 import { describe, expect, it } from "vitest"
-import { initMatch, isFinished, paramsFromJson, runScript, ScriptError, step, type MatchConfig, type Script } from "../src/index.js"
+import { entryAchieved, initMatch, isFinished, outstandingForces, paramsFromJson, runScript, ScriptError, step, type MatchConfig, type Script, type ScriptEntry } from "../src/index.js"
 import { makeConfig } from "../src/testing.js"
 
 const root = join(dirname(fileURLToPath(import.meta.url)), "../../..")
@@ -54,6 +54,26 @@ describe("scenario runner", () => {
     const reds = run.steps.flatMap((r) => r.events).filter((e) => e.type === "card" && e.attrs.colour !== "yellow" && e.team_id === "away-fc")
     expect(w.achieved).toBe(reds.some((e) => e.frame_id >= w.fromFrame && e.frame_id <= w.toFrame))
   })
+  it("refuses more retries than its sub-seeds allow", () => {
+    const script: Script = { name: "t", entries: [{ window: [20, 30], team: "home", effect: "goal" }] }
+    expect(() => runScript(makeConfig(1, { params, script }), { retries: 63 })).toThrow(/retries must be an integer from 0 to 62/)
+    expect(() => runScript(makeConfig(1, { params, script }), { retries: -1 })).toThrow(ScriptError)
+  })
+  it("reports each entry's own result, and marks forced only the entries whose outcome was forced", () => {
+    const script: Script = { name: "t", entries: [{ window: [30, 45], team: "home", effect: "goal", count: 5 }, { window: [30, 45], team: "away", effect: "press_surge" }] }
+    const run = runScript(makeConfig(8, { params, script }), { retries: 0 })
+    const w = run.windows[0]!
+    const events = run.steps.flatMap((r) => r.events).filter((e) => e.frame_id >= w.fromFrame && e.frame_id <= w.toFrame)
+    expect(w.forced).toBe(true)
+    expect(w.results).toEqual(script.entries.map((e) => ({ achieved: entryAchieved(e, events, makeConfig(8, { params, script })), forced: e.effect === "goal" })))
+  })
+  it("forces only the goals still missing: natural goals in the forced play count towards the target", () => {
+    const script: Script = { name: "t", entries: [{ window: [30, 45], team: "home", effect: "goal", count: 2 }, { window: [30, 45], team: "away", effect: "red_card" }] }
+    const [goal, red] = script.entries as [ScriptEntry, ScriptEntry]
+    expect(outstandingForces(script, [goal, goal, red], [0, 0])).toEqual([goal, goal, red])
+    expect(outstandingForces(script, [goal, goal, red], [1, 0])).toEqual([goal, red])
+    expect(outstandingForces(script, [goal, red], [2, 0])).toEqual([red])
+  })
   it("refuses overlapping windows", () => {
     const script: Script = { name: "t", entries: [{ window: [20, 40], team: "home", effect: "goal" }, { window: [30, 50], team: "away", effect: "goal" }] }
     expect(() => runScript(makeConfig(1, { params, script }))).toThrow(ScriptError)
diff --git a/packages/sim-core/test/scenario.test.ts b/packages/sim-core/test/scenario.test.ts
index 35f5035..7da3b90 100644
--- a/packages/sim-core/test/scenario.test.ts
+++ b/packages/sim-core/test/scenario.test.ts
@@ -36,6 +36,13 @@ describe("scenario modifiers", () => {
     const first = one("press_surge", [30, 45])
     expect(modsFor(first, "home", 44, params, [], "second_half")).toEqual(NO_MODS)
   })
+  it("only a press surge makes two defenders press; a momentum swing's extra pressing does not", () => {
+    expect(modsFor(one("press_surge"), "home", 10, params)).toMatchObject({ surge: true })
+    const momentum = modsFor(one("momentum_swing"), "home", 10, params)
+    expect(momentum.press).toBeGreaterThan(1)
+    expect(momentum.surge).toBe(false)
+    expect(NO_MODS.surge).toBe(false)
+  })
   it("a goal entry stops nudging once its count is reached", () => {
     const s: Script = { name: "g", entries: [{ window: [0, 95], team: "home", effect: "goal", count: 2 }] }
     expect(modsFor(s, "home", 30, params, [1]).shotLogit).toBeGreaterThan(0)
PATCH
```

Apply this change to `packages/sim/test/truths.test.ts` (from the repository root):

```bash
git apply <<'PATCH'
diff --git a/packages/sim/test/truths.test.ts b/packages/sim/test/truths.test.ts
index bec8b76..962d6f2 100644
--- a/packages/sim/test/truths.test.ts
+++ b/packages/sim/test/truths.test.ts
@@ -74,9 +74,18 @@ describe("tactical truths", () => {
 
 describe("script truths", () => {
   it("describe each window: what was injected, by which team, when, whether it happened, and which metrics should move", () => {
-    const w: WindowResult = { entries: [{ window: [60, 75], team: "home", effect: "press_surge" }], achieved: true, attempts: 2, forced: false, fromFrame: 36000, toFrame: 45000 }
+    const w: WindowResult = { entries: [{ window: [60, 75], team: "home", effect: "press_surge" }], achieved: true, attempts: 2, forced: false, fromFrame: 36000, toFrame: 45000, results: [{ achieved: true, forced: false }] }
     expect(scriptTruths([w], cfg)).toEqual([
       { effect: "press_surge", team_id: H, minutes: [60, 75], frames: [36000, 45000], count: 1, achieved: true, attempts: 2, forced: false, expected_metrics: ["team.press", "ppda", "tilt"] }
     ])
   })
+
+  it("report each entry of a shared window on its own (a met error target is not marked forced when only the goal was)", () => {
+    const w: WindowResult = {
+      entries: [{ window: [60, 75], team: "home", effect: "defensive_error" }, { window: [60, 75], team: "away", effect: "goal" }],
+      achieved: true, attempts: 7, forced: true, fromFrame: 36000, toFrame: 45000,
+      results: [{ achieved: true, forced: false }, { achieved: true, forced: true }]
+    }
+    expect(scriptTruths([w], cfg).map((t) => [t.effect, t.achieved, t.forced])).toEqual([["defensive_error", true, false], ["goal", true, true]])
+  })
 })
PATCH
```

Apply this change to `python/analytics/tests/test_blocklist.py` (from the repository root):

```bash
git apply <<'PATCH'
diff --git a/python/analytics/tests/test_blocklist.py b/python/analytics/tests/test_blocklist.py
index 557ecc7..ff743a4 100644
--- a/python/analytics/tests/test_blocklist.py
+++ b/python/analytics/tests/test_blocklist.py
@@ -33,7 +33,8 @@ def test_build_saves_each_league_and_resumes_without_fetching_it_again(tmp_path,
 
     calls = []
 
-    def fake_fetch(query):
+    def fake_fetch(query, contact):
+        assert contact == "https://example.org/touchline"
         calls.append(query)
         if "P118" in query:
             return {"results": {"bindings": [{"club": {"value": "http://www.wikidata.org/entity/Q1"}}]}}
@@ -45,11 +46,13 @@ def test_build_saves_each_league_and_resumes_without_fetching_it_again(tmp_path,
     out = tmp_path / "hashes.txt"
     (tmp_path / "leagues").mkdir()
     (tmp_path / "leagues" / "A.txt").write_text("2171085eadaef891\n")  # league A already fetched
-    meta = blocklist.build(out)
+    meta = blocklist.build(out, "https://example.org/touchline")
     assert all("Q10" not in q for q in calls)  # A was not fetched again
     assert (tmp_path / "leagues" / "B.txt").read_text() == "2b26ea3743238a83\n"
     assert out.read_text() == "2171085eadaef891\n2b26ea3743238a83\n"
     assert meta["names_per_league"] == {"A": 1, "B": 1}
+    # B's fetch date is recorded beside it; A was fetched before dates were kept.
+    assert meta["fetched_at"]["A"] is None and len(meta["fetched_at"]["B"]) == 10
 
 
 def test_an_interrupted_league_resumes_at_its_next_club(tmp_path, monkeypatch):
@@ -57,7 +60,7 @@ def test_an_interrupted_league_resumes_at_its_next_club(tmp_path, monkeypatch):
 
     fetched = []
 
-    def fake_fetch(query):
+    def fake_fetch(query, contact):
         if "P118" in query:
             return {"results": {"bindings": [{"club": {"value": f"http://www.wikidata.org/entity/Q{i}"}} for i in (1, 2)]}}
         fetched.append(query)
@@ -68,7 +71,42 @@ def test_an_interrupted_league_resumes_at_its_next_club(tmp_path, monkeypatch):
     monkeypatch.setattr(blocklist.time, "sleep", lambda s: None)
     (tmp_path / "leagues").mkdir()
     (tmp_path / "leagues" / "A.partial").write_text("Q1\t2b26ea3743238a83\n")  # club Q1 done before the interruption
-    blocklist.build(tmp_path / "hashes.txt")
+    blocklist.build(tmp_path / "hashes.txt", "ops@example.org")
     assert len(fetched) == 1 and "wd:Q2" in fetched[0]
     assert (tmp_path / "leagues" / "A.txt").read_text() == "1ebf48ca8571b5e0\n2b26ea3743238a83\n"
     assert not (tmp_path / "leagues" / "A.partial").exists()
+
+
+def test_build_refuses_to_fetch_without_contact_details(tmp_path, monkeypatch):
+    import pytest
+
+    from touchline_analytics import blocklist
+
+    def no_fetch(*args, **kwargs):
+        raise AssertionError("fetched without contact details")
+
+    monkeypatch.setattr(blocklist, "fetch", no_fetch)
+    monkeypatch.setattr(blocklist, "LEAGUES", {"A": "Q10"})
+    with pytest.raises(ValueError, match="--contact"):
+        blocklist.build(tmp_path / "hashes.txt")
+
+
+def test_fetch_names_the_contact_and_waits_as_long_as_a_429_asks(monkeypatch):
+    import io
+    import urllib.error
+
+    from touchline_analytics import blocklist
+
+    seen, slept = [], []
+
+    def fake_urlopen(req, timeout):
+        seen.append(req.get_header("User-agent"))
+        if len(seen) == 1:
+            raise urllib.error.HTTPError(req.full_url, 429, "Too Many Requests", {"Retry-After": "45"}, None)
+        return io.BytesIO(b'{"results": {"bindings": []}}')
+
+    monkeypatch.setattr(blocklist.urllib.request, "urlopen", fake_urlopen)
+    monkeypatch.setattr(blocklist.time, "sleep", slept.append)
+    assert blocklist.fetch("SELECT", "ops@example.org") == {"results": {"bindings": []}}
+    assert "ops@example.org" in seen[0]
+    assert slept == [45.0]
PATCH
```

- [ ] **Step 2: Run them to make sure they fail**

Run: `pnpm --filter @touchline/sim-core test runner scenario params`
Expected: 5 failed, 35 passed (the scenario rate tests take a few minutes): `refuses probabilities outside 0..1` (nothing thrown for `fatigue.halfTimeRecovery: 1.5`), `refuses more retries than its sub-seeds allow` (`expected [Function] to throw an error`), `reports each entry's own result…` (`expected undefined to deeply equal [ …(2) ]`), `forces only the goals still missing…` (`TypeError: outstandingForces is not a function`), `only a press surge makes two defenders press…` (`expected { shotLogit: +0, …(10) } to match object { surge: true }`)

Run: `pnpm --filter @touchline/sim test truths`
Expected: 1 failed: `report each entry of a shared window on its own…`

Run: `uv run --project python/analytics --group dev pytest python/analytics/tests -q`
Expected: 4 failed, 23 passed: `build() takes 1 positional argument but 2 were given` (twice), `AssertionError: fetched without contact details`, `TypeError: 'str' object cannot be interpreted as an integer`; no test reaches the network

- [ ] **Step 3: Fix the engine, the runner and the truths**

Apply this change to `packages/sim-core/src/script.ts`, `packages/sim-core/src/step.ts`, `packages/sim-core/src/runner.ts`, `packages/sim-core/src/params.ts` (from the repository root):

```bash
git apply <<'PATCH'
diff --git a/packages/sim-core/src/params.ts b/packages/sim-core/src/params.ts
index 2cd0dec..9068d82 100644
--- a/packages/sim-core/src/params.ts
+++ b/packages/sim-core/src/params.ts
@@ -376,7 +376,8 @@ const PROBABILITIES = new Set([
   "defending.foulPerTackle", "defending.yellowPerFoul", "defending.redPerFoul", "defending.tackleLooseShare", "defending.interceptLooseShare",
   "defending.crossBlock", "defending.crossBlockBehind", "defending.headClearShare", "defending.headBehind", "defending.clearToTouch", "defending.clearSliceBehind",
   "keeper.letRunShare", "keeper.comeShare", "keeper.catchBase", "keeper.catchHandling", "keeper.fumbleShare",
-  "firstTouch.missedShare", "firstTouch.miscontrolShare", "substitutions.windowChance", "substitutions.halfTimeChance"
+  "firstTouch.missedShare", "firstTouch.miscontrolShare", "substitutions.windowChance", "substitutions.halfTimeChance",
+  "fatigue.halfTimeRecovery", "script.howlerFumble"
 ])
 
 /** Check every number: probabilities in 0..1, coefficients any sign, everything else not negative. */
diff --git a/packages/sim-core/src/runner.ts b/packages/sim-core/src/runner.ts
index a4d64d8..f7a5445 100644
--- a/packages/sim-core/src/runner.ts
+++ b/packages/sim-core/src/runner.ts
@@ -19,6 +19,8 @@ export interface WindowResult {
   /** Global ticks of the window's first and last frame. */
   readonly fromFrame: number
   readonly toFrame: number
+  /** Per entry (index-aligned with `entries`): whether its target was met, and whether the accepted play forced it. */
+  readonly results: ReadonlyArray<{ readonly achieved: boolean; readonly forced: boolean }>
 }
 
 /** What a step produced: its frame and events (without the match state, which would cost ~25 kB per step). */
@@ -31,10 +33,13 @@ export interface ScriptedRun {
 }
 
 export interface RunOptions {
-  /** Re-plays of a window with fresh random sub-streams before forcing (default 5). */
+  /** Re-plays of a window with fresh random sub-streams before forcing (default 5; at most MAX_RETRIES). */
   readonly retries?: number
 }
 
+/** Each window's retries draw sub-seeds window * 64 + attempt, so more than 62 would reuse the next window's. */
+export const MAX_RETRIES = 62
+
 const minuteOf = (s: MatchState): number => (s.period === "first_half" ? 0 : 45) + (Math.max(0, s.periodTick) * s.config.dt) / 60
 
 /** Fresh random sub-streams for every concern, distinct per window and attempt (so a retry plays differently). */
@@ -83,6 +88,28 @@ export const entryAchieved = (entry: ScriptEntry, events: ReadonlyArray<DomainEv
   }
 }
 
+/** Whether the accepted play forced an entry's outcome: it holds a `scripted` event of the entry's kind. */
+export const entryForced = (entry: ScriptEntry, events: ReadonlyArray<DomainEvent>, cfg: MatchConfig): boolean => {
+  const team = entry.team === "home" ? cfg.home.id : cfg.away.id
+  const opp = entry.team === "home" ? cfg.away.id : cfg.home.id
+  const scripted = events.filter((e) => e.attrs.scripted === true)
+  switch (entry.effect) {
+    case "goal":
+      return scripted.some((e) => e.type === "shot" && e.team_id === team && e.outcome === "goal")
+    case "red_card":
+      return scripted.some((e) => e.type === "card" && e.team_id === team)
+    case "keeper_heroics":
+      return scripted.some((e) => e.type === "shot" && e.team_id === opp && e.outcome === "saved")
+    case "keeper_howler":
+      return scripted.some((e) => e.type === "shot" && e.team_id === opp && e.outcome === "goal")
+    case "defensive_error":
+      return scripted.some((e) => (e.type === "pass" || e.type === "clearance") && e.team_id === team)
+    case "press_surge":
+    case "momentum_swing":
+      return false
+  }
+}
+
 /** Entries grouped by identical window, in window order; overlapping windows are refused. */
 const groups = (entries: ReadonlyArray<ScriptEntry>): ScriptEntry[][] => {
   const byWindow = new Map<string, ScriptEntry[]>()
@@ -114,6 +141,7 @@ const forcesFor = (block: ReadonlyArray<ScriptEntry>): ScriptEntry[] => block.fl
  */
 export const runScript = (cfg: MatchConfig, opts: RunOptions = {}): ScriptedRun => {
   const retries = opts.retries ?? 5
+  if (!Number.isInteger(retries) || retries < 0 || retries > MAX_RETRIES) throw new ScriptError(`retries must be an integer from 0 to ${MAX_RETRIES} (got ${retries})`)
   const blocks = groups(cfg.script?.entries ?? [])
   const steps: StepOutput[] = []
   const windows: WindowResult[] = []
@@ -147,7 +175,8 @@ export const runScript = (cfg: MatchConfig, opts: RunOptions = {}): ScriptedRun
         steps.push(...buffer)
         s = { ...t, forced: [] }
         const frames = buffer.filter((r) => r.frame)
-        windows.push({ entries: block, achieved, attempts: attempt + 1, forced: forcing, fromFrame: frames[0]?.frame!.tick ?? checkpoint.tick, toFrame: frames.at(-1)?.frame!.tick ?? checkpoint.tick })
+        const results = block.map((e) => ({ achieved: entryAchieved(e, events, cfg), forced: forcing && entryForced(e, events, cfg) }))
+        windows.push({ entries: block, achieved, attempts: attempt + 1, forced: forcing, fromFrame: frames[0]?.frame!.tick ?? checkpoint.tick, toFrame: frames.at(-1)?.frame!.tick ?? checkpoint.tick, results })
         return
       }
     }
diff --git a/packages/sim-core/src/script.ts b/packages/sim-core/src/script.ts
index 903a766..4c7df0d 100644
--- a/packages/sim-core/src/script.ts
+++ b/packages/sim-core/src/script.ts
@@ -44,9 +44,11 @@ export interface Mods {
   readonly mishit: number
   /** Multiplies the team's shooting error (below 1: sharper finishing). */
   readonly aim: number
+  /** A press surge is on: the two nearest defenders press, from further away (not just any rise in pressing). */
+  readonly surge: boolean
 }
 
-export const NO_MODS: Mods = { shotLogit: 0, attackLogit: 0, scoring: 1, press: 1, tackle: 1, foul: 1, red: 1, saveLogit: 0, fumble: 0, mishit: 1, aim: 1 }
+export const NO_MODS: Mods = { shotLogit: 0, attackLogit: 0, scoring: 1, press: 1, tackle: 1, foul: 1, red: 1, saveLogit: 0, fumble: 0, mishit: 1, aim: 1, surge: false }
 
 /**
  * Whether match minute `minute` of `period` is inside a window. Minutes 45+ happen in both halves (first-half added
@@ -86,7 +88,7 @@ export const modsFor = (script: Script | undefined, side: Side, minute: number,
         m = { ...m, shotLogit: m.shotLogit + s.momentumLogit, attackLogit: m.attackLogit + s.momentumLogit, press: m.press * s.momentumPress }
         break
       case "press_surge":
-        m = { ...m, press: m.press * s.pressSurge, tackle: m.tackle * s.pressTackle }
+        m = { ...m, press: m.press * s.pressSurge, tackle: m.tackle * s.pressTackle, surge: true }
         break
       case "red_card":
         m = { ...m, foul: m.foul * s.redFoul, red: m.red * s.redCard }
@@ -105,6 +107,22 @@ export const modsFor = (script: Script | undefined, side: Side, minute: number,
   return m
 }
 
+/**
+ * The forced outcomes still needed: a goal entry keeps at most as many forced goals as it is short of its count
+ * (goals scored naturally meanwhile count towards it); other forced outcomes are kept.
+ */
+export const outstandingForces = (script: Script | undefined, forced: ReadonlyArray<ScriptEntry>, goals: ReadonlyArray<number>): ScriptEntry[] => {
+  const entries = script?.entries ?? []
+  const left = entries.map((e, i) => (e.effect === "goal" ? Math.max(0, (e.count ?? 1) - (goals[i] ?? 0)) : Infinity))
+  return forced.filter((f) => {
+    const i = entries.indexOf(f)
+    if (i < 0 || f.effect !== "goal") return true
+    if (left[i]! <= 0) return false
+    left[i]!--
+    return true
+  })
+}
+
 /** Count a goal for `side` at `minute` against every goal entry for that side whose window contains it. */
 export const countGoal = (script: Script | undefined, goals: ReadonlyArray<number>, side: Side, minute: number, period?: Period): number[] =>
   (script?.entries ?? []).map((e, i) => (goals[i] ?? 0) + (e.effect === "goal" && e.team === side && inWindow(e.window, minute, period) ? 1 : 0))
diff --git a/packages/sim-core/src/step.ts b/packages/sim-core/src/step.ts
index 8ddfa8e..b069027 100644
--- a/packages/sim-core/src/step.ts
+++ b/packages/sim-core/src/step.ts
@@ -26,7 +26,7 @@ import type { Action } from "./params.js"
 import { goalLineCrossing, keeperLetsRun, MAX_FLIGHT_S, resolveFlight } from "./resolve.js"
 import { hazard, Rng, substream } from "./rng.js"
 import { anchorFor, kickoffAnchor } from "./shape.js"
-import { countGoal, modsFor, type Mods, type ScenarioEffect, type ScriptEntry } from "./script.js"
+import { countGoal, modsFor, outstandingForces, type Mods, type ScenarioEffect, type ScriptEntry } from "./script.js"
 import { parryBall, planShot, type ShotMods } from "./shot.js"
 import { ballAfterTouch, drawFirstTouch, firstTouchError, type FirstTouch } from "./touch.js"
 import {
@@ -248,7 +248,11 @@ class Work {
   /** A goal for `side`: the score, and the script's goal progress. */
   addGoal(side: Side): void {
     this.score[side] += 1
-    if (this.cfg.script) this.scriptGoals = countGoal(this.cfg.script, this.scriptGoals, side, this.minute(), this.period)
+    if (this.cfg.script) {
+      this.scriptGoals = countGoal(this.cfg.script, this.scriptGoals, side, this.minute(), this.period)
+      // A natural goal counts towards a forced target: only the shortfall stays forced.
+      this.forced = outstandingForces(this.cfg.script, this.forced, this.scriptGoals)
+    }
   }
   /** Whether an outcome of `effect` is forced for `side`'s next qualifying action. */
   hasForced(side: Side, effect: ScenarioEffect): boolean {
@@ -1002,7 +1006,7 @@ const moveTarget = (w: Work, pl: PlayerState, ballFlat: Vec2, possSide: Side | n
       return { target: interceptPoint(pl.pos, vmax, owner.pos, owner.vel), speedCap: vmax }
     const defenders = w.active(pl.side).filter((x) => x.role !== "GK").sort((a, b) => dist(a.pos, owner.pos) - dist(b.pos, owner.pos))
     // The nearest defender presses; in a scripted press surge the two nearest do, from further away.
-    const surge = w.mods(pl.side).press > 1
+    const surge = w.mods(pl.side).surge
     const presser = surge ? defenders.slice(0, 2).some((x) => x.id === pl.id) : defenders[0]?.id === pl.id
     if (presser && dist(pl.pos, owner.pos) < (surge ? 25 : 18)) {
       const style = team.style
PATCH
```

Apply this change to `packages/sim/src/truths.ts`, `packages/sim/src/writer.ts` (from the repository root):

```bash
git apply <<'PATCH'
diff --git a/packages/sim/src/truths.ts b/packages/sim/src/truths.ts
index e228a60..b1277d1 100644
--- a/packages/sim/src/truths.ts
+++ b/packages/sim/src/truths.ts
@@ -20,25 +20,29 @@ export interface ScriptTruth {
   readonly effect: ScenarioEffect
   readonly team_id: string
   readonly minutes: readonly [number, number]
+  /** The window's first and last frame as global ticks (as in domain.jsonl), not CDF frame ids, which restart each period. */
   readonly frames: readonly [number, number]
   readonly count: number
+  /** Whether this entry's target was met in the accepted play. */
   readonly achieved: boolean
+  /** Plays of the window (shared by the entries of one window). */
   readonly attempts: number
+  /** Whether this entry's outcome was forced (its forced events carry `scripted: true`). */
   readonly forced: boolean
   readonly expected_metrics: ReadonlyArray<string>
 }
 
 export const scriptTruths = (windows: ReadonlyArray<WindowResult>, cfg: MatchConfig): ScriptTruth[] =>
   windows.flatMap((w) =>
-    w.entries.map((e) => ({
+    w.entries.map((e, i) => ({
       effect: e.effect,
       team_id: e.team === "home" ? cfg.home.id : cfg.away.id,
       minutes: e.window,
       frames: [w.fromFrame, w.toFrame] as const,
       count: e.count ?? 1,
-      achieved: w.achieved,
+      achieved: w.results[i]!.achieved,
       attempts: w.attempts,
-      forced: w.forced,
+      forced: w.results[i]!.forced,
       expected_metrics: EXPECTED_METRICS[e.effect]
     }))
   )
diff --git a/packages/sim/src/writer.ts b/packages/sim/src/writer.ts
index 0139b68..1d10ad1 100644
--- a/packages/sim/src/writer.ts
+++ b/packages/sim/src/writer.ts
@@ -23,7 +23,10 @@ export interface RunManifest {
   readonly stats: { readonly frames: number; readonly events: number; readonly cdf_events: number; readonly score: string }
   /** The noise added to the CDF events (see noise.ts), or null when they are exact. */
   readonly realism_noise: typeof REALISM_NOISE | null
-  /** Ground truth for the evaluation harness (spec §5.1.12, §5.3.1); kept out of CDF. */
+  /**
+   * Ground truth for the evaluation harness (spec §5.1.12, §5.3.1); kept out of CDF. Its frame ids (`frames`,
+   * `frame_id`) are global ticks, as in domain.jsonl and the stats engine; CDF frame ids restart at 0 each period.
+   */
   readonly truths: {
     readonly script: ReadonlyArray<ScriptTruth>
     readonly scripted_events: ReadonlyArray<{ readonly id: string; readonly type: string; readonly frame_id: number; readonly team_id: string | null; readonly player_id: string | null }>
PATCH
```

- [ ] **Step 4: Fix the blocklist fetcher and record the fetch dates**

Apply this change to `python/analytics/touchline_analytics/blocklist.py` (from the repository root):

```bash
git apply <<'PATCH'
diff --git a/python/analytics/touchline_analytics/blocklist.py b/python/analytics/touchline_analytics/blocklist.py
index b1afa7e..936cac3 100644
--- a/python/analytics/touchline_analytics/blocklist.py
+++ b/python/analytics/touchline_analytics/blocklist.py
@@ -4,7 +4,8 @@ Names of footballers who played for clubs in major leagues come from Wikidata (C
 hashes in data/blocklist/real-player-name-hashes.txt; the league generator (packages/league) never uses a
 generated name whose hash is on the list. Normalisation and hashing match `normaliseName` / `nameHash` there.
 
-Usage: uv run --project python/analytics python -m touchline_analytics.blocklist
+Usage: uv run --project python/analytics python -m touchline_analytics.blocklist [--contact URL-or-email]
+(a contact is needed only when a league in LEAGUES has not been fetched yet; Wikimedia asks every client for one)
 """
 
 from __future__ import annotations
@@ -22,7 +23,8 @@ import urllib.request
 from pathlib import Path
 
 ENDPOINT = "https://query.wikidata.org/sparql"
-USER_AGENT = "touchline-hackathon/0.1 (synthetic football data; real-player name blocklist)"
+# Wikimedia's User-Agent policy asks for contact details; whoever fetches gives them (--contact).
+USER_AGENT = "touchline-hackathon/0.1 ({contact}; synthetic football data; real-player name blocklist)"
 FOOTBALLER = "Q937857"  # occupation: association football player
 # Wikidata ids of the leagues whose clubs' players are blocked (checked 2026-10-05). The English leagues come
 # first: this is a Premier League product. More can be added later (each run fetches only leagues not saved yet),
@@ -71,35 +73,47 @@ def hashes_from_sparql(result: dict) -> set[str]:
     return out
 
 
-def fetch(query: str, attempts: int = 5) -> dict:
+def _retry_after(e: urllib.error.HTTPError) -> float:
+    """Seconds the server asked us to wait (a Retry-After header in seconds), else 0."""
+    v = (e.headers.get("Retry-After") if e.headers else None) or ""
+    return float(v) if v.strip().isdigit() else 0.0
+
+
+def fetch(query: str, contact: str, attempts: int = 5) -> dict:
     """Run a SPARQL query. A response cut off by the endpoint's time limit (invalid JSON), a dropped connection
-    a truncated body or a 429/5xx answer is retried after 10, 20, 40, 80 s."""
+    a truncated body or a 429/5xx answer is retried after 10, 20, 40, 80 s, or later if the server says so."""
     url = ENDPOINT + "?" + urllib.parse.urlencode({"query": query, "format": "json"})
-    req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT, "Accept": "application/sparql-results+json"})
+    req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT.format(contact=contact), "Accept": "application/sparql-results+json"})
     for i in range(attempts):
+        wait = 10.0 * 2**i
         try:
             with urllib.request.urlopen(req, timeout=120) as resp:
                 return json.load(resp)
         except urllib.error.HTTPError as e:
             if e.code != 429 and e.code < 500 or i == attempts - 1:
                 raise
+            wait = max(wait, _retry_after(e))
         except (json.JSONDecodeError, urllib.error.URLError, http.client.HTTPException, ConnectionError, TimeoutError):
             if i == attempts - 1:
                 raise
-        time.sleep(10 * 2**i)
+        time.sleep(wait)
     raise AssertionError("unreachable")
 
 
-def build(out: Path) -> dict:
+def build(out: Path, contact: str | None = None) -> dict:
     """Fetch every league not fetched yet (each saved as soon as it is done, in a `leagues/` folder next to
-    `out`, so an interrupted run resumes where it stopped), then write the combined, sorted hash list."""
+    `out`, with the date it was fetched, so an interrupted run resumes where it stopped), then write the combined,
+    sorted hash list. Fetching needs `contact` (a URL or e-mail for the User-Agent)."""
     per_league = out.parent / "leagues"
     per_league.mkdir(parents=True, exist_ok=True)
     counts = {}
+    fetched_at: dict[str, str | None] = {}
     hashes: set[str] = set()
     for name, qid in LEAGUES.items():
         path = per_league / f"{name}.txt"
         if not path.exists():
+            if not contact:
+                raise ValueError(f"{name} is not fetched yet: give --contact (a URL or e-mail; Wikimedia asks every client for one)")
             # Progress is kept per club ("club<TAB>hash" lines), so an interrupted league resumes at its next club.
             partial = per_league / f"{name}.partial"
             done: dict[str, set[str]] = {}
@@ -109,20 +123,23 @@ def build(out: Path) -> dict:
                         club, _, h = line.partition("\t")
                         done.setdefault(club, set()).update([h] if h else [])
             with partial.open("a") as fh:
-                for club in club_ids(fetch(clubs_query(qid))):
+                for club in club_ids(fetch(clubs_query(qid), contact)):
                     if club in done:
                         continue
-                    found = hashes_from_sparql(fetch(players_query(club)))
+                    found = hashes_from_sparql(fetch(players_query(club), contact))
                     fh.write("".join(f"{club}\t{h}\n" for h in sorted(found)) or f"{club}\t\n")
                     fh.flush()
                     done[club] = found
                     time.sleep(0.5)  # be polite to the public endpoint
             league = set().union(*done.values()) if done else set()
             path.write_text("".join(f"{h}\n" for h in sorted(league)))
+            path.with_suffix(".fetched").write_text(dt.date.today().isoformat() + "\n")
             partial.unlink()
             print(f"{name}: {len(league)} names", flush=True)
         league_hashes = {line for line in path.read_text().split("\n") if line}
         counts[name] = len(league_hashes)
+        stamp = path.with_suffix(".fetched")
+        fetched_at[name] = stamp.read_text().strip() if stamp.exists() else None
         hashes |= league_hashes
     out.write_text("".join(f"{h}\n" for h in sorted(hashes)))
     meta = {
@@ -131,11 +148,16 @@ def build(out: Path) -> dict:
         "names_per_league": counts,
         "hashes": len(hashes),
         "hash": "sha256 of the normalised name (NFKD, accents removed, lower case, a-z only), first 16 hex digits",
-        "fetched_at": dt.date.today().isoformat(),
+        "fetched_at": fetched_at,
     }
     out.with_suffix(".meta.json").write_text(json.dumps(meta, indent=1) + "\n")
     return meta
 
 
 if __name__ == "__main__":
-    print(json.dumps(build(Path("data/blocklist/real-player-name-hashes.txt")), indent=1))
+    import argparse
+
+    ap = argparse.ArgumentParser(description="Build the real-player name blocklist from Wikidata (hashes only)")
+    ap.add_argument("--contact", default=None, help="URL or e-mail sent in the User-Agent (needed only to fetch a league not saved yet)")
+    args = ap.parse_args()
+    print(json.dumps(build(Path("data/blocklist/real-player-name-hashes.txt"), args.contact), indent=1))
PATCH
```

Create `data/blocklist/leagues/Premier League.fetched`:

```text
2026-10-05
```

Create `data/blocklist/leagues/EFL Championship.fetched`:

```text
2026-10-05
```

Run: `uv run --project python/analytics python -m touchline_analytics.blocklist`
Expected: no network use (both leagues are saved); the hash list is unchanged and `real-player-name-hashes.meta.json` now shows `"fetched_at": {"Premier League": "2026-10-05", "EFL Championship": "2026-10-05"}`

- [ ] **Step 5: Run everything**

Run: `pnpm --filter @touchline/sim-core test runner scenario params && pnpm --filter @touchline/sim test truths && uv run --project python/analytics --group dev pytest python/analytics/tests -q`
Expected: all pass (the scenario rate tests take a few minutes); 27 passed

Run: `pnpm turbo run typecheck test --force`
Expected: `Tasks: 14 successful`; the realism gate and the stats golden match are unchanged

- [ ] **Step 6: Commit**

```bash
git add packages/sim-core packages/sim python/analytics data/blocklist
git commit -m "fix: Plan 2c review minors — per-entry script truths, forced goals only for the shortfall, press surge flag, retry limit, range checks, blocklist contact and Retry-After, global-tick frames documented

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```



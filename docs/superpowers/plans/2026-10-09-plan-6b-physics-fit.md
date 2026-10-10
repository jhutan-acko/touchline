# Physics Fitted on Real Tracking (Plan 6b) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Measure the engine's physics on the seven IDSSE tracking matches (ball drag, bounce, skid and roll; player acceleration, braking, turning and reaction), run the engine's ball and player movement on the fitted constants, and measure the simulated players against real ones (movement statistics and work rate by period) — so the ball and the players move like real football, and what still differs is measured and reported.

**Architecture:** An offline Python harness (`python/analytics/touchline_analytics/physics/`) streams the TRACAB files, cuts the ball tracking into free-ball spans, fits each constant with a bootstrap interval, validates on two held-out matches against the real match-to-match spread, and writes `data/params/physics.json` (aggregates only) plus the engine's copy in `touchline-params.json`. The engine (`packages/sim-core`) gets a line-for-line port of the Python ball model (parity-tested) and an acceleration-speed movement model, behind `physics.enabled` until one switch-on task removes the old code; who reaches a moving ball keeps its tuned rule (Ruling 10). `packages/calibrate` ports the player movement statistics and the work rate (parity-tested) into a physics gate, and the realism report gains both.

**Tech Stack:** TypeScript (pnpm/turbo monorepo, vitest), Python 3.11 (uv, pytest, numpy 2.3.4, scipy 1.16.3), IDSSE / Sportec Open DFL tracking (CC-BY 4.0).

**Spec:** `docs/superpowers/specs/2026-10-09-physics-fit-design.md` (criteria P1–P7, with the Revision made after measurement). Rulings made while building the prototype, against the spec, are listed under "Rulings" below; each is also stated in the task it affects.

## Global Constraints

- Only aggregate statistics from real data are committed (IDSSE, CC-BY 4.0; attribution to the DFL and Bassek et al.). `data/raw/idsse/` and `out/` stay git-ignored. No StatsBomb. No GPL or AGPL code; only published equations and parameter values are reused.
- One definition for real and simulated data: Python is the reference (`physics/ballmodel.py`, `physics/validate.py`), and `packages/sim-core/src/ball.ts` and `packages/calibrate/src/physics.ts` are line-for-line ports guarded by parity tests.
- The engine is deterministic for a seed. The new physics code (`ball.ts`, `kinematics.ts`) uses no `Math.exp`, `Math.pow`, `Math.log` (e^-x comes from a table built by multiplication).
- Until Task 12, `physics.enabled` is `false`: the engine's output, the realism baseline and every pinned fixture stay as they are.
- The fitted constants are fixed: the tuner calibrates behaviour on top of them and never moves a physics constant. Task 12 needs no recalibration (Ruling 10).
- Pitch coordinates are centred metres, 105 × 68. Ball heights in the engine and the Python model are of the ball's bottom; tracking reports its centre (radius 0.11 m).
- Run every command from the `touchline/` repository root. The IDSSE files are in `data/raw/idsse/` (download with `uv run --project python/analytics python -m touchline_analytics.idsse --tracking J03WMX J03WN1 J03WOH J03WOY J03WPY J03WQQ J03WR9` if missing; behind the corporate proxy set `SSL_CERT_FILE`, see the toolchain notes).
- Commit messages end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Rulings (prototype, 2026-10-09)

1. **Kicks are found in the tracking, not the events.** Only 17 % of DFL passes and shots fall within 0.2 s of the tracked speed jump (69 % within 1 s), so a kick is a ≥ 3 m/s speed jump with a player within 1.5 m; events only label kicks (nearest within 1.5 s). DFL has no Clearance event; Play and ShotAtGoal are used.
2. **A ground ball skids before it rolls.** With the spec's rolling law alone the fit stopped a 3.2 m/s ball in 1.7 m (FIFA band 4–8 m), because struck balls skid. The ground model adds Coulomb skid friction `mu_s` (same physics as the bounce) until the ball spins up; `mu_s` is fitted separately from the bounce friction `mu`.
3. **Bounce friction range 0.1–1.2** (spec: 0.3–1.2). Bundesliga grass slides through a bounce (fitted 0.24); the spec's range assumed artificial turf.
4. **Restitution fallback by precision.** Only 171 bounces have a clean flight both sides (spec minimum 200); they agree closely (95 % interval 0.738–0.761). The fallback to the certified 0.62 now applies below 100 bounces or with an interval wider than 0.1.
5. **Keepers' top speed range 6–11 m/s** (outfield 7.5–11): keepers rarely sprint, and their fitted S0 is 7.4 m/s.
6. **Replay floor.** "Within 1.5× the per-segment best-fit residual" is measured as the fitted constants from the best start against constants refitted to that span from the same start (the ratio isolates the constants); P4 passes on the median ratio over 200 held-out spans.
7. **Work rate by period (user, 2026-10-09).** Added to P3's statistics on request: metres per minute and above 20 km/h per 15-minute period for full-match outfielders, real against simulated, reported and not gated (spec P7).
8. **"No transcendental functions" applies to the physics files** (`ball.ts`, `kinematics.ts`); the rest of the engine already used them. The replay hash test still guards determinism.
9. **Player smoothing.** Positions come rounded to the centimetre, so acceleration-based fits use a 21-frame (0.84 s) cubic Savitzky–Golay window; reaction timing uses the loader's 7-frame window. Tracking jumps (a step faster than 11 m/s after frozen frames) are blanked for a second either side, not the whole player.
10. **Who reaches a moving ball keeps its tuned rule (user decision, 2026-10-09; spec Revision).** Measured piece by piece on the gate matches, the fitted ball (loss 30.0 → 25.5) and the fitted movement (→ 26.4) help, while the fitted 0.2 s reaction and sprint-from-rest reach for who wins a pass hurt (→ 69.7): the reach disc runs a player straight to where the ball will be, as if they knew where the pass was going, and the tuned 0.7 s also covers reading the pass. `resolve.ts` keeps `reachIn` with `kinematics.reactionS` and `accelMax`; the fitted 0.2 s is reported in `physics.json`. A movement-pace policy tried for P3 (3 of 13 inside, loss 88) is not part of this plan; P3 is a reported gap.

## Review Focus

1. **Real tracking with gaps, frozen frames and jumps:** a player who leaves and re-enters, or whose position freezes and jumps, must never produce a speed taken across the gap (test in Tasks 5 and 6).
2. **A span that starts or ends at the edge of a half, or with missing ball frames:** segmentation stops the span, never reads past the array (test in Task 3).
3. **Ground passes that must arrive while still skidding (short, fast passes):** `groundLaunchSpeed` must still invert the distance (test in Task 8).
4. **A player standing still, or exactly at the target:** `steer` and `approach` must not divide by zero or overshoot (test in Task 9).
5. **The parameter file written by Python and read by TypeScript:** numbers formatted by Python (`4e-05`) must parse to the same values, and unknown keys stay ignored (Task 7 writes it; Task 8's suite reads it).
6. **Work rate for players who did not play the whole match** (substitutes, players sent off, keepers): they must be left out, never averaged in (test in Task 11).

## How this plan was verified

The plan was built as a prototype first, one commit per task on the spec commit (`bd7a911`), and generated from those
commits; every code block below is a file or patch from them.

- **Tests fail first.** For Tasks 1–12, each task's tests were put on its parent commit and run: every RED command
  fails as stated. Task 13 is documentation only.
- **Every commit passes.** At each commit, the suites its changes touch were run (Python analytics, and the TypeScript
  packages it changes; a change to `data/params/` also runs `sim-core` and `calibrate`). All pass. At Task 11 the
  unchanged realism gate test (16 matches, about two minutes) once hit its 120 s limit while `sim-core` ran alongside;
  it passes alone, and Task 12 gives it five minutes.
- **The whole repository passes at Task 12:** `pnpm turbo run test --continue --concurrency=4 -- --maxWorkers=3`,
  12 of 12 packages (5 min 21 s); Python analytics 104 passed; agents 158 passed.
- **Replay.** On a fresh clone at `bd7a911`, applying this document's code blocks task by task reproduces every
  prototype commit's tree exactly. The generated files (`physics.json`, the parameter file, the realism baseline and
  report, the stats golden summary, `uv.lock`) come from commands in the steps; the replay took them from the prototype.
- **Measured results** (Task 12, gate matches): realism loss 24.79 (30.0 before), 12 of 19 statistics within 1 SD, 19 of
  19 within 2 SD; player movement 1 of 13 inside the real envelope (a reported gap). Work rate: late-to-early ratio 1.00
  on the gate matches and 0.95 on the report's, against 0.84–0.99 real, with no decline across the match.

---

### Task 1: Stream IDSSE positions and kick events

The physics fit reads the raw TRACAB position files (~370 MB of XML each, one `<Frame>` per line) and the DFL event files. This task streams them into per-half arrays aligned on the frame counter, caches them as `.npz`, reads kick events, and adds the Savitzky–Golay smoothing every later fit uses. It also adds numpy and scipy (BSD) to the analytics package.

**Files:**
- Create: `python/analytics/touchline_analytics/physics/__init__.py` (empty)
- Create: `python/analytics/touchline_analytics/physics/load.py`
- Modify: `python/analytics/pyproject.toml`, `python/analytics/uv.lock` (numpy 2.3.4, scipy 1.16.3)
- Test: `python/analytics/tests/test_physics_load.py`

**Interfaces:**
- Produces: `FPS = 25`; `Half(period, n0, t0, ball (n,3), live (n,), players: dict[id, (n,2)], teams: dict[id, team])`; `KickEvent(time, kind, player)`; `parse_positions(path) -> list[Half]`; `load_match(path, cache) -> list[Half]`; `kick_events(path) -> list[KickEvent]`; `smooth(xy, fps=FPS, window=7, order=2) -> (pos, vel, acc)` (Task 5 adds the `window`/`order` arguments and `player_positions`).

- [ ] **Step 1: Write the failing tests**

Create `python/analytics/tests/test_physics_load.py`:

```python
import math

import numpy as np

from touchline_analytics.physics.load import FPS, kick_events, load_match, parse_positions, smooth

POSITIONS = """<?xml version="1.0" encoding="UTF-8" standalone="yes" ?>
<PutDataRequest>
<Positions EventTime="2022-10-15T11:01:29.320+00:00">
<FrameSet GameSection="firstHalf" MatchId="DFL-MAT-X" TeamId="DFL-CLU-A" PersonId="DFL-OBJ-P1">
<Frame N="10000" T="2022-10-15T11:01:29.320+00:00" X="1.00" Y="2.00" D="0.00" S="0.00" A="0.00" M="1"/>
<Frame N="10001" T="2022-10-15T11:01:29.360+00:00" X="1.20" Y="2.00" D="0.00" S="0.00" A="0.00" M="1"/>
<Frame N="10002" T="2022-10-15T11:01:29.400+00:00" X="1.40" Y="2.00" D="0.00" S="0.00" A="0.00" M="1"/>
</FrameSet>
<FrameSet GameSection="firstHalf" MatchId="DFL-MAT-X" TeamId="DFL-CLU-B" PersonId="DFL-OBJ-P2">
<Frame N="10001" T="2022-10-15T11:01:29.360+00:00" X="-5.00" Y="0.00" D="0.00" S="0.00" A="0.00" M="1"/>
<Frame N="10002" T="2022-10-15T11:01:29.400+00:00" X="-5.00" Y="0.50" D="0.00" S="0.00" A="0.00" M="1"/>
</FrameSet>
<FrameSet GameSection="firstHalf" MatchId="DFL-MAT-X" TeamId="BALL" PersonId="DFL-OBJ-B">
<Frame N="10000" T="2022-10-15T11:01:29.320+00:00" X="0.00" Y="0.00" Z="0.11" D="0.00" S="0.00" A="0.00" M="1" BallPossession="1" BallStatus="0"/>
<Frame N="10001" T="2022-10-15T11:01:29.360+00:00" X="0.40" Y="0.00" Z="0.30" D="0.00" S="0.00" A="0.00" M="1" BallPossession="1" BallStatus="1"/>
<Frame N="10002" T="2022-10-15T11:01:29.400+00:00" X="0.80" Y="0.00" Z="0.50" D="0.00" S="0.00" A="0.00" M="1" BallPossession="2" BallStatus="1"/>
</FrameSet>
<FrameSet GameSection="secondHalf" MatchId="DFL-MAT-X" TeamId="DFL-CLU-A" PersonId="DFL-OBJ-P1">
<Frame N="100000" T="2022-10-15T12:05:00.000+00:00" X="3.00" Y="4.00" D="0.00" S="0.00" A="0.00" M="1"/>
</FrameSet>
<FrameSet GameSection="secondHalf" MatchId="DFL-MAT-X" TeamId="BALL" PersonId="DFL-OBJ-B">
<Frame N="100000" T="2022-10-15T12:05:00.000+00:00" X="0.00" Y="0.00" Z="0.11" D="0.00" S="0.00" A="0.00" M="1" BallPossession="1" BallStatus="1"/>
</FrameSet>
</Positions>
</PutDataRequest>
"""

EVENTS = """<?xml version="1.0" encoding="UTF-8" standalone="yes" ?>
<PutDataRequest>
<Event EventId="1" X-Position="52.50" EventTime="2022-10-15T13:01:29.400+02:00" Y-Position="34.00" MatchId="DFL-MAT-X">
 <KickOff GameSection="firstHalf">
  <Play Team="DFL-CLU-A" Evaluation="successfullyCompleted" Player="DFL-OBJ-P1">
   <Pass/>
  </Play>
 </KickOff>
</Event>
<Event EventId="2" EventTime="2022-10-15T13:01:30.000+02:00" MatchId="DFL-MAT-X">
 <ShotAtGoal Team="DFL-CLU-B" Player="DFL-OBJ-P2">
  <ShotWide/>
 </ShotAtGoal>
</Event>
<Event EventId="3" EventTime="2022-10-15T13:01:31.000+02:00" MatchId="DFL-MAT-X">
 <Foul Fouler="DFL-OBJ-P2"/>
</Event>
</PutDataRequest>
"""


def test_parse_positions_aligns_players_and_ball_by_frame(tmp_path):
    f = tmp_path / "pos.xml"
    f.write_text(POSITIONS)
    halves = parse_positions(f)
    assert [h.period for h in halves] == [1, 2]
    first = halves[0]
    assert first.n0 == 10000 and len(first.ball) == 3
    assert np.allclose(first.ball[:, 2], [0.11, 0.30, 0.50])
    assert first.live.tolist() == [False, True, True]
    assert first.teams == {"DFL-OBJ-P1": "DFL-CLU-A", "DFL-OBJ-P2": "DFL-CLU-B"}
    p2 = first.players["DFL-OBJ-P2"]
    assert math.isnan(p2[0, 0]) and p2[2].tolist() == [-5.0, 0.5]
    assert first.t0 == 1665831689.32
    assert halves[1].players["DFL-OBJ-P1"].tolist() == [[3.0, 4.0]]


def test_load_match_caches_parsed_halves(tmp_path):
    f = tmp_path / "pos.xml"
    f.write_text(POSITIONS)
    cache = tmp_path / "cache"
    a = load_match(f, cache / "X.npz")
    assert (cache / "X.npz").exists()
    f.write_text("not xml any more")  # a second load must come from the cache
    b = load_match(f, cache / "X.npz")
    assert [h.period for h in b] == [1, 2]
    assert np.allclose(b[0].ball, a[0].ball) and b[0].teams == a[0].teams and b[0].t0 == a[0].t0
    assert np.array_equal(np.isnan(b[0].players["DFL-OBJ-P2"]), np.isnan(a[0].players["DFL-OBJ-P2"]))


def test_kick_events_reads_plays_and_shots_with_utc_times(tmp_path):
    f = tmp_path / "ev.xml"
    f.write_text(EVENTS)
    ev = kick_events(f)
    assert [(e.kind, e.player) for e in ev] == [("pass", "DFL-OBJ-P1"), ("shot", "DFL-OBJ-P2")]
    assert ev[0].time == 1665831689.4  # 13:01:29.4 at +02:00 is 11:01:29.4 UTC


def test_smooth_recovers_velocity_and_acceleration_of_a_parabola():
    t = np.arange(100) / FPS
    x = 2.0 * t + 1.5 * t * t
    pos, vel, acc = smooth(np.stack([x, np.zeros_like(x)], axis=1))
    assert np.allclose(pos[:, 0], x, atol=1e-9)
    assert np.allclose(vel[10:-10, 0], 2.0 + 3.0 * t[10:-10], atol=1e-6)
    assert np.allclose(acc[10:-10, 0], 3.0, atol=1e-6)


def test_smooth_keeps_gaps_and_skips_runs_shorter_than_the_window():
    x = np.arange(40, dtype=float)
    x[10] = np.nan  # one missing frame splits the series
    x[30:] = np.nan
    pos, vel, _ = smooth(np.stack([x, x], axis=1))
    assert np.isnan(pos[10, 0]) and np.isnan(vel[30:, 0]).all()
    assert not np.isnan(vel[:10]).any()  # the 10-frame run is long enough for the 7-frame window
    assert np.allclose(vel[12:28, 0], FPS)
```

- [ ] **Step 2: Run them to make sure they fail**

Run: `uv run --locked --project python/analytics pytest -q python/analytics/tests/test_physics_load.py`
Expected: collection error (`No module named 'numpy'`: numpy and the physics package are not there yet)

- [ ] **Step 3: Write the implementation**

Create `python/analytics/touchline_analytics/physics/__init__.py`:

```python

```

Create `python/analytics/touchline_analytics/physics/load.py`:

```python
"""Read IDSSE (TRACAB Gen5, 25 Hz) positions and kick events for the physics fit.

The position files are ~370 MB of XML with one <Frame> per line, so they are streamed line by line
rather than parsed as a tree. Each half becomes arrays aligned on the frame counter N: ball (x, y, z),
ball status, and every player's (x, y) with NaN where the player was not on the pitch.
Coordinates are centred metres (the file's own frame). Parsed halves are cached as .npz files in the
git-ignored out/physics/ folder; nothing here is ever committed.
"""

from __future__ import annotations

import datetime as dt
import re
from dataclasses import dataclass
from pathlib import Path

import numpy as np
from scipy.signal import savgol_filter

FPS = 25
WINDOW = 7  # Savitzky-Golay window in frames (0.28 s)
ORDER = 2

_FRAMESET = re.compile(rb'GameSection="(\w+)".*?TeamId="([^"]+)" PersonId="([^"]+)"')
_FRAME = re.compile(rb'<Frame N="(\d+)" T="([^"]+)" X="([-\d.]+)" Y="([-\d.]+)"')
_Z = re.compile(rb' Z="([-\d.]+)"')
_STATUS = re.compile(rb' BallStatus="(\d)"')
_PERIOD = {b"firstHalf": 1, b"secondHalf": 2, b"firstHalfExtra": 3, b"secondHalfExtra": 4}


@dataclass
class Half:
    period: int
    n0: int  # frame counter N of the first ball frame
    t0: float  # UTC epoch seconds of that frame
    ball: np.ndarray  # (n, 3) x, y, z; NaN where missing
    live: np.ndarray  # (n,) bool, BallStatus 1
    players: dict[str, np.ndarray]  # id -> (n, 2), NaN where absent
    teams: dict[str, str]  # player id -> team id


@dataclass
class KickEvent:
    time: float  # UTC epoch seconds
    kind: str  # "pass" or "shot"
    player: str


def _epoch(stamp: bytes | str) -> float:
    s = stamp.decode() if isinstance(stamp, bytes) else stamp
    return round(dt.datetime.fromisoformat(s).timestamp(), 3)


def parse_positions(path: Path) -> list[Half]:
    """Stream one positions file into halves (ordered by period)."""
    raw: dict[int, dict] = {}
    key = None
    rows: list = []

    def flush():
        if key is not None:
            period, team, person = key
            h = raw.setdefault(period, {"players": {}, "teams": {}, "ball": None, "t0": None})
            if team == "BALL":
                h["ball"] = rows
            else:
                h["players"][person] = rows
                h["teams"][person] = team

    with open(path, "rb") as fh:
        for line in fh:
            s = line.lstrip()
            if s.startswith(b"<Frame "):
                m = _FRAME.match(s)
                if m is None:
                    continue
                if key[1] == "BALL":
                    z = _Z.search(s)
                    st = _STATUS.search(s)
                    rows.append((int(m[1]), float(m[3]), float(m[4]), float(z[1]) if z else np.nan, st is not None and st[1] == b"1", m[2]))
                else:
                    rows.append((int(m[1]), float(m[3]), float(m[4])))
            elif s.startswith(b"<FrameSet"):
                flush()
                m = _FRAMESET.search(s)
                key = (_PERIOD.get(m[1], 0), m[2].decode(), m[3].decode())
                rows = []
    flush()

    halves = []
    for period in sorted(raw):
        h = raw[period]
        if not h["ball"]:
            continue
        ball_rows = h["ball"]
        n0 = min(r[0] for r in ball_rows)
        n = max(r[0] for r in ball_rows) - n0 + 1
        ball = np.full((n, 3), np.nan)
        live = np.zeros(n, dtype=bool)
        first = min(ball_rows, key=lambda r: r[0])
        for r in ball_rows:
            ball[r[0] - n0] = r[1:4]
            live[r[0] - n0] = r[4]
        players = {}
        for pid, prow in h["players"].items():
            xy = np.full((n, 2), np.nan)
            for r in prow:
                i = r[0] - n0
                if 0 <= i < n:
                    xy[i] = r[1:3]
            players[pid] = xy
        halves.append(Half(period, n0, _epoch(first[5]), ball, live, players, dict(h["teams"])))
    return halves


def load_match(path: Path, cache: Path) -> list[Half]:
    """parse_positions with an .npz cache (re-parsing a 370 MB file takes several seconds)."""
    if cache.exists():
        d = np.load(cache, allow_pickle=False)
        out = []
        for period in d["periods"].tolist():
            pre = f"h{period}"
            ids = d[f"{pre}_ids"].tolist()
            teams = d[f"{pre}_teams"].tolist()
            out.append(Half(period, int(d[f"{pre}_n0"]), float(d[f"{pre}_t0"]), d[f"{pre}_ball"], d[f"{pre}_live"],
                            {pid: d[f"{pre}_p_{i}"] for i, pid in enumerate(ids)}, dict(zip(ids, teams))))
        return out
    halves = parse_positions(path)
    cache.parent.mkdir(parents=True, exist_ok=True)
    arrays: dict[str, np.ndarray] = {"periods": np.array([h.period for h in halves])}
    for h in halves:
        pre = f"h{h.period}"
        ids = list(h.players)
        arrays.update({f"{pre}_n0": np.array(h.n0), f"{pre}_t0": np.array(h.t0), f"{pre}_ball": h.ball, f"{pre}_live": h.live,
                       f"{pre}_ids": np.array(ids), f"{pre}_teams": np.array([h.teams[i] for i in ids])})
        arrays.update({f"{pre}_p_{i}": h.players[pid] for i, pid in enumerate(ids)})
    tmp = cache.with_name(cache.stem + ".part.npz")
    np.savez_compressed(tmp, **arrays)
    tmp.replace(cache)
    return halves


_EVENT = re.compile(r'<Event [^>]*?EventTime="([^"]+)"[^>]*>(.*?)</Event>', re.S)
_KICK = re.compile(r'<(Play|ShotAtGoal) [^>]*?Player="([^"]+)"')


def kick_events(path: Path) -> list[KickEvent]:
    """Passes, crosses and set-piece deliveries (DFL `Play`) and shots (`ShotAtGoal`), in file order."""
    out = []
    for m in _EVENT.finditer(Path(path).read_text(encoding="utf-8")):
        k = _KICK.search(m[2])
        if k:
            out.append(KickEvent(_epoch(m[1]), "pass" if k[1] == "Play" else "shot", k[2]))
    return out


def smooth(xy: np.ndarray, fps: int = FPS) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    """Savitzky-Golay position, velocity and acceleration of an (n, k) series, per run of finite frames.

    Runs shorter than the window stay NaN, so gaps never bleed into derivatives.
    """
    pos = np.full_like(xy, np.nan, dtype=float)
    vel = np.full_like(pos, np.nan)
    acc = np.full_like(pos, np.nan)
    ok = np.isfinite(xy).all(axis=1)
    edges = np.flatnonzero(np.diff(np.concatenate([[0], ok.astype(int), [0]])))
    for a, b in zip(edges[::2], edges[1::2]):
        if b - a < WINDOW:
            continue
        seg = xy[a:b]
        pos[a:b] = savgol_filter(seg, WINDOW, ORDER, axis=0)
        vel[a:b] = savgol_filter(seg, WINDOW, ORDER, deriv=1, delta=1 / fps, axis=0)
        acc[a:b] = savgol_filter(seg, WINDOW, ORDER, deriv=2, delta=1 / fps, axis=0)
    return pos, vel, acc
```

Apply this change to `python/analytics/pyproject.toml` (from the repository root):

```bash
git apply <<'PATCH'
diff --git a/python/analytics/pyproject.toml b/python/analytics/pyproject.toml
index adf0b24..62057a5 100644
--- a/python/analytics/pyproject.toml
+++ b/python/analytics/pyproject.toml
@@ -3,7 +3,7 @@ name = "touchline-analytics"
 version = "0.1.0"
 description = "Offline analytics for Touchline: CDF validation, real-data calibration targets, realism report."
 requires-python = ">=3.11"
-dependencies = ["common-data-format-validator==0.1.1", "kloppy==3.19.0"]
+dependencies = ["common-data-format-validator==0.1.1", "kloppy==3.19.0", "numpy==2.3.4", "scipy==1.16.3"]
 
 [build-system]
 requires = ["hatchling"]
PATCH
```

- [ ] **Step 4: Lock the new dependencies**

The change above adds numpy and scipy to `pyproject.toml`.

Run: `uv lock --project python/analytics`
Expected: `Resolved 32 packages`, and `uv.lock` now lists numpy 2.3.4 and scipy 1.16.3

- [ ] **Step 5: Run the tests**

Run: `uv run --locked --project python/analytics pytest -q python/analytics/tests/test_physics_load.py`
Expected: `5 passed`

Run: `uv run --locked --project python/analytics pytest -q python/analytics/tests`
Expected: all pass (36 existing + 5 new)

- [ ] **Step 6: Commit**

```bash
git add python/analytics
git commit -m "feat(analytics): stream IDSSE positions and kick events for the physics fit (numpy, scipy), cached per match, Savitzky-Golay derivatives per run

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Reference ball model

The engine's ball physics, written once in Python as the reference that the fit integrates and the engine ports (Task 8): gravity and quadratic drag in the air; the Brody/Cross rigid-body bounce of a hollow ball (restitution e on the normal speed; friction mu either stops the contact point slipping during the impact or acts throughout), with a scalar spin carried through bounces; and on the ground rolling resistance c0 + c1 v plus drag, with a skid phase (friction mu_s) until a ball struck without spin rolls (Ruling 2). It also solves the launch speed of a ground pass for its arrival speed. Literature defaults: k 0.013, e 0.62, mu 0.6, mu_s 0.3, c0 0.5, c1 0.15.

**Files:**
- Create: `python/analytics/touchline_analytics/physics/ballmodel.py`
- Test: `python/analytics/tests/test_physics_ballmodel.py`

**Interfaces:**
- Produces: `BallPhysics(k, e, mu, mu_s, c0, c1, radius=0.11, rest_vz=0.4, gravity=9.81)` (frozen dataclass), `LITERATURE`, `SUBSTEP = 0.025`; `bounce(vt, vn, w, p) -> (vt, vz, w)`; `step(state7, h, p) -> state7` with state `(x, y, z, vx, vy, vz, w)`; `simulate(state7, duration, p, h=SUBSTEP) -> ndarray (n, 8)` rows `(t, x, y, z, vx, vy, vz, w)`; `roll_distance(v0, v_end, p)`; `ground_distance(v0, v_end, p)`; `ground_launch_speed(distance, arrive, p)`; `python -m touchline_analytics.physics.ballmodel` reads `[{state, duration, physics}]` JSON on stdin and prints trajectories (Task 8's parity test).

- [ ] **Step 1: Write the failing tests**

Create `python/analytics/tests/test_physics_ballmodel.py`:

```python
import json
import math
import subprocess
import sys

import numpy as np
import pytest

from touchline_analytics.physics.ballmodel import LITERATURE, BallPhysics, bounce, ground_distance, ground_launch_speed, roll_distance, simulate, step


def test_grip_bounce_leaves_rolling_at_three_fifths_of_the_speed():
    p = LITERATURE  # e 0.62, mu 0.6
    vt, vz, w = bounce(vt=8.0, vn=6.0, w=0.0, p=p)
    assert vz == pytest.approx(0.62 * 6.0)
    assert vt == pytest.approx(0.6 * 8.0)
    assert w == pytest.approx(vt / p.radius)  # rolling: no slip at the contact point


def test_slide_bounce_loses_friction_impulse_and_gains_topspin():
    p = BallPhysics(e=0.6, mu=0.25)
    vt, vz, w = bounce(vt=12.0, vn=4.0, w=0.0, p=p)  # 2.5*0.25*1.6*4 = 4 < 12: slides throughout
    assert vt == pytest.approx(12.0 - 0.25 * 1.6 * 4.0)
    assert w == pytest.approx(1.5 * 0.25 * 1.6 * 4.0 / p.radius)
    assert vz == pytest.approx(2.4)


def test_bounce_with_backspin_keeps_less_speed_than_without():
    p = LITERATURE
    plain, _, _ = bounce(vt=8.0, vn=6.0, w=0.0, p=p)
    back, _, _ = bounce(vt=8.0, vn=6.0, w=-20.0, p=p)
    assert back < plain


def test_slow_landing_stops_bouncing():
    _, vz, _ = bounce(vt=3.0, vn=0.5, w=0.0, p=LITERATURE)  # 0.62 * 0.5 = 0.31 < 0.4 m/s
    assert vz == 0.0


def test_dropped_ball_rebounds_to_e_squared_of_its_height():
    p = BallPhysics(k=0.0)
    traj = simulate((0.0, 0.0, 2.0, 0.0, 0.0, 0.0, 0.0), 2.0, p)
    after = traj[traj[:, 0] > 0.7]  # past the first landing (~0.64 s)
    assert after[:, 3].max() == pytest.approx(0.62**2 * 2.0, rel=0.03)


def test_lofted_pass_with_literature_physics_matches_the_report():
    # Report (our simulation): 18 m/s at 25 deg keeps ~7.4 m/s after its first bounce.
    th = math.radians(25)
    traj = simulate((0.0, 0.0, 0.0, 18 * math.cos(th), 0.0, 18 * math.sin(th), 0.0), 6.0, LITERATURE)
    landed = np.flatnonzero((traj[:-1, 6] < 0) & (traj[1:, 6] > 0))[0] + 1
    assert math.hypot(traj[landed, 4], traj[landed, 5]) == pytest.approx(7.4, abs=0.6)


def test_rolling_ball_on_the_ramp_test_stops_inside_the_fifa_band():
    p = LITERATURE
    traj = simulate((0.0, 0.0, 0.0, 3.2, 0.0, 0.0, 3.2 / p.radius), 10.0, p)  # leaves the ramp rolling
    assert 4.0 <= traj[-1, 1] <= 8.0
    assert traj[-1, 4] == 0.0 and (np.diff(traj[:, 1]) >= 0).all()


def test_roll_distance_matches_the_simulated_roll():
    p = LITERATURE
    traj = simulate((0.0, 0.0, 0.0, 15.0, 0.0, 0.0, 15.0 / p.radius), 20.0, p)
    assert roll_distance(15.0, 0.0, p) == pytest.approx(traj[-1, 1], rel=0.01)


def test_ground_pass_struck_without_spin_skids_then_rolls():
    p = LITERATURE
    traj = simulate((0.0, 0.0, 0.0, 12.0, 0.0, 0.0, 0.0), 20.0, p)
    first = (12.0 - traj[1, 4]) / 0.025
    assert first == pytest.approx(p.mu_s * p.gravity + p.c0 + p.c1 * 12.0 + p.k * 144.0, rel=0.01)
    rolling = np.flatnonzero(np.isclose(traj[:, 4], p.radius * traj[:, 7]) & (traj[:, 4] > 0))
    assert len(rolling) > 0
    v_r = traj[rolling[0], 4]
    t_r = traj[rolling[0], 0]
    assert v_r == pytest.approx(1.5 * p.mu_s * p.gravity * t_r, abs=0.15)  # spin caught up with speed (one substep)
    assert ground_distance(12.0, 0.0, p) == pytest.approx(traj[-1, 1], rel=0.02)  # the engine steps with explicit Euler


def test_sliding_bounce_leaves_the_ball_skidding():
    p = BallPhysics(e=0.6, mu=0.25)
    traj = simulate((0.0, 0.0, 0.3, 14.0, 0.0, -2.0, 0.0), 1.0, p)
    ground = traj[traj[:, 3] == 0]
    assert ground[0, 4] > p.radius * ground[0, 7]  # still slipping after the bounce


def test_ground_launch_speed_inverts_ground_distance():
    p = LITERATURE
    v0 = ground_launch_speed(25.0, 4.0, p)
    assert ground_distance(v0, 4.0, p) == pytest.approx(25.0, rel=1e-6)
    assert ground_launch_speed(0.0, 4.0, p) == pytest.approx(4.0)
    v_short = ground_launch_speed(3.0, 9.0, p)  # arrives while still skidding
    assert ground_distance(v_short, 9.0, p) == pytest.approx(3.0, rel=1e-6)


def test_step_is_plain_euler_in_the_air():
    p = BallPhysics(k=0.01)
    s = step((0.0, 0.0, 5.0, 10.0, 0.0, 0.0, 0.0), 0.025, p)
    k = 0.01 * 10.0 * 0.025
    assert s[3] == pytest.approx(10.0 - k * 10.0)
    assert s[5] == pytest.approx(-9.81 * 0.025)


def test_cli_prints_trajectories_for_the_parity_test():
    cases = [{"state": [0, 0, 0, 12, 3, 8, 0], "duration": 1.0, "physics": {"e": 0.7, "mu": 0.3}}]
    out = subprocess.run([sys.executable, "-m", "touchline_analytics.physics.ballmodel"], input=json.dumps(cases), capture_output=True, text=True, check=True)
    got = json.loads(out.stdout)
    assert len(got) == 1 and len(got[0]) == 41  # the start plus 40 substeps of 0.025 s
    assert got[0][0] == [0.0, 0.0, 0.0, 0.0, 12.0, 3.0, 8.0, 0.0]
```

- [ ] **Step 2: Run them to make sure they fail**

Run: `uv run --locked --project python/analytics pytest -q python/analytics/tests/test_physics_ballmodel.py`
Expected: collection error, `No module named 'touchline_analytics.physics.ballmodel'`

- [ ] **Step 3: Write the implementation**

Create `python/analytics/touchline_analytics/physics/ballmodel.py`:

```python
"""The engine's ball physics, as the reference the fit and the free-ball replay integrate.

packages/sim-core/src/ball.ts is a line-for-line port; a parity test runs both on the same launches.
State is (x, y, z, vx, vy, vz, w): position and velocity in metres and m/s, and a scalar spin w (rad/s,
topspin positive) that matters at a bounce and on the ground. z is the height of the ball's bottom.

- In the air: gravity and quadratic drag (a = -k |v| v), explicit Euler per substep.
- Bounce (Brody / Cross rigid-body model for a hollow ball, I = 2/3 m R^2): the normal speed becomes
  e * vn (and 0 below `rest_vz`). The contact point slips at vt - R w; friction mu either stops the slip
  during the impact (the ball leaves rolling at 0.6 vt + 0.4 R w) or acts throughout (the ball loses
  mu (1 + e) vn of horizontal speed and gains 1.5 mu (1 + e) vn / R of spin).
- On the ground: rolling resistance c0 + c1 v plus air drag k v^2. While the ball skids (its contact point
  slips, v != R w, as after a kick or a sliding bounce) friction adds mu_s g of deceleration and spins the
  ball up at 1.5 mu_s g / R until it rolls. A ground pass leaves the foot without spin, so it skids first.

Only multiply, add, divide and square roots: the engine must replay bit-identically in every JavaScript
engine, and Math.exp / Math.pow are not required to be.
"""

from __future__ import annotations

import json
import math
import sys
from dataclasses import dataclass, replace

import numpy as np

SUBSTEP = 0.025  # the engine's 0.1 s tick in 4 substeps
SIMPSON_N = 16  # intervals for the rolling-distance integral
SKID_N = 64  # speed steps for the skid phase of a ground pass
SLIP_EPS = 1e-9


@dataclass(frozen=True)
class BallPhysics:
    k: float = 0.013  # quadratic drag per metre (C_D ~ 0.24)
    e: float = 0.62  # normal restitution
    mu: float = 0.6  # effective ball-grass friction at a bounce
    mu_s: float = 0.3  # ball-grass friction while a ball skids on the ground
    c0: float = 0.5  # rolling deceleration, m/s^2
    c1: float = 0.15  # rolling deceleration per m/s, 1/s
    radius: float = 0.11
    rest_vz: float = 0.4  # bounces slower than this stop
    gravity: float = 9.81


LITERATURE = BallPhysics()


def bounce(vt: float, vn: float, w: float, p: BallPhysics) -> tuple[float, float, float]:
    """Horizontal speed, vertical speed and spin after landing with horizontal speed vt and downward speed vn."""
    vz = p.e * vn
    if vz < p.rest_vz:
        vz = 0.0
    slip = vt - p.radius * w
    impulse = p.mu * (1 + p.e) * vn
    if 2.5 * impulse >= abs(slip):
        vt2 = 0.6 * vt + 0.4 * p.radius * w
        return vt2, vz, vt2 / p.radius
    sign = 1.0 if slip > 0 else -1.0
    return vt - sign * impulse, vz, w + sign * 1.5 * impulse / p.radius


def step(s: tuple, h: float, p: BallPhysics) -> tuple:
    """One substep of length h."""
    x, y, z, vx, vy, vz, w = s
    if z > 1e-6 or vz > 1e-6:
        speed = math.sqrt(vx * vx + vy * vy + vz * vz)
        kk = p.k * speed * h
        vx -= kk * vx
        vy -= kk * vy
        vz -= kk * vz + p.gravity * h
        x += vx * h
        y += vy * h
        z += vz * h
        if z <= 0:
            z = 0.0
            vt = math.sqrt(vx * vx + vy * vy)
            vt2, vz, w = bounce(vt, -vz, w, p)
            if vt > 0:
                f = vt2 / vt
                vx *= f
                vy *= f
        return (x, y, z, vx, vy, vz, w)
    speed = math.sqrt(vx * vx + vy * vy)
    if speed > 0:
        dec = p.c0 + p.c1 * speed + p.k * speed * speed
        slip = speed - p.radius * w
        spin = 1.5 * p.mu_s * p.gravity / p.radius * h
        if slip > SLIP_EPS:
            dec += p.mu_s * p.gravity
            w += spin
        elif slip < -SLIP_EPS:
            dec -= p.mu_s * p.gravity
            w -= spin
        nxt = max(0.0, speed - dec * h)
        if abs(slip) <= SLIP_EPS or (slip > 0) != (nxt - p.radius * w > 0):
            w = nxt / p.radius  # the slip ran out within the substep: the ball rolls on
        f = nxt / speed
        vx *= f
        vy *= f
        x += vx * h
        y += vy * h
    return (x, y, 0.0, vx, vy, 0.0, w)


def simulate(s: tuple, duration: float, p: BallPhysics, h: float = SUBSTEP) -> np.ndarray:
    """Rows (t, x, y, z, vx, vy, vz, w) from the start state, every substep, for `duration` seconds."""
    n = int(round(duration / h))
    out = np.empty((n + 1, 8))
    s = tuple(float(v) for v in s)
    out[0] = (0.0, *s)
    for i in range(1, n + 1):
        s = step(s, h, p)
        out[i] = (i * h, *s)
    return out


def _roll_decel(v: float, p: BallPhysics) -> float:
    return p.c0 + p.c1 * v + p.k * v * v


def roll_distance(v0: float, v_end: float, p: BallPhysics) -> float:
    """Distance a rolling (not skidding) ball covers while slowing from v0 to v_end: the integral of v / dec(v) (Simpson)."""
    if v0 <= v_end:
        return 0.0
    hh = (v0 - v_end) / SIMPSON_N
    total = 0.0
    for i in range(SIMPSON_N + 1):
        v = v_end + i * hh
        wgt = 1 if i in (0, SIMPSON_N) else (4 if i % 2 else 2)
        total += wgt * v / _roll_decel(v, p)
    return total * hh / 3


def ground_distance(v0: float, v_end: float, p: BallPhysics) -> float:
    """Distance a ground pass struck at v0 without spin covers before slowing to v_end: skid, then roll.

    The skid is marched in SKID_N equal speed steps: time t(v) accumulates dv / (mu_s g + dec(v)), and the
    skid ends where the spin has caught up, v = 1.5 mu_s g t.
    """
    if v0 <= v_end:
        return 0.0
    fric = p.mu_s * p.gravity
    dv = v0 / SKID_N
    t = 0.0
    d = 0.0
    v = v0
    a = fric + _roll_decel(v, p)
    for _ in range(SKID_N):
        v2 = v - dv
        a2 = fric + _roll_decel(v2, p)
        dt = 0.5 * dv * (1 / a + 1 / a2)
        g1 = v - 1.5 * fric * t  # slip before and after the step
        g2 = v2 - 1.5 * fric * (t + dt)
        stop = v_end if v_end > v2 else v2
        if g2 <= 0 or stop > v2:
            # The skid ends (slip reaches 0) or the target speed comes within this step: take the earlier.
            f_slip = g1 / (g1 - g2) if g2 <= 0 else 1.0
            f_stop = (v - stop) / dv
            f = min(f_slip, f_stop)
            vf = v - f * dv
            d += 0.5 * f * dv * (v / a + vf / (fric + _roll_decel(vf, p)))
            return d if f_stop <= f_slip else d + roll_distance(vf, v_end, p)
        d += 0.5 * dv * (v / a + v2 / a2)
        t += dt
        v, a = v2, a2
    return d


def ground_launch_speed(distance: float, arrive: float, p: BallPhysics) -> float:
    """Launch speed of a ground pass (struck without spin) that arrives at `arrive` m/s after `distance` metres (fixed secant steps)."""
    if distance <= 0:
        return arrive
    lo = math.sqrt(arrive * arrive + 2 * _roll_decel(arrive, p) * distance)
    hi = math.sqrt(arrive * arrive + 2 * (p.mu_s * p.gravity + _roll_decel(arrive, p)) * distance) + 0.5
    f_lo = ground_distance(lo, arrive, p) - distance
    f_hi = ground_distance(hi, arrive, p) - distance
    for _ in range(8):
        if f_hi == f_lo:
            break
        mid = hi - f_hi * (hi - lo) / (f_hi - f_lo)
        lo, f_lo = hi, f_hi
        hi, f_hi = mid, ground_distance(mid, arrive, p) - distance
    return hi


def _main() -> None:
    """Read [{state, duration, physics}] as JSON on stdin; print each trajectory's rows (parity test)."""
    cases = json.load(sys.stdin)
    out = []
    for c in cases:
        p = replace(LITERATURE, **c.get("physics", {}))
        out.append(simulate(tuple(c["state"]), c["duration"], p).tolist())
    json.dump(out, sys.stdout)


__all__ = ["BallPhysics", "LITERATURE", "SUBSTEP", "bounce", "ground_distance", "ground_launch_speed", "roll_distance", "simulate", "step"]

if __name__ == "__main__":
    _main()
```

- [ ] **Step 4: Run the tests**

Run: `uv run --locked --project python/analytics pytest -q python/analytics/tests/test_physics_ballmodel.py`
Expected: `13 passed`

- [ ] **Step 5: Commit**

```bash
git add python/analytics
git commit -m "feat(analytics): reference ball physics for the fit — Brody/Cross bounce with spin, rolling c0 + c1 v + k v², closed-form roll distance and ground launch speed

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Segment real ball tracking

Cut each half into kicks, free-ball spans, flight and rolling pieces, and bounces (Ruling 1: kicks come from the tracked speed jump with a player at the ball; events only label them). A span ends when a player is within 1.2 m (after 0.3 s), the ball speeds up again or turns more than 20 degrees within 0.2 s, goes dead, or its tracking drops out; spans faster than 40 m/s are rejected and counted. A bounce keeps the flight before it and the piece after it, for the fit to measure the speeds either side with the fitted drag.

**Files:**
- Create: `python/analytics/touchline_analytics/physics/segment.py`
- Create: `python/analytics/tests/physics_fixtures.py` (synthetic 25 Hz halves from the reference model)
- Test: `python/analytics/tests/test_physics_segment.py`

**Interfaces:**
- Consumes: `Half`, `KickEvent`, `smooth`, `FPS` (Task 1); `simulate`, `BallPhysics` (Task 2, in the fixtures).
- Produces: `RADIUS = 0.11`; `Kick(frame, speed, angle_deg, kind)`, `Span(start, end)`, `Piece(kind, start, t, pos)` (heights of the ball's bottom), `Bounce(frame, h_before, h_after, before: Piece, after: Piece)`, `Segments(kicks, spans, flights, rolls, bounces, rejects)`; `segment_half(half, events=()) -> Segments`; `_apex(t, z)` (also used by Task 6); `LINE_FRAMES = 8`.

- [ ] **Step 1: Write the failing tests**

Create `python/analytics/tests/physics_fixtures.py`:

```python
"""Synthetic 25 Hz halves built from the reference ball model, for the segmentation and fit tests."""

from __future__ import annotations

import math

import numpy as np

from touchline_analytics.physics.ballmodel import BallPhysics, simulate
from touchline_analytics.physics.load import FPS, Half
from touchline_analytics.physics.segment import RADIUS


def flight(speed: float, deg: float, seconds: float, p: BallPhysics, heading_deg: float = 0.0, start=(0.0, 0.0)) -> np.ndarray:
    """(n, 3) ball positions at 25 Hz for a kick from `start` (simulated at 0.005 s, sampled every 8th substep)."""
    th, hd = math.radians(deg), math.radians(heading_deg)
    v = speed * math.cos(th)
    s0 = (start[0], start[1], 0.0, v * math.cos(hd), v * math.sin(hd), speed * math.sin(th), 0.0)
    traj = simulate(s0, seconds, p, h=0.005)
    pos = traj[::8, 1:4].copy()
    pos[:, 2] += RADIUS  # the model's z is the bottom of the ball; tracking reports its centre
    return pos


def half(ball: np.ndarray, players: dict[str, np.ndarray] | None = None, live: np.ndarray | None = None) -> Half:
    n = len(ball)
    players = players or {"far": np.tile([[40.0, 30.0]], (n, 1))}
    return Half(1, 10000, 1665831689.0, ball, np.ones(n, bool) if live is None else live, players, {k: "T" for k in players})


def kick_then(path: np.ndarray, rest_s: float = 1.0, kicker=(0.0, 0.0)) -> tuple[np.ndarray, dict[str, np.ndarray]]:
    """A ball resting at the kicker for `rest_s`, then `path`; the kicker stays where he kicked it."""
    rest = np.tile([[kicker[0], kicker[1], 0.11]], (int(rest_s * FPS), 1))
    ball = np.vstack([rest, path])
    n = len(ball)
    players = {"kicker": np.tile([[kicker[0] - 0.5, kicker[1]]], (n, 1)), "far": np.tile([[40.0, 30.0]], (n, 1))}
    return ball, players
```

Create `python/analytics/tests/test_physics_segment.py`:

```python
import numpy as np
import pytest
from physics_fixtures import flight, half, kick_then

from touchline_analytics.physics.ballmodel import BallPhysics
from touchline_analytics.physics.load import FPS, KickEvent
from touchline_analytics.physics.segment import segment_half

P = BallPhysics(k=0.0, e=0.65, mu=0.25)


def test_lofted_kick_gives_one_span_two_flights_a_bounce_and_a_roll():
    ball, players = kick_then(flight(16.0, 30.0, 5.0, P))
    seg = segment_half(half(ball, players))
    assert len(seg.kicks) == 1
    k = seg.kicks[0]
    assert abs(k.frame - FPS) <= 4 and k.speed == pytest.approx(16.0, rel=0.05)
    assert len(seg.flights) >= 2 and len(seg.rolls) >= 1
    b = seg.bounces[0]
    assert np.sqrt(b.h_after / b.h_before) == pytest.approx(0.65, abs=0.03)  # no drag here, so apexes give e
    assert b.before.kind == "flight" and b.after.kind == "flight"
    assert b.before.start < b.frame <= b.after.start


def test_span_ends_when_a_player_reaches_the_ball():
    path = flight(12.0, 0.0, 4.0, P)  # a ground pass along x
    ball, players = kick_then(path)
    n = len(ball)
    catcher = np.tile([[60.0, 0.0]], (n, 1))
    reach = FPS + 2 * FPS  # two seconds after the kick
    catcher[reach:] = ball[reach:, :2] + [0.5, 0.0]
    players["catcher"] = catcher
    seg = segment_half(half(ball, players))
    assert len(seg.spans) == 1
    assert seg.spans[0].end == pytest.approx(reach, abs=1)


def test_span_ends_at_a_sharp_turn():
    a = flight(12.0, 0.0, 1.5, P)
    b = flight(10.0, 0.0, 2.0, P, heading_deg=90.0, start=tuple(a[-1, :2]))
    ball, players = kick_then(np.vstack([a, b]))
    seg = segment_half(half(ball, players))
    assert seg.spans[0].end <= FPS + len(a) + 1


def test_dead_ball_and_missing_frames_end_a_span():
    ball, players = kick_then(flight(12.0, 0.0, 4.0, P))
    live = np.ones(len(ball), bool)
    live[FPS + 40:] = False
    seg = segment_half(half(ball, players, live))
    assert seg.spans[0].end <= FPS + 40
    ball2 = ball.copy()
    ball2[FPS + 30] = np.nan
    seg2 = segment_half(half(ball2, players))
    assert seg2.spans[0].end <= FPS + 30


def test_pieces_shorter_than_half_a_second_are_dropped():
    ball, players = kick_then(flight(8.0, 12.0, 3.0, P))  # a short chip: under 0.5 s above 0.3 m
    seg = segment_half(half(ball, players))
    assert all(len(f.pos) >= FPS / 2 for f in seg.flights + seg.rolls)


def test_impossible_ball_speed_rejects_the_span():
    ball, players = kick_then(flight(45.0, 5.0, 2.0, P))
    seg = segment_half(half(ball, players))
    assert seg.spans == [] and seg.rejects["ball_speed"] == 1


def test_kicks_take_the_type_of_the_nearest_event_within_a_second_and_a_half():
    ball, players = kick_then(flight(16.0, 30.0, 3.0, P))
    h = half(ball, players)
    shot = KickEvent(h.t0 + 1.0 + 1.2, "shot", "kicker")
    seg = segment_half(h, [shot])
    assert seg.kicks[0].kind == "shot"
    late = KickEvent(h.t0 + 1.0 + 2.0, "shot", "kicker")
    assert segment_half(h, [late]).kicks[0].kind is None


def test_a_still_ball_gives_no_kick():
    seg = segment_half(half(np.tile([[1.0, 2.0, 0.11]], (200, 1))))
    assert seg.kicks == [] and seg.spans == []
```

- [ ] **Step 2: Run them to make sure they fail**

Run: `uv run --locked --project python/analytics pytest -q python/analytics/tests/test_physics_segment.py`
Expected: collection error, `No module named 'touchline_analytics.physics.segment'`

- [ ] **Step 3: Write the implementation**

Create `python/analytics/touchline_analytics/physics/segment.py`:

```python
"""Cut real ball tracking into free-ball spans and the pieces the physics fit uses.

- A **kick** is a jump of at least 3 m/s in the ball's horizontal speed over 0.2 s with a player within
  1.5 m of the ball. DFL's own event times are too loose to place a kick (only ~17 % of passes and shots
  fall within 0.2 s of the tracked speed jump), so events only label kicks: the nearest pass or shot
  within 1.5 s.
- A **free-ball span** runs from a kick until a player is within 1.2 m of the ball (after 0.3 s, so the
  kicker does not end it), the ball speeds up again, turns more than 20 degrees within 0.2 s, goes dead,
  or its tracking drops out. Spans with a ball faster than 40 m/s are rejected.
- Within a span, **flight** pieces are runs with the ball's bottom more than 0.3 m above ground, and
  **rolling** pieces the runs below; pieces shorter than 0.5 s are not fitted (a bounce may still join
  pieces of 6 frames or more, since a low bounce spends little time above 0.3 m).
- A **bounce** joins a flight to the next piece (flight or roll) and keeps both pieces; the fit measures
  the speeds either side of it with the fitted drag. Its apex heights (parabolas fitted to each flight)
  are kept for a quick look only.

Heights here are of the ball's bottom (tracked centre minus the 0.11 m radius), as in the engine.
"""

from __future__ import annotations

import math
from dataclasses import dataclass, field

import numpy as np

from .load import FPS, Half, KickEvent, smooth

RADIUS = 0.11
JUMP_MS = 3.0
JUMP_FRAMES = 5
KICK_PLAYER_M = 1.5
TOUCH_M = 1.2
GRACE_S = 0.3
SPEEDUP_MS = 2.0
TURN_DEG = 20.0
TURN_MIN_MS = 2.0
AIR_M = 0.3
MIN_PIECE_FRAMES = int(round(0.5 * FPS))
MAX_BALL_MS = 40.0
MAX_SPAN_S = 10.0
LABEL_S = 1.5
BOUNCE_GAP_FRAMES = 8
BOUNCE_PIECE_FRAMES = 6  # a bounce may join pieces shorter than MIN_PIECE_FRAMES
LINE_FRAMES = 8


@dataclass
class Kick:
    frame: int  # first frame of the span (the ball has left the foot)
    speed: float  # release speed, m/s
    angle_deg: float  # launch angle above the ground
    kind: str | None  # "pass", "shot" or None when no event is near


@dataclass
class Span:
    start: int
    end: int  # exclusive


@dataclass
class Piece:
    kind: str  # "flight" or "roll"
    start: int
    t: np.ndarray  # seconds from the piece's first frame
    pos: np.ndarray  # (n, 3) raw positions, z of the ball's bottom


@dataclass
class Bounce:
    frame: int
    h_before: float  # apex of the flight before, ball's bottom (m)
    h_after: float  # apex of the flight after (NaN when the ball rolled on)
    before: Piece  # the flight that landed
    after: Piece  # the flight or roll that followed


@dataclass
class Segments:
    kicks: list[Kick] = field(default_factory=list)
    spans: list[Span] = field(default_factory=list)
    flights: list[Piece] = field(default_factory=list)
    rolls: list[Piece] = field(default_factory=list)
    bounces: list[Bounce] = field(default_factory=list)
    rejects: dict[str, int] = field(default_factory=lambda: {"ball_speed": 0})


def _nearest_player(h: Half) -> np.ndarray:
    n = len(h.ball)
    best = np.full(n, np.inf)
    for xy in h.players.values():
        d = np.hypot(xy[:, 0] - h.ball[:, 0], xy[:, 1] - h.ball[:, 1])
        best = np.fmin(best, np.where(np.isfinite(d), d, np.inf))
    return best


def _runs(mask: np.ndarray) -> list[tuple[int, int]]:
    edges = np.flatnonzero(np.diff(np.concatenate([[0], mask.astype(int), [0]])))
    return list(zip(edges[::2].tolist(), edges[1::2].tolist()))


def _apex(t: np.ndarray, z: np.ndarray) -> float:
    """Apex of a parabola fitted to z(t); NaN unless the vertex lies inside the piece."""
    a, b, c = np.polyfit(t, z, 2)
    if a >= 0:
        return float("nan")
    tv = -b / (2 * a)
    if not (t[0] < tv < t[-1]):
        return float("nan")
    return float(c - b * b / (4 * a))


def _span_end(start: int, live: np.ndarray, speed: np.ndarray, vel: np.ndarray, near: np.ndarray) -> int:
    n = len(live)
    last = min(n, start + int(MAX_SPAN_S * FPS))
    for j in range(start + 1, last):
        if not live[j]:
            return j
        if near[j] <= TOUCH_M and (j - start) / FPS > GRACE_S:
            return j
        if j - JUMP_FRAMES >= start:
            if speed[j] - speed[j - JUMP_FRAMES] >= SPEEDUP_MS:
                return j - JUMP_FRAMES
            a, b = vel[j, :2], vel[j - JUMP_FRAMES, :2]
            sa, sb = math.hypot(*a), math.hypot(*b)
            if sa > TURN_MIN_MS and sb > TURN_MIN_MS:
                cos = max(-1.0, min(1.0, float(a @ b) / (sa * sb)))
                if math.degrees(math.acos(cos)) > TURN_DEG:
                    return j - JUMP_FRAMES
    return last


def _pieces(h: Half, span: Span, seg: Segments) -> None:
    pos = h.ball[span.start:span.end].copy()
    pos[:, 2] = pos[:, 2] - RADIUS
    air = pos[:, 2] > AIR_M
    runs = [(a, b, bool(air[a])) for a, b in _runs(air)] + [(a, b, False) for a, b in _runs(~air)]
    runs.sort()
    kept: list[tuple[Piece, int, int]] = []
    for a, b, is_air in runs:
        if b - a < BOUNCE_PIECE_FRAMES:
            continue
        piece = Piece("flight" if is_air else "roll", span.start + a, np.arange(b - a) / FPS, pos[a:b])
        if b - a >= MIN_PIECE_FRAMES:
            (seg.flights if is_air else seg.rolls).append(piece)
        kept.append((piece, a, b))
    for (p1, a1, b1), (p2, a2, b2) in zip(kept, kept[1:]):
        if p1.kind != "flight" or a2 - b1 > BOUNCE_GAP_FRAMES:
            continue
        h_before = _apex(p1.t, p1.pos[:, 2])
        if not math.isfinite(h_before):
            continue
        h_after = _apex(p2.t, p2.pos[:, 2]) if p2.kind == "flight" else float("nan")
        low = b1 + int(np.argmin(pos[b1:a2 + 1, 2])) if a2 > b1 else b1
        seg.bounces.append(Bounce(span.start + low, h_before, h_after, p1, p2))


def segment_half(h: Half, events: list[KickEvent] | tuple = ()) -> Segments:
    seg = Segments()
    _, vel, _ = smooth(h.ball)
    speed = np.hypot(vel[:, 0], vel[:, 1])
    near = _nearest_player(h)
    live = h.live & np.isfinite(h.ball).all(axis=1) & np.isfinite(speed)
    n = len(h.ball)
    times = np.array([e.time for e in events]) if len(events) else np.array([])
    i = JUMP_FRAMES
    while i < n - 2 * JUMP_FRAMES:
        lo, hi = i - 2, i + 3
        if live[lo:hi + 1].all() and speed[hi] - speed[lo] >= JUMP_MS and near[i] <= KICK_PLAYER_M:
            c = lo + int(np.argmax(np.diff(speed[lo:hi + 4])))
            start = min(n - 1, c + 4)
            end = _span_end(start, live, speed, vel, near)
            if np.nanmax(np.linalg.norm(vel[start:end], axis=1), initial=0.0) > MAX_BALL_MS:
                seg.rejects["ball_speed"] += 1
            elif end - start >= MIN_PIECE_FRAMES:
                # Release velocity at the span's first frame: straight lines in x and y and a parabola in z
                # over its first frames (the contact frame itself is blurred by the smoothing window).
                first = h.ball[start:start + LINE_FRAMES]
                tt = np.arange(len(first)) / FPS
                v = [np.polyfit(tt, first[:, k], 1)[0] for k in range(2)] + [np.polyfit(tt, first[:, 2], 2)[1]]
                kind = None
                if len(times):
                    t_kick = h.t0 + start / FPS
                    j = int(np.argmin(np.abs(times - t_kick)))
                    if abs(times[j] - t_kick) <= LABEL_S:
                        kind = events[j].kind
                vh = math.hypot(v[0], v[1])
                seg.kicks.append(Kick(start, float(math.sqrt(vh * vh + v[2] * v[2])), math.degrees(math.atan2(v[2], vh)), kind))
                span = Span(start, end)
                seg.spans.append(span)
                _pieces(h, span, seg)
            i = max(end, i + 1)
            continue
        i += 1
    return seg
```

- [ ] **Step 4: Run the tests**

Run: `uv run --locked --project python/analytics pytest -q python/analytics/tests/test_physics_segment.py`
Expected: `8 passed`

- [ ] **Step 5: Commit**

```bash
git add python/analytics
git commit -m "feat(analytics): segment real ball tracking into kicks, free-ball spans, flight and rolling pieces, and bounces (kicks from the tracked speed jump with a player at the ball; events only label them)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Fit the ball constants

Drag per flight (initial state and k fitted together by integrating the engine's equations at its 0.025 s substep, Huber loss; flights it cannot follow, RMSE over 0.3 m, are rejected), also binned by release speed. Bounces: both flights fitted with that k and integrated to the ground give landing and take-off speeds (apex heights alone are biased by drag), hence restitution e (median) and bounce friction mu (grid search: the grip and slide branches give competing minima). Ground passes: skid friction mu_s and rolling resistance c0, c1 fitted together by integrating the ground model for every ground pass at once, each pass free to shift and adjust its start speed. Every constant gets a seeded bootstrap interval.

**Files:**
- Create: `python/analytics/touchline_analytics/physics/stats.py`
- Create: `python/analytics/touchline_analytics/physics/fit_ball.py`
- Test: `python/analytics/tests/test_physics_fit_ball.py`

**Interfaces:**
- Consumes: `Piece`, `Segments`, `LINE_FRAMES` (Task 3); `SUBSTEP`, `BallPhysics`, `roll_distance` (Task 2).
- Produces: `Constant(value, lo, hi, n, source)` with `.to_json(unit, digits)`, `NAN`, `bootstrap_ci(values, stat=median)`, `bootstrap_fit(items, fit, n_boot=200)`; `DragFit(k, by_speed, rejected, segments)`, `fit_drag(flights)`; `BounceKin(vt_in, vn_in, vt_out, vz_out, first)`, `bounce_kinematics(segs, k)`, `fit_restitution(kins)`, `fit_friction(kins, e)`; `RollFit(c0, c1, mu_s, ramp_m)`, `fit_rolling(segs, k, n_boot=50)`.

- [ ] **Step 1: Write the failing tests**

Create `python/analytics/tests/test_physics_fit_ball.py`:

```python
import math

import numpy as np
import pytest
from physics_fixtures import flight, half, kick_then

from touchline_analytics.physics.ballmodel import BallPhysics
from touchline_analytics.physics.fit_ball import bounce_kinematics, fit_drag, fit_friction, fit_restitution, fit_rolling
from touchline_analytics.physics.load import FPS
from touchline_analytics.physics.segment import RADIUS, Piece, segment_half
from touchline_analytics.physics.stats import bootstrap_ci

NOISE_M = 0.1  # TRACAB-level position noise


def _noisy(pos: np.ndarray, rng: np.random.Generator, sd: float = NOISE_M) -> np.ndarray:
    return pos + rng.normal(0.0, sd, pos.shape)


def _flights(p: BallPhysics, rng: np.random.Generator, n: int = 40) -> list[Piece]:
    out = []
    for _ in range(n):
        path = flight(rng.uniform(14, 28), rng.uniform(20, 40), 4.0, p)
        path[:, 2] -= RADIUS
        air = path[:, 2] > 0.3
        a = int(np.argmax(air))
        b = a + int(np.argmin(air[a:])) if not air[a:].all() else len(air)  # the first run above 0.3 m
        out.append(Piece("flight", 0, np.arange(b - a) / FPS, _noisy(path[a:b], rng)))
    return out


def test_drag_is_recovered_from_noisy_flights():
    rng = np.random.default_rng(1)
    fit = fit_drag(_flights(BallPhysics(k=0.02), rng))
    assert fit.k.value == pytest.approx(0.02, rel=0.25)
    assert fit.k.lo < 0.02 < fit.k.hi
    assert fit.k.n >= 35 and fit.rejected == 0


def test_drag_fit_rejects_flights_it_cannot_follow():
    rng = np.random.default_rng(2)
    pieces = _flights(BallPhysics(k=0.013), rng, n=10)
    pieces[0].pos[len(pieces[0].pos) // 2:, 1] += 2.0  # a 2 m jump in the middle: a touch the segmentation missed
    fit = fit_drag(pieces)
    assert fit.rejected == 1 and fit.k.n == 9


def test_drag_is_binned_by_release_speed():
    rng = np.random.default_rng(3)
    fit = fit_drag(_flights(BallPhysics(k=0.015), rng, n=60))
    assert set(fit.by_speed) <= {"0-12", "12-18", "18-24", "24-40"}
    assert all(b.value == pytest.approx(0.015, rel=0.5) for b in fit.by_speed.values() if b.n >= 10)


def _lofted_halves(p: BallPhysics, rng: np.random.Generator, n: int = 30):
    out = []
    for _ in range(n):
        ball, players = kick_then(flight(rng.uniform(13, 22), rng.uniform(25, 40), 6.0, p))
        ball = ball + rng.normal(0.0, 0.03, ball.shape)
        out.append(segment_half(half(ball, players)))
    return out


def test_restitution_and_friction_are_recovered_through_the_segmentation():
    p = BallPhysics(k=0.013, e=0.7, mu=0.25)
    segs = _lofted_halves(p, np.random.default_rng(4))
    kins = bounce_kinematics(segs, k=0.013)
    assert sum(b.first for b in kins) == 30
    e = fit_restitution(kins)
    assert e.value == pytest.approx(0.7, abs=0.03)
    mu = fit_friction(kins, e.value)
    assert mu.value == pytest.approx(0.25, abs=0.06)


def _ground_passes(p: BallPhysics, rng: np.random.Generator, n: int = 60):
    out = []
    for _ in range(n):
        ball, players = kick_then(flight(rng.uniform(4, 18), 0.0, 4.0, p))  # struck along the ground, no spin
        ball = ball + rng.normal(0.0, 0.05, ball.shape)
        out.append(segment_half(half(ball, players)))
    return out


def test_skid_friction_and_rolling_resistance_are_recovered_from_ground_passes():
    p = BallPhysics(k=0.013, c0=0.6, c1=0.2, mu_s=0.35)
    fit = fit_rolling(_ground_passes(p, np.random.default_rng(5)), k=0.013, n_boot=10)
    assert fit.mu_s.value == pytest.approx(0.35, abs=0.05)
    assert fit.c0.value == pytest.approx(0.6, abs=0.2)
    assert fit.c1.value == pytest.approx(0.2, abs=0.06)
    assert 3.0 <= fit.ramp_m <= 8.0


def test_bootstrap_interval_is_deterministic_and_brackets_the_median():
    x = np.random.default_rng(6).normal(1.0, 0.2, 200)
    a = bootstrap_ci(x)
    b = bootstrap_ci(x)
    assert (a.value, a.lo, a.hi, a.n) == (b.value, b.lo, b.hi, b.n)
    assert a.lo < np.median(x) < a.hi and a.value == pytest.approx(float(np.median(x)))


def test_fits_without_data_return_nan_not_errors():
    assert math.isnan(fit_restitution([]).value)
    assert fit_drag([]).k.n == 0
    assert math.isnan(fit_rolling([], k=0.013).c0.value)
    assert math.isnan(fit_friction([], 0.7).value)
```

- [ ] **Step 2: Run them to make sure they fail**

Run: `uv run --locked --project python/analytics pytest -q python/analytics/tests/test_physics_fit_ball.py`
Expected: collection error, `No module named 'touchline_analytics.physics.fit_ball'`

- [ ] **Step 3: Write the implementation**

Create `python/analytics/touchline_analytics/physics/fit_ball.py`:

```python
"""Fit the ball constants on segmented real tracking.

- Drag k: each flight piece is fitted on its own (initial position and velocity, and k) by integrating the
  engine's equations at the engine's 0.025 s substep, with a Huber loss. Flights the model cannot follow
  (RMSE over 0.3 m) are rejected. k is the median over flights, also per release-speed bin, which is
  where a drag crisis would show.
- Bounces: the flights either side are fitted with that k and integrated to the ground, giving the
  speeds at landing and take-off (apex heights alone are biased by drag: ~8 % low for e on high balls).
- Restitution e: take-off over landing vertical speed; the median.
- Friction mu: the first bounce of each span (no spin from an earlier bounce; any spin from the kick is
  not observed) gives the horizontal speed kept; mu is the value whose Brody/Cross bounce reproduces it
  best, by grid search, since the grip and slide branches give two competing minima.
- Ground: a ground pass skids before it rolls (it leaves the foot without spin). Skid friction mu_s and
  rolling resistance c0 + c1 v are fitted together on rolling pieces that start at a kick, by integrating
  the ground model, with k held at the drag value (see fit_rolling).
"""

from __future__ import annotations

import math
from dataclasses import dataclass, field

import numpy as np
from scipy.optimize import least_squares, minimize, minimize_scalar

from .ballmodel import SUBSTEP, BallPhysics, roll_distance
from .segment import LINE_FRAMES, Piece, Segments
from .stats import NAN, Constant, bootstrap_ci, bootstrap_fit

GRAVITY = 9.81
MAX_RMSE_M = 0.3
SPEED_BINS = [(0.0, 12.0), (12.0, 18.0), (18.0, 24.0), (24.0, 40.0)]
MIN_VN = 3.0  # landings slower than this (a drop under ~0.5 m) say little about restitution
MIN_ROLL_FRAMES = 12
RAMP_SPEED = 3.2  # FIFA ramp test exit speed
DV0 = 0.1  # m/s, for each pass's sensitivity to its starting speed
GROUND_H = 0.01  # integration step for the ground fit (4 per 25 Hz frame)
KICK_LEAD_S = 3 / 25  # a span (and a ground pass's rolling piece) starts 3 frames after the contact (segment.py: c + 4, with c the frame before it)


@dataclass
class DragFit:
    k: Constant
    by_speed: dict[str, Constant]
    rejected: int
    segments: list[tuple[float, float, float]] = field(default_factory=list)  # (release speed, k, rmse) per kept flight


@dataclass
class RollFit:
    c0: Constant
    c1: Constant
    mu_s: Constant
    ramp_m: float  # how far the fitted law rolls a ball leaving the FIFA ramp at 3.2 m/s (already rolling)


def _fly(theta: np.ndarray, k: float, t: np.ndarray) -> np.ndarray:
    """Positions at times t of a ball in flight (gravity and drag only), integrated at SUBSTEP and interpolated."""
    x, y, z, vx, vy, vz = (float(v) for v in theta)
    n = int(math.ceil(t[-1] / SUBSTEP)) + 1
    out = np.empty((n + 1, 3))
    out[0] = (x, y, z)
    h = SUBSTEP
    for i in range(1, n + 1):
        sp = math.sqrt(vx * vx + vy * vy + vz * vz)
        kk = k * sp * h
        vx -= kk * vx
        vy -= kk * vy
        vz -= kk * vz + GRAVITY * h
        x += vx * h
        y += vy * h
        z += vz * h
        out[i] = (x, y, z)
    grid = np.arange(n + 1) * h
    return np.stack([np.interp(t, grid, out[:, j]) for j in range(3)], axis=1)


def _fit_flight(p: Piece) -> tuple[float, float, float]:
    """(release speed, k, rmse) of one flight piece."""
    t = p.t
    vx, x0 = np.polyfit(t, p.pos[:, 0], 1)
    vy, y0 = np.polyfit(t, p.pos[:, 1], 1)
    a, vz, z0 = np.polyfit(t, p.pos[:, 2], 2)
    theta0 = np.array([x0, y0, z0, vx, vy, vz, 0.013])

    def resid(th):
        return (_fly(th[:6], th[6], t) - p.pos).ravel()

    lo = [-np.inf] * 6 + [0.0]
    hi = [np.inf] * 6 + [0.1]
    r = least_squares(resid, theta0, bounds=(lo, hi), loss="huber", f_scale=0.1)
    err = resid(r.x).reshape(-1, 3)
    rmse = float(np.sqrt((err**2).sum(axis=1).mean()))
    return float(np.linalg.norm(r.x[3:6])), float(r.x[6]), rmse


def fit_drag(flights: list[Piece]) -> DragFit:
    kept, rejected = [], 0
    for p in flights:
        speed, k, rmse = _fit_flight(p)
        if rmse > MAX_RMSE_M:
            rejected += 1
        else:
            kept.append((speed, k, rmse))
    ks = [k for _, k, _ in kept]
    bins = {}
    for lo, hi in SPEED_BINS:
        sel = [k for s, k, _ in kept if lo <= s < hi]
        if sel:
            bins[f"{lo:g}-{hi:g}"] = bootstrap_ci(sel)
    return DragFit(bootstrap_ci(ks), bins, rejected, kept)


@dataclass
class BounceKin:
    vt_in: float  # horizontal speed at landing
    vn_in: float  # downward speed at landing
    vt_out: float  # horizontal speed leaving the ground
    vz_out: float  # upward speed leaving the ground (NaN when the ball rolled on)
    first: bool  # the span's first bounce: no spin from an earlier bounce


def _fit_state(p: Piece, k: float) -> tuple[np.ndarray, float]:
    """Initial position and velocity of a flight piece with k fixed, and the fit's RMSE."""
    t = p.t
    vx, x0 = np.polyfit(t, p.pos[:, 0], 1)
    vy, y0 = np.polyfit(t, p.pos[:, 1], 1)
    _, vz, z0 = np.polyfit(t, p.pos[:, 2], 2)

    def resid(th):
        return (_fly(th, k, t) - p.pos).ravel()

    r = least_squares(resid, np.array([x0, y0, z0, vx, vy, vz]), loss="huber", f_scale=0.1)
    err = resid(r.x).reshape(-1, 3)
    return r.x, float(np.sqrt((err**2).sum(axis=1).mean()))


def _to_ground(th: np.ndarray, k: float, h: float) -> tuple[float, float]:
    """(horizontal, vertical) velocity where the ball's bottom reaches the ground, stepping by h (negative: back in time)."""
    x, y, z, vx, vy, vz = (float(v) for v in th)
    for _ in range(int(3.0 / abs(h))):
        if z <= 0:
            break
        sp = math.sqrt(vx * vx + vy * vy + vz * vz)
        kk = k * sp * h
        vx -= kk * vx
        vy -= kk * vy
        vz -= kk * vz + GRAVITY * h
        z += vz * h
    return math.hypot(vx, vy), vz


def bounce_kinematics(segs: list[Segments], k: float) -> list[BounceKin]:
    """Speeds either side of every bounce, from the flights fitted with the drag k (pieces it cannot follow are skipped)."""
    out = []
    for s in segs:
        firsts = set()
        for span in s.spans:
            inside = [b.frame for b in s.bounces if span.start <= b.frame < span.end]
            if inside:
                firsts.add(min(inside))
        for b in s.bounces:
            th, rmse = _fit_state(b.before, k)
            if rmse > MAX_RMSE_M:
                continue
            vt_in, vz_in = _to_ground(th, k, SUBSTEP / 10)
            if b.after.kind == "flight":
                th2, rmse2 = _fit_state(b.after, k)
                if rmse2 > MAX_RMSE_M:
                    continue
                vt_out, vz_out = _to_ground(th2, k, -SUBSTEP / 10)
            else:
                first = b.after.pos[:LINE_FRAMES]
                tt = np.arange(len(first)) / 25
                vt_out = math.hypot(np.polyfit(tt, first[:, 0], 1)[0], np.polyfit(tt, first[:, 1], 1)[0])
                vz_out = float("nan")
            out.append(BounceKin(vt_in, -vz_in, vt_out, vz_out, b.frame in firsts))
    return out


def fit_restitution(kins: list[BounceKin]) -> Constant:
    return bootstrap_ci([b.vz_out / b.vn_in for b in kins if b.vn_in >= MIN_VN and math.isfinite(b.vz_out)])


def _kept(mu: float, e: float, vt: np.ndarray, vn: np.ndarray) -> np.ndarray:
    imp = mu * (1 + e) * vn
    return np.where(2.5 * imp >= vt, 0.6 * vt, vt - imp)


MU_GRID = np.arange(0.01, 2.0001, 0.01)


def fit_friction(kins: list[BounceKin], e: float) -> Constant:
    """mu whose bounce best reproduces the speed kept on first bounces (grid search: grip and slide fits compete)."""
    bs = [b for b in kins if b.first and b.vt_in > 1.0 and b.vn_in > 0]
    if not bs or not math.isfinite(e):
        return NAN

    def fit(items):
        vt = np.array([b.vt_in for b in items])
        vn = np.array([b.vn_in for b in items])
        out = np.array([b.vt_out for b in items])
        sse = [float(((_kept(mu, e, vt, vn) - out) ** 2).sum()) for mu in MU_GRID]
        best = float(MU_GRID[int(np.argmin(sse))])
        r = minimize_scalar(lambda mu: float(((_kept(mu, e, vt, vn) - out) ** 2).sum()), bounds=(max(0.001, best - 0.01), best + 0.01), method="bounded")
        return (float(r.x),)

    return bootstrap_fit(bs, fit)[0]


@dataclass
class GroundRun:
    t: np.ndarray  # seconds from the piece's first frame
    s: np.ndarray  # distance along the piece's line, from its first frame
    v0: float  # speed at the first frame (quadratic fit of the first frames)


def _ground_run(p: Piece) -> GroundRun | None:
    if len(p.pos) < MIN_ROLL_FRAMES:
        return None
    d = p.pos[-1, :2] - p.pos[0, :2]
    length = float(np.hypot(*d))
    if length < 0.5:
        return None
    s = (p.pos[:, :2] - p.pos[0, :2]) @ (d / length)
    head = slice(0, min(len(s), 10))
    v0 = float(np.polyfit(p.t[head], s[head], 2)[1])
    return GroundRun(p.t, s, v0) if v0 > 0.5 else None


def _ground_paths(runs: list[GroundRun], k: float, mu_s: float, c0: float, c1: float, dv0: float = 0.0) -> np.ndarray:
    """Distance travelled at every frame time by every ground pass, all integrated together (struck without spin
    KICK_LEAD_S before the first frame, starting at v0 + dv0). Rows padded with NaN beyond each run's length."""
    n = max(len(r.t) for r in runs)
    v = np.array([r.v0 + dv0 for r in runs])
    rw = np.full(len(runs), 1.5 * mu_s * GRAVITY * KICK_LEAD_S)  # spin gained since the contact, as R w
    rw = np.minimum(rw, v)
    s = np.zeros(len(runs))
    out = np.full((len(runs), n), np.nan)
    out[:, 0] = 0.0
    h = GROUND_H
    per = int(round(1 / (25 * h)))
    fric = mu_s * GRAVITY
    for i in range(1, n * per):
        skid = v - rw > 1e-9
        dec = c0 + c1 * v + k * v * v + np.where(skid, fric, 0.0)
        nxt = np.maximum(0.0, v - dec * h)
        rw = np.where(skid, np.minimum(rw + 1.5 * fric * h, nxt), nxt)
        v = nxt
        s += v * h
        if i % per == 0:
            out[:, i // per] = s
    for j, r in enumerate(runs):
        out[j, len(r.t):] = np.nan
    return out


def fit_rolling(segs: list[Segments], k: float, n_boot: int = 50) -> RollFit:
    """Skid friction mu_s and rolling resistance c0 + c1 v from ground passes (rolling pieces that start at a kick).

    A ground pass leaves the foot without spin, so friction both slows it (mu_s g) and spins it up
    (R w grows at 1.5 mu_s g) until it rolls. Every ground pass is integrated with the engine's ground model
    from its measured starting speed; the three constants minimise the squared distance error, each pass
    free to shift and to adjust its starting speed (both are measured with noise).
    """
    runs = []
    for s in segs:
        starts = {sp.start for sp in s.spans}
        runs += [r for r in (_ground_run(p) for p in s.rolls if p.start in starts) if r is not None]
    if not runs:
        return RollFit(NAN, NAN, NAN, float("nan"))

    def fit(items):
        obs = np.full((len(items), max(len(r.t) for r in items)), np.nan)
        for j, r in enumerate(items):
            obs[j, :len(r.s)] = r.s

        ok = np.isfinite(obs)

        def sse(x):
            mu_s, c0, c1 = x
            if mu_s < 0 or c0 < 0 or c1 < 0:
                return 1e12
            base = _ground_paths(items, k, mu_s, c0, c1)
            jac = (_ground_paths(items, k, mu_s, c0, c1, DV0) - base) / DV0
            # Each pass may shift (its first position is noisy) and start a little faster or slower (its
            # first speed is estimated): one linearised least-squares step per pass on [1, d path / d v0].
            d = np.where(ok, obs - base, 0.0)
            j = np.where(ok, jac, 0.0)
            m = ok.sum(axis=1)
            sj, sjj, sd, sjd = j.sum(axis=1), (j * j).sum(axis=1), d.sum(axis=1), (j * d).sum(axis=1)
            det = m * sjj - sj * sj
            slope = np.where(det > 1e-9, (m * sjd - sj * sd) / np.where(det > 1e-9, det, 1.0), 0.0)
            shift = (sd - slope * sj) / m
            r = np.where(ok, d - shift[:, None] - slope[:, None] * j, 0.0)
            return float((r * r).sum())

        r = minimize(sse, [0.3, 0.5, 0.15], method="Nelder-Mead", options={"xatol": 1e-4, "fatol": 1e-6, "maxiter": 600})
        return tuple(float(v) for v in r.x)

    mu_s, c0, c1 = bootstrap_fit(runs, fit, n_boot=n_boot)
    ramp = roll_distance(RAMP_SPEED, 0.0, BallPhysics(k=k, c0=c0.value, c1=c1.value))
    return RollFit(c0, c1, mu_s, ramp)
```

Create `python/analytics/touchline_analytics/physics/stats.py`:

```python
"""Shared statistics for the physics fit: fitted constants with bootstrap intervals."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Callable, Sequence

import numpy as np

BOOT_N = 1000
BOOT_SEED = 0


@dataclass(frozen=True)
class Constant:
    value: float
    lo: float  # 95 % interval
    hi: float
    n: int  # segments, bounces or players behind the value
    source: str = "idsse"

    def to_json(self, unit: str, digits: int = 4) -> dict:
        r = lambda v: None if v != v else round(float(v), digits)  # noqa: E731
        return {"value": r(self.value), "ci95": [r(self.lo), r(self.hi)], "unit": unit, "n": self.n, "source": self.source}


NAN = Constant(float("nan"), float("nan"), float("nan"), 0)


def bootstrap_ci(values: Sequence[float], stat: Callable[[np.ndarray], float] = np.median, n_boot: int = BOOT_N, seed: int = BOOT_SEED) -> Constant:
    """`stat` of the values with a percentile bootstrap interval (seeded, so the fit is reproducible)."""
    x = np.asarray([v for v in values if np.isfinite(v)], dtype=float)
    if len(x) == 0:
        return NAN
    rng = np.random.default_rng(seed)
    boots = np.array([stat(x[rng.integers(0, len(x), len(x))]) for _ in range(n_boot)])
    return Constant(float(stat(x)), float(np.percentile(boots, 2.5)), float(np.percentile(boots, 97.5)), len(x))


def bootstrap_fit(items: Sequence, fit: Callable[[Sequence], tuple[float, ...]], n_boot: int = 200, seed: int = BOOT_SEED) -> list[Constant]:
    """Refit a multi-value `fit` on resampled items; one Constant per value (value from the full data)."""
    if len(items) == 0:
        return []
    full = fit(items)
    rng = np.random.default_rng(seed)
    boots = np.array([fit([items[i] for i in rng.integers(0, len(items), len(items))]) for _ in range(n_boot)])
    return [Constant(float(v), float(np.nanpercentile(boots[:, j], 2.5)), float(np.nanpercentile(boots[:, j], 97.5)), len(items)) for j, v in enumerate(full)]
```

- [ ] **Step 4: Run the tests**

Run: `uv run --locked --project python/analytics pytest -q python/analytics/tests/test_physics_fit_ball.py`
Expected: `7 passed` (about 15 s)

- [ ] **Step 5: Commit**

```bash
git add python/analytics
git commit -m "feat(analytics): fit the ball constants on tracking — drag per flight (and by release speed), restitution and bounce friction from flights integrated to the ground, skid friction and rolling resistance from ground passes; bootstrap intervals

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Fit the player movement constants

Acceleration-speed profiles by the Morin method (0.2 m/s bins from 3 m/s, the two largest accelerations along the run per bin, a line a = A0 (1 - v / S0)) per player and match, grouped GK/DEF/MID/FWD from the DFL position codes; the braking cap (95th percentile of deceleration peaks) and the lateral cap (95th percentile of acceleration across the run at 4 m/s or more); and the reaction delay: after each kick, the opponent nearest the ball half a second later, the lag until his velocity has changed by 1 m/s minus the 1/A0 s the acceleration law itself needs (opponents already changing course at the contact are skipped). Ruling 9 sets the smoothing windows and the handling of tracking jumps.

**Files:**
- Create: `python/analytics/touchline_analytics/physics/fit_players.py`
- Modify: `python/analytics/touchline_analytics/physics/load.py` (`smooth` takes `window` and `order`; `player_positions`)
- Test: `python/analytics/tests/test_physics_fit_players.py`

**Interfaces:**
- Consumes: `Half`, `smooth`, `FPS` (Task 1); `Segments` (Task 3); `Constant`, `NAN`, `bootstrap_fit` (Task 4).
- Produces: `GROUPS = ("GK", "DEF", "MID", "FWD")`, `group_of(dfl_code)`; `player_positions(meta_path) -> dict[id, code]`; `player_motion(xy) -> (speed, along, lat)`; `fit_profile(speed, along) -> (A0, S0, R2) | None`; `clean_track(xy) -> (xy, jumps)`; `Profile(player, group, a0, s0, r2, vmax)`, `sprint_profiles(matches, positions) -> (profiles, jumps)`; `braking_cap(tracks)`, `lateral_cap(tracks)`; `reaction_delays(half, segs, a0) -> list[float]`.

- [ ] **Step 1: Write the failing tests**

Create `python/analytics/tests/test_physics_fit_players.py`:

```python

import numpy as np
import pytest
from physics_fixtures import flight, half, kick_then

from touchline_analytics.physics.ballmodel import BallPhysics
from touchline_analytics.physics.fit_players import (
    GROUPS,
    fit_profile,
    group_of,
    lateral_cap,
    braking_cap,
    player_motion,
    reaction_delays,
    sprint_profiles,
)
from touchline_analytics.physics.load import FPS, Half, player_positions
from touchline_analytics.physics.segment import segment_half


def _run(a0: float, s0: float, rng: np.random.Generator, seconds: float = 600.0, brake: float = 6.0, noise: float = 0.007) -> np.ndarray:
    """A player who repeatedly sprints flat out (a = a0 (1 - v / s0)) from a jog, then brakes at `brake` m/s^2, at 25 Hz.

    Positions carry TRACAB-like noise: a little jitter, then rounding to the centimetre."""
    dt = 1 / FPS
    x, v, out, phase, hold = 0.0, 1.5, [], "jog", 0
    for _ in range(int(seconds * FPS)):
        if phase == "jog":
            v += (1.5 - v) * 0.2
            hold += 1
            if hold > rng.integers(50, 150):
                phase, hold = "sprint", 0
        elif phase == "sprint":
            v += a0 * (1 - v / s0) * dt
            hold += 1
            if hold > rng.integers(40, 90):
                phase = "brake"
        else:
            v = max(1.5, v - brake * dt)
            if v <= 1.5:
                phase, hold = "jog", 0
        x += v * dt
        out.append((x, 0.0))
    return np.round(np.array(out) + rng.normal(0, noise, (len(out), 2)), 2)


def test_morin_profile_recovers_a0_and_s0():
    rng = np.random.default_rng(1)
    speed, along, _ = player_motion(_run(8.5, 9.3, rng))
    prof = fit_profile(speed, along)
    assert prof is not None
    a0, s0, r2 = prof
    assert a0 == pytest.approx(8.5, rel=0.1) and s0 == pytest.approx(9.3, rel=0.06) and r2 > 0.9


def test_profile_needs_enough_fast_running():
    speed, along, _ = player_motion(np.cumsum(np.full((2000, 2), [0.04, 0.0]), axis=0))  # jogging at 1 m/s only
    assert fit_profile(speed, along) is None


def test_braking_cap_is_the_95th_percentile_of_deceleration_peaks():
    rng = np.random.default_rng(2)
    tracks = [player_motion(_run(8.0, 9.0, rng, 300.0, brake=b)) for b in (5.0, 6.0, 7.0)]
    cap = braking_cap(tracks)
    assert 6.0 <= cap.value <= 7.5 and cap.n == 3


def test_lateral_cap_from_running_in_circles():
    t = np.arange(0, 60, 1 / FPS)
    r, v = 6.0, 6.0  # a_lat = v^2 / r = 6 m/s^2
    xy = np.stack([r * np.cos(v * t / r), r * np.sin(v * t / r)], axis=1)
    cap = lateral_cap([player_motion(xy)])
    assert cap.value == pytest.approx(6.0, rel=0.05)


def test_player_positions_are_read_from_match_information(tmp_path):
    f = tmp_path / "meta.xml"
    f.write_text('<Team><Players><Player PersonId="DFL-OBJ-1" ShirtNumber="1" Starting="true" PlayingPosition="TW" TeamLeader="false" />'
                 '<Player PersonId="DFL-OBJ-2" ShirtNumber="9" PlayingPosition="STZ" /></Players></Team>')
    assert player_positions(f) == {"DFL-OBJ-1": "TW", "DFL-OBJ-2": "STZ"}


def test_dfl_positions_map_to_four_groups():
    assert group_of("TW") == "GK" and group_of("IVL") == "DEF" and group_of("RV") == "DEF"
    assert group_of("DMZ") == "MID" and group_of("ZO") == "MID" and group_of("HL") == "MID"
    assert group_of("OLM") == "FWD" and group_of("STZ") == "FWD" and group_of("LA") == "FWD"
    assert group_of("??") is None and set(GROUPS) == {"GK", "DEF", "MID", "FWD"}


def test_sprint_profiles_group_players_and_blank_tracking_jumps():
    rng = np.random.default_rng(3)
    n = 15000
    fast = _run(8.5, 9.3, rng, n / FPS)
    glitch = fast.copy()
    glitch[5000:5003, 0] += 3.0  # a tracking jump of 3 m (75 m/s for a frame) and back
    h = Half(1, 0, 0.0, np.zeros((n, 3)), np.ones(n, bool), {"a": fast, "b": glitch}, {"a": "T1", "b": "T1"})
    profiles, rejected = sprint_profiles([[h]], [{"a": "STZ", "b": "IVL"}])
    assert [(p.player, p.group) for p in profiles] == [("a", "FWD"), ("b", "DEF")]
    assert rejected == 2  # the jump there and the jump back
    assert profiles[1].a0 == pytest.approx(profiles[0].a0, rel=0.05) and profiles[1].vmax < 11


def _reacting_half(tau: float, rng: np.random.Generator) -> Half:
    """A ground pass at 1 s; an opponent 6 m away stands still, then sprints after it `tau` s after the contact."""
    ball, players = kick_then(flight(12.0, 0.0, 4.0, BallPhysics()))
    n = len(ball)
    contact = FPS  # the ball leaves the kicker at frame 25
    start = contact + int(round(tau * FPS))
    xs, v = [], 0.0
    x = 6.0
    for i in range(n):
        if i >= start:
            v += 8.5 * (1 - v / 9.3) / FPS
            x += v / FPS
        xs.append(x)
    players["defender"] = np.stack([np.array(xs), np.full(n, 3.0)], axis=1) + rng.normal(0, 0.02, (n, 2))
    h = half(ball, players)
    h.teams.update({"kicker": "A", "far": "A", "defender": "B"})
    return h


def test_reaction_delay_is_the_lag_the_acceleration_law_does_not_explain():
    rng = np.random.default_rng(4)
    taus = []
    for _ in range(10):
        h = _reacting_half(0.3, rng)
        taus += reaction_delays(h, segment_half(h), a0=8.5)
    assert len(taus) == 10
    assert np.median(taus) == pytest.approx(0.3, abs=0.06)


def test_reaction_needs_an_opponent_near_the_ball():
    ball, players = kick_then(flight(12.0, 0.0, 4.0, BallPhysics()))
    h = half(ball, players)
    h.teams.update({"kicker": "A", "far": "B"})  # the only opponent is ~40 m away
    assert reaction_delays(h, segment_half(h), a0=8.5) == []


def test_an_opponent_already_changing_course_at_the_kick_is_not_a_reaction():
    rng = np.random.default_rng(5)
    h = _reacting_half(-0.3, rng)  # he set off 0.3 s before the contact
    assert reaction_delays(h, segment_half(h), a0=8.5) == []
```

- [ ] **Step 2: Run them to make sure they fail**

Run: `uv run --locked --project python/analytics pytest -q python/analytics/tests/test_physics_fit_players.py`
Expected: collection error, `No module named 'touchline_analytics.physics.fit_players'`

- [ ] **Step 3: Write the implementation**

Create `python/analytics/touchline_analytics/physics/fit_players.py`:

```python
"""Fit the player movement constants on real tracking.

- Acceleration-speed profile (Morin et al. 2021): per player and match, speeds from 3 m/s in 0.2 m/s
  bins, the two largest accelerations along the direction of running in each bin, and a line
  a = A0 (1 - v / S0) through them. Players are grouped by position (GK, DEF, MID, FWD).
- Braking cap: the 95th percentile of deceleration peaks (local minima below -2 m/s^2), pooled.
- Lateral cap: the 95th percentile of acceleration across the direction of running at 4 m/s or more.
- Reaction delay: after a kick, the opponent nearest the ball half a second later; the lag from the
  contact until his velocity has changed by 1 m/s, minus the time the acceleration law itself needs
  for that change (1 / A0 s). What remains is the delay before he starts to respond. Opponents already
  changing course at the contact are skipped: that is not a reaction to the kick.

Tracking jumps (a step faster than 11 m/s, usually after a few frozen frames) are blanked with a second
either side and counted; the rest of the player's track is kept.
"""

from __future__ import annotations

import math
from dataclasses import dataclass

import numpy as np

from .load import FPS, Half, smooth
from .segment import Segments
from .stats import NAN, Constant, bootstrap_fit

GROUPS = ("GK", "DEF", "MID", "FWD")
# Accelerations need more smoothing than the ball: positions come rounded to the centimetre, and the
# top accelerations per speed bin pick out noise. A 0.84 s cubic window recovers A0 within ~6 % and S0
# within ~1 % on synthetic sprints with TRACAB-like noise; the reaction delay uses velocities only and
# keeps the loader's short window.
PLAYER_WINDOW = 21
PLAYER_ORDER = 3
_DFL_GROUP = {
    "TW": "GK",
    **{c: "DEF" for c in ("IVL", "IVR", "IVZ", "LV", "RV")},
    **{c: "MID" for c in ("DMZ", "DML", "DMR", "DLM", "DRM", "HL", "HR", "ZO", "LM", "RM")},
    **{c: "FWD" for c in ("OLM", "ORM", "LA", "RA", "STL", "STR", "STZ")},
}
BIN_FROM = 3.0
BIN_W = 0.2
TOP_PER_BIN = 2
MIN_BINS = 10
MAX_PLAYER_MS = 11.0
JUMP_BLANK = FPS  # frames blanked either side of a tracking jump
PEAK_BELOW = -2.0
PEAK_HALF_WINDOW = 3
LATERAL_FROM_MS = 4.0
CONTACT_LEAD = 3  # frames from the contact to a span's first frame (segment.py)
NEAR_AFTER = int(0.5 * FPS)
NEAR_M = 15.0
BASELINE = 5
DV = 1.0
REACT_WITHIN = int(1.5 * FPS)


@dataclass
class Profile:
    player: str
    group: str
    a0: float
    s0: float
    r2: float
    vmax: float


def group_of(code: str) -> str | None:
    return _DFL_GROUP.get(code)


def player_motion(xy: np.ndarray) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    """Speed, acceleration along the direction of running, and its size across it, per frame."""
    _, vel, acc = smooth(xy, window=PLAYER_WINDOW, order=PLAYER_ORDER)
    speed = np.hypot(vel[:, 0], vel[:, 1])
    with np.errstate(invalid="ignore", divide="ignore"):
        ux, uy = vel[:, 0] / speed, vel[:, 1] / speed
    along = acc[:, 0] * ux + acc[:, 1] * uy
    lat = np.abs(acc[:, 1] * ux - acc[:, 0] * uy)
    slow = speed < 0.5
    along[slow] = np.where(np.isfinite(along[slow]), along[slow], 0.0)
    lat[slow] = np.nan
    return speed, along, lat


def fit_profile(speed: np.ndarray, along: np.ndarray) -> tuple[float, float, float] | None:
    """(A0, S0, R^2) of the line through the top accelerations per speed bin; None with too few bins."""
    ok = np.isfinite(speed) & np.isfinite(along) & (speed >= BIN_FROM)
    v, a = speed[ok], along[ok]
    if len(v) == 0:
        return None
    idx = np.floor((v - BIN_FROM) / BIN_W).astype(int)
    xs, ys = [], []
    for b in np.unique(idx):
        sel = idx == b
        if sel.sum() < TOP_PER_BIN:
            continue
        top = np.argsort(a[sel])[-TOP_PER_BIN:]
        xs += v[sel][top].tolist()
        ys += a[sel][top].tolist()
    if len(xs) < MIN_BINS * TOP_PER_BIN:
        return None
    slope, a0 = np.polyfit(xs, ys, 1)
    if slope >= 0 or a0 <= 0:
        return None
    pred = a0 + slope * np.array(xs)
    ss = float(((np.array(ys) - np.mean(ys)) ** 2).sum()) or 1e-9
    return float(a0), float(-a0 / slope), 1.0 - float(((np.array(ys) - pred) ** 2).sum()) / ss


def clean_track(xy: np.ndarray) -> tuple[np.ndarray, int]:
    """The track with a second blanked either side of every tracking jump (a step faster than 11 m/s, typically
    after a few frozen frames), and the number of jumps."""
    step = np.hypot(*np.diff(xy, axis=0).T) * FPS
    jumps = np.flatnonzero(step > MAX_PLAYER_MS)
    if len(jumps) == 0:
        return xy, 0
    out = xy.copy()
    for j in jumps:
        out[max(0, j - JUMP_BLANK):j + 1 + JUMP_BLANK] = np.nan
    return out, len(jumps)


def sprint_profiles(matches: list[list[Half]], positions: list[dict[str, str]]) -> tuple[list[Profile], int]:
    """One profile per player per match (both halves together); `positions` maps player id to DFL position code.
    Returns the profiles and the number of tracking jumps blanked."""
    out, rejected = [], 0
    for halves, pos in zip(matches, positions):
        ids = sorted({pid for h in halves for pid in h.players})
        for pid in ids:
            tracks = []
            for h in halves:
                if pid in h.players:
                    xy, jumps = clean_track(h.players[pid])
                    tracks.append(xy)
                    rejected += jumps
            parts = [player_motion(xy) for xy in tracks]
            speed = np.concatenate([p[0] for p in parts])
            along = np.concatenate([p[1] for p in parts])
            group = group_of(pos.get(pid, ""))
            prof = fit_profile(speed, along)
            if group is None or prof is None:
                continue
            out.append(Profile(pid, group, *prof, float(np.nanmax(speed))))
    return out, rejected


def _peaks(speed: np.ndarray, along: np.ndarray) -> np.ndarray:
    a = np.where(np.isfinite(along), along, 0.0)
    n = len(a)
    out = []
    for i in np.flatnonzero((a < PEAK_BELOW) & (speed > 1.0)):
        lo, hi = max(0, i - PEAK_HALF_WINDOW), min(n, i + PEAK_HALF_WINDOW + 1)
        if a[i] == a[lo:hi].min():
            out.append(-a[i])
    return np.array(out)


def braking_cap(tracks: list[tuple[np.ndarray, np.ndarray, np.ndarray]]) -> Constant:
    """95th percentile of deceleration peaks pooled over players (interval by resampling players)."""
    items = [p for p in (_peaks(s, a) for s, a, _ in tracks) if len(p)]
    if not items:
        return NAN
    return bootstrap_fit(items, lambda xs: (float(np.percentile(np.concatenate(xs), 95)),))[0]


def lateral_cap(tracks: list[tuple[np.ndarray, np.ndarray, np.ndarray]]) -> Constant:
    """95th percentile of acceleration across the running direction at 4 m/s or more, pooled over players."""
    items = []
    for s, _, lat in tracks:
        sel = np.isfinite(lat) & (s >= LATERAL_FROM_MS)
        if sel.any():
            items.append(lat[sel])
    if not items:
        return NAN
    return bootstrap_fit(items, lambda xs: (float(np.percentile(np.concatenate(xs), 95)),))[0]


def reaction_delays(h: Half, seg: Segments, a0: float) -> list[float]:
    """Reaction delay (s) of the nearest opponent after each kick in this half."""
    out = []
    vel_cache: dict[str, np.ndarray] = {}
    n = len(h.ball)
    for k in seg.kicks:
        contact = k.frame - CONTACT_LEAD
        ref = contact + NEAR_AFTER
        if contact - BASELINE < 0 or contact + REACT_WITHIN >= n or ref >= n:
            continue
        here = {pid: xy[contact] for pid, xy in h.players.items() if np.isfinite(xy[contact]).all()}
        if not here:
            continue
        bx, by = h.ball[contact, :2]
        kicker = min(here, key=lambda pid: math.hypot(here[pid][0] - bx, here[pid][1] - by))
        team = h.teams.get(kicker)
        rx, ry = h.ball[ref, :2]
        best, best_d = None, NEAR_M
        for pid, xy in h.players.items():
            if h.teams.get(pid) == team or not np.isfinite(xy[ref]).all():
                continue
            d = math.hypot(xy[ref, 0] - rx, xy[ref, 1] - ry)
            if d <= best_d:
                best, best_d = pid, d
        if best is None:
            continue
        if best not in vel_cache:
            vel_cache[best] = smooth(clean_track(h.players[best])[0])[1]
        vel = vel_cache[best]
        base = vel[contact - BASELINE:contact]
        if not np.isfinite(base).all():
            continue
        vb = base.mean(axis=0)
        change = np.hypot(*(vel[contact:contact + REACT_WITHIN] - vb).T)
        if not np.isfinite(change).all() or change[0] >= DV / 2:
            continue  # tracking gap, or already changing course at the contact: not a reaction to this kick
        hit = np.flatnonzero(change >= DV)
        if len(hit):
            out.append(hit[0] / FPS - DV / a0)
    return out
```

Apply this change to `python/analytics/touchline_analytics/physics/load.py` (from the repository root):

```bash
git apply <<'PATCH'
diff --git a/python/analytics/touchline_analytics/physics/load.py b/python/analytics/touchline_analytics/physics/load.py
index 7e1abc7..7f3117e 100644
--- a/python/analytics/touchline_analytics/physics/load.py
+++ b/python/analytics/touchline_analytics/physics/load.py
@@ -154,7 +154,15 @@ def kick_events(path: Path) -> list[KickEvent]:
     return out
 
 
-def smooth(xy: np.ndarray, fps: int = FPS) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
+_PLAYER = re.compile(r'<Player [^>]*?PersonId="([^"]+)"[^>]*?PlayingPosition="([^"]+)"')
+
+
+def player_positions(path: Path) -> dict[str, str]:
+    """Player id -> DFL position code (e.g. TW, IVL, DMZ, STZ) from a match-information file."""
+    return {m[1]: m[2] for m in _PLAYER.finditer(Path(path).read_text(encoding="utf-8"))}
+
+
+def smooth(xy: np.ndarray, fps: int = FPS, window: int = WINDOW, order: int = ORDER) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
     """Savitzky-Golay position, velocity and acceleration of an (n, k) series, per run of finite frames.
 
     Runs shorter than the window stay NaN, so gaps never bleed into derivatives.
@@ -165,10 +173,10 @@ def smooth(xy: np.ndarray, fps: int = FPS) -> tuple[np.ndarray, np.ndarray, np.n
     ok = np.isfinite(xy).all(axis=1)
     edges = np.flatnonzero(np.diff(np.concatenate([[0], ok.astype(int), [0]])))
     for a, b in zip(edges[::2], edges[1::2]):
-        if b - a < WINDOW:
+        if b - a < window:
             continue
         seg = xy[a:b]
-        pos[a:b] = savgol_filter(seg, WINDOW, ORDER, axis=0)
-        vel[a:b] = savgol_filter(seg, WINDOW, ORDER, deriv=1, delta=1 / fps, axis=0)
-        acc[a:b] = savgol_filter(seg, WINDOW, ORDER, deriv=2, delta=1 / fps, axis=0)
+        pos[a:b] = savgol_filter(seg, window, order, axis=0)
+        vel[a:b] = savgol_filter(seg, window, order, deriv=1, delta=1 / fps, axis=0)
+        acc[a:b] = savgol_filter(seg, window, order, deriv=2, delta=1 / fps, axis=0)
     return pos, vel, acc
PATCH
```

- [ ] **Step 4: Run the tests**

Run: `uv run --locked --project python/analytics pytest -q python/analytics/tests/test_physics_fit_players.py`
Expected: `10 passed`

Run: `uv run --locked --project python/analytics pytest -q python/analytics/tests`
Expected: all pass

- [ ] **Step 5: Commit**

```bash
git add python/analytics
git commit -m "feat(analytics): fit the player movement constants on tracking — acceleration-speed profiles by position (Morin), braking and lateral caps, reaction delay after kicks; tracking jumps blanked

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Validation statistics, the envelope and replays

One definition of every validation statistic. Player statistics at 10 Hz (real tracking resampled; speed by central difference, never across a gap; change of speed from speed averaged over 0.5 s): per-frame speed and change of speed by group, and per player with 30 minutes or more the maximum speed, metres per 90 above 20 and 25 km/h, and accelerations and decelerations past 3 m/s^2 per 90. Each is a histogram on fixed edges; W1 between histograms is the area between their CDFs; the envelope of a statistic is the W1 over every pair of real matches. Ball statistics per free-ball span (flight time, aerial carry, ground run, rolling deceleration, bounce ratio, release and reception speed), and replays of real spans with the fitted constants (Ruling 6).

**Files:**
- Create: `python/analytics/touchline_analytics/physics/validate.py`
- Test: `python/analytics/tests/test_physics_validate.py`

**Interfaces:**
- Consumes: `simulate`, `SUBSTEP`, `BallPhysics` (Task 2); `RADIUS`, `_apex` (Task 3); `FPS` (Task 1).
- Produces: `PLAYER_EDGES`, `BALL_EDGES` (dict name -> edges); `hist(values, edges)`, `w1(a, b, edges)`, `envelope(per_match, edges) -> {name: {min, median, max, pairs}}`; `resample_10hz(xy)`; `player_samples(tracks)`, `player_metrics(tracks)` with tracks `{id: (group, (n,2) at 10 Hz)}`; `span_metrics(pos)`, `ball_metrics(spans)`; `Replay(sim, rmse, floor, ratio)`, `replay(pos, p)`, `replay_span(pos, p)`.

- [ ] **Step 1: Write the failing tests**

Create `python/analytics/tests/test_physics_validate.py`:

```python
import numpy as np
import pytest
from physics_fixtures import flight, half, kick_then

from touchline_analytics.physics.ballmodel import BallPhysics
from touchline_analytics.physics.segment import segment_half
from touchline_analytics.physics.validate import (
    PLAYER_EDGES,
    envelope,
    hist,
    player_metrics,
    player_samples,
    replay,
    replay_span,
    resample_10hz,
    span_metrics,
    w1,
)


def test_w1_of_histograms_is_the_area_between_their_cdfs():
    edges = [0, 1, 2, 3]
    assert w1([1, 0, 0], [1, 0, 0], edges) == 0
    assert w1([1, 0, 0], [0, 1, 0], edges) == pytest.approx(1.0)
    assert w1([1, 0, 0], [0, 0, 1], edges) == pytest.approx(2.0)
    assert w1([0.5, 0.5, 0], [0, 0.5, 0.5], edges) == pytest.approx(1.0)


def test_hist_clips_into_the_end_bins_and_normalises():
    assert hist([-5, 0.5, 1.5, 99], [0, 1, 2]) == [0.5, 0.5]
    assert hist([], [0, 1, 2]) == [0.0, 0.0]


def test_envelope_spans_every_pair_of_matches():
    edges = {"m": [0, 1, 2, 3]}
    matches = [{"m": [1, 0, 0]}, {"m": [0, 1, 0]}, {"m": [0, 0, 1]}]
    env = envelope(matches, edges)
    assert env["m"] == {"min": 1.0, "median": 1.0, "max": 2.0, "pairs": 3}


def test_resample_to_10_hz_interpolates_at_tenths_of_a_second():
    xy = np.stack([np.arange(26) * 0.4, np.zeros(26)], axis=1)  # 10 m/s at 25 Hz, 1 s
    out = resample_10hz(xy)
    assert len(out) == 11 and np.allclose(out[:, 0], np.arange(11) * 1.0)


def _player(speeds: list[tuple[float, float]]) -> np.ndarray:
    """10 Hz track running at each (speed, seconds) in turn along x."""
    v = np.concatenate([np.full(int(s * 10), sp) for sp, s in speeds])
    return np.stack([np.concatenate([[0.0], np.cumsum(v) * 0.1]), np.zeros(len(v) + 1)], axis=1)


def test_player_samples_measure_speed_high_speed_running_and_efforts():
    jog = _player([(3.0, 2700.0)])  # 45 minutes at 3 m/s
    runner = _player([(3.0, 600.0), (7.0, 60.0), (3.0, 600.0), (7.0, 60.0), (3.0, 1380.0)])  # two 60 s runs at 7 m/s
    s = player_samples({"j": ("MID", jog), "r": ("FWD", runner)})
    assert s["max_speed"] == pytest.approx([3.0, 7.0])
    assert s["hsr20"][1] == pytest.approx(2 * 7.0 * 60 * 2, rel=0.02)  # 840 m in 45 min -> 1680 per 90
    assert s["hsr25"][1] == pytest.approx(2 * 7.0 * 60 * 2, rel=0.02)
    assert s["hsr20"][0] == 0.0
    assert s["acc_count"][1] == pytest.approx(4.0, rel=1e-3) and s["dec_count"][1] == pytest.approx(4.0, rel=1e-3)  # per 90: 2 each in 45 min
    assert len(s["speed_MID"]) > 20000 and not s["speed_GK"]


def test_speeds_are_never_taken_across_a_gap():
    a = _player([(3.0, 2000.0)])
    b = _player([(3.0, 2000.0)]) + [50.0, 20.0]  # the second half starts somewhere else
    s = player_samples({"p": ("MID", np.vstack([a, np.full((1, 2), np.nan), b]))})
    assert max(s["speed_MID"]) == pytest.approx(3.0) and s["max_speed"] == [pytest.approx(3.0)]


def test_short_appearances_count_for_speeds_but_not_per_90_figures():
    s = player_samples({"sub": ("DEF", _player([(4.0, 600.0)]))})  # 10 minutes
    assert s["max_speed"] == [] and s["hsr20"] == [] and len(s["speed_DEF"]) > 5000


def test_player_metrics_are_histograms_on_fixed_edges():
    m = player_metrics({"j": ("MID", _player([(3.0, 2700.0)]))})
    assert set(m) == set(PLAYER_EDGES)
    for k, h in m.items():
        assert len(h) == len(PLAYER_EDGES[k]) - 1


P = BallPhysics(k=0.013, e=0.7, mu=0.25, mu_s=0.35)


def test_span_metrics_of_a_lofted_ball():
    ball, players = kick_then(flight(18.0, 30.0, 6.0, P))
    seg = segment_half(half(ball, players))
    sp = seg.spans[0]
    m = span_metrics(ball[sp.start:sp.end])
    assert m["flight_time"][0] == pytest.approx(1.8, abs=0.3)
    assert m["carry_air"][0] == pytest.approx(25.0, abs=5.0) and m["run_ground"] == []
    assert m["bounce_ratio"][0] == pytest.approx(0.66, abs=0.06)
    assert m["reception_speed"][0] > 0


def test_replay_with_the_true_physics_follows_the_ball():
    ball, players = kick_then(flight(18.0, 30.0, 6.0, P))
    seg = segment_half(half(ball + np.random.default_rng(1).normal(0, 0.03, ball.shape), players))
    sp = seg.spans[0]
    real = ball[sp.start:sp.end]
    good = replay_span(real, P)
    assert good.rmse < 0.1 and good.ratio < 1.5
    bad = replay_span(real, BallPhysics(k=0.05, e=0.4, mu=0.8, mu_s=0.8))
    assert bad.ratio > 3 and bad.sim.shape == real.shape
    assert np.linalg.norm(replay(real, P)[-1] - real[-1]) < 3.0  # from the measured start alone
```

- [ ] **Step 2: Run them to make sure they fail**

Run: `uv run --locked --project python/analytics pytest -q python/analytics/tests/test_physics_validate.py`
Expected: collection error, `No module named 'touchline_analytics.physics.validate'`

- [ ] **Step 3: Write the implementation**

Create `python/analytics/touchline_analytics/physics/validate.py`:

```python
"""Validation of the fitted physics: distributions compared by Wasserstein-1 against real match-to-match spread.

Player statistics (one definition for real and simulated data; packages/calibrate/src/physics.ts is a
line-for-line port checked by the parity test):
- Tracks at 10 Hz (real tracking is resampled by linear interpolation; the engine runs at 10 Hz).
- Speed at a frame is the central difference |p[i+1] - p[i-1]| / 0.2 s; the change of speed is the central
  difference of speed averaged over 0.5 s (five samples).
- Per frame, by position group: speed and change of speed. Per player with 30 minutes or more on the
  pitch: maximum speed, metres per 90 minutes above 20 and 25 km/h, and accelerations and decelerations
  past 3 m/s^2 per 90 minutes (each crossing of the threshold counts once).
Each statistic is a histogram on fixed edges (values outside go in the end bins); two histograms differ
by W1, the area between their CDFs, in the statistic's own units. A statistic passes when the simulation's
W1 to the real matches is within the largest W1 between two real matches (the inter-match envelope).

Ball statistics (Python only: real held-out spans against the fitted model replaying them) are measured
per free-ball span: flight times, aerial carry to the first landing, ground run of ground passes, rolling
deceleration, bounce apex ratio, release and reception speed. The replay seeds the model with each span's
first frames; replay_span also measures how much worse the fitted constants explain a span than constants
refitted to it alone.
"""

from __future__ import annotations

import math
from dataclasses import dataclass, replace
from itertools import combinations

import numpy as np
from scipy.optimize import least_squares

from .ballmodel import SUBSTEP, BallPhysics, simulate
from .load import FPS
from .segment import RADIUS, _apex

GROUPS = ("GK", "DEF", "MID", "FWD")
HZ = 10
DT = 1 / HZ
MIN_MINUTES = 30.0
HSR20 = 20 / 3.6
HSR25 = 25 / 3.6
EFFORT = 3.0


def _edges(lo: float, hi: float, step: float) -> list[float]:
    return [round(lo + i * step, 6) for i in range(int(round((hi - lo) / step)) + 1)]


PLAYER_EDGES: dict[str, list[float]] = {
    **{f"speed_{g}": _edges(0, 11, 0.5) for g in GROUPS},
    **{f"accel_{g}": _edges(-6, 6, 0.5) for g in GROUPS},
    "max_speed": _edges(5, 11, 0.25),
    "hsr20": _edges(0, 1500, 50),
    "hsr25": _edges(0, 600, 25),
    "acc_count": _edges(0, 200, 5),
    "dec_count": _edges(0, 200, 5),
}
BALL_EDGES: dict[str, list[float]] = {
    "flight_time": _edges(0, 4, 0.2),
    "carry_air": _edges(0, 70, 2.5),
    "run_ground": _edges(0, 50, 2.5),
    "roll_decel": _edges(-2, 12, 0.5),
    "bounce_ratio": _edges(0, 1.2, 0.05),
    "release_speed": _edges(0, 36, 1.5),
    "reception_speed": _edges(0, 24, 1.0),
}


def hist(values, edges: list[float]) -> list[float]:
    v = np.asarray(list(values), dtype=float)
    v = v[np.isfinite(v)]
    if len(v) == 0:
        return [0.0] * (len(edges) - 1)
    v = np.clip(v, edges[0], edges[-1] - 1e-9)
    counts, _ = np.histogram(v, bins=edges)
    return (counts / counts.sum()).tolist()


def w1(a, b, edges: list[float]) -> float:
    """Wasserstein-1 between two histograms on the same edges, as masses at bin centres."""
    centres = [(edges[i] + edges[i + 1]) / 2 for i in range(len(edges) - 1)]
    total, fa, fb = 0.0, 0.0, 0.0
    for i in range(len(centres) - 1):
        fa += a[i]
        fb += b[i]
        total += abs(fa - fb) * (centres[i + 1] - centres[i])
    return total


def envelope(per_match: list[dict[str, list[float]]], edges: dict[str, list[float]]) -> dict[str, dict]:
    """For each statistic, W1 between every pair of real matches: min, median and max."""
    out = {}
    for k, e in edges.items():
        ds = [w1(a[k], b[k], e) for a, b in combinations(per_match, 2) if sum(a[k]) > 0 and sum(b[k]) > 0]
        if ds:
            out[k] = {"min": round(min(ds), 6), "median": round(float(np.median(ds)), 6), "max": round(max(ds), 6), "pairs": len(ds)}
    return out


def resample_10hz(xy: np.ndarray, fps: int = FPS) -> np.ndarray:
    """Linear interpolation at every tenth of a second (NaN where either neighbouring frame is missing)."""
    n = int(math.floor((len(xy) - 1) * HZ / fps)) + 1
    pos = np.arange(n) * fps / HZ
    i0 = np.floor(pos).astype(int)
    f = (pos - i0)[:, None]
    i1 = np.minimum(i0 + 1, len(xy) - 1)
    a, b = xy[i0], xy[i1]
    return np.where(f == 0, a, a * (1 - f) + b * f)


def _central(x: np.ndarray) -> np.ndarray:
    """(x[i+1] - x[i-1]) / 0.2 s, only where x[i-1], x[i] and x[i+1] are all present (never across a gap)."""
    out = np.full(len(x), np.nan)
    if len(x) >= 3:
        out[1:-1] = np.where(np.isfinite(x[1:-1]), (x[2:] - x[:-2]) / (2 * DT), np.nan)
    return out


def _mean5(x: np.ndarray) -> np.ndarray:
    """Centred mean of five samples (0.5 s), only where all five are present: tracking noise would otherwise
    cross the 3 m/s^2 effort threshold many times in one real effort, and simulated tracks have none."""
    out = np.full(len(x), np.nan)
    if len(x) >= 5:
        out[2:-2] = (x[:-4] + x[1:-3] + x[2:-2] + x[3:-1] + x[4:]) / 5
    return out


def player_samples(tracks: dict[str, tuple[str, np.ndarray]]) -> dict[str, list[float]]:
    """Raw samples of every player statistic; `tracks` maps player id to (position group, (n, 2) positions at 10 Hz)."""
    out: dict[str, list[float]] = {k: [] for k in PLAYER_EDGES}
    for _, (group, xy) in tracks.items():
        vx, vy = _central(xy[:, 0]), _central(xy[:, 1])
        speed = np.hypot(vx, vy)
        dspeed = _central(_mean5(speed))
        out[f"speed_{group}"] += speed[np.isfinite(speed)].tolist()
        out[f"accel_{group}"] += dspeed[np.isfinite(dspeed)].tolist()
        minutes = np.isfinite(xy).all(axis=1).sum() * DT / 60
        if minutes < MIN_MINUTES:
            continue
        per90 = 90.0 / minutes
        ok = np.isfinite(speed)
        out["max_speed"].append(float(speed[ok].max()))
        out["hsr20"].append(float(speed[ok & (speed > HSR20)].sum() * DT * per90))
        out["hsr25"].append(float(speed[ok & (speed > HSR25)].sum() * DT * per90))
        d = np.where(np.isfinite(dspeed), dspeed, 0.0)
        out["acc_count"].append(float(((d[1:] > EFFORT) & (d[:-1] <= EFFORT)).sum() * per90))
        out["dec_count"].append(float(((d[1:] < -EFFORT) & (d[:-1] >= -EFFORT)).sum() * per90))
    return out


def player_metrics(tracks: dict[str, tuple[str, np.ndarray]]) -> dict[str, list[float]]:
    s = player_samples(tracks)
    return {k: hist(s[k], e) for k, e in PLAYER_EDGES.items()}


AIR = 0.3
MIN_AIR_FRAMES = 6
END_FRAMES = 5
ROLL_FRAMES = 12
BOUNCE_GAP = 8


def _runs(mask: np.ndarray) -> list[tuple[int, int]]:
    edges = np.flatnonzero(np.diff(np.concatenate([[0], mask.astype(int), [0]])))
    return list(zip(edges[::2].tolist(), edges[1::2].tolist()))


def _speed(pos: np.ndarray) -> float:
    t = np.arange(len(pos)) / FPS
    return float(np.linalg.norm([np.polyfit(t, pos[:, k], 1)[0] for k in range(pos.shape[1])]))


def span_metrics(pos: np.ndarray) -> dict[str, list[float]]:
    """Ball statistics of one free-ball span ((n, 3) tracked positions at 25 Hz, z of the ball's centre)."""
    out: dict[str, list[float]] = {k: [] for k in BALL_EDGES}
    if len(pos) < END_FRAMES or not np.isfinite(pos).all():
        return out
    zb = pos[:, 2] - RADIUS
    air = [(a, b) for a, b in _runs(zb > AIR) if b - a >= MIN_AIR_FRAMES]
    out["flight_time"] = [(b - a) / FPS for a, b in air]
    if air and air[0][0] <= BOUNCE_GAP:
        a, b = air[0]
        land = b + int(np.argmin(zb[b:b + BOUNCE_GAP])) if b < len(zb) else b - 1
        land = min(land, len(pos) - 1)
        out["carry_air"] = [float(np.hypot(*(pos[land, :2] - pos[0, :2])))]
    elif not air:
        out["run_ground"] = [float(np.hypot(*(pos[-1, :2] - pos[0, :2])))]
    for a, b in _runs(zb <= AIR):
        if b - a >= ROLL_FRAMES:
            v0, v1 = _speed(pos[a:a + END_FRAMES, :2]), _speed(pos[b - END_FRAMES:b, :2])
            out["roll_decel"].append((v0 - v1) / ((b - a - END_FRAMES) / FPS))
    t = lambda a, b: np.arange(b - a) / FPS  # noqa: E731
    for (a1, b1), (a2, b2) in zip(air, air[1:]):
        if a2 - b1 <= BOUNCE_GAP:
            h1, h2 = _apex(t(a1, b1), zb[a1:b1]), _apex(t(a2, b2), zb[a2:b2])
            if math.isfinite(h1) and math.isfinite(h2) and h1 > 0:
                out["bounce_ratio"].append(math.sqrt(max(h2, 0.0) / h1))
    out["release_speed"] = [_speed(pos[:END_FRAMES])]
    out["reception_speed"] = [_speed(pos[-END_FRAMES:, :2])]
    return out


def ball_metrics(spans: list[np.ndarray]) -> dict[str, list[float]]:
    samples: dict[str, list[float]] = {k: [] for k in BALL_EDGES}
    for pos in spans:
        for k, v in span_metrics(pos).items():
            samples[k] += v
    return {k: hist(samples[k], e) for k, e in BALL_EDGES.items()}


@dataclass
class Replay:
    sim: np.ndarray  # (n, 3) the model from the span's measured first frames, z of the centre
    rmse: float  # the model with the fitted constants from the start that suits it best
    floor: float  # the same with the ball constants refitted to this span as well: the achievable floor
    ratio: float


REPLAY_FLOOR_M = 0.05
START_FRAMES = 8
FREE = ("k", "e", "mu", "mu_s", "c0", "c1")
FREE_LO = (0.0, 0.2, 0.01, 0.01, 0.0, 0.0)
FREE_HI = (0.1, 1.0, 2.0, 2.0, 5.0, 1.0)


def _path(th: np.ndarray, n: int, p: BallPhysics) -> np.ndarray:
    traj = simulate((th[0], th[1], max(0.0, th[2]), th[3], th[4], th[5], 0.0), (n - 1) / FPS + SUBSTEP, p)
    times = np.arange(n) / FPS
    out = np.stack([np.interp(times, traj[:, 0], traj[:, j]) for j in (1, 2, 3)], axis=1)
    out[:, 2] += RADIUS
    return out


def _start(pos: np.ndarray) -> np.ndarray:
    head = pos[:START_FRAMES]
    t = np.arange(len(head)) / FPS
    # Quadratics in every coordinate: drag slows the ball noticeably over the first 8 frames.
    _, vx, x0 = np.polyfit(t, head[:, 0], 2)
    _, vy, y0 = np.polyfit(t, head[:, 1], 2)
    _, vz, z0 = np.polyfit(t, head[:, 2] - RADIUS, 2)
    if z0 <= 0.02 and vz <= 0.5:
        z0, vz = 0.0, 0.0
    return np.array([x0, y0, max(0.0, z0), vx, vy, vz])


def _rmse(sim: np.ndarray, pos: np.ndarray) -> float:
    return float(np.sqrt(((sim - pos) ** 2).sum(axis=1).mean()))


def replay(pos: np.ndarray, p: BallPhysics) -> np.ndarray:
    """The model seeded with the span's first frames (struck without spin), at the span's frames."""
    return _path(_start(pos), len(pos), p)


def replay_span(pos: np.ndarray, p: BallPhysics) -> Replay:
    """How well the fitted constants explain one span, against constants tailored to it.

    Both fits choose the span's starting state (an estimate from a few noisy frames would dominate the
    error of a long span); the floor also refits the ball constants to this span alone. The ratio is near
    1 when the fitted constants describe the span as well as any constants could.
    """
    n = len(pos)
    th = _start(pos)
    r = least_squares(lambda x: (_path(x, n, p) - pos).ravel(), th, max_nfev=300)
    rmse = _rmse(_path(r.x, n, p), pos)
    x0 = np.concatenate([r.x, np.clip([getattr(p, f) for f in FREE], FREE_LO, FREE_HI)])
    lo = [-np.inf] * 6 + list(FREE_LO)
    hi = [np.inf] * 6 + list(FREE_HI)
    path = lambda x: _path(x[:6], n, replace(p, **dict(zip(FREE, x[6:]))))  # noqa: E731
    f = least_squares(lambda x: (path(x) - pos).ravel(), x0, bounds=(lo, hi), max_nfev=600)
    floor = min(_rmse(path(f.x), pos), rmse)
    return Replay(_path(th, n, p), rmse, floor, rmse / max(floor, REPLAY_FLOOR_M))
```

- [ ] **Step 4: Run the tests**

Run: `uv run --locked --project python/analytics pytest -q python/analytics/tests/test_physics_validate.py`
Expected: `10 passed`

- [ ] **Step 5: Commit**

```bash
git add python/analytics
git commit -m "feat(analytics): physics validation — player statistics as histograms with W1 against the inter-match envelope, ball statistics per free-ball span, and replays of real spans with the fitted constants against a per-span floor

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: pnpm physics:fit and data/params/physics.json

The fit end to end: five matches fitted (J03WMX, J03WN1, J03WOH, J03WOY, J03WPY), two held out (J03WQQ, J03WR9). Physical-range guards stop the fit before anything is written (Rulings 3–5); the restitution falls back to the certified 0.62 when its estimate is too imprecise. The file holds every constant with its interval, unit, sample size and source; reject counts; the envelope and the pooled real distributions (aggregates only); and the held-out results (P2: ball statistics of replays inside the envelope; P4: replay ratio). The engine's block is also written into `touchline-params.json` (`physics`, ignored by the engine until Task 8).

**Files:**
- Create: `python/analytics/touchline_analytics/physics/build.py`, `python/analytics/touchline_analytics/physics/__main__.py`
- Modify: `package.json` (script `physics:fit`)
- Create (generated): `data/params/physics.json`; Modify (generated): `data/params/touchline-params.json` (its `physics` block)
- Test: `python/analytics/tests/test_physics_build.py`

**Interfaces:**
- Consumes: every fit and validation function of Tasks 1–6; `MATCHES`, `PROVENANCE`, `filenames` from `touchline_analytics.idsse`.
- Produces: `GuardError`, `GUARDS`, `check_guards(fit)`, `MIN_BOUNCES = 100`, `MAX_E_CI = 0.1`, `LITERATURE_E = 0.62`, `restitution_or_fallback(e)`, `engine_block(fit) -> {ball: {drag, restitution, bounceFriction, skidFriction, rollC0, rollC1}, players: {a0: {G: [p10..p90]}, s0: {...}, brake, lateral, reactionS}}`, `sync_params(path, engine)`, `write(result, out, params)`, `build(root, cache) -> result`. `data/params/physics.json` keys: `provenance`, `fit`, `rejects`, `validation` (`envelope`, `real.players`, `real.ball`, `edges`, `held_out`), `engine`.

- [ ] **Step 1: Write the failing tests**

Create `python/analytics/tests/test_physics_build.py`:

```python
import json

import pytest

from touchline_analytics.physics.build import LITERATURE_E, MIN_BOUNCES, GuardError, check_guards, engine_block, restitution_or_fallback, sync_params, write
from touchline_analytics.physics.stats import Constant


def _fit(**over) -> dict:
    c = lambda v, n=500: {"value": v, "ci95": [v * 0.9, v * 1.1], "unit": "", "n": n, "source": "idsse"}  # noqa: E731
    pct = lambda m: {"p10": m * 0.9, "p25": m * 0.95, "p50": m, "p75": m * 1.05, "p90": m * 1.1, "n": 10}  # noqa: E731
    fit = {
        "ball": {"drag": c(0.015), "restitution": c(0.74), "bounce_friction": c(0.23), "skid_friction": c(0.37), "roll_c0": c(0.48), "roll_c1": c(0.13), "ramp_m": 6.4},
        "players": {
            "a0": {g: pct(8.4) for g in ("GK", "DEF", "MID", "FWD")},
            "s0": {g: pct(9.0) for g in ("GK", "DEF", "MID", "FWD")},
            "braking": c(6.0),
            "lateral": c(3.8),
            "reaction": c(0.2),
        },
    }
    for path, v in over.items():
        sec, key = path.split(".")
        fit[sec][key] = v
    return fit


def test_guards_pass_for_physical_values():
    check_guards(_fit())


@pytest.mark.parametrize(
    "path,value,needle",
    [
        ("ball.restitution", {"value": 0.95, "ci95": [0.9, 1.0], "n": 300}, "restitution"),
        ("ball.bounce_friction", {"value": 0.05, "ci95": [0.04, 0.06], "n": 300}, "bounce_friction"),
        ("ball.ramp_m", 1.7, "ramp"),
        ("players.braking", {"value": 15.0, "ci95": [14, 16], "n": 40}, "braking"),
        ("players.reaction", {"value": 0.8, "ci95": [0.7, 0.9], "n": 600}, "reaction"),
    ],
)
def test_guards_name_every_constant_out_of_its_physical_range(path, value, needle):
    with pytest.raises(GuardError, match=needle):
        check_guards(_fit(**{path: value}))


def test_guard_on_player_profiles_checks_every_group():
    fit = _fit()
    fit["players"]["s0"]["GK"]["p50"] = 12.5
    with pytest.raises(GuardError, match="s0.GK"):
        check_guards(fit)


def test_restitution_falls_back_to_the_certified_value_with_too_few_bounces_or_a_wide_interval():
    few = Constant(0.71, 0.6, 0.8, MIN_BOUNCES - 1)
    out = restitution_or_fallback(few)
    assert out.value == LITERATURE_E and out.source == "literature" and out.n == MIN_BOUNCES - 1
    many = Constant(0.71, 0.7, 0.72, MIN_BOUNCES)
    assert restitution_or_fallback(many) is many
    vague = Constant(0.71, 0.6, 0.85, 5 * MIN_BOUNCES)
    assert restitution_or_fallback(vague).source == "literature"


def test_keepers_may_be_slower_than_outfielders():
    fit = _fit()
    fit["players"]["s0"]["GK"]["p50"] = 7.3
    check_guards(fit)


def test_engine_block_holds_what_the_engine_reads():
    e = engine_block(_fit())
    assert e["ball"] == {"drag": 0.015, "restitution": 0.74, "bounceFriction": 0.23, "skidFriction": 0.37, "rollC0": 0.48, "rollC1": 0.13}
    assert e["players"]["a0"]["MID"] == [7.56, 7.98, 8.4, 8.82, 9.24]
    assert e["players"]["brake"] == 6.0 and e["players"]["lateral"] == 3.8 and e["players"]["reactionS"] == 0.2


def test_sync_params_replaces_only_the_physics_block(tmp_path):
    params = tmp_path / "touchline-params.json"
    params.write_text(json.dumps({"provenance": {"version": "x"}, "ball": {"drag": 0.013}, "physics": {"old": 1}}, indent=1) + "\n")
    sync_params(params, {"ball": {"drag": 0.015}})
    got = json.loads(params.read_text())
    assert got == {"provenance": {"version": "x"}, "ball": {"drag": 0.013}, "physics": {"ball": {"drag": 0.015}}}


def test_nothing_is_written_when_a_guard_fails(tmp_path):
    out = tmp_path / "physics.json"
    params = tmp_path / "touchline-params.json"
    params.write_text("{}\n")
    with pytest.raises(GuardError):
        write({"fit": _fit(**{"ball.ramp_m": 1.7})}, out, params)
    assert not out.exists() and params.read_text() == "{}\n"
    write({"fit": _fit()}, out, params)
    assert json.loads(out.read_text())["engine"] == engine_block(_fit())
    assert json.loads(params.read_text())["physics"] == engine_block(_fit())
```

- [ ] **Step 2: Run them to make sure they fail**

Run: `uv run --locked --project python/analytics pytest -q python/analytics/tests/test_physics_build.py`
Expected: collection error, `No module named 'touchline_analytics.physics.build'`

- [ ] **Step 3: Write the implementation**

Create `python/analytics/touchline_analytics/physics/__main__.py`:

```python
"""python -m touchline_analytics.physics fit [--root data/raw/idsse] [--out data/params/physics.json] [--params data/params/touchline-params.json]"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

from .build import GuardError, build, write


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(prog="python -m touchline_analytics.physics")
    sub = ap.add_subparsers(dest="cmd", required=True)
    f = sub.add_parser("fit", help="fit the physics constants on IDSSE and write physics.json")
    f.add_argument("--root", default="data/raw/idsse")
    f.add_argument("--cache", default="out/physics/cache")
    f.add_argument("--out", default="data/params/physics.json")
    f.add_argument("--params", default="data/params/touchline-params.json", help="the engine's parameter file; its physics block is replaced")
    a = ap.parse_args(argv)
    result = build(Path(a.root), Path(a.cache))
    try:
        write(result, Path(a.out), Path(a.params))
    except GuardError as err:
        print(f"error: {err}", file=sys.stderr)
        return 1
    print(f"wrote {a.out} and the physics block of {a.params}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
```

Create `python/analytics/touchline_analytics/physics/build.py`:

```python
"""Run the physics fit on IDSSE and write data/params/physics.json (and the engine's copy in touchline-params.json).

Usage:
  uv run --project python/analytics python -m touchline_analytics.physics fit      # or: pnpm physics:fit

Five matches are fitted and two held out. The file holds every constant with its 95 % interval, unit,
sample size and source; the reject counts; the inter-match envelope of every validation statistic; the
real distributions (pooled, aggregates only); and the held-out results (ball statistics of replays and
the replay ratio). Constants outside their physical range stop the fit before anything is written.
"""

from __future__ import annotations

import datetime as dt
import json
import random
import subprocess
from dataclasses import replace
from pathlib import Path

import numpy as np

from ..idsse import MATCHES, PROVENANCE, filenames
from .ballmodel import BallPhysics
from .fit_ball import bounce_kinematics, fit_drag, fit_friction, fit_restitution, fit_rolling
from .fit_players import GROUPS, braking_cap, clean_track, group_of, lateral_cap, player_motion, reaction_delays, sprint_profiles
from .load import kick_events, load_match, player_positions
from .segment import segment_half
from .stats import Constant, bootstrap_ci
from .validate import BALL_EDGES, PLAYER_EDGES, ball_metrics, envelope, player_metrics, replay, replay_span, resample_10hz, w1

FIT_MATCHES = ["J03WMX", "J03WN1", "J03WOH", "J03WOY", "J03WPY"]
HELD_OUT = ["J03WQQ", "J03WR9"]
MIN_BOUNCES = 100
MAX_E_CI = 0.1  # a restitution known no better than this falls back to the certified value
LITERATURE_E = 0.62
REPLAY_SPANS = 200
REPLAY_MIN_FRAMES = 25
REPLAY_RATIO = 1.5
PERCENTILES = (10, 25, 50, 75, 90)

# Physical ranges: a fitted constant outside its range stops the fit (spec: docs/superpowers/specs/2026-10-09-physics-fit-design.md).
GUARDS: dict[str, tuple[float, float]] = {
    "ball.drag": (0.005, 0.03),
    "ball.restitution": (0.4, 0.85),
    "ball.bounce_friction": (0.1, 1.2),
    "ball.skid_friction": (0.1, 1.2),
    "ball.roll_c0": (0.0, 3.0),
    "ball.roll_c1": (0.0, 1.0),
    "ball.ramp_m": (4.0, 8.0),
    **{f"players.a0.{g}": (5.0, 11.0) for g in GROUPS},
    **{f"players.s0.{g}": (7.5, 11.0) for g in GROUPS if g != "GK"},
    "players.s0.GK": (6.0, 11.0),  # keepers rarely sprint: their fitted top speed is lower
    "players.braking": (4.0, 12.0),
    "players.lateral": (1.0, 10.0),
    "players.reaction": (0.1, 0.6),
}


class GuardError(ValueError):
    pass


def _value(fit: dict, path: str) -> float:
    node = fit
    for part in path.split("."):
        node = node[part]
    if isinstance(node, dict):
        return float(node["p50"] if "p50" in node else node["value"])
    return float(node)


def check_guards(fit: dict) -> None:
    bad = []
    for path, (lo, hi) in GUARDS.items():
        v = _value(fit, path)
        if not (lo <= v <= hi):
            bad.append(f"{path} = {v:.4g} outside {lo:g}..{hi:g}")
    if bad:
        raise GuardError("physics fit out of physical range: " + "; ".join(bad))


def restitution_or_fallback(e: Constant) -> Constant:
    """Too few clean bounces, or too wide an interval, to trust: the certified centre value, marked as from the literature."""
    if e.n < MIN_BOUNCES or not (e.hi - e.lo <= MAX_E_CI):
        return Constant(LITERATURE_E, LITERATURE_E, LITERATURE_E, e.n, "literature")
    return e


def engine_block(fit: dict) -> dict:
    b, p = fit["ball"], fit["players"]
    r = lambda v: round(float(v), 4)  # noqa: E731
    return {
        "ball": {"drag": r(b["drag"]["value"]), "restitution": r(b["restitution"]["value"]), "bounceFriction": r(b["bounce_friction"]["value"]),
                 "skidFriction": r(b["skid_friction"]["value"]), "rollC0": r(b["roll_c0"]["value"]), "rollC1": r(b["roll_c1"]["value"])},
        "players": {
            "a0": {g: [r(p["a0"][g][f"p{q}"]) for q in PERCENTILES] for g in GROUPS},
            "s0": {g: [r(p["s0"][g][f"p{q}"]) for q in PERCENTILES] for g in GROUPS},
            "brake": r(p["braking"]["value"]),
            "lateral": r(p["lateral"]["value"]),
            "reactionS": r(p["reaction"]["value"]),
        },
    }


def sync_params(path: Path, engine: dict) -> None:
    """Replace the `physics` block of the engine's parameter file, keeping everything else as it is."""
    params = json.loads(path.read_text())
    params["physics"] = engine
    path.write_text(json.dumps(params, indent=1) + "\n")


def write(result: dict, out: Path, params: Path) -> None:
    check_guards(result["fit"])
    engine = engine_block(result["fit"])
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps({**result, "engine": engine}, indent=1) + "\n")
    sync_params(params, engine)


def _pct(values: list[float]) -> dict:
    v = np.asarray(values, dtype=float)
    out = {f"p{q}": round(float(np.percentile(v, q)), 4) for q in PERCENTILES} if len(v) else {f"p{q}": float("nan") for q in PERCENTILES}
    return {**out, "n": int(len(v))}


def _player_tracks(halves, positions) -> dict:
    """Player id -> (group, both halves at 10 Hz, a missing frame between them)."""
    tracks = {}
    for pid in sorted({p for h in halves for p in h.players}):
        g = group_of(positions.get(pid, ""))
        if g is None:
            continue
        parts = []
        for h in halves:
            if pid in h.players:
                parts += [resample_10hz(clean_track(h.players[pid])[0]), np.full((1, 2), np.nan)]
        tracks[pid] = (g, np.vstack(parts))
    return tracks


def _mean_hist(hs: list[list[float]]) -> list[float]:
    return [round(float(x), 6) for x in np.mean(np.array(hs), axis=0)]


def _code_version() -> str:
    try:
        return subprocess.run(["git", "rev-parse", "--short", "HEAD"], capture_output=True, text=True, check=True).stdout.strip()
    except (OSError, subprocess.CalledProcessError):
        return "unknown"


def build(root: Path, cache: Path, log=print) -> dict:
    data = {}
    for mid in MATCHES:
        f = filenames(mid)
        halves = load_match(root / f["tracking"], cache / f"{mid}.npz")
        events = kick_events(root / f["event"])
        segs = [segment_half(h, events) for h in halves]
        data[mid] = (halves, segs, player_positions(root / f["meta"]))
        log(f"{mid}: {sum(len(s.spans) for s in segs)} free-ball spans")
    fit_segs = [s for mid in FIT_MATCHES for s in data[mid][1]]
    rejects = {"ball_speed": sum(s.rejects["ball_speed"] for s in fit_segs)}

    drag = fit_drag([p for s in fit_segs for p in s.flights])
    rejects["flight_rmse"] = drag.rejected
    kins = bounce_kinematics(fit_segs, drag.k.value)
    e = restitution_or_fallback(fit_restitution(kins))
    mu = fit_friction(kins, e.value)
    roll = fit_rolling(fit_segs, drag.k.value)
    log(f"ball: k {drag.k.value:.4f}, e {e.value:.3f} ({e.n} bounces), mu {mu.value:.3f}, mu_s {roll.mu_s.value:.3f}, c0 {roll.c0.value:.3f}, c1 {roll.c1.value:.3f}")

    profiles, jumps = sprint_profiles([data[m][0] for m in FIT_MATCHES], [data[m][2] for m in FIT_MATCHES])
    rejects["player_jumps"] = jumps
    tracks = [player_motion(clean_track(xy)[0]) for m in FIT_MATCHES for h in data[m][0] for xy in h.players.values()]
    brake, lateral = braking_cap(tracks), lateral_cap(tracks)
    a0_all = float(np.median([p.a0 for p in profiles]))
    taus = [t for m in FIT_MATCHES for h, s in zip(data[m][0], data[m][1]) for t in reaction_delays(h, s, a0_all)]
    reaction = bootstrap_ci(taus)
    log(f"players: {len(profiles)} profiles, A0 {a0_all:.2f}, brake {brake.value:.2f}, lateral {lateral.value:.2f}, reaction {reaction.value:.3f} s")

    fit = {
        "ball": {
            "drag": drag.k.to_json("1/m", 5),
            "drag_by_speed": {b: c.to_json("1/m", 5) for b, c in drag.by_speed.items()},
            "restitution": e.to_json(""),
            "bounce_friction": mu.to_json(""),
            "skid_friction": roll.mu_s.to_json(""),
            "roll_c0": roll.c0.to_json("m/s^2"),
            "roll_c1": roll.c1.to_json("1/s"),
            "ramp_m": round(roll.ramp_m, 3),
        },
        "players": {
            "a0": {g: _pct([p.a0 for p in profiles if p.group == g]) for g in GROUPS},
            "s0": {g: _pct([p.s0 for p in profiles if p.group == g]) for g in GROUPS},
            "vmax": {g: _pct([p.vmax for p in profiles if p.group == g]) for g in GROUPS},
            "braking": brake.to_json("m/s^2"),
            "lateral": lateral.to_json("m/s^2"),
            "reaction": {**reaction.to_json("s"), "iqr": [round(float(np.percentile(taus, 25)), 4), round(float(np.percentile(taus, 75)), 4)]},
        },
    }
    check_guards(fit)

    # Validation: every statistic on every real match, the envelope, and the held-out replays.
    per_match_players = {mid: player_metrics(_player_tracks(data[mid][0], data[mid][2])) for mid in MATCHES}
    spans = {mid: [h.ball[sp.start:sp.end] for h, s in zip(data[mid][0], data[mid][1]) for sp in s.spans] for mid in MATCHES}
    per_match_ball = {mid: ball_metrics(spans[mid]) for mid in MATCHES}
    env = {**envelope(list(per_match_players.values()), PLAYER_EDGES), **envelope(list(per_match_ball.values()), BALL_EDGES)}
    model = replace(BallPhysics(), k=drag.k.value, e=e.value, mu=mu.value, mu_s=roll.mu_s.value, c0=roll.c0.value, c1=roll.c1.value)
    held_real = [p for mid in HELD_OUT for p in spans[mid]]
    real_hist = ball_metrics(held_real)
    sim_hist = ball_metrics([replay(p, model) for p in held_real])
    held_ball = {}
    for k, edges in BALL_EDGES.items():
        if k in env:
            d = w1(sim_hist[k], real_hist[k], edges)
            held_ball[k] = {"w1": round(d, 6), "envelope_max": env[k]["max"], "pass": d <= env[k]["max"]}
    long_spans = [p for p in held_real if len(p) >= REPLAY_MIN_FRAMES]
    random.Random(0).shuffle(long_spans)
    reps = [replay_span(p, model) for p in long_spans[:REPLAY_SPANS]]
    ratios = [r.ratio for r in reps]
    replay_result = {
        "spans": len(reps),
        "median_ratio": round(float(np.median(ratios)), 4),
        "share_within": round(float(np.mean([x <= REPLAY_RATIO for x in ratios])), 4),
        "median_rmse_m": round(float(np.median([r.rmse for r in reps])), 4),
        "median_floor_m": round(float(np.median([r.floor for r in reps])), 4),
        "threshold": REPLAY_RATIO,
        "pass": float(np.median(ratios)) <= REPLAY_RATIO,
    }
    log(f"held-out: ball statistics {sum(v['pass'] for v in held_ball.values())}/{len(held_ball)} inside the envelope; replay median ratio {replay_result['median_ratio']}")

    return {
        "provenance": {
            **PROVENANCE,
            "fitted_at": dt.date.today().isoformat(),
            "version": f"physics-{dt.date.today().isoformat()}",
            "code_version": _code_version(),
            "fit_matches": FIT_MATCHES,
            "held_out": HELD_OUT,
            "method": "python/analytics/touchline_analytics/physics (spec docs/superpowers/specs/2026-10-09-physics-fit-design.md)",
        },
        "fit": fit,
        "rejects": rejects,
        "validation": {
            "envelope": env,
            "real": {
                "players": {k: _mean_hist([m[k] for m in per_match_players.values()]) for k in PLAYER_EDGES},
                "ball": {k: _mean_hist([m[k] for m in per_match_ball.values()]) for k in BALL_EDGES},
            },
            "edges": {"players": PLAYER_EDGES, "ball": BALL_EDGES},
            "held_out": {"ball": held_ball, "replay": replay_result},
        },
    }
```

Apply this change to `package.json` (from the repository root):

```bash
git apply <<'PATCH'
diff --git a/package.json b/package.json
index 0c4160e..5bca701 100644
--- a/package.json
+++ b/package.json
@@ -12,6 +12,7 @@
     "league": "pnpm --filter @touchline/league run generate",
     "calibrate": "pnpm --filter @touchline/calibrate run calibrate",
     "realism": "pnpm --filter @touchline/calibrate run realism",
+    "physics:fit": "uv run --locked --project python/analytics python -m touchline_analytics.physics fit",
     "stats": "pnpm --filter @touchline/stats run stats",
     "mcp-stats": "pnpm --filter @touchline/mcp-stats run serve",
     "agents": "pnpm --filter @touchline/agent-gateway run agents",
PATCH
```

- [ ] **Step 4: Run the fit**

Run: `pnpm physics:fit` (about 15 minutes; `--root` if the IDSSE files are elsewhere)
Expected: the log ends with
```
ball: k 0.0153, e 0.747 (171 bounces), mu 0.241, mu_s 0.350, c0 0.551, c1 0.109
players: 156 profiles, A0 8.56, brake 6.17, lateral 3.80, reaction 0.203 s
held-out: ball statistics 7/7 inside the envelope; replay median ratio 1.0903
wrote data/params/physics.json and the physics block of data/params/touchline-params.json
```
and `git diff --stat data/params/touchline-params.json` shows only the new `physics` block (and two numbers Python writes as `4e-05`, `1.2e-05`: same values).

- [ ] **Step 5: Run the tests**

Run: `uv run --locked --project python/analytics pytest -q python/analytics/tests/test_physics_build.py`
Expected: `12 passed`

Run: `uv run --locked --project python/analytics pytest -q python/analytics/tests`
Expected: all pass

- [ ] **Step 6: Commit**

```bash
git add data/params/physics.json data/params/touchline-params.json package.json python/analytics
git commit -m "feat(analytics): pnpm physics:fit — the physics fit on IDSSE (five matches fitted, two held out) with range guards, the envelope and held-out validation; data/params/physics.json and the engine's physics block

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: Fitted ball physics in the engine (switched off)

A line-for-line port of the reference ball model into `ball.ts`, behind `physics.enabled` (false until Task 12, so nothing moves yet). `stepBall` now takes the whole `Params` (it needs `physics.ball` and `ball.gravity`/`substeps`); `BallState` gains an optional `spin`. Ground passes are solved for their arrival speed with the skid included. A parity test runs both models on six launches to 9 decimals.

**Files:**
- Modify: `packages/sim-core/src/ball.ts`, `params.ts` (block `physics.ball`, flag `physics.enabled`), `types.ts` (`BallState.spin`), `resolve.ts`, `step.ts` (`stepBall(b, dt, p)`)
- Test: `packages/sim-core/test/ball-parity.test.ts` (new), `physics.test.ts`, `resolve-shot.test.ts`

**Interfaces:**
- Consumes: `python -m touchline_analytics.physics.ballmodel` (Task 2).
- Produces: `BALL_RADIUS`, `bounce(vt, vn, w, b)`, `stepBall(ball, dt, p: Params)`, `rollDistance(v0, vEnd, b)`, `groundDistance(v0, vEnd, b, g)`, `groundLaunchSpeed(distance, arriveSpeed, p)`, `carryDistance(speed, deg, p: Params)`; `Params["physics"] = { enabled, ball: { drag, restitution, bounceFriction, skidFriction, rollC0, rollC1 } }`.

- [ ] **Step 1: Write the failing tests**

Create `packages/sim-core/test/ball-parity.test.ts`:

```ts
import { execFileSync, spawnSync } from "node:child_process"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "vitest"
import { stepBall } from "../src/ball.js"
import { DEFAULT_PARAMS, type Params } from "../src/params.js"
import type { BallState } from "../src/types.js"

/** The fitted physics switched on (its defaults are the literature values). */
const P: Params = { ...DEFAULT_PARAMS, physics: { ...DEFAULT_PARAMS.physics, enabled: true } }

const root = join(dirname(fileURLToPath(import.meta.url)), "../../..")
const hasUv = spawnSync("uv", ["--version"]).status === 0

type Case = { state: number[]; duration: number; physics: Record<string, number> }
const CASES: Case[] = [
  { state: [0, 0, 0, 15, 2, 9, 0], duration: 6, physics: {} }, // a lofted pass: flight, bounces, skid, roll
  { state: [0, 0, 0, 12, 0, 0, 0], duration: 8, physics: { mu_s: 0.37, c0: 0.48, c1: 0.13 } }, // a ground pass, struck without spin
  { state: [0, 0, 0, 3.2, 0, 0, 3.2 / 0.11], duration: 6, physics: {} }, // rolling off the FIFA ramp
  { state: [0, 0, 0.3, 14, 0, -2, 0], duration: 3, physics: { e: 0.6, mu: 0.25 } }, // a low, fast landing that slides
  { state: [0, 0, 2, 6, 0, 0, -40], duration: 3, physics: { e: 0.74, mu: 0.23, k: 0.015 } }, // backspin into a bounce
  { state: [5, -3, 0, 22, -4, 14, 0], duration: 6, physics: { k: 0.02, e: 0.7, mu: 0.3, mu_s: 0.35, c0: 0.6, c1: 0.2 } }
]
const NAMES: Record<string, keyof Params["physics"]["ball"]> = { k: "drag", e: "restitution", mu: "bounceFriction", mu_s: "skidFriction", c0: "rollC0", c1: "rollC1" }

describe("ball parity with the Python reference", () => {
  // In CI the test must run: a missing uv fails it rather than skipping it.
  it.skipIf(!hasUv && !process.env.CI)("stepBall and touchline_analytics.physics.ballmodel give the same trajectories", () => {
    const py = JSON.parse(
      execFileSync("uv", ["run", "--locked", "--project", join(root, "python/analytics"), "python", "-m", "touchline_analytics.physics.ballmodel"], { input: JSON.stringify(CASES), encoding: "utf8" })
    ) as number[][][]
    CASES.forEach((c, i) => {
      const ball = { ...P.physics.ball }
      for (const [k, v] of Object.entries(c.physics)) (ball as Record<string, number>)[NAMES[k]!] = v
      const p: Params = { ...P, physics: { ...P.physics, ball } }
      const [x, y, z, vx, vy, vz, w] = c.state as [number, number, number, number, number, number, number]
      let b: BallState = { pos: { x, y, z }, vel: { x: vx, y: vy, z: vz }, spin: w }
      for (let k = 1; k * 0.1 <= c.duration + 1e-9; k++) {
        b = stepBall(b, 0.1, p)
        const row = py[i]![k * 4]! // the reference records every 0.025 s substep
        const got = [b.pos.x, b.pos.y, b.pos.z, b.vel.x, b.vel.y, b.vel.z, b.spin ?? 0]
        got.forEach((v, j) => expect(v, `case ${i}, t ${row[0]}, column ${j}`).toBeCloseTo(row[j + 1]!, 9))
      }
    })
  })
})
```

Apply this change to `packages/sim-core/test/physics.test.ts`, `packages/sim-core/test/resolve-shot.test.ts` (from the repository root):

```bash
git apply <<'PATCH'
diff --git a/packages/sim-core/test/physics.test.ts b/packages/sim-core/test/physics.test.ts
index 00f53bc..d8043c7 100644
--- a/packages/sim-core/test/physics.test.ts
+++ b/packages/sim-core/test/physics.test.ts
@@ -1,30 +1,71 @@
 import { describe, expect, it } from "vitest"
-import { carryDistance, launchVelocity, stepBall } from "../src/ball.js"
+import { BALL_RADIUS, bounce, carryDistance, groundDistance, groundLaunchSpeed, launchVelocity, rollDistance, stepBall } from "../src/ball.js"
 import { arrive, interceptPoint } from "../src/kinematics.js"
-import { DEFAULT_PARAMS as P } from "../src/params.js"
+import { DEFAULT_PARAMS, type Params } from "../src/params.js"
 import type { BallState } from "../src/types.js"
 
-const roll = (b: BallState, s: number): BallState => { let x = b; for (let i = 0; i < s / 0.1; i++) x = stepBall(x, 0.1, P.ball); return x }
+/** The fitted physics switched on (its defaults are the literature values). */
+const P: Params = { ...DEFAULT_PARAMS, physics: { ...DEFAULT_PARAMS.physics, enabled: true } }
+
+const roll = (b: BallState, s: number, p: Params = P): BallState => { let x = b; for (let i = 0; i < s / 0.1; i++) x = stepBall(x, 0.1, p); return x }
+const withBall = (o: Partial<Params["physics"]["ball"]>): Params => ({ ...P, physics: { ...P.physics, ball: { ...P.physics.ball, ...o } } })
 
 describe("ball", () => {
-  it("a ground pass slows and stops", () => {
+  it("a ground pass skids, then rolls, and stops", () => {
+    const first = stepBall({ pos: { x: 0, y: 0, z: 0 }, vel: { x: 12, y: 0, z: 0 } }, 0.1, { ...P, ball: { ...P.ball, substeps: 1 } })
+    const b = P.physics.ball
+    expect((12 - first.vel.x) / 0.1).toBeCloseTo(b.skidFriction * 9.81 + b.rollC0 + b.rollC1 * 12 + b.drag * 144, 6)
     const end = roll({ pos: { x: 0, y: 0, z: 0 }, vel: { x: 12, y: 0, z: 0 } }, 20)
     expect(Math.hypot(end.vel.x, end.vel.y)).toBe(0)
-    expect(end.pos.x).toBeGreaterThan(20)
-    expect(end.pos.x).toBeLessThan(45)
+    expect(end.pos.x).toBeCloseTo(groundDistance(12, 0, b, 9.81), -0.5) // within ~1.5 m; the engine steps with explicit Euler
+  })
+  it("a ball leaving the FIFA ramp rolling at 3.2 m/s stops within the Pro band (4-8 m)", () => {
+    const end = roll({ pos: { x: 0, y: 0, z: 0 }, vel: { x: 3.2, y: 0, z: 0 }, spin: 3.2 / BALL_RADIUS }, 10)
+    expect(end.pos.x).toBeGreaterThan(4)
+    expect(end.pos.x).toBeLessThan(8)
+    expect(rollDistance(3.2, 0, P.physics.ball)).toBeCloseTo(end.pos.x, 0)
+  })
+  it("the FIFA angle test (50 km/h at 15 degrees, no spin) on dry turf (friction 1.0) keeps about 60 %, the top of the 45-60 % band", () => {
+    // A gripping hollow ball keeps 0.6 of its horizontal speed: the rigid-body model sits at the band's upper edge.
+    const v = 50 / 3.6
+    const th = (15 * Math.PI) / 180
+    const out = bounce(v * Math.cos(th), v * Math.sin(th), 0, withBall({ bounceFriction: 1.0 }).physics.ball)
+    const kept = Math.hypot(out.vt, out.vz) / v
+    expect(kept).toBeGreaterThan(0.45)
+    expect(kept).toBeLessThan(0.61)
+  })
+  it("a gripping bounce leaves rolling at 0.6 vt + 0.4 R w; a sliding one loses mu (1 + e) vn", () => {
+    const grip = bounce(8, 6, 0, P.physics.ball)
+    expect(grip.vt).toBeCloseTo(4.8, 12)
+    expect(grip.w).toBeCloseTo(4.8 / BALL_RADIUS, 9)
+    const slide = bounce(12, 4, 0, withBall({ restitution: 0.6, bounceFriction: 0.25 }).physics.ball)
+    expect(slide.vt).toBeCloseTo(12 - 0.25 * 1.6 * 4, 12)
+    expect(slide.vz).toBeCloseTo(2.4, 12)
+  })
+  it("ground passes arrive at the speed they were struck for", () => {
+    for (const [d, arrive] of [[10, 6], [25, 4], [3, 9]] as const) {
+      const v0 = groundLaunchSpeed(d, arrive, P)
+      expect(groundDistance(v0, arrive, P.physics.ball, 9.81)).toBeCloseTo(d, 6)
+    }
   })
   it("a lofted ball first lands at its target (within 1 m)", () => {
     for (const d of [25, 40, 55]) {
       const v = launchVelocity({ x: 0, y: 0 }, { x: d, y: 0 }, "high", P)
       const s = Math.hypot(v.x, v.z)
-      expect(Math.abs(carryDistance(s, P.pass.highLaunchDeg, P.ball) - d)).toBeLessThan(1)
+      expect(Math.abs(carryDistance(s, P.pass.highLaunchDeg, P) - d)).toBeLessThan(1)
     }
   })
-  it("bounces lose height", () => {
+  it("bounces lose height by the square of the restitution", () => {
     let b: BallState = { pos: { x: 0, y: 0, z: 5 }, vel: { x: 0, y: 0, z: 0 } }
     let peak = 0, landed = false
-    for (let i = 0; i < 60; i++) { b = stepBall(b, 0.1, P.ball); if (b.pos.z === 0) landed = true; if (landed) peak = Math.max(peak, b.pos.z) }
-    expect(peak).toBeLessThan(5 * P.ball.bounce)
+    for (let i = 0; i < 60; i++) {
+      b = stepBall(b, 0.1, P)
+      if (b.vel.z > 0) landed = true // moving up again: it has bounced
+      if (landed) peak = Math.max(peak, b.pos.z)
+      if (landed && b.vel.z < 0) break // only the first rebound
+    }
+    expect(peak).toBeLessThan(5 * P.physics.ball.restitution ** 2 * 1.05)
+    expect(peak).toBeGreaterThan(5 * P.physics.ball.restitution ** 2 * 0.8)
   })
 })
 
diff --git a/packages/sim-core/test/resolve-shot.test.ts b/packages/sim-core/test/resolve-shot.test.ts
index 0b2e375..d42daf4 100644
--- a/packages/sim-core/test/resolve-shot.test.ts
+++ b/packages/sim-core/test/resolve-shot.test.ts
@@ -122,7 +122,7 @@ describe("goal line and parries — review fixes", () => {
       let b = parryBall("home", saveAt, "parried_safe", r)
       for (let k = 0; k < 60; k++) {
         const prev = b
-        b = stepBall(b, 0.1, P.ball)
+        b = stepBall(b, 0.1, P)
         const c = goalLineCrossing(prev.pos, b.pos)
         if (c) { expect(c.inGoal).toBe(false); break }
       }
PATCH
```

- [ ] **Step 2: Run them to make sure they fail**

Run: `pnpm --filter @touchline/sim-core test physics ball-parity`
Expected: 8 tests FAIL (`physics` is not in `DEFAULT_PARAMS`; `bounce`, `groundDistance`, `rollDistance` are not exported)

- [ ] **Step 3: Write the implementation**

Apply this change to `packages/sim-core/src/ball.ts`, `packages/sim-core/src/params.ts`, `packages/sim-core/src/resolve.ts`, `packages/sim-core/src/step.ts`, `packages/sim-core/src/types.ts` (from the repository root):

```bash
git apply <<'PATCH'
diff --git a/packages/sim-core/src/ball.ts b/packages/sim-core/src/ball.ts
index 9338178..a3baa62 100644
--- a/packages/sim-core/src/ball.ts
+++ b/packages/sim-core/src/ball.ts
@@ -2,10 +2,44 @@ import type { Vec2, Vec3 } from "./geometry.js"
 import type { Params } from "./params.js"
 import type { BallState } from "./types.js"
 
-type BallParams = Params["ball"]
+/**
+ * Ball physics, fitted on real tracking (data/params/physics.json; spec docs/superpowers/specs/2026-10-09-physics-fit-design.md).
+ * A line-for-line port of python/analytics/touchline_analytics/physics/ballmodel.py; test/ball-parity.test.ts runs both.
+ *
+ * - In the air: gravity and quadratic drag, explicit Euler per substep.
+ * - Bounce (Brody / Cross, hollow ball): the normal speed becomes e * vn (0 below REST_VZ). The contact point slips at
+ *   vt - R w; friction either stops the slip during the impact (the ball leaves rolling at 0.6 vt + 0.4 R w) or acts
+ *   throughout (it loses mu (1 + e) vn of horizontal speed and gains 1.5 mu (1 + e) vn / R of spin).
+ * - On the ground: rolling resistance c0 + c1 v plus drag. While the ball skids (v != R w, as after a kick or a sliding
+ *   bounce) friction adds mu_s g and spins it up at 1.5 mu_s g / R until it rolls. Kicks leave the foot without spin.
+ *
+ * Only +, -, *, / and square roots in the step: replays must be bit-identical in every JavaScript engine.
+ */
 
-/** Advance the ball by dt seconds: gravity, quadratic drag, bounce and rolling friction. */
-export const stepBall = (ball: BallState, dt: number, p: BallParams): BallState => {
+export const BALL_RADIUS = 0.11
+const REST_VZ = 0.4
+const SLIP_EPS = 1e-9
+const SIMPSON_N = 16
+const SKID_N = 64
+
+type Physics = Params["physics"]["ball"]
+
+/** Horizontal speed, vertical speed and spin after landing with horizontal speed vt and downward speed vn. */
+export const bounce = (vt: number, vn: number, w: number, b: Physics): { vt: number; vz: number; w: number } => {
+  let vz = b.restitution * vn
+  if (vz < REST_VZ) vz = 0
+  const slip = vt - BALL_RADIUS * w
+  const impulse = b.bounceFriction * (1 + b.restitution) * vn
+  if (2.5 * impulse >= Math.abs(slip)) {
+    const vt2 = 0.6 * vt + 0.4 * BALL_RADIUS * w
+    return { vt: vt2, vz, w: vt2 / BALL_RADIUS }
+  }
+  const sign = slip > 0 ? 1 : -1
+  return { vt: vt - sign * impulse, vz, w: w + (sign * 1.5 * impulse) / BALL_RADIUS }
+}
+
+/** Before the fitted physics: drag, a fixed bounce keeping 85 % of horizontal speed, constant rolling deceleration. */
+const legacyStepBall = (ball: BallState, dt: number, p: Params["ball"]): BallState => {
   let { x, y, z } = ball.pos
   let { x: vx, y: vy, z: vz } = ball.vel
   const h = dt / p.substeps
@@ -44,16 +78,140 @@ export const stepBall = (ball: BallState, dt: number, p: BallParams): BallState
   return { pos: { x, y, z }, vel: { x: vx, y: vy, z: vz } }
 }
 
-/** Ground pass speed that arrives at `arriveSpeed` after `distance` metres of rolling (drag ignored). */
-export const groundLaunchSpeed = (distance: number, arriveSpeed: number, p: BallParams): number =>
-  Math.sqrt(arriveSpeed * arriveSpeed + 2 * (p.rollDecel + 1.2) * Math.max(0, distance))
+/** Advance the ball by dt seconds in p.ball.substeps substeps. */
+export const stepBall = (ball: BallState, dt: number, p: Params): BallState => {
+  if (!p.physics.enabled) return legacyStepBall(ball, dt, p.ball)
+  const b = p.physics.ball
+  const g = p.ball.gravity
+  let { x, y, z } = ball.pos
+  let { x: vx, y: vy, z: vz } = ball.vel
+  let w = ball.spin ?? 0
+  const h = dt / p.ball.substeps
+  for (let i = 0; i < p.ball.substeps; i++) {
+    if (z > 1e-6 || vz > 1e-6) {
+      const speed = Math.sqrt(vx * vx + vy * vy + vz * vz)
+      const kk = b.drag * speed * h
+      vx -= kk * vx
+      vy -= kk * vy
+      vz -= kk * vz + g * h
+      x += vx * h
+      y += vy * h
+      z += vz * h
+      if (z <= 0) {
+        z = 0
+        const vt = Math.sqrt(vx * vx + vy * vy)
+        const out = bounce(vt, -vz, w, b)
+        vz = out.vz
+        w = out.w
+        if (vt > 0) {
+          const f = out.vt / vt
+          vx *= f
+          vy *= f
+        }
+      }
+      continue
+    }
+    z = 0
+    vz = 0
+    const speed = Math.sqrt(vx * vx + vy * vy)
+    if (speed > 0) {
+      let dec = b.rollC0 + b.rollC1 * speed + b.drag * speed * speed
+      const slip = speed - BALL_RADIUS * w
+      const spin = ((1.5 * b.skidFriction * g) / BALL_RADIUS) * h
+      if (slip > SLIP_EPS) {
+        dec += b.skidFriction * g
+        w += spin
+      } else if (slip < -SLIP_EPS) {
+        dec -= b.skidFriction * g
+        w -= spin
+      }
+      const next = Math.max(0, speed - dec * h)
+      if (Math.abs(slip) <= SLIP_EPS || slip > 0 !== next - BALL_RADIUS * w > 0) w = next / BALL_RADIUS
+      const f = next / speed
+      vx *= f
+      vy *= f
+      x += vx * h
+      y += vy * h
+    }
+  }
+  return { pos: { x, y, z }, vel: { x: vx, y: vy, z: vz }, spin: w }
+}
+
+const rollDecel = (v: number, b: Physics): number => b.rollC0 + b.rollC1 * v + b.drag * v * v
+
+/** Distance a rolling (not skidding) ball covers while slowing from v0 to vEnd (Simpson's rule). */
+export const rollDistance = (v0: number, vEnd: number, b: Physics): number => {
+  if (v0 <= vEnd) return 0
+  const hh = (v0 - vEnd) / SIMPSON_N
+  let total = 0
+  for (let i = 0; i <= SIMPSON_N; i++) {
+    const v = vEnd + i * hh
+    const wgt = i === 0 || i === SIMPSON_N ? 1 : i % 2 ? 4 : 2
+    total += (wgt * v) / rollDecel(v, b)
+  }
+  return (total * hh) / 3
+}
+
+/** Distance a ground pass struck at v0 without spin covers before slowing to vEnd: skid, then roll. */
+export const groundDistance = (v0: number, vEnd: number, b: Physics, g: number): number => {
+  if (v0 <= vEnd) return 0
+  const fric = b.skidFriction * g
+  const dv = v0 / SKID_N
+  let t = 0
+  let d = 0
+  let v = v0
+  let a = fric + rollDecel(v, b)
+  for (let i = 0; i < SKID_N; i++) {
+    const v2 = v - dv
+    const a2 = fric + rollDecel(v2, b)
+    const dt = 0.5 * dv * (1 / a + 1 / a2)
+    const g1 = v - 1.5 * fric * t
+    const g2 = v2 - 1.5 * fric * (t + dt)
+    const stop = vEnd > v2 ? vEnd : v2
+    if (g2 <= 0 || stop > v2) {
+      const fSlip = g2 <= 0 ? g1 / (g1 - g2) : 1
+      const fStop = (v - stop) / dv
+      const f = Math.min(fSlip, fStop)
+      const vf = v - f * dv
+      d += 0.5 * f * dv * (v / a + vf / (fric + rollDecel(vf, b)))
+      return fStop <= fSlip ? d : d + rollDistance(vf, vEnd, b)
+    }
+    d += 0.5 * dv * (v / a + v2 / a2)
+    t += dt
+    v = v2
+    a = a2
+  }
+  return d
+}
+
+/** Speed of a ground pass (struck without spin) that arrives at `arriveSpeed` after `distance` metres (fixed secant steps). */
+export const groundLaunchSpeed = (distance: number, arriveSpeed: number, p: Params): number => {
+  if (!p.physics.enabled) return Math.sqrt(arriveSpeed * arriveSpeed + 2 * (p.ball.rollDecel + 1.2) * Math.max(0, distance))
+  const b = p.physics.ball
+  const g = p.ball.gravity
+  if (distance <= 0) return arriveSpeed
+  let lo = Math.sqrt(arriveSpeed * arriveSpeed + 2 * rollDecel(arriveSpeed, b) * distance)
+  let hi = Math.sqrt(arriveSpeed * arriveSpeed + 2 * (b.skidFriction * g + rollDecel(arriveSpeed, b)) * distance) + 0.5
+  let fLo = groundDistance(lo, arriveSpeed, b, g) - distance
+  let fHi = groundDistance(hi, arriveSpeed, b, g) - distance
+  for (let i = 0; i < 8; i++) {
+    if (fHi === fLo) break
+    const mid = hi - (fHi * (hi - lo)) / (fHi - fLo)
+    lo = hi
+    fLo = fHi
+    hi = mid
+    fHi = groundDistance(mid, arriveSpeed, b, g) - distance
+  }
+  return hi
+}
 
 /** Horizontal distance at which a ball launched at `speed` and `deg` first touches the ground. */
-export const carryDistance = (speed: number, deg: number, p: BallParams): number => {
+export const carryDistance = (speed: number, deg: number, p: Params): number => {
   const th = (deg * Math.PI) / 180
+  const one = { ...p, ball: { ...p.ball, substeps: 1 } }
   let b: BallState = { pos: { x: 0, y: 0, z: 0 }, vel: { x: speed * Math.cos(th), y: 0, z: speed * Math.sin(th) } }
   for (let k = 0; k < 400; k++) {
-    const next = stepBall(b, 0.02, { ...p, substeps: 1 })
+    const next = stepBall(b, 0.02, one)
     if (next.pos.z <= 0 && k > 0) return next.pos.x
     b = next
   }
@@ -61,19 +219,14 @@ export const carryDistance = (speed: number, deg: number, p: BallParams): number
 }
 
 /** Launch velocity for a ball from `from` towards `to`. Lofted balls are solved so they first land on `to`. */
-export const launchVelocity = (
-  from: Vec2,
-  to: Vec2,
-  height: "ground" | "low" | "high",
-  p: Params
-): Vec3 => {
+export const launchVelocity = (from: Vec2, to: Vec2, height: "ground" | "low" | "high", p: Params): Vec3 => {
   const dx = to.x - from.x
   const dy = to.y - from.y
   const d = Math.max(0.5, Math.hypot(dx, dy))
   const ux = dx / d
   const uy = dy / d
   if (height === "ground") {
-    const s = groundLaunchSpeed(d, p.pass.arriveSpeed, p.ball)
+    const s = groundLaunchSpeed(d, p.pass.arriveSpeed, p)
     return { x: ux * s, y: uy * s, z: 0 }
   }
   const deg = height === "high" ? p.pass.highLaunchDeg : 12
@@ -81,7 +234,7 @@ export const launchVelocity = (
   let hi = 45
   for (let i = 0; i < 14; i++) {
     const mid = (lo + hi) / 2
-    if (carryDistance(mid, deg, p.ball) < d) lo = mid
+    if (carryDistance(mid, deg, p) < d) lo = mid
     else hi = mid
   }
   const s = (lo + hi) / 2
diff --git a/packages/sim-core/src/params.ts b/packages/sim-core/src/params.ts
index c37f8c1..c5f8c75 100644
--- a/packages/sim-core/src/params.ts
+++ b/packages/sim-core/src/params.ts
@@ -53,12 +53,34 @@ export interface Params {
     readonly headerHeightM: number
   }
   readonly ball: {
+    /** Before the fitted physics (physics.enabled false): quadratic drag, constant rolling deceleration, restitution. */
     readonly drag: number
     readonly rollDecel: number
     readonly bounce: number
     readonly gravity: number
     readonly substeps: number
   }
+  /**
+   * Physics constants measured on real tracking: data/params/physics.json, copied into the parameter file by
+   * `pnpm physics:fit`. The defaults are literature values (spec docs/superpowers/specs/2026-10-09-physics-fit-design.md).
+   */
+  readonly physics: {
+    /** Off until the recalibration switches it on, so the engine's output (and the realism baseline) stays put meanwhile. */
+    readonly enabled: boolean
+    readonly ball: {
+      /** Quadratic drag per metre (a = -drag |v| v). */
+      readonly drag: number
+      /** Normal coefficient of restitution at a bounce. */
+      readonly restitution: number
+      /** Ball-grass friction during a bounce. */
+      readonly bounceFriction: number
+      /** Ball-grass friction while a ball skids along the ground. */
+      readonly skidFriction: number
+      /** Rolling resistance rollC0 + rollC1 v (m/s^2). */
+      readonly rollC0: number
+      readonly rollC1: number
+    }
+  }
   readonly timing: {
     readonly decisionMinS: number
     readonly decisionMaxS: number
@@ -250,6 +272,10 @@ export const DEFAULT_PARAMS: Params = {
   },
   kinematics: { vmaxBase: 9.2, accelMax: 4.5, reactionS: 0.7, reachM: 1.0, reachMargin: 0.75, controlHeightM: 1.0, headerHeightM: 2.4 },
   ball: { drag: 0.013, rollDecel: 1.2, bounce: 0.55, gravity: 9.81, substeps: 4 },
+  physics: {
+    enabled: false,
+    ball: { drag: 0.013, restitution: 0.62, bounceFriction: 0.6, skidFriction: 0.3, rollC0: 0.5, rollC1: 0.15 }
+  },
   timing: {
     decisionMinS: 0.9,
     decisionMaxS: 2.2,
@@ -394,7 +420,7 @@ const SIGNED = [/^actions\.logits\./, /^pass\.xpass\./, /^shot\.xg\./, /^shot\.s
 /** Probabilities and shares, which must lie in 0..1. */
 const PROBABILITIES = new Set([
   "support.speedShare", "marking.weight",
-  "kinematics.reachMargin", "ball.bounce", "execution.mishitBase", "movement.shapeSpeedShare",
+  "kinematics.reachMargin", "ball.bounce", "physics.ball.restitution", "execution.mishitBase", "movement.shapeSpeedShare",
   "shot.onTargetRate", "shot.blockPerDefender", "shot.blockPressure", "shot.blockBehind",
   "defending.foulPerTackle", "defending.yellowPerFoul", "defending.redPerFoul", "defending.tackleLooseShare", "defending.interceptLooseShare",
   "defending.crossBlock", "defending.crossBlockBehind", "defending.headClearShare", "defending.headBehind", "defending.clearToTouch", "defending.clearSliceBehind",
diff --git a/packages/sim-core/src/resolve.ts b/packages/sim-core/src/resolve.ts
index d3d6d51..c941797 100644
--- a/packages/sim-core/src/resolve.ts
+++ b/packages/sim-core/src/resolve.ts
@@ -61,7 +61,7 @@ export const resolveFlight = (
   let b = start
   for (let k = 1; k <= maxTicks; k++) {
     const prev = b
-    b = stepBall(b, dt, p.ball)
+    b = stepBall(b, dt, p)
     const cross = goalLineCrossing(prev.pos, b.pos)
     if (cross?.inGoal) return { ticks: k, winnerId: null, result: "goal", ball: { pos: { x: cross.x, y: cross.y, z: cross.z }, vel: b.vel }, aerial: null }
     if (!inPitch({ x: b.pos.x, y: b.pos.y })) return { ticks: k, winnerId: null, result: "out", ball: b, aerial: null }
diff --git a/packages/sim-core/src/step.ts b/packages/sim-core/src/step.ts
index 09a17e2..0fb6f46 100644
--- a/packages/sim-core/src/step.ts
+++ b/packages/sim-core/src/step.ts
@@ -927,13 +927,13 @@ const ballTick = (w: Work): void => {
       const prev = w.ball.pos
       const next: Vec3 = { x: lerp(f.path.from.x, f.path.to.x), y: lerp(f.path.from.y, f.path.to.y), z: lerp(f.path.from.z, f.path.to.z) }
       w.ball = { pos: next, vel: { x: (next.x - prev.x) / w.dt, y: (next.y - prev.y) / w.dt, z: (next.z - prev.z) / w.dt } }
-    } else w.ball = stepBall(w.ball, w.dt, w.p.ball)
+    } else w.ball = stepBall(w.ball, w.dt, w.p)
     if (w.tick >= f.resolveTick) resolveFlightNow(w, f)
     return
   }
   // loose
   const prevPos = w.ball.pos
-  w.ball = stepBall(w.ball, w.dt, w.p.ball)
+  w.ball = stepBall(w.ball, w.dt, w.p)
   const flat = { x: w.ball.pos.x, y: w.ball.pos.y }
   const cross = goalLineCrossing(prevPos, w.ball.pos)
   if (cross?.inGoal) {
diff --git a/packages/sim-core/src/types.ts b/packages/sim-core/src/types.ts
index fd8fbd5..7f15419 100644
--- a/packages/sim-core/src/types.ts
+++ b/packages/sim-core/src/types.ts
@@ -105,6 +105,8 @@ export interface PlayerState {
 export interface BallState {
   readonly pos: Vec3
   readonly vel: Vec3
+  /** Spin about the horizontal axis across the ball's path (rad/s, topspin positive); absent means none. */
+  readonly spin?: number
 }
 
 export type ActionKind = "pass" | "shot" | "clearance" | "deflection"
PATCH
```

- [ ] **Step 4: Run the tests**

Run: `pnpm --filter @touchline/sim-core test physics ball-parity`
Expected: `10 passed`

Run: `pnpm --filter @touchline/sim-core test`
Expected: all pass (the engine's output is unchanged: physics is off)

Run: `pnpm typecheck`
Expected: all tasks successful

- [ ] **Step 5: Commit**

```bash
git add packages/sim-core
git commit -m "feat(sim-core): fitted ball physics behind physics.enabled — Brody/Cross bounce with spin, skid then roll on the ground, ground passes solved for their arrival speed; parity with the Python reference

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 9: Fitted player movement in the engine (switched off)

The acceleration-speed law with separate braking and lateral caps (`steer`), an `approach` that brakes in whole steps so it does not overshoot, and per-player A0 and S0 from the acceleration and pace attributes placed among the league's own percentiles, onto the fitted spread for the player's position group. Top speed loses at most 3 % when tired. `vmaxFor` takes the player (it needs the role). Behind `physics.enabled`; the old `arrive`/`arriveBy` stay until Task 12.

**Files:**
- Modify: `packages/sim-core/src/kinematics.ts`, `params.ts` (`physics.players`), `step.ts`, `resolve.ts`, `deflect.ts` (`vmaxFor(player, energy, p)`)
- Test: `packages/sim-core/test/movement.test.ts` (new), `resolve-shot.test.ts`

**Interfaces:**
- Produces: `Group`, `GROUP_OF: Record<Role, Group>`, `Motion { a0, s0, brake, lateral }`, `throughKnots(x, knots, values)`, `motionFor({attrs, role}, p)`, `vmaxFor({attrs, role}, energy, p)`, `steer(vel, desired, m, dt)`, `approach(pos, vel, target, vmax, m, dt)`, `approachBy(pos, vel, target, vmax, m, dt, timeLeft)`; `Params["physics"]["players"] = { a0, s0 (Record<Group, [p10, p25, p50, p75, p90]>), paceKnots, accelerationKnots, brake, lateral, reactionS }` (literature defaults; the league's attribute knots).

- [ ] **Step 1: Write the failing tests**

Create `packages/sim-core/test/movement.test.ts`:

```ts
import { readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "vitest"
import type { Vec2 } from "../src/geometry.js"
import { approach, approachBy, GROUP_OF, motionFor, steer, throughKnots, vmaxFor, type Motion } from "../src/kinematics.js"
import { DEFAULT_PARAMS, type Params } from "../src/params.js"
import type { PlayerAttrs, Role } from "../src/types.js"

const P: Params = { ...DEFAULT_PARAMS, physics: { ...DEFAULT_PARAMS.physics, enabled: true } }
const root = join(dirname(fileURLToPath(import.meta.url)), "../../..")
const attrs = (pace: number, acceleration: number): PlayerAttrs =>
  ({ pace, acceleration, shortPassing: 0.5, longPassing: 0.5, vision: 0.5, crossing: 0.5, dribbling: 0.5, finishing: 0.5, heading: 0.5, tackling: 0.5, composure: 0.5, stamina: 0.5, handling: 0.5, reflexes: 0.5 })
const median = (role: Role = "CM") => ({ attrs: attrs(P.physics.players.paceKnots[2]!, P.physics.players.accelerationKnots[2]!), role })
const M: Motion = { a0: 8.5, s0: 9.3, brake: 7, lateral: 6 }
const speed = (v: Vec2) => Math.hypot(v.x, v.y)

describe("player movement", () => {
  it("a standing start covers 5 m in 1.2-1.4 s", () => {
    let s = { pos: { x: 0, y: 0 }, vel: { x: 0, y: 0 } }
    let t = 0
    while (s.pos.x < 5) {
      s = approach(s.pos, s.vel, { x: 60, y: 0 }, 9.3, M, 0.1)
      t += 0.1
    }
    expect(t).toBeGreaterThanOrEqual(1.2)
    expect(t).toBeLessThanOrEqual(1.4)
  })

  it("a player at 8 m/s stops in 0.9-1.2 s", () => {
    let vel = { x: 8, y: 0 }
    let t = 0
    while (speed(vel) > 0.05) {
      vel = steer(vel, { x: 0, y: 0 }, M, 0.1)
      t += 0.1
    }
    expect(t).toBeGreaterThanOrEqual(0.9)
    expect(t).toBeLessThanOrEqual(1.2 + 1e-9)
  })

  it("never accelerates, brakes or turns harder than the caps allow", () => {
    const cases: Array<[Vec2, Vec2]> = [[{ x: 0, y: 0 }, { x: 9, y: 0 }], [{ x: 6, y: 0 }, { x: 0, y: 9 }], [{ x: 8, y: 0 }, { x: -8, y: 0 }], [{ x: 3, y: 1 }, { x: 4, y: -4 }]]
    for (const [vel, desired] of cases) {
      const next = steer(vel, desired, M, 0.1)
      const dv = { x: next.x - vel.x, y: next.y - vel.y }
      const sp = speed(vel)
      const fwd = M.a0 * (1 - sp / M.s0)
      expect(speed(dv)).toBeLessThanOrEqual(Math.max(M.a0, M.brake) * 0.1 + 1e-9)
      if (sp > 0) {
        const along = (dv.x * vel.x + dv.y * vel.y) / sp
        const across = Math.abs(dv.y * vel.x - dv.x * vel.y) / sp
        expect(along).toBeLessThanOrEqual(fwd * 0.1 + 1e-9)
        expect(along).toBeGreaterThanOrEqual(-M.brake * 0.1 - 1e-9)
        expect(across).toBeLessThanOrEqual(Math.max(M.lateral, fwd) * 0.1 + 1e-9)
      }
    }
  })

  it("approach stops at the target without overshooting", () => {
    let s = { pos: { x: 0, y: 0 }, vel: { x: 0, y: 0 } }
    let maxX = 0
    for (let i = 0; i < 80; i++) {
      s = approach(s.pos, s.vel, { x: 20, y: 0 }, 9, M, 0.1)
      maxX = Math.max(maxX, s.pos.x)
    }
    expect(maxX).toBeLessThan(20.3)
    expect(Math.abs(s.pos.x - 20)).toBeLessThan(0.3)
    expect(speed(s.vel)).toBeLessThan(0.5)
  })

  it("approachBy meets a ball on time when it can", () => {
    let s = { pos: { x: 0, y: 0 }, vel: { x: 0, y: 0 } }
    for (let k = 20; k > 0; k--) s = approachBy(s.pos, s.vel, { x: 10, y: 0 }, 9, M, 0.1, k * 0.1)
    expect(Math.abs(s.pos.x - 10)).toBeLessThan(0.5)
  })

  it("maps attributes onto the fitted percentiles of the player's position group", () => {
    const pl = P.physics.players
    const mid = motionFor(median("CM"), P)
    expect(mid.a0).toBeCloseTo(pl.a0.MID[2]!, 12)
    expect(mid.s0).toBeCloseTo(pl.s0.MID[2]!, 12)
    expect(motionFor({ attrs: attrs(0, 0), role: "ST" }, P).s0).toBe(pl.s0.FWD[0])
    expect(motionFor({ attrs: attrs(1, 1), role: "GK" }, P).a0).toBe(pl.a0.GK[4])
    expect(GROUP_OF.FB).toBe("DEF")
    expect(throughKnots(0.5, [0, 1], [10, 20])).toBe(15)
  })

  it("the attribute knots are the league's 10/25/50/75/90th percentiles", () => {
    const league = JSON.parse(readFileSync(join(root, "data/league/league.json"), "utf8")) as { clubs: Array<{ squad: Array<{ attrs: PlayerAttrs }> }> }
    const all = league.clubs.flatMap((c) => c.squad.map((x) => x.attrs))
    for (const [k, knots] of [["pace", P.physics.players.paceKnots], ["acceleration", P.physics.players.accelerationKnots]] as const) {
      const v = all.map((a) => a[k]).sort((a, b) => a - b)
      ;[0.1, 0.25, 0.5, 0.75, 0.9].forEach((q, i) => expect(Math.abs(v[Math.floor(v.length * q)]! - knots[i]!), k).toBeLessThan(0.01))
    }
  })

  it("top speed drops only to 97 % when a player is exhausted", () => {
    const pl = median("CM")
    expect(vmaxFor(pl, 0, P) / vmaxFor(pl, 1, P)).toBeCloseTo(0.97, 12)
    expect(vmaxFor(pl, 1, P)).toBeCloseTo(motionFor(pl, P).s0, 12)
  })

  it("with the fitted physics off, top speed is the old formula", () => {
    const pl = median("CM")
    const k = DEFAULT_PARAMS.kinematics
    expect(vmaxFor(pl, 0.5, DEFAULT_PARAMS)).toBeCloseTo(k.vmaxBase * (0.86 + 0.14 * pl.attrs.pace) * 0.95, 12)
  })
})
```

Apply this change to `packages/sim-core/test/resolve-shot.test.ts` (from the repository root):

```bash
git apply <<'PATCH'
diff --git a/packages/sim-core/test/resolve-shot.test.ts b/packages/sim-core/test/resolve-shot.test.ts
index d42daf4..82a591e 100644
--- a/packages/sim-core/test/resolve-shot.test.ts
+++ b/packages/sim-core/test/resolve-shot.test.ts
@@ -101,7 +101,7 @@ describe("resolveFlight — review fixes", () => {
       if (res.result !== "reached" || !res.winnerId) continue
       let w = players.find((p) => p.id === res.winnerId)!
       let s = { pos: w.pos, vel: w.vel }
-      for (let k = 0; k < res.ticks; k++) s = arriveBy(s.pos, s.vel, { x: res.ball.pos.x, y: res.ball.pos.y }, vmaxFor(w.attrs, w.energy, P), accelFor(w.attrs, P), 0.1, (res.ticks - k) * 0.1)
+      for (let k = 0; k < res.ticks; k++) s = arriveBy(s.pos, s.vel, { x: res.ball.pos.x, y: res.ball.pos.y }, vmaxFor(w, w.energy, P), accelFor(w.attrs, P), 0.1, (res.ticks - k) * 0.1)
       expect(Math.hypot(s.pos.x - res.ball.pos.x, s.pos.y - res.ball.pos.y)).toBeLessThanOrEqual(1.5)
       checked++
     }
PATCH
```

- [ ] **Step 2: Run them to make sure they fail**

Run: `pnpm --filter @touchline/sim-core test movement`
Expected: 9 tests FAIL (`Cannot read properties of undefined (reading 'paceKnots')`; `approach`, `steer` are not exported)

- [ ] **Step 3: Write the implementation**

Apply this change to `packages/sim-core/src/deflect.ts`, `packages/sim-core/src/kinematics.ts`, `packages/sim-core/src/params.ts`, `packages/sim-core/src/resolve.ts`, `packages/sim-core/src/step.ts` (from the repository root):

```bash
git apply <<'PATCH'
diff --git a/packages/sim-core/src/deflect.ts b/packages/sim-core/src/deflect.ts
index a8dfadc..6c264c1 100644
--- a/packages/sim-core/src/deflect.ts
+++ b/packages/sim-core/src/deflect.ts
@@ -51,7 +51,7 @@ export const keeperCanCome = (keeper: PlayerState, at: Vec3, t: number, p: Param
   const k = p.keeper
   if (!inOwnBox(keeper.side, at)) return false
   if (PITCH.halfL + attackX(keeper.side, at.x) > k.claimDepthM) return false
-  const reach = Math.min(k.claimRangeM, p.kinematics.reachM + 0.8 * vmaxFor(keeper.attrs, keeper.energy, p) * t)
+  const reach = Math.min(k.claimRangeM, p.kinematics.reachM + 0.8 * vmaxFor(keeper, keeper.energy, p) * t)
   return dist(keeper.pos, at) <= reach
 }
 
diff --git a/packages/sim-core/src/kinematics.ts b/packages/sim-core/src/kinematics.ts
index 77f92bd..14df0c3 100644
--- a/packages/sim-core/src/kinematics.ts
+++ b/packages/sim-core/src/kinematics.ts
@@ -1,9 +1,88 @@
 import { add, len, norm, scale, sub, type Vec2 } from "./geometry.js"
 import type { Params } from "./params.js"
-import type { PlayerAttrs } from "./types.js"
+import type { PlayerAttrs, Role } from "./types.js"
 
-export const vmaxFor = (a: PlayerAttrs, energy: number, p: Params): number =>
-  p.kinematics.vmaxBase * (0.86 + 0.14 * a.pace) * (0.9 + 0.1 * energy)
+type Mover = { readonly attrs: PlayerAttrs; readonly role: Role }
+
+export type Group = "GK" | "DEF" | "MID" | "FWD"
+export const GROUP_OF: Readonly<Record<Role, Group>> = { GK: "GK", CB: "DEF", FB: "DEF", DM: "MID", CM: "MID", AM: "MID", W: "FWD", ST: "FWD" }
+
+/** A player's movement limits: the acceleration-speed line A0 (1 - v / S0), the braking cap and the cap across the run. */
+export interface Motion {
+  readonly a0: number
+  readonly s0: number
+  readonly brake: number
+  readonly lateral: number
+}
+
+/** Piecewise-linear through (knots[i], values[i]); flat beyond the ends. */
+export const throughKnots = (x: number, knots: ReadonlyArray<number>, values: ReadonlyArray<number>): number => {
+  if (x <= knots[0]!) return values[0]!
+  for (let i = 1; i < knots.length; i++)
+    if (x <= knots[i]!) return values[i - 1]! + ((x - knots[i - 1]!) / (knots[i]! - knots[i - 1]!)) * (values[i]! - values[i - 1]!)
+  return values[values.length - 1]!
+}
+
+/** A player's limits: acceleration and pace attributes placed among the league's, onto the fitted spread for their position. */
+export const motionFor = (pl: Mover, p: Params): Motion => {
+  const m = p.physics.players
+  const g = GROUP_OF[pl.role]
+  return { a0: throughKnots(pl.attrs.acceleration, m.accelerationKnots, m.a0[g]), s0: throughKnots(pl.attrs.pace, m.paceKnots, m.s0[g]), brake: m.brake, lateral: m.lateral }
+}
+
+/** Top speed; tiredness takes off at most 3 % (top speed barely drops through a real match). */
+export const vmaxFor = (pl: Mover, energy: number, p: Params): number =>
+  p.physics.enabled
+    ? motionFor(pl, p).s0 * (0.97 + 0.03 * energy)
+    : p.kinematics.vmaxBase * (0.86 + 0.14 * pl.attrs.pace) * (0.9 + 0.1 * energy)
+
+/**
+ * One step of velocity towards `desired` within a player's limits: along the run, speeding up by at most
+ * A0 (1 - v / S0) dt and slowing by at most brake dt; across it, at most max(lateral, A0 (1 - v / S0)) dt; the whole
+ * change within a disc of max(A0, brake) dt. From a standstill every direction is forward.
+ */
+export const steer = (vel: Vec2, desired: Vec2, m: Motion, dt: number): Vec2 => {
+  const dv = sub(desired, vel)
+  const sp = len(vel)
+  const fwd = Math.max(0, m.a0 * (1 - sp / m.s0))
+  let change: Vec2
+  if (sp < 1e-6) {
+    const cap = m.a0 * dt
+    change = len(dv) > cap ? scale(norm(dv), cap) : dv
+  } else {
+    const u = scale(vel, 1 / sp)
+    const along = dv.x * u.x + dv.y * u.y
+    const across = sub(dv, scale(u, along))
+    const a = along > 0 ? Math.min(along, fwd * dt) : Math.max(along, -m.brake * dt)
+    const latCap = Math.max(m.lateral, fwd) * dt
+    const l = len(across)
+    change = add(scale(u, a), l > latCap ? scale(across, latCap / l) : across)
+  }
+  const disc = Math.max(m.a0, m.brake) * dt
+  const c = len(change)
+  return add(vel, c > disc ? scale(change, disc / c) : change)
+}
+
+/**
+ * Head for `target` and stop there: the desired speed is the fastest the braking cap can still stop from within the
+ * distance left, counted in whole steps (v^2 / 2B + v dt / 2 = d), so the player does not overshoot.
+ */
+export const approach = (pos: Vec2, vel: Vec2, target: Vec2, vmax: number, m: Motion, dt: number): { pos: Vec2; vel: Vec2 } => {
+  const to = sub(target, pos)
+  const d = len(to)
+  const half = (m.brake * dt) / 2
+  const want = d < 0.05 ? 0 : Math.min(vmax, Math.sqrt(half * half + 2 * m.brake * d) - half)
+  const nv = steer(vel, scale(norm(to), want), m, dt)
+  return { pos: add(pos, scale(nv, dt)), vel: nv }
+}
+
+/** Meet a ball at a known time: aim for the velocity that arrives as `timeLeft` runs out, within the same limits. */
+export const approachBy = (pos: Vec2, vel: Vec2, target: Vec2, vmax: number, m: Motion, dt: number, timeLeft: number): { pos: Vec2; vel: Vec2 } => {
+  let desired = scale(sub(target, pos), 1 / Math.max(dt, timeLeft))
+  if (len(desired) > vmax) desired = scale(norm(desired), vmax)
+  const nv = steer(vel, desired, m, dt)
+  return { pos: add(pos, scale(nv, dt)), vel: nv }
+}
 
 /** Energy after `dt` seconds at `speed` m/s for a player with the given stamina attribute (never below 0). */
 export const drainEnergy = (energy: number, speed: number, stamina: number, dt: number, p: Params): number => {
@@ -11,6 +90,7 @@ export const drainEnergy = (energy: number, speed: number, stamina: number, dt:
   return Math.max(0, energy - dt * (f.drainBase + f.drainSpeed2 * speed * speed) * (1 + f.staminaSlope * (0.5 - stamina)))
 }
 
+/** Before the fitted physics: one acceleration cap for speeding up, slowing down and turning. */
 export const accelFor = (a: PlayerAttrs, p: Params): number => p.kinematics.accelMax * (0.8 + 0.2 * a.acceleration)
 
 /**
diff --git a/packages/sim-core/src/params.ts b/packages/sim-core/src/params.ts
index c5f8c75..de6d873 100644
--- a/packages/sim-core/src/params.ts
+++ b/packages/sim-core/src/params.ts
@@ -80,6 +80,19 @@ export interface Params {
       readonly rollC0: number
       readonly rollC1: number
     }
+    readonly players: {
+      /** Acceleration-speed line a = A0 (1 - v / S0) by position group: the 10/25/50/75/90th percentiles of A0 and S0. */
+      readonly a0: Readonly<Record<"GK" | "DEF" | "MID" | "FWD", readonly [number, number, number, number, number]>>
+      readonly s0: Readonly<Record<"GK" | "DEF" | "MID" | "FWD", readonly [number, number, number, number, number]>>
+      /** The league's 10/25/50/75/90th percentiles of the pace and acceleration attributes, mapped onto those of S0 and A0. */
+      readonly paceKnots: readonly [number, number, number, number, number]
+      readonly accelerationKnots: readonly [number, number, number, number, number]
+      /** Braking cap and cap across the direction of running (m/s^2). */
+      readonly brake: number
+      readonly lateral: number
+      /** Delay before a player who is not the intended receiver starts to respond to a kick (s). */
+      readonly reactionS: number
+    }
   }
   readonly timing: {
     readonly decisionMinS: number
@@ -274,7 +287,16 @@ export const DEFAULT_PARAMS: Params = {
   ball: { drag: 0.013, rollDecel: 1.2, bounce: 0.55, gravity: 9.81, substeps: 4 },
   physics: {
     enabled: false,
-    ball: { drag: 0.013, restitution: 0.62, bounceFriction: 0.6, skidFriction: 0.3, rollC0: 0.5, rollC1: 0.15 }
+    ball: { drag: 0.013, restitution: 0.62, bounceFriction: 0.6, skidFriction: 0.3, rollC0: 0.5, rollC1: 0.15 },
+    players: {
+      a0: { GK: [7.6, 8, 8.5, 9, 9.4], DEF: [7.6, 8, 8.5, 9, 9.4], MID: [7.6, 8, 8.5, 9, 9.4], FWD: [7.6, 8, 8.5, 9, 9.4] },
+      s0: { GK: [8.4, 8.8, 9.3, 9.6, 10], DEF: [8.4, 8.8, 9.3, 9.6, 10], MID: [8.4, 8.8, 9.3, 9.6, 10], FWD: [8.4, 8.8, 9.3, 9.6, 10] },
+      paceKnots: [0.43, 0.52, 0.59, 0.66, 0.77],
+      accelerationKnots: [0.48, 0.52, 0.57, 0.61, 0.65],
+      brake: 7,
+      lateral: 6,
+      reactionS: 0.3
+    }
   },
   timing: {
     decisionMinS: 0.9,
diff --git a/packages/sim-core/src/resolve.ts b/packages/sim-core/src/resolve.ts
index c941797..5a4479c 100644
--- a/packages/sim-core/src/resolve.ts
+++ b/packages/sim-core/src/resolve.ts
@@ -80,7 +80,7 @@ export const resolveFlight = (
       // can be anywhere within ~½·a·t² (capped by top speed) of pos + vel·t. arriveBy() steers to match.
       const tc = (k - 1 + f) * dt
       const reaction = pl.id === intendedId ? 0 : p.kinematics.reactionS
-      const vmax = vmaxFor(pl.attrs, pl.energy, p)
+      const vmax = vmaxFor(pl, pl.energy, p)
       const drift = { x: pl.pos.x + pl.vel.x * tc, y: pl.pos.y + pl.vel.y * tc }
       const radius = p.kinematics.reachM + p.kinematics.reachMargin * reachIn(tc - reaction, 0, vmax, accelFor(pl.attrs, p))
       const fromDrift = Math.hypot(contact.x - drift.x, contact.y - drift.y)
diff --git a/packages/sim-core/src/step.ts b/packages/sim-core/src/step.ts
index 0fb6f46..d0e462d 100644
--- a/packages/sim-core/src/step.ts
+++ b/packages/sim-core/src/step.ts
@@ -22,7 +22,7 @@ import {
   type Vec3
 } from "./geometry.js"
 import { assignMarks, markTarget, shieldTarget, steerCarry, supportSpot } from "./offball.js"
-import { accelFor, arrive, arriveBy, drainEnergy, interceptPoint, separation, vmaxFor } from "./kinematics.js"
+import { accelFor, approach, approachBy, arrive, arriveBy, drainEnergy, interceptPoint, motionFor, separation, vmaxFor } from "./kinematics.js"
 import type { Action } from "./params.js"
 import { goalLineCrossing, keeperLetsRun, MAX_FLIGHT_S, resolveFlight } from "./resolve.js"
 import { hazard, Rng, substream } from "./rng.js"
@@ -983,7 +983,7 @@ const moveTarget = (
   marks: ReadonlyMap<string, Vec2> | null
 ): { target: Vec2; speedCap: number; timeLeft?: number } => {
   const team = teamOf(w.cfg, pl.side)
-  const vmax = vmaxFor(pl.attrs, pl.energy, w.p)
+  const vmax = vmaxFor(pl, pl.energy, w.p)
   const shape = () => ({ target: anchorFor(team.formation, pl.slot, pl.side, ballFlat, team.style, possSide === pl.side, w.p.shape), speedCap: vmax * w.p.movement.shapeSpeedShare })
   const ph = w.phase
   if (ph.kind === "restart") {
@@ -1092,14 +1092,20 @@ const moveAll = (w: Work): void => {
     if (pl.sentOff) continue
     const { target, speedCap, timeLeft } = moveTarget(w, pl, ballFlat, possSide, marks)
     const cur = w.player(id)
-    const vmax = Math.min(speedCap, vmaxFor(cur.attrs, cur.energy, w.p))
+    const vmax = Math.min(speedCap, vmaxFor(cur, cur.energy, w.p))
     const mates = w.active(cur.side).filter((x) => x.id !== cur.id).map((x) => x.pos)
     const sep = separation(cur.pos, mates)
     // Chasing a ball that will arrive at a known tick uses on-time steering (matches resolveFlight's reach model).
+    const m = w.p.physics.enabled ? motionFor(cur, w.p) : null
+    const v = Math.max(0.5, vmax)
     const next =
       timeLeft !== undefined
-        ? arriveBy(cur.pos, cur.vel, target, Math.max(0.5, vmax), accelFor(cur.attrs, w.p), w.dt, timeLeft)
-        : arrive(cur.pos, cur.vel, add(target, scale(sep, 2)), Math.max(0.5, vmax), accelFor(cur.attrs, w.p), w.dt)
+        ? m
+          ? approachBy(cur.pos, cur.vel, target, v, m, w.dt, timeLeft)
+          : arriveBy(cur.pos, cur.vel, target, v, accelFor(cur.attrs, w.p), w.dt, timeLeft)
+        : m
+          ? approach(cur.pos, cur.vel, add(target, scale(sep, 2)), v, m, w.dt)
+          : arrive(cur.pos, cur.vel, add(target, scale(sep, 2)), v, accelFor(cur.attrs, w.p), w.dt)
     const speed = len(next.vel)
     const energy = drainEnergy(cur.energy, speed, cur.attrs.stamina, w.dt, w.p)
     w.setPlayer({ ...cur, pos: clampToPitch(next.pos, -2), vel: next.vel, energy })
PATCH
```

- [ ] **Step 4: Run the tests**

Run: `pnpm --filter @touchline/sim-core test movement`
Expected: `9 passed`

Run: `pnpm --filter @touchline/sim-core test`
Expected: all pass

Run: `pnpm typecheck`
Expected: all tasks successful

- [ ] **Step 5: Commit**

```bash
git add packages/sim-core
git commit -m "feat(sim-core): fitted player movement behind physics.enabled — acceleration-speed law, braking and lateral caps, per-player A0 and S0 from attributes through the league's percentiles, top speed down at most 3 % when tired

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 10: Player movement statistics and the physics gate in TypeScript

A port of the player half of `validate.py` to `packages/calibrate`, so the tuner and the gate can measure simulated matches: histograms, W1, the statistics, simulated tracks from 10 Hz frames (a missing sample between the halves), and `physicsGate`, each statistic's W1 to the real matches against the real envelope. Run folders do not record roles, so the parity test hands the same tracks to Python as JSON (`python -m touchline_analytics.physics.validate TRACKS.json`).

**Files:**
- Create: `packages/calibrate/src/physics.ts`; Modify: `packages/calibrate/src/index.ts`
- Modify: `python/analytics/touchline_analytics/physics/validate.py` (the JSON command)
- Test: `packages/calibrate/test/physics.test.ts`

**Interfaces:**
- Consumes: `GROUP_OF`, `Group` (Task 9); `data/params/physics.json` `validation.envelope`, `validation.real.players` (Task 7).
- Produces: `GROUPS`, `PLAYER_EDGES`, `Point`, `Tracks`, `hist`, `w1`, `playerSamples`, `playerMetrics`, `rolesOf(cfg)`, `simTracks(frames, roles)`, `PhysicsFile`, `GateRow { key, w1, max, pass }`, `physicsGate(sim, physics)`.

- [ ] **Step 1: Write the failing tests**

Create `packages/calibrate/test/physics.test.ts`:

```ts
import { execFileSync, spawnSync } from "node:child_process"
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "vitest"
import type { League } from "@touchline/league"
import { DEFAULT_PARAMS } from "@touchline/sim-core"
import { runMatch } from "../src/evaluate.js"
import { hist, physicsGate, PLAYER_EDGES, playerMetrics, playerSamples, rolesOf, simTracks, w1, type Point, type Tracks } from "../src/physics.js"

const root = join(dirname(fileURLToPath(import.meta.url)), "../../..")
const hasUv = spawnSync("uv", ["--version"]).status === 0

/** 10 Hz track running at each (speed, seconds) in turn along x. */
const run = (legs: ReadonlyArray<readonly [number, number]>): Point[] => {
  const out: Point[] = [[0, 0]]
  let x = 0
  for (const [v, s] of legs) for (let i = 0; i < s * 10; i++) out.push([(x += v * 0.1), 0])
  return out
}

describe("player movement statistics", () => {
  it("W1 is the area between two histograms' CDFs", () => {
    const e = [0, 1, 2, 3]
    expect(w1([1, 0, 0], [1, 0, 0], e)).toBe(0)
    expect(w1([1, 0, 0], [0, 1, 0], e)).toBeCloseTo(1, 12)
    expect(w1([1, 0, 0], [0, 0, 1], e)).toBeCloseTo(2, 12)
    expect(w1([0.5, 0.5, 0], [0, 0.5, 0.5], e)).toBeCloseTo(1, 12)
  })
  it("histograms clip into the end bins", () => {
    expect(hist([-5, 0.5, 1.5, 99], [0, 1, 2])).toEqual([0.5, 0.5])
    expect(hist([], [0, 1, 2])).toEqual([0, 0])
  })
  it("measure speed, high-speed running and efforts, and never across a gap", () => {
    const tracks: Tracks = new Map([
      ["j", { group: "MID", xy: run([[3, 2700]]) }],
      ["r", { group: "FWD", xy: run([[3, 600], [7, 60], [3, 600], [7, 60], [3, 1380]]) }],
      ["g", { group: "DEF", xy: [...run([[3, 2000]]), null, ...run([[3, 2000]]).map((p) => [p![0] + 50, p![1] + 20] as const)] }]
    ])
    const s = playerSamples(tracks)
    expect(s.max_speed![0]).toBeCloseTo(3, 9)
    expect(s.max_speed![1]).toBeCloseTo(7, 9)
    expect(s.max_speed![2]).toBeCloseTo(3, 9)
    expect(s.hsr20![1]).toBeCloseTo(1680, -1)
    expect(s.acc_count![1]).toBeCloseTo(4, 2)
    expect(s.dec_count![1]).toBeCloseTo(4, 2)
    expect(Object.keys(playerMetrics(tracks))).toEqual(Object.keys(PLAYER_EDGES))
  })
  it("the gate compares each statistic with the real matches' envelope", () => {
    const real = Object.fromEntries(Object.entries(PLAYER_EDGES).map(([k, e]) => [k, hist([e[1]!], e)]))
    const sim = { ...real, max_speed: hist([9.6], PLAYER_EDGES.max_speed!) }
    const envelope = Object.fromEntries(Object.keys(PLAYER_EDGES).map((k) => [k, { max: 0.5 }]))
    const rows = physicsGate(sim, { validation: { envelope, real: { players: real } } })
    expect(rows.find((r) => r.key === "max_speed")!.pass).toBe(false)
    expect(rows.filter((r) => r.key !== "max_speed").every((r) => r.pass && r.w1 === 0)).toBe(true)
  })
})

describe("player statistics parity", () => {
  // In CI the test must run: a missing uv fails it rather than skipping it.
  it.skipIf(!hasUv && !process.env.CI)("TypeScript and Python give the same histograms for a simulated match", () => {
    const league = JSON.parse(readFileSync(join(root, "data/league/league.json"), "utf8")) as League
    const cfg = { matchId: "phys-parity", seed: 4243, kickoffTime: "2026-10-18T14:00:00.000Z", home: league.clubs[1]!, away: league.clubs[2]!, params: DEFAULT_PARAMS, dt: 0.1 }
    const tracks = simTracks(runMatch(cfg).frames, rolesOf(cfg))
    expect(tracks.size).toBeGreaterThanOrEqual(22)
    const file = join(mkdtempSync(join(tmpdir(), "touchline-physics-")), "tracks.json")
    writeFileSync(file, JSON.stringify(Object.fromEntries([...tracks].map(([id, t]) => [id, t]))))
    const py = JSON.parse(
      execFileSync("uv", ["run", "--locked", "--project", join(root, "python/analytics"), "python", "-m", "touchline_analytics.physics.validate", file], { encoding: "utf8", maxBuffer: 1 << 26 })
    ) as Record<string, number[]>
    const ts = playerMetrics(tracks)
    // Math.hypot and math.hypot may differ in the last bit, which can move a sample sitting exactly on a bin edge into
    // the neighbouring bin (as in the match-statistics parity test), hence 1e-3.
    for (const k of Object.keys(PLAYER_EDGES)) ts[k]!.forEach((v, i) => expect(v, `${k}[${i}]`).toBeCloseTo(py[k]![i]!, 3))
  })
})
```

- [ ] **Step 2: Run them to make sure they fail**

Run: `pnpm --filter @touchline/calibrate test physics`
Expected: FAIL: cannot find module `../src/physics.js`

- [ ] **Step 3: Write the implementation**

Create `packages/calibrate/src/physics.ts`:

```ts
/**
 * Player movement statistics for the physics gate — a line-for-line port of the player half of
 * python/analytics/touchline_analytics/physics/validate.py (a parity test runs both on the same tracks).
 *
 * Tracks at 10 Hz; speed is the central difference |p[i+1] - p[i-1]| / 0.2 s, only where p[i-1], p[i] and p[i+1] are all
 * present; the change of speed is the central difference of speed averaged over five samples. Per frame by position
 * group: speed and change of speed. Per player with 30 minutes or more: maximum speed, metres per 90 minutes above
 * 20 and 25 km/h, and accelerations and decelerations past 3 m/s^2 per 90 minutes. Each statistic is a histogram on
 * fixed edges; W1 between two histograms is the area between their CDFs. The simulation passes a statistic when its
 * W1 to the real matches is within the largest W1 between two real matches (data/params/physics.json).
 */
import { GROUP_OF, type Frame, type Group, type MatchConfig, type Role } from "@touchline/sim-core"

export const GROUPS: ReadonlyArray<Group> = ["GK", "DEF", "MID", "FWD"]
const DT = 0.1
const MIN_MINUTES = 30
const HSR20 = 20 / 3.6
const HSR25 = 25 / 3.6
const EFFORT = 3

const edges = (lo: number, hi: number, step: number): number[] =>
  Array.from({ length: Math.round((hi - lo) / step) + 1 }, (_, i) => Math.round((lo + i * step) * 1e6) / 1e6)

export const PLAYER_EDGES: Readonly<Record<string, ReadonlyArray<number>>> = {
  ...Object.fromEntries(GROUPS.map((g) => [`speed_${g}`, edges(0, 11, 0.5)])),
  ...Object.fromEntries(GROUPS.map((g) => [`accel_${g}`, edges(-6, 6, 0.5)])),
  max_speed: edges(5, 11, 0.25),
  hsr20: edges(0, 1500, 50),
  hsr25: edges(0, 600, 25),
  acc_count: edges(0, 200, 5),
  dec_count: edges(0, 200, 5)
}

export type Point = readonly [number, number] | null
export type Tracks = ReadonlyMap<string, { readonly group: Group; readonly xy: ReadonlyArray<Point> }>

/** Values outside the edges go in the end bins; shares sum to 1 (all zero without values). */
export const hist = (values: ReadonlyArray<number>, e: ReadonlyArray<number>): number[] => {
  const counts = new Array<number>(e.length - 1).fill(0)
  const last = e[e.length - 1]!
  let n = 0
  for (const raw of values) {
    if (!Number.isFinite(raw)) continue
    const v = Math.min(Math.max(raw, e[0]!), last - 1e-9)
    for (let i = 0; i < e.length - 1; i++)
      if (v < e[i + 1]!) {
        counts[i] = counts[i]! + 1
        break
      }
    n++
  }
  return counts.map((c) => (n ? c / n : 0))
}

/** Wasserstein-1 between two histograms on the same edges, as masses at bin centres. */
export const w1 = (a: ReadonlyArray<number>, b: ReadonlyArray<number>, e: ReadonlyArray<number>): number => {
  let total = 0
  let fa = 0
  let fb = 0
  for (let i = 0; i < e.length - 2; i++) {
    fa += a[i]!
    fb += b[i]!
    total += Math.abs(fa - fb) * ((e[i + 2]! - e[i]!) / 2)
  }
  return total
}

const central = (x: ReadonlyArray<number>): number[] => {
  const out = new Array<number>(x.length).fill(NaN)
  for (let i = 1; i < x.length - 1; i++) if (Number.isFinite(x[i]!)) out[i] = (x[i + 1]! - x[i - 1]!) / (2 * DT)
  return out
}

const mean5 = (x: ReadonlyArray<number>): number[] => {
  const out = new Array<number>(x.length).fill(NaN)
  for (let i = 2; i < x.length - 2; i++) out[i] = (x[i - 2]! + x[i - 1]! + x[i]! + x[i + 1]! + x[i + 2]!) / 5
  return out
}

/** Raw samples of every player statistic. */
export const playerSamples = (tracks: Tracks): Record<string, number[]> => {
  const out: Record<string, number[]> = Object.fromEntries(Object.keys(PLAYER_EDGES).map((k) => [k, []]))
  for (const { group, xy } of tracks.values()) {
    const vx = central(xy.map((p) => (p ? p[0] : NaN)))
    const vy = central(xy.map((p) => (p ? p[1] : NaN)))
    const speed = vx.map((x, i) => Math.hypot(x, vy[i]!))
    const dspeed = central(mean5(speed))
    for (const v of speed) if (Number.isFinite(v)) out[`speed_${group}`]!.push(v)
    for (const v of dspeed) if (Number.isFinite(v)) out[`accel_${group}`]!.push(v)
    const minutes = (xy.filter((p) => p !== null).length * DT) / 60
    if (minutes < MIN_MINUTES) continue
    const per90 = 90 / minutes
    let max = -Infinity
    let h20 = 0
    let h25 = 0
    for (const v of speed) {
      if (!Number.isFinite(v)) continue
      if (v > max) max = v
      if (v > HSR20) h20 += v
      if (v > HSR25) h25 += v
    }
    out.max_speed!.push(max)
    out.hsr20!.push(h20 * DT * per90)
    out.hsr25!.push(h25 * DT * per90)
    const d = dspeed.map((v) => (Number.isFinite(v) ? v : 0))
    let acc = 0
    let dec = 0
    for (let i = 1; i < d.length; i++) {
      if (d[i]! > EFFORT && d[i - 1]! <= EFFORT) acc++
      if (d[i]! < -EFFORT && d[i - 1]! >= -EFFORT) dec++
    }
    out.acc_count!.push(acc * per90)
    out.dec_count!.push(dec * per90)
  }
  return out
}

export const playerMetrics = (tracks: Tracks): Record<string, number[]> => {
  const s = playerSamples(tracks)
  return Object.fromEntries(Object.entries(PLAYER_EDGES).map(([k, e]) => [k, hist(s[k]!, e)]))
}

/** Every player's role, starters and bench of both teams. */
export const rolesOf = (cfg: MatchConfig): Map<string, Role> =>
  new Map([cfg.home, cfg.away].flatMap((t) => [...t.starters, ...(t.bench ?? [])].map((p) => [p.id, p.role] as const)))

/** Every player's track in a simulated match (10 Hz frames), with a missing sample between the halves. */
export const simTracks = (frames: ReadonlyArray<Frame>, roles: ReadonlyMap<string, Role>): Tracks => {
  const ids = [...roles.keys()]
  const xy = new Map<string, Point[]>(ids.map((id) => [id, []]))
  let period: string | null = null
  for (const f of frames) {
    if (period !== null && f.period !== period) for (const id of ids) xy.get(id)!.push(null)
    period = f.period
    const here = new Map<string, Point>([...f.home, ...f.away].map((p) => [p.id, [p.x, p.y] as const]))
    for (const id of ids) xy.get(id)!.push(here.get(id) ?? null)
  }
  return new Map(ids.filter((id) => xy.get(id)!.some((p) => p !== null)).map((id) => [id, { group: GROUP_OF[roles.get(id)!], xy: xy.get(id)! }]))
}

export interface PhysicsFile {
  readonly validation: {
    readonly envelope: Readonly<Record<string, { readonly max: number }>>
    readonly real: { readonly players: Readonly<Record<string, ReadonlyArray<number>>> }
  }
}

export interface GateRow {
  readonly key: string
  readonly w1: number
  readonly max: number
  readonly pass: boolean
}

/** Each player statistic of the simulation against the real matches: W1 within the real inter-match envelope. */
export const physicsGate = (sim: Readonly<Record<string, ReadonlyArray<number>>>, physics: PhysicsFile): GateRow[] =>
  Object.entries(PLAYER_EDGES)
    .filter(([k]) => physics.validation.envelope[k] !== undefined && physics.validation.real.players[k] !== undefined)
    .map(([k, e]) => {
      const d = w1(sim[k]!, physics.validation.real.players[k]!, e)
      const max = physics.validation.envelope[k]!.max
      return { key: k, w1: d, max, pass: d <= max }
    })
```

Apply this change to `packages/calibrate/src/index.ts`, `python/analytics/touchline_analytics/physics/validate.py` (from the repository root):

```bash
git apply <<'PATCH'
diff --git a/packages/calibrate/src/index.ts b/packages/calibrate/src/index.ts
index 1bc7576..b6572a8 100644
--- a/packages/calibrate/src/index.ts
+++ b/packages/calibrate/src/index.ts
@@ -2,4 +2,5 @@ export * from "./evaluate.js"
 export * from "./gate.js"
 export * from "./knobs.js"
 export * from "./metrics.js"
+export * from "./physics.js"
 export * from "./tune.js"
diff --git a/python/analytics/touchline_analytics/physics/validate.py b/python/analytics/touchline_analytics/physics/validate.py
index ef5276a..d6bf9a8 100644
--- a/python/analytics/touchline_analytics/physics/validate.py
+++ b/python/analytics/touchline_analytics/physics/validate.py
@@ -269,3 +269,17 @@ def replay_span(pos: np.ndarray, p: BallPhysics) -> Replay:
     f = least_squares(lambda x: (path(x) - pos).ravel(), x0, bounds=(lo, hi), max_nfev=600)
     floor = min(_rmse(path(f.x), pos), rmse)
     return Replay(_path(th, n, p), rmse, floor, rmse / max(floor, REPLAY_FLOOR_M))
+
+
+def _main() -> None:
+    """Player statistics of tracks given as JSON {id: {group, xy: [[x, y] or null, ...]}} at 10 Hz (parity test)."""
+    import json
+    import sys
+
+    raw = json.loads(open(sys.argv[1]).read())
+    tracks = {pid: (t["group"], np.array([[np.nan, np.nan] if p is None else p for p in t["xy"]], dtype=float)) for pid, t in raw.items()}
+    print(json.dumps(player_metrics(tracks)))
+
+
+if __name__ == "__main__":
+    _main()
PATCH
```

- [ ] **Step 4: Run the tests**

Run: `pnpm --filter @touchline/calibrate test physics`
Expected: `5 passed` (the parity case simulates one match)

Run: `uv run --locked --project python/analytics pytest -q python/analytics/tests`
Expected: all pass

- [ ] **Step 5: Commit**

```bash
git add packages/calibrate python/analytics
git commit -m "feat(calibrate): player movement statistics for the physics gate — a port of the Python definitions with parity on a simulated match, and the gate against the real inter-match envelope

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 11: Work rate by 15-minute period

Ruling 7. For outfielders on the pitch for at least 90 % of every 15-minute period of both halves: metres per minute, and metres per minute above 20 km/h, in each of the six periods, by position group and for all outfielders, and the late-to-early ratio (the last 15 minutes of a half over its first 15, averaged over the halves). Speeds use the same central difference as the other player statistics, never across a gap. The fit writes the real figures of all seven matches into `physics.json` with each match's ratios and their range; `packages/calibrate` ports the measure (parity-tested) for simulated matches. Reported, not gated.

**Files:**
- Modify: `python/analytics/touchline_analytics/physics/validate.py` (`work_rate`, the `--work-rate` JSON command), `build.py` (`real_work_rate`; `validation.real.work_rate`)
- Modify: `packages/calibrate/src/physics.ts` (`workRate`, `simHalves`)
- Modify (generated): `data/params/physics.json`
- Test: `python/analytics/tests/test_physics_validate.py`, `test_physics_build.py`, `packages/calibrate/test/physics.test.ts`

**Interfaces:**
- Consumes: `_central`, `HSR20`, `HZ`, `DT` (Task 6); `clean_track`, `group_of` (Task 5); `resample_10hz` (Task 6); `GROUP_OF` (Task 9); `rolesOf`, `Point` (Task 10).
- Produces: Python `PERIOD_S = 900`, `PERIODS_PER_HALF = 3`, `FULL_SHARE = 0.9`, `OUTFIELD = ("DEF", "MID", "FWD")`, `work_rate(players) -> {players: {G: n}, distance: {G or "ALL": [6]}, hsr: {...}, late_ratio: {distance, hsr}}` with players `{id: (group, [first half, second half] at 10 Hz)}`; `python -m touchline_analytics.physics.validate HALVES.json --work-rate`; `real_work_rate(per_match) -> {players, distance, hsr, late_ratio: {distance|hsr: {mean, min, max}}, per_match}`; `physics.json` `validation.real.work_rate`. TypeScript `Halves`, `WorkRate { players, distance, hsr, lateRatio }`, `workRate(halves)`, `simHalves(frames, roles)`.

- [ ] **Step 1: Write the failing tests**

Apply this change to `packages/calibrate/test/physics.test.ts`, `python/analytics/tests/test_physics_build.py`, `python/analytics/tests/test_physics_validate.py` (from the repository root):

```bash
git apply <<'PATCH'
diff --git a/packages/calibrate/test/physics.test.ts b/packages/calibrate/test/physics.test.ts
index 9478176..7d85e93 100644
--- a/packages/calibrate/test/physics.test.ts
+++ b/packages/calibrate/test/physics.test.ts
@@ -7,7 +7,7 @@ import { describe, expect, it } from "vitest"
 import type { League } from "@touchline/league"
 import { DEFAULT_PARAMS } from "@touchline/sim-core"
 import { runMatch } from "../src/evaluate.js"
-import { hist, physicsGate, PLAYER_EDGES, playerMetrics, playerSamples, rolesOf, simTracks, w1, type Point, type Tracks } from "../src/physics.js"
+import { hist, physicsGate, PLAYER_EDGES, playerMetrics, playerSamples, rolesOf, simHalves, simTracks, w1, workRate, type Point, type Tracks } from "../src/physics.js"
 
 const root = join(dirname(fileURLToPath(import.meta.url)), "../../..")
 const hasUv = spawnSync("uv", ["--version"]).status === 0
@@ -57,6 +57,27 @@ describe("player movement statistics", () => {
   })
 })
 
+describe("work rate by period", () => {
+  const nan = (n: number): Point[] => Array.from({ length: n }, () => null)
+  it("measures metres per minute, and above 20 km/h, per 15 minutes for full-match outfielders", () => {
+    const steady = [run([[2, 2700]]), run([[2, 2700]])]
+    const fades = [0, 1].map(() => run([[6, 900], [2, 900], [1, 900]]))
+    const w = workRate(new Map([
+      ["s", { group: "MID", halves: steady }],
+      ["f", { group: "FWD", halves: fades }],
+      ["gk", { group: "GK", halves: steady }],
+      ["sub", { group: "DEF", halves: [steady[0]!, nan(steady[0]!.length)] }]
+    ]))
+    expect(w.players).toEqual({ DEF: 0, MID: 1, FWD: 1 })
+    w.distance.MID!.forEach((v) => expect(v).toBeCloseTo(120, 0))
+    ;[360, 120, 60, 360, 120, 60].forEach((v, i) => expect(Math.abs(w.distance.FWD![i]! / v - 1)).toBeLessThan(0.01))
+    ;[360, 0, 0, 360, 0, 0].forEach((v, i) => expect(w.hsr.FWD![i]!).toBeCloseTo(v, -1))
+    expect(w.lateRatio.distance).toBeCloseTo(90 / 240, 2)
+    expect(w.lateRatio.hsr).toBe(0)
+    expect(w.distance.DEF).toEqual([])
+  })
+})
+
 describe("player statistics parity", () => {
   // In CI the test must run: a missing uv fails it rather than skipping it.
   it.skipIf(!hasUv && !process.env.CI)("TypeScript and Python give the same histograms for a simulated match", () => {
@@ -73,5 +94,16 @@ describe("player statistics parity", () => {
     // Math.hypot and math.hypot may differ in the last bit, which can move a sample sitting exactly on a bin edge into
     // the neighbouring bin (as in the match-statistics parity test), hence 1e-3.
     for (const k of Object.keys(PLAYER_EDGES)) ts[k]!.forEach((v, i) => expect(v, `${k}[${i}]`).toBeCloseTo(py[k]![i]!, 3))
+    const halves = simHalves(runMatch(cfg).frames, rolesOf(cfg))
+    writeFileSync(file, JSON.stringify(Object.fromEntries(halves)))
+    const pyW = JSON.parse(
+      execFileSync("uv", ["run", "--locked", "--project", join(root, "python/analytics"), "python", "-m", "touchline_analytics.physics.validate", file, "--work-rate"], { encoding: "utf8", maxBuffer: 1 << 26 })
+    ) as { players: Record<string, number>; distance: Record<string, number[]>; hsr: Record<string, number[]>; late_ratio: Record<string, number> }
+    const tsW = workRate(halves)
+    expect(tsW.players).toEqual(pyW.players)
+    expect(tsW.players.DEF! + tsW.players.MID! + tsW.players.FWD!).toBeGreaterThanOrEqual(10)
+    for (const key of ["distance", "hsr"] as const) for (const g of Object.keys(pyW[key])) tsW[key][g]!.forEach((v, i) => expect(v, `${key} ${g}[${i}]`).toBeCloseTo(pyW[key][g]![i]!, 6))
+    expect(tsW.lateRatio.distance).toBeCloseTo(pyW.late_ratio.distance!, 9)
+    expect(tsW.lateRatio.hsr).toBeCloseTo(pyW.late_ratio.hsr!, 9)
   })
 })
diff --git a/python/analytics/tests/test_physics_build.py b/python/analytics/tests/test_physics_build.py
index 05413bc..4d37cd8 100644
--- a/python/analytics/tests/test_physics_build.py
+++ b/python/analytics/tests/test_physics_build.py
@@ -2,7 +2,7 @@ import json
 
 import pytest
 
-from touchline_analytics.physics.build import LITERATURE_E, MIN_BOUNCES, GuardError, check_guards, engine_block, restitution_or_fallback, sync_params, write
+from touchline_analytics.physics.build import LITERATURE_E, MIN_BOUNCES, GuardError, check_guards, engine_block, real_work_rate, restitution_or_fallback, sync_params, write
 from touchline_analytics.physics.stats import Constant
 
 
@@ -92,3 +92,14 @@ def test_nothing_is_written_when_a_guard_fails(tmp_path):
     write({"fit": _fit()}, out, params)
     assert json.loads(out.read_text())["engine"] == engine_block(_fit())
     assert json.loads(params.read_text())["physics"] == engine_block(_fit())
+
+
+def test_real_work_rate_averages_matches_and_keeps_their_spread():
+    a = {"players": {"DEF": 4, "MID": 3, "FWD": 1}, "distance": {"MID": [120.0] * 6, "ALL": [110.0] * 6}, "hsr": {"MID": [8.0] * 6, "ALL": [6.0] * 6}, "late_ratio": {"distance": 0.9, "hsr": 0.7}}
+    b = {"players": {"DEF": 2, "MID": 4, "FWD": 2}, "distance": {"MID": [100.0] * 6, "ALL": [90.0] * 6}, "hsr": {"MID": [4.0] * 6, "ALL": [2.0] * 6}, "late_ratio": {"distance": 0.8, "hsr": 0.9}}
+    r = real_work_rate({"m1": a, "m2": b})
+    assert r["players"] == {"DEF": 6, "MID": 7, "FWD": 3}
+    assert r["distance"]["MID"] == [110.0] * 6 and r["hsr"]["ALL"] == [4.0] * 6
+    assert r["late_ratio"]["distance"] == {"mean": 0.85, "min": 0.8, "max": 0.9}
+    assert r["late_ratio"]["hsr"] == {"mean": 0.8, "min": 0.7, "max": 0.9}
+    assert r["per_match"] == {"m1": {"distance": 0.9, "hsr": 0.7}, "m2": {"distance": 0.8, "hsr": 0.9}}
diff --git a/python/analytics/tests/test_physics_validate.py b/python/analytics/tests/test_physics_validate.py
index 714306b..e5e0c0b 100644
--- a/python/analytics/tests/test_physics_validate.py
+++ b/python/analytics/tests/test_physics_validate.py
@@ -15,6 +15,7 @@ from touchline_analytics.physics.validate import (
     resample_10hz,
     span_metrics,
     w1,
+    work_rate,
 )
 
 
@@ -81,6 +82,25 @@ def test_player_metrics_are_histograms_on_fixed_edges():
         assert len(h) == len(PLAYER_EDGES[k]) - 1
 
 
+def test_work_rate_by_15_minute_period_for_full_match_outfielders():
+    steady = [_player([(2.0, 2700.0)]), _player([(2.0, 2700.0)])]  # 120 m/min throughout
+    fades = [_player([(6.0, 900.0), (2.0, 900.0), (1.0, 900.0)]) for _ in range(2)]  # sprints early, walks late
+    w = work_rate({
+        "s": ("MID", steady),
+        "f": ("FWD", fades),
+        "gk": ("GK", steady),
+        "sub": ("DEF", [steady[0], np.full_like(steady[0], np.nan)]),  # off at half-time
+    })
+    assert w["players"] == {"DEF": 0, "MID": 1, "FWD": 1}
+    assert w["distance"]["MID"] == pytest.approx([120.0] * 6, rel=1e-3)
+    assert w["distance"]["FWD"] == pytest.approx([360.0, 120.0, 60.0] * 2, rel=1e-2)
+    assert w["hsr"]["FWD"] == pytest.approx([360.0, 0.0, 0.0] * 2, rel=1e-2) and w["hsr"]["MID"] == [0.0] * 6
+    assert w["distance"]["ALL"] == pytest.approx([240.0, 120.0, 90.0] * 2, rel=1e-2)
+    assert w["late_ratio"]["distance"] == pytest.approx(90.0 / 240.0, rel=1e-2)
+    assert w["late_ratio"]["hsr"] == pytest.approx(0.0)
+    assert w["distance"]["DEF"] == [] and w["hsr"]["DEF"] == []
+
+
 P = BallPhysics(k=0.013, e=0.7, mu=0.25, mu_s=0.35)
 
 
PATCH
```

- [ ] **Step 2: Run them to make sure they fail**

Run: `uv run --locked --project python/analytics pytest -q python/analytics/tests/test_physics_validate.py python/analytics/tests/test_physics_build.py`
Expected: two collection errors (`cannot import name 'work_rate'`, `cannot import name 'real_work_rate'`)

Run: `pnpm --filter @touchline/calibrate test physics`
Expected: 2 tests FAIL (`workRate is not a function`, `simHalves is not a function`)

- [ ] **Step 3: Write the implementation**

Apply this change to `packages/calibrate/src/physics.ts`, `python/analytics/touchline_analytics/physics/build.py`, `python/analytics/touchline_analytics/physics/validate.py` (from the repository root):

```bash
git apply <<'PATCH'
diff --git a/packages/calibrate/src/physics.ts b/packages/calibrate/src/physics.ts
index f0e92c2..462453d 100644
--- a/packages/calibrate/src/physics.ts
+++ b/packages/calibrate/src/physics.ts
@@ -8,6 +8,10 @@
  * 20 and 25 km/h, and accelerations and decelerations past 3 m/s^2 per 90 minutes. Each statistic is a histogram on
  * fixed edges; W1 between two histograms is the area between their CDFs. The simulation passes a statistic when its
  * W1 to the real matches is within the largest W1 between two real matches (data/params/physics.json).
+ *
+ * Work rate (reported, not gated): for outfielders on the pitch for at least 90 % of every 15-minute period of both
+ * halves, metres per minute and metres per minute above 20 km/h in each period, by position group and for all
+ * outfielders, and the late-to-early ratio (last 15 minutes of a half over its first 15, averaged over the halves).
  */
 import { GROUP_OF, type Frame, type Group, type MatchConfig, type Role } from "@touchline/sim-core"
 
@@ -138,6 +142,83 @@ export const simTracks = (frames: ReadonlyArray<Frame>, roles: ReadonlyMap<strin
   return new Map(ids.filter((id) => xy.get(id)!.some((p) => p !== null)).map((id) => [id, { group: GROUP_OF[roles.get(id)!], xy: xy.get(id)! }]))
 }
 
+const PERIOD_S = 15 * 60
+const PERIODS_PER_HALF = 3
+const FULL_SHARE = 0.9
+const OUTFIELD: ReadonlyArray<Group> = ["DEF", "MID", "FWD"]
+
+export type Halves = ReadonlyMap<string, { readonly group: Group; readonly halves: ReadonlyArray<ReadonlyArray<Point>> }>
+
+export interface WorkRate {
+  readonly players: Record<string, number>
+  readonly distance: Record<string, number[]>
+  readonly hsr: Record<string, number[]>
+  readonly lateRatio: { readonly distance: number; readonly hsr: number }
+}
+
+/** Work rate by 15-minute period of each half (port of validate.work_rate). */
+export const workRate = (players: Halves): WorkRate => {
+  const n = Math.trunc(PERIOD_S / DT + 1e-9)
+  const rows = new Map<Group, Array<[number[], number[]]>>(OUTFIELD.map((g) => [g, []]))
+  for (const id of [...players.keys()].sort()) {
+    const { group, halves } = players.get(id)!
+    if (!OUTFIELD.includes(group) || halves.length !== 2) continue
+    const dist: number[] = []
+    const hsr: number[] = []
+    for (const xy of halves) {
+      const vx = central(xy.map((p) => (p ? p[0] : NaN)))
+      const vy = central(xy.map((p) => (p ? p[1] : NaN)))
+      const speed = vx.map((x, i) => Math.hypot(x, vy[i]!))
+      let complete = true
+      for (let p = 0; p < PERIODS_PER_HALF && complete; p++) {
+        let count = 0
+        let d = 0
+        let h = 0
+        for (let i = p * n; i < Math.min((p + 1) * n, speed.length); i++) {
+          const v = speed[i]!
+          if (!Number.isFinite(v)) continue
+          count++
+          d += v
+          if (v > HSR20) h += v
+        }
+        if (count < FULL_SHARE * n) {
+          complete = false
+          break
+        }
+        const minutes = (count * DT) / 60
+        dist.push((d * DT) / minutes)
+        hsr.push((h * DT) / minutes)
+      }
+    }
+    if (dist.length === 2 * PERIODS_PER_HALF) rows.get(group)!.push([dist, hsr])
+  }
+  const every = OUTFIELD.flatMap((g) => rows.get(g)!)
+  const mean = (rs: ReadonlyArray<[number[], number[]]>, k: 0 | 1): number[] =>
+    rs.length ? Array.from({ length: 2 * PERIODS_PER_HALF }, (_, p) => rs.reduce((a, r) => a + r[k][p]!, 0) / rs.length) : []
+  const late = (v: ReadonlyArray<number>): number => {
+    const last = PERIODS_PER_HALF - 1
+    const ratios = [0, PERIODS_PER_HALF].filter((h) => v.length && v[h]! > 0).map((h) => v[h + last]! / v[h]!)
+    return ratios.length ? ratios.reduce((a, b) => a + b, 0) / ratios.length : 0
+  }
+  const distance: Record<string, number[]> = { ...Object.fromEntries(OUTFIELD.map((g) => [g, mean(rows.get(g)!, 0)])), ALL: mean(every, 0) }
+  const hsr: Record<string, number[]> = { ...Object.fromEntries(OUTFIELD.map((g) => [g, mean(rows.get(g)!, 1)])), ALL: mean(every, 1) }
+  return { players: Object.fromEntries(OUTFIELD.map((g) => [g, rows.get(g)!.length])), distance, hsr, lateRatio: { distance: late(distance.ALL!), hsr: late(hsr.ALL!) } }
+}
+
+/** Every player's track in each half of a simulated match (10 Hz frames). */
+export const simHalves = (frames: ReadonlyArray<Frame>, roles: ReadonlyMap<string, Role>): Halves => {
+  const ids = [...roles.keys()]
+  const halves = new Map<string, Point[][]>(ids.map((id) => [id, []]))
+  let period: string | null = null
+  for (const f of frames) {
+    if (f.period !== period) for (const id of ids) halves.get(id)!.push([])
+    period = f.period
+    const here = new Map<string, Point>([...f.home, ...f.away].map((p) => [p.id, [p.x, p.y] as const]))
+    for (const id of ids) halves.get(id)!.at(-1)!.push(here.get(id) ?? null)
+  }
+  return new Map(ids.filter((id) => halves.get(id)!.some((h) => h.some((p) => p !== null))).map((id) => [id, { group: GROUP_OF[roles.get(id)!], halves: halves.get(id)! }]))
+}
+
 export interface PhysicsFile {
   readonly validation: {
     readonly envelope: Readonly<Record<string, { readonly max: number }>>
diff --git a/python/analytics/touchline_analytics/physics/build.py b/python/analytics/touchline_analytics/physics/build.py
index f5f4f86..c6d704c 100644
--- a/python/analytics/touchline_analytics/physics/build.py
+++ b/python/analytics/touchline_analytics/physics/build.py
@@ -27,7 +27,7 @@ from .fit_players import GROUPS, braking_cap, clean_track, group_of, lateral_cap
 from .load import kick_events, load_match, player_positions
 from .segment import segment_half
 from .stats import Constant, bootstrap_ci
-from .validate import BALL_EDGES, PLAYER_EDGES, ball_metrics, envelope, player_metrics, replay, replay_span, resample_10hz, w1
+from .validate import BALL_EDGES, OUTFIELD, PLAYER_EDGES, ball_metrics, envelope, player_metrics, replay, replay_span, resample_10hz, w1, work_rate
 
 FIT_MATCHES = ["J03WMX", "J03WN1", "J03WOH", "J03WOY", "J03WPY"]
 HELD_OUT = ["J03WQQ", "J03WR9"]
@@ -139,6 +139,30 @@ def _player_tracks(halves, positions) -> dict:
     return tracks
 
 
+def _player_halves(halves, positions) -> dict:
+    """Player id -> (group, [first half, second half] at 10 Hz), for players tracked in both halves."""
+    out = {}
+    for pid in sorted({p for h in halves for p in h.players}):
+        g = group_of(positions.get(pid, ""))
+        if g is not None and len(halves) == 2 and all(pid in h.players for h in halves):
+            out[pid] = (g, [resample_10hz(clean_track(h.players[pid])[0]) for h in halves])
+    return out
+
+
+def real_work_rate(per_match: dict[str, dict]) -> dict:
+    """Work rate averaged over the real matches, with each match's late-to-early ratios and their range."""
+    ms = list(per_match.values())
+    avg = lambda key, g: [round(float(x), 4) for x in np.mean([m[key][g] for m in ms if m[key].get(g)], axis=0)] if any(m[key].get(g) for m in ms) else []  # noqa: E731
+    spread = lambda key: {"mean": round(float(np.mean([m["late_ratio"][key] for m in ms])), 4), "min": round(float(min(m["late_ratio"][key] for m in ms)), 4), "max": round(float(max(m["late_ratio"][key] for m in ms)), 4)}  # noqa: E731
+    return {
+        "players": {g: sum(m["players"][g] for m in ms) for g in OUTFIELD},
+        "distance": {g: avg("distance", g) for g in (*OUTFIELD, "ALL")},
+        "hsr": {g: avg("hsr", g) for g in (*OUTFIELD, "ALL")},
+        "late_ratio": {"distance": spread("distance"), "hsr": spread("hsr")},
+        "per_match": {mid: {k: round(float(m["late_ratio"][k]), 4) for k in ("distance", "hsr")} for mid, m in per_match.items()},
+    }
+
+
 def _mean_hist(hs: list[list[float]]) -> list[float]:
     return [round(float(x), 6) for x in np.mean(np.array(hs), axis=0)]
 
@@ -203,6 +227,7 @@ def build(root: Path, cache: Path, log=print) -> dict:
 
     # Validation: every statistic on every real match, the envelope, and the held-out replays.
     per_match_players = {mid: player_metrics(_player_tracks(data[mid][0], data[mid][2])) for mid in MATCHES}
+    work = real_work_rate({mid: work_rate(_player_halves(data[mid][0], data[mid][2])) for mid in MATCHES})
     spans = {mid: [h.ball[sp.start:sp.end] for h, s in zip(data[mid][0], data[mid][1]) for sp in s.spans] for mid in MATCHES}
     per_match_ball = {mid: ball_metrics(spans[mid]) for mid in MATCHES}
     env = {**envelope(list(per_match_players.values()), PLAYER_EDGES), **envelope(list(per_match_ball.values()), BALL_EDGES)}
@@ -228,6 +253,7 @@ def build(root: Path, cache: Path, log=print) -> dict:
         "threshold": REPLAY_RATIO,
         "pass": float(np.median(ratios)) <= REPLAY_RATIO,
     }
+    log(f"work rate: late/early distance {work['late_ratio']['distance']['mean']}, above 20 km/h {work['late_ratio']['hsr']['mean']}")
     log(f"held-out: ball statistics {sum(v['pass'] for v in held_ball.values())}/{len(held_ball)} inside the envelope; replay median ratio {replay_result['median_ratio']}")
 
     return {
@@ -247,6 +273,7 @@ def build(root: Path, cache: Path, log=print) -> dict:
             "real": {
                 "players": {k: _mean_hist([m[k] for m in per_match_players.values()]) for k in PLAYER_EDGES},
                 "ball": {k: _mean_hist([m[k] for m in per_match_ball.values()]) for k in BALL_EDGES},
+                "work_rate": work,
             },
             "edges": {"players": PLAYER_EDGES, "ball": BALL_EDGES},
             "held_out": {"ball": held_ball, "replay": replay_result},
diff --git a/python/analytics/touchline_analytics/physics/validate.py b/python/analytics/touchline_analytics/physics/validate.py
index d6bf9a8..2785f42 100644
--- a/python/analytics/touchline_analytics/physics/validate.py
+++ b/python/analytics/touchline_analytics/physics/validate.py
@@ -8,6 +8,9 @@ line-for-line port checked by the parity test):
 - Per frame, by position group: speed and change of speed. Per player with 30 minutes or more on the
   pitch: maximum speed, metres per 90 minutes above 20 and 25 km/h, and accelerations and decelerations
   past 3 m/s^2 per 90 minutes (each crossing of the threshold counts once).
+- Work rate (reported, not gated): for outfielders on the pitch for at least 90 % of every 15-minute period of
+  both halves, metres per minute and metres per minute above 20 km/h in each period, by position group and for
+  all outfielders, and the late-to-early ratio (last 15 minutes of a half over its first 15, averaged over halves).
 Each statistic is a histogram on fixed edges (values outside go in the end bins); two histograms differ
 by W1, the area between their CDFs, in the statistic's own units. A statistic passes when the simulation's
 W1 to the real matches is within the largest W1 between two real matches (the inter-match envelope).
@@ -147,6 +150,49 @@ def player_samples(tracks: dict[str, tuple[str, np.ndarray]]) -> dict[str, list[
     return out
 
 
+PERIOD_S = 15 * 60
+PERIODS_PER_HALF = 3
+FULL_SHARE = 0.9
+OUTFIELD = ("DEF", "MID", "FWD")
+
+
+def work_rate(players: dict[str, tuple[str, list[np.ndarray]]]) -> dict:
+    """Work rate by 15-minute period; `players` maps player id to (position group, [first half, second half] at 10 Hz)."""
+    n = int(PERIOD_S * HZ)
+    rows: dict[str, list[tuple[list[float], list[float]]]] = {g: [] for g in OUTFIELD}
+    for _, (group, halves) in sorted(players.items()):
+        if group not in OUTFIELD or len(halves) != 2:
+            continue
+        dist: list[float] = []
+        hsr: list[float] = []
+        for xy in halves:
+            speed = np.hypot(_central(xy[:, 0]), _central(xy[:, 1]))
+            for p in range(PERIODS_PER_HALF):
+                s = speed[p * n : (p + 1) * n]
+                ok = np.isfinite(s)
+                if ok.sum() < FULL_SHARE * n:
+                    break
+                minutes = ok.sum() * DT / 60
+                dist.append(float(s[ok].sum() * DT / minutes))
+                hsr.append(float(s[ok & (s > HSR20)].sum() * DT / minutes))
+        if len(dist) == 2 * PERIODS_PER_HALF:
+            rows[group].append((dist, hsr))
+    every = [r for g in OUTFIELD for r in rows[g]]
+    mean = lambda rs, i: [float(np.mean([r[i][p] for r in rs])) for p in range(2 * PERIODS_PER_HALF)] if rs else []  # noqa: E731
+
+    def late(v: list[float]) -> float:
+        last = PERIODS_PER_HALF - 1
+        ratios = [v[h + last] / v[h] for h in (0, PERIODS_PER_HALF) if v and v[h] > 0]
+        return float(np.mean(ratios)) if ratios else 0.0
+
+    out = {
+        "players": {g: len(rows[g]) for g in OUTFIELD},
+        "distance": {**{g: mean(rows[g], 0) for g in OUTFIELD}, "ALL": mean(every, 0)},
+        "hsr": {**{g: mean(rows[g], 1) for g in OUTFIELD}, "ALL": mean(every, 1)},
+    }
+    return {**out, "late_ratio": {"distance": late(out["distance"]["ALL"]), "hsr": late(out["hsr"]["ALL"])}}
+
+
 def player_metrics(tracks: dict[str, tuple[str, np.ndarray]]) -> dict[str, list[float]]:
     s = player_samples(tracks)
     return {k: hist(s[k], e) for k, e in PLAYER_EDGES.items()}
@@ -272,12 +318,17 @@ def replay_span(pos: np.ndarray, p: BallPhysics) -> Replay:
 
 
 def _main() -> None:
-    """Player statistics of tracks given as JSON {id: {group, xy: [[x, y] or null, ...]}} at 10 Hz (parity test)."""
+    """Player statistics of tracks given as JSON {id: {group, xy: [[x, y] or null, ...]}} at 10 Hz (parity test);
+    with --work-rate, the work rate of {id: {group, halves: [[[x, y] or null, ...], ...]}}."""
     import json
     import sys
 
+    arr = lambda xy: np.array([[np.nan, np.nan] if p is None else p for p in xy], dtype=float)  # noqa: E731
     raw = json.loads(open(sys.argv[1]).read())
-    tracks = {pid: (t["group"], np.array([[np.nan, np.nan] if p is None else p for p in t["xy"]], dtype=float)) for pid, t in raw.items()}
+    if "--work-rate" in sys.argv:
+        print(json.dumps(work_rate({pid: (t["group"], [arr(h) for h in t["halves"]]) for pid, t in raw.items()})))
+        return
+    tracks = {pid: (t["group"], arr(t["xy"])) for pid, t in raw.items()}
     print(json.dumps(player_metrics(tracks)))
 
 
PATCH
```

- [ ] **Step 4: Re-run the fit**

Run: `pnpm physics:fit` (about 15 minutes; the per-match cache from Task 7 makes it shorter)
Expected: the constants and the held-out lines are unchanged, with a new line
```
work rate: late/early distance 0.9135, above 20 km/h 0.9486
```
and `git diff --stat data/params/physics.json` shows only `validation.real.work_rate` and `code_version` changing.

- [ ] **Step 5: Run the tests**

Run: `uv run --locked --project python/analytics pytest -q python/analytics/tests/test_physics_validate.py python/analytics/tests/test_physics_build.py`
Expected: `24 passed`

Run: `pnpm --filter @touchline/calibrate test physics`
Expected: `6 passed` (the parity case compares both work rates on a simulated match)

Run: `uv run --locked --project python/analytics pytest -q python/analytics/tests`
Expected: all pass

- [ ] **Step 6: Commit**

```bash
git add data/params/physics.json packages/calibrate python/analytics
git commit -m "feat: work rate by 15-minute period — metres per minute and above 20 km/h for full-match outfielders, real (all seven matches, with their spread) in physics.json and simulated with parity; reported, not gated

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 12: Switch on the fitted ball and player movement

The engine runs on the fitted constants: the old ball model (`legacyStepBall`, the constant-deceleration launch speed) and the old movement (`arrive`, `arriveBy`, `kinematics.vmaxBase`, `ball.drag`/`rollDecel`/`bounce`, `physics.enabled`) go. Who reaches a moving ball keeps its tuned rule (Ruling 10): `accelFor`, `reachIn`, `kinematics.accelMax` and `reactionS` stay, documented as that rule. No recalibration: measured on the gate matches, the calibrated parameters give realism loss 24.8 (30.0 before), 12 of 19 within 1 SD, 19 of 19 within 2 SD. The tuner starts from the fitted physics (`withPhysics`, `--physics`), since it builds its output from the code defaults. The realism gate test also asserts the 11/17 floor (P5) and the movement statistics achieved (P3, 1 of 13), and logs the work rate (P7); the realism report gains both sections. Scenario `late_comeback` falls to 8 of 10 unforced seeds, so the scripted goal nudge `script.goalShotLogit` rises from 1.25 to 1.5 (9 of 10; the others stay 10 of 10), as Plan 6a did. Seed-pinned fixtures are re-pinned, and the stats engine's plausibility test runs on the committed parameters (the uncalibrated priors' players run about 14.5 km with the fitted movement).

**Files:**
- Modify: `packages/sim-core/src/ball.ts`, `kinematics.ts`, `params.ts` (also `script.goalShotLogit` 1.5), `step.ts`
- Modify: `packages/calibrate/src/physics.ts` (`Track`, `HalfTracks`, `PhysicsFile.engine`, `withPhysics`), `cli.ts` (`--physics`), `realism.ts` (passes `--physics`, `--league`)
- Modify: `python/analytics/touchline_analytics/report.py` (`simulated_tracks`, `physics_section`)
- Modify: `services/agents/tests/conftest.py` (`SEED` 2, `ERROR_SEED` 10), `packages/agent-gateway/test/e2e.test.ts` (seed 10)
- Modify (generated): `data/params/touchline-params.json` (old keys out, `script.goalShotLogit` 1.5), `data/params/realism-baseline.json`, `docs/realism/realism-report.md`, `packages/stats/test/golden/late-comeback-4245.json`
- Test: `packages/sim-core/test/ball-parity.test.ts`, `movement.test.ts`, `params.test.ts`, `physics.test.ts`, `resolve-shot.test.ts`, `whatif.test.ts`, `wide.test.ts`; `packages/calibrate/test/tune.test.ts`, `realism-gate.test.ts`; `packages/stats/test/kinematics.test.ts`; `python/analytics/tests/test_report.py`

**Interfaces:**
- Consumes: everything of Tasks 8–11.
- Produces: `Params` without `physics.enabled`, `kinematics.vmaxBase`, `ball.drag`, `ball.rollDecel`, `ball.bounce`; `vmaxFor` always from the fitted motion; `withPhysics(base, physics)`; calibrate CLI `--physics` (default `data/params/physics.json`, or `none`); `report.simulated_tracks(run_dirs, roles)`, `report.physics_section(tracks, halves, physics)`, report CLI `--physics`, `--league`.

- [ ] **Step 1: Write the failing tests**

Apply this change to `packages/agent-gateway/test/e2e.test.ts`, `packages/calibrate/test/realism-gate.test.ts`, `packages/calibrate/test/tune.test.ts`, `packages/sim-core/test/ball-parity.test.ts`, `packages/sim-core/test/movement.test.ts`, `packages/sim-core/test/params.test.ts`, `packages/sim-core/test/physics.test.ts`, `packages/sim-core/test/resolve-shot.test.ts`, `packages/sim-core/test/whatif.test.ts`, `packages/sim-core/test/wide.test.ts`, `packages/stats/test/kinematics.test.ts`, `python/analytics/tests/test_report.py`, `services/agents/tests/conftest.py` (from the repository root):

```bash
git apply <<'PATCH'
diff --git a/packages/agent-gateway/test/e2e.test.ts b/packages/agent-gateway/test/e2e.test.ts
index 0ad84b4..7053c18 100644
--- a/packages/agent-gateway/test/e2e.test.ts
+++ b/packages/agent-gateway/test/e2e.test.ts
@@ -29,11 +29,11 @@ let run: string
 let result: GatewayResult
 
 beforeAll(async () => {
-  // Seed 28: the test needs a costly error explained as a mis-hit clearance under pressure. It is the agents suite's error
+  // Seed 10: the test needs a costly error explained as a mis-hit clearance under pressure. It is the agents suite's error
   // match (services/agents/tests/conftest.py ERROR_SEED, found by services/agents/scripts/find_test_seed.py): its only
   // critical error is such a clearance. Re-pin both together when the engine or the params file changes.
-  run = join(mkdtempSync(join(tmpdir(), "gw-e2e-")), "e2e-err-28")
-  spawnSync("pnpm", ["-s", "sim", "--scenario", "costly_error", "--seed", "28", "--match-id", "e2e-err-28", "--out", run], { cwd: root, stdio: "ignore" })
+  run = join(mkdtempSync(join(tmpdir(), "gw-e2e-")), "e2e-err-10")
+  spawnSync("pnpm", ["-s", "sim", "--scenario", "costly_error", "--seed", "10", "--match-id", "e2e-err-10", "--out", run], { cwd: root, stdio: "ignore" })
   const port = await freePort()
   agents = spawn("uv", ["run", "--project", "services/agents", "touchline-agents", "--port", String(port)], { cwd: root, env: { ...process.env, TOUCHLINE_LLM: "stub" }, detached: true, stdio: "ignore" })
   const url = `http://127.0.0.1:${port}/`
diff --git a/packages/calibrate/test/realism-gate.test.ts b/packages/calibrate/test/realism-gate.test.ts
index 455656d..2903b2d 100644
--- a/packages/calibrate/test/realism-gate.test.ts
+++ b/packages/calibrate/test/realism-gate.test.ts
@@ -7,6 +7,7 @@ import { paramsFromJson } from "@touchline/sim-core"
 import { FIXTURES, loss, runMatch, scaleOf, type Targets } from "../src/evaluate.js"
 import { DRIFT_Z, driftZ, GATE_KEYS, GATE_SEEDS, summarize, type Baseline } from "../src/gate.js"
 import { matchMetrics, SCALAR_KEYS } from "../src/metrics.js"
+import { physicsGate, playerMetrics, rolesOf, simHalves, simTracks, workRate, type HalfTracks, type PhysicsFile, type Track } from "../src/physics.js"
 
 const root = join(dirname(fileURLToPath(import.meta.url)), "../../..")
 const baselinePath = join(root, "data/params/realism-baseline.json")
@@ -14,19 +15,27 @@ const baselinePath = join(root, "data/params/realism-baseline.json")
 /**
  * Regression guard for the committed calibration, on held-out seeds the tuner never saw:
  * (1) the statistics must not drift from the committed baseline of the same seeds (two-sample z, standard error), and
- * (2) they must stay close to the real-match targets.
+ * (2) they must stay close to the real-match targets, with at least as many statistics within 1 and 2 SD as before the
+ *     fitted physics (spec P5);
+ * (3) the player movement statistics inside the real inter-match envelope must not fall below the count achieved (a known
+ *     gap, spec P3), and the work rate by period is reported (spec P7).
  * After an intended engine change: re-run `pnpm calibrate` and `pnpm realism`, then refresh the baseline with
  * `UPDATE_REALISM_BASELINE=1 pnpm --filter @touchline/calibrate test realism-gate` and commit all three.
  */
 describe("realism gate", () => {
+  // 16 full matches: about two minutes, longer on a loaded machine.
   it("held-out matches with the committed parameters match the baseline and stay close to real matches", () => {
     const league = JSON.parse(readFileSync(join(root, "data/league/league.json"), "utf8")) as League
     const targets = JSON.parse(readFileSync(join(root, "data/params/targets-idsse.json"), "utf8")) as Targets
     const params = paramsFromJson(JSON.parse(readFileSync(join(root, "data/params/touchline-params.json"), "utf8")))
+    const tracks = new Map<string, Track>()
+    const halves = new Map<string, HalfTracks>()
     const runs = GATE_SEEDS.map((seed, i) => {
       const [h, a] = FIXTURES[i % FIXTURES.length]!
       const cfg = { matchId: `gate-${i}`, seed, kickoffTime: "2026-10-18T14:00:00.000Z", home: league.clubs.find((c) => c.id === h)!, away: league.clubs.find((c) => c.id === a)!, params, dt: 0.1 }
       const { events, frames } = runMatch(cfg)
+      for (const [id, t] of simTracks(frames, rolesOf(cfg))) tracks.set(`${seed}-${id}`, t)
+      for (const [id, t] of simHalves(frames, rolesOf(cfg))) halves.set(`${seed}-${id}`, t)
       return matchMetrics(events, frames, cfg.dt)
     })
     const now = summarize(runs)
@@ -42,8 +51,23 @@ describe("realism gate", () => {
     for (const k of GATE_KEYS) expect(Math.abs(drift[k]), `${k} drifted from the baseline`).toBeLessThan(DRIFT_Z)
     for (const k of SCALAR_KEYS) expect(Math.abs(z[k]!), `${k} vs real`).toBeLessThan(GATE_Z)
     expect(loss(now.mean, targets)).toBeLessThan(GATE_LOSS)
-  })
+    expect(SCALAR_KEYS.filter((k) => Math.abs(z[k]!) < 1).length).toBeGreaterThanOrEqual(WITHIN_1SD)
+    expect(SCALAR_KEYS.filter((k) => Math.abs(z[k]!) < 2).length).toBeGreaterThanOrEqual(WITHIN_2SD)
+
+    const physics = JSON.parse(readFileSync(join(root, "data/params/physics.json"), "utf8")) as PhysicsFile
+    const rows = physicsGate(playerMetrics(tracks), physics)
+    const work = workRate(halves)
+    console.log("physics gate", JSON.stringify({ inside: rows.filter((r) => r.pass).map((r) => r.key), lateRatio: work.lateRatio, distance: work.distance.ALL!.map((v) => Number(v.toFixed(1))) }))
+    expect(rows.length).toBe(13)
+    expect(rows.filter((r) => r.pass).length).toBeGreaterThanOrEqual(PHYSICS_INSIDE)
+    expect(work.distance.ALL).toHaveLength(6)
+  }, 300_000)
 })
 
 const GATE_Z = 3
 const GATE_LOSS = 30
+// Before the fitted physics (2026-10-09): 11 within 1 SD, 17 within 2 SD.
+const WITHIN_1SD = 11
+const WITHIN_2SD = 17
+// Player movement statistics inside the real envelope with the fitted physics (max_speed only): a known gap, spec P3.
+const PHYSICS_INSIDE = 1
diff --git a/packages/calibrate/test/tune.test.ts b/packages/calibrate/test/tune.test.ts
index c0d27a0..3360bce 100644
--- a/packages/calibrate/test/tune.test.ts
+++ b/packages/calibrate/test/tune.test.ts
@@ -3,6 +3,7 @@ import { DEFAULT_PARAMS } from "@touchline/sim-core"
 import { loss, scaleOf, type Targets } from "../src/evaluate.js"
 import { applyKnobs, initialKnobs, KNOBS, type Knob } from "../src/knobs.js"
 import { SCALAR_KEYS } from "../src/metrics.js"
+import { withPhysics } from "../src/physics.js"
 import { coordinateSearch } from "../src/tune.js"
 
 describe("knobs", () => {
@@ -55,3 +56,13 @@ describe("coordinateSearch", () => {
     expect(res.knobs.a).toBe(1)
   })
 })
+
+describe("physics in the tuner", () => {
+  it("calibrates on top of the fitted physics constants", () => {
+    const engine = { ball: { drag: 0.0153, restitution: 0.747, bounceFriction: 0.24, skidFriction: 0.35, rollC0: 0.55, rollC1: 0.11 }, players: { brake: 6.2, reactionS: 0.2 } }
+    const p = withPhysics(DEFAULT_PARAMS, { validation: { envelope: {}, real: { players: {} } }, engine })
+    expect(p.physics.ball).toEqual(engine.ball)
+    expect(p.physics.players.brake).toBe(6.2)
+    expect(p.physics.players.a0).toEqual(DEFAULT_PARAMS.physics.players.a0)
+  })
+})
diff --git a/packages/sim-core/test/ball-parity.test.ts b/packages/sim-core/test/ball-parity.test.ts
index 6896c11..c59fa71 100644
--- a/packages/sim-core/test/ball-parity.test.ts
+++ b/packages/sim-core/test/ball-parity.test.ts
@@ -6,8 +6,7 @@ import { stepBall } from "../src/ball.js"
 import { DEFAULT_PARAMS, type Params } from "../src/params.js"
 import type { BallState } from "../src/types.js"
 
-/** The fitted physics switched on (its defaults are the literature values). */
-const P: Params = { ...DEFAULT_PARAMS, physics: { ...DEFAULT_PARAMS.physics, enabled: true } }
+const P: Params = DEFAULT_PARAMS
 
 const root = join(dirname(fileURLToPath(import.meta.url)), "../../..")
 const hasUv = spawnSync("uv", ["--version"]).status === 0
diff --git a/packages/sim-core/test/movement.test.ts b/packages/sim-core/test/movement.test.ts
index 89b6b35..cf6a11e 100644
--- a/packages/sim-core/test/movement.test.ts
+++ b/packages/sim-core/test/movement.test.ts
@@ -7,7 +7,7 @@ import { approach, approachBy, GROUP_OF, motionFor, steer, throughKnots, vmaxFor
 import { DEFAULT_PARAMS, type Params } from "../src/params.js"
 import type { PlayerAttrs, Role } from "../src/types.js"
 
-const P: Params = { ...DEFAULT_PARAMS, physics: { ...DEFAULT_PARAMS.physics, enabled: true } }
+const P: Params = DEFAULT_PARAMS
 const root = join(dirname(fileURLToPath(import.meta.url)), "../../..")
 const attrs = (pace: number, acceleration: number): PlayerAttrs =>
   ({ pace, acceleration, shortPassing: 0.5, longPassing: 0.5, vision: 0.5, crossing: 0.5, dribbling: 0.5, finishing: 0.5, heading: 0.5, tackling: 0.5, composure: 0.5, stamina: 0.5, handling: 0.5, reflexes: 0.5 })
@@ -94,15 +94,16 @@ describe("player movement", () => {
     }
   })
 
+  it("the ball and movement steps use no transcendental functions (bit-identical replays across JavaScript engines)", () => {
+    for (const f of ["ball.ts", "kinematics.ts"]) {
+      const src = readFileSync(join(root, "packages/sim-core/src", f), "utf8")
+      expect(src, f).not.toMatch(/Math\.(exp|pow|log|expm1|log1p|cbrt)\(/)
+    }
+  })
+
   it("top speed drops only to 97 % when a player is exhausted", () => {
     const pl = median("CM")
     expect(vmaxFor(pl, 0, P) / vmaxFor(pl, 1, P)).toBeCloseTo(0.97, 12)
     expect(vmaxFor(pl, 1, P)).toBeCloseTo(motionFor(pl, P).s0, 12)
   })
-
-  it("with the fitted physics off, top speed is the old formula", () => {
-    const pl = median("CM")
-    const k = DEFAULT_PARAMS.kinematics
-    expect(vmaxFor(pl, 0.5, DEFAULT_PARAMS)).toBeCloseTo(k.vmaxBase * (0.86 + 0.14 * pl.attrs.pace) * 0.95, 12)
-  })
 })
diff --git a/packages/sim-core/test/params.test.ts b/packages/sim-core/test/params.test.ts
index fdd38ac..3369cc1 100644
--- a/packages/sim-core/test/params.test.ts
+++ b/packages/sim-core/test/params.test.ts
@@ -23,7 +23,7 @@ describe("params from JSON", () => {
   it("merges a partial file onto the defaults and keeps provenance", () => {
     const p = paramsFromJson({ provenance: { ...DEFAULT_PARAMS.provenance, version: "calib-x" }, kinematics: { reachMargin: 0.6 } })
     expect(p.kinematics.reachMargin).toBe(0.6)
-    expect(p.kinematics.vmaxBase).toBe(DEFAULT_PARAMS.kinematics.vmaxBase)
+    expect(p.kinematics.reachM).toBe(DEFAULT_PARAMS.kinematics.reachM)
     expect(p.provenance.version).toBe("calib-x")
   })
   it("ignores keys the engine does not know (e.g. the calibration record)", () => {
@@ -41,7 +41,7 @@ describe("params from JSON: review fixes", () => {
   const cc = { dataset: "open data", licence: "CC-BY-4.0", attribution: "Some League; Someone et al.", fitted_at: "2026-10-04", version: "v1" }
   it("refuses values whose type differs from the default's", () => {
     for (const bad of [
-      { kinematics: { vmaxBase: "fast" } },
+      { kinematics: { reachM: "far" } },
       { ball: null },
       { shot: 5 },
       { timing: { addedTimeMinS: [1] } },
@@ -77,7 +77,7 @@ describe("params from JSON: value ranges", () => {
       expect(() => paramsFromJson({ provenance: prov, ...bad }), JSON.stringify(bad)).toThrow(/must be between 0 and 1/)
   })
   it("refuses negative values where only magnitudes make sense, but allows signed model coefficients", () => {
-    for (const bad of [{ substitutions: { windowSdMin: -1 } }, { kinematics: { vmaxBase: -9 } }, { timing: { restartDelayS: { corner: -5 } } }])
+    for (const bad of [{ substitutions: { windowSdMin: -1 } }, { kinematics: { reachM: -9 } }, { timing: { restartDelayS: { corner: -5 } } }])
       expect(() => paramsFromJson({ provenance: prov, ...bad }), JSON.stringify(bad)).toThrow(/must not be negative/)
     expect(() => paramsFromJson({ provenance: prov, shot: { xg: { b0: -2 } }, firstTouch: { bSkill: -4 }, defending: { tackleBase: -0.5 } })).not.toThrow()
   })
diff --git a/packages/sim-core/test/physics.test.ts b/packages/sim-core/test/physics.test.ts
index d8043c7..e1e56e7 100644
--- a/packages/sim-core/test/physics.test.ts
+++ b/packages/sim-core/test/physics.test.ts
@@ -1,11 +1,10 @@
 import { describe, expect, it } from "vitest"
 import { BALL_RADIUS, bounce, carryDistance, groundDistance, groundLaunchSpeed, launchVelocity, rollDistance, stepBall } from "../src/ball.js"
-import { arrive, interceptPoint } from "../src/kinematics.js"
+import { interceptPoint } from "../src/kinematics.js"
 import { DEFAULT_PARAMS, type Params } from "../src/params.js"
 import type { BallState } from "../src/types.js"
 
-/** The fitted physics switched on (its defaults are the literature values). */
-const P: Params = { ...DEFAULT_PARAMS, physics: { ...DEFAULT_PARAMS.physics, enabled: true } }
+const P: Params = DEFAULT_PARAMS
 
 const roll = (b: BallState, s: number, p: Params = P): BallState => { let x = b; for (let i = 0; i < s / 0.1; i++) x = stepBall(x, 0.1, p); return x }
 const withBall = (o: Partial<Params["physics"]["ball"]>): Params => ({ ...P, physics: { ...P.physics, ball: { ...P.physics.ball, ...o } } })
@@ -70,18 +69,6 @@ describe("ball", () => {
 })
 
 describe("kinematics", () => {
-  it("arrive respects speed and acceleration caps and does not overshoot", () => {
-    let s = { pos: { x: 0, y: 0 }, vel: { x: 0, y: 0 } }
-    let maxV = 0
-    for (let i = 0; i < 100; i++) {
-      const prev = s.vel
-      s = arrive(s.pos, s.vel, { x: 20, y: 0 }, 8, 4, 0.1)
-      maxV = Math.max(maxV, Math.hypot(s.vel.x, s.vel.y))
-      expect(Math.hypot(s.vel.x - prev.x, s.vel.y - prev.y)).toBeLessThanOrEqual(0.4 + 1e-9)
-    }
-    expect(maxV).toBeLessThanOrEqual(8)
-    expect(Math.abs(s.pos.x - 20)).toBeLessThan(0.5)
-  })
   it("constant-bearing intercept leads a moving target", () => {
     const p = interceptPoint({ x: 0, y: -10 }, 8, { x: 0, y: 0 }, { x: 5, y: 0 })
     expect(p.x).toBeGreaterThan(0)
diff --git a/packages/sim-core/test/resolve-shot.test.ts b/packages/sim-core/test/resolve-shot.test.ts
index 82a591e..d80c112 100644
--- a/packages/sim-core/test/resolve-shot.test.ts
+++ b/packages/sim-core/test/resolve-shot.test.ts
@@ -25,6 +25,16 @@ describe("resolveFlight", () => {
     const ball = { pos: { x: 0, y: 0, z: 0 }, vel: launchVelocity(passer.pos, receiver.pos, "ground", P) }
     expect(resolveFlight(ball, passer.id, receiver.id, [passer, receiver, def], P, 0.1, new Rng(seedRng(1))).winnerId).toBe(def.id)
   })
+  it("who reaches a pass keeps the tuned reaction, not the fitted one (spec Revision)", () => {
+    // A defender 3 m off a 25 m ground pass, 18 m along it: with the fitted 0.2 s he would cut it out.
+    const passer = at(base[2]!, 0, 0), receiver = at(base[5]!, 25, 0), def = at(base[13]!, 18, 3)
+    const run = (p: typeof P) => {
+      const ball = { pos: { x: 0, y: 0, z: 0 }, vel: launchVelocity(passer.pos, receiver.pos, "ground", p) }
+      return resolveFlight(ball, passer.id, receiver.id, [passer, receiver, def], p, 0.1, new Rng(seedRng(1))).winnerId
+    }
+    expect(run(P)).toBe(receiver.id)
+    expect(run({ ...P, physics: { ...P.physics, players: { ...P.physics.players, reactionS: 0 } } })).toBe(receiver.id)
+  })
   it("a ball hit out of the pitch with nobody near goes out", () => {
     const passer = at(base[2]!, 0, 30)
     const ball = { pos: { x: 0, y: 30, z: 0 }, vel: { x: 0, y: 15, z: 0 } }
@@ -68,7 +78,7 @@ describe("planShot", () => {
 })
 
 describe("resolveFlight — review fixes", () => {
-  const { arriveBy, accelFor, vmaxFor } = KIN
+  const { approachBy, motionFor, vmaxFor } = KIN
   it("a fast pass is intercepted by a defender standing between two tick samples", () => {
     const passer = at(base[2]!, 0, 0), receiver = at(base[5]!, 30, 0), def = at(base[13]!, 5, 0.9)
     const ball = { pos: { x: 0, y: 0, z: 0 }, vel: { x: 20, y: 0, z: 0 } }
@@ -101,7 +111,7 @@ describe("resolveFlight — review fixes", () => {
       if (res.result !== "reached" || !res.winnerId) continue
       let w = players.find((p) => p.id === res.winnerId)!
       let s = { pos: w.pos, vel: w.vel }
-      for (let k = 0; k < res.ticks; k++) s = arriveBy(s.pos, s.vel, { x: res.ball.pos.x, y: res.ball.pos.y }, vmaxFor(w, w.energy, P), accelFor(w.attrs, P), 0.1, (res.ticks - k) * 0.1)
+      for (let k = 0; k < res.ticks; k++) s = approachBy(s.pos, s.vel, { x: res.ball.pos.x, y: res.ball.pos.y }, vmaxFor(w, w.energy, P), motionFor(w, P), 0.1, (res.ticks - k) * 0.1)
       expect(Math.hypot(s.pos.x - res.ball.pos.x, s.pos.y - res.ball.pos.y)).toBeLessThanOrEqual(1.5)
       checked++
     }
diff --git a/packages/sim-core/test/whatif.test.ts b/packages/sim-core/test/whatif.test.ts
index e6e75a7..302456b 100644
--- a/packages/sim-core/test/whatif.test.ts
+++ b/packages/sim-core/test/whatif.test.ts
@@ -47,7 +47,7 @@ describe("states and forks", () => {
   it("drop forced outcomes whose window has ended, so a state taken inside a forced window plays on like the main run", () => {
     // A goal forced for the home side in minutes 0-2 that never came: from a state inside the window, it must lapse at minute 2.
     const script: Script = { name: "t", entries: [{ window: [0, 2], team: "home", effect: "goal", count: 9 }] }
-    let s: MatchState = { ...initMatch(makeConfig(3, { script })), forced: [script.entries[0]!] }
+    let s: MatchState = { ...initMatch(makeConfig(2, { script })), forced: [script.entries[0]!] }
     const minute = (st: MatchState) => (st.period === "first_half" ? 0 : 45) + (st.periodTick * st.config.dt) / 60
     while (minute(s) < 2) s = step(s).state
     expect(s.forced.length).toBeGreaterThan(0)
diff --git a/packages/sim-core/test/wide.test.ts b/packages/sim-core/test/wide.test.ts
index 1be6c29..2c23e25 100644
--- a/packages/sim-core/test/wide.test.ts
+++ b/packages/sim-core/test/wide.test.ts
@@ -18,9 +18,10 @@ const play = (cfg: MatchConfig) => {
 const run = (seed: number) => ({ cfg: makeConfig(seed, { params }), events: play(makeConfig(seed, { params })) })
 const runs = Array.from({ length: 16 }, (_, i) => i + 1).map(run)
 // Keepers claim far less often than before support, marking and shielding (46 claims and 23 punches over seeds 1-16 on the
-// pre-plan engine, 6 and 7 now): crosses are blocked more or land short of the box, a known realism regression.
-// To keep a real check on claims, these are the seeds of 1-40 on which a keeper claims (18 claims, 2 punches in 14 matches).
-const CLAIM_SEEDS = [1, 4, 5, 12, 13, 22, 24, 26, 27, 30, 31, 33, 36, 37]
+// pre-plan engine, 5 and 4 now with the fitted physics): crosses are blocked more or land short of the box, a known
+// realism regression. To keep a real check on claims, these are the seeds of 1-40 on which a keeper claims (14 claims,
+// 3 punches in 13 matches).
+const CLAIM_SEEDS = [1, 5, 9, 12, 13, 18, 21, 23, 24, 25, 33, 36, 37]
 const claimRuns = CLAIM_SEEDS.map((seed) => runs[seed - 1] ?? run(seed))
 const sideOf = (cfg: MatchConfig, teamId: string | null) => (teamId === cfg.home.id ? "home" : "away")
 /** True when (x, y) is inside the penalty area that `side` defends. */
@@ -40,7 +41,7 @@ describe("high balls into the box", () => {
       }
     }
     // At least one claim per match on these seeds.
-    expect(claims).toBeGreaterThanOrEqual(14)
+    expect(claims).toBeGreaterThanOrEqual(13)
     expect(punches).toBeGreaterThanOrEqual(2)
   })
   it("a claim gives the keeper the ball; a punch leaves it loose", () => {
diff --git a/packages/stats/test/kinematics.test.ts b/packages/stats/test/kinematics.test.ts
index 1bbd98d..9f97ff1 100644
--- a/packages/stats/test/kinematics.test.ts
+++ b/packages/stats/test/kinematics.test.ts
@@ -1,9 +1,11 @@
+import { readFileSync } from "node:fs"
+import { join } from "node:path"
 import { describe, expect, it } from "vitest"
-import { initMatch, isFinished, step } from "@touchline/sim-core"
+import { initMatch, isFinished, paramsFromJson, step } from "@touchline/sim-core"
 import { makeConfig } from "@touchline/sim-core/testing"
 import { StatsEngine, StatsError } from "../src/engine.js"
 import { infoFromConfig } from "../src/input.js"
-import { event, frame, INFO, models } from "./helpers.js"
+import { event, frame, INFO, models, root } from "./helpers.js"
 
 /** Player h2 runs along x at `speeds[i]` m/s during second i (10 ticks per second). */
 const run = (eng: StatsEngine, speeds: number[], startTick = 0) => {
@@ -103,7 +105,9 @@ describe("kinematics", () => {
   })
 
   it("take a whole simulated match in emission order and give plausible totals", () => {
-    const cfg = makeConfig(7)
+    // The committed parameters: the hand-set priors are not calibrated (with the fitted movement their players run ~14.5 km).
+    const params = paramsFromJson(JSON.parse(readFileSync(join(root, "data/params/touchline-params.json"), "utf8")))
+    const cfg = makeConfig(7, { params })
     const eng = new StatsEngine(infoFromConfig(cfg), models())
     let s = initMatch(cfg)
     const t0 = performance.now()
diff --git a/python/analytics/tests/test_report.py b/python/analytics/tests/test_report.py
index a403347..5d8a160 100644
--- a/python/analytics/tests/test_report.py
+++ b/python/analytics/tests/test_report.py
@@ -28,3 +28,31 @@ def test_report_labels_every_spatial_metric():
     from touchline_analytics.report import LABELS
 
     assert all(k in LABELS for k in SPATIAL_KEYS)
+
+
+def test_physics_section_reports_movement_statistics_and_work_rate(tmp_path):
+    import json
+
+    import numpy as np
+
+    from touchline_analytics.physics.validate import PLAYER_EDGES, hist
+    from touchline_analytics.report import physics_section, simulated_tracks
+
+    run = tmp_path / "m-1"
+    run.mkdir()
+    (run / "meta.json").write_text(json.dumps({"meta": {"tracking": {"fps": 10}}}))
+    frames = [{"period": per, "frame_id": i, "teams": {"home": {"players": [{"id": "a", "x": 2.0 * i / 10, "y": 0.0}]}, "away": {"players": [{"id": "k", "x": 0.0, "y": 0.0}]}}} for per in ("first_half", "second_half") for i in range(27_001)]
+    (run / "tracking.jsonl").write_text("\n".join(json.dumps(f) for f in frames))
+    tracks, halves = simulated_tracks([run], {"a": "CM", "k": "GK"})
+    assert set(tracks) == {"m-1/a", "m-1/k"} and tracks["m-1/a"][0] == "MID" and len(halves["m-1/a"][1]) == 2
+    assert np.isnan(tracks["m-1/a"][1][27_001]).all()  # a gap between the halves
+
+    real = {k: hist([e[1]], e) for k, e in PLAYER_EDGES.items()}
+    physics = {"validation": {"envelope": {k: {"max": 0.5} for k in PLAYER_EDGES}, "real": {"players": real, "work_rate": {
+        "distance": {"ALL": [120.0, 118.0, 110.0, 112.0, 104.0, 100.0]}, "hsr": {"ALL": [8.0] * 6},
+        "late_ratio": {"distance": {"mean": 0.91, "min": 0.84, "max": 0.99}, "hsr": {"mean": 0.95, "min": 0.69, "max": 1.22}}}}}}
+    text = "\n".join(physics_section(tracks, halves, physics))
+    assert "## Player movement against real tracking" in text
+    assert "| Top speed per player (m/s) |" in text and "Inside the real envelope:" in text
+    assert "| 0–15 | 120.0 | 120.0 |" in text  # real and simulated metres per minute, first 15 minutes
+    assert "late-to-early ratio" in text and "real 0.84–0.99" in text
diff --git a/services/agents/tests/conftest.py b/services/agents/tests/conftest.py
index de1b48a..d882969 100644
--- a/services/agents/tests/conftest.py
+++ b/services/agents/tests/conftest.py
@@ -20,11 +20,11 @@ MATCH_ID = "agents-test"
 # tests read: exactly one critical error, a mis-hit clearance under pressure leading to a shot, with no other signal
 # merging into its moment. Both are found by scripts/find_test_seed.py (it checks the shape over a range of seeds, then
 # runs the tests; ERROR_SEED first, then SEED with --general); re-run it whenever the engine or
-# data/params/touchline-params.json changes. 2026-10-09: of seeds 1-1400, 16 have the error shape and 28 is the first to
-# pass; 28 itself ends in a draw with no goal in the first 20000 frames, so the general match is seed 3, the first of
-# 1-60 for which the whole suite passes. Both can be overridden from the environment (TOUCHLINE_AGENTS_SEED, TOUCHLINE_AGENTS_ERROR_SEED).
-SEED = int(os.environ.get("TOUCHLINE_AGENTS_SEED", "3"))
-ERROR_SEED = int(os.environ.get("TOUCHLINE_AGENTS_ERROR_SEED", "28"))
+# data/params/touchline-params.json changes. 2026-10-09 (fitted physics): of seeds 1-1400, 8 have the error shape and 10
+# is the first to pass; the general match is seed 2, the first of 1-100 with its shape for which the whole suite passes.
+# Both can be overridden from the environment (TOUCHLINE_AGENTS_SEED, TOUCHLINE_AGENTS_ERROR_SEED).
+SEED = int(os.environ.get("TOUCHLINE_AGENTS_SEED", "2"))
+ERROR_SEED = int(os.environ.get("TOUCHLINE_AGENTS_ERROR_SEED", "10"))
 
 
 def simulate(out: Path, seed: int) -> Path:
PATCH
```

- [ ] **Step 2: Run them to make sure they fail**

Run: `pnpm --filter @touchline/sim-core test ball-parity movement physics resolve-shot params whatif wide`
Expected: 7 tests FAIL: ball parity, top speed with fatigue, four ball tests in `physics.test.ts` (the engine still runs the old physics by default), and keeper claims (the re-pinned seeds); the rest pass

Run: `pnpm --filter @touchline/calibrate test tune`
Expected: 1 test FAILS (`withPhysics is not a function`)

Run: `uv run --locked --project python/analytics pytest -q python/analytics/tests/test_report.py`
Expected: 1 test FAILS (`cannot import name 'physics_section'`)

- [ ] **Step 3: Write the implementation**

Apply this change to `packages/calibrate/src/cli.ts`, `packages/calibrate/src/physics.ts`, `packages/calibrate/src/realism.ts`, `packages/sim-core/src/ball.ts`, `packages/sim-core/src/kinematics.ts`, `packages/sim-core/src/params.ts`, `packages/sim-core/src/step.ts`, `python/analytics/touchline_analytics/report.py` (from the repository root):

```bash
git apply <<'PATCH'
diff --git a/packages/calibrate/src/cli.ts b/packages/calibrate/src/cli.ts
index 93d6186..e9cf5dd 100644
--- a/packages/calibrate/src/cli.ts
+++ b/packages/calibrate/src/cli.ts
@@ -7,6 +7,7 @@ import { DEFAULT_PARAMS } from "@touchline/sim-core"
 import type { Targets } from "./evaluate.js"
 import { applyKnobs, KNOBS } from "./knobs.js"
 import { GATE_KEYS } from "./gate.js"
+import { withPhysics, type PhysicsFile } from "./physics.js"
 import { tune } from "./tune.js"
 
 const root = join(dirname(fileURLToPath(import.meta.url)), "../../..")
@@ -18,7 +19,9 @@ const o = cliOptions("calibrate: tune engine knobs to real-match targets (method
   matches: { default: "8", check: positiveInteger, help: "simulated matches per evaluation" },
   rounds: { default: "3", check: positiveInteger, help: "coordinate-search rounds" },
   // --from <file>: continue from that file's calibration knobs instead of the defaults.
-  from: { default: "", help: "start from the calibration.knobs of this file" }
+  from: { default: "", help: "start from the calibration.knobs of this file" },
+  // The fitted physics is fixed: the tuner calibrates behaviour on top of it.
+  physics: { default: join(root, "data/params/physics.json"), help: "physics fit (physics.json), or \"none\" for the literature defaults" }
 })
 const outPath = here(o.out)
 // Make the output folder now: a tuning chunk runs for most of an hour and must not fail when it writes its result.
@@ -44,15 +47,16 @@ const start = o.from ? (readJson("start", o.from) as { calibration?: { knobs?: R
 
 const league = JSON.parse(readFileSync(join(root, "data/league/league.json"), "utf8")) as League
 const targets = readJson("targets", o.targets) as Targets
+const base = o.physics === "none" ? DEFAULT_PARAMS : withPhysics(DEFAULT_PARAMS, readJson("physics", o.physics) as PhysicsFile)
 const t0 = Date.now()
-const res = tune(league, DEFAULT_PARAMS, targets, {
+const res = tune(league, base, targets, {
   matches,
   rounds,
   start,
   onEval: (evals, loss) => process.stdout.write(`eval ${evals}: loss ${loss.toFixed(2)} (${Math.round((Date.now() - t0) / 1000)} s)\n`)
 })
 const today = new Date().toISOString().slice(0, 10)
-const tuned = applyKnobs(DEFAULT_PARAMS, res.knobs)
+const tuned = applyKnobs(base, res.knobs)
 const out = {
   ...tuned,
   provenance: {
diff --git a/packages/calibrate/src/physics.ts b/packages/calibrate/src/physics.ts
index 462453d..0b97c2e 100644
--- a/packages/calibrate/src/physics.ts
+++ b/packages/calibrate/src/physics.ts
@@ -13,7 +13,7 @@
  * halves, metres per minute and metres per minute above 20 km/h in each period, by position group and for all
  * outfielders, and the late-to-early ratio (last 15 minutes of a half over its first 15, averaged over the halves).
  */
-import { GROUP_OF, type Frame, type Group, type MatchConfig, type Role } from "@touchline/sim-core"
+import { GROUP_OF, type Frame, type Group, type MatchConfig, type Params, type Role } from "@touchline/sim-core"
 
 export const GROUPS: ReadonlyArray<Group> = ["GK", "DEF", "MID", "FWD"]
 const DT = 0.1
@@ -36,7 +36,11 @@ export const PLAYER_EDGES: Readonly<Record<string, ReadonlyArray<number>>> = {
 }
 
 export type Point = readonly [number, number] | null
-export type Tracks = ReadonlyMap<string, { readonly group: Group; readonly xy: ReadonlyArray<Point> }>
+export interface Track {
+  readonly group: Group
+  readonly xy: ReadonlyArray<Point>
+}
+export type Tracks = ReadonlyMap<string, Track>
 
 /** Values outside the edges go in the end bins; shares sum to 1 (all zero without values). */
 export const hist = (values: ReadonlyArray<number>, e: ReadonlyArray<number>): number[] => {
@@ -147,7 +151,11 @@ const PERIODS_PER_HALF = 3
 const FULL_SHARE = 0.9
 const OUTFIELD: ReadonlyArray<Group> = ["DEF", "MID", "FWD"]
 
-export type Halves = ReadonlyMap<string, { readonly group: Group; readonly halves: ReadonlyArray<ReadonlyArray<Point>> }>
+export interface HalfTracks {
+  readonly group: Group
+  readonly halves: ReadonlyArray<ReadonlyArray<Point>>
+}
+export type Halves = ReadonlyMap<string, HalfTracks>
 
 export interface WorkRate {
   readonly players: Record<string, number>
@@ -224,8 +232,16 @@ export interface PhysicsFile {
     readonly envelope: Readonly<Record<string, { readonly max: number }>>
     readonly real: { readonly players: Readonly<Record<string, ReadonlyArray<number>>> }
   }
+  /** The constants the engine reads (pnpm physics:fit also copies them into touchline-params.json). */
+  readonly engine?: { readonly ball: Params["physics"]["ball"]; readonly players: Partial<Params["physics"]["players"]> }
 }
 
+/** `base` with the fitted physics constants of physics.json: the tuner calibrates behaviour on top of them. */
+export const withPhysics = (base: Params, physics: PhysicsFile): Params =>
+  physics.engine
+    ? { ...base, physics: { ...base.physics, ball: { ...physics.engine.ball }, players: { ...base.physics.players, ...physics.engine.players } } }
+    : base
+
 export interface GateRow {
   readonly key: string
   readonly w1: number
diff --git a/packages/calibrate/src/realism.ts b/packages/calibrate/src/realism.ts
index 513b06e..d4c3dc9 100644
--- a/packages/calibrate/src/realism.ts
+++ b/packages/calibrate/src/realism.ts
@@ -49,4 +49,5 @@ for (let i = 0; i < matches; i++) {
 }
 const note = `${params.provenance.version}; held-out seeds 2000–${2000 + matches - 1}`
 execFileSync("uv", ["run", "--project", join(root, "python/analytics"), "python", "-m", "touchline_analytics.report", ...dirs,
-  "--targets", join(root, "data/params/targets-idsse.json"), "--note", note, "--out", here(o.out)], { stdio: "inherit" })
+  "--targets", join(root, "data/params/targets-idsse.json"), "--note", note, "--out", here(o.out),
+  "--physics", join(root, "data/params/physics.json"), "--league", join(root, "data/league/league.json")], { stdio: "inherit" })
diff --git a/packages/sim-core/src/ball.ts b/packages/sim-core/src/ball.ts
index a3baa62..673d194 100644
--- a/packages/sim-core/src/ball.ts
+++ b/packages/sim-core/src/ball.ts
@@ -38,49 +38,8 @@ export const bounce = (vt: number, vn: number, w: number, b: Physics): { vt: num
   return { vt: vt - sign * impulse, vz, w: w + (sign * 1.5 * impulse) / BALL_RADIUS }
 }
 
-/** Before the fitted physics: drag, a fixed bounce keeping 85 % of horizontal speed, constant rolling deceleration. */
-const legacyStepBall = (ball: BallState, dt: number, p: Params["ball"]): BallState => {
-  let { x, y, z } = ball.pos
-  let { x: vx, y: vy, z: vz } = ball.vel
-  const h = dt / p.substeps
-  for (let i = 0; i < p.substeps; i++) {
-    const airborne = z > 1e-6 || vz > 1e-6
-    if (airborne) {
-      const speed = Math.hypot(vx, vy, vz)
-      const k = p.drag * speed * h
-      vx -= k * vx
-      vy -= k * vy
-      vz -= k * vz + p.gravity * h
-      x += vx * h
-      y += vy * h
-      z += vz * h
-      if (z <= 0) {
-        z = 0
-        vz = -vz * p.bounce
-        vx *= 0.85
-        vy *= 0.85
-        if (vz < 0.6) vz = 0
-      }
-    } else {
-      z = 0
-      vz = 0
-      const speed = Math.hypot(vx, vy)
-      if (speed > 0) {
-        const next = Math.max(0, speed - (p.rollDecel + p.drag * speed * speed) * h)
-        const f = next / speed
-        vx *= f
-        vy *= f
-        x += vx * h
-        y += vy * h
-      }
-    }
-  }
-  return { pos: { x, y, z }, vel: { x: vx, y: vy, z: vz } }
-}
-
 /** Advance the ball by dt seconds in p.ball.substeps substeps. */
 export const stepBall = (ball: BallState, dt: number, p: Params): BallState => {
-  if (!p.physics.enabled) return legacyStepBall(ball, dt, p.ball)
   const b = p.physics.ball
   const g = p.ball.gravity
   let { x, y, z } = ball.pos
@@ -186,7 +145,6 @@ export const groundDistance = (v0: number, vEnd: number, b: Physics, g: number):
 
 /** Speed of a ground pass (struck without spin) that arrives at `arriveSpeed` after `distance` metres (fixed secant steps). */
 export const groundLaunchSpeed = (distance: number, arriveSpeed: number, p: Params): number => {
-  if (!p.physics.enabled) return Math.sqrt(arriveSpeed * arriveSpeed + 2 * (p.ball.rollDecel + 1.2) * Math.max(0, distance))
   const b = p.physics.ball
   const g = p.ball.gravity
   if (distance <= 0) return arriveSpeed
diff --git a/packages/sim-core/src/kinematics.ts b/packages/sim-core/src/kinematics.ts
index 14df0c3..b6ac6eb 100644
--- a/packages/sim-core/src/kinematics.ts
+++ b/packages/sim-core/src/kinematics.ts
@@ -31,10 +31,7 @@ export const motionFor = (pl: Mover, p: Params): Motion => {
 }
 
 /** Top speed; tiredness takes off at most 3 % (top speed barely drops through a real match). */
-export const vmaxFor = (pl: Mover, energy: number, p: Params): number =>
-  p.physics.enabled
-    ? motionFor(pl, p).s0 * (0.97 + 0.03 * energy)
-    : p.kinematics.vmaxBase * (0.86 + 0.14 * pl.attrs.pace) * (0.9 + 0.1 * energy)
+export const vmaxFor = (pl: Mover, energy: number, p: Params): number => motionFor(pl, p).s0 * (0.97 + 0.03 * energy)
 
 /**
  * One step of velocity towards `desired` within a player's limits: along the run, speeding up by at most
@@ -90,13 +87,14 @@ export const drainEnergy = (energy: number, speed: number, stamina: number, dt:
   return Math.max(0, energy - dt * (f.drainBase + f.drainSpeed2 * speed * speed) * (1 + f.staminaSlope * (0.5 - stamina)))
 }
 
-/** Before the fitted physics: one acceleration cap for speeding up, slowing down and turning. */
-export const accelFor = (a: PlayerAttrs, p: Params): number => p.kinematics.accelMax * (0.8 + 0.2 * a.acceleration)
-
 /**
- * Distance a player can cover in `t` seconds starting at speed `v0` (towards the target),
- * accelerating at `amax` up to `vmax`. Matches what arrive() can achieve on a straight run.
+ * Who can reach a moving ball (resolve.ts) is a tuned rule, not physics: after `kinematics.reactionS` a player covers
+ * reachIn(t, 0, top speed, accelFor) towards the ball. The fitted 0.2 s reaction is the time to start moving; the rule's
+ * longer delay also covers reading where the pass is going (spec docs/superpowers/specs/2026-10-09-physics-fit-design.md, Revision).
  */
+export const accelFor = (a: PlayerAttrs, p: Params): number => p.kinematics.accelMax * (0.8 + 0.2 * a.acceleration)
+
+/** Distance a player can cover in `t` seconds starting at speed `v0` (towards the target), accelerating at `amax` up to `vmax`. */
 export const reachIn = (t: number, v0: number, vmax: number, amax: number): number => {
   if (t <= 0) return 0
   const v = Math.max(0, Math.min(v0, vmax))
@@ -105,52 +103,6 @@ export const reachIn = (t: number, v0: number, vmax: number, amax: number): numb
   return v * ta + 0.5 * amax * ta * ta + vmax * (t - ta)
 }
 
-/** Reynolds "arrive": head for target, slow inside slowRadius, respect speed and acceleration caps. */
-export const arrive = (
-  pos: Vec2,
-  vel: Vec2,
-  target: Vec2,
-  vmax: number,
-  amax: number,
-  dt: number,
-  slowRadius = 4
-): { pos: Vec2; vel: Vec2 } => {
-  const to = sub(target, pos)
-  const d = len(to)
-  const desiredSpeed = d < 0.05 ? 0 : Math.min(vmax, (vmax * d) / slowRadius)
-  const desired = scale(norm(to), desiredSpeed)
-  let dv = sub(desired, vel)
-  const maxDv = amax * dt
-  if (len(dv) > maxDv) dv = scale(norm(dv), maxDv)
-  let nv = add(vel, dv)
-  if (len(nv) > vmax) nv = scale(norm(nv), vmax)
-  return { pos: add(pos, scale(nv, dt)), vel: nv }
-}
-
-/**
- * Steering for meeting a ball at a known time: aim for the velocity that arrives exactly when
- * `timeLeft` runs out, with the same acceleration and speed caps as arrive(). Pairs with the
- * reachable-disc check in resolve.ts, so a player judged able to reach the ball actually does.
- */
-export const arriveBy = (
-  pos: Vec2,
-  vel: Vec2,
-  target: Vec2,
-  vmax: number,
-  amax: number,
-  dt: number,
-  timeLeft: number
-): { pos: Vec2; vel: Vec2 } => {
-  let desired = scale(sub(target, pos), 1 / Math.max(dt, timeLeft))
-  if (len(desired) > vmax) desired = scale(norm(desired), vmax)
-  let dv = sub(desired, vel)
-  const maxDv = amax * dt
-  if (len(dv) > maxDv) dv = scale(norm(dv), maxDv)
-  let nv = add(vel, dv)
-  if (len(nv) > vmax) nv = scale(norm(nv), vmax)
-  return { pos: add(pos, scale(nv, dt)), vel: nv }
-}
-
 /** Repulsion from teammates closer than radius, so players don't stack. */
 export const separation = (pos: Vec2, others: ReadonlyArray<Vec2>, radius = 1.5): Vec2 => {
   let push: Vec2 = { x: 0, y: 0 }
diff --git a/packages/sim-core/src/params.ts b/packages/sim-core/src/params.ts
index de6d873..2ac20a5 100644
--- a/packages/sim-core/src/params.ts
+++ b/packages/sim-core/src/params.ts
@@ -43,7 +43,7 @@ export interface ClassifierThresholds {
 export interface Params {
   readonly provenance: Provenance
   readonly kinematics: {
-    readonly vmaxBase: number
+    /** The tuned rule for who can reach a moving ball (resolve.ts; kinematics.ts accelFor and reachIn), not physics. */
     readonly accelMax: number
     readonly reactionS: number
     readonly reachM: number
@@ -53,10 +53,6 @@ export interface Params {
     readonly headerHeightM: number
   }
   readonly ball: {
-    /** Before the fitted physics (physics.enabled false): quadratic drag, constant rolling deceleration, restitution. */
-    readonly drag: number
-    readonly rollDecel: number
-    readonly bounce: number
     readonly gravity: number
     readonly substeps: number
   }
@@ -65,8 +61,6 @@ export interface Params {
    * `pnpm physics:fit`. The defaults are literature values (spec docs/superpowers/specs/2026-10-09-physics-fit-design.md).
    */
   readonly physics: {
-    /** Off until the recalibration switches it on, so the engine's output (and the realism baseline) stays put meanwhile. */
-    readonly enabled: boolean
     readonly ball: {
       /** Quadratic drag per metre (a = -drag |v| v). */
       readonly drag: number
@@ -283,10 +277,9 @@ export const DEFAULT_PARAMS: Params = {
     fitted_at: "2026-10-03",
     version: "prior-1"
   },
-  kinematics: { vmaxBase: 9.2, accelMax: 4.5, reactionS: 0.7, reachM: 1.0, reachMargin: 0.75, controlHeightM: 1.0, headerHeightM: 2.4 },
-  ball: { drag: 0.013, rollDecel: 1.2, bounce: 0.55, gravity: 9.81, substeps: 4 },
+  kinematics: { accelMax: 4.5, reactionS: 0.7, reachM: 1.0, reachMargin: 0.75, controlHeightM: 1.0, headerHeightM: 2.4 },
+  ball: { gravity: 9.81, substeps: 4 },
   physics: {
-    enabled: false,
     ball: { drag: 0.013, restitution: 0.62, bounceFriction: 0.6, skidFriction: 0.3, rollC0: 0.5, rollC1: 0.15 },
     players: {
       a0: { GK: [7.6, 8, 8.5, 9, 9.4], DEF: [7.6, 8, 8.5, 9, 9.4], MID: [7.6, 8, 8.5, 9, 9.4], FWD: [7.6, 8, 8.5, 9, 9.4] },
@@ -379,7 +372,7 @@ export const DEFAULT_PARAMS: Params = {
   // Hand-set prior with more goals late (refit from Wyscout goal minutes when that data is available); red-card factors from the spec.
   gameState: { minuteProfile: [0.85, 0.95, 1.05, 0.95, 1.05, 1.15], redCardOwn: 0.67, redCardOpponent: 1.2 },
   script: {
-    goalShotLogit: 1.25, goalScoring: 2.0, goalRatePerMin: 0.016, goalScoringMax: 6, goalAimMin: 0.6, pressTarget: 55,
+    goalShotLogit: 1.5, goalScoring: 2.0, goalRatePerMin: 0.016, goalScoringMax: 6, goalAimMin: 0.6, pressTarget: 55,
     momentumLogit: 1.0, momentumPress: 1.3, pressSurge: 4, pressTackle: 2, redFoul: 2, redCard: 125, heroicsSave: 1.5, howlerSave: 1.5, howlerFumble: 0.3, errorMishit: 8, forcedShotLogit: 5
   },
   // About four changes per team on average (Bundesliga teams make roughly 4-4.5 of their 5).
@@ -442,7 +435,7 @@ const SIGNED = [/^actions\.logits\./, /^pass\.xpass\./, /^shot\.xg\./, /^shot\.s
 /** Probabilities and shares, which must lie in 0..1. */
 const PROBABILITIES = new Set([
   "support.speedShare", "marking.weight",
-  "kinematics.reachMargin", "ball.bounce", "physics.ball.restitution", "execution.mishitBase", "movement.shapeSpeedShare",
+  "kinematics.reachMargin", "physics.ball.restitution", "execution.mishitBase", "movement.shapeSpeedShare",
   "shot.onTargetRate", "shot.blockPerDefender", "shot.blockPressure", "shot.blockBehind",
   "defending.foulPerTackle", "defending.yellowPerFoul", "defending.redPerFoul", "defending.tackleLooseShare", "defending.interceptLooseShare",
   "defending.crossBlock", "defending.crossBlockBehind", "defending.headClearShare", "defending.headBehind", "defending.clearToTouch", "defending.clearSliceBehind",
diff --git a/packages/sim-core/src/step.ts b/packages/sim-core/src/step.ts
index d0e462d..3709d42 100644
--- a/packages/sim-core/src/step.ts
+++ b/packages/sim-core/src/step.ts
@@ -22,7 +22,7 @@ import {
   type Vec3
 } from "./geometry.js"
 import { assignMarks, markTarget, shieldTarget, steerCarry, supportSpot } from "./offball.js"
-import { accelFor, approach, approachBy, arrive, arriveBy, drainEnergy, interceptPoint, motionFor, separation, vmaxFor } from "./kinematics.js"
+import { approach, approachBy, drainEnergy, interceptPoint, motionFor, separation, vmaxFor } from "./kinematics.js"
 import type { Action } from "./params.js"
 import { goalLineCrossing, keeperLetsRun, MAX_FLIGHT_S, resolveFlight } from "./resolve.js"
 import { hazard, Rng, substream } from "./rng.js"
@@ -1096,16 +1096,12 @@ const moveAll = (w: Work): void => {
     const mates = w.active(cur.side).filter((x) => x.id !== cur.id).map((x) => x.pos)
     const sep = separation(cur.pos, mates)
     // Chasing a ball that will arrive at a known tick uses on-time steering (matches resolveFlight's reach model).
-    const m = w.p.physics.enabled ? motionFor(cur, w.p) : null
+    const m = motionFor(cur, w.p)
     const v = Math.max(0.5, vmax)
     const next =
       timeLeft !== undefined
-        ? m
-          ? approachBy(cur.pos, cur.vel, target, v, m, w.dt, timeLeft)
-          : arriveBy(cur.pos, cur.vel, target, v, accelFor(cur.attrs, w.p), w.dt, timeLeft)
-        : m
-          ? approach(cur.pos, cur.vel, add(target, scale(sep, 2)), v, m, w.dt)
-          : arrive(cur.pos, cur.vel, add(target, scale(sep, 2)), v, accelFor(cur.attrs, w.p), w.dt)
+        ? approachBy(cur.pos, cur.vel, target, v, m, w.dt, timeLeft)
+        : approach(cur.pos, cur.vel, add(target, scale(sep, 2)), v, m, w.dt)
     const speed = len(next.vel)
     const energy = drainEnergy(cur.energy, speed, cur.attrs.stamina, w.dt, w.p)
     w.setPlayer({ ...cur, pos: clampToPitch(next.pos, -2), vel: next.vel, energy })
diff --git a/python/analytics/touchline_analytics/report.py b/python/analytics/touchline_analytics/report.py
index 7c8dff8..e2b82de 100644
--- a/python/analytics/touchline_analytics/report.py
+++ b/python/analytics/touchline_analytics/report.py
@@ -12,7 +12,10 @@ import json
 import math
 from pathlib import Path
 
+import numpy as np
+
 from .metrics import PASS_LEN_EDGES, SPEED_EDGES, touchline_metrics
+from .physics.validate import PLAYER_EDGES, player_metrics, w1, work_rate
 
 LABELS = {
     "passes": ("Passes per match", "{:.0f}"),
@@ -95,7 +98,78 @@ def statistics_section(sim_mean: dict, sim_sd: dict, targets: dict) -> tuple[lis
     return lines, counts
 
 
-def build(run_dirs: list[Path], targets: dict, params_note: str) -> str:
+# The engine's roles by position group (packages/sim-core kinematics.ts GROUP_OF).
+ENGINE_GROUP = {"GK": "GK", "CB": "DEF", "FB": "DEF", "DM": "MID", "CM": "MID", "AM": "MID", "W": "FWD", "ST": "FWD"}
+GROUP_NAMES = {"GK": "keepers", "DEF": "defenders", "MID": "midfielders", "FWD": "forwards"}
+PLAYER_LABELS = {
+    **{f"speed_{g}": f"Speed, {n} (m/s)" for g, n in GROUP_NAMES.items()},
+    **{f"accel_{g}": f"Change of speed, {n} (m/s²)" for g, n in GROUP_NAMES.items()},
+    "max_speed": "Top speed per player (m/s)",
+    "hsr20": "Metres above 20 km/h per 90 minutes",
+    "hsr25": "Metres above 25 km/h per 90 minutes",
+    "acc_count": "Accelerations past 3 m/s² per 90 minutes",
+    "dec_count": "Decelerations past 3 m/s² per 90 minutes",
+}
+PERIOD_LABELS = ["0–15", "15–30", "30–45", "45–60", "60–75", "75–90"]
+
+
+def simulated_tracks(run_dirs: list[Path], roles: dict[str, str]) -> tuple[dict, dict]:
+    """Every player's 10 Hz track per simulated match: both halves with a gap between them, and the halves apart."""
+    tracks: dict[str, tuple[str, np.ndarray]] = {}
+    halves: dict[str, tuple[str, list[np.ndarray]]] = {}
+    for run in run_dirs:
+        fps = float(json.loads((run / "meta.json").read_text())["meta"]["tracking"]["fps"])
+        assert fps == 10, f"{run}: tracking at {fps} Hz, expected 10"
+        periods: dict[str, list[dict[str, tuple[float, float]]]] = {}
+        with (run / "tracking.jsonl").open() as fh:
+            for line in fh:
+                f = json.loads(line)
+                periods.setdefault(f["period"], []).append({p["id"]: (p["x"], p["y"]) for side in ("home", "away") for p in f["teams"][side]["players"]})
+        ids = sorted({pid for frames in periods.values() for fr in frames for pid in fr})
+        for pid in ids:
+            if pid not in roles:
+                continue
+            parts = [np.array([fr.get(pid, (np.nan, np.nan)) for fr in frames], dtype=float) for frames in periods.values()]
+            group = ENGINE_GROUP[roles[pid]]
+            tracks[f"{run.name}/{pid}"] = (group, np.vstack([x for part in parts for x in (part, np.full((1, 2), np.nan))]))
+            halves[f"{run.name}/{pid}"] = (group, parts)
+    return tracks, halves
+
+
+def physics_section(tracks: dict, halves: dict, physics: dict) -> list[str]:
+    """Player movement statistics against the real inter-match envelope, and the work rate by period (physics.json)."""
+    val = physics["validation"]
+    sim = player_metrics(tracks)
+    lines = ["## Player movement against real tracking", "",
+             "Each statistic is a distribution; it is inside when its distance (W1) to the real matches is no larger than "
+             "the largest distance between two real matches (data/params/physics.json).", "",
+             "| Statistic | W1 to real | Largest real-to-real | Inside |", "|---|---|---|---|"]
+    inside = 0
+    keys = [k for k in PLAYER_EDGES if k in val["envelope"] and k in val["real"]["players"]]
+    for k in keys:
+        d = w1(sim[k], val["real"]["players"][k], PLAYER_EDGES[k])
+        top = val["envelope"][k]["max"]
+        inside += d <= top
+        lines.append(f"| {PLAYER_LABELS[k]} | {d:.3f} | {top:.3f} | {'yes' if d <= top else 'no'} |")
+    lines += ["", f"Inside the real envelope: {inside} of {len(keys)}.", ""]
+    real = val["real"].get("work_rate")
+    if real:
+        w = work_rate(halves)
+        lines += ["### Work rate by 15-minute period", "",
+                  "Outfielders on the pitch for the whole match, metres per minute.", "",
+                  "| Minutes | Real | Simulated | Real above 20 km/h | Simulated above 20 km/h |", "|---|---|---|---|---|"]
+        for i, label in enumerate(PERIOD_LABELS):
+            sd = w["distance"]["ALL"][i] if w["distance"]["ALL"] else float("nan")
+            sh = w["hsr"]["ALL"][i] if w["hsr"]["ALL"] else float("nan")
+            lines.append(f"| {label} | {real['distance']['ALL'][i]:.1f} | {sd:.1f} | {real['hsr']['ALL'][i]:.1f} | {sh:.1f} |")
+        lr = real["late_ratio"]
+        lines += ["", "Last 15 minutes of a half over its first 15 (late-to-early ratio): distance "
+                  f"{w['late_ratio']['distance']:.2f} simulated (real {lr['distance']['min']:.2f}–{lr['distance']['max']:.2f}, mean {lr['distance']['mean']:.2f}); "
+                  f"above 20 km/h {w['late_ratio']['hsr']:.2f} simulated (real {lr['hsr']['min']:.2f}–{lr['hsr']['max']:.2f}, mean {lr['hsr']['mean']:.2f}).", ""]
+    return lines
+
+
+def build(run_dirs: list[Path], targets: dict, params_note: str, physics: dict | None = None, roles: dict[str, str] | None = None) -> str:
     runs = [touchline_metrics(d) for d in run_dirs]
     n = len(runs)
     mean = lambda k: sum(r[k] for r in runs) / n  # noqa: E731
@@ -122,6 +196,8 @@ def build(run_dirs: list[Path], targets: dict, params_note: str) -> str:
         syn = [sum(r[hk][i] for r in runs) / n for i in range(len(edges) - 1)]
         lines.append(f"| {label} | {wasserstein_binned(syn, real, edges):.2f} {unit} | {js_divergence(syn, real):.4f} |")
     lines += ["", "Lower is closer. W1 is in the distribution's own unit; JS divergence is 0 for identical and 1 for disjoint distributions.", ""]
+    if physics and roles:
+        lines += physics_section(*simulated_tracks(run_dirs, roles), physics)
     return "\n".join(lines)
 
 
@@ -133,8 +209,12 @@ if __name__ == "__main__":
     ap.add_argument("--targets", default="data/params/targets-idsse.json")
     ap.add_argument("--note", default="calibrated parameters")
     ap.add_argument("--out", default="docs/realism/realism-report.md")
+    ap.add_argument("--physics", default="", help="data/params/physics.json: adds player movement against real tracking")
+    ap.add_argument("--league", default="data/league/league.json", help="player roles, for the physics section")
     a = ap.parse_args()
-    md = build([Path(r) for r in a.runs], json.loads(Path(a.targets).read_text()), a.note)
+    physics = json.loads(Path(a.physics).read_text()) if a.physics else None
+    roles = {p["id"]: p["role"] for c in json.loads(Path(a.league).read_text())["clubs"] for p in c["squad"]} if physics else None
+    md = build([Path(r) for r in a.runs], json.loads(Path(a.targets).read_text()), a.note, physics, roles)
     Path(a.out).parent.mkdir(parents=True, exist_ok=True)
     Path(a.out).write_text(md + "\n")
     print(md)
PATCH
```

- [ ] **Step 4: Update the committed parameters**

Remove the old physics keys and raise the scripted goal nudge in `data/params/touchline-params.json`:

```bash
python3 - <<'PY'
import json
p = "data/params/touchline-params.json"
d = json.load(open(p))
d["kinematics"].pop("vmaxBase", None)
for k in ("drag", "rollDecel", "bounce"):
    d["ball"].pop(k, None)
d["physics"].pop("enabled", None)
d["script"]["goalShotLogit"] = 1.5
open(p, "w").write(json.dumps(d, indent=1, ensure_ascii=False) + "\n")
PY
git diff --stat data/params/touchline-params.json
```
Expected: `5 deletions`, one changed line (`goalShotLogit`).

- [ ] **Step 5: Re-pin the agents' test matches**

Run: `uv run --project services/agents python services/agents/scripts/find_test_seed.py 1 1400`
Expected: `seeds 1-1400 with the error match's shape: [10, 37, 424, 454, 501, 791, 894, 966]`, then `FOUND 10` (already set in the conftest and gateway changes above).

Run: `uv run --project services/agents python services/agents/scripts/find_test_seed.py --general 1 100`
Expected: `FOUND 2`.

- [ ] **Step 6: Refresh the realism baseline, the stats golden summary and the realism report**

Run: `UPDATE_REALISM_BASELINE=1 pnpm --filter @touchline/calibrate test realism-gate`
Expected: `1 passed`; the log shows `realism gate {"loss":24.79,"maxDrift":0}` and `physics gate {"inside":["max_speed"], ...}`.

Run: `UPDATE_STATS_GOLDEN=1 pnpm --filter @touchline/stats test replay`
Expected: `7 passed`; `packages/stats/test/golden/late-comeback-4245.json` changes.

Run: `pnpm realism --matches 16 --out docs/realism/realism-report.md`
Expected: the report ends with "Player movement against real tracking" (inside 1 of 13) and "Work rate by 15-minute period" (late-to-early distance 0.95 simulated, real 0.84–0.99).

- [ ] **Step 7: Run the tests**

Run: `pnpm turbo run test --continue --concurrency=4 -- --maxWorkers=3`
Expected: `12 successful, 12 total` (about 6 minutes)

Run: `uv run --locked --project python/analytics pytest -q python/analytics/tests`
Expected: all pass

Run: `cd services/agents && uv run --locked pytest -q && cd -`
Expected: `158 passed`

- [ ] **Step 8: Commit**

```bash
git add data/params/realism-baseline.json data/params/touchline-params.json docs/realism/realism-report.md packages/agent-gateway packages/calibrate packages/sim-core packages/stats python/analytics services/agents/tests/conftest.py
git commit -m "feat: switch on the fitted ball and player movement — old ball and movement code removed, who reaches a moving ball keeps its tuned rule; the tuner keeps the fitted physics; the realism gate asserts the 11/17 floor and the movement statistics, and the report gains player movement and work rate; scenario goal nudge 1.5; fixtures re-pinned

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 13: Docs: the physics write-up, the spec's results and the roadmap

The open result to show: `docs/physics-calibration.md` with every fitted constant, its interval and sample, what the data says, what the engine uses and why, and the validation results (P2–P5, P7). The spec gains its Results section (P1–P7 and the related changes) and the roadmap a Plan 6b row.

**Files:**
- Create: `docs/physics-calibration.md`
- Modify: `docs/superpowers/specs/2026-10-09-physics-fit-design.md` (Results), `docs/superpowers/plans/2026-10-03-touchline-roadmap.md` (row 6b)

**Interfaces:**
- Consumes: the numbers of Tasks 7, 11 and 12 (`data/params/physics.json`, the realism gate log, `docs/realism/realism-report.md`).

- [ ] **Step 1: Write the physics write-up**

Create `docs/physics-calibration.md`:

```markdown
# Physics measured on real tracking

Touchline's ball physics and player movement are not hand-set: every constant below was fitted on public tracking
data, with an interval and a held-out check. As far as we know this is the only open, licence-clean physics calibration
of a football engine.

**Data.** IDSSE / Sportec Open DFL dataset: seven 2022/23 Bundesliga and 2. Bundesliga matches tracked by TRACAB
Gen5 at 25 Hz, ball height included (CC-BY 4.0; Deutsche Fussball Liga, Bassek et al., *Scientific Data* 2025,
doi:10.1038/s41597-025-04505-y). Five matches are fitted (J03WMX, J03WN1, J03WOH, J03WOY, J03WPY) and two held out
(J03WQQ, J03WR9). Only aggregates are committed (`data/params/physics.json`); the raw files are never in the repository.

**Reproduce.** `pnpm physics:fit` (about 15 minutes). Method: `python/analytics/touchline_analytics/physics/`;
design, criteria and the revision after measurement: `docs/superpowers/specs/2026-10-09-physics-fit-design.md`.

## The ball

| Constant | Fitted | 95 % interval | Sample | Literature |
|---|---|---|---|---|
| Drag k (a = −k·\|v\|·v) | 0.0153 /m | 0.0150–0.0156 | 1,023 flights | 0.013 (C_D ≈ 0.24) |
| — below 12 m/s | 0.0176 /m | 0.0168–0.0183 | 434 | drag crisis: up to 2× |
| — 12–18, 18–24, 24–40 m/s | 0.0139, 0.0150, 0.0150 /m | | 269, 190, 130 | |
| Restitution e | 0.747 | 0.738–0.761 | 171 bounces | 0.62 certified turf; 0.74–0.76 irrigated grass |
| Bounce friction μ | 0.24 | 0.23–0.25 | 405 first bounces | 0.7–1.05 to pass FIFA's turf angle test |
| Skid friction μ_s | 0.35 | 0.30–0.38 | 2,646 ground passes | ball–grass 0.3–0.6 |
| Rolling resistance c0 + c1·v | 0.55 + 0.11·v m/s² | c0 0.34–0.56, c1 0.09–0.15 | 2,646 | 0.40 + 0.17·v (turf, ≤ 3.5 m/s) |
| FIFA ramp check (3.2 m/s, rolling) | rolls 6.1 m | | | Pro band 4–8 m |

What the data says about the ball:

- **Natural grass lets a landing ball slide.** A lofted ball keeps about 73 % of its horizontal speed through a
  bounce, more than a ball that grips can (60 %), so the contact point slides throughout the impact; the effective
  friction (0.24) is far below the artificial-turf values certification tests imply.
- **A struck ball skids before it rolls.** A ground pass leaves the foot without spin; grass friction both slows it
  and spins it up until it rolls. Without the skid phase no rolling law fits the data.
- **The drag crisis is visible in match data**: slow balls feel about 20 % more drag than fast ones.

## The players

| Constant | Fitted | Sample | Literature |
|---|---|---|---|
| A0 (acceleration at standstill), median by group | GK 8.8, DEF 8.5, MID 8.7, FWD 8.5 m/s² | 156 player-matches | 8.3–8.7 |
| S0 (top speed of the line), median | GK 7.4, DEF 9.0, MID 8.8, FWD 9.2 m/s | | 9.2–9.5 |
| Braking cap (95th pct. of deceleration peaks) | 6.17 m/s² (6.09–6.23) | 276 players | 6–8 |
| Lateral cap (95th pct. across the run, ≥ 4 m/s) | 3.80 m/s² (3.74–3.86) | | no published value |
| Reaction delay after a kick | 0.20 s (IQR 0.08–0.40) | 2,787 reactions | 0.2–0.4; pitch control's 0.7 s is a lump |

Acceleration–speed profiles follow Morin et al. (2021): in each 0.2 m/s speed bin the two largest accelerations
along the run, and a straight line a = A0·(1 − v/S0) through them. Each player's A0 and S0 come from their pace and
acceleration attributes, placed among the league's own percentiles, onto the fitted spread for their position. The
reaction delay is the lag from a kick until the nearest opponent's velocity has changed by 1 m/s, minus the time the
acceleration law itself needs for that change. Top speed loses at most 3 % when a player is tired (a literature value,
not fitted).

## What the engine uses

Switching every fitted piece on lowered match realism, so each was measured on its own, from the calibrated
parameters, on the 16 realism-gate matches (realism loss sums the squared distance of 19 match statistics from real
matches; lower is better):

| Switched on | Loss | Within 1 SD | Within 2 SD |
|---|---|---|---|
| Nothing (before) | 30.0 | 11 | 17 |
| Fitted ball | 25.5 | 12 | 19 |
| Fitted player movement | 26.4 | 12 | 18 |
| Fitted reaction and reach (0.2 s) for who wins a moving ball | 69.7 | 12 | 14 |
| **Ball and movement (shipped)** | **24.8** | **12** | **19** |

The engine uses the fitted ball and the fitted player movement. Deciding who reaches a moving ball keeps the tuned
rule (a 0.7 s delay, then a gentle constant acceleration): the fitted 0.2 s is when a player starts moving, but the
engine's reach disc sends the player straight to where the ball will be, as if they knew where the pass was going. The tuned
delay also covers reading the pass; with 0.2 s, defenders cut out far too many passes (completion z −3.6, median pass
length z −4.8). The 0.2 s stays in `physics.json` as a measured result.

## Validation

- **Held-out ball statistics (P2):** replaying every free-ball span of the two held-out matches with the fitted
  model, all seven ball statistics (flight time, aerial carry, ground run, rolling deceleration, bounce ratio, release
  and reception speed) fall within the spread between real matches (W1 against the largest real pair-to-pair W1).
- **Free-ball replay (P4):** on 200 held-out spans, the fitted constants explain a span with a median error ratio of
  1.09 against constants refitted to that span alone (threshold 1.5); median trajectory error 0.13 m.
- **Match realism (P5):** realism loss 24.8 (30.0 before), 12 of 19 statistics within 1 SD and 19 of 19 within 2 SD
  on the gate matches. On the report's held-out seeds, pass completion and median pass length move from outside 2 SD to
  inside it (`docs/realism/realism-report.md`).
- **Players in the simulation (P3), a known gap:** 1 of 13 player movement statistics is inside the real spread (top
  speed). The engine's players stand still about half the match and move in sudden bursts; real players are almost
  always moving, mostly below 2 m/s, and change speed gently. Distance above 20 km/h is about four times the real
  figure. This is how players choose to move, not a physics constant; a movement policy tried for it (settle at a
  jog, drift around the position) moved 3 of 13 inside but raised the realism loss to 88, so it is not shipped.
- **Work rate by period (P7, reported):** real outfielders who play the whole match cover 122 m/min in the first 15
  minutes and 99 m/min in the last 15; within a half the last 15 minutes average 0.91 of the first 15 (0.84–0.99 across
  matches). Simulated players fade a little within a half (0.95 on the report's seeds) but start the second half as
  fresh as the first (121 m/min against 113 real), so the decline across the match is missing. The energy drain is a
  tuned setting, not fitted.

## Rejected data

15 spans faster than 40 m/s; 284 flights the drag model could not follow (RMSE > 0.3 m, typically an unseen touch or a
deflection); 863 tracking jumps (a player frozen for a few frames and then moved), each blanked for a second.
```

- [ ] **Step 2: Record the results in the spec and add the roadmap row**

Apply this change to `docs/superpowers/specs/2026-10-09-physics-fit-design.md`, `docs/superpowers/plans/2026-10-03-touchline-roadmap.md` (from the repository root):

```bash
git apply <<'PATCH'
diff --git a/docs/superpowers/plans/2026-10-03-touchline-roadmap.md b/docs/superpowers/plans/2026-10-03-touchline-roadmap.md
index d1916c8..54d13c9 100644
--- a/docs/superpowers/plans/2026-10-03-touchline-roadmap.md
+++ b/docs/superpowers/plans/2026-10-03-touchline-roadmap.md
@@ -14,6 +14,7 @@
 | 4b | Manager agents, A/B evaluation and corner optimiser | Oct 12–18 | **Manager agents** (one per team) choosing intents at stoppages — formation, press, line height, substitutions — from a validated menu, testing options with what-if re-simulation, with clock paused, typed outputs, fallback to the previous plan and every decision logged by tick for exact replay; **A/B evaluation** of manager agents against the scripted baseline over 100+ paired seeds (goal difference and win rate with confidence intervals, cost, latency, fallback and "do nothing" rates); stretch: **corner-setup optimiser** in the style of TacticAI using search over re-simulated corners (≈ 3 days) | |
 | 5a | **API, cue bus and fan app** — `2026-10-07-plan-5a-api-fan-app.md` | Oct 7–12 | Effect RPC API over WebSocket (`packages/rpc`, `apps/api`): match library of run folders, sessions on the cue bus (one match time per session, every viewer its own segment with neutral and English fallbacks), hot-path scoreboard from the stats engine, live toggle running the agents as the match plays, evidence and recaps, `pnpm library` (six scenarios × twelve segments) and `pnpm dev`; fan app (`apps/web`, React, Vite, Tailwind): 2D pitch, overlays by slot, profile switcher and builder, "Why?" drawer with sparklines, recaps, split-screen demo mode, EN/ES/HI; test runs clean up their temp folders | Merged (Oct 7) |
 | 5b | **Studio console, graphics output and ops view** — `2026-10-07-plan-5b-studio-ops.md` | Oct 7–12 | Studio queue on the cue bus (every moment queued; approve, hold, send to graphics; shared by every console), presenter talking points from the analyst text and the checked facts (no model), raw cue feed; a transparent broadcast graphics page showing only what the producer sent; ops view (fact-check pass/retry/drop, fallbacks, time per agent, requests, latency p50/p95 against the 250 ms and 4 s budgets, as of the session's frame); goals reach the scoreboard at once | Merged (Oct 7) |
+| 6b | **Physics fitted on real tracking** — `2026-10-09-plan-6b-physics-fit.md` | Oct 9–20 | Fit-and-validate harness on IDSSE tracking (`pnpm physics:fit`, `data/params/physics.json` with intervals, reject counts, inter-match envelope and held-out checks); the engine's ball (drag, Brody/Cross bounce, skid then roll) and player movement (acceleration–speed law, braking and lateral caps, per-player A0/S0) on the fitted constants; who reaches a moving ball keeps the tuned rule (measured: the fitted 0.2 s reaction hurts realism); realism loss 24.8 (30.0 before), 19 of 19 within 2 SD; player movement and work-rate-by-period checks reported as known gaps; `docs/physics-calibration.md` | Written |
 | 6 | Azure, demo and submission | Oct 19–27 | azd + Bicep, Foundry hosted agents, Container Apps, Cosmos DB, tracing, evaluations in Foundry, demo replays, video, submission | |
 
 Notes:
diff --git a/docs/superpowers/specs/2026-10-09-physics-fit-design.md b/docs/superpowers/specs/2026-10-09-physics-fit-design.md
index 5343eba..8f83f23 100644
--- a/docs/superpowers/specs/2026-10-09-physics-fit-design.md
+++ b/docs/superpowers/specs/2026-10-09-physics-fit-design.md
@@ -180,6 +180,27 @@ is going, which the tuned 0.7 s absorbs. A "pace and drift" movement policy, tun
 recalibration; report P3 as a known gap and add the work-rate check. A movement policy that matches real work rate is a
 follow-up plan.
 
+## Results (2026-10-09)
+
+| ID | Result |
+|---|---|
+| P1 | Met. `physics.json` from IDSSE with provenance, 95 % intervals and reject counts (15 fast spans, 284 flights over 0.3 m RMSE, 863 tracking jumps); restitution from 171 bounces (the fallback is precision-based, interval 0.738–0.761); fit-recovery tests pass |
+| P2 | Met. Held-out ball statistics 7 of 7 inside the inter-match envelope |
+| P3 | Known gap, reported: 1 of 13 player statistics inside the envelope (top speed); speed and acceleration distributions, distance above 20 and 25 km/h and effort counts are outside (players stand still, then dash) |
+| P4 | Met. Median error ratio 1.09 on 200 held-out spans (threshold 1.5); 77 % of spans within 1.5 |
+| P5 | Met without recalibration. Gate matches: loss 24.8 (30.0 before), 12 of 19 within 1 SD, 19 of 19 within 2 SD; the realism gate test asserts at least 11 and 17 |
+| P6 | Met. Bit-identical replays; no transcendental call in the ball or movement step; fixtures re-pinned in the switch-on commit |
+| P7 | Reported. Real: 122 m/min in the first 15 minutes, 99 in the last 15, late-to-early ratio 0.91 (0.84–0.99). Simulated: 0.95 within a half, but no decline across the match |
+
+Related change: the scenario script's hand-set goal nudge `script.goalShotLogit` rose from 1.25 to 1.5. With the fitted
+physics, late_comeback succeeded unforced in 8 of 10 seeds (spec §5.1.1 asks 9); at 1.5 it does in 9, and the other
+scripted scenarios stay at 10 of 10. Fixtures pinned to seeds were re-pinned (keeper claims, a lapsed forced outcome,
+the agents' test matches); the stats engine's plausibility test now runs on the committed parameters (the hand-set
+priors' players run about 14.5 km with the fitted movement).
+
+Write-up: `docs/physics-calibration.md`. Realism report with the player movement and work-rate sections:
+`docs/realism/realism-report.md`.
+
 ## Testing
 
 Test-driven throughout; each test is written and seen failing first.
PATCH
```

- [ ] **Step 3: Commit**

```bash
git add docs/physics-calibration.md docs/superpowers/plans/2026-10-03-touchline-roadmap.md docs/superpowers/specs/2026-10-09-physics-fit-design.md
git commit -m "docs: physics measured on real tracking (docs/physics-calibration.md), the spec's results and the Plan 6b roadmap row

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

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


def _main() -> None:
    """Player statistics of tracks given as JSON {id: {group, xy: [[x, y] or null, ...]}} at 10 Hz (parity test)."""
    import json
    import sys

    raw = json.loads(open(sys.argv[1]).read())
    tracks = {pid: (t["group"], np.array([[np.nan, np.nan] if p is None else p for p in t["xy"]], dtype=float)) for pid, t in raw.items()}
    print(json.dumps(player_metrics(tracks)))


if __name__ == "__main__":
    _main()

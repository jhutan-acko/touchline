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

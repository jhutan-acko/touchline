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

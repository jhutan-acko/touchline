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

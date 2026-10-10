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

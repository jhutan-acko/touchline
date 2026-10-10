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

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

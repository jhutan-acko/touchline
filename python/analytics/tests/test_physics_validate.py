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

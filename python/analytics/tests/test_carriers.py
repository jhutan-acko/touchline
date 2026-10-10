import numpy as np
import pytest

from touchline_analytics.carriers import MIN_S, still_carriers


def _half(n, ball, players, live=None, keepers=()):
    """A half at 10 Hz: ball (n, 2), players id -> (n, 2), all in play unless `live` says otherwise."""
    return {"ball": np.asarray(ball, float), "live": np.ones(n, bool) if live is None else np.asarray(live, bool), "players": {k: np.asarray(v, float) for k, v in players.items()}, "keepers": set(keepers)}


def still(n, x=0.0):
    return np.tile([x, 0.0], (n, 1))


def walking(n, speed=1.0):
    return np.column_stack([np.arange(n) * speed / 10, np.zeros(n)])


def test_a_still_ball_at_a_still_players_feet_counts_once_the_stretch_lasts_long_enough():
    n = 40
    h = _half(n, still(n), {"a": still(n, 0.4), "far": walking(n, 3) + [20, 0]})
    out = still_carriers([h])
    assert out["outfield"] == {"count": 1, "seconds": pytest.approx((n - 1) / 10), "longest": pytest.approx((n - 1) / 10)}
    assert out["GK"] == {"count": 0, "seconds": 0, "longest": 0}
    short = int(MIN_S * 10)  # 1.5 s takes 16 frames: the first frame has no speed yet
    assert still_carriers([_half(short, still(short), {"a": still(short, 0.4)})])["outfield"]["count"] == 0


def test_keepers_count_apart_and_dead_balls_moving_carriers_or_nobody_near_do_not_count():
    n = 40
    assert still_carriers([_half(n, still(n), {"gk": still(n, 0.4)}, keepers=["gk"])])["GK"]["count"] == 1
    assert still_carriers([_half(n, still(n), {"a": still(n, 0.4)}, live=np.zeros(n))])["outfield"]["count"] == 0
    moving = walking(n, 1.0)
    assert still_carriers([_half(n, moving + [0.3, 0], {"a": moving})])["outfield"]["count"] == 0
    assert still_carriers([_half(n, still(n), {"a": still(n, 3.0)})])["outfield"]["count"] == 0


def test_missing_positions_break_a_stretch_instead_of_counting_through_it():
    n = 60
    a = still(n, 0.4)
    a[25] = np.nan
    out = still_carriers([_half(n, still(n), {"a": a})])
    assert out["outfield"]["count"] == 2  # 24 frames before the gap, 33 after (each over 1.5 s)
    assert out["outfield"]["longest"] == pytest.approx(3.3)

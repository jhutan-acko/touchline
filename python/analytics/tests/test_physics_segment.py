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


import numpy as np
import pytest
from physics_fixtures import flight, half, kick_then

from touchline_analytics.physics.ballmodel import BallPhysics
from touchline_analytics.physics.fit_players import (
    GROUPS,
    fit_profile,
    group_of,
    lateral_cap,
    braking_cap,
    player_motion,
    reaction_delays,
    sprint_profiles,
)
from touchline_analytics.physics.load import FPS, Half, player_positions
from touchline_analytics.physics.segment import segment_half


def _run(a0: float, s0: float, rng: np.random.Generator, seconds: float = 600.0, brake: float = 6.0, noise: float = 0.007) -> np.ndarray:
    """A player who repeatedly sprints flat out (a = a0 (1 - v / s0)) from a jog, then brakes at `brake` m/s^2, at 25 Hz.

    Positions carry TRACAB-like noise: a little jitter, then rounding to the centimetre."""
    dt = 1 / FPS
    x, v, out, phase, hold = 0.0, 1.5, [], "jog", 0
    for _ in range(int(seconds * FPS)):
        if phase == "jog":
            v += (1.5 - v) * 0.2
            hold += 1
            if hold > rng.integers(50, 150):
                phase, hold = "sprint", 0
        elif phase == "sprint":
            v += a0 * (1 - v / s0) * dt
            hold += 1
            if hold > rng.integers(40, 90):
                phase = "brake"
        else:
            v = max(1.5, v - brake * dt)
            if v <= 1.5:
                phase, hold = "jog", 0
        x += v * dt
        out.append((x, 0.0))
    return np.round(np.array(out) + rng.normal(0, noise, (len(out), 2)), 2)


def test_morin_profile_recovers_a0_and_s0():
    rng = np.random.default_rng(1)
    speed, along, _ = player_motion(_run(8.5, 9.3, rng))
    prof = fit_profile(speed, along)
    assert prof is not None
    a0, s0, r2 = prof
    assert a0 == pytest.approx(8.5, rel=0.1) and s0 == pytest.approx(9.3, rel=0.06) and r2 > 0.9


def test_profile_needs_enough_fast_running():
    speed, along, _ = player_motion(np.cumsum(np.full((2000, 2), [0.04, 0.0]), axis=0))  # jogging at 1 m/s only
    assert fit_profile(speed, along) is None


def test_braking_cap_is_the_95th_percentile_of_deceleration_peaks():
    rng = np.random.default_rng(2)
    tracks = [player_motion(_run(8.0, 9.0, rng, 300.0, brake=b)) for b in (5.0, 6.0, 7.0)]
    cap = braking_cap(tracks)
    assert 6.0 <= cap.value <= 7.5 and cap.n == 3


def test_lateral_cap_from_running_in_circles():
    t = np.arange(0, 60, 1 / FPS)
    r, v = 6.0, 6.0  # a_lat = v^2 / r = 6 m/s^2
    xy = np.stack([r * np.cos(v * t / r), r * np.sin(v * t / r)], axis=1)
    cap = lateral_cap([player_motion(xy)])
    assert cap.value == pytest.approx(6.0, rel=0.05)


def test_player_positions_are_read_from_match_information(tmp_path):
    f = tmp_path / "meta.xml"
    f.write_text('<Team><Players><Player PersonId="DFL-OBJ-1" ShirtNumber="1" Starting="true" PlayingPosition="TW" TeamLeader="false" />'
                 '<Player PersonId="DFL-OBJ-2" ShirtNumber="9" PlayingPosition="STZ" /></Players></Team>')
    assert player_positions(f) == {"DFL-OBJ-1": "TW", "DFL-OBJ-2": "STZ"}


def test_dfl_positions_map_to_four_groups():
    assert group_of("TW") == "GK" and group_of("IVL") == "DEF" and group_of("RV") == "DEF"
    assert group_of("DMZ") == "MID" and group_of("ZO") == "MID" and group_of("HL") == "MID"
    assert group_of("OLM") == "FWD" and group_of("STZ") == "FWD" and group_of("LA") == "FWD"
    assert group_of("??") is None and set(GROUPS) == {"GK", "DEF", "MID", "FWD"}


def test_sprint_profiles_group_players_and_blank_tracking_jumps():
    rng = np.random.default_rng(3)
    n = 15000
    fast = _run(8.5, 9.3, rng, n / FPS)
    glitch = fast.copy()
    glitch[5000:5003, 0] += 3.0  # a tracking jump of 3 m (75 m/s for a frame) and back
    h = Half(1, 0, 0.0, np.zeros((n, 3)), np.ones(n, bool), {"a": fast, "b": glitch}, {"a": "T1", "b": "T1"})
    profiles, rejected = sprint_profiles([[h]], [{"a": "STZ", "b": "IVL"}])
    assert [(p.player, p.group) for p in profiles] == [("a", "FWD"), ("b", "DEF")]
    assert rejected == 2  # the jump there and the jump back
    assert profiles[1].a0 == pytest.approx(profiles[0].a0, rel=0.05) and profiles[1].vmax < 11


def _reacting_half(tau: float, rng: np.random.Generator) -> Half:
    """A ground pass at 1 s; an opponent 6 m away stands still, then sprints after it `tau` s after the contact."""
    ball, players = kick_then(flight(12.0, 0.0, 4.0, BallPhysics()))
    n = len(ball)
    contact = FPS  # the ball leaves the kicker at frame 25
    start = contact + int(round(tau * FPS))
    xs, v = [], 0.0
    x = 6.0
    for i in range(n):
        if i >= start:
            v += 8.5 * (1 - v / 9.3) / FPS
            x += v / FPS
        xs.append(x)
    players["defender"] = np.stack([np.array(xs), np.full(n, 3.0)], axis=1) + rng.normal(0, 0.02, (n, 2))
    h = half(ball, players)
    h.teams.update({"kicker": "A", "far": "A", "defender": "B"})
    return h


def test_reaction_delay_is_the_lag_the_acceleration_law_does_not_explain():
    rng = np.random.default_rng(4)
    taus = []
    for _ in range(10):
        h = _reacting_half(0.3, rng)
        taus += reaction_delays(h, segment_half(h), a0=8.5)
    assert len(taus) == 10
    assert np.median(taus) == pytest.approx(0.3, abs=0.06)


def test_reaction_needs_an_opponent_near_the_ball():
    ball, players = kick_then(flight(12.0, 0.0, 4.0, BallPhysics()))
    h = half(ball, players)
    h.teams.update({"kicker": "A", "far": "B"})  # the only opponent is ~40 m away
    assert reaction_delays(h, segment_half(h), a0=8.5) == []


def test_an_opponent_already_changing_course_at_the_kick_is_not_a_reaction():
    rng = np.random.default_rng(5)
    h = _reacting_half(-0.3, rng)  # he set off 0.3 s before the contact
    assert reaction_delays(h, segment_half(h), a0=8.5) == []

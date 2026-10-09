import json
import math
import subprocess
import sys

import numpy as np
import pytest

from touchline_analytics.physics.ballmodel import LITERATURE, BallPhysics, bounce, ground_distance, ground_launch_speed, roll_distance, simulate, step


def test_grip_bounce_leaves_rolling_at_three_fifths_of_the_speed():
    p = LITERATURE  # e 0.62, mu 0.6
    vt, vz, w = bounce(vt=8.0, vn=6.0, w=0.0, p=p)
    assert vz == pytest.approx(0.62 * 6.0)
    assert vt == pytest.approx(0.6 * 8.0)
    assert w == pytest.approx(vt / p.radius)  # rolling: no slip at the contact point


def test_slide_bounce_loses_friction_impulse_and_gains_topspin():
    p = BallPhysics(e=0.6, mu=0.25)
    vt, vz, w = bounce(vt=12.0, vn=4.0, w=0.0, p=p)  # 2.5*0.25*1.6*4 = 4 < 12: slides throughout
    assert vt == pytest.approx(12.0 - 0.25 * 1.6 * 4.0)
    assert w == pytest.approx(1.5 * 0.25 * 1.6 * 4.0 / p.radius)
    assert vz == pytest.approx(2.4)


def test_bounce_with_backspin_keeps_less_speed_than_without():
    p = LITERATURE
    plain, _, _ = bounce(vt=8.0, vn=6.0, w=0.0, p=p)
    back, _, _ = bounce(vt=8.0, vn=6.0, w=-20.0, p=p)
    assert back < plain


def test_slow_landing_stops_bouncing():
    _, vz, _ = bounce(vt=3.0, vn=0.5, w=0.0, p=LITERATURE)  # 0.62 * 0.5 = 0.31 < 0.4 m/s
    assert vz == 0.0


def test_dropped_ball_rebounds_to_e_squared_of_its_height():
    p = BallPhysics(k=0.0)
    traj = simulate((0.0, 0.0, 2.0, 0.0, 0.0, 0.0, 0.0), 2.0, p)
    after = traj[traj[:, 0] > 0.7]  # past the first landing (~0.64 s)
    assert after[:, 3].max() == pytest.approx(0.62**2 * 2.0, rel=0.03)


def test_lofted_pass_with_literature_physics_matches_the_report():
    # Report (our simulation): 18 m/s at 25 deg keeps ~7.4 m/s after its first bounce.
    th = math.radians(25)
    traj = simulate((0.0, 0.0, 0.0, 18 * math.cos(th), 0.0, 18 * math.sin(th), 0.0), 6.0, LITERATURE)
    landed = np.flatnonzero((traj[:-1, 6] < 0) & (traj[1:, 6] > 0))[0] + 1
    assert math.hypot(traj[landed, 4], traj[landed, 5]) == pytest.approx(7.4, abs=0.6)


def test_rolling_ball_on_the_ramp_test_stops_inside_the_fifa_band():
    p = LITERATURE
    traj = simulate((0.0, 0.0, 0.0, 3.2, 0.0, 0.0, 3.2 / p.radius), 10.0, p)  # leaves the ramp rolling
    assert 4.0 <= traj[-1, 1] <= 8.0
    assert traj[-1, 4] == 0.0 and (np.diff(traj[:, 1]) >= 0).all()


def test_roll_distance_matches_the_simulated_roll():
    p = LITERATURE
    traj = simulate((0.0, 0.0, 0.0, 15.0, 0.0, 0.0, 15.0 / p.radius), 20.0, p)
    assert roll_distance(15.0, 0.0, p) == pytest.approx(traj[-1, 1], rel=0.01)


def test_ground_pass_struck_without_spin_skids_then_rolls():
    p = LITERATURE
    traj = simulate((0.0, 0.0, 0.0, 12.0, 0.0, 0.0, 0.0), 20.0, p)
    first = (12.0 - traj[1, 4]) / 0.025
    assert first == pytest.approx(p.mu_s * p.gravity + p.c0 + p.c1 * 12.0 + p.k * 144.0, rel=0.01)
    rolling = np.flatnonzero(np.isclose(traj[:, 4], p.radius * traj[:, 7]) & (traj[:, 4] > 0))
    assert len(rolling) > 0
    v_r = traj[rolling[0], 4]
    t_r = traj[rolling[0], 0]
    assert v_r == pytest.approx(1.5 * p.mu_s * p.gravity * t_r, abs=0.15)  # spin caught up with speed (one substep)
    assert ground_distance(12.0, 0.0, p) == pytest.approx(traj[-1, 1], rel=0.02)  # the engine steps with explicit Euler


def test_sliding_bounce_leaves_the_ball_skidding():
    p = BallPhysics(e=0.6, mu=0.25)
    traj = simulate((0.0, 0.0, 0.3, 14.0, 0.0, -2.0, 0.0), 1.0, p)
    ground = traj[traj[:, 3] == 0]
    assert ground[0, 4] > p.radius * ground[0, 7]  # still slipping after the bounce


def test_ground_launch_speed_inverts_ground_distance():
    p = LITERATURE
    v0 = ground_launch_speed(25.0, 4.0, p)
    assert ground_distance(v0, 4.0, p) == pytest.approx(25.0, rel=1e-6)
    assert ground_launch_speed(0.0, 4.0, p) == pytest.approx(4.0)
    v_short = ground_launch_speed(3.0, 9.0, p)  # arrives while still skidding
    assert ground_distance(v_short, 9.0, p) == pytest.approx(3.0, rel=1e-6)


def test_step_is_plain_euler_in_the_air():
    p = BallPhysics(k=0.01)
    s = step((0.0, 0.0, 5.0, 10.0, 0.0, 0.0, 0.0), 0.025, p)
    k = 0.01 * 10.0 * 0.025
    assert s[3] == pytest.approx(10.0 - k * 10.0)
    assert s[5] == pytest.approx(-9.81 * 0.025)


def test_cli_prints_trajectories_for_the_parity_test():
    cases = [{"state": [0, 0, 0, 12, 3, 8, 0], "duration": 1.0, "physics": {"e": 0.7, "mu": 0.3}}]
    out = subprocess.run([sys.executable, "-m", "touchline_analytics.physics.ballmodel"], input=json.dumps(cases), capture_output=True, text=True, check=True)
    got = json.loads(out.stdout)
    assert len(got) == 1 and len(got[0]) == 41  # the start plus 40 substeps of 0.025 s
    assert got[0][0] == [0.0, 0.0, 0.0, 0.0, 12.0, 3.0, 8.0, 0.0]

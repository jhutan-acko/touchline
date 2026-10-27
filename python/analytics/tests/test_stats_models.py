import json
import math
import random
from pathlib import Path

from touchline_analytics.stats_models import (
    XG_FEATURES,
    fit_logistic,
    goal_angle,
    keeper_index,
    lane_defenders,
    line_defenders,
    pass_features,
    predict,
    pressure,
    shot_features,
    sim_xg_model,
)

ROOT = Path(__file__).resolve().parents[3]


def test_lane_counts_opponents_near_the_line_but_not_at_its_ends():
    start, end = (0.0, 0.0), (20.0, 0.0)
    opponents = [(10.0, 1.5), (10.0, 2.5), (0.5, 0.0), (19.5, 0.5), (5.0, -1.0)]
    assert lane_defenders(start, end, opponents) == 2


def test_lane_count_is_capped_at_three():
    assert lane_defenders((0.0, 0.0), (40.0, 0.0), [(float(x), 0.0) for x in range(5, 40, 5)]) == 3


def test_pressure_falls_from_one_to_zero_over_five_metres():
    assert pressure((0.0, 0.0), [(0.0, 0.0)]) == 1.0
    assert math.isclose(pressure((0.0, 0.0), [(2.5, 0.0), (30.0, 0.0)]), 0.5)
    assert pressure((0.0, 0.0), [(6.0, 0.0)]) == 0.0
    assert pressure((0.0, 0.0), []) == 0.0


def test_pass_features_measure_forward_progress_in_the_attacking_direction():
    f_home = pass_features((0.0, 0.0), (-10.0, 0.0), 1, [])
    f_away = pass_features((0.0, 0.0), (-10.0, 0.0), -1, [])
    assert f_home == [1.0, -1.0, 0.0, 0.0]
    assert f_away == [1.0, 1.0, 0.0, 0.0]


def test_goal_angle_is_widest_on_the_goal_line_and_mirrors_by_direction():
    near = goal_angle((50.0, 0.0), 1)
    far = goal_angle((30.0, 0.0), 1)
    assert near > far
    assert math.isclose(goal_angle((30.0, 5.0), 1), goal_angle((-30.0, 5.0), -1))
    assert math.isclose(far, 2 * math.atan(3.66 / 22.5))


def test_line_defenders_count_outfielders_near_the_line_to_the_goal_centre_uncapped():
    shooter = (36.0, 0.0)
    near = [(40.0, 1.4), (44.0, -0.5), (48.0, 0.0), (50.0, 1.0)]
    assert line_defenders(shooter, 1, near) == 4
    # 1.5 m off the line, behind the shooter, or beyond the goal centre: not in the line.
    assert line_defenders(shooter, 1, [(44.0, 1.6), (30.0, 0.0), (53.0, 0.0)]) == 0
    assert line_defenders(shooter, 1, []) == 0


def test_keeper_index_is_the_opponent_nearest_the_goal_attacked():
    assert keeper_index(1, [(44.0, 0.5), (51.5, 0.0), (44.0, 8.0)]) == 1
    assert keeper_index(-1, [(-51.0, 1.0), (51.5, 0.0)]) == 0
    assert keeper_index(1, []) == -1


def test_shot_features():
    f = shot_features((-41.5, 0.0), -1, True, [])
    assert math.isclose(f[0], 11.0)
    assert f[2] == 1.0 and f[3] == 0.0


def test_sim_xg_model_reads_the_simulators_refit_from_the_committed_parameters():
    params = json.loads((ROOT / "data/params/touchline-params.json").read_text())
    m = sim_xg_model(params)
    c = params["shotModel"]["xg"]
    assert params["shotModel"]["rule"] == 1
    assert m["features"] == XG_FEATURES
    assert m["intercept"] == c["b0"]
    assert [m["coefficients"][f] for f in XG_FEATURES] == [c["bDist"], c["bAngle"], c["bHeader"], c["bDefenders"]]
    # A foot shot from the penalty spot with nobody in the line: the refit's own formula.
    x = shot_features((41.5, 0.0), 1, False, [])
    z = c["b0"] + c["bDist"] * 11.0 + c["bAngle"] * 2 * math.atan(3.66 / 11.0)
    assert math.isclose(predict(m["intercept"], [m["coefficients"][f] for f in XG_FEATURES], x), 1 / (1 + math.exp(-z)), rel_tol=1e-12)
    # Rule 0: the old shot.xg.
    old = sim_xg_model({**params, "shotModel": {**params["shotModel"], "rule": 0}})
    assert old["intercept"] == params["shot"]["xg"]["b0"]


def test_fit_logistic_recovers_known_coefficients():
    rng = random.Random(3)
    xs, ys = [], []
    for _ in range(4000):
        x = [rng.uniform(-2, 2), rng.uniform(-2, 2)]
        ys.append(1 if rng.random() < 1 / (1 + math.exp(-(0.5 + 1.5 * x[0] - 1.0 * x[1]))) else 0)
        xs.append(x)
    b0, bs = fit_logistic(xs, ys, 0.0)
    assert abs(b0 - 0.5) < 0.15 and abs(bs[0] - 1.5) < 0.15 and abs(bs[1] + 1.0) < 0.15
    assert 0 < predict(b0, bs, [0.0, 0.0]) < 1


def test_fit_logistic_l2_shrinks_coefficients():
    xs = [[0.0], [1.0], [2.0], [3.0]]
    ys = [0, 0, 1, 1]
    _, free = fit_logistic(xs, ys, 0.01)
    _, shrunk = fit_logistic(xs, ys, 10.0)
    assert abs(shrunk[0]) < abs(free[0])

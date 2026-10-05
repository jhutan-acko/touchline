import math
import random

from touchline_analytics.stats_models import (
    cone_defenders,
    fit_logistic,
    goal_angle,
    lane_defenders,
    pass_features,
    predict,
    pressure,
    shot_features,
)


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


def test_cone_defenders_skip_the_keeper_and_players_outside_the_triangle():
    shooter = (36.0, 0.0)
    keeper = (51.5, 0.0)
    inside = (44.0, 0.5)
    outside = (44.0, 8.0)
    assert cone_defenders(shooter, 1, [keeper, inside, outside]) == 1
    assert cone_defenders(shooter, 1, []) == 0


def test_shot_features():
    f = shot_features((-41.5, 0.0), -1, True, [])
    assert math.isclose(f[0], 1.1)
    assert f[2] == 1.0 and f[3] == 0.0


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

import math

from touchline_analytics.xt import COLS, ROWS, cell, cell_centre, fit_grid, goal_probs


def test_cells_are_seen_by_the_team_in_possession():
    # Home attacks +x: the right corner of the attacked goal line is the last column.
    assert cell(52.0, 0.5, 1) == 4 * COLS + 11
    # Away attacks -x: the same spot is deep in its own half, rotated half a turn.
    assert cell(52.0, 0.5, -1) == 3 * COLS + 0
    # Points on the touchlines and goal lines stay on the grid.
    assert cell(52.5, 34.0, 1) == ROWS * COLS - 1
    assert cell(-52.5, -34.0, 1) == 0


def test_cell_centres_round_trip():
    for i in range(COLS * ROWS):
        x, y = cell_centre(i)
        assert cell(x, y, 1) == i


def test_scoring_chance_is_highest_in_front_of_goal():
    xg = {"features": ["distance_m", "angle_rad", "header", "line_defenders"], "intercept": -1.0, "coefficients": {"distance_m": -0.1, "angle_rad": 1.2, "header": -1.4, "line_defenders": -0.2}}
    g = goal_probs(xg)
    front = cell(48.0, 0.5, 1)
    assert g[front] == max(g)
    assert g[cell(-48.0, 0.5, 1)] < 0.01


def test_value_iteration_passes_threat_back_along_moves():
    n = COLS * ROWS
    goal = [0.0] * n
    a, b, c = 0, 1, 2
    goal[c] = 0.5
    # Cell c: every action is a shot. Cell b: always a pass to c. Cell a: half its passes reach b, half fail.
    shots = [c] * 10
    moves = [(b, c)] * 10 + [(a, b)] * 5 + [(a, None)] * 5
    xt = fit_grid(shots, moves, goal)
    assert math.isclose(xt[c], 0.5)
    assert math.isclose(xt[b], 0.5)
    assert math.isclose(xt[a], 0.25)
    assert xt[3] == 0.0

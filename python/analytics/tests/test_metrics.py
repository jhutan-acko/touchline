import math

from touchline_analytics.metrics import event_metrics, tracking_metrics


def p(complete=True, length=10.0, set_piece=None):
    return {"type": "pass", "set_piece": set_piece, "complete": complete, "length": length if complete else None, "goal": False, "on_target": False}


def shot(goal=False, on=False):
    return {"type": "shot", "set_piece": None, "complete": False, "length": None, "goal": goal, "on_target": on or goal}


def test_event_metrics_counts_rates_and_lengths():
    ev = [p(length=5), p(length=40), p(complete=False), p(length=20, set_piece="corner"), shot(goal=True), shot(on=True), shot(),
          {"type": "foul", "set_piece": None, "complete": False, "length": None, "goal": False, "on_target": False},
          {"type": "card", "set_piece": None, "complete": False, "length": None, "goal": False, "on_target": False}]
    m = event_metrics(ev)
    assert m["passes"] == 4
    assert m["completion"] == 0.75
    assert m["long_share"] == 1 / 3
    assert m["pass_len_median"] == 20
    assert (m["shots"], m["goals"], m["corners"], m["fouls"], m["cards"]) == (3, 1, 1, 1, 1)
    assert math.isclose(m["on_target_share"], 2 / 3)
    assert math.isclose(sum(m["pass_len_hist"]), 1.0)


def test_event_metrics_empty_match_does_not_crash():
    m = event_metrics([])
    assert m["passes"] == 0 and m["completion"] == 0.0 and math.isnan(m["pass_len_median"])


def test_tracking_metrics_distance_speed_and_in_play():
    frames = []
    for i in range(600):  # 60 s at 10 Hz
        t = i / 10
        players = {f"p{j}": (j * 3.0 + 5.0 * t, 0.0) for j in range(6)}  # everyone runs at 5 m/s
        frames.append(("first_half", t, i % 2 == 0, players))
    m = tracking_metrics(frames)
    assert math.isclose(m["in_play_share"], 0.5)
    assert abs(m["distance_km_median"] - 0.2995) < 0.002  # ~5 m/s * 59.9 s
    assert abs(m["peak_speed_kmh_median"] - 18.0) < 0.1

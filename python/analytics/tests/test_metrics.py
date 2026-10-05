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


def test_touchline_events_reads_details_from_attrs(tmp_path):
    import json

    from touchline_analytics.metrics import touchline_events

    base = {"x": 0.0, "y": 0.0, "x_end": 20.0, "y_end": 0.0}
    lines = [
        {"type": "pass", "outcome": "successful", "attrs": {"restart": "corner"}, **base},
        {"type": "shot", "outcome": "saved", "attrs": {"technique": "penalty"}, **base},
    ]
    f = tmp_path / "domain.jsonl"
    f.write_text("\n".join(json.dumps(x) for x in lines) + "\n")
    ev = touchline_events(f)
    assert ev[0]["set_piece"] == "corner" and ev[0]["length"] == 20.0
    assert ev[1]["set_piece"] == "penalty" and ev[1]["on_target"]


def test_shot_outcome_shares():
    def s(goal=False, on=False, blocked=False):
        return {"type": "shot", "set_piece": None, "complete": False, "length": None, "goal": goal, "on_target": on or goal, "blocked": blocked}

    m = event_metrics([s(goal=True), s(on=True), s(on=True), s(on=True), s(blocked=True), s(), s(), s()])
    assert math.isclose(m["blocked_share"], 1 / 8)
    assert math.isclose(m["save_rate"], 3 / 4)
    empty = event_metrics([])
    assert empty["blocked_share"] == 0.0 and empty["save_rate"] == 0.0

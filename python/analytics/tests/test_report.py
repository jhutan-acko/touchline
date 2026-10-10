import math

from touchline_analytics.report import js_divergence, wasserstein_binned


def test_distribution_distances():
    edges = [0, 1, 2]
    assert wasserstein_binned([1, 0], [1, 0], edges) == 0
    assert wasserstein_binned([1, 0], [0, 1], edges) == 1
    assert js_divergence([0.5, 0.5], [0.5, 0.5]) == 0
    assert math.isclose(js_divergence([1, 0], [0, 1]), 1.0)


def test_statistics_table_shows_relative_error_and_lists_large_misses():
    from touchline_analytics.report import statistics_section

    targets = {"metrics": {"corners": {"mean": 8.0, "sd": 3.0, "n": 7}, "goals": {"mean": 2.7, "sd": 1.5, "n": 7}}}
    lines, counts = statistics_section({"corners": 2.0, "goals": 2.8}, {"corners": 1.0, "goals": 1.2}, targets)
    text = "\n".join(lines)
    assert "| Corners | 8.0 ± 3.0 | 2.0 ± 1.0 | -2.00 | -75 % | within 2 SD |" in text
    assert "+4 %" in text
    assert "More than 30 % from the real mean: Corners (-75 %)." in text
    assert counts == {"within 1 SD": 1, "within 2 SD": 1, "off": 0}


def test_report_labels_every_spatial_metric():
    from touchline_analytics.metrics import SPATIAL_KEYS
    from touchline_analytics.report import LABELS

    assert all(k in LABELS for k in SPATIAL_KEYS)


def test_physics_section_reports_movement_statistics_and_work_rate(tmp_path):
    import json

    import numpy as np

    from touchline_analytics.physics.validate import PLAYER_EDGES, hist
    from touchline_analytics.report import physics_section, simulated_tracks

    run = tmp_path / "m-1"
    run.mkdir()
    (run / "meta.json").write_text(json.dumps({"meta": {"tracking": {"fps": 10}}}))
    frames = [{"period": per, "frame_id": i, "teams": {"home": {"players": [{"id": "a", "x": 2.0 * i / 10, "y": 0.0}]}, "away": {"players": [{"id": "k", "x": 0.0, "y": 0.0}]}}} for per in ("first_half", "second_half") for i in range(27_001)]
    (run / "tracking.jsonl").write_text("\n".join(json.dumps(f) for f in frames))
    tracks, halves = simulated_tracks([run], {"a": "CM", "k": "GK"})
    assert set(tracks) == {"m-1/a", "m-1/k"} and tracks["m-1/a"][0] == "MID" and len(halves["m-1/a"][1]) == 2
    assert np.isnan(tracks["m-1/a"][1][27_001]).all()  # a gap between the halves

    real = {k: hist([e[1]], e) for k, e in PLAYER_EDGES.items()}
    physics = {"validation": {"envelope": {k: {"max": 0.5} for k in PLAYER_EDGES}, "real": {"players": real, "work_rate": {
        "distance": {"ALL": [120.0, 118.0, 110.0, 112.0, 104.0, 100.0]}, "hsr": {"ALL": [8.0] * 6},
        "late_ratio": {"distance": {"mean": 0.91, "min": 0.84, "max": 0.99}, "hsr": {"mean": 0.95, "min": 0.69, "max": 1.22}}}}}}
    text = "\n".join(physics_section(tracks, halves, physics))
    assert "## Player movement against real tracking" in text
    assert "| Top speed per player (m/s) |" in text and "Inside the real envelope:" in text
    assert "| 0–15 | 120.0 | 120.0 |" in text  # real and simulated metres per minute, first 15 minutes
    assert "late-to-early ratio" in text and "real 0.84–0.99" in text


def test_carriers_section_compares_frozen_carriers_per_match_with_real_matches(tmp_path):
    import json

    from touchline_analytics.report import carriers_section, simulated_carrier_halves

    run = tmp_path / "m"
    run.mkdir()
    still = {"frame_id": 0, "period": "first_half", "teams": {"home": {"players": [{"id": "a", "x": 0.4, "y": 0}]}, "away": {"players": [{"id": "k", "x": 40, "y": 0}]}}, "ball": {"x": 0, "y": 0, "z": 0, "status": True}}
    (run / "tracking.jsonl").write_text("".join(json.dumps({**still, "frame_id": i}) + "\n" for i in range(30)))
    halves = simulated_carrier_halves(run, {"a": "ST", "k": "GK"})
    assert len(halves) == 1 and halves[0]["keepers"] == {"k"} and halves[0]["live"].all()
    real = {"real": {"GK": {"count": {"min": 0, "max": 5, "mean": 2.7}, "seconds": {"min": 0, "max": 15.8, "mean": 7.8}},
                     "outfield": {"count": {"min": 0, "max": 1, "mean": 0.1}, "seconds": {"min": 0, "max": 2.5, "mean": 0.4}}}}
    text = "\n".join(carriers_section([{"GK": {"count": 1, "seconds": 3.0, "longest": 3.0}, "outfield": {"count": 0, "seconds": 0.0, "longest": 0.0}},
                                       {"GK": {"count": 0, "seconds": 0.0, "longest": 0.0}, "outfield": {"count": 2, "seconds": 4.0, "longest": 2.5}}], real))
    assert "## Frozen ball carriers" in text
    assert "| Outfielders | 1.0 | 2 | 0–1 (mean 0.1) | 2.0 | 0.0–2.5 |" in text
    assert "| Keepers | 0.5 | 1 | 0–5 (mean 2.7) | 1.5 | 0.0–15.8 |" in text

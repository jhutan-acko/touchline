import json
import math

import numpy as np

from touchline_analytics.bands import bands_section, match_bands, player_bands

REAL = {"walk_m": 3501, "jog_m": 3883, "run_m": 1825, "hsr_m": 521, "sprint_m": 173, "sprints": 8.4, "accelerations": 50,
        "live_m_per_min": 147, "dead_m_per_min": 65, "territory_sd_m": 1.9, "centroid_in_m": 3.9, "centroid_out_m": -9.5}


def test_player_bands_split_speed_bands_sprints_and_live_dead():
    b = player_bands([np.full(600, 1.0), np.full(600, 8.0)], [np.ones(600, bool), np.zeros(600, bool)], 0.1)
    assert math.isclose(b["walk_m"], 2700)
    assert math.isclose(b["sprint_m"], 21600)
    assert b["jog_m"] == b["run_m"] == b["hsr_m"] == 0
    assert math.isclose(b["sprints"], 45)
    assert b["accelerations"] == 0
    assert math.isclose(b["live_m_per_min"], 60)
    assert math.isclose(b["dead_m_per_min"], 480)


def _run(tmp_path):
    d = tmp_path / "m"
    d.mkdir()
    (d / "meta.json").write_text(json.dumps({"teams": {"home": {"id": "H"}, "away": {"id": "A"}}, "meta": {"tracking": {"fps": 10}}}))
    lines = []
    for period, vel, live in (("first_half", 1.0, True), ("second_half", 8.0, False)):
        for _ in range(600):
            lines.append(json.dumps({
                "period": period,
                "teams": {"home": {"id": "H", "players": [{"id": "h1", "x": 15, "y": 0, "vel": vel}, {"id": "hk", "x": -50, "y": 0, "vel": 0}]},
                          "away": {"id": "A", "players": [{"id": "ak", "x": 50, "y": 0, "vel": 0}]}},
                "ball": {"x": 10, "y": 0, "z": 0, "status": live, "poss_team_id": "H"},
            }))
    (d / "tracking.jsonl").write_text("\n".join(lines) + "\n")
    return d


def test_match_bands_reads_full_match_outfielders_territory_and_centroid(tmp_path):
    m = match_bands(_run(tmp_path), {"h1": "CM", "hk": "GK", "ak": "GK"})
    assert len(m["players"]) == 1
    assert math.isclose(m["players"][0]["walk_m"], 2700)
    assert math.isclose(m["territory_x"], 10)
    assert math.isclose(m["centroid_in"], 5)
    assert m["centroid_out"] is None


def test_bands_section_prints_real_against_simulated():
    row = {"walk_m": 2700, "jog_m": 0, "run_m": 0, "hsr_m": 0, "sprint_m": 21600, "sprints": 45, "accelerations": 0,
           "live_m_per_min": 60, "dead_m_per_min": 480}
    text = "\n".join(bands_section([{"players": [row], "territory_x": 10, "centroid_in": 5, "centroid_out": None},
                                    {"players": [], "territory_x": 12, "centroid_in": 3, "centroid_out": -8}], REAL))
    assert "| Walking, under 7 km/h (km per 90) | 3.50 | 2.70 |" in text
    assert "| High-speed running plus sprinting (km per 90) | 0.69 | 21.60 |" in text
    assert "| Territory: SD over matches of the match-mean ball x, home attacking (m) | 1.9 | 1.4 |" in text
    assert "| Outfield centroid minus ball x, team with the ball (m) | +3.9 | +4.0 |" in text
    assert "| Outfield centroid minus ball x, team without it (m) | -9.5 | -8.0 |" in text


def test_targets_keep_the_hand_copied_bands_block(tmp_path):
    from touchline_analytics.targets import keep_hand_blocks

    old = tmp_path / "t.json"
    old.write_text(json.dumps({"metrics": {}, "bands": {"walk_m": 3501}}))
    assert keep_hand_blocks({"metrics": {"x": 1}}, old) == {"metrics": {"x": 1}, "bands": {"walk_m": 3501}}
    assert keep_hand_blocks({"metrics": {}}, tmp_path / "missing.json") == {"metrics": {}}

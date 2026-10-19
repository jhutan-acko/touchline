import json
import math
from collections import Counter
from pathlib import Path

import numpy as np

from touchline_analytics.shots import fit_xg, match_shots, minute_bin, shot_clips, shots_report, shots_section, summarize

TARGETS = Path(__file__).resolve().parents[3] / "data/params/targets-idsse.json"
OUTFIELD = ["CB", "CB", "FB", "FB", "CM", "CM", "AM", "W", "W", "ST"]
H = [f"h{i}" for i in range(11)]
A = [f"a{i}" for i in range(11)]
ROLES = {"h0": "GK", "a0": "GK", **{H[i + 1]: r for i, r in enumerate(OUTFIELD)}, **{A[i + 1]: r for i, r in enumerate(OUTFIELD)}}
# Fillers stand far from the box; each test moves only the players it names.
HOME_REST = {pid: (-45.0 + i, -30.0) for i, pid in enumerate(H)}
AWAY_REST = {pid: (-20.0 + i, 30.0) for i, pid in enumerate(A)}
FPS = 10
HALF = 45 * 60 * FPS  # frames in a 45-minute period


SECOND_START = 28000  # the engine's frame_id runs on through the match; period_frame_id and tracking frame_id restart each period


def _ev(t, f, pid, team="H", period="first_half", outcome=None, x=None, y=None, x_end=None, y_end=None, frame_id_end=None, **attrs):
    """f and frame_id_end are frames of the period, as the tests' tracking frames are."""
    off = SECOND_START if period == "second_half" else 0
    return {"type": t, "frame_id": f + off, "period_frame_id": f, "period": period, "team_id": team, "player_id": pid, "x": x, "y": y,
            "x_end": x_end, "y_end": y_end, "frame_id_end": None if frame_id_end is None else frame_id_end + off, "outcome": outcome, "attrs": attrs}


def _shot(f, pid, x=40.0, y=0.0, outcome="wide", period="first_half", team="H", **attrs):
    return _ev("shot", f, pid, team, period, outcome, x, y, 52.5, 0.0, f + 5, technique=attrs.pop("technique", "normal"),
               body_part=attrs.pop("body_part", "right_foot"), xg=attrs.pop("xg", 0.1), **attrs)


def _pass(f, pid, to, f_end, ok=True, period="first_half", x=20.0, y=0.0, x_end=38.0, y_end=0.0, **attrs):
    return _ev("pass", f, pid, "H", period, "successful" if ok else "incomplete", x, y, x_end, y_end, f_end,
               restart=attrs.pop("restart", None), kind=attrs.pop("kind", "short"), intended_receiver_id=to, **({"receiver_id": to} if ok else {}), **attrs)


def _write(tmp_path, sub, events, frames=None):
    """A match folder at 10 Hz. frames: {(period, frame_id): (home moves, away moves[, ball (x, y)])}; tracking holds only
    those frames; the ball is live and loose."""
    d = tmp_path / sub
    d.mkdir()
    (d / "meta.json").write_text(json.dumps({"teams": {"home": {"id": "H"}, "away": {"id": "A"}}, "meta": {"tracking": {"fps": FPS}}}))
    lines = []
    for (period, f), fr in sorted((frames or {}).items()):
        hm, am, ball = fr if len(fr) == 3 else (*fr, (0.0, 0.0))
        home, away = {**HOME_REST, **hm}, {**AWAY_REST, **am}
        lines.append(json.dumps({"frame_id": f, "period": period,
                                 "teams": {"home": {"id": "H", "players": [{"id": p, "x": x, "y": y, "vel": 0} for p, (x, y) in home.items()]},
                                           "away": {"id": "A", "players": [{"id": p, "x": x, "y": y, "vel": 0} for p, (x, y) in away.items()]}},
                                 "ball": {"x": ball[0], "y": ball[1], "z": 0, "status": True}}))
    (d / "tracking.jsonl").write_text("\n".join(lines) + ("\n" if lines else ""))
    (d / "domain.jsonl").write_text("\n".join(json.dumps(e) for e in events) + "\n")
    return d


KICKOFF = _ev("set_piece", 0, "h9", kind="kickoff")


def _first_time_match(tmp_path):
    return _write(tmp_path, "ft", [
        KICKOFF,
        _pass(200, "h5", "h10", 210), _shot(212, "h10"),  # 2 frames after the reception: first time
        _pass(300, "h5", "h10", 310), _shot(314, "h10"),  # 4 frames after: not
        _ev("ball_recovery", 400, "h10", kind="loose_ball", x=38.0, y=0.0), _shot(405, "h10", first_time=True),  # the attr is ignored
    ])


def test_first_time_by_frames_not_attrs(tmp_path):
    m = match_shots(_first_time_match(tmp_path), ROLES)
    assert [s["first_time"] for s in m["shots"]] == [True, False, False]
    assert math.isclose(summarize([m])["first_time_share"], 1 / 3)


def test_header_and_conversion_by_technique(tmp_path):
    d = _write(tmp_path, "hd", [
        KICKOFF,
        _shot(200, "h10", body_part="head", outcome="goal"), _ev("goal", 205, "h10", scorer_id="h10", own_goal=False),
        _shot(300, "h10", body_part="head"),
        _shot(400, "h10"), _shot(500, "h10", body_part="left_foot"),
        _shot(600, "h10", technique="penalty", outcome="goal"),  # a penalty: counted in shots, not in open play
    ])
    s = summarize([match_shots(d, ROLES)])
    assert s["header_share"] == 0.5 and s["conv_header"] == 0.5
    assert s["shots_per_match"] == 5 and s["open_shots_per_match"] == 4
    assert s["goals_per_match"] == 1 and s["open_conv"] == 0.25


def test_open_play_excludes_shots_within_10s_of_a_set_piece(tmp_path):
    d = _write(tmp_path, "sp", [KICKOFF, _ev("set_piece", 200, "h7", kind="corner"), _shot(299, "h10"), _shot(301, "h10")])
    assert [s["open"] for s in match_shots(d, ROLES)["shots"]] == [False, True]


def test_conversion_by_nearest_defender_mirrors_by_half(tmp_path):
    # Home attacks +x in the first half and -x in the second; each half has a tight goal (defender 1 m) and an open miss (4 m).
    frames = {("first_half", 200): ({}, {"a3": (41.0, 0.0)}), ("first_half", 300): ({}, {"a3": (44.0, 0.0)}),
              ("second_half", 200): ({}, {"a3": (-41.0, 0.0)}), ("second_half", 300): ({}, {"a3": (-44.0, 0.0)})}
    d = _write(tmp_path, "nd", [
        KICKOFF, _shot(200, "h10", outcome="goal"), _shot(300, "h10"),
        _ev("set_piece", 0, "a9", "A", "second_half", kind="kickoff"),
        _pass(190, "h5", "h10", 199, period="second_half", x=-20.0, x_end=-40.0), _shot(200, "h10", x=-40.0, outcome="goal", period="second_half"),
        _shot(300, "h10", x=-40.0, period="second_half"),
    ], frames)
    m = match_shots(d, ROLES)
    assert [(s["first_time"], s["setup"]) for s in m["shots"]][2] == (True, "pass")
    assert [round(s["near_def"], 3) for s in m["shots"]] == [1.0, 4.0, 1.0, 4.0]
    s = summarize([m])
    assert s["conv_tight"] == 1.0 and s["conv_open"] == 0.0 and math.isnan(s["conv_mid"]) and s["conv_tight_minus_open"] == 1.0
    assert s["in_box_share"] == 1.0 and s["in_box_conv"] == 0.5 and math.isnan(s["out_box_conv"])
    assert math.isclose(s["near_def_median"], 2.5)


def test_keeper_off_line_and_bisector(tmp_path):
    frames = {("first_half", 200): ({}, {"a0": (50.5, 1.0)}), ("second_half", 200): ({}, {"a0": (-50.5, -1.0)})}
    d = _write(tmp_path, "gk", [KICKOFF, _shot(200, "h10"), _ev("set_piece", 0, "a9", "A", "second_half", kind="kickoff"),
                                _shot(200, "h10", x=-40.0, period="second_half")], frames)
    m = match_shots(d, ROLES)
    assert [(round(s["gk_off_line"], 3), round(s["gk_off_bisector"], 3)) for s in m["shots"]] == [(2.0, 1.0), (2.0, 1.0)]
    s = summarize([m])
    assert math.isclose(s["gk_off_line_at_shot"], 2.0) and math.isclose(s["gk_off_bisector_at_shot"], 1.0)


def test_completion_by_bin_counts_added_time_in_last_bin(tmp_path):
    s60 = 60 * FPS
    d = _write(tmp_path, "bins", [
        KICKOFF,
        _pass(2 * s60, "h5", "h6", 2 * s60 + 10),  # 2': bin 0
        _pass(2 * s60 + 50, "h5", "h6", 2 * s60 + 60, ok=False),  # 2': bin 0
        _pass(46 * s60, "h5", "h6", 46 * s60 + 10),  # 46' of the first half (added time): bin 2, not bin 3
        _pass(46 * s60 + 50, "h5", "h6", 46 * s60 + 60, restart="throw_in"),  # a restart: not open play
        _ev("set_piece", 0, "a9", "A", "second_half", kind="kickoff"),
        _pass(32 * s60, "h5", "h6", 32 * s60 + 10, period="second_half"),  # 77': bin 5
        _pass(47 * s60, "h5", "h6", 47 * s60 + 10, ok=False, period="second_half"),  # 92' (added time): bin 5
    ])
    m = match_shots(d, ROLES)
    assert m["bins"] == [[1, 2], [0, 0], [1, 1], [0, 0], [0, 0], [1, 2]]
    assert summarize([m])["late_completion_drop"] == 0.0
    assert [minute_bin(1, 46 * 60.0), minute_bin(2, 0.0), minute_bin(2, 47 * 60.0), minute_bin(1, 14.99 * 60)] == [2, 3, 5, 0]


def test_setups_follow_the_analysis_order(tmp_path):
    # h10 carries the ball from x 20 to 40 over frames 610-640 (3 s, 20 m), 0.5 m ahead of the ball.
    carry = {("first_half", f): ({"h10": (20.0 + (f - 610) * 2 / 3, 0.0)}, {}, (19.5 + (f - 610) * 2 / 3, 0.0)) for f in range(605, 641)}
    d = _write(tmp_path, "setup", [
        KICKOFF,
        _pass(200, "h5", "h10", 210, kind="cross"), _shot(211, "h10"),  # cross
        _shot(240, "h9"),  # rebound: a team shot 2.9 s earlier
        _pass(400, "h5", "h10", 410, kind="through"), _shot(412, "h10"),  # through ball
        _pass(600, "h5", "h10", 610, x_end=20.0), _shot(640, "h10", x=40.0),  # 3 s and 20 m on the ball: dribble
        _pass(800, "h5", "h10", 810), _shot(815, "h10"),  # pass
        _ev("ball_recovery", 1000, "h10", kind="loose_ball", x=38.0, y=0.0), _shot(1005, "h10"),  # loose ball or regain
    ], carry)
    rows = match_shots(d, ROLES)["shots"]
    assert [s["setup"] for s in rows] == ["cross", "rebound", "through_ball", "dribble", "pass", "loose_or_regain"]
    assert math.isclose(rows[3]["spell_s"], 3.5) and math.isclose(rows[3]["spell_m"], 70 / 3)


def test_fit_xg_recovers_known_coefficients():
    rng = np.random.default_rng(5)
    true = {"b0": -1.1, "bDist": -0.09, "bAngle": 1.4, "bHeader": -0.9, "bDefenders": -0.25}
    rows = []
    for _ in range(400):
        r = {"dist": float(rng.uniform(5, 30)), "angle": float(rng.uniform(0.1, 1.2)), "header": bool(rng.random() < 0.2),
             "defenders": int(rng.integers(0, 4)), "penalty": False}
        lin = true["b0"] + true["bDist"] * r["dist"] + true["bAngle"] * r["angle"] + true["bHeader"] * r["header"] + true["bDefenders"] * r["defenders"]
        r["xg"] = 1 / (1 + math.exp(-(lin + rng.normal(0, 0.1))))
        rows.append(r)
    rows.append({"dist": 11.0, "angle": 0.65, "header": False, "defenders": 0, "penalty": True, "xg": 0.76})  # penalties are left out
    fit = fit_xg(rows)
    assert set(fit) == set(true)
    for k, v in true.items():
        assert abs(fit[k] - v) < 0.05, (k, fit[k], v)


def test_shot_clips_categories(tmp_path):
    s60 = 60 * FPS
    d = _write(tmp_path, "clips", [
        KICKOFF,
        _pass(200, "h5", "h10", 210), _shot(211, "h10"),  # first time, 0'21"
        _ev("ball_recovery", 600, "h9", kind="loose_ball", x=40.0, y=0.0), _shot(800, "h9", body_part="head"),  # header, 1'20"
        _ev("set_piece", 0, "a9", "A", "second_half", kind="kickoff"),
        _pass(40 * s60 + 30, "h5", "h6", 40 * s60 + 40, ok=False, period="second_half"),  # late misplaced pass, 85'03"
        _pass(5 * s60, "h5", "h10", 5 * s60 + 10, period="second_half"), _shot(5 * s60 + 12, "h10", period="second_half", outcome="goal"),  # 50'01"
    ])
    clips = shot_clips(d)
    assert Counter(c["category"] for c in clips) == Counter({"first_time": 2, "first_time_goal": 1, "header": 1, "late_pass": 1})
    assert [(c["minute"], c["second"]) for c in clips if c["category"] == "first_time_goal"] == [(50, 1)]
    by = {c["category"]: c for c in clips if c["period"] == "first_half" or c["category"] == "late_pass"}
    assert (by["first_time"]["minute"], by["first_time"]["second"], by["first_time"]["player_id"]) == (0, 21, "h10")
    assert (by["header"]["minute"], by["header"]["second"]) == (1, 20)
    assert (by["late_pass"]["minute"], by["late_pass"]["second"], by["late_pass"]["player_id"]) == (85, 3, "h5")


def test_shots_rows_have_targets(tmp_path):
    t = json.loads(TARGETS.read_text())["shots"]
    ms = [match_shots(_first_time_match(tmp_path), ROLES)]
    assert set(summarize(ms)) == set(t["rows"])
    assert set(t["xgFit"]) == {"b0", "bDist", "bAngle", "bHeader", "bDefenders"}
    md = "\n".join(shots_section(ms, t))
    assert "| Shots per match (all) | 24.4 | 3.0 | 21.0–28.0 | NOT MET |" in md
    assert "conversion splits: judge on ≥ 64 matches" in md


def test_report_without_matches_marks_the_simulated_column_pending():
    t = json.loads(TARGETS.read_text())
    md = shots_report([], t, "pending P4 merge", {})
    assert "| Shots per match (all) | 24.4 | pending P4 merge | 21.0–28.0 | — |" in md

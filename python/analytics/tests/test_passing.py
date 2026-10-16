import json
import math

import numpy as np

from touchline_analytics.passing import clogit, match_passing, options, passing_section, summarize

ROLES = {"h1": "CB", "h2": "GK", "h3": "ST", "h4": "CM", "a1": "CB", "a2": "GK"}


def test_options_lane_openness_and_no_line_with_few_opponents():
    pos = {"p": (0, 0, "home"), "t1": (10, 0, "home"), "t2": (0, 20, "home"), "o1": (5, 0.5, "away"), "o2": (0, 23, "away")}
    o = {x["id"]: x for x in options(pos, "first_half", "p", {k: "CM" for k in pos})}
    assert o["t1"]["lane"] == 1 and math.isclose(o["t1"]["open"], math.hypot(5, 0.5)) and o["t1"]["du"] == 10
    assert o["t2"]["lane"] == 0 and math.isclose(o["t2"]["open"], 3.0) and o["t2"]["dv"] == 20
    assert o["t1"]["lb"] == 0 and o["t2"]["lb"] == 0
    # Second half: home attacks -x, so a teammate at x = -10 is 10 m forward.
    o2 = {x["id"]: x for x in options({**pos, "t1": (-10, 0, "home")}, "second_half", "p", {k: "CM" for k in pos})}
    assert o2["t1"]["du"] == 10


def test_clogit_recovers_known_coefficients():
    rng = np.random.default_rng(3)
    b = np.array([-1.3, 0.5, 0.2, -0.5, 1.2, 0.1, 0.9])
    groups = []
    for _ in range(4000):
        x = np.column_stack([rng.uniform(0.4, 6.5, 8), rng.normal(0, 1.5, 8), rng.uniform(0, 4, 8), rng.integers(0, 2, 8), rng.uniform(0, 2, 8), rng.integers(0, 2, 8), (np.arange(8) == 0).astype(float)])
        u = x @ b
        p = np.exp(u - u.max())
        groups.append((x, int(rng.choice(8, p=p / p.sum()))))
    fit, se, n = clogit(groups)
    assert n == 4000
    assert np.all(np.abs(fit - b) < 4 * se)


def _run(tmp_path, away_extra=(), extra_events=()):
    d = tmp_path / "m"
    d.mkdir()
    (d / "meta.json").write_text(json.dumps({"teams": {"home": {"id": "H"}, "away": {"id": "A"}}, "meta": {"tracking": {"fps": 10}}}))
    home = [("h1", -30, 0), ("h2", -48, 0), ("h3", 20, 25), ("h4", -20, 30)]
    away = [("a1", -29.5, 0), ("a2", 50, 0), *away_extra]
    frames = [json.dumps({"frame_id": i, "period": "first_half",
                          "teams": {"home": {"id": "H", "players": [{"id": p, "x": x, "y": y, "vel": 0} for p, x, y in home]},
                                    "away": {"id": "A", "players": [{"id": p, "x": x, "y": y, "vel": 0} for p, x, y in away]}},
                          "ball": {"x": -30, "y": 0, "z": 0, "status": True, "poss_team_id": "H"}}) for i in range(300)]
    (d / "tracking.jsonl").write_text("\n".join(frames) + "\n")

    def ev(t, f, pid, team="H", **kw):
        e = {"type": t, "frame_id": f, "period_frame_id": f, "period": "first_half", "team_id": team, "player_id": pid,
             "x": kw.pop("x", None), "y": kw.pop("y", None), "x_end": kw.pop("x_end", None), "y_end": kw.pop("y_end", None),
             "frame_id_end": kw.pop("frame_id_end", None), "outcome": kw.pop("outcome", None), "attrs": kw}
        return json.dumps(e)

    events = [
        ev("set_piece", 0, "h1", kind="kickoff"),
        # Intercepted on the first tick, 0.4 m from the passer, with an opponent within 1 m.
        ev("pass", 10, "h1", x=-30, y=0, x_end=-29.6, y_end=0, frame_id_end=11, outcome="intercepted", restart=None, kind="short", intended_receiver_id="h3"),
        # A switch (|dy| 30).
        ev("pass", 20, "h1", x=-30, y=0, x_end=-20, y_end=30, frame_id_end=30, outcome="successful", restart=None, kind="switch", intended_receiver_id="h4", receiver_id="h4"),
        # Back to the keeper.
        ev("pass", 30, "h1", x=-30, y=0, x_end=-48, y_end=0, frame_id_end=35, outcome="successful", restart=None, kind="back", intended_receiver_id="h2", receiver_id="h2"),
        ev("reception", 40, "h4", first_touch="controlled"),
        ev("pass", 45, "h4", x=-20, y=30, x_end=-30, y_end=10, frame_id_end=50, outcome="successful", restart=None, kind="short", intended_receiver_id="h1", receiver_id="h1"),
        # A cross 20 s after the kickoff, ending 7.5 m from the goal line.
        ev("pass", 200, "h3", x=20, y=25, x_end=45, y_end=2, frame_id_end=210, outcome="intercepted", restart=None, kind="cross", intended_receiver_id="h1"),
        ev("keeper_distribution", 250, "h2", method="punt"),
        *extra_events,
    ]
    (d / "domain.jsonl").write_text("\n".join(events) + "\n")
    return d


def test_match_passing_counts_each_measure(tmp_path):
    s = summarize([match_passing(_run(tmp_path), ROLES)])
    assert math.isclose(s["first_tick_share"], 1 / 5)
    assert math.isclose(s["switch_share"], 1 / 5)
    assert math.isclose(s["back_gk_share"], 1 / 5)
    # h1 passes three times with a1 0.5 m away: intercepted, then two completions.
    assert math.isclose(s["near1_completion"], 2 / 3)
    assert s["crosses_per_match"] == 1 and math.isclose(s["cross_contact_m"], 7.5)
    assert s["punts_per_team"] == 0.5 and s["keeper_passes_per_team"] == 0
    assert math.isclose(s["release_median_s"], 0.5)
    assert s["ball_own_third"] == 1.0 and math.isclose(s["ball_u_mean"], -30)


def test_passing_section_marks_met_and_not_met(tmp_path):
    t = {"rows": {"switch_share": {"label": "Switches", "real": 0.061, "lo": 0.04, "hi": 0.08, "fmt": "{:.3f}"},
                  "back_gk_share": {"label": "Back to the keeper", "real": 0.062, "lo": 0.045, "hi": 0.3, "fmt": "{:.3f}"}},
         "choice": {"features": ["a"], "b": [0.0], "se": [1.0]}}
    md = "\n".join(passing_section([match_passing(_run(tmp_path), ROLES)], t))
    assert "| Switches | 0.061 | 0.200 | 0.040–0.080 | NOT MET |" in md
    assert "| Back to the keeper | 0.062 | 0.200 | 0.045–0.300 | MET |" in md


def test_pressure_event_between_reception_and_pass_keeps_the_release_pressed(tmp_path):
    # An opponent 1 m from h4 and a pressure event by him between h4's reception (frame 40) and pass (frame 45).
    press = json.dumps({"type": "pressure", "frame_id": 42, "period_frame_id": 42, "period": "first_half", "team_id": "A", "player_id": "a3",
                        "x": None, "y": None, "x_end": None, "y_end": None, "frame_id_end": None, "outcome": None, "attrs": {}})
    d = _run(tmp_path, away_extra=[("a3", -20, 31)])
    lines = (d / "domain.jsonl").read_text().splitlines()
    i = next(k for k, line in enumerate(lines) if json.loads(line)["frame_id"] == 45)
    (d / "domain.jsonl").write_text("\n".join(lines[:i] + [press] + lines[i:]) + "\n")
    m = match_passing(d, {**ROLES, "a3": "CB"})
    assert m["release"] == [(0.5, 1.0)]
    s = summarize([m])
    assert math.isclose(s["release_median_lt2_s"], 0.5) and s["release_under1_lt2"] == 1.0


def test_pipes_in_labels_are_escaped(tmp_path):
    t = {"rows": {"switch_share": {"label": "Switches (|dy| > 25 m)", "real": 0.061, "lo": 0.04, "hi": 0.08, "fmt": "{:.3f}"}},
         "choice": {"features": ["|dv|/10"], "b": [0.0], "se": [1.0]}}
    md = "\n".join(passing_section([match_passing(_run(tmp_path), ROLES)], t))
    assert "| Switches (\\|dy\\| > 25 m) |" in md

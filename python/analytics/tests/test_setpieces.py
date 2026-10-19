import json
import math
from pathlib import Path

from touchline_analytics.setpieces import match_setpieces, setpieces_section, summarize

TARGETS = Path(__file__).resolve().parents[3] / "data/params/targets-idsse.json"
OUTFIELD = ["CB", "CB", "FB", "FB", "CM", "CM", "AM", "W", "W", "ST"]


def _team(prefix: str) -> tuple[list[str], dict[str, str]]:
    """Eleven ids, keeper first: <prefix>0 is the GK, <prefix>1..<prefix>10 outfielders (h3 FB, h8 W, ...)."""
    ids = [f"{prefix}{i}" for i in range(11)]
    return ids, {ids[0]: "GK", **{ids[i + 1]: r for i, r in enumerate(OUTFIELD)}}


H, HR = _team("h")
A, AR = _team("a")
ROLES = {**HR, **AR}
# Fillers stand far from everything; tests move only the players they name.
HOME_REST = {pid: (-45.0 + i, -30.0) for i, pid in enumerate(H)}
AWAY_REST = {pid: (45.0 - i, 30.0) for i, pid in enumerate(A)}


def _ev(t, f, pid, team, period="first_half", **attrs):
    return {"type": t, "frame_id": f, "period_frame_id": f, "period": period, "team_id": team, "player_id": pid,
            "x": attrs.pop("x", None), "y": attrs.pop("y", None), "x_end": None, "y_end": None, "frame_id_end": None,
            "outcome": attrs.pop("outcome", None), "attrs": attrs}


def _write(tmp_path, sub, n, layout, events, period_of=lambda f: "first_half"):
    """A match folder: n frames at 10 Hz; layout(f) -> (home {id: (x, y)}, away {id: (x, y)}, ball (x, y), live, poss 'H'/'A'/None)."""
    d = tmp_path / sub
    d.mkdir()
    (d / "meta.json").write_text(json.dumps({"teams": {"home": {"id": "H"}, "away": {"id": "A"}}, "meta": {"tracking": {"fps": 10}}}))
    lines = []
    for f in range(n):
        home, away, ball, live, poss = layout(f)
        b = {"x": ball[0], "y": ball[1], "z": 0, "status": live, **({"poss_team_id": poss} if poss else {})}
        lines.append(json.dumps({"frame_id": f, "period": period_of(f),
                                 "teams": {"home": {"id": "H", "players": [{"id": p, "x": x, "y": y, "vel": 0} for p, (x, y) in home.items()]},
                                           "away": {"id": "A", "players": [{"id": p, "x": x, "y": y, "vel": 0} for p, (x, y) in away.items()]}},
                                 "ball": b}))
    (d / "tracking.jsonl").write_text("\n".join(lines) + "\n")
    (d / "domain.jsonl").write_text("\n".join(json.dumps(e) for e in events) + "\n")
    return d


# A home corner from (52.5, 34), home attacking +x: six attackers in the box (h1 in the six-yard box), h8 and h9 kept back
# at u < 28, h10 outside the box but beyond u 28; nine away outfielders in the box, five of them within 2 m of an attacker.
CORNER_HOME = {"h0": (-40.0, 0.0), "h1": (48.0, 0.0), "h2": (44.0, 5.0), "h3": (44.0, -5.0), "h4": (40.0, 10.0), "h5": (52.5, 34.0),
               "h6": (42.0, -12.0), "h7": (38.0, 15.0), "h8": (10.0, 0.0), "h9": (20.0, 10.0), "h10": (30.0, 25.0)}
CORNER_AWAY = {"a0": (52.0, 0.0), "a1": (47.0, 1.0), "a2": (43.0, 5.0), "a3": (43.0, -5.0), "a4": (41.0, 10.0), "a5": (30.0, -25.0),
               "a6": (42.0, -13.0), "a7": (50.0, 5.0), "a8": (50.0, -5.0), "a9": (46.0, -15.0), "a10": (38.0, 0.0)}


def _corner(tmp_path, sub, period, sign):
    flip = lambda pos: {p: (sign * x, y) for p, (x, y) in pos.items()}  # noqa: E731
    spot = (sign * 52.5, 34.0)

    def layout(f):
        return flip(CORNER_HOME), flip(CORNER_AWAY), spot if f >= 10 else (0.0, 0.0), f < 10 or f >= 50, "H" if f >= 50 else None

    events = [_ev("set_piece", 50, "h5", "H", period=period, kind="corner", x=spot[0], y=spot[1])]
    return _write(tmp_path, sub, 80, layout, events, period_of=lambda f: period)


def test_corner_snapshot_counts_box_six_rest_and_tight(tmp_path):
    s = summarize([match_setpieces(_corner(tmp_path, "m", "first_half", 1), ROLES)])
    assert s["corner_att_box"] == 6 and s["corner_att_six"] == 1 and s["corner_rest"] == 2
    assert s["corner_def_box"] == 9 and math.isclose(s["corner_tight"], 5 / 9) and s["corner_def_up"] == 0


def test_frame_mirrors_after_half_time(tmp_path):
    s = summarize([match_setpieces(_corner(tmp_path, "m", "second_half", -1), ROLES)])
    assert s["corner_att_box"] == 6 and s["corner_att_six"] == 1 and s["corner_rest"] == 2
    assert s["corner_def_box"] == 9 and math.isclose(s["corner_tight"], 5 / 9)


def test_wall_counts_players_in_the_cone(tmp_path):
    # A central home free kick at (25, 0): three away outfielders 9 m out at 0, +15 and -20 degrees, one 9 m out at 40 degrees.
    at = lambda deg: (25.0 + 9 * math.cos(math.radians(deg)), 9 * math.sin(math.radians(deg)))  # noqa: E731

    def layout(f):
        return {**HOME_REST, "h5": (25.0, 0.0)}, {**AWAY_REST, "a5": at(0), "a6": at(15), "a7": at(-20), "a8": at(40)}, (25.0, 0.0), f >= 20, "H"

    events = [_ev("set_piece", 20, "h5", "H", kind="free_kick", x=25.0, y=0.0)]
    s = summarize([match_setpieces(_write(tmp_path, "m", 40, layout, events), ROLES)])
    assert s["wall_central_present"] == 1 and s["wall_central_players"] == 3
    assert math.isclose(s["wall_min_dist_m"], 9.0, abs_tol=1e-6)


def test_goal_kick_first_contact_long_and_completion(tmp_path):
    # Home goal kicks from (-47, 3) at frames 20 and 120, the ball at 20 m/s along y = 3: the first is met by h5 40 m out,
    # the second by h6 12 m out.
    spot = (-47.0, 3.0)

    def ball(f):
        for k0, end in ((20, -7.0), (120, -35.0)):
            if k0 <= f < k0 + 100:
                return (min(spot[0] + 2.0 * (f - k0), end), 3.0)
        return spot

    def layout(f):
        home = {**HOME_REST, "h0": spot, "h5": (-7.0, 3.0) if f < 120 else (-7.0, -20.0), "h6": (-35.0, 3.0) if f >= 120 else (-35.0, -20.0)}
        return home, AWAY_REST, ball(f), f >= 20, "H"

    events = [_ev("set_piece", 20, "h0", "H", kind="goal_kick", x=spot[0], y=spot[1]),
              _ev("set_piece", 120, "h0", "H", kind="goal_kick", x=spot[0], y=spot[1])]
    s = summarize([match_setpieces(_write(tmp_path, "m", 200, layout, events), ROLES)])
    assert s["gk_long_share"] == 0.5 and s["gk_long_completion"] == 1.0


def test_dead_time_by_key(tmp_path):
    # Dead 10-22 s, then a home throw-in at 22 s (12 s dead); dead 30-70 s, then a home free kick at (30, 5) at 70 s (40 s dead).
    def layout(f):
        live = f < 100 or 220 <= f < 300 or f >= 700
        return HOME_REST, AWAY_REST, (0.0, 0.0), live, "H" if live else None

    events = [_ev("set_piece", 220, "h3", "H", kind="throw_in", x=0.0, y=34.0),
              _ev("set_piece", 700, "h5", "H", kind="free_kick", x=30.0, y=5.0)]
    s = summarize([match_setpieces(_write(tmp_path, "m", 750, layout, events), ROLES)])
    assert s["dead_throw_in_s"] == 12 and s["dead_fk_att_s"] == 40
    assert math.isnan(s["dead_corner_s"])


def test_kickoff_dead_time_only_after_a_goal(tmp_path):
    # Two kickoffs, each after 30 s dead in the same period; only the one after a goal counts (period-start kickoffs emit
    # set_piece kickoff too).
    def layout(f):
        live = f < 100 or 400 <= f < 500 or f >= 800
        return HOME_REST, AWAY_REST, (0.0, 0.0), live, "H" if live else None

    events = [_ev("set_piece", 400, "h10", "H", kind="kickoff", x=0.0, y=0.0),
              _ev("goal", 500, "a10", "A"), _ev("set_piece", 800, "h10", "H", kind="kickoff", x=0.0, y=0.0)]
    m = match_setpieces(_write(tmp_path, "m", 850, layout, events), ROLES)
    assert [r["dead"] is not None for r in m["restarts"]] == [False, True]
    assert summarize([m])["dead_kickoff_s"] == 30


def test_overlap_episode_needs_fb_outside_and_beyond_the_w(tmp_path):
    # Home in possession, AM h7 on the ball at the centre spot; W h8 holds (20, 20). FB h3 runs 16 -> 21 m at 5 m/s along
    # y = width: passing beyond the W (u >= his u - 2) faster than 3 m/s for 0.6 s.
    def run(sub, width):
        def layout(f):
            x = 16.0 + 0.5 * min(max(f - 50, 0), 10)
            home = {**HOME_REST, "h7": (0.0, 0.0), "h8": (20.0, 20.0), "h3": (x, width)}
            return home, AWAY_REST, (0.0, 0.0), True, "H"

        return match_setpieces(_write(tmp_path, sub, 100, layout, []), ROLES)

    outside = run("outside", 25.0)
    assert outside["moves"]["fb_overlap"] == 1 and summarize([outside])["fb_overlap"] == 0.5
    assert run("inside", 15.0)["moves"]["fb_overlap"] == 0


def test_setpieces_rows_have_targets(tmp_path):
    t = json.loads(TARGETS.read_text())["setpieces"]
    ms = [match_setpieces(_corner(tmp_path, "m", "first_half", 1), ROLES)]
    assert set(summarize(ms)) == set(t["rows"])
    md = "\n".join(setpieces_section(ms, t))
    assert "| Corners: attackers in the box, taker excluded | 5.49 | 6.00 | 4.80–6.20 | MET |" in md
    assert "11 real free kicks" in md and "≥ 64 matches" in md

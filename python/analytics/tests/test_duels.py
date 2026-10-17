import json
import math
from pathlib import Path

from touchline_analytics.duels import duels_section, match_duels, summarize

TARGETS = Path(__file__).resolve().parents[3] / "data/params/targets-idsse.json"
OUTFIELD = ["CB", "CB", "FB", "FB", "CM", "CM", "AM", "W", "W", "ST"]


def _team(prefix: str) -> tuple[list[str], dict[str, str]]:
    """Eleven ids, keeper first: <prefix>0 is the GK, <prefix>1..<prefix>10 outfielders."""
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
            "outcome": attrs.get("outcome"), "attrs": attrs}


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


def _tackles(tmp_path):
    """Home carrier h5 standing at the origin; a5 tackles four times (frames 10, 20, 30, 40); a6 supports at 4 m only at 30."""
    def layout(f):
        tackler = (1.5, 0.0) if f < 25 else (-1.5, 0.0)
        support = (0.0, 4.0) if 25 <= f < 35 else (0.0, 20.0)
        return {**HOME_REST, "h5": (0.0, 0.0)}, {**AWAY_REST, "a5": tackler, "a6": support}, (0.0, 0.0), True, "H"

    events = [_ev("tackle", 10, "a5", "A", outcome="won", opponent_id="h5", ball="won"),
              _ev("tackle", 20, "a5", "A", outcome="lost", opponent_id="h5"),
              _ev("tackle", 30, "a5", "A", outcome="won", opponent_id="h5", ball="loose"),
              _ev("tackle", 40, "a5", "A", outcome="foul", opponent_id="h5")]
    return _write(tmp_path, "tackles", 50, layout, events)


def test_tackle_win_split_by_bearing_and_support(tmp_path):
    s = summarize([match_duels(_tackles(tmp_path), ROLES)])
    assert s["tackle_win"] == 0.5
    assert s["tackle_win_front"] == 0.5 and s["tackle_win_behind"] == 0.5
    assert math.isclose(s["tackle_win_alone"], 1 / 3) and s["tackle_win_support"] == 1.0
    assert s["ground_duels_per_match"] == 4


def test_take_on_tackle_is_not_a_tackle_attempt(tmp_path):
    # A lost take-on also emits a won tackle by the beaten-for-the-ball defender (step.ts take_on): one ground duel, not two.
    def layout(f):
        return {**HOME_REST, "h5": (0.0, 0.0)}, {**AWAY_REST, "a5": (1.5, 0.0)}, (0.0, 0.0), True, "H"

    events = [_ev("take_on", 10, "h5", "H", outcome="lost", defender_id="a5"), _ev("tackle", 10, "a5", "A", outcome="won", opponent_id="h5")]
    s = summarize([match_duels(_write(tmp_path, "m", 20, layout, events), ROLES)])
    assert s["ground_duels_per_match"] == 1 and math.isnan(s["tackle_win"]) and s["take_on_def_win"] == 1.0


def test_standing_carrier_uses_attack_direction(tmp_path):
    # Carrier at 0 m/s, defender goal-side of him: in front in the first half (home attacks +x) and, mirrored, in the second.
    def run(sub, period, sign):
        def layout(f):
            return {**HOME_REST, "h5": (sign * 10.0, 0.0)}, {**AWAY_REST, "a5": (sign * 11.5, 0.0)}, (sign * 10.0, 0.0), True, "H"

        events = [_ev("tackle", 10, "a5", "A", period=period, outcome="won", opponent_id="h5", ball="won")]
        return summarize([match_duels(_write(tmp_path, sub, 20, layout, events, period_of=lambda f: period), ROLES)])

    for s in (run("first", "first_half", 1), run("second", "second_half", -1)):
        assert s["tackle_win_front"] == 1.0 and math.isnan(s["tackle_win_behind"])
    # The same spot in the second half is behind him.
    s = run("wrong", "second_half", 1)
    assert s["tackle_win_behind"] == 1.0 and math.isnan(s["tackle_win_front"])


def test_moving_carrier_uses_his_velocity(tmp_path):
    # Home carrier running toward his own goal (-x) at 2 m/s in the first half: a defender at -x is in front of him.
    def layout(f):
        x = -0.2 * f
        return {**HOME_REST, "h5": (x, 0.0)}, {**AWAY_REST, "a5": (x - 1.5, 0.0)}, (x, 0.0), True, "H"

    events = [_ev("tackle", 10, "a5", "A", outcome="won", opponent_id="h5", ball="won")]
    s = summarize([match_duels(_write(tmp_path, "m", 20, layout, events), ROLES)])
    assert s["tackle_win_front"] == 1.0


def test_fouls_by_kind_and_cards_per_foul(tmp_path):
    def layout(f):
        return HOME_REST, AWAY_REST, (0.0, 0.0), True, "H"

    events = [_ev("foul", 10, "a5", "A", kind="tackle", victim_id="h5"), _ev("card", 10, "a5", "A", colour="yellow"),
              _ev("foul", 12, "a6", "A", kind="take_on", victim_id="h6"), _ev("card", 12, "a6", "A", colour="yellow"),
              _ev("foul", 14, "h5", "H", kind="shielding", victim_id="a5"),
              _ev("foul", 16, "a7", "A", kind="aerial", victim_id="h7"),
              _ev("card", 18, "h8", "H", colour="yellow", reason="conduct")]
    s = summarize([match_duels(_write(tmp_path, "m", 20, layout, events), ROLES)])
    assert s["defender_fouls_per_match"] == 2 and s["attacker_fouls_per_match"] == 1 and s["aerial_fouls_per_match"] == 1
    assert s["fouls_per_match"] == 4 and s["cards_per_foul"] == 0.5 and s["yellows_per_match"] == 3 and s["sent_off_per_match"] == 0


def test_fk_within_30m_mirrors_by_half(tmp_path):
    def run(sub, period):
        events = [_ev("set_piece", 5, "h5", "H", period=period, kind="free_kick", x=25.0, y=0.0)]
        return summarize([match_duels(_write(tmp_path, sub, 10, lambda f: (HOME_REST, AWAY_REST, (0.0, 0.0), True, "H"), events,
                                             period_of=lambda f: period), ROLES)])

    assert run("first", "first_half")["fk_30m_per_match"] == 1
    assert run("second", "second_half")["fk_30m_per_match"] == 0


def _loss(tmp_path):
    """Home holds the ball 10 s, then away has it (ball live 10 s more). At the loss, h5 is 3 m from the ball and h6 12 m."""
    def layout(f):
        home = {**HOME_REST, "h5": (23.0, 0.0), "h6": (32.0, 0.0)}
        return home, AWAY_REST, (20.0, 0.0), True, "H" if f < 100 else "A"

    return _write(tmp_path, "loss", 200, layout, [])


def test_join_reach_by_distance_bins(tmp_path):
    s = summarize([match_duels(_loss(tmp_path), ROLES)])
    assert s["join_0_5"] == 1 and s["join_10_15"] == 0
    assert s["cp_reach5"] == 1 and s["cp_reach5_ge3"] == 0
    assert s["regain_5s"] == 0


def test_press_episode_needs_one_second_below_two(tmp_path):
    # Home keeps the ball 40 s; a5 and a6 step within 3 m of the carrier at 15 s and again `gap` frames later, one 5 Hz sample each.
    def run(sub, gap):
        def layout(f):
            near = f in (150, 151, 150 + gap, 151 + gap)
            away = {**AWAY_REST, "a5": (1.0, 0.0) if near else (0.0, 25.0), "a6": (-1.0, 0.0) if near else (0.0, -25.0)}
            return {**HOME_REST, "h5": (0.0, 0.0)}, away, (0.5, 0.0), True, "H"

        return match_duels(_write(tmp_path, sub, 400, layout, []), ROLES)

    assert len(run("near", 6)["press_eps"]) == 1
    assert len(run("far", 12)["press_eps"]) == 2


def test_duels_rows_have_targets(tmp_path):
    t = json.loads(TARGETS.read_text())["duels"]
    ms = [match_duels(_tackles(tmp_path), ROLES)]
    assert set(summarize(ms)) == set(t["rows"])
    md = "\n".join(duels_section(ms, t))
    assert "| Tackle attempts won by the defender | 0.480 | 0.500 | 0.430–0.530 | MET |" in md
    assert "≥ 64 matches" in md

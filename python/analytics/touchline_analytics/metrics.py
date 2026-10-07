"""Match statistics with ONE definition for real and synthetic data.

Both sources are first converted to the same plain records, then measured by the same functions:
- events: dicts {type: pass|shot|foul|card, set_piece: None|corner|throw_in|goal_kick|free_kick|kick_off|penalty,
  complete: bool, length: float|None, goal: bool, on_target: bool, blocked: bool (shots; optional, default False)}
- frames: iterables of (period, t_seconds, ball_in_play, {player_id: (x, y)})

The TypeScript port (packages/calibrate/src/metrics.ts) must produce identical numbers; a parity
test runs both on the same synthetic match.
"""

from __future__ import annotations

import json
import math
from collections import defaultdict
from pathlib import Path
from typing import Iterable

LONG_PASS_M = 32.0
PASS_LEN_EDGES = [0, 5, 10, 15, 20, 25, 30, 35, 40, 50, 60, 80, 120]
SPEED_EDGES = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 12]
FULL_MATCH_SHARE = 0.95


def _hist(values: list[float], edges: list[float]) -> list[float]:
    counts = [0] * (len(edges) - 1)
    for v in values:
        for i in range(len(edges) - 1):
            if edges[i] <= v < edges[i + 1]:
                counts[i] += 1
                break
    total = sum(counts) or 1
    return [c / total for c in counts]


def _median(values: list[float]) -> float:
    s = sorted(values)
    if not s:
        return float("nan")
    m = len(s) // 2
    return s[m] if len(s) % 2 else (s[m - 1] + s[m]) / 2


def event_metrics(events: list[dict]) -> dict:
    passes = [e for e in events if e["type"] == "pass"]
    complete = [e for e in passes if e["complete"]]
    lengths = [e["length"] for e in complete if e["length"] is not None]
    shots = [e for e in events if e["type"] == "shot"]
    on_target = sum(1 for e in shots if e["on_target"])
    sp = lambda k: sum(1 for e in passes if e["set_piece"] == k)  # noqa: E731
    return {
        "passes": len(passes),
        "completion": len(complete) / len(passes) if passes else 0.0,
        "long_share": sum(1 for v in lengths if v >= LONG_PASS_M) / len(lengths) if lengths else 0.0,
        "pass_len_median": _median(lengths),
        "shots": len(shots),
        "on_target_share": on_target / len(shots) if shots else 0.0,
        "blocked_share": sum(1 for e in shots if e.get("blocked", False)) / len(shots) if shots else 0.0,
        "save_rate": sum(1 for e in shots if e["on_target"] and not e["goal"]) / on_target if on_target else 0.0,
        "goals": sum(1 for e in shots if e["goal"]),
        "penalties": sum(1 for e in shots if e["set_piece"] == "penalty"),
        "corners": sp("corner"),
        "throw_ins": sp("throw_in"),
        "goal_kicks": sp("goal_kick"),
        "free_kicks": sp("free_kick"),
        "fouls": sum(1 for e in events if e["type"] == "foul"),
        "cards": sum(1 for e in events if e["type"] == "card"),
        "pass_len_hist": _hist(lengths, PASS_LEN_EDGES),
    }


def tracking_metrics(frames: Iterable[tuple[str, float, bool, dict[str, tuple[float, float]]]], smooth_s: float = 0.2) -> dict:
    """In-play share, distance per (near) full-match outfielder and peak speeds, from positions only.

    Speeds use a centred moving average over `smooth_s` seconds of positions, so 10 Hz synthetic
    and 25 Hz real tracking are treated alike.
    """
    in_play = 0
    total = 0
    series: dict[str, list[tuple[str, float, float, float]]] = defaultdict(list)
    for period, t, live, players in frames:
        total += 1
        in_play += 1 if live else 0
        for pid, (x, y) in players.items():
            series[pid].append((period, t, x, y))
    dists: dict[str, float] = {}
    peaks: dict[str, float] = {}
    speeds_all: list[float] = []
    for pid, pts in series.items():
        if len(pts) < 10:
            continue
        dt = (pts[-1][1] - pts[0][1]) / max(1, len(pts) - 1)
        if dt <= 0:
            continue
        w = max(1, round(smooth_s / dt))
        xs = [p[2] for p in pts]
        ys = [p[3] for p in pts]
        sx = [sum(xs[max(0, i - w // 2): i + w // 2 + 1]) / len(xs[max(0, i - w // 2): i + w // 2 + 1]) for i in range(len(xs))]
        sy = [sum(ys[max(0, i - w // 2): i + w // 2 + 1]) / len(ys[max(0, i - w // 2): i + w // 2 + 1]) for i in range(len(ys))]
        d = 0.0
        sp: list[float] = []
        for i in range(1, len(pts)):
            if pts[i][0] != pts[i - 1][0] or pts[i][1] - pts[i - 1][1] > 2 * dt + 1e-9:
                continue
            step = math.hypot(sx[i] - sx[i - 1], sy[i] - sy[i - 1])
            v = step / (pts[i][1] - pts[i - 1][1])
            if v > 12:
                continue
            d += step
            sp.append(v)
        dists[pid] = d
        sp.sort()
        peaks[pid] = sp[min(len(sp) - 1, int(len(sp) * 0.999))] if sp else 0.0
        speeds_all.extend(sp[:: max(1, len(sp) // 2000)])
    frames_per_player = {pid: len(p) for pid, p in series.items()}
    longest = max(frames_per_player.values()) if frames_per_player else 0
    full = [pid for pid, n in frames_per_player.items() if n >= FULL_MATCH_SHARE * longest]
    full_d = sorted(dists[pid] for pid in full if pid in dists)
    outfield_full = full_d[2:] if len(full_d) > 4 else full_d  # drop the two keepers (shortest distances)
    return {
        "in_play_share": in_play / total if total else 0.0,
        "distance_km_median": _median(outfield_full) / 1000 if outfield_full else float("nan"),
        "peak_speed_kmh_median": _median([peaks[p] * 3.6 for p in full if p in peaks]),
        "speed_hist": _hist(speeds_all, SPEED_EDGES),
    }


SPATIAL_SAMPLE_S = 1.0
SUPPORT_RADIUS_M = 15.0
SPATIAL_KEYS = ["width_poss_m", "width_def_m", "length_def_m", "line_height_def_m", "ball_pressure_m", "support_15m", "free_space_m"]


def spatial_metrics(frames: Iterable[tuple], half_length: float = 52.5) -> dict:
    """Team shape and space, once a second, on live frames with a team in possession.

    frames: (period, t_seconds, ball_in_play, poss "home"|"away"|None, ball (x, y)|None, {"home": [(x, y)], "away": [(x, y)]}).
    Each team's attack direction per period comes from its mean x in that period's first frame (teams change ends).
    """
    dirs: dict[str, dict[str, int]] = {}
    last_sec: dict[str, int] = {}
    w_poss: list[float] = []
    w_def: list[float] = []
    length: list[float] = []
    line: list[float] = []
    press: list[float] = []
    support: list[float] = []
    space: list[float] = []
    for period, t, live, poss, ball, teams in frames:
        if period not in dirs and teams["home"] and teams["away"]:
            dirs[period] = {s: 1 if sum(p[0] for p in teams[s]) / len(teams[s]) < 0 else -1 for s in ("home", "away")}
        if not live or poss not in ("home", "away") or ball is None or period not in dirs:
            continue
        sec = math.floor(t / SPATIAL_SAMPLE_S + 1e-6)
        if last_sec.get(period) == sec:
            continue
        last_sec[period] = sec
        def_side = "away" if poss == "home" else "home"
        att, dfn = teams[poss], teams[def_side]
        if len(att) < 3 or len(dfn) < 3:
            continue
        w_poss.append(max(p[1] for p in att) - min(p[1] for p in att))
        w_def.append(max(p[1] for p in dfn) - min(p[1] for p in dfn))
        u = sorted(dirs[period][def_side] * p[0] for p in dfn)
        length.append(u[-1] - u[1])
        line.append(u[1] + half_length)
        bx, by = ball
        press.append(min(math.hypot(p[0] - bx, p[1] - by) for p in dfn))
        support.append(max(0, sum(1 for p in att if math.hypot(p[0] - bx, p[1] - by) <= SUPPORT_RADIUS_M) - 1))
        carrier = min(range(len(att)), key=lambda i: math.hypot(att[i][0] - bx, att[i][1] - by))
        space.append(_median([min(math.hypot(p[0] - q[0], p[1] - q[1]) for q in dfn) for i, p in enumerate(att) if i != carrier]))
    return {
        "width_poss_m": _median(w_poss),
        "width_def_m": _median(w_def),
        "length_def_m": _median(length),
        "line_height_def_m": _median(line),
        "ball_pressure_m": _median(press),
        "support_15m": sum(support) / len(support) if support else float("nan"),
        "free_space_m": _median(space),
    }


# ---------------------------------------------------------------- adapters: Touchline output


_SET_PIECE = {"corner": "corner", "throw_in": "throw_in", "goal_kick": "goal_kick", "free_kick": "free_kick", "kickoff": "kick_off", "penalty": "penalty"}


def touchline_events(domain_jsonl: Path) -> list[dict]:
    out = []
    with domain_jsonl.open() as fh:
        for line in fh:
            e = json.loads(line)
            t = e["type"]
            a = e["attrs"]
            if t == "pass":
                ok = e["outcome"] == "successful"
                length = math.hypot(e["x_end"] - e["x"], e["y_end"] - e["y"]) if ok and e["x_end"] is not None else None
                out.append({"type": "pass", "set_piece": _SET_PIECE.get(a.get("restart") or "", None), "complete": ok, "length": length, "goal": False, "on_target": False})
            elif t == "shot":
                sp = "penalty" if a.get("technique") == "penalty" else None
                out.append({"type": "shot", "set_piece": sp, "complete": False, "length": None, "goal": e["outcome"] == "goal", "on_target": e["outcome"] in ("goal", "saved"), "blocked": e["outcome"] == "blocked"})
            elif t in ("foul", "card"):
                out.append({"type": t, "set_piece": None, "complete": False, "length": None, "goal": False, "on_target": False})
    return out


def touchline_spatial_frames(run_dir: Path, fps: float):
    """Touchline tracking.jsonl as spatial_metrics frames; possession from ball.poss_team_id."""
    home_id = json.loads((run_dir / "meta.json").read_text())["teams"]["home"]["id"]
    offset = {"first_half": 0.0, "second_half": 10_000.0}
    with (run_dir / "tracking.jsonl").open() as fh:
        for line in fh:
            f = json.loads(line)
            pid = f["ball"].get("poss_team_id")
            poss = None if pid is None else ("home" if pid == home_id else "away")
            teams = {s: [(p["x"], p["y"]) for p in f["teams"][s]["players"]] for s in ("home", "away")}
            yield f["period"], offset[f["period"]] + f["frame_id"] / fps, bool(f["ball"].get("status")), poss, (f["ball"]["x"], f["ball"]["y"]), teams


def touchline_metrics(run_dir: Path, fps: float = 10.0) -> dict:
    m = event_metrics(touchline_events(run_dir / "domain.jsonl"))
    meta = json.loads((run_dir / "meta.json").read_text())
    fps = float(meta["meta"]["tracking"]["fps"])

    def frames():
        offset = {"first_half": 0.0, "second_half": 10_000.0}
        with (run_dir / "tracking.jsonl").open() as fh:
            for line in fh:
                f = json.loads(line)
                players = {p["id"]: (p["x"], p["y"]) for p in f["teams"]["home"]["players"] + f["teams"]["away"]["players"]}
                yield f["period"], offset[f["period"]] + f["frame_id"] / fps, bool(f["ball"].get("status")), players

    m.update(tracking_metrics(frames()))
    m.update(spatial_metrics(touchline_spatial_frames(run_dir, fps)))
    return m


if __name__ == "__main__":
    import sys

    print(json.dumps(touchline_metrics(Path(sys.argv[1])), indent=1))

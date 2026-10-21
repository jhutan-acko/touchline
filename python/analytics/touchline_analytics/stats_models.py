"""Fit the stats engine's pass-difficulty (xPass) model on real IDSSE matches; define its xG features.

Usage:
  uv run --project python/analytics python -m touchline_analytics.idsse --tracking J03WMX J03WN1 J03WOH J03WOY J03WPY J03WQQ J03WR9
  uv run --project python/analytics python -m touchline_analytics.stats_models            # write data/params/stats-models.json
  uv run --project python/analytics python -m touchline_analytics.stats_models RUN_DIR [LEAGUE]  # features of a synthetic run (parity test)

xPass is a logistic regression on features measured from a pass's location and the tracking frame at that moment.
xG (P6 pre-merge fix 3, 2026-10-21) is the simulator's own model, so the stats engine, the analyst agent, the manager
and the advisor show the xG the simulator records on each shot: the coefficients are shotModel.xg in
data/params/touchline-params.json (the fractional-logit refit to DFL model xG, shots.fit_xg), and the features are the
simulator's (distance in metres, goal-mouth angle, header, outfield defenders in the shot line). stats-models.json keeps
only the xG feature names and the penalty rate. The feature definitions here and in packages/stats/src/models.ts are
the same; a parity test runs both on one synthetic match. Only coefficients and fit summaries are written, no real
event or tracking rows.
"""

from __future__ import annotations

import bisect
import datetime as dt
import json
import math
from pathlib import Path

from .idsse import MATCHES, PROVENANCE, filenames

LANE_WIDTH_M = 2.0
PRESS_RADIUS_M = 5.0
MAX_COUNT = 3
GOAL_HALF_WIDTH = 3.66
HALF_LENGTH = 52.5
XPASS_FEATURES = ["length_10m", "forward_10m", "lane_defenders", "pressure"]
XG_FEATURES = ["distance_m", "angle_rad", "header", "line_defenders"]
PENALTY_XG = 0.76
# The shot line (sim-core shotLineCount): outfield opponents within this distance of the line to the goal centre.
SHOT_LINE_M = 1.5
XG_SOURCE = ("the simulator's: shotModel.xg in data/params/touchline-params.json under shotModel.rule 1 (the fractional logit "
             "on DFL model xG, touchline_analytics.shots.fit_xg), read through sim-core xgCoefs")
# L2 penalty: xPass has thousands of passes.
XPASS_L2 = 1.0

Point = tuple[float, float]


def segment_distance(a: Point, b: Point, q: Point) -> tuple[float, float]:
    """Distance from q to the segment a-b, and where along it (0..1) the nearest point lies."""
    vx, vy = b[0] - a[0], b[1] - a[1]
    l2 = vx * vx + vy * vy
    t = 0.0 if l2 < 1e-9 else max(0.0, min(1.0, ((q[0] - a[0]) * vx + (q[1] - a[1]) * vy) / l2))
    return math.hypot(a[0] + t * vx - q[0], a[1] + t * vy - q[1]), t


def lane_defenders(start: Point, end: Point, opponents: list[Point]) -> int:
    """Opponents within 2 m of the pass line, away from both ends (5 %-95 % of the way), at most 3."""
    n = 0
    for o in opponents:
        d, t = segment_distance(start, end, o)
        if d < LANE_WIDTH_M and 0.05 < t < 0.95:
            n += 1
    return min(n, MAX_COUNT)


def pressure(at: Point, opponents: list[Point]) -> float:
    """1 with an opponent on the ball, falling linearly to 0 at 5 m."""
    if not opponents:
        return 0.0
    near = min(math.hypot(o[0] - at[0], o[1] - at[1]) for o in opponents)
    return max(0.0, 1.0 - near / PRESS_RADIUS_M)


def pass_features(start: Point, end: Point, attack: int, opponents: list[Point]) -> list[float]:
    """length / 10 m, forward progress / 10 m (towards the goal attacked, `attack` = +1 for +x), lane defenders, pressure."""
    length = math.hypot(end[0] - start[0], end[1] - start[1])
    return [length / 10, attack * (end[0] - start[0]) / 10, float(lane_defenders(start, end, opponents)), pressure(start, opponents)]


def goal_angle(at: Point, attack: int) -> float:
    """Angle (radians) the goal mouth subtends from `at`."""
    gx = attack * HALF_LENGTH
    a1 = math.atan2(GOAL_HALF_WIDTH - at[1], gx - at[0])
    a2 = math.atan2(-GOAL_HALF_WIDTH - at[1], gx - at[0])
    d = abs(a1 - a2)
    return 2 * math.pi - d if d > math.pi else d


def keeper_index(attack: int, opponents: list[Point]) -> int:
    """The opponent taken for the keeper when roles are unknown: the one nearest the centre of the goal attacked (-1: none)."""
    gx = attack * HALF_LENGTH
    if not opponents:
        return -1
    return min(range(len(opponents)), key=lambda i: math.hypot(opponents[i][0] - gx, opponents[i][1]))


def line_defenders(at: Point, attack: int, outfield: list[Point]) -> int:
    """Outfield opponents within 1.5 m of the line from `at` to the goal centre, strictly between its ends; uncapped."""
    n = 0
    for o in outfield:
        d, t = segment_distance(at, (attack * HALF_LENGTH, 0.0), o)
        if d < SHOT_LINE_M and 0 < t < 1:
            n += 1
    return n


def shot_features(at: Point, attack: int, header: bool, outfield: list[Point]) -> list[float]:
    """The simulator's xG features: distance to the goal centre (m), goal-mouth angle, header (0/1), outfield
    opponents in the shot line (`outfield`: keepers already left out)."""
    d = math.hypot(attack * HALF_LENGTH - at[0], at[1])
    return [d, goal_angle(at, attack), 1.0 if header else 0.0, float(line_defenders(at, attack, outfield))]


def sim_xg_model(params: dict) -> dict:
    """The simulator's xG as a logistic model on XG_FEATURES, from a parameter file's contents (sim-core xgCoefs:
    shotModel.xg under shotModel.rule 1, else shot.xg)."""
    c = params["shotModel"]["xg"] if params.get("shotModel", {}).get("rule") == 1 else params["shot"]["xg"]
    return {"features": XG_FEATURES, "intercept": c["b0"],
            "coefficients": dict(zip(XG_FEATURES, (c["bDist"], c["bAngle"], c["bHeader"], c["bDefenders"])))}


def sigmoid(z: float) -> float:
    return 1 / (1 + math.exp(-z)) if z >= 0 else math.exp(z) / (1 + math.exp(z))


def predict(intercept: float, coefs: list[float], x: list[float]) -> float:
    return sigmoid(intercept + sum(c * v for c, v in zip(coefs, x)))


def _solve(a: list[list[float]], b: list[float]) -> list[float]:
    """Gaussian elimination with partial pivoting (small dense systems)."""
    n = len(b)
    m = [row[:] + [b[i]] for i, row in enumerate(a)]
    for col in range(n):
        piv = max(range(col, n), key=lambda r: abs(m[r][col]))
        m[col], m[piv] = m[piv], m[col]
        for r in range(n):
            if r != col and m[r][col] != 0:
                f = m[r][col] / m[col][col]
                m[r] = [vr - f * vc for vr, vc in zip(m[r], m[col])]
    return [m[i][n] / m[i][i] for i in range(n)]


def fit_logistic(xs: list[list[float]], ys: list[int], l2: float, iters: int = 50) -> tuple[float, list[float]]:
    """Logistic regression by Newton's method with an L2 penalty on the coefficients (not the intercept)."""
    k = len(xs[0]) + 1
    beta = [0.0] * k
    rows = [[1.0] + x for x in xs]
    for _ in range(iters):
        grad = [0.0] * k
        hess = [[0.0] * k for _ in range(k)]
        for r, y in zip(rows, ys):
            p = sigmoid(sum(b * v for b, v in zip(beta, r)))
            w = p * (1 - p)
            for i in range(k):
                grad[i] += (y - p) * r[i]
                for j in range(k):
                    hess[i][j] += w * r[i] * r[j]
        for i in range(1, k):
            grad[i] -= l2 * beta[i]
            hess[i][i] += l2
        step = _solve(hess, grad)
        beta = [b + s for b, s in zip(beta, step)]
        if max(abs(s) for s in step) < 1e-10:
            break
    return beta[0], beta[1:]


def log_loss(ps: list[float], ys: list[int]) -> float:
    eps = 1e-12
    return -sum(y * math.log(max(p, eps)) + (1 - y) * math.log(max(1 - p, eps)) for p, y in zip(ps, ys)) / len(ys)


def _summary(xs: list[list[float]], ys: list[int], groups: list[str], names: list[str], l2: float) -> dict:
    """Fit on everything; score by leaving one match out at a time against the base rate."""
    b0, bs = fit_logistic(xs, ys, l2)
    held, base, truth = [], [], []
    for g in sorted(set(groups)):
        tr = [i for i, gi in enumerate(groups) if gi != g]
        te = [i for i, gi in enumerate(groups) if gi == g]
        c0, cs = fit_logistic([xs[i] for i in tr], [ys[i] for i in tr], l2)
        rate = sum(ys[i] for i in tr) / len(tr)
        held += [predict(c0, cs, xs[i]) for i in te]
        base += [rate] * len(te)
        truth += [ys[i] for i in te]
    return {
        "intercept": round(b0, 6),
        "coefficients": {n: round(c, 6) for n, c in zip(names, bs)},
        "l2": l2,
        "n": len(ys),
        "positives": sum(ys),
        "held_out_log_loss": round(log_loss(held, truth), 4),
        "base_rate_log_loss": round(log_loss(base, truth), 4),
    }


def _attack_dirs(first_frames: dict[int, dict[str, list[Point]]]) -> dict[tuple[int, str], int]:
    """Each team attacks away from where it lines up at the period's kick-off."""
    out = {}
    for period, teams in first_frames.items():
        for team, pts in teams.items():
            mean_x = sum(p[0] for p in pts) / len(pts)
            out[(period, team)] = -1 if mean_x > 0 else 1
    return out


def idsse_samples(root: Path, match_id: str) -> list[tuple[list[float], int]]:
    """xPass samples (features, outcome) from one IDSSE match."""
    from kloppy import sportec

    f = filenames(match_id)
    ev = sportec.load_event(event_data=str(root / f["event"]), meta_data=str(root / f["meta"]), coordinates="secondspectrum")
    tr = sportec.load_tracking(raw_data=str(root / f["tracking"]), meta_data=str(root / f["meta"]), coordinates="secondspectrum", sample_rate=1 / 5)
    frames: dict[int, list] = {}
    for fr in tr.frames:
        frames.setdefault(fr.period.id, []).append(fr)
    times = {p: [fr.timestamp.total_seconds() for fr in fs] for p, fs in frames.items()}

    def teams_at(fr) -> dict[str, list[Point]]:
        out: dict[str, list[Point]] = {}
        for pl, c in fr.players_data.items():
            if c.coordinates is not None and c.coordinates.x is not None:
                out.setdefault(pl.team.team_id, []).append((c.coordinates.x, c.coordinates.y))
        return out

    attack = _attack_dirs({p: teams_at(fs[0]) for p, fs in frames.items()})

    def frame_at(period: int, t: float):
        ts = times[period]
        i = bisect.bisect_left(ts, t)
        if i > 0 and (i == len(ts) or t - ts[i - 1] <= ts[i] - t):
            i -= 1
        return frames[period][i]

    passes: list[tuple[list[float], int]] = []
    events = [e for e in ev.events if e.coordinates is not None and e.coordinates.x is not None]
    for k, e in enumerate(events):
        if e.event_type.name != "PASS" or e.period.id not in frames:
            continue
        team = e.team.team_id
        teams = teams_at(frame_at(e.period.id, e.timestamp.total_seconds()))
        opp = [p for tid, pts in teams.items() if tid != team for p in pts]
        at = (e.coordinates.x, e.coordinates.y)
        a = attack[(e.period.id, team)]
        ok = e.result is not None and e.result.name == "COMPLETE"
        rc = getattr(e, "receiver_coordinates", None)
        if rc is not None and rc.x is not None:
            end = (rc.x, rc.y)
        else:
            # Where the ball was next played: the next event with a location in the same period.
            nxt = next((n for n in events[k + 1 :] if n.period.id == e.period.id), None)
            if nxt is None:
                continue
            end = (nxt.coordinates.x, nxt.coordinates.y)
        passes.append((pass_features(at, end, a, opp), 1 if ok else 0))
    return passes


def build(root: Path) -> dict:
    px, py, pg = [], [], []
    for mid in MATCHES:
        passes = idsse_samples(root, mid)
        print(f"{mid}: {len(passes)} passes", flush=True)
        px += [x for x, _ in passes]
        py += [y for _, y in passes]
        pg += [mid] * len(passes)
    return {
        "_provenance": {
            **PROVENANCE,
            "matches": list(MATCHES),
            "fitted_at": dt.date.today().isoformat(),
            "method": "xPass: logistic regression (Newton, L2 penalty on coefficients); features from event locations and the nearest 5 Hz tracking frame. xG: the simulator's model (xg.coefficients)",
            "note": "Coefficients and fit summaries only; no real event or tracking rows.",
        },
        "version": "stats-models-2",
        "xpass": {"features": XPASS_FEATURES, **_summary(px, py, pg, XPASS_FEATURES, XPASS_L2)},
        "xg": {"features": XG_FEATURES, "penalty": PENALTY_XG, "coefficients": XG_SOURCE},
    }


def run_features(run_dir: Path, roles: dict[str, str] | None = None) -> list[dict]:
    """Features of every pass and non-penalty shot in a synthetic run folder (domain.jsonl and CDF tracking.jsonl).
    A shot's are measured as the simulator's xG sees it: in the frame before its tick after control, in its own frame
    for a first-time shot or header (struck at contact), with the keepers (`roles` "GK"; without roles, the opponent
    nearest the goal attacked) left out."""
    meta = json.loads((run_dir / "meta.json").read_text())
    home_id = meta["teams"]["home"]["id"]
    wanted: dict[tuple[str, int], list[dict]] = {}
    with (run_dir / "domain.jsonl").open() as fh:
        for line in fh:
            e = json.loads(line)
            if e["type"] == "pass" and e["x_end"] is not None:
                wanted.setdefault((e["period"], e["period_frame_id"]), []).append(e)
            elif e["type"] == "shot" and e["attrs"].get("technique") != "penalty":
                at_frame = e["period_frame_id"] if e["attrs"].get("first_time") is True else e["period_frame_id"] - 1
                wanted.setdefault((e["period"], at_frame), []).append(e)
    first: dict[str, dict[str, list[Point]]] = {}
    out = []
    with (run_dir / "tracking.jsonl").open() as fh:
        for line in fh:
            f = json.loads(line)
            ids = {side: [p["id"] for p in f["teams"][side]["players"]] for side in ("home", "away")}
            teams = {side: [(p["x"], p["y"]) for p in f["teams"][side]["players"]] for side in ("home", "away")}
            first.setdefault(f["period"], teams)
            for e in wanted.get((f["period"], f["frame_id"]), []):
                side = "home" if e["team_id"] == home_id else "away"
                fp = first[f["period"]][side]
                attack = -1 if sum(p[0] for p in fp) / len(fp) > 0 else 1
                opp_side = "away" if side == "home" else "home"
                opp = teams[opp_side]
                at = (e["x"], e["y"])
                if e["type"] == "pass":
                    x = pass_features(at, (e["x_end"], e["y_end"]), attack, opp)
                else:
                    if roles:
                        outfield = [p for p, pid in zip(opp, ids[opp_side]) if roles.get(pid) != "GK"]
                    else:
                        k = keeper_index(attack, opp)
                        outfield = [p for i, p in enumerate(opp) if i != k]
                    x = shot_features(at, attack, e["attrs"].get("body_part") == "head", outfield)
                out.append({"id": e["id"], "features": x})
    return out


if __name__ == "__main__":
    import sys

    if len(sys.argv) > 1:
        roles = None
        if len(sys.argv) > 2:
            roles = {p["id"]: p["role"] for c in json.loads(Path(sys.argv[2]).read_text())["clubs"] for p in c["squad"]}
        print(json.dumps(run_features(Path(sys.argv[1]), roles)))
    else:
        result = build(Path("data/raw/idsse"))
        out = Path("data/params/stats-models.json")
        out.write_text(json.dumps(result, indent=1) + "\n")
        print(f"wrote {out}: xpass held-out log loss {result['xpass']['held_out_log_loss']} (base {result['xpass']['base_rate_log_loss']})")

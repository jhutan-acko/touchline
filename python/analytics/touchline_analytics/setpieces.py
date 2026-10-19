"""Set pieces, keeper restarts, direct free kicks and role moves against real aggregates (realism v2, P5).

Definitions are ported from the 2026-10-13 analysis scripts (sp_analysis.py measure(), off_analysis.py movements()); only
aggregates are committed. Keys and real values: targets-idsse.json "setpieces". Events and tracking frames are read as
passing.py reads them: an event's positions are the tracking frame with its period and period frame id.

- Restarts: `set_piece` events other than penalties. Kinds as sim-core setpiece.ts setPieceKind, in the taking side's frame
  (u along its attack, +52.5 the opponents' goal line): free kicks with u > 17.5 are attacking, wide when |y| > 20.16, else
  central; throw-ins are attacking with u > 17.5.
- Snapshot at the set_piece frame, both teams in the restarting side's frame (y signed so the ball's side is positive), with
  at least 10 players of each side present. Box u > 36, |y| < 20.16; six-yard box u > 47, |y| < 9.16. The taker is the
  event's player.
  - Attackers in the box or six-yard box: the restarting side's outfielders, taker excluded. Kept back (rest defence): the
    same with u < 28. Defenders in the box: the other side's outfielders. Left up: theirs with u < 17.5. Tight: share of
    the box defenders whose nearest attacking outfielder (taker included) is within 2 m, mean over restarts.
  - Wall: defending outfielders 6-11.5 m from the ball within 25 deg of the ball->goal-centre bearing; present when at least
    one; the wall's distance is its nearest member's (median over central free kicks with a wall).
  - Goal kicks: the other side's outfielders at u < -36 (the analysis's line, no width test) and u < -17.5; the mean u of
    the kicking side's CBs (2 or more). Throw-ins: the thrower's outfield team-mates within 10 m of the ball. Kickoffs: the
    nearest opposing outfielder to the ball.
- First contact: on a 0.05 s grid with ball and players linearly interpolated, the first player (the taker excluded for
  1 s) within 1.5 m of the ball 0.3-5 s after the kick, same period. Long: more than 32 m from the spot; completed: met by
  the kicking side. Throw-in distance: the median over throw-ins.
- Corner delivery completed: the restart pass at the corner's frame (attrs.restart "corner") has outcome successful.
- Shots within 10 s: shots from 0.3 s before to 10 s after the restart, by the kicking side (corners) or the other side
  (goal kicks), per 100 restarts. Direct free kicks: a shot by the kicking side with technique free_kick within 1 s of a
  central attacking free kick. Keeper free kicks: free kicks whose taker is a keeper, per team-match.
- Dead time: from the first frame of the dead spell that ends at the set_piece frame, same period (none when the spell
  reaches the period's start), by sim-core deadKey: throw_in, goal_kick, corner, free_kick_att (wide and central attacking
  free kicks), free_kick (other free kicks), kickoff (only after a `goal` in the same period, with no restart between: period-start
  kickoffs also emit set_piece kickoff); the median. Dead speed: the outfielders' mean speed over
  the spell on the 5 Hz grid (both sides), the median over restarts.
- In play: share of live frames in the first 15 minutes of the first half and minutes 30-45 of the second half (75-90).
- Role moves: rolemoves.py, per team-match.
"""

from __future__ import annotations

import json
import math
from collections import Counter
from pathlib import Path

import numpy as np

from .duels import GRID_S, PERIODS, _grid, _read_tracking
from .passing import _attack, _cell
from .rolemoves import role_moves

HL, BOX_U, BOX_W, SIX_U, SIX_W, THIRD = 52.5, 36.0, 20.16, 47.0, 9.16, 17.5
REST_U, UP_U, TIGHT_M = 28.0, 17.5, 2.0
WALL_MIN_M, WALL_MAX_M, WALL_DEG = 6.0, 11.5, 25.0
FC_FROM_S, FC_TO_S, FC_STEP_S, FC_M, TAKER_S, LONG_M = 0.3, 5.0, 0.05, 1.5, 1.0, 32.0
SHOT_WINDOW = (-0.3, 10.0)
DIRECT_FK_S = 1.0
DEAD_KEY = {"throw_def": "throw_in", "throw_mid": "throw_in", "throw_att": "throw_in", "goal_kick": "goal_kick", "corner": "corner",
            "fk_wide": "free_kick_att", "fk_central": "free_kick_att", "fk_other": "free_kick", "kickoff": "kickoff"}
DEAD_ROWS = {"throw_in": "dead_throw_in_s", "goal_kick": "dead_goal_kick_s", "corner": "dead_corner_s", "free_kick_att": "dead_fk_att_s",
             "free_kick": "dead_fk_other_s", "kickoff": "dead_kickoff_s"}
ROLE_ROWS = {"fb_overlap": "fb_overlap", "w_comes_inside": "w_inside", "fb_underlap_inversion": "fb_invert", "run_in_behind": "run_in_behind",
             "cm_drops_into_back_line": "cm_drop", "drop_to_receive": "drop_to_receive"}
FIRST15_S, LAST15_S = (0.0, 900.0), (1800.0, 2700.0)


def set_piece_kind(restart: str, u: float, y: float) -> str:
    """sim-core setPieceKind, from the spot in the taking side's frame."""
    if restart == "free_kick":
        return ("fk_wide" if abs(y) > BOX_W else "fk_central") if u > THIRD else "fk_other"
    if restart == "throw_in":
        return "throw_def" if u < -THIRD else "throw_att" if u > THIRD else "throw_mid"
    return restart


def _wall(U: np.ndarray, W: np.ndarray, out_d: np.ndarray, su: float, sw: float) -> list[float]:
    gb = math.atan2(0.0 - sw, HL - su)
    dist = []
    for j in np.where(out_d)[0]:
        px, py = U[j] - su, W[j] - sw
        r = math.hypot(px, py)
        off = abs((math.atan2(py, px) - gb + math.pi) % (2 * math.pi) - math.pi)
        if WALL_MIN_M <= r <= WALL_MAX_M and off < math.radians(WALL_DEG):
            dist.append(r)
    return dist


def _snapshot(T: dict, i: int, a: int, d: int, sx: float, sy: float, taker: int | None, gk: np.ndarray, role: np.ndarray) -> dict | None:
    X, Y = T["X"][i], T["Y"][i]
    fin = np.isfinite(X)
    A, D = (T["side"] == a) & fin, (T["side"] == 1 - a) & fin
    if A.sum() < 10 or D.sum() < 10:
        return None
    sgn = 1.0 if sy >= 0 else -1.0
    U, W = d * X, Y * sgn
    su, sw = d * sx, sy * sgn
    out_a, out_d = A & ~gk, D & ~gk
    nontk = out_a.copy()
    if taker is not None:
        nontk[taker] = False
    box = (U > BOX_U) & (np.abs(W) < BOX_W)
    six = (U > SIX_U) & (np.abs(W) < SIX_W)
    dball = np.hypot(U - su, W - sw)
    o = {"att_box": int((box & nontk).sum()), "att_six": int((six & nontk).sum()), "rest": int((nontk & (U < REST_U)).sum()),
         "def_box": int((box & out_d).sum()), "def_up": int((out_d & (U < UP_U)).sum()),
         "opp_box_line": int((out_d & (U < -BOX_U)).sum()), "opp_def_third": int((out_d & (U < -THIRD)).sum()),
         "mates_10": int((nontk & (dball < 10)).sum()), "nearest_opp": float(dball[out_d].min()) if out_d.any() else math.nan}
    bdef = np.where(out_d & box)[0]
    ax, ay = U[out_a], W[out_a]
    o["tight"] = float(np.mean([np.hypot(ax - U[j], ay - W[j]).min() < TIGHT_M for j in bdef])) if len(bdef) and len(ax) else math.nan
    cb = A & (role == "CB")
    o["cb_u"] = float(U[cb].mean()) if cb.sum() >= 2 else math.nan
    o["wall"] = _wall(U, W, out_d, su, sw)
    return o


def _first_contact(T: dict, i0: int, fps: float, a: int, sx: float, sy: float, taker: int | None) -> dict | None:
    """First player within 1.5 m of the ball 0.3-5 s after the kick at row i0, the taker excluded for 1 s (sp_analysis first_contact)."""
    per = T["per"]
    t = (T["fid"] - T["fid"][i0]) / fps
    hi = i0
    while hi + 1 < len(per) and per[hi + 1] == per[i0] and t[hi] < FC_TO_S:
        hi += 1
    seg = slice(i0, hi + 1)
    ts, bx, by, X, Y = t[seg], T["bx"][seg], T["by"][seg], T["X"][seg], T["Y"][seg]
    if len(ts) < 2:
        return None
    for tk in np.arange(FC_FROM_S, FC_TO_S + 1e-9, FC_STEP_S):
        if tk > ts[-1]:
            return None
        j = min(max(int(np.searchsorted(ts, tk)), 1), len(ts) - 1)
        w = (tk - ts[j - 1]) / max(ts[j] - ts[j - 1], 1e-9)
        qx, qy = bx[j - 1] * (1 - w) + bx[j] * w, by[j - 1] * (1 - w) + by[j] * w
        dd = np.hypot(X[j - 1] * (1 - w) + X[j] * w - qx, Y[j - 1] * (1 - w) + Y[j] * w - qy)
        dd = np.where(np.isfinite(dd), dd, np.inf)
        if tk < TAKER_S and taker is not None:
            dd[taker] = np.inf
        m = int(np.argmin(dd))
        if dd[m] < FC_M:
            return {"att": bool(T["side"][m] == a), "len": float(math.hypot(qx - sx, qy - sy))}
    return None


def _dead(T: dict, i: int, fps: float, outf: np.ndarray) -> tuple[float, float] | None:
    """(seconds dead, outfielders' mean speed while dead) for the dead spell ending at row i; None without one in the period."""
    live, per = T["live"], T["per"]
    if i < 1 or per[i - 1] != per[i] or live[i - 1]:
        return None
    k = i - 1
    while k > 0 and per[k - 1] == per[i] and not live[k - 1]:
        k -= 1
    if k == 0 or per[k - 1] != per[i]:
        return None  # the period began dead: no spell measured (kickoffs at the start of a half)
    step = max(1, round(GRID_S * fps))
    X, Y = T["X"][k:i + 1:step][:, outf], T["Y"][k:i + 1:step][:, outf]
    with np.errstate(invalid="ignore"):
        sp = np.hypot(np.diff(X, axis=0), np.diff(Y, axis=0)) / (step / fps)
    speed = float(np.nanmean(sp)) if np.isfinite(sp).any() else math.nan
    return (T["fid"][i] - T["fid"][k]) / fps, speed


def match_setpieces(run: Path, roles: dict[str, str]) -> dict:
    """Per-restart measurements and role-move counts of one simulated match (summarize() pools them)."""
    meta = json.loads((run / "meta.json").read_text())
    fps = float(meta["meta"]["tracking"]["fps"])
    home = meta["teams"]["home"]["id"]
    side_of = lambda team: 0 if team == home else 1  # noqa: E731
    events = [json.loads(line) for line in (run / "domain.jsonl").read_text().splitlines() if line.strip()]
    T = _read_tracking(run, home)
    row = {(int(p), int(f)): i for i, (p, f) in enumerate(zip(T["per"], T["fid"]))}
    role = np.array([roles.get(pid, "") for pid in T["ids"]])
    gk = role == "GK"
    shots = [(PERIODS[e["period"]], e["period_frame_id"] / fps, side_of(e["team_id"]), e["attrs"].get("technique")) for e in events if e["type"] == "shot"]
    restart_pass = {(PERIODS[e["period"]], e["period_frame_id"], side_of(e["team_id"]), e["attrs"]["restart"]): e.get("outcome")
                    for e in events if e["type"] == "pass" and e["attrs"].get("restart")}
    m = {"restarts": [], "kinds": Counter(), "keeper_fk": 0, "offsides": 0}
    after_goal = False
    for e in events:
        if e["type"] == "offside":
            m["offsides"] += 1
        elif e["type"] == "goal":
            after_goal = True
        elif e["type"] == "period_start":
            after_goal = False
        if e["type"] != "set_piece" or e["attrs"].get("kind") == "penalty" or e["x"] is None:
            continue
        p, f = PERIODS[e["period"]], e["period_frame_id"]
        i = row.get((p, f))
        if i is None:
            continue
        a = side_of(e["team_id"])
        d = _attack("home" if a == 0 else "away", e["period"])
        sx, sy = float(e["x"]), float(e["y"])
        kind = set_piece_kind(e["attrs"]["kind"], d * sx, sy)
        dead = _dead(T, i, fps, ~gk) if kind != "kickoff" or after_goal else None
        after_goal = False
        taker = T["cols"].get(e["player_id"])
        m["kinds"][kind] += 1
        m["keeper_fk"] += e["attrs"]["kind"] == "free_kick" and roles.get(e["player_id"]) == "GK"
        t0 = f / fps
        r = {"kind": kind, "snap": _snapshot(T, i, a, d, sx, sy, taker, gk, role), "fc": _first_contact(T, i, fps, a, sx, sy, taker),
             "shot_for": any(q == p and s == a and SHOT_WINDOW[0] <= ts - t0 <= SHOT_WINDOW[1] for q, ts, s, _ in shots),
             "shot_against": any(q == p and s != a and SHOT_WINDOW[0] <= ts - t0 <= SHOT_WINDOW[1] for q, ts, s, _ in shots),
             "direct": any(q == p and s == a and tech == "free_kick" and 0 <= ts - t0 <= DIRECT_FK_S for q, ts, s, tech in shots),
             "delivery": restart_pass.get((p, f, a, e["attrs"]["kind"])), "dead": dead}
        m["restarts"].append(r)
    live, per, ts = T["live"], T["per"], T["fid"] / fps
    first, last = (per == 1) & (ts >= FIRST15_S[0]) & (ts < FIRST15_S[1]), (per == 2) & (ts >= LAST15_S[0]) & (ts < LAST15_S[1])
    m["in_play"] = {"first15": (int(live[first].sum()), int(first.sum())), "last15": (int(live[last].sum()), int(last.sum()))}
    m["moves"] = role_moves(_grid(T, fps, roles))
    return m


def _mean(v) -> float:
    v = [x for x in v if x is not None and not (isinstance(x, float) and math.isnan(x))]
    return float(np.mean(v)) if v else math.nan


def _median(v) -> float:
    v = [x for x in v if x is not None and not (isinstance(x, float) and math.isnan(x))]
    return float(np.median(v)) if v else math.nan


def summarize(ms: list[dict]) -> dict:
    n = len(ms)
    team_matches = 2 * n
    rs = [r for m in ms for r in m["restarts"]]
    of = lambda *kinds: [r for r in rs if r["kind"] in kinds]  # noqa: E731
    snap = lambda rows, k: [r["snap"][k] for r in rows if r["snap"]]  # noqa: E731
    corners, wide, central = of("corner"), of("fk_wide"), of("fk_central")
    throws, goal_kicks = of("throw_def", "throw_mid", "throw_att"), of("goal_kick")
    walls_c = [r["snap"]["wall"] for r in central if r["snap"]]
    walls_w = [r["snap"]["wall"] for r in wide if r["snap"]]
    gk_fc = [r["fc"] for r in goal_kicks if r["fc"]]
    gk_long = [f for f in gk_fc if f["len"] > LONG_M]
    delivered = [r["delivery"] for r in corners if r["delivery"] is not None]
    moves = Counter()
    for m in ms:
        moves.update(m["moves"])
    def in_play(k: str) -> float:
        frames = sum(m["in_play"][k][1] for m in ms)
        return sum(m["in_play"][k][0] for m in ms) / frames if frames else math.nan

    per100 = lambda rows, k: 100 * _mean([r[k] for r in rows])  # noqa: E731
    out = {
        "corner_att_box": _mean(snap(corners, "att_box")),
        "corner_att_six": _mean(snap(corners, "att_six")),
        "corner_def_box": _mean(snap(corners, "def_box")),
        "corner_tight": _mean(snap(corners, "tight")),
        "corner_def_up": _mean(snap(corners, "def_up")),
        "corner_rest": _mean(snap(corners, "rest")),
        "corner_delivery_completed": _mean([x == "successful" for x in delivered]),
        "fk_wide_att_box": _mean(snap(wide, "att_box")),
        "fk_central_att_box": _mean(snap(central, "att_box")),
        "fk_wide_rest": _mean(snap(wide, "rest")),
        "fk_central_rest": _mean(snap(central, "rest")),
        "throw_att_rest": _mean(snap(of("throw_att"), "rest")),
        "wall_central_present": _mean([len(w) > 0 for w in walls_c]),
        "wall_central_players": _mean([len(w) for w in walls_c]),
        "wall_wide_present": _mean([len(w) > 0 for w in walls_w]),
        "wall_min_dist_m": _median([min(w) for w in walls_c if w]),
        "gk_opp_box": _mean(snap(goal_kicks, "opp_box_line")),
        "gk_opp_def_third": _mean(snap(goal_kicks, "opp_def_third")),
        "gk_cb_u": _mean(snap(goal_kicks, "cb_u")),
        "throw_mates_10m": _mean(snap(throws, "mates_10")),
        "throw_first_contact_m": _median([r["fc"]["len"] for r in throws if r["fc"]]),
        "kickoff_nearest_opp_m": _mean(snap(of("kickoff"), "nearest_opp")),
        "gk_long_share": _mean([f["len"] > LONG_M for f in gk_fc]),
        "gk_long_completion": _mean([f["att"] for f in gk_long]),
        "gk_shots_against_per100": per100(goal_kicks, "shot_against"),
        "keeper_fk_per_team": sum(m["keeper_fk"] for m in ms) / team_matches if n else math.nan,
        "fk_central_shot_share": _mean([r["direct"] for r in central]),
        "corner_shots_per100": per100(corners, "shot_for"),
        **{row: _median([r["dead"][0] for r in rs if r["dead"] and DEAD_KEY.get(r["kind"]) == key]) for key, row in DEAD_ROWS.items()},
        "dead_speed_mps": _median([r["dead"][1] for r in rs if r["dead"]]),
        **{row: moves[k] / team_matches if n else math.nan for k, row in ROLE_ROWS.items()},
        "run_wide_share": moves["run_wide"] / moves["run_in_behind"] if moves["run_in_behind"] else math.nan,
        "run_beyond_share": moves["run_beyond"] / moves["run_in_behind"] if moves["run_in_behind"] else math.nan,
        "offsides_per_match": sum(m["offsides"] for m in ms) / n if n else math.nan,
        "in_play_first15": in_play("first15"),
        "in_play_last15": in_play("last15"),
    }
    return out


def setpieces_section(ms: list[dict], t: dict) -> list[str]:
    s = summarize(ms)
    lines = ["## Set pieces, keeper restarts and role moves (realism v2, P5)", "", "| Measure | Real | Simulated | Band | Status |", "|---|---|---|---|---|"]
    for key, r in t["rows"].items():
        fmt = r.get("fmt", "{:.3f}")
        v = s.get(key, math.nan)
        real = "—" if r.get("real") is None else fmt.format(r["real"])
        band = "—" if r.get("lo") is None else f"{fmt.format(r['lo'])}–{fmt.format(r['hi'])}"
        status = "—" if r.get("lo") is None or not math.isfinite(v) else ("MET" if r["lo"] <= v <= r["hi"] else "NOT MET")
        lines.append(f"| {_cell(r['label'])} | {real} | {fmt.format(v) if math.isfinite(v) else 'n/a'} | {band} | {status} |")
    kinds = sum((m["kinds"] for m in ms), Counter())
    counted = ", ".join(f"{kinds[k]} {label}" for k, label in (("corner", "corners"), ("fk_wide", "wide attacking free kicks"),
                        ("fk_central", "central attacking free kicks"), ("goal_kick", "goal kicks"), ("kickoff", "kickoffs")))
    notes = [f"From {len(ms)} matches: {counted}; {sum(kinds[k] for k in ('throw_def', 'throw_mid', 'throw_att'))} throw-ins "
             f"({kinds['throw_att']} in the attacking third).",
             f"The direct free-kick share rests on 11 real free kicks: judge it on ≥ 64 matches (`pnpm realism:deep`); this report has {len(ms)}.",
             "Role moves are counted from frames with the analysis's episode definitions (touchline_analytics.rolemoves), per team-match."]
    return lines + [""] + [f"- {x}" for x in notes] + [""]


def setpieces_report(run_dirs: list[Path], targets: dict, note: str, roles: dict[str, str]) -> str:
    ms = [match_setpieces(d, roles) for d in run_dirs]
    return "\n".join(["# Touchline set-pieces diagnostics", "", f"{len(ms)} synthetic matches ({note}).", "", ""] + setpieces_section(ms, targets["setpieces"]))

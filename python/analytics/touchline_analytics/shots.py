"""Shot diagnostics against real aggregates (realism v2, P6).

Definitions follow the 2026-10-13 analysis (finalthird-report.md A3, ft_analysis.py) and plan 8f rulings 15 and 16; only
aggregates are committed. Keys and real values: targets-idsse.json "shots". Positions are read at the shot's own tick.

Simulated side (domain.jsonl and tracking.jsonl):
- open play: technique "normal" (not a penalty or a direct free kick) and more than 10 s after the period's last set_piece.
- gained the ball: the end frame of a completed pass to the player, or his interception (ball won) or ball recovery.
- first time: a shot less than round(0.3 fps) frames after the shooter last gained the ball (ruling 16; attrs ignored).
- header: body_part "head". Nearest defender: outfield opponents only. In the box: u > 36 and |y| < 20.16 in the team frame.
- keeper at the shot: off the line = |goal-line x - keeper x|; off the ball-goal line = his distance from the line through
  the shot origin and the goal centre.
- setup, in the analysis's order: rebound (a team shot 4 s or less before), cross, through ball (kind, or the receiver within
  1 m of the last defender's u while the ball is 3 m behind it at the assist), dribble (carrier spell of 1.5 s and 5 m from
  tracking: within 2 m of the live ball, no opponent in possession; up to 15 s back), pass, loose ball or regain (no
  completed pass to the shooter in the 6 s before the shot). A cutback counts as a pass: the real events have no cutback
  class.
- completion by bin: open-play passes (no restart) by 15-minute bin of each half; added time joins the half's last bin.

Real side (DFL event XML in data/raw/idsse, read by ElementTree; never committed): ShotAtGoal attributes and the shot's
position (from tracking when DFL gives it). Real open play: no restart tag, not a penalty, more than 10 s after the last
restart event. The xG fit is least squares of logit(DFL xG) on xgOf's features (ruling 13).

Usage:
  uv run --project python/analytics python -m touchline_analytics.shots real            # real rows and the xG fit
  uv run --project python/analytics python -m touchline_analytics.shots clips <runs...>  # C5 clip list as Markdown
"""

from __future__ import annotations

import datetime as dt
import json
import math
import re
import xml.etree.ElementTree as ET
from pathlib import Path

import numpy as np

HL, BOX_U, BOX_W, GOAL_HW = 52.5, 36.0, 20.16, 3.66
SET_PIECE_EXCL_S, FIRST_TIME_S, REBOUND_S, ASSIST_S = 10.0, 0.3, 4.0, 6.0
DRIBBLE_S, DRIBBLE_M, TIGHT_M, OPEN_M, SPELL_MAX_S = 1.5, 5.0, 1.5, 3.0, 15.0
LATE_PASS_MIN, LATE_PASS_MAX = 80, 5
QUICK_SAVE_S = 0.5
DEEP_MATCHES = 64
SETUPS = ("pass", "dribble", "cross", "loose_or_regain", "through_ball")
PERIODS = {"first_half": 1, "second_half": 2}
_KEY = re.compile(r'"frame_id":\s*(\d+).*?"period":\s*"(\w+)"')


def _attack(side: str, period: str) -> int:
    """+1 if the side attacks +x in that period: home in the first half, away in the second."""
    return 1 if (side == "home") == (period == "first_half") else -1


def minute_bin(period: int, seconds: float) -> int:
    """15-minute bin 0-5 of a time `seconds` into period 1 or 2; added time joins the half's last bin."""
    return 3 * (period - 1) + min(int(seconds // 900), 2)


def _clock(period: str, frame: int, fps: float) -> tuple[int, int]:
    s = frame / fps
    return (0 if period == "first_half" else 45) + int(s // 60), int(s % 60)


def _load(run: Path) -> tuple[float, str, list[dict]]:
    meta = json.loads((run / "meta.json").read_text())
    events = [json.loads(line) for line in (run / "domain.jsonl").read_text().splitlines() if line.strip()]
    return float(meta["meta"]["tracking"]["fps"]), meta["teams"]["home"]["id"], events


def _gains(events: list[dict]) -> dict:
    """player -> sorted [(period, frame)] of the moments he gained the ball (frame: the event's match-long frame_id)."""
    g: dict = {}
    for e in events:
        t, a = e["type"], e["attrs"]
        if t == "pass" and e["outcome"] == "successful" and a.get("receiver_id") and e["frame_id_end"] is not None:
            g.setdefault(a["receiver_id"], []).append((e["period"], e["frame_id_end"]))
        elif t == "ball_recovery" or (t == "interception" and a.get("ball") != "deflected"):
            g.setdefault(e["player_id"], []).append((e["period"], e["frame_id"]))
    for v in g.values():
        v.sort(key=lambda r: (PERIODS.get(r[0], 9), r[1]))
    return g


def _last_gain(gains: dict, pid: str, period: str, frame: int):
    best = None
    for r in gains.get(pid, ()):
        if r[0] == period and r[1] <= frame:
            best = r
    return best


def _shot_rows(events: list[dict], fps: float) -> list[dict]:
    """Event-only shot records: open play, outcome, technique, first time, rebound and the assist pass."""
    gains = _gains(events)
    ft_frames = round(FIRST_TIME_S * fps)
    last_sp: dict = {}
    passes: list[dict] = []
    rows: list[dict] = []
    for e in events:
        t, a = e["type"], e["attrs"]
        if t == "set_piece":
            last_sp[e["period"]] = e["frame_id"]
        elif t == "pass" and e["outcome"] == "successful":
            passes.append(e)
        if t != "shot":
            continue
        per, f, pid = e["period"], e["frame_id"], e["player_id"]
        tech = a.get("technique", "normal")
        g = _last_gain(gains, pid, per, f)
        prev = [r for r in rows if r["period"] == per and r["team"] == e["team_id"] and 0 < f - r["frame"] <= REBOUND_S * fps]
        assist = [p for p in passes if p["period"] == per and p["team_id"] == e["team_id"] and p["attrs"].get("receiver_id") == pid
                  and 0 < f - p["frame_id"] <= ASSIST_S * fps]
        rows.append({
            "period": per, "frame": f, "pframe": e["period_frame_id"], "team": e["team_id"], "player": pid, "x": e["x"], "y": e["y"],
            "penalty": tech == "penalty", "open": tech == "normal" and f - last_sp.get(per, -1e18) > SET_PIECE_EXCL_S * fps,
            "goal": e["outcome"] == "goal", "saved": e["outcome"] == "saved", "blocked": e["outcome"] == "blocked",
            "flight_s": (e["frame_id_end"] - f) / fps if e["frame_id_end"] is not None else None,
            "header": a.get("body_part") == "head", "xg": a.get("xg"),
            "first_time": g is not None and f - g[1] < ft_frames,
            "rebound": bool(prev), "assist": assist[-1] if assist else None,
        })
    return rows


def _snapshots(run: Path, keys: set) -> dict:
    """{(period, frame_id): ({player_id: (x, y, side)}, (ball x, ball y, live, possessing team id))} for the tracking frames
    in keys. Tracking frame ids restart each period, as an event's period_frame_id does; an event's frame_id runs on
    through the match (used only for time gaps)."""
    out: dict = {}
    with (run / "tracking.jsonl").open() as fh:
        for line in fh:
            m = _KEY.search(line, 0, 200)
            if m and (m.group(2), int(m.group(1))) not in keys:
                continue
            f = json.loads(line)
            k = (f["period"], f["frame_id"])
            if k in keys:
                b = f["ball"]
                out[k] = ({p["id"]: (p["x"], p["y"], s) for s in ("home", "away") for p in f["teams"][s]["players"]},
                          (b["x"], b["y"], bool(b.get("status")), b.get("poss_team_id")))
    return out


def _spell(snaps: dict, period: str, pframe: int, pid: str, team: str, fps: float) -> tuple[float, float] | None:
    """carrier_spell of ft_analysis: seconds the shooter has been within 2 m of the live ball, his team in possession or
    none, up to the shot, and his displacement over it; 0 if the ball is more than 2.5 m from him at the shot."""
    def near(k):
        fr = snaps.get((period, k))
        if fr is None or pid not in fr[0]:
            return None
        (x, y, _), (bx, by, live, poss) = fr[0][pid], fr[1]
        return math.hypot(x - bx, y - by), live, poss, (x, y)
    at = near(pframe)
    if at is None:
        return None
    if at[0] > 2.5:
        return 0.0, 0.0
    k = pframe
    while k > 0:
        prev = near(k - 1)
        if prev is None or prev[0] > 2.0 or not prev[1] or prev[2] not in (team, None):
            break
        k -= 1
    start = near(k)[3]
    return (pframe - k) / fps, math.hypot(at[3][0] - start[0], at[3][1] - start[1])


def match_shots(run: Path, roles: dict[str, str]) -> dict:
    """Shot records and open-play pass completion by bin of one simulated match (summarize() pools them)."""
    fps, home, events = _load(run)
    side_of = lambda team: "home" if team == home else "away"  # noqa: E731
    rows = _shot_rows(events, fps)
    look = round(SPELL_MAX_S * fps)
    keys = {(r["period"], r["pframe"] - j) for r in rows for j in range(look + 1)}
    keys |= {(r["assist"]["period"], r["assist"]["period_frame_id"]) for r in rows if r["assist"]}
    snaps = _snapshots(run, keys)
    for r in rows:
        side = side_of(r["team"])
        a = _attack(side, r["period"])
        u, v = r["x"] * a, r["y"] * a
        r["in_box"] = u > BOX_U and abs(v) < BOX_W
        pos = snaps.get((r["period"], r["pframe"]), ({}, None))[0]
        r["near_def"] = r["gk_off_line"] = r["gk_off_bisector"] = None
        if pos:
            opp = [(x * a, y * a, pid) for pid, (x, y, s) in pos.items() if s != side]
            d = [math.hypot(x - u, y - v) for x, y, pid in opp if roles.get(pid) != "GK"]
            r["near_def"] = min(d) if d else None
            gk = next(((x, y) for x, y, pid in opp if roles.get(pid) == "GK"), None)
            if gk:
                vx, vy = HL - u, -v
                r["gk_off_line"] = abs(HL - gk[0])
                r["gk_off_bisector"] = abs((gk[0] - u) * vy - (gk[1] - v) * vx) / (math.hypot(vx, vy) or 1.0)
        through = False
        p = r["assist"]
        if p is not None:
            apos = snaps.get((p["period"], p["period_frame_id"]), ({}, None))[0]
            if apos and r["player"] in apos and p["x"] is not None:
                defs = [x * a for pid, (x, y, s) in apos.items() if s != side and roles.get(pid) != "GK"]
                last_def = max(defs) if defs else math.nan
                through = bool(defs) and apos[r["player"]][0] * a > last_def - 1.0 and p["x"] * a < last_def - 3.0
        kind = p["attrs"].get("kind") if p else None
        spell = _spell(snaps, r["period"], r["pframe"], r["player"], r["team"], fps)
        r["spell_s"], r["spell_m"] = spell if spell else (None, None)
        if r["rebound"]:
            r["setup"] = "rebound"
        elif kind == "cross":
            r["setup"] = "cross"
        elif p is not None and (through or kind in ("through", "lofted_through")):
            r["setup"] = "through_ball"
        elif p is not None and kind == "cutback":
            r["setup"] = "pass"
        elif r["spell_s"] is not None and r["spell_s"] >= DRIBBLE_S and r["spell_m"] >= DRIBBLE_M:
            r["setup"] = "dribble"
        elif p is not None:
            r["setup"] = "pass"
        else:
            r["setup"] = "loose_or_regain"
        del r["assist"]
    bins = [[0, 0] for _ in range(6)]
    for e in events:
        if e["type"] == "pass" and not e["attrs"].get("restart") and e["period"] in PERIODS:
            b = minute_bin(PERIODS[e["period"]], e["period_frame_id"] / fps)
            bins[b][0] += e["outcome"] == "successful"
            bins[b][1] += 1
    return {"shots": rows, "goals": sum(e["type"] == "goal" for e in events), "bins": bins}


def _rate(k: int, n: int) -> float:
    return k / n if n else math.nan


def _bin_rate(b: list) -> float:
    return _rate(b[0], b[1])


def summarize(ms: list[dict]) -> dict:
    n = len(ms)
    shots = [s for m in ms for s in m["shots"]]
    op = [s for s in shots if s["open"]]
    goals = [s for s in op if s["goal"]]
    count = lambda rows, f: sum(1 for s in rows if f(s))  # noqa: E731
    conv = lambda rows: _rate(count(rows, lambda s: s["goal"]), len(rows))  # noqa: E731
    nd = [s for s in op if s["near_def"] is not None]
    tight = [s for s in nd if s["near_def"] < TIGHT_M]
    mid = [s for s in nd if TIGHT_M <= s["near_def"] < OPEN_M]
    opn = [s for s in nd if s["near_def"] >= OPEN_M]
    med = lambda v: float(np.median(v)) if v else math.nan  # noqa: E731
    bins = [[sum(m["bins"][i][j] for m in ms) for j in (0, 1)] for i in range(6)]
    xgs = [s["xg"] for s in op if s["xg"] is not None]
    out = {
        "shots_per_match": len(shots) / n,
        "open_shots_per_match": len(op) / n,
        "goals_per_match": sum(m["goals"] for m in ms) / n,
        "open_conv": conv(op),
        "first_time_share": _rate(count(op, lambda s: s["first_time"]), len(op)),
        "first_time_goal_share": _rate(count(goals, lambda s: s["first_time"]), len(goals)),
        "conv_first_time": conv([s for s in op if s["first_time"]]),
        "conv_other": conv([s for s in op if not s["first_time"]]),
        "header_share": _rate(count(op, lambda s: s["header"]), len(op)),
        "conv_header": conv([s for s in op if s["header"]]),
        "conv_tight": conv(tight),
        "conv_mid": conv(mid),
        "conv_open": conv(opn),
        "conv_tight_minus_open": conv(tight) - conv(opn),
        "near_def_median": med([s["near_def"] for s in nd]),
        "in_box_share": _rate(count(op, lambda s: s["in_box"]), len(op)),
        "in_box_conv": conv([s for s in op if s["in_box"]]),
        "out_box_conv": conv([s for s in op if not s["in_box"]]),
        "blocked_share": _rate(count(op, lambda s: s["blocked"]), len(op)),
        "gk_off_line_at_shot": med([s["gk_off_line"] for s in op if s["gk_off_line"] is not None]),
        "gk_off_bisector_at_shot": med([s["gk_off_bisector"] for s in op if s["gk_off_bisector"] is not None]),
        "late_completion_drop": _bin_rate(bins[5]) - _bin_rate(bins[0]),
        "xg_per_shot": float(np.mean(xgs)) if xgs else math.nan,
    }
    for k in SETUPS:
        out[f"setup_{k.split('_')[0]}"] = _rate(count(op, lambda s, k=k: s["setup"] == k), len(op))
    return out


def _cell(text: str) -> str:
    return text.replace("|", "\\|")


def shots_section(ms: list[dict], t: dict) -> list[str]:
    """The shots table; with no matches the simulated column reads "pending P4 merge"."""
    s = summarize(ms) if ms else {}
    lines = ["## Shots (realism v2, P6)", "", "| Measure | Real | Simulated | Band | Status |", "|---|---|---|---|---|"]
    for key, r in t["rows"].items():
        fmt = r.get("fmt", "{:.3f}")
        v = s.get(key, math.nan)
        real = "—" if r.get("real") is None else fmt.format(r["real"])
        band = "—" if r.get("lo") is None else f"{fmt.format(r['lo'])}–{fmt.format(r['hi'])}"
        sim = "pending P4 merge" if not ms else fmt.format(v) if math.isfinite(v) else "n/a"
        status = "—" if r.get("lo") is None or not math.isfinite(v) else ("MET" if r["lo"] <= v <= r["hi"] else "NOT MET")
        lines.append(f"| {_cell(r['label'])} | {real} | {sim} | {band} | {status} |")
    open_n = sum(1 for m in ms for x in m["shots"] if x["open"])
    notes = [f"conversion splits: judge on ≥ {DEEP_MATCHES} matches (`pnpm realism:deep`); this report has {len(ms)} matches and {open_n} open-play shots."]
    if ms and not s["header_share"]:
        notes.append("Headers read 0: the engine makes them only under `header.rule` 1 (P6 Task 4). Before `firstTime.rule` 1 (Task 3) the "
                     "first-time share is a few percent at most: pressed receivers who release within 0.3 s.")
    c = t.get("xgFit")
    if c:
        notes.append(f"xG refit to DFL model xG ({t.get('xgFitScope', '')}): b0 {c['b0']:+.3f}, bDist {c['bDist']:+.4f}/m, bAngle {c['bAngle']:+.3f}/rad, "
                     f"bHeader {c['bHeader']:+.3f}, bDefenders {c['bDefenders']:+.3f}; `shotModel.xg` under `shotModel.rule` 1.")
    return lines + [""] + [f"- {x}" for x in notes] + [""]


def shots_report(run_dirs: list[Path], targets: dict, note: str, roles: dict[str, str]) -> str:
    ms = [match_shots(d, roles) for d in run_dirs]
    head = f"{len(ms)} synthetic matches ({note})." if ms else f"No synthetic matches yet ({note})."
    return "\n".join(["# Touchline shots diagnostics", "", head, "", ""] + shots_section(ms, targets["shots"]))


def shot_clips(run: Path) -> list[dict]:
    """C5 review list for one match: {category, period, minute, second, player_id}, in match order."""
    fps, _, events = _load(run)
    clips = []

    def add(cat: str, period: str, pframe: int, pid: str) -> None:
        mi, se = _clock(period, pframe, fps)
        clips.append({"category": cat, "period": period, "minute": mi, "second": se, "player_id": pid, "_k": (PERIODS.get(period, 9), pframe)})

    for r in _shot_rows(events, fps):
        if r["penalty"]:
            continue
        if r["first_time"]:
            add("first_time", r["period"], r["pframe"], r["player"])
            if r["goal"]:
                add("first_time_goal", r["period"], r["pframe"], r["player"])
        if r["header"]:
            add("header", r["period"], r["pframe"], r["player"])
        if r["saved"] and r["flight_s"] is not None and r["flight_s"] < QUICK_SAVE_S:
            add("quick_save", r["period"], r["pframe"], r["player"])
    late = 0
    for e in events:
        if e["type"] != "pass":
            continue
        if e["attrs"].get("first_time"):
            add("lay_off", e["period"], e["period_frame_id"], e["player_id"])
        if late < LATE_PASS_MAX and e["period"] == "second_half" and not e["attrs"].get("restart") and e["outcome"] != "successful" \
                and _clock(e["period"], e["period_frame_id"], fps)[0] >= LATE_PASS_MIN:
            add("late_pass", e["period"], e["period_frame_id"], e["player_id"])
            late += 1
    clips.sort(key=lambda c: c["_k"])
    for c in clips:
        del c["_k"]
    return clips


# ---------------------------------------------------------------- real side (data/raw/idsse; aggregates only leave here)

_RESTART = frozenset({"KickOff", "ThrowIn", "GoalKick", "CornerKick", "FreeKick", "Penalty"})


def _ts(s: str) -> float:
    return dt.datetime.fromisoformat(s).timestamp()


def _goal_angle(u: float, v: float) -> float:
    a = abs(math.atan2(GOAL_HW - v, HL - u) - math.atan2(-GOAL_HW - v, HL - u))
    return 2 * math.pi - a if a > math.pi else a


def _real_starts(evr) -> dict[int, float]:
    starts = {}
    for e in evr.iter("Event"):
        k = e.find("KickOff")
        if k is not None and k.get("GameSection") in ("firstHalf", "secondHalf"):
            starts[1 if k.get("GameSection") == "firstHalf" else 2] = _ts(e.get("EventTime"))
    return starts


def _period_of(starts: dict[int, float], wall: float) -> tuple[int, float]:
    per = 2 if 2 in starts and wall >= starts[2] - 60 else 1
    return per, max(0.0, wall - starts[per])


def real_shot_rows(root: Path, match_id: str) -> list[dict]:
    """One row per DFL ShotAtGoal: DFL attributes and the shot's position in the shooter's attacking frame (+x)."""
    from .idsse import filenames

    evr = ET.parse(root / filenames(match_id)["event"]).getroot()
    starts = _real_starts(evr)
    recs = []
    for e in evr.iter("Event"):
        kids = list(e)
        if not kids or kids[0].tag == "Delete":
            continue
        chain = [kids[0]]
        while len(list(chain[-1])):
            chain.append(list(chain[-1])[0])
        recs.append((_ts(e.get("EventTime")), e, chain))
    recs.sort(key=lambda r: r[0])
    rows, last_restart = [], -1e18
    for wall, e, chain in recs:
        top = chain[0].tag
        tags = [c.tag for c in chain]
        if "ShotAtGoal" in tags:
            sh = chain[tags.index("ShotAtGoal")]
            x = float(e.get("X-PositionFromTracking") or e.get("X-Position"))
            y = float(e.get("Y-PositionFromTracking") or e.get("Y-Position"))
            flip = -1.0 if x < HL else 1.0  # the goal nearer the shot is the one attacked
            u, v = flip * (x - HL), flip * (y - 34.0)
            per, sec = _period_of(starts, wall)
            nd = sh.get("AmountOfDefenders")
            rows.append({
                "match": match_id, "period": per, "seconds": sec, "u": u, "v": v,
                "dist": math.hypot(HL - u, v), "angle": _goal_angle(u, v),
                "header": sh.get("TypeOfShot") == "head", "defenders": max(0, int(nd) - 1) if nd is not None else None,
                "xg": float(sh.get("xG")) if sh.get("xG") else None,
                "penalty": top == "Penalty", "restart": top in _RESTART,
                "open": top not in _RESTART and wall - last_restart > SET_PIECE_EXCL_S,
                "goal": tags[-1] == "SuccessfulShot", "on_target": tags[-1] in ("SuccessfulShot", "SavedShot"), "blocked": tags[-1] == "BlockedShot",
                "in_box": u > BOX_U and abs(v) < BOX_W, "ball_control": sh.get("TakerBallControl"),
                "dfl_distance": float(sh.get("DistanceToGoal")) if sh.get("DistanceToGoal") else None,
            })
        if top in _RESTART:
            last_restart = wall
    return rows


def fit_xg(rows: list[dict]) -> dict[str, float]:
    """Least squares of logit(xG) on [1, dist, angle, header, defenders] over the rows with an xG and a defender count
    (ruling 13; preflight F8). Penalties are dropped too: in this feed none has a defender count."""
    use = [r for r in rows if not r["penalty"] and r.get("xg") is not None and r.get("defenders") is not None]
    X = np.array([[1.0, r["dist"], r["angle"], float(r["header"]), float(r["defenders"])] for r in use])
    p = np.clip(np.array([r["xg"] for r in use]), 1e-4, 1 - 1e-4)
    b, *_ = np.linalg.lstsq(X, np.log(p / (1 - p)), rcond=None)
    return dict(zip(("b0", "bDist", "bAngle", "bHeader", "bDefenders"), (float(x) for x in b)))


def real_completion_by_bin(root: Path, match_id: str) -> list[tuple[int, int]]:
    """(completed, total) open-play passes per 15-minute bin of each half, added time in the half's last bin."""
    from kloppy import sportec

    from .idsse import filenames

    f = filenames(match_id)
    ds = sportec.load_event(event_data=str(root / f["event"]), meta_data=str(root / f["meta"]), coordinates="secondspectrum")
    bins = [[0, 0] for _ in range(6)]
    for e in ds.events:
        if e.event_type.name != "PASS" or e.period.id not in (1, 2):
            continue
        if any(type(q).__name__ == "SetPieceQualifier" for q in e.qualifiers or []):
            continue
        b = minute_bin(e.period.id, e.timestamp.total_seconds())
        bins[b][0] += e.result is not None and e.result.name == "COMPLETE"
        bins[b][1] += 1
    return [(c, n) for c, n in bins]


def real_summary(root: Path) -> dict:
    """Aggregates of the seven IDSSE matches: the event-only real rows, late completion drop and the xG fit."""
    from .idsse import MATCHES

    rows = [r for mid in MATCHES for r in real_shot_rows(root, mid)]
    bins = [[0, 0] for _ in range(6)]
    for mid in MATCHES:
        for i, (c, n) in enumerate(real_completion_by_bin(root, mid)):
            bins[i][0] += c
            bins[i][1] += n
    n = len(MATCHES)
    op = [r for r in rows if r["open"] and not r["penalty"]]
    conv = lambda rr: _rate(sum(r["goal"] for r in rr), len(rr))  # noqa: E731
    xgs = [r["xg"] for r in op if r["xg"] is not None]
    fit = fit_xg(rows)
    fitted = [r for r in rows if not r["penalty"] and r["xg"] is not None and r["defenders"] is not None]
    return {
        "matches": n, "shots": len(rows), "open_shots": len(op),
        "shots_per_match": len(rows) / n, "open_shots_per_match": len(op) / n, "goals_per_match": sum(r["goal"] for r in rows) / n,
        "open_conv": conv(op), "header_share": _rate(sum(r["header"] for r in op), len(op)), "conv_header": conv([r for r in op if r["header"]]),
        "in_box_share": _rate(sum(r["in_box"] for r in op), len(op)), "blocked_share": _rate(sum(r["blocked"] for r in op), len(op)),
        "dfl_first_time_proxy": _rate(sum(r["ball_control"] in ("volley", "direct") for r in op), len(op)),
        "xg_per_shot": float(np.mean(xgs)) if xgs else math.nan,
        "dfl_xg_mean_all_shots": float(np.mean([r["xg"] for r in rows if r["xg"] is not None])),
        "dist_vs_dfl_max_abs_m": max((abs(r["dist"] - r["dfl_distance"]) for r in rows if r["dfl_distance"] is not None), default=math.nan),
        "completion_by_bin": [list(b) for b in bins],
        "late_completion_drop": _bin_rate(bins[5]) - _bin_rate(bins[0]),
        "xg_fit": fit, "xg_fit_n": len(fitted),
        "xg_fit_mean": float(np.mean([1 / (1 + math.exp(-(fit["b0"] + fit["bDist"] * r["dist"] + fit["bAngle"] * r["angle"] + fit["bHeader"] * r["header"]
                                                       + fit["bDefenders"] * r["defenders"]))) for r in fitted])),
        "dfl_xg_mean_fitted_rows": float(np.mean([r["xg"] for r in fitted])),
    }


def clips_markdown(runs: list[Path]) -> str:
    lines = ["# C5 clip list", ""]
    for run in runs:
        lines += [f"## {run.name}", "", "| Category | Period | Time | Player |", "|---|---|---|---|"]
        lines += [f"| {c['category']} | {c['period']} | {c['minute']}:{c['second']:02d} | {c['player_id']} |" for c in shot_clips(run)]
        lines.append("")
    return "\n".join(lines)


if __name__ == "__main__":
    import argparse

    ap = argparse.ArgumentParser()
    sub = ap.add_subparsers(dest="cmd", required=True)
    r = sub.add_parser("real", help="print the real rows computed from data/raw/idsse and the xG fit (aggregates only)")
    r.add_argument("--root", default="data/raw/idsse")
    c = sub.add_parser("clips", help="print the C5 clip list of simulated matches as Markdown")
    c.add_argument("runs", nargs="+")
    a = ap.parse_args()
    if a.cmd == "real":
        print(json.dumps(real_summary(Path(a.root)), indent=1))
    else:
        print(clips_markdown([Path(x) for x in a.runs]))

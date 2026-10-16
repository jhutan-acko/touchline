"""Passing diagnostics against real aggregates (realism v2, P3).

Definitions follow the 2026-10-13 analysis (carrier-report.md, gk-report.md, finalthird-report.md) and P2's Task 8b report
(ball thirds); only aggregates are committed. Positions are read at a pass's own tick: the tracking frame with the same
period and period frame id. Open play = the pass has no restart. Keys and real values: targets-idsse.json "passing".

- first-tick share: open-play passes intercepted one tick after release less than 1 m from the passer.
- near-1 completion: open-play passes released with an opponent within 1 m of the passer.
- available-receiver completion: intended receiver 4-65 m away with no opponent within 2 m of the passer->receiver segment
  (0.05 < t < 0.95) and none within 3 m of him; the passer's nearest opponent 2 m or more; by length 10-20 m and 30 m+.
- choice model: conditional logit over the passer's teammates 4-65 m away (current positions), the intended receiver chosen;
  features as carrier-report C3: dist/10, forward du/10, |dv|/10, lane blocked, min(open, 10)/5, line-breaking, keeper.
- switch: |y_end - y| > 25 m. tight: completed, receiver's nearest opponent under 3 m. long: completed, 32 m or more.
- back to the keeper: passes (all) whose intended receiver is the passer's own keeper, over all passes.
- most forward: completed passes to an available receiver with >= 2 available: he is the most forward available.
- crosses: open-play passes of kind cross more than 10 s after the last set piece; contact depth = metres from the attacked
  goal line to the pass end.
- through-ball shots: open-play shots whose team's last completed pass within 6 s was a through or lofted through ball.
- keeper: passes by keepers per team-match; open-play keeper completion; keeper_distribution methods per team-match.
- release timing: a controlled reception, then the receiver's next open-play pass, with no event that ends possession
  (ENDS_POSSESSION; opponent pressure events do not) between, same period, under 15 s; pressure = the receiver's nearest opponent at the reception.
- ball thirds: live frames with a team in possession, ball u in that team's attacking direction; thirds at +-17.5 m.
"""

from __future__ import annotations

import json
import math
from pathlib import Path

import numpy as np

# Events that end the receiver's spell on the ball. Not here: pressure, duels, runs, substitutions and the like, which
# happen while he still holds it (the sim emits an opponent pressure event whenever a receiver is pressed).
ENDS_POSSESSION = frozenset({
    "possession_change", "interception", "tackle", "ball_recovery", "clearance", "block", "ball_out", "foul", "offside",
    "goal", "shot", "keeper_save", "keeper_claim", "keeper_punch", "set_piece", "period_end", "match_end"})
LANE_W, OPEN_M, MIN_D, MAX_D, THIRD, LONG_M = 2.0, 3.0, 4.0, 65.0, 17.5, 32.0
FEAT = ["dist/10", "fwd du/10", "|dv|/10", "lane blocked", "open (min(d,10)/5)", "line-breaking", "GK"]


def _attack(side: str, period: str) -> int:
    """+1 if the side attacks +x in that period: home in the first half, away in the second."""
    return 1 if (side == "home") == (period == "first_half") else -1


def _lane(pu: float, py: float, tu: float, ty: float, ou: np.ndarray, oy: np.ndarray) -> int:
    vx, vy = tu - pu, ty - py
    l2 = max(vx * vx + vy * vy, 1e-9)
    t = np.clip(((ou - pu) * vx + (oy - py) * vy) / l2, 0.0, 1.0)
    d = np.hypot(pu + t * vx - ou, py + t * vy - oy)
    return int(((d < LANE_W) & (t > 0.05) & (t < 0.95)).sum())


def _mid_line(opp_outfield_u: np.ndarray) -> float:
    """Opponents' midfield line: mean u of their 5th-8th deepest outfielders (largest u = deepest); NaN with fewer than 8."""
    s = np.sort(opp_outfield_u)[::-1]
    return float(np.mean(s[4:8])) if len(s) >= 8 else math.nan


def options(pos: dict, period: str, passer: str, roles: dict[str, str]) -> list[dict]:
    """The passer's teammates as options in his team frame; pos = {player_id: (x, y, side)}."""
    side = pos[passer][2]
    a = _attack(side, period)
    pu, py = pos[passer][0] * a, pos[passer][1] * a
    opp = [(x * a, y * a, roles.get(pid) == "GK") for pid, (x, y, s) in pos.items() if s != side]
    ou = np.array([o[0] for o in opp], dtype=float)
    oy = np.array([o[1] for o in opp], dtype=float)
    ml = _mid_line(np.array([o[0] for o in opp if not o[2]], dtype=float))
    out = []
    for pid, (x, y, s) in pos.items():
        if s != side or pid == passer:
            continue
        tu, ty = x * a, y * a
        du, dv = tu - pu, ty - py
        out.append({
            "id": pid, "d": math.hypot(du, dv), "du": du, "dv": dv,
            "lane": _lane(pu, py, tu, ty, ou, oy) if len(opp) else 0,
            "open": float(np.hypot(ou - tu, oy - ty).min()) if len(opp) else 99.0,
            "lb": float(bool(np.isfinite(ml) and pu < ml and tu > ml)),
            "gk": float(roles.get(pid) == "GK"),
        })
    return out


def feats(o: dict) -> list[float]:
    return [o["d"] / 10, o["du"] / 10, abs(o["dv"]) / 10, float(o["lane"] > 0), min(o["open"], 10.0) / 5, o["lb"], o["gk"]]


def clogit(groups: list[tuple[np.ndarray, int]], iters: int = 60) -> tuple[np.ndarray, np.ndarray, int]:
    """Conditional logit over groups of (option features, index chosen): Newton's method with the analysis's 1e-3 ridge."""
    X = np.vstack([g[0] for g in groups])
    gi = np.concatenate([np.full(len(g[0]), i) for i, g in enumerate(groups)])
    y = np.zeros(len(X))
    off = 0
    for g, c in groups:
        y[off + c] = 1.0
        off += len(g)
    n = len(groups)
    b = np.zeros(X.shape[1])
    H = np.eye(len(b))
    for _ in range(iters):
        xb = X @ b
        e = np.exp(xb - xb.max())
        p = e / np.bincount(gi, weights=e, minlength=n)[gi]
        xbar = np.column_stack([np.bincount(gi, weights=p * X[:, j], minlength=n) for j in range(X.shape[1])])
        grad = (y[:, None] * X).sum(0) - xbar.sum(0) - 1e-3 * b
        dx = X - xbar[gi]
        H = (dx * p[:, None]).T @ dx + 1e-3 * np.eye(len(b))
        step = np.linalg.solve(H, grad)
        if np.abs(step).max() > 2:
            step *= 2 / np.abs(step).max()
        b += step
        if np.abs(step).max() < 1e-7:
            break
    return b, np.sqrt(np.diag(np.linalg.inv(H))), n


def _nearest(pos: dict, pid: str) -> float:
    x0, y0, s0 = pos[pid]
    return min((math.hypot(x - x0, y - y0) for q, (x, y, s) in pos.items() if s != s0), default=99.0)


def match_passing(run: Path, roles: dict[str, str]) -> dict:
    """Raw counts of one simulated match (summarize() pools them)."""
    meta = json.loads((run / "meta.json").read_text())
    fps = float(meta["meta"]["tracking"]["fps"])
    home = meta["teams"]["home"]["id"]
    side_of = lambda team: "home" if team == home else "away"  # noqa: E731
    events = [json.loads(line) for line in (run / "domain.jsonl").read_text().splitlines() if line.strip()]
    keys = {(e["period"], e["period_frame_id"]) for e in events if e["type"] in ("pass", "reception")}
    snaps: dict = {}
    thirds = [0, 0, 0]
    us: list[float] = []
    with (run / "tracking.jsonl").open() as fh:
        for line in fh:
            f = json.loads(line)
            b = f["ball"]
            pt = b.get("poss_team_id")
            if b.get("status") and pt is not None:
                u = b["x"] * _attack(side_of(pt), f["period"])
                us.append(u)
                thirds[0 if u < -THIRD else 2 if u > THIRD else 1] += 1
            k = (f["period"], f["frame_id"])
            if k in keys:
                snaps[k] = {p["id"]: (p["x"], p["y"], s) for s in ("home", "away") for p in f["teams"][s]["players"]}
    m = {"passes": 0, "open": 0, "first_tick": 0, "near1": [0, 0], "avail": {"10-20": [0, 0], "30+": [0, 0]}, "long": [0, 0],
         "groups": [], "switch": 0, "tight": [0, 0], "back_gk": 0, "most_fwd": [0, 0], "crosses": 0, "cross_depth": [],
         "through": 0, "shots": 0, "through_shots": 0, "gk_passes": 0, "gk_open": [0, 0], "methods": {}, "release": [],
         "thirds": thirds, "ball_u": us}
    last_sp = -1e18
    last_completed: dict = {}
    for e in events:
        t, a = e["type"], e["attrs"]
        if t == "set_piece":
            last_sp = e["frame_id"]
        elif t == "keeper_distribution":
            m["methods"][a.get("method")] = m["methods"].get(a.get("method"), 0) + 1
        elif t == "shot" and not a.get("restart") and a.get("technique") != "penalty":
            m["shots"] += 1
            lc = last_completed.get(e["team_id"])
            if lc and e["frame_id"] - lc[0] <= 6 * fps and lc[1] in ("through", "lofted_through"):
                m["through_shots"] += 1
        if t != "pass":
            continue
        passer, intended, ok = e["player_id"], a.get("intended_receiver_id"), e["outcome"] == "successful"
        side = side_of(e["team_id"])
        m["passes"] += 1
        m["gk_passes"] += roles.get(passer) == "GK"
        m["back_gk"] += bool(intended) and roles.get(intended) == "GK" and roles.get(passer) != "GK"
        if ok and e["x_end"] is not None:
            m["long"][0] += 1
            m["long"][1] += math.hypot(e["x_end"] - e["x"], e["y_end"] - e["y"]) >= LONG_M
            last_completed[e["team_id"]] = (e["frame_id"], a.get("kind"))
        if a.get("restart"):
            continue
        m["open"] += 1
        if roles.get(passer) == "GK":
            m["gk_open"][0] += 1
            m["gk_open"][1] += ok
        ends = e["x_end"] is not None
        if e["outcome"] == "intercepted" and e["frame_id_end"] is not None and e["frame_id_end"] - e["frame_id"] <= 1 and ends \
                and math.hypot(e["x_end"] - e["x"], e["y_end"] - e["y"]) < 1:
            m["first_tick"] += 1
        if ends and abs(e["y_end"] - e["y"]) > 25:
            m["switch"] += 1
        if a.get("kind") in ("through", "lofted_through"):
            m["through"] += 1
        if a.get("kind") == "cross" and e["frame_id"] - last_sp > 10 * fps:
            m["crosses"] += 1
            if ends:
                m["cross_depth"].append(52.5 - e["x_end"] * _attack(side, e["period"]))
        pos = snaps.get((e["period"], e["period_frame_id"]))
        if pos is None or passer not in pos:
            continue
        opts = options(pos, e["period"], passer, roles)
        near = _nearest(pos, passer)
        if near < 1:
            m["near1"][0] += 1
            m["near1"][1] += ok
        avail = [o for o in opts if o["lane"] == 0 and o["open"] >= OPEN_M and MIN_D <= o["d"] <= MAX_D]
        oi = next((o for o in opts if o["id"] == intended), None)
        if oi is not None and near >= 2 and oi in avail:
            cell = "10-20" if 10 <= oi["d"] < 20 else "30+" if oi["d"] >= 30 else None
            if cell:
                m["avail"][cell][0] += 1
                m["avail"][cell][1] += ok
        window = [o for o in opts if MIN_D <= o["d"] <= MAX_D]
        ci = next((j for j, o in enumerate(window) if o["id"] == intended), None)
        if ci is not None and len(window) >= 2:
            m["groups"].append((np.array([feats(o) for o in window]), ci))
        if ok:
            orc = next((o for o in opts if o["id"] == a.get("receiver_id")), None)
            if orc is not None:
                m["tight"][0] += 1
                m["tight"][1] += orc["open"] < OPEN_M
                if orc in avail and len(avail) >= 2:
                    m["most_fwd"][0] += 1
                    m["most_fwd"][1] += orc["du"] == max(o["du"] for o in avail)
    for i, e in enumerate(events):
        if e["type"] != "reception" or e["attrs"].get("first_touch") != "controlled":
            continue
        for g in events[i + 1:]:
            if g["period"] != e["period"] or g["frame_id"] - e["frame_id"] > 15 * fps or g["type"] in ENDS_POSSESSION:
                break
            if g["type"] == "pass":
                pos = snaps.get((e["period"], e["period_frame_id"]))
                if g["player_id"] == e["player_id"] and not g["attrs"].get("restart") and pos and e["player_id"] in pos:
                    m["release"].append(((g["frame_id"] - e["frame_id"]) / fps, _nearest(pos, e["player_id"])))
                break
    return m


def _rate(pairs: list) -> float:
    t = sum(p[0] for p in pairs)
    return sum(p[1] for p in pairs) / t if t else math.nan


def summarize(ms: list[dict]) -> dict:
    n = len(ms)
    tot = lambda k: sum(x[k] for x in ms)  # noqa: E731
    rel = [r for x in ms for r in x["release"]]
    lt2 = [t for t, d in rel if d < 2]
    alls = [t for t, _ in rel]
    th = [sum(x["thirds"][i] for x in ms) for i in range(3)]
    us = [u for x in ms for u in x["ball_u"]]
    depths = [d for x in ms for d in x["cross_depth"]]
    methods: dict = {}
    for x in ms:
        for k, v in x["methods"].items():
            methods[k] = methods.get(k, 0) + v
    med = lambda v: float(np.median(v)) if v else math.nan  # noqa: E731
    share = lambda v, f: sum(1 for t in v if f(t)) / len(v) if v else math.nan  # noqa: E731
    return {
        "passes_per_match": tot("passes") / n,
        "first_tick_share": tot("first_tick") / max(1, tot("open")),
        "near1_completion": _rate([x["near1"] for x in ms]),
        "avail_10_20_completion": _rate([x["avail"]["10-20"] for x in ms]),
        "avail_30p_completion": _rate([x["avail"]["30+"] for x in ms]),
        "long_share": _rate([x["long"] for x in ms]),
        "switch_share": tot("switch") / max(1, tot("open")),
        "tight_share": _rate([x["tight"] for x in ms]),
        "back_gk_share": tot("back_gk") / max(1, tot("passes")),
        "most_fwd_share": _rate([x["most_fwd"] for x in ms]),
        "crosses_per_match": tot("crosses") / n,
        "cross_contact_m": med(depths),
        "through_per_match": tot("through") / n,
        "through_shot_share": tot("through_shots") / max(1, tot("shots")),
        "keeper_passes_per_team": tot("gk_passes") / (2 * n),
        "keeper_open_completion": _rate([x["gk_open"] for x in ms]),
        # The engine emits only "throw" and "kick" until Task 7 (G5, plan ruling 13) adds "punt": reads 0 before then.
        "punts_per_team": methods.get("punt", 0) / (2 * n),
        "throws_per_team": methods.get("throw", 0) / (2 * n),
        "release_median_lt2_s": med(lt2),
        "release_under1_lt2": share(lt2, lambda t: t < 1),
        "release_median_s": med(alls),
        "release_over3": share(alls, lambda t: t > 3),
        "ball_own_third": th[0] / sum(th) if sum(th) else math.nan,
        "ball_u_mean": float(np.mean(us)) if us else math.nan,
    }


def _cell(text: str) -> str:
    """Escape pipes so a label or feature name does not split a Markdown table cell."""
    return text.replace("|", "\\|")


def passing_section(ms: list[dict], t: dict) -> list[str]:
    s = summarize(ms)
    lines = ["## Passing (realism v2, P3)", "", "| Measure | Real | Simulated | Band | Status |", "|---|---|---|---|---|"]
    for key, r in t["rows"].items():
        fmt = r.get("fmt", "{:.3f}")
        v = s.get(key, math.nan)
        real = "—" if r.get("real") is None else fmt.format(r["real"])
        band = "—" if r.get("lo") is None else f"{fmt.format(r['lo'])}–{fmt.format(r['hi'])}"
        status = "—" if r.get("lo") is None or not math.isfinite(v) else ("MET" if r["lo"] <= v <= r["hi"] else "NOT MET")
        lines.append(f"| {_cell(r['label'])} | {real} | {fmt.format(v) if math.isfinite(v) else 'n/a'} | {band} | {status} |")
    groups = [g for x in ms for g in x["groups"]]
    lines += ["", "### Pass-choice model refit", "",
              "Conditional logit over the passer's teammates 4–65 m away at release, intended receiver chosen (carrier-report C3). "
              "Real: the pooled fit with its 90 % interval.", ""]
    if len(groups) < 50:
        return lines + [f"Too few passes with positions to refit ({len(groups)}).", ""]
    b, se, n = clogit(groups)
    lines += [f"{n} passes.", "", "| Feature | Real (90 % interval) | Simulated | Status |", "|---|---|---|---|"]
    for i, name in enumerate(t["choice"]["features"]):
        rb, rs = t["choice"]["b"][i], t["choice"]["se"][i]
        lo, hi = rb - 1.645 * rs, rb + 1.645 * rs
        lines.append(f"| {_cell(name)} | {rb:+.2f} ({lo:+.2f} to {hi:+.2f}) | {b[i]:+.2f} ± {se[i]:.2f} | {'MET' if lo <= b[i] <= hi else 'NOT MET'} |")
    return lines + [""]


def passing_report(run_dirs: list[Path], targets: dict, note: str, roles: dict[str, str]) -> str:
    ms = [match_passing(d, roles) for d in run_dirs]
    return "\n".join(["# Touchline passing diagnostics", "", f"{len(ms)} synthetic matches ({note}).", "",
                       "Note: punts read 0 until Task 7 (G5) makes the engine emit method punt; until then keeper kicks are recorded as kick.", ""] + passing_section(ms, targets["passing"]))

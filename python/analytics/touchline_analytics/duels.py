"""Duels, transitions and pressing diagnostics against real aggregates (realism v2, P4).

Definitions are ported from the 2026-10-13 analysis scripts (tk_analysis.py, trans_analysis.py, ft_analysis.py pressing(),
carrier-report C1); only aggregates are committed. Keys and real values: targets-idsse.json "duels". Events and tracking
frames are read as passing.py reads them: an event's positions are the tracking frame with its period and period frame id.

- Tackle attempts, as tk_analysis.py: `tackle` events with outcome lost or foul, or won with `attrs.ball` (the won tackle
  step.ts emits for a lost take-on has no `ball`: it is the take-on's record). The defender wins on won.
  Approach, as tk_sim_events.ts / tk_real_events.py: the tackler's bearing from the carrier against the carrier's velocity
  (frames +-1 tick) when he moves faster than 1 m/s, else against his attack direction; front under 60 deg, behind
  (side and behind pooled, as the real 0.45) from 60 deg. Support, as tk_real_events.py n3: the carrier's
  opponents within 3 m of him, the tackler and keepers included; alone = exactly 1, supported = 2 or more (fix round 1;
  the real 0-within-3-m bin has no sim analogue). A ground duel is a tackle attempt or a `take_on`.
- Fouls by `attrs.kind`: defender = tackle or take_on, attacker = shielding, aerial = aerial. Free kicks within 30 m: a
  `set_piece` free kick whose spot is within 30 m of the goal its side attacks, outside the box (as the real count).
  Penalties as report.balance(). Yellows: yellow or second_yellow; sent off: second_yellow or red. Cards per foul: cards
  without reason conduct over fouls.
- Transitions, on the analysis's 5 Hz grid (every tick whose frame id is a multiple of round(0.2 * fps)), as
  trans_analysis.py: a loss is a change of the possessing team (ball.poss_team_id) with the ball live since the losing
  team's possession began; the main filter keeps losses whose previous possession lasted at least 5 s. Both teams must
  have 10 players, 9 of them outfielders. Velocities are central differences over +-1 grid step (0.4 s).
  - Join: losing outfielders reaching 3 m of the ball within 3 s, by distance at the loss (ball live 0-4 s).
  - Reach: losing outfielders within 5 m of the ball within 3 s, per loss; peak speed of those 0-5 m away at the loss.
  - Regained: the losing team owns the ball again within 5 s, before the ball goes dead.
  - Recovery: share of losing outfielders moving toward their own goal faster than 4 m/s, mean over losses at each time,
    censored at a dead ball and (after the loss) at the losing team's regain. Pause ratio: losing outfield mean speed over
    0.8-1.4 s over the same at -1 s.
- Pressing, as ft_analysis.py pressing() on the same grid: open play = live, a team in possession, more than 10 s after
  the last restart, both teams with 10 players; the carrier is the possessing team's player nearest the ball within 2 m.
  An opposing outfielder is engaged within 3 m, or within 6 m closing at more than 1.5 m/s; an episode starts at >= 2
  engaged after 1 s with fewer. Trigger lifts: share at episode start over a 1 Hz baseline of the other open frames.
  Press runs: an engaged defender's closing run (walked back while closing faster than 1 m/s, up to 3 s) of at least
  0.6 s from at least 5 m; DM counts as CM.
- Options per pass (carrier-report C1): open-play passes with both teams at 9 or more; the passer's teammates with no
  opponent within 3 m, and with a clear 2 m lane, by passing.options.
- Distance: metrics.tracking_metrics' distance per full-match outfielder (the gate's distance_km_median).
"""

from __future__ import annotations

import json
import math
from collections import Counter
from pathlib import Path

import numpy as np

from .metrics import tracking_metrics
from .passing import _attack, _cell, options

GRID_S = 0.2
FRONT_DEG, HEADING_MIN_MPS, SUPPORT_M = 60.0, 1.0, 3.0
BOX_U, BOX_W, HALF_L, THIRD = 36.0, 20.16, 52.5, 17.5
PREV_MIN_S, REGAIN_S, RESTART_EXCL_S = 5.0, 5.0, 10.0
JOIN_BINS = ((0, 5), (5, 10), (10, 15), (15, 20), (20, 30))
K = np.arange(-5, 51)  # grid steps around a loss: -1 s .. +10 s
ROLE_GROUP = {"DM": "CM"}
PRESSER_ROLES = ("CM", "W", "FB", "AM", "ST", "CB")
PERIODS = {"first_half": 1, "second_half": 2}


def _bearing_bin(rx: float, ry: float, vx: float, vy: float, attack: int) -> str | None:
    """front / behind: the tackler at (rx, ry) from the carrier, against the carrier's velocity or, at 1 m/s or less, his attack direction."""
    if not all(map(math.isfinite, (rx, ry))) or math.hypot(rx, ry) < 1e-9:
        return None
    if math.isfinite(vx) and math.isfinite(vy) and math.hypot(vx, vy) > HEADING_MIN_MPS:
        ref = (vx, vy)
    else:
        ref = (float(attack), 0.0)
    c = (rx * ref[0] + ry * ref[1]) / (math.hypot(rx, ry) * math.hypot(*ref))
    deg = math.degrees(math.acos(max(-1.0, min(1.0, c))))
    return "front" if deg < FRONT_DEG else "behind"


def _read_tracking(run: Path, home: str):
    """Tracking as arrays: X, Y (frames x players, NaN when absent), ball, live, possession (0 home, 1 away, -1 none), period, frame id."""
    lines = (run / "tracking.jsonl").read_text().splitlines()
    n = len(lines)
    cols: dict[str, int] = {}
    side: list[str] = []
    X = np.full((n, 40), np.nan)
    Y = np.full((n, 40), np.nan)
    bx, by = np.full(n, np.nan), np.full(n, np.nan)
    live = np.zeros(n, bool)
    poss = np.full(n, -1)
    per = np.zeros(n, int)
    fid = np.zeros(n, int)
    for i, line in enumerate(lines):
        f = json.loads(line)
        per[i] = PERIODS[f["period"]]
        fid[i] = f["frame_id"]
        b = f["ball"]
        bx[i], by[i], live[i] = b["x"], b["y"], bool(b.get("status"))
        pt = b.get("poss_team_id")
        poss[i] = -1 if pt is None else 0 if pt == home else 1
        for s in ("home", "away"):
            for p in f["teams"][s]["players"]:
                j = cols.get(p["id"])
                if j is None:
                    j = cols[p["id"]] = len(cols)
                    side.append(s)
                    if j >= X.shape[1]:
                        X = np.hstack([X, np.full_like(X, np.nan)])
                        Y = np.hstack([Y, np.full_like(Y, np.nan)])
                X[i, j], Y[i, j] = p["x"], p["y"]
    P = len(cols)
    return dict(ids=list(cols), cols=cols, side=np.array([0 if s == "home" else 1 for s in side], int), X=X[:, :P], Y=Y[:, :P],
                bx=bx, by=by, live=live, poss=poss, per=per, fid=fid)


def _vel_native(T: dict, i: int, j: int, fps: float) -> tuple[float, float]:
    """Velocity of column j at row i from the rows +-1 tick in the same period (one-sided at a period's edge)."""
    n, per = len(T["per"]), T["per"]
    lo = i - 1 if i > 0 and per[i - 1] == per[i] else i
    hi = i + 1 if i + 1 < n and per[i + 1] == per[i] else i
    if hi == lo:
        return math.nan, math.nan
    k = fps / (hi - lo)
    return (T["X"][hi, j] - T["X"][lo, j]) * k, (T["Y"][hi, j] - T["Y"][lo, j]) * k


def _duel_events(m: dict, events: list[dict], T: dict, row: dict, side_of, fps: float) -> None:
    """Tackle attempts, take-ons, fouls, cards and restarts into m."""
    cols = T["cols"]
    for e in events:
        t, a = e["type"], e["attrs"]
        if t == "take_on":
            m["take_ons"].append(a.get("outcome") == "lost")
        elif t == "tackle" and (a.get("outcome") in ("lost", "foul") or (a.get("outcome") == "won" and "ball" in a)):
            won = a["outcome"] == "won"
            i = row.get((PERIODS[e["period"]], e["period_frame_id"]))
            jt, jc = cols.get(e["player_id"]), cols.get(a.get("opponent_id"))
            if i is None or jt is None or jc is None or not (np.isfinite(T["X"][i, jt]) and np.isfinite(T["X"][i, jc])):
                m["tackles"].append((won, None, None))
                continue
            cx, cy = T["X"][i, jc], T["Y"][i, jc]
            vx, vy = _vel_native(T, i, jc, fps)
            attack = _attack("home" if T["side"][jc] == 0 else "away", e["period"])
            b = _bearing_bin(T["X"][i, jt] - cx, T["Y"][i, jt] - cy, vx, vy, attack)
            d = np.hypot(T["X"][i] - cx, T["Y"][i] - cy)
            n = int(((T["side"] == T["side"][jt]) & np.isfinite(d) & (d <= SUPPORT_M)).sum())
            m["tackles"].append((won, b, n))
        elif t == "foul":
            m["fouls"][a.get("kind")] += 1
        elif t == "card":
            col = a.get("colour")
            m["yellows"] += col in ("yellow", "second_yellow")
            m["sent_off"] += col in ("second_yellow", "red")
            m["foul_cards"] += a.get("reason") != "conduct"
        elif t == "aerial_duel":
            m["aerials"] += 1
        elif t == "shot":
            m["penalties"] += a.get("technique") == "penalty"
        elif t == "set_piece" and a.get("kind") == "free_kick" and e["x"] is not None:
            u = e["x"] * _attack(side_of(e["team_id"]), e["period"])
            m["fk30"] += math.hypot(HALF_L - u, e["y"]) < 30 and not (u > BOX_U and abs(e["y"]) < BOX_W)


def _options(m: dict, events: list[dict], T: dict, row: dict, roles: dict[str, str]) -> None:
    for e in events:
        if e["type"] != "pass" or e["attrs"].get("restart"):
            continue
        i = row.get((PERIODS[e["period"]], e["period_frame_id"]))
        if i is None:
            continue
        pos = {pid: (T["X"][i, j], T["Y"][i, j], "home" if T["side"][j] == 0 else "away") for pid, j in T["cols"].items() if np.isfinite(T["X"][i, j])}
        if e["player_id"] not in pos or min(sum(1 for p in pos.values() if p[2] == s) for s in ("home", "away")) < 9:
            continue
        opts = options(pos, e["period"], e["player_id"], roles)
        m["opts"].append((sum(o["lane"] == 0 for o in opts), sum(o["open"] >= 3.0 for o in opts)))


def _grid(T: dict, fps: float, roles: dict[str, str]) -> dict:
    """The 5 Hz analysis grid with per-side frame metrics (trans_analysis.frame_metrics, ft_analysis.prep)."""
    step = max(1, round(GRID_S * fps))
    g = np.where(T["fid"] % step == 0)[0]
    X, Y, per = T["X"][g], T["Y"][g], T["per"][g]
    t = T["fid"][g] / fps
    n = len(g)
    VX, VY = np.full_like(X, np.nan), np.full_like(Y, np.nan)
    ok = (np.abs(t[2:] - t[:-2] - 2 * GRID_S) < 0.05) & (per[2:] == per[:-2])
    VX[1:-1] = np.where(ok[:, None], (X[2:] - X[:-2]) / (2 * GRID_S), np.nan)
    VY[1:-1] = np.where(ok[:, None], (Y[2:] - Y[:-2]) / (2 * GRID_S), np.nan)
    bx, by = T["bx"][g], T["by"][g]
    bvx = np.full(n, np.nan)
    bvx[1:-1] = np.where(ok, (bx[2:] - bx[:-2]) / (2 * GRID_S), np.nan)
    gk = np.array([roles.get(pid) == "GK" for pid in T["ids"]], bool)
    D = np.stack([np.where(per == 1, 1, -1), np.where(per == 1, -1, 1)])  # attack direction: home +x in the first half
    pres = np.isfinite(X)
    DB = np.hypot(X - bx[:, None], Y - by[:, None])
    G = dict(n=n, t=t, per=per, X=X, Y=Y, VX=VX, VY=VY, bx=bx, by=by, bvx=bvx, live=T["live"][g], poss=T["poss"][g], D=D, DB=DB, gk=gk,
             side=T["side"], roles=[roles.get(pid, "") for pid in T["ids"]])
    for s in (0, 1):
        m = T["side"] == s
        outf = m & ~gk
        npres, nout = (pres & m).sum(1), (pres & outf).sum(1)
        valid = (npres >= 10) & (nout >= 9)
        VU = D[s][:, None] * VX
        vu = np.where(outf[None, :], VU, np.nan)
        nv = (~np.isnan(vu)).sum(1)
        back4 = np.where(nv > 0, np.nansum(vu < -4, 1) / np.maximum(1, nv), np.nan)
        sp = np.where(outf[None, :], np.hypot(VX, VY), np.nan)
        ns = (~np.isnan(sp)).sum(1)
        speed = np.where(ns > 0, np.nansum(sp, 1) / np.maximum(1, ns), np.nan)
        G[f"valid{s}"], G[f"npres{s}"] = valid, npres
        G[f"back4_{s}"] = np.where(valid, back4, np.nan)
        G[f"speed{s}"] = np.where(valid, speed, np.nan)
    return G


def _transitions(G: dict) -> list[tuple[int, int, int, float]]:
    """Live-play changes of the possessing team: (grid index, winner, loser, seconds the loser had it) (trans_analysis.transitions)."""
    out = []
    cur, cur_start, dead, cur_per = -1, 0.0, True, None
    for i in range(G["n"]):
        if not G["live"][i] or np.isnan(G["bx"][i]):
            dead = True
            continue
        p = G["poss"][i]
        if p < 0:
            continue
        if G["per"][i] != cur_per:
            dead, cur_per = True, G["per"][i]
        if p != cur:
            if cur >= 0 and not dead:
                out.append((i, int(p), int(cur), float(G["t"][i] - cur_start)))
            cur, cur_start = p, G["t"][i]
        elif dead:
            cur_start = G["t"][i]
        dead = False
    return out


def _losses(m: dict, G: dict) -> None:
    n, t, per, live, poss = G["n"], G["t"], G["per"], G["live"], G["poss"]
    w4, w3, w15 = round(4 / GRID_S), round(3 / GRID_S), round(15 / GRID_S)
    z = int(np.where(K == 0)[0][0])
    for i0, W, L, prev in _transitions(G):
        if not (G["valid0"][i0] and G["valid1"][i0]) or prev < PREV_MIN_S:
            continue
        idx = i0 + K
        idc = np.clip(idx, 0, n - 1)
        okt = (idx >= 0) & (idx < n) & (np.abs(t[idc] - t[i0] - K * GRID_S) < 0.05) & (per[idc] == per[i0])
        alive_live = np.zeros(len(K), bool)
        alive = np.zeros(len(K), bool)
        for j, kk in enumerate(K):
            a, b = (i0 + kk, i0) if kk < 0 else (i0, i0 + kk)
            alive_live[j] = okt[j] and live[max(0, a):min(n, b + 1)].all()
            alive[j] = alive_live[j] and (kk <= 0 or not (poss[i0 + 1:b + 1] == L).any())
        hor = min(n - 1, i0 + w15)
        seg = live[i0:hor + 1] & (per[i0:hor + 1] == per[i0])
        dead_at = int(np.argmin(seg)) if not seg.all() else len(seg)
        back = np.where(poss[i0:hor + 1][:dead_at] == L)[0]
        m["regain"].append(bool(len(back)) and back[0] * GRID_S <= REGAIN_S + 1e-9)
        for key, arr in (("back4", G[f"back4_{L}"]), ("speed", G[f"speed{L}"])):
            v = np.where(alive, arr[idc], np.nan)
            fin = np.isfinite(v)
            m[key][0][fin] += v[fin]
            m[key][1][fin] += 1
        if not alive_live[z:z + w4 + 1].all():
            continue
        cols = np.where((G["side"] == L) & ~G["gk"] & np.isfinite(G["X"][i0]))[0]
        reach5 = 0
        for j in cols:
            d0 = G["DB"][i0, j]
            dmin = np.nanmin(G["DB"][i0:i0 + w3 + 1, j])
            sp = np.hypot(G["VX"][i0:i0 + w3 + 1, j], G["VY"][i0:i0 + w3 + 1, j])
            m["join"].append((float(d0), bool(dmin <= 3.0)))
            if d0 < 5 and np.isfinite(sp).any():
                m["cp_speed"].append(float(np.nanmax(sp)))
            reach5 += bool(dmin <= 5.0)
        m["reach5"].append(reach5)


def _pressing(m: dict, G: dict) -> None:
    n, t, per, live, poss, X, Y, VX, VY = G["n"], G["t"], G["per"], G["live"], G["poss"], G["X"], G["Y"], G["VX"], G["VY"]
    w1, w3 = round(1 / GRID_S), round(3 / GRID_S)
    since = np.full(n, np.inf)
    last = 0.0
    for i in range(n):
        if i == 0 or per[i] != per[i - 1] or (live[i] and not live[i - 1]):
            last = t[i]
        since[i] = t[i] - last
    cnt = np.minimum(G["npres0"], G["npres1"])
    open_ = live & (poss >= 0) & np.isfinite(G["bx"]) & (since > RESTART_EXCL_S) & (cnt >= 10)
    car = np.full(n, -1)
    for s in (0, 1):
        rows = np.where(poss == s)[0]
        dd = np.where((G["side"] == s)[None, :] & np.isfinite(G["DB"][rows]), G["DB"][rows], np.inf)
        if len(rows):
            j = dd.argmin(1)
            okc = dd[np.arange(len(j)), j] <= 2.0
            car[rows[okc]] = j[okc]
    engaged = np.zeros(n, int)
    close: dict[int, np.ndarray] = {}
    for i in np.where(open_ & (car >= 0))[0]:
        j = car[i]
        idx = np.where((G["side"] == 1 - poss[i]) & ~G["gk"] & np.isfinite(X[i]))[0]
        rx, ry = X[i, j] - X[i, idx], Y[i, j] - Y[i, idx]
        dist = np.hypot(rx, ry)
        vcl = (VX[i, idx] * rx + VY[i, idx] * ry) / np.maximum(dist, 1e-6)
        vcl = np.where(np.isfinite(vcl), vcl, 0.0)
        eng = (dist < 3.0) | ((dist < 6.0) & (vcl > 1.5))
        engaged[i], close[i] = int(eng.sum()), idx[eng]
    spell = np.full(n, -1)
    for i in range(1, n):
        if car[i] >= 0 and car[i] == car[i - 1] and per[i] == per[i - 1] and open_[i - 1]:
            spell[i] = spell[i - 1]
        elif car[i] >= 0:
            spell[i] = i
    start_of = {p: int(np.where(per == p)[0][0]) for p in np.unique(per)}

    def triggers(i: int) -> tuple[bool, bool]:
        """(back-to-goal receiver, ball in the defenders' own third)."""
        d = G["D"][poss[i]][i]
        ss = spell[i]
        recent = ss >= 0 and t[i] - t[ss] <= 1.5 + 1e-9
        bk = max(start_of[per[i]], ss - 1) if ss >= 0 else i
        b_in = d * G["bvx"][bk] if np.isfinite(G["bvx"][bk]) else 0.0
        return bool(recent and b_in > 5.0), bool(d * G["bx"][i] >= THIRD)

    last_start = -10
    for i in np.where(open_ & (car >= 0))[0]:
        is_start = engaged[i] >= 2 and (i < w1 or engaged[i - w1:i].max() < 2) and i - last_start > w1
        if not is_start:
            if i % w1 == 0:
                btg, own = triggers(i)
                m["press_base"]["n"] += 1
                m["press_base"]["btg"] += btg
                m["press_base"]["own"] += own
            continue
        last_start = i
        jc = car[i]
        btg, own = triggers(i)
        m["press_eps"].append({"n_engaged": int(engaged[i]), "btg": btg, "own": own})
        a = start_of[per[i]]
        for pj in close[i]:
            k = i
            while k > max(a, i - w3):
                kk = k - 1
                rx, ry = X[kk, jc] - X[kk, pj], Y[kk, jc] - Y[kk, pj]
                dd = math.hypot(rx, ry)
                vx, vy = VX[kk, pj], VY[kk, pj]
                if not (np.isfinite(vx) and np.isfinite(rx)) or dd < 1e-6:
                    break
                if (vx * rx + vy * ry) / dd < 1.0:
                    break
                k = kk
            if not np.isfinite(X[k, pj]):
                continue
            d0 = math.hypot(X[k, jc] - X[k, pj], Y[k, jc] - Y[k, pj])
            sp = np.hypot(VX[k:i + 1, pj], VY[k:i + 1, pj])
            if d0 >= 5.0 and (i - k) * GRID_S >= 0.6 - 1e-9 and np.isfinite(sp).any():
                role = G["roles"][pj]
                m["press_runs"].append((ROLE_GROUP.get(role, role), float(np.nanmax(sp))))
    m["open_s"] += float(open_.sum() * GRID_S)


def _distance_km(T: dict, fps: float) -> float:
    offset = {1: 0.0, 2: 10_000.0}

    def frames():
        for i in range(len(T["per"])):
            row = T["X"][i]
            yield T["per"][i], offset[T["per"][i]] + T["fid"][i] / fps, bool(T["live"][i]), \
                {pid: (row[j], T["Y"][i, j]) for pid, j in T["cols"].items() if np.isfinite(row[j])}

    return tracking_metrics(frames())["distance_km_median"]


def match_duels(run: Path, roles: dict[str, str]) -> dict:
    """Raw counts of one simulated match (summarize() pools them)."""
    meta = json.loads((run / "meta.json").read_text())
    fps = float(meta["meta"]["tracking"]["fps"])
    home = meta["teams"]["home"]["id"]
    side_of = lambda team: "home" if team == home else "away"  # noqa: E731
    events = [json.loads(line) for line in (run / "domain.jsonl").read_text().splitlines() if line.strip()]
    T = _read_tracking(run, home)
    row = {(int(p), int(f)): i for i, (p, f) in enumerate(zip(T["per"], T["fid"]))}
    m = {"tackles": [], "take_ons": [], "fouls": Counter(), "yellows": 0, "sent_off": 0, "foul_cards": 0, "aerials": 0, "penalties": 0, "fk30": 0,
         "opts": [], "regain": [], "join": [], "reach5": [], "cp_speed": [], "back4": (np.zeros(len(K)), np.zeros(len(K))),
         "speed": (np.zeros(len(K)), np.zeros(len(K))), "press_eps": [], "press_base": Counter(), "press_runs": [], "open_s": 0.0}
    _duel_events(m, events, T, row, side_of, fps)
    _options(m, events, T, row, roles)
    G = _grid(T, fps, roles)
    _losses(m, G)
    _pressing(m, G)
    m["distance_km"] = _distance_km(T, fps)
    return m


def _mean(v) -> float:
    return float(np.mean(v)) if len(v) else math.nan


def _nanmean(v: np.ndarray) -> float:
    return float(np.nanmean(v)) if np.isfinite(v).any() else math.nan


def _at(curve: np.ndarray, lo: float, hi: float | None = None) -> np.ndarray:
    """Curve values for times lo..hi (s) on the K grid."""
    hi = lo if hi is None else hi
    sel = (K * GRID_S >= lo - 1e-9) & (K * GRID_S <= hi + 1e-9)
    return curve[sel]


def summarize(ms: list[dict]) -> dict:
    n = len(ms)
    tk = [x for m in ms for x in m["tackles"]]
    win = lambda rows: _mean([w for w, _, _ in rows])  # noqa: E731
    take_ons = [x for m in ms for x in m["take_ons"]]
    fouls = sum((m["fouls"] for m in ms), Counter())
    nf = sum(fouls.values())
    join = [x for m in ms for x in m["join"]]
    reach5 = [x for m in ms for x in m["reach5"]]
    curves = {}
    for key in ("back4", "speed"):
        s, c = sum(m[key][0] for m in ms), sum(m[key][1] for m in ms)
        curves[key] = np.where(c > 0, s / np.maximum(c, 1), np.nan)
    eps = [e for m in ms for e in m["press_eps"]]
    base = sum((m["press_base"] for m in ms), Counter())
    runs = [r for m in ms for r in m["press_runs"]]
    open_min = sum(m["open_s"] for m in ms) / 60
    lift = lambda k: (_mean([e[k] for e in eps]) / (base[k] / base["n"])) if eps and base["n"] and base[k] else math.nan  # noqa: E731
    opts = [o for m in ms for o in m["opts"]]
    with np.errstate(all="ignore"):
        pre = _at(curves["back4"], 0.0, 1.4)
        speed_ref = _at(curves["speed"], -1.0)
        out = {
            "tackle_win": win(tk),
            "tackle_win_front": win([r for r in tk if r[1] == "front"]),
            "tackle_win_behind": win([r for r in tk if r[1] == "behind"]),
            "tackle_win_none_3m": win([r for r in tk if r[2] == 0]),
            "tackle_win_alone": win([r for r in tk if r[2] == 1]),
            "tackle_win_supported": win([r for r in tk if r[2] is not None and r[2] >= 2]),
            "take_on_def_win": _mean(take_ons),
            "ground_duel_def_win": _mean([w for w, _, _ in tk] + take_ons),
            "ground_duels_per_match": (len(tk) + len(take_ons)) / n,
            "defender_fouls_per_match": (fouls["tackle"] + fouls["take_on"]) / n,
            "attacker_fouls_per_match": fouls["shielding"] / n,
            "aerial_duels_per_match": sum(m["aerials"] for m in ms) / n,
            "aerial_fouls_per_match": fouls["aerial"] / n,
            "fouls_per_match": nf / n,
            "fk_30m_per_match": sum(m["fk30"] for m in ms) / n,
            "penalties_per_match": sum(m["penalties"] for m in ms) / n,
            "yellows_per_match": sum(m["yellows"] for m in ms) / n,
            "sent_off_per_match": sum(m["sent_off"] for m in ms) / n,
            "cards_per_foul": sum(m["foul_cards"] for m in ms) / nf if nf else math.nan,
            **{f"join_{lo}_{hi}": _mean([r for d, r in join if lo <= d < hi]) for lo, hi in JOIN_BINS},
            "cp_reach5": _mean(reach5),
            "cp_reach5_ge3": _mean([r >= 3 for r in reach5]),
            "cp_peak_speed": float(np.median([s for m in ms for s in m["cp_speed"]])) if any(m["cp_speed"] for m in ms) else math.nan,
            "regain_5s": _mean([r for m in ms for r in m["regain"]]),
            "recover_pre": float(np.nanmax(pre)) if np.isfinite(pre).any() else math.nan,
            "recover_2s": float(_at(curves["back4"], 2.0)[0]),
            "recover_3s": float(_at(curves["back4"], 3.0)[0]),
            "recover_5_6s": _nanmean(_at(curves["back4"], 5.0, 6.0)),
            "recover_10s": float(_at(curves["back4"], 10.0)[0]),
            "pause_speed_ratio": _nanmean(_at(curves["speed"], 0.8, 1.4)) / speed_ref[0],
            "press_episodes_per90": len(eps) / open_min * 90 if open_min else math.nan,
            "engaged3_share": _mean([e["n_engaged"] >= 3 for e in eps]),
            "lift_back_to_goal": lift("btg"),
            "lift_own_third": lift("own"),
            **{f"presser_{r.lower()}": _mean([role == r for role, _ in runs]) for r in PRESSER_ROLES},
            "press_peak_speed": float(np.median([s for _, s in runs])) if runs else math.nan,
            "open3_per_pass": _mean([o for _, o in opts]),
            "clear_lane_per_pass": _mean([c for c, _ in opts]),
            "distance_km": _mean([m["distance_km"] for m in ms if math.isfinite(m["distance_km"])]),
        }
    return out


def duels_section(ms: list[dict], t: dict) -> list[str]:
    s = summarize(ms)
    lines = ["## Duels, transitions and pressing (realism v2, P4)", "", "| Measure | Real | Simulated | Band | Status |", "|---|---|---|---|---|"]
    for key, r in t["rows"].items():
        fmt = r.get("fmt", "{:.3f}")
        v = s.get(key, math.nan)
        real = "—" if r.get("real") is None else fmt.format(r["real"])
        band = "—" if r.get("lo") is None else f"{fmt.format(r['lo'])}–{fmt.format(r['hi'])}"
        status = "—" if r.get("lo") is None or not math.isfinite(v) else ("MET" if r["lo"] <= v <= r["hi"] else "NOT MET")
        lines.append(f"| {_cell(r['label'])} | {real} | {fmt.format(v) if math.isfinite(v) else 'n/a'} | {band} | {status} |")
    fouls = sum((m["fouls"] for m in ms), Counter())
    notes = [f"Penalties and players sent off are rare: judge them on ≥ 64 matches (`pnpm realism:deep`); this report has {len(ms)}."]
    if not fouls["shielding"]:
        notes.append("Attacker (shielding) fouls read 0: the engine emits them only under `fouls.rule` 1 (P4 Task 4).")
    if not fouls["take_on"]:
        notes.append("Defender fouls are tackle fouls only: take-on fouls come with `fouls.rule` 1 (P4 Task 4).")
    if not fouls["aerial"]:
        notes.append("Aerial fouls read 0: the engine emits them only under `aerial.rule` 1 (P4 Task 5).")
    return lines + [""] + [f"- {x}" for x in notes] + [""]


def duels_report(run_dirs: list[Path], targets: dict, note: str, roles: dict[str, str]) -> str:
    ms = [match_duels(d, roles) for d in run_dirs]
    return "\n".join(["# Touchline duels diagnostics", "", f"{len(ms)} synthetic matches ({note}).", "", ""] + duels_section(ms, targets["duels"]))

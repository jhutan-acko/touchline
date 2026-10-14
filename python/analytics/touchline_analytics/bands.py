"""Physical output, territory and block height against the ball, from simulated tracking (realism v2, P2).

Definitions follow the 2026-10-13 analysis (physical-report.md, dominance-report.md); only aggregates are committed.

- Per 90 on-pitch minutes, dead ball included, for outfielders on the pitch in every frame of both halves.
- Speed bands on the engine's speed: walk < 7, jog 7-14, run 14-20, high-speed 20-25, sprint 25+ km/h.
- A sprint is above 25 km/h for at least 1 s; an acceleration is above 2.5 m/s^2 for at least 0.5 s, on the
  Savitzky-Golay derivative of speed (about 1 s window, order 2), each half separately.
- Live and dead metres per minute split by the ball's status.
- Territory: per match, the mean ball x over live frames in the home team's attacking direction; the report gives the SD
  over matches.
- Centroid against the ball: in live frames with a team in possession, the mean x of a team's outfielders minus the ball's
  x, in that team's attacking direction, for the team with the ball (in) and the team without it (out).
"""

from __future__ import annotations

import json
import math
from pathlib import Path

import numpy as np
from scipy.signal import savgol_filter

BANDS = [("walk", 0.0, 7.0), ("jog", 7.0, 14.0), ("run", 14.0, 20.0), ("hsr", 20.0, 25.0), ("sprint", 25.0, math.inf)]
ROWS = [
    ("walk_m", "Walking, under 7 km/h (km per 90)", 1e-3, "{:.2f}"),
    ("jog_m", "Jogging, 7–14 km/h (km per 90)", 1e-3, "{:.2f}"),
    ("run_m", "Running, 14–20 km/h (km per 90)", 1e-3, "{:.2f}"),
    ("hsr_m", "High-speed running, 20–25 km/h (km per 90)", 1e-3, "{:.2f}"),
    ("sprint_m", "Sprinting, over 25 km/h (km per 90)", 1e-3, "{:.2f}"),
    ("sprints", "Sprints per 90", 1.0, "{:.1f}"),
    ("accelerations", "Accelerations over 2.5 m/s² per 90", 1.0, "{:.0f}"),
    ("live_m_per_min", "Metres per minute, ball in play", 1.0, "{:.0f}"),
    ("dead_m_per_min", "Metres per minute, ball dead", 1.0, "{:.0f}"),
]


def _episodes(mask: np.ndarray, min_frames: int) -> int:
    edges = np.diff(np.concatenate([[0], mask.astype(np.int8), [0]]))
    starts, ends = np.flatnonzero(edges == 1), np.flatnonzero(edges == -1)
    return int(((ends - starts) >= min_frames).sum())


def _accel(v: np.ndarray, dt: float) -> np.ndarray:
    w = int(round(1.0 / dt)) | 1
    return savgol_filter(v, w, 2, deriv=1, delta=dt) if len(v) >= w + 2 else np.zeros_like(v)


def _attack(side: str, period: str) -> int:
    """+1 if the side attacks +x in that period: home in the first half, away in the second (teams switch ends)."""
    return 1 if (side == "home") == (period == "first_half") else -1


def player_bands(speeds: list[np.ndarray], lives: list[np.ndarray], dt: float) -> dict:
    """One player's bands from his speed and the ball's live flag, one array per half."""
    v = np.concatenate(speeds)
    live = np.concatenate(lives)
    d = v * dt
    kmh = v * 3.6
    per90 = 90.0 / (len(v) * dt / 60.0)
    out = {f"{name}_m": float(d[(kmh >= lo) & (kmh < hi)].sum() * per90) for name, lo, hi in BANDS}
    out["sprints"] = sum(_episodes(s * 3.6 > 25, round(1.0 / dt)) for s in speeds) * per90
    out["accelerations"] = sum(_episodes(_accel(s, dt) > 2.5, round(0.5 / dt)) for s in speeds) * per90
    live_min, dead_min = live.sum() * dt / 60.0, (~live).sum() * dt / 60.0
    out["live_m_per_min"] = float(d[live].sum() / live_min) if live_min > 0 else math.nan
    out["dead_m_per_min"] = float(d[~live].sum() / dead_min) if dead_min > 0 else math.nan
    return out


def match_bands(run: Path, roles: dict[str, str]) -> dict:
    """Bands of every full-match outfielder, the match's territory (mean live ball x, home attacking) and centroids."""
    meta = json.loads((run / "meta.json").read_text())
    dt = 1.0 / float(meta["meta"]["tracking"]["fps"])
    home = meta["teams"]["home"]["id"]
    halves: list[dict] = []
    with (run / "tracking.jsonl").open() as fh:
        for line in fh:
            f = json.loads(line)
            if not halves or halves[-1]["period"] != f["period"]:
                halves.append({"period": f["period"], "n": 0, "v": {}, "live": [], "terr": [], "cin": [], "cout": []})
            h = halves[-1]
            cx: dict[str, float | None] = {}
            for side in ("home", "away"):
                xs = []
                for p in f["teams"][side]["players"]:
                    h["v"].setdefault(p["id"], []).append(p["vel"])
                    if roles.get(p["id"], "GK") != "GK":
                        xs.append(p["x"])
                cx[side] = sum(xs) / len(xs) if xs else None
            b = f["ball"]
            live = bool(b["status"])
            h["live"].append(live)
            h["n"] += 1
            if not live:
                continue
            h["terr"].append(b["x"] * _attack("home", f["period"]))
            pt = b.get("poss_team_id")
            if pt is None:
                continue
            s = "home" if pt == home else "away"
            o = "away" if s == "home" else "home"
            if cx[s] is not None:
                h["cin"].append((cx[s] - b["x"]) * _attack(s, f["period"]))
            if cx[o] is not None:
                h["cout"].append((cx[o] - b["x"]) * _attack(o, f["period"]))
    players = []
    full = set.intersection(*(set(h["v"]) for h in halves)) if halves else set()
    for pid in sorted(full):
        if roles.get(pid, "GK") == "GK" or any(len(h["v"][pid]) != h["n"] for h in halves):
            continue
        players.append(player_bands([np.array(h["v"][pid], float) for h in halves], [np.array(h["live"], bool) for h in halves], dt))

    def mean(xs: list[float]) -> float | None:
        return float(np.mean(xs)) if xs else None

    return {"players": players, "territory_x": mean([x for h in halves for x in h["terr"]]),
            "centroid_in": mean([x for h in halves for x in h["cin"]]), "centroid_out": mean([x for h in halves for x in h["cout"]])}


def bands_section(matches: list[dict], real: dict) -> list[str]:
    """Physical bands, territory and block height against the ball: real (aggregates, targets-idsse.json) against simulated."""
    rows = [p for m in matches for p in m["players"]]
    sim = {k: float(np.nanmean([r[k] for r in rows])) if rows else math.nan for k, *_ in ROWS}
    terr = [m["territory_x"] for m in matches if m["territory_x"] is not None]
    terr_sd = float(np.std(terr, ddof=1)) if len(terr) > 1 else math.nan
    cin = [m["centroid_in"] for m in matches if m["centroid_in"] is not None]
    cout = [m["centroid_out"] for m in matches if m["centroid_out"] is not None]

    def avg(xs: list[float]) -> float:
        return sum(xs) / len(xs) if xs else math.nan

    lines = ["## Physical output and territory", "",
             f"Outfielders on the pitch for the whole match ({len(rows)} player-matches from {len(matches)} matches), per 90 on-pitch "
             "minutes with the ball dead included. Real: IDSSE, 7 matches (2026-10-13 analysis, aggregates). "
             "Judge territory on 64 matches (`pnpm realism:deep`).", "",
             "| Measure | Real | Simulated |", "|---|---|---|"]
    for key, label, scale, fmt in ROWS:
        lines.append(f"| {label} | {fmt.format(real[key] * scale)} | {fmt.format(sim[key] * scale)} |")
    lines.append(f"| High-speed running plus sprinting (km per 90) | {(real['hsr_m'] + real['sprint_m']) / 1000:.2f} | {(sim['hsr_m'] + sim['sprint_m']) / 1000:.2f} |")
    lines.append(f"| Territory: SD over matches of the match-mean ball x, home attacking (m) | {real['territory_sd_m']:.1f} | {terr_sd:.1f} |")
    lines.append(f"| Outfield centroid minus ball x, team with the ball (m) | {real['centroid_in_m']:+.1f} | {avg(cin):+.1f} |")
    lines.append(f"| Outfield centroid minus ball x, team without it (m) | {real['centroid_out_m']:+.1f} | {avg(cout):+.1f} |")
    return lines + [""]

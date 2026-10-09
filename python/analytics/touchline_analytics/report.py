"""Realism report: synthetic Touchline matches against real-match targets.

Usage:
  uv run --project python/analytics python -m touchline_analytics.report out/realism/* \\
      --targets data/params/targets-idsse.json --out docs/realism/realism-report.md
"""

from __future__ import annotations

import datetime as dt
import json
import math
from pathlib import Path

import numpy as np

from .metrics import PASS_LEN_EDGES, SPEED_EDGES, touchline_metrics
from .physics.validate import PLAYER_EDGES, player_metrics, w1, work_rate

LABELS = {
    "passes": ("Passes per match", "{:.0f}"),
    "completion": ("Pass completion", "{:.1%}"),
    "long_share": ("Long passes (32 m+), share of completed", "{:.1%}"),
    "pass_len_median": ("Median completed pass length (m)", "{:.1f}"),
    "shots": ("Shots per match", "{:.1f}"),
    "on_target_share": ("Shots on target, share", "{:.1%}"),
    "blocked_share": ("Shots blocked, share", "{:.1%}"),
    "save_rate": ("Saves, share of shots on target", "{:.1%}"),
    "goals": ("Goals per match", "{:.2f}"),
    "penalties": ("Penalties per match", "{:.2f}"),
    "corners": ("Corners", "{:.1f}"),
    "throw_ins": ("Throw-ins", "{:.1f}"),
    "goal_kicks": ("Goal kicks", "{:.1f}"),
    "free_kicks": ("Free kicks", "{:.1f}"),
    "fouls": ("Fouls", "{:.1f}"),
    "cards": ("Cards", "{:.1f}"),
    "in_play_share": ("Ball in play, share of match time", "{:.1%}"),
    "distance_km_median": ("Distance per full-match outfielder (km)", "{:.2f}"),
    "peak_speed_kmh_median": ("Peak speed per player, median (km/h)", "{:.1f}"),
    "width_poss_m": ("Team width in possession (m)", "{:.1f}"),
    "width_def_m": ("Team width out of possession (m)", "{:.1f}"),
    "length_def_m": ("Defending team length, keeper excluded (m)", "{:.1f}"),
    "line_height_def_m": ("Defensive line height from own goal (m)", "{:.1f}"),
    "ball_pressure_m": ("Nearest defender to the ball (m)", "{:.1f}"),
    "support_15m": ("Teammates within 15 m of the ball", "{:.2f}"),
    "free_space_m": ("Off-ball attacker to nearest defender (m)", "{:.1f}"),
}


def scale_of(t: dict) -> float:
    return max(t["sd"], 0.05 * abs(t["mean"]), 1e-6)


def wasserstein_binned(a: list[float], b: list[float], edges: list[float]) -> float:
    """W1 between two binned distributions: sum over bins of |CDF difference| x bin width."""
    ca = cb = 0.0
    total = 0.0
    for i in range(len(edges) - 1):
        ca += a[i]
        cb += b[i]
        total += abs(ca - cb) * (edges[i + 1] - edges[i])
    return total


def js_divergence(a: list[float], b: list[float]) -> float:
    m = [(x + y) / 2 for x, y in zip(a, b)]
    kl = lambda p, q: sum(pi * math.log(pi / qi, 2) for pi, qi in zip(p, q) if pi > 0 and qi > 0)  # noqa: E731
    return 0.5 * kl(a, m) + 0.5 * kl(b, m)


def status(z: float) -> str:
    return "within 1 SD" if abs(z) <= 1 else "within 2 SD" if abs(z) <= 2 else "off"


def statistics_section(sim_mean: dict, sim_sd: dict, targets: dict) -> tuple[list[str], dict]:
    """The match-statistics table: z against the real between-match SD, and the relative error, which shows
    large misses on statistics whose real spread is wide (a z within 2 SD can still be far from the mean)."""
    lines = [
        "| Statistic | Real (mean ± SD) | Synthetic (mean ± SD) | z | Off by | Verdict |",
        "|---|---|---|---|---|---|",
    ]
    counts = {"within 1 SD": 0, "within 2 SD": 0, "off": 0}
    far = []
    for k, (label, fmt) in LABELS.items():
        t = targets["metrics"].get(k)
        if not t or k not in sim_mean:
            continue
        z = (sim_mean[k] - t["mean"]) / scale_of(t)
        rel = (sim_mean[k] - t["mean"]) / t["mean"] * 100 if t["mean"] else 0.0
        v = status(z)
        counts[v] += 1
        if abs(rel) > 30:
            far.append(f"{label} ({rel:+.0f} %)")
        lines.append(f"| {label} | {fmt.format(t['mean'])} ± {fmt.format(t['sd'])} | {fmt.format(sim_mean[k])} ± {fmt.format(sim_sd[k])} | {z:+.2f} | {rel:+.0f} % | {v} |")
    lines += ["", f"Summary: {counts['within 1 SD']} within 1 SD, {counts['within 2 SD']} within 2 SD, {counts['off']} off. "
              "z uses the real between-match SD, floored at 5 % of the mean (tracking targets come from one match)."]
    lines += ["", f"More than 30 % from the real mean: {', '.join(far)}." if far else "Every statistic is within 30 % of the real mean."]
    return lines, counts


# The engine's roles by position group (packages/sim-core kinematics.ts GROUP_OF).
ENGINE_GROUP = {"GK": "GK", "CB": "DEF", "FB": "DEF", "DM": "MID", "CM": "MID", "AM": "MID", "W": "FWD", "ST": "FWD"}
GROUP_NAMES = {"GK": "keepers", "DEF": "defenders", "MID": "midfielders", "FWD": "forwards"}
PLAYER_LABELS = {
    **{f"speed_{g}": f"Speed, {n} (m/s)" for g, n in GROUP_NAMES.items()},
    **{f"accel_{g}": f"Change of speed, {n} (m/s²)" for g, n in GROUP_NAMES.items()},
    "max_speed": "Top speed per player (m/s)",
    "hsr20": "Metres above 20 km/h per 90 minutes",
    "hsr25": "Metres above 25 km/h per 90 minutes",
    "acc_count": "Accelerations past 3 m/s² per 90 minutes",
    "dec_count": "Decelerations past 3 m/s² per 90 minutes",
}
PERIOD_LABELS = ["0–15", "15–30", "30–45", "45–60", "60–75", "75–90"]


def simulated_tracks(run_dirs: list[Path], roles: dict[str, str]) -> tuple[dict, dict]:
    """Every player's 10 Hz track per simulated match: both halves with a gap between them, and the halves apart."""
    tracks: dict[str, tuple[str, np.ndarray]] = {}
    halves: dict[str, tuple[str, list[np.ndarray]]] = {}
    for run in run_dirs:
        fps = float(json.loads((run / "meta.json").read_text())["meta"]["tracking"]["fps"])
        assert fps == 10, f"{run}: tracking at {fps} Hz, expected 10"
        periods: dict[str, list[dict[str, tuple[float, float]]]] = {}
        with (run / "tracking.jsonl").open() as fh:
            for line in fh:
                f = json.loads(line)
                periods.setdefault(f["period"], []).append({p["id"]: (p["x"], p["y"]) for side in ("home", "away") for p in f["teams"][side]["players"]})
        ids = sorted({pid for frames in periods.values() for fr in frames for pid in fr})
        for pid in ids:
            if pid not in roles:
                continue
            parts = [np.array([fr.get(pid, (np.nan, np.nan)) for fr in frames], dtype=float) for frames in periods.values()]
            group = ENGINE_GROUP[roles[pid]]
            tracks[f"{run.name}/{pid}"] = (group, np.vstack([x for part in parts for x in (part, np.full((1, 2), np.nan))]))
            halves[f"{run.name}/{pid}"] = (group, parts)
    return tracks, halves


def physics_section(tracks: dict, halves: dict, physics: dict) -> list[str]:
    """Player movement statistics against the real inter-match envelope, and the work rate by period (physics.json)."""
    val = physics["validation"]
    sim = player_metrics(tracks)
    lines = ["## Player movement against real tracking", "",
             "Each statistic is a distribution; it is inside when its distance (W1) to the real matches is no larger than "
             "the largest distance between two real matches (data/params/physics.json).", "",
             "| Statistic | W1 to real | Largest real-to-real | Inside |", "|---|---|---|---|"]
    inside = 0
    keys = [k for k in PLAYER_EDGES if k in val["envelope"] and k in val["real"]["players"]]
    for k in keys:
        d = w1(sim[k], val["real"]["players"][k], PLAYER_EDGES[k])
        top = val["envelope"][k]["max"]
        inside += d <= top
        lines.append(f"| {PLAYER_LABELS[k]} | {d:.3f} | {top:.3f} | {'yes' if d <= top else 'no'} |")
    lines += ["", f"Inside the real envelope: {inside} of {len(keys)}.", ""]
    real = val["real"].get("work_rate")
    if real:
        w = work_rate(halves)
        lines += ["### Work rate by 15-minute period", "",
                  "Outfielders on the pitch for the whole match, metres per minute.", "",
                  "| Minutes | Real | Simulated | Real above 20 km/h | Simulated above 20 km/h |", "|---|---|---|---|---|"]
        for i, label in enumerate(PERIOD_LABELS):
            sd = w["distance"]["ALL"][i] if w["distance"]["ALL"] else float("nan")
            sh = w["hsr"]["ALL"][i] if w["hsr"]["ALL"] else float("nan")
            lines.append(f"| {label} | {real['distance']['ALL'][i]:.1f} | {sd:.1f} | {real['hsr']['ALL'][i]:.1f} | {sh:.1f} |")
        lr = real["late_ratio"]
        lines += ["", "Last 15 minutes of a half over its first 15 (late-to-early ratio): distance "
                  f"{w['late_ratio']['distance']:.2f} simulated (real {lr['distance']['min']:.2f}–{lr['distance']['max']:.2f}, mean {lr['distance']['mean']:.2f}); "
                  f"above 20 km/h {w['late_ratio']['hsr']:.2f} simulated (real {lr['hsr']['min']:.2f}–{lr['hsr']['max']:.2f}, mean {lr['hsr']['mean']:.2f}).", ""]
    return lines


def build(run_dirs: list[Path], targets: dict, params_note: str, physics: dict | None = None, roles: dict[str, str] | None = None) -> str:
    runs = [touchline_metrics(d) for d in run_dirs]
    n = len(runs)
    mean = lambda k: sum(r[k] for r in runs) / n  # noqa: E731
    sd = lambda k: math.sqrt(sum((r[k] - mean(k)) ** 2 for r in runs) / (n - 1)) if n > 1 else 0.0  # noqa: E731
    lines = [
        "# Touchline realism report",
        "",
        f"Generated {dt.date.today().isoformat()} from {n} synthetic matches ({params_note}) against real-match targets.",
        "",
        f"**Real data:** {targets['provenance']['dataset']} — {targets['provenance']['scope']}. "
        f"Licence {targets['provenance']['licence']}; {targets['provenance']['attribution']}. Only aggregate statistics are shown.",
        "",
        "## Match statistics",
        "",
    ]
    table, _ = statistics_section({k: mean(k) for k in LABELS}, {k: sd(k) for k in LABELS}, targets)
    lines += table + [""]
    lines += ["## Distributions", "", "| Distribution | Wasserstein-1 | Jensen–Shannon (bits) |", "|---|---|---|"]
    for key, label, edges, unit in (("pass_len", "Completed pass length", PASS_LEN_EDGES, "m"), ("speed", "Player speed", SPEED_EDGES, "m/s")):
        real = targets["distributions"][key]["share"]
        if not real:
            continue
        hk = "pass_len_hist" if key == "pass_len" else "speed_hist"
        syn = [sum(r[hk][i] for r in runs) / n for i in range(len(edges) - 1)]
        lines.append(f"| {label} | {wasserstein_binned(syn, real, edges):.2f} {unit} | {js_divergence(syn, real):.4f} |")
    lines += ["", "Lower is closer. W1 is in the distribution's own unit; JS divergence is 0 for identical and 1 for disjoint distributions.", ""]
    if physics and roles:
        lines += physics_section(*simulated_tracks(run_dirs, roles), physics)
    return "\n".join(lines)


if __name__ == "__main__":
    import argparse

    ap = argparse.ArgumentParser()
    ap.add_argument("runs", nargs="+")
    ap.add_argument("--targets", default="data/params/targets-idsse.json")
    ap.add_argument("--note", default="calibrated parameters")
    ap.add_argument("--out", default="docs/realism/realism-report.md")
    ap.add_argument("--physics", default="", help="data/params/physics.json: adds player movement against real tracking")
    ap.add_argument("--league", default="data/league/league.json", help="player roles, for the physics section")
    a = ap.parse_args()
    physics = json.loads(Path(a.physics).read_text()) if a.physics else None
    roles = {p["id"]: p["role"] for c in json.loads(Path(a.league).read_text())["clubs"] for p in c["squad"]} if physics else None
    md = build([Path(r) for r in a.runs], json.loads(Path(a.targets).read_text()), a.note, physics, roles)
    Path(a.out).parent.mkdir(parents=True, exist_ok=True)
    Path(a.out).write_text(md + "\n")
    print(md)

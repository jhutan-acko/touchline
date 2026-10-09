"""Run the physics fit on IDSSE and write data/params/physics.json (and the engine's copy in touchline-params.json).

Usage:
  uv run --project python/analytics python -m touchline_analytics.physics fit      # or: pnpm physics:fit

Five matches are fitted and two held out. The file holds every constant with its 95 % interval, unit,
sample size and source; the reject counts; the inter-match envelope of every validation statistic; the
real distributions (pooled, aggregates only); and the held-out results (ball statistics of replays and
the replay ratio). Constants outside their physical range stop the fit before anything is written.
"""

from __future__ import annotations

import datetime as dt
import json
import random
import subprocess
from dataclasses import replace
from pathlib import Path

import numpy as np

from ..idsse import MATCHES, PROVENANCE, filenames
from .ballmodel import BallPhysics
from .fit_ball import bounce_kinematics, fit_drag, fit_friction, fit_restitution, fit_rolling
from .fit_players import GROUPS, braking_cap, clean_track, group_of, lateral_cap, player_motion, reaction_delays, sprint_profiles
from .load import kick_events, load_match, player_positions
from .segment import segment_half
from .stats import Constant, bootstrap_ci
from .validate import BALL_EDGES, OUTFIELD, PLAYER_EDGES, ball_metrics, envelope, player_metrics, replay, replay_span, resample_10hz, w1, work_rate

FIT_MATCHES = ["J03WMX", "J03WN1", "J03WOH", "J03WOY", "J03WPY"]
HELD_OUT = ["J03WQQ", "J03WR9"]
MIN_BOUNCES = 100
MAX_E_CI = 0.1  # a restitution known no better than this falls back to the certified value
LITERATURE_E = 0.62
REPLAY_SPANS = 200
REPLAY_MIN_FRAMES = 25
REPLAY_RATIO = 1.5
PERCENTILES = (10, 25, 50, 75, 90)

# Physical ranges: a fitted constant outside its range stops the fit (spec: docs/superpowers/specs/2026-10-09-physics-fit-design.md).
GUARDS: dict[str, tuple[float, float]] = {
    "ball.drag": (0.005, 0.03),
    "ball.restitution": (0.4, 0.85),
    "ball.bounce_friction": (0.1, 1.2),
    "ball.skid_friction": (0.1, 1.2),
    "ball.roll_c0": (0.0, 3.0),
    "ball.roll_c1": (0.0, 1.0),
    "ball.ramp_m": (4.0, 8.0),
    **{f"players.a0.{g}": (5.0, 11.0) for g in GROUPS},
    **{f"players.s0.{g}": (7.5, 11.0) for g in GROUPS if g != "GK"},
    "players.s0.GK": (6.0, 11.0),  # keepers rarely sprint: their fitted top speed is lower
    "players.braking": (4.0, 12.0),
    "players.lateral": (1.0, 10.0),
    "players.reaction": (0.1, 0.6),
}


class GuardError(ValueError):
    pass


def _value(fit: dict, path: str) -> float:
    node = fit
    for part in path.split("."):
        node = node[part]
    if isinstance(node, dict):
        return float(node["p50"] if "p50" in node else node["value"])
    return float(node)


def check_guards(fit: dict) -> None:
    bad = []
    for path, (lo, hi) in GUARDS.items():
        v = _value(fit, path)
        if not (lo <= v <= hi):
            bad.append(f"{path} = {v:.4g} outside {lo:g}..{hi:g}")
    if bad:
        raise GuardError("physics fit out of physical range: " + "; ".join(bad))


def restitution_or_fallback(e: Constant) -> Constant:
    """Too few clean bounces, or too wide an interval, to trust: the certified centre value, marked as from the literature."""
    if e.n < MIN_BOUNCES or not (e.hi - e.lo <= MAX_E_CI):
        return Constant(LITERATURE_E, LITERATURE_E, LITERATURE_E, e.n, "literature")
    return e


def engine_block(fit: dict) -> dict:
    b, p = fit["ball"], fit["players"]
    r = lambda v: round(float(v), 4)  # noqa: E731
    return {
        "ball": {"drag": r(b["drag"]["value"]), "restitution": r(b["restitution"]["value"]), "bounceFriction": r(b["bounce_friction"]["value"]),
                 "skidFriction": r(b["skid_friction"]["value"]), "rollC0": r(b["roll_c0"]["value"]), "rollC1": r(b["roll_c1"]["value"])},
        "players": {
            "a0": {g: [r(p["a0"][g][f"p{q}"]) for q in PERCENTILES] for g in GROUPS},
            "s0": {g: [r(p["s0"][g][f"p{q}"]) for q in PERCENTILES] for g in GROUPS},
            "brake": r(p["braking"]["value"]),
            "lateral": r(p["lateral"]["value"]),
            "reactionS": r(p["reaction"]["value"]),
        },
    }


def sync_params(path: Path, engine: dict) -> None:
    """Replace the `physics` block of the engine's parameter file, keeping everything else as it is."""
    params = json.loads(path.read_text())
    params["physics"] = engine
    path.write_text(json.dumps(params, indent=1) + "\n")


def write(result: dict, out: Path, params: Path) -> None:
    check_guards(result["fit"])
    engine = engine_block(result["fit"])
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps({**result, "engine": engine}, indent=1) + "\n")
    sync_params(params, engine)


def _pct(values: list[float]) -> dict:
    v = np.asarray(values, dtype=float)
    out = {f"p{q}": round(float(np.percentile(v, q)), 4) for q in PERCENTILES} if len(v) else {f"p{q}": float("nan") for q in PERCENTILES}
    return {**out, "n": int(len(v))}


def _player_tracks(halves, positions) -> dict:
    """Player id -> (group, both halves at 10 Hz, a missing frame between them)."""
    tracks = {}
    for pid in sorted({p for h in halves for p in h.players}):
        g = group_of(positions.get(pid, ""))
        if g is None:
            continue
        parts = []
        for h in halves:
            if pid in h.players:
                parts += [resample_10hz(clean_track(h.players[pid])[0]), np.full((1, 2), np.nan)]
        tracks[pid] = (g, np.vstack(parts))
    return tracks


def _player_halves(halves, positions) -> dict:
    """Player id -> (group, [first half, second half] at 10 Hz), for players tracked in both halves."""
    out = {}
    for pid in sorted({p for h in halves for p in h.players}):
        g = group_of(positions.get(pid, ""))
        if g is not None and len(halves) == 2 and all(pid in h.players for h in halves):
            out[pid] = (g, [resample_10hz(clean_track(h.players[pid])[0]) for h in halves])
    return out


def real_work_rate(per_match: dict[str, dict]) -> dict:
    """Work rate averaged over the real matches, with each match's late-to-early ratios and their range."""
    ms = list(per_match.values())
    avg = lambda key, g: [round(float(x), 4) for x in np.mean([m[key][g] for m in ms if m[key].get(g)], axis=0)] if any(m[key].get(g) for m in ms) else []  # noqa: E731
    spread = lambda key: {"mean": round(float(np.mean([m["late_ratio"][key] for m in ms])), 4), "min": round(float(min(m["late_ratio"][key] for m in ms)), 4), "max": round(float(max(m["late_ratio"][key] for m in ms)), 4)}  # noqa: E731
    return {
        "players": {g: sum(m["players"][g] for m in ms) for g in OUTFIELD},
        "distance": {g: avg("distance", g) for g in (*OUTFIELD, "ALL")},
        "hsr": {g: avg("hsr", g) for g in (*OUTFIELD, "ALL")},
        "late_ratio": {"distance": spread("distance"), "hsr": spread("hsr")},
        "per_match": {mid: {k: round(float(m["late_ratio"][k]), 4) for k in ("distance", "hsr")} for mid, m in per_match.items()},
    }


def _mean_hist(hs: list[list[float]]) -> list[float]:
    return [round(float(x), 6) for x in np.mean(np.array(hs), axis=0)]


def _code_version() -> str:
    try:
        return subprocess.run(["git", "rev-parse", "--short", "HEAD"], capture_output=True, text=True, check=True).stdout.strip()
    except (OSError, subprocess.CalledProcessError):
        return "unknown"


def build(root: Path, cache: Path, log=print) -> dict:
    data = {}
    for mid in MATCHES:
        f = filenames(mid)
        halves = load_match(root / f["tracking"], cache / f"{mid}.npz")
        events = kick_events(root / f["event"])
        segs = [segment_half(h, events) for h in halves]
        data[mid] = (halves, segs, player_positions(root / f["meta"]))
        log(f"{mid}: {sum(len(s.spans) for s in segs)} free-ball spans")
    fit_segs = [s for mid in FIT_MATCHES for s in data[mid][1]]
    rejects = {"ball_speed": sum(s.rejects["ball_speed"] for s in fit_segs)}

    drag = fit_drag([p for s in fit_segs for p in s.flights])
    rejects["flight_rmse"] = drag.rejected
    kins = bounce_kinematics(fit_segs, drag.k.value)
    e = restitution_or_fallback(fit_restitution(kins))
    mu = fit_friction(kins, e.value)
    roll = fit_rolling(fit_segs, drag.k.value)
    log(f"ball: k {drag.k.value:.4f}, e {e.value:.3f} ({e.n} bounces), mu {mu.value:.3f}, mu_s {roll.mu_s.value:.3f}, c0 {roll.c0.value:.3f}, c1 {roll.c1.value:.3f}")

    profiles, jumps = sprint_profiles([data[m][0] for m in FIT_MATCHES], [data[m][2] for m in FIT_MATCHES])
    rejects["player_jumps"] = jumps
    tracks = [player_motion(clean_track(xy)[0]) for m in FIT_MATCHES for h in data[m][0] for xy in h.players.values()]
    brake, lateral = braking_cap(tracks), lateral_cap(tracks)
    a0_all = float(np.median([p.a0 for p in profiles]))
    taus = [t for m in FIT_MATCHES for h, s in zip(data[m][0], data[m][1]) for t in reaction_delays(h, s, a0_all)]
    reaction = bootstrap_ci(taus)
    log(f"players: {len(profiles)} profiles, A0 {a0_all:.2f}, brake {brake.value:.2f}, lateral {lateral.value:.2f}, reaction {reaction.value:.3f} s")

    fit = {
        "ball": {
            "drag": drag.k.to_json("1/m", 5),
            "drag_by_speed": {b: c.to_json("1/m", 5) for b, c in drag.by_speed.items()},
            "restitution": e.to_json(""),
            "bounce_friction": mu.to_json(""),
            "skid_friction": roll.mu_s.to_json(""),
            "roll_c0": roll.c0.to_json("m/s^2"),
            "roll_c1": roll.c1.to_json("1/s"),
            "ramp_m": round(roll.ramp_m, 3),
        },
        "players": {
            "a0": {g: _pct([p.a0 for p in profiles if p.group == g]) for g in GROUPS},
            "s0": {g: _pct([p.s0 for p in profiles if p.group == g]) for g in GROUPS},
            "vmax": {g: _pct([p.vmax for p in profiles if p.group == g]) for g in GROUPS},
            "braking": brake.to_json("m/s^2"),
            "lateral": lateral.to_json("m/s^2"),
            "reaction": {**reaction.to_json("s"), "iqr": [round(float(np.percentile(taus, 25)), 4), round(float(np.percentile(taus, 75)), 4)]},
        },
    }
    check_guards(fit)

    # Validation: every statistic on every real match, the envelope, and the held-out replays.
    per_match_players = {mid: player_metrics(_player_tracks(data[mid][0], data[mid][2])) for mid in MATCHES}
    work = real_work_rate({mid: work_rate(_player_halves(data[mid][0], data[mid][2])) for mid in MATCHES})
    spans = {mid: [h.ball[sp.start:sp.end] for h, s in zip(data[mid][0], data[mid][1]) for sp in s.spans] for mid in MATCHES}
    per_match_ball = {mid: ball_metrics(spans[mid]) for mid in MATCHES}
    env = {**envelope(list(per_match_players.values()), PLAYER_EDGES), **envelope(list(per_match_ball.values()), BALL_EDGES)}
    model = replace(BallPhysics(), k=drag.k.value, e=e.value, mu=mu.value, mu_s=roll.mu_s.value, c0=roll.c0.value, c1=roll.c1.value)
    held_real = [p for mid in HELD_OUT for p in spans[mid]]
    real_hist = ball_metrics(held_real)
    sim_hist = ball_metrics([replay(p, model) for p in held_real])
    held_ball = {}
    for k, edges in BALL_EDGES.items():
        if k in env:
            d = w1(sim_hist[k], real_hist[k], edges)
            held_ball[k] = {"w1": round(d, 6), "envelope_max": env[k]["max"], "pass": d <= env[k]["max"]}
    long_spans = [p for p in held_real if len(p) >= REPLAY_MIN_FRAMES]
    random.Random(0).shuffle(long_spans)
    reps = [replay_span(p, model) for p in long_spans[:REPLAY_SPANS]]
    ratios = [r.ratio for r in reps]
    replay_result = {
        "spans": len(reps),
        "median_ratio": round(float(np.median(ratios)), 4),
        "share_within": round(float(np.mean([x <= REPLAY_RATIO for x in ratios])), 4),
        "median_rmse_m": round(float(np.median([r.rmse for r in reps])), 4),
        "median_floor_m": round(float(np.median([r.floor for r in reps])), 4),
        "threshold": REPLAY_RATIO,
        "pass": float(np.median(ratios)) <= REPLAY_RATIO,
    }
    log(f"work rate: late/early distance {work['late_ratio']['distance']['mean']}, above 20 km/h {work['late_ratio']['hsr']['mean']}")
    log(f"held-out: ball statistics {sum(v['pass'] for v in held_ball.values())}/{len(held_ball)} inside the envelope; replay median ratio {replay_result['median_ratio']}")

    return {
        "provenance": {
            **PROVENANCE,
            "fitted_at": dt.date.today().isoformat(),
            "version": f"physics-{dt.date.today().isoformat()}",
            "code_version": _code_version(),
            "fit_matches": FIT_MATCHES,
            "held_out": HELD_OUT,
            "method": "python/analytics/touchline_analytics/physics (spec docs/superpowers/specs/2026-10-09-physics-fit-design.md)",
        },
        "fit": fit,
        "rejects": rejects,
        "validation": {
            "envelope": env,
            "real": {
                "players": {k: _mean_hist([m[k] for m in per_match_players.values()]) for k in PLAYER_EDGES},
                "ball": {k: _mean_hist([m[k] for m in per_match_ball.values()]) for k in BALL_EDGES},
                "work_rate": work,
            },
            "edges": {"players": PLAYER_EDGES, "ball": BALL_EDGES},
            "held_out": {"ball": held_ball, "replay": replay_result},
        },
    }

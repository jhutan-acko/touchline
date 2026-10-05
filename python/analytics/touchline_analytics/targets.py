"""Measure calibration targets on real IDSSE matches and write aggregate statistics with provenance.

Usage:
  uv run --project python/analytics python -m touchline_analytics.idsse            # download into data/raw/idsse
  uv run --project python/analytics python -m touchline_analytics.targets          # write data/params/targets-idsse.json

Only aggregates (means, SDs, normalised histograms) are written; no real event or tracking rows.
"""

from __future__ import annotations

import datetime as dt
import json
import math
from pathlib import Path

from kloppy import sportec

from .idsse import MATCHES, PROVENANCE, filenames
from .metrics import PASS_LEN_EDGES, SPEED_EDGES, event_metrics, tracking_metrics

_SET_PIECE = {"THROW_IN": "throw_in", "CORNER_KICK": "corner", "GOAL_KICK": "goal_kick", "FREE_KICK": "free_kick", "KICK_OFF": "kick_off", "PENALTY": "penalty"}
EVENT_KEYS = ["passes", "completion", "long_share", "pass_len_median", "shots", "on_target_share", "blocked_share", "save_rate", "goals", "penalties", "corners", "throw_ins", "goal_kicks", "free_kicks", "fouls", "cards"]
TRACKING_KEYS = ["in_play_share", "distance_km_median", "peak_speed_kmh_median"]


def idsse_events(root: Path, match_id: str) -> list[dict]:
    f = filenames(match_id)
    ds = sportec.load_event(event_data=str(root / f["event"]), meta_data=str(root / f["meta"]), coordinates="secondspectrum")
    out = []
    for e in ds.events:
        name = e.event_type.name
        if name == "PASS":
            sp = None
            for q in e.qualifiers or []:
                if type(q).__name__ == "SetPieceQualifier":
                    sp = _SET_PIECE.get(q.value.name)
            ok = e.result is not None and e.result.name == "COMPLETE"
            rc = getattr(e, "receiver_coordinates", None)
            length = math.hypot(rc.x - e.coordinates.x, rc.y - e.coordinates.y) if ok and rc and e.coordinates and rc.x is not None and e.coordinates.x is not None else None
            out.append({"type": "pass", "set_piece": sp, "complete": ok, "length": length, "goal": False, "on_target": False})
        elif name == "SHOT":
            r = e.result.name if e.result else ""
            sp = None
            for q in e.qualifiers or []:
                if type(q).__name__ == "SetPieceQualifier":
                    sp = _SET_PIECE.get(q.value.name)
            out.append({"type": "shot", "set_piece": sp, "complete": False, "length": None, "goal": r == "GOAL", "on_target": r in ("GOAL", "SAVED"), "blocked": r == "BLOCKED"})
        elif name == "FOUL_COMMITTED":
            out.append({"type": "foul", "set_piece": None, "complete": False, "length": None, "goal": False, "on_target": False})
        elif name == "CARD":
            out.append({"type": "card", "set_piece": None, "complete": False, "length": None, "goal": False, "on_target": False})
    return out


def idsse_frames(root: Path, match_id: str):
    f = filenames(match_id)
    ds = sportec.load_tracking(raw_data=str(root / f["tracking"]), meta_data=str(root / f["meta"]), coordinates="secondspectrum")
    offset = {1: 0.0, 2: 10_000.0}
    for fr in ds.frames:
        players = {p.player_id: (c.coordinates.x, c.coordinates.y) for p, c in fr.players_data.items() if c.coordinates is not None and c.coordinates.x is not None}
        live = fr.ball_state is not None and fr.ball_state.name == "ALIVE"
        yield ("first_half" if fr.period.id == 1 else "second_half"), offset.get(fr.period.id, 20_000.0) + fr.timestamp.total_seconds(), live, players


def _agg(values: list[float]) -> dict:
    vals = [v for v in values if v == v]
    n = len(vals)
    mean = sum(vals) / n if n else float("nan")
    sd = math.sqrt(sum((v - mean) ** 2 for v in vals) / (n - 1)) if n > 1 else 0.0
    return {"mean": round(mean, 4), "sd": round(sd, 4), "n": n}


def build(root: Path) -> dict:
    per_match = [event_metrics(idsse_events(root, mid)) for mid in MATCHES]
    tracked = [mid for mid in MATCHES if (root / filenames(mid)["tracking"]).exists()]
    per_track = [tracking_metrics(idsse_frames(root, mid)) for mid in tracked]
    metrics = {k: _agg([m[k] for m in per_match]) for k in EVENT_KEYS}
    metrics.update({k: _agg([m[k] for m in per_track]) for k in TRACKING_KEYS})
    avg = lambda rows: [round(sum(col) / len(col), 5) for col in zip(*rows)]  # noqa: E731
    return {
        "provenance": {
            **PROVENANCE,
            "fitted_at": dt.date.today().isoformat(),
            "version": f"targets-{dt.date.today().isoformat()}",
            "scope": f"events: {len(per_match)} matches; tracking: {len(tracked)} match(es) ({', '.join(tracked)})",
        },
        "metrics": metrics,
        "distributions": {
            "pass_len": {"edges": PASS_LEN_EDGES, "share": avg([m["pass_len_hist"] for m in per_match])},
            "speed": {"edges": SPEED_EDGES, "share": avg([m["speed_hist"] for m in per_track]) if per_track else []},
        },
    }


if __name__ == "__main__":
    import argparse

    ap = argparse.ArgumentParser()
    ap.add_argument("--root", default="data/raw/idsse")
    ap.add_argument("--out", default="data/params/targets-idsse.json")
    a = ap.parse_args()
    t = build(Path(a.root))
    Path(a.out).parent.mkdir(parents=True, exist_ok=True)
    Path(a.out).write_text(json.dumps(t, indent=1) + "\n")
    print(json.dumps(t["metrics"], indent=1))

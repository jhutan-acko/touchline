"""Frozen ball carriers: stretches of play where the ball is in play and both it and the player nearest it stand still.

Real football has almost none away from keepers holding the ball (the seven IDSSE matches: 0-1 outfield stretches a
match); the engine used to stand its carriers still for seconds. One definition for real tracking and for the
simulation: packages/calibrate/src/carriers.ts is a line-for-line port, checked by the parity test.

At 10 Hz, a frame (after the first) is still when the ball is in play, it moved less than BALL_STILL m/s since the
last frame, the player nearest it is within NEAR_M, and that player moved less than PLAYER_STILL m/s. A stretch of
at least MIN_S seconds of still frames counts once, for keepers or outfielders by the nearest player at its end.

    uv run --project python/analytics python -m touchline_analytics.carriers  (writes data/params/still-carriers.json)
"""

from __future__ import annotations

import argparse
import json
import math
from pathlib import Path

import numpy as np

HZ = 10
MIN_S = 1.5
BALL_STILL = 0.3
PLAYER_STILL = 0.5
NEAR_M = 1.5


def still_carriers(halves: list[dict]) -> dict:
    """Stretches per kind over the halves; each half is {ball (n, 2), live (n,), players {id: (n, 2)}, keepers set}."""
    out = {k: {"count": 0, "seconds": 0.0, "longest": 0.0} for k in ("GK", "outfield")}

    def close(run: int, who: str | None, keepers: set) -> None:
        if run >= MIN_S * HZ and who is not None:
            k = out["GK" if who in keepers else "outfield"]
            s = run / HZ
            k["count"] += 1
            k["seconds"] += s
            k["longest"] = max(k["longest"], s)

    for h in halves:
        ball, live, players, keepers = h["ball"], h["live"], h["players"], h["keepers"]
        ids = sorted(players)
        run, who = 0, None
        for i in range(len(ball)):
            ok = False
            if i > 0 and live[i]:
                bv = math.hypot(ball[i, 0] - ball[i - 1, 0], ball[i, 1] - ball[i - 1, 1]) * HZ
                best, nd = None, math.inf
                for pid in ids:
                    p = players[pid][i]
                    d = math.hypot(p[0] - ball[i, 0], p[1] - ball[i, 1])
                    if d < nd:
                        best, nd = pid, d
                if best is not None and bv < BALL_STILL and nd < NEAR_M:
                    q, p = players[best][i - 1], players[best][i]
                    ok = math.hypot(p[0] - q[0], p[1] - q[1]) * HZ < PLAYER_STILL
            if ok:
                run, who = run + 1, best
            else:
                close(run, who, keepers)
                run, who = 0, None
        close(run, who, keepers)
    for k in out.values():
        k["seconds"] = round(k["seconds"], 4)
    return out


def _real_halves(root: Path, cache: Path, mid: str) -> list[dict]:
    from .idsse import filenames
    from .physics.load import load_match, player_positions
    from .physics.validate import resample_10hz

    f = filenames(mid)
    keepers = {pid for pid, code in player_positions(root / f["meta"]).items() if code == "TW"}
    out = []
    for h in load_match(root / f["tracking"], cache / f"{mid}.npz"):
        ball = resample_10hz(h.ball[:, :2])
        n = len(ball)
        at = np.arange(n) * 25 / HZ
        i0 = np.floor(at).astype(int)
        i1 = np.minimum(i0 + 1, len(h.live) - 1)
        live = h.live[i0] & np.where(at == i0, True, h.live[i1])
        out.append({"ball": ball, "live": live, "players": {pid: resample_10hz(xy) for pid, xy in h.players.items()}, "keepers": keepers})
    return out


def main() -> None:
    from .idsse import MATCHES, PROVENANCE

    ap = argparse.ArgumentParser(prog="python -m touchline_analytics.carriers", description=__doc__.split("\n\n")[0])
    ap.add_argument("--root", default="data/raw/idsse")
    ap.add_argument("--cache", default="out/physics/cache")
    ap.add_argument("--out", default="data/params/still-carriers.json")
    ap.add_argument("--halves", help="measure these halves instead (JSON, as packages/calibrate writes them) and print the result")
    a = ap.parse_args()
    if a.halves:
        nan = lambda xy: [p if p is not None else [math.nan, math.nan] for p in xy]  # noqa: E731
        halves = [{"ball": np.asarray(h["ball"], float), "live": np.asarray(h["live"], bool), "players": {k: np.asarray(nan(v), float) for k, v in h["players"].items()}, "keepers": set(h["keepers"])} for h in json.loads(Path(a.halves).read_text())]
        print(json.dumps(still_carriers(halves)))
        return
    root, cache = Path(a.root), Path(a.cache)
    cache.mkdir(parents=True, exist_ok=True)
    per_match = {mid: still_carriers(_real_halves(root, cache, mid)) for mid in MATCHES}
    span = lambda kind, key: {"min": min(m[kind][key] for m in per_match.values()), "max": max(m[kind][key] for m in per_match.values()), "mean": round(float(np.mean([m[kind][key] for m in per_match.values()])), 4)}  # noqa: E731
    doc = {
        "provenance": {**PROVENANCE, "definition": "touchline_analytics.carriers", "hz": HZ, "min_s": MIN_S, "ball_still_mps": BALL_STILL, "player_still_mps": PLAYER_STILL, "near_m": NEAR_M},
        "real": {k: {key: span(k, key) for key in ("count", "seconds", "longest")} for k in ("GK", "outfield")},
        "per_match": per_match,
    }
    Path(a.out).write_text(json.dumps(doc, indent=2) + "\n")
    print(json.dumps(doc["real"]))


if __name__ == "__main__":
    main()

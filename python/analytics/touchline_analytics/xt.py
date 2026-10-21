"""Fit the expected-threat (xT) grid on real IDSSE matches (spec §5.2, `act.xt`).

Usage:
  uv run --project python/analytics python -m touchline_analytics.xt      # write data/params/xt-grid.json

Expected threat (Singh, 2019; the method of socceraction's MIT-licensed xthreat module): the pitch is cut into
12 x 8 cells, seen by the team in possession attacking +x. A cell's value is the chance of shooting from it times
the chance a shot from there scores, plus the chance of moving the ball on times the value of where moves from it
end up, solved by iteration. IDSSE has no carries, so moves are passes (a failed pass moves the ball nowhere of
value). Goals are too few (16 non-penalty goals in seven matches) to estimate scoring per cell, so a shot's chance
of scoring is the xG model at the cell centre: since P6's pre-merge fix 3 the simulator's (shotModel.xg in
data/params/touchline-params.json, stats_models.sim_xg_model). The committed grid (xt-1, fitted 2026-10-06) predates
that and was fitted with stats-models-1's goal logistic; a refit moves it to the simulator's xG. Only the grid is written.
"""

from __future__ import annotations

import datetime as dt
import json
from pathlib import Path

from .idsse import MATCHES, PROVENANCE, filenames
from .stats_models import _attack_dirs, predict, shot_features, sim_xg_model

COLS = 12
ROWS = 8
LENGTH = 105.0
WIDTH = 68.0


def cell(x: float, y: float, attack: int) -> int:
    """Cell index (row-major, row 0 at the right touchline as the team attacks +x) of a point, seen by a team attacking `attack`."""
    xn, yn = attack * x, attack * y
    col = min(COLS - 1, max(0, int((xn + LENGTH / 2) / LENGTH * COLS)))
    row = min(ROWS - 1, max(0, int((yn + WIDTH / 2) / WIDTH * ROWS)))
    return row * COLS + col


def cell_centre(i: int) -> tuple[float, float]:
    """Centre of cell i, for a team attacking +x."""
    row, col = divmod(i, COLS)
    return (-LENGTH / 2 + (col + 0.5) * LENGTH / COLS, -WIDTH / 2 + (row + 0.5) * WIDTH / ROWS)


def goal_probs(xg: dict) -> list[float]:
    """Chance that a shot from each cell centre scores, from an xG model on stats_models.XG_FEATURES (a foot shot, no
    defenders in the way)."""
    coefs = [xg["coefficients"][f] for f in xg["features"]]
    return [predict(xg["intercept"], coefs, shot_features(cell_centre(i), 1, False, [])) for i in range(COLS * ROWS)]


def fit_grid(shots: list[int], moves: list[tuple[int, int | None]], goal: list[float], tol: float = 1e-6, max_iter: int = 500) -> list[float]:
    """Solve xT(z) = s(z) g(z) + m(z) sum_z' T(z, z') xT(z') by iteration (z' = None: a failed move)."""
    n = COLS * ROWS
    n_shots = [0] * n
    n_moves = [0] * n
    trans: list[dict[int, int]] = [dict() for _ in range(n)]
    for z in shots:
        n_shots[z] += 1
    for z, end in moves:
        n_moves[z] += 1
        if end is not None:
            trans[z][end] = trans[z].get(end, 0) + 1
    total = [n_shots[z] + n_moves[z] for z in range(n)]
    s = [n_shots[z] / total[z] if total[z] else 0.0 for z in range(n)]
    m = [n_moves[z] / total[z] if total[z] else 0.0 for z in range(n)]
    xt = [0.0] * n
    for _ in range(max_iter):
        new = [s[z] * goal[z] + (m[z] * sum(c / n_moves[z] * xt[e] for e, c in trans[z].items()) if n_moves[z] else 0.0) for z in range(n)]
        diff = max(abs(a - b) for a, b in zip(new, xt))
        xt = new
        if diff < tol:
            break
    return xt


def idsse_actions(root: Path, match_id: str) -> tuple[list[int], list[tuple[int, int | None]]]:
    """Shot cells and pass moves (start cell, end cell or None when the pass failed) of one IDSSE match."""
    from kloppy import sportec

    f = filenames(match_id)
    ev = sportec.load_event(event_data=str(root / f["event"]), meta_data=str(root / f["meta"]), coordinates="secondspectrum")
    tr = sportec.load_tracking(raw_data=str(root / f["tracking"]), meta_data=str(root / f["meta"]), coordinates="secondspectrum", sample_rate=1 / 25)
    first: dict[int, dict[str, list[tuple[float, float]]]] = {}
    for fr in tr.frames:
        if fr.period.id in first:
            continue
        teams: dict[str, list[tuple[float, float]]] = {}
        for pl, c in fr.players_data.items():
            if c.coordinates is not None and c.coordinates.x is not None:
                teams.setdefault(pl.team.team_id, []).append((c.coordinates.x, c.coordinates.y))
        first[fr.period.id] = teams
    attack = _attack_dirs(first)
    shots: list[int] = []
    moves: list[tuple[int, int | None]] = []
    for e in ev.events:
        if e.event_type.name not in ("SHOT", "PASS") or e.team is None or e.coordinates is None or e.coordinates.x is None or e.period.id not in first:
            continue
        a = attack[(e.period.id, e.team.team_id)]
        z = cell(e.coordinates.x, e.coordinates.y, a)
        if e.event_type.name == "SHOT":
            shots.append(z)
        elif e.event_type.name == "PASS":
            ok = e.result is not None and e.result.name == "COMPLETE"
            rc = getattr(e, "receiver_coordinates", None)
            end = cell(rc.x, rc.y, a) if ok and rc is not None and rc.x is not None else None
            moves.append((z, end))
    return shots, moves


def build(root: Path, params: Path) -> dict:
    shots: list[int] = []
    moves: list[tuple[int, int | None]] = []
    for mid in MATCHES:
        s, m = idsse_actions(root, mid)
        print(f"{mid}: {len(s)} shots, {len(m)} passes", flush=True)
        shots += s
        moves += m
    grid = fit_grid(shots, moves, goal_probs(sim_xg_model(json.loads(params.read_text()))))
    return {
        "_provenance": {
            **PROVENANCE,
            "matches": list(MATCHES),
            "fitted_at": dt.date.today().isoformat(),
            "method": "expected threat (Singh 2019) by value iteration over passes and shots; scoring chance from the simulator's xG model at each cell centre",
            "note": "The grid only; no real event rows.",
        },
        "version": "xt-1",
        "cols": COLS,
        "rows": ROWS,
        "orientation": "attacking +x; row 0 at y = -34; cell (row, col) covers x in [-52.5 + col*105/12, ...), y in [-34 + row*68/8, ...)",
        "shots": len(shots),
        "passes": len(moves),
        "values": [round(v, 6) for v in grid],
    }


if __name__ == "__main__":
    result = build(Path("data/raw/idsse"), Path("data/params/touchline-params.json"))
    out = Path("data/params/xt-grid.json")
    out.write_text(json.dumps(result, indent=1) + "\n")
    v = result["values"]
    print(f"wrote {out}: {result['shots']} shots, {result['passes']} passes; xT from {min(v):.4f} to {max(v):.4f}")

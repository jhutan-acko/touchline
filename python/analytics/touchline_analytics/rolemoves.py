"""Role moves (realism v2, P5 A6): off-ball episodes counted from frames, as the 2026-10-13 analysis counts them.

Definitions are ported from off_features.py and off_analysis.py movements(); only aggregates are committed. Frames are read as
duels.py reads them, on its 5 Hz grid (every tick whose frame id is a multiple of round(0.2 * fps)).

- Samples: the ball live, a team in possession and the ball's position known; per side, at least 10 players present, 9 of
  them outfielders. Positions in the side's frame (u along its attack, y turned with it); velocities are central differences
  over +-1 grid step (0.4 s). DM counts as CM (duels.ROLE_GROUP).
- Carrier: the possessing side's player nearest the ball, within 2.5 m. Episodes are off the ball (never the carrier) and in
  possession. Opponents' last line: their second-deepest player's u (the keeper is usually the deepest); own last: the side's
  deepest outfielder's u.
- Side sign (sigma): the sign of the player's mean y in his side's frame over his samples, 0 when under 3 m from the middle
  (the analysis took it from the formation slot). Lateral s = sigma * y, so a larger s is wider on his own side.
- An episode is a run of consecutive grid samples meeting a condition, at least `min` samples long:
  - run_in_behind: ST, W or AM moving forward faster than 4 m/s, min 5, ending within 2 m of the opponents' last line or
    beyond it. Wide share: |ball y| >= 13.84 at the start; beyond share: ending beyond the line.
  - drop_to_receive: ST, W or AM moving back faster than 2.5 m/s, min 5, ending at least 5 m closer to the ball.
  - fb_overlap: a FB outside his same-side W (s > the W's s), level or beyond him (u >= the W's u - 2), moving forward
    faster than 3 m/s, min 2.
  - fb_underlap_inversion: a FB more than 5 m inside his same-side W and more than 15 m ahead of his own last outfielder, min 5.
  - w_comes_inside: a W with s < 8 while the ball is in the attacking third (ball u > 17.5), min 5.
  - cm_drops_into_back_line: a CM with the ball in his own third (ball u < -17.5), no more than 2 m ahead of his most
    advanced CB and within the CBs' y span widened by 5 m on each side, min 5.
"""

from __future__ import annotations

import json
from pathlib import Path

import numpy as np

from .duels import ROLE_GROUP, _grid, _read_tracking

CARRIER_M = 2.5
SIGMA_MIN_M = 3.0
WIDE_LANE_M = 13.84
MOVES = ("fb_overlap", "fb_underlap_inversion", "w_comes_inside", "cm_drops_into_back_line", "run_in_behind", "drop_to_receive")


def _runs(cond: np.ndarray, minlen: int) -> list[tuple[int, int]]:
    """(start, end) grid indices of each run of True at least minlen long."""
    c = np.r_[False, cond, False].astype(int)
    d = np.diff(c)
    s, e = np.where(d == 1)[0], np.where(d == -1)[0] - 1
    return [(a, b) for a, b in zip(s, e) if b - a + 1 >= minlen]


def _same_side(role: np.ndarray, sigma: np.ndarray, val: np.ndarray, want: str) -> np.ndarray:
    """Per row and column: val of the side's `want` player on the column's own side (sigma), NaN with none present."""
    n, P = val.shape
    out = np.full((n, P), np.nan)
    for g in (1, -1):
        cols = np.where((role == want) & (sigma == g))[0]
        if not len(cols):
            continue
        v = np.full(n, np.nan)
        for j in cols:  # the last column present wins, as off_analysis tob_lookup("last")
            v = np.where(np.isfinite(val[:, j]), val[:, j], v)
        out[:, sigma == g] = v[:, None]
    return out


def role_moves(G: dict) -> dict:
    """Episode counts of one match (both sides) from duels._grid's arrays; plus the run shares' raw counts."""
    X, Y, VX, bx, by = G["X"], G["Y"], G["VX"], G["bx"], G["by"]
    n, P = X.shape
    role = np.array([ROLE_GROUP.get(r, r) for r in G["roles"]])
    pres = np.isfinite(X)
    sample = G["live"] & (G["poss"] >= 0) & np.isfinite(bx)
    out = {k: 0 for k in MOVES} | {"run_wide": 0, "run_beyond": 0}
    for s in (0, 1):
        mine, opp = G["side"] == s, G["side"] != s
        outf = mine & ~G["gk"]
        ok = sample & ((pres & mine).sum(1) >= 10) & ((pres & outf).sum(1) >= 9)
        d = G["D"][s][:, None]
        U, Yt, VU = d * X, d * Y, d * VX
        bu, byt = d[:, 0] * bx, d[:, 0] * by
        IN = ok & (G["poss"] == s)
        ou = np.where(opp[None, :] & pres, U, -np.inf)
        opp_last = np.sort(ou, axis=1)[:, -2] if ou.shape[1] >= 2 else np.full(n, np.nan)
        opp_last = np.where(np.isfinite(opp_last), opp_last, np.nan)
        own_last = np.nanmin(np.where(outf[None, :] & pres, U, np.nan), axis=1, initial=np.inf)
        own_last = np.where(np.isfinite(own_last), own_last, np.nan)
        db = np.hypot(U - bu[:, None], Yt - byt[:, None])
        dmine = np.where(mine[None, :] & pres, db, np.inf)
        k = dmine.argmin(1)
        carrier = np.zeros((n, P), bool)
        has = IN & (dmine[np.arange(n), k] <= CARRIER_M)
        carrier[np.where(has)[0], k[has]] = True
        sigma = np.zeros(P, int)
        for j in np.where(mine)[0]:
            yy = Yt[ok & pres[:, j], j]
            if len(yy) and abs(yy.mean()) >= SIGMA_MIN_M:
                sigma[j] = int(np.sign(yy.mean()))
        S = np.where(sigma[None, :] != 0, sigma[None, :] * Yt, Yt)
        wu = _same_side(np.where(mine, role, ""), sigma, U, "W")
        ws = _same_side(np.where(mine, role, ""), sigma, S, "W")
        cbm = (mine & (role == "CB"))[None, :] & pres
        cb_u = np.nanmax(np.where(cbm, U, np.nan), axis=1, initial=-np.inf)
        cb_lo = np.nanmin(np.where(cbm, Yt, np.nan), axis=1, initial=np.inf)
        cb_hi = np.nanmax(np.where(cbm, Yt, np.nan), axis=1, initial=-np.inf)
        cen, half = (cb_hi + cb_lo) / 2, (cb_hi - cb_lo) / 2
        with np.errstate(invalid="ignore"):
            for j in np.where(mine)[0]:
                r = role[j]
                base = IN & pres[:, j] & ~carrier[:, j]
                u, vu, sj = U[:, j], VU[:, j], S[:, j]
                if r in ("ST", "W", "AM"):
                    for a, b in _runs(base & (vu > 4), 5):
                        if u[b] >= opp_last[b] - 2:
                            out["run_in_behind"] += 1
                            out["run_wide"] += bool(abs(byt[a]) >= WIDE_LANE_M)
                            out["run_beyond"] += bool(u[b] > opp_last[b])
                    out["drop_to_receive"] += sum(db[a, j] - db[b, j] >= 5 for a, b in _runs(base & (vu < -2.5), 5))
                if r == "FB" and sigma[j] != 0:
                    out["fb_overlap"] += len(_runs(base & (sj > ws[:, j]) & (u >= wu[:, j] - 2) & (vu > 3), 2))
                    out["fb_underlap_inversion"] += len(_runs(base & (sj < ws[:, j] - 5) & (u > own_last + 15), 5))
                if r == "W" and sigma[j] != 0:
                    out["w_comes_inside"] += len(_runs(base & (bu > 17.5) & (sj < 8), 5))
                if r == "CM":
                    near = (u <= cb_u + 2) & (np.abs(Yt[:, j] - cen) < half + 5)
                    out["cm_drops_into_back_line"] += len(_runs(base & (bu < -17.5) & near, 5))
    return out


def match_rolemoves(run: Path, roles: dict[str, str]) -> dict:
    """Role-move episode counts of one simulated match (both sides together)."""
    meta = json.loads((run / "meta.json").read_text())
    fps = float(meta["meta"]["tracking"]["fps"])
    T = _read_tracking(run, meta["teams"]["home"]["id"])
    return role_moves(_grid(T, fps, roles))

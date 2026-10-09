"""The engine's ball physics, as the reference the fit and the free-ball replay integrate.

packages/sim-core/src/ball.ts is a line-for-line port; a parity test runs both on the same launches.
State is (x, y, z, vx, vy, vz, w): position and velocity in metres and m/s, and a scalar spin w (rad/s,
topspin positive) that matters at a bounce and on the ground. z is the height of the ball's bottom.

- In the air: gravity and quadratic drag (a = -k |v| v), explicit Euler per substep.
- Bounce (Brody / Cross rigid-body model for a hollow ball, I = 2/3 m R^2): the normal speed becomes
  e * vn (and 0 below `rest_vz`). The contact point slips at vt - R w; friction mu either stops the slip
  during the impact (the ball leaves rolling at 0.6 vt + 0.4 R w) or acts throughout (the ball loses
  mu (1 + e) vn of horizontal speed and gains 1.5 mu (1 + e) vn / R of spin).
- On the ground: rolling resistance c0 + c1 v plus air drag k v^2. While the ball skids (its contact point
  slips, v != R w, as after a kick or a sliding bounce) friction adds mu_s g of deceleration and spins the
  ball up at 1.5 mu_s g / R until it rolls. A ground pass leaves the foot without spin, so it skids first.

Only multiply, add, divide and square roots: the engine must replay bit-identically in every JavaScript
engine, and Math.exp / Math.pow are not required to be.
"""

from __future__ import annotations

import json
import math
import sys
from dataclasses import dataclass, replace

import numpy as np

SUBSTEP = 0.025  # the engine's 0.1 s tick in 4 substeps
SIMPSON_N = 16  # intervals for the rolling-distance integral
SKID_N = 64  # speed steps for the skid phase of a ground pass
SLIP_EPS = 1e-9


@dataclass(frozen=True)
class BallPhysics:
    k: float = 0.013  # quadratic drag per metre (C_D ~ 0.24)
    e: float = 0.62  # normal restitution
    mu: float = 0.6  # effective ball-grass friction at a bounce
    mu_s: float = 0.3  # ball-grass friction while a ball skids on the ground
    c0: float = 0.5  # rolling deceleration, m/s^2
    c1: float = 0.15  # rolling deceleration per m/s, 1/s
    radius: float = 0.11
    rest_vz: float = 0.4  # bounces slower than this stop
    gravity: float = 9.81


LITERATURE = BallPhysics()


def bounce(vt: float, vn: float, w: float, p: BallPhysics) -> tuple[float, float, float]:
    """Horizontal speed, vertical speed and spin after landing with horizontal speed vt and downward speed vn."""
    vz = p.e * vn
    if vz < p.rest_vz:
        vz = 0.0
    slip = vt - p.radius * w
    impulse = p.mu * (1 + p.e) * vn
    if 2.5 * impulse >= abs(slip):
        vt2 = 0.6 * vt + 0.4 * p.radius * w
        return vt2, vz, vt2 / p.radius
    sign = 1.0 if slip > 0 else -1.0
    return vt - sign * impulse, vz, w + sign * 1.5 * impulse / p.radius


def step(s: tuple, h: float, p: BallPhysics) -> tuple:
    """One substep of length h."""
    x, y, z, vx, vy, vz, w = s
    if z > 1e-6 or vz > 1e-6:
        speed = math.sqrt(vx * vx + vy * vy + vz * vz)
        kk = p.k * speed * h
        vx -= kk * vx
        vy -= kk * vy
        vz -= kk * vz + p.gravity * h
        x += vx * h
        y += vy * h
        z += vz * h
        if z <= 0:
            z = 0.0
            vt = math.sqrt(vx * vx + vy * vy)
            vt2, vz, w = bounce(vt, -vz, w, p)
            if vt > 0:
                f = vt2 / vt
                vx *= f
                vy *= f
        return (x, y, z, vx, vy, vz, w)
    speed = math.sqrt(vx * vx + vy * vy)
    if speed > 0:
        dec = p.c0 + p.c1 * speed + p.k * speed * speed
        slip = speed - p.radius * w
        spin = 1.5 * p.mu_s * p.gravity / p.radius * h
        if slip > SLIP_EPS:
            dec += p.mu_s * p.gravity
            w += spin
        elif slip < -SLIP_EPS:
            dec -= p.mu_s * p.gravity
            w -= spin
        nxt = max(0.0, speed - dec * h)
        if abs(slip) <= SLIP_EPS or (slip > 0) != (nxt - p.radius * w > 0):
            w = nxt / p.radius  # the slip ran out within the substep: the ball rolls on
        f = nxt / speed
        vx *= f
        vy *= f
        x += vx * h
        y += vy * h
    return (x, y, 0.0, vx, vy, 0.0, w)


def simulate(s: tuple, duration: float, p: BallPhysics, h: float = SUBSTEP) -> np.ndarray:
    """Rows (t, x, y, z, vx, vy, vz, w) from the start state, every substep, for `duration` seconds."""
    n = int(round(duration / h))
    out = np.empty((n + 1, 8))
    s = tuple(float(v) for v in s)
    out[0] = (0.0, *s)
    for i in range(1, n + 1):
        s = step(s, h, p)
        out[i] = (i * h, *s)
    return out


def _roll_decel(v: float, p: BallPhysics) -> float:
    return p.c0 + p.c1 * v + p.k * v * v


def roll_distance(v0: float, v_end: float, p: BallPhysics) -> float:
    """Distance a rolling (not skidding) ball covers while slowing from v0 to v_end: the integral of v / dec(v) (Simpson)."""
    if v0 <= v_end:
        return 0.0
    hh = (v0 - v_end) / SIMPSON_N
    total = 0.0
    for i in range(SIMPSON_N + 1):
        v = v_end + i * hh
        wgt = 1 if i in (0, SIMPSON_N) else (4 if i % 2 else 2)
        total += wgt * v / _roll_decel(v, p)
    return total * hh / 3


def ground_distance(v0: float, v_end: float, p: BallPhysics) -> float:
    """Distance a ground pass struck at v0 without spin covers before slowing to v_end: skid, then roll.

    The skid is marched in SKID_N equal speed steps: time t(v) accumulates dv / (mu_s g + dec(v)), and the
    skid ends where the spin has caught up, v = 1.5 mu_s g t.
    """
    if v0 <= v_end:
        return 0.0
    fric = p.mu_s * p.gravity
    dv = v0 / SKID_N
    t = 0.0
    d = 0.0
    v = v0
    a = fric + _roll_decel(v, p)
    for _ in range(SKID_N):
        v2 = v - dv
        a2 = fric + _roll_decel(v2, p)
        dt = 0.5 * dv * (1 / a + 1 / a2)
        g1 = v - 1.5 * fric * t  # slip before and after the step
        g2 = v2 - 1.5 * fric * (t + dt)
        stop = v_end if v_end > v2 else v2
        if g2 <= 0 or stop > v2:
            # The skid ends (slip reaches 0) or the target speed comes within this step: take the earlier.
            f_slip = g1 / (g1 - g2) if g2 <= 0 else 1.0
            f_stop = (v - stop) / dv
            f = min(f_slip, f_stop)
            vf = v - f * dv
            d += 0.5 * f * dv * (v / a + vf / (fric + _roll_decel(vf, p)))
            return d if f_stop <= f_slip else d + roll_distance(vf, v_end, p)
        d += 0.5 * dv * (v / a + v2 / a2)
        t += dt
        v, a = v2, a2
    return d


def ground_launch_speed(distance: float, arrive: float, p: BallPhysics) -> float:
    """Launch speed of a ground pass (struck without spin) that arrives at `arrive` m/s after `distance` metres (fixed secant steps)."""
    if distance <= 0:
        return arrive
    lo = math.sqrt(arrive * arrive + 2 * _roll_decel(arrive, p) * distance)
    hi = math.sqrt(arrive * arrive + 2 * (p.mu_s * p.gravity + _roll_decel(arrive, p)) * distance) + 0.5
    f_lo = ground_distance(lo, arrive, p) - distance
    f_hi = ground_distance(hi, arrive, p) - distance
    for _ in range(8):
        if f_hi == f_lo:
            break
        mid = hi - f_hi * (hi - lo) / (f_hi - f_lo)
        lo, f_lo = hi, f_hi
        hi, f_hi = mid, ground_distance(mid, arrive, p) - distance
    return hi


def _main() -> None:
    """Read [{state, duration, physics}] as JSON on stdin; print each trajectory's rows (parity test)."""
    cases = json.load(sys.stdin)
    out = []
    for c in cases:
        p = replace(LITERATURE, **c.get("physics", {}))
        out.append(simulate(tuple(c["state"]), c["duration"], p).tolist())
    json.dump(out, sys.stdout)


__all__ = ["BallPhysics", "LITERATURE", "SUBSTEP", "bounce", "ground_distance", "ground_launch_speed", "roll_distance", "simulate", "step"]

if __name__ == "__main__":
    _main()

"""Shared statistics for the physics fit: fitted constants with bootstrap intervals."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Callable, Sequence

import numpy as np

BOOT_N = 1000
BOOT_SEED = 0


@dataclass(frozen=True)
class Constant:
    value: float
    lo: float  # 95 % interval
    hi: float
    n: int  # segments, bounces or players behind the value
    source: str = "idsse"

    def to_json(self, unit: str, digits: int = 4) -> dict:
        r = lambda v: None if v != v else round(float(v), digits)  # noqa: E731
        return {"value": r(self.value), "ci95": [r(self.lo), r(self.hi)], "unit": unit, "n": self.n, "source": self.source}


NAN = Constant(float("nan"), float("nan"), float("nan"), 0)


def bootstrap_ci(values: Sequence[float], stat: Callable[[np.ndarray], float] = np.median, n_boot: int = BOOT_N, seed: int = BOOT_SEED) -> Constant:
    """`stat` of the values with a percentile bootstrap interval (seeded, so the fit is reproducible)."""
    x = np.asarray([v for v in values if np.isfinite(v)], dtype=float)
    if len(x) == 0:
        return NAN
    rng = np.random.default_rng(seed)
    boots = np.array([stat(x[rng.integers(0, len(x), len(x))]) for _ in range(n_boot)])
    return Constant(float(stat(x)), float(np.percentile(boots, 2.5)), float(np.percentile(boots, 97.5)), len(x))


def bootstrap_fit(items: Sequence, fit: Callable[[Sequence], tuple[float, ...]], n_boot: int = 200, seed: int = BOOT_SEED) -> list[Constant]:
    """Refit a multi-value `fit` on resampled items; one Constant per value (value from the full data)."""
    if len(items) == 0:
        return []
    full = fit(items)
    rng = np.random.default_rng(seed)
    boots = np.array([fit([items[i] for i in rng.integers(0, len(items), len(items))]) for _ in range(n_boot)])
    return [Constant(float(v), float(np.nanpercentile(boots[:, j], 2.5)), float(np.nanpercentile(boots[:, j], 97.5)), len(items)) for j, v in enumerate(full)]

import math

from touchline_analytics.report import js_divergence, wasserstein_binned


def test_distribution_distances():
    edges = [0, 1, 2]
    assert wasserstein_binned([1, 0], [1, 0], edges) == 0
    assert wasserstein_binned([1, 0], [0, 1], edges) == 1
    assert js_divergence([0.5, 0.5], [0.5, 0.5]) == 0
    assert math.isclose(js_divergence([1, 0], [0, 1]), 1.0)

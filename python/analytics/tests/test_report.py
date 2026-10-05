import math

from touchline_analytics.report import js_divergence, wasserstein_binned


def test_distribution_distances():
    edges = [0, 1, 2]
    assert wasserstein_binned([1, 0], [1, 0], edges) == 0
    assert wasserstein_binned([1, 0], [0, 1], edges) == 1
    assert js_divergence([0.5, 0.5], [0.5, 0.5]) == 0
    assert math.isclose(js_divergence([1, 0], [0, 1]), 1.0)


def test_statistics_table_shows_relative_error_and_lists_large_misses():
    from touchline_analytics.report import statistics_section

    targets = {"metrics": {"corners": {"mean": 8.0, "sd": 3.0, "n": 7}, "goals": {"mean": 2.7, "sd": 1.5, "n": 7}}}
    lines, counts = statistics_section({"corners": 2.0, "goals": 2.8}, {"corners": 1.0, "goals": 1.2}, targets)
    text = "\n".join(lines)
    assert "| Corners | 8.0 ± 3.0 | 2.0 ± 1.0 | -2.00 | -75 % | within 2 SD |" in text
    assert "+4 %" in text
    assert "More than 30 % from the real mean: Corners (-75 %)." in text
    assert counts == {"within 1 SD": 1, "within 2 SD": 1, "off": 0}

import pytest

from touchline_agents.numbers import format_metric, matches, numbers_in, read


@pytest.mark.parametrize(("metric", "value", "lang", "text"), [
    ("team.press", 0.2653, "en", "27%"),
    ("shot.xg", 0.2431, "en", "0.24"),
    ("shot.xg", 0.2431, "es", "0,24"),
    ("plyr.vmax", 30.84, "hi", "30.8"),
    ("plyr.dist", 10001.4, "en", "10,001"),
    ("plyr.dist", 10001.4, "es", "10.001"),
    ("ppda", 7.25, "en", "7.2"),
])
def test_formats_by_unit_and_language(metric, value, lang, text):
    assert format_metric(metric, value, lang) == text
    assert matches(text, value * (1 if not text.endswith("%") else 1), lang)


def test_reads_tokens_back():
    assert read("10,001") == (10001.0, 0, False)
    assert read("0,24", "es") == (0.24, 2, False)
    assert read("10.001", "es") == (10001.0, 0, False)
    assert read("67th") == (67.0, 0, False)
    assert read("27 %", "es") == (27.0, 0, True)


def test_finds_numbers_and_scores():
    assert numbers_in("Ironmoor lead 2-1 after 67 minutes, with 27% of the ball.") == ["2-1", "67", "27%"]
    assert numbers_in("No numbers here, p-iro-09 is an id") == []
    assert numbers_in("Ganan 2–0 con un 0,24 de xG") == ["2–0", "0,24"]
    assert numbers_in("The score is now 1-0.") == ["1-0"]


def test_rounding_must_be_faithful():
    assert matches("0.27", 0.2653) and not matches("0.30", 0.2653)
    assert matches("27%", 0.2653) and not matches("30%", 0.2653)
    assert not matches("27% and 30%", 0.2653)

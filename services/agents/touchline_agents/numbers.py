"""How numbers are written in cue text, and how the Fact-Checker reads them back.

A claim's `quote` is a number exactly as written. Shares are written as percentages ("27%"), xG and xPass with two
decimals ("0.24"), speeds with one ("30.8"), distances as whole metres ("10,001"). Spanish swaps the separators
("0,24", "10.001"); Hindi text uses the English style with Western digits.
"""

import re

# Units from the stats catalog (list_metrics) for the metric ids.
UNITS: dict[str, str] = {
    "pass.dist": "m", "pass.acc": "share", "pass.xp": "probability", "ball.speed": "km/h", "shot.speed": "km/h",
    "plyr.vmax": "km/h", "plyr.dist": "m", "shot.xg": "xG", "team.mom": "share", "team.press": "share",
    "ppda": "passes per action", "tilt": "share", "game.chaos": "index", "team.poss": "share", "act.xt": "xT",
    "pitch.ctrl": "share",
}
PERCENT_UNITS = {"share", "probability"}
DECIMALS: dict[str, int] = {"m": 0, "km/h": 1, "xG": 2, "xT": 2, "index": 2, "passes per action": 1}

# A number as written: digits with separators, an optional percent sign or ordinal suffix; not part of an id such
# as "p-iro-09". Scores are matched separately.
NUMBER = re.compile(r"(?<![\w.,-])\d+(?:[.,]\d+)*(?:\s?%|st|nd|rd|th|º|ª|'|′)?")
SCORE = re.compile(r"(?<![\w.,-])(\d+)\s?[-–]\s?(\d+)(?![\w.,])")


def _group(digits: str, sep: str) -> str:
    out = []
    while len(digits) > 3:
        out.insert(0, digits[-3:])
        digits = digits[:-3]
    return sep.join([digits, *out])


def write(value: float, decimals: int, lang: str) -> str:
    """`value` with `decimals` decimals, grouped, in the language's style."""
    text = f"{abs(value):.{decimals}f}"
    whole, _, frac = text.partition(".")
    thousands, point = (".", ",") if lang == "es" else (",", ".")
    out = _group(whole, thousands) + (point + frac if frac else "")
    return ("-" if value < 0 else "") + out


def format_metric(metric_id: str, value: float, lang: str = "en") -> str:
    """How a metric's value is quoted in text: shares as whole percentages, others by unit."""
    unit = UNITS[metric_id]
    if unit in PERCENT_UNITS:
        return f"{write(value * 100, 0, lang)}%"
    return write(value, DECIMALS.get(unit, 2), lang)


def read(token: str, lang: str = "en") -> tuple[float, int, bool]:
    """(value, decimals shown, is a percentage) for a number token as NUMBER matches it."""
    t = token.strip()
    pct = t.endswith("%")
    t = re.sub(r"\s?%$|st$|nd$|rd$|th$|º$|ª$|'$|′$", "", t)
    thousands, point = (".", ",") if lang == "es" else (",", ".")
    # A lone separator followed by exactly three digits is a thousands separator ("10,001"), otherwise a decimal point.
    if point not in t and t.count(thousands) == 1 and len(t.split(thousands)[1]) != 3:
        thousands, point = point, thousands
    whole, _, frac = t.replace(thousands, "").partition(point)
    return float(f"{whole}.{frac}" if frac else whole), len(frac), pct


def numbers_in(text: str) -> list[str]:
    """Every number token in a sentence, scores (e.g. "2-1") first as single tokens."""
    scores = [m.group(0) for m in SCORE.finditer(text)]
    rest = SCORE.sub(" ", text)
    return scores + [m.group(0) for m in NUMBER.finditer(rest)]


def matches(quote: str, value: float, lang: str = "en") -> bool:
    """Whether `quote` is a faithful rounding of `value`: within half a unit of the last decimal shown (percentages
    against value x 100)."""
    tokens = NUMBER.findall(quote)
    if len(tokens) != 1:
        return False
    shown, decimals, pct = read(tokens[0], lang)
    target = value * 100 if pct else value
    return abs(shown - target) <= 0.5 * 10 ** (-decimals) + 1e-9

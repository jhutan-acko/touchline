"""What counts as matching a truth, and the keyword rubric for causes (the LLM judge's fallback)."""

import re

# For each injected effect: the moment types that report it, and whether they belong to the truth's team ("same")
# or its opponent ("other").
REPORTED_BY: dict[str, list[tuple[str, str]]] = {
    "goal": [("goal", "same")],
    "red_card": [("card", "same")],
    "press_surge": [("pressure_shift", "same")],
    "momentum_swing": [("momentum_swing", "same")],
    "keeper_heroics": [("big_chance", "other")],
    "keeper_howler": [("goal", "other"), ("costly_error", "same")],
    # An error that led to nothing raises no signal and is not a moment; an opponent goal is not evidence of it.
    "defensive_error": [("costly_error", "same")],
}
CAUSE_WORDS: dict[str, list[str]] = {
    "goal": ["finish", "chance", "shot", "scor", "goal", "error", "mis"],
    "red_card": ["red", "sent off", "dismiss"],
    "press_surge": ["press"],
    "momentum_swing": ["momentum", "control", "territor", "pressure"],
    "keeper_heroics": ["save", "keeper", "goalkeeper", "stop"],
    "keeper_howler": ["keeper", "goalkeeper", "error", "mistake", "fumble", "spill"],
    "defensive_error": ["error", "mis-hit", "mishit", "mistake", "heavy touch", "miscontrol", "gave the ball away", "lost the ball"],
}
MISTAKE_WORDS: dict[str, list[str]] = {
    "mishit": ["mis-hit", "mishit", "miscue", "shank", "slice"],
    "heavy_touch": ["heavy touch", "heavy first touch", "loose touch", "heavy"],
    "miscontrol": ["miscontrol", "poor touch", "control"],
    "missed_touch": ["missed", "let the ball"],
}
PRESSURE = re.compile(r"\bunder (?:heavy |immediate |intense )?pressure\b|\bpressed\b|\bclosed down\b", re.I)


def keyword_judge(truth: dict, cause: str, explanation: str) -> bool:
    """Whether the stated cause names the truth: the effect's words, or for an error its kind and whether it came
    under pressure (a mis-hit under pressure is not the same cause as a mis-hit from poor technique)."""
    text = f"{cause} {explanation}".lower()
    if truth["kind"] == "critical_error":
        kind_ok = any(w in text for w in MISTAKE_WORDS[truth["mistake_kind"]])
        pressured = bool(PRESSURE.search(text))
        return kind_ok and (pressured if truth["mistake_cause"] == "pressure" else not pressured)
    return any(w in text for w in CAUSE_WORDS[truth["effect"]])

"""The scores of spec §5.3.1, one callable each. Each takes a run's row as keyword columns and returns a dict, the
shape azure-ai-evaluation's `evaluate()` accepts for custom evaluators, so the same objects can log to Foundry."""

from touchline_agents.numbers import numbers_in

from .rubric import REPORTED_BY, keyword_judge

GRACE_S = 120  # a moment may come up to 2 minutes after the truth's window (spec §5.3.1)
BAND = 0.5  # a moment whose signal is this salient is significant on its own (the detector's promote threshold)


def truths_of(script: list[dict], critical_errors: list[dict], mistakes: dict, **_) -> list[dict]:
    """Every truth to be found: the achieved script entries and the errors that led to a shot or goal."""
    out = [{"kind": "script", **t} for t in script]
    for c in critical_errors:
        m = mistakes.get(c["mistake_id"], {})
        out.append({
            "kind": "critical_error", "effect": "defensive_error", "team_id": c["team_id"], "frames": [m.get("frame_id", c["frame_id"]), c["frame_id"]],
            "mistake_id": c["mistake_id"], "shot_id": c["shot_id"], "mistake_kind": m.get("kind", "mishit"), "mistake_cause": m.get("cause", "technique"),
            "expected_metrics": [],
        })
    return out


def rank(truth: dict, trace: dict, fps: float, home: str, away: str) -> int | None:
    """How well a published moment reports a truth: the index of the first way of reporting it that the moment
    matches (0 is best), or None when it does not report it (wrong type, team or time)."""
    m = trace["moment"]
    lo, hi = truth["frames"][0], truth["frames"][1] + GRACE_S * fps
    if not lo <= m["frame_id"] <= hi:
        return None
    if truth["kind"] == "critical_error":
        return 0 if m["type"] == "costly_error" and m["team_id"] == truth["team_id"] else None
    other = away if truth["team_id"] == home else home
    for i, (t, who) in enumerate(REPORTED_BY[truth["effect"]]):
        if m["type"] == t and m["team_id"] == (truth["team_id"] if who == "same" else other):
            return i
    return None


def matches(truth: dict, trace: dict, fps: float, home: str, away: str) -> bool:
    return rank(truth, trace, fps, home, away) is not None


def _found(row: dict) -> list[tuple[dict, dict | None]]:
    """Each truth with the published moment that reports it best, the earliest of those (or None)."""
    out = []
    for t in truths_of(**row):
        ranked = [(r, tr["moment"]["frame_id"], i) for i, tr in enumerate(row["traces"]) if (r := rank(t, tr, row["fps"], row["home"], row["away"])) is not None]
        out.append((t, row["traces"][min(ranked)[2]] if ranked else None))
    return out


def _share(hits: list[bool]) -> float | None:
    return round(sum(hits) / len(hits), 4) if hits else None


class MomentRecall:
    def __call__(self, **row) -> dict:
        hits = [tr is not None for _, tr in _found(row)]
        return {"moment_recall": _share(hits), "moment_recall_n": len(hits)}


class MomentPrecision:
    def __call__(self, **row) -> dict:
        truths = truths_of(**row)
        hits = [
            any(matches(t, tr, row["fps"], row["home"], row["away"]) for t in truths) or tr["moment"]["salience"] >= BAND or tr["moment"]["priority"] == 1
            for tr in row["traces"]
        ]
        return {"moment_precision": _share(hits), "moment_precision_n": len(hits)}


class ExplanationAccuracy:
    """Whether the Analyst names the truth's cause. `judgments` (truth key -> bool) come from the LLM judge when it
    ran; otherwise the keyword rubric decides."""

    def __call__(self, *, judgments: dict | None = None, **row) -> dict:
        hits = []
        for t, tr in _found(row):
            if tr is None:
                continue
            key = truth_key(t)
            a = tr["analysis"]
            hits.append(judgments[key] if judgments and key in judgments else keyword_judge(t, a["cause"], a["explanation"]))
        return {"explanation_accuracy": _share(hits), "explanation_accuracy_n": len(hits)}


def truth_key(t: dict) -> str:
    return t["mistake_id"] if t["kind"] == "critical_error" else f"{t['effect']}:{t['team_id']}:{t['frames'][0]}"


class EvidenceCorrectness:
    """Cited metric ids overlap the truth's expected metrics, at frames inside its window (for an error: the error's
    own event is cited)."""

    def __call__(self, **row) -> dict:
        hits = []
        for t, tr in _found(row):
            if tr is None:
                continue
            claims = tr["analysis"]["claims"] + tr["draft"]["claims"]
            if t["kind"] == "critical_error":
                hits.append(any(c["event_id"] == t["mistake_id"] for c in claims))
                continue
            lo, hi = t["frames"][0], t["frames"][1] + GRACE_S * row["fps"]
            hits.append(any(c["metric_id"] in t["expected_metrics"] and lo <= c["at_frame"] <= hi for c in claims))
        return {"evidence_correctness": _share(hits), "evidence_correctness_n": len(hits)}


class Grounding:
    """Numeric claims verified by the Fact-Checker on the first draft, and in what was published (target 100 %)."""

    def __call__(self, **row) -> dict:
        first = [tr["verdicts"][0] for tr in row["traces"] if tr["verdicts"]]
        checked = sum(v["claims_checked"] for v in first)
        verified = sum(v["claims_verified"] for v in first)
        published = [c["verified"] for c in row["cues"]]
        return {
            "grounding_first_draft": round(verified / checked, 4) if checked else None,
            "grounding_published": _share(published),
            "drafts_passing_first_time": _share([v["status"] == "pass" for v in first]),
            "grounding_n": checked,
        }


class DecisionFeedback:
    """A better option named must be the decision record's first-ranked pass (and only when the pass played was not
    it); for an error whose pass was already the best option, the agents must stay silent."""

    def __call__(self, **row) -> dict:
        hits = []
        for tr in row["traces"]:
            for c in tr["analysis"]["claims"] + tr["draft"]["claims"]:
                if c["kind"] == "better_option":
                    d = row["decisions"].get(c["event_id"])
                    hits.append(bool(d) and d["chosen_rank"] not in (None, 1) and d["best_receiver_id"] == c["receiver_id"])
        for t, tr in _found(row):
            d = row["decisions"].get(t.get("mistake_id", ""))
            if tr is not None and d and d["chosen_rank"] == 1:
                hits.append(not any(c["kind"] == "better_option" for c in tr["analysis"]["claims"] + tr["draft"]["claims"]))
        return {"decision_feedback": _share(hits), "decision_feedback_n": len(hits)}


class PersonaSeparation:
    """Casual and analyst variants of a moment in one language differ in depth: casual has at most one number, and
    analyst has more numbers or more words."""

    def __call__(self, **row) -> dict:
        hits = []
        by_moment: dict[tuple[str, str], dict[str, dict]] = {}
        for c in row["cues"]:
            by_moment.setdefault((c["moment_id"], c["segment"]["lang"]), {})[c["segment"]["mode"]] = c
        for pair in by_moment.values():
            if {"casual", "analyst"} <= set(pair):
                text = {m: f"{c['text']['headline']} {c['text']['body']}" for m, c in pair.items()}
                n = {m: len(numbers_in(t)) for m, t in text.items()}
                hits.append(n["casual"] <= 1 and (n["analyst"] > n["casual"] or len(text["analyst"].split()) > len(text["casual"].split())))
        return {"persona_separation": _share(hits), "persona_separation_n": len(hits)}


EVALUATORS = {
    "recall": MomentRecall(), "precision": MomentPrecision(), "explanation": ExplanationAccuracy(), "evidence": EvidenceCorrectness(),
    "grounding": Grounding(), "decisions": DecisionFeedback(), "persona": PersonaSeparation(),
}


def score(row: dict, judgments: dict | None = None) -> dict:
    out = {"match_id": row["match_id"], "scenario": row["scenario"], "moments": len(row["traces"]), "cues": len(row["cues"])}
    for name, ev in EVALUATORS.items():
        out |= ev(**row, **({"judgments": judgments} if name == "explanation" and judgments else {}))
    return out

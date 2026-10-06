"""Scores over many runs, and the markdown report the README quotes."""

METRICS = [
    ("moment_recall", "Moment recall"), ("moment_precision", "Moment precision"), ("explanation_accuracy", "Explanation accuracy"),
    ("evidence_correctness", "Evidence correctness"), ("grounding_first_draft", "Grounding (first draft)"),
    ("grounding_published", "Grounding (published)"), ("decision_feedback", "Decision feedback"), ("persona_separation", "Persona separation"),
]
N = {"grounding_first_draft": "grounding_n", "grounding_published": "cues"}


def aggregate(scores: list[dict]) -> dict:
    """Each score over all runs, weighted by how many cases each run had."""
    out = {}
    for key, _ in METRICS:
        nkey = N.get(key, f"{key}_n")
        pairs = [(s[key], s.get(nkey, 0)) for s in scores if s.get(key) is not None and s.get(nkey, 0)]
        total = sum(n for _, n in pairs)
        out[key] = round(sum(v * n for v, n in pairs) / total, 4) if total else None
        out[nkey] = total
    out["moments"] = sum(s["moments"] for s in scores)
    out["cues"] = sum(s["cues"] for s in scores)
    return out


def _cell(v: float | None) -> str:
    return "–" if v is None else f"{100 * v:.0f} %"


def markdown(scores: list[dict], models: list[str], judge: str) -> str:
    total = aggregate(scores)
    head = "| Run | Moments | " + " | ".join(name for _, name in METRICS) + " |"
    sep = "|---" * (len(METRICS) + 2) + "|"
    rows = [f"| {s['match_id']} | {s['moments']} | " + " | ".join(_cell(s.get(k)) for k, _ in METRICS) + " |" for s in scores]
    rows.append(f"| **All ({len(scores)} runs)** | {total['moments']} | " + " | ".join(f"**{_cell(total[k])}**" for k, _ in METRICS) + " |")
    return "\n".join([
        "# Agent evaluation against scripted ground truth", "",
        f"Models: {', '.join(models) or 'none'}. Explanation accuracy judged by: {judge}.", "",
        "Definitions: spec §5.3.1. Recall counts achieved script truths and errors that led to a shot; a moment counts within its truth's window plus 2 minutes.", "",
        head, sep, *rows, "",
    ])

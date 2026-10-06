"""One evaluation row per run: the manifest's truths, the decision records, and the agents' cached output."""

import json
from pathlib import Path

from touchline_agents.contracts import Cue, MomentTrace


class RunError(Exception):
    """A run folder that cannot be evaluated (missing manifest or agent output)."""


def _jsonl(path: Path) -> list[dict]:
    if not path.is_file():
        raise RunError(f"missing {path} (run: pnpm agents --run {path.parent.parent})")
    return [json.loads(line) for line in path.read_text().splitlines() if line.strip()]


def load_run(run_dir: Path) -> dict:
    """The row for a run: everything the evaluators read, as plain JSON (so rows can go to a .jsonl for Foundry)."""
    run_dir = Path(run_dir)
    manifest_path = run_dir / "manifest.json"
    if not manifest_path.is_file():
        raise RunError(f"missing {manifest_path}")
    manifest = json.loads(manifest_path.read_text())
    truths = manifest["truths"]
    decisions = {}
    for e in _jsonl(run_dir / "domain.jsonl") if (run_dir / "domain.jsonl").is_file() else []:
        a = e["attrs"]
        if "chosen_rank" in a:
            decisions[e["id"]] = {"chosen_rank": a.get("chosen_rank"), "best_receiver_id": a.get("best_receiver_id")}
    agents = run_dir / "agents"
    traces = [MomentTrace.model_validate(t).model_dump(mode="json") for t in _jsonl(agents / "traces.jsonl")]
    cues = [Cue.model_validate(c).model_dump(mode="json", by_alias=True) for c in _jsonl(agents / "cues.jsonl")]
    return {
        "match_id": manifest["match_id"],
        "scenario": manifest.get("scenario"),
        "fps": manifest["fps"],
        "home": manifest["home"],
        "away": manifest["away"],
        "script": [t for t in truths["script"] if t["achieved"]],
        "critical_errors": truths["critical_errors"],
        "mistakes": {m["event_id"]: m for m in truths["mistakes"]},
        "decisions": decisions,
        "traces": traces,
        "cues": cues,
    }

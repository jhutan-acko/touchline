"""touchline-eval: score runs against their truths, or run a fixed suite of scripted matches first.

    uv run --project services/agents touchline-eval score out/eval/* --out out/eval/report.md
    uv run --project services/agents touchline-eval suite --suite ci --out out/eval --agents http://127.0.0.1:8100/
"""

import argparse
import asyncio
import json
import subprocess
import sys
from pathlib import Path

from touchline_agents.config import REPO, load_settings

from .evaluators import score
from .judge import judge_row
from .report import aggregate, markdown
from .rows import RunError, load_run

SCENARIOS = ["late_comeback", "red_card_collapse", "keeper_heroics", "costly_error", "high_press_vs_low_block", "even_contest"]
SUITES = {"ci": [(s, 1) for s in SCENARIOS], "nightly": [(s, seed) for s in SCENARIOS for seed in range(1, 6)]}
SEGMENTS = "casual.en.neutral,analyst.en.neutral,casual.es.neutral,analyst.hi.neutral"


def score_runs(runs: list[Path], judge: bool) -> tuple[list[dict], list[str], str]:
    settings = load_settings()
    scores, models = [], set()
    for run in runs:
        row = load_run(run)
        models |= {t["model"] for t in row["traces"]}
        judgments = asyncio.run(judge_row(row, settings))[0] if judge else None
        scores.append(score(row, judgments))
    return scores, sorted(models), (f"LLM judge ({settings.model_label})" if judge else "keyword rubric")


def run_suite(suite: str, out: Path, agents: str, segments: str) -> list[Path]:
    runs = []
    for scenario, seed in SUITES[suite]:
        run = (out / f"eval-{scenario}-{seed}").resolve()
        subprocess.run(["pnpm", "-s", "sim", "--scenario", scenario, "--seed", str(seed), "--match-id", run.name, "--out", str(run)], cwd=REPO, check=True, capture_output=True)
        subprocess.run(["pnpm", "-s", "agents", "--run", str(run), "--agents", agents, "--segments", segments], cwd=REPO, check=True, capture_output=True)
        print(f"ran {run.name}", file=sys.stderr)
        runs.append(run)
    return runs


def main() -> None:
    p = argparse.ArgumentParser(prog="touchline-eval", description="Score the agents against scripted ground truth (spec §5.3.1)")
    sub = p.add_subparsers(dest="cmd", required=True)
    s = sub.add_parser("score", help="score run folders that have agent output (pnpm agents --run ...)")
    s.add_argument("runs", nargs="+", type=Path)
    u = sub.add_parser("suite", help="simulate a fixed suite of scripted matches, run the agents on them, score them")
    u.add_argument("--suite", choices=sorted(SUITES), default="ci")
    u.add_argument("--agents", default="http://127.0.0.1:8100/")
    u.add_argument("--segments", default=SEGMENTS)
    for x in (s, u):
        x.add_argument("--out", type=Path, help="markdown report (score) or suite folder (suite); default: print")
        x.add_argument("--json", type=Path, help="also write the scores as JSON")
        x.add_argument("--judge", action="store_true", help="judge explanations with the model (TOUCHLINE_LLM=openai) instead of the keyword rubric")
    a = p.parse_args()
    try:
        if a.cmd == "suite":
            out = a.out or REPO / "out/eval"
            runs = run_suite(a.suite, out, a.agents, a.segments)
            report_path = out / "report.md"
        else:
            runs, report_path = a.runs, a.out
        scores, models, judge = score_runs(runs, a.judge)
    except (RunError, subprocess.CalledProcessError) as e:
        print(e if isinstance(e, RunError) else f"{' '.join(e.cmd[:4])} failed: {e.stderr.decode()[-400:]}", file=sys.stderr)
        sys.exit(2)
    text = markdown(scores, models, judge)
    if report_path:
        report_path.parent.mkdir(parents=True, exist_ok=True)
        report_path.write_text(text)
        print(f"wrote {report_path}", file=sys.stderr)
    print(text)
    if a.json:
        a.json.write_text(json.dumps({"runs": scores, "all": aggregate(scores), "models": models, "judge": judge}, indent=2) + "\n")

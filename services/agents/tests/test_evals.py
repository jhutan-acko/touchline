import asyncio
import json

import pytest

from evals.evaluators import (
    DecisionFeedback, EvidenceCorrectness, ExplanationAccuracy, Grounding, MomentPrecision, MomentRecall, PersonaSeparation, score,
)
from evals.report import aggregate, markdown
from evals.rows import RunError, load_run
from evals.rubric import keyword_judge
from touchline_agents.config import REPO

from .factories import analysis, claim, moment


def trace(type_="goal", frame=3000, team="home-fc", cause="clinical finish", explanation="A clean finish from a chance.", claims=(), verdict=None, salience=0.9):
    m = moment(type_, frame, team).model_copy(update={"salience": salience, "priority": 1 if type_ == "goal" else 2})
    a = analysis(m.moment_id, cause, list(claims)).model_copy(update={"explanation": explanation})
    v = verdict or {"moment_id": m.moment_id, "status": "pass", "sentences": [], "claims_checked": 2, "claims_verified": 2, "undeclared": 0}
    return {"moment": m.model_dump(mode="json"), "analysis": a.model_dump(mode="json"), "draft": {"moment_id": m.moment_id, "lang": "en", "sentences": ["x"], "claims": []},
            "verdicts": [v], "fallbacks": [], "cue_ids": [], "timings_ms": {}, "model": "stub"}


def row(traces, script=(), critical=(), mistakes=None, decisions=None, cues=()):
    return {"match_id": "m", "scenario": "x", "fps": 10, "home": "home-fc", "away": "away-fc", "script": list(script), "critical_errors": list(critical),
            "mistakes": mistakes or {}, "decisions": decisions or {}, "traces": list(traces), "cues": list(cues)}


GOAL = {"effect": "goal", "team_id": "home-fc", "frames": [0, 5000], "expected_metrics": ["shot.xg", "team.mom"], "achieved": True}
ERROR = {"kind": "error_leading_to_shot", "mistake_id": "m-e7", "shot_id": "m-e9", "team_id": "away-fc", "frame_id": 4000}
MISTAKE = {"m-e7": {"event_id": "m-e7", "frame_id": 3990, "kind": "mishit", "cause": "pressure"}}


def test_recall_needs_the_right_type_team_and_window():
    assert MomentRecall()(**row([trace()], [GOAL])) == {"moment_recall": 1.0, "moment_recall_n": 1}
    for miss in (trace(team="away-fc"), trace("big_chance"), trace(frame=5000 + 1201)):
        assert MomentRecall()(**row([miss], [GOAL]))["moment_recall"] == 0.0
    assert MomentRecall()(**row([trace(frame=5000 + 1200)], [GOAL]))["moment_recall"] == 1.0  # two minutes' grace


def test_precision_counts_truths_and_significant_signals():
    r = row([trace(), trace("speed_alert", 9000, salience=0.3), trace("pressure_shift", 9100, salience=0.6)], [GOAL])
    assert MomentPrecision()(**r) == {"moment_precision": round(2 / 3, 4), "moment_precision_n": 3}


def test_an_error_under_pressure_is_not_a_technical_error():
    t = {"kind": "critical_error", "mistake_kind": "mishit", "mistake_cause": "pressure"}
    assert keyword_judge(t, "mis-hit clearance under pressure", "")
    assert not keyword_judge(t, "mis-hit clearance", "A poor technical strike.")
    assert not keyword_judge(t, "good interception", "They read the pass.")
    assert keyword_judge({**t, "mistake_cause": "technique"}, "mis-hit pass", "He scuffed it with nobody near him.")
    err = trace("costly_error", 4000, "away-fc", cause="mis-hit clearance under pressure", claims=[claim("event", event_id="m-e7")])
    r = row([err], critical=[ERROR], mistakes=MISTAKE)
    assert ExplanationAccuracy()(**r)["explanation_accuracy"] == 1.0
    assert ExplanationAccuracy()(**r, judgments={"m-e7": False})["explanation_accuracy"] == 0.0  # the LLM judge overrides the rubric
    assert EvidenceCorrectness()(**r)["evidence_correctness"] == 1.0


def test_evidence_must_cite_an_expected_metric_inside_the_window():
    good = trace(claims=[claim(quote="0.12", metric_id="shot.xg", value=0.12, event_id="e", at_frame=3000)])
    late = trace(claims=[claim(quote="0.12", metric_id="shot.xg", value=0.12, event_id="e", at_frame=9000)])
    wrong = trace(claims=[claim(quote="60%", metric_id="tilt", subject="home-fc", value=0.6, at_frame=3000)])
    assert [EvidenceCorrectness()(**row([t], [GOAL]))["evidence_correctness"] for t in (good, late, wrong)] == [1.0, 0.0, 0.0]


def test_grounding_first_draft_and_published():
    v = {"moment_id": "x", "status": "retry", "sentences": [], "claims_checked": 4, "claims_verified": 3, "undeclared": 1}
    cue = {"verified": True, "moment_id": "x", "segment": {"mode": "casual", "lang": "en", "club": None}, "text": {"headline": "a", "body": "b"}}
    g = Grounding()(**row([trace(verdict=v), trace()], cues=[cue]))
    assert g == {"grounding_first_draft": round(5 / 6, 4), "grounding_published": 1.0, "drafts_passing_first_time": 0.5, "grounding_n": 6}


def test_decision_feedback_names_the_best_pass_or_stays_silent():
    decisions = {"m-e7": {"chosen_rank": 3, "best_receiver_id": "p-2"}, "m-e8": {"chosen_rank": 1, "best_receiver_id": "p-5"}}
    right = trace(claims=[claim("better_option", event_id="m-e7", receiver_id="p-2")])
    wrong = trace(claims=[claim("better_option", event_id="m-e7", receiver_id="p-4")])
    best_already = trace(claims=[claim("better_option", event_id="m-e8", receiver_id="p-5")])
    scores = [DecisionFeedback()(**row([t], decisions=decisions))["decision_feedback"] for t in (right, wrong, best_already)]
    assert scores == [1.0, 0.0, 0.0]
    silent = trace("costly_error", 4000, "away-fc", cause="mis-hit")
    assert DecisionFeedback()(**row([silent], critical=[{**ERROR, "mistake_id": "m-e8"}], mistakes={"m-e8": {**MISTAKE["m-e7"], "event_id": "m-e8"}}, decisions=decisions))["decision_feedback"] == 1.0


def test_persona_separation_compares_one_language():
    def cue(mode, body, lang="en"):
        return {"moment_id": "mo", "verified": True, "segment": {"mode": mode, "lang": lang, "club": None}, "text": {"headline": "Goal", "body": body}}

    deep = [cue("casual", "What a goal!"), cue("analyst", "A 0.12 chance, now 1-0, 58% momentum.")]
    flat = [cue("casual", "A 0.12 chance, now 1-0."), cue("analyst", "A 0.12 chance.")]
    assert PersonaSeparation()(**row([], cues=deep))["persona_separation"] == 1.0
    assert PersonaSeparation()(**row([], cues=flat))["persona_separation"] == 0.0
    assert PersonaSeparation()(**row([], cues=[cue("casual", "x", "es"), cue("analyst", "y z w", "hi")]))["persona_separation_n"] == 0


def test_report_weights_runs_by_their_cases():
    a = {"match_id": "a", "moments": 3, "cues": 6, "moment_recall": 1.0, "moment_recall_n": 3}
    b = {"match_id": "b", "moments": 1, "cues": 2, "moment_recall": 0.0, "moment_recall_n": 1}
    assert aggregate([a, b])["moment_recall"] == 0.75
    md = markdown([a, b], ["stub"], "keyword rubric")
    assert "| **All (2 runs)** | 4 | **75 %** |" in md and "Models: stub" in md


def test_a_run_without_agent_output_says_how_to_make_it(run_dir):
    with pytest.raises(RunError, match="pnpm agents --run"):
        load_run(run_dir)


async def test_scores_a_match_run_through_the_gateway(run_dir, stats_url, agents_url, manifest):
    """The whole path: the TypeScript gateway sends the match to the agent service, the harness scores its output."""
    proc = await asyncio.create_subprocess_exec(
        "pnpm", "-s", "agents", "--run", str(run_dir), "--agents", agents_url, "--mcp-url", stats_url,
        "--segments", "casual.en.neutral,analyst.en.neutral,casual.es.northwick,analyst.hi.neutral",
        cwd=REPO, stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE,
    )
    out, err = await proc.communicate()
    assert proc.returncode == 0, err.decode()[-800:]
    summary = json.loads(out)
    assert summary["requests"] == {"ok": summary["requests"]["ok"]} and summary["unverified_cues"] == 0
    s = score(load_run(run_dir))
    assert s["moment_recall"] == 1.0 and s["moment_recall_n"] == len(manifest["truths"]["script"]) + len(manifest["truths"]["critical_errors"])
    assert s["explanation_accuracy"] == 1.0 and s["evidence_correctness"] == 1.0
    assert s["grounding_first_draft"] == 1.0 and s["grounding_published"] == 1.0
    assert s["persona_separation"] == 1.0 and s["moment_precision"] >= 0.8


def test_a_truth_pairs_with_the_moment_that_reports_it_best():
    # A defensive error is best reported by the erring team's costly_error, not by an opponent goal in the window.
    truth = {"effect": "defensive_error", "team_id": "home-fc", "frames": [0, 9000], "expected_metrics": ["pass.acc", "game.chaos"], "achieved": True}
    goal = trace("goal", 2000, "away-fc", cause="low-probability chance", explanation="Away worked it into a shooting position.")
    error = trace("costly_error", 4000, "home-fc", cause="mis-hit pass under pressure", explanation="Home gave it away.")
    assert ExplanationAccuracy()(**row([goal, error], [truth]))["explanation_accuracy"] == 1.0


def test_a_harmless_defensive_error_is_not_credited_to_an_unrelated_goal():
    truth = {"effect": "defensive_error", "team_id": "home-fc", "frames": [0, 9000], "expected_metrics": ["pass.acc", "game.chaos"], "achieved": True}
    assert MomentRecall()(**row([trace("goal", 2000, "away-fc")], [truth]))["moment_recall"] == 0.0


def test_pitch_markers_are_not_variants():
    def cue(mode, body, **kw):
        return {"moment_id": "mo", "verified": True, "segment": {"mode": mode, "lang": "en", "club": None}, "text": {"headline": "Goal", "body": body}, **kw}

    def marker(mode, verified=True):
        return {"moment_id": "mo", "verified": verified, "segment": {"mode": mode, "lang": "en", "club": None}, "text": None, "display": {"slot": "pitch_marker"}}

    cues = [cue("casual", "What a goal!"), marker("casual"), cue("analyst", "A 0.12 chance, now 1-0, 58% momentum."), marker("analyst", verified=False)]
    assert PersonaSeparation()(**row([], cues=cues)) == {"persona_separation": 1.0, "persona_separation_n": 1}
    assert Grounding()(**row([trace()], cues=cues))["grounding_published"] == 1.0
    assert score(row([], cues=cues))["cues"] == 2

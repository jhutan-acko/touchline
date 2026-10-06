import json

import pytest

from touchline_agents.analyst import Analyst, acceptable, evidence, template_analysis
from touchline_agents.config import load_settings
from touchline_agents.contracts import Analysis, Signal
from touchline_agents.detector import DetectorState, build_moments
from touchline_agents.llm import StubChatClient

SETTINGS = load_settings({}, env_file=None)


@pytest.fixture
async def signals(stats) -> list[Signal]:
    return [Signal.model_validate(s) for s in await stats.signals(limit=500)]


def moment_for(signals: list[Signal], type_: str):
    lead = next(s for s in signals if s.type == type_)
    return build_moments([lead.id], signals, DetectorState(fps=10), "rules")[0]


async def test_explains_the_scripted_error_from_what_could_be_seen(stats, signals, manifest):
    [truth] = manifest["truths"]["critical_errors"]
    m = moment_for(signals, "costly_error")
    pack = await evidence(stats, m, signals)
    assert truth["mistake_id"] in pack["errors"]
    assert "scripted" not in json.dumps(pack)  # the simulator's ground truth never reaches an agent
    a = template_analysis(pack)
    assert a.cause == "mis-hit clearance under pressure"
    assert any(c.kind == "event" and c.event_id == truth["mistake_id"] for c in a.claims)
    shot = next(c for c in a.claims if c.metric_id == "shot.xg")
    assert shot.event_id == truth["shot_id"] and shot.quote == f"{shot.value:.2f}"


async def test_every_signal_type_gets_an_explanation(stats, signals):
    for type_ in sorted({s.type for s in signals}):
        a = template_analysis(await evidence(stats, moment_for(signals, type_), signals))
        assert a.cause and not any(ch.isdigit() for ch in a.explanation), type_
        for c in a.claims:
            assert c.kind != "metric" or (c.value is not None and (c.subject or c.event_id)), (type_, c)


async def test_a_goal_claims_the_score_and_the_chance(stats, signals):
    a = template_analysis(await evidence(stats, moment_for(signals, "goal"), signals))
    kinds = [c.kind for c in a.claims]
    assert "score" in kinds and any(c.metric_id == "shot.xg" for c in a.claims)


async def test_the_model_can_query_the_stats_tools(stats, signals):
    client = StubChatClient()
    m = moment_for(signals, "pressure_shift")
    out = await Analyst(client, SETTINGS).analyze(stats, m, signals)
    assert not out.fallback and client.calls == ["analyze", "analyze"]  # a tool call, then the answer
    assert out.analysis.moment_id == m.moment_id and any(c.metric_id == "team.press" for c in out.analysis.claims)


async def test_falls_back_to_the_template_when_the_model_fails(stats, signals):
    m = moment_for(signals, "goal")
    out = await Analyst(StubChatClient("garbage"), SETTINGS).analyze(stats, m, signals)
    assert out.fallback and out.analysis == template_analysis(out.pack)


def test_rejects_numbers_in_the_explanation_and_the_wrong_moment():
    a = Analysis(moment_id="mo-1", cause="press", explanation="They pressed 12 times.", claims=[])
    assert not acceptable(a, "mo-1")
    assert not acceptable(a.model_copy(update={"explanation": "They pressed."}), "mo-2")
    assert acceptable(a.model_copy(update={"explanation": "They pressed."}), "mo-1")


@pytest.mark.live
async def test_openai_explains_the_scripted_error(stats, signals, manifest):
    live = load_settings({"TOUCHLINE_LLM": "openai", "TOUCHLINE_TIMEOUT_SCALE": "10"})
    from touchline_agents.llm import make_client

    m = moment_for(signals, "costly_error")
    out = await Analyst(make_client(live, "large"), live).analyze(stats, m, signals)
    assert not out.fallback, out.reason
    print(out.ms, out.analysis.model_dump_json(indent=1))
    assert "mis-hit" in out.analysis.cause.lower() or "mishit" in out.analysis.cause.lower()
    assert any(c.event_id == manifest["truths"]["critical_errors"][0]["mistake_id"] for c in out.analysis.claims)

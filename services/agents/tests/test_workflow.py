import logging

import pytest

from touchline_agents.config import load_settings
from touchline_agents.contracts import Segment, Signal
from touchline_agents.llm import STUB_RESPONDERS, StubChatClient
from touchline_agents.narrator import template_draft
from touchline_agents.numbers import numbers_in
from touchline_agents.session import Agents, MatchSession
from touchline_agents.workflow import build, run_moments, run_recap

from .conftest import MATCH_ID

SEGMENTS = [Segment(mode="casual", lang="en", club=None), Segment(mode="casual", lang="es", club="northwick"), Segment(mode="analyst", lang="hi", club=None)]


@pytest.fixture
async def signals(stats) -> list[Signal]:
    return [Signal.model_validate(s) for s in await stats.signals(limit=500)]


@pytest.fixture
async def session(stats_url, tmp_path):
    settings = load_settings({"TOUCHLINE_CHECKPOINTS": str(tmp_path / "cp")}, env_file=None)
    s = await MatchSession.open(MATCH_ID, stats_url, SEGMENTS, settings)
    yield s
    await s.close()


async def run(session, signals):
    return [r async for r in run_moments(build(session), signals)]


def with_lie(draft: dict) -> dict:
    """The draft with its explanation (sentence 1) replaced by an undeclared number."""
    return {**draft, "sentences": [draft["sentences"][0], "They have had 9 shots.", *draft["sentences"][2:]]}


async def test_a_batch_comes_out_as_verified_cues_for_every_segment(session, signals):
    batch = [s for s in signals if s.frame_id <= 20000]
    results = await run(session, batch)
    assert results and {r.trace.moment.type for r in results} >= {"goal"}
    for r in results:
        assert [c.segment for c in r.cues] == SEGMENTS  # in the order the segments were asked for
        assert all(c.verified and c.moment_id == r.trace.moment.moment_id for c in r.cues)
        assert r.trace.verdicts[-1].status == "pass" and r.trace.fallbacks == [] and r.trace.model == "stub"
        assert {"detector", "analyst", "narrator", "factchecker", "personalizer_casual", "personalizer_analyst"} <= set(r.trace.timings_ms)
        casual = [c for c in r.cues if c.segment.mode == "casual"]
        assert all(len(numbers_in(f"{c.text.headline} {c.text.body}")) <= 1 for c in casual)
    assert [t.moment.moment_id for t in session.told] == [r.trace.moment.moment_id for r in results]


async def test_a_wrong_draft_is_retried_once_then_published(session, signals):
    calls = []
    original = STUB_RESPONDERS["narrate"]

    def narrate(p, r):
        calls.append(p.get("feedback"))
        d = original(p, r)
        return d if p.get("feedback") else with_lie(d)

    STUB_RESPONDERS["narrate"] = narrate
    try:
        [r] = await run(session, [next(s for s in signals if s.type == "goal")])
    finally:
        STUB_RESPONDERS["narrate"] = original
    assert [v.status for v in r.trace.verdicts] == ["retry", "pass"]
    assert calls[1] and '"9" is not declared' in calls[1][0]
    assert "narrator_retry" in r.trace.timings_ms


async def test_a_draft_still_wrong_after_the_retry_loses_the_bad_sentence(session, signals):
    original = STUB_RESPONDERS["narrate"]
    STUB_RESPONDERS["narrate"] = lambda p, r: with_lie(original(p, r))
    try:
        [r] = await run(session, [next(s for s in signals if s.type == "goal")])
    finally:
        STUB_RESPONDERS["narrate"] = original
    assert [v.status for v in r.trace.verdicts] == ["retry", "drop"]
    assert not any("9 shots" in (c.text.body + c.text.headline) for c in r.cues)
    assert r.trace.draft.sentences[1] == "They have had 9 shots."  # the trace keeps what was dropped


async def test_every_agent_failing_still_publishes_template_cues(stats_url, signals):
    settings = load_settings({}, env_file=None)
    broken = StubChatClient("error")
    agents = Agents.make(settings)
    for a in (agents.detector, agents.narrator, agents.factchecker, agents.personalizer, agents.recap):
        a.agent.client = broken
    agents.analyst.client = broken
    s = await MatchSession.open(MATCH_ID, stats_url, SEGMENTS, settings, agents)
    try:
        [r] = await run(s, [next(x for x in signals if x.type == "goal")])
    finally:
        await s.close()
    assert set(r.trace.fallbacks) == {"moment_detector", "tactical_analyst", "narrator", "personalizer"}
    assert len(r.cues) == len(SEGMENTS) and all(c.verified for c in r.cues)


async def test_checkpoints_are_written_and_load(session, signals, caplog):
    from agent_framework import FileCheckpointStorage

    from touchline_agents.workflow import CHECKPOINT_TYPES

    caplog.set_level(logging.WARNING)
    await run(session, [next(s for s in signals if s.type == "goal")])
    storage = FileCheckpointStorage(str(session.settings.checkpoint_dir / MATCH_ID), allowed_checkpoint_types=CHECKPOINT_TYPES)
    cps = await storage.list_checkpoints(workflow_name="touchline-moments")
    assert len(cps) >= 5
    for cp in cps:
        await storage.load(cp.checkpoint_id)
    assert "blocked" not in caplog.text.lower()


async def test_the_session_refuses_another_match(stats_url):
    with pytest.raises(ValueError, match="serves agents-test"):
        await MatchSession.open("some-other-match", stats_url, SEGMENTS, load_settings({}, env_file=None))


async def test_recaps_tell_the_moments_so_far(session, signals, stats):
    await run(session, [s for s in signals if s.frame_id <= 30000])
    ht = (await stats.events(0, 10**7, types=["period_end"]))[0]["frame_id"]
    r = await run_recap(session, "half_time", ht)
    assert r.recap.verified and r.recap.recap_id == f"{MATCH_ID}-recap-half_time"
    assert set(r.recap.turning_points) <= {t.moment.moment_id for t in session.told}
    assert [c.display.slot for c in r.cues] == ["recap_card"] * len(SEGMENTS)
    assert [v.status for v in r.verdicts] == ["pass"]


def test_template_draft_is_used_by_the_stub():
    assert STUB_RESPONDERS["narrate"].__module__ == template_draft.__module__


@pytest.mark.live
async def test_openai_runs_a_goal_through_the_graph(stats_url, signals):
    live = load_settings({"TOUCHLINE_LLM": "openai", "TOUCHLINE_TIMEOUT_SCALE": "6"})
    s = await MatchSession.open(MATCH_ID, stats_url, SEGMENTS, live)
    try:
        [r] = await run(s, [next(x for x in signals if x.type == "goal")])
    finally:
        await s.close()
    print({k: round(v) for k, v in r.trace.timings_ms.items()}, r.trace.fallbacks, [v.status for v in r.trace.verdicts])
    print(r.trace.analysis.cause, "|", r.trace.draft.sentences)
    print([c.model_dump(include={"kind", "quote", "metric_id", "value", "event_id"}) for c in r.trace.analysis.claims])
    print([(s.index, s.reasons) for v in r.trace.verdicts for s in v.sentences if s.reasons])
    for c in r.cues:
        print(c.segment.mode, c.segment.lang, "|", c.text.headline, "|", c.text.body)
    assert all(c.verified for c in r.cues) and r.trace.model == "openai:gpt-6.1-sol"

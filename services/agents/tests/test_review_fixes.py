"""Tests for the final review's findings (Plan 4a): each failed before its fix."""

import asyncio
import time

import pytest

from touchline_agents.config import load_settings
from touchline_agents.contracts import Segment, Signal
from touchline_agents.detector import DetectorState
from touchline_agents.factchecker import FactChecker, _undeclared
from touchline_agents.llm import StubChatClient
from touchline_agents.personalizer import Variant, check_variant

from .conftest import MATCH_ID
from .factories import claim, signal
from .test_personalizer import payload

SETTINGS = load_settings({}, env_file=None)


# C1: a number counts as declared only when it is a whole token of a claim's quote.
def test_a_number_inside_another_quote_is_not_declared():
    assert _undeclared("They pressed at 27% and won 7 duels.", [claim(quote="27%")]) == ["7"]
    assert _undeclared("His 2 goals came from 0.24 xG.", [claim(quote="0.24")]) == ["2"]


def test_a_variant_cannot_slip_a_number_inside_a_verified_quote():
    p = payload(Segment(mode="analyst", lang="en", club=None))
    v = Variant(headline="Goal", body="Worth 0.12 and they won 1 duel.", numbers=[{"claim": 0, "quote": "0.12"}])
    assert any('"1" is not one of the verified claims' in x for x in check_variant(v, p, []))


# I3: minute, event and better-option claims cannot carry an unchecked number.
async def test_quotes_of_minute_event_and_option_claims_must_hold():
    fc = FactChecker(StubChatClient(), SETTINGS)
    assert await fc.check_claim(None, claim("minute", quote="89th", value=67), "en", 3000, "67:02")
    assert await fc.check_claim(None, claim("minute", quote="68th", value=68), "en", 3000, "67:02") is None
    assert "no number" in await fc.check_claim(None, claim("event", quote="7 duels", event_id="e1"), "en", 3000, "67:02")
    assert "no number" in await fc.check_claim(None, claim("better_option", quote="3 passes", event_id="e1", receiver_id="p"), "en", 3000, "67:02")


# I4: the score is home-away, as of the moment.
async def test_the_score_must_be_current_and_in_home_away_order(stats):
    end = (await stats.events(0, 10**7, types=["period_end"]))[-1]["frame_id"]
    s = (await stats.match_info(end))["score"]
    assert s["home"] != s["away"]
    fc = FactChecker(StubChatClient(), SETTINGS)
    right, wrong = f"{s['home']}-{s['away']}", f"{s['away']}-{s['home']}"
    assert await fc.check_claim(stats, claim("score", quote=right, at_frame=end), "en", end, "90:00") is None
    assert await fc.check_claim(stats, claim("score", quote=wrong, at_frame=end), "en", end, "90:00")
    assert await fc.check_claim(stats, claim("score", quote="0-0", at_frame=0), "en", end, "90:00")


# I5: Spanish and Hindi must be written in Spanish and Hindi.
@pytest.mark.parametrize(("lang", "head", "body"), [
    ("hi", "Ironmoor squeeze them high", "They pressed hard and forced errors all over the pitch।"),
    ("es", "Ironmoor squeeze them high", "They pressed hard and forced the defenders into errors."),
])
def test_english_text_is_not_spanish_or_hindi(lang, head, body):
    p = payload(Segment(mode="casual", lang=lang, club=None))
    problems = check_variant(Variant(headline=head, body=body, numbers=[]), p, [])
    assert any("not written in" in x or "must be in Devanagari" in x for x in problems), problems


# I6: uninvolved names are caught whatever their case.
def test_uninvolved_names_are_caught_in_capitals():
    p = payload(Segment(mode="casual", lang="en", club=None))
    assert any("not involved" in x for x in check_variant(Variant(headline="Goal", body="CY OUTSIDER watched it.", numbers=[]), p, ["Cy Outsider"]))


# I7: a variant's superlative needs a number behind it.
def test_a_variant_superlative_needs_a_metric():
    p = payload(Segment(mode="casual", lang="en", club=None))
    v = Variant(headline="Fastest of the match", body="He was the fastest player on the pitch.", numbers=[])
    assert any("needs a metric" in x for x in check_variant(v, p, []))


# I8: the Analyst's tools never answer past the moment.
async def test_the_analysts_tools_stop_at_the_moment(stats):
    from touchline_agents.analyst import capped_tools

    import json

    tools = {t.name: t for t in capped_tools(stats, 5000)}

    async def call(name, **args):
        out = await tools[name].invoke(arguments=args)
        return json.loads("".join(c.text for c in out) if isinstance(out, list) else out)

    assert (await call("get_events", from_frame=0, to_frame=10**7))["as_of_frame"] == 5000
    assert (await call("match_info", at_frame=10**7))["as_of_frame"] == 5000
    assert (await call("get_signals", to_frame=10**7))["as_of_frame"] == 5000


# I9: frames going backwards (a rerun on a reused session) do not count as cooling.
def test_an_earlier_frame_is_not_cooling():
    st = DetectorState(fps=10)
    st.last[("pressure_shift", "home-fc")] = 50000
    assert not st.cooling(signal("pressure_shift", 4000))


# C2: a request deadline makes every late agent fall back in time.
async def test_a_deadline_turns_slow_models_into_template_cues(stats_url, stats):
    from touchline_agents.llm import deadline
    from touchline_agents.session import Agents, MatchSession
    from touchline_agents.workflow import build, run_moments

    slow = StubChatClient("slow", slow_s=30)
    agents = Agents.make(SETTINGS)
    for a in (agents.detector, agents.narrator, agents.factchecker, agents.personalizer, agents.recap):
        a.agent.client = slow
    agents.analyst.client = slow
    s = await MatchSession.open(MATCH_ID, stats_url, [Segment(mode="casual", lang="en", club=None)], SETTINGS, agents)
    goal = [Signal.model_validate(x) for x in await stats.signals(limit=500) if x["type"] == "goal"][:1]
    t0 = time.perf_counter()
    try:
        with deadline(1.5):
            results = [r async for r in run_moments(build(s), goal)]
    finally:
        await s.close()
    assert time.perf_counter() - t0 < 3.0
    assert len(results) == 1 and results[0].cues and all(c.verified for c in results[0].cues)
    assert "tactical_analyst" in results[0].trace.fallbacks


# I9: a failing full-time recap still releases the match.
async def test_a_failed_full_time_recap_releases_the_match(stats_url, monkeypatch):
    from a2a.server.events import EventQueue

    from touchline_agents import server
    from touchline_agents.server import Sessions, TouchlineExecutor

    async def boom(*_a, **_k):
        raise RuntimeError("recap broke")

    monkeypatch.setattr(server, "run_recap", boom)
    sessions = Sessions(SETTINGS)
    req = {"kind": "recap", "match_id": MATCH_ID, "mcp_url": stats_url, "segments": [{"mode": "casual", "lang": "en", "club": None}], "recap": "full_time", "at_frame": 100}
    from a2a.helpers import new_data_part
    from a2a.server.agent_execution import RequestContext
    from a2a.types import Message, Role, SendMessageRequest

    msg = Message(role=Role.ROLE_USER, parts=[new_data_part(req, "application/json")], message_id="m1", context_id="c1", task_id="t1")
    from a2a.server.context import ServerCallContext

    ctx = RequestContext(ServerCallContext(), request=SendMessageRequest(message=msg), task_id="t1", context_id="c1")
    q = EventQueue()
    await TouchlineExecutor(sessions).execute(ctx, q)
    assert sessions.open_matches() == []
    await asyncio.sleep(0)


def test_the_service_budget_comes_from_the_environment():
    assert load_settings({}, env_file=None).request_budget_s is None
    assert load_settings({"TOUCHLINE_REQUEST_BUDGET_S": "3.5"}, env_file=None).request_budget_s == 3.5


async def test_idle_matches_are_released(stats_url):
    from touchline_agents.contracts import parse_request
    from touchline_agents.server import Sessions

    sessions = Sessions(SETTINGS, idle_s=60)
    req = parse_request({"kind": "recap", "match_id": MATCH_ID, "mcp_url": stats_url, "segments": [{"mode": "casual", "lang": "en", "club": None}], "recap": "half_time", "at_frame": 100})
    await sessions.get(req)
    await sessions.evict_idle(now=time.monotonic() + 61)
    assert sessions.open_matches() == []

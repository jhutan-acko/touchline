"""Pause and ask against the real models (`-m live`, skipped by default): typed questions through the question agent
(fast tier) and the answer team (analyst large, personaliser fast), each timed. The what-if numbers stand in for the
API's re-simulation (fixed, as in test_ask_answer); the stats are the test match's, over MCP.

Run: TOUCHLINE_LLM=openai uv run --project services/agents pytest services/agents/tests/test_ask_live.py -m live -s
"""

import os
import re
import time

import pytest
from agent_framework import Agent

from touchline_agents import ask_answer, question
from touchline_agents.ask_answer import AskTeam
from touchline_agents.config import load_settings
from touchline_agents.contracts import AskAnswerRequest, AskIntentRequest, AskStage, AskWhatIf, FrameSummary
from touchline_agents.llm import make_client
from touchline_agents.question import QuestionAgent

from .conftest import MATCH_ID

pytestmark = pytest.mark.live

AT = 3000
# The target wall time of one Ask question, question agent to reply.
TARGET_S = 10.0
DEVANAGARI = re.compile(r"[ऀ-ॿ]")


def live_settings():
    return load_settings({**os.environ, "TOUCHLINE_LLM": "openai"})


@pytest.fixture
def outcomes(monkeypatch):
    """Every model call's outcome (task, fell back, why, ms), so a fallback that hides a model failure shows."""
    seen: list[tuple[str, bool, str | None, int]] = []
    for mod in (question, ask_answer):
        real = mod.run_structured

        async def recorded(agent, task, *a, _real=real, **kw):
            out = await _real(agent, task, *a, **kw)
            seen.append((task, out.fallback, out.reason, round(out.ms)))
            return out

        monkeypatch.setattr(mod, "run_structured", recorded)
    return seen


async def frame_summary(stats) -> FrameSummary:
    info = await stats.roster()
    home, away = info["home"]["players"], info["away"]["players"]
    holder, striker = home[5], home[9]
    return FrameSummary.model_validate({
        "match_id": MATCH_ID, "frame": AT, "clock": f"{AT // 600:02d}:{AT % 600 // 10:02d}", "ball_holder": holder["id"],
        "side_in_possession": "home",
        "players": [{"id": p["id"], "name": p["name"], "side": "home", "role": "CM", "x": 0.0, "y": 0.0} for p in home[:11]]
        + [{"id": p["id"], "name": p["name"], "side": "away", "role": "CB", "x": 5.0, "y": 1.0} for p in away[:11]],
        "pass_options": [{"receiver_id": striker["id"], "xpass": 0.6, "value": 0.07}],
        "pressers": [away[3]["id"], away[4]["id"]], "recent": [], "missed_option": None,
    })


async def ask(stats, stats_url, summary: FrameSummary, text: str, lang: str):
    """One typed question, end to end: intent, then the answer team. Returns (intent, reply, stages, seconds)."""
    s = live_settings()
    t0 = time.perf_counter()
    intent = await QuestionAgent(make_client(s, "fast"), s).parse(AskIntentRequest(kind="ask_intent", question=text, lang=lang, summary=summary))
    what_if = None
    if intent.kind == "what_if" and intent.intervention:
        what_if = AskWhatIf.model_validate({
            "intervention": intent.intervention.model_dump(mode="json"), "fork_frame": AT, "verdict": "better_option_found", "seeds": 20,
            "shots": {"played": 2, "alt": 5}, "goals": {"played": 0, "alt": 1}, "gain": {"mean": 0.042, "se": 0.011},
        })
    req = AskAnswerRequest.model_validate({
        "kind": "ask_answer", "match_id": MATCH_ID, "mcp_url": stats_url, "at_frame": AT, "question": text,
        "segment": {"mode": "casual", "lang": lang, "club": None}, "intent": intent.model_dump(mode="json"),
        "summary": summary.model_dump(mode="json", by_alias=True), "what_if": what_if.model_dump(mode="json") if what_if else None,
    })
    stages: list[AskStage] = []

    async def emit(st: AskStage) -> None:
        stages.append(st)

    reply = await AskTeam(make_client(s, "large"), make_client(s, "fast"), s).answer(req, stats, emit)
    return intent, reply, stages, time.perf_counter() - t0


async def test_fast_model_is_reachable():
    s = live_settings()
    t0 = time.perf_counter()
    r = await Agent(client=make_client(s, "fast"), name="ping", instructions="Answer with one word.").run("Say OK.")
    print(f"\nfast model {s.model('fast')}: {time.perf_counter() - t0:.2f} s, {r.text!r}")
    assert r.text.strip()


@pytest.mark.parametrize(("lang", "kind"), [("en", "what_if"), ("hi", "explain"), ("en", "unsupported")])
async def test_typed_question(stats, stats_url, outcomes, lang, kind):
    summary = await frame_summary(stats)
    names = {p.id: p.name for p in summary.players}
    holder, striker = names[summary.ball_holder], names[summary.pass_options[0].receiver_id]
    text = {
        "what_if": f"What if {holder} passed to {striker}?",
        "explain": f"{holder} पर दबाव कौन बना रहा है?",
        "unsupported": f"What if {holder} had shot from there?",
    }[kind]
    intent, reply, stages, secs = await ask(stats, stats_url, summary, text, lang)
    print(f"\n[{lang} {kind}] {secs:.2f} s (target {TARGET_S:.0f} s) intent={intent.kind} verified={reply.verified} model={reply.model}")
    print(f"  stages: {[st.stage for st in stages]}")
    print(f"  calls: {outcomes}")
    print(f"  headline: {reply.headline}\n  body: {reply.body}")
    assert reply.headline and stages, "the question did not complete"
    if lang == "hi":
        assert DEVANAGARI.search(reply.headline + reply.body), "the Hindi answer is not in Devanagari"
    if kind == "unsupported":
        assert intent.kind == "unsupported" and reply.chips == []
    if secs > TARGET_S:
        print(f"  OVER TARGET: {secs:.2f} s > {TARGET_S:.0f} s")

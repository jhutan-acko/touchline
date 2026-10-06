import pytest
from agent_framework import Agent, tool
from pydantic import BaseModel

from touchline_agents.config import load_settings
from touchline_agents.llm import STUB_RESPONDERS, StubChatClient, ToolCalls, agent_options, envelope, make_client, parse_envelope, run_structured


class Answer(BaseModel):
    text: str
    n: int


@pytest.fixture(autouse=True)
def responders():
    STUB_RESPONDERS["echo"] = lambda payload, results: {"text": payload["say"], "n": len(results)}
    STUB_RESPONDERS["lookup"] = lambda payload, results: (
        ToolCalls([("double", {"x": payload["x"]})]) if not results else {"text": results[0], "n": len(results)}
    )
    yield
    STUB_RESPONDERS.pop("echo")
    STUB_RESPONDERS.pop("lookup")


@tool(description="Double a number")
def double(x: int) -> int:
    return 2 * x


def test_envelope_round_trips():
    task, payload = parse_envelope(envelope("narrate", {"b": 1, "a": "é"}))
    assert task == "narrate" and payload == {"a": "é", "b": 1}
    with pytest.raises(ValueError):
        parse_envelope("hello")


async def test_stub_answers_through_an_agent_with_structured_output():
    agent = Agent(client=StubChatClient(), name="echo", instructions="Echo.")
    r = await agent.run(envelope("echo", {"say": "hi"}), options={"response_format": Answer})
    assert r.value == Answer(text="hi", n=0)


async def test_stub_calls_tools_before_answering():
    agent = Agent(client=StubChatClient(), name="lookup", instructions="Look up.", tools=[double])
    r = await agent.run(envelope("lookup", {"x": 21}), options={"response_format": Answer})
    assert r.value == Answer(text="42", n=1)


@pytest.mark.parametrize(("behaviour", "reason"), [("error", "RuntimeError"), ("garbage", "ValidationError"), ("slow", "timeout")])
async def test_failures_use_the_fallback(behaviour, reason):
    agent = Agent(client=StubChatClient(behaviour, slow_s=5), name="echo", instructions="Echo.")
    out = await run_structured(agent, "echo", {"say": "hi"}, Answer, timeout_s=0.2, fallback=lambda: Answer(text="fallback", n=-1))
    assert out.fallback and out.reason == reason and out.value.text == "fallback"


async def test_rejected_output_uses_the_fallback():
    agent = Agent(client=StubChatClient(), name="echo", instructions="Echo.")
    out = await run_structured(agent, "echo", {"say": "hi"}, Answer, timeout_s=1, fallback=lambda: Answer(text="fb", n=0), accept=lambda a: a.text != "hi")
    assert out.fallback and out.reason == "invalid"
    ok = await run_structured(agent, "echo", {"say": "yo"}, Answer, timeout_s=1, fallback=lambda: Answer(text="fb", n=0))
    assert not ok.fallback and ok.value.text == "yo" and ok.ms >= 0


def test_stub_provider_makes_a_stub_client():
    stub = load_settings({}, env_file=None)
    assert isinstance(make_client(stub, "small"), StubChatClient)
    assert agent_options(stub) == {}
    assert agent_options(load_settings({"TOUCHLINE_LLM": "openai", "OPENAI_API_KEY": "k"}, env_file=None)) == {"reasoning": {"effort": "low"}}


@pytest.mark.live
async def test_openai_answers_with_structured_output():
    settings = load_settings({"TOUCHLINE_LLM": "openai"})
    agent = Agent(client=make_client(settings, "small"), name="echo", instructions="Reply with JSON: text = the INPUT's `say`, n = 7.", default_options=agent_options(settings))
    out = await run_structured(agent, "echo", {"say": "hi"}, Answer, timeout_s=60, fallback=lambda: Answer(text="fallback", n=0))
    assert not out.fallback, out.reason
    assert out.value == Answer(text="hi", n=7)

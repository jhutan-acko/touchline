"""Model access behind one interface (spec §11): the OpenAI client, or a deterministic stub for tests and CI.

Every agent sends one user message: `TASK: <task>` and its input as JSON. The stub answers each task with a
registered responder (the agent's own deterministic logic), so a stubbed run exercises the whole Agent Framework
path (prompt, structured output, tool calls over MCP) and is reproducible.
"""

import asyncio
import contextlib
import contextvars
import json
import logging
import re
import time
from collections.abc import Callable, Mapping, Sequence
from dataclasses import dataclass
from typing import Any, Literal

from agent_framework import (
    Agent,
    BaseChatClient,
    ChatMiddlewareLayer,
    ChatResponse,
    ChatResponseUpdate,
    Content,
    FunctionInvocationLayer,
    Message,
)
from agent_framework.observability import ChatTelemetryLayer
from pydantic import BaseModel

from .config import Settings, Tier

log = logging.getLogger("touchline.agents")

_ENVELOPE = re.compile(r"\ATASK: (?P<task>[a-z_]+)\nINPUT:\n(?P<input>.*)\Z", re.S)


def envelope(task: str, payload: Mapping[str, Any]) -> str:
    """The single user message every agent sends."""
    return f"TASK: {task}\nINPUT:\n{json.dumps(payload, ensure_ascii=False, sort_keys=True)}"


def parse_envelope(text: str) -> tuple[str, dict]:
    m = _ENVELOPE.match(text)
    if not m:
        raise ValueError("not a Touchline task message")
    return m["task"], json.loads(m["input"])


@dataclass(frozen=True)
class ToolCalls:
    """A stub responder's request to call tools before it answers: [(tool name, arguments), ...]."""

    calls: Sequence[tuple[str, Mapping[str, Any]]]


# task -> responder(input, tool results so far) -> the answer as JSON-ready data, or ToolCalls.
Responder = Callable[[dict, list[str]], "dict | ToolCalls"]
STUB_RESPONDERS: dict[str, Responder] = {}


def stub_responder(task: str) -> Callable[[Responder], Responder]:
    """Register how the stub model answers `task` (each agent module registers its own)."""

    def register(fn: Responder) -> Responder:
        STUB_RESPONDERS[task] = fn
        return fn

    return register


StubBehaviour = Literal["ok", "error", "garbage", "slow"]


class StubChatClient(FunctionInvocationLayer, ChatMiddlewareLayer, ChatTelemetryLayer, BaseChatClient):
    """A deterministic chat client. `ok` answers with the registered responder; `error` raises, `garbage` returns text
    that is not the requested JSON and `slow` never answers in time: the three ways a real model fails."""

    OTEL_PROVIDER_NAME = "touchline-stub"

    def __init__(self, behaviour: StubBehaviour = "ok", *, slow_s: float = 60.0, **kwargs: Any) -> None:
        super().__init__(**kwargs)
        self.behaviour = behaviour
        self.slow_s = slow_s
        self.calls: list[str] = []

    def _answer(self, messages: Sequence[Message]) -> Message:
        text = next((m.text for m in messages if m.role == "user"), "")
        task, payload = parse_envelope(text)
        self.calls.append(task)
        if self.behaviour == "error":
            raise RuntimeError("stub model error")
        if self.behaviour == "garbage":
            return Message("assistant", [Content.from_text("Sorry, I can't help with that.")])
        results = [str(c.result) for m in messages for c in m.contents if c.type == "function_result"]
        out = STUB_RESPONDERS[task](payload, results)
        if isinstance(out, ToolCalls):
            calls = [Content.from_function_call(call_id=f"stub-{i}", name=n, arguments=dict(a)) for i, (n, a) in enumerate(out.calls)]
            return Message("assistant", calls)
        return Message("assistant", [Content.from_text(json.dumps(out, ensure_ascii=False))])

    def _inner_get_response(self, *, messages, stream, options, **kwargs):
        async def respond() -> Message:
            if self.behaviour == "slow":
                await asyncio.sleep(self.slow_s)
            return self._answer(messages)

        if stream:

            async def gen():
                msg = await respond()
                yield ChatResponseUpdate(role="assistant", contents=msg.contents)

            return self._build_response_stream(gen(), response_format=options.get("response_format"))

        async def resp() -> ChatResponse:
            return ChatResponse(messages=[await respond()], response_id="stub")

        return resp()


def make_client(settings: Settings, tier: Tier) -> BaseChatClient:
    """The chat client for a model tier."""
    if settings.provider == "stub":
        return StubChatClient()
    from agent_framework.openai import OpenAIChatClient

    return OpenAIChatClient(model=settings.model(tier), api_key=settings.openai_api_key)


def agent_options(settings: Settings) -> dict[str, Any]:
    """Default options for every agent's model calls (the stub ignores them)."""
    return {} if settings.provider == "stub" else {"reasoning": {"effort": settings.reasoning_effort}}


# When the current request must be answered by (time.monotonic()); None: no limit.
_DEADLINE: contextvars.ContextVar[float | None] = contextvars.ContextVar("touchline_deadline", default=None)


@contextlib.contextmanager
def deadline(seconds: float | None):
    """Within this block every agent call ends by `seconds` from now: a late model gives the fallback, and once the
    time is up no model is called at all, so a live request is answered in time with template output."""
    token = _DEADLINE.set(None if seconds is None else time.monotonic() + seconds)
    try:
        yield
    finally:
        _DEADLINE.reset(token)


@dataclass(frozen=True)
class Outcome[T]:
    value: T
    fallback: bool
    # Why the fallback was used (exception type or "invalid"); None when the model answered.
    reason: str | None
    ms: float


async def run_structured[T: BaseModel](
    agent: Agent,
    task: str,
    payload: Mapping[str, Any],
    output: type[T],
    *,
    timeout_s: float,
    fallback: Callable[[], T],
    accept: Callable[[T], bool] = lambda _: True,
) -> Outcome[T]:
    """Ask `agent` for `output`; on a timeout, a model error, unparseable output or output `accept` rejects, use
    `fallback()` instead (spec §6: every agent has a deterministic fallback, so the match never goes silent)."""
    t0 = time.perf_counter()
    reason: str | None = None
    if (end := _DEADLINE.get()) is not None:
        timeout_s = min(timeout_s, end - time.monotonic())
        if timeout_s <= 0.05:
            return Outcome(fallback(), True, "deadline", 0.0)
    try:
        r = await asyncio.wait_for(agent.run(envelope(task, payload), options={"response_format": output}), timeout_s)
        value = r.value
        if isinstance(value, output) and accept(value):
            return Outcome(value, False, None, (time.perf_counter() - t0) * 1000)
        reason = "invalid"
    except TimeoutError:
        reason = "timeout"
    except Exception as e:  # any model or parsing failure means: use the fallback
        reason = type(e).__name__
        log.warning("%s: model failed (%s), using the fallback", task, reason)
    return Outcome(fallback(), True, reason, (time.perf_counter() - t0) * 1000)

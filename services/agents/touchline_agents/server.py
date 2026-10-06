"""The agent service over A2A v1.0 (spec §4.1: "API -> agents: submit a moment task, stream back cue artifacts").

Each message carries one AgentRequest as a JSON data part. A signals request runs the moment workflow and streams
an artifact per verified cue ("cue") and per moment ("trace"); a recap request streams the recap ("recap") and its
recap cards ("cue"). Sessions are per match; requests for one match run one at a time, in order.
"""

import argparse
import asyncio
import logging
from contextlib import asynccontextmanager

import uvicorn
from a2a.helpers import get_data_parts, new_data_part, new_task_from_user_message, new_text_message
from a2a.server.agent_execution import AgentExecutor, RequestContext
from a2a.server.events import EventQueue
from a2a.server.request_handlers import DefaultRequestHandler
from a2a.server.routes import create_agent_card_routes, create_jsonrpc_routes
from a2a.server.tasks import InMemoryTaskStore, TaskUpdater
from a2a.types import AgentCapabilities, AgentCard, AgentInterface, AgentSkill
from pydantic import ValidationError
from starlette.applications import Starlette

from .config import Settings, load_settings
from .contracts import RecapRequest, SignalsRequest, dump, parse_request
from .session import Agents, MatchSession
from .stats import StatsError
from .workflow import build, run_moments, run_recap

log = logging.getLogger("touchline.agents")
JSON = "application/json"


def agent_card(url: str) -> AgentCard:
    return AgentCard(
        name="touchline-agents",
        description="Touchline's six-agent commentary workflow: moments, explanations, fact-checked cues per viewer segment, recaps.",
        version="0.1.0",
        default_input_modes=[JSON],
        default_output_modes=[JSON],
        capabilities=AgentCapabilities(streaming=True),
        supported_interfaces=[AgentInterface(url=url, protocol_binding="JSONRPC", protocol_version="1.0")],
        skills=[
            AgentSkill(id="moments", name="Moments to cues", description="New stats signals in; verified, personalized cues and moment traces out.",
                       tags=["football", "commentary"], examples=['{"kind": "signals", ...}']),
            AgentSkill(id="recap", name="Recap", description="A fact-checked half-time or full-time recap and its recap cards.",
                       tags=["football", "recap"], examples=['{"kind": "recap", "recap": "half_time", ...}']),
        ],
    )


class Sessions:
    """Match sessions by match id, each with its workflow and a lock so its requests run in order."""

    def __init__(self, settings: Settings, agents: Agents | None = None) -> None:
        self.settings = settings
        self.agents = agents
        self._open: dict[str, tuple[MatchSession, object, asyncio.Lock]] = {}
        self._guard = asyncio.Lock()

    async def get(self, req: SignalsRequest | RecapRequest) -> tuple[MatchSession, object, asyncio.Lock]:
        async with self._guard:
            entry = self._open.get(req.match_id)
            if entry is None or entry[0].stats.url != req.mcp_url:
                if entry is not None:
                    await entry[0].close()
                s = await MatchSession.open(req.match_id, req.mcp_url, list(req.segments), self.settings, self.agents)
                entry = (s, build(s), asyncio.Lock())
                self._open[req.match_id] = entry
            entry[0].segments = list(req.segments)
            return entry

    def open_matches(self) -> list[str]:
        return sorted(self._open)

    async def finish(self, req: RecapRequest) -> None:
        """After the full-time recap the match is over: close its stats connection and forget its session."""
        if req.recap != "full_time":
            return
        async with self._guard:
            entry = self._open.pop(req.match_id, None)
            if entry is not None:
                await entry[0].close()

    async def close(self) -> None:
        for s, _, _ in self._open.values():
            await s.close()
        self._open.clear()


class TouchlineExecutor(AgentExecutor):
    def __init__(self, sessions: Sessions) -> None:
        self.sessions = sessions

    async def execute(self, context: RequestContext, event_queue: EventQueue) -> None:
        task = context.current_task or new_task_from_user_message(context.message)
        if context.current_task is None:
            await event_queue.enqueue_event(task)
        up = TaskUpdater(event_queue, task.id, task.context_id)
        data = get_data_parts(context.message.parts) if context.message else []
        try:
            if len(data) != 1:
                raise ValueError(f"expected one JSON data part, got {len(data)}")
            req = parse_request(data[0])
            session, workflow, lock = await self.sessions.get(req)
        except (ValueError, ValidationError, StatsError) as e:
            await up.failed(new_text_message(f"bad request: {e}", context_id=task.context_id, task_id=task.id))
            return
        await up.start_work(new_text_message(f"{req.kind} for {req.match_id}", context_id=task.context_id, task_id=task.id))
        try:
            async with lock:
                if isinstance(req, SignalsRequest):
                    async for result in run_moments(workflow, list(req.signals)):
                        for cue in result.cues:
                            await up.add_artifact([new_data_part(dump(cue), JSON)], artifact_id=cue.cue_id, name="cue", last_chunk=True)
                        trace = result.trace
                        await up.add_artifact([new_data_part(dump(trace), JSON)], artifact_id=f"{trace.moment.moment_id}-trace", name="trace", last_chunk=True)
                else:
                    r = await run_recap(session, req.recap, req.at_frame)
                    await up.add_artifact([new_data_part(dump(r.recap), JSON)], artifact_id=r.recap.recap_id, name="recap", last_chunk=True)
                    for cue in r.cues:
                        await up.add_artifact([new_data_part(dump(cue), JSON)], artifact_id=cue.cue_id, name="cue", last_chunk=True)
            if isinstance(req, RecapRequest):
                await self.sessions.finish(req)
        except Exception as e:  # the task fails with the reason; the service keeps serving
            log.exception("%s for %s failed", req.kind, req.match_id)
            await up.failed(new_text_message(f"{req.kind} failed: {type(e).__name__}: {e}", context_id=task.context_id, task_id=task.id))
            return
        await up.complete()

    async def cancel(self, context: RequestContext, event_queue: EventQueue) -> None:
        await TaskUpdater(event_queue, context.task_id, context.context_id).cancel()


def create_app(url: str, settings: Settings | None = None, agents: Agents | None = None) -> Starlette:
    """The A2A app: the agent card at /.well-known/agent-card.json and JSON-RPC at /."""
    sessions = Sessions(settings or load_settings(), agents)
    card = agent_card(url)
    handler = DefaultRequestHandler(agent_executor=TouchlineExecutor(sessions), task_store=InMemoryTaskStore(), agent_card=card)

    @asynccontextmanager
    async def lifespan(_app):
        yield
        await sessions.close()

    return Starlette(routes=[*create_agent_card_routes(card), *create_jsonrpc_routes(handler, "/")], lifespan=lifespan)


def main() -> None:
    p = argparse.ArgumentParser(description="touchline-agents: the agent workflow over A2A")
    p.add_argument("--host", default="127.0.0.1")
    p.add_argument("--port", type=int, default=8100)
    a = p.parse_args()
    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(name)s: %(message)s")
    settings = load_settings()
    log.info("touchline-agents A2A on http://%s:%d/ (models: %s)", a.host, a.port, settings.model_label)
    uvicorn.run(create_app(f"http://{a.host}:{a.port}/", settings), host=a.host, port=a.port, log_level="warning")


if __name__ == "__main__":
    main()

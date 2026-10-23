import uuid

import httpx
import pytest
from a2a.client import A2ACardResolver, ClientConfig, ClientFactory
from a2a.helpers import get_data_parts, new_data_part, new_text_part
from a2a.types import Message, Role, SendMessageRequest, TaskState

from touchline_agents.config import load_settings
from touchline_agents.contracts import Cue, MomentTrace, Recap

from .conftest import MATCH_ID

SEGMENTS = [{"mode": "casual", "lang": "en", "club": None}, {"mode": "analyst", "lang": "es", "club": None}]


@pytest.fixture
def server(agents_url):
    return agents_url


async def send(url: str, parts) -> tuple[TaskState, dict[str, list[dict]], str]:
    """Send one message, stream the task; return its final state, artifacts by name and the last status text."""
    async with httpx.AsyncClient(timeout=120) as http:
        card = await A2ACardResolver(http, url).get_agent_card()
        client = ClientFactory(ClientConfig(httpx_client=http, streaming=True)).create(card)
        msg = Message(role=Role.ROLE_USER, parts=parts, message_id=str(uuid.uuid4()))
        state, arts, text = None, {}, ""
        async for item in client.send_message(SendMessageRequest(message=msg)):
            kind = item.WhichOneof("payload")
            if kind == "status_update":
                state = item.status_update.status.state
                text = " ".join(p.text for p in item.status_update.status.message.parts if p.text)
            elif kind == "task":
                state = item.task.status.state
            elif kind == "artifact_update":
                a = item.artifact_update.artifact
                arts.setdefault(a.name, []).extend(get_data_parts(a.parts))
        return state, arts, text


async def test_serves_its_agent_card(server):
    async with httpx.AsyncClient() as http:
        card = (await http.get(f"{server}.well-known/agent-card.json")).json()
    assert card["name"] == "touchline-agents" and card["capabilities"]["streaming"]
    assert card["supportedInterfaces"][0] == {"url": server, "protocolBinding": "JSONRPC", "protocolVersion": "1.0"}
    assert {s["id"] for s in card["skills"]} == {"moments", "recap", "manage", "ask"}


async def test_signals_stream_back_as_cues_and_traces(server, stats_url, stats):
    signals = [s for s in await stats.signals(limit=500) if s["type"] == "goal"][:1]
    req = {"kind": "signals", "match_id": MATCH_ID, "mcp_url": stats_url, "segments": SEGMENTS, "now_frame": signals[0]["frame_id"], "signals": signals}
    state, arts, _ = await send(server, [new_data_part(req, "application/json")])
    assert state == TaskState.TASK_STATE_COMPLETED
    cues = [Cue.model_validate(c) for c in arts["cue"]]
    [trace] = [MomentTrace.model_validate(t) for t in arts["trace"]]
    assert [c.segment.lang for c in cues] == ["en", "es"] and all(c.verified for c in cues)
    assert trace.cue_ids == [c.cue_id for c in cues]


async def test_recaps_stream_back_with_their_cards(server, stats_url, stats):
    ht = (await stats.events(0, 10**7, types=["period_end"]))[0]["frame_id"]
    req = {"kind": "recap", "match_id": MATCH_ID, "mcp_url": stats_url, "segments": SEGMENTS, "recap": "half_time", "at_frame": ht}
    state, arts, _ = await send(server, [new_data_part(req, "application/json")])
    assert state == TaskState.TASK_STATE_COMPLETED
    assert Recap.model_validate(arts["recap"][0]).kind == "half_time"
    assert [Cue.model_validate(c).display.slot for c in arts["cue"]] == ["recap_card", "recap_card"]


@pytest.mark.parametrize(("parts", "why"), [
    ([new_text_part("hello")], "expected one JSON data part"),
    ([new_data_part({"kind": "chat", "match_id": MATCH_ID})], "bad request"),
    ([new_data_part({"kind": "recap", "match_id": MATCH_ID, "mcp_url": "http://169.254.169.254/latest", "segments": SEGMENTS, "recap": "half_time", "at_frame": 1})], "not allowed"),
    ([new_data_part({"kind": "recap", "match_id": MATCH_ID, "mcp_url": "http://127.0.0.1:1/mcp", "segments": SEGMENTS * 7, "recap": "half_time", "at_frame": 1})], "at most 12"),
])
async def test_bad_requests_fail_with_a_reason(server, parts, why):
    state, arts, text = await send(server, parts)
    assert state == TaskState.TASK_STATE_FAILED and arts == {}
    assert why in text, text


async def test_a_batch_that_promotes_nothing_completes_without_artifacts(server, stats_url, stats):
    quiet = [s for s in await stats.signals(limit=500) if s["type"] == "distance_milestone"][:1]
    req = {"kind": "signals", "match_id": MATCH_ID, "mcp_url": stats_url, "segments": SEGMENTS, "now_frame": quiet[0]["frame_id"], "signals": quiet}
    state, arts, _ = await send(server, [new_data_part(req, "application/json")])
    assert state == TaskState.TASK_STATE_COMPLETED and arts == {}


async def test_the_full_time_recap_closes_the_match(stats_url, stats):
    from touchline_agents.contracts import parse_request
    from touchline_agents.server import Sessions

    sessions = Sessions(load_settings({}, env_file=None))
    ft = (await stats.events(0, 10**7, types=["period_end"]))[-1]["frame_id"]
    req = parse_request({"kind": "recap", "match_id": MATCH_ID, "mcp_url": stats_url, "segments": SEGMENTS, "recap": "full_time", "at_frame": ft})
    await sessions.get(req)
    assert sessions.open_matches() == [MATCH_ID]
    await sessions.finish(req)
    assert sessions.open_matches() == []


async def test_a_manage_request_needs_no_match_session_and_answers_with_a_manager_artifact(server):
    from pathlib import Path
    import json

    from touchline_agents.contracts import ManagerReply

    fixture = Path(__file__).resolve().parents[3] / "packages/schema/fixtures/agents/valid/request-manage-propose.json"
    req = json.loads(fixture.read_text())["value"]
    state, arts, _ = await send(server, [new_data_part(req, "application/json")])
    assert state == TaskState.TASK_STATE_COMPLETED
    [reply] = [ManagerReply.model_validate(a) for a in arts["manager"]]
    assert reply.task == "propose" and not reply.fallback and len(reply.proposal.options) >= 2


async def test_ask_intent_artifact(server):
    from touchline_agents.contracts import AskIntent

    from .test_question import summary

    req = {"kind": "ask_intent", "question": "What if Okafor passed to Diallo?", "lang": "en", "summary": summary().model_dump(mode="json")}
    state, arts, _ = await send(server, [new_data_part(req, "application/json")])
    assert state == TaskState.TASK_STATE_COMPLETED
    assert len(arts["ask_intent"]) == 1
    intent = AskIntent.model_validate(arts["ask_intent"][0])
    assert intent.kind == "what_if" and intent.intervention.receiver_id == "p-h-09"


async def test_ask_answer_streams_stages_then_reply(server, stats_url, stats):
    from touchline_agents.contracts import AskReply, AskStage

    info = await stats.roster()
    home = info["home"]["players"]
    passer, receiver = home[5]["id"], home[9]["id"]
    at = 3000
    req = {
        "kind": "ask_answer", "match_id": MATCH_ID, "mcp_url": stats_url, "at_frame": at, "question": "What if he had passed?",
        "segment": {"mode": "casual", "lang": "en", "club": None},
        "intent": {"kind": "what_if", "subject_id": passer, "fork_event_id": None,
                   "intervention": {"kind": "pass_to", "player_id": passer, "receiver_id": receiver}, "reason": None},
        "summary": {"match_id": MATCH_ID, "frame": at, "clock": "05:00", "ball_holder": passer, "side_in_possession": "home",
                    "players": [], "pass_options": [], "pressers": [], "recent": [], "missed_option": None},
        "what_if": {"intervention": {"kind": "pass_to", "player_id": passer, "receiver_id": receiver}, "fork_frame": at - 40,
                    "verdict": "better_option_found", "seeds": 20, "shots": {"played": 2, "alt": 5}, "goals": {"played": 0, "alt": 1},
                    "gain": {"mean": 0.042, "se": 0.011}},
    }
    names: list[str] = []
    async with httpx.AsyncClient(timeout=120) as http:
        card = await A2ACardResolver(http, server).get_agent_card()
        client = ClientFactory(ClientConfig(httpx_client=http, streaming=True)).create(card)
        msg = Message(role=Role.ROLE_USER, parts=[new_data_part(req, "application/json")], message_id=str(uuid.uuid4()))
        state, arts = None, {}
        async for item in client.send_message(SendMessageRequest(message=msg)):
            kind = item.WhichOneof("payload")
            if kind == "status_update":
                state = item.status_update.status.state
            elif kind == "artifact_update":
                a = item.artifact_update.artifact
                names.append(a.name)
                arts.setdefault(a.name, []).extend(get_data_parts(a.parts))
    assert state == TaskState.TASK_STATE_COMPLETED
    assert names == ["ask_stage"] * 3 + ["ask_reply"]
    assert [AskStage.model_validate(s).stage for s in arts["ask_stage"]] == ["analyst", "factcheck", "personalise"]
    assert AskReply.model_validate(arts["ask_reply"][0]).verified

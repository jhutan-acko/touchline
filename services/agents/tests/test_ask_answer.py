"""The Ask answer team: analyst on the re-simulation's numbers, rule fact-check (what-if claims too), fast personaliser."""

import re

import pytest

from touchline_agents.ask_answer import TOO_CLOSE, AskTeam, sentences_of
from touchline_agents.config import load_settings
from touchline_agents.contracts import AskAnswerRequest, AskStage, AskWhatIf
from touchline_agents.factchecker import check_whatif_claim
from touchline_agents.llm import STUB_RESPONDERS, make_client

from .conftest import MATCH_ID
from .factories import claim

AT = 3000


def team() -> AskTeam:
    settings = load_settings({}, env_file=None)
    return AskTeam(make_client(settings, "large"), make_client(settings, "fast"), settings)


def what_if(passer: str, receiver: str, verdict: str = "better_option_found") -> AskWhatIf:
    return AskWhatIf.model_validate({
        "intervention": {"kind": "pass_to", "player_id": passer, "receiver_id": receiver}, "fork_frame": AT - 40,
        "verdict": verdict, "seeds": 20, "shots": {"played": 2, "alt": 5}, "goals": {"played": 0, "alt": 1},
        "gain": {"mean": 0.042, "se": 0.011},
    })


async def request(stats, *, kind: str = "what_if", mode: str = "analyst", lang: str = "en", verdict: str = "better_option_found",
                  reason: str | None = None) -> AskAnswerRequest:
    info = await stats.roster()
    home = info["home"]["players"]
    passer, receiver = home[5]["id"], home[9]["id"]
    w = what_if(passer, receiver, verdict) if kind == "what_if" else None
    return AskAnswerRequest.model_validate({
        "kind": "ask_answer", "match_id": MATCH_ID, "mcp_url": "http://127.0.0.1:1/mcp", "at_frame": AT,
        "question": "What if he had passed to the striker?", "segment": {"mode": mode, "lang": lang, "club": None},
        "intent": {"kind": kind, "subject_id": None if kind == "unsupported" else passer, "fork_event_id": None,
                   "intervention": w.intervention.model_dump() if w else None, "reason": reason},
        "summary": {"match_id": MATCH_ID, "frame": AT, "clock": f"{AT // 600:02d}:{AT % 600 // 10:02d}", "ball_holder": passer,
                    "side_in_possession": "home",
                    "players": [{"id": p["id"], "name": p["name"], "side": "home", "role": "CM", "x": 0.0, "y": 0.0} for p in home[:11]],
                    "pass_options": [], "pressers": [], "recent": [], "missed_option": None},
        "what_if": w.model_dump() if w else None,
    })


async def answer(req, stats):
    stages: list[AskStage] = []

    async def emit(s: AskStage) -> None:
        stages.append(s)

    reply = await team().answer(req, stats, emit)
    return reply, stages


def text_of(reply) -> str:
    return f"{reply.headline} {reply.body} " + " ".join(c.value for c in reply.chips)


async def test_stages_in_order(stats):
    reply, stages = await answer(await request(stats), stats)
    assert [s.stage for s in stages] == ["analyst", "factcheck", "personalise"]
    assert all(s.status for s in stages)
    assert reply.verified and 1 <= len(reply.chips) <= 4
    assert {c.source for c in reply.chips} >= {"what_if", "stats"}


def test_whatif_claim_exact():
    w = what_if("p1", "p2")
    ok = claim("what_if", quote="5", subject="shots_alt", value=5)
    assert check_whatif_claim(ok, w)
    assert not check_whatif_claim(ok.model_copy(update={"value": 6}), w)
    assert not check_whatif_claim(ok, None)
    assert check_whatif_claim(claim("what_if", subject="gain", value=0.045), w)
    assert not check_whatif_claim(claim("what_if", subject="gain", value=0.05), w)
    assert not check_whatif_claim(claim("what_if", subject="shots_alt", value=5, metric_id="shot.xg"), w)


@pytest.fixture
def analyst_says(monkeypatch):
    """Replace the analyst stub's draft (a fixed answer for both attempts)."""

    def use(draft: dict) -> None:
        monkeypatch.setitem(STUB_RESPONDERS, "ask_analyst", lambda _payload, _results: draft)

    return use


async def test_wrong_number_is_dropped_and_unverified(stats, analyst_says):
    req = await request(stats, kind="explain")
    subject = req.intent.subject_id
    analyst_says({"headline": "He keeps running", "sentences": ["He has covered 12345 metres so far."],
                  "claims": [claim(quote="12345", metric_id="plyr.dist", subject=subject, value=12345, at_frame=AT).model_dump(mode="json")]})
    reply, _ = await answer(req, stats)
    assert "12345" not in text_of(reply) and "12,345" not in text_of(reply)
    assert reply.verified is False


async def test_never_cites_after_paused_frame(stats, analyst_says):
    req = await request(stats, kind="explain")
    subject = req.intent.subject_id
    later = AT + 25
    value = (await stats.metric("plyr.dist", subject, later))["value"]
    quote = f"{value:.0f}"
    analyst_says({"headline": "He keeps running", "sentences": [f"He has covered {quote} metres so far."],
                  "claims": [claim(quote=quote, metric_id="plyr.dist", subject=subject, value=value, at_frame=later).model_dump(mode="json")]})
    reply, _ = await answer(req, stats)
    assert quote not in re.sub(r"[.,]", "", text_of(reply))
    assert reply.verified is False and reply.chips == []


async def test_not_verified_is_too_close_to_call(stats):
    reply, _ = await answer(await request(stats, lang="es", verdict="not_verified"), stats)
    assert TOO_CLOSE["es"] in reply.headline
    assert "mejor" not in reply.headline.lower()


async def test_unsupported_passes_reason_through(stats):
    reason = "Solo puedo responder sobre el equipo con el balón."
    reply, stages = await answer(await request(stats, kind="unsupported", lang="es", reason=reason), stats)
    assert reply.headline == reason and reply.body == "" and reply.chips == [] and reply.verified is True
    assert [s.stage for s in stages] == ["analyst", "personalise"]


@pytest.mark.parametrize(("mode", "most"), [("casual", 1), ("analyst", 3)])
async def test_casual_is_short(stats, mode, most):
    reply, _ = await answer(await request(stats, mode=mode), stats)
    assert 1 <= len(sentences_of(reply.body)) <= most, reply.body


async def test_never_raises(stats):
    req = await request(stats)

    async def emit(_s: AskStage) -> None:
        raise RuntimeError("stream closed")

    reply = await team().answer(req, stats, emit)
    assert reply.verified is False and reply.chips == []

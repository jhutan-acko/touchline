import pytest

from touchline_agents.config import load_settings
from touchline_agents.llm import STUB_RESPONDERS, StubChatClient
from touchline_agents.narrator import Narrator, acceptable, template_draft

from .factories import NAMES, analysis, claim, moment

SETTINGS = load_settings({}, env_file=None)


def payload(m=None, a=None):
    m = m or moment()
    return {"moment": m.model_dump(mode="json"), "analysis": (a or analysis(m.moment_id)).model_dump(mode="json"), "names": NAMES}


def test_template_states_each_number_in_its_own_sentence():
    d = template_draft(payload())
    assert d.sentences[0] == "Goal for Home FC!" and d.lang == "en"
    assert d.sentences[1] == "Home FC worked the ball into a shooting position from open play."
    assert d.sentences[2:] == ["Expected goals for the chance: 0.12.", "The score is now 1-0."]
    assert [(c.sentence, c.quote) for c in d.claims] == [(2, "0.12"), (3, "1-0")]
    assert acceptable(d, d.moment_id)


@pytest.mark.parametrize(("type_", "head"), [
    ("costly_error", "Costly error by Ada Striker"), ("momentum_swing", "Momentum swings to Home FC"), ("chaos_spike", "End-to-end football"),
])
def test_headlines_name_the_team_or_player(type_, head):
    m = moment(type_, player="h9")
    assert template_draft(payload(m, analysis(m.moment_id, claims=[]))).sentences[0] == head


def test_rejects_drafts_that_misquote_or_overrun():
    d = template_draft(payload())
    assert not acceptable(d.model_copy(update={"lang": "es"}), d.moment_id)
    assert not acceptable(d.model_copy(update={"sentences": ["A headline that goes on and on and on for far too many words"] + d.sentences[1:]}), d.moment_id)
    wrong = d.model_copy(update={"claims": [claim(sentence=1, quote="0.12", metric_id="shot.xg", value=0.12)]})
    assert not acceptable(wrong, d.moment_id)  # sentence 1 does not say 0.12
    assert not acceptable(d.model_copy(update={"claims": [claim(sentence=9, quote="")]}), d.moment_id)


async def test_narrates_through_the_model_and_passes_feedback():
    seen = []
    original = STUB_RESPONDERS["narrate"]
    STUB_RESPONDERS["narrate"] = lambda p, r: (seen.append(p), original(p, r))[1]
    try:
        m = moment()
        out = await Narrator(StubChatClient(), SETTINGS).narrate(m, analysis(m.moment_id), NAMES, feedback=["sentence 2: 0.15 is not 0.12"])
    finally:
        STUB_RESPONDERS["narrate"] = original
    assert not out.fallback and out.draft == template_draft(payload(m))
    assert seen[0]["feedback"] == ["sentence 2: 0.15 is not 0.12"]


async def test_falls_back_to_the_template():
    m = moment()
    out = await Narrator(StubChatClient("slow", slow_s=5), load_settings({"TOUCHLINE_TIMEOUT_SCALE": "0.05"}, env_file=None)).narrate(m, analysis(m.moment_id), NAMES)
    assert out.fallback and out.reason == "timeout" and out.draft == template_draft(payload(m))


@pytest.mark.live
async def test_openai_narrates_with_declared_numbers():
    from touchline_agents.llm import make_client

    live = load_settings({"TOUCHLINE_LLM": "openai", "TOUCHLINE_TIMEOUT_SCALE": "10"})
    m = moment()
    out = await Narrator(make_client(live, "small"), live).narrate(m, analysis(m.moment_id), NAMES)
    print(out.ms, out.draft.model_dump_json(indent=1))
    assert not out.fallback, out.reason

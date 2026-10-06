import itertools

import pytest

from touchline_agents.config import load_settings
from touchline_agents.contracts import Draft, Segment
from touchline_agents.detector import PRIORITY
from touchline_agents.llm import STUB_RESPONDERS, StubChatClient
from touchline_agents.personalizer import Personalizer, Story, Variant, check_variant, make_cue, template_variant

from .factories import NAMES, claim, moment

SETTINGS = load_settings({}, env_file=None)
CLAIMS = [claim(quote="0.12", metric_id="shot.xg", value=0.1234, event_id="m-e10"), claim("score", quote="1-0"), claim(quote="58%", metric_id="team.mom", subject="home-fc", value=0.58)]
DRAFT = Draft(moment_id="mo-goal-3000", lang="en", sentences=["Goal for Home FC!", "A tidy finish.", "Expected goals for the chance: 0.12.", "The score is now 1-0."],
              claims=[c.model_copy(update={"sentence": i + 2}) for i, c in enumerate(CLAIMS[:2])] + [CLAIMS[2].model_copy(update={"sentence": 1})])


def story(type_: str = "goal", cause: str = "low-probability chance") -> Story:
    return Story.of_moment(moment(type_, player="h9"), cause, NAMES)


def payload(seg: Segment, type_: str = "goal", cause: str = "low-probability chance"):
    s = story(type_, cause)
    return {"segment": seg.model_dump(mode="json"), "story": {"template": s.template, "team_id": s.team_id, "player_id": s.player_id, "clock": s.clock},
            "headline": s.headlines[seg.lang], "context": s.contexts[seg.lang], "names": NAMES, "draft": DRAFT.sentences, "claims": [c.model_dump(mode="json") for c in DRAFT.claims]}


SEGMENTS = [Segment(mode=m, lang=l, club=c) for m, l, c in itertools.product(["casual", "analyst"], ["en", "es", "hi"], [None, "home-fc", "away-fc"])]


@pytest.mark.parametrize("type_", sorted(PRIORITY))
def test_template_variants_always_pass_the_check(type_):
    for seg in SEGMENTS:
        p = payload(seg, type_)
        v = template_variant(p)
        assert check_variant(v, p, others=["Cy Outsider"]) == [], (type_, seg)


def test_casual_is_short_and_framed_analyst_is_deep():
    casual = template_variant(payload(Segment(mode="casual", lang="es", club="away-fc")))
    analyst = template_variant(payload(Segment(mode="analyst", lang="es", club=None)))
    assert casual.headline == "¡Gol de Home FC!" and casual.body.startswith("Malas noticias para Away Town.") and len(casual.numbers) == 1
    assert len(analyst.numbers) == 3 and "0,12" in analyst.body and "58%" in analyst.body
    hindi = template_variant(payload(Segment(mode="analyst", lang="hi", club=None)))
    assert hindi.headline == "Home FC का गोल!" and "स्कोर: 1-0।" in hindi.body


@pytest.mark.parametrize(("variant", "problem"), [
    (Variant(headline="Goal!", body="It was 0.12 and 58%.", numbers=[{"claim": 0, "quote": "0.12"}, {"claim": 2, "quote": "58%"}]), "2 numbers in a casual variant"),
    (Variant(headline="Goal!", body="Worth 0.30.", numbers=[{"claim": 0, "quote": "0.30"}]), "does not round claim 0"),
    (Variant(headline="Goal!", body="They had 9 shots.", numbers=[]), '"9" is not one of the verified claims'),
    (Variant(headline="Goal!", body="Now 2-0.", numbers=[{"claim": 1, "quote": "2-0"}]), "is not the score"),
    (Variant(headline="Goal!", body="Cy Outsider watched.", numbers=[]), "who was not involved"),
    (Variant(headline="Goal!", body="Worth 0.12.", numbers=[{"claim": 7, "quote": "0.12"}]), "no claim 7"),
])
def test_the_check_catches_bad_variants(variant, problem):
    p = payload(Segment(mode="casual", lang="en", club=None))
    assert any(problem in x for x in check_variant(variant, p, ["Cy Outsider"])), check_variant(variant, p, ["Cy Outsider"])


@pytest.mark.parametrize("lang", ["en", "es", "hi"])
def test_analyst_variants_go_deeper_than_casual_even_with_one_number(lang):
    one = [DRAFT.claims[2].model_dump(mode="json")]
    casual = template_variant({**payload(Segment(mode="casual", lang=lang, club=None), "card", "booking"), "claims": one})
    analyst = template_variant({**payload(Segment(mode="analyst", lang=lang, club=None), "card", "booking"), "claims": one})
    assert len(analyst.body.split()) > len(casual.body.split())


def test_hindi_must_be_devanagari():
    p = payload(Segment(mode="analyst", lang="hi", club=None))
    assert "Hindi text must be in Devanagari" in check_variant(Variant(headline="Goal for Home FC", body="Nice.", numbers=[]), p, [])


def test_cue_follows_the_contract():
    seg = Segment(mode="analyst", lang="en", club=None)
    m = moment("goal")
    v = template_variant(payload(seg))
    cue = make_cue(Story.of_moment(m, "low-probability chance", NAMES), seg, v, DRAFT.claims, ["m-e10", "m-e11"])
    assert cue.cue_id == f"{m.moment_id}-analyst.en.neutral" and cue.schema_ == "touchline.cue/1"
    assert cue.display.slot == "side_panel" and cue.display.ttl_ms == 12000 and cue.verified
    assert cue.data == {"shot.xg": 0.1234, "score.home": 1, "score.away": 0, "team.mom": 0.58}
    assert cue.evidence[0] == "m-e10" and cue.anchor.clock == m.match_clock[:5]


async def test_fans_out_over_segments_through_the_model():
    out = await Personalizer(StubChatClient(), SETTINGS).fan_out(story(), DRAFT, NAMES, SEGMENTS[:6], [], [])
    assert [p.cue.segment for p in out] == SEGMENTS[:6] and not any(p.fallback for p in out)
    assert len({p.cue.cue_id for p in out}) == 6


async def test_a_variant_that_fails_the_check_becomes_the_template():
    original = STUB_RESPONDERS["personalize"]
    STUB_RESPONDERS["personalize"] = lambda p, r: {"headline": "Goal!", "body": "They had 9 shots and 0.12 xG.", "numbers": [{"claim": 0, "quote": "0.12"}]}
    try:
        seg = Segment(mode="casual", lang="en", club=None)
        out = await Personalizer(StubChatClient(), SETTINGS).personalize(story(), DRAFT, NAMES, seg, [], [])
    finally:
        STUB_RESPONDERS["personalize"] = original
    assert out.fallback and any('"9"' in r for r in out.reasons)
    assert out.cue.text.headline == "Goal for Home FC!"


@pytest.mark.live
@pytest.mark.parametrize("seg", [Segment(mode="casual", lang="es", club="away-fc"), Segment(mode="analyst", lang="hi", club=None)])
async def test_openai_writes_native_variants_that_pass_the_check(seg):
    from touchline_agents.llm import make_client

    live = load_settings({"TOUCHLINE_LLM": "openai", "TOUCHLINE_TIMEOUT_SCALE": "10"})
    out = await Personalizer(make_client(live, "small"), live).personalize(story(), DRAFT, NAMES, seg, ["Cy Outsider"], [])
    print(round(out.ms), out.cue.text.model_dump(), out.reasons)
    assert not out.fallback, out.reasons


@pytest.mark.parametrize("lang", ["es", "hi"])
def test_a_variant_that_copies_the_english_draft_is_not_spanish_or_hindi(lang):
    p = payload(Segment(mode="analyst", lang=lang, club=None))
    copied = Variant(headline="गोल" if lang == "hi" else "Gol", body="A tidy finish. Expected goals for the chance: 0.12.", numbers=[{"claim": 0, "quote": "0.12"}])
    assert any("copies the English draft" in x for x in check_variant(copied, p, []))

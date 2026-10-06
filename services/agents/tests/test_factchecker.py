"""The Fact-Checker on drafts about the test match: a true draft passes, seeded hallucinations are caught (spec §7)."""

import pytest

from touchline_agents.analyst import evidence, template_analysis
from touchline_agents.config import load_settings
from touchline_agents.contracts import Draft, Signal
from touchline_agents.detector import DetectorState, build_moments
from touchline_agents.factchecker import FactChecker, feedback, published
from touchline_agents.llm import STUB_RESPONDERS, StubChatClient
from touchline_agents.narrator import template_draft

from .factories import claim

SETTINGS = load_settings({}, env_file=None)


@pytest.fixture
async def case(stats):
    signals = [Signal.model_validate(s) for s in await stats.signals(limit=500)]
    lead = next(s for s in signals if s.type == "goal")
    m = build_moments([lead.id], signals, DetectorState(fps=10), "rules")[0]
    pack = await evidence(stats, m, signals)
    a = template_analysis(pack)
    d = template_draft({"moment": m.model_dump(mode="json"), "analysis": a.model_dump(mode="json"), "names": pack["names"]})
    return m, pack, d


async def check(stats, case, draft: Draft, attempt: int = 0, client=None):
    m, pack, _ = case
    fc = FactChecker(client or StubChatClient(), SETTINGS)
    return await fc.check(stats, draft, latest=m.frame_to, clock=m.match_clock, involved=set(pack["names"]), attempt=attempt)


def with_sentence(d: Draft, text: str, *claims) -> Draft:
    i = len(d.sentences)
    return d.model_copy(update={"sentences": [*d.sentences, text], "claims": [*d.claims, *(c.model_copy(update={"sentence": i}) for c in claims)]})


def failing(result) -> dict[int, list[str]]:
    return {s.index: s.reasons for s in result.verdict.sentences if not s.verified}


async def test_a_true_draft_passes(stats, case):
    _, _, d = case
    r = await check(stats, case, d)
    assert r.verdict.status == "pass", failing(r)
    assert r.verdict.claims_checked == r.verdict.claims_verified == len(d.claims) >= 2


async def test_seeded_hallucinations_are_caught(stats, case):
    m, pack, d = case
    xg = next(c for c in d.claims if c.metric_id == "shot.xg")
    team = m.team_id
    at = m.frame_to
    press = (await stats.metric("team.press", team, at))["value"]
    passes = [e for e in pack["events"] if e["type"] == "pass"]
    decided = [(e, await stats.decision(e["id"], at)) for e in passes[:12]]
    best_pass = next(e for e, dec in decided if dec["chosen_rank"] == 1)
    worse_pass, worse = next((e, dec) for e, dec in decided if dec["chosen_rank"] not in (None, 1))
    wrong_receiver = next(o["receiver_id"] for o in worse["options"] if o["receiver_id"] != worse["best_receiver_id"])
    roster = await stats.roster()
    outsider = next(p for side in ("home", "away") for p in roster[side]["players"] if p["id"] not in pack["names"])
    lies = {
        "wrong value": with_sentence(d, f"That chance was worth {xg.value + 0.2:.2f}.", xg.model_copy(update={"quote": f"{xg.value + 0.2:.2f}", "value": xg.value + 0.2})),
        "rounding": with_sentence(d, "That chance was worth 0.50.", xg.model_copy(update={"quote": "0.50"})),
        "undeclared": with_sentence(d, "They have had 9 shots."),
        "score": with_sentence(d, "It is 7-0 now.", claim("score", quote="7-0", at_frame=at)),
        "future": with_sentence(d, f"Pressure index {press:.2f}.", claim(quote=f"{press:.2f}", metric_id="team.press", subject=team, value=press, at_frame=at + 600)),
        "no event": with_sentence(d, "A clever pass started it.", claim("event", event_id="agents-test-e999999", at_frame=at)),
        "wrong option": with_sentence(d, "A better pass was on.", claim("better_option", event_id=worse_pass["id"], receiver_id=wrong_receiver, at_frame=at)),
        "best already": with_sentence(d, "A better pass was on.", claim("better_option", event_id=best_pass["id"], receiver_id="p-x", at_frame=at)),
        "outsider": with_sentence(d, f"{outsider['name']} was watching."),
        "superlative": with_sentence(d, "The fastest move of the match."),
    }
    for name, draft in lies.items():
        r = await check(stats, case, draft)
        bad = failing(r)
        assert list(bad) == [len(draft.sentences) - 1], (name, bad)
        assert r.verdict.status == "retry", name


async def test_retry_then_drop(stats, case):
    _, _, d = case
    lie = with_sentence(d, "They have had 9 shots.")
    first = await check(stats, case, lie, attempt=0)
    assert first.verdict.status == "retry" and feedback(first.verdict) == [f'sentence {len(d.sentences)}: "9" is not declared as a claim']
    second = await check(stats, case, lie, attempt=1)
    assert second.verdict.status == "drop"
    assert published(second.draft, second.verdict, "Goal!").sentences == d.sentences


def test_a_failed_headline_is_replaced_and_claims_renumbered():
    d = Draft(moment_id="mo", lang="en", sentences=["Home win 9-0", "Body one.", "xG 0.12."], claims=[claim(sentence=2, quote="0.12", metric_id="shot.xg", value=0.12, event_id="e")])
    from touchline_agents.contracts import SentenceCheck, Verdict

    v = Verdict(moment_id="mo", status="drop", sentences=[SentenceCheck(index=0, verified=False, reasons=["x"]), SentenceCheck(index=1, verified=True, reasons=[]),
                SentenceCheck(index=2, verified=True, reasons=[])], claims_checked=1, claims_verified=1, undeclared=1)
    p = published(d, v, "Goal for Home")
    assert p.sentences == ["Goal for Home", "Body one.", "xG 0.12."] and p.claims[0].sentence == 2


async def test_the_model_extracts_undeclared_numbers(stats, case):
    _, _, d = case
    xg = next(c for c in d.claims if c.metric_id == "shot.xg")
    bare = with_sentence(d, f"The chance was worth {xg.quote} expected goals.")
    original = STUB_RESPONDERS["extract"]
    STUB_RESPONDERS["extract"] = lambda p, r: {"claims": [xg.model_copy(update={"sentence": p["index"]}).model_dump(mode="json")]}
    try:
        r = await check(stats, case, bare)
    finally:
        STUB_RESPONDERS["extract"] = original
    assert r.verdict.status == "pass", failing(r)
    assert len(r.extracted) == 1 and r.draft.claims[-1].sentence == len(bare.sentences) - 1


async def test_an_event_claim_stamped_at_the_strike_is_found_as_of_the_moment(stats, case):
    # A shot is stamped when it resolves (the goal frame), after the frame it was struck at; a claim about it made
    # "as of" the strike is still about an event inside the moment.
    m, _, d = case
    xg = next(c for c in d.claims if c.metric_id == "shot.xg")
    early = d.model_copy(update={"claims": [c.model_copy(update={"at_frame": m.frame_from}) if c is xg else c for c in d.claims]})
    r = await check(stats, case, early)
    assert r.verdict.status == "pass", failing(r)

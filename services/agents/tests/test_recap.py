import pytest

from touchline_agents.config import load_settings
from touchline_agents.contracts import Recap, Segment, Signal
from touchline_agents.detector import DetectorState, build_moments, candidates, rule_selection
from touchline_agents.factchecker import FactChecker
from touchline_agents.llm import StubChatClient
from touchline_agents.personalizer import Personalizer
from touchline_agents.recap import RecapProducer, Told, acceptable, recap_pack, recap_story, template_recap

SETTINGS = load_settings({}, env_file=None)


@pytest.fixture
async def whistle(stats):
    """(frame of the half-time whistle, frame of the full-time whistle, moments told by then)."""
    ends = [e["frame_id"] for e in await stats.events(0, 10**7, types=["period_end"])]
    signals = [Signal.model_validate(s) for s in await stats.signals(limit=500)]
    st = DetectorState(fps=10)
    told = [Told(m, "cause", "headline") for m in build_moments(rule_selection(candidates(signals, st)), signals, st, "rules")]
    return ends[0], ends[-1], told


async def test_stats_only_recap_passes_the_fact_checker(stats, whistle):
    ht, ft, told = whistle
    for kind, at in (("half_time", ht), ("full_time", ft)):
        pack = await recap_pack(stats, kind, at, told)
        r = template_recap(pack)
        assert acceptable(r, pack)
        assert r.sentences[0].startswith("Half-time" if kind == "half_time" else "Full-time")
        assert all(tp in {m["id"] for m in pack["moments"]} for tp in r.turning_points) and len(r.turning_points) <= 3
        assert (r.player_of_match is None) == (kind == "half_time")
        from touchline_agents.contracts import Draft

        check = await FactChecker(StubChatClient(), SETTINGS).check(
            stats, Draft(moment_id=f"r-{kind}", lang="en", sentences=r.sentences, claims=r.claims), latest=at, clock=pack["clock"], involved=set(pack["names"]), attempt=0)
        assert check.verdict.status == "pass", [s.reasons for s in check.verdict.sentences]


async def test_half_time_turning_points_come_from_the_first_half(stats, whistle):
    ht, _, told = whistle
    pack = await recap_pack(stats, "half_time", ht, told)
    frames = {t.moment.moment_id: t.moment.frame_id for t in told}
    assert all(frames[m["id"]] <= ht for m in pack["moments"])


async def test_produces_through_the_model_and_falls_back(stats, whistle):
    _, ft, told = whistle
    ok = await RecapProducer(StubChatClient(), SETTINGS).produce(stats, "full_time", ft, told)
    assert not ok.fallback and ok.output == template_recap(ok.pack)
    bad = await RecapProducer(StubChatClient("error"), SETTINGS).produce(stats, "full_time", ft, told, pack=ok.pack)
    assert bad.fallback and bad.output == ok.output


async def test_recap_cards_in_every_language(stats, whistle):
    _, ft, told = whistle
    produced = await RecapProducer(StubChatClient(), SETTINGS).produce(stats, "full_time", ft, told)
    out = produced.output
    recap = Recap(recap_id="agents-test-recap-full_time", match_id="agents-test", kind="full_time", at_frame=ft, sentences=out.sentences, claims=out.claims,
                  turning_points=out.turning_points, player_of_match=out.player_of_match, verified=True)
    story = recap_story(recap, produced.pack)
    segs = [Segment(mode=m, lang=l, club=None) for m in ("casual", "analyst") for l in ("en", "es", "hi")]
    cards = await Personalizer(StubChatClient(), SETTINGS).fan_out(story, produced.draft(recap.recap_id), produced.pack["names"], segs, [], [])
    assert all(c.cue.display.slot == "recap_card" and c.cue.moment_id == recap.recap_id and not c.fallback for c in cards)
    assert cards[2].cue.text.headline.startswith("फ़ुल-टाइम")
    assert cards[0].cue.data.keys() == {"score.home", "score.away"}  # casual: the score, nothing else


@pytest.mark.live
async def test_openai_recap_is_grounded(stats, whistle):
    from touchline_agents.llm import make_client

    _, ft, told = whistle
    live = load_settings({"TOUCHLINE_LLM": "openai", "TOUCHLINE_TIMEOUT_SCALE": "5"})
    out = await RecapProducer(make_client(live, "large"), live).produce(stats, "full_time", ft, told)
    assert not out.fallback, out.reason
    check = await FactChecker(make_client(live, "small"), live).check(stats, out.draft("r"), latest=ft, clock=out.pack["clock"], involved=set(out.pack["names"]), attempt=0)
    print(round(out.ms), out.output.sentences, check.verdict.status, [s.reasons for s in check.verdict.sentences if s.reasons])
    assert check.verdict.claims_verified == check.verdict.claims_checked

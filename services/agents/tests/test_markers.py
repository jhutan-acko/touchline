from dataclasses import replace

from touchline_agents.contracts import Segment, Signal
from touchline_agents.markers import marker_cue, passes_in
from touchline_agents.personalizer import Story, Variant, make_cue

from .factories import NAMES, claim, moment, signal

CASUAL = Segment(mode="casual", lang="en", club=None)
ANALYST = Segment(mode="analyst", lang="en", club=None)


def story(**kw) -> Story:
    return replace(Story.of_moment(moment("goal", player="h9"), "low-probability chance", NAMES), **kw)


def base(s: Story, seg: Segment = ANALYST, priority: int = 1, verified: bool = True):
    cue = make_cue(s, seg, Variant(headline="Goal!", body="A tidy finish.", numbers=[]), [], [])
    return cue.model_copy(update={"display": cue.display.model_copy(update={"priority": priority}), "verified": verified})


def test_better_option_gives_ghost_at_receiver():
    s = story(claims=(claim("better_option", event_id="m-e10", receiver_id="h7"),), positions={"h7": (31.5, -4.0)})
    b = base(s)
    m = marker_cue(s, ANALYST, b)
    assert m is not None and m.display.slot == "pitch_marker" and m.display.template == "ghost" and m.text is None
    assert m.data == {"at:h7": 1.0, "x": 31.5, "y": -4.0}
    assert (m.cue_id, m.moment_id, m.anchor, m.segment, m.display.ttl_ms) == (b.cue_id + ":m", b.moment_id, b.anchor, b.segment, b.display.ttl_ms)
    # Without a known position the ghost has only its anchor.
    assert marker_cue(replace(s, positions={}), ANALYST, b).data == {"at:h7": 1.0}


def test_pressure_gives_ring_with_count():
    s = story(claims=(claim(metric_id="team.press", subject="home-fc", value=3.2),))
    m = marker_cue(s, ANALYST, base(s))
    assert m.display.template == "pressure_ring" and m.data == {"count": 3.0, "at:h9": 1.0}
    sig = signal("pressure_shift", 3000, team="away-fc").model_copy(update={"metric": "team.press", "value": 2.0, "data": {"pressers": 4.0}})
    t = story(player_id=None, signals=(sig,))
    assert marker_cue(t, ANALYST, base(t)).data == {"count": 4.0, "at:away-fc": 1.0}
    # A better option outranks pressure, and pressure outranks a pass arc.
    both = replace(s, claims=(*s.claims, claim("better_option", receiver_id="h7")), passes=(("h9", "h7"),))
    assert marker_cue(both, ANALYST, base(both)).display.template == "ghost"
    assert marker_cue(replace(s, passes=(("h9", "h7"),)), ANALYST, base(s)).display.template == "pressure_ring"


def test_ring_has_no_count_without_a_presser_count():
    # team.press is a 0-1 share, not how many press: without a `pressers` datum the ring carries no number.
    s = story(claims=(claim(metric_id="team.press", subject="home-fc", value=0.71),))
    assert marker_cue(s, ANALYST, base(s)).data == {"at:h9": 1.0}
    sig = signal("pressure_shift", 3000, team="away-fc").model_copy(update={"metric": "team.press", "value": 0.64, "data": {}})
    t = story(player_id=None, signals=(sig,))
    assert marker_cue(t, ANALYST, base(t)).data == {"at:away-fc": 1.0}


def test_pass_arc_and_none():
    s = story(passes=(("h8", "h9"), ("h9", "h7")))
    assert marker_cue(s, ANALYST, base(s)).data == {"from:h9": 1.0, "to:h7": 1.0}
    assert marker_cue(story(), ANALYST, base(story())) is None


def test_casual_only_priority_one():
    s = story(passes=(("h9", "h7"),))
    assert marker_cue(s, CASUAL, base(s, CASUAL, priority=1)) is not None
    assert marker_cue(s, CASUAL, base(s, CASUAL, priority=2)) is None
    assert marker_cue(s, CASUAL, base(s, CASUAL, priority=3)) is None
    assert all(marker_cue(s, ANALYST, base(s, ANALYST, priority=p)) is not None for p in (1, 2, 3))


def test_marker_copies_verified():
    s = story(passes=(("h9", "h7"),))
    assert marker_cue(s, ANALYST, base(s, verified=False)).verified is False
    assert marker_cue(s, ANALYST, base(s, verified=True)).verified is True


def test_passes_in_takes_receivers_up_to_the_frame_preferring_the_team():
    def ev(frame, team, player, receiver):
        return {"type": "pass", "frame_id": frame, "team_id": team, "player_id": player, "qualifiers": {"receiver_id": receiver} if receiver else {}}
    events = [ev(10, "away-fc", "a1", "a2"), ev(20, "home-fc", "h1", "h2"), ev(30, "home-fc", "h2", None), ev(99, "home-fc", "h3", "h4")]
    assert passes_in(events, 50, "home-fc") == (("h1", "h2"),)
    assert passes_in(events, 50, "none-fc") == (("a1", "a2"), ("h1", "h2"))

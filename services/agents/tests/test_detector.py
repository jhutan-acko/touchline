from touchline_agents.config import load_settings
from touchline_agents.detector import (
    MAX_PER_BATCH, DetectorState, MomentDetector, build_moments, candidates, enforce, rule_selection,
)
from touchline_agents.llm import StubChatClient

from .factories import signal

SETTINGS = load_settings({}, env_file=None)


def state() -> DetectorState:
    return DetectorState(fps=10)


def test_goals_and_red_cards_always_promoted_even_past_the_cap():
    sigs = [signal("goal", 100, salience=1), signal("goal", 400, team="away-fc", salience=1), signal("card", 500, salience=0.9, red=1),
            signal("pressure_shift", 600, salience=0.85)]
    ids = rule_selection(candidates(sigs, state()))
    assert ids[:3] == ["m-goal-100-home-fc", "m-goal-400-away-fc", "m-card-500-home-fc"] and len(ids) == 3


def test_yellow_cards_and_low_salience_wait_for_the_rules_threshold():
    sigs = [signal("card", 100, salience=0.5, red=0), signal("speed_alert", 200, salience=0.28), signal("distance_milestone", 300, salience=0.15)]
    c = candidates(sigs, state())
    assert [s.type for s in c] == ["card", "speed_alert"]  # 0.15 is below even the model's floor
    assert rule_selection(c) == ["m-card-100-home-fc"]


def test_cooldown_holds_back_the_same_type_for_the_same_team():
    st = state()
    build_moments(["m-pressure_shift-3000-home-fc"], [signal("pressure_shift", 3000)], st, "rules")
    later = [signal("pressure_shift", 4000), signal("pressure_shift", 4000, team="away-fc"), signal("pressure_shift", 6100)]
    assert [s.id for s in candidates(later, st)] == ["m-pressure_shift-4000-away-fc", "m-pressure_shift-6100-home-fc"]


def test_signals_of_the_same_play_merge_into_one_moment():
    st = state()
    sigs = [signal("goal", 1000, salience=1, span=30), signal("big_chance", 1000, salience=0.7), signal("speed_alert", 980, salience=0.4),
            signal("big_chance", 1000, team="away-fc", salience=0.7)]
    sigs[3] = sigs[3].model_copy(update={"id": "m-big_chance-1000-away"})
    [m] = build_moments(["m-goal-1000-home-fc"], sigs, st, "rules")
    assert m.type == "goal" and m.priority == 1 and set(m.signal_ids) == {"m-goal-1000-home-fc", "m-big_chance-1000-home-fc", "m-speed_alert-980-home-fc"}
    assert (m.frame_from, m.frame_to) == (970, 1000)
    assert st.moments == [m] and st.last[("big_chance", "home-fc")] == 1000


def test_model_choices_are_held_to_the_rules():
    c = candidates([signal("goal", 10, salience=1), signal("momentum_swing", 20, salience=0.4), signal("speed_alert", 30, salience=0.3)], state())
    assert enforce(["made-up", "m-speed_alert-30-home-fc", "m-momentum_swing-20-home-fc"], c) == ["m-goal-10-home-fc", "m-speed_alert-30-home-fc"]
    assert len(enforce([s.id for s in c], c)) == MAX_PER_BATCH


async def test_detects_through_the_model():
    d = MomentDetector(StubChatClient(), SETTINGS)
    out = await d.detect([signal("momentum_swing", 3500, salience=0.8), signal("speed_alert", 3600, salience=0.3)], st := state())
    assert not out.fallback and [m.type for m in out.moments] == ["momentum_swing"] and out.moments[0].source == "model"
    assert st.moments == out.moments


async def test_falls_back_to_the_rules_when_the_model_fails():
    d = MomentDetector(StubChatClient("error"), SETTINGS)
    out = await d.detect([signal("goal", 100, salience=1)], state())
    assert out.fallback and out.reason == "RuntimeError" and out.moments[0].source == "rules"


async def test_nothing_to_rank_skips_the_model():
    client = StubChatClient()
    out = await MomentDetector(client, SETTINGS).detect([signal("distance_milestone", 100, salience=0.15)], state())
    assert out.moments == [] and client.calls == []

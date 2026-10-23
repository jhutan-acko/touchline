from touchline_agents.config import load_settings
from touchline_agents.contracts import AskIntent, AskIntentRequest, FrameSummary
from touchline_agents.llm import StubChatClient
from touchline_agents.question import QuestionAgent, rule_intent, validate_intent

PLAYERS = [
    {"id": "p-h-08", "name": "Marek Okafor", "side": "home", "role": "CM", "x": 12.5, "y": -3.0},
    {"id": "p-h-09", "name": "Teo Diallo", "side": "home", "role": "ST", "x": 30.0, "y": 4.5},
    {"id": "p-h-05", "name": "Ivan Kemp", "side": "home", "role": "CB", "x": -5.0, "y": 0.0},
    {"id": "p-a-04", "name": "Luis Brandt", "side": "away", "role": "CB", "x": 28.0, "y": 2.0},
]


def summary(**over) -> FrameSummary:
    base = {
        "match_id": "m1", "frame": 4000, "clock": "02:40", "ball_holder": "p-h-08", "side_in_possession": "home",
        "players": PLAYERS, "pass_options": [], "pressers": [],
        "recent": [{"event_id": "e-1", "frame": 3900, "type": "pass", "player_id": "p-h-08", "receiver_id": "p-h-05"}],
        "missed_option": None,
    }
    return FrameSummary.model_validate({**base, **over})


def req(q: str, lang="en", **over) -> AskIntentRequest:
    return AskIntentRequest(kind="ask_intent", question=q, lang=lang, summary=summary(**over))


def test_rule_intent_what_if_pass_en():
    i = rule_intent(req("What if Okafor passed to Diallo?"))
    assert i.kind == "what_if" and i.intervention.kind == "pass_to"
    assert (i.intervention.player_id, i.intervention.receiver_id) == ("p-h-08", "p-h-09")
    assert i.fork_event_id == "e-1"


def test_rule_intent_hindi():
    i = rule_intent(req("अगर Okafor ने Diallo को पास दिया होता?", "hi"))
    assert i.kind == "what_if" and (i.intervention.player_id, i.intervention.receiver_id) == ("p-h-08", "p-h-09")


def test_unknown_player_is_unsupported():
    i = rule_intent(req("What if Smith passed to Diallo?"))
    assert i.kind == "unsupported" and i.reason


def test_receiver_on_other_side_is_unsupported():
    i = rule_intent(req("What if Okafor passed to Brandt?"))
    assert i.kind == "unsupported" and i.reason
    bad = AskIntent.model_validate({"kind": "what_if", "subject_id": "p-h-08", "fork_event_id": None, "reason": None,
                                    "intervention": {"kind": "pass_to", "player_id": "p-h-08", "receiver_id": "p-h-08"}})
    assert validate_intent(bad, summary(), "en").kind == "unsupported"


def test_shot_what_if_is_unsupported_with_reason_in_lang():
    i = rule_intent(req("¿Y si hubiera tirado?", "es"))
    assert i.kind == "unsupported" and "pase" in i.reason


def test_unknown_fork_event_is_unsupported():
    bad = AskIntent.model_validate({"kind": "what_if", "subject_id": "p-h-08", "fork_event_id": "e-999", "reason": None,
                                    "intervention": {"kind": "pass_to", "player_id": "p-h-08", "receiver_id": "p-h-09"}})
    assert validate_intent(bad, summary(), "en").kind == "unsupported"


def test_why_didnt_uses_the_missed_option():
    mo = {"event_id": "e-1", "passer_id": "p-h-08", "played_to": "p-h-05", "better_to": "p-h-09"}
    i = rule_intent(req("Why didn't Okafor pass to Diallo?", missed_option=mo))
    assert i.kind == "what_if" and i.fork_event_id == "e-1" and i.intervention.receiver_id == "p-h-09"


def test_explain_defaults_to_ball_holder_and_dead_ball_is_unsupported():
    assert rule_intent(req("Why is he under pressure?")).subject_id == "p-h-08"
    assert rule_intent(req("Why is he under pressure?", ball_holder=None)).kind == "unsupported"


async def test_parse_falls_back_on_garbage():
    s = load_settings({}, env_file=None)
    r = req("What if Okafor passed to Diallo?")
    assert await QuestionAgent(StubChatClient("garbage"), s).parse(r) == rule_intent(r)
    assert await QuestionAgent(StubChatClient("ok"), s).parse(r) == rule_intent(r)


def test_possessive_names_are_not_unknown_players():
    for q in ("Why didn't Okafor's pass go to Diallo?", "What if Okafor's pass went to Diallo?"):
        i = rule_intent(req(q))
        assert i.kind == "what_if" and (i.intervention.player_id, i.intervention.receiver_id) == ("p-h-08", "p-h-09"), q


def test_invalid_id_reason_does_not_show_the_id():
    bad = AskIntent.model_validate({"kind": "what_if", "subject_id": "p-x-99", "fork_event_id": None, "reason": None,
                                    "intervention": {"kind": "pass_to", "player_id": "p-x-99", "receiver_id": "p-h-09"}})
    i = validate_intent(bad, summary(), "en")
    assert i.kind == "unsupported" and i.reason and "p-x-99" not in i.reason


def test_passer_must_be_on_the_side_in_possession():
    bad = AskIntent.model_validate({"kind": "what_if", "subject_id": "p-a-04", "fork_event_id": None, "reason": None,
                                    "intervention": {"kind": "pass_to", "player_id": "p-a-04", "receiver_id": "p-h-09"}})
    assert validate_intent(bad, summary(), "en").kind == "unsupported"
    away = AskIntent.model_validate({"kind": "what_if", "subject_id": "p-h-08", "fork_event_id": None, "reason": None,
                                     "intervention": {"kind": "pass_to", "player_id": "p-h-08", "receiver_id": "p-h-09"}})
    assert validate_intent(away, summary(side_in_possession="away"), "en").kind == "unsupported"
    assert validate_intent(away, summary(side_in_possession=None), "en").kind == "what_if"

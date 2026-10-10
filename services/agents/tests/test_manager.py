import json
from pathlib import Path

import pytest

from touchline_agents.config import SettingsError, load_settings
from touchline_agents.contracts import ManageRequest, parse_request
from touchline_agents.llm import STUB_RESPONDERS, StubChatClient
from touchline_agents.manager import ChooseOut, Manager, ProposeOut, acceptable_proposal, choice_problem, unknown_numbers

SETTINGS = load_settings({}, env_file=None)
FIXTURES = Path(__file__).resolve().parents[3] / "packages/schema/fixtures/agents/valid"


def request(name: str) -> ManageRequest:
    req = parse_request(json.loads((FIXTURES / name).read_text())["value"])
    assert isinstance(req, ManageRequest)
    return req


PROPOSE, CHOOSE = request("request-manage-propose.json"), request("request-manage-choose.json")


def manager(behaviour="ok", settings=SETTINGS, **kw) -> Manager:
    return Manager(StubChatClient(behaviour, **kw), settings)


async def test_proposes_up_to_three_options_from_the_situation():
    r = await manager().handle(PROPOSE)
    assert r.task == "propose" and not r.fallback and r.choice is None
    labels = [o.label for o in r.proposal.options]
    assert labels == ["Press higher", "Sit deeper", "Fresh legs"]
    # Fresh legs: the most tired outfield player, replaced by an available bench player of the same role.
    assert r.proposal.options[2].orders[0].model_dump() == {"kind": "sub", "off": "iro-09", "on": "iro-19"}
    assert (r.tokens_in, r.tokens_out, r.cost_usd, r.model) == (0, 0, 0.0, "stub")


async def test_chooses_the_best_tested_option_and_quotes_only_its_numbers():
    r = await manager().handle(CHOOSE)
    assert not r.fallback and r.proposal is None
    assert r.choice.pick == 1
    assert "0.06" in r.choice.reason
    assert unknown_numbers(r.choice.reason, CHOOSE.situation, CHOOSE.whatif) == []


@pytest.mark.parametrize(("behaviour", "reason"), [("error", "RuntimeError"), ("garbage", "ValidationError"), ("slow", "timeout")])
async def test_a_failed_model_is_a_fallback_reply_never_an_error(behaviour, reason):
    settings = load_settings({"TOUCHLINE_TIMEOUT_SCALE": "0.01"}, env_file=None)
    for req in (PROPOSE, CHOOSE):
        r = await manager(behaviour, settings, slow_s=5).handle(req)
        assert r.fallback and r.reason == reason
        assert r.proposal is None and r.choice is None


def test_a_proposal_is_one_to_three_options_with_orders_a_short_label_and_a_short_rationale():
    ok = {"label": "Press", "orders": [{"kind": "style", "setting": "tempo", "value": 0.9}], "rationale": "Quicker."}
    assert acceptable_proposal(ProposeOut.model_validate({"options": [ok]}))
    for bad in ([ok] * 4, [], [{**ok, "orders": []}], [{**ok, "label": "x" * 61}], [{**ok, "rationale": "word " * 26}]):
        assert not acceptable_proposal(ProposeOut.model_validate({"options": bad}))


def test_a_reason_may_quote_only_the_what_if_numbers_the_score_and_the_minute():
    sit, wi = CHOOSE.situation, CHOOSE.whatif
    assert unknown_numbers("Gains 0.06 xG (± 0.03) over 20 runs, at 61.2 minutes and 0-1 down.", sit, wi) == []
    assert unknown_numbers("Rounded: 0.1 xG.", sit, wi) == []
    assert unknown_numbers("It gains 0.31 xG and we lead 2-1.", sit, wi) == ["2-1", "0.31"]


def test_a_choice_must_be_a_tested_option_with_a_short_grounded_reason():
    sit, wi = CHOOSE.situation, CHOOSE.whatif
    untested = wi.model_copy(update={"options": [wi.options[0], wi.options[1].model_copy(update={"untested": True})]})
    assert choice_problem(ChooseOut(pick=1, reason="Best."), sit, wi) is None
    assert choice_problem(ChooseOut(pick=7, reason="Best."), sit, wi) == "pick 7 is not one of the options"
    assert "not tested" in choice_problem(ChooseOut(pick=1, reason="Best."), sit, untested)
    assert "at most 30" in choice_problem(ChooseOut(pick=0, reason="word " * 31), sit, wi)
    assert "0.5" in choice_problem(ChooseOut(pick=1, reason="It gains 0.5 xG."), sit, wi)


async def test_a_reason_with_an_unknown_number_gets_one_retry_with_the_problem_then_the_fallback(monkeypatch):
    asked: list[dict] = []

    def once_wrong(payload, _results):
        asked.append(payload)
        return {"pick": 1, "reason": "Gains 0.06 xG." if "feedback" in payload else "Gains 0.31 xG."}

    monkeypatch.setitem(STUB_RESPONDERS, "choose", once_wrong)
    r = await manager().handle(CHOOSE)
    assert not r.fallback and r.choice.reason == "Gains 0.06 xG."
    assert len(asked) == 2 and "0.31" in asked[1]["feedback"]

    monkeypatch.setitem(STUB_RESPONDERS, "choose", lambda p, _r: {"pick": 1, "reason": "Gains 0.31 xG."})
    r = await manager().handle(CHOOSE)
    assert r.fallback and r.reason == "invalid" and r.choice is None


def test_cost_comes_from_a_configured_price_only():
    assert SETTINGS.cost_usd(1_000_000, 1_000_000) == 0.0
    priced = load_settings({"TOUCHLINE_PRICE_USD_PER_MTOK": "2,8"}, env_file=None)
    assert priced.cost_usd(500_000, 100_000) == pytest.approx(1.8)
    for bad in ("2", "a,b", "-1,2"):
        with pytest.raises(SettingsError):
            load_settings({"TOUCHLINE_PRICE_USD_PER_MTOK": bad}, env_file=None)

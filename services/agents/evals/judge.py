"""The LLM judge for explanation accuracy (spec §5.3.1: "judged against the truth label by a rubric"). Without a
model, or when it fails, the keyword rubric decides; hand spot-checks read the reasons in the report."""

from agent_framework import Agent
from pydantic import BaseModel, ConfigDict

from touchline_agents.config import Settings
from touchline_agents.llm import agent_options, make_client, run_structured, stub_responder

from .evaluators import _found, truth_key
from .rubric import keyword_judge

INSTRUCTIONS = """You grade a football analyst. INPUT has what really happened (the truth, from the simulator's
script) and the analyst's stated cause and explanation. Answer `correct` true only if the analyst names that cause:
the same kind of event, by the right side, and for an error the same kind of error with the same circumstance
(under pressure versus a plain technical error are different causes). Give a one-sentence reason."""

EFFECTS = {
    "goal": "a goal scored by {team}",
    "red_card": "a red card for a {team} player",
    "press_surge": "{team} pressing much higher and harder",
    "momentum_swing": "momentum swinging to {team}",
    "keeper_heroics": "the {team} goalkeeper making a string of saves",
    "keeper_howler": "a goalkeeping error by {team}",
    "defensive_error": "a defensive error by {team}",
}
KINDS = {"mishit": "a mis-hit kick", "heavy_touch": "a heavy first touch", "miscontrol": "a miscontrolled ball", "missed_touch": "a missed touch"}


class Judgment(BaseModel):
    model_config = ConfigDict(extra="forbid")
    correct: bool
    reason: str


def describe(t: dict) -> str:
    if t["kind"] == "critical_error":
        how = "under pressure" if t["mistake_cause"] == "pressure" else "not under pressure (poor technique)"
        return f"{KINDS[t['mistake_kind']]} by {t['team_id']}, {how}, that gave the ball away and led to an opponent shot"
    return EFFECTS[t["effect"]].format(team=t["team_id"])


@stub_responder("judge")
def _stub(payload: dict, _results: list[str]) -> dict:
    ok = keyword_judge(payload["truth_data"], payload["cause"], payload["explanation"])
    return {"correct": ok, "reason": "keyword rubric"}


async def judge_row(row: dict, settings: Settings) -> tuple[dict[str, bool], dict[str, str]]:
    """Judgments (truth key -> correct) and reasons for every truth a moment reported."""
    agent = Agent(client=make_client(settings, "large"), name="judge", instructions=INSTRUCTIONS, default_options=agent_options(settings))
    verdicts, reasons = {}, {}
    for t, tr in _found(row):
        if tr is None:
            continue
        a = tr["analysis"]
        payload = {"truth": describe(t), "truth_data": t, "cause": a["cause"], "explanation": a["explanation"]}
        out = await run_structured(
            agent, "judge", payload, Judgment, timeout_s=settings.timeout("judge"),
            fallback=lambda t=t, a=a: Judgment(correct=keyword_judge(t, a["cause"], a["explanation"]), reason="keyword rubric (judge unavailable)"),
        )
        verdicts[truth_key(t)] = out.value.correct
        reasons[truth_key(t)] = out.value.reason
    return verdicts, reasons

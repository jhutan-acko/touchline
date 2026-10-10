"""Manager agent (Plan 4b, spec §3): a team's manager at a key moment, in two steps.

`propose` reads the Situation (the match from the team's side, up to the pause) and suggests up to three changes;
the engine then re-simulates each against "no change", and `choose` picks one with those numbers in front of it and
says why. Code owns what must hold whatever the model says: at most three options, short labels and reasons, a pick
that is a tested option, and a reason whose every number comes from the what-if results, the score or the minute
(one retry with feedback, then the fallback). The engine re-checks every order against the live state.

A fallback means nothing was decided here: the engine stands in the rule-based option for a failed `propose` and keeps
the previous plan for a failed `choose`.
"""

import re
from dataclasses import dataclass
from typing import Literal

from agent_framework import Agent, BaseChatClient
from pydantic import BaseModel, ConfigDict

from .config import Settings
from .contracts_gen import Choice, ManagerOption, ManagerOrder1, ManagerOrder2, Proposal, Situation, WhatIfSummary
from .contracts import ManageRequest, ManagerReply
from .llm import agent_options, run_structured, stub_responder
from .numbers import NUMBER, SCORE, matches, numbers_in

MAX_OPTIONS = 3
MAX_LABEL_CHARS = 60
MAX_RATIONALE_WORDS = 25
MAX_REASON_WORDS = 30

PROPOSE = """You are the manager of a football team, deciding at a stoppage. INPUT.situation is the match from your
team's side up to now: the moment (why you are deciding, minute, minutes left, score), both teams (archetype,
formation, style settings with their allowed range and meaning, stats so far), your players on the pitch (energy_pct
100 = fresh, minutes played, booked or not, shots, xG, passes completed, tackles won) and your bench (available or
already used), your limits (substitutions and stoppage windows left; half-time changes use no window) and the last
10 minutes per side.
Propose 2 or 3 different changes worth testing. Each option has a short `label` (at most 60 characters), `orders` and a
one-sentence `rationale` (at most 25 words). An order is either {"kind": "style", "setting": <a style setting>,
"value": <within its range>} or {"kind": "sub", "off": <id of a player on the pitch>, "on": <id of an available bench
player>}. A substitute takes the position and role of the player going off; the formation does not change. Respect
the limits. Play to your team's identity (its archetype) unless the score demands otherwise. Do not propose "no
change": it is always tested."""

CHOOSE = """You are the manager of a football team, deciding at a stoppage. INPUT.situation is the match from your
team's side; INPUT.whatif is how each option did when the engine played it from this moment many times over the next
minutes, as the average difference from no change (option 0) in your xG minus the opponent's xG and in goals, each
with one standard error. Pick one option by its `index` (0 keeps everything as it is; never pick an untested option)
and give a `reason` of at most 30 words. Weigh the size of a difference against its standard error: a gain smaller
than its error is not a clear gain. Any number in the reason must be one from INPUT.whatif, the score or the minute,
written as given or rounded."""


class ProposedOption(BaseModel):
    """What the model writes for an option (no length limits here: code checks them, so any model can answer)."""

    model_config = ConfigDict(extra="forbid")
    label: str
    orders: list[ManagerOrder1 | ManagerOrder2]
    rationale: str


class ProposeOut(BaseModel):
    model_config = ConfigDict(extra="forbid")
    options: list[ProposedOption]


class ChooseOut(BaseModel):
    model_config = ConfigDict(extra="forbid")
    pick: int
    reason: str


def _words(text: str) -> int:
    return len(text.split())


def acceptable_proposal(p: ProposeOut) -> bool:
    """One to three options, each with orders, a short label and a short rationale."""
    return 1 <= len(p.options) <= MAX_OPTIONS and all(
        o.orders and 0 < len(o.label) <= MAX_LABEL_CHARS and _words(o.rationale) <= MAX_RATIONALE_WORDS for o in p.options
    )


def allowed_numbers(situation: Situation, whatif: WhatIfSummary) -> list[float]:
    """The numbers a reason may quote: every what-if figure, the seeds and horizon, the score and the minute."""
    out: list[float] = [float(whatif.seeds), float(whatif.horizon_min), situation.moment.minute]
    out += [float(situation.moment.score.for_), float(situation.moment.score.against)]
    for o in whatif.options:
        out.append(float(o.index))
        for e in (o.xg_diff_vs_no_change, o.goal_diff_vs_no_change):
            if e is not None:
                out += [e.mean, abs(e.mean), e.se]
    return out


def unknown_numbers(reason: str, situation: Situation, whatif: WhatIfSummary) -> list[str]:
    """Numbers in the reason that are not in the what-if results, the score or the minute."""
    allowed = allowed_numbers(situation, whatif)
    score = {f"{situation.moment.score.for_}-{situation.moment.score.against}", f"{situation.moment.score.against}-{situation.moment.score.for_}"}
    bad = []
    for token in numbers_in(reason):
        if SCORE.fullmatch(token):
            if re.sub(r"\s|–", lambda m: "-" if m.group(0) == "–" else "", token) not in score:
                bad.append(token)
        elif NUMBER.fullmatch(token) and not any(matches(token, v) for v in allowed):
            bad.append(token)
    return bad


def choice_problem(c: ChooseOut, situation: Situation, whatif: WhatIfSummary) -> str | None:
    """Why the choice cannot stand, or None."""
    by_index = {o.index: o for o in whatif.options}
    if c.pick not in by_index:
        return f"pick {c.pick} is not one of the options"
    if by_index[c.pick].untested:
        return f"option {c.pick} was not tested; pick a tested option or 0"
    if _words(c.reason) > MAX_REASON_WORDS:
        return f"the reason has {_words(c.reason)} words; at most {MAX_REASON_WORDS}"
    if bad := unknown_numbers(c.reason, situation, whatif):
        return f"the reason quotes {', '.join(bad)}, which is not in the what-if results, the score or the minute"
    return None


# ---------------------------------------------------------------- the stub model (tests and CI)

STYLE = {"pressIntensity", "lineHeight", "compactness", "tempo", "longBallBias", "crossBias", "riskTolerance"}


def _setting(sit: dict, key: str) -> dict:
    return next(s for s in sit["team"]["style"] if s["setting"] == key)


def _nudge(sit: dict, key: str, by: float) -> dict:
    s = _setting(sit, key)
    return {"kind": "style", "setting": key, "value": round(min(s["max"], max(s["min"], s["value"] + by)), 2)}


@stub_responder("propose")
def _stub_propose(payload: dict, _results: list[str]) -> dict:
    """Deterministic: press higher, sit deeper and (when a change is allowed) fresh legs for the most tired player."""
    sit = payload["situation"]
    options = [
        {"label": "Press higher", "orders": [_nudge(sit, "pressIntensity", 0.2), _nudge(sit, "tempo", 0.2)], "rationale": "Win the ball back sooner."},
        {"label": "Sit deeper", "orders": [_nudge(sit, "lineHeight", -0.3), _nudge(sit, "compactness", 0.2)], "rationale": "Protect the space behind."},
    ]
    limits = sit["limits"]
    if limits["subs_left"] > 0 and (limits["windows_left"] > 0 or limits["half_time_break"]):
        tired = sorted((p for p in sit["players"]["on_pitch"] if p["role"] != "GK"), key=lambda p: (p["energy_pct"], p["id"]))
        bench = [b for b in sit["players"]["bench"] if b["available"] and b["role"] != "GK"]
        for p in tired:
            on = next((b for b in bench if b["role"] == p["role"]), None)
            if on:
                options.append({"label": "Fresh legs", "orders": [{"kind": "sub", "off": p["id"], "on": on["id"]}], "rationale": f"{p['name']} is tiring."})
                break
    return {"options": options}


@stub_responder("choose")
def _stub_choose(payload: dict, _results: list[str]) -> dict:
    """Deterministic: the tested option with the best xG gain above zero, else no change."""
    tested = [o for o in payload["whatif"]["options"] if o["index"] > 0 and not o["untested"] and o["xg_diff_vs_no_change"]]
    best = max(tested, key=lambda o: (o["xg_diff_vs_no_change"]["mean"], -o["index"]), default=None)
    if best is None or best["xg_diff_vs_no_change"]["mean"] <= 0:
        return {"pick": 0, "reason": "No option did better than keeping things as they are."}
    return {"pick": best["index"], "reason": f"{best['label']} added {best['xg_diff_vs_no_change']['mean']} xG over no change."}


# ---------------------------------------------------------------- the agent

@dataclass(frozen=True)
class _Call:
    value: BaseModel | None
    fallback: bool
    reason: str | None
    ms: float
    tokens_in: int
    tokens_out: int


class Manager:
    def __init__(self, client: BaseChatClient, settings: Settings) -> None:
        self.settings = settings
        self.proposer = Agent(client=client, name="manager", instructions=PROPOSE, default_options=agent_options(settings))
        self.chooser = Agent(client=client, name="manager", instructions=CHOOSE, default_options=agent_options(settings))

    async def _ask(self, task: Literal["propose", "choose"], payload: dict, output: type[BaseModel], accept) -> _Call:
        out = await run_structured(
            self.proposer if task == "propose" else self.chooser, task, payload, output,
            timeout_s=self.settings.timeout("manager"), fallback=lambda: None, accept=accept,  # type: ignore[arg-type, return-value]
        )
        return _Call(out.value, out.fallback, out.reason, out.ms, out.tokens_in, out.tokens_out)

    async def handle(self, req: ManageRequest) -> ManagerReply:
        """Answer one manage request; never raises (a failed model call is a fallback reply)."""
        sit = req.situation.model_dump(mode="json", by_alias=True)
        calls: list[_Call] = []
        proposal: Proposal | None = None
        choice: Choice | None = None
        if req.task == "propose":
            c = await self._ask("propose", {"situation": sit}, ProposeOut, acceptable_proposal)
            calls.append(c)
            if not c.fallback:
                proposal = Proposal(options=[ManagerOption.model_validate(o.model_dump()) for o in c.value.options])  # type: ignore[union-attr]
        else:
            if req.whatif is None:
                raise ValueError("a choose request needs the what-if results")
            wi = req.whatif.model_dump(mode="json", by_alias=True)
            problem: list[str] = []

            def accept(x: ChooseOut) -> bool:
                p = choice_problem(x, req.situation, req.whatif)
                problem[:] = [p] if p else []
                return p is None

            c = await self._ask("choose", {"situation": sit, "whatif": wi}, ChooseOut, accept)
            calls.append(c)
            if c.fallback and c.reason == "invalid" and problem:
                # One retry, told exactly what was wrong.
                c = await self._ask("choose", {"situation": sit, "whatif": wi, "feedback": problem[0]}, ChooseOut, accept)
                calls.append(c)
            if not c.fallback:
                choice = Choice(pick=c.value.pick, reason=c.value.reason)  # type: ignore[union-attr]
        last = calls[-1]
        tokens_in, tokens_out = sum(x.tokens_in for x in calls), sum(x.tokens_out for x in calls)
        return ManagerReply(
            task=req.task, proposal=proposal, choice=choice, fallback=last.fallback, reason=last.reason,
            ms=sum(x.ms for x in calls), tokens_in=tokens_in, tokens_out=tokens_out,
            cost_usd=self.settings.cost_usd(tokens_in, tokens_out), model=self.settings.model_label,
        )

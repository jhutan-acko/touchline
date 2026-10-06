"""Narrator (spec §5.3): turns the Analyst's claims into a headline and a short body, in English.

The draft lists every number it states as a claim pointing at its sentence, quoted exactly as written, so the
Fact-Checker can check each one. The fallback is a headline template per moment type, the Analyst's explanation
(which has no numbers) and at most two templated sentences that state claims.
"""

from dataclasses import dataclass

from agent_framework import Agent, BaseChatClient

from .config import Settings
from .contracts import Analysis, Draft, Moment
from .llm import agent_options, run_structured, stub_responder

INSTRUCTIONS = """You are the Narrator for a live football broadcast overlay, writing in English.
INPUT has the moment, the Analyst's cause, explanation and claims, the names of teams and players, and possibly
`feedback` from the Fact-Checker on your previous draft (fix exactly what it says).
Write `sentences`: sentence 0 is a headline of at most 8 words; then one or two short body sentences.
Use names, never ids. State only numbers that appear in the Analyst's claims, and for every number you write add
that claim to `claims` with `sentence` set to the sentence it is in and `quote` set to the number exactly as you
wrote it (e.g. "27%", "0.24", "2-1"). Keep the claim's other fields as the Analyst gave them. No other digits:
write the minute in words or leave it out. `lang` is "en"; `moment_id` comes from INPUT."""

MAX_HEADLINE_WORDS = 8
LABELS: dict[str, str] = {
    "shot.xg": "Expected goals for the chance", "team.press": "Pressure index", "ppda": "Opponent passes per defensive action",
    "tilt": "Field tilt", "team.mom": "Momentum share", "game.chaos": "Control-versus-chaos index", "plyr.vmax": "Top speed in km/h",
    "plyr.dist": "Metres covered", "pass.xp": "Completion probability of the pass", "pass.acc": "Pass accuracy",
    "team.poss": "Possession", "act.xt": "Expected threat added", "pitch.ctrl": "Pitch control", "pass.dist": "Average pass length in metres",
    "shot.speed": "Shot speed in km/h", "ball.speed": "Ball speed in km/h",
}


def headline(moment: dict, analysis: Analysis, names: dict[str, str]) -> str:
    team = names.get(moment["team_id"] or "", "")
    player = names.get(moment["player_id"] or "", team or "One player")
    t = moment["type"]
    if t == "pressure_shift":
        return f"{team} turn up the pressure" if analysis.cause != "press dropping off" else f"{team} ease off the press"
    if t == "card":
        return f"Red card for {player}" if analysis.cause == "red card" else f"Booking for {player}"
    return {
        "goal": f"Goal for {team}!", "costly_error": f"Costly error by {player}", "big_chance": f"Big chance for {team}",
        "momentum_swing": f"Momentum swings to {team}", "chaos_spike": "End-to-end football", "speed_alert": f"{player} at full speed",
        "distance_milestone": f"{player} keeps running", "player_milestone": f"Milestone for {player}",
        "difficult_pass_completed": f"Superb pass from {player}", "substitution_impact": f"{team}'s changes make an impact",
    }[t]


def template_draft(payload: dict) -> Draft:
    """The fallback: headline, the explanation, and up to two templated claim sentences."""
    analysis = Analysis.model_validate(payload["analysis"])
    sentences = [headline(payload["moment"], analysis, payload["names"]), analysis.explanation]
    claims = []
    for c in analysis.claims:
        if len(sentences) == 4:
            break
        if c.kind == "metric" and c.metric_id in LABELS and c.quote:
            sentences.append(f"{LABELS[c.metric_id]}: {c.quote}.")
        elif c.kind == "score" and c.quote:
            sentences.append(f"The score is now {c.quote}.")
        else:
            continue
        claims.append(c.model_copy(update={"sentence": len(sentences) - 1}))
    return Draft(moment_id=analysis.moment_id, lang="en", sentences=sentences, claims=claims)


@stub_responder("narrate")
def _stub(payload: dict, _results: list[str]) -> dict:
    return template_draft(payload).model_dump(mode="json")


def acceptable(d: Draft, moment_id: str) -> bool:
    """English, about this moment, a short headline, and every claim pointing at a sentence that quotes it."""
    return (
        d.moment_id == moment_id and d.lang == "en" and len(d.sentences) <= 4
        and len(d.sentences[0].split()) <= MAX_HEADLINE_WORDS + 2
        and all(c.sentence < len(d.sentences) and (not c.quote or c.quote in d.sentences[c.sentence]) for c in d.claims)
    )


@dataclass(frozen=True)
class NarratorResult:
    draft: Draft
    fallback: bool
    reason: str | None
    ms: float


class Narrator:
    def __init__(self, client: BaseChatClient, settings: Settings) -> None:
        self.settings = settings
        self.agent = Agent(client=client, name="narrator", instructions=INSTRUCTIONS, default_options=agent_options(settings))

    async def narrate(self, moment: Moment, analysis: Analysis, names: dict[str, str], feedback: list[str] | None = None) -> NarratorResult:
        payload = {
            "moment": moment.model_dump(mode="json"),
            "analysis": analysis.model_dump(mode="json"),
            "names": names,
            **({"feedback": feedback} if feedback else {}),
        }
        out = await run_structured(
            self.agent, "narrate", payload, Draft, timeout_s=self.settings.timeout("narrator"),
            fallback=lambda: template_draft(payload), accept=lambda d: acceptable(d, moment.moment_id),
        )
        return NarratorResult(out.value, out.fallback, out.reason, out.ms)

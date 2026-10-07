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
from .templates import LABELS, headline

INSTRUCTIONS = """You are the Narrator for a live football broadcast overlay, writing in English.
INPUT has the moment, the Analyst's cause, explanation and claims, the names of teams and players, and possibly
`feedback` from the Fact-Checker on your previous draft (fix exactly what it says).
Write `sentences`: sentence 0 is a headline of at most 8 words; then one or two short body sentences.
Use names, never ids. State only numbers that appear in the Analyst's claims, and for every number you write add
that claim to `claims` with `sentence` set to the sentence it is in and `quote` set to the number exactly as you
wrote it (e.g. "27%", "0.24", "2-1"). Keep the claim's other fields as the Analyst gave them. No other digits:
leave the minute out, and never write a number as a word. `lang` is "en"; `moment_id` comes from INPUT."""

MAX_HEADLINE_WORDS = 8


def template_draft(payload: dict) -> Draft:
    """The fallback: headline, the explanation, and up to two templated claim sentences."""
    analysis = Analysis.model_validate(payload["analysis"])
    sentences = [headline(payload["moment"], analysis.cause, payload["names"]), analysis.explanation]
    claims = []
    for c in analysis.claims:
        if len(sentences) == 4:
            break
        if c.kind == "metric" and c.metric_id in LABELS["en"] and c.quote:
            sentences.append(f"{LABELS['en'][c.metric_id]}: {c.quote}.")
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

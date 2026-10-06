"""Personalizer (spec §5.3, §5.5): reshapes a verified draft for one segment (mode, language, club) into a cue.

It works on a Story: a moment, or a half-time or full-time recap (whose cues are recap cards).

The model writes natively in the segment's language and may only state numbers from the verified claims, each
pointed at by index. Code checks every variant: its numbers must be faithful re-quotes of verified claims, casual
text carries at most one number, Hindi text is in Devanagari, names are only those of players involved. A variant
that fails, or a model that fails, gives the template variant for that language instead.
"""

import asyncio
import re
from dataclasses import dataclass

from agent_framework import Agent, BaseChatClient
from pydantic import BaseModel, ConfigDict

from .config import Settings
from .contracts import Claim, Cue, Draft, Moment, Segment, segment_key
from .llm import agent_options, run_structured, stub_responder
from .numbers import format_metric, matches, numbers_in
from .templates import CONTEXT, FRAMING, LABELS, NEGATIVE, headline, headline_key

LANGS = ("en", "es", "hi")

INSTRUCTIONS = """You are the Personalizer for a live football broadcast overlay.
INPUT has a verified English draft (sentences and numbered claims), the story (a moment or a recap), a template
`headline` in the segment's language, names and one viewer segment:
mode (casual or analyst), lang (en, es or hi) and club (the team the viewer supports, or null).
Write a `headline` (at most 8 words) and a `body` NATIVELY in the segment's language (Spanish: natural Spanish;
Hindi: Devanagari script, Western digits), not a word-for-word translation.
- casual: short (one sentence), emotional, framed for the viewer's club; at most ONE number.
- analyst: numbers first, precise, up to three numbers, comparisons only if a claim supports them.
State only numbers from INPUT's claims. For each number you write, add {"claim": <index>, "quote": <the number
exactly as you wrote it>} to `numbers`; write numbers in the language's style (Spanish decimal comma: 0,24).
Use names, never ids, and no players other than those in `names`."""

DEVANAGARI = re.compile(r"[\u0900-\u097F]")
MAX_NUMBERS = {"casual": 1, "analyst": 4}
MAX_CHARS = {"casual": 160, "analyst": 320}
@dataclass(frozen=True)
class Story:
    """What a cue is about: its id (the cue's moment_id), anchor, template and template headline per language."""

    id: str
    match_id: str
    template: str
    team_id: str | None
    player_id: str | None
    frame_from: int
    frame_to: int
    clock: str
    priority: int
    headlines: dict[str, str]
    # A sentence of context per language for analyst variants (no digits).
    contexts: dict[str, str]
    # Casual and analyst slots: moments go to the lower third and the side panel, recaps to recap cards.
    slots: tuple[str, str] = ("lower_third", "side_panel")

    @staticmethod
    def of_moment(m: Moment, cause: str, names: dict[str, str], explanation: str = "") -> "Story":
        d = m.model_dump(mode="json")
        key = headline_key(d, cause)
        contexts = {lang: CONTEXT[lang][key] for lang in LANGS}
        if explanation and not any(ch.isdigit() for ch in explanation):
            contexts["en"] = explanation
        return Story(m.moment_id, m.match_id, m.type, m.team_id, m.player_id, m.frame_from, m.frame_to, m.match_clock[:5], m.priority,
                     {lang: headline(d, cause, names, lang) for lang in LANGS}, contexts)


class UsedNumber(BaseModel):
    model_config = ConfigDict(extra="forbid")
    claim: int
    quote: str


class Variant(BaseModel):
    model_config = ConfigDict(extra="forbid")
    headline: str
    body: str
    numbers: list[UsedNumber]


def _quote(c: Claim, lang: str) -> str | None:
    if c.kind == "metric" and c.metric_id and c.value is not None:
        return format_metric(c.metric_id, c.value, lang)
    if c.kind == "score":
        return c.quote
    return None


def template_variant(payload: dict) -> Variant:
    """The fallback: the template headline in the segment's language, club framing for casual viewers, the claims as
    labelled numbers (one for casual, up to three for analyst), and a sentence of context for analysts."""
    seg, m, names = payload["segment"], payload["story"], payload["names"]
    lang = seg["lang"]
    head = payload["headline"]
    parts: list[str] = []
    if seg["mode"] == "casual" and seg["club"] and seg["club"] in names and m["team_id"]:
        good = (seg["club"] == m["team_id"]) != (m["template"] in NEGATIVE)
        parts.append(FRAMING[lang][0 if good else 1].format(club=names[seg["club"]]))
    used: list[UsedNumber] = []
    for i, raw in enumerate(payload["claims"]):
        c = Claim.model_validate(raw)
        q = _quote(c, lang)
        if q is None or len(used) == (1 if seg["mode"] == "casual" else 3):
            continue
        label = LABELS[lang]["score" if c.kind == "score" else c.metric_id]
        parts.append(f"{label}: {q}" + ("।" if lang == "hi" else "."))
        used.append(UsedNumber(claim=i, quote=q))
    if seg["mode"] == "analyst":
        parts.append(payload["context"])
    return Variant(headline=head, body=" ".join(parts), numbers=used)


@stub_responder("personalize")
def _stub(payload: dict, _results: list[str]) -> dict:
    return template_variant(payload).model_dump(mode="json")


def check_variant(v: Variant, payload: dict, others: list[str]) -> list[str]:
    """Why a variant cannot be published (empty when it can)."""
    seg = payload["segment"]
    lang, mode = seg["lang"], seg["mode"]
    claims = [Claim.model_validate(c) for c in payload["claims"]]
    text = f"{v.headline} {v.body}"
    problems = []
    tokens = numbers_in(text)
    if len(tokens) > MAX_NUMBERS[mode]:
        problems.append(f"{len(tokens)} numbers in a {mode} variant (at most {MAX_NUMBERS[mode]})")
    if len(v.body) > MAX_CHARS[mode]:
        problems.append(f"body longer than {MAX_CHARS[mode]} characters")
    for u in v.numbers:
        if not 0 <= u.claim < len(claims):
            problems.append(f"no claim {u.claim}")
            continue
        c = claims[u.claim]
        if u.quote not in text:
            problems.append(f'"{u.quote}" is not in the text')
        elif c.kind == "metric" and (c.value is None or not matches(u.quote, c.value, lang)):
            problems.append(f'"{u.quote}" does not round claim {u.claim}')
        elif c.kind == "score" and sorted(re.findall(r"\d+", u.quote)) != sorted(re.findall(r"\d+", c.quote)):
            problems.append(f'"{u.quote}" is not the score {c.quote}')
        elif c.kind not in ("metric", "score"):
            problems.append(f"claim {u.claim} has no number to quote")
    for t in tokens:
        if not any(t in u.quote for u in v.numbers):
            problems.append(f'"{t}" is not one of the verified claims')
    if lang == "hi" and not DEVANAGARI.search(text):
        problems.append("Hindi text must be in Devanagari")
    if lang != "en" and any(len(s) >= 12 and s in text for s in payload["draft"]):
        problems.append(f"copies the English draft instead of writing in {lang}")
    for name in others:
        if re.search(rf"\b{re.escape(name)}\b", text):
            problems.append(f"names {name}, who was not involved")
    return problems


def make_cue(story: Story, segment: Segment, v: Variant, claims: list[Claim], evidence: list[str]) -> Cue:
    used = [claims[u.claim] for u in v.numbers if 0 <= u.claim < len(claims)]
    data: dict[str, float] = {}
    for c in used:
        if c.kind == "metric" and c.metric_id and c.value is not None:
            data[c.metric_id] = c.value
        elif c.kind == "score":
            home, away = (int(x) for x in re.findall(r"\d+", c.quote)[:2])
            data |= {"score.home": home, "score.away": away}
    refs = [ref for c in used for ref in ([c.event_id] if c.event_id else [f"{c.metric_id}@{c.subject}:{c.at_frame}"] if c.metric_id else [])]
    return Cue.model_validate({
        "cue_id": f"{story.id}-{segment_key(segment)}",
        "schema": "touchline.cue/1",
        "match_id": story.match_id,
        "moment_id": story.id,
        "anchor": {"frame_from": story.frame_from, "frame_to": story.frame_to, "clock": story.clock},
        "display": {"slot": story.slots[0] if segment.mode == "casual" else story.slots[1], "priority": story.priority,
                    "ttl_ms": 12000 if story.priority == 1 else 8000, "template": story.template},
        "segment": segment.model_dump(mode="json"),
        "text": {"headline": v.headline, "body": v.body},
        "data": data,
        "evidence": list(dict.fromkeys(refs + evidence)),
        "verified": True,
    })


@dataclass(frozen=True)
class Personalized:
    cue: Cue
    fallback: bool
    # Why the model's variant was not used (a model failure or the check's reasons).
    reasons: list[str]
    ms: float


class Personalizer:
    def __init__(self, client: BaseChatClient, settings: Settings) -> None:
        self.settings = settings
        self.agent = Agent(client=client, name="personalizer", instructions=INSTRUCTIONS, default_options=agent_options(settings))

    async def personalize(self, story: Story, draft: Draft, names: dict[str, str], segment: Segment, others: list[str], evidence: list[str]) -> Personalized:
        payload = {
            "segment": segment.model_dump(mode="json"),
            "story": {"template": story.template, "team_id": story.team_id, "player_id": story.player_id, "clock": story.clock},
            "headline": story.headlines[segment.lang],
            "context": story.contexts[segment.lang],
            "names": names,
            "draft": draft.sentences,
            "claims": [c.model_dump(mode="json") for c in draft.claims if _quote(c, "en") is not None],
        }
        claims = [Claim.model_validate(c) for c in payload["claims"]]
        out = await run_structured(self.agent, "personalize", payload, Variant, timeout_s=self.settings.timeout("personalizer"), fallback=lambda: template_variant(payload))
        variant, reasons = out.value, [out.reason] if out.fallback and out.reason else []
        if not out.fallback and (problems := check_variant(variant, payload, others)):
            variant, reasons = template_variant(payload), problems
        return Personalized(make_cue(story, segment, variant, claims, evidence), bool(reasons), reasons, out.ms)

    async def fan_out(self, story: Story, draft: Draft, names: dict[str, str], segments: list[Segment], others: list[str], evidence: list[str]) -> list[Personalized]:
        """Every segment at once (generation scales with segments, not viewers)."""
        return list(await asyncio.gather(*(self.personalize(story, draft, names, s, others, evidence) for s in segments)))

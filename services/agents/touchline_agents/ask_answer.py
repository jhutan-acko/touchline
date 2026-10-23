"""The Ask answer team (pause and ask): analyst, rule-based fact-check, personaliser, each announced as a stage.

The analyst (large tier) drafts a headline, sentences and claims from the frozen frame, the stats tools capped at the
paused frame, and the re-simulation's numbers, which the API computed and passes in verbatim (the analyst never runs
a what-if itself). Code checks every claim: stats claims with the Fact-Checker's `check_claim` as of the paused frame,
what-if claims against the re-simulation. A failing draft gets one retry with the failing claims, then the sentences
carrying failed claims are dropped. The personaliser (fast tier) rewrites the checked answer for the viewer's mode and
language under the Personalizer's variant checks, with a template in each language as its fallback. Nothing raises:
any failure gives a short, unverified reply.
"""

import json
import logging
import re
from collections.abc import Awaitable, Callable

from agent_framework import Agent, BaseChatClient
from pydantic import BaseModel, ConfigDict

from .analyst import capped_tools
from .config import Settings
from .contracts import AskAnswerRequest, AskReply, AskStage, AskWhatIf, Claim, EvidenceChip
from .factchecker import FactChecker, check_whatif_claim, other_names, quoted
from .llm import ToolCalls, agent_options, run_structured, stub_responder
from .numbers import format_metric, matches, numbers_in, read, write
from .personalizer import UsedNumber, Variant, check_variant
from .stats import StatsClient, names
from .templates import LABELS

log = logging.getLogger("touchline.agents")

Emit = Callable[[AskStage], Awaitable[None]]

# The advisor tools run the re-simulation; in Ask only the API runs it, so the analyst never gets them.
ADVISOR_TOOLS = {"what_if", "explain_pass", "suggest_position"}
MAX_SENTENCES = {"casual": 1, "analyst": 3}
MAX_CHIPS = 4

ANALYST_INSTRUCTIONS = """You are the Tactical Analyst answering a viewer who paused a football match and asked a question.
INPUT has the question, the parsed intent, a summary of the frozen frame (players, ball holder, pass options,
pressers, recent events), the paused frame `at_frame`, and for a what-if the re-simulation's numbers (`what_if`):
seeds run, shots and goals with the action played and with the alternative, the mean gain, and the verdict.
Write in English: a `headline` (at most 8 words, NO digits) and one to three plain `sentences` answering the question.
Rules:
- Every number in a sentence is a claim in `claims`, with `sentence` its index and `quote` the number as written.
- Re-simulation numbers: kind "what_if", metric_id null, subject one of shots_played, shots_alt, goals_played,
  goals_alt, seeds, gain, value copied from INPUT what_if, at_frame = INPUT at_frame.
- Stats numbers: kind "metric" with metric_id, subject and at_frame (at most INPUT at_frame), copied from a stats
  tool you called; kind "score" with quote "home-away"; kind "event" for an event you rely on.
- If the verdict is not_verified, never say the alternative was better: say it is too close to call.
  If it is played_pass_was_best, say what he did was as good or better.
- Never invent ids or values. Nothing after the paused frame exists for you.
- If INPUT has `failed`, those claims did not check out: fix or drop them."""

PERSONALISE_INSTRUCTIONS = """You are the Personalizer for a paused-match answer card.
INPUT has a checked English answer (headline, sentences, numbered claims), a template `headline` in the viewer's
language, names, and the viewer segment: mode (casual or analyst) and lang (en, es or hi).
Write a `headline` (at most 8 words) and a `body` NATIVELY in the segment's language (Spanish: natural Spanish;
Hindi: Devanagari script, Western digits), not a word-for-word translation.
- casual: ONE short sentence, at most one number.
- analyst: at most three sentences, numbers first.
State only numbers from INPUT's claims, unchanged. For each number you write, add {"claim": <index>, "quote": <the
number exactly as you wrote it>} to `numbers`; write numbers in the language's style (Spanish decimal comma: 0,24).
If INPUT `verdict` is not_verified, never say the alternative was better: say it is too close to call.
Use names, never ids; keep every name exactly as given, in Latin script, even in Hindi."""

# Stage status lines, short, in the viewer's language.
STATUS: dict[str, dict[str, str]] = {
    "en": {"analyst": "Analyst reading the evidence…", "factcheck": "Checking {n} numbers…", "personalise": "Writing your answer…"},
    "es": {"analyst": "El analista revisa los datos…", "factcheck": "Comprobando {n} cifras…", "personalise": "Redactando tu respuesta…"},
    "hi": {"analyst": "विश्लेषक आंकड़े देख रहे हैं…", "factcheck": "{n} आंकड़ों की जाँच…", "personalise": "आपका जवाब लिखा जा रहा है…"},
}
# What-if verdict headlines (the UI's wording); not_verified is always "too close to call".
TOO_CLOSE = {"en": "Too close to call", "es": "Demasiado igualado para decidir", "hi": "कहना मुश्किल, मुकाबला बराबरी का"}
VERDICT_HEADLINES: dict[str, dict[str, str]] = {
    "better_option_found": {"en": "The alternative was better", "es": "La alternativa era mejor", "hi": "विकल्प बेहतर था"},
    "played_pass_was_best": {"en": "What he did was as good or better", "es": "Lo que hizo fue igual o mejor", "hi": "उन्होंने जो किया, वह उतना ही अच्छा या बेहतर था"},
    "not_verified": TOO_CLOSE,
}
EXPLAIN_HEADLINE = {"en": "What the numbers say about {name}", "es": "Lo que dicen los datos de {name}", "hi": "{name} के बारे में आंकड़े क्या कहते हैं"}
EXPLAIN_HEADLINE_NONAME = {"en": "What the numbers say", "es": "Lo que dicen los datos", "hi": "आंकड़े क्या कहते हैं"}
NO_NUMBERS = {"en": "We could not check the numbers for this one.", "es": "No pudimos comprobar las cifras de esta jugada.", "hi": "इस बार हम आंकड़ों की पुष्टि नहीं कर सके।"}
FAILED_HEADLINE = {"en": "The analysts could not answer this", "es": "Los analistas no pudieron responder", "hi": "विश्लेषक इसका जवाब नहीं दे सके"}
WHATIF_LABELS: dict[str, dict[str, str]] = {
    "en": {"shots_alt": "Shots with the alternative", "shots_played": "Shots with the play he chose", "goals_alt": "Goals with the alternative",
           "goals_played": "Goals with the play he chose", "seeds": "Re-simulations", "gain": "Mean gain for the alternative"},
    "es": {"shots_alt": "Tiros con la alternativa", "shots_played": "Tiros con la jugada elegida", "goals_alt": "Goles con la alternativa",
           "goals_played": "Goles con la jugada elegida", "seeds": "Re-simulaciones", "gain": "Ganancia media de la alternativa"},
    "hi": {"shots_alt": "विकल्प के साथ शॉट", "shots_played": "चुनी गई चाल के साथ शॉट", "goals_alt": "विकल्प के साथ गोल",
           "goals_played": "चुनी गई चाल के साथ गोल", "seeds": "पुनः सिमुलेशन", "gain": "विकल्प का औसत लाभ"},
}
EVENT_LABEL = {"en": "Event", "es": "Jugada", "hi": "घटना"}
# Chip order: the re-simulation's counts first, then the stats, then events.
WHATIF_ORDER = ("shots_alt", "shots_played", "goals_alt", "goals_played", "seeds", "gain")


class AskDraft(BaseModel):
    model_config = ConfigDict(extra="forbid")
    headline: str
    sentences: list[str]
    claims: list[Claim]


def sentences_of(text: str) -> list[str]:
    """The sentences of a body (split after . ! ? or ।, so decimals such as 0.24 stay whole)."""
    return [s for s in re.split(r"(?<=[.!?।])\s+", text.strip()) if s]


def whatif_numbers(w: AskWhatIf | None) -> dict | None:
    """The re-simulation's numbers as the analyst's input carries them, verbatim."""
    if w is None:
        return None
    return {"verdict": w.verdict, "seeds": w.seeds, "shots_played": w.shots.played, "shots_alt": w.shots.alt,
            "goals_played": w.goals.played, "goals_alt": w.goals.alt, "gain": w.gain.mean, "gain_se": w.gain.se,
            "fork_frame": w.fork_frame, "intervention": w.intervention.model_dump(mode="json")}


def _claim(kind: str, sentence: int, quote: str, at_frame: int, **kw) -> Claim:
    base = dict(kind=kind, sentence=sentence, quote=quote, metric_id=None, subject=None, value=None, at_frame=at_frame,
                window_s=None, event_id=None, receiver_id=None)
    return Claim(**(base | kw))


def template_draft(payload: dict, metric: dict | None = None) -> AskDraft:
    """The analyst's fallback: the re-simulation's counts (what-if) and, when given, one stats metric at the paused
    frame, as plain English sentences with every number declared."""
    at = payload["at_frame"]
    w = payload["what_if"]
    sentences: list[str] = []
    claims: list[Claim] = []
    if w:
        i = len(sentences)
        sentences.append(f"Over {w['seeds']} re-simulations, the alternative led to {w['shots_alt']} shots against {w['shots_played']} for the play he chose.")
        claims += [_claim("what_if", i, str(w["seeds"]), at, subject="seeds", value=w["seeds"]),
                   _claim("what_if", i, str(w["shots_alt"]), at, subject="shots_alt", value=w["shots_alt"]),
                   _claim("what_if", i, str(w["shots_played"]), at, subject="shots_played", value=w["shots_played"])]
        headline = VERDICT_HEADLINES[w["verdict"]]["en"]
    else:
        headline = "What the numbers say"
    if metric is not None and metric.get("value") is not None:
        i = len(sentences)
        q = format_metric(metric["metric_id"], metric["value"])
        sentences.append(f"{LABELS['en'][metric['metric_id']]} so far: {q}.")
        claims.append(_claim("metric", i, q, at, metric_id=metric["metric_id"], subject=metric["subject"], value=metric["value"]))
    if not sentences:
        sentences.append(NO_NUMBERS["en"])
    return AskDraft(headline=headline, sentences=sentences, claims=claims)


@stub_responder("ask_analyst")
def _analyst_stub(payload: dict, results: list[str]) -> dict | ToolCalls:
    # Ask the stats server for the subject's distance at the paused frame, then cite it with the what-if numbers.
    subject = payload.get("subject_id")
    if not results and subject:
        return ToolCalls([("get_metric", {"metric_id": "plyr.dist", "subject": subject, "at_frame": payload["at_frame"]})])
    metric = None
    if results:
        try:
            got = json.loads(results[0])
            metric = {"metric_id": "plyr.dist", "subject": subject, "value": got.get("value")}
        except (ValueError, AttributeError):
            metric = None
    return template_draft(payload, metric).model_dump(mode="json")


def _quote(c: Claim, lang: str) -> str | None:
    """How a passed claim's number is written in `lang` (None: it has none to state)."""
    if c.kind == "metric" and c.metric_id and c.value is not None:
        return format_metric(c.metric_id, c.value, lang)
    if c.kind == "score":
        return c.quote
    if c.kind == "what_if" and c.subject != "gain" and c.value is not None:
        return str(int(c.value))
    return None


def _label(c: Claim, lang: str) -> str:
    if c.kind == "what_if":
        return WHATIF_LABELS[lang][c.subject or "seeds"]
    if c.kind == "score":
        return LABELS[lang]["score"]
    if c.kind == "metric" and c.metric_id:
        return LABELS[lang][c.metric_id]
    return EVENT_LABEL[lang]


def template_variant(payload: dict) -> Variant:
    """The personaliser's fallback: the template headline in the viewer's language, then the checked numbers as
    labelled sentences (one for casual, up to three for analyst)."""
    lang, mode = payload["segment"]["lang"], payload["segment"]["mode"]
    parts: list[str] = []
    used: list[UsedNumber] = []
    for i, raw in enumerate(payload["claims"]):
        c = Claim.model_validate(raw)
        q = _quote(c, lang)
        if q is None or len(used) == MAX_SENTENCES[mode]:
            continue
        parts.append(f"{_label(c, lang)}: {q}" + ("।" if lang == "hi" else "."))
        used.append(UsedNumber(claim=i, quote=q))
    if not parts:
        parts.append(NO_NUMBERS[lang])
    return Variant(headline=payload["headline"], body=" ".join(parts), numbers=used)


@stub_responder("ask_personalise")
def _personalise_stub(payload: dict, _results: list[str]) -> dict:
    return template_variant(payload).model_dump(mode="json")


def check_answer_variant(v: Variant, payload: dict, others: list[str]) -> list[str]:
    """The Personalizer's variant checks, extended to re-simulation counts (quoted unchanged), plus the sentence limit."""
    claims = [Claim.model_validate(c) for c in payload["claims"]]
    whatif = {i for i, c in enumerate(claims) if c.kind == "what_if"}
    problems = [p for p in check_variant(v, payload, others) if not any(p == f"claim {i} has no number to quote" for i in whatif)]
    for u in v.numbers:
        if u.claim in whatif:
            c = claims[u.claim]
            tokens = numbers_in(u.quote)
            if c.subject == "gain" or len(tokens) != 1 or c.value is None or read(tokens[0], payload["segment"]["lang"])[0] != c.value:
                problems.append(f'"{u.quote}" is not the re-simulation\'s {c.subject}')
    mode = payload["segment"]["mode"]
    if len(sentences_of(v.body)) > MAX_SENTENCES[mode]:
        problems.append(f"more than {MAX_SENTENCES[mode]} sentences in a {mode} answer")
    return problems


def rank(c: Claim) -> tuple[int, int]:
    """Evidence order: re-simulation counts first, then stats, then events."""
    if c.kind == "what_if":
        return (0, WHATIF_ORDER.index(c.subject) if c.subject in WHATIF_ORDER else len(WHATIF_ORDER))
    return (1, 0) if c.kind in ("metric", "score", "minute") else (2, 0)


def chips(claims: list[Claim], lang: str) -> list[EvidenceChip]:
    """At most four evidence chips from the passed claims: re-simulation counts, then stats, then events."""
    out: list[EvidenceChip] = []
    for c in sorted(claims, key=rank):
        if len(out) == MAX_CHIPS:
            break
        if c.kind == "what_if":
            if c.value is None:
                continue
            value = _quote(c, lang) or (("+" if c.value > 0 else "") + write(c.value, 2, lang))
            out.append(EvidenceChip(label=_label(c, lang), value=value, source="what_if"))
        elif c.kind in ("metric", "score", "minute"):
            value = _quote(c, lang) or c.quote
            if value:
                out.append(EvidenceChip(label=_label(c, lang), value=value, source="stats"))
        elif c.kind in ("event", "better_option") and (c.event_id or c.quote):
            out.append(EvidenceChip(label=EVENT_LABEL[lang], value=c.quote or c.event_id or "", source="event"))
    return out


class AskTeam:
    """The analyst (large), the rule fact-check and the personaliser (fast) for one Ask answer."""

    def __init__(self, large_client: BaseChatClient, fast_client: BaseChatClient, settings: Settings) -> None:
        self.large = large_client
        self.settings = settings
        self.personaliser = Agent(client=fast_client, name="ask_personaliser", instructions=PERSONALISE_INSTRUCTIONS, default_options=agent_options(settings))
        # check_claim is pure code; its extraction model is never called here.
        self.factchecker = FactChecker(fast_client, settings)

    @property
    def model_label(self) -> str:
        s = self.settings
        return "stub" if s.provider == "stub" else f"openai:{s.model('large')}+{s.model('fast')}"

    async def answer(self, req: AskAnswerRequest, stats: StatsClient, emit: Emit) -> AskReply:
        """The checked, personalised answer; never raises (a failure is an unverified reply in the viewer's language)."""
        try:
            return await self._answer(req, stats, emit)
        except Exception as e:  # noqa: BLE001 - the viewer always gets an answer card
            log.warning("ask answer failed (%s: %s), replying unverified", type(e).__name__, e)
            lang = req.segment.lang
            return AskReply(headline=FAILED_HEADLINE[lang], body="", chips=[], verified=False, model=None)

    async def _answer(self, req: AskAnswerRequest, stats: StatsClient, emit: Emit) -> AskReply:
        lang, intent = req.segment.lang, req.intent
        await emit(AskStage(stage="analyst", status=STATUS[lang]["analyst"]))
        if intent.kind == "unsupported":
            await emit(AskStage(stage="personalise", status=STATUS[lang]["personalise"]))
            # A refusal checks no numbers, so it is not marked fact-checked.
            return AskReply(headline=intent.reason or FAILED_HEADLINE[lang], body="", chips=[], verified=False, model=self.model_label)

        info = await stats.roster()
        who = names(info)
        subject = intent.subject_id or req.summary.ball_holder
        payload = {
            "question": req.question, "intent": intent.model_dump(mode="json"), "summary": req.summary.model_dump(mode="json", by_alias=True),
            "at_frame": req.at_frame, "subject_id": subject, "what_if": whatif_numbers(req.what_if),
            "names": {p.id: p.name for p in req.summary.players},
        }
        draft = await self._draft(stats, payload)
        await emit(AskStage(stage="factcheck", status=STATUS[lang]["factcheck"].format(n=len(draft.claims))))
        failed = await self._failures(stats, draft, req)
        if failed:
            draft = await self._draft(stats, payload | {"failed": [{"claim": c.model_dump(mode="json"), "why": why} for c, why in failed]})
            failed = await self._failures(stats, draft, req)
        bad_sentences = {c.sentence for c, _ in failed} | self._undeclared(draft)
        # Sentences carrying a failed claim (or an undeclared number) are dropped with all their claims, so every
        # remaining claim passed: the answer is verified when at least one remains.
        passed = sorted((c for c in draft.claims if c.sentence not in bad_sentences and c.sentence < len(draft.sentences)), key=rank)
        kept = [s for i, s in enumerate(draft.sentences) if i not in bad_sentences]
        verified = bool(passed)

        await emit(AskStage(stage="personalise", status=STATUS[lang]["personalise"]))
        verdict = req.what_if.verdict if req.what_if else None
        if verdict:
            head = VERDICT_HEADLINES[verdict][lang]
        elif lang == "en" and draft.headline and not any(ch.isdigit() for ch in draft.headline):
            head = draft.headline
        else:
            name = who.get(subject or "")
            head = EXPLAIN_HEADLINE[lang].format(name=name) if name else EXPLAIN_HEADLINE_NONAME[lang]
        involved = {p.id for p in req.summary.players} | {x for x in (subject, req.summary.ball_holder) if x}
        if req.what_if:
            iv = req.what_if.intervention
            involved |= {iv.player_id} | ({iv.receiver_id} if getattr(iv, "receiver_id", None) else set())
        p_payload = {
            "segment": req.segment.model_dump(mode="json"), "headline": head, "verdict": verdict,
            "names": {k: v for k, v in who.items() if k in involved},
            "draft": [draft.headline, *kept],
            "claims": [c.model_dump(mode="json") for c in passed if _quote(c, "en") is not None],
        }
        others = other_names(info, involved)
        out = await run_structured(self.personaliser, "ask_personalise", p_payload, Variant,
                                   timeout_s=self.settings.timeout("ask_personalizer"), fallback=lambda: template_variant(p_payload))
        variant = out.value
        if not out.fallback and check_answer_variant(variant, p_payload, others):
            variant = template_variant(p_payload)
        # A verdict's headline is the verdict's own words, whatever the personaliser wrote; too close to call also keeps
        # the template body, so no free text can still claim the alternative was better.
        if verdict == "not_verified":
            variant = template_variant(p_payload)
        headline = VERDICT_HEADLINES[verdict][lang] if verdict else variant.headline
        return AskReply(headline=headline, body=variant.body, chips=chips(passed, lang), verified=verified, model=self.model_label)

    async def _draft(self, stats: StatsClient, payload: dict) -> AskDraft:
        tools = [t for t in capped_tools(stats, latest=payload["at_frame"]) if t.name not in ADVISOR_TOOLS]
        agent = Agent(client=self.large, name="ask_analyst", instructions=ANALYST_INSTRUCTIONS, tools=tools, default_options=agent_options(self.settings))
        out = await run_structured(
            agent, "ask_analyst", payload, AskDraft, timeout_s=self.settings.timeout("ask_analyst"),
            fallback=lambda: template_draft(payload), accept=lambda d: bool(d.sentences) and not any(ch.isdigit() for ch in d.headline),
        )
        return out.value

    async def _failures(self, stats: StatsClient, draft: AskDraft, req: AskAnswerRequest) -> list[tuple[Claim, str]]:
        """The claims that do not check out, with why: quoted in their sentence, at or before the paused frame, and true
        (stats claims against the stats server, what-if claims against the re-simulation)."""
        out: list[tuple[Claim, str]] = []
        for c in draft.claims:
            if c.sentence >= len(draft.sentences):
                out.append((c, f"no sentence {c.sentence}"))
                continue
            if c.at_frame > req.at_frame:
                out.append((c, f"claims frame {c.at_frame}, after the paused frame {req.at_frame}"))
                continue
            if c.quote and not quoted(c.quote, draft.sentences[c.sentence]):
                out.append((c, f'"{c.quote}" is not in the sentence'))
                continue
            if c.kind == "what_if":
                if not check_whatif_claim(c, req.what_if):
                    out.append((c, f"{c.subject} is not {c.value} in the re-simulation"))
                elif c.quote and c.subject != "gain" and not matches(c.quote, c.value, "en"):
                    out.append((c, f'"{c.quote}" is not {c.value}'))
                continue
            why = await self.factchecker.check_claim(stats, c, "en", req.at_frame, req.summary.clock)
            if why:
                out.append((c, why))
        return out

    @staticmethod
    def _undeclared(draft: AskDraft) -> set[int]:
        """Sentences stating a number no claim declares."""
        bad = set()
        for i, s in enumerate(draft.sentences):
            declared = {t for c in draft.claims if c.sentence == i and c.quote for t in numbers_in(c.quote)}
            if any(t not in declared for t in numbers_in(s)):
                bad.add(i)
        return bad

"""Question agent (pause-and-ask): a viewer's question about a paused frame becomes a structured `AskIntent`.

The model (tier "fast") reads the question and the frame summary; code owns what must hold whatever it says:
`validate_intent` turns anything the engine cannot re-simulate (an unknown player, a receiver on the other side, a fork
event that is not in the summary, a shot or a dribble) into `unsupported` with a reason in the viewer's language.
`rule_intent` is the deterministic reading of the question, used as the stub model and as the fallback.
"""

import re
from typing import Literal

from agent_framework import Agent, BaseChatClient

from .config import Settings
from .contracts import AskIntent, AskIntentRequest, AskInterventionSpec1, FrameSummary
from .llm import agent_options, run_structured, stub_responder

Lang = Literal["en", "es", "hi"]

INSTRUCTIONS = """You read a football viewer's question about a paused frame. INPUT has `question`, `lang` and `summary`
(the players with ids, who has the ball, the pass options, the recent events with ids). Answer with an intent:
- kind "explain": the viewer asks why or how (subject_id: the player asked about; the ball holder if none is named).
- kind "what_if": the viewer asks what would have happened if a player had passed to a team-mate. Set intervention to
  {"kind": "pass_to", "player_id": <passer id>, "receiver_id": <team-mate id>}, subject_id to the passer, and
  fork_event_id to the id of the pass event in summary.recent that is being replaced (null: from this frame).
- kind "unsupported": anything else (a what-if about a shot, a dribble or a run, an opponent as the passer, a player not
  in the summary). Give a short `reason` in the language `lang`.
Use only ids from the summary. Leave unused fields null."""

REASONS: dict[str, dict[str, str]] = {
    "unknown_player": {
        "en": "I can't find {name} among the players on the pitch.",
        "es": "No encuentro a {name} entre los jugadores en el campo.",
        "hi": "मैं {name} को मैदान के खिलाड़ियों में नहीं ढूँढ पाया।",
    },
    "other_side": {
        "en": "I can only test a pass to a team-mate.",
        "es": "Solo puedo probar un pase a un compañero de equipo.",
        "hi": "मैं केवल साथी खिलाड़ी को पास की जाँच कर सकता हूँ।",
    },
    "unsupported_action": {
        "en": "I can only re-play a different pass, not a shot, a dribble or a run.",
        "es": "Solo puedo repetir la jugada con otro pase, no con un tiro, un regate o una carrera.",
        "hi": "मैं केवल अलग पास के साथ दोबारा खेल सकता हूँ, शॉट, ड्रिबल या दौड़ के साथ नहीं।",
    },
    "unknown_event": {
        "en": "I can't find that moment in the recent play.",
        "es": "No encuentro esa jugada en lo que acaba de pasar.",
        "hi": "मुझे हाल के खेल में वह पल नहीं मिला।",
    },
    "no_subject": {
        "en": "Nobody has the ball right now; ask about a named player.",
        "es": "Nadie tiene el balón ahora; pregunta por un jugador concreto.",
        "hi": "अभी गेंद किसी के पास नहीं है; किसी नामित खिलाड़ी के बारे में पूछें।",
    },
    "not_understood": {
        "en": "I didn't understand that question about this moment.",
        "es": "No he entendido esa pregunta sobre esta jugada.",
        "hi": "मैं इस पल के बारे में वह सवाल समझ नहीं पाया।",
    },
}


def _reason(key: str, lang: str, **kw: str) -> str:
    return REASONS[key][lang if lang in ("en", "es", "hi") else "en"].format(**kw)


def _unsupported(key: str, lang: str, subject: str | None = None, **kw: str) -> AskIntent:
    return AskIntent(kind="unsupported", subject_id=subject, fork_event_id=None, intervention=None, reason=_reason(key, lang, **kw))


def validate_intent(intent: AskIntent, summary: FrameSummary, lang: str) -> AskIntent:
    """The intent if the engine can answer it, else `unsupported` with a reason in `lang`."""
    if intent.kind == "unsupported":
        return intent if intent.reason else _unsupported("not_understood", lang, intent.subject_id)
    side = {p.id: p.side for p in summary.players}
    iv = intent.intervention
    ids = [i for i in (intent.subject_id, getattr(iv, "player_id", None), getattr(iv, "receiver_id", None)) if i is not None]
    for i in ids:
        if i not in side:
            return _unsupported("not_understood", lang, intent.subject_id if intent.subject_id in side else None)
    if intent.fork_event_id is not None and intent.fork_event_id not in {e.event_id for e in summary.recent}:
        return _unsupported("unknown_event", lang, intent.subject_id)
    if intent.kind == "what_if":
        if not isinstance(iv, AskInterventionSpec1):
            return _unsupported("unsupported_action", lang, intent.subject_id)  # a move_player what-if is a run
        if summary.side_in_possession is not None and side[iv.player_id] != summary.side_in_possession:
            return _unsupported("other_side", lang, intent.subject_id)
        if iv.receiver_id == iv.player_id or side[iv.receiver_id] != side[iv.player_id]:
            return _unsupported("other_side", lang, intent.subject_id)
    elif intent.kind == "explain" and intent.subject_id is None:
        return _unsupported("no_subject", lang)
    return intent


_WHAT_IF = ("what if", "qué pasa si", "que pasa si", "y si", "अगर")
_WHY_NOT = ("why didn't", "why did not", "why didnt", "por qué no", "por que no", "क्यों नहीं")
_PASS = re.compile(r"\bpass|\bpas[eóo]|\bpasar|पास")
_ACTION = re.compile(r"\bshot|\bshoot|\bdribbl|\brun\b|\bran\b|\btir|\bdispar|\bremat|\bregat|\bcorr|शॉट|शूट|ड्रिबल|दौड़|भाग")
_CAPITAL = re.compile(r"(?<![\w'’])([A-ZÁÉÍÓÚÑÜ][\wÁÉÍÓÚÑÜáéíóúñü'’-]+)")
_SENTENCE_START = re.compile(r"(?:^|[.!?¿¡]\s*)\s*$")


def _names(summary: FrameSummary, text: str) -> list[str]:
    """Ids of the players the text names (full name or any name part of 3+ letters), in order of mention."""
    low = text.casefold()
    found: list[tuple[int, str]] = []
    for p in summary.players:
        cands = [p.name, *[t for t in re.split(r"[\s-]+", p.name) if len(t) >= 3]]
        hits = [m.start() for c in cands if (m := re.search(rf"(?<!\w){re.escape(c.casefold())}(?!\w)", low))]
        if hits:
            found.append((min(hits), p.id))
    return [i for _, i in sorted(found)]


def _unknown_name(summary: FrameSummary, text: str) -> str | None:
    """A capitalised word, not opening a sentence, that is no player's name: someone who is not on the pitch."""
    text = re.sub(r"['’]s?\b", "", text)  # "Okafor's" names Okafor
    known = {t.casefold() for p in summary.players for t in re.split(r"[\s-]+", p.name)}
    for m in _CAPITAL.finditer(text):
        w = m.group(1)
        if len(w) < 3 or w.casefold() in known or _SENTENCE_START.search(text[: m.start()]):
            continue
        return w
    return None


def rule_intent(req: AskIntentRequest) -> AskIntent:
    """The deterministic reading of a question (the stub model, and the fallback for a failed model call)."""
    s, lang, text = req.summary, req.lang, req.question
    low = text.casefold()
    what_if = any(k in low for k in _WHAT_IF)
    why_not = any(k in low for k in _WHY_NOT)
    named = _names(s, text)
    holder = s.ball_holder
    if (what_if or why_not) and (unknown := _unknown_name(s, text)):
        return _unsupported("unknown_player", lang, name=unknown)
    if what_if or why_not:
        if len(named) >= 2:
            player, receiver = named[0], named[1]
        elif len(named) == 1 and _PASS.search(low) and (holder is not None and named[0] != holder):
            player, receiver = holder, named[0]  # "what if he passed to Diallo"
        elif len(named) == 1:
            player, receiver = named[0], None
        else:
            player, receiver = holder, None
        mo = s.missed_option
        if why_not and mo is not None and player in (None, mo.passer_id) and (not named or named[-1] in (mo.passer_id, mo.better_to)):
            return validate_intent(
                AskIntent(kind="what_if", subject_id=mo.passer_id, fork_event_id=mo.event_id,
                          intervention=AskInterventionSpec1(kind="pass_to", player_id=mo.passer_id, receiver_id=mo.better_to), reason=None),
                s, lang)
        if what_if and player is not None and receiver is not None and (_PASS.search(low) or not _ACTION.search(low)):
            fork = next((e.event_id for e in reversed(s.recent) if e.type == "pass" and e.player_id == player), None)
            return validate_intent(
                AskIntent(kind="what_if", subject_id=player, fork_event_id=fork,
                          intervention=AskInterventionSpec1(kind="pass_to", player_id=player, receiver_id=receiver), reason=None),
                s, lang)
        if _ACTION.search(low):
            return _unsupported("unsupported_action", lang, player)
        if player is None:
            return _unsupported("no_subject", lang)
        if what_if:
            return _unsupported("not_understood", lang, player)
    subject = named[0] if named else holder
    if subject is None:
        return _unsupported("no_subject", lang)
    return validate_intent(AskIntent(kind="explain", subject_id=subject, fork_event_id=None, intervention=None, reason=None), s, lang)


@stub_responder("ask_intent")
def _stub(payload: dict, _results: list[str]) -> dict:
    return rule_intent(AskIntentRequest.model_validate(payload)).model_dump(mode="json")


class QuestionAgent:
    def __init__(self, client: BaseChatClient, settings: Settings) -> None:
        self.settings = settings
        self.agent = Agent(client=client, name="question", instructions=INSTRUCTIONS, default_options=agent_options(settings))

    async def parse(self, req: AskIntentRequest) -> AskIntent:
        """The intent of the question; never raises (a failed model call gives the rule-based reading)."""
        try:
            out = await run_structured(
                self.agent, "ask_intent", req.model_dump(mode="json"), AskIntent,
                timeout_s=self.settings.timeout("question"), fallback=lambda: rule_intent(req),
            )
            return out.value if out.fallback else validate_intent(out.value, req.summary, req.lang)
        except Exception:
            return rule_intent(req)

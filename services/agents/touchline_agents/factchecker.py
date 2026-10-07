"""Fact-Checker (spec §5.3): checks every number, name and comparison in a draft against the stats server.

Code does the checking. Each claim is checked by kind (metric values with verify_claim or the event's own value,
the score, the minute, events, better options against the decision record) and its quote must be a faithful
rounding of the checked value. A sentence passes when all its claims pass, every number in it is declared, it names
only players involved in the play, and any superlative in it rests on a claim. The model is used only to extract
claims for numbers the Narrator failed to declare. A failing draft gets one retry with the reasons, then its
unverified sentences are dropped.
"""

import re
import time
from dataclasses import dataclass

from agent_framework import Agent, BaseChatClient
from pydantic import BaseModel, ConfigDict

from .config import Settings
from .contracts import Claim, Draft, SentenceCheck, Verdict
from .llm import agent_options, run_structured, stub_responder
from .numbers import matches, numbers_in, read
from .stats import StatsClient, StatsError


def tolerance(actual: float) -> float:
    """The engine's own rule for verify_claim: 2 % of the actual value, at least 0.006."""
    return max(0.006, 0.02 * abs(actual))


# Comparisons that need a number behind them ("the fastest sprint of the match"). Everyday words such as "best"
# ("his best chance") are left alone.
SUPERLATIVES = re.compile(r"\b(highest|lowest|fastest|slowest|fewest|most|least|record|first time|más alt[oa]|más rápid[oa]|récord)\b|सबसे", re.I)
EXTRACT_INSTRUCTIONS = """You extract numeric claims from one sentence of football commentary.
INPUT gives the sentence, the numbers in it that no claim declares, the moment and its frame. For each such number,
return a claim (kind metric with metric_id and subject or event_id, kind score, or kind minute) whose `quote` is the
number exactly as written and whose `sentence` is INPUT's sentence index. If a number cannot be tied to a stats
metric, leave it out: an unexplained number is dropped."""


class Extracted(BaseModel):
    model_config = ConfigDict(extra="forbid")
    claims: list[Claim]


@stub_responder("extract")
def _stub(_payload: dict, _results: list[str]) -> dict:
    return {"claims": []}


@dataclass(frozen=True)
class Check:
    verdict: Verdict
    # Claims the model extracted for undeclared numbers (they were checked like the others).
    extracted: list[Claim]
    # The draft with the extracted claims added: what `published` drops sentences from.
    draft: Draft
    fallback: bool
    ms: float


class FactChecker:
    def __init__(self, client: BaseChatClient, settings: Settings) -> None:
        self.settings = settings
        self.agent = Agent(client=client, name="fact_checker", instructions=EXTRACT_INSTRUCTIONS, default_options=agent_options(settings))

    async def check_claim(self, stats: StatsClient, c: Claim, lang: str, latest: int, clock: str) -> str | None:
        """None when the claim holds, else the reason it does not."""
        if c.at_frame > latest:
            return f"claims frame {c.at_frame}, after the moment (frame {latest})"
        if c.kind in ("event", "better_option") and numbers_in(c.quote):
            return f'an {c.kind} claim states no number, but quotes "{c.quote}"'
        try:
            if c.kind == "metric":
                if c.metric_id is None or c.value is None:
                    return "a metric claim needs metric_id and value"
                if c.event_id is not None:
                    # Events are looked up as of the moment: one struck before `at_frame` may be stamped when it resolves.
                    found = await stats.call("get_events", ids=[c.event_id], to_frame=latest)
                    if not found["events"]:
                        return f"no event {c.event_id} by frame {latest}"
                    actual = found["events"][0]["values"].get(c.metric_id)
                    if actual is None or abs(actual - c.value) > tolerance(actual):
                        return f"{c.metric_id} of {c.event_id} is {actual}, not {c.value}"
                elif c.subject is not None:
                    v = await stats.verify(c.metric_id, c.subject, c.at_frame, c.value, c.window_s)
                    if not v["verified"]:
                        return f"{c.metric_id} for {c.subject} is {v['actual']}, not {c.value}"
                else:
                    return "a metric claim needs a subject or an event"
                if c.quote and not matches(c.quote, c.value, lang):
                    return f'"{c.quote}" does not round {c.value}'
            elif c.kind == "score":
                # The score as it stands at the moment (a recap: at the whistle), home first.
                s = (await stats.match_info(latest))["score"]
                said = [int(x) for x in re.findall(r"\d+", c.quote)]
                if said != [s["home"], s["away"]]:
                    return f"the score is {s['home']}-{s['away']} (home-away), not {c.quote}"
            elif c.kind == "minute":
                minute = int(clock.split(":")[0])
                if c.value is None or not (minute <= c.value <= minute + 1):
                    return f"the moment is in minute {minute + 1}, not {c.value}"
                tokens = numbers_in(c.quote)
                if c.quote and (len(tokens) != 1 or read(tokens[0], lang)[0] != c.value):
                    return f'"{c.quote}" is not minute {c.value:g}'
            elif c.kind == "event":
                found = await stats.call("get_events", ids=[c.event_id], to_frame=latest) if c.event_id else {"events": []}
                if not found["events"]:
                    return f"no event {c.event_id} by frame {latest}"
                if c.subject and c.subject.startswith("p-") and found["events"][0]["player_id"] != c.subject:
                    return f"event {c.event_id} was by {found['events'][0]['player_id']}, not {c.subject}"
            elif c.kind == "better_option":
                if not c.event_id or not c.receiver_id:
                    return "a better option needs event_id and receiver_id"
                d = await stats.decision(c.event_id, latest)
                if d["chosen_rank"] in (None, 1):
                    return f"the pass at {c.event_id} was already the best option"
                if d["best_receiver_id"] != c.receiver_id:
                    return f"the best option at {c.event_id} was {d['best_receiver_id']}, not {c.receiver_id}"
        except StatsError as e:
            return str(e)
        return None

    async def check(
        self, stats: StatsClient, draft: Draft, *, latest: int, clock: str, involved: set[str], attempt: int,
        extract: bool = True,
    ) -> Check:
        """Check a draft. `involved` are the ids of the teams and players the text may name; `attempt` 0 may get a
        retry, a later attempt drops what fails. `extract=False` skips the model (variants are checked by code only)."""
        t0 = time.perf_counter()
        roster = await stats.roster()
        others = other_names(roster, involved)
        claims = list(draft.claims)
        extracted: list[Claim] = []
        fallback = False
        if extract:
            for i, sentence in enumerate(draft.sentences):
                missing = _undeclared(sentence, [c for c in claims if c.sentence == i])
                if not missing:
                    continue
                out = await run_structured(
                    self.agent, "extract",
                    {"sentence": sentence, "index": i, "undeclared": missing, "frame": latest, "clock": clock, "lang": draft.lang},
                    Extracted, timeout_s=self.settings.timeout("factchecker"), fallback=lambda: Extracted(claims=[]),
                )
                fallback |= out.fallback
                new = [c.model_copy(update={"sentence": i}) for c in out.value.claims if c.quote in sentence]
                extracted += new
                claims += new
        reasons: dict[int, list[str]] = {i: [] for i in range(len(draft.sentences))}
        verified = 0
        for c in claims:
            if c.sentence >= len(draft.sentences):
                continue
            if c.quote and not quoted(c.quote, draft.sentences[c.sentence]):
                reasons[c.sentence].append(f'"{c.quote}" is not in the sentence')
                continue
            why = await self.check_claim(stats, c, draft.lang, latest, clock)
            if why:
                reasons[c.sentence].append(why)
            else:
                verified += 1
        undeclared = 0
        for i, sentence in enumerate(draft.sentences):
            mine = [c for c in claims if c.sentence == i]
            for token in _undeclared(sentence, mine):
                undeclared += 1
                reasons[i].append(f'"{token}" is not declared as a claim')
            for name in others:
                if re.search(rf"\b{re.escape(name)}\b", sentence, re.I):
                    reasons[i].append(f"names {name}, who was not involved")
            if SUPERLATIVES.search(sentence) and not any(c.kind in ("metric", "better_option") for c in mine):
                reasons[i].append(f'"{SUPERLATIVES.search(sentence)[0]}" needs a metric claim')
        checks = [SentenceCheck(index=i, verified=not r, reasons=r) for i, r in reasons.items()]
        ok = all(c.verified for c in checks)
        status = "pass" if ok else ("retry" if attempt == 0 else "drop")
        v = Verdict(
            moment_id=draft.moment_id, status=status, sentences=checks, claims_checked=len([c for c in claims if c.sentence < len(draft.sentences)]),
            claims_verified=verified, undeclared=undeclared,
        )
        return Check(v, extracted, draft.model_copy(update={"claims": claims}), fallback, (time.perf_counter() - t0) * 1000)


def quoted(quote: str, text: str) -> bool:
    """Whether `text` says `quote`: the words as written, and each of its numbers as a whole number of the text."""
    return quote in text and set(numbers_in(quote)) <= set(numbers_in(text))


def _undeclared(sentence: str, claims: list[Claim]) -> list[str]:
    """Numbers in the sentence that no claim quotes as a whole number ("7" is not declared by "27%")."""
    declared = {t for c in claims if c.quote for t in numbers_in(c.quote)}
    return [t for t in numbers_in(sentence) if t not in declared]


def other_names(roster: dict, involved: set[str]) -> list[str]:
    """Full names and surnames of rostered players who are not involved (surnames shared with an involved player are
    left out: the text may mean the involved one)."""
    players = [p for side in ("home", "away") for p in roster[side]["players"]]
    allowed = {p["name"].split()[-1] for p in players if p["id"] in involved}
    out = []
    for p in players:
        if p["id"] in involved:
            continue
        out.append(p["name"])
        if p["name"].split()[-1] not in allowed:
            out.append(p["name"].split()[-1])
    return sorted(set(out), key=len, reverse=True)


def feedback(v: Verdict) -> list[str]:
    """The reasons, per sentence, for the Narrator's retry."""
    return [f"sentence {s.index}: {r}" for s in v.sentences for r in s.reasons]


def published(draft: Draft, v: Verdict, headline: str) -> Draft:
    """The draft with its unverified sentences dropped (the headline replaced by `headline`, which states no number,
    when it fails) and the remaining claims renumbered."""
    keep = [s.index for s in v.sentences if s.verified]
    sentences = [draft.sentences[i] for i in keep]
    claims = [c.model_copy(update={"sentence": keep.index(c.sentence)}) for c in draft.claims if c.sentence in keep]
    if 0 not in keep:
        sentences = [headline] + sentences
        claims = [c.model_copy(update={"sentence": c.sentence + 1}) for c in claims]
    return draft.model_copy(update={"sentences": sentences, "claims": claims})

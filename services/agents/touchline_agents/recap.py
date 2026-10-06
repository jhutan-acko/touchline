"""Recap Producer (spec §5.3): half-time and full-time recaps with turning points and a player of the match.

Code gathers the facts over MCP (score, possession, expected goals, pass accuracy, the top players by expected
threat added and by xG, the moments published so far); the model writes the recap from them. The fallback is a
stats-only recap. The Fact-Checker checks a recap like any draft, and the Personalizer turns it into recap cards.
"""

from dataclasses import dataclass

from agent_framework import Agent, BaseChatClient
from pydantic import BaseModel, ConfigDict

from .config import Settings
from .contracts import Claim, Draft, Moment, Recap
from .llm import agent_options, run_structured, stub_responder
from .numbers import format_metric
from .personalizer import LANGS, Story
from .stats import StatsClient, StatsError, names
from .templates import RECAP_HEADLINES

TEAM_METRICS = ["team.poss", "shot.xg", "pass.acc", "tilt"]  # all over the match so far by default
MAX_TURNING_POINTS = 3

INSTRUCTIONS = """You are the Recap Producer for a football broadcast, writing in English.
INPUT has the recap kind (half_time or full_time), the score, team metrics with their values, the top players by
expected threat added (act.xt) and by xG, and the moments published so far (id, clock, type, cause, headline).
Write `sentences`: sentence 0 a headline of at most 10 words, then two to four sentences on how the match has gone
and why. Every number you write must be a value from INPUT, declared in `claims` with `sentence` and `quote` (shares
as percentages such as "54%", the score as "home-away"; kind "metric" with metric_id, subject and value, or kind
"score"). Pick up to three `turning_points` from the moment ids, most decisive first. For full_time name a
`player_of_match` (a player id from the top players); for half_time leave it null."""


class RecapOutput(BaseModel):
    model_config = ConfigDict(extra="forbid")
    sentences: list[str]
    claims: list[Claim]
    turning_points: list[str]
    player_of_match: str | None


@dataclass(frozen=True)
class Told:
    """A published moment, as the recap sees it."""

    moment: Moment
    cause: str
    headline: str


def _claim(at: int, **kw) -> Claim:
    base = dict(kind="metric", sentence=0, quote="", metric_id=None, subject=None, value=None, at_frame=at, window_s=None, event_id=None, receiver_id=None)
    return Claim(**(base | kw))


async def recap_pack(stats: StatsClient, kind: str, at_frame: int, told: list[Told]) -> dict:
    info = await stats.match_info(at_frame)
    roster = await stats.roster()
    home, away = roster["home"]["id"], roster["away"]["id"]
    metrics = []
    for metric_id in TEAM_METRICS:
        for team in (home, away):
            try:
                m = await stats.metric(metric_id, team, at_frame)
            except StatsError:
                continue
            if m["value"] is not None:
                metrics.append({"metric_id": metric_id, "subject": team, "value": m["value"], "at_frame": at_frame})
    top = {}
    for metric_id in ("act.xt", "shot.xg"):
        ranked = await stats.call("rank_players", metric_id=metric_id, at_frame=at_frame, top=3)
        top[metric_id] = [{"player_id": p["player_id"], "value": p["value"]} for p in ranked["players"] if p.get("value") is not None]
    who = names(roster)
    involved = {home, away} | {p["player_id"] for ps in top.values() for p in ps} | {t.moment.player_id for t in told if t.moment.player_id}
    return {
        "kind": kind,
        "at_frame": at_frame,
        "clock": (info.get("latest") or {}).get("match_clock", ""),
        "score": {"home": info["score"]["home"], "away": info["score"]["away"], "home_team": home, "away_team": away},
        "metrics": metrics,
        "top_players": top,
        "moments": [{"id": t.moment.moment_id, "clock": t.moment.match_clock[:5], "type": t.moment.type, "priority": t.moment.priority,
                     "salience": round(t.moment.salience, 3), "cause": t.cause, "headline": t.headline} for t in told if t.moment.frame_id <= at_frame],
        "names": {k: v for k, v in who.items() if k in involved},
    }


def template_recap(pack: dict) -> RecapOutput:
    """The fallback: a stats-only recap (score, possession, expected goals, the player of the match)."""
    at, s, name = pack["at_frame"], pack["score"], pack["names"]
    home, away = name[s["home_team"]], name[s["away_team"]]
    score = f"{s['home']}-{s['away']}"
    lead = "lead" if s["home"] != s["away"] else "are level"
    sentences = [f"{'Half-time' if pack['kind'] == 'half_time' else 'Full-time'}: {home} {score} {away}"]
    claims = [_claim(at, kind="score", quote=score)]
    leader = home if s["home"] > s["away"] else away
    sentences.append(f"{leader} {lead} after a match decided by its key moments." if lead == "lead" else f"{home} and {away} {lead}.")
    by = {(m["metric_id"], m["subject"]): m for m in pack["metrics"]}
    for metric_id, label in (("team.poss", "Possession"), ("shot.xg", "Expected goals")):
        pair = [by.get((metric_id, s["home_team"])), by.get((metric_id, s["away_team"]))]
        if None in pair:
            continue
        quotes = [format_metric(metric_id, m["value"]) for m in pair]
        sentences.append(f"{label}: {home} {quotes[0]}, {away} {quotes[1]}.")
        claims += [_claim(at, sentence=len(sentences) - 1, quote=q, metric_id=metric_id, subject=m["subject"], value=m["value"]) for q, m in zip(quotes, pair)]
    potm = None
    if pack["kind"] == "full_time" and pack["top_players"]["act.xt"]:
        potm = pack["top_players"]["act.xt"][0]["player_id"]
        sentences.append(f"Player of the match: {name.get(potm, potm)}.")
    ranked = sorted(pack["moments"], key=lambda m: (m["priority"], -m["salience"]))
    return RecapOutput(sentences=sentences, claims=claims, turning_points=[m["id"] for m in ranked[:MAX_TURNING_POINTS]], player_of_match=potm)


@stub_responder("recap")
def _stub(payload: dict, _results: list[str]) -> dict:
    return template_recap(payload).model_dump(mode="json")


def acceptable(r: RecapOutput, pack: dict) -> bool:
    ids = {m["id"] for m in pack["moments"]}
    tops = {p["player_id"] for ps in pack["top_players"].values() for p in ps}
    return (
        1 <= len(r.sentences) <= 6 and len(r.turning_points) <= MAX_TURNING_POINTS and set(r.turning_points) <= ids
        and (r.player_of_match is None if pack["kind"] == "half_time" else r.player_of_match in tops)
        and all(c.sentence < len(r.sentences) for c in r.claims)
    )


def recap_story(recap: Recap, pack: dict) -> Story:
    """The recap as a Story for the Personalizer: recap cards anchored at the whistle, headlines without numbers."""
    s, name = pack["score"], pack["names"]
    home, away = name[s["home_team"]], name[s["away_team"]]
    return Story(recap.recap_id, recap.match_id, "recap", None, recap.player_of_match, recap.at_frame, recap.at_frame, pack["clock"][:5], 1,
                 {lang: RECAP_HEADLINES[lang][recap.kind].format(home=home, away=away) for lang in LANGS}, ("recap_card", "recap_card"))


@dataclass(frozen=True)
class Produced:
    output: RecapOutput
    pack: dict
    fallback: bool
    reason: str | None
    ms: float

    def draft(self, recap_id: str) -> Draft:
        return Draft(moment_id=recap_id, lang="en", sentences=self.output.sentences, claims=self.output.claims)


class RecapProducer:
    def __init__(self, client: BaseChatClient, settings: Settings) -> None:
        self.settings = settings
        self.agent = Agent(client=client, name="recap_producer", instructions=INSTRUCTIONS, default_options=agent_options(settings))

    async def produce(self, stats: StatsClient, kind: str, at_frame: int, told: list[Told], feedback: list[str] | None = None, pack: dict | None = None) -> Produced:
        pack = pack or await recap_pack(stats, kind, at_frame, told)
        payload = pack | ({"feedback": feedback} if feedback else {})
        out = await run_structured(
            self.agent, "recap", payload, RecapOutput, timeout_s=self.settings.timeout("recap"),
            fallback=lambda: template_recap(pack), accept=lambda r: acceptable(r, pack),
        )
        return Produced(out.value, pack, out.fallback, out.reason, out.ms)

"""Tactical Analyst (spec §5.3): explains why a moment happened, as a cause and claims with evidence.

Code first gathers an evidence pack over MCP (metrics the moment type calls for, the play's events with what could be
seen of them, decision records of passes that gave the ball away). The model explains from the pack and may query
the stats tools for more; the fallback is a template explanation per moment type built from the same pack. Either
way every number is a value the stats server returned, never one the agent computed.
"""

import json
from dataclasses import dataclass

from agent_framework import Agent, BaseChatClient, FunctionTool, tool

from .config import Settings
from .contracts import Analysis, Claim, Moment, Signal
from .llm import ToolCalls, agent_options, run_structured, stub_responder
from .numbers import format_metric
from .stats import StatsClient, StatsError, names

# The metrics each moment type is explained with: (metric id, subject kind) — subject from the moment.
METRICS_FOR: dict[str, list[tuple[str, str]]] = {
    "goal": [("team.mom", "team")],
    "big_chance": [("team.mom", "team")],
    "pressure_shift": [("team.press", "team"), ("ppda", "team"), ("tilt", "team")],
    "momentum_swing": [("team.mom", "team"), ("tilt", "team")],
    "chaos_spike": [("game.chaos", "match")],
    "card": [("team.mom", "team")],
    "substitution_impact": [("team.mom", "team")],
    "speed_alert": [("plyr.vmax", "player")],
    "distance_milestone": [("plyr.dist", "player")],
    "player_milestone": [],
    "difficult_pass_completed": [("pass.xp", "player")],
    "costly_error": [("pass.acc", "team"), ("game.chaos", "match")],
}
LOOKBACK_S = 15  # the play before a moment: where errors leading to a shot are looked for (spec §5.1.10)
TOUCHES = {"heavy": "heavy touch", "miscontrol": "miscontrol", "missed": "missed touch"}

INSTRUCTIONS = """You are the Tactical Analyst for a live football broadcast.
INPUT is a moment (what the stats engine flagged) and an evidence pack: metric values with refs, the play's events
with qualifiers (execution such as mishit, first_touch such as heavy, under_pressure), decision records, the score and
names. Explain WHY it happened in football terms: control versus chaos, a pressure shift, an error under pressure
versus a good interception, a better option that was missed.
Rules:
- `cause` is one short phrase naming the cause (e.g. "mis-hit pass under pressure", "sustained high press").
- `explanation` is one or two plain sentences with NO digits.
- Every number goes in `claims`, copied from the evidence or from a stats tool you called: kind "metric" with
  metric_id, value and either subject (a team/player id or "match") with at_frame, or event_id for an event's own
  value; kind "event" for an event you rely on; kind "score" with quote "home-away"; kind "better_option" with
  event_id and receiver_id only when a decision record ranks another pass first (chosen_rank > 1).
- `quote` is the number as a viewer would read it (shares as percentages such as "27%"); `sentence` is 0.
- Never invent ids or values. You may call the stats tools for anything the pack lacks; they answer as of the
  moment's frame (INPUT at_frame) at most, never later."""


def _claim(kind: str, at_frame: int, **kw) -> Claim:
    base = dict(kind=kind, sentence=0, quote="", metric_id=None, subject=None, value=None, at_frame=at_frame, window_s=None, event_id=None, receiver_id=None)
    return Claim(**(base | kw))


async def evidence(stats: StatsClient, moment: Moment, signals: list[Signal]) -> dict:
    """The facts an explanation of `moment` may use, all from the stats server as of the moment's last frame."""
    info = await stats.roster()
    at = moment.frame_to
    fps = info["fps"]
    who = names(info)
    subjects = {"team": moment.team_id, "player": moment.player_id, "match": "match"}
    lead = next((s for s in signals if s.id == moment.signal_ids[0]), None)
    wanted = list(METRICS_FOR[moment.type])
    if moment.type == "player_milestone" and lead and lead.metric:
        wanted.append((lead.metric, "player"))
    metrics = []
    for metric_id, kind in wanted:
        subject = subjects[kind]
        if subject is None:
            continue
        try:
            m = await stats.metric(metric_id, subject, at)
        except StatsError:
            continue
        if m["value"] is not None:
            metrics.append({"metric_id": metric_id, "subject": subject, "value": m["value"], "ref": m["ref"], "at_frame": at})
    events = await stats.events(max(0, moment.frame_from - LOOKBACK_S * fps), at, limit=60)
    events = [e for e in events if e["type"] not in ("off_ball_run", "pressure")] if len(events) > 40 else events
    # The events the moment's signals rest on are always in the pack, however busy the play around them.
    cited = [i for s in signals if s.id in moment.signal_ids for i in s.evidence if "@" not in i]
    have = {e["id"] for e in events}
    if missing := [i for i in dict.fromkeys(cited) if i not in have]:
        events = sorted(events + (await stats.call("get_events", ids=missing, to_frame=at))["events"], key=lambda e: e["frame_id"])
    errors = [e["id"] for e in events if e["qualifiers"].get("execution") == "mishit" or e["qualifiers"].get("first_touch") in TOUCHES]
    decisions = []
    for e in events:
        if e["type"] in ("pass", "clearance") and (e["id"] in errors or e["outcome"] not in ("successful", None)) and len(decisions) < 3:
            try:
                d = await stats.decision(e["id"], at)
            except StatsError:
                continue
            decisions.append({k: d[k] for k in ("event_id", "player_id", "chosen_rank", "best_receiver_id", "chosen_receiver_id")})
    score = (await stats.match_info(at))["score"]
    involved = {e.get("player_id") for e in events} | {moment.team_id, moment.player_id, info["home"]["id"], info["away"]["id"]}
    return {
        "moment": moment.model_dump(mode="json"),
        # The lead signal first, then those it absorbed (the moment's own order).
        "signals": [s.model_dump(mode="json", include={"id", "type", "team_id", "player_id", "metric", "value", "data", "evidence"})
                    for i in moment.signal_ids for s in signals if s.id == i],
        "score": {"home": score["home"], "away": score["away"], "home_team": info["home"]["id"], "away_team": info["away"]["id"]},
        "names": {k: v for k, v in who.items() if k in involved},
        "metrics": metrics,
        "events": [{k: e[k] for k in ("id", "type", "match_clock", "frame_id", "team_id", "player_id", "outcome", "values", "qualifiers")} for e in events],
        "errors": errors,
        "decisions": decisions,
        "at_frame": at,
    }


def capped_tools(stats: StatsClient, latest: int) -> list[FunctionTool]:
    """The stats tools a model may call, each answering as of `latest` at most: a model cannot read past the moment
    whatever frame it asks for ("no answer sees the future")."""

    def cap(frame: int | None) -> int:
        return latest if frame is None else min(frame, latest)

    async def ask(name: str, **args) -> str:
        try:
            return json.dumps(await stats.call(name, **args))
        except StatsError as e:
            return f"error: {e}"

    @tool(name="match_info", description="Teams, players, the score and the clock as of a frame (at most the moment's).")
    async def match_info(at_frame: int | None = None) -> str:
        return await ask("match_info", at_frame=cap(at_frame))

    @tool(name="list_metrics", description="Every metric id with its unit, subjects and window.")
    async def list_metrics() -> str:
        return await ask("list_metrics")

    @tool(name="get_metric", description="A metric's value for a subject (\"match\", a team id or a player id) as of a frame.")
    async def get_metric(metric_id: str, subject: str, at_frame: int | None = None, window_s: float | None = None) -> str:
        return await ask("get_metric", metric_id=metric_id, subject=subject, at_frame=cap(at_frame), window_s=window_s)

    @tool(name="rank_players", description="Players ranked by a player metric, optionally for one team.")
    async def rank_players(metric_id: str, team_id: str | None = None, at_frame: int | None = None, top: int = 5) -> str:
        return await ask("rank_players", metric_id=metric_id, team_id=team_id, at_frame=cap(at_frame), top=top)

    @tool(name="get_events", description="Events between two frames with their values and qualifiers (ids usable as evidence).")
    async def get_events(from_frame: int | None = None, to_frame: int | None = None, types: list[str] | None = None,
                         team_id: str | None = None, player_id: str | None = None, limit: int = 50) -> str:
        return await ask("get_events", from_frame=from_frame, to_frame=cap(to_frame), types=types, team_id=team_id, player_id=player_id, limit=limit)

    @tool(name="get_signals", description="Signals the stats engine raised between two frames.")
    async def get_signals(from_frame: int | None = None, to_frame: int | None = None, limit: int = 50) -> str:
        return await ask("get_signals", from_frame=from_frame, to_frame=cap(to_frame), limit=limit)

    @tool(name="get_decision", description="The decision record of an event: options ranked best first and the rank chosen.")
    async def get_decision(event_id: str) -> str:
        return await ask("get_decision", event_id=event_id, at_frame=latest)

    return [match_info, list_metrics, get_metric, rank_players, get_events, get_signals, get_decision]


def _metric_claim(m: dict) -> Claim:
    return _claim("metric", m["at_frame"], quote=format_metric(m["metric_id"], m["value"]), metric_id=m["metric_id"], subject=m["subject"], value=m["value"])


def _error_phrase(e: dict) -> str:
    """"mis-hit clearance under pressure", "heavy touch", ...: what could be seen of an error."""
    q = e["qualifiers"]
    what = f"mis-hit {e['type']}" if q.get("execution") == "mishit" else TOUCHES[q["first_touch"]]
    return f"{what} under pressure" if q.get("under_pressure") else what


def _error_claims(error: dict, pack: dict) -> list[Claim]:
    """The error itself, and the better option when its decision record ranks another pass first."""
    at = pack["at_frame"]
    out = [_claim("event", at, event_id=error["id"], subject=error["player_id"])]
    d = next((d for d in pack["decisions"] if d["event_id"] == error["id"]), None)
    if d and d["chosen_rank"] not in (None, 1) and d["best_receiver_id"]:
        out.append(_claim("better_option", at, event_id=error["id"], receiver_id=d["best_receiver_id"]))
    return out


def _shot_claim(shot: dict | None, at: int) -> list[Claim]:
    if not shot or "shot.xg" not in shot["values"]:
        return []
    xg = shot["values"]["shot.xg"]
    return [_claim("metric", at, quote=format_metric("shot.xg", xg), metric_id="shot.xg", value=xg, event_id=shot["id"])]


def template_analysis(pack: dict) -> Analysis:
    """The fallback: a cause and claims per moment type, from the evidence pack alone."""
    m = pack["moment"]
    at = pack["at_frame"]
    name = pack["names"]
    team = name.get(m["team_id"] or "", "The match")
    claims = [_metric_claim(x) for x in pack["metrics"]]
    by_id = {e["id"]: e for e in pack["events"]}
    t = m["type"]
    if t in ("goal", "big_chance"):
        shot = next((e for e in reversed(pack["events"]) if e["type"] == "shot" and e["team_id"] == m["team_id"]), None)
        error = next((by_id[i] for i in reversed(pack["errors"]) if by_id[i]["team_id"] not in (m["team_id"], None)
                      and (shot is None or by_id[i]["frame_id"] <= shot["frame_id"])), None)
        claims = _shot_claim(shot, at) + claims
        if t == "goal":
            s = pack["score"]
            claims.append(_claim("score", at, quote=f"{s['home']}-{s['away']}"))
        if error:
            cause = _error_phrase(error)
            explanation = f"{name.get(error['team_id'], 'The opponents')} gave the ball away with a {cause} by {name.get(error['player_id'] or '', 'a defender')}, and {team} made them pay."
            claims += _error_claims(error, pack)
        elif t == "big_chance" and shot and shot["outcome"] == "saved":
            cause = "big chance saved by the goalkeeper"
            explanation = f"{team} created a clear chance, but the goalkeeper saved it."
        else:
            xg = shot["values"].get("shot.xg") if shot else None
            cause = "clear chance created" if t == "big_chance" else "clear chance converted" if xg is not None and xg >= 0.3 else "low-probability chance"
            explanation = f"{team} worked the ball into a shooting position from open play."
        return Analysis(moment_id=m["moment_id"], cause=cause, explanation=explanation, claims=claims)
    if t == "costly_error":
        lead = pack["signals"][0]
        error, shot = by_id.get(lead["evidence"][0]), by_id.get(lead["evidence"][-1])
        if error:
            cause = _error_phrase(error)
            explanation = f"{name.get(error['player_id'] or '', 'A player')} gave the ball away with a {cause}, and {name.get(shot['team_id'], 'the opponents') if shot else 'the opponents'} got a shot away."
            claims = _shot_claim(shot, at) + claims + _error_claims(error, pack)
            return Analysis(moment_id=m["moment_id"], cause=cause, explanation=explanation, claims=claims)
    lead = pack["signals"][0] if pack["signals"] else {"data": {}}
    rising = lead["data"].get("after", 0) >= lead["data"].get("before", 0)
    cause, explanation = {
        "pressure_shift": ("sustained high press" if rising else "press dropping off",
                           f"{team} pushed up and pressed higher, forcing the ball back." if rising else f"{team} stopped pressing and sat deeper."),
        "momentum_swing": ("momentum swing", f"{team} took control of the game and moved the play into the opponents' half."),
        "chaos_spike": ("end-to-end spell", "Possession is changing hands quickly and neither side can keep the ball."),
        "card": ("red card" if lead["data"].get("red") else "booking", f"A card for {name.get(m['player_id'] or '', 'a player')} of {team}."),
        "substitution_impact": ("substitution changed the game", f"{team}'s changes shifted the balance of play."),
        "speed_alert": ("top-speed sprint", f"{name.get(m['player_id'] or '', 'A player')} hit top speed on the run."),
        "distance_milestone": ("work rate", f"{name.get(m['player_id'] or '', 'A player')} keeps covering ground."),
        "player_milestone": ("milestone", f"A milestone for {name.get(m['player_id'] or '', 'a player')}."),
        "difficult_pass_completed": ("difficult pass completed", f"{name.get(m['player_id'] or '', 'A player')} found a pass that rarely comes off."),
        "costly_error": ("error leading to a shot", f"{team} gave the ball away and the opponents got a shot away."),
    }[t]
    if t in ("card", "difficult_pass_completed", "player_milestone"):
        for sid in lead.get("evidence", []):
            if sid in by_id:
                claims.append(_claim("event", at, event_id=sid, subject=m["player_id"]))
                ev = by_id[sid]
                if t == "difficult_pass_completed" and "pass.xp" in ev["values"]:
                    claims = [c for c in claims if c.metric_id != "pass.xp"]
                    claims.insert(0, _claim("metric", at, quote=format_metric("pass.xp", ev["values"]["pass.xp"]), metric_id="pass.xp", value=ev["values"]["pass.xp"], event_id=sid))
    return Analysis(moment_id=m["moment_id"], cause=cause, explanation=explanation, claims=claims)


@stub_responder("analyze")
def _stub(payload: dict, results: list[str]) -> dict | ToolCalls:
    # First ask the stats server for something (the stub exercises the model's tool path), then answer like the template.
    if not results and payload["metrics"]:
        m = payload["metrics"][0]
        return ToolCalls([("get_metric", {"metric_id": m["metric_id"], "subject": m["subject"], "at_frame": m["at_frame"]})])
    return template_analysis(payload).model_dump(mode="json")


def acceptable(a: Analysis, moment_id: str) -> bool:
    """Reject output about another moment, or with digits in the explanation (numbers belong in claims)."""
    return a.moment_id == moment_id and not any(ch.isdigit() for ch in a.explanation)


@dataclass(frozen=True)
class AnalystResult:
    analysis: Analysis
    pack: dict
    fallback: bool
    reason: str | None
    ms: float


class Analyst:
    def __init__(self, client: BaseChatClient, settings: Settings) -> None:
        self.client = client
        self.settings = settings

    async def analyze(self, stats: StatsClient, moment: Moment, signals: list[Signal]) -> AnalystResult:
        pack = await evidence(stats, moment, signals)
        agent = Agent(client=self.client, name="tactical_analyst", instructions=INSTRUCTIONS, tools=capped_tools(stats, moment.frame_to), default_options=agent_options(self.settings))
        out = await run_structured(
            agent, "analyze", pack, Analysis, timeout_s=self.settings.timeout("analyst"),
            fallback=lambda: template_analysis(pack), accept=lambda a: acceptable(a, moment.moment_id),
        )
        return AnalystResult(out.value, pack, out.fallback, out.reason, out.ms)

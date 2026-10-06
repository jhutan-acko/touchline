"""Moment Detector (spec §5.3): ranks new signals and promotes the ones worth a cue, with cooldowns.

Code owns the rules that must hold whatever the model says: goals and red cards are always promoted, a signal in its
cooldown never is, signals of the same play merge into one moment, and at most MAX_PER_BATCH moments come out of one
batch. The model only chooses among the remaining candidates; without it, salience decides (the fallback).
"""

from dataclasses import dataclass, field

from agent_framework import Agent, BaseChatClient
from pydantic import BaseModel, ConfigDict

from .config import Settings
from .contracts import Moment, Signal
from .llm import agent_options, run_structured, stub_responder

# Seconds before a signal of the same type for the same team can be promoted again (0: never held back).
COOLDOWN_S: dict[str, float] = {
    "goal": 0, "card": 0, "big_chance": 30, "pressure_shift": 300, "momentum_swing": 300, "chaos_spike": 300,
    "substitution_impact": 300, "difficult_pass_completed": 120, "speed_alert": 300, "player_milestone": 300,
    "distance_milestone": 600, "costly_error": 0,
}
PRIORITY: dict[str, int] = {
    "goal": 1, "big_chance": 2, "pressure_shift": 2, "momentum_swing": 2, "chaos_spike": 2, "substitution_impact": 2,
    "costly_error": 2, "card": 3, "difficult_pass_completed": 3, "speed_alert": 3, "player_milestone": 3, "distance_milestone": 3,
}
PROMOTE_SALIENCE = 0.5  # the rules promote at or above this
CANDIDATE_SALIENCE = 0.25  # the model may promote at or above this
MAX_PER_BATCH = 2
MERGE_S = 10.0  # signals of the same team this close to a promoted one belong to its play

INSTRUCTIONS = """You are the Moment Detector for a live football broadcast overlay.
INPUT lists candidate signals from the stats engine (id, type, team, player, clock, salience 0..1, value, data), the
moments already shown recently, and `max`, the most you may promote. Promote only what a viewer would want a caption
for now: decisive or unusual events (an error that led to a shot, a big chance), clear shifts in pressure or momentum.
Prefer variety over repeating what was just shown. Ids in `must` are always promoted; list them too. Answer with the ids to promote, most important first."""


class Selection(BaseModel):
    model_config = ConfigDict(extra="forbid")
    promote: list[str]


def is_must(s: Signal) -> bool:
    return s.type == "goal" or (s.type == "card" and s.data.get("red", 0) == 1)


def priority(s: Signal) -> int:
    return 1 if is_must(s) else PRIORITY[s.type]


@dataclass
class DetectorState:
    """Per match: when each (type, team) was last promoted, and the moments so far."""

    fps: float
    last: dict[tuple[str, str | None], int] = field(default_factory=dict)
    moments: list[Moment] = field(default_factory=list)

    def cooling(self, s: Signal) -> bool:
        last = self.last.get((s.type, s.team_id))
        return last is not None and s.frame_id - last < COOLDOWN_S[s.type] * self.fps


def candidates(signals: list[Signal], state: DetectorState) -> list[Signal]:
    """Signals that may be promoted, most important first."""
    ok = [s for s in signals if is_must(s) or (s.salience >= CANDIDATE_SALIENCE and not state.cooling(s))]
    return sorted(ok, key=lambda s: (priority(s), -s.salience, s.frame_id))


def rule_selection(cands: list[Signal]) -> list[str]:
    """The fallback: every must, then the most salient above PROMOTE_SALIENCE, at most MAX_PER_BATCH in all."""
    must = [s.id for s in cands if is_must(s)]
    rest = [s.id for s in cands if not is_must(s) and s.salience >= PROMOTE_SALIENCE]
    return must + rest[: max(0, MAX_PER_BATCH - len(must))]


def enforce(chosen: list[str], cands: list[Signal]) -> list[str]:
    """What the model chose, made to obey the rules: known candidates only, musts always, the cap otherwise."""
    known = {s.id for s in cands}
    must = [s.id for s in cands if is_must(s)]
    picked = [i for i in dict.fromkeys(chosen) if i in known and i not in must]
    return must + picked[: max(0, MAX_PER_BATCH - len(must))]


def build_moments(ids: list[str], signals: list[Signal], state: DetectorState, source: str) -> list[Moment]:
    """Turn promoted signal ids into moments (merging the batch's signals of the same play) and update the state."""
    by_id = {s.id: s for s in signals}
    used: set[str] = set()
    out: list[Moment] = []
    gap = MERGE_S * state.fps
    for lead in sorted((by_id[i] for i in ids), key=lambda s: (priority(s), -s.salience)):
        if lead.id in used:
            continue
        play = [lead] + [
            s for s in signals
            if s.id not in used and s.id != lead.id and s.team_id == lead.team_id
            and s.frame_from <= lead.frame_to + gap and lead.frame_from <= s.frame_to + gap
            and priority(s) >= priority(lead)
        ]
        used.update(s.id for s in play)
        for s in play:
            state.last[(s.type, s.team_id)] = s.frame_id
        m = Moment(
            moment_id=f"mo-{lead.id}", match_id=lead.match_id, type=lead.type, signal_ids=[s.id for s in play],
            frame_id=lead.frame_id, frame_from=min(s.frame_from for s in play), frame_to=max(s.frame_to for s in play),
            period=lead.period, match_clock=lead.match_clock, team_id=lead.team_id, player_id=lead.player_id,
            salience=lead.salience, priority=priority(lead), source=source,
        )
        out.append(m)
    state.moments.extend(out)
    return out


def detector_input(cands: list[Signal], state: DetectorState) -> dict:
    return {
        "max": MAX_PER_BATCH,
        "must": [s.id for s in cands if is_must(s)],
        "candidates": [
            {"id": s.id, "type": s.type, "team": s.team_id, "player": s.player_id, "clock": s.match_clock,
             "salience": round(s.salience, 3), "value": s.value, "data": s.data}
            for s in cands
        ],
        "recent": [{"type": m.type, "team": m.team_id, "clock": m.match_clock} for m in state.moments[-5:]],
    }


@stub_responder("detect")
def _stub(payload: dict, _results: list[str]) -> dict:
    ids = payload["must"] + [c["id"] for c in payload["candidates"] if c["id"] not in payload["must"] and c["salience"] >= PROMOTE_SALIENCE]
    return {"promote": ids[: max(payload["max"], len(payload["must"]))]}


@dataclass(frozen=True)
class Detection:
    moments: list[Moment]
    fallback: bool
    reason: str | None
    ms: float


class MomentDetector:
    def __init__(self, client: BaseChatClient, settings: Settings) -> None:
        self.settings = settings
        self.agent = Agent(client=client, name="moment_detector", instructions=INSTRUCTIONS, default_options=agent_options(settings))

    async def detect(self, signals: list[Signal], state: DetectorState) -> Detection:
        cands = candidates(signals, state)
        if not cands:
            return Detection([], False, None, 0.0)
        out = await run_structured(
            self.agent, "detect", detector_input(cands, state), Selection,
            timeout_s=self.settings.timeout("detector"),
            fallback=lambda: Selection(promote=rule_selection(cands)),
        )
        ids = enforce(out.value.promote, cands) if not out.fallback else out.value.promote
        moments = build_moments(ids, signals, state, "rules" if out.fallback else "model")
        return Detection(moments, out.fallback, out.reason, out.ms)

"""Pitch-marker cues: the overlay drawn on the pitch beside a moment's text cue.

Convention (shared with the web reader): `display.slot = "pitch_marker"`, `display.template` one of `pressure_ring`,
`pass_arc`, `ghost`; players are `data` keys with value 1 (`at:<id>`, `from:<id>`, `to:<id>`); numbers are `count`
(pressers, omitted when unknown) and `x`, `y` (the ghost point, pitch metres). The marker keeps its text cue's anchor, moment, segment,
ttl and `verified`; it has no text.
"""

from typing import TYPE_CHECKING

from .contracts import Cue, Segment

if TYPE_CHECKING:
    from .personalizer import Story


def _template(story: "Story") -> tuple[str, dict[str, float]] | None:
    # Story.positions is unfilled in production, so a ghost anchors on its `at:` receiver, which the web resolves.
    # 1. A better option the Fact-Checker passed: a ghost at the receiver.
    for c in story.claims:
        if c.kind == "better_option" and c.receiver_id:
            data = {f"at:{c.receiver_id}": 1.0}
            if xy := story.positions.get(c.receiver_id):
                data |= {"x": xy[0], "y": xy[1]}
            return "ghost", data
    # 2. Pressure: a ring on the ball holder (else the subject), with how many press.
    for c in story.claims:
        if c.kind == "metric" and c.metric_id and "press" in c.metric_id:
            return "pressure_ring", _ring(story, c.subject, c.value, {})
    for s in story.signals:
        if s.metric and "press" in s.metric:
            return "pressure_ring", _ring(story, s.player_id or s.team_id, s.value, s.data)
    # 3. A pass with a receiver: an arc from the passer to the receiver.
    if story.passes:
        passer, receiver = story.passes[-1]
        return "pass_arc", {f"from:{passer}": 1.0, f"to:{receiver}": 1.0}
    return None


def _ring(story: "Story", subject: str | None, value: float | None, data: dict[str, float]) -> dict[str, float]:
    who = story.player_id or subject
    # How many press: the `pressers` datum, else the value when it can only be a count (team.press is a 0-1 share, so
    # a value of at most 1 is not one). Without either the ring carries no number (the web draws it bare).
    count = data.get("pressers", value if value is not None and value > 1 else None)
    out: dict[str, float] = {} if count is None else {"count": float(max(1, round(count)))}
    if who:
        out[f"at:{who}"] = 1.0
    return out


def marker_cue(story: "Story", segment: Segment, base: Cue) -> Cue | None:
    """The pitch marker that goes with `base`, or None. Casual viewers get one only for a top-priority moment."""
    if segment.mode == "casual" and base.display.priority != 1:
        return None
    if (found := _template(story)) is None:
        return None
    template, data = found
    return Cue.model_validate({
        "cue_id": f"{base.cue_id}:m",
        "schema": "touchline.cue/1",
        "match_id": base.match_id,
        "moment_id": base.moment_id,
        "anchor": base.anchor.model_dump(mode="json"),
        "display": {"slot": "pitch_marker", "priority": base.display.priority, "ttl_ms": base.display.ttl_ms, "template": template},
        "segment": base.segment.model_dump(mode="json"),
        "text": None,
        "data": data,
        "evidence": list(base.evidence),
        "verified": base.verified,
    })


def passes_in(events: list[dict], frame_to: int, team_id: str | None) -> tuple[tuple[str, str], ...]:
    """(passer, receiver) of the passes with a receiver up to `frame_to`, oldest first; the moment's team's if it has any."""
    found = [(e, (e["player_id"], str(e["qualifiers"]["receiver_id"]))) for e in events
             if e["type"] == "pass" and e["frame_id"] <= frame_to and e.get("player_id") and e["qualifiers"].get("receiver_id")]
    ours = [p for e, p in found if team_id is not None and e.get("team_id") == team_id]
    return tuple(ours or [p for _, p in found])

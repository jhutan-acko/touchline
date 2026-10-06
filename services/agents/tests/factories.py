"""Hand-built contract values for unit tests."""

from touchline_agents.contracts import Analysis, Claim, Moment, Signal


def signal(type_: str, frame: int, *, team: str | None = "home-fc", player: str | None = None, salience: float = 0.6, span: int = 0, **data: float) -> Signal:
    return Signal(
        id=f"m-{type_}-{frame}-{team}", match_id="m", type=type_, frame_id=frame, frame_from=frame - span, frame_to=frame,
        period="first_half" if frame < 30000 else "second_half", match_clock=f"{frame // 600:02d}:{frame % 600 // 10:02d}.00",
        team_id=team, player_id=player, metric=None, value=None, salience=salience, evidence=[], data=data,
    )


def moment(type_: str = "goal", frame: int = 3000, team: str | None = "home-fc", player: str | None = None, span: int = 50) -> Moment:
    return Moment(
        moment_id=f"mo-{type_}-{frame}", match_id="m", type=type_, signal_ids=[f"m-{type_}-{frame}"], frame_id=frame,
        frame_from=frame - span, frame_to=frame, period="first_half" if frame < 30000 else "second_half",
        match_clock=f"{frame // 600:02d}:{frame % 600 // 10:02d}.00", team_id=team, player_id=player, salience=0.9,
        priority=1, source="rules",
    )


def claim(kind: str = "metric", **kw) -> Claim:
    base = dict(kind=kind, sentence=0, quote="", metric_id=None, subject=None, value=None, at_frame=3000, window_s=None, event_id=None, receiver_id=None)
    return Claim(**(base | kw))


def analysis(moment_id: str = "mo-goal-3000", cause: str = "low-probability chance", claims: list[Claim] | None = None) -> Analysis:
    return Analysis(
        moment_id=moment_id, cause=cause, explanation="Home FC worked the ball into a shooting position from open play.",
        claims=claims if claims is not None else [
            claim(quote="0.12", metric_id="shot.xg", value=0.1234, event_id="m-e10"),
            claim("score", quote="1-0"),
            claim(quote="58%", metric_id="team.mom", subject="home-fc", value=0.58),
        ],
    )


NAMES = {"home-fc": "Home FC", "away-fc": "Away Town", "h9": "Ada Striker", "a4": "Bo Keeper"}

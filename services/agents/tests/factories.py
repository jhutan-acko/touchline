"""Hand-built contract values for unit tests."""

from touchline_agents.contracts import Moment, Signal


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

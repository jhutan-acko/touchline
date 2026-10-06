"""One match's agents and state: the six agents, the stats connection, the detector's memory, the moments told."""

from dataclasses import dataclass, field

from .analyst import Analyst
from .config import Settings
from .contracts import Segment
from .detector import DetectorState, MomentDetector
from .factchecker import FactChecker
from .llm import make_client
from .narrator import Narrator
from .personalizer import Personalizer
from .recap import RecapProducer, Told
from .stats import StatsClient


@dataclass
class Agents:
    detector: MomentDetector
    analyst: Analyst
    narrator: Narrator
    factchecker: FactChecker
    personalizer: Personalizer
    recap: RecapProducer

    @staticmethod
    def make(settings: Settings) -> "Agents":
        """Small-tier models for the live agents, the large tier for the Analyst and recaps (spec §5.3)."""
        small, large = make_client(settings, "small"), make_client(settings, "large")
        return Agents(
            MomentDetector(small, settings), Analyst(large, settings), Narrator(small, settings),
            FactChecker(small, settings), Personalizer(small, settings), RecapProducer(large, settings),
        )


@dataclass
class MatchSession:
    match_id: str
    settings: Settings
    stats: StatsClient
    agents: Agents
    segments: list[Segment]
    fps: float
    detector: DetectorState
    told: list[Told] = field(default_factory=list)

    @staticmethod
    async def open(match_id: str, mcp_url: str, segments: list[Segment], settings: Settings, agents: Agents | None = None) -> "MatchSession":
        """Connect to the match's stats server (only on an allowed host) and set up its agents."""
        stats = StatsClient(mcp_url, settings.mcp_allowed_hosts)
        await stats.__aenter__()
        info = await stats.roster()
        if info["match_id"] != match_id:
            await stats.__aexit__(None, None, None)
            raise ValueError(f"the stats server at {mcp_url} serves {info['match_id']}, not {match_id}")
        fps = info["fps"]
        return MatchSession(match_id, settings, stats, agents or Agents.make(settings), list(segments), fps, DetectorState(fps=fps))

    async def close(self) -> None:
        await self.stats.__aexit__(None, None, None)

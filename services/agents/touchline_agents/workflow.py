"""The agent workflow (spec §5.3) as a Microsoft Agent Framework graph:

    moment_detector -> tactical_analyst -> narrator -> fact_checker --(retry, at most once)--> narrator
                                                                  \\--> personalizer_casual  --\\
                                                                   \\-> personalizer_analyst --> publisher

One run takes a batch of new signals; every promoted moment flows through the graph and comes out of the publisher
as a MomentResult (its verified cues and its trace). Checkpoints go to `TOUCHLINE_CHECKPOINTS/<match>` when set.
Recaps are a short sequence on the same agents (`run_recap`).
"""

import time
from collections.abc import AsyncIterator
from dataclasses import dataclass, field

from agent_framework import Executor, FileCheckpointStorage, Workflow, WorkflowBuilder, WorkflowContext, handler
from pydantic import BaseModel
from typing_extensions import Never

from . import contracts_gen
from .contracts import Analysis, Cue, Draft, Moment, MomentTrace, Recap, Signal, Verdict, segment_key
from .factchecker import feedback, other_names, published
from .personalizer import Story
from .recap import Told, recap_story
from .session import MatchSession
from .templates import headline


@dataclass
class Batch:
    signals: list[Signal]


@dataclass
class Job:
    moment: Moment
    signals: list[Signal]
    timings: dict[str, float] = field(default_factory=dict)
    fallbacks: list[str] = field(default_factory=list)


@dataclass
class Narration:
    job: Job
    analysis: Analysis
    pack: dict
    attempt: int = 0
    feedback: list[str] = field(default_factory=list)
    verdicts: list[Verdict] = field(default_factory=list)


@dataclass
class Drafted:
    narration: Narration
    draft: Draft


@dataclass
class Verified:
    narration: Narration
    draft: Draft  # the last draft narrated (with any extracted claims)
    published: Draft  # what survives the Fact-Checker


@dataclass
class Variants:
    verified: Verified
    mode: str
    cues: list[Cue]
    fallback: bool
    ms: float


@dataclass
class MomentResult:
    trace: MomentTrace
    cues: list[Cue]


MESSAGES = [Batch, Job, Narration, Drafted, Verified, Variants, MomentResult]
# Every type a checkpoint may hold must be allowed by name, or the checkpoint is skipped (Agent Framework allow-list).
CHECKPOINT_TYPES = [f"{t.__module__}:{t.__qualname__}" for t in MESSAGES] + [
    f"{t.__module__}:{t.__qualname__}" for t in vars(contracts_gen).values() if isinstance(t, type) and issubclass(t, BaseModel) and t is not BaseModel
]


def _ms(t0: float) -> float:
    return (time.perf_counter() - t0) * 1000


class Detect(Executor):
    def __init__(self, s: MatchSession) -> None:
        super().__init__(id="moment_detector")
        self.s = s

    @handler
    async def run(self, batch: Batch, ctx: WorkflowContext[Job]) -> None:
        out = await self.s.agents.detector.detect(batch.signals, self.s.detector)
        for m in out.moments:
            await ctx.send_message(Job(m, batch.signals, {"detector": out.ms}, ["moment_detector"] if out.fallback else []))


class Analyze(Executor):
    def __init__(self, s: MatchSession) -> None:
        super().__init__(id="tactical_analyst")
        self.s = s

    @handler
    async def run(self, job: Job, ctx: WorkflowContext[Narration]) -> None:
        out = await self.s.agents.analyst.analyze(self.s.stats, job.moment, job.signals)
        job.timings["analyst"] = out.ms
        if out.fallback:
            job.fallbacks.append("tactical_analyst")
        await ctx.send_message(Narration(job, out.analysis, out.pack))


class Narrate(Executor):
    def __init__(self, s: MatchSession) -> None:
        super().__init__(id="narrator")
        self.s = s

    @handler
    async def run(self, n: Narration, ctx: WorkflowContext[Drafted]) -> None:
        out = await self.s.agents.narrator.narrate(n.job.moment, n.analysis, n.pack["names"], n.feedback or None)
        n.job.timings[f"narrator{'_retry' if n.attempt else ''}"] = out.ms
        if out.fallback:
            n.job.fallbacks.append("narrator")
        await ctx.send_message(Drafted(n, out.draft))


class FactCheck(Executor):
    def __init__(self, s: MatchSession) -> None:
        super().__init__(id="fact_checker")
        self.s = s

    @handler
    async def run(self, d: Drafted, ctx: WorkflowContext[Narration | Verified]) -> None:
        n, m = d.narration, d.narration.job.moment
        out = await self.s.agents.factchecker.check(
            self.s.stats, d.draft, latest=m.frame_to, clock=m.match_clock, involved=set(n.pack["names"]), attempt=n.attempt,
        )
        n.job.timings[f"factchecker{'_retry' if n.attempt else ''}"] = out.ms
        verdicts = [*n.verdicts, out.verdict]
        if out.verdict.status == "retry":
            await ctx.send_message(Narration(n.job, n.analysis, n.pack, n.attempt + 1, feedback(out.verdict), verdicts))
            return
        head = headline(m.model_dump(mode="json"), n.analysis.cause, n.pack["names"])
        n = Narration(n.job, n.analysis, n.pack, n.attempt, n.feedback, verdicts)
        await ctx.send_message(Verified(n, out.draft, published(out.draft, out.verdict, head)))


def route(message: object, targets: list[str]) -> list[str]:
    """The fact-checker's edges: a retry goes back to the narrator, a verified draft to both personalizers."""
    if isinstance(message, Narration):
        return ["narrator"]
    return [t for t in targets if t.startswith("personalizer_")]


class Personalize(Executor):
    def __init__(self, s: MatchSession, mode: str) -> None:
        super().__init__(id=f"personalizer_{mode}")
        self.s, self.mode = s, mode

    @handler
    async def run(self, v: Verified, ctx: WorkflowContext[Variants]) -> None:
        t0 = time.perf_counter()
        n = v.narration
        segments = [s for s in self.s.segments if s.mode == self.mode]
        names = n.pack["names"]
        others = other_names(await self.s.stats.roster(), set(names))
        story = Story.of_moment(n.job.moment, n.analysis.cause, names, n.analysis.explanation)
        evidence = list(dict.fromkeys(e for s in n.job.signals if s.id in n.job.moment.signal_ids for e in s.evidence))
        out = await self.s.agents.personalizer.fan_out(story, v.published, names, segments, others, evidence) if segments else []
        await ctx.send_message(Variants(v, self.mode, [p.cue for p in out], any(p.fallback for p in out), _ms(t0)))


class Publish(Executor):
    """Fan-in: once both personalizers have answered for a moment, emit its cues and trace."""

    def __init__(self, s: MatchSession) -> None:
        super().__init__(id="publisher")
        self.s = s
        self.pending: dict[str, list[Variants]] = {}

    @handler
    async def run(self, parts: list[Variants], ctx: WorkflowContext[Never, MomentResult]) -> None:
        for p in parts:
            got = self.pending.setdefault(p.verified.narration.job.moment.moment_id, [])
            got.append(p)
            if len(got) < 2:
                continue
            del self.pending[p.verified.narration.job.moment.moment_id]
            n = p.verified.narration
            job = n.job
            for g in got:
                job.timings[f"personalizer_{g.mode}"] = g.ms
                if g.fallback and "personalizer" not in job.fallbacks:
                    job.fallbacks.append("personalizer")
            order = {segment_key(seg): i for i, seg in enumerate(self.s.segments)}
            cues = sorted((c for g in got for c in g.cues), key=lambda c: order.get(segment_key(c.segment), len(order)))
            trace = MomentTrace(
                moment=job.moment, analysis=n.analysis, draft=p.verified.draft, verdicts=n.verdicts, fallbacks=job.fallbacks,
                cue_ids=[c.cue_id for c in cues], timings_ms=job.timings, model=self.s.settings.model_label,
            )
            self.s.told.append(Told(job.moment, n.analysis.cause, p.verified.published.sentences[0]))
            await ctx.yield_output(MomentResult(trace, cues))


def build(session: MatchSession) -> Workflow:
    detect, analyze, narrate, check = Detect(session), Analyze(session), Narrate(session), FactCheck(session)
    casual, analyst, publish = Personalize(session, "casual"), Personalize(session, "analyst"), Publish(session)
    storage = None
    if session.settings.checkpoint_dir is not None:
        storage = FileCheckpointStorage(str(session.settings.checkpoint_dir / session.match_id), allowed_checkpoint_types=CHECKPOINT_TYPES)
    return (
        WorkflowBuilder(name="touchline-moments", start_executor=detect, checkpoint_storage=storage, output_from=[publish])
        .add_edge(detect, analyze)
        .add_edge(analyze, narrate)
        .add_edge(narrate, check)
        .add_multi_selection_edge_group(check, [narrate, casual, analyst], route)
        .add_fan_in_edges([casual, analyst], publish)
        .build()
    )


async def run_moments(workflow: Workflow, signals: list[Signal]) -> AsyncIterator[MomentResult]:
    """Run one batch, yielding each moment's result as soon as it is published."""
    async for event in workflow.run(Batch(signals), stream=True):
        if event.type == "output" and isinstance(event.data, MomentResult):
            yield event.data


@dataclass
class RecapResult:
    recap: Recap
    cues: list[Cue]
    verdicts: list[Verdict]
    fallbacks: list[str]


async def run_recap(s: MatchSession, kind: str, at_frame: int) -> RecapResult:
    """Recap Producer -> Fact-Checker (one retry) -> Personalizer fan-out to recap cards."""
    a = s.agents
    recap_id = f"{s.match_id}-recap-{kind}"
    made = await a.recap.produce(s.stats, kind, at_frame, s.told)
    fallbacks = ["recap_producer"] if made.fallback else []
    involved = set(made.pack["names"])
    check = await a.factchecker.check(s.stats, made.draft(recap_id), latest=at_frame, clock=made.pack["clock"], involved=involved, attempt=0)
    verdicts = [check.verdict]
    if check.verdict.status == "retry":
        made = await a.recap.produce(s.stats, kind, at_frame, s.told, feedback=feedback(check.verdict), pack=made.pack)
        check = await a.factchecker.check(s.stats, made.draft(recap_id), latest=at_frame, clock=made.pack["clock"], involved=involved, attempt=1)
        verdicts.append(check.verdict)
    story_head = made.output.sentences[0] if check.verdict.sentences[0].verified else f"{'Half-time' if kind == 'half_time' else 'Full-time'}"
    final = published(check.draft, check.verdict, story_head)
    recap = Recap(recap_id=recap_id, match_id=s.match_id, kind=kind, at_frame=at_frame, sentences=final.sentences, claims=final.claims,
                  turning_points=made.output.turning_points, player_of_match=made.output.player_of_match, verified=True)
    others = other_names(await s.stats.roster(), involved)
    cards = await a.personalizer.fan_out(recap_story(recap, made.pack), final, made.pack["names"], s.segments, others, [])
    if any(c.fallback for c in cards):
        fallbacks.append("personalizer")
    return RecapResult(recap, [c.cue for c in cards], verdicts, fallbacks)

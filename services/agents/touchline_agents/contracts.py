"""The agent contracts (generated from packages/schema, spec §4.1) plus the helpers the TypeScript side also has."""

from typing import Annotated

from pydantic import BaseModel, Field, TypeAdapter

from .contracts_gen import (
    Analysis,
    Anchor,
    AskAnswerRequest,
    AskArms,
    AskIntent,
    AskIntentRequest,
    AskInterventionSpec1,
    AskInterventionSpec2,
    AskReply,
    AskStage,
    AskWhatIf,
    Claim,
    Cue,
    Display,
    Draft,
    EvidenceChip,
    FrameSummary,
    ManagerReply,
    ManageRequest,
    Moment,
    MomentTrace,
    Recap,
    RecapRequest,
    Segment,
    SentenceCheck,
    Signal,
    SignalsRequest,
    Text,
    Verdict,
)

__all__ = [
    "MAX_SEGMENTS", "AgentRequest", "Analysis", "Anchor", "Claim", "Cue", "Display", "Draft", "ManageRequest", "ManagerReply",
    "AskAnswerRequest", "AskArms", "AskIntent", "AskIntentRequest", "AskInterventionSpec", "AskReply", "AskStage", "AskWhatIf",
    "EvidenceChip", "FrameSummary", "Moment", "MomentTrace",
    "Recap", "RecapRequest", "Segment", "SentenceCheck", "Signal", "SignalsRequest", "Text", "Verdict",
    "dump", "parse_request", "segment_key",
]

MAX_SEGMENTS = 12

AskInterventionSpec = AskInterventionSpec1 | AskInterventionSpec2
AgentRequest = Annotated[
    SignalsRequest | RecapRequest | ManageRequest | AskIntentRequest | AskAnswerRequest, Field(discriminator="kind")
]
_request = TypeAdapter(AgentRequest)


def parse_request(data: object) -> SignalsRequest | RecapRequest | ManageRequest | AskIntentRequest | AskAnswerRequest:
    """Validate the data part of an A2A message (raises pydantic.ValidationError)."""
    return _request.validate_python(data)


def segment_key(s: Segment) -> str:
    """`mode.lang.club`, `neutral` when there is no club: the cache key of a segment's variants (spec §5.5)."""
    return f"{s.mode}.{s.lang}.{s.club or 'neutral'}"


def dump(model: BaseModel) -> dict:
    """A contract as JSON-ready data with its wire names (the cue's `schema` field is `schema_` in Python)."""
    return model.model_dump(mode="json", by_alias=True)

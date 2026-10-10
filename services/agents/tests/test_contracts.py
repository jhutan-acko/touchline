import json
from pathlib import Path

import pytest
from pydantic import TypeAdapter, ValidationError

from touchline_agents import contracts as c
from touchline_agents.contracts_gen import AgentContracts

FIXTURES = Path(__file__).resolve().parents[3] / "packages/schema/fixtures/agents"
# The same contract names as the TypeScript bundle (AgentContracts' fields).
ADAPTERS = {name: TypeAdapter(field.annotation) for name, field in AgentContracts.model_fields.items()}


def load(kind: str) -> list[tuple[str, dict]]:
    return [(p.name, json.loads(p.read_text())) for p in sorted((FIXTURES / kind).glob("*.json"))]


@pytest.mark.parametrize(("name", "fixture"), load("valid"))
def test_valid_fixture_round_trips(name, fixture):
    adapter = ADAPTERS[fixture["contract"]]
    value = adapter.validate_python(fixture["value"])
    # What Python writes back must be exactly what TypeScript wrote: same keys (by alias: `schema`), same values.
    assert adapter.dump_python(value, mode="json", by_alias=True) == fixture["value"]


@pytest.mark.parametrize(("name", "fixture"), load("invalid"))
def test_invalid_fixture_rejected(name, fixture):
    with pytest.raises(ValidationError):
        ADAPTERS[fixture["contract"]].validate_python(fixture["value"])


def test_requests_parse_by_kind():
    kinds = sorted(c.parse_request(f["value"]).kind for _, f in load("valid") if f["contract"] == "request")
    assert kinds == ["manage", "manage", "recap", "signals"]


def test_segment_key_matches_typescript():
    assert c.segment_key(c.Segment(mode="analyst", lang="hi", club=None)) == "analyst.hi.neutral"
    assert c.segment_key(c.Segment(mode="casual", lang="es", club="ironmoor")) == "casual.es.ironmoor"


def test_dump_uses_wire_names():
    _, cue = next(f for f in load("valid") if f[0] == "cue.json")
    assert c.dump(c.Cue.model_validate(cue["value"]))["schema"] == "touchline.cue/1"


def test_unknown_fields_rejected():
    _, cue = next(f for f in load("valid") if f[0] == "cue.json")
    with pytest.raises(ValidationError):
        c.Cue.model_validate({**cue["value"], "colour": "red"})


def test_generated_models_match_schema(tmp_path):
    import sys

    sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))
    from gen_contracts import OUTPUT, generate

    generate(tmp_path / "gen.py")
    assert (tmp_path / "gen.py").read_text() == OUTPUT.read_text(), "run scripts/gen_contracts.py after changing the contracts"

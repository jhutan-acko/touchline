"""Generate touchline_agents/contracts_gen.py from the JSON Schema that packages/schema exports.

Run after `pnpm --filter @touchline/schema json`:  uv run python scripts/gen_contracts.py
"""

import subprocess
import sys
from pathlib import Path

AGENTS = Path(__file__).resolve().parents[1]
SCHEMA = AGENTS.parents[1] / "packages/schema/json/agent-contracts.schema.json"
OUTPUT = AGENTS / "touchline_agents/contracts_gen.py"
ARGS = [
    "--input-file-type", "jsonschema",
    "--output-model-type", "pydantic_v2.BaseModel",
    "--target-python-version", "3.12",
    "--enum-field-as-literal", "all",
    "--use-standard-collections",
    "--use-union-operator",
    "--collapse-root-models",
    "--extra-fields", "forbid",
    "--use-double-quotes",
    "--disable-timestamp",
    "--formatters", "builtin",
]


def generate(output: Path) -> None:
    """Write the Pydantic models for every contract to `output`."""
    subprocess.run(
        [sys.executable, "-m", "datamodel_code_generator", "--input", str(SCHEMA), "--output", str(output), *ARGS],
        check=True,
        capture_output=True,
    )


if __name__ == "__main__":
    generate(OUTPUT)
    print(f"wrote {OUTPUT.relative_to(AGENTS)}")

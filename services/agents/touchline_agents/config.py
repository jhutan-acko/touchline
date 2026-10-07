"""One config for the agent service (spec §5.3 "behind one config file"): model provider, models per tier, timeouts.

Values come from the environment, then from the repo's git-ignored `.env.local` (never committed, never logged).
"""

import os
from collections.abc import Mapping
from dataclasses import dataclass, field
from pathlib import Path
from typing import Literal

REPO = Path(__file__).resolve().parents[3]
ENV_FILE = REPO / ".env.local"

Provider = Literal["stub", "openai"]
Tier = Literal["small", "large"]
Effort = Literal["low", "medium", "high"]

# Both tiers default to the same model; set TOUCHLINE_MODEL_SMALL / TOUCHLINE_MODEL_LARGE to split them.
DEFAULT_MODEL = "gpt-6.1-sol"
# gpt-6.1-sol rejects "none" and "minimal"; "low" is its fastest (about 5 s for a short structured answer, 2026-10-07).
DEFAULT_EFFORT: Effort = "low"

# Seconds each agent may take before its deterministic fallback is used (spec §6). The whole moment must fit the
# gateway's 4 s budget when live; recorded runs (cached replay) can raise these with TOUCHLINE_TIMEOUT_SCALE.
TIMEOUTS_S: Mapping[str, float] = {
    "detector": 1.5,
    "analyst": 6.0,
    "narrator": 3.0,
    "factchecker": 2.0,
    "personalizer": 3.0,
    "recap": 20.0,
    "judge": 20.0,
}


class SettingsError(Exception):
    """The configuration cannot work (e.g. the OpenAI provider without a key)."""


@dataclass(frozen=True)
class Settings:
    provider: Provider
    small_model: str
    large_model: str
    timeout_scale: float
    mcp_allowed_hosts: frozenset[str]
    checkpoint_dir: Path | None
    reasoning_effort: Effort = DEFAULT_EFFORT
    # Seconds the service may spend on one request before every remaining agent uses its fallback (live runs).
    request_budget_s: float | None = None
    # Kept out of repr so the key never reaches a log line or a test report.
    openai_api_key: str | None = field(default=None, repr=False)

    def model(self, tier: Tier) -> str:
        return self.small_model if tier == "small" else self.large_model

    def timeout(self, agent: str) -> float:
        return TIMEOUTS_S[agent] * self.timeout_scale

    @property
    def model_label(self) -> str:
        """What produced the text, recorded with every trace: `stub`, or the provider and models."""
        if self.provider == "stub":
            return "stub"
        return f"openai:{self.small_model}" if self.small_model == self.large_model else f"openai:{self.small_model}+{self.large_model}"


def read_env_file(path: Path) -> dict[str, str]:
    """KEY=VALUE lines (blank lines, comments and an optional `export ` prefix allowed; quotes stripped)."""
    if not path.is_file():
        return {}
    out: dict[str, str] = {}
    for line in path.read_text().splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.removeprefix("export ").split("=", 1)
        out[key.strip()] = value.strip().strip("'\"")
    return out


def load_settings(env: Mapping[str, str] | None = None, env_file: Path | None = ENV_FILE) -> Settings:
    """Settings from `env` (default: os.environ), falling back to `env_file` for anything unset."""
    merged = {**(read_env_file(env_file) if env_file else {}), **(os.environ if env is None else env)}
    provider = merged.get("TOUCHLINE_LLM", "stub")
    if provider not in ("stub", "openai"):
        raise SettingsError(f'TOUCHLINE_LLM must be "stub" or "openai", not "{provider}"')
    key = merged.get("OPENAI_API_KEY") or None
    if provider == "openai" and not key:
        raise SettingsError("TOUCHLINE_LLM=openai needs OPENAI_API_KEY (in the environment or in the repo's .env.local)")
    try:
        scale = float(merged.get("TOUCHLINE_TIMEOUT_SCALE", "1"))
    except ValueError:
        raise SettingsError("TOUCHLINE_TIMEOUT_SCALE must be a number") from None
    if not scale > 0:
        raise SettingsError("TOUCHLINE_TIMEOUT_SCALE must be positive")
    effort = merged.get("TOUCHLINE_REASONING", DEFAULT_EFFORT)
    if effort not in ("low", "medium", "high"):
        raise SettingsError(f'TOUCHLINE_REASONING must be low, medium or high, not "{effort}"')
    budget = merged.get("TOUCHLINE_REQUEST_BUDGET_S")
    try:
        budget_s = float(budget) if budget else None
    except ValueError:
        raise SettingsError("TOUCHLINE_REQUEST_BUDGET_S must be a number of seconds") from None
    hosts = merged.get("TOUCHLINE_MCP_HOSTS", "127.0.0.1,localhost,::1")
    cp = merged.get("TOUCHLINE_CHECKPOINTS")
    return Settings(
        provider=provider,
        small_model=merged.get("TOUCHLINE_MODEL_SMALL", DEFAULT_MODEL),
        large_model=merged.get("TOUCHLINE_MODEL_LARGE", DEFAULT_MODEL),
        timeout_scale=scale,
        mcp_allowed_hosts=frozenset(h.strip() for h in hosts.split(",") if h.strip()),
        checkpoint_dir=Path(cp) if cp else None,
        reasoning_effort=effort,
        request_budget_s=budget_s,
        openai_api_key=key,
    )

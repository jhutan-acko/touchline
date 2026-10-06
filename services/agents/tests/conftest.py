"""Shared fixtures: one simulated match (scenario `costly_error`, seed 2) and its MCP stats server, once per session."""

import json
import subprocess
from pathlib import Path

import pytest

from touchline_agents.config import REPO
from touchline_agents.stats import StatsClient, serve_run

MATCH_ID = "agents-test"


@pytest.fixture(scope="session")
def run_dir(tmp_path_factory) -> Path:
    out = tmp_path_factory.mktemp("runs") / MATCH_ID
    subprocess.run(
        ["pnpm", "-s", "sim", "--scenario", "costly_error", "--seed", "2", "--match-id", MATCH_ID, "--out", str(out)],
        cwd=REPO, check=True, capture_output=True,
    )
    return out


@pytest.fixture(scope="session")
def manifest(run_dir) -> dict:
    return json.loads((run_dir / "manifest.json").read_text())


@pytest.fixture(scope="session")
async def stats_url(run_dir):
    async with serve_run(run_dir) as url:
        yield url


@pytest.fixture
async def stats(stats_url):
    async with StatsClient(stats_url) as client:
        yield client

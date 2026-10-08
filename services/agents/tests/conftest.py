"""Shared fixtures, once per session: two simulated matches (scenario `costly_error`), their MCP stats servers,
and the agent service over A2A."""

import asyncio
import json
import os
import socket
import subprocess
from pathlib import Path

import pytest
import uvicorn

from touchline_agents.config import REPO, load_settings
from touchline_agents.stats import StatsClient, serve_run

MATCH_ID = "agents-test"
# Two matches, because no single seed gives every shape the suite needs. SEED is the general match: a goal in the first
# 20000 frames, a final score that is not a draw, and a full moment recall. ERROR_SEED is the match the analyst's error
# tests read: exactly one critical error, a mis-hit clearance under pressure leading to a shot, with no other signal
# merging into its moment. ERROR_SEED is found by scripts/find_test_seed.py (it checks that shape over a range of seeds,
# then runs those tests); re-run it whenever the engine or data/params/touchline-params.json changes. 2026-10-08: of
# seeds 1-1400, 13 have the shape and 609 is the first to pass (402, 532 and 559 fail the lead-signal test, where a
# natural signal also merges); 609 itself misses the general match's full moment recall, hence two seeds. Both can be
# overridden from the environment (TOUCHLINE_AGENTS_SEED, TOUCHLINE_AGENTS_ERROR_SEED).
SEED = int(os.environ.get("TOUCHLINE_AGENTS_SEED", "2"))
ERROR_SEED = int(os.environ.get("TOUCHLINE_AGENTS_ERROR_SEED", "609"))


def simulate(out: Path, seed: int) -> Path:
    subprocess.run(
        ["pnpm", "-s", "sim", "--scenario", "costly_error", "--seed", str(seed), "--match-id", MATCH_ID, "--out", str(out)],
        cwd=REPO, check=True, capture_output=True,
    )
    return out


@pytest.fixture(scope="session")
def run_dir(tmp_path_factory) -> Path:
    return simulate(tmp_path_factory.mktemp("runs") / MATCH_ID, SEED)


@pytest.fixture(scope="session")
def manifest(run_dir) -> dict:
    return json.loads((run_dir / "manifest.json").read_text())


@pytest.fixture(scope="session")
def error_run_dir(tmp_path_factory) -> Path:
    return simulate(tmp_path_factory.mktemp("error-runs") / MATCH_ID, ERROR_SEED)


@pytest.fixture(scope="session")
def error_manifest(error_run_dir) -> dict:
    return json.loads((error_run_dir / "manifest.json").read_text())


@pytest.fixture(scope="session")
async def error_stats_url(error_run_dir):
    async with serve_run(error_run_dir) as url:
        yield url


@pytest.fixture
async def error_stats(error_stats_url):
    async with StatsClient(error_stats_url) as client:
        yield client


@pytest.fixture(scope="session")
async def stats_url(run_dir):
    async with serve_run(run_dir) as url:
        yield url


@pytest.fixture
async def stats(stats_url):
    async with StatsClient(stats_url) as client:
        yield client


@pytest.fixture(scope="session")
async def agents_url():
    """The agent service over A2A (stub model), served in this process on a free port."""
    from touchline_agents.server import create_app

    with socket.socket() as sock:
        sock.bind(("127.0.0.1", 0))
        port = sock.getsockname()[1]
    url = f"http://127.0.0.1:{port}/"
    srv = uvicorn.Server(uvicorn.Config(create_app(url, load_settings({}, env_file=None)), host="127.0.0.1", port=port, log_level="warning"))
    task = asyncio.create_task(srv.serve())
    while not srv.started:
        await asyncio.sleep(0.05)
    yield url
    srv.should_exit = True
    await task

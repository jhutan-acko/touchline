"""Shared fixtures, once per session: one simulated match (scenario `costly_error`, seed 2), its MCP stats server,
and the agent service over A2A."""

import asyncio
import json
import socket
import subprocess
from pathlib import Path

import pytest
import uvicorn

from touchline_agents.config import REPO, load_settings
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

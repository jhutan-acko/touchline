"""The agents' only view of the match: the MCP stats server (packages/mcp-stats, spec §5.3 "no agent computes a statistic").

`StatsClient` wraps Agent Framework's MCP tool so code can call the tools directly (evidence packs, the Fact-Checker's
code checks) and models can call them as tools (the Analyst).
"""

import asyncio
import json
import os
import re
import signal
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Any
from urllib.parse import urlparse

from agent_framework import MCPStreamableHTTPTool
from agent_framework.exceptions import ToolExecutionException

from .config import REPO


class StatsError(Exception):
    """A stats tool refused the request (unknown id, no such event, ...) or the server is unusable."""


def check_url(url: str, allowed_hosts: frozenset[str]) -> str:
    """The MCP URL arrives in A2A requests: accept http(s) on an allowed host only, so a request cannot point the
    agent service at an arbitrary server."""
    u = urlparse(url)
    if u.scheme not in ("http", "https") or u.hostname is None:
        raise StatsError(f"MCP URL must be http(s)://host[:port]/path, got {url!r}")
    if u.hostname not in allowed_hosts:
        raise StatsError(f"MCP host {u.hostname!r} is not allowed (TOUCHLINE_MCP_HOSTS: {', '.join(sorted(allowed_hosts))})")
    return url


class StatsClient:
    """One match's stats tools. Use as an async context manager."""

    def __init__(self, url: str, allowed_hosts: frozenset[str] = frozenset({"127.0.0.1", "localhost", "::1"})) -> None:
        self.url = check_url(url, allowed_hosts)
        self.tool = MCPStreamableHTTPTool(name="stats", url=self.url, load_prompts=False)
        self._info: dict | None = None

    async def __aenter__(self) -> "StatsClient":
        await self.tool.connect()
        return self

    async def __aexit__(self, *exc: object) -> None:
        await self.tool.close()

    async def call(self, name: str, **args: Any) -> dict:
        """Call a tool and parse its JSON answer; a tool error becomes StatsError."""
        try:
            out = await self.tool.call_tool(name, **{k: v for k, v in args.items() if v is not None})
        except ToolExecutionException as e:
            raise StatsError(str(e)) from None
        text = "".join(c.text or "" for c in out if c.type == "text")
        try:
            return json.loads(text)
        except json.JSONDecodeError:
            raise StatsError(f"{name}: not JSON: {text[:200]}") from None

    async def match_info(self, at_frame: int | None = None) -> dict:
        return await self.call("match_info", at_frame=at_frame)

    async def roster(self) -> dict:
        """Teams and players (cached: they do not change during a match)."""
        if self._info is None:
            self._info = await self.match_info()
        return self._info

    async def metric(self, metric_id: str, subject: str, at_frame: int, window_s: float | None = None) -> dict:
        return await self.call("get_metric", metric_id=metric_id, subject=subject, at_frame=at_frame, window_s=window_s)

    async def verify(self, metric_id: str, subject: str, at_frame: int, value: float, window_s: float | None = None) -> dict:
        return await self.call("verify_claim", metric_id=metric_id, subject=subject, at_frame=at_frame, value=value, window_s=window_s)

    async def events(self, from_frame: int, to_frame: int, types: list[str] | None = None, limit: int = 100, **kw: Any) -> list[dict]:
        return (await self.call("get_events", from_frame=from_frame, to_frame=to_frame, types=types, limit=limit, **kw))["events"]

    async def decision(self, event_id: str, at_frame: int | None = None) -> dict:
        return await self.call("get_decision", event_id=event_id, at_frame=at_frame)

    async def signals(self, from_frame: int | None = None, to_frame: int | None = None, limit: int = 500, **kw: Any) -> list[dict]:
        return (await self.call("get_signals", from_frame=from_frame, to_frame=to_frame, limit=limit, **kw))["signals"]


def names(info: dict) -> dict[str, str]:
    """Team and player ids to display names, from match_info."""
    out: dict[str, str] = {}
    for side in ("home", "away"):
        team = info[side]
        out[team["id"]] = team["name"]
        for p in team["players"]:
            out[p["id"]] = p["name"]
    return out


_LISTENING = re.compile(r"touchline-stats MCP on (http://\S+/mcp)")


@asynccontextmanager
async def serve_run(run_dir: Path, startup_s: float = 60.0) -> AsyncIterator[str]:
    """Start `pnpm mcp-stats --run <run_dir> --http 0` and yield its URL; stop it on exit. For tests and the
    evaluation harness (the TypeScript gateway starts its own)."""
    proc = await asyncio.create_subprocess_exec(
        "pnpm", "-s", "mcp-stats", "--run", str(Path(run_dir).resolve()), "--http", "0",
        cwd=REPO, stdout=asyncio.subprocess.DEVNULL, stderr=asyncio.subprocess.PIPE, start_new_session=True,
    )
    assert proc.stderr is not None
    try:
        lines: list[str] = []

        async def wait_url() -> str:
            while line := (await proc.stderr.readline()).decode():
                lines.append(line)
                if m := _LISTENING.search(line):
                    return m[1]
            raise StatsError(f"mcp-stats exited before listening: {''.join(lines)[-500:]}")

        url = await asyncio.wait_for(wait_url(), startup_s)
        # Keep draining stderr so the server never blocks on a full pipe.
        drain = asyncio.create_task(proc.stderr.read())
        yield url
        drain.cancel()
    finally:
        if proc.returncode is None:
            os.killpg(proc.pid, signal.SIGTERM)
            await proc.wait()

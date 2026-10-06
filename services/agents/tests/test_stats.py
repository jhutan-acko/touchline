import pytest

from touchline_agents.stats import StatsClient, StatsError, check_url, names

LOCAL = frozenset({"127.0.0.1", "localhost"})


def test_only_allowed_hosts():
    assert check_url("http://127.0.0.1:7801/mcp", LOCAL) == "http://127.0.0.1:7801/mcp"
    for bad in ["http://169.254.169.254/latest", "file:///etc/passwd", "http://evil.example/mcp", "not a url"]:
        with pytest.raises(StatsError):
            check_url(bad, LOCAL)


async def test_reads_the_match(stats, manifest):
    info = await stats.match_info()
    assert info["match_id"] == manifest["match_id"]
    who = names(info)
    assert who[info["home"]["id"]] == info["home"]["name"] and len(who) > 22


async def test_metric_and_claim_check_agree(stats):
    info = await stats.roster()
    team = info["home"]["id"]
    m = await stats.metric("team.press", team, at_frame=30000)
    assert m["as_of_frame"] == 30000 and m["ref"].startswith("team.press@")
    assert (await stats.verify("team.press", team, 30000, m["value"]))["verified"]
    assert not (await stats.verify("team.press", team, 30000, m["value"] + 0.2))["verified"]


async def test_nothing_after_the_frame(stats):
    events = await stats.events(0, 5000, types=["pass"], limit=500)
    assert events and all(e["frame_id"] <= 5000 for e in events)
    assert all(s["frame_id"] <= 5000 for s in await stats.signals(to_frame=5000))


async def test_tool_errors_become_stats_errors(stats):
    with pytest.raises(StatsError, match="unknown subject"):
        await stats.metric("team.press", "nobody", at_frame=100)
    with pytest.raises(StatsError):
        await stats.decision("no-such-event")


async def test_decision_records_rank_options(stats):
    p = next(e for e in await stats.events(0, 20000, types=["pass"], limit=500) if e["player_id"])
    d = await stats.decision(p["id"])
    assert d["event_id"] == p["id"] and d["options"] and d["chosen_rank"] is not None


def test_disallowed_host_refused_before_connecting():
    with pytest.raises(StatsError, match="not allowed"):
        StatsClient("http://10.0.0.8:7801/mcp", LOCAL)

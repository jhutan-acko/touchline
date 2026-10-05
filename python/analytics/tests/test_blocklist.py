from touchline_analytics.blocklist import LEAGUES, club_ids, clubs_query, hashes_from_sparql, name_hash, normalise_name, players_query


def test_hashes_match_the_league_generator():
    # Reference values from packages/league (nameHash / normaliseName in TypeScript).
    assert normalise_name("Thomas Müller") == "thomasmuller"
    assert name_hash("Thomas Müller") == "2b26ea3743238a83"
    assert name_hash("Kylian Mbappé") == "1ebf48ca8571b5e0"
    assert name_hash("Martin Ødegaard") == "7a052cd791b54af5"
    assert name_hash("Son Heung-min") == "e070d11e25151584"
    assert name_hash("N'Golo Kanté") == "2171085eadaef891"


def test_hashes_from_a_sparql_result_are_unique_and_skip_empty_names():
    result = {"results": {"bindings": [
        {"label": {"type": "literal", "value": "Thomas Müller", "xml:lang": "en"}},
        {"label": {"type": "literal", "value": "Thomas Muller", "xml:lang": "en"}},
        {"label": {"type": "literal", "value": "123", "xml:lang": "en"}},
    ]}}
    assert hashes_from_sparql(result) == {"2b26ea3743238a83"}


def test_queries_ask_for_a_league_s_clubs_then_each_club_s_footballers():
    assert "wd:Q9448" in clubs_query(LEAGUES["Premier League"]) and "P118" in clubs_query("Q9448")
    q = players_query("Q18656")
    assert "wd:Q18656" in q and "wd:Q937857" in q and "P54" in q
    result = {"results": {"bindings": [{"club": {"type": "uri", "value": "http://www.wikidata.org/entity/Q18656"}}, {"club": {"type": "uri", "value": "http://www.wikidata.org/entity/Q9617"}}]}}
    assert club_ids(result) == ["Q18656", "Q9617"]


def test_build_saves_each_league_and_resumes_without_fetching_it_again(tmp_path, monkeypatch):
    from touchline_analytics import blocklist

    calls = []

    def fake_fetch(query, contact):
        assert contact == "https://example.org/touchline"
        calls.append(query)
        if "P118" in query:
            return {"results": {"bindings": [{"club": {"value": "http://www.wikidata.org/entity/Q1"}}]}}
        return {"results": {"bindings": [{"label": {"value": "Thomas Müller"}}]}}

    monkeypatch.setattr(blocklist, "fetch", fake_fetch)
    monkeypatch.setattr(blocklist, "LEAGUES", {"A": "Q10", "B": "Q20"})
    monkeypatch.setattr(blocklist.time, "sleep", lambda s: None)
    out = tmp_path / "hashes.txt"
    (tmp_path / "leagues").mkdir()
    (tmp_path / "leagues" / "A.txt").write_text("2171085eadaef891\n")  # league A already fetched
    meta = blocklist.build(out, "https://example.org/touchline")
    assert all("Q10" not in q for q in calls)  # A was not fetched again
    assert (tmp_path / "leagues" / "B.txt").read_text() == "2b26ea3743238a83\n"
    assert out.read_text() == "2171085eadaef891\n2b26ea3743238a83\n"
    assert meta["names_per_league"] == {"A": 1, "B": 1}
    # B's fetch date is recorded beside it; A was fetched before dates were kept.
    assert meta["fetched_at"]["A"] is None and len(meta["fetched_at"]["B"]) == 10


def test_an_interrupted_league_resumes_at_its_next_club(tmp_path, monkeypatch):
    from touchline_analytics import blocklist

    fetched = []

    def fake_fetch(query, contact):
        if "P118" in query:
            return {"results": {"bindings": [{"club": {"value": f"http://www.wikidata.org/entity/Q{i}"}} for i in (1, 2)]}}
        fetched.append(query)
        return {"results": {"bindings": [{"label": {"value": "Kylian Mbappé"}}]}}

    monkeypatch.setattr(blocklist, "fetch", fake_fetch)
    monkeypatch.setattr(blocklist, "LEAGUES", {"A": "Q10"})
    monkeypatch.setattr(blocklist.time, "sleep", lambda s: None)
    (tmp_path / "leagues").mkdir()
    (tmp_path / "leagues" / "A.partial").write_text("Q1\t2b26ea3743238a83\n")  # club Q1 done before the interruption
    blocklist.build(tmp_path / "hashes.txt", "ops@example.org")
    assert len(fetched) == 1 and "wd:Q2" in fetched[0]
    assert (tmp_path / "leagues" / "A.txt").read_text() == "1ebf48ca8571b5e0\n2b26ea3743238a83\n"
    assert not (tmp_path / "leagues" / "A.partial").exists()


def test_build_refuses_to_fetch_without_contact_details(tmp_path, monkeypatch):
    import pytest

    from touchline_analytics import blocklist

    def no_fetch(*args, **kwargs):
        raise AssertionError("fetched without contact details")

    monkeypatch.setattr(blocklist, "fetch", no_fetch)
    monkeypatch.setattr(blocklist, "LEAGUES", {"A": "Q10"})
    with pytest.raises(ValueError, match="--contact"):
        blocklist.build(tmp_path / "hashes.txt")


def test_fetch_names_the_contact_and_waits_as_long_as_a_429_asks(monkeypatch):
    import io
    import urllib.error

    from touchline_analytics import blocklist

    seen, slept = [], []

    def fake_urlopen(req, timeout):
        seen.append(req.get_header("User-agent"))
        if len(seen) == 1:
            raise urllib.error.HTTPError(req.full_url, 429, "Too Many Requests", {"Retry-After": "45"}, None)
        return io.BytesIO(b'{"results": {"bindings": []}}')

    monkeypatch.setattr(blocklist.urllib.request, "urlopen", fake_urlopen)
    monkeypatch.setattr(blocklist.time, "sleep", slept.append)
    assert blocklist.fetch("SELECT", "ops@example.org") == {"results": {"bindings": []}}
    assert "ops@example.org" in seen[0]
    assert slept == [45.0]

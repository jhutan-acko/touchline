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

    def fake_fetch(query):
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
    meta = blocklist.build(out)
    assert all("Q10" not in q for q in calls)  # A was not fetched again
    assert (tmp_path / "leagues" / "B.txt").read_text() == "2b26ea3743238a83\n"
    assert out.read_text() == "2171085eadaef891\n2b26ea3743238a83\n"
    assert meta["names_per_league"] == {"A": 1, "B": 1}


def test_an_interrupted_league_resumes_at_its_next_club(tmp_path, monkeypatch):
    from touchline_analytics import blocklist

    fetched = []

    def fake_fetch(query):
        if "P118" in query:
            return {"results": {"bindings": [{"club": {"value": f"http://www.wikidata.org/entity/Q{i}"}} for i in (1, 2)]}}
        fetched.append(query)
        return {"results": {"bindings": [{"label": {"value": "Kylian Mbappé"}}]}}

    monkeypatch.setattr(blocklist, "fetch", fake_fetch)
    monkeypatch.setattr(blocklist, "LEAGUES", {"A": "Q10"})
    monkeypatch.setattr(blocklist.time, "sleep", lambda s: None)
    (tmp_path / "leagues").mkdir()
    (tmp_path / "leagues" / "A.partial").write_text("Q1\t2b26ea3743238a83\n")  # club Q1 done before the interruption
    blocklist.build(tmp_path / "hashes.txt")
    assert len(fetched) == 1 and "wd:Q2" in fetched[0]
    assert (tmp_path / "leagues" / "A.txt").read_text() == "1ebf48ca8571b5e0\n2b26ea3743238a83\n"
    assert not (tmp_path / "leagues" / "A.partial").exists()

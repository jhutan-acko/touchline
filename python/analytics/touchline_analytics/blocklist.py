"""Real-player name blocklist for the fictional league (spec §5.1.6).

Names of footballers who played for clubs in major leagues come from Wikidata (CC0) and are stored only as
hashes in data/blocklist/real-player-name-hashes.txt; the league generator (packages/league) never uses a
generated name whose hash is on the list. Normalisation and hashing match `normaliseName` / `nameHash` there.

Usage: uv run --project python/analytics python -m touchline_analytics.blocklist
"""

from __future__ import annotations

import datetime as dt
import hashlib
import http.client
import json
import re
import time
import unicodedata
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

ENDPOINT = "https://query.wikidata.org/sparql"
USER_AGENT = "touchline-hackathon/0.1 (synthetic football data; real-player name blocklist)"
FOOTBALLER = "Q937857"  # occupation: association football player
# Wikidata ids of the leagues whose clubs' players are blocked (checked 2026-10-05). The English leagues come
# first: this is a Premier League product. More can be added later (each run fetches only leagues not saved yet),
# e.g. "Bundesliga": "Q82595", "La Liga": "Q324867", "Serie A": "Q15804", "Ligue 1": "Q13394", "Primeira Liga": "Q182994".
LEAGUES: dict[str, str] = {
    "Premier League": "Q9448",
    "EFL Championship": "Q19510",
}


def normalise_name(name: str) -> str:
    """NFKD, drop combining accents (U+0300-U+036F), lower case, letters a-z only: as normaliseName in TypeScript."""
    decomposed = unicodedata.normalize("NFKD", name)
    stripped = "".join(c for c in decomposed if not 0x300 <= ord(c) <= 0x36F)
    return re.sub(r"[^a-z]", "", stripped.lower())


def name_hash(name: str) -> str:
    return hashlib.sha256(normalise_name(name).encode()).hexdigest()[:16]


def clubs_query(league_id: str) -> str:
    """Clubs that have played in the league (one query per league is small)."""
    return f"SELECT DISTINCT ?club WHERE {{ ?club wdt:P118 wd:{league_id} . }}"


def players_query(club_id: str) -> str:
    """English labels of footballers who played for the club (one club per query keeps under the 60 s limit)."""
    return (
        "SELECT DISTINCT ?label WHERE { "
        f"?p wdt:P54 wd:{club_id} ; wdt:P106 wd:{FOOTBALLER} . "
        '?p rdfs:label ?label . FILTER(LANG(?label) = "en") }'
    )


def club_ids(result: dict) -> list[str]:
    return sorted({b["club"]["value"].rsplit("/", 1)[-1] for b in result["results"]["bindings"]})


def hashes_from_sparql(result: dict) -> set[str]:
    out = set()
    for b in result["results"]["bindings"]:
        label = b["label"]["value"]
        if normalise_name(label):
            out.add(name_hash(label))
    return out


def fetch(query: str, attempts: int = 5) -> dict:
    """Run a SPARQL query. A response cut off by the endpoint's time limit (invalid JSON), a dropped connection
    a truncated body or a 429/5xx answer is retried after 10, 20, 40, 80 s."""
    url = ENDPOINT + "?" + urllib.parse.urlencode({"query": query, "format": "json"})
    req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT, "Accept": "application/sparql-results+json"})
    for i in range(attempts):
        try:
            with urllib.request.urlopen(req, timeout=120) as resp:
                return json.load(resp)
        except urllib.error.HTTPError as e:
            if e.code != 429 and e.code < 500 or i == attempts - 1:
                raise
        except (json.JSONDecodeError, urllib.error.URLError, http.client.HTTPException, ConnectionError, TimeoutError):
            if i == attempts - 1:
                raise
        time.sleep(10 * 2**i)
    raise AssertionError("unreachable")


def build(out: Path) -> dict:
    """Fetch every league not fetched yet (each saved as soon as it is done, in a `leagues/` folder next to
    `out`, so an interrupted run resumes where it stopped), then write the combined, sorted hash list."""
    per_league = out.parent / "leagues"
    per_league.mkdir(parents=True, exist_ok=True)
    counts = {}
    hashes: set[str] = set()
    for name, qid in LEAGUES.items():
        path = per_league / f"{name}.txt"
        if not path.exists():
            # Progress is kept per club ("club<TAB>hash" lines), so an interrupted league resumes at its next club.
            partial = per_league / f"{name}.partial"
            done: dict[str, set[str]] = {}
            if partial.exists():
                for line in partial.read_text().split("\n"):
                    if line:
                        club, _, h = line.partition("\t")
                        done.setdefault(club, set()).update([h] if h else [])
            with partial.open("a") as fh:
                for club in club_ids(fetch(clubs_query(qid))):
                    if club in done:
                        continue
                    found = hashes_from_sparql(fetch(players_query(club)))
                    fh.write("".join(f"{club}\t{h}\n" for h in sorted(found)) or f"{club}\t\n")
                    fh.flush()
                    done[club] = found
                    time.sleep(0.5)  # be polite to the public endpoint
            league = set().union(*done.values()) if done else set()
            path.write_text("".join(f"{h}\n" for h in sorted(league)))
            partial.unlink()
            print(f"{name}: {len(league)} names", flush=True)
        league_hashes = {line for line in path.read_text().split("\n") if line}
        counts[name] = len(league_hashes)
        hashes |= league_hashes
    out.write_text("".join(f"{h}\n" for h in sorted(hashes)))
    meta = {
        "source": "Wikidata (CC0 1.0): English labels of association football players (P106 Q937857) who played for (P54) a club in each league (P118)",
        "leagues": LEAGUES,
        "names_per_league": counts,
        "hashes": len(hashes),
        "hash": "sha256 of the normalised name (NFKD, accents removed, lower case, a-z only), first 16 hex digits",
        "fetched_at": dt.date.today().isoformat(),
    }
    out.with_suffix(".meta.json").write_text(json.dumps(meta, indent=1) + "\n")
    return meta


if __name__ == "__main__":
    print(json.dumps(build(Path("data/blocklist/real-player-name-hashes.txt")), indent=1))

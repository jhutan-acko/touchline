"""IDSSE / Sportec Open DFL dataset (CC-BY 4.0; credit the DFL and Bassek et al., Scientific Data 2025).

Files are downloaded into git-ignored data/raw/idsse/ and never committed. Only aggregate
statistics derived from them are committed (with provenance).
"""

from __future__ import annotations

import urllib.request
from pathlib import Path

BASE_URL = "https://huggingface.co/datasets/pysport/idsse-data/resolve/main/"
MATCHES: dict[str, str] = {
    "J03WMX": "DFL-COM-000001",
    "J03WN1": "DFL-COM-000001",
    "J03WOH": "DFL-COM-000002",
    "J03WOY": "DFL-COM-000002",
    "J03WPY": "DFL-COM-000002",
    "J03WQQ": "DFL-COM-000002",
    "J03WR9": "DFL-COM-000002",
}
PROVENANCE = {
    "dataset": "IDSSE / Sportec Open DFL dataset (2022/23 Bundesliga and 2. Bundesliga)",
    "licence": "CC-BY-4.0",
    "attribution": "Deutsche Fussball Liga (DFL); Bassek et al., Scientific Data (2025), doi:10.1038/s41597-025-04505-y",
}


def filenames(match_id: str) -> dict[str, str]:
    comp = MATCHES[match_id]
    return {
        "meta": f"DFL_02_01_matchinformation_{comp}_DFL-MAT-{match_id}.xml",
        "event": f"DFL_03_02_events_raw_{comp}_DFL-MAT-{match_id}.xml",
        "tracking": f"DFL_04_03_positions_raw_observed_{comp}_DFL-MAT-{match_id}.xml",
    }


def download(match_id: str, root: Path, tracking: bool = False) -> dict[str, Path]:
    """Download one match's files (skipping files already present). Tracking files are ~370 MB each."""
    root.mkdir(parents=True, exist_ok=True)
    out: dict[str, Path] = {}
    for kind, name in filenames(match_id).items():
        if kind == "tracking" and not tracking:
            continue
        path = root / name
        if not path.exists() or path.stat().st_size == 0:
            tmp = path.with_suffix(".part")
            with urllib.request.urlopen(BASE_URL + name, timeout=600) as resp, tmp.open("wb") as fh:
                while chunk := resp.read(1 << 20):
                    fh.write(chunk)
            tmp.rename(path)
        out[kind] = path
    return out


if __name__ == "__main__":
    import argparse

    ap = argparse.ArgumentParser(description="Download IDSSE files into data/raw/idsse")
    ap.add_argument("--root", default="data/raw/idsse")
    ap.add_argument("--tracking", nargs="*", default=["J03WPY"], help="match ids whose tracking to download")
    args = ap.parse_args()
    for mid in MATCHES:
        got = download(mid, Path(args.root), tracking=mid in args.tracking)
        print(mid, ", ".join(sorted(got)))

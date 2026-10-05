"""IDSSE / Sportec Open DFL dataset (CC-BY 4.0; credit the DFL and Bassek et al., Scientific Data 2025).

Files are downloaded into git-ignored data/raw/idsse/ and never committed. Only aggregate
statistics derived from them are committed (with provenance).
"""

from __future__ import annotations

import hashlib
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

# SHA-256 of each file, cross-checked against the Hugging Face repository's own ids (git blob ids,
# and the LFS sha256 for the tracking file) on 2026-10-04.
SHA256: dict[str, str] = {
    "DFL_02_01_matchinformation_DFL-COM-000001_DFL-MAT-J03WMX.xml": "a884728647a564cf8b20e5223a1d04a5da6f6725e1e506c8651505327c197ba9",
    "DFL_02_01_matchinformation_DFL-COM-000001_DFL-MAT-J03WN1.xml": "5490286436c86e6f80a538d2b1b379d0efd016e0defcaf594bc59d9ef5079f4c",
    "DFL_02_01_matchinformation_DFL-COM-000002_DFL-MAT-J03WOH.xml": "f23b3ee13b988b1ff9a0bce438c416dac47e71355bbc7ee1dab21aaf3e33c18c",
    "DFL_02_01_matchinformation_DFL-COM-000002_DFL-MAT-J03WOY.xml": "4c497fac683eee8292901c18ca02c0be1d9609d0b9d4bd8aa092c61f9e0b19e9",
    "DFL_02_01_matchinformation_DFL-COM-000002_DFL-MAT-J03WPY.xml": "566dd5e4c86e124ab90fcdba51100881f0436e22afa71832945a451a2d95a420",
    "DFL_02_01_matchinformation_DFL-COM-000002_DFL-MAT-J03WQQ.xml": "e976aa0c5dba862cfa898ea57ec226efce9d1bc04b23b8d775908db86aa6fa41",
    "DFL_02_01_matchinformation_DFL-COM-000002_DFL-MAT-J03WR9.xml": "429b584e89df3e3e8b81f4bd0d004b38bd0b4298bb390b8fb43efccb60963e01",
    "DFL_03_02_events_raw_DFL-COM-000001_DFL-MAT-J03WMX.xml": "6f9741ea62e9dee35b604942e1dad2ac0a4dc3fce14ef2f3858aa12b74dafe00",
    "DFL_03_02_events_raw_DFL-COM-000001_DFL-MAT-J03WN1.xml": "d7fa1d4445e3215eb79ec62fabefa4779b4974e496195c2fdc25624c375a9b9b",
    "DFL_03_02_events_raw_DFL-COM-000002_DFL-MAT-J03WOH.xml": "abc27e3268e6126fb3e6e90bff5cca8d4586a5e0cefe9bd59bf32871e89d8544",
    "DFL_03_02_events_raw_DFL-COM-000002_DFL-MAT-J03WOY.xml": "dbb014df1b80d5c99b7fb806a278432c445a5fdd99f59d379d601f20eaf7e142",
    "DFL_03_02_events_raw_DFL-COM-000002_DFL-MAT-J03WPY.xml": "e440a3adf9a38d3e4ce4289343a59a3b5f76018a78e97c765114f7817591fb3c",
    "DFL_03_02_events_raw_DFL-COM-000002_DFL-MAT-J03WQQ.xml": "b79ccc1ee3de5ba662546a9a21304784642d00a791ccc1175550eaa463ea0074",
    "DFL_03_02_events_raw_DFL-COM-000002_DFL-MAT-J03WR9.xml": "31735a2d7b9008c44cae9b6ac43ab38ddeaa435d0416265ec0ebfebf53b3c982",
    "DFL_04_03_positions_raw_observed_DFL-COM-000001_DFL-MAT-J03WMX.xml": "d3dd92e509421a6466acb0a083c009035f1751bc5fd9ef42ffa8f20d01cf7d49",
    "DFL_04_03_positions_raw_observed_DFL-COM-000001_DFL-MAT-J03WN1.xml": "56ef948961a18e150dba0b7b16869d0008ff66f3050a0c355d31fa5b8ec2fcec",
    "DFL_04_03_positions_raw_observed_DFL-COM-000002_DFL-MAT-J03WOH.xml": "ec4dcf30200aad694dea263d5289485fcd0ca42badddaeb7c81f5cd5a4229d4f",
    "DFL_04_03_positions_raw_observed_DFL-COM-000002_DFL-MAT-J03WOY.xml": "a228ef0e676d009cefff1580fcb721b53f598454eb120ec347e0a628a3a4646b",
    "DFL_04_03_positions_raw_observed_DFL-COM-000002_DFL-MAT-J03WPY.xml": "845202c29ad93d696653436da426a7cdaefb848298e07b7343de6529581671e1",
    "DFL_04_03_positions_raw_observed_DFL-COM-000002_DFL-MAT-J03WQQ.xml": "cbefcb0bd7f39f3b94ee69a7bc97aac0f936425062c1cc1b144733df36804d6f",
    "DFL_04_03_positions_raw_observed_DFL-COM-000002_DFL-MAT-J03WR9.xml": "70b63069189019066fb7e3d9db891122edfe787f3a43ba522ebe45ed89ea0269",
}


def filenames(match_id: str) -> dict[str, str]:
    comp = MATCHES[match_id]
    return {
        "meta": f"DFL_02_01_matchinformation_{comp}_DFL-MAT-{match_id}.xml",
        "event": f"DFL_03_02_events_raw_{comp}_DFL-MAT-{match_id}.xml",
        "tracking": f"DFL_04_03_positions_raw_observed_{comp}_DFL-MAT-{match_id}.xml",
    }


def _sha256(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as fh:
        while chunk := fh.read(1 << 20):
            h.update(chunk)
    return h.hexdigest()


def _verified(path: Path) -> bool:
    """True when the file exists and matches its recorded checksum (any non-empty file if none is recorded)."""
    if not path.exists() or path.stat().st_size == 0:
        return False
    expected = SHA256.get(path.name)
    return expected is None or _sha256(path) == expected


def download(match_id: str, root: Path, tracking: bool = False) -> dict[str, Path]:
    """
    Download one match's files into `root`. Files already present and matching their checksum are kept;
    missing, truncated or corrupt files are fetched again. A download that does not match its checksum
    raises ValueError and leaves nothing behind. Tracking files are ~370 MB each.
    """
    root.mkdir(parents=True, exist_ok=True)
    out: dict[str, Path] = {}
    for kind, name in filenames(match_id).items():
        if kind == "tracking" and not tracking:
            continue
        path = root / name
        if not _verified(path):
            tmp = path.with_suffix(".part")
            with urllib.request.urlopen(BASE_URL + name, timeout=600) as resp, tmp.open("wb") as fh:
                while chunk := resp.read(1 << 20):
                    fh.write(chunk)
            expected = SHA256.get(name)
            if expected is not None and _sha256(tmp) != expected:
                tmp.unlink()
                raise ValueError(f"{name}: checksum mismatch (download corrupted or the file changed upstream)")
            tmp.replace(path)
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

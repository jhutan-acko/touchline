"""Validate a simulator output folder (meta.json, event.jsonl, tracking.jsonl) against CDF in strict "extreme" mode.

Usage: uv run --project python/analytics python -m touchline_analytics.validate_cdf out/m-1
Exits non-zero on the first invalid file.
"""

import sys
from pathlib import Path

import cdf


def count_lines(path: Path) -> int:
    with path.open("rb") as fh:
        return sum(1 for _ in fh)


def main(folder: str) -> int:
    root = Path(folder)
    checks = [
        ("meta", cdf.MetaSchemaValidator(), root / "meta.json", None),
        ("event", cdf.EventSchemaValidator(), root / "event.jsonl", count_lines(root / "event.jsonl")),
        ("tracking", cdf.TrackingSchemaValidator(), root / "tracking.jsonl", count_lines(root / "tracking.jsonl")),
    ]
    for name, validator, path, n in checks:
        try:
            if n is None:
                validator.validate_schema(sample=str(path), mode="extreme")
            else:
                validator.validate_schema(sample=str(path), mode="extreme", limit=n)
        except Exception as exc:  # the validator raises on the first invalid record
            print(f"{name}: INVALID ({path}): {exc}")
            return 1
        print(f"{name}: ok")
    return 0


if __name__ == "__main__":
    if len(sys.argv) != 2:
        print(__doc__)
        sys.exit(2)
    sys.exit(main(sys.argv[1]))

"""python -m touchline_analytics.physics fit [--root data/raw/idsse] [--out data/params/physics.json] [--params data/params/touchline-params.json]"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

from .build import GuardError, build, write


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(prog="python -m touchline_analytics.physics")
    sub = ap.add_subparsers(dest="cmd", required=True)
    f = sub.add_parser("fit", help="fit the physics constants on IDSSE and write physics.json")
    f.add_argument("--root", default="data/raw/idsse")
    f.add_argument("--cache", default="out/physics/cache")
    f.add_argument("--out", default="data/params/physics.json")
    f.add_argument("--params", default="data/params/touchline-params.json", help="the engine's parameter file; its physics block is replaced")
    a = ap.parse_args(argv)
    result = build(Path(a.root), Path(a.cache))
    try:
        write(result, Path(a.out), Path(a.params))
    except GuardError as err:
        print(f"error: {err}", file=sys.stderr)
        return 1
    print(f"wrote {a.out} and the physics block of {a.params}")
    return 0


if __name__ == "__main__":
    sys.exit(main())

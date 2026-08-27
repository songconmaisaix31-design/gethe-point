#!/usr/bin/env python3
"""Thin host launcher: delegate the full plan to a coordinator child Agent."""
from __future__ import annotations

import argparse
import subprocess
import sys
from pathlib import Path


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--plan", type=Path, default=Path(".agents/plans/current.json"))
    parser.add_argument("--objective")
    parser.add_argument("--agent")
    parser.add_argument("--setup", choices=("run", "skip", "inherit"))
    parser.add_argument("--name")
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()

    command = [
        sys.executable,
        str(Path(__file__).with_name("fleet.py")),
        "start-coordinator",
        "--plan",
        str(args.plan),
    ]
    for option, value in (
        ("--objective", args.objective),
        ("--agent", args.agent),
        ("--setup", args.setup),
        ("--name", args.name),
    ):
        if value:
            command.extend([option, value])
    if args.dry_run:
        command.append("--dry-run")

    print("Host/main Agent delegates the Run; it must not perform implementation work.")
    return subprocess.run(command, check=False).returncode


if __name__ == "__main__":
    raise SystemExit(main())

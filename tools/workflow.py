#!/usr/bin/env python3
"""Run isolated local workflow commands through UV."""

from __future__ import annotations

import argparse
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
COMMANDS = {
    "verify": ["docker", "compose", "run", "--rm", "verify"],
    "demo": ["docker", "compose", "--profile", "demo", "up", "--build", "demo"],
    "shell": ["docker", "compose", "--profile", "shell", "run", "--rm", "shell"],
}


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Run the isolated Docker Compose workflow through UV."
    )
    parser.add_argument("task", choices=COMMANDS, help="workflow task to run")
    arguments = parser.parse_args()
    return subprocess.run(COMMANDS[arguments.task], cwd=ROOT, check=False).returncode


if __name__ == "__main__":
    raise SystemExit(main())

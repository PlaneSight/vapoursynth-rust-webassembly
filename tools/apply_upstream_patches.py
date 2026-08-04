#!/usr/bin/env python3
"""Apply the exact third-party patch set recorded in third_party/lock.toml."""

from __future__ import annotations

import argparse
from dataclasses import dataclass
from pathlib import Path
import subprocess
import sys
import tomllib


class PatchError(RuntimeError):
    """A checked third-party source tree cannot be brought to the locked state."""


@dataclass(frozen=True)
class LockedDependency:
    path: Path
    commit: str
    patches: tuple[Path, ...]


def run_git(repository: Path, *arguments: str, check: bool = True) -> subprocess.CompletedProcess[str]:
    command = ("git", "-C", str(repository), *arguments)
    result = subprocess.run(command, check=False, capture_output=True, text=True)
    if check and result.returncode != 0:
        details = result.stderr.strip() or result.stdout.strip() or "no diagnostic output"
        raise PatchError(f"{' '.join(command)} failed:\n{details}")
    return result


def read_locked_dependency(root: Path) -> LockedDependency:
    lockfile = root / "third_party" / "lock.toml"
    try:
        document = tomllib.loads(lockfile.read_text(encoding="utf-8"))
        vapoursynth = document["dependencies"]["vapoursynth"]
        relative_path = Path(vapoursynth["path"])
        commit = vapoursynth["commit"]
        patch_names = vapoursynth["patches"]
    except (KeyError, OSError, tomllib.TOMLDecodeError, TypeError) as error:
        raise PatchError(f"cannot read the VapourSynth lock entry in {lockfile}: {error}") from error

    if not isinstance(commit, str) or len(commit) != 40:
        raise PatchError("the VapourSynth lock entry must contain a full 40-character commit")
    if not isinstance(patch_names, list) or not all(isinstance(name, str) for name in patch_names):
        raise PatchError("the VapourSynth lock entry must contain a list of patch paths")

    patches = tuple(root / name for name in patch_names)
    missing_patches = [str(patch.relative_to(root)) for patch in patches if not patch.is_file()]
    if missing_patches:
        raise PatchError(f"locked patch files are missing: {', '.join(missing_patches)}")

    return LockedDependency(path=root / relative_path, commit=commit, patches=patches)


def require_locked_checkout(dependency: LockedDependency) -> None:
    if not dependency.path.is_dir():
        raise PatchError(
            f"missing {dependency.path}; run 'git submodule update --init --recursive' before building"
        )

    head = run_git(dependency.path, "rev-parse", "HEAD").stdout.strip()
    if head != dependency.commit:
        raise PatchError(
            f"{dependency.path} is at {head}, but third_party/lock.toml requires {dependency.commit}"
        )


def patch_state(repository: Path, patch: Path) -> str:
    reverse_check = run_git(
        repository,
        "apply",
        "--reverse",
        "--check",
        "--unidiff-zero",
        "--whitespace=error",
        str(patch),
        check=False,
    )
    if reverse_check.returncode == 0:
        return "applied"

    forward_check = run_git(
        repository,
        "apply",
        "--check",
        "--unidiff-zero",
        "--whitespace=error",
        str(patch),
        check=False,
    )
    if forward_check.returncode == 0:
        return "pending"

    details = forward_check.stderr.strip() or reverse_check.stderr.strip() or "no diagnostic output"
    raise PatchError(f"{patch} is neither applicable nor already applied:\n{details}")


def apply_patches(root: Path, check_only: bool) -> None:
    dependency = read_locked_dependency(root)
    require_locked_checkout(dependency)

    for patch in dependency.patches:
        state = patch_state(dependency.path, patch)
        display_name = patch.relative_to(root)
        if check_only:
            if state != "applied":
                raise PatchError(f"{display_name} has not been applied")
            print(f"verified {display_name}")
            continue

        if state == "applied":
            print(f"already applied {display_name}")
            continue

        run_git(dependency.path, "apply", "--unidiff-zero", "--whitespace=error", str(patch))
        if patch_state(dependency.path, patch) != "applied":
            raise PatchError(f"{display_name} did not apply cleanly")
        print(f"applied {display_name}")


def parse_arguments() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--check",
        action="store_true",
        help="require every locked patch to be present without modifying the checkout",
    )
    parser.add_argument(
        "--root",
        type=Path,
        default=Path(__file__).resolve().parents[1],
        help="repository root containing third_party/lock.toml",
    )
    return parser.parse_args()


def main() -> int:
    arguments = parse_arguments()
    try:
        apply_patches(arguments.root.resolve(), arguments.check)
    except PatchError as error:
        print(f"error: {error}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

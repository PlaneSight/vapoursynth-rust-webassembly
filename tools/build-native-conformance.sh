#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")/.."
root=$PWD
vendor="$root/vendor/vapoursynth"
vendor_build="$root/build/native-vapoursynth"
native_build="$root/build/native-conformance"
runner="$native_build/native/vapoursynth-native-conformance"

if [[ ! -d "$vendor/.git" && ! -f "$vendor/.git" ]]; then
  echo "error: $vendor is not an initialized git submodule" >&2
  exit 1
fi
if [[ -n "$(git -C "$vendor" status --porcelain)" ]]; then
  echo "error: $vendor has uncommitted changes; native conformance requires the locked checkout" >&2
  exit 1
fi
locked_commit="$(uv run --locked python -c 'import tomllib; print(tomllib.load(open("third_party/lock.toml", "rb"))["dependencies"]["vapoursynth"]["commit"])')"
actual_commit="$(git -C "$vendor" rev-parse HEAD)"
if [[ "$actual_commit" != "$locked_commit" ]]; then
  echo "error: $vendor is at $actual_commit, expected $locked_commit" >&2
  exit 1
fi
patch="$(uv run --locked python -c 'import tomllib; print(tomllib.load(open("third_party/lock.toml", "rb"))["dependencies"]["vapoursynth"]["patches"][0])')"
if git -C "$vendor" apply --reverse --check --unidiff-zero --whitespace=error "$root/$patch" >/dev/null 2>&1; then
  echo "error: browser patch $patch is already applied; native conformance requires an unpatched source tree" >&2
  exit 1
fi
if ! git -C "$vendor" apply --check --unidiff-zero --whitespace=error "$root/$patch" >/dev/null 2>&1; then
  echo "error: locked patch state is neither pending nor applied" >&2
  exit 1
fi

mkdir -p "$root/build"
if [[ -d "$vendor_build/meson-private" ]]; then
  uv run --locked meson setup "$vendor_build" "$vendor" --reconfigure --wrap-mode=nodownload --buildtype=debug -Denable_x86_asm=false -Denable_arm_asm=false
else
  uv run --locked meson setup "$vendor_build" "$vendor" --wrap-mode=nodownload --buildtype=debug -Denable_x86_asm=false -Denable_arm_asm=false
fi
uv run --locked meson compile -C "$vendor_build"

if [[ -d "$native_build/meson-private" ]]; then
  uv run --locked meson setup "$native_build" "$root" --reconfigure -Dnative_upstream_build="$vendor_build" --buildtype=debug
else
  uv run --locked meson setup "$native_build" "$root" -Dnative_upstream_build="$vendor_build" --buildtype=debug
fi
uv run --locked meson compile -C "$native_build"
if [[ ! -x "$runner" ]]; then
  echo "error: native conformance runner was not built at $runner" >&2
  exit 1
fi

native_library_path="$vendor_build"
export DYLD_LIBRARY_PATH="$native_library_path${DYLD_LIBRARY_PATH:+:$DYLD_LIBRARY_PATH}"
export LD_LIBRARY_PATH="$native_library_path${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}"
uv run --locked python native/tests/generate_corpus.py --runner "$runner" --check
uv run --locked meson test -C "$native_build" --print-errorlogs

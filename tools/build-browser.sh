#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")/.."
export PATH="$PWD/toolchains:$PATH"

uv run --locked python tools/apply_upstream_patches.py
if [[ -d build/browser/meson-private ]]; then
    uv run --locked meson setup --reconfigure build/browser . --cross-file toolchains/emscripten.ini --buildtype debug
else
    uv run --locked meson setup build/browser . --cross-file toolchains/emscripten.ini --buildtype debug
fi
uv run --locked meson compile -C build/browser
uv run --locked meson test -C build/browser --print-errorlogs

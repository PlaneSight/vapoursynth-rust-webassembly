#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")/.."

python3 tools/apply_upstream_patches.py
meson setup build/browser . --cross-file toolchains/emscripten.ini --buildtype debug
meson compile -C build/browser
meson test -C build/browser --print-errorlogs

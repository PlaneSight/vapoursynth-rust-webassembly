#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")/.."
export PATH="$PWD/toolchains:$PATH"

python3 tools/apply_upstream_patches.py
if [[ -d build/browser/meson-private ]]; then
    meson setup --reconfigure build/browser . --cross-file toolchains/emscripten.ini --buildtype debug
else
    meson setup build/browser . --cross-file toolchains/emscripten.ini --buildtype debug
fi
meson compile -C build/browser
meson test -C build/browser --print-errorlogs

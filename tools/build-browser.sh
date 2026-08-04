#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")/.."

python3 tools/apply_upstream_patches.py
if [[ -d build/browser/meson-private ]]; then
    meson setup --reconfigure build/browser . --cross-file toolchains/emscripten.ini --buildtype debug \
        -Dbuild_rust_emscripten_probe=true
else
    meson setup build/browser . --cross-file toolchains/emscripten.ini --buildtype debug \
        -Dbuild_rust_emscripten_probe=true
fi
meson compile -C build/browser
meson test -C build/browser --print-errorlogs

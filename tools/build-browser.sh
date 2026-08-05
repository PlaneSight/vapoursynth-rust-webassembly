#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")/.."
export PATH="$PWD/toolchains:$PATH"

print_browser_artifacts() {
    echo "::group::browser build artifacts"
    find build/browser -maxdepth 4 -type f -printf '%p (%s bytes)\n' 2>/dev/null | sort || true
    echo "::endgroup::"
}

trap 'status=$?; if (( status != 0 )); then print_browser_artifacts; fi; exit "$status"' EXIT

uv run --locked python tools/apply_upstream_patches.py
if [[ -d build/browser/meson-private ]]; then
    uv run --locked meson setup --reconfigure build/browser . --cross-file toolchains/emscripten.ini --buildtype debug
else
    uv run --locked meson setup build/browser . --cross-file toolchains/emscripten.ini --buildtype debug
fi
uv run --locked meson compile -C build/browser
uv run --locked meson test -C build/browser --print-errorlogs

runtime_dir="web/runtime"
rm -rf "$runtime_dir"
mkdir -p "$runtime_dir"

module_js="build/browser/native/vapoursynth-browser-module.js"
if [[ ! -f "$module_js" ]]; then
    module_js="$(find build/browser -type f -name 'vapoursynth-browser-module*.js' -print -quit)"
fi

module_wasm="build/browser/native/vapoursynth-browser-module.wasm"
if [[ ! -f "$module_wasm" ]]; then
    module_wasm="$(find build/browser -type f -name 'vapoursynth-browser-module*.wasm' -print -quit)"
fi

if [[ -z "${module_js:-}" || ! -f "$module_js" ]]; then
    echo "error: generated Emscripten JavaScript module was not found" >&2
    exit 1
fi
if [[ -z "${module_wasm:-}" || ! -f "$module_wasm" ]]; then
    echo "error: generated Emscripten WebAssembly module was not found" >&2
    exit 1
fi

cp "$module_js" "$runtime_dir/vapoursynth-browser-module.js"
cp "$module_wasm" "$runtime_dir/vapoursynth-browser-module.wasm"

print_browser_artifacts
echo "Staged browser runtime:"
ls -lh "$runtime_dir"

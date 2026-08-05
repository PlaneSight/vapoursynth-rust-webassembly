#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")/.."
export PATH="$PWD/toolchains:$PATH"

print_emscripten_artifacts() {
    echo "::group::emscripten build artifacts"
    find build/emscripten -maxdepth 4 -type f -printf '%p (%s bytes)\n' 2>/dev/null | sort || true
    echo "::endgroup::"
}

trap 'status=$?; if (( status != 0 )); then print_emscripten_artifacts; fi; exit "$status"' EXIT

uv run --locked python tools/apply_upstream_patches.py
if [[ -d build/emscripten/meson-private ]]; then
    uv run --locked meson setup --reconfigure build/emscripten . --cross-file toolchains/emscripten.ini --buildtype debug
else
    uv run --locked meson setup build/emscripten . --cross-file toolchains/emscripten.ini --buildtype debug
fi
uv run --locked meson compile -C build/emscripten
uv run --locked meson test -C build/emscripten --print-errorlogs

dist_dir="build/web"
rm -rf "$dist_dir"
mkdir -p "$dist_dir"

cp -R web/app web/protocol web/python web/runtime "$dist_dir/"
rm -rf "$dist_dir/python/__pycache__"

runtime_dir="$dist_dir/runtime"

module_js="build/emscripten/native/vapoursynth-browser-module.js"
if [[ ! -f "$module_js" ]]; then
    module_js="$(find build/emscripten -type f -name 'vapoursynth-browser-module*.js' -print -quit)"
fi

module_wasm="build/emscripten/native/vapoursynth-browser-module.wasm"
if [[ ! -f "$module_wasm" ]]; then
    module_wasm="$(find build/emscripten -type f -name 'vapoursynth-browser-module*.wasm' -print -quit)"
fi

if [[ -z "${module_js:-}" || ! -f "$module_js" ]]; then
    echo "error: generated Emscripten JavaScript module was not found" >&2
    exit 1
fi
if [[ -z "${module_wasm:-}" || ! -f "$module_wasm" ]]; then
    echo "error: generated Emscripten WebAssembly module was not found" >&2
    exit 1
fi
if grep -Eq "from ['\"]module['\"]" "$module_js"; then
    echo "error: browser Emscripten module imports the Node.js 'module' builtin" >&2
    exit 1
fi

cp "$module_js" "$runtime_dir/vapoursynth-browser-module.js"
cp "$module_wasm" "$runtime_dir/vapoursynth-browser-module.wasm"

print_emscripten_artifacts
echo "Staged browser distribution:"
ls -lh "$runtime_dir"

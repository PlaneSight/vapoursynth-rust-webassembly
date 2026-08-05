#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")/.."
export PATH="$PWD/toolchains:$PATH"

locked_patch_rel="patches/vapoursynth/0001-static-browser-runtime.patch"
locked_patch="$PWD/$locked_patch_rel"
applied_by_this_run=0

print_emscripten_artifacts() {
    echo "::group::emscripten build artifacts"
    find build/emscripten -maxdepth 4 -type f -printf '%p (%s bytes)\n' 2>/dev/null | sort || true
    echo "::endgroup::"
}

cleanup() {
    local status=$?
    if (( applied_by_this_run )); then
        if git -C vendor/vapoursynth apply --reverse --unidiff-zero --whitespace=error "$locked_patch" >/dev/null 2>&1; then
            echo "reverted $locked_patch_rel in vendor/vapoursynth"
        else
            echo "error: could not reverse $locked_patch_rel in vendor/vapoursynth" >&2
            if (( status == 0 )); then
                status=1
            fi
        fi
    fi
    if (( status != 0 )); then
        print_emscripten_artifacts
    fi
    exit "$status"
}
trap cleanup EXIT

if ! git -C vendor/vapoursynth status --porcelain >/dev/null 2>&1; then
    echo "error: vendor/vapoursynth is not a git worktree; run 'git submodule update --init --recursive' before building" >&2
    exit 1
fi
if [[ -n "$(git -C vendor/vapoursynth status --porcelain)" ]]; then
    echo "error: vendor/vapoursynth has uncommitted changes; refusing to modify it" >&2
    exit 1
fi

patch_was_pending=0
if git -C vendor/vapoursynth apply --reverse --check --unidiff-zero --whitespace=error "$locked_patch" >/dev/null 2>&1; then
    :
elif git -C vendor/vapoursynth apply --check --unidiff-zero --whitespace=error "$locked_patch" >/dev/null 2>&1; then
    patch_was_pending=1
else
    echo "error: $locked_patch_rel is neither applicable nor already applied in vendor/vapoursynth" >&2
    exit 1
fi

apply_status=0
uv run --locked python tools/apply_upstream_patches.py || apply_status=$?

if (( patch_was_pending )) && git -C vendor/vapoursynth apply --reverse --check --unidiff-zero --whitespace=error "$locked_patch" >/dev/null 2>&1; then
    applied_by_this_run=1
fi

if (( apply_status != 0 )); then
    exit "$apply_status"
fi
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

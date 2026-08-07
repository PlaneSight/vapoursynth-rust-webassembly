#!/usr/bin/env bash
set -euo pipefail

if [[ $# -lt 2 || $# -gt 3 ]]; then
    echo "usage: $0 <output-archive> <cargo-target-directory> [threaded]" >&2
    exit 64
fi

threaded="${3:-0}"
case "$threaded" in
    0|false) ;;
    1|true) ;;
    *)
        echo "error: threaded must be 0/1 or false/true" >&2
        exit 64
        ;;
esac

repository_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
output_archive="$1"
cargo_target_directory="$2"

mkdir -p "$(dirname "$output_archive")" "$cargo_target_directory"
output_archive="$(cd "$(dirname "$output_archive")" && pwd)/$(basename "$output_archive")"
cargo_target_directory="$(cd "$cargo_target_directory" && pwd)"
core_archive="$cargo_target_directory/wasm32-unknown-emscripten/debug/libvapoursynth_core.a"

cd "$repository_root"
export CARGO_TARGET_DIR="$cargo_target_directory"
export CARGO_TARGET_WASM32_UNKNOWN_EMSCRIPTEN_LINKER=emcc
export RUSTFLAGS="-Cpanic=abort"
if [[ "$threaded" == "1" || "$threaded" == "true" ]]; then
    # Match Emscripten's shared-memory ABI when this archive joins a pthread link.
    export RUSTFLAGS="$RUSTFLAGS -C target-feature=+atomics,+bulk-memory,+mutable-globals -C link-arg=-pthread"
fi
cargo build --locked --package vapoursynth-core --target wasm32-unknown-emscripten

if [[ ! -f "$core_archive" ]]; then
    echo "Rust ownership archive was not produced: $core_archive" >&2
    exit 1
fi

cp "$core_archive" "$output_archive"

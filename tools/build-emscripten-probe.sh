#!/usr/bin/env bash
set -euo pipefail

if [[ $# -ne 2 ]]; then
    echo "usage: $0 <output-archive> <cargo-target-directory>" >&2
    exit 64
fi

repository_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
output_archive="$1"
cargo_target_directory="$2"

mkdir -p "$(dirname "$output_archive")" "$cargo_target_directory"
output_archive="$(cd "$(dirname "$output_archive")" && pwd)/$(basename "$output_archive")"
cargo_target_directory="$(cd "$cargo_target_directory" && pwd)"
probe_archive="$cargo_target_directory/wasm32-unknown-emscripten/debug/libvapoursynth_emscripten_probe.a"

cd "$repository_root"
export CARGO_TARGET_DIR="$cargo_target_directory"
export CARGO_TARGET_WASM32_UNKNOWN_EMSCRIPTEN_LINKER=emcc
export RUSTFLAGS="-Cpanic=abort"
cargo build --locked --package vapoursynth-emscripten-probe --target wasm32-unknown-emscripten

if [[ ! -f "$probe_archive" ]]; then
    echo "Rust probe archive was not produced: $probe_archive" >&2
    exit 1
fi

cp "$probe_archive" "$output_archive"

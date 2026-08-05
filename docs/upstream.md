# Upstream Build Constraints

This document records the durable constraints around building against pinned upstream inputs: locked inputs, the patch boundary, build tool requirements, the ownership ABI, and the generated artifact lifecycle.

## Locked inputs

| Input | Pin | Purpose |
|---|---:|---|
| VapourSynth | `37eed3ddbdb61e92975d9a4b054a488e93fc9a1c` | Upstream core and public API headers. |
| Pyodide | `0.29.4` | Worker-local Python authoring runtime. |
| Emscripten | `3.1.68` | C++ compiler, linker, and Node executable wrapper. |
| Rust | `1.85.0` | `no_std` static-library compiler for the ownership layer. |
| Meson | `1.3.2` | Cross-build configuration. |
| Patch set | `patches/vapoursynth/` | Static plugin and single-thread browser configuration. |

`third_party/lock.toml` is the machine-readable authority: it names the pinned VapourSynth commit, the Emscripten and Rust toolchain versions, the Pyodide distribution, and the exact patch file applied to the vendored source. The patch uses zero context deliberately, so the patch tool first verifies the exact 40-character source commit. `THIRD_PARTY_NOTICES.md` records the source licence obligations. `Cargo.lock` pins the workspace's Rust dependency resolution and CI uses Cargo's `--locked` mode; `uv.lock` pins the Python and Meson tool versions the same way.

## Build tool requirements

UV manages Python and Meson only; Cargo and Node are invoked directly and are not pinned by UV. Canonical commands:

```bash
uv sync --locked
cargo test --workspace --locked
npm ci
npm test
uv run --locked python -m unittest discover -s web/python -p 'test_*.py'
./tools/build-browser.sh
```

Prerequisites: UV 0.12.1+, Rust 1.85.0 with the `wasm32-unknown-emscripten` target, Emscripten 3.1.68, and Node for the Emscripten executable wrapper. A fresh checkout materializes `vendor/vapoursynth` with `git submodule update --init --recursive` at its locked commit.

`tools/build-browser.sh` applies the upstream patch set and runs the Meson setup, compile, and test phases through locked UV commands with the Emscripten cross-file. Meson invokes `tools/build-emscripten-core.sh` as a custom target; its Cargo output stays under the Meson build tree before `em++` performs the final link. The `browser-integration` CI job installs the pinned Emscripten SDK and Rust target, then runs the script from a clean checkout.

Generated locations are fixed: the Meson Emscripten build tree is `build/emscripten/`, staged browser artifacts go to `build/web/`, and generated test artifacts go to `build/test/`.

## Patch boundary

The pinned patch set only enables the constrained browser path:

- registers a selected `std` plugin implementation directly in the core;
- disables dynamic library loading and automatic plugin discovery;
- excludes the resize/text internal plugins and their extra dependency closure;
- uses the upstream portable binary16 conversion fallback because Emscripten wasm32 does not implement `_Float16`;
- drives frame work synchronously with one scheduler thread; and
- avoids waiting on a condition variable while the one-thread scheduler must make progress.

It does not make `getFrameAsync` browser-asynchronous, support dynamic plugins, or establish full scheduler conformance. Do not widen the plugin/source list without a separate lock update, patch, and test.

## Ownership ABI

`vapoursynth-core` compiles as one `no_std`, `panic=abort` Rust static library for `wasm32-unknown-emscripten`; `em++` remains the one final linker alongside the existing C++ bridge and upstream core. The boundary is a handwritten C ABI (`#[cfg(target_os = "emscripten")]`), not `wasm-bindgen`, which does not support the Emscripten target. The layer owns private `(slot, generation)` tokens for `Core`, `Node`, and `Frame`, while C++ owns every actual upstream pointer. The final Rust-containing `em++` link carries Rust 1.85's `-sWASM_BIGINT` and `-sABORTING_MALLOC=0` ABI settings, and Rust panics and C++ exceptions never cross the ABI.

The layer rejects frames whose RGBA8 output would exceed 16 MiB before it creates an upstream core. This is a fixed memory-safety limit for the frame transport, not a long-term capability claim; upstream's core allocation path cannot reliably translate every out-of-memory condition into a status.

Rust documents Emscripten ABI variation across SDK versions and linker settings, and recommends rebuilding `std` with the matching SDK when a later layer needs it. See [Rust's Emscripten target documentation](https://doc.rust-lang.org/rustc/platform-support/wasm32-unknown-emscripten.html).

## Generated artifact lifecycle

| Path | Owner | Lifecycle |
|---|---|---|
| `vendor/vapoursynth` | Git submodule | Checked out at the locked commit; the patch tool is the only supported mutation. Reset with `git -C vendor/vapoursynth restore .`. |
| `patches/vapoursynth/` | This repository | Reviewable patch source; changes require an upstream commit/pin review. |
| `build/emscripten/` | Meson | Ignored generated Emscripten build tree, including target-local Rust build products; delete and recreate when toolchain inputs change. |
| `build/web/` | Build script | Ignored staged browser artifacts. |
| `build/test/` | Test tooling | Ignored generated test artifacts. |
| `target` | Cargo | Ignored generated output. |
| `.venv`, caches | Local tools | Ignored ephemeral state. |

## Stable render evidence

The native render path is verified by `native/tests/render_invert.cpp`: a 37×19 blank clip through `std.Invert` whose every resulting RGBA pixel is `255, 255, 255, 255`. The `browser-integration` CI job exercises the same path end to end from a clean checkout.

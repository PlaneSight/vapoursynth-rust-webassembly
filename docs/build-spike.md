# Pinned Browser Build Spike

## Scope

This is the smallest upstream-backed browser build path:

```text
upstream `std.BlankClip` (default black RGB24 frame)
→ upstream `std.Invert`
→ upstream `VSFrame`
→ row-wise planar RGB to RGBA8 copy
→ Node-compatible Emscripten smoke executable
```

The direct C++ smoke test uses a 37×19 frame and verifies every resulting RGBA pixel is `255, 255, 255, 255`. A second ownership smoke reaches the same result through no-`std` Rust `Core`, `Node`, and `Frame` wrappers. Both are intentionally headless: there is no worker, canvas, Pyodide, decoder, or JavaScript-facing Rust API in this milestone.

## Locked inputs

| Input | Pin | Purpose |
|---|---:|---|
| VapourSynth | `37eed3ddbdb61e92975d9a4b054a488e93fc9a1c` | Upstream core and public API headers. |
| Emscripten | `3.1.68` | C++ compiler, linker, and Node executable wrapper. |
| Rust | `1.85.0` | `no_std` static-library compiler for the ownership layer. |
| Meson | `1.3.2` | Cross-build configuration. |
| Patch set | `patches/vapoursynth/0001-static-browser-spike.patch` | Static plugin and one-thread browser configuration. |

`third_party/lock.toml` is the machine-readable authority. The patch uses zero context deliberately, so the patch tool first verifies the exact 40-character source commit. `THIRD_PARTY_NOTICES.md` records the source licence obligations.
`Cargo.lock` pins the workspace's Rust dependency resolution; CI and the probe build use Cargo's `--locked` mode.

## Build

Install Rust 1.85.0 with `wasm32-unknown-emscripten`, Emscripten 3.1.68, and Meson 1.3.2, then run:

```bash
git submodule update --init --recursive
python3 tools/apply_upstream_patches.py
meson setup build/browser . --cross-file toolchains/emscripten.ini --buildtype debug
meson compile -C build/browser
meson test -C build/browser --print-errorlogs
```

`tools/build-browser.sh` executes the same sequence. Meson invokes `tools/build-emscripten-core.sh` as a custom target; its Cargo output stays under the Meson build tree before `em++` performs the final link. The CI workflow installs the Emscripten Rust target, the pinned Meson and Emscripten versions, and runs that script from a clean checkout.

## Upstream patch boundary

The patch only enables this constrained executable path:

- registers a selected `std` plugin implementation directly in the core;
- disables dynamic library loading and automatic plugin discovery;
- excludes the resize/text internal plugins and their extra dependency closure;
- uses the upstream portable binary16 conversion fallback because Emscripten
  wasm32 does not implement `_Float16`;
- drives frame work synchronously with one scheduler thread; and
- avoids waiting on a condition variable while the one-thread scheduler must make progress.

It does **not** make `getFrameAsync` browser-asynchronous, support dynamic plugins, or establish full scheduler conformance. Do not widen the plugin/source list without a separate lock update, patch, and test.

## Artifact lifecycle

| Path | Owner | Lifecycle |
|---|---|---|
| `vendor/vapoursynth` | Git submodule | Checked out at the locked commit; the patch tool is the only supported mutation. Reset with `git -C vendor/vapoursynth restore .`. |
| `patches/vapoursynth/` | This repository | Reviewable patch source; changes require an upstream commit/pin review. |
| `build/browser` | Meson | Ignored generated output; delete and recreate when toolchain inputs change. |
| `build/browser/native/cargo` | Meson custom target / Cargo | Ignored target-local Rust build products for the ownership layer. |
| `target` | Cargo | Ignored generated output. |
| `.venv`, caches | Local tools | Ignored ephemeral state. |

## Rust ownership layer

The scaffold's current `wasm32-unknown-unknown` + `wasm-bindgen` module must not be linked directly against objects from this Emscripten build. `wasm-bindgen` explicitly excludes the Emscripten target, so the ownership layer uses a handwritten C ABI instead.

`vapoursynth-core` compiles as one `no_std`, `panic=abort` Rust static library for `wasm32-unknown-emscripten`; `em++` remains the one final linker alongside the existing C++ bridge and upstream core. It owns private `(slot, generation)` tokens for `Core`, `Node`, and `Frame`, while C++ owns every actual upstream pointer. The final Rust-containing `em++` link explicitly carries Rust 1.85's `-sWASM_BIGINT` and `-sABORTING_MALLOC=0` ABI settings. Rust panics and C++ exceptions must never cross that ABI.

The layer rejects frames whose RGBA8 output would exceed 16 MiB before it creates an upstream core. This is a fixed-memory safety limit for the current frame transport, not a long-term capability claim; upstream's current core allocation path cannot reliably translate every out-of-memory condition into a status.

This is intentionally narrower than a Rust standard-library claim or a general graph/worker ownership claim. Rust documents Emscripten ABI variation across SDK versions and linker settings, and recommends rebuilding `std` with the matching SDK when a later layer needs it. See [Rust's Emscripten target documentation](https://doc.rust-lang.org/rustc/platform-support/wasm32-unknown-emscripten.html).

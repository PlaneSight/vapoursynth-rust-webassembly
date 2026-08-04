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

The smoke test uses a 37×19 frame and verifies every resulting RGBA pixel is `255, 255, 255, 255`. It is intentionally headless: there is no worker, canvas, Pyodide, decoder, or direct Rust binding in this milestone.

## Locked inputs

| Input | Pin | Purpose |
|---|---:|---|
| VapourSynth | `37eed3ddbdb61e92975d9a4b054a488e93fc9a1c` | Upstream core and public API headers. |
| Emscripten | `3.1.68` | C++ compiler, linker, and Node executable wrapper. |
| Meson | `1.3.2` | Cross-build configuration. |
| Patch set | `patches/vapoursynth/0001-static-browser-spike.patch` | Static plugin and one-thread browser configuration. |

`third_party/lock.toml` is the machine-readable authority. The patch uses zero context deliberately, so the patch tool first verifies the exact 40-character source commit. `THIRD_PARTY_NOTICES.md` records the source licence obligations.

## Build

Install Emscripten 3.1.68, expose its tools on `PATH`, then run:

```bash
git submodule update --init --recursive
python3 tools/apply_upstream_patches.py
meson setup build/browser . --cross-file toolchains/emscripten.ini --buildtype debug
meson compile -C build/browser
meson test -C build/browser --print-errorlogs
```

`tools/build-browser.sh` executes the same sequence. The CI workflow installs the pinned Meson and Emscripten versions and runs that script from a clean checkout.

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
| `target` | Cargo | Ignored generated output. |
| `.venv`, caches | Local tools | Ignored ephemeral state. |

## Rust integration constraint

The scaffold's current `wasm32-unknown-unknown` + `wasm-bindgen` module must not be linked directly against objects from this Emscripten build. The next integration spike will use Rust's `wasm32-unknown-emscripten` target so Rust and C++ share one Emscripten ABI; Rust documents this target as the path for interoperating with C/C++ and recommends building the standard library with the matching Emscripten SDK when ABI alignment matters. See [Rust's Emscripten target documentation](https://doc.rust-lang.org/rustc/platform-support/wasm32-unknown-emscripten.html).

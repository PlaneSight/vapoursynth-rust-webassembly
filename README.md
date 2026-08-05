# VapourSynth Rust WebAssembly

An architecture-first research project for running the **real upstream VapourSynth core** in a browser-oriented WebAssembly build. It is not a JavaScript filter-graph reimplementation.

## Current status

**Phases 1a through 1c are verified.** CI builds the pinned upstream core, safe thread-affine Rust ownership layer, and a worker-owned Emscripten ES module. The browser runtime path is:

```text
main-thread WorkerClient
→ dedicated module worker
→ EmscriptenSession
→ safe no_std Rust Core / Node / Frame
→ C++ opaque-handle bridge
→ upstream VapourSynth
→ transferable RGBA8 ArrayBuffer
→ canvas
```

Rust owns only thread-affine `(slot, generation)` tokens; C++ retains the `VSAPI` table and every actual upstream pointer. Raw VapourSynth pointers never cross the Rust, worker, or JavaScript boundaries.

See [the build-spike record](docs/build-spike.md), [the implementation plan](docs/plan.md), and [the support matrix](docs/porting-status.md).

## What the current runtime proves

```text
upstream VapourSynth sources at a pinned commit
→ static std plugin registration
→ BlankClip(37×19, RGB24)
→ std.Invert
→ upstream VSFrame
→ safe Rust ownership
→ Emscripten ES-module export
→ worker protocol
→ transferable RGBA8 frame
```

The smoke tests verify every output pixel is opaque white. The input is the upstream black default frame; the inversion is intentional so the test observes a real filter result rather than only allocation.

## Repository layout

- `native/` — narrow C++ ABI bridge, Emscripten artifacts, and upstream smoke tests.
- `web/` — worker protocol, Emscripten session adapter, main-thread client, tests, and canvas demo.
- `patches/vapoursynth/` — isolated, checked upstream changes.
- `third_party/lock.toml` — source, commit, licence, patch, and toolchain lock record.
- `toolchains/` — Meson cross files.
- `tools/` — deterministic build and patch-entry scripts.
- `vendor/vapoursynth` — pinned upstream Git submodule; never edited as an unrecorded local fork.
- `crates/vapoursynth-sys/` — handwritten, fixed-width imports for the C++ opaque-handle ABI.
- `crates/vapoursynth-core/` — no-`std`, thread-affine Rust `Core` / `Node` / `Frame` ownership layer.
- `crates/vapoursynth-wasm-host/` — isolated `wasm-bindgen` protocol scaffold; it does not pretend to be the Emscripten runtime.
- `docs/` — architecture, scope, status, and reproducibility records.

## Building the browser runtime

The build needs Rust 1.85.0 with the `wasm32-unknown-emscripten` target, Python 3.11+, Git, Meson 1.3.2, Node, and Emscripten SDK 3.1.68 on `PATH`.

```bash
git submodule update --init --recursive
tools/build-browser.sh
```

The script applies the locked upstream patch, configures `build/browser`, builds the direct C++ smoke, safe Rust smoke, and worker-owned ES module, then runs their Node tests. Open `web/index.html` through a local HTTP server after building to exercise the minimal canvas harness.

## Non-goals of this milestone

- General plugin/function invocation maps.
- Pyodide or `.vpy` execution.
- Dynamic plugin discovery or native plugin binaries.
- `std.Resize` and its `zimg` dependency.
- Real video decoding or encoding.
- Threaded scheduling or performance claims.

## Design rules

1. Compatibility claims require executable tests.
2. Upstream patches stay isolated, pinned, and documented.
3. Unsupported browser facilities fail explicitly rather than silently emulating desktop behaviour.
4. Raw pointers do not cross JavaScript, Python, or worker boundaries.
5. Each next layer must build on a verified upstream frame path.

## License

No project license has been selected yet. Vendored dependencies retain their own licenses. Add a project license before distributing releases.

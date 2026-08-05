# VapourSynth Rust WebAssembly

An architecture-first research project for running the **real upstream VapourSynth core** in a browser-oriented WebAssembly build. It is not a JavaScript filter-graph reimplementation.

## Current status

**Phases 1a and 1b.0 are verified; Phase 1b.1 is an ownership candidate.** The Emscripten CI job has verified both the narrow upstream path and an Emscripten-linked Rust static library. The current source adds typed opaque ownership:

```text
C++ smoke → safe no_std Rust Core / Node / Frame → C++ handle bridge → upstream VapourSynth → RGBA8
```

Rust owns only thread-affine `(slot, generation)` tokens; C++ retains the `VSAPI` table and every actual upstream pointer. The current `wasm-bindgen` crate remains an isolated `wasm32-unknown-unknown` scaffold; it is not part of the Emscripten artifact. `wasm-bindgen` explicitly does not support `wasm32-unknown-emscripten`.

See [the build-spike record](docs/build-spike.md), [the implementation plan](docs/plan.md), and [the support matrix](docs/porting-status.md).

## What the spike proves

```text
upstream VapourSynth sources at a pinned commit
→ static std plugin registration
→ BlankClip(37×19, RGB24)
→ std.Invert
→ upstream VSFrame
→ explicit RGB-planar to RGBA8 copy
```

The smoke executable verifies every output pixel is opaque white. Its input is the upstream black default frame; the inversion is intentional so the test observes a real filter result rather than only allocation.

## Repository layout

- `native/` — narrow C++ ABI bridge and the Emscripten smoke executable.
- `patches/vapoursynth/` — isolated, checked upstream changes.
- `third_party/lock.toml` — source, commit, licence, patch, and toolchain lock record.
- `toolchains/` — Meson cross files.
- `tools/` — deterministic build and patch-entry scripts.
- `vendor/vapoursynth` — pinned upstream Git submodule; never edited as an unrecorded local fork.
- `crates/vapoursynth-sys/` — handwritten, fixed-width imports for the C++ opaque-handle ABI.
- `crates/vapoursynth-core/` — no-`std`, thread-affine Rust `Core` / `Node` / `Frame` ownership layer linked into the browser smoke.
- `crates/vapoursynth-wasm-host/` — deliberately separate `wasm-bindgen` scaffold for the future worker API.
- `docs/` — architecture, scope, status, and reproducibility records.

## Building the browser spike

The spike needs Rust 1.85.0 with the `wasm32-unknown-emscripten` target, Python 3.11+, Git, Meson 1.3.2, Node, and the Emscripten SDK 3.1.68 on `PATH`.

```bash
git submodule update --init --recursive
tools/build-browser.sh
```

The script applies the locked upstream patch, configures `build/browser`, builds both smoke executables, and runs their Node tests. For the explicit commands and artifact lifecycle, read [docs/build-spike.md](docs/build-spike.md).

## Non-goals of this milestone

- Browser worker or canvas presentation.
- Direct Rust access to `VSCore`, `VSNode`, `VSFrame`, maps, callbacks, or error-string pointers.
- Linking the `wasm-bindgen` scaffold into the Emscripten artifact.
- Pyodide or `.vpy` execution.
- Dynamic plugin discovery or native plugin binaries.
- `std.Resize` and its `zimg` dependency.
- Threaded scheduling, WebCodecs, or performance claims.

## Design rules

1. Compatibility claims require executable tests.
2. Upstream patches stay isolated, pinned, and documented.
3. Unsupported browser facilities fail explicitly rather than silently emulating desktop behaviour.
4. Raw pointers do not cross JavaScript, Python, or worker boundaries.
5. Each next layer must build on a verified upstream frame path.

## License

No project license has been selected yet. Vendored dependencies retain their own licenses. Add a project license before distributing releases.

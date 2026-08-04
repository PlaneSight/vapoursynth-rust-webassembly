# VapourSynth Rust WebAssembly

An architecture-first research project for running the **real upstream VapourSynth core** in a browser-oriented WebAssembly build. It is not a JavaScript filter-graph reimplementation.

## Current status

**Phase 1a: pinned upstream browser-build spike.** The tree now contains a narrowly scoped Emscripten build that statically registers the upstream `std` plugin, evaluates `BlankClip → Invert → frame 0`, and copies the planar RGB24 frame into caller-owned RGBA8 memory. The `browser-spike` CI job is the build authority for that path.

This is deliberately a headless smoke test, not a canvas demo and not yet a Rust-to-VapourSynth FFI integration. The current `wasm-bindgen` crate remains a truthful scaffold: it reports that upstream is not linked in that separate `wasm32-unknown-unknown` module.

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
- `crates/` — Rust ownership and worker-protocol scaffolding, not yet linked to the native spike.
- `docs/` — architecture, scope, status, and reproducibility records.

## Building the browser spike

The spike needs Python 3.11+, Git, Meson 1.3.2, Node, and the Emscripten SDK 3.1.68 on `PATH`.

```bash
git submodule update --init --recursive
tools/build-browser.sh
```

The script applies the locked upstream patch, configures `build/browser`, builds the executable, and runs the smoke test. For the explicit commands and artifact lifecycle, read [docs/build-spike.md](docs/build-spike.md).

## Non-goals of this milestone

- Browser worker or canvas presentation.
- Direct Rust ownership of `VSCore`, `VSNode`, or `VSFrame`.
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

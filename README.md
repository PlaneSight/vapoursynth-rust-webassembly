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

**Milestone 3 is a build candidate.** A second dedicated worker loads pinned Pyodide and installs a deliberately small asynchronous `vapoursynth` package. Python graph values contain opaque worker tokens only; the nested VapourSynth worker remains the sole owner of the Emscripten module and every upstream resource.

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

The build needs UV 0.12.1+, Rust 1.85.0 with the `wasm32-unknown-emscripten` target, Git, Node, and Emscripten SDK 3.1.68 on `PATH`. UV pins Python 3.11 and Meson 1.3.2 from `pyproject.toml` and `uv.lock`; do not install Meson with `pip` or as a global tool.

```bash
git submodule update --init --recursive
uv sync --locked
uv run --locked bash tools/build-browser.sh
```

The script applies the locked upstream patch, configures `build/browser`, builds the direct C++ smoke, safe Rust smoke, and worker-owned ES module, then runs their Node tests. Open `web/index.html` through a local HTTP server after building to exercise the canvas harness:

```bash
uv run --locked python -m http.server 4173
```

Open `http://localhost:4173/web/index.html` in a browser. The demo requires HTTP because it uses ES modules and nested workers.

## Reproducible command entry points

UV is the project entry point for Python, Meson, and all documented test and build commands. Cargo and npm still own their native dependency graphs (`Cargo.lock` and `package-lock.json`), but invoke them through UV so the Python tool environment is always locked and synchronized first.

```bash
# One-time Node dependency installation for the web test suite.
uv run --locked bash -lc 'npm ci'

# Focused suites.
uv run --locked node --test web/*.test.mjs
uv run --locked python -m unittest discover -s web/python -p 'test_*.py'
uv run --locked cargo test --locked --workspace

# Verify the Python/Meson lock without changing it.
uv lock --check
```

Equivalent npm shortcuts are available as `npm run test:web`, `npm run test:python`, `npm run test:rust`, `npm run build:browser`, and `npm run serve:web`; each delegates to the locked UV command. Do not use bare `python`, `python3`, `pip`, or a global Meson installation for project work.

## Authoring a `.vpy`

The canvas demo starts a Pyodide worker, which starts the separate VapourSynth worker. Pyodide 0.29.4 is loaded from the pinned CDN URL by default; deployments can self-host a compatible distribution by providing another `indexURL` to `loadBrowserPyodide()`.

Authoring operations are intentionally asynchronous because every graph request crosses from the Python worker to the VapourSynth worker:

```python
import vapoursynth as vs

blank = await vs.core.std.BlankClip(width=320, height=180, format=vs.RGB24)
inverted = await vs.core.std.Invert(blank)
await vs.set_output(0, inverted)
```

The current supported subset is exactly `vs.RGB24`, `vs.core.std.BlankClip`, `vs.core.std.Invert`, `VideoNode`, and `vs.set_output()`. It renders only a one-frame `BlankClip → Invert` graph. Other namespaces, formats, frame counts, graph shapes, and APIs raise a specific unsupported error rather than falling back to an imitation.

## Non-goals of this milestone

- General plugin/function invocation maps.
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

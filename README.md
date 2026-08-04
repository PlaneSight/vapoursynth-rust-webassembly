# VapourSynth Rust WebAssembly

An architecture-first research project for running the **real upstream VapourSynth core** in a web browser, with Rust providing a safe host layer and WebAssembly/browser integration.

This repository is intentionally not a JavaScript filter graph that merely resembles VapourSynth. The compatibility backend is expected to compile and execute upstream `libvapoursynth`; browser-native Rust filters may later exist as an additional backend.

## Project status

**Phase 0: scaffold and build investigation.**

Nothing in the current tree should be interpreted as a completed VapourSynth port. The initial target is deliberately narrow:

```text
upstream VapourSynth core
→ Emscripten/WASM build
→ statically registered std plugin
→ BlankClip
→ frame 0 request
→ RGBA bytes
→ browser canvas
```

See [`docs/plan.md`](docs/plan.md) for milestones and explicit exit criteria, and [`docs/porting-status.md`](docs/porting-status.md) for the evidence-based support matrix.

## Intended architecture

```text
Pyodide worker (Python 3.14)
  └─ vapoursynth-compatible Python API
       └─ typed RPC / opaque node handles

VapourSynth worker
  ├─ upstream libvapoursynth compiled to WASM
  ├─ browser platform adapter
  ├─ statically linked portable plugins
  └─ Rust host and ownership layer

Browser main thread
  ├─ editor and diagnostics
  ├─ frame/video preview
  └─ request orchestration
```

Python never processes pixels. It builds and invokes real VapourSynth nodes through opaque handles. Frame execution remains in the dedicated VapourSynth worker.

## Workspace

- `crates/vapoursynth-sys`: raw ABI surface and generated bindings boundary.
- `crates/vapoursynth-core`: safe Rust ownership and error model.
- `crates/vapoursynth-wasm-host`: browser-facing `wasm-bindgen` API.
- `web/`: worker protocol and minimal browser harness.
- `vendor/`: pinned upstream sources or submodules; never silently modified.
- `docs/`: architecture, plan, compatibility claims and investigation notes.

## Non-goals for the first milestone

- Loading existing native `.dll`, `.so`, or `.dylib` plugins.
- Full Python package compatibility.
- Multithreaded scheduling.
- Video decoding or encoding.
- Dynamic plugin discovery.
- Claiming performance parity with native VapourSynth.

## Development

The Rust workspace is buildable as a host-side scaffold before the upstream core is linked:

```bash
cargo fmt --all --check
cargo clippy --workspace --all-targets -- -D warnings
cargo test --workspace
```

The browser target will eventually require:

- Rust stable
- `wasm-bindgen` / `wasm-pack`
- Emscripten SDK
- CMake and Ninja
- Python 3.14 with `uv` for tooling and Pyodide package preparation

Exact versions will be pinned once the first upstream build spike establishes a working toolchain combination.

## Design rules

1. Compatibility claims require executable tests.
2. Upstream patches must be isolated and documented.
3. Browser limitations must be represented explicitly, not hidden behind partial emulation.
4. Unsafe Rust remains confined to the FFI boundary.
5. Every cross-worker resource uses generation-checked opaque handles.
6. The first implementation prioritizes semantic correctness over clever optimization.

## License

No project license has been selected yet. Vendored dependencies retain their own licenses. Add a project license before distributing releases.
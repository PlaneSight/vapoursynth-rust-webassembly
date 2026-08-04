# Architecture

## Objective

Run the upstream VapourSynth core in a browser worker while retaining genuine node, frame, plugin invocation, and scheduling semantics wherever the browser permits them. Rust is the eventual ownership and browser-integration layer; it does not replace upstream VapourSynth in the compatibility backend.

## Present build boundary

The checked-in build spike is one Emscripten C++ module:

```text
caller-owned RGBA8 memory
  ↕ narrow C ABI
native/browser_bridge.cpp
  ↕ VapourSynth C API
statically linked upstream core + selected std plugin code
```

Only the bridge owns raw VapourSynth pointers today. RAII wrappers release maps, nodes, frames, and the core in dependency order; the C ABI accepts scalar dimensions and a caller-owned byte span, never a C++ or VapourSynth pointer.

The Rust `wasm-bindgen` scaffold currently targets `wasm32-unknown-unknown`, so it is a distinct module and cannot safely own pointers allocated by the Emscripten module. A direct Rust wrapper requires moving the Rust code that links the core to `wasm32-unknown-emscripten` and compiling both languages with compatible Emscripten settings. That is a later integration step, not an implicit ABI promise.

## Intended process model

### Main thread

Owns UI state, editor state, canvas presentation, and request coordination. It must never execute filters or synchronously wait for frame production.

### Python worker

Will host Pyodide and a deliberately supported `vapoursynth` API subset. Python values carry opaque worker handles, not frame buffers or native pointers.

### VapourSynth worker

Will own the upstream core, plugin registry, all `VSNode`/`VSFrame` lifetimes, frame cache, and execution queue. It is the only future component allowed to dereference VapourSynth pointers outside the Emscripten module.

## Browser-build constraints

The Phase 1a patch makes these explicit:

- only a statically registered subset of the standard plugin is present;
- dynamic library loading and automatic plugin discovery are rejected;
- the scheduler is synchronous and single-threaded for this smoke path;
- `getFrameAsync` must not be treated as browser-async behaviour yet;
- `std.Resize` is intentionally omitted, so `zimg` is not part of this build.

The initial frame transport copies one RGBA8 frame. A worker protocol will move to transferable `ArrayBuffer` ownership before video work; long-term paths should favour `VideoFrame` and WebCodecs rather than round-tripping pixels through Python.

## Boundary rules

- Raw C layouts and imports stay in `vapoursynth-sys` once Rust joins the same module.
- Safe Rust wrappers own every reference-count change and convert upstream errors immediately.
- JavaScript sees integers, structured errors, and transferable buffers—not pointers.
- Cross-worker handles must become generation-checked before reuse is possible.
- Worker shutdown releases retained resources deterministically.
- Python finalizers may request release, but correctness cannot depend on prompt garbage collection.

## Plugin model

Native desktop plugin binaries are not portable. Supported plugins must be rebuilt from source against the browser toolchain and audited for operating-system APIs, filesystem assumptions, thread-local state, SIMD/inline assembly, dynamic libraries, and callbacks crossing worker or Wasm boundaries. Static registration is the baseline; dynamic Wasm plugins are a separate research milestone.

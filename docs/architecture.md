# Architecture

## Objective

Run the upstream VapourSynth core inside a browser worker while retaining genuine node, frame, plugin invocation and scheduling semantics wherever the browser platform permits them.

The project uses Rust for ownership, validation and browser integration. Rust does not replace upstream VapourSynth in the compatibility backend.

## Process model

### Main thread

Owns UI state, editor state, canvas presentation and request coordination. It must never execute filters or block on synchronous frame production.

### Python worker

Hosts Pyodide/CPython 3.14 and a `vapoursynth` package compatible with the subset proven by conformance tests. Python objects contain opaque worker handles, not frame buffers or native pointers.

### VapourSynth worker

Owns the upstream core, plugin registry, all `VSNode`/`VSFrame` lifetimes, frame cache and execution queue. It is the only component allowed to dereference VapourSynth pointers.

## Boundary rules

- Raw C layouts and symbols exist only in `vapoursynth-sys`.
- Safe wrappers own reference-count changes and convert upstream errors immediately.
- JavaScript sees integers, structured errors and transferable buffers—not pointers.
- Handles must become generation-checked before resources can be reused.
- Worker shutdown releases all retained resources deterministically.
- Python finalizers may request release, but correctness must not depend on prompt garbage collection.

## Build model

The first upstream build should be a single Emscripten main module with the required core plugin statically registered. Dynamic side modules are deferred until the static path is proven.

The initial scheduler is single-threaded and worker-confined. WASM threads are a later build profile requiring cross-origin isolation and `SharedArrayBuffer`.

## Frame transport

Milestone 1 may copy one RGBA frame for clarity. The next transport must transfer ownership of an `ArrayBuffer`. Long-term video paths should prefer `VideoFrame`/WebCodecs and avoid round-tripping pixels through Python.

## Plugin model

Existing native plugin binaries are not portable. Supported plugins must be rebuilt from source against the browser toolchain and audited for:

- operating-system APIs
- filesystem assumptions
- thread-local state
- SIMD and inline assembly
- dynamic library dependencies
- callbacks crossing worker or WASM boundaries

Static registration is the baseline. A dynamic WASM plugin ABI is a separate research milestone, not an initial promise.

## Dual backend strategy

A later browser-native Rust/WebGPU backend may implement selected filters for performance. It must remain visibly distinct from the upstream compatibility backend and be tested against it where semantics overlap.

# Architecture

## Objective

Run the upstream VapourSynth core in a browser worker while retaining genuine node, frame, plugin invocation, and scheduling semantics wherever the browser permits them. Rust is the ownership layer of the browser build; it does not replace upstream VapourSynth in the compatibility backend.

## Build boundaries

The control path is one Emscripten C++ module:

```text
caller-owned RGBA8 memory
  ↕ narrow C ABI
native/browser_bridge.cpp
  ↕ VapourSynth C API
statically linked upstream core + selected std plugin code
```

Only the bridge owns raw VapourSynth pointers. RAII wrappers release maps, nodes, frames, and the core in dependency order; the C ABI accepts scalar dimensions and a caller-owned byte span, never a C++ or VapourSynth pointer.

The linked Rust artifact uses a separate opaque-handle ownership boundary:

```text
native/tests/render_invert.cpp
  ↕ safe no_std Core / Node / Frame API
crates/vapoursynth-core
  ↕ fixed-width slot + generation C ABI
native/browser_bridge.cpp
  ↕ VapourSynth C API
statically linked upstream core + selected std plugin code
```

The C++ bridge owns a generation-checked token table, the versioned `VSAPI` table, and all `VSCore`, `VSNode`, and `VSFrame` references. Rust owns non-`Send`, non-`Sync` typed tokens whose `Drop` calls the paired C++ release function. A node or frame lease retains the C++ core state, so an out-of-order raw C ABI release cannot call `freeCore` before upstream permits it.

The ownership layer uses a handwritten C ABI and `#[cfg(target_os = "emscripten")]`; it is not a `wasm-bindgen` boundary.

## Process model

### Main thread

Owns UI state, editor state, canvas presentation, and request coordination. It never executes filters and never synchronously waits for frame production.

### Python worker

Hosts the pinned Pyodide runtime and the deliberately supported asynchronous `vapoursynth` API subset. It creates a nested VapourSynth worker and communicates with it through the same correlated request protocol used by the main thread. Python values carry opaque worker handles, not frame buffers or native pointers. Each `.vpy` evaluation receives a fresh Python globals dictionary and a fresh graph state; selected outputs retain their graph until the next script or worker shutdown.

### VapourSynth worker

Owns the upstream core, plugin registry, all `VSNode`/`VSFrame` lifetimes, frame cache, and execution queue. It is the only component allowed to dereference VapourSynth pointers outside the Emscripten module.

### Runtime layout

The web side of the process model lives in `web/`: `web/app` (demo UI), `web/runtime` (worker and session runtimes), `web/protocol` (the correlated request protocol), `web/python` (the Pyodide-hosted Python API), and `web/tests` (web test suites).

## Browser-build constraints

The upstream patch set makes these explicit:

- only a statically registered subset of the standard plugin is present;
- dynamic library loading and automatic plugin discovery are rejected;
- the scheduler is synchronous and single-threaded in this build;
- `getFrameAsync` is not browser-asynchronous behaviour in this build;
- `std.Resize` is intentionally omitted, so `zimg` is not part of this build.

Frame transport hands an RGBA8 `ArrayBuffer` to the caller on the `postMessage` transfer list, so buffer ownership moves without a copy. Long-term paths should favour `VideoFrame` and WebCodecs rather than round-tripping pixels through Python.

## Boundary rules

- The ownership ABI exposes only fixed-width scalars, paired slot/generation values, and a transient caller-owned byte span.
- `vapoursynth-sys` declares only the C++ bridge ABI; raw VapourSynth layouts remain private to C++.
- Safe Rust wrappers own every bridge-token release and convert upstream statuses immediately.
- JavaScript sees integers, structured errors, and transferable buffers—not pointers.
- Token slots are generation-checked before reuse and retired permanently if their generation would wrap.
- Worker shutdown releases retained resources deterministically.
- Python finalizers may request release, but correctness cannot depend on prompt garbage collection.
- The Python module exposes only `RGB24`, `core.std.BlankClip`, `core.std.Invert`, `VideoNode`, and `set_output()`; any other API path fails explicitly. All calls are awaitable because they cross the worker boundary.

## Plugin model

Native desktop plugin binaries are not portable. Supported plugins must be rebuilt from source against the browser toolchain and audited for operating-system APIs, filesystem assumptions, thread-local state, SIMD/inline assembly, dynamic libraries, and callbacks crossing worker or Wasm boundaries. Static registration is the baseline; dynamic Wasm plugins are not supported and are separate future work.

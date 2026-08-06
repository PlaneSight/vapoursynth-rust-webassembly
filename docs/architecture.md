# Architecture

## Objective

Run the upstream VapourSynth core in a browser worker while retaining genuine node, frame, plugin invocation, and scheduling semantics wherever the browser permits them. C++ owns upstream resources; Rust validates opaque tokens and typed invocations without replacing upstream VapourSynth.

## Build boundaries

The control path is one Emscripten C++ module:

```text
caller-owned RGBA8 memory
  ↕ narrow C ABI
native/browser_bridge.cpp
  ↕ VapourSynth C API
statically linked upstream core + selected std plugin code
```

Only the bridge owns raw VapourSynth pointers. Its C++ leases release maps, nodes, frames, and the core in dependency order; the C ABI accepts fixed-width scalars and caller-owned byte spans, never a C++ or VapourSynth pointer.

The linked Rust artifact uses the same opaque-handle boundary:

```text
native/tests/render_invert_rust.cpp
  ↕ no_std typed invocation and token API
crates/vapoursynth-core
  ↕ fixed-width slot + generation C ABI
native/browser_bridge.cpp
  ↕ VapourSynth C API
statically linked upstream core + selected std plugin code
```

The C++ bridge owns a generation-checked token table, the versioned `VSAPI` table, and all `VSCore`, `VSNode`, and `VSFrame` references. Rust carries copyable, non-zero slot/generation token values and validates every descriptor before forwarding a synchronous call. Node and frame leases in C++ retain the core state, so an out-of-order ABI release cannot call `freeCore` before upstream permits it.

The validation layer uses a handwritten C ABI and `#[cfg(target_os = "emscripten")]`; it is not a `wasm-bindgen` boundary.

## Process model

### Main thread

Owns UI state, editor state, canvas presentation, and request coordination. It never executes filters and never synchronously waits for frame production.

### Python worker

Hosts the pinned Pyodide runtime and the deliberately supported synchronous `vapoursynth` API subset. It creates a nested VapourSynth worker and communicates with it through the same correlated request protocol used by the main thread: Python calls record typed operations into a graph plan, the plan drains as JSON, and the VapourSynth worker executes it with one generic invocation per operation. Python values carry plan-local operation references, never frame buffers or native pointers. Each `.vpy` evaluation receives a fresh Python globals dictionary and a fresh graph state; selected outputs retain their graph until the next script or worker shutdown.

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

- The opaque-token ABI exposes only fixed-width scalars, paired slot/generation values, and transient caller-owned byte spans.
- `vapoursynth-sys` declares only the C++ bridge ABI; raw VapourSynth layouts remain private to C++.
- Safe Rust code validates bridge tokens and invocation descriptors and converts upstream statuses immediately; C++ owns every resource release.
- JavaScript sees integers, structured errors, and transferable buffers—not pointers.
- Token slots are generation-checked before reuse and retired permanently if their generation would wrap.
- Worker shutdown releases retained resources deterministically.
- Python finalizers may request release, but correctness cannot depend on prompt garbage collection.
- The Python module exposes `RGB24`, `VideoNode`, `set_output()`, and generic `core.std` graph recording for the supported argument kinds. Authoring calls are synchronous; only the drained graph crosses the worker protocol. Unsupported API paths fail explicitly.

## Plugin model

Native desktop plugin binaries are not portable. Supported plugins must be rebuilt from source against the browser toolchain and audited for operating-system APIs, filesystem assumptions, thread-local state, SIMD/inline assembly, dynamic libraries, and callbacks crossing worker or Wasm boundaries. Static registration is the baseline; dynamic Wasm plugins are not supported and are separate future work.

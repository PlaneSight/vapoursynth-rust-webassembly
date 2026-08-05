# Architecture

## Objective

Run the upstream VapourSynth core in a browser worker while retaining genuine node, frame, plugin invocation, and scheduling semantics wherever the browser permits them. Rust is the eventual ownership and browser-integration layer; it does not replace upstream VapourSynth in the compatibility backend.

## Present build boundaries

The verified control path is one Emscripten C++ module:

```text
caller-owned RGBA8 memory
  ↕ narrow C ABI
native/browser_bridge.cpp
  ↕ VapourSynth C API
statically linked upstream core + selected std plugin code
```

Only the bridge owns raw VapourSynth pointers today. RAII wrappers release maps, nodes, frames, and the core in dependency order; the C ABI accepts scalar dimensions and a caller-owned byte span, never a C++ or VapourSynth pointer.

The linked Rust artifact uses a separate opaque-handle ownership boundary:

```text
native/rust_smoke.cpp
  ↕ safe no_std Core / Node / Frame API
crates/vapoursynth-core
  ↕ fixed-width slot + generation C ABI
native/browser_bridge.cpp
  ↕ VapourSynth C API
statically linked upstream core + selected std plugin code
```

The C++ bridge owns a generation-checked token table, the versioned `VSAPI` table, and all `VSCore`, `VSNode`, and `VSFrame` references. Rust owns non-`Send`, non-`Sync` typed tokens whose `Drop` calls the paired C++ release function. A node or frame lease retains the C++ core state, so an out-of-order raw C ABI release cannot call `freeCore` before upstream permits it.

The `wasm-bindgen` scaffold stays on `wasm32-unknown-unknown` and is a distinct module. It cannot be used in the Emscripten artifact: [`wasm-bindgen` does not support `wasm32-unknown-emscripten`](https://rustwasm.github.io/docs/wasm-bindgen/reference/rust-targets.html). This ownership layer uses a handwritten C ABI and `#[cfg(target_os = "emscripten")]`, not `wasm-bindgen`.

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

- The ownership ABI exposes only fixed-width scalars, paired slot/generation values, and a transient caller-owned byte span.
- `vapoursynth-sys` declares only the C++ bridge ABI; raw VapourSynth layouts remain private to C++.
- Safe Rust wrappers own every bridge-token release and convert upstream statuses immediately.
- JavaScript sees integers, structured errors, and transferable buffers—not pointers.
- Token slots are generation-checked before reuse and retired permanently if their generation would wrap.
- Worker shutdown releases retained resources deterministically.
- Python finalizers may request release, but correctness cannot depend on prompt garbage collection.

## Plugin model

Native desktop plugin binaries are not portable. Supported plugins must be rebuilt from source against the browser toolchain and audited for operating-system APIs, filesystem assumptions, thread-local state, SIMD/inline assembly, dynamic libraries, and callbacks crossing worker or Wasm boundaries. Static registration is the baseline; dynamic Wasm plugins are a separate research milestone.

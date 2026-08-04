# Implementation Plan

## Milestone 0 — Reproducible scaffold

**Goal:** establish ownership boundaries and a buildable Rust workspace without claiming upstream execution.

Exit criteria:

- Host-side Rust tests pass.
- WASM host exports a status function.
- CI checks formatting, Clippy, tests and `wasm32-unknown-unknown` compilation.
- Documentation labels all placeholders accurately.

## Milestone 1 — Real core, one generated frame

**Goal:** compile upstream `libvapoursynth` and the required core plugin into one Emscripten module.

Deliverable:

```text
BlankClip(640×360, RGB/RGBA, length=1)
→ request frame 0
→ copy/transfer bytes
→ render on canvas
```

Work:

1. Pin an upstream VapourSynth commit.
2. Inventory source files and generated build inputs.
3. Add a browser platform configuration with unsupported facilities disabled explicitly.
4. Produce a static library or linkable Emscripten object.
5. Generate bindings from the exact public headers.
6. Implement `Core`, `Node` and `Frame` RAII wrappers.
7. Register the required standard plugin statically.
8. Add a browser worker and a deterministic integration test.

Exit criteria:

- Frame bytes originate from an upstream `VSFrame`, not a Rust imitation.
- Address/undefined-behaviour sanitizers pass for the equivalent native harness.
- The browser demo renders the expected frame.
- Build instructions work from a clean checkout.

## Milestone 2 — Invocation and graph semantics

Implement typed argument maps and plugin/function lookup sufficient for `std.BlankClip`, `std.Invert` and one resize operation. Add conformance tests against native VapourSynth outputs.

Exit criteria:

- Opaque nodes cross the JS/Python boundaries only as handles.
- Reference counts survive chaining, replacement and explicit release.
- Error messages preserve upstream context.

## Milestone 3 — Pyodide `.vpy` authoring

Provide a Python 3.14 package exposing `vs.core`, `VideoNode`, format constants, function namespaces and `set_output()` through asynchronous RPC.

Exit criteria:

- A documented `.vpy` subset runs unchanged.
- Unsupported APIs fail immediately with specific errors.
- Python never receives raw frame memory unless explicitly requested.

## Milestone 4 — Real video path

Add WebCodecs input/output adapters, timeline metadata, multiple frames, cancellation and transferable-buffer transport.

## Milestone 5 — Scheduling and threads

First measure the single-worker scheduler. Then add an opt-in threaded build using cross-origin isolation and `SharedArrayBuffer`. Maintain a single-thread fallback.

## Milestone 6 — Portable plugin program

Port plugins individually from source. Track build status, patches, conformance and performance per plugin. Investigate Emscripten side modules only after static linking is reliable.

## Required investigation records

Every spike must record:

- upstream commit
- compiler/toolchain versions
- exact configure/build flags
- upstream patches
- browser security headers
- tests and observed failures
- whether behaviour is upstream, emulated or unsupported

## Explicit deferrals

- arbitrary native plugin binaries
- filesystem-based plugin discovery
- full desktop Python environment
- synchronous main-thread APIs
- performance claims without benchmarks

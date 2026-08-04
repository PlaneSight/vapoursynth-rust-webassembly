# Implementation Plan

## Milestone 0 — Reproducible scaffold

**Status:** complete as a Rust-only scaffold.

The workspace has ownership-boundary placeholders, host tests, and a `wasm32-unknown-unknown` status module. It does not claim upstream execution.

## Milestone 1a — Headless upstream Emscripten spike

**Status:** source integration present; CI is the verification authority.

**Goal:** prove one upstream `VSFrame` can reach caller-owned RGBA8 memory without dynamic plugins or native threads.

Deliverable:

```text
BlankClip(37×19, RGB24, length=1)
→ std.Invert
→ request frame 0
→ planar RGB to RGBA8 copy
→ deterministic Node smoke test
```

Completed design work:

1. Pin upstream VapourSynth and Emscripten versions.
2. Track the submodule, lock record, notices, and an idempotent patch tool.
3. Compile only the core sources required for the `BlankClip`/`Invert` path.
4. Register the selected `std` functionality statically.
5. Reject dynamic loading and auto-discovery in the browser build.
6. Run this narrow path through a synchronous one-thread scheduler.
7. Exercise a real `VSFrame` through a C ABI smoke executable.

Exit criteria:

- The browser-spike CI job passes from a clean checkout.
- A fresh checkout applies the patch without manual edits.
- The smoke output is derived from the upstream frame, not a Rust or JavaScript imitation.

## Milestone 1b — Browser worker and Rust bridge

Move the linked Rust host to the Emscripten target, generate bindings from the pinned public headers, and make `Core`, `Node`, and `Frame` wrappers own upstream references in the same module. Add a dedicated worker, transferable frame buffers, a minimal canvas presentation, and an explicit request protocol.

Exit criteria:

- Browser code calls the real native bridge through one well-defined module boundary.
- Rust and C++ share compatible Emscripten ABI settings.
- Pointer ownership cannot cross JavaScript/Python/worker boundaries.
- The browser demo renders the verified frame.

## Milestone 2 — Invocation and graph semantics

Implement typed argument maps and plugin/function lookup sufficient for `std.BlankClip`, `std.Invert`, and one resize operation. Add differential conformance tests against pinned native VapourSynth outputs.

## Milestone 3 — Pyodide `.vpy` authoring

Provide a Python package exposing `vs.core`, `VideoNode`, format constants, function namespaces, and `set_output()` through asynchronous RPC. Unsupported APIs fail immediately with specific errors.

## Milestone 4 — Real video path

Add WebCodecs input/output adapters, timeline metadata, multiple frames, cancellation, and transferable-buffer transport.

## Milestone 5 — Scheduling and threads

Measure the single-worker scheduler first. Then add an opt-in threaded build guarded by cross-origin isolation and `SharedArrayBuffer`, while retaining a single-thread fallback.

## Milestone 6 — Portable plugin program

Port plugins individually from source. Track build status, patches, conformance, and performance per plugin. Investigate Emscripten side modules only after static linking is reliable.

## Required investigation records

Every spike records its upstream commit, compiler/toolchain versions, build flags, patches, browser security headers, tests and observed failures, and whether behaviour is upstream, emulated, or unsupported.

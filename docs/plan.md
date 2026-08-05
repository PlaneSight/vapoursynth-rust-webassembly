# Implementation Plan

## Milestone 0 — Reproducible scaffold

**Status:** complete as a Rust-only scaffold.

The workspace has ownership-boundary placeholders, host tests, and a `wasm32-unknown-unknown` status module. It does not claim upstream execution.

## Milestone 1a — Headless upstream Emscripten spike

**Status:** verified by the `browser-spike` CI job on 2026-08-04.

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

## Milestone 1b.0 — Emscripten Rust ABI probe

**Status:** verified by the `browser-spike` CI job on 2026-08-05.

Build one no-`std`, `panic=abort` Rust static library for `wasm32-unknown-emscripten`, then have the final `em++` link combine it with the existing C++ bridge and upstream core. A separate C++ smoke executable must call Rust, which calls the existing bridge, and must verify the same exact RGBA result and boundary errors as the direct C++ control.

Exit criteria:

- The Rust archive links into the same Emscripten executable as the C++ bridge.
- The direct C++ control and the C++ → Rust → C++ smoke both pass under Node.
- The non-unwinding C ABI uses only fixed-width scalars plus a temporary caller-owned byte span.
- The old `wasm-bindgen` scaffold remains visibly separate and makes no linked claim.

## Milestone 1b.1 — Safe upstream ownership layer

**Status:** source candidate; this change requires the next browser-spike pass.

Replace the probe with an opaque C++ handle ABI and safe Rust `Core`, `Node`, and `Frame` wrappers. C++ retains ownership of the versioned `VSAPI` table; Rust owns only generation-checked bridge tokens with matching drops. Do not expose a raw `VSCore *`, `VSNode *`, `VSFrame *`, map, callback, or error-string pointer across the language boundary.

Exit criteria:

- A direct C++ smoke proves stale, wrong-kind, double-release, and parent-before-child release handling.
- A Rust smoke builds the safe `Core → BlankClip → Invert → Frame → RGBA8` path twice in one Emscripten module.
- Token reuse rejects the old generation, and token generation wrap retires a slot instead of reusing it.
- No safe Rust ownership type is `Send` or `Sync`; the worker remains the sole owner of the module.

## Milestone 1c — Browser worker and canvas

Add a dedicated worker, transferable frame buffers, minimal canvas presentation, and an explicit request protocol. The worker is the only JavaScript-facing owner of the Emscripten module; messages contain request identifiers, data, and structured errors rather than native pointers.

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

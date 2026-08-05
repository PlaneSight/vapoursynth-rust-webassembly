# Roadmap

The foundational work — upstream core build, safe Rust ownership layer, and browser worker — is complete and exercised by the `browser-integration` CI job. The remaining work, in suggested order:

## 1. Generic invocation

Implement typed argument maps and plugin/function lookup sufficient for `std.BlankClip`, `std.Invert`, and one resize operation.

Use the public domain model of `vapoursynth4-rs` and `rust-av/vapoursynth-rs` as comparative prior art for owned and borrowed resources, maps, plugins, functions, nodes, frames, formats, and VSScript behavior. Do not inherit their native-linking assumptions: browser Rust retains opaque tokens only, while C++ owns all upstream pointers and the `VSAPI` table.

## 2. Native conformance harness

Add differential conformance tests against pinned native VapourSynth outputs. The harness compares output and failure behaviour against a pinned native VapourSynth build and is the basis for every future `Conformant` claim.

## 3. Complete browser Python path

The checked-in Python package, two-worker protocol, and real-Pyodide integration test prove the authoring boundary; a full browser/Emscripten end-to-end run remains before the path is verified.

The package exposes `vs.core`, `VideoNode`, format constants, function namespaces, and `set_output()` through asynchronous RPC. Unsupported APIs fail immediately with specific errors.

## 4. Multi-frame / WebCodecs

Add WebCodecs input/output adapters, timeline metadata, multiple frames, and transferable-buffer transport.

## 5. Cancellation and resource limits

Add cancellation of in-flight work and explicit limits on resource use (sessions, outstanding requests, memory) so a misbehaving script cannot exhaust the worker.

## 6. Optional threaded runtime

Measure the single-worker scheduler first. Then add an opt-in threaded build guarded by cross-origin isolation and `SharedArrayBuffer`, while retaining a single-thread fallback.

## 7. Plugin porting framework

Port plugins individually from source. Track build status, patches, conformance, and performance per plugin. Investigate Emscripten side modules only after static linking is reliable.

## Investigation records

Every investigation record includes its upstream commit, compiler/toolchain versions, build flags, patches, browser security headers, tests and observed failures, and whether behaviour is upstream, emulated, or unsupported.

# Roadmap

The foundational work — upstream core build, safe Rust ownership layer, browser worker, generic typed invocation, the native-VS oracle, and the common-filter corpus — is complete and exercised by the `browser-integration` CI job. The remaining work, in suggested order:

## 1. Generic invocation — done

Typed argument descriptors, plugin/function lookup, and graph plans are implemented: any registered `std` function can be invoked generically through `vs_browser_core_invoke`, and the 17-filter corpus in `docs/support.md` proves byte-exact RGB24 output through the full browser path. Use the public domain model of `vapoursynth4-rs` and `rust-av/vapoursynth-rs` as comparative prior art for owned and borrowed resources, maps, plugins, functions, nodes, frames, formats, and VSScript behavior. Do not inherit their native-linking assumptions: browser Rust retains opaque tokens only, while C++ owns all upstream pointers and the `VSAPI` table.

## 2. Native-VS conformance harness — done

`tools/build-native-conformance.sh` builds the exact VapourSynth commit in `third_party/lock.toml` with the upstream standard plugin and scalar Meson options, then `native/tests/generate_corpus.py --check` verifies the checked-in frame bytes, dimensions, hashes, and two normalized invocation failures. The browser Playwright corpus consumes the same manifest and compares success metadata/bytes plus stable failure codes and messages. Refresh is explicit and atomic; ordinary verification never rewrites fixtures. This proves only the listed RGB24 `std` cases; it does not claim general plugin, scheduler, format, or WebCodecs compatibility.

## 3. Complete browser Python path — done

The synchronous Python package, two-worker protocol, real-Pyodide integration test, and the Playwright corpus prove the authoring boundary end to end in the production bundle: Pyodide records a graph plan, the VapourSynth worker executes it with one generic invocation per operation, and frames render byte-exact to the canvas.

The package exposes `vs.core`, `VideoNode`, format constants, function namespaces, and `set_output()`; unsupported APIs fail immediately with specific errors.

## 4. Multi-frame / WebCodecs

Add WebCodecs input/output adapters, timeline metadata, multiple frames, and transferable-buffer transport. The generation-checked multi-frame render path already exists (`render_output(index, frame)`).

## 5. Cancellation and resource limits — done

Cancellation and explicit limits are implemented and tested: worker-side 256 ops / 64 outputs, authoring-side 64 ops / 64 args / 4096 array values / 16 outputs / 64 KiB plan data, `script-timeout` / `plan-limit` error codes, and full lease release on reset, failure, and shutdown.

## 6. Optional threaded runtime

Measure the single-worker scheduler first. Then add an opt-in threaded build guarded by cross-origin isolation and `SharedArrayBuffer`, while retaining a single-thread fallback.

## 7. Plugin porting framework

Port plugins individually from source. Track build status, patches, conformance, and performance per plugin. Investigate Emscripten side modules only after static linking is reliable.

## Investigation records

Every investigation record includes its upstream commit, compiler/toolchain versions, build flags, patches, browser security headers, tests and observed failures, and whether behaviour is upstream, emulated, or unsupported.

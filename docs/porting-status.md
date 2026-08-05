# Porting Status

This document is the source of truth for support claims.

| Area | Status | Evidence |
|---|---|---|
| Rust workspace | Scaffolded | Host crates and tests are checked in. |
| Raw VapourSynth ABI | Deliberately private | C++ owns the versioned `VSAPI` table and every raw upstream pointer. |
| Upstream core build | Linked | The Emscripten browser-spike job passed the direct Node smoke in [run 83953783328](https://github.com/PlaneSight/vapoursynth-rust-webassembly/actions/runs/83953783328). |
| Standard plugin | Limited linked | Static `std` registration contains the code required for `BlankClip` and `Invert`, not the full plugin set. |
| `BlankClip → Invert → RGBA` | Linked | `native/smoke.cpp` checks every pixel derived from an upstream `VSFrame` in the passing browser-spike job. |
| Rust ↔ C++ ABI probe | Linked | The browser-spike CI job verified the no-`std` Rust static library in the same Emscripten module. |
| Browser worker/canvas | Linked | The browser-spike job builds the worker-owned Emscripten ES module; focused Node tests cover request correlation, transferable frames, failure translation, and shutdown. |
| Rust-to-upstream ownership FFI | Linked | The browser-spike job exercises the typed generation-checked Rust `Core → Node → Frame` path through the C++ bridge. |
| Pyodide `.vpy` API | Build candidate | A pinned Pyodide 0.29.4 worker installs the checked-in `vapoursynth` package, and its real-interpreter Node test executes `BlankClip → Invert → set_output` through async RPC. A full browser/Emscripten end-to-end run is still required. |
| Native plugin binaries | Unsupported | They must be rebuilt from source. |
| Dynamic plugin discovery | Unsupported | The browser patch explicitly rejects it. |
| `std.Resize` / zimg | Deferred | Not in the initial source closure. |
| Threaded scheduler | Deferred | The initial path is deliberately synchronous and single-threaded. |
| WebCodecs | Planned | Milestone 4. |
| Conformance suite | Planned | Begins with native differential tests after the build spike. |

## Claim vocabulary

- **Scaffolded:** interfaces or ownership boundaries exist, but no upstream execution occurs.
- **Build candidate:** sources, pins, and an automated test are present, but the current commit has not yet earned a successful build result.
- **Linked:** upstream symbols are present and exercised by a passing automated test.
- **Conformant:** output and failure behaviour are compared against a pinned native VapourSynth build.
- **Portable:** works in supported browsers from a clean, documented build.
- **Unsupported:** deliberately rejected with a stable error; never silently approximated.

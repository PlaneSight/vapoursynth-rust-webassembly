# Support

This document is the source of truth for support claims. Evidence refers to the `browser-integration` CI job and to `native/tests/render_invert.cpp`, the deterministic upstream-render test.

| Area | Status | Evidence |
|---|---|---|
| Raw VapourSynth ABI | Deliberately private | C++ owns the versioned `VSAPI` table and every raw upstream pointer. |
| Upstream core build | Linked | The `browser-integration` job builds and passes the direct Node smoke from `native/tests/render_invert.cpp`. |
| Standard plugin | Limited linked | Static `std` registration contains the code required for `BlankClip` and `Invert`, not the full plugin set. |
| `BlankClip → Invert → RGBA` | Linked | `native/tests/render_invert.cpp` checks every pixel derived from an upstream `VSFrame`. |
| Rust-to-upstream ownership FFI | Linked | The `browser-integration` job exercises the generation-checked Rust `Core → Node → Frame` path through the C++ bridge. |
| Browser worker/canvas | Linked | The `browser-integration` job builds the worker-owned Emscripten ES module; tests under `web/tests/protocol/` and `web/tests/runtime/` cover request correlation, transferable frames, Emscripten memory ownership, failure translation, and shutdown. |
| Pyodide `.vpy` API | Build candidate | A pinned Pyodide worker installs the checked-in `vapoursynth` package, and the real-interpreter test under `web/tests/integration/` executes `BlankClip → Invert → set_output` through async RPC. A full browser/Emscripten end-to-end run is still required. |
| Native plugin binaries | Unsupported | They must be rebuilt from source. |
| Dynamic plugin discovery | Unsupported | The browser patch explicitly rejects it. |
| `std.Resize` / zimg | Deferred | Not in the initial source closure. |
| Threaded scheduler | Deferred | The current path is deliberately synchronous and single-threaded. |
| WebCodecs | Planned | Roadmap item 4. |
| Conformance suite | Planned | Roadmap item 2. |

## Claim vocabulary

- **Scaffolded:** interfaces or ownership boundaries exist, but no upstream execution occurs.
- **Build candidate:** sources, pins, and an automated test are present, but the current commit has not yet earned a successful build result.
- **Linked:** upstream symbols are present and exercised by a passing automated test.
- **Conformant:** output and failure behaviour are compared against a pinned native VapourSynth build.
- **Portable:** works in supported browsers from a clean, documented build.
- **Unsupported:** deliberately rejected with a stable error; never silently approximated.

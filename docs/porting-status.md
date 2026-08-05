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
| Browser worker/canvas | Planned | Milestone 1c. |
| Rust-to-upstream ownership FFI | Build candidate | Milestone 1b.1 adds typed generation-checked bridge tokens instead of raw upstream pointers. |
| Pyodide API | Planned | Milestone 3. |
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

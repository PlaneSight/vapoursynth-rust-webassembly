# Porting Status

This document is the source of truth for support claims.

| Area | Status | Evidence |
|---|---|---|
| Rust workspace | Scaffolded | Host crates and tests are checked in. |
| Raw VapourSynth ABI | Placeholder | Opaque Rust markers only; generated bindings are deferred to Milestone 1b. |
| Upstream core build | Build candidate | Pinned sources, Emscripten Meson build, and a Node smoke test are checked in; browser-spike CI verifies the claim. |
| Standard plugin | Limited build candidate | Static `std` registration contains the code required for `BlankClip` and `Invert`, not the full plugin set. |
| `BlankClip → Invert → RGBA` | Build candidate | `native/smoke.cpp` checks every pixel derived from an upstream `VSFrame`. |
| Browser worker/canvas | Planned | Milestone 1b. |
| Rust-to-upstream FFI | Planned | Requires a unified Emscripten module. |
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

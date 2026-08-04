# Porting Status

This document is the source of truth for support claims.

| Area | Status | Evidence |
|---|---|---|
| Rust workspace | Scaffolded | Host crates and tests checked in |
| Raw VapourSynth ABI | Placeholder only | Opaque marker types; no generated bindings |
| Upstream core linked | No | WASM host reports `upstreamLinked: false` |
| Standard plugin | No | Static registration not implemented |
| Frame requests | No | `render_blank_frame` returns an explicit unsupported error |
| Browser worker | Planned | Milestone 1 |
| Pyodide API | Planned | Milestone 3 |
| Native plugin binaries | Unsupported | Must be rebuilt from source |
| WASM plugin side modules | Research | Deferred until static linking works |
| Threaded scheduler | Planned | Single-thread worker first |
| WebCodecs | Planned | Milestone 4 |
| Conformance suite | Planned | Begins with BlankClip/Invert |

## Claim vocabulary

- **Scaffolded:** interfaces and ownership boundaries exist, but no upstream execution occurs.
- **Linked:** upstream symbols are present and exercised by an automated test.
- **Conformant:** output and failure behaviour are compared against a pinned native VapourSynth build.
- **Portable:** works in supported browsers from a clean documented build.
- **Unsupported:** deliberately rejected with a stable error; not silently approximated.

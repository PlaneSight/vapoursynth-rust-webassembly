# Support

This document is the source of truth for support claims. Evidence refers to the `browser-integration` CI job, the native suites under `native/tests/`, and the Playwright corpus in `web/tests/browser/`.

| Area | Status | Evidence |
|---|---|---|
| Raw VapourSynth ABI | Deliberately private | C++ owns the versioned `VSAPI` table and every raw upstream pointer. |
| Upstream core build | Linked | The `browser-integration` job builds the pinned upstream core (R79RC1) and runs the native, Rust, and corpus suites against it. |
| Standard plugin | Linked (17 common filters) | The static `std` registration exposes the generic filters (Invert, Levels, Median, Minimum, Maximum), the expression evaluator (Expr, scalar-interpreter fallback on wasm), the lookup tables (Lut, Lut2, Lut3), and the simple filters (BlankClip, Crop, AddBorders, flips, turns, Transpose, stacks, ShufflePlanes). See the corpus table below. |
| Python authoring (`.vpy`) | Linked | The synchronous `vapoursynth` package records typed graph plans; the real-Pyodide integration test and the Playwright corpus drive the full Pyodide → RPC → Emscripten → canvas path in the production bundle. |
| Rust-to-upstream validation FFI | Linked | Generation-checked `Core → Node → Frame` token values and typed invocation descriptors cross the C++ bridge; C++ owns all upstream references and releases. Stale, bad-kind, null, and malformed descriptor probes run in the native suites. |
| Browser worker/canvas | Linked | `web/tests/protocol/` and `web/tests/runtime/` cover request correlation, transferable frames, Emscripten memory ownership, failure translation, limits, and shutdown; `web/tests/browser/` runs 17 corpus vectors byte-exact on canvas. |
| Native plugin binaries | Unsupported | They must be rebuilt from source. |
| Dynamic plugin discovery | Unsupported | The browser patch explicitly rejects it. |
| `std.Resize` / zimg | Deferred | Not in the linked source closure. |
| Threaded scheduler | Deferred | The current path is deliberately synchronous and single-threaded. |
| WebCodecs | Planned | Roadmap item 4. |
| Native-VS differential conformance | Planned | Roadmap item 2; the current corpus harness is byte-exact against hand-derived goldens from upstream source semantics. |

## Common filter corpus

The corpus is the finite set of RGB24-deterministic standard filters the browser runtime claims. Each vector lives once in `native/tests/vectors/` (plan + golden RGBA8); the native `render_plan` harness and Playwright consume the same files. `native/tests/generate_corpus.py` regenerates them from hand-derived semantics. Every vector must render byte-exact in both paths, or the claim reverts.

All 17 families currently pass both gates — a strict majority of the corpus is proven working end to end in the browser.

| # | Family | Vector | Golden derivation |
|---|---|---|---|
| 1 | `BlankClip` | `blankclip-color` | flat color fill `[r,g,b,255]` |
| 2 | `Invert` | `invert-color` | `255 − channel` per plane |
| 3 | `Crop` | `crop-color` | inner rectangle of the source |
| 4 | `AddBorders` | `addborders-asym` | asymmetric black margins (7/3/5/9) |
| 5 | `FlipHorizontal` | `fliph-asym` | mirrored asymmetric margins |
| 6 | `FlipVertical` | `flipv-asym` | mirrored asymmetric margins |
| 7 | `Turn180` | `turn180-asym` | both flips |
| 8 | `Transpose` | `transpose-asym` | 330×194 → 194×330 reoriented margins |
| 9 | `StackHorizontal` | `stackh-two` | two flat clips side by side |
| 10 | `StackVertical` | `stackv-two` | two flat clips stacked |
| 11 | `Lut` | `lut-invert` | per-plane table `lut[i] = 255 − i` |
| 12 | `Expr` | `expr-add96` | saturating uint8 add `x 96 +` (scalar interpreter) |
| 13 | `Levels` | `levels-16-235` | `u8(clamp(pow((v−0)/(255−0), 1)·(235−16)+16, 0, 255) + 0.5)` |
| 14 | `Median` | `median-flat` | identity on a flat frame |
| 15 | `Minimum` | `minimum-flat` | identity on a flat frame |
| 16 | `Maximum` | `maximum-flat` | identity on a flat frame |
| 17 | `ShufflePlanes` | `shuffleplanes-rgb` | plane passthrough with `colorfamily=RGB` |

## Claim vocabulary

- **Scaffolded:** interfaces or ownership boundaries exist, but no upstream execution occurs.
- **Build candidate:** sources, pins, and an automated test are present, but the current commit has not yet earned a successful build result.
- **Linked:** upstream symbols are present and exercised by a passing automated test.
- **Conformant:** output and failure behaviour are compared against a pinned native VapourSynth build.
- **Portable:** works in supported browsers from a clean, documented build.
- **Unsupported:** deliberately rejected with a stable error; never silently approximated.

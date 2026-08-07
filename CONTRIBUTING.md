# Contributing

This project keeps its browser contract deliberately narrow: real upstream VapourSynth execution, explicit unsupported states, and reproducible builds. Small, tested changes are preferred.

## Prerequisites

- Git, with submodule support.
- Rust 1.85.0, pinned in `rust-toolchain.toml`; rustup installs it along with the `rustfmt` and `clippy` components and the `wasm32-unknown-emscripten` target.
- Node.js with npm, for the web tests and the demo.
- [uv](https://docs.astral.sh/uv/), which provisions Python and Meson. UV manages Python and Meson, not Cargo or Node; Cargo and npm use their own toolchains and lockfiles.

## Setup

```bash
git submodule update --init --recursive
uv sync --locked
npm ci
```

## Canonical commands

Run these exactly; they are the baseline CI enforces:

| Purpose | Command |
| --- | --- |
| Sync Python tooling and Meson | `uv sync --locked` |
| Rust workspace tests | `cargo test --workspace --locked` |
| Install npm dependencies | `npm ci` |
| Web runtime and protocol tests | `npm test` |
| Python binding tests | `uv run --locked python -m unittest discover -s web/python -p 'test_*.py'` |
| Full browser build | `./tools/build-browser.sh` |
| Host-native conformance check (read-only) | `./tools/build-native-conformance.sh` |

CI also runs `cargo fmt --all --check` and `cargo clippy --locked --workspace --all-targets -- -D warnings`; run both locally before requesting review. The `browser-integration` job is the stable evidence for the selected conformance cases: it checks the host-native oracle first, then the Emscripten/Node browser build and Playwright suite. CI uses the read-only check and never refreshes checked-in vectors.

## Generated files

`build/` is generated output: it is never hand-edited and never committed. The final generated locations are `build/emscripten/`, `build/web/`, and `build/test/`, regenerated with `./tools/build-browser.sh`. The checked-in `native/tests/vectors/` corpus is generated evidence, not a hand-maintained golden set; do not edit it directly.

Refreshing the conformance corpus is an explicit, opt-in developer action:

```bash
uv run --locked python native/tests/generate_corpus.py --runner build/native-conformance/vapoursynth-native-conformance --refresh
```

Ordinary `./tools/build-native-conformance.sh` checks compare the generated success bytes and frame metadata plus the two normalized upstream failure cases without modifying the checkout.

## Upstream patches

`vendor/vapoursynth/` is the repository-pinned upstream checkout; its commit is recorded in `third_party/lock.toml`. The host-native oracle builds that checkout and the adjacent `libvapoursynthfilters` without the browser patch, while `./tools/build-browser.sh` applies the locked browser-only patch temporarily. Neither path installs or discovers a system or unpinned VapourSynth.

To change upstream behavior:

1. Make the change against the pinned checkout in `vendor/vapoursynth/`.
2. Export it as a patch into `patches/vapoursynth/` with a descriptive, zero-padded name.
3. Record the patch in the `patches` list of `third_party/lock.toml`.
4. Verify a clean apply with `uv run --locked python tools/apply_upstream_patches.py`.

## Architecture boundaries

Runtime layout: `web/app` (demo), `web/runtime` (per-backend workers and sessions), `web/protocol` (worker message contracts), `web/python` (Python API), `web/tests` (Node test suites).

Preserve worker and ABI ownership boundaries. Raw upstream pointers must not cross Rust, JavaScript, Python, or worker interfaces: `crates/vapoursynth-sys` describes only the stable browser-bridge ABI (fixed-width statuses and opaque tokens), `crates/vapoursynth-core` owns the safe, thread-affine Rust layer over those tokens, the C++ bridge retains all upstream pointers, and `web/protocol` is the only crossing point for worker messages.

The host-native oracle uses VapourSynth's normal native scheduler. The Emscripten browser build is a separate, patched single-thread configuration; agreement for the checked-in cases does not establish scheduler, desktop, or all-plugin compatibility.

- Do not claim desktop VapourSynth compatibility without an executable test; the selected native corpus is not a whole-API or plugin guarantee.
- Each newly supported API requires a conformance test that exercises real upstream behavior; unsupported states must be explicit, never silent.
- Prefer a clear, minimal implementation over a speculative abstraction or unmeasured optimization.
- Retain the pinned `uv.lock`, `Cargo.lock`, and `package-lock.json` when changing their corresponding dependency graphs.

## License

By submitting a contribution, you agree to license it under the repository's [MIT License](LICENSE).

# Building

## Prerequisites

Install Git, Rust 1.85.0 (including `wasm32-unknown-emscripten`), Node/npm, UV 0.12.1+, Cython 3.2.9 through `uv sync --locked`, zimg 3.0.5+, and Emscripten 3.1.68. UV manages the pinned Python/Cython/Meson environment; Cargo and npm manage their own dependency graphs.

## Setup and checks

```bash
git submodule update --init --recursive
uv sync --locked
./tools/build-native-conformance.sh
uv run --locked python native/tests/generate_corpus.py --runner build/native-conformance/native/vapoursynth-native-conformance --check
cargo test --workspace --locked
npm ci
npm test
uv run --locked python -m unittest discover -s web/python -p 'test_*.py'
```

Before submitting a change, also run:

```bash
cargo fmt --all --check
cargo clippy --locked --workspace --all-targets -- -D warnings
uv lock --check
```

## Native conformance

The host oracle builds the locked, unpatched VapourSynth checkout and its real `std` plugin with scalar Meson options. It records no native patch; the browser build applies `patches/vapoursynth/0001-static-browser-runtime.patch` transiently. CI runs the oracle in read-only `--check` mode before the browser build. To intentionally regenerate the checked-in native expectations:

```bash
uv run --locked python native/tests/generate_corpus.py --runner build/native-conformance/native/vapoursynth-native-conformance --refresh
```

`build/native-vapoursynth/` and `build/native-conformance/` are generated build directories. The refresh command is the only command allowed to rewrite `native/tests/vectors/`; ordinary checks fail on stale provenance, bytes, dimensions, hashes, or failure envelopes.

## Browser distribution

Activate Emscripten 3.1.68 in the current shell, then run:

```bash
./tools/build-browser.sh
npm run serve
```

Open `http://localhost:4173/` — the root redirects to `/app/` (ES modules and nested module workers need an HTTP(S) origin, not `file://`). `npm run serve` runs `uv run --locked python -m http.server 4173 --directory build/web`. The build applies the locked upstream patch only while compiling, restores the submodule before exit, runs the Emscripten render-invert/plan/Rust/module tests, and stages the deployable site in `build/web/`.

Generated files belong only in `build/`: `build/emscripten/` holds Meson/Emscripten output, `build/native-*` holds the host oracle outputs, `build/web/` holds the browser distribution, and `build/test/` is reserved for test output. Do not hand-edit generated files.


## Browser tests

Run the production-browser Playwright round trip (spec: `web/tests/browser/app.spec.mjs`) against the distribution in `build/web`:

```bash
npm run test:browser        # requires an existing build/web
npm run test:browser:build  # ./tools/build-browser.sh, then the tests
```

`npm run test:browser` invokes `playwright test`; the Playwright config starts its own server (`python3 -m http.server 4173 --directory build`), runs headless Chromium, and writes the HTML report to `build/test/playwright-report/`. The suite mounts the distribution under `/web/app/` (not the origin root) so relative asset resolution matches the GitHub Pages project-site base path `/vapoursynth-rust-webassembly/` (see `.github/workflows/static.yml`).

## Isolated Docker builds

Docker Compose runs the same format, Rust, Node, Python, and Emscripten checks in a Linux container. The repository is mounted read-only; each run copies it into a container workspace, so the upstream patch cycle and generated files cannot modify the checkout.

Use the UV task interface:

```bash
uv run --locked python tools/workflow.py verify
```

The first run builds a pinned toolchain image; subsequent runs reuse container-owned Cargo, npm, and UV caches. To serve a freshly built browser distribution from the isolated workspace:

```bash
uv run --locked python tools/workflow.py demo
```

Open `http://localhost:4173/`. Stop the preview with `docker compose --profile demo down`. For an isolated interactive shell, run:

```bash
uv run --locked python tools/workflow.py shell
```

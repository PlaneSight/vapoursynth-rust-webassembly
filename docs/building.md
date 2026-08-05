# Building

## Prerequisites

Install Git, Rust 1.85.0 (including `wasm32-unknown-emscripten`), Node/npm, UV 0.12.1+, and Emscripten 3.1.68. UV manages the pinned Python and Meson environment; Cargo and npm manage their own dependency graphs.

## Setup and checks

```bash
git submodule update --init --recursive
uv sync --locked
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

## Browser distribution

Activate Emscripten 3.1.68 in the current shell, then run:

```bash
./tools/build-browser.sh
npm run serve
```

Open `http://localhost:4173/web/app/index.html`. The build applies the locked upstream patch only while compiling, restores the submodule before exit, runs the native render-invert and ES-module tests, and stages the deployable site in `build/web/`.

Generated files belong only in `build/`: `build/emscripten/` holds Meson/Emscripten output, `build/web/` holds the browser distribution, and `build/test/` is reserved for test output. Do not hand-edit generated files.

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

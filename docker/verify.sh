#!/usr/bin/env bash
set -euo pipefail

cargo fmt --all --check
cargo clippy --locked --workspace --all-targets -- -D warnings
cargo test --locked --workspace
uv lock --check
uv sync --locked
npm ci
npm test
uv run --locked python -m unittest discover -s web/python -p 'test_*.py'
source "$EMSDK/emsdk_env.sh"
./tools/build-browser.sh

#!/usr/bin/env bash
set -euo pipefail

source "$EMSDK/emsdk_env.sh"
./tools/build-browser.sh
exec uv run --locked python -m http.server 4173 --directory build/web

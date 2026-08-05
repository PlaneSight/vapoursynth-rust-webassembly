#!/usr/bin/env bash
set -euo pipefail

workspace="$(mktemp -d /tmp/vapoursynth.XXXXXX)"
cleanup() {
  rm -rf "$workspace"
}
trap cleanup EXIT

cp -a /source/. "$workspace/"
rm -rf "$workspace/build" "$workspace/.venv" "$workspace/node_modules"
cd "$workspace"
exec "$@"

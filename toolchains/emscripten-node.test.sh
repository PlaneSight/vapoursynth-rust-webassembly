#!/usr/bin/env bash
set -euo pipefail

wrapper="$(dirname "$0")/emscripten-node"
temp_dir="$(mktemp -d '.tmp.XXXXXX')"
trap 'rm -rf "$temp_dir"' EXIT

cat > "$temp_dir/sanity.exe" <<'EOF'
const { readFileSync, writeFileSync } = require('node:fs');
writeFileSync('result', readFileSync('asset.txt', 'utf8'));
EOF

printf 'ok' > "$temp_dir/asset.txt"
"$wrapper" "$temp_dir/sanity.exe"
test "$(<"$temp_dir/result")" = ok

#!/usr/bin/env bash
set -euo pipefail

wrapper="$(dirname "$0")/emscripten-node"
temp_dir="$(mktemp -d '.tmp.XXXXXX')"
trap 'rm -rf "$temp_dir"' EXIT

cat > "$temp_dir/sanity.exe" <<'EOF'
import { writeFileSync } from 'node:fs';
writeFileSync(process.argv[2], 'ok');
EOF

"$wrapper" "$temp_dir/sanity.exe" "$temp_dir/result"
test "$(<"$temp_dir/result")" = ok

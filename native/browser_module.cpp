// The browser module's public surface is exported from the linked Rust static
// library. This translation unit gives Meson an explicit C++ link target while
// --no-entry keeps the artifact worker-owned rather than executable-owned.

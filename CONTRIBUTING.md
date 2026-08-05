# Contributing

This project keeps its browser contract deliberately narrow: real upstream VapourSynth execution, explicit unsupported states, and reproducible builds. Small, tested changes are preferred.

## Before opening a pull request

1. Initialize the upstream submodule and synchronize the locked tool environment:

   ```bash
   git submodule update --init --recursive
   uv sync --locked
   uv run --locked bash -lc 'npm ci'
   ```

2. Run the focused checks affected by the change. Before requesting review, run the full baseline:

   ```bash
   uv run --locked node --test web/*.test.mjs
   uv run --locked python -m unittest discover -s web/python -p 'test_*.py'
   uv run --locked cargo fmt --all --check
   uv run --locked cargo test --locked --workspace
   uv run --locked cargo clippy --locked --workspace --all-targets -- -D warnings
   ```

3. Keep upstream changes isolated in `patches/vapoursynth/`; do not make unrecorded edits in `vendor/vapoursynth/`.
4. Describe the user-visible contract, test coverage, and any new toolchain requirement in the pull request.

## Design boundaries

- Do not claim desktop VapourSynth compatibility without an executable test.
- Preserve worker and ABI ownership boundaries. Raw upstream pointers must not cross Rust, JavaScript, Python, or worker interfaces.
- Prefer a clear, minimal implementation over a speculative abstraction or unmeasured optimization.
- Retain the pinned UV, Cargo, and npm lockfiles when changing their corresponding dependency graphs.

## License

By submitting a contribution, you agree to license it under the repository's [MIT License](LICENSE).

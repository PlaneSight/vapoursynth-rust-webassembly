## Summary

<!-- Describe the user-visible contract change; link the issue it closes. -->

## Verification

<!-- Check the commands run against the baseline in CONTRIBUTING.md. -->

- [ ] `cargo test --workspace --locked`
- [ ] `npm test`
- [ ] `uv run --locked python -m unittest discover -s web/python -p 'test_*.py'`
- [ ] `./tools/build-browser.sh`

## Conformance

<!-- Every newly supported API requires a conformance test. Name the test. -->

## Generated files

<!-- Confirm no build/ output is committed and nothing generated was hand-edited. -->

## Upstream patches

<!-- Disclose any additions to patches/vapoursynth/ or changes to third_party/lock.toml. -->

## Toolchain and lockfiles

<!-- Note any new Rust, Node, or Python requirement, and any uv.lock, Cargo.lock, or package-lock.json change. -->

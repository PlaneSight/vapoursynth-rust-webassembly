# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Video script authors who write and iterate VapourSynth graphs in a browser, inspecting visual output while they work.

## Product Purpose

VapourSynth WebAssembly makes a constrained, upstream-backed VapourSynth runtime available in the browser. A successful session lets an author create a graph, run it, inspect its output, and understand runtime failures without leaving the workspace.

## Positioning

The browser runtime executes the upstream VapourSynth core through Emscripten, with Rust ownership and C++ bridge boundaries. It is not a JavaScript filter-graph imitation.

## Operating Context

Authors work in a browser with a Python `.vpy` script, a worker-owned runtime, rendered RGBA output, and runtime diagnostics. The workspace will grow from a code-first script editor into a visual graph playground for clips, nodes, parameters, and output experiments.

## Capabilities and Constraints

The current supported Python subset includes `RGB24`, `core.std.BlankClip`, `core.std.Invert`, `VideoNode`, and `set_output()`. Graph operations are asynchronous across the Python and VapourSynth worker boundary. Unsupported capabilities must fail explicitly rather than emulate desktop behavior.

## Evidence on Hand

The repository contains a runnable browser demo at `web/app/index.html`, an upstream-backed Emscripten integration build, and native render-invert tests. No user research, brand assets, or production project data has been supplied.

## Product Principles

- Keep script authoring, visual feedback, and runtime state legible in one workspace.
- Make experimentation safe, immediate, and reversible.
- Preserve upstream-backed behavior and state constraints visibly.
- Let visual tooling grow without obscuring the author’s graph or output.
- Prefer explicit limitations to deceptive approximation.

## Accessibility & Inclusion

Keyboard-first operation and WCAG AA text contrast are mandatory. Visual order, DOM order, focus order, and status feedback must remain aligned across responsive layouts.

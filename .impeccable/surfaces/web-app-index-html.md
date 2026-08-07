---
version: 1
slug: "web-app-index-html"
primary_target: "web/app/index.html"
related_targets: ["web/app/demo.mjs"]
---

## Scope and mode

Operate-mode browser authoring workspace at `web/app/index.html` with behavior in `web/app/demo.mjs`.

## Audience and task

Video script authors browse the documented standard-core catalog, author or inspect a graph, run it, inspect program output, and understand runtime state.

## Constraints

Preserve upstream-backed rendering, explicit unsupported failures, keyboard-first behavior, WCAG AA text contrast, and truthful supported operations.

## Direction

Blueprint Graph: a graphite drafting-sheet authoring workspace with warm paper construction lines, amber graph routes, and orange-red output/error marks. The standard-core catalog is left, the plotted graph is central, the contextual inspector is right, and the Python source record anchors the bottom edge. Composition A at `.impeccable/mocks/blueprint-graph-canvas.png` was approved on 2026-08-07; the user replaced its blue palette with this graphite drafting treatment on 2026-08-07.

## Memorable moment

Searching the full standard-core catalog and selecting an entry turns it into a contextual node-inspector reference while the authored Python calls visibly plot as a route across the blueprint canvas.

## Interaction contract

- Nodes plot from the source record and are draggable (pointer drag or arrow-key nudge); layout persists for the session.
- Creating a node: "Add to graph" or dragging a library entry onto the canvas appends a runnable call for the 17 render-vector-validated functions (values match `native/tests/vectors`), or a `# Reference:` draft for every other video function. Drafts plot dashed and run only after the author replaces them with valid arguments.
- Delete removes the selected plotted node's call (or reference line); the program output node is not deletable.
- Wires are logic, not decoration: ports are crosshair handles, wires carry arrowheads and a traveling flow marker, and hovering a port highlights its wire. Dragging an out-port onto a node rewires the chain — the source call block moves to the line directly before the target's (a real script edit; Invert→AddBorders ≠ AddBorders→Invert). Dropping on the canvas appends the node as the final stage; dropping on the BlankClip slot makes it the first stage; an in-port drag onto a node makes that node feed it; the Output in-port sets the final stage; adjacent no-ops leave the source untouched.
- The preview goes stale visibly: any source edit after a render clears the canvas and marks the output "awaiting render" until the next Run. Width/height edits rewrite the BlankClip call in place and never wipe the rest of the script.
- The upstream core remains the authority for availability, valid arguments, and node kinds at run time.

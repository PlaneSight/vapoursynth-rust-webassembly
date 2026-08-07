import { drawRgbaFrame } from "../runtime/vapoursynth/client.mjs";
import { PyodideWorkerClient } from "../runtime/pyodide/client.mjs";

const CORE_LIBRARY = Object.freeze([
  { group: "Clip creation", kind: "video", names: ["BlankClip", "AddBorders", "AssumeFPS", "Loop", "Reverse", "Trim"] },
  { group: "Geometry & sequence", kind: "video", names: ["Crop", "CropAbs", "FlipHorizontal", "FlipVertical", "Resize", "Transpose", "Turn180", "StackHorizontal", "StackVertical", "Splice", "Interleave", "SelectEvery", "SeparateFields", "DoubleWeave", "DeleteFrames", "DuplicateFrames", "FreezeFrames"] },
  { group: "Expression & colour", kind: "video", names: ["Expr", "Invert", "InvertMask", "Levels", "Limiter", "Lut", "Lut2", "MakeDiff", "MakeFullDiff", "MergeDiff", "MergeFullDiff", "Premultiply", "ShufflePlanes", "SplitPlanes"] },
  { group: "Compositing", kind: "video", names: ["Merge", "MaskedMerge", "CopyFrameProps", "ClipToProp", "PropToClip"] },
  { group: "Analysis & morphology", kind: "video", names: ["AverageFrames", "Binarize", "BinarizeMask", "BoxBlur", "Convolution", "Deflate", "Inflate", "Maximum", "Median", "Minimum", "PEMVerifier", "PlaneStats", "Prewitt", "Sobel"] },
  { group: "Frame properties", kind: "video", names: ["FrameEval", "ModifyFrame", "RemoveFrameProps", "SetFieldBased", "SetFrameProp", "SetFrameProps", "SetVideoCache"] },
  { group: "Text overlays", kind: "video", names: ["ClipInfo", "CoreInfo", "FrameNum", "FrameProps", "Text"] },
  { group: "Core administration", kind: "general", names: ["LoadAllPlugins", "LoadPlugin", "LoadPluginAvisynth", "SetMaxCPU"] },
  { group: "Audio", kind: "audio", names: ["AssumeSampleRate", "AudioGain", "AudioLoop", "AudioMix", "AudioResample", "AudioReverse", "AudioSplice", "AudioTrim", "BlankAudio", "SetAudioCache", "ShuffleChannels", "SplitChannels"] },
]);

const VECTOR_VALIDATED_FUNCTIONS = new Set([
  "AddBorders", "BlankClip", "Crop", "Expr", "FlipHorizontal", "FlipVertical", "Invert", "Levels", "Lut", "Maximum", "Median", "Minimum", "ShufflePlanes", "StackHorizontal", "StackVertical", "Transpose", "Turn180",
]);

// Runnable call templates for the render-vector-validated subset, matching the
// corpus plans in native/tests/vectors byte for byte (same argument values,
// float lists kept floats, colorfamily as the RGB enum int). Anything outside
// this table plots as a reference draft until the author writes valid args.
const NODE_CALL_TEMPLATES = Object.freeze({
  BlankClip: ({ width, height }) => `clip = vs.core.std.BlankClip(width=${width}, height=${height}, format=vs.RGB24, color=[32.0, 96.0, 224.0])`,
  AddBorders: () => "clip = vs.core.std.AddBorders(clip, left=7, right=3, top=5, bottom=9, color=[0.0, 0.0, 0.0])",
  Crop: () => "clip = vs.core.std.Crop(clip, left=40, right=40, top=30, bottom=30)",
  Expr: () => 'clip = vs.core.std.Expr(clip, expr="x")',
  FlipHorizontal: () => "clip = vs.core.std.FlipHorizontal(clip)",
  FlipVertical: () => "clip = vs.core.std.FlipVertical(clip)",
  Invert: () => "clip = vs.core.std.Invert(clip)",
  Levels: () => "clip = vs.core.std.Levels(clip, min_in=[0.0], max_in=[255.0], gamma=[1.0], min_out=[16.0], max_out=[235.0])",
  Lut: () => "clip = vs.core.std.Lut(clip, lut=list(range(255, -1, -1)))",
  Maximum: () => "clip = vs.core.std.Maximum(clip)",
  Median: () => "clip = vs.core.std.Median(clip)",
  Minimum: () => "clip = vs.core.std.Minimum(clip)",
  ShufflePlanes: () => "clip = vs.core.std.ShufflePlanes(clip, planes=[0, 1, 2], colorfamily=2)",
  StackHorizontal: () => "clip = vs.core.std.StackHorizontal([clip, clip])",
  StackVertical: () => "clip = vs.core.std.StackVertical([clip, clip])",
  Transpose: () => "clip = vs.core.std.Transpose(clip)",
  Turn180: () => "clip = vs.core.std.Turn180(clip)",
});

const NODE_INFO = {
  BlankClip: { namespace: "std", title: "BlankClip", summary: "Creates a constant video clip. This browser graph exposes width and height directly.", signature: "BlankClip(width, height, format, color, …)", kind: "source" },
  Invert: { namespace: "std", title: "Invert", summary: "Inverts every sample in the supplied clip while preserving the clip's geometry.", signature: "Invert(clip, planes=None)", kind: "filter" },
  Output: { namespace: "graph", title: "Program output", summary: "Registers a video node as output 0, which the browser worker renders into the program preview.", signature: "clip.set_output(index=0)", kind: "output" },
};

let canvas;
const source = document.querySelector("textarea");
const run = document.querySelector(".run-button");
const runLabel = document.querySelector("[data-run-label]");
const status = document.querySelector("[data-status-text]");
const runtimeStatus = document.querySelector("[data-runtime-status]");
const graphStatus = document.querySelector("[data-graph-status]");
const graphNodesTarget = document.querySelector("[data-graph-nodes]");
const graphCount = document.querySelector("[data-graph-count]");
const widthControl = document.querySelector("[data-graph-width]");
const heightControl = document.querySelector("[data-graph-height]");
const inspectorTitle = document.querySelector("[data-inspector-title]");
const inspectorPath = document.querySelector("[data-inspector-path]");
const inspectorSpecs = document.querySelector("[data-inspector-specs]");
const inspectorNote = document.querySelector("[data-inspector-note]");
const dimensionControls = document.querySelector("[data-dimension-controls]");
const libraryGroups = document.querySelector("[data-library-groups]");
const librarySearch = document.querySelector("[data-library-search]");
const libraryCount = document.querySelector("[data-library-count]");
const addGraphButton = document.querySelector("[data-add-graph]");
const diagnostics = createDiagnosticConsole();

let runtimeReady = false;
let rendering = false;
let graphState = "ready";
let selectedLibraryFunction = "BlankClip";
let libraryKind = "all";
let selectedIndex = -1;
let rendered = false;
let renderedSource = "";
const nodePositions = new Map();
const dimensions = { width: 320, height: 180 };
let contextMenu = null;
let contextMenuTarget = null;
let contextMenuActions = [];
let wireDrag = null;
let suppressNextNodeClick = false;

window.addEventListener("error", (event) => diagnostics.error("window", event.message || "Unhandled browser error", { filename: event.filename, lineno: event.lineno }));
window.addEventListener("unhandledrejection", (event) => diagnostics.error("promise", event.reason?.message ?? String(event.reason ?? "Unhandled promise rejection")));

const workerUrl = new URL("../runtime/pyodide/bootstrap.mjs", import.meta.url);
const worker = new Worker(workerUrl, { type: "module" });
const client = new PyodideWorkerClient(worker, { onDiagnostic: diagnostics.write });

function setStatus(message, state) { status.textContent = message; runtimeStatus.dataset.state = state; diagnostics.info("status", `${state}: ${message}`); }
function setGraphState(state, message) { graphState = state; graphStatus.dataset.state = state; graphStatus.textContent = message; }
function updateRunControl() { run.disabled = !runtimeReady || rendering; runLabel.textContent = rendering ? "Rendering…" : "Run graph"; run.setAttribute("aria-busy", String(rendering)); }

function functionInfo(name) {
  if (NODE_INFO[name]) return NODE_INFO[name];
  const category = CORE_LIBRARY.find((entry) => entry.names.includes(name));
  return { namespace: "std", title: name, summary: "Documented standard-core function. Add its required arguments in the Python source record, then run to validate it against the upstream core.", signature: `vs.core.std.${name}(…)`, kind: category?.kind ?? "video" };
}

function renderLibrary() {
  const query = librarySearch.value.trim().toLowerCase();
  const groups = CORE_LIBRARY.map((entry) => ({ ...entry, names: entry.names.filter((name) => name.toLowerCase().includes(query)) }))
    .filter((entry) => entry.names.length && (libraryKind === "all" || entry.kind === libraryKind));
  const count = groups.reduce((total, entry) => total + entry.names.length, 0);
  libraryCount.textContent = `${count} refs`;
  if (!groups.length) { libraryGroups.innerHTML = '<p class="library-empty">No matching standard-core functions.</p>'; return; }
  libraryGroups.innerHTML = groups.map((entry, index) => `<details class="function-group" ${index < 2 || query ? "open" : ""}><summary>${entry.group}<span>${entry.names.length}</span></summary><div class="function-list">${entry.names.map((name) => { const validated = VECTOR_VALIDATED_FUNCTIONS.has(name); return `<button class="function-entry" type="button" draggable="true" data-library-function="${name}" aria-current="${selectedLibraryFunction === name}" aria-label="${name}, ${validated ? "browser render vector" : "documented reference"}. Drag onto the graph to add it.">${name}<span class="function-state ${validated ? "verified" : ""}">${validated ? "vector" : "ref"}</span></button>`; }).join("")}</div></details>`).join("");
  libraryGroups.querySelectorAll("[data-library-function]").forEach((button) => button.addEventListener("click", () => selectFunction(button.dataset.libraryFunction, { fromLibrary: true })));
}

function lineOf(charIndex) { return source.value.slice(0, charIndex).split("\n").length - 1; }

function parseScript() {
  const operations = [];
  const callPattern = /^\s*([A-Za-z_]\w*)\s*=\s*vs\.core\.([A-Za-z_]\w*)\.([A-Za-z_]\w*)\(/gm;
  for (const match of source.value.matchAll(callPattern)) operations.push({ id: match[1], namespace: match[2], name: match[3], kind: "filter", line: lineOf(match.index) });
  const referencePattern = /^\s*#\s*Reference:\s*vs\.core\.([A-Za-z_]\w*)\.([A-Za-z_]\w*)\(/gm;
  for (const match of source.value.matchAll(referencePattern)) operations.push({ id: `ref-${operations.length}`, namespace: match[1], name: match[2], kind: "draft", line: lineOf(match.index) });
  const outputs = [...source.value.matchAll(/^\s*([A-Za-z_]\w*)\.set_output\((\d*)\)/gm)];
  if (outputs.length) operations.push({ id: outputs[0][1], namespace: "graph", name: "Output", kind: "output", line: lineOf(outputs[0].index) });
  operations.sort((a, b) => a.line - b.line);
  return operations.length ? operations : [{ id: "graph", namespace: "graph", name: "No plotted calls", kind: "empty", line: 0 }];
}

function renderGraph() {
  const parsed = parseScript();
  graphCount.textContent = String(parsed.length).padStart(2, "0");
  if (parsed[0]?.kind === "empty") { graphNodesTarget.innerHTML = '<p class="node-empty">Drop a library function here, or author a <code>vs.core.namespace.Function(…)</code> call, to plot it. The library remains available while the source record is empty.</p>'; renderMinimap([]); return; }
  const positions = parsed.map((_, index) => nodePositions.get(index) ?? { left: 8 + index * (55 / Math.max(1, parsed.length - 1)), top: 29 + (index % 2 ? 22 : 0) });
  const wirePaths = parsed.slice(1).map((node, index) => {
    const start = positions[index]; const end = positions[index + 1];
    const wireClass = [node.kind === "output" ? "is-output" : "", node.kind === "draft" ? "is-draft" : ""].filter(Boolean).join(" ");
    const d = `M ${start.left + 16} ${start.top + 9} C ${start.left + 22} ${start.top + 9}, ${end.left - 6} ${end.top + 9}, ${end.left} ${end.top + 9}`;
    const marker = node.kind === "output" ? "wire-arrow-output" : "wire-arrow";
    const flowClass = node.kind === "output" ? "is-output" : node.kind === "draft" ? "is-draft" : "";
    const flowDur = node.kind === "draft" ? 2.4 : 1.5;
    return `<path class="${wireClass}" data-from="${index}" d="${d}" marker-end="url(#${marker})"/><circle class="wire-flow ${flowClass}" r="1.5"><animateMotion dur="${flowDur}s" repeatCount="indefinite" path="${d}"/></circle>`;
  }).join("");
  const nodes = parsed.map((node, index) => {
    const info = functionInfo(node.name); const active = selectedIndex === index;
    const draftClass = node.kind === "draft" ? " is-draft" : "";
    const body = node.kind === "draft"
      ? `<div class="node-row"><span>input</span><strong>clip</strong></div><div class="node-row"><span>state</span><strong>reference</strong></div>`
      : node.name === "BlankClip" ? `<div class="node-row"><span>width</span><strong>${dimensions.width}</strong></div><div class="node-row"><span>height</span><strong>${dimensions.height}</strong></div><div class="node-row"><span>format</span><strong>RGB24</strong></div>` : node.name === "Output" ? `<div class="node-row"><span>index</span><strong>0</strong></div><div class="node-row"><span>preview</span><strong>RGBA8</strong></div>` : `<div class="node-row"><span>input</span><strong>clip</strong></div><div class="node-row"><span>result</span><strong>node</strong></div>`;
    const content = node.name === "Output" ? `<div class="graph-node-header"><span class="node-mark"></span>${info.title}<span class="node-namespace">output 0</span></div><canvas width="320" height="180" aria-label="Rendered VapourSynth frame"></canvas><div class="node-body"><span>worker preview</span><span data-output-state>awaiting render</span></div>` : `<div class="graph-node-header"><span class="node-mark"></span>${info.title}<span class="node-namespace">${node.namespace}</span></div><div class="node-body">${body}</div>`;
    return `<button class="graph-node ${node.name === "Output" ? "program-node" : ""}${draftClass}" type="button" data-graph-node="${node.name}" data-index="${index}" data-kind="${node.kind}" aria-pressed="${active}" aria-label="${info.title}${node.kind === "draft" ? ", reference draft" : ""}. Drag to move, drag a port to rewire, Delete to remove." style="left:${positions[index].left}%;top:${positions[index].top}%">${index > 0 ? '<span class="node-port in" aria-hidden="true" title="Wire a source here"></span>' : ""}${content}${index < parsed.length - 1 ? '<span class="node-port out" aria-hidden="true" title="Drag to rewire"></span>' : ""}</button>`;
  }).join("");
  graphNodesTarget.innerHTML = `<svg class="graph-wires" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true"><defs><marker id="wire-arrow" viewBox="0 0 1 1" refX="0.62" refY="0.5" markerWidth="0.9" markerHeight="0.9" markerUnits="userSpaceOnUse" orient="auto"><path d="M 0 0 L 1 0.5 L 0 1 z" fill="var(--draft)"/></marker><marker id="wire-arrow-output" viewBox="0 0 1 1" refX="0.62" refY="0.5" markerWidth="0.9" markerHeight="0.9" markerUnits="userSpaceOnUse" orient="auto"><path d="M 0 0 L 1 0.5 L 0 1 z" fill="var(--signal)"/></marker></defs>${wirePaths}</svg>${nodes}`;
  graphNodesTarget.querySelectorAll("[data-graph-node]").forEach((node) => {
    const index = Number(node.dataset.index);
    node.addEventListener("click", () => { if (suppressNextNodeClick) { suppressNextNodeClick = false; return; } selectFunction(node.dataset.graphNode, { index }); });
    attachNodeDrag(node, index);
  });
  renderMinimap(parsed);
  const nextCanvas = graphNodesTarget.querySelector("canvas");
  if (!nextCanvas) return;
  if (canvas && canvas !== nextCanvas) nextCanvas.replaceWith(canvas);
  else canvas = nextCanvas;
}

function attachNodeDrag(nodeEl, index) {
  nodeEl.addEventListener("pointerdown", (event) => {
    if (event.button !== 0 || event.target.closest(".node-port")) return;
    event.preventDefault();
    const panel = graphNodesTarget;
    const panelRect = panel.getBoundingClientRect();
    const nodeRect = nodeEl.getBoundingClientRect();
    const widthPct = (nodeRect.width / panelRect.width) * 100;
    const heightPct = (nodeRect.height / panelRect.height) * 100;
    const startX = event.clientX; const startY = event.clientY;
    const startLeft = ((nodeRect.left - panelRect.left) / panelRect.width) * 100;
    const startTop = ((nodeRect.top - panelRect.top) / panelRect.height) * 100;
    nodeEl.setPointerCapture?.(event.pointerId);
    let moved = false;
    const onMove = (moveEvent) => {
      if (moveEvent.pointerId !== event.pointerId) return;
      const left = clamp(startLeft + ((moveEvent.clientX - startX) / panelRect.width) * 100, 0, Math.max(0, 100 - widthPct));
      const top = clamp(startTop + ((moveEvent.clientY - startY) / panelRect.height) * 100, 0, Math.max(0, 100 - heightPct));
      nodeEl.style.left = `${left}%`; nodeEl.style.top = `${top}%`;
      nodeEl.classList.add("is-dragging");
      moved = true;
      updateWiresAround(index);
    };
    const onUp = (upEvent) => {
      if (upEvent.pointerId !== event.pointerId) return;
      document.removeEventListener("pointermove", onMove);
      document.removeEventListener("pointerup", onUp);
      nodeEl.classList.remove("is-dragging");
      if (moved) nodePositions.set(index, { left: parseFloat(nodeEl.style.left), top: parseFloat(nodeEl.style.top) });
    };
    document.addEventListener("pointermove", onMove);
    document.addEventListener("pointerup", onUp);
  });
}

function updateWiresAround(index) {
  graphNodesTarget.querySelectorAll(".graph-wires path").forEach((path) => {
    const from = Number(path.dataset.from);
    if (from === index - 1 || from === index) path.setAttribute("d", wirePathBetween(from, from + 1));
  });
}

function wirePathBetween(fromIndex, toIndex) {
  const nodes = graphNodesTarget.querySelectorAll("[data-graph-node]");
  const from = nodes[fromIndex]; const to = nodes[toIndex];
  if (!from || !to) return "";
  const startLeft = parseFloat(from.style.left); const startTop = parseFloat(from.style.top);
  const endLeft = parseFloat(to.style.left); const endTop = parseFloat(to.style.top);
  return `M ${startLeft + 16} ${startTop + 9} C ${startLeft + 22} ${startTop + 9}, ${endLeft - 6} ${endTop + 9}, ${endLeft} ${endTop + 9}`;
}

function nudgeNode(index, dx, dy) {
  const node = graphNodesTarget.querySelector(`[data-graph-node][data-index="${index}"]`);
  if (!node) return;
  const panelRect = graphNodesTarget.getBoundingClientRect();
  const nodeRect = node.getBoundingClientRect();
  const widthPct = (nodeRect.width / panelRect.width) * 100;
  const heightPct = (nodeRect.height / panelRect.height) * 100;
  const current = nodePositions.get(index) ?? { left: parseFloat(node.style.left) || 0, top: parseFloat(node.style.top) || 0 };
  const next = { left: clamp(current.left + dx, 0, Math.max(0, 100 - widthPct)), top: clamp(current.top + dy, 0, Math.max(0, 100 - heightPct)) };
  nodePositions.set(index, next);
  node.style.left = `${next.left}%`; node.style.top = `${next.top}%`;
  updateWiresAround(index);
}

function removeNodeAt(index) {
  const parsed = parseScript();
  const op = parsed[index];
  if (!op || op.kind === "output" || op.kind === "empty") return;
  if (op.kind === "draft") removeReferenceLine(op); else removeCallFromSource(op);
  nodePositions.delete(index);
  for (let shifted = index + 1; shifted < parsed.length; shifted += 1) {
    const position = nodePositions.get(shifted);
    if (position) { nodePositions.set(shifted - 1, position); nodePositions.delete(shifted); }
  }
  const nextSelection = parsed[Math.max(0, index - 1)];
  selectFunction(nextSelection?.name ?? "BlankClip", { fromLibrary: nextSelection === undefined });
  touchSource("NODE REMOVED");
}

// Rewires the chain so the op at sourceIndex directly feeds the op at
// targetIndex: the source call block moves to the line just before the
// target's block in the source record. This is the script-logic edit the
// visual ports express: Invert→AddBorders and AddBorders→Invert produce
// different frames, so the source text itself must change.
function moveCallBefore(sourceIndex, targetIndex) {
  const parsed = parseScript();
  const sourceOp = parsed[sourceIndex];
  const targetOp = parsed[targetIndex];
  if (!sourceOp || !targetOp || sourceOp.kind === "output" || targetOp.kind === "empty") return;
  if (sourceIndex === targetIndex) return;
  const lines = source.value.split("\n");
  const start = sourceOp.line;
  const end = blockEndLine(sourceOp, lines);
  const nothingBetween = parsed.every((op) => op === sourceOp || op === targetOp || op.line <= start || op.line >= targetOp.line);
  if (sourceIndex < targetIndex && nothingBetween) return; // already directly feeds the target
  const block = lines.splice(start, end - start);
  let targetLine = targetOp.line;
  if (targetOp.line > start) targetLine -= end - start;
  lines.splice(targetLine, 0, ...block);
  source.value = lines.join("\n");
  shiftPositionsAfterMove(sourceIndex, targetIndex);
  const reparse = parseScript();
  const movedIndex = reparse.findIndex((op) => op.line === targetLine && op.kind === sourceOp.kind && op.name === sourceOp.name);
  selectFunction(sourceOp.name, { index: movedIndex !== -1 ? movedIndex : targetIndex });
  touchSource("NODE REWIRED");
}

function blockEndLine(op, lines) {
  const pattern = new RegExp(`^\\s*${escapeRegExp(op.id)}\\s*=\\s*vs\\.core\\.`);
  if (!pattern.test(lines[op.line] ?? "")) return op.line + 1;
  let depth = 0; let end = op.line;
  do { for (const character of lines[end] ?? "") { if (character === "(") depth += 1; else if (character === ")") depth -= 1; } end += 1; } while (depth > 0 && end < lines.length);
  return end;
}

function shiftPositionsAfterMove(sourceIndex, targetIndex) {
  const next = new Map();
  for (const [key, value] of nodePositions) {
    if (sourceIndex < targetIndex) {
      if (key === sourceIndex) next.set(targetIndex - 1, value);
      else if (key > sourceIndex && key < targetIndex) next.set(key - 1, value);
      else next.set(key, value);
    } else {
      if (key === sourceIndex) next.set(targetIndex, value);
      else if (key >= targetIndex && key < sourceIndex) next.set(key + 1, value);
      else next.set(key, value);
    }
  }
  nodePositions.clear();
  for (const [key, value] of next) nodePositions.set(key, value);
}

function removeCallFromSource(op) {
  const lines = source.value.split("\n");
  const pattern = new RegExp(`^\\s*${escapeRegExp(op.id)}\\s*=\\s*vs\\.core\\.`);
  if (!pattern.test(lines[op.line] ?? "")) return;
  lines.splice(op.line, blockEndLine(op, lines) - op.line);
  source.value = lines.join("\n");
}

function removeReferenceLine(op) {
  const lines = source.value.split("\n");
  const pattern = new RegExp(`^\\s*#\\s*Reference:\\s*vs\\.core\\.${escapeRegExp(op.namespace)}\\.${escapeRegExp(op.name)}\\(`);
  if (!pattern.test(lines[op.line] ?? "")) return;
  lines.splice(op.line, 1);
  source.value = lines.join("\n");
}

function addNodeToGraph(name) {
  const info = functionInfo(name);
  if (info.kind !== "video") return false;
  const template = NODE_CALL_TEMPLATES[name];
  if (template) insertSourceLine(template(dimensions), null);
  else insertSourceLine(null, `# Reference: vs.core.${info.namespace}.${name}(…)`);
  return true;
}

function insertSourceLine(call, referenceNote) {
  const block = referenceNote ? `${referenceNote}\n${call ?? ""}`.trimEnd() : call;
  const outputMatch = source.value.match(/^\s*[A-Za-z_]\w*\s*\.set_output\(/m);
  source.value = outputMatch
    ? `${source.value.slice(0, outputMatch.index)}${block}\n${source.value.slice(outputMatch.index)}`
    : `${source.value.trimEnd()}\n${block}\n`;
  touchSource("NODE ADDED");
}

function renderMinimap(parsed) {
  const svg = document.querySelector(".minimap svg");
  if (!svg) return;
  const count = Math.min(parsed.length, 4);
  const rects = []; const points = [];
  for (let index = 0; index < count; index += 1) {
    const x = 10 + index * 26; const y = 24 + (index % 2 ? 9 : 0);
    rects.push(`<rect x="${x}" y="${y}" width="20" height="13"/>`);
    points.push(`${x + 10},${y + 6}`);
  }
  const route = count > 1 ? `<path d="M ${points.join(" L ")}"/>` : "";
  svg.innerHTML = `<rect x="2" y="2" width="116" height="66"/>${rects.join("")}${route}`;
}

function selectFunction(name, { fromLibrary = false, index } = {}) {
  const info = functionInfo(name);
  if (fromLibrary) selectedLibraryFunction = name;
  if (index !== undefined) selectedIndex = index;
  else if (fromLibrary) {
    const parsed = parseScript();
    selectedIndex = parsed.findIndex((op) => op.name === name && op.kind !== "draft");
  } else selectedIndex = -1;
  inspectorTitle.textContent = info.title;
  inspectorPath.textContent = info.namespace === "graph" ? info.signature : `vs.core.${info.namespace}.${info.title}`;
  const validated = VECTOR_VALIDATED_FUNCTIONS.has(name);
  inspectorSpecs.innerHTML = `<dt>Call</dt><dd>${info.signature}</dd><dt>Role</dt><dd>${info.kind}</dd><dt>Validation</dt><dd>${validated ? "browser render vector" : "documented reference"}</dd><dt>Graph</dt><dd>${fromLibrary ? "library selection" : "plotted operation"}</dd>`;
  inspectorNote.textContent = validated ? info.summary : `${info.summary} This entry is not presented as an executable preset.`;
  dimensionControls.hidden = name !== "BlankClip";
  updateAddGraphControl();
  renderGraph();
  if (fromLibrary) renderLibrary();
}

function clamp(value, min, max) { return Math.min(max, Math.max(min, value)); }
function escapeRegExp(value) { return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }
function updateBlankClipDimensions() {
  const pattern = /([A-Za-z_]\w*\s*=\s*vs\.core\.std\.BlankClip\(width=)\d+([^)]*height=)\d+([^)]*\))/;
  const match = source.value.match(pattern);
  if (!match) return false;
  source.value = source.value.replace(pattern, `$1${dimensions.width}$2${dimensions.height}$3`);
  return true;
}
function clampDimension(control, fallback) { const value = Number.parseInt(control.value, 10); const min = Number.parseInt(control.min, 10); const max = Number.parseInt(control.max, 10); return Number.isInteger(value) ? Math.min(max, Math.max(min, value)) : fallback; }
function markChanged(message = "CHANGED") { setGraphState("changed", message); }
function touchSource(message) { markChanged(message); renderGraph(); clearStalePreview(); }
function clearStalePreview() {
  if (!rendered || renderedSource === source.value) return;
  rendered = false;
  if (canvas) canvas.getContext("2d").clearRect(0, 0, canvas.width, canvas.height);
  document.querySelectorAll("[data-output-state]").forEach((target) => { target.textContent = "awaiting render"; target.dataset.state = "changed"; });
}
function updateAddGraphControl() {
  if (!addGraphButton) return;
  const info = functionInfo(selectedLibraryFunction);
  addGraphButton.disabled = info.kind !== "video";
  addGraphButton.title = info.kind !== "video" ? "Only video functions can plot on the video route" : "";
}

async function refreshStatus() {
  setStatus("Starting browser workers…", "loading");
  const capabilities = await client.status(); runtimeReady = capabilities.upstreamLinked;
  const capsTarget = document.querySelector("[data-authoring-caps]");
  if (capsTarget) capsTarget.textContent = capabilities.authoring?.available ? `plan version ${capabilities.authoring.planVersion} · source format ${capabilities.authoring.format}` : "authoring unavailable";
  if (runtimeReady) setStatus("Runtime ready · author or run a graph", "ready"); else setStatus("Pyodide ready · Emscripten runtime not attached", "idle");
  updateRunControl();
}

async function renderScript() {
  if (!runtimeReady || rendering) return;
  rendering = true; setStatus("Executing editor.vpy…", "rendering"); setGraphState("rendering", "RENDERING"); updateRunControl();
  try {
    const scriptAtStart = source.value; const { outputs } = await client.runScript(scriptAtStart, "editor.vpy");
    const output = outputs.find(({ index }) => index === 0); if (!output) throw new Error("the script did not register output 0 with clip.set_output()");
    const frame = await client.renderOutput(output.index); drawRgbaFrame(canvas, frame);
    rendered = true; renderedSource = scriptAtStart;
    setStatus(`Rendered ${frame.width}×${frame.height} RGBA8`, "ready"); setGraphState("ready", `RENDERED ${frame.width}×${frame.height}`);
    document.querySelectorAll("[data-output-state]").forEach((target) => { target.textContent = `${frame.width}×${frame.height}`; target.dataset.state = "ready"; });
  } catch (error) { const message = `${error.code ?? "error"}: ${error.message}`; diagnostics.error("render", message, error.stack); setStatus(message, "error"); setGraphState("error", "RENDER FAILED"); clearStalePreview(); }
  finally { rendering = false; updateRunControl(); }
}

run.addEventListener("click", renderScript);
source.addEventListener("input", () => { markChanged("SOURCE CHANGED"); renderGraph(); clearStalePreview(); });
source.addEventListener("keydown", (event) => { if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) { event.preventDefault(); void renderScript(); } });
widthControl.addEventListener("input", () => { dimensions.width = clampDimension(widthControl, dimensions.width); if (updateBlankClipDimensions()) touchSource("DIMENSIONS CHANGED"); selectFunction("BlankClip", { fromLibrary: true }); });
heightControl.addEventListener("input", () => { dimensions.height = clampDimension(heightControl, dimensions.height); if (updateBlankClipDimensions()) touchSource("DIMENSIONS CHANGED"); selectFunction("BlankClip", { fromLibrary: true }); });
librarySearch.addEventListener("input", renderLibrary);
document.querySelectorAll(".library-tab").forEach((tab) => tab.addEventListener("click", () => { libraryKind = tab.textContent.toLowerCase(); document.querySelectorAll(".library-tab").forEach((candidate) => candidate.setAttribute("aria-selected", String(candidate === tab))); renderLibrary(); }));
document.querySelector("[data-copy-call]").addEventListener("click", () => copySignature(functionInfo(selectedLibraryFunction).signature));
document.querySelector("[data-add-graph]").addEventListener("click", () => {
  const name = selectedLibraryFunction;
  if (!addNodeToGraph(name)) return;
  const info = functionInfo(name);
  inspectorNote.textContent = NODE_CALL_TEMPLATES[name]
    ? "The call was appended before set_output(). Run the graph to validate it against the upstream core."
    : "A reference draft was plotted. Replace the comment with an authored call and valid arguments to make it runnable.";
  selectFunction(name, { fromLibrary: true });
});
document.querySelector("[data-insert-note]").addEventListener("click", () => { const info = functionInfo(selectedLibraryFunction); const note = `# Reference: ${info.signature}`; if (!source.value.includes(note)) insertSourceLine(null, note); source.focus(); inspectorNote.textContent = "A non-executable reference note was added. Replace it with an authored call and its valid arguments to plot it."; });
document.querySelector(".theme-toggle").addEventListener("click", (event) => {
  const highContrast = event.currentTarget.getAttribute("aria-pressed") !== "true";
  event.currentTarget.setAttribute("aria-pressed", String(highContrast));
  event.currentTarget.textContent = highContrast ? "Drafting contrast" : "Dark draft";
  if (highContrast) document.documentElement.setAttribute("data-contrast", "high");
  else document.documentElement.removeAttribute("data-contrast");
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", highContrast ? "#0e0d0b" : "#171512");
});
libraryGroups.addEventListener("dragstart", (event) => {
  const button = event.target.closest("[data-library-function]");
  if (!button) return;
  event.dataTransfer.setData("text/plain", button.dataset.libraryFunction);
  event.dataTransfer.effectAllowed = "copy";
});
graphNodesTarget.addEventListener("dragover", (event) => { if (event.dataTransfer.types.includes("text/plain")) { event.preventDefault(); event.dataTransfer.dropEffect = "copy"; graphNodesTarget.classList.add("is-drop-target"); } });
graphNodesTarget.addEventListener("dragleave", () => graphNodesTarget.classList.remove("is-drop-target"));
graphNodesTarget.addEventListener("drop", (event) => {
  event.preventDefault();
  graphNodesTarget.classList.remove("is-drop-target");
  const name = event.dataTransfer.getData("text/plain");
  if (name) { selectFunction(name, { fromLibrary: true }); addNodeToGraph(name); }
});
graphNodesTarget.addEventListener("keydown", (event) => {
  const node = event.target.closest("[data-graph-node]");
  if (!node) return;
  const index = Number(node.dataset.index);
  if (event.key === "Delete" || event.key === "Backspace") { event.preventDefault(); removeNodeAt(index); }
  else if (event.key.startsWith("Arrow")) {
    event.preventDefault();
    const step = event.shiftKey ? 5 : 1;
    const dx = event.key === "ArrowLeft" ? -step : event.key === "ArrowRight" ? step : 0;
    const dy = event.key === "ArrowUp" ? -step : event.key === "ArrowDown" ? step : 0;
    nudgeNode(index, dx, dy);
  }
});
graphNodesTarget.addEventListener("contextmenu", (event) => {
  const node = event.target.closest("[data-graph-node]");
  if (!node) return;
  event.preventDefault();
  const index = Number(node.dataset.index);
  selectFunction(node.dataset.graphNode, { index });
  const anchor = event.clientX === 0 && event.clientY === 0 ? (() => { const rect = node.getBoundingClientRect(); return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 }; })() : { x: event.clientX, y: event.clientY };
  openContextMenu(node, anchor.x, anchor.y);
});

async function copySignature(signature) {
  try { await navigator.clipboard.writeText(signature); inspectorNote.textContent = "Function call copied to the clipboard."; }
  catch { inspectorNote.textContent = `Copy this call: ${signature}`; }
}

function ensureContextMenu() {
  if (contextMenu) return contextMenu;
  contextMenu = document.createElement("div");
  contextMenu.className = "context-menu";
  contextMenu.setAttribute("role", "menu");
  contextMenu.setAttribute("aria-label", "Node actions");
  contextMenu.hidden = true;
  contextMenu.addEventListener("click", (event) => {
    const item = event.target.closest("[data-item]");
    if (!item || item.disabled) return;
    const action = contextMenuActions[Number(item.dataset.item)];
    closeContextMenu();
    action?.();
  });
  contextMenu.addEventListener("keydown", (event) => {
    const items = [...contextMenu.querySelectorAll("[data-item]:not(:disabled)")];
    const current = items.indexOf(document.activeElement);
    if (event.key === "Escape") { event.preventDefault(); closeContextMenu(); }
    else if (event.key === "ArrowDown") { event.preventDefault(); items[(current + 1) % items.length]?.focus(); }
    else if (event.key === "ArrowUp") { event.preventDefault(); items[(current - 1 + items.length) % items.length]?.focus(); }
    else if (event.key === "Home") { event.preventDefault(); items[0]?.focus(); }
    else if (event.key === "End") { event.preventDefault(); items[items.length - 1]?.focus(); }
  });
  document.body.append(contextMenu);
  return contextMenu;
}

function openContextMenu(node, x, y) {
  const menu = ensureContextMenu();
  closeContextMenu({ restoreFocus: false });
  const kind = node.dataset.kind;
  const info = functionInfo(node.dataset.graphNode);
  contextMenuTarget = node;
  const items = [];
  if (kind === "output") items.push({ label: "Delete node", hint: "Del", disabled: true, title: "The program output is not deletable" });
  else items.push({ label: "Delete node", hint: "Del", action: () => removeNodeAt(Number(node.dataset.index)) });
  items.push({ label: "Copy call", action: () => copySignature(info.signature) });
  contextMenuActions = items.map((item) => item.action);
  menu.innerHTML = items.map((item, itemIndex) => `<button type="button" class="context-menu-item" role="menuitem" data-item="${itemIndex}" ${item.disabled ? "disabled" : ""} ${item.title ? `title="${item.title}"` : ""}><span>${item.label}</span>${item.hint ? `<kbd>${item.hint}</kbd>` : ""}</button>`).join("");
  menu.hidden = false;
  const rect = menu.getBoundingClientRect();
  const margin = 8;
  menu.style.left = `${clamp(x, margin, window.innerWidth - rect.width - margin)}px`;
  menu.style.top = `${clamp(y, margin, window.innerHeight - rect.height - margin)}px`;
  menu.querySelector("[data-item]:not(:disabled)")?.focus({ preventScroll: true });
}

function closeContextMenu({ restoreFocus = true } = {}) {
  if (!contextMenu || contextMenu.hidden) { contextMenuTarget = null; return; }
  const target = contextMenuTarget;
  contextMenu.hidden = true;
  contextMenu.innerHTML = "";
  contextMenuActions = [];
  contextMenuTarget = null;
  if (restoreFocus && target) target.focus({ preventScroll: true });
}

document.addEventListener("pointerdown", (event) => {
  if (contextMenu && !contextMenu.hidden && !contextMenu.contains(event.target)) closeContextMenu();
});
window.addEventListener("blur", () => closeContextMenu());
window.addEventListener("resize", () => closeContextMenu({ restoreFocus: false }));
window.addEventListener("scroll", () => closeContextMenu({ restoreFocus: false }), true);

// Wire ports: drag an out-port onto another node (or the empty canvas to
// append) to rewire the script chain; an in-port dragged onto a node makes
// that node feed it. Ports mirror the linear clip pipeline, so a wire A→B
// means A's call block moves to the line directly before B's.
graphNodesTarget.addEventListener("pointerdown", (event) => {
  if (event.button !== 0) return;
  const port = event.target.closest(".node-port");
  if (!port) return;
  event.preventDefault();
  const node = port.closest("[data-graph-node]");
  const index = Number(node.dataset.index);
  const kind = port.classList.contains("in") ? "in" : "out";
  startWireDrag(port, index, kind);
  const onMove = (moveEvent) => updateRubberWire(moveEvent.clientX, moveEvent.clientY);
  const onUp = (upEvent) => { document.removeEventListener("pointermove", onMove); document.removeEventListener("pointerup", onUp); document.removeEventListener("keydown", onKey); endWireDrag(upEvent); };
  const onKey = (keyEvent) => { if (keyEvent.key === "Escape") { document.removeEventListener("pointermove", onMove); document.removeEventListener("pointerup", onUp); document.removeEventListener("keydown", onKey); cancelWireDrag(); } };
  document.addEventListener("pointermove", onMove);
  document.addEventListener("pointerup", onUp);
  document.addEventListener("keydown", onKey);
});

function startWireDrag(portEl, index, kind) {
  const wiresSvg = graphNodesTarget.querySelector(".graph-wires");
  const start = wirePortCenter(portEl);
  const rubber = document.createElementNS("http://www.w3.org/2000/svg", "path");
  rubber.setAttribute("class", "wire-rubber");
  rubber.setAttribute("d", rubberPath(start, start));
  wiresSvg.append(rubber);
  wireDrag = { index, kind, start, rubber };
  graphNodesTarget.classList.add("is-connecting");
}

function wirePortCenter(portEl) {
  const panelRect = graphNodesTarget.getBoundingClientRect();
  const portRect = portEl.getBoundingClientRect();
  return { x: ((portRect.left + portRect.width / 2 - panelRect.left) / panelRect.width) * 100, y: ((portRect.top + portRect.height / 2 - panelRect.top) / panelRect.height) * 100 };
}

function rubberPath(from, to) {
  return `M ${from.x} ${from.y} C ${from.x + 4} ${from.y}, ${to.x - 4} ${to.y}, ${to.x} ${to.y}`;
}

function updateRubberWire(clientX, clientY) {
  if (!wireDrag) return;
  const panelRect = graphNodesTarget.getBoundingClientRect();
  const to = { x: ((clientX - panelRect.left) / panelRect.width) * 100, y: ((clientY - panelRect.top) / panelRect.height) * 100 };
  wireDrag.rubber.setAttribute("d", rubberPath(wireDrag.start, to));
  const target = document.elementFromPoint(clientX, clientY)?.closest("[data-graph-node]");
  graphNodesTarget.querySelectorAll(".graph-node.is-connect-target").forEach((node) => node.classList.remove("is-connect-target"));
  if (target) target.classList.add("is-connect-target");
}

function endWireDrag(event) {
  if (!wireDrag) return;
  const { index, kind } = wireDrag;
  cancelWireDrag();
  suppressNextNodeClick = true;
  const parsed = parseScript();
  const targetEl = document.elementFromPoint(event.clientX, event.clientY)?.closest("[data-graph-node]");
  const targetIndex = targetEl ? Number(targetEl.dataset.index) : -1;
  const outputIndex = parsed.findIndex((op) => op.kind === "output");
  if (targetIndex === index) return;
  if (kind === "out") {
    // The dragged node's output feeds the drop target; dropping on the
    // canvas appends it as the final stage.
    const sourceOp = parsed[index];
    if (!sourceOp || sourceOp.kind === "output") return;
    if (targetIndex === 0) moveCallBefore(index, 1);
    else if (targetIndex > 0) moveCallBefore(index, targetIndex);
    else if (outputIndex !== -1) moveCallBefore(index, outputIndex);
  } else if (targetIndex > 0) {
    // The drop target feeds the dragged node's input. The Output node
    // has no output to give, so it cannot feed anything.
    const feeder = parsed[targetIndex];
    if (feeder && feeder.kind !== "output") moveCallBefore(targetIndex, index);
  } else if (targetIndex === 0) {
    // Wire to the BlankClip slot: the dragged node becomes the first stage.
    moveCallBefore(index, 1);
  }
}

function cancelWireDrag() {
  if (!wireDrag) return;
  wireDrag.rubber.remove();
  wireDrag = null;
  graphNodesTarget.classList.remove("is-connecting");
  graphNodesTarget.querySelectorAll(".graph-node.is-connect-target").forEach((node) => node.classList.remove("is-connect-target"));
}

graphNodesTarget.addEventListener("mouseover", (event) => {
  const port = event.target.closest(".node-port");
  if (!port) return;
  const node = port.closest("[data-graph-node]");
  const from = port.classList.contains("out") ? Number(node.dataset.index) : Number(node.dataset.index) - 1;
  graphNodesTarget.querySelectorAll(`.graph-wires path[data-from="${from}"]`).forEach((path) => path.classList.add("is-hovered"));
});
graphNodesTarget.addEventListener("mouseout", (event) => {
  const port = event.target.closest(".node-port");
  if (!port) return;
  const node = port.closest("[data-graph-node]");
  const from = port.classList.contains("out") ? Number(node.dataset.index) : Number(node.dataset.index) - 1;
  graphNodesTarget.querySelectorAll(`.graph-wires path[data-from="${from}"]`).forEach((path) => path.classList.remove("is-hovered"));
});

renderLibrary(); selectFunction("BlankClip", { fromLibrary: true });
window.addEventListener("pagehide", () => client.close(), { once: true });
refreshStatus().catch((error) => { runtimeReady = false; diagnostics.error("startup", error.message, error.stack); setStatus(`startup-error: ${error.message}`, "error"); updateRunControl(); });

function createDiagnosticConsole() {
  const details = document.querySelector("details.diagnostics"); const log = details?.querySelector(".diagnostics-log"); const clearButton = details?.querySelector(".diagnostics-clear");
  clearButton?.addEventListener("click", () => { log.textContent = ""; });
  const write = ({ level = "info", source = "client", message, detail, timestamp = new Date().toISOString() }) => { if (!log) return; const line = document.createElement("span"); line.className = `diagnostic-${level}`; let text = `[${timestamp.slice(11, 23)}] ${level.toUpperCase().padEnd(5)} ${source}: ${message}`; if (detail) text += `\n  ${typeof detail === "string" ? detail : JSON.stringify(detail)}`; line.textContent = `${text}\n`; log.append(line); log.scrollTop = log.scrollHeight; if (level === "error") details.open = true; };
  return { write, info: (source, message, detail) => write({ level: "info", source, message, detail }), warn: (source, message, detail) => write({ level: "warn", source, message, detail }), error: (source, message, detail) => write({ level: "error", source, message, detail }) };
}

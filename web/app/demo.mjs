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
const diagnostics = createDiagnosticConsole();

let runtimeReady = false;
let rendering = false;
let graphState = "ready";
let selected = "BlankClip";
let selectedLibraryFunction = "BlankClip";
let libraryKind = "all";
const dimensions = { width: 320, height: 180 };

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
  libraryGroups.innerHTML = groups.map((entry, index) => `<details class="function-group" ${index < 2 || query ? "open" : ""}><summary>${entry.group}<span>${entry.names.length}</span></summary><div class="function-list">${entry.names.map((name) => { const validated = VECTOR_VALIDATED_FUNCTIONS.has(name); return `<button class="function-entry" type="button" data-library-function="${name}" aria-current="${selectedLibraryFunction === name}" aria-label="${name}, ${validated ? "browser render vector" : "documented reference"}">${name}<span class="function-state ${validated ? "verified" : ""}">${validated ? "vector" : "ref"}</span></button>`; }).join("")}</div></details>`).join("");
  libraryGroups.querySelectorAll("[data-library-function]").forEach((button) => button.addEventListener("click", () => selectFunction(button.dataset.libraryFunction, { fromLibrary: true })));
}

function parseScript() {
  const operations = [];
  const calls = source.value.matchAll(/^\s*([A-Za-z_]\w*)\s*=\s*vs\.core\.([A-Za-z_]\w*)\.([A-Za-z_]\w*)\(/gm);
  for (const match of calls) operations.push({ id: match[1], namespace: match[2], name: match[3], kind: "filter" });
  const outputs = [...source.value.matchAll(/^\s*([A-Za-z_]\w*)\.set_output\((\d*)\)/gm)];
  if (outputs.length) operations.push({ id: outputs[0][1], namespace: "graph", name: "Output", kind: "output" });
  return operations.length ? operations : [{ id: "graph", namespace: "graph", name: "No plotted calls", kind: "empty" }];
}

function renderGraph() {
  const parsed = parseScript();
  graphCount.textContent = String(parsed.length).padStart(2, "0");
  if (parsed[0]?.kind === "empty") { graphNodesTarget.innerHTML = '<p class="node-empty">Author a <code>vs.core.namespace.Function(…)</code> call to plot it here. The library remains available while the source record is empty.</p>'; return; }
  const positions = parsed.map((_, index) => ({ left: 8 + index * (55 / Math.max(1, parsed.length - 1)), top: 29 + (index % 2 ? 22 : 0) }));
  const wirePaths = parsed.slice(1).map((node, index) => {
    const start = positions[index]; const end = positions[index + 1]; const output = node.kind === "output" ? " is-output" : "";
    return `<path class="${output}" d="M ${start.left + 16} ${start.top + 9} C ${start.left + 22} ${start.top + 9}, ${end.left - 6} ${end.top + 9}, ${end.left} ${end.top + 9}"/>`;
  }).join("");
  const nodes = parsed.map((node, index) => {
    const info = functionInfo(node.name); const active = selected === node.name;
    const body = node.name === "BlankClip" ? `<div class="node-row"><span>width</span><strong>${dimensions.width}</strong></div><div class="node-row"><span>height</span><strong>${dimensions.height}</strong></div><div class="node-row"><span>format</span><strong>RGB24</strong></div>` : node.name === "Output" ? `<div class="node-row"><span>index</span><strong>0</strong></div><div class="node-row"><span>preview</span><strong>RGBA8</strong></div>` : `<div class="node-row"><span>input</span><strong>clip</strong></div><div class="node-row"><span>result</span><strong>node</strong></div>`;
    const content = node.name === "Output" ? `<div class="graph-node-header"><span class="node-mark"></span>${info.title}<span class="node-namespace">output 0</span></div><canvas width="320" height="180" aria-label="Rendered VapourSynth frame"></canvas><div class="node-body"><span>worker preview</span><span data-output-state>awaiting render</span></div>` : `<div class="graph-node-header"><span class="node-mark"></span>${info.title}<span class="node-namespace">${node.namespace}</span></div><div class="node-body">${body}</div>`;
    return `<button class="graph-node ${node.name === "Output" ? "program-node" : ""}" type="button" data-graph-node="${node.name}" data-index="${index}" data-kind="${node.kind}" aria-pressed="${active}" style="left:${positions[index].left}%;top:${positions[index].top}%">${index > 0 ? '<span class="node-port in" aria-hidden="true"></span>' : ""}${content}${index < parsed.length - 1 ? '<span class="node-port out" aria-hidden="true"></span>' : ""}</button>`;
  }).join("");
  graphNodesTarget.innerHTML = `<svg class="graph-wires" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">${wirePaths}</svg>${nodes}`;
  graphNodesTarget.querySelectorAll("[data-graph-node]").forEach((node) => node.addEventListener("click", () => selectFunction(node.dataset.graphNode)));
  const nextCanvas = graphNodesTarget.querySelector("canvas");
  if (!nextCanvas) return;
  if (canvas && canvas !== nextCanvas) nextCanvas.replaceWith(canvas);
  else canvas = nextCanvas;
}

function selectFunction(name, { fromLibrary = false } = {}) {
  const info = functionInfo(name);
  selected = name;
  if (fromLibrary) selectedLibraryFunction = name;
  inspectorTitle.textContent = info.title;
  inspectorPath.textContent = info.namespace === "graph" ? info.signature : `vs.core.${info.namespace}.${info.title}`;
  const validated = VECTOR_VALIDATED_FUNCTIONS.has(name);
  inspectorSpecs.innerHTML = `<dt>Call</dt><dd>${info.signature}</dd><dt>Role</dt><dd>${info.kind}</dd><dt>Validation</dt><dd>${validated ? "browser render vector" : "documented reference"}</dd><dt>Graph</dt><dd>${fromLibrary ? "library selection" : "plotted operation"}</dd>`;
  inspectorNote.textContent = validated ? info.summary : `${info.summary} This entry is not presented as an executable preset.`;
  dimensionControls.hidden = name !== "BlankClip";
  renderGraph();
  if (fromLibrary) renderLibrary();
}

function generateSource() { return `import vapoursynth as vs\n\nclip = vs.core.std.BlankClip(width=${dimensions.width}, height=${dimensions.height}, format=vs.RGB24, color=[32.0, 96.0, 224.0])\nclip = vs.core.std.Invert(clip)\nclip.set_output()`; }
function clampDimension(control, fallback) { const value = Number.parseInt(control.value, 10); const min = Number.parseInt(control.min, 10); const max = Number.parseInt(control.max, 10); return Number.isInteger(value) ? Math.min(max, Math.max(min, value)) : fallback; }
function markChanged(message = "CHANGED") { setGraphState("changed", message); }

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
    setStatus(`Rendered ${frame.width}×${frame.height} RGBA8`, "ready"); setGraphState("ready", `RENDERED ${frame.width}×${frame.height}`);
    document.querySelectorAll("[data-output-state]").forEach((target) => { target.textContent = `${frame.width}×${frame.height}`; target.dataset.state = "ready"; });
  } catch (error) { const message = `${error.code ?? "error"}: ${error.message}`; diagnostics.error("render", message, error.stack); setStatus(message, "error"); setGraphState("error", "RENDER FAILED"); }
  finally { rendering = false; updateRunControl(); }
}

run.addEventListener("click", renderScript);
source.addEventListener("input", () => { markChanged("SOURCE CHANGED"); renderGraph(); });
source.addEventListener("keydown", (event) => { if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) { event.preventDefault(); void renderScript(); } });
widthControl.addEventListener("input", () => { dimensions.width = clampDimension(widthControl, dimensions.width); source.value = generateSource(); markChanged(); selectFunction("BlankClip"); });
heightControl.addEventListener("input", () => { dimensions.height = clampDimension(heightControl, dimensions.height); source.value = generateSource(); markChanged(); selectFunction("BlankClip"); });
librarySearch.addEventListener("input", renderLibrary);
document.querySelectorAll(".library-tab").forEach((tab) => tab.addEventListener("click", () => { libraryKind = tab.textContent.toLowerCase(); document.querySelectorAll(".library-tab").forEach((candidate) => candidate.setAttribute("aria-selected", String(candidate === tab))); renderLibrary(); }));
document.querySelector("[data-copy-call]").addEventListener("click", async () => { const text = functionInfo(selectedLibraryFunction).signature; try { await navigator.clipboard.writeText(text); inspectorNote.textContent = "Function call copied to the clipboard."; } catch { inspectorNote.textContent = `Copy this call: ${text}`; } });
document.querySelector("[data-insert-note]").addEventListener("click", () => { const info = functionInfo(selectedLibraryFunction); const note = `# Reference: ${info.signature}`; if (!source.value.includes(note)) source.value = `${source.value.trimEnd()}\n\n${note}\n`; source.focus(); markChanged("SOURCE NOTE ADDED"); renderGraph(); inspectorNote.textContent = "A non-executable reference note was added. Replace it with an authored call and its valid arguments to plot it."; });
document.querySelector(".theme-toggle").addEventListener("click", (event) => { const active = event.currentTarget.getAttribute("aria-pressed") === "true"; event.currentTarget.setAttribute("aria-pressed", String(!active)); event.currentTarget.textContent = active ? "Dark draft" : "Blueprint high contrast"; document.documentElement.style.setProperty("--blue-950", active ? "#031e47" : "#01152f"); });

renderLibrary(); selectFunction("BlankClip");
window.addEventListener("pagehide", () => client.close(), { once: true });
refreshStatus().catch((error) => { runtimeReady = false; diagnostics.error("startup", error.message, error.stack); setStatus(`startup-error: ${error.message}`, "error"); updateRunControl(); });

function createDiagnosticConsole() {
  const details = document.querySelector("details.diagnostics"); const log = details?.querySelector(".diagnostics-log"); const clearButton = details?.querySelector(".diagnostics-clear");
  clearButton?.addEventListener("click", () => { log.textContent = ""; });
  const write = ({ level = "info", source = "client", message, detail, timestamp = new Date().toISOString() }) => { if (!log) return; const line = document.createElement("span"); line.className = `diagnostic-${level}`; let text = `[${timestamp.slice(11, 23)}] ${level.toUpperCase().padEnd(5)} ${source}: ${message}`; if (detail) text += `\n  ${typeof detail === "string" ? detail : JSON.stringify(detail)}`; line.textContent = `${text}\n`; log.append(line); log.scrollTop = log.scrollHeight; if (level === "error") details.open = true; };
  return { write, info: (source, message, detail) => write({ level: "info", source, message, detail }), warn: (source, message, detail) => write({ level: "warn", source, message, detail }), error: (source, message, detail) => write({ level: "error", source, message, detail }) };
}

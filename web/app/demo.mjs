import { drawRgbaFrame } from "../runtime/vapoursynth/client.mjs";
import { PyodideWorkerClient } from "../runtime/pyodide/client.mjs";

const canvas = document.querySelector("canvas");
const source = document.querySelector("textarea");
const run = document.querySelector(".run-button");
const themeToggle = document.querySelector(".theme-toggle");
const themeColor = document.querySelector('meta[name="theme-color"]');
const runLabel = document.querySelector("[data-run-label]");
const status = document.querySelector("[data-status-text]");
const runtimeStatus = document.querySelector("[data-runtime-status]");
const outputState = document.querySelector("[data-output-state]");
const diagnostics = createDiagnosticConsole();

window.addEventListener("error", (event) => {
  diagnostics.write({
    level: "error",
    source: "window",
    message: event.message || "Unhandled browser error",
    detail: { filename: event.filename, lineno: event.lineno, colno: event.colno },
    timestamp: new Date().toISOString(),
  });
});
window.addEventListener("unhandledrejection", (event) => {
  diagnostics.write({
    level: "error",
    source: "promise",
    message: event.reason?.message ?? String(event.reason ?? "Unhandled promise rejection"),
    detail: event.reason?.stack,
    timestamp: new Date().toISOString(),
  });
});

const workerUrl = new URL("../runtime/pyodide/bootstrap.mjs", import.meta.url);
diagnostics.info("bootstrap", `Creating module worker: ${workerUrl.href}`);
const worker = new Worker(workerUrl, { type: "module" });
const client = new PyodideWorkerClient(worker, { onDiagnostic: diagnostics.write });

let runtimeReady = false;
let rendering = false;

function setStatus(message, state) {
  status.textContent = message;
  runtimeStatus.dataset.state = state;
  diagnostics.info("status", `${state}: ${message}`);
}

function setOutputState(message, state) {
  outputState.textContent = message;
  outputState.dataset.state = state;
}

function updateRunControl() {
  run.disabled = !runtimeReady || rendering;
  runLabel.textContent = rendering ? "Rendering…" : "Run script";
  run.setAttribute("aria-busy", String(rendering));
}

function setTheme(theme) {
  const light = theme === "light";
  document.documentElement.dataset.theme = light ? "light" : "dark";
  themeToggle?.setAttribute("aria-pressed", String(light));
  if (themeToggle) themeToggle.textContent = light ? "Dark mode" : "Light mode";
  if (themeColor) themeColor.content = light ? "#f2efe8" : "#0d0e10";
}

function savedTheme() {
  try {
    return localStorage.getItem("vapoursynth-theme") === "light" ? "light" : "dark";
  } catch {
    return "dark";
  }
}

setTheme(savedTheme());

themeToggle?.addEventListener("click", () => {
  const nextTheme = document.documentElement.dataset.theme === "light" ? "dark" : "light";
  setTheme(nextTheme);
  try {
    localStorage.setItem("vapoursynth-theme", nextTheme);
  } catch {
    // Theme selection remains active for this page when storage is unavailable.
  }
});

async function refreshStatus() {
  setStatus("Starting browser workers…", "rendering");
  diagnostics.info("bootstrap", `Page: ${location.href}`);
  diagnostics.info("bootstrap", `User agent: ${navigator.userAgent}`);
  const capabilities = await client.status();
  diagnostics.info("capabilities", JSON.stringify(capabilities));
  runtimeReady = capabilities.upstreamLinked;

  const capsTarget = document.querySelector("[data-authoring-caps]");
  if (capsTarget) {
    const authoring = capabilities.authoring;
    capsTarget.textContent = authoring?.available
      ? `plan version ${authoring.planVersion} · source format ${authoring.format}`
      : "authoring unavailable";
  }

  if (runtimeReady) {
    setStatus("Runtime ready · output 0 is available", "ready");
    setOutputState("ready", "ready");
  } else {
    setStatus("Pyodide ready · Emscripten runtime not attached", "idle");
    setOutputState("runtime unavailable", "idle");
  }

  updateRunControl();
}

async function renderScript() {
  if (!runtimeReady || rendering) {
    diagnostics.warn("render", "Render request ignored because the runtime is unavailable or busy");
    return;
  }

  rendering = true;
  setStatus("Executing editor.vpy…", "rendering");
  setOutputState("rendering", "rendering");
  setGraphState("rendering", "Rendering…");
  updateRunControl();

  try {
    const scriptAtStart = source.value;
    const { outputs } = await client.runScript(scriptAtStart, "editor.vpy");
    diagnostics.info("render", `Script registered ${outputs.length} output(s)`);
    const output = outputs.find(({ index }) => index === 0);
    if (!output) {
      throw new Error("the script did not register output 0 with clip.set_output()");
    }

    const frame = await client.renderOutput(output.index);
    drawRgbaFrame(canvas, frame);
    const dimensions = `${frame.width}×${frame.height}`;
    setStatus(`Rendered ${dimensions} RGBA8`, "ready");
    if (source.value !== scriptAtStart) {
      setGraphState("changed", "Script changed during render — run again to update output");
      setOutputState("awaiting render", "idle");
    } else if (source.value.trim() === generateSource().trim()) {
      setGraphState("ready", `Rendered ${dimensions} RGBA8`);
      setOutputState(dimensions, "ready");
    } else {
      syncGraphAvailability();
      setOutputState(dimensions, "ready");
    }
  } catch (error) {
    const message = `${error.code ?? "error"}: ${error.message}`;
    diagnostics.error("render", message, error.stack);
    setStatus(message, "error");
    setOutputState("render failed", "error");
    setGraphState("error", message);
  } finally {
    rendering = false;
    updateRunControl();
  }
}

run.addEventListener("click", renderScript);

// ── Signal graph: source → effect → program output ──────────────────────────
// The demo graph is a fixed supported pipeline: BlankClip (Source) → Invert
// (Effect) → set_output 0 (Program output). Selecting a node inspects it; the
// source exposes width/height parameters whose changes regenerate the script.
// Anything not supported by the runtime is described truthfully, never faked.

const GRAPH_BOUNDS = {
  width: { min: 64, max: 1920 },
  height: { min: 64, max: 1080 },
};

const graphNodes = new Map(
  [...document.querySelectorAll("[data-graph-node]")].map((node) => [node.dataset.graphNode, node])
);
const graphTitle = document.querySelector("[data-graph-title]");
const graphSummary = document.querySelector("[data-graph-summary]");
const graphStatus = document.querySelector("[data-graph-status]");
const dimensionsPanel = document.querySelector("[data-graph-dimensions]");
const widthControl = document.querySelector("[data-graph-width]");
const heightControl = document.querySelector("[data-graph-height]");
const widthValue = document.querySelector('[data-graph-value="width"]');
const heightValue = document.querySelector('[data-graph-value="height"]');

const NODE_INFO = {
  source: {
    title: "Source · BlankClip",
    summary: (dims) => `BlankClip ${dims.width}×${dims.height} RGB24, color [32, 96, 224] — frame generator feeding the effect bus.`,
  },
  effect: {
    title: "Effect · Invert",
    summary: "Invert — per-channel 1:1 remap (out = 255 − in) applied to the source bus. No parameters.",
  },
  output: {
    title: "Program output · Output 0",
    summary: "Output 0 — RGB24, registered via clip.set_output(), routed to the program monitor.",
  },
};

const DEFAULT_SCRIPT = `import vapoursynth as vs

clip = vs.core.std.BlankClip(width=320, height=180, format=vs.RGB24, color=[32.0, 96.0, 224.0])
clip = vs.core.std.Invert(clip)
clip.set_output()`;

function controlFor(name) {
  return name === "width" ? widthControl : heightControl;
}

function boundsFor(name) {
  const control = controlFor(name);
  const fallback = GRAPH_BOUNDS[name];
  if (!control) return fallback;
  const min = Number.parseInt(control.getAttribute("min") ?? "", 10);
  const max = Number.parseInt(control.getAttribute("max") ?? "", 10);
  return {
    min: Number.isSafeInteger(min) ? min : fallback.min,
    max: Number.isSafeInteger(max) ? max : fallback.max,
  };
}

function clampDim(name, raw) {
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isSafeInteger(parsed)) return null;
  const { min, max } = boundsFor(name);
  return Math.min(max, Math.max(min, parsed));
}

const dims = {
  width: clampDim("width", widthControl?.value ?? "") ?? 320,
  height: clampDim("height", heightControl?.value ?? "") ?? 180,
};

function generateSource() {
  return `import vapoursynth as vs

clip = vs.core.std.BlankClip(width=${dims.width}, height=${dims.height}, format=vs.RGB24, color=[32.0, 96.0, 224.0])
clip = vs.core.std.Invert(clip)
clip.set_output()`;
}

let graphState = "idle";
let graphStateText = "Awaiting run";

function applyGraphStatus() {
  if (!graphStatus) return;
  graphStatus.textContent = graphStateText;
  graphStatus.dataset.state = graphState;
}

function setGraphState(state, message) {
  graphState = state;
  graphStateText = message;
  applyGraphStatus();
}

function setValueDisplay(name) {
  const display = name === "width" ? widthValue : heightValue;
  if (!display) return;
  const text = String(dims[name]);
  if (display instanceof HTMLInputElement) display.value = text;
  else display.textContent = text;
}

function syncDimensionControl(name) {
  const control = controlFor(name);
  if (control) control.value = String(dims[name]);
  setValueDisplay(name);
}

function revealDimensions(reveal) {
  if (dimensionsPanel) {
    dimensionsPanel.hidden = !reveal;
    return;
  }
  for (const control of [widthControl, heightControl]) {
    if (control) control.hidden = !reveal;
  }
}

function setInspectorPanel(name) {
  for (const block of document.querySelectorAll(".param-block[data-param-for]")) {
    block.hidden = block.dataset.paramFor !== name;
  }
}

function selectGraphNode(name) {
  if (!graphNodes.has(name)) return;
  for (const [nodeName, button] of graphNodes) {
    const active = nodeName === name;
    button.setAttribute("aria-pressed", String(active));
    if (active) {
      button.setAttribute("data-active", "true");
      button.classList.add("is-active");
    } else {
      button.removeAttribute("data-active");
      button.classList.remove("is-active");
    }
  }
  revealDimensions(name === "source");
  setInspectorPanel(name);
  const info = NODE_INFO[name];
  if (graphTitle) graphTitle.textContent = info.title;
  if (graphSummary) {
    graphSummary.textContent = typeof info.summary === "function" ? info.summary(dims) : info.summary;
  }
  applyGraphStatus();
}

function markGraphChanged(message = "Changed — ready to run") {
  setGraphState("changed", message);
  setOutputState("awaiting render", "idle");
}

function syncGraphAvailability() {
  const canonical = source.value.trim() === generateSource().trim();
  for (const button of graphNodes.values()) {
    button.disabled = !canonical;
  }
  if (!canonical) {
    setGraphState("unavailable", "Custom script — visual route unavailable");
  }
}

function onDimensionInput(event, name) {
  const value = clampDim(name, event.currentTarget.value);
  if (value === null) return;
  dims[name] = value;
  event.currentTarget.value = String(value);
  setValueDisplay(name);
  if (graphSummary) graphSummary.textContent = NODE_INFO.source.summary(dims);
  source.value = generateSource();
  markGraphChanged();
  syncGraphAvailability();
}

function onDimensionChange(event, name) {
  if (clampDim(name, event.currentTarget.value) === null) {
    syncDimensionControl(name);
  }
}

const initialNode =
  [...graphNodes.entries()].find(([, button]) => button.getAttribute("aria-pressed") === "true")?.[0] ?? "source";

if (graphNodes.size === 0) {
  diagnostics.warn("graph", "No signal graph nodes found — graph authoring controls unavailable");
} else {
  for (const [name, button] of graphNodes) {
    button.addEventListener("click", () => selectGraphNode(name));
  }
  selectGraphNode(initialNode);
  applyGraphStatus();
}

if (widthControl) {
  widthControl.addEventListener("input", (event) => onDimensionInput(event, "width"));
  widthControl.addEventListener("change", (event) => onDimensionChange(event, "width"));
}
if (heightControl) {
  heightControl.addEventListener("input", (event) => onDimensionInput(event, "height"));
  heightControl.addEventListener("change", (event) => onDimensionChange(event, "height"));
}
syncDimensionControl("width");
syncDimensionControl("height");

// Sync the editor with the graph only while it still holds the stock default
// script; author-authored source is never overwritten outside a control change.
if (source.value.trim() === DEFAULT_SCRIPT.trim() && source.value.trim() !== generateSource().trim()) {
  source.value = generateSource();
}

source.addEventListener("input", () => {
  markGraphChanged("Script edited — run to update output");
  syncGraphAvailability();
});

source.addEventListener("keydown", (event) => {
  if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
    event.preventDefault();
    void renderScript();
  }
});

window.addEventListener("pagehide", () => client.close(), { once: true });
refreshStatus().catch((error) => {
  runtimeReady = false;
  diagnostics.error("startup", error.message, error.stack);
  setStatus(`startup-error: ${error.message}`, "error");
  setOutputState("startup failed", "error");
  updateRunControl();
});

function createDiagnosticConsole() {
  let details = document.querySelector("details.diagnostics");
  let log = details?.querySelector(".diagnostics-log");
  let clearButton = details?.querySelector(".diagnostics-clear");

  if (!details || !log || !clearButton) {
    const style = document.createElement("style");
    style.textContent = `
      .diagnostics { margin-top: 1rem; overflow: hidden; border: 1px solid rgba(255,255,255,.09); border-radius: .75rem; background: #0b0c0f; }
      .diagnostics summary { cursor: pointer; padding: .75rem 1rem; color: #aeb4bf; font-size: .78rem; font-weight: 590; user-select: none; }
      .diagnostics[open] summary { border-bottom: 1px solid rgba(255,255,255,.075); }
      .diagnostics-toolbar { display: flex; justify-content: flex-end; padding: .45rem .65rem; border-bottom: 1px solid rgba(255,255,255,.075); }
      .diagnostics-clear { border: 1px solid rgba(255,255,255,.12); border-radius: .35rem; padding: .25rem .5rem; background: transparent; color: #8f96a2; cursor: pointer; font-size: .7rem; }
      .diagnostics-log { max-height: 18rem; overflow: auto; margin: 0; padding: .75rem 1rem 1rem; color: #aeb4bf; white-space: pre-wrap; overflow-wrap: anywhere; font: .72rem/1.55 ui-monospace, SFMono-Regular, Consolas, monospace; }
      .diagnostic-error { color: #ff9a9a; }
      .diagnostic-warn { color: #e9c46a; }
      .diagnostic-info { color: #aeb4bf; }
    `;
    document.head.append(style);

    details = document.createElement("details");
    details.className = "diagnostics";
    details.innerHTML = `
      <summary>Runtime diagnostics</summary>
      <div class="diagnostics-toolbar"><button class="diagnostics-clear" type="button">Clear log</button></div>
      <pre class="diagnostics-log" aria-live="polite"></pre>
    `;
    document.querySelector(".workspace")?.after(details);

    log = details.querySelector(".diagnostics-log");
    clearButton = details.querySelector(".diagnostics-clear");
  }

  clearButton.addEventListener("click", () => {
    log.textContent = "";
  });

  const write = ({ level = "info", source = "client", message, detail, timestamp = new Date().toISOString() }) => {
    const time = timestamp.slice(11, 23);
    const line = document.createElement("span");
    line.className = `diagnostic-${level}`;
    let text = `[${time}] ${level.toUpperCase().padEnd(5)} ${source}: ${message}`;
    if (detail !== undefined && detail !== null) {
      try {
        const serialized = typeof detail === "string" ? detail : JSON.stringify(detail);
        if (serialized && serialized !== "{}") text += `\n  ${serialized}`;
      } catch {
        text += `\n  ${String(detail)}`;
      }
    }
    line.textContent = `${text}\n`;
    log.append(line);
    log.scrollTop = log.scrollHeight;
    if (level === "error") details.open = true;
    console[level === "warn" ? "warn" : level === "error" ? "error" : "log"](`[${source}] ${message}`, detail ?? "");
  };

  return {
    write,
    info: (source, message, detail) => write({ level: "info", source, message, detail }),
    warn: (source, message, detail) => write({ level: "warn", source, message, detail }),
    error: (source, message, detail) => write({ level: "error", source, message, detail }),
  };
}

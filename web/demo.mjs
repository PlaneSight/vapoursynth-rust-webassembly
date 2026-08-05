import { drawRgbaFrame } from "./worker-client.mjs";
import { PyodideWorkerClient } from "./pyodide-worker-client.mjs";

const canvas = document.querySelector("canvas");
const source = document.querySelector("textarea");
const run = document.querySelector("button");
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

const workerUrl = new URL("./pyodide.worker.mjs", import.meta.url);
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

async function refreshStatus() {
  setStatus("Starting browser workers…", "rendering");
  diagnostics.info("bootstrap", `Page: ${location.href}`);
  diagnostics.info("bootstrap", `User agent: ${navigator.userAgent}`);
  const capabilities = await client.status();
  diagnostics.info("capabilities", JSON.stringify(capabilities));
  runtimeReady = capabilities.upstreamLinked;

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
  updateRunControl();

  try {
    const { outputs } = await client.runScript(source.value, "editor.vpy");
    diagnostics.info("render", `Script registered ${outputs.length} output(s)`);
    const output = outputs.find(({ index }) => index === 0);
    if (!output) {
      throw new Error("the script did not register output 0 with await vs.set_output(0, node)");
    }

    const frame = await client.renderOutput(output.index);
    drawRgbaFrame(canvas, frame);
    const dimensions = `${frame.width}×${frame.height}`;
    setStatus(`Rendered ${dimensions} RGBA8`, "ready");
    setOutputState(dimensions, "ready");
  } catch (error) {
    const message = `${error.code ?? "error"}: ${error.message}`;
    diagnostics.error("render", message, error.stack);
    setStatus(message, "error");
    setOutputState("render failed", "error");
  } finally {
    rendering = false;
    updateRunControl();
  }
}

run.addEventListener("click", renderScript);
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

  const details = document.createElement("details");
  details.className = "diagnostics";
  details.innerHTML = `
    <summary>Runtime diagnostics</summary>
    <div class="diagnostics-toolbar"><button class="diagnostics-clear" type="button">Clear log</button></div>
    <pre class="diagnostics-log" aria-live="polite"></pre>
  `;
  document.querySelector(".workspace")?.after(details);

  const log = details.querySelector(".diagnostics-log");
  details.querySelector(".diagnostics-clear").addEventListener("click", () => {
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

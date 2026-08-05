import { drawRgbaFrame } from "./worker-client.mjs";
import { PyodideWorkerClient } from "./pyodide-worker-client.mjs";

const canvas = document.querySelector("canvas");
const source = document.querySelector("textarea");
const run = document.querySelector("button");
const runLabel = document.querySelector("[data-run-label]");
const status = document.querySelector("[data-status-text]");
const runtimeStatus = document.querySelector("[data-runtime-status]");
const outputState = document.querySelector("[data-output-state]");
const worker = new Worker(new URL("./pyodide.worker.mjs", import.meta.url), {
  type: "module",
});
const client = new PyodideWorkerClient(worker);

let runtimeReady = false;
let rendering = false;

function setStatus(message, state) {
  status.textContent = message;
  runtimeStatus.dataset.state = state;
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
  const capabilities = await client.status();
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
    return;
  }

  rendering = true;
  setStatus("Executing editor.vpy…", "rendering");
  setOutputState("rendering", "rendering");
  updateRunControl();

  try {
    const { outputs } = await client.runScript(source.value, "editor.vpy");
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
  setStatus(`startup-error: ${error.message}`, "error");
  setOutputState("startup failed", "error");
  updateRunControl();
});

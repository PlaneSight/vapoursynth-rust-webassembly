import { drawRgbaFrame } from "./worker-client.mjs";
import { PyodideWorkerClient } from "./pyodide-worker-client.mjs";

const canvas = document.querySelector("canvas");
const status = document.querySelector("output");
const run = document.querySelector("button");
const source = document.querySelector("textarea");
const worker = new Worker(new URL("./pyodide.worker.mjs", import.meta.url), {
  type: "module",
});
const client = new PyodideWorkerClient(worker);

async function refreshStatus() {
  const capabilities = await client.status();
  status.value = capabilities.upstreamLinked
    ? "Pyodide and VapourSynth runtimes ready"
    : "Pyodide worker ready; Emscripten runtime not attached";
  run.disabled = !capabilities.upstreamLinked;
}

run.addEventListener("click", async () => {
  run.disabled = true;
  try {
    const { outputs } = await client.runScript(source.value, "editor.vpy");
    const output = outputs.find(({ index }) => index === 0);
    if (!output) {
      throw new Error("the script did not register output 0 with await vs.set_output(0, node)");
    }
    const frame = await client.renderOutput(output.index);
    drawRgbaFrame(canvas, frame);
    status.value = `Rendered ${frame.width}×${frame.height} RGBA8`;
  } catch (error) {
    status.value = `${error.code ?? "error"}: ${error.message}`;
  } finally {
    run.disabled = false;
  }
});

window.addEventListener("pagehide", () => client.close(), { once: true });
refreshStatus().catch((error) => {
  status.value = `startup-error: ${error.message}`;
});

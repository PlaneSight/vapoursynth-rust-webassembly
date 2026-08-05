import { WorkerClient, drawRgbaFrame } from "./worker-client.mjs";

const canvas = document.querySelector("canvas");
const status = document.querySelector("output");
const render = document.querySelector("button");
const worker = new Worker(new URL("./vapoursynth.worker.mjs", import.meta.url), {
  type: "module",
});
const client = new WorkerClient(worker);

async function refreshStatus() {
  const capabilities = await client.status();
  status.value = capabilities.upstreamLinked
    ? "VapourSynth runtime ready"
    : "Worker ready; Emscripten runtime not attached";
  render.disabled = !capabilities.upstreamLinked;
}

render.addEventListener("click", async () => {
  render.disabled = true;
  try {
    const frame = await client.renderBlankFrame(320, 180);
    drawRgbaFrame(canvas, frame);
    status.value = `Rendered ${frame.width}×${frame.height} RGBA8`;
  } catch (error) {
    status.value = `${error.code ?? "error"}: ${error.message}`;
  } finally {
    render.disabled = false;
  }
});

window.addEventListener("pagehide", () => client.close(), { once: true });
refreshStatus().catch((error) => {
  status.value = `startup-error: ${error.message}`;
});

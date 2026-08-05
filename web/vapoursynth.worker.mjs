import init, { WorkerSession } from "../pkg/vapoursynth_wasm_host.js";
import { startWorkerRuntime } from "./worker-runtime.mjs";

await startWorkerRuntime({
  loadHost: async () => {
    await init();
    return { WorkerSession };
  },
});

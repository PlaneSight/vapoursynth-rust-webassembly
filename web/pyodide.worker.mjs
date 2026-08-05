import { loadVapourSynthPackageSource } from "./pyodide-package.mjs";
import { loadBrowserPyodide } from "./pyodide-loader.mjs";
import { startPyodideWorkerRuntime } from "./pyodide-worker-runtime.mjs";

await startPyodideWorkerRuntime({
  scope: globalThis,
  loadPyodide: loadBrowserPyodide,
  createVapourSynthWorker: () => new Worker(new URL("./vapoursynth.worker.mjs", import.meta.url), { type: "module" }),
  loadPackageSource: loadVapourSynthPackageSource,
});

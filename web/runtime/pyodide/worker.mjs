import { loadVapourSynthPackageSource } from "./package.mjs";
import { loadBrowserPyodide } from "./loader.mjs";
import { startPyodideWorkerRuntime } from "./worker-runtime.mjs";

function reportBootstrap(message, { level = "info", detail } = {}) {
  globalThis.postMessage({
    schemaVersion: 1,
    type: "diagnostic",
    diagnostic: {
      level,
      source: "worker-bootstrap",
      message,
      detail,
    },
  });
}

reportBootstrap("Pyodide worker module started");
try {
  await startPyodideWorkerRuntime({
    scope: globalThis,
    loadPyodide: loadBrowserPyodide,
    createVapourSynthWorker: () => new Worker(new URL("../vapoursynth/worker.mjs", import.meta.url), { type: "module" }),
    loadPackageSource: loadVapourSynthPackageSource,
    onDiagnostic: reportBootstrap,
  });
  reportBootstrap("Pyodide worker ready");
  globalThis.postMessage({ schemaVersion: 1, type: "ready" });
} catch (error) {
  reportBootstrap(error?.message ?? "Pyodide worker bootstrap failed", {
    level: "error",
    detail: error?.stack,
  });
  globalThis.postMessage({
    schemaVersion: 1,
    type: "bootstrap-error",
    error: {
      code: "worker-bootstrap-error",
      message: error?.message ?? "Pyodide worker bootstrap failed",
    },
  });
  throw error;
}

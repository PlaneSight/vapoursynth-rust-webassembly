import { loadVapourSynthPackageSource } from "./package.mjs";
import { loadBrowserPyodide, resolvePyodideIndexUrl } from "./loader.mjs";
import { startPyodideWorkerRuntime } from "./worker.mjs";

const pyodideIndexUrl = resolvePyodideIndexUrl(import.meta.url);

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
reportBootstrap("Pyodide index URL resolved", { detail: pyodideIndexUrl });
try {
  await startPyodideWorkerRuntime({
    scope: globalThis,
    loadPyodide: () => loadBrowserPyodide({ indexURL: pyodideIndexUrl }),
    createVapourSynthWorker: () => new Worker(new URL("../vapoursynth/bootstrap.mjs", import.meta.url), { type: "module" }),
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
